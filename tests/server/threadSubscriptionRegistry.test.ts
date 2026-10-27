import { EventEmitter } from "node:events";
import { expect, test } from "bun:test";
import type { EngineStatus, JsonRpcFailure, JsonRpcId, JsonValue } from "@codex-ui/shared";
import { ThreadSubscriptionRegistry } from "../../apps/server/src/threadSubscriptionRegistry.ts";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import type { ThreadWriterLeaseStore } from "../../apps/server/src/threadWriterLeaseStore.ts";

class FakeWriterLeases {
  public available = true;
  public acquired: string[] = [];
  public released: string[] = [];

  public acquire(threadId: string): boolean {
    this.acquired.push(threadId);
    return this.available;
  }

  public release(threadId: string): void {
    this.released.push(threadId);
  }
}

class FakeRuntimeClient extends EventEmitter implements CodexRuntimeClient {
  public status: EngineStatus = { phase: "ready", transport: "daemon-unix" };
  public requests: Array<{ method: string; params?: JsonValue }> = [];
  public failResumeCount = 0;
  public resumeFailureMessage = "no rollout found";

  public getStatus(): EngineStatus {
    return this.status;
  }

  public async start(): Promise<EngineStatus> {
    this.status = { phase: "ready", transport: "daemon-unix" };
    this.emit("status", this.status);
    return this.status;
  }

  public stop(): void {
    this.status = { phase: "stopped", transport: "daemon-unix" };
    this.emit("status", this.status);
  }

  public async restart(): Promise<EngineStatus> {
    this.stop();
    return this.start();
  }

  public async request(method: string, params?: JsonValue): Promise<JsonValue> {
    this.requests.push({ method, params });
    if (method === "thread/resume" && this.failResumeCount > 0) {
      this.failResumeCount -= 1;
      throw new Error(this.resumeFailureMessage);
    }
    return {};
  }

  public async notify(_method: string, _params?: JsonValue): Promise<void> {}

  public respond(_id: JsonRpcId, _result?: JsonValue, _error?: JsonRpcFailure["error"]): void {}
}

class DelayedResumeRuntimeClient extends FakeRuntimeClient {
  private releaseResume: (() => void) | null = null;

  public override async request(method: string, params?: JsonValue): Promise<JsonValue> {
    this.requests.push({ method, params });
    if (method === "thread/resume") {
      await new Promise<void>((resolve) => {
        this.releaseResume = resolve;
      });
    }
    return {};
  }

  public completeResume(): void {
    this.releaseResume?.();
    this.releaseResume = null;
  }
}

test("ThreadSubscriptionRegistry resumes once for multiple watchers and unsubscribes after the last watcher leaves", async () => {
  const client = new FakeRuntimeClient();
  const registry = new ThreadSubscriptionRegistry(() => client);

  registry.watch("thread-1", "browser-a");
  registry.watch("thread-1", "browser-b");
  await Promise.resolve();

  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(1);

  registry.unwatch("thread-1", "browser-a");
  await Promise.resolve();
  expect(client.requests.filter((request) => request.method === "thread/unsubscribe")).toHaveLength(0);

  registry.unwatch("thread-1", "browser-b");
  await Promise.resolve();
  expect(client.requests.filter((request) => request.method === "thread/unsubscribe")).toHaveLength(1);
});

test("ThreadSubscriptionRegistry keeps daemon subscription alive while a turn hold is active", async () => {
  const client = new FakeRuntimeClient();
  const registry = new ThreadSubscriptionRegistry(() => client);

  registry.watch("thread-2", "browser-a");
  registry.addTurnHold("thread-2", "turn:turn-1");
  await Promise.resolve();

  registry.unwatch("thread-2", "browser-a");
  await Promise.resolve();
  expect(client.requests.filter((request) => request.method === "thread/unsubscribe")).toHaveLength(0);

  registry.removeTurnHold("thread-2", "turn:turn-1");
  await Promise.resolve();
  expect(client.requests.filter((request) => request.method === "thread/unsubscribe")).toHaveLength(1);
});

