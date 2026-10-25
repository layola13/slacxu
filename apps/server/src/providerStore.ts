import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RuntimeDatabase } from "./runtime/database.js";
import type { AsyncEntry } from "@napi-rs/keyring";
import type {
  AdvancedModelMappingRule,
  ChannelGroupConfig,
  ImageGenerationProtocol,
  ProviderConfig,
  RelayCatalogImportPreview,
  RelayCatalogImportResult,
  RelayCapabilityCatalog,
  RelayBackupBundle,
  RelayConfigBundle,
  UiProfile,
  UiProfileImportResult
} from "@codex-ui/shared";
import { codexUiDataDir, LocalDatabase } from "./localDatabase.js";
import { buildCatalogImportPreview, deriveCatalogGroups, mergeCatalogGroups, parseRelayCapabilityCatalog, reconcileRequiredImageCatalogGroups } from "../../../backends/relay-config/src/relay/relayCatalog.js";

type StoreShape = {
  providers: ProviderConfig[];
};

type RelayGroupRow = {
  provider_id: string;
  group_id: string;
  name: string;
  base_url?: string | null;
  kind: string;
  status: string | null;
  group_ratio: number;
  quota_usd: number | null;
  used_quota_usd: number | null;
  priority: number | null;
  weight: number | null;
  key_mode: string | null;
  response_protocol?: string | null;
  response_protocol_mode?: string | null;
  claude_code_headers_enabled?: number | null;
  claude_code_version?: string | null;
  endpoint_path_override?: string | null;
  auth_type?: string | null;
  credential_mode?: string | null;
  catalog_group_name?: string | null;
  catalog_managed?: number | null;
  keys_json: string;
  models_json: string;
  model_capabilities_json?: string | null;
  supported_endpoint_types_json?: string | null;
  image_json?: string | null;
  model_mapping_json: string;
  status_code_mapping_json: string;
  advanced_model_mapping_json?: string | null;
  tag: string | null;
  remark: string | null;
  auto_ban: number | null;
  request_limit: number | null;
  request_interval_seconds: number | null;
  context_window: number | null;
  command_blacklist_enabled: number | null;
  command_blacklist_json: string;
  network_allowlist_json: string;
  enable_fallback: number | null;
  fallback_channel_id: string | null;
  fallback_group_name: string | null;
  enable_tiered_context: number | null;
  tiered_context_ratios_json: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

export class ProviderStore {
  private readonly dir = codexUiDataDir();
  private readonly file = join(this.dir, "providers.json");
  private readonly db: RuntimeDatabase;
  private memorySecrets = new Map<string, string>();
  private transientProviders = new Map<string, ProviderConfig>();
  private transientOnlyProviderIds = new Set<string>();

  public constructor(database: Pick<LocalDatabase, "connection"> = new LocalDatabase()) {
    this.db = database.connection;
    this.ensureSchema();
    this.migrateRelayGroupsFromPayloads();
  }

  public async initialize(): Promise<void> {
    await this.migrateLegacyProviders();
    const store = await this.read();
    let changed = false;
    const validProviders: ProviderConfig[] = [];
    for (const provider of store.providers) {
      const persistedGroups = this.readRelayGroups().get(provider.id) ?? [];
      if (!relayGroupTopologyMatches(provider.groups ?? [], persistedGroups)) {
        changed = true;
      }
      const persistedSecret = this.readPersistedProviderKey(provider.id);
      let groupedProvider = ensureDefaultRelayGroup(provider, persistedSecret);
      if (groupedProvider.capabilityCatalog) {
        const reconciledGroups = reconcileRequiredImageCatalogGroups(groupedProvider.groups ?? [], groupedProvider.capabilityCatalog);
        if (JSON.stringify(reconciledGroups) !== JSON.stringify(groupedProvider.groups ?? [])) {
          groupedProvider = { ...groupedProvider, groups: reconciledGroups, updatedAt: Date.now() };
          changed = true;
        }
      }
      if (!hasValidRelayGroups(groupedProvider)) {
        changed = true;
        this.memorySecrets.delete(provider.id);
        this.deletePersistedProviderKey(provider.id);
        continue;
      }
      validProviders.push(groupedProvider);
      if (persistedSecret) {
        this.memorySecrets.set(provider.id, persistedSecret);
        if (provider.apiKeyStorage !== "database") {
          provider.apiKeyStorage = "database";
          changed = true;
        }
        continue;
      }
      if (!provider.apiKeyRef) {
        if (provider.apiKeyStorage !== "none") {
          provider.apiKeyStorage = "none";
          changed = true;
        }
        continue;
      }
      try {
        const entry = keyringEntry(provider.id);
        const secret = entry ? await entry.getPassword() : null;
        if (secret) {
          this.memorySecrets.set(provider.id, secret);
          if (provider.apiKeyStorage !== "keyring") {
            provider.apiKeyStorage = "keyring";
            changed = true;
          }
        } else if (provider.apiKeyStorage !== "memory") {
          provider.apiKeyStorage = "memory";
          changed = true;
        }
      } catch {
        if (provider.apiKeyStorage !== "memory") {
          provider.apiKeyStorage = "memory";
          changed = true;
        }
      }
    }
    if (changed) {
      await this.write({ providers: validProviders });
    }
  }

  public async list(): Promise<ProviderConfig[]> {
    const persisted = (await this.read()).providers.filter((provider) => !provider.trashedAt && !this.transientProviders.has(provider.id));
    return [...persisted, ...this.transientProviders.values()].filter((provider) => !provider.trashedAt);
  }

  public async listTrashed(): Promise<ProviderConfig[]> {
    const persisted = (await this.read()).providers.filter((provider) => Boolean(provider.trashedAt) && !this.transientProviders.has(provider.id));
    return [...persisted, ...this.transientProviders.values()].filter((provider) => Boolean(provider.trashedAt));
  }

  public async get(id: string): Promise<ProviderConfig | null> {
    return this.transientProviders.get(id) ?? (await this.read()).providers.find((provider) => provider.id === id) ?? null;
  }

  public async saveTransient(provider: ProviderConfig): Promise<ProviderConfig> {
    const now = Date.now();
    const clean = normalizeProvider({
      ...normalizeProviderTopology(provider),
      apiKeyStorage: "none",
      createdAt: provider.createdAt || now,
      updatedAt: now
    });
    if (!clean) throw new Error("Invalid transient provider config");
    validateRelayGroupKeys(clean, false);
    this.transientProviders.set(clean.id, clean);
    return clean;
  }

  public async reserveTransient(id: string): Promise<void> {
    const providerId = id.trim();
    if (!providerId) throw new Error("Transient provider id is required");
    await this.delete(providerId);
    this.transientOnlyProviderIds.add(providerId);
  }

  public async save(provider: ProviderConfig, apiKey?: string, mergeIntoProviderId?: string): Promise<ProviderConfig> {
    const now = Date.now();
    const requestedId = provider.id.trim();
    const secret = apiKey?.trim();
    const store = await this.read();
    const mergeTargetId = mergeIntoProviderId?.trim();
    const duplicate = mergeTargetId
      ? store.providers.find((entry) => entry.id === mergeTargetId)
      : requestedId
        ? undefined
        : store.providers.find((entry) => entry.name.trim().toLowerCase() === provider.name.trim().toLowerCase());
    if (mergeTargetId && !duplicate) throw new Error(`Provider not found: ${mergeTargetId}`);
    const id = duplicate?.id ?? (requestedId || providerIdFromName(provider.name));
    if (this.transientOnlyProviderIds.has(id)) return this.saveTransient({ ...provider, id });
    this.transientProviders.delete(id);
    const topology = normalizeProviderTopology(duplicate
      ? mergeProviderGroups(duplicate, provider, now)
      : { ...provider, id });
    validateRelayGroupKeys(topology, Boolean(secret));
    const apiKeyRef = secret ? `env:${envKeyForProvider(id)}` : topology.apiKeyRef;
    let apiKeyStorage = provider.apiKeyStorage ?? (provider.apiKeyRef ? "memory" : "none");
    if (secret) {
      this.memorySecrets.set(id, secret);
      apiKeyStorage = "database";
    }
    const clean = normalizeProvider({
      ...topology,
      id,
      apiKeyRef,
      apiKeyPreview: secret ? previewSecret(secret) : provider.apiKeyPreview,
      apiKeyStorage,
      createdAt: provider.createdAt || now,
      updatedAt: now
    });
    if (!clean) {
      throw new Error("Invalid provider config");
    }
    const next = store.providers.filter((entry) => entry.id !== id);
    next.push(clean);
    await this.write({ providers: next });
    if (secret) {
      this.persistProviderKey(id, secret);
    }
    return clean;
  }

  /**
   * P3 网关用量累加（对标 axonhub 额度消耗）：relay_groups 是 live 读源，
   * 原子 UPDATE 即可被后续 get() 看到；调用方保证单 request 只加一次
   *（record() inserted 语义），失败只 warn 不阻断记账。
   */
  public addUsedQuota(providerId: string, groupId: string, amountUsd: number): void {
    if (!providerId || !groupId || !Number.isFinite(amountUsd) || amountUsd <= 0) return;
    this.db.prepare(
      "UPDATE relay_groups SET used_quota_usd = COALESCE(used_quota_usd, 0) + ?, updated_at = ? WHERE provider_id = ? AND group_id = ?"
    ).run(amountUsd, Date.now(), providerId, groupId);
  }

  public runtimeEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [id, secret] of this.memorySecrets.entries()) {
      env[envKeyForProvider(id)] = secret;
    }
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith("CODEX_UI_PROVIDER_") && key.endsWith("_API_KEY") && typeof value === "string" && value.trim()) {
        env[key] = value;
      }
    }
    return env;
  }

  public providerApiKey(id: string): string {
    const memory = this.memorySecrets.get(id)?.trim();
    if (memory) return memory;
    const persisted = this.readPersistedProviderKey(id);
    if (persisted) {
      this.memorySecrets.set(id, persisted);
      return persisted;
    }
    const envKey = envKeyForProvider(id);
    return process.env[envKey]?.trim() ?? "";
  }

  public useProviderKey(id: string, apiKey: string): void {
    const key = apiKey.trim();
    if (key) {
      this.memorySecrets.set(id, key);
    }
  }

  public async delete(id: string): Promise<void> {
    this.transientProviders.delete(id);
    this.memorySecrets.delete(id);
    this.deletePersistedProviderKey(id);
    try {
      const entry = keyringEntry(id);
      if (entry) {
        await entry.deleteCredential();
      }
    } catch {
      // Missing or unavailable keyrings do not block provider deletion.
    }
    const store = await this.read();
    await this.write({ providers: store.providers.filter((entry) => entry.id !== id) });
  }

  public async trash(id: string): Promise<ProviderConfig> {
    const transient = this.transientProviders.get(id);
    if (transient) {
      const trashed = { ...transient, trashedAt: Date.now(), updatedAt: Date.now() };
      this.transientProviders.set(id, trashed);
      return trashed;
    }
    const store = await this.read();
    const existing = store.providers.find((entry) => entry.id === id);
    if (!existing) throw new Error(`Provider not found: ${id}`);
    const trashed = normalizeProvider({ ...existing, trashedAt: Date.now(), updatedAt: Date.now() });
    if (!trashed) throw new Error("Invalid provider config");
    await this.write({ providers: store.providers.map((entry) => entry.id === id ? trashed : entry) });
    return trashed;
  }

  public async restore(id: string): Promise<ProviderConfig> {
    const transient = this.transientProviders.get(id);
    if (transient) {
      const restored = { ...transient, trashedAt: undefined, updatedAt: Date.now() };
      this.transientProviders.set(id, restored);
      return restored;
    }
    const store = await this.read();
    const existing = store.providers.find((entry) => entry.id === id);
    if (!existing) throw new Error(`Provider not found: ${id}`);
    const restored = normalizeProvider({ ...existing, trashedAt: undefined, updatedAt: Date.now() });
    if (!restored) throw new Error("Invalid provider config");
    await this.write({ providers: store.providers.map((entry) => entry.id === id ? restored : entry) });
    return restored;
  }

  public async exportProfile(): Promise<UiProfile> {
    const store = await this.read();
    return {
      schema: "codex-react-ui.profile.v1",
      exportedAt: Date.now(),
      providers: store.providers.map((provider) => profileProvider(provider))
    };
  }

  public async importProfile(profile: unknown): Promise<UiProfileImportResult> {
    const record = asRecord(profile);
    if (record.schema !== "codex-react-ui.profile.v1") {
      throw new Error("Unsupported UI profile schema");
    }
    if (!Array.isArray(record.providers)) {
      throw new Error("UI profile is missing providers");
    }

    const store = await this.read();
    const providersById = new Map(store.providers.map((provider) => [provider.id, provider]));
    const imported = record.providers.map((entry) => {
      const existingId = stringValue(asRecord(entry).id);
      return normalizeProfileProvider(entry, existingId ? providersById.get(existingId) : undefined);
    });

    for (const provider of imported) {
      providersById.set(provider.id, provider);
    }
    const providers = Array.from(providersById.values());
    await this.write({ providers });
    return {
      importedProviders: imported.length,
      providers
    };
  }

  public async exportRelayConfig(): Promise<RelayConfigBundle> {
    const store = await this.read();
    return {
      schema: "codex-react-ui.relay-config.v1",
      exportedAt: Date.now(),
      includesSecrets: true,
      providers: store.providers
    };
  }

  public async exportRelayBackup(): Promise<RelayBackupBundle> {
    const store = await this.read();
    const providerIds = new Set(store.providers.map((provider) => provider.id));
    const providerSecrets = (this.db.prepare("SELECT provider_id, api_key FROM provider_secrets ORDER BY provider_id ASC").all() as Array<{ provider_id: string; api_key: string }>)
      .filter((entry) => providerIds.has(entry.provider_id) && entry.api_key.trim())
      .map((entry) => ({ providerId: entry.provider_id, apiKey: entry.api_key }));
    return {
      schema: "codex-react-ui.relay-backup.v1",
      exportedAt: Date.now(),
      includesSecrets: true,
      providers: store.providers,
      providerSecrets
    };
  }

  public async importRelayConfig(bundle: unknown): Promise<UiProfileImportResult> {
    const record = asRecord(bundle);
    if (record.schema !== "codex-react-ui.relay-config.v1") {
      throw new Error("Unsupported relay config schema");
    }
    if (record.includesSecrets !== true) {
      throw new Error("Relay config bundle must declare includesSecrets=true");
    }
    if (!Array.isArray(record.providers)) {
      throw new Error("Relay config is missing providers");
    }
    const store = await this.read();
    const providersById = new Map(store.providers.map((provider) => [provider.id, provider]));
    const imported = record.providers.map((entry) => {
      const existingId = stringValue(asRecord(entry).id);
      const normalized = normalizeProvider({
        ...asRecord(entry),
        id: existingId || undefined,
        createdAt: numberValue(asRecord(entry).createdAt) ?? providersById.get(existingId ?? "")?.createdAt ?? Date.now(),
        updatedAt: Date.now()
      });
      if (!normalized) {
        throw new Error("Invalid relay provider config");
      }
      return normalized;
    });

    for (const provider of imported) {
      providersById.set(provider.id, provider);
    }
    const providers = Array.from(providersById.values());
    await this.write({ providers });
    return {
      importedProviders: imported.length,
      providers
    };
  }

  public async importRelayBackup(bundle: unknown): Promise<UiProfileImportResult> {
    const record = asRecord(bundle);
    if (record.schema !== "codex-react-ui.relay-backup.v1") {
      throw new Error("Unsupported relay backup schema");
    }
    if (record.includesSecrets !== true) {
      throw new Error("Relay backup must declare includesSecrets=true");
    }
    if (!Array.isArray(record.providers)) {
      throw new Error("Relay backup is missing providers");
    }
    const providerSecrets = Array.isArray(record.providerSecrets) ? record.providerSecrets : [];
    const result = await this.importRelayConfig({
      schema: "codex-react-ui.relay-config.v1",
      exportedAt: numberValue(record.exportedAt) ?? Date.now(),
      includesSecrets: true,
      providers: record.providers
    });
    for (const entry of providerSecrets) {
      const secret = asRecord(entry);
      const providerId = stringValue(secret.providerId)?.trim();
      const apiKey = stringValue(secret.apiKey)?.trim();
      if (providerId && apiKey && result.providers.some((provider) => provider.id === providerId)) {
        this.persistProviderKey(providerId, apiKey);
      }
    }
    return result;
  }

  public async previewCapabilityCatalog(providerId: string, catalog: unknown): Promise<RelayCatalogImportPreview> {
    const provider = await this.get(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);
    this.validateCatalogProvider(provider);
    return buildCatalogImportPreview(providerId, provider.groups ?? [], catalog);
  }

  public async importCapabilityCatalog(
    providerId: string,
    catalogInput: unknown,
    mode: "merge" | "replace" = "merge"
  ): Promise<RelayCatalogImportResult> {
    const store = await this.read();
    const providerIndex = store.providers.findIndex((provider) => provider.id === providerId);
    if (providerIndex < 0) throw new Error(`Provider not found: ${providerId}`);
    const provider = store.providers[providerIndex]!;
    this.validateCatalogProvider(provider);
    const preview = buildCatalogImportPreview(providerId, provider.groups ?? [], catalogInput);
    const groups = mergeCatalogGroups(provider.groups ?? [], preview.groups, mode);
    const catalogModels = preview.catalog.data.map((model) => model.model_name);
    const nextProvider: ProviderConfig = {
      ...provider,
      channelMode: "advanced",
      nativeModels: uniqueStrings([...provider.nativeModels, ...catalogModels]),
      capabilityCatalog: preview.catalog,
      groups,
      updatedAt: Date.now()
    };
    store.providers[providerIndex] = nextProvider;
    await this.write(store);
    return { ...preview, provider: nextProvider, mode };
  }

  private validateCatalogProvider(provider: ProviderConfig): void {
    if (!provider.baseUrl?.trim()) {
      throw new Error("Capability catalogs require an existing Provider with a Base URL");
    }
  }

  private async read(): Promise<StoreShape> {
    const rows = this.db
      .prepare("SELECT id, payload FROM providers ORDER BY created_at ASC, id ASC")
      .all() as Array<{ id: string; payload: string }>;
    const groupsByProvider = this.readRelayGroups();
    return {
      providers: rows
        .map((row) => {
          const provider = parseProvider(row.payload);
          if (!provider) {
            return null;
          }
          const persistedGroups = groupsByProvider.get(row.id);
          const groups = selectConsistentRelayGroups(provider.groups ?? [], persistedGroups);
          return ensureDefaultRelayGroup(
            groups && groups.length > 0 ? { ...provider, groups } : provider,
            this.readPersistedProviderKey(row.id)
          );
        })
        .filter((provider): provider is ProviderConfig => Boolean(provider))
    };
  }

  private async write(store: StoreShape): Promise<void> {
    this.db.exec("BEGIN");
    try {
      this.clearCapabilityCatalogTables();
      this.db.prepare("DELETE FROM relay_groups").run();
      this.db.prepare("DELETE FROM providers").run();
      const insert = this.db.prepare("INSERT INTO providers (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)");
      const insertGroup = this.db.prepare(`
        INSERT INTO relay_groups (
          provider_id, group_id, name, base_url, kind, status, group_ratio, quota_usd, used_quota_usd,
          priority, weight, key_mode, response_protocol, response_protocol_mode, endpoint_path_override,
          auth_type, credential_mode, catalog_group_name, catalog_managed,
          keys_json, models_json, model_capabilities_json, supported_endpoint_types_json, image_json, model_mapping_json, status_code_mapping_json,
          advanced_model_mapping_json,
          tag, remark, auto_ban, request_limit, request_interval_seconds, context_window,
          enable_fallback, fallback_channel_id, fallback_group_name, enable_tiered_context, tiered_context_ratios_json,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const rawProvider of store.providers) {
        const provider = normalizeProviderTopology(rawProvider);
        insert.run(provider.id, JSON.stringify(provider), provider.createdAt ?? Date.now(), provider.updatedAt ?? Date.now());
        this.insertRelayGroups(insertGroup, provider);
        this.insertCapabilityCatalog(provider);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_secrets (
        provider_id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relay_groups (
        provider_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        name TEXT NOT NULL,
        base_url TEXT,
        kind TEXT NOT NULL DEFAULT 'text',
        status TEXT,
        group_ratio REAL NOT NULL DEFAULT 1,
        quota_usd REAL,
        used_quota_usd REAL,
        priority INTEGER,
        weight INTEGER,
        key_mode TEXT,
        response_protocol TEXT,
        response_protocol_mode TEXT,
        claude_code_headers_enabled INTEGER NOT NULL DEFAULT 0,
        claude_code_version TEXT,
        endpoint_path_override TEXT,
        auth_type TEXT,
        credential_mode TEXT,
        catalog_group_name TEXT,
        catalog_managed INTEGER,
        keys_json TEXT NOT NULL DEFAULT '[]',
        models_json TEXT NOT NULL DEFAULT '[]',
        model_capabilities_json TEXT NOT NULL DEFAULT '{}',
        supported_endpoint_types_json TEXT NOT NULL DEFAULT '[]',
        image_json TEXT,
        model_mapping_json TEXT NOT NULL DEFAULT '[]',
        status_code_mapping_json TEXT NOT NULL DEFAULT '[]',
        advanced_model_mapping_json TEXT NOT NULL DEFAULT '[]',
        tag TEXT,
        remark TEXT,
        auto_ban INTEGER,
        request_limit INTEGER,
        request_interval_seconds INTEGER,
        context_window INTEGER,
        command_blacklist_enabled INTEGER NOT NULL DEFAULT 1,
        command_blacklist_json TEXT NOT NULL DEFAULT '[]',
        network_allowlist_json TEXT NOT NULL DEFAULT '[]',
        enable_fallback INTEGER,
        fallback_channel_id TEXT,
        fallback_group_name TEXT,
        enable_tiered_context INTEGER,
        tiered_context_ratios_json TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, group_id),
        FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_relay_groups_provider_sort
        ON relay_groups(provider_id, sort_order, priority);

      CREATE TABLE IF NOT EXISTS relay_catalogs (
        provider_id TEXT PRIMARY KEY,
        success INTEGER NOT NULL,
        imported_at INTEGER NOT NULL,
        source_hash TEXT NOT NULL,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_catalog_groups (
        provider_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        usable_group TEXT NOT NULL,
        group_ratio REAL NOT NULL DEFAULT 1,
        response_protocol TEXT,
        response_protocol_mode TEXT,
        PRIMARY KEY (provider_id, group_name),
        FOREIGN KEY (provider_id) REFERENCES relay_catalogs(provider_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_catalog_models (
        provider_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        icon TEXT,
        vendor_id INTEGER,
        quota_type INTEGER NOT NULL DEFAULT 0,
        model_ratio REAL,
        model_price REAL,
        completion_ratio REAL,
        cache_ratio REAL,
        create_cache_ratio REAL,
        owner_by TEXT,
        extensions_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (provider_id, model_name),
        FOREIGN KEY (provider_id) REFERENCES relay_catalogs(provider_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_model_enable_groups (
        provider_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        group_name TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_name, group_name),
        FOREIGN KEY (provider_id, model_name) REFERENCES relay_catalog_models(provider_id, model_name) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_model_supported_endpoint_types (
        provider_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        endpoint_type TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_name, endpoint_type),
        FOREIGN KEY (provider_id, model_name) REFERENCES relay_catalog_models(provider_id, model_name) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_supported_endpoints (
        provider_id TEXT NOT NULL,
        endpoint_type TEXT NOT NULL,
        path TEXT NOT NULL,
        method TEXT NOT NULL,
        canonical_endpoint_type TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        extensions_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (provider_id, endpoint_type),
        FOREIGN KEY (provider_id) REFERENCES relay_catalogs(provider_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_vendors (
        provider_id TEXT NOT NULL,
        vendor_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        icon TEXT,
        extensions_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (provider_id, vendor_id),
        FOREIGN KEY (provider_id) REFERENCES relay_catalogs(provider_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_auto_groups (
        provider_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        PRIMARY KEY (provider_id, group_name),
        FOREIGN KEY (provider_id) REFERENCES relay_catalogs(provider_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_relay_catalog_models_vendor
        ON relay_catalog_models(provider_id, vendor_id, quota_type);
      CREATE INDEX IF NOT EXISTS idx_relay_model_groups_group
        ON relay_model_enable_groups(provider_id, group_name, model_name);
      CREATE INDEX IF NOT EXISTS idx_relay_model_endpoints_type
        ON relay_model_supported_endpoint_types(provider_id, endpoint_type, model_name);
    `);
    this.migrateProviderSecretsSchema();
    const relayGroupColumns: Array<[string, string]> = [
      ["response_protocol", "TEXT"],
      ["base_url", "TEXT"],
      ["response_protocol_mode", "TEXT"],
      ["claude_code_headers_enabled", "INTEGER NOT NULL DEFAULT 0"],
      ["claude_code_version", "TEXT"],
      ["endpoint_path_override", "TEXT"],
      ["auth_type", "TEXT"],
      ["credential_mode", "TEXT"],
      ["catalog_group_name", "TEXT"],
      ["catalog_managed", "INTEGER"],
      ["supported_endpoint_types_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["model_capabilities_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["image_json", "TEXT"],
      ["context_window", "INTEGER"],
      ["command_blacklist_enabled", "INTEGER NOT NULL DEFAULT 1"],
      ["command_blacklist_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["network_allowlist_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["advanced_model_mapping_json", "TEXT NOT NULL DEFAULT '[]'"]
    ];
    for (const [column, type] of relayGroupColumns) {
      try {
        this.db.prepare(`ALTER TABLE relay_groups ADD COLUMN ${column} ${type}`).run();
      } catch {
        // Column already exists.
      }
    }
  }

  private migrateProviderSecretsSchema(): void {
    const foreignKeys = this.db.prepare("PRAGMA foreign_key_list(provider_secrets)").all() as Array<{ table?: string }>;
    if (!foreignKeys.some((entry) => entry.table === "providers")) return;
    this.db.exec(`
      ALTER TABLE provider_secrets RENAME TO provider_secrets_legacy;
      CREATE TABLE provider_secrets (
        provider_id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO provider_secrets (provider_id, api_key, updated_at)
        SELECT provider_id, api_key, updated_at FROM provider_secrets_legacy;
      DROP TABLE provider_secrets_legacy;
    `);
  }

  private readPersistedProviderKey(id: string): string {
    const row = this.db.prepare("SELECT api_key FROM provider_secrets WHERE provider_id = ?").get(id) as { api_key?: string } | undefined;
    return typeof row?.api_key === "string" ? row.api_key.trim() : "";
  }

  private persistProviderKey(id: string, secret: string): void {
    this.db.prepare("INSERT INTO provider_secrets (provider_id, api_key, updated_at) VALUES (?, ?, ?) ON CONFLICT(provider_id) DO UPDATE SET api_key = excluded.api_key, updated_at = excluded.updated_at").run(id, secret, Date.now());
  }

  private deletePersistedProviderKey(id: string): void {
    this.db.prepare("DELETE FROM provider_secrets WHERE provider_id = ?").run(id);
  }

  private migrateRelayGroupsFromPayloads(): void {
    const existing = this.db.prepare("SELECT COUNT(*) AS count FROM relay_groups").get() as { count: number } | undefined;
    if ((existing?.count ?? 0) > 0) {
      return;
    }
    const rows = this.db.prepare("SELECT payload FROM providers ORDER BY created_at ASC, id ASC").all() as Array<{ payload: string }>;
    const providers = rows.map((row) => parseProvider(row.payload)).filter((provider): provider is ProviderConfig => Boolean(provider));
    if (!providers.some((provider) => (provider.groups?.length ?? 0) > 0)) {
      return;
    }
    const insertGroup = this.db.prepare(`
      INSERT OR REPLACE INTO relay_groups (
        provider_id, group_id, name, base_url, kind, status, group_ratio, quota_usd, used_quota_usd,
        priority, weight, key_mode, response_protocol, response_protocol_mode, endpoint_path_override,
        auth_type, credential_mode, catalog_group_name, catalog_managed,
        keys_json, models_json, model_capabilities_json, supported_endpoint_types_json, image_json, model_mapping_json, status_code_mapping_json,
        advanced_model_mapping_json,
        tag, remark, auto_ban, request_limit, request_interval_seconds, context_window,
        enable_fallback, fallback_channel_id, fallback_group_name, enable_tiered_context, tiered_context_ratios_json,
        sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN");
    try {
      for (const provider of providers) {
        this.insertRelayGroups(insertGroup, provider);
        this.insertCapabilityCatalog(provider);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private readRelayGroups(): Map<string, ChannelGroupConfig[]> {
    const rows = this.db
      .prepare("SELECT * FROM relay_groups ORDER BY provider_id ASC, sort_order ASC, priority ASC, group_id ASC")
      .all() as RelayGroupRow[];
    const groupsByProvider = new Map<string, ChannelGroupConfig[]>();
    for (const row of rows) {
      const group = groupFromRow(row);
      if (!group) {
        continue;
      }
      const groups = groupsByProvider.get(row.provider_id) ?? [];
      groups.push(group);
      groupsByProvider.set(row.provider_id, groups);
    }
    return groupsByProvider;
  }

  private insertRelayGroups(insertGroup: ReturnType<RuntimeDatabase["prepare"]>, provider: ProviderConfig): void {
    const now = provider.updatedAt ?? Date.now();
    for (const [index, group] of (provider.groups ?? []).entries()) {
      insertGroup.run(
        provider.id,
        group.id,
        group.name,
        group.baseUrl ?? null,
        group.kind ?? "text",
        group.status ?? null,
        group.groupRatio ?? 1,
        group.quotaUsd ?? null,
        group.usedQuotaUsd ?? null,
        group.priority ?? null,
        group.weight ?? null,
        group.keyMode ?? null,
        group.responseProtocol ?? null,
        group.responseProtocolMode ?? null,
        group.endpointPathOverride ?? null,
        group.authType ?? null,
        group.credentialMode ?? null,
        group.catalogGroupName ?? null,
        booleanToSql(group.catalogManaged),
        JSON.stringify(group.keys ?? []),
        JSON.stringify(group.models ?? []),
        JSON.stringify(group.modelCapabilities ?? {}),
        JSON.stringify(group.supportedEndpointTypes ?? []),
        group.image ? JSON.stringify(group.image) : null,
        JSON.stringify(group.modelMapping ?? []),
        JSON.stringify(group.statusCodeMapping ?? []),
        JSON.stringify(group.advancedModelMapping ?? []),
        group.tag ?? null,
        group.remark ?? null,
        booleanToSql(group.autoBan),
        group.requestLimit ?? null,
        group.requestIntervalSeconds ?? null,
        group.contextWindow && group.contextWindow > 0 ? Math.round(group.contextWindow) : null,
        booleanToSql(group.enableFallback),
        group.fallbackChannelId ?? null,
        group.fallbackGroupName ?? null,
        booleanToSql(group.enableTieredContext),
        JSON.stringify(group.tieredContextRatios ?? []),
        index,
        provider.createdAt ?? now,
        now
      );
      this.persistCommandBlacklistFields(provider.id, group);
      this.persistClaudeCodeHeaderFields(provider.id, group);
    }
  }

  private persistClaudeCodeHeaderFields(providerId: string, group: ChannelGroupConfig): void {
    this.db.prepare(`
      UPDATE relay_groups
      SET claude_code_headers_enabled = ?, claude_code_version = ?
      WHERE provider_id = ? AND group_id = ?
    `).run(
      group.claudeCodeHeadersEnabled === true ? 1 : 0,
      group.claudeCodeVersion?.trim() || null,
      providerId,
      group.id
    );
  }

  private persistCommandBlacklistFields(providerId: string, group: ChannelGroupConfig): void {
    this.db.prepare(`
      UPDATE relay_groups
      SET command_blacklist_enabled = ?, command_blacklist_json = ?, network_allowlist_json = ?
      WHERE provider_id = ? AND group_id = ?
    `).run(
      group.commandBlacklistEnabled === false ? 0 : 1,
      JSON.stringify(group.commandBlacklist ?? []),
      JSON.stringify(group.networkAllowlist ?? []),
      providerId,
      group.id
    );
  }

  private clearCapabilityCatalogTables(): void {
    for (const table of [
      "relay_model_enable_groups",
      "relay_model_supported_endpoint_types",
      "relay_auto_groups",
      "relay_supported_endpoints",
      "relay_vendors",
      "relay_catalog_groups",
      "relay_catalog_models",
      "relay_catalogs"
    ]) {
      this.db.prepare(`DELETE FROM ${table}`).run();
    }
  }

  private insertCapabilityCatalog(provider: ProviderConfig): void {
    const catalog = provider.capabilityCatalog;
    if (!catalog) return;
    this.db.prepare(`
      INSERT INTO relay_catalogs (provider_id, success, imported_at, source_hash, warnings_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(provider.id, catalog.success ? 1 : 0, catalog.imported_at, catalog.source_hash, JSON.stringify(catalog.warnings));

    const insertGroup = this.db.prepare(`
      INSERT INTO relay_catalog_groups (
        provider_id, group_name, usable_group, group_ratio, response_protocol, response_protocol_mode
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const catalogGroups = new Map(deriveCatalogGroups(catalog).map((group) => [group.catalogGroupName ?? group.name, group]));
    const runtimeGroups = new Map((provider.groups ?? []).map((group) => [group.catalogGroupName ?? group.name, group]));
    const groupNames = uniqueStrings([
      ...Object.keys(catalog.usable_group),
      ...Object.keys(catalog.group_ratio),
      ...catalog.auto_groups,
      ...catalog.data.flatMap((model) => model.enable_groups)
    ]);
    for (const groupName of groupNames) {
      const group = runtimeGroups.get(groupName) ?? catalogGroups.get(groupName);
      insertGroup.run(
        provider.id,
        groupName,
        catalog.usable_group[groupName] ?? groupName,
        catalog.group_ratio[groupName] ?? 1,
        group?.responseProtocol ?? null,
        group?.responseProtocolMode ?? null
      );
    }

    const insertModel = this.db.prepare(`
      INSERT INTO relay_catalog_models (
        provider_id, model_name, icon, vendor_id, quota_type, model_ratio, model_price,
        completion_ratio, cache_ratio, create_cache_ratio, owner_by, extensions_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertModelGroup = this.db.prepare(`
      INSERT INTO relay_model_enable_groups (provider_id, model_name, group_name) VALUES (?, ?, ?)
    `);
    const insertModelEndpoint = this.db.prepare(`
      INSERT INTO relay_model_supported_endpoint_types (provider_id, model_name, endpoint_type) VALUES (?, ?, ?)
    `);
    for (const model of catalog.data) {
      insertModel.run(
        provider.id,
        model.model_name,
        model.icon ?? null,
        model.vendor_id ?? null,
        model.quota_type,
        model.model_ratio ?? null,
        model.model_price ?? null,
        model.completion_ratio ?? null,
        model.cache_ratio ?? null,
        model.create_cache_ratio ?? null,
        model.owner_by ?? null,
        JSON.stringify(model.extensions ?? {})
      );
      for (const groupName of model.enable_groups) {
        insertModelGroup.run(provider.id, model.model_name, groupName);
      }
      for (const endpointType of model.supported_endpoint_types) {
        insertModelEndpoint.run(provider.id, model.model_name, endpointType);
      }
    }

    const insertEndpoint = this.db.prepare(`
      INSERT INTO relay_supported_endpoints (
        provider_id, endpoint_type, path, method, canonical_endpoint_type, aliases_json, extensions_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [endpointType, endpoint] of Object.entries(catalog.supported_endpoint)) {
      insertEndpoint.run(
        provider.id,
        endpointType,
        endpoint.path,
        endpoint.method,
        endpointType,
        JSON.stringify(endpoint.aliases ?? []),
        JSON.stringify(endpoint.extensions ?? {})
      );
    }

    const insertVendor = this.db.prepare(`
      INSERT INTO relay_vendors (provider_id, vendor_id, name, icon, extensions_json) VALUES (?, ?, ?, ?, ?)
    `);
    for (const vendor of catalog.vendors) {
      insertVendor.run(provider.id, vendor.id, vendor.name, vendor.icon ?? null, JSON.stringify(vendor.extensions ?? {}));
    }

    const insertAutoGroup = this.db.prepare(`
      INSERT INTO relay_auto_groups (provider_id, group_name) VALUES (?, ?)
    `);
    for (const groupName of catalog.auto_groups) {
      insertAutoGroup.run(provider.id, groupName);
    }
  }

  private async migrateLegacyProviders(): Promise<void> {
    const existing = this.db.prepare("SELECT COUNT(*) AS count FROM providers").get() as { count: number } | undefined;
    if ((existing?.count ?? 0) > 0) {
      return;
    }
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as StoreShape;
      const providers = Array.isArray(parsed.providers)
        ? parsed.providers.map((provider) => normalizeProvider(provider)).filter((provider): provider is ProviderConfig => Boolean(provider))
        : [];
      if (providers.length > 0) {
        await this.write({ providers });
      }
    } catch {
      // Fresh installs have no legacy provider file.
    }
  }
}

function validateRelayGroupKeys(provider: ProviderConfig, providerSecretSupplied = false): void {
  if ((provider.groups?.length ?? 0) === 0) {
    throw new Error("Every relay provider requires at least one configured group");
  }
  if (provider.kind === "chatgpt" || provider.id === "omniroute-free" || provider.stationType === "charity") {
    return;
  }
  const hasProviderCredential = providerSecretSupplied || Boolean(provider.apiKeyRef?.trim());
  const missing = (provider.groups ?? []).filter((group) =>
    group.authType !== "none"
    && group.id !== "cline-free"
    && group.id !== "freebuff"
    && !(group.keys ?? []).some((key) => key.trim())
    && !(group.credentialMode === "provider" && hasProviderCredential)
  );
  if (missing.length > 0) {
    throw new Error(`Every configured relay group requires at least one API key: ${missing.map((group) => group.name).join(", ")}`);
  }
}

function parseProvider(payload: string): ProviderConfig | null {
  try {
    return normalizeProvider(JSON.parse(payload));
  } catch {
    return null;
  }
}

function isProviderLike(value: unknown): boolean {
  const record = asRecord(value);
  return typeof record.id === "string" && typeof record.name === "string" && typeof record.kind === "string";
}

function normalizeProvider(value: unknown): ProviderConfig | null {
  if (!isProviderLike(value)) {
    return null;
  }
  const record = asRecord(value);
  const now = Date.now();
  return normalizeProviderTopology({
    id: stringValue(record.id) ?? randomUUID(),
    kind: providerKindValue(record.kind),
    name: stringValue(record.name) ?? "Provider",
    serviceProvider: serviceProviderValue(record.serviceProvider),
    baseUrl: stringValue(record.baseUrl),
    apiKeyRef: envKeyRefValue(record.apiKeyRef),
    apiKeyPreview: stringValue(record.apiKeyPreview),
    apiKeyStorage: apiKeyStorageValue(record.apiKeyStorage),
    defaultModel: stringValue(record.defaultModel),
    streamMaxRetries: retryCountValue(record.streamMaxRetries),
    image: imageProviderConfig(record.image),
    nativeModels: stringArray(record.nativeModels),
    modelAliases: aliasArray(record.modelAliases),
    modelDisplayNames: stringRecord(record.modelDisplayNames),
    modelRates: modelRateArray(record.modelRates),
    capabilityCatalog: capabilityCatalogValue(record.capabilityCatalog),
    capabilityCatalogUrl: stringValue(record.capabilityCatalogUrl),
    channelMode: channelModeValue(record.channelMode),
    groups: groupArray(record.groups),
    quotaUsd: nullableNumberValue(record.quotaUsd),
    usedQuotaUsd: numberValue(record.usedQuotaUsd),
    stationType: stationTypeValue(record.stationType),
    enableCheckin: booleanValue(record.enableCheckin),
    remindCheckin: booleanValue(record.remindCheckin),
    remark: stringValue(record.remark),
    sharedImport: sharedImportValue(record.sharedImport),
    trashedAt: numberValue(record.trashedAt),
    createdAt: numberValue(record.createdAt) ?? now,
    updatedAt: numberValue(record.updatedAt) ?? now
  });
}

function normalizeProviderTopology(provider: ProviderConfig): ProviderConfig {
  if (provider.id === "omniroute-free") {
    return {
      ...provider,
      name: "CodexUltraFree",
      serviceProvider: { id: "codex-ultra-free", name: "CodexUltraFree" },
      groups: (provider.groups ?? []).map((group) => {
        const isCline = group.id === "cline-free";
        const isFreebuff = group.id === "freebuff";
        const isD2Api = group.id === "d2api";
        const defaultName = group.id === "opencode-free"
          ? "CodexUltraFree"
          : (group.id === "opencode"
            ? (group.name || "OpenCode")
            : (group.id === "kilocode"
              ? (group.name || "KiloCode")
              : (isCline
                ? (group.name || "ClineFree")
                : (isFreebuff
                  ? (group.name || "Freebuff")
                  : (isD2Api
                    ? (group.name || "D2API")
                    : group.name)))));
        return {
          ...group,
          name: defaultName,
          responseProtocol: (group.id === "opencode-free" || group.id === "opencode" || isCline || isFreebuff || isD2Api)
            ? "openai"
            : "openai-response",
          responseProtocolMode: "fixed"
        };
      })
    };
  }
  if (isDeepKeyProvider(provider)) {
    return {
      ...provider,
      serviceProvider: { id: "deepkey", name: "DeepKey", logo: provider.serviceProvider?.logo }
    };
  }
  return provider;
}

function sharedImportValue(value: unknown): ProviderConfig["sharedImport"] {
  const record = asRecord(value);
  return record.source === "codex-ultra-share"
    ? { source: "codex-ultra-share", importedAt: numberValue(record.importedAt) ?? Date.now() }
    : undefined;
}

function isDeepKeyProvider(provider: ProviderConfig): boolean {
  if (provider.serviceProvider?.id.trim().toLowerCase() === "deepkey") return true;
  for (const value of [provider.baseUrl, provider.capabilityCatalogUrl, ...(provider.groups ?? []).map((group) => group.baseUrl)]) {
    if (!value) continue;
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (host === "deepkey.top" || host.endsWith(".deepkey.top")) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function mergeProviderGroups(existing: ProviderConfig, incoming: ProviderConfig, now: number): ProviderConfig {
  const usedNames = new Set((existing.groups ?? []).map((group) => group.name.trim().toLowerCase()));
  const usedIds = new Set((existing.groups ?? []).map((group) => group.id.trim().toLowerCase()));
  const incomingGroups = (incoming.groups ?? []).map((group) => {
    const name = uniqueGroupValue(group.name || "default", usedNames);
    const id = uniqueGroupValue(group.id || name, usedIds);
    return {
      ...group,
      id,
      name,
      baseUrl: group.baseUrl ?? (incoming.baseUrl && incoming.baseUrl !== existing.baseUrl ? incoming.baseUrl : undefined)
    };
  });
  return {
    ...existing,
    nativeModels: uniqueStrings([...existing.nativeModels, ...incoming.nativeModels]),
    modelAliases: [...existing.modelAliases, ...incoming.modelAliases.filter((alias) => !existing.modelAliases.some((entry) => entry.alias === alias.alias))],
    groups: [...(existing.groups ?? []), ...incomingGroups],
    defaultModel: existing.defaultModel ?? incoming.defaultModel,
    updatedAt: now
  };
}

function uniqueGroupValue(preferred: string, used: Set<string>): string {
  const base = preferred.trim() || "default";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function hasValidRelayGroups(provider: ProviderConfig): boolean {
  if ((provider.groups?.length ?? 0) === 0) return false;
  if (provider.kind === "chatgpt") return true;
  // Catalog-managed groups normally inherit one provider credential, so their
  // own keys arrays are intentionally empty. Requiring every group to contain
  // a key deleted otherwise valid providers on the next app start. Preserve a
  // provider whenever it has either a group credential or a provider-level
  // credential reference; request-time resolution remains responsible for
  // reporting a credential that is temporarily unavailable.
  return provider.groups!.some((group) => (group.keys ?? []).some((key) => key.trim()))
    || Boolean(provider.apiKeyRef?.trim());
}

function selectConsistentRelayGroups(
  payloadGroups: ChannelGroupConfig[],
  persistedGroups: ChannelGroupConfig[] | undefined
): ChannelGroupConfig[] | undefined {
  if (!persistedGroups || persistedGroups.length === 0) {
    return payloadGroups.length > 0 ? payloadGroups : persistedGroups;
  }
  if (payloadGroups.length === 0) {
    return persistedGroups;
  }
  if (relayGroupIdsMatch(payloadGroups, persistedGroups)) {
    return persistedGroups;
  }
  return payloadGroups.length >= persistedGroups.length ? payloadGroups : persistedGroups;
}

function relayGroupTopologyMatches(left: ChannelGroupConfig[], right: ChannelGroupConfig[]): boolean {
  if (!relayGroupIdsMatch(left, right)) return false;
  return relayGroupCompletenessScore(left) === relayGroupCompletenessScore(right);
}

function relayGroupIdsMatch(left: ChannelGroupConfig[], right: ChannelGroupConfig[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right.map((group) => group.id));
  return left.every((group) => rightIds.has(group.id));
}

function relayGroupCompletenessScore(groups: ChannelGroupConfig[]): number {
  return groups.reduce((score, group) => score
    + (group.keys ?? []).filter((key) => key.trim()).length * 4
    + (group.models ?? []).length * 2
    + (group.supportedEndpointTypes ?? []).length
    + (group.modelMapping ?? []).length
    + (group.status === "enabled" ? 1 : 0), 0);
}

function ensureDefaultRelayGroup(provider: ProviderConfig, apiKey = ""): ProviderConfig {
  const secret = apiKey.trim();
  if ((provider.groups?.length ?? 0) > 0) {
    if (!secret || provider.groups!.some((group) => (group.keys?.length ?? 0) > 0)) return provider;
    return {
      ...provider,
      groups: provider.groups!.map((group, index) => index === 0 ? { ...group, credentialMode: "group", keys: [secret] } : group)
    };
  }
  if (!secret) return provider;
  const models = uniqueStrings([provider.defaultModel ?? "", ...provider.nativeModels].filter(Boolean));
  return {
    ...provider,
    channelMode: provider.channelMode ?? "fast",
    groups: [{
      id: "default",
      name: "default",
      kind: "text",
      status: "enabled",
      groupRatio: 1,
      keyMode: "polling",
      models,
      responseProtocol: provider.kind === "openai" ? "openai" : "openai-response",
      responseProtocolMode: "fixed",
      authType: "inherit",
      credentialMode: "group",
      keys: secret ? [secret] : []
    }]
  };
}

const KEYRING_SERVICE = "codex-react-ui";

let SafeAsyncEntryClass: (new (service: string, user: string) => AsyncEntry) | null = null;
try {
  const keyringPkg = require("@napi-rs/keyring");
  SafeAsyncEntryClass = keyringPkg.AsyncEntry || null;
} catch {
  SafeAsyncEntryClass = null;
}

function keyringEntry(id: string): AsyncEntry | null {
  if (!SafeAsyncEntryClass) return null;
  try {
    return new SafeAsyncEntryClass(KEYRING_SERVICE, `provider:${id}`);
  } catch {
    return null;
  }
}

function providerIdFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || randomUUID();
}

function envKeyForProvider(id: string): string {
  return `CODEX_UI_PROVIDER_${id.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_API_KEY`;
}

function previewSecret(secret: string): string {
  if (secret.length <= 8) {
    return "********";
  }
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function profileProvider(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKeyPreview: undefined,
    apiKeyStorage: "none",
    groups: provider.groups?.map((group) => ({ ...group, keys: [] }))
  };
}

function normalizeProfileProvider(value: unknown, existing?: ProviderConfig): ProviderConfig {
  const record = asRecord(value);
  const now = Date.now();
  const name = stringValue(record.name) || "Imported provider";
  const id = stringValue(record.id) || providerIdFromName(name);
  const kind = providerKindValue(record.kind);
  const apiKeyRef = envKeyRefValue(record.apiKeyRef) ?? existing?.apiKeyRef;
  const preserveExistingKey = existing?.apiKeyRef && apiKeyRef === existing.apiKeyRef;
  const normalized = normalizeProvider({
    ...record,
    id,
    kind,
    name,
    apiKeyRef,
    apiKeyPreview: preserveExistingKey ? existing.apiKeyPreview : undefined,
    apiKeyStorage: preserveExistingKey ? existing.apiKeyStorage : "none",
    remark: stringValue(record.remark) ?? existing?.remark,
    createdAt: numberValue(record.createdAt) ?? existing?.createdAt ?? now,
    updatedAt: now
  });
  if (!normalized) {
    throw new Error("Invalid provider profile");
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableNumberValue(value: unknown): number | null | undefined {
  return value === null ? null : numberValue(value);
}

function retryCountValue(value: unknown): number | undefined {
  const count = numberValue(value);
  return count == null ? undefined : Math.min(100, Math.max(5, Math.round(count)));
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return typeof value === "number" && (value === 0 || value === 1) ? Boolean(value) : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter((entry): entry is string => Boolean(entry)) : [];
}

function serviceProviderValue(value: unknown): ProviderConfig["serviceProvider"] {
  const record = asRecord(value);
  const id = stringValue(record.id);
  const name = stringValue(record.name);
  if (!id || !name) return undefined;
  const rawLogo = stringValue(record.logo);
  const logo = rawLogo && rawLogo.length <= 700_000 && /^data:image\/(?:png|jpeg|webp);base64,/i.test(rawLogo)
    ? rawLogo
    : undefined;
  return { id, name, logo };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function stringArrayFromJson(value: string): string[] {
  try {
    return stringArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function groupArray(value: unknown): ProviderConfig["groups"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const groups = value
    .map((entry, index) => {
      const record = asRecord(entry);
      const id = stringValue(record.id) ?? `group-${index + 1}`;
      const name = stringValue(record.name) ?? "default";
      return {
        id,
        name,
        baseUrl: stringValue(record.baseUrl),
        kind: groupKindValue(record.kind),
        capabilities: groupCapabilities(record.capabilities, groupKindValue(record.kind), imageProviderConfig(record.image)),
        status: groupStatusValue(record.status),
        groupRatio: numberValue(record.groupRatio) ?? 1,
        quotaUsd: nullableNumberValue(record.quotaUsd),
        usedQuotaUsd: numberValue(record.usedQuotaUsd),
        priority: numberValue(record.priority),
        weight: numberValue(record.weight),
        keyMode: groupKeyModeValue(record.keyMode),
        models: stringArray(record.models),
        modelCapabilities: modelCapabilitiesFromValue(record.modelCapabilities),
        supportedEndpointTypes: stringArray(record.supportedEndpointTypes),
        responseProtocol: responseProtocolValue(record.responseProtocol),
        responseProtocolMode: responseProtocolModeValue(record.responseProtocolMode),
        claudeCodeHeadersEnabled: booleanValue(record.claudeCodeHeadersEnabled) === true,
        claudeCodeVersion: stringValue(record.claudeCodeVersion),
        endpointPathOverride: stringValue(record.endpointPathOverride),
        authType: authTypeValue(record.authType),
        credentialMode: credentialModeValue(record.credentialMode),
        catalogGroupName: stringValue(record.catalogGroupName),
        catalogManaged: booleanValue(record.catalogManaged),
        image: imageProviderConfig(record.image),
        modelMapping: modelMappingArray(record.modelMapping),
        statusCodeMapping: statusCodeMappingArray(record.statusCodeMapping),
        advancedModelMapping: advancedModelMappingArray(record.advancedModelMapping),
        tag: stringValue(record.tag),
        remark: stringValue(record.remark),
        autoBan: booleanValue(record.autoBan),
        requestLimit: numberValue(record.requestLimit),
        requestIntervalSeconds: numberValue(record.requestIntervalSeconds),
        contextWindow: numberValue(record.contextWindow),
        commandBlacklistEnabled: booleanValue(record.commandBlacklistEnabled) !== false,
        commandBlacklist: stringArray(record.commandBlacklist),
        networkAllowlist: stringArray(record.networkAllowlist),
        keys: stringArray(record.keys),
        enableFallback: booleanValue(record.enableFallback),
        fallbackChannelId: stringValue(record.fallbackChannelId),
        fallbackGroupName: stringValue(record.fallbackGroupName),
        enableTieredContext: booleanValue(record.enableTieredContext),
        tieredContextRatios: tieredContextRatioArray(record.tieredContextRatios)
      };
    })
    .filter((entry) => entry.id && entry.name);
  return groups.length > 0 ? groups : undefined;
}

function groupFromRow(row: RelayGroupRow): ChannelGroupConfig | null {
  const id = stringValue(row.group_id);
  const name = stringValue(row.name);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    baseUrl: stringValue(row.base_url),
    kind: groupKindValue(row.kind),
    status: groupStatusValue(row.status),
    groupRatio: numberValue(row.group_ratio) ?? 1,
    quotaUsd: nullableNumberValue(row.quota_usd),
    usedQuotaUsd: numberValue(row.used_quota_usd),
    priority: numberValue(row.priority),
    weight: numberValue(row.weight),
    keyMode: groupKeyModeValue(row.key_mode),
    models: stringArrayFromJson(row.models_json),
    modelCapabilities: modelCapabilitiesFromJson(row.model_capabilities_json ?? "{}"),
    supportedEndpointTypes: stringArrayFromJson(row.supported_endpoint_types_json ?? "[]"),
    responseProtocol: responseProtocolValue(row.response_protocol),
    responseProtocolMode: responseProtocolModeValue(row.response_protocol_mode),
    claudeCodeHeadersEnabled: row.claude_code_headers_enabled === 1,
    claudeCodeVersion: stringValue(row.claude_code_version),
    endpointPathOverride: stringValue(row.endpoint_path_override),
    authType: authTypeValue(row.auth_type),
    credentialMode: credentialModeValue(row.credential_mode),
    catalogGroupName: stringValue(row.catalog_group_name),
    catalogManaged: sqlBooleanValue(row.catalog_managed ?? null),
    image: imageProviderConfig(jsonFromString(row.image_json)),
    capabilities: groupCapabilities(undefined, groupKindValue(row.kind), imageProviderConfig(jsonFromString(row.image_json))),
    modelMapping: modelMappingArrayFromJson(row.model_mapping_json),
    statusCodeMapping: statusCodeMappingArrayFromJson(row.status_code_mapping_json),
    advancedModelMapping: advancedModelMappingArrayFromJson(row.advanced_model_mapping_json),
    tag: stringValue(row.tag),
    remark: stringValue(row.remark),
    autoBan: sqlBooleanValue(row.auto_ban),
    requestLimit: numberValue(row.request_limit),
    requestIntervalSeconds: numberValue(row.request_interval_seconds),
    contextWindow: numberValue(row.context_window),
    commandBlacklistEnabled: row.command_blacklist_enabled !== 0,
    commandBlacklist: stringArrayFromJson(row.command_blacklist_json ?? "[]"),
    networkAllowlist: stringArrayFromJson(row.network_allowlist_json ?? "[]"),
    keys: stringArrayFromJson(row.keys_json),
    enableFallback: sqlBooleanValue(row.enable_fallback),
    fallbackChannelId: stringValue(row.fallback_channel_id),
    fallbackGroupName: stringValue(row.fallback_group_name),
    enableTieredContext: sqlBooleanValue(row.enable_tiered_context),
    tieredContextRatios: tieredContextRatioArrayFromJson(row.tiered_context_ratios_json)
  };
}

function groupStatusValue(value: unknown): ChannelGroupConfig["status"] {
  return value === "disabled" ? "disabled" : value === "enabled" ? "enabled" : undefined;
}

function groupKeyModeValue(value: unknown): ChannelGroupConfig["keyMode"] {
  switch (value) {
    case "single":
    case "random":
    case "polling":
      return value;
    default:
      return undefined;
  }
}

function responseProtocolValue(value: unknown): ChannelGroupConfig["responseProtocol"] {
  switch (value) {
    case "openai-response":
    case "openai":
    case "anthropic":
    case "gemini":
      return value;
    default:
      return undefined;
  }
}

function responseProtocolModeValue(value: unknown): ChannelGroupConfig["responseProtocolMode"] {
  return value === "model_auto" ? "model_auto" : value === "fixed" ? "fixed" : undefined;
}

function authTypeValue(value: unknown): ChannelGroupConfig["authType"] {
  switch (value) {
    case "none":
    case "inherit":
    case "bearer":
    case "anthropic":
    case "google_api_key":
    case "google_query_key":
      return value;
    default:
      return undefined;
  }
}

function credentialModeValue(value: unknown): ChannelGroupConfig["credentialMode"] {
  return value === "provider" ? "provider" : value === "group" ? "group" : undefined;
}

function capabilityCatalogValue(value: unknown): RelayCapabilityCatalog | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    return parseRelayCapabilityCatalog(value);
  } catch {
    return undefined;
  }
}

function booleanToSql(value: boolean | undefined): number | null {
  return typeof value === "boolean" ? (value ? 1 : 0) : null;
}

function sqlBooleanValue(value: number | null): boolean | undefined {
  return value === 0 || value === 1 ? Boolean(value) : undefined;
}

function tieredContextRatioArray(value: unknown): Array<{ minTokens: number; maxTokens: number | null; ratio: number }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ratios = value
    .map((entry) => {
      const record = asRecord(entry);
      const minTokens = numberValue(record.minTokens);
      const maxTokens = nullableNumberValue(record.maxTokens);
      const ratio = numberValue(record.ratio);
      return minTokens != null && maxTokens !== undefined && ratio != null ? { minTokens, maxTokens, ratio } : null;
    })
    .filter((entry): entry is { minTokens: number; maxTokens: number | null; ratio: number } => Boolean(entry));
  return ratios.length > 0 ? ratios : undefined;
}

function tieredContextRatioArrayFromJson(value: string): Array<{ minTokens: number; maxTokens: number | null; ratio: number }> | undefined {
  try {
    return tieredContextRatioArray(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function modelMappingArray(value: unknown): ChannelGroupConfig["modelMapping"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value
    .map((entry) => {
      const record = asRecord(entry);
      const from = stringValue(record.from);
      const to = stringValue(record.to);
      return from && to ? { from, to } : null;
    })
    .filter((entry): entry is { from: string; to: string } => Boolean(entry));
  return entries.length > 0 ? entries : undefined;
}

function modelMappingArrayFromJson(value: string): ChannelGroupConfig["modelMapping"] {
  try {
    return modelMappingArray(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function advancedModelMappingArray(value: unknown): ChannelGroupConfig["advancedModelMapping"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value
    .map((entry) => {
      const record = asRecord(entry);
      const requestModel = stringValue(record.requestModel) ?? stringValue(record.from);
      const targetModel = stringValue(record.targetModel) ?? stringValue(record.to);
      const targetProviderId = stringValue(record.targetProviderId);
      const targetGroupId = stringValue(record.targetGroupId);
      if (!requestModel || !targetModel) return null;
      const rule: AdvancedModelMappingRule = { requestModel, targetModel };
      if (targetProviderId) rule.targetProviderId = targetProviderId;
      if (targetGroupId) rule.targetGroupId = targetGroupId;
      const label = stringValue(record.label);
      if (label) rule.label = label;
      // enabled defaults to true; only persist when explicitly disabled.
      if (record.enabled === false) rule.enabled = false;
      return rule;
    })
    .filter((entry): entry is AdvancedModelMappingRule => Boolean(entry));
  return entries.length > 0 ? entries : undefined;
}

function advancedModelMappingArrayFromJson(value: string | null | undefined): ChannelGroupConfig["advancedModelMapping"] {
  try {
    return advancedModelMappingArray(JSON.parse(value ?? "[]"));
  } catch {
    return undefined;
  }
}

function statusCodeMappingArray(value: unknown): ChannelGroupConfig["statusCodeMapping"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value
    .map((entry) => {
      const record = asRecord(entry);
      const from = numberValue(record.from);
      const to = numberValue(record.to);
      return from != null && to != null ? { from, to } : null;
    })
    .filter((entry): entry is { from: number; to: number } => Boolean(entry));
  return entries.length > 0 ? entries : undefined;
}

function statusCodeMappingArrayFromJson(value: string): ChannelGroupConfig["statusCodeMapping"] {
  try {
    return statusCodeMappingArray(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function aliasArray(value: unknown): ProviderConfig["modelAliases"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const record = asRecord(entry);
      const alias = stringValue(record.alias);
      const model = stringValue(record.model);
      return alias && model ? { alias, model } : null;
    })
    .filter((entry): entry is { alias: string; model: string } => Boolean(entry));
}

function modelRateArray(value: unknown): ProviderConfig["modelRates"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rates: NonNullable<ProviderConfig["modelRates"]> = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const model = stringValue(record.model);
    const inputUsdPerMillion = numberValue(record.inputUsdPerMillion);
    const cachedInputUsdPerMillion = numberValue(record.cachedInputUsdPerMillion);
    const cacheWriteUsdPerMillion = numberValue(record.cacheWriteUsdPerMillion);
    const outputUsdPerMillion = numberValue(record.outputUsdPerMillion);
    const multiplier = numberValue(record.multiplier) ?? 1;
    const inputMultiplier = numberValue(record.inputMultiplier) ?? multiplier;
    const cacheReadMultiplier = numberValue(record.cacheReadMultiplier) ?? multiplier;
    const cacheWriteMultiplier = numberValue(record.cacheWriteMultiplier) ?? multiplier;
    const outputMultiplier = numberValue(record.outputMultiplier) ?? multiplier;
    if (model) {
      rates.push({
        model,
        inputUsdPerMillion,
        cachedInputUsdPerMillion,
        cacheWriteUsdPerMillion,
        outputUsdPerMillion,
        multiplier,
        inputMultiplier,
        cacheReadMultiplier,
        cacheWriteMultiplier,
        outputMultiplier
      });
    }
  }
  return rates.length > 0 ? rates : undefined;
}

function imageProviderConfig(value: unknown): ProviderConfig["image"] {
  const record = asRecord(value);
  const generations = booleanValue(record.generations);
  const edits = booleanValue(record.edits);
  const defaultModel = stringValue(record.defaultModel);
  const protocols = imageProtocolArray(record.protocols);
  const defaultProtocol = imageProtocolValue(record.defaultProtocol);
  const modelPrices = imageModelPriceArray(record.modelPrices);
  const billing = imageBillingValue(record.billing);
  const availability = imageAvailabilityValue(record.availability);
  const notice = stringValue(record.notice);
  if (generations == null && edits == null && !defaultModel && protocols.length === 0 && !defaultProtocol && modelPrices.length === 0 && !billing && !availability && !notice) {
    return undefined;
  }
  return {
    generations,
    edits,
    defaultModel,
    protocols: protocols.length > 0 ? protocols : undefined,
    defaultProtocol: defaultProtocol && (protocols.length === 0 || protocols.includes(defaultProtocol)) ? defaultProtocol : undefined,
    modelPrices: modelPrices.length > 0 ? modelPrices : undefined,
    billing,
    availability,
    notice
  };
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  const entries = Object.entries(record).flatMap(([key, rawValue]) => {
    const normalizedKey = key.trim();
    const normalizedValue = stringValue(rawValue)?.trim();
    return normalizedKey && normalizedValue ? [[normalizedKey, normalizedValue] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function modelCapabilitiesFromJson(value: string): ChannelGroupConfig["modelCapabilities"] {
  try {
    return modelCapabilitiesFromValue(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function modelCapabilitiesFromValue(value: unknown): ChannelGroupConfig["modelCapabilities"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: NonNullable<ChannelGroupConfig["modelCapabilities"]> = {};
  for (const [model, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const efforts = Array.isArray(record.reasoningEfforts)
      ? record.reasoningEfforts.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    const contextWindow = typeof record.contextWindow === "number" && Number.isFinite(record.contextWindow) && record.contextWindow > 0
      ? Math.round(record.contextWindow)
      : undefined;
    const maxOutputTokens = typeof record.maxOutputTokens === "number" && Number.isFinite(record.maxOutputTokens) && record.maxOutputTokens > 0
      ? Math.round(record.maxOutputTokens)
      : undefined;
    if (efforts.length === 0 && !contextWindow && !maxOutputTokens) continue;
    result[model] = {
      ...(efforts.length > 0 ? { reasoningEfforts: efforts } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      source: record.source === "catalog" || record.source === "inferred" ? record.source : "upstream"
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function groupCapabilities(value: unknown, kind: ChannelGroupConfig["kind"], image: ProviderConfig["image"]): ChannelGroupConfig["capabilities"] {
  const record = asRecord(value);
  return {
    text: booleanValue(record.text) ?? kind !== "image",
    imageGeneration: booleanValue(record.imageGeneration) ?? image?.generations ?? (kind === "image" ? true : undefined),
    imageEdits: booleanValue(record.imageEdits) ?? image?.edits ?? (kind === "image" ? true : undefined)
  };
}

function imageBillingValue(value: unknown): NonNullable<ProviderConfig["image"]>["billing"] {
  const record = asRecord(value);
  const mode = stringValue(record.mode);
  if (mode === "per_image") {
    const usdPerImage = numberValue(record.usdPerImage);
    return usdPerImage != null && usdPerImage >= 0 ? { mode, usdPerImage, currency: "USD" } : undefined;
  }
  if (mode === "token_multiplier") {
    const multiplier = numberValue(record.multiplier);
    return multiplier != null && multiplier > 0 ? { mode, multiplier, currency: "USD" } : undefined;
  }
  return undefined;
}

function imageAvailabilityValue(value: unknown): NonNullable<ProviderConfig["image"]>["availability"] {
  return value === "available" || value === "constrained" || value === "unavailable" ? value : undefined;
}

function imageModelPriceArray(value: unknown): NonNullable<NonNullable<ProviderConfig["image"]>["modelPrices"]> {
  if (!Array.isArray(value)) {
    return [];
  }
  const prices: NonNullable<NonNullable<ProviderConfig["image"]>["modelPrices"]> = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const model = stringValue(record.model);
    const usdPerImage = numberValue(record.usdPerImage);
    if (model && usdPerImage != null && usdPerImage >= 0) {
      prices.push({ model, usdPerImage });
    }
  }
  return prices;
}

function imageProtocolArray(value: unknown): ImageGenerationProtocol[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const protocols: ImageGenerationProtocol[] = [];
  for (const entry of value) {
    const protocol = imageProtocolValue(entry);
    if (protocol && !protocols.includes(protocol)) {
      protocols.push(protocol);
    }
  }
  return protocols;
}

function imageProtocolValue(value: unknown): ImageGenerationProtocol | undefined {
  switch (value) {
    case "openaiImages":
    case "openaiImageEdits":
    case "geminiChatCompletions":
    case "geminiGenerateContent":
    case "deepkeyAsyncVideos":
      return value;
    default:
      return undefined;
  }
}

function jsonFromString(value: string | null | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function envKeyRefValue(value: unknown): string | undefined {
  const ref = stringValue(value);
  return ref?.startsWith("env:") ? ref : undefined;
}

function apiKeyStorageValue(value: unknown): ProviderConfig["apiKeyStorage"] {
  switch (value) {
    case "database":
    case "keyring":
    case "memory":
    case "none":
      return value;
    default:
      return undefined;
  }
}

function channelModeValue(value: unknown): ProviderConfig["channelMode"] {
  switch (value) {
    case "fast":
    case "advanced":
      return value;
    default:
      return undefined;
  }
}

function groupKindValue(value: unknown): ChannelGroupConfig["kind"] {
  return value === "image" ? "image" : "text";
}

function stationTypeValue(value: unknown): ProviderConfig["stationType"] {
  switch (value) {
    case "third_party":
    case "rich":
    case "charity":
    case "official":
      return value;
    default:
      return undefined;
  }
}

function providerKindValue(value: unknown): ProviderConfig["kind"] {
  switch (value) {
    case "chatgpt":
    case "openai":
    case "responsesRelay":
    case "ollama":
    case "lmstudio":
    case "bedrock":
      return value;
    default:
      return "responsesRelay";
  }
}
