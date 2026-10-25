import type {
  ChannelGroupConfig,
  ModelCapabilityDescriptor,
  ProviderConfig,
  RelayResponseProtocol
} from "@codex-ui/shared";

export type RelaySettingsGroup = {
  groupId: string;
  groupName: string;
  baseUrl: string | null;
  kind: "text" | "image";
  enabled: boolean;
  groupRatio: number;
  contextWindow: number | null;
  models: string[];
  modelCapabilities: Record<string, ModelCapabilityDescriptor>;
  responseProtocol: RelayResponseProtocol | null;
  responseProtocolMode: ChannelGroupConfig["responseProtocolMode"] | null;
  claudeCodeHeadersEnabled: boolean;
  claudeCodeVersion: string | null;
  commandBlacklistEnabled: boolean;
  commandBlacklist: string[];
  networkAllowlist: string[];
  apiKeyConfigured: boolean;
};

export type RelaySettingsView = {
  providerId: string;
  providerName: string;
  kind: ProviderConfig["kind"];
  baseUrl: string;
  defaultModel: string | null;
  models: string[];
  groups: RelaySettingsGroup[];
};

export type RelaySettingsListItem = {
  providerId: string;
  providerName: string;
  kind: ProviderConfig["kind"];
  baseUrl: string;
  defaultModel: string | null;
  stationType: ProviderConfig["stationType"] | null;
  remark: string | null;
  serviceProvider: ProviderConfig["serviceProvider"] | null;
  sharedImport: ProviderConfig["sharedImport"] | null;
  quotaUsd: number | null;
  /** 已用配额（美元）与使用率（used/quota；不限额或未知时为 null，供前端 80%/95% 预警）。只读数字，不含密钥。 */
  usedQuotaUsd: number | null;
  quotaUsageRate: number | null;
  groupCount: number;
  enabled: boolean;
  firstGroupId: string | null;
  firstGroupName: string | null;
  firstGroupRatio: number;
  firstGroupProtocol: RelayResponseProtocol | null;
  apiKeyConfigured: boolean;
  createdAt: number;
  updatedAt: number;
};

export function relaySettingsListItem(provider: ProviderConfig): RelaySettingsListItem {
  const groups = provider.groups ?? [];
  const firstGroup = groups[0];
  const quotaUsd = provider.quotaUsd ?? null;
  const usedQuotaUsd = provider.usedQuotaUsd ?? null;
  const quotaUsageRate = quotaUsd != null && quotaUsd > 0 && usedQuotaUsd != null && usedQuotaUsd >= 0
    ? usedQuotaUsd / quotaUsd
    : null;
  return {
    providerId: provider.id,
    providerName: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl ?? "",
    defaultModel: provider.defaultModel?.trim() || null,
    stationType: provider.stationType ?? null,
    remark: provider.remark?.trim() || null,
    serviceProvider: provider.serviceProvider ? { ...provider.serviceProvider } : null,
    sharedImport: provider.sharedImport ? { ...provider.sharedImport } : null,
    quotaUsd,
    usedQuotaUsd,
    quotaUsageRate,
    groupCount: groups.length,
    enabled: groups.length === 0 || groups.some((group) => group.status !== "disabled"),
    firstGroupId: firstGroup?.id ?? null,
    firstGroupName: firstGroup?.name ?? null,
    firstGroupRatio: firstGroup && Number.isFinite(firstGroup.groupRatio) ? firstGroup.groupRatio : 1,
    firstGroupProtocol: firstGroup?.responseProtocol ?? null,
    apiKeyConfigured: Boolean(provider.apiKeyPreview || provider.apiKeyRef || groups.some((group) => (group.keys ?? []).some((key) => key.trim()))),
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  };
}

export function relaySettingsSummary(provider: ProviderConfig): RelaySettingsView {
  return {
    providerId: provider.id,
    providerName: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl ?? "",
    defaultModel: provider.defaultModel?.trim() || null,
    models: [],
    groups: (provider.groups ?? []).map((group) => ({
      groupId: group.id, groupName: group.name, baseUrl: null, kind: group.kind ?? "text",
      enabled: group.status !== "disabled", groupRatio: Number.isFinite(group.groupRatio) ? group.groupRatio : 1,
      contextWindow: null, models: [], modelCapabilities: {}, responseProtocol: group.responseProtocol ?? null,
      responseProtocolMode: group.responseProtocolMode ?? null, claudeCodeHeadersEnabled: false, claudeCodeVersion: null,
      commandBlacklistEnabled: group.commandBlacklistEnabled !== false, commandBlacklist: [], networkAllowlist: [],
      apiKeyConfigured: group.authType === "none" || group.id === "cline-free" || group.id === "freebuff" || group.keys.some((key) => Boolean(key.trim())) || Boolean(provider.apiKeyRef?.trim())
    }))
  };
}