test("ThreadSubscriptionRegistry reuses the active subscription when a browser websocket reconnects", async () => {
  const client = new FakeRuntimeClient();
  const registry = new ThreadSubscriptionRegistry(() => client);

  registry.watch("thread-active", "browser-before-reconnect");
  registry.addTurnHold("thread-active", "turn:running");
  await Promise.resolve();
  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(1);

  registry.unwatchAllForClient("browser-before-reconnect");
  registry.watch("thread-active", "browser-after-reconnect");
  await Promise.resolve();

  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(1);
  expect(client.requests.filter((request) => request.method === "thread/unsubscribe")).toHaveLength(0);
});

test("ThreadSubscriptionRegistry reattaches watched threads after daemon reconnect", async () => {
  const client = new FakeRuntimeClient();
  const registry = new ThreadSubscriptionRegistry(() => client);
  registry.registerClient(client);

  registry.watch("thread-3", "browser-a");
  await Promise.resolve();

  client.emit("status", { phase: "ready", transport: "daemon-unix", connectionEpoch: 2 } satisfies EngineStatus);
  await Promise.resolve();

  const resumes = client.requests.filter((request) => request.method === "thread/resume");
  expect(resumes).toHaveLength(2);
  expect(resumes.every((request) => (request.params as { threadId?: string }).threadId === "thread-3")).toBe(true);
});

test("ThreadSubscriptionRegistry retries transient resume failures while watchers remain", async () => {
  const client = new FakeRuntimeClient();
  client.failResumeCount = 1;
  const registry = new ThreadSubscriptionRegistry(() => client);

  registry.watch("thread-4", "browser-a");
  await new Promise((resolve) => setTimeout(resolve, 650));

  const resumes = client.requests.filter((request) => request.method === "thread/resume");
  expect(resumes).toHaveLength(2);
  expect(client.requests.filter((request) => request.method === "thread/unsubscribe")).toHaveLength(0);
});

test("ThreadSubscriptionRegistry does not retry an existing active writer conflict", async () => {
  const client = new FakeRuntimeClient();
  client.failResumeCount = 10;
  client.resumeFailureMessage = "thread-store conflict: thread thread-owned already has an active writer";
  const registry = new ThreadSubscriptionRegistry(() => client);

  registry.watch("thread-owned", "browser-a");
  await new Promise((resolve) => setTimeout(resolve, 1_100));

  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(1);

  registry.unwatch("thread-owned", "browser-a");
  await Promise.resolve();
  expect(client.requests.filter((request) => request.method === "thread/unsubscribe")).toHaveLength(0);
});

test("ThreadSubscriptionRegistry stops after one retry when resume keeps failing", async () => {
  const client = new FakeRuntimeClient();
  client.failResumeCount = 10;
  const registry = new ThreadSubscriptionRegistry(() => client);

  registry.watch("thread-retry-exhausted", "browser-a");
  await new Promise((resolve) => setTimeout(resolve, 1_100));

  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(2);
  expect(registry.diagnostics().retryingThreadCount).toBe(0);
  expect(registry.diagnostics().threads[0]?.retryExhausted).toBe(true);

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(2);
});

test("ThreadSubscriptionRegistry allows a bounded retry after the daemon becomes ready again", async () => {
  const client = new FakeRuntimeClient();
  client.failResumeCount = 10;
  const registry = new ThreadSubscriptionRegistry(() => client);
  registry.registerClient(client);

  registry.watch("thread-retry-reset", "browser-a");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(2);

  client.failResumeCount = 0;
  client.emit("status", { phase: "ready", transport: "daemon-unix", connectionEpoch: 2 } satisfies EngineStatus);
  await Promise.resolve();

  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(3);
  expect(registry.diagnostics().threads[0]?.retryExhausted).toBe(false);
});

