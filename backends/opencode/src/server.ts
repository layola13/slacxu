/**
 * OpenCode v1 — server side (kind "backend"). Independent plugin: owns
 * its engine declaration and its installation discovery. Discovery rule
 * (moved here from the host's cliVersions): look in ~/.opencode/bin and
 * on PATH for a launcher named `opencode`; `opencode2` is never v1, and
 * a plain `opencode` whose probed major version is >= 2 is the v2
 * launcher and does not belong to this plugin.
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

import { OPENCODE_MANIFEST } from "./manifest.js";
import { OPENCODE_OFFICIAL_PROVIDER_ID } from "./runtime/opencodeBridge.js";

export { OPENCODE_MANIFEST };

function probeMajorVersion(bin: string): number | undefined {
  try {
    const out = execFileSync(bin, ["--version"], { timeout: 3000, encoding: "utf8" });
    const match = /(\d+)\.(\d+)\.(\d+)/.exec(out);
    return match ? Number(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function probeVersion(bin: string): string | undefined {
  try {
    const out = execFileSync(bin, ["--version"], { timeout: 3000, encoding: "utf8" });
    const match = /\d+\.\d+\.\d+/.exec(out);
    return match ? match[0] : undefined;
  } catch {
    return undefined;
  }
}

class OpencodeEngine implements EngineHandle {
  readonly pluginId = "opencode";
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
    throw new Error("opencode plugin engine is not wired to the host yet (phase 1 declaration)");
  }
}

export const opencodeServerPlugin: ServerPlugin = {
  manifest: OPENCODE_MANIFEST,
  officialProviderId: OPENCODE_OFFICIAL_PROVIDER_ID,
  cliSettings: { slug: "opencode-cli", enabledEnvVar: "CODEX_UI_OPENCODE_COMPATIBLE_CLI_ENABLED", linkKey: "opencodeCompatibleCliSettings" },
  discovery: {
    preferredPathPrefKey: "cliPreferredOpencodePath",
    binaryNames: ["opencode"],
    envBinVars: ["OPENCODE_BIN", "CODEX_UI_OPENCODE_BIN"],
    matchesKind(entry: { path: string; version?: string }): boolean {
      const base = basename(entry.path).toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
      const major = entry.version ? Number.parseInt(entry.version.split(".")[0] ?? "", 10) : Number.NaN;
      return base !== "opencode2" && !(Number.isFinite(major) && major >= 2);
    },
  },
  createEngine(_host: ServerHost): EngineHandle {
    return new OpencodeEngine();
  },
  async findInstallations(env: NodeJS.ProcessEnv): Promise<PluginInstallation[]> {
    const found: PluginInstallation[] = [];
    const seen = new Set<string>();
    const consider = (path: string, source: PluginInstallation["source"]) => {
      if (seen.has(path) || !existsSync(path)) return;
      if (basename(path) === "opencode2") return;
      const major = probeMajorVersion(path);
      if (major !== undefined && major >= 2) return;
      seen.add(path);
      found.push({ path, version: probeVersion(path), source });
    };
    const override = env.OPENCODE_BIN ?? env.CODEX_UI_OPENCODE_BIN;
    if (override) consider(override, "env");
    consider(join(homedir(), ".opencode", "bin", "opencode"), "well-known-dir");
    for (const dir of (env.PATH ?? "").split(":")) {
      if (dir) consider(join(dir, "opencode"), "path");
    }
    return found;
  },
  skillRoots(): string[] {
    return [".opencode/skills"];
  },
};

export default opencodeServerPlugin;
