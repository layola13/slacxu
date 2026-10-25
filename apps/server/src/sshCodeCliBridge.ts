import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { promisify } from "node:util";
import {
  detectRemoteOs,
  expandRemoteHome,
  powershellEncodedCommand,
  quote,
  quotePowerShell,
  quoteRemotePath,
  splitSshCommand,
  type RemoteOs,
  type SshWorkspaceProfile
} from "../../../backends/codex/src/runtime/sshCodexBridge.js";

const execFileAsync = promisify(execFile);

/** Official Claude CLI installers, used when the SSH host has no `claude` binary. */
export const CLAUDE_POSIX_INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";
export const CLAUDE_WINDOWS_INSTALL_COMMAND = "irm https://claude.ai/install.ps1 | iex";

/**
 * Candidate `claude` locations, ordered from most to least specific. A
 * non-interactive SSH shell often skips the profile that adds ~/.local/bin to
 * PATH — which is where the official installer drops the binary — so the
 * documented install locations are probed explicitly, with a login shell as the
 * last resort for CLIs installed under a version manager (nvm, bun).
 */
export const CLAUDE_POSIX_CANDIDATES = [
  "\"$(command -v claude 2>/dev/null || true)\"",
  "\"$HOME/.local/bin/claude\"",
  "\"$HOME/.claude/local/claude\"",
  "\"/usr/local/bin/claude\"",
  "\"/opt/homebrew/bin/claude\"",
  "\"$HOME/.bun/bin/claude\"",
  "\"$(bash -lc 'command -v claude' 2>/dev/null || true)\""
].join(" ");

/**
 * Environment values that may cross the SSH boundary. Everything else stays on
 * this machine: local config directories, Codex relay credentials, and the
 * host's PATH are meaningless (or unsafe) on the remote host.
 */
const FORWARDED_ENV_KEYS = ["ANTHROPIC_BASE_URL", "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST"] as const;
/** Handed to the remote shell through stdin so it never appears in remote `ps` output. */
const STDIN_ENV_KEY = "ANTHROPIC_API_KEY";

const PROBE_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const MAX_REMOTE_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Without an explicit deadline the SSH client waits out the kernel's TCP
 * timeout, so an unreachable host burns the whole `execFile` budget before the
 * caller learns anything. Every probe pays this on a latency-sensitive RPC.
 */
export const SSH_CONNECT_ARGS = ["-o", "ConnectTimeout=15"] as const;

export type RemoteClaudeCli = { binPath: string; version: string | null; installed: boolean };
export type RemoteClaudeTarget = { sshArgs: string[]; remoteOs: RemoteOs; cli: RemoteClaudeCli };
export type RunRemoteCommand = (args: string[], remoteCommand: string, timeoutMs: number) => Promise<{ stdout: string; stderr: string }>;
export type DetectRemoteOs = (sshArgs: string[]) => Promise<RemoteOs>;
export type SpawnProcess = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

export type SshCodeCliLauncherOptions = {
  /** Local Codex Ultra HTTP port that the remote relay-gateway tunnel points back at. */
  localServerPort: number;
  /** Allocates the remote listen port for one reverse tunnel. Every child needs its own. */
  allocateRemotePort: () => number;
  /** Install the Claude CLI when the SSH host does not have one. Defaults to true. */
  installIfMissing?: boolean;
  onProgress?: (message: string) => void;
  runRemote?: RunRemoteCommand;
  detectOs?: DetectRemoteOs;
  spawnProcess?: SpawnProcess;
};

export type RemoteClaudeCommandInput = {
  remoteOs: RemoteOs;
  cwd: string;
  binPath: string;
  args: string[];
  env: Record<string, string>;
  readSecretFromStdin: boolean;
};

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function defaultRunRemote(args: string[], remoteCommand: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("ssh", [...SSH_CONNECT_ARGS, ...args, remoteCommand], { timeout: timeoutMs, maxBuffer: MAX_REMOTE_OUTPUT_BYTES });
  return { stdout: String(stdout), stderr: String(stderr) };
}

