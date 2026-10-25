import type { ChannelGroupConfig, ProviderConfig } from "@codex-ui/shared";

export type AdvancedRelayDirectoryTemplate = {
  id: string;
  name: string;
  baseUrl: string;
  protocol: NonNullable<ChannelGroupConfig["responseProtocol"]>;
};

export type AdvancedRelayVendorOption = {
  id: string;
  targetProviderId: string | null;
  targetProviderName?: string;
  serviceProviderId: string;
  name: string;
  baseUrl: string;
  protocol: NonNullable<ChannelGroupConfig["responseProtocol"]>;
};

export function buildAdvancedRelayDirectory(
  providers: ReadonlyArray<ProviderConfig>,
  templates: ReadonlyArray<AdvancedRelayDirectoryTemplate>,
  identifyServiceProviderId: (provider: ProviderConfig) => string | undefined
): AdvancedRelayVendorOption[] {
  const eligibleProviders = providers.filter((provider) => (
    provider.id !== "omniroute-free"
    && provider.serviceProvider?.id?.trim().toLowerCase() !== "codex-ultra-free"
  ));
  return templates.map((template) => {
    const target = template.id === "custom"
      ? undefined
      : eligibleProviders.find((provider) => (
        (identifyServiceProviderId(provider)?.trim() || provider.serviceProvider?.id?.trim()) === template.id
      ));
    return {
      id: `template:${template.id}`,
      targetProviderId: target?.id ?? null,
      targetProviderName: target?.name,
      serviceProviderId: template.id,
      name: template.name,
      baseUrl: target?.baseUrl ?? template.baseUrl,
      protocol: template.protocol
    } satisfies AdvancedRelayVendorOption;
  });
}

export function defaultAdvancedRelayVendor(
  directory: ReadonlyArray<AdvancedRelayVendorOption>,
  preferredServiceProviderId = "openai"
): AdvancedRelayVendorOption | undefined {
  return directory.find((entry) => entry.serviceProviderId === preferredServiceProviderId)
    ?? directory[0];
}
