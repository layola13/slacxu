import type { JsonValue } from "@codex-ui/shared";

type ThreadStartRequest = (method: string, params?: JsonValue) => Promise<JsonValue>;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
      if (value && typeof value === "object") {
        const nested = errorText(value);
        if (nested && nested !== "[object Object]") return nested;
      }
    }
  }
  return String(error);
}

export function isPaginatedThreadHistoryUnsupported(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  const namesPaginatedHistory = message.includes("paginated_threads")
    || message.includes("paginated threads")
    || message.includes("paginated history")
    || message.includes("historymode")
    || message.includes("history_mode");
  const explicitlyUnsupported = message.includes("not supported")
    || message.includes("unsupported")
    || message.includes("unknown field")
    || message.includes("unknown variant")
    || message.includes("invalid value");
  return namesPaginatedHistory && explicitlyUnsupported;
}

export async function requestWithThreadStartHistoryFallback(input: {
  method: string;
  params?: JsonValue;
  request: ThreadStartRequest;
}): Promise<JsonValue> {
  try {
    return await input.request(input.method, input.params);
  } catch (error) {
    if (input.method !== "thread/start" || !isPaginatedThreadHistoryUnsupported(error)) {
      throw error;
    }
    const params = input.params && typeof input.params === "object" && !Array.isArray(input.params)
      ? input.params as Record<string, JsonValue>
      : null;
    if (params?.historyMode !== "paginated") throw error;
    const { historyMode: _historyMode, ...legacyParams } = params;
    return input.request(input.method, legacyParams);
  }
}

export function isAgentLoopDiedBeforeTurnStart(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return message.includes("failed to start turn")
    && message.includes("agent loop died unexpectedly");
}

export function isThreadMissingBeforeTurnStart(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return message.includes("thread not found")
    || message.includes("thread_not_found")
    || message.includes("unknown thread");
}

export async function requestWithLocalAgentLoopRecovery(input: {
  method: string;
  params?: JsonValue;
  local: boolean;
  request: ThreadStartRequest;
  resumeParams?: JsonValue;
  onResumed?: (threadId: string) => void;
}): Promise<JsonValue> {
  try {
    return await input.request(input.method, input.params);
  } catch (error) {
    const params = input.params && typeof input.params === "object" && !Array.isArray(input.params)
      ? input.params as Record<string, JsonValue>
      : null;
    const threadId = typeof params?.threadId === "string" ? params.threadId.trim() : "";
    if (
      !input.local
      || input.method !== "turn/start"
      || !threadId
      || (!isAgentLoopDiedBeforeTurnStart(error) && !isThreadMissingBeforeTurnStart(error))
    ) {
      throw error;
    }
    const resumeParams = input.resumeParams && typeof input.resumeParams === "object" && !Array.isArray(input.resumeParams)
      ? { ...(input.resumeParams as Record<string, JsonValue>), threadId }
      : { threadId };
    await input.request("thread/resume", resumeParams);
    input.onResumed?.(threadId);
    return input.request(input.method, input.params);
  }
}
