import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import {
  type EngineStatus,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonValue
} from "@codex-ui/shared";
import { pluginHostServices, type PluginHostServices } from "@cxu/sdk-backend";

type PendingRequest = {
  resolve: (value: JsonValue) => void;
  reject: (error: JsonRpcFailure["error"]) => void;
  method: string;
};

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { DaemonCodexBridge, resolveDefaultSocketPath, type CodexRuntimeClient } from "./daemonCodexBridge.js";
import { VirtualConfigCodexRuntimeClient } from "@cxu/sdk-backend";

export type { CodexRuntimeClient };

export class CodexBridge extends EventEmitter implements CodexRuntimeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<string, PendingRequest>();
  private status: EngineStatus = { phase: "idle", transport: "stdio" };
  private recovery: Promise<EngineStatus> | null = null;

  public constructor(
    private readonly runtimeEnv: () => NodeJS.ProcessEnv = () => ({}),
    private readonly spawnCommand: PluginHostServices["codex"]["spawnCodexCommand"] = pluginHostServices().codex.spawnCodexCommand,
    private readonly findBinary: PluginHostServices["codex"]["findCodexBinary"] = pluginHostServices().codex.findCodexBinary
  ) {
    super();
  }

  public getStatus(): EngineStatus {
    return { ...this.status };
  }

  public async start(): Promise<EngineStatus> {
    if (this.status.phase === "ready" || this.status.phase === "starting") {
      return this.getStatus();
    }

    const codexBin = this.resolveCodexBin();
    this.setStatus({
      phase: "starting",
      codexBin,
      startedAt: Date.now(),
      message: "Starting codex app-server"
    });

    const child = this.spawnCommand(codexBin, pluginHostServices().codex.codexAppServerArgs(codexBin), {
      cwd: process.cwd(),
      env: { ...process.env, ...this.runtimeEnv() }
    });
    this.child = child;

    child.once("exit", (code, signal) => {
      this.invalidateChild(child, `codex app-server exited with code ${code ?? "null"} signal ${signal ?? "null"}`);
    });

    child.once("error", (error) => {
      this.invalidateChild(child, stringifyError(error));
    });

    child.stdin.once("error", (error) => {
      this.invalidateChild(child, `codex app-server stdin failed: ${stringifyError(error)}`);
    });

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: Buffer) => {
      const message = redactSecrets(chunk.toString("utf8").trim());
      if (message.length > 0) {
        this.emit("stderr", message);
      }
    });

    try {
      const initialize = await this.requestOnChild("initialize", {
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
      this.setStatus({
        phase: "ready",
        codexBin,
        codexVersion: undefined,
        appServerUserAgent: typeof init.userAgent === "string" ? init.userAgent : undefined,
        codexHome: typeof init.codexHome === "string" ? init.codexHome : undefined,
        startedAt: this.status.startedAt,
        message: "Codex app-server ready"
      });
      void this.readCodexVersion(codexBin).then((ver) => {
        if (ver && this.status.phase === "ready") {
          this.setStatus({ ...this.status, codexVersion: ver });
        }
      });
      return this.getStatus();
    } catch (error) {
      const message =
        typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : stringifyError(error);
      this.stop();
      this.setStatus({ phase: "error", codexBin, message });
      throw new Error(message);
    }
  }

  public stop(): void {
    for (const request of this.pending.values()) {
      request.reject({ message: "Codex app-server stopped" });
    }
    this.pending.clear();
    this.setStatus({ ...this.status, phase: "stopped", message: "Stopped" });
    this.child?.kill("SIGTERM");
    this.child = null;
  }

  public async restart(): Promise<EngineStatus> {
    this.stop();
    return this.start();
  }

  public async request(method: string, params?: JsonValue, timeoutMs = 15000): Promise<JsonValue> {
    await this.ensureRunning();
    return this.requestOnChild(method, params, timeoutMs);
  }

  private async requestOnChild(method: string, params?: JsonValue, timeoutMs = 15000): Promise<JsonValue> {
    if (!this.child) {
      throw new Error("Codex app-server is not running");
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
      try {
        this.send(payload);
      } catch (error) {
        this.pending.delete(String(id));
        if (timer) clearTimeout(timer);
        reject({ message: stringifyError(error) });
      }
    });
  }

  public async notify(method: string, params?: JsonValue): Promise<void> {
    this.send({ method, params });
  }

  public respond(id: JsonRpcId, result?: JsonValue, error?: JsonRpcFailure["error"]): void {
    if (error) {
      this.send({ id, error });
    } else {
      this.send({ id, result: result ?? {} });
    }
  }

  private send(message: JsonRpcMessage): void {
    if (!this.child) {
      throw new Error("Codex app-server is not running");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async ensureRunning(): Promise<void> {
    if (this.recovery) {
      await this.recovery;
      return;
    }
    if (this.child) {
      return;
    }
    if (this.status.phase === "stopped") {
      throw new Error("Codex app-server is stopped");
    }
    if (!this.recovery) {
      this.recovery = this.start().finally(() => {
        this.recovery = null;
      });
    }
    await this.recovery;
    if (!this.child) {
      throw new Error("Codex app-server is not running");
    }
  }

  private invalidateChild(child: ChildProcessWithoutNullStreams, message: string): void {
    if (this.child !== child) {
      return;
    }
    for (const request of this.pending.values()) {
      request.reject({ message });
    }
    this.pending.clear();
    this.child = null;
    if (this.status.phase !== "stopped") {
      this.setStatus({ ...this.status, phase: "error", message });
    }
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) {
      return;
    }
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emit("stderr", `Unparseable app-server stdout: ${redactSecrets(line)}`);
      return;
    }

    if ("id" in message && this.pending.has(String(message.id))) {
      const pending = this.pending.get(String(message.id));
      this.pending.delete(String(message.id));
      if (!pending) {
        return;
      }
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

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.emit("status", this.getStatus());
  }

  private resolveCodexBin(): string {
    return this.findBinary();
  }

  private async readCodexVersion(codexBin: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      let resolved = false;
      const version = this.spawnCommand(codexBin, ["--version"], { env: process.env });
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try {
            version.kill();
          } catch {
            /* ignore */
          }
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

const THREAD_SCOPED_HISTORY_METHODS = new Set([
  "thread/read",
  "thread/resume",
  "thread/turns/list",
  "thread/items/list",
  "thread/history/fileInfo",
  "thread/history/tail",
  "turn/start",
]);

function isThreadScopedHistoryMethod(method: string): boolean {
  return THREAD_SCOPED_HISTORY_METHODS.has(method);
}

function threadIdFromParams(params?: JsonValue): string | null {
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const id = (params as Record<string, unknown>).threadId;
    return typeof id === "string" && id.trim() ? id : null;
  }
  return null;
}

function isThreadMissingError(error: unknown): boolean {
  const message = stringifyError(error).toLowerCase();
  return message.includes("thread not found")
    || message.includes("thread_not_found")
    || message.includes("unknown thread")
    || message.includes("no such thread");
}

function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer ***")
    .replace(/api[_-]?key["'=:\s]+[A-Za-z0-9._~+/=-]{8,}/gi, "api_key=***");
}

export class AutoFallbackCodexRuntimeClient extends EventEmitter implements CodexRuntimeClient {
  private activeClient: CodexRuntimeClient;
  private readonly fallbackClient: CodexRuntimeClient;
  private isFallback = false;

  public constructor(
    private readonly primaryClient: CodexRuntimeClient,
    fallbackClient?: CodexRuntimeClient,
  ) {
    super();
    this.fallbackClient = fallbackClient ?? pluginHostServices().mini.createFallbackBridge();
    this.activeClient = this.primaryClient;
    this.wirePrimaryEvents();
  }

  private wirePrimaryEvents(): void {
    this.primaryClient.on("status", (status: EngineStatus) => {
      if (status.phase === "error" && !this.isFallback) {
        console.warn(`[codex-runtime] Primary Codex runtime error (${status.message ?? "unknown"}), falling back to built-in MiniAgent`);
        this.activateFallback();
        return;
      }
      if (!this.isFallback) {
        this.emit("status", status);
      }
    });
    this.primaryClient.on("message", (msg) => {
      if (!this.isFallback) this.emit("message", msg);
    });
    this.primaryClient.on("stderr", (err) => {
      if (!this.isFallback) this.emit("stderr", err);
    });
  }

  private activateFallback(): void {
    if (this.isFallback) return;
    this.isFallback = true;
    try {
      this.primaryClient.stop();
    } catch {}
    this.activeClient = this.fallbackClient;
    // Guard each forward with isFallback so a later primary recovery
    // (restart) stops leaking Mini events into the Codex stream.
    this.fallbackClient.on("status", (status) => { if (this.isFallback) this.emit("status", status); });
    this.fallbackClient.on("message", (msg) => { if (this.isFallback) this.emit("message", msg); });
    this.fallbackClient.on("stderr", (err) => { if (this.isFallback) this.emit("stderr", err); });
    this.emit("status", this.getStatus());
  }

  /** Explicit fallback visibility: the UI/diagnostics can tell Codex vs Mini. */
  public isFallbackActive(): boolean {
    return this.isFallback;
  }

  public getStatus(): EngineStatus {
    const status = this.activeClient.getStatus();
    if (this.isFallback) {
      const base = status.message ?? "Mini ready";
      return {
        ...status,
        message: base.includes("fallback to Mini active")
          ? base
          : `${base} (fallback to Mini active: Codex runtime unavailable)`,
      };
    }
    return status;
  }

  public async start(): Promise<EngineStatus> {
    if (this.isFallback) {
      return this.fallbackClient.start();
    }
    try {
      const status = await this.primaryClient.start();
      if (status.phase === "error") {
        this.activateFallback();
        return this.fallbackClient.start();
      }
      return status;
    } catch (error) {
      console.warn(`[codex-runtime] Primary Codex runtime failed to start, falling back to built-in MiniAgent: ${stringifyError(error)}`);
      this.activateFallback();
      return this.fallbackClient.start();
    }
  }

  public stop(): void {
    this.activeClient.stop();
  }

  public async restart(): Promise<EngineStatus> {
    if (this.isFallback) {
      // Recovery path: the old code only restarted Mini, so a transient
      // Codex outage pinned every later codex thread to Mini forever.
      // Retry the primary first; only stay on Mini if it still fails.
      try {
        const status = await this.primaryClient.start();
        if (status.phase !== "error") {
          this.activeClient = this.primaryClient;
          this.isFallback = false;
          this.emit("status", status);
          return status;
        }
      } catch {
        /* stay on fallback below */
      }
      return this.fallbackClient.restart();
    }
    return this.start();
  }

  public async request(method: string, params?: JsonValue, timeoutMs?: number): Promise<JsonValue> {
    // Backend identity guard: once the global runtime has fallen back to Mini,
    // an existing Codex thread must never be served by Mini. Mini now throws
    // `thread not found` for unknown ids (instead of an empty history), so a
    // thread-missing result here means "not Mini-owned" and must try the
    // primary instead of caching a fake empty transcript. Any other Mini
    // result (success or transport error) is returned/thrown as-is so
    // Mini-owned threads keep working while fallback is active.
    if (this.isFallback && isThreadScopedHistoryMethod(method) && threadIdFromParams(params)) {
      try {
        return await this.fallbackClient.request(method, params, timeoutMs);
      } catch (error) {
        if (!isThreadMissingError(error)) throw error;
        try {
          return await this.primaryClient.request(method, params, timeoutMs);
        } catch (primaryError) {
          throw new Error(
            `Codex runtime unavailable (fallback to Mini active): ${stringifyError(primaryError)}. Restart the Codex runtime and retry history restore.`
          );
        }
      }
    }
    return this.activeClient.request(method, params, timeoutMs);
  }

  public async notify(method: string, params?: JsonValue): Promise<void> {
    return this.activeClient.notify(method, params);
  }

  public respond(id: JsonRpcId, result?: JsonValue, error?: JsonRpcFailure["error"]): void {
    this.activeClient.respond(id, result, error);
  }
}

export function createCodexRuntimeClient(
  runtimeEnv: () => NodeJS.ProcessEnv = () => ({}),
  platform: NodeJS.Platform = process.platform,
  fallbackClient?: CodexRuntimeClient,
): CodexRuntimeClient {
  const mode = (process.env.CODEX_UI_APP_SERVER_MODE ?? "auto").trim().toLowerCase();
  if (mode === "stdio" || mode === "legacy-stdio") {
    return new VirtualConfigCodexRuntimeClient(new CodexBridge(runtimeEnv));
  }
  if (mode === "daemon") {
    if (platform === "win32") {
      throw new Error("CODEX_UI_APP_SERVER_MODE=daemon is not supported on Windows because it requires a Unix socket. Use 'auto' or 'stdio'.");
    }
    return new VirtualConfigCodexRuntimeClient(new DaemonCodexBridge(resolveDefaultSocketPath(), runtimeEnv));
  }
  if (mode === "auto" || mode === "") {
    if (!pluginHostServices().codex.isCodexCliAvailable(platform)) {
      return new VirtualConfigCodexRuntimeClient(fallbackClient ?? pluginHostServices().mini.createFallbackBridge());
    }
    const client = platform === "win32"
      ? new CodexBridge(runtimeEnv)
      : new DaemonCodexBridge(resolveDefaultSocketPath(), runtimeEnv);
    return new VirtualConfigCodexRuntimeClient(new AutoFallbackCodexRuntimeClient(client, fallbackClient));
  }
  if (mode === "codecli") {
    return new VirtualConfigCodexRuntimeClient(pluginHostServices().codeCli.createBridge(runtimeEnv));
  }
  if (mode === "mini") {
    return new VirtualConfigCodexRuntimeClient(fallbackClient ?? pluginHostServices().mini.createFallbackBridge());
  }
  throw new Error(`Unsupported CODEX_UI_APP_SERVER_MODE '${process.env.CODEX_UI_APP_SERVER_MODE}'. Use 'auto', 'daemon', 'stdio', 'codecli', or 'mini'.`);
}
