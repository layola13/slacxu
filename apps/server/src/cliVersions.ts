import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import {
  canExecute,
  spawnCodexCommand,
} from "./codexCommand.js";
import {
  getCachedLatestCli,
  getInflightCliRefresh,
  getPreferredCliBinary,
  setInflightCliRefresh,
  storeLatestCliCache,
  type CliInstallationEntry,
  type CliSelectionKind,
} from "./cliSelectionState.js";
import { cliDiscoveryForKind } from "./pluginHost.js";

/** Installations from the last completed enumeration, or an empty list before the first refresh. */
export function getCachedCliInstallations(kind: CliSelectionKind): CliInstallationEntry[] {
  return getCachedLatestCli(kind)?.installations ?? [];
}

const PROBE_TIMEOUT_MS = 8_000;

function pathValue(env: NodeJS.ProcessEnv): string {
  return env.PATH ?? env.Path ?? env.path ?? "";
}

/** Mirror of cxu doctor's normalizeDir: PATH entries may arrive quoted. */
function stripPathQuotes(raw: string): string | undefined {
  let dir = raw.trim();
  if (dir.length >= 2 && ((dir.startsWith('"') && dir.endsWith('"')) || (dir.startsWith("'") && dir.endsWith("'")))) {
    dir = dir.slice(1, -1).trim();
  }
  return dir || undefined;
}

function systemHomedir(): string | undefined {
  try {
    const dir = homedir().trim();
    return dir || undefined;
  } catch {
    return undefined;
  }
}

/**
 * npm global bin dir. `npm_config_prefix` env is honored first (cheap,
 * deterministic); otherwise probe `npm config get prefix` once per process
 * (cached) like cxu doctor does. Without this, npm -g installs under a
 * custom prefix (e.g. pi, which is npm-only) are invisible to the server
 * while `cxu doctor` happily reports them — the recurring "installed but
 * not listed" gap.
 */
let npmPrefixProbeCache: { probed: boolean; prefix?: string } = { probed: false };

export function resetNpmPrefixProbeCacheForTests(): void {
  npmPrefixProbeCache = { probed: false };
}

function npmPrefixBinDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  const configured = env.npm_config_prefix?.trim();
  const prefix = configured || probeNpmPrefix();
  if (!prefix) return undefined;
  return platform === "win32" ? prefix : path.join(prefix, "bin");
}

function probeNpmPrefix(): string | undefined {
  if (npmPrefixProbeCache.probed) return npmPrefixProbeCache.prefix;
  npmPrefixProbeCache.probed = true;
  try {
    const result = spawnSync("npm", ["config", "get", "prefix"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    const out = String(result.stdout ?? "").split(/\r?\n/)[0]?.trim();
    if (result.status === 0 && out && out.toLowerCase() !== "null" && out.toLowerCase() !== "undefined") {
      npmPrefixProbeCache.prefix = out;
    }
  } catch {
    // npm absent: leave the cache empty (negative result is also cached).
  }
  return npmPrefixProbeCache.prefix;
}

function windowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.PATHEXT ?? env.PathExt ?? ".COM;.EXE;.CMD;.BAT")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...configured.filter((e) => [".com", ".exe", ".cmd", ".bat"].includes(e)), ".exe", ".cmd", ".bat", ".com"])];
}

function isLaunchableCandidate(filePath: string, platform: NodeJS.Platform): boolean {
  if (!canExecute(filePath, platform)) {
    return false;
  }
  if (platform !== "win32") {
    return true;
  }
  return [".com", ".exe", ".cmd", ".bat"].includes(path.extname(filePath).toLowerCase());
}

function nvmVersionBinDirs(home: string | undefined): string[] {
  // nvm 默认把各 Node 版本的全局 bin 藏在 ~/.nvm/versions/node/vX.Y.Z/bin，
  // 服务端最小 PATH 下不可见，这里直接扫一层目录兜底（失败则忽略）。
  if (!home) return [];
  return nvmRootVersionBinDirs(path.join(home, ".nvm"));
}

function nvmRootVersionBinDirs(root: string | undefined): string[] {
  if (!root) return [];
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const versionsRoot = path.join(root, "versions", "node");
    const entries = readdirSync(versionsRoot, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) out.push(path.join(versionsRoot, entry.name, "bin"));
    }
    return out;
  } catch {
    return [];
  }
}

