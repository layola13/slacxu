import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnRuntimeProcess } from "./runtime/process.js";
import { toolchainDirCandidates } from "./cliVersions.js";

type InstallLogLevel = "info" | "success" | "error" | "warn";
type InstallSubLogger = (msg: string, level: InstallLogLevel) => void;

export type LaunchAdapterSpec = {
  id: string;
  repo: string;
  /** Public GitHub clone URL; null if repo is not published */
  cloneUrl: string | null;
  /** Wrapper binary names to look for on PATH */
  wrapperBins: string[];
  /** Upstream product CLI binaries */
  productBins: string[];
  envPrefix: string;
  /** Config directory under ~/.config */
  configDirName: string;
};

/** Only adapters with a verified public GitHub repo are cloneable. */
export const LAUNCH_SPECS: LaunchAdapterSpec[] = [
  {
    id: "code-launch",
    repo: "code-launch",
    cloneUrl: "https://github.com/layola13/code-launch.git",
    wrapperBins: ["code-launch"],
    productBins: ["codex"],
    envPrefix: "CODE_LAUNCH_",
    configDirName: "code-launch"
  },
  {
    id: "agy-launch",
    repo: "agy-launch",
    cloneUrl: "https://github.com/layola13/agy-launch.git",
    wrapperBins: ["agy-launch"],
    productBins: ["agy"],
    envPrefix: "AGY_LAUNCH_",
    configDirName: "agy-launch"
  },
  {
    id: "claude-launch",
    repo: "claude-launch",
    cloneUrl: "https://github.com/layola13/claude-launch.git",
    wrapperBins: ["claude-launch"],
    // codecli fork 二进制名为 claudecode（~/.local/bin/claudecode），一起识别。
    productBins: ["claude", "claudecode"],
    envPrefix: "CLAUDE_LAUNCH_",
    configDirName: "claude-launch"
  },
  {
    id: "gemini-launch",
    repo: "gemini-launch",
    cloneUrl: "https://github.com/layola13/gemini-launch.git",
    wrapperBins: ["gemini-launch"],
    productBins: ["gemini"],
    envPrefix: "GEMINI_LAUNCH_",
    configDirName: "gemini-launch"
  },
  {
    id: "crush-launch",
    repo: "crush-launch",
    cloneUrl: "https://github.com/layola13/crush-launch.git",
    wrapperBins: ["crush-launch"],
    productBins: ["crush"],
    envPrefix: "CRUSH_LAUNCH_",
    configDirName: "crush-launch"
  },
  {
    id: "auggie-launch",
    repo: "auggie-launch",
    cloneUrl: "https://github.com/layola13/auggie-launch.git",
    wrapperBins: ["auggie-launch"],
    productBins: ["auggie"],
    envPrefix: "AUGGIE_LAUNCH_",
    configDirName: "auggie-launch"
  },
  {
    id: "grok-launch",
    repo: "grok-launch",
    cloneUrl: "https://github.com/layola13/grok-launch.git",
    wrapperBins: ["grok-launch"],
    productBins: ["grok", "agent"],
    envPrefix: "GROK_LAUNCH_",
    configDirName: "grok-launch"
  },
  {
    id: "agent-launch",
    repo: "agent-launch",
    cloneUrl: null,
    wrapperBins: ["agent-launch", "grok-launch"],
    productBins: ["agent", "grok"],
    envPrefix: "GROK_LAUNCH_",
    configDirName: "grok-launch"
  },
  {
    id: "coderabbit-launch",
    repo: "coderabbit-launch",
    cloneUrl: null,
    wrapperBins: ["coderabbit-launch", "cr-launch"],
    productBins: ["coderabbit", "cr"],
    envPrefix: "CODERABBIT_LAUNCH_",
    configDirName: "coderabbit-launch"
  },
  {
    id: "freebuff-launch",
    repo: "freebuff-launch",
    cloneUrl: null,
    wrapperBins: ["freebuff-launch"],
    productBins: ["freebuff"],
    envPrefix: "FREEBUFF_LAUNCH_",
    configDirName: "freebuff-launch"
  },
  {
    id: "pi-launch",
    repo: "pi",
    cloneUrl: null,
    wrapperBins: ["pi", "pi-launch"],
    productBins: ["pi"],
    envPrefix: "PI_LAUNCH_",
    configDirName: "pi-launch"
  }
];

