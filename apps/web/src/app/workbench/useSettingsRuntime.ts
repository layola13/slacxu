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

import type { useGoalRuntime } from "./useGoalRuntime";
export function useSettingsRuntime(input: {
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
  goals: ReturnType<typeof useGoalRuntime>;
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
    setWorkspacePickerPath,
    workspaceSelectionPending,
    setWorkspaceSelectionPending,
    sshCommand,
    setSshCommand,
    sshCwd,
    setSshCwd,
    setSshPreflightIssue,
    setSshInstallConfirming,
    setSshInstallError,
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
    usageStore,
    setThreadLoadProgress,
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
    capacityTurnRetryEnabled,
    setCapacityTurnRetryEnabled,
    freeOllamaEnabled,
    setThreadAgentRosters,
    setRemoteLifecycleOverrides,
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
    optimisticThreadIdsRef,
    threadSelectionEpochRef,
    activeThreadIdRef,
    providersRef,
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
    isOpencodeV2Backend,
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
  const {
    client,
    handleGoalNotification,
    loadThreadGoal,
    freezeActiveGoalBeforeResume,
    promptGoalResume,
    resetGoalResume,
    discardThreadGoal,
    cwdForThread,
    publishThreadTokenUsage,
    sendWindowsTaskNotification,
    verifySshWorkspaceBeforeCreate,
    setPtyTerminals,
    appendTerminalOutput,
    composerModels,
    applyHistoryThreads,
  } = input.goals;
  const { setupGuideOpen, setSetupGuideOpen, settingsOpen, setSettingsOpen, settingsSection, setSettingsSection, settingsPluginTab, setSettingsPluginTab, settingsRelayTarget, setSettingsRelayTarget, installPromptEvent, setInstallPromptEvent, appInstalled, setAppInstalled, openSettings, handleOpenCommandBlacklistSettings, finishSetupGuide, replaySetupGuide, handleInstallApp } = useSettingsAndInstall({ codexCliEnabled });
  const { preferencesReady, setPreferencesReady } = usePreferencesSync({ state, dispatch, client, t, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, authStatus, locale, setLocale, leftPanelVisible, setLeftPanelVisible, showAssistantUsageDetails, setShowAssistantUsageDetails, chatTypography, setChatTypography, includeAutomationHistory, setIncludeAutomationHistory, petDockEnabled, setPetDockEnabled, capacityTurnRetryEnabled, setCapacityTurnRetryEnabled, panelLayout, setPanelLayout, filesPanelLayout, setFilesPanelLayout, splitViewLayout, setSplitViewLayout, splitView, setSplitView, workspaceLayout, setWorkspaceLayout, workspaceLayoutRef, rightWorkspaceTab, setRightWorkspaceTab, rightWorkspaceVisible, setRightWorkspaceVisible, historyDateRange, setHistoryDateRange, historyViewMode, setHistoryViewMode, installedThemePluginIds, setInstalledThemePluginIds, threadRuntimeSelections, imageRuntimeSelections, settingAssistantProviderId, setSettingAssistantProviderId, settingAssistantModel, setSettingAssistantModel, cwd, setCwd, workspaceMode, setWorkspaceMode, sshCommand, setSshCommand, sshCwd, setSshCwd, additionalRoots, setAdditionalRoots, workspaceSelectionPending, setWorkspaceSelectionPending, setWorkspacePickerPath, localWorkspaceDefaultPath, setLocalWorkspaceInfo, setNewChatSetupOpen, setSetupGuideOpen, setLoginError, recoverOrExpireSession, freeOllamaEnabled, hydratePreferences: hydrateRuntimePreferences });
  const { loadBasics } = useLoadBasics({ state, dispatch, client, t, detachedThreadId, detachedSnapshotHydratedRef, detachedSnapshotReadyPromiseRef, codexCliEnabled, translateRef, activeThreadIdRef, allHistoryThreadsRef, historySearchTermRef, historyFullyLoadedRef, includeAutomationHistoryRef, initialHistoryListStartedRef, optimisticThreadIdsRef, threadHistoryPagesRef, transcriptRuntime, setHistoryLoading, setHistoryLoadProgress, setThreadHistoryPages, setAdditionalRoots, setCwd, setSshCommand, setSshCwd, setWorkspaceFilePath, setWorkspaceMode, setWorkspaceSelectionPending, setWelcomeDismissed });


  const { relayShareImportText, setRelayShareImportText, relayShareImportPassword, setRelayShareImportPassword, relayShareImportOpen, setRelayShareImportOpen, relayShareImportBusy, setRelayShareImportBusy, relayShareImportError, setRelayShareImportError, relayShareExportError, setRelayShareExportError, relayShareExportBusy, setRelayShareExportBusy, relayShareExportProvider, setRelayShareExportProvider, relayShareExportPassword, setRelayShareExportPassword, relayShareExportConfirm, setRelayShareExportConfirm, relayShareExportText, setRelayShareExportText, relayShareExportOpen, setRelayShareExportOpen, refreshProviders, ensureRuntimeProviderActivated, saveProvider, injectClaudeDesktop, injectCursorDesktop, syncFreeOllama, activateProvider, openRelayShareExport, createRelayShare, copyRelayShare, handleRelayShareText, importRelayShareDirectly, deleteProvider, restoreProvider, downloadProfile, uploadProfile, downloadRelayConfig, uploadRelayConfig, downloadRelayBackup, uploadRelayBackup, uploadCapabilityCatalog } = useProvidersRuntime({ state, dispatch, client, t, providersRef, activatedProviderSelectionRef, activeProviderId, activeGroupId, selectedModel, authSession, workspaceSelectionPending, settingsOpen, isClaudeBackend, isAgyBackend, isGrokBackend, loadBasics, updateRuntimeSelection, updateNewConversationRuntimeSelection, setRuntimePermission, setActiveProviderId, setActiveGroupId });

  const { codexConfig, setCodexConfig, codexConfigLoading, setCodexConfigLoading, codexConfigSaving, setCodexConfigSaving, codexConfigError, setCodexConfigError, applyLoadedCodexConfig, loadCodexConfig, writeCodexConfigField, writeCodexConfigValue } = useCodexConfig({ state, dispatch, client, t, authSession, activeThreadIdRef, selectionForThread, updateNewConversationRuntimeSelection });






  useEffect(() => {
    if (settingsOpen && state.connected && state.engine.phase === "ready") {
      void loadCodexConfig();
    }
  }, [settingsOpen, state.connected, state.engine.phase, loadCodexConfig]);

  const { pluginDetails, setPluginDetails, pluginSkillPreviews, setPluginSkillPreviews, pluginAuthNotices, setPluginAuthNotices, installingPluginIds, setInstallingPluginIds, skillExtraRoots, setSkillExtraRoots, skillPreviews, setSkillPreviews, auditEvents, setAuditEvents, mcpResourceContents, setMcpResourceContents, mcpOauthUrls, setMcpOauthUrls, loadTooling, loadAuditEvents, reloadMcp, toggleSkill, saveSkillExtraRoots, readSkillPreview, createSkill, installPlugin, uninstallPlugin, readPluginDetail, readPluginSkill, insertPluginMention, startMcpOauth, readMcpResource, callMcpTool } = useToolingPlugins({ state, dispatch, client, t, cwd, localWorkspaceDefaultPath, setPendingMention });



  const { verifySessionAfterDisconnect, completeLoginSession, acceptCurrentLegalPolicy, leaveLegalReview, handleLogin, handleLogin2fa, handleRegister } = useSessionBootstrap({ state, dispatch, client, t, authStatus, authSession, setAuthStatus, setAuthSession, setLoginError, setLoginSubmitting, refreshProviders, applyLoadedCodexConfig, loadBasics, cliPrerequisitesBlocked, checkCodexCliUpdate, clientRef, handleSessionExpired, recoverOrExpireSession });
  const { officialLoginOpen, setOfficialLoginOpen, officialLoginNotice, setOfficialLoginNotice, officialOAuthSessionsRef, startOfficialOpenAiOAuth, cancelOfficialOpenAiOAuth } = useOfficialLogin({ state, dispatch, client, t, activateProvider });
  const { handleSocketConnected, handleSocketConnectionStatus, handleSocketMessage } = useSocketPipeline({ state, dispatch, hasOpenedSocketRef, setConnectionEpoch, authStatus, verifySessionAfterDisconnect, setConnectionStatus, lastCodexActivityAtRef, handleGoalNotification, transcriptRuntime, turnsRef, activeThreadIdRef, t, activeProviderId, capacityTurnRetryEnabled, topicTranscriptStore, usageStore, providersRef, publishThreadTokenUsage, applyTurnRetryState, turnRetryStateRef, modelCapacityRetryRef, contextWindowByTurnIdRef, pendingContextWindowByThreadRef, freeCompactionContextWindowByTurnIdRef, freeCompactionSourceTurnIdsRef, freeCompactionWaitersRef, freeCompactAfterTurnRef, taskNotificationTrackerRef, startCodexTurnRef, appendTerminalOutput, enqueueTokenUsage, loadTooling, sendWindowsTaskNotification, setCompactionSourceByTurnId, setOfficialLoginNotice, setOfficialLoginOpen, setPendingAcceptedThreads, setPtyTerminals, setSplitView, setThreadAgentRosters, setWorkspaceLayout, suppressThreadAutoNudge, selectionForThread, patchThreadRuntimeSelection, setActiveProviderId, setActiveGroupId });
  useStableSocketSubscription(client, {
    onConnected: handleSocketConnected,
    onConnectionStatus: handleSocketConnectionStatus,
    onMessage: handleSocketMessage
  });


  useEffect(() => {
    if (!state.connected) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadTooling();
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [loadTooling, state.connected]);

  useEffect(() => {
    if (settingsOpen && settingsSection === "plugins" && state.connected && state.engine.phase === "ready") {
      void loadTooling({ forceSkillReload: true });
    }
  }, [loadTooling, settingsOpen, settingsSection, state.connected, state.engine.phase]);

  useEffect(() => {
    // Historical threads hydrate their model from thread runtime metadata.
    // Never seed an active thread from the process-wide model catalog while
    // that metadata is loading; doing so increments the thread revision and
    // can cause the persisted selection to be discarded as stale.
    if (activeThreadIdRef.current || selectedModel || !state.models[0]) {
      return;
    }
    setSelectedModel(state.models[0].model ?? state.models[0].id ?? "");
  }, [selectedModel, state.models, setSelectedModel]);

  const resolveComposerReasoningOptions = useCallback((model: string): ReasoningOption[] => {
    const provider = state.providers.find((entry: ProviderConfig) => entry.id === activeProviderId);
    const group = provider ? resolveComposerTextGroup(provider, activeGroupId, model) : undefined;
    const baseModel = stripModelContextVariant(model).baseModel;
    const selected = composerModels.find((entry: typeof composerModels[number]) => (entry.model ?? entry.id ?? "") === model)
      ?? composerModels.find((entry: ModelEntry) => (entry.model ?? entry.id ?? "") === baseModel);
    const catalogModel = provider?.capabilityCatalog?.data.find((entry: RelayCatalogModel) => entry.model_name === model || entry.model_name === baseModel);
    return reasoningOptionsForModel({ model, modelEntry: selected, group, catalogModel });
  }, [activeGroupId, activeProviderId, composerModels, state.providers]);

  const reasoningOptions = useMemo<ReasoningOption[]>(
    () => resolveComposerReasoningOptions(selectedModel),
    [resolveComposerReasoningOptions, selectedModel]
  );
  const agentReasoningOptions = useMemo<ReasoningOption[]>(
    () => resolveComposerReasoningOptions(runtimeSelection.agents.model || selectedModel),
    [resolveComposerReasoningOptions, runtimeSelection.agents.model, selectedModel]
  );

  useEffect(() => {
    // As with model selection, an active historical thread must not have its
    // persisted reasoning setting replaced by the currently visible model's
    // fallback while the thread metadata is still being restored.
    if (activeThreadIdRef.current) return;
    if (reasoningOptions.length > 0 && !reasoningOptions.some((option: ReasoningOption) => option.value === reasoningEffort)) {
      const fallback = reasoningOptions[Math.min(2, reasoningOptions.length - 1)];
      if (fallback) {
        setReasoningEffort(fallback.value);
      }
    }
  }, [reasoningEffort, reasoningOptions]);


  const { loadOlderThreadHistory, loadThread, loadThreadIntoCache, loadThreadMetadata, loadInitialThreadPage, updateThreadLoadProgress } = useThreadOpening({ state, dispatch, client, t, threadHistoryPagesRef, setThreadHistoryPages, activeThreadIdRef, threadSelectionEpochRef, threadLoadQueueRef, optimisticThreadIdsRef, transcriptRuntime, topicTranscriptStore, splitMutationEpochRef, setWorkspaceSelectionPending, setWorkspaceMode, setWorkspaceFilePath, setCwd, setAdditionalRoots, setSshCommand, setSshCwd, setThreadLoadProgress, setRemoteLifecycleOverrides, setWelcomeDismissed, providersRef, usageStore, publishThreadTokenUsage, loadThreadGoal, discardThreadGoal, workspaceLayout, splitView, historySelectionForThread, updateImageRuntimeSelection, loadPersistedThreadRuntimeSelection });





  const { applyWorkspaceVmPolicyForCwd, handleSelectRecentWorkspace, persistPermissionForActiveThread, openExistingThread, beginNewSession, requestNewSession, persistWorkspaceForActiveThread, requestPermissionChange, ensureWorkspaceAgents, applyWorkspaceSelectionFromDialog, confirmWorkspaceSelection, closeDangerDialog, confirmDangerDialog, useSaferModeFromDangerDialog, selectProviderForCurrentThread } = useNewSessionFlow({  state, authSession, imageRuntimeSelection, dispatch, client, t, runtimeSelection, workspaceMode, cwd, sshCommand, additionalRoots, workspaceFilePath, workspaceSelectionPending, localWorkspaceDefaultPath, activeProviderId, activeGroupId, selectedModel, reasoningEffort, reasoningOptions, permission, isClaudeBackend, isAgyBackend, isGrokBackend, isPiBackend, isOpencodeBackend, isOpencodeV2Backend, fastModeEnabled, dangerBypassPermissionConfirmed, enablePlanAutoContinuation, codexConfig, freebuffSession, freebuffAutoFailover, refreshFreebuffSession, ensureRuntimeProviderActivated, refreshProviders, applyHistoryThreads, loadAuditEvents, resumeThreadAutoNudge, cwdForThread, activeThreadIdRef, allHistoryThreadsRef, turnsRef, activatedProviderSelectionRef, pendingSendGateRef, interruptTurnGateRef, startCodexTurnInFlightRef, planContinuationTimersRef, writerConflictThreadIdsRef, contextWindowByTurnIdRef, pendingContextWindowByThreadRef, optimisticThreadIdsRef, splitMutationEpochRef, topicTranscriptStore, setPendingAppends, setPendingAcceptedThreads, setClosedTaskTabIds, setTaskTabOrder, setSplitView, setWorkspaceLayout, setComposerSuggestion, setDangerDialogAcknowledged, setDangerDialogIntent, setFreebuffFallbackSuggestion, setFreebuffSwitchDialogOpen, setFreebuffSwitchTargetModel, setNewChatSetupOpen, setOfficialLoginNotice, setOfficialLoginOpen, setPendingNewConversationCount, setSlashNotice, setSshInstallConfirming, setSshInstallError, setSshPreflightIssue, selectionForThread, historySelectionForThread, updateRuntimeSelection, updateImageRuntimeSelection, setThreadRuntimePersistencePaused, awaitThreadRuntimePersistence, patchThreadRuntimeSelection, persistThreadRuntimeSelection, loadPersistedThreadRuntimeSelection, updateNewConversationRuntimeSelection, setSelectedModel , dangerDialogIntent, setWorkspaceSelectionPending, setWorkspaceMode, setCwd, setSshCommand, setSshCwd, setAdditionalRoots, setWorkspaceFilePath, setWorkspacePickerPath, setWelcomeDismissed, setThreadLoadProgress, setDangerBypassConfirmed, threadSelectionEpochRef, newChatDefaultsAppliedRef, selectedModelRef, historyBackendFilterUserTouchedRef, verifySshWorkspaceBeforeCreate, historyBackendFilter, loadThread, newChatBudgetLimit, setNewChatBudgetLimit, localWorkspaceInfo, workspaceHostPlatform, updateThreadLoadProgress, setWorkspaceAgentsBusy, updateRuntimeSelectionAndPersist, setRuntimePermission, sshCwd, loadThreadGoal, freezeActiveGoalBeforeResume, promptGoalResume, resetGoalResume });
  const { selectTaskTab } = useSelectTaskTab({ state, dispatch, client, t, activeThreadIdRef, allHistoryThreadsRef, cwdForThread, loadThreadIntoCache, localWorkspaceDefaultPath, modelCapacityRetryRef, openExistingThread, setClosedTaskTabIds, setTaskTabOrder, setSplitView, setWorkspaceLayout, setCwd, setWorkspaceMode, setWorkspaceFilePath, setWorkspacePickerPath, setWorkspaceSelectionPending, setNewChatSetupOpen, setNewChatBudgetLimit, setThreadLoadProgress, setWelcomeDismissed, splitMutationEpochRef, sshCommand, workspaceMode, suppressThreadAutoNudge, threadSelectionEpochRef, topicTranscriptStore, transcriptRuntime, turnsByThreadIdRef, historySelectionForThread, loadPersistedThreadRuntimeSelection, updateNewConversationRuntimeSelection });










  // When a local .code-workspace file sits beside (or is otherwise associated
  // with) the working directory, fold any folders it declares beyond the cwd
  // into the "additional writable directories" so edits to the workspace file
  // take effect without manually re-opening it through the picker. The first
  // folder stays the cwd, the rest become additional roots — matching how the
  // picker already imports them. Best-effort and fire-and-forget: a missing or
  // unreadable workspace file simply leaves the existing roots untouched.


  useEffect(() => {
    if (!detachedThreadId || !state.connected || state.activeThreadId !== detachedThreadId) return;
    void loadThreadGoal(detachedThreadId);
  }, [detachedThreadId, loadThreadGoal, state.activeThreadId, state.connected]);










  useEffect(() => {
    if (state.token) {
      void loadAuditEvents();
    }
  }, [loadAuditEvents, state.token]);


  return {
    setupGuideOpen,
    setSetupGuideOpen,
    settingsOpen,
    setSettingsOpen,
    settingsSection,
    setSettingsSection,
    settingsPluginTab,
    setSettingsPluginTab,
    settingsRelayTarget,
    setSettingsRelayTarget,
    installPromptEvent,
    setInstallPromptEvent,
    appInstalled,
    setAppInstalled,
    openSettings,
    handleOpenCommandBlacklistSettings,
    finishSetupGuide,
    replaySetupGuide,
    handleInstallApp,
    preferencesReady,
    setPreferencesReady,
    loadBasics,
    relayShareImportText,
    setRelayShareImportText,
    relayShareImportPassword,
    setRelayShareImportPassword,
    relayShareImportOpen,
    setRelayShareImportOpen,
    relayShareImportBusy,
    setRelayShareImportBusy,
    relayShareImportError,
    setRelayShareImportError,
    relayShareExportError,
    setRelayShareExportError,
    relayShareExportBusy,
    setRelayShareExportBusy,
    relayShareExportProvider,
    setRelayShareExportProvider,
    relayShareExportPassword,
    setRelayShareExportPassword,
    relayShareExportConfirm,
    setRelayShareExportConfirm,
    relayShareExportText,
    setRelayShareExportText,
    relayShareExportOpen,
    setRelayShareExportOpen,
    refreshProviders,
    ensureRuntimeProviderActivated,
    saveProvider,
    injectClaudeDesktop,
    injectCursorDesktop,
    syncFreeOllama,
    activateProvider,
    openRelayShareExport,
    createRelayShare,
    copyRelayShare,
    handleRelayShareText,
    importRelayShareDirectly,
    deleteProvider,
    restoreProvider,
    downloadProfile,
    uploadProfile,
    downloadRelayConfig,
    uploadRelayConfig,
    downloadRelayBackup,
    uploadRelayBackup,
    uploadCapabilityCatalog,
    codexConfig,
    setCodexConfig,
    codexConfigLoading,
    setCodexConfigLoading,
    codexConfigSaving,
    setCodexConfigSaving,
    codexConfigError,
    setCodexConfigError,
    applyLoadedCodexConfig,
    loadCodexConfig,
    writeCodexConfigField,
    writeCodexConfigValue,
    pluginDetails,
    setPluginDetails,
    pluginSkillPreviews,
    setPluginSkillPreviews,
    pluginAuthNotices,
    setPluginAuthNotices,
    installingPluginIds,
    setInstallingPluginIds,
    skillExtraRoots,
    setSkillExtraRoots,
    skillPreviews,
    setSkillPreviews,
    auditEvents,
    setAuditEvents,
    mcpResourceContents,
    setMcpResourceContents,
    mcpOauthUrls,
    setMcpOauthUrls,
    loadTooling,
    loadAuditEvents,
    reloadMcp,
    toggleSkill,
    saveSkillExtraRoots,
    readSkillPreview,
    createSkill,
    installPlugin,
    uninstallPlugin,
    readPluginDetail,
    readPluginSkill,
    insertPluginMention,
    startMcpOauth,
    readMcpResource,
    callMcpTool,
    verifySessionAfterDisconnect,
    completeLoginSession,
    acceptCurrentLegalPolicy,
    leaveLegalReview,
    handleLogin,
    handleLogin2fa,
    handleRegister,
    officialLoginOpen,
    setOfficialLoginOpen,
    officialLoginNotice,
    setOfficialLoginNotice,
    officialOAuthSessionsRef,
    startOfficialOpenAiOAuth,
    cancelOfficialOpenAiOAuth,
    handleSocketConnected,
    handleSocketConnectionStatus,
    handleSocketMessage,
    resolveComposerReasoningOptions,
    reasoningOptions,
    agentReasoningOptions,
    loadOlderThreadHistory,
    loadThread,
    loadThreadIntoCache,
    loadThreadMetadata,
    loadInitialThreadPage,
    updateThreadLoadProgress,
    applyWorkspaceVmPolicyForCwd,
    handleSelectRecentWorkspace,
    persistPermissionForActiveThread,
    openExistingThread,
    beginNewSession,
    requestNewSession,
    persistWorkspaceForActiveThread,
    requestPermissionChange,
    ensureWorkspaceAgents,
    applyWorkspaceSelectionFromDialog,
    confirmWorkspaceSelection,
    closeDangerDialog,
    confirmDangerDialog,
    useSaferModeFromDangerDialog,
    selectProviderForCurrentThread,
    selectTaskTab,
  };
}
