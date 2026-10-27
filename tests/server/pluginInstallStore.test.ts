import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadInstalledPluginIds,
  pluginInstallStorePath,
  saveInstalledPluginIds,
} from "../../apps/server/src/pluginInstallStore";
import {
  allPluginManifests,
  defaultInstalledPluginIds,
  pluginCatalog,
  setPluginInstalled,
} from "../../apps/server/src/pluginHost";

const dirs: string[] = [];
function tempEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-install-"));
  dirs.push(dir);
  return { ...process.env, CODEX_UI_DATA_DIR: dir };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("plugin install store", () => {
  test("round-trips the installed set through disk", () => {
    const env = tempEnv();
    saveInstalledPluginIds(new Set(["mini", "codex"]), env);
    expect([...loadInstalledPluginIds([], env)].sort()).toEqual(["codex", "mini"]);
    expect(pluginInstallStorePath(env)).toContain("plugins-installed.json");
  });

  test("missing store falls back to the provided defaults", () => {
    const env = tempEnv();
    expect([...loadInstalledPluginIds(["mini"], env)]).toEqual(["mini"]);
  });
});

describe("plugin catalog (Phase 4)", () => {
  test("contains every plugin project exactly once", () => {
    const ids = allPluginManifests().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      "mini", "codex", "claude", "agy", "grok", "pi", "opencode", "opencode-v2", "muse",
      "relay-config",
    ]) {
      expect(ids).toContain(id);
    }
  });

  test("defaults are exactly the defaultInstalled manifests", () => {
    const env = tempEnv();
    const catalog = pluginCatalog(env);
    const defaults = new Set(defaultInstalledPluginIds());
    for (const entry of catalog) {
      expect(entry.installed).toBe(defaults.has(entry.id));
    }
    expect(defaults.has("mini")).toBe(true);
    expect(defaults.has("codex")).toBe(false);
    expect(defaults.has("enhance")).toBe(true);
    expect(defaults.has("relay-config")).toBe(true);
  });

  test("install and uninstall persist across reads", () => {
    const env = tempEnv();
    setPluginInstalled("codex", true, env);
    expect(pluginCatalog(env).find((p) => p.id === "codex")?.installed).toBe(true);
    setPluginInstalled("codex", false, env);
    expect(pluginCatalog(env).find((p) => p.id === "codex")?.installed).toBe(false);
  });

  test("locked plugins cannot be uninstalled; unknown ids are rejected", () => {
    const env = tempEnv();
    expect(() => setPluginInstalled("mini", false, env)).toThrow(/cannot be uninstalled/);
    expect(() => setPluginInstalled("nope", true, env)).toThrow(/unknown plugin/);
  });
});