/** Remote script that reports an executable Claude CLI, or exits 3 when there is none. */
export function remoteClaudeProbeScript(remoteOs: RemoteOs): string {
  if (remoteOs === "windows") {
    return powershellEncodedCommand([
      "$ErrorActionPreference = 'SilentlyContinue'",
      "$found = Get-Command claude -ErrorAction SilentlyContinue",
      "if (-not $found) { foreach ($candidate in @((Join-Path $env:USERPROFILE '.local\\bin\\claude.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\\claude\\claude.exe'))) { if (Test-Path -LiteralPath $candidate) { $found = Get-Command $candidate -ErrorAction SilentlyContinue; break } } }",
      "if (-not $found) { exit 3 }",
      "$version = (& $found.Source --version 2>$null | Select-Object -First 1)",
      "Write-Output ('CLAUDE_BIN=' + $found.Source)",
      "Write-Output ('CLAUDE_VERSION=' + $version)"
    ].join("; "));
  }
  return [
    "for candidate in " + CLAUDE_POSIX_CANDIDATES,
    "do [ -n \"$candidate\" ] || continue",
    "[ -x \"$candidate\" ] || continue",
    "printf 'CLAUDE_BIN=%s\\n' \"$candidate\"",
    "printf 'CLAUDE_VERSION=%s\\n' \"$(\"$candidate\" --version 2>/dev/null | head -n 1)\"",
    "exit 0",
    "done",
    "exit 3"
  ].join("; ");
}

/**
 * Reports the same candidates as {@link remoteClaudeProbeScript} as
 * `claudePath=`/`claudeVersion=` lines, for callers that batch several probes
 * into a single SSH round trip. The subshell keeps the loop's `exit` from
 * ending the surrounding script, and the trailing empty values mean "absent"
 * rather than leaving the keys undefined.
 */
export function remoteClaudeProbeFragment(): string {
  return "( for candidate in " + CLAUDE_POSIX_CANDIDATES + "; "
    + [
      "do [ -n \"$candidate\" ] || continue",
      "[ -x \"$candidate\" ] || continue",
      "printf 'claudePath=%s\\n' \"$candidate\"",
      "printf 'claudeVersion=%s\\n' \"$(\"$candidate\" --version 2>/dev/null | head -n 1)\"",
      "exit 0",
      "done",
      "echo claudePath=",
      "echo claudeVersion="
    ].join("; ")
    + " )";
}

/** Remote script that installs the official Claude CLI. */
export function remoteClaudeInstallScript(remoteOs: RemoteOs): string {
  if (remoteOs === "windows") {
    return powershellEncodedCommand([
      "$ErrorActionPreference = 'Stop'",
      "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12",
      CLAUDE_WINDOWS_INSTALL_COMMAND
    ].join("; "));
  }
  return [
    "if command -v curl >/dev/null 2>&1",
    "then " + CLAUDE_POSIX_INSTALL_COMMAND,
    "elif command -v wget >/dev/null 2>&1",
    "then wget -qO- https://claude.ai/install.sh | bash",
    "else echo 'Neither curl nor wget is available on the SSH host' >&2",
    "exit 127",
    "fi"
  ].join("; ");
}

/**
 * Build the remote shell command that runs one Claude CLI stream-json session.
 * The relay credential is read from the first stdin line instead of argv, and
 * the NDJSON protocol takes over the same stream immediately afterwards.
 */
export function buildRemoteClaudeCommand(input: RemoteClaudeCommandInput): string {
  const entries = Object.entries(input.env).filter(([key, value]) => ENV_KEY_PATTERN.test(key) && typeof value === "string");
  if (input.remoteOs === "windows") {
    return powershellEncodedCommand([
      "$ErrorActionPreference = 'Stop'",
      "Set-Location -LiteralPath " + quotePowerShell(expandRemoteHome(input.cwd)),
      ...entries.map(([key, value]) => "$env:" + key + " = " + quotePowerShell(value)),
      ...(input.readSecretFromStdin ? ["$env:" + STDIN_ENV_KEY + " = [Console]::In.ReadLine()"] : []),
      "$claude = Get-Command " + quotePowerShell(input.binPath) + " -ErrorAction Stop",
      ["& $claude.Source", ...input.args.map(quotePowerShell)].join(" ")
    ].join("; "));
  }
  return [
    "cd -- " + quoteRemotePath(input.cwd),
    ...entries.map(([key, value]) => "export " + key + "=" + quote(value)),
    ...(input.readSecretFromStdin ? ["IFS= read -r " + STDIN_ENV_KEY, "export " + STDIN_ENV_KEY] : []),
    ["exec", quote(input.binPath), ...input.args.map(quote)].join(" ")
  ].join(" && ");
}

