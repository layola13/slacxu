import { expandModelContextVariants, type ChannelGroupConfig, type ImageGenerationProtocol, type ProviderConfig, type RelayCapabilityCatalog, type RelayCatalogModel, type RelayResponseProtocol } from "@codex-ui/shared";

export type RelayGroupStatusFilter = "all" | "available" | "enabled" | "disabled" | "pending";
export type RelayGroupProtocolFilter = "all" | RelayResponseProtocol;
export type RelayGroupSort = "original" | "name_asc" | "ratio_asc" | "ratio_desc" | "usage_desc" | "priority_desc" | "models_desc";

export type RelayGroupCollectionOptions = {
  search?: string;
  status?: RelayGroupStatusFilter;
  protocol?: RelayGroupProtocolFilter;
  sort?: RelayGroupSort;
};

export type RelayGroupInitialUiState = {
  selectedId: string;
  expandedById: Record<string, boolean>;
};

export type RelayCatalogTreeSelection =
  | { level: "all" }
  | { level: "vendor"; vendorId: number | null }
  | { level: "model"; modelName: string }
  | { level: "group"; groupName: string };

const CONVERSATION_PROTOCOLS: RelayResponseProtocol[] = ["openai-response", "openai", "anthropic", "gemini"];

export function catalogGroupTemplates(
  catalog: RelayCapabilityCatalog | undefined,
  configuredGroups: ChannelGroupConfig[] = []
): ChannelGroupConfig[] {
  if (!catalog) return [];
  const configuredNames = new Set(configuredGroups.map((group) => group.catalogGroupName ?? group.name));
  const groupNames = uniqueStrings([
    ...Object.keys(catalog.usable_group),
    ...Object.keys(catalog.group_ratio),
    ...catalog.auto_groups,
    ...catalog.data.flatMap((model) => model.enable_groups)
  ]);

  return groupNames.flatMap((groupName, index) => {
    if (configuredNames.has(groupName)) return [];
    const models = catalog.data.filter((model) => model.enable_groups.includes(groupName));
    const endpointUnion = uniqueStrings(models.flatMap((model) => model.supported_endpoint_types));
    const commonEndpoints = intersectEndpoints(models.map((model) => model.supported_endpoint_types));
    const commonProtocols = preferredProtocols(groupName, commonEndpoints);
    const unionProtocols = preferredProtocols(groupName, endpointUnion);
    const responseProtocol = commonProtocols[0] ?? unionProtocols[0] ?? "openai-response";
    const responseProtocolMode = commonProtocols.length > 0 || models.length === 0 ? "fixed" : "model_auto";
    const imageGroup = /image|banana|video/i.test(groupName)
      || (models.length > 0 && models.every((model) =>
        model.quota_type === 1
        && model.supported_endpoint_types.some((endpoint) => ["image-generation", "image-edits", "videos"].includes(endpoint))
      ));
    const image = catalogImageConfig(groupName, models, endpointUnion);
    const hasText = models.some((model) => model.supported_endpoint_types.some((endpoint) => CONVERSATION_PROTOCOLS.includes(endpoint as RelayResponseProtocol)));

    return [{
      id: `catalog:${groupName}`,
      name: groupName,
      kind: imageGroup ? "image" : "text",
      capabilities: { text: imageGroup ? false : hasText || !imageGroup, imageGeneration: image?.generations ?? (imageGroup ? true : undefined), imageEdits: image?.edits ?? (imageGroup ? true : undefined) },
      status: "enabled",
      groupRatio: catalog.group_ratio[groupName] ?? 1,
      priority: index + 1,
      weight: 0,
      keyMode: "polling",
      models: models.map((model) => model.model_name),
      supportedEndpointTypes: endpointUnion,
      responseProtocol,
      responseProtocolMode,
      authType: "inherit",
      credentialMode: "group",
      catalogGroupName: groupName,
      catalogManaged: true,
      image,
      remark: catalog.usable_group[groupName] || groupName,
      autoBan: true,
      keys: [],
      enableFallback: false
    } satisfies ChannelGroupConfig];
  });
}

