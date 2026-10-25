import type { JsonRpcNotification, JsonValue } from "@codex-ui/shared";
import type {
  GrokEvent,
  GrokThoughtEvent,
  GrokTextEvent,
  GrokToolCallEvent,
  GrokToolCallUpdateEvent,
  GrokEndEvent,
  GrokErrorEvent,
} from "./grokCompatibleProtocol.js";

export type GrokProjectedEvent =
  | { kind: "turn/started"; threadId: string; turnId: string }
  | { kind: "turn/completed"; threadId: string; turnId: string }
  | { kind: "turn/failed"; threadId: string; turnId: string; error?: string }
  | { kind: "turn/interrupted"; threadId: string; turnId: string }
  | { kind: "item/agentMessage/delta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/reasoning/textDelta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/started"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | { kind: "item/completed"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | { kind: "system/init"; threadId: string; sessionId: string; cwd?: string; tools?: string[] };

export interface GrokProjectorContext {
  threadId: string;
  turnId: string;
  sessionId?: string;
  status: "running" | "completed" | "failed" | "interrupted";
  textSegmentSeq: number;
  currentAssistantItemId: string;
  currentAssistantText: string;
  hasStartedCurrentAssistantMessage: boolean;
  hasCompletedCurrentAssistantMessage: boolean;
  hasStartedCurrentReasoning: boolean;
  hasCompletedCurrentReasoning: boolean;
  currentReasoningItemId: string;
  currentReasoningText: string;
  assistantItemId: string;
  reasoningItemId: string;
  assistantText: string;
  reasoningText: string;
  hasStartedTurn: boolean;
  hasStartedAgentMessage: boolean;
  activeToolItems: Map<string, Record<string, JsonValue>>;
  /** task 工具 hold-back 后已发出 started 的 callId，避免重复 started。 */
  emittedTaskStarts: Set<string>;
}

export function createGrokProjectorContext(threadId: string, turnId: string): GrokProjectorContext {
  const initialAssistantItemId = `grok-msg-${turnId}-0`;
  const initialReasoningItemId = `grok-thought-${turnId}-0`;
  return {
    threadId,
    turnId,
    status: "running",
    textSegmentSeq: 0,
    currentAssistantItemId: initialAssistantItemId,
    currentAssistantText: "",
    hasStartedCurrentAssistantMessage: false,
    hasCompletedCurrentAssistantMessage: false,
    hasStartedCurrentReasoning: false,
    hasCompletedCurrentReasoning: false,
    currentReasoningItemId: initialReasoningItemId,
    currentReasoningText: "",
    assistantItemId: initialAssistantItemId,
    reasoningItemId: initialReasoningItemId,
    assistantText: "",
    reasoningText: "",
    hasStartedTurn: false,
    hasStartedAgentMessage: false,
    activeToolItems: new Map(),
    emittedTaskStarts: new Set(),
  };
}

function startNewGrokSegment(ctx: GrokProjectorContext): void {
  ctx.textSegmentSeq += 1;
  ctx.currentAssistantItemId = `grok-msg-${ctx.turnId}-${ctx.textSegmentSeq}`;
  ctx.currentAssistantText = "";
  ctx.currentReasoningItemId = `grok-thought-${ctx.turnId}-${ctx.textSegmentSeq}`;
  ctx.currentReasoningText = "";
  ctx.assistantItemId = ctx.currentAssistantItemId;
  ctx.reasoningItemId = ctx.currentReasoningItemId;
  ctx.hasStartedCurrentAssistantMessage = false;
  ctx.hasCompletedCurrentAssistantMessage = false;
  ctx.hasStartedCurrentReasoning = false;
  ctx.hasCompletedCurrentReasoning = false;
}

// 对齐 mini(muse)/opencode：思考独立成 reasoning 项，正文只含 text，
// 瀑布流靠 reasoningBuffer 把思考挂到下一条 agentMessage 的 Thinking 位，
// 正文不再重复思考内容。
function completeActiveReasoning(
  ctx: GrokProjectorContext,
  events: GrokProjectedEvent[],
  status: "completed" | "failed" | "interrupted" = "completed"
): void {
  if (ctx.hasStartedCurrentReasoning && !ctx.hasCompletedCurrentReasoning) {
    ctx.hasCompletedCurrentReasoning = true;
    events.push({
      kind: "item/completed",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        type: "reasoning",
        id: ctx.currentReasoningItemId,
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        title: "Reasoning",
        text: ctx.currentReasoningText,
        status,
        completedAt: Math.floor(Date.now() / 1000),
      },
    });
  }
}

/**
 * Grok 原生 task 工具的线名（对齐 grok-build `is_task_tool_id`）：
 * task | Task | spawn_subagent。命中后投影为 collabAgentToolCall，
 * 子 agent 视图（agent rail / all-agents 页）才能正确收敛。
 */
export function isGrokTaskToolName(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return false;
  const bare = trimmed.split(/[/:._-]{1,2}/).pop() ?? trimmed;
  const compact = bare.replace(/[_-]+/g, "");
  return compact === "task" || compact === "spawnsubagent";
}

function asNonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function collectGrokSubagentIds(value: unknown, into: Set<string>): void {
  if (into.size >= 8) return;
  if (typeof value === "string") {
    // 后台 spawn / auto-background 是纯文本（`subagent_id: <id>`），
    // 前台完成是结构化 JSON；两种都兼容。
    const patterns = [
      /subagent_ids?\s*[:=]\s*["']?([\w-]{4,128})["']?/gi,
      /task_ids?\s*[:=]\s*["']?([\w-]{4,128})["']?/gi,
    ];
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(value)) !== null && into.size < 8) {
        into.add(match[1]!);
      }
    }
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        collectGrokSubagentIds(JSON.parse(trimmed), into);
      } catch { /* 非 JSON 文本，忽略 */ }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (into.size >= 8) return;
      collectGrokSubagentIds(entry, into);
    }
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["subagent_id", "subagent_ids", "task_id", "task_ids", "resume_from", "resume_from_hint"]) {
      if (into.size >= 8) return;
      const direct = record[key];
      // 已按 key 定位：字符串/数组直接收（值本身不带 key 前缀，正则配不上）。
      if (typeof direct === "string") {
        if (/^[\w-]{4,128}$/.test(direct.trim())) into.add(direct.trim());
        continue;
      }
      if (Array.isArray(direct)) {
        for (const entry of direct) {
          if (into.size >= 8) break;
          if (typeof entry === "string" && /^[\w-]{4,128}$/.test(entry.trim())) into.add(entry.trim());
        }
        continue;
      }
      collectGrokSubagentIds(direct, into);
    }
    // 结构化完成输出里 id 藏在 output 字段时再深一层。
    if (into.size === 0) collectGrokSubagentIds(record.output, into);
  }
}

