import { afterEach, describe, expect, test } from "bun:test";
import {
  MINI_429_MAX_ATTEMPTS,
  MINI_STREAM_RETRY_DEFAULT,
  MiniBridge,
  MINI_DELTA_FLUSH_MS,
  buildMiniCompactTranscript,
  clampMiniStreamMaxRetries,
  formatMiniUpstreamError,
  historyItemToText,
  isMiniRetryableError,
  isMiniRetryableStatus,
  isMiniRoundStreamRetryable,
  isMiniTerminalQuotaError,
  mini429DelayMs,
  miniInterruptFromAbort,
  miniRetryAfterMs,
  miniRetryDelayMs,
  miniRoundStallTimeoutMs,
  rollbackMiniRoundLiveSegments,
  sleepWithMiniAbort,
} from "../../backends/mini/src/runtime/miniBridge.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function okJson(body: unknown, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function statusText(status: number, bodyText: string): Response {
  return new Response(bodyText, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

function sseResponse(frames: string[]): Response {
  const payload = frames.map((f) => `data: ${f}\n\n`).join("");
  return new Response(payload, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("mini relay retry budget", () => {
  test("coalesces streamed text deltas and flushes them before completion", async () => {
    const bridge = new MiniBridge();
    const seen: Array<{ method: string; params: Record<string, unknown> }> = [];
    bridge.on("notification", (notification: { method: string; params: Record<string, unknown> }) => {
      seen.push(notification);
    });
    const session = { threadId: "thread-delta", aborted: false };
    const emitAgentDelta = (bridge as unknown as {
      emitMiniAgentDelta: (s: unknown, turnId: string, itemId: string, delta: string) => void;
      emitMiniItemCompleted: (s: unknown, turnId: string, item: Record<string, unknown>) => void;
    });
    emitAgentDelta.emitMiniAgentDelta(session, "turn-delta", "item-delta", "a");
    emitAgentDelta.emitMiniAgentDelta(session, "turn-delta", "item-delta", "b");
    expect(seen).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, MINI_DELTA_FLUSH_MS + 10));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe("item/agentMessage/delta");
    expect(seen[0]?.params.delta).toBe("ab");

    emitAgentDelta.emitMiniAgentDelta(session, "turn-delta", "item-delta", "c");
    emitAgentDelta.emitMiniItemCompleted(session, "turn-delta", { type: "agentMessage", id: "item-delta" });
    expect(seen).toHaveLength(3);
    expect(seen[1]?.params.delta).toBe("c");
    expect(seen[2]?.method).toBe("item/completed");
  });

  test("clampMiniStreamMaxRetries enforces 5-100 with default 5", () => {
    expect(clampMiniStreamMaxRetries(4)).toBe(5);
    expect(clampMiniStreamMaxRetries(5)).toBe(5);
    expect(clampMiniStreamMaxRetries(37)).toBe(37);
    expect(clampMiniStreamMaxRetries(100)).toBe(100);
    expect(clampMiniStreamMaxRetries(101)).toBe(100);
    expect(clampMiniStreamMaxRetries(undefined)).toBe(MINI_STREAM_RETRY_DEFAULT);
    expect(clampMiniStreamMaxRetries(Number.NaN)).toBe(MINI_STREAM_RETRY_DEFAULT);
    expect(clampMiniStreamMaxRetries("20")).toBe(20);
  });

  test("isMiniRetryableStatus retries transient statuses only", () => {
    expect(isMiniRetryableStatus(408)).toBe(true);
    for (let status = 500; status <= 599; status++) expect(isMiniRetryableStatus(status)).toBe(true);
    for (const status of [200, 400, 401, 404, 429]) expect(isMiniRetryableStatus(status)).toBe(false);
  });

  test("isMiniRetryableError covers network cuts, not aborts", () => {
    expect(isMiniRetryableError(new TypeError("fetch failed"))).toBe(true);
    expect(isMiniRetryableError(new Error("stream connection failed"))).toBe(true);
    expect(isMiniRetryableError(new Error("terminated: socket hang up"))).toBe(true);
    expect(isMiniRetryableError(new SyntaxError("Unexpected end of JSON input"))).toBe(true);
    expect(isMiniRetryableError(new Error("upstream closed stream with empty response"))).toBe(true);
    expect(isMiniRetryableError(new Error("empty stream"))).toBe(true);
    expect(isMiniRetryableError(new DOMException("aborted", "AbortError"))).toBe(false);
    expect(isMiniRetryableError(new Error("interrupted"))).toBe(false);
  });

  test("isMiniRoundStreamRetryable keeps HTTP-status failures on the inner budget", () => {
    expect(isMiniRoundStreamRetryable(new Error("chat 503: Service Unavailable"))).toBe(false);
    expect(isMiniRoundStreamRetryable(new Error("responses 500: boom"))).toBe(false);
    expect(isMiniRoundStreamRetryable(new Error("relay unavailable (502); interrupt, do not retry with new threads"))).toBe(false);
    expect(isMiniRoundStreamRetryable(new TypeError("terminated: socket hang up"))).toBe(true);
    const exhausted = new TypeError("fetch failed");
    (exhausted as Record<string, unknown>).__miniUpstreamRetriesExhausted = true;
    expect(isMiniRoundStreamRetryable(exhausted)).toBe(false);
  });

  test("miniRetryDelayMs backs off exponentially and honors retry-after", () => {
    expect(miniRetryDelayMs(0)).toBe(500);
    expect(miniRetryDelayMs(1)).toBe(1000);
    expect(miniRetryDelayMs(99)).toBe(10_000);
    expect(miniRetryDelayMs(0, 250)).toBe(250);
    expect(miniRetryDelayMs(0, 60_000)).toBe(10_000);
  });

  test("miniRetryAfterMs reads retry-after headers and body hints", () => {
    expect(miniRetryAfterMs(new Headers({ "retry-after": "2" }))).toBe(2000);
    expect(miniRetryAfterMs(new Headers({ "retry-after-ms": "350" }))).toBe(350);
    expect(miniRetryAfterMs(null, "please retry after 3 s")).toBe(3000);
    expect(miniRetryAfterMs(null, "nothing here")).toBeUndefined();
  });
});

describe("mini polluted-history filter", () => {
  test("historyItemToText never feeds error cards or failed segments to the model", () => {
    expect(historyItemToText({ type: "error", text: "chat 500: boom", status: "failed" })).toBe("");
    expect(historyItemToText({ type: "retryError", text: "retrying", status: "running" })).toBe("");
    expect(historyItemToText({ type: "agentMessage", text: "partial", status: "failed" })).toBe("");
    expect(historyItemToText({ type: "agentMessage", text: "half", status: "interrupted" })).toBe("");
  });

  test("historyItemToText drops legacy polluted assistant text but keeps clean turns", () => {
    expect(historyItemToText({ type: "agentMessage", text: "chat 429: daily free limit reached", status: "completed" })).toBe("");
    expect(historyItemToText({ type: "agentMessage", text: "responses 502: bad gateway", status: "completed" })).toBe("");
    expect(historyItemToText({ type: "agentMessage", text: "relay unavailable (503); interrupt", status: "completed" })).toBe("");
    expect(historyItemToText({ type: "agentMessage", text: "上游返回空回复 (empty response); 请重发一次", status: "completed" })).toBe("");
    expect(historyItemToText({ type: "agentMessage", text: "该中转站免费额度已用完，重发不会带上错误内容。", status: "completed" })).toBe("");
    const clean = historyItemToText({ type: "agentMessage", text: "done, see src/a.ts", status: "completed" });
    expect(clean).toContain("done, see src/a.ts");
    expect(historyItemToText({ type: "userMessage", text: "hi", status: "completed" })).toContain("hi");
  });

  test("buildMiniCompactTranscript reuses the same filter", () => {
    const transcript = buildMiniCompactTranscript([
      { type: "userMessage", text: "fix login", status: "completed" },
      { type: "agentMessage", text: "chat 500: internal error", status: "completed" },
      { type: "error", text: "Mini request failed", status: "failed" },
      { type: "retryError", text: "retrying", status: "running" },
      { type: "agentMessage", text: "patched src/login.ts", status: "completed" },
    ] as never[]);
    expect(transcript).toContain("fix login");
    expect(transcript).toContain("patched src/login.ts");
    expect(transcript).not.toContain("chat 500");
    expect(transcript).not.toContain("Mini request failed");
  });

  test("buildMiniCompactTranscript prefers the newest turns under pressure", () => {
    const messages = [
      { type: "userMessage", text: `OLD-MARKER ${"stale ".repeat(3000)}`, status: "completed" },
      { type: "agentMessage", text: "middle work", status: "completed" },
      { type: "agentMessage", text: "NEW-MARKER latest result", status: "completed" },
    ] as never[];
    const transcript = buildMiniCompactTranscript(messages, 500);
    expect(transcript).toContain("NEW-MARKER");
    expect(transcript).not.toContain("OLD-MARKER");
  });

  test("buildMiniCompactTranscript keeps chronological order when everything fits", () => {
    const transcript = buildMiniCompactTranscript([
      { type: "userMessage", text: "first", status: "completed" },
      { type: "agentMessage", text: "second", status: "completed" },
      { type: "agentMessage", text: "third", status: "completed" },
    ] as never[]);
    expect(transcript.indexOf("first")).toBeLessThan(transcript.indexOf("second"));
    expect(transcript.indexOf("second")).toBeLessThan(transcript.indexOf("third"));
  });

  test("rollbackMiniRoundLiveSegments drops only this round's partial segments", () => {
    const messages = rollbackMiniRoundLiveSegments([
      { type: "agentMessage", id: "mini-msg-t-s1", text: "old" },
      { type: "agentMessage", id: "mini-msg-t-s2", text: "partial" },
      { type: "toolCall", id: "mini-tool-t-x", text: "" },
    ] as never[], "mini-msg-t", 1);
    expect(messages.length).toBe(2);
    expect(messages.some((m) => String((m as Record<string, unknown>).id) === "mini-msg-t-s2")).toBe(false);
  });

  test("formatMiniUpstreamError carries the per-relay retry count", () => {
    expect(formatMiniUpstreamError("chat 429: daily free limit reached", 7)).toContain("免费额度已用完");
    expect(formatMiniUpstreamError("responses 429: insufficient_quota", 5)).toContain("免费额度已用完");
    const limited = formatMiniUpstreamError("responses 429: rate limit exceeded, retry later", 5);
    expect(limited).toContain("上游限流");
    expect(limited).toContain("历史未被污染");
    const unavailable = formatMiniUpstreamError("relay unavailable (503); interrupt", 9);
    expect(unavailable).toContain("9");
    expect(unavailable).toContain("历史未被污染");
    expect(formatMiniUpstreamError("boom", 5)).toBe("boom");
  });
});

describe("mini fetchMiniUpstream", () => {
  function bridgeWithNotices(seen: Array<{ method: string; item: Record<string, unknown> }>) {
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol: "chat" as const,
        streamMaxRetries: 5,
      }),
    });
    bridge.on("notification", (n: { method: string; params: { item?: Record<string, unknown> } }) => {
      if (n.params?.item) seen.push({ method: n.method, item: n.params.item });
    });
    return bridge;
  }

  test("retries retryable statuses then reports recovery with counts", async () => {
    const seen: Array<{ method: string; item: Record<string, unknown> }> = [];
    const bridge = bridgeWithNotices(seen);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls <= 2) return statusText(503, "Service Unavailable");
      return okJson({ ok: true });
    }) as typeof fetch;
    const res = await (bridge as unknown as {
      fetchMiniUpstream: (s: unknown, turnId: string, url: string, init: RequestInit, max: number) => Promise<Response>;
    }).fetchMiniUpstream({ threadId: "t", aborted: false }, "turn-1", "https://relay.example/v1/chat/completions", { method: "POST" }, 5);
    expect(res.ok).toBe(true);
    expect(calls).toBe(3);
    const retries = seen.filter((n) => (n.item.payload as Record<string, unknown>)?.willRetry === true);
    expect(retries.length).toBe(2);
    expect((retries[0]?.item.payload as Record<string, unknown>)?.max).toBe(5);
    const recovered = seen.filter((n) => (n.item.payload as Record<string, unknown>)?.recovered === true);
    expect(recovered.length).toBe(1);
    expect((recovered[0]?.item.payload as Record<string, unknown>)?.attempt).toBe(2);
    expect((recovered[0]?.item.payload as Record<string, unknown>)?.max).toBe(5);
  });

  test("does not retry non-retryable statuses", async () => {
    const seen: Array<{ method: string; item: Record<string, unknown> }> = [];
    const bridge = bridgeWithNotices(seen);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return statusText(400, "bad request");
    }) as typeof fetch;
    const res = await (bridge as unknown as {
      fetchMiniUpstream: (s: unknown, turnId: string, url: string, init: RequestInit, max: number) => Promise<Response>;
    }).fetchMiniUpstream({ threadId: "t", aborted: false }, "turn-1", "https://relay.example/v1/chat/completions", { method: "POST" }, 5);
    expect(res.status).toBe(400);
    expect(calls).toBe(1);
    expect(seen.length).toBe(0);
  });

  test("retries network errors and tags exhausted throws", async () => {
    const seen: Array<{ method: string; item: Record<string, unknown> }> = [];
    const bridge = bridgeWithNotices(seen);
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const err = await (bridge as unknown as {
      fetchMiniUpstream: (s: unknown, turnId: string, url: string, init: RequestInit, max: number) => Promise<Response>;
    }).fetchMiniUpstream({ threadId: "t", aborted: false }, "turn-1", "https://relay.example/v1/chat/completions", { method: "POST" }, 1).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    expect((err as Record<string, unknown>).__miniUpstreamRetriesExhausted).toBe(true);
    expect(isMiniRoundStreamRetryable(err)).toBe(false);
    expect(seen.filter((n) => (n.item.payload as Record<string, unknown>)?.willRetry === true).length).toBe(1);
  });
});

