import type { JsonRpcNotification, JsonValue } from "@codex-ui/shared";
import { STORM_STALLED_AFTER_ATTEMPTS, STORM_STALLED_AFTER_MS } from "@cxu/sdk-backend";
import type {
  OpencodeSseEvent,
  OpencodeMessagePartUpdatedEvent,
  OpencodeMessagePartDeltaEvent,
  OpencodePermissionAskedEvent,
  OpencodeQuestionAskedEvent,
  OpencodeSessionErrorEvent,
  OpencodeSessionStatusEvent,
  OpencodeTodoUpdatedEvent,
  OpencodeToolPart,
  OpencodeTextPart,
  OpencodeReasoningPart,
  OpencodeStepFinishPart,
} from "./opencodeCompatibleProtocol.js";

export type OpencodeProjectedEvent =
  | { kind: "turn/started"; threadId: string; turnId: string }
  | { kind: "turn/completed"; threadId: string; turnId: string }
  | { kind: "turn/failed"; threadId: string; turnId: string; error?: string }
  | { kind: "turn/interrupted"; threadId: string; turnId: string }
  | {
      kind: "thread/tokenUsage/updated";
      threadId: string;
      turnId: string;
      tokenUsage: Record<string, unknown>;
      /** Stable per-upstream-call id (opencode step id), for ledger dedup. */
      requestId?: string;
    }
  | { kind: "item/agentMessage/delta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/reasoning/textDelta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/started"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | { kind: "item/completed"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | {
      kind: "permission/asked";
      threadId: string;
      turnId: string;
      requestId: string;
      permission: string;
      patterns: string[];
      always?: string[];
      metadata?: Record<string, unknown>;
      tool?: { messageID: string; callID: string };
    }
  | {
      kind: "question/asked";
      threadId: string;
      turnId: string;
      requestId: string;
      questions: NormalizedOpencodeQuestion[];
    }
  | { kind: "system/init"; threadId: string; sessionId: string };

export interface OpencodeProjectorContext {
  threadId: string;
  turnId: string;
  sessionId?: string;
  status: "running" | "completed" | "failed" | "interrupted";
  startedAtMs: number;
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
  partTypes: Map<string, "text" | "reasoning" | "tool">;
  partTexts: Map<string, string>;
  messageRoles: Map<string, string>;
  /** todowrite calls seen before any projectable todos arrived (no rows emitted yet). */
  pendingPlanCandidates: Set<string>;
  /** Whether the per-turn plan item has been started (plan id is stable per turn). */
  planStarted: boolean;
  /** Last emitted plan steps JSON, to refresh the row only on change. */
  lastPlanStepsJson: string;
  /** Context window size in tokens, if known. */
  contextWindow?: number;
  /** Last wall-clock ms any streaming activity (delta/part/tool/question/permission) arrived. */
  lastActivityMs: number;
  /** Wall-clock ms an idle arrived but was deferred for quiescence; null when none pending. */
  deferredIdleAtMs: number | null;
  /** Wall-clock ms an upstream retry/error signature was seen; null when clean. */
  upstreamIssueAtMs: number | null;
  /** Upstream issue message for failure classification on later idle. */
  upstreamIssueMsg: string | null;
  upstreamRetryAttempts: number;
}

export function createOpencodeProjectorContext(
  threadId: string,
  turnId: string,
  options?: { contextWindow?: number },
): OpencodeProjectorContext {
  const initialAssistantItemId = `opencode-msg-${turnId}-0`;
  const initialReasoningItemId = `opencode-thought-${turnId}-0`;
  const now = Date.now();
  return {
    threadId,
    turnId,
    status: "running",
    startedAtMs: now,
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
    partTypes: new Map(),
    partTexts: new Map(),
    messageRoles: new Map(),
    pendingPlanCandidates: new Set(),
    planStarted: false,
    lastPlanStepsJson: "",
    contextWindow: options?.contextWindow,
    lastActivityMs: now,
    deferredIdleAtMs: null,
    upstreamIssueAtMs: null,
    upstreamIssueMsg: null,
    upstreamRetryAttempts: 0,
  };
}

export interface OpencodeRawTokens {
  total?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: {
    read?: number;
    write?: number;
  };
}

export function buildOpencodeTokenUsage(
  tokens: OpencodeRawTokens,
  contextWindow?: number,
): Record<string, unknown> {
  const inputTokens = Math.max(0, Number(tokens.input ?? 0));
  const outputTokens = Math.max(0, Number(tokens.output ?? 0));
  const reasoningTokens = Math.max(0, Number(tokens.reasoning ?? 0));
  const cachedTokens = Math.max(0, Number(tokens.cache?.read ?? 0));
  const cacheWriteTokens = Math.max(0, Number(tokens.cache?.write ?? 0));
  const totalTokens = Math.max(
    0,
    Number(tokens.total ?? (inputTokens + outputTokens + reasoningTokens + cachedTokens + cacheWriteTokens)),
  );

  const last = {
    totalTokens,
    inputTokens,
    cachedInputTokens: cachedTokens,
    cacheWriteInputTokens: cacheWriteTokens,
    outputTokens,
    reasoningOutputTokens: reasoningTokens,
  };
  const total = { ...last };
  const contextUsage = {
    ...last,
    totalTokens: inputTokens + cachedTokens,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };

  return {
    total,
    last,
    contextUsage,
    ...(typeof contextWindow === "number" && contextWindow > 0 ? { modelContextWindow: contextWindow } : {}),
  };
}

export function startNewOpencodeSegment(ctx: OpencodeProjectorContext): void {
  ctx.textSegmentSeq += 1;
  ctx.currentAssistantItemId = `opencode-msg-${ctx.turnId}-${ctx.textSegmentSeq}`;
  ctx.currentAssistantText = "";
  ctx.currentReasoningItemId = `opencode-thought-${ctx.turnId}-${ctx.textSegmentSeq}`;
  ctx.currentReasoningText = "";
  ctx.assistantItemId = ctx.currentAssistantItemId;
  ctx.reasoningItemId = ctx.currentReasoningItemId;
  ctx.hasStartedCurrentAssistantMessage = false;
  ctx.hasCompletedCurrentAssistantMessage = false;
  ctx.hasStartedCurrentReasoning = false;
  ctx.hasCompletedCurrentReasoning = false;
}

export function completeActiveReasoning(
  ctx: OpencodeProjectorContext,
  events: OpencodeProjectedEvent[],
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

export function completeActiveAssistantMessage(
  ctx: OpencodeProjectorContext,
  events: OpencodeProjectedEvent[],
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

export function opencodeIdleIsStale(ctx: OpencodeProjectorContext): boolean {
  const hasActivity = ctx.hasStartedAgentMessage
    || ctx.hasStartedCurrentReasoning
    || ctx.activeToolItems.size > 0
    || ctx.assistantText.length > 0
    || ctx.reasoningText.length > 0;
  return !hasActivity && Date.now() - ctx.startedAtMs < 1500;
}

/** Idle quiescence window: an idle arriving within this ms of streaming activity is deferred. */
export const OPENCODE_IDLE_QUIESCE_MS = 2500;
export const OPENCODE_UPSTREAM_RETRY_GRACE_MS = STORM_STALLED_AFTER_MS;
export const OPENCODE_UPSTREAM_RETRY_MAX_ATTEMPTS = STORM_STALLED_AFTER_ATTEMPTS;

export function markOpencodeActivity(ctx: OpencodeProjectorContext, now = Date.now()): void {
  ctx.lastActivityMs = now;
  ctx.deferredIdleAtMs = null;
  // Forward progress after an upstream retry/error clears the failure taint:
  // without this, a recovery delta landing in the same millisecond as the
  // retry would still satisfy `lastActivityMs <= upstreamIssueAtMs`.
  ctx.upstreamIssueAtMs = null;
  ctx.upstreamIssueMsg = null;
  ctx.upstreamRetryAttempts = 0;
}

function hasOpenOpencodeTools(ctx: OpencodeProjectorContext): boolean {
  for (const tool of ctx.activeToolItems.values()) {
    const rec = tool as Record<string, unknown>;
    const status = String(rec.status ?? "");
    if (status !== "in_progress" && status !== "inProgress") continue;
    // Unlinked collab phantoms never resolve server-side; turn-end marks them
    // interrupted instead of hanging the turn (Codex parity for background
    // cleanup). Only real running tools block idle completion.
    if (rec.type === "collabAgentToolCall") {
      const receivers = (rec as { receiverThreadIds?: unknown }).receiverThreadIds;
      if (!Array.isArray(receivers) || receivers.length === 0) continue;
    }
    return true;
  }
  return false;
}

/** True when idle must wait: open tools or streaming activity too recent. */
export function shouldDeferOpencodeIdle(ctx: OpencodeProjectorContext, now = Date.now()): boolean {
  if (hasOpenOpencodeTools(ctx)) return true;
  if (now - ctx.lastActivityMs < OPENCODE_IDLE_QUIESCE_MS) return true;
  return false;
}

export function recordOpencodeUpstreamIssue(
  ctx: OpencodeProjectorContext,
  msg: string,
  now = Date.now(),
  attempt?: number,
): void {
  if (!msg) return;
  if (ctx.upstreamIssueAtMs == null) ctx.upstreamIssueAtMs = now;
  ctx.upstreamIssueMsg = msg.slice(0, 500);
  ctx.upstreamRetryAttempts = Number.isFinite(attempt)
    ? Math.max(ctx.upstreamRetryAttempts, Math.floor(attempt!))
    : ctx.upstreamRetryAttempts + 1;
  ctx.deferredIdleAtMs = null;
}

function shouldFailIdleAsUpstream(ctx: OpencodeProjectorContext, now = Date.now()): boolean {
  if (ctx.upstreamIssueAtMs == null || !ctx.upstreamIssueMsg) return false;
  return ctx.lastActivityMs <= ctx.upstreamIssueAtMs
    && (ctx.upstreamRetryAttempts >= OPENCODE_UPSTREAM_RETRY_MAX_ATTEMPTS
      || now - ctx.upstreamIssueAtMs >= OPENCODE_UPSTREAM_RETRY_GRACE_MS);
}

// ---------------------------------------------------------------------------
// Task list (todowrite) projection.
//
// Codex renders its task list from `turn/plan/updated` as a `plan` item that
// both the waterfall checklist and the floating task panel consume
// (`payload.plan: [{step, status}]`). opencode's `todowrite` tool replaces the
// whole list per call, so each call maps onto the same per-turn plan item —
// exactly like the Claude TodoWrite precedent, and without a duplicate raw
// tool row.
// ---------------------------------------------------------------------------

export type OpencodePlanStepStatus = "pending" | "in_progress" | "completed";

export interface OpencodePlanStep {
  step: string;
  status: OpencodePlanStepStatus;
}

/** Frontend `requestUserInput` question (same shape Codex/mini send the modal). */
export interface NormalizedOpencodeQuestion {
  id: string;
  question: string;
  header?: string;
  options?: Array<{ label: string; description: string }>;
  is_multi_select?: boolean;
  // Mirrors official opencode `QuestionV2.Info.custom` (default true).
  // False disables free-text input; true/undefined allows "type your own answer".
  custom?: boolean;
}

/** Tool calls fully replaced by the plan item (no raw tool row emitted). */
export function isOpencodePlanToolName(toolName: string): boolean {
  const norm = toolName.trim().toLowerCase().replace(/[_-]/g, "");
  return norm === "todowrite" || norm === "settodo" || norm === "sessiontodo";
}

function opencodePlanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function opencodePlanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOpencodePlanStatus(value: unknown): OpencodePlanStepStatus {
  const normalized = typeof value === "string" ? value.replace(/[_-]+/g, "").toLowerCase() : "";
  if (normalized === "completed" || normalized === "complete" || normalized === "done") return "completed";
  if (normalized === "inprogress" || normalized === "running" || normalized === "started") return "in_progress";
  return "pending";
}

/**
 * Extract the full todo list from a `todowrite` call. Reads direct array,
 * `input.todos` / `tasks` / `plan` / `steps`, falling back to a JSON `output`.
 * Returns null when nothing projectable is present — the caller then falls
 * back to a plain tool row instead of swallowing the call.
 */
export function extractOpencodePlanSteps(input: unknown, output?: unknown): OpencodePlanStep[] | null {
  const fromDirectInput = opencodePlanStepsFromValue(input);
  if (fromDirectInput) return fromDirectInput;
  const inRec = opencodePlanRecord(input);
  const fromInput = opencodePlanStepsFromValue(inRec.todos ?? inRec.tasks ?? inRec.plan ?? inRec.steps);
  if (fromInput) return fromInput;
  if (typeof output === "string" && output.trim()) {
    try {
      const parsed: unknown = JSON.parse(output);
      const fromParsedDirect = opencodePlanStepsFromValue(parsed);
      if (fromParsedDirect) return fromParsedDirect;
      const outRec = opencodePlanRecord(parsed);
      const fromOutput = opencodePlanStepsFromValue(outRec.todos ?? outRec.tasks ?? outRec.plan ?? outRec.steps);
      if (fromOutput) return fromOutput;
    } catch {
      // Not JSON — no plan projectable.
    }
  }
  return null;
}

function opencodePlanStepsFromValue(value: unknown): OpencodePlanStep[] | null {
  if (!Array.isArray(value)) return null;
  const steps: OpencodePlanStep[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      steps.push({ step: entry.trim(), status: "pending" });
      continue;
    }
    const todo = opencodePlanRecord(entry);
    const step = opencodePlanString(todo.content)
      ?? opencodePlanString(todo.subject)
      ?? opencodePlanString(todo.step)
      ?? opencodePlanString(todo.title)
      ?? opencodePlanString(todo.task);
    if (!step) continue;
    steps.push({ step, status: normalizeOpencodePlanStatus(todo.status) });
  }
  return steps.length > 0 ? steps : null;
}

export function opencodePlanItemId(turnId: string): string {
  return `opencode-plan-${turnId}`;
}

/** The `plan` item to emit for the current list (Codex `turn/plan/updated` shape). */
export function buildOpencodePlanItem(
  threadId: string,
  turnId: string,
  steps: OpencodePlanStep[],
  status?: string,
): Record<string, JsonValue> {
  const derived = steps.some((entry) => entry.status === "in_progress")
    ? "inProgress"
    : steps.length > 0 && steps.every((entry) => entry.status === "completed")
      ? "completed"
      : "pending";
  return {
    type: "plan",
    id: opencodePlanItemId(turnId),
    threadId,
    turnId,
    plan: steps.map((entry) => ({ step: entry.step, status: entry.status })) as JsonValue,
    text: steps
      .map((entry) => {
        if (entry.status === "completed") return "- [x] " + entry.step;
        if (entry.status === "in_progress") return "- [ ] " + entry.step + " _(in progress)_";
        return "- [ ] " + entry.step;
      })
      .join("\n"),
    status: status ?? derived,
  };
}

/** Emit (or refresh) the per-turn plan item when the steps changed. */
function pushOpencodePlanUpdate(
  ctx: OpencodeProjectorContext,
  events: OpencodeProjectedEvent[],
  steps: OpencodePlanStep[],
  status?: string,
): void {
  const stepsJson = JSON.stringify(steps);
  if (ctx.planStarted && ctx.lastPlanStepsJson === stepsJson && status === undefined) return;
  ctx.planStarted = true;
  ctx.lastPlanStepsJson = stepsJson;
  events.push({
    kind: "item/started",
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    item: buildOpencodePlanItem(ctx.threadId, ctx.turnId, steps, status),
  });
}

function completeOpencodePlan(
  ctx: OpencodeProjectorContext,
  events: OpencodeProjectedEvent[],
  steps: OpencodePlanStep[],
  status: "completed" | "failed" | "interrupted",
): void {
  ctx.planStarted = true;
  ctx.lastPlanStepsJson = JSON.stringify(steps);
  events.push({
    kind: "item/completed",
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    item: buildOpencodePlanItem(ctx.threadId, ctx.turnId, steps, status === "failed" || status === "interrupted" ? status : undefined),
  });
}

/**
 * Close plan-tool candidates that never produced todos as plain tool rows,
 * preserving today's visibility for denied/never-ran calls.
 */
function flushOpencodePlanCandidates(
  ctx: OpencodeProjectorContext,
  events: OpencodeProjectedEvent[],
  status: "completed" | "failed" | "interrupted",
): void {
  for (const callId of ctx.pendingPlanCandidates) {
    const started: Record<string, JsonValue> = {
      type: "toolCall",
      id: callId,
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      name: "todowrite",
      tool: "todowrite",
      toolName: "todowrite",
      input: {},
      arguments: {},
      status: "in_progress",
    };
    const finished: Record<string, JsonValue> = { ...started, status };
    events.push({ kind: "item/started", threadId: ctx.threadId, turnId: ctx.turnId, item: started });
    events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item: finished });
  }
  ctx.pendingPlanCandidates.clear();
}

// ---------------------------------------------------------------------------
// Question (question tool) normalization.
//
// Shape matches what Codex sends the `item/tool/requestUserInput` modal, so
// the same frontend dialog serves opencode turns with zero client changes.
// ---------------------------------------------------------------------------

/** Normalize opencode `question.asked` questions to the modal's shape. */
export function normalizeOpencodeQuestions(questions: unknown): NormalizedOpencodeQuestion[] {
  if (!Array.isArray(questions)) return [];
  const normalized: NormalizedOpencodeQuestion[] = [];
  for (const [index, entry] of questions.entries()) {
    const record = opencodePlanRecord(entry);
    const question = opencodePlanString(record.question) ?? opencodePlanString(record.text);
    if (!question) continue;
    const header = opencodePlanString(record.header);
    const rawOptions = Array.isArray(record.options) ? record.options : [];
    const options = rawOptions.flatMap((option: unknown) => {
      if (typeof option === "string") return option.trim() ? [{ label: option.trim(), description: "" }] : [];
      const optionRecord = opencodePlanRecord(option);
      const label = opencodePlanString(optionRecord.label);
      return label ? [{ label, description: opencodePlanString(optionRecord.description) ?? "" }] : [];
    });
    normalized.push({
      id: `q_${index + 1}`,
      question,
      ...(header ? { header } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(record.multiple === true || record.is_multi_select === true || record.isMultiSelect === true
        ? { is_multi_select: true }
        : {}),
      // Official default is true: only explicit false disables custom input.
      ...(record.custom === false ? { custom: false } : { custom: true }),
    });
  }
  return normalized;
}

const OPENCODE_USER_NOTE_PREFIX = "user_note: ";

/**
 * Map the modal's `{answers: {qid: {answers: [...]}}}` response back to
 * opencode's `answers: string[][]` (question order). Returns null when the
 * user cancelled/dismissed — the caller must `reject` the question so the
 * turn continues instead of hanging.
 */
export function opencodeQuestionAnswersFromResponse(
  questions: NormalizedOpencodeQuestion[],
  result: JsonValue | undefined,
): string[][] | null {
  const record = opencodePlanRecord(result);
  const answersRecord = opencodePlanRecord(record.answers);
  if (Object.keys(answersRecord).length === 0) return null;
  return questions.map((question) => {
    const entry = opencodePlanRecord(answersRecord[question.id]);
    const raw = Array.isArray(entry.answers)
      ? entry.answers
      : typeof entry.answers === "string"
        ? [entry.answers]
        : [];
    const cleaned: string[] = [];
    for (const answer of raw) {
      if (typeof answer !== "string") continue;
      const text = answer.startsWith(OPENCODE_USER_NOTE_PREFIX)
        ? answer.slice(OPENCODE_USER_NOTE_PREFIX.length).trim()
        : answer.trim();
      if (text) cleaned.push(text);
    }
    return cleaned;
  });
}

/**
 * Fold one `todowrite` part update into the per-turn plan item. Returns true
 * when the update was fully handled (no generic tool row wanted).
 */
function handleOpencodePlanToolPart(
  ctx: OpencodeProjectorContext,
  events: OpencodeProjectedEvent[],
  toolPart: OpencodeToolPart,
): boolean {
  if (!isOpencodePlanToolName(toolPart.tool || "")) return false;
  const callId = toolPart.callID || toolPart.id;
  const state = toolPart.state as { status?: unknown; input?: unknown; output?: unknown } | undefined;
  const steps = extractOpencodePlanSteps(state?.input, state?.output);
  const isTerminal = !!state && (state.status === "completed" || state.status === "error");
  if (!steps) {
    if (isTerminal) {
      // Unprojectable terminal update (e.g. denied before running): let the
      // generic tool row below preserve visibility.
      ctx.pendingPlanCandidates.delete(callId);
      return false;
    }
    ctx.pendingPlanCandidates.add(callId);
    return true;
  }
  ctx.pendingPlanCandidates.delete(callId);
  ctx.activeToolItems.delete(callId);
  if (isTerminal) {
    completeOpencodePlan(ctx, events, steps, state?.status === "error" ? "failed" : "completed");
  } else {
    pushOpencodePlanUpdate(ctx, events, steps);
  }
  return true;
}

export function opencodeSubtaskChildId(part: Record<string, unknown>, parentSessionId: string): string | undefined {
  const state = (part.state && typeof part.state === "object" ? part.state : {}) as Record<string, unknown>;
  const metadata = (state.metadata && typeof state.metadata === "object"
    ? state.metadata
    : part.metadata && typeof part.metadata === "object"
      ? part.metadata
      : {}) as Record<string, unknown>;
  const input = (state.input && typeof state.input === "object"
    ? state.input
    : part.input && typeof part.input === "object"
      ? part.input
      : {}) as Record<string, unknown>;

  const candidates = [
    metadata.sessionId,
    metadata.sessionID,
    metadata.childSessionId,
    metadata.childSessionID,
    input.task_id,
    input.taskId,
    part.childSessionID,
    part.childSessionId,
    part.receiverThreadId,
    part.subagentThreadId,
    part.taskId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() && candidate.trim() !== parentSessionId) {
      return candidate.trim();
    }
  }
  const output = typeof state.output === "string"
    ? state.output
    : typeof part.output === "string"
      ? part.output
      : typeof part.text === "string"
        ? part.text
        : "";
  const match = output.match(/<task\s+id=[\"'](ses_[A-Za-z0-9_-]+)[\"']/i)
    ?? output.match(/(?:task\s+id=|session)[^\"=]*[\"=]\s*(ses_[A-Za-z0-9_-]+)/i)
    ?? output.match(/(ses_[A-Za-z0-9_-]+)/);
  if (match?.[1] && match[1] !== parentSessionId) {
    return match[1];
  }
  return undefined;
}

function projectOpencodeSubtaskPart(
  threadId: string,
  turnId: string,
  part: Record<string, unknown>,
  statusOverride?: "inProgress" | "completed" | "failed",
): Record<string, JsonValue> {
  const state = (part.state && typeof part.state === "object" ? part.state : {}) as Record<string, unknown>;
  const input = (state.input && typeof state.input === "object"
    ? state.input
    : part.input && typeof part.input === "object"
      ? part.input
      : part) as Record<string, unknown>;
  const childThreadId = opencodeSubtaskChildId(part, String(part.sessionID ?? threadId));
  const agentRole = opencodePlanString(input.agent)
    ?? opencodePlanString(input.subagent_type)
    ?? opencodePlanString(part.agent)
    ?? opencodePlanString(part.subagent_type)
    ?? "subagent";
  const description = opencodePlanString(state.title)
    ?? opencodePlanString(input.description)
    ?? opencodePlanString(part.description)
    ?? "";
  const prompt = opencodePlanString(input.prompt) ?? opencodePlanString(part.prompt) ?? "";
  const receiverThreadIds = childThreadId ? [childThreadId] : [];

  const rawStatus = state.status;
  const isRunning = statusOverride === "inProgress" || rawStatus === "running" || rawStatus === "pending";
  const isFailed = statusOverride === "failed" || rawStatus === "error";
  const status = isRunning ? "inProgress" : isFailed ? "failed" : "completed";
  const agentStatus = isRunning ? "running" : isFailed ? "failed" : "completed";

  const message = isRunning
    ? (description || `${agentRole} running`)
    : isFailed
      ? String(state.error ?? description ?? `${agentRole} failed`)
      : (description || `${agentRole} completed`);

  const callId = String(part.callID ?? part.id ?? `${turnId}-${Date.now()}`);
  // Keep the raw result text for downstream consumers (e.g. JEV report
  // audits): agentsStates only carries a one-line summary, which is not
  // substance enough to judge. Additive field, no rendering impact.
  const rawOutput = state.output ?? part.output;
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
    id: `opencode-subtask-${callId}`,
    threadId,
    turnId,
    tool: "task",
    status,
    senderThreadId: threadId,
    receiverThreadIds,
    prompt,
    agentId: childThreadId ?? callId,
    ...(childThreadId ? { agentThreadId: childThreadId } : {}),
    agentName: description || agentRole,
    agentRole,
    agentStatus,
    agentsStates: childThreadId
      ? { [childThreadId]: { status: agentStatus, message } }
      : {},
    ...(outputText ? { output: outputText } : {}),
  };
}

function handleOpencodeTaskToolPart(
  ctx: OpencodeProjectorContext,
  events: OpencodeProjectedEvent[],
  toolPart: OpencodeToolPart,
): boolean {
  if (toolPart.tool !== "task") return false;
  const callId = toolPart.callID || toolPart.id;
  const state = toolPart.state as { status?: unknown; input?: unknown; output?: unknown; metadata?: unknown } | undefined;
  const isTerminal = !!state && (state.status === "completed" || state.status === "error");
  const isError = state?.status === "error";
  const item = projectOpencodeSubtaskPart(
    ctx.threadId,
    ctx.turnId,
    toolPart as unknown as Record<string, unknown>,
    isTerminal ? (isError ? "failed" : "completed") : "inProgress",
  );
  const receivers = (item as { receiverThreadIds?: unknown }).receiverThreadIds;
  const linked = Array.isArray(receivers) && receivers.length > 0;
  if (!isTerminal && !linked) {
    // Child session id unknown (permission unasked/unanswered, metadata not
    // yet written): emitting now would create a phantom tab bound to the
    // ephemeral call id. Hold the row until an update links the child; the
    // terminal update always emits so nothing is lost.
    return true;
  }
  const existing = ctx.activeToolItems.get(callId);
  ctx.activeToolItems.set(callId, item);
  if (isTerminal) {
    events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item });
  } else if (!existing || JSON.stringify(existing) !== JSON.stringify(item)) {
    events.push({ kind: "item/started", threadId: ctx.threadId, turnId: ctx.turnId, item });
  }
  return true;
}

function closeActiveToolItem(
  tool: Record<string, JsonValue>,
  terminalStatus: "completed" | "failed" | "interrupted",
): Record<string, JsonValue> {
  const isCollab = tool.type === "collabAgentToolCall";
  const status = terminalStatus === "failed" ? "failed" : terminalStatus === "interrupted" ? "interrupted" : "completed";
  const agentStatus = terminalStatus === "failed" ? "failed" : terminalStatus === "interrupted" ? "interrupted" : "completed";
  const agentsStates = isCollab && typeof tool.agentsStates === "object" && tool.agentsStates !== null
    ? Object.fromEntries(
        Object.entries(tool.agentsStates as Record<string, JsonValue>).map(([key, value]) => {
          const stateRecord = (value && typeof value === "object" ? value : {}) as Record<string, JsonValue>;
          return [key, { ...stateRecord, status: agentStatus }];
        })
      )
    : tool.agentsStates;
  return {
    ...tool,
    status: (isCollab ? (status === "interrupted" ? "interrupted" : status) : status) as JsonValue,
    ...(isCollab ? { agentStatus: agentStatus as JsonValue, ...(agentsStates ? { agentsStates: agentsStates as JsonValue } : {}) } : {}),
  };
}

/**
 * Turn-end reason for one open tool item. A subtask item that never linked a
 * child session (no receivers: permission unanswered, metadata never arrived)
 * never actually ran server-side — closing it as `completed` would fake
 * success, so it becomes `interrupted`. Linked children keep the ambient
 * reason (a background child may legitimately outlive the parent turn).
 */
function closeReasonForOpenToolItem(
  tool: Record<string, JsonValue>,
  ambient: "completed" | "failed" | "interrupted",
): "completed" | "failed" | "interrupted" {
  if (ambient === "failed" || tool.type !== "collabAgentToolCall") return ambient;
  const receivers = (tool as { receiverThreadIds?: unknown }).receiverThreadIds;
  const linked = Array.isArray(receivers) && receivers.length > 0;
  if (!linked) return "interrupted";
  return ambient;
}

export function projectOpencodeEvent(
  event: OpencodeSseEvent,
  ctx: OpencodeProjectorContext
): OpencodeProjectedEvent[] {
  const events: OpencodeProjectedEvent[] = [];
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

  // Streaming progress cancels any deferred idle: more content is still arriving.
  if (
    event.type === "message.part.updated"
    || event.type === "message.part.delta"
    || event.type === "message.updated"
    || event.type === "permission.asked"
    || event.type === "question.asked"
    || event.type === "todo.updated"
  ) {
    markOpencodeActivity(ctx);
  }

  switch (event.type) {
    case "server.connected":
    case "server.heartbeat": {
      break;
    }

    case "message.updated": {
      const info = (event as { properties?: { info?: { id?: unknown; role?: unknown } } }).properties?.info;
      if (info && typeof info.id === "string" && typeof info.role === "string") {
        ctx.messageRoles.set(info.id, info.role);
      }
      break;
    }

    case "message.part.updated": {
      const { part } = (event as OpencodeMessagePartUpdatedEvent).properties;
      if (!part) break;

      if (part.type === "reasoning") {
        const reasoningPart = part as OpencodeReasoningPart;
        ctx.partTypes.set(reasoningPart.id, "reasoning");
        if (ctx.hasCompletedCurrentAssistantMessage || ctx.hasCompletedCurrentReasoning) {
          startNewOpencodeSegment(ctx);
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
        const prevText = ctx.partTexts.get(reasoningPart.id) ?? "";
        const incomingText = reasoningPart.text ?? "";
        if (incomingText.length > prevText.length) {
          const delta = incomingText.slice(prevText.length);
          ctx.partTexts.set(reasoningPart.id, incomingText);
          ctx.reasoningText += delta;
          ctx.currentReasoningText += delta;
          events.push({
            kind: "item/reasoning/textDelta",
            threadId,
            turnId,
            itemId: ctx.currentReasoningItemId,
            delta,
          });
        }
      } else if (part.type === "text") {
        const textPart = part as OpencodeTextPart;
        if (ctx.messageRoles.get(textPart.messageID) === "user") {
          break;
        }
        completeActiveReasoning(ctx, events);
        ctx.partTypes.set(textPart.id, "text");
        if (ctx.hasCompletedCurrentAssistantMessage) {
          startNewOpencodeSegment(ctx);
        }
        const prevText = ctx.partTexts.get(textPart.id) ?? "";
        const incomingText = textPart.text ?? "";
        if (incomingText.length > prevText.length) {
          const delta = incomingText.slice(prevText.length);
          ctx.partTexts.set(textPart.id, incomingText);
          ctx.assistantText += delta;
          ctx.hasStartedAgentMessage = true;

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

          ctx.currentAssistantText += delta;
          events.push({
            kind: "item/agentMessage/delta",
            threadId,
            turnId,
            itemId: ctx.currentAssistantItemId,
            delta,
          });
        }
      } else if (part.type === "subtask") {
        completeActiveReasoning(ctx, events);
        const subtaskItem = projectOpencodeSubtaskPart(threadId, turnId, part as unknown as Record<string, unknown>);
        const isTerminal = subtaskItem.status === "completed" || subtaskItem.status === "failed";
        const subtaskReceivers = (subtaskItem as { receiverThreadIds?: unknown }).receiverThreadIds;
        const subtaskLinked = Array.isArray(subtaskReceivers) && subtaskReceivers.length > 0;
        if (!isTerminal && !subtaskLinked) {
          // Same hold-back as task tool parts: no phantom tab on call id.
          break;
        }
        const subtaskId = String(part.id ?? `${turnId}-${Date.now()}`);
        const existing = ctx.activeToolItems.get(subtaskId);
        ctx.activeToolItems.set(subtaskId, subtaskItem);
        if (isTerminal) {
          events.push({ kind: "item/completed", threadId, turnId, item: subtaskItem });
        } else if (!existing || JSON.stringify(existing) !== JSON.stringify(subtaskItem)) {
          events.push({ kind: "item/started", threadId, turnId, item: subtaskItem });
        }
      } else if (part.type === "tool") {
        completeActiveReasoning(ctx, events);
        const toolPart = part as OpencodeToolPart;
        ctx.partTypes.set(toolPart.id, "tool");
        // Immediate close of active assistant message before emitting tool call
        if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
          completeActiveAssistantMessage(ctx, events);
        }

        // todowrite replaces the whole task list: project it as the
        // Codex-style plan item instead of a raw tool row (Claude TodoWrite
        // precedent). Unprojectable calls fall through to the generic row.
        if (handleOpencodePlanToolPart(ctx, events, toolPart)) {
          break;
        }
        if (handleOpencodeTaskToolPart(ctx, events, toolPart)) {
          break;
        }

        const callId = toolPart.callID || toolPart.id;
        const toolName = toolPart.tool || "tool";
        const state = toolPart.state;
        const existing = ctx.activeToolItems.get(callId);
        // opencode streams pending (input:{}) before running/completed (real
        // input). The first update must not freeze an empty input forever.
        const incomingInput = (state && typeof state === "object" && "input" in (state as Record<string, unknown>)
          ? (state as { input?: unknown }).input
          : undefined) as JsonValue | undefined;
        const hasIncomingInput = incomingInput !== undefined
          && !(typeof incomingInput === "object" && incomingInput !== null && Object.keys(incomingInput).length === 0);

        const initialInput = (incomingInput ?? {}) as JsonValue;
        if (!existing) {
          const toolItem: Record<string, JsonValue> = {
            type: "toolCall",
            id: callId,
            threadId,
            turnId,
            name: toolName,
            tool: toolName,
            toolName,
            input: initialInput,
            arguments: initialInput,
            status: "in_progress",
          };
          ctx.activeToolItems.set(callId, toolItem);
          events.push({ kind: "item/started", threadId, turnId, item: toolItem });
        } else if (hasIncomingInput && JSON.stringify(existing.input ?? {}) !== JSON.stringify(incomingInput)) {
          // Same-id item/started upserts in the client (payload merges by id),
          // so refresh the live row as soon as the real arguments arrive.
          const refreshed: Record<string, JsonValue> = {
            ...existing,
            name: toolName,
            tool: toolName,
            toolName,
            input: incomingInput as JsonValue,
            arguments: incomingInput as JsonValue,
          };
          ctx.activeToolItems.set(callId, refreshed);
          events.push({ kind: "item/started", threadId, turnId, item: refreshed });
        }

        if (state && (state.status === "completed" || state.status === "error")) {
          const isError = state.status === "error";
          const output = isError ? state.error : state.output;
          const currentItem = ctx.activeToolItems.get(callId) ?? {
            type: "toolCall",
            id: callId,
            threadId,
            turnId,
            name: toolName,
            tool: toolName,
            toolName,
            input: initialInput,
            arguments: initialInput,
          };
          const finalInput = (hasIncomingInput ? incomingInput : (currentItem.input ?? {})) as JsonValue;
          const updatedItem: Record<string, JsonValue> = {
            ...currentItem,
            name: toolName,
            tool: toolName,
            toolName,
            // The completed update carries the authoritative input; the stored
            // item may still hold the pending {} snapshot.
            input: finalInput,
            arguments: finalInput,
            status: isError ? "failed" : "completed",
            output: (output ?? "") as JsonValue,
            ...(state.status === "completed" && state.title ? { title: state.title } : {}),
          };
          ctx.activeToolItems.set(callId, updatedItem);
          events.push({ kind: "item/completed", threadId, turnId, item: updatedItem });
        }
      } else if (part.type === "step-finish") {
        const stepFinish = part as OpencodeStepFinishPart;
        if (stepFinish.tokens) {
          const tokenUsage = buildOpencodeTokenUsage(stepFinish.tokens, ctx.contextWindow);
          // Stable call identity (axonhub RequestID equivalent): the same
          // step re-emitted (SSE replay/backfill) upserts one ledger row
          // instead of inserting duplicates. Distinct steps stay distinct.
          const stepId = typeof stepFinish.id === "string" && stepFinish.id ? stepFinish.id : undefined;
          events.push({
            kind: "thread/tokenUsage/updated",
            threadId,
            turnId,
            tokenUsage,
            ...(stepId ? { requestId: `opencode-${turnId}-${stepId}` } : {}),
          });
        }
      }
      break;
    }

    case "message.part.delta": {
      const { partID, field, delta } = (event as OpencodeMessagePartDeltaEvent).properties;
      if (!delta) break;

      const partType = ctx.partTypes.get(partID);
      if (partType === "reasoning" || field === "reasoning") {
        if (ctx.hasCompletedCurrentAssistantMessage || ctx.hasCompletedCurrentReasoning) {
          startNewOpencodeSegment(ctx);
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
        ctx.reasoningText += delta;
        ctx.currentReasoningText += delta;
        const prev = ctx.partTexts.get(partID) ?? "";
        ctx.partTexts.set(partID, prev + delta);
        events.push({
          kind: "item/reasoning/textDelta",
          threadId,
          turnId,
          itemId: ctx.currentReasoningItemId,
          delta,
        });
      } else {
        // Text delta
        completeActiveReasoning(ctx, events);
        if (ctx.hasCompletedCurrentAssistantMessage) {
          startNewOpencodeSegment(ctx);
        }
        ctx.assistantText += delta;
        ctx.hasStartedAgentMessage = true;

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

        ctx.currentAssistantText += delta;
        const prev = ctx.partTexts.get(partID) ?? "";
        ctx.partTexts.set(partID, prev + delta);
        events.push({
          kind: "item/agentMessage/delta",
          threadId,
          turnId,
          itemId: ctx.currentAssistantItemId,
          delta,
        });
      }
      break;
    }

    case "permission.asked": {
      const req = (event as OpencodePermissionAskedEvent).properties;
      events.push({
        kind: "permission/asked",
        threadId,
        turnId,
        requestId: req.id,
        permission: req.permission,
        patterns: req.patterns || [],
        always: req.always,
        metadata: req.metadata,
        tool: req.tool,
      });
      break;
    }

    case "question.asked": {
      // Codex parity: the modal is driven by `item/tool/requestUserInput`
      // (built by the runtime); the projector only normalizes the questions.
      const props = (event as OpencodeQuestionAskedEvent).properties;
      const questions = normalizeOpencodeQuestions(props?.questions);
      if (!props?.id || questions.length === 0) break;
      events.push({
        kind: "question/asked",
        threadId,
        turnId,
        requestId: String(props.id),
        questions,
      });
      break;
    }

    case "todo.updated": {
      // Full-list sync (same content `todowrite` carries): converge onto the
      // same per-turn plan item.
      const props = (event as OpencodeTodoUpdatedEvent).properties;
      const steps = opencodePlanStepsFromValue(props?.todos);
      if (!steps) break;
      pushOpencodePlanUpdate(ctx, events, steps);
      break;
    }

    case "session.compacted": {
      const compactionItem: Record<string, JsonValue> = {
        type: "contextCompaction",
        id: `opencode-compact-${turnId}`,
        threadId,
        turnId,
        title: "Context compaction",
        status: "completed",
        cliBackend: "opencode",
      };
      events.push({ kind: "item/started", threadId, turnId, item: compactionItem });
      events.push({ kind: "item/completed", threadId, turnId, item: compactionItem });
      break;
    }

    case "session.idle": {
      if (opencodeIdleIsStale(ctx)) {
        break;
      }
      if (shouldDeferOpencodeIdle(ctx)) {
        ctx.deferredIdleAtMs = Date.now();
        break;
      }
      if (ctx.upstreamIssueAtMs != null && !shouldFailIdleAsUpstream(ctx)) {
        ctx.deferredIdleAtMs = Date.now();
        break;
      }
      if (shouldFailIdleAsUpstream(ctx)) {
        const errorMsg = `OpenCode error: ${ctx.upstreamIssueMsg}`;
        ctx.status = "failed";
        ctx.deferredIdleAtMs = null;
        completeActiveReasoning(ctx, events, "failed");
        if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
          completeActiveAssistantMessage(ctx, events, "failed");
        }
        events.push({ kind: "turn/failed", threadId, turnId, error: errorMsg });
        break;
      }
      completeActiveReasoning(ctx, events, "completed");
      if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
        completeActiveAssistantMessage(ctx, events, "completed");
      }
      // Ensure all active tool items are completed
      for (const [id, tool] of ctx.activeToolItems.entries()) {
        if (tool.status === "in_progress" || tool.status === "inProgress") {
          const closed = closeActiveToolItem(tool, closeReasonForOpenToolItem(tool, "completed"));
          ctx.activeToolItems.set(id, closed);
          events.push({ kind: "item/completed", threadId, turnId, item: closed });
        }
      }
      flushOpencodePlanCandidates(ctx, events, "completed");
      ctx.status = "completed";
      ctx.deferredIdleAtMs = null;
      events.push({
        kind: "turn/completed",
        threadId,
        turnId,
      });
      break;
    }

    case "session.status": {
      const status = (event as OpencodeSessionStatusEvent).properties?.status;
      if (status?.type === "busy") {
        ctx.deferredIdleAtMs = null;
        markOpencodeActivity(ctx);
        break;
      }
      if (status?.type === "retry") {
        const msg = status.message || "Retry requested";
        const normalizedMessage = msg.toLowerCase();
        const isTransientUpstream = /\b429\b|\b5\d\d\b|\b5xx\b|rate.?limit|too many requests/i.test(msg);
        const retryExhausted = /retry(?:s|ing)? (?:limit|budget) (?:was )?(?:reached|exhausted)|maximum retries|retry exhausted/i.test(msg);
        const explicitlyFatal = !isTransientUpstream && (
          normalizedMessage.includes("free_tier_limit")
          || normalizedMessage.includes("quota")
          || normalizedMessage.includes("unauthorized")
          || normalizedMessage.includes("forbidden")
          || normalizedMessage.includes("insufficient balance")
        );
        recordOpencodeUpstreamIssue(ctx, msg, Date.now(), status.attempt);
        if (retryExhausted || explicitlyFatal || ctx.upstreamRetryAttempts >= OPENCODE_UPSTREAM_RETRY_MAX_ATTEMPTS) {
          const errorMsg = normalizedMessage.includes("free_tier_limit")
            ? "OpenCode free tier limit reached. Please configure a custom model or API key."
            : `OpenCode error: ${msg}`;
          events.push(...forceTerminateOpencode(ctx, "failed", errorMsg));
        }
      } else if (status?.type === "idle" && ctx.hasStartedTurn && ctx.status === "running") {
        if (opencodeIdleIsStale(ctx)) {
          break;
        }
        if (shouldDeferOpencodeIdle(ctx)) {
          ctx.deferredIdleAtMs = Date.now();
          break;
        }
        if (ctx.upstreamIssueAtMs != null && !shouldFailIdleAsUpstream(ctx)) {
          ctx.deferredIdleAtMs = Date.now();
          break;
        }
        if (shouldFailIdleAsUpstream(ctx)) {
          const errorMsg = `OpenCode error: ${ctx.upstreamIssueMsg}`;
          ctx.status = "failed";
          ctx.deferredIdleAtMs = null;
          completeActiveReasoning(ctx, events, "failed");
          if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
            completeActiveAssistantMessage(ctx, events, "failed");
          }
          events.push({ kind: "turn/failed", threadId, turnId, error: errorMsg });
          break;
        }
        completeActiveReasoning(ctx, events, "completed");
        if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
          completeActiveAssistantMessage(ctx, events, "completed");
        }
        for (const [id, tool] of ctx.activeToolItems.entries()) {
          if (tool.status === "in_progress" || tool.status === "inProgress") {
            const closed = closeActiveToolItem(tool, closeReasonForOpenToolItem(tool, "completed"));
            ctx.activeToolItems.set(id, closed);
            events.push({ kind: "item/completed", threadId, turnId, item: closed });
          }
        }
        flushOpencodePlanCandidates(ctx, events, "completed");
        ctx.status = "completed";
        ctx.deferredIdleAtMs = null;
        events.push({
          kind: "turn/completed",
          threadId,
          turnId,
        });
      }
      break;
    }

    case "session.error": {
      const err = (event as OpencodeSessionErrorEvent).properties?.error;
      const errRecord = (err && typeof err === "object" ? err : {}) as Record<string, unknown>;
      const dataRecord = (errRecord.data && typeof errRecord.data === "object" ? errRecord.data : {}) as Record<string, unknown>;
      const dataMsg = typeof dataRecord.message === "string" ? dataRecord.message : undefined;
      const directMsg = typeof errRecord.message === "string" ? errRecord.message : undefined;
      const errName = typeof errRecord.name === "string" ? errRecord.name : undefined;
      const errorMsg = dataMsg || directMsg || (typeof err === "string" ? err : undefined) || (errName ? `OpenCode error (${errName})` : "OpenCode session error");
      const normalizedMessage = errorMsg.toLowerCase();
      const statusCode = Number(errRecord.status ?? errRecord.statusCode ?? dataRecord.status ?? dataRecord.statusCode);
      const isTransientStatus = statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
      const isTransientUpstream = isTransientStatus || /\b429\b|\b5\d\d\b|\b5xx\b|rate.?limit|too many requests/i.test(errorMsg);
      const retryExhausted = /retry(?:s|ing)? (?:limit|budget) (?:was )?(?:reached|exhausted)|maximum retries|retry exhausted/i.test(errorMsg);
      const explicitlyFatal = !isTransientUpstream && (
        normalizedMessage.includes("free_tier_limit")
        || normalizedMessage.includes("quota")
        || normalizedMessage.includes("unauthorized")
        || normalizedMessage.includes("forbidden")
        || normalizedMessage.includes("insufficient balance")
      );
      if (isTransientUpstream && !retryExhausted && !explicitlyFatal) {
        recordOpencodeUpstreamIssue(ctx, isTransientStatus ? `HTTP ${statusCode}: ${errorMsg}` : errorMsg);
        if (ctx.upstreamRetryAttempts < OPENCODE_UPSTREAM_RETRY_MAX_ATTEMPTS) break;
      }
      ctx.status = "failed";
      completeActiveReasoning(ctx, events, "failed");
      if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
        completeActiveAssistantMessage(ctx, events, "failed");
      }
      events.push({
        kind: "turn/failed",
        threadId,
        turnId,
        error: errorMsg,
      });
      break;
    }
  }

  return events;
}