/** 从 tool_call_update 的 rawOutput 里提取子会话 id（subagent_id / task_id）。 */
export function extractGrokSubagentIds(rawOutput: unknown): string[] {
  const ids = new Set<string>();
  collectGrokSubagentIds(rawOutput, ids);
  return [...ids];
}

function buildGrokSubagentItem(
  threadId: string,
  turnId: string,
  callId: string,
  input: Record<string, unknown>,
  status: "in_progress" | "completed" | "failed",
  rawOutput?: unknown,
): Record<string, JsonValue> {
  const description = asNonEmptyText(input.description)
    ?? asNonEmptyText(input.title)
    ?? "";
  const prompt = asNonEmptyText(input.prompt) ?? "";
  const agentRole = asNonEmptyText(input.subagent_type)
    ?? asNonEmptyText(input.agent)
    ?? "subagent";
  const agentStatus = status === "in_progress" ? "running" : status;
  const receiverThreadIds = rawOutput === undefined ? [] : extractGrokSubagentIds(rawOutput);
  const childThreadId = receiverThreadIds.length === 1 ? receiverThreadIds[0]! : undefined;
  const message = status === "in_progress"
    ? (description || `${agentRole} running`)
    : status === "failed"
      ? (description || `${agentRole} failed`)
      : (description || `${agentRole} completed`);
  let outputText = "";
  if (typeof rawOutput === "string") outputText = rawOutput;
  else if (rawOutput && typeof rawOutput === "object") {
    try {
      outputText = JSON.stringify(rawOutput);
    } catch {
      outputText = "";
    }
  }
  outputText = outputText.trim().slice(0, 6000);
  return {
    type: "collabAgentToolCall",
    id: callId,
    threadId,
    turnId,
    tool: "task",
    status,
    senderThreadId: threadId,
    receiverThreadIds: receiverThreadIds as JsonValue,
    prompt,
    agentId: childThreadId ?? callId,
    ...(childThreadId ? { agentThreadId: childThreadId } : {}),
    agentName: description || agentRole,
    agentRole,
    agentStatus,
    agentsStates: childThreadId
      ? { [childThreadId]: { status: agentStatus, message } } as JsonValue
      : {} as JsonValue,
    input: input as JsonValue,
    arguments: input as JsonValue,
    ...(outputText ? { output: outputText } : {}),
  };
}

