/**
 * Model capability discovery shared by the server and web composer.
 *
 * Relay model lists are not consistent: some return only strings, while others
 * expose reasoning/context metadata. Keep the wire model id intact, but use a
 * normalized id for capability lookup so suffixes such as `[1m]` are safe.
 */

export type ReasoningEffortValue = string;

/** Responses API `text.verbosity` levels (codex-rs `OpenAiVerbosity`). */
export type ModelVerbosity = "low" | "medium" | "high";

export type ModelCapabilityDescriptor = {
  reasoningEfforts?: ReasoningEffortValue[];
  contextWindow?: number;
  maxOutputTokens?: number;
  /** Responses `text.verbosity` value to request for this model. */
  verbosity?: ModelVerbosity;
  /** Explicit tri-state: `false` forbids `text.verbosity`, `true` allows it for an otherwise unknown id. */
  supportsVerbosity?: boolean;
  source?: "upstream" | "catalog" | "inferred";
};

export type ModelContextVariant = {
  model: string;
  baseModel: string;
  contextWindow: number;
};

export const DEFAULT_REASONING_EFFORTS = ["low", "medium", "high"] as const;

const MAX_REASONING_EFFORT_LENGTH = 64;
const CLAUDE_1M_MODEL_PATTERN = /(?:^|[\/-])claude-(?:fable-5|mythos-5(?:-preview)?|mythos-preview|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6)(?:[\/-]|$)/i;
const CLAUDE_MAX_MODEL_PATTERN = CLAUDE_1M_MODEL_PATTERN;
const CLAUDE_XHIGH_MODEL_PATTERN = /(?:^|[\/-])claude-(?:fable-5|mythos-5|opus-5|opus-4-[78]|sonnet-5)(?:[\/-]|$)/i;
const CLAUDE_NATIVE_EFFORT_MODEL_PATTERN = /(?:^|[\/-])claude-(?:fable|opus|sonnet)(?:[\/-]|$)/i;
const GPT_XHIGH_MODEL_PATTERN = /(?:^|[\/-])gpt-5-(?:4(?:-mini)?|5)(?:[\/-]|$)/i;
const GPT_6_MODEL_PATTERN = /gpt-6(?:-|$)/i;
const GPT_56_MODEL_PATTERN = /(?:^|[\/-])gpt-5-6(?:[\.-]|$)/i;

/**
 * Per-model `default_verbosity` mirrored from the upstream Codex model catalog
 * (`codex-rs/models-manager/models.json`). Official clients only serialize
 * Responses `text.verbosity` for models whose `support_verbosity` is true, and
 * they send that model's own default rather than a single global value, so
 * `gpt-5.4-mini` (medium) and `gpt-daybreak-red-latest` (high) must not be
 * flattened to `low`. Order matters: the `-mini` variant is matched before the
 * bare `gpt-5-4` family.
 */
const MODEL_VERBOSITY_DEFAULTS: ReadonlyArray<{ pattern: RegExp; verbosity: ModelVerbosity }> = [
  { pattern: /(?:^|[\/-])gpt-5-4-mini(?:[\/-]|$)/, verbosity: "medium" },
  { pattern: /(?:^|[\/-])gpt-daybreak-red(?:[\/-]|$)/, verbosity: "high" },
  { pattern: /(?:^|[\/-])gpt-6(?:[\/-]|$)/, verbosity: "low" },
  { pattern: /(?:^|[\/-])gpt-5-6(?:[\/-]|$)/, verbosity: "low" },
  { pattern: /(?:^|[\/-])gpt-5-[245](?:[\/-]|$)/, verbosity: "low" },
  { pattern: /(?:^|[\/-])gpt-daybreak-blue(?:[\/-]|$)/, verbosity: "low" },
  { pattern: /(?:^|[\/-])codex-auto-review(?:[\/-]|$)/, verbosity: "low" }
];

export function normalizeModelVerbosity(value: unknown): ModelVerbosity | undefined {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "low" || raw === "medium" || raw === "high" ? raw : undefined;
}

