import { describe, expect, test, afterEach } from "bun:test";
import { EventEmitter } from "node:events";
import { OpencodeCompatibleRuntime } from "../../backends/opencode/src/runtime/opencodeCompatibleRuntime.js";
import { OpencodeBridge } from "../../backends/opencode/src/runtime/opencodeBridge.js";

const realFetch = globalThis.fetch;
let lastCall: { url: string; body: unknown } | null = null;

function stubFetchOk(): void {
  lastCall = null;
  globalThis.fetch = (async (url: any, init: any) => {
    lastCall = { url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null };
    return new Response("true", { status: 200 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function makeRuntime(): OpencodeCompatibleRuntime {
  return new OpencodeCompatibleRuntime({
    threadId: "thread-q",
    cwd: process.cwd(),
    serverUrl: "http://127.0.0.1:9",
    serverPassword: "test",
  });
}

describe("opencode question round-trip", () => {
  test("replyQuestion posts answers to /question/:id/reply", async () => {
    stubFetchOk();
    const runtime = makeRuntime();
    expect(await runtime.replyQuestion("que_1", [["Release"], []])).toBe(true);
    expect(lastCall?.url).toBe("http://127.0.0.1:9/question/que_1/reply");
    expect(lastCall?.body).toEqual({ answers: [["Release"], []] });
  });

  test("rejectQuestion posts to /question/:id/reject", async () => {
    stubFetchOk();
    const runtime = makeRuntime();
    expect(await runtime.rejectQuestion("que_9")).toBe(true);
    expect(lastCall?.url).toBe("http://127.0.0.1:9/question/que_9/reject");
  });

  test("respondToQuestionRequest maps modal answers and clears pending", async () => {
    stubFetchOk();
    const runtime = makeRuntime();
    expect(runtime.respondToQuestionRequest("que_unknown", { answers: {} } as any)).toBe(false);

    (runtime as any).registerPendingQuestion({
      kind: "question/asked",
      threadId: "thread-q",
      turnId: "turn-q",
      requestId: "que_2",
      questions: [{ id: "q_1", question: "Which?", header: "H" }],
    });
    expect(runtime.hasPendingQuestion("que_2")).toBe(true);
    expect(
      runtime.respondToQuestionRequest("que_2", { answers: { q_1: { answers: ["A"] } } } as any)
    ).toBe(true);
    expect(runtime.hasPendingQuestion("que_2")).toBe(false);
    // Server call happens async; flush microtasks.
    await new Promise((r) => setTimeout(r, 10));
    expect(lastCall?.url).toBe("http://127.0.0.1:9/question/que_2/reply");
    expect(lastCall?.body).toEqual({ answers: [["A"]] });
  });

  test("cancelled modal rejects the question", async () => {
    stubFetchOk();
    const runtime = makeRuntime();
    (runtime as any).registerPendingQuestion({
      kind: "question/asked",
      threadId: "thread-q",
      turnId: "turn-q",
      requestId: "que_3",
      questions: [{ id: "q_1", question: "Which?", header: "H" }],
    });
    expect(runtime.respondToQuestionRequest("que_3", { answers: {} } as any)).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(lastCall?.url).toBe("http://127.0.0.1:9/question/que_3/reject");
  });

  test("question timeout resolves the UI request and rejects the remote question", async () => {
    stubFetchOk();
    const runtime = makeRuntime();
    const notifications: Array<{ method?: string; params?: Record<string, unknown> }> = [];
    runtime.on("notification", (notification) => notifications.push(notification));
    const originalSetTimeout = globalThis.setTimeout;
    let timeoutHandler: (() => void) | undefined;
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
      if (timeout === 120_000 && typeof handler === "function") {
        timeoutHandler = handler as () => void;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return originalSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout;
    try {
      (runtime as any).registerPendingQuestion({
        kind: "question/asked",
        threadId: "thread-q",
        turnId: "turn-timeout",
        requestId: "que_timeout",
        questions: [{ id: "q_1", question: "Which?", header: "H" }],
      });
      expect(runtime.hasPendingQuestion("que_timeout")).toBe(true);
      timeoutHandler?.();
      expect(runtime.hasPendingQuestion("que_timeout")).toBe(false);
      expect(notifications).toContainEqual({
        method: "serverRequest/resolved",
        params: { requestId: "que_timeout", threadId: "thread-q", turnId: "turn-timeout" },
      });
      await new Promise((resolve) => originalSetTimeout(resolve, 10));
      expect(lastCall?.url).toBe("http://127.0.0.1:9/question/que_timeout/reject");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("serverRequest/resolved removes the owning bridge request", () => {
    const bridge = new OpencodeBridge();
    const runtime = new EventEmitter() as EventEmitter & { stop?: () => void };
    const session = { threadId: "thread-q", runtime } as any;
    (bridge as any).sessions.set("thread-q", session);
    (bridge as any).wireRuntimeEvents(session, runtime);
    (bridge as any).pendingRequestOwners.set("que_timeout", session);

    runtime.emit("notification", {
      method: "serverRequest/resolved",
      params: { requestId: "que_timeout", threadId: "thread-q", turnId: "turn-timeout" },
    });

    expect((bridge as any).pendingRequestOwners.has("que_timeout")).toBe(false);
  });

  test("bridge.respond routes question answers to the owning runtime first", async () => {
    const bridge = new OpencodeBridge();
    const startRes = (await bridge.request("thread/start", { cwd: process.cwd(), model: "default" })) as any;
    const threadId = startRes.threadId;
    const calls: Array<{ id: string; result: unknown }> = [];
    (bridge as any).sessions.get(threadId).runtime = {
      respondToQuestionRequest: (id: string, result: unknown) => {
        calls.push({ id, result });
        return true;
      },
      replyPermission: () => {
        throw new Error("permission path must not run for questions");
      },
    };
    bridge.respond("que_7", { answers: { q_1: { answers: ["B"] } } } as any);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe("que_7");
  });
});
