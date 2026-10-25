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
} from "@codex-ui/shared";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import { GrokCompatibleRuntime } from "./grokCompatibleRuntime.js";
import { probeGrokCliCommand, findGrokBin } from "./grokCompatibleProbe.js";
import { GrokProxyServer, type GrokProxyConfig } from "./grokCompatibleProxy.js";
import { bootstrapProjectSaVmAssets } from "@cxu/sdk-backend";
import { pageThreadHistory } from "@cxu/sdk-backend";

export const GROK_OFFICIAL_PROVIDER_ID = "grok-official";

export function buildGrokOfficialProvider(): ProviderConfig {
  const models = ["grok-4.6"];
  const group: ChannelGroupConfig = {
    id: "default",
    name: "default",
    baseUrl: "https://cli-chat-proxy.grok.com/v1",
    kind: "text",
    status: "enabled",
    groupRatio: 1,
    models,
    responseProtocol: "openai-response",
    responseProtocolMode: "fixed",
    remark: "Grok 官方直连 (grok.com OAuth)",
    authType: "none",
    credentialMode: "group",
    keyMode: "single",
    keys: []
  };
  return {
    id: GROK_OFFICIAL_PROVIDER_ID,
    name: "Grok 官方",
    kind: "responsesRelay",
    serviceProvider: { id: "xai-grok", name: "xAI Grok" },
    baseUrl: "https://cli-chat-proxy.grok.com/v1",
    defaultModel: "grok-4.6",
    nativeModels: models,
    modelAliases: [],
    stationType: "official",
    channelMode: "fast",
    remark: "Grok Official (grok.com OAuth)",
    groups: [group],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export interface GrokSessionSnapshot {
  threadId: string;
  ownerId?: string;
  sessionId?: string;
  preview?: string;
  model?: string;
  effort?: string;
  developerInstructions?: string;
  cwd?: string;
  mode?: "acceptEdits" | "plan";
  goalObjective?: string | null;
  goalStatus?: string | null;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
}

export interface GrokBridgeOptions {
  resolveRelayEnv?: (providerId: string, groupId?: string, model?: string) => Promise<Record<string, string> | undefined>;
  resolveRelayProxyConfig?: (providerId: string, groupId?: string, model?: string) => Promise<GrokProxyConfig | undefined>;
  onSnapshot?: (snapshot: GrokSessionSnapshot) => void;
  loadSnapshot?: (threadId: string, ownerId?: string) => GrokSessionSnapshot | null;
  loadMetadata?: (threadId: string, ownerId?: string) => Partial<GrokSessionSnapshot> | null;
}

interface GrokSession {
  threadId: string;
  ownerId?: string;
  cwd: string;
  model?: string;
  effort?: string;
  developerInstructions?: string;
  mode?: "acceptEdits" | "plan";
  sessionId?: string;
  providerId?: string;
  groupId?: string;
  preview?: string;
  goalObjective?: string | null;
  goalStatus?: string | null;
  activeTurnId?: string;
  proxyServer?: GrokProxyServer;
  runtime?: GrokCompatibleRuntime;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
}

export class GrokBridge extends EventEmitter implements CodexRuntimeClient {
  private options?: GrokBridgeOptions;
  private sessions = new Map<string, GrokSession>();
  private status: EngineStatus = {
    phase: "ready",
    transport: "stdio",
    message: "Grok CLI ready",
  };

  constructor(options?: GrokBridgeOptions) {
    super();
    this.options = options;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  async start(): Promise<EngineStatus> {
    const probe = probeGrokCliCommand(findGrokBin());
    if (!probe.available) {
      this.status = {
        phase: "error",
        transport: "stdio",
        message: probe.error ?? "Grok CLI not found",
      };
    } else {
      this.status = {
        phase: "ready",
        transport: "stdio",
        message: `Grok CLI v${probe.version ?? "unknown"} ready`,
      };
    }
    return this.status;
  }

  stop(): void {
    for (const session of this.sessions.values()) {
      session.runtime?.interrupt();
      if (session.proxyServer) {
        session.proxyServer.stop().catch(() => {});
        session.proxyServer = undefined;
      }
    }
    this.sessions.clear();
    this.status = {
      phase: "stopped",
      transport: "stdio",
      message: "Grok CLI stopped",
    };
  }

  async restart(): Promise<EngineStatus> {
    this.stop();
    return this.start();
  }

  async notify(_method: string, _params?: JsonValue): Promise<void> {}

  respond(_id: JsonRpcId, _result?: JsonValue, _error?: JsonRpcFailure["error"]): void {}

  hasSession(threadId: string): boolean {
    return this.sessions.has(threadId);
  }

  deleteSession(threadId: string): void {
    const session = this.sessions.get(threadId);
    if (session) {
      session.runtime?.interrupt();
      if (session.proxyServer) {
        session.proxyServer.stop().catch(() => {});
        session.proxyServer = undefined;
      }
      this.sessions.delete(threadId);
    }
  }

  restoreSession(snapshot: GrokSessionSnapshot): GrokSession {
    const existing = this.sessions.get(snapshot.threadId);
    if (existing) {
      if (snapshot.sessionId) existing.sessionId = snapshot.sessionId;
      if (snapshot.preview) existing.preview = snapshot.preview;
      if (snapshot.turns) existing.turns = snapshot.turns;
      if (snapshot.messages) existing.messages = snapshot.messages;
      return existing;
    }
    const session: GrokSession = {
      threadId: snapshot.threadId,
      ownerId: snapshot.ownerId,
      sessionId: snapshot.sessionId,
      preview: snapshot.preview,
      model: snapshot.model,
      effort: snapshot.effort,
      developerInstructions: snapshot.developerInstructions,
      cwd: snapshot.cwd ?? process.cwd(),
      mode: snapshot.mode,
      goalObjective: snapshot.goalObjective,
      goalStatus: snapshot.goalStatus,
      turns: snapshot.turns ?? [],
      messages: snapshot.messages ?? [],
    };
    this.sessions.set(session.threadId, session);
    return session;
  }

  private getOrRestoreSession(threadId: string, ownerId?: string): GrokSession | undefined {
    let session = this.sessions.get(threadId);
    if (!session && this.options?.loadSnapshot) {
      const snap = this.options.loadSnapshot(threadId, ownerId);
      if (snap) {
        session = this.restoreSession(snap);
      }
    }
    return session;
  }

  private persistSession(session: GrokSession): void {
    if (this.options?.onSnapshot) {
      this.options.onSnapshot({
        threadId: session.threadId,
        ownerId: session.ownerId,
        sessionId: session.sessionId,
        preview: session.preview,
        model: session.model,
        effort: session.effort,
        developerInstructions: session.developerInstructions,
        cwd: session.cwd,
        mode: session.mode,
        goalObjective: session.goalObjective,
        goalStatus: session.goalStatus,
        turns: session.turns,
        messages: session.messages,
      });
    }
  }

  private wireRuntimeEvents(session: GrokSession, runtime: GrokCompatibleRuntime): void {
    runtime.on("sessionId", (sessionId: string) => {
      session.sessionId = sessionId;
      this.persistSession(session);
    });

    runtime.on("notification", (notif: JsonRpcNotification) => {
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
        session.activeTurnId = undefined;
        this.persistSession(session);
      } else if (notif.method === "turn/failed" || notif.method === "turn/interrupted") {
        const turnId = (notif.params as any)?.turnId;
        const t = session.turns.find((entry) => entry.id === turnId);
        if (t) t.status = notif.method === "turn/failed" ? "failed" : "interrupted";
        session.activeTurnId = undefined;
        this.persistSession(session);
      } else if (notif.method === "grok/init") {
        const sid = (notif.params as any)?.sessionId;
        if (sid) {
          session.sessionId = sid;
          this.persistSession(session);
        }
      }
      this.emit("notification", notif);
    });
  }

  private async configureSessionProxy(
    session: GrokSession,
    providerId?: string,
    groupId?: string,
    model?: string
  ): Promise<Record<string, string> | undefined> {
    if (!providerId || providerId === GROK_OFFICIAL_PROVIDER_ID) {
      if (session.proxyServer) {
        await session.proxyServer.stop().catch(() => {});
        session.proxyServer = undefined;
      }
      return undefined;
    }

    if (this.options?.resolveRelayProxyConfig) {
      const proxyConfig = await this.options.resolveRelayProxyConfig(providerId, groupId, model);
      if (proxyConfig) {
        // Bind the owning conversation so upstream fetches carry a
        // thread-stable x-opencode-session (OpenCode Go compliance).
        proxyConfig.threadId = session.threadId;
        if (!session.proxyServer) {
          session.proxyServer = new GrokProxyServer(proxyConfig);
          const proxyUrl = await session.proxyServer.start();
          const apiKey = proxyConfig.apiKeys[0] || "dummy-key";
          return {
            GROK_CLI_CHAT_PROXY_BASE_URL: `${proxyUrl}/v1`,
            GROK_XAI_API_BASE_URL: `${proxyUrl}/v1`,
            XAI_API_KEY: apiKey,
          };
        } else {
          session.proxyServer.updateConfig(proxyConfig);
          const apiKey = proxyConfig.apiKeys[0] || "dummy-key";
          return {
            GROK_CLI_CHAT_PROXY_BASE_URL: `${session.proxyServer.url}/v1`,
            GROK_XAI_API_BASE_URL: `${session.proxyServer.url}/v1`,
            XAI_API_KEY: apiKey,
          };
        }
      }
    }

    if (this.options?.resolveRelayEnv) {
      return this.options.resolveRelayEnv(providerId, groupId, model);
    }

    return undefined;
  }

  async request(method: string, params?: JsonValue, _timeoutMs?: number): Promise<JsonValue> {
    const record = (params && typeof params === "object" && !Array.isArray(params) ? params : {}) as Record<string, any>;

    switch (method) {
      case "thread/start": {
        const threadId = randomUUID();
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : process.cwd();
        const isPlan = record.sandbox === "read-only"
          || record.mode === "plan"
          || record.collaborationMode === "plan"
          || (typeof record.collaborationMode === "object" && (record.collaborationMode?.mode === "plan" || record.collaborationMode?.settings?.mode === "plan"))
          || record.planModeEnabled === true;
        const session: GrokSession = {
          threadId,
          ownerId,
          cwd,
          model: typeof record.model === "string" ? record.model : "grok-4.6",
          effort: typeof record.reasoningEffort === "string" ? record.reasoningEffort : (typeof record.effort === "string" ? record.effort : undefined),
          mode: isPlan ? "plan" : "acceptEdits",
          providerId: typeof record.providerId === "string" ? record.providerId : GROK_OFFICIAL_PROVIDER_ID,
          groupId: typeof record.groupId === "string" ? record.groupId : "default",
          turns: [],
          messages: [],
        };
        this.sessions.set(threadId, session);
        this.persistSession(session);
        // 新机器自举：按工程目录落盘 MCP + 7 方 skill（含 jev）。
        bootstrapProjectSaVmAssets(cwd, threadId);
        return {
          thread: {
            id: threadId,
            cliBackend: "grok",
            cwd,
            model: session.model ?? null,
            status: "active",
            createdAt: Date.now(),
          },
          threadId,
        } as unknown as JsonValue;
      }

      case "thread/read":
      case "thread/resume": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const includeTurns = record.includeTurns !== false;
        const liveSession = this.sessions.get(threadId);
        if (!includeTurns && !liveSession && this.options?.loadMetadata) {
          const metadata = this.options.loadMetadata(threadId, ownerId);
          if (!metadata) return { thread: { id: threadId, cliBackend: "grok", status: { type: "idle" }, turns: [] }, items: [] } as unknown as JsonValue;
          return { thread: { ...metadata, id: threadId, cliBackend: "grok", historyMode: "paginated", status: { type: "idle" }, turns: [] }, items: [] } as unknown as JsonValue;
        }
        const session = liveSession ?? this.getOrRestoreSession(threadId, ownerId);
        if (!session) {
          return {
            thread: {
              id: threadId,
              cliBackend: "grok",
              cwd: process.cwd(),
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
            preview: session.preview,
            model: session.model,
            cliBackend: "grok",
            historyMode: "paginated",
            status: { type: session.activeTurnId ? "running" : "idle" },
            cwd: session.cwd,
            turns: includeTurns ? session.turns.map((t) => ({
              id: t.id,
              threadId,
              status: t.status === "in_progress" ? (session.activeTurnId === t.id ? "inProgress" : "interrupted") : t.status,
              startedAt: Math.floor(t.createdAt / 1000),
              items: session.messages.filter((m: any) => m && m.turnId === t.id),
            })) : [],
          },
          items: includeTurns ? session.messages : [],
        } as unknown as JsonValue;
      }

      case "thread/turns/list": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const session = this.getOrRestoreSession(threadId, ownerId);
        if (!session) return { turns: [], data: [], nextCursor: null } as unknown as JsonValue;
        return pageThreadHistory(threadId, session.turns, session.messages, {
          cursor: typeof record.cursor === "string" ? record.cursor : null,
          limit: typeof record.limit === "number" ? record.limit : 32,
          sortDirection: typeof record.sortDirection === "string" ? record.sortDirection : "desc",
        }) as unknown as JsonValue;
      }

      case "thread/list": {
        const list = Array.from(this.sessions.values()).map((s) => ({
          id: s.threadId,
          cwd: s.cwd,
          model: s.model,
          preview: s.preview,
          createdAt: s.turns[0]?.createdAt ?? Date.now(),
        }));
        return { threads: list } as unknown as JsonValue;
      }

      case "thread/delete": {
        const threadId = String(record.threadId ?? "");
        this.deleteSession(threadId);
        return { ok: true } as unknown as JsonValue;
      }

      case "turn/start": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        let session = this.getOrRestoreSession(threadId, ownerId);
        if (session && ownerId && session.ownerId && session.ownerId !== "local" && session.ownerId !== ownerId) {
          throw new Error(`Grok session belongs to another owner: ${threadId}`);
        }
        const storedMeta = !session ? this.options?.loadMetadata?.(threadId, ownerId) : null;
        if (storedMeta?.ownerId && storedMeta.ownerId !== "local" && ownerId && storedMeta.ownerId !== ownerId) {
          throw new Error(`Grok session belongs to another owner: ${threadId}`);
        }
        const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : (session?.cwd ?? (storedMeta as any)?.cwd ?? process.cwd());
        const providerId = typeof record.providerId === "string" ? record.providerId : (session?.providerId ?? (storedMeta as any)?.providerId);
        const groupId = typeof record.groupId === "string" ? record.groupId : (session?.groupId ?? (storedMeta as any)?.groupId);
        const model = typeof record.model === "string" ? record.model : (session?.model ?? (storedMeta as any)?.model ?? "grok-4.6");
        const effort = typeof record.reasoningEffort === "string" ? record.reasoningEffort : (typeof record.effort === "string" ? record.effort : (session?.effort ?? "medium"));
        const isPlan = record.sandbox === "read-only"
          || record.mode === "plan"
          || record.collaborationMode === "plan"
          || (typeof record.collaborationMode === "object" && (record.collaborationMode?.mode === "plan" || record.collaborationMode?.settings?.mode === "plan"))
          || record.planModeEnabled === true;
        const mode = isPlan ? "plan" : (session?.mode ?? "acceptEdits");

        const rawDevInstructions = typeof record.developerInstructions === "string" && record.developerInstructions.trim()
          ? record.developerInstructions.trim()
          : undefined;
        const developerInstructions = rawDevInstructions ?? session?.developerInstructions;

        if (!session) {
          session = {
            threadId,
            ownerId,
            cwd,
            model,
            effort,
            mode,
            developerInstructions,
            providerId,
            groupId,
            turns: [],
            messages: [],
          };
          this.sessions.set(threadId, session);
        } else {
          if (ownerId) session.ownerId = ownerId;
          session.providerId = providerId;
          session.groupId = groupId;
          if (model) session.model = model;
          if (effort) session.effort = effort;
          if (developerInstructions) session.developerInstructions = developerInstructions;
          session.mode = mode;
          if (cwd) session.cwd = cwd;
        }

        const envOverrides = await this.configureSessionProxy(session, providerId, groupId, model);

        if (!session.runtime) {
          const runtime = new GrokCompatibleRuntime({
            threadId,
            cwd: session.cwd,
            sessionId: session.sessionId,
            model: session.model,
            effort: session.effort,
            mode: session.mode,
            providerId: session.providerId,
            groupId: session.groupId,
            envOverrides,
          });
          this.wireRuntimeEvents(session, runtime);
          session.runtime = runtime;
        } else {
          session.runtime.updateConfig({
            cwd: session.cwd,
            sessionId: session.sessionId,
            model: session.model,
            effort: session.effort,
            mode: session.mode,
            providerId: session.providerId,
            groupId: session.groupId,
            envOverrides: envOverrides ?? {},
          });
        }

        const turnId = randomUUID();
        let promptText = "";
        const attachmentBlocks: JsonValue[] = [];
        if (Array.isArray(record.input)) {
          for (const item of record.input) {
            if (item && item.type === "text" && typeof item.text === "string") {
              promptText += item.text + "\n";
            } else if (item) {
              attachmentBlocks.push(item);
            }
          }
        } else if (typeof record.prompt === "string") {
          promptText = record.prompt;
        }

        const cleanPrompt = promptText.trim();
        const executionPrompt = developerInstructions
          ? `${developerInstructions}\n\n[User Instruction]\n${cleanPrompt}`
          : cleanPrompt;
        const userContent: JsonValue[] = [];
        if (cleanPrompt) {
          userContent.push({ type: "text", text: cleanPrompt, text_elements: [] });
        }
        userContent.push(...attachmentBlocks);

        const userItem: Record<string, JsonValue> = {
          type: "userMessage",
          id: `grok-user-${turnId}`,
          turnId,
          threadId,
          text: cleanPrompt,
          content: userContent,
          role: "user",
          status: "completed",
          startedAt: Math.floor(Date.now() / 1000),
        };

        session.messages.push(userItem);
        session.turns.push({ id: turnId, status: "inProgress", createdAt: Date.now() });
        session.activeTurnId = turnId;
        if (!session.preview) {
          session.preview = cleanPrompt.slice(0, 80);
        }
        this.persistSession(session);

        this.emit("notification", {
          method: "turn/started",
          params: {
            threadId,
            turnId,
            turn: { id: turnId, threadId, status: "inProgress" },
          },
        });
        this.emit("notification", {
          method: "item/completed",
          params: { threadId, turnId, item: userItem },
        });

        // Run turn in background
        void session.runtime.executeTurn(executionPrompt, turnId).catch((err) => {
          const errorMsg = String(err?.message || err);
          const errItem: Record<string, JsonValue> = {
            type: "agentMessage",
            id: `grok-err-${turnId}`,
            turnId,
            threadId,
            role: "assistant",
            status: "failed",
            text: errorMsg,
            content: [{ type: "text", text: errorMsg }],
            error: errorMsg,
            completedAt: Math.floor(Date.now() / 1000),
          };
          session.messages.push(errItem);
          this.emit("notification", {
            method: "item/completed",
            params: { threadId, turnId, item: errItem },
          });
          this.emit("notification", {
            method: "turn/failed",
            params: { threadId, turnId, turn: { id: turnId, threadId, status: "failed", error: errorMsg }, error: errorMsg },
          });
        });

        return { turn: { id: turnId, threadId, status: "inProgress" }, turnId } as unknown as JsonValue;
      }

      case "turn/interrupt": {
        const threadId = String(record.threadId ?? "");
        const session = this.sessions.get(threadId);
        if (session) {
          session.runtime?.interrupt();
        }
        return { ok: true } as unknown as JsonValue;
      }

      case "thread/compact/start": {
        const threadId = String(record.threadId ?? "");
        const session = this.sessions.get(threadId);
        if (session) {
          const turnId = randomUUID();
          this.emit("notification", {
            method: "turn/started",
            params: { threadId, turnId, turn: { id: turnId, threadId, status: "inProgress" } },
          });
          const compactionItem: Record<string, JsonValue> = {
            type: "compaction",
            id: `grok-compact-${turnId}`,
            turnId,
            threadId,
            status: "completed",
          };
          this.emit("notification", {
            method: "item/completed",
            params: { threadId, turnId, item: compactionItem },
          });
          this.emit("notification", {
            method: "turn/completed",
            params: { threadId, turnId, turn: { id: turnId, threadId, status: "completed" } },
          });
          return { turn: { id: turnId, threadId, status: "completed" } } as unknown as JsonValue;
        }
        return { success: false } as unknown as JsonValue;
      }

      case "thread/goal/set": {
        const threadId = String(record.threadId ?? "");
        const session = this.sessions.get(threadId);
        if (session) {
          session.goalObjective = typeof record.objective === "string" ? record.objective : null;
          session.goalStatus = typeof record.status === "string" ? record.status : "active";
          this.persistSession(session);
          return { ok: true } as unknown as JsonValue;
        }
        return { ok: false } as unknown as JsonValue;
      }

      case "thread/goal/get": {
        const threadId = String(record.threadId ?? "");
        const session = this.sessions.get(threadId);
        return {
          goal: session ? {
            objective: session.goalObjective ?? null,
            status: session.goalStatus ?? null,
          } : null,
        } as unknown as JsonValue;
      }

      default:
        return {} as unknown as JsonValue;
    }
  }
}
