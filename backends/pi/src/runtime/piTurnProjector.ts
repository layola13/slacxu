import type { JsonRpcNotification, JsonValue } from "@codex-ui/shared";
import type {
  PiRpcAssistantMessageEvent,
  PiRpcEvent,
  PiRpcIncomingMessage,
  PiRpcResponse,
  PiRpcSessionMessage,
  PiRpcUsage,
} from "./piRpcProtocol.js";

export type PiProjectedEvent =
  | { kind: "turn/started"; threadId: string; turnId: string }
  | { kind: "turn/completed"; threadId: string; turnId: string; usage?: PiRpcUsage }
  | { kind: "turn/failed"; threadId: string; turnId: string; error?: string }
  | { kind: "turn/interrupted"; threadId: string; turnId: string }
  | { kind: "item/agentMessage/delta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/reasoning/textDelta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/started"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | { kind: "item/completed"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | { kind: "system/init"; threadId: string; sessionId?: string };

export interface PiProjectorContext {
  threadId: string;
  turnId: string;
  sessionId?: string;
  status: "running" | "completed" | "failed" | "interrupted";
  messageSeq: number;
  textSegmentSeq: number;
  toolCallSeq: number;
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
  hasCompletedAgentMessage: boolean;
  activeToolItems: Map<string, Record<string, JsonValue>>;
  toolContentIndexToId: Map<string, string>;
  toolIdAliases: Map<string, string>;
  toolRawArguments: Map<string, string>;
  lastUsage?: PiRpcUsage;
}

export function createPiProjectorContext(threadId: string, turnId: string): PiProjectorContext {
  const initialAssistantItemId = `pi-msg-${turnId}-0`;
  const initialReasoningItemId = `pi-thought-${turnId}-0`;
  return {
    threadId,
    turnId,
    status: "running",
    messageSeq: 0,
    textSegmentSeq: 0,
    toolCallSeq: 0,
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
    hasCompletedAgentMessage: false,
    activeToolItems: new Map(),
    toolContentIndexToId: new Map(),
    toolIdAliases: new Map(),
    toolRawArguments: new Map(),
  };
}

export function startNewPiSegment(ctx: PiProjectorContext): void {
  ctx.textSegmentSeq += 1;
  ctx.currentAssistantItemId = `pi-msg-${ctx.turnId}-${ctx.messageSeq}-${ctx.textSegmentSeq}`;
  ctx.currentAssistantText = "";
  ctx.currentReasoningItemId = `pi-thought-${ctx.turnId}-${ctx.messageSeq}-${ctx.textSegmentSeq}`;
  ctx.currentReasoningText = "";
  ctx.assistantItemId = ctx.currentAssistantItemId;
  ctx.reasoningItemId = ctx.currentReasoningItemId;
  ctx.hasStartedCurrentAssistantMessage = false;
  ctx.hasCompletedCurrentAssistantMessage = false;
  ctx.hasStartedCurrentReasoning = false;
  ctx.hasCompletedCurrentReasoning = false;
}

function completeActiveReasoning(
  ctx: PiProjectorContext,
  events: PiProjectedEvent[],
  status: "completed" | "failed" | "interrupted" = "completed"
): void {
  if (ctx.hasStartedCurrentReasoning && !ctx.hasCompletedCurrentReasoning) {
    ctx.hasCompletedCurrentReasoning = true;
    events.push({
      kind: "item/completed",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        id: ctx.currentReasoningItemId,
        turnId: ctx.turnId,
        threadId: ctx.threadId,
        type: "reasoning",
        title: "Reasoning",
        status,
        text: ctx.currentReasoningText,
        completedAt: Math.floor(Date.now() / 1000),
      },
    });
  }
}

function completeActiveAssistantMessage(
  ctx: PiProjectorContext,
  events: PiProjectedEvent[],
  status: "completed" | "failed" | "interrupted" = "completed"
): void {
  if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
    ctx.hasCompletedCurrentAssistantMessage = true;
    ctx.hasCompletedAgentMessage = true;
    const finalContent: JsonValue[] = [];
    if (ctx.currentReasoningText) {
      finalContent.push({ type: "reasoning", text: ctx.currentReasoningText });
    }
    if (ctx.currentAssistantText) {
      finalContent.push({ type: "text", text: ctx.currentAssistantText });
    }
    events.push({
      kind: "item/completed",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        id: ctx.currentAssistantItemId!,
        turnId: ctx.turnId,
        threadId: ctx.threadId,
        role: "assistant",
        type: "agentMessage",
        status,
        text: ctx.currentAssistantText,
        content: finalContent,
        completedAt: Math.floor(Date.now() / 1000),
      },
    });
  }
}

