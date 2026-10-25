import type { JsonRpcNotification, JsonValue } from "@codex-ui/shared";
import type { WorkbenchItem, WorkbenchTurn } from "../../state/codexClient";

const APP_RUNTIME_METHODS = new Set([
  "thread/started",
  "thread/name/updated",
  "thread/archived",
  "thread/deleted",
  "thread/unarchived",
  // Claude CLI 启动分阶段状态（composer 状态栏展示，不进 transcript）。
  "thread/claude/startup",
  "turn/started",
  "turn/completed",
  "turn/failed",
  "turn/interrupted",
  "turn/plan/updated",
  "error"
]);

/**
 * App only needs turn lifecycle plus compact plan/user-message evidence. Full
 * transcript bodies, command output, files, images and tool payloads belong to
 * TopicTranscriptStore.
 */
export function projectRuntimeTurns(turns: readonly WorkbenchTurn[]): WorkbenchTurn[] {
  return turns.map(projectRuntimeTurn);
}

export function projectRuntimeTurn(turn: WorkbenchTurn): WorkbenchTurn {
  return {
    id: turn.id,
    threadId: turn.threadId,
    status: turn.status,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    items: turn.items.flatMap((item) => {
      const projected = projectRuntimeItem(item);
      return projected ? [projected] : [];
    })
  };
}

export function projectRuntimeNotifications(
  notifications: readonly JsonRpcNotification[],
  context: {
    activeThreadId?: string | null;
    threadIdByTurnId?: ReadonlyMap<string, string>;
    inProgressTurnIds?: ReadonlySet<string>;
  } = {}
): JsonRpcNotification[] {
  const inProgressTurnIds = new Set(context.inProgressTurnIds);
  return notifications.flatMap((notification) => {
    const projected = projectRuntimeNotification(notification, {
      ...context,
      inProgressTurnIds
    });
    if (projected?.method === "turn/started") {
      const turn = record(record(projected.params).turn);
      const id = text(turn.id) ?? notificationTurnId(record(projected.params));
      if (id) inProgressTurnIds.add(id);
    }
    return projected ? [projected] : [];
  });
}

export function projectRuntimeNotification(
  notification: JsonRpcNotification,
  context: {
    activeThreadId?: string | null;
    threadIdByTurnId?: ReadonlyMap<string, string>;
    inProgressTurnIds?: ReadonlySet<string>;
  } = {}
): JsonRpcNotification | null {
  if (APP_RUNTIME_METHODS.has(notification.method)) return projectRuntimeLifecycleNotification(notification, context);
  // Transcript activity is scheduled independently from the App runtime
  // reducer. If the history snapshot still contains a completed turn, the
  // first streamed delta must nevertheless reactivate the lightweight turn
  // index immediately; otherwise the waterfall can show Thinking while the
  // header remains "completed" until a later lifecycle notification arrives.
  if (isTurnActivityNotification(notification)
    && !(notification.method === "item/started" && isRuntimeStructuralItemNotification(notification))) {
    const params = record(notification.params);
    const turnId = notificationTurnId(params);
    const threadId = notificationThreadId(params)
      ?? (turnId ? context.threadIdByTurnId?.get(turnId) : undefined)
      ?? context.activeThreadId;
    if (turnId && threadId && !context.inProgressTurnIds?.has(turnId)) {
      return {
        method: "turn/started",
        params: {
          threadId,
          runtimeActivityReactivation: true,
          turn: { id: turnId, threadId, status: "inProgress" }
        } as JsonValue
      };
    }
    return null;
  }
  if (notification.method !== "item/started" && notification.method !== "item/completed") return null;
  const params = record(notification.params);
  const item = record(params.item);
  const type = runtimeItemType(item);
  if (type !== "userMessage" && type !== "plan"
    && type !== "enteredReviewMode" && type !== "exitedReviewMode") return null;
  if (type === "enteredReviewMode" || type === "exitedReviewMode") {
    // Zero-body lifecycle markers the send flow needs to detect an active
    // inline review. Keep payload in TopicTranscriptStore; App state is a
    // light runtime index.
    return {
      ...notification,
      params: {
        ...params,
        ...(notificationThreadId(params) ? { threadId: notificationThreadId(params) } : {}),
        ...(notificationTurnId(params) ? { turnId: notificationTurnId(params) } : {}),
        item: { id: text(item.id) ?? "", type, text: runtimeItemText(item), status: text(item.status) } as JsonValue
      }
    };
  }
  return {
    ...notification,
    params: {
      ...params,
      ...(notificationThreadId(params) ? { threadId: notificationThreadId(params) } : {}),
      ...(notificationTurnId(params) ? { turnId: notificationTurnId(params) } : {}),
      item: projectNotificationItem(item, type)
    } as JsonValue
  };
}

function isTurnActivityNotification(notification: JsonRpcNotification): boolean {
  return notification.method === "item/started"
    || notification.method === "item/agentMessage/delta"
    || notification.method === "item/reasoning/summaryPartAdded"
    || notification.method === "item/reasoning/summaryTextDelta"
    || notification.method === "item/reasoning/textDelta"
    || notification.method === "item/plan/delta"
    || notification.method === "item/commandExecution/outputDelta";
}

function isRuntimeStructuralItemNotification(notification: JsonRpcNotification): boolean {
  const item = record(record(notification.params).item);
  const type = runtimeItemType(item);
  return type === "userMessage" || type === "plan"
    || type === "enteredReviewMode" || type === "exitedReviewMode";
}

