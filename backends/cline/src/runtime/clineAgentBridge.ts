import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  type EngineStatus,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonValue,
} from "@codex-ui/shared";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import { ClineHubClient, type ClineHubEvent } from "./clineHubClient.js";
import { createBridgeEventLogger, type BridgeEventLogger } from "@cxu/sdk-backend";
import {
  findClineChildFile,
  projectClineChildFile,
  recordClineSpawn,
  type ClineChildProjection,
} from "./clineChildSession.js";
import { findClineBin, probeClineVersion } from "./clineCommand.js";

/**
 * Cline backend bridge — a CodexRuntimeClient over the Cline CLI's own hub
 * daemon (see clineHubClient.ts for the reverse-engineered protocol).
 *
 * Design notes:
 *  - NOT ACP (user decision 2026-10-24: too restrictive, and its session
 *    gate demands a vendor login). The hub path is fully BYOK: providers
 *    are configured in the data dir (clineProviders.ts) and selected per
 *    session through create metadata — no Cline account involved.
 *  - NOT embedded either: the hub is a detached daemon process of the
 *    user's own external `cline` binary (like `opencode serve`).
 *  - The workbench thread id IS the hub session id, so history survives
 *    bridge restarts through session.list / session.get / session.messages.
 *  - Sessions are created with autoApproveTools=true — the same posture as
 *    the CLI's own headless mode (--auto-approve defaults to true). If an
 *    approval event still arrives it is answered "approved" via
 *    approval.respond; the manifest honestly declares
 *    permissionRoundTrips=false for now.
 */

export interface ClineUpstreamConfig {
  /** providers.json entry id written by writeClineRelayProvider. */
  providerEntryId: string;
  model: string;
}

interface ClineSessionState {
  threadId: string;
  cwd?: string;
  model?: string;
  providerEntryId?: string;
  createdAt: number;
  activeTurnId?: string;
  activeRunId?: string;
  activeItemId?: string;
  streamedText: string;
  itemStarted: boolean;
  /** Text segment sequence for dialogue/tool interleaving. */
  textSegIndex: number;
  /** Reasoning item sequence for hub `reasoning.finished` projection. */
  reasoningSeq: number;
  /** Team task-board checklist (`team_task` create/complete → plan item). */
  planSteps: Array<{ step: string; status: string; key: string }>;
  /** Async-dispatched team runs awaiting `team_await_runs` (runId → card). */
  pendingTeamRuns: Map<string, { toolCallId: string; turnId: string; threadId: string; agentId?: string }>;
  /** Latest `usage.updated` totals, used when the terminal event (`agent.done`) carries no usage. */
  lastUsage?: Record<string, JsonValue>;
  turns: Array<Record<string, JsonValue>>;
  messages: JsonValue[];
}

