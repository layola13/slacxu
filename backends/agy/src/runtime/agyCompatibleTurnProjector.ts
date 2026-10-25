import type { JsonRpcNotification, JsonValue } from "@codex-ui/shared";
import type {
  AgyEvent,
  AgyInitEvent,
  AgyStepUpdateEvent,
  AgyResultEvent,
  AgyUsage,
} from "./agyCompatibleProtocol.js";

export interface AgyProjectedQuestion {
  id: string;
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
  isOther?: boolean;
  isSecret?: boolean;
}

export type AgyProjectedEvent =
  | { kind: "turn/started"; threadId: string; turnId: string }
  | { kind: "turn/completed"; threadId: string; turnId: string }
  | { kind: "turn/failed"; threadId: string; turnId: string; error?: string }
  | { kind: "turn/interrupted"; threadId: string; turnId: string }
  | { kind: "thread/tokenUsage/updated"; threadId: string; turnId: string; tokenUsage: Record<string, JsonValue> }
  | { kind: "item/agentMessage/delta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/reasoning/textDelta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/started"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | { kind: "item/completed"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | { kind: "system/init"; threadId: string; conversationId: string; cwd?: string; tools?: string[] }
  | { kind: "question/asked"; threadId: string; turnId: string; questionId: string; questions: AgyProjectedQuestion[] };

export interface AgyProjectorContext {
  threadId: string;
  turnId: string;
  conversationId?: string;
  status: "running" | "completed" | "failed" | "interrupted";
  textSegmentSeq: number;
  currentAssistantItemId: string;
  currentAssistantText: string;
  hasStartedCurrentAssistantMessage: boolean;
  hasCompletedCurrentAssistantMessage: boolean;
  currentReasoningItemId: string;
  currentReasoningText: string;
  assistantItemId: string;
  reasoningItemId: string;
  assistantText: string;
  reasoningText: string;
  hasStartedTurn: boolean;
  hasStartedAgentMessage: boolean;
  hasStartedCurrentReasoning: boolean;
  hasCompletedCurrentReasoning: boolean;
  activeToolItems: Map<string, Record<string, JsonValue>>;
  completedToolIds: Set<string>;
  pendingQuestionId?: string;
  awaitingQuestion?: boolean;
}

function projectAgyUsage(usage: AgyUsage): Record<string, JsonValue> | null {
  const inputTokens = Number(usage.input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  const reasoningOutputTokens = Number(usage.thinking_tokens ?? 0);
  const cachedInputTokens = Number(usage.cache_read_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens + reasoningOutputTokens);
  if (![inputTokens, outputTokens, reasoningOutputTokens, cachedInputTokens, totalTokens].every(Number.isFinite)) return null;
  const breakdown = {
    totalTokens: Math.max(0, totalTokens),
    inputTokens: Math.max(0, inputTokens),
    cachedInputTokens: Math.max(0, cachedInputTokens),
    cacheWriteInputTokens: 0,
    outputTokens: Math.max(0, outputTokens),
    reasoningOutputTokens: Math.max(0, reasoningOutputTokens),
  } as Record<string, JsonValue>;
  const contextUsage = {
    ...breakdown,
    totalTokens: Math.max(0, inputTokens + cachedInputTokens),
    outputTokens: 0,
    reasoningOutputTokens: 0,
  } as Record<string, JsonValue>;
  const raw = usage as AgyUsage & Record<string, unknown>;
  const contextWindow = Number(raw.context_window ?? raw.contextWindow ?? raw.max_input_tokens ?? 0);
  return {
    total: breakdown,
    last: breakdown,
    contextUsage,
    ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { modelContextWindow: contextWindow } : {}),
  };
}

function usageEvent(ctx: AgyProjectorContext, usage: AgyUsage | undefined): AgyProjectedEvent | null {
  if (!usage) return null;
  const tokenUsage = projectAgyUsage(usage);
  return tokenUsage ? { kind: "thread/tokenUsage/updated", threadId: ctx.threadId, turnId: ctx.turnId, tokenUsage } : null;
}

export function createAgyProjectorContext(threadId: string, turnId: string): AgyProjectorContext {
  const initialAssistantItemId = `agy-msg-${turnId}-0`;
  const initialReasoningItemId = `agy-thought-${turnId}-0`;
  return {
    threadId,
    turnId,
    status: "running",
    textSegmentSeq: 0,
    currentAssistantItemId: initialAssistantItemId,
    currentAssistantText: "",
    hasStartedCurrentAssistantMessage: false,
    hasCompletedCurrentAssistantMessage: false,
    currentReasoningItemId: initialReasoningItemId,
    currentReasoningText: "",
    assistantItemId: initialAssistantItemId,
    reasoningItemId: initialReasoningItemId,
    assistantText: "",
    reasoningText: "",
    hasStartedTurn: false,
    hasStartedAgentMessage: false,
    hasStartedCurrentReasoning: false,
    hasCompletedCurrentReasoning: false,
    activeToolItems: new Map(),
    completedToolIds: new Set(),
    awaitingQuestion: false,
  };
}

export function parseAskQuestionData(rawQuestions: unknown, stepIndex: number, fallbackHeader?: string): AgyProjectedQuestion[] {
  let parsed: any[] = [];
  if (typeof rawQuestions === "string") {
    try {
      parsed = JSON.parse(rawQuestions);
    } catch {
      parsed = [{ question: rawQuestions, options: [rawQuestions] }];
    }
  } else if (Array.isArray(rawQuestions)) {
    parsed = rawQuestions;
  } else if (rawQuestions && typeof rawQuestions === "object") {
    parsed = [rawQuestions];
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  return parsed.map((item, idx) => {
    if (typeof item === "string") {
      item = { question: item, options: [item] };
    }
    const qText = String(item.question || item.text || `Question ${idx + 1}`);
    const rawOptions = Array.isArray(item.options) ? item.options : [];
    const options = rawOptions.map((opt: unknown) => {
      if (typeof opt === "string") {
        return { label: opt, description: "" };
      }
      if (opt && typeof opt === "object") {
        const o = opt as Record<string, any>;
        return {
          label: String(o.label || o.text || o.option || ""),
          description: String(o.description || ""),
        };
      }
      return { label: String(opt), description: "" };
    }).filter((o: { label: string }) => Boolean(o.label.trim()));
    const multiSelect = item.is_multi_select === true || item.isMultiSelect === true || item.multiSelect === true;
    const header = String(item.header || fallbackHeader || qText.slice(0, 12) || `Question ${idx + 1}`);

    return {
      id: `q-${stepIndex}-${idx}`,
      header,
      question: qText,
      options,
      multiSelect,
      isOther: item.isOther === true,
      isSecret: item.isSecret === true,
    };
  });
}

export function parseAgyAskAnswerContent(content: unknown): { answers: string[]; allSkipped: boolean } | null {
  if (typeof content !== "string" || !content) return null;
  const lines = content.split("\n");
  const answers: string[] = [];
  let matched = 0;
  for (const line of lines) {
    const m = line.match(/^A(\d+):\s*(.*)$/);
    if (m) {
      matched += 1;
      answers[Number(m[1]) - 1] = (m[2] ?? "").trim();
    }
  }
  if (matched === 0) return null;
  const allSkipped = answers.length > 0 && answers.every((a) => /user\s*skipped/i.test(a));
  return { answers, allSkipped };
}

export function extractNewResponseText(responseText: string, globalAssistantText: string): string {
  if (!responseText) return "";
  if (responseText === globalAssistantText) return "";
  if (globalAssistantText.includes(responseText)) return "";
  if (responseText.startsWith(globalAssistantText)) {
    return responseText.slice(globalAssistantText.length);
  }
  // Check for overlap: find longest overlap where suffix of globalAssistantText matches prefix of responseText
  const maxOverlap = Math.min(globalAssistantText.length, responseText.length);
  for (let len = maxOverlap; len > 0; len -= 1) {
    if (globalAssistantText.endsWith(responseText.slice(0, len))) {
      return responseText.slice(len);
    }
  }
  return responseText;
}

function startNewAgySegment(ctx: AgyProjectorContext): void {
  ctx.textSegmentSeq += 1;
  ctx.currentAssistantItemId = `agy-msg-${ctx.turnId}-${ctx.textSegmentSeq}`;
  ctx.currentAssistantText = "";
  ctx.currentReasoningItemId = `agy-thought-${ctx.turnId}-${ctx.textSegmentSeq}`;
  ctx.currentReasoningText = "";
  ctx.assistantItemId = ctx.currentAssistantItemId;
  ctx.reasoningItemId = ctx.currentReasoningItemId;
  ctx.hasStartedCurrentAssistantMessage = false;
  ctx.hasCompletedCurrentAssistantMessage = false;
  ctx.hasStartedCurrentReasoning = false;
  ctx.hasCompletedCurrentReasoning = false;
}

function completeActiveAssistantMessage(
  ctx: AgyProjectorContext,
  events: AgyProjectedEvent[],
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
  if (
    (ctx.hasStartedCurrentAssistantMessage || ctx.currentReasoningText.length > 0) &&
    !ctx.hasCompletedCurrentAssistantMessage
  ) {
    ctx.hasCompletedCurrentAssistantMessage = true;
    const finalContent: JsonValue[] = [];
    if (ctx.currentReasoningText) {
      finalContent.push({ type: "reasoning", text: ctx.currentReasoningText });
    }
    if (ctx.currentAssistantText) {
      finalContent.push({ type: "text", text: ctx.currentAssistantText, text_elements: [] });
    }
    events.push({
      kind: "item/completed",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        type: "agentMessage",
        id: ctx.currentAssistantItemId,
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        content: finalContent.length > 0 ? finalContent : [{ type: "text", text: ctx.currentAssistantText, text_elements: [] }],
        text: ctx.currentAssistantText,
        role: "assistant",
        status,
        completedAt: Math.floor(Date.now() / 1000),
      },
    });
  }
}

function completePendingAgyTools(
  ctx: AgyProjectorContext,
  events: AgyProjectedEvent[],
  status: "completed" | "failed" | "interrupted" = "completed"
): void {
  for (const [callId, toolItem] of ctx.activeToolItems) {
    if (ctx.completedToolIds.has(callId)) continue;
    ctx.completedToolIds.add(callId);
    events.push({
      kind: "item/completed",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        ...toolItem,
        status,
        completedAt: Math.floor(Date.now() / 1000),
      },
    });
  }
}

export function projectAgyEvent(
  event: AgyEvent,
  ctx: AgyProjectorContext,
): AgyProjectedEvent[] {
  const events: AgyProjectedEvent[] = [];
  const { threadId, turnId } = ctx;

  if (ctx.status !== "running") {
    return events;
  }

  // Ensure turn/started is emitted on the first event
  if (!ctx.hasStartedTurn && event.event !== "init") {
    ctx.hasStartedTurn = true;
    events.push({ kind: "turn/started", threadId, turnId });
  }

  switch (event.event) {
    case "init": {
      const init = event as AgyInitEvent;
      ctx.conversationId = init.conversation_id;
      events.push({
        kind: "system/init",
        threadId,
        conversationId: init.conversation_id,
        cwd: init.init?.cwd,
        tools: init.init?.tools,
      });
      if (!ctx.hasStartedTurn) {
        ctx.hasStartedTurn = true;
        events.push({ kind: "turn/started", threadId, turnId });
      }
      break;
    }

    case "step_update": {
      const update = (event as AgyStepUpdateEvent).step_update;
      if (!update) break;

      const updateUsage = usageEvent(ctx, update.usage);
      if (updateUsage) events.push(updateUsage);

      // 1. Handle Assistant message delta
      if (update.step_type === "agent_response" || update.step_type === "planner_response") {
        if (update.text_delta) {
          ctx.assistantText += update.text_delta;
          ctx.hasStartedAgentMessage = true;

          if (ctx.hasCompletedCurrentAssistantMessage) {
            startNewAgySegment(ctx);
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

          ctx.currentAssistantText += update.text_delta;
          events.push({
            kind: "item/agentMessage/delta",
            threadId,
            turnId,
            itemId: ctx.currentAssistantItemId,
            delta: update.text_delta,
          });
        }
      }

      // 2. Handle Thinking / Reasoning delta
      if (update.thinking_delta) {
        if (ctx.hasCompletedCurrentAssistantMessage) {
          startNewAgySegment(ctx);
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
            },
          });
        }
        ctx.reasoningText += update.thinking_delta;
        ctx.currentReasoningText += update.thinking_delta;
        events.push({
          kind: "item/reasoning/textDelta",
          threadId,
          turnId,
          itemId: ctx.currentReasoningItemId,
          delta: update.thinking_delta,
        });
      }

      // 3. Handle Tool Calls
      if (Array.isArray(update.tool_calls) && update.tool_calls.length > 0) {
        if (
          (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) ||
          (ctx.hasStartedCurrentReasoning && !ctx.hasCompletedCurrentReasoning)
        ) {
          completeActiveAssistantMessage(ctx, events);
        }
        for (const tc of update.tool_calls) {
          if (tc.name === "ask_question") {
            const rawQ = (tc.input as any)?.questions ?? (tc as any).args?.questions;
            const headerFallback = (tc as any).toolAction ?? (tc as any).toolSummary ?? (update as any).toolAction ?? (update as any).toolSummary;
            const qList = parseAskQuestionData(rawQ, update.step_index, typeof headerFallback === "string" ? headerFallback : undefined);
            if (qList.length > 0) {
              const questionId = `agy-ask-${turnId}-${update.step_index}`;
              ctx.pendingQuestionId = questionId;
              ctx.awaitingQuestion = true;
              events.push({
                kind: "question/asked",
                threadId,
                turnId,
                questionId,
                questions: qList,
              });
            }
          }
          const callId = tc.id || `agy-tool-${turnId}-${update.step_index}`;
          // Params may arrive under `input` or `args` depending on the CLI
          // surface; read both so rows render arguments instead of {}.
          const toolInput = ((tc.input ?? (tc as any).args) ?? {}) as JsonValue;
          const toolSummary = [(tc as any).toolAction, (tc as any).toolSummary, (tc as any).content]
            .find((v): v is string => typeof v === "string" && v.trim().length > 0);
          const toolItem: Record<string, JsonValue> = {
            type: "toolCall",
            id: callId,
            threadId,
            turnId,
            name: tc.name,
            tool: tc.name,
            toolName: tc.name,
            input: toolInput,
            arguments: toolInput,
            ...(toolSummary ? { output: toolSummary } : {}),
            status: update.state === "DONE" ? "completed" : "in_progress",
          };
          if (!ctx.activeToolItems.has(callId)) {
            ctx.activeToolItems.set(callId, toolItem);
            events.push({ kind: "item/started", threadId, turnId, item: toolItem });
          }
          if (update.state === "DONE") {
            ctx.completedToolIds.add(callId);
            events.push({ kind: "item/completed", threadId, turnId, item: toolItem });
          }
        }
      } else if (update.step_type === "tool" || (update as any).tool_name || (update as any).tool_info) {
        if (
          (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) ||
          (ctx.hasStartedCurrentReasoning && !ctx.hasCompletedCurrentReasoning)
        ) {
          completeActiveAssistantMessage(ctx, events);
        }
        const rawTool = update as any;
        const toolName = rawTool.tool_name || rawTool.tool_info?.name || "tool";
        if (toolName === "ask_question") {
          const rawQ = rawTool.tool_info?.parameters?.questions ?? rawTool.parameters?.questions ?? (rawTool as any).args?.questions;
          const headerFallback = rawTool.toolAction ?? rawTool.toolSummary ?? rawTool.tool_info?.toolAction ?? rawTool.tool_info?.toolSummary;
          const qList = parseAskQuestionData(rawQ, update.step_index, typeof headerFallback === "string" ? headerFallback : undefined);
          if (qList.length > 0) {
            const questionId = `agy-ask-${turnId}-${update.step_index}`;
            ctx.pendingQuestionId = questionId;
            ctx.awaitingQuestion = true;
            events.push({
              kind: "question/asked",
              threadId,
              turnId,
              questionId,
              questions: qList,
            });
          }
        }
        const callId = `agy-tool-${turnId}-${update.step_index}`;
        const isDone = update.state === "DONE" || update.state === "ERROR";
        const toolArgs = ((rawTool.tool_info?.parameters ?? rawTool.parameters ?? rawTool.input ?? (rawTool as any).args) ?? {}) as JsonValue;
        const toolSummary = [rawTool.toolAction, rawTool.toolSummary, rawTool.tool_info?.toolAction, rawTool.tool_info?.toolSummary, rawTool.content]
          .find((v): v is string => typeof v === "string" && v.trim().length > 0);
        const toolItem: Record<string, JsonValue> = {
          type: "toolCall",
          id: callId,
          threadId,
          turnId,
          name: toolName,
          tool: toolName,
          toolName,
          input: toolArgs,
          arguments: toolArgs,
          status: isDone ? "completed" : "in_progress",
          ...(rawTool.tool_info?.output != null ? { output: rawTool.tool_info.output } : {}),
          ...(rawTool.tool_info?.output == null && toolSummary ? { output: toolSummary } : {}),
        };
        if (!ctx.activeToolItems.has(callId)) {
          ctx.activeToolItems.set(callId, toolItem);
          events.push({ kind: "item/started", threadId, turnId, item: toolItem });
        }
        if (isDone) {
          ctx.completedToolIds.add(callId);
          events.push({ kind: "item/completed", threadId, turnId, item: toolItem });
        }
      }
      break;
    }

    case "result": {
      const res = (event as AgyResultEvent).result;
      const isSuccess = res.status === "SUCCESS";
      ctx.status = isSuccess ? "completed" : "failed";

      const responseText = res.response ?? "";
      const resultUsage = usageEvent(ctx, res.usage);
      if (resultUsage) events.push(resultUsage);

      if (
        (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) ||
        (ctx.hasStartedCurrentReasoning && !ctx.hasCompletedCurrentReasoning)
      ) {
        const delta = extractNewResponseText(responseText, ctx.assistantText);
        if (delta) {
          ctx.currentAssistantText += delta;
          ctx.assistantText += delta;
          events.push({
            kind: "item/agentMessage/delta",
            threadId,
            turnId,
            itemId: ctx.currentAssistantItemId,
            delta,
          });
        }
        completeActiveAssistantMessage(ctx, events, isSuccess ? "completed" : "failed");
      } else if (ctx.hasCompletedCurrentAssistantMessage) {
        // Prior segment was already completed (e.g. before tools).
        // Check if responseText contains new content not yet emitted in prior segments.
        const newContent = extractNewResponseText(responseText, ctx.assistantText);
        if (newContent && newContent.trim().length > 0) {
          startNewAgySegment(ctx);
          ctx.currentAssistantText = newContent;
          ctx.assistantText += newContent;
          ctx.hasStartedCurrentAssistantMessage = true;
          ctx.hasCompletedCurrentAssistantMessage = true;

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
          events.push({
            kind: "item/agentMessage/delta",
            threadId,
            turnId,
            itemId: ctx.currentAssistantItemId,
            delta: newContent,
          });
          events.push({
            kind: "item/completed",
            threadId,
            turnId,
            item: {
              type: "agentMessage",
              id: ctx.currentAssistantItemId,
              threadId,
              turnId,
              content: [{ type: "text", text: newContent, text_elements: [] }],
              text: newContent,
              role: "assistant",
              status: isSuccess ? "completed" : "failed",
              completedAt: Math.floor(Date.now() / 1000),
            },
          });
        }
      } else {
        // No segment was started before (e.g. non-streaming turn or manual ctx.assistantText)
        const finalResponse = ctx.assistantText.length > 0 ? ctx.assistantText : responseText;
        if (finalResponse.length > 0) {
          events.push({
            kind: "item/completed",
            threadId,
            turnId,
            item: {
              type: "agentMessage",
              id: ctx.assistantItemId,
              threadId,
              turnId,
              content: [{ type: "text", text: finalResponse, text_elements: [] }],
              text: finalResponse,
              role: "assistant",
              status: isSuccess ? "completed" : "failed",
              completedAt: Math.floor(Date.now() / 1000),
            },
          });
        }
      }

      completePendingAgyTools(ctx, events, isSuccess ? "completed" : "failed");

      events.push({
        kind: isSuccess ? "turn/completed" : "turn/failed",
        threadId,
        turnId,
        error: isSuccess ? undefined : (res.error || res.response || "AGY execution failed"),
      });
      break;
    }
  }

  return events;
}

