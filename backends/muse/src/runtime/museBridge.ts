import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  EngineStatus,
  JsonRpcId,
  JsonValue,
  JsonRpcFailure,
  ChannelGroupConfig,
  ProviderConfig,
} from "@codex-ui/shared";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import {
  MuseCompatibleRuntime,
  findMuseChildSessionLog,
  readMuseChildSessionLog,
  type MuseChildSessionProjection,
} from "./museCompatibleRuntime.js";
import { toMuseNotification, museAssistantItemId, type MuseProjectedEvent } from "./museCompatibleTurnProjector.js";
import { probeMuseCliCommand, findMuseBin, isMuseLoggedIn } from "./museCompatibleProbe.js";
import { loadMuseSaVmSkill, type MusePreloadedSkill } from "./museSkillPreload.js";
import { bootstrapProjectSaVmAssets, mapSaVmToolReferences, MUSE_SA_VM_MCP_TOOL_NAME, waitForProjectSaVmAssets } from "@cxu/sdk-backend";
import { pluginHostServices, resolveSaVmMcpScriptPath } from "@cxu/sdk-backend";
import { pageThreadHistory } from "@cxu/sdk-backend";

export const MUSE_OFFICIAL_PROVIDER_ID = "muse-official";
export const MUSE_DEFAULT_MODEL = "muse-spark-1.3";