function fnmRootVersionBinDirs(root: string | undefined): string[] {
  // fnm 默认根是 ~/.local/share/fnm（FNM_DIR 可改），各版本 bin 在
  // <root>/node-versions/<version>/installation/bin，直接扫一层兜底。
  if (!root) return [];
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const versionsRoot = path.join(root, "node-versions");
    const entries = readdirSync(versionsRoot, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) out.push(path.join(versionsRoot, entry.name, "installation", "bin"));
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 语言/版本/包工具链目录（volta / fnm / asdf / mise / nvm / proto / rtx /
 * cargo / go / pnpm / yarn / deno）。与平台无关的部分抽出来，供
 * launchInstall 的 PATH 兜底复用，两端改动保持对齐。
 */
export function toolchainDirCandidates(
  home: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const voltaHome = env.VOLTA_HOME?.trim();
  const fnmDir = env.FNM_DIR?.trim();
  const nvmDir = env.NVM_DIR?.trim();
  const cargoHomeBin = env.CARGO_HOME?.trim() ? path.join(env.CARGO_HOME.trim(), "bin") : undefined;
  const gopathBin = env.GOPATH?.trim() ? path.join(env.GOPATH.trim(), "bin") : undefined;
  return [
    voltaHome ? path.join(voltaHome, "bin") : undefined,
    home ? path.join(home, ".volta", "bin") : undefined,
    fnmDir,
    home ? path.join(home, ".local", "share", "fnm") : undefined,
    ...(home ? fnmRootVersionBinDirs(path.join(home, ".local", "share", "fnm")) : []),
    ...(fnmDir ? fnmRootVersionBinDirs(fnmDir) : []),
    home ? path.join(home, ".asdf", "shims") : undefined,
    home ? path.join(home, ".local", "share", "mise", "shims") : undefined,
    home ? path.join(home, ".local", "share", "rtx", "shims") : undefined,
    home ? path.join(home, ".proto", "shims") : undefined,
    ...(home ? nvmVersionBinDirs(home) : []),
    ...(nvmDir ? nvmRootVersionBinDirs(nvmDir) : []),
    cargoHomeBin,
    home ? path.join(home, ".cargo", "bin") : undefined,
    gopathBin,
    home ? path.join(home, "go", "bin") : undefined,
    home ? path.join(home, ".local", "share", "pnpm") : undefined,
    home ? path.join(home, ".config", "yarn", "global", "node_modules", ".bin") : undefined,
    home ? path.join(home, ".yarn", "bin") : undefined,
    home ? path.join(home, ".deno", "bin") : undefined,
  ].filter((dir): dir is string => Boolean(dir));
}

function candidateDirectories(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const delimiter = platform === "win32" ? ";" : ":";
  const dirs = pathValue(env).split(delimiter).map(stripPathQuotes).filter((dir): dir is string => Boolean(dir));
  // Daemon envs may carry neither HOME nor USERPROFILE; fall back to the OS
  // home like cxu doctor does instead of silently dropping every home dir.
  const home = env.USERPROFILE ?? env.HOME ?? systemHomedir();
  // 各 CLI 官方安装目录优先级：
  // opencode: $OPENCODE_INSTALL_DIR / $XDG_BIN_DIR / $HOME/bin / $HOME/.opencode/bin（install 脚本）
  // claude: ~/.claude/bin（官方安装脚本）/ npm -g / bun -g
  // grok: ~/.grok/bin / npm -g / bun -g
  // npm -g / bun -g / brew / paru 等包管理器路径在服务端最小 PATH 下不可见，必须显式兜底。
  // 另覆盖 volta / fnm / asdf / mise / nvm 等版本管理器 shims。
  // posix 下不要漏 ~/.grok/bin ~/.opencode/bin ~/.claude/bin，
  // 也不要漏 cargo（Rust CLI 如 grok 走 cargo install -> ~/.cargo/bin）、
  // 自定义 node（全局包落到 /tools/node/bin）与 ~/.codex-ultra/bin。
  const opencodeInstallDir = env.OPENCODE_INSTALL_DIR?.trim();
  const xdgBinDir = env.XDG_BIN_DIR?.trim();
  const npmPrefixBin = npmPrefixBinDir(env, platform);
  const nvmBin = env.NVM_BIN?.trim();
  const gopathBin = env.GOPATH?.trim() ? path.join(env.GOPATH.trim(), "bin") : undefined;
  const programData = env.ProgramData ?? env.PROGRAMDATA;
  const programFiles = env.ProgramFiles ?? env.ProgramW6432;
  const programFilesX86 = env["ProgramFiles(x86)"];
  const kindHomeBins = home
    ? [
        path.join(home, ".claude", "bin"),
        path.join(home, ".grok", "bin"),
        path.join(home, ".codex", "bin"),
        path.join(home, ".pi", "bin"),
        path.join(home, ".agy", "bin"),
        path.join(home, ".opencode", "bin"),
        path.join(home, ".opencode-v2", "bin"),
        path.join(home, ".muse", "bin"),
        path.join(home, ".codex-ultra", "bin"),
      ]
    : [];
  // 工具链目录走共享 helper（含 fnm 版本扫描 / proto / rtx / yarn-classic），
  // 与 launchInstall 的 PATH 兜底同一份来源。
  const versionManagerBins = toolchainDirCandidates(home, env);
  const extras = platform === "win32"
    ? [
        env.APPDATA ? path.join(env.APPDATA, "npm") : undefined,
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "npm") : undefined,
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "claude") : undefined,
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "muse") : undefined,
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "muse", "bin") : undefined,
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "agy", "bin") : undefined,
        // 包管理器：WinGet / Scoop（含全局）/ Chocolatey / Mise（Windows）
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links") : undefined,
        home ? path.join(home, "scoop", "shims") : undefined,
        programData ? path.join(programData, "scoop", "shims") : undefined,
        programData ? path.join(programData, "chocolatey", "bin") : undefined,
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "mise", "shims") : undefined,
        // 语言/版本工具链：Volta / pnpm / Yarn / Go / Deno / Node（msi）
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Volta", "bin") : undefined,
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "pnpm") : undefined,
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Yarn", "bin") : undefined,
        home ? path.join(home, "go", "bin") : undefined,
        gopathBin,
        programFiles ? path.join(programFiles, "nodejs") : undefined,
        programFilesX86 ? path.join(programFilesX86, "nodejs") : undefined,
        ...kindHomeBins,
        opencodeInstallDir,
        xdgBinDir,
        home ? path.join(home, "bin") : undefined,
        home ? path.join(home, ".opencode", "bin") : undefined,
        home ? path.join(home, ".local", "bin") : undefined,
        home ? path.join(home, ".cargo", "bin") : undefined,
        home ? path.join(home, ".bun", "bin") : undefined,
        home ? path.join(home, ".bun", "install", "global", "bin") : undefined,
        home ? path.join(home, ".npm-global", "bin") : undefined,
        home ? path.join(home, ".codex-ultra", "bin") : undefined,
        ...versionManagerBins,
        npmPrefixBin,
        nvmBin,
        env.CODEX_UI_CODEX_INSTALL_DIRECTORY,
      ]
    : [
        opencodeInstallDir,
        xdgBinDir,
        ...kindHomeBins,
        home ? path.join(home, "bin") : undefined,
        home ? path.join(home, ".opencode", "bin") : undefined,
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/opt/bin",
        "/opt/node/bin",
        "/tools/node/bin",
        "/opt/homebrew/bin",
        "/home/linuxbrew/.linuxbrew/bin",
        "/home/linuxbrew/.linuxbrew/sbin",
        home ? path.join(home, ".linuxbrew", "bin") : undefined,
        "/snap/bin",
        "/var/lib/snapd/snap/bin",
        // Flatpak / Nix（Linux 另类包管理器）
        "/var/lib/flatpak/exports/bin",
        home ? path.join(home, ".local", "share", "flatpak", "exports", "bin") : undefined,
        home ? path.join(home, ".nix-profile", "bin") : undefined,
        "/nix/var/nix/profiles/default/bin",
        // Go 工具链
        home ? path.join(home, "go", "bin") : undefined,
        gopathBin,
        home ? path.join(home, ".local", "bin") : undefined,
        home ? path.join(home, ".cargo", "bin") : undefined,
        home ? path.join(home, ".bun", "bin") : undefined,
        home ? path.join(home, ".bun", "install", "global", "bin") : undefined,
        home ? path.join(home, ".npm-global", "bin") : undefined,
        home ? path.join(home, ".codex-ultra", "bin") : undefined,
        ...versionManagerBins,
        npmPrefixBin,
        nvmBin,
      ];
  for (const extra of extras) {
    if (extra && !dirs.includes(extra)) {
      dirs.push(extra);
    }
  }
  return dirs;
}

