import type { JsonRpcNotification, JsonValue } from "@codex-ui/shared";

/**
 * Muse exec --json 瀑布流投影器。
 *
 * 背景：MuseBridge 原来只解析 `run.output.delta` 纯文本，
 * thinking / todolist / subagent / mcp / skill 全部丢失。
 * 本投影器参考 mini/opencode 的做法，把 muse exec --json stdout 的
 * `tool.result`（`correlation_facts.tool_name` 带工具名，verified 2026-10-13：
 * stdout 只有 result、没有 started）、`tool_batch.effect.*`（session log 形状，
 * 保留兼容）、`write_todos` 输出、`subagent_*` / `read_skill` / `mcp__*` /
 * reasoning 文本统一投影成 Codex Ultra 前端已能渲染的 item 类型：
 * - reasoning -> type=reasoning + item/reasoning/textDelta
 * - agent 文本 -> type=agentMessage + item/agentMessage/delta
 * - write_todos/todowrite -> type=plan（turn/plan/updated 同形）
 * - subagent_spawn/status -> type=collabAgentToolCall
 * - mcp__/skill/read_skill -> type=toolCall（保留原名，瀑布流按 toolCall 渲染）
 * - 普通工具 -> type=toolCall
 *
 * 防御性设计：muse 不同 provider/版本的 record 字段名可能漂移，
 * 所有提取函数都做多键兼容，解析失败时回退为普通 toolCall 行，
 * 绝不吞掉工具调用。
 */

export type MuseProjectedEvent =
  | { kind: "turn/started"; threadId: string; turnId: string }
  | { kind: "turn/completed"; threadId: string; turnId: string }
  | { kind: "turn/failed"; threadId: string; turnId: string; error?: string }
  | { kind: "item/agentMessage/delta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/reasoning/textDelta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { kind: "item/started"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | { kind: "item/completed"; threadId: string; turnId: string; item: Record<string, JsonValue> }
  | { kind: "turn/plan/updated"; threadId: string; turnId: string; plan: Array<{ step: string; status: string }>; planItem: Record<string, JsonValue> };

export interface MuseProjectorContext {
  threadId: string;
  turnId: string;
  status: "running" | "completed" | "failed";
  hasStartedTurn: boolean;
  assistantIndex: number;
  assistantItemId: string;
  assistantStarted: boolean;
  assistantDone: boolean;
  assistantText: string;
  reasoningItemId: string;
  reasoningStarted: boolean;
  reasoningDone: boolean;
  reasoningText: string;
  activeTools: Map<string, Record<string, JsonValue>>;
  pendingPlanCandidates: Set<string>;
  /** tool_output_ref → 工具名：部分 tool.result 缺 correlation_facts，
   * 靠输出引用文件名里的 `<tool>-stdout` 片段按 call_id 回填。 */
  toolNameByCallId: Map<string, string>;
  /** subagent.control 记录的 subagent_id → 模型侧 tool call_id。 */
  subagentCallBySubagentId: Map<string, string>;
  /** subagent_id → 子会话 id（subagent.control.child_session_bound/start_attested）。 */
  subagentChildBySubagentId: Map<string, string>;
  /** subagent_id → {objective, role, taskName}（resume_context_recorded）。 */
  subagentMetaBySubagentId: Map<string, { objective?: string; role?: string; taskName?: string }>;
  /** workflow_run_id → 模型侧 tool call_id（workflow_run_launched.call_id）。 */
  workflowCallByRunId: Map<string, string>;
  planStarted: boolean;
  lastPlanJson: string;
  /**
   * True when replaying a subagent session log offline (no stdout stream).
   * Child logs carry committed reasoning/assistant text instead of deltas,
   * and the log's terminal record must close the turn.
   */
  offline?: boolean;
}

export function museAssistantItemId(turnId: string, index = 0): string {
  return `muse-msg-${turnId}-${index}`;
}

export function createMuseProjectorContext(threadId: string, turnId: string): MuseProjectorContext {
  return {
    threadId,
    turnId,
    status: "running",
    hasStartedTurn: false,
    assistantIndex: 0,
    assistantItemId: museAssistantItemId(turnId, 0),
    assistantStarted: false,
    assistantDone: false,
    assistantText: "",
    reasoningItemId: `muse-thought-${turnId}-0`,
    reasoningStarted: false,
    reasoningDone: false,
    reasoningText: "",
    activeTools: new Map(),
    pendingPlanCandidates: new Set(),
    toolNameByCallId: new Map(),
    subagentCallBySubagentId: new Map(),
    subagentChildBySubagentId: new Map(),
    subagentMetaBySubagentId: new Map(),
    workflowCallByRunId: new Map(),
    planStarted: false,
    lastPlanJson: "",
  };
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// 输出截断与 mini 对齐（miniBridge toolItem output.slice(0, 2000)）：
// 事件/历史落盘只保留前 2000 字符，防止大工具输出撑爆内存与事件流。
function sliceOutputText(text: string): string {
  return text.length > 2000 ? text.slice(0, 2000) : text;
}

function ensureTurnStarted(ctx: MuseProjectorContext, events: MuseProjectedEvent[]): void {
  if (!ctx.hasStartedTurn) {
    ctx.hasStartedTurn = true;
    events.push({ kind: "turn/started", threadId: ctx.threadId, turnId: ctx.turnId });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function pushAssistantDelta(ctx: MuseProjectorContext, events: MuseProjectedEvent[], delta: string): void {
  if (!delta) return;
  ensureTurnStarted(ctx, events);
  if (ctx.assistantDone) {
    ctx.assistantDone = false;
    ctx.assistantStarted = false;
    ctx.assistantText = "";
    ctx.assistantIndex += 1;
    ctx.assistantItemId = museAssistantItemId(ctx.turnId, ctx.assistantIndex);
  }
  completeActiveReasoning(ctx, events);
  if (!ctx.assistantStarted) {
    ctx.assistantStarted = true;
    events.push({
      kind: "item/started",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        type: "agentMessage",
        id: ctx.assistantItemId,
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        role: "assistant",
        status: "inProgress",
        text: "",
        content: [],
        startedAt: nowSec(),
      } as Record<string, JsonValue>,
    });
  }
  ctx.assistantText += delta;
  events.push({ kind: "item/agentMessage/delta", threadId: ctx.threadId, turnId: ctx.turnId, itemId: ctx.assistantItemId, delta });
}

function pushReasoningDelta(ctx: MuseProjectorContext, events: MuseProjectedEvent[], delta: string): void {
  if (!delta) return;
  ensureTurnStarted(ctx, events);
  if (ctx.reasoningDone) {
    ctx.reasoningDone = false;
    ctx.reasoningStarted = false;
    ctx.reasoningText = "";
  }
  if (!ctx.reasoningStarted) {
    ctx.reasoningStarted = true;
    events.push({
      kind: "item/started",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        type: "reasoning",
        id: ctx.reasoningItemId,
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        title: "Thinking",
        text: "",
        status: "inProgress",
        startedAt: nowSec(),
        firstTokenAt: nowSec(),
      } as Record<string, JsonValue>,
    });
  }
  ctx.reasoningText += delta;
  events.push({ kind: "item/reasoning/textDelta", threadId: ctx.threadId, turnId: ctx.turnId, itemId: ctx.reasoningItemId, delta });
}

function completeActiveReasoning(ctx: MuseProjectorContext, events: MuseProjectedEvent[]): void {
  if (ctx.reasoningStarted && !ctx.reasoningDone) {
    ctx.reasoningDone = true;
    events.push({
      kind: "item/completed",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        type: "reasoning",
        id: ctx.reasoningItemId,
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        title: "Thinking",
        text: ctx.reasoningText,
        status: "completed",
      } as Record<string, JsonValue>,
    });
  }
}

function completeActiveAssistant(ctx: MuseProjectorContext, events: MuseProjectedEvent[]): void {
  if (ctx.assistantStarted && !ctx.assistantDone) {
    ctx.assistantDone = true;
    events.push({
      kind: "item/completed",
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      item: {
        type: "agentMessage",
        id: ctx.assistantItemId,
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        role: "assistant",
        status: "completed",
        text: ctx.assistantText,
        content: [{ type: "text", text: ctx.assistantText }],
      } as Record<string, JsonValue>,
    });
  }
}

// ---------------------------------------------------------------------------
// 工具名分类（对齐 mini/opencode 适配口径）
// ---------------------------------------------------------------------------

function normToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[_-]+/g, "");
}

export function isMusePlanToolName(toolName: string): boolean {
  const n = normToolName(toolName);
  return n === "writetodos" || n === "todowrite" || n === "settodo" || n === "sessiontodo" || n === "todos";
}