/**
 * Point a relay-gateway URL at the reverse tunnel that this child owns. The
 * remote host reaches this machine only through `127.0.0.1:<remotePort>`.
 */
export function rewriteGatewayBaseUrl(baseUrl: string, remotePort: number): string {
  try {
    const url = new URL(baseUrl);
    url.protocol = "http:";
    url.hostname = "127.0.0.1";
    url.port = String(remotePort);
    return url.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Whether a workspace path can name a directory on the SSH host.
 *
 * A Claude thread keeps its cwd in runtime metadata, and a thread first opened
 * locally keeps the host's own path there. Handing a Windows path to a POSIX
 * host makes the remote shell fail `cd` before it ever execs the CLI, so the
 * session produces no protocol output at all and the turn hangs instead of
 * reporting an error.
 */
export function isRemoteWorkspacePath(remoteOs: RemoteOs, path: string): boolean {
  if (path === "~" || path.startsWith("~/")) return true;
  const hasWindowsDrive = /^[A-Za-z]:[\\/]/.test(path);
  if (remoteOs === "windows") return hasWindowsDrive || !path.startsWith("/");
  return !hasWindowsDrive && !path.includes("\\");
}

/** The subset of a local Claude environment that is meaningful on the SSH host. */
export function forwardedRemoteEnv(env: NodeJS.ProcessEnv | undefined, remotePort: number): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const key of FORWARDED_ENV_KEYS) {
    const value = env?.[key];
    if (typeof value !== "string" || value.length === 0) continue;
    forwarded[key] = key === "ANTHROPIC_BASE_URL" ? rewriteGatewayBaseUrl(value, remotePort) : value;
  }
  return forwarded;
}

function parseProbeOutput(stdout: string): RemoteClaudeCli | null {
  const binPath = /^CLAUDE_BIN=(.*)$/m.exec(stdout)?.[1]?.trim();
  if (!binPath) return null;
  const rawVersion = /^CLAUDE_VERSION=(.*)$/m.exec(stdout)?.[1]?.trim() ?? "";
  return { binPath, version: /(\d+\.\d+\.\d+)/.exec(rawVersion)?.[1] ?? null, installed: false };
}

export async function probeRemoteClaudeCli(
  sshArgs: string[],
  remoteOs: RemoteOs,
  runRemote: RunRemoteCommand = defaultRunRemote
): Promise<RemoteClaudeCli | null> {
  try {
    const { stdout } = await runRemote(sshArgs, remoteClaudeProbeScript(remoteOs), PROBE_TIMEOUT_MS);
    return parseProbeOutput(stdout);
  } catch (error) {
    // Exit code 3 is the documented "not installed" answer; anything else is a
    // transport or shell failure that the caller must see.
    const record = error as { code?: number | string; stdout?: string };
    if (record?.code === 3) return null;
    const parsed = typeof record?.stdout === "string" ? parseProbeOutput(record.stdout) : null;
    if (parsed) return parsed;
    throw new Error("Failed to probe the Claude CLI on the SSH host: " + remoteErrorMessage(error));
  }
}

