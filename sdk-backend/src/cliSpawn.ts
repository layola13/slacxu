import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptions, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Windows-safe CLI spawning for external agent CLIs.
 *
 * npm-installed CLIs land on Windows as `.cmd` / `.bat` / `.ps1` shim
 * scripts, and Node/Bun refuse to spawn those directly (EINVAL since the
 * BatBadBut hardening). `resolveCliSpawn` rewrites such invocations the
 * same way the Codex backend has always done it: batch shims run through
 * an absolute `cmd.exe` (`call "<cmd>" <args>` with cmd quoting),
 * PowerShell shims through `powershell.exe -File`. Everything else —
 * real executables, `.exe`, and every non-Windows platform — passes
 * through untouched.
 *
 * This resolver is a pure function of (command, args, platform, env) plus
 * an existence probe for the ComSpec candidates, so it lives in the SDK:
 * every backend plugin spawns its external CLI through here instead of
 * re-implementing (or forgetting) the Windows shim rules.
 */
export function resolveCliSpawn(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[]; usesCommandShim: boolean } {
  if (platform === "win32" && /\.ps1$/i.test(command)) {
    return {
      command: resolveWindowsPowerShell(env),
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", command, ...args],
      usesCommandShim: true,
    };
  }
  const usesCommandShim = platform === "win32" && (/\.(cmd|bat)$/i.test(command) || (!command.includes("/") && !command.includes("\\")));
  if (!usesCommandShim) {
    return { command, args, usesCommandShim: false };
  }
  // Bun-compiled standalone servers resolve a bare "cmd.exe" less reliably
  // than Node, and a bare name makes `uv_spawn cmd.exe ENOENT` ambiguous
  // (missing cwd vs missing binary). Always prefer an absolute System32
  // path so the error — if any — points at the real cause.
  const comSpec = resolveWindowsComSpec(env);
  const invocation = [quoteCmdArgument(command), ...args.map(quoteCmdArgument)].join(" ");
  return {
    command: comSpec,
    args: ["/d", "/s", "/c", `call ${invocation}`],
    usesCommandShim: true,
  };
}

/** Absolute cmd.exe path for the Windows command shim. Never a bare name. */
export function resolveWindowsComSpec(env: NodeJS.ProcessEnv = process.env): string {
  const candidates: Array<string | undefined> = [
    env.ComSpec,
    env.COMSPEC,
    env.SystemRoot ? `${env.SystemRoot}\\System32\\cmd.exe` : undefined,
    env.SYSTEMROOT ? `${env.SYSTEMROOT}\\System32\\cmd.exe` : undefined,
    process.env.ComSpec,
    process.env.COMSPEC,
    "C:\\Windows\\System32\\cmd.exe",
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // Fall through to the next candidate.
    }
  }
  return env.ComSpec || env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
}

/** Absolute powershell.exe path; falls back to the bare name when absent. */
export function resolveWindowsPowerShell(env: NodeJS.ProcessEnv = process.env): string {
  const candidates: Array<string | undefined> = [
    env.SystemRoot ? `${env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : undefined,
    env.SYSTEMROOT ? `${env.SYSTEMROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : undefined,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // Fall through to the next candidate.
    }
  }
  return "powershell.exe";
}

function quoteCmdArgument(value: string): string {
  if (!value) return '""';
  if (/[\s&^|()<>%]/.test(value)) {
    return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
  }
  return value;
}

/**
 * Spawn an external CLI, applying `resolveCliSpawn` first. With a command
 * shim, the child runs under cmd.exe with verbatim arguments (without
 * that, Node/Bun turn the quotes inside the `/c` string into literal `\"`
 * characters and cmd.exe looks for a file whose name includes quotes —
 * the classic failure when npm lives under "Program Files"). PowerShell
 * launchers still need normal argv quoting, hence the `.ps1` exception.
 */
export function spawnCli(command: string, args: string[], options: SpawnOptions = {}): ChildProcessWithoutNullStreams {
  const resolved = resolveCliSpawn(command, args, process.platform, (options.env as NodeJS.ProcessEnv | undefined) ?? process.env);
  if (!resolved.usesCommandShim) {
    return spawn(resolved.command, resolved.args, {
      ...options,
      windowsHide: options.windowsHide ?? process.platform === "win32",
    }) as ChildProcessWithoutNullStreams;
  }
  return spawn(resolved.command, resolved.args, {
    ...options,
    windowsHide: true,
    windowsVerbatimArguments: !/\.ps1$/i.test(command),
  }) as ChildProcessWithoutNullStreams;
}

/** Synchronous variant of `spawnCli`, for short version probes. */
export function spawnCliSync(
  command: string,
  args: string[],
  options: SpawnSyncOptions = {},
): SpawnSyncReturns<string> {
  const resolved = resolveCliSpawn(command, args, process.platform, (options.env as NodeJS.ProcessEnv | undefined) ?? process.env);
  if (!resolved.usesCommandShim) {
    return spawnSync(resolved.command, resolved.args, options) as SpawnSyncReturns<string>;
  }
  return spawnSync(resolved.command, resolved.args, {
    ...options,
    windowsVerbatimArguments: !/\.ps1$/i.test(command),
  }) as SpawnSyncReturns<string>;
}
