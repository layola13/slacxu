import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { JsonValue } from "@codex-ui/shared";
import { isBunRuntime } from "@cxu/sdk-backend";
import { openNodeRuntimeDatabase } from "@cxu/sdk-backend";
import { codexUiDataDir } from "@cxu/sdk-backend";
import { opencodeSubtaskChildId } from "./opencodeCompatibleTurnProjector.js";

const require = createRequire(import.meta.url);

/**
 * Read-only projection over the native opencode SQLite store
 * (`<xdg-data>/opencode/opencode.db`, e.g. `~/.local/share/opencode`).
 *
 * Mirrors the Codex backend projection semantics used for rollout JSONL:
 * - list: bounded, sorted by recency, no subscription, no runtime creation.
 * - load: bounded message window projected to Codex turns/items, read-only.
 * - fileInfo/tail: virtual file info + truncated tail metadata.
 *
 * The native DB is NEVER opened writable here; every helper opens it
 * readonly and closes it before returning so a running opencode TUI/serve
 * keeps its WAL lock.
 */

export const NATIVE_OPENCODE_LIST_LIMIT = 200;
export const NATIVE_OPENCODE_MAX_MESSAGES = 100;
export const NATIVE_OPENCODE_MAX_ITEMS = 1200;
// List-page N+1 preview lookups block the Bun event loop (each is 2 queries).
// 10 is enough for the visible sidebar window; titles cover the rest.
export const NATIVE_OPENCODE_PREVIEW_LOOKUP_LIMIT = 10;

type JsonRecord = Record<string, unknown>;

interface NativeDb {
  query?: (sql: string) => { all: (...args: unknown[]) => Record<string, unknown>[]; get: (...args: unknown[]) => Record<string, unknown> | null };
  prepare?: (sql: string) => { all: (...args: unknown[]) => Record<string, unknown>[]; get: (...args: unknown[]) => Record<string, unknown> | null };
  exec?: (sql: string) => void;
  close: () => void;
}

function candidateDataDirs(): string[] {
  const dirs: string[] = [];
  const testHome = process.env.OPENCODE_TEST_HOME?.trim();
  // Hermetic tests point OPENCODE_TEST_HOME at a fixture root that holds an
  // `opencode/` data dir directly.
  if (testHome) dirs.push(join(testHome, "opencode"));
  const home = testHome || homedir();
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) dirs.push(join(xdg, "opencode"));
  if (home) dirs.push(join(home, ".local", "share", "opencode"));
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) dirs.push(join(localAppData, "opencode"));
  const appData = process.env.APPDATA?.trim();
  if (appData) dirs.push(join(appData, "opencode"));
  if (home) dirs.push(join(home, "AppData", "Local", "opencode"));
  return [...new Set(dirs)];
}

function candidateDbFiles(): string[] {
  const explicit = process.env.OPENCODE_DB?.trim();
  if (explicit && explicit !== ":memory:" && isAbsolute(explicit) && existsSync(explicit)) {
    return [explicit];
  }
  const files: string[] = [];
  for (const dir of candidateDataDirs()) {
    const main = join(dir, "opencode.db");
    if (existsSync(main)) files.push(main);
    // Channel-specific DBs (opencode-<channel>.db) share the same schema.
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith("opencode-") && entry.endsWith(".db") && !entry.endsWith("-shm") && !entry.endsWith("-wal") && !entry.endsWith("-journal")) {
          const full = join(dir, entry);
          if (!files.includes(full)) files.push(full);
        }
      }
    } catch {
      // Directory unreadable — ignore.
    }
  }
  return files;
}

/** All native opencode DB files currently present (empty when opencode never ran here). */
export function resolveNativeOpencodeDatabaseFiles(): string[] {
  return candidateDbFiles();
}

function openNativeDb(file: string): NativeDb | null {
  try {
    const db: NativeDb = isBunRuntime
      ? new (require("bun:sqlite") as { Database: new (path: string, opts?: { readonly?: boolean }) => NativeDb }).Database(file, { readonly: true })
      : (openNodeRuntimeDatabase(file, { readonly: true }) as unknown as NativeDb);
    try {
      // Bound lock-wait so a wedged writer fails fast instead of hanging history loads.
      // 100ms: metadata/page RPCs already have 8s/20s client timeouts; a contested
      // WAL must not park the Bun event loop (18% stall).
      db.exec?.("PRAGMA busy_timeout = 100");
    } catch {
      // Pragma unsupported — reads still fail fast by default.
    }
    return db;
  } catch {
    return null;
  }
}

function all(db: NativeDb, sql: string, ...args: unknown[]): Record<string, unknown>[] {
  try {
    if (db.query) return db.query(sql).all(...args) as Record<string, unknown>[];
    if (db.prepare) return db.prepare(sql).all(...args) as Record<string, unknown>[];
  } catch {
    // Locked/corrupt schema (e.g. older opencode DB without message_id) must
    // degrade to metadata-only instead of hanging the history open.
    return [];
  }
  return [];
}

