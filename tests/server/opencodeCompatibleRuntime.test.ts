import { describe, expect, test } from "bun:test";
import { OpencodeCompatibleRuntime } from "../../backends/opencode/src/runtime/opencodeCompatibleRuntime.js";
import {
  createOpencodeProjectorContext,
  OPENCODE_UPSTREAM_RETRY_GRACE_MS,
} from "../../backends/opencode/src/runtime/opencodeCompatibleTurnProjector.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function terminalAssistantMessage(sessionID: string, id: string) {
  return {
    id: `terminal-${id}`,
    type: "message.updated",
    properties: {
      sessionID,
      info: { id, role: "assistant", finish: "stop", time: { completed: Date.now() } },
    },
  };
}

describe("opencodeCompatibleRuntime turn state", () => {
  test("fails cleanly when the SSE connection never becomes ready", async () => {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: "thread-delayed-sse",
      cwd: process.cwd(),
      sessionId: "session-delayed-sse",
      serverUrl: "http://127.0.0.1:43121",
      serverPassword: "test",
      eventStreamConnectTimeoutMs: 5,
      turnStallTimeoutMs: 0,
    });
    (runtime as any).startSseSubscription = () => {
      (runtime as any).sseConnectedPromise = new Promise<void>(() => {});
    };
    const notifications: any[] = [];
    runtime.on("notification", (notification) => notifications.push(notification));

    await expect(runtime.executeTurn("hello", "turn-delayed-sse")).rejects.toThrow("Timed out waiting");

    expect(notifications.some((notification) => notification.method === "turn/failed")).toBe(true);
    expect(runtime.isRunning).toBe(false);
    runtime.stop();
  });

  test("keeps transient 429 running until recovery", () => {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: "thread-429",
      cwd: process.cwd(),
      sessionId: "session-429",
      turnStallTimeoutMs: 0,
    });
    const ctx = createOpencodeProjectorContext("thread-429", "turn-429");
    ctx.sessionId = "session-429";
    (runtime as any).ctx = ctx;
    (runtime as any).isTurnRunning = true;
    const notifications: any[] = [];
    runtime.on("notification", (notification) => notifications.push(notification));

    (runtime as any).handleSseEvent({
      id: "retry-1",
      type: "session.status",
      properties: { sessionID: "session-429", status: { type: "retry", attempt: 1, message: "HTTP 429 Too Many Requests" } },
    });
    expect(ctx.status).toBe("running");
    expect(notifications.some((notification) => notification.method === "turn/failed")).toBe(false);

    (runtime as any).handleSseEvent({
      id: "recovered-output",
      type: "message.part.delta",
      properties: {
        sessionID: "session-429",
        messageID: "message-1",
        partID: "part-1",
        field: "text",
        delta: "Recovered answer",
      },
    });
    expect(ctx.upstreamIssueAtMs).toBeNull();

    (runtime as any).handleSseEvent(terminalAssistantMessage("session-429", "message-1"));
    ctx.lastActivityMs = Date.now() - 3000;
    (runtime as any).handleSseEvent({
      id: "idle-after-recovery",
      type: "session.idle",
      properties: { sessionID: "session-429" },
    });
    expect(ctx.status).toBe("completed");
    expect(notifications.some((notification) => notification.method === "turn/completed")).toBe(true);
    runtime.stop();
  });

  test("re-arms deferred idle after a final streamed chunk", () => {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: "thread-idle-race",
      cwd: process.cwd(),
      sessionId: "session-idle-race",
      turnStallTimeoutMs: 0,
    });
    const ctx = createOpencodeProjectorContext("thread-idle-race", "turn-idle-race");
    ctx.sessionId = "session-idle-race";
    (runtime as any).ctx = ctx;
    (runtime as any).isTurnRunning = true;
    const notifications: any[] = [];
    runtime.on("notification", (notification) => notifications.push(notification));

    (runtime as any).handleSseEvent({
      id: "answer-1",
      type: "message.part.delta",
      properties: {
        sessionID: "session-idle-race",
        messageID: "message-1",
        partID: "part-1",
        field: "text",
        delta: "partial answer",
      },
    });
    (runtime as any).handleSseEvent({
      id: "idle-1",
      type: "session.status",
      properties: { sessionID: "session-idle-race", status: { type: "idle" } },
    });
    expect(ctx.status).toBe("running");
    expect(ctx.deferredIdleAtMs).toBeNull();

    // The final assistant chunk can arrive after the first idle signal.
    (runtime as any).handleSseEvent({
      id: "answer-final",
      type: "message.part.delta",
      properties: {
        sessionID: "session-idle-race",
        messageID: "message-1",
        partID: "part-1",
        field: "text",
        delta: " complete",
      },
    });
    expect(ctx.status).toBe("running");
    expect(ctx.deferredIdleAtMs).toBeNull();

    (runtime as any).handleSseEvent(terminalAssistantMessage("session-idle-race", "message-1"));
    ctx.lastActivityMs = Date.now() - 3000;
    (runtime as any).handleSseEvent({
      id: "idle-confirmed",
      type: "session.idle",
      properties: { sessionID: "session-idle-race" },
    });
    expect(ctx.status).toBe("completed");
    expect(notifications.some((notification) => notification.method === "turn/completed")).toBe(true);
    expect((runtime as any).isTurnRunning).toBe(false);
    runtime.stop();
  });

  test("ignores late events from the previous turn before allowing idle completion", () => {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: "thread-late-event",
      cwd: process.cwd(),
      sessionId: "session-late-event",
      turnStallTimeoutMs: 0,
    });
    const ctx = createOpencodeProjectorContext("thread-late-event", "turn-new");
    ctx.sessionId = "session-late-event";
    (runtime as any).ctx = ctx;
    (runtime as any).isTurnRunning = true;
    (runtime as any).awaitingTurnActivity = true;
    (runtime as any).staleMessageIds = new Set(["old-message", "old-part"]);
    const notifications: any[] = [];
    runtime.on("notification", (notification) => notifications.push(notification));

    (runtime as any).handleSseEvent({
      id: "old-todo",
      type: "todo.updated",
      properties: {
        sessionID: "session-late-event",
        todos: [{ content: "stale plan", status: "completed", priority: "high" }],
      },
    });
    expect((runtime as any).awaitingTurnActivity).toBe(true);
    expect(notifications.some((notification) => notification.method === "turn/plan/updated")).toBe(false);

    (runtime as any).handleSseEvent({
      id: "old-output",
      type: "message.part.updated",
      properties: {
        sessionID: "session-late-event",
        part: { id: "old-part", messageID: "old-message", type: "text", text: "late" },
      },
    });
    expect(ctx.status).toBe("running");
    expect(notifications.some((notification) => notification.method === "turn/completed")).toBe(false);

    (runtime as any).handleSseEvent({
      id: "old-idle",
      type: "session.idle",
      properties: { sessionID: "session-late-event" },
    });
    expect(ctx.status).toBe("running");

    (runtime as any).handleSseEvent({
      id: "new-output",
      type: "message.part.delta",
      properties: {
        sessionID: "session-late-event",
        messageID: "new-message",
        partID: "new-part",
        field: "text",
        delta: "new answer",
      },
    });
    expect((runtime as any).awaitingTurnActivity).toBe(false);
    (runtime as any).handleSseEvent({
      id: "ambiguous-new-idle",
      type: "session.idle",
      properties: { sessionID: "session-late-event" },
    });
    expect(ctx.status).toBe("running");
    expect(notifications.some((notification) => notification.method === "turn/completed")).toBe(false);
    (runtime as any).handleSseEvent(terminalAssistantMessage("session-late-event", "new-message"));
    ctx.lastActivityMs = Date.now() - 3000;
    (runtime as any).handleSseEvent({
      id: "new-idle",
      type: "session.idle",
      properties: { sessionID: "session-late-event" },
    });
    expect(ctx.status).toBe("completed");
    runtime.stop();
  });

  test("ignores an ambiguous late retry until the new turn has activity", () => {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: "thread-late-retry",
      cwd: process.cwd(),
      sessionId: "session-late-retry",
      turnStallTimeoutMs: 0,
    });
    const ctx = createOpencodeProjectorContext("thread-late-retry", "turn-new");
    ctx.sessionId = "session-late-retry";
    (runtime as any).ctx = ctx;
    (runtime as any).isTurnRunning = true;
    (runtime as any).awaitingTurnActivity = true;

    (runtime as any).handleSseEvent({
      id: "old-retry",
      type: "session.status",
      properties: { sessionID: "session-late-retry", status: { type: "retry", attempt: 1, message: "HTTP 503 from previous turn" } },
    });
    expect(ctx.upstreamIssueAtMs).toBeNull();
    expect(ctx.status).toBe("running");

    (runtime as any).handleSseEvent({
      id: "new-output",
      type: "message.part.delta",
      properties: { sessionID: "session-late-retry", messageID: "new-message", partID: "new-part", field: "text", delta: "answer" },
    });
    expect((runtime as any).awaitingTurnActivity).toBe(false);

    (runtime as any).handleSseEvent({
      id: "new-retry",
      type: "session.status",
      properties: { sessionID: "session-late-retry", status: { type: "retry", attempt: 1, message: "HTTP 503 while current turn retries" } },
    });
    expect(ctx.upstreamIssueAtMs).not.toBeNull();
    runtime.stop();
  });

  test("deduplicates a replayed idle event across turns", () => {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: "thread-replayed-idle",
      cwd: process.cwd(),
      sessionId: "session-replayed-idle",
      turnStallTimeoutMs: 0,
    });
    const first = createOpencodeProjectorContext("thread-replayed-idle", "turn-first");
    first.sessionId = "session-replayed-idle";
    (runtime as any).ctx = first;
    (runtime as any).isTurnRunning = true;
    (runtime as any).awaitingTurnActivity = false;
    const notifications: any[] = [];
    runtime.on("notification", (notification) => notifications.push(notification));

    const firstOutput = {
      id: "first-output",
      type: "message.part.delta",
      properties: { sessionID: "session-replayed-idle", messageID: "message-first", partID: "part-first", field: "text", delta: "first answer" },
    };
    (runtime as any).handleSseEvent(firstOutput);
    (runtime as any).handleSseEvent(firstOutput);
    expect(first.currentAssistantText).toBe("first answer");
    (runtime as any).handleSseEvent(terminalAssistantMessage("session-replayed-idle", "message-first"));
    first.lastActivityMs = Date.now() - 3000;
    const settledIdle = {
      id: "idle-settled-first",
      type: "session.idle",
      properties: { sessionID: "session-replayed-idle" },
    };
    (runtime as any).handleSseEvent(settledIdle);
    (runtime as any).handleSseEvent(settledIdle);
    expect(first.status).toBe("completed");
    expect(notifications.filter((notification) => notification.method === "turn/completed")).toHaveLength(1);

    const second = createOpencodeProjectorContext("thread-replayed-idle", "turn-second");
    second.sessionId = "session-replayed-idle";
    (runtime as any).ctx = second;
    (runtime as any).isTurnRunning = true;
    (runtime as any).awaitingTurnActivity = true;
    (runtime as any).handleSseEvent(settledIdle);

    expect(second.status).toBe("running");
    expect((runtime as any).isTurnRunning).toBe(true);
    runtime.stop();
  });

  test("retries explicit prompt 429 responses but never replays ambiguous 5xx writes", async () => {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: "thread-prompt-retry",
      cwd: process.cwd(),
      sessionId: "session-prompt-retry",
      serverUrl: "http://127.0.0.1:43121",
    });
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    try {
      globalThis.fetch = (async () => {
        requestCount += 1;
        return requestCount === 1
          ? new Response("rate limited", { status: 429 })
          : new Response("accepted", { status: 200 });
      }) as typeof fetch;
      const recovered = await (runtime as any).postPrompt("http://127.0.0.1/prompt", { parts: [] });
      expect(recovered.status).toBe(200);
      expect(requestCount).toBe(2);

      requestCount = 0;
      globalThis.fetch = (async () => {
        requestCount += 1;
        return new Response("rate limited", { status: 429 });
      }) as typeof fetch;
      const exhausted429 = await (runtime as any).postPrompt("http://127.0.0.1/prompt", { parts: [] });
      expect(exhausted429.status).toBe(429);
      expect(requestCount).toBe(4);

      requestCount = 0;
      globalThis.fetch = (async () => {
        requestCount += 1;
        return new Response("upstream unavailable", { status: 503 });
      }) as typeof fetch;
      const ambiguous = await (runtime as any).postPrompt("http://127.0.0.1/prompt", { parts: [] });
      expect(ambiguous.status).toBe(503);
      expect(requestCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      runtime.stop();
    }
  });

  test("fails a turn stalled beyond the Codex retry grace without leaving working state", async () => {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: "thread-stalled-retry",
      cwd: process.cwd(),
      sessionId: "session-stalled-retry",
      turnStallTimeoutMs: 0,
    });
    const ctx = createOpencodeProjectorContext("thread-stalled-retry", "turn-stalled-retry");
    ctx.sessionId = "session-stalled-retry";
    ctx.upstreamIssueAtMs = Date.now() - OPENCODE_UPSTREAM_RETRY_GRACE_MS + 15;
    ctx.upstreamIssueMsg = "HTTP 429 Too Many Requests";
    ctx.upstreamRetryAttempts = 1;
    ctx.lastActivityMs = ctx.upstreamIssueAtMs;
    (runtime as any).ctx = ctx;
    (runtime as any).isTurnRunning = true;
    const notifications: any[] = [];
    runtime.on("notification", (notification) => notifications.push(notification));

    (runtime as any).scheduleUpstreamRetryCheck();
    await delay(40);

    expect(ctx.status).toBe("failed");
    expect((runtime as any).isTurnRunning).toBe(false);
    expect(notifications.some((notification) => notification.method === "turn/failed")).toBe(true);
    runtime.stop();
  });

  test("fails after the configured no-progress watchdog and clears its timer", async () => {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: "thread-stalled",
      cwd: process.cwd(),
      sessionId: "session-stalled",
      turnStallTimeoutMs: 15,
    });
    const ctx = createOpencodeProjectorContext("thread-stalled", "turn-stalled");
    ctx.sessionId = "session-stalled";
    ctx.lastActivityMs = Date.now() - 20;
    (runtime as any).ctx = ctx;
    (runtime as any).isTurnRunning = true;
    const notifications: any[] = [];
    runtime.on("notification", (notification) => notifications.push(notification));

    (runtime as any).scheduleTurnStallCheck();
    await delay(30);

    expect(ctx.status).toBe("failed");
    expect((runtime as any).isTurnRunning).toBe(false);
    expect(notifications.some((notification) => notification.method === "turn/failed")).toBe(true);
    expect((runtime as any).turnStallTimer).toBeNull();
    runtime.stop();
  });

  test("stop settles a turn and tears down the local server when abort hangs", async () => {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: "thread-abort-timeout",
      cwd: process.cwd(),
      sessionId: "session-abort-timeout",
      serverUrl: "http://127.0.0.1:43121",
      serverPassword: "test",
      interruptTimeoutMs: 10,
    });
    const ctx = createOpencodeProjectorContext("thread-abort-timeout", "turn-abort-timeout");
    ctx.sessionId = "session-abort-timeout";
    (runtime as any).ctx = ctx;
    (runtime as any).isTurnRunning = true;
    (runtime as any).serverInfo = { url: "http://127.0.0.1:43121", password: "test" };
    let serverStopped = false;
    (runtime as any).processManager = {
      stop: async () => { serverStopped = true; },
    };
    const notifications: any[] = [];
    runtime.on("notification", (notification) => notifications.push(notification));
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      })) as typeof fetch;

      await runtime.interruptTurn();
      await delay(0);

      expect(ctx.status).toBe("interrupted");
      expect(notifications.some((notification) => notification.method === "turn/interrupted")).toBe(true);
      expect(serverStopped).toBe(true);
      expect(runtime.isRunning).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      runtime.stop();
    }
  });
});
