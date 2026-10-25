import { randomUUID } from "node:crypto";
import { spawn as spawnProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { IPty } from "node-pty";

// Resident terminal layer (orca-style): the server owns real PTYs via
// node-pty, so shells live until the user exits them — no exec timeout
// can reap them, and job control (Ctrl+C, top, vim) works natively
// through the kernel foreground process group.
//
// This is intentionally separate from `command/exec` (short-lived,
// timeout-bound, proxied to the upstream engine). Interactive terminal
// tabs — and later terminal-typed chats — bind here.

export type TerminalPtyStatus = "running" | "exited";

export type TerminalPtyInfo = {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  status: TerminalPtyStatus;
  exitCode?: number;
  signal?: number;
  createdAt: number;
  ownerId?: string;
  threadId?: string;
  backend: TerminalPtyBackend;
};

export type TerminalPtyEvents = {
  onData: (terminalId: string, chunk: string) => void;
  onExit: (terminalId: string, exitCode: number, signal?: number) => void;
};

export type TerminalPtySpawnOptions = {
  cwd?: string;
  cols?: number;
  rows?: number;
  term?: string;
  /** Optional argv override (e.g. a TUI agent binary). Defaults to the login shell. */
  command?: string[];
  /** Optional extra env (string values only). Merged over process.env. */
  env?: Record<string, string>;
  ownerId?: string;
  threadId?: string;
};

type PtyModule = typeof import("node-pty");

/**
 * Disk probes for the standalone single-file servers (Bun --compile):
 * node-pty is external, and cxu/desktop packaging seeds
 * `<exe-dir>/node_modules/node-pty` (with the win32-x64 prebuild) next to
 * codex-standalone(.exe) / codex-ultra-server.exe.
 * Dev servers (`bun --watch src/index.ts`) resolve the bare specifier
 * normally; the disk list below is only the compiled-exe fallback chain.
 */
function findNodePtyDiskEntries(): string[] {
  const candidates: string[] = [];
  try {
    const exe = process.execPath;
    if (exe) {
      candidates.push(join(dirname(exe), "node_modules", "node-pty", "lib", "index.js"));
    }
  } catch {
    // Ignore and fall through to the require.resolve probe below.
  }
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("node-pty/package.json");
    candidates.push(join(dirname(pkgJson), "lib", "index.js"));
  } catch {
    // Not resolvable from this install (e.g. pruned global): skip.
  }
  return [...new Set(candidates)].filter((entry) => {
    try {
      return existsSync(entry);
    } catch {
      return false;
    }
  });
}

async function defaultPtyLoader(): Promise<PtyModule> {
  const attempts: string[] = [];
  try {
    return await import("node-pty");
  } catch (bareError) {
    attempts.push(`bare import: ${bareError instanceof Error ? bareError.message : String(bareError)}`);
  }
  // Bun single-file exes resolve ESM bare specifiers from their virtual FS
  // (B:~BUN/root/...) and never see the exe-side node_modules seeded by
  // packaging — but CJS `createRequire` resolution does hit disk (verified:
  // better-sqlite3 loads this way while `import("node-pty")` throws
  // "Cannot find package"). Try the bare specifier through require before
  // falling back to absolute disk paths.
  try {
    return createRequire(import.meta.url)("node-pty") as PtyModule;
  } catch (requireError) {
    attempts.push(`bare require: ${requireError instanceof Error ? requireError.message : String(requireError)}`);
  }
  for (const diskEntry of findNodePtyDiskEntries()) {
    try {
      return createRequire(import.meta.url)(diskEntry) as PtyModule;
    } catch (diskError) {
      attempts.push(`${diskEntry}: ${diskError instanceof Error ? diskError.message : String(diskError)}`);
    }
  }
  const detail = attempts.length > 0 ? ` (${attempts.join("; ")})` : "";
  throw new Error(`Cannot find package "node-pty"${detail}`);
}

let ptyLoader: () => Promise<PtyModule> = defaultPtyLoader;

let bunPtyInputPatched = false;

