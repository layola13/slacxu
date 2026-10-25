import type { JsonValue } from "@codex-ui/shared";

export interface InterruptRetryEvent {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
  willRetry: boolean;
}

export class InterruptTurnGate {
  private readonly pendingByTurn = new Map<string, Promise<void>>();

  run(threadId: string, turnId: string, task: () => Promise<void>): Promise<void> {
    const key = `${threadId}\u0000${turnId}`;
    const existing = this.pendingByTurn.get(key);
    if (existing) return existing;

    const pending = Promise.resolve().then(task);
    this.pendingByTurn.set(key, pending);
    void pending.then(
      () => this.release(key, pending),
      () => this.release(key, pending)
    );
    return pending;
  }

  private release(key: string, pending: Promise<void>): void {
    if (this.pendingByTurn.get(key) === pending) this.pendingByTurn.delete(key);
  }
}

export async function interruptTurnWithRetry(input: {
  rpc(method: string, params?: JsonValue, options?: { timeoutMs?: number | null }): Promise<JsonValue>;
  threadId: string;
  turnId: string;
  cliBackend?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  retryDelayMs?: (attempt: number) => number;
  delay?: (delayMs: number) => Promise<void>;
  onRetryEvent?: (event: InterruptRetryEvent) => void;
}): Promise<void> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  const timeoutMs = Math.max(1_000, input.timeoutMs ?? 15_000);
  const retryDelayMs = input.retryDelayMs ?? ((attempt) => Math.min(2_000, attempt * 500));
  const delay = input.delay ?? ((delayMs) => new Promise((resolve) => globalThis.setTimeout(resolve, delayMs)));
  let turnId = input.turnId;
  let correctedActiveTurn = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await input.rpc(
        "turn/interrupt",
        {
          threadId: input.threadId,
          turnId,
          ...(input.cliBackend ? { cliBackend: input.cliBackend } : {})
        },
        { timeoutMs }
      );
      return;
    } catch (error) {
      if (isAlreadyStoppedInterruptError(error)) return;
      const actualTurnId = extractActualActiveTurnId(error);
      if (actualTurnId && actualTurnId !== turnId && !correctedActiveTurn) {
        correctedActiveTurn = true;
        turnId = actualTurnId;
        attempt -= 1;
        continue;
      }
      const willRetry = attempt < maxAttempts && isRetryableInterruptError(error);
      const delayMs = willRetry ? retryDelayMs(attempt) : 0;
      input.onRetryEvent?.({ attempt, maxAttempts, delayMs, error, willRetry });
      if (!willRetry) throw error;
      await delay(delayMs);
    }
  }
}

export function isRetryableInterruptError(error: unknown): boolean {
  return /(timed out|timeout|disconnected|connection (?:closed|reset|lost)|socket (?:closed|hang up)|temporarily unavailable|\b502\b|\b503\b)/i.test(errorText(error));
}

export function isAlreadyStoppedInterruptError(error: unknown): boolean {
  return /(turn (?:is )?(?:not active|not running|already (?:completed|stopped|interrupted))|no active turn|turn not found|unknown turn|remote codex app-server (?:is not running|exited))/i.test(errorText(error));
}

/**
 * Historical transcripts can contain a running-looking turn even though the
 * Codex process no longer owns it. Steering that stale turn fails with one of
 * these messages; callers should start a fresh turn instead of surfacing the
 * transport error to the user.
 */
export function isTurnNoLongerActiveError(error: unknown): boolean {
  return isAlreadyStoppedInterruptError(error)
    || /(?:turn|run(?:ning)?)[^\n]*(?:not found|not active|not running|already (?:completed|stopped|interrupted))/i.test(errorText(error));
}

export function extractActualActiveTurnId(error: unknown): string | null {
  const match = errorText(error).match(/expected active turn id [`'"]?[0-9a-f-]{20,}[`'"]? but found [`'"]?([0-9a-f-]{20,})[`'"]?/i);
  return match?.[1] ?? null;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? "");
  return String(error ?? "");
}
