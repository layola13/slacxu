import { stripModelContextVariant } from "./modelCapabilities.js";
import type { TokenUsageBreakdown } from "./tokenUsage.js";

export type TokenUsageRate = {
  model: string;
  inputUsdPerMillion?: number;
  cachedInputUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  multiplier?: number;
  inputMultiplier?: number;
  cacheReadMultiplier?: number;
  cacheWriteMultiplier?: number;
  outputMultiplier?: number;
};

export type TokenUsageBillingSnapshot = {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  outputUsdPerMillion: number;
  modelMultiplier: number;
  inputMultiplier: number;
  cacheReadMultiplier: number;
  cacheWriteMultiplier: number;
  outputMultiplier: number;
  groupRatio: number;
};

export type PricedTokenUsage = TokenUsageBreakdown & {
  estimatedCostUsd?: number;
  costBreakdownUsd?: { input: number; cachedInput: number; cacheWrite: number; output: number };
  billingSnapshot?: TokenUsageBillingSnapshot;
};

export const DEFAULT_TOKEN_USAGE_RATES: TokenUsageRate[] = [
  { model: "gpt-5.5", inputUsdPerMillion: 5, cachedInputUsdPerMillion: 0.5, cacheWriteUsdPerMillion: 5, outputUsdPerMillion: 30 },
  { model: "gpt-5.4", inputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 0.25, cacheWriteUsdPerMillion: 2.5, outputUsdPerMillion: 15 },
  { model: "gpt-5.6-sol", inputUsdPerMillion: 5, cachedInputUsdPerMillion: 0.5, cacheWriteUsdPerMillion: 5, outputUsdPerMillion: 30 }
];

export function resolveTokenUsageRate(rates: readonly TokenUsageRate[], model: string, fallbacks: readonly TokenUsageRate[] = DEFAULT_TOKEN_USAGE_RATES): TokenUsageRate | undefined {
  const resolvedModel = model.trim();
  const baseModel = stripModelContextVariant(resolvedModel).baseModel;
  const primary = rates.find((rate) => rate.model === resolvedModel) ?? rates.find((rate) => rate.model === baseModel);
  const fallback = fallbacks.find((rate) => rate.model === resolvedModel) ?? fallbacks.find((rate) => rate.model === baseModel);
  if (!primary) return validRate(fallback) ? fallback : undefined;
  const inputUsdPerMillion = primary.inputUsdPerMillion ?? fallback?.inputUsdPerMillion;
  const outputUsdPerMillion = primary.outputUsdPerMillion ?? fallback?.outputUsdPerMillion;
  if (inputUsdPerMillion == null || outputUsdPerMillion == null) return undefined;
  return {
    ...fallback,
    ...primary,
    inputUsdPerMillion,
    outputUsdPerMillion,
    cachedInputUsdPerMillion: primary.cachedInputUsdPerMillion ?? fallback?.cachedInputUsdPerMillion,
    cacheWriteUsdPerMillion: primary.cacheWriteUsdPerMillion ?? fallback?.cacheWriteUsdPerMillion
  };
}

export function priceNormalizedTokenUsage(usage: TokenUsageBreakdown, rates: readonly TokenUsageRate[], model: string, groupRatio: number, fallbacks: readonly TokenUsageRate[] = DEFAULT_TOKEN_USAGE_RATES): PricedTokenUsage {
  const rate = resolveTokenUsageRate(rates, model, fallbacks);
  if (!rate || rate.inputUsdPerMillion == null || rate.outputUsdPerMillion == null) return usage;
  const cachedTokens = Math.max(0, usage.cachedInputTokens);
  const cacheWriteTokens = Math.max(0, usage.cacheWriteInputTokens);
  const cacheSum = cachedTokens + cacheWriteTokens;
  // 标准口径 input 为包含式：uncached = input - cache。兼容历史非重叠旧行
  //（input < cacheSum 说明 input 本身就是未命中部分），此时直接取 input。
  const standardInputTokens = usage.inputTokens >= cacheSum
    ? Math.max(0, usage.inputTokens - cacheSum)
    : Math.max(0, usage.inputTokens);
  const cachedRate = rate.cachedInputUsdPerMillion ?? rate.inputUsdPerMillion;
  const cacheWriteRate = rate.cacheWriteUsdPerMillion ?? rate.inputUsdPerMillion;
  const modelMultiplier = rate.multiplier ?? 1;
  const inputMultiplier = rate.inputMultiplier ?? modelMultiplier;
  const cacheReadMultiplier = rate.cacheReadMultiplier ?? modelMultiplier;
  const cacheWriteMultiplier = rate.cacheWriteMultiplier ?? modelMultiplier;
  const outputMultiplier = rate.outputMultiplier ?? modelMultiplier;
  const normalizedGroupRatio = Number.isFinite(groupRatio) && groupRatio >= 0 ? groupRatio : 1;
  const input = standardInputTokens * rate.inputUsdPerMillion / 1_000_000 * inputMultiplier * normalizedGroupRatio;
  const cachedInput = cachedTokens * cachedRate / 1_000_000 * cacheReadMultiplier * normalizedGroupRatio;
  const cacheWrite = cacheWriteTokens * cacheWriteRate / 1_000_000 * cacheWriteMultiplier * normalizedGroupRatio;
  const output = usage.outputTokens * rate.outputUsdPerMillion / 1_000_000 * outputMultiplier * normalizedGroupRatio;
  return {
    ...usage,
    estimatedCostUsd: input + cachedInput + cacheWrite + output,
    costBreakdownUsd: { input, cachedInput, cacheWrite, output },
    billingSnapshot: { inputUsdPerMillion: rate.inputUsdPerMillion, cachedInputUsdPerMillion: cachedRate, cacheWriteUsdPerMillion: cacheWriteRate, outputUsdPerMillion: rate.outputUsdPerMillion, modelMultiplier, inputMultiplier, cacheReadMultiplier, cacheWriteMultiplier, outputMultiplier, groupRatio: normalizedGroupRatio }
  };
}

function validRate(rate: TokenUsageRate | undefined): rate is TokenUsageRate & { inputUsdPerMillion: number; outputUsdPerMillion: number } {
  return rate?.inputUsdPerMillion != null && rate.outputUsdPerMillion != null;
}
