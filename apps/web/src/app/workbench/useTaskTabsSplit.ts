import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  closeWorkspacePane,
  createWorkspaceLayout,
  layoutPaneIds,
  moveTaskTab,
  openTaskTab,
  replaceWorkspacePaneThread,
  reverseSplitView,
  splitWorkspacePane,
  twoPaneSplitView,
  reconcileSplitViewState,
  reconcileWorkspaceLayout,
  type SplitDirection,
  type SplitViewState,
  type WorkspaceLayoutState,
  type WorkspacePaneState,
} from "../../taskTabs";
import { closeRemoteThread, setRemoteThreadLifecycle } from "../../state/codexClient";
import { formatErrorText, syncWorkspaceFromThread } from "./appUtils";
import { normalizeWorkspaceCwd, normalizeWorkspaceRoots } from "../../workspacePaths";
import { displayThreadTitle, isSshThread } from "../threads/threadCatalog";
import type { TopicTranscriptStore } from "../transcripts/topicTranscriptStore";
import type { TopicUsageStore } from "../usage/topicUsageStore";
import type { ThreadHistoryPageState } from "../threads/threadHistoryService";
import type { LoadedThreadRuntimeSelection, ThreadRuntimeSelectionsDomain } from "../runtime/useThreadRuntimeSelections";
import type { DetachedTaskSnapshot, WorkspaceMode } from "./appConstants";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient, ThreadEntry } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useTaskTabsFocus(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  activeThreadIdRef: MutableRefObject<string | null>;
  allHistoryThreadsRef: MutableRefObject<ClientState["threads"]>;
  topicTranscriptStore: TopicTranscriptStore;
  loadThreadIntoCache: (threadId: string) => Promise<void>;
  workspaceLayout: WorkspaceLayoutState | null;
  setWorkspaceLayout: Dispatch<SetStateAction<WorkspaceLayoutState | null>>;
  setSplitView: Dispatch<SetStateAction<SplitViewState | null>>;
  splitMutationEpochRef: MutableRefObject<number>;
  setClosedTaskTabIds: Dispatch<SetStateAction<string[]>>;
  setTaskTabOrder: Dispatch<SetStateAction<string[]>>;
  setWorkspaceSelectionPending: Dispatch<SetStateAction<boolean>>;
  setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
  setWorkspaceFilePath: Dispatch<SetStateAction<string | null>>;
  setCwd: Dispatch<SetStateAction<string>>;
  setAdditionalRoots: Dispatch<SetStateAction<string[]>>;
  setSshCommand: Dispatch<SetStateAction<string>>;
  setSshCwd: Dispatch<SetStateAction<string>>;
} & Pick<ThreadRuntimeSelectionsDomain, "historySelectionForThread" | "loadPersistedThreadRuntimeSelection">) {
  const {
    state,
    dispatch,
    activeThreadIdRef,
    allHistoryThreadsRef,
    topicTranscriptStore,
    loadThreadIntoCache,
    workspaceLayout,
    setWorkspaceLayout,
    setSplitView,
    splitMutationEpochRef,
    setClosedTaskTabIds,
    setTaskTabOrder,
    setWorkspaceSelectionPending,
    setWorkspaceMode,
    setWorkspaceFilePath,
    setCwd,
    setAdditionalRoots,
    setSshCommand,
    setSshCwd,
    historySelectionForThread,
    loadPersistedThreadRuntimeSelection,
  } = input;
  const focusSplitThread = useCallback((threadId: string) => {
    if (threadId === activeThreadIdRef.current) return;
    const thread = state.threads.find((entry: ThreadEntry) => entry.id === threadId)
      ?? allHistoryThreadsRef.current.find((entry: ThreadEntry) => entry.id === threadId)
      ?? null;
    const fallbackSelection = historySelectionForThread(threadId);
    const cachedTurns = topicTranscriptStore.hasThreadTranscript(threadId);
    activeThreadIdRef.current = threadId;
    setWorkspaceSelectionPending(false);
    setClosedTaskTabIds((current: string[]) => current.filter((id: string) => id !== threadId));
    setTaskTabOrder((current: string[]) => openTaskTab(current, threadId));
    syncWorkspaceFromThread(thread, setCwd, setWorkspaceSelectionPending, setWorkspaceMode, setSshCommand, setSshCwd, setAdditionalRoots, setWorkspaceFilePath);
    dispatch({ type: "activeThread", threadId });
    if (!cachedTurns) void loadThreadIntoCache(threadId);
    void loadPersistedThreadRuntimeSelection(threadId, fallbackSelection).then((selection: LoadedThreadRuntimeSelection) => {
      if (activeThreadIdRef.current !== threadId) return;
      const persistedCwd = normalizeWorkspaceCwd(selection.cwd ?? "");
      const workspaceCwd = persistedCwd || thread?.sshCwd?.trim() || thread?.cwd?.trim() || "";
      if (!workspaceCwd) return;
      setAdditionalRoots(normalizeWorkspaceRoots(workspaceCwd, selection.additionalRoots ?? thread?.additionalRoots ?? []));
      setWorkspaceFilePath(thread?.workspaceMode === "ssh" ? null : selection.workspaceFilePath ?? null);
      if (thread?.workspaceMode === "ssh") return;
      setCwd(workspaceCwd);
      setWorkspaceMode("local");
      setWorkspaceSelectionPending(false);
    });
  }, [historySelectionForThread, loadPersistedThreadRuntimeSelection, loadThreadIntoCache, state.threads, topicTranscriptStore]);

  const closeWorkspacePaneAndCollapse = useCallback((paneId: string) => {
    if (!workspaceLayout) return;
    splitMutationEpochRef.current += 1;
    const next = closeWorkspacePane(workspaceLayout, paneId);
    const remainingPaneIds = layoutPaneIds(next.root);
    if (remainingPaneIds.length <= 1) {
      const remaining = next.panes.find((pane: WorkspacePaneState) => pane.id === remainingPaneIds[0]);
      setWorkspaceLayout(null);
      setSplitView(null);
      if (remaining?.threadId) focusSplitThread(remaining.threadId);
      return;
    }
    setWorkspaceLayout(next);
    setSplitView(twoPaneSplitView(next));
    const focused = next.panes.find((pane: WorkspacePaneState) => pane.id === next.focusedPaneId);
    if (focused?.threadId) focusSplitThread(focused.threadId);
  }, [focusSplitThread, workspaceLayout]);
  return { focusSplitThread, closeWorkspacePaneAndCollapse };
}

