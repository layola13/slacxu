import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { setRemoteThreadForeground } from "../../state/codexClient";
import { useStableSocketSubscription } from "../connection/useStableSocketSubscription";
import { useGoalLifecycle } from "../goals/useGoalLifecycle";
import { resolveThreadWorkspace } from "../threads/editConversation";
import { useCodexConfig } from "./useCodexConfig";
import { useLoadBasics } from "./useLoadBasics";
import { useNewSessionFlow } from "./useNewSessionFlow";
import { useOfficialLogin } from "./useOfficialLogin";
import { usePreferencesSync } from "./usePreferencesSync";
import { useProvidersRuntime } from "./useProvidersRuntime";
import { useSessionBootstrap } from "./useSessionBootstrap";
import { useSettingsAndInstall } from "./useSettingsAndInstall";
import { useSideChatTabs } from "./useSideChatTabs";
import { useSocketPipeline } from "./useSocketPipeline";
import { useSshWorkspaceLifecycle } from "./useSshWorkspaceLifecycle";
import { useTerminalSessions } from "./useTerminalSessions";
import { useThreadOpening } from "./useThreadOpening";
import { useThreadsHistory } from "./useThreadsHistory";
import { useToolingPlugins } from "./useToolingPlugins";
import { useSelectTaskTab } from "./useTurnOps";
import { useWorkbenchOpsEarly } from "./useWorkbenchOps";
import { useWorkspaceFiles } from "./useWorkspaceFiles";
import { stripModelContextVariant } from "@codex-ui/shared";

import { ReasoningOption } from "../../settings/SettingsDrawer";
import { SideChatTab } from "../../components/SideChatPanel";
import { relayGroupSelectableModels } from "../../groupCollection";
import { buildCodexHistoryMarkdown, codexHistoryFilename, downloadTextFile, loadCompleteCodexHistory } from "../../historyExport";
import { reasoningOptionsForModel } from "../../modelReasoning";
import { type ModelEntry, type ThreadEntry, fetchCodeWorkspaceFile } from "../../state/codexClient";
import { openTaskTab } from "../../taskTabs";
import { type ThemePlugin } from "../../theme";
import { normalizeWorkspaceCwd, normalizeWorkspaceRoots } from "../../workspacePaths";
import { DEFAULT_CLI_BACKEND } from "../cli/cliPlugins";
import { isRunningTurnStatus, latestActionableRunningTurn, normalizeRuntimeTimestamp } from "../transcripts/topicRuntimeIndex";
import { AGY_OFFICIAL_MODELS, DEFAULT_SSH_WORKSPACE_CWD, GROK_OFFICIAL_MODELS, WorkspaceMode } from "./appConstants";
import { asRecord, errorMessage, formatErrorText } from "./appUtils";
import { resolveComposerTextGroup } from "./modelSelectionUtils";
import { normalizeSshWorkspaceCwd } from "./sshUtils";
import { conversationWorkspaceMetadata, projectWorkspaceDirectories } from "../workspace/rightWorkspaceContext";
import { type ProviderConfig, type RelayCatalogModel, expandModelContextVariants, modelChoiceDisplayName } from "@codex-ui/shared";

import type { AppProps } from "./appConstants";
import type { appReducer } from "../../app/appReducer";
import { CodexSocketClient } from "../../state/codexClient";
import type { ClientState } from "../../state/codexClient";
import type { useAccessRuntime } from "./useAccessRuntime";
import type { useTaskTabsRuntime } from "./useTaskTabsRuntime";
import type { useThreadWorkspaceRuntime } from "./useThreadWorkspaceRuntime";
import type { useSelectionRuntime } from "./useSelectionRuntime";