describe("mini 429 rate-limit retry", () => {
  function status429(bodyText: string, retryAfter?: string): Response {
    const headers: Record<string, string> = { "content-type": "text/plain" };
    if (retryAfter !== undefined) headers["retry-after"] = retryAfter;
    return new Response(bodyText, { status: 429, headers });
  }

  type FetchUpstream = (s: unknown, turnId: string, url: string, init: RequestInit, max: number) => Promise<Response>;

  function bridgeWithNotices(seen: Array<{ method: string; item: Record<string, unknown> }>): MiniBridge {
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol: "chat" as const,
        streamMaxRetries: 5,
      }),
    });
    bridge.on("notification", (n: { method: string; params: { item?: Record<string, unknown> } }) => {
      if (n.params?.item) seen.push({ method: n.method, item: n.params.item });
    });
    return bridge;
  }

  function callUpstream(bridge: MiniBridge, max = 5): Promise<Response> {
    return (bridge as unknown as { fetchMiniUpstream: FetchUpstream }).fetchMiniUpstream(
      { threadId: "t", aborted: false }, "turn-1", "https://relay.example/v1/chat/completions", { method: "POST" }, max,
    );
  }

  function willRetryNotices(seen: Array<{ item: Record<string, unknown> }>): Array<Record<string, unknown>> {
    return seen.map((n) => n.item).filter((item) => (item.payload as Record<string, unknown>)?.willRetry === true);
  }

  test("isMiniTerminalQuotaError separates dead quota from transient limits", () => {
    for (const body of [
      "insufficient_quota: you exceeded your current quota",
      "Error 429: daily free limit reached",
      "账户余额不足，请充值",
      "invalid_api_key: Incorrect API key provided",
      "access_denied for this model",
    ]) expect(isMiniTerminalQuotaError(body)).toBe(true);
    for (const body of [
      "rate limit exceeded, retry after 2s",
      "429 Too Many Requests",
      "TPM limit reached, try again later",
      "",
      "Service Unavailable",
    ]) expect(isMiniTerminalQuotaError(body)).toBe(false);
  });

  test("mini429DelayMs follows the gateway cadence and caps retry-after", () => {
    expect(mini429DelayMs(0)).toBe(2000);
    expect(mini429DelayMs(1)).toBe(5000);
    expect(mini429DelayMs(2)).toBe(10000);
    expect(mini429DelayMs(99)).toBe(10000);
    expect(mini429DelayMs(0, 1500)).toBe(1500);
    expect(mini429DelayMs(0, 120_000)).toBe(10_000);
  });

  test("rate-limit 429s are retried with notices, then recovery is reported", async () => {
    const seen: Array<{ method: string; item: Record<string, unknown> }> = [];
    const bridge = bridgeWithNotices(seen);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls <= 2) return status429("rate limit exceeded", "0");
      return okJson({ ok: true });
    }) as typeof fetch;
    const res = await callUpstream(bridge);
    expect(res.ok).toBe(true);
    expect(calls).toBe(3);
    const retries = willRetryNotices(seen);
    expect(retries.length).toBe(2);
    expect(String(retries[0]?.text)).toContain("429");
    const recovered = seen.map((n) => n.item).filter((item) => (item.payload as Record<string, unknown>)?.recovered === true);
    expect(recovered.length).toBe(1);
  });

  test("quota 429s fail fast with no retry notices", async () => {
    const seen: Array<{ method: string; item: Record<string, unknown> }> = [];
    const bridge = bridgeWithNotices(seen);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return status429("insufficient_quota: billing limit reached");
    }) as typeof fetch;
    const res = await callUpstream(bridge);
    expect(res.status).toBe(429);
    expect(calls).toBe(1);
    expect(seen.length).toBe(0);
  });

  test("sustained rate limits exhaust the bounded 429 budget, not the stream budget", async () => {
    const seen: Array<{ method: string; item: Record<string, unknown> }> = [];
    const bridge = bridgeWithNotices(seen);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return status429("rate limit exceeded", "0");
    }) as typeof fetch;
    // streamMaxRetries=100 must not turn a dead limit into a minute-long loop.
    const res = await callUpstream(bridge, 100);
    expect(res.status).toBe(429);
    expect(calls).toBe(1 + MINI_429_MAX_ATTEMPTS);
    expect(willRetryNotices(seen).length).toBe(MINI_429_MAX_ATTEMPTS);
    // Callers shape the error from the body; it must still be readable.
    expect(res.bodyUsed).toBe(false);
    expect(await res.text()).toContain("rate limit exceeded");
  });

  test("quota 429 body stays readable for the caller error message", async () => {
    const bridge = bridgeWithNotices([]);
    globalThis.fetch = (async () => status429("insufficient_quota: billing limit reached")) as typeof fetch;
    const res = await callUpstream(bridge);
    expect(res.status).toBe(429);
    expect(await res.text()).toContain("insufficient_quota");
  });

  test("exhausted 429s stay on the inner budget (no round-level double retry)", () => {
    expect(isMiniRoundStreamRetryable(new Error("responses 429: rate limit exceeded"))).toBe(false);
    expect(isMiniRoundStreamRetryable(new Error("chat 429: Too Many Requests"))).toBe(false);
  });
});