/**
 * Bun-on-Windows input workaround (verified 2026-09-24, Bun 1.4.2):
 * node-pty builds its conin channel as `new net.Socket({ fd })`, but Bun's
 * net stack leaves that socket destroyed (`readyState=closed`), so every
 * `pty.write()` is silently dropped — the shell spawns and streams output
 * fine, yet no keystroke ever arrives (same failure under conpty and
 * winpty; Node is unaffected). This shim only replaces fd-constructed
 * sockets with direct-fd writers; every other construction (including the
 * working `outSocket`) delegates to the original class.
 * Best-effort and idempotent: any failure here falls through to the loader
 * below, whose error lists every attempt. Disable with
 * `CODEX_UI_TERMINAL_PTY_FD_PATCH=0`.
 */
export function patchBunWindowsPtyInput(): void {
  if (bunPtyInputPatched) return;
  bunPtyInputPatched = true;
  if (process.platform !== "win32") return;
  if ((process.env.CODEX_UI_TERMINAL_PTY_FD_PATCH ?? "").trim() === "0") return;
  const versions = (process as unknown as { versions?: Record<string, string | undefined> }).versions;
  if (!versions?.bun) return;
  try {
    const scopedRequire = createRequire(import.meta.url);
    const netModule = scopedRequire("node:net") as typeof import("node:net");
    const fsModule = scopedRequire("node:fs") as typeof import("node:fs");
    const OriginalSocket = netModule.Socket;
    if (typeof OriginalSocket !== "function") return;
    const marker = "__cxuBunFdPatched";
    if ((OriginalSocket as unknown as Record<string, unknown>)[marker]) return;
    class BunFdPipe extends EventEmitter {
      readable = false;
      writable = true;
      destroyed = false;
      connecting = false;
      pending = false;
      private fd: number;
      constructor(fd: number) {
        super();
        this.fd = fd;
      }
      setEncoding(): void {
        // conin is write-only; decoding never applies.
      }
      write(chunk: unknown, ...args: unknown[]): boolean {
        const callback = args.find((arg): arg is (error?: unknown) => void => typeof arg === "function");
        try {
          if (typeof chunk === "string") {
            fsModule.writeSync(this.fd, chunk, null, "utf8");
          } else {
            fsModule.writeSync(this.fd, Buffer.from(chunk as Uint8Array));
          }
          if (callback) callback(null);
          return true;
        } catch (error) {
          try {
            this.emit("error", error);
          } catch {
            // Listener failures must not break the write path.
          }
          if (callback) callback(error);
          return false;
        }
      }
      end(chunk?: unknown, ...args: unknown[]): void {
        if (chunk !== undefined && chunk !== null) {
          try {
            this.write(chunk);
          } catch {
            // Best-effort flush before close.
          }
        }
        this.destroy();
        const callback = args.find((arg): arg is () => void => typeof arg === "function");
        if (callback) callback();
      }
      destroy(): this {
        if (!this.destroyed) {
          this.destroyed = true;
          this.writable = false;
          try {
            fsModule.closeSync(this.fd);
          } catch {
            // Already closed by the agent; non-fatal.
          }
          try {
            this.emit("close");
          } catch {
            // Ignore listener races during teardown.
          }
        }
        return this;
      }
    }
    const PatchedSocket = function (this: unknown, options?: unknown): unknown {
      const fd = (options as { fd?: unknown } | undefined)?.fd;
      if (typeof fd === "number") return new BunFdPipe(fd);
      return new OriginalSocket(options as never);
    } as unknown as typeof OriginalSocket;
    PatchedSocket.prototype = OriginalSocket.prototype;
    (PatchedSocket as unknown as Record<string, unknown>)[marker] = true;
    netModule.Socket = PatchedSocket;
  } catch {
    // Best-effort only; defaultPtyLoader surfaces load failures with attempts.
  }
}

/** Test seam: inject a fake pty module. */
export function setTerminalPtyLoader(loader: () => Promise<PtyModule>): void {
  ptyLoader = loader;
}

export function resetTerminalPtyLoader(): void {
  ptyLoader = defaultPtyLoader;
}

export function isTerminalPtyEnabled(): boolean {
  return (process.env.CODEX_UI_TERMINAL_PTY ?? "").trim() !== "0";
}

/**
 * Blank-screen forensics: name the first screen-affecting escape sequence in
 * a PTY output chunk (erase/hide-cursor/alt-screen), or null when the chunk
 * is display-safe. Pure for testability.
 */