function completeActiveAssistantMessage(
  ctx: GrokProjectorContext,
  events: GrokProjectedEvent[],
  status: "completed" | "failed" | "interrupted" = "completed"
): void {
  if (
    ctx.hasStartedCurrentAssistantMessage &&
    !ctx.hasCompletedCurrentAssistantMessage
  ) {
    ctx.hasCompletedCurrentAssistantMessage = true;
    events.push({
      kind: "item/completed",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        type: "agentMessage",
        id: ctx.currentAssistantItemId,
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        content: [{ type: "text", text: ctx.currentAssistantText, text_elements: [] }],
        text: ctx.currentAssistantText,
        role: "assistant",
        status,
        completedAt: Math.floor(Date.now() / 1000),
      },
    });
  }
}

export function projectGrokEvent(
  event: GrokEvent,
  ctx: GrokProjectorContext,
): GrokProjectedEvent[] {
  const events: GrokProjectedEvent[] = [];
  const { threadId, turnId } = ctx;

  if (ctx.status !== "running") {
    return events;
  }

  // Ensure turn/started is emitted on the first event if not already done
  if (!ctx.hasStartedTurn) {
    ctx.hasStartedTurn = true;
    events.push({
      kind: "turn/started",
      threadId,
      turnId,
    });
  }

  switch (event.type) {
    case "available_commands": {
      // Preamble event
      break;
    }

    case "thought": {
      const thought = event as GrokThoughtEvent;
      if (thought.data) {
        if (ctx.hasCompletedCurrentAssistantMessage || ctx.hasCompletedCurrentReasoning) {
          startNewGrokSegment(ctx);
        }
        if (!ctx.hasStartedCurrentReasoning) {
          ctx.hasStartedCurrentReasoning = true;
          events.push({
            kind: "item/started",
            threadId,
            turnId,
            item: {
              type: "reasoning",
              id: ctx.currentReasoningItemId,
              threadId,
              turnId,
              title: "Reasoning",
              text: "",
              status: "inProgress",
              startedAt: Math.floor(Date.now() / 1000),
              firstTokenAt: Math.floor(Date.now() / 1000),
            },
          });
        }
        ctx.reasoningText += thought.data;
        ctx.currentReasoningText += thought.data;
        events.push({
          kind: "item/reasoning/textDelta",
          threadId,
          turnId,
          itemId: ctx.currentReasoningItemId,
          delta: thought.data,
        });
      }
      break;
    }

    case "text": {
      const text = event as GrokTextEvent;
      if (text.data) {
        ctx.assistantText += text.data;
        ctx.hasStartedAgentMessage = true;
        // mini/opencode 口径：正文开始即先结算思考，思考挂到本段 Thinking 位。
        completeActiveReasoning(ctx, events);

        if (ctx.hasCompletedCurrentAssistantMessage) {
          startNewGrokSegment(ctx);
        }

        if (!ctx.hasStartedCurrentAssistantMessage) {
          ctx.hasStartedCurrentAssistantMessage = true;
          events.push({
            kind: "item/started",
            threadId,
            turnId,
            item: {
              type: "agentMessage",
              id: ctx.currentAssistantItemId,
              threadId,
              turnId,
              role: "assistant",
              status: "inProgress",
              text: "",
              content: [],
              startedAt: Math.floor(Date.now() / 1000),
            },
          });
        }

        ctx.currentAssistantText += text.data;
        events.push({
          kind: "item/agentMessage/delta",
          threadId,
          turnId,
          itemId: ctx.currentAssistantItemId,
          delta: text.data,
        });
      }
      break;
    }

    case "tool_call": {
      completeActiveReasoning(ctx, events);
      if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
        completeActiveAssistantMessage(ctx, events);
      }
      const tc = event as GrokToolCallEvent;
      const callId = tc.toolCallId || `grok-tool-${turnId}-${Date.now()}`;
      let toolName = tc.toolName || tc.title || "tool";
      const inputObj = (tc.rawInput ?? {}) as Record<string, any>;
      if (toolName === "use_tool" && inputObj && typeof inputObj === "object") {
        const innerName = inputObj.tool_name || inputObj.toolName || inputObj.name;
        if (typeof innerName === "string" && innerName) {
          toolName = innerName;
        }
      }
      let resolvedInput: Record<string, any> = { ...inputObj };
      if (inputObj && typeof inputObj.tool_input === "object" && inputObj.tool_input !== null) {
        resolvedInput = {
          ...resolvedInput,
          ...inputObj.tool_input,
        };
      }
      if (isGrokTaskToolName(toolName)) {
        // 对齐 opencode 口径：子会话 id 在 update 里才落地，started 时
        // receiver 未知，先 hold 住，避免幽灵 tab；terminal update 必发。
        const pending = buildGrokSubagentItem(threadId, turnId, callId, resolvedInput, "in_progress");
        ctx.activeToolItems.set(callId, pending);
        break;
      }
      const toolItem: Record<string, JsonValue> = {
        type: "toolCall",
        id: callId,
        threadId,
        turnId,
        name: toolName,
        tool: toolName,
        toolName,
        input: resolvedInput as JsonValue,
        arguments: resolvedInput as JsonValue,
        status: "in_progress",
      };
      ctx.activeToolItems.set(callId, toolItem);
      events.push({ kind: "item/started", threadId, turnId, item: toolItem });
      break;
    }

    case "tool_call_update": {
      const tcu = event as GrokToolCallUpdateEvent;
      const callId = tcu.toolCallId;
      const existing = ctx.activeToolItems.get(callId) ?? {
        type: "toolCall",
        id: callId,
        threadId,
        turnId,
        name: "tool",
        tool: "tool",
        toolName: "tool",
        input: {},
        arguments: {},
      };
      if (existing.type === "collabAgentToolCall") {
        const terminal = tcu.status === "completed" ? "completed" : tcu.status === "failed" ? "failed" : undefined;
        const input = ((existing.input ?? existing.arguments) && typeof (existing.input ?? existing.arguments) === "object"
          ? (existing.input ?? existing.arguments)
          : {}) as Record<string, unknown>;
        const status = terminal ?? "in_progress";
        const updated = buildGrokSubagentItem(threadId, turnId, callId, input, status, tcu.rawOutput);
        ctx.activeToolItems.set(callId, updated);
        const receivers = updated.receiverThreadIds as unknown[];
        const linked = Array.isArray(receivers) && receivers.length > 0;
        if (terminal) {
          // terminal update 必发（即使 id 没链上也保留卡片，不丢数）。
          events.push({ kind: "item/completed", threadId, turnId, item: updated });
        } else if (linked && !ctx.emittedTaskStarts.has(callId)) {
          ctx.emittedTaskStarts.add(callId);
          events.push({ kind: "item/started", threadId, turnId, item: updated });
        }
        break;
      }
      const isDone = tcu.status === "completed" || tcu.status === "failed";
      const updated: Record<string, JsonValue> = {
        ...existing,
        turnId,
        status: isDone ? (tcu.status === "failed" ? "failed" : "completed") : "in_progress",
        ...(tcu.rawOutput ? { output: tcu.rawOutput as JsonValue } : {}),
      };
      ctx.activeToolItems.set(callId, updated);
      if (isDone) {
        events.push({ kind: "item/completed", threadId, turnId, item: updated });
      }
      break;
    }

    case "usage": {
      completeActiveReasoning(ctx, events);
      if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
        completeActiveAssistantMessage(ctx, events);
      }
      break;
    }

    case "end": {
      const end = event as GrokEndEvent;
      ctx.sessionId = end.sessionId;

      // Emit system/init to notify session ID update
      events.push({
        kind: "system/init",
        threadId,
        sessionId: end.sessionId,
      });

      completeActiveReasoning(ctx, events);
      if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
        completeActiveAssistantMessage(ctx, events);
      }

      // An `end` frame is not always a clean finish. Verified against the
      // installed CLI: end.stopReason is one of end_turn | max_tokens |
      // max_turn_requests | refusal | cancelled (per-response reasons like
      // tool_use/pause_turn only appear on `usage` lines). Cap/abort reasons
      // must surface as failures (with the reason) instead of a silent
      // completed turn, and tools still in flight must hold the turn open.
      const unsettledTools = [...ctx.activeToolItems.values()].some((item) => {
        const status = typeof item.status === "string" ? item.status : "";
        return status === "in_progress" || status === "inProgress" || status === "started";
      });
      const stopReason = (end.stopReason ?? "").trim().toLowerCase();
      const cleanStop = stopReason === "" || stopReason === "end_turn";
      if (unsettledTools || !cleanStop) {
        ctx.status = "failed";
        const reason = unsettledTools
          ? `grok turn stopped (${end.stopReason || "unknown reason"}) with tools still running`
          : `grok turn stopped (${end.stopReason || "unknown reason"})`;
        events.push({
          kind: "turn/failed",
          threadId,
          turnId,
          error: reason,
        });
        break;
      }
      ctx.status = "completed";

      events.push({
        kind: "turn/completed",
        threadId,
        turnId,
      });
      break;
    }

    case "error": {
      const err = event as GrokErrorEvent;
      ctx.status = "failed";
      const errorText = err.message || "Grok execution failed";
      completeActiveReasoning(ctx, events, "failed");
      if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
        completeActiveAssistantMessage(ctx, events, "failed");
      } else if (!ctx.hasStartedAgentMessage && !ctx.hasStartedCurrentReasoning) {
        ctx.hasStartedAgentMessage = true;
        const msgId = ctx.assistantItemId || `grok-err-${turnId}`;
        events.push({
          kind: "item/started",
          threadId,
          turnId,
          item: {
            type: "agentMessage",
            id: msgId,
            threadId,
            turnId,
            role: "assistant",
            status: "inProgress",
            startedAt: Math.floor(Date.now() / 1000),
          },
        });
        events.push({
          kind: "item/completed",
          threadId,
          turnId,
          item: {
            type: "agentMessage",
            id: msgId,
            threadId,
            turnId,
            content: [{ type: "text", text: errorText, text_elements: [] }],
            text: errorText,
            role: "assistant",
            status: "failed",
            error: errorText,
            completedAt: Math.floor(Date.now() / 1000),
          },
        });
      }
      events.push({
        kind: "turn/failed",
        threadId,
        turnId,
        error: errorText,
      });
      break;
    }
  }

  return events;
}

