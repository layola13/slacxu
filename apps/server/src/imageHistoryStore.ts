import type { JsonValue } from "@codex-ui/shared";
import { LocalDatabase } from "./localDatabase.js";
import type { RuntimeDatabase } from "./runtime/database.js";

export type ImageHistoryEntry = {
  threadId: string;
  turnId: string;
  requestId: string;
  status: string;
  items: JsonValue[];
  createdAt: number;
  updatedAt: number;
};

export type ImageHistoryListOptions = {
  limit?: number;
  offset?: number;
};

export type ImageHistoryListResult = {
  entries: ImageHistoryEntry[];
  omittedOversized: number;
  truncated: boolean;
};

/**
 * Upper bound for a single items_json payload served to clients.
 * Mirrors the PUT guard in index.ts (256 KiB, reference-only, no inline base64).
 * Rows larger than this are legacy poisoned rows: they are skipped on read so
 * one bad row can no longer OOM the whole thread (SQLITE_NOMEM via .all()).
 */
export const IMAGE_HISTORY_MAX_BYTES = 256 * 1024;
export const IMAGE_HISTORY_DEFAULT_LIMIT = 200;
export const IMAGE_HISTORY_MAX_LIMIT = 1000;

/**
 * Path-only contract: image_history must store references (savedPath /
 * saved_path + metadata), never inline bitmaps. Any inline base64 payload
 * (b64 keys, data:image URLs, non-empty image_generation_call.result)
 * is rejected before SQLite sees it, so a poisoned row can never be
 * written and SQLITE_NOMEM via items_json is structurally impossible.
 */
