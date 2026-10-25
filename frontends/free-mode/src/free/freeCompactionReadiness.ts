import type { ChannelGroupConfig, ProviderConfig } from "@codex-ui/shared";

/** Provider id for the free omniroute relay. */
export const FREE_COMPACT_PROVIDER_ID = "omniroute-free";
/** Group id that hosts free models on the omniroute-free relay. */
export const FREE_COMPACT_GROUP_ID = "opencode-free";
const FREE_COMPACTION_HIDDEN_MODELS = new Set(["big-pickle"]);
export type FreeCompactionReadiness =
  | { ok: true; providerId: string; groupId: string | null; model: string; mappedFrom: string; source: "manual" }
  | { ok: false; reason: FreeCompactionUnreadyReason; detail?: string };

export type FreeCompactionUnreadyReason =
  | "no-active-thread"
  | "remote-workspace"
  | "no-current-model"
  | "provider-missing"
  | "group-missing"
  | "group-empty"
  | "manual-route-incomplete"
  | "manual-model-unavailable";

export function shouldRefreshFreeCompactionModels(
  enabled: boolean,
  manualProviderId?: string | null,
  reason?: FreeCompactionUnreadyReason
): boolean {
  const providerId = manualProviderId?.trim();
  if (!enabled || (providerId && providerId !== FREE_COMPACT_PROVIDER_ID)) return false;
  return reason === undefined || (
    reason === "provider-missing"
    || reason === "group-missing"
    || reason === "group-empty"
    || reason === "manual-model-unavailable"
  );
}

/** Locate the free group config on the omniroute-free provider, if present. */
export function findFreeCompactionGroup(providers: readonly ProviderConfig[], groupId?: string | null): ChannelGroupConfig | undefined {
  const freeProvider = providers.find((provider) => provider.id === FREE_COMPACT_PROVIDER_ID);
  if (!freeProvider || !Array.isArray(freeProvider.groups)) return undefined;
  if (groupId) {
    const matched = freeProvider.groups.find((group) => group.id === groupId);
    if (matched) return matched;
  }
  const defaultGroup = freeProvider.groups.find((group) => group.id === FREE_COMPACT_GROUP_ID);
  if (defaultGroup && Array.isArray(defaultGroup.models) && defaultGroup.models.length > 0) {
    return defaultGroup;
  }
  return freeProvider.groups.find((group) => group.status !== "disabled" && Array.isArray(group.models) && group.models.length > 0)
    ?? defaultGroup
    ?? freeProvider.groups[0];
}

export type CompactionChannelOption = {
  providerId: string;
  providerName: string;
  groupId: string | null;
  groupName: string;
  models: string[];
};

export function listCompactionChannelOptions(providers: readonly ProviderConfig[]): CompactionChannelOption[] {
  return providers.flatMap<CompactionChannelOption>((provider) => {
    const textGroups = (provider.groups ?? []).filter((group) => group.kind !== "image" && group.status !== "disabled");
    if (textGroups.length === 0) {
      return provider.nativeModels.length > 0 ? [{
        providerId: provider.id,
        providerName: provider.name,
        groupId: null,
        groupName: "默认分组",
        models: provider.nativeModels.filter((model) => !FREE_COMPACTION_HIDDEN_MODELS.has(model.trim().toLowerCase()))
      }] : [];
    }
    return textGroups.map((group) => ({
      providerId: provider.id,
      providerName: provider.name,
      groupId: group.id,
      groupName: group.name,
      models: (group.models?.length ? group.models : provider.nativeModels)
        .filter((model) => !FREE_COMPACTION_HIDDEN_MODELS.has(model.trim().toLowerCase()))
    }));
  });
}

/** Whether the omniroute-free provider has been synced and exposes models on any active group. */
export function hasFreeRelay(providers: readonly ProviderConfig[]): boolean {
  const freeProvider = providers.find((provider) => provider.id === FREE_COMPACT_PROVIDER_ID);
  if (!freeProvider || !Array.isArray(freeProvider.groups)) return false;
  return freeProvider.groups.some((group) => group.status !== "disabled" && Array.isArray(group.models) && group.models.length > 0);
}

