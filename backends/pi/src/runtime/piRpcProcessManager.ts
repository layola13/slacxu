import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codexUiDataDir } from "@cxu/sdk-backend";
import { pluginHostServices } from "@cxu/sdk-backend";
import { deriveOpenCodeSessionId } from "@cxu/sdk-backend";
import { findPiBin } from "./piCompatibleProbe.js";
import {
  formatPiExtensionUIResponse,
  formatPiRpcCommand,
  parsePiRpcLine,
  PiLineFramingBuffer,
  sanitizePiRpcText,
  type PiRpcCommand,
  type PiRpcExtensionUIRequest,
  type PiRpcResponse,
} from "./piRpcProtocol.js";

export const BUILTIN_PI_RELAY_EXTENSION_CODE = `// pi-relay extension for Codex Ultra
function piRelayExtension(pi) {
  const baseUrl = (process.env.PI_LAUNCH_BASE_URL || "https://api.kilo.ai/api/openrouter").trim();
  const apiKey = (process.env.PI_LAUNCH_API_KEY || "public").trim();
  const modelSpec = (process.env.PI_LAUNCH_MODEL || "stepfun/step-3.7-flash:free,kilo-auto/free,nvidia/nemotron-3.5-lightning:free").trim();
  const apiType = (process.env.PI_LAUNCH_API || "openai-completions").trim();
  if (!baseUrl) {
    return;
  }
  const modelIds = modelSpec ? modelSpec.split(",").map((s) => s.trim()).filter(Boolean) : ["stepfun/step-3.7-flash:free"];
  // OpenCode Go compliance: dedicated client identity plus a stable
  // per-conversation session id (the manager exports
  // PI_LAUNCH_OPENCODE_SESSION derived from the owning thread id).
  // Unknown x-opencode-* headers are ignored by non-OpenCode upstreams.
  const openCodeSession = (process.env.PI_LAUNCH_OPENCODE_SESSION || "").trim();
  const openCodeClient = (process.env.PI_LAUNCH_OPENCODE_CLIENT || "desktop").trim() || "desktop";
  const openCodeProject = (process.env.PI_LAUNCH_OPENCODE_PROJECT || "global").trim() || "global";
  const headers = {
    "User-Agent": "codex-ultra-pi/1.0",
    ...(openCodeSession ? {
      "x-opencode-client": openCodeClient,
      "x-opencode-project": openCodeProject,
      "x-opencode-session": openCodeSession,
    } : {}),
  };
  if (baseUrl.includes("kilo.ai")) {
    headers["User-Agent"] = "opencode-kilo-provider";
  }
  const models = modelIds.map((id) => ({
    id,
    name: \`\${id} (Relay)\`,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32768,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: true,
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
      supportsStrictMode: false,
      maxTokensField: "max_tokens"
    }
  }));
  pi.registerProvider("pi-relay", {
    name: "Codex Ultra Relay",
    baseUrl,
    apiKey: apiKey || "$PI_LAUNCH_API_KEY",
    api: apiType,
    headers,
    models
  });
}
export {
  piRelayExtension as default
};
`;

export interface PiRelayConfig {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  model?: string;
}

export interface PiProcessConfig {
  threadId: string;
  workspaceCwd: string;
  model?: string;
  sessionDir?: string;
  relayConfig?: PiRelayConfig;
  envOverrides?: Record<string, string>;
  idleTimeoutMs?: number; // default 10 minutes (600_000ms)
  ackTimeoutMs?: number;  // default 60 seconds (60_000ms)
  turnTimeoutMs?: number; // default 10 minutes (600_000ms)
}

const DEFAULT_ACK_TIMEOUT_MS = 60_000;
const DEFAULT_TURN_TIMEOUT_MS = 600_000;
const DEFAULT_IDLE_TIMEOUT_MS = 600_000;
const MAX_STDERR_LINES = 500;

export function defaultPiSessionDir(): string {
  return join(codexUiDataDir(), "pi-sessions");
}