export function detectScreenSeq(chunk: string): string | null {
  if (chunk.includes("\x1b[2J")) return "ED-2J";
  if (chunk.includes("\x1b[3J")) return "ED-3J";
  if (chunk.includes("\x1bc")) return "RIS";
  if (chunk.includes("\x1b[?25l")) return "HIDE-CURSOR";
  if (chunk.includes("\x1b[?1049h") || chunk.includes("\x1b[?47h") || chunk.includes("\x1b[?1047h")) return "ALT-SCREEN";
  return null;
}

/**
 * Extra node-pty spawn options per platform. ConPTY is deliberately opt-in on
 * Windows: some node-pty/ConPTY combinations emit a full-screen redraw while
 * PowerShell handles an ordinary `ls` alias, which makes xterm appear to lose
 * its entire scrollback. Keep node-pty's default backend unless the host has
 * explicitly verified ConPTY and sets `CODEX_UI_TERMINAL_USE_CONPTY=1`.
 * Pure for testability — the win32 branch cannot run under Linux CI.
 */
export function ptySpawnExtraOptions(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): { useConpty?: boolean } {
  if (platform !== "win32") return {};
  // node-pty treats an omitted option as "auto" and enables ConPTY on modern
  // Windows. Pass false explicitly so the safe winpty path is the real default.
  return (env.CODEX_UI_TERMINAL_USE_CONPTY ?? "").trim() === "1" ? { useConpty: true } : { useConpty: false };
}

const MAX_TERMINALS = 16;
const SCROLLBACK_LIMIT_BYTES = 256 * 1024;

export type TerminalPtyBackend = "node-pty" | "script";

type Session = TerminalPtyInfo & {
  pty: IPty;
  scrollback: string;
  backend: TerminalPtyBackend;
  /** Screen-sequence forensics flag: first clear/hide/alt hit already logged. */
  screenSeqLogged?: boolean;
  /** Remount forensics: how many times the tail was re-read (mount = 1). */
  tailReads?: number;
};

function configuredBackendOverride(): TerminalPtyBackend | null {
  const raw = (process.env.CODEX_UI_TERMINAL_PTY_BACKEND ?? "").trim().toLowerCase();
  if (raw === "node-pty" || raw === "script") return raw;
  return null;
}

let probedBackend: TerminalPtyBackend | null = null;
let probeInFlight: Promise<TerminalPtyBackend> | null = null;

/**
 * Backend probe (memoized): node-pty's native session/ctty setup is broken
 * under some runtimes (verified: Bun 1.4.2 SIGHUPs every pty child within
 * milliseconds, including `sleep`; Node/Electron are fine). Probe once with
 * a sleeper; fall through to the `script(1)` bridge when node-pty dies fast.
 */
async function selectBackend(): Promise<TerminalPtyBackend> {
  const override = configuredBackendOverride();
  if (override) return override;
  if (probedBackend) return probedBackend;
  if (probeInFlight) return probeInFlight;
  probeInFlight = (async (): Promise<TerminalPtyBackend> => {
    if (process.platform === "win32") return "node-pty";
    try {
      const mod = await ptyLoader();
      const probe = mod.spawn("sleep", ["5"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: resolveSpawnCwd(undefined),
        env: { ...(process.env as Record<string, string>), TERM: "xterm-256color" }
      });
      const alive = await new Promise<boolean>((resolvePromise) => {
        const timer = setTimeout(() => resolvePromise(true), 400);
        probe.onExit(() => {
          clearTimeout(timer);
          resolvePromise(false);
        });
      });
      try {
        probe.kill();
      } catch {
        // Best effort.
      }
      return alive ? "node-pty" : "script";
    } catch {
      return "script";
    }
  })();
  try {
    probedBackend = await probeInFlight;
    return probedBackend;
  } finally {
    probeInFlight = null;
  }
}

