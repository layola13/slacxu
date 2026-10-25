/**
 * Installed backend server plugins, assembled from the independent
 * plugin projects under `plugins/`. This is the server host's single
 * registration point: per-backend knowledge (binary names, env override
 * chains, candidate qualification, skill roots, capabilities) lives in
 * the plugins and is read from here — never re-declared in the host.
 */
import { ServerPluginRegistry, type CliDiscoverySpec } from "@cxu/sdk-backend";
import "./pluginHostServices.js";
import type { CliSelectionKind } from "./cliSelectionState.js";
import { miniServerPlugin } from "../../../backends/mini/src/server.js";
import { codexServerPlugin } from "../../../backends/codex/src/server.js";
import { claudeServerPlugin } from "../../../backends/claude/src/server.js";
import { agyServerPlugin } from "../../../backends/agy/src/server.js";
import { auggieServerPlugin } from "../../../backends/auggie/src/server.js";
import { clineServerPlugin } from "../../../backends/cline/src/server.js";
import { commandCodeServerPlugin } from "../../../backends/command-code/src/server.js";
import { grokServerPlugin } from "../../../backends/grok/src/server.js";
import { piServerPlugin } from "../../../backends/pi/src/server.js";
import { opencodeServerPlugin } from "../../../backends/opencode/src/server.js";
import { opencodeV2ServerPlugin } from "../../../backends/opencode-v2/src/server.js";
import { museServerPlugin } from "../../../backends/muse/src/server.js";

export const serverPluginRegistry = new ServerPluginRegistry();
for (const plugin of [
  miniServerPlugin,
  codexServerPlugin,
  claudeServerPlugin,
  agyServerPlugin,
  auggieServerPlugin,
  clineServerPlugin,
  commandCodeServerPlugin,
  grokServerPlugin,
  piServerPlugin,
  opencodeServerPlugin,
  opencodeV2ServerPlugin,
  museServerPlugin,
]) {
  serverPluginRegistry.register(plugin);
}

/** The discovery knowledge of one CLI kind, owned by its plugin. */
export function cliDiscoveryForKind(kind: CliSelectionKind): CliDiscoverySpec {
  const plugin = serverPluginRegistry.get(kind);
  if (!plugin) {
    throw new Error(`no server plugin registered for CLI kind "${kind}"`);
  }
  return plugin.discovery;
}

/**
 * The full plugin catalog for the plugin manager (Phase 4): every
 * plugin project in the staging layout — the nine server backends,
 * the relay-config service, and the four web framework plugins (read
 * from their plugin.json, the manifest single source). `installed`
 * reflects the persisted install set; `locked` entries (the running
 * shell, the default Mini engine) cannot be uninstalled.
 */
import type { PluginManifest } from "@cxu/sdk-backend";
import { RELAY_CONFIG_MANIFEST } from "../../../backends/relay-config/src/manifest.js";
import { JEV_MANIFEST } from "../../../backends/jev/src/manifest.js";
import { VMTOOL_SECURITY_MANIFEST } from "../../../backends/vmtool-security/src/manifest.js";
import { FREE_MODE_MANIFEST } from "../../../backends/free-mode/src/manifest.js";
import { ENHANCE_MANIFEST } from "../../../frontends/enhance/src/manifest.js";
import { loadInstalledPluginIds, saveInstalledPluginIds } from "./pluginInstallStore.js";

export interface PluginCatalogEntry {
  id: string;
  kind: string;
  version: string;
  displayName: string;
  defaultInstalled: boolean;
  installed: boolean;
  locked: boolean;
}

const LOCKED_PLUGIN_IDS = new Set(["mini"]);

export function allPluginManifests(): PluginManifest[] {
  const manifests: PluginManifest[] = serverPluginRegistry.list().map((plugin) => plugin.manifest);
  manifests.push(RELAY_CONFIG_MANIFEST);
  manifests.push(JEV_MANIFEST);
  manifests.push(VMTOOL_SECURITY_MANIFEST);
  manifests.push(FREE_MODE_MANIFEST);
  manifests.push(ENHANCE_MANIFEST);
  return manifests;
}

/** One CLI plugin's declared Settings-toggle wiring (R3). */
export interface CliSettingsEntry {
  pluginId: string;
  slug: string;
  enabledEnvVar: string;
  linkKey?: string;
}

/** Every registered CLI plugin that declares a Settings toggle. */
export function cliSettingsEntries(): CliSettingsEntry[] {
  const out: CliSettingsEntry[] = [];
  for (const plugin of serverPluginRegistry.list()) {
    if (plugin.cliSettings) {
      out.push({ pluginId: plugin.manifest.id, ...plugin.cliSettings });
    }
  }
  return out;
}

/** The plugin id owning a Settings-toggle slug, if any. */
export function cliPluginIdForSettingsSlug(slug: string): string | null {
  return cliSettingsEntries().find((entry) => entry.slug === slug)?.pluginId ?? null;
}

/** Settings-links document entries for every toggle that is listed there. */
export function cliSettingsLinks(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of cliSettingsEntries()) {
    if (entry.linkKey) {
      out[entry.linkKey] = `/api/codex/settings/${entry.slug}`;
    }
  }
  return out;
}

export function defaultInstalledPluginIds(): string[] {
  return allPluginManifests().filter((m) => m.defaultInstalled).map((m) => m.id);
}

export function pluginCatalog(env: NodeJS.ProcessEnv = process.env): PluginCatalogEntry[] {
  const installed = loadInstalledPluginIds(defaultInstalledPluginIds(), env);
  return allPluginManifests().map((m) => ({
    id: m.id,
    kind: m.kind,
    version: m.version,
    displayName: m.displayName,
    defaultInstalled: m.defaultInstalled,
    installed: installed.has(m.id),
    locked: LOCKED_PLUGIN_IDS.has(m.id),
  }));
}

export function setPluginInstalled(id: string, installed: boolean, env: NodeJS.ProcessEnv = process.env): PluginCatalogEntry[] {
  const manifests = allPluginManifests();
  if (!manifests.some((m) => m.id === id)) {
    throw new Error(`unknown plugin "${id}"`);
  }
  if (!installed && LOCKED_PLUGIN_IDS.has(id)) {
    throw new Error(`plugin "${id}" is required by the running host and cannot be uninstalled`);
  }
  const current = loadInstalledPluginIds(defaultInstalledPluginIds(), env);
  if (installed) {
    current.add(id);
  } else {
    current.delete(id);
  }
  saveInstalledPluginIds(current, env);
  return pluginCatalog(env);
}
