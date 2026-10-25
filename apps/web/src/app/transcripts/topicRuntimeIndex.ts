import type { WorkbenchTurn } from "../../state/codexClient";

export interface TopicRuntimeSummary {
  threadId: string;
  runningTurnId: string | null;
  running: boolean;
  latestStatus: string | null;
  turnCount: number;
  itemCount: number;
}

export function summarizeTopicRuntime(threadId: string, turns: readonly WorkbenchTurn[]): TopicRuntimeSummary {
  let runningTurnId: string | null = null;
  let latestStatus: string | null = null;
  let itemCount = 0;
  for (const turn of turns) {
    itemCount += turn.items.length;
    latestStatus = turn.status ?? latestStatus;
    if (isRunningTurnStatus(turn.status)) runningTurnId = turn.id;
  }
  return {
    threadId,
    runningTurnId,
    running: runningTurnId !== null,
    latestStatus,
    turnCount: turns.length,
    itemCount
  };
}

export function isRunningTurnStatus(status?: string): boolean {
  return ["inprogress", "pending", "pendinginit", "started", "running", "active"].includes(
    (status ?? "").replace(/[_-]+/g, "").toLowerCase()
  );
}

export function runningTurnsForThread(turns: readonly WorkbenchTurn[], threadId: string | null | undefined): WorkbenchTurn[] {
  return threadId ? turns.filter((turn) => turn.threadId === threadId && isRunningTurnStatus(turn.status)) : [];
}

export function latestActionableRunningTurn(turns: readonly WorkbenchTurn[], threadId: string | null | undefined): WorkbenchTurn | null {
  const running = runningTurnsForThread(turns, threadId);
  const latestTerminal = latestTerminalTurnStartedAt(turns, threadId);
  return [...running].reverse().find((turn) => {
    const startedAt = normalizeRuntimeTimestamp(turn.startedAt);
    return latestTerminal == null || startedAt == null || startedAt >= latestTerminal;
  }) ?? null;
}

export function staleRunningTurnsForThread(turns: readonly WorkbenchTurn[], threadId: string | null | undefined): WorkbenchTurn[] {
  const latestTerminal = latestTerminalTurnStartedAt(turns, threadId);
  return latestTerminal == null ? [] : runningTurnsForThread(turns, threadId).filter((turn) => {
    const startedAt = normalizeRuntimeTimestamp(turn.startedAt);
    return startedAt != null && startedAt < latestTerminal;
  });
}

function latestTerminalTurnStartedAt(turns: readonly WorkbenchTurn[], threadId: string | null | undefined): number | null {
  if (!threadId) return null;
  let latest: number | null = null;
  for (const turn of turns) {
    const startedAt = normalizeRuntimeTimestamp(turn.startedAt);
    if (turn.threadId !== threadId || isRunningTurnStatus(turn.status) || startedAt == null) continue;
    latest = latest == null ? startedAt : Math.max(latest, startedAt);
  }
  return latest;
}

export function normalizeRuntimeTimestamp(value?: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value >= 1_000_000_000_000 ? value : value * 1000;
}

