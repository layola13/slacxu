export type RecoveryTurnLike = {
  id: string;
  threadId: string;
  status: string;
  items: Array<{
    id: string;
    type: string;
    text?: string;
    status?: string;
    payload?: unknown;
  }>;
};

export type ForkCleanPlan = {
  forkFromTurnId: string | null;
  failedTurnIds: string[];
  resendText: string;
  reason: string;
};

const POLLUTING_ERROR_PATTERN =
  /stream connection failed|responses_retry|error sending request|didn't complete gracefully|waiting to retry|retry_delay/i;

const TERMINAL_FAILED = new Set(["failed", "error", "errored"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isPollutingErrorText(text: string | undefined): boolean {
  if (!text) return false;
  return POLLUTING_ERROR_PATTERN.test(text);
}

export function isFailedTurn(turn: RecoveryTurnLike): boolean {
  if (TERMINAL_FAILED.has(turn.status.toLowerCase())) return true;
  return turn.items.some(
    (item) =>
      (item.type === "error" || item.type === "retryError") &&
      (String(item.status ?? "").toLowerCase() === "failed" || isPollutingErrorText(item.text)),
  );
}

export function isStalledRetryingTurn(turn: RecoveryTurnLike): boolean {
  if (turn.status.toLowerCase() !== "inprogress") return false;
  return turn.items.some(
    (item) =>
      item.type === "retryError" &&
      String(item.status ?? "").toLowerCase() === "running" &&
      (isPollutingErrorText(item.text) ||
        (isRecord(item.payload) &&
          (isPollutingErrorText(String((item.payload as Record<string, unknown>).additionalDetails ?? "")) ||
            (item.payload as Record<string, unknown>).retrySource === "codex-stream"))),
  );
}

function lastUserText(turn: RecoveryTurnLike): string {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (!item) continue;
    if (item.type === "userMessage" && item.text?.trim()) return item.text.trim();
  }
  return "";
}

export function planForkCleanRecovery(
  turns: readonly RecoveryTurnLike[],
  activeTurnId?: string,
): ForkCleanPlan {
  const failedTurnIds = turns.filter((turn) => isFailedTurn(turn) || isStalledRetryingTurn(turn)).map((turn) => turn.id);
  if (failedTurnIds.length === 0) {
    return { forkFromTurnId: null, failedTurnIds, resendText: "", reason: "no-failed-turn" };
  }
  const firstFailedIndex = turns.findIndex((turn) => failedTurnIds.includes(turn.id));
  let forkFromTurnId: string | null = null;
  for (let index = firstFailedIndex - 1; index >= 0; index -= 1) {
    const candidate = turns[index];
    if (!candidate) continue;
    if (candidate.status.toLowerCase() === "completed" && !isFailedTurn(candidate)) {
      forkFromTurnId = candidate.id;
      break;
    }
  }
  const failedTurn = turns[firstFailedIndex];
  const resendText = failedTurn ? lastUserText(failedTurn) : "";
  const stalled = failedTurn ? isStalledRetryingTurn(failedTurn) : false;
  return {
    forkFromTurnId,
    failedTurnIds,
    resendText,
    reason: activeTurnId && failedTurnIds.includes(activeTurnId) ? "active-turn-polluted" : stalled ? "stream-retry-stalled" : "failed-turn-polluted",
  };
}

export function shouldExcludeItemFromResend(itemType: string, text?: string): boolean {
  if (itemType === "error" || itemType === "retryError" || itemType === "retryErrorGroup") return true;
  return isPollutingErrorText(text);
}