describe("mini mid-stream retry", () => {  test("a cleanly truncated SSE body is retried instead of completing partial text", async () => {
    const enc = new TextEncoder();
    const goodFrame = JSON.stringify({ choices: [{ delta: { content: "hello-done" } }] });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        const bad = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial-" } }] })}\n\n`));
            controller.close();
          },
        });
        return new Response(bad, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return sseResponse([goodFrame, "[DONE]"]);
    }) as typeof fetch;

    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol: "chat" as const,
        streamMaxRetries: 5,
      }),
      onSnapshot: () => {},
    });
    bridge.on("notification", (n: { method: string; params: Record<string, unknown> }) => {
      notifications.push(n);
    });
    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "test-model",
      providerId: "p",
      groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    await bridge.request("turn/start", { threadId, prompt: "say hi briefly", providerId: "p", groupId: "g", model: "test-model" });
    const terminal = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for turn terminal event")), 15_000);
      const handler = (n: { method: string; params: Record<string, unknown> }) => {
        if ((n.method === "turn/completed" || n.method === "turn/failed") && (n.params as Record<string, unknown>).turnId) {
          clearTimeout(timer);
          bridge.off("notification", handler);
          resolve({ method: n.method, params: n.params });
        }
      };
      bridge.on("notification", handler);
    });
    expect(terminal.method).toBe("turn/completed");
    expect(calls).toBe(2);
    const retryNotices = notifications.filter(
      (n) => n.method === "item/completed" && ((n.params as Record<string, unknown>).item as Record<string, unknown>)?.type === "retryError",
    );
    expect(retryNotices.length).toBeGreaterThanOrEqual(1);
    const rollbackNotice = notifications.find((notification) => notification.method === "mini/item/rollback");
    // Echo-gate behavior: the truncated 8-char "partial-" never materialized
    // to a live segment (nothing emitted), so there is nothing to roll back.
    // The stale partial text is dropped from the buffer on retry instead.
    expect(rollbackNotice).toBeUndefined();
    const streamedItemIds = notifications
      .filter((notification) => notification.method === "item/agentMessage/delta")
      .map((notification) => String(notification.params.itemId ?? ""))
      .filter(Boolean);
    expect(new Set(streamedItemIds).size).toBe(streamedItemIds.length);
    // Single materialization: the retried round streams the full text as -s1.
    expect(streamedItemIds.some((id) => id.endsWith("-s1"))).toBe(true);
    const stored = (bridge as unknown as { sessions: Map<string, { messages: Array<Record<string, unknown>> }> }).sessions.get(threadId);
    const assistants = (stored?.messages ?? []).filter((m) => m.type === "agentMessage");
    expect(assistants.length).toBe(1);
    expect(String(assistants[0]?.text)).toBe("hello-done");
    const failed = (stored?.messages ?? []).filter((m) => m.type === "error");
    expect(failed.length).toBe(0);
  }, 20_000);

  test("a Responses stream without response.completed retries instead of completing early", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        return sseResponse([JSON.stringify({ type: "response.output_text.delta", delta: "partial-" })]);
      }
      return sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "complete" }),
        JSON.stringify({ type: "response.completed", response: { id: "response-1", output: [] } }),
      ]);
    }) as typeof fetch;

    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol: "responses" as const,
        streamMaxRetries: 5,
      }),
      onSnapshot: () => {},
    });
    bridge.on("notification", (notification: { method: string; params: Record<string, unknown> }) => notifications.push(notification));
    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    const terminalPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for turn terminal event")), 15_000);
      const handler = (notification: { method: string; params: Record<string, unknown> }) => {
        if ((notification.method === "turn/completed" || notification.method === "turn/failed") && notification.params.turnId) {
          clearTimeout(timer);
          bridge.off("notification", handler);
          resolve({ method: notification.method, params: notification.params });
        }
      };
      bridge.on("notification", handler);
    });
    await bridge.request("turn/start", { threadId, prompt: "say hi briefly", providerId: "p", groupId: "g", model: "test-model" });
    const terminal = await terminalPromise;
    expect(terminal.method).toBe("turn/completed");
    expect(calls).toBe(2);
    const stored = (bridge as unknown as { sessions: Map<string, { messages: Array<Record<string, unknown>> }> }).sessions.get(threadId);
    const assistants = (stored?.messages ?? []).filter((message) => message.type === "agentMessage");
    expect(assistants).toHaveLength(1);
    expect(String(assistants[0]?.text)).toBe("complete");
    expect(notifications.some((notification) => notification.method === "turn/failed")).toBe(false);
  }, 20_000);

  test("an SSE stream that closes with empty content retries on the inner budget instead of failing immediately", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        return sseResponse([]);
      }
      return sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "recovered after empty stream" } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      ]);
    }) as typeof fetch;

    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol: "chat" as const,
        streamMaxRetries: 5,
      }),
      onSnapshot: () => {},
    });
    bridge.on("notification", (notification: { method: string; params: Record<string, unknown> }) => notifications.push(notification));
    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    const terminalPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for turn terminal event")), 15_000);
      const handler = (notification: { method: string; params: Record<string, unknown> }) => {
        if ((notification.method === "turn/completed" || notification.method === "turn/failed") && notification.params.turnId) {
          clearTimeout(timer);
          bridge.off("notification", handler);
          resolve({ method: notification.method, params: notification.params });
        }
      };
      bridge.on("notification", handler);
    });
    await bridge.request("turn/start", { threadId, prompt: "say hi briefly", providerId: "p", groupId: "g", model: "test-model" });
    const terminal = await terminalPromise;
    expect(terminal.method).toBe("turn/completed");
    expect(calls).toBe(2);
    const stored = (bridge as unknown as { sessions: Map<string, { messages: Array<Record<string, unknown>> }> }).sessions.get(threadId);
    const assistants = (stored?.messages ?? []).filter((message) => message.type === "agentMessage");
    expect(assistants).toHaveLength(1);
    expect(String(assistants[0]?.text)).toBe("recovered after empty stream");
    expect(notifications.some((notification) => notification.method === "turn/failed")).toBe(false);
  }, 20_000);
});

