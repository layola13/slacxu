/**
 * @cxu/sdk-backend — the server-side plugin contract.
 *
 * An independent project (own repo, own version). This SDK is the ONLY
 * contract between a plugin's server side and the server host: plugins
 * never import host internals, the host never imports plugin internals.
 * The frontend has its own separate SDK (@cxu/sdk-frontend); the
 * two agree only on the `plugin.json` manifest file format below.
 *
 * A backend id is an opaque string to the host. An id the registry does
 * not know is simply "not installed" — never a reason to fall back to
 * another backend.
 */

export const WELL_KNOWN_PLUGIN_IDS = [
  "mini",
  "codex",
  "claude",
  "agy",
  "grok",
  "pi",
  "opencode",
  "opencode-v2",
  "muse",
] as const;

export type WellKnownPluginId = (typeof WELL_KNOWN_PLUGIN_IDS)[number];

/** Coarse feature flags a plugin declares; the web SDK mirrors them. */
export interface PluginCapabilities {
  history: boolean;
  compaction: boolean;
  slashCommandForwarding: boolean;
  skills: boolean;
  mcp: boolean;
  fileParts: boolean;
  permissionRoundTrips: boolean;
}

export const NO_CAPABILITIES: PluginCapabilities = {
  history: false,
  compaction: false,
  slashCommandForwarding: false,
  skills: false,
  mcp: false,
  fileParts: false,
  permissionRoundTrips: false,
};

/** The `plugin.json` manifest schema (shared file format of both SDKs). */
export interface PluginManifest {
  /** Plugin id, e.g. "opencode-v2" or "web-shell". Opaque to the hosts. */
  id: string;
  /** Plugin kind: "backend" | "service" | "framework" | "feature". */
  kind: string;
  /** Plugin version (semver), independent of every other project. */
  version: string;
  displayName: string;
  /** Which entry points this plugin ships. Either side may be absent. */
  sides: { server: boolean; web: boolean };
  /** Only "mini" is true: installed and enabled on a fresh install. */
  defaultInstalled: boolean;
  capabilities: PluginCapabilities;
  /** Optional web presentation hints (single source: plugin.json). */
  presentation?: { label: string; icon: string; labelKey?: string };
}

export type { CliDiscoverySpec, EngineHandle, EngineStatus, PluginInstallation, RpcContext, ServerHost, ServerPlugin } from "./server.js";
export type { RelayConfigPlugin, RelayStation, ServiceHost, ServicePlugin } from "./service.js";

import type { ServerPlugin } from "./server.js";

/**
 * Registry of INSTALLED server plugins. Available-but-not-installed
 * plugins are not in here: they get no engine and no history scope.
 * A fresh install registers exactly the defaultInstalled plugins.
 */
export class ServerPluginRegistry {
  readonly #plugins = new Map<string, ServerPlugin>();

  register(plugin: ServerPlugin): void {
    const { id } = plugin.manifest;
    if (this.#plugins.has(id)) throw new Error(`server plugin "${id}" is already registered`);
    this.#plugins.set(id, plugin);
  }

  unregister(id: string): boolean {
    return this.#plugins.delete(id);
  }

  /** The installed plugin for an id, or undefined — never a substitute. */
  get(id: string): ServerPlugin | undefined {
    return this.#plugins.get(id);
  }

  has(id: string): boolean {
    return this.#plugins.has(id);
  }

  ids(): string[] {
    return [...this.#plugins.keys()];
  }

  /** All registered plugins, in registration order. */
  list(): ServerPlugin[] {
    return [...this.#plugins.values()];
  }

  defaultPlugin(): ServerPlugin | undefined {
    for (const plugin of this.#plugins.values()) {
      if (plugin.manifest.defaultInstalled) return plugin;
    }
    return undefined;
  }
}
export * from "./runtimeClient.js";
export { pageThreadHistory } from "./threadHistoryPaging.js";
export {
  setPluginHostServices,
  tryPluginHostServices,
  pluginHostServices,
  type CliSelectionKind,
  type PluginHostServices,
} from "./hostServices.js";
export type { NotePriorityLevel, SaVmActionType, SaVmFsCapability, SaVmNetCapability, SaVmRunInput, SaVmRunResult } from "./saVmTypes.js";
export { SaVmCapabilityDeniedError, SaVmInputError } from "./saVmTypes.js";
export { isSystemWebSearchPermissionRequest } from "./systemWebSearch.js";
export { loadRegressionCases, resolveRegressionCasesDir, type RegressionCase, type RegressionCaseFilter } from "./regressionCases.js";
export { codexUiDataDir } from "./dataDir.js";
export {
  ClaudeSkillInventory,
  expandClaudeSkillInput,
  skillGroupsJson,
  type ClaudeSkillEntry,
  type ClaudeSkillGroup,
} from "./claudeSkillInventory.js";
export {
  VirtualCodexConfigStore,
  VirtualConfigCodexRuntimeClient,
  prepareVirtualCodexConfig,
  resolveCodexUserConfigPath,
  resolveVirtualCodexConfigPath,
  syncModelProvidersToUserConfig,
} from "./codexVirtualConfig.js";
export {
  OPENCODE_BACKEND_USER_AGENTS,
  OPENCODE_CLI_BACKEND_HEADER,
  clearOpenCodeSession,
  deriveOpenCodeSessionId,
  generateOpenCodeUlid,
  getOpenCodeProjectId,
  getOpenCodeSessionId,
  openCodeThreadHeaders,
  rotateOpenCodeSession,
  type OpenCodeBackendKind,
} from "./openCodeSessionProtocol.js";
export { getSaVmGlobalDataDir, getSaVmProjectDataDir, resolveSaVmMcpScriptPath, resolveSaVmMcpSourceCandidates, SA_VM_MCP_SCRIPT_NAME } from "./saVmPaths.js";
export { isBunRuntime, isNodeRuntime } from "./runtimeDetect.js";
export { openNodeRuntimeDatabase, openRuntimeDatabase, type RuntimeDatabase } from "./runtimeDatabase.js";
export * from "./saVmWorkspaceSkill.js";
export * from "./imagePersistence.js";
export { STORM_STALLED_AFTER_ATTEMPTS, STORM_STALLED_AFTER_MS } from "./streamRetryThresholds.js";
export * from "./goalContinuation.js";
export * from "./codexFallbackInstructions.js";
export { normalizeMemoryScope, resolveGlobalMemoryFilePath, resolveWorkspaceMemoryFilePath, type MemoryScope } from "./memoryFilePaths.js";
export type { RemoteThreadRoute } from "./remoteThreadRoute.js";
export { CODEX_ULTRA_MODEL_CATALOG_FILE } from "./modelCatalog.js";
export { resolveCliSpawn, resolveWindowsComSpec, resolveWindowsPowerShell, spawnCli, spawnCliSync } from "./cliSpawn.js";
export { createBridgeEventLogger, type BridgeEventLogger } from "./bridgeEventLog.js";
