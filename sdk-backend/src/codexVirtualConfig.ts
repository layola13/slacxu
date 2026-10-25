import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type JsonRpcFailure, type JsonRpcId, type JsonValue } from "@codex-ui/shared";
import { parse, stringify, TomlDate, type TomlTable, type TomlValue } from "smol-toml";
import { type CodexRuntimeClient } from "./runtimeClient.js";
import { codexUiDataDir } from "./dataDir.js";

type ConfigEdit = {
  keyPath: string;
  value: JsonValue;
  mergeStrategy: "replace" | "upsert";
};

const THREAD_CONFIG_METHODS = new Set(["thread/start", "thread/resume", "thread/fork"]);
const VIRTUAL_CONFIG_RELATIVE_PATH = join("virtual-codex", "config.toml");
const CONFIG_LOCK_TIMEOUT_MS = 5_000;
const CONFIG_LOCK_STALE_MS = 30_000;
const AGENT_INHERITANCE_MIGRATION_MARKER = ".agent-inheritance-v1";
const THREAD_SCOPED_CONFIG_KEYS = new Set(["model_context_window"]);
const SAFE_MULTI_AGENT_MIGRATION_PATHS = [
  ["features", "multi_agent_v2"],
  ["agents", "enabled"],
  ["agents", "max_concurrent_threads_per_session"]
] as const;
const LEGACY_AGENT_DEFAULT_PATHS = [
  ["agents", "default_subagent_model"],
  ["agents", "default_subagent_reasoning_effort"]
] as const;

export function resolveVirtualCodexConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string {
  return join(codexUiDataDir(env, home), VIRTUAL_CONFIG_RELATIVE_PATH);
}

export function resolveCodexUserConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string {
  const configuredHome = env.CODEX_HOME?.trim();
  return join(configuredHome ? resolve(configuredHome) : join(home, ".codex"), "config.toml");
}

export class VirtualCodexConfigStore {
  private writeQueue: Promise<unknown> = Promise.resolve();
  private multiAgentMigration: Promise<void> | null = null;

  public constructor(
    public readonly path = resolveVirtualCodexConfigPath(),
    private readonly migrationSourcePath = resolveCodexUserConfigPath()
  ) {}

  public async read(params: Record<string, unknown> = {}): Promise<JsonValue> {
    await this.ensureMultiAgentConfigMigrated();
    const { table, version } = await this.load();
    const config = tomlToJson(table) as Record<string, JsonValue>;
    const layerName = { type: "user", file: this.path, profile: null } as const;
    const origins = Object.fromEntries(
      Object.keys(flattenConfig(config)).map((key) => [key, { name: layerName, version }])
    );

    return {
      config,
      origins,
      layers: params.includeLayers === true
        ? [{ name: layerName, version, config, disabledReason: null }]
        : null
    };
  }

  public async prepare(): Promise<void> {
    await this.ensureMultiAgentConfigMigrated();
  }

  public async writeValue(params: unknown): Promise<JsonValue> {
    await this.ensureMultiAgentConfigMigrated();
    const record = asRecord(params);
    return this.enqueueWrite([configEdit(record)], stringOrNull(record.expectedVersion));
  }

  public async batchWrite(params: unknown): Promise<JsonValue> {
    await this.ensureMultiAgentConfigMigrated();
    const record = asRecord(params);
    if (!Array.isArray(record.edits)) {
      throw new Error("config/batchWrite requires an edits array");
    }
    const edits = record.edits.map((edit) => configEdit(asRecord(edit)));
    return this.enqueueWrite(edits, stringOrNull(record.expectedVersion));
  }

  public async injectThreadConfig(method: string, params?: JsonValue): Promise<JsonValue | undefined> {
    if (!THREAD_CONFIG_METHODS.has(method)) {
      return params;
    }
    await this.ensureMultiAgentConfigMigrated();
    const { table } = await this.load();
    const virtualConfig = flattenConfig(tomlToJson(table) as Record<string, JsonValue>);
    for (const key of THREAD_SCOPED_CONFIG_KEYS) {
      delete virtualConfig[key];
    }
    const request = asRecord(params);
    const requestConfig = { ...asRecord(request.config) };
    const requestedContextWindow = requestConfig.model_context_window;
    if (
      typeof requestedContextWindow !== "number"
      || !Number.isFinite(requestedContextWindow)
      || requestedContextWindow <= 0
    ) {
      delete requestConfig.model_context_window;
    } else {
      requestConfig.model_context_window = Math.round(requestedContextWindow);
    }
    const requestedModelProvider = typeof request.modelProvider === "string" ? request.modelProvider.trim() : "";
    if (requestedModelProvider) {
      requestConfig.model_provider = requestedModelProvider;
    }
    const requestedModel = typeof request.model === "string" ? request.model.trim() : "";
    if (requestedModel) {
      requestConfig.model = requestedModel;
    }
    return {
      ...request,
      config: {
        ...virtualConfig,
        ...requestConfig
      }
    } as JsonValue;
  }

