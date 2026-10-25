import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pluginHostServices } from "@cxu/sdk-backend";

export interface AgyCliProbeResult {
  available: boolean;
  binPath: string;
  version?: string;
  loggedIn?: boolean;
  error?: string;
}

function isLaunchable(path: string): boolean {
  if (!existsSync(path)) return false;
  if (process.platform === "win32") return true;
  try {
    const stats = statSync(path);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// Dual-mode policy: official (OAuth) and third-party (LLM gateway env or
// in-memory proxy env) both work without touching
// ~/.gemini/antigravity-cli/settings.json.
// Forcing modelProvider=gemini on disk breaks official mode and bare
// `agy` invocations (CLI then demands GEMINI_API_KEY), so this function
// is intentionally a no-op. Kept as an export so existing imports keep
// compiling; third-party routing is handled purely through per-process
// env (AGY_LLM_GATEWAY_* / CLOUD_CODE_URL / GOOGLE_GEMINI_BASE_URL /
// GEMINI_API_KEY).
export function ensureAgyGeminiSettings(_env: NodeJS.ProcessEnv = process.env): void {
  return;
}

/**
 * Check whether the user has logged in to Antigravity CLI.
 * Credentials live in ~/.gemini/oauth_creds.json or google_accounts.json.
 */
export function isAgyLoggedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (!home) return false;
  const oauthPath = join(home, ".gemini", "oauth_creds.json");
  const accountsPath = join(home, ".gemini", "google_accounts.json");
  return existsSync(oauthPath) || existsSync(accountsPath);
}

/**
 * Find the agy binary path, respecting env overrides, preferred user selection,
 * cached enumeration, PATH / npm -g / bun -g / brew / linuxbrew locations,
 * and standard Windows / Unix candidate locations.
 * 服务端最小 PATH 下必须显式兜底，否则只能回退到裸 `agy` 导致版本未知。
 */
export function findAgyBin(env: NodeJS.ProcessEnv = process.env): string {
  const preferred = pluginHostServices().cli.getPreferredCliBinary("agy");
  if (preferred && isLaunchable(preferred)) {
    return preferred;
  }
  const latestCached = pluginHostServices().cli.getCachedLatestCliPath("agy");
  if (latestCached && isLaunchable(latestCached)) {
    return latestCached;
  }
  const configured = env.AGY_BIN || env.CODEX_UI_AGY_BIN;
  if (configured && typeof configured === "string" && configured.trim() && isLaunchable(configured.trim())) {
    return configured.trim();
  }
  const candidates = pluginHostServices().cli.enumerateCliCandidates("agy", env, process.platform);
  if (candidates.length > 0) {
    return candidates[0]!;
  }
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (process.platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? "";
    if (localAppData) {
      const candidate = join(localAppData, "agy", "bin", "agy.exe");
      if (isLaunchable(candidate)) return candidate;
    }
    if (home) {
      for (const sub of ["agy\\bin\\agy.exe", ".local\\bin\\agy.exe", ".bun\\bin\\agy.cmd"]) {
        const p = join(home, sub);
        if (isLaunchable(p)) return p;
      }
    }
    return "agy";
  }
  const fallbacks: Array<string | undefined> = [
    home ? join(home, ".agy", "bin", "agy") : undefined,
    home ? join(home, "bin", "agy") : undefined,
    "/usr/local/bin/agy",
    "/usr/bin/agy",
    "/opt/bin/agy",
    "/opt/homebrew/bin/agy",
    "/home/linuxbrew/.linuxbrew/bin/agy",
    home ? join(home, ".local", "bin", "agy") : undefined,
    home ? join(home, ".bun", "bin", "agy") : undefined,
    home ? join(home, ".bun", "install", "global", "bin", "agy") : undefined,
    home ? join(home, ".npm-global", "bin", "agy") : undefined,
    home ? join(home, ".codex-ultra", "bin", "agy") : undefined,
    "/tools/node/bin/agy",
    env.npm_config_prefix ? join(env.npm_config_prefix, "bin", "agy") : undefined,
    env.NVM_BIN?.trim() ? join(env.NVM_BIN.trim(), "agy") : undefined,
    ...nvmAgyBinDirs(home),
  ];
  for (const c of fallbacks) {
    if (c && isLaunchable(c)) return c;
  }
  return "agy";
}

function nvmAgyBinDirs(home: string): string[] {
  if (!home) return [];
  try {
    const root = join(home, ".nvm", "versions", "node");
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(root, e.name, "bin", "agy"));
  } catch {
    return [];
  }
}

/**
 * Find the standalone agy-launch binary path if available.
 */