export class ClineAgentBridge extends EventEmitter implements CodexRuntimeClient {
  private status: EngineStatus = { phase: "stopped" };
  private hub: ClineHubClient | null = null;
  private readonly sessions = new Map<string, ClineSessionState>();
  private readonly pendingUpstream = new Map<string, ClineUpstreamConfig>();
  private defaultUpstream: ClineUpstreamConfig | null = null;
  private readonly seenEventIds = new Set<string>();
  /** Hub event names already logged once (tool-event name discovery). */
  private readonly loggedHubEvents = new Set<string>();
  private readonly eventLog: BridgeEventLogger;
  /** Spawn-agent toolCallIds with no `tool.finished` yet (child running). */
  private readonly openSpawnIds = new Set<string>();
  /** Resolved child transcript files (toolCallId → file), 30s cache. */
  private readonly childFileCache = new Map<string, { file: string; root: string; at: number }>();
  private startPromise: Promise<EngineStatus> | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly runtimeEnv: () => NodeJS.ProcessEnv = () => process.env,
  ) {
    super();
    this.eventLog = createBridgeEventLogger("cline", dataDir);
  }

  /**
   * Point upcoming sessions at a relay station (host-resolved). Mirrors
   * the old applyUpstream/configure pair: the provider entry must already
   * exist in the data dir's providers.json (see clineProviders.ts).
   * Existing sessions keep the provider they were created with — the hub
   * fixes provider/model in the session manifest at create time.
   */
  applyUpstream(config: ClineUpstreamConfig, threadId?: string | null): void {
    if (threadId) this.pendingUpstream.set(threadId, config);
    else this.defaultUpstream = config;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.emit("status", this.getStatus());
  }

  async start(): Promise<EngineStatus> {
    if (this.status.phase === "ready" || this.status.phase === "starting") {
      return this.startPromise ?? this.getStatus();
    }
    this.setStatus({ phase: "starting" });
    this.startPromise = (async () => {
      const bin = findClineBin(this.runtimeEnv());
      if (!bin) {
        const message = "Cline backend could not resolve a cline binary (install cline or set CLINE_BIN).";
        this.setStatus({ phase: "error", message });
        throw new Error(message);
      }
      this.hub = new ClineHubClient({ binPath: bin, dataDir: this.dataDir, runtimeEnv: this.runtimeEnv });
      this.hub.on("event", (event: ClineHubEvent) => this.handleHubEvent(event));
      try {
        await this.hub.connect();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus({ phase: "error", message });
        throw error;
      }
      this.setStatus({ phase: "ready" });
      return this.getStatus();
    })();
    return this.startPromise;
  }

  async restart(): Promise<EngineStatus> {
    this.stop();
    return this.start();
  }

  stop(): void {
    this.hub?.close();
    this.hub = null;
    this.startPromise = null;
    this.setStatus({ phase: "stopped" });
  }

  /** The hub daemon is shared and detached; the bridge only disconnects. */
  hasSession(threadId: string): boolean {
    return this.sessions.has(threadId);
  }

  async request(method: string, params?: JsonValue, _timeoutMs = 60_000): Promise<JsonValue> {
    return this.handleMethod(method, (params ?? {}) as Record<string, JsonValue>);
  }

  async notify(_method: string, _params?: JsonValue): Promise<void> {
    // The hub protocol has no client->server notification channel we need.
  }

  respond(_id: JsonRpcId, _result?: JsonValue, _error?: JsonRpcFailure["error"]): void {
    // This bridge emits no host-routed server requests in v1 (approvals are
    // auto-answered at the hub, see the class docstring).
  }

  private async handleMethod(method: string, p: Record<string, JsonValue>): Promise<JsonValue> {
    switch (method) {
      case "initialize":
      case "config/read": {
        const bin = findClineBin(this.runtimeEnv());
        const version = bin ? probeClineVersion(bin) : null;
        return {
          userAgent: `cline/${version ?? "external"} codex-react-ui/0.1.0`,
          codexHome: process.env.CODEX_HOME || "",
          capabilities: { experimentalApi: true },
        } as JsonValue;
      }

      case "thread/start": {
        await this.start();
        const hub = this.requireHub();
        const cwd = typeof p.cwd === "string" ? p.cwd : process.cwd();
        const requestedThreadId = typeof p.threadId === "string" ? p.threadId : null;
        const upstream = (requestedThreadId ? this.pendingUpstream.get(requestedThreadId) : undefined)
          ?? this.defaultUpstream
          ?? undefined;
        const model = typeof p.model === "string" ? p.model : upstream?.model;
        const created = await hub.command("session.create", {
          cwd,
          metadata: {
            ...(upstream ? { provider: upstream.providerEntryId } : {}),
            ...(model ? { model } : {}),
            autoApproveTools: true,
          },
        });
        const session = recordOf(created.session);
        const threadId = typeof session.sessionId === "string" ? session.sessionId : null;
        if (!threadId) throw new Error("cline hub session.create returned no sessionId");
        const state: ClineSessionState = {
          threadId,
          cwd,
          model,
          providerEntryId: upstream?.providerEntryId,
          createdAt: typeof session.createdAt === "number" ? session.createdAt : Date.now(),
          streamedText: "",
          itemStarted: false,
          textSegIndex: 0,
          reasoningSeq: 0,
          planSteps: [],
          pendingTeamRuns: new Map(),
          turns: [],
          messages: [],
        };
        this.sessions.set(threadId, state);
        hub.subscribe(threadId);
        this.emit("message", {
          method: "thread/started",
          params: { thread: { id: threadId, model, cliBackend: "cline", status: { type: "idle" }, cwd } },
        } as JsonRpcMessage);
        return { thread: { id: threadId, model, cliBackend: "cline", status: { type: "idle" } } } as JsonValue;
      }

      case "thread/resume": {
        await this.start();
        const hub = this.requireHub();
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const child = this.sessions.has(threadId) ? null : this.readChildSession(threadId);
        if (child) {
          return {
            thread: {
              id: threadId,
              cliBackend: "cline",
              status: { type: child.running ? "running" : "idle" },
              cwd: process.cwd(),
            },
          } as unknown as JsonValue;
        }
        const got = await hub.command("session.get", {}, threadId);
        const session = recordOf(got.session);
        if (!session.sessionId) throw new Error("Unknown thread: " + threadId);
        const state = this.bindSession(session);
        hub.subscribe(threadId);
        return {
          thread: {
            id: state.threadId,
            model: state.model,
            cliBackend: "cline",
            status: { type: "idle" },
            cwd: state.cwd,
          },
        } as JsonValue;
      }

      case "thread/list": {
        await this.start();
        const hub = this.requireHub();
        const listed = await hub.command("session.list", {});
        const sessions = Array.isArray(listed.sessions) ? listed.sessions : Array.isArray(listed.data) ? listed.data : [];
        const threads = sessions.map((entry) => {
          const session = recordOf(entry as JsonValue);
          const metadata = recordOf(session.metadata);
          const createdAt = typeof session.createdAt === "number" ? session.createdAt : Date.now();
          return {
            id: typeof session.sessionId === "string" ? session.sessionId : "",
            preview: typeof metadata.title === "string" ? metadata.title : undefined,
            model: typeof metadata.model === "string" ? metadata.model : undefined,
            cliBackend: "cline",
            status: { type: "idle" },
            cwd: typeof session.cwd === "string" ? session.cwd : undefined,
            createdAt: Math.floor(createdAt / 1000),
            updatedAt: Math.floor((typeof session.updatedAt === "number" ? session.updatedAt : createdAt) / 1000),
            recencyAt: Math.floor((typeof session.updatedAt === "number" ? session.updatedAt : createdAt) / 1000),
            source: "appServer",
            turns: [],
          };
        }).filter((thread) => thread.id);
        return { data: threads } as JsonValue;
      }

      case "thread/turns/list": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const child = this.sessions.has(threadId) ? null : this.readChildSession(threadId);
        if (child) {
          return {
            turns: [{ id: threadId, threadId, status: child.running ? "inProgress" : "completed", items: [] }],
          } as JsonValue;
        }
        const state = await this.ensureSessionWithHistory(threadId);
        return { turns: state ? state.turns : [] } as JsonValue;
      }

      case "thread/items/list": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const child = this.sessions.has(threadId) ? null : this.readChildSession(threadId);
        if (child) return { items: child.items } as JsonValue;
        const state = await this.ensureSessionWithHistory(threadId);
        return { items: state ? state.messages : [] } as JsonValue;
      }

      case "turn/start":
      case "turn/steer": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const state = this.sessions.get(threadId);
        if (!state) throw new Error("Unknown thread: " + threadId);
        if (method === "turn/start" && state.activeTurnId) {
          throw new Error(`Turn is already active: ${state.activeTurnId}`);
        }
        const text = extractTurnText(p);
        if (!text) throw new Error("Cline turns require a text prompt in v1");
        const turnId = method === "turn/steer" && state.activeTurnId
          ? state.activeTurnId
          : typeof p.turnId === "string" ? p.turnId : randomUUID();
        const hub = this.requireHub();
        await hub.connect();
        const userItem = {
          type: "userMessage",
          id: `cline-${turnId}-user`,
          turnId,
          threadId,
          content: [{ type: "text", text }],
          status: "completed",
        } as unknown as JsonValue;
        state.messages.push(userItem);
        this.emit("message", {
          method: "item/completed",
          params: { threadId, turnId, item: userItem },
        } as JsonRpcMessage);
        if (method === "turn/start") {
          state.activeTurnId = turnId;
          state.streamedText = "";
          state.itemStarted = false;
          state.lastUsage = undefined;
          state.turns.push({ id: turnId, threadId, status: "inProgress", items: [] } as Record<string, JsonValue>);
        }
        const enqueued = await hub.command("run.enqueue", { prompt: text }, threadId, 30_000);
        state.activeRunId = typeof enqueued.runId === "string" ? enqueued.runId : undefined;
        return { turn: { id: turnId, threadId, status: "inProgress" } } as JsonValue;
      }

      case "turn/interrupt": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const state = this.sessions.get(threadId);
        if (state?.activeTurnId) {
          try {
            await this.requireHub().command("session.abort", {}, threadId, 10_000);
          } catch (error) {
            this.emit("stderr", `cline session.abort failed: ${error instanceof Error ? error.message : String(error)}\n`);
          }
        }
        return {} as JsonValue;
      }

      case "thread/delete":
      case "thread/archive":
      case "thread/closed":
      case "thread/unsubscribe": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        if (threadId) {
          if (method === "thread/delete") {
            try { await this.requireHub().command("session.delete", {}, threadId, 10_000); } catch { /* best effort */ }
          }
          this.sessions.delete(threadId);
        }
        return {} as JsonValue;
      }

      case "thread/fork":
        throw new Error("Cline backend does not support thread/fork");

      default:
        return {} as JsonValue;
    }
  }

  private requireHub(): ClineHubClient {
    if (!this.hub) throw new Error("Cline bridge is not started");
    return this.hub;
  }

  private bindSession(session: Record<string, JsonValue>): ClineSessionState {
    const threadId = String(session.sessionId ?? "");
    const existing = this.sessions.get(threadId);
    if (existing) return existing;
    const metadata = recordOf(session.metadata);
    const state: ClineSessionState = {
      threadId,
      cwd: typeof session.cwd === "string" ? session.cwd : undefined,
      model: typeof metadata.model === "string" ? metadata.model : undefined,
      providerEntryId: typeof metadata.provider === "string" ? metadata.provider : undefined,
      createdAt: typeof session.createdAt === "number" ? session.createdAt : Date.now(),
      streamedText: "",
      itemStarted: false,
      textSegIndex: 0,
      reasoningSeq: 0,
      planSteps: [],
      pendingTeamRuns: new Map(),
      turns: [],
      messages: [],
    };
    this.sessions.set(threadId, state);
    return state;
  }

  /** Bind a session and lazily load its persisted messages as history. */
  private async ensureSessionWithHistory(threadId: string): Promise<ClineSessionState | null> {    if (!threadId) return null;
    let state = this.sessions.get(threadId) ?? null;
    if (state && state.messages.length > 0) return state;
    try {
      await this.start();
      const hub = this.requireHub();
      if (!state) {
        const got = await hub.command("session.get", {}, threadId);
        const session = recordOf(got.session);
        if (!session.sessionId) return null;
        state = this.bindSession(session);
      }
      const result = await hub.command("session.messages", {}, threadId);
      const messages = Array.isArray(result.messages) ? result.messages : [];
      state.messages = messages.flatMap((entry) => mapHubMessage(entry as JsonValue, threadId));
      state.turns = buildTurnsFromItems(state.messages);
      // Backfill the spawn index from persisted collab cards so child cards
      // keep resolving after bridge restarts (no live tool.started replays).
      for (const entry of state.messages) {
        const record = recordOf(entry);
        if (record.type !== "collabAgentToolCall" || typeof record.id !== "string") continue;
        const prompt = typeof record.prompt === "string" && record.prompt
          ? record.prompt
          : (typeof record.message === "string" ? record.message : "");
        if (!prompt) continue;
        recordClineSpawn(this.dataDir, {
          toolCallId: record.id,
          rootSessionId: threadId,
          task: prompt.slice(0, 4000),
          systemPrompt: "",
          startedAt: state.createdAt,
        });
      }
    } catch {
      // History is best-effort: an unreachable hub yields an empty listing
      // rather than failing the whole sidebar (mirrors auggie's stance).
    }
    return state;
  }

  /**
   * Close the turn's open text segment (if any) so a tool card inserted now
   * keeps dialogue/tool/dialogue order. Later deltas open a fresh segment.
   */
  private closeOpenTextSegment(state: ClineSessionState, threadId: string): void {
    const turnId = state.activeTurnId;
    const itemId = state.activeItemId;
    if (!turnId || !itemId) return;
    const text = state.streamedText;
    state.activeItemId = undefined;
    state.streamedText = "";
    state.itemStarted = false;
    if (!text) return;
    const item = {
      type: "agentMessage",
      id: itemId,
      turnId,
      threadId,
      content: text,
      role: "assistant",
      status: "completed",
    } as unknown as JsonValue;
    const idx = state.messages.findIndex((entry) => {
      const record = recordOf(entry);
      return record.type === "agentMessage" && record.id === itemId;
    });
    if (idx >= 0) state.messages[idx] = item;
    else state.messages.push(item);
    this.emit("message", {
      method: "item/completed",
      params: { threadId, turnId, item },
    } as JsonRpcMessage);
  }

  /**
   * Flip any still-`inProgress` tool cards of a finished turn to their
   * terminal state so no tab stays stuck `running` (team mode can end via
   * `agent.done` while a `team_run_task` never got its `tool.finished`).
   */
  /**
   * Reconcile async `team_run_task` cards with the daemon's run board.
   * `team_list_runs` returns `[{id, agentId, status, currentActivity,
   * lastProgressMessage, messagePreview}]`; those results arrive as ordinary
   * tool output, so the card can track the teammate's real state instead of
   * showing the dispatch receipt until the turn ends.
   */
  private reconcileTeamRuns(
    state: ClineSessionState,
    threadId: string,
    turnId: string,
    rawOutput: JsonValue | undefined,
  ): void {
    if (state.pendingTeamRuns.size === 0) return;
    const parsed = parseJsonLoose(rawOutput);
    const runs: Array<Record<string, JsonValue>> = [];
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const record = recordOf(entry);
        if (typeof record.id === "string") runs.push(record);
      }
    } else {
      const record = recordOf(parsed);
      if (Array.isArray(record.runs)) {
        for (const entry of record.runs) {
          const inner = recordOf(entry);
          if (typeof inner.id === "string") runs.push(inner);
        }
      }
    }
    for (const run of runs) {
      const runId = typeof run.id === "string" ? run.id : "";
      const agentId = typeof run.agentId === "string" ? run.agentId : "";
      const status = typeof run.status === "string" ? run.status.toLowerCase() : "";
      if (!status) continue;
      let ref = runId ? state.pendingTeamRuns.get(runId) : undefined;
      if (!ref && agentId) {
        for (const entry of state.pendingTeamRuns.values()) {
          if (entry.agentId === agentId) {
            ref = entry;
            break;
          }
        }
      }
      if (!ref) continue;
      const target = state.messages.find((entry) => {
        const record = recordOf(entry);
        return (record.type === "toolCall" || record.type === "collabAgentToolCall") && record.id === ref.toolCallId;
      });
      if (!target) continue;
      const record = recordOf(target);
      // Never reopen a settled card when a stale snapshot arrives.
      if (record.status === "completed" || record.status === "failed") continue;
      const failedStatus = status === "failed" || status === "error" || status === "cancelled"
        || status === "interrupted" || status === "stopped";
      const terminal = failedStatus || status === "completed" || status === "done";
      // `lastProgressMessage`/`currentActivity` are `"heartbeat"` while the
      // teammate merely keeps the run alive: never surface that as content.
      // There is no report in any team tool output — the full transcript is the
      // child card's read-on-open projection — so a terminal card drops the
      // dispatch receipt instead of inventing a preview.
      const activity = meaningfulTeamActivity(run);
      record.status = terminal ? (failedStatus ? "failed" : "completed") : "inProgress";
      if (record.type === "collabAgentToolCall") {
        record.agentStatus = terminal ? (failedStatus ? "failed" : "completed") : "running";
      }
      if (terminal) {
        delete record.output;
        delete record.result;
      } else if (activity) {
        record.output = activity.slice(0, 4000);
        record.result = { content: activity.slice(0, 4000) };
      }
      this.emit("message", {
        method: terminal ? "item/completed" : "item/started",
        params: { threadId, turnId, item: target },
      } as JsonRpcMessage);
      if (terminal) {
        this.openSpawnIds.delete(ref.toolCallId);
        if (runId) state.pendingTeamRuns.delete(runId);
      }
    }
  }

  private settleOpenToolItems(
    state: ClineSessionState,
    threadId: string,
    turnId: string,
    status: "completed" | "failed" | "interrupted",
  ): void {
    const terminal = status === "completed" ? "completed" : status === "failed" ? "failed" : "interrupted";
    for (const entry of state.messages) {
      const record = recordOf(entry);
      if (record.turnId !== turnId) continue;
      if (record.type !== "toolCall" && record.type !== "collabAgentToolCall") continue;
      if (record.status !== "inProgress") continue;
      record.status = terminal;
      if (record.type === "collabAgentToolCall") record.agentStatus = terminal;
      if (typeof record.id === "string") {
        this.openSpawnIds.delete(record.id);
        for (const [runId, ref] of state.pendingTeamRuns) {
          if (ref.toolCallId === record.id) state.pendingTeamRuns.delete(runId);
        }
      }
      this.emit("message", {
        method: "item/completed",
        params: { threadId, turnId, item: entry },
      } as JsonRpcMessage);
    }
  }

  /**
   * True when `childId` (a spawn collab card's toolCallId) resolves to a
   * daemon-persisted subagent transcript. Mirrors muse's `hasChildThread`:
   * read-only opens of these ids route to this bridge instead of failing
   * with `thread not loaded`.
   */
  hasChildThread(childId: string): boolean {
    return this.resolveChildFile(childId) !== null;
  }

  private resolveChildFile(childId: string): { file: string; root: string } | null {
    const id = childId.trim();
    if (!id) return null;
    const cached = this.childFileCache.get(id);
    if (cached && Date.now() - cached.at < 30_000) return cached;
    const claimed = new Set<string>();
    for (const entry of this.childFileCache.values()) claimed.add(entry.file);
    const found = findClineChildFile(this.dataDir, id, claimed);
    if (found) this.childFileCache.set(id, { file: found.file, root: found.rootSessionId, at: Date.now() });
    const hit = this.childFileCache.get(id);
    return hit ? { file: hit.file, root: hit.root } : null;
  }

  private readChildSession(childId: string): ClineChildProjection | null {
    const found = this.resolveChildFile(childId);
    if (!found) return null;
    return projectClineChildFile(found.file, childId, this.openSpawnIds.has(childId));
  }

  /**
   * Fold a `team_task` create/complete into the turn checklist. Creates are
   * keyed by the daemon's `task_NNNN` numbering (adopted from finished
   * output when present, otherwise ordinal — the daemon numbers creates
   * sequentially); completes close by that key, or append when unknown.
   */
  private applyClineTeamTask(
    state: ClineSessionState,
    threadId: string,
    turnId: string,
    action: string,
    input: Record<string, JsonValue>,
    output: Record<string, JsonValue>,
  ): void {
    const steps = state.planSteps ?? [];
    state.planSteps = steps;
    if (action === "create") {
      const title = typeof input.title === "string" && input.title.trim()
        ? input.title.trim().slice(0, 200) : "Untitled task";
      const assignee = typeof input.assignee === "string" && input.assignee.trim()
        ? ` (${input.assignee.trim().slice(0, 60)})` : "";
      const assigned = typeof output.taskId === "string" && output.taskId
        ? output.taskId
        : (typeof output.task_id === "string" && output.task_id ? output.task_id : "");
      const key = assigned
        || `task_${String(steps.filter((s) => s.key.startsWith("task_")).length + 1).padStart(4, "0")}`;
      if (!steps.some((s) => s.key === key)) {
        steps.push({ step: `${title}${assignee}`, status: "in_progress", key });
      }
    } else {
      const taskId = typeof input.taskId === "string" && input.taskId
        ? input.taskId
        : (typeof input.task_id === "string" ? input.task_id : "");
      const target = taskId ? steps.find((s) => s.key === taskId) : undefined;
      if (target) {
        target.status = "completed";
      } else if (taskId) {
        const summary = typeof input.summary === "string" && input.summary.trim()
          ? input.summary.trim().slice(0, 200) : taskId;
        steps.push({ step: summary, status: "completed", key: taskId });
      }
    }
    this.emitClinePlan(state, threadId, turnId);
  }

  /**
   * Rebuild the turn's `plan` item from the team task-board checklist.
   * Shape mirrors opencode/claude (`type:plan` + `plan[]` + markdown text)
   * so the waterfall PlanRow and the floating TaskPlanPanel both pick it up;
   * `collapseSupersededPlanRows` keeps the newest one per thread.
   */
  private emitClinePlan(state: ClineSessionState, threadId: string, turnId: string): void {
    const steps = state.planSteps ?? [];
    const text = steps
      .map((s) => `${s.status === "completed" ? "- [x]" : "- [ ]"} ${s.step}`)
      .join("\n") || "No tasks yet";
    const allDone = steps.length > 0 && steps.every((s) => s.status === "completed");
    const item = {
      type: "plan",
      id: `cline-${turnId}-plan`,
      turnId,
      threadId,
      title: "Plan",
      text,
      plan: steps.map((s) => ({ step: s.step, status: s.status })),
      status: allDone ? "completed" : "inProgress",
    } as unknown as JsonValue;
    const idx = state.messages.findIndex((entry) => {
      const record = recordOf(entry);
      return record.type === "plan" && record.id === `cline-${turnId}-plan`;
    });
    if (idx >= 0) state.messages[idx] = item;
    else state.messages.push(item);
    this.emit("message", {
      method: "item/completed",
      params: { threadId, turnId, item },
    } as JsonRpcMessage);
  }

  private handleHubEvent(event: ClineHubEvent): void {
    if (event.eventId) {
      if (this.seenEventIds.has(event.eventId)) return;
      this.seenEventIds.add(event.eventId);
      if (this.seenEventIds.size > 5000) this.seenEventIds.clear();
    }
    // Diagnostic event log (local disk): high-frequency text deltas log a
    // length only; everything else logs the full payload (64KB cap).
    const payload = event.payload;
    if (event.event === "assistant.delta" || event.event === "reasoning.delta") {
      const text = typeof (payload as Record<string, unknown>).text === "string"
        ? ((payload as Record<string, unknown>).text as string).length : 0;
      this.eventLog.append({ kind: "hub-event", event: event.event, sessionId: event.sessionId ?? null, textLen: text });
    } else {
      this.eventLog.append({ kind: "hub-event", event: event.event, sessionId: event.sessionId ?? null, eventId: event.eventId ?? null, payload: payload as Record<string, unknown> });
    }
    const threadId = event.sessionId;
    if (!threadId) return;
    const state = this.sessions.get(threadId);
    if (!state) return;

    switch (event.event) {
      case "assistant.delta": {
        const text = typeof payload.text === "string" ? payload.text : "";
        if (!text || !state.activeTurnId) return;
        if (!state.activeItemId) {
          state.textSegIndex = (state.textSegIndex ?? 0) + 1;
          state.activeItemId = `cline-${state.activeTurnId}-text-${state.textSegIndex}`;
        }
        state.streamedText += text;
        if (!state.itemStarted) {
          state.itemStarted = true;
          const textItem = { type: "agentMessage", id: state.activeItemId, turnId: state.activeTurnId, threadId, status: "inProgress" };
          // Hold the text row's position among tool cards from the start;
          // the completed flush upserts this same id instead of appending.
          state.messages.push(textItem as unknown as JsonValue);
          this.emit("message", {
            method: "item/started",
            params: {
              threadId,
              turnId: state.activeTurnId,
              item: textItem,
            },
          } as JsonRpcMessage);
        }
        this.emit("message", {
          method: "item/agentMessage/delta",
          params: { threadId, turnId: state.activeTurnId, itemId: state.activeItemId, delta: text },
        } as JsonRpcMessage);
        return;
      }

      case "assistant.finished": {
        // The terminal run event flushes the completed item; the finished
        // event only carries the same full text we already streamed.
        return;
      }

      case "approval.requested":
      case "permission.asked": {
        // Sessions run with autoApproveTools=true (the CLI's own headless
        // posture), so this is a defensive answer, not the normal path.
        void this.hub?.command("approval.respond", { decision: "approved", approved: true }, threadId, 10_000).catch(() => {});
        return;
      }

      case "run.completed": {
        const result = recordOf(payload.result);
        const text = typeof result.text === "string" ? result.text : state.streamedText;
        // The terminal payload may carry per-step tool records
        // (result.messages) that never arrived as live events: project them
        // now so the turn keeps its tool cards.
        if (state.activeTurnId) {
          const seenIds = new Set(
            state.messages.map((entry) => recordOf(entry)).filter((record) => record.type === "toolCall").map((record) => String(record.id ?? "")),
          );
          for (const item of projectHubResultToolItems(result.messages, threadId, state.activeTurnId)) {
            // Live tool.* events already persisted this card: skip the echo
            // so rows are not duplicated at the turn's end.
            if (seenIds.has(String(recordOf(item).id ?? ""))) continue;
            seenIds.add(String(recordOf(item).id ?? ""));
            state.messages.push(item);
            this.emit("message", {
              method: "item/completed",
              params: { threadId, turnId: state.activeTurnId, item },
            } as JsonRpcMessage);
          }
        }
        this.finishTurn(state, threadId, "completed", text, recordOf(result.usage));
        return;
      }

      case "run.failed": {
        const message = typeof payload.error === "string" ? payload.error : "Cline run failed";
        this.finishTurn(state, threadId, "failed", state.streamedText, undefined, message);
        return;
      }

      case "run.aborted":
      case "run.interrupted": {
        this.finishTurn(state, threadId, "interrupted", state.streamedText, undefined);
        return;
      }

      case "agent.done": {
        // Team mode (cline ≥3.0.73 team orchestration) ends the run with
        // `agent.done` instead of `run.completed`: payload carries the final
        // text directly. Without this the parent turn stays Thinking forever
        // while every subagent already finished (verified live 2026-10-25:
        // team_spawn_teammate/team_run_task all finished, then agent.done
        // {reason:"completed"} arrived and the UI never settled).
        const reason = typeof payload.reason === "string" ? payload.reason.toLowerCase() : "";
        const text = typeof payload.text === "string" && payload.text
          ? payload.text
          : state.streamedText;
        const status = reason === "failed" || reason === "error" ? "failed" as const : "completed" as const;
        this.finishTurn(state, threadId, status, text, state.lastUsage);
        return;
      }

      case "usage.updated": {
        // Stash the latest totals; the terminal `agent.done` event carries
        // no usage of its own.
        const totals = recordOf(payload.totals ?? payload.usage ?? payload.aggregateUsage);
        if (Object.keys(totals).length > 0) state.lastUsage = totals;
        return;
      }

      case "iteration.started":
      case "iteration.finished":
      case "run.heartbeat":
      case "team.progress": {
        // Team-mode keepalives and per-step markers: no projection today,
        // and they must not pollute the unknown-event log.
        return;
      }

      case "reasoning.finished": {
        // The hub sends no reasoning deltas, only the committed text per
        // iteration. Project it as a reasoning item so the waterfall shows
        // the Thinking row (attached to the next assistant message); without
        // this the main transcript never shows any thinking.
        const text = typeof payload.reasoning === "string" ? payload.reasoning.trim() : "";
        if (!text || !state.activeTurnId) return;
        const turnId = state.activeTurnId;
        state.reasoningSeq = (state.reasoningSeq ?? 0) + 1;
        const item = {
          type: "reasoning",
          id: `cline-${turnId}-reasoning-${state.reasoningSeq}`,
          turnId,
          threadId,
          content: text.slice(0, 8000),
          status: "completed",
        } as unknown as JsonValue;
        state.messages.push(item);
        this.emit("message", {
          method: "item/completed",
          params: { threadId, turnId, item },
        } as JsonRpcMessage);
        return;
      }

      case "tool.started":
      case "tool.updated":
      case "tool.finished": {
        // Live tool cards (in chat order): the terminal result.messages
        // projection stays as a backstop, but rows must appear while the
        // turn runs, not piled up after it.
        // Late arrivals (e.g. spawn_agent finished AFTER agent.done ended
        // the turn) fall back to the most recent turn instead of being
        // dropped — otherwise the subagent report vanishes entirely.
        let turnId = state.activeTurnId;
        if (!turnId) {
          const last = state.turns.at(-1);
          if (!last || typeof last.id !== "string") return;
          turnId = last.id;
        }
        // A tool starting mid-text ends the current text segment first so
        // the transcript keeps dialogue/tool/dialogue order.
        if (event.event === "tool.started") this.closeOpenTextSegment(state, threadId);
        const toolId = typeof payload.toolCallId === "string" && payload.toolCallId
          ? payload.toolCallId
          : typeof payload.id === "string" && payload.id
            ? payload.id
            : typeof payload.toolId === "string" && payload.toolId
              ? payload.toolId
              : `cline-${turnId}-tool-${randomUUID()}`;
        const toolName = typeof payload.name === "string" && payload.name
          ? payload.name
          : typeof payload.tool === "string" && payload.tool
            ? payload.tool
            : typeof payload.toolName === "string" && payload.toolName
              ? payload.toolName
              : typeof payload.title === "string" && payload.title
                ? payload.title
                : "Tool";
        const toolInput = recordOf(payload.input ?? payload.arguments ?? (payload as Record<string, JsonValue>).args);
        // Team task-board CRUD projects as the turn checklist (plan item),
        // mirroring opencode/claude, instead of raw tool cards.
        if (toolName === "team_task") {
          const action = typeof toolInput.action === "string" ? toolInput.action.toLowerCase() : "";
          if (action === "create" || action === "complete") {
            this.applyClineTeamTask(state, threadId, turnId, action, toolInput, recordOf(payload.output));
            return;
          }
        }
        const statusText = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
        const done = event.event === "tool.finished"
          || statusText === "completed" || statusText === "failed" || statusText === "done" || statusText === "error";
        const errorText = typeof payload.error === "string" && payload.error.trim() ? payload.error.trim() : "";
        const failed = errorText.length > 0 || statusText === "failed" || statusText === "error" || payload.is_error === true;
        // tool.updated carries progress under `update`; tool.finished carries
        // the result under `output` (and `error` on failure). Subagent tools
        // (spawn_agent) wrap the report as {text, iterations, finishReason,
        // usage}: prefer the text over raw JSON.
        const progressUpdate = event.event === "tool.updated" ? (payload as Record<string, JsonValue>).update : undefined;
        const rawOutput = payload.output ?? payload.result ?? progressUpdate ?? payload.text ?? errorText;
        const outputRecord = recordOf(rawOutput);
        const outputText = typeof rawOutput === "string" ? rawOutput
          : (typeof outputRecord.text === "string" && outputRecord.text ? outputRecord.text : JSON.stringify(rawOutput));
        // team_run_task in async mode "finishes" with a dispatch receipt
        // ({status:"queued", runId}) — the work has NOT completed. Keep the
        // card running and settle it when `team_await_runs` lands instead
        // of flashing completed before the subagent starts.
        const runOutput = recordOf(payload.output);
        const runStatus = typeof runOutput.status === "string" ? runOutput.status.toLowerCase() : "";
        const runId = typeof runOutput.runId === "string" && runOutput.runId
          ? runOutput.runId
          : (typeof runOutput.run_id === "string" ? runOutput.run_id : "");
        const asyncQueued = toolName === "team_run_task" && event.event === "tool.finished"
          && (runOutput.dispatched === true || runId)
          && runStatus !== "completed" && runStatus !== "failed" && runStatus !== "error" && runStatus !== "done";
        const effectiveDone = done && !asyncQueued;
        const runAgentId = typeof toolInput.agentId === "string" && toolInput.agentId ? toolInput.agentId : "";
        if (asyncQueued) {
          state.pendingTeamRuns.set(runId || toolId, { toolCallId: toolId, turnId, threadId, ...(runAgentId ? { agentId: runAgentId } : {}) });
        }
        // `team_list_runs` / `team_status` are the hub's own live run board:
        // reconcile the async cards with it so they track the teammate instead
        // of hanging until turn end (or, before the await barrier existed,
        // flipping to completed at dispatch).
        if (toolName === "team_list_runs" || toolName === "team_status" || toolName === "team_await_runs") {
          this.reconcileTeamRuns(state, threadId, turnId, payload.output as JsonValue | undefined);
        }
        // The await barrier closing settles every run it was waiting on.
        if (toolName === "team_await_runs" && event.event === "tool.finished") {
          const terminal = failed ? "failed" : "completed";
          for (const [pendingRunId, ref] of state.pendingTeamRuns) {
            const target = state.messages.find((entry) => {
              const record = recordOf(entry);
              return (record.type === "toolCall" || record.type === "collabAgentToolCall") && record.id === ref.toolCallId;
            });
            if (target) {
              const record = recordOf(target);
              record.status = terminal;
              if (record.type === "collabAgentToolCall") record.agentStatus = terminal;
              // Drop the dispatch receipt ({status:"queued"...}) so the
              // settled card shows the brief, not a stale receipt.
              if (record.type === "collabAgentToolCall") {
                delete record.output;
                delete record.result;
              }
              this.emit("message", {
                method: "item/completed",
                params: { threadId: ref.threadId, turnId: ref.turnId, item: target },
              } as JsonRpcMessage);
            }
            this.openSpawnIds.delete(ref.toolCallId);
            state.pendingTeamRuns.delete(pendingRunId);
          }
        }
        const existingIdx = state.messages.findIndex((entry) => {
          const record = recordOf(entry);
          return (record.type === "toolCall" || record.type === "collabAgentToolCall") && record.id === toolId;
        });
        const existing = existingIdx >= 0 ? recordOf(state.messages[existingIdx]) : {};
        // Subagent/task calls project as collabAgentToolCall so the
        // waterfall renders ManageTask and the agent rail converges them.
        const taskCall = isClineTaskTool(toolName);
        const prompt = taskCall ? clineTaskPrompt(toolInput, existing) : "";
        // Index the delegation now (with its agentId) so opening the child card
        // resolves the daemon's per-agent transcript without waiting for a
        // transcript backfill.
        if (taskCall && event.event === "tool.started" && toolId) {
          const refAgent = typeof toolInput.agentId === "string" && toolInput.agentId
            ? toolInput.agentId
            : typeof toolInput.subagent === "string" ? toolInput.subagent : "";
          recordClineSpawn(this.dataDir, {
            toolCallId: toolId,
            rootSessionId: threadId,
            task: (prompt || "").slice(0, 4000),
            systemPrompt: typeof toolInput.systemPrompt === "string" ? toolInput.systemPrompt.slice(0, 4000) : "",
            startedAt: Date.now(),
            ...(refAgent ? { agentId: refAgent } : {}),
          });
        }
        // tool.finished payloads carry no input: when the current event has
        // no params, keep the started event's agent name instead of letting
        // clineTaskRole's tool-name fallback wash it out.
        const existingRole = typeof existing.agentName === "string" && existing.agentName
          ? existing.agentName
          : (typeof existing.agentRole === "string" && existing.agentRole ? existing.agentRole : "");
        const agentRole = taskCall
          ? ((Object.keys(toolInput).length > 0 ? clineTaskRole(toolInput, toolName) : "") || existingRole || (toolName !== "Tool" ? toolName : "subagent"))
          : "";
        // Subagent reports can be tens of KB: the main transcript keeps a
        // capped summary (the full transcript lives in the child card's
        // read-on-open projection), otherwise the delegation card floods
        // the parent waterfall with the whole report.
        // Team receipts are small objects (`{agentId, status:"queued"}`,
        // `{agentId, status:"spawned"}`): one readable line, never raw JSON.
        // An async dispatch line is replaced by `reconcileTeamRuns` once the
        // run board reports real progress.
        const receiptLine = taskCall && done ? collabReceiptLine(runOutput) : null;
        const collabOutput = taskCall && done
          ? (asyncQueued
            ? (receiptLine ?? "")
            : (receiptLine ?? summarizeCollabOutput(outputText)))
          : outputText;
        const item = taskCall ? {
          type: "collabAgentToolCall",
          id: toolId,
          threadId,
          turnId,
          name: toolName,
          tool: "task",
          toolName,
          agentId: toolId,
          agentName: agentRole,
          agentRole,
          taskName: agentRole,
          ...(prompt ? { prompt, message: prompt } : {}),
          senderThreadId: threadId,
          receiverThreadIds: (existing.receiverThreadIds as JsonValue[] | undefined) ?? [toolId],
          agentStatus: effectiveDone ? (failed ? "failed" : "completed") : "running",
          ...(collabOutput ? { output: collabOutput.slice(0, 4000), result: { content: collabOutput.slice(0, 4000) } } : {}),
          status: effectiveDone ? (failed ? "failed" : "completed") : "inProgress",
        } : {
          type: "toolCall",
          id: toolId,
          threadId,
          turnId,
          name: toolName !== "Tool" ? toolName : typeof existing.name === "string" ? existing.name : "Tool",
          tool: toolName !== "Tool" ? toolName : typeof existing.tool === "string" ? existing.tool : "Tool",
          toolName: toolName !== "Tool" ? toolName : typeof existing.toolName === "string" ? existing.toolName : "Tool",
          input: Object.keys(toolInput).length > 0 ? toolInput : recordOf(existing.input ?? existing.arguments),
          arguments: Object.keys(toolInput).length > 0 ? toolInput : recordOf(existing.arguments ?? existing.input),
          ...(outputText ? { output: outputText.slice(0, 4000), result: { content: outputText.slice(0, 4000) } } : {}),
          status: done ? (failed ? "failed" : "completed") : "inProgress",
        } as unknown as JsonValue;
        if (existingIdx >= 0) state.messages[existingIdx] = item;
        else state.messages.push(item);
        if (taskCall) {
          if (effectiveDone) this.openSpawnIds.delete(toolId);
          else this.openSpawnIds.add(toolId);
        }
        this.emit("message", {
          method: effectiveDone ? "item/completed" : "item/started",
          params: { threadId, turnId, item },
        } as JsonRpcMessage);
        return;
      }

      default: {
        // The hub's tool-execution event names are not fully documented;
        // log each unknown kind once so the next live tool turn reveals them
        // instead of dropping silently.
        const kind = event.event || "unknown";
        if (!this.loggedHubEvents.has(kind)) {
          this.loggedHubEvents.add(kind);
          console.info(`[cline] unhandled hub event: ${kind}`);
        }
        return;
      }
    }
  }

  private finishTurn(
    state: ClineSessionState,
    threadId: string,
    status: "completed" | "failed" | "interrupted",
    finalText: string,
    usage?: Record<string, JsonValue>,
    errorMessage?: string,
  ): void {
    const turnId = state.activeTurnId;
    if (!turnId) return;
    state.activeTurnId = undefined;
    state.activeRunId = undefined;
    // Settle cards the hub never closed (e.g. a team_run_task still
    // `running` when `agent.done` ends the turn) so no tab stays stuck.
    this.settleOpenToolItems(state, threadId, turnId, status);
    if (finalText) {
      const itemId = state.activeItemId ?? `cline-${turnId}-text`;
      const item = {
        type: "agentMessage",
        id: itemId,
        turnId,
        threadId,
        content: finalText,
        role: "assistant",
        status: "completed",
      } as unknown as JsonValue;
      this.emit("message", {
        method: "item/completed",
        params: { threadId, turnId, item },
      } as JsonRpcMessage);
      // Upsert: the live item/started already holds this row's position
      // among the turn's tool cards; pushing would sink the text below them.
      // When segments already carry this turn's text, the terminal full text
      // would double-display it, so only fill the gap when no text row
      // exists yet for the turn.
      const idx = state.messages.findIndex((entry) => {
        const record = recordOf(entry);
        return record.type === "agentMessage" && record.id === itemId;
      });
      if (idx >= 0) {
        state.messages[idx] = item;
      } else {
        const hasText = state.messages.some((entry) => {
          const record = recordOf(entry);
          return record.type === "agentMessage" && record.turnId === turnId;
        });
        if (!hasText) state.messages.push(item);
      }
    }
    state.activeItemId = undefined;
    state.streamedText = "";
    state.itemStarted = false;
    const turn = state.turns.find((entry) => entry.id === turnId);
    if (turn) turn.status = status;
    if (usage) {
      const promptTokens = numberOf(usage.inputTokens);
      const completionTokens = numberOf(usage.outputTokens);
      if (promptTokens !== undefined || completionTokens !== undefined) {
        this.emit("message", {
          method: "thread/tokenUsage/requestUpdated",
          params: {
            threadId,
            turnId,
            requestId: `cline-turn-${turnId}`,
            usage: {
              prompt_tokens: promptTokens ?? 0,
              completion_tokens: completionTokens ?? 0,
              total_tokens: (promptTokens ?? 0) + (completionTokens ?? 0),
              ...(numberOf(usage.cacheReadTokens) !== undefined
                ? { prompt_tokens_details: { cached_tokens: numberOf(usage.cacheReadTokens) } }
                : {}),
            },
          },
        } as JsonRpcMessage);
      }
    }
    if (status === "failed") {
      this.emit("message", {
        method: "turn/failed",
        params: {
          threadId,
          turnId,
          turn: { id: turnId, threadId, status: "failed" },
          error: errorMessage ?? "Cline run failed",
        },
      } as JsonRpcMessage);
    } else {
      this.emit("message", {
        method: "turn/completed",
        params: {
          threadId,
          turnId,
          turn: { id: turnId, threadId, status, completedAt: Math.floor(Date.now() / 1000) },
        },
      } as JsonRpcMessage);
    }
  }
}

