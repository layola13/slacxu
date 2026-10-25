import type { JsonRpcNotification, JsonValue } from "@codex-ui/shared";
import type {
  ClaudeMessage,
  ClaudeSystemInitMessage,
  ClaudeAssistantMessage,
  ClaudeResultMessage,
  ClaudeStreamEventMessage,
  ClaudeControlRequestMessage,
  ClaudeStreamlinedTextMessage,
  ClaudeContentBlock
} from "./claudeCompatibleProtocol.js";

/**
 * Normalized events emitted by the projector.
 * These match the Codex Ultra notification method names so the existing
 * waterfall UI can render them without changes.
 */
export type ProjectedEvent =
  | { kind: "thread/started"; threadId: string; externalSessionId: string; model?: string; cwd?: string }
  | { kind: "turn/started"; threadId: string; turnId: string }
  | { kind: "turn/completed"; threadId: string; turnId: string }
  | { kind: "turn/failed"; threadId: string; turnId: string; error?: string }
  | { kind: "turn/interrupted"; threadId: string; turnId: string }
  | { kind: "item/agentMessage/delta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/reasoning/textDelta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/started"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | { kind: "item/completed"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | { kind: "item/permissionRequest"; threadId: string; turnId: string; requestId: string; toolName: string; input: unknown; toolUseId?: string }
  | { kind: "system/init"; threadId: string; externalSessionId: string; version?: string; model?: string; cwd?: string; permissionMode?: string };

/**
 * State machine for a single Claude turn.
 * Ensures exactly one terminal event is emitted per turn.
 */
interface TurnState {
  turnId: string;
  threadId: string;
  status: "running" | "completed" | "failed" | "interrupted";
  assistantItemIds: Set<string>;
  assistantTextBlocks: string[];
  streamMessageId?: string;
  streamedAssistantItems: Map<string, string>;
  streamedReasoningItems: Map<string, string>;
  toolItems: Map<string, Record<string, JsonValue>>;
  streamToolBlocks: Map<number, { id: string; name: string; argumentsJson: string; initialInput: JsonValue }>;
}

export interface ProjectorContext {
  threadId: string;
  turnId: string;
  /** Maps external Claude session_id to internal threadId */
  sessionToThread: Map<string, string>;
  /** Active turn state */
  turn: TurnState;
}

/**
 * Create a fresh projector context for a new turn.
 */
export function createProjectorContext(threadId: string, turnId: string): ProjectorContext {
  return {
    threadId,
    turnId,
    sessionToThread: new Map(),
    turn: {
      turnId,
      threadId,
      status: "running",
      assistantItemIds: new Set(),
      assistantTextBlocks: [],
      streamedAssistantItems: new Map(),
      streamedReasoningItems: new Map(),
      toolItems: new Map(),
      streamToolBlocks: new Map()
    }
  };
}

function normalizeAssistantText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function assistantResultAlreadyProjected(blocks: string[], result: string): boolean {
  const normalizedBlocks = blocks.map(normalizeAssistantText).filter(Boolean);
  return normalizedBlocks.includes(result)
    || normalizeAssistantText(normalizedBlocks.join("\n")) === result
    || normalizeAssistantText(normalizedBlocks.join("")) === result;
}

function reconcileStreamedItem(items: Map<string, string>, incoming: string): boolean {
  const normalizedIncoming = normalizeAssistantText(incoming);
  if (!normalizedIncoming) return false;
  for (const [itemId, current] of items) {
    const normalizedCurrent = normalizeAssistantText(current);
    if (!normalizedCurrent
      || (!normalizedCurrent.includes(normalizedIncoming) && !normalizedIncoming.includes(normalizedCurrent))) {
      continue;
    }
    if (normalizedIncoming.length > normalizedCurrent.length) items.set(itemId, incoming);
    return true;
  }
  return false;
}

function streamedToolArguments(block: { argumentsJson: string; initialInput: JsonValue }): JsonValue {
  const source = block.argumentsJson.trim();
  if (!source) return block.initialInput;
  try {
    return JSON.parse(source) as JsonValue;
  } catch {
    return source;
  }
}

/**
 * Convert a projected event into a JSON-RPC notification that the
 * existing Codex Ultra frontend expects.
 */
export function toNotification(event: ProjectedEvent): JsonRpcNotification {
  const params: Record<string, JsonValue> = {};
  switch (event.kind) {
    case "thread/started":
      params.threadId = event.threadId;
      params.externalSessionId = event.externalSessionId;
      if (event.model) params.model = event.model;
      if (event.cwd) params.cwd = event.cwd;
      return { method: "thread/started", params };
    case "turn/started":
      params.threadId = event.threadId;
      params.turnId = event.turnId;
      params.turn = { id: event.turnId, threadId: event.threadId, status: "running" };
      return { method: "turn/started", params };
    case "turn/completed":
      params.threadId = event.threadId;
      params.turnId = event.turnId;
      params.turn = { id: event.turnId, threadId: event.threadId, status: "completed" };
      return { method: "turn/completed", params };
    case "turn/failed":
      params.threadId = event.threadId;
      params.turnId = event.turnId;
      params.turn = { id: event.turnId, threadId: event.threadId, status: "failed" };
      if (event.error) params.error = event.error;
      return { method: "turn/failed", params };
    case "turn/interrupted":
      params.threadId = event.threadId;
      params.turnId = event.turnId;
      params.turn = { id: event.turnId, threadId: event.threadId, status: "interrupted" };
      return { method: "turn/interrupted", params };
    case "item/agentMessage/delta":
      params.threadId = event.threadId;
      params.turnId = event.turnId;
      params.itemId = event.itemId;
      params.delta = event.delta;
      return { method: "item/agentMessage/delta", params };
    case "item/reasoning/textDelta":
      params.threadId = event.threadId;
      params.turnId = event.turnId;
      params.itemId = event.itemId;
      params.delta = event.delta;
      return { method: "item/reasoning/textDelta", params };
    case "item/started":
      params.threadId = event.threadId;
      params.turnId = event.turnId;
      params.item = event.item as JsonValue;
      return { method: "item/started", params };
    case "item/completed":
      params.threadId = event.threadId;
      params.turnId = event.turnId;
      params.item = event.item as JsonValue;
      return { method: "item/completed", params };
    case "item/permissionRequest":
      params.threadId = event.threadId;
      params.turnId = event.turnId;
      params.id = event.requestId;
      params.toolName = event.toolName;
      params.input = event.input as unknown as JsonValue;
      if (event.toolUseId) params.toolUseId = event.toolUseId as unknown as JsonValue;
      return { method: "item/tool/requestPermission", params };
    case "system/init":
      params.threadId = event.threadId;
      params.externalSessionId = event.externalSessionId;
      if (event.version) params.claudeCodeVersion = event.version;
      if (event.model) params.model = event.model;
      if (event.cwd) params.cwd = event.cwd;
      if (event.permissionMode) params.permissionMode = event.permissionMode;
      return { method: "system/init", params };
  }
}

/**
 * Resolve the threadId for a message, using the session-to-thread map
 * and falling back to the context's threadId for single-thread bridges.
 */
function resolveThread(ctx: ProjectorContext, sessionId: string | undefined): string {
  if (sessionId && ctx.sessionToThread.has(sessionId)) {
    return ctx.sessionToThread.get(sessionId)!;
  }
  if (sessionId && !ctx.sessionToThread.has(sessionId)) {
    ctx.sessionToThread.set(sessionId, ctx.threadId);
  }
  return ctx.threadId;
}

/**
 * Check if the turn has already reached a terminal state.
 */
function isTerminal(ctx: ProjectorContext): boolean {
  return ctx.turn.status !== "running";
}

/**
 * Mark the turn as terminal. Returns true if this is the first terminal
 * transition, false if the turn was already terminal (dedup guard).
 */
function markTerminal(ctx: ProjectorContext, status: TurnState["status"]): boolean {
  if (isTerminal(ctx)) return false;
  ctx.turn.status = status;
  return true;
}

/**
 * Project a single parsed Claude message into zero or more normalized events.
 *
 * This function is pure: it does not mutate global state, spawn processes,
 * or make permission decisions. It only reads/writes the provided context.
 */
export function projectMessage(message: ClaudeMessage, ctx: ProjectorContext): ProjectedEvent[] {
  const events: ProjectedEvent[] = [];

  switch (message.type) {
    case "system": {
      if (message.subtype === "init") {
        const init = message as ClaudeSystemInitMessage;
        const threadId = resolveThread(ctx, init.session_id);
        events.push({
          kind: "system/init",
          threadId,
          externalSessionId: init.session_id,
          version: init.claude_code_version,
          model: init.model,
          cwd: init.cwd,
          permissionMode: init.permissionMode
        });
      }
      return events;
    }

    case "assistant": {
      if (isTerminal(ctx)) return events;
      const msg = message as ClaudeAssistantMessage;
      const threadId = resolveThread(ctx, msg.session_id);
      const content = msg.message?.content;
      if (!Array.isArray(content)) return events;

      for (const [blockIndex, block] of (content as ClaudeContentBlock[]).entries()) {
        if (block.type === "text" && typeof block.text === "string") {
          const streamedText = [...ctx.turn.streamedAssistantItems.values()].join("");
          const stableStreamItemId = msg.message.id ? `${msg.message.id}-text-${blockIndex}` : undefined;
          const matchesStableStreamItem = Boolean(stableStreamItemId && ctx.turn.streamedAssistantItems.has(stableStreamItemId));
          if (matchesStableStreamItem) ctx.turn.streamedAssistantItems.set(stableStreamItemId!, block.text);
          if (matchesStableStreamItem
            || reconcileStreamedItem(ctx.turn.streamedAssistantItems, block.text)
            || (normalizeAssistantText(streamedText) && normalizeAssistantText(streamedText).includes(normalizeAssistantText(block.text)))) {
            continue;
          }
          const itemId = (msg.uuid ?? ctx.turnId) + "-text-" + blockIndex;
          if (!ctx.turn.assistantItemIds.has(itemId)) {
            ctx.turn.assistantItemIds.add(itemId);
            ctx.turn.assistantTextBlocks.push(block.text);
            events.push({
              kind: "item/completed",
              threadId,
              turnId: ctx.turnId,
              item: {
                type: "agentMessage",
                id: itemId,
                threadId,
                content: block.text,
                role: "assistant",
                status: "completed"
              }
            });
          }
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          const streamedReasoning = [...ctx.turn.streamedReasoningItems.values()].join("");
          const stableStreamReasoningId = msg.message.id ? `${msg.message.id}-reasoning-${blockIndex}` : undefined;
          const matchesStableStreamReasoning = Boolean(stableStreamReasoningId && ctx.turn.streamedReasoningItems.has(stableStreamReasoningId));
          if (matchesStableStreamReasoning) ctx.turn.streamedReasoningItems.set(stableStreamReasoningId!, block.thinking);
          if (matchesStableStreamReasoning
            || reconcileStreamedItem(ctx.turn.streamedReasoningItems, block.thinking)
            || (normalizeAssistantText(streamedReasoning) && normalizeAssistantText(streamedReasoning).includes(normalizeAssistantText(block.thinking)))) {
            continue;
          }
          const itemId = (msg.uuid ?? ctx.turnId) + "-thinking-" + blockIndex;
          if (!ctx.turn.assistantItemIds.has(itemId)) {
            ctx.turn.assistantItemIds.add(itemId);
            events.push({
              kind: "item/completed",
              threadId,
              turnId: ctx.turnId,
              item: {
                type: "reasoning",
                id: itemId,
                threadId,
                text: block.thinking,
                status: "completed"
              }
            });
          }
        } else if (block.type === "tool_use" && typeof block.id === "string") {
          const toolArgs = ((block as { input?: unknown }).input ?? {}) as JsonValue;
          const toolName = (block as { name?: unknown }).name as string;
          const item: Record<string, JsonValue> = {
            type: "toolCall",
            id: block.id,
            threadId,
            turnId: ctx.turnId,
            name: toolName as JsonValue,
            tool: toolName as JsonValue,
            toolName: toolName as JsonValue,
            input: toolArgs,
            arguments: toolArgs,
            status: "inProgress"
          };
          ctx.turn.toolItems.set(block.id, item);
          events.push({
            kind: "item/started",
            threadId,
            turnId: ctx.turnId,
            item
          });
        }
      }
      return events;
    }

    case "user": {
      if (isTerminal(ctx)) return events;
      const msg = message as { session_id?: string; message?: { content?: unknown } };
      const threadId = resolveThread(ctx, msg.session_id);
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content as ClaudeContentBlock[]) {
          if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
            const existing = ctx.turn.toolItems.get(block.tool_use_id);
            const toolName = (((existing as { toolName?: unknown; name?: unknown })?.toolName ?? (existing as { name?: unknown })?.name ?? "Tool") as JsonValue);
            const toolArgs = (((existing as { arguments?: unknown })?.arguments ?? (existing as { input?: unknown })?.input ?? {}) as JsonValue);
            const item: Record<string, JsonValue> = {
              ...(existing ?? {}),
              type: "toolCall",
              id: block.tool_use_id,
              threadId,
              turnId: ctx.turnId,
              name: toolName,
              tool: toolName,
              toolName,
              input: toolArgs,
              arguments: toolArgs,
              result: { content: ((block as { content?: unknown }).content ?? "") as JsonValue },
              status: (block as { is_error?: boolean }).is_error === true ? "failed" : "completed"
            };
            ctx.turn.toolItems.set(block.tool_use_id, item);
            events.push({
              kind: "item/completed",
              threadId,
              turnId: ctx.turnId,
              item
            });
          }
        }
      }
      return events;
    }

    case "stream_event": {
      if (isTerminal(ctx)) return events;
      const msg = message as ClaudeStreamEventMessage;
      const threadId = resolveThread(ctx, msg.session_id);
      const event = msg.event;
      if (event.type === "message_start" && event.message?.id) {
        ctx.turn.streamMessageId = event.message.id;
      } else if (!ctx.turn.streamMessageId && msg.uuid) {
        ctx.turn.streamMessageId = msg.uuid;
      }
      const blockIndex = typeof event.index === "number" && Number.isFinite(event.index) ? event.index : 0;

      if (event.type === "content_block_start") {
        const cb = event.content_block;
        const channel = cb?.type === "thinking" ? "reasoning" : cb?.type === "text" ? "text" : undefined;
        const text = typeof cb?.text === "string" ? cb.text : typeof cb?.thinking === "string" ? cb.thinking : "";
        if (cb?.type === "tool_use" && typeof cb.id === "string" && typeof cb.name === "string"
          && cb.name !== "Agent" && cb.name !== "Task") {
          const toolBlock = {
            id: cb.id,
            name: cb.name,
            argumentsJson: "",
            initialInput: (cb.input ?? {}) as JsonValue,
          };
          ctx.turn.streamToolBlocks.set(blockIndex, toolBlock);
          const startArgs = streamedToolArguments(toolBlock);
          const item = {
            type: "toolCall",
            id: cb.id,
            threadId,
            turnId: ctx.turnId,
            name: cb.name,
            tool: cb.name,
            toolName: cb.name,
            input: startArgs,
            arguments: startArgs,
            status: "inProgress"
          };
          ctx.turn.toolItems.set(cb.id, item);
          events.push({
            kind: "item/started",
            threadId,
            turnId: ctx.turnId,
            item
          });
        }
        if (channel && text.length > 0) {
          const itemId = `${ctx.turn.streamMessageId ?? event.message?.id ?? ctx.turnId}-${channel}-${blockIndex}`;
          const items = channel === "reasoning" ? ctx.turn.streamedReasoningItems : ctx.turn.streamedAssistantItems;
          items.set(itemId, `${items.get(itemId) ?? ""}${text}`);
          events.push({
            kind: channel === "reasoning" ? "item/reasoning/textDelta" : "item/agentMessage/delta",
            threadId,
            turnId: ctx.turnId,
            itemId,
            delta: text
          });
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const toolBlock = ctx.turn.streamToolBlocks.get(blockIndex);
          if (toolBlock) {
            toolBlock.argumentsJson += delta.partial_json;
            const deltaArgs = streamedToolArguments(toolBlock);
            const item = {
              type: "toolCall",
              id: toolBlock.id,
              threadId,
              turnId: ctx.turnId,
              name: toolBlock.name,
              tool: toolBlock.name,
              toolName: toolBlock.name,
              input: deltaArgs,
              arguments: deltaArgs,
              status: "inProgress"
            };
            ctx.turn.toolItems.set(toolBlock.id, item);
            events.push({ kind: "item/started", threadId, turnId: ctx.turnId, item });
          }
        }
        const channel = delta?.type === "thinking_delta" || typeof delta?.thinking === "string"
          ? "reasoning"
          : typeof delta?.text === "string" || delta?.type === "text_delta" ? "text" : undefined;
        const text = channel === "reasoning"
          ? (typeof delta?.thinking === "string" ? delta.thinking : "")
          : (typeof delta?.text === "string" ? delta.text : "");
        if (channel && text.length > 0) {
          const itemId = `${ctx.turn.streamMessageId ?? event.message?.id ?? ctx.turnId}-${channel}-${blockIndex}`;
          const items = channel === "reasoning" ? ctx.turn.streamedReasoningItems : ctx.turn.streamedAssistantItems;
          items.set(itemId, `${items.get(itemId) ?? ""}${text}`);
          events.push({
            kind: channel === "reasoning" ? "item/reasoning/textDelta" : "item/agentMessage/delta",
            threadId,
            turnId: ctx.turnId,
            itemId,
            delta: text
          });
        }
      }
      return events;
    }

    case "streamlined_text": {
      if (isTerminal(ctx)) return events;
      const msg = message as ClaudeStreamlinedTextMessage;
      const threadId = resolveThread(ctx, msg.session_id);
      const itemId = (msg.uuid ?? ctx.turnId) + "-text";
      if (!ctx.turn.assistantItemIds.has(itemId)) {
        ctx.turn.assistantItemIds.add(itemId);
        ctx.turn.assistantTextBlocks.push(msg.text);
        events.push({
          kind: "item/completed",
          threadId,
          turnId: ctx.turnId,
          item: {
            type: "agentMessage",
            id: itemId,
            threadId,
            content: msg.text,
            role: "assistant",
            status: "completed"
          }
        });
      }
      return events;
    }

    case "result": {
      if (isTerminal(ctx)) return events;
      const msg = message as ClaudeResultMessage;
      const threadId = resolveThread(ctx, msg.session_id);
      const isError = msg.is_error === true || msg.subtype !== "success";

      for (const [itemId, text] of ctx.turn.streamedReasoningItems) {
        if (!text || ctx.turn.assistantItemIds.has(itemId)) continue;
        ctx.turn.assistantItemIds.add(itemId);
        events.push({
          kind: "item/completed",
          threadId,
          turnId: ctx.turnId,
          item: { type: "reasoning", id: itemId, threadId, text, status: "completed" }
        });
      }

      for (const [itemId, text] of ctx.turn.streamedAssistantItems) {
        if (!text || ctx.turn.assistantItemIds.has(itemId)) continue;
        ctx.turn.assistantItemIds.add(itemId);
        ctx.turn.assistantTextBlocks.push(text);
        events.push({
          kind: "item/completed",
          threadId,
          turnId: ctx.turnId,
          item: {
            type: "agentMessage",
            id: itemId,
            threadId,
            content: text,
            role: "assistant",
            status: "completed"
          }
        });
      }

      if (typeof msg.result === "string" && msg.result.length > 0) {
        const resultItemId = "result-" + (msg.session_id ?? ctx.turnId);
        const normalizedResult = normalizeAssistantText(msg.result);
        if (!ctx.turn.assistantItemIds.has(resultItemId) && !assistantResultAlreadyProjected(ctx.turn.assistantTextBlocks, normalizedResult)) {
          ctx.turn.assistantItemIds.add(resultItemId);
          ctx.turn.assistantTextBlocks.push(msg.result);
          events.push({
            kind: "item/completed",
            threadId,
            turnId: ctx.turnId,
            item: {
              type: "agentMessage",
              id: resultItemId,
              threadId,
              content: msg.result,
              role: "assistant",
              status: "completed"
            }
          });
        }
      }

      if (markTerminal(ctx, isError ? "failed" : "completed")) {
        events.push({
          kind: isError ? "turn/failed" : "turn/completed",
          threadId,
          turnId: ctx.turnId,
          ...(isError && msg.errors && msg.errors.length > 0 ? { error: msg.errors[0] } : {})
        });
      }
      return events;
    }

    case "control_request": {
      const msg = message as ClaudeControlRequestMessage;
      if (msg.request?.subtype === "can_use_tool") {
        const threadId = resolveThread(ctx, msg.session_id);
        events.push({
          kind: "item/permissionRequest",
          threadId,
          turnId: ctx.turnId,
          requestId: msg.request_id,
          toolName: msg.request.tool_name ?? "unknown",
          input: (msg.request.input ?? {}) as unknown as JsonValue,
          ...(msg.request.tool_use_id ? { toolUseId: msg.request.tool_use_id } : {})
        });
      }
      return events;
    }

    default:
      return events;
  }
}

/**
 * Force-terminate the turn (e.g., when the CLI process exits unexpectedly).
 * Returns a terminal event if the turn was still running.
 */
export function forceTerminate(ctx: ProjectorContext, error?: string): ProjectedEvent | null {
  if (markTerminal(ctx, "failed")) {
    return {
      kind: "turn/failed",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      ...(error ? { error } : {})
    };
  }
  return null;
}

/**
 * Mark the turn as interrupted (e.g., when the user sends turn/interrupt).
 * Returns an interrupted event if the turn was still running.
 */
export function markInterrupted(ctx: ProjectorContext): ProjectedEvent | null {
  if (markTerminal(ctx, "interrupted")) {
    return {
      kind: "turn/interrupted",
      threadId: ctx.threadId,
      turnId: ctx.turnId
    };
  }
  return null;
}
