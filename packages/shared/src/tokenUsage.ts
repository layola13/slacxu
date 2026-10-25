export type TokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type TokenUsageSource = "openai" | "anthropic" | "gemini" | "normalized" | "opencode";

export type NormalizedTokenUsage = TokenUsageBreakdown & {
  source: TokenUsageSource;
  reasoningIncludedInOutput?: boolean;
  /**
   * 标准口径（本次统计修复后固化）：
   * - inputTokens = 包含缓存的全部输入（uncached + cachedRead + cacheWrite）。
   * - outputTokens = 包含推理的全部输出（visible + reasoning）。
   * - cachedInputTokens / cacheWriteInputTokens / reasoningOutputTokens = 非重叠拆分。
   * - totalTokens = inputTokens + outputTokens。
   * 上游语义不同：OpenAI/Gemini 输入输出均为包含式；Anthropic/Opencode 输入为
   * 非重叠（input_tokens 不含缓存），Anthropic 输出包含推理、Opencode 输出为可见
   * 输出（需另加 reasoning）。归一化时统一为包含式，定价与聚合只按此口径计算。
   */
  uncachedInputTokens?: number;
};

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeTokenUsage(value: unknown, sourceHint?: TokenUsageSource): NormalizedTokenUsage | null {
  const usage = record(value);
  const promptDetails = record(usage.prompt_tokens_details ?? usage.input_tokens_details);
  const completionDetails = record(usage.completion_tokens_details ?? usage.output_tokens_details);
  // OpenAI Responses 也用 input_tokens/output_tokens，但带 *_tokens_details 且为包含式
  //（对齐 axonhub：PromptTokens 含缓存、CompletionTokens 含推理），不能按 Anthropic 非重叠处理。
  const responsesShape = ("input_tokens_details" in usage || "output_tokens_details" in usage)
    && !("cache_read_input_tokens" in usage || "cache_creation_input_tokens" in usage);
  const source: TokenUsageSource = sourceHint
    ?? (responsesShape ? "openai"
      : "cache_read_input_tokens" in usage || "cache_creation_input_tokens" in usage || "input_tokens" in usage ? "anthropic"
      : "promptTokenCount" in usage || "cachedContentTokenCount" in usage ? "gemini"
        : "prompt_tokens" in usage || "completion_tokens" in usage ? "openai" : "normalized");
  const inputTokens = finite(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount) ?? 0;
  const cachedInputTokens = finite(usage.cachedInputTokens ?? usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? usage.cached_tokens ?? promptDetails.cached_tokens ?? usage.cachedContentTokenCount) ?? 0;
  const cacheWriteInputTokens = finite(usage.cacheWriteInputTokens ?? usage.cache_write_input_tokens ?? usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? promptDetails.cache_write_tokens) ?? 0;
  const outputTokens = finite(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount) ?? 0;
  const reasoningOutputTokens = finite(usage.reasoningOutputTokens ?? usage.reasoning_output_tokens ?? usage.reasoning_tokens ?? usage.reasoningTokenCount ?? completionDetails.reasoning_tokens ?? completionDetails.reasoningTokenCount) ?? 0;
  if (inputTokens === 0 && cachedInputTokens === 0 && cacheWriteInputTokens === 0 && outputTokens === 0 && reasoningOutputTokens === 0) return null;
  const reasoningIncludedInOutput =
    (source === "anthropic" && reasoningOutputTokens === 0)
    || (usage.reasoningIncludedInOutput === true);
  // 输入：openai/gemini 为包含式（input 已含缓存），其余为非重叠拆分（input 为未命中部分）。
  // 兼容历史已按包含式写入的 normalized 旧行：用 raw total 作启发式校验，
  // 若包含式假设更接近 raw total，则视为包含式，避免二次加总虚高。
  const rawTotal = finite(usage.totalTokens ?? usage.total_tokens) ?? null;
  let inclusiveInput: number;
  if (source === "openai" || source === "gemini") {
    inclusiveInput = Math.max(inputTokens, cachedInputTokens + cacheWriteInputTokens);
  } else if (rawTotal != null && cachedInputTokens + cacheWriteInputTokens > 0) {
    const exclusiveHyp = inputTokens + cachedInputTokens + cacheWriteInputTokens;
    const inclusiveHyp = Math.max(inputTokens, cachedInputTokens + cacheWriteInputTokens);
    const outputHyp = reasoningIncludedInOutput
      ? Math.max(outputTokens, reasoningOutputTokens)
      : outputTokens + reasoningOutputTokens;
    const diffExclusive = Math.abs(rawTotal - (exclusiveHyp + outputHyp));
    const diffInclusive = Math.abs(rawTotal - (inclusiveHyp + outputHyp));
    inclusiveInput = diffInclusive + 1 < diffExclusive ? inclusiveHyp : exclusiveHyp;
  } else {
    inclusiveInput = inputTokens + cachedInputTokens + cacheWriteInputTokens;
  }
  // 输出：包含式上游（openai/gemini/anthropic 显式标记）取 max，其余可见+推理求和。
  const inclusiveOutput = reasoningIncludedInOutput || source === "openai" || source === "gemini"
    ? Math.max(outputTokens, reasoningOutputTokens)
    : outputTokens + reasoningOutputTokens;
  const uncached = Math.max(0, inclusiveInput - cachedInputTokens - cacheWriteInputTokens);
  return {
    totalTokens: inclusiveInput + inclusiveOutput,
    inputTokens: inclusiveInput,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens: inclusiveOutput,
    reasoningOutputTokens,
    source,
    uncachedInputTokens: uncached,
    ...(reasoningIncludedInOutput ? { reasoningIncludedInOutput: true } : {})
  };
}
