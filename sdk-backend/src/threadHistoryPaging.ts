type HistoryTurn = { id: string; createdAt?: number; status?: string };

export function pageThreadHistory(
  threadId: string,
  turns: HistoryTurn[],
  messages: unknown[],
  options: { cursor?: string | null; limit?: number; sortDirection?: string } = {},
): { turns: Array<Record<string, unknown>>; data: Array<Record<string, unknown>>; nextCursor: string | null } {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 32)));
  const descending = (options.sortDirection ?? "desc").toLowerCase() !== "asc";
  const byTurn = new Map<string, unknown[]>();
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const turnId = (message as { turnId?: unknown }).turnId;
    if (typeof turnId !== "string" || !turnId) continue;
    const items = byTurn.get(turnId);
    if (items) items.push(message);
    else byTurn.set(turnId, [message]);
  }
  const ordered = [...turns].sort((a, b) => {
    const aTime = typeof a.createdAt === "number" ? a.createdAt : 0;
    const bTime = typeof b.createdAt === "number" ? b.createdAt : 0;
    return aTime === bTime
      ? (descending ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id))
      : (descending ? bTime - aTime : aTime - bTime);
  });
  const cursorIndex = options.cursor ? ordered.findIndex((turn) => turn.id === options.cursor) : -1;
  const start = cursorIndex < 0 ? 0 : cursorIndex + 1;
  const window = ordered.slice(start, start + limit + 1);
  const page = window.slice(0, limit).map((turn) => ({
    ...turn,
    threadId,
    startedAt: typeof turn.createdAt === "number" ? Math.floor(turn.createdAt / 1000) : undefined,
    items: byTurn.get(turn.id) ?? [],
  }));
  const nextCursor = window.length > page.length ? page.at(-1)?.id as string ?? null : null;
  return { turns: page, data: page, nextCursor };
}