export function isMuseSubagentToolName(toolName: string): boolean {
  const n = normToolName(toolName);
  return n === "subagentspawn" || n === "subagentstatus" || n === "subagentsendmessage"
    || n === "subagentwait" || n === "subagentreadresult" || n === "subagentcancel"
    || n === "task" || n === "subagent" || n === "workflow";
}

/** 只有 spawn/workflow 在瀑布流里是一张子 agent 卡片；wait/read_result 等
 * 是普通工具行（否则每轮 wait 都会多出一个 agent 图标）。 */
export function isMuseAgentCardToolName(toolName: string): boolean {
  const n = normToolName(toolName);
  return n === "subagentspawn" || n === "task" || n === "subagent" || n === "workflow";
}

function isMuseSubagentControlToolName(toolName: string): boolean {
  const n = normToolName(toolName);
  return n === "subagentwait" || n === "subagentreadresult" || n === "subagentstatus"
    || n === "subagentcancel" || n === "subagentsendmessage";
}

function isMuseSkillToolName(toolName: string): boolean {
  const n = normToolName(toolName);
  return n === "readskill" || n === "skill" || n.startsWith("skill");
}

function isMuseMcpToolName(toolName: string): boolean {
  const lower = toolName.trim().toLowerCase();
  return lower.startsWith("mcp__") || lower.startsWith("mcp-") || lower.startsWith("mcp:") || lower.includes("__");
}

type PlanStep = { step: string; status: string };

function normalizePlanStatus(value: unknown): string {
  const n = typeof value === "string" ? value.replace(/[_-]+/g, "").toLowerCase() : "";
  if (n === "completed" || n === "complete" || n === "done") return "completed";
  if (n === "inprogress" || n === "running" || n === "started") return "in_progress";
  return "pending";
}

function planStepsFromValue(value: unknown): PlanStep[] | null {
  if (!Array.isArray(value)) return null;
  const steps: PlanStep[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      steps.push({ step: entry.trim(), status: "pending" });
      continue;
    }
    const rec = asRecord(entry);
    const step = asText(rec.content) ?? asText(rec.subject) ?? asText(rec.step)
      ?? asText(rec.title) ?? asText(rec.task) ?? asText(rec.text);
    if (!step) continue;
    steps.push({ step: step.trim(), status: normalizePlanStatus(rec.status) });
  }
  return steps.length > 0 ? steps : null;
}

function extractPlanSteps(input: unknown, output?: unknown): PlanStep[] | null {
  const direct = planStepsFromValue(input);
  if (direct) return direct;
  const rec = asRecord(input);
  const fromInput = planStepsFromValue(rec.todos ?? rec.tasks ?? rec.plan ?? rec.steps ?? rec.items);
  if (fromInput) return fromInput;
  if (typeof output === "string" && output.trim()) {
    try {
      const parsed: unknown = JSON.parse(output);
      const d = planStepsFromValue(parsed);
      if (d) return d;
      const r = asRecord(parsed);
      const o = planStepsFromValue(r.todos ?? r.tasks ?? r.plan ?? r.steps ?? r.items);
      if (o) return o;
    } catch { /* 非 JSON 则无 plan */ }
  } else if (output && typeof output === "object") {
    const r = asRecord(output);
    const o = planStepsFromValue(r.todos ?? r.tasks ?? r.plan ?? r.steps ?? r.items);
    if (o) return o;
  }
  return null;
}

function musePlanItemId(turnId: string): string {
  return `muse-plan-${turnId}`;
}

function buildPlanItem(threadId: string, turnId: string, steps: PlanStep[]): Record<string, JsonValue> {
  return {
    type: "plan",
    id: musePlanItemId(turnId),
    threadId,
    turnId,
    plan: steps.map((s) => ({ step: s.step, status: s.status })) as JsonValue,
    text: steps.map((s) => {
      if (s.status === "completed") return `- [x] ${s.step}`;
      if (s.status === "in_progress") return `- [ ] ${s.step} _(in progress)_`;
      return `- [ ] ${s.step}`;
    }).join("\n"),
    status: steps.some((s) => s.status === "in_progress")
      ? "inProgress"
      : steps.length > 0 && steps.every((s) => s.status === "completed")
        ? "completed"
        : "pending",
    startedAt: nowSec(),
  };
}

function pushPlanUpdate(ctx: MuseProjectorContext, events: MuseProjectedEvent[], steps: PlanStep[]): void {
  const json = JSON.stringify(steps);
  if (ctx.planStarted && ctx.lastPlanJson === json) return;
  ctx.planStarted = true;
  ctx.lastPlanJson = json;
  const item = buildPlanItem(ctx.threadId, ctx.turnId, steps);
  events.push({ kind: "item/started", threadId: ctx.threadId, turnId: ctx.turnId, item });
  events.push({ kind: "turn/plan/updated", threadId: ctx.threadId, turnId: ctx.turnId, plan: steps, planItem: item });
}

