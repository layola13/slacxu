import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  EngineStatus,
  JsonRpcFailure,
  JsonRpcId,
  JsonValue,
  JsonRpcNotification,
  JsonRpcRequest,
  ChannelGroupConfig,
  ProviderConfig,
} from "@codex-ui/shared";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import { AgyCompatibleRuntime } from "./agyCompatibleRuntime.js";
import { probeAgyCliCommand, findAgyBin, isAgyLaunchConfigured } from "./agyCompatibleProbe.js";
import { AgyProxyServer, type AgyProxyConfig } from "./agyCompatibleProxy.js";
import { bootstrapProjectSaVmAssets } from "@cxu/sdk-backend";
import { pageThreadHistory } from "@cxu/sdk-backend";

export const AGY_OFFICIAL_PROVIDER_ID = "agy-official";

export const AGY_OFFICIAL_MODELS = [
  "gemini-3.8-flash-high",
  "gemini-3.8-flash-medium",
  "gemini-3.8-flash-low",
  "gemini-3.8-pro-high",
  "gemini-3.8-pro-low",
  "gemini-3.7-flash-high",
  "gemini-3.7-flash-medium",
  "gemini-3.7-flash-low",
  "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium",
  "gemini-3.6-flash-low",
  "gemini-3.1-pro-high",
  "gemini-3.1-pro-low",
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
] as const;

export function isAgyOfficialModel(model?: string | null): boolean {
  if (!model) return false;
  return AGY_OFFICIAL_MODELS.includes(model as any);
}

function formatProxyHost(url?: string): string {
  if (!url) return "none";
  try {
    const parsed = new URL(url);
    return parsed.host || "unknown";
  } catch {
    return "configured";
  }
}