function get(db: NativeDb, sql: string, ...args: unknown[]): Record<string, unknown> | null {
  try {
    if (db.query) return (db.query(sql).get(...args) as Record<string, unknown> | null) ?? null;
    if (db.prepare) return (db.prepare(sql).get(...args) as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
  return null;
}

function closeQuiet(db: NativeDb | null): void {
  if (!db) return;
  try {
    db.close();
  } catch {
    // ignore
  }
}

export function isNativeOpencodeSessionId(threadId: string): boolean {
  return typeof threadId === "string" && /^ses_[A-Za-z0-9]+$/.test(threadId.trim());
}

function isDefaultSessionTitle(title: string): boolean {
  const t = title.trim();
  return t === "" || /^(New session|Child session|Session)\b/.test(t) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(t);
}

function parseModel(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as { id?: unknown; providerID?: unknown };
    const id = typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : null;
    const provider = typeof parsed.providerID === "string" && parsed.providerID.trim() ? parsed.providerID.trim() : null;
    if (id && provider) return `${provider}/${id}`;
    return id;
  } catch {
    return value.trim() || null;
  }
}

function toSeconds(ms: unknown, fallback: number): number {
  const n = typeof ms === "number" && Number.isFinite(ms) ? ms : fallback;
  return Math.floor(n / 1000);
}

export interface NativeOpencodeThreadEntry extends JsonRecord {
  id: string;
}

function fetchFirstUserText(db: NativeDb, sessionId: string): string | null {
  try {
    const messages = all(db, "SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created ASC LIMIT 5", sessionId);
    for (const row of messages) {
      const data = parseJsonData(row.data);
      if (data.role !== "user") continue;
      const parts = all(db, "SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC LIMIT 10", String(row.id));
      for (const part of parts) {
        const pdata = parseJsonData(part.data);
        if (pdata.type === "text" && typeof pdata.text === "string" && pdata.text.trim()) {
          return pdata.text.trim().slice(0, 100);
        }
      }
    }
  } catch {
    // Fall through to title fallback.
  }
  return null;
}

function parseJsonData(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonRecord;
    } catch {
      // ignore
    }
  }
  return {};
}

/**
 * Bounded native history listing for the sidebar's opencode tab.
 * Merges across all discovered channel DBs, dedupes by session id and sorts
 * by recency — the same entry shape `mergeSshWorkspaceThreads` produces for
 * internal opencode threads so the web catalog consumes both interchangeably.
 */
export function listNativeOpencodeThreads(
  limitOrOptions: number | { limit?: number; includeSubagents?: boolean } = NATIVE_OPENCODE_LIST_LIMIT,
  legacyOptions?: { includeSubagents?: boolean }
): NativeOpencodeThreadEntry[] {
  const limit = typeof limitOrOptions === "number"
    ? limitOrOptions
    : (typeof limitOrOptions?.limit === "number" ? limitOrOptions.limit : NATIVE_OPENCODE_LIST_LIMIT);
  const includeSubagents = typeof limitOrOptions === "object" && limitOrOptions !== null
    ? Boolean(limitOrOptions.includeSubagents)
    : Boolean(legacyOptions?.includeSubagents);

  const files = candidateDbFiles();
  if (files.length === 0) return [];
  const byId = new Map<string, NativeOpencodeThreadEntry>();
  for (const file of files) {
    const db = openNativeDb(file);
    if (!db) continue;
    try {
      let rows: Record<string, unknown>[];
      try {
        rows = all(
          db,
          "SELECT id, title, directory, model, time_created, time_updated, parent_id, agent FROM session WHERE time_archived IS NULL ORDER BY time_updated DESC LIMIT ?",
          Math.max(1, Math.min(500, limit)),
        );
      } catch {
        try {
          rows = all(
            db,
            "SELECT id, title, directory, model, time_created, time_updated, parent_id FROM session WHERE time_archived IS NULL ORDER BY time_updated DESC LIMIT ?",
            Math.max(1, Math.min(500, limit)),
          );
        } catch {
          continue;
        }
      }
      let previewLookups = 0;
      for (const row of rows) {
        const id = typeof row.id === "string" ? row.id : null;
        if (!id || byId.has(id)) continue;
        const parentThreadId = typeof row.parent_id === "string" && row.parent_id ? row.parent_id : null;
        if (parentThreadId && !includeSubagents) continue;
        const title = typeof row.title === "string" ? row.title : "";
        const agentRole = typeof row.agent === "string" && row.agent.trim() ? row.agent.trim() : undefined;
        const cwd = typeof row.directory === "string" && row.directory.trim() ? row.directory.trim() : null;
        const model = parseModel(row.model);
        const createdAt = toSeconds(row.time_created, Date.now());
        const updatedAt = toSeconds(row.time_updated, Date.now());
        const hasCustomTitle = !isDefaultSessionTitle(title);
        const customTitle = hasCustomTitle && title.trim() ? title.trim() : null;
        let preview = title.trim();
        if (!preview || isDefaultSessionTitle(preview)) {
          let firstText: string | null = null;
          if (previewLookups < NATIVE_OPENCODE_PREVIEW_LOOKUP_LIMIT) {
            previewLookups += 1;
            firstText = fetchFirstUserText(db, id);
          }
          preview = firstText ?? (title.trim() || "OpenCode conversation");
        }
        if (preview.length > 100) preview = preview.slice(0, 100);
        byId.set(id, {
          id,
          sessionId: id,
          parentThreadId,
          name: customTitle,
          title: customTitle,
          preview,
          agentRole,
          // Top-level sessions must not inherit the custom title as a
          // nickname: the sidebar renders any agentNickname/agentRole as
          // 侧聊, so every titled native session was mislabeled and a
          // renamed conversation looked like a main + sidechat duplicate.
          // Child (subagent) sessions keep the title fallback for tab labels.
          agentNickname: parentThreadId
            ? (customTitle ?? (agentRole ? `@${agentRole}` : undefined))
            : (agentRole ? `@${agentRole}` : undefined),
          model,
          createdAt,
          updatedAt,
          recencyAt: updatedAt,
          status: { type: "notLoaded" },
          cwd,
          cliBackend: "opencode",
          source: "appServer",
          native: true,
          turns: [],
        });
      }
    } finally {
      closeQuiet(db);
    }
  }
  return [...byId.values()]
    .sort((a, b) => Number(b.recencyAt ?? b.updatedAt ?? 0) - Number(a.recencyAt ?? a.updatedAt ?? 0))
    .slice(0, Math.max(1, Math.min(500, limit)));
}

