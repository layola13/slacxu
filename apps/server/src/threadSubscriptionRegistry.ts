import { EventEmitter } from "node:events";
import { type CodexRuntimeClient } from "@cxu/sdk-backend";
import type { ThreadWriterLeaseStore } from "./threadWriterLeaseStore.js";

type ThreadEntry = {
  threadId: string;
  watchers: Set<string>;
  activeTurnHolds: Set<string>;
  subscribed: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
  retryExhausted: boolean;
  leaseBlocked: boolean;
};

const SUBSCRIPTION_RETRY_BASE_MS = 500;
const SUBSCRIPTION_RETRY_MAX_MS = 30_000;
export const SUBSCRIPTION_RETRY_MAX_ATTEMPTS = 1;

export class ThreadSubscriptionRegistry extends EventEmitter {
  private threads = new Map<string, ThreadEntry>();

  public constructor(
    private readonly getClient: (threadId?: string) => CodexRuntimeClient,
    private readonly writerLeases?: ThreadWriterLeaseStore
  ) {
    super();
  }

  public registerClient(client: CodexRuntimeClient): void {
    client.on("status", (status) => {
      if (status.phase === "ready") {
        void this.reAttachAll();
      }
    });
  }

  public watch(threadId: string, clientId: string): void {
    let entry = this.threads.get(threadId);
    if (!entry) {
      entry = {
        threadId,
        watchers: new Set<string>(),
        activeTurnHolds: new Set<string>(),
        subscribed: false,
        retryTimer: null,
        retryAttempt: 0,
        retryExhausted: false,
        leaseBlocked: false
      };
      this.threads.set(threadId, entry);
    }
    entry.watchers.add(clientId);
    if (!entry.subscribed && !entry.retryTimer) {
      entry.retryExhausted = false;
      entry.leaseBlocked = false;
      entry.retryAttempt = 0;
    }
    void this.ensureSubscribed(entry);
  }

  public unwatch(threadId: string, clientId: string): void {
    const entry = this.threads.get(threadId);
    if (!entry) return;
    entry.watchers.delete(clientId);
    void this.evaluateUnsubscribe(entry);
  }

  public unwatchAllForClient(clientId: string): void {
    for (const entry of this.threads.values()) {
      if (entry.watchers.has(clientId)) {
        entry.watchers.delete(clientId);
        void this.evaluateUnsubscribe(entry);
      }
    }
  }

  public addTurnHold(threadId: string, turnId: string): void {
    let entry = this.threads.get(threadId);
    if (!entry) {
      entry = {
        threadId,
        watchers: new Set<string>(),
        activeTurnHolds: new Set<string>(),
        subscribed: false,
        retryTimer: null,
        retryAttempt: 0,
        retryExhausted: false,
        leaseBlocked: false
      };
      this.threads.set(threadId, entry);
    }
    entry.activeTurnHolds.add(turnId);
    void this.ensureSubscribed(entry);
  }