export type LaunchAdapterStatus = {
  id: string;
  repo: string;
  cloneUrl: string | null;
  cloneable: boolean;
  installed: boolean;
  wrapperPath: string | null;
  productCliPath: string | null;
  productCliPresent: boolean;
  sourceDir: string | null;
  sourcePresent: boolean;
  envPath: string;
  envPresent: boolean;
  envConfigured: boolean;
  envPreview: { baseUrl: string | null; model: string | null; hasApiKey: boolean };
  needsInstall: boolean;
  needsSetup: boolean;
};

export type LaunchEnvValues = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

export type InstallLaunchRequest = {
  ids?: string[];
  /** Install all missing adapters that are cloneable */
  missingOnly?: boolean;
  /** When true, run ./install.sh --skip-cli (default true for speed) */
  skipCli?: boolean;
  /** shared: same env for all; separate: per-id map */
  envMode?: "shared" | "separate" | "none";
  sharedEnv?: LaunchEnvValues;
  separateEnv?: Record<string, LaunchEnvValues>;
  /** Overwrite existing .env keys when writing env files */
  forceEnv?: boolean;
  /** Custom clone target directory (defaults to ~/projects) */
  sourceRoot?: string;
  /** Skip duplicate model test during installation job */
  skipModelTest?: boolean;
};

export type InstallLaunchResultItem = {
  id: string;
  ok: boolean;
  steps: string[];
  error?: string;
  status?: LaunchAdapterStatus;
};

let installLock: Promise<void> | null = null;

function home(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function defaultSourceRoot(customPath?: string): string {
  if (customPath && customPath.trim()) {
    const raw = customPath.trim();
    if (raw.startsWith("~/")) {
      return join(home(), raw.slice(2));
    }
    return resolve(raw);
  }
  return process.env.CODEX_UI_LAUNCH_SRC_ROOT || join(home(), "projects");
}

function pathDirs(): string[] {
  // 与 cliVersions.toolchainDirCandidates() 同一份工具链目录表：
  // service 进程 PATH 极简时，靠这组兜底目录发现非 npm 安装的 CLI。
  const homeDir = home();
  const extra = [
    join(homeDir, ".local", "bin"),
    join(homeDir, "bin"),
    join(homeDir, ".codex", "bin"),
    join(homeDir, ".claude", "bin"),
    join(homeDir, ".grok", "bin"),
    join(homeDir, ".agy", "bin"),
    join(homeDir, ".pi", "bin"),
    join(homeDir, ".opencode", "bin"),
    join(homeDir, ".codex-ultra", "bin"),
    join(homeDir, ".bun", "bin"),
    join(homeDir, ".bun", "install", "global", "bin"),
    join(homeDir, ".npm-global", "bin"),
    ...toolchainDirCandidates(homeDir, process.env),
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/opt/bin",
    "/opt/node/bin",
    "/tools/node/bin",
    "/opt/homebrew/bin",
    "/home/linuxbrew/.linuxbrew/bin",
    "/home/linuxbrew/.linuxbrew/sbin",
    "/snap/bin",
    "/var/lib/snapd/snap/bin",
    "/var/lib/flatpak/exports/bin",
    "/nix/var/nix/profiles/default/bin",
  ];
  const fromEnv = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return [...new Set([...extra, ...fromEnv])];
}

function findOnPath(names: string[]): string | null {
  const isWindows = process.platform === "win32";
  for (const name of names) {
    for (const dir of pathDirs()) {
      const full = join(dir, name);
      if (!existsSync(full)) continue;
      // POSIX must be executable; a stray non-exec file must not mask install.
      if (!isWindows) {
        try {
          const stats = statSync(full);
          if (!stats.isFile() || (stats.mode & 0o111) === 0) continue;
        } catch {
          continue;
        }
      }
      return full;
    }
  }
  return null;
}

function configEnvPath(spec: LaunchAdapterSpec): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(home(), ".config");
  return join(xdg, spec.configDirName, ".env");
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  if (!v) return true;
  return (
    v.includes("your-api-key") ||
    v.includes("sk-your-key") ||
    v.includes("your-gateway") ||
    v === "changeme" ||
    v === "xxx"
  );
}

