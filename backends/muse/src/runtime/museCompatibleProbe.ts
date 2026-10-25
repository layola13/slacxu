import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pluginHostServices } from "@cxu/sdk-backend";

export interface MuseCliProbeResult {
  available: boolean;
  binPath: string;
  version?: string;
  loggedIn?: boolean;
  error?: string;
}

function isLaunchable(path: string): boolean {
  if (!existsSync(path)) return false;
  return true;
}

/**
 * Check whether the user is logged in to Muse (Meta).
 * Priority: META_API_KEY env > `muse auth` credentials > `muse login` (OAuth).
 * OAuth credentials live in $HOME/.config/muse/auth.json (MUSE_AUTH_PATH overrides).
 */
export function isMuseLoggedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.META_API_KEY && String(env.META_API_KEY).trim()) return true;
  const authPath = env.MUSE_AUTH_PATH?.trim()
    || (env.XDG_CONFIG_HOME?.trim()
      ? join(env.XDG_CONFIG_HOME.trim(), "muse", "auth.json")
      : "");
  if (authPath && existsSync(authPath)) return true;
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (!home) return false;
  const defaultAuth = join(home, ".config", "muse", "auth.json");
  return existsSync(defaultAuth);
}

/**
 * On Windows, muse.cmd is a launcher script wrapping powershell.exe and
 * `.muse-launcher.ps1`, which in turn launches `muse-bin-*.exe`.
 * Prefer the direct `muse-bin-*.exe` executable to bypass cmd.exe/PowerShell
 * overhead, avoid argument newline truncation, and allow direct process management.
 */
export function resolveWindowsMuseExe(binPath: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const trimmed = binPath.trim();
    if (!trimmed) return undefined;
    if (/muse-bin-.*\.exe$/i.test(trimmed) && isLaunchable(trimmed)) {
      return trimmed;
    }
    const parentDir = dirname(trimmed);
    if (!existsSync(parentDir)) return undefined;
    const entries = readdirSync(parentDir);
    const candidates = entries
      .filter((e) => /^muse-bin-.*\.exe$/i.test(e))
      .sort((a, b) => b.localeCompare(a));
    if (candidates.length > 0) {
      const target = join(parentDir, candidates[0]!);
      if (isLaunchable(target)) return target;
    }
  } catch {}
  return undefined;
}

/**
 * Find the muse binary path, respecting MUSE_BIN override, preferred user
 * selection, cached enumeration, PATH locations, and ~/.local/bin fallback
 * (the official install.sh target).
 */
export function findMuseBin(env: NodeJS.ProcessEnv = process.env): string {
  const preferred = pluginHostServices().cli.getPreferredCliBinary("muse");
  if (preferred && isLaunchable(preferred)) {
    return resolveWindowsMuseExe(preferred) ?? preferred;
  }
  const latestCached = pluginHostServices().cli.getCachedLatestCliPath("muse");
  if (latestCached && isLaunchable(latestCached)) {
    return resolveWindowsMuseExe(latestCached) ?? latestCached;
  }
  const configured = env.MUSE_BIN || env.CODEX_UI_MUSE_BIN;
  if (configured && typeof configured === "string" && configured.trim() && isLaunchable(configured.trim())) {
    return resolveWindowsMuseExe(configured.trim()) ?? configured.trim();
  }
  const candidates = pluginHostServices().cli.enumerateCliCandidates("muse", env, process.platform);
  if (candidates.length > 0) {
    return resolveWindowsMuseExe(candidates[0]!) ?? candidates[0]!;
  }
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (home) {
    const localBin = join(home, ".local", "bin", process.platform === "win32" ? "muse.exe" : "muse");
    if (isLaunchable(localBin)) return localBin;
  }
  return "muse";
}

/**
 * Probe an explicit muse CLI binary for version and availability.
 */