/** The `default_verbosity` official Codex sends for this model, if it supports verbosity at all. */
export function inferModelVerbosity(model: string): ModelVerbosity | undefined {
  const normalized = normalizedModelId(model);
  return MODEL_VERBOSITY_DEFAULTS.find((entry) => entry.pattern.test(normalized))?.verbosity;
}

/** Remove a relay context modifier while retaining the exact wire model id. */
export function stripModelContextVariant(model: string): { baseModel: string; contextWindow?: number } {
  const value = model.trim();
  const match = value.match(/\[(\d+(?:\.\d+)?)\s*([km])\]$/i);
  if (!match) return { baseModel: value };
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const multiplier = unit === "m" ? 1_000_000 : 1_000;
  const contextWindow = Number.isFinite(amount) && amount > 0 ? Math.round(amount * multiplier) : undefined;
  return { baseModel: value.slice(0, match.index).trim(), contextWindow };
}

export function normalizedModelId(model: string): string {
  return stripModelContextVariant(model).baseModel
    .trim()
    .toLowerCase()
    .replace(/[._\s]+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Infer only capabilities that are published by the product model family.
 * This is deliberately model-id based, never relay/channel-name based, so the
 * same model works through Flux, another relay, or a direct Anthropic endpoint.
 */
export function inferModelCapabilities(model: string): ModelCapabilityDescriptor {
  const normalized = normalizedModelId(model);
  // OpenCode zen free tier: 1M default, `big-pickle` stays 200K. Scoped to the
  // opencode provider family (mirrors `isOpencodeFreeModel`) so other relays'
  // `-free`/`:free` ids are untouched.
  const opencodeFamily = normalized.match(/^(?:opencode|oc|opencode-zen|opencode-go)[/-](.+)$/);
  if (opencodeFamily) {
    const bare = opencodeFamily[1] ?? "";
    if (bare === "big-pickle") return { contextWindow: 200_000, source: "inferred" };
    if (bare.endsWith("-free") || bare.endsWith(":free")) return { contextWindow: 1_000_000, source: "inferred" };
  }
  if (/(?:^|[\/-])muse-spark-(?:[^/]+)$/.test(normalized)) {
    return { contextWindow: 1_000_000, source: "inferred" };
  }
  if (GPT_56_MODEL_PATTERN.test(normalized) || GPT_6_MODEL_PATTERN.test(normalized)) {
    return { reasoningEfforts: [...DEFAULT_REASONING_EFFORTS, "xhigh", "max", "ultra"], source: "inferred" };
  }
  if (GPT_XHIGH_MODEL_PATTERN.test(normalized)) {
    return { reasoningEfforts: [...DEFAULT_REASONING_EFFORTS, "xhigh"], source: "inferred" };
  }
  if (CLAUDE_NATIVE_EFFORT_MODEL_PATTERN.test(normalized)) {
    return {
      reasoningEfforts: [...DEFAULT_REASONING_EFFORTS, "xhigh", "max", "ultra"],
      ...(CLAUDE_1M_MODEL_PATTERN.test(normalized) ? { contextWindow: 1_000_000, maxOutputTokens: 128_000 } : {}),
      source: "inferred"
    };
  }
  if (!CLAUDE_1M_MODEL_PATTERN.test(normalized)) return {};
  const reasoningEfforts: string[] = [...DEFAULT_REASONING_EFFORTS];
  const mythosPreview = /(?:^|[\/-])claude-mythos-(?:5-)?preview(?:[\/-]|$)/i.test(normalized);
  if (CLAUDE_XHIGH_MODEL_PATTERN.test(normalized) && !mythosPreview) reasoningEfforts.push("xhigh");
  if (CLAUDE_MAX_MODEL_PATTERN.test(normalized)) reasoningEfforts.push("max", "ultra");
  return {
    reasoningEfforts,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    source: "inferred"
  };
}

export function mergeModelCapabilities(model: string, explicit?: ModelCapabilityDescriptor): ModelCapabilityDescriptor {
  const inferred = inferModelCapabilities(model);
  const explicitEfforts = normalizeReasoningEfforts(explicit?.reasoningEfforts);
  const inferredEfforts = normalizeReasoningEfforts(inferred.reasoningEfforts);
  const reasoningEfforts = explicitEfforts.length > 0
    ? uniqueStrings([...explicitEfforts, ...inferredEfforts])
    : inferredEfforts;
  const contextWindow = explicit?.contextWindow && explicit.contextWindow > 0
    ? Math.round(explicit.contextWindow)
    : stripModelContextVariant(model).contextWindow ?? inferred.contextWindow;
  const maxOutputTokens = explicit?.maxOutputTokens && explicit.maxOutputTokens > 0
    ? Math.round(explicit.maxOutputTokens)
    : inferred.maxOutputTokens;
  const verbosity = resolveModelVerbosity(model, explicit);
  return {
    ...(reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(verbosity ? { verbosity, supportsVerbosity: true } : {}),
    ...(explicit?.source ? { source: explicit.source } : inferred.source ? { source: inferred.source } : {})
  };
}

/**
 * Resolve the Responses `text.verbosity` to send, or `undefined` when the model
 * must not receive the field. Mirrors `codex-rs/core/src/client.rs`:
 * an explicit request wins, then an explicit capability, then the model
 * family default; `supportsVerbosity: false` always wins and suppresses the
 * field, which is the escape hatch for strict upstreams that 400 on unknown
 * `text` members.
 */
export function resolveModelVerbosity(model: string, explicit?: ModelCapabilityDescriptor): ModelVerbosity | undefined {
  if (explicit?.supportsVerbosity === false) return undefined;
  return normalizeModelVerbosity(explicit?.verbosity)
    ?? (explicit?.supportsVerbosity === true ? "low" : inferModelVerbosity(model));
}

export function resolveReasoningEfforts(model: string, explicit?: ModelCapabilityDescriptor): string[] {
  const merged = mergeModelCapabilities(model, explicit);
  return merged.reasoningEfforts?.length ? merged.reasoningEfforts : [...DEFAULT_REASONING_EFFORTS];
}

export function resolveModelContextWindow(model: string, explicit?: ModelCapabilityDescriptor, groupContextWindow?: number): number | undefined {
  const merged = mergeModelCapabilities(model, explicit);
  const variantWindow = stripModelContextVariant(model).contextWindow;
  if (variantWindow) return variantWindow;
  if (groupContextWindow && groupContextWindow > 0) return Math.round(groupContextWindow);
  if (merged.contextWindow && merged.source !== "inferred") return merged.contextWindow;
  return merged.contextWindow;
}

export function resolveModelMaxOutputTokens(model: string, explicit?: ModelCapabilityDescriptor): number | undefined {
  return mergeModelCapabilities(model, explicit).maxOutputTokens;
}

/**
 * Label a model choice for the picker. Upstream ids and relay display names can
 * already carry their own `[1m]` marker, so the context badge is appended only
 * when the resolved label does not have one yet.
 */
export function modelChoiceDisplayName(model: string, label?: string): string {
  const value = model.trim();
  const { baseModel } = stripModelContextVariant(value);
  const suffix = value.slice(baseModel.length).trim();
  const resolved = label?.trim() || (suffix ? baseModel : value);
  if (!suffix || stripModelContextVariant(resolved).contextWindow) return resolved;
  return `${resolved} ${suffix.toUpperCase()}`;
}

/** Add virtual `[1m]` choices without changing the persisted relay model list. */
export function expandModelContextVariants(models: string[]): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const value = model.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    expanded.push(value);
    const capabilities = inferModelCapabilities(value);
    if (capabilities.contextWindow === 1_000_000 && !stripModelContextVariant(value).contextWindow) {
      const variant = `${value}[1m]`;
      if (!seen.has(variant)) {
        seen.add(variant);
        expanded.push(variant);
      }
    }
  }
  return expanded;
}

export function normalizeReasoningEfforts(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return uniqueStrings(values.flatMap((value) => {
    if (typeof value === "string") return [value];
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const effort = [record.reasoningEffort, record.reasoning_effort, record.value, record.id]
      .find((entry): entry is string => typeof entry === "string");
    return effort ? [effort] : [];
  }).map((value) => value.trim()).filter((value) => value.length > 0 && value.length <= MAX_REASONING_EFFORT_LENGTH && value.toLowerCase() !== "minimal"));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