export function useTaskTabsSplit(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  splitView: SplitViewState | null;
  setSplitView: Dispatch<SetStateAction<SplitViewState | null>>;
  workspaceLayout: WorkspaceLayoutState | null;
  setWorkspaceLayout: Dispatch<SetStateAction<WorkspaceLayoutState | null>>;
  splitMutationEpochRef: MutableRefObject<number>;
  setClosedTaskTabIds: Dispatch<SetStateAction<string[]>>;
  setTaskTabOrder: Dispatch<SetStateAction<string[]>>;
  setSplitViewMenuAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  setSplitViewMenuPosition: Dispatch<SetStateAction<{ top: number; left: number } | null>>;
  setSplitViewSearch: Dispatch<SetStateAction<string>>;
  splitViewBaseThreadId: string | null;
  setSplitViewBaseThreadId: Dispatch<SetStateAction<string | null>>;
  pendingPaneSplit: { paneId: string; direction: SplitDirection } | null;
  setPendingPaneSplit: Dispatch<SetStateAction<{ paneId: string; direction: SplitDirection } | null>>;
  detachedTaskIds: Set<string>;
  setDetachedTaskIds: Dispatch<SetStateAction<Set<string>>>;
  mainThreads: ThreadEntry[];
  orderedMainThreads: ThreadEntry[];
  openTaskTabs: ThreadEntry[];
  runningThreadIds: ReadonlySet<string>;
  desktopLayout: boolean;
  detachedThreadId: string | null;
  activeThreadIdRef: MutableRefObject<string | null>;
  allHistoryThreadsRef: MutableRefObject<ClientState["threads"]>;
  threadHistoryPagesRef: MutableRefObject<Record<string, ThreadHistoryPageState>>;
  setThreadHistoryPages: Dispatch<SetStateAction<Record<string, ThreadHistoryPageState>>>;
  topicTranscriptStore: TopicTranscriptStore;
  usageStore: TopicUsageStore;
  loadThreadIntoCache: (threadId: string) => Promise<void>;
  selectTaskTab: (threadId: string | null) => void;
  openExistingThread: (threadId: string) => Promise<void>;
  cwdForThread: (threadId: string | null) => string;
  setRemoteLifecycleOverrides: Dispatch<SetStateAction<Record<string, "foreground" | "background">>>;
  setRemoteLifecyclePendingIds: Dispatch<SetStateAction<Set<string>>>;
  remoteLifecyclePendingIds: Set<string>;
  setWorkspaceSelectionPending: Dispatch<SetStateAction<boolean>>;
  setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
  setWorkspaceFilePath: Dispatch<SetStateAction<string | null>>;
  setCwd: Dispatch<SetStateAction<string>>;
  setAdditionalRoots: Dispatch<SetStateAction<string[]>>;
  setSshCommand: Dispatch<SetStateAction<string>>;
  setSshCwd: Dispatch<SetStateAction<string>>;
  focusSplitThread: (threadId: string) => void;
} & Pick<ThreadRuntimeSelectionsDomain, "historySelectionForThread" | "loadPersistedThreadRuntimeSelection">) {
  const {
    state,
    dispatch,
    client,
    t,
    splitView,
    setSplitView,
    workspaceLayout,
    setWorkspaceLayout,
    splitMutationEpochRef,
    setClosedTaskTabIds,
    setTaskTabOrder,
    setSplitViewMenuAnchor,
    setSplitViewMenuPosition,
    setSplitViewSearch,
    splitViewBaseThreadId,
    setSplitViewBaseThreadId,
    pendingPaneSplit,
    setPendingPaneSplit,
    detachedTaskIds,
    setDetachedTaskIds,
    mainThreads,
    orderedMainThreads,
    openTaskTabs,
    runningThreadIds,
    desktopLayout,
    detachedThreadId,
    activeThreadIdRef,
    allHistoryThreadsRef,
    threadHistoryPagesRef,
    setThreadHistoryPages,
    topicTranscriptStore,
    usageStore,
    loadThreadIntoCache,
    selectTaskTab,
    openExistingThread,
    cwdForThread,
    setRemoteLifecycleOverrides,
    setRemoteLifecyclePendingIds,
    remoteLifecyclePendingIds,
    setWorkspaceSelectionPending,
    setWorkspaceMode,
    setWorkspaceFilePath,
    setCwd,
    setAdditionalRoots,
    setSshCommand,
    setSshCwd,
    historySelectionForThread,
    loadPersistedThreadRuntimeSelection,
    focusSplitThread,
  } = input;
  const beginSplitView = async (threadId: string, preferredPeerThreadId: string | null = splitViewBaseThreadId) => {
    if (!desktopLayout) return;
    const mutationEpoch = ++splitMutationEpochRef.current;
    const activeThreadId = state.activeThreadId;
    const peerThreadId = preferredPeerThreadId && preferredPeerThreadId !== threadId
      ? preferredPeerThreadId
      : activeThreadId && activeThreadId !== threadId
      ? activeThreadId
      : openTaskTabs.find((thread) => thread.id !== threadId)?.id ?? null;
    if (!peerThreadId || peerThreadId === threadId) return;
    setClosedTaskTabIds((current) => current.filter((id) => id !== threadId && id !== peerThreadId));
    if (!topicTranscriptStore.hasThreadTranscript(threadId)) {
      await loadThreadIntoCache(threadId);
    }
    if (!topicTranscriptStore.hasThreadTranscript(peerThreadId)) await loadThreadIntoCache(peerThreadId);
    if (mutationEpoch !== splitMutationEpochRef.current) return;
    setSplitView({ leftThreadId: peerThreadId, rightThreadId: threadId });
    const nextLayout = createWorkspaceLayout([peerThreadId, threadId], "columns");
    setWorkspaceLayout({ ...nextLayout, focusedPaneId: "pane-2" });
    focusSplitThread(threadId);
    setSplitViewSearch("");
    setSplitViewBaseThreadId(null);
    setSplitViewMenuAnchor(null);
    setSplitViewMenuPosition(null);
  };

  const splitPaneWithThread = async (threadId: string) => {
    if (!pendingPaneSplit) return;
    const mutationEpoch = ++splitMutationEpochRef.current;
    const baseThreadId = splitViewBaseThreadId ?? state.activeThreadId;
    const baseLayout = workspaceLayout ?? (baseThreadId ? createWorkspaceLayout([baseThreadId], "columns") : null);
    if (!baseLayout || baseLayout.panes.length >= 6) return;
    if (!topicTranscriptStore.hasThreadTranscript(threadId)) await loadThreadIntoCache(threadId);
    if (mutationEpoch !== splitMutationEpochRef.current) return;
    const nextPaneId = baseLayout.panes.length === 1 ? "pane-2" : `pane-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const next = splitWorkspacePane(baseLayout, pendingPaneSplit.paneId, pendingPaneSplit.direction, { id: nextPaneId, threadId });
    if (next) {
      setClosedTaskTabIds((current) => current.filter((id) => id !== threadId));
      setWorkspaceLayout(next);
      // Recursive layouts are authoritative once a third pane is added. Keeping
      // the legacy two-pane state would make its focus reconciliation fight the
      // newly focused pane on every render.
      if (next.panes.length > 2) setSplitView(null);
      focusSplitThread(threadId);
    }
    setPendingPaneSplit(null);
    setSplitViewSearch("");
    setSplitViewBaseThreadId(null);
    setSplitViewMenuAnchor(null);
    setSplitViewMenuPosition(null);
  };

  const applyWorkspacePreset = async (preset: "columns" | "rows" | "left-one-right-two" | "left-two-right-one" | "grid-2x2" | "grid-2x3", count: number) => {
    const mutationEpoch = ++splitMutationEpochRef.current;
    const ordered = [...mainThreads].sort((left, right) => Number(runningThreadIds.has(right.id)) - Number(runningThreadIds.has(left.id)) || ((right.recencyAt ?? right.updatedAt ?? 0) - (left.recencyAt ?? left.updatedAt ?? 0)));
    const firstId = state.activeThreadId ?? ordered[0]?.id;
    const threadIds = [firstId, ...ordered.map((thread: ThreadEntry) => thread.id)].filter((id: string | undefined, index: number, ids: (string | undefined)[]): id is string => Boolean(id) && ids.indexOf(id) === index).slice(0, count);
    if (threadIds.length < count) return;
    await Promise.all(threadIds.map((threadId) => topicTranscriptStore.hasThreadTranscript(threadId) ? Promise.resolve() : loadThreadIntoCache(threadId)));
    if (mutationEpoch !== splitMutationEpochRef.current) return;
    const next = createWorkspaceLayout(threadIds, preset);
    setWorkspaceLayout(next);
    setSplitView(count === 2 && preset === "columns" ? { leftThreadId: threadIds[0]!, rightThreadId: threadIds[1]! } : null);
    setTaskTabOrder((current) => threadIds.reduce((nextOrder, threadId) => openTaskTab(nextOrder, threadId), current));
    const focused = next.panes.find((pane) => pane.id === next.focusedPaneId);
    if (focused?.threadId) focusSplitThread(focused.threadId);
    setSplitViewMenuAnchor(null);
    setSplitViewMenuPosition(null);
  };

  const separateSplitView = () => { splitMutationEpochRef.current += 1; setSplitView(null); setWorkspaceLayout(null); };

  const reverseCurrentSplitView = () => {
    setSplitView((current) => {
      if (!current) return current;
      const reversed = reverseSplitView(current);
      setWorkspaceLayout(createWorkspaceLayout([reversed.leftThreadId, reversed.rightThreadId], "columns"));
      return reversed;
    });
  };

  const closeSplitSide = (side: "left" | "right") => {
    if (!splitView) return;
    splitMutationEpochRef.current += 1;
    const keepThreadId = side === "left" ? splitView.rightThreadId : splitView.leftThreadId;
    setSplitView(null);
    setWorkspaceLayout(null);
    focusSplitThread(keepThreadId);
  };

  const selectVisibleTaskTab = (threadId: string) => {
    splitMutationEpochRef.current += 1;
    if (workspaceLayout) {
      const existingPane = workspaceLayout.panes.find((pane) => pane.threadId === threadId);
      if (existingPane) {
        setWorkspaceLayout({ ...workspaceLayout, focusedPaneId: existingPane.id });
      } else {
        const next = replaceWorkspacePaneThread(workspaceLayout, workspaceLayout.focusedPaneId, threadId);
        setWorkspaceLayout(next);
        setSplitView(twoPaneSplitView(next));
      }
      focusSplitThread(threadId);
      return;
    }
    if (!splitView || splitView.leftThreadId === threadId || splitView.rightThreadId === threadId) {
      focusSplitThread(threadId);
      return;
    }
    setSplitView((current) => current ? (
      state.activeThreadId === current.leftThreadId
        ? { ...current, leftThreadId: threadId }
        : { ...current, rightThreadId: threadId }
    ) : current);
    focusSplitThread(threadId);
  };

  const placeTaskInSplitSide = async (threadId: string, side: "left" | "right") => {
    if (!desktopLayout) return;
    const mutationEpoch = ++splitMutationEpochRef.current;
    if (!topicTranscriptStore.hasThreadTranscript(threadId)) {
      await loadThreadIntoCache(threadId);
    }
    if (mutationEpoch !== splitMutationEpochRef.current) return;
    if (workspaceLayout) {
      const paneIds = layoutPaneIds(workspaceLayout.root);
      if (paneIds.length === 2) {
        const targetPaneId = side === "left" ? paneIds[0]! : paneIds[1]!;
        const next = replaceWorkspacePaneThread(workspaceLayout, targetPaneId, threadId);
        setWorkspaceLayout(next);
        setSplitView(twoPaneSplitView(next));
        focusSplitThread(threadId);
        return;
      }
    }
    if (splitView) {
      const otherThreadId = side === "left" ? splitView.rightThreadId : splitView.leftThreadId;
      if (otherThreadId === threadId) {
        setSplitView(reverseSplitView(splitView));
      } else {
        setSplitView(side === "left"
          ? { leftThreadId: threadId, rightThreadId: otherThreadId }
          : { leftThreadId: otherThreadId, rightThreadId: threadId });
      }
      focusSplitThread(threadId);
      return;
    }
    const peerThreadId = state.activeThreadId && state.activeThreadId !== threadId
      ? state.activeThreadId
      : openTaskTabs.find((thread) => thread.id !== threadId)?.id ?? null;
    if (!peerThreadId) return;
    if (!topicTranscriptStore.hasThreadTranscript(peerThreadId)) {
      await loadThreadIntoCache(peerThreadId);
    }
    if (mutationEpoch !== splitMutationEpochRef.current) return;
    setSplitView(side === "left"
      ? { leftThreadId: threadId, rightThreadId: peerThreadId }
      : { leftThreadId: peerThreadId, rightThreadId: threadId });
    focusSplitThread(threadId);
  };

  const closeTaskTabs = (threadIds: string[], preferredThreadId?: string, options?: { skipRemoteClose?: boolean }) => {
    if (threadIds.length === 0) return;
    for (const threadId of threadIds) client?.unwatchThread(threadId);
    if (state.token && !options?.skipRemoteClose) {
      for (const threadId of threadIds) {
        const thread = openTaskTabs.find((entry) => entry.id === threadId);
        if (thread?.remoteExecutionMode === "autonomous") {
          void closeRemoteThread(state.token, threadId).catch((error) => dispatch({ type: "error", message: formatErrorText(error) }));
        } else if (thread && isSshThread(thread) && options?.skipRemoteClose !== true) {
          // Hiding a tab must not stop the shared SSH app-server. Its Codex
          // session owns the remote thread history and is needed when the tab
          // is opened again; explicit workspace teardown handles bridge close.
        }
      }
    }
    splitMutationEpochRef.current += 1;
    const hidden = new Set(threadIds);
    topicTranscriptStore.evict(threadIds);
    usageStore.evict(threadIds);
    dispatch({ type: "threadTranscriptsEvicted", threadIds });
    setThreadHistoryPages((current) => {
      const next = { ...current };
      for (const threadId of threadIds) delete next[threadId];
      threadHistoryPagesRef.current = next;
      return next;
    });
    if (workspaceLayout) {
      let next = workspaceLayout;
      for (const pane of workspaceLayout.panes) {
        if (pane.threadId && hidden.has(pane.threadId) && next.panes.length > 1) {
          next = closeWorkspacePane(next, pane.id);
        }
      }
      const remainingPaneIds = layoutPaneIds(next.root);
      if (remainingPaneIds.length <= 1) {
        const remaining = next.panes.find((pane) => pane.id === remainingPaneIds[0]);
        setWorkspaceLayout(null);
        setSplitView(null);
        if (remaining?.threadId && !hidden.has(remaining.threadId)) focusSplitThread(remaining.threadId);
      } else if (next !== workspaceLayout) {
        setWorkspaceLayout(next);
        setSplitView(twoPaneSplitView(next));
      }
    }
    if (splitView && (hidden.has(splitView.leftThreadId) || hidden.has(splitView.rightThreadId))) {
      const remainingSplitThreadId = hidden.has(splitView.leftThreadId) ? splitView.rightThreadId : splitView.leftThreadId;
      setSplitView(null);
      if (!hidden.has(remainingSplitThreadId)) focusSplitThread(remainingSplitThreadId);
    }
    setClosedTaskTabIds((current) => [...new Set([...current, ...threadIds])]);
    if (!state.activeThreadId || !hidden.has(state.activeThreadId)) return;
    const remaining = openTaskTabs.filter((thread) => !hidden.has(thread.id));
    const preferred = preferredThreadId ? remaining.find((thread) => thread.id === preferredThreadId) : null;
    const firstHiddenIndex = Math.max(0, openTaskTabs.findIndex((thread) => hidden.has(thread.id)));
    const nextThread = preferred ?? remaining[Math.min(firstHiddenIndex, remaining.length - 1)] ?? remaining.at(-1) ?? null;
    selectTaskTab(nextThread?.id ?? null);
  };

  const closeTaskTab = (threadId: string) => closeTaskTabs([threadId]);

  const setRemoteThreadMode = async (threadId: string, foreground: boolean) => {
    if (!state.token || remoteLifecyclePendingIds.has(threadId)) return;
    setRemoteLifecyclePendingIds((current) => new Set(current).add(threadId));
    try {
      const lifecycleMode = foreground ? "foreground" : "background";
      await setRemoteThreadLifecycle(state.token, threadId, lifecycleMode);
      setRemoteLifecycleOverrides((current) => ({ ...current, [threadId]: lifecycleMode }));
      if (foreground) {
        setClosedTaskTabIds((current) => current.filter((id) => id !== threadId));
        await openExistingThread(threadId);
      }
    } finally {
      setRemoteLifecyclePendingIds((current) => {
        const next = new Set(current);
        next.delete(threadId);
        return next;
      });
    }
  };

  const detachTaskTab = async (thread: ThreadEntry) => {
    const desktop = window.codexUltraDesktop;
    if (!desktop || detachedTaskIds.has(thread.id)) return;
    const detachedThread = { ...thread, cwd: cwdForThread(thread.id) };
    setDetachedTaskIds((current) => new Set(current).add(thread.id));
    closeTaskTab(thread.id);
    const scrollTop = document.querySelector<HTMLElement>('[data-testid="chat-waterfall-scroll"]')?.scrollTop;
    const existingPageState = threadHistoryPagesRef.current[thread.id];
    const detached = await desktop.detachTask({
      threadId: thread.id,
      title: displayThreadTitle(thread),
      snapshot: {
        threadId: thread.id,
        thread: detachedThread,
        pageState: existingPageState ? {
          loading: false,
          nextCursor: existingPageState.nextCursor ?? null,
          paginated: existingPageState.paginated ?? true
        } : undefined,
        ...(Number.isFinite(scrollTop) ? { scrollTop } : {})
      } satisfies DetachedTaskSnapshot
    }).catch(() => false);
    if (!detached) {
      setDetachedTaskIds((current) => {
        const next = new Set(current);
        next.delete(thread.id);
        return next;
      });
      setClosedTaskTabIds((current) => current.filter((id) => id !== thread.id));
      selectTaskTab(thread.id);
    }
  };

  const moveVisibleTaskTab = (draggedId: string, targetId: string) => {
    const materializedOrder = orderedMainThreads.map((thread) => thread.id);
    setTaskTabOrder(moveTaskTab(materializedOrder, draggedId, targetId));
  };
  return {
    beginSplitView,
    splitPaneWithThread,
    applyWorkspacePreset,
    separateSplitView,
    reverseCurrentSplitView,
    closeSplitSide,
    selectVisibleTaskTab,
    placeTaskInSplitSide,
    closeTaskTabs,
    closeTaskTab,
    setRemoteThreadMode,
    detachTaskTab,
    moveVisibleTaskTab,
  };
}

export function useSplitReconcileEffects(input: {
  workspaceLayout: WorkspaceLayoutState | null;
  splitView: SplitViewState | null;
  mainThreads: ThreadEntry[];
  setWorkspaceLayout: Dispatch<SetStateAction<WorkspaceLayoutState | null>>;
  setSplitView: Dispatch<SetStateAction<SplitViewState | null>>;
  setTaskTabOrder: Dispatch<SetStateAction<string[]>>;
  topicTranscriptStore: TopicTranscriptStore;
  loadThreadIntoCache: (threadId: string, options?: { silent?: boolean }) => Promise<void>;
  state: Pick<ClientState, "activeThreadId">;
  focusSplitThread: (threadId: string) => void;
}) {
  const { workspaceLayout, splitView, mainThreads, setWorkspaceLayout, setSplitView, setTaskTabOrder, topicTranscriptStore, loadThreadIntoCache, state, focusSplitThread } = input;
  useEffect(() => {
    if (!workspaceLayout || mainThreads.length === 0) return;
    const reconciledLayout = reconcileWorkspaceLayout(workspaceLayout, mainThreads.map((thread) => thread.id));
    if (!reconciledLayout) {
      setWorkspaceLayout(null);
      setSplitView(null);
      return;
    }
    if (reconciledLayout !== workspaceLayout) {
      setWorkspaceLayout(reconciledLayout);
      setSplitView(twoPaneSplitView(reconciledLayout));
      return;
    }
    if (layoutPaneIds(workspaceLayout.root).length <= 1) {
      // A one-pane workspace is just a normal conversation. Older right-click
      // close behavior could persist this ghost layout and its focus effect
      // would then override every later task-tab selection.
      setWorkspaceLayout(null);
      setSplitView(null);
      return;
    }
    const threadIds = workspaceLayout.panes.flatMap((pane) => pane.threadId ? [pane.threadId] : []);
    setTaskTabOrder((current) => threadIds.reduce((next, threadId) => openTaskTab(next, threadId), current));
    for (const threadId of threadIds) {
      if (!topicTranscriptStore.hasThreadTranscript(threadId)) {
        void loadThreadIntoCache(threadId);
      }
    }
    const focused = workspaceLayout.panes.find((pane) => pane.id === workspaceLayout.focusedPaneId);
    if (focused?.threadId && state.activeThreadId !== focused.threadId) focusSplitThread(focused.threadId);
  }, [focusSplitThread, loadThreadIntoCache, mainThreads, state.activeThreadId, topicTranscriptStore, workspaceLayout]);

  useEffect(() => {
    if (mainThreads.length === 0) return;
    const reconciled = reconcileSplitViewState(splitView, mainThreads.map((thread) => thread.id));
    if (splitView && !reconciled) {
      setSplitView(null);
      return;
    }
    if (reconciled && state.activeThreadId !== reconciled.leftThreadId && state.activeThreadId !== reconciled.rightThreadId) {
      focusSplitThread(reconciled.rightThreadId);
    }
    if (reconciled) {
      setTaskTabOrder((current) => openTaskTab(openTaskTab(current, reconciled.leftThreadId), reconciled.rightThreadId));
      for (const threadId of [reconciled.leftThreadId, reconciled.rightThreadId]) {
        if (!topicTranscriptStore.hasThreadTranscript(threadId)) {
          void loadThreadIntoCache(threadId);
        }
      }
    }
  }, [focusSplitThread, loadThreadIntoCache, mainThreads, splitView, state.activeThreadId, topicTranscriptStore]);
}
