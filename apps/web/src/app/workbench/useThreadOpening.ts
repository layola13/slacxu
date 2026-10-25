import { startTransition, useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PermissionPresetId, ProviderConfig } from "@codex-ui/shared";
import { setRemoteThreadForeground, threadReadToTurns, type ClientState, type CodexSocketClient } from "../../state/codexClient";
import { loadOlderThreadHistoryPage, type ThreadHistoryPageState } from "../../app/threads/threadHistoryService";
import { ThreadLoadQueue } from "../../app/threads/ThreadLoadQueue";
import type { useTopicTranscriptRuntime } from "../../app/transcripts/useTopicTranscriptRuntime";
import type { TopicTranscriptStore } from "../../app/transcripts/topicTranscriptStore";
import { errorMessage, formatErrorText, parseTokenBreakdown, parseTokenUsageBillingSnapshot, syncWorkspaceFromThread } from "./appUtils";
import { fetchThreadUsage, loadImageHistory, type ImageHistoryEntry, type ThreadRequestUsageRecord, type WorkbenchTurn } from "../../state/codexClient";
import { buildLocalImageThreadTurns } from "../../imageThreadHistory";
import { mergeWorkbenchTurns } from "../../state/workbenchTimeline";
import { isRunningTurnStatus } from "../transcripts/topicRuntimeIndex";
import { loadInitialThreadHistory } from "../threads/threadHistoryService";
import { imageRuntimeFromHistory } from "../../imageRuntime";
import type { TopicUsageStore } from "../usage/topicUsageStore";
import { normalizeWorkspaceCwd } from "../../workspacePaths";
import type { ThreadLoadProgress } from "../../components/ChatPanel";
import type { SplitViewState, WorkspaceLayoutState } from "../../taskTabs";
import type { WorkspaceMode } from "./appConstants";
import type { ThreadRuntimeSelectionsDomain } from "../runtime/useThreadRuntimeSelections";
import type { appReducer } from "../../app/appReducer";
import type { TranslateFn } from "../../i18n";

