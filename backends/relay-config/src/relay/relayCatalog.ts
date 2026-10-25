import { createHash } from "node:crypto";
import type {
  ChannelGroupConfig,
  ImageGenerationProtocol,
  JsonValue,
  RelayCapabilityCatalog,
  RelayCatalogEndpoint,
  RelayCatalogImportPreview,
  RelayCatalogModel,
  RelayCatalogVendor,
  RelayResponseProtocol
} from "@codex-ui/shared";

const MODEL_FIELDS = new Set([
  "model_name",
  "icon",
  "vendor_id",
  "quota_type",
  "model_ratio",
  "model_price",
  "completion_ratio",
  "cache_ratio",
  "create_cache_ratio",
  "owner_by",
  "enable_groups",
  "supported_endpoint_types",
  "extensions"
]);

const VENDOR_FIELDS = new Set(["id", "name", "icon", "extensions"]);
const ENDPOINT_FIELDS = new Set(["path", "method", "aliases", "extensions"]);
const CATALOG_FIELDS = new Set([
  "schema",
  "success",
  "auto_groups",
  "data",
  "group_ratio",
  "usable_group",
  "supported_endpoint",
  "vendors",
  "imported_at",
  "source_hash",
  "warnings",
  "extensions"
]);
const CONVERSATION_PROTOCOLS: RelayResponseProtocol[] = ["openai-response", "openai", "anthropic", "gemini"];
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const CATALOG_FETCH_TIMEOUT_MS = 15_000;

