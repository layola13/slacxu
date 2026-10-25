export const GOAL_CONTINUATION_MARKER = "[[codex-ultra:goal-continuation]]";

export type TurnStartedWaiter = {
  waitFor: (expectedTurnId?: string | null) => Promise<string>;
  dispose: () => void;
};

type ServerMessageDetail = {
  type?: unknown;
  message?: {
    method?: unknown;
    params?: unknown;
  };
};

export function buildGoalContinuationPrompt(objective: string): string {
  return `${GOAL_CONTINUATION_MARKER}\nContinue working toward this persisted /goal objective:\n\n${objective.trim()}`;
}

export function isGoalContinuationPrompt(value: string): boolean {
  return value.trimStart().startsWith(GOAL_CONTINUATION_MARKER);
}

export function observeTurnStarted(
  source: EventTarget,
  threadId: string,
  timeoutMs = 15_000
): TurnStartedWaiter {
  const observedTurnIds: string[] = [];
  let expectedTurnId: string | null | undefined;
  let resolvePending: ((turnId: string) => void) | null = null;
  let rejectPending: ((error: Error) => void) | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const matchingTurnId = (): string | null => {
    if (expectedTurnId === undefined) return null;
    if (expectedTurnId) {
      return observedTurnIds.includes(expectedTurnId) ? expectedTurnId : null;
    }
    return observedTurnIds[0] ?? null;
  };

  const cleanup = () => {
    source.removeEventListener("server-message", onMessage);
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  const settleIfMatched = () => {
    const turnId = matchingTurnId();
    if (!turnId || !resolvePending) return;
    const resolve = resolvePending;
    resolvePending = null;
    rejectPending = null;
    cleanup();
    resolve(turnId);
  };

  const onMessage = (event: Event) => {
    const detail = (event as CustomEvent<ServerMessageDetail>).detail;
    if (detail?.type !== "codex.notification" || detail.message?.method !== "turn/started") return;
    const params = asRecord(detail.message.params);
    const turn = asRecord(params.turn);
    if (params.threadId !== threadId || typeof turn.id !== "string") return;
    observedTurnIds.push(turn.id);
    settleIfMatched();
  };

  source.addEventListener("server-message", onMessage);

  return {
    waitFor(nextExpectedTurnId) {
      if (disposed) {
        return Promise.reject(new Error("Turn-start observer was disposed"));
      }
      expectedTurnId = nextExpectedTurnId ?? null;
      const observed = matchingTurnId();
      if (observed) {
        cleanup();
        return Promise.resolve(observed);
      }
      return new Promise<string>((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
        timeout = setTimeout(() => {
          resolvePending = null;
          rejectPending = null;
          cleanup();
          reject(new Error(`Timed out waiting for turn/started on thread '${threadId}'`));
        }, timeoutMs);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanup();
      if (rejectPending) {
        const reject = rejectPending;
        resolvePending = null;
        rejectPending = null;
        reject(new Error("Turn-start observer was disposed"));
      }
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
