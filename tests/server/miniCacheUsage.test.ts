import { afterEach, describe, expect, test } from "bun:test";
import {
  MiniBridge,
  buildMiniTokenUsage,
  mergeMiniUsageDelta,
  normalizeMiniUsage,
  type MiniUsageDelta,
} from "../../backends/mini/src/runtime/miniBridge.js";

type UsagePayload = {
  total: Required<MiniUsageDelta> & { totalTokens: number };
  last: Required<MiniUsageDelta> & { totalTokens: number };
  contextUsage: Required<MiniUsageDelta> & { totalTokens: number };
  modelContextWindow: number;
};

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("Mini cache usage normalization", () => {
  test("chat totals already include cache and reasoning", () => {
    expect(normalizeMiniUsage({
      prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100,
      prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 200 },
      completion_tokens_details: { reasoning_tokens: 40 },
    })).toEqual({
      inputTokens: 1000, outputTokens: 100,
      cachedInputTokens: 600, cacheWriteInputTokens: 200, reasoningOutputTokens: 40,
    });
  });

  test("Responses and gateway-converted usage are inclusive too", () => {
    expect(normalizeMiniUsage({
      input_tokens: 1000, output_tokens: 100,
      input_tokens_details: { cached_tokens: 600, cache_write_tokens: 200 },
      output_tokens_details: { reasoning_tokens: 40 },
      // Do not add raw aliases a second time when nested OpenAI details exist.
      cache_read_input_tokens: 600, cache_creation_input_tokens: 200,
    })).toEqual({
      inputTokens: 1000, outputTokens: 100,
      cachedInputTokens: 600, cacheWriteInputTokens: 200, reasoningOutputTokens: 40,
    });
  });

  test("raw Anthropic input excludes cache read and write", () => {
    expect(normalizeMiniUsage({
      input_tokens: 200, output_tokens: 100,
      cache_read_input_tokens: 600, cache_creation_input_tokens: 200,
      reasoning_tokens: 40,
    })).toEqual({
      inputTokens: 1000, outputTokens: 100,
      cachedInputTokens: 600, cacheWriteInputTokens: 200, reasoningOutputTokens: 40,
    });
  });

  test("top-level OpenAI aliases remain subsets, including zero", () => {
    expect(normalizeMiniUsage({
      prompt_tokens: 1000, completion_tokens: 100,
      cached_tokens: 600, cache_write_tokens: 200, reasoning_tokens: 0,
    })).toEqual({
      inputTokens: 1000, outputTokens: 100,
      cachedInputTokens: 600, cacheWriteInputTokens: 200, reasoningOutputTokens: 0,
    });
  });

  test("missing details preserve legacy objects and invalid usage falls back", () => {
    expect(normalizeMiniUsage({ prompt_tokens: 100, completion_tokens: 20 }))
      .toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(normalizeMiniUsage({ input_tokens: 100, output_tokens: 20 }))
      .toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(normalizeMiniUsage({ output_tokens: 20 }))
      .toEqual({ inputTokens: 0, outputTokens: 20 });
    for (const raw of [null, "bad", {}, { input_tokens: NaN, output_tokens: -1 }]) {
      expect(normalizeMiniUsage(raw)).toBeNull();
    }
    expect(normalizeMiniUsage({
      prompt_tokens: 100.9, completion_tokens: 20.9,
      prompt_tokens_details: { cached_tokens: -1, cache_write_tokens: Infinity },
      completion_tokens_details: { reasoning_tokens: "10" },
    })).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  test("cache-only and reasoning-only usage retain known tokens", () => {
    expect(normalizeMiniUsage({ input_tokens_details: { cached_tokens: 600, cache_write_tokens: 200 } }))
      .toEqual({ inputTokens: 800, outputTokens: 0, cachedInputTokens: 600, cacheWriteInputTokens: 200 });
    expect(normalizeMiniUsage({ cache_read_input_tokens: 600, cache_creation_input_tokens: 200 }))
      .toEqual({ inputTokens: 800, outputTokens: 0, cachedInputTokens: 600, cacheWriteInputTokens: 200 });
    expect(normalizeMiniUsage({ output_tokens_details: { reasoning_tokens: 40 } }))
      .toEqual({ inputTokens: 0, outputTokens: 40, reasoningOutputTokens: 40 });
  });
});

describe("Mini cache usage aggregation", () => {
  test("merging deltas retains every subset without adding it to total input", () => {
    const first: MiniUsageDelta = { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 600, cacheWriteInputTokens: 200, reasoningOutputTokens: 40 };
    const second: MiniUsageDelta = { inputTokens: 300, outputTokens: 50, cachedInputTokens: 100, reasoningOutputTokens: 20 };
    const merged = mergeMiniUsageDelta(first, second)!;
    expect(merged).toEqual({ inputTokens: 1300, outputTokens: 150, cachedInputTokens: 700, cacheWriteInputTokens: 200, reasoningOutputTokens: 60 });
    expect(mergeMiniUsageDelta(first, null)).toBe(first);
    expect(mergeMiniUsageDelta(null, second)).toBe(second);
    expect(mergeMiniUsageDelta(null, null)).toBeNull();
    expect(mergeMiniUsageDelta({ inputTokens: 10, outputTokens: 5 }, { inputTokens: 20, outputTokens: 10 }))
      .toEqual({ inputTokens: 30, outputTokens: 15 });

    const usage = buildMiniTokenUsage({ ...merged, estimated: false }, second, 272_000) as UsagePayload;
    expect(usage.total).toEqual({ ...merged, totalTokens: 1450, reasoningIncludedInOutput: true });
    expect(usage.last).toEqual({ ...second, cacheWriteInputTokens: 0, totalTokens: 350, reasoningIncludedInOutput: true });
    expect(usage.contextUsage).toEqual({ ...second, cacheWriteInputTokens: 0, totalTokens: 300, outputTokens: 0, reasoningOutputTokens: 0, reasoningIncludedInOutput: true });
    expect(usage.modelContextWindow).toBe(272_000);
  });

  test("legacy estimated objects still publish zero subsets", () => {
    const usage = buildMiniTokenUsage(
      { inputTokens: 1000, outputTokens: 200, estimated: true },
      { inputTokens: 900, outputTokens: 50 }, 272_000,
    ) as UsagePayload;
    expect(usage.total).toEqual({ inputTokens: 1000, outputTokens: 200, totalTokens: 1200, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningOutputTokens: 0, reasoningIncludedInOutput: true });
    expect(usage.last.totalTokens).toBe(950);
    expect(usage.contextUsage.totalTokens).toBe(900);
  });

  for (const protocol of ["chat", "responses", "anthropic"] as const) {
    test(`${protocol} counts cumulative streaming snapshots once, including repeated cache/input`, async () => {
      let requests = 0;
      globalThis.fetch = (async () => {
        requests++;
        const usage = protocol === "chat" ? {
          prompt_tokens: 1000, completion_tokens: 100,
          prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 200 },
          completion_tokens_details: { reasoning_tokens: 40 },
        } : protocol === "responses" ? {
          input_tokens: 1000, output_tokens: 100,
          input_tokens_details: { cached_tokens: 600, cache_write_tokens: 200 },
          output_tokens_details: { reasoning_tokens: 40 },
        } : {
          input_tokens: 200, output_tokens: 100,
          cache_read_input_tokens: 600, cache_creation_input_tokens: 200,
          reasoning_tokens: 40,
        };
        const events = protocol === "chat" ? [
          { choices: [], usage: { ...usage, completion_tokens: 1 } },
          { choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] },
          { choices: [], usage: { ...usage, completion_tokens: 50 } },
          { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
        ] : protocol === "responses" ? [
          { type: "response.output_text.delta", delta: "hi" },
          { type: "response.completed", response: { output: [], usage } },
          { type: "response.completed", response: { output: [], usage } },
        ] : [
          { type: "message_start", message: { usage: { input_tokens: 200, output_tokens: 1, cache_read_input_tokens: 600, cache_creation_input_tokens: 200 } } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
          // Anthropic's delta output_tokens is cumulative, not additional output.
          { type: "message_delta", delta: {}, usage: { output_tokens: 50 } },
          { type: "message_delta", delta: { stop_reason: "end_turn" }, usage },
          { type: "message_stop" },
        ];
        return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch;
      const bridge = new MiniBridge({
        resolveRelayTarget: async () => ({ baseUrl: "https://mini-cache.invalid/v1", apiKey: "test", protocol }),
        onSnapshot: () => {},
      });
      const usages: UsagePayload[] = [];
      bridge.on("notification", (event: { method: string; params: Record<string, unknown> }) => {
        if (event.method === "thread/tokenUsage/updated") usages.push(event.params.tokenUsage as UsagePayload);
      });
      const started = await bridge.request("thread/start", { cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g" }) as { thread: { id: string } };
      let timer: ReturnType<typeof setTimeout>;
      const terminal = new Promise<string>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Mini turn timed out")), 15_000);
        bridge.on("notification", (event: { method: string }) => {
          if (["turn/completed", "turn/failed", "turn/interrupted"].includes(event.method)) resolve(event.method);
        });
      });
      try {
        await bridge.request("turn/start", { threadId: started.thread.id, prompt: "hi", providerId: "p", groupId: "g", model: "test-model" });
        expect(await terminal).toBe("turn/completed");
        expect(requests).toBe(1);
        expect(usages).toHaveLength(1);
        expect(usages[0].total).toEqual({ totalTokens: 1100, inputTokens: 1000, outputTokens: 100, cachedInputTokens: 600, cacheWriteInputTokens: 200, reasoningOutputTokens: 40, reasoningIncludedInOutput: true });
        expect(usages[0].last).toEqual(usages[0].total);
        expect(usages[0].contextUsage.totalTokens).toBe(1000);
        expect(usages[0].contextUsage.cachedInputTokens).toBe(600);
        expect(usages[0].contextUsage.cacheWriteInputTokens).toBe(200);
        expect(usages[0].contextUsage.reasoningOutputTokens).toBe(0);
      } finally {
        clearTimeout(timer!);
        await bridge.request("thread/delete", { threadId: started.thread.id });
      }
    }, 20_000);
  }
});
