import type { useAccessRuntime } from "./useAccessRuntime";
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

export function useTaskTabsRuntime(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  themeMode: AppProps["themeMode"];
  customThemePlugins: AppProps["customThemePlugins"];
  onThemeModeChange: AppProps["onThemeModeChange"];
  onCustomThemePluginsChange: AppProps["onCustomThemePluginsChange"];
  detachedThreadId: string | null;
  access: ReturnType<typeof useAccessRuntime>;
}) {
  const { state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId } = input;
  const {
    authStatus,
    setAuthStatus,
    authSession,
    setAuthSession,
    loginError,
    setLoginError,
    loginSubmitting,
    setLoginSubmitting,
    authSessionRef,
    connectionStatus,
    setConnectionStatus,
    connectionEpoch,
    setConnectionEpoch,
    cliPrerequisitesBlocked,
    markCliPrerequisitesComplete,
    members,
    setMembers,
    membersLoading,
    setMembersLoading,
    membersError,
    setMembersError,
    reloadMembers,
    handleCreateMember,
    handleUpdateMember,
    handleDeleteMember,
    handleAllocateMemberBalance,
    dangerBypassConfirmed,
    setDangerBypassConfirmed,
    dangerDialogIntent,
    setDangerDialogIntent,
    dangerDialogAcknowledged,
    setDangerDialogAcknowledged,
    settingAssistantProviderId,
    setSettingAssistantProviderId,
    settingAssistantModel,
    setSettingAssistantModel,
    workspaceMode,
    setWorkspaceMode,
    workspaceAgentsBusy,
    setWorkspaceAgentsBusy,
    cwd,
    setCwd,
    additionalRoots,
    setAdditionalRoots,
    workspaceFilePath,
    setWorkspaceFilePath,
    newChatAdditionalRootsExpanded,
    setNewChatAdditionalRootsExpanded,
    workspacePickerPurpose,
    setWorkspacePickerPurpose,
    workspacePickerOpen,
    setWorkspacePickerOpen,
    workspacePickerPath,
    setWorkspacePickerPath,
    workspaceSelectionPending,
    setWorkspaceSelectionPending,
    workspaceNewFolderName,
    setWorkspaceNewFolderName,
    sshCommand,
    setSshCommand,
    sshCwd,
    setSshCwd,
    sshPreflightIssue,
    setSshPreflightIssue,
    sshInstallConfirming,
    setSshInstallConfirming,
    sshInstallBusy,
    setSshInstallBusy,
    sshInstallError,
    setSshInstallError,
    sshConfigHosts,
    setSshConfigHosts,
    sshConfigHostAlias,
    setSshConfigHostAlias,
    sshConfigHostsLoading,
    setSshConfigHostsLoading,
    sshConfigHostProbing,
    setSshConfigHostProbing,
    sshConfigProbeError,
    setSshConfigProbeError,
    sshDetectedHome,
    setSshDetectedHome,
    sshHostListRequestRef,
    sshHostProbeRequestRef,
    selectSshConfigHost,
    workspaceCreateBusy,
    setWorkspaceCreateBusy,
    localWorkspaceInfo,
    setLocalWorkspaceInfo,
    newChatSetupOpen,
    setNewChatSetupOpen,
    newChatBudgetLimit,
    setNewChatBudgetLimit,
    planImplementationPrompt,
    setPlanImplementationPrompt,
    handledPlanImplementationIdsRef,
    statsPanelScope,
    setStatsPanelScope,
    slashNotice,
    setSlashNotice,
    codexCliUpdateStatus,
    setCodexCliUpdateStatus,
    codexCliUpdateDialogOpen,
    setCodexCliUpdateDialogOpen,
    codexCliUpdateBusy,
    setCodexCliUpdateBusy,
    codexCliUpdateError,
    setCodexCliUpdateError,
    freeModelNotice,
    setFreeModelNotice,
    pendingAppends,
    setPendingAppends,
    pendingAcceptedThreads,
    setPendingAcceptedThreads,
    pendingNewConversationCount,
    setPendingNewConversationCount,
    pendingSendGateRef,
    interruptTurnGateRef,
    composerWatchReactivationRef,
    turnRetryState,
    setTurnRetryState,
    turnRetryStateRef,
    applyTurnRetryState,
    modelCapacityRetryRef,
    lastCodexActivityAtRef,
    threadTokenUsage,
    setThreadTokenUsage,
    threadUsagePublishTimerRef,
    threadUsagePublishBusyRef,
    threadUsagePublishPendingRef,
    usageStoreRef,
    usageStore,
    flushThreadTokenUsage,
    threadLoadProgress,
    setThreadLoadProgress,
    historySearchTerm,
    setHistorySearchTerm,
    historyLoading,
    setHistoryLoading,
    historyLoadProgress,
    setHistoryLoadProgress,
    historyDateRange,
    setHistoryDateRange,
    historyViewMode,
    setHistoryViewMode,
    historyBackendFilter,
    setHistoryBackendFilter,
    historyBackendFilterUserTouchedRef,
    threadHistoryPages,
    setThreadHistoryPages,
    allHistoryThreadsRef,
    historySearchTermRef,
    historyLoadRequestRef,
    historyFullyLoadedRef,
    initialHistoryListStartedRef,
    threadHistoryPagesRef
  } = input.access;
  const { closedTaskTabIds, setClosedTaskTabIds, taskTabOrder, setTaskTabOrder, draggedTaskTabId, setDraggedTaskTabId, splitDropHandledRef, taskTabContextMenu, setTaskTabContextMenu, paneContextMenu, setPaneContextMenu, pendingPaneSplit, setPendingPaneSplit, splitViewMenuAnchor, setSplitViewMenuAnchor, splitViewMenuPosition, setSplitViewMenuPosition, splitViewSearch, setSplitViewSearch, splitViewBaseThreadId, setSplitViewBaseThreadId, splitView, setSplitView, workspaceLayout, setWorkspaceLayout, splitViewLayout, setSplitViewLayout, detachedTaskIds, setDetachedTaskIds, detachedTaskSnapshot, setDetachedTaskSnapshot, detachedSnapshotReady, setDetachedSnapshotReady, detachedSnapshotReadyPromiseRef, resolveDetachedSnapshotReadyRef, workspaceLayoutRef, splitViewRef, splitMutationEpochRef, detachedSnapshotHydratedRef } = useTaskTabsState({ detachedThreadId });
  const [taskNotificationPreferences, setTaskNotificationPreferences] = useState(() =>
    readTaskNotificationPreferences(window.localStorage, UI_STORAGE_KEYS.taskNotificationPreferences)
  );
  const [capacityTurnRetryEnabled, setCapacityTurnRetryEnabled] = useState(false);
  const freeOllamaEnabled = FREE_OLLAMA_ENABLED;
  const [agentRosterManagerThreadId, setAgentRosterManagerThreadId] = useState<string | null>(null);
  const [, setThreadAgentRosters] = useState<Record<string, ThreadAgentRoster>>({});
  const [remoteLifecycleOverrides, setRemoteLifecycleOverrides] = useState<Record<string, "foreground" | "background">>({});
  const [remoteLifecyclePendingIds, setRemoteLifecyclePendingIds] = useState<Set<string>>(() => new Set());
  const [remoteBackgroundStarting, setRemoteBackgroundStarting] = useState(false);
  const [openWithMenuPosition, setOpenWithMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [openWithTarget, setOpenWithTarget] = useState<{ cwd: string; workspaceMode: WorkspaceMode; sshCommand: string; sshCwd: string } | null>(null);
  const [openWithApps, setOpenWithApps] = useState<Array<{ id: string; label: string }>>([]);
  const [openWithAppsLoading, setOpenWithAppsLoading] = useState(false);

  const workspaceHostPlatform = localWorkspaceInfo?.platform ?? authSession?.websocket?.platform;
  const localWorkspaceDefaultPath = defaultLocalWorkspacePath(
    workspaceHostPlatform,
    localWorkspaceInfo?.home,
    localWorkspaceInfo?.cwd,
    localWorkspaceInfo?.roots.map((root: LocalWorkspaceInfo["roots"][number]) => root.path)
  );
  const localWorkspaceProjectsPath = joinWorkspacePath(localWorkspaceDefaultPath, "projects");
  const windowsWorkspaceHost = workspaceHostPlatform === "win32";
  const [freeModelAccessOpen, setFreeModelAccessOpen] = useState(false);
  const freeModelAccessPromptedRef = useRef<string | null>(null);

  const freeAutoCompactBusyRef = useRef(false);
  const freeAutoCompactCooldownRef = useRef<Record<string, number>>({});
  const jevCompressCooldownRef = useRef<Record<string, number>>({});
  const jevCompressWarnedRef = useRef<Record<string, number>>({});
  const jevCompressBaselineRef = useRef<Record<string, { turns: number; items: number }>>({});

  const freeCompactionWaitersRef = useRef<Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    cancel: () => void;
    turnId?: string;
    providerId: string;
    model: string;
    contextWindow: number | null;
  }>>(new Map());
  const freeCompactionContextWindowByTurnIdRef = useRef<Record<string, number | null>>({});
  const contextWindowByTurnIdRef = useRef<Record<string, number | null>>({});
  const pendingContextWindowByThreadRef = useRef<Record<string, number | null>>({});
  const freeCompactionSourceTurnIdsRef = useRef<Set<string>>(new Set());
  const [compactionSourceByTurnId, setCompactionSourceByTurnId] = useState<Record<string, {
    source: "free" | "native";
    providerId: string;
    model: string;
  }>>({});
  const freeCompactBarrierRef = useRef<(() => Promise<void>) | null>(null);
  const jevCompressDirectiveRef = useRef<((options?: { threadId?: string }) => Promise<string | void>) | null>(null);
  const freeCompactAfterTurnRef = useRef<((options?: { threadId?: string; silentSkip?: boolean }) => Promise<void>) | null>(null);
  const [freeCompactMenuAnchor, setFreeCompactMenuAnchor] = useState<HTMLElement | null>(null);
  const { installedThemePluginIds, setInstalledThemePluginIds, installThemePlugin, uninstallThemePlugin, saveCustomThemePlugin, removeCustomThemePlugin } = useThemePluginActions({ themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange });
  const [leftPanelVisible, setLeftPanelVisible] = useState(false);
  const {
    immersiveView,
    setImmersiveView,
    immersiveTaskTabsOpen,
    setImmersiveTaskTabsOpen,
    immersiveComposerCompact,
    setImmersiveComposerCompact,
    immersiveHintSequence,
    setImmersiveHintSequence,
    immersiveExitHintOpen,
    setImmersiveExitHintOpen,
    immersiveComposerHintOpen,
    setImmersiveComposerHintOpen,
    immersiveComposerOffsetRef,
    immersiveComposerDockRef,
    immersiveComposerDragRef,
    applyImmersiveComposerOffset,
    resetImmersiveComposerOffset,
    beginImmersiveComposerDrag,
    moveImmersiveComposer,
    endImmersiveComposerDrag,
    enterImmersiveView,
    exitImmersiveView,
  } = useImmersiveComposer();
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [mobileTopMenuAnchor, setMobileTopMenuAnchor] = useState<HTMLElement | null>(null);
  const [mobileTopBarExpanded, setMobileTopBarExpanded] = useState(false);
  const [mobileTopBarCollapsed, setMobileTopBarCollapsed] = useState(() => readStoredBoolean(UI_STORAGE_KEYS.mobileTopBarCollapsed, false));
  const setMobileTopBarCollapsedPersisted = useCallback((collapsed: boolean) => {
    setMobileTopBarCollapsed(collapsed);
    try {
      localStorage.setItem(UI_STORAGE_KEYS.mobileTopBarCollapsed, collapsed ? "1" : "0");
    } catch {
      // Storage unavailable (private mode, tests): collapse still works in-memory.
    }
    if (collapsed) setMobileTopBarExpanded(false);
  }, []);
  const [showAssistantUsageDetails, setShowAssistantUsageDetails] = useState(() => readStoredBoolean(UI_STORAGE_KEYS.showAssistantUsageDetails, false));
  const [waterfallDisplayMode, setWaterfallDisplayMode] = useState<WaterfallDisplayMode>(() => readWaterfallDisplayMode());
  const [chatTypography, setChatTypography] = useState<ChatTypographyPreference>(DEFAULT_CHAT_TYPOGRAPHY);
  const [includeAutomationHistory, setIncludeAutomationHistory] = useState(() => readStoredBoolean(UI_STORAGE_KEYS.includeAutomationHistory, false));
  const includeAutomationHistoryRef = useRef(includeAutomationHistory);
  const [rightWorkspaceVisible, setRightWorkspaceVisible] = useState(false);
  const [rightWorkspaceTab, setRightWorkspaceTab] = useState<RightWorkspaceTab>("sidechat");
  // 主输入同步去重：慢网/卡顿时，双击发送、回车连击会在同一帧触发两次
  // startCodexTurn（state 快照还是旧的，看不到 running turn），导致发两次 turn/start。
  // 用 ref 做同步 guard，相同内容 2.5s 内只发一次。网速快时第二次调用能看到
  // running turn 而走 steer，所以只有慢网才复现。
  const startCodexTurnInFlightRef = useRef<{ key: string; at: number } | null>(null);
  const [petDockEnabled, setPetDockEnabled] = useState(() => readStoredBoolean(UI_STORAGE_KEYS.petDockEnabled, true));
  // RDP-style top bar: auto-hide by default to save vertical space; it slides
  // up and only drops down when the pointer or focus reaches the top edge.
  // Pin it once via the pin button to keep the classic fixed layout.
  const [topBarPinned, setTopBarPinned] = useState(() => readStoredBoolean(UI_STORAGE_KEYS.topBarPinned, false));
  const [topBarOpen, setTopBarOpen] = useState(false);
  const topBarHideTimerRef = useRef<number | undefined>(undefined);
  const cancelTopBarHide = useCallback(() => {
    if (topBarHideTimerRef.current !== undefined) {
      window.clearTimeout(topBarHideTimerRef.current);
      topBarHideTimerRef.current = undefined;
    }
  }, []);
  const openTopBar = useCallback(() => {
    cancelTopBarHide();
    setTopBarOpen(true);
  }, [cancelTopBarHide]);
  const scheduleTopBarHide = useCallback(() => {
    cancelTopBarHide();
    topBarHideTimerRef.current = window.setTimeout(() => {
      topBarHideTimerRef.current = undefined;
      setTopBarOpen(false);
    }, 350);
  }, [cancelTopBarHide]);
  useEffect(() => {
    window.localStorage.setItem(UI_STORAGE_KEYS.topBarPinned, topBarPinned ? "true" : "false");
  }, [topBarPinned]);
  useEffect(() => () => {
    cancelTopBarHide();
  }, [cancelTopBarHide]);
  const [panelLayout, setPanelLayout] = useState<Record<string, number> | undefined>(() =>
    readPanelLayout(UI_STORAGE_KEYS.panelLayout)
  );
  const [filesPanelLayout, setFilesPanelLayout] = useState<Record<string, number> | undefined>(() =>
    readPanelLayout(UI_STORAGE_KEYS.filesPanelLayout)
  );
  const {
    codexCliEnabled,
    claudeCliEnabled,
    agyCliEnabled,
    auggieCliEnabled,
    clineCliEnabled,
    commandCodeCliEnabled,
    grokCliEnabled,
    museCliEnabled,
    piCliEnabled,
    opencodeCliEnabled,
    opencodeV2CliEnabled,
    cliBackendEnabled,
    cliBackendToggleError,
    handleCliBackendToggle
  } = useCliBackendPlugins(state.token);
  const [reasoningAnchor, setReasoningAnchor] = useState<HTMLElement | null>(null);
  const [agentsAnchor, setAgentsAnchor] = useState<HTMLElement | null>(null);
  const [agentReadiness, setAgentReadiness] = useState<AgentReadinessResult | null>(null);
  const [agentReadinessLoading, setAgentReadinessLoading] = useState(false);
  const [agentReadinessJsonOpen, setAgentReadinessJsonOpen] = useState(false);
  const [runtimeConfigAnchor, setRuntimeConfigAnchor] = useState<HTMLElement | null>(null);
  const [pendingMention, setPendingMention] = useState<ComposerMention | null>(null);
  const [composerSuggestion, setComposerSuggestion] = useState<{ id: string; text: string } | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  return {
    closedTaskTabIds,
    setClosedTaskTabIds,
    taskTabOrder,
    setTaskTabOrder,
    draggedTaskTabId,
    setDraggedTaskTabId,
    splitDropHandledRef,
    taskTabContextMenu,
    setTaskTabContextMenu,
    paneContextMenu,
    setPaneContextMenu,
    pendingPaneSplit,
    setPendingPaneSplit,
    splitViewMenuAnchor,
    setSplitViewMenuAnchor,
    splitViewMenuPosition,
    setSplitViewMenuPosition,
    splitViewSearch,
    setSplitViewSearch,
    splitViewBaseThreadId,
    setSplitViewBaseThreadId,
    splitView,
    setSplitView,
    workspaceLayout,
    setWorkspaceLayout,
    splitViewLayout,
    setSplitViewLayout,
    detachedTaskIds,
    setDetachedTaskIds,
    detachedTaskSnapshot,
    setDetachedTaskSnapshot,
    detachedSnapshotReady,
    setDetachedSnapshotReady,
    detachedSnapshotReadyPromiseRef,
    resolveDetachedSnapshotReadyRef,
    workspaceLayoutRef,
    splitViewRef,
    splitMutationEpochRef,
    detachedSnapshotHydratedRef,
    taskNotificationPreferences,
    setTaskNotificationPreferences,
    capacityTurnRetryEnabled,
    setCapacityTurnRetryEnabled,
    freeOllamaEnabled,
    agentRosterManagerThreadId,
    setAgentRosterManagerThreadId,
    setThreadAgentRosters,
    remoteLifecycleOverrides,
    setRemoteLifecycleOverrides,
    remoteLifecyclePendingIds,
    setRemoteLifecyclePendingIds,
    remoteBackgroundStarting,
    setRemoteBackgroundStarting,
    openWithMenuPosition,
    setOpenWithMenuPosition,
    openWithTarget,
    setOpenWithTarget,
    openWithApps,
    setOpenWithApps,
    openWithAppsLoading,
    setOpenWithAppsLoading,
    workspaceHostPlatform,
    localWorkspaceDefaultPath,
    localWorkspaceProjectsPath,
    windowsWorkspaceHost,
    freeModelAccessOpen,
    setFreeModelAccessOpen,
    freeModelAccessPromptedRef,
    freeAutoCompactBusyRef,
    freeAutoCompactCooldownRef,
    jevCompressCooldownRef,
    jevCompressWarnedRef,
    jevCompressBaselineRef,
    freeCompactionWaitersRef,
    freeCompactionContextWindowByTurnIdRef,
    contextWindowByTurnIdRef,
    pendingContextWindowByThreadRef,
    freeCompactionSourceTurnIdsRef,
    compactionSourceByTurnId,
    setCompactionSourceByTurnId,
    freeCompactBarrierRef,
    jevCompressDirectiveRef,
    freeCompactAfterTurnRef,
    freeCompactMenuAnchor,
    setFreeCompactMenuAnchor,
    installedThemePluginIds,
    setInstalledThemePluginIds,
    installThemePlugin,
    uninstallThemePlugin,
    saveCustomThemePlugin,
    removeCustomThemePlugin,
    leftPanelVisible,
    setLeftPanelVisible,
    immersiveView,
    setImmersiveView,
    immersiveTaskTabsOpen,
    setImmersiveTaskTabsOpen,
    immersiveComposerCompact,
    setImmersiveComposerCompact,
    immersiveHintSequence,
    setImmersiveHintSequence,
    immersiveExitHintOpen,
    setImmersiveExitHintOpen,
    immersiveComposerHintOpen,
    setImmersiveComposerHintOpen,
    immersiveComposerOffsetRef,
    immersiveComposerDockRef,
    immersiveComposerDragRef,
    applyImmersiveComposerOffset,
    resetImmersiveComposerOffset,
    beginImmersiveComposerDrag,
    moveImmersiveComposer,
    endImmersiveComposerDrag,
    enterImmersiveView,
    exitImmersiveView,
    mobileHistoryOpen,
    setMobileHistoryOpen,
    mobileTopMenuAnchor,
    setMobileTopMenuAnchor,
    mobileTopBarExpanded,
    setMobileTopBarExpanded,
    mobileTopBarCollapsed,
    setMobileTopBarCollapsed,
    setMobileTopBarCollapsedPersisted,
    showAssistantUsageDetails,
    setShowAssistantUsageDetails,
    waterfallDisplayMode,
    setWaterfallDisplayMode,
    chatTypography,
    setChatTypography,
    includeAutomationHistory,
    setIncludeAutomationHistory,
    includeAutomationHistoryRef,
    rightWorkspaceVisible,
    setRightWorkspaceVisible,
    rightWorkspaceTab,
    setRightWorkspaceTab,
    startCodexTurnInFlightRef,
    petDockEnabled,
    setPetDockEnabled,
    topBarPinned,
    setTopBarPinned,
    topBarOpen,
    setTopBarOpen,
    topBarHideTimerRef,
    cancelTopBarHide,
    openTopBar,
    scheduleTopBarHide,
    panelLayout,
    setPanelLayout,
    filesPanelLayout,
    setFilesPanelLayout,
    codexCliEnabled,
    claudeCliEnabled,
    agyCliEnabled,
    auggieCliEnabled,
    clineCliEnabled,
    commandCodeCliEnabled,
    grokCliEnabled,
    museCliEnabled,
    piCliEnabled,
    opencodeCliEnabled,
    opencodeV2CliEnabled,
    cliBackendEnabled,
    cliBackendToggleError,
    handleCliBackendToggle,
    reasoningAnchor,
    setReasoningAnchor,
    agentsAnchor,
    setAgentsAnchor,
    agentReadiness,
    setAgentReadiness,
    agentReadinessLoading,
    setAgentReadinessLoading,
    agentReadinessJsonOpen,
    setAgentReadinessJsonOpen,
    runtimeConfigAnchor,
    setRuntimeConfigAnchor,
    pendingMention,
    setPendingMention,
    composerSuggestion,
    setComposerSuggestion,
    welcomeDismissed,
    setWelcomeDismissed,
  };
}
