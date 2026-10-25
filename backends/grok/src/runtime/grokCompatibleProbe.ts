import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pluginHostServices } from "@cxu/sdk-backend";

export interface GrokCliProbeResult {
  available: boolean;
  binPath: string;
  version?: string;
  loggedIn?: boolean;
  error?: string;
}

/**
 * Check whether the user has logged in to Grok CLI.
 * Credentials live in ~/.grok/auth.json.
 */
export function isGrokLoggedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (!home) return false;
  const authPath = join(home, ".grok", "auth.json");
  return existsSync(authPath);
}

/**
 * Find the grok binary path, respecting env overrides, preferred user selection,
 * cached enumeration, PATH / npm -g / bun -g / brew / linuxbrew locations,
 * and standard Windows / Unix candidate locations.
 * 服务端最小 PATH 下必须显式兜底，否则只能回退到裸 `grok` 导致版本未知。
 */
export function findGrokBin(env: NodeJS.ProcessEnv = process.env): string {
  const preferred = pluginHostServices().cli.getPreferredCliBinary("grok");
  if (preferred && existsSync(preferred)) {
    return preferred;
  }
  const latestCached = pluginHostServices().cli.getCachedLatestCliPath("grok");
  if (latestCached && existsSync(latestCached)) {
    return latestCached;
  }
  const configured = env.GROK_BIN || env.CODEX_UI_GROK_BIN;
  if (configured && typeof configured === "string" && configured.trim() && existsSync(configured.trim())) {
    return configured.trim();
  }
  const candidates = pluginHostServices().cli.enumerateCliCandidates("grok", env, process.platform);
  if (candidates.length > 0) {
    return candidates[0]!;
  }
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const exeName = process.platform === "win32" ? "grok.exe" : "grok";
  const fallbacks: Array<string | undefined> = [
    home ? join(home, ".grok", "bin", exeName) : undefined,
    process.platform === "win32" && env.LOCALAPPDATA
      ? join(env.LOCALAPPDATA, "grok", "bin", "grok.exe")
      : undefined,
    home ? join(home, "bin", exeName) : undefined,
    home ? join(home, ".local", "bin", exeName) : undefined,
    home ? join(home, ".cargo", "bin", exeName) : undefined,
    home ? join(home, ".bun", "bin", exeName) : undefined,
    home ? join(home, ".bun", "install", "global", "bin", exeName) : undefined,
    home ? join(home, ".npm-global", "bin", exeName) : undefined,
    home ? join(home, ".codex-ultra", "bin", exeName) : undefined,
    "/tools/node/bin/grok",
    env.npm_config_prefix ? join(env.npm_config_prefix, "bin", exeName) : undefined,
    env.NVM_BIN?.trim() ? join(env.NVM_BIN.trim(), exeName) : undefined,
    ...nvmGrokBinDirs(home, exeName),
    process.platform === "win32" ? undefined : "/usr/local/bin/grok",
    process.platform === "win32" ? undefined : "/usr/bin/grok",
    process.platform === "win32" ? undefined : "/home/linuxbrew/.linuxbrew/bin/grok",
  ];
  for (const candidate of fallbacks) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return "grok";
}

function nvmGrokBinDirs(home: string, exeName: string): string[] {
  if (!home || process.platform === "win32") return [];
  try {
    const root = join(home, ".nvm", "versions", "node");
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(root, e.name, "bin", exeName));
  } catch {
    return [];
  }
}

/**
 * Probe an explicit grok CLI binary for version and availability.
 */
export function probeGrokCliCommand(bin: string, env: NodeJS.ProcessEnv = process.env): GrokCliProbeResult {
  try {
    const proc = spawnSync(bin, ["--version"], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (proc.error) {
      return { available: false, binPath: bin, error: proc.error.message };
    }
    const output = (proc.stdout || proc.stderr || "").trim();
    const match = output.match(/(\d+\.\d+\.\d+)/) ?? output.match(/(\d+\.\d+)/);
    const version = match ? match[1] : undefined;
    return {
      available: proc.status === 0 || Boolean(version),
      binPath: bin,
      version,
      loggedIn: isGrokLoggedIn(env),
      error: proc.status !== 0 && !version ? output : undefined,
    };
  } catch (error) {
    return {
      available: false,
      binPath: bin,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Build safe spawn arguments for a grok CLI streaming-json session.
 */
export function buildGrokSpawnArgs(options: {
  prompt: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  mode?: "acceptEdits" | "plan";
  cwd?: string;
}): string[] {
  const args = [
    "-p",
    options.prompt,
    "--output-format",
    "streaming-json",
    "--permission-mode",
    options.mode === "plan" ? "plan" : "bypassPermissions",
  ];

  if (options.sessionId && options.sessionId.trim()) {
    args.push("--resume", options.sessionId.trim());
  }

  if (options.model && options.model.trim()) {
    args.push("-m", options.model.trim());
  }

  if (options.effort && options.effort.trim()) {
    const normalized = options.effort.trim().toLowerCase();
    const validEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
    if (validEfforts.includes(normalized)) {
      args.push("--reasoning-effort", normalized);
    }
  }

  if (options.cwd && options.cwd.trim()) {
    args.push("--cwd", options.cwd.trim());
  }

  return args;
}

/**
 * Build safe environment variables for the grok process.
 */
export function buildSafeGrokEnv(
  extraEnv: NodeJS.ProcessEnv = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ...extraEnv,
    CI: "1",
    FORCE_COLOR: "0",
  };
}
