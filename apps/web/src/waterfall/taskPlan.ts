import type { WorkbenchTurn } from "../state/codexClient";
import { orderWorkbenchItems, orderWorkbenchTurns } from "../state/workbenchTimeline";

export type TaskPlanStepStatus = "pending" | "inProgress" | "completed";

export type TaskPlanStep = {
  id: string;
  text: string;
  status: TaskPlanStepStatus;
};

export type TaskPlan = {
  sourceKey: string;
  explanation?: string;
  steps: TaskPlanStep[];
};

export function latestTaskPlan(turns: WorkbenchTurn[], threadId: string | null): TaskPlan | null {
  if (!threadId) {
    return null;
  }

  const orderedTurns = orderWorkbenchTurns(turns.filter((turn) => turn.threadId === threadId));
  for (let turnIndex = orderedTurns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = orderedTurns[turnIndex];
    if (!turn) continue;
    const items = orderWorkbenchItems(turn.items);
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex];
      if (!item || item.type !== "plan") continue;
      const payload = isRecord(item.payload) ? item.payload : null;
      const rawPlan = payload && Array.isArray(payload.plan) ? payload.plan : null;
      if (!rawPlan) continue;
      const steps = rawPlan
        .map((entry, stepIndex) => {
          const record = isRecord(entry) ? entry : null;
          const text = record ? stringValue(record.step) ?? stringValue(record.text) : undefined;
          return text
            ? { id: `${item.id}:${stepIndex}`, text, status: normalizeTaskPlanStatus(record?.status) } satisfies TaskPlanStep
            : null;
        })
        .filter((step): step is TaskPlanStep => Boolean(step));
      if (steps.length > 0) {
        return {
          sourceKey: `${threadId}:${turn.id}:${item.id}`,
          explanation: stringValue(payload?.explanation),
          steps
        };
      }
    }
  }
  return null;
}

function normalizeTaskPlanStatus(value: unknown): TaskPlanStepStatus {
  const normalized = typeof value === "string" ? value.replace(/[_-]+/g, "").toLowerCase() : "";
  if (normalized === "completed" || normalized === "complete" || normalized === "done") {
    return "completed";
  }
  if (normalized === "inprogress" || normalized === "running" || normalized === "started") {
    return "inProgress";
  }
  return "pending";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