const INLINE_IMAGE_KEYS = new Set(["b64Json", "b64_json", "base64", "b64", "data"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasInlineImageValue(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (typeof value === "string") {
    // Short tokens/ids must not trip the guard; only real payloads match.
    if (value.length < 256) return false;
    return value.includes(";base64,") || /data:image\//i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasInlineImageValue(entry, depth + 1));
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (INLINE_IMAGE_KEYS.has(key) && typeof entry === "string" && entry.trim()) return true;
      // image_generation_call.result must stay "" — bitmap lives in saved_path.
      if (key === "result" && typeof entry === "string" && entry.trim()) {
        const type = typeof value.type === "string" ? value.type : "";
        if (type === "image_generation_call" || entry.length >= 256) return true;
      }
      if (hasInlineImageValue(entry, depth + 1)) return true;
    }
  }
  return false;
}

export function containsInlineImageData(items: unknown): boolean {
  return hasInlineImageValue(items);
}

export function assertPathOnlyImageItems(items: unknown): void {
  if (!Array.isArray(items)) throw new Error("Image history must contain references, not inline image data");
  if (hasInlineImageValue(items)) {
    throw new Error("Image history must contain references, not inline image data");
  }
  const serialized = JSON.stringify(items);
  const bytes = typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(serialized).length
    : serialized.length;
  if (bytes > IMAGE_HISTORY_MAX_BYTES) {
    throw new Error("Image history must contain references, not inline image data");
  }
}

type ImageHistoryRow = {
  thread_id: string;
  turn_id: string;
  request_id: string;
  status: string;
  items_json: string;
  created_at: number;
  updated_at: number;
};

/** UI-only image history. These records never enter the Codex text thread. */
export class ImageHistoryStore {
  private readonly db: RuntimeDatabase;

  public constructor(database: Pick<LocalDatabase, "connection"> = new LocalDatabase()) {
    this.db = database.connection;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_history (
        owner_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        status TEXT NOT NULL,
        items_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, thread_id, request_id)
      );
      CREATE INDEX IF NOT EXISTS idx_image_history_thread
        ON image_history(owner_id, thread_id, created_at);
    `);
  }

  public list(
    ownerId: string,
    threadId: string,
    options: ImageHistoryListOptions = {},
  ): ImageHistoryEntry[] {
    return this.listPage(ownerId, threadId, options).entries;
  }

  /**
   * Bounded read: LENGTH(items_json) is filtered in SQL so legacy poisoned
   * rows (inline base64 inserted before the PUT guard) never reach .all() /
   * JSON.parse, and LIMIT/OFFSET caps total allocation (SQLITE_NOMEM fix).
   */
  public listPage(
    ownerId: string,
    threadId: string,
    options: ImageHistoryListOptions = {},
  ): ImageHistoryListResult {
    const limit = Math.max(
      1,
      Math.min(
        IMAGE_HISTORY_MAX_LIMIT,
        Math.floor(options.limit ?? IMAGE_HISTORY_DEFAULT_LIMIT),
      ),
    );
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    // Fetch one extra row to report truncation without a second COUNT query.
    const rows = this.db.prepare(`
      SELECT thread_id, turn_id, request_id, status, items_json, created_at, updated_at
      FROM image_history
      WHERE owner_id = ? AND thread_id = ? AND LENGTH(items_json) <= ?
      ORDER BY created_at ASC LIMIT ? OFFSET ?
    `).all(ownerId, threadId, IMAGE_HISTORY_MAX_BYTES, limit + 1, offset) as ImageHistoryRow[];
    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;
    const entries = page.flatMap((row) => {
      try {
        const items = JSON.parse(row.items_json) as JsonValue;
        return Array.isArray(items) ? [{
          threadId: row.thread_id, turnId: row.turn_id, requestId: row.request_id,
          status: row.status, items, createdAt: row.created_at, updatedAt: row.updated_at
        }] : [];
      } catch {
        return [];
      }
    });
    // Cheap aggregate: no blobs transferred, only lengths.
    const omitted = this.db.prepare(`
      SELECT COUNT(*) AS count FROM image_history
      WHERE owner_id = ? AND thread_id = ? AND LENGTH(items_json) > ?
    `).get(ownerId, threadId, IMAGE_HISTORY_MAX_BYTES) as { count: number };
    return { entries, omittedOversized: omitted?.count ?? 0, truncated };
  }

  public stats(ownerId: string, threadId: string): { count: number; totalBytes: number; maxBytes: number | null; oversized: number } {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(items_json)), 0) AS totalBytes,
        MAX(LENGTH(items_json)) AS maxBytes,
        COALESCE(SUM(CASE WHEN LENGTH(items_json) > ? THEN 1 ELSE 0 END), 0) AS oversized
      FROM image_history WHERE owner_id = ? AND thread_id = ?
    `).get(IMAGE_HISTORY_MAX_BYTES, ownerId, threadId) as {
      count: number; totalBytes: number; maxBytes: number | null; oversized: number;
    };
    return { count: row?.count ?? 0, totalBytes: row?.totalBytes ?? 0, maxBytes: row?.maxBytes ?? null, oversized: row?.oversized ?? 0 };
  }

  /** Self-heal for poisoned threads: drop only oversized legacy rows. */
  public purgeOversized(ownerId: string, threadId: string): number {
    this.db.prepare(`
      DELETE FROM image_history
      WHERE owner_id = ? AND thread_id = ? AND LENGTH(items_json) > ?
    `).run(ownerId, threadId, IMAGE_HISTORY_MAX_BYTES);
    // Portable affected-row count: bun:sqlite .run() returns void while
    // better-sqlite3 returns { changes }, so read SQLite's changes() instead.
    const result = this.db.prepare(`SELECT changes() AS changes`).get() as { changes: number };
    return result?.changes ?? 0;
  }

  public get(ownerId: string, threadId: string, requestId: string): ImageHistoryEntry | undefined {
    // Length-first probe: legacy poisoned rows (>256KiB inline base64) are
    // skipped without allocating the blob, so a single bad requestId can
    // no longer SQLITE_NOMEM this point lookup (or put() below).
    const probe = this.db.prepare(`
      SELECT LENGTH(items_json) AS len
      FROM image_history WHERE owner_id = ? AND thread_id = ? AND request_id = ?
    `).get(ownerId, threadId, requestId) as { len: number | null } | undefined;
    if (!probe || probe.len == null) return undefined;
    if (probe.len > IMAGE_HISTORY_MAX_BYTES) return undefined;
    const row = this.db.prepare(`
      SELECT thread_id, turn_id, request_id, status, items_json, created_at, updated_at
      FROM image_history WHERE owner_id = ? AND thread_id = ? AND request_id = ?
    `).get(ownerId, threadId, requestId) as ImageHistoryRow | undefined;
    if (!row) return undefined;
    try {
      const items = JSON.parse(row.items_json) as JsonValue;
      if (!Array.isArray(items)) return undefined;
      return {
        threadId: row.thread_id, turnId: row.turn_id, requestId: row.request_id,
        status: row.status, items, createdAt: row.created_at, updatedAt: row.updated_at,
      };
    } catch {
      return undefined;
    }
  }

  public put(ownerId: string, input: Omit<ImageHistoryEntry, "createdAt" | "updatedAt">): ImageHistoryEntry {
    // Store-level hard gate (defense in depth behind the /api/image-history
    // PUT guard): reject inline base64 / oversized payloads before SQLite.
    assertPathOnlyImageItems(input.items);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO image_history (owner_id, thread_id, turn_id, request_id, status, items_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, thread_id, request_id) DO UPDATE SET
        turn_id = excluded.turn_id, status = excluded.status, items_json = excluded.items_json, updated_at = excluded.updated_at
    `).run(ownerId, input.threadId, input.turnId, input.requestId, input.status, JSON.stringify(input.items), now, now);
    // Point lookup by PK: O(1), no full-thread re-scan (previous version called
    // list() here, so one poisoned row bricked every PUT on that thread).
    const entry = this.get(ownerId, input.threadId, input.requestId);
    if (!entry) throw new Error("Image history write did not persist");
    return entry;
  }
}