/** Probe the SSH host and install the official Claude CLI when it is missing. */
export async function ensureRemoteClaudeCli(
  sshArgs: string[],
  remoteOs: RemoteOs,
  options: Pick<SshCodeCliLauncherOptions, "installIfMissing" | "onProgress" | "runRemote"> = {}
): Promise<RemoteClaudeCli> {
  const runRemote = options.runRemote ?? defaultRunRemote;
  const existing = await probeRemoteClaudeCli(sshArgs, remoteOs, runRemote);
  if (existing) return existing;
  if (options.installIfMissing === false) {
    throw new Error("Claude CLI is not installed on the SSH host. Install it with: " + CLAUDE_POSIX_INSTALL_COMMAND);
  }
  options.onProgress?.("Claude CLI is missing on the SSH host, installing it now");
  let installOutput = "";
  try {
    const result = await runRemote(sshArgs, remoteClaudeInstallScript(remoteOs), INSTALL_TIMEOUT_MS);
    installOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
  } catch (error) {
    throw new Error("Claude CLI installation failed on the SSH host: " + remoteErrorMessage(error));
  }
  const installed = await probeRemoteClaudeCli(sshArgs, remoteOs, runRemote);
  if (!installed) {
    throw new Error("Claude CLI installation did not produce a usable binary on the SSH host. " + lastOutputLines(installOutput));
  }
  options.onProgress?.("Installed Claude CLI " + (installed.version ?? "") + " at " + installed.binPath);
  return { ...installed, installed: true };
}

/**
 * Runs the Claude CLI on an SSH host with the same stdio contract as a local
 * child process: one `ssh` client per session carries stream-json NDJSON, and a
 * reverse tunnel lets the remote CLI reach this machine's relay gateway.
 */
export class SshCodeCliLauncher {
  private readonly children = new Set<ChildProcessWithoutNullStreams>();
  private disposed = false;

  public constructor(
    public readonly profile: SshWorkspaceProfile,
    public readonly sshArgs: string[],
    public readonly remoteOs: RemoteOs,
    public readonly cli: RemoteClaudeCli,
    private readonly options: SshCodeCliLauncherOptions
  ) {}

  /** Drop-in replacement for `spawnCodexCommand` that runs the CLI on the SSH host. */
  public readonly spawn: SpawnProcess = (_command, args, options) => {
    if (this.disposed) throw new Error("SSH Claude launcher has been disposed");
    const remotePort = this.options.allocateRemotePort();
    const env = forwardedRemoteEnv(options.env, remotePort);
    const secret = typeof options.env?.[STDIN_ENV_KEY] === "string" ? String(options.env[STDIN_ENV_KEY]) : "";
    const remoteCommand = buildRemoteClaudeCommand({
      remoteOs: this.remoteOs,
      cwd: this.remoteCwd(options.cwd),
      binPath: this.cli.binPath,
      args,
      env,
      readSecretFromStdin: secret.length > 0
    });
    const spawnProcess = this.options.spawnProcess ?? defaultSpawnProcess;
    const child = spawnProcess("ssh", [
      ...SSH_CONNECT_ARGS,
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-R", "127.0.0.1:" + remotePort + ":127.0.0.1:" + this.options.localServerPort,
      ...this.sshArgs,
      remoteCommand
    ], { stdio: "pipe", env: process.env, windowsHide: process.platform === "win32" });
    // The remote shell blocks on this line before exec'ing the CLI, so it must
    // be written before any protocol traffic reaches the same stream.
    if (secret) child.stdin.write(secret + "\n");
    this.children.add(child);
    child.once("exit", () => this.children.delete(child));
    return child;
  };

  /** Number of live SSH sessions, used by diagnostics and tests. */
  public activeSessionCount(): number {
    return this.children.size;
  }

  public dispose(): void {
    this.disposed = true;
    for (const child of [...this.children]) {
      this.children.delete(child);
      terminateSshCodeCliChild(child);
    }
  }

  private remoteCwd(cwd: SpawnOptionsWithoutStdio["cwd"]): string {
    // A missing thread cwd falls back to the local process directory upstream,
    // which does not exist on the SSH host. Prefer the workspace path then, and
    // likewise whenever the thread carries a path this host cannot resolve.
    const requested = typeof cwd === "string" ? cwd : "";
    if (!requested || requested === process.cwd()) return this.profile.cwd;
    return isRemoteWorkspacePath(this.remoteOs, requested) ? requested : this.profile.cwd;
  }
}