export function defaultPiCliPath(env: NodeJS.ProcessEnv = process.env): string {
  return findPiBin(env);
}

export function defaultPiSourceDir(): string {
  return process.cwd();
}

export function isValidPiRelayExtensionDir(dir: string): boolean {
  try {
    if (!existsSync(dir)) return false;
    const js = join(dir, "index.js");
    if (existsSync(js) && statSync(js).size > 0) return true;
    const ts = join(dir, "index.ts");
    if (existsSync(ts) && statSync(ts).size > 0) return true;
    return false;
  } catch {
    return false;
  }
}

export function resolveExistingPiRelayExtensionDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const envExt = env.CODEX_UI_PI_RELAY_EXTENSION?.trim();
  if (envExt) {
    if (isValidPiRelayExtensionDir(envExt)) return envExt;
    if (existsSync(envExt)) return envExt;
    console.warn(`[piRpcProcessManager] CODEX_UI_PI_RELAY_EXTENSION="${envExt}" not found; searching candidates.`);
  }

  // 1. Traverse up from module url (repo checkout, node_modules)
  try {
    let cur = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      const ext = join(cur, "extensions", "pi-relay");
      if (isValidPiRelayExtensionDir(ext)) return ext;
      const desktopExt = join(cur, "desktop-resources", "extensions", "pi-relay");
      if (isValidPiRelayExtensionDir(desktopExt)) return desktopExt;
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  } catch {
  }

  // 2. Traverse up from process.execPath (standalone binary e.g. ~/.cxu/server/v.../codex-standalone)
  try {
    if (process.execPath) {
      let cur = dirname(process.execPath);
      for (let i = 0; i < 4; i++) {
        const ext = join(cur, "extensions", "pi-relay");
        if (isValidPiRelayExtensionDir(ext)) return ext;
        const bundleExt = join(cur, "server-bundle", "extensions", "pi-relay");
        if (isValidPiRelayExtensionDir(bundleExt)) return bundleExt;
        const desktopExt = join(cur, "desktop-resources", "extensions", "pi-relay");
        if (isValidPiRelayExtensionDir(desktopExt)) return desktopExt;
        const parent = dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
    }
  } catch {
  }

  // 3. Current working directory and ancestors
  const cwdCandidates = [
    process.cwd(),
    resolve(process.cwd(), ".."),
    resolve(process.cwd(), "../.."),
  ];
  for (const root of cwdCandidates) {
    const ext = join(root, "extensions", "pi-relay");
    if (isValidPiRelayExtensionDir(ext)) return ext;
    const desktopExt = join(root, "desktop-resources", "extensions", "pi-relay");
    if (isValidPiRelayExtensionDir(desktopExt)) return desktopExt;
  }

  // 4. Standard persistent data directory
  const dataDirExt = join(codexUiDataDir(env), "extensions", "pi-relay");
  if (isValidPiRelayExtensionDir(dataDirExt)) return dataDirExt;

  // 5. User home directory locations (.cxu, .codex-ultra)
  const home = env.USERPROFILE ?? env.HOME ?? homedir();
  if (home) {
    const cxuExt = join(home, ".cxu", "extensions", "pi-relay");
    if (isValidPiRelayExtensionDir(cxuExt)) return cxuExt;
    const ultraExt = join(home, ".codex-ultra", "extensions", "pi-relay");
    if (isValidPiRelayExtensionDir(ultraExt)) return ultraExt;
  }

  // 6. Well-known development directory
  const devExt = "D:\\projects\\codex-ultra\\extensions\\pi-relay";
  if (isValidPiRelayExtensionDir(devExt)) return devExt;

  return null;
}