export function forceTerminateOpencode(
  ctx: OpencodeProjectorContext,
  reason: "completed" | "failed" | "interrupted",
  errorMsg?: string
): OpencodeProjectedEvent[] {
  const events: OpencodeProjectedEvent[] = [];
  if (ctx.status !== "running") return events;

  const finalStatus = reason === "interrupted" ? "interrupted" : reason === "failed" ? "failed" : "completed";
  completeActiveReasoning(ctx, events, finalStatus);
  if (ctx.hasStartedCurrentAssistantMessage && !ctx.hasCompletedCurrentAssistantMessage) {
    completeActiveAssistantMessage(ctx, events, finalStatus);
  }

  for (const [id, tool] of ctx.activeToolItems.entries()) {
    if (tool.status === "in_progress" || tool.status === "inProgress") {
      const closed = closeActiveToolItem(tool, closeReasonForOpenToolItem(tool, reason));
      ctx.activeToolItems.set(id, closed);
      events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item: closed });
    }
  }
  flushOpencodePlanCandidates(ctx, events, reason === "failed" ? "failed" : reason === "interrupted" ? "interrupted" : "completed");

  ctx.status = reason;
  if (reason === "interrupted") {
    events.push({ kind: "turn/interrupted", threadId: ctx.threadId, turnId: ctx.turnId });
  } else if (reason === "failed") {
    events.push({ kind: "turn/failed", threadId: ctx.threadId, turnId: ctx.turnId, error: errorMsg });
  } else {
    events.push({ kind: "turn/completed", threadId: ctx.threadId, turnId: ctx.turnId });
  }

  return events;
}

