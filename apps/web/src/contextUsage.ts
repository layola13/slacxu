export const CONTEXT_USAGE_BASELINE_TOKENS = 12_000;

/** Product default context window (mirrors the engine catalog fallback). */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 272_000;

export type ContextUsageInput = {
  usedTokens: number;
  contextWindow: number | null;
};

export type ContextUsageMetrics = {
  usedTokens: number;
  contextWindow: number | null;
  ratio: number;
  percentage: number | null;
};

export function resolveDisplayedContextWindow(
  threadContextWindow: number | null | undefined,
  configuredContextWindow: number | null | undefined,
  groupContextWindow?: number | null | undefined,
  modelVariantContextWindow?: number | null | undefined
): number | null {
  // Explicit model variants (for example `[1m]`) are authoritative, followed
  // by the relay-group limit, then the live CLI `/stats` value and defaults.
  return modelVariantContextWindow && modelVariantContextWindow > 0
    ? Math.round(modelVariantContextWindow)
    : groupContextWindow && groupContextWindow > 0
    ? Math.round(groupContextWindow)
    : threadContextWindow ?? configuredContextWindow ?? null;
}

export function resolveReportedContextWindow(
  cliBackend: string | null | undefined,
  reportedContextWindow: number | null | undefined,
  configuredContextWindow: number | null | undefined,
  groupContextWindow?: number | null | undefined,
  modelVariantContextWindow?: number | null | undefined
): number | null {
  if (modelVariantContextWindow && modelVariantContextWindow > 0) {
    return Math.round(modelVariantContextWindow);
  }
  if (groupContextWindow && groupContextWindow > 0) {
    return Math.round(groupContextWindow);
  }
  if (cliBackend === "claude" && configuredContextWindow && configuredContextWindow > 0) {
    return configuredContextWindow;
  }
  return reportedContextWindow ?? configuredContextWindow ?? null;
}

export function resolveContextWindowOverrideUpdate(
  runtimeModel: string,
  configuredContextWindow: number | null
): number | null | undefined {
  return runtimeModel.trim() ? configuredContextWindow : undefined;
}

export function contextUsageMetrics(usage?: ContextUsageInput | null): ContextUsageMetrics {
  const contextWindow = usage?.contextWindow && usage.contextWindow > 0 ? usage.contextWindow : null;
  const usedTokens = Math.max(0, usage?.usedTokens ?? 0);
  if (!contextWindow) return { usedTokens, contextWindow: null, ratio: 0, percentage: null };
  const effectiveWindow = Math.max(1, contextWindow - CONTEXT_USAGE_BASELINE_TOKENS);
  const effectiveUsed = Math.max(0, usedTokens - CONTEXT_USAGE_BASELINE_TOKENS);
  const ratio = Math.min(1, effectiveUsed / effectiveWindow);
  return { usedTokens, contextWindow, ratio, percentage: Math.round(ratio * 100) };
}