export function projectPiMessage(
  msg: PiRpcIncomingMessage,
  ctx: PiProjectorContext
): PiProjectedEvent[] {
  const events: PiProjectedEvent[] = [];
  const { threadId, turnId } = ctx;

  if (ctx.status !== "running") {
    return events;
  }

  // Auto-emit turn/started if not already emitted
  if (!ctx.hasStartedTurn) {
    ctx.hasStartedTurn = true;
    events.push({
      kind: "turn/started",
      threadId,
      turnId,
    });
  }

  // 1. Check command responses (e.g. response to prompt command)
  if (msg.type === "response") {
    const res = msg as PiRpcResponse;
    if (res.success === false) {
      ctx.status = "failed";
      const errorMsg = res.error || "Pi command failed";
      events.push({
        kind: "turn/failed",
        threadId,
        turnId,
        error: errorMsg,
      });
      return events;
    }
  }

  // 2. Check RPC events
  const evt = msg as PiRpcEvent;
  switch (evt.type) {
    case "agent_start":
    case "turn_start": {
      // Internal marker, already handled via turn/started
      break;
    }

    case "message_start": {
      const sessMsg = (evt as { message?: PiRpcSessionMessage }).message;
      if (sessMsg?.role === "assistant") {
        if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
          completeActiveAssistantMessage(ctx, events);
          ctx.messageSeq += 1;
        }
        completeActiveReasoning(ctx, events);
        ctx.toolContentIndexToId.clear();
        ctx.currentAssistantText = "";
        ctx.currentReasoningText = "";
        ctx.textSegmentSeq = 0;
        ctx.hasStartedCurrentAssistantMessage = false;
        ctx.hasCompletedCurrentAssistantMessage = false;
        ctx.currentAssistantItemId = `pi-msg-${turnId}-${ctx.messageSeq}-${ctx.textSegmentSeq}`;
        ctx.currentReasoningItemId = `pi-thought-${turnId}-${ctx.messageSeq}-${ctx.textSegmentSeq}`;
        ctx.assistantItemId = ctx.currentAssistantItemId;
        ctx.reasoningItemId = ctx.currentReasoningItemId;
      }
      break;
    }

    case "message_update": {
      const updateEvt = (evt as { assistantMessageEvent?: PiRpcAssistantMessageEvent }).assistantMessageEvent;
      if (!updateEvt) break;

      if (updateEvt.type === "thinking_delta" && updateEvt.delta) {
        if (ctx.hasCompletedCurrentReasoning) {
          ctx.textSegmentSeq += 1;
          ctx.currentReasoningItemId = `pi-thought-${turnId}-${ctx.messageSeq}-${ctx.textSegmentSeq}`;
          ctx.reasoningItemId = ctx.currentReasoningItemId;
          ctx.currentReasoningText = "";
          ctx.hasStartedCurrentReasoning = false;
          ctx.hasCompletedCurrentReasoning = false;
        }
        if (!ctx.hasStartedCurrentReasoning) {
          ctx.hasStartedCurrentReasoning = true;
          if (!ctx.currentReasoningItemId) {
            ctx.currentReasoningItemId = `pi-thought-${turnId}-${ctx.messageSeq}-${ctx.textSegmentSeq}`;
            ctx.reasoningItemId = ctx.currentReasoningItemId;
          }
          events.push({
            kind: "item/started",
            threadId,
            turnId,
            item: {
              id: ctx.currentReasoningItemId,
              turnId,
              threadId,
              type: "reasoning",
              title: "Reasoning",
              status: "inProgress",
              text: "",
              startedAt: Math.floor(Date.now() / 1000),
            },
          });
        }
        ctx.reasoningText += updateEvt.delta;
        ctx.currentReasoningText += updateEvt.delta;
        events.push({
          kind: "item/reasoning/textDelta",
          threadId,
          turnId,
          itemId: ctx.currentReasoningItemId,
          delta: updateEvt.delta,
        });
      } else if (updateEvt.type === "text_delta" && updateEvt.delta) {
        completeActiveReasoning(ctx, events);
        ctx.assistantText += updateEvt.delta;
        ctx.hasStartedAgentMessage = true;

        if (ctx.hasCompletedCurrentAssistantMessage) {
          ctx.textSegmentSeq += 1;
          ctx.currentAssistantItemId = `pi-msg-${turnId}-${ctx.messageSeq}-${ctx.textSegmentSeq}`;
          ctx.assistantItemId = ctx.currentAssistantItemId;
          ctx.currentAssistantText = "";
          ctx.hasStartedCurrentAssistantMessage = false;
          ctx.hasCompletedCurrentAssistantMessage = false;
        }

        if (!ctx.hasStartedCurrentAssistantMessage) {
          ctx.hasStartedCurrentAssistantMessage = true;
          if (!ctx.currentAssistantItemId) {
            ctx.currentAssistantItemId = `pi-msg-${turnId}-${ctx.messageSeq}-${ctx.textSegmentSeq}`;
            ctx.assistantItemId = ctx.currentAssistantItemId;
          }
          events.push({
            kind: "item/started",
            threadId,
            turnId,
            item: {
              id: ctx.currentAssistantItemId,
              turnId,
              threadId,
              role: "assistant",
              type: "agentMessage",
              status: "inProgress",
              text: "",
              content: [],
              startedAt: Math.floor(Date.now() / 1000),
            },
          });
        }

        ctx.currentAssistantText += updateEvt.delta;
        events.push({
          kind: "item/agentMessage/delta",
          threadId,
          turnId,
          itemId: ctx.currentAssistantItemId,
          delta: updateEvt.delta,
        });
      } else if (updateEvt.type === "toolcall_start" || updateEvt.type === "toolcall_delta" || updateEvt.type === "toolcall_end") {
        completeActiveReasoning(ctx, events);
        if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
          completeActiveAssistantMessage(ctx, events);
        }

        const contentIndex = typeof updateEvt.contentIndex === "number" ? updateEvt.contentIndex : undefined;
        let rawToolCall: Record<string, any> = {};
        if (updateEvt.toolCall && typeof updateEvt.toolCall === "object") {
          rawToolCall = updateEvt.toolCall as Record<string, any>;
        } else if (
          updateEvt.partial &&
          typeof updateEvt.partial === "object" &&
          Array.isArray((updateEvt.partial as any).content) &&
          contentIndex !== undefined &&
          (updateEvt.partial as any).content[contentIndex] &&
          typeof (updateEvt.partial as any).content[contentIndex] === "object"
        ) {
          rawToolCall = (updateEvt.partial as any).content[contentIndex] as Record<string, any>;
        } else if (updateEvt.partial && typeof updateEvt.partial === "object") {
          rawToolCall = updateEvt.partial as Record<string, any>;
        }

        const indexKey = contentIndex !== undefined ? `${ctx.messageSeq}:${contentIndex}` : undefined;
        const explicitId = typeof updateEvt.id === "string" && updateEvt.id.trim()
          ? updateEvt.id.trim()
          : typeof rawToolCall.id === "string" && rawToolCall.id.trim()
            ? rawToolCall.id.trim()
            : undefined;

        let callId: string;
        // Never reuse settled tool items (completed or failed) for a new tool call
        if (indexKey && ctx.toolContentIndexToId.has(indexKey)) {
          const candidateId = ctx.toolContentIndexToId.get(indexKey)!;
          const candidateItem = ctx.activeToolItems.get(candidateId);
          if (candidateItem && candidateItem.status !== "inProgress") {
            ctx.toolCallSeq += 1;
            callId = `pi-tool-${turnId}-${ctx.toolCallSeq}`;
            ctx.toolContentIndexToId.set(indexKey, callId);
          } else {
            callId = candidateId;
          }
          if (explicitId && explicitId !== callId) {
            ctx.toolIdAliases.set(explicitId, callId);
          }
        } else if (explicitId) {
          const aliased = ctx.toolIdAliases.get(explicitId) || explicitId;
          const existingItem = ctx.activeToolItems.get(aliased);
          if (existingItem && existingItem.status !== "inProgress") {
            ctx.toolCallSeq += 1;
            callId = `pi-tool-${turnId}-${ctx.toolCallSeq}`;
            ctx.toolIdAliases.set(explicitId, callId);
          } else {
            callId = aliased;
          }
          if (indexKey) {
            ctx.toolContentIndexToId.set(indexKey, callId);
          }
        } else if (indexKey) {
          callId = `pi-tool-${turnId}-${ctx.messageSeq}-${contentIndex}`;
          ctx.toolContentIndexToId.set(indexKey, callId);
        } else {
          callId = `pi-tool-${turnId}-${ctx.messageSeq}-${ctx.activeToolItems.size}`;
        }

        const toolName = String(
          updateEvt.toolName ||
          rawToolCall.name ||
          rawToolCall.toolName ||
          updateEvt.name ||
          ctx.activeToolItems.get(callId)?.toolName ||
          "Tool"
        );

        if (updateEvt.type === "toolcall_start") {
          const args = (rawToolCall.arguments ?? updateEvt.arguments ?? {}) as JsonValue;
          const existing = ctx.activeToolItems.get(callId);
          const item: Record<string, JsonValue> = {
            ...(existing ?? {}),
            id: callId,
            turnId,
            threadId,
            type: "toolCall",
            tool: toolName,
            toolName,
            name: toolName,
            status: "inProgress",
            arguments: (existing?.arguments ?? args) as JsonValue,
            input: (existing?.input ?? args) as JsonValue,
            startedAt: existing?.startedAt ?? Math.floor(Date.now() / 1000),
          };
          ctx.activeToolItems.set(callId, item);
          if (!existing) {
            events.push({
              kind: "item/started",
              threadId,
              turnId,
              item,
            });
          }
        } else if (updateEvt.type === "toolcall_delta") {
          const delta = typeof updateEvt.delta === "string" ? updateEvt.delta : "";
          if (delta) {
            const prev = ctx.toolRawArguments.get(callId) ?? "";
            const current = prev + delta;
            ctx.toolRawArguments.set(callId, current);
            try {
              const parsed = JSON.parse(current);
              const item = ctx.activeToolItems.get(callId);
              if (item) {
                item.arguments = parsed as JsonValue;
                item.input = parsed as JsonValue;
              }
            } catch {
              // Partial JSON argument stream, wait for complete deltas
            }
          }
        } else if (updateEvt.type === "toolcall_end") {
          let args = rawToolCall.arguments;
          if (!args && ctx.toolRawArguments.has(callId)) {
            try {
              args = JSON.parse(ctx.toolRawArguments.get(callId)!);
            } catch {
              args = ctx.toolRawArguments.get(callId);
            }
          }
          const existing = ctx.activeToolItems.get(callId) ?? {
            id: callId,
            turnId,
            threadId,
            type: "toolCall",
            toolName,
            name: toolName,
            status: "inProgress",
            startedAt: Math.floor(Date.now() / 1000),
          };
          existing.toolName = toolName;
          existing.name = toolName;
          if (args !== undefined) {
            existing.arguments = args as JsonValue;
            existing.input = args as JsonValue;
          }
          ctx.activeToolItems.set(callId, existing);
        }
      }
      break;
    }

    case "tool_execution_start": {
      completeActiveReasoning(ctx, events);
      if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
        completeActiveAssistantMessage(ctx, events);
      }
      const teStart = evt as { toolCallId?: string; toolName?: string; args?: any };
      const rawId = typeof teStart.toolCallId === "string" && teStart.toolCallId.trim()
        ? teStart.toolCallId.trim()
        : undefined;
      let callId = (rawId && ctx.toolIdAliases.get(rawId)) || rawId;
      if (!callId) {
        ctx.toolCallSeq += 1;
        callId = `pi-tool-${turnId}-${ctx.toolCallSeq}`;
      } else {
        const existingItem = ctx.activeToolItems.get(callId);
        if (existingItem && existingItem.status !== "inProgress") {
          ctx.toolCallSeq += 1;
          const freshId = `pi-tool-${turnId}-${ctx.toolCallSeq}`;
          if (rawId) {
            ctx.toolIdAliases.set(rawId, freshId);
          }
          callId = freshId;
        }
      }
      const toolName = String(teStart.toolName || ctx.activeToolItems.get(callId)?.toolName || "Tool");
      const existing = ctx.activeToolItems.get(callId);
      const args = (teStart.args ?? existing?.arguments ?? {}) as JsonValue;
      const item: Record<string, JsonValue> = {
        ...(existing ?? {}),
        id: callId,
        turnId,
        threadId,
        type: "toolCall",
        tool: toolName,
        toolName,
        name: toolName,
        status: "inProgress",
        arguments: args,
        input: args,
        startedAt: existing?.startedAt ?? Math.floor(Date.now() / 1000),
      };
      ctx.activeToolItems.set(callId, item);
      if (!existing) {
        events.push({
          kind: "item/started",
          threadId,
          turnId,
          item,
        });
      }
      break;
    }

    case "tool_execution_update": {
      const teUpdate = evt as { toolCallId?: string; partialResult?: any };
      const rawId = typeof teUpdate.toolCallId === "string" && teUpdate.toolCallId.trim()
        ? teUpdate.toolCallId.trim()
        : undefined;
      const callId = (rawId && ctx.toolIdAliases.get(rawId)) || rawId;
      if (callId && ctx.activeToolItems.has(callId)) {
        const item = ctx.activeToolItems.get(callId)!;
        if (teUpdate.partialResult !== undefined) {
          item.output = teUpdate.partialResult as JsonValue;
        }
      }
      break;
    }

    case "tool_execution_end": {
      const teEnd = evt as { toolCallId?: string; toolName?: string; result?: any; isError?: boolean };
      const rawId = typeof teEnd.toolCallId === "string" && teEnd.toolCallId.trim()
        ? teEnd.toolCallId.trim()
        : undefined;
      const callId = (rawId && ctx.toolIdAliases.get(rawId)) || rawId;
      if (callId) {
        const toolName = String(teEnd.toolName || ctx.activeToolItems.get(callId)?.toolName || "Tool");
        const existing = ctx.activeToolItems.get(callId) ?? {
          id: callId,
          turnId,
          threadId,
          type: "toolCall",
          tool: toolName,
          toolName,
          name: toolName,
          startedAt: Math.floor(Date.now() / 1000),
        };
        existing.tool = toolName;
        existing.status = teEnd.isError ? "failed" : "completed";
        if (teEnd.result !== undefined) {
          existing.output = teEnd.result as JsonValue;
          existing.result = teEnd.result as JsonValue;
        }
        existing.completedAt = Math.floor(Date.now() / 1000);
        ctx.activeToolItems.set(callId, existing);
        events.push({
          kind: "item/completed",
          threadId,
          turnId,
          item: existing,
        });
      }
      break;
    }

    case "message_end": {
      const sessMsg = (evt as { message?: PiRpcSessionMessage }).message;
      if (sessMsg?.role === "toolResult") {
        const rawId = typeof sessMsg.toolCallId === "string" && sessMsg.toolCallId.trim()
          ? sessMsg.toolCallId.trim()
          : undefined;
        const callId = (rawId && ctx.toolIdAliases.get(rawId)) || rawId;
        if (callId && ctx.activeToolItems.has(callId)) {
          const existing = ctx.activeToolItems.get(callId)!;
          if (existing.status === "inProgress") {
            existing.status = sessMsg.isError ? "failed" : "completed";
            existing.completedAt = Math.floor(Date.now() / 1000);
            if (sessMsg.content !== undefined) {
              existing.result = sessMsg.content as unknown as JsonValue;
              existing.output = sessMsg.content as unknown as JsonValue;
            }
            events.push({
              kind: "item/completed",
              threadId,
              turnId,
              item: existing,
            });
          }
        }
      } else if (sessMsg?.role === "assistant") {
        if (!ctx.hasStartedCurrentAssistantMessage && sessMsg?.content) {
          let fullText = "";
          if (typeof sessMsg.content === "string") {
            fullText = sessMsg.content;
          } else if (Array.isArray(sessMsg.content)) {
            for (const block of sessMsg.content) {
              if (block && typeof block === "object" && block.type === "text" && typeof (block as any).text === "string") {
                fullText += (block as any).text;
              }
            }
          }
          if (fullText) {
            ctx.currentAssistantText = fullText;
            ctx.assistantText += fullText;
            ctx.hasStartedAgentMessage = true;
            ctx.hasStartedCurrentAssistantMessage = true;
            events.push({
              kind: "item/started",
              threadId,
              turnId,
              item: {
                id: ctx.currentAssistantItemId || `pi-msg-${turnId}-${ctx.messageSeq}`,
                turnId,
                threadId,
                role: "assistant",
                type: "agentMessage",
                status: "inProgress",
                text: fullText,
                content: [{ type: "text", text: fullText }],
                startedAt: Math.floor(Date.now() / 1000),
              },
            });
          }
        }

        completeActiveReasoning(ctx, events);
        completeActiveAssistantMessage(ctx, events);
        if (sessMsg.usage) {
          ctx.lastUsage = sessMsg.usage;
        }
        if (sessMsg.errorMessage) {
          ctx.status = "failed";
          events.push({
            kind: "turn/failed",
            threadId,
            turnId,
            error: sessMsg.errorMessage,
          });
          return events;
        }

        ctx.messageSeq += 1;
        ctx.textSegmentSeq = 0;
        ctx.currentAssistantText = "";
        ctx.currentReasoningText = "";
        ctx.hasStartedCurrentAssistantMessage = false;
        ctx.hasCompletedCurrentAssistantMessage = false;
        ctx.currentAssistantItemId = `pi-msg-${turnId}-${ctx.messageSeq}`;
        ctx.currentReasoningItemId = `pi-thought-${turnId}-${ctx.messageSeq}`;
        ctx.assistantItemId = ctx.currentAssistantItemId;
        ctx.reasoningItemId = ctx.currentReasoningItemId;
      }
      break;
    }

    case "turn_end": {
      const sessMsg = (evt as { message?: PiRpcSessionMessage }).message;
      if (sessMsg?.usage) {
        ctx.lastUsage = sessMsg.usage;
      }
      break;
    }

    case "agent_end": {
      // internal marker
      break;
    }

    case "agent_settled": {
      // Terminal event for turn!
      // 1. Complete any active tools that are still inProgress
      for (const [, item] of ctx.activeToolItems.entries()) {
        if (item.status === "inProgress") {
          item.status = "completed";
          item.completedAt = Math.floor(Date.now() / 1000);
          events.push({
            kind: "item/completed",
            threadId,
            turnId,
            item,
          });
        }
      }

      // 2. Complete active reasoning and assistant message if not completed
      completeActiveReasoning(ctx, events);
      completeActiveAssistantMessage(ctx, events);

      // 3. Ensure at least one assistant message was emitted
      if (!ctx.hasStartedAgentMessage) {
        ctx.hasStartedAgentMessage = true;
        events.push({
          kind: "item/completed",
          threadId,
          turnId,
          item: {
            id: `pi-msg-${turnId}-0`,
            turnId,
            threadId,
            role: "assistant",
            type: "agentMessage",
            status: "completed",
            text: ctx.assistantText || "",
            content: ctx.assistantText ? [{ type: "text", text: ctx.assistantText }] : [],
            completedAt: Math.floor(Date.now() / 1000),
          },
        });
      }

      ctx.status = "completed";
      events.push({
        kind: "turn/completed",
        threadId,
        turnId,
        usage: ctx.lastUsage,
      });
      break;
    }

    default:
      // Unknown event: non-fatal, safe passthrough
      break;
  }

  return events;
}

