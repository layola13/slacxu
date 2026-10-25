import { useCallback, useEffect, useMemo, useRef, type Dispatch } from "react";
import type { ClientState, ThreadEntry, WorkbenchTurn } from "../../state/codexClient";
import type { AppAction, CodexNotification } from "../appReducer";
import { TopicTranscriptStore } from "./topicTranscriptStore";
import { useTranscriptStreamScheduler } from "./useTranscriptStreamScheduler";
import { registerTopicTranscriptDiagnostics } from "../../performance/topicDiagnostics";
import { projectRuntimeNotifications } from "./runtimeTurnProjection";

export interface TopicTranscriptRuntime {
  store: TopicTranscriptStore;
  enqueue(notification: CodexNotification): void;
  mergeSnapshot(thread: ThreadEntry | null, turns: WorkbenchTurn[], options?: { incomplete?: boolean }): void;
  replaceSnapshot(thread: ThreadEntry, turns: WorkbenchTurn[]): void;
  replaceTurn(turn: WorkbenchTurn): void;
  mergeTurn(turn: WorkbenchTurn): void;
  hasThreadTranscript(threadId: string | null): boolean;
}

/**
 * Transcript domain boundary. It owns the partitioned store, catalog hydration,
 * stream backpressure and the temporary structural-event bridge to App's light
 * runtime index. App must not implement transcript merge policy itself.
 */
export function useTopicTranscriptRuntime(
  state: Pick<ClientState, "threads" | "turns" | "activeThreadId">,
  dispatch: Dispatch<AppAction>,
  getActiveTurnCount: () => number,
  onThreadRegistered?: (thread: ClientState["threads"][number]) => void,
): TopicTranscriptRuntime {
  const onThreadRegisteredRef = useRef(onThreadRegistered);
  onThreadRegisteredRef.current = onThreadRegistered;
  const storeRef = useRef<TopicTranscriptStore | null>(null);
  if (!storeRef.current) storeRef.current = new TopicTranscriptStore((thread) => onThreadRegisteredRef.current?.(thread));
  const store = storeRef.current;

  const consumeBatch = useCallback((notifications: CodexNotification[]) => {
    store.applyNotifications(notifications);
    const threadIdByTurnId = new Map(state.turns.map((turn) => [turn.id, turn.threadId]));
    const inProgressTurnIds = new Set(
      state.turns.filter((turn) => turn.status === "inProgress").map((turn) => turn.id)
    );
    for (const notification of notifications) {
      const params = notification.params && typeof notification.params === "object" && !Array.isArray(notification.params)
        ? notification.params as Record<string, unknown>
        : {};
      const turn = params.turn && typeof params.turn === "object" && !Array.isArray(params.turn)
        ? params.turn as Record<string, unknown>
        : {};
      const turnId = typeof params.turnId === "string" ? params.turnId
        : typeof params.turn_id === "string" ? params.turn_id
        : typeof turn.id === "string" ? turn.id : undefined;
      const threadId = typeof params.threadId === "string" ? params.threadId
        : typeof params.thread_id === "string" ? params.thread_id
        : typeof turn.threadId === "string" ? turn.threadId
        : typeof turn.thread_id === "string" ? turn.thread_id : undefined;
      if (turnId && threadId) threadIdByTurnId.set(turnId, threadId);
    }
    const structural = projectRuntimeNotifications(notifications, {
      activeThreadId: state.activeThreadId,
      threadIdByTurnId,
      inProgressTurnIds
    });
    if (structural.length > 0) dispatch({ type: "notifications", messages: structural });
  }, [dispatch, state.activeThreadId, state.turns, store]);

  const scheduler = useTranscriptStreamScheduler(consumeBatch, getActiveTurnCount);

  const enqueue = useCallback((notification: CodexNotification) => {
    store.registerNotificationRouting(notification);
    scheduler.enqueue(notification);
  }, [scheduler.enqueue, store]);

  const mergeSnapshot = useCallback((thread: ThreadEntry | null, turns: WorkbenchTurn[], options?: { incomplete?: boolean }) => {
    store.mergeSnapshot(thread, turns, options);
  }, [store]);
  const replaceSnapshot = useCallback((thread: ThreadEntry, turns: WorkbenchTurn[]) => {
    store.mergeSnapshot(thread, []);
    store.replaceThreadTurns(thread.id, turns.filter((turn) => turn.threadId === thread.id));
  }, [store]);
  const replaceTurn = useCallback((turn: WorkbenchTurn) => store.replaceThreadTurn(turn), [store]);
  const mergeTurn = useCallback((turn: WorkbenchTurn) => store.mergeTurn(turn), [store]);
  const hasThreadTranscript = useCallback((threadId: string | null) => store.hasThreadTranscript(threadId), [store]);

  useEffect(() => store.replaceCatalog(state.threads), [state.threads, store]);
  useEffect(() => {
    registerTopicTranscriptDiagnostics(() => store.diagnostics());
    return () => registerTopicTranscriptDiagnostics(null);
  }, [store]);

  return useMemo(() => ({
    store,
    enqueue,
    mergeSnapshot,
    replaceSnapshot,
    replaceTurn,
    mergeTurn,
    hasThreadTranscript
  }), [enqueue, hasThreadTranscript, mergeSnapshot, replaceSnapshot, replaceTurn, mergeTurn, store]);
}

export function isHighFrequencyTranscriptDelta(method: string): boolean {
  return method === "item/agentMessage/delta"
    || method === "item/plan/delta"
    || method === "item/commandExecution/outputDelta";
}