describe("mini stall watchdog and interrupt", () => {
  test("miniInterruptFromAbort routes user-stop aborts to interrupted", () => {
    const abortErr = new DOMException("aborted", "AbortError");
    expect(miniInterruptFromAbort({ aborted: true }, abortErr)?.message).toBe("interrupted");
    expect(miniInterruptFromAbort({ aborted: false }, abortErr)).toBeNull();
    expect(miniInterruptFromAbort({ aborted: true }, new Error("boom"))).toBeNull();
    expect(miniInterruptFromAbort({}, abortErr)).toBeNull();
  });

  test("sleepWithMiniAbort wakes early on abort", async () => {
    await sleepWithMiniAbort(5, undefined);
    const ctrl = new AbortController();
    const pending = sleepWithMiniAbort(30_000, ctrl.signal).then(
      () => "resolved",
      (e: unknown) => (e instanceof DOMException && e.name === "AbortError" ? "aborted" : "other"),
    );
    ctrl.abort();
    expect(await pending).toBe("aborted");
  });

  test("miniRoundStallTimeoutMs honors the env override", () => {
    const prev = process.env.MINI_STALL_TIMEOUT_MS;
    try {
      process.env.MINI_STALL_TIMEOUT_MS = "321";
      expect(miniRoundStallTimeoutMs()).toBe(321);
      process.env.MINI_STALL_TIMEOUT_MS = "nope";
      expect(miniRoundStallTimeoutMs()).toBeGreaterThanOrEqual(5000);
    } finally {
      if (prev === undefined) delete process.env.MINI_STALL_TIMEOUT_MS;
      else process.env.MINI_STALL_TIMEOUT_MS = prev;
    }
  });

  function hungSseResponse(signal?: AbortSignal | null): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        if (signal?.aborted) {
          c.error(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            try {
              c.error(new DOMException("aborted", "AbortError"));
            } catch {
              /* ignore */
            }
          },
          { once: true },
        );
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  function trackBridge() {
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol: "chat" as const,
        streamMaxRetries: 5,
      }),
      onSnapshot: () => {},
    });
    bridge.on("notification", (n: { method: string; params: Record<string, unknown> }) => {
      notifications.push(n);
    });
    return { bridge, notifications };
  }

  function waitTerminal(
    bridge: MiniBridge,
    ms: number,
  ): Promise<{ method: string; params: Record<string, unknown> }> {
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

  test("a hung stream is stalled, retried, then completes", async () => {
    const prev = process.env.MINI_STALL_TIMEOUT_MS;
    process.env.MINI_STALL_TIMEOUT_MS = "400";
    try {
      const goodFrame = JSON.stringify({ choices: [{ delta: { content: "back-online" } }] });
      let calls = 0;
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        calls++;
        if (calls === 1) return hungSseResponse(init?.signal);
        return sseResponse([goodFrame, "[DONE]"]);
      }) as typeof fetch;
      const { bridge, notifications } = trackBridge();
      const started = (await bridge.request("thread/start", {
        cwd: process.cwd(),
        model: "test-model",
        providerId: "p",
        groupId: "g",
      })) as unknown as { thread: { id: string } };
      const threadId = started.thread.id;
      await bridge.request("turn/start", { threadId, prompt: "say hi briefly", providerId: "p", groupId: "g", model: "test-model" });
      const terminal = await waitTerminal(bridge, 15_000);
      expect(terminal.method).toBe("turn/completed");
      expect(calls).toBe(2);
      const stalled = notifications.filter(
        (n) =>
          n.method === "item/completed" &&
          String(((n.params as Record<string, unknown>).item as Record<string, unknown>)?.text ?? "").includes("stalled"),
      );
      expect(stalled.length).toBeGreaterThanOrEqual(1);
      const stored = (bridge as unknown as { sessions: Map<string, { messages: Array<Record<string, unknown>> }> }).sessions.get(threadId);
      const assistants = (stored?.messages ?? []).filter((m) => m.type === "agentMessage");
      expect(assistants.length).toBe(1);
      expect(String(assistants[0]?.text)).toBe("back-online");
    } finally {
      if (prev === undefined) delete process.env.MINI_STALL_TIMEOUT_MS;
      else process.env.MINI_STALL_TIMEOUT_MS = prev;
    }
  }, 20_000);

  test("Stop interrupts a hung stream promptly", async () => {
    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls++;
      return hungSseResponse(init?.signal);
    }) as typeof fetch;
    const { bridge } = trackBridge();
    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "test-model",
      providerId: "p",
      groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    await bridge.request("turn/start", { threadId, prompt: "say hi briefly", providerId: "p", groupId: "g", model: "test-model" });
    const terminalPromise = waitTerminal(bridge, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const interrupted = (await bridge.request("turn/interrupt", { threadId })) as unknown as { ok: boolean };
    expect(interrupted.ok).toBe(true);
    const terminal = await terminalPromise;
    expect(terminal.method).toBe("turn/interrupted");
    expect(calls).toBe(1);
    const stored = (bridge as unknown as { sessions: Map<string, { turns: Array<Record<string, unknown>> }> }).sessions.get(threadId);
    expect(stored?.turns[stored.turns.length - 1]?.status).toBe("interrupted");
  }, 15_000);

  test("a stopped turn waiting for tool input cannot resume into a newer turn", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        const toolCall = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "ask-1", type: "function", function: { name: "request_user_input", arguments: JSON.stringify({ questions: [{ id: "confirm", question: "Continue?", options: ["Yes", "No"] }] }) } }] } }] });
        return sseResponse([toolCall, "[DONE]"]);
      }
      const answer = JSON.stringify({ choices: [{ delta: { content: "new turn finished" } }] });
      return sseResponse([answer, "[DONE]"]);
    }) as typeof fetch;

    const { bridge } = trackBridge();
    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    const requestInput = new Promise<void>((resolve) => {
      bridge.once("message", (message: { method?: string }) => {
        if (message.method === "item/tool/requestUserInput") resolve();
      });
    });
    await bridge.request("turn/start", { threadId, prompt: "ask me", providerId: "p", groupId: "g", model: "test-model" });
    await requestInput;
    const firstTurnId = (bridge as unknown as { sessions: Map<string, { activeTurnId?: string }> }).sessions.get(threadId)?.activeTurnId;
    expect(firstTurnId).toBeTruthy();

    const stopped = await bridge.request("turn/interrupt", { threadId, turnId: firstTurnId });
    expect((stopped as { ok: boolean }).ok).toBe(true);
    await bridge.request("turn/start", { threadId, prompt: "你好", providerId: "p", groupId: "g", model: "test-model" });

    const newTurnId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for newer turn")), 5000);
      const handler = (notification: { method: string; params: Record<string, unknown> }) => {
        if (notification.method !== "turn/completed" || notification.params.turnId === firstTurnId) return;
        clearTimeout(timer);
        bridge.off("notification", handler);
        resolve(String(notification.params.turnId));
      };
      bridge.on("notification", handler);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(newTurnId).not.toBe(firstTurnId);
    expect(calls).toBe(2);
    const session = (bridge as unknown as { sessions: Map<string, { turns: Array<{ id: string; status: string }>; activeTurnId?: string; messages: Array<Record<string, unknown>> }> }).sessions.get(threadId);
    expect(session?.turns.find((turn) => turn.id === firstTurnId)?.status).toBe("interrupted");
    expect(session?.turns.find((turn) => turn.id === newTurnId)?.status).toBe("completed");
    expect(session?.activeTurnId).toBeUndefined();
    expect(session?.messages.some((item) => item.turnId === firstTurnId && item.type === "agentMessage")).toBe(false);
  }, 10_000);
});