/** Test seam: reset the memoized backend probe. */
export function resetTerminalPtyBackendProbe(): void {
  probedBackend = null;
  probeInFlight = null;
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

type SpawnedPty = {
  handle: IPty;
  backend: TerminalPtyBackend;
};

/**
 * `script(1)` bridge for runtimes where node-pty cannot hold a session.
 * util-linux `script -qec` owns a real PTY (own setsid + controlling
 * terminal), so job control works; `-e` propagates the child exit code.
 * Initial size is set from inside via stty (silent, no transcript noise).
 * Runtime resize cannot reach the master (script owns it), so resizes only
 * update the registry on this backend — documented limitation.
 */
async function spawnScriptBackend(
  shell: { file: string; args: string[] },
  cwd: string,
  cols: number,
  rows: number,
  env: Record<string, string>
): Promise<SpawnedPty> {
  const inner = `stty rows ${rows} cols ${cols} >/dev/null 2>&1; exec ${[shell.file, ...shell.args].map(quoteShellArg).join(" ")}`;
  const argv =
    process.platform === "darwin"
      ? ["script", "-q", "/dev/null", "sh", "-c", inner]
      : ["script", "-qec", inner, "/dev/null"];
  const child = spawnProcess(argv[0]!, argv.slice(1), {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (!child.stdin || !child.stdout) {
    try {
      child.kill();
    } catch {
      // Best effort.
    }
    throw new Error("Terminal script backend has no pipes");
  }
  const stdin = child.stdin;
  const listeners = { data: new Set<(chunk: string) => void>(), exit: new Set<(event: { exitCode: number; signal?: number }) => void>() };
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    for (const listener of listeners.data) {
      try {
        listener(text);
      } catch {
        // Listener failures must not kill the shell.
      }
    }
  });
  child.on("error", () => {
    for (const listener of listeners.exit) {
      try {
        listener({ exitCode: 1 });
      } catch {
        // Non-fatal.
      }
    }
  });
  child.on("exit", (code) => {
    for (const listener of listeners.exit) {
      try {
        listener({ exitCode: typeof code === "number" ? code : 1 });
      } catch {
        // Non-fatal.
      }
    }
  });
  const handle: IPty = {
    pid: child.pid ?? 0,
    cols,
    rows,
    process: `${shell.file} (script bridge)`,
    onData: (listener: (data: string) => void) => {
      listeners.data.add(listener);
    },
    onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
      listeners.exit.add(listener);
    },
    write: (data: string) => {
      try {
        stdin.write(data);
      } catch {
        // Writing to a dying shell is non-fatal.
      }
    },
    resize: () => {
      // No master access on this backend; registry below tracks intent.
    },
    kill: (signal?: string) => {
      try {
        child.kill((signal as NodeJS.Signals | undefined) ?? "SIGTERM");
      } catch {
        // Already dying.
      }
    },
    clear: () => undefined,
    toString: () => `[script bridge ${child.pid ?? "?"}]`
  } as unknown as IPty;
  return { handle, backend: "script" };
}

const sessions = new Map<string, Session>();

function resolveWindowsDefaultShell(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): { file: string; args: string[] } {
  // Orca-compatible priority: $SHELL (when it exists) -> pwsh 7 ->
  // SystemRoot WindowsPowerShell -> ComSpec -> bare fallback.
  // Absolute paths avoid `uv_spawn ... ENOENT` under Bun/Electron where a
  // bare exe name resolves less reliably than Node.
  const envShell = (env.SHELL ?? "").trim();
  if (envShell && exists(envShell)) {
    return shellArgsFor(envShell);
  }
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? env.WINDIR ?? "C:\\Windows";
  // Program Files is not always on C: (custom installs / non-C system drive).
  const programFiles = env.ProgramFiles ?? env.PROGRAMFILES ?? "C:\\Program Files";
  const candidates = [
    join(programFiles, "PowerShell", "7", "pwsh.exe"),
    join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    env.ComSpec ?? env.COMSPEC ?? "",
  ];
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) {
      return shellArgsFor(candidate);
    }
  }
  // Last resort: bare name lets PATH resolve it (matches old behavior).
  const comspec = (env.ComSpec ?? env.COMSPEC ?? "powershell.exe").trim() || "powershell.exe";
  return shellArgsFor(comspec);
}

/**
 * PowerShell on a CJK Windows host emits the OEM code page (936/932/949)
 * while node-pty decodes UTF-8, so Chinese file names/output turn into
 * mojibake. Switch the console to UTF-8 (no BOM) before the first prompt.
 */
export const POWERSHELL_UTF8_BOOTSTRAP =
  "[Console]::InputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding";

