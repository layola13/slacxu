import { useCallback, useEffect, useRef } from "react";
import type { ComposerImageAttachment, ComposerMention } from "../../state/codexClient";
import { latestActionableRunningTurn } from "../transcripts/topicRuntimeIndex";
import type { WorkbenchTurn } from "../../state/codexClient";
import { JEV_MAX_AUTO_NUDGES, loadJevConfig } from "../../../../../frontends/jev/src/jev/jevConfig";
import { JEV_RESULT_EVENT, claimJevAutoNudgeTurn, shouldAutoNudge } from "../../../../../frontends/jev/src/jev/jevAutoJudge";
import { buildJevNudgeText, type JevVerdict } from "../../../../../frontends/jev/src/jev/jevQuestions";

export type StartCodexTurnExecutor = (
  text: string,
  images: ComposerImageAttachment[],
  mentions: ComposerMention[],
  options?: {
    threadIdOverride?: string;
    forceNewTurn?: boolean;
    jevAutoNudge?: boolean;
    [key: string]: unknown;
  }
) => Promise<string | null>;

export interface UseJevAutoNudgeOwnerOptions {
  turnsRef: React.MutableRefObject<readonly WorkbenchTurn[]>;
  startCodexTurnRef: React.MutableRefObject<StartCodexTurnExecutor>;
}

export interface UseJevAutoNudgeOwnerResult {
  suppressThreadAutoNudge: (threadId: string | null | undefined) => void;
  resumeThreadAutoNudge: (threadId: string | null | undefined) => void;
  getNudgeStreak: (threadId: string) => number;
  isThreadSuppressed: (threadId: string) => boolean;
}

/**
 * JEV 自动督促唯一 owner：按 verdict 归属线程发送，绝不绑定全局 active。
 * 之前 Composer 里用全局 onSend（只认 active）+ 全局 running 误判，
 * A 对话的 verdict 会在切对话的异步窗口内发到已停止的 B 对话里。
 * 此处三道门缺一不可：
 * 1) 无归属（threadId/turnId 缺失）fail-closed，绝不回退到 active；
 * 2) 只看归属线程自己的 running（latestActionableRunningTurn），忙则跳过；
 * 3) 用户手动停止过的线程先抑制，直到用户手动再发送。
 * 发送用 threadIdOverride + forceNewTurn 显式钉到归属线程：
 * turn 已结束，新消息就是普通一轮，绝不 steer。
 */
export function useJevAutoNudgeOwner({
  turnsRef,
  startCodexTurnRef,
}: UseJevAutoNudgeOwnerOptions): UseJevAutoNudgeOwnerResult {
  /**
   * JEV 自动督促按归属线程记账（替代原来 Composer 里绑全局 active 的 streak）：
   * - jevNudgeStreakRef：threadId -> 连续 failed/partial 次数，completed 清零；
   * - jevNudgeStoppedRef：用户手动停止过的线程，抑制后续自动督促直到用户手动再发送。
   * 两者都只认 verdict 归属线程，绝不认全局 active，避免 A 的 verdict 勾起已停止的 B。
   */
  const jevNudgeStreakRef = useRef(new Map<string, number>());
  const jevNudgeStoppedRef = useRef(new Set<string>());

  const suppressThreadAutoNudge = useCallback((threadId: string | null | undefined): void => {
    if (!threadId) return;
    jevNudgeStoppedRef.current.add(threadId);
    jevNudgeStreakRef.current.delete(threadId);
  }, []);

  const resumeThreadAutoNudge = useCallback((threadId: string | null | undefined): void => {
    if (!threadId) return;
    jevNudgeStoppedRef.current.delete(threadId);
  }, []);

  const getNudgeStreak = useCallback((threadId: string): number => {
    return jevNudgeStreakRef.current.get(threadId) ?? 0;
  }, []);

  const isThreadSuppressed = useCallback((threadId: string): boolean => {
    return jevNudgeStoppedRef.current.has(threadId);
  }, []);

  useEffect(() => {
    const onJevVerdictForNudge = (event: Event): void => {
      const verdict = (event as CustomEvent<JevVerdict>).detail;
      if (!verdict || verdict.kind === "plan" || verdict.kind === "brief" || verdict.kind === "report") return;
      const threadId = typeof verdict.threadId === "string" ? verdict.threadId : "";
      const turnId = typeof verdict.turnId === "string" ? verdict.turnId : "";
      if (!threadId || !turnId) return;
      if (verdict.choice === "completed") {
        jevNudgeStreakRef.current.delete(threadId);
        return;
      }
      if (verdict.choice !== "failed" && verdict.choice !== "partial") return;
      if (jevNudgeStoppedRef.current.has(threadId)) {
        console.warn(`[jev] auto-nudge suppressed: thread stopped by user (thread=${threadId} turn=${turnId})`);
        return;
      }
      if (latestActionableRunningTurn(turnsRef.current, threadId)) {
        console.warn(`[jev] auto-nudge skipped: owner thread busy (thread=${threadId} turn=${turnId})`);
        return;
      }
      const cfg = loadJevConfig();
      if (!cfg.enabled || !cfg.autoNudge) return;
      const streak = jevNudgeStreakRef.current.get(threadId) ?? 0;
      if (!shouldAutoNudge({
        choice: verdict.choice,
        running: false,
        autoNudge: true,
        consecutiveFailures: streak,
        maxNudges: cfg.maxNudges,
      })) {
        return;
      }
      if (!claimJevAutoNudgeTurn(turnId)) return;
      jevNudgeStreakRef.current.set(threadId, streak + 1);
      const max = Math.min(JEV_MAX_AUTO_NUDGES, Math.max(1, cfg.maxNudges));
      const starter = startCodexTurnRef.current;
      if (!starter) return;
      void Promise.resolve(
        starter(buildJevNudgeText(verdict, streak + 1, max), [], [], {
          threadIdOverride: threadId,
          forceNewTurn: true,
          jevAutoNudge: true,
        }),
      ).catch((sendError) => {
        console.warn(`[jev] auto-nudge send failed (thread=${threadId} turn=${turnId}): ${sendError instanceof Error ? sendError.message : String(sendError)}`);
      });
    };
    window.addEventListener(JEV_RESULT_EVENT, onJevVerdictForNudge);
    return () => window.removeEventListener(JEV_RESULT_EVENT, onJevVerdictForNudge);
  }, [turnsRef, startCodexTurnRef]);

  return {
    suppressThreadAutoNudge,
    resumeThreadAutoNudge,
    getNudgeStreak,
    isThreadSuppressed,
  };
}