export function toOpencodeNotification(event: OpencodeProjectedEvent): JsonRpcNotification | null {
  switch (event.kind) {
    case "turn/started":
      return {
        method: "turn/started",
        params: { threadId: event.threadId, turnId: event.turnId, turn: { id: event.turnId, threadId: event.threadId, status: "inProgress", startedAt: Math.floor(Date.now() / 1000) } },
      };
    case "turn/completed":
      return {
        method: "turn/completed",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          completedAt: Math.floor(Date.now() / 1000),
          turn: {
            id: event.turnId,
            threadId: event.threadId,
            status: "completed",
            completedAt: Math.floor(Date.now() / 1000),
          },
        },
      };
    case "turn/failed":
      return {
        method: "turn/failed",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          completedAt: Math.floor(Date.now() / 1000),
          turn: {
            id: event.turnId,
            threadId: event.threadId,
            status: "failed",
            error: event.error ?? null,
            completedAt: Math.floor(Date.now() / 1000),
          },
          error: event.error ?? undefined,
        } as unknown as Record<string, JsonValue>,
      };
    case "turn/interrupted":
      return {
        method: "turn/interrupted",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          completedAt: Math.floor(Date.now() / 1000),
          turn: {
            id: event.turnId,
            threadId: event.threadId,
            status: "interrupted",
            completedAt: Math.floor(Date.now() / 1000),
          },
        },
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
    case "permission/asked":
      return {
        method: "item/commandExecution/requestApproval",
        params: {
          id: event.requestId,
          threadId: event.threadId,
          turnId: event.turnId,
          toolName: event.permission,
          command: event.patterns,
          input: {
            permission: event.permission,
            patterns: event.patterns,
            metadata: event.metadata,
          } as JsonValue,
        },
      };
    case "question/asked":
      // Served as a serverRequest by the runtime, never as a notification.
      return null;
    case "thread/tokenUsage/updated":
      return {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: event.threadId,
          turnId: event.turnId,
          tokenUsage: event.tokenUsage as JsonValue,
          ...(event.requestId ? { requestId: event.requestId } : {}),
        },
      };
    case "system/init":
      return null;
    default:
      return null;
  }
}
