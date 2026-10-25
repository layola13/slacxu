import { randomUUID } from "node:crypto";
import type { RuntimeDatabase } from "./runtime/database.js";

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_RENEW_MS = 10_000;

type ProcessAliveCheck = (processId: number) => boolean;

export class ThreadWriterLeaseStore {
  private readonly ownedThreadIds = new Set<string>();
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;

  public constructor(
    private readonly db: RuntimeDatabase,
    public readonly instanceId = `${process.pid}:${randomUUID()}`,
    private readonly ttlMs = DEFAULT_TTL_MS,
    renewMs = DEFAULT_RENEW_MS,
    isProcessAlive: ProcessAliveCheck = defaultProcessAliveCheck,
    private readonly processId = process.pid
  ) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_writer_leases (
        thread_id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        process_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_thread_writer_leases_expiry
        ON thread_writer_leases(expires_at);
    `);
    this.reclaimDeadProcessLeases(isProcessAlive);
    this.timer = setInterval(() => this.renewAll(), renewMs);
    this.timer.unref?.();
  }

  public acquire(threadId: string, now = Date.now()): boolean {
    if (this.closed) return false;
    const result = this.db.prepare(`
      INSERT INTO thread_writer_leases (thread_id, instance_id, process_id, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        instance_id = excluded.instance_id,
        process_id = excluded.process_id,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
      WHERE thread_writer_leases.instance_id = excluded.instance_id
         OR thread_writer_leases.expires_at <= excluded.updated_at
    `).run(threadId, this.instanceId, this.processId, now + this.ttlMs, now) as { changes?: number };
    const acquired = Number(result.changes ?? 0) > 0;
    if (acquired) this.ownedThreadIds.add(threadId);
    return acquired;
  }

  public release(threadId: string): void {
    if (this.closed) return;
    this.ownedThreadIds.delete(threadId);
    this.db.prepare("DELETE FROM thread_writer_leases WHERE thread_id = ? AND instance_id = ?")
      .run(threadId, this.instanceId);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.db.prepare("DELETE FROM thread_writer_leases WHERE instance_id = ?").run(this.instanceId);
    this.ownedThreadIds.clear();
  }

  public owns(threadId: string): boolean {
    return !this.closed && this.ownedThreadIds.has(threadId);
  }

  private reclaimDeadProcessLeases(isProcessAlive: ProcessAliveCheck): void {
    const rows = this.db.prepare(
      "SELECT DISTINCT instance_id, process_id FROM thread_writer_leases WHERE instance_id <> ?"
    ).all(this.instanceId) as Array<{ instance_id: string; process_id: number }>;
    const remove = this.db.prepare("DELETE FROM thread_writer_leases WHERE instance_id = ?");
    for (const row of rows) {
      const processId = Number(row.process_id);
      if (processId === this.processId || !isProcessAlive(processId)) remove.run(row.instance_id);
    }
  }

  private renewAll(now = Date.now()): void {
    if (this.ownedThreadIds.size === 0) return;
    const result = this.db.prepare(`
      UPDATE thread_writer_leases
      SET expires_at = ?, updated_at = ?
      WHERE instance_id = ?
    `).run(now + this.ttlMs, now, this.instanceId) as { changes?: number };
    const renewedCount = Number(result.changes ?? 0);
    if (renewedCount === this.ownedThreadIds.size) return;
    if (renewedCount === 0) {
      this.ownedThreadIds.clear();
      return;
    }

    const rows = this.db.prepare("SELECT thread_id FROM thread_writer_leases WHERE instance_id = ?")
      .all(this.instanceId) as Array<{ thread_id: string }>;
    this.ownedThreadIds.clear();
    for (const row of rows) this.ownedThreadIds.add(row.thread_id);
  }
}

function defaultProcessAliveCheck(processId: number): boolean {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return code === "EPERM";
  }
}
