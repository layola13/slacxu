import type { RuntimeDatabase } from "./runtime/database.js";
import type { LocalDatabase } from "./localDatabase.js";
import type { SshWorkspaceProfile } from "../../../backends/codex/src/runtime/sshCodexBridge.js";

type Row = {
  thread_id: string;
  command: string;
  cwd: string;
  provider_id: string | null;
  group_id: string | null;
  parent_thread_id: string | null;
  created_at: number;
  updated_at: number;
};
export type StoredSshWorkspace = { threadId: string; profile: SshWorkspaceProfile; parentThreadId: string | null; createdAt: number; updatedAt: number };

export class SshWorkspaceStore {
  private readonly db: RuntimeDatabase;
  public constructor(database: Pick<LocalDatabase, "connection">) {
    this.db = database.connection;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ssh_thread_workspaces (
        thread_id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        cwd TEXT NOT NULL,
        provider_id TEXT,
        group_id TEXT,
        parent_thread_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    try { this.db.prepare("ALTER TABLE ssh_thread_workspaces ADD COLUMN parent_thread_id TEXT").run(); } catch {}
  }
  public get(threadId: string): SshWorkspaceProfile | null {
    const row = this.db.prepare("SELECT thread_id, command, cwd, provider_id, group_id, parent_thread_id, created_at, updated_at FROM ssh_thread_workspaces WHERE thread_id = ? LIMIT 1").get(threadId) as Row | undefined;
    return row ? { command: row.command, cwd: row.cwd, providerId: row.provider_id ?? undefined, groupId: row.group_id ?? undefined } : null;
  }
  public list(): StoredSshWorkspace[] {
    const rows = this.db.prepare("SELECT thread_id, command, cwd, provider_id, group_id, parent_thread_id, created_at, updated_at FROM ssh_thread_workspaces ORDER BY updated_at DESC").all() as Row[];
    return rows.map((row) => ({
      threadId: row.thread_id,
      profile: { command: row.command, cwd: row.cwd, providerId: row.provider_id ?? undefined, groupId: row.group_id ?? undefined },
      parentThreadId: row.parent_thread_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }
  public put(threadId: string, profile: SshWorkspaceProfile, parentThreadId: string | null = null): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO ssh_thread_workspaces (thread_id, command, cwd, provider_id, group_id, parent_thread_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        command = excluded.command,
        cwd = excluded.cwd,
        provider_id = excluded.provider_id,
        group_id = excluded.group_id,
        parent_thread_id = excluded.parent_thread_id,
        updated_at = excluded.updated_at
    `).run(threadId, profile.command, profile.cwd, profile.providerId ?? null, profile.groupId ?? null, parentThreadId, now, now);
  }
}