export function buildRelaySettingsProvider(input: unknown, existing: ProviderConfig | null): ProviderConfig {
  const body = recordValue(input);
  const now = Date.now();
  const providerName = firstString(body.providerName, body.channelName, body.name, existing?.name);
  if (!providerName) throw new Error("providerName is required");
  const baseUrl = firstString(body.baseUrl, body.baseURL, existing?.baseUrl);
  if (!baseUrl) throw new Error("baseUrl is required");
  const providerId = existing?.id ?? firstString(body.providerId, body.id) ?? "";
  const kind = providerKind(body.kind, existing?.kind ?? "responsesRelay");
  const groupInputs = relayGroupInputs(body);
  if (!existing && groupInputs.length === 0) {
    throw new Error("At least one relay group is required");
  }

  const existingGroups = existing?.groups ?? [];
  let groups = body.replaceGroups === true ? [] : existingGroups.map(cloneGroup);
  for (const groupInput of groupInputs) {
    const explicitId = firstString(groupInput.groupId, groupInput.id);
    const requestedName = firstString(groupInput.groupName, groupInput.channelName, groupInput.name);
    const previous = explicitId
      ? existingGroups.find((group) => group.id === explicitId)
      : existingGroups.find((group) => group.name === requestedName)
        ?? (existingGroups.length === 1 && groupInputs.length === 1 ? existingGroups[0] : undefined);
    const nextGroup = buildRelayGroup(groupInput, previous, kind);
    const targetIndex = groups.findIndex((group) => group.id === (previous?.id ?? nextGroup.id));
    if (targetIndex >= 0) groups[targetIndex] = nextGroup;
    else groups.push(nextGroup);
  }
  if (groups.length === 0) throw new Error("At least one relay group is required");
  const providerApiKey = firstString(body.apiKey);
  const hasProviderCredential = Boolean(providerApiKey?.trim() || existing?.apiKeyRef?.trim());
  const missingKeys = groups.filter((group) =>
    group.authType !== "none"
    && group.id !== "cline-free"
    && group.id !== "freebuff"
    && group.keys.every((key) => !key.trim())
    && !(group.credentialMode === "provider" && hasProviderCredential)
  );
  if (missingKeys.length > 0) {
    throw new Error(`apiKey is required for group: ${missingKeys.map((group) => group.name).join(", ")}`);
  }

  const requestedModels = optionalStringArray(body, "models") ?? optionalStringArray(body, "nativeModels");
  const models = requestedModels ?? existing?.nativeModels ?? uniqueStrings(
    groups.filter((group) => group.kind !== "image").flatMap((group) => group.models ?? [])
  );
  const requestedDefaultModel = firstString(body.defaultModel);
  const defaultModel = requestedDefaultModel ?? existing?.defaultModel ?? models[0];

  return {
    ...(existing ?? {}),
    id: providerId,
    kind,
    name: providerName,
    baseUrl,
    defaultModel,
    nativeModels: models,
    modelAliases: existing?.modelAliases ?? [],
    channelMode: groups.length > 1 ? "advanced" : existing?.channelMode ?? "fast",
    groups,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

export function relaySettingsView(provider: ProviderConfig): RelaySettingsView {
  const providerCredentialConfigured = Boolean(provider.apiKeyRef?.trim());
  return {
    providerId: provider.id,
    providerName: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl ?? "",
    defaultModel: provider.defaultModel?.trim() || null,
    models: uniqueStrings(provider.nativeModels),
    groups: (provider.groups ?? []).map((group) => ({
      groupId: group.id,
      groupName: group.name,
      baseUrl: group.baseUrl?.trim() || null,
      kind: group.kind ?? "text",
      enabled: group.status !== "disabled",
      groupRatio: Number.isFinite(group.groupRatio) ? group.groupRatio : 1,
      contextWindow: group.contextWindow && group.contextWindow > 0 ? Math.round(group.contextWindow) : null,
      models: uniqueStrings(group.models ?? []),
      modelCapabilities: { ...(group.modelCapabilities ?? {}) },
      responseProtocol: group.responseProtocol ?? null,
      responseProtocolMode: group.responseProtocolMode ?? null,
      claudeCodeHeadersEnabled: group.claudeCodeHeadersEnabled === true,
      claudeCodeVersion: group.claudeCodeVersion?.trim() || null,
      commandBlacklistEnabled: group.commandBlacklistEnabled !== false,
      commandBlacklist: [...(group.commandBlacklist ?? [])],
      networkAllowlist: [...(group.networkAllowlist ?? [])],
      apiKeyConfigured: group.authType === "none" || group.id === "cline-free" || group.id === "freebuff" || group.keys.some((key) => Boolean(key.trim()))
        || (group.credentialMode === "provider" && providerCredentialConfigured)
    }))
  };
}

export function setRelayGroupModels(
  provider: ProviderConfig,
  groupId: string,
  models: string[],
  modelCapabilities?: Record<string, ModelCapabilityDescriptor>
): ProviderConfig {
  const selectedModels = uniqueStrings(models);
  let found = false;
  const groups = (provider.groups ?? []).map((group) => {
    if (group.id !== groupId) return group;
    found = true;
    const availableCapabilities = modelCapabilities ?? group.modelCapabilities;
    const selectedCapabilities = availableCapabilities
      ? Object.fromEntries(Object.entries(availableCapabilities).filter(([model]) => selectedModels.includes(model)))
      : undefined;
    return { ...group, models: selectedModels, modelCapabilities: selectedCapabilities };
  });
  if (!found) throw new Error(`Group not found: ${groupId}`);
  const textModels = uniqueStrings(groups.filter((group) => group.kind !== "image").flatMap((group) => group.models ?? []));
  return {
    ...provider,
    groups,
    nativeModels: textModels,
    defaultModel: provider.defaultModel && textModels.includes(provider.defaultModel)
      ? provider.defaultModel
      : textModels[0],
    updatedAt: Date.now()
  };
}

export function selectFetchedRelayModels(fetchedModels: string[], selectedModels?: string[]): string[] {
  const fetched = uniqueStrings(fetchedModels);
  if (selectedModels === undefined) return fetched;
  const selected = uniqueStrings(selectedModels);
  const available = new Set(fetched);
  const unavailable = selected.filter((model) => !available.has(model));
  if (unavailable.length > 0) {
    throw new Error(`Selected models were not returned by the relay: ${unavailable.join(", ")}`);
  }
  return selected;
}

function buildRelayGroup(
  input: Record<string, unknown>,
  existing: ChannelGroupConfig | undefined,
  providerKindValue: ProviderConfig["kind"]
): ChannelGroupConfig {
  const name = firstString(input.groupName, input.channelName, input.name, existing?.name);
  if (!name) throw new Error("groupName is required");
  const id = firstString(input.groupId, input.id, existing?.id) ?? slugId(name, "default");
  const inputKeys = optionalStringArray(input, "keys");
  const apiKey = firstString(input.apiKey);
  const keys = apiKey
    ? [apiKey]
    : (inputKeys && inputKeys.length > 0 ? inputKeys : existing?.keys ?? []);
  const ratioValue = input.groupRatio ?? input.ratio;
  const groupRatio = ratioValue === undefined
    ? existing?.groupRatio ?? 1
    : finiteNumber(ratioValue, "groupRatio", 0);
  const enabled = typeof input.enabled === "boolean"
    ? input.enabled
    : input.status === "disabled"
      ? false
      : input.status === "enabled"
        ? true
        : existing?.status !== "disabled";
  const models = optionalStringArray(input, "models") ?? existing?.models ?? [];
  const requestedContextWindow = input.contextWindow === undefined
    ? existing?.contextWindow
    : finiteNumber(input.contextWindow, "contextWindow", 0);
  const kind = input.kind === "image" || input.kind === "text" ? input.kind : existing?.kind ?? "text";
  const responseProtocol = relayResponseProtocol(input.responseProtocol, existing?.responseProtocol
    ?? (providerKindValue === "openai" ? "openai" : "openai-response"));
  const responseProtocolMode = input.responseProtocolMode === "model_auto" || input.responseProtocolMode === "fixed"
    ? input.responseProtocolMode
    : existing?.responseProtocolMode ?? "fixed";

  return {
    ...(existing ?? {}),
    id,
    name,
    baseUrl: firstString(input.baseUrl, input.baseURL, existing?.baseUrl),
    kind,
    status: enabled ? "enabled" : "disabled",
    groupRatio,
    contextWindow: requestedContextWindow && requestedContextWindow > 0 ? Math.round(requestedContextWindow) : undefined,
    models,
    modelCapabilities: modelCapabilitiesValue(input.modelCapabilities) ?? existing?.modelCapabilities,
    responseProtocol,
    responseProtocolMode,
    claudeCodeHeadersEnabled: typeof input.claudeCodeHeadersEnabled === "boolean"
      ? input.claudeCodeHeadersEnabled
      : existing?.claudeCodeHeadersEnabled === true,
    claudeCodeVersion: firstString(input.claudeCodeVersion, existing?.claudeCodeVersion),
    commandBlacklistEnabled: typeof input.commandBlacklistEnabled === "boolean"
      ? input.commandBlacklistEnabled
      : existing?.commandBlacklistEnabled !== false,
    commandBlacklist: optionalStringArray(input, "commandBlacklist") ?? existing?.commandBlacklist ?? [],
    networkAllowlist: optionalStringArray(input, "networkAllowlist") ?? existing?.networkAllowlist ?? [],
    authType: relayAuthType(input.authType, existing?.authType ?? "inherit"),
    credentialMode: existing?.credentialMode ?? "group",
    keyMode: existing?.keyMode ?? "polling",
    keys
  };
}

function relayAuthType(value: unknown, fallback: ChannelGroupConfig["authType"]): ChannelGroupConfig["authType"] {
  return value === "none"
    || value === "inherit"
    || value === "bearer"
    || value === "anthropic"
    || value === "google_api_key"
    || value === "google_query_key"
    ? value
    : fallback;
}

function relayGroupInputs(body: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(body.groups)) return body.groups.map(recordValue);
  if (body.group && typeof body.group === "object" && !Array.isArray(body.group)) return [recordValue(body.group)];
  if (["groupId", "groupName", "apiKey", "groupRatio"].some((key) => key in body)) return [body];
  return [];
}

function cloneGroup(group: ChannelGroupConfig): ChannelGroupConfig {
  return {
    ...group,
    keys: [...group.keys],
    models: group.models ? [...group.models] : undefined,
    modelCapabilities: group.modelCapabilities ? { ...group.modelCapabilities } : undefined,
    commandBlacklist: group.commandBlacklist ? [...group.commandBlacklist] : undefined,
    networkAllowlist: group.networkAllowlist ? [...group.networkAllowlist] : undefined
  };
}

function modelCapabilitiesValue(value: unknown): Record<string, ModelCapabilityDescriptor> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, ModelCapabilityDescriptor> = {};
  for (const [model, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const reasoningEfforts = Array.isArray(record.reasoningEfforts)
      ? record.reasoningEfforts.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : undefined;
    const contextWindow = typeof record.contextWindow === "number" && Number.isFinite(record.contextWindow) && record.contextWindow > 0
      ? Math.round(record.contextWindow)
      : undefined;
    const maxOutputTokens = typeof record.maxOutputTokens === "number" && Number.isFinite(record.maxOutputTokens) && record.maxOutputTokens > 0
      ? Math.round(record.maxOutputTokens)
      : undefined;
    if (!reasoningEfforts?.length && !contextWindow && !maxOutputTokens) continue;
    result[model] = {
      ...(reasoningEfforts?.length ? { reasoningEfforts } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      source: record.source === "catalog" || record.source === "inferred" ? record.source : "upstream"
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function optionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  if (!(key in record)) return undefined;
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
  return uniqueStrings(value as string[]);
}

function providerKind(value: unknown, fallback: ProviderConfig["kind"]): ProviderConfig["kind"] {
  switch (value) {
    case "chatgpt":
    case "openai":
    case "responsesRelay":
    case "ollama":
    case "lmstudio":
    case "bedrock":
      return value;
    case undefined:
      return fallback;
    default:
      throw new Error("kind is not supported");
  }
}

function relayResponseProtocol(value: unknown, fallback: RelayResponseProtocol): RelayResponseProtocol {
  switch (value) {
    case "openai-response":
    case "openai":
    case "anthropic":
    case "gemini":
      return value;
    case undefined:
      return fallback;
    default:
      throw new Error("responseProtocol is not supported");
  }
}

function finiteNumber(value: unknown, name: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be a finite number greater than or equal to ${minimum}`);
  }
  return value;
}

function slugId(value: string, fallback: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
