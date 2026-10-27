import { expect, test } from "bun:test";
import type { ProviderConfig } from "@codex-ui/shared";
import { priceTokenBreakdown, sumTokenBreakdowns } from "../../apps/web/src/app/usage/usagePricing";

function provider(rate: NonNullable<ProviderConfig["modelRates"]>[number]): ProviderConfig {
  return { id: "test", name: "Test", type: "openai", baseUrl: "https://example.test", models: [rate.model], modelRates: [rate] } as ProviderConfig;
}

const usage = { totalTokens: 122_605, inputTokens: 117_842, cachedInputTokens: 114_176, cacheWriteInputTokens: 0, outputTokens: 4_763, reasoningOutputTokens: 0 };

test("prices input, cached input, output, and group ratio with one reproducible formula", () => {
  const priced = priceTokenBreakdown(usage, provider({
    model: "claude-test", inputUsdPerMillion: 2, cachedInputUsdPerMillion: 2, outputUsdPerMillion: 2,
    multiplier: 1, inputMultiplier: 1, cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1, outputMultiplier: 6
  }), "claude-test", 0.08);
  expect(priced.costBreakdownUsd).toEqual({
    input: 3_666 * 2 / 1_000_000 * 0.08,
    cachedInput: 114_176 * 2 / 1_000_000 * 0.1 * 0.08,
    cacheWrite: 0,
    output: 4_763 * 2 / 1_000_000 * 6 * 0.08
  });
  expect(priced.estimatedCostUsd).toBeCloseTo(0.006985856, 12);
  expect(priced.billingSnapshot).toMatchObject({ modelMultiplier: 1, cacheReadMultiplier: 0.1, outputMultiplier: 6, groupRatio: 0.08 });
});

test("separates cache writes from ordinary input and applies their own multiplier", () => {
  const priced = priceTokenBreakdown({ ...usage, inputTokens: 120, cachedInputTokens: 50, cacheWriteInputTokens: 20, outputTokens: 10 }, provider({
    model: "cache-write", inputUsdPerMillion: 2, cachedInputUsdPerMillion: 1, cacheWriteUsdPerMillion: 4, outputUsdPerMillion: 8,
    multiplier: 1, inputMultiplier: 2, cacheReadMultiplier: 0.5, cacheWriteMultiplier: 3, outputMultiplier: 4
  }), "cache-write", 0.25);
  expect(priced.costBreakdownUsd).toEqual({
    input: 50 * 2 / 1_000_000 * 2 * 0.25,
    cachedInput: 50 * 1 / 1_000_000 * 0.5 * 0.25,
    cacheWrite: 20 * 4 / 1_000_000 * 3 * 0.25,
    output: 10 * 8 / 1_000_000 * 4 * 0.25
  });
});

test("supports free groups and normalizes invalid group ratios", () => {
  const rate = provider({ model: "ratio", inputUsdPerMillion: 2, outputUsdPerMillion: 4, multiplier: 1 });
  expect(priceTokenBreakdown(usage, rate, "ratio", 0).estimatedCostUsd).toBe(0);
  expect(priceTokenBreakdown(usage, rate, "ratio", Number.NaN).billingSnapshot?.groupRatio).toBe(1);
  expect(priceTokenBreakdown(usage, rate, "ratio", -1).billingSnapshot?.groupRatio).toBe(1);
});

test("unknown models retain token usage without inventing a price", () => {
  const priced = priceTokenBreakdown(usage, undefined, "unknown-model", 0.08);
  expect(priced).toBe(usage);
  expect(priced.estimatedCostUsd).toBeUndefined();
});

test("project totals sum token and partial cost data without dropping known costs", () => {
  const total = sumTokenBreakdowns([
    { ...usage, estimatedCostUsd: 0.01, costBreakdownUsd: { input: 0.002, cachedInput: 0.001, cacheWrite: 0, output: 0.007 } },
    { ...usage, totalTokens: 10, inputTokens: 6, cachedInputTokens: 0, outputTokens: 4 },
    { ...usage, totalTokens: 20, inputTokens: 12, cachedInputTokens: 2, outputTokens: 8, estimatedCostUsd: 0.03, costBreakdownUsd: { input: 0.01, cachedInput: 0.002, cacheWrite: 0.003, output: 0.015 } }
  ]);
  expect(total).toMatchObject({ totalTokens: 122_635, inputTokens: 117_860, outputTokens: 4_775, estimatedCostUsd: 0.04 });
  expect(total?.costBreakdownUsd).toEqual({ input: 0.012, cachedInput: 0.003, cacheWrite: 0.003, output: 0.022 });
});

test("empty project usage remains absent instead of reporting a misleading zero", () => {
  expect(sumTokenBreakdowns([])).toBeUndefined();
});
