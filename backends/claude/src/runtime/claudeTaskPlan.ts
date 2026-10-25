import type { JsonValue } from "@codex-ui/shared";

/**
 * Projects the Claude CLI's task list onto the same shape Codex emits for
 * `turn/plan/updated`, so the chat waterfall and the floating task panel render
 * a Claude plan exactly like a Codex plan instead of leaving raw tool rows.
 *
 * Two CLI generations are covered:
 * - `TodoWrite` replaces the whole list in one call (`{ todos: [...] }`).
 * - `TaskCreate` / `TaskUpdate` mutate it one entry at a time. `TaskCreate`
 *   only learns its `#N` identity from the tool result, so the step is keyed by
 *   tool-use id until `bindClaudeTaskPlanResult` binds the id `TaskUpdate` uses.
 */

export type ClaudeTaskPlanStatus = "pending" | "in_progress" | "completed";

export type ClaudeTaskPlanStep = {
  /** Tool-use id of the `TaskCreate` that introduced the step, or the todo index. */
  key: string;
  /** The `#N` id later `TaskUpdate` calls address the step by, once known. */
  taskId?: string;
  step: string;
  status: ClaudeTaskPlanStatus;
};

export type ClaudeTaskPlanState = {
  steps: ClaudeTaskPlanStep[];
};

/**
 * Tool calls whose only effect is to mutate the task list. They are projected
 * as the plan itself, so emitting their tool rows as well would show the same
 * information twice — once as a checklist and once as raw JSON.
 */
const PLAN_TOOL_NAMES = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"]);

export function isClaudeTaskPlanTool(toolName: string): boolean {
  return PLAN_TOOL_NAMES.has(toolName);
}

export function createClaudeTaskPlanState(): ClaudeTaskPlanState {
  return { steps: [] };
}

/**
 * Fold one plan tool call into `state`. Returns false when the call carried
 * nothing projectable, which tells the caller to fall back to a plain tool row
 * rather than silently swallowing it.
 */
export function applyClaudeTaskPlanTool(
  state: ClaudeTaskPlanState,
  toolUseId: string,
  toolName: string,
  input: JsonValue | undefined,
): boolean {
  const args = asRecord(input);
  if (toolName === "TodoWrite") return applyTodoWrite(state, args);
  if (toolName === "TaskCreate") return applyTaskCreate(state, toolUseId, args);
  if (toolName === "TaskUpdate") return applyTaskUpdate(state, args);
  return false;
}

function applyTodoWrite(state: ClaudeTaskPlanState, args: Record<string, JsonValue>): boolean {
  const todos = Array.isArray(args.todos) ? args.todos : Array.isArray(args.tasks) ? args.tasks : null;
  if (!todos) return false;
  const steps: ClaudeTaskPlanStep[] = [];
  for (const [index, entry] of todos.entries()) {
    const todo = asRecord(entry);
    const step = stringValue(todo.content) ?? stringValue(todo.subject) ?? stringValue(todo.step);
    if (!step) continue;
    steps.push({
      key: stringValue(todo.id) ?? "todo-" + index,
      ...(stringValue(todo.id) ? { taskId: stringValue(todo.id) } : {}),
      step,
      status: normalizeStatus(todo.status),
    });
  }
  if (steps.length === 0) return false;
  state.steps = steps;
  return true;
}

function applyTaskCreate(
  state: ClaudeTaskPlanState,
  toolUseId: string,
  args: Record<string, JsonValue>,
): boolean {
  const step = stringValue(args.subject) ?? stringValue(args.content) ?? stringValue(args.description);
  if (!step) return false;
  const existing = state.steps.find((entry) => entry.key === toolUseId);
  if (existing) {
    existing.step = step;
    return true;
  }
  state.steps.push({ key: toolUseId, step, status: "pending" });
  return true;
}