export interface NativeOpencodeSessionMeta {
  id: string;
  title: string;
  directory: string | null;
  model: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  parentId: string | null;
  agent: string | null;
  dbFile: string;
}

export function getNativeOpencodeSessionMeta(sessionId: string): NativeOpencodeSessionMeta | null {
  const sid = sessionId.trim();
  if (!sid) return null;
  // Session→dbFile cache (30s TTL): metadata opens previously probed every
  // channel DB on each history open, multiplying WAL contention (18% stall).
  const cached = metaDbFileCache.get(sid);
  if (cached && Date.now() - cached.at < 30_000) {
    const db = openNativeDb(cached.dbFile);
    if (db) {
      try {
        const meta = readSessionMeta(db, sid, cached.dbFile);
        if (meta) return meta;
      } finally {
        closeQuiet(db);
      }
      metaDbFileCache.delete(sid);
    }
  }
  for (const file of candidateDbFiles()) {
    const db = openNativeDb(file);
    if (!db) continue;
    try {
      const meta = readSessionMeta(db, sid, file);
      if (!meta) continue;
      metaDbFileCache.set(sid, { dbFile: file, at: Date.now() });
      return meta;
    } finally {
      closeQuiet(db);
    }
  }
  return null;
}

const metaDbFileCache = new Map<string, { dbFile: string; at: number }>();

function readSessionMeta(db: NativeDb, sid: string, file: string): NativeOpencodeSessionMeta | null {
  let row = get(db, "SELECT id, title, directory, model, time_created, time_updated, parent_id, agent FROM session WHERE id = ? LIMIT 1", sid);
  if (!row) {
    row = get(db, "SELECT id, title, directory, model, time_created, time_updated, parent_id FROM session WHERE id = ? LIMIT 1", sid);
  }
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : "",
    directory: typeof row.directory === "string" && row.directory.trim() ? row.directory.trim() : null,
    model: parseModel(row.model),
    createdAtMs: typeof row.time_created === "number" ? row.time_created : Date.now(),
    updatedAtMs: typeof row.time_updated === "number" ? row.time_updated : Date.now(),
    parentId: typeof row.parent_id === "string" && row.parent_id ? row.parent_id : null,
    agent: typeof row.agent === "string" && row.agent.trim() ? row.agent.trim() : null,
    dbFile: file,
  };
}

interface NativeMessage {
  id: string;
  role: string;
  createdAtMs: number;
  completedAtMs?: number;
  parts: JsonRecord[];
}

function loadPartsForMessages(db: NativeDb, messageIds: string[]): Map<string, JsonRecord[]> {
  const partsByMessageId = new Map<string, JsonRecord[]>();
  // Chunk the IN query so a message window never builds one giant
  // blocking SQLite statement; each chunk fails independently.
  for (let i = 0; i < messageIds.length; i += 25) {
    const chunk = messageIds.slice(i, i + 25);
    try {
      const placeholders = chunk.map(() => "?").join(",");
      // LENGTH prefilter: MB-level tool outputs are skipped in SQL instead of
      // JSON.parsed on the event loop (51% stall); a placeholder keeps context.
      const partRows = all(
        db,
        `SELECT id, message_id, LENGTH(data) AS len, CASE WHEN LENGTH(data) < 200000 THEN data ELSE NULL END AS data FROM part WHERE message_id IN (${placeholders}) ORDER BY time_created ASC, id ASC`,
        ...chunk,
      );
      for (const partRow of partRows) {
        const messageId = typeof partRow.message_id === "string" ? partRow.message_id : null;
        if (!messageId) continue;
        const parts = partsByMessageId.get(messageId) ?? [];
        if (parts.length < 200) {
          const raw = partRow.data;
          if (raw == null) {
            const len = typeof partRow.len === "number" ? partRow.len : 0;
            parts.push({ id: typeof partRow.id === "string" ? partRow.id : `${messageId}-part`, type: "text", text: `…[单条历史过长已截断，原文约 ${len} 字符]` });
          } else {
            parts.push({ id: typeof partRow.id === "string" ? partRow.id : `${messageId}-part`, ...parseJsonData(raw) });
          }
          partsByMessageId.set(messageId, parts);
        }
      }
    } catch {
      // Older/custom stores may not expose message_id on parts. Keep the
      // message projection usable even when the batched query is unavailable.
    }
  }
  return partsByMessageId;
}

interface NativeMessageRow {
  id: string;
  timeCreated: number | null;
  data: JsonRecord;
}

function assembleNativeMessages(rows: NativeMessageRow[], partsByMessageId: Map<string, JsonRecord[]>): NativeMessage[] {
  const messages: NativeMessage[] = [];
  for (const row of rows) {
    const data = row.data;
    const role = typeof data.role === "string" ? data.role : "assistant";
    const time = (data.time ?? {}) as JsonRecord;
    const created = typeof time.created === "number" ? time.created : typeof time.start === "number" ? time.start : Date.now();
    const completed = typeof time.completed === "number" ? time.completed : typeof time.end === "number" ? time.end : undefined;
    const parts = partsByMessageId.get(row.id) ?? [];
    messages.push({ id: row.id, role, createdAtMs: created, completedAtMs: completed, parts });
  }
  return messages;
}

