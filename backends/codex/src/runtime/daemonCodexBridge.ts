import { mkdirSync, existsSync, statSync, rmSync, readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import {
  type EngineStatus,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonValue
} from "@codex-ui/shared";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import { pluginHostServices } from "@cxu/sdk-backend";

export type { CodexRuntimeClient };

type PendingRequest = {
  resolve: (value: JsonValue) => void;
  reject: (error: JsonRpcFailure["error"]) => void;
  method: string;
};

const DEFAULT_DAEMON_SOCKET_RELATIVE = path.join("app-server-control", "app-server-control.sock");
const DAEMON_PID_FILE_RELATIVE = path.join("app-server-daemon", "app-server.pid");
const DAEMON_LIFECYCLE_TIMEOUT_MS = 15_000;
const RELAY_GATEWAY_ENV_KEY = "CODEX_UI_RELAY_GATEWAY_TOKEN";

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer ***")
    .replace(/api[_-]?key["'=:\s]+[A-Za-z0-9._~+/=-]{8,}/gi, "api_key=***");
}

export function resolveCodexHome(): string {
  if (process.env.CODEX_HOME) {
    return process.env.CODEX_HOME;
  }
  return path.join(os.homedir(), ".codex");
}

export function resolveDefaultSocketPath(): string {
  if (process.env.CODEX_APP_SERVER_SOCKET) {
    return process.env.CODEX_APP_SERVER_SOCKET;
  }
  const codexHome = resolveCodexHome();
  return path.join(codexHome, "app-server-control", "app-server-control.sock");
}

export class DaemonCodexBridge extends EventEmitter implements CodexRuntimeClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<string, PendingRequest>();
  private status: EngineStatus = { phase: "idle", transport: "daemon-unix" };
  private connectionEpoch = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isStopping = false;
  private readonly socketPath: string;

  public constructor(
    socketPath = resolveDefaultSocketPath(),
    private readonly runtimeEnv: () => NodeJS.ProcessEnv = () => ({})
  ) {
    super();
    this.socketPath = socketPath;
  }

  public getStatus(): EngineStatus {
    return { ...this.status };
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.emit("status", this.getStatus());
  }

  public async start(): Promise<EngineStatus> {
    if (this.status.phase === "ready" || this.status.phase === "starting") {
      return this.getStatus();
    }
    this.isStopping = false;
    const codexBin = this.resolveCodexBin();
    this.setStatus({
      phase: "starting",
      transport: "daemon-unix",
      realtimeSync: "available",
      connectionEpoch: this.connectionEpoch,
      codexBin,
      startedAt: Date.now(),
      message: "Connecting to Codex app-server daemon"
    });

    try {
      await this.ensureDaemonRunning(codexBin);
      await this.connectWebSocket();
      return this.getStatus();
    } catch (error) {
      const message = stringifyError(error);
      this.setStatus({
        phase: "error",
        transport: "daemon-unix",
        realtimeSync: "unavailable",
        connectionEpoch: this.connectionEpoch,
        codexBin,
        codexHome: resolveCodexHome(),
        message
      });
      throw new Error(message);
    }
  }

  public stop(): void {
    this.isStopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const request of this.pending.values()) {
      request.reject({ message: "Codex daemon bridge stopped" });
    }
    this.pending.clear();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.setStatus({ ...this.status, phase: "stopped", message: "Stopped" });
  }

  public async restart(): Promise<EngineStatus> {
    this.stop();
    return this.start();
  }

  public async request(method: string, params?: JsonValue, timeoutMs = 15000): Promise<JsonValue> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Codex daemon connection is not open");
    }
    const id = this.nextId++;
    const payload: JsonRpcMessage = { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        if (this.pending.has(String(id))) {
          this.pending.delete(String(id));
          reject({ message: `Request '${method}' timed out after ${timeoutMs}ms` });
        }
      }, timeoutMs) : undefined;
      this.pending.set(String(id), {
        resolve: (val) => {
          if (timer) clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
        method
      });
      this.sendPayload(payload);
    });
  }

  public async notify(method: string, params?: JsonValue): Promise<void> {
    this.sendPayload({ method, params });
  }

  public respond(id: JsonRpcId, result?: JsonValue, error?: JsonRpcFailure["error"]): void {
    if (error) {
      this.sendPayload({ id, error });
    } else {
      this.sendPayload({ id, result: result ?? {} });
    }
  }

  private sendPayload(message: JsonRpcMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Codex daemon connection is not open");
    }
    this.ws.send(JSON.stringify(message));
  }

  private async ensureDaemonRunning(codexBin: string): Promise<void> {
    const runtimeEnv = this.runtimeEnv();
    if (this.hasUsableSocket()) {
      if (this.daemonNeedsRuntimeEnvRestart(runtimeEnv)) {
        await this.runDaemonLifecycle(codexBin, "restart", runtimeEnv);
      }
      return;
    }

    const socketDir = path.dirname(this.socketPath);
    mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    await this.runDaemonLifecycle(codexBin, "start", runtimeEnv);

    for (let i = 0; i < 40; i += 1) {
      if (this.hasUsableSocket()) {
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    throw new Error(`Codex daemon socket did not become ready: ${this.socketPath}`);
  }

  private async runDaemonLifecycle(codexBin: string, command: "start" | "restart", runtimeEnv: NodeJS.ProcessEnv): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const daemonProc = pluginHostServices().codex.spawnCodexCommand(codexBin, ["app-server", "daemon", command], {
        cwd: process.cwd(),
        env: { ...process.env, ...runtimeEnv }
      });

      let output = "";
      let errOutput = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          daemonProc.kill("SIGTERM");
        } catch {}
        const details = [errOutput.trim(), output.trim()].filter(Boolean).join("\n");
        reject(new Error(`Timed out waiting for Codex daemon ${command} after ${DAEMON_LIFECYCLE_TIMEOUT_MS}ms${details ? `:\n${redactSecrets(details)}` : ""}`));
      }, DAEMON_LIFECYCLE_TIMEOUT_MS);
      daemonProc.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      daemonProc.stderr.on("data", (chunk: Buffer) => {
        errOutput += chunk.toString("utf8");
      });

      daemonProc.once("exit", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (code === 0 || this.hasUsableSocket()) {
          resolve();
        } else {
          const details = [errOutput.trim(), output.trim()].filter(Boolean).join("\n");
          reject(new Error(`Failed to ${command} daemon (code ${code}): ${redactSecrets(details)}`));
        }
      });

      daemonProc.once("error", (err) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private daemonNeedsRuntimeEnvRestart(runtimeEnv: NodeJS.ProcessEnv): boolean {
    const required = daemonRuntimeEnv(runtimeEnv);
    if (Object.keys(required).length === 0) {
      return false;
    }
    const daemonEnv = readPidManagedDaemonEnv(this.socketPath);
    if (!daemonEnv) {
      return false;
    }
    return runtimeEnvMissingInProcessEnv(required, daemonEnv);
  }

  private hasUsableSocket(): boolean {
    if (!existsSync(this.socketPath)) {
      return false;
    }
    try {
      const stat = statSync(this.socketPath);
      if (stat.isSocket()) {
        return true;
      }
      rmSync(this.socketPath, { force: true, recursive: false });
    } catch {
      return false;
    }
    return false;
  }

  private async connectWebSocket(): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws+unix://${this.socketPath}:/`, {
        perMessageDeflate: false
      });
      let resolved = false;

      ws.on("open", async () => {
        this.ws = ws;
        this.connectionEpoch += 1;
        try {
          const initialize = await this.request("initialize", {
            clientInfo: {
              name: "codex-tui",
              title: "Codex TUI",
              version: "0.1.0"
            },
            capabilities: {
              experimentalApi: true,
              mcpServerOpenaiFormElicitation: true
            }
          });
          await this.notify("initialized", {});
          const init = initialize as Record<string, JsonValue>;
          const codexBin = this.resolveCodexBin();
          const codexVersion = await this.readCodexVersion(codexBin);

          this.setStatus({
            phase: "ready",
            transport: "daemon-unix",
            realtimeSync: "available",
            connectionEpoch: this.connectionEpoch,
            codexBin,
            codexVersion,
            appServerUserAgent: typeof init.userAgent === "string" ? init.userAgent : undefined,
            codexHome: typeof init.codexHome === "string" ? init.codexHome : resolveCodexHome(),
            startedAt: Date.now()
          });

          if (!resolved) {
            resolved = true;
            resolve();
          }
        } catch (err) {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        }
      });

      ws.on("message", (data: WebSocket.RawData) => {
        const text = data.toString("utf8");
        this.handleMessageLine(text);
      });

      ws.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        } else {
          this.emit("stderr", `WebSocket error: ${stringifyError(err)}`);
        }
      });

      ws.on("close", () => {
        this.ws = null;
        for (const req of this.pending.values()) {
          req.reject({ message: "Daemon WebSocket connection closed" });
        }
        this.pending.clear();

        if (!this.isStopping) {
          this.setStatus({
            ...this.status,
            phase: "reconnecting",
            realtimeSync: "degraded",
            message: "Connection to daemon lost, reconnecting..."
          });
          this.scheduleReconnect();
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isStopping) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.isStopping) return;
      try {
        await this.start();
      } catch {
        this.scheduleReconnect();
      }
    }, 2000);
  }

  private handleMessageLine(text: string): void {
    if (!text.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(text) as JsonRpcMessage;
    } catch {
      this.emit("stderr", `Unparseable WebSocket frame: ${redactSecrets(text)}`);
      return;
    }

    if ("id" in message && this.pending.has(String(message.id))) {
      const pending = this.pending.get(String(message.id));
      this.pending.delete(String(message.id));
      if (!pending) return;
      if ("error" in message) {
        pending.reject(message.error);
      } else if ("result" in message) {
        pending.resolve(message.result);
      } else {
        pending.resolve({});
      }
      return;
    }

    this.emit("message", message);
  }

  private resolveCodexBin(): string {
    return pluginHostServices().codex.findCodexBinary();
  }

  private async readCodexVersion(codexBin: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      let resolved = false;
      const version = pluginHostServices().codex.spawnCodexCommand(codexBin, ["--version"], { env: process.env });
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { version.kill(); } catch {}
          resolve(undefined);
        }
      }, 3000);
      let output = "";
      version.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      version.once("exit", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(output.trim() || undefined);
        }
      });
      version.once("error", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(undefined);
        }
      });
    });
  }
}

