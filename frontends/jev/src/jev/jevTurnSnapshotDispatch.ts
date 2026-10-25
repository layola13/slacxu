import type { WorkbenchItem, WorkbenchTurn } from "@cxu/sdk-frontend";
import { dispatchJevTurnCompleted } from "./jevAutoJudge";

/**
 * Settle delay before snapshotting a completed turn for JEV auto-judge.
 * Above LONG_TRANSCRIPT_FLUSH_MS (160) so the transcript store has applied
 * this turn's tail (80/160ms scheduler batches) before we read it.
 */
export const JEV_SNAPSHOT_SETTLE_MS = 400;

export interface JevTurnSnapshotSource {
  getTurnFromTranscriptStore(threadId: string, turnId: string): WorkbenchTurn | undefined;
  getTurnFromRuntimeIndex(turnId: string): WorkbenchTurn | undefined;
}

/**
 * Fire-and-forget JEV snapshot dispatch for a completed turn. Reads the
 * full transcript store (not the light runtime index, which keeps only
 * userMessage/plan items and would make the judge rate every turn as
 * failed/partial for lack of assistant answer and tool calls), falling
 * back to the runtime index only when the store has no such turn.
 * Never throws: JEV dispatch must never break turn handling.
 */
export function dispatchJevTurnSnapshotDelayed(
  source: JevTurnSnapshotSource,
  detail: { threadId: string; turnId: string; sessionToken: string | null | undefined },
): void {
  const { threadId, turnId, sessionToken } = detail;
  window.setTimeout(() => {
    try {
      const completedTurn = source.getTurnFromTranscriptStore(threadId, turnId)
        ?? source.getTurnFromRuntimeIndex(turnId);
      if (completedTurn) {
        dispatchJevTurnCompleted({
          threadId,
          turnId: completedTurn.id,
          sessionToken: sessionToken ?? null,
          items: (completedTurn.items ?? []).map((item: WorkbenchItem) => ({
            type: String(item.type ?? ""),
            title: String(item.title ?? ""),
            text: String(item.text ?? "").slice(0, 6000),
          })),
        });
      } else if (turnId) {
        // 诊断点：turn 结算了但 transcript store / turnsRef 里都找不到，JEV 自动评审会被跳过。
        console.warn(`[jev] skip auto-judge dispatch: turn ${turnId} not in transcript store (thread=${threadId})`);
      }
    } catch {
      // JEV dispatch must never break turn handling.
    }
  }, JEV_SNAPSHOT_SETTLE_MS);
}