function catalogImageConfig(groupName: string, models: RelayCatalogModel[], endpoints: string[]): ChannelGroupConfig["image"] {
  const normalized = groupName.toLowerCase();
  const generation = endpoints.includes("image-generation") || ["gpt-image", "gpt-image-adobe", "gpt-azure"].includes(normalized);
  const edits = endpoints.includes("image-edits") || ["gpt-image", "gpt-image-adobe", "gpt-azure"].includes(normalized);
  if (!generation && !edits) return undefined;
  const defaultModel = normalized === "gpt-image" || normalized === "gpt-image-adobe"
    ? "gpt-image-2-count"
    : normalized === "gpt-azure" ? "gpt-image-2" : models.find((model) => model.supported_endpoint_types.includes("image-generation"))?.model_name;
  const unitPrice = normalized === "gpt-image" ? 0.08 : normalized === "gpt-image-adobe" ? 0.12 : undefined;
  return {
    generations: generation,
    edits,
    defaultModel,
    protocols: [generation ? "openaiImages" : null, edits ? "openaiImageEdits" : null].filter(Boolean) as ImageGenerationProtocol[],
    defaultProtocol: generation ? "openaiImages" : "openaiImageEdits",
    modelPrices: unitPrice != null && defaultModel ? [{ model: defaultModel, usdPerImage: unitPrice }] : undefined,
    billing: unitPrice != null ? { mode: "per_image", usdPerImage: unitPrice, currency: "USD" } : normalized === "gpt-azure" ? { mode: "token_multiplier", multiplier: 1.2, currency: "USD" } : undefined,
    availability: normalized === "gpt-azure" ? "constrained" : "available",
    notice: normalized === "gpt-azure" ? "当前 gpt-azure 图片资源不足" : undefined
  };
}

export function mergeCatalogGroupDrafts(
  existingGroups: ChannelGroupConfig[],
  importedGroups: ChannelGroupConfig[],
  mode: "merge" | "replace"
): ChannelGroupConfig[] {
  const importedByName = new Map(importedGroups.map((group) => [group.catalogGroupName ?? group.name, group]));
  const merged = existingGroups.flatMap((existing) => {
    const name = existing.catalogGroupName ?? existing.name;
    const imported = importedByName.get(name);
    if (!imported) return mode === "replace" && existing.catalogManaged ? [] : [existing];
    importedByName.delete(name);
    const refreshManagedMetadata = existing.catalogManaged === true;
    return [{
      ...imported,
      id: existing.id,
      status: existing.status,
      quotaUsd: existing.quotaUsd,
      usedQuotaUsd: existing.usedQuotaUsd,
      priority: existing.priority,
      weight: existing.weight,
      keyMode: existing.keyMode,
      responseProtocol: existing.responseProtocol ?? imported.responseProtocol,
      responseProtocolMode: existing.responseProtocolMode ?? imported.responseProtocolMode,
      endpointPathOverride: existing.endpointPathOverride,
      authType: existing.authType ?? imported.authType,
      credentialMode: existing.credentialMode ?? ((existing.keys?.length ?? 0) > 0 ? "group" : imported.credentialMode),
      image: refreshManagedMetadata ? imported.image : existing.image ?? imported.image,
      capabilities: refreshManagedMetadata ? imported.capabilities : existing.capabilities ?? imported.capabilities,
      modelMapping: existing.modelMapping,
      statusCodeMapping: existing.statusCodeMapping,
      advancedModelMapping: existing.advancedModelMapping,
      tag: existing.tag,
      autoBan: existing.autoBan,
      requestLimit: existing.requestLimit,
      requestIntervalSeconds: existing.requestIntervalSeconds,
      contextWindow: existing.contextWindow,
      modelCapabilities: existing.modelCapabilities ?? imported.modelCapabilities,
      keys: existing.keys,
      enableFallback: existing.enableFallback,
      fallbackChannelId: existing.fallbackChannelId,
      fallbackGroupName: existing.fallbackGroupName,
      enableTieredContext: existing.enableTieredContext,
      tieredContextRatios: existing.tieredContextRatios
    }];
  });
  return [...merged, ...importedByName.values()];
}

export function filterCatalogGroupsByTree(
  groups: ChannelGroupConfig[],
  catalog: RelayCapabilityCatalog | undefined,
  selection: RelayCatalogTreeSelection
): ChannelGroupConfig[] {
  if (!catalog || selection.level === "all") return groups;
  if (selection.level === "group") {
    return groups.filter((group) => (group.catalogGroupName ?? group.name) === selection.groupName);
  }
  if (selection.level === "model") {
    return groups.filter((group) => (group.models ?? []).includes(selection.modelName));
  }
  const modelNames = new Set(catalog.data
    .filter((model) => selection.vendorId == null ? model.vendor_id == null : model.vendor_id === selection.vendorId)
    .map((model) => model.model_name));
  return groups.filter((group) => (group.models ?? []).some((model) => modelNames.has(model)));
}

export function hasConfiguredRelayGroupKey(group: ChannelGroupConfig): boolean {
  return group.authType === "none"
    || group.id === "cline-free"
    || group.id === "freebuff"
    || (group.keys ?? []).some((key) => key.trim().length > 0);
}

/**
 * A provider credential can be used by groups that explicitly inherit it.
 * Keep this check deliberately tolerant because `/api/providers` may mask the
 * actual secret for members while still exposing a configured preview/ref.
 */