  public markSubscribed(threadId: string): void {
    let entry = this.threads.get(threadId);
    if (!entry) {
      entry = {
        threadId,
        watchers: new Set<string>(),
        activeTurnHolds: new Set<string>(),
        subscribed: true,
        retryTimer: null,
        retryAttempt: 0,
        retryExhausted: false,
        leaseBlocked: false
      };
      this.threads.set(threadId, entry);
      return;
    }
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }
    entry.subscribed = true;
    entry.retryAttempt = 0;
    entry.retryExhausted = false;
    entry.leaseBlocked = false;
  }

  public markUnsubscribed(threadId: string): void {
    const entry = this.threads.get(threadId);
    if (entry?.retryTimer) clearTimeout(entry.retryTimer);
    this.threads.delete(threadId);
    this.writerLeases?.release(threadId);
  }

  public markClosed(threadId: string): void {
    const entry = this.threads.get(threadId);
    if (!entry) {
      this.writerLeases?.release(threadId);
      return;
    }
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }
    entry.subscribed = false;
    entry.retryAttempt = 0;
    entry.retryExhausted = false;
    entry.leaseBlocked = false;
    this.writerLeases?.release(threadId);
    if (entry.watchers.size > 0 || entry.activeTurnHolds.size > 0) {
      void this.ensureSubscribed(entry);
      return;
    }
    this.threads.delete(threadId);
  }

  public async close(threadId: string): Promise<void> {
    const entry = this.threads.get(threadId);
    if (!entry) {
      this.writerLeases?.release(threadId);
      return;
    }
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
    this.threads.delete(threadId);

    try {
      if (entry.subscribed) {
        const client = this.getClient(threadId);
        if (client.getStatus().phase === "ready") {
          await client.request("thread/unsubscribe", { threadId });
        }
      }
    } catch {
    } finally {
      this.writerLeases?.release(threadId);
    }
  }

  public isSubscribed(threadId: string): boolean {
    return this.threads.get(threadId)?.subscribed === true;
  }

  public diagnostics(): {
    threadCount: number;
    watcherCount: number;
    activeTurnHoldCount: number;
    subscribedThreadCount: number;
    retryingThreadCount: number;
    leaseBlockedThreadCount: number;
    threads: Array<{
      threadId: string;
      watcherCount: number;
      activeTurnHoldCount: number;
      subscribed: boolean;
      retrying: boolean;
      retryExhausted: boolean;
      leaseBlocked: boolean;
    }>;
  } {
    const threads = [...this.threads.values()].map((entry) => ({
      threadId: entry.threadId,
      watcherCount: entry.watchers.size,
      activeTurnHoldCount: entry.activeTurnHolds.size,
      subscribed: entry.subscribed,
      retrying: entry.retryTimer !== null,
      retryExhausted: entry.retryExhausted,
      leaseBlocked: entry.leaseBlocked
    }));
    return {
      threadCount: threads.length,
      watcherCount: threads.reduce((total, entry) => total + entry.watcherCount, 0),
      activeTurnHoldCount: threads.reduce((total, entry) => total + entry.activeTurnHoldCount, 0),
      subscribedThreadCount: threads.filter((entry) => entry.subscribed).length,
      retryingThreadCount: threads.filter((entry) => entry.retrying).length,
      leaseBlockedThreadCount: threads.filter((entry) => entry.leaseBlocked).length,
      threads
    };
  }

  public removeTurnHold(threadId: string, turnId: string): void {
    const entry = this.threads.get(threadId);
    if (!entry) return;
    entry.activeTurnHolds.delete(turnId);
    void this.evaluateUnsubscribe(entry);
  }

  private async ensureSubscribed(entry: ThreadEntry): Promise<void> {
    if (entry.subscribed) return;
    if (entry.retryTimer) return;
    if (entry.retryExhausted) return;
    if (entry.leaseBlocked) return;
    const client = this.getClient(entry.threadId);
    const status = client.getStatus();
    if (status.phase !== "ready") return;
    if (this.writerLeases && !this.writerLeases.acquire(entry.threadId)) {
        entry.subscribed = false;
        entry.leaseBlocked = true;
        entry.retryAttempt = 0;
        entry.retryExhausted = false;
        this.emit("subscriptionError", {
        threadId: entry.threadId,
        error: new Error(`Thread ${entry.threadId} is open in another Codex Ultra instance`)
      });
      return;
    }

    try {
      entry.subscribed = true;
      entry.leaseBlocked = false;
      await client.request("thread/resume", { threadId: entry.threadId });
      if (this.threads.get(entry.threadId) !== entry) {
        if (client.getStatus().phase === "ready") {
          try {
            await client.request("thread/unsubscribe", { threadId: entry.threadId });
          } catch {}
        }
        return;
      }
      entry.retryAttempt = 0;
      entry.retryExhausted = false;
    } catch (error) {
      if (this.threads.get(entry.threadId) !== entry) return;
      this.emit("subscriptionError", { threadId: entry.threadId, error });
      if (isActiveWriterConflict(error)) {
        // Repeated resume attempts create an RPC/IO storm while another writer
        // owns the thread. Keep this watch read-only until it is reopened.
        entry.subscribed = false;
        entry.leaseBlocked = true;
        entry.retryAttempt = 0;
        entry.retryExhausted = false;
        this.writerLeases?.release(entry.threadId);
        return;
      }
      this.writerLeases?.release(entry.threadId);
      entry.subscribed = false;
      this.scheduleRetry(entry);
    }
  }

  private scheduleRetry(entry: ThreadEntry): void {
    if (entry.retryTimer) return;
    if (entry.watchers.size === 0 && entry.activeTurnHolds.size === 0) return;
    if (entry.retryAttempt >= SUBSCRIPTION_RETRY_MAX_ATTEMPTS) {
      entry.retryExhausted = true;
      return;
    }
    const delayMs = Math.min(
      SUBSCRIPTION_RETRY_MAX_MS,
      SUBSCRIPTION_RETRY_BASE_MS * 2 ** Math.min(entry.retryAttempt, 6)
    );
    entry.retryAttempt += 1;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      if (this.threads.get(entry.threadId) !== entry) return;
      void this.ensureSubscribed(entry);
    }, delayMs);
  }

  private async evaluateUnsubscribe(entry: ThreadEntry): Promise<void> {
    if (entry.watchers.size > 0 || entry.activeTurnHolds.size > 0) return;
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }
    if (!entry.subscribed) {
      this.threads.delete(entry.threadId);
      this.writerLeases?.release(entry.threadId);
      return;
    }

    const client = this.getClient(entry.threadId);
    const status = client.getStatus();
    entry.subscribed = false;
    this.threads.delete(entry.threadId);

    if (status.phase === "ready") {
      try {
        await client.request("thread/unsubscribe", { threadId: entry.threadId });
      } catch {}
    }
    this.writerLeases?.release(entry.threadId);
  }

  private async reAttachAll(): Promise<void> {
    for (const entry of this.threads.values()) {
      if (entry.watchers.size > 0 || entry.activeTurnHolds.size > 0) {
        if (entry.retryTimer) {
          clearTimeout(entry.retryTimer);
          entry.retryTimer = null;
        }
        entry.subscribed = false;
        entry.retryAttempt = 0;
        entry.retryExhausted = false;
        entry.leaseBlocked = false;
        await this.ensureSubscribed(entry);
      }
    }
  }
}

function isActiveWriterConflict(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  return /already has an active writer|thread-store conflict/i.test(message);
}
