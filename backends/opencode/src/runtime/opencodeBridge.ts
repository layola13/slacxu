import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  EngineStatus,
  JsonRpcId,
  JsonValue,
  JsonRpcNotification,
  JsonRpcFailure,
  ChannelGroupConfig,
  ProviderConfig,
  JsonRpcRequest,
  ModelCapabilityDescriptor,
} from "@codex-ui/shared";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import { OpencodeCompatibleRuntime, extractOpencodeTurnInput, type OpencodeRelayConfig, type OpencodeRuntimeConfig } from "./opencodeCompatibleRuntime.js";
import {
  isNativeOpencodeSessionId,
  listNativeOpencodeThreads,
  listNativeOpencodeTurns,
  nativeOpencodeFileInfo,
  readNativeOpencodeTail,
  readNativeOpencodeThread,
} from "./opencodeHistoryProjection.js";
import { OPENCODE_RELAY_PROVIDER_ID } from "./opencodeCompatibleProcessManager.js";
import {
  OPENCODE_REVIEW_SLASH_RE,
  buildOpencodeReviewPrompt,
  formatOpencodeReviewSlash,
  parseOpencodeReviewTarget,
} from "./opencodeReview.js";
import { probeOpencodeCliCommand, findOpencodeBin, findOpencodeV2Bin } from "./opencodeCompatibleProbe.js";
import { getSaVmGlobalDataDir, SA_VM_MCP_SCRIPT_NAME, resolveSaVmMcpScriptPath } from "@cxu/sdk-backend";
import { bootstrapProjectSaVmAssets } from "@cxu/sdk-backend";
import { join } from "node:path";
import { existsSync } from "node:fs";

export const OPENCODE_OFFICIAL_PROVIDER_ID = "opencode-local";

export const OPENCODE_FALLBACK_FREE_MODELS = [
  "opencode/big-pickle",
  "opencode/ling-3.0-flash-fin-free",
  "opencode/mimo-v2.5-free",
  "opencode/mimo-v2.6-flash-free",
  "opencode/muse-spark-1.2-contributor-free",
  "opencode/muse-spark-1.3-contributor-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/nemotron-3.5-lightning-free",
];

/** v1/v2 分组 ID（opencode-local 仅保留这两组，无 default/free 分组）。 */
export const OPENCODE_V1_GROUP_ID = "v1";
export const OPENCODE_V2_GROUP_ID = "v2";

/** 旧 default/free 分组到 v1 的兼容映射（历史线程与外部网关 URL 过渡用）。 */
export function resolveOpencodeLocalGroupId(groupId: string | null | undefined): string {
  const normalized = (groupId ?? "").trim().toLowerCase();
  if (normalized === "default" || normalized === "free") return OPENCODE_V1_GROUP_ID;
  return (groupId ?? "").trim() || OPENCODE_V1_GROUP_ID;
}

/** v2 二进制缺失时的回退模型（以实测 `opencode2 models` 目录为准）。 */
export const OPENCODE_V2_FALLBACK_MODELS = [
  "opencode/big-pickle",
  "opencode/claude-haiku-5-5",
  "opencode/muse-wonder-1.0",
  "opencode-go/muse-spark-1.3-contributor",
  "opencode-go/gpt-6-luna",
  "opencode-go/glm-5.3",
];

/** Models explicitly prefixed with `opencode-go/` (the subscription agent tier). */
export function isOpencodeGoModel(model?: string): boolean {
  return /^opencode-go(?:\/|$)/i.test((model ?? "").trim());
}

/**
 * Pass-through special handling for `opencode/*` models is intentionally
 * disabled: every model (including `opencode/*`, empty, and `default`)
 * runs with full capabilities — developer instructions, tools, MCP, skills,
 * review expansion, and project bootstrap. Kept as a stub returning false
 * so existing imports/tests keep compiling.
 */
export function isOpencodePassThroughModel(_model?: string): boolean {
  return false;
}

/**
 * Every model receives Codex Ultra developer text prepended — only the
 * user's input is forwarded when there are no developer instructions.
 */
export function buildOpencodeModelPrompt(
  developerInstructions: string | undefined,
  cleanPrompt: string,
  _model?: string,
): string {
  const dev = (developerInstructions ?? "").trim();
  if (!dev) return cleanPrompt;
  if (!cleanPrompt.trim()) return dev;
  return `${dev}\n\n[User Instruction]\n${cleanPrompt}`;
}

/**
 * Resolve the per-turn SA-VM MCP injection for `OPENCODE_CONFIG_CONTENT`.
 *
 * All models (including `opencode/*`) may resolve the SA-VM MCP injection
 * when developer instructions are present.
 */
export function resolveOpencodeSaVmMcp(
  developerInstructions: string | undefined,
  cwd?: string,
  _model?: string,
): { scriptPath: string } | undefined {
  if (!developerInstructions || !developerInstructions.trim()) return undefined;
  // 工程目录优先：先看 `<cwd>/.codex-ultra/sa-vm`，再回退全局只读副本。
  const projectHit = (cwd ?? "").trim() ? resolveSaVmMcpScriptPath(cwd) : null;
  if (projectHit) return { scriptPath: projectHit };
  const scriptPath = join(getSaVmGlobalDataDir(), SA_VM_MCP_SCRIPT_NAME);
  if (!existsSync(scriptPath)) return undefined;
  return { scriptPath };
}