export function hasConfiguredProviderCredential(provider: ProviderConfig): boolean {
  return Boolean(
    provider.apiKeyPreview?.trim()
    || provider.apiKeyRef?.trim()
    || provider.apiKeyStorage === "database"
  );
}

export function parseRelayGroupKeys(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((key) => key.trim())
    .filter(Boolean);
}

export function relayGroupsMissingKeys(groups: ChannelGroupConfig[], hasProviderCredential = false): ChannelGroupConfig[] {
  return groups.filter((group) =>
    !hasConfiguredRelayGroupKey(group)
    && !(group.credentialMode === "provider" && hasProviderCredential)
  );
}

export function relayGroupModelsForEditing(provider: ProviderConfig, group: ChannelGroupConfig): string[] {
  if ((group.models?.length ?? 0) > 0) {
    return group.models!;
  }
  // Older channels stored one provider-level model list. Materialize that
  // effective list into text groups so an edit/save round trip cannot erase it.
  return group.kind === "image" ? [] : provider.nativeModels;
}

export function relayGroupSelectableModels(provider: ProviderConfig, group: ChannelGroupConfig): string[] {
  return [...new Set([
    ...relayGroupModelsForEditing(provider, group),
    ...(group.modelMapping ?? []).flatMap((mapping) => [mapping.from, mapping.to])
  ].map((model) => model.trim()).filter(Boolean))];
}

export function resolveRelayTextRuntimeSelection(
  provider: ProviderConfig,
  activeGroupId: string | null,
  selectedModel: string
): { groupId: string | null; model: string } {
  const textGroups = (provider.groups ?? []).filter((group) => group.kind !== "image");
  const requestedGroup = textGroups.find((group) => group.id === activeGroupId);
  const matchingGroup = textGroups.find((group) => expandedSelectableModels(provider, group).includes(selectedModel));
  const group = requestedGroup ?? matchingGroup ?? textGroups[0] ?? provider.groups?.[0];
  const models = group
    ? expandedSelectableModels(provider, group)
    : expandModelContextVariants(provider.nativeModels);
  return {
    groupId: group?.id ?? activeGroupId,
    model: models.includes(selectedModel) ? selectedModel : models[0] ?? ""
  };
}

function expandedSelectableModels(provider: ProviderConfig, group: ChannelGroupConfig): string[] {
  return expandModelContextVariants(relayGroupSelectableModels(provider, group));
}

export function activeRelayGroupModels(
  provider: ProviderConfig,
  activeGroupId: string | null,
  selectedModel: string
): { group: ChannelGroupConfig | undefined; models: string[] } {
  const groups = provider.groups ?? [];
  const group = groups.find((entry) => entry.id === activeGroupId)
    ?? groups.find((entry) => entry.models?.includes(selectedModel))
    ?? groups.find((entry) => entry.kind !== "image")
    ?? groups[0];
  return {
    group,
    models: groups.length > 0 ? group?.models ?? [] : provider.nativeModels
  };
}

export function materializeFetchedModelsForSave(
  groups: ChannelGroupConfig[],
  targetGroupId: string | undefined,
  selectedModels: string[]
): ChannelGroupConfig[] {
  if (!targetGroupId || selectedModels.length === 0) {
    return groups;
  }
  return groups.map((group) => {
    if (group.id !== targetGroupId || (group.models?.length ?? 0) > 0) {
      return group;
    }
    const models = [...new Set(selectedModels.map((model) => model.trim()).filter(Boolean))];
    return models.length > 0 ? { ...group, models } : group;
  });
}

export function isAvailableRelayGroup(group: ChannelGroupConfig, hasProviderCredential = false): boolean {
  if ((group.status ?? "enabled") !== "enabled") return false;
  if (hasConfiguredRelayGroupKey(group)) return true;
  // Imported/legacy providers may store the key once at provider level while
  // their groups use inherited credentials. Those groups are valid runtime
  // routes and must remain selectable in Composer.
  return hasProviderCredential && (group.credentialMode === "provider" || group.authType === "inherit");
}

export function relayGroupSupportsCatalogModel(
  group: ChannelGroupConfig,
  model: RelayCatalogModel | undefined
): boolean {
  if (!model || group.responseProtocolMode === "model_auto" || !group.responseProtocol) return true;
  return model.supported_endpoint_types.includes(group.responseProtocol);
}

export function incompatibleRelayGroupModels(
  group: ChannelGroupConfig,
  catalog: RelayCapabilityCatalog | undefined
): string[] {
  if (!catalog) return [];
  const metadataByName = new Map(catalog.data.map((model) => [model.model_name, model]));
  return (group.models ?? []).filter((model) => !relayGroupSupportsCatalogModel(group, metadataByName.get(model)));
}