export function buildAgyOfficialProvider(): ProviderConfig {
  const models = [...AGY_OFFICIAL_MODELS];
  const group: ChannelGroupConfig = {
    id: "default",
    name: "default",
    baseUrl: "https://cloudcode-pa.googleapis.com",
    kind: "text",
    status: "enabled",
    groupRatio: 1,
    models,
    responseProtocol: "gemini",
    responseProtocolMode: "fixed",
    remark: "Antigravity 官方直连 (Google OAuth)",
    authType: "none",
    credentialMode: "group",
    keyMode: "single",
    keys: []
  };
  return {
    id: AGY_OFFICIAL_PROVIDER_ID,
    name: "Antigravity 官方",
    kind: "responsesRelay",
    serviceProvider: { id: "google-antigravity", name: "Google Antigravity" },
    baseUrl: "https://cloudcode-pa.googleapis.com",
    defaultModel: "gemini-3.8-flash-high",
    nativeModels: models,
    modelAliases: [],
    stationType: "official",
    channelMode: "fast",
    remark: "Antigravity Official (Google OAuth)",
    groups: [group],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export interface AgySessionSnapshot {
  threadId: string;
  ownerId?: string;
  conversationId?: string;
  preview?: string;
  model?: string;
  effort?: string;
  developerInstructions?: string;
  cwd?: string;
  addDirs?: string[];
  mode?: "accept-edits" | "plan";
  goalObjective?: string | null;
  goalStatus?: string | null;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
  providerId?: string;
  groupId?: string;
}

export interface AgyBridgeOptions {
  resolveRelayEnv?: (providerId: string, groupId?: string, model?: string) => Promise<Record<string, string> | undefined>;
  resolveRelayProxyConfig?: (providerId: string, groupId?: string, model?: string) => Promise<AgyProxyConfig | undefined>;
  onSnapshot?: (snapshot: AgySessionSnapshot) => void;
  loadSnapshot?: (threadId: string, ownerId?: string) => AgySessionSnapshot | null;
  loadMetadata?: (threadId: string, ownerId?: string) => Partial<AgySessionSnapshot> | null;
}

interface AgySession {
  threadId: string;
  ownerId?: string;
  cwd: string;
  addDirs?: string[];
  model?: string;
  effort?: string;
  developerInstructions?: string;
  mode?: "accept-edits" | "plan";
  conversationId?: string;
  providerId?: string;
  groupId?: string;
  preview?: string;
  goalObjective?: string | null;
  goalStatus?: string | null;
  activeTurnId?: string;
  pendingTurnTimer?: ReturnType<typeof setTimeout>;
  proxyServer?: AgyProxyServer;
  runtime?: AgyCompatibleRuntime;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
}

export function resolveAgyWorkspaceDirs(record: Record<string, any>): { cwd: string; addDirs: string[] } {
  const roots: string[] = [];
  if (Array.isArray(record.runtimeWorkspaceRoots)) {
    for (const r of record.runtimeWorkspaceRoots) {
      if (typeof r === "string" && r.trim()) roots.push(r.trim());
    }
  }
  if (typeof record.workspace?.cwd === "string" && record.workspace.cwd.trim()) {
    roots.push(record.workspace.cwd.trim());
  }
  if (typeof record.cwd === "string" && record.cwd.trim()) {
    roots.push(record.cwd.trim());
  }
  const primaryCwd = roots[0] || (typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : process.cwd());
  const uniqueDirs = Array.from(new Set(roots.length > 0 ? roots : [primaryCwd]));
  return {
    cwd: primaryCwd,
    addDirs: uniqueDirs,
  };
}

export class AgyBridge extends EventEmitter implements CodexRuntimeClient {
  private sessions = new Map<string, AgySession>();
  private options?: AgyBridgeOptions;
  private status: EngineStatus = {
    phase: "ready",
    transport: "stdio",
    message: "Antigravity CLI (AGY) ready",
  };

  constructor(options?: AgyBridgeOptions) {
    super();
    this.options = options;
  }

  hasSession(threadId: string): boolean {
    return this.sessions.has(threadId);
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  async start(): Promise<EngineStatus> {
    const probe = probeAgyCliCommand(findAgyBin());
    const agyLaunchConfigured = isAgyLaunchConfigured();
    if (!probe.available) {
      this.status = {
        phase: "error",
        transport: "stdio",
        message: probe.error ?? "Antigravity CLI not found",
      };
    } else {
      this.status = {
        phase: "ready",
        transport: "stdio",
        message: `Antigravity CLI v${probe.version ?? "unknown"} ready${agyLaunchConfigured ? " · agy-launch configured" : ""}`,
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
  }

  async restart(): Promise<EngineStatus> {
    this.stop();
    return this.start();
  }

  async notify(_method: string, _params?: JsonValue): Promise<void> {
    // Notifications don't expect responses
  }

  respond(id: JsonRpcId, result?: JsonValue, error?: JsonRpcFailure["error"]): void {
    const reqIdStr = String(id);
    for (const session of this.sessions.values()) {
      if (session.runtime?.hasPendingQuestion(reqIdStr)) {
        session.runtime.resolvePendingQuestion(reqIdStr, result, error);
        return;
      }
    }
  }

  deleteSession(threadId: string): void {
    const session = this.sessions.get(threadId);
    if (session) {
      session.runtime?.interrupt();
      if (session.proxyServer) {
        session.proxyServer.stop().catch(() => {});
      }
      this.sessions.delete(threadId);
    }
  }

  restoreSession(snapshot: AgySessionSnapshot): AgySession {
    const existing = this.sessions.get(snapshot.threadId);
    const effectiveProviderId = snapshot.providerId || "agy-official";
    const effectiveGroupId = (effectiveProviderId === "agy-official" || snapshot.groupId === null)
      ? undefined
      : snapshot.groupId;
    const effectiveModel = (effectiveProviderId === "agy-official" && (!snapshot.model || !isAgyOfficialModel(snapshot.model)))
      ? "gemini-3.8-flash-high"
      : snapshot.model;

    if (existing) {
      if (snapshot.conversationId) existing.conversationId = snapshot.conversationId;
      if (snapshot.preview) existing.preview = snapshot.preview;
      if (snapshot.turns) existing.turns = snapshot.turns;
      if (snapshot.messages) existing.messages = snapshot.messages;
      existing.providerId = effectiveProviderId;
      existing.groupId = effectiveGroupId;
      if (effectiveModel) existing.model = effectiveModel;
      if (snapshot.effort) existing.effort = snapshot.effort;
      if (snapshot.developerInstructions) existing.developerInstructions = snapshot.developerInstructions;
      if (snapshot.cwd) existing.cwd = snapshot.cwd;
      if (snapshot.addDirs) existing.addDirs = snapshot.addDirs;
      if (snapshot.mode) existing.mode = snapshot.mode;
      return existing;
    }
    const session: AgySession = {
      threadId: snapshot.threadId,
      ownerId: snapshot.ownerId,
      conversationId: snapshot.conversationId,
      preview: snapshot.preview,
      model: effectiveModel,
      effort: snapshot.effort,
      developerInstructions: snapshot.developerInstructions,
      cwd: snapshot.cwd ?? process.cwd(),
      addDirs: snapshot.addDirs,
      mode: snapshot.mode,
      goalObjective: snapshot.goalObjective,
      goalStatus: snapshot.goalStatus,
      turns: snapshot.turns ?? [],
      messages: snapshot.messages ?? [],
      providerId: effectiveProviderId,
      groupId: effectiveGroupId,
    };
    this.sessions.set(session.threadId, session);
    return session;
  }

  private getOrRestoreSession(threadId: string, ownerId?: string): AgySession | undefined {
    let session = this.sessions.get(threadId);
    if (!session && this.options?.loadSnapshot) {
      const snap = this.options.loadSnapshot(threadId, ownerId);
      if (snap) {
        session = this.restoreSession(snap);
      }
    }
    return session;
  }

  private persistSession(session: AgySession): void {
    if (this.options?.onSnapshot) {
      this.options.onSnapshot({
        threadId: session.threadId,
        ownerId: session.ownerId,
        conversationId: session.conversationId,
        preview: session.preview,
        model: session.model,
        effort: session.effort,
        developerInstructions: session.developerInstructions,
        cwd: session.cwd,
        addDirs: session.addDirs,
        mode: session.mode,
        goalObjective: session.goalObjective,
        goalStatus: session.goalStatus,
        turns: session.turns,
        messages: session.messages,
        providerId: session.providerId,
        groupId: session.groupId,
      });
    }
  }

  private wireRuntimeEvents(session: AgySession, runtime: AgyCompatibleRuntime): void {
    runtime.on("conversationId", (convId: string) => {
      session.conversationId = convId;
      this.persistSession(session);
    });

    runtime.on("serverRequest", (request: JsonRpcRequest) => {
      this.emit("message", request);
    });

    runtime.on("questionAnswered", (evt: { threadId: string; turnId: string; answerText: string }) => {
      console.log(`[agyBridge] questionAnswered for threadId=${evt.threadId}: ${evt.answerText}`);
      const prompt = `针对上一轮提问的用户回答如下：${evt.answerText}\n请按此继续执行，不要重复提问。`;
      void this.request("turn/start", {
        threadId: evt.threadId,
        prompt,
      } as unknown as JsonValue).catch((err: unknown) => {
        console.error(`[agyBridge] failed to start continuation turn after questionAnswered:`, err);
      });
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
      } else if (notif.method === "agy/init") {
        const convId = (notif.params as any)?.conversationId;
        if (convId) {
          session.conversationId = convId;
          this.persistSession(session);
        }
      }
      this.emit("notification", notif);
    });
  }

  private async configureSessionProxy(
    session?: AgySession,
    providerId?: string,
    groupId?: string,
    model?: string
  ): Promise<Record<string, string> | undefined> {
    const effectiveProviderId = providerId || "agy-official";

    // Check if this is agy-launch provider (uses local proxy on port 0 = auto)
    const isAgyLaunch = providerId === "agy-launch" || providerId?.includes("agy-launch");

    if (effectiveProviderId === "agy-official") {
      if (session?.proxyServer) {
        await session.proxyServer.stop().catch(() => {});
        session.proxyServer = undefined;
      }
      console.log(`[agyBridge] configureSessionProxy: providerId=agy-official cliBackend=agy hasCloudCodeUrl=false (official mode)`);
      return undefined;
    }

    if (isAgyLaunch) {
      // For agy-launch, we don't start a proxy server here - agy-launch itself IS the proxy
      // The CLOUD_CODE_URL will be set to http://127.0.0.1:0 which means "find free port and start agy-launch"
      // The actual proxy startup happens in agyCompatibleRuntime via envOverrides
      console.log(`[agyBridge] configureSessionProxy: providerId=agy-launch cliBackend=agy hasCloudCodeUrl=auto (agy-launch mode)`);
      return { CLOUD_CODE_URL: "http://127.0.0.1:0" };
    }

    // LLM gateway mode (agy >= 1.4.x): when the host resolves
    // AGY_LLM_GATEWAY_* env, agy authenticates "via gateway" (ChainedAuth)
    // and needs NO Google OAuth login, speaking OpenAI wire protocol to the
    // gateway (which serves GET /v1/models discovery and POST
    // /v1/chat/completions). The CLOUD_CODE_URL path alone still makes agy
    // refuse to run before its first request when no login exists
    // ("authentication required. Run 'agy' to log in"), so gateway env
    // takes precedence over the per-session Code Assist proxy whenever the
    // host offers it.
    if (this.options?.resolveRelayEnv) {
      const gatewayEnv = await this.options.resolveRelayEnv(effectiveProviderId, groupId, model);
      if (gatewayEnv?.AGY_LLM_GATEWAY_URL) {
        if (session?.proxyServer) {
          await session.proxyServer.stop().catch(() => {});
          session.proxyServer = undefined;
        }
        console.log(`[agyBridge] configureSessionProxy: providerId=${effectiveProviderId} groupId=${groupId ?? "default"} model=${model ?? "unknown"} cliBackend=agy mode=llm-gateway gatewayHost=${formatProxyHost(gatewayEnv.AGY_LLM_GATEWAY_URL)}`);
        return { ...gatewayEnv };
      }
    }

    if (this.options?.resolveRelayProxyConfig) {
      const proxyConfig = await this.options.resolveRelayProxyConfig(effectiveProviderId, groupId, model);
      if (proxyConfig) {
        // Bind the owning conversation so upstream fetches carry a
        // thread-stable x-opencode-session (OpenCode Go compliance).
        if (session) proxyConfig.threadId = session.threadId;
        if (!session?.proxyServer) {
          const proxyServer = new AgyProxyServer(proxyConfig);
          const proxyUrl = await proxyServer.start();
          if (session) {
            session.proxyServer = proxyServer;
          }
          console.log(`[agyBridge] configureSessionProxy: providerId=${effectiveProviderId} groupId=${groupId ?? "default"} model=${model ?? "unknown"} cliBackend=agy hasCloudCodeUrl=true proxyHost=${formatProxyHost(proxyUrl)}`);
          return {
            CLOUD_CODE_URL: proxyUrl,
            GOOGLE_GEMINI_BASE_URL: proxyUrl,
            GEMINI_API_KEY: proxyConfig.apiKeys?.[0] || "agy-relay-key",
          };
        } else {
          session.proxyServer.updateConfig(proxyConfig);
          console.log(`[agyBridge] configureSessionProxy: providerId=${effectiveProviderId} groupId=${groupId ?? "default"} model=${model ?? "unknown"} cliBackend=agy hasCloudCodeUrl=true proxyHost=${formatProxyHost(session.proxyServer.url)}`);
          return {
            CLOUD_CODE_URL: session.proxyServer.url,
            GOOGLE_GEMINI_BASE_URL: session.proxyServer.url,
            GEMINI_API_KEY: proxyConfig.apiKeys?.[0] || "agy-relay-key",
          };
        }
      }
    }

    if (this.options?.resolveRelayEnv) {
      const relayEnv = await this.options.resolveRelayEnv(effectiveProviderId, groupId, model);
      if (relayEnv && relayEnv.CLOUD_CODE_URL) {
        console.log(`[agyBridge] configureSessionProxy: providerId=${effectiveProviderId} groupId=${groupId ?? "default"} model=${model ?? "unknown"} cliBackend=agy hasCloudCodeUrl=true proxyHost=${formatProxyHost(relayEnv.CLOUD_CODE_URL)}`);
        return {
          ...relayEnv,
          GOOGLE_GEMINI_BASE_URL: relayEnv.GOOGLE_GEMINI_BASE_URL || relayEnv.CLOUD_CODE_URL,
          GEMINI_API_KEY: relayEnv.GEMINI_API_KEY || "agy-relay-key",
        };
      }
    }

    console.error(`[agyBridge] configureSessionProxy: AGY relay proxy configuration failed for providerId=${effectiveProviderId} groupId=${groupId ?? "default"} model=${model ?? "unknown"}`);
    throw new Error(`AGY relay proxy configuration failed for providerId=${effectiveProviderId} groupId=${groupId ?? "default"} model=${model ?? "unknown"}`);
  }

  async request(method: string, params?: JsonValue, _timeoutMs?: number): Promise<JsonValue> {
    const record = (params && typeof params === "object" && !Array.isArray(params) ? params : {}) as Record<string, any>;

    switch (method) {
      case "thread/start": {
        const threadId = randomUUID();
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const ws = resolveAgyWorkspaceDirs(record);
        const cwd = ws.cwd;
        const addDirs = ws.addDirs;
        const providerId = typeof record.providerId === "string" && record.providerId ? record.providerId : "agy-official";
        const groupId = (record.groupId === null || providerId === "agy-official")
          ? undefined
          : (typeof record.groupId === "string" && record.groupId.trim() ? record.groupId.trim() : undefined);
        let model = typeof record.model === "string" && record.model.trim() ? record.model.trim() : undefined;
        if (providerId === "agy-official" && (!model || !isAgyOfficialModel(model))) {
          model = "gemini-3.8-flash-high";
        }
        const effort = typeof record.reasoningEffort === "string" ? record.reasoningEffort : (typeof record.effort === "string" ? record.effort : "high");
        const isPlan = record.sandbox === "read-only"
          || record.mode === "plan"
          || record.collaborationMode === "plan"
          || (typeof record.collaborationMode === "object" && (record.collaborationMode?.mode === "plan" || record.collaborationMode?.settings?.mode === "plan"))
          || record.planModeEnabled === true;
        const mode = isPlan ? "plan" : "accept-edits";
        const developerInstructions = typeof record.developerInstructions === "string" && record.developerInstructions.trim()
          ? record.developerInstructions.trim()
          : undefined;

        const session: AgySession = {
          threadId,
          ownerId,
          cwd,
          addDirs,
          model,
          effort,
          mode,
          developerInstructions,
          providerId,
          groupId,
          runtime: undefined,
          turns: [],
          messages: [],
        };

        this.sessions.set(threadId, session);
        this.persistSession(session);
        // 新机器自举：按工程目录落盘 MCP + 7 方 skill（含 jev）。
        bootstrapProjectSaVmAssets(cwd, threadId);
        console.log(`[agyBridge] thread/start: threadId=${threadId} cliBackend=agy providerId=${providerId} groupId=${groupId ?? "default"} model=${model ?? "unknown"}`);

        return {
          thread: {
            id: threadId,
            cliBackend: "agy",
            cwd,
            model: model ?? null,
            status: "active",
            createdAt: Date.now(),
          },
        } as unknown as JsonValue;
      }

      case "turn/start": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        let session = this.getOrRestoreSession(threadId, ownerId);
        if (session && ownerId && session.ownerId && session.ownerId !== "local" && session.ownerId !== ownerId) {
          throw new Error(`AGY session belongs to another owner: ${threadId}`);
        }
        const storedMeta = !session ? this.options?.loadMetadata?.(threadId, ownerId) : null;
        if (storedMeta?.ownerId && storedMeta.ownerId !== "local" && ownerId && storedMeta.ownerId !== ownerId) {
          throw new Error(`AGY session belongs to another owner: ${threadId}`);
        }
        const ws = resolveAgyWorkspaceDirs({
          ...record,
          cwd: record.cwd ?? storedMeta?.cwd,
          runtimeWorkspaceRoots: record.runtimeWorkspaceRoots ?? storedMeta?.addDirs,
        });

        const candidateProviderId = typeof record.providerId === "string" && record.providerId
          ? record.providerId
          : (session?.providerId || storedMeta?.providerId || "agy-official");
        const providerChanged = Boolean(session && session.providerId && candidateProviderId !== session.providerId);

        let candidateGroupId: string | undefined;
        if (candidateProviderId === "agy-official" || record.groupId === null) {
          candidateGroupId = undefined;
        } else if (typeof record.groupId === "string" && record.groupId.trim()) {
          candidateGroupId = record.groupId.trim();
        } else if (providerChanged) {
          candidateGroupId = undefined;
        } else {
          candidateGroupId = session?.groupId ?? storedMeta?.groupId;
        }

        let candidateModel: string | undefined;
        if (typeof record.model === "string" && record.model.trim()) {
          candidateModel = record.model.trim();
        } else if (candidateProviderId === "agy-official") {
          candidateModel = (session?.model && isAgyOfficialModel(session.model))
            ? session.model
            : (storedMeta?.model && isAgyOfficialModel(storedMeta.model))
              ? storedMeta.model
              : "gemini-3.8-flash-high";
        } else if (providerChanged) {
          candidateModel = undefined;
        } else {
          candidateModel = session?.model ?? storedMeta?.model;
        }
        if (candidateProviderId === "agy-official" && (!candidateModel || !isAgyOfficialModel(candidateModel))) {
          candidateModel = "gemini-3.8-flash-high";
        }

        const effort = typeof record.reasoningEffort === "string"
          ? record.reasoningEffort
          : (typeof record.effort === "string" ? record.effort : (session?.effort || "high"));
        const isPlan = record.sandbox === "read-only"
          || record.mode === "plan"
          || record.collaborationMode === "plan"
          || (typeof record.collaborationMode === "object" && (record.collaborationMode?.mode === "plan" || record.collaborationMode?.settings?.mode === "plan"))
          || record.planModeEnabled === true;
        const mode = isPlan ? "plan" : (session?.mode ?? "accept-edits");

        const rawDevInstructions = typeof record.developerInstructions === "string" && record.developerInstructions.trim()
          ? record.developerInstructions.trim()
          : undefined;
        const developerInstructions = rawDevInstructions ?? session?.developerInstructions;

        if (session?.pendingTurnTimer) {
          clearTimeout(session.pendingTurnTimer);
          session.pendingTurnTimer = undefined;
        }
        if (session?.runtime && session.activeTurnId) {
          session.runtime.interrupt();
        }

        // Test and configure proxy FIRST using candidate variables.
        // If this throws (e.g. invalid relay / no key), session remains untouched!
        const envOverrides = await this.configureSessionProxy(session, candidateProviderId, candidateGroupId, candidateModel);
        console.log(`[agyBridge] turn/start: threadId=${threadId} cliBackend=agy providerId=${candidateProviderId} groupId=${candidateGroupId ?? "default"} model=${candidateModel ?? "unknown"} hasCloudCodeUrl=${Boolean(envOverrides?.CLOUD_CODE_URL || envOverrides?.AGY_LLM_GATEWAY_URL)} proxyHost=${formatProxyHost(envOverrides?.CLOUD_CODE_URL || envOverrides?.AGY_LLM_GATEWAY_URL)}`);

        // Proxy succeeded (or official mode). Now commit candidate parameters to session:
        if (!session) {
          session = {
            threadId,
            ownerId,
            cwd: ws.cwd,
            addDirs: ws.addDirs,
            model: candidateModel,
            effort,
            mode,
            developerInstructions,
            providerId: candidateProviderId,
            groupId: candidateGroupId,
            turns: [],
            messages: [],
          };
          this.sessions.set(threadId, session);
        } else {
          if (ownerId) session.ownerId = ownerId;
          session.providerId = candidateProviderId;
          session.groupId = candidateGroupId;
          session.model = candidateModel;
          if (effort) session.effort = effort;
          if (developerInstructions) session.developerInstructions = developerInstructions;
          session.mode = mode;
          if (ws.cwd && (session.cwd === process.cwd() || !session.cwd || (record.cwd && String(record.cwd).trim()))) {
            session.cwd = ws.cwd;
          }
          if (ws.addDirs.length > 0) {
            session.addDirs = Array.from(new Set([...(session.addDirs ?? []), ...ws.addDirs]));
          }
        }

        if (!session.runtime) {
          const runtime = new AgyCompatibleRuntime({
            threadId,
            cwd: session.cwd,
            addDirs: session.addDirs,
            conversationId: session.conversationId,
            model: session.model,
            effort: session.effort,
            mode: session.mode,
            dangerouslySkipPermissions: true,
            providerId: session.providerId,
            groupId: session.groupId,
            envOverrides,
          });
          this.wireRuntimeEvents(session, runtime);
          session.runtime = runtime;
        } else {
          session.runtime.updateConfig({
            cwd: session.cwd,
            addDirs: session.addDirs,
            conversationId: session.conversationId,
            model: session.model,
            effort: session.effort,
            mode: session.mode,
            providerId: session.providerId,
            groupId: session.groupId,
            envOverrides: envOverrides,
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
          id: `agy-user-${turnId}`,
          turnId,
          threadId,
          text: cleanPrompt,
          content: userContent,
          role: "user",
          status: "completed",
          startedAt: Math.floor(Date.now() / 1000),
        };

        if (!session.preview && cleanPrompt) {
          session.preview = cleanPrompt.length > 80 ? cleanPrompt.slice(0, 80) + "..." : cleanPrompt;
        }

        session.turns.push({ id: turnId, status: "in_progress", createdAt: Date.now() });
        session.messages.push(userItem as JsonValue);
        session.activeTurnId = turnId;
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

        session.pendingTurnTimer = setTimeout(() => {
          session.pendingTurnTimer = undefined;
          void session?.runtime?.executeTurn(executionPrompt, turnId).catch((error) => {
            console.error(`[agyBridge] executeTurn failed for threadId=${threadId} turnId=${turnId}:`, error);
            const t = session.turns.find((entry) => entry.id === turnId);
            if (t) t.status = "failed";
            session.activeTurnId = undefined;
            this.persistSession(session);
            this.emit("notification", {
              method: "turn/failed",
              params: {
                threadId,
                turnId,
                error: {
                  message: error instanceof Error ? error.message : String(error),
                },
              },
            });
          });
        }, 10);

        return {
          turn: {
            id: turnId,
            status: "in_progress",
          },
        };
      }

      case "thread/compact/start": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        let session = this.getOrRestoreSession(threadId, ownerId);
        if (!session) throw new Error("Unknown thread: " + threadId);
        if (session.activeTurnId) throw new Error("Cannot compact while a turn is running");

        const turnId = randomUUID();
        const compactionPrompt = "Please summarize the conversation so far, retaining critical context, technical decisions, file paths, and current status.";

        const providerId = session.providerId || "agy-official";
        const groupId = providerId === "agy-official" ? undefined : session.groupId;
        const model = (providerId === "agy-official" && (!session.model || !isAgyOfficialModel(session.model)))
          ? "gemini-3.8-flash-high"
          : session.model;
        const envOverrides = await this.configureSessionProxy(session, providerId, groupId, model);
        if (!session.runtime) {
          const runtime = new AgyCompatibleRuntime({
            threadId,
            cwd: session.cwd,
            conversationId: session.conversationId,
            model: session.model,
            effort: session.effort,
            mode: session.mode,
            dangerouslySkipPermissions: true,
            providerId: session.providerId,
            groupId: session.groupId,
            envOverrides,
          });
          this.wireRuntimeEvents(session, runtime);
          session.runtime = runtime;
        } else {
          session.runtime.updateConfig({
            conversationId: session.conversationId,
            model: session.model,
            effort: session.effort,
            mode: session.mode,
            providerId: session.providerId,
            groupId: session.groupId,
            envOverrides: envOverrides,
          });
        }

        session.turns.push({ id: turnId, status: "in_progress", createdAt: Date.now() });
        session.activeTurnId = turnId;
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
          method: "item/started",
          params: {
            threadId,
            turnId,
            item: {
              id: `agy-compact-${turnId}`,
              threadId,
              turnId,
              type: "compaction",
              status: "inProgress",
            },
          },
        });

        session.pendingTurnTimer = setTimeout(() => {
          session.pendingTurnTimer = undefined;
          void session?.runtime?.executeTurn(compactionPrompt, turnId).catch((error) => {
            console.error(`[agyBridge] compaction executeTurn failed for threadId=${threadId} turnId=${turnId}:`, error);
            const t = session.turns.find((entry) => entry.id === turnId);
            if (t) t.status = "failed";
            session.activeTurnId = undefined;
            this.persistSession(session);
            this.emit("notification", {
              method: "turn/failed",
              params: {
                threadId,
                turnId,
                error: {
                  message: error instanceof Error ? error.message : String(error),
                },
              },
            });
          });
        }, 10);

        return {
          turn: {
            id: turnId,
            threadId,
            status: "inProgress",
          },
        };
      }

      case "turn/interrupt": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const session = this.getOrRestoreSession(threadId, ownerId);
        const activeTurnId = String(record.turnId ?? session?.activeTurnId ?? "");
        if (session) {
          if (session.pendingTurnTimer) {
            clearTimeout(session.pendingTurnTimer);
            session.pendingTurnTimer = undefined;
          }
          if (session.runtime) {
            session.runtime.interrupt();
          }
          if (activeTurnId) {
            const turn = session.turns.find((t) => t.id === activeTurnId);
            if (turn) {
              turn.status = "interrupted";
            }
          }
          session.activeTurnId = undefined;
          this.persistSession(session);
        }
        if (threadId) {
          this.emit("notification", {
            method: "turn/interrupted",
            params: {
              threadId,
              ...(activeTurnId ? { turnId: activeTurnId, turn: { id: activeTurnId, threadId, status: "interrupted", completedAt: Math.floor(Date.now() / 1000) } } : {}),
            },
          });
        }
        return { ok: true };
      }

      case "thread/read":
      case "thread/resume": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const includeTurns = record.includeTurns !== false;
        const liveSession = this.sessions.get(threadId);
        if (!includeTurns && !liveSession && this.options?.loadMetadata) {
          const metadata = this.options.loadMetadata(threadId, ownerId);
          if (!metadata) return { thread: { id: threadId, cliBackend: "agy", status: { type: "idle" }, turns: [] }, items: [] } as unknown as JsonValue;
          return { thread: { ...metadata, id: threadId, cliBackend: "agy", historyMode: "paginated", status: { type: "idle" }, turns: [] }, items: [] } as unknown as JsonValue;
        }
        const session = liveSession ?? this.getOrRestoreSession(threadId, ownerId);
        if (!session) {
          return {
            thread: {
              id: threadId,
              cliBackend: "agy",
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
            sessionId: session.conversationId ?? threadId,
            conversationId: session.conversationId,
            preview: session.preview,
            model: session.model,
            cliBackend: "agy",
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
          items: session.messages,
        } as unknown as JsonValue;
      }

      case "thread/turns/list": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const session = this.getOrRestoreSession(threadId, ownerId);
        if (!session) return { turns: [], data: [], nextCursor: null };
        return pageThreadHistory(threadId, session.turns, session.messages, {
          cursor: typeof record.cursor === "string" ? record.cursor : null,
          limit: typeof record.limit === "number" ? record.limit : 32,
          sortDirection: typeof record.sortDirection === "string" ? record.sortDirection : "desc",
        }) as unknown as JsonValue;
      }

      case "thread/items/list": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const session = this.getOrRestoreSession(threadId, ownerId);
        return { items: session?.messages ?? [] };
      }

      case "thread/goal/set": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const session = this.getOrRestoreSession(threadId, ownerId);
        if (!session) throw new Error("Unknown thread: " + threadId);
        session.goalObjective = typeof record.objective === "string" ? record.objective : null;
        session.goalStatus = typeof record.status === "string" ? record.status : (session.goalObjective ? "active" : null);
        this.persistSession(session);
        return { ok: true, goal: { objective: session.goalObjective, status: session.goalStatus } };
      }

      case "thread/goal/get": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const session = this.getOrRestoreSession(threadId, ownerId);
        return { goal: session ? { objective: session.goalObjective ?? null, status: session.goalStatus ?? null } : null };
      }

      case "thread/name/set": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const session = this.getOrRestoreSession(threadId, ownerId);
        if (session) {
          session.preview = typeof record.name === "string" ? record.name : session.preview;
          this.persistSession(session);
        }
        return { ok: true };
      }

      case "thread/delete": {
        const threadId = String(record.threadId ?? "");
        this.deleteSession(threadId);
        return { ok: true };
      }

      default:
        return {};
    }
  }
}