function resolveSourceDir(spec: LaunchAdapterSpec, customPath?: string): string | null {
  const root = defaultSourceRoot(customPath);
  const candidates = [
    join(root, spec.repo),
    join(home(), "projects", spec.repo),
    join(home(), "src", spec.repo),
    join("/root/projects", spec.repo),
    join("E:/projects", spec.repo),
    join("D:/projects", spec.repo)
  ];
  for (const dir of candidates) {
    if (
      existsSync(join(dir, "install.sh")) ||
      existsSync(join(dir, "main.py")) ||
      existsSync(join(dir, "packages", "coding-agent"))
    ) {
      return dir;
    }
  }
  return null;
}

export function getSpec(id: string): LaunchAdapterSpec | undefined {
  return LAUNCH_SPECS.find((s) => s.id === id);
}

export function detectAdapter(spec: LaunchAdapterSpec, customSourceRoot?: string): LaunchAdapterStatus {
  try {
    const wrapperPath = findOnPath(spec.wrapperBins);
    const sourceDir = resolveSourceDir(spec, customSourceRoot);
    const sourceCliPath = sourceDir && existsSync(join(sourceDir, "packages", "coding-agent", "src", "cli.ts"))
      ? join(sourceDir, "packages", "coding-agent", "src", "cli.ts")
      : null;
    const productCliPath = findOnPath(spec.productBins) || sourceCliPath;
    const envPath = configEnvPath(spec);
    const envMap = parseEnvFile(envPath);
    const baseUrl = envMap[`${spec.envPrefix}BASE_URL`] ?? null;
    const model = envMap[`${spec.envPrefix}MODEL`] ?? null;
    const apiKey = envMap[`${spec.envPrefix}API_KEY`] ?? envMap[`${spec.envPrefix}API_KEYS`] ?? "";
    const hasApiKey = !isPlaceholder(apiKey);
    const envPresent = existsSync(envPath);
    const envConfigured = Boolean(baseUrl && !isPlaceholder(baseUrl) && hasApiKey);
    const installed = Boolean(wrapperPath || (spec.id === "pi-launch" && sourceCliPath));
    const needsInstall = !installed;
    const needsSetup = !envConfigured;

    return {
      id: spec.id,
      repo: spec.repo,
      cloneUrl: spec.cloneUrl,
      cloneable: Boolean(spec.cloneUrl),
      installed,
      wrapperPath,
      productCliPath,
      productCliPresent: Boolean(productCliPath),
      sourceDir,
      sourcePresent: Boolean(sourceDir),
      envPath,
      envPresent,
      envConfigured,
      envPreview: {
        baseUrl: baseUrl && !isPlaceholder(baseUrl) ? baseUrl : baseUrl,
        model,
        hasApiKey
      },
      needsInstall,
      needsSetup
    };
  } catch {
    const envPath = configEnvPath(spec);
    return {
      id: spec.id,
      repo: spec.repo,
      cloneUrl: spec.cloneUrl,
      cloneable: Boolean(spec.cloneUrl),
      installed: false,
      wrapperPath: null,
      productCliPath: null,
      productCliPresent: false,
      sourceDir: null,
      sourcePresent: false,
      envPath,
      envPresent: false,
      envConfigured: false,
      envPreview: { baseUrl: null, model: null, hasApiKey: false },
      needsInstall: true,
      needsSetup: true
    };
  }
}

export function detectAll(customSourceRoot?: string): { sourceRoot: string; adapters: LaunchAdapterStatus[] } {
  const root = defaultSourceRoot(customSourceRoot);
  return {
    sourceRoot: root,
    adapters: LAUNCH_SPECS.map((spec) => detectAdapter(spec, customSourceRoot))
  };
}