/**
 * Binary names per kind（如 codecli fork 的 claudecode，grok 的 agent）are
 * owned by each backend's plugin (`discovery.binaryNames`, see
 * pluginHost.ts) — the host no longer keeps its own table. The v2 plugin
 * registers both `opencode2` (side-by-side launcher) and `opencode`, and
 * qualifies candidates by name or probed version in its `matchesKind`.
 */

/** Collect every on-disk location that looks like a codex/claude CLI launcher. */
export function enumerateCliCandidates(
  kind: CliSelectionKind,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const found = new Set<string>();
  // The env override chain is the plugin's discovery knowledge, in the
  // plugin's priority order; first non-empty value wins (|| semantics).
  const discovery = cliDiscoveryForKind(kind);
  const configured = discovery.envBinVars
    .map((name) => env[name])
    .find((value) => value);
  if (configured && isLaunchableCandidate(configured, platform)) {
    found.add(configured);
  }
  const preferred = getPreferredCliBinary(kind);
  if (preferred && isLaunchableCandidate(preferred, platform)) {
    found.add(preferred);
  }
  for (const dir of candidateDirectories(env, platform)) {
    if (platform === "win32") {
      for (const binName of discovery.binaryNames) {
        for (const extension of windowsExecutableExtensions(env)) {
          const candidate = path.join(dir, `${binName}${extension}`);
          if (isLaunchableCandidate(candidate, platform)) {
            found.add(candidate);
            break;
          }
        }
      }
    } else {
      for (const binName of discovery.binaryNames) {
        const candidate = path.join(dir, binName);
        if (isLaunchableCandidate(candidate, platform)) {
          found.add(candidate);
        }
      }
    }
  }
  return [...found];
}

