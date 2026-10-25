import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MiniSessionStore } from "./miniSessionStore.js";

/**
 * File-based mini-agent history. One markdown file per thread, no database:
 *
 *   <dataDir>/mini-agent/<threadId>.md
 *
 * dataDir is `CODEX_UI_DATA_DIR` when set, otherwise `~/.codex-ultra`
 * (same convention as the rest of the service). Tests/isolated runs can
 * point `MINI_HISTORY_DIR` at a scratch directory.
 *
 * Layout per file:
 *   ---            frontmatter (flat `key: value`, JSON-quoted strings)
 *   # <title>      human-readable transcript (truncated tool outputs)
 *   <!--mini-state lossless machine snapshot (the ONLY source of truth
 *   {...}        for resume/turns/list; frontmatter is regenerated from it)
 *   -->
 *
 * All methods are synchronous on purpose: MiniBridge calls onSnapshot /
 * loadSnapshot synchronously (the old SQLite store was sync too), so async
 * writes would open a crash window between `turn/completed` and flush.
 * Local-disk single-file writes cost ~1ms; ordering stays exact.
 *
 * This replaces MiniSessionStore for mini threads. SQLite rows left over
 * from previous versions are imported lazily on first read, then deleted.
 */

export interface MiniHistorySnapshot {
  threadId: string;
  ownerId?: string;
  cwd: string;
  additionalRoots?: string[];
  model?: string;
  providerId?: string;
  groupId?: string;
  preview?: string;
  /** User-set custom title (thread/name/set). Listing/H1 prefer it over preview. */
  name?: string;
  effort?: string;
  createdAt?: number;
  lastUsedTokens?: number;
  lastContextWindow?: number;
  lastAutoCompactAt?: number;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: unknown[];
  parentThreadId?: string;
  depth?: number;
  taskName?: string;
  agentType?: string;
  subStatus?: string;
  finalReport?: string;
  /** Hidden from thread lists but still openable (thread/archive). */
  archived?: boolean;
  /** Codex `sandbox` / `approvalPolicy` contract (minimal: read-only enforced). */
  sandbox?: string;
  approvalPolicy?: string;
  goalObjective?: string | null;
  goalStatus?: string | null;
  goalTokenBudget?: number | null;
  goalTokensUsed?: number;
  goalStartedAt?: number;
  goalLastFingerprint?: string;
  goalStagnantTurns?: number;
  goalRecentToolFingerprints?: string[];
}

export interface MiniHistoryRecord {
  threadId: string;
  ownerId: string;
  model: string | null;
  cwd: string | null;
  /** Lossless snapshot JSON (same shape MiniSessionStore.stateJson used to hold). */
  stateJson: string | null;
  createdAt: number;
  updatedAt: number;
}

export function resolveMiniHistoryDir(): string {
  const override = process.env.MINI_HISTORY_DIR?.trim();
  if (override) return override;
  const miniHome = (process.env.MINI_AGENT_HOME ?? process.env.MINI_HOME ?? "").trim();
  if (miniHome) return join(miniHome, "history");
  const dataDir = process.env.CODEX_UI_DATA_DIR?.trim() || join(homedir(), ".codex-ultra");
  return join(dataDir, "mini-agent");
}

function assertSafeThreadId(threadId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) throw new Error(`invalid mini thread id: ${String(threadId).slice(0, 64)}`);
}

function oneLine(v: unknown, max = 120): string {
  return String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** Flat frontmatter writer: strings JSON-quoted (valid YAML), numbers bare. */
function stringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
  if (typeof v === "string") { try { return stringArray(JSON.parse(v)); } catch { return undefined; } }
  return undefined;
}