function notificationTurnId(params: Record<string, unknown>): string | undefined {
  return text(params.turnId)
    ?? text(params.turn_id)
    ?? text(record(params.turn).id)
    ?? text(record(params.item).turnId)
    ?? text(record(params.item).turn_id)
    ?? undefined;
}

function notificationThreadId(params: Record<string, unknown>): string | undefined {
  return text(params.threadId)
    ?? text(params.thread_id)
    ?? text(record(params.turn).threadId)
    ?? text(record(params.turn).thread_id)
    ?? text(record(params.item).threadId)
    ?? text(record(params.item).thread_id)
    ?? undefined;
}

function projectRuntimeLifecycleNotification(
  notification: JsonRpcNotification,
  context: { activeThreadId?: string | null; threadIdByTurnId?: ReadonlyMap<string, string> } = {}
): JsonRpcNotification {
  const params = record(notification.params);
  if (notification.method === "thread/started") {
    const thread = record(params.thread);
    return {
      ...notification,
      params: {
        thread: pick(thread, [
          "id", "sessionId", "session_id", "name", "title", "threadName", "thread_name",
          "preview", "model", "modelProvider", "model_provider", "parentThreadId", "parent_thread_id",
          "forkedFromId", "forked_from_id", "agentNickname", "agent_nickname", "agentRole", "agent_role",
          "createdAt", "created_at", "updatedAt", "updated_at", "recencyAt", "recency_at", "status",
          "cwd", "source", "threadSource", "thread_source", "path", "file_path"
        ])
      } as JsonValue
    };
  }
  if (notification.method === "turn/started" || notification.method === "turn/completed"
    || notification.method === "turn/failed" || notification.method === "turn/interrupted") {
    const turn = record(params.turn);
    const turnId = text(params.turnId) ?? text(params.turn_id) ?? text(turn.id);
    const threadId = notificationThreadId(params)
      ?? (turnId ? context.threadIdByTurnId?.get(turnId) : undefined)
      ?? context.activeThreadId;
    return {
      ...notification,
      params: {
        threadId: threadId as JsonValue,
        turnId: turnId as JsonValue,
        turn: { ...pick(turn, ["id", "threadId", "thread_id", "status", "startedAt", "completedAt"]), ...(threadId ? { threadId } : {}) }
      } as JsonValue
    };
  }
  if (notification.method === "turn/plan/updated") {
    return {
      ...notification,
      params: {
        threadId: params.threadId as JsonValue,
        turnId: params.turnId as JsonValue,
        ...projectPlanFields(params)
      } as JsonValue
    };
  }
  return notification;
}

function projectRuntimeItem(item: WorkbenchItem): WorkbenchItem | null {
  if (item.type !== "userMessage" && item.type !== "plan"
    && item.type !== "enteredReviewMode" && item.type !== "exitedReviewMode") {
    return null;
  }
  if (item.type === "enteredReviewMode" || item.type === "exitedReviewMode") {
    // Zero-body structural lifecycle marker for inline-review detection.
    return { id: item.id, type: item.type, title: item.title, text: item.text, status: item.status };
  }
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    text: item.text,
    status: item.status,
    firstTokenAt: item.firstTokenAt,
    ...(item.type === "plan" ? { payload: projectPlanPayload(item.payload) } : {})
  };
}

function projectNotificationItem(item: Record<string, unknown>, type: "userMessage" | "plan"): JsonValue {
  return {
    id: text(item.id) ?? "",
    type,
    text: runtimeItemText(item),
    status: text(item.status),
    ...(type === "plan" ? projectPlanFields(item) : {})
  } as JsonValue;
}

function runtimeItemText(item: Record<string, unknown>): string {
  const direct = text(item.text) ?? text(item.content);
  if (direct) return direct;
  if (!Array.isArray(item.content)) return "";
  return item.content.flatMap((entry) => {
    const part = record(entry);
    const partType = text(part.type) ?? "";
    if (partType === "reasoning" || partType === "reasoning_text" || partType === "thinking") return [];
    const value = text(part.text) ?? text(part.input_text) ?? text(part.output_text);
    return value ? [value] : [];
  }).join("\n");
}

function projectPlanPayload(payload: JsonValue | undefined): JsonValue | undefined {
  const source = record(payload);
  const fields = projectPlanFields(source);
  return Object.keys(fields).length > 0 ? fields as JsonValue : undefined;
}

function projectPlanFields(source: Record<string, unknown>): Record<string, JsonValue> {
  const projected: Record<string, JsonValue> = {};
  if (Array.isArray(source.plan)) {
    projected.plan = source.plan.flatMap((entry) => {
      const step = record(entry);
      const label = text(step.step) ?? text(step.text);
      if (!label) return [];
      return [{ step: label, status: text(step.status) ?? "pending" } as JsonValue];
    });
  }
  const explanation = text(source.explanation);
  if (explanation) projected.explanation = explanation;
  return projected;
}

function runtimeItemType(item: Record<string, unknown>): string {
  const raw = text(item.type) ?? "";
  if (raw === "message") return text(item.role) === "user" ? "userMessage" : "agentMessage";
  if (raw === "user_message" || raw === "user-message") return "userMessage";
  return raw;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) result[key] = value as JsonValue;
  }
  return result;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
