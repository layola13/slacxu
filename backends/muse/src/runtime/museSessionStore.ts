import type { RuntimeDatabase } from "@cxu/sdk-backend";

/**
 * Persists Muse CLI session and conversation metadata separately
 * from Codex thread IDs. This allows history to remain readable after
 * a server restart, and enables resuming existing conversations using --resume.
 *
 * Schema: one row per internal thread ID that uses the Muse backend.
 */
export interface MuseSessionRecord {
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

interface MuseSessionRow {
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

export class MuseSessionStore {
  constructor(private readonly db: RuntimeDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS muse_sessions (
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
  }): MuseSessionRecord {
    const now = Date.now();
    const existing = this.get(input.ownerId, input.threadId);
    this.db.prepare(`
      INSERT INTO muse_sessions (
        thread_id, owner_id, session_id, cli_version, model, cwd, permission_mode, state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, owner_id) DO UPDATE SET
        session_id = COALESCE(excluded.session_id, muse_sessions.session_id),
        cli_version = COALESCE(excluded.cli_version, muse_sessions.cli_version),
        model = COALESCE(excluded.model, muse_sessions.model),
        cwd = COALESCE(excluded.cwd, muse_sessions.cwd),
        permission_mode = COALESCE(excluded.permission_mode, muse_sessions.permission_mode),
        state_json = COALESCE(excluded.state_json, muse_sessions.state_json),
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

  get(ownerId: string, threadId: string): MuseSessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM muse_sessions WHERE thread_id = ? AND owner_id = ? LIMIT 1"
    ).get(threadId, ownerId) as MuseSessionRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getMetadata(ownerId: string, threadId: string): Pick<MuseSessionRecord, "threadId" | "ownerId" | "sessionId" | "model" | "cwd"> | null {
    const row = this.db.prepare("SELECT thread_id, owner_id, session_id, model, cwd FROM muse_sessions WHERE thread_id = ? AND owner_id = ? LIMIT 1")
      .get(threadId, ownerId) as Pick<MuseSessionRow, "thread_id" | "owner_id" | "session_id" | "model" | "cwd"> | undefined;
    return row ? { threadId: row.thread_id, ownerId: row.owner_id, sessionId: row.session_id, model: row.model, cwd: row.cwd } : null;
  }

  findByThreadId(threadId: string): MuseSessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM muse_sessions WHERE thread_id = ? LIMIT 1"
    ).get(threadId) as MuseSessionRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  findBySessionId(sessionId: string): MuseSessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM muse_sessions WHERE session_id = ? LIMIT 1"
    ).get(sessionId) as MuseSessionRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  listByOwner(ownerId: string): MuseSessionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM muse_sessions WHERE owner_id = ? ORDER BY updated_at DESC"
    ).all(ownerId) as MuseSessionRow[];
    return rows.map((r) => this.mapRow(r));
  }

  delete(ownerId: string, threadId: string): void {
    this.db.prepare(
      "DELETE FROM muse_sessions WHERE thread_id = ? AND owner_id = ?"
    ).run(threadId, ownerId);
  }

  deleteByThread(threadId: string): void {
    this.db.prepare(
      "DELETE FROM muse_sessions WHERE thread_id = ?"
    ).run(threadId);
  }

  deleteByThreadId(threadId: string): void {
    this.deleteByThread(threadId);
  }

  private mapRow(row: MuseSessionRow): MuseSessionRecord {
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