  private enqueueWrite(edits: ConfigEdit[], expectedVersion: string | null): Promise<JsonValue> {
    const operation = this.writeQueue.then(() => this.persist(edits, expectedVersion));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  private ensureMultiAgentConfigMigrated(): Promise<void> {
    if (!this.multiAgentMigration) {
      this.multiAgentMigration = this.migrateMultiAgentConfig();
    }
    return this.multiAgentMigration;
  }

  private async migrateMultiAgentConfig(): Promise<void> {
    let source: TomlTable | null = null;
    try {
      source = parse(await readFile(this.migrationSourcePath, "utf8"));
    } catch {
      // The virtual config still needs legacy global fields removed even when
      // there is no real Codex config to migrate from.
      try {
        await stat(this.path);
      } catch (error) {
        if (isMissingFile(error)) return;
        throw error;
      }
    }

    await withConfigLock(this.path, async () => {
      const { table, threadScopedRemoved } = await this.load();
      let changed = Boolean(threadScopedRemoved);
      const inheritanceMarker = join(dirname(this.path), AGENT_INHERITANCE_MIGRATION_MARKER);
      let inheritanceMigrated = false;
      try {
        await stat(inheritanceMarker);
        inheritanceMigrated = true;
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
      if (source) {
        for (const segments of SAFE_MULTI_AGENT_MIGRATION_PATHS) {
          if (valueAtPath(table, segments) !== undefined) continue;
          const sourceValue = valueAtPath(source, segments);
          if (sourceValue === undefined) continue;
          setAtPath(table, segments, cloneTomlValue(sourceValue));
          changed = true;
        }
        if (!inheritanceMigrated) {
          for (const segments of LEGACY_AGENT_DEFAULT_PATHS) {
            const virtualValue = valueAtPath(table, segments);
            const sourceValue = valueAtPath(source, segments);
            if (virtualValue === undefined || virtualValue !== sourceValue) continue;
            deleteAtPath(table, segments);
            changed = true;
          }
        }
      }
      if (changed) {
        await atomicWrite(this.path, stringify(table));
      }
      if (!inheritanceMigrated) {
        await mkdir(dirname(inheritanceMarker), { recursive: true, mode: 0o700 });
        await writeFile(inheritanceMarker, "inherit parent model\n", { mode: 0o600 });
      }
    });
  }

  private async persist(edits: ConfigEdit[], expectedVersion: string | null): Promise<JsonValue> {
    return withConfigLock(this.path, async () => {
      const { table, version } = await this.load();
      if (expectedVersion && expectedVersion !== version) {
        throw new Error("Virtual Codex config version conflict");
      }
      for (const edit of edits.filter((entry) => !THREAD_SCOPED_CONFIG_KEYS.has(entry.keyPath))) {
        applyEdit(table, edit);
      }
      removeThreadScopedConfig(table);

      const content = stringify(table);
      const nextVersion = configVersion(content);
      await atomicWrite(this.path, content);
      return {
        status: "ok",
        version: nextVersion,
        filePath: this.path,
        overriddenMetadata: null
      };
    });
  }

  private async load(): Promise<{ table: TomlTable; version: string; threadScopedRemoved: boolean }> {
    let content = "";
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
    const table = parse(content);
    const threadScopedRemoved = removeThreadScopedConfig(table);
    return {
      table,
      version: configVersion(content),
      threadScopedRemoved
    };
  }
}

export async function syncModelProvidersToUserConfig(
  virtualPath = resolveVirtualCodexConfigPath(),
  userConfigPath = resolveCodexUserConfigPath(),
  activeSelection?: { modelProvider?: string; model?: string }
): Promise<void> {
  try {
    if (resolve(virtualPath) === resolve(userConfigPath)) return;
    let virtualRaw = "";
    try {
      virtualRaw = await readFile(virtualPath, "utf8");
    } catch {
      return;
    }
    const virtualTable = parse(virtualRaw);
    const virtualProviders = virtualTable.model_providers;
    if (!isTable(virtualProviders) || Object.keys(virtualProviders).length === 0) {
      return;
    }
    let userRaw = "";
    try {
      userRaw = await readFile(userConfigPath, "utf8");
    } catch {
      return;
    }
    const userTable = parse(userRaw);
    const userProviders = isTable(userTable.model_providers) ? { ...userTable.model_providers } : {};
    let changed = false;
    for (const [id, providerTable] of Object.entries(virtualProviders)) {
      const current = userProviders[id];
      if (JSON.stringify(current) !== JSON.stringify(providerTable)) {
        userProviders[id] = cloneTomlValue(providerTable);
        changed = true;
      }
    }
    if (activeSelection?.modelProvider) {
      if (userTable.model_provider !== activeSelection.modelProvider) {
        userTable.model_provider = activeSelection.modelProvider;
        changed = true;
      }
    } else if (typeof virtualTable.model_provider === "string" && virtualTable.model_provider.trim()) {
      if (userTable.model_provider !== virtualTable.model_provider) {
        userTable.model_provider = virtualTable.model_provider;
        changed = true;
      }
    }
    if (activeSelection?.model) {
      if (userTable.model !== activeSelection.model) {
        userTable.model = activeSelection.model;
        changed = true;
      }
    } else if (typeof virtualTable.model === "string" && virtualTable.model.trim()) {
      if (userTable.model !== virtualTable.model) {
        userTable.model = virtualTable.model;
        changed = true;
      }
    }
    if (changed) {
      userTable.model_providers = userProviders;
      if (!userTable.model_catalog_json && virtualTable.model_catalog_json) {
        userTable.model_catalog_json = cloneTomlValue(virtualTable.model_catalog_json);
      }
      await atomicWrite(userConfigPath, stringify(userTable));
      console.log(`[virtual-config] Synchronized ${Object.keys(virtualProviders).length} model_providers to ${userConfigPath}`);
    }
  } catch (error) {
    console.warn("[virtual-config] Failed to sync model_providers to user config", error);
  }
}

export async function prepareVirtualCodexConfig(): Promise<void> {
  await new VirtualCodexConfigStore().prepare();
  await syncModelProvidersToUserConfig();
}

function removeThreadScopedConfig(table: TomlTable): boolean {
  let changed = false;
  for (const keyPath of THREAD_SCOPED_CONFIG_KEYS) {
    const segments = parseKeyPath(keyPath);
    if (valueAtPath(table, segments) === undefined) continue;
    deleteAtPath(table, segments);
    changed = true;
  }
  return changed;
}

export class VirtualConfigCodexRuntimeClient extends EventEmitter implements CodexRuntimeClient {
  public constructor(
    private readonly inner: CodexRuntimeClient,
    private readonly configStore = new VirtualCodexConfigStore()
  ) {
    super();
    for (const event of ["status", "message", "stderr"] as const) {
      inner.on(event, (...args: unknown[]) => this.emit(event, ...args));
    }
  }

  public getStatus() {
    return this.inner.getStatus();
  }

  public start() {
    return this.inner.start();
  }

  public stop(): void {
    this.inner.stop();
  }

  public restart() {
    return this.inner.restart();
  }

  public async request(method: string, params?: JsonValue, timeoutMs?: number): Promise<JsonValue> {
    if (method === "config/read") {
      return this.configStore.read(asRecord(params));
    }
    if (method === "config/value/write") {
      return this.configStore.writeValue(params);
    }
    if (method === "config/batchWrite") {
      return this.configStore.batchWrite(params);
    }
    return this.inner.request(method, await this.configStore.injectThreadConfig(method, params), timeoutMs);
  }

  public notify(method: string, params?: JsonValue): Promise<void> {
    return this.inner.notify(method, params);
  }

  public respond(id: JsonRpcId, result?: JsonValue, error?: JsonRpcFailure["error"]): void {
    this.inner.respond(id, result, error);
  }
}

function configEdit(record: Record<string, any>): ConfigEdit {
  const keyPath = typeof record.keyPath === "string" ? record.keyPath.trim() : "";
  if (!keyPath) {
    throw new Error("Config edit requires keyPath");
  }
  return {
    keyPath,
    value: (record.value ?? null) as JsonValue,
    mergeStrategy: record.mergeStrategy === "upsert" ? "upsert" : "replace"
  };
}

function applyEdit(root: TomlTable, edit: ConfigEdit): void {
  const segments = parseKeyPath(edit.keyPath);
  if (edit.value === null) {
    deleteAtPath(root, segments);
    return;
  }

  let value = jsonToToml(edit.value);
  if (edit.mergeStrategy === "upsert") {
    const current = valueAtPath(root, segments);
    if (isTable(current) && isTable(value)) {
      value = mergeTables(current, value);
    }
  }
  setAtPath(root, segments, value);
}

function parseKeyPath(keyPath: string): string[] {
  const sentinel = `__codex_ultra_${randomUUID()}__`;
  const segments = findSentinelPath(parse(`${keyPath} = ${JSON.stringify(sentinel)}`), sentinel);
  if (!segments || segments.length === 0) {
    throw new Error(`Invalid config key path: ${keyPath}`);
  }
  return segments;
}

function findSentinelPath(value: TomlValue, sentinel: string, path: string[] = []): string[] | null {
  if (value === sentinel) {
    return path;
  }
  if (!isTable(value)) {
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    const found = findSentinelPath(child, sentinel, [...path, key]);
    if (found) {
      return found;
    }
  }
  return null;
}

function valueAtPath(root: TomlTable, segments: readonly string[]): TomlValue | undefined {
  let current: TomlValue = root;
  for (const segment of segments) {
    if (!isTable(current)) {
      return undefined;
    }
    const next: TomlValue | undefined = current[segment];
    if (next === undefined) {
      return undefined;
    }
    current = next;
  }
  return current;
}

function setAtPath(root: TomlTable, segments: readonly string[], value: TomlValue): void {
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (isTable(next)) {
      current = next;
      continue;
    }
    const table: TomlTable = {};
    current[segment] = table;
    current = table;
  }
  current[segments[segments.length - 1]!] = value;
}

function deleteAtPath(root: TomlTable, segments: readonly string[]): void {
  const parents: Array<{ table: TomlTable; key: string }> = [];
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!isTable(next)) {
      return;
    }
    parents.push({ table: current, key: segment });
    current = next;
  }
  delete current[segments[segments.length - 1]!];
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const parent = parents[index]!;
    const child = parent.table[parent.key];
    if (isTable(child) && Object.keys(child).length === 0) {
      delete parent.table[parent.key];
    } else {
      break;
    }
  }
}