function truncatePrompt(text: string): string {
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

/**
 * workflow 的入参是 `{name, script}`，真正的子任务提示写在脚本
 * `host.agent({ input: "..." })` 里（实测 Muse 1.4.11）。没有 script 时
 * 再退回 objective/prompt/task 等常规键。
 */
function extractWorkflowPrompt(rec: Record<string, unknown>): string {
  const direct = asText(rec.prompt) ?? asText(rec.objective) ?? asText(rec.task) ?? asText(rec.input);
  if (direct) return truncatePrompt(direct);
  const script = asText(rec.script);
  if (!script) return "";
  const block = script.match(/host\.agent\(\s*\{([\s\S]*?)\}\s*\)/)?.[1] ?? "";
  const literal = block.match(/\binput\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/);
  const raw = literal?.[1] ?? literal?.[2] ?? literal?.[3];
  return raw ? truncatePrompt(raw.replace(/\\n/g, "\n").replace(/\\"/g, "\"")) : "";
}

function subagentChildIdFrom(
  rec: Record<string, unknown>,
  previous: Record<string, JsonValue> | undefined,
  callId: string,
): string {
  const direct = asText(rec.subagent_id) ?? asText(rec.childSessionId) ?? asText(rec.childSessionID)
    ?? asText(rec.sessionId) ?? asText(rec.sessionID) ?? asText(rec.child_session_id);
  if (direct) return direct;
  const prevReceiver = previous?.receiverThreadIds;
  if (Array.isArray(prevReceiver) && typeof prevReceiver[0] === "string" && prevReceiver[0]) return prevReceiver[0];
  return callId;
}

function buildSubagentItem(
  threadId: string, turnId: string, callId: string,
  toolName: string, input: unknown, status: string, output?: unknown,
  previous?: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const rec = asRecord(input);
  const agentRole = asText(rec.role) ?? asText(rec.agent) ?? asText(rec.subagent_type)
    ?? asText(rec.agentType) ?? asText(rec.agentRole) ?? toolName;
  const description = asText(rec.task_name) ?? asText(rec.name) ?? asText(rec.title)
    ?? asText(rec.description) ?? asText(rec.label) ?? "";
  const prompt = truncatePrompt(
    extractWorkflowPrompt(rec)
    || asText(rec.description)
    || "",
  );
  const childId = subagentChildIdFrom(rec, previous, callId);
  const agentStatus = status === "inProgress" ? "running" : status === "failed" ? "failed" : "completed";
  let outputText = "";
  if (typeof output === "string") outputText = sliceOutputText(output.trim());
  else if (output && typeof output === "object") {
    try { outputText = sliceOutputText(JSON.stringify(output)); } catch { outputText = ""; }
  }
  const prevStates = asRecord(previous?.agentsStates);
  const prevState = asRecord(prevStates[childId]);
  const childIds = Array.isArray(previous?.receiverThreadIds)
    ? (previous.receiverThreadIds as JsonValue[]).filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  const receiverThreadIds = childIds.includes(childId) ? childIds : [...childIds, childId];
  return {
    type: "collabAgentToolCall",
    id: `muse-subagent-${callId}`,
    threadId,
    turnId,
    tool: toolName,
    status,
    startedAt: previous?.startedAt ?? nowSec(),
    senderThreadId: threadId,
    receiverThreadIds,
    prompt: prompt || asText(previous?.prompt) || "",
    agentId: childId,
    agentThreadId: childId,
    agentName: description || asText(previous?.agentName) || agentRole,
    agentRole,
    agentStatus,
    agentsStates: {
      [childId]: {
        status: agentStatus,
        message: description || asText(prevState.message) || `${agentRole} ${agentStatus}`,
      },
    },
    ...(outputText ? { output: outputText } : {}),
  } as Record<string, JsonValue>;
}

/** 已 started 的行再次收到富信息（args/子会话/结果）时发一次更新事件。 */
function emitItemUpdate(ctx: MuseProjectorContext, events: MuseProjectedEvent[], item: Record<string, JsonValue>): void {
  const status = String(item.status ?? "");
  const live = status === "inProgress" || status === "in_progress";
  events.push({
    kind: live ? "item/started" : "item/completed",
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    item,
  });
}

function toToolItem(
  threadId: string, turnId: string, callId: string,
  toolName: string, input: unknown, status: string, output?: unknown,
): Record<string, JsonValue> {
  const outputText = typeof output === "string"
    ? output
    : (output && typeof output === "object" ? (() => { try { return JSON.stringify(output); } catch { return String(output); } })() : undefined);
  // muse stdout 的 tool.result 不带 input（input 只存在于模型侧），瀑布流的
  // 参数详情行（对标 mini）靠 input.path/command 渲染；还原顺序：
  // 1) MCP 信封 JSON（action + 白名单参数，sa-vm 通道渲染 vm-<action>）；
  // 2) exec 信封 JSON（command/description/output，bash 类工具）；
  // 3) 结果首行反引号路径（read 类工具）；还原不出就留空——绝不编造命令。
  // sa-vm 动作尾行优先（调用方实参，真值），同时从输出中剥离；
  // 其余信封解析一律基于剥离后的干净文本。
  const trailer = outputText ? parseMuseSaVmTrailer(outputText) : null;
  const cleanText = trailer ? trailer.stripped : outputText;
  const envelope = cleanText ? parseMuseExecEnvelope(cleanText) : null;
  const mcpInput = !envelope && cleanText ? parseMuseMcpEnvelope(cleanText) : null;
  const innerOutput = envelope?.output ?? cleanText;
  const inferred = isEmptyInput(input)
    ? (trailer?.input
      ?? mcpInput
      ?? (envelope?.command
        ? { ...(envelope.description ? { description: envelope.description } : {}), command: envelope.command } as Record<string, JsonValue>
        : (innerOutput ? inferMuseToolInput(toolName, innerOutput) : null)))
    : null;
  const args = ((inferred ?? input ?? {}) as JsonValue);
  const item: Record<string, JsonValue> = {
    type: "toolCall",
    id: callId,
    threadId,
    turnId,
    name: toolName,
    tool: toolName,
    toolName,
    input: args,
    arguments: args,
    status,
    startedAt: nowSec(),
  };
  if (innerOutput !== undefined) item.output = sliceOutputText(innerOutput) as JsonValue;
  if (innerOutput !== undefined) item.text = sliceOutputText(innerOutput) as JsonValue;
  if (isMuseMcpToolName(toolName)) item.mcp = true as JsonValue;
  if (isMuseSkillToolName(toolName)) item.skill = true as JsonValue;
  return item;
}

function isEmptyInput(input: unknown): boolean {
  if (input === undefined || input === null) return true;
  if (typeof input === "string") return input.trim().length === 0;
  if (typeof input === "object" && !Array.isArray(input)) return Object.keys(input as Record<string, unknown>).length === 0;
  return false;
}

/**
 * 从 tool_output_ref 的输出引用里抠出 call_id → 工具名。
 * 实测两种形状（verified 2026-10-13）：
 * - id: "monitor-stdout-<task>-call_<id>"
 * - path/uri: ".../<task>/call_<id>-<tool>-stdout.txt"
 */
export function parseToolOutputRef(payload: Record<string, unknown>): { callId: string; toolName: string } | null {
  const event = asRecord(payload.event);
  const ref = asRecord(event.output_ref ?? payload.output_ref);
  const candidates = [ref.id, ref.path, ref.uri, ref.output_ref]
    .map((v) => (typeof v === "string" ? v : ""))
    .filter(Boolean);
  for (const text of candidates) {
    let m = text.match(/(call_[A-Za-z0-9]+)-([A-Za-z0-9_]+)-(stdout|stderr|output|result)\b/);
    if (m?.[1] && m?.[2]) return { callId: m[1], toolName: m[2] };
    m = text.match(/^([A-Za-z0-9_]+)-(stdout|stderr|output|result)-.+-(call_[A-Za-z0-9]+)$/);
    if (m?.[1] && m?.[3]) return { callId: m[3], toolName: m[1] };
  }
  return null;
}

/** "tool unavailable: unknown tool `X`" 这类失败文本里抠出被调工具名。 */
export function parseUnknownToolName(outputText: string): string | undefined {
  const m = outputText.match(/unknown tool\s*[`'"]?([A-Za-z0-9_.-]{1,120})[`'"]?/i);
  const name = m?.[1]?.trim().replace(/^[`'"]+|[`'"]+$/g, "");
  return name || undefined;
}

function isFailureOutputText(outputText: string): boolean {
  return /^\s*(tool unavailable|unknown tool|error:|failed:|failure:)/i.test(outputText);
}

/**
 * muse exec 类工具的结果是 JSON 信封（verified 2026-10-13，真机抓包）：
 * {"chunk_id":"exec-1-1","command":"git log ...","description":"... Chore",
 *  "exit_code":0,"terminal_status":"completed","output":"...","truncated":false}
 * 拆出 command/description 做 input（瀑布流详情行直接渲染命令，对标 mini），
 * output/text 只留真正的输出。
 */
export function parseMuseExecEnvelope(outputText: string): { command?: string; description?: string; output?: string; exitCode?: number } | null {
  const trimmed = outputText.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    const command = typeof rec.command === "string" && rec.command.trim() ? rec.command.trim() : undefined;
    const description = typeof rec.description === "string" && rec.description.trim() ? rec.description.trim() : undefined;
    const output = typeof rec.output === "string" ? rec.output : undefined;
    const exitCode = typeof rec.exit_code === "number" ? rec.exit_code : undefined;
    if (!command && output === undefined) return null;
    return { command, description, output, exitCode };
  } catch {
    return null;
  }
}

/**
 * muse MCP 结果是另一种 JSON 信封（verified 2026-10-13，真机抓包）：
 * {"status":"ok","action":"git_status","repo":"...","branch":"...","counts":{...}}
 * 拆出 action + 白名单参数做 input，瀑布流 sa-vm 通道直接渲染
 * `vm-<action>` + 参数详情（对标 mini/opencode 行）。白名单只取调用形参，
 * 结果数据留在 output/text 里，不污染 args。
 */
// 与 scripts/sa-vm-mcp.mjs 的 inputSchema.properties 全量对齐（2026-10-13）：
// 白名单缺 key 会导致瀑布流工具详情行丢参数（如 read_lines 的 start_line/
// end_line，前端 ChatRow 靠它们渲染 `path:start-end`）。只取调用形参标量，
// 结果数据留在 output/text。兼容键（command/url/destination/language/
// description）保留：部分真实信封自带。
const MCP_INPUT_KEYS = new Set([
  "action", "path", "file", "dir", "type", "depth", "max_entries", "max_files",
  "max_errors", "detail", "check_references", "force", "content", "patch",
  "old_text", "new_text", "start_line", "end_line", "lines", "max_tokens",
  "numbered", "pattern", "query", "is_regex", "queries", "max_file_bytes",
  "max_matches", "max_results", "page", "page_size", "count_cap", "exact_total",
  "symbol", "old_name", "new_name", "source", "target", "statement",
  "component_name", "profile", "subcommand", "exe", "args", "head_lines",
  "tail_lines", "env", "key", "fact", "level", "all", "from", "to", "cwd",
  "threadId", "question", "options", "checks", "questions", "goal", "thoughts",
  "context", "items", "criterion", "task", "phases", "plan", "constraints",
  "user_request", "actual_work", "evidence", "error_summary", "hypotheses",
  "proposed_fix", "code", "diff", "target_component", "mode", "direction",
  "format", "output_file", "candidate_files", "files", "staged", "stat_only",
  "pathspec", "diff_context", "parallel", "concurrency",
  "command", "url", "destination", "language", "description",
]);

// 纯标量或字符串数组才进 input：大对象（env/options/parallel 等）只留存在性，
// 防止巨型 JSON 撑爆瀑布流行与落盘。
function mcpInputValue(key: string, value: unknown): JsonValue | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value as JsonValue;
  }
  if ((key === "files" || key === "queries" || key === "args")
    && Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as JsonValue;
  }
  return undefined;
}

/**
 * sa-vm MCP 动作尾行（scripts/sa-vm-mcp.mjs 在 MUSE_SA_VM_ENVELOPE=1 时追加）：
 * 输出末尾的 `\n[sa-vm-action {"action":"read_lines","path":...}]`。
 * read_lines 类工具结果是人类文本、无 action 字段，stdout 又无模型侧 input，
 * 只有这行能还原调用参数。返回 {input, stripped}，调用方把 stripped 作为
 * 真正输出（尾行不进 output/text、不污染前端）。
 */
export function parseMuseSaVmTrailer(outputText: string): { input: Record<string, JsonValue>; stripped: string } | null {
  const m = outputText.match(/\n\[sa-vm-action (\{.*\})\]\s*$/s);
  if (!m?.[1]) return null;
  try {
    const parsed: unknown = JSON.parse(m[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.action !== "string" || !rec.action.trim()) return null;
    const input: Record<string, JsonValue> = { action: rec.action.trim() };
    for (const key of MCP_INPUT_KEYS) {
      if (key === "action") continue;
      const kept = mcpInputValue(key, rec[key]);
      if (kept !== undefined) input[key] = kept;
    }
    return { input, stripped: outputText.slice(0, m.index).trimEnd() };
  } catch {
    return null;
  }
}

export function parseMuseMcpEnvelope(outputText: string): Record<string, JsonValue> | null {
  const trimmed = outputText.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.action !== "string" || !rec.action.trim()) return null;
    const input: Record<string, JsonValue> = { action: rec.action.trim() };
    for (const key of MCP_INPUT_KEYS) {
      if (key === "action") continue;
      const kept = mcpInputValue(key, rec[key]);
      if (kept !== undefined) input[key] = kept;
    }
    return input;
  } catch {
    return null;
  }
}

/**
 * 从 muse 工具结果首行保守还原参数（只取反引号/引号包裹的路径 token，
 * 必须无空格、含 / 或带扩展名、长度 < 300；bash 输出等还原不出的不碰）。
 */
export function inferMuseToolInput(toolName: string, outputText: string): Record<string, JsonValue> | null {
  const firstLine = outputText.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!firstLine) return null;
  const m = firstLine.match(/[`"']([^`\"']{1,300})[`"']/);
  if (m) {
    const token = (m[1] ?? "").trim();
    if (/^[^\s]{1,300}$/.test(token) && (token.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(token))) {
      return { path: token } as Record<string, JsonValue>;
    }
  }
  if (isMuseSkillToolName(toolName)) {
    const s = firstLine.match(/skill\s*[:"']?\s*([A-Za-z0-9._-]{1,80})/i);
    if (s) return { skill: s[1] } as Record<string, JsonValue>;
  }
  return null;
}

/** 从任意 record 结构中抠出 tool 名 / callId / input / output / 文本。 */
function pickToolFields(payload: Record<string, unknown>): { toolName?: string; callId?: string; input?: unknown; output?: unknown; text?: string; reasoning?: string; todos?: unknown } {
  const record = asRecord(payload.record ?? payload);
  const facts = asRecord(payload.correlation_facts ?? record.correlation_facts);
  const toolName = asText(payload.tool_name) ?? asText(record.tool_name) ?? asText(facts.tool_name)
    ?? asText(payload.toolName) ?? asText(record.toolName) ?? asText(payload.tool) ?? asText(record.tool)
    ?? asText(payload.name) ?? asText(record.name);
  const callId = asText(payload.call_id) ?? asText(record.call_id) ?? asText(payload.callId)
    ?? asText(record.callId) ?? asText(payload.callID) ?? asText(record.callID) ?? asText(payload.id) ?? asText(record.effect_id);
  const input = payload.input ?? record.input ?? record.args ?? payload.args ?? record.arguments;
  const output = payload.output ?? record.output ?? payload.result ?? record.result ?? payload.text ?? record.text;
  const text = asText(payload.text) ?? asText(record.text);
  const reasoning = asText(payload.reasoning) ?? asText(record.reasoning) ?? asText(payload.thinking) ?? asText(record.thinking);
  const todos = payload.todos ?? record.todos ?? record.tasks ?? (asRecord(input).todos ?? asRecord(input).tasks);
  return { toolName, callId, input, output, text, reasoning, todos };
}

/** Muse 模型侧入参在 stdout 里不存在，只在 session log 的
 * `assistant_tool_calls_committed.tool_calls[].args` 里（JSON 字符串）。
 * 投影它可以把原生工具（subagent_spawn / workflow / bash / read_file）的
 * 真实参数补回已开始的工具行，而不是只能靠结果文本反推。 */
function projectToolCallsCommitted(ctx: MuseProjectorContext, event: Record<string, unknown>): MuseProjectedEvent[] {
  const events: MuseProjectedEvent[] = [];
  const calls = Array.isArray(event.tool_calls) ? event.tool_calls : [];
  if (calls.length === 0) return events;
  for (const entry of calls) {
    const rec = asRecord(entry);
    const name = asText(rec.name) ?? asText(rec.tool_name);
    const callId = asText(rec.call_id) ?? asText(rec.callId) ?? asText(rec.id);
    if (!name || !callId) continue;
    let input: Record<string, JsonValue> = {};
    const rawArgs = rec.args ?? rec.arguments ?? rec.input;
    if (typeof rawArgs === "string" && rawArgs.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawArgs);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          input = parsed as Record<string, JsonValue>;
        }
      } catch { /* 非 JSON 参数不强行解析 */ }
    } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
      input = rawArgs as Record<string, JsonValue>;
    }
    if (isEmptyInput(input)) continue;
    ensureTurnStarted(ctx, events);
    const prev = ctx.activeTools.get(callId);
    if (isMuseAgentCardToolName(name)) {
      // 保留上一版（可能已由 subagent.control 填了子会话 id / 结果）。
      const base = buildSubagentItem(
        ctx.threadId, ctx.turnId, callId, name, input,
        String(prev?.status ?? "inProgress"), prev?.output, prev,
      );
      // workflow 的 args 带完整脚本（数 KB–数十 KB），卡片只留可读元数据，
      // 避免把脚本写进瀑布流历史；prompt 已从脚本提取到独立字段。
      const cardInput: Record<string, JsonValue> = normToolName(name) === "workflow"
        ? {
          ...(asText(input.name) ? { name: String(input.name) } : {}),
          ...(base.prompt ? { prompt: base.prompt } : {}),
          ...(typeof input.script === "string" ? { scriptChars: input.script.length } : {}),
        }
        : input;
      const item = prev
        ? {
          ...base,
          ...prev,
          tool: name,
          name,
          input: cardInput,
          arguments: cardInput,
          prompt: base.prompt || String(prev.prompt ?? ""),
          agentName: base.agentName,
          agentRole: base.agentRole,
        } as Record<string, JsonValue>
        : { ...base, name, input: cardInput, arguments: cardInput } as Record<string, JsonValue>;
      ctx.activeTools.set(callId, item);
      emitItemUpdate(ctx, events, item);
      continue;
    }
    if (isMusePlanToolName(name)) {
      const steps = extractPlanSteps(input, undefined);
      if (steps) {
        pushPlanUpdate(ctx, events, steps);
        continue;
      }
    }
    const item = toToolItem(ctx.threadId, ctx.turnId, callId, name, input, String(prev?.status ?? "inProgress"), prev?.output);
    ctx.activeTools.set(callId, item);
    emitItemUpdate(ctx, events, item);
  }
  return events;
}

