import type { ChannelGroupConfig, ProviderConfig } from "@codex-ui/shared";
import type { WorkbenchTurn } from "./state/codexClient";

export type ImageOperationMode = "generate" | "edit";

export type ImageRuntimeSelection = {
  providerId: string | null;
  groupId: string | null;
  model: string;
};

export const DEFAULT_IMAGE_RUNTIME_SELECTION: ImageRuntimeSelection = { providerId: null, groupId: null, model: "" };

export function groupSupportsImage(group: ChannelGroupConfig, mode: ImageOperationMode): boolean {
  return mode === "edit"
    ? group.capabilities?.imageEdits ?? group.image?.edits ?? group.kind === "image"
    : group.capabilities?.imageGeneration ?? group.image?.generations ?? group.kind === "image";
}

export function imageModelsForGroup(group: ChannelGroupConfig): string[] {
  const configured = group.models ?? [];
  const imageModels = configured.filter((model) => /image|banana|dall-e/i.test(model));
  const defaultModel = group.image?.defaultModel;
  return [...new Set([defaultModel, ...imageModels].filter((model): model is string => Boolean(model)))];
}

export function resolveImageRuntime(
  providers: ProviderConfig[],
  selection: ImageRuntimeSelection,
  mode: ImageOperationMode,
  preferredProviderId?: string | null
): { provider: ProviderConfig; group: ChannelGroupConfig; model: string } | null {
  const orderedProviders = [...providers].sort((a, b) => {
    const score = (provider: ProviderConfig) => Number(provider.id === selection.providerId) * 4 + Number(provider.id === preferredProviderId) * 2 + Number(/deepkey/i.test(provider.id) || /deepkey/i.test(provider.name));
    return score(b) - score(a);
  });
  for (const provider of orderedProviders) {
    const groups = (provider.groups ?? []).filter((group) => group.status !== "disabled" && groupSupportsImage(group, mode));
    const group = groups.find((entry) => provider.id === selection.providerId && entry.id === selection.groupId)
      ?? groups.find((entry) => entry.image?.availability !== "unavailable")
      ?? groups[0];
    if (!group) continue;
    const models = imageModelsForGroup(group);
    const model = provider.id === selection.providerId && group.id === selection.groupId && selection.model
      ? selection.model
      : group.image?.defaultModel ?? models[0] ?? "gpt-image-2";
    return { provider, group, model };
  }
  return null;
}

export function parseImageRuntimeSelections(value: unknown): Record<string, ImageRuntimeSelection> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (record.providerId !== null && typeof record.providerId !== "string") return [];
    if (record.groupId !== null && typeof record.groupId !== "string") return [];
    if (typeof record.model !== "string") return [];
    return [[key, { providerId: record.providerId ?? null, groupId: record.groupId ?? null, model: record.model } as ImageRuntimeSelection]];
  }));
}

export function imageRuntimeFromHistory(turns: WorkbenchTurn[], providers: ProviderConfig[]): ImageRuntimeSelection | null {
  for (const turn of [...turns].reverse()) {
    for (const item of [...turn.items].reverse()) {
      if (item.type !== "imageGeneration" || !item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) continue;
      const payload = item.payload as Record<string, unknown>;
      const providerId = typeof payload.provider_id === "string" ? payload.provider_id : null;
      const groupId = typeof payload.group_id === "string" ? payload.group_id : null;
      const model = typeof payload.model === "string" ? payload.model : item.images?.[0]?.model ?? "";
      if (providerId && groupId && providers.some((provider) => provider.id === providerId && provider.groups?.some((group) => group.id === groupId))) {
        return { providerId, groupId, model };
      }
      const resolved = resolveImageRuntime(providers, { providerId, groupId, model }, "generate");
      if (resolved) return { providerId: resolved.provider.id, groupId: resolved.group.id, model: model || resolved.model };
    }
  }
  return null;
}
