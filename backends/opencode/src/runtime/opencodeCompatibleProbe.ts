import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pluginHostServices } from "@cxu/sdk-backend";

export interface OpencodeCliProbeResult {
  available: boolean;
  binPath: string;
  version?: string;
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

/**
 * Find the opencode binary path, respecting env overrides, preferred user selection,
 * and standard candidate locations.
 *
 * Priority: override env > preferred selection > cached latest >
 * PATH enumeration > install-dir disk fallbacks > bare binary name.
 */
export function findOpencodeBin(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OPENCODE_BIN || env.CODEX_UI_OPENCODE_BIN;
  // An explicit override is authoritative even before the file is installed;
  // probing it will surface the actionable spawn error to the caller.
  if (configured && typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  const preferred = pluginHostServices().cli.getPreferredCliBinary("opencode");
  if (preferred && isLaunchable(preferred)) {
    return preferred;
  }
  const latestCached = pluginHostServices().cli.getCachedLatestCliPath("opencode");
  if (latestCached && isLaunchable(latestCached)) {
    return latestCached;
  }
  // 优先用 PATH 解析到的真实安装（npm 的 opencode.cmd / opencode.exe），
  // 而不是源码树下不可执行的 POSIX 脚本
  const candidates = pluginHostServices().cli.enumerateCliCandidates("opencode", env, process.platform);
  if (candidates.length > 0) {
    return candidates[0]!;
  }
  // 服务端最小 PATH 兜底：按 opencode 官方安装优先级逐个直读物理磁盘。
  // curl 安装 -> $OPENCODE_INSTALL_DIR / $XDG_BIN_DIR / $HOME/bin / $HOME/.opencode/bin
  // npm -g -> $(npm prefix -g)/bin, bun -g -> ~/.bun/bin, brew -> linuxbrew, paru -> /usr/bin
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const exeName = process.platform === "win32" ? "opencode.exe" : "opencode";
  const configuredDirOrBin = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    return isLaunchable(trimmed) ? trimmed : join(trimmed, exeName);
  };
  const fallbacks: Array<string | undefined> = [
    configuredDirOrBin(env.OPENCODE_INSTALL_DIR),
    configuredDirOrBin(env.XDG_BIN_DIR),
    env.npm_config_prefix ? join(env.npm_config_prefix, "bin", exeName) : undefined,
    env.NVM_BIN?.trim() ? join(env.NVM_BIN.trim(), exeName) : undefined,
    home ? join(home, "bin", exeName) : undefined,
    home ? join(home, ".opencode", "bin", exeName) : undefined,
    home ? join(home, ".bun", "bin", exeName) : undefined,
    home ? join(home, ".bun", "install", "global", "bin", exeName) : undefined,
    home ? join(home, ".npm-global", "bin", exeName) : undefined,
    home ? join(home, ".codex-ultra", "bin", exeName) : undefined,
    home ? join(home, ".linuxbrew", "bin", exeName) : undefined,
    process.platform === "win32" ? undefined : "/tools/node/bin/opencode",
    process.platform === "win32" ? undefined : "/usr/local/bin/opencode",
    process.platform === "win32" ? undefined : "/usr/bin/opencode",
    process.platform === "win32" ? undefined : "/opt/bin/opencode",
    process.platform === "win32" ? undefined : "/opt/homebrew/bin/opencode",
    process.platform === "win32" ? undefined : "/home/linuxbrew/.linuxbrew/bin/opencode",
  ];
  for (const candidate of fallbacks) {
    if (candidate && isLaunchable(candidate)) return candidate;
  }

  return "opencode";
}

export function parseOpencodeModelsOutput(output: string): string[] {
  return parseOpencodeModelsVerboseOutput(output).map((m) => m.id);
}

export interface OpencodeModelDetail {
  /** 完整目录引用，如 `opencode/big-pickle` 或 `openrouter/anthropic/claude-sonnet-4.5`（首个 `/` 之前为 provider）。 */
  id: string;
  provider: string;
  model: string;
  /** `opencode models --verbose` 附带的 JSON 元数据（costs/limit/capabilities 等），非 verbose 输出为 undefined。 */
  detail?: Record<string, unknown>;
}

const OPENCODE_MODEL_ID_RE = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\/(\S+)$/;

/**
 * 解析 `opencode models [--verbose]` 输出。
 * verbose 模式每组为 `provider/model` 首行 + 缩进 JSON 块，直接用 ID 正则会把 JSON
 * 噪音误判或漏掉多斜杠 ID，这里按行状态机提取：ID 行开始一组，后续 `{...}`
 * 平衡括号收集团为 detail。
 */
export function parseOpencodeModelsVerboseOutput(output: string): OpencodeModelDetail[] {
  const models: OpencodeModelDetail[] = [];
  const seen = new Set<string>();
  const lines = output.split(/\r?\n/);
  let pending: OpencodeModelDetail | undefined;
  let jsonLines: string[] = [];
  let braceDepth = 0;
  const flushPending = () => {
    if (!pending) return;
    if (jsonLines.length > 0) {
      const text = jsonLines.join("\n");
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          pending.detail = parsed as Record<string, unknown>;
        }
      } catch {
        // JSON 截断或非 JSON 噪音时保留无 detail 的 ID 行
      }
    }
    if (!seen.has(pending.id)) {
      seen.add(pending.id);
      models.push(pending);
    }
    pending = undefined;
    jsonLines = [];
    braceDepth = 0;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const idMatch = line.match(OPENCODE_MODEL_ID_RE);
    // JSON 块内行优先计入 detail（`{`/`}`/`"key": ...`），避免把 URL 等误判为模型
    if (braceDepth > 0 || line.startsWith("{")) {
      if (pending) {
        jsonLines.push(line);
        braceDepth += (line.match(/\{/g) ?? []).length;
        braceDepth -= (line.match(/\}/g) ?? []).length;
        if (braceDepth <= 0) {
          braceDepth = 0;
          flushPending();
        }
      }
      continue;
    }
    if (line.startsWith("}") || line.startsWith('"') || line.startsWith("[") || line.startsWith("]")) {
      continue;
    }
    if (!idMatch) continue; // dropped: "[claude-mem] ..." 这类噪音行
    // 上一组无 JSON 的 ID 行直接落盘，再开始新组
    flushPending();
    const provider = idMatch[1]!;
    const model = idMatch[2]!;
    pending = { id: `${provider}/${model}`, provider, model };
  }
  flushPending();
  return models;
}