export function createInitialRelayGroupUiState(
  groups: ChannelGroupConfig[],
  fallbackId = "group-default"
): RelayGroupInitialUiState {
  const selected = groups.find(hasConfiguredRelayGroupKey) ?? groups[0];
  return {
    selectedId: selected?.id ?? fallbackId,
    expandedById: Object.fromEntries(
      groups.map((group) => [group.id, group.id === selected?.id && hasConfiguredRelayGroupKey(group)])
    )
  };
}

export function filterAndSortRelayGroups(
  groups: ChannelGroupConfig[],
  options: RelayGroupCollectionOptions,
  hasProviderCredential = false
): ChannelGroupConfig[] {
  const search = options.search?.trim().toLocaleLowerCase() ?? "";
  const status = options.status ?? "all";
  const protocol = options.protocol ?? "all";
  const indexed = groups.map((group, index) => ({ group, index }));
  const filtered = indexed.filter(({ group }) => {
    const groupStatus = group.status ?? "enabled";
    if (status === "available" && !isAvailableRelayGroup(group, hasProviderCredential)) return false;
    if (status === "pending" && hasConfiguredRelayGroupKey(group)) return false;
    if (status === "enabled" && groupStatus !== "enabled") return false;
    if (status === "disabled" && (groupStatus !== "disabled" || !hasConfiguredRelayGroupKey(group))) return false;
    if (protocol !== "all" && (group.responseProtocol ?? "openai-response") !== protocol) return false;
    if (!search) return true;
    return [
      group.id,
      group.name,
      group.catalogGroupName,
      group.tag,
      group.remark,
      group.kind,
      group.responseProtocol,
      ...(group.models ?? []),
      ...(group.supportedEndpointTypes ?? [])
    ].some((value) => value?.toLocaleLowerCase().includes(search));
  });

  const sort = options.sort ?? "original";
  return filtered
    .sort((left, right) => compareGroups(left, right, sort))
    .map(({ group }) => group);
}

export function relayGroupUsageRate(group: ChannelGroupConfig): number | null {
  const quota = group.quotaUsd;
  const used = group.usedQuotaUsd;
  if (typeof quota !== "number" || !Number.isFinite(quota) || quota <= 0) return null;
  if (typeof used !== "number" || !Number.isFinite(used)) return 0;
  return used / quota;
}

function compareGroups(
  left: { group: ChannelGroupConfig; index: number },
  right: { group: ChannelGroupConfig; index: number },
  sort: RelayGroupSort
): number {
  let comparison = 0;
  switch (sort) {
    case "name_asc":
      comparison = left.group.name.localeCompare(right.group.name, undefined, { numeric: true, sensitivity: "base" });
      break;
    case "ratio_asc":
      comparison = finiteValue(left.group.groupRatio, 1) - finiteValue(right.group.groupRatio, 1);
      break;
    case "ratio_desc":
      comparison = finiteValue(right.group.groupRatio, 1) - finiteValue(left.group.groupRatio, 1);
      break;
    case "usage_desc":
      comparison = compareNullableDescending(relayGroupUsageRate(left.group), relayGroupUsageRate(right.group));
      break;
    case "priority_desc":
      comparison = finiteValue(right.group.priority, 0) - finiteValue(left.group.priority, 0);
      break;
    case "models_desc":
      comparison = (right.group.models?.length ?? 0) - (left.group.models?.length ?? 0);
      break;
    case "original":
      return left.index - right.index;
  }
  return comparison || left.index - right.index;
}

function compareNullableDescending(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

function finiteValue(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function intersectEndpoints(endpointLists: string[][]): string[] {
  if (endpointLists.length === 0) return [];
  let intersection = new Set(endpointLists[0]);
  for (const endpoints of endpointLists.slice(1)) {
    const current = new Set(endpoints);
    intersection = new Set([...intersection].filter((endpoint) => current.has(endpoint)));
  }
  return [...intersection];
}

function preferredProtocols(groupName: string, endpoints: string[]): RelayResponseProtocol[] {
  const supported = new Set(endpoints.filter((endpoint): endpoint is RelayResponseProtocol =>
    CONVERSATION_PROTOCOLS.includes(endpoint as RelayResponseProtocol)
  ));
  const name = groupName.toLocaleLowerCase();
  const priority: RelayResponseProtocol[] = name.includes("claude")
    ? ["anthropic", "openai-response", "openai", "gemini"]
    : name.includes("gemini")
      ? ["gemini", "openai-response", "openai", "anthropic"]
      : ["openai-response", "openai", "anthropic", "gemini"];
  return priority.filter((protocol) => supported.has(protocol));
}
