import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Read-only projection over native Muse CLI session logs
 * (`<xdg-data>/muse/sessions/<date>/<sid>/session.jsonl`,
 * e.g. `~/.local/share/muse/sessions/2026-10-19/<sid>/session.jsonl`).
 *
 * Mirrors the opencode native projection semantics:
 * - list: bounded, sorted by recency, no subscription, no runtime creation.
 * - the native log is NEVER written here; files are only read (with byte/line
 *   caps) so a running `muse` CLI keeps its locks.
 *
 * Why this exists: `museThreadListResult` only reads the internal
 * `muse_sessions` table, so a fresh machine (or sessions created by a bare
 * `muse` CLI outside Ultra) renders an empty Muse tab. Listing native
 * `session.jsonl` files alongside internal threads fixes the empty tab
 * without implicit watch/resume of full histories.
 */

export const NATIVE_MUSE_LIST_LIMIT = 200;
const NATIVE_MUSE_PREVIEW_LINES = 60;
const NATIVE_MUSE_PREVIEW_MAX_BYTES = 64 * 1024;
const NATIVE_MUSE_MAX_DEPTH = 5;
const NATIVE_MUSE_MAX_VISITED_DIRS = 3000;

type JsonRecord = Record<string, unknown>;

export interface NativeMuseThreadEntry extends JsonRecord {
  id: string;
}

function candidateMuseDataDirs(): string[] {
  const dirs: string[] = [];
  const testHome = process.env.MUSE_TEST_HOME?.trim();
  // Hermetic tests point MUSE_TEST_HOME at a fixture root that holds a
  // `muse/` data dir directly (mirrors OPENCODE_TEST_HOME).
  if (testHome) dirs.push(join(testHome, "muse"));
  const explicit = process.env.MUSE_DATA_HOME?.trim();
  if (explicit) dirs.push(explicit);
  const home = testHome || homedir();
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) dirs.push(join(xdg, "muse"));
  if (home) dirs.push(join(home, ".local", "share", "muse"));
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) dirs.push(join(localAppData, "muse"));
  const appData = process.env.APPDATA?.trim();
  if (appData) dirs.push(join(appData, "muse"));
  if (home) dirs.push(join(home, "AppData", "Local", "muse"));
  return [...new Set(dirs)];
}

/** All native Muse `sessions/` roots currently present (empty when never ran here). */
export function resolveNativeMuseSessionsRoots(): string[] {
  const roots: string[] = [];
  for (const dir of candidateMuseDataDirs()) {
    const sessionsRoot = process.env.MUSE_SESSIONS_DIR?.trim() || join(dir, "sessions");
    try {
      if (existsSync(sessionsRoot)) roots.push(sessionsRoot);
    } catch {
      // Unreadable — ignore.
    }
    if (process.env.MUSE_SESSIONS_DIR?.trim()) break;
  }
  return [...new Set(roots)];
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Dig one level for a human text field inside a parsed JSONL record. */
function extractRecordText(record: Record<string, unknown>): string | undefined {
  const payload = asRecord(record.payload);
  const rec = asRecord(payload.record ?? record.record);
  const input = asRecord(payload.input ?? rec.input ?? record.input);
  const direct = [
    record.prompt,
    payload.prompt,
    rec.prompt,
    input.prompt,
    record.text,
    payload.text,
    record.content,
    payload.content,
    record.message,
    payload.message,
  ];
  for (const candidate of direct) {
    const text = asText(candidate);
    if (text) return text;
  }
  for (const container of [input, rec, payload, record]) {
    for (const key of ["prompt", "text", "content", "message"]) {
      const text = asText((container as Record<string, unknown>)[key]);
      if (text) return text;
    }
  }
  return undefined;
}

function payloadTypeOf(record: Record<string, unknown>): string {
  const t = record.payload_type;
  return typeof t === "string" ? t : "";
}

/**
 * First user-ish text inside a native `session.jsonl`: prefer start/prompt
 * lines, fall back to the first text seen. Bounded read (64KiB + 60 lines).
 */
export function readNativeMusePreview(logPath: string): string | null {
  try {
    const content = readFileSync(logPath, "utf8");
    if (!content) return null;
    const slice = content.length > NATIVE_MUSE_PREVIEW_MAX_BYTES
      ? content.slice(0, NATIVE_MUSE_PREVIEW_MAX_BYTES)
      : content;
    const lines = slice.split("\n").slice(0, NATIVE_MUSE_PREVIEW_LINES);
    let fallback: string | null = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      const text = extractRecordText(record);
      if (!text) continue;
      const clean = text.trim().slice(0, 100);
      if (!clean) continue;
      const type = payloadTypeOf(record).toLowerCase();
      if (/start|prompt|user|session|init/.test(type)) return clean;
      fallback ??= clean;
    }
    return fallback;
  } catch {
    return null;
  }
}

