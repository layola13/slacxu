import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { type ChatTypographyPreference, DEFAULT_CHAT_TYPOGRAPHY } from "../../chatTypography";
import { type PendingAppendMessage, type RequestMonitorEntry, type ThreadLoadProgress, type ThreadTokenUsageState, type TokenUsageBreakdown } from "../../components/ChatPanel";
import { type HistoryThreadUsageSummary } from "../../history/HistorySidebar";
import { RightWorkspaceTab } from "../../components/RightWorkspacePanel";
import { type WaterfallDisplayMode } from "../../waterfall/chatRows";
import { type AgentReadinessResult, type CodexCliUpdateStatus, type ComposerImageAttachment, type ComposerMention, type LocalWorkspaceInfo, type SocketConnectionStatus, type ThreadEntry, type WorkbenchTurn } from "../../state/codexClient";
import { createTaskNotificationTracker, readTaskNotificationPreferences } from "../../taskNotifications";
import { createWorkspaceLayout } from "../../taskTabs";
import { defaultLocalWorkspacePath, joinWorkspacePath } from "../../workspacePaths";
import { useCliBackendPlugins } from "../cli/useCliBackendPlugins";
import { useCliPrerequisites } from "../cli/useCliPrerequisites";
import { PendingSendGate } from "../../composer/PendingSendGate";
import { useJevAutoNudgeOwner } from "../jev/useJevAutoNudgeOwner";
import { ThreadLoadQueue } from "../threads/ThreadLoadQueue";
import { isRunningTurnStatus } from "../transcripts/topicRuntimeIndex";
import { indexTurnsByThread } from "../transcripts/transcriptProjection";
import { useTopicTranscriptRuntime } from "../transcripts/useTopicTranscriptRuntime";
import { InterruptTurnGate } from "../turnInterruptRetry";
import { type TurnRetryState, resolveTurnRetryState } from "../turnRetryState";
import { TopicUsageStore } from "../usage/topicUsageStore";
import { DEFAULT_NEW_CHAT_CWD, DangerDialogIntent, INITIAL_SOCKET_CONNECTION_STATUS, PlanImplementationPrompt, SlashCommandNotice, StartCodexTurnOptions, UI_STORAGE_KEYS, WorkspaceMode } from "./appConstants";
import { readPanelLayout, readStoredBoolean, readStoredString, readWaterfallDisplayMode } from "./preferenceUtils";
import { useHistoryState } from "./useHistoryState";
import { useImmersiveComposer } from "./useImmersiveComposer";
import { useMembersAdmin } from "./useMembersAdmin";
import { useSessionState } from "./useSessionState";
import { useSshWorkspace } from "./useSshWorkspace";
import { useTaskTabsState } from "./useTaskTabsState";
import { useThemePluginActions } from "./useThemePluginActions";
import { useWebPreview } from "./useWebPreview";
import { useWorkspacePicker } from "./useWorkspacePicker";
import { useOpenFileTabs } from "../workspace/useOpenFileTabs";
import { FREE_OLLAMA_ENABLED, type JsonValue, type ProviderConfig, type ThreadAgentRoster } from "@codex-ui/shared";

import type { AppProps } from "./appConstants";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";

import type { useAccessRuntime } from "./useAccessRuntime";
import type { useTaskTabsRuntime } from "./useTaskTabsRuntime";