export function toGrokNotification(event: GrokProjectedEvent): JsonRpcNotification | null {
  switch (event.kind) {
    case "turn/started":
      return {
        method: "turn/started",
        params: { threadId: event.threadId, turnId: event.turnId, turn: { id: event.turnId, threadId: event.threadId, status: "inProgress" } },
      };
    case "turn/completed":
      return {
        method: "turn/completed",
        params: { threadId: event.threadId, turnId: event.turnId, turn: { id: event.turnId, threadId: event.threadId, status: "completed" } },
      };
    case "turn/failed":
      return {
        method: "turn/failed",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          turn: { id: event.turnId, threadId: event.threadId, status: "failed", error: event.error ?? null },
          error: event.error ?? undefined,
        } as unknown as Record<string, JsonValue>,
      };
    case "turn/interrupted":
      return {
        method: "turn/interrupted",
        params: { threadId: event.threadId, turnId: event.turnId, turn: { id: event.turnId, threadId: event.threadId, status: "interrupted" } },
      };
    case "item/agentMessage/delta":
      return {
        method: "item/agentMessage/delta",
        params: { threadId: event.threadId, turnId: event.turnId, itemId: event.itemId, delta: event.delta },
      };
    case "item/reasoning/textDelta":
      return {
        method: "item/reasoning/textDelta",
        params: { threadId: event.threadId, turnId: event.turnId, itemId: event.itemId, delta: event.delta },
      };
    case "item/started":
      return {
        method: "item/started",
        params: { threadId: event.threadId, turnId: event.turnId, item: event.item },
      };
    case "item/completed":
      return {
        method: "item/completed",
        params: { threadId: event.threadId, turnId: event.turnId, item: event.item },
      };
    case "system/init":
      return {
        method: "grok/init",
        params: { threadId: event.threadId, sessionId: event.sessionId } as unknown as Record<string, JsonValue>,
      };
    default:
      return null;
  }
}