function shellArgsFor(file: string): { file: string; args: string[] } {
  const normalized = file.replace(/\//g, "\\").split("\\").pop()?.toLowerCase() ?? "";
  // Orca parity: pwsh/powershell -> -NoLogo, cmd -> [], wsl -> [] (distro via options, not here).
  if (normalized === "pwsh.exe" || normalized === "pwsh" || normalized === "powershell.exe" || normalized === "powershell") {
    // User profiles can import PSReadLine/custom prompts that emit full-screen
    // redraws. In the embedded xterm those redraws can erase the resident
    // scrollback after a plain `ls`; keep the shell interactive but deterministic.
    return { file, args: ["-NoLogo", "-NoProfile", "-NoExit", "-Command", POWERSHELL_UTF8_BOOTSTRAP] };
  }
  if (normalized === "cmd.exe" || normalized === "cmd") {
    // Same UTF-8 fix for cmd: switch to code page 65001 then stay interactive.
    return { file, args: ["/K", "chcp 65001>nul"] };
  }
  return { file, args: [] };
}

/** Exported for tests: resolve the default shell for a platform/env pair. */
export function defaultShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync
): { file: string; args: string[] } {
  // Like orca: a login shell so PATH covers Homebrew/nvm/user CLIs.
  // Windows defaults to PowerShell (absolute path when possible).
  if (platform === "win32") return resolveWindowsDefaultShell(env, exists);
  // `-l` (not `--login`): dash/ash/BusyBox sh reject the long form, while
  // bash/zsh/fish/ksh all accept `-l`.
  const envShell = (env.SHELL ?? "").trim();
  if (envShell && exists(envShell)) return { file: envShell, args: ["-l"] };
  for (const candidate of ["/bin/bash", "/bin/zsh", "/bin/sh"]) {
    if (exists(candidate)) return { file: candidate, args: ["-l"] };
  }
  return { file: "/bin/sh", args: ["-l"] };
}

/**
 * Daemonized servers (systemd/cxu serve) often start without LANG, so the
 * shell falls back to the POSIX locale and prints UTF-8 names as `?`/octal.
 * Default to C.UTF-8 only when the user has not configured any locale.
 */
export function terminalLocaleEnv(platform: NodeJS.Platform, env: Record<string, string | undefined>): Record<string, string> {
  if (platform === "win32") return {};
  if ((env.LC_ALL ?? "").trim() || (env.LC_CTYPE ?? "").trim() || (env.LANG ?? "").trim()) return {};
  return { LANG: "C.UTF-8" };
}