function renderFrontmatter(fields: Array<[string, string | number | undefined]>): string {
  const lines = ["---"];
  for (const [key, value] of fields) {
    if (value === undefined) continue;
    lines.push(typeof value === "number" ? `${key}: ${value}` : `${key}: ${JSON.stringify(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/** Parse the flat frontmatter this module writes (liberal reader). */
export function parseMiniFrontmatter(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return out;
  for (const line of match[1]!.split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) continue;
    const raw = line.slice(sep + 1).trim();
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      out[key] = parsed;
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

const STATE_OPEN = "<!--mini-state";
const STATE_CLOSE = "-->";

export function extractMiniStateJson(text: string): string | null {
  const start = text.indexOf(STATE_OPEN);
  if (start < 0) return null;
  const bodyStart = start + STATE_OPEN.length;
  // Collect every closer and try from LAST to FIRST: message text may itself
  // contain "-->" (HTML comments, CLI output), which used to truncate the
  // payload at the first closer and silently drop the whole snapshot.
  // Well-formed files have exactly one closer, so behavior there is unchanged.
  const closers: number[] = [];
  let from = bodyStart;
  for (;;) {
    const end = text.indexOf(STATE_CLOSE, from);
    if (end < 0) break;
    closers.push(end);
    from = end + STATE_CLOSE.length;
  }
  for (let i = closers.length - 1; i >= 0; i--) {
    const payload = text.slice(bodyStart, closers[i]).trim();
    if (!payload.startsWith("{")) continue;
    try {
      JSON.parse(payload);
      return payload;
    } catch {
      // Try an earlier closer.
    }
  }
  return null;
}

function fence(s: unknown): string {
  const body = String(s ?? "");
  // Guard against hostile content breaking the markdown structure.
  return body.includes("```") ? body.split("```").join("'''") : body;
}

function renderTranscript(snap: MiniHistorySnapshot): string {
  const lines: string[] = [];
  const title = oneLine(snap.name) || oneLine(snap.preview) || "Mini conversation";
  lines.push(`# ${title}`, "");
  const turnById = new Map((snap.turns ?? []).map((t) => [t.id, t]));
  const messages = Array.isArray(snap.messages) ? snap.messages : [];
  let lastTurn = "";
  for (const raw of messages) {
    const m = asRecord(raw);
    const type = String(m.type ?? "");
    const turnId = typeof m.turnId === "string" ? m.turnId : "";
    if (turnId && turnId !== lastTurn) {
      lastTurn = turnId;
      const turn = turnById.get(turnId);
      const when = turn ? new Date(turn.createdAt).toISOString() : "";
      lines.push(`## Turn ${turnId.slice(0, 8)}${turn ? ` (${turn.status}${when ? `, ${when}` : ""})` : ""}`, "");
    }
    if (type === "userMessage") {
      lines.push("### User", "", fence(m.text), "");
    } else if (type === "agentMessage") {
      lines.push("### Assistant", "", fence(m.text), "");
    } else if (type === "reasoning") {
      const text = oneLine(m.text, 2000);
      if (text) lines.push("### Thinking", "", fence(text), "");
    } else if (type === "toolCall") {
      lines.push(`### Tool: ${oneLine(m.name) || "tool"}`, "");
      const args = oneLine(m.arguments, 1000);
      if (args) lines.push("```json", fence(args), "```", "");
      const output = String(m.output ?? "").slice(0, 2000);
      if (output) lines.push("```", fence(output), "```", "");
    } else if (type === "imageView") {
      const p = oneLine(m.path, 300);
      if (p) lines.push(`Viewed image: \`${p}\``, "");
    } else if (type === "plan") {
      const plan = Array.isArray(m.plan) ? m.plan : [];
      if (plan.length) {
        lines.push("### Plan", "");
        for (const entry of plan) {
          const e = asRecord(entry);
          const done = String(e.status ?? "") === "completed";
          lines.push(`- [${done ? "x" : " "}] ${oneLine(e.step ?? e.text, 200)}`);
        }
        lines.push("");
      }
    } else if (type === "goalContinuation" || (type === "userMessage" && String(m.text ?? "").includes("[[codex-ultra:goal-continuation]]"))) {
      // Internal /goal nudge: one line in the human transcript (the lossless
      // state block below retains the full prompt for resume).
      const firstLine = String(m.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean)[1] ?? "goal continuation";
      lines.push(`*${oneLine(firstLine, 200)}*`, "");
    } else if (type === "compaction" || type === "contextCompaction") {
      lines.push(`*${oneLine(m.text ?? m.title ?? "Context compaction", 200)}*`, "");
    } else if (type === "error") {
      lines.push(`**Error:** ${oneLine(m.text, 500)}`, "");
    }
  }
  if (lines.length <= 2) lines.push("_No messages yet._", "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function renderMiniHistoryFile(snap: MiniHistorySnapshot, createdAt: number, updatedAt: number): string {
  const head = renderFrontmatter([
    ["thread", snap.threadId],
    ["owner", snap.ownerId ?? "local"],
    ["model", str(snap.model)],
    ["provider", str(snap.providerId)],
    ["group", str(snap.groupId)],
    ["effort", str(snap.effort)],
    ["cwd", str(snap.cwd)],
    ["additional_roots", Array.isArray(snap.additionalRoots) ? JSON.stringify(snap.additionalRoots) : undefined],
    ["name", str(snap.name)],
    ["preview", oneLine(snap.preview) || "Mini conversation"],
    ["created", createdAt],
    ["updated", updatedAt],
    ["used", typeof snap.lastUsedTokens === "number" ? Math.round(snap.lastUsedTokens) : undefined],
    ["window", typeof snap.lastContextWindow === "number" ? Math.round(snap.lastContextWindow) : undefined],
    ["parent", str(snap.parentThreadId)],
    ["depth", typeof snap.depth === "number" ? snap.depth : undefined],
    ["task", str(snap.taskName)],
    ["agent", str(snap.agentType)],
    ["status", str(snap.subStatus)],
    ["archived", snap.archived ? 1 : undefined],
    ["sandbox", str(snap.sandbox)],
    ["approval", str(snap.approvalPolicy)],
    ["turns", Array.isArray(snap.turns) ? snap.turns.length : 0],
  ]);
  // Escape "-->" inside the payload: the state block is delimited by HTML
  // comment markers, and message text (HTML comments, CLI output) may contain
  // them. "\u003e" decodes back to ">" under JSON.parse, so the round-trip is
  // lossless; "-->" can never appear structurally in JSON outside strings.
  const state = JSON.stringify(snap).replaceAll("-->", "--\\u003e");
  return `${head}\n\n${renderTranscript(snap)}\n${STATE_OPEN}\n${state}\n${STATE_CLOSE}\n`;
}

/** Listing/H1 title: user rename wins, then auto preview, then first message. */
export function miniHistoryDisplayTitle(snap: Record<string, unknown>, firstUserText?: string): string {
  const name = oneLine(asRecord(snap).name);
  if (name) return name;
  const preview = oneLine(asRecord(snap).preview);
  if (preview) return preview;
  const first = oneLine(firstUserText, 80);
  if (first) return first;
  return "Mini conversation";
}

function recordFromSnapshot(snap: MiniHistorySnapshot, createdAt: number, updatedAt: number): MiniHistoryRecord {
  return {
    threadId: snap.threadId,
    ownerId: snap.ownerId ?? "local",
    model: snap.model ?? null,
    cwd: snap.cwd ?? null,
    stateJson: JSON.stringify(snap),
    createdAt,
    updatedAt,
  };
}

export class MiniFileHistory {
  constructor(private readonly dir?: string) {}

  baseDir(): string {
    return this.dir ?? resolveMiniHistoryDir();
  }

  private filePath(threadId: string): string {
    assertSafeThreadId(threadId);
    return join(this.baseDir(), `${threadId}.md`);
  }

  private ownerFilePath(threadId: string, ownerId: string): string {
    assertSafeThreadId(threadId);
    return join(this.baseDir(), `${threadId}.${encodeURIComponent(ownerId)}.md`);
  }

  private readRecord(threadId: string, ownerId?: string): MiniHistoryRecord | null {
    let text = "";
    const paths = ownerId && ownerId !== "local"
      ? [this.ownerFilePath(threadId, ownerId), this.filePath(threadId)]
      : [this.filePath(threadId)];
    for (const path of paths) {
      try {
        text = readFileSync(path, "utf8");
        break;
      } catch {
        text = "";
      }
    }
    if (!text) return null;
    const stateJson = extractMiniStateJson(text);
    const fm = parseMiniFrontmatter(text);
    let snap: MiniHistorySnapshot | null = null;
    if (stateJson) {
      try {
        snap = JSON.parse(stateJson) as MiniHistorySnapshot;
      } catch {
        snap = null;
      }
    }
    const fmOwner = typeof fm.owner === "string" ? fm.owner : undefined;
    const isLocalRecord = fmOwner === "local" || snap?.ownerId === "local" || (!fmOwner && !snap?.ownerId);
    if (ownerId && fmOwner && fmOwner !== ownerId && snap?.ownerId !== ownerId && !(ownerId !== "local" && isLocalRecord)) return null;
    const createdAt = typeof fm.created === "number" ? fm.created : Date.now();
    const updatedAt = typeof fm.updated === "number" ? fm.updated : Date.now();
    if (!snap) {
      // Hand-written file without a state block: rebuild a minimal snapshot
      // from frontmatter so resume paths keep working.
      snap = {
        threadId,
        ownerId: fmOwner ?? ownerId ?? "local",
        cwd: typeof fm.cwd === "string" ? fm.cwd : "",
        additionalRoots: stringArray(fm.additional_roots),
         model: typeof fm.model === "string" ? fm.model : undefined,
        providerId: typeof fm.provider === "string" ? fm.provider : undefined,
        groupId: typeof fm.group === "string" ? fm.group : undefined,
        effort: typeof fm.effort === "string" ? fm.effort : undefined,
        name: typeof fm.name === "string" && fm.name ? fm.name : undefined,
        preview: typeof fm.preview === "string" ? fm.preview : undefined,
        turns: [],
        messages: [],
        parentThreadId: typeof fm.parent === "string" && fm.parent ? fm.parent : undefined,
        archived: fm.archived === 1 || fm.archived === true ? true : undefined,
        sandbox: typeof fm.sandbox === "string" && fm.sandbox ? fm.sandbox : undefined,
        approvalPolicy: typeof fm.approval === "string" && fm.approval ? fm.approval : undefined,
      };
      return { ...recordFromSnapshot(snap, createdAt, updatedAt), stateJson: JSON.stringify(snap) };
    }
    if (!snap.ownerId) snap.ownerId = fmOwner ?? ownerId ?? "local";
    return { ...recordFromSnapshot(snap, createdAt, updatedAt), stateJson: JSON.stringify(snap) };
  }

  upsert(input: {
    threadId: string;
    ownerId: string;
    model?: string | null;
    cwd?: string | null;
    snapshot: MiniHistorySnapshot;
  }): MiniHistoryRecord {
    assertSafeThreadId(input.threadId);
    mkdirSync(this.baseDir(), { recursive: true });
    const snap: MiniHistorySnapshot = {
      ...input.snapshot,
      threadId: input.threadId,
      ownerId: input.ownerId,
      model: input.model ?? input.snapshot.model,
      cwd: input.cwd ?? input.snapshot.cwd,
    };
    let prev: MiniHistoryRecord | null = null;
    try {
      prev = this.readRecord(input.threadId);
    } catch {
      prev = null;
    }
    const createdAt = prev?.createdAt
      ?? (typeof snap.createdAt === "number" ? snap.createdAt : undefined)
      ?? (snap.turns?.[0]?.createdAt)
      ?? Date.now();
    snap.createdAt = createdAt;
    const updatedAt = Date.now();
    const text = renderMiniHistoryFile(snap, createdAt, updatedAt);
    // Atomic write: tmp file + rename in the same directory.
    const target = input.ownerId === "local" ? this.filePath(input.threadId) : this.ownerFilePath(input.threadId, input.ownerId);
    const tmp = join(this.baseDir(), `.${input.threadId}.${randomUUID()}.tmp`);
    try {
      writeFileSync(tmp, text, "utf8");
      renameSync(tmp, target);
    } catch (e) {
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
      throw e;
    }
    return recordFromSnapshot(snap, createdAt, updatedAt);
  }

  get(ownerId: string, threadId: string): MiniHistoryRecord | null {
    try {
      return this.readRecord(threadId, ownerId)
        ?? (ownerId !== "local" ? this.readRecord(threadId, "local") : null);
    } catch {
      return null;
    }
  }

  getMetadata(ownerId: string, threadId: string): Omit<MiniHistorySnapshot, "turns" | "messages"> | null {
    const paths = ownerId !== "local"
      ? [this.ownerFilePath(threadId, ownerId), this.filePath(threadId)]
      : [this.filePath(threadId)];
    for (const path of paths) {
      let fd: number | undefined;
      try {
        fd = openSync(path, "r");
        const buffer = Buffer.alloc(16 * 1024);
        const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
        const fm = parseMiniFrontmatter(buffer.toString("utf8", 0, bytesRead));
        if (!Object.keys(fm).length) continue;
        // Legacy `local` history stays visible to authenticated members, mirroring
        // exists()/listByOwner()/listForOwner(). Explicitly-owned foreign records
        // remain restricted to their owner.
        if (typeof fm.owner === "string" && fm.owner !== ownerId && !(ownerId !== "local" && fm.owner === "local")) return null;
        return {
          threadId,
          ownerId: typeof fm.owner === "string" ? fm.owner : ownerId,
          cwd: typeof fm.cwd === "string" ? fm.cwd : "",
          model: typeof fm.model === "string" ? fm.model : undefined,
          providerId: typeof fm.provider === "string" ? fm.provider : undefined,
          groupId: typeof fm.group === "string" ? fm.group : undefined,
          effort: typeof fm.effort === "string" ? fm.effort : undefined,
          name: typeof fm.name === "string" ? fm.name : undefined,
          preview: typeof fm.preview === "string" ? fm.preview : undefined,
          additionalRoots: stringArray(fm.additional_roots),
          parentThreadId: typeof fm.parent === "string" ? fm.parent : undefined,
          depth: typeof fm.depth === "number" ? fm.depth : undefined,
          taskName: typeof fm.task === "string" ? fm.task : undefined,
          agentType: typeof fm.agent === "string" ? fm.agent : undefined,
          subStatus: typeof fm.status === "string" ? fm.status : undefined,
          archived: fm.archived === 1 || fm.archived === true ? true : undefined,
          sandbox: typeof fm.sandbox === "string" && fm.sandbox ? fm.sandbox : undefined,
          approvalPolicy: typeof fm.approval === "string" && fm.approval ? fm.approval : undefined,
        };
      } catch {
        continue;
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }
    return null;
  }

  findByThreadId(threadId: string): MiniHistoryRecord | null {
    try {
      const legacy = this.readRecord(threadId);
      if (legacy) return legacy;
      const names = readdirSync(this.baseDir());
      const candidate = names.find((name) => name.startsWith(`${threadId}.`) && name.endsWith(".md"));
      if (!candidate) return null;
      const owner = parseMiniFrontmatter(readFileSync(join(this.baseDir(), candidate), "utf8")).owner;
      return typeof owner === "string" ? this.readRecord(threadId, owner) : null;
    } catch {
      return null;
    }
  }

  /** Cheap routing check: file exists and belongs to the owner (or is unowned). */
  exists(ownerId: string, threadId: string): boolean {
    let head = "";
    try {
      const ownedPath = ownerId === "local" ? this.filePath(threadId) : this.ownerFilePath(threadId, ownerId);
      const full = readFileSync(ownedPath, "utf8");
      const end = full.indexOf("\n---", 3);
      head = end > 0 ? full.slice(0, end + 4) : full.slice(0, 4096);
    } catch {
      if (ownerId === "local") return false;
      try {
        const full = readFileSync(this.filePath(threadId), "utf8");
        const end = full.indexOf("\n---", 3);
        head = end > 0 ? full.slice(0, end + 4) : full.slice(0, 4096);
      } catch {
        return false;
      }
    }
    const fm = parseMiniFrontmatter(head);
    const fmOwner = typeof fm.owner === "string" ? fm.owner : undefined;
    // Legacy `local` history is intentionally visible to authenticated users;
    // explicitly-owned records remain restricted to their owner.
    return !fmOwner || fmOwner === ownerId || (ownerId !== "local" && fmOwner === "local");
  }

  listByOwner(ownerId: string): MiniHistoryRecord[] {
    let names: string[];
    try {
      names = readdirSync(this.baseDir());
    } catch {
      return [];
    }
    const out: MiniHistoryRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      const legacy = /^([A-Za-z0-9_-]{1,128})\.md$/.exec(name);
      const owned = /^([A-Za-z0-9_-]{1,128})\.(.+)\.md$/.exec(name);
      const threadId = legacy?.[1] ?? owned?.[1] ?? "";
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) continue;
      // Frontmatter-only prefilter; full parse only for owned threads.
      let head = "";
      try {
        const full = readFileSync(join(this.baseDir(), name), "utf8");
        const end = full.indexOf("\n---", 3);
        head = end > 0 ? full.slice(0, end + 4) : full.slice(0, 4096);
      } catch {
        continue;
      }
      const fm = parseMiniFrontmatter(head);
      // Archived threads stay openable via thread/read but never surface in lists.
      if (fm.archived === 1 || fm.archived === true) continue;
      const fmOwner = typeof fm.owner === "string" ? fm.owner : "local";
      if (fmOwner !== ownerId && !(ownerId !== "local" && fmOwner === "local")) continue;
      let rec: MiniHistoryRecord | null = null;
      try {
        rec = this.readRecord(threadId, fmOwner);
      } catch {
        rec = null;
      }
      if (rec) out.push(rec);
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  /**
   * List history visible to an authenticated workbench owner.
   *
   * Older Mini threads were persisted before owner propagation was added and
   * therefore belong to the shared `local` owner. Keep those threads visible
   * after login while preferring the explicitly-owned record on id collisions.
   */
  listForOwner(ownerId: string): MiniHistoryRecord[] {
    if (ownerId === "local") return this.listByOwner("local");
    const records = [...this.listByOwner(ownerId), ...this.listByOwner("local")];
    const seen = new Set<string>();
    return records.filter((record) => {
      if (seen.has(record.threadId)) return false;
      seen.add(record.threadId);
      return true;
    });
  }

  delete(ownerId: string, threadId: string): boolean {
    try {
      const rec = this.readRecord(threadId, ownerId);
      if (!rec) return false;
      const target = ownerId === "local" ? this.filePath(threadId) : this.ownerFilePath(threadId, ownerId);
      rmSync(target, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Flip the archived flag in place (frontmatter + state block), preserving
   * the owner file placement. Archived threads stay openable via
   * thread/read but are excluded from every list path.
   */
  setArchived(ownerId: string, threadId: string, archived: boolean): boolean {
    assertSafeThreadId(threadId);
    try {
      const ownedPath = ownerId === "local" ? this.filePath(threadId) : this.ownerFilePath(threadId, ownerId);
      let target = ownedPath;
      let text = "";
      try {
        text = readFileSync(ownedPath, "utf8");
      } catch {
        if (ownerId === "local") return false;
        try {
          text = readFileSync(this.filePath(threadId), "utf8");
          target = this.filePath(threadId);
        } catch {
          return false;
        }
      }
      if (!text) return false;
      const fm = parseMiniFrontmatter(text);
      const fmOwner = typeof fm.owner === "string" ? fm.owner : undefined;
      if (ownerId !== "local" && fmOwner && fmOwner !== ownerId) return false;
      const createdAt = typeof fm.created === "number" ? fm.created : Date.now();
      const stateJson = extractMiniStateJson(text);
      let snap: MiniHistorySnapshot;
      if (stateJson) {
        try {
          snap = JSON.parse(stateJson) as MiniHistorySnapshot;
        } catch {
          return false;
        }
      } else {
        const rec = this.readRecord(threadId, ownerId);
        if (!rec?.stateJson) return false;
        try {
          snap = JSON.parse(rec.stateJson) as MiniHistorySnapshot;
        } catch {
          return false;
        }
      }
      if (archived) snap.archived = true;
      else delete snap.archived;
      const next = renderMiniHistoryFile(snap, createdAt, Date.now());
      const tmp = join(this.baseDir(), `.${threadId}.${randomUUID()}.tmp`);
      try {
        writeFileSync(tmp, next, "utf8");
        renameSync(tmp, target);
      } catch {
        try {
          rmSync(tmp, { force: true });
        } catch {
          /* ignore */
        }
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Delete a thread plus every sub-agent child file, regardless of owner. */
  deleteTree(threadId: string): string[] {
    const deleted: string[] = [];
    assertSafeThreadId(threadId);
    let names: string[];
    try {
      names = readdirSync(this.baseDir());
    } catch {
      return deleted;
    }
    const targets = new Set<string>([threadId]);
    // Children reference the parent id in frontmatter; one scan is enough
    // because mini depth is capped at 1 (no grandchildren).
    const parents = new Map<string, string>();
    const filesByThread = new Map<string, string[]>();
    for (const name of names) {
      // Thread ids never contain dots, so `<id>.md` is legacy/local while
      // `<id>.<encoded-owner>.md` is an explicitly-owned record. The owner
      // segment uses `(.+)` (not `([^.]*)`) because encodeURIComponent keeps
      // dots verbatim and owner ids may themselves contain dots.
      if (!name.endsWith(".md")) continue;
      const legacy = /^([A-Za-z0-9_-]{1,128})\.md$/.exec(name);
      const owned = legacy ? null : /^([A-Za-z0-9_-]{1,128})\.(.+)\.md$/.exec(name);
      const id = legacy?.[1] ?? owned?.[1] ?? null;
      if (!id) continue;
      const list = filesByThread.get(id);
      if (list) list.push(name);
      else filesByThread.set(id, [name]);
      try {
        const full = readFileSync(join(this.baseDir(), name), "utf8");
        const end = full.indexOf("\n---", 3);
        const fm = parseMiniFrontmatter(end > 0 ? full.slice(0, end + 4) : full.slice(0, 4096));
        if (typeof fm.parent === "string" && fm.parent && !parents.has(id)) parents.set(id, fm.parent);
      } catch {
        continue;
      }
    }
    for (const [id, parent] of parents) {
      if (parent === threadId) targets.add(id);
    }
    for (const id of targets) {
      const files = filesByThread.get(id) ?? [`${id}.md`];
      for (const name of files) {
        try {
          rmSync(join(this.baseDir(), name), { force: true });
        } catch {
          continue;
        }
      }
      deleted.push(id);
    }
    return deleted;
  }

  /**
   * One-time lazy migration for pre-file SQLite rows. Returns the imported
   * record, or null when there is nothing to import. Callers delete the
   * SQLite row afterwards; afterwards the file is the only copy.
   */
  importSqliteRow(row: {
    threadId: string;
    ownerId: string;
    model?: string | null;
    cwd?: string | null;
    stateJson?: string | null;
    createdAt?: number;
  }): MiniHistoryRecord | null {
    assertSafeThreadId(row.threadId);
    let existing: MiniHistoryRecord | null = null;
    try {
      existing = this.readRecord(row.threadId);
    } catch {
      existing = null;
    }
    if (existing) return null;
    let snap: MiniHistorySnapshot | null = null;
    if (row.stateJson) {
      try {
        snap = JSON.parse(row.stateJson) as MiniHistorySnapshot;
      } catch {
        snap = null;
      }
    }
    const now = Date.now();
    const fallback: MiniHistorySnapshot = {
      threadId: row.threadId,
      ownerId: row.ownerId,
      cwd: row.cwd ?? "",
      model: row.model ?? undefined,
      turns: [],
      messages: [],
    };
    const merged: MiniHistorySnapshot = { ...fallback, ...(snap ?? {}) };
    merged.threadId = row.threadId;
    merged.ownerId = row.ownerId;
    if (row.model) merged.model = row.model;
    if (row.cwd) merged.cwd = row.cwd;
    mkdirSync(this.baseDir(), { recursive: true });
    const createdAt = typeof row.createdAt === "number" ? row.createdAt : now;
    const text = renderMiniHistoryFile(merged, createdAt, now);
    const tmp = join(this.baseDir(), `.${row.threadId}.${randomUUID()}.tmp`);
    try {
      writeFileSync(tmp, text, "utf8");
      renameSync(tmp, this.filePath(row.threadId));
    } catch (e) {
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
      throw e;
    }
    return recordFromSnapshot(merged, createdAt, now);
  }
}

export interface MiniBackendRouteOptions {
  paramCliBackend?: string;
  storedCliBackend?: string;
  threadId?: string | null;
  ownerId: string;
  historyExists: (ownerId: string, threadId: string) => boolean;
  hasSession: (threadId: string, ownerId: string) => boolean;
}

/**
 * Mini reopen routing decision (pure, unit-tested).
 *
 * History files are the authoritative record of a mini thread, but reopen
 * routing historically trusted only `thread_runtime_metadata.cli_backend`
 * (persisted at thread/start). Threads created before that persistence (or
 * mislabeled `codex` by the generic fallback) have a history file but no
 * usable metadata, so reopening them misrouted to the Codex app-server and
 * failed with `thread not found`.
 *
 * The file check is authoritative: Codex/native threads never have a
 * `<dataDir>/mini-agent/<threadId>.md` record, and `historyExists` also
 * verifies the owner. Explicit non-codex backends (claude/agy/...) still win
 * so this fallback can never hijack another backend's thread.
 *
 * An explicit `codex` request always wins over a live Mini session or a
 * Mini history file: otherwise a codex thread that was once mis-created on
 * the fallback Mini bridge sticks to Mini forever even though both the UI
 * and the persisted metadata say `codex`. Legacy orphan Mini threads reopen
 * with no explicit param (or with `mini` after heal), so they still route
 * to Mini.
 */
export function shouldRouteToMiniBackend(options: MiniBackendRouteOptions): boolean {
  const { paramCliBackend, storedCliBackend, threadId, ownerId, historyExists, hasSession } = options;
  if (paramCliBackend === "mini") return true;
  // Explicit backend selection wins over session/file heuristics. Any
  // explicit non-empty, non-mini backend (codex/claude/agy/grok/pi/opencode/...)
  // must never be hijacked by a Mini session or history file.
  if (paramCliBackend !== undefined && paramCliBackend !== "" && paramCliBackend !== "mini") return false;
  if (!threadId) return false;
  // A stored `codex` value may be a generic-fallback mislabel (the history
  // file is authoritative: native Codex threads never have one), so only
  // explicit foreign backends win over the session/file heuristics here.
  if (storedCliBackend !== undefined && storedCliBackend !== "" && storedCliBackend !== "mini" && storedCliBackend !== "codex") return false;
  if (hasSession(threadId, ownerId)) return true;
  try {
    return historyExists(ownerId, threadId);
  } catch {
    return false;
  }
}

/**
 * One-time startup migration: copy every legacy SQLite mini row to a file,
 * then delete the row. Afterwards mini history never touches the database.
 * Idempotent — reruns only pick up rows that were added concurrently.
 */
export function migrateMiniSqliteHistory(
  store: MiniSessionStore,
  history: MiniFileHistory,
): { imported: number; skipped: number; failed: number } {
  const result = { imported: 0, skipped: 0, failed: 0 };
  let rows: Array<{ threadId: string; ownerId: string; model: string | null; cwd: string | null; stateJson: string | null; createdAt: number }>;
  try {
    rows = store.listAll();
  } catch {
    return result;
  }
  for (const row of rows) {
    try {
      const imported = history.importSqliteRow(row);
      if (!imported) {
        result.skipped += 1;
        // A file already exists but the sqlite row lingers (e.g. a previous
        // run crashed between import and delete): drop the stale row so the
        // table converges to empty.
        try {
          store.delete(row.ownerId, row.threadId);
        } catch {
          /* ignore */
        }
        continue;
      }
      store.delete(row.ownerId, row.threadId);
      result.imported += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
