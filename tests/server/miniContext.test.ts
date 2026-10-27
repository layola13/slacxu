import { afterEach, describe, expect, test } from "bun:test";
import {
  MINI_AUTO_COMPACT_DEFAULT_THRESHOLD,
  MINI_DEFAULT_CONTEXT_WINDOW,
  MINI_SYSTEM_HEAD,
  MiniBridge,
  buildMiniHistorySummaryAsk,
  buildMiniTokenUsage,
  estimateMiniTokens,
  miniAutoCompactEnabled,
  miniAutoCompactThreshold,
  normalizeMiniUsage,
  resolveMiniContextWindow,
  shouldMiniAutoCompact,
} from "../../backends/mini/src/runtime/miniBridge.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.MINI_AUTO_COMPACT;
  delete process.env.MINI_AUTO_COMPACT_THRESHOLD;
});

describe("mini context window", () => {
  test("relay-group setting wins, model variant wins over everything, else 272K", () => {
    expect(MINI_DEFAULT_CONTEXT_WINDOW).toBe(272_000);
    // User-editable relay setting is honored (authoritative over catalog).
    expect(resolveMiniContextWindow("gpt-5-mini", null, 100_000)).toBe(100_000);
    expect(resolveMiniContextWindow("gpt-5-mini", { contextWindow: 50_000 }, 100_000)).toBe(100_000);
    // `[1m]`-style variants are authoritative (Codex parity).
    expect(resolveMiniContextWindow("claude-opus-4-6[1m]", null, 100_000)).toBe(1_000_000);
    // Unknown model without config falls back to the product default.
    expect(resolveMiniContextWindow("gpt-5-mini", null, null)).toBe(272_000);
    expect(resolveMiniContextWindow("", null, null)).toBe(272_000);
  });
});

describe("mini usage accounting", () => {
  test("normalizeMiniUsage accepts chat and responses shapes", () => {
    expect(normalizeMiniUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }))
      .toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(normalizeMiniUsage({ input_tokens: 300, output_tokens: 40, total_tokens: 340 }))
      .toEqual({ inputTokens: 300, outputTokens: 40 });
    expect(normalizeMiniUsage(null)).toBeNull();
    expect(normalizeMiniUsage({})).toBeNull();
    expect(normalizeMiniUsage("nope")).toBeNull();
  });

  test("estimateMiniTokens counts exact o200k tokens and blanks data URLs", () => {
    expect(estimateMiniTokens("")).toBe(0);
    expect(estimateMiniTokens("abcd")).toBe(1);
    expect(estimateMiniTokens("hello world")).toBe(2);
    // Exact BPE merges repeats: 400 x "a" is 50 tokens, not 100.
    expect(estimateMiniTokens("a".repeat(400))).toBe(50);
    const withImage = `see this7085${"data:image/png;base64," + "A".repeat(4000)} done`;
    expect(estimateMiniTokens(withImage)).toBeLessThan(20);
  });

  test("buildMiniTokenUsage matches the composer ring contract", () => {
    const payload = buildMiniTokenUsage(
      { inputTokens: 1000, outputTokens: 200, estimated: false },
      { inputTokens: 900, outputTokens: 50 },
      272_000,
    ) as Record<string, Record<string, number>>;
    expect(payload.total.totalTokens).toBe(1200);
    expect(payload.last.totalTokens).toBe(950);
    // Ring semantics mirror the engine: context load = latest input side.
    expect(payload.contextUsage.totalTokens).toBe(900);
    expect(payload.contextUsage.outputTokens).toBe(0);
    expect(payload.modelContextWindow).toBe(272_000);
  });
});

