import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  EngineStatus,
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcNotification,
  JsonValue,
} from "@codex-ui/shared";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import { PiRuntimeAdapter } from "./piRuntimeAdapter.js";
import type { PiRelayConfig } from "./piRpcProcessManager.js";
import { bootstrapProjectSaVmAssets } from "@cxu/sdk-backend";
import { pageThreadHistory } from "@cxu/sdk-backend";

export const PI_OFFICIAL_PROVIDER_ID = "pi-relay";

export interface PiSessionSnapshot {
  threadId: string;
  ownerId?: string;
  sessionId?: string;
  preview?: string;
  model?: string;
  developerInstructions?: string;
  cwd?: string;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
}

export interface PiBridgeOptions {
  resolveRelayConfig?: (providerId?: string, groupId?: string, model?: string) => Promise<PiRelayConfig | undefined>;
  onSnapshot?: (snapshot: PiSessionSnapshot) => void;
  loadSnapshot?: (threadId: string, ownerId?: string) => PiSessionSnapshot | null;
  loadMetadata?: (threadId: string, ownerId?: string) => Partial<PiSessionSnapshot> | null;
}

interface PiSession {
  threadId: string;
  ownerId?: string;
  cwd: string;
  model?: string;
  developerInstructions?: string;
  sessionId?: string;
  providerId?: string;
  groupId?: string;
  preview?: string;
  activeTurnId?: string;
  runtime?: PiRuntimeAdapter;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
}

export class PiBridge extends EventEmitter implements CodexRuntimeClient {
  private options?: PiBridgeOptions;
  private sessions = new Map<string, PiSession>();
  private status: EngineStatus = {
    phase: "ready",
    transport: "stdio",
    message: "Pi coding agent RPC ready",
  };