function clampDimension(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function resolveSpawnCwd(cwd: string | undefined): string {
  const candidate = typeof cwd === "string" && cwd.trim() ? cwd.trim() : process.cwd();
  if (!isAbsolute(candidate)) {
    throw new Error("Terminal cwd must be an absolute path");
  }
  const resolved = resolve(candidate);
  let stat: ReturnType<typeof statSync> | null = null;
  try {
    stat = statSync(resolved);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Terminal cwd is not a directory: ${resolved}`);
  }
  return resolved;
}

function sanitizeEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env || typeof env !== "object") return {};
  const cleaned: Record<string, string> = {};
  const keys = Object.keys(env).slice(0, 32);
  for (const key of keys) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = env[key];
    if (typeof value !== "string" || value.length > 4096) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

export function listTerminalPtys(): TerminalPtyInfo[] {
  return [...sessions.values()].map(toInfo);
}

export function getTerminalPty(id: string): TerminalPtyInfo | null {
  const session = sessions.get(id);
  return session ? toInfo(session) : null;
}

/**
 * Actionable wrapper for native-module load failures. The Bun single-file
 * server keeps node-pty external so conpty.node resolves from
 * node_modules/node-pty on disk; when that copy is missing (stale exe built
 * before the external, or a pruned install) the raw
 * "Failed to load native module: conpty.node" gives no recovery path.
 */
function describePtyLoadFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/Cannot find (package|module) ["']node-pty["']|conpty\.node|Failed to load native module/i.test(raw)) {
    let exeDir = "";
    try {
      exeDir = dirname(process.execPath);
    } catch {
      exeDir = "";
    }
    const hint =
      process.platform === "win32"
        ? ` (Windows terminal needs node_modules/node-pty with the win32-x64 prebuild next to the server binary${exeDir ? ` (${exeDir})` : ""}; restart cxu serve to re-seed/rebuild, or reinstall @codex-ultra/cxu)`
        : ` (terminal needs the node-pty package on disk${exeDir ? ` next to ${exeDir}` : ""}; restart cxu serve to re-seed/rebuild)`;
    return `${raw}${hint}`;
  }
  return raw;
}

export async function createTerminalPty(options: TerminalPtySpawnOptions, events: TerminalPtyEvents): Promise<TerminalPtyInfo> {
  if (!isTerminalPtyEnabled()) {
    throw new Error("Resident terminal is disabled (CODEX_UI_TERMINAL_PTY=0)");
  }
  // Must run before the first ptyLoader() use: node-pty captures
  // `net.Socket` at its own load time.
  patchBunWindowsPtyInput();
  // Retire oldest exited sessions first so dead tabs never block new shells
  // (and their scrollback is released); only all-running pools hit the cap.
  if (sessions.size >= MAX_TERMINALS) {
    const retired = [...sessions.values()]
      .filter((session) => session.status !== "running")
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const dead of retired) {
      if (sessions.size < MAX_TERMINALS) break;
      sessions.delete(dead.id);
    }
  }
  if (sessions.size >= MAX_TERMINALS) {
    throw new Error(`Too many resident terminals (max ${MAX_TERMINALS})`);
  }
  const cwd = resolveSpawnCwd(options.cwd);
  const cols = clampDimension(options.cols, 80, 20, 500);
  const rows = clampDimension(options.rows, 24, 5, 200);
  const term = typeof options.term === "string" && options.term.trim() ? options.term.trim().slice(0, 64) : "xterm-256color";
  const argv = Array.isArray(options.command) ? options.command.filter((part) => typeof part === "string" && part) : [];
  if (argv.length > 32) {
    throw new Error("Terminal command is too long");
  }
  const shell = argv.length > 0 ? { file: argv[0]!, args: argv.slice(1) } : defaultShell();

  const backend = await selectBackend();
  const userEnv = sanitizeEnv(options.env);
  const mergedEnv = {
    ...(process.env as Record<string, string>),
    ...terminalLocaleEnv(process.platform, { ...process.env, ...userEnv }),
    ...userEnv,
    TERM: term
  };

  const id = `term-${randomUUID()}`;
  const session: Session = {
    id,
    cwd,
    cols,
    rows,
    status: "running",
    createdAt: Date.now(),
    ownerId: options.ownerId,
    threadId: options.threadId,
    pty: null as unknown as IPty,
    scrollback: "",
    backend
  };
  if (backend === "script") {
    try {
      const spawned = await spawnScriptBackend(shell, cwd, cols, rows, mergedEnv);
      session.pty = spawned.handle;
    } catch (error) {
      throw new Error(`Terminal spawn failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    sessions.set(id, session);
  } else {
    let ptyModule: PtyModule;
    try {
      ptyModule = await ptyLoader();
    } catch (error) {
      throw new Error(`Terminal PTY backend unavailable: ${describePtyLoadFailure(error)}`);
    }
    let termHandle: IPty;
    try {
      termHandle = ptyModule.spawn(shell.file, shell.args, {
        name: term,
        cols,
        rows,
        cwd,
        env: mergedEnv,
        ...ptySpawnExtraOptions()
      });
    } catch (error) {
      throw new Error(`Terminal spawn failed: ${describePtyLoadFailure(error)}`);
    }
    session.pty = termHandle;
    sessions.set(id, session);
  }
  session.pty.onData((chunk) => {
    session.scrollback = (session.scrollback + chunk).slice(-SCROLLBACK_LIMIT_BYTES);
    // Blank-screen forensics: screen-affecting sequences are rare in normal
    // output. Log the first hit per session so a user-reported "panel went
    // blank" can be attributed to shell bytes vs renderer state.
    if (!session.screenSeqLogged) {
      const hit = detectScreenSeq(chunk);
      if (hit) {
        session.screenSeqLogged = true;
        console.warn(`[terminal] screen-seq ${hit} in ${id} bytes=${chunk.length}`);
      }
    }
    try {
      events.onData(id, chunk);
    } catch {
      // Listener failures must not kill the shell.
    }
  });
  console.info(`[terminal] created ${id} backend=${backend} cwd=${cwd} owner=${options.ownerId ?? "local"}`);
  session.pty.onExit(({ exitCode, signal }) => {
    session.status = "exited";
    session.exitCode = exitCode;
    session.signal = typeof signal === "number" ? signal : undefined;
    console.info(`[terminal] exited ${id} code=${exitCode}${session.signal === undefined ? "" : ` signal=${session.signal}`}`);
    try {
      events.onExit(id, exitCode, session.signal);
    } catch {
      // Listener failures are non-fatal.
    }
  });
  return toInfo(session);
}

export function writeTerminalPty(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Terminal not found: ${id}`);
  }
  if (session.status !== "running") {
    throw new Error(`Terminal has exited: ${id}`);
  }
  if (typeof data !== "string" || !data) {
    throw new Error("Terminal write requires non-empty data");
  }
  if (data.length > 1024 * 1024) {
    throw new Error("Terminal write is too large");
  }
  // Large pastes: Windows winpty/ConPTY input pipes drop bytes when one
  // write exceeds the console buffer, so feed them in bounded slices.
  // Slice on code-point boundaries so surrogate pairs (emoji) stay intact.
  if (data.length <= TERMINAL_WRITE_CHUNK) {
    session.pty.write(data);
    return;
  }
  for (const piece of chunkTerminalInput(data, TERMINAL_WRITE_CHUNK)) session.pty.write(piece);
}

const TERMINAL_WRITE_CHUNK = 4096;

/** Split input into <= size UTF-16 units without breaking a surrogate pair. Exported for tests. */
export function chunkTerminalInput(data: string, size = TERMINAL_WRITE_CHUNK): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + size, data.length);
    if (end < data.length) {
      const code = data.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    pieces.push(data.slice(start, end));
    start = end;
  }
  return pieces;
}

export function resizeTerminalPty(id: string, cols: number, rows: number): TerminalPtyInfo {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Terminal not found: ${id}`);
  }
  session.cols = clampDimension(cols, session.cols, 20, 500);
  session.rows = clampDimension(rows, session.rows, 5, 200);
  if (session.status === "running") {
    try {
      // Script backend resize is registry-only: `script(1)` owns the master
      // and offers no winsize channel (initial size is set via stty at spawn).
      session.pty.resize(session.cols, session.rows);
    } catch {
      // Resizing a dying pty is non-fatal.
    }
  }
  return toInfo(session);
}

