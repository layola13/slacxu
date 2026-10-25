import type { JsonRpcNotification } from "@codex-ui/shared";

export type TaskNotificationEvent =
  | { type: "turnCompleted"; key: string; threadId: string; turnId: string }
  | { type: "planStepsCompleted"; key: string; threadId: string; turnId: string; steps: string[] }
  | { type: "remoteError"; key: string; threadId?: string; turnId?: string; status?: number; message: string; willRetry: boolean };

export type TaskNotificationTracker = {
  seen: Set<string>;
  completedPlanSteps: Map<string, Set<string>>;
};

export type TaskNotificationPreferences = {
  turnCompleted: boolean;
  planStepsCompleted: boolean;
  remoteErrors: boolean;
};

export const DEFAULT_TASK_NOTIFICATION_PREFERENCES: TaskNotificationPreferences = {
  turnCompleted: true,
  planStepsCompleted: true,
  remoteErrors: true
};

export function readTaskNotificationPreferences(
  storage: Pick<Storage, "getItem">,
  key: string
): TaskNotificationPreferences {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "{}");
    const record = asRecord(value);
    return {
      turnCompleted: typeof record.turnCompleted === "boolean" ? record.turnCompleted : true,
      planStepsCompleted: typeof record.planStepsCompleted === "boolean" ? record.planStepsCompleted : true,
      remoteErrors: typeof record.remoteErrors === "boolean" ? record.remoteErrors : true
    };
  } catch {
    return { ...DEFAULT_TASK_NOTIFICATION_PREFERENCES };
  }
}

export function createTaskNotificationTracker(): TaskNotificationTracker {
  return { seen: new Set(), completedPlanSteps: new Map() };
}

export function collectTaskNotificationEvents(
  notification: JsonRpcNotification,
  tracker: TaskNotificationTracker
): TaskNotificationEvent[] {
  const params = asRecord(notification.params);
  const turn = asRecord(params.turn);
  const threadId = stringValue(params.threadId) ?? stringValue(turn.threadId);
  const turnId = stringValue(params.turnId) ?? stringValue(turn.id);
  if (notification.method === "error") {
    const error = asRecord(params.error);
    const message = stringValue(error.message)
      ?? stringValue(error.additionalDetails)
      ?? stringValue(error.additional_details)
      ?? "Remote request failed";
    const status = httpStatusFromError(error, message);
    const key = `error:${threadId ?? "unknown"}:${turnId ?? "unknown"}:${status ?? "unknown"}:${message}`;
    return markFirst(tracker, key)
      ? [{
          type: "remoteError",
          key,
          ...(threadId ? { threadId } : {}),
          ...(turnId ? { turnId } : {}),
          ...(status ? { status } : {}),
          message: message.slice(0, 360),
          willRetry: params.willRetry === true
        }]
      : [];
  }
  if (!threadId || !turnId) return [];

  if (notification.method === "turn/completed") {
    tracker.completedPlanSteps.delete(`${threadId}:${turnId}`);
    const key = `turn:${turnId}:completed`;
    return markFirst(tracker, key) ? [{ type: "turnCompleted", key, threadId, turnId }] : [];
  }

  if (notification.method !== "turn/plan/updated" || !Array.isArray(params.plan)) return [];
  const planKey = `${threadId}:${turnId}`;
  const previous = tracker.completedPlanSteps.get(planKey) ?? new Set<string>();
  const current = new Set<string>();
  const newlyCompleted: string[] = [];
  for (const [index, rawStep] of params.plan.entries()) {
    const step = asRecord(rawStep);
    if (!isCompletedStatus(step.status)) continue;
    const text = stringValue(step.step) ?? stringValue(step.text) ?? `Step ${index + 1}`;
    const stepKey = `${index}:${text}`;
    current.add(stepKey);
    const eventKey = `plan:${planKey}:${stepKey}`;
    if (!previous.has(stepKey) && markFirst(tracker, eventKey)) newlyCompleted.push(text);
  }
  tracker.completedPlanSteps.set(planKey, current);
  if (newlyCompleted.length === 0) return [];
  const key = `plan:${planKey}:${newlyCompleted.join("|")}`;
  return [{ type: "planStepsCompleted", key, threadId, turnId, steps: newlyCompleted }];
}

function httpStatusFromError(error: Record<string, unknown>, message: string): number | undefined {
  const direct = Number(error.httpStatusCode ?? error.http_status_code ?? error.status);
  if (Number.isInteger(direct) && direct >= 400 && direct <= 599) return direct;
  const codexInfo = asRecord(error.codexErrorInfo ?? error.codex_error_info);
  const directCodexStatus = Number(codexInfo.httpStatusCode ?? codexInfo.http_status_code);
  if (Number.isInteger(directCodexStatus) && directCodexStatus >= 400 && directCodexStatus <= 599) return directCodexStatus;
  for (const value of Object.values(codexInfo)) {
    const record = asRecord(value);
    const nested = Number(record.httpStatusCode ?? record.http_status_code);
    if (Number.isInteger(nested) && nested >= 400 && nested <= 599) return nested;
  }
  const match = /(?:status(?: code)?\D*)?\b([45][0-9]{2})\b/i.exec(message);
  return match ? Number(match[1]) : undefined;
}

function markFirst(tracker: TaskNotificationTracker, key: string): boolean {
  if (tracker.seen.has(key)) return false;
  tracker.seen.add(key);
  if (tracker.seen.size > 2048) {
    const oldest = tracker.seen.values().next().value;
    if (typeof oldest === "string") tracker.seen.delete(oldest);
  }
  return true;
}

function isCompletedStatus(value: unknown): boolean {
  const normalized = typeof value === "string" ? value.replace(/[_-]+/g, "").toLowerCase() : "";
  return normalized === "completed" || normalized === "complete" || normalized === "done";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