export function forceTerminateGrok(
  ctx: GrokProjectorContext,
  reason: "failed" | "interrupted" = "interrupted",
  error?: string
): GrokProjectedEvent[] {
  if (ctx.status !== "running") return [];
  ctx.status = reason;
  const events: GrokProjectedEvent[] = [];
  const errorText = error || (reason === "failed" ? "Process terminated abruptly" : undefined);
  completeActiveReasoning(ctx, events, reason === "interrupted" ? "interrupted" : "failed");
  if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
    completeActiveAssistantMessage(ctx, events, reason === "interrupted" ? "interrupted" : "failed");
  } else if (reason === "failed" && !ctx.hasStartedAgentMessage && !ctx.hasStartedCurrentReasoning && errorText) {
    const msgId = ctx.assistantItemId || `grok-err-${ctx.turnId}`;
    events.push({
      kind: "item/started",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        type: "agentMessage",
        id: msgId,
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        role: "assistant",
        status: "inProgress",
        startedAt: Math.floor(Date.now() / 1000),
      },
    });
    events.push({
      kind: "item/completed",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        type: "agentMessage",
        id: msgId,
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        content: [{ type: "text", text: errorText, text_elements: [] }],
        text: errorText,
        role: "assistant",
        status: "failed",
        error: errorText,
        completedAt: Math.floor(Date.now() / 1000),
      },
    });
  }
  events.push({
    kind: reason === "interrupted" ? "turn/interrupted" : "turn/failed",
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    error: errorText,
  });
  return events;
}