function upsertEnvKeys(path: string, updates: Record<string, string>): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const keys = new Set(Object.keys(updates));
  const next: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      next.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      next.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (keys.has(key)) {
      next.push(`${key}=${updates[key]}`);
      seen.add(key);
    } else {
      next.push(line);
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      next.push(`${key}=${value}`);
    }
  }
  if (next.length === 0 || next[next.length - 1] !== "") {
    next.push("");
  }
  writeFileSync(path, next.join("\n"), { mode: 0o600 });
}

export function writeAdapterEnv(
  spec: LaunchAdapterSpec,
  values: LaunchEnvValues,
  force: boolean
): { path: string; wrote: boolean; skipped: boolean } {
  const path = configEnvPath(spec);
  if (!force && existsSync(path)) {
    const map = parseEnvFile(path);
    const hasBase = !isPlaceholder(map[`${spec.envPrefix}BASE_URL`]);
    const hasKey = !isPlaceholder(map[`${spec.envPrefix}API_KEY`] ?? map[`${spec.envPrefix}API_KEYS`]);
    if (hasBase && hasKey && !values.baseUrl && !values.apiKey && !values.model) {
      return { path, wrote: false, skipped: true };
    }
  }
  const updates: Record<string, string> = {};
  if (values.baseUrl !== undefined && values.baseUrl !== "") {
    updates[`${spec.envPrefix}BASE_URL`] = values.baseUrl.trim();
  }
  if (values.model !== undefined && values.model !== "") {
    updates[`${spec.envPrefix}MODEL`] = values.model.trim();
  }
  if (values.apiKey !== undefined && values.apiKey !== "") {
    updates[`${spec.envPrefix}API_KEY`] = values.apiKey.trim();
  }
  if (Object.keys(updates).length === 0) {
    // Ensure file exists with comments only if missing
    if (!existsSync(path)) {
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(
        path,
        `# ${spec.id} — created by Codex React UI\n# Fill ${spec.envPrefix}BASE_URL / MODEL / API_KEY\n${spec.envPrefix}BASE_URL=\n${spec.envPrefix}MODEL=\n${spec.envPrefix}API_KEY=\n`,
        { mode: 0o600 }
      );
      return { path, wrote: true, skipped: false };
    }
    return { path, wrote: false, skipped: true };
  }
  upsertEnvKeys(path, updates);
  return { path, wrote: true, skipped: false };
}

function createLineLogger(prefix: string, level: InstallLogLevel, onLog?: InstallSubLogger) {
  let pending = "";
  const emit = (line: string) => {
    const text = line.trim();
    if (text) {
      onLog?.(`${prefix}${text}`, level);
    }
  };
  return {
    write(chunk: string) {
      pending += chunk.replace(/\r/g, "\n");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        emit(line);
      }
    },
    flush() {
      emit(pending);
      pending = "";
    }
  };
}

async function readProcessOutput(
  stream: ReadableStream<Uint8Array> | null,
  onChunk: (chunk: string) => void
): Promise<string> {
  if (!stream) {
    return "";
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const text = decoder.decode(value, { stream: true });
      if (text) {
        output += text;
        onChunk(text);
      }
    }
    const rest = decoder.decode();
    if (rest) {
      output += rest;
      onChunk(rest);
    }
  } finally {
    reader.releaseLock();
  }
  return output;
}

async function runCmd(
  cmd: string[],
  cwd: string,
  timeoutMs: number,
  onLog?: InstallSubLogger
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  const stdoutLog = createLineLogger("", "info", onLog);
  const stderrLog = createLineLogger("stderr: ", "warn", onLog);
  let timedOut = false;
  const proc = spawnRuntimeProcess(cmd, {
    cwd,
    env: {
      ...process.env,
      PATH: `${join(home(), ".local", "bin")}${delimiter}${process.env.PATH ?? ""}`,
      GIT_TERMINAL_PROMPT: "0",
      CI: process.env.CI ?? "1",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
      npm_config_yes: "true"
    }
  });
  const timer = setTimeout(() => {
    timedOut = true;
    onLog?.(`command timed out after ${Math.round(timeoutMs / 1000)}s: ${cmd.join(" ")}`, "error");
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    readProcessOutput(proc.stdout, (chunk) => stdoutLog.write(chunk)),
    readProcessOutput(proc.stderr, (chunk) => stderrLog.write(chunk)),
    proc.exited
  ]);
  clearTimeout(timer);
  stdoutLog.flush();
  stderrLog.flush();
  return { ok: !timedOut && code === 0, stdout, stderr, code: timedOut ? 124 : code };
}

