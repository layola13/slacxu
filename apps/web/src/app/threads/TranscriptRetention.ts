import { touchRecentThreadTranscript } from "../../state/recentThreadTranscripts";

/** Owns the warm-transcript LRU independently from React component state. */
export class TranscriptRetention {
  private recentThreadIds: string[] = [];

  touch(threadId: string, activeThreadId: string | null, protectedThreadIds: ReadonlySet<string>): string[] {
    const result = touchRecentThreadTranscript(this.recentThreadIds, threadId, activeThreadId, protectedThreadIds);
    this.recentThreadIds = result.recentThreadIds;
    return result.evictedThreadIds;
  }

  snapshot(): readonly string[] {
    return this.recentThreadIds;
  }
}
