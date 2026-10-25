import type { CliBackend } from "@codex-ui/shared";
import type { CliInstallationKind } from "../../state/codexClient";
import { BACKEND_WEB_PLUGINS } from "./pluginCatalog";

/**
 * The CLI surface is assembled from the installed backend plugins'
 * descriptors (see pluginCatalog.ts — the plugin projects under
 * `plugins/` are the source of truth for labels, icons and installation
 * kinds). Mini is the only built-in backend; every other backend is
 * optional and must be loaded only after the user selects or opens its
 * controls.
 */
export type CliPluginDefinition = {
  id: CliBackend;
  label: string;
  icon: string;
  builtIn: boolean;
  defaultBackend?: boolean;
  installationKind?: CliInstallationKind;
};

export const CLI_PLUGINS: readonly CliPluginDefinition[] = BACKEND_WEB_PLUGINS.map((plugin) => ({
  id: plugin.manifest.id as CliBackend,
  label: plugin.descriptor.label,
  icon: plugin.descriptor.icon,
  builtIn: plugin.descriptor.builtIn,
  ...(plugin.descriptor.defaultBackend ? { defaultBackend: true as const } : {}),
  ...(plugin.installationKind
    ? { installationKind: plugin.installationKind as CliInstallationKind }
    : {}),
}));

export const DEFAULT_CLI_BACKEND: CliBackend = "mini";

/** Every backend id is its own plugin id (auggie reopened as an
 * independent plugin on 2026-10-24; it no longer shares agy's). */
export function cliPluginId(id: CliBackend): CliBackend {
  return id;
}

export function cliPlugin(id: CliBackend): CliPluginDefinition {
  const normalized = cliPluginId(id);
  const found = CLI_PLUGINS.find((plugin) => plugin.id === normalized);
  if (found) return found;
  // No silent substitution: an unregistered backend renders as its
  // own raw id, never as another backend (no-fallback rule).
  return { id: normalized, label: normalized, icon: "", builtIn: false };
}