function applyTaskUpdate(state: ClaudeTaskPlanState, args: Record<string, JsonValue>): boolean {
  const taskId = stringValue(args.taskId) ?? stringValue(args.id);
  if (!taskId) return false;
  const index = state.steps.findIndex((entry) => entry.taskId === taskId || entry.key === taskId);
  if (index < 0) return false;
  const rawStatus = stringValue(args.status);
  if (rawStatus === "deleted") {
    state.steps.splice(index, 1);
    return true;
  }
  const target = state.steps[index]!;
  const subject = stringValue(args.subject);
  if (subject) target.step = subject;
  if (rawStatus) target.status = normalizeStatus(rawStatus);
  return Boolean(rawStatus || subject);
}

/**
 * Bind the `#N` id the CLI reports back for a `TaskCreate`, so later
 * `TaskUpdate` calls — which only carry that id — find the right step.
 */
export function bindClaudeTaskPlanResult(
  state: ClaudeTaskPlanState,
  toolUseId: string,
  resultText: string,
): boolean {
  const taskId = resultText.match(/Task\s+#(\d+)/i)?.[1];
  if (!taskId) return false;
  const target = state.steps.find((entry) => entry.key === toolUseId);
  if (!target || target.taskId === taskId) return false;
  target.taskId = taskId;
  return true;
}

/**
 * Rebuild plan state from a persisted item, so a thread reopened from history
 * keeps updating the same checklist instead of starting a new one-step plan.
 */
export function claudeTaskPlanStateFromItem(item: JsonValue | undefined): ClaudeTaskPlanState | null {
  const record = asRecord(item);
  if (record.type !== "plan" || !Array.isArray(record.plan)) return null;
  const steps: ClaudeTaskPlanStep[] = [];
  for (const [index, entry] of record.plan.entries()) {
    const raw = asRecord(entry);
    const step = stringValue(raw.step);
    if (!step) continue;
    const taskId = stringValue(raw.taskId);
    steps.push({
      key: stringValue(raw.key) ?? "plan-" + index,
      ...(taskId ? { taskId } : {}),
      step,
      status: normalizeStatus(raw.status),
    });
  }
  return steps.length > 0 ? { steps } : null;
}

/**
 * The `plan` item to emit for the current list. Mirrors the payload Codex sends
 * with `turn/plan/updated`: `plan[]` drives the task panel, `text` renders the
 * checklist in the waterfall row.
 */
export function buildClaudeTaskPlanItem(
  state: ClaudeTaskPlanState,
  context: { threadId: string; turnId: string },
): Record<string, JsonValue> | null {
  if (state.steps.length === 0) return null;
  return {
    type: "plan",
    id: "claude-plan-" + context.turnId,
    turnId: context.turnId,
    threadId: context.threadId,
    plan: state.steps.map((entry) => ({
      step: entry.step,
      status: entry.status,
      key: entry.key,
      ...(entry.taskId ? { taskId: entry.taskId } : {}),
    })),
    text: formatClaudeTaskPlanText(state),
    status: claudeTaskPlanStatus(state),
  };
}

export function formatClaudeTaskPlanText(state: ClaudeTaskPlanState): string {
  return state.steps
    .map((entry) => {
      if (entry.status === "completed") return "- [x] " + entry.step;
      if (entry.status === "in_progress") return "- [ ] " + entry.step + " _(in progress)_";
      return "- [ ] " + entry.step;
    })
    .join("\n");
}

function claudeTaskPlanStatus(state: ClaudeTaskPlanState): string {
  if (state.steps.some((entry) => entry.status === "in_progress")) return "inProgress";
  if (state.steps.every((entry) => entry.status === "completed")) return "completed";
  return "pending";
}

function normalizeStatus(value: JsonValue | undefined): ClaudeTaskPlanStatus {
  const normalized = typeof value === "string" ? value.replace(/[_-]+/g, "").toLowerCase() : "";
  if (normalized === "completed" || normalized === "complete" || normalized === "done") return "completed";
  if (normalized === "inprogress" || normalized === "running" || normalized === "started") return "in_progress";
  return "pending";
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {};
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