function loadNativeMessages(db: NativeDb, sessionId: string, maxMessages: number): { messages: NativeMessage[]; truncated: boolean } {
  const totalRow = get(db, "SELECT COUNT(*) AS n FROM message WHERE session_id = ?", sessionId);
  const total = typeof totalRow?.n === "number" ? totalRow.n : 0;
  const bounded = Math.max(1, Math.min(1000, maxMessages));
  const offset = Math.max(0, total - bounded);
  const rows = all(
    db,
    "SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC LIMIT ? OFFSET ?",
    sessionId,
    bounded,
    offset,
  );
  const typedRows: NativeMessageRow[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    typedRows.push({ id: row.id, timeCreated: null, data: parseJsonData(row.data) });
  }
  const messageIds = typedRows.map((row) => row.id);
  const partsByMessageId = messageIds.length > 0 ? loadPartsForMessages(db, messageIds) : new Map<string, JsonRecord[]>();
  const messages = assembleNativeMessages(typedRows, partsByMessageId);
  return { messages, truncated: total > messages.length };
}

/**
 * Newest-first message batch for turn-boundary pagination: fetches at most
 * `batchSize` messages older than `before` (exclusive) and returns them in
 * ascending order with their parts attached. Only the rows/parts actually
 * needed for the requested turns page are read and JSON-parsed, instead of
 * projecting a fixed 100-message window on every page turn.
 */
function loadNativeMessageBatch(
  db: NativeDb,
  sessionId: string,
  before: { timeCreated: number; id: string } | null,
  batchSize: number,
): NativeMessageRow[] {
  const bounded = Math.max(1, Math.min(200, batchSize));
  const rows = before
    ? all(
      db,
      "SELECT id, data, time_created FROM message WHERE session_id = ? AND (time_created < ? OR (time_created = ? AND id < ?)) ORDER BY time_created DESC, id DESC LIMIT ?",
      sessionId,
      before.timeCreated,
      before.timeCreated,
      before.id,
      bounded,
    )
    : all(
      db,
      "SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT ?",
      sessionId,
      bounded,
    );
  const typedRows: NativeMessageRow[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    typedRows.push({
      id: row.id,
      timeCreated: typeof row.time_created === "number" ? row.time_created : null,
      data: parseJsonData(row.data),
    });
  }
  return typedRows.reverse();
}

function loadBatchParts(db: NativeDb, rows: NativeMessageRow[]): Map<string, JsonRecord[]> {
  const ids = rows.map((row) => row.id);
  return ids.length > 0 ? loadPartsForMessages(db, ids) : new Map<string, JsonRecord[]>();
}

