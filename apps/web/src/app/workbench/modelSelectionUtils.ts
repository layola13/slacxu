import { hasConfiguredProviderCredential, isAvailableRelayGroup, resolveRelayTextRuntimeSelection } from "../../groupCollection";
import type { WorkspaceMode } from "./appConstants";
import { PermissionPresetId, ProviderConfig, permissionToTurnOverrides, stripModelContextVariant } from "@codex-ui/shared";
import type { JsonValue } from "@codex-ui/shared";

export function resolveComposerTextGroup(provider: ProviderConfig, groupId: string | null, model: string) {
  const baseModel = stripModelContextVariant(model).baseModel;
  const hasProviderCredential = hasConfiguredProviderCredential(provider);
  const availableTextGroups = provider.groups?.filter((group: NonNullable<ProviderConfig["groups"]>[number]) => group.kind !== "image" && isAvailableRelayGroup(group, hasProviderCredential)) ?? [];
  return availableTextGroups.find((group: NonNullable<ProviderConfig["groups"]>[number]) => group.id === groupId)
    ?? availableTextGroups.find((group: NonNullable<ProviderConfig["groups"]>[number]) => group.models?.includes(model) || group.models?.includes(baseModel))
    ?? availableTextGroups[0]
    ?? provider.groups?.find((group: NonNullable<ProviderConfig["groups"]>[number]) => group.id === groupId && group.kind !== "image")
    ?? provider.groups?.find((group: NonNullable<ProviderConfig["groups"]>[number]) => group.kind !== "image" && (group.models?.includes(model) || group.models?.includes(baseModel)))
    ?? provider.groups?.find((group: NonNullable<ProviderConfig["groups"]>[number]) => group.kind !== "image")
    ?? provider.groups?.[0];
}

export function buildNewChatBackendPreview(input: {
  cwd: string;
  model: string;
  modelProvider?: string;
  permission: PermissionPresetId;
  reasoningEffort: string;
  budgetLimit: string;
  workspaceMode: WorkspaceMode;
  sshCommand: string;
  additionalRoots: string[];
}): JsonValue {
  const permissionOverrides = permissionToTurnOverrides(input.permission, input.cwd, input.additionalRoots);
  const threadStart: Record<string, JsonValue> = {
    cwd: input.cwd,
    sandbox: permissionOverrides.sandbox,
    approvalPolicy: permissionOverrides.approvalPolicy,
    sessionStartSource: "startup",
    historyMode: "legacy"
  };
  const turnStart: Record<string, JsonValue> = {
    cwd: input.cwd,
    sandboxPolicy: permissionOverrides.sandboxPolicy,
    approvalPolicy: permissionOverrides.approvalPolicy,
    effort: input.reasoningEffort
  };
  if (input.model) {
    threadStart.model = input.model;
    turnStart.model = input.model;
  }
  if (input.modelProvider) {
    threadStart.modelProvider = input.modelProvider;
  }
  const budget = Number(input.budgetLimit);
  if (Number.isFinite(budget) && budget > 0) {
    threadStart.uiBudgetLimit = budget;
  }
  if (input.workspaceMode === "ssh") {
    const workspace = { type: "ssh", command: input.sshCommand.trim(), cwd: input.cwd };
    threadStart.workspace = workspace;
    turnStart.workspace = workspace;
  }
  return {
    "thread/start": threadStart,
    "turn/start": turnStart
  };
}

export function resolveSelectedModel(providers: ProviderConfig[], activeProviderId: string | null, selectedModel: string, activeGroupId: string | null = null): string {
  if (activeProviderId === "agy-official") {
    return selectedModel || "gemini-3.8-flash-high";
  }
  if (activeProviderId === "grok-official") {
    return selectedModel || "grok-4.6";
  }
  if (activeProviderId === "pi-relay") {
    return selectedModel || "pi-relay/default";
  }
  const provider = providers.find((entry: ProviderConfig) => entry.id === activeProviderId);
  if (!provider) return selectedModel;
  return resolveRelayTextRuntimeSelection(provider, activeGroupId, selectedModel).model;
}

export function modelSelectionMatches(candidate: string, selectedModel: string): boolean {
  if (candidate === selectedModel) return true;
  return stripModelContextVariant(candidate).baseModel === stripModelContextVariant(selectedModel).baseModel;
}

export function resolveTextRuntimeGroupId(providers: ProviderConfig[], activeProviderId: string | null, activeGroupId: string | null, selectedModel: string): string | null {
  const provider = providers.find((entry: ProviderConfig) => entry.id === activeProviderId);
  if (!provider) return activeGroupId;
  return resolveRelayTextRuntimeSelection(provider, activeGroupId, selectedModel).groupId;
}

export function isLikelyImageModelId(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return /(^|[-_/])(image|img|nano[_-]?banana|flux|midjourney|dall[-_ ]?r|stable[-_ ]?diffusion|sdxl|hidream|ideogram|recraft|imagen|seedream|kolors|wan2?\.?2|kling|jimeng|gpt-image)([-_/]|$)/i.test(normalized);
}

export function resolveProviderSelectionId(
  providers: ProviderConfig[],
  activeProviderId: string | null,
  configuredModelProvider: string | null | undefined
): string | null {
  if (activeProviderId === "agy-official") {
    return "agy-official";
  }
  if (activeProviderId === "grok-official") {
    return "grok-official";
  }
  if (activeProviderId === "pi-relay") {
    return "pi-relay";
  }
  if (activeProviderId && providers.some((entry: ProviderConfig) => entry.id === activeProviderId)) {
    return activeProviderId;
  }
  if (activeProviderId?.trim().toLowerCase() === "openai") {
    const chatgptProvider = providers.find((entry: ProviderConfig) => entry.kind === "chatgpt")?.id;
    if (chatgptProvider) return chatgptProvider;
  }
  const configuredProviderId = resolveConfiguredProviderId(providers, configuredModelProvider);
  if (configuredProviderId) {
    return configuredProviderId;
  }
  return activeProviderId;
}

export function resolveConfiguredProviderId(providers: ProviderConfig[], configuredModelProvider: string | null | undefined): string | null {
  const normalized = configuredModelProvider?.trim();
  if (!normalized) {
    return null;
  }
  const direct = providers.find((entry: ProviderConfig) => entry.id === normalized);
  if (direct) {
    return direct.id;
  }
  if (normalized === "openai") {
    return providers.find((entry: ProviderConfig) => entry.kind === "chatgpt")?.id ?? null;
  }
  return null;
}

export function resolveSelectedModelProvider(
  providers: ProviderConfig[],
  activeProviderId: string | null,
  configuredModelProvider?: string | null
): string | undefined {
  if (activeProviderId === "agy-official") return "agy-official";
  if (activeProviderId === "grok-official") return "grok-official";
  if (activeProviderId === "pi-relay") return "pi-relay";
  const provider = providers.find((entry: ProviderConfig) => entry.id === activeProviderId);
  if (provider) {
    return provider.kind === "chatgpt" ? "openai" : provider.id;
  }
  return configuredModelProvider?.trim() || activeProviderId || undefined;
}