export function buildMuseOfficialProvider(): ProviderConfig {
  const models = [MUSE_DEFAULT_MODEL];
  const group: ChannelGroupConfig = {
    id: "default",
    name: "default",
    baseUrl: "https://dev.meta.ai",
    kind: "text",
    status: "enabled",
    groupRatio: 1,
    models,
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    remark: "Muse 官方直连 (muse login / META_API_KEY)",
    authType: "none",
    credentialMode: "group",
    keyMode: "single",
    keys: [],
  };
  return {
    id: MUSE_OFFICIAL_PROVIDER_ID,
    name: "Muse 官方",
    kind: "responsesRelay",
    serviceProvider: { id: "meta-muse", name: "Meta Muse" },
    baseUrl: "https://dev.meta.ai",
    defaultModel: MUSE_DEFAULT_MODEL,
    nativeModels: models,
    modelAliases: [],
    stationType: "official",
    channelMode: "fast",
    remark: "Muse Official (Meta login)",
    groups: [group],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export interface MuseRelayTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface MuseSessionSnapshot {
  threadId: string;
  ownerId?: string;
  museSessionId?: string;
  preview?: string;
  model?: string;
  effort?: string;
  developerInstructions?: string;
  cwd?: string;
  providerId?: string;
  groupId?: string;
  goalObjective?: string | null;
  goalStatus?: string | null;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
}

export interface MuseBridgeOptions {
  resolveRelayTarget?: (providerId: string, groupId?: string, model?: string) => Promise<MuseRelayTarget | undefined>;
  onSnapshot?: (snapshot: MuseSessionSnapshot) => void;
  loadSnapshot?: (threadId: string, ownerId?: string) => MuseSessionSnapshot | null;
  loadMetadata?: (threadId: string, ownerId?: string) => Pick<MuseSessionSnapshot, "threadId" | "museSessionId" | "model" | "cwd"> | null;
}

interface MuseSession {
  threadId: string;
  ownerId?: string;
  cwd: string;
  museSessionId?: string;
  model?: string;
  effort?: string;
  developerInstructions?: string;
  providerId?: string;
  groupId?: string;
  preview?: string;
  goalObjective?: string | null;
  goalStatus?: string | null;
  activeTurnId?: string;
  runtime?: MuseCompatibleRuntime;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
}

export interface MusePersistedSessionLike {
  messages: JsonValue[];
}

/**
 * 按 id 落盘单行（started 不存在才追加，completed 按 id 原位替换）。
 * 盲目 push 会导致同一 id 存两行，历史重开时回答显示两遍——回归禁区。
 */
export function upsertMuseSessionItem(
  session: MusePersistedSessionLike,
  kind: "item/started" | "item/completed",
  item: Record<string, unknown>,
): void {
  if (!item || typeof item.id !== "string") return;
  const idx = session.messages.findIndex((m: unknown) =>
    !!m && typeof m === "object" && (m as Record<string, unknown>).id === item.id);
  if (kind === "item/started") {
    if (idx < 0) session.messages.push(item as unknown as JsonValue);
  } else if (idx >= 0) {
    session.messages[idx] = item as unknown as JsonValue;
  } else {
    session.messages.push(item as unknown as JsonValue);
  }
}

/**
 * 投影批次 → 通知列表（纯函数，可单测）。
 * turn 级事件由 turn 收尾统一发射，这里跳过，避免 turn/completed 重复。
 */
export function applyMuseProjectedBatch(
  session: MusePersistedSessionLike,
  batched: unknown,
): Array<{ method: string; params: Record<string, unknown> }> {
  const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
  const list = Array.isArray(batched) ? (batched as MuseProjectedEvent[]) : [];
  for (const evt of list) {
    try {
      if (!evt || typeof (evt as { kind?: unknown }).kind !== "string") continue;
      const kind = (evt as { kind: string }).kind;
      if (kind === "turn/completed" || kind === "turn/failed" || kind === "turn/started") continue;
      const notif = toMuseNotification(evt as MuseProjectedEvent) as unknown as { method: string; params: Record<string, unknown> };
      const item = notif.params?.item as Record<string, unknown> | undefined;
      if ((kind === "item/started" || kind === "item/completed") && item) {
        upsertMuseSessionItem(session, kind, item);
      }
      notifications.push(notif);
    } catch { /* 单事件投影失败不影响其他行 */ }
  }
  return notifications;
}

/**
 * 学自 opencode/agy：跨 turn 的工具指令必须前置到 executionPrompt，
 * 不能赌模型去读 skill 文件。Muse 经 MCP 加载工具，会话里只有
 * `mcp__<server>__<tool>` 全名；模型高频剥掉前缀误调裸名（如 sa_vm_run），
 * 必报 unknown tool（verified 2026-10-13）。此规则每 turn 置顶。
 */
export const MUSE_MCP_NAMING_RULE = [
  "[MCP tool naming - hard rule]",
  "Workspace tools are loaded via MCP: always call them by their FULL session names exactly as listed (e.g. `mcp__sa_vm__sa_vm_run`); bare un-prefixed tool names do not exist and fail with \"unknown tool\".",
  "If a call fails with unknown tool, retry ONCE with `mcp__sa_vm__sa_vm_run` and the identical JSON args - never retry the bare name, never switch topics, never ask what to do. Never strip the `mcp__<server>__` prefix.",
  "Actions `list_dir`, `read_file`, `read_lines`, `count_lines`, `file_info`, `grep_search`, `find_files`, `edit_file`, `write_file`, `apply_patch` have NO bare tool: call them ONLY as `mcp__sa_vm__sa_vm_run({ action: 'list_dir', ... })`. Bare `read_file`/`edit_file`/`write_file`/`search`/`workflow` in the tool list are DIFFERENT native tools with different arguments - never use them for `action`-routed calls.",
  "Every sa-vm call MUST carry `action` plus its required fields: e.g. `mcp__sa_vm__sa_vm_run({ \"action\": \"list_dir\", \"dir\": \".\" })`, `mcp__sa_vm__sa_vm_run({ \"action\": \"read_file\", \"path\": \"package.json\" })`, `mcp__sa_vm__sa_vm_run({ \"action\": \"grep_search\", \"query\": \"foo\", \"dir\": \".\" })`. WRONG: `{}`. An empty `{}` call auto-runs `list_dir('.')` as a probe fallback — do NOT treat that directory listing as the answer and do NOT resend `{}`; send ONE full-argument call instead. When unsure what to call first, default to `list_dir` with `dir: \".\"`.",
  "Do not invent `default.` or `functions.` prefixes. For large files, locate symbols with `grep_search`/`file_outline` and read a bounded range with `read_lines` plus `start_line`/`end_line`; a whole-file size rejection is NOT tool unavailability. Never retry the same rejected whole-file read.",
].join("\n");

export const MUSE_EXECUTION_DIRECTIVE = [
  "[Execution Directives - Crucial]",
  "1. Before any workspace tool call, read and follow the [Preloaded Skill: sa-vm] below when present; it was loaded by the host before execution, so no read_skill call is needed for that skill. Then execute the user request with the documented full tool name and complete arguments. Never guess tool names or schemas. For explanation-only requests, answer directly without unnecessary tool calls.",
  "2. DO NOT output conversational acknowledgments (such as 'Ready', 'Acknowledged', or asking 'What task should I work on?') or preamble/announcements (such as '我能...', '现在开始...', '让我来...') BEFORE calling tools. If tools are needed, call tools FIRST with NO preceding text. Output explanations, conclusions, or answers ONLY AFTER tool execution completes.",
  MUSE_MCP_NAMING_RULE,
].join("\n");

/** 临时关闭 sa-vm MCP：CODEX_MUSE_DISABLE_SA_VM=1 时不挂载、不注入 sa-vm 规则，Muse 只用原生工具。 */
export const MUSE_SA_VM_DISABLED = process.env.CODEX_MUSE_DISABLE_SA_VM === "1";

/**
 * The sa-vm MCP is mounted per turn. Any turn that carries sa-vm developer
 * instructions (VM tools or enhance-only tools) must mount it and map the
 * instructions to the MCP name. Treating `vmEnabled: false` as "no tools"
 * here produced prompts that said "No sa-vm MCP server is attached" while the
 * tool block still told the model to call `sa_vm_run`, so every first call
 * failed with unknown tool.
 */
export function resolveMuseSaVmEnabled(
  record: Record<string, unknown>,
  developerInstructions?: string,
): boolean {
  if (MUSE_SA_VM_DISABLED) return false;
  return Boolean(developerInstructions?.trim())
    || record.vmEnabled === true
    || record.enhanceEnabled === true;
}

export function buildMuseExecutionPrompt(
  developerInstructions: string | undefined,
  cleanPrompt: string,
  options: { preloadedSkill?: MusePreloadedSkill; saVmEnabled?: boolean } = {},
): string {
  const userText = cleanPrompt.trim();
  const saVmEnabled = options.saVmEnabled !== false;
  const directives = saVmEnabled
    ? MUSE_EXECUTION_DIRECTIVE
    : "[Execution Directives - Crucial]\nUse only the native tools actually listed in this session, with their declared arguments. No sa-vm MCP server is attached.";
  const skillReference = saVmEnabled && options.preloadedSkill
    ? `\n\n[Preloaded Skill: sa-vm]\nSource: ${options.preloadedSkill.path}\n${options.preloadedSkill.content}\n[End Preloaded Skill: sa-vm]`
    : "";
  const executionRules = `${directives}${skillReference}`;

  if (developerInstructions && developerInstructions.trim()) {
    const mappedInstructions = !saVmEnabled ? developerInstructions.trim()
      : mapSaVmToolReferences(developerInstructions.trim(), MUSE_SA_VM_MCP_TOOL_NAME);

    if (userText) {
      return `[User Instruction]\n${userText}\n\n${executionRules}\n\n[Tool Reference & Constraints]\n${mappedInstructions}`;
    }
    return `${executionRules}\n\n[Tool Reference & Constraints]\n${mappedInstructions}`;
  }

  if (userText) {
    return `[User Instruction]\n${userText}\n\n${executionRules}`;
  }
  return executionRules;
}

export class MuseBridge extends EventEmitter implements CodexRuntimeClient {
  private options?: MuseBridgeOptions;
  private sessions = new Map<string, MuseSession>();
  /** child session id → cached log lookup (misses are cached briefly too). */
  private childLogCache = new Map<string, { path: string | null; at: number }>();
  private status: EngineStatus = {
    phase: "ready",
    transport: "stdio",
    message: "Muse CLI ready",
  };

  constructor(options?: MuseBridgeOptions) {
    super();
    this.options = options;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  async start(): Promise<EngineStatus> {
    const probe = probeMuseCliCommand(findMuseBin());
    if (!probe.available) {
      this.status = {
        phase: "error",
        transport: "stdio",
        message: probe.error ?? "Muse CLI not found",
      };
    } else {
      this.status = {
        phase: "ready",
        transport: "stdio",
        message: `Muse CLI v${probe.version ?? "unknown"} ready`,
      };
    }
    return this.status;
  }

  stop(): void {
    for (const session of this.sessions.values()) {
      session.runtime?.interrupt();
    }
    this.sessions.clear();
    this.status = {
      phase: "stopped",
      transport: "stdio",
      message: "Muse CLI stopped",
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

  /**
   * True when `threadId` is a workflow/native subagent session rather than a
   * CUX thread. Opening the child card must route thread/read to Muse; the
   * Codex bridge cannot load these ids and used to fail the whole tab with
   * `thread not loaded`.
   */
  hasChildThread(threadId: string): boolean {
    return Boolean(this.childSessionLogPath(threadId));
  }

  private childSessionLogPath(threadId: string): string | null {
    const cached = this.childLogCache.get(threadId);
    if (cached && Date.now() - cached.at < 5_000) return cached.path;
    const path = findMuseChildSessionLog(threadId);
    this.childLogCache.set(threadId, { path, at: Date.now() });
    return path;
  }

  private readChildSession(threadId: string): MuseChildSessionProjection | null {
    if (!this.childSessionLogPath(threadId)) return null;
    return readMuseChildSessionLog(threadId);
  }

  private childThreadSnapshot(
    threadId: string,
    projection: MuseChildSessionProjection,
    includeTurns: boolean,
  ): JsonValue {
    const turn = {
      id: threadId,
      threadId,
      status: projection.status === "running"
        ? "inProgress"
        : projection.status === "failed" ? "failed" : "completed",
      startedAt: projection.startedAt,
      items: projection.items,
    };
    return {
      thread: {
        id: threadId,
        sessionId: threadId,
        cliBackend: "muse",
        historyMode: "paginated",
        cwd: process.cwd(),
        status: { type: projection.status === "running" ? "running" : "idle" },
        turns: includeTurns ? [turn] : [],
      },
      items: includeTurns ? projection.items : [],
    } as unknown as JsonValue;
  }

  deleteSession(threadId: string): void {
    const session = this.sessions.get(threadId);
    if (session) {
      session.runtime?.interrupt();
      this.sessions.delete(threadId);
    }
  }

  restoreSession(snapshot: MuseSessionSnapshot): MuseSession {
    const existing = this.sessions.get(snapshot.threadId);
    if (existing) {
      if (snapshot.museSessionId) existing.museSessionId = snapshot.museSessionId;
      if (snapshot.preview) existing.preview = snapshot.preview;
      if (snapshot.turns) existing.turns = snapshot.turns;
      if (snapshot.messages) existing.messages = snapshot.messages;
      return existing;
    }
    const session: MuseSession = {
      threadId: snapshot.threadId,
      ownerId: snapshot.ownerId,
      museSessionId: snapshot.museSessionId,
      preview: snapshot.preview,
      model: snapshot.model,
      effort: snapshot.effort,
      developerInstructions: snapshot.developerInstructions,
      cwd: snapshot.cwd ?? process.cwd(),
      providerId: snapshot.providerId,
      groupId: snapshot.groupId,
      goalObjective: snapshot.goalObjective,
      goalStatus: snapshot.goalStatus,
      turns: snapshot.turns ?? [],
      messages: snapshot.messages ?? [],
    };
    this.sessions.set(session.threadId, session);
    return session;
  }

  private getOrRestoreSession(threadId: string, ownerId?: string): MuseSession | undefined {
    let session = this.sessions.get(threadId);
    if (!session && this.options?.loadSnapshot) {
      const snap = this.options.loadSnapshot(threadId, ownerId);
      if (snap) {
        session = this.restoreSession(snap);
      }
    }
    return session;
  }

  private persistSession(session: MuseSession): void {
    if (this.options?.onSnapshot) {
      this.options.onSnapshot({
        threadId: session.threadId,
        ownerId: session.ownerId,
        museSessionId: session.museSessionId,
        preview: session.preview,
        model: session.model,
        effort: session.effort,
        developerInstructions: session.developerInstructions,
        cwd: session.cwd,
        providerId: session.providerId,
        groupId: session.groupId,
        goalObjective: session.goalObjective,
        goalStatus: session.goalStatus,
        turns: session.turns,
        messages: session.messages,
      });
    }
  }

  private async resolveRelayTarget(
    providerId?: string,
    groupId?: string,
    model?: string,
  ): Promise<MuseRelayTarget | undefined> {
    const effective = providerId || MUSE_OFFICIAL_PROVIDER_ID;
    if (effective === MUSE_OFFICIAL_PROVIDER_ID) return undefined;
    if (this.options?.resolveRelayTarget) {
      return this.options.resolveRelayTarget(effective, groupId, model);
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
        const session: MuseSession = {
          threadId,
          ownerId,
          cwd,
          model: typeof record.model === "string" ? record.model : MUSE_DEFAULT_MODEL,
          effort: typeof record.reasoningEffort === "string" ? record.reasoningEffort : (typeof record.effort === "string" ? record.effort : undefined),
          providerId: typeof record.providerId === "string" ? record.providerId : MUSE_OFFICIAL_PROVIDER_ID,
          groupId: typeof record.groupId === "string" ? record.groupId : "default",
          turns: [],
          messages: [],
        };
        this.sessions.set(threadId, session);
        this.persistSession(session);
        bootstrapProjectSaVmAssets(cwd, threadId);
        return {
          thread: {
            id: threadId,
            cliBackend: "muse",
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
        const childProjection = !liveSession ? this.readChildSession(threadId) : null;
        if (!includeTurns && !liveSession && !childProjection && this.options?.loadMetadata) {
          const metadata = this.options.loadMetadata(threadId, ownerId);
          if (!metadata) return { thread: { id: threadId, cliBackend: "muse", status: { type: "idle" }, turns: [] }, items: [] } as unknown as JsonValue;
          return { thread: { ...metadata, id: threadId, cliBackend: "muse", historyMode: "paginated", status: { type: "idle" }, turns: [] }, items: [] } as unknown as JsonValue;
        }
        if (childProjection) {
          return this.childThreadSnapshot(threadId, childProjection, includeTurns);
        }
        const session = liveSession ?? this.getOrRestoreSession(threadId, ownerId);
        if (!session) {
          return {
            thread: {
              id: threadId,
              cliBackend: "muse",
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
            sessionId: session.museSessionId ?? threadId,
            preview: session.preview,
            model: session.model,
            cliBackend: "muse",
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
        if (!session) {
          const childProjection = this.readChildSession(threadId);
          if (childProjection) {
            const snapshot = this.childThreadSnapshot(threadId, childProjection, true) as Record<string, unknown>;
            const thread = snapshot.thread as Record<string, unknown>;
            return {
              turns: thread.turns,
              data: thread.turns,
              nextCursor: null,
            } as unknown as JsonValue;
          }
          return { turns: [], data: [], nextCursor: null } as unknown as JsonValue;
        }
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
        const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : (session?.cwd ?? process.cwd());
        const providerId = typeof record.providerId === "string" ? record.providerId : session?.providerId ?? MUSE_OFFICIAL_PROVIDER_ID;
        const groupId = typeof record.groupId === "string" ? record.groupId : session?.groupId ?? "default";
        const model = typeof record.model === "string" ? record.model : (session?.model ?? MUSE_DEFAULT_MODEL);
        const effort = typeof record.reasoningEffort === "string" ? record.reasoningEffort : (typeof record.effort === "string" ? record.effort : session?.effort);

        const saVmExplicitlyDisabled = record.vmEnabled === false && record.enhanceEnabled !== true;
        const developerInstructions = typeof record.developerInstructions === "string"
          ? record.developerInstructions.trim() || undefined
          : saVmExplicitlyDisabled ? undefined : session?.developerInstructions;

        if (!session) {
          session = {
            threadId,
            ownerId,
            cwd,
            model,
            effort,
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
          session.developerInstructions = developerInstructions;
          if (cwd) session.cwd = cwd;
        }

        // Dual-mode relay resolution: official needs login, relay is login-free.
        const relayTarget = await this.resolveRelayTarget(providerId, groupId, model);
        if (providerId !== MUSE_OFFICIAL_PROVIDER_ID && !relayTarget) {
          throw new Error(
            `Muse 中转配置缺失 (provider=${providerId} group=${groupId})，请检查中转站密钥与分组模型；官方模式请先运行 muse login 或设置 META_API_KEY`,
          );
        }
        if (providerId === MUSE_OFFICIAL_PROVIDER_ID && !isMuseLoggedIn() && !relayTarget) {
          throw new Error("Muse 官方模式未登录：请先运行 `muse login`，或设置 META_API_KEY，或切换到中转站分组");
        }

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
        const saVmEnabled = resolveMuseSaVmEnabled(record, developerInstructions);
        // When tools are off, drop the sa-vm instruction block entirely instead
        // of forwarding un-mapped bare names for tools that will not exist.
        const effectiveDeveloperInstructions = saVmEnabled ? developerInstructions : undefined;
        let saVmMcpScriptPath: string | undefined;
        let preloadedSkill: MusePreloadedSkill | undefined;
        if (saVmEnabled) {
          // Wait for skill generation, then load the actual thread-specific instructions
          // before starting the CLI. Do not depend on Spark deciding to call read_skill.
          await waitForProjectSaVmAssets(cwd);
          saVmMcpScriptPath = resolveSaVmMcpScriptPath(cwd) ?? undefined;
          if (!saVmMcpScriptPath) {
            await pluginHostServices().saVm.ensureProjectBundleInstalled(cwd);
            saVmMcpScriptPath = resolveSaVmMcpScriptPath(cwd) ?? undefined;
          }
          if (!saVmMcpScriptPath) throw new Error("Muse sa-vm MCP bundle is unavailable; refusing to start with unloaded tools");
          preloadedSkill = await loadMuseSaVmSkill(cwd, threadId);
        }
        const executionPrompt = MUSE_SA_VM_DISABLED
          ? cleanPrompt
          : buildMuseExecutionPrompt(effectiveDeveloperInstructions, cleanPrompt, { saVmEnabled, preloadedSkill });
        const turnId = randomUUID();
        const userContent: JsonValue[] = [];
        if (cleanPrompt) {
          userContent.push({ type: "text", text: cleanPrompt, text_elements: [] });
        }
        userContent.push(...attachmentBlocks);

        const userItem: Record<string, JsonValue> = {
          type: "userMessage",
          id: `muse-user-${turnId}`,
          turnId,
          threadId,
          text: cleanPrompt,
          content: userContent,
          role: "user",
          status: "completed",
          startedAt: Math.floor(Date.now() / 1000),
        };

        const liveSession: MuseSession = session;
        liveSession.messages.push(userItem);
        liveSession.turns.push({ id: turnId, status: "inProgress", createdAt: Date.now() });
        liveSession.activeTurnId = turnId;
        if (!liveSession.preview) {
          liveSession.preview = cleanPrompt.slice(0, 80);
        }
        this.persistSession(liveSession);

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

        const runtime = new MuseCompatibleRuntime();
        liveSession.runtime = runtime;
        // 唯一回答 item：文本流完全由投影器拥有（item/agentMessage/delta，
        // id 见 museAssistantItemId），这里不再把 runtime 的全量 "delta"
        // 转成第二份 item——否则同一回答出现两个 agentMessage，
        // 先到的顶住首位、后到的沉底，观感就是“回答在上、工具在下、回答重复”。
        const assistantItemId = museAssistantItemId(turnId);
        // "runtimeError" (never "error"): EventEmitter "error" without a
        // listener throws and would crash the server process.
        runtime.on("runtimeError", (err: unknown) => {
          console.warn(`[muse] exec runtime error thread=${threadId}:`, err instanceof Error ? err.message : String(err));
        });
        runtime.on("delta", () => {
          // 兼容保留：实时文本以 projected 事件为准，此处故意不再发射通知。
        });
        // 瀑布流投影事件：thinking/todo/subagent/mcp/skill/tool 全量透传，
        // 并落盘到 session.messages，保证历史重开也能看到。
        runtime.on("projected", (batched: unknown) => {
          for (const notif of applyMuseProjectedBatch(liveSession, batched)) {
            this.emit("notification", notif);
          }
        });

        void runtime.runExecTurn({
          prompt: executionPrompt,
          cwd: liveSession.cwd,
          threadId,
          turnId,
          sessionId: liveSession.museSessionId,
          model: relayTarget?.model ?? liveSession.model,
          effort: liveSession.effort,
          baseUrl: relayTarget?.baseUrl,
          relayApiKey: relayTarget?.apiKey,
          dangerouslyBypassPermissions: record.sandbox === "danger-full-access" || record.approvalPolicy === "never",
          saVmMcpScriptPath,
          token: process.env.CODEX_UI_TOKEN,
        }).then((result) => {
          const turnRecord = liveSession.turns.find((t) => t.id === turnId);
          if (turnRecord?.status === "interrupted") {
            liveSession.runtime = undefined;
            return;
          }
          if (liveSession.museSessionId !== result.sessionId && result.sessionId) {
            liveSession.museSessionId = result.sessionId;
          }
          const status = result.completed ? "completed" : "failed";
          // 失败时把真实 stderr 透给 UI：result.error 来自 runtime 的 stderrTail /
          // spawn 错误 / 超时，不再用硬编码 "muse exec turn failed" 吞掉细节。
          // 文本为空时用 error 兜底，避免前端只看到空 failed。
          const detailError = result.completed ? undefined : (result.error?.trim() || "muse exec turn failed");
          const displayText = result.text || detailError || "";

          // 检查会话中是否已有投影器产出的 agentMessage（支持前置思考与后置回答分段）
          const existingMsgs = liveSession.messages.filter(
            (m: any) => m && typeof m === "object" && m.turnId === turnId && m.type === "agentMessage",
          ) as Record<string, JsonValue>[];

          let terminalAssistantItem: Record<string, JsonValue>;
          const lastMsg = existingMsgs.length > 0 ? existingMsgs[existingMsgs.length - 1] : undefined;
          if (lastMsg) {
            // 已有投影消息：只更新末尾消息的终态与错误信息，绝不把全文倒灌进前置消息
            lastMsg.status = status;
            lastMsg.completedAt = Math.floor(Date.now() / 1000);
            if (detailError) {
              lastMsg.error = detailError;
              if (!lastMsg.text) {
                lastMsg.text = detailError;
                lastMsg.content = [{ type: "text", text: detailError }];
              }
            }
            terminalAssistantItem = lastMsg;
          } else {
            // 投影器未产出任何文本行（如 spawn/启动异常）：兜底补建单条回答
            terminalAssistantItem = {
              type: "agentMessage",
              id: assistantItemId,
              turnId,
              threadId,
              role: "assistant",
              status,
              text: displayText,
              content: [{ type: "text", text: displayText }],
              ...(detailError ? { error: detailError } : {}),
              completedAt: Math.floor(Date.now() / 1000),
            };
            upsertMuseSessionItem(liveSession, "item/completed", terminalAssistantItem);
          }
          if (turnRecord) turnRecord.status = status;
          if (liveSession.activeTurnId === turnId) liveSession.activeTurnId = undefined;
          liveSession.runtime = undefined;
          this.persistSession(liveSession);
          this.emit("notification", {
            method: "item/completed",
            params: { threadId, turnId, item: terminalAssistantItem },
          });
          this.emit("notification", {
            method: result.completed ? "turn/completed" : "turn/failed",
            params: {
              threadId,
              turnId,
              turn: { id: turnId, threadId, status, ...(detailError ? { error: detailError } : {}) },
              ...(result.completed ? {} : { error: detailError ?? "muse exec turn failed" }),
            },
          });
        }).catch((err) => {
          const turnRecord = liveSession.turns.find((t) => t.id === turnId);
          if (turnRecord?.status === "interrupted") {
            liveSession.runtime = undefined;
            return;
          }
          const errorMsg = String(err?.message || err);
          const errItem: Record<string, JsonValue> = {
            type: "agentMessage",
            id: assistantItemId,
            turnId,
            threadId,
            role: "assistant",
            status: "failed",
            text: errorMsg,
            content: [{ type: "text", text: errorMsg }],
            error: errorMsg,
            completedAt: Math.floor(Date.now() / 1000),
          };
          upsertMuseSessionItem(liveSession, "item/completed", errItem);
          if (turnRecord) turnRecord.status = "failed";
          if (liveSession.activeTurnId === turnId) liveSession.activeTurnId = undefined;
          liveSession.runtime = undefined;
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
          const turnId = session.activeTurnId;
          session.runtime?.interrupt();
          if (turnId) {
            session.activeTurnId = undefined;
            const turnEntry = session.turns.find((t) => t.id === turnId);
            if (turnEntry && turnEntry.status === "inProgress") {
              turnEntry.status = "interrupted";
            }
            const activeMsg = session.messages.find(
              (m): m is Record<string, JsonValue> =>
                !!m && typeof m === "object" && !Array.isArray(m) &&
                (m as Record<string, unknown>).turnId === turnId &&
                (m as Record<string, unknown>).role === "assistant" &&
                (m as Record<string, unknown>).status !== "completed",
            );
            if (activeMsg) {
              activeMsg.status = "interrupted";
            }
            this.persistSession(session);
            this.emit("notification", {
              method: "turn/interrupted",
              params: {
                threadId,
                turnId,
                turn: { id: turnId, threadId, status: "interrupted", completedAt: Math.floor(Date.now() / 1000) },
              },
            });
          }
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
            id: `muse-compact-${turnId}`,
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
