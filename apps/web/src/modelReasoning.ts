import {
  mergeModelCapabilities,
  normalizeReasoningEfforts,
  resolveReasoningEfforts,
  stripModelContextVariant,
  type ChannelGroupConfig,
  type ModelCapabilityDescriptor,
  type RelayCatalogModel
} from "@codex-ui/shared";
import type { ModelEntry } from "./state/codexClient";

export type ComposerReasoningOption = {
  value: string;
  label: string;
  description?: string;
};

export function reasoningOptionsForModel(input: {
  model: string;
  modelEntry?: ModelEntry;
  group?: ChannelGroupConfig;
  catalogModel?: RelayCatalogModel;
}): ComposerReasoningOption[] {
  const baseModel = stripModelContextVariant(input.model).baseModel;
  const groupCapability = input.group?.modelCapabilities?.[input.model]
    ?? input.group?.modelCapabilities?.[baseModel];
  const catalogCapability = capabilityFromUnknown(input.catalogModel?.extensions, "catalog");
  const modelEntryEfforts = input.modelEntry?.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort) ?? [];
  const explicit = mergeExplicitCapabilities(
    groupCapability,
    catalogCapability,
    modelEntryEfforts.length > 0 ? { reasoningEfforts: modelEntryEfforts, source: "catalog" } : undefined
  );
  const descriptions = new Map(input.modelEntry?.supportedReasoningEfforts?.map((entry) => [entry.reasoningEffort, entry.description]) ?? []);
  return resolveReasoningEfforts(input.model, explicit).map((effort) => ({
    value: effort,
    label: reasoningEffortLabel(effort),
    description: descriptions.get(effort) ?? reasoningEffortDescription(effort)
  }));
}

export function reasoningEffortLabel(value: string): string {
  switch (value.trim().toLowerCase()) {
    case "none": return "None";
    case "low": return "Low";
    case "medium": return "Medium";
    case "high": return "High";
    case "xhigh": return "XHigh";
    case "max": return "Max";
    case "ultra": return "Ultra";
    default:
      return value.split(/[-_\s]+/).filter(Boolean)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
  }
}

function reasoningEffortDescription(value: string): string {
  switch (value) {
    case "low": return "Light reasoning for straightforward tasks.";
    case "medium": return "Balanced default for normal coding work.";
    case "high": return "Deep reasoning for complex planning and debugging.";
    case "xhigh": return "Extended reasoning for difficult multi-step work.";
    case "max": return "Maximum model-supported reasoning effort.";
    case "ultra": return "Maximum reasoning with proactive Agents enabled.";
    default: return "Model-supported reasoning effort.";
  }
}

function mergeExplicitCapabilities(...values: Array<ModelCapabilityDescriptor | undefined>): ModelCapabilityDescriptor | undefined {
  const reasoningEfforts = normalizeReasoningEfforts(values.flatMap((value) => value?.reasoningEfforts ?? []));
  const contextWindow = values.map((value) => value?.contextWindow).find((value): value is number => Boolean(value && value > 0));
  if (reasoningEfforts.length === 0 && !contextWindow) return undefined;
  return mergeModelCapabilities("", {
    ...(reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    source: values.find((value) => value?.source)?.source ?? "catalog"
  });
}

function capabilityFromUnknown(value: unknown, source: ModelCapabilityDescriptor["source"]): ModelCapabilityDescriptor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const capabilities = nestedRecord(record.capabilities);
  const reasoningEfforts = normalizeReasoningEfforts([
    ...arrayValue(record.supportedReasoningEfforts),
    ...arrayValue(record.supported_reasoning_efforts),
    ...arrayValue(record.reasoningEfforts),
    ...arrayValue(record.reasoning_efforts),
    ...arrayValue(capabilities.supportedReasoningEfforts),
    ...arrayValue(capabilities.supported_reasoning_efforts),
    ...arrayValue(capabilities.reasoningEfforts),
    ...arrayValue(capabilities.reasoning_efforts)
  ]);
  const contextWindow = [record.contextWindow, record.context_window, capabilities.contextWindow, capabilities.context_window]
    .find((entry): entry is number => typeof entry === "number" && Number.isFinite(entry) && entry > 0);
  if (reasoningEfforts.length === 0 && !contextWindow) return undefined;
  return {
    ...(reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
    ...(contextWindow ? { contextWindow: Math.round(contextWindow) } : {}),
    source
  };
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