export function useThreadWorkspaceRuntime(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  themeMode: AppProps["themeMode"];
  customThemePlugins: AppProps["customThemePlugins"];
  onThemeModeChange: AppProps["onThemeModeChange"];
  onCustomThemePluginsChange: AppProps["onCustomThemePluginsChange"];
  detachedThreadId: string | null;
  access: ReturnType<typeof useAccessRuntime>;
  taskTabs: ReturnType<typeof useTaskTabsRuntime>;
}) {
  const { state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId } = input;
  const {
    usageStore,
    setThreadLoadProgress,
    authSessionRef,
    historySearchTerm,
    threadHistoryPagesRef,
    threadHistoryPages,
    additionalRoots,
    historySearchTermRef,
    authSession,
  } = input.access;
  const {
    taskNotificationPreferences,
    setRightWorkspaceVisible,
    splitView,
    splitViewRef,
    resetImmersiveComposerOffset,
    workspaceLayoutRef,
    enterImmersiveView,
    immersiveView,
    setRightWorkspaceTab,
    setWorkspaceLayout,
    immersiveComposerCompact,
    workspaceLayout,
    exitImmersiveView,
    splitViewLayout,
  } = input.taskTabs;
  const fileTabs = useOpenFileTabs();
  const openFile = fileTabs.openFile;
  // Transcript auto-routes a fullscreen command into a fresh resident PTY;
  // this id asks TerminalConsole to switch to that tab once it appears.
  const rightWorkspaceRequestEpochRef = useRef(0);
  const optimisticThreadIdsRef = useRef(new Set<string>());
  // Claude history is lazy: its listing only loads the first time the sidebar's
  // Claude tab becomes active, never during startup.
  // thread/list is intentionally session-scoped. Reconnects, settings changes,
  // model/provider activation and window resume must reuse the in-memory list.
  const threadSelectionEpochRef = useRef(0);
  const threadStartInFlightRef = useRef<Promise<JsonValue> | null>(null);
  const freeModelRefreshRef = useRef<{ token: string; promise: Promise<ProviderConfig[]> } | null>(null);
  const freeModelRefreshedTokenRef = useRef<string | null>(null);
  const freeModelStartupRefreshedRef = useRef<string | null>(null);
  const activeThreadIdRef = useRef(state.activeThreadId);
  const { webPreview, setWebPreview, closeWebPreview, openBrowserPreview } = useWebPreview({ activeThreadIdRef, setRightWorkspaceTab, setRightWorkspaceVisible });
  const providersRef = useRef(state.providers);
  const additionalRootsRef = useRef(additionalRoots);
  const workspaceFolderMergeEpochRef = useRef(new Set<string>());
  const cwdForThreadRef = useRef<(threadId?: string | null) => string>(() => DEFAULT_NEW_CHAT_CWD);
  const clientRef = useRef<CodexSocketClient | null>(null);
  const activatedProviderSelectionRef = useRef<string | null>(null);
  const turnsRef = useRef(state.turns);
  const turnsByThreadIdRef = useRef(new Map<string, WorkbenchTurn[]>());
  const writerConflictThreadIdsRef = useRef(new Set<string>());
  // Several render/effect paths can request the same transcript while the first
  // request is still in flight (notably Split View restore + focus activation).
  // Keep one promise per thread so those paths never fan out into duplicate RPCs.
  const threadLoadQueueRef = useRef<ThreadLoadQueue | null>(null);
  if (!threadLoadQueueRef.current) threadLoadQueueRef.current = new ThreadLoadQueue(2);
  const connectedRef = useRef(state.connected);
  const hasOpenedSocketRef = useRef(false);
  const handledConnectionEpochRef = useRef(0);
  const pendingRequestsRef = useRef(state.pendingRequests);
  const autoContinuePlanThreadsRef = useRef(new Set<string>());
  const handledPlanTurnIdsRef = useRef(new Set<string>());
  const planContinuationTimersRef = useRef(new Map<string, number>());
  const planContinuationInFlightRef = useRef(new Set<string>());
  const imageJobsRef = useRef(new Map<string, AbortController>());
  const taskNotificationTrackerRef = useRef(createTaskNotificationTracker());
  const projectStatsCacheRef = useRef<{
    turns: ClientState["turns"];
    threads: ClientState["threads"];
    usage: Record<string, ThreadTokenUsageState>;
    projectUsage: TokenUsageBreakdown | undefined;
    historyUsageByThread: Record<string, HistoryThreadUsageSummary>;
    requestMonitor: RequestMonitorEntry[];
  } | null>(null);
  const startCodexTurnRef = useRef<(
    text: string,
    images: ComposerImageAttachment[],
    mentions: ComposerMention[],
    options?: StartCodexTurnOptions
  ) => Promise<string | null>>(async () => null);
  historySearchTermRef.current = historySearchTerm;
  activeThreadIdRef.current = state.activeThreadId;
  authSessionRef.current = authSession;
  providersRef.current = state.providers;
  additionalRootsRef.current = additionalRoots;
  turnsRef.current = state.turns;
  workspaceLayoutRef.current = workspaceLayout;
  splitViewRef.current = splitView;
  const {
    suppressThreadAutoNudge,
    resumeThreadAutoNudge,
  } = useJevAutoNudgeOwner({
    turnsRef,
    startCodexTurnRef,
  });
  const turnsByThreadId = useMemo(() => {
    const index = indexTurnsByThread(state.turns, turnsByThreadIdRef.current);
    turnsByThreadIdRef.current = index;
    return index;
  }, [state.turns]);
  const enqueueTokenUsage = useCallback((threadId: string | undefined, turnId: string | undefined, usage: ThreadTokenUsageState) => {
    usageStore.enqueue(threadId, turnId, usage);
  }, [usageStore]);

  const transcriptRuntime = useTopicTranscriptRuntime(
    state,
    dispatch,
    () => activeThreadIdRef.current ? (turnsByThreadIdRef.current.get(activeThreadIdRef.current)?.length ?? 0) : 0,
    (thread: ThreadEntry) => usageStore.registerThread(thread)
  );
  const topicTranscriptStore = transcriptRuntime.store;
  threadHistoryPagesRef.current = threadHistoryPages;
  connectedRef.current = state.connected;
  pendingRequestsRef.current = state.pendingRequests;

  // Windows can swallow dragend/pointerup when Alt+Tab moves focus to another
  // application. Never leave a full-workbench drop target or modal menu behind:
  // either one makes the renderer look alive while all clicks are intercepted.
  useEffect(() => {
    if (workspaceLayout) {
      window.localStorage.setItem(UI_STORAGE_KEYS.workspaceLayout, JSON.stringify(workspaceLayout));
    } else {
      window.localStorage.removeItem(UI_STORAGE_KEYS.workspaceLayout);
    }
  }, [workspaceLayout]);


  useEffect(() => {
    if (!immersiveView || !immersiveComposerCompact) {
      resetImmersiveComposerOffset();
    }
  }, [immersiveComposerCompact, immersiveView, resetImmersiveComposerOffset]);

  useEffect(() => {
    if (!immersiveView || !immersiveComposerCompact) return;
    const resetForViewportChange = () => resetImmersiveComposerOffset();
    window.addEventListener("resize", resetForViewportChange);
    return () => window.removeEventListener("resize", resetForViewportChange);
  }, [immersiveComposerCompact, immersiveView, resetImmersiveComposerOffset]);

  useEffect(() => {
    const toggleImmersiveWithF11 = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "F11" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (immersiveView) exitImmersiveView();
      else enterImmersiveView();
    };
    window.addEventListener("keydown", toggleImmersiveWithF11, { capture: true });
    return () => window.removeEventListener("keydown", toggleImmersiveWithF11, { capture: true });
  }, [enterImmersiveView, exitImmersiveView, immersiveView]);

  useEffect(() => {
    if (splitView) {
      window.localStorage.setItem(UI_STORAGE_KEYS.splitView, JSON.stringify(splitView));
    } else {
      window.localStorage.removeItem(UI_STORAGE_KEYS.splitView);
    }
  }, [splitView]);

  useEffect(() => {
    if (!workspaceLayout && splitView) {
      const migrated = createWorkspaceLayout([splitView.leftThreadId, splitView.rightThreadId], "columns");
      setWorkspaceLayout({ ...migrated, focusedPaneId: "pane-2" });
    }
  }, [splitView, workspaceLayout]);

  useEffect(() => {
    if (splitViewLayout) {
      window.localStorage.setItem(UI_STORAGE_KEYS.splitViewLayout, JSON.stringify(splitViewLayout));
    }
  }, [splitViewLayout]);

  useEffect(() => {
    window.localStorage.setItem(UI_STORAGE_KEYS.taskNotificationPreferences, JSON.stringify(taskNotificationPreferences));
  }, [taskNotificationPreferences]);

  const disablePlanAutoContinuation = useCallback((threadId?: string) => {
    const threadIds = threadId ? [threadId] : [...autoContinuePlanThreadsRef.current];
    for (const currentThreadId of threadIds) {
      autoContinuePlanThreadsRef.current.delete(currentThreadId);
      const timer = planContinuationTimersRef.current.get(currentThreadId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        planContinuationTimersRef.current.delete(currentThreadId);
      }
    }
  }, []);

  const enablePlanAutoContinuation = useCallback((threadId: string) => {
    autoContinuePlanThreadsRef.current.add(threadId);
    for (const turn of turnsRef.current) {
      if (turn.threadId === threadId && !isRunningTurnStatus(turn.status)) {
        handledPlanTurnIdsRef.current.add(turn.id);
      }
    }
  }, []);


  const finishThreadLoadProgress = useCallback((threadId: string) => {
    setThreadLoadProgress((current: ThreadLoadProgress | null) =>
      current?.threadId === threadId
        ? { ...current, progress: 100, label: "Conversation ready" }
        : current
    );
    window.setTimeout(() => {
      setThreadLoadProgress((current: ThreadLoadProgress | null) => current?.threadId === threadId ? null : current);
    }, 320);
  }, []);
  return {
    fileTabs,
    openFile,
    rightWorkspaceRequestEpochRef,
    optimisticThreadIdsRef,
    threadSelectionEpochRef,
    threadStartInFlightRef,
    freeModelRefreshRef,
    freeModelRefreshedTokenRef,
    freeModelStartupRefreshedRef,
    activeThreadIdRef,
    webPreview,
    setWebPreview,
    closeWebPreview,
    openBrowserPreview,
    providersRef,
    additionalRootsRef,
    workspaceFolderMergeEpochRef,
    cwdForThreadRef,
    clientRef,
    activatedProviderSelectionRef,
    turnsRef,
    turnsByThreadIdRef,
    writerConflictThreadIdsRef,
    threadLoadQueueRef,
    connectedRef,
    hasOpenedSocketRef,
    handledConnectionEpochRef,
    pendingRequestsRef,
    autoContinuePlanThreadsRef,
    handledPlanTurnIdsRef,
    planContinuationTimersRef,
    planContinuationInFlightRef,
    imageJobsRef,
    taskNotificationTrackerRef,
    projectStatsCacheRef,
    startCodexTurnRef,
    suppressThreadAutoNudge,
    resumeThreadAutoNudge,
    turnsByThreadId,
    enqueueTokenUsage,
    transcriptRuntime,
    topicTranscriptStore,
    disablePlanAutoContinuation,
    enablePlanAutoContinuation,
    finishThreadLoadProgress,
  };
}