test("ThreadSubscriptionRegistry accepts an explicit client resume before watch without resuming again", async () => {
  const client = new FakeRuntimeClient();
  const registry = new ThreadSubscriptionRegistry(() => client);
  registry.markSubscribed("thread-explicit");
  expect(registry.isSubscribed("thread-explicit")).toBe(true);
  registry.watch("thread-explicit", "browser-a");
  await Promise.resolve();
  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(0);
});

test("ThreadSubscriptionRegistry resumes a watched thread after Codex closes its stale instance", async () => {
  const client = new FakeRuntimeClient();
  const leases = new FakeWriterLeases();
  const registry = new ThreadSubscriptionRegistry(() => client, leases as unknown as ThreadWriterLeaseStore);

  registry.watch("thread-closed-race", "browser-a");
  await Promise.resolve();
  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(1);

  registry.markClosed("thread-closed-race");
  await Promise.resolve();

  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(2);
  expect(registry.isSubscribed("thread-closed-race")).toBe(true);
  expect(leases.released).toContain("thread-closed-race");
});

test("ThreadSubscriptionRegistry removes an unwatched thread when Codex reports it closed", async () => {
  const client = new FakeRuntimeClient();
  const leases = new FakeWriterLeases();
  const registry = new ThreadSubscriptionRegistry(() => client, leases as unknown as ThreadWriterLeaseStore);

  registry.markSubscribed("thread-closed-idle");
  registry.markClosed("thread-closed-idle");

  expect(registry.diagnostics().threadCount).toBe(0);
  expect(registry.isSubscribed("thread-closed-idle")).toBe(false);
  expect(leases.released).toContain("thread-closed-idle");
});

test("ThreadSubscriptionRegistry does not resume or unsubscribe a thread leased by another instance", async () => {
  const client = new FakeRuntimeClient();
  const leases = new FakeWriterLeases();
  leases.available = false;
  const registry = new ThreadSubscriptionRegistry(() => client, leases as unknown as ThreadWriterLeaseStore);

  registry.watch("thread-external", "browser-a");
  await Promise.resolve();
  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(0);

  registry.unwatch("thread-external", "browser-a");
  await Promise.resolve();
  expect(client.requests.filter((request) => request.method === "thread/unsubscribe")).toHaveLength(0);
  expect(leases.released).toContain("thread-external");
});

test("ThreadSubscriptionRegistry releases its lease after the last watcher leaves", async () => {
  const client = new FakeRuntimeClient();
  const leases = new FakeWriterLeases();
  const registry = new ThreadSubscriptionRegistry(() => client, leases as unknown as ThreadWriterLeaseStore);

  registry.watch("thread-leased", "browser-a");
  await Promise.resolve();
  registry.unwatch("thread-leased", "browser-a");
  await Promise.resolve();

  expect(leases.acquired).toEqual(["thread-leased"]);
  expect(leases.released).toEqual(["thread-leased"]);
});

test("ThreadSubscriptionRegistry force closes watched SSH threads", async () => {
  const client = new FakeRuntimeClient();
  const leases = new FakeWriterLeases();
  const registry = new ThreadSubscriptionRegistry(() => client, leases as unknown as ThreadWriterLeaseStore);

  registry.watch("thread-ssh", "browser-a");
  registry.addTurnHold("thread-ssh", "turn:active");
  await Promise.resolve();
  await registry.close("thread-ssh");

  expect(client.requests.filter((request) => request.method === "thread/unsubscribe")).toHaveLength(1);
  expect(registry.diagnostics().threadCount).toBe(0);
  expect(leases.released).toContain("thread-ssh");
});

test("ThreadSubscriptionRegistry does not reattach after closing during resume", async () => {
  const client = new DelayedResumeRuntimeClient();
  const registry = new ThreadSubscriptionRegistry(() => client);

  registry.watch("thread-racing-close", "browser-a");
  await Promise.resolve();
  await registry.close("thread-racing-close");
  client.completeResume();
  await Promise.resolve();
  await Promise.resolve();

  expect(registry.diagnostics().threadCount).toBe(0);
  expect(client.requests.filter((request) => request.method === "thread/unsubscribe").length).toBeGreaterThanOrEqual(1);
});