/** Every CLI backend that can be probed for on-disk installations. */
export const ALL_CLI_KINDS: readonly CliSelectionKind[] = [
  "codex",
  "claude",
  "agy",
  "auggie",
  "cline",
  "command-code",
  "grok",
  "pi",
  "opencode",
  "opencode-v2",
  "muse",
];

/**
 * Parse the `?kinds=a,b` query of `GET /api/cli/installations`.
 * Unknown entries are dropped; an empty/missing value means "all kinds"
 * so older clients keep working. Only the returned kinds get probed, which
 * keeps startup lazy: the UI asks only for the active conversation backend.
 */
export function parseRequestedCliKinds(raw: string | null | undefined): CliSelectionKind[] {
  if (!raw || !raw.trim()) {
    return [...ALL_CLI_KINDS];
  }
  const seen = new Set<CliSelectionKind>();
  for (const part of raw.split(",")) {
    const kind = part.trim().toLowerCase();
    if ((ALL_CLI_KINDS as readonly string[]).includes(kind)) {
      seen.add(kind as CliSelectionKind);
    }
  }
  return seen.size > 0 ? [...seen] : [...ALL_CLI_KINDS];
}

/** Run `<cli> --version` and parse a `x.y.z` version out of the output. */
export function probeCliVersion(
  command: string,
  args: string[] = ["--version"],
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<string | undefined> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (version?: string) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise(version);
      }
    };
    let child;
    try {
      child = spawnCodexCommand(command, args, {});
    } catch {
      finish(undefined);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(undefined);
    }, timeoutMs);
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.on("error", () => finish(undefined));
    child.on("close", () => {
      const match = output.match(/(\d+\.\d+\.\d+)/) ?? output.match(/(\d+\.\d+)/);
      finish(match?.[1]);
    });
  });
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((part) => Number.parseInt(part, 10));
  const partsB = b.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(partsA.length, partsB.length);
  for (let index = 0; index < length; index += 1) {
    const valueA = Number.isFinite(partsA[index]) ? partsA[index]! : 0;
    const valueB = Number.isFinite(partsB[index]) ? partsB[index]! : 0;
    if (valueA !== valueB) {
      return valueA - valueB;
    }
  }
  return 0;
}

