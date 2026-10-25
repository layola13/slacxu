export function shouldPromptGoalResume(handledThreadIds: ReadonlySet<string>, threadId: string): boolean {
  return !handledThreadIds.has(threadId);
}

export function markGoalResumeHandled(handledThreadIds: Set<string>, threadId: string): void {
  handledThreadIds.add(threadId);
}

export function resetGoalResumeDecision(handledThreadIds: Set<string>, threadId: string): void {
  handledThreadIds.delete(threadId);
}
