import { spawnCli } from "@cxu/sdk-backend";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { probeClineVersion } from "./clineCommand.js";

/**
 * Minimum CLI that supports `hub start --discovery-path` (reverse-engineered
 * from 3.0.73 and verified live against it). Older CLIs fail hub start with
 * `unknown option '--discovery-path'` — gate here with an actionable error
 * instead of surfacing the raw vendor usage text.
 */
export const CLINE_MIN_HUB_VERSION = "3.0.73";

/** Numeric triple compare (-1 | 0 | 1); non-numeric segments count as 0. */
export function compareClineVersions(a: string, b: string): number {
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

/**
 * Whether the probed CLI can serve the hub protocol. Unknown (probe failed)
 * proceeds — the spawn failure itself surfaces. Known-old fails fast.
 */
export function isClineHubSupported(version: string | null | undefined): boolean {
  if (!version || !version.trim()) return true;
  return compareClineVersions(version, CLINE_MIN_HUB_VERSION) >= 0;
}

/**
 * Client for the Cline CLI's own hub daemon — the interface the vendor's
 * TUI/kanban clients use, reverse-engineered from the cline 3.0.73 binary
 * and verified live against it (2026-10-24). ACP was rejected by the user
 * (too restrictive, and it refuses sessions without a vendor login); the
 * hub protocol has neither problem: providers are plain BYOK config.
 *
 * Protocol (protocolVersion "v1"):
 *  - The daemon is started with `cline hub start --discovery-path <file>`
 *    and writes a discovery record {url, authToken, pid, ...} there. It is
 *    a detached process; CLINE_DATA_DIR pins its state directory.
 *  - Transport: WebSocket to <url> (ws://127.0.0.1:<port>/hub) with the
 *    auth token as a subprotocol: `cline-hub-auth.<authToken>`.
 *  - Commands: {kind:"command", envelope:{version:"v1", command, requestId,
 *    clientId, sessionId?, timeoutMs, payload}}; replies come back as
 *    {kind:"reply", envelope:{version, requestId, ok, payload?, error?}}.
 *  - The first command on a socket must be client.register.
 *  - Events arrive as {kind:"event", envelope:{version, event, eventId,
 *    sessionId, timestamp, payload, sequence?}} after sending a raw
 *    {kind:"stream.subscribe", clientId, sessionId?} frame (no sessionId =
 *    all sessions; events may be delivered twice when both a global and a
 *    per-session subscription match — consumers dedupe by eventId).
 *  - Turns: session.create (provider/model ride in payload.metadata) then
 *    run.enqueue {prompt}; completion is the run.completed / run.failed
 *    event, whose payload.result carries {text, usage, messages}.
 */

export interface ClineHubDiscovery {
  url: string;
  authToken: string;
  pid?: number;
  hubId?: string;
}

export interface ClineHubEvent {
  event: string;
  eventId?: string;
  sessionId?: string;
  timestamp?: number;
  sequence?: number;
  payload: Record<string, unknown>;
}

export interface ClineHubClientOptions {
  binPath: string;
  /** Isolated cline state dir (CLINE_DATA_DIR for the hub daemon). */
  dataDir: string;
  runtimeEnv?: () => NodeJS.ProcessEnv;
}

const REGISTER_TIMEOUT_MS = 30_000;

export class ClineHubClient extends EventEmitter {
  private readonly options: ClineHubClientOptions;
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private registered = false;
  private readonly pending = new Map<string, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly subscribedSessions = new Set<string>();
  private globalSubscribed = false;
  private requestSeq = 0;
  readonly clientId: string;

  constructor(options: ClineHubClientOptions) {
    super();
    this.options = options;
    this.clientId = `core-cxu-${Math.random().toString(36).slice(2, 10)}`;
  }

  get discoveryPath(): string {
    return join(this.options.dataDir, "hub-discovery.json");
  }

  /** Start the hub daemon unless a compatible one is already running. */
  async ensureHub(): Promise<ClineHubDiscovery> {
    const existing = this.readDiscovery();
    if (existing && existing.pid && isProcessAlive(existing.pid)) {
      return existing;
    }
    const cliVersion = probeClineVersion(this.options.binPath);
    if (!isClineHubSupported(cliVersion)) {
      throw new Error(
        `cline hub requires CLI >= ${CLINE_MIN_HUB_VERSION} for --discovery-path (found ${cliVersion}); update with 'npm update -g cline' and retry`,
      );
    }
    const env = { ...(this.options.runtimeEnv?.() ?? process.env), CLINE_DATA_DIR: this.options.dataDir };
    await new Promise<void>((resolve, reject) => {
      const child = spawnCli(this.options.binPath, ["hub", "start", "--discovery-path", this.discoveryPath], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`cline hub start failed (${code}): ${stderr.slice(0, 300)}`));
      });
    });
    const discovery = this.readDiscovery();
    if (!discovery) throw new Error("cline hub did not write a discovery record");
    return discovery;
  }

  private readDiscovery(): ClineHubDiscovery | null {
    try {
      if (!existsSync(this.discoveryPath)) return null;
      const parsed = JSON.parse(readFileSync(this.discoveryPath, "utf8")) as Record<string, unknown>;
      if (typeof parsed.url !== "string" || typeof parsed.authToken !== "string") return null;
      return {
        url: parsed.url,
        authToken: parsed.authToken,
        pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
        hubId: typeof parsed.hubId === "string" ? parsed.hubId : undefined,
      };
    } catch {
      return null;
    }
  }

  async connect(): Promise<void> {
    if (this.socket && this.registered) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = (async () => {
      const discovery = await this.ensureHub();
      const socket = new WebSocket(discovery.url, [`cline-hub-auth.${discovery.authToken}`]);
      this.socket = socket;
      socket.on("message", (data) => this.handleMessage(data.toString()));
      socket.on("close", () => this.handleSocketClosed());
      socket.on("error", () => { /* surfaced through close */ });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", (error) => reject(error));
      });
      await this.commandOnce("client.register", {
        clientId: this.clientId,
        clientType: "cxu-bridge",
        displayName: "codex-react-ui cline bridge",
        transport: "native",
        actorKind: "client",
        capabilities: [],
        metadata: { version: "0.0.95", pid: process.pid },
        workspaceContext: {},
      }, undefined, REGISTER_TIMEOUT_MS, true);
      this.registered = true;
      // Restore subscriptions after (re)connect.
      if (this.globalSubscribed) this.sendSubscribe(undefined);
      for (const sessionId of this.subscribedSessions) this.sendSubscribe(sessionId);
    })();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private handleSocketClosed(): void {
    this.registered = false;
    this.socket = null;
    for (const [requestId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`cline hub connection closed (request ${requestId})`));
    }
    this.pending.clear();
    this.emit("disconnected");
  }

  private handleMessage(text: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    const envelope = (msg.envelope ?? msg) as Record<string, unknown>;
    if (msg.kind === "reply" && typeof envelope.requestId === "string") {
      const entry = this.pending.get(envelope.requestId);
      if (!entry) return;
      this.pending.delete(envelope.requestId);
      clearTimeout(entry.timer);
      if (envelope.ok === true) {
        entry.resolve((envelope.payload ?? {}) as Record<string, unknown>);
      } else {
        const error = (envelope.error ?? {}) as Record<string, unknown>;
        entry.reject(new Error(typeof error.message === "string" ? error.message : "cline hub command failed"));
      }
      return;
    }
    if (msg.kind === "event") {
      const event: ClineHubEvent = {
        event: typeof envelope.event === "string" ? envelope.event : "",
        eventId: typeof envelope.eventId === "string" ? envelope.eventId : undefined,
        sessionId: typeof envelope.sessionId === "string" ? envelope.sessionId : undefined,
        timestamp: typeof envelope.timestamp === "number" ? envelope.timestamp : undefined,
        sequence: typeof envelope.sequence === "number" ? envelope.sequence : undefined,
        payload: (envelope.payload ?? {}) as Record<string, unknown>,
      };
      if (event.event) this.emit("event", event);
    }
  }

  private sendSubscribe(sessionId: string | undefined): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      kind: "stream.subscribe",
      clientId: this.clientId,
      ...(sessionId ? { sessionId } : {}),
    }));
  }

  /** Subscribe to one session's events (or all sessions when omitted). */
  subscribe(sessionId?: string): void {
    if (sessionId) {
      if (this.subscribedSessions.has(sessionId)) return;
      this.subscribedSessions.add(sessionId);
    } else {
      if (this.globalSubscribed) return;
      this.globalSubscribed = true;
    }
    this.sendSubscribe(sessionId);
  }

  async command(name: string, payload: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    try {
      return await this.commandOnce(name, payload, sessionId, timeoutMs, false);
    } catch (error) {
      // One transparent reconnect + retry, mirroring the vendor client.
      if (name === "client.register") throw error;
      this.registered = false;
      try { this.socket?.close(); } catch { /* noop */ }
      this.socket = null;
      return this.commandOnce(name, payload, sessionId, timeoutMs, false);
    }
  }

  private async commandOnce(name: string, payload: Record<string, unknown>, sessionId: string | undefined, timeoutMs: number, skipConnect: boolean): Promise<Record<string, unknown>> {
    if (!skipConnect) await this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("cline hub socket is not open");
    const requestId = `hubreq_${Date.now()}_${++this.requestSeq}`;
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) reject(new Error(`cline hub command ${name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    socket.send(JSON.stringify({
      kind: "command",
      envelope: {
        version: "v1",
        command: name,
        requestId,
        clientId: this.clientId,
        ...(sessionId ? { sessionId } : {}),
        timeoutMs,
        payload,
      },
    }));
    return result;
  }

  close(): void {
    try { this.socket?.close(); } catch { /* noop */ }
    this.socket = null;
    this.registered = false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