/**
 * The opencode v1/v2 kinds share binary names: the v2 package registers both
 * `opencode2` (dedicated launcher) and a plain `opencode`, and a v1 install
 * dir can sit next to a v2 one. Qualify by launcher name or probed major
 * version so each kind's list only claims binaries its bridge can drive —
 * mirroring findOpencodeV2Bin's rule on the bridge side.
 */
export function installationMatchesKind(
  kind: CliSelectionKind,
  entry: { path: string; version?: string },
): boolean {
  // Qualification is the plugin's own rule (`discovery.matchesKind`):
  // for the opencode pair it is the launcher-name / probed-major-version
  // rule quoted above; every other plugin accepts all its candidates.
  return cliDiscoveryForKind(kind).matchesKind(entry);
}

/**
 * Enumerate every installed CLI of the given kind, probe versions in parallel
 * and return entries sorted newest-first (unknown versions last).
 */
export async function listCliInstallations(
  kind: CliSelectionKind,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<CliInstallationEntry[]> {
  const candidates = enumerateCliCandidates(kind, env, platform);
  const probed = (await Promise.all(candidates.map(async (candidate) => ({
    path: candidate,
    version: await probeCliVersion(candidate),
    source: path.dirname(candidate),
  })))).filter((entry) => installationMatchesKind(kind, entry));
  // Two paths can point at one binary (a .cmd shim and its .exe); keep the
  // highest-version entry per distinct version+path pair, deduping only exact
  // duplicates so genuinely different installs stay listed.
  const unique = new Map<string, CliInstallationEntry>();
  for (const entry of probed) {
    // win32 文件系统大小写不敏感才折叠；posix 上 Codex 与 codex 可能是两个文件。
    unique.set(platform === "win32" ? entry.path.toLowerCase() : entry.path, entry);
  }
  return [...unique.values()].sort((a, b) => {
    if (a.version && b.version && a.version !== b.version) {
      return compareVersions(b.version, a.version);
    }
    if (a.version && !b.version) return -1;
    if (!a.version && b.version) return 1;
    return a.path.localeCompare(b.path);
  });
}

/** Background refresh of the latest-known cache; deduped per kind. */
export function ensureCliInstallationsCached(
  kind: CliSelectionKind,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const inflight = getInflightCliRefresh(kind);
  if (inflight) {
    return inflight;
  }
  const promise = listCliInstallations(kind, env, platform)
    .then((installations) => {
      storeLatestCliCache(kind, installations, installations[0]?.path);
    })
    .catch(() => {
      /* leave previous cache (if any) in place */
    })
    .finally(() => {
      setInflightCliRefresh(kind, undefined);
    });
  setInflightCliRefresh(kind, promise);
  return promise;
}

export interface CliKindStatus {
  installations: CliInstallationEntry[];
  preferredPath: string | null;
  effectivePath: string;
}

export function buildCliKindStatus(
  kind: CliSelectionKind,
  effectivePath: string,
  installations: CliInstallationEntry[],
): CliKindStatus {
  // 枚举为空 = 磁盘上没有可启动的该 kind 二进制，直接返回空列表，让前端
  // 显示"未检测到其他版本"。不要用 effectivePath 伪造一条 version 缺失的
  // 记录：effectivePath 经常只是裸命令名（"claude"），伪造行会渲染成
  // "未知版本 + 当前使用 ✓"，把"没装"伪装成"发现失败"，之前所有加目录的
  // 修复都被这行兜底掩盖，所以"改了很多次都没改好"。effectivePath 仍原样
  // 返回，后端 spawn 回退（PATH 解析）继续依赖它。
  return {
    installations: installations ?? [],
    preferredPath: getPreferredCliBinary(kind),
    effectivePath,
  };
}
