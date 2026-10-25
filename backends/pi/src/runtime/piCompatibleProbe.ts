import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pluginHostServices } from "@cxu/sdk-backend";

export interface PiCliProbeResult {
  available: boolean;
  binPath: string;
  version?: string;
  configured?: boolean;
  error?: string;
}

/**
 * Check whether ~/.pi directory exists.
 */
export function isPiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (!home) return false;
  return existsSync(join(home, ".pi"));
}

/**
 * Find the pi binary path, respecting user selection, env overrides,
 * cached enumeration, and standard PATH / npm -g / bun -g / brew / linuxbrew
 * locations. 服务端最小 PATH 下必须显式兜底，否则只能回退到裸 `pi` 导致版本未知。
 */
export function findPiBin(env: NodeJS.ProcessEnv = process.env): string {
  const preferred = pluginHostServices().cli.getPreferredCliBinary("pi");
  if (preferred && existsSync(preferred)) {
    return preferred;
  }
  const latestCached = pluginHostServices().cli.getCachedLatestCliPath("pi");
  if (latestCached && existsSync(latestCached)) {
    return latestCached;
  }
  const configured = env.PI_BIN || env.CODEX_UI_PI_BIN;
  if (configured && typeof configured === "string" && configured.trim() && existsSync(configured.trim())) {
    return configured.trim();
  }
  const candidates = pluginHostServices().cli.enumerateCliCandidates("pi", env, process.platform);
  if (candidates.length > 0) {
    return candidates[0]!;
  }
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (process.platform === "win32") {
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const exeCandidates: Array<string | undefined> = [
      env.APPDATA ? join(env.APPDATA, "npm", "pi.cmd") : undefined,
      env.APPDATA ? join(env.APPDATA, "npm", "pi.exe") : undefined,
      home ? join(home, ".bun", "bin", "pi.cmd") : undefined,
      home ? join(home, ".bun", "bin", "pi.exe") : undefined,
      "D:\\Program Files\\nodejs\\pi.cmd",
      join(programFiles, "nodejs", "pi.cmd"),
      join(programFilesX86, "nodejs", "pi.cmd"),
      "D:\\Program Files\\nodejs\\pi.exe",
      join(programFiles, "nodejs", "pi.exe"),
      join(programFilesX86, "nodejs", "pi.exe"),
    ];
    for (const c of exeCandidates) {
      if (c && existsSync(c)) return c;
    }
    return "pi";
  }
  const exeName = "pi";
  const fallbacks: Array<string | undefined> = [
    home ? join(home, ".pi", "bin", exeName) : undefined,
    home ? join(home, "bin", exeName) : undefined,
    "/usr/local/bin/pi",
    "/usr/bin/pi",
    "/opt/bin/pi",
    "/opt/homebrew/bin/pi",
    "/home/linuxbrew/.linuxbrew/bin/pi",
    home ? join(home, ".linuxbrew", "bin", exeName) : undefined,
    home ? join(home, ".local", "bin", exeName) : undefined,
    home ? join(home, ".bun", "bin", exeName) : undefined,
    home ? join(home, ".bun", "install", "global", "bin", exeName) : undefined,
    home ? join(home, ".npm-global", "bin", exeName) : undefined,
    home ? join(home, ".codex-ultra", "bin", exeName) : undefined,
    "/tools/node/bin/pi",
    env.npm_config_prefix ? join(env.npm_config_prefix, "bin", exeName) : undefined,
    env.NVM_BIN?.trim() ? join(env.NVM_BIN.trim(), exeName) : undefined,
    ...nvmPiBinDirs(home),
  ];
  for (const c of fallbacks) {
    if (c && existsSync(c)) return c;
  }
  return "pi";
}

function nvmPiBinDirs(home: string): string[] {
  if (!home) return [];
  try {
    const root = join(home, ".nvm", "versions", "node");
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(root, e.name, "bin", "pi"));
  } catch {
    return [];
  }
}

/**
 * Probe an explicit pi CLI binary for version and availability.
 */
export function probePiCliCommand(bin: string, env: NodeJS.ProcessEnv = process.env): PiCliProbeResult {
  try {
    const isWindowsNonExe = process.platform === "win32" && !bin.toLowerCase().endsWith(".exe");
    const proc = spawnSync(bin, ["--version"], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      shell: isWindowsNonExe,
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
      configured: isPiConfigured(env),
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