export function readTerminalPty(id: string, limitBytes = 65536): { info: TerminalPtyInfo; tail: string } {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Terminal not found: ${id}`);
  }
  // Remount forensics: every frontend mount re-reads the tail. Repeated reads
  // mean the view keeps remounting (blank flashes); the count pinpoints it.
  session.tailReads = (session.tailReads ?? 0) + 1;
  if (session.tailReads > 1) {
    console.warn(`[terminal] tail re-read #${session.tailReads} ${id} (view remounted?)`);
  }
  const limit = Math.min(SCROLLBACK_LIMIT_BYTES, Math.max(1, Math.floor(limitBytes) || 65536));
  return { info: toInfo(session), tail: session.scrollback.slice(-limit) };
}

export function killTerminalPty(id: string): TerminalPtyInfo {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Terminal not found: ${id}`);
  }
  if (session.status === "running") {
    session.status = "exited";
    try {
      session.pty.kill();
    } catch {
      // Already dying; the onExit hook settles the record.
    }
  }
  return toInfo(session);
}

export function forgetTerminalPty(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  if (session.status === "running") {
    try {
      session.pty.kill();
    } catch {
      // Best effort.
    }
  }
  return sessions.delete(id);
}

function toInfo(session: Session): TerminalPtyInfo {
  return {
    id: session.id,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    backend: session.backend,
    status: session.status,
    ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
    ...(session.signal === undefined ? {} : { signal: session.signal }),
    createdAt: session.createdAt,
    ...(session.ownerId === undefined ? {} : { ownerId: session.ownerId }),
    ...(session.threadId === undefined ? {} : { threadId: session.threadId })
  };
}
