/**
 * Persisted installed-plugin set (plugin architecture Phase 4).
 *
 * The catalog of available plugins is code (the plugin projects); what
 * the user has installed is state, kept as JSON under the server data
 * dir alongside the other stores. First run (no file) seeds from the
 * manifests' `defaultInstalled` flags: framework plugins, relay-config
 * and Mini only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function resolvePluginDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEX_UI_DATA_DIR?.trim();
  return configured || path.join(homedir(), ".codex-ultra");
}

const STORE_FILE = "plugins-installed.json";

export function pluginInstallStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePluginDataDir(env), STORE_FILE);
}

/** Installed ids from disk; `defaults` when no (readable) store exists yet. */
export function loadInstalledPluginIds(
  defaults: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const file = pluginInstallStorePath(env);
  if (!existsSync(file)) {
    return new Set(defaults);
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { installed?: unknown };
    if (Array.isArray(parsed.installed)) {
      return new Set(parsed.installed.filter((id): id is string => typeof id === "string"));
    }
  } catch {
    // A corrupt store must not take the server down: fall back to defaults.
  }
  return new Set(defaults);
}

export function saveInstalledPluginIds(
  ids: ReadonlySet<string>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const file = pluginInstallStorePath(env);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ installed: [...ids].sort() }, null, 2)}\n`, "utf8");
}
