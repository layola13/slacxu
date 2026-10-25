// Keep enough completed transcripts warm for ordinary tab switching without
// allowing a long-lived renderer to retain every large conversation forever.
// Active, running, and visible Split View transcripts are never selected for eviction.
export const MAX_RECENT_THREAD_TRANSCRIPTS = 8;

export function touchRecentThreadTranscript(
  recentThreadIds: string[],
  threadId: string,
  activeThreadId: string | null,
  protectedThreadIds: ReadonlySet<string>,
  maxEntries = MAX_RECENT_THREAD_TRANSCRIPTS
): { recentThreadIds: string[]; evictedThreadIds: string[] } {
  const recent = recentThreadIds.filter((id) => id !== threadId);
  recent.push(threadId);
  const evictedThreadIds: string[] = [];
  while (recent.length > maxEntries) {
    const candidateIndex = recent.findIndex((candidateId) => candidateId !== activeThreadId && !protectedThreadIds.has(candidateId));
    if (candidateIndex < 0) break;
    evictedThreadIds.push(recent.splice(candidateIndex, 1)[0]!);
  }
  return { recentThreadIds: recent, evictedThreadIds };
}