export function probeMuseCliCommand(bin: string, env: NodeJS.ProcessEnv = process.env): MuseCliProbeResult {
  try {
    const resolved = pluginHostServices().codex.resolveCodexSpawn(bin, ["--version"], process.platform, env);
    const proc = spawnSync(resolved.command, resolved.args, {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
    });
    if (proc.error) {
      return { available: false, binPath: bin, error: proc.error.message };
    }
    const output = (proc.stdout || proc.stderr || "").trim();
    const match = output.match(/(\d+\.\d+\.\d+(?:-R\d+\.\d+)?)/) ?? output.match(/(\d+\.\d+)/);
    const version = match ? match[1] : undefined;
    return {
      available: proc.status === 0 || Boolean(version),
      binPath: bin,
      version,
      loggedIn: isMuseLoggedIn(env),
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

const VALID_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

/**
 * Resolve the user-scoped scratch root for muse turns.
 *
 * Background: `runMuseExecTurn` redirects the child's XDG dirs so automation
 * never touches the user's real `~/.config/muse`. The muse CLI treats
 * XDG_DATA_HOME as its data home and extracts its bundled skills
 * (`muse/skills/bundled/muse-core*`, hundreds of files) there on first run.
 * That directory must therefore NEVER live inside a workspace (it used to be
 * `<cwd>/.codex-ultra/muse-data`, polluting the user's git repo with
 * untracked files). It now lives under the user home:
 * `~/.codex-ultra/muse-scratch/` (override with MUSE_SCRATCH_DIR /
 * CODEX_UI_MUSE_SCRATCH_DIR; OS tmpdir fallback when home is unresolvable).
 *
 * Layout:
 * - `<root>/data`            shared XDG_DATA_HOME (skills extracted once;
 *                            per-turn session subdirs are removed at turn end)
 * - `<root>/config-<thread>` per-thread XDG_CONFIG_HOME (sa-vm MCP mount)
 * - `<root>/prompts-<thread>` per-thread prompt files (deleted at turn end)
 */
export interface MuseScratchDirs {
  root: string;
  dataDir: string;
  configDir: string;
  promptsDir: string;
}

export function sanitizePathSegment(raw: string): string {
  const cleaned = String(raw ?? "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "thread";
}

/** True when `target` is inside `dir` (guards recursive deletes). */
export function isWithinDir(dir: string, target: string): boolean {
  try {
    const rel = relative(resolve(dir), resolve(target));
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`);
  } catch {
    return false;
  }
}

export function resolveMuseScratchRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.MUSE_SCRATCH_DIR ?? env.CODEX_UI_MUSE_SCRATCH_DIR ?? "").trim();
  if (override) return override;
  const home = (env.USERPROFILE ?? "").trim()
    || (env.HOME ?? "").trim()
    || (() => { try { return homedir(); } catch { return ""; } })();
  if (home) return join(home, ".codex-ultra", "muse-scratch");
  return join(tmpdir(), "codex-ultra-muse-scratch");
}

export function resolveMuseScratchDirs(threadId: string, env: NodeJS.ProcessEnv = process.env): MuseScratchDirs {
  const root = resolveMuseScratchRoot(env);
  const tag = sanitizePathSegment(threadId);
  return {
    root,
    dataDir: join(root, "data"),
    configDir: join(root, `config-${tag}`),
    promptsDir: join(root, `prompts-${tag}`),
  };
}

/**
 * Build safe spawn arguments for a `muse exec --json` single-turn run.
 * Dual-mode:
 *  - official: no baseUrl, relies on `muse login` / META_API_KEY, default model muse-spark-1.3.
 *  - relay (login-free): baseUrl + META_API_KEY injected via child env only.
 */
export function buildMuseExecArgs(options: {
  prompt?: string;
  promptFilePath?: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  workspace?: string;
  baseUrl?: string;
  dangerouslyBypassPermissions?: boolean;
}): string[] {
  const args = ["exec", "--json", "--provider", "meta"];
  // 只加载当前工程的 skills/rules：muse 默认还会带入 foreign personal
  // context（用户级 rules/skills，可能是全家桶所有工程的），自动化 turn
  // 必须用 --no-foreign-personal-context 排除；当前工程的 skills 由下面的
  // --workspace + --trust-workspace 加载，不受影响。
  args.push("--no-foreign-personal-context");
  if (options.model?.trim()) {
    args.push("--model", options.model.trim());
  }
  if (options.effort?.trim()) {
    const normalized = options.effort.trim().toLowerCase();
    if ((VALID_EFFORTS as readonly string[]).includes(normalized)) {
      args.push("--reasoning-effort", normalized);
    }
  }
  if (options.baseUrl?.trim()) {
    args.push("--base-url", options.baseUrl.trim());
  }
  if (options.sessionId?.trim()) {
    args.push("--session-id", options.sessionId.trim());
  }
  if (options.workspace?.trim()) {
    args.push("--workspace", options.workspace.trim(), "--trust-workspace");
  }
  if (options.dangerouslyBypassPermissions === true) {
    args.push("--yolo");
  } else {
    args.push("--approval-mode", "on-request");
  }
  if (options.promptFilePath?.trim()) {
    args.push("--prompt-file", options.promptFilePath.trim());
  } else if (typeof options.prompt === "string") {
    args.push(options.prompt);
  }
  return args;
}

/**
 * Per-run muse config dir (mirrors opencode's `OPENCODE_CONFIG_CONTENT`
 * inline injection): muse reads MCP servers from
 * `$XDG_CONFIG_HOME/muse/settings.json` (`{schema_version:1,
 * mcpServers:{...}}`, entry `{id?, command, args?, env?}` — verified
 * against muse 1.4.7, stdio spawn + env passthrough both work).
 *
 * Why per-run XDG instead of writing home: the user's real
 * `~/.config/muse/settings.json` must never be touched by automation;
 * a generated dir keeps the sa-vm MCP attach scoped to this thread's turns.
 * The dir used to live under `<cwd>/.codex-ultra/muse-config`; it now lives
 * in the user-scoped scratch root (see resolveMuseScratchDirs) so workspaces
 * stay clean. Pass `xdgRoot` to override; defaults to the legacy cwd layout
 * for backward compatibility.
 *
 * Returns the XDG root to set as `XDG_CONFIG_HOME` for the child, or
 * undefined when no script path is available (caller then spawns without
 * MCP, same as before).
 */
export function buildMuseSaVmSettingsDir(options: {
  cwd: string;
  scriptPath: string;
  token?: string;
  apiUrl?: string;
  env?: NodeJS.ProcessEnv;
  /** Override the `<cwd>/.codex-ultra/muse-config` default (scratch dirs). */
  xdgRoot?: string;
}): string | undefined {
  const cwd = (options.cwd ?? "").trim();
  const scriptPath = (options.scriptPath ?? "").trim();
  if (!cwd || !scriptPath || !existsSync(scriptPath)) return undefined;
  try {
    const base = options.env ?? process.env;
    const xdgRoot = (options.xdgRoot ?? "").trim() || join(cwd, ".codex-ultra", "muse-config");
    const museDir = join(xdgRoot, "muse");
    mkdirSync(museDir, { recursive: true });
    const nodeCmd = process.platform === "win32" && process.execPath && /node(\.exe)?$/i.test(process.execPath)
      ? process.execPath
      : "node";
    const entry: Record<string, unknown> = { id: "sa-vm", command: nodeCmd, args: [scriptPath] };
    const env: Record<string, string> = {};
    const token = (options.token ?? (base.CODEX_UI_TOKEN as string | undefined) ?? process.env.CODEX_UI_TOKEN ?? "").trim();
    const apiUrl = (options.apiUrl ?? "").trim();
    if (token) env.CODEX_UI_TOKEN = token;
    if (apiUrl) env.CODEX_UI_API_URL = apiUrl;
    // 动作尾行开关（透传已实证）：muse stdout 无模型侧 input，尾行是还原参数唯一来源。
    env.MUSE_SA_VM_ENVELOPE = "1";
    entry.env = env;
    const settingsPath = join(museDir, "settings.json");
    let prev: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) prev = parsed as Record<string, unknown>;
    } catch { /* 不存在或损坏则重建 */ }
    const prevServers = prev?.mcpServers && typeof prev.mcpServers === "object" && !Array.isArray(prev.mcpServers)
      ? { ...(prev.mcpServers as Record<string, unknown>) }
      : {};
    const next = {
      ...(prev ?? {}),
      schema_version: typeof prev?.schema_version === "number" ? prev.schema_version : 1,
      mcpServers: { ...prevServers, "sa-vm": entry },
    };
    writeFileSync(settingsPath, JSON.stringify(next, null, 2), "utf8");
    // 官方登录透传：XDG 覆盖后子进程看不到真实 auth.json，symlink 回来。
    // Windows 非管理员默认无 symlink 权限，失败时退回 copy，保证官方登录不被 XDG 覆盖吞掉。
    try {
      const realHome = base.USERPROFILE ?? base.HOME ?? "";
      const realXdg = base.XDG_CONFIG_HOME?.trim() || (realHome ? join(realHome, ".config") : "");
      const candidates = [
        realXdg ? join(realXdg, "muse", "auth.json") : "",
        (base.MUSE_AUTH_PATH ?? "").trim(),
        realHome ? join(realHome, ".config", "muse", "auth.json") : "",
      ].filter(Boolean);
      const target = join(museDir, "auth.json");
      if (!existsSync(target)) {
        for (const src of candidates) {
          if (src && existsSync(src)) {
            try { symlinkSync(src, target); } catch {
              try { copyFileSync(src, target); } catch { /* 拷贝也失败则跳过 */ }
            }
            break;
          }
        }
      }
    } catch { /* 登录透传失败不影响 MCP 挂载 */ }
    return xdgRoot;
  } catch {
    return undefined;
  }
}

/**
 * Build a safe child env for the muse process.
 * Relay keys travel only in the child env — never written to disk or logs.
 */
export function buildSafeMuseEnv(
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
