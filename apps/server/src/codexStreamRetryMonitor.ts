export type CodexRetryParsedLine =
  | { kind: "stream-retry"; turnId: string; errorText: string; retryDelayText?: string }
  | { kind: "graceful-timeout"; taskId: string }
  | { kind: "ignored" };

export type CodexRetryStormEvent = {
  turnId: string;
  attempt: number;
  stalled: boolean;
  elapsedMs: number;
  lastError: string;
  retryDelayText?: string;
  message: string;
};

export type CodexRetryTerminalEvent = {
  taskId: string;
  turnId?: string;
  message: string;
};

const STREAM_RETRY_PATTERN =
  /codex_core::responses_retry:\s*stream connection failed;\s*waiting to retry\s+turn_id=(\S+)\s+error=(.+?)(?:\s+retry_delay=(\S+))?\s*$/;

const GRACEFUL_TIMEOUT_PATTERN =
  /codex_core::tasks:\s*task\s+(\S+)\s+didn't complete gracefully/i;

const BENIGN_PATTERNS: RegExp[] = [
  /codex_skills::interface/,
  /codex_core_plugins::manifest/,
  /remote installed plugin bundle sync failed/,
  /shell_snapshot/,
  /shell snapshot not supported/i,
  /Unknown model .* fallback model metadata/i,
  /\[virtual-config\]/,
  /maximum of 3 prompts is supported/,
  /prompt must be at most 128 characters/,
  /icon path with '\.\.' must resolve under plugin assets/,
  /api key auth is not supported/,
];

import { STORM_STALLED_AFTER_ATTEMPTS, STORM_STALLED_AFTER_MS } from "@cxu/sdk-backend";
export { STORM_STALLED_AFTER_ATTEMPTS, STORM_STALLED_AFTER_MS };

export function parseCodexStderrLine(line: string): CodexRetryParsedLine {
  const text = line.trim();
  if (!text) return { kind: "ignored" };
  const retry = STREAM_RETRY_PATTERN.exec(text);
  if (retry) {
    return {
      kind: "stream-retry",
      turnId: retry[1] ?? "",
      errorText: (retry[2] ?? "stream connection failed").trim(),
      retryDelayText: retry[3]?.trim() || undefined,
    };
  }
  const timeout = GRACEFUL_TIMEOUT_PATTERN.exec(text);
  if (timeout) {
    return { kind: "graceful-timeout", taskId: timeout[1] ?? "" };
  }
  return { kind: "ignored" };
}

export function isBenignCodexStderr(line: string): boolean {
  return BENIGN_PATTERNS.some((pattern) => pattern.test(line));
}

type TurnRetryState = {
  attempt: number;
  firstAt: number;
  lastAt: number;
  lastError: string;
  retryDelayText?: string;
  stormNotified: boolean;
  stalledNotified: boolean;
};

export class CodexStreamRetryTracker {
  private readonly turns = new Map<string, TurnRetryState>();

  public ingest(line: string, now = Date.now()): CodexRetryStormEvent | null {
    const parsed = parseCodexStderrLine(line);
    if (parsed.kind !== "stream-retry" || !parsed.turnId) return null;
    const existing = this.turns.get(parsed.turnId);
    const next: TurnRetryState = existing
      ? {
          attempt: existing.attempt + 1,
          firstAt: existing.firstAt,
          lastAt: now,
          lastError: parsed.errorText,
          retryDelayText: parsed.retryDelayText ?? existing.retryDelayText,
          stormNotified: existing.stormNotified,
          stalledNotified: existing.stalledNotified,
        }
      : {
          attempt: 1,
          firstAt: now,
          lastAt: now,
          lastError: parsed.errorText,
          retryDelayText: parsed.retryDelayText,
          stormNotified: false,
          stalledNotified: false,
        };
    this.turns.set(parsed.turnId, next);
    const elapsedMs = next.lastAt - next.firstAt;
    const stalled =
      next.attempt >= STORM_STALLED_AFTER_ATTEMPTS || elapsedMs >= STORM_STALLED_AFTER_MS;
    if (next.attempt < 2 && !stalled) return null;
    if (stalled && next.stalledNotified) return null;
    if (!stalled && next.stormNotified) return null;
    if (stalled) next.stalledNotified = true;
    else next.stormNotified = true;
    return {
      turnId: parsed.turnId,
      attempt: next.attempt,
      stalled,
      elapsedMs,
      lastError: next.lastError,
      retryDelayText: next.retryDelayText,
      message: stalled
        ? `Upstream stream disconnected, retrying ${next.attempt}x (${Math.round(elapsedMs / 1000)}s). You can Interrupt and fork-clean instead of waiting 60s per retry.`
        : `Upstream stream disconnected, Codex retrying (${next.attempt}x).`,
    };
  }

  public terminalTask(taskId: string): CodexRetryTerminalEvent | null {
    if (!taskId) return null;
    let turnId: string | undefined;
    for (const [candidate, state] of this.turns) {
      void state;
      if (candidate === taskId) {
        turnId = candidate;
        break;
      }
    }
    return {
      taskId,
      turnId,
      message: "Codex turn did not complete gracefully after repeated stream retries.",
    };
  }

  public markTurnTerminal(turnId: string): void {
    this.turns.delete(turnId);
  }

  public attemptCount(turnId: string): number {
    return this.turns.get(turnId)?.attempt ?? 0;
  }
}
