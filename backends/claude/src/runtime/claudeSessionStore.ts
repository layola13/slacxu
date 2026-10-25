import type { RuntimeDatabase } from "@cxu/sdk-backend";

/**
 * Persists Claude-compatible CLI external session metadata separately
 * from Codex thread IDs. This allows history to remain readable after
 * a server restart, and enables resume when a valid external session exists.
 *
 * Schema: one row per internal thread ID that uses the Claude backend.
 */
export interface ClaudeSessionRecord {
  threadId: string;
  ownerId: string;
  externalSessionId: string | null;
  cliVersion: string | null;
  model: string | null;
  cwd: string | null;
  permissionMode: string | null;
  configDir: string | null;
  stateJson: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ClaudeSessionRow {
  thread_id: string;
  owner_id: string;
  external_session_id: string | null;
  cli_version: string | null;
  model: string | null;
  cwd: string | null;
  permission_mode: string | null;
  config_dir: string | null;
  state_json: string | null;
  created_at: number;
  updated_at: number;
}

export class ClaudeSessionStore {
  constructor(private readonly db: RuntimeDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS claude_sessions (
        thread_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        external_session_id TEXT,
        cli_version TEXT,
        model TEXT,
        cwd TEXT,
        permission_mode TEXT,
        config_dir TEXT,
        state_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, owner_id)
      );
    `);
    try {
      this.db.exec("ALTER TABLE claude_sessions ADD COLUMN state_json TEXT");
    } catch {}
    try {
      this.db.exec("ALTER TABLE claude_sessions ADD COLUMN config_dir TEXT");
    } catch {}
  }

  upsert(input: {
    threadId: string;
    ownerId: string;
    externalSessionId?: string | null;
    cliVersion?: string | null;
    model?: string | null;
    cwd?: string | null;
    permissionMode?: string | null;
    configDir?: string | null;
    stateJson?: string | null;
  }): ClaudeSessionRecord {
    const now = Date.now();
    const existing = this.get(input.ownerId, input.threadId);
    this.db.prepare(`
      INSERT INTO claude_sessions (
        thread_id, owner_id, external_session_id, cli_version, model, cwd, permission_mode, config_dir, state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, owner_id) DO UPDATE SET
        external_session_id = COALESCE(excluded.external_session_id, claude_sessions.external_session_id),
        cli_version = COALESCE(excluded.cli_version, claude_sessions.cli_version),
        model = COALESCE(excluded.model, claude_sessions.model),
        cwd = COALESCE(excluded.cwd, claude_sessions.cwd),
        permission_mode = COALESCE(excluded.permission_mode, claude_sessions.permission_mode),
        config_dir = COALESCE(excluded.config_dir, claude_sessions.config_dir),
        state_json = COALESCE(excluded.state_json, claude_sessions.state_json),
        updated_at = excluded.updated_at
    `).run(
      input.threadId,
      input.ownerId,
      input.externalSessionId ?? existing?.externalSessionId ?? null,
      input.cliVersion ?? existing?.cliVersion ?? null,
      input.model ?? existing?.model ?? null,
      input.cwd ?? existing?.cwd ?? null,
      input.permissionMode ?? existing?.permissionMode ?? null,
      input.configDir ?? existing?.configDir ?? null,
      input.stateJson ?? existing?.stateJson ?? null,
      existing?.createdAt ?? now,
      now
    );
    return this.get(input.ownerId, input.threadId)!;
  }

  get(ownerId: string, threadId: string): ClaudeSessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM claude_sessions WHERE thread_id = ? AND owner_id = ? LIMIT 1"
    ).get(threadId, ownerId) as ClaudeSessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  listByOwner(ownerId: string): ClaudeSessionRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM claude_sessions WHERE owner_id = ? ORDER BY updated_at DESC"
    ).all(ownerId) as ClaudeSessionRow[];
    return rows.map(mapRow);
  }

  delete(threadId: string, ownerId: string): boolean {
    return this.db.prepare(
      "DELETE FROM claude_sessions WHERE thread_id = ? AND owner_id = ?"
    ).run(threadId, ownerId).changes > 0;
  }

  deleteByThread(threadId: string): number {
    return this.db.prepare(
      "DELETE FROM claude_sessions WHERE thread_id = ?"
    ).run(threadId).changes;
  }

  findByExternalSession(externalSessionId: string): ClaudeSessionRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM claude_sessions WHERE external_session_id = ? LIMIT 1"
    ).get(externalSessionId) as ClaudeSessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Number of threads still bound to a Claude config directory. Threads can
   * share one directory (virtual agent threads run on their parent's bridge),
   * so the directory may only be discarded once this reaches zero.
   */
  countByConfigDir(configDir: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS total FROM claude_sessions WHERE config_dir = ?"
    ).get(configDir) as { total?: number } | undefined;
    return Number(row?.total ?? 0);
  }

  listConfigDirs(): string[] {
    const rows = this.db.prepare(
      "SELECT DISTINCT config_dir FROM claude_sessions WHERE config_dir IS NOT NULL"
    ).all() as Array<{ config_dir: string }>;
    return rows.map((row) => row.config_dir);
  }
}

function mapRow(row: ClaudeSessionRow): ClaudeSessionRecord {
  return {
    threadId: row.thread_id,
    ownerId: row.owner_id,
    externalSessionId: row.external_session_id,
    cliVersion: row.cli_version,
    model: row.model,
    cwd: row.cwd,
    permissionMode: row.permission_mode,
    configDir: row.config_dir,
    stateJson: row.state_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
