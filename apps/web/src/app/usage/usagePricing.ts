import { DEFAULT_TOKEN_USAGE_RATES, priceNormalizedTokenUsage, type ProviderConfig } from "@codex-ui/shared";
import type { ThreadTokenUsageState, TokenUsageBreakdown } from "../../components/ChatPanel";

export const DEFAULT_MODEL_RATES: NonNullable<ProviderConfig["modelRates"]> = DEFAULT_TOKEN_USAGE_RATES.map((rate) => ({ ...rate, multiplier: rate.multiplier ?? 1 }));

export function applyTokenUsagePricing(usage: ThreadTokenUsageState, provider: ProviderConfig | undefined, model: string, groupRatio: number): ThreadTokenUsageState {
  return {
    ...usage,
    total: priceTokenBreakdown(usage.total, provider, model, groupRatio),
    last: priceTokenBreakdown(usage.last, provider, model, groupRatio)
  };
}

export function priceTokenBreakdown(usage: TokenUsageBreakdown, provider: ProviderConfig | undefined, model: string, groupRatio: number): TokenUsageBreakdown {
  return priceNormalizedTokenUsage(usage, provider?.modelRates ?? [], model, groupRatio, DEFAULT_TOKEN_USAGE_RATES) as TokenUsageBreakdown;
}

export function priceTokenBreakdownFromSnapshot(usage: TokenUsageBreakdown, snapshot: NonNullable<TokenUsageBreakdown["billingSnapshot"]>): TokenUsageBreakdown {
  const cachedTokens = Math.max(0, usage.cachedInputTokens);
  const cacheWriteTokens = Math.max(0, usage.cacheWriteInputTokens);
  const standardInputTokens = Math.max(0, usage.inputTokens - cachedTokens - cacheWriteTokens);
  const input = standardInputTokens * snapshot.inputUsdPerMillion / 1_000_000 * snapshot.inputMultiplier * snapshot.groupRatio;
  const cachedInput = cachedTokens * snapshot.cachedInputUsdPerMillion / 1_000_000 * snapshot.cacheReadMultiplier * snapshot.groupRatio;
  const cacheWrite = cacheWriteTokens * snapshot.cacheWriteUsdPerMillion / 1_000_000 * snapshot.cacheWriteMultiplier * snapshot.groupRatio;
  const output = usage.outputTokens * snapshot.outputUsdPerMillion / 1_000_000 * snapshot.outputMultiplier * snapshot.groupRatio;
  return { ...usage, estimatedCostUsd: input + cachedInput + cacheWrite + output, costBreakdownUsd: { input, cachedInput, cacheWrite, output }, billingSnapshot: snapshot };
}

export function sumTokenBreakdowns(values: TokenUsageBreakdown[]): TokenUsageBreakdown | undefined {
  if (values.length === 0) return undefined;
  return values.reduce<TokenUsageBreakdown>((total, usage) => {
    const hasCost = total.estimatedCostUsd != null || usage.estimatedCostUsd != null;
    const hasBreakdown = Boolean(total.costBreakdownUsd || usage.costBreakdownUsd);
    return {
      totalTokens: total.totalTokens + usage.totalTokens,
      inputTokens: total.inputTokens + usage.inputTokens,
      cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
      cacheWriteInputTokens: total.cacheWriteInputTokens + usage.cacheWriteInputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      reasoningOutputTokens: total.reasoningOutputTokens + usage.reasoningOutputTokens,
      ...(hasCost ? { estimatedCostUsd: (total.estimatedCostUsd ?? 0) + (usage.estimatedCostUsd ?? 0) } : {}),
      ...(hasBreakdown ? { costBreakdownUsd: {
        input: (total.costBreakdownUsd?.input ?? 0) + (usage.costBreakdownUsd?.input ?? 0),
        cachedInput: (total.costBreakdownUsd?.cachedInput ?? 0) + (usage.costBreakdownUsd?.cachedInput ?? 0),
        cacheWrite: (total.costBreakdownUsd?.cacheWrite ?? 0) + (usage.costBreakdownUsd?.cacheWrite ?? 0),
        output: (total.costBreakdownUsd?.output ?? 0) + (usage.costBreakdownUsd?.output ?? 0)
      } } : {})
    };
  }, { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 });
}
