import { execFileSync, spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { resolveCliSpawn } from "@cxu/sdk-backend";

// The Windows command-shim resolver moved to the SDK (cliSpawn.ts) so
// every backend plugin spawns external CLIs by the same rules; these
// re-exports keep the historical import surface of this module intact.
export { resolveCliSpawn as resolveCodexSpawn, resolveWindowsComSpec, resolveWindowsPowerShell } from "@cxu/sdk-backend";
import { copyFileSync, existsSync, linkSync, statSync } from "node:fs";
import path from "node:path";
import { getCachedLatestCliPath, getPreferredCliBinary } from "./cliSelectionState.js";

const CHATGPT_APPX_PACKAGE_NAME = "OpenAI.Codex";
const BUNDLED_APP_SERVER_NAMES = ["codex-app-server.exe", "codex_app_server.exe"] as const;
export type ChatGptInstallLocationLookup = () => string | undefined;

export function canExecute(filePath: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return false;
    }
    if (platform === "win32" || process.platform === "win32") {
      return true;
    }
    return (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function findCodexBinary(
  customBin?: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  lookupChatGptInstallLocation: ChatGptInstallLocationLookup = findChatGptInstallLocation,
  workingDirectory: string = process.cwd(),
): string {
  // An explicit user pick (CLI version switcher) always wins.
  const preferred = getPreferredCliBinary("codex");
  if (preferred && isLaunchableFile(preferred, platform)) {
    return preferred;
  }
  // Otherwise default to the newest detected installation once enumeration
  // has warmed up; before that (or when nothing newer was found) fall through
  // to the legacy resolution order below.
  const latestCached = getCachedLatestCliPath("codex");
  if (!customBin && latestCached && isLaunchableFile(latestCached, platform)) {
    return latestCached;
  }

  const configured = customBin || env.CODEX_BIN;
  if (configured) {
    const resolved = resolveConfiguredBinary(configured, platform, env);
    if (resolved) {
      return resolved;
    }
  }

  // Windows desktop/Bun builds may ship a standalone app-server beside the
  // running server. Prefer that bundled runtime before searching PATH. The
  // standalone binary uses a different argv contract, handled by
  // codexAppServerArgs().
  if (platform === "win32" && !customBin) {
    const bundled = findBundledCodexAppServerBinary(platform, env, workingDirectory);
    if (bundled) return bundled;
  }

  if (platform !== "win32") {
    const defaultBin = "/root/projects/codex/codex-rs/target/debug/codex";
    if (canExecute(defaultBin, platform)) {
      return defaultBin;
    }
  }

  const fromPath = resolveFromPath("codex", platform, env);
  if (fromPath) {
    return fromPath;
  }

  const bundledChatGptCodex = findChatGptBundledCodexBinary(platform, lookupChatGptInstallLocation);
  if (bundledChatGptCodex) {
    return bundledChatGptCodex;
  }

  return platform === "win32" ? "codex.cmd" : "codex";
}

/** Locate the standalone Windows app-server shipped with Codex Ultra. */
export function findBundledCodexAppServerBinary(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  workingDirectory: string = process.cwd(),
): string | undefined {
  if (platform !== "win32") return undefined;
  const configured = env.CODEX_UI_CODEX_APP_SERVER_BIN;
  if (configured && isLaunchableFile(configured, platform)) {
    ensureCodeModeHostFallback(path.dirname(configured));
    return configured;
  }

  const roots = [
    workingDirectory,
    path.resolve(workingDirectory, "desktop-resources"),
    path.dirname(process.execPath),
    path.resolve(path.dirname(process.execPath), "desktop-resources")
  ];
  for (const root of roots) {
    for (const name of BUNDLED_APP_SERVER_NAMES) {
      const candidate = path.join(root, name);
      if (isLaunchableFile(candidate, platform)) {
        ensureCodeModeHostFallback(path.dirname(candidate));
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Fallback discovery for codex-code-mode-host.exe when not bundled.
 * Checks known OpenAI/Codex install locations and PATH; links or copies to the app-server directory.
 */
export function ensureCodeModeHostFallback(appServerDir?: string): boolean {
  if (process.platform !== "win32") return false;
  const targetDir = appServerDir
    ?? (existsSync(path.join(process.cwd(), "desktop-resources")) ? path.join(process.cwd(), "desktop-resources") : undefined);
  if (!targetDir || !existsSync(targetDir)) return false;
  if (existsSync(path.join(targetDir, ".git"))) return false;

  const targetHost = path.join(targetDir, "codex-code-mode-host.exe");
  if (existsSync(targetHost)) return true;

  const candidates: string[] = [];
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(path.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex-code-mode-host.exe"));
    candidates.push(path.join(localAppData, "Programs", "OpenAI", "Codex", "codex-code-mode-host.exe"));
  }
  try {
    const stdout = execFileSync("where.exe", ["codex-code-mode-host.exe"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const found = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    candidates.push(...found);
  } catch {}

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        linkSync(candidate, targetHost);
        console.log(`[codex-catalog] Linked host fallback from ${candidate} to ${targetHost}`);
        return true;
      } catch {
        try {
          copyFileSync(candidate, targetHost);
          console.log(`[codex-catalog] Copied host fallback from ${candidate} to ${targetHost}`);
          return true;
        } catch (e) {
          console.warn(`[codex-catalog] Failed to link/copy host fallback from ${candidate}`, e);
        }
      }
    }
  }
  return false;
}

/** Standalone app-server binaries do not accept the `app-server` subcommand. */
export function isStandaloneCodexAppServerBinary(command: string): boolean {
  return /(?:^|[\\/])codex[-_]app[-_]server(?:\.exe)?$/i.test(command);
}

export function codexAppServerArgs(command: string): string[] {
  return isStandaloneCodexAppServerBinary(command)
    ? ["--listen=stdio://"]
    : ["app-server", "--stdio"];
}

export function findChatGptBundledCodexBinary(
  platform: NodeJS.Platform = process.platform,
  findInstallLocation: ChatGptInstallLocationLookup = findChatGptInstallLocation,
): string | undefined {
  if (platform !== "win32") {
    return undefined;
  }

  const installLocation = findInstallLocation();
  if (!installLocation) {
    return undefined;
  }

  const bundledCodex = path.join(installLocation, "app", "resources", "codex.exe");
  return isLaunchableFile(bundledCodex, platform) ? bundledCodex : undefined;
}

function findChatGptInstallLocation(): string | undefined {
  try {
    const output = execFileSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$package = Get-AppxPackage -Name '${CHATGPT_APPX_PACKAGE_NAME}' -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1; if ($package) { [Console]::Out.Write($package.InstallLocation) }`,
    ], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 16 * 1024,
    });
    const installLocation = output.trim();
    return installLocation || undefined;
  } catch {
    return undefined;
  }
}

function resolveConfiguredBinary(
  configured: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const hasPathSeparator = configured.includes("/") || configured.includes("\\");
  if (!hasPathSeparator) {
    return resolveFromPath(configured, platform, env);
  }

  if (isLaunchableFile(configured, platform)) {
    return configured;
  }
  if (platform === "win32" && path.extname(configured) === "") {
    for (const extension of windowsExecutableExtensions(env)) {
      const candidate = `${configured}${extension}`;
      if (isLaunchableFile(candidate, platform)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function resolveFromPath(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const pathDirs = pathValue.split(path.delimiter).filter(Boolean);
  const commandExtension = path.extname(command);
  const extensions = platform === "win32" && commandExtension === ""
    ? windowsExecutableExtensions(env)
    : [""];

  for (const dir of pathDirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${command}${extension}`);
      if (isLaunchableFile(candidate, platform)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function windowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.PATHEXT ?? env.PathExt ?? ".COM;.EXE;.CMD;.BAT")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  const supported = configured.filter((extension) => [".com", ".exe", ".cmd", ".bat"].includes(extension));
  return [...new Set([...supported, ".exe", ".cmd", ".bat", ".com"])];
}

function isLaunchableFile(filePath: string, platform: NodeJS.Platform): boolean {
  if (!canExecute(filePath, platform)) {
    return false;
  }
  if (platform !== "win32") {
    return true;
  }
  return [".com", ".exe", ".cmd", ".bat", ".ps1"].includes(path.extname(filePath).toLowerCase());
}

export function isCodexCliAvailable(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  lookupChatGptInstallLocation: ChatGptInstallLocationLookup = findChatGptInstallLocation,
  workingDirectory: string = process.cwd(),
): boolean {
  if (platform !== "win32" && platform !== "darwin" && platform !== "linux") {
    return false;
  }
  const explicit = env.CODEX_UI_CODEX_AVAILABLE?.trim();
  if (explicit !== undefined && explicit !== "") {
    return /^(1|true|yes)$/i.test(explicit);
  }
  const binary = findCodexBinary(undefined, platform, env, lookupChatGptInstallLocation, workingDirectory);
  if (!binary) {
    return false;
  }
  if (binary === "codex" || binary === "codex.cmd") {
    const resolved = resolveFromPath("codex", platform, env);
    return Boolean(resolved && isLaunchableFile(resolved, platform));
  }
  return isLaunchableFile(binary, platform);
}

export function spawnCodexCommand(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
): ChildProcessWithoutNullStreams {
  const resolved = resolveCliSpawn(command, args);
  if (!resolved.usesCommandShim) {
    return spawn(command, args, {
      ...options,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: process.platform === "win32",
    });
  }

  return spawn(resolved.command, resolved.args, {
    ...options,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // Without this, Node/Bun turns the quotes inside the cmd.exe `/c`
    // command string into literal `\"` characters. cmd.exe then tries to
    // execute a file whose name includes quotes (common when npm is under
    // "Program Files"). PowerShell launchers still need normal argv quoting.
    windowsVerbatimArguments: !/\.ps1$/i.test(command),
  });
}