export function findAgyLaunchBin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.AGY_LAUNCH_BIN || env.CODEX_UI_AGY_LAUNCH_BIN;
  if (configured && typeof configured === "string" && isLaunchable(configured)) {
    return configured;
  }
  const exeCandidates = [
    join(process.cwd(), "desktop-resources", "bin", "agy-launch.exe"),
    join(process.cwd(), "resources", "desktop", "bin", "agy-launch.exe"),
    join(process.cwd(), "bin", "agy-launch.exe"),
    "E:/projects/agy-launch/dist/agy-launch.exe",
  ];
  for (const c of exeCandidates) {
    if (isLaunchable(c)) return c;
  }
  // POSIX builds ship without extension; previously Linux always missed.
  if (process.platform !== "win32") {
    const posixCandidates = [
      join(process.cwd(), "desktop-resources", "bin", "agy-launch"),
      join(process.cwd(), "resources", "desktop", "bin", "agy-launch"),
      join(process.cwd(), "bin", "agy-launch"),
    ];
    for (const c of posixCandidates) {
      if (isLaunchable(c)) return c;
    }
  }
  return undefined;
}

/**
 * Check if agy-launch is installed and configured (has .env with required settings)
 */
export function isAgyLaunchConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const bin = findAgyLaunchBin(env);
  if (!bin) return false;
  
  // Check if agy-launch config directory has .env with required keys
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (!home) return false;
  
  const configDir = join(home, ".config", "agy-launch");
  const envPath = join(configDir, ".env");
  if (!existsSync(envPath)) return false;
  
  // Check for required config keys
  try {
    const content = readFileSync(envPath, "utf8");
    const hasBaseUrl = /AGY_LAUNCH_BASE_URL\s*=/.test(content);
    const hasModel = /AGY_LAUNCH_MODEL\s*=/.test(content);
    const hasApiKey = /AGY_LAUNCH_API_KEY\s*=/.test(content);
    return hasBaseUrl && hasModel && hasApiKey;
  } catch {
    return false;
  }
}

/**
 * Probe an explicit agy CLI binary for version and availability.
 */
export function probeAgyCliCommand(bin: string, env: NodeJS.ProcessEnv = process.env): AgyCliProbeResult {
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
      loggedIn: isAgyLoggedIn(env),
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
 * Build safe spawn arguments for an agy CLI stream-json session.
 */
export function buildAgySpawnArgs(options: {
  conversationId?: string;
  model?: string;
  effort?: string;
  mode?: "accept-edits" | "plan";
  dangerouslySkipPermissions?: boolean;
  addDirs?: string[];
  cwd?: string;
} = {}): string[] {
  const args = [
    "--input-format=stream-json",
    "--output-format=stream-json",
  ];

  if (options.dangerouslySkipPermissions !== false) {
    args.push("--dangerously-skip-permissions");
  }

  // Add workspace directories via --add-dir
  const dirs = new Set<string>();
  if (options.addDirs && Array.isArray(options.addDirs)) {
    for (const d of options.addDirs) {
      if (typeof d === "string" && d.trim()) dirs.add(d.trim());
    }
  }
  if (options.cwd && typeof options.cwd === "string" && options.cwd.trim()) {
    dirs.add(options.cwd.trim());
  }
  for (const dir of dirs) {
    args.push("--add-dir", dir);
  }

  if (options.conversationId && options.conversationId.length > 0) {
    args.push("--conversation", options.conversationId);
  }

  if (options.model && options.model.length > 0) {
    args.push("--model", options.model);
  }

  const isGeminiModel = !options.model || /gemini/i.test(options.model);
  const modelHasEffortSuffix = Boolean(options.model && /-(?:low|medium|high)$/i.test(options.model));
  const normalizedEffort = options.effort?.trim().toLowerCase();
  if (isGeminiModel && !modelHasEffortSuffix) {
    if (normalizedEffort && ["low", "medium", "high"].includes(normalizedEffort)) {
      args.push("--effort", normalizedEffort);
    } else if (options.model && /gemini-3\./i.test(options.model)) {
      args.push("--effort", "high");
    }
  }

  if (options.mode) {
    args.push("--mode", options.mode);
  }

  return args;
}

/**
 * Build safe environment variables for the agy process.
 */
export function buildSafeAgyEnv(
  extraEnv: NodeJS.ProcessEnv = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ...extraEnv,
    CI: "1",
    FORCE_COLOR: "0",
  };
  if (!("CLOUD_CODE_URL" in extraEnv)) {
    delete env.CLOUD_CODE_URL;
  }
  if (!("AGY_LLM_GATEWAY_URL" in extraEnv)) {
    delete env.AGY_LLM_GATEWAY_URL;
  }
  if (!("AGY_LLM_GATEWAY_API_KEY" in extraEnv)) {
    delete env.AGY_LLM_GATEWAY_API_KEY;
  }
  if (!("AGY_LLM_GATEWAY_WIRE_PROTOCOL" in extraEnv)) {
    delete env.AGY_LLM_GATEWAY_WIRE_PROTOCOL;
  }
  if (!("AGY_LLM_GATEWAY_MODELS" in extraEnv)) {
    delete env.AGY_LLM_GATEWAY_MODELS;
  }
  if (!("GOOGLE_GEMINI_BASE_URL" in extraEnv)) {
    delete env.GOOGLE_GEMINI_BASE_URL;
  }
  if (!("GEMINI_API_KEY" in extraEnv)) {
    delete env.GEMINI_API_KEY;
  }
  return env;
}