describe("mini auto-compact policy", () => {
  test("threshold defaults to 80 and clamps to 50-95", () => {
    expect(miniAutoCompactThreshold()).toBe(MINI_AUTO_COMPACT_DEFAULT_THRESHOLD);
    process.env.MINI_AUTO_COMPACT_THRESHOLD = "30";
    expect(miniAutoCompactThreshold()).toBe(50);
    process.env.MINI_AUTO_COMPACT_THRESHOLD = "99";
    expect(miniAutoCompactThreshold()).toBe(95);
    process.env.MINI_AUTO_COMPACT_THRESHOLD = "nope";
    expect(miniAutoCompactThreshold()).toBe(MINI_AUTO_COMPACT_DEFAULT_THRESHOLD);
  });

  test("kill switch disables the barrier", () => {
    expect(miniAutoCompactEnabled()).toBe(true);
    process.env.MINI_AUTO_COMPACT = "off";
    expect(miniAutoCompactEnabled()).toBe(false);
  });

  test("shouldMiniAutoCompact guards tiny history, unknown usage and cooldown", () => {
    const full = { messages: new Array(10).fill({}), lastUsedTokens: 250_000, lastContextWindow: 272_000 };
    expect(shouldMiniAutoCompact(full)).toBe(true);
    expect(shouldMiniAutoCompact({ messages: [{}, {}], lastUsedTokens: 250_000, lastContextWindow: 272_000 })).toBe(false);
    expect(shouldMiniAutoCompact({ messages: full.messages })).toBe(false);
    expect(shouldMiniAutoCompact({ messages: full.messages, lastUsedTokens: 1000, lastContextWindow: 272_000 })).toBe(false);
    expect(shouldMiniAutoCompact({ ...full, lastAutoCompactAt: Date.now() })).toBe(false);
    process.env.MINI_AUTO_COMPACT = "off";
    expect(shouldMiniAutoCompact(full)).toBe(false);
    delete process.env.MINI_AUTO_COMPACT;
  });

  test("shouldMiniAutoCompact uses latest round context load and does not trigger on ~50% context", () => {
    // A 130K context conversation on a 272K window is ~48% full (below 80% default threshold)
    const midContextSession = {
      messages: new Array(10).fill({}),
      lastUsedTokens: 130_000,
      lastContextWindow: 272_000,
    };
    expect(shouldMiniAutoCompact(midContextSession)).toBe(false);

    // But when actual round context exceeds 80% (e.g. 220K on 272K window), it triggers
    const highContextSession = {
      messages: new Array(10).fill({}),
      lastUsedTokens: 220_000,
      lastContextWindow: 272_000,
    };
    expect(shouldMiniAutoCompact(highContextSession)).toBe(true);
  });
});