function callIdFromWorkflowRunId(runId: string | undefined): string | undefined {
  if (!runId) return undefined;
  const m = runId.match(/model-tool-(.+)$/);
  return m?.[1] ? `call-${m[1]}` : undefined;
}

function parseJsonObjectText(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function mapMuseChildStatus(status: string | undefined, terminal: string | undefined): string {
  const t = (terminal ?? "").toLowerCase();
  if (t === "failed" || t === "cancelled" || t === "error") return "failed";
  if (t === "completed") return "completed";
  const s = (status ?? "").toLowerCase();
  if (s === "completed" || s === "terminal") return "completed";
  if (s === "failed" || s === "error" || s === "cancelled") return "failed";
  return "running";
}

function workflowChildrenState(item: Record<string, JsonValue>): Array<Record<string, JsonValue>> {
  return Array.isArray(item.children)
    ? (item.children as JsonValue[]).filter((v): v is Record<string, JsonValue> => Boolean(v) && typeof v === "object")
    : [];
}

function projectWorkflowLaunched(ctx: MuseProjectorContext, event: Record<string, unknown>): MuseProjectedEvent[] {
  const events: MuseProjectedEvent[] = [];
  const runId = asText(event.workflow_run_id);
  const callId = asText(event.call_id) ?? callIdFromWorkflowRunId(runId);
  if (!callId) return events;
  if (runId) ctx.workflowCallByRunId.set(runId, callId);
  const entryId = asText(event.entry_id) ?? asText(event.name) ?? "workflow";
  const prev = ctx.activeTools.get(callId);
  const base = prev ?? buildSubagentItem(
    ctx.threadId, ctx.turnId, callId, "workflow",
    { name: entryId }, "inProgress", undefined, prev,
  );
  const item: Record<string, JsonValue> = {
    ...base,
    name: "workflow",
    tool: "workflow",
    status: "inProgress",
    agentStatus: "running",
    agentName: entryId,
    entryId,
    workflowRunId: runId ?? undefined,
    scriptId: asText(event.script_id),
    scriptPath: asText(event.script_path),
    childLimit: typeof event.child_limit === "number" ? event.child_limit : undefined,
  } as Record<string, JsonValue>;
  ctx.activeTools.set(callId, item);
  emitItemUpdate(ctx, events, item);
  return events;
}

function projectWorkflowChild(ctx: MuseProjectorContext, event: Record<string, unknown>): MuseProjectedEvent[] {
  const events: MuseProjectedEvent[] = [];
  const runId = asText(event.workflow_run_id);
  const callId = (runId ? ctx.workflowCallByRunId.get(runId) : undefined) ?? callIdFromWorkflowRunId(runId);
  const childId = asText(event.child_id);
  if (!callId || !childId) return events;
  if (runId && !ctx.workflowCallByRunId.has(runId)) ctx.workflowCallByRunId.set(runId, callId);
  const stream = asRecord(event.session_stream);
  const sessionId = asText(stream.id) ?? asText(event.child_session_id) ?? childId;
  const status = mapMuseChildStatus(asText(event.status), asText(event.terminal));
  const prev = ctx.activeTools.get(callId) ?? buildSubagentItem(
    ctx.threadId, ctx.turnId, callId, "workflow", { name: asText(event.label) ?? "workflow" }, "inProgress",
  );
  const children = workflowChildrenState(prev).filter((child) => asText(child.id) !== childId);
  const existing = workflowChildrenState(prev).find((child) => asText(child.id) === childId);
  children.push({
    id: childId,
    sessionId,
    label: asText(event.label) ?? asText(existing?.label) ?? childId,
    status,
    attempt: typeof event.attempt === "number" ? event.attempt : (existing?.attempt ?? 1),
    durationMs: typeof event.duration_ms === "number" ? event.duration_ms : existing?.durationMs,
    resultRef: asText(event.result_ref) ?? existing?.resultRef,
  } as Record<string, JsonValue>);
  const terminal = children.every((child) => asText(child.status) !== "running");
  const sessions = children
    .map((child) => asText(child.sessionId))
    .filter((v): v is string => Boolean(v));
  const agentsStates: Record<string, JsonValue> = {};
  for (const child of children) {
    const id = asText(child.sessionId) ?? asText(child.id) ?? "workflow-child";
    agentsStates[id] = {
      status: asText(child.status) ?? "running",
      message: asText(child.label) ?? "",
    };
  }
  const item: Record<string, JsonValue> = {
    ...prev,
    status: "inProgress",
    agentStatus: terminal ? "completed" : "running",
    receiverThreadIds: sessions.length > 0 ? sessions : prev.receiverThreadIds,
    agentThreadId: sessions[0] ?? prev.agentThreadId,
    agentsStates,
    children,
  } as Record<string, JsonValue>;
  ctx.activeTools.set(callId, item);
  emitItemUpdate(ctx, events, item);
  return events;
}

function projectWorkflowReconciled(ctx: MuseProjectorContext, event: Record<string, unknown>): MuseProjectedEvent[] {
  const events: MuseProjectedEvent[] = [];
  const callId = asText(event.call_id);
  if (!callId) return events;
  const message = parseJsonObjectText(asText(event.message));
  const projection = asRecord(event.product_projection);
  const rows: Array<Record<string, unknown>> = Array.isArray(projection.child_rows)
    ? (projection.child_rows as JsonValue[]).map((v) => asRecord(v)).filter((r) => Object.keys(r).length > 0)
    : [];
  const finalSummary = asRecord(message?.final_summary);
  const summary = asText(finalSummary.summary) ?? asText(finalSummary.text) ?? "";
  const failed = /fail|error/i.test(asText(finalSummary.status) ?? "")
    || Boolean(message?.latest_failure);
  const prev = ctx.activeTools.get(callId) ?? buildSubagentItem(
    ctx.threadId, ctx.turnId, callId, "workflow", { name: "workflow" }, "inProgress",
  );
  const children = workflowChildrenState(prev).map((child) => {
    const row = rows.find((candidate) => asText(candidate.subagent_id) === asText(child.id));
    const rowSummary = asText(row?.summary);
    return {
      ...child,
      status: failed ? "failed" : (asText(child.status) === "failed" ? "failed" : "completed"),
      ...(rowSummary ? { summary: rowSummary } : {}),
    } as Record<string, JsonValue>;
  });
  const sessions = children
    .map((child) => asText(child.sessionId))
    .filter((v): v is string => Boolean(v));
  const agentsStates: Record<string, JsonValue> = {};
  for (const child of children) {
    const id = asText(child.sessionId) ?? asText(child.id) ?? "workflow-child";
    const row = rows.find((candidate) => asText(candidate.subagent_id) === asText(child.id));
    const rowSummary = asText(row?.summary) ?? asText(child.summary);
    agentsStates[id] = {
      status: asText(child.status) ?? "completed",
      ...(rowSummary ? { message: rowSummary } : {}),
    };
  }
  const item: Record<string, JsonValue> = {
    ...prev,
    status: failed ? "failed" : "completed",
    agentStatus: failed ? "failed" : "completed",
    receiverThreadIds: sessions.length > 0 ? sessions : prev.receiverThreadIds,
    agentsStates,
    children,
    ...(summary ? { output: sliceOutputText(summary), finalSummary: summary } : {}),
    background: message?.deferred_to_background === true,
    finalSummary: summary || undefined,
  } as Record<string, JsonValue>;
  ctx.activeTools.set(callId, item);
  emitItemUpdate(ctx, events, item);
  return events;
}

/** 原生 subagent_spawn / subagent_wait 控制面（Muse 1.4.11 顶层 payload）：
 * spawn_accepted / resume_context_recorded / child_session_bound /
 * start_attested / status_updated / runtime_observed / result_ready。 */
function projectSubagentControl(
  ctx: MuseProjectorContext, payloadType: string, payload: Record<string, unknown>,
): MuseProjectedEvent[] {
  const events: MuseProjectedEvent[] = [];
  const kind = payloadType.slice("subagent.control.".length);
  const rec = asRecord(payload.record);
  const subagentId = asText(rec.subagent_id) ?? asText(rec.subagentId);
  if (!subagentId) return events;

  if (kind === "resume_context_recorded" || kind === "spawn_accepted") {
    const meta = {
      objective: asText(rec.objective) ?? ctx.subagentMetaBySubagentId.get(subagentId)?.objective,
      role: asText(rec.role) ?? ctx.subagentMetaBySubagentId.get(subagentId)?.role,
      taskName: asText(rec.task_name) ?? ctx.subagentMetaBySubagentId.get(subagentId)?.taskName,
    };
    ctx.subagentMetaBySubagentId.set(subagentId, meta);
    return events;
  }
  if (kind === "child_session_bound") {
    const child = asText(rec.child_session_id) ?? asText(rec.childSessionId);
    if (child) ctx.subagentChildBySubagentId.set(subagentId, child);
    return events;
  }
  const callId = asText(rec.dispatched_via_tool_call_id) ?? ctx.subagentCallBySubagentId.get(subagentId);
  if (kind === "start_attested") {
    if (callId) ctx.subagentCallBySubagentId.set(subagentId, callId);
    const child = asText(rec.subagent_session_id) ?? asText(rec.subagentSessionId)
      ?? ctx.subagentChildBySubagentId.get(subagentId);
    if (child) ctx.subagentChildBySubagentId.set(subagentId, child);
    if (callId && child) {
      const prev = ctx.activeTools.get(callId);
      if (prev) {
        const item: Record<string, JsonValue> = {
          ...prev,
          subagentId,
          childSessionId: child,
          receiverThreadIds: [child],
          agentThreadId: child,
          agentId: child,
          agentStatus: "running",
          agentsStates: {
            [child]: { status: "running", message: asText(prev.agentName) ?? "running" },
          },
        } as Record<string, JsonValue>;
        ctx.activeTools.set(callId, item);
        emitItemUpdate(ctx, events, item);
      }
    }
    return events;
  }
  if (!callId) return events;
  const prev = ctx.activeTools.get(callId);
  if (!prev) return events;
  const child = ctx.subagentChildBySubagentId.get(subagentId);
  const meta = ctx.subagentMetaBySubagentId.get(subagentId);
  if (kind === "status_updated") {
    const control = (asText(rec.control_status) ?? "running").toLowerCase();
    const item: Record<string, JsonValue> = {
      ...prev,
      status: control === "failed" || control === "cancelled" ? "failed" : "inProgress",
      agentStatus: control === "failed" || control === "cancelled" ? "failed" : "running",
      ...(child ? { agentsStates: { [child]: { status: control, message: asText(prev.agentName) ?? "" } } } : {}),
    } as Record<string, JsonValue>;
    ctx.activeTools.set(callId, item);
    emitItemUpdate(ctx, events, item);
    return events;
  }
  if (kind === "result_ready") {
    const summary = asText(rec.summary) ?? asText(rec.text) ?? "";
    const failed = Boolean(rec.error_kind);
    const item: Record<string, JsonValue> = {
      ...prev,
      status: failed ? "failed" : "completed",
      agentStatus: failed ? "failed" : "completed",
      prompt: asText(prev.prompt) || meta?.objective || "",
      agentName: asText(prev.agentName) || meta?.taskName || meta?.role || "subagent",
      ...(child ? {
        receiverThreadIds: [child],
        agentThreadId: child,
        agentId: child,
        agentsStates: { [child]: { status: failed ? "failed" : "completed", message: summary } },
      } : {}),
      ...(summary ? { output: sliceOutputText(summary) } : {}),
    } as Record<string, JsonValue>;
    ctx.activeTools.set(callId, item);
    emitItemUpdate(ctx, events, item);
    return events;
  }
  return events;
}

/**
 * 投影单条 muse exec JSONL 记录。纯函数，只读写 ctx。
 * 已确认的 payload_type：
 * - run.output.delta {text} -> agent 文本流
 * - run.terminal.completed/failed {text} -> 交由 runtime 收尾（此处顺手闭合 items）
 * - tool_batch.effect.started/terminal {record:{tool_name,call_id,...}} -> 工具行
 * 其余未知 payload 按通用规则尝试提取（绝不抛错）。
 */
export function projectMuseJsonlRecord(line: string, ctx: MuseProjectorContext): MuseProjectedEvent[] {
  const events: MuseProjectedEvent[] = [];
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return events;
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return events;
  }
  if (ctx.status !== "running") return events;
  const payloadType = typeof record.payload_type === "string" ? record.payload_type : "";
  const payload = asRecord(record.payload);

  // 0) session log 的结构化事件：
  //    `assistant_tool_calls_committed` 带模型真实入参（stdout 没有）；
  //    `workflow_*` 带子会话 id / 状态 / 最终结论（stdout 只有启动回执）；
  //    `subagent.control.*` 是原生 subagent_spawn 的完整生命周期（顶层 payload）。
  if (payloadType === "runtime.session") {
    const inner = asRecord(payload.event);
    if (typeof inner.kind === "string") {
      if (inner.kind === "assistant_tool_calls_committed") return projectToolCallsCommitted(ctx, inner);
      if (inner.kind === "workflow_run_launched") return projectWorkflowLaunched(ctx, inner);
      if (inner.kind === "workflow_child_lifecycle") return projectWorkflowChild(ctx, inner);
      if (inner.kind === "workflow_launch_reconciled") return projectWorkflowReconciled(ctx, inner);
      if (ctx.offline) {
        if (inner.kind === "reasoning_committed" || inner.kind === "thinking_committed") {
          const text = asText(inner.text);
          if (text) {
            pushReasoningDelta(ctx, events, text);
            completeActiveReasoning(ctx, events);
          }
          return events;
        }
        if (inner.kind === "assistant_message_committed" || inner.kind === "assistant_text_committed"
          || inner.kind === "agent_message_committed" || inner.kind === "message_committed") {
          const text = asText(inner.text) ?? asText(asRecord(inner.message).text);
          if (text) {
            pushAssistantDelta(ctx, events, text);
            completeActiveAssistant(ctx, events);
          }
          return events;
        }
        if (inner.kind === "workflow_child_result_submitted") {
          const text = asText(asRecord(inner.payload).text) ?? asText(inner.text);
          if (text) {
            ensureTurnStarted(ctx, events);
            completeActiveReasoning(ctx, events);
            pushAssistantDelta(ctx, events, text);
            completeActiveAssistant(ctx, events);
          }
          return events;
        }
        if (inner.kind === "tool_result_batch_committed") {
          const results = Array.isArray(inner.results) ? inner.results : [];
          for (const raw of results) {
            const result = asRecord(raw);
            const callId = asText(result.tool_call_id) ?? asText(result.call_id);
            if (!callId) continue;
            const output = asText(result.text) ?? asText(result.output) ?? "";
            const prev = ctx.activeTools.get(callId);
            const name = asText(prev?.toolName) ?? asText(prev?.tool) ?? asText(prev?.name) ?? "tool";
            const item = toToolItem(ctx.threadId, ctx.turnId, callId, name, (prev?.input as Record<string, JsonValue>) ?? {}, "completed", output);
            ctx.activeTools.set(callId, item);
            events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item });
          }
          return events;
        }
        if (inner.kind === "terminal") {
          const terminal = asText(inner.terminal) ?? asText(inner.status) ?? "";
          ctx.status = /fail|error|cancel/i.test(terminal) ? "failed" : "completed";
          return events;
        }
      }
    }
    return events;
  }
  if (payloadType === "assistant_tool_calls_committed") {
    return projectToolCallsCommitted(ctx, payload);
  }
  if (payloadType.startsWith("subagent.control.")) {
    return projectSubagentControl(ctx, payloadType, payload);
  }

  // 1) 助手纯文本增量（历史行为，保持兼容）
  if (payloadType === "run.output.delta") {
    const text = asText(payload.text);
    if (text) pushAssistantDelta(ctx, events, text);
    return events;
  }

  // 2) 显式 reasoning / thinking 增量（不同版本字段名兼容）
  if (payloadType === "run.reasoning.delta" || payloadType === "run.thinking.delta"
    || payloadType === "run.output.reasoning.delta") {
    const text = asText(payload.text) ?? asText(payload.reasoning) ?? asText(payload.thinking) ?? asText(payload.delta);
    if (text) pushReasoningDelta(ctx, events, text);
    return events;
  }

  // 3b) exec stdout 权威工具事件：`tool.result`（verified 2026-10-13：
  //      stdout 只有 result、没有 started；tool 名在 correlation_facts.tool_name）。
  //      没有 started 对应行，所以一次发射 started+completed 对，保证瀑布流可见。
  if (payloadType === "tool.result" || payloadType === "tool_result") {
    ensureTurnStarted(ctx, events);
    completeActiveReasoning(ctx, events);
    completeActiveAssistant(ctx, events);
    const { toolName, callId, input, output } = pickToolFields(payload);
    const outputText = typeof output === "string" ? output : "";
    // 部分 tool.result 缺 correlation_facts（多见于失败调用）：先查
    // tool_output_ref 回填表，再从 "unknown tool `X`" 文本里抠，最后才回退 "tool"。
    const resolvedName = toolName
      ?? (callId ? ctx.toolNameByCallId.get(callId) : undefined)
      ?? (outputText ? parseUnknownToolName(outputText) : undefined)
      ?? "tool";
    const name = resolvedName;
    const id = callId ?? `${ctx.turnId}-${Date.now()}`;
    const rec = asRecord(payload.record ?? payload);
    const facts = asRecord((payload as Record<string, unknown>).correlation_facts ?? rec.correlation_facts);
    const outcome = asText(facts.outcome) ?? "";
    const failed = /fail|error/.test(outcome.toLowerCase()) || (outputText ? isFailureOutputText(outputText) : false);
    const status = failed ? "failed" : "completed";
    if (isMusePlanToolName(name)) {
      const steps = extractPlanSteps(input, output);
      ctx.pendingPlanCandidates.delete(id);
      if (steps) {
        pushPlanUpdate(ctx, events, steps);
        return events;
      }
    }
    if (isMuseSubagentControlToolName(name)) {
      // 控制面工具（wait/read_result/status/cancel/send_message）是普通工具行；
      // 同时把结果摘要回填到对应 spawn 卡片。
      const prev = ctx.activeTools.get(id);
      const prevInput = prev ? (prev.input ?? prev.arguments) : undefined;
      const effectiveInput = isEmptyInput(input) && !isEmptyInput(prevInput) ? prevInput : input;
      const itemStarted = toToolItem(ctx.threadId, ctx.turnId, id, name, effectiveInput ?? {}, "inProgress", output);
      const itemFinished: Record<string, JsonValue> = { ...itemStarted, status: status as JsonValue };
      events.push({ kind: "item/started", threadId: ctx.threadId, turnId: ctx.turnId, item: itemStarted });
      events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item: itemFinished });
      ctx.activeTools.set(id, itemFinished);
      const parsedResult = parseJsonObjectText(outputText);
      const spawnedId = asText(parsedResult?.subagent_id) ?? asText(parsedResult?.subagentId);
      const summary = asText(parsedResult?.summary) ?? asText(parsedResult?.text);
      if (spawnedId) {
        const child = asText(parsedResult?.child_session_id) ?? asText(parsedResult?.childSessionId);
        if (child) ctx.subagentChildBySubagentId.set(spawnedId, child);
        const spawnCallId = ctx.subagentCallBySubagentId.get(spawnedId);
        const spawn = spawnCallId ? ctx.activeTools.get(spawnCallId) : undefined;
        if (spawnCallId && spawn) {
          const resolvedChild = ctx.subagentChildBySubagentId.get(spawnedId) ?? child;
          const updated: Record<string, JsonValue> = {
            ...spawn,
            status: "completed",
            agentStatus: "completed",
            ...(resolvedChild ? {
              receiverThreadIds: [resolvedChild],
              agentThreadId: resolvedChild,
              agentId: resolvedChild,
              agentsStates: { [resolvedChild]: { status: "completed", message: summary ?? "" } },
            } : {}),
            ...(summary ? { output: sliceOutputText(summary) } : {}),
          } as Record<string, JsonValue>;
          ctx.activeTools.set(spawnCallId, updated);
          emitItemUpdate(ctx, events, updated);
        }
      }
      return events;
    }
    if (isMuseAgentCardToolName(name)) {
      const normName = normToolName(name);
      const isWorkflow = normName === "workflow";
      const isSpawn = normName === "subagentspawn" || normName === "task" || normName === "subagent";
      const isWaitLike = normName === "subagentwait" || normName === "subagentreadresult" || normName === "subagentstatus";
      const prev = ctx.activeTools.get(id);
      const parsed = parseJsonObjectText(outputText);
      const spawnedId = asText(parsed?.subagent_id) ?? asText(parsed?.subagentId);
      if (isSpawn && spawnedId) {
        ctx.subagentCallBySubagentId.set(spawnedId, id);
        const child = asText(parsed?.child_session_id) ?? asText(parsed?.childSessionId);
        if (child) ctx.subagentChildBySubagentId.set(spawnedId, child);
      }
      let base = buildSubagentItem(ctx.threadId, ctx.turnId, id, name, input, "inProgress", undefined, prev);
      if (prev) {
        base = {
          ...base,
          ...prev,
          tool: name,
          prompt: asText(prev.prompt) || base.prompt,
          agentName: asText(prev.agentName) || base.agentName,
          receiverThreadIds: (Array.isArray(prev.receiverThreadIds) && prev.receiverThreadIds.length > 0)
            ? prev.receiverThreadIds
            : base.receiverThreadIds,
        } as Record<string, JsonValue>;
      }
      if (isWorkflow) {
        base = {
          ...base,
          name: "workflow",
          tool: "workflow",
          entryId: asText(parsed?.entryId) ?? asText(parsed?.entry_id) ?? prev?.entryId,
          scriptPath: asText(parsed?.scriptPath) ?? asText(parsed?.script_path) ?? prev?.scriptPath,
          workflowRunId: asText(parsed?.workflowRunId) ?? asText(parsed?.workflow_run_id) ?? prev?.workflowRunId,
        } as Record<string, JsonValue>;
      } else if (isSpawn) {
        base = {
          ...base,
          subagentId: spawnedId ?? prev?.subagentId,
          agentName: asText(prev?.agentName) || asText(parsed?.agent_path) || base.agentName,
        } as Record<string, JsonValue>;
      }
      // workflow/spawn 的 tool.result 只是启动回执，子任务仍在后台；
      // wait/read_result 才是结果面。保持 inProgress，等 reconciled /
      // subagent.control.result_ready 收尾，避免卡片提前显示完成。
      const keepLive = !failed && (isWorkflow || isSpawn);
      const itemStatus = keepLive ? "inProgress" : status;
      const item: Record<string, JsonValue> = {
        ...base,
        status: itemStatus,
        agentStatus: failed ? "failed" : keepLive ? "running" : "completed",
      } as Record<string, JsonValue>;
      if (!isWorkflow && outputText && (!keepLive || isWaitLike)) {
        item.output = sliceOutputText(outputText);
      }
      if (isWorkflow && outputText) item.output = sliceOutputText(outputText);
      ctx.activeTools.set(id, item);
      if (keepLive) {
        events.push({ kind: "item/started", threadId: ctx.threadId, turnId: ctx.turnId, item });
      } else {
        events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item });
      }
      // wait/read_result 的结果同时回填对应 spawn 卡片。
      if (isWaitLike && spawnedId) {
        const spawnCallId = ctx.subagentCallBySubagentId.get(spawnedId);
        const spawn = spawnCallId ? ctx.activeTools.get(spawnCallId) : undefined;
        const summary = asText(parsed?.summary) ?? asText(parsed?.text);
        if (spawnCallId && spawn) {
          const child = ctx.subagentChildBySubagentId.get(spawnedId);
          const updated: Record<string, JsonValue> = {
            ...spawn,
            status: "completed",
            agentStatus: "completed",
            ...(child ? {
              receiverThreadIds: [child],
              agentThreadId: child,
              agentId: child,
              agentsStates: { [child]: { status: "completed", message: summary ?? "" } },
            } : {}),
            ...(summary ? { output: sliceOutputText(summary) } : {}),
          } as Record<string, JsonValue>;
          ctx.activeTools.set(spawnCallId, updated);
          emitItemUpdate(ctx, events, updated);
        }
      }
      return events;
    }
    // session-log 先给了 started 行（富 input）时：result 自带 input 为空
    // 则沿用 started 的，不让开始参数被洗成空（A→B→C 顺序与参数显示都靠它）。
    const prev = ctx.activeTools.get(id);
    const prevInput = prev ? (prev.input ?? prev.arguments) : undefined;
    const effectiveInput = isEmptyInput(input) && !isEmptyInput(prevInput) ? prevInput : input;
    const started = toToolItem(ctx.threadId, ctx.turnId, id, name, effectiveInput ?? {}, "inProgress", output);
    // output/text 已在 toToolItem 内做 exec 信封拆包 + 截断，这里只翻状态，不复写。
    const finished: Record<string, JsonValue> = { ...started, status: status as JsonValue };
    events.push({ kind: "item/started", threadId: ctx.threadId, turnId: ctx.turnId, item: started });
    events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item: finished });
    ctx.activeTools.set(id, finished);
    return events;
  }

  // 3a) 输出引用先行：tool_output_ref（文件名里带 <tool>-stdout）比
  //      tool.result 先到，按 call_id 记住工具名，供缺名 result 回填。
  if (payloadType === "task.lifecycle.tool_output_ref" || payloadType === "tool_output_ref") {
    const parsed = parseToolOutputRef(payload);
    if (parsed) ctx.toolNameByCallId.set(parsed.callId, parsed.toolName);
    return events;
  }

  // 3) 工具开始 / 结束
  if (payloadType === "tool_batch.effect.started" || payloadType === "tool.effect.started"
    || payloadType === "tool.started" || payloadType === "tool_call.started") {
    ensureTurnStarted(ctx, events);
    completeActiveReasoning(ctx, events);
    completeActiveAssistant(ctx, events);
    const { toolName, callId, input, todos } = pickToolFields(payload);
    const name = toolName ?? "tool";
    const id = callId ?? `${ctx.turnId}-${Date.now()}`;
    if (isMusePlanToolName(name)) {
      const steps = extractPlanSteps(input, undefined) ?? (todos ? planStepsFromValue(todos) : null);
      if (steps) {
        pushPlanUpdate(ctx, events, steps);
      } else {
        ctx.pendingPlanCandidates.add(id);
      }
      return events;
    }
    if (isMuseAgentCardToolName(name)) {
      const prev = ctx.activeTools.get(id);
      const item = prev ?? buildSubagentItem(ctx.threadId, ctx.turnId, id, name, input, "inProgress");
      ctx.activeTools.set(id, item);
      emitItemUpdate(ctx, events, item);
      return events;
    }
    const prevItem = ctx.activeTools.get(id);
    const prevInput = prevItem ? (prevItem.input ?? prevItem.arguments) : undefined;
    const effectiveInput = isEmptyInput(input) && !isEmptyInput(prevInput) ? prevInput : input;
    const item = toToolItem(ctx.threadId, ctx.turnId, id, name, effectiveInput ?? {}, "inProgress");
    ctx.activeTools.set(id, item);
    events.push({ kind: "item/started", threadId: ctx.threadId, turnId: ctx.turnId, item });
    return events;
  }

  if (payloadType === "tool_batch.effect.terminal" || payloadType === "tool.effect.terminal"
    || payloadType === "tool.completed" || payloadType === "tool_call.completed") {
    ensureTurnStarted(ctx, events);
    const { toolName, callId, input, output, todos } = pickToolFields(payload);
    const rec = asRecord(payload.record ?? payload);
    const outcome = asRecord(rec.outcome ?? payload.outcome);
    const failed = asText(outcome.kind) === "failed" || asText(outcome.kind) === "error"
      || (rec as Record<string, unknown>).error !== undefined;
    const status = failed ? "failed" : "completed";
    const prevItem = callId ? ctx.activeTools.get(callId) : undefined;
    const prevName = prevItem
      ? (asText(prevItem.toolName) ?? asText(prevItem.tool) ?? asText(prevItem.name))
      : undefined;
    const name = toolName ?? prevName ?? "tool";
    const id = callId ?? `${ctx.turnId}-${Date.now()}`;
    if (isMusePlanToolName(typeof name === "string" ? name : "tool")) {
      const steps = extractPlanSteps(input, output) ?? (todos ? planStepsFromValue(todos) : null);
      ctx.pendingPlanCandidates.delete(id);
      if (steps) {
        pushPlanUpdate(ctx, events, steps);
        return events;
      }
      // 无可投影 todos：回退为普通工具行，保证可见
    }
    if (isMuseAgentCardToolName(typeof name === "string" ? name : "")) {
      const toolNameResolved = typeof name === "string" ? name : "task";
      const prev = ctx.activeTools.get(id);
      const base = buildSubagentItem(ctx.threadId, ctx.turnId, id, toolNameResolved, input, status, output, prev);
      const live = !failed && /^(workflow|subagentspawn|subagent|task)$/.test(normToolName(toolNameResolved));
      const item: Record<string, JsonValue> = {
        ...base,
        ...(prev ?? {}),
        status: live ? "inProgress" : status,
        agentStatus: live ? "running" : String(base.agentStatus ?? "completed"),
      };
      ctx.activeTools.set(id, item);
      emitItemUpdate(ctx, events, item);
      return events;
    }
    const prev = ctx.activeTools.get(id);
    const baseInput = input ?? (prev?.input as unknown) ?? {};
    const item = toToolItem(ctx.threadId, ctx.turnId, id, typeof name === "string" ? name : "tool", baseInput, status, output);
    ctx.activeTools.set(id, item);
    events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item });
    return events;
  }

  // 4) todo 独立同步事件（对齐 opencode todo.updated）
  if (payloadType === "session.todoListChanged" || payloadType === "todo.updated" || payloadType === "session.todolist.changed") {
    const steps = planStepsFromValue(payload.todos ?? payload.items ?? asRecord(payload.record).todos ?? asRecord(payload.record).items);
    if (steps) {
      ensureTurnStarted(ctx, events);
      pushPlanUpdate(ctx, events, steps);
    }
    return events;
  }

  // 5) 通用兜底：任何带 tool_name/call_id 的记录都投影为工具行；
  //    带 reasoning/thinking 文本的记录投影为 thinking 流；
  //    带 todos 数组的记录投影为 todolist。
  if (!payloadType || payloadType.includes("tool") || payloadType.includes("subagent") || payloadType.includes("skill") || payloadType.includes("mcp")) {
    const { toolName, callId, input, output, text, reasoning, todos } = pickToolFields(payload);
    if (reasoning) {
      pushReasoningDelta(ctx, events, reasoning);
      return events;
    }
    if (todos) {
      const steps = planStepsFromValue(todos) ?? extractPlanSteps(input, output);
      if (steps) {
        ensureTurnStarted(ctx, events);
        pushPlanUpdate(ctx, events, steps);
        return events;
      }
    }
    if (toolName) {
      ensureTurnStarted(ctx, events);
      completeActiveReasoning(ctx, events);
      completeActiveAssistant(ctx, events);
      const id = callId ?? `${ctx.turnId}-${Date.now()}`;
      const terminal = /terminal|completed|failed|error/i.test(payloadType);
      if (isMusePlanToolName(toolName)) {
        const steps = extractPlanSteps(input, output);
        if (steps) {
          pushPlanUpdate(ctx, events, steps);
          return events;
        }
      }
      if (isMuseAgentCardToolName(toolName)) {
        const item = buildSubagentItem(ctx.threadId, ctx.turnId, id, toolName, input, terminal ? "completed" : "inProgress", output);
        ctx.activeTools.set(id, item);
        events.push({ kind: terminal ? "item/completed" : "item/started", threadId: ctx.threadId, turnId: ctx.turnId, item });
        return events;
      }
      const item = toToolItem(ctx.threadId, ctx.turnId, id, toolName, input, terminal ? "completed" : "inProgress", output);
      ctx.activeTools.set(id, item);
      events.push({ kind: terminal ? "item/completed" : "item/started", threadId: ctx.threadId, turnId: ctx.turnId, item });
      return events;
    }
    if (text && !payloadType.startsWith("run.")) {
      // 非 run 文本兜底为 agent 文本（run.output.delta 已在上面处理）
      pushAssistantDelta(ctx, events, text);
      return events;
    }
  }

  // 6) run 终态：顺手闭合所有 open 的行（turn 事件本身由 runtime 收尾）
  if (payloadType === "run.terminal.completed" || payloadType === "run.terminal.failed" || payloadType === "run.terminal.cancelled") {
    const text = asText(payload.text);
    if (text && !ctx.assistantText) pushAssistantDelta(ctx, events, text);
    completeActiveReasoning(ctx, events);
    completeActiveAssistant(ctx, events);
    for (const [id, tool] of ctx.activeTools) {
      const st = String(tool.status ?? "");
      if (st === "inProgress" || st === "in_progress") {
        const closed = { ...tool, status: "completed" as JsonValue };
        ctx.activeTools.set(id, closed);
        events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item: closed });
      }
    }
    for (const id of ctx.pendingPlanCandidates) {
      const started = toToolItem(ctx.threadId, ctx.turnId, id, "write_todos", {}, "inProgress");
      const finished = { ...started, status: "completed" as JsonValue };
      events.push({ kind: "item/started", threadId: ctx.threadId, turnId: ctx.turnId, item: started });
      events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item: finished });
    }
    ctx.pendingPlanCandidates.clear();
    return events;
  }

  return events;
}