export function runtimeEnvMissingInProcessEnv(required: NodeJS.ProcessEnv, current: NodeJS.ProcessEnv): boolean {
  for (const [key, value] of Object.entries(daemonRuntimeEnv(required))) {
    if (current[key] !== value) {
      return true;
    }
  }
  return false;
}

function daemonRuntimeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const requiredEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    const providerKey = key.startsWith("CODEX_UI_PROVIDER_") && key.endsWith("_API_KEY");
    if ((providerKey || key === RELAY_GATEWAY_ENV_KEY) && typeof value === "string" && value.trim()) {
      requiredEnv[key] = value;
    }
  }
  return requiredEnv;
}

function readPidManagedDaemonEnv(socketPath: string): NodeJS.ProcessEnv | null {
  if (process.platform !== "linux") {
    return null;
  }
  const codexHome = resolveCodexHome();
  const defaultSocket = path.join(codexHome, DEFAULT_DAEMON_SOCKET_RELATIVE);
  if (socketPath !== defaultSocket) {
    return null;
  }
  try {
    const rawPid = readFileSync(path.join(codexHome, DAEMON_PID_FILE_RELATIVE), "utf8");
    const pid = Number((JSON.parse(rawPid) as { pid?: unknown }).pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }
    const rawEnv = readFileSync(`/proc/${pid}/environ`, "utf8");
    const env: NodeJS.ProcessEnv = {};
    for (const entry of rawEnv.split("\0")) {
      const index = entry.indexOf("=");
      if (index > 0) {
        env[entry.slice(0, index)] = entry.slice(index + 1);
      }
    }
    return env;
  } catch {
    return null;
  }
}
