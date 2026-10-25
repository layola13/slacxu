/**
 * OpenCode v2 — server side (kind "backend"). Independent plugin,
 * separate from the v1 plugin in every way: own project, own discovery,
 * own engine. Discovery rule (moved here from the host's cliVersions):
 * the v2 launcher is `opencode2` (installed by the official v2
 * installer into ~/.opencode-v2/bin, alongside the v1 dirs); a plain
 * `opencode` counts only when its probed version is >= 2. Env overrides:
 * OPENCODE_V2_BIN / CODEX_UI_OPENCODE_V2_BIN.
 *
 * Known upstream v2 gaps reflected in the capabilities: no file parts
 * and no permission/question round-trips yet.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
  EngineHandle,
  EngineStatus,
  PluginInstallation,
  ServerHost,
  ServerPlugin,
} from "@cxu/sdk-backend/server";

import { OPENCODE_V2_MANIFEST } from "./manifest.js";

export { OPENCODE_V2_MANIFEST };

function probe(bin: string): { version?: string; major?: number } {
  try {
    const out = execFileSync(bin, ["--version"], { timeout: 3000, encoding: "utf8" });
    const match = /(\d+)\.(\d+)\.(\d+)/.exec(out);
    return match ? { version: match[0], major: Number(match[1]) } : {};
  } catch {
    return {};
  }
}

class OpencodeV2Engine implements EngineHandle {
  readonly pluginId = "opencode-v2";
  #status: EngineStatus = { phase: "stopped", transport: "stdio" };
  async start(): Promise<EngineStatus> {
    this.#status = { phase: "ready", transport: "stdio" };
    return this.#status;
  }
  async stop(): Promise<void> {
    this.#status = { phase: "stopped", transport: "stdio" };
  }
  status(): EngineStatus {
    return this.#status;
  }
  async handleRpc(): Promise<unknown> {
    throw new Error("opencode-v2 plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

/**
 * The v2 runtime shares the v1 bridge implementation, instantiated by
 * the host with apiVersion 2. This plugin deliberately does not import
 * or re-export the opencode plugin's bridge class: plugins never reach
 * into a sibling project (the host composes both). The identity
 * separation (discovery, manifest, engine id) lives in this module.
 */

export const opencodeV2ServerPlugin: ServerPlugin = {
  manifest: OPENCODE_V2_MANIFEST,
  cliSettings: { slug: "opencode-v2-cli", enabledEnvVar: "CODEX_UI_OPENCODE_V2_COMPATIBLE_CLI_ENABLED" },
  discovery: {
    // Declared sharing: v2 paths are chosen through the v1 preference key.
    preferredPathPrefKey: "cliPreferredOpencodePath",
    binaryNames: ["opencode2", "opencode"],
    envBinVars: ["OPENCODE_V2_BIN", "CODEX_UI_OPENCODE_V2_BIN"],
    matchesKind(entry: { path: string; version?: string }): boolean {
      const base = basename(entry.path).toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
      const major = entry.version ? Number.parseInt(entry.version.split(".")[0] ?? "", 10) : Number.NaN;
      return base === "opencode2" || (Number.isFinite(major) && major >= 2);
    },
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new OpencodeV2Engine();
  },
  async findInstallations(env: NodeJS.ProcessEnv): Promise<PluginInstallation[]> {
    const found: PluginInstallation[] = [];
    const seen = new Set<string>();
    const consider = (path: string, source: PluginInstallation["source"]) => {
      if (seen.has(path) || !existsSync(path)) return;
      const { version, major } = probe(path);
      if (basename(path) === "opencode" && (major === undefined || major < 2)) return;
      seen.add(path);
      found.push({ path, version, source });
    };
    const override = env.OPENCODE_V2_BIN ?? env.CODEX_UI_OPENCODE_V2_BIN;
    if (override) consider(override, "env");
    consider(join(homedir(), ".opencode-v2", "bin", "opencode2"), "well-known-dir");
    consider(join(homedir(), ".opencode", "bin", "opencode2"), "well-known-dir");
    consider(join(homedir(), ".opencode", "bin", "opencode"), "well-known-dir");
    for (const dir of (env.PATH ?? "").split(":")) {
      if (!dir) continue;
      consider(join(dir, "opencode2"), "path");
      consider(join(dir, "opencode"), "path");
    }
    return found;
  },
  skillRoots(): string[] {
    return [".opencode/skills"];
  },
};

export default opencodeV2ServerPlugin;