/** Detect the SSH host, guarantee a Claude CLI, and return a ready launcher. */
export async function prepareSshCodeCliLauncher(
  profile: SshWorkspaceProfile,
  options: SshCodeCliLauncherOptions
): Promise<SshCodeCliLauncher> {
  const target = await resolveRemoteClaudeTargetCached(profile.command, options);
  return createSshCodeCliLauncher(profile, target, options);
}

/**
 * Resolved targets, keyed by SSH command.
 *
 * Resolution costs two SSH handshakes (an OS probe and a CLI probe), which on a
 * remote VPS measures in seconds. Every bridge used to pay it again, inside the
 * `turn/start` round-trip the browser gives up on after 20s — so a host that
 * answers perfectly well still presented as a timeout. Cache the promise so
 * concurrent bridges share one resolution, and drop it on failure so a host
 * that was down is retried rather than remembered as broken.
 */
const remoteClaudeTargets = new Map<string, Promise<RemoteClaudeTarget>>();

export async function resolveRemoteClaudeTargetCached(
  command: string,
  options: Pick<SshCodeCliLauncherOptions, "installIfMissing" | "onProgress" | "runRemote" | "detectOs"> = {}
): Promise<RemoteClaudeTarget> {
  const cached = remoteClaudeTargets.get(command);
  if (cached) return await cached;
  const pending = resolveRemoteClaudeTarget(command, options);
  remoteClaudeTargets.set(command, pending);
  try {
    return await pending;
  } catch (error) {
    remoteClaudeTargets.delete(command);
    throw error;
  }
}

/** Forget a cached host, so the next bridge re-probes it. */
export function forgetRemoteClaudeTarget(command?: string): void {
  if (command === undefined) remoteClaudeTargets.clear();
  else remoteClaudeTargets.delete(command);
}

/**
 * Resolve the Claude CLI on an SSH host. This costs two SSH round-trips (plus
 * an install when the host has no CLI), so callers should cache the result per
 * host instead of paying it on every bridge.
 */
export async function resolveRemoteClaudeTarget(
  command: string,
  options: Pick<SshCodeCliLauncherOptions, "installIfMissing" | "onProgress" | "runRemote" | "detectOs"> = {}
): Promise<RemoteClaudeTarget> {
  const parts = splitSshCommand(command);
  if (parts[0] !== "ssh" || parts.length < 2) throw new Error("SSH command must look like: ssh user@host");
  const sshArgs = parts.slice(1);
  const remoteOs = await (options.detectOs ?? detectRemoteOs)(sshArgs);
  const cli = await ensureRemoteClaudeCli(sshArgs, remoteOs, options);
  return { sshArgs, remoteOs, cli };
}

/** Bind a resolved remote CLI to one workspace and its own SSH session lifetime. */
export function createSshCodeCliLauncher(
  profile: SshWorkspaceProfile,
  target: RemoteClaudeTarget,
  options: SshCodeCliLauncherOptions
): SshCodeCliLauncher {
  return new SshCodeCliLauncher(profile, target.sshArgs, target.remoteOs, target.cli, options);
}

/** Close stdin first so the remote CLI sees EOF, then kill the local SSH client. */
export function terminateSshCodeCliChild(child: ChildProcessWithoutNullStreams): void {
  try { child.stdin.end(); } catch { /* Already closed. */ }
  if (process.platform === "win32" && child.pid) {
    const terminated = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    if (!terminated.error && terminated.status === 0) return;
  }
  try { child.kill("SIGTERM"); } catch { /* Already exited. */ }
}

function defaultSpawnProcess(command: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams {
  return spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
}

function remoteErrorMessage(error: unknown): string {
  const record = error as { stderr?: string; message?: string } | null;
  const stderr = typeof record?.stderr === "string" ? record.stderr.trim() : "";
  if (stderr) return lastOutputLines(stderr);
  return typeof record?.message === "string" ? record.message : String(error);
}

function lastOutputLines(output: string, limit = 5): string {
  return output.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(-limit).join(" | ");
}