export function buildOpencodeOfficialProvider(v1Models?: string[], v2Models?: string[]): ProviderConfig {
  const v1 = v1Models && v1Models.length > 0 ? [...new Set(v1Models)] : [...OPENCODE_FALLBACK_FREE_MODELS];
  const v2 = v2Models && v2Models.length > 0 ? [...new Set(v2Models)] : [...OPENCODE_V2_FALLBACK_MODELS];
  const defaultModel = v1[0] ?? v2[0] ?? "opencode/big-pickle";
  const groupV1: ChannelGroupConfig = {
    id: OPENCODE_V1_GROUP_ID,
    name: "OpenCode v1",
    baseUrl: "http://127.0.0.1:4096",
    kind: "text",
    status: "enabled",
    groupRatio: 1,
    models: v1,
    responseProtocol: "openai-response",
    responseProtocolMode: "fixed",
    remark: "OpenCode v1 Local Serve",
    authType: "none",
    credentialMode: "group",
    keyMode: "single",
    keys: [],
  };
  const groupV2: ChannelGroupConfig = {
    id: OPENCODE_V2_GROUP_ID,
    name: "OpenCode v2",
    baseUrl: "http://127.0.0.1:4096",
    kind: "text",
    status: "enabled",
    groupRatio: 1,
    models: v2,
    responseProtocol: "openai-response",
    responseProtocolMode: "fixed",
    remark: "OpenCode v2 Local Serve",
    authType: "none",
    credentialMode: "group",
    keyMode: "single",
    keys: [],
  };
  return {
    id: OPENCODE_OFFICIAL_PROVIDER_ID,
    name: "OpenCode 本地",
    kind: "responsesRelay",
    serviceProvider: { id: "opencode", name: "OpenCode" },
    baseUrl: "http://127.0.0.1:4096",
    defaultModel,
    nativeModels: [...new Set([...v1, ...v2])],
    modelAliases: [],
    stationType: "official",
    channelMode: "fast",
    remark: "OpenCode Local Serve",
    groups: [groupV1, groupV2],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export interface OpencodeSessionSnapshot {
  threadId: string;
  ownerId?: string;
  sessionId?: string;
  name?: string;
  parentThreadId?: string;
  agentType?: string;
  taskName?: string;
  additionalRoots?: string[];
  preview?: string;
  model?: string;
  providerId?: string;
  groupId?: string;
  relay?: OpencodeRelayConfig;
  developerInstructions?: string;
  cwd?: string;
  dangerous?: boolean;
  /** OpenCode API generation that created this snapshot (absent = v1 legacy). */
  apiVersion?: 1 | 2;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
}

export interface OpencodeRelayTarget {
  baseUrl: string;
  apiKey: string;
  targetModel: string;
  contextWindow?: number | null;
  modelCapability?: ModelCapabilityDescriptor | null;
}

export interface OpencodeBridgeOptions {
  onSnapshot?: (snapshot: OpencodeSessionSnapshot) => void;
  loadSnapshot?: (threadId: string, ownerId?: string) => OpencodeSessionSnapshot | null;
  // Lightweight metadata read for `thread/read(includeTurns:false)`: must NOT
  // touch `state_json` (the full snapshot can be tens of MB and blocks the
  loadMetadata?: (threadId: string, ownerId?: string) => Partial<OpencodeSessionSnapshot> | null;
  listSnapshots?: (ownerId?: string) => OpencodeSessionSnapshot[];
  resolveRelayTarget?: (providerId: string, groupId?: string, model?: string) => Promise<OpencodeRelayTarget | undefined>;
  /**
   * OpenCode API generation this bridge drives: 1 = v1 line (default),
   * 2 = v2 line (`opencode-v2` backend). A bridge instance serves exactly
   * one generation; index.ts owns one bridge per generation.
   */
  opencodeApiVersion?: 1 | 2;
}

export interface OpencodeSession {
  threadId: string;
  ownerId?: string;
  cwd: string;
  model?: string;
  providerId?: string;
  groupId?: string;
  relay?: OpencodeRelayConfig;
  developerInstructions?: string;
  dangerous?: boolean;
  sessionId?: string;
  name?: string;
  parentThreadId?: string;
  agentType?: string;
  taskName?: string;
  additionalRoots?: string[];
  preview?: string;
  activeTurnId?: string;
  runtime?: OpencodeCompatibleRuntime;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
}

export class OpencodeBridge extends EventEmitter implements CodexRuntimeClient {
  private options?: OpencodeBridgeOptions;
  private sessions = new Map<string, OpencodeSession>();
  private pendingRequestOwners = new Map<string, OpencodeSession>();
  private status: EngineStatus = {
    phase: "ready",
    transport: "stdio",
    message: "OpenCode CLI ready",
  };

  constructor(options?: OpencodeBridgeOptions) {
    super();
    this.options = options;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  private get apiVersion(): 1 | 2 {
    return this.options?.opencodeApiVersion ?? 1;
  }

  /** Backend identity stamped on every thread/session object this bridge
   * returns: the v2 instance must never present its threads as v1. */
  private get backendId(): "opencode" | "opencode-v2" {
    return this.apiVersion === 2 ? "opencode-v2" : "opencode";
  }

  async start(): Promise<EngineStatus> {
    const isV2 = this.apiVersion === 2;
    const bin = isV2 ? findOpencodeV2Bin() : findOpencodeBin();
    const probe = bin ? probeOpencodeCliCommand(bin) : { available: false, binPath: "", error: undefined as string | undefined };
    if (!probe.available) {
      this.status = {
        phase: "error",
        transport: "stdio",
        message: probe.error ?? (isV2
          ? "OpenCode v2 CLI not found (set OPENCODE_V2_BIN to a v2 binary)"
          : "OpenCode CLI not found"),
      };
    } else {
      this.status = {
        phase: "ready",
        transport: "stdio",
        message: `OpenCode CLI v${probe.version ?? "unknown"} ready`,
      };
    }
    return this.status;
  }

  stop(): void {
    for (const session of this.sessions.values()) {
      session.runtime?.stop();
    }
    this.sessions.clear();
    this.pendingRequestOwners.clear();
    this.status = {
      phase: "stopped",
      transport: "stdio",
      message: "OpenCode CLI stopped",
    };
  }

  async restart(): Promise<EngineStatus> {
    this.stop();
    return this.start();
  }

  async notify(_method: string, _params?: JsonValue): Promise<void> {}

  respond(id: JsonRpcId, result?: JsonValue, error?: JsonRpcFailure["error"]): void {
    const reqIdStr = String(id);
    const owningSession = this.pendingRequestOwners.get(reqIdStr);
    this.pendingRequestOwners.delete(reqIdStr);

    const errorMessage = error && typeof (error as { message?: unknown }).message === "string"
      ? { message: (error as { message: string }).message }
      : undefined;

    // Question tool answers route to the owning runtime first (Codex
    // `requestUserInput` parity); anything else stays a permission reply.
    if (owningSession?.runtime) {
      try {
        if (owningSession.runtime.respondToQuestionRequest(reqIdStr, result, errorMessage)) {
          return;
        }
      } catch {
        // Fall through to permission handling.
      }
    } else {
      for (const session of this.sessions.values()) {
        try {
          if (session.runtime?.respondToQuestionRequest(reqIdStr, result, errorMessage)) {
            return;
          }
        } catch {
          // Fall through to permission handling.
        }
      }
    }

    const resRecord = (result && typeof result === "object" && !Array.isArray(result) ? result : {}) as Record<string, unknown>;
    const decision = resRecord.decision
      ?? (resRecord.scope === "session" ? "acceptForSession" : resRecord.scope === "turn" ? "accept" : undefined)
      ?? (resRecord.approved === true ? "accept" : resRecord.approved === false ? "decline" : undefined);

    let reply: "once" | "always" | "reject" = "reject";
    if (!error) {
      if (decision === "accept" || decision === "approved") {
        reply = "once";
      } else if (
        decision === "always" ||
        decision === "acceptForSession" ||
        decision === "approved_for_session"
      ) {
        reply = "always";
      } else {
        reply = "reject";
      }
    }

    // Targeted permission reply to owning session runtime if known
    if (owningSession?.runtime) {
      void owningSession.runtime.replyPermission(reqIdStr, reply);
      return;
    }

    // Fallback: broadcast across sessions with active runtime
    for (const session of this.sessions.values()) {
      if (session.runtime) {
        void session.runtime.replyPermission(reqIdStr, reply);
      }
    }
  }

  hasSession(threadId: string): boolean {
    return this.sessions.has(threadId);
  }

  /** 原生 ses_* → Ultra thread（网关线程归因用；只读，不创建会话）。 */
  public findThreadIdBySessionId(nativeSessionId: string): string | null {
    const needle = nativeSessionId.trim();
    if (!needle) return null;
    if (this.sessions.has(needle)) return needle;
    for (const session of this.sessions.values()) {
      if (session.sessionId === needle) return session.threadId;
    }
    return null;
  }

  deleteSession(threadId: string): void {
    const session = this.sessions.get(threadId);
    if (session) {
      session.runtime?.stop();
      for (const [reqId, sess] of this.pendingRequestOwners.entries()) {
        if (sess === session || sess.threadId === threadId) {
          this.pendingRequestOwners.delete(reqId);
        }
      }
      this.sessions.delete(threadId);
    }
  }

  private async resolveRelay(providerId?: string, groupId?: string, model?: string): Promise<OpencodeRelayConfig | undefined> {
    if (!providerId || providerId === OPENCODE_OFFICIAL_PROVIDER_ID || !this.options?.resolveRelayTarget) return undefined;
    const target = await this.options.resolveRelayTarget(providerId, groupId, model).catch(() => undefined);
    if (!target || !target.baseUrl || !target.targetModel) return undefined;
    return {
      providerID: OPENCODE_RELAY_PROVIDER_ID,
      baseURL: target.baseUrl,
      apiKey: target.apiKey || "loopback",
      models: [target.targetModel],
      targetModel: target.targetModel,
      contextWindow: typeof target.contextWindow === "number" && target.contextWindow > 0 ? target.contextWindow : undefined,
      modelCapability: target.modelCapability ?? null,
    };
  }

  restoreSession(snapshot: OpencodeSessionSnapshot): OpencodeSession {
    // A session id minted by the other OpenCode API generation is not
    // addressable through this bridge's API; drop it so a fresh session
    // is created instead of failing against the wrong endpoints.
    const snapshotSessionId = snapshot.apiVersion && snapshot.apiVersion !== this.apiVersion
      ? undefined
      : snapshot.sessionId;
    const existing = this.sessions.get(snapshot.threadId);
    if (existing) {
      existing.ownerId = snapshot.ownerId ?? existing.ownerId;
      existing.sessionId = snapshotSessionId ?? existing.sessionId;
      existing.name = snapshot.name ?? existing.name;
      existing.parentThreadId = snapshot.parentThreadId ?? existing.parentThreadId;
      existing.agentType = snapshot.agentType ?? existing.agentType;
      existing.taskName = snapshot.taskName ?? existing.taskName;
      existing.additionalRoots = snapshot.additionalRoots ?? existing.additionalRoots;
      existing.cwd = snapshot.cwd ?? existing.cwd;
      existing.model = snapshot.model ?? existing.model;
      existing.providerId = snapshot.providerId ?? existing.providerId;
      existing.groupId = snapshot.groupId ?? existing.groupId;
      if (snapshot.relay) existing.relay = snapshot.relay;
      if (snapshot.developerInstructions) existing.developerInstructions = snapshot.developerInstructions;
      existing.dangerous = snapshot.dangerous ?? existing.dangerous;
      existing.preview = snapshot.preview ?? existing.preview;
      existing.turns = snapshot.turns.length > 0 ? snapshot.turns : existing.turns;
      existing.messages = snapshot.messages.length > 0 ? snapshot.messages : existing.messages;
      return existing;
    }

    const session: OpencodeSession = {
      threadId: snapshot.threadId,
      ownerId: snapshot.ownerId,
      sessionId: snapshotSessionId,
      name: snapshot.name,
      parentThreadId: snapshot.parentThreadId,
      agentType: snapshot.agentType,
      taskName: snapshot.taskName,
      additionalRoots: snapshot.additionalRoots,
      cwd: snapshot.cwd || process.cwd(),
      model: snapshot.model,
      providerId: snapshot.providerId,
      groupId: snapshot.groupId,
      relay: snapshot.relay,
      developerInstructions: snapshot.developerInstructions,
      dangerous: snapshot.dangerous,
      preview: snapshot.preview,
      turns: snapshot.turns ?? [],
      messages: snapshot.messages ?? [],
    };
    this.sessions.set(snapshot.threadId, session);
    return session;
  }

  private persistSession(session: OpencodeSession): void {
    if (!this.options?.onSnapshot) return;
    this.options.onSnapshot({
      threadId: session.threadId,
      ownerId: session.ownerId,
      sessionId: session.sessionId,
      name: session.name,
      parentThreadId: session.parentThreadId,
      agentType: session.agentType,
      taskName: session.taskName,
      additionalRoots: session.additionalRoots,
      preview: session.preview,
      model: session.model,
      providerId: session.providerId,
      groupId: session.groupId,
      relay: session.relay,
      developerInstructions: session.developerInstructions,
      cwd: session.cwd,
      dangerous: session.dangerous,
      apiVersion: this.apiVersion,
      turns: session.turns,
      messages: session.messages,
    });
  }

  /**
   * Read-only native projection (opencode SQLite `ses_*` sessions).
   * Never creates a runtime or subscription — mirrors the Codex JSONL tail
   * projection used for legacy history opens.
   */
  private readNativeThread(threadId: string, includeTurns: boolean): JsonValue | null {
    if (!isNativeOpencodeSessionId(threadId)) return null;
    const read = readNativeOpencodeThread(threadId, { includeTurns });
    if (!read) return null;
    if (!includeTurns) {
      return {
        thread: { ...read.thread, turns: [] },
        items: [],
      } as unknown as JsonValue;
    }
    return read as unknown as JsonValue;
  }

  /**
   * Materialize a native session into a live bridge session so follow-up
   * turns can run. Only called on explicit resume/send — plain reads stay
   * read-only and never touch the snapshot store.
   */
  private materializeNativeSession(threadId: string, ownerId?: string): OpencodeSession | null {
    if (!isNativeOpencodeSessionId(threadId)) return null;
    const read = readNativeOpencodeThread(threadId, { includeTurns: true });
    if (!read) return null;
    const thread = read.thread as Record<string, unknown>;
    const turns = (Array.isArray(thread.turns) ? thread.turns : []) as Array<{ id: string; status: string; createdAt: number }>;
    const messages = (Array.isArray(read.items) ? read.items : []) as JsonValue[];
    const session: OpencodeSession = {
      threadId,
      ownerId,
      // Preserve the native `ses_*` id so thread/read round-trips the same
      // sessionId and the runtime can attempt continuity instead of forking
      // a nameless copy with a wrong cwd.
      sessionId: threadId,
      cwd: typeof thread.cwd === "string" && thread.cwd.trim() ? thread.cwd.trim() : process.cwd(),
      model: typeof thread.model === "string" ? thread.model : undefined,
      name: typeof thread.name === "string" && thread.name.trim() ? thread.name.trim() : undefined,
      parentThreadId: typeof thread.parentThreadId === "string" && thread.parentThreadId.trim() ? thread.parentThreadId.trim() : undefined,
      additionalRoots: Array.isArray(thread.additionalRoots) ? thread.additionalRoots.filter((r): r is string => typeof r === "string") : undefined,
      preview: typeof thread.preview === "string" ? thread.preview : undefined,
      turns: turns.map((t) => ({ id: String(t.id), status: String(t.status ?? "completed"), createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now() })),
      messages,
    };
    this.sessions.set(threadId, session);
    this.persistSession(session);
    return session;
  }

  private resolveSession(threadId: string, ownerId?: string): OpencodeSession | undefined {
    let session = this.sessions.get(threadId);
    if (!session && this.options?.loadSnapshot) {
      const snapshot = this.options.loadSnapshot(threadId, ownerId);
      if (snapshot) session = this.restoreSession(snapshot);
    }
    return session;
  }

  private wireRuntimeEvents(session: OpencodeSession, runtime: OpencodeCompatibleRuntime): void {
    runtime.on("sessionId", (sessionId: string) => {
      session.sessionId = sessionId;
      this.persistSession(session);
    });

    runtime.on("serverRequest", (request: JsonRpcRequest) => {
      this.pendingRequestOwners.set(String(request.id), session);
      this.emit("message", request);
    });

    runtime.on("notification", (notif: JsonRpcNotification) => {
      if (notif.method === "serverRequest/resolved") {
        const params = notif.params && typeof notif.params === "object" && !Array.isArray(notif.params)
          ? notif.params as Record<string, unknown>
          : undefined;
        const requestId = params?.requestId;
        if (typeof requestId === "string" || typeof requestId === "number") {
          const requestKey = String(requestId);
          if (this.pendingRequestOwners.get(requestKey) === session) {
            this.pendingRequestOwners.delete(requestKey);
          }
        }
      }
      if (notif.method === "turn/started") {
        // Prevent duplicate turn/started notification if opencodeBridge already emitted it for the user message
        const turnId = (notif.params as any)?.turnId;
        const existingTurn = session.turns.find((t) => t.id === turnId);
        if (existingTurn && existingTurn.status === "inProgress") {
          return;
        }
      }
      if (notif.method === "item/completed" || notif.method === "item/started") {
        const item = (notif.params as any)?.item;
        if (item) {
          if (!item.turnId) {
            item.turnId = (notif.params as any)?.turnId ?? session.activeTurnId;
          }
          const idx = session.messages.findIndex((m: any) => m && m.id === item.id);
          if (idx >= 0) {
            const existing = session.messages[idx] as any;
            const isTerminal = existing && (
              existing.status === "completed" ||
              existing.status === "failed" ||
              existing.status === "interrupted"
            );
            // Late item/started guard
            if (notif.method === "item/started" && isTerminal) {
              return;
            }
            session.messages[idx] = item;
          } else {
            session.messages.push(item);
          }
        }
      } else if (notif.method === "turn/completed") {
        const turnId = (notif.params as any)?.turnId;
        const t = session.turns.find((entry) => entry.id === turnId);
        if (t) t.status = "completed";
        if (session.activeTurnId === turnId) session.activeTurnId = undefined;
        try {
          const turnMessages = session.messages.filter((m: any) => m && (m as any).turnId === turnId);
          const reasoningChars = turnMessages
            .filter((m: any) => (m as any).type === "reasoning")
            .reduce((n: number, m: any) => n + String((m as any).text ?? "").length, 0);
          const assistantChars = turnMessages
            .filter((m: any) => (m as any).type === "agentMessage")
            .reduce((n: number, m: any) => n + String((m as any).text ?? "").length, 0);
          if (assistantChars > 0 && reasoningChars === 0) {
            console.info(`[opencodeBridge] turn completed with no reasoning items turn=${String(turnId).slice(0, 16)}... assistantChars=${assistantChars} model=${session.model ?? "?"}`);
          }
        } catch {
          // ignore diagnostics failures
        }
        this.persistSession(session);
      } else if (notif.method === "turn/failed" || notif.method === "turn/interrupted") {
        const turnId = (notif.params as any)?.turnId;
        const t = session.turns.find((entry) => entry.id === turnId);
        if (t) t.status = notif.method === "turn/failed" ? "failed" : "interrupted";
        if (session.activeTurnId === turnId) session.activeTurnId = undefined;
        this.persistSession(session);
      }
      this.emit("notification", notif);
    });
  }

  private async ensureRuntime(session: OpencodeSession): Promise<OpencodeCompatibleRuntime> {
    const relay = await this.resolveRelay(session.providerId, session.groupId, session.model);
    if (relay) {
      session.relay = relay;
    } else if (session.providerId && session.providerId !== OPENCODE_OFFICIAL_PROVIDER_ID) {
      session.relay = undefined;
    } else {
      session.relay = undefined;
    }
    // No per-model isolation: every model (including `opencode/*`) keeps
    // the normal config and may resolve SA-VM MCP.
    const isolateThirdParty = false;
    const saVmMcp = resolveOpencodeSaVmMcp(session.developerInstructions, session.cwd, session.model);
    if (!session.runtime) {
      const runtimeConfig: OpencodeRuntimeConfig = {
        threadId: session.threadId,
        cwd: session.cwd,
        sessionId: session.sessionId,
        model: session.model,
        dangerous: session.dangerous,
        relay: session.relay,
        saVmMcp,
        isolateThirdParty,
        apiVersion: this.apiVersion,
      };
      session.runtime = new OpencodeCompatibleRuntime(runtimeConfig);
      this.wireRuntimeEvents(session, session.runtime);
    } else {
      session.runtime.updateConfig({
        cwd: session.cwd,
        sessionId: session.sessionId,
        model: session.model,
        dangerous: session.dangerous,
        relay: session.relay,
        saVmMcp,
        isolateThirdParty,
        apiVersion: this.apiVersion,
      });
    }
    this.persistSession(session);
    return session.runtime;
  }

  private async runCompaction(
    session: OpencodeSession,
    turnId: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      const runtime = await this.ensureRuntime(session);
      let providerID = typeof params.providerId === "string" && params.providerId.trim() ? params.providerId.trim() : undefined;
      let modelID = typeof params.model === "string" && params.model.trim()
        ? params.model.trim()
        : (typeof params.modelID === "string" && params.modelID.trim() ? params.modelID.trim() : undefined);

      const ok = await runtime.summarize({ providerID, modelID });
      if (!ok) {
        throw new Error("OpenCode summarize failed");
      }

      const item = session.messages.find((m: any) => m && m.type === "contextCompaction" && m.turnId === turnId) as Record<string, JsonValue> | undefined;
      if (item) {
        item.status = "completed";
        this.emit("notification", {
          method: "item/completed",
          params: { threadId: session.threadId, turnId, item },
        });
      }

      const turn = session.turns.find((t) => t.id === turnId);
      if (turn) turn.status = "completed";
      session.activeTurnId = undefined;
      this.persistSession(session);

      this.emit("notification", {
        method: "turn/completed",
        params: {
          threadId: session.threadId,
          turnId,
          turn: { id: turnId, threadId: session.threadId, status: "completed" },
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const item = session.messages.find((m: any) => m && m.type === "contextCompaction" && m.turnId === turnId) as Record<string, JsonValue> | undefined;
      if (item) {
        item.status = "failed";
        this.emit("notification", {
          method: "item/completed",
          params: { threadId: session.threadId, turnId, item },
        });
      }

      const turn = session.turns.find((t) => t.id === turnId);
      if (turn) turn.status = "failed";
      session.activeTurnId = undefined;
      this.persistSession(session);

      this.emit("notification", {
        method: "turn/failed",
        params: {
          threadId: session.threadId,
          turnId,
          turn: { id: turnId, threadId: session.threadId, status: "failed", error: msg },
        },
      });
    }
  }

  async request(method: string, params?: JsonValue, _timeoutMs?: number): Promise<JsonValue> {
    const record = (params && typeof params === "object" && !Array.isArray(params) ? params : {}) as Record<string, any>;
    // History-open reads must stay fast: log slow ones with thread + latency
    // so a stuck sidebar open can be attributed (giant transcript vs stall).
    const instrumentRead = method === "thread/read"
      || method === "thread/turns/list"
      || method === "thread/history/tail"
      || method === "thread/history/fileInfo";
    const readStartedAt = instrumentRead ? Date.now() : 0;
    try {
    switch (method) {
      case "thread/start": {
        const threadId = randomUUID();
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : process.cwd();
        const model = typeof record.model === "string" ? record.model : undefined;
        const providerId = typeof record.providerId === "string" && record.providerId.trim() ? record.providerId.trim() : undefined;
        const groupId = typeof record.groupId === "string" && record.groupId.trim() ? record.groupId.trim() : undefined;
        const dangerous = record.approvalPolicy === "never" || record.sandbox === "danger-full-access";
        const name = typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 120) : undefined;
        const parentThreadId = typeof record.parentThreadId === "string" && record.parentThreadId.trim() ? record.parentThreadId.trim() : undefined;
        const agentType = typeof record.agentType === "string" && record.agentType.trim() ? record.agentType.trim() : undefined;
        const taskName = typeof record.taskName === "string" && record.taskName.trim() ? record.taskName.trim() : undefined;
        const additionalRoots = Array.isArray(record.additionalRoots)
          ? record.additionalRoots.filter((r: unknown): r is string => typeof r === "string" && Boolean(r.trim()))
          : undefined;
        const developerInstructions = typeof record.developerInstructions === "string" && record.developerInstructions.trim()
          ? record.developerInstructions.trim()
          : undefined;

        const session: OpencodeSession = {
          threadId,
          ownerId,
          sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
          name,
          parentThreadId,
          agentType,
          taskName,
          additionalRoots,
          cwd,
          model,
          providerId,
          groupId,
          developerInstructions,
          dangerous,
          turns: [],
          messages: [],
        };
        this.sessions.set(threadId, session);
        this.persistSession(session);
        // 新机器自举：所有模型按工程目录落盘 MCP + skill。
        bootstrapProjectSaVmAssets(cwd, threadId);

        return {
          thread: {
            id: threadId,
            sessionId: session.sessionId ?? threadId,
            name: session.name ?? null,
            title: session.name ?? null,
            parentThreadId: session.parentThreadId ?? null,
            agentRole: session.agentType ?? null,
            agentNickname: session.taskName ?? null,
            additionalRoots: session.additionalRoots ?? [],
            providerId: session.providerId ?? null,
            groupId: session.groupId ?? null,
            status: "active",
            cliBackend: this.backendId,
            cwd: session.cwd,
            model: session.model,
            createdAt: Math.floor(Date.now() / 1000),
          },
          threadId,
        } as unknown as JsonValue;
      }

      case "thread/name/set": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        let session = this.resolveSession(threadId, ownerId);
        if (!session) {
          session = this.materializeNativeSession(threadId, ownerId) ?? undefined;
        }
        if (!session) return { ok: false } as unknown as JsonValue;
        if (ownerId) session.ownerId = ownerId;
        const name = typeof record.name === "string" ? record.name.trim().slice(0, 120) : "";
        if (name) {
          session.name = name;
          session.preview = name;
        } else {
          session.name = undefined;
          const firstUser = session.messages
            .map((m) => m as Record<string, unknown>)
            .find((m) => m && typeof m === "object" && (m.type === "userMessage" || m.role === "user"));
          const text = typeof firstUser?.text === "string" ? firstUser.text.trim().slice(0, 80) : "";
          if (text) session.preview = text;
        }
        this.persistSession(session);
        return { ok: true } as unknown as JsonValue;
      }

      case "thread/list": {
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const live = Array.from(this.sessions.values())
          .filter((s) => !ownerId || !s.ownerId || s.ownerId === ownerId || s.ownerId === "local")
          .map((s) => ({
            id: s.threadId,
            sessionId: s.sessionId ?? s.threadId,
            parentThreadId: s.parentThreadId ?? null,
            agentRole: s.agentType ?? null,
            agentNickname: s.taskName ?? null,
            name: s.name ?? null,
            title: s.name ?? null,
            preview: s.name ?? s.preview ?? "OpenCode conversation",
            model: s.model,
            providerId: s.providerId ?? null,
            groupId: s.groupId ?? null,
            status: { type: s.activeTurnId ? "running" : "idle" },
            cwd: s.cwd,
            additionalRoots: s.additionalRoots ?? [],
            cliBackend: this.backendId,
            source: "appServer",
            turns: [],
          }));
        const persisted = this.options?.listSnapshots?.(ownerId) ?? [];
        const seen = new Set(live.map((t) => t.id));
        // Live sessions run through real native `ses_*` sessions (sessionId):
        // exclude those linked natives or one conversation lists twice.
        for (const s of live) {
          if (typeof s.sessionId === "string" && s.sessionId) seen.add(s.sessionId);
        }
        const restored = persisted
          // Generation partition: a snapshot stamped by the other OpenCode
          // API generation must never surface here, otherwise the same
          // conversation lists twice with two backend stamps and the v1
          // bridge paints v2 threads with the v1 icon (and vice versa).
          // Snapshots without apiVersion are v1 legacy (only generation
          // that existed then), so only the v1 bridge keeps them.
          .filter((snap) => !seen.has(snap.threadId) && !snap.parentThreadId
            && (snap.apiVersion ?? 1) === this.apiVersion)
          .map((snap) => {
            const firstUserMessage = (Array.isArray(snap.messages) ? snap.messages : [])
              .map((item: any) => item as Record<string, unknown>)
              .find((item) => item && (item.type === "userMessage" || item.role === "user"));
            const preview = snap.name ?? snap.preview ?? (typeof firstUserMessage?.text === "string" ? firstUserMessage.text.slice(0, 100) : "OpenCode conversation");
            return {
              id: snap.threadId,
              sessionId: snap.sessionId ?? snap.threadId,
              parentThreadId: snap.parentThreadId ?? null,
              agentRole: snap.agentType ?? null,
              agentNickname: snap.taskName ?? null,
              name: snap.name ?? null,
              title: snap.name ?? null,
              preview,
              model: snap.model,
              providerId: snap.providerId ?? null,
              groupId: snap.groupId ?? null,
              status: { type: "idle" },
              cwd: snap.cwd ?? process.cwd(),
              additionalRoots: snap.additionalRoots ?? [],
              cliBackend: this.backendId,
              source: "appServer",
              turns: [],
            };
          });
        for (const r of restored) {
          seen.add(r.id);
          if (typeof r.sessionId === "string" && r.sessionId) seen.add(r.sessionId);
        }
        let native: any[] = [];
        try {
          native = listNativeOpencodeThreads(200).filter((t: any) => !seen.has(t.id) && !t.parentThreadId);
          for (const n of native) seen.add(n.id);
          // Second tab source (mini/codex parity): native child sessions carry
          // parentThreadId; the sidebar filters them out, ChatPanel builds
          // subagent tabs from them. Tops keep their own 200 cap.
          const kids = listNativeOpencodeThreads({ limit: 200, includeSubagents: true })
            .filter((t: any) => !seen.has(t.id) && t.parentThreadId);
          for (const k of kids) seen.add(k.id);
          native = [...native, ...kids];
        } catch {}
        return { threads: [...live.filter((s) => !s.parentThreadId), ...restored, ...native] } as unknown as JsonValue;
      }

      case "thread/delete": {
        const threadId = String(record.threadId ?? "");
        // Native `ses_*` rows live in the user's opencode store: this only
        // drops the live/materialized session, never native rows.
        this.deleteSession(threadId);
        return { success: true };
      }

      case "turn/start": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" && record.ownerId.trim() ? record.ownerId.trim() : undefined;
        let session = this.resolveSession(threadId, ownerId);
        if (!session) {
          session = this.materializeNativeSession(threadId, ownerId) ?? undefined;
        }
        if (session && ownerId && session.ownerId && session.ownerId !== "local" && session.ownerId !== ownerId) {
          throw new Error(`OpenCode session belongs to another owner: ${threadId}`);
        }
        if (!session) {
          const storedMeta = this.options?.loadMetadata?.(threadId, ownerId);
          if (storedMeta?.ownerId && storedMeta.ownerId !== "local" && ownerId && storedMeta.ownerId !== ownerId) {
            throw new Error(`OpenCode session belongs to another owner: ${threadId}`);
          }
          session = {
            threadId,
            ownerId: ownerId ?? storedMeta?.ownerId ?? "local",
            sessionId: storedMeta?.sessionId ?? threadId,
            cwd: (typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : storedMeta?.cwd) || process.cwd(),
            model: (typeof record.model === "string" && record.model.trim() ? record.model.trim() : storedMeta?.model) || "default",
            providerId: typeof record.providerId === "string" && record.providerId.trim() ? record.providerId.trim() : storedMeta?.providerId,
            groupId: typeof record.groupId === "string" && record.groupId.trim() ? record.groupId.trim() : storedMeta?.groupId,
            turns: [],
            messages: [],
          };
          this.sessions.set(threadId, session);
          this.persistSession(session);
        }

        if (session.activeTurnId) {
          const prevTurn = session.turns.find((t) => t.id === session.activeTurnId);
          if (prevTurn && (prevTurn.status === "inProgress" || prevTurn.status === "in_progress")) {
            prevTurn.status = "interrupted";
          }
          session.activeTurnId = undefined;
        }

        const turnId = randomUUID();
        session.activeTurnId = turnId;
        session.turns.push({ id: turnId, status: "inProgress", createdAt: Date.now() });

        if (typeof record.model === "string" && record.model.trim()) {
          session.model = record.model.trim();
        }
        if (typeof record.ownerId === "string" && record.ownerId.trim()) {
          session.ownerId = record.ownerId.trim();
        }
        if (typeof record.providerId === "string" && record.providerId.trim()) {
          session.providerId = record.providerId.trim();
        }
        if (typeof record.groupId === "string" && record.groupId.trim()) {
          session.groupId = record.groupId.trim();
        }
        const rawDevInstructions = typeof record.developerInstructions === "string" && record.developerInstructions.trim()
          ? record.developerInstructions.trim()
          : undefined;
        if (rawDevInstructions) session.developerInstructions = rawDevInstructions;

        // Extract user input text + image attachments (Codex UI sends `input`
        // array; fall back to `prompt`). Images become opencode `file` parts —
        // forwarding text only leaves user-attached pictures invisible to the model.
        const turnInput = await extractOpencodeTurnInput(record.input ?? record.prompt, record.prompt, session.cwd);
        for (const warning of turnInput.warnings) {
          console.warn(`[opencodeBridge] ${warning} (thread=${threadId})`);
        }
        const userPrompt = turnInput.text;
        const attachmentBlocks = turnInput.attachmentBlocks;
        const cleanPrompt = userPrompt.trim();

        if (!session.preview) {
          const previewText = cleanPrompt || (turnInput.fileParts.length > 0 ? `[${turnInput.fileParts.length} image(s)]` : "");
          if (previewText) session.preview = previewText.slice(0, 100);
        }

        // Add user message to session message store
        const userMsgId = `opencode-user-${turnId}`;
        const userContent: JsonValue[] = [];
        if (cleanPrompt) {
          userContent.push({ type: "text", text: cleanPrompt, text_elements: [] });
        }
        userContent.push(...attachmentBlocks);
        const userItem: Record<string, JsonValue> = {
          type: "userMessage",
          id: userMsgId,
          threadId,
          turnId,
          text: cleanPrompt,
          content: userContent,
          role: "user",
          status: "completed",
          startedAt: Math.floor(Date.now() / 1000),
          completedAt: Math.floor(Date.now() / 1000),
        };

        session.messages.push(userItem);

        // Emit turn/started and item/completed immediately for the user message
        this.emit("notification", {
          method: "turn/started",
          params: {
            threadId,
            turnId,
            engine: "opencode",
            turn: { id: turnId, threadId, status: "inProgress" },
          },
        });
        this.emit("notification", {
          method: "item/completed",
          params: { threadId, turnId, item: userItem },
        });

        // Resolve relay target first: provider/group/model -> loopback gateway.
        // Official opencode-local (or no resolver) keeps direct opencode auth.
        const relay = await this.resolveRelay(session.providerId, session.groupId, session.model);
        if (relay) {
          session.relay = relay;
        } else if (session.providerId && session.providerId !== OPENCODE_OFFICIAL_PROVIDER_ID) {
          // Relay requested but unresolvable: fail fast instead of silently
          // running on the wrong (opencode-direct) model.
          session.activeTurnId = undefined;
          const failed = session.turns.find((t) => t.id === turnId);
          if (failed) failed.status = "failed";
          this.persistSession(session);
          throw new Error(`OpenCode relay unavailable for provider=${session.providerId} group=${session.groupId ?? "v1"}`);
        } else {
          session.relay = undefined;
        }

        const isLoopbackRelay = session.providerId === "ultra-forward" || Boolean(relay && /127\.0\.0\.1|localhost/i.test(relay.baseURL) && relay.baseURL.includes("/v1"));
        if (isLoopbackRelay && session.model?.startsWith("opencode-")) {
          session.activeTurnId = undefined;
          const failed = session.turns.find((t) => t.id === turnId);
          if (failed) failed.status = "failed";
          this.persistSession(session);
          throw new Error(`回环拒绝: 当前已选用 OpenCode 作为执行后端，不能再通过本地转发 /v1 调用 OpenCode 自身模型 (${session.model})。请直接选用本地直连模型或切换其他 CLI 后端。`);
        }

        // Initialize or reuse runtime. All models run with their own prompt,
        // tools, MCP, and skills (no pass-through isolation).
        bootstrapProjectSaVmAssets(session.cwd, threadId);
        const saVmMcp = resolveOpencodeSaVmMcp(session.developerInstructions, session.cwd, session.model);
        if (!session.runtime) {
          const runtimeConfig: OpencodeRuntimeConfig = {
            threadId,
            cwd: session.cwd,
            sessionId: session.sessionId,
            model: session.model,
            dangerous: session.dangerous,
            relay: session.relay,
            saVmMcp,
            isolateThirdParty: false,
            apiVersion: this.apiVersion,
          };
          session.runtime = new OpencodeCompatibleRuntime(runtimeConfig);
          this.wireRuntimeEvents(session, session.runtime);
        } else {
          session.runtime.updateConfig({
            cwd: session.cwd,
            sessionId: session.sessionId,
            model: session.model,
            dangerous: session.dangerous,
            relay: session.relay,
            saVmMcp,
            isolateThirdParty: false,
            apiVersion: this.apiVersion,
          });
        }

        this.persistSession(session);

        // `/review` slash (mini parity): keep the raw text in the transcript
        // row, but send the expanded read-only review prompt to the model.
        const reviewMatch = OPENCODE_REVIEW_SLASH_RE.exec(cleanPrompt);
        const reviewExpanded = reviewMatch
          ? buildOpencodeReviewPrompt(parseOpencodeReviewTarget(reviewMatch[1] ?? ""))
          : cleanPrompt;
        const modelPrompt = buildOpencodeModelPrompt(session.developerInstructions, reviewExpanded, session.model);

        // Execute turn asynchronously in the background
        void session.runtime.executeTurn(modelPrompt, turnId, { fileParts: turnInput.fileParts }).catch((error) => {
          console.warn(`[opencodeBridge] executeTurn error:`, error);
          const turn = session.turns.find((entry) => entry.id === turnId);
          if (turn && (turn.status === "inProgress" || turn.status === "in_progress")) {
            const message = error instanceof Error ? error.message : String(error);
            turn.status = "failed";
            if (session.activeTurnId === turnId) session.activeTurnId = undefined;
            this.persistSession(session);
            this.emit("notification", {
              method: "turn/failed",
              params: {
                threadId,
                turnId,
                turn: { id: turnId, threadId, status: "failed", error: message },
                error: message,
              },
            });
          }
        });

        return {
          turn: {
            id: turnId,
            threadId,
            status: "inProgress",
          },
          turnId,
        };
      }

      case "turn/steer": {
        const threadId = String(record.threadId ?? "");
        let session = this.sessions.get(threadId);
        if (!session && this.options?.loadSnapshot) {
          const snapshot = this.options.loadSnapshot(threadId);
          if (snapshot) session = this.restoreSession(snapshot);
        }
        if (!session || !session.activeTurnId) {
          throw new Error("No active turn");
        }
        const expectedTurnId = typeof record.expectedTurnId === "string" ? record.expectedTurnId : undefined;
        if (expectedTurnId && expectedTurnId !== session.activeTurnId) {
          throw new Error(`Expected active turn id '${expectedTurnId}' but found '${session.activeTurnId}'`);
        }

        let userPrompt = "";
        const steerInput = await extractOpencodeTurnInput(record.input ?? record.prompt, record.prompt, session.cwd);
        for (const warning of steerInput.warnings) {
          console.warn(`[opencodeBridge] ${warning} (thread=${threadId})`);
        }
        userPrompt = steerInput.text;
        const attachmentBlocks = steerInput.attachmentBlocks;
        const cleanPrompt = userPrompt.trim();
        const turnId = session.activeTurnId;
        const userMsgId = `opencode-user-${turnId}-${randomUUID()}`;
        const userContent: JsonValue[] = [];
        if (cleanPrompt) {
          userContent.push({ type: "text", text: cleanPrompt, text_elements: [] });
        }
        userContent.push(...attachmentBlocks);
        const userItem: Record<string, JsonValue> = {
          type: "userMessage",
          id: userMsgId,
          threadId,
          turnId,
          text: cleanPrompt,
          content: userContent,
          role: "user",
          status: "completed",
          startedAt: Math.floor(Date.now() / 1000),
          completedAt: Math.floor(Date.now() / 1000),
        };

        session.messages.push(userItem);
        this.persistSession(session);

        this.emit("notification", {
          method: "item/completed",
          params: { threadId, turnId, item: userItem },
        });

        if ((cleanPrompt || steerInput.fileParts.length > 0) && session.runtime) {
          void session.runtime.prompt(cleanPrompt, { fileParts: steerInput.fileParts }).catch((error) => {
            console.warn(`[opencodeBridge] steer prompt error:`, error);
          });
        }

        return {
          turn: {
            id: turnId,
            threadId,
            status: "inProgress",
          },
          turnId,
        };
      }

      case "turn/interrupt": {
        const threadId = String(record.threadId ?? "");
        const session = this.sessions.get(threadId);
        if (session && session.runtime) {
          await session.runtime.interruptTurn();
        }
        return { success: true };
      }

      case "review/start": {
        // Mini parity: run a read-only review turn on an existing session by
        // delegating to turn/start with a synthesized `/review` slash.
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" && record.ownerId.trim() ? record.ownerId.trim() : undefined;
        const session = this.resolveSession(threadId, ownerId)
          ?? this.materializeNativeSession(threadId, ownerId);
        if (!session) {
          throw new Error(`OpenCode session not found for thread ${threadId}`);
        }
        const target = parseOpencodeReviewTarget(
          record.target ?? record.value ?? "",
        );
        return this.request("turn/start", {
          ...record,
          threadId,
          prompt: formatOpencodeReviewSlash(target),
        });
      }

      case "thread/read": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" && record.ownerId.trim() ? record.ownerId.trim() : undefined;
        const includeTurns = record.includeTurns !== false;
        if (!includeTurns && !this.sessions.get(threadId) && this.options?.loadMetadata) {
          // Metadata-only history open (sidebar restore, 18% stage): serve
          // from light columns without parsing the full `state_json`
          // snapshot, so giant tool-output histories can't stall the
          // metadata RPC into the 8s client timeout / 35s failsafe.
          // Miss falls through to the snapshot/native path below.
          const metadata = this.options.loadMetadata(threadId, ownerId);
          if (metadata) {
            return {
              thread: {
                id: threadId,
                sessionId: metadata.sessionId ?? threadId,
                model: metadata.model,
                cliBackend: this.backendId,
                historyMode: "paginated",
                status: { type: "idle" },
                cwd: metadata.cwd ?? process.cwd(),
                turns: [],
              },
              items: [],
            } as unknown as JsonValue;
          }
        }
        const session = this.resolveSession(threadId, ownerId);
        if (!session) {
          // Native `ses_*` histories load through the bounded read-only
          // projection (no runtime, no subscription, no snapshot write).
          const native = this.readNativeThread(threadId, includeTurns);
          if (native) return native;
          return {
            thread: {
              id: threadId,
              cliBackend: this.backendId,
              cwd: process.cwd(),
              additionalRoots: [],
              status: { type: "idle" },
              turns: [],
            },
            items: [],
          } as unknown as JsonValue;
        }
        return {
          thread: {
            id: threadId,
            sessionId: session.sessionId ?? threadId,
            name: session.name ?? null,
            title: session.name ?? null,
            parentThreadId: session.parentThreadId ?? null,
            agentRole: session.agentType ?? null,
            agentNickname: session.taskName ?? null,
            additionalRoots: session.additionalRoots ?? [],
            providerId: session.providerId ?? null,
            groupId: session.groupId ?? null,
            preview: session.name ?? session.preview,
            model: session.model,
            cliBackend: this.backendId,
            status: { type: session.activeTurnId ? "running" : "idle" },
            cwd: session.cwd,
            turns: includeTurns ? session.turns.map((t) => ({
              id: t.id,
              threadId,
              status: t.status === "in_progress" || t.status === "inProgress"
                ? (session.activeTurnId === t.id ? "inProgress" : "interrupted")
                : t.status,
              startedAt: Math.floor(t.createdAt / 1000),
              items: session.messages.filter((m: any) => m && m.turnId === t.id),
            })) : [],
            messages: includeTurns ? session.messages : [],
          },
          items: includeTurns ? session.messages : [],
        } as unknown as JsonValue;
      }

      case "thread/resume": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" && record.ownerId.trim() ? record.ownerId.trim() : undefined;
        let session = this.resolveSession(threadId, ownerId);
        if (!session) {
          // Explicit resume materializes a native history into a live session
          // so follow-up turns can run; plain thread/read stays read-only.
          session = this.materializeNativeSession(threadId, ownerId) ?? undefined;
        }
        const includeTurns = record.includeTurns !== false;
        if (!session) {
          return {
            thread: {
              id: threadId,
              cliBackend: this.backendId,
              cwd: process.cwd(),
              additionalRoots: [],
              status: { type: "idle" },
              turns: [],
            },
            items: [],
          } as unknown as JsonValue;
        }
        return {
          thread: {
            id: threadId,
            sessionId: session.sessionId ?? threadId,
            name: session.name ?? null,
            title: session.name ?? null,
            parentThreadId: session.parentThreadId ?? null,
            agentRole: session.agentType ?? null,
            agentNickname: session.taskName ?? null,
            additionalRoots: session.additionalRoots ?? [],
            providerId: session.providerId ?? null,
            groupId: session.groupId ?? null,
            preview: session.name ?? session.preview,
            model: session.model,
            cliBackend: this.backendId,
            status: { type: session.activeTurnId ? "running" : "idle" },
            cwd: session.cwd,
            turns: includeTurns ? session.turns.map((t) => ({
              id: t.id,
              threadId,
              status: t.status === "in_progress" || t.status === "inProgress"
                ? (session.activeTurnId === t.id ? "inProgress" : "interrupted")
                : t.status,
              startedAt: Math.floor(t.createdAt / 1000),
              items: session.messages.filter((m: any) => m && m.turnId === t.id),
            })) : [],
            messages: session.messages,
          },
          items: session.messages,
        } as unknown as JsonValue;
      }

      case "thread/turns/list": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" && record.ownerId.trim() ? record.ownerId.trim() : undefined;
        const session = this.resolveSession(threadId, ownerId);
        if (!session) {
          const nativePage = isNativeOpencodeSessionId(threadId)
            ? listNativeOpencodeTurns(threadId, {
              limit: typeof record.limit === "number" ? record.limit : 32,
              cursor: typeof record.cursor === "string" ? record.cursor : null,
              sortDirection: typeof record.sortDirection === "string" ? record.sortDirection : "desc",
              itemsView: typeof record.itemsView === "string" ? record.itemsView : "summary",
            })
            : null;
          if (nativePage) return nativePage as unknown as JsonValue;
          return { turns: [], data: [], nextCursor: null } as unknown as JsonValue;
        }
        const limit = Math.max(1, Math.min(100, typeof record.limit === "number" ? record.limit : 32));
        const cursor = typeof record.cursor === "string" && record.cursor ? record.cursor : null;
        const desc = (typeof record.sortDirection === "string" ? record.sortDirection : "desc").toLowerCase() !== "asc";
        const summarize = (typeof record.itemsView === "string" ? record.itemsView : "summary").toLowerCase() !== "full";
        // Single-pass index: the old code filtered the whole message list per
        // turn (O(T*M)) and ignored limit/cursor/itemsView, so opening a long
        // live session serialized its entire transcript.
        const byTurn = new Map<string, any[]>();
        for (const m of session?.messages ?? []) {
          const tid = (m as any)?.turnId;
          if (typeof tid !== "string" || !tid) continue;
          const arr = byTurn.get(tid);
          if (arr) arr.push(m);
          else byTurn.set(tid, [m]);
        }
        const ordered = [...(session?.turns ?? [])].sort((a, b) => {
          const ta = typeof a.createdAt === "number" ? a.createdAt : 0;
          const tb = typeof b.createdAt === "number" ? b.createdAt : 0;
          if (ta !== tb) return desc ? tb - ta : ta - tb;
          return desc ? (a.id < b.id ? 1 : -1) : (a.id < b.id ? -1 : 1);
        });
        const start = cursor ? ordered.findIndex((t) => t.id === cursor) + 1 : 0;
        const window = ordered.slice(start < 0 ? 0 : start, (start < 0 ? 0 : start) + limit + 1);
        const page = window.slice(0, limit);
        const nextCursor = window.length > page.length ? page[page.length - 1]?.id ?? null : null;
        const turns = page.map((t) => {
          const items = byTurn.get(t.id) ?? [];
          let outItems: any[] = items;
          let itemsView: string | undefined;
          if (summarize) {
            const user = items.find((item) => (item as any)?.type === "userMessage");
            const assistant = [...items].reverse().find((item) => (item as any)?.type === "agentMessage");
            outItems = user && assistant && user !== assistant ? [user, assistant] : user ? [user] : assistant ? [assistant] : [];
            itemsView = "summary";
          }
          return {
            id: t.id,
            threadId,
            status: t.status === "in_progress" || t.status === "inProgress"
              ? (session?.activeTurnId === t.id ? "inProgress" : "interrupted")
              : t.status,
            startedAt: Math.floor(t.createdAt / 1000),
            items: outItems,
            ...(itemsView ? { itemsView } : {}),
          };
        });
        return {
          turns,
          data: turns,
          nextCursor,
        } as unknown as JsonValue;
      }

      case "thread/compact/start": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" && record.ownerId.trim() ? record.ownerId.trim() : undefined;
        let session = this.resolveSession(threadId, ownerId);
        if (!session) {
          session = this.materializeNativeSession(threadId, ownerId) ?? undefined;
        }
        if (!session) {
          throw new Error("Unknown thread: " + threadId);
        }
        if (session.activeTurnId) {
          throw new Error("Cannot compact while an opencode turn is running");
        }

        const turnId = randomUUID();
        session.turns.push({ id: turnId, status: "inProgress", createdAt: Date.now() });
        session.activeTurnId = turnId;

        const compactionItem: Record<string, JsonValue> = {
          type: "contextCompaction",
          id: `opencode-compact-${turnId}`,
          threadId,
          turnId,
          title: "Context compaction",
          status: "inProgress",
          cliBackend: this.backendId,
        };
        session.messages.push(compactionItem);
        this.persistSession(session);

        this.emit("notification", {
          method: "turn/started",
          params: {
            threadId,
            turnId,
            engine: "opencode",
            turn: { id: turnId, threadId, status: "inProgress" },
          },
        });
        this.emit("notification", {
          method: "item/started",
          params: { threadId, turnId, item: compactionItem },
        });

        void this.runCompaction(session, turnId, record);

        return {
          turn: {
            id: turnId,
            threadId,
            status: "inProgress",
          },
          turnId,
        };
      }

      case "thread/history/fileInfo": {
        const threadId = String(record.threadId ?? "");
        if (isNativeOpencodeSessionId(threadId)) {
          const info = nativeOpencodeFileInfo(threadId);
          if (info) return info as unknown as JsonValue;
        }
        return { exists: false } as unknown as JsonValue;
      }

      case "thread/history/tail": {
        const threadId = String(record.threadId ?? "");
        if (isNativeOpencodeSessionId(threadId)) {
          const tail = readNativeOpencodeTail(threadId, {
            maxMessages: typeof record.maxMessages === "number" ? record.maxMessages : undefined,
          });
          if (tail) return tail as unknown as JsonValue;
        }
        // Internal sessions keep the previous behavior: the bounded
        // in-memory read (index.ts used to translate tail -> thread/read).
        const ownerId = typeof record.ownerId === "string" && record.ownerId.trim() ? record.ownerId.trim() : undefined;
        const session = this.resolveSession(threadId, ownerId);
        if (!session) {
          const native = this.readNativeThread(threadId, true);
          if (native) return native;
          throw new Error(`OpenCode session not found for thread ${threadId}`);
        }
        return {
          thread: {
            id: threadId,
            sessionId: session.sessionId ?? threadId,
            preview: session.preview,
            model: session.model,
            cliBackend: this.backendId,
            status: { type: session.activeTurnId ? "running" : "idle" },
            cwd: session.cwd,
            turns: session.turns.map((t) => ({
              id: t.id,
              threadId,
              status: t.status,
              startedAt: Math.floor(t.createdAt / 1000),
              items: session.messages.filter((m: any) => m && m.turnId === t.id),
            })),
            messages: session.messages,
          },
          items: session.messages,
          tail: { truncated: false, backend: "opencode-memory" },
        } as unknown as JsonValue;
      }

      default:
        return {};
    }
    } finally {
      if (instrumentRead) {
        const elapsedMs = Date.now() - readStartedAt;
        if (elapsedMs > 3000) {
          try {
            const slowThreadId = String((record as Record<string, unknown>)?.threadId ?? "");
            console.warn(`[opencodeBridge] slow ${method} thread=${slowThreadId.slice(0, 24)}... ${elapsedMs}ms`);
          } catch {
            // ignore logging failures
          }
        }
      }
    }
  }
}
