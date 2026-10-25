import type { ChannelGroupConfig, ProviderConfig, RelayResponseProtocol } from "@codex-ui/shared";

export type RelayDirectoryGroup = {
  groupId: string;
  groupName: string;
  kind: "text" | "image";
  enabled: boolean;
  groupRatio: number;
  models: string[];
  supportedEndpointTypes: string[];
  responseProtocol: RelayResponseProtocol | null;
  responseProtocolMode: ChannelGroupConfig["responseProtocolMode"] | null;
};

export type RelayDirectoryProvider = {
  providerId: string;
  providerName: string;
  providerKind: ProviderConfig["kind"];
  defaultModel: string | null;
  models: string[];
  groups: RelayDirectoryGroup[];
};

export function createRelayDirectory(
  providers: ProviderConfig[],
  allowedProviderIds?: ReadonlySet<string>
): RelayDirectoryProvider[] {
  return providers
    .filter((provider) => !allowedProviderIds || allowedProviderIds.has(provider.id))
    .map(projectRelayDirectoryProvider);
}

export function findRelayDirectoryProvider(
  providers: ProviderConfig[],
  providerId: string,
  allowedProviderIds?: ReadonlySet<string>
): RelayDirectoryProvider | null {
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider || (allowedProviderIds && !allowedProviderIds.has(provider.id))) return null;
  return projectRelayDirectoryProvider(provider);
}

function projectRelayDirectoryProvider(provider: ProviderConfig): RelayDirectoryProvider {
  return {
    providerId: provider.id,
    providerName: provider.name,
    providerKind: provider.kind,
    defaultModel: provider.defaultModel?.trim() || null,
    models: uniqueStrings(provider.nativeModels),
    groups: (provider.groups ?? []).map(projectRelayDirectoryGroup)
  };
}

function projectRelayDirectoryGroup(group: ChannelGroupConfig): RelayDirectoryGroup {
  return {
    groupId: group.id,
    groupName: group.name,
    kind: group.kind ?? "text",
    enabled: group.status !== "disabled",
    groupRatio: Number.isFinite(group.groupRatio) ? group.groupRatio : 1,
    models: uniqueStrings(group.models ?? []),
    supportedEndpointTypes: uniqueStrings(group.supportedEndpointTypes ?? []),
    responseProtocol: group.responseProtocol ?? null,
    responseProtocolMode: group.responseProtocolMode ?? null
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
