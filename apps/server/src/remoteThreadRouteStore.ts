import type { RuntimeDatabase } from "./runtime/database.js";
import type { LocalDatabase } from "./localDatabase.js";
import type { RemoteThreadRoute } from "@cxu/sdk-backend";
export type { RemoteThreadRoute };



type Row = { thread_id: string; command: string; cwd: string; remote_port: number; lifecycle_mode: string; cli_backend: string | null; event_cursor: number; created_at: number; updated_at: number };

export class RemoteThreadRouteStore {
  private readonly db: RuntimeDatabase;
  public constructor(database: Pick<LocalDatabase, "connection">) {
    this.db = database.connection;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ssh_remote_thread_routes (
        thread_id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        cwd TEXT NOT NULL,
        remote_port INTEGER NOT NULL,
        lifecycle_mode TEXT NOT NULL DEFAULT 'background',
        cli_backend TEXT NOT NULL DEFAULT 'codex',
        event_cursor INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ssh_remote_thread_routes_updated
        ON ssh_remote_thread_routes(updated_at DESC);
    `);
    try { this.db.prepare("ALTER TABLE ssh_remote_thread_routes ADD COLUMN lifecycle_mode TEXT NOT NULL DEFAULT 'background'").run(); } catch {}
    try { this.db.prepare("ALTER TABLE ssh_remote_thread_routes ADD COLUMN cli_backend TEXT NOT NULL DEFAULT 'codex'").run(); } catch {}
    try { this.db.prepare("ALTER TABLE ssh_remote_thread_routes ADD COLUMN event_cursor INTEGER NOT NULL DEFAULT 0").run(); } catch {}
  }
  public get(threadId: string): RemoteThreadRoute | null {
    const row = this.db.prepare("SELECT * FROM ssh_remote_thread_routes WHERE thread_id = ? LIMIT 1").get(threadId) as Row | undefined;
    return row ? map(row) : null;
  }
  public list(): RemoteThreadRoute[] {
    return (this.db.prepare("SELECT * FROM ssh_remote_thread_routes ORDER BY updated_at DESC").all() as Row[]).map(map);
  }
  public put(input: Omit<RemoteThreadRoute, "createdAt" | "updatedAt" | "lifecycleMode" | "cliBackend" | "eventCursor"> & { lifecycleMode?: RemoteThreadRoute["lifecycleMode"]; cliBackend?: RemoteThreadRoute["cliBackend"]; eventCursor?: number }): RemoteThreadRoute {
    const now = Date.now();
    const existing = this.get(input.threadId);
    const lifecycleMode = input.lifecycleMode ?? existing?.lifecycleMode ?? "background";
    const cliBackend = input.cliBackend ?? existing?.cliBackend ?? "codex";
    const eventCursor = input.eventCursor ?? existing?.eventCursor ?? 0;
    this.db.prepare(`
      INSERT INTO ssh_remote_thread_routes (thread_id, command, cwd, remote_port, lifecycle_mode, cli_backend, event_cursor, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET command=excluded.command, cwd=excluded.cwd,
        remote_port=excluded.remote_port, lifecycle_mode=excluded.lifecycle_mode, cli_backend=excluded.cli_backend, event_cursor=excluded.event_cursor, updated_at=excluded.updated_at
    `).run(input.threadId, input.command, input.cwd, input.remotePort, lifecycleMode, cliBackend, safeCursor(eventCursor), now, now);
    return this.get(input.threadId)!;
  }
  public touch(threadId: string): void { this.db.prepare("UPDATE ssh_remote_thread_routes SET updated_at = ? WHERE thread_id = ?").run(Date.now(), threadId); }
  public setLifecycleMode(threadId: string, lifecycleMode: RemoteThreadRoute["lifecycleMode"]): RemoteThreadRoute | null {
    this.db.prepare("UPDATE ssh_remote_thread_routes SET lifecycle_mode = ?, updated_at = ? WHERE thread_id = ?").run(lifecycleMode, Date.now(), threadId);
    return this.get(threadId);
  }
  public setEventCursor(threadId: string, eventCursor: number): RemoteThreadRoute | null {
    const cursor = safeCursor(eventCursor);
    this.db.prepare("UPDATE ssh_remote_thread_routes SET event_cursor = CASE WHEN event_cursor > ? THEN event_cursor ELSE ? END, updated_at = ? WHERE thread_id = ?")
      .run(cursor, cursor, Date.now(), threadId);
    return this.get(threadId);
  }
  public delete(threadId: string): boolean { return this.db.prepare("DELETE FROM ssh_remote_thread_routes WHERE thread_id = ?").run(threadId).changes > 0; }
}

function map(row: Row): RemoteThreadRoute {
  return {
    threadId: row.thread_id,
    command: row.command,
    cwd: row.cwd,
    remotePort: row.remote_port,
    lifecycleMode: row.lifecycle_mode === "foreground" ? "foreground" : "background",
    cliBackend: row.cli_backend === "claude" ? "claude" : row.cli_backend === "agy" ? "agy" : row.cli_backend === "auggie" ? "auggie" : row.cli_backend === "grok" ? "grok" : row.cli_backend === "muse" ? "muse" : "codex",
    eventCursor: safeCursor(row.event_cursor),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safeCursor(value: unknown): number {
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
}