/** Real progress line for a run snapshot (`heartbeat` placeholders ignored). */
function meaningfulTeamActivity(run: Record<string, JsonValue>): string {
  for (const key of ["lastProgressMessage", "currentActivity"]) {
    const value = run[key];
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    if (/^(heartbeat|idle|queued|running|pending|pong)$/i.test(text)) continue;
    return text;
  }
  return "";
}

function recordOf(value: unknown): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

/** Tool inputs/outputs arrive as objects or JSON strings depending on the tool. */
function parseJsonLoose(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Extract the user's text from Codex composer params (prompt/input/text). */
function extractTurnText(p: Record<string, JsonValue>): string {
  if (typeof p.prompt === "string" && p.prompt.trim()) return p.prompt;
  if (typeof p.text === "string" && p.text.trim()) return p.text;
  const input = p.input;
  if (typeof input === "string" && input.trim()) return input;
  if (Array.isArray(input)) {
    const parts: string[] = [];
    for (const entry of input) {
      if (typeof entry === "string") parts.push(entry);
      else {
        const item = recordOf(entry);
        if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
      }
    }
    return parts.join("\n").trim();
  }
  return "";
}

/** Map one persisted hub message onto a workbench history item. */
function mapHubMessage(entry: JsonValue, threadId: string): JsonValue[] {
  const message = recordOf(entry);
  const role = typeof message.role === "string" ? message.role : "";
  const content = Array.isArray(message.content) ? message.content : [];
  // Tool records persist alongside (or instead of) text: keep both so
  // history reloads retain the tool cards.
  const tools = projectHubResultToolItems(content, threadId);
  const text = content
    .map((part) => {
      const block = recordOf(part);
      return block.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .join("");
  if (!text) return tools;
  const id = typeof message.id === "string" ? message.id : randomUUID();
  if (role === "user") {
    // Hub wraps prompts as <user_input mode="act">...</user_input>; unwrap
    // for display so history doesn't show the framing tags.
    const unwrapped = text.replace(/^<user_input[^>]*>/, "").replace(/<\/user_input>$/, "");
    return [...tools, {
      type: "userMessage",
      id,
      threadId,
      content: [{ type: "text", text: unwrapped }],
      status: "completed",
    } as unknown as JsonValue];
  }
  if (role === "assistant") {
    return [...tools, {
      type: "agentMessage",
      id,
      threadId,
      content: text,
      role: "assistant",
      status: "completed",
    } as unknown as JsonValue];
  }
  return tools;
}

/**
 * Task/subagent tool discriminator (mirrors grok's is_task_tool_id line):
 * cline's subagent spawner is `new_task`; bare `task` / `spawn_subagent`
 * covered for symmetry. Team mode (hub ≥3.0.73) delegates through
 * `team_spawn_teammate` (spawn) and `team_run_task` (dispatch); both
 * project as collab so the waterfall shows subagent cards instead of raw
 * tool names. `team_task` (task-board CRUD) and `team_mission_log` stay
 * plain tools — they are bookkeeping, not agents.
 */
export function isClineTaskTool(name: unknown): boolean {
  const trimmed = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (!trimmed) return false;
  // Full-name match first: the bare-segment logic below would reduce
  // team_spawn_teammate to "teammate" and team_task to "task".
  const compactFull = trimmed.replace(/[_-]+/g, "");
  if (compactFull === "teamruntask" || compactFull === "teamspawnteammate") return true;
  if (compactFull === "teamtask" || compactFull === "teammissionlog") return false;
  if (compactFull === "spawnagent") return true;
  const bare = trimmed.split(/[/:._-]{1,2}/).pop() ?? trimmed;
  const compact = bare.replace(/[_-]+/g, "");
  return compact === "task" || compact === "newtask" || compact === "spawnsubagent";
}

/** Best-effort task brief out of a task tool's input (key names vary). */
function clineTaskPrompt(input: Record<string, JsonValue>, existing?: Record<string, JsonValue>): string {
  const candidates: unknown[] = [
    input.description, input.task, input.rolePrompt, input.systemPrompt,
    input.message, input.prompt, input.instruction, input.goal,
    existing?.prompt, existing?.message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 4000);
  }
  return "";
}

/**
 * Role label out of a spawn_agent-style system prompt ("你是XX专家…").
 * Falls back to "" so the caller can keep the started event's agent name.
 */
function clineRoleFromSystemPrompt(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = value.match(/你是\s*(.{2,40}?)(专家|专员|工程师|助手|顾问|研究员)/);
  if (!match) return "";
  return `${match[1]?.trim()}${match[2]}`.slice(0, 120);
}

/** Agent role label for a task tool call. */
function clineTaskRole(input: Record<string, JsonValue>, fallbackName: string): string {
  for (const key of ["agentId", "subagent_type", "agent", "agentName", "mode"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
  }
  const fromPrompt = clineRoleFromSystemPrompt(input.systemPrompt ?? input.rolePrompt);
  if (fromPrompt) return fromPrompt;
  return fallbackName && fallbackName !== "Tool" ? fallbackName : "subagent";
}

/**
 * One-line form for a team tool receipt. Keeps a real message/report when the
 * output carries one, and otherwise renders `{agentId, status}` as
 * `agent-arch · spawned` instead of raw JSON.
 */
function collabReceiptLine(output: Record<string, JsonValue>): string | null {
  for (const key of ["message", "result", "output", "report", "text"]) {
    const value = output[key];
    if (typeof value === "string" && value.trim()) {
      return key === "message" ? value.trim() : summarizeCollabOutput(value);
    }
  }
  const agentId = typeof output.agentId === "string" ? output.agentId.trim() : "";
  const status = typeof output.status === "string" ? output.status.trim() : "";
  if (agentId && status) return `${agentId} · ${status}`;
  return null;
}

/**
 * Main-transcript cap for subagent reports: the delegation card keeps a
 * summary while the full transcript lives in the child card's read-on-open
 * projection. Without this a 10KB report floods the parent waterfall.
 */
function summarizeCollabOutput(text: string): string {
  if (text.length <= 2000) return text;
  return `${text.slice(0, 2000)}\n\n…(完整报告见子任务卡片)`;
}

/**
 * Project hub tool records (terminal `result.messages` entries or persisted
 * message blocks) onto `toolCall` items. Shape-tolerant: the hub's exact
 * tool schema is only partially documented, so anything with a tool-ish
 * type marker — or a name plus params — counts. Unknown shapes return null
 * and stay invisible rather than rendering garbage.
 */
function projectHubResultToolItems(messages: unknown, threadId: string, turnId?: string): JsonValue[] {
  if (!Array.isArray(messages)) return [];
  const items: JsonValue[] = [];
  const pending = new Map<string, Record<string, JsonValue>>();
  const flush = (item: Record<string, JsonValue>) => {
    items.push(item as unknown as JsonValue);
  };
  for (const entry of messages) {
    const block = recordOf(entry as JsonValue);
    const blocks = Array.isArray(block.content) ? block.content : [block];
    for (const part of blocks) {
      const b = recordOf(part as JsonValue);
      const type = typeof b.type === "string" ? b.type : "";
      const name = typeof b.name === "string" && b.name
        ? b.name
        : typeof b.tool === "string" && b.tool ? b.tool : undefined;
      const params = recordOf(b.input ?? b.arguments ?? (b as Record<string, JsonValue>).args);
      const looksToolUse = type === "tool_use" || type === "toolCall" || type === "tool_call" || type === "tool"
        || (!type && name !== undefined && ((b as Record<string, JsonValue>).input !== undefined || (b as Record<string, JsonValue>).arguments !== undefined || (b as Record<string, JsonValue>).args !== undefined));
      const looksToolResult = type === "tool_result" || type === "toolResult" || type === "tool_completed";
      if (looksToolUse) {
        const id = typeof b.id === "string" && b.id ? b.id : `cline-${turnId ?? threadId}-tool-${randomUUID()}`;
        const taskCall = isClineTaskTool(name);
        const prompt = taskCall ? clineTaskPrompt(params) : "";
        const agentRole = taskCall ? clineTaskRole(params, name ?? "") : "";
        const item: Record<string, JsonValue> = taskCall ? {
          type: "collabAgentToolCall",
          id,
          threadId,
          ...(turnId ? { turnId } : {}),
          name: name ?? agentRole,
          tool: "task",
          toolName: name ?? agentRole,
          agentId: id,
          agentName: agentRole,
          agentRole,
          taskName: agentRole,
          ...(prompt ? { prompt, message: prompt } : {}),
          senderThreadId: threadId,
          receiverThreadIds: [id],
          agentStatus: "completed",
          input: params,
          arguments: params,
          status: "completed",
        } : {
          type: "toolCall",
          id,
          threadId,
          ...(turnId ? { turnId } : {}),
          name: name ?? "Tool",
          tool: name ?? "Tool",
          toolName: name ?? "Tool",
          input: params,
          arguments: params,
          status: "completed",
        };
        pending.set(id, item);
        flush(item);
        continue;
      }
      if (looksToolResult) {
        const ref = typeof b.tool_use_id === "string" && b.tool_use_id
          ? b.tool_use_id
          : typeof b.id === "string" ? b.id : "";
        const target = (ref && pending.get(ref)) || null;
        const rawOutput = b.output ?? b.result ?? b.text ?? b.content ?? "";
        const outputText = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
        if (target) {
          if (outputText) {
            const shown = target.type === "collabAgentToolCall" ? summarizeCollabOutput(outputText) : outputText;
            target.output = shown.slice(0, 4000);
            target.result = { content: shown.slice(0, 4000) } as unknown as JsonValue;
          }
          if (b.is_error === true) target.status = "failed";
        } else if (outputText && ref) {
          const taskCall = isClineTaskTool(name);
          const prompt = taskCall ? clineTaskPrompt(params) : "";
          const agentRole = taskCall ? clineTaskRole(params, name ?? "") : "";
          const shown = taskCall ? summarizeCollabOutput(outputText) : outputText;
          flush(taskCall ? {
            type: "collabAgentToolCall",
            id: ref,
            threadId,
            ...(turnId ? { turnId } : {}),
            name: name ?? agentRole,
            tool: "task",
            toolName: name ?? agentRole,
            agentId: ref,
            agentName: agentRole,
            agentRole,
            taskName: agentRole,
            ...(prompt ? { prompt, message: prompt } : {}),
            senderThreadId: threadId,
            receiverThreadIds: [ref],
            agentStatus: b.is_error === true ? "failed" : "completed",
            input: params,
            arguments: params,
            output: shown.slice(0, 4000),
            result: { content: shown.slice(0, 4000) },
            status: b.is_error === true ? "failed" : "completed",
          } : {
            type: "toolCall",
            id: ref,
            threadId,
            ...(turnId ? { turnId } : {}),
            name: name ?? "Tool",
            tool: name ?? "Tool",
            toolName: name ?? "Tool",
            input: params,
            arguments: params,
            output: outputText.slice(0, 4000),
            result: { content: outputText.slice(0, 4000) },
            status: b.is_error === true ? "failed" : "completed",
          });
        }
      }
    }
  }
  return items;
}

function buildTurnsFromItems(items: JsonValue[]): Array<Record<string, JsonValue>> {
  const turns: Array<Record<string, JsonValue>> = [];
  let current: Record<string, JsonValue> | null = null;
  for (const item of items) {
    const record = recordOf(item);
    if (record.type === "userMessage") {
      current = { id: randomUUID(), status: "completed", items: [item] } as Record<string, JsonValue>;
      turns.push(current);
    } else if (current) {
      (current.items as JsonValue[]).push(item);
    }
  }
  return turns;
}
