import { EventEmitter } from "node:events";
import type { EngineStatus, JsonRpcFailure, JsonRpcId, JsonValue } from "@codex-ui/shared";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import { pluginHostServices, type PluginHostServices } from "@cxu/sdk-backend";
import type { RemoteThreadRoute } from "@cxu/sdk-backend";

export const REMOTE_RECONNECT_MAX_ATTEMPTS = 8;

/**
 * The SSH-forwarded HTTP calls this bridge makes. Injectable so the reconnect,
 * journal and response paths can be exercised without a real remote host.
 */
export type RemoteBunTransport = {
  openTunnel: PluginHostServices["remoteBun"]["openTunnel"];
  closeTunnel: PluginHostServices["remoteBun"]["closeTunnel"];
  request: PluginHostServices["remoteBun"]["request"];
};

function defaultRemoteBunTransport(): RemoteBunTransport {
  return pluginHostServices().remoteBun;
}

export class RemoteBunCodexBridge extends EventEmitter implements CodexRuntimeClient {
  private status: EngineStatus = { phase: "idle", transport: "stdio" };
  private tunnelId: string | null = null;
  private apiSession: string | null = null;
  private cursor = 0;
  private pollAbort = false;
  private starting: Promise<EngineStatus> | null = null;
  private reconnecting: Promise<EngineStatus> | null = null;
  private connectionGeneration = 0;
  public constructor(
    public readonly route: Pick<RemoteThreadRoute, "threadId" | "command" | "remotePort"> & { eventCursor?: number },
    private readonly transport: RemoteBunTransport = defaultRemoteBunTransport(),
  ) {
    super();
    this.cursor = safeCursor(route.eventCursor);
  }
  public getEventCursor(): number { return this.cursor; }
  public getStatus(): EngineStatus { return { ...this.status }; }
  public async start(): Promise<EngineStatus> {
    if (this.status.phase === "ready") return this.getStatus();
    if (this.starting) return await this.starting;
    this.starting = this.startInternal();
    try { return await this.starting; } finally { this.starting = null; }
  }
  private async startInternal(): Promise<EngineStatus> {
    this.status = { phase: "starting", transport: "stdio", message: "Connecting to remote Bun Server", startedAt: Date.now() };
    this.emit("status", this.getStatus());
    try { await this.connect(false); } catch (error) { this.releaseConnection(); throw error; }
    this.pollAbort = false;
    void this.pollEvents();
    this.status = { phase: "ready", transport: "stdio", message: "Remote Bun Server ready" };
    this.emit("status", this.getStatus());
    return this.getStatus();
  }
  public stop(): void {
    this.pollAbort = true;
    this.connectionGeneration += 1;
    const tunnelId = this.tunnelId;
    const session = this.apiSession;
    this.tunnelId = null; this.apiSession = null;
    if (tunnelId && session) {
      // Keep the forwarding socket alive until the remote API session has
      // acknowledged deletion. Closing it first leaves orphaned sessions on
      // the remote node during repeated foreground/background switches.
      void this.transport.request(tunnelId, "DELETE", `/api/codex/sessions/${encodeURIComponent(session)}`, undefined, session)
        .catch(() => undefined)
        .finally(() => this.transport.closeTunnel(tunnelId));
    } else if (tunnelId) {
      this.transport.closeTunnel(tunnelId);
    }
    this.status = { phase: "stopped", transport: "stdio", message: "Detached; remote task continues" };
    this.emit("status", this.getStatus());
  }
  public async interrupt(threadId: string, turnId: string): Promise<JsonValue> {
    await this.ensureConnected();
    return await this.request("turn/interrupt", { threadId, turnId });
  }
  public async restart(): Promise<EngineStatus> { this.stop(); return await this.start(); }
  public async request(method: string, params?: JsonValue): Promise<JsonValue> {
    await this.ensureConnected();
    let result: Record<string, unknown>;
    try {
      result = asRecord(await this.transport.request(this.tunnelId!, "POST", "/api/codex/rpc", { method, params }, this.apiSession!));
    } catch (error) {
      if (!isRemoteTransportFailure(error)) throw error;
      const reconnecting = this.reconnect(error);
      if (!isRemoteRpcRetrySafe(method)) {
        void reconnecting.catch(() => undefined);
        throw error;
      }
      await reconnecting;
      result = asRecord(await this.transport.request(this.tunnelId!, "POST", "/api/codex/rpc", { method, params }, this.apiSession!));
    }
    const data = asRecord(result.data ?? result);
    return (data.result ?? data) as JsonValue;
  }
  public async notify(method: string, params?: JsonValue): Promise<void> { await this.request(method, params); }
  /**
   * Answer a server request the remote node raised. Without this an approval or
   * Plan prompt from a backgrounded thread would sit in the remote journal for
   * ever, because the remote node has no UI of its own to resolve it.
   *
   * Fire-and-forget by contract: `CodexRuntimeClient.respond` is synchronous, so
   * a delivery failure is surfaced as a status message rather than thrown.
   */
  public respond(id: JsonRpcId, result?: JsonValue, error?: JsonRpcFailure["error"]): void {
    if (!this.tunnelId || !this.apiSession) {
      this.emit("stderr", "Dropped a response for remote request " + String(id) + ": the remote node is detached\n");
      return;
    }
    void this.transport.request(this.tunnelId, "POST", "/api/codex/server-request/respond", {
      requestId: id,
      ...(error ? { error } : { result: result ?? {} }),
    }, this.apiSession).catch((cause: unknown) => {
      this.emit("stderr", "Failed to answer remote request " + String(id) + ": " + (cause instanceof Error ? cause.message : String(cause)) + "\n");
    });
  }
  private async pollEvents(): Promise<void> {
    while (!this.pollAbort && this.tunnelId && this.apiSession) {
      try {
        // One remote node hosts every autonomous thread on that host and keeps a
        // single journal, so an unfiltered poll would hand this thread another
        // thread's events — and raise its approvals a second time here.
        const query = new URLSearchParams({
          after: String(this.cursor),
          waitMs: "30000",
          limit: "512",
          threadId: this.route.threadId,
        });
        const result = asRecord(await this.transport.request(this.tunnelId, "GET", `/api/codex/events?${query}`, undefined, this.apiSession));
        const data = asRecord(result.data ?? result);
        const events = Array.isArray(data.events) ? data.events : [];
        for (const value of events) {
          const event = asRecord(value);
          this.cursor = Math.max(this.cursor, number(event.id) ?? 0);
          this.emit("cursor", this.cursor);
          // Both kinds ride the same journal. Notifications render the
          // transcript; server requests are approvals and Plan prompts that
          // block the remote turn until somebody answers them here.
          if (event.kind === "notification" || event.kind === "serverRequest") this.emit("message", event.payload);
        }
      } catch (error) {
        if (this.pollAbort) return;
        if (!isRemoteTransportFailure(error)) {
          this.status = { phase: "error", transport: "stdio", message: error instanceof Error ? error.message : String(error) };
          this.emit("status", this.getStatus());
          return;
        }
        try { await this.reconnect(error); } catch { return; }
      }
    }
  }
  private async ensureConnected(): Promise<void> {
    if (this.status.phase === "ready" && this.tunnelId && this.apiSession) return;
    if (this.reconnecting) { await this.reconnecting; return; }
    await this.start();
  }
  private async reconnect(cause: unknown): Promise<EngineStatus> {
    if (this.pollAbort) throw cause;
    if (this.reconnecting) return await this.reconnecting;
    const generation = ++this.connectionGeneration;
    this.reconnecting = (async () => {
      this.releaseConnection();
      let lastError = cause;
      for (let attempt = 0; !this.pollAbort && generation === this.connectionGeneration && attempt < REMOTE_RECONNECT_MAX_ATTEMPTS; attempt += 1) {
        const delayMs = remoteReconnectDelayMs(attempt);
        const message = attempt + 1 < REMOTE_RECONNECT_MAX_ATTEMPTS
          ? `SSH connection lost; reconnecting in ${delayMs}ms (attempt ${attempt + 1})`
          : `SSH connection lost; reconnecting in ${delayMs}ms (final attempt ${attempt + 1}/${REMOTE_RECONNECT_MAX_ATTEMPTS})`;
        this.status = { phase: "reconnecting", transport: "stdio", message };
        this.emit("status", this.getStatus());
        await delay(delayMs);
        try {
          await this.connect(true);
          this.status = { phase: "ready", transport: "stdio", message: "Remote Bun Server reconnected" };
          this.emit("status", this.getStatus());
          return this.getStatus();
        } catch (error) { lastError = error; this.releaseConnection(); }
      }
      if (!this.pollAbort && generation === this.connectionGeneration) {
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        this.status = {
          phase: "error",
          transport: "stdio",
          message: `SSH reconnect exhausted after ${REMOTE_RECONNECT_MAX_ATTEMPTS} attempts: ${message}`
        };
        this.emit("status", this.getStatus());
      }
      throw lastError;
    })();
    try { return await this.reconnecting; } finally { this.reconnecting = null; }
  }
  private async connect(preserveCursor: boolean): Promise<void> {
    const previousCursor = this.cursor;
    const tunnel = await this.transport.openTunnel(this.route.command, this.route.remotePort);
    this.tunnelId = tunnel.tunnelId;
    try {
      await this.transport.request(tunnel.tunnelId, "POST", "/api/engine/start");
      const session = asRecord(await this.transport.request(tunnel.tunnelId, "POST", "/api/codex/sessions"));
      const data = asRecord(session.data ?? session);
      this.apiSession = text(data.sessionId);
      if (!this.apiSession) throw new Error("Remote Bun Server did not create an API session");
      this.cursor = preserveCursor ? previousCursor : this.cursor > 0 ? this.cursor : number(data.cursor) ?? 0;
    } catch (error) {
      this.transport.closeTunnel(tunnel.tunnelId);
      this.tunnelId = null; this.apiSession = null;
      throw error;
    }
  }
  private releaseConnection(): void {
    const tunnelId = this.tunnelId;
    this.tunnelId = null; this.apiSession = null;
    if (tunnelId) this.transport.closeTunnel(tunnelId);
  }
}
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function number(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function safeCursor(value: unknown): number { const cursor = Number(value); return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0; }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
export function remoteReconnectDelayMs(attempt: number): number {
  if (attempt <= 0) return 250;
  return Math.min(30_000, 500 * 2 ** Math.min(attempt - 1, 6));
}
export function isRemoteRpcRetrySafe(method: string): boolean {
  return /^(thread\/(read|turns\/list|items\/list|history\/(fileInfo|tail))|config\/(read|get)|thread\/goal\/get)$/.test(method);
}
export function isRemoteTransportFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|failed to fetch|econn|socket|network|tunnel|timed out|connection reset|connection refused|remote bun server is unreachable/i.test(message);
}
