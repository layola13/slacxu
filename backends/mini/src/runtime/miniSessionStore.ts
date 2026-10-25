import type { RuntimeDatabase } from "@cxu/sdk-backend";

export interface MiniSessionRecord {
  threadId: string;
  ownerId: string;
  model: string | null;
  cwd: string | null;
  stateJson: string | null;
  createdAt: number;
  updatedAt: number;
}

interface MiniSessionRow {
  thread_id: string;
  owner_id: string;
  model: string | null;
  cwd: string | null;
  state_json: string | null;
  created_at: number;
  updated_at: number;
}

export class MiniSessionStore {
  constructor(private readonly db: RuntimeDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mini_sessions (
        thread_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        model TEXT,
        cwd TEXT,
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
    model?: string | null;
    cwd?: string | null;
    stateJson?: string | null;
  }): MiniSessionRecord {
    const now = Date.now();
    const existing = this.get(input.ownerId, input.threadId);
    this.db.prepare(`
      INSERT INTO mini_sessions (
        thread_id, owner_id, model, cwd, state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, owner_id) DO UPDATE SET
        model = COALESCE(excluded.model, mini_sessions.model),
        cwd = COALESCE(excluded.cwd, mini_sessions.cwd),
        state_json = COALESCE(excluded.state_json, mini_sessions.state_json),
        updated_at = excluded.updated_at
    `).run(
      input.threadId,
      input.ownerId,
      input.model ?? existing?.model ?? null,
      input.cwd ?? existing?.cwd ?? null,
      input.stateJson ?? existing?.stateJson ?? null,
      existing?.createdAt ?? now,
      now
    );
    return this.get(input.ownerId, input.threadId)!;
  }

  get(ownerId: string, threadId: string): MiniSessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM mini_sessions WHERE thread_id = ? AND owner_id = ? LIMIT 1"
    ).get(threadId, ownerId) as MiniSessionRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByThreadId(threadId: string): MiniSessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM mini_sessions WHERE thread_id = ? LIMIT 1"
    ).get(threadId) as MiniSessionRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  listByOwner(ownerId: string): MiniSessionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM mini_sessions WHERE owner_id = ? ORDER BY updated_at DESC"
    ).all(ownerId) as MiniSessionRow[];
    return rows.map((r) => this.mapRow(r));
  }

  /** Full scan for the one-time file-history migration. */
  listAll(): MiniSessionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM mini_sessions ORDER BY updated_at DESC"
    ).all() as MiniSessionRow[];
    return rows.map((r) => this.mapRow(r));
  }

  delete(ownerId: string, threadId: string): void {
    this.db.prepare(
      "DELETE FROM mini_sessions WHERE thread_id = ? AND owner_id = ?"
    ).run(threadId, ownerId);
  }

  private mapRow(row: MiniSessionRow): MiniSessionRecord {
    return {
      threadId: row.thread_id,
      ownerId: row.owner_id,
      model: row.model,
      cwd: row.cwd,
      stateJson: row.state_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