describe("mini usage notifications", () => {
  function trackBridge(protocol: "chat" | "responses" = "responses"): {
    bridge: MiniBridge;
    notifications: Array<{ method: string; params: Record<string, unknown> }>;
  } {
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol,
        streamMaxRetries: 5,
      }),
      onSnapshot: () => {},
    });
    bridge.on("notification", (n: { method: string; params: Record<string, unknown> }) => {
      notifications.push(n);
    });
    return { bridge, notifications };
  }

  function waitTerminal(bridge: MiniBridge, ms: number): Promise<{ method: string; params: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for turn terminal event")), ms);
      const handler = (n: { method: string; params: Record<string, unknown> }) => {
        if (n.method === "turn/completed" || n.method === "turn/failed" || n.method === "turn/interrupted") {
          clearTimeout(timer);
          bridge.off("notification", handler);
          resolve(n);
        }
      };
      bridge.on("notification", handler);
    });
  }

  test("turn/steer restarts the active turn with the steered prompt", async () => {
    const bridge = new MiniBridge({ onSnapshot: () => {} });
    const started = await bridge.request("thread/start", { cwd: "/tmp/work", model: "gpt-5-mini" }) as Record<string, unknown>;
    const threadId = String(started.threadId);
    const session = (bridge as unknown as { sessions: Map<string, { activeTurnId?: string; pendingSteers?: Array<{ text: string; images?: unknown[] }>; queuedTurns?: Array<{ text: string }> }> }).sessions.get(threadId)!;
    session.activeTurnId = "active-turn";
    const steer = await bridge.request("turn/steer", { threadId, input: [{ type: "text", text: "steer me" }] });
    expect(steer).toMatchObject({ steered: true, turnId: "active-turn", turn: { id: "active-turn", status: "inProgress" } });
    expect(session.pendingSteers).toEqual([{ text: "steer me", images: [] }]);
    expect(session.queuedTurns ?? []).toEqual([]);
  });

  test("turn/steer rejects a stale expected turn id without queueing input", async () => {
    const bridge = new MiniBridge({ onSnapshot: () => {} });
    const started = await bridge.request("thread/start", { cwd: "/tmp/work", model: "gpt-5-mini" }) as Record<string, unknown>;
    const threadId = String(started.threadId);
    const session = (bridge as unknown as { sessions: Map<string, { activeTurnId?: string; queuedTurns?: unknown[] }> }).sessions.get(threadId)!;
    session.activeTurnId = "active-turn";

    await expect(bridge.request("turn/steer", {
      threadId,
      expectedTurnId: "stale-turn",
      input: [{ type: "text", text: "do not queue" }],
    })).rejects.toThrow("Turn is no longer active: stale-turn");
    expect(session.queuedTurns ?? []).toEqual([]);
  });


  test("review/start rejects while another turn is active without mutating the session", async () => {
    const { bridge, notifications } = trackBridge();
    const started = await bridge.request("thread/start", { cwd: "/tmp/work", model: "gpt-5-mini" }) as Record<string, unknown>;
    const threadId = String(started.threadId);
    const session = (bridge as unknown as { sessions: Map<string, { activeTurnId?: string; turns: unknown[]; messages: unknown[] }> }).sessions.get(threadId)!;
    // A genuinely inProgress turn entry: a bare activeTurnId with no turn
    // record is a stale slot by definition and is released by
    // releaseStaleMiniActiveSlot (502/abort race healing), so the fixture
    // must own a live turn for the rejection to apply.
    session.turns.push({ id: "active-turn", status: "inProgress" });
    session.activeTurnId = "active-turn";
    const before = { turns: session.turns.length, messages: session.messages.length };

    await expect(bridge.request("review/start", { threadId })).rejects.toThrow("Turn is already active: active-turn");

    expect(session.activeTurnId).toBe("active-turn");
    expect(session.turns).toHaveLength(before.turns);
    expect(session.messages).toHaveLength(before.messages);
    expect(notifications.filter((event) => event.method === "turn/started")).toHaveLength(0);
  });

  test("thread/delete interrupts an active turn before removing its session", async () => {
    const snapshots: Array<{ turns: Array<{ id: string; status: string }> }> = [];
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    const bridge = new MiniBridge({ onSnapshot: (snapshot) => snapshots.push(snapshot as typeof snapshots[number]) });
    bridge.on("notification", (event: { method: string; params: Record<string, unknown> }) => notifications.push(event));
    const started = await bridge.request("thread/start", { cwd: "/tmp/work", model: "gpt-5-mini" }) as Record<string, unknown>;
    const threadId = String(started.threadId);
    const session = (bridge as unknown as { sessions: Map<string, { activeTurnId?: string; turns: Array<{ id: string; status: string }>; messages: unknown[]; activeAbort?: AbortController; queuedTurns?: unknown[] }> }).sessions.get(threadId)!;
    session.turns.push({ id: "active-turn", status: "inProgress" });
    session.activeTurnId = "active-turn";
    session.activeAbort = new AbortController();
    const activeSignal = session.activeAbort.signal;
    session.queuedTurns = [{ text: "queued", images: [] }];

    await bridge.request("thread/delete", { threadId });

    expect(activeSignal.aborted).toBe(true);
    expect(session.turns.find((turn) => turn.id === "active-turn")?.status).toBe("interrupted");
    expect(session.queuedTurns).toEqual([]);
    expect(bridge.hasSession(threadId)).toBe(false);
    expect(notifications.filter((event) => event.method === "turn/interrupted")).toHaveLength(1);
    expect(snapshots.at(-1)?.turns.find((turn) => turn.id === "active-turn")?.status).toBe("interrupted");
  });

  test("late interrupt from an older turn cannot terminate the newer active turn", async () => {
    const { bridge, notifications } = trackBridge();
    const started = await bridge.request("thread/start", { cwd: "/tmp/work", model: "gpt-5-mini" }) as Record<string, unknown>;
    const threadId = String(started.threadId);
    const session = (bridge as unknown as {
      sessions: Map<string, {
        activeTurnId?: string;
        turns: Array<{ id: string; status: string }>;
      }>;
    }).sessions.get(threadId)!;
    session.turns.push(
      { id: "old-turn", status: "inProgress" },
      { id: "new-turn", status: "inProgress" },
    );
    session.activeTurnId = "new-turn";

    (bridge as any).interruptTurn(session, "old-turn");

    expect(session.activeTurnId).toBe("new-turn");
    expect(session.turns.find((turn) => turn.id === "old-turn")?.status).toBe("inProgress");
    expect(notifications.filter((event) => event.method === "turn/interrupted")).toHaveLength(0);
  });

  function usageEvents(notifications: Array<{ method: string; params: Record<string, unknown> }>): Array<Record<string, unknown>> {
    return notifications
      .filter((n) => n.method === "thread/tokenUsage/updated")
      .map((n) => n.params.tokenUsage as Record<string, unknown>);
  }

  test("responses usage events drive the ring payload with the resolved window", async () => {
    const { bridge, notifications } = trackBridge("responses");
    const frame = (type: string, extra: Record<string, unknown> = {}) =>
      `data: ${JSON.stringify({ type, ...extra })}\n\n`;
    globalThis.fetch = (async () => {
      const body = [
        frame("response.output_text.delta", { delta: "hi" }),
        frame("response.completed", {
          response: { output: [], usage: { input_tokens: 1000, output_tokens: 50, total_tokens: 1050 } },
        }),
        "data: [DONE]\n\n",
      ].join("");
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    await bridge.request("turn/start", { threadId, prompt: "hi", providerId: "p", groupId: "g", model: "test-model" });
    const terminal = await waitTerminal(bridge, 15_000);
    expect(terminal.method).toBe("turn/completed");
    const events = usageEvents(notifications);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1] as Record<string, Record<string, number>>;
    expect(last.total.totalTokens).toBe(1050);
    expect(last.contextUsage.totalTokens).toBe(1000);
    expect(last.modelContextWindow).toBe(272_000);
  }, 20_000);

  test("actual Responses request starts with the Mini system prompt head", async () => {
    const { bridge } = trackBridge("responses");
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const payload = [
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "done" })}\n\n`,
        `data: ${JSON.stringify({ type: "response.completed", response: { output: [], usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } } })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    await bridge.request("turn/start", {
      threadId: started.thread.id, prompt: "verify prompt head", providerId: "p", groupId: "g", model: "test-model",
    });
    expect((await waitTerminal(bridge, 15_000)).method).toBe("turn/completed");
    expect(String(requestBody?.instructions).startsWith(MINI_SYSTEM_HEAD)).toBe(true);
    expect(requestBody?.instructions).toContain("# Mini runtime and tools");
  }, 20_000);

  test("unchanged pending plan fails after a reminder and one bounded escalation", async () => {
    const { bridge } = trackBridge("responses");
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      const output = requests === 1
        ? [{
            type: "function_call",
            call_id: "plan-call",
            name: "update_plan",
            arguments: JSON.stringify({ todos: [{ content: "inspect the fixture", status: "pending" }] }),
          }]
        : [{ type: "message", content: [{ type: "output_text", text: "I will continue shortly." }] }];
      return new Response(JSON.stringify({ output }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    await bridge.request("turn/start", {
      threadId: started.thread.id, prompt: "inspect the fixture", providerId: "p", groupId: "g", model: "test-model",
    });
    expect((await waitTerminal(bridge, 15_000)).method).toBe("turn/failed");
    expect(requests).toBe(4);
  }, 20_000);

  test("chat turns without upstream usage still report an estimate plus window", async () => {
    const { bridge, notifications } = trackBridge("chat");
    globalThis.fetch = (async () => {
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content: "hello there" } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    await bridge.request("turn/start", { threadId, prompt: "hi", providerId: "p", groupId: "g", model: "test-model" });
    const terminal = await waitTerminal(bridge, 15_000);
    expect(terminal.method).toBe("turn/completed");
    const events = usageEvents(notifications);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1] as Record<string, Record<string, number>>;
    expect(last.total.totalTokens).toBeGreaterThan(0);
    expect(last.modelContextWindow).toBe(272_000);
  }, 20_000);

  test("send barrier auto-compacts a full history before the user turn", async () => {
    const { bridge, notifications } = trackBridge("responses");
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (typeof body.instructions === "string" && body.instructions.startsWith("Summarize this coding-agent transcript")) {
        return new Response(JSON.stringify({ output: [{ type: "message", content: [{ text: "compact summary" }] }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      const payload = [
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "done" })}\n\n`,
        `data: ${JSON.stringify({ type: "response.completed", response: { output: [], usage: { input_tokens: 500, output_tokens: 10, total_tokens: 510 } } })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    // First turn grows the history; then fake a nearly-full context.
    await bridge.request("turn/start", { threadId, prompt: "first", providerId: "p", groupId: "g", model: "test-model" });
    await waitTerminal(bridge, 15_000);
    const session = (bridge as unknown as { sessions: Map<string, Record<string, unknown>> }).sessions.get(threadId);
    // Grow the persisted history past the compact guard, then fake a full context.
    (session!.messages as Array<Record<string, unknown>>).push(
      { type: "userMessage", id: "seed-u", turnId: "seed", threadId, text: "seed question", status: "completed" },
      { type: "agentMessage", id: "seed-a", turnId: "seed", threadId, text: "seed answer", status: "completed" },
    );
    session!.lastUsedTokens = 260_000;
    session!.lastContextWindow = 272_000;
    await bridge.request("turn/start", { threadId, prompt: "second", providerId: "p", groupId: "g", model: "test-model" });
    const terminal = await waitTerminal(bridge, 15_000);
    expect(terminal.method).toBe("turn/completed");
    const completedTurns = notifications.filter((n) => n.method === "turn/completed");
    // Auto-compact turn + user turn.
    expect(completedTurns.length).toBe(3);
    const texts = notifications
      .filter((n) => n.method === "item/completed")
      .map((n) => String(((n.params as Record<string, unknown>).item as Record<string, unknown>)?.text ?? ""));
    expect(texts.some((t) => t.includes("auto-compacted"))).toBe(true);
    const stored = (bridge as unknown as { sessions: Map<string, { messages: Array<Record<string, unknown>> }> }).sessions.get(threadId);
    expect(stored?.messages.some((m) => m.type === "contextCompaction" || m.type === "compaction")).toBe(true);
  }, 30_000);

  test("thread/compact/start executes summarize, emits item/started and item/completed for contextCompaction", async () => {
    const { bridge, notifications } = trackBridge("responses");
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (typeof body.instructions === "string" && body.instructions.startsWith("Summarize this coding-agent transcript")) {
        return new Response(JSON.stringify({ output: [{ type: "message", content: [{ text: "compact summary output" }] }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;

    const session = (bridge as unknown as { sessions: Map<string, Record<string, unknown>> }).sessions.get(threadId);
    (session!.messages as Array<Record<string, unknown>>).push(
      { type: "userMessage", id: "seed-u", turnId: "seed", threadId, text: "seed question", status: "completed" },
      { type: "agentMessage", id: "seed-a", turnId: "seed", threadId, text: "seed answer", status: "completed" },
      { type: "userMessage", id: "seed-u2", turnId: "seed2", threadId, text: "seed question 2", status: "completed" },
    );

    const compactRes = (await bridge.request("thread/compact/start", { threadId })) as any;
    expect(compactRes.turn?.status).toBe("inProgress");
    expect(compactRes.turnId).toBeDefined();

    const terminal = await waitTerminal(bridge, 15_000);
    expect(terminal.method).toBe("turn/completed");

    const itemStarted = notifications.find(
      (n) => n.method === "item/started" && (n.params as any)?.item?.type === "contextCompaction"
    );
    expect(itemStarted).toBeDefined();
    expect((itemStarted?.params as any)?.item?.status).toBe("inProgress");
    expect((itemStarted?.params as any)?.item?.title).toBe("Context compaction");

    const itemCompleted = notifications.find(
      (n) => n.method === "item/completed" && (n.params as any)?.item?.type === "contextCompaction"
    );
    expect(itemCompleted).toBeDefined();
    expect((itemCompleted?.params as any)?.item?.status).toBe("completed");

    const stored = (bridge as unknown as { sessions: Map<string, { messages: Array<Record<string, unknown>> }> }).sessions.get(threadId);
    expect(stored?.messages.some((m) => m.type === "contextCompaction")).toBe(true);
  }, 20_000);

  test("compaction preserves an early fact in the next real upstream turn", async () => {
    const { bridge } = trackBridge("responses");
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push(body);
      if (typeof body.instructions === "string" && body.instructions.startsWith("Summarize this coding-agent transcript")) {
        return new Response(JSON.stringify({ output: [{ type: "message", content: [{ text: "summary intentionally omits the fact" }] }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      const payload = [
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "next response" })}\n\n`,
        `data: ${JSON.stringify({ type: "response.completed", response: { output: [], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    const session = (bridge as unknown as { sessions: Map<string, Record<string, unknown>> }).sessions.get(threadId)!;
    (session.messages as Array<Record<string, unknown>>).push(
      { type: "userMessage", id: "fact-u", turnId: "fact", threadId, text: "Remember this unique requirement: use the cobalt deployment lane.", status: "completed" },
      { type: "agentMessage", id: "fact-a", turnId: "fact", threadId, text: "Acknowledged the cobalt deployment lane.", status: "completed" },
      ...Array.from({ length: 20 }, (_, index) => ({
        type: "agentMessage", id: `noise-${index}`, turnId: `noise-${index}`, threadId,
        text: `noise ${index} ${"context ".repeat(400)}`, status: "completed",
      })),
    );

    const compactRes = (await bridge.request("thread/compact/start", { threadId })) as any;
    await waitTerminal(bridge, 15_000);
    expect(compactRes.turnId).toBeDefined();

    await bridge.request("turn/start", {
      threadId, prompt: "Continue with the next step.", providerId: "p", groupId: "g", model: "test-model",
    });
    await waitTerminal(bridge, 15_000);

    const nextRequest = requests.find((body) => Array.isArray(body.input) && JSON.stringify(body.input).includes("Continue with the next step.")) as Record<string, unknown> | undefined;
    expect(nextRequest).toBeDefined();
    expect(JSON.stringify(nextRequest)).toContain("cobalt deployment lane");
  }, 30_000);

  test("late compaction settlement cannot emit into a newer active turn", async () => {
    const { bridge, notifications } = trackBridge("responses");
    let releaseSummary!: () => void;
    const summaryReady = new Promise<void>((resolve) => { releaseSummary = resolve; });
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (typeof body.instructions === "string" && body.instructions.startsWith("Summarize this coding-agent transcript")) {
        await summaryReady;
        return new Response(JSON.stringify({ output: [{ type: "message", content: [{ text: "late summary" }] }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    const session = (bridge as unknown as { sessions: Map<string, Record<string, unknown>> }).sessions.get(threadId)!;
    (session.messages as Array<Record<string, unknown>>).push(
      { type: "userMessage", id: "seed-u", turnId: "seed", threadId, text: "seed question", status: "completed" },
      { type: "agentMessage", id: "seed-a", turnId: "seed", threadId, text: "seed answer", status: "completed" },
    );

    const compactRes = (await bridge.request("thread/compact/start", { threadId })) as any;
    const oldTurnId = String(compactRes.turnId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.activeTurnId = "new-turn";
    releaseSummary();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(notifications.some((n) => n.method === "item/started" && (n.params as any)?.turnId === oldTurnId)).toBe(true);
    expect(notifications.some((n) => n.method === "item/completed" && (n.params as any)?.turnId === oldTurnId)).toBe(false);
    expect(notifications.some((n) => n.method === "turn/completed" && (n.params as any)?.turnId === oldTurnId)).toBe(false);
    expect(session.activeTurnId).toBe("new-turn");
  }, 20_000);
});


describe("buildMiniHistorySummaryAsk", () => {
  test("forces code-state sections and verbatim errors", () => {
    const ask = buildMiniHistorySummaryAsk("", 8000);
    for (const section of ["- GOALS:", "- TOUCHED:", "- ERRORS:", "- PLAN:", "- NEXT:", "- AVOID:"]) {
      expect(ask).toContain(section);
    }
    expect(ask).toContain("VERBATIM");
    expect(ask).toContain("8000");
  });

  test("merges previous summary when present", () => {
    expect(buildMiniHistorySummaryAsk("old state", 4000)).toContain("Merge the previous summary");
    expect(buildMiniHistorySummaryAsk("", 4000)).not.toContain("Merge the previous summary");
  });
});