export function useGoalRuntime(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  themeMode: AppProps["themeMode"];
  customThemePlugins: AppProps["customThemePlugins"];
  onThemeModeChange: AppProps["onThemeModeChange"];
  onCustomThemePluginsChange: AppProps["onCustomThemePluginsChange"];
  detachedThreadId: string | null;
  access: ReturnType<typeof useAccessRuntime>;
  taskTabs: ReturnType<typeof useTaskTabsRuntime>;
  threadWorkspace: ReturnType<typeof useThreadWorkspaceRuntime>;
  selection: ReturnType<typeof useSelectionRuntime>;
}) {
  const { state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId } = input;
  const {
    authStatus,
    setAuthStatus,
    authSession,
    setAuthSession,
    setLoginError,
    setLoginSubmitting,
    setConnectionStatus,
    setConnectionEpoch,
    cliPrerequisitesBlocked,
    setDangerBypassConfirmed,
    dangerDialogIntent,
    setDangerDialogIntent,
    setDangerDialogAcknowledged,
    settingAssistantProviderId,
    setSettingAssistantProviderId,
    settingAssistantModel,
    setSettingAssistantModel,
    workspaceMode,
    setWorkspaceMode,
    setWorkspaceAgentsBusy,
    cwd,
    setCwd,
    additionalRoots,
    setAdditionalRoots,
    workspaceFilePath,
    setWorkspaceFilePath,
    workspacePickerOpen,
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
    setSshPreflightIssue,
    setSshInstallConfirming,
    setSshInstallBusy,
    setSshInstallError,
    setWorkspaceCreateBusy,
    localWorkspaceInfo,
    setLocalWorkspaceInfo,
    setNewChatSetupOpen,
    newChatBudgetLimit,
    setNewChatBudgetLimit,
    setSlashNotice,
    setPendingAppends,
    setPendingAcceptedThreads,
    setPendingNewConversationCount,
    pendingSendGateRef,
    interruptTurnGateRef,
    turnRetryStateRef,
    applyTurnRetryState,
    modelCapacityRetryRef,
    lastCodexActivityAtRef,
    threadUsagePublishTimerRef,
    threadUsagePublishBusyRef,
    threadUsagePublishPendingRef,
    usageStore,
    flushThreadTokenUsage,
    setThreadLoadProgress,
    historyLoading,
    setHistoryLoading,
    setHistoryLoadProgress,
    historyDateRange,
    setHistoryDateRange,
    historyViewMode,
    setHistoryViewMode,
    historyBackendFilter,
    historyBackendFilterUserTouchedRef,
    setThreadHistoryPages,
    allHistoryThreadsRef,
    historySearchTermRef,
    historyLoadRequestRef,
    historyFullyLoadedRef,
    initialHistoryListStartedRef,
    threadHistoryPagesRef,
  } = input.access;
  const {
    setClosedTaskTabIds,
    setTaskTabOrder,
    splitView,
    setSplitView,
    workspaceLayout,
    setWorkspaceLayout,
    splitViewLayout,
    setSplitViewLayout,
    detachedSnapshotReadyPromiseRef,
    workspaceLayoutRef,
    splitMutationEpochRef,
    detachedSnapshotHydratedRef,
    taskNotificationPreferences,
    capacityTurnRetryEnabled,
    setCapacityTurnRetryEnabled,
    freeOllamaEnabled,
    setThreadAgentRosters,
    setRemoteLifecycleOverrides,
    setOpenWithMenuPosition,
    setOpenWithTarget,
    setOpenWithApps,
    setOpenWithAppsLoading,
    workspaceHostPlatform,
    localWorkspaceDefaultPath,
    freeCompactionWaitersRef,
    freeCompactionContextWindowByTurnIdRef,
    contextWindowByTurnIdRef,
    pendingContextWindowByThreadRef,
    freeCompactionSourceTurnIdsRef,
    setCompactionSourceByTurnId,
    freeCompactAfterTurnRef,
    installedThemePluginIds,
    setInstalledThemePluginIds,
    leftPanelVisible,
    setLeftPanelVisible,
    showAssistantUsageDetails,
    setShowAssistantUsageDetails,
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
    panelLayout,
    setPanelLayout,
    filesPanelLayout,
    setFilesPanelLayout,
    codexCliEnabled,
    setPendingMention,
    setComposerSuggestion,
    setWelcomeDismissed,
  } = input.taskTabs;
  const {
    fileTabs,
    rightWorkspaceRequestEpochRef,
    optimisticThreadIdsRef,
    threadSelectionEpochRef,
    activeThreadIdRef,
    providersRef,
    cwdForThreadRef,
    clientRef,
    activatedProviderSelectionRef,
    turnsRef,
    turnsByThreadIdRef,
    writerConflictThreadIdsRef,
    threadLoadQueueRef,
    hasOpenedSocketRef,
    planContinuationTimersRef,
    taskNotificationTrackerRef,
    startCodexTurnRef,
    suppressThreadAutoNudge,
    resumeThreadAutoNudge,
    enqueueTokenUsage,
    transcriptRuntime,
    topicTranscriptStore,
    enablePlanAutoContinuation,
  } = input.threadWorkspace;
  const {
    threadRuntimeSelections,
    imageRuntimeSelections,
    runtimeSelection,
    imageRuntimeSelection,
    selectedModelRef,
    selectionForThread,
    historySelectionForThread,
    hydrateRuntimePreferences,
    updateRuntimeSelection,
    updateRuntimeSelectionAndPersist,
    updateNewConversationRuntimeSelection,
    patchThreadRuntimeSelection,
    setSelectedModel,
    setReasoningEffort,
    setActiveProviderId,
    setActiveGroupId,
    setRuntimePermission,
    updateImageRuntimeSelection,
    loadPersistedThreadRuntimeSelection,
    persistThreadRuntimeSelection,
    awaitThreadRuntimePersistence,
    setThreadRuntimePersistencePaused,
    selectedModel,
    isClaudeBackend,
    isAgyBackend,
    isGrokBackend,
    isPiBackend,
    isOpencodeBackend,
    reasoningEffort,
    fastModeEnabled,
    permission,
    dangerBypassPermissionConfirmed,
    activeProviderId,
    activeGroupId,
    freebuffSession,
    setFreebuffSwitchDialogOpen,
    setFreebuffSwitchTargetModel,
    freebuffAutoFailover,
    setFreebuffFallbackSuggestion,
    refreshFreebuffSession,
    newChatDefaultsAppliedRef,
    locale,
    setLocale,
    t,
    translateRef,
    checkCodexCliUpdate,
    handleSessionExpired,
    recoverOrExpireSession,
  } = input.selection;
  const client = useMemo(() => {
    const socketClient = new CodexSocketClient();
    clientRef.current = socketClient;
    return socketClient;
  }, []);
  const {
    goals: threadGoals,
    resumePrompt: goalResumePrompt,
    resumeSubmitting: goalResumeSubmitting,
    handleNotification: handleGoalNotification,
    loadThreadGoal,
    freezeActiveGoalBeforeResume,
    promptResume: promptGoalResume,
    resetResume: resetGoalResume,
    setGoal: setThreadGoal,
    setGoalStatus: setActiveGoalStatus,
    confirmResume: confirmGoalResume,
    pauseResume: pauseGoalResume,
    cancelActiveGoal,
    clearActiveGoal,
    discardThreadGoal
  } = useGoalLifecycle({
    client,
    activeThreadId: state.activeThreadId,
    getTurns: () => turnsRef.current,
    startContinuation: (prompt: string, onTurnStarted: (threadId: string, turnId: string) => void) => startCodexTurnRef.current(prompt, [], [], {
      collaborationMode: "default",
      forceNewTurn: true,
      preserveText: true,
      suppressUserMessage: true,
      awaitTurnStarted: true,
      onTurnStarted
    }),
    reportError: (message: string) => dispatch({ type: "error", message })
  });
  const { cwdForThread, publishThreadTokenUsage, sendWindowsTaskNotification, showOpenWithMenu, selectOpenWithTarget } = useWorkbenchOpsEarly({ state, dispatch, client, t, activeProviderId, activeGroupId, activeThreadIdRef, allHistoryThreadsRef, cwd, sshCommand, sshCwd, workspaceMode, workspacePickerPath, workspaceNewFolderName, setWorkspaceNewFolderName, workspaceHostPlatform, localWorkspaceInfo, localWorkspaceDefaultPath, runtimeSelection, fileTabs, rightWorkspaceRequestEpochRef, usageStore, threadUsagePublishTimerRef, threadUsagePublishBusyRef, threadUsagePublishPendingRef, flushThreadTokenUsage, taskNotificationPreferences, setOpenWithApps, setOpenWithAppsLoading, setOpenWithMenuPosition, setRightWorkspaceVisible, setWorkspaceCreateBusy, setWorkspacePickerPath, setOpenWithTarget });
  const { verifySshWorkspaceBeforeCreate, recheckSshWorkspace, installSshCodex } = useSshWorkspaceLifecycle({ state, dispatch, t, workspaceMode, cwdForThread, sshCommand, sshCwd, setSshPreflightIssue, setSshInstallConfirming, setSshInstallBusy, setSshInstallError });
  cwdForThreadRef.current = cwdForThread;
  const activeWorkspaceThread = conversationWorkspaceMetadata(
    state.activeThreadId,
    state.threads,
    allHistoryThreadsRef.current
  );
  const activeWorkspace = resolveThreadWorkspace(activeWorkspaceThread, {
    workspaceMode,
    sshCommand,
    localCwd: normalizeWorkspaceCwd(cwd) || localWorkspaceDefaultPath,
    sshCwd: normalizeSshWorkspaceCwd(sshCwd) || DEFAULT_SSH_WORKSPACE_CWD
  });
  const activeWorkspaceCwd = activeWorkspace.cwd;
  const {
    sideChatTabs,
    setSideChatTabs,
    activeSideChatId,
    setActiveSideChatId,
    sideChatError,
    setSideChatError,
    sideChatSequenceRef,
    sideChatInFlightRef,
    addSideChatTab,
    closeSideChatTab,
    changeSideChatDraft,
    changeSideChatModel,
    toggleSideChatWebSearch,
    removeSideChatAttachment,
    attachSideChatFiles,
    createSideChatImage,
  } = useSideChatTabs({
    token: state.token,
    activeWorkspaceCwd,
    providers: state.providers,
    activeProviderId,
    activeGroupId,
    selectedModel,
    selectionForThread,
    setRightWorkspaceTab,
    setRightWorkspaceVisible,
  });
  const activeWorkspaceMode = activeWorkspace.workspaceMode;
  const activeWorkspaceSshCommand = activeWorkspace.sshCommand;
  const activeWorkspaceAdditionalRoots = normalizeWorkspaceRoots(
    activeWorkspaceCwd,
    additionalRoots
  );
  const activeWorkspaceSshCwd = activeWorkspaceMode === "ssh"
    ? activeWorkspaceThread?.sshCwd?.trim() || activeWorkspaceThread?.cwd?.trim() || activeWorkspaceCwd
    : "";
  const { fileDirectories, setFileDirectories, workspacePickerLoadingKey, setWorkspacePickerLoadingKey, readDirectoryInContext, readDirectory, readFile, changeOpenFileContent, saveOpenFile } = useWorkspaceFiles({ state, client, dispatch, cwd, workspaceMode, sshCommand, fileTabs, rightWorkspaceVisible, rightWorkspaceRequestEpochRef, workspacePickerOpen });
  const activeWorkspaceDirectories = useMemo(
    () => projectWorkspaceDirectories(fileDirectories, activeWorkspaceMode, activeWorkspaceSshCommand),
    [activeWorkspaceMode, activeWorkspaceSshCommand, fileDirectories]
  );

  useEffect(() => {
    rightWorkspaceRequestEpochRef.current += 1;
    fileTabs.resetTabs();
  }, [activeWorkspaceCwd, activeWorkspaceMode, activeWorkspaceSshCommand]);

  useEffect(() => {
    if (rightWorkspaceVisible) return;
    rightWorkspaceRequestEpochRef.current += 1;
    fileTabs.resetTabs();
  }, [rightWorkspaceVisible]);


  useEffect(() => {
    try {
      localStorage.removeItem("codex-ultra.show-launch-history");
    } catch {}
    includeAutomationHistoryRef.current = includeAutomationHistory;
  }, [includeAutomationHistory]);

  useEffect(() => {
    if (!rightWorkspaceVisible || rightWorkspaceTab !== "sidechat") {
      return;
    }
    const hasActive = sideChatTabs.some((tab: SideChatTab) => tab.id === activeSideChatId);
    if (!hasActive && sideChatTabs[0]) {
      setActiveSideChatId(sideChatTabs[0].id);
    }
  }, [activeSideChatId, rightWorkspaceTab, rightWorkspaceVisible, sideChatTabs]);



  const { terminalSessions, setTerminalSessions, ptyTerminals, setPtyTerminals, ptyFocusTerminalId, setPtyFocusTerminalId, appendTerminalOutput, createPtyTerminal, runTerminalCommand, writeTerminalInput, terminateTerminal, resizeTerminal, writePtyTerminal, killPtyTerminal, forgetPtyTerminal, resizePtyTerminal, loadPtyTail, openWorkspaceTerminal } = useTerminalSessions({ state, dispatch, client, t, activeWorkspaceMode, activeWorkspaceCwd, activeWorkspaceSshCommand, activeWorkspaceSshCwd, activeProviderId, activeGroupId });

  const composerModels = useMemo(() => {
    if (isAgyBackend && (!activeProviderId || activeProviderId === "agy-official")) {
      return AGY_OFFICIAL_MODELS;
    }
    if (isGrokBackend && (!activeProviderId || activeProviderId === "grok-official")) {
      return GROK_OFFICIAL_MODELS;
    }
    const activeProvider = state.providers.find((provider: ProviderConfig) => provider.id === activeProviderId);
    if (!activeProvider) {
      return isAgyBackend ? AGY_OFFICIAL_MODELS : isGrokBackend ? GROK_OFFICIAL_MODELS : [...state.models];
    }
    const activeGroup = resolveComposerTextGroup(activeProvider, activeGroupId, selectedModel);
    const providerModels = activeGroup
      ? relayGroupSelectableModels(activeProvider, activeGroup)
      : activeProvider.nativeModels;
    const metadataByModel = new Map(state.models.map((entry: ClientState["models"][number]) => [entry.model ?? entry.id ?? "", entry]));
    return expandModelContextVariants(providerModels).map((model: string) => {
      const baseModel = stripModelContextVariant(model).baseModel;
      const metadata = metadataByModel.get(model) ?? metadataByModel.get(baseModel);
      const providerDisplayName = activeProvider.modelDisplayNames?.[model] ?? activeProvider.modelDisplayNames?.[baseModel];
      const displayName = modelChoiceDisplayName(model, providerDisplayName ?? metadata?.displayName);
      return metadata ? { ...metadata, model, displayName } : { model, displayName };
    });
  }, [activeGroupId, activeProviderId, isAgyBackend, isGrokBackend, selectedModel, state.models, state.providers]);

  useEffect(() => {
    if (!activeProviderId || composerModels.length === 0) return;
    // Historical thread metadata is restored asynchronously after the tab is
    // activated. Do not normalize an empty/default selection against the
    // currently visible provider here: that would create a revision for the
    // target thread and make its persisted model look stale.
    if (activeThreadIdRef.current) return;
    const available = composerModels.some((entry: typeof composerModels[number]) => (entry.model ?? entry.id ?? "") === selectedModel);
    if (!available) {
      const model = composerModels[0]?.model ?? composerModels[0]?.id ?? "";
      updateNewConversationRuntimeSelection({ model });
    }
  }, [activeProviderId, composerModels, selectedModel, updateNewConversationRuntimeSelection]);

  useEffect(() => {
    if (activeThreadIdRef.current) return;
    const agentModel = runtimeSelection.agents.model;
    if (!agentModel) return;
    const available = composerModels.some((entry: typeof composerModels[number]) => (entry.model ?? entry.id ?? "") === agentModel);
    if (!available) updateRuntimeSelection({ agents: { ...runtimeSelection.agents, model: "" } });
  }, [composerModels, runtimeSelection.agents, updateRuntimeSelection]);


  const { renameCliBackendFor, loadHistory, applyHistoryThreads, renameHistoryThread, archiveHistoryThread, deleteHistoryThread, markHistoryBackendLoaded, claudeHistoryLoadedRef, agyHistoryLoadedRef, grokHistoryLoadedRef, museHistoryLoadedRef, piHistoryLoadedRef, opencodeHistoryLoadedRef, opencodeV2HistoryLoadedRef, miniHistoryLoadedRef } = useThreadsHistory({ state, dispatch, client, t, historySearchTermRef, historyLoadRequestRef, historyFullyLoadedRef, allHistoryThreadsRef, includeAutomationHistoryRef, historyLoading, historyBackendFilter, setHistoryLoading, setHistoryLoadProgress, setSplitView, setWorkspaceLayout, setWelcomeDismissed, discardThreadGoal, optimisticThreadIdsRef, splitMutationEpochRef });
  return {
    client,
    threadGoals,
    goalResumePrompt,
    goalResumeSubmitting,
    handleGoalNotification,
    loadThreadGoal,
    freezeActiveGoalBeforeResume,
    promptGoalResume,
    resetGoalResume,
    setThreadGoal,
    setActiveGoalStatus,
    confirmGoalResume,
    pauseGoalResume,
    cancelActiveGoal,
    clearActiveGoal,
    discardThreadGoal,
    cwdForThread,
    publishThreadTokenUsage,
    sendWindowsTaskNotification,
    showOpenWithMenu,
    selectOpenWithTarget,
    verifySshWorkspaceBeforeCreate,
    recheckSshWorkspace,
    installSshCodex,
    activeWorkspaceThread,
    activeWorkspace,
    activeWorkspaceCwd,
    sideChatTabs,
    setSideChatTabs,
    activeSideChatId,
    setActiveSideChatId,
    sideChatError,
    setSideChatError,
    sideChatSequenceRef,
    sideChatInFlightRef,
    addSideChatTab,
    closeSideChatTab,
    changeSideChatDraft,
    changeSideChatModel,
    toggleSideChatWebSearch,
    removeSideChatAttachment,
    attachSideChatFiles,
    createSideChatImage,
    activeWorkspaceMode,
    activeWorkspaceSshCommand,
    activeWorkspaceAdditionalRoots,
    activeWorkspaceSshCwd,
    fileDirectories,
    setFileDirectories,
    workspacePickerLoadingKey,
    setWorkspacePickerLoadingKey,
    readDirectoryInContext,
    readDirectory,
    readFile,
    changeOpenFileContent,
    saveOpenFile,
    activeWorkspaceDirectories,
    terminalSessions,
    setTerminalSessions,
    ptyTerminals,
    setPtyTerminals,
    ptyFocusTerminalId,
    setPtyFocusTerminalId,
    appendTerminalOutput,
    createPtyTerminal,
    runTerminalCommand,
    writeTerminalInput,
    terminateTerminal,
    resizeTerminal,
    writePtyTerminal,
    killPtyTerminal,
    forgetPtyTerminal,
    resizePtyTerminal,
    loadPtyTail,
    openWorkspaceTerminal,
    composerModels,
    renameCliBackendFor,
    loadHistory,
    applyHistoryThreads,
    renameHistoryThread,
    archiveHistoryThread,
    deleteHistoryThread,
    markHistoryBackendLoaded,
    claudeHistoryLoadedRef,
    agyHistoryLoadedRef,
    grokHistoryLoadedRef,
    museHistoryLoadedRef,
    piHistoryLoadedRef,
    opencodeHistoryLoadedRef,
    opencodeV2HistoryLoadedRef,
    miniHistoryLoadedRef,
  };
}