function runOpencodeModelsCommand(
  args: string[],
  bin: string | undefined,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string> {
  const command = bin && bin.trim() ? bin.trim() : findOpencodeBin(env);
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (v: string) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(v);
      }
    };
    try {
      const child = pluginHostServices().codex.spawnCodexCommand(command, args, {
        env: { ...process.env, ...env },
      });
      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        done(output);
      }, timeoutMs);
      child.stdout?.on("data", (c: Buffer | string) => {
        output += c.toString();
      });
      child.stderr?.on("data", (c: Buffer | string) => {
        output += c.toString();
      });
      child.on("error", () => done(output));
      child.on("close", () => done(output));
    } catch {
      done(output);
    }
  });
}

export function listOpencodeModelsAsync(
  bin?: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 30_000,
): Promise<string[]> {
  return runOpencodeModelsCommand(["models"], bin, env, timeoutMs).then(parseOpencodeModelsOutput);
}

/**
 * 判断模型是否为 OpenCode 免费模型。
 * 判定依据：
 * 1. 模型 ID（去掉 opencode/ 前缀后）匹配知名免费模型（如 big-pickle）或以 `-free` / `:free` 结尾；
 * 2. 或 detail 中明确声明 cost.input === 0 && cost.output === 0。
 */
export function isOpencodeFreeModel(id: string, detail?: Record<string, unknown>): boolean {
  if (!id || typeof id !== "string") return false;
  const normalized = id.toLowerCase().trim();
  const bare = normalized.replace(/^opencode\//i, "");
  if (bare === "big-pickle" || bare.endsWith("-free") || bare.endsWith(":free")) {
    return true;
  }
  if (detail && typeof detail === "object") {
    const cost = (detail as { cost?: { input?: unknown; output?: unknown } }).cost;
    if (cost && typeof cost === "object") {
      const input = Number(cost.input ?? 0);
      const output = Number(cost.output ?? 0);
      if (input === 0 && output === 0) {
        return true;
      }
    }
  }
  return false;
}

export function filterOpencodeFreeModels(models: string[]): string[] {
  return models.filter((m) => isOpencodeFreeModel(m));
}

export function listOpencodeFreeModelsAsync(
  bin?: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 30_000,
): Promise<string[]> {
  return listOpencodeModelsAsync(bin, env, timeoutMs).then(filterOpencodeFreeModels);
}

/**
 * `opencode models --verbose` 详细列表（含 costs/limit/capabilities 等元数据）。
 * 二进制缺失或执行失败时返回空数组；调用方应回退到 `listOpencodeModelsAsync` 的 ID 列表。
 */
export function listOpencodeModelDetailsAsync(
  bin?: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 30_000,
): Promise<OpencodeModelDetail[]> {
  return runOpencodeModelsCommand(["models", "--verbose"], bin, env, timeoutMs).then(parseOpencodeModelsVerboseOutput);
}

/**
 * Probe an explicit opencode CLI binary for version and availability.
 */
export function probeOpencodeCliCommand(bin: string, env: NodeJS.ProcessEnv = process.env): OpencodeCliProbeResult {
  try {
    const resolved = pluginHostServices().codex.resolveCodexSpawn(bin, ["--version"], process.platform, env);
    const proc = spawnSync(resolved.command, resolved.args, {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      windowsVerbatimArguments: resolved.usesCommandShim && !/\.ps1$/i.test(bin),
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
 * Minimum opencode binary version our headless contract (`serve` +
 * `/session` + `/session/:id/prompt_async` + `/event` SSE + Basic auth)
 * is verified against. Older binaries stay usable (404 fallbacks cover
 * API variance) but get a startup warning so version drift is visible
 * instead of silent. Keep this a warning, never a hard block: refusing
 * to start would break working setups on older-but-compatible binaries.
 */
export const OPENCODE_MIN_SUPPORTED_VERSION = "1.0.0";

/** Numeric semver compare: -1 | 0 | 1. Non-numeric segments compare as 0. */
export function compareOpencodeVersion(a: string, b: string): number {
  const pa = String(a ?? "").trim().split(".").map((n) => Number.parseInt(n, 10));
  const pb = String(b ?? "").trim().split(".").map((n) => Number.parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(pa[i]) ? (pa[i] as number) : 0;
    const y = Number.isFinite(pb[i]) ? (pb[i] as number) : 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** True when the probed version meets the supported floor. Unknown version => true (warn elsewhere). */
export function isOpencodeVersionSupported(version: string | undefined): boolean {
  if (!version || !version.trim()) return true;
  return compareOpencodeVersion(version, OPENCODE_MIN_SUPPORTED_VERSION) >= 0;
}

/**
 * OpenCode v2 is a separate backend from v1: `serve` moved to a new HTTP
 * API (`/api/session*`, `/api/event`) and the v1 pass-through plugin
 * hook no longer exists, so a v2 binary must never be picked up by the
 * v1 finder (and vice versa). Officially both lines ship from one
 * product: the v2 package (`@opencode/cli`, installer
 * `https://opencode.ai/v2/install`) registers TWO commands, `opencode`
 * and `opencode2`, into the same install dirs as v1 (e.g.
 * `~/.opencode/bin`); `opencode2` is the side-by-side v2 launcher name,
 * while a v2 install may also own the plain `opencode` name (its
 * `--version` prints `opencode v2.1.3`, vs v1's bare `1.19.4`).
 * Resolution therefore accepts an `opencode2`-named candidate on its
 * name, and a plain `opencode` candidate only when its probed version
 * is >= 2.0.0. An explicit override (`OPENCODE_V2_BIN` /
 * `CODEX_UI_OPENCODE_V2_BIN`) stays authoritative, mirroring v1.
 */
export const OPENCODE_V2_MIN_VERSION = "2.0.0";

/** True when the probed version belongs to the v2 line. Unknown version => false. */
export function isOpencodeV2Version(version: string | undefined): boolean {
  if (!version || !version.trim()) return false;
  return compareOpencodeVersion(version, OPENCODE_V2_MIN_VERSION) >= 0;
}

export function findOpencodeV2Bin(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OPENCODE_V2_BIN || env.CODEX_UI_OPENCODE_V2_BIN;
  if (configured && typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const exeName = process.platform === "win32" ? "opencode.exe" : "opencode";
  const v2ExeName = process.platform === "win32" ? "opencode2.exe" : "opencode2";
  const qualifies = (candidate: string): boolean => {
    if (!isLaunchable(candidate)) return false;
    const probe = probeOpencodeCliCommand(candidate, env);
    if (!probe.available) return false;
    if (basename(candidate).toLowerCase().startsWith("opencode2")) return true;
    return isOpencodeV2Version(probe.version);
  };
  const candidates: string[] = [];
  const preferred = pluginHostServices().cli.getPreferredCliBinary("opencode-v2");
  if (preferred) candidates.push(preferred);
  const cached = pluginHostServices().cli.getCachedLatestCliPath("opencode-v2");
  if (cached) candidates.push(cached);
  const dirs: Array<string | undefined> = [
    env.OPENCODE_V2_INSTALL_DIR?.trim() || undefined,
    home ? join(home, ".opencode-v2", "bin") : undefined,
    env.OPENCODE_INSTALL_DIR?.trim() || undefined,
    env.XDG_BIN_DIR?.trim() || undefined,
    home ? join(home, ".opencode", "bin") : undefined,
    home ? join(home, "bin") : undefined,
    home ? join(home, ".bun", "bin") : undefined,
    home ? join(home, ".npm-global", "bin") : undefined,
  ];
  for (const dir of dirs) if (dir) candidates.push(join(dir, v2ExeName));
  for (const candidate of pluginHostServices().cli.enumerateCliCandidates("opencode-v2", env, process.platform)) candidates.push(candidate);
  for (const dir of dirs) if (dir) candidates.push(join(dir, exeName));
  for (const candidate of pluginHostServices().cli.enumerateCliCandidates("opencode", env, process.platform)) candidates.push(candidate);
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (qualifies(candidate)) return candidate;
  }
  return "";
}