export interface ProjectedNativeTurn {
  id: string;
  threadId: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  items: JsonRecord[];
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// 历史回放只做展示: 单条文本按字符上限截断, 否则 MB 级工具输出 (clone/文档抓取)
// 会让 thread/read 在事件循环里拼出数 MB 载荷, 前端 Decoding 卡死并触发 15s 超时。
// 完整原文仍保留在本地 opencode.db, 不做删除。
export const NATIVE_HISTORY_TEXT_LIMIT = 20_000;
export const NATIVE_HISTORY_TOOL_OUTPUT_LIMIT = 10_000;

export function clipHistoryText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n…[历史过长已截断，原文共 ${value.length} 字符]`;
}

// Native opencode `file` parts carry one of: a data: image URL, a file://
// URL / absolute disk path, or a remote http(s) URL — plus a display
// `filename`. The waterfall renders localImage{path,url} through
// /api/workspace/image (absolute disk path required) and image{url} for
// remote URLs directly, so resolve each part to a renderable block here.
// data: payloads are persisted once under a content hash (same bytes share
// one file) so history stays base64-free yet re-openable.
const NATIVE_HISTORY_IMAGE_MAX_BYTES = 24 * 1024 * 1024;

function nativeFileToImageBlock(f: JsonRecord): JsonRecord {
  const filename = typeof f.filename === "string" && f.filename.trim() ? f.filename.trim() : "[opencode-attachment]";
  const name = filename.split(/[\\/]/).pop() || filename;
  const url = typeof f.url === "string" ? f.url.trim() : "";
  const mime = typeof f.mime === "string" && f.mime.trim()
    ? f.mime.trim()
    : typeof f.mimeType === "string" ? f.mimeType.trim() : "";
  const disk = diskPathFromNativeFileUrl(url);
  if (disk) {
    try {
      if (statSync(disk).isFile()) return { type: "localImage", path: disk, url: disk, name };
    } catch {
      // Missing/unreadable file — fall through to the filename placeholder.
    }
  }
  if (/^https?:\/\//i.test(url)) return { type: "image", url, name };
  const persisted = persistNativeDataUrl(url, mime, name);
  if (persisted) return { type: "localImage", path: persisted, url: persisted, name };
  return { type: "localImage", path: filename };
}

function diskPathFromNativeFileUrl(url: string): string | undefined {
  if (!url) return undefined;
  // Windows absolute paths (C:\... / C:/...) are disk paths, not URI schemes.
  if (/^[A-Za-z]:[\\/]/.test(url)) return url;
  if (url.startsWith("file://")) {
    try {
      const decoded = decodeURIComponent(url.slice("file://".length));
      // file:///C:/... → C:/... on Windows; keep POSIX paths as-is.
      const normalized = /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
      if (isAbsolute(normalized)) return normalized;
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (url.startsWith("data:") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return undefined;
  return isAbsolute(url) ? url : undefined;
}

function persistNativeDataUrl(url: string, mime: string, name: string): string | null {
  const match = /^data:([^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/.exec(url.trim());
  if (!match) return null;
  const mediaType = (match[1] || mime || "").toLowerCase().split(";")[0]?.trim() || "";
  if (!mediaType.startsWith("image/")) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2]!.replace(/\s+/g, ""), "base64");
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > NATIVE_HISTORY_IMAGE_MAX_BYTES) return null;
  const ext = mediaType.split("/")[1]?.split("+")[0] || safeImageExt(name);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  try {
    const dir = join(codexUiDataDir(), "attachments", "opencode-history");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const abs = join(dir, `${hash}.${ext}`);
    if (!existsSync(abs)) writeFileSync(abs, bytes, { mode: 0o600 });
    return abs;
  } catch {
    return null;
  }
}

function safeImageExt(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]+/g, "") || "";
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext) ? ext : "png";
}

function projectMessagesToTurns(
  threadId: string,
  messages: NativeMessage[],
  maxItems: number,
  childSessionIds: string[] = [],
): ProjectedNativeTurn[] {
  const turns: ProjectedNativeTurn[] = [];
  let current: ProjectedNativeTurn | null = null;
  let itemCount = 0;
  const usedChildSessionIds = new Set<string>();

  const nextAvailableChildSessionId = (): string | undefined => {
    for (const id of childSessionIds) {
      if (!usedChildSessionIds.has(id)) {
        usedChildSessionIds.add(id);
        return id;
      }
    }
    return undefined;
  };

  const pushItem = (turn: ProjectedNativeTurn, item: JsonRecord): boolean => {
    if (itemCount >= maxItems) return false;
    turn.items.push(item as JsonRecord);
    itemCount += 1;
    return true;
  };

  const startTurn = (userMsg: NativeMessage): ProjectedNativeTurn => {
    const turn: ProjectedNativeTurn = {
      id: `opencode-native-${userMsg.id}`,
      threadId,
      status: "completed",
      startedAt: Math.floor(userMsg.createdAtMs / 1000),
      items: [],
    };
    turns.push(turn);
    return turn;
  };

  const ensureTurn = (msg: NativeMessage): ProjectedNativeTurn => {
    if (!current) {
      // History beginning with assistant messages (e.g. truncated window):
      // attach them to a recovered turn so nothing is dropped.
      current = {
        id: `opencode-native-recovered-${msg.id}`,
        threadId,
        status: "completed",
        startedAt: Math.floor(msg.createdAtMs / 1000),
        items: [],
      };
      turns.push(current);
    }
    return current;
  };

  for (const msg of messages) {
    if (msg.role === "user") {
      current = startTurn(msg);
      const texts = msg.parts.filter((p) => p.type === "text" && textOf(p.text).trim()).map((p) => textOf(p.text));
      const files = msg.parts.filter((p) => p.type === "file");
      const text = clipHistoryText(texts.join("\n").trim(), NATIVE_HISTORY_TEXT_LIMIT);
      if (text || files.length > 0) {
        pushItem(current, {
          type: "userMessage",
          id: msg.id,
          threadId,
          turnId: current.id,
          text,
          content: [
            ...(text ? [{ type: "text", text, text_elements: [] }] : []),
            // History keeps disk paths only, never data: URLs: a file:// URL
            // or absolute path becomes localImage{path,url} so the waterfall
            // can fetch-render it; an inline data: URL is persisted once under
            // a content hash and projected as the absolute saved path.
            // Transient base64 for the model lives in fileParts, not here.
            ...files.map((f) => nativeFileToImageBlock(f)),
          ],
          role: "user",
          status: "completed",
          startedAt: Math.floor(msg.createdAtMs / 1000),
          completedAt: Math.floor((msg.completedAtMs ?? msg.createdAtMs) / 1000),
        });
      }
      for (const subtask of msg.parts.filter((part) => part.type === "subtask")) {
        let childThreadId = opencodeSubtaskChildId(subtask as Record<string, unknown>, threadId);
        if (childThreadId) {
          usedChildSessionIds.add(childThreadId);
        } else {
          childThreadId = nextAvailableChildSessionId();
        }
        const input = (subtask.input && typeof subtask.input === "object" ? subtask.input : subtask) as JsonRecord;
        const agent = textOf(subtask.agent) || textOf(input.subagent_type) || "subagent";
        const prompt = textOf(subtask.prompt) || textOf(input.prompt);
        const description = textOf(subtask.description) || textOf(input.description);
        const receiverThreadIds = childThreadId ? [childThreadId] : [];
        const agentsStates = childThreadId
          ? { [childThreadId]: { status: "completed", message: description || `${agent} completed` } }
          : {};
        pushItem(current, {
          type: "collabAgentToolCall",
          id: `opencode-subtask-${subtask.id}`,
          threadId,
          turnId: current.id,
          tool: "task",
          status: "completed",
          senderThreadId: threadId,
          receiverThreadIds,
          prompt,
          agentId: childThreadId ?? subtask.id,
          ...(childThreadId ? { agentThreadId: childThreadId } : {}),
          agentName: description || agent,
          agentRole: agent,
          agentStatus: "completed",
          agentsStates,
          startedAt: Math.floor(msg.createdAtMs / 1000),
          completedAt: Math.floor((msg.completedAtMs ?? msg.createdAtMs) / 1000),
        });
      }
      continue;
    }

    const turn = ensureTurn(msg);
    // Assistant text parts converge into one agentMessage per message.
    const textParts = msg.parts.filter((p) => p.type === "text" && textOf(p.text).trim());
    if (textParts.length > 0) {
      const text = clipHistoryText(textParts.map((p) => textOf(p.text)).join("\n"), NATIVE_HISTORY_TEXT_LIMIT);
      pushItem(turn, {
        type: "agentMessage",
        id: msg.id,
        threadId,
        turnId: turn.id,
        text,
        content: [{ type: "text", text, text_elements: [] }],
        role: "assistant",
        status: "completed",
        startedAt: Math.floor(msg.createdAtMs / 1000),
        completedAt: Math.floor((msg.completedAtMs ?? msg.createdAtMs) / 1000),
      });
    }
    // Reasoning with visible text becomes a reasoning item (encrypted-only reasoning is skipped).
    const reasoningTexts = msg.parts.filter((p) => p.type === "reasoning" && textOf(p.text).trim()).map((p) => textOf(p.text));
    if (reasoningTexts.length > 0) {
      const text = clipHistoryText(reasoningTexts.join("\n"), NATIVE_HISTORY_TEXT_LIMIT);
      pushItem(turn, {
        type: "reasoning",
        id: `${msg.id}-reasoning`,
        threadId,
        turnId: turn.id,
        title: "Reasoning",
        text,
        status: "completed",
        startedAt: Math.floor(msg.createdAtMs / 1000),
        completedAt: Math.floor((msg.completedAtMs ?? msg.createdAtMs) / 1000),
      });
    }
    for (const part of msg.parts) {
      if (part.type === "subtask") {
        let childThreadId = opencodeSubtaskChildId(part as Record<string, unknown>, threadId);
        if (childThreadId) {
          usedChildSessionIds.add(childThreadId);
        } else {
          childThreadId = nextAvailableChildSessionId();
        }
        const input = (part.input && typeof part.input === "object" ? part.input : part) as JsonRecord;
        const agent = textOf(part.agent) || textOf(input.subagent_type) || "subagent";
        const prompt = textOf(part.prompt) || textOf(input.prompt);
        const description = textOf(part.description) || textOf(input.description);
        const receiverThreadIds = childThreadId ? [childThreadId] : [];
        const agentsStates = childThreadId
          ? { [childThreadId]: { status: "completed", message: description || `${agent} completed` } }
          : {};
        pushItem(turn, {
          type: "collabAgentToolCall",
          id: `opencode-subtask-${part.id}`,
          threadId,
          turnId: turn.id,
          tool: "task",
          status: "completed",
          senderThreadId: threadId,
          receiverThreadIds,
          prompt,
          agentId: childThreadId ?? String(part.id),
          ...(childThreadId ? { agentThreadId: childThreadId } : {}),
          agentName: description || agent,
          agentRole: agent,
          agentStatus: "completed",
          agentsStates,
          startedAt: Math.floor(msg.createdAtMs / 1000),
          completedAt: Math.floor((msg.completedAtMs ?? msg.createdAtMs) / 1000),
        });
        continue;
      }
      if (part.type !== "tool") continue;
      const state = (part.state ?? {}) as JsonRecord;
      const status = state.status === "completed" ? "completed" : state.status === "error" ? "failed" : "completed";
      const toolName = typeof part.tool === "string" && part.tool ? part.tool : "tool";
      if (toolName === "task") {
        let childThreadId = opencodeSubtaskChildId(part as Record<string, unknown>, threadId);
        if (childThreadId) {
          usedChildSessionIds.add(childThreadId);
        } else {
          childThreadId = nextAvailableChildSessionId();
        }
        const input = (state.input && typeof state.input === "object"
          ? state.input
          : part.input && typeof part.input === "object"
            ? part.input
            : {}) as JsonRecord;
        const agentRole = textOf(input.subagent_type)
          || textOf(input.agent)
          || textOf(part.subagent_type)
          || textOf(part.agent)
          || "subagent";
        const description = textOf(state.title)
          || textOf(input.description)
          || textOf(part.description)
          || "";
        const prompt = textOf(input.prompt) || textOf(part.prompt) || "";
        const receiverThreadIds = childThreadId ? [childThreadId] : [];
        const isFailed = state.status === "error";
        const agentStatus = isFailed ? "failed" : "completed";
        const message = isFailed
          ? String(state.error ?? description ?? `${agentRole} failed`)
          : (description || `${agentRole} completed`);
        const callId = typeof part.callID === "string" && part.callID ? part.callID : String(part.id ?? msg.id);

        pushItem(turn, {
          type: "collabAgentToolCall",
          id: `opencode-subtask-${callId}`,
          threadId,
          turnId: turn.id,
          tool: "task",
          status: isFailed ? "failed" : "completed",
          senderThreadId: threadId,
          receiverThreadIds,
          prompt,
          agentId: childThreadId ?? callId,
          ...(childThreadId ? { agentThreadId: childThreadId } : {}),
          agentName: description || agentRole,
          agentRole,
          agentStatus,
          agentsStates: childThreadId
            ? { [childThreadId]: { status: agentStatus, message } }
            : {},
          startedAt: Math.floor(msg.createdAtMs / 1000),
          completedAt: Math.floor((msg.completedAtMs ?? msg.createdAtMs) / 1000),
        });
        continue;
      }
      pushItem(turn, {
        type: "toolCall",
        id: typeof part.callID === "string" && part.callID ? part.callID : String(part.id ?? msg.id),
        threadId,
        turnId: turn.id,
        name: toolName,
        tool: toolName,
        toolName,
        input: (state.input ?? {}) as JsonValue,
        arguments: (state.input ?? {}) as JsonValue,
        output: typeof (state.output ?? state.error ?? "") === "string"
          ? clipHistoryText(String(state.output ?? state.error ?? ""), NATIVE_HISTORY_TOOL_OUTPUT_LIMIT)
          : ((state.output ?? state.error ?? "") as JsonValue),
        status,
        startedAt: Math.floor(msg.createdAtMs / 1000),
        completedAt: Math.floor((msg.completedAtMs ?? msg.createdAtMs) / 1000),
      });
    }
    if (msg.parts.some((p) => p.type === "compaction")) {
      pushItem(turn, {
        type: "contextCompaction",
        id: `${msg.id}-compaction`,
        threadId,
        turnId: turn.id,
        title: "Context compaction",
        status: "completed",
        cliBackend: "opencode",
      });
    }
    if (typeof msg.completedAtMs === "number") {
      turn.completedAt = Math.floor(msg.completedAtMs / 1000);
    }
  }
  return turns.filter((t) => t.items.length > 0);
}

export interface NativeThreadReadResult {
  thread: JsonRecord;
  items: JsonRecord[];
  tail: { truncated: boolean; loadedMessages: number; totalMessages: number };
}

/** Bounded read-only load of a native opencode session (no runtime, no subscription). */
export function readNativeOpencodeThread(
  sessionId: string,
  options?: { includeTurns?: boolean; maxMessages?: number },
): NativeThreadReadResult | null {
  const meta = getNativeOpencodeSessionMeta(sessionId);
  if (!meta) return null;
  const includeTurns = options?.includeTurns !== false;
  const maxMessages = Math.max(1, Math.min(1000, options?.maxMessages ?? NATIVE_OPENCODE_MAX_MESSAGES));

  let turns: ProjectedNativeTurn[] = [];
  let truncated = false;
  let loadedMessages = 0;
  let totalMessages = 0;
  let preview = meta.title.trim() || "OpenCode conversation";
  if (isDefaultSessionTitle(preview)) preview = "OpenCode conversation";

  if (includeTurns) {
    const db = openNativeDb(meta.dbFile);
    if (db) {
      try {
        const totalRow = get(db, "SELECT COUNT(*) AS n FROM message WHERE session_id = ?", meta.id);
        totalMessages = typeof totalRow?.n === "number" ? totalRow.n : 0;
        const loaded = loadNativeMessages(db, meta.id, maxMessages);
        truncated = loaded.truncated;
        loadedMessages = loaded.messages.length;
        const childRows = all(db, "SELECT id FROM session WHERE parent_id = ? ORDER BY time_created ASC, id ASC", meta.id);
        const childSessionIds = childRows
          .map((row) => typeof row.id === "string" ? row.id : null)
          .filter((id): id is string => Boolean(id));
        turns = projectMessagesToTurns(meta.id, loaded.messages, NATIVE_OPENCODE_MAX_ITEMS, childSessionIds);
        const firstUser = loaded.messages.find((m) => m.role === "user");
        if (firstUser) {
          const firstText = firstUser.parts.find((p) => p.type === "text" && textOf(p.text).trim());
          const candidate = firstText ? textOf(firstText.text).trim().slice(0, 100) : "";
          if (candidate) preview = candidate;
          else if (meta.title.trim()) preview = meta.title.trim().slice(0, 100);
        } else if (meta.title.trim()) {
          preview = meta.title.trim().slice(0, 100);
        }
      } catch {
        // Corrupt/locked rows must not break history loading: fall back to
        // metadata-only below.
        turns = [];
        truncated = false;
        loadedMessages = 0;
      } finally {
        closeQuiet(db);
      }
    }
  }

  const items = turns.flatMap((t) => t.items.map((item) => ({ ...item, turnId: t.id })));
  const hasCustomTitle = !isDefaultSessionTitle(meta.title);
  const customTitle = hasCustomTitle && meta.title.trim() ? meta.title.trim() : null;
  return {
    thread: {
      id: meta.id,
      sessionId: meta.id,
      parentThreadId: meta.parentId,
      name: customTitle,
      title: customTitle,
      agentRole: meta.agent ?? undefined,
      agentNickname: customTitle ?? (meta.agent ? `@${meta.agent}` : undefined),
      preview,
      model: meta.model,
      cliBackend: "opencode",
      status: { type: "idle" },
      cwd: meta.directory,
      createdAt: Math.floor(meta.createdAtMs / 1000),
      updatedAt: Math.floor(meta.updatedAtMs / 1000),
      turns,
      messages: items,
      // Native sessions expose turn-boundary pagination through
      // listNativeOpencodeTurns, so history opens take the paginated
      // path (newest 32-turn page) instead of the legacy full-read/tail
      // path. fileInfo/tail stay available as a fallback but the web
      // client no longer routes native opens through them.
      historyMode: "paginated",
      native: true,
    },
    items,
    tail: { truncated, loadedMessages, totalMessages },
  };
}

export interface NativeTurnsPage {
  turns: ProjectedNativeTurn[];
  data: ProjectedNativeTurn[];
  nextCursor: string | null;
}

/** Paginated read-only turns for a native session (workbench history pages). */
export function listNativeOpencodeTurns(
  sessionId: string,
  options?: { limit?: number; cursor?: string | null; sortDirection?: string; itemsView?: string; maxMessages?: number },
): NativeTurnsPage | null {
  // Turn-boundary pagination: accumulate newest-first message batches until
  // the requested page (limit + 1 probe turn) is covered, instead of
  // projecting a fixed ~100-message window on every page turn. A 32-turn
  // first page on a long session typically reads one 32-message batch
  // instead of ~100 messages + all of their parts.
  const limit = Math.max(1, Math.min(100, options?.limit ?? 32));
  const needTurns = limit + 1;
  const maxScanMessages = typeof options?.maxMessages === "number"
    ? Math.max(1, Math.min(1000, options.maxMessages))
    : NATIVE_OPENCODE_MAX_MESSAGES;
  const meta = getNativeOpencodeSessionMeta(sessionId);
  if (!meta) return null;
  const db = openNativeDb(meta.dbFile);
  if (!db) return null;
  try {
    let before: { timeCreated: number; id: string } | null = null;
    const cursor = typeof options?.cursor === "string" && options.cursor ? options.cursor : null;
    if (cursor) {
      const messageId = cursorMessageId(cursor);
      if (messageId) {
        const row = get(db, "SELECT time_created FROM message WHERE session_id = ? AND id = ? LIMIT 1", meta.id, messageId);
        if (row && typeof row.time_created === "number") {
          before = { timeCreated: row.time_created, id: messageId };
        } else {
          // Unknown cursor (session rewritten): degrade to the newest page
          // rather than failing the history open.
          before = null;
        }
      }
    }
    const childRows = all(db, "SELECT id FROM session WHERE parent_id = ? ORDER BY time_created ASC, id ASC", meta.id);
    const childSessionIds = childRows
      .map((row) => typeof row.id === "string" ? row.id : null)
      .filter((id): id is string => Boolean(id));
    const accumulated: NativeMessageRow[] = [];
    const seen = new Set<string>();
    const partsByMessageId = new Map<string, JsonRecord[]>();
    let scanned = 0;
    let turns: ProjectedNativeTurn[] = [];
    const batchSize = Math.max(16, Math.min(64, needTurns));
    // A single giant turn (hundreds of tool messages without a user
    // boundary) can never satisfy the turn probe: stop scanning once the
    // accumulated window is well past the requested page instead of
    // dragging the full 1000-message budget on every page turn.
    const singleTurnScanCap = Math.max(200, needTurns * 4);
    while (turns.length < needTurns && scanned < maxScanMessages && accumulated.length < singleTurnScanCap) {
      const batch = loadNativeMessageBatch(db, meta.id, before, batchSize);
      if (batch.length === 0) break;
      const oldest = batch[0]!;
      before = oldest.timeCreated !== null
        ? { timeCreated: oldest.timeCreated, id: oldest.id }
        : before;
      const fresh: NativeMessageRow[] = [];
      for (const row of batch) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        accumulated.push(row);
        fresh.push(row);
      }
      scanned += batch.length;
      // Batches never overlap (strict message cursor), so fresh parts can
      // be merged directly; repeated rounds never re-query the window.
      for (const [messageId, parts] of loadBatchParts(db, fresh)) {
        partsByMessageId.set(messageId, parts);
      }
      if (oldest.timeCreated === null) break;
      const ordered = [...accumulated].sort((a, b) => {
        const ta = a.timeCreated ?? 0;
        const tb = b.timeCreated ?? 0;
        return ta !== tb ? ta - tb : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
      turns = projectMessagesToTurns(meta.id, assembleNativeMessages(ordered, partsByMessageId), NATIVE_OPENCODE_MAX_ITEMS, childSessionIds);
    }
    const desc = (options?.sortDirection ?? "desc").toLowerCase() !== "asc";
    turns.sort((a, b) => (desc ? (b.startedAt ?? 0) - (a.startedAt ?? 0) : (a.startedAt ?? 0) - (b.startedAt ?? 0)));
    const page = turns.slice(0, limit);
    const nextCursor = turns.length > page.length ? page[page.length - 1]?.id ?? null : null;
    const summarize = (options?.itemsView ?? "summary").toLowerCase() !== "full";
    const mapped = page.map((turn) => {
      if (!summarize) return turn;
      const items = Array.isArray(turn.items) ? turn.items : [];
      const user = items.find((item) => String((item as JsonRecord).type) === "userMessage");
      const assistant = [...items].reverse().find((item) => String((item as JsonRecord).type) === "agentMessage");
      const summaryItems = user && assistant && user !== assistant ? [user, assistant] : user ? [user] : assistant ? [assistant] : [];
      return { ...turn, items: summaryItems, itemsView: "summary" };
    });
    return { turns: mapped, data: mapped, nextCursor };
  } finally {
    closeQuiet(db);
  }
}

/**
 * Turn ids embed their head message id (`opencode-native-<msgId>`), so a
 * page cursor doubles as a message cursor for turn-boundary fetching.
 */
function cursorMessageId(cursor: string): string | null {
  const prefixes = ["opencode-native-recovered-", "opencode-native-"];
  for (const prefix of prefixes) {
    if (cursor.startsWith(prefix) && cursor.length > prefix.length) return cursor.slice(prefix.length);
  }
  return null;
}

/** Virtual file info for a native session (DB path + size, mirroring Codex fileInfo). */
export function nativeOpencodeFileInfo(sessionId: string): { path: string; sizeBytes: number; sessionId: string } | null {
  const meta = getNativeOpencodeSessionMeta(sessionId);
  if (!meta) return null;
  try {
    const info = statSync(meta.dbFile);
    return { path: meta.dbFile, sizeBytes: info.size, sessionId: meta.id };
  } catch {
    return { path: meta.dbFile, sizeBytes: 0, sessionId: meta.id };
  }
}

/** Bounded tail projection for a native session (mirrors Codex history tail). */
export function readNativeOpencodeTail(
  sessionId: string,
  options?: { maxMessages?: number },
): ({ thread: JsonRecord; tail: JsonRecord } | null) {
  const read = readNativeOpencodeThread(sessionId, { includeTurns: true, maxMessages: options?.maxMessages });
  if (!read) return null;
  const info = nativeOpencodeFileInfo(sessionId);
  const turns = (read.thread.turns ?? []) as ProjectedNativeTurn[];
  return {
    thread: { ...read.thread, turns },
    tail: {
      truncated: read.tail.truncated,
      loadedMessages: read.tail.loadedMessages,
      totalMessages: read.tail.totalMessages,
      sizeBytes: info?.sizeBytes ?? 0,
      backend: "opencode-native",
    },
  };
}