/** 收尾：turn 结束时关闭所有 open 行（供 runtime 在 completed/failed 时调用）。 */
export function finalizeMuseProjection(
  ctx: MuseProjectorContext,
  status: "completed" | "failed",
): MuseProjectedEvent[] {
  const events: MuseProjectedEvent[] = [];
  if (ctx.status !== "running") return events;
  ctx.status = status;
  completeActiveReasoning(ctx, events);
  completeActiveAssistant(ctx, events);
  for (const [id, tool] of ctx.activeTools) {
    const st = String(tool.status ?? "");
    if (st === "inProgress" || st === "in_progress") {
      const closed = { ...tool, status: (status === "failed" ? "failed" : "completed") as JsonValue };
      ctx.activeTools.set(id, closed);
      events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item: closed });
    }
  }
  for (const id of ctx.pendingPlanCandidates) {
    const started = toToolItem(ctx.threadId, ctx.turnId, id, "write_todos", {}, "inProgress");
    const finished = { ...started, status: (status === "failed" ? "failed" : "completed") as JsonValue };
    events.push({ kind: "item/started", threadId: ctx.threadId, turnId: ctx.turnId, item: started });
    events.push({ kind: "item/completed", threadId: ctx.threadId, turnId: ctx.turnId, item: finished });
  }
  ctx.pendingPlanCandidates.clear();
  events.push({ kind: status === "failed" ? "turn/failed" : "turn/completed", threadId: ctx.threadId, turnId: ctx.turnId });
  return events;
}

/** 投影事件 -> 前端 JSON-RPC notification（沿用现有瀑布流方法名，零前端改动）。 */
export function toMuseNotification(event: MuseProjectedEvent): JsonRpcNotification {
  const params: Record<string, JsonValue> = {};
  switch (event.kind) {
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
    case "turn/plan/updated":
      params.threadId = event.threadId;
      params.turnId = event.turnId;
      params.plan = event.plan as unknown as JsonValue;
      params.item = event.planItem as JsonValue;
      return { method: "turn/plan/updated", params };
  }
}
