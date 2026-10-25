export type TurnRetryState = {
  threadId: string;
  turnId: string;
  message: string;
  details?: string;
  updatedAt: number;
};

export function resolveTurnRetryState(
  current: TurnRetryState | null,
  next: TurnRetryState | null | ((current: TurnRetryState | null) => TurnRetryState | null)
): TurnRetryState | null {
  const resolved = typeof next === "function" ? next(current) : next;
  if (current === resolved) return current;
  if (!current || !resolved) return resolved;
  if (
    current.threadId === resolved.threadId &&
    current.turnId === resolved.turnId &&
    current.message === resolved.message &&
    current.details === resolved.details
  ) {
    return current;
  }
  return resolved;
}