export function ensurePiRelayExtensionDir(env: NodeJS.ProcessEnv = process.env): string {
  const existing = resolveExistingPiRelayExtensionDir(env);
  if (existing) return existing;

  const targetDir = join(codexUiDataDir(env), "extensions", "pi-relay");
  try {
    mkdirSync(targetDir, { recursive: true });
    const targetIndex = join(targetDir, "index.js");
    if (!existsSync(targetIndex) || statSync(targetIndex).size === 0) {
      writeFileSync(targetIndex, BUILTIN_PI_RELAY_EXTENSION_CODE, "utf8");
    }
    const targetPkg = join(targetDir, "package.json");
    if (!existsSync(targetPkg)) {
      writeFileSync(
        targetPkg,
        JSON.stringify(
          {
            name: "@codex-ultra/pi-relay-extension",
            version: "1.0.0",
            type: "module",
            main: "index.js",
          },
          null,
          2
        ),
        "utf8"
      );
    }
    return targetDir;
  } catch (err) {
    console.warn(`[piRpcProcessManager] Failed to materialize pi-relay extension in ${targetDir}:`, err);
    return targetDir;
  }
}

export function defaultPiRelayExtensionDir(env: NodeJS.ProcessEnv = process.env): string {
  return ensurePiRelayExtensionDir(env);
}

/**
 * Manages the lifecycle of a dedicated Pi RPC child process for a thread.
 */