export function useThreadOpening(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  threadHistoryPagesRef: MutableRefObject<Record<string, ThreadHistoryPageState>>;
  setThreadHistoryPages: Dispatch<SetStateAction<Record<string, ThreadHistoryPageState>>>;
  activeThreadIdRef: MutableRefObject<string | null>;
  threadSelectionEpochRef: MutableRefObject<number>;
  threadLoadQueueRef: MutableRefObject<ThreadLoadQueue | null>;
  optimisticThreadIdsRef: MutableRefObject<Set<string>>;
  transcriptRuntime: ReturnType<typeof useTopicTranscriptRuntime>;
  topicTranscriptStore: TopicTranscriptStore;
  splitMutationEpochRef: MutableRefObject<number>;
  setWorkspaceSelectionPending: Dispatch<SetStateAction<boolean>>;
  setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
  setWorkspaceFilePath: Dispatch<SetStateAction<string | null>>;
  setCwd: Dispatch<SetStateAction<string>>;
  setAdditionalRoots: Dispatch<SetStateAction<string[]>>;
  setSshCommand: Dispatch<SetStateAction<string>>;
  setSshCwd: Dispatch<SetStateAction<string>>;
  setThreadLoadProgress: Dispatch<SetStateAction<ThreadLoadProgress | null>>;
  setRemoteLifecycleOverrides: Dispatch<SetStateAction<Record<string, "foreground" | "background">>>;
  setWelcomeDismissed: Dispatch<SetStateAction<boolean>>;
  providersRef: MutableRefObject<ProviderConfig[]>;
  usageStore: TopicUsageStore;
  publishThreadTokenUsage: (immediate?: boolean) => void;
  loadThreadGoal: (threadId: string) => Promise<unknown>;
  discardThreadGoal: (threadId: string) => void;
  workspaceLayout: WorkspaceLayoutState | null;
  splitView: SplitViewState | null;
} & Pick<ThreadRuntimeSelectionsDomain, "historySelectionForThread" | "updateImageRuntimeSelection" | "loadPersistedThreadRuntimeSelection">) {
  const {
    state,
    dispatch,
    client,
    t,
    threadHistoryPagesRef,
    setThreadHistoryPages,
    activeThreadIdRef,
    threadSelectionEpochRef,
    threadLoadQueueRef,
    optimisticThreadIdsRef,
    transcriptRuntime,
    topicTranscriptStore,
    splitMutationEpochRef,
    setWorkspaceSelectionPending,
    setWorkspaceMode,
    setWorkspaceFilePath,
    setCwd,
    setAdditionalRoots,
    setSshCommand,
    setSshCwd,
    setThreadLoadProgress,
    setRemoteLifecycleOverrides,
    setWelcomeDismissed,
    providersRef,
    usageStore,
    publishThreadTokenUsage,
    loadThreadGoal,
    discardThreadGoal,
    workspaceLayout,
    splitView,
    historySelectionForThread,
    updateImageRuntimeSelection,
    loadPersistedThreadRuntimeSelection,
  } = input;
  const updateThreadLoadProgress = useCallback((threadId: string, progress: number, label: string) => {
    setThreadLoadProgress((current: ThreadLoadProgress | null) =>
      current?.threadId === threadId
        ? { ...current, progress: Math.max(current.progress, progress), label }
        : current
    );
  }, []);

  const loadInitialThreadPage = useCallback(async (threadId: string, onStage?: (pct: number, label: string) => void) => {
    const mergeImageHistory = async (loaded: ReturnType<typeof threadReadToTurns>) => {
      if (!state.token) return loaded;
      try {
        const entries = await loadImageHistory(state.token, threadId);
        const imageTurns = entries.flatMap((entry: ImageHistoryEntry) => buildLocalImageThreadTurns({
          threadId: entry.threadId, turnId: entry.turnId, prompt: "", mode: "generate",
          sourceImages: [], provider: { id: "image-history", kind: "responsesRelay", name: "Image", nativeModels: [], modelAliases: [], createdAt: 0, updatedAt: 0 },
          result: null, items: entry.items, status: entry.status
        }));
        return { ...loaded, turns: mergeWorkbenchTurns(loaded.turns, imageTurns) };
      } catch (error) {
        console.warn("[image history] failed to load UI-only records", formatErrorText(error));
        return loaded;
      }
    };
    const preserveRunningTurnIds = new Set(
      state.turns
        .filter((turn: WorkbenchTurn) => turn.threadId === threadId && isRunningTurnStatus(turn.status))
        .map((turn: WorkbenchTurn) => turn.id)
    );
    const { loaded, pageState, incomplete, notice } = await loadInitialThreadHistory(client, threadId, { preserveRunningTurnIds, onStage });
    threadHistoryPagesRef.current = { ...threadHistoryPagesRef.current, [threadId]: pageState };
    setThreadHistoryPages((current: Record<string, ThreadHistoryPageState>) => ({ ...current, [threadId]: pageState }));
    if (state.token) {
      void fetchThreadUsage(state.token, threadId)
        .then((records: ThreadRequestUsageRecord[]) => {
          for (const record of records) {
            const usage = parseTokenBreakdown(record.usage);
            if (!usage) continue;
            usageStore.restoreRequest(threadId, record.turnId, record.requestId, {
              ...usage,
              ...(typeof record.costUsd === "number" ? { estimatedCostUsd: record.costUsd } : {}),
              ...(record.billingSnapshot ? { billingSnapshot: parseTokenUsageBillingSnapshot(record.billingSnapshot) } : {})
            });
          }
          publishThreadTokenUsage(true);
        })
        .catch((error: unknown) => console.warn("[thread usage] failed to restore request ledger", formatErrorText(error)));
    }
    const merged = await mergeImageHistory(loaded);
    return { ...merged, incomplete, notice };
  }, [client, publishThreadTokenUsage, state.token, state.turns, usageStore]);
  const loadOlderThreadHistory = useCallback(async (threadId: string) => {
    const currentPage = threadHistoryPagesRef.current[threadId];
    if (!currentPage?.paginated || !currentPage.nextCursor || currentPage.loading) return;
    const loadingState = { ...currentPage, loading: true };
    threadHistoryPagesRef.current = { ...threadHistoryPagesRef.current, [threadId]: loadingState };
    setThreadHistoryPages((current: Record<string, ThreadHistoryPageState>) => ({ ...current, [threadId]: loadingState }));
    try {
      const page = await loadOlderThreadHistoryPage(client, threadId, currentPage.nextCursor);
      if (activeThreadIdRef.current !== threadId) {
        const inactiveState = { ...currentPage, loading: false };
        threadHistoryPagesRef.current = { ...threadHistoryPagesRef.current, [threadId]: inactiveState };
        setThreadHistoryPages((current: Record<string, ThreadHistoryPageState>) => ({ ...current, [threadId]: inactiveState }));
        return;
      }
      transcriptRuntime.mergeSnapshot(null, page.turns);
      startTransition(() => dispatch({ type: "threadMerged", thread: null, turns: page.turns }));
      const nextState = page.pageState;
      threadHistoryPagesRef.current = { ...threadHistoryPagesRef.current, [threadId]: nextState };
      setThreadHistoryPages((current: Record<string, ThreadHistoryPageState>) => ({ ...current, [threadId]: nextState }));
    } catch (error) {
      const nextState = { ...currentPage, loading: false };
      threadHistoryPagesRef.current = { ...threadHistoryPagesRef.current, [threadId]: nextState };
      setThreadHistoryPages((current: Record<string, ThreadHistoryPageState>) => ({ ...current, [threadId]: nextState }));
      console.warn("[thread pagination] older history page failed", formatErrorText(error));
    }
  }, [client, transcriptRuntime.mergeSnapshot]);

  const loadThread = useCallback(
    async (threadId: string, selectionEpoch: number | undefined = threadSelectionEpochRef.current) => {
      if (selectionEpoch !== threadSelectionEpochRef.current) {
        return false;
      }
      setWelcomeDismissed(false);
      activeThreadIdRef.current = threadId;
      dispatch({ type: "activeThread", threadId });
      updateThreadLoadProgress(threadId, 18, "Reading stored transcript");
      // 真实阶段进度: 由历史服务在 metadata/载荷/解析完成时推进,
      // 不再用定时器假 tick (慢历史会停在最后真实阶段, 而不是伪造到 85%)。
      // 仅当该 tab 仍是当前选中时才更新, 切走的请求不写进度。
      const onStage = (pct: number, label: string): void => {
        if (selectionEpoch === threadSelectionEpochRef.current && activeThreadIdRef.current === threadId) {
          updateThreadLoadProgress(threadId, pct, label);
        }
      };
      let loadTimeout: number | undefined;
      try {
        // Failsafe: the history service already times out each RPC, but a
        // never-settling promise must still release the placeholder so a
        // repeat open can retry instead of hanging forever.
        const loaded = await Promise.race([
          loadInitialThreadPage(threadId, onStage),
          new Promise<never>((_: (value: never | PromiseLike<never>) => void, reject: (reason?: unknown) => void) => {
            loadTimeout = window.setTimeout(() => reject(new Error("Loading transcript timed out after 35000ms")), 35_000);
          }),
        ]);
        const snapshotIncomplete = (loaded as { incomplete?: boolean }).incomplete === true;
        const snapshotNotice = (loaded as { notice?: string }).notice;
        transcriptRuntime.mergeSnapshot(loaded.thread, loaded.turns, snapshotIncomplete ? { incomplete: true } : undefined);
        updateThreadLoadProgress(threadId, 88, "Parsing conversation history");
        if (
          selectionEpoch === threadSelectionEpochRef.current &&
          activeThreadIdRef.current === threadId
        ) {
          syncWorkspaceFromThread(loaded.thread, setCwd, setWorkspaceSelectionPending, setWorkspaceMode, setSshCommand, setSshCwd, setAdditionalRoots, setWorkspaceFilePath);
          updateThreadLoadProgress(threadId, 92, "Rendering conversation");
          // The selected transcript must commit immediately so the active tab can
          // render the cached snapshot without waiting for a transition.
          // Incomplete restores still render metadata (composer unlocks) but are
          // never cached as complete, so a repeat open retries the read.
          dispatch({ type: "threadLoaded", thread: loaded.thread, turns: loaded.turns });
          if (snapshotIncomplete && snapshotNotice) {
            dispatch({ type: "error", message: snapshotNotice });
          }
          const restoredImageRuntime = imageRuntimeFromHistory(loaded.turns, providersRef.current);
          if (restoredImageRuntime) updateImageRuntimeSelection(restoredImageRuntime, threadId);
          void loadThreadGoal(threadId);
        } else {
          startTransition(() => {
            dispatch({ type: "threadMerged", thread: loaded.thread, turns: loaded.turns });
          });
        }
        return true;
      } catch (error) {
        setThreadLoadProgress((current: ThreadLoadProgress | null) => current?.threadId === threadId ? null : current);
        dispatch({ type: "error", message: formatErrorText(error) });
        return false;
      } finally {
        if (loadTimeout !== undefined) window.clearTimeout(loadTimeout);
      }
    },
    [loadInitialThreadPage, loadThreadGoal, transcriptRuntime.mergeSnapshot, updateImageRuntimeSelection, updateThreadLoadProgress]
  );

  const loadThreadIntoCache = useCallback(
    (threadId: string, options: { silent?: boolean } = {}) => {
      return threadLoadQueueRef.current!.enqueue(threadId, async () => {
          try {
            const loaded = await loadInitialThreadPage(threadId);
            const backgroundIncomplete = (loaded as { incomplete?: boolean }).incomplete === true;
            transcriptRuntime.mergeSnapshot(loaded.thread, loaded.turns, backgroundIncomplete ? { incomplete: true } : undefined);
            if (threadId === activeThreadIdRef.current) {
              syncWorkspaceFromThread(loaded.thread, setCwd, setWorkspaceSelectionPending, setWorkspaceMode, setSshCommand, setSshCwd, setAdditionalRoots, setWorkspaceFilePath);
            }
            startTransition(() => {
              dispatch({ type: "threadMerged", thread: loaded.thread, turns: loaded.turns });
            });
          } catch (error) {
            if (options.silent) {
              console.info("[thread reconcile] thread/read unavailable; will retry", formatErrorText(error));
            } else {
              dispatch({ type: "error", message: formatErrorText(error) });
            }
          }
      });
    },
    [loadInitialThreadPage, transcriptRuntime.mergeSnapshot]
  );

  const loadThreadMetadata = useCallback(
    async (threadId: string, options: { silent?: boolean } = {}) => {
      try {
        const result = await client.rpc("thread/read", { threadId, includeTurns: false });
        const loaded = threadReadToTurns(result);
        if (threadId === activeThreadIdRef.current) {
          syncWorkspaceFromThread(loaded.thread, setCwd, setWorkspaceSelectionPending, setWorkspaceMode, setSshCommand, setSshCwd, setAdditionalRoots, setWorkspaceFilePath);
        }
        startTransition(() => {
          dispatch({ type: "threadSynced", thread: loaded.thread });
        });
      } catch (error) {
        if (options.silent) {
          console.info("[thread reconcile] metadata refresh unavailable; will retry", formatErrorText(error));
        } else {
          dispatch({ type: "error", message: formatErrorText(error) });
        }
      }
    },
    [client]
  );

  return {
    loadOlderThreadHistory,
    loadThread,
    loadThreadIntoCache,
    loadThreadMetadata,
    loadInitialThreadPage,
    updateThreadLoadProgress,
  };
}