function mergeTables(base: TomlTable, overlay: TomlTable): TomlTable {
  const merged: TomlTable = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = merged[key];
    merged[key] = isTable(current) && isTable(value)
      ? mergeTables(current, value)
      : value;
  }
  return merged;
}

function flattenConfig(config: Record<string, JsonValue>): Record<string, JsonValue> {
  const flattened: Record<string, JsonValue> = {};
  const visit = (value: JsonValue, segments: string[]): void => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, [...segments, key]);
      }
      return;
    }
    flattened[segments.map(encodeKeySegment).join(".")] = value;
  };
  for (const [key, value] of Object.entries(config)) {
    visit(value, [key]);
  }
  return flattened;
}

function encodeKeySegment(segment: string): string {
  return /^[A-Za-z0-9_-]+$/.test(segment) ? segment : JSON.stringify(segment);
}

function tomlToJson(value: TomlValue): JsonValue {
  if (value instanceof TomlDate) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(tomlToJson);
  }
  if (isTable(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, tomlToJson(child)]));
  }
  return value;
}

function jsonToToml(value: JsonValue): TomlValue {
  if (Array.isArray(value)) {
    return value.map(jsonToToml);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonToToml(child)]));
  }
  if (value === null) {
    throw new Error("TOML does not support null values");
  }
  return value;
}

function cloneTomlValue(value: TomlValue): TomlValue {
  return jsonToToml(tomlToJson(value));
}

function isTable(value: unknown): value is TomlTable {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function configVersion(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = join(directory, `.config.toml.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, path);
    await chmod(path, 0o600).catch(() => undefined);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function withConfigLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const directory = dirname(path);
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + CONFIG_LOCK_TIMEOUT_MS;
  await mkdir(directory, { recursive: true, mode: 0o700 });

  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${process.pid}\n${Date.now()}\n`, "utf8");
        return await operation();
      } finally {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      if (!isLockContention(error)) {
        throw error;
      }
      if (await isStaleLock(lockPath)) {
        await unlink(lockPath).catch(() => undefined);
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for virtual Codex config lock: ${lockPath}`);
      }
      await delay(10);
    }
  }
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs > CONFIG_LOCK_STALE_MS;
  } catch (error) {
    return isMissingFile(error);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isLockContention(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  return error.code === "EEXIST"
    || process.platform === "win32" && (error.code === "EPERM" || error.code === "EACCES");
}
