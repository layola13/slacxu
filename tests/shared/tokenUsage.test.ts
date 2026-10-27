import { expect, test } from "bun:test";
import { normalizeTokenUsage } from "../../packages/shared/src/tokenUsage.ts";

test("normalizes Anthropic cache fields without inventing reasoning", () => {
  // Anthropic input_tokens 为非重叠（不含缓存）：标准口径 input 为包含式 150。
  expect(normalizeTokenUsage({ input_tokens: 100, cache_read_input_tokens: 40, cache_creation_input_tokens: 10, output_tokens: 20 }, "anthropic")).toMatchObject({
    inputTokens: 150, cachedInputTokens: 40, cacheWriteInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 0, reasoningIncludedInOutput: true,
    totalTokens: 170, uncachedInputTokens: 100,
  });
});

test("normalizes OpenAI cache and reasoning fields", () => {
  // OpenAI prompt_tokens 为包含式：input 保持 100，total = 100 + 20。
  expect(normalizeTokenUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 5 } }, "openai")).toMatchObject({
    inputTokens: 100, cachedInputTokens: 40, cacheWriteInputTokens: 10, outputTokens: 20, totalTokens: 120,
  });
});

test("treats OpenAI Responses usage (input_tokens + *_details) as inclusive, not Anthropic", () => {
  // Responses: input_tokens 已含缓存、output_tokens 已含推理（axonhub 同口径）。
  expect(normalizeTokenUsage({ input_tokens: 1000, input_tokens_details: { cached_tokens: 600 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 200 } })).toMatchObject({
    source: "openai", inputTokens: 1000, cachedInputTokens: 600, outputTokens: 300, reasoningOutputTokens: 200, totalTokens: 1300, uncachedInputTokens: 400,
  });
});

test("ring payload flagged reasoningIncludedInOutput does not double-count reasoning", () => {
  expect(normalizeTokenUsage({ totalTokens: 1300, inputTokens: 1000, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 200, reasoningIncludedInOutput: true })).toMatchObject({
    inputTokens: 1000, outputTokens: 300, totalTokens: 1300,
  });
});

test("normalizes Gemini usage metadata", () => {
  expect(normalizeTokenUsage({ promptTokenCount: 100, candidatesTokenCount: 20, cachedContentTokenCount: 40 }, "gemini")).toMatchObject({
    inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, totalTokens: 120,
  });
});

test("normalizes opencode exclusive splits to inclusive standard", () => {
  // OpenCode 非重叠：input=未命中100 + 读80 + 写20 = 200；output=可见10 + 推理30 = 40；total=240。
  expect(normalizeTokenUsage({ inputTokens: 100, cachedInputTokens: 80, cacheWriteInputTokens: 20, outputTokens: 10, reasoningOutputTokens: 30 }, "opencode")).toMatchObject({
    inputTokens: 200, cachedInputTokens: 80, cacheWriteInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 30, totalTokens: 240,
  });
});