/** Whether the selected free group advertises the openai-response-compact endpoint capability. */
export function freeRelaySupportsCompact(providers: readonly ProviderConfig[], groupId?: string | null): boolean {
  const group = findFreeCompactionGroup(providers, groupId);
  return Boolean(group?.supportedEndpointTypes?.includes("openai-response-compact"));
}

export type FreeCompactionReadinessInput = {
  /** Currently selected wire model id (may include a context variant suffix). */
  currentModel: string | null | undefined;
  /** All known providers, used to resolve the omniroute-free relay + group. */
  providers: readonly ProviderConfig[];
  /** "local" enables free compaction; remote/ssh workspaces must skip. */
  workspaceMode: "local" | "ssh" | string;
  /** Active thread id; compaction needs a concrete thread to act on. */
  activeThreadId: string | null | undefined;
  /** Optional per-thread explicit free model, used instead of automatic mapping. */
  manualFreeModel?: string | null;
  manualProviderId?: string | null;
  manualGroupId?: string | null;
};

/**
 * Evaluate whether free auto-compaction can run right now. Returns a structured
 * reason on failure so callers can decide whether to prompt the user (e.g. open
 * the FreeModelAccessDialog when the provider or its models are missing).
 */
export function checkFreeCompactionReadiness(input: FreeCompactionReadinessInput): FreeCompactionReadiness {
  const activeThreadId = input?.activeThreadId?.trim();
  if (!activeThreadId) return { ok: false, reason: "no-active-thread" };

  if (input.workspaceMode !== "local") {
    return { ok: false, reason: "remote-workspace", detail: "Free compaction only applies to local workspaces." };
  }

  const currentModel = input?.currentModel?.trim();
  if (!currentModel) return { ok: false, reason: "no-current-model" };

  const manualProviderId = input.manualProviderId?.trim();
  const manualFreeModel = input.manualFreeModel?.trim();
  if (manualProviderId || input.manualGroupId?.trim() || manualFreeModel) {
    if (!manualProviderId || !manualFreeModel) {
      return { ok: false, reason: "manual-route-incomplete", detail: "手动压缩渠道和模型必须同时选择。" };
    }
    const provider = input.providers.find((entry) => entry.id === manualProviderId);
    if (!provider) return { ok: false, reason: "provider-missing", detail: `所选压缩渠道 ${manualProviderId} 已不可用。` };
    const manualGroupId = input.manualGroupId?.trim() || null;
    const option = listCompactionChannelOptions([provider]).find((entry) => entry.groupId === manualGroupId);
    if (!option) return { ok: false, reason: "group-missing", detail: "所选压缩渠道分组已不可用。" };
    if (!option.models.includes(manualFreeModel)) {
      return { ok: false, reason: "manual-model-unavailable", detail: `所选压缩模型 ${manualFreeModel} 已不在该渠道中。` };
    }
    return {
      ok: true,
      providerId: option.providerId,
      groupId: option.groupId,
      model: manualFreeModel,
      mappedFrom: currentModel,
      source: "manual"
    };
  }

  return {
    ok: false,
    reason: "manual-route-incomplete",
    detail: "免费压缩不再自动映射聊天模型；请手动选择压缩渠道、分组和真实模型。"
  };
}

export function shouldBlockFreeCompactionSelection(readiness: FreeCompactionReadiness): boolean {
  return !readiness.ok && readiness.reason !== "no-active-thread";
}

/** Human-friendly summary for a failed readiness check, suitable for notices. */
export function describeFreeCompactionUnready(reason: FreeCompactionUnreadyReason, detail?: string): string {
  switch (reason) {
    case "no-active-thread":
      return "Open a conversation before enabling free compaction.";
    case "remote-workspace":
      return "Free compaction is only available in the local workspace mode.";
    case "no-current-model":
      return "Select a model before enabling free compaction.";
    case "provider-missing":
      return detail ?? "The free relay (omniroute-free) has not been added. Sync free models first.";
    case "group-missing":
      return detail ?? "The free relay group was not found. Sync free models first.";
    case "group-empty":
      return "The free relay has no synced models yet. Sync free models first.";
    case "manual-route-incomplete":
      return detail ?? "请完整选择压缩渠道、分组和模型。";
    case "manual-model-unavailable":
      return detail ?? "The selected free compaction model is no longer available. Choose another free model.";
  }
}
