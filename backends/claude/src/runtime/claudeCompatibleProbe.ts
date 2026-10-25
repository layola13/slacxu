import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, delimiter, extname, join, resolve } from "node:path";
import { pluginHostServices } from "@cxu/sdk-backend";
import { deriveOpenCodeSessionId, OPENCODE_CLI_BACKEND_HEADER } from "@cxu/sdk-backend";

export interface ClaudeCliProbeResult {
  available: boolean;
  version?: string;
  binPath?: string;
  error?: string;
}

/**
 * Structured spawn diagnostics for the Claude CLI.
 * Console output is captured to `log.txt` by the desktop shell
 * (`desktop/main.cjs` redirects the server stdio to the log fd), so
 * `console.error/warn` here is both terminal and on-disk evidence.
 * Never put env values or tokens in `details` — presence booleans only.
 */
function redactClaudeLogText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer ***")
    .replace(/api[_-]?key["'=:\s]+[A-Za-z0-9._~+/=-]{8,}/gi, "api_key=***");
}

function errnoDetails(error: unknown): Record<string, string | number | undefined> {
  const record = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const pick = (key: string): string | number | undefined => {
    const value = record[key];
    return typeof value === "string" || typeof value === "number" ? value : undefined;
  };
  return {
    code: pick("code"),
    errno: pick("errno"),
    syscall: pick("syscall"),
    path: pick("path"),
  };
}

function logClaudeSpawnEvent(
  level: "log" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
): void {
  try {
    const rendered = redactClaudeLogText(JSON.stringify(details)).slice(0, 4000);
    console[level](`[claude-spawn] ${event} ${rendered}`);
  } catch {
    // Logging must never break spawning.
  }
}


/**
 * Find the claude binary path, respecting env overrides.
 * An explicit user pick (CLI version switcher) or the newest detected
 * installation takes precedence over env defaults.
 */
export function findClaudeBin(env: NodeJS.ProcessEnv = process.env): string {
  const preferred = pluginHostServices().cli.getPreferredCliBinary("claude");
  if (preferred && existsSync(preferred)) {
    return preferred;
  }
  const latestCached = pluginHostServices().cli.getCachedLatestCliPath("claude");
  if (latestCached && existsSync(latestCached)) {
    return latestCached;
  }
  const configured = env.CODECLI_BIN || env.CLAUDE_CODE_BIN;
  if (configured && typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  // 服务端最小 PATH 兜底：先走统一枚举（PATH + npm -g/bun -g/brew/linuxbrew/nvm 等），
  // 避免只能回退到裸 `claude` 导致安装列表为空、版本未知。
  const enumerated = pluginHostServices().cli.enumerateCliCandidates("claude", env, process.platform);
  if (enumerated.length > 0) {
    return enumerated[0]!;
  }
  const hasSearchPath = Boolean(env.PATH || env.Path || env.path);
  if (hasSearchPath) {
    const cliProbe = probeClaudeCliCommand("claude", env);
    if (cliProbe.available) return "claude";
  }
  const wellKnown = wellKnownClaudeCandidates(env);
  for (const candidate of wellKnown) {
    if (existsSync(candidate)) return candidate;
  }
  return "claude";
}

function wellKnownClaudeCandidates(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const home = env.USERPROFILE ?? env.HOME;
  const push = (value: string | undefined) => {
    if (value) out.push(value);
  };
  if (process.platform === "win32") {
    if (home) {
      push(join(home, ".claude", "bin", "claude.exe"));
      push(join(home, ".claude", "bin", "claude.cmd"));
      push(join(home, ".local", "bin", "claude.exe"));
    }
    if (env.APPDATA) {
      push(join(env.APPDATA, "npm", "claude.cmd"));
      push(join(env.APPDATA, "npm", "claude.exe"));
    }
    if (env.LOCALAPPDATA) {
      push(join(env.LOCALAPPDATA, "Programs", "claude", "claude.exe"));
      push(join(env.LOCALAPPDATA, "npm", "claude.cmd"));
    }
  } else if (home) {
    push(join(home, ".claude", "bin", "claude"));
    push(join(home, "bin", "claude"));
    push(join(home, ".local", "bin", "claude"));
    push(join(home, ".bun", "bin", "claude"));
    push(join(home, ".bun", "install", "global", "bin", "claude"));
    push(join(home, ".npm-global", "bin", "claude"));
    push(join(home, ".codex-ultra", "bin", "claude"));
  }
  push("/usr/local/bin/claude");
  push("/usr/bin/claude");
  push("/tools/node/bin/claude");
  push("/opt/homebrew/bin/claude");
  push("/home/linuxbrew/.linuxbrew/bin/claude");
  if (env.npm_config_prefix) push(join(env.npm_config_prefix, "bin", "claude"));
  if (env.NVM_BIN?.trim()) push(join(env.NVM_BIN.trim(), "claude"));
  return out;
}

export function compareClaudeVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Value for the CLI's `ANTHROPIC_CUSTOM_HEADERS` env var (curl-style
 * `Name: Value` lines). Carries the owning thread id for live relay/group
 * resolution, a stable per-conversation `x-opencode-session` for OpenCode
 * routing/prompt-cache affinity (UUID format — the gateway falls back to the
 * raw thread id when this is absent, which strict opencode upstreams reject),
 * and the backend hint for per-backend User-Agent attribution.
 * Returns `undefined` before the first `thread/start` when no thread exists.
 */
export function buildClaudeRelayCustomHeaders(
  threadId: string | undefined,
): string | undefined {
  const id = threadId?.trim();
  if (!id) return undefined;
  return [
    `thread-id: ${id}`,
    `x-opencode-session: ${deriveOpenCodeSessionId(id)}`,
    `${OPENCODE_CLI_BACKEND_HEADER}: claude`,
  ].join("\n");
}

export interface ClaudeLaunchSpec {
  command: string;
  args: string[];
  /** Extra environment the launcher needs (e.g. Electron-as-Node). */
  env: Record<string, string>;
}

/** Basenames of executables that can run a `.js`/`.mjs`/`.cjs` file directly. */
const JS_RUNTIME_BASENAMES = new Set([
  "node",
  "node.exe",
  "bun",
  "bun.exe",
  "bun-debug",
  "bun-debug.exe",
]);

/**
 * `process.execPath` is only a JavaScript runtime when the server itself runs on
 * one. In the packaged products it does not:
 *   - cxu standalone: `~/.cxu/server/<version>/codex-standalone.exe` (Bun)
 *   - desktop shell:  `Codex Ultra.exe` / `electron.exe`
 * Handing such a path a script argument does NOT execute the script — Bun
 * re-enters the embedded workbench (which then dies with EADDRINUSE because the
 * real server already owns the port, surfacing as a bare "exited with code 1"),
 * and Electron opens it as an app instead. Always resolve a real runtime for
 * JavaScript CLI bundles.
 */
function isJavaScriptRuntimeExecutable(command: string | undefined | null): boolean {
  if (!command) return false;
  return JS_RUNTIME_BASENAMES.has(basename(command).toLowerCase());
}

/**
 * Packaged shells that embed Chromium/Node but are not JS runtimes.
 * `productName` is "Codex Ultra", so the artifact is `Codex Ultra.exe`;
 * compare on a normalized form so both the spaced and hyphenated spellings
 * match.
 */
const HOST_SHELL_BASENAMES = new Set(["electron", "codexultra", "codexultradesktop"]);

function isElectronShell(command: string | undefined | null): boolean {
  if (!command) return false;
  const base = basename(command).toLowerCase().replace(/\.exe$/, "");
  return HOST_SHELL_BASENAMES.has(base.replace(/[^a-z0-9]/g, ""));
}

function pathEnvCandidates(env: NodeJS.ProcessEnv, names: string[]): string[] {
  const raw = (env.PATH ?? env.Path ?? env.path ?? "").split(delimiter);
  const out: string[] = [];
  for (const dir of raw) {
    const trimmed = dir.trim().replace(/^"|"$/g, "");
    if (!trimmed) continue;
    for (const name of names) out.push(join(trimmed, name));
  }
  return out;
}

function wellKnownJavaScriptRuntimeCandidates(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const push = (value: string | undefined) => {
    if (value) out.push(value);
  };
  const home = env.USERPROFILE ?? env.HOME;
  if (process.platform === "win32") {
    for (const name of ["node.exe", "bun.exe"]) {
      push(env.ProgramFiles ? join(env.ProgramFiles, "nodejs", name) : undefined);
      push(env["ProgramFiles(x86)"] ? join(env["ProgramFiles(x86)"]!, "nodejs", name) : undefined);
      push(env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "nodejs", name) : undefined);
      push(env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Volta", "bin", name) : undefined);
      if (home) push(join(home, "scoop", "apps", "nodejs", "current", name));
      if (home) push(join(home, ".bun", "bin", name));
    }
    // nvm-windows keeps one directory per version behind NVM_HOME/NVM_SYMLINK.
    const nvmHome = env.NVM_HOME?.trim();
    if (nvmHome) {
      push(join(nvmHome, env.NVM_SYMLINK?.trim() ?? "", "node.exe"));
      try {
        for (const entry of readdirSync(nvmHome, { withFileTypes: true })) {
          if (entry.isDirectory()) push(join(nvmHome, entry.name, "node.exe"));
        }
      } catch {
        // A missing or unreadable NVM_HOME is not fatal; PATH still applies.
      }
    }
    if (home) push(join(home, "AppData", "Roaming", "nvm", "current", "node.exe"));
  } else {
    push("/usr/local/bin/node");
    push("/usr/bin/node");
    push("/opt/homebrew/bin/node");
    push("/home/linuxbrew/.linuxbrew/bin/node");
    push("/usr/local/bin/bun");
    push("/usr/bin/bun");
    push(env.NVM_BIN?.trim() ? join(env.NVM_BIN.trim(), "node") : undefined);
    if (home) push(join(home, ".bun", "bin", "bun"));
    if (home) push(join(home, ".volta", "bin", "node"));
    if (home) push(join(home, ".local", "bin", "node"));
  }
  return out;
}

/**
 * Resolve an executable able to run a JavaScript CLI bundle.
 *
 * Explicit override first, then the current process when it *is* a runtime
 * (`bun run` / `node` dev servers), then well-known installs, then PATH.
 * Electron is accepted last with `ELECTRON_RUN_AS_NODE=1`, which is the only
 * documented way to make the shell execute a script.
 */
export function resolveJavaScriptRuntime(
  env: NodeJS.ProcessEnv = process.env,
  hostExecPath: string = process.execPath,
): ClaudeLaunchSpec {
  const configured = (env.CODEX_UI_NODE_BIN?.trim() || env.NODE_BIN?.trim() || "");
  if (configured && existsSync(configured)) {
    return { command: configured, args: [], env: {} };
  }
  if (isJavaScriptRuntimeExecutable(hostExecPath)) {
    return { command: hostExecPath, args: [], env: {} };
  }
  // `npm_execpath`/`npm_node_execpath` are set when the server was started
  // through npm and point at the exact Node build that launched it.
  const npmNode = env.npm_node_execpath?.trim();
  if (isJavaScriptRuntimeExecutable(npmNode) && existsSync(npmNode!)) {
    return { command: npmNode!, args: [], env: {} };
  }
  for (const candidate of [...wellKnownJavaScriptRuntimeCandidates(env), ...pathEnvCandidates(env, ["node.exe", "node", "bun.exe", "bun"])]) {
    if (!isJavaScriptRuntimeExecutable(candidate)) continue;
    if (!existsSync(candidate)) continue;
    return { command: candidate, args: [], env: {} };
  }
  if (isElectronShell(hostExecPath)) {
    return { command: hostExecPath, args: [], env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  logClaudeSpawnEvent("warn", "js-runtime-unresolved", {
    execPath: basename(hostExecPath),
    hasExplicitOverride: Boolean(configured),
  });
  // Let PATH/cmd resolution surface the failure with its own diagnostic.
  return { command: "node", args: [], env: {} };
}

/** Launch JavaScript CLI bundles through a real Node/Bun runtime. */
export function resolveClaudeLaunch(
  command: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): ClaudeLaunchSpec {
  const extension = extname(command).toLowerCase();
  if (extension === ".mjs" || extension === ".js" || extension === ".cjs") {
    const runtime = resolveJavaScriptRuntime(env);
    return { command: runtime.command, args: [command, ...args], env: runtime.env };
  }
  return { command, args, env: {} };
}

export function spawnClaudeCommand(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
): ChildProcessWithoutNullStreams {
  // Windows reports a missing spawn cwd as `uv_spawn cmd.exe ENOENT`, which
  // is indistinguishable from a missing binary. The cxu Bun standalone
  // server changed the process cwd (homedir) vs the old Electron wrapper,
  // so a stale/deleted workspace path now reaches spawn. Create it first so
  // a new Claude thread never dies with a bare ENOENT.
  let spawnOptions = options;
  if (typeof options.cwd === "string" && options.cwd.trim().length > 0) {
    try {
      const cwd = ensureClaudeSpawnCwd(options.cwd);
      if (cwd !== options.cwd) spawnOptions = { ...options, cwd };
    } catch (error) {
      logClaudeSpawnEvent("error", "ensure-cwd-failed", {
        bin: command,
        cwd: options.cwd,
        ...errnoDetails(error),
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  // The Bun standalone runtime inherits a slimmer environment than the old
  // Electron wrapper; without an absolute ComSpec the cmd.exe shim is the
  // first thing to fail. `resolveCodexSpawn` already prefers an absolute
  // path, but the child env itself must also carry it.
  if (process.platform === "win32") {
    const childEnv = { ...((spawnOptions.env as NodeJS.ProcessEnv | undefined) ?? process.env) } as NodeJS.ProcessEnv;
    if (!childEnv.ComSpec && !childEnv.COMSPEC) {
      childEnv.ComSpec = process.env.ComSpec || process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
      logClaudeSpawnEvent("warn", "comspec-injected", {
        bin: command,
        cwd: typeof spawnOptions.cwd === "string" ? spawnOptions.cwd : undefined,
        injected: childEnv.ComSpec,
        comSpecExists: existsSync(childEnv.ComSpec),
      });
    }
    if (!childEnv.SystemRoot && !childEnv.SYSTEMROOT && process.env.SystemRoot) {
      childEnv.SystemRoot = process.env.SystemRoot;
    }
    spawnOptions = { ...spawnOptions, env: childEnv };
  }
  const launch = resolveClaudeLaunch(command, args, (spawnOptions.env as NodeJS.ProcessEnv | undefined) ?? process.env);
  // A JS bundle needs its runtime (and, under Electron, ELECTRON_RUN_AS_NODE)
  // in the child env, not just on the command line.
  if (Object.keys(launch.env).length > 0) {
    const childEnv = { ...((spawnOptions.env as NodeJS.ProcessEnv | undefined) ?? process.env) } as NodeJS.ProcessEnv;
    for (const [key, value] of Object.entries(launch.env)) childEnv[key] = value;
    spawnOptions = { ...spawnOptions, env: childEnv };
  }
  const resolved = pluginHostServices().codex.resolveCodexSpawn(
    launch.command,
    launch.args,
    process.platform,
    (spawnOptions.env as NodeJS.ProcessEnv | undefined) ?? process.env,
  );
  {
    const spawnCwd = typeof spawnOptions.cwd === "string" ? spawnOptions.cwd : undefined;
    const childEnv = (spawnOptions.env as NodeJS.ProcessEnv | undefined) ?? process.env;
    const comSpec = childEnv.ComSpec || childEnv.COMSPEC;
    let cwdExists: boolean | undefined;
    let cwdIsDirectory: boolean | undefined;
    if (spawnCwd) {
      try {
        cwdIsDirectory = statSync(spawnCwd).isDirectory();
        cwdExists = true;
      } catch (error) {
        cwdExists = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? false : undefined;
        if (cwdExists === undefined) {
          logClaudeSpawnEvent("error", "cwd-stat-failed", {
            bin: command,
            cwd: spawnCwd,
            ...errnoDetails(error),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    const binExists = /[/\\]/.test(launch.command) ? existsSync(launch.command) : undefined;
    logClaudeSpawnEvent("log", "spawn-attempt", {
      bin: command,
      launchCommand: launch.command,
      resolvedCommand: resolved.command,
      usesCommandShim: resolved.usesCommandShim,
      cwd: spawnCwd,
      cwdExists,
      cwdIsDirectory,
      binExists,
      comSpec,
      comSpecExists: typeof comSpec === "string" ? existsSync(comSpec) : undefined,
      hasSystemRoot: Boolean(childEnv.SystemRoot || childEnv.SYSTEMROOT),
      argCount: launch.args.length,
    });
  }
  try {
    const child = spawn(resolved.command, resolved.args, {
      ...spawnOptions,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: process.platform === "win32",
      ...(resolved.usesCommandShim ? { windowsVerbatimArguments: true } : {}),
    });
    // Async libuv failures (the classic `uv_spawn cmd.exe ENOENT`) arrive on
    // `error`, not via the try/catch above. Log them at the source so a turn
    // never degrades into an anonymous relay timeout downstream.
    child.once("error", (error) => {
      logClaudeSpawnEvent("error", "spawn-error-event", {
        bin: command,
        resolvedCommand: resolved.command,
        usesCommandShim: resolved.usesCommandShim,
        cwd: typeof spawnOptions.cwd === "string" ? spawnOptions.cwd : undefined,
        pid: child.pid ?? null,
        ...errnoDetails(error),
        message: error instanceof Error ? error.message : String(error),
      });
    });
    child.once("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        logClaudeSpawnEvent("warn", "spawn-early-exit", {
          bin: command,
          resolvedCommand: resolved.command,
          cwd: typeof spawnOptions.cwd === "string" ? spawnOptions.cwd : undefined,
          pid: child.pid ?? null,
          code,
          signal: signal ?? null,
        });
      }
    });
    logClaudeSpawnEvent("log", "spawn-ok", {
      bin: command,
      resolvedCommand: resolved.command,
      cwd: typeof spawnOptions.cwd === "string" ? spawnOptions.cwd : undefined,
      pid: child.pid ?? null,
    });
    return child;
  } catch (error) {
    // Attach the cwd/bin so the next `uv_spawn ... ENOENT` names its cause
    // instead of surfacing as an anonymous relay/turn timeout downstream.
    const detail = typeof spawnOptions.cwd === "string" ? ` cwd="${spawnOptions.cwd}"` : "";
    const message = error instanceof Error ? error.message : String(error);
    logClaudeSpawnEvent("error", "spawn-sync-throw", {
      bin: command,
      resolvedCommand: resolved.command,
      usesCommandShim: resolved.usesCommandShim,
      cwd: typeof spawnOptions.cwd === "string" ? spawnOptions.cwd : undefined,
      ...errnoDetails(error),
      message,
    });
    throw new Error(`Failed to spawn Claude CLI (bin="${command}"${detail}): ${message}`);
  }
}

/**
 * Probe whether the official Claude CLI is installed and get its version.
 * Uses --version which is safe and does not start a session.
 */
export function probeClaudeCli(env: NodeJS.ProcessEnv = process.env): ClaudeCliProbeResult {
  return probeClaudeCliCommand(findClaudeBin(env), env);
}

/** Probe an explicit Claude-compatible launcher without applying CLI selection state. */
export function probeClaudeCliCommand(bin: string, env: NodeJS.ProcessEnv = process.env): ClaudeCliProbeResult {

  try {
    const launch = resolveClaudeLaunch(bin, ["--version"], env);
    const resolved = pluginHostServices().codex.resolveCodexSpawn(
      launch.command,
      launch.args,
      process.platform,
      env,
    );
    const output = execFileSync(resolved.command, resolved.args, {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...env, ...launch.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...(resolved.usesCommandShim ? { windowsVerbatimArguments: true } : {}),
    }).trim();

    // Parse version from output like "2.1.222 (Claude Code)"
    const match = output.match(/(\d+\.\d+\.\d+)/) ?? output.match(/(\d+\.\d+)/);
    const version = match ? match[1] : undefined;

    if (!version) {
      return { available: false, binPath: bin, error: "Could not parse Claude CLI version from: " + output };
    }

    return { available: true, version, binPath: bin };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logClaudeSpawnEvent("warn", "probe-failed", {
      bin,
      ...errnoDetails(error),
      message,
    });
    return {
      available: false,
      binPath: bin,
      error: message,
    };
  }
}

/**
 * Build a safe environment for the Claude CLI process.
 * Strips Codex-specific relay and credential variables.
 */
/**
 * Environment variables that must never be passed to a Claude CLI process.
 * These are Codex-specific relay and configuration values.
 */
const BLOCKED_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "RELAY_GATEWAY_TOKEN",
  "CODEX_UI_RELAY_GATEWAY_TOKEN",
  "CODEX_ULTRA_RELAY_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_UNIX_SOCKET",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_FOUNDRY_BASE_URL",
] as const;

export function buildSafeClaudeEnv(
  baseEnv: NodeJS.ProcessEnv,
  overrides: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...baseEnv };

  for (const key of BLOCKED_ENV_KEYS) {
    delete env[key];
  }

  // Linux: Claude CLI refuses `--dangerously-skip-permissions` when running as root
  // unless IS_SANDBOX is exactly "1". Set it on the child only (never globally) so
  // the root check passes for codex-ultra-spawned sessions. Caller overrides still win.
  if (process.platform === "linux") {
    env.IS_SANDBOX = "1";
  }

  // Apply safe overrides
  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }

  return env;
}

/**
 * Validate that a workspace path is safe for the Claude process.
 * Must be absolute and must exist.
 */
export function validateClaudeWorkspace(cwd: string): { valid: boolean; error?: string } {
  if (!cwd || typeof cwd !== "string") {
    return { valid: false, error: "Workspace path is required" };
  }

  const resolved = resolve(cwd);
  if (!existsSync(resolved)) {
    return { valid: false, error: "Workspace path does not exist: " + resolved };
  }

  return { valid: true };
}

/**
 * Ensure the workspace directory for a Claude child process exists.
 * Returns the path to spawn with. Creates missing directories (recursive);
 * throws a cwd-naming error when the path is a file or cannot be created,
 * so callers fail fast instead of hitting `uv_spawn cmd.exe ENOENT`.
 */
export function ensureClaudeSpawnCwd(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) {
    logClaudeSpawnEvent("error", "ensure-cwd-empty", { cwd });
    throw new Error("Claude workspace path is required (cwd is empty)");
  }
  try {
    const stats = statSync(trimmed);
    if (!stats.isDirectory()) {
      logClaudeSpawnEvent("error", "ensure-cwd-not-directory", { cwd: trimmed });
      throw new Error(`Claude workspace is not a directory: ${trimmed}`);
    }
    return trimmed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      // A non-ENOENT stat failure (EPERM, ENOTDIR, …) already names the cause;
      // log the errno fields so plasmas like `uv_spawn cmd.exe ENOENT` can be
      // ruled in/out without guessing.
      if (error instanceof Error && error.message.startsWith("Claude workspace is not a directory")) throw error;
      logClaudeSpawnEvent("error", "ensure-cwd-stat-failed", {
        cwd: trimmed,
        ...errnoDetails(error),
        message: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error ? error : new Error(`Cannot use Claude workspace ${trimmed}: ${String(error)}`);
    }
    try {
      mkdirSync(trimmed, { recursive: true });
      logClaudeSpawnEvent("warn", "ensure-cwd-created", { cwd: trimmed });
      return trimmed;
    } catch (mkdirError) {
      const message = mkdirError instanceof Error ? mkdirError.message : String(mkdirError);
      logClaudeSpawnEvent("error", "ensure-cwd-mkdir-failed", {
        cwd: trimmed,
        ...errnoDetails(mkdirError),
        message,
      });
      throw new Error(`Claude workspace does not exist and could not be created: ${trimmed}: ${message}`);
    }
  }
}

/**
 * Thread-creation gate for a Claude workspace path.
 * Gives the previously unreferenced `validateClaudeWorkspace` a job:
 * valid paths pass through, phantom paths are created now (so `thread/start`
 * owns the directory before the first spawn), and file-blocked paths throw
 * a cwd-naming error before any child is attempted.
 * SSH threads use remote paths — never touch the local filesystem for those.
 * Spawn-time `ensureClaudeSpawnCwd` stays as the second layer for workspaces
 * that go stale after creation (e.g. deleted across a server restart).
 */
export function prepareClaudeThreadCwd(cwd: string | undefined, opts?: { ssh?: boolean }): string | undefined {
  if (!cwd || !cwd.trim() || opts?.ssh) return cwd;
  const check = validateClaudeWorkspace(cwd);
  if (check.valid) return cwd;
  if (/not a directory/i.test(check.error ?? "")) {
    throw new Error(check.error);
  }
  return ensureClaudeSpawnCwd(cwd);
}

/**
 * Whether this Claude CLI build accepts `--effort`.
 * v1.0.123-era CLIs exit(1) with `unknown option '--effort'`, which surfaced
 * downstream as an anonymous spawn/relay failure while the real cause hid in
 * stderr. Probe `--help` once per bin (5min TTL); fail closed so an
 * unprovable CLI still boots instead of dying on an unparsable flag.
 */
const EFFORT_SUPPORT_CACHE_TTL_MS = 5 * 60_000;
const effortSupportCache = new Map<string, { at: number; ok: boolean }>();

export function claudeCliSupportsEffort(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!bin?.trim()) return false;
  const cached = effortSupportCache.get(bin);
  if (cached && Date.now() - cached.at < EFFORT_SUPPORT_CACHE_TTL_MS) return cached.ok;
  let ok = false;
  try {
    const launch = resolveClaudeLaunch(bin, ["--help"], env);
    const resolved = pluginHostServices().codex.resolveCodexSpawn(launch.command, launch.args, process.platform, env);
    const output = execFileSync(resolved.command, resolved.args, {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...env, ...launch.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...(resolved.usesCommandShim ? { windowsVerbatimArguments: true } : {}),
    });
    ok = /(^|\s)--effort(\s|=|$)/m.test(String(output));
  } catch (error) {
    logClaudeSpawnEvent("warn", "effort-probe-failed", {
      bin,
      ...errnoDetails(error),
      message: error instanceof Error ? error.message : String(error),
    });
    ok = false;
  }
  effortSupportCache.set(bin, { at: Date.now(), ok });
  if (!ok) logClaudeSpawnEvent("warn", "effort-unsupported", { bin });
  return ok;
}

/**
 * Background `--help` probe that warms the effort-support cache without
 * blocking the event loop. Cold `thread/start` + first `turn/start` must
 * never wait up to 10s on `execFileSync` (Windows `claude.ps1` shim + Node
 * startup); the first turn omits `--effort` and backfills the budget via
 * `set_max_thinking_tokens` instead.
 */
export function warmClaudeEffortSupport(bin: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!bin?.trim()) return;
  const cached = effortSupportCache.get(bin);
  if (cached && Date.now() - cached.at < EFFORT_SUPPORT_CACHE_TTL_MS) return;
  try {
    const launch = resolveClaudeLaunch(bin, ["--help"], env);
    const resolved = pluginHostServices().codex.resolveCodexSpawn(launch.command, launch.args, process.platform, env);
    execFile(resolved.command, resolved.args, {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...env, ...launch.env },
      windowsHide: true,
      ...(resolved.usesCommandShim ? { windowsVerbatimArguments: true } : {}),
    } as never, (error: unknown, stdout: unknown) => {
      const ok = !error && /(^|\s)--effort(\s|=|$)/m.test(String(stdout ?? ""));
      effortSupportCache.set(bin, { at: Date.now(), ok });
      if (!ok) logClaudeSpawnEvent("warn", "effort-unsupported", { bin });
    });
  } catch {
    // Fire-and-forget: a warmer failure must never break startup.
  }
}

/**
 * Keep a reasoning effort only when the CLI can parse it.
 * Returns the effort to pass to `buildClaudeSpawnArgs`, or `undefined` when
 * it must be omitted so startup survives older CLIs.
 *
 * Cold start is non-blocking: on a cache miss the flag is omitted (the turn
 * backfills the budget via `set_max_thinking_tokens`) and an async probe
 * warms the cache for the next child generation.
 */
export function resolveClaudeEffortForCli(
  bin: string,
  effort: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const normalized = sanitizeClaudeCliEffort(effort);
  if (!normalized) return undefined;
  const cached = effortSupportCache.get(bin);
  if (cached && Date.now() - cached.at < EFFORT_SUPPORT_CACHE_TTL_MS) {
    if (cached.ok) return normalized;
    logClaudeSpawnEvent("warn", "effort-omitted", { bin, effort: normalized });
    return undefined;
  }
  warmClaudeEffortSupport(bin, env);
  logClaudeSpawnEvent("warn", "effort-omitted-cold", { bin, effort: normalized });
  return undefined;
}

/**
 * Map Codex Ultra permission preset to Claude permission mode.
 */
export function mapPermissionMode(sandbox: string, approvalPolicy: string): string {
  const normalizedSandbox = sandbox.replace(/[-_]/g, "").toLowerCase();
  if (approvalPolicy === "never" || normalizedSandbox === "dangerfullaccess") {
    return "bypassPermissions";
  }
  if (normalizedSandbox === "readonly") {
    return "plan";
  }
  return "default";
}

/**
 * Effort levels the installed Claude CLI accepts on `--effort`
 * (verified against claude 2.1.276 `--help`: low, medium, high, xhigh, max).
 * `max` is Opus-only upstream — most relay models reject it with a 400 that
 * burns the first turn in key-failover retries — so the UI `ultra` alias
 * clamps to `xhigh`, never `max`.
 */
export const CLAUDE_CLI_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

export function sanitizeClaudeCliEffort(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "none") return undefined;
  const level = normalized === "ultra" ? "xhigh" : normalized;
  return CLAUDE_CLI_EFFORT_LEVELS.has(level) ? level : undefined;
}

/**
 * Build the spawn args for a Claude CLI stream-json session.
 */
export function buildClaudeSpawnArgs(
  model?: string,
  permissionMode?: string,
  resumeSessionId?: string,
  reasoningEffort?: string,
): string[] {
  const args = [
    "--print",
    "--verbose",
    "--input-format=stream-json",
    "--output-format=stream-json",
    "--include-partial-messages",
  ];

  if (model && model.length > 0) {
    args.push("--model", model);
  }

  if (resumeSessionId && resumeSessionId.length > 0) {
    args.push("--resume", resumeSessionId);
  }

  const effort = sanitizeClaudeCliEffort(reasoningEffort);
  if (effort) {
    args.push("--effort", effort);
  }

  if (permissionMode && permissionMode !== "default") {
    args.push("--permission-mode", permissionMode);
  }

  if (permissionMode === "bypassPermissions") {
    args.push("--dangerously-skip-permissions");
  }

  return args;
}

/**
 * The Claude CLI stores one project directory per workspace, named after the
 * workspace path with every non-alphanumeric character replaced by a hyphen.
 * Paths longer than the CLI's limit get a hash suffix we deliberately do not
 * reproduce — those resolve to `null` so callers treat them as unknown.
 */
const MAX_CLAUDE_PROJECT_DIR_LENGTH = 200;

export function claudeProjectDirName(cwd: string): string | null {
  const sanitized = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  return sanitized.length <= MAX_CLAUDE_PROJECT_DIR_LENGTH ? sanitized : null;
}

/**
 * Whether `--resume <sessionId>` can still find its transcript.
 *
 * `claude --print --resume` reads `<config dir>/projects/<workspace>/<id>.jsonl`
 * and aborts with "No conversation found with session ID" when the file is
 * gone, which leaves a reopened thread unable to take another turn. Returns
 * `undefined` when the answer cannot be determined (no managed config dir, a
 * hashed project directory name, or an unreadable directory) so callers keep
 * the resume attempt instead of guessing.
 */
export function claudeTranscriptExists(
  configDir: string | undefined,
  cwd: string,
  sessionId: string
): boolean | undefined {
  if (!configDir || !sessionId) return undefined;
  const projectsDir = join(configDir, "projects");
  const projectDirName = claudeProjectDirName(cwd);
  if (!projectDirName) return undefined;
  if (existsSync(join(projectsDir, projectDirName, sessionId + ".jsonl"))) return true;
  // The workspace path the CLI recorded can differ from the one we spawn with
  // (symlinks, drive-letter casing). Treat a transcript found under any
  // project directory as present rather than discarding a resumable session.
  try {
    return readdirSync(projectsDir, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() && existsSync(join(projectsDir, entry.name, sessionId + ".jsonl"))
    );
  } catch {
    return existsSync(projectsDir) ? undefined : false;
  }
}