export function toAgyNotification(event: AgyProjectedEvent): JsonRpcNotification | null {
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
        params: { threadId: event.threadId, turnId: event.turnId, turn: { id: event.turnId, threadId: event.threadId, status: "failed", error: event.error ?? null } } as unknown as Record<string, JsonValue>,
      };
    case "turn/interrupted":
      return {
        method: "turn/interrupted",
        params: { threadId: event.threadId, turnId: event.turnId, turn: { id: event.turnId, threadId: event.threadId, status: "interrupted" } },
      };
    case "thread/tokenUsage/updated":
      return {
        method: "thread/tokenUsage/updated",
        params: { threadId: event.threadId, turnId: event.turnId, tokenUsage: event.tokenUsage },
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
        method: "agy/init",
        params: { threadId: event.threadId, conversationId: event.conversationId, cwd: event.cwd ?? null } as unknown as Record<string, JsonValue>,
      };
    default:
      return null;
  }
}

export function forceTerminateAgy(ctx: AgyProjectorContext, reason: "failed" | "interrupted" = "interrupted", detail?: string): AgyProjectedEvent[] {
  if (ctx.status !== "running") return [];
  ctx.status = reason;
  const events: AgyProjectedEvent[] = [];
  const terminalStatus = reason === "interrupted" ? "interrupted" : "failed";
  if (
    (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) ||
    (ctx.hasStartedCurrentReasoning && !ctx.hasCompletedCurrentReasoning)
  ) {
    completeActiveAssistantMessage(ctx, events, terminalStatus);
  }
  completePendingAgyTools(ctx, events, terminalStatus);
  events.push({
    kind: reason === "interrupted" ? "turn/interrupted" : "turn/failed",
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    error: reason === "failed" ? (detail || "Process terminated abruptly") : undefined,
  });
  return events;
}