test("ThreadSubscriptionRegistry settles dual concurrent streaming conversations to zero diagnostics without lease leaks", async () => {
  const client = new FakeRuntimeClient();
  const leases = new FakeWriterLeases();
  const registry = new ThreadSubscriptionRegistry(() => client, leases as unknown as ThreadWriterLeaseStore);

  const threadA = "thread-stream-a";
  const threadB = "thread-stream-b";
  const watcherA = "client-session-left";
  const watcherB = "client-session-right";

  // Both sessions start watching their threads concurrently
  registry.watch(threadA, watcherA);
  registry.watch(threadB, watcherB);
  registry.addTurnHold(threadA, "turn-a-1");
  registry.addTurnHold(threadB, "turn-b-1");

  await Promise.resolve();

  expect(registry.isSubscribed(threadA)).toBe(true);
  expect(registry.isSubscribed(threadB)).toBe(true);
  expect(registry.diagnostics().threadCount).toBe(2);
  expect(registry.diagnostics().watcherCount).toBe(2);
  expect(registry.diagnostics().activeTurnHoldCount).toBe(2);

  // Both streams complete their turns
  registry.removeTurnHold(threadA, "turn-a-1");
  registry.removeTurnHold(threadB, "turn-b-1");

  // Still watched by clients
  expect(registry.diagnostics().activeTurnHoldCount).toBe(0);
  expect(registry.diagnostics().watcherCount).toBe(2);

  // Clients switch views / close sessions (unwatch)
  registry.unwatch(threadA, watcherA);
  registry.unwatch(threadB, watcherB);

  await Promise.resolve();

  // Diagnostics MUST strictly settle to zero!
  const diag = registry.diagnostics();
  expect(diag.threadCount).toBe(0);
  expect(diag.watcherCount).toBe(0);
  expect(diag.activeTurnHoldCount).toBe(0);
  expect(diag.subscribedThreadCount).toBe(0);
  expect(diag.retryingThreadCount).toBe(0);
  expect(diag.leaseBlockedThreadCount).toBe(0);

  // Both leases released
  expect(leases.released).toContain(threadA);
  expect(leases.released).toContain(threadB);
});

test("ThreadSubscriptionRegistry revives an exhausted subscription when the thread is watched again", async () => {
  const client = new FakeRuntimeClient();
  client.failResumeCount = 10;
  const registry = new ThreadSubscriptionRegistry(() => client);

  registry.watch("thread-revive", "browser-a");
  await new Promise((resolve) => setTimeout(resolve, 1_100));

  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(2);
  expect(registry.diagnostics().threads[0]?.retryExhausted).toBe(true);

  client.failResumeCount = 0;
  registry.watch("thread-revive", "browser-b");
  await Promise.resolve();

  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(3);
  expect(registry.diagnostics().threads[0]?.retryExhausted).toBe(false);
  expect(registry.isSubscribed("thread-revive")).toBe(true);
});

test("ThreadSubscriptionRegistry retries a writer-conflicted thread when the thread is watched again", async () => {
  const client = new FakeRuntimeClient();
  client.failResumeCount = 10;
  client.resumeFailureMessage = "thread-store conflict: thread thread-reopen already has an active writer";
  const registry = new ThreadSubscriptionRegistry(() => client);

  registry.watch("thread-reopen", "browser-a");
  await Promise.resolve();

  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(1);
  expect(registry.diagnostics().threads[0]?.leaseBlocked).toBe(true);

  client.failResumeCount = 0;
  registry.watch("thread-reopen", "browser-b");
  await Promise.resolve();

  expect(client.requests.filter((request) => request.method === "thread/resume")).toHaveLength(2);
  expect(registry.diagnostics().threads[0]?.leaseBlocked).toBe(false);
  expect(registry.isSubscribed("thread-reopen")).toBe(true);
});