/** Locate a native session log by id across all candidate roots (read-only). */
export function resolveNativeMuseSessionLog(sessionId: string): string | null {
  const sid = sessionId.trim();
  if (!sid || sid.includes("/") || sid.includes("\\") || sid.includes("..")) return null;
  for (const root of resolveNativeMuseSessionsRoots()) {
    const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > NATIVE_MUSE_MAX_DEPTH) continue;
      if (++visited > NATIVE_MUSE_MAX_VISITED_DIRS) return null;
      let entries: Array<{ isDirectory(): boolean; name: string }>;
      try {
        entries = readdirSync(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === sid) {
          const logPath = join(current.dir, entry.name, "session.jsonl");
          try {
            if (existsSync(logPath)) return logPath;
          } catch {
            // ignore
          }
        } else if (current.depth < NATIVE_MUSE_MAX_DEPTH) {
          queue.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 });
        }
      }
    }
  }
  return null;
}

/**
 * Bounded native history listing for the sidebar's Muse tab.
 * Scans `<sessions>/<date>/<sid>/session.jsonl`, dedupes by session id and sorts
 * by mtime — the same entry shape `museThreadListResult` produces for
 * internal threads so the web catalog consumes both interchangeably.
 */
export function listNativeMuseThreads(limit = NATIVE_MUSE_LIST_LIMIT): NativeMuseThreadEntry[] {
  const capped = Math.max(1, Math.min(500, limit));
  const byId = new Map<string, NativeMuseThreadEntry>();
  for (const root of resolveNativeMuseSessionsRoots()) {
    const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > NATIVE_MUSE_MAX_DEPTH) continue;
      if (++visited > NATIVE_MUSE_MAX_VISITED_DIRS) break;
      let entries: Array<{ isDirectory(): boolean; name: string }>;
      try {
        entries = readdirSync(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionDir = join(current.dir, entry.name);
        const logPath = join(sessionDir, "session.jsonl");
        let isSession = false;
        try {
          isSession = existsSync(logPath);
        } catch {
          isSession = false;
        }
        if (isSession) {
          const sid = entry.name;
          if (!sid || byId.has(sid)) continue;
          let mtimeMs = Date.now();
          try {
            mtimeMs = statSync(logPath).mtimeMs;
          } catch {
            // keep fallback
          }
          const secs = Math.floor(mtimeMs / 1000);
          const preview = readNativeMusePreview(logPath) ?? "Muse conversation";
          byId.set(sid, {
            id: sid,
            sessionId: sid,
            parentThreadId: null,
            preview,
            model: null,
            createdAt: secs,
            updatedAt: secs,
            recencyAt: secs,
            status: { type: "notLoaded" },
            cwd: null,
            cliBackend: "muse",
            source: "appServer",
            native: true,
            turns: [],
          });
          continue;
        }
        if (current.depth < NATIVE_MUSE_MAX_DEPTH) {
          queue.push({ dir: sessionDir, depth: current.depth + 1 });
        }
      }
    }
  }
  return [...byId.values()]
    .sort((a, b) => Number(b.recencyAt ?? b.updatedAt ?? 0) - Number(a.recencyAt ?? a.updatedAt ?? 0))
    .slice(0, capped);
}