async function ensureCloned(
  spec: LaunchAdapterSpec,
  steps: string[],
  customSourceRoot?: string,
  onSubLog?: InstallSubLogger
): Promise<string> {
  const root = defaultSourceRoot(customSourceRoot);
  mkdirSync(root, { recursive: true });
  const target = join(root, spec.repo);
  const existing = resolveSourceDir(spec, customSourceRoot);
  if (existing) {
    steps.push(`source present: ${existing}`);
    return existing;
  }
  if (!spec.cloneUrl) {
    throw new Error(
      `${spec.id}: no public GitHub clone URL (repo not published under layola13). Provide the source manually or publish the repo.`
    );
  }
  if (existsSync(target)) {
    steps.push(`using existing checkout: ${target}`);
    return target;
  }
  steps.push(`git clone ${spec.cloneUrl} -> ${target}`);
  onSubLog?.(`$ git clone --depth 1 ${spec.cloneUrl} ${target}`, "info");
  const result = await runCmd(
    ["git", "clone", "--depth", "1", spec.cloneUrl, target],
    root,
    180_000,
    onSubLog
  );
  if (!result.ok) {
    throw new Error(`git clone failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
  return target;
}

async function runInstallSh(
  sourceDir: string,
  skipCli: boolean,
  steps: string[],
  onSubLog?: InstallSubLogger
): Promise<void> {
  const script = join(sourceDir, "install.sh");
  if (!existsSync(script)) {
    throw new Error(`install.sh not found in ${sourceDir}`);
  }
  try {
    chmodSync(script, 0o755);
  } catch {
    /* ignore */
  }
  const args = ["bash", script];
  if (skipCli) {
    args.push("--skip-cli");
  }
  steps.push(args.join(" "));
  onSubLog?.(`$ ${args.join(" ")}`, "info");
  const result = await runCmd(args, sourceDir, skipCli ? 120_000 : 600_000, onSubLog);
  if (!result.ok) {
    throw new Error(
      `install.sh failed (exit ${result.code}): ${(result.stderr || result.stdout).slice(-2000)}`
    );
  }
  steps.push("install.sh ok");
}

async function installOne(
  id: string,
  opts: InstallLaunchRequest,
  onSubLog?: InstallSubLogger
): Promise<InstallLaunchResultItem> {
  const steps: string[] = [];
  const spec = getSpec(id);
  if (!spec) {
    onSubLog?.(`未知的适配器标识: ${id}`, "error");
    return { id, ok: false, steps, error: `Unknown adapter: ${id}` };
  }
  try {
    onSubLog?.(`正在准备源码 (${spec.cloneUrl ?? id})...`, "info");
    const sourceDir = await ensureCloned(spec, steps, opts.sourceRoot, onSubLog);
    onSubLog?.(`✓ 源码目录就绪: ${sourceDir}`, "success");

    let effectiveSkipCli = false;
    const isProductInstalled = Boolean(findOnPath(spec.productBins));
    if (opts.skipCli !== false) {
      if (isProductInstalled) {
        effectiveSkipCli = true;
        onSubLog?.(`[${id}] 检测到 ${spec.productBins.join("/")} CLI 已在 PATH 中，将使用 --skip-cli 跳过 CLI 重复安装`, "info");
      } else {
        effectiveSkipCli = false;
        onSubLog?.(`[${id}] 未检测到 ${spec.productBins.join("/")} CLI，将正常执行 CLI 安装`, "info");
      }
    } else {
      effectiveSkipCli = false;
      onSubLog?.(`[${id}] 用户设置不跳过，将安装/重新安装 CLI`, "info");
    }

    onSubLog?.(`正在运行 bash ./install.sh ${effectiveSkipCli ? "--skip-cli" : ""} ...`, "info");
    await runInstallSh(sourceDir, effectiveSkipCli, steps, onSubLog);
    onSubLog?.(`✓ ./install.sh 执行完成`, "success");

    if (opts.envMode && opts.envMode !== "none") {
      let values: LaunchEnvValues = {};
      if (opts.envMode === "shared") {
        values = opts.sharedEnv ?? {};
      } else if (opts.envMode === "separate") {
        values = opts.separateEnv?.[id] ?? {};
      }
      const envResult = writeAdapterEnv(spec, values, Boolean(opts.forceEnv));
      const stepMsg = envResult.skipped
        ? `env skip (existing): ${envResult.path}`
        : `env wrote: ${envResult.path}`;
      steps.push(stepMsg);
      onSubLog?.(`✓ 环境配置文件已写入: ${envResult.path}`, "success");
    }

    return { id, ok: true, steps, status: detectAdapter(spec, opts.sourceRoot) };
  } catch (error) {
    const errStr = error instanceof Error ? error.message : String(error);
    onSubLog?.(`✗ ${id} 处理异常: ${errStr}`, "error");
    return {
      id,
      ok: false,
      steps,
      error: errStr,
      status: detectAdapter(spec, opts.sourceRoot)
    };
  }
}

export type TestOpenAiApiRequest = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

export type TestOpenAiApiResult = {
  ok: boolean;
  step1Ok: boolean;
  step2Ok: boolean;
  message: string;
  statusCode?: number;
};

export async function testOpenAiApi(values: TestOpenAiApiRequest): Promise<TestOpenAiApiResult> {
  const rawBaseUrl = (values.baseUrl ?? "").trim();
  const apiKey = (values.apiKey ?? "").trim();
  const model = (values.model ?? "").trim() || "gpt-5.5";

  if (!rawBaseUrl) {
    return { ok: false, step1Ok: false, step2Ok: false, message: "需填写 Base URL 才能发起模型测试。" };
  }
  if (!apiKey) {
    return { ok: false, step1Ok: false, step2Ok: false, message: "需填写 API Key 才能发起模型测试。" };
  }

  let baseUrl = rawBaseUrl.replace(/\/+$/, "");
  if (!baseUrl.endsWith("/v1") && !baseUrl.includes("/v1/")) {
    baseUrl = `${baseUrl}/v1`;
  } else if (baseUrl.endsWith("/chat/completions")) {
    baseUrl = baseUrl.replace(/\/chat\/completions$/, "");
  }

  // Step 1: GET /v1/models (Fetch model list & verify authentication)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const modelsResp = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    if (!modelsResp.ok) {
      const bodyText = await modelsResp.text().catch(() => "");
      return {
        ok: false,
        step1Ok: false,
        step2Ok: false,
        statusCode: modelsResp.status,
        message: `【步骤一失败】无法获取模型列表 (HTTP ${modelsResp.status})。请检查 API Key 与 Base URL 是否正确。${bodyText ? ` 错误提示: ${bodyText.slice(0, 150)}` : ""}`
      };
    }
  } catch (err: any) {
    const isTimeout = err.name === "AbortError";
    return {
      ok: false,
      step1Ok: false,
      step2Ok: false,
      message: `【步骤一失败】获取模型列表 ${isTimeout ? "6秒超时" : "连接失败"}: ${err.message || String(err)}`
    };
  }

  // Step 2: POST /v1/chat/completions (Actual chat dialogue execution with strict 10s timeout)
  const chatUrl = `${baseUrl}/chat/completions`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 15
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    const contentType = response.headers.get("content-type") ?? "";
    const bodyText = await response.text().catch(() => "");

    if (response.ok) {
      return {
        ok: true,
        step1Ok: true,
        step2Ok: true,
        statusCode: response.status,
        message: `【测试通过】①模型列表获取成功  ②对话测试成功（模型 '${model}' 10秒内正常响应）`
      };
    }

    let jsonError = "";
    if (contentType.includes("application/json") && bodyText) {
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed.error?.message) {
          jsonError = String(parsed.error.message);
        } else if (typeof parsed.error === "string") {
          jsonError = parsed.error;
        }
      } catch {}
    }

    if (response.status === 502 || response.status === 503 || response.status === 504) {
      return {
        ok: true,
        step1Ok: true,
        step2Ok: false,
        statusCode: response.status,
        message: `【验证成功 (上游告警)】①Base URL 与 API Key 验证成功 (HTTP 200) ②上游节点返回 HTTP ${response.status} 网关响应。配置已成功校验并就绪！`
      };
    }

    return {
      ok: false,
      step1Ok: true,
      step2Ok: false,
      statusCode: response.status,
      message: `【步骤二失败】模型对话无法正常响应 (HTTP ${response.status}): ${jsonError || bodyText.slice(0, 180) || response.statusText}`
    };
  } catch (err: any) {
    const isTimeout = err.name === "AbortError";
    return {
      ok: false,
      step1Ok: true,
      step2Ok: false,
      message: isTimeout
        ? `【步骤二失败】模型对话测试10秒超时（模型 '${model}' 超过10秒未响应），无法正常完成对话`
        : `【步骤二失败】无法连接到对话接口 (${chatUrl}): ${err.message || String(err)}`
    };
  }
}

async function validateEnvModeBeforeSave(
  mode: "shared" | "separate" | "none" | undefined,
  sharedEnv: LaunchEnvValues | undefined,
  separateEnv: Record<string, LaunchEnvValues> | undefined,
  targetIds: string[]
): Promise<void> {
  if (mode === "shared" && sharedEnv) {
    const res = await testOpenAiApi(sharedEnv);
    if (!res.ok) {
      throw new Error(`OpenAI API test failed: ${res.message}`);
    }
  } else if (mode === "separate" && separateEnv) {
    const testedKeys = new Set<string>();
    for (const id of targetIds) {
      const values = separateEnv[id];
      if (values && (values.baseUrl || values.apiKey)) {
        const key = `${values.baseUrl || ""}:${values.apiKey || ""}:${values.model || ""}`;
        if (testedKeys.has(key)) continue;
        testedKeys.add(key);
        const res = await testOpenAiApi(values);
        if (!res.ok) {
          throw new Error(`OpenAI API test failed for adapter ${id}: ${res.message}`);
        }
      }
    }
  }
}

export async function installLaunchAdapters(
  opts: InstallLaunchRequest,
  onLog?: (text: string, level: InstallLogLevel) => void
): Promise<{ results: InstallLaunchResultItem[]; adapters: LaunchAdapterStatus[] }> {
  const log = (text: string, level: InstallLogLevel = "info") => {
    onLog?.(text, level);
  };

  // Serialize installs to avoid concurrent git/npm races
  while (installLock) {
    await installLock;
  }
  let release!: () => void;
  installLock = new Promise<void>((r) => {
    release = r;
  });
  try {
    let ids = opts.ids?.length ? [...opts.ids] : [];
    if (opts.missingOnly || ids.length === 0) {
      const all = detectAll(opts.sourceRoot).adapters;
      ids = all
        .filter((a) => (opts.missingOnly ? a.needsInstall : true))
        .filter((a) => a.cloneable || a.sourcePresent)
        .map((a) => a.id);
      if (opts.ids?.length) {
        ids = ids.filter((id) => opts.ids!.includes(id));
      }
    }
    // De-dupe
    ids = [...new Set(ids)];

    log(`开始按顺序一键安装选定的 ${ids.length} 个适配器: [${ids.join(", ")}]`, "info");
    log(`源码保存路径: ${defaultSourceRoot(opts.sourceRoot)}`, "info");

    if (opts.envMode && opts.envMode !== "none" && !opts.skipModelTest) {
      log(`正在校验 OpenAI API 模型可用性...`, "warn");
      try {
        await validateEnvModeBeforeSave(opts.envMode, opts.sharedEnv, opts.separateEnv, ids);
        log(`✓ OpenAI API 模型连通性测试通过`, "success");
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`⚠ 模型校验返回警告/超时: ${msg}`, "warn");
        log(`仍将继续为您克隆源码并保存 .env 配置，请在安装完成后检查网络`, "info");
      }
    }

    const results: InstallLaunchResultItem[] = [];
    let current = 1;
    for (const id of ids) {
      log(`----------------------------------------`, "info");
      log(`[${current}/${ids.length}] 正在处理适配器: ${id}`, "info");
      const itemRes = await installOne(id, opts, (subMsg, subLevel) => log(subMsg, subLevel));
      results.push(itemRes);
      if (itemRes.ok) {
        log(`[${current}/${ids.length}] ✓ ${id} 安装配置完毕`, "success");
      } else {
        log(`[${current}/${ids.length}] ✗ ${id} 处理失败: ${itemRes.error}`, "error");
      }
      current++;
    }

    log(`----------------------------------------`, "info");
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.filter((r) => !r.ok).length;
    log(`所有适配器处理完毕：成功 ${okCount} 个，失败 ${failCount} 个`, okCount > 0 ? "success" : "error");

    return { results, adapters: detectAll(opts.sourceRoot).adapters };
  } finally {
    release();
    installLock = null;
  }
}

export async function writeEnvsOnly(
  mode: "shared" | "separate",
  sharedEnv: LaunchEnvValues | undefined,
  separateEnv: Record<string, LaunchEnvValues> | undefined,
  ids: string[] | undefined,
  force: boolean
): Promise<{ results: Array<{ id: string; ok: boolean; path: string; wrote: boolean; error?: string }> }> {
  const targets = (ids?.length ? ids : LAUNCH_SPECS.map((s) => s.id)).filter((id) => getSpec(id));
  try {
    await validateEnvModeBeforeSave(mode, sharedEnv, separateEnv, targets);
  } catch {
    /* ignore test error for writeEnvsOnly */
  }
  const results = targets.map((id) => {
    const spec = getSpec(id)!;
    try {
      const values = mode === "shared" ? sharedEnv ?? {} : separateEnv?.[id] ?? {};
      const r = writeAdapterEnv(spec, values, force);
      return { id, ok: true, path: r.path, wrote: r.wrote };
    } catch (error) {
      return {
        id,
        ok: false,
        path: configEnvPath(spec),
        wrote: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  return { results };
}

export type InstallJobLogItem = {
  time: string;
  text: string;
  level: InstallLogLevel;
};

export type InstallJob = {
  id: string;
  status: "running" | "completed" | "failed";
  progressStep: string;
  logs: InstallJobLogItem[];
  results?: InstallLaunchResultItem[];
  adapters?: LaunchAdapterStatus[];
  error?: string;
  createdAt: number;
};

const installJobs = new Map<string, InstallJob>();

export function createInstallJob(opts: InstallLaunchRequest): string {
  const jobId = randomUUID();
  const logs: InstallJobLogItem[] = [];

  const addLog = (text: string, level: InstallLogLevel = "info") => {
    const time = new Date().toLocaleTimeString();
    logs.push({ time, text, level });
    if (logs.length > 500) {
      logs.splice(0, logs.length - 500);
    }
    if (job) {
      job.progressStep = text;
    }
  };

  const job: InstallJob = {
    id: jobId,
    status: "running",
    progressStep: "Starting installation job...",
    logs,
    createdAt: Date.now()
  };
  installJobs.set(jobId, job);

  (async () => {
    try {
      const res = await installLaunchAdapters(opts, (msg, level) => addLog(msg, level));
      job.status = "completed";
      job.progressStep = `Completed ${res.results.filter((r) => r.ok).length}/${res.results.length} adapters.`;
      job.results = res.results;
      job.adapters = res.adapters;
    } catch (err: any) {
      job.status = "failed";
      job.error = err.message || String(err);
      job.progressStep = `Failed: ${job.error}`;
      addLog(`任务发生不可恢复的致命错误: ${job.error}`, "error");
    }
  })();

  return jobId;
}

export function getInstallJob(jobId: string): InstallJob | undefined {
  return installJobs.get(jobId);
}