  constructor(options?: PiBridgeOptions) {
    super();
    this.options = options;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  async start(): Promise<EngineStatus> {
    this.status = {
      phase: "ready",
      transport: "stdio",
      message: "Pi coding agent RPC ready",
    };
    return this.status;
  }

  stop(): void {
    for (const session of this.sessions.values()) {
      session.runtime?.stop();
    }
    this.sessions.clear();
    this.status = {
      phase: "stopped",
      transport: "stdio",
      message: "Pi coding agent RPC stopped",
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
      session.runtime?.stop();
      this.sessions.delete(threadId);
    }
  }

  restoreSession(snapshot: PiSessionSnapshot): PiSession {
    const existing = this.sessions.get(snapshot.threadId);
    if (existing) {
      if (snapshot.sessionId) existing.sessionId = snapshot.sessionId;
      if (snapshot.preview) existing.preview = snapshot.preview;
      if (snapshot.turns) existing.turns = snapshot.turns;
      if (snapshot.messages) existing.messages = snapshot.messages;
      return existing;
    }
    const session: PiSession = {
      threadId: snapshot.threadId,
      ownerId: snapshot.ownerId,
      sessionId: snapshot.sessionId,
      preview: snapshot.preview,
      model: snapshot.model,
      developerInstructions: snapshot.developerInstructions,
      cwd: snapshot.cwd ?? process.cwd(),
      turns: snapshot.turns ?? [],
      messages: snapshot.messages ?? [],
    };
    this.sessions.set(session.threadId, session);
    return session;
  }

  private getOrRestoreSession(threadId: string, ownerId?: string): PiSession | undefined {
    let session = this.sessions.get(threadId);
    if (!session && this.options?.loadSnapshot) {
      const snap = this.options.loadSnapshot(threadId, ownerId);
      if (snap) {
        session = this.restoreSession(snap);
      }
    }
    return session;
  }

  private persistSession(session: PiSession): void {
    if (this.options?.onSnapshot) {
      this.options.onSnapshot({
        threadId: session.threadId,
        ownerId: session.ownerId,
        sessionId: session.sessionId,
        preview: session.preview,
        model: session.model,
        developerInstructions: session.developerInstructions,
        cwd: session.cwd,
        turns: session.turns,
        messages: session.messages,
      });
    }
  }

  private wireRuntimeEvents(session: PiSession, runtime: PiRuntimeAdapter): void {
    runtime.on("notification", (notif: JsonRpcNotification) => {
      if (notif.method === "turn/started") {
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

  async request(method: string, params?: JsonValue, _timeoutMs?: number): Promise<JsonValue> {
    const record = (params && typeof params === "object" && !Array.isArray(params) ? params : {}) as Record<string, any>;

    switch (method) {
      case "thread/start": {
        const threadId = typeof record.threadId === "string" && record.threadId.trim() ? record.threadId.trim() : randomUUID();
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : process.cwd();
        const session: PiSession = {
          threadId,
          ownerId,
          cwd,
          model: typeof record.model === "string" ? record.model : "pi-relay/default",
          providerId: typeof record.providerId === "string" ? record.providerId : PI_OFFICIAL_PROVIDER_ID,
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
            cliBackend: "pi",
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
          if (!metadata) return { thread: { id: threadId, cliBackend: "pi", status: { type: "idle" }, turns: [] }, items: [] } as unknown as JsonValue;
          return { thread: { ...metadata, id: threadId, cliBackend: "pi", historyMode: "paginated", status: { type: "idle" }, turns: [] }, items: [] } as unknown as JsonValue;
        }
        const session = liveSession ?? this.getOrRestoreSession(threadId, ownerId);
        if (!session) {
          return {
            thread: {
              id: threadId,
              cliBackend: "pi",
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
            cliBackend: "pi",
            historyMode: "paginated",
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
          },
          items: includeTurns ? session.messages : [],
        } as unknown as JsonValue;
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

      case "turn/start": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        let session = this.getOrRestoreSession(threadId, ownerId);
        if (session && ownerId && session.ownerId && session.ownerId !== "local" && session.ownerId !== ownerId) {
          throw new Error(`Pi session belongs to another owner: ${threadId}`);
        }
        const storedMeta = !session ? this.options?.loadMetadata?.(threadId, ownerId) : null;
        if (storedMeta?.ownerId && storedMeta.ownerId !== "local" && ownerId && storedMeta.ownerId !== ownerId) {
          throw new Error(`Pi session belongs to another owner: ${threadId}`);
        }
        const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : (session?.cwd ?? (storedMeta as any)?.cwd ?? process.cwd());
        const providerId = typeof record.providerId === "string" ? record.providerId : (session?.providerId ?? (storedMeta as any)?.providerId);
        const groupId = typeof record.groupId === "string" ? record.groupId : (session?.groupId ?? (storedMeta as any)?.groupId);
        const model = typeof record.model === "string" ? record.model : (session?.model ?? (storedMeta as any)?.model ?? "pi-relay/default");

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
          if (developerInstructions) session.developerInstructions = developerInstructions;
          if (cwd) session.cwd = cwd;
        }

        let relayConfig: PiRelayConfig | undefined;
        if (this.options?.resolveRelayConfig) {
          relayConfig = await this.options.resolveRelayConfig(session.providerId, session.groupId, session.model);
        }

        if (!session.runtime) {
          const runtime = new PiRuntimeAdapter({
            threadId,
            cwd: session.cwd,
            sessionId: session.sessionId,
            model: session.model,
            relayConfig,
          });
          this.wireRuntimeEvents(session, runtime);
          session.runtime = runtime;
        } else {
          session.runtime.updateConfig({
            cwd: session.cwd,
            sessionId: session.sessionId,
            model: session.model,
            relayConfig,
          });
        }

        if (session.activeTurnId) {
          const prevTurn = session.turns.find((t) => t.id === session.activeTurnId);
          if (prevTurn && (prevTurn.status === "inProgress" || prevTurn.status === "in_progress")) {
            await session.runtime?.interrupt();
            if (prevTurn.status === "inProgress" || prevTurn.status === "in_progress") {
              prevTurn.status = "interrupted";
              this.emit("notification", {
                method: "turn/interrupted",
                params: {
                  threadId,
                  turnId: prevTurn.id,
                  engine: "pi",
                  turn: { id: prevTurn.id, threadId, status: "interrupted" },
                },
              });
            }
          }
          session.activeTurnId = undefined;
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
          id: `pi-user-${turnId}`,
          turnId,
          threadId,
          text: cleanPrompt,
          content: userContent,
          role: "user",
          status: "completed",
          startedAt: Math.floor(Date.now() / 1000),
          completedAt: Math.floor(Date.now() / 1000),
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
            engine: "pi",
            turn: { id: turnId, threadId, status: "inProgress" },
          },
        });
        this.emit("notification", {
          method: "item/completed",
          params: { threadId, turnId, item: userItem },
        });

        // Run turn in background
        void session.runtime.executeTurn(executionPrompt, turnId).catch((err) => {
          const turn = session!.turns.find((entry) => entry.id === turnId);
          const isActiveTurn = session!.activeTurnId === turnId
            && (turn?.status === "inProgress" || turn?.status === "in_progress");
          if (!isActiveTurn) return;

          const rawMsg = String(err?.message || err);
          // pi 二进制缺失/扩展缺失时底层多为 ENOENT/spawn 报错，追加可操作提示，
          // 否则前端只看到含糊的“进程错误”。
          const errorMsg = /spawn|ENOENT|not found|Failed to spawn|not running or stdin/i.test(rawMsg)
            ? `${rawMsg} (pi CLI 未找到或无法启动：请安装 pi，或设置 PI_BIN / CODEX_UI_PI_BIN 指向 pi 可执行文件；relay 扩展缺失时设置 CODEX_UI_PI_RELAY_EXTENSION)`
            : rawMsg;
          const errItem: Record<string, JsonValue> = {
            type: "agentMessage",
            id: `pi-err-${turnId}`,
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
          turn!.status = "failed";
          session.activeTurnId = undefined;
          this.persistSession(session!);
          this.emit("notification", {
            method: "item/completed",
            params: { threadId, turnId, item: errItem },
          });
          this.emit("notification", {
            method: "turn/failed",
            params: {
              threadId,
              turnId,
              engine: "pi",
              completedAt: Math.floor(Date.now() / 1000),
              turn: { id: turnId, threadId, status: "failed", error: errorMsg, completedAt: Math.floor(Date.now() / 1000) },
              error: errorMsg,
            },
          });
        });

        return {
          turn: { id: turnId, threadId, status: "inProgress" },
          turnId,
        } as unknown as JsonValue;
      }

      case "turn/steer": {
        const threadId = String(record.threadId ?? "");
        const ownerId = typeof record.ownerId === "string" ? record.ownerId : undefined;
        let session = this.getOrRestoreSession(threadId, ownerId);
        if (!session || !session.activeTurnId) {
          throw new Error("No active turn");
        }
        const expectedTurnId = typeof record.expectedTurnId === "string" ? record.expectedTurnId : undefined;
        if (expectedTurnId && expectedTurnId !== session.activeTurnId) {
          throw new Error(`Expected active turn id '${expectedTurnId}' but found '${session.activeTurnId}'`);
        }

        let steerText = "";
        const attachmentBlocks: JsonValue[] = [];
        const input = record.input;
        if (typeof input === "string") {
          steerText = input;
        } else if (Array.isArray(input)) {
          for (const item of input) {
            if (typeof item === "string") {
              steerText += item;
            } else if (item && typeof item === "object") {
              const itemRecord = item as Record<string, unknown>;
              if (itemRecord.type === "text" && typeof itemRecord.text === "string") {
                steerText += (itemRecord.text as string) + "\n";
              } else if ("text" in itemRecord && typeof itemRecord.text === "string") {
                steerText += itemRecord.text as string;
              } else {
                attachmentBlocks.push(item as JsonValue);
              }
            }
          }
        } else if (typeof record.prompt === "string") {
          steerText = record.prompt;
        }
        const cleanSteer = steerText.trim();
        const turnId = session.activeTurnId;
        const userMsgId = `pi-user-${turnId}-${randomUUID()}`;
        const userContent: JsonValue[] = [];
        if (cleanSteer) {
          userContent.push({ type: "text", text: cleanSteer, text_elements: [] });
        }
        userContent.push(...attachmentBlocks);

        const userItem: Record<string, JsonValue> = {
          type: "userMessage",
          id: userMsgId,
          threadId,
          turnId,
          text: cleanSteer,
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

        if (cleanSteer && session.runtime) {
          await session.runtime.steer(cleanSteer);
        }

        return {
          turn: {
            id: turnId,
            threadId,
            status: "inProgress",
          },
          turnId,
        } as unknown as JsonValue;
      }

      case "turn/interrupt": {
        const threadId = String(record.threadId ?? "");
        const session = this.sessions.get(threadId);
        if (session) {
          await session.runtime?.interrupt();
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
            params: { threadId, turnId, engine: "pi", turn: { id: turnId, threadId, status: "inProgress" } },
          });
          const compactionItem: Record<string, JsonValue> = {
            type: "compaction",
            id: `pi-compact-${turnId}`,
            turnId,
            threadId,
            status: "completed",
            completedAt: Math.floor(Date.now() / 1000),
          };
          this.emit("notification", {
            method: "item/completed",
            params: { threadId, turnId, item: compactionItem },
          });
          this.emit("notification", {
            method: "turn/completed",
            params: {
              threadId,
              turnId,
              engine: "pi",
              completedAt: Math.floor(Date.now() / 1000),
              turn: { id: turnId, threadId, status: "completed", completedAt: Math.floor(Date.now() / 1000) },
            },
          });
          return { turn: { id: turnId, threadId, status: "completed", completedAt: Math.floor(Date.now() / 1000) } } as unknown as JsonValue;
        }
        return { success: false } as unknown as JsonValue;
      }

      default:
        return {} as unknown as JsonValue;
    }
  }
}
