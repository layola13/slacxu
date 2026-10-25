import type { RuntimeDatabase } from "@cxu/sdk-backend";

/**
 * Persists Antigravity (AGY) CLI session and conversation metadata separately
 * from Codex thread IDs. This allows history to remain readable after
 * a server restart, and enables resuming existing conversations using --conversation.
 *
 * Schema: one row per internal thread ID that uses the AGY backend.
 */
export interface AgySessionRecord {
  threadId: string;
  ownerId: string;
  conversationId: string | null;
  cliVersion: string | null;
  model: string | null;
  cwd: string | null;
  permissionMode: string | null;
  stateJson: string | null;
  createdAt: number;
  updatedAt: number;
}

interface AgySessionRow {
  thread_id: string;
  owner_id: string;
  conversation_id: string | null;
  cli_version: string | null;
  model: string | null;
  cwd: string | null;
  permission_mode: string | null;
  state_json: string | null;
  created_at: number;
  updated_at: number;
}

export class AgySessionStore {
  constructor(private readonly db: RuntimeDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agy_sessions (
        thread_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        conversation_id TEXT,
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
    try {
      this.db.exec("ALTER TABLE agy_sessions ADD COLUMN state_json TEXT");
    } catch {}
  }

  upsert(input: {
    threadId: string;
    ownerId: string;
    conversationId?: string | null;
    cliVersion?: string | null;
    model?: string | null;
    cwd?: string | null;
    permissionMode?: string | null;
    stateJson?: string | null;
  }): AgySessionRecord {
    const now = Date.now();
    const existing = this.get(input.ownerId, input.threadId);
    this.db.prepare(`
      INSERT INTO agy_sessions (
        thread_id, owner_id, conversation_id, cli_version, model, cwd, permission_mode, state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, owner_id) DO UPDATE SET
        conversation_id = COALESCE(excluded.conversation_id, agy_sessions.conversation_id),
        cli_version = COALESCE(excluded.cli_version, agy_sessions.cli_version),
        model = COALESCE(excluded.model, agy_sessions.model),
        cwd = COALESCE(excluded.cwd, agy_sessions.cwd),
        permission_mode = COALESCE(excluded.permission_mode, agy_sessions.permission_mode),
        state_json = COALESCE(excluded.state_json, agy_sessions.state_json),
        updated_at = excluded.updated_at
    `).run(
      input.threadId,
      input.ownerId,
      input.conversationId ?? existing?.conversationId ?? null,
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

  get(ownerId: string, threadId: string): AgySessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM agy_sessions WHERE thread_id = ? AND owner_id = ? LIMIT 1"
    ).get(threadId, ownerId) as AgySessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  listByOwner(ownerId: string): AgySessionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM agy_sessions WHERE owner_id = ? ORDER BY updated_at DESC"
    ).all(ownerId) as AgySessionRow[];
    return rows.map(mapRow);
  }

  delete(threadId: string, ownerId: string): boolean {
    return this.db.prepare(
      "DELETE FROM agy_sessions WHERE thread_id = ? AND owner_id = ?"
    ).run(threadId, ownerId).changes > 0;
  }

  deleteByThread(threadId: string): number {
    return this.db.prepare(
      "DELETE FROM agy_sessions WHERE thread_id = ?"
    ).run(threadId).changes;
  }

  findByConversationId(conversationId: string): AgySessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM agy_sessions WHERE conversation_id = ? LIMIT 1"
    ).get(conversationId) as AgySessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  getMetadata(ownerId: string, threadId: string): Pick<AgySessionRecord, "threadId" | "ownerId" | "conversationId" | "model" | "cwd"> | null {
    const row = this.db.prepare(
      "SELECT thread_id, owner_id, conversation_id, model, cwd FROM agy_sessions WHERE thread_id = ? AND owner_id = ? LIMIT 1"
    ).get(threadId, ownerId) as Pick<AgySessionRow, "thread_id" | "owner_id" | "conversation_id" | "model" | "cwd"> | undefined;
    return row ? { threadId: row.thread_id, ownerId: row.owner_id, conversationId: row.conversation_id, model: row.model, cwd: row.cwd } : null;
  }

  findMetadataByConversationId(conversationId: string): Pick<AgySessionRecord, "threadId" | "ownerId" | "conversationId" | "model" | "cwd"> | null {
    const row = this.db.prepare(
      "SELECT thread_id, owner_id, conversation_id, model, cwd FROM agy_sessions WHERE conversation_id = ? LIMIT 1"
    ).get(conversationId) as Pick<AgySessionRow, "thread_id" | "owner_id" | "conversation_id" | "model" | "cwd"> | undefined;
    return row ? { threadId: row.thread_id, ownerId: row.owner_id, conversationId: row.conversation_id, model: row.model, cwd: row.cwd } : null;
  }

  findByThreadId(threadId: string): AgySessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM agy_sessions WHERE thread_id = ? LIMIT 1"
    ).get(threadId) as AgySessionRow | undefined;
    return row ? mapRow(row) : null;
  }
}

function mapRow(row: AgySessionRow): AgySessionRecord {
  return {
    threadId: row.thread_id,
    ownerId: row.owner_id,
    conversationId: row.conversation_id,
    cliVersion: row.cli_version,
    model: row.model,
    cwd: row.cwd,
    permissionMode: row.permission_mode,
    stateJson: row.state_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