export class PiRpcProcessManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopping = false;
  private readonly framingBuffer = new PiLineFramingBuffer();
  private stderrLineCount = 0;
  private nextCommandId = 1;
  private activeTurn = false;

  private ackTimer: NodeJS.Timeout | null = null;
  private turnTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  private readonly pendingCommands = new Map<
    string,
    {
      command: string;
      resolve: (res: PiRpcResponse) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(public readonly config: PiProcessConfig) {
    super();
  }

  /**
   * Spawns the Pi process in RPC mode with -a and pi-relay extension.
   */
  start(baseEnv: NodeJS.ProcessEnv = process.env): void {
    if (this.child) return;

    const bin = findPiBin(baseEnv);
    const extensionDir = defaultPiRelayExtensionDir(baseEnv);
    // pi-relay 扩展缺失时此前静默省略 -e 参数，pi 进程因无法解析
    // pi-relay/* 模型而退出，表现为含糊的“进程错误”。改为 fail-fast。
    if (!existsSync(extensionDir)) {
      throw new Error(
        `Pi relay extension not found at "${extensionDir}". ` +
        `Set CODEX_UI_PI_RELAY_EXTENSION to the extensions/pi-relay directory.`
      );
    }
    const sessionDir = this.config.sessionDir || defaultPiSessionDir();

    let modelArg = this.config.model;
    if (this.config.relayConfig) {
      const base = modelArg || this.config.relayConfig.model?.split(",")?.[0]?.trim() || "default";
      modelArg = base.startsWith("pi-relay/") ? base : `pi-relay/${base}`;
    } else {
      modelArg = modelArg || "pi-relay/default";
    }

    // pi v0.74.2 实测：无 -a 参数（Unknown option 直接 exit 1），无 --session-id
    //（--session 只接受已存在的会话文件/UUID，新 thread 传 threadId 会报
    // "No session found" 而退出）。进程按 thread 常驻，同一进程内会话自然连续，
    // 故只传 --mode rpc + --session-dir + --model。verified 2026-09-22。
    const args: string[] = [
      ...(existsSync(extensionDir) ? ["-e", extensionDir] : []),
      "--mode", "rpc",
      "--session-dir", sessionDir,
      "--model", modelArg,
      "--no-context-files",
    ];

    // Relay credentials and configs pass ONLY through environment variables (NEVER in argv)
    const env: Record<string, string> = {
      ...(baseEnv as Record<string, string>),
      ...this.config.envOverrides,
    };

    if (this.config.relayConfig) {
      if (this.config.relayConfig.baseUrl) {
        env.PI_LAUNCH_BASE_URL = this.config.relayConfig.baseUrl;
      }
      if (this.config.relayConfig.apiKey) {
        env.PI_LAUNCH_API_KEY = this.config.relayConfig.apiKey;
      }
      if (this.config.relayConfig.api) {
        env.PI_LAUNCH_API = this.config.relayConfig.api;
      }
      if (this.config.relayConfig.model) {
        env.PI_LAUNCH_MODEL = this.config.relayConfig.model;
      }
    }

    // OpenCode Go compliance for the pi-relay extension: stable
    // per-conversation session id derived from the owning thread.
    // ??= keeps explicit user overrides (envOverrides / process env) intact.
    env.PI_LAUNCH_OPENCODE_SESSION ??= deriveOpenCodeSessionId(this.config.threadId);
    env.PI_LAUNCH_OPENCODE_CLIENT ??= "desktop";
    env.PI_LAUNCH_OPENCODE_PROJECT ??= "global";

    const runCwd = this.config.workspaceCwd && existsSync(this.config.workspaceCwd)
      ? this.config.workspaceCwd
      : process.cwd();

    let spawnBin = bin;
    let spawnArgs = args;
    if (bin.endsWith(".js") || bin.endsWith(".mjs") || bin.endsWith(".ts")) {
      spawnBin = process.execPath;
      spawnArgs = [bin, ...args];
      env.ELECTRON_RUN_AS_NODE = "1";
    }

    const child = pluginHostServices().codex.spawnCodexCommand(spawnBin, spawnArgs, {
      cwd: runCwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    if (!child || !child.pid) {
      throw new Error("Failed to spawn Pi RPC process");
    }

    this.child = child;
    this.stopping = false;
    this.framingBuffer.clear();
    this.stderrLineCount = 0;

    child.once("exit", (code, signal) => {
      this.activeTurn = false;
      this.clearAllTimers();
      this.rejectAllPending(new Error(`Process exited prematurely with code=${code}, signal=${signal}`));
      this.emit("exit", { code, signal });
      this.child = null;
    });

    child.once("error", (err) => {
      this.activeTurn = false;
      this.clearAllTimers();
      this.rejectAllPending(err);
      this.emit("error", err);
      this.child = null;
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const lines = this.framingBuffer.push(text);
      for (const line of lines) {
        this.emit("line", line);
        this.handleIncomingLine(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (!text) return;
      this.stderrLineCount++;
      if (this.stderrLineCount <= MAX_STDERR_LINES) {
        const sanitized = sanitizePiRpcText(text);
        this.emit("stderr", sanitized);
      }
    });

    // Send initial configuration (enable auto retry for transient network / 429 errors)
    void this.sendCommand({ type: "set_auto_retry", enabled: true }).catch(() => undefined);

    // Reset idle timer
    this.resetIdleTimer();
  }

  /**
   * Handle parsed messages and lifecycle transitions.
   */
  private handleIncomingLine(line: string): void {
    const msg = parsePiRpcLine(line);
    if (!msg) return;

    this.emit("message", msg);

    // 1. Auto-reject extension UI requests to prevent headless deadlock
    if (msg.type === "extension_ui_request") {
      const req = msg as PiRpcExtensionUIRequest;
      this.autoRejectExtensionUI(req.id, req.method);
      return;
    }

    // 2. Command responses
    if (msg.type === "response") {
      const resp = msg as PiRpcResponse;
      if (resp.id && this.pendingCommands.has(resp.id)) {
        const pending = this.pendingCommands.get(resp.id)!;
        this.pendingCommands.delete(resp.id);
        clearTimeout(pending.timer);
        pending.resolve(resp);
      }
      return;
    }

    // 3. Turn lifecycle tracking
    if (msg.type === "turn_start" || msg.type === "agent_start") {
      this.activeTurn = true;
      this.clearIdleTimer();
      this.resetTurnTimer();
    } else if (msg.type === "agent_settled" || msg.type === "turn_end" || msg.type === "agent_end") {
      if (msg.type === "agent_settled") {
        this.activeTurn = false;
        this.clearTurnTimer();
        this.resetIdleTimer();
      }
    }
  }

  /**
   * Auto-cancels extension UI requests in headless mode.
   */
  private autoRejectExtensionUI(id: string, _method: string): void {
    if (!this.child || !this.child.stdin.writable) return;
    try {
      const resp = formatPiExtensionUIResponse({
        type: "extension_ui_response",
        id,
        cancelled: true,
      });
      this.child.stdin.write(resp);
    } catch {
      // Ignore write errors during shutdown
    }
  }

  /**
   * Send an RPC command and await its response.
   */
  async sendCommand(cmd: PiRpcCommand, options?: { ackTimeoutMs?: number }): Promise<PiRpcResponse> {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Pi RPC process is not running or stdin is not writable");
    }

    const id = cmd.id || String(this.nextCommandId++);
    const payload = { ...cmd, id };
    const ackTimeout = options?.ackTimeoutMs ?? this.config.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          this.emit("timeout", {
            type: "ack",
            details: `Command '${cmd.type}' (id=${id}) timed out after ${ackTimeout}ms without ack.`,
          });
          reject(new Error(`Command '${cmd.type}' ack timed out after ${ackTimeout}ms`));
        }
      }, ackTimeout);

      this.pendingCommands.set(id, {
        command: cmd.type,
        resolve,
        reject,
        timer,
      });

      try {
        const data = formatPiRpcCommand(payload);
        this.child!.stdin.write(data);
      } catch (err) {
        clearTimeout(timer);
        this.pendingCommands.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Write raw line or command to stdin without awaiting response.
   */
  writeRaw(line: string): void {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Pi RPC process is not running or stdin is not writable");
    }
    this.child.stdin.write(line.endsWith("\n") ? line : line + "\n");
  }

  /**
   * Graceful stop with escalation (stdin close -> SIGTERM -> SIGKILL).
   */
  stop(timeoutMs = 3_000): void {
    if (this.stopping) return;
    this.stopping = true;
    this.activeTurn = false;
    this.clearAllTimers();

    const child = this.child;
    if (!child) {
      this.stopping = false;
      return;
    }

    try {
      child.stdin.end();
    } catch {}

    const termTimer = setTimeout(() => {
      if (this.child === child && !child.killed) {
        if (process.platform === "win32" && child.pid) {
          // Windows 上只 kill 直接子进程会留下孙进程：用 taskkill /T /F 杀整棵树
          //（与 agy/grok/opencode/miniMcp/miniBridge 一致），失败时回退 SIGTERM。
          try {
            const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
            killer.on("error", () => {
              try { child.kill("SIGTERM"); } catch {}
            });
          } catch {
            try { child.kill("SIGTERM"); } catch {}
          }
        } else {
          try {
            child.kill("SIGTERM");
          } catch {}
        }

        const killTimer = setTimeout(() => {
          if (this.child === child && !child.killed) {
            try {
              child.kill("SIGKILL");
            } catch {}
          }
        }, 1_500);
        killTimer.unref();
      }
    }, timeoutMs);
    termTimer.unref();
  }

  isRunning(): boolean {
    return this.child !== null && !this.child.killed;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get isTurnActive(): boolean {
    return this.activeTurn;
  }

  private resetTurnTimer(): void {
    this.clearTurnTimer();
    const timeout = this.config.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    this.turnTimer = setTimeout(() => {
      this.emit("timeout", {
        type: "turn",
        details: `Turn execution exceeded maximum timeout of ${timeout}ms.`,
      });
      // Force stop and kill process on turn timeout
      this.stop(1000);
    }, timeout);
    this.turnTimer.unref();
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    const timeout = this.config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.idleTimer = setTimeout(() => {
      this.emit("timeout", {
        type: "idle",
        details: `Process idle for ${timeout}ms, shutting down.`,
      });
      this.stop(2000);
    }, timeout);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private clearAllTimers(): void {
    this.clearTurnTimer();
    this.clearIdleTimer();
    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingCommands.clear();
  }
}
