import type { RuntimeDatabase } from "@cxu/sdk-backend";

/**
 * Persists OpenCode CLI session and conversation metadata separately
 * from Codex thread IDs. This allows history to remain readable after
 * a server restart, and enables resuming existing conversations.
 *
 * Schema: one row per internal thread ID that uses the OpenCode backend.
 */
export interface OpencodeSessionRecord {
  threadId: string;
  ownerId: string;
  sessionId: string | null;
  cliVersion: string | null;
  model: string | null;
  cwd: string | null;
  permissionMode: string | null;
  stateJson: string | null;
  createdAt: number;
  updatedAt: number;
}

interface OpencodeSessionRow {
  thread_id: string;
  owner_id: string;
  session_id: string | null;
  cli_version: string | null;
  model: string | null;
  cwd: string | null;
  permission_mode: string | null;
  state_json: string | null;
  created_at: number;
  updated_at: number;
}

export class OpencodeSessionStore {
  constructor(private readonly db: RuntimeDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS opencode_sessions (
        thread_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        session_id TEXT,
        cli_version TEXT,
        model TEXT,
        cwd TEXT,
        permission_mode TEXT,
        state_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, owner_id)
      );
    `);
  }

  upsert(input: {
    threadId: string;
    ownerId: string;
    sessionId?: string | null;
    cliVersion?: string | null;
    model?: string | null;
    cwd?: string | null;
    permissionMode?: string | null;
    stateJson?: string | null;
  }): OpencodeSessionRecord {
    const now = Date.now();
    const existing = this.get(input.ownerId, input.threadId);
    this.db.prepare(`
      INSERT INTO opencode_sessions (
        thread_id, owner_id, session_id, cli_version, model, cwd, permission_mode, state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, owner_id) DO UPDATE SET
        session_id = COALESCE(excluded.session_id, opencode_sessions.session_id),
        cli_version = COALESCE(excluded.cli_version, opencode_sessions.cli_version),
        model = COALESCE(excluded.model, opencode_sessions.model),
        cwd = COALESCE(excluded.cwd, opencode_sessions.cwd),
        permission_mode = COALESCE(excluded.permission_mode, opencode_sessions.permission_mode),
        state_json = COALESCE(excluded.state_json, opencode_sessions.state_json),
        updated_at = excluded.updated_at
    `).run(
      input.threadId,
      input.ownerId,
      input.sessionId ?? existing?.sessionId ?? null,
      input.cliVersion ?? existing?.cliVersion ?? null,
      input.model ?? existing?.model ?? null,
      input.cwd ?? existing?.cwd ?? null,
      input.permissionMode ?? existing?.permissionMode ?? null,
      input.stateJson ?? existing?.stateJson ?? null,
      existing?.createdAt ?? now,
      now
    );
    return this.get(input.ownerId, input.threadId)!;
  }

  get(ownerId: string, threadId: string): OpencodeSessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM opencode_sessions WHERE thread_id = ? AND owner_id = ? LIMIT 1"
    ).get(threadId, ownerId) as OpencodeSessionRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByThreadId(threadId: string): OpencodeSessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM opencode_sessions WHERE thread_id = ? LIMIT 1"
    ).get(threadId) as OpencodeSessionRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  findBySessionId(sessionId: string): OpencodeSessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM opencode_sessions WHERE session_id = ? LIMIT 1"
    ).get(sessionId) as OpencodeSessionRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  /**
   * Lightweight metadata read for history-restore metadata RPCs. Selects
   * only small columns and NEVER touches `state_json`, so a tens-of-MB
   * snapshot can't block the Bun event loop on the 18% metadata stage.
   */
  getMetadata(ownerId: string, threadId: string): Pick<OpencodeSessionRecord, "threadId" | "ownerId" | "sessionId" | "model" | "cwd"> | null {
    const row = this.db.prepare(
      "SELECT thread_id, owner_id, session_id, model, cwd FROM opencode_sessions WHERE thread_id = ? AND owner_id = ? LIMIT 1"
    ).get(threadId, ownerId) as Pick<OpencodeSessionRow, "thread_id" | "owner_id" | "session_id" | "model" | "cwd"> | undefined;
    return row ? { threadId: row.thread_id, ownerId: row.owner_id, sessionId: row.session_id, model: row.model, cwd: row.cwd } : null;
  }

  /** Light fallback for native `ses_*` ids materialized under a UUID thread. */
  findMetadataBySessionId(sessionId: string): Pick<OpencodeSessionRecord, "threadId" | "ownerId" | "sessionId" | "model" | "cwd"> | null {
    const row = this.db.prepare(
      "SELECT thread_id, owner_id, session_id, model, cwd FROM opencode_sessions WHERE session_id = ? LIMIT 1"
    ).get(sessionId) as Pick<OpencodeSessionRow, "thread_id" | "owner_id" | "session_id" | "model" | "cwd"> | undefined;
    return row ? { threadId: row.thread_id, ownerId: row.owner_id, sessionId: row.session_id, model: row.model, cwd: row.cwd } : null;
  }

  /** Light fallback for UUID threads across owners (matches findByThreadId). */
  findMetadataByThreadId(threadId: string): Pick<OpencodeSessionRecord, "threadId" | "ownerId" | "sessionId" | "model" | "cwd"> | null {
    const row = this.db.prepare(
      "SELECT thread_id, owner_id, session_id, model, cwd FROM opencode_sessions WHERE thread_id = ? LIMIT 1"
    ).get(threadId) as Pick<OpencodeSessionRow, "thread_id" | "owner_id" | "session_id" | "model" | "cwd"> | undefined;
    return row ? { threadId: row.thread_id, ownerId: row.owner_id, sessionId: row.session_id, model: row.model, cwd: row.cwd } : null;
  }

  listByOwner(ownerId: string): OpencodeSessionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM opencode_sessions WHERE owner_id = ? ORDER BY updated_at DESC"
    ).all(ownerId) as OpencodeSessionRow[];
    return rows.map((r) => this.mapRow(r));
  }

  /** Include legacy shared-local sessions when a member opens history. */
  listForOwner(ownerId: string): OpencodeSessionRecord[] {
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
    const res = this.db.prepare(
      "DELETE FROM opencode_sessions WHERE thread_id = ? AND owner_id = ?"
    ).run(threadId, ownerId);
    return res.changes > 0;
  }

  deleteByThreadId(threadId: string): boolean {
    const res = this.db.prepare(
      "DELETE FROM opencode_sessions WHERE thread_id = ?"
    ).run(threadId);
    return res.changes > 0;
  }

  private mapRow(row: OpencodeSessionRow): OpencodeSessionRecord {
    return {
      threadId: row.thread_id,
      ownerId: row.owner_id,
      sessionId: row.session_id,
      cliVersion: row.cli_version,
      model: row.model,
      cwd: row.cwd,
      permissionMode: row.permission_mode,
      stateJson: row.state_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