export function toPiNotification(event: PiProjectedEvent): JsonRpcNotification | null {
  switch (event.kind) {
    case "turn/started":
      return {
        method: "turn/started",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          engine: "pi",
          turn: {
            id: event.turnId,
            threadId: event.threadId,
            status: "inProgress",
          },
        },
      };

    case "turn/completed":
      return {
        method: "turn/completed",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          engine: "pi",
          completedAt: Math.floor(Date.now() / 1000),
          turn: {
            id: event.turnId,
            threadId: event.threadId,
            status: "completed",
            completedAt: Math.floor(Date.now() / 1000),
            usage: event.usage as unknown as JsonValue,
          },
        },
      };

    case "turn/failed":
      return {
        method: "turn/failed",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          engine: "pi",
          completedAt: Math.floor(Date.now() / 1000),
          error: event.error || "Turn failed",
          turn: {
            id: event.turnId,
            threadId: event.threadId,
            status: "failed",
            error: event.error || "Turn failed",
            completedAt: Math.floor(Date.now() / 1000),
          },
        },
      };

    case "turn/interrupted":
      return {
        method: "turn/interrupted",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          engine: "pi",
          completedAt: Math.floor(Date.now() / 1000),
          turn: {
            id: event.turnId,
            threadId: event.threadId,
            status: "interrupted",
            completedAt: Math.floor(Date.now() / 1000),
          },
        },
      };

    case "item/started":
      return {
        method: "item/started",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          item: event.item,
        },
      };

    case "item/completed":
      return {
        method: "item/completed",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          item: event.item,
        },
      };

    case "item/agentMessage/delta":
      return {
        method: "item/agentMessage/delta",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          itemId: event.itemId,
          delta: event.delta,
        },
      };

    case "item/reasoning/textDelta":
      return {
        method: "item/reasoning/textDelta",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          itemId: event.itemId,
          delta: event.delta,
        },
      };

    case "system/init":
      return null;
  }
}