export async function fetchRelayCapabilityCatalog(urlInput: string): Promise<RelayCapabilityCatalog> {
  let url: URL;
  try {
    url = new URL(urlInput.trim());
  } catch {
    throw new Error("Capability catalog URL is invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Capability catalog URL must use HTTP or HTTPS");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Capability catalog request failed (${response.status})`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) {
      throw new Error("Capability catalog response exceeds 2 MB");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_CATALOG_BYTES) {
      throw new Error("Capability catalog response exceeds 2 MB");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Capability catalog response is not valid JSON");
    }
    return parseRelayCapabilityCatalog(parsed);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Capability catalog request timed out after 15 seconds");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function canonicalEndpointType(value: string): string {
  switch (value.trim().toLowerCase()) {
    case "vidoes":
      return "videos";
    case "openai-responses-compact":
      return "openai-response-compact";
    case "openai-responses-compaction-v2":
      return "openai-response-compaction-v2";
    default:
      return value.trim().toLowerCase();
  }
}

export function parseRelayCapabilityCatalog(value: unknown, now = Date.now()): RelayCapabilityCatalog {
  const record = asRecord(value);
  const warnings = stringArray(record.warnings);
  if (record.success !== true) {
    throw new Error("Capability catalog success must be true");
  }
  const models = parseModels(record.data, warnings);
  if (!Array.isArray(record.data)) {
    throw new Error("Capability catalog is missing data[]");
  }
  if (models.length === 0) {
    throw new Error("Capability catalog contains no valid models");
  }

  const groupRatio = numberRecord(record.group_ratio, "group_ratio", warnings);
  const usableGroup = stringRecord(record.usable_group, "usable_group", warnings);
  const autoGroups = uniqueStrings(stringArray(record.auto_groups));
  const supportedEndpoint = parseEndpoints(record.supported_endpoint, warnings);
  const vendors = parseVendors(record.vendors, warnings);

  const referencedGroups = new Set(models.flatMap((model) => model.enable_groups));
  for (const groupName of referencedGroups) {
    if (!(groupName in usableGroup)) {
      usableGroup[groupName] = groupName;
      warnings.push(`Group ${groupName} is referenced by a model but missing from usable_group.`);
    }
    if (!(groupName in groupRatio)) {
      groupRatio[groupName] = 1;
      warnings.push(`Group ${groupName} is missing group_ratio; defaulted to 1.`);
    }
  }
  for (const groupName of new Set([...Object.keys(usableGroup), ...Object.keys(groupRatio), ...autoGroups])) {
    if (!(groupName in usableGroup)) usableGroup[groupName] = groupName;
    if (!(groupName in groupRatio)) groupRatio[groupName] = 1;
    if (!referencedGroups.has(groupName)) {
      warnings.push(`Group ${groupName} has no model membership.`);
    }
  }

  const extra = extraFields(record, CATALOG_FIELDS);
  const existingExt = unwrapExtensions(record.extensions);
  const extensions = {
    ...(existingExt ?? {}),
    ...extra
  };
  return {
    schema: "codex-react-ui.relay-catalog.v1",
    success: booleanValue(record.success) ?? true,
    auto_groups: autoGroups,
    data: models,
    group_ratio: groupRatio,
    usable_group: usableGroup,
    supported_endpoint: supportedEndpoint,
    vendors,
    imported_at: finiteNumber(record.imported_at) ?? now,
    source_hash: stringValue(record.source_hash) ?? sourceHash(value),
    warnings: uniqueStrings(warnings),
    extensions: Object.keys(extensions).length > 0 ? extensions : undefined
  };
}

export function deriveCatalogGroups(catalog: RelayCapabilityCatalog): ChannelGroupConfig[] {
  const groupNames = uniqueStrings([
    ...Object.keys(catalog.usable_group),
    ...Object.keys(catalog.group_ratio),
    ...catalog.auto_groups,
    ...catalog.data.flatMap((model) => model.enable_groups)
  ]);

  return groupNames.map((groupName, index) => {
    const models = catalog.data.filter((model) => model.enable_groups.includes(groupName));
    const endpointUnion = uniqueStrings(models.flatMap((model) => model.supported_endpoint_types));
    const commonEndpoints = intersectEndpoints(models);
    const commonProtocols = preferredProtocols(groupName, commonEndpoints);
    const unionProtocols = preferredProtocols(groupName, endpointUnion);
    const responseProtocol = commonProtocols[0] ?? unionProtocols[0] ?? "openai-response";
    const responseProtocolMode = commonProtocols.length > 0 || models.length === 0 ? "fixed" : "model_auto";
    const imageGroup = isImageGroup(groupName, models);
    const image = catalogImageConfig(groupName, models, endpointUnion);
    const hasText = models.some((model) => model.supported_endpoint_types.some((endpoint) => CONVERSATION_PROTOCOLS.includes(endpoint as RelayResponseProtocol)));

    return {
      id: `catalog:${groupName}`,
      name: groupName,
      kind: imageGroup ? "image" : "text",
      capabilities: {
        text: imageGroup ? false : hasText || !imageGroup,
        imageGeneration: image?.generations ?? (imageGroup ? true : undefined),
        imageEdits: image?.edits ?? (imageGroup ? true : undefined)
      },
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
      credentialMode: "provider",
      catalogGroupName: groupName,
      catalogManaged: true,
      image,
      remark: catalog.usable_group[groupName] || groupName,
      autoBan: true,
      keys: [],
      enableFallback: false
    };
  });
}

export function buildCatalogImportPreview(
  providerId: string,
  existingGroups: ChannelGroupConfig[],
  input: unknown
): RelayCatalogImportPreview {
  const catalog = parseRelayCapabilityCatalog(input);
  const groups = deriveCatalogGroups(catalog);
  const existingGroupsByName = new Map(existingGroups.map((group) => [group.catalogGroupName ?? group.name, group]));
  let add = 0;
  let update = 0;
  let unchanged = 0;
  for (const group of groups) {
    const existing = existingGroupsByName.get(group.catalogGroupName ?? group.name);
    if (!existing) {
      add += 1;
    } else if (catalogGroupChanged(existing, group)) {
      update += 1;
    } else {
      unchanged += 1;
    }
  }
  const incomingNames = new Set(groups.map((group) => group.catalogGroupName ?? group.name));
  const remove = existingGroups.filter((group) => group.catalogManaged && !incomingNames.has(group.catalogGroupName ?? group.name)).length;
  return {
    provider_id: providerId,
    counts: {
      models: catalog.data.length,
      groups: groups.length,
      vendors: catalog.vendors.length,
      endpoints: Object.keys(catalog.supported_endpoint).length
    },
    changes: { add, update, remove, unchanged },
    groups,
    warnings: catalog.warnings,
    catalog
  };
}

export function mergeCatalogGroups(
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
    return [mergeCatalogGroup(existing, imported)];
  });
  return [...merged, ...importedByName.values()];
}

const REQUIRED_IMAGE_RUNTIME_GROUPS = new Set(["gpt-image", "gpt-image-adobe", "gpt-azure"]);

/**
 * Upgrade the small set of DeepKey groups that participate in the split image
 * runtime. Older profiles can contain a catalog but only the groups selected
 * during the original import, and can retain the former gpt-image-2-1k
 * default. Keep every unrelated/manual group untouched while adding or
 * refreshing only the image runtime groups advertised by the saved catalog.
 */
export function reconcileRequiredImageCatalogGroups(
  existingGroups: ChannelGroupConfig[],
  catalog: RelayCapabilityCatalog
): ChannelGroupConfig[] {
  const required = deriveCatalogGroups(catalog).filter((group) =>
    REQUIRED_IMAGE_RUNTIME_GROUPS.has((group.catalogGroupName ?? group.name).toLowerCase())
  );
  if (required.length === 0) return existingGroups;
  return mergeCatalogGroups(existingGroups, required, "merge");
}

export function resolveModelProtocol(
  group: ChannelGroupConfig,
  model: RelayCatalogModel | undefined
): RelayResponseProtocol {
  if (group.responseProtocolMode !== "model_auto") {
    return group.responseProtocol ?? "openai-response";
  }
  const supported = model?.supported_endpoint_types ?? group.supportedEndpointTypes ?? [];
  return preferredProtocols(group.catalogGroupName ?? group.name, supported)[0] ?? group.responseProtocol ?? "openai-response";
}

export function modelSupportsProtocol(model: RelayCatalogModel | undefined, protocol: RelayResponseProtocol): boolean {
  if (!model) return true;
  return model.supported_endpoint_types.includes(protocol);
}

function mergeCatalogGroup(existing: ChannelGroupConfig, imported: ChannelGroupConfig): ChannelGroupConfig {
  const refreshManagedMetadata = existing.catalogManaged === true;
  return {
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
    keys: existing.keys,
    enableFallback: existing.enableFallback,
    fallbackChannelId: existing.fallbackChannelId,
    fallbackGroupName: existing.fallbackGroupName,
    enableTieredContext: existing.enableTieredContext,
    tieredContextRatios: existing.tieredContextRatios
  };
}

function parseModels(value: unknown, warnings: string[]): RelayCatalogModel[] {
  if (!Array.isArray(value)) return [];
  const models: RelayCatalogModel[] = [];
  const names = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const record = asRecord(entry);
    const modelName = stringValue(record.model_name);
    if (!modelName) {
      warnings.push(`Skipped model at data[${index}] because model_name is missing.`);
      continue;
    }
    if (names.has(modelName)) {
      warnings.push(`Skipped duplicate model_name ${modelName}.`);
      continue;
    }
    names.add(modelName);
    const rawQuotaType = finiteNumber(record.quota_type);
    const quotaType: 0 | 1 = rawQuotaType === 1 ? 1 : 0;
    if (rawQuotaType !== 0 && rawQuotaType !== 1) {
      warnings.push(`Model ${modelName} has invalid quota_type; defaulted to 0.`);
    }
    const endpoints = uniqueStrings(stringArray(record.supported_endpoint_types).map(canonicalEndpointType));
    const rawEndpoints = stringArray(record.supported_endpoint_types);
    if (rawEndpoints.includes("vidoes")) warnings.push(`Model ${modelName}: normalized vidoes to videos.`);
    if (rawEndpoints.includes("openai-responses-compact")) {
      warnings.push(`Model ${modelName}: normalized openai-responses-compact to openai-response-compact.`);
    }
    const extra = extraFields(record, MODEL_FIELDS);
    const existingExt = unwrapExtensions(record.extensions);
    const extensions = {
      ...(existingExt ?? {}),
      ...extra
    };
    models.push({
      model_name: modelName,
      icon: stringValue(record.icon),
      vendor_id: finiteNumber(record.vendor_id),
      quota_type: quotaType,
      model_ratio: finiteNumber(record.model_ratio),
      model_price: finiteNumber(record.model_price),
      completion_ratio: finiteNumber(record.completion_ratio),
      cache_ratio: finiteNumber(record.cache_ratio),
      create_cache_ratio: finiteNumber(record.create_cache_ratio),
      owner_by: typeof record.owner_by === "string" ? record.owner_by : undefined,
      enable_groups: uniqueStrings(stringArray(record.enable_groups)),
      supported_endpoint_types: endpoints,
      extensions: Object.keys(extensions).length > 0 ? extensions : undefined
    });
  }
  return models;
}

function parseVendors(value: unknown, warnings: string[]): RelayCatalogVendor[] {
  if (!Array.isArray(value)) {
    warnings.push("vendors is missing or is not an array.");
    return [];
  }
  const vendors: RelayCatalogVendor[] = [];
  const ids = new Set<number>();
  for (const [index, entry] of value.entries()) {
    const record = asRecord(entry);
    const id = finiteNumber(record.id);
    const name = stringValue(record.name);
    if (id == null || !name || ids.has(id)) {
      warnings.push(`Skipped invalid or duplicate vendor at vendors[${index}].`);
      continue;
    }
    ids.add(id);
    const extra = extraFields(record, VENDOR_FIELDS);
    const existingExt = unwrapExtensions(record.extensions);
    const extensions = {
      ...(existingExt ?? {}),
      ...extra
    };
    vendors.push({
      id,
      name,
      icon: stringValue(record.icon),
      extensions: Object.keys(extensions).length > 0 ? extensions : undefined
    });
  }
  return vendors;
}

function parseEndpoints(value: unknown, warnings: string[]): Record<string, RelayCatalogEndpoint> {
  const record = asRecord(value);
  const endpoints: Record<string, RelayCatalogEndpoint> = {};
  for (const [rawType, rawEntry] of Object.entries(record)) {
    const endpointType = canonicalEndpointType(rawType);
    let endpointRecord = asRecord(rawEntry);
    let path = stringValue(endpointRecord.path);
    let method = stringValue(endpointRecord.method)?.toUpperCase() ?? "POST";
    if (path?.trim().startsWith("{")) {
      try {
        const nested = asRecord(JSON.parse(path));
        path = stringValue(nested.path) ?? path;
        method = stringValue(nested.method)?.toUpperCase() ?? method;
        warnings.push(`Endpoint ${rawType}: normalized JSON-encoded path metadata.`);
      } catch {
        warnings.push(`Endpoint ${rawType}: path looks JSON encoded but could not be parsed.`);
      }
    }
    if (!path) {
      warnings.push(`Skipped endpoint ${rawType} because path is missing.`);
      continue;
    }
    const previous = endpoints[endpointType];
    const aliases = uniqueStrings([...(previous?.aliases ?? []), ...(rawType !== endpointType ? [rawType] : [])]);
    const extra = extraFields(endpointRecord, ENDPOINT_FIELDS);
    const existingExt = unwrapExtensions(endpointRecord.extensions);
    const extensions = {
      ...(existingExt ?? {}),
      ...extra
    };
    endpoints[endpointType] = {
      path,
      method,
      aliases: aliases.length > 0 ? aliases : undefined,
      extensions: Object.keys(extensions).length > 0 ? extensions : undefined
    };
    if (rawType !== endpointType) warnings.push(`Endpoint ${rawType}: normalized to ${endpointType}.`);
  }
  return endpoints;
}

function intersectEndpoints(models: RelayCatalogModel[]): string[] {
  if (models.length === 0) return [];
  let intersection = new Set(models[0]?.supported_endpoint_types ?? []);
  for (const model of models.slice(1)) {
    const endpoints = new Set(model.supported_endpoint_types);
    intersection = new Set([...intersection].filter((endpoint) => endpoints.has(endpoint)));
  }
  return [...intersection];
}

function preferredProtocols(groupName: string, endpoints: string[]): RelayResponseProtocol[] {
  const supported = new Set(endpoints.filter((endpoint): endpoint is RelayResponseProtocol => CONVERSATION_PROTOCOLS.includes(endpoint as RelayResponseProtocol)));
  const group = groupName.toLowerCase();
  const priority: RelayResponseProtocol[] = group.includes("claude")
    ? ["anthropic", "openai-response", "openai", "gemini"]
    : group.includes("gemini")
      ? ["gemini", "openai-response", "openai", "anthropic"]
      : ["openai-response", "openai", "anthropic", "gemini"];
  return priority.filter((protocol) => supported.has(protocol));
}

function isImageGroup(groupName: string, models: RelayCatalogModel[]): boolean {
  if (/image|banana|video/i.test(groupName)) return true;
  if (models.length === 0) return false;
  return models.every((model) =>
    model.quota_type === 1
    && model.supported_endpoint_types.some((endpoint) => ["image-generation", "image-edits", "videos"].includes(endpoint))
  );
}

function catalogImageConfig(
  groupName: string,
  models: RelayCatalogModel[],
  endpoints: string[]
): ChannelGroupConfig["image"] {
  const normalized = groupName.toLowerCase();
  const generation = endpoints.includes("image-generation") || normalized === "gpt-image" || normalized === "gpt-image-adobe" || normalized === "gpt-azure";
  const edits = endpoints.includes("image-edits") || normalized === "gpt-image" || normalized === "gpt-image-adobe" || normalized === "gpt-azure";
  if (!generation && !edits) return undefined;
  const requestedDefault = normalized === "gpt-image" || normalized === "gpt-image-adobe"
    ? "gpt-image-2-count"
    : normalized === "gpt-azure" ? "gpt-image-2" : undefined;
  const discoveredDefault = models.find((model) => model.supported_endpoint_types.includes("image-generation"))?.model_name;
  const perImagePrice = normalized === "gpt-image" ? 0.08 : normalized === "gpt-image-adobe" ? 0.12 : undefined;
  return {
    generations: generation,
    edits,
    defaultModel: requestedDefault ?? discoveredDefault,
    protocols: [generation ? "openaiImages" : null, edits ? "openaiImageEdits" : null].filter(Boolean) as ImageGenerationProtocol[],
    defaultProtocol: generation ? "openaiImages" : "openaiImageEdits",
    modelPrices: perImagePrice != null && requestedDefault ? [{ model: requestedDefault, usdPerImage: perImagePrice }] : undefined,
    billing: perImagePrice != null
      ? { mode: "per_image", usdPerImage: perImagePrice, currency: "USD" }
      : normalized === "gpt-azure" ? { mode: "token_multiplier", multiplier: 1.2, currency: "USD" } : undefined,
    availability: normalized === "gpt-azure" ? "constrained" : "available",
    notice: normalized === "gpt-azure" ? "当前 gpt-azure 图片资源不足" : undefined
  };
}

function catalogGroupChanged(existing: ChannelGroupConfig, incoming: ChannelGroupConfig): boolean {
  return existing.groupRatio !== incoming.groupRatio
    || existing.remark !== incoming.remark
    || existing.kind !== incoming.kind
    || JSON.stringify(existing.capabilities ?? {}) !== JSON.stringify(incoming.capabilities ?? {})
    || JSON.stringify(existing.image ?? {}) !== JSON.stringify(incoming.image ?? {})
    || existing.responseProtocol !== incoming.responseProtocol
    || existing.responseProtocolMode !== incoming.responseProtocolMode
    || JSON.stringify(existing.models ?? []) !== JSON.stringify(incoming.models ?? [])
    || JSON.stringify(existing.supportedEndpointTypes ?? []) !== JSON.stringify(incoming.supportedEndpointTypes ?? []);
}

function numberRecord(value: unknown, field: string, warnings: string[]): Record<string, number> {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) warnings.push(`${field} is missing or empty.`);
  const result: Record<string, number> = {};
  for (const [rawKey, entry] of Object.entries(record)) {
    const key = rawKey.trim();
    if (!key) {
      warnings.push(`${field} contains an empty group name and it was ignored.`);
      continue;
    }
    const parsed = finiteNumber(entry);
    if (parsed == null) warnings.push(`${field}.${key} is not a finite number and was ignored.`);
    else result[key] = parsed;
  }
  return result;
}

function stringRecord(value: unknown, field: string, warnings: string[]): Record<string, string> {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) warnings.push(`${field} is missing or empty.`);
  const result: Record<string, string> = {};
  for (const [rawKey, entry] of Object.entries(record)) {
    const key = rawKey.trim();
    if (!key) {
      warnings.push(`${field} contains an empty group name and it was ignored.`);
      continue;
    }
    if (typeof entry === "string") result[key] = entry;
    else warnings.push(`${field}.${key} is not a string and was ignored.`);
  }
  return result;
}

export function unwrapExtensions(val: unknown): Record<string, JsonValue> | undefined {
  if (!val || typeof val !== "object" || Array.isArray(val)) return undefined;
  let current: unknown = val;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !Array.isArray(current) && "extensions" in current && Object.keys(current).length === 1) {
    if (seen.has(current)) break;
    seen.add(current);
    current = (current as Record<string, unknown>).extensions;
  }
  const rec = asRecord(current);
  return Object.keys(rec).length > 0 ? (rec as Record<string, JsonValue>) : undefined;
}

function extraFields(record: Record<string, unknown>, known: Set<string>): Record<string, JsonValue> {
  const extra: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!known.has(key) && isJsonValue(value)) extra[key] = value;
  }
  return extra;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value == null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every(isJsonValue);
  return false;
}

function sourceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return value === 0 || value === 1 ? Boolean(value) : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim()) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
