import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { resolveContextWindowOverrideUpdate } from "../../contextUsage";
import { themePlugins, themeVisualTuning } from "../../theme";
import { safeThemeAssetUrl, safeThemeVideoUrl, stringValue } from "./appUtils";
import { resolveSelectedModel, resolveTextRuntimeGroupId } from "./modelSelectionUtils";
import { useComposerAssists } from "./useComposerAssists";
import { useComposerPipeline } from "./useComposerPipeline";
import { useComposerSend } from "./useComposerSend";
import { useComposerThreadStart } from "./useComposerThreadStart";
import { useFreeCompaction } from "../../free/useFreeCompaction";
import { useProviderTest } from "./useProviderTest";
import { useTurnOps } from "./useTurnOps";
import { useWorkbenchOps } from "./useWorkbenchOps";
import { useWorkspaceGitFiles } from "./useWorkspaceGitFiles";
import { workspaceDirectoryCacheKey } from "../workspace/rightWorkspaceContext";
import { resolveModelContextWindow, stripModelContextVariant } from "@codex-ui/shared";

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
import type { useSettingsRuntime } from "./useSettingsRuntime";
export function useComposerRuntime(input: {
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
  settings: ReturnType<typeof useSettingsRuntime>;
}) {
  const { state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId } = input;
  const {
    authSession,
    setDangerBypassConfirmed,
    setDangerDialogIntent,
    setDangerDialogAcknowledged,
    workspaceMode,
    setWorkspaceMode,
    cwd,
    setCwd,
    additionalRoots,
    setAdditionalRoots,
    workspaceFilePath,
    setWorkspaceFilePath,
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
    sshCwd,
    setSshPreflightIssue,
    setSshInstallConfirming,
    setSshInstallError,
    setWorkspaceCreateBusy,
    localWorkspaceInfo,
    setNewChatSetupOpen,
    setNewChatBudgetLimit,
    planImplementationPrompt,
    setPlanImplementationPrompt,
    handledPlanImplementationIdsRef,
    setStatsPanelScope,
    setSlashNotice,
    setFreeModelNotice,
    setPendingAppends,
    setPendingAcceptedThreads,
    setPendingNewConversationCount,
    pendingSendGateRef,
    interruptTurnGateRef,
    modelCapacityRetryRef,
    threadTokenUsage,
    usageStore,
    setThreadLoadProgress,
    setHistorySearchTerm,
    allHistoryThreadsRef,
  } = input.access;
  const {
    setClosedTaskTabIds,
    setTaskTabOrder,
    setSplitView,
    setWorkspaceLayout,
    splitMutationEpochRef,
    remoteBackgroundStarting,
    setRemoteBackgroundStarting,
    setOpenWithTarget,
    workspaceHostPlatform,
    localWorkspaceDefaultPath,
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
    setCompactionSourceByTurnId,
    freeCompactBarrierRef,
    jevCompressDirectiveRef,
    freeCompactAfterTurnRef,
    setLeftPanelVisible,
    rightWorkspaceVisible,
    setRightWorkspaceVisible,
    setRightWorkspaceTab,
    startCodexTurnInFlightRef,
    setComposerSuggestion,
    setWelcomeDismissed,
  } = input.taskTabs;
  const {
    fileTabs,
    openFile,
    rightWorkspaceRequestEpochRef,
    optimisticThreadIdsRef,
    threadSelectionEpochRef,
    freeModelRefreshRef,
    freeModelRefreshedTokenRef,
    freeModelStartupRefreshedRef,
    activeThreadIdRef,
    providersRef,
    activatedProviderSelectionRef,
    turnsRef,
    turnsByThreadIdRef,
    writerConflictThreadIdsRef,
    connectedRef,
    pendingRequestsRef,
    autoContinuePlanThreadsRef,
    handledPlanTurnIdsRef,
    planContinuationTimersRef,
    planContinuationInFlightRef,
    imageJobsRef,
    startCodexTurnRef,
    suppressThreadAutoNudge,
    resumeThreadAutoNudge,
    transcriptRuntime,
    topicTranscriptStore,
    disablePlanAutoContinuation,
    enablePlanAutoContinuation,
  } = input.threadWorkspace;
  const {
    runtimeSelection,
    imageRuntimeSelection,
    selectionForThread,
    historySelectionForThread,
    updateRuntimeSelection,
    updateNewConversationRuntimeSelection,
    patchThreadRuntimeSelection,
    setSelectedModel,
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
    isMiniBackend,
    reasoningEffort,
    fastModeEnabled,
    planModeEnabled,
    planModeEnabledRef,
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
    t,
  } = input.selection;
  const {
    client,
    threadGoals,
    setThreadGoal,
    setActiveGoalStatus,
    clearActiveGoal,
    cwdForThread,
    publishThreadTokenUsage,
    activeWorkspaceCwd,
    sideChatTabs,
    setSideChatTabs,
    setSideChatError,
    sideChatInFlightRef,
    activeWorkspaceMode,
    activeWorkspaceSshCommand,
    fileDirectories,
    setFileDirectories,
    readDirectoryInContext,
    readDirectory,
    terminalSessions,
    setTerminalSessions,
    runTerminalCommand,
    composerModels,
    renameCliBackendFor,
    applyHistoryThreads,
  } = input.goals;
  const {
    settingsOpen,
    setSettingsOpen,
    openSettings,
    refreshProviders,
    ensureRuntimeProviderActivated,
    activateProvider,
    codexConfig,
    loadAuditEvents,
    setOfficialLoginOpen,
    setOfficialLoginNotice,
    officialOAuthSessionsRef,
    reasoningOptions,
    loadThread,
    loadThreadIntoCache,
    openExistingThread,
    requestNewSession,
    persistWorkspaceForActiveThread,
    selectTaskTab,
  } = input.settings;
  const composerCore = { state, authSession, imageRuntimeSelection, dispatch, client, t, runtimeSelection, workspaceMode, cwd, sshCommand, additionalRoots, workspaceFilePath, workspaceSelectionPending, localWorkspaceDefaultPath, activeProviderId, activeGroupId, selectedModel, reasoningEffort, reasoningOptions, permission, isClaudeBackend, isAgyBackend, isGrokBackend, isPiBackend, isOpencodeBackend, isOpencodeV2Backend, fastModeEnabled, dangerBypassPermissionConfirmed, enablePlanAutoContinuation, codexConfig, freebuffSession, freebuffAutoFailover, refreshFreebuffSession, ensureRuntimeProviderActivated, refreshProviders, applyHistoryThreads, loadAuditEvents, resumeThreadAutoNudge, cwdForThread, activeThreadIdRef, allHistoryThreadsRef, turnsRef, activatedProviderSelectionRef, pendingSendGateRef, interruptTurnGateRef, startCodexTurnInFlightRef, planContinuationTimersRef, writerConflictThreadIdsRef, contextWindowByTurnIdRef, pendingContextWindowByThreadRef, optimisticThreadIdsRef, splitMutationEpochRef, topicTranscriptStore, setPendingAppends, setPendingAcceptedThreads, setClosedTaskTabIds, setTaskTabOrder, setSplitView, setWorkspaceLayout, setComposerSuggestion, setDangerDialogAcknowledged, setDangerDialogIntent, setFreebuffFallbackSuggestion, setFreebuffSwitchDialogOpen, setFreebuffSwitchTargetModel, setNewChatSetupOpen, setOfficialLoginNotice, setOfficialLoginOpen, setPendingNewConversationCount, setSlashNotice, setSshInstallConfirming, setSshInstallError, setSshPreflightIssue, selectionForThread, historySelectionForThread, updateRuntimeSelection, updateImageRuntimeSelection, setThreadRuntimePersistencePaused, awaitThreadRuntimePersistence, patchThreadRuntimeSelection, persistThreadRuntimeSelection, loadPersistedThreadRuntimeSelection, updateNewConversationRuntimeSelection, setSelectedModel };
  const { ensureActiveThread, recordInterruptRetry, interruptTurn } = useComposerThreadStart(composerCore);





  const { startCodexTurn } = useComposerPipeline({ ...composerCore, ensureActiveThread, interruptTurn });
  const { pendingCodexProviderTest, setPendingCodexProviderTest, testProviderWithCodex } = useProviderTest({ state, dispatch, client, t, activateProvider, setSettingsOpen, setWorkspaceMode, setWorkspaceSelectionPending, setWelcomeDismissed, splitMutationEpochRef, setWorkspaceLayout, setSplitView, startCodexTurn, reasoningOptions, reasoningEffort, settingsOpen, workspaceSelectionPending, activeProviderId, setRuntimePermission, updateNewConversationRuntimeSelection, setDangerBypassConfirmed });

  startCodexTurnRef.current = startCodexTurn;

  const { schedulePlanContinuation, stayInPlanMode, implementApprovedPlan, setGoalForActiveThread, renameActiveThread, startReview, showDiffToRemote, compactActiveThread, resumeThreadFromSlash, runImageCommand, answerRequest, respondToServerRequest } = useComposerAssists({ ...composerCore, startCodexTurn, disablePlanAutoContinuation, planModeEnabled, planModeEnabledRef, planImplementationPrompt, setPlanImplementationPrompt, autoContinuePlanThreadsRef, handledPlanTurnIdsRef, handledPlanImplementationIdsRef, planContinuationInFlightRef, transcriptRuntime, connectedRef, pendingRequestsRef, threadGoals, setThreadGoal, clearActiveGoal, setActiveGoalStatus, loadThread, loadThreadIntoCache, openSettings, requestNewSession, setHistorySearchTerm, setLeftPanelVisible, setStatsPanelScope, setWelcomeDismissed, startCodexTurnRef, imageJobsRef, renameCliBackendFor, providersRef, ensureActiveThread, isMiniBackend });



  useEffect(() => {
    const activate = (event: Event) => {
      const threadId = stringValue(asRecord((event as CustomEvent).detail).threadId);
      if (threadId) selectTaskTab(threadId);
    };
    window.addEventListener("codex-ultra:workbench-activate", activate);
    return () => window.removeEventListener("codex-ultra:workbench-activate", activate);
  }, [selectTaskTab]);











  const { handleComposerSlashCommand, sendPrompt, steerPrompt, sendSideChatPrompt } = useComposerSend({ ...composerCore, startCodexTurn, ensureActiveThread, planModeEnabled, isMiniBackend, resumeThreadFromSlash, compactActiveThread, startReview, runImageCommand, renameActiveThread, setGoalForActiveThread, showDiffToRemote, sideChatTabs, setSideChatTabs, setSideChatError, sideChatInFlightRef, setRightWorkspaceTab, setRightWorkspaceVisible, threadTokenUsage, transcriptRuntime, setActiveGoalStatus, disablePlanAutoContinuation, threadGoals, setWelcomeDismissed, setStatsPanelScope, requestNewSession, openSettings, clearActiveGoal, providersRef, freeCompactBarrierRef, jevCompressDirectiveRef });











  const configuredContextModel = resolveSelectedModel(state.providers, activeProviderId, selectedModel, activeGroupId);
  const configuredContextProvider = state.providers.find((provider: ProviderConfig) => provider.id === activeProviderId);
  const configuredContextGroupId = resolveTextRuntimeGroupId(state.providers, activeProviderId, activeGroupId, configuredContextModel);
  const configuredContextGroup = configuredContextProvider?.groups?.find((group: NonNullable<ProviderConfig["groups"]>[number]) => group.id === configuredContextGroupId && group.kind !== "image");
  const configuredContextWindow = resolveModelContextWindow(
    configuredContextModel,
    configuredContextGroup?.modelCapabilities?.[configuredContextModel]
      ?? configuredContextGroup?.modelCapabilities?.[stripModelContextVariant(configuredContextModel).baseModel],
    configuredContextGroup?.contextWindow
  ) ?? null;
  const activeConversationThread = state.activeThreadId
    ? state.threads.find((thread: ClientState["threads"][number]) => thread.id === state.activeThreadId)
      ?? allHistoryThreadsRef.current.find((thread: ThreadEntry) => thread.id === state.activeThreadId)
    : undefined;
  const displayedContextProviderId = runtimeSelection.providerId ?? activeConversationThread?.modelProvider ?? null;
  const displayedContextModel = runtimeSelection.model || activeConversationThread?.model || "";
  const displayedContextProvider = state.providers.find((provider: ProviderConfig) => provider.id === displayedContextProviderId);
  const displayedContextGroupId = resolveTextRuntimeGroupId(
    state.providers,
    displayedContextProviderId,
    runtimeSelection.groupId,
    displayedContextModel
  );
  const displayedContextGroup = displayedContextProvider?.groups?.find(
    (group: NonNullable<ProviderConfig["groups"]>[number]) => group.id === displayedContextGroupId && group.kind !== "image"
  );
  const displayedThreadContextWindow = resolveModelContextWindow(
    displayedContextModel,
    displayedContextGroup?.modelCapabilities?.[displayedContextModel]
      ?? displayedContextGroup?.modelCapabilities?.[stripModelContextVariant(displayedContextModel).baseModel],
    displayedContextGroup?.contextWindow
  ) ?? null;
  const activeComposerThreadUsage = state.activeThreadId
    ? usageStore.snapshot(state.activeThreadId).threadUsage ?? null
    : null;
  useLayoutEffect(() => {
    const threadId = state.activeThreadId;
    if (!threadId) return;
    const contextWindowUpdate = isClaudeBackend
      ? resolveContextWindowOverrideUpdate(runtimeSelection.model, configuredContextWindow)
      : undefined;
    usageStore.setContextWindow(threadId, contextWindowUpdate);
    publishThreadTokenUsage(true);
  }, [configuredContextWindow, publishThreadTokenUsage, runtimeSelection.cliBackend, runtimeSelection.model, state.activeThreadId, usageStore]);
  const { refreshFreeCompactionModels, notifyFreeModelSyncSuccess, syncOmniRouteFree, runFreeCompactionBeforeSend, runJevCompressDirective } = useFreeCompaction({ ...composerCore, freeCompactionWaitersRef, freeCompactionContextWindowByTurnIdRef, freeCompactionSourceTurnIdsRef, freeAutoCompactCooldownRef, jevCompressCooldownRef, jevCompressWarnedRef, jevCompressBaselineRef, freeAutoCompactBusyRef, freeCompactBarrierRef, jevCompressDirectiveRef, freeModelRefreshRef, freeModelRefreshedTokenRef, freeModelAccessPromptedRef, freeModelStartupRefreshedRef, setCompactionSourceByTurnId, setFreeModelAccessOpen, setFreeModelNotice, configuredContextWindow, providersRef, threadTokenUsage });


  freeCompactBarrierRef.current = runFreeCompactionBeforeSend;
  freeCompactAfterTurnRef.current = runFreeCompactionBeforeSend;

  // MVP3: jev-sub/jev-token 分流（JEV选b：注入隐藏指令 + a提醒兜底）。
  // cheap 仍走上面的 thread/compact 全自动；off 直接返回。
  // 指令经 displayText 与用户原文区分展示，但会随 input 发给模型（见 sendPrompt）。
  jevCompressDirectiveRef.current = runJevCompressDirective;



  useEffect(() => () => {
    for (const cancel of officialOAuthSessionsRef.current.values()) {
      cancel(new Error("OpenAI OAuth login was cancelled"));
    }
    officialOAuthSessionsRef.current.clear();
  }, []);















  const exportHistoryThread = useCallback(
    async (threadId: string) => {
      const thread = state.threads.find((entry: ThreadEntry) => entry.id === threadId);
      if (!thread || (thread.cliBackend ?? DEFAULT_CLI_BACKEND) !== "codex") return;
      try {
        const loaded = await loadCompleteCodexHistory(client, threadId, thread);
        downloadTextFile(codexHistoryFilename(loaded.thread), buildCodexHistoryMarkdown(loaded.thread, loaded.turns));
      } catch (error) {
        dispatch({ type: "error", message: errorMessage("Export history thread", error) });
        throw error;
      }
    },
    [client, state.threads]
  );
















  const { composerGitBranch, setComposerGitBranch, composerGitDirtyCount, setComposerGitDirtyCount, readActiveWorkspaceDirectory, workspaceGitRpc, readActiveWorkspaceFile, saveActiveWorkspaceFile } = useWorkspaceGitFiles({ state, dispatch, client, t, activeWorkspaceMode, activeWorkspaceCwd, activeWorkspaceSshCommand, fileTabs, rightWorkspaceRequestEpochRef, rightWorkspaceVisible, readDirectoryInContext });
  const { createWorkspaceFolder, undoWaterfallFileChanges, workspaceFileMutations, closeRightWorkspace, startRemoteBackgroundConversation } = useWorkbenchOps({ state, dispatch, client, t, activeWorkspaceCwd, activeWorkspaceMode, activeWorkspaceSshCommand, activeProviderId, activeGroupId, activeThreadIdRef, allHistoryThreadsRef, composerModels, cwd, sshCommand, sshCwd, workspaceMode, workspacePickerPath, workspaceNewFolderName, setWorkspaceNewFolderName, workspaceHostPlatform, localWorkspaceInfo, localWorkspaceDefaultPath, runtimeSelection, selectedModel, reasoningEffort, terminalSessions, setTerminalSessions, fileTabs, readDirectory, readActiveWorkspaceDirectory, setFileDirectories, rightWorkspaceRequestEpochRef, setRemoteBackgroundStarting, remoteBackgroundStarting, openExistingThread, openFile, workspaceGitRpc, setRightWorkspaceVisible, setWorkspaceCreateBusy, setWorkspacePickerPath, setOpenWithTarget });

  const reviewWaterfallFileChanges = useCallback(() => {
    setRightWorkspaceTab("git");
    setRightWorkspaceVisible(true);
  }, []);





  useEffect(() => {
    if (!workspacePickerOpen) {
      return;
    }
    if (!fileDirectories[workspaceDirectoryCacheKey(workspaceMode, sshCommand, workspacePickerPath)]) {
      void readDirectory(workspacePickerPath);
    }
  }, [fileDirectories, readDirectory, sshCommand, workspaceMode, workspacePickerOpen, workspacePickerPath]);

  const openCodeWorkspaceFile = useCallback(async (path: string) => {
    if (!state.token) return;
    try {
      const selection = await fetchCodeWorkspaceFile(state.token, path);
      setWorkspaceMode("local");
      setWorkspacePickerPath(selection.cwd);
      setCwd(selection.cwd);
      setAdditionalRoots(normalizeWorkspaceRoots(selection.cwd, selection.additionalRoots));
      setWorkspaceFilePath(selection.path);
      persistWorkspaceForActiveThread(selection.cwd, selection.additionalRoots, selection.path);
      setWorkspacePickerOpen(false);
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(t("workspace.openFile"), error) });
    }
  }, [persistWorkspaceForActiveThread, state.token, t]);

  const openWorkspacePicker = useCallback((purpose: "primary" | "additional" = "primary", modeOverride?: WorkspaceMode) => {
    setWorkspacePickerPurpose(purpose);
    const effectiveWorkspaceMode = modeOverride ?? workspaceMode;
    const normalized = effectiveWorkspaceMode === "ssh" ? normalizeSshWorkspaceCwd(sshCwd) || DEFAULT_SSH_WORKSPACE_CWD : normalizeWorkspaceCwd(cwd) || localWorkspaceDefaultPath;
    setWorkspaceMode(effectiveWorkspaceMode);
    setWorkspacePickerPath(normalized);
    setWorkspacePickerOpen(true);
    const cacheKey = workspaceDirectoryCacheKey(effectiveWorkspaceMode, sshCommand, normalized);
    if (!fileDirectories[cacheKey]) {
      void readDirectory(normalized);
    }
  }, [cwd, fileDirectories, localWorkspaceDefaultPath, readDirectory, sshCommand, sshCwd, workspaceMode]);





  // Declared before runTerminalCommand: transcript auto-routes fullscreen
  // TUI commands here, and TS forbids closing over a later const.














  const allThemePlugins = useMemo(
    () => [...themePlugins, ...customThemePlugins.filter((plugin: ThemePlugin) => !themePlugins.some((entry: ThemePlugin) => entry.id === plugin.id))],
    [customThemePlugins]
  );
  const windowsDesktop = authSession?.desktopRuntime?.platform === "win32";
  const activeThemePlugin = allThemePlugins.find((plugin: ThemePlugin) => plugin.id === themeMode) ?? null;
  const shellBackgroundImage = safeThemeAssetUrl(activeThemePlugin?.assets?.appBackgroundImage);
  const composerBackgroundImage = safeThemeAssetUrl(activeThemePlugin?.assets?.composerBackgroundImage ?? activeThemePlugin?.assets?.appBackgroundImage);
  const welcomeBackgroundImage = safeThemeAssetUrl(activeThemePlugin?.assets?.welcomeBackgroundImage ?? activeThemePlugin?.assets?.heroImage ?? activeThemePlugin?.assets?.appBackgroundImage);
  const historyBackgroundImage = safeThemeAssetUrl(activeThemePlugin?.assets?.historyBackgroundImage ?? activeThemePlugin?.assets?.appBackgroundImage);
  const shellBackgroundVideo = windowsDesktop ? undefined : safeThemeVideoUrl(activeThemePlugin?.assets?.appBackgroundVideo);
  const backgroundScene = activeThemePlugin?.layout?.backgroundScene;
  const effectiveBackgroundScene = windowsDesktop ? undefined : backgroundScene;
  const themeTuning = themeVisualTuning(activeThemePlugin);
  const petImage = safeThemeAssetUrl(activeThemePlugin?.assets?.petImage);
  const showThemePet = Boolean(petImage && activeThemePlugin?.layout?.petEnabled !== false);
  const activeRunningTurn = state.activeThreadId
    ? latestActionableRunningTurn(state.turns, state.activeThreadId)
    : null;
  const { stopActiveTurn, editLastUserMessage } = useTurnOps({ state, dispatch, client, t, activeRunningTurn, activeThreadIdRef, allHistoryThreadsRef, cwdForThread, interruptTurn, loadThreadIntoCache, localWorkspaceDefaultPath, modelCapacityRetryRef, openExistingThread, setClosedTaskTabIds, setTaskTabOrder, setSplitView, setWorkspaceLayout, setCwd, setWorkspaceMode, setWorkspaceFilePath, setWorkspacePickerPath, setWorkspaceSelectionPending, setNewChatSetupOpen, setNewChatBudgetLimit, setThreadLoadProgress, setWelcomeDismissed, splitMutationEpochRef, sshCommand, workspaceMode, startCodexTurn, suppressThreadAutoNudge, threadSelectionEpochRef, topicTranscriptStore, transcriptRuntime, turnsByThreadIdRef, historySelectionForThread, loadPersistedThreadRuntimeSelection, updateNewConversationRuntimeSelection });
  const runningThreadIds = useMemo(() => {
    const latestTerminalStartedAtByThread = new Map<string, number>();
    for (const turn of state.turns) {
      if (isRunningTurnStatus(turn.status)) continue;
      const startedAt = normalizeRuntimeTimestamp(turn.startedAt) ?? 0;
      latestTerminalStartedAtByThread.set(turn.threadId, Math.max(latestTerminalStartedAtByThread.get(turn.threadId) ?? Number.NEGATIVE_INFINITY, startedAt));
    }
    const actionable = new Set<string>();
    for (const turn of state.turns) {
      if (!isRunningTurnStatus(turn.status)) continue;
      const latestTerminal = latestTerminalStartedAtByThread.get(turn.threadId);
      const startedAt = normalizeRuntimeTimestamp(turn.startedAt);
      if (latestTerminal === undefined || startedAt == null || startedAt >= latestTerminal) actionable.add(turn.threadId);
    }
    return actionable;
  }, [state.turns]);
  useEffect(() => {
    if (runningThreadIds.size === 0) return;
    setTaskTabOrder((current: string[]) => {
      let next = current;
      for (const threadId of runningThreadIds) next = openTaskTab(next, threadId);
      return next;
    });
  }, [runningThreadIds]);

  return {
    composerCore,
    ensureActiveThread,
    recordInterruptRetry,
    interruptTurn,
    startCodexTurn,
    pendingCodexProviderTest,
    setPendingCodexProviderTest,
    testProviderWithCodex,
    schedulePlanContinuation,
    stayInPlanMode,
    implementApprovedPlan,
    setGoalForActiveThread,
    renameActiveThread,
    startReview,
    showDiffToRemote,
    compactActiveThread,
    resumeThreadFromSlash,
    runImageCommand,
    answerRequest,
    respondToServerRequest,
    handleComposerSlashCommand,
    sendPrompt,
    steerPrompt,
    sendSideChatPrompt,
    configuredContextModel,
    configuredContextProvider,
    configuredContextGroupId,
    configuredContextGroup,
    configuredContextWindow,
    activeConversationThread,
    displayedContextProviderId,
    displayedContextModel,
    displayedContextProvider,
    displayedContextGroupId,
    displayedContextGroup,
    displayedThreadContextWindow,
    activeComposerThreadUsage,
    refreshFreeCompactionModels,
    notifyFreeModelSyncSuccess,
    syncOmniRouteFree,
    runFreeCompactionBeforeSend,
    runJevCompressDirective,
    exportHistoryThread,
    composerGitBranch,
    setComposerGitBranch,
    composerGitDirtyCount,
    setComposerGitDirtyCount,
    readActiveWorkspaceDirectory,
    workspaceGitRpc,
    readActiveWorkspaceFile,
    saveActiveWorkspaceFile,
    createWorkspaceFolder,
    undoWaterfallFileChanges,
    workspaceFileMutations,
    closeRightWorkspace,
    startRemoteBackgroundConversation,
    reviewWaterfallFileChanges,
    openCodeWorkspaceFile,
    openWorkspacePicker,
    allThemePlugins,
    windowsDesktop,
    activeThemePlugin,
    shellBackgroundImage,
    composerBackgroundImage,
    welcomeBackgroundImage,
    historyBackgroundImage,
    shellBackgroundVideo,
    backgroundScene,
    effectiveBackgroundScene,
    themeTuning,
    petImage,
    showThemePet,
    activeRunningTurn,
    stopActiveTurn,
    editLastUserMessage,
    runningThreadIds,
  };
}