export function forceTerminatePi(
  ctx: PiProjectorContext,
  reason: "completed" | "failed" | "interrupted",
  error?: string
): PiProjectedEvent[] {
  const events: PiProjectedEvent[] = [];
  const { threadId, turnId } = ctx;

  if (ctx.status !== "running") return events;

  // Complete any active tool calls that are still inProgress
  for (const [, item] of ctx.activeToolItems.entries()) {
    if (item.status === "inProgress") {
      item.status = reason === "completed" ? "completed" : "failed";
      item.completedAt = Math.floor(Date.now() / 1000);
      events.push({
        kind: "item/completed",
        threadId,
        turnId,
        item,
      });
    }
  }

  const finalStatus = reason === "completed" ? "completed" : reason === "interrupted" ? "interrupted" : "failed";

  completeActiveReasoning(ctx, events, finalStatus);
  if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
    completeActiveAssistantMessage(ctx, events, finalStatus);
  } else if (!ctx.hasStartedAgentMessage) {
    ctx.hasStartedAgentMessage = true;
    const finalContent: JsonValue[] = [];
    if (ctx.reasoningText) {
      finalContent.push({ type: "reasoning", text: ctx.reasoningText });
    }
    if (ctx.assistantText || error) {
      finalContent.push({ type: "text", text: ctx.assistantText || error || "" });
    }
    events.push({
      kind: "item/completed",
      threadId,
      turnId,
      item: {
        id: ctx.currentAssistantItemId || `pi-msg-${turnId}-0`,
        turnId,
        threadId,
        role: "assistant",
        type: "agentMessage",
        status: finalStatus,
        text: ctx.assistantText || error || "",
        content: finalContent,
        completedAt: Math.floor(Date.now() / 1000),
      },
    });
  }

  ctx.status = reason;
  if (reason === "completed") {
    events.push({ kind: "turn/completed", threadId, turnId, usage: ctx.lastUsage });
  } else if (reason === "interrupted") {
    events.push({ kind: "turn/interrupted", threadId, turnId });
  } else {
    events.push({ kind: "turn/failed", threadId, turnId, error });
  }

  return events;
}
