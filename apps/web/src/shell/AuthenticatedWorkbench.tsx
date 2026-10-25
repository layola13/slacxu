import { lazy, useCallback, useEffect, type Dispatch } from "react";
import { reasoningEffortLabel } from "../modelReasoning";
import { isPerformancePressured } from "../performance/animationBudget";
import { permissionPresetDisplayLabel } from "../permissionPresetDisplay";
import { normalizeWorkspaceCwd, parentWorkspacePath } from "../workspacePaths";
import { describeAgentReadiness } from "../app/agents/agentReadiness";
import { claudeStartupStageLocaleKey, isClaudeStartupStage } from "../app/claude/claudeStartupStage";
import { getConversationStatus, hasConversationWork } from "../app/conversationStatus";
import { isRunningTurnStatus } from "../app/transcripts/topicRuntimeIndex";
import { sumTokenBreakdowns } from "../app/usage/usagePricing";
import { buildHistoryUsageByThread, buildRequestMonitorEntries, connectionNoticeFor, conversationStatusColorFor, conversationStatusLabelFor, fastReasoningEffort, hasRealUserMessageForPending, latestRunningPlanStep, normalizeTimestampMilliseconds } from "../app/workbench/appUtils";
import { buildNewChatBackendPreview, isLikelyImageModelId, resolveSelectedModel, resolveSelectedModelProvider, resolveTextRuntimeGroupId } from "../app/workbench/modelSelectionUtils";
import { normalizeSshWorkspaceCwd, sshCodexInstallCommand } from "../app/workbench/sshUtils";
import { useTaskTabsFocus } from "../app/workbench/useTaskTabsSplit";
import { useWorkbenchEffects } from "../app/workbench/useWorkbenchEffects";
import { useAgentReadinessOps } from "../app/workbench/useWorkbenchOps";
import { workspaceDirectoryCacheKey } from "../app/workspace/rightWorkspaceContext";
import { permissionPresets } from "@codex-ui/shared";

import { type PendingAppendMessage, type WorkbenchModeState, type WorkbenchStatsState } from "../components/ChatPanel";
import { type ComposerWorkingStatus } from "../composer/Composer";
import { ComposerAgentsAction, ComposerCliBackendAction } from "./ComposerChromeActions";
import { ConversationView } from "./ConversationView";
import { FreeSavingsAction } from "./FreeSavingsAction";
import { RuntimeControlSet } from "./RuntimeControlSet";
import { SplitPaneView } from "./SplitPaneView";
import { SshConfigHostControl } from "./SshConfigHostControl";
import { type TerminalSession, type ThreadEntry, type WorkbenchTurn } from "../state/codexClient";
import { NEW_CONVERSATION_SELECTION_KEY, type ThreadRuntimeSelection } from "../app/runtime/useThreadRuntimeSelections";
import { type TurnRetryState } from "../app/turnRetryState";
import { DEFAULT_SSH_WORKSPACE_CWD } from "../app/workbench/appConstants";
import { type AgentRosterRole } from "@codex-ui/shared";

import type { AppProps } from "../app/workbench/appConstants";
import type { appReducer } from "../app/appReducer";
import type { ClientState } from "../state/codexClient";
import type { useAccessRuntime } from "../app/workbench/useAccessRuntime";
import type { useTaskTabsRuntime } from "../app/workbench/useTaskTabsRuntime";
import type { useThreadWorkspaceRuntime } from "../app/workbench/useThreadWorkspaceRuntime";
import type { useSelectionRuntime } from "../app/workbench/useSelectionRuntime";
import type { useGoalRuntime } from "../app/workbench/useGoalRuntime";
import type { useComposerRuntime } from "../app/workbench/useComposerRuntime";
import type { useSettingsRuntime } from "../app/workbench/useSettingsRuntime";
import { useWorkbenchRuntime } from "../app/workbench/useWorkbenchRuntime";
import { WorkbenchRoot } from "./WorkbenchRoot";

const SettingsDrawer = lazy(() => import("../settings/SettingsDrawer").then((module) => ({ default: module.SettingsDrawer })));

export interface AuthenticatedWorkbenchProps {
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
  composer: ReturnType<typeof useComposerRuntime>;
  settings: ReturnType<typeof useSettingsRuntime>;
}

export function AuthenticatedWorkbench(props: AuthenticatedWorkbenchProps) {
  const { state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId } = props;
  const access = props.access;
  const taskTabsRuntime = props.taskTabs;
  const threadWorkspace = props.threadWorkspace;
  const selection = props.selection;
  const goals = props.goals;
  const composer = props.composer;
  const settings = props.settings;
  const {
    additionalRoots, allHistoryThreadsRef, applyTurnRetryState, authSession, authStatus, codexCliUpdateBusy, codexCliUpdateDialogOpen,
    codexCliUpdateError, codexCliUpdateStatus, composerWatchReactivationRef, connectionEpoch, connectionStatus, cwd, dangerDialogAcknowledged,
    dangerDialogIntent, freeModelNotice, handleAllocateMemberBalance, handleCreateMember, handleDeleteMember, handleUpdateMember, handledPlanImplementationIdsRef,
    historyBackendFilter, historyBackendFilterUserTouchedRef, historyDateRange, historyFullyLoadedRef, historyLoadProgress, historyLoadRequestRef, historyLoading,
    historySearchTerm, historyViewMode, lastCodexActivityAtRef, localWorkspaceInfo, members, membersError, membersLoading,
    newChatAdditionalRootsExpanded, newChatBudgetLimit, newChatSetupOpen, pendingAcceptedThreads, pendingAppends, pendingNewConversationCount, pendingSendGateRef,
    planImplementationPrompt, reloadMembers, selectSshConfigHost, setAdditionalRoots, setCodexCliUpdateBusy, setCodexCliUpdateDialogOpen, setCodexCliUpdateError,
    setCwd, setDangerDialogAcknowledged, setFreeModelNotice, setHistoryBackendFilter, setHistoryDateRange, setHistoryLoadProgress, setHistoryLoading,
    setHistorySearchTerm, setHistoryViewMode, setNewChatAdditionalRootsExpanded, setNewChatBudgetLimit, setNewChatSetupOpen, setPendingAppends, setPlanImplementationPrompt,
    setSettingAssistantModel, setSettingAssistantProviderId, setSlashNotice, setSshCommand, setSshConfigHostAlias, setSshCwd, setSshInstallConfirming,
    setSshPreflightIssue, setStatsPanelScope, setThreadHistoryPages, setWorkspaceFilePath, setWorkspaceMode, setWorkspaceNewFolderName, setWorkspacePickerOpen,
    setWorkspacePickerPath, setWorkspaceSelectionPending, settingAssistantModel, settingAssistantProviderId, slashNotice, sshCommand, sshConfigHostAlias,
    sshConfigHostProbing, sshConfigHosts, sshConfigHostsLoading, sshConfigProbeError, sshCwd, sshDetectedHome, sshInstallBusy,
    sshInstallConfirming, sshInstallError, sshPreflightIssue, statsPanelScope, threadHistoryPages, threadHistoryPagesRef, threadLoadProgress,
    threadTokenUsage, turnRetryState, usageStore, workspaceAgentsBusy, workspaceCreateBusy, workspaceMode, workspaceNewFolderName,
    workspacePickerOpen, workspacePickerPath, workspacePickerPurpose, workspaceSelectionPending,
  } = access;
  const {
    agentReadiness, agentReadinessJsonOpen, agentReadinessLoading, agentRosterManagerThreadId, agentsAnchor, agyCliEnabled, auggieCliEnabled, clineCliEnabled, commandCodeCliEnabled, cancelTopBarHide,
    capacityTurnRetryEnabled, chatTypography, claudeCliEnabled, cliBackendEnabled, cliBackendToggleError, codexCliEnabled, compactionSourceByTurnId,
    detachedSnapshotHydratedRef, detachedSnapshotReady, detachedTaskSnapshot, draggedTaskTabId, enterImmersiveView, exitImmersiveView, filesPanelLayout,
    freeCompactMenuAnchor, freeModelAccessOpen, freeOllamaEnabled, grokCliEnabled, handleCliBackendToggle, immersiveComposerCompact, immersiveComposerHintOpen,
    immersiveExitHintOpen, immersiveHintSequence, immersiveTaskTabsOpen, immersiveView, installThemePlugin, installedThemePluginIds, leftPanelVisible,
    localWorkspaceDefaultPath, localWorkspaceProjectsPath, mobileHistoryOpen, mobileTopBarCollapsed, mobileTopBarExpanded, mobileTopMenuAnchor, museCliEnabled,
    openTopBar, openWithApps, openWithAppsLoading, openWithMenuPosition, openWithTarget, opencodeCliEnabled, opencodeV2CliEnabled,
    paneContextMenu, panelLayout, pendingPaneSplit, petDockEnabled, piCliEnabled, reasoningAnchor, remoteBackgroundStarting,
    remoteLifecycleOverrides, remoteLifecyclePendingIds, removeCustomThemePlugin, resolveDetachedSnapshotReadyRef, rightWorkspaceVisible, runtimeConfigAnchor, saveCustomThemePlugin,
    scheduleTopBarHide, setAgentReadiness, setAgentReadinessJsonOpen, setAgentReadinessLoading, setAgentRosterManagerThreadId, setAgentsAnchor, setCapacityTurnRetryEnabled,
    setChatTypography, setClosedTaskTabIds, setComposerSuggestion, setDetachedSnapshotReady, setDetachedTaskIds, setDetachedTaskSnapshot, setDraggedTaskTabId,
    setFilesPanelLayout, setFreeCompactMenuAnchor, setFreeModelAccessOpen, setImmersiveComposerHintOpen, setImmersiveExitHintOpen, setImmersiveTaskTabsOpen, setIncludeAutomationHistory,
    setLeftPanelVisible, setMobileHistoryOpen, setMobileTopBarCollapsedPersisted, setMobileTopBarExpanded, setMobileTopMenuAnchor, setPaneContextMenu, setPanelLayout,
    setPendingPaneSplit, setPetDockEnabled, setReasoningAnchor, setRightWorkspaceTab, setRightWorkspaceVisible, setRuntimeConfigAnchor, setShowAssistantUsageDetails,
    setSplitView, setSplitViewBaseThreadId, setSplitViewMenuAnchor, setSplitViewMenuPosition, setSplitViewSearch, setTaskNotificationPreferences, setTaskTabContextMenu,
    setTaskTabOrder, setTopBarOpen, setTopBarPinned, setWaterfallDisplayMode, setWelcomeDismissed, setWorkspaceLayout, showAssistantUsageDetails,
    splitDropHandledRef, splitMutationEpochRef, splitView, splitViewMenuAnchor, splitViewMenuPosition, splitViewSearch, taskNotificationPreferences,
    taskTabContextMenu, topBarOpen, topBarPinned, uninstallThemePlugin, waterfallDisplayMode, welcomeDismissed, windowsWorkspaceHost,
    workspaceHostPlatform, workspaceLayout,
  } = taskTabsRuntime;
  const {
    activeThreadIdRef, additionalRootsRef, clientRef, closeWebPreview, connectedRef, disablePlanAutoContinuation, finishThreadLoadProgress,
    handledConnectionEpochRef, openBrowserPreview, openFile, projectStatsCacheRef, topicTranscriptStore, transcriptRuntime, turnsByThreadId,
    webPreview, workspaceFolderMergeEpochRef, writerConflictThreadIdsRef,
  } = threadWorkspace;
  const {
    activeGroupId, activeProviderId, allowedPermissions, checkCodexCliUpdate, cliBackendVersionLabel, cliInstallations, cliSwitchBusy,
    cliSwitchConfirmTarget, cliSwitchError, cliSwitchNotice, cliSwitcherAnchor, clineBalance, compactCapabilityWarning, compactMode,
    desktopLayout, fastModeEnabled, freeAutoCompactEnabled, freeAutoCompactGroupId, freeAutoCompactModel, freeAutoCompactProviderId, freeAutoCompactThreshold,
    freeCompactionChannelOptions, freeCompactionGroupOptions, freeCompactionModels, freeCompactionProviderOptions, freeCompactionReadiness, freebuffAutoFailover, freebuffSession,
    freebuffSwitchBusy, freebuffSwitchDialogOpen, freebuffSwitchTargetModel, handleCliPluginToggleFromList, handleCliSwitchConfirm, handleConfirmFreebuffSwitch, handleKeepCurrentFreebuffModel,
    handleNewConversationCliBackend, handleReleaseFreebuffSlotFromChip, historySelectionForThread, isAgyBackend, isClaudeBackend, isCodexBackend, isGrokBackend,
    isMiniBackend, isMobile, isMuseBackend, isOpencodeBackend, isOpencodeV2Backend, isPiBackend, jevCompressThreshold, loadPersistedThreadRuntimeSelection,
    locale, miniVersion, permission, planModeEnabled, reasoningEffort, refreshCliInstallations, refreshClineBalance,
    refreshFreebuffSession, runtimeSelection, selectedModel, selectedModelRef, selectionForThread, setCliSwitchConfirmTarget, setCliSwitchError,
    setCliSwitchNotice, setCliSwitcherAnchor, setCompactMode, setFreeAutoCompactEnabled, setFreeAutoCompactGroup, setFreeAutoCompactModel, setFreeAutoCompactProvider,
    setFreeAutoCompactThreshold, setFreebuffAutoFailover, setFreebuffSwitchDialogOpen, setFreebuffSwitchTargetModel, setJevCompressThreshold, setLocale, setReasoningEffort,
    setSelectedModel, t, threadRuntimeSelections, updateImageRuntimeSelection, updateNewConversationRuntimeSelection, updateRuntimeSelectionForKey,
  } = selection;
  const {
    activeWorkspaceAdditionalRoots, activeWorkspaceCwd, activeWorkspaceMode, archiveHistoryThread, cancelActiveGoal, changeOpenFileContent, clearActiveGoal,
    client, composerModels, cwdForThread, deleteHistoryThread, fileDirectories, installSshCodex, loadHistory,
    loadThreadGoal, readDirectory, readFile, recheckSshWorkspace, renameHistoryThread, saveOpenFile, setActiveGoalStatus,
    setTerminalSessions, showOpenWithMenu, terminalSessions, threadGoals, workspacePickerLoadingKey,
  } = goals;
  const {
    activeRunningTurn, activeThemePlugin, allThemePlugins, closeRightWorkspace, composerCore, createWorkspaceFolder, editLastUserMessage,
    effectiveBackgroundScene, exportHistoryThread, historyBackgroundImage, openCodeWorkspaceFile, openWorkspacePicker, respondToServerRequest, reviewWaterfallFileChanges,
    runningThreadIds, shellBackgroundImage, shellBackgroundVideo, startRemoteBackgroundConversation, syncOmniRouteFree, testProviderWithCodex, themeTuning,
    undoWaterfallFileChanges, welcomeBackgroundImage, windowsDesktop,
  } = composer;
  const {
    activateProvider, agentReasoningOptions, appInstalled, applyWorkspaceVmPolicyForCwd, auditEvents, callMcpTool, cancelOfficialOpenAiOAuth,
    closeDangerDialog, codexConfig, codexConfigError, codexConfigLoading, codexConfigSaving, confirmDangerDialog, confirmWorkspaceSelection,
    copyRelayShare, createRelayShare, createSkill, deleteProvider, downloadProfile, downloadRelayBackup, downloadRelayConfig,
    finishSetupGuide, handleInstallApp, handleOpenCommandBlacklistSettings, handleSelectRecentWorkspace, importRelayShareDirectly, injectClaudeDesktop, injectCursorDesktop,
    insertPluginMention, installPlugin, installPromptEvent, installingPluginIds, loadAuditEvents, loadBasics, loadCodexConfig,
    loadOlderThreadHistory, loadThreadIntoCache, loadTooling, mcpOauthUrls, mcpResourceContents, officialLoginNotice, officialLoginOpen,
    openExistingThread, openRelayShareExport, openSettings, persistWorkspaceForActiveThread, pluginAuthNotices, pluginDetails, pluginSkillPreviews,
    preferencesReady, readMcpResource, readPluginDetail, readPluginSkill, readSkillPreview, reasoningOptions, refreshProviders,
    relayShareExportBusy, relayShareExportConfirm, relayShareExportError, relayShareExportOpen, relayShareExportPassword, relayShareExportText, relayShareImportBusy,
    relayShareImportError, relayShareImportOpen, relayShareImportPassword, relayShareImportText, reloadMcp, replaySetupGuide, requestNewSession,
    requestPermissionChange, resolveComposerReasoningOptions, restoreProvider, saveProvider, saveSkillExtraRoots, selectProviderForCurrentThread, selectTaskTab,
    setOfficialLoginNotice, setOfficialLoginOpen, setRelayShareExportConfirm, setRelayShareExportError, setRelayShareExportOpen, setRelayShareExportPassword, setRelayShareImportError,
    setRelayShareImportOpen, setRelayShareImportPassword, setRelayShareImportText, setSettingsOpen, settingsOpen, settingsPluginTab, settingsRelayTarget,
    settingsSection, setupGuideOpen, skillExtraRoots, skillPreviews, startMcpOauth, startOfficialOpenAiOAuth, syncFreeOllama,
    toggleSkill, uninstallPlugin, uploadCapabilityCatalog, uploadProfile, uploadRelayBackup, uploadRelayConfig, useSaferModeFromDangerDialog,
    writeCodexConfigField, writeCodexConfigValue,
  } = settings;
  useWorkbenchEffects({ ...composerCore, activeRunningTurn, activeWorkspaceCwd, activeWorkspaceMode, additionalRootsRef, clientRef, connectionEpoch, detachedSnapshotHydratedRef, detachedSnapshotReady, setDetachedSnapshotReady, setDetachedTaskSnapshot, detachedThreadId, handledConnectionEpochRef, historyFullyLoadedRef, historyLoadRequestRef, historySearchTerm, loadBasics, loadHistory, loadThreadGoal, loadThreadIntoCache, preferencesReady, refreshProviders, resolveDetachedSnapshotReadyRef, setDraggedTaskTabId, setPaneContextMenu, setPendingPaneSplit, setReasoningAnchor, setRuntimeConfigAnchor, setSplitViewMenuAnchor, setSplitViewMenuPosition, setTaskTabContextMenu, setHistoryLoading, setHistoryLoadProgress, setThreadHistoryPages, threadHistoryPagesRef, windowsDesktop, workspaceFolderMergeEpochRef, lastCodexActivityAtRef, isPerformancePressured, persistWorkspaceForActiveThread, splitDropHandledRef, disablePlanAutoContinuation, planImplementationPrompt, setPlanImplementationPrompt, handledPlanImplementationIdsRef, planModeEnabled, selectTaskTab, selectedModelRef, setDetachedTaskIds, freebuffSwitchDialogOpen, transcriptRuntime, setCwd, setWorkspaceSelectionPending, setWorkspaceMode, setSshCommand, setSshCwd, setAdditionalRoots, setWorkspaceFilePath });
  useEffect(() => {
    const runningTurnIds = new Set(state.turns.filter((turn: WorkbenchTurn) => isRunningTurnStatus(turn.status)).map((turn: WorkbenchTurn) => turn.id));
    setPendingAppends((current: PendingAppendMessage[]) => {
      const next = current.filter((message: PendingAppendMessage) => {
        if (hasRealUserMessageForPending(state.turns, message)) {
          return false;
        }
        return message.mode === "pendingUser" || message.mode === "queued" || message.mode === "queuedFailed" || runningTurnIds.has(message.turnId);
      });
      return next.length === current.length ? current : next;
    });
  }, [pendingAppends, state.turns]);
  const deletePendingMessage = useCallback((id: string) => {
    // waiting 占位一旦 beginCommit，gate 就拒绝 cancel，导致删除按钮点了没反应；
    // 上游慢时占位长期滞留，看起来就像消息重复。删除只做视图层面的消除：
    // 已发出的 turn/start 在服务端继续跑，echo 到达后正常渲染持久消息，不会丢消息。
    pendingSendGateRef.current.cancel(id);
    pendingSendGateRef.current.release(id);
    setPendingAppends((current: PendingAppendMessage[]) => current.filter((message: PendingAppendMessage) => message.id !== id));
    return true;
  }, []);
  useEffect(() => {
    const runningIds = new Set(state.turns.filter((turn: WorkbenchTurn) => isRunningTurnStatus(turn.status)).map((turn: WorkbenchTurn) => turn.id));
    applyTurnRetryState((current: TurnRetryState | null) => current && runningIds.has(current.turnId) ? current : null);
    setTerminalSessions((current: TerminalSession[]) => {
      const next = current.filter((session: TerminalSession) => session.status === "running");
      return next.length === current.length ? current : next;
    });
  }, [applyTurnRetryState, state.turns]);
  const activeTurnRetry = turnRetryState && state.activeThreadId === turnRetryState.threadId
    && (!activeRunningTurn || turnRetryState.turnId === activeRunningTurn.id || turnRetryState.turnId === "capacity")
    ? turnRetryState
    : null;
  const conversationStarting = pendingNewConversationCount > 0;
  const pendingConversationStart = conversationStarting
    || Boolean(state.activeThreadId && pendingAcceptedThreads.has(state.activeThreadId));
  const activeTurnUsage = usageStore.getTurnUsage(activeRunningTurn?.id);
  const composerWorkingStatus: ComposerWorkingStatus | null = activeRunningTurn
    ? {
        active: true,
        startedAt: normalizeTimestampMilliseconds(activeRunningTurn.startedAt) ?? Date.now(),
        backgroundTerminalCount: terminalSessions.filter((session: TerminalSession) => session.status === "running").length,
        inputTokens: activeTurnUsage?.inputTokens ?? 0,
        outputTokens: activeTurnUsage?.outputTokens ?? 0,
        activityLabel: latestRunningPlanStep(state.turns, activeRunningTurn.threadId),
        retrying: activeTurnRetry ? { message: activeTurnRetry.message, details: activeTurnRetry.details } : undefined
      }
    : activeTurnRetry
      ? {
          active: true,
          startedAt: activeTurnRetry.updatedAt,
          backgroundTerminalCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          retrying: { message: activeTurnRetry.message, details: activeTurnRetry.details }
        }
      : pendingConversationStart
        ? {
            active: true,
            startedAt: Date.now(),
            backgroundTerminalCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            activityLabel: conversationStarting ? t("connection.connecting") : t("composer.running")
          }
        : null;


  const usePromptSuggestion = useCallback((text: string) => {
    setWelcomeDismissed(true);
    setComposerSuggestion({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text });
  }, []);




  const { focusSplitThread, closeWorkspacePaneAndCollapse } = useTaskTabsFocus({ state, dispatch, activeThreadIdRef, allHistoryThreadsRef, topicTranscriptStore, loadThreadIntoCache, workspaceLayout, setWorkspaceLayout, setSplitView, splitMutationEpochRef, setClosedTaskTabIds, setTaskTabOrder, setWorkspaceSelectionPending, setWorkspaceMode, setWorkspaceFilePath, setCwd, setAdditionalRoots, setSshCommand, setSshCwd, historySelectionForThread, loadPersistedThreadRuntimeSelection });
  const reactivateThreadSubscription = useCallback(() => {
    const threadId = activeThreadIdRef.current;
    if (!threadId || !connectedRef.current) return;
    const now = Date.now();
    if (now - composerWatchReactivationRef.current < 5_000) return;
    composerWatchReactivationRef.current = now;
    try {
      client.watchThread(threadId);
    } catch {
    }
  }, [client]);

  const renderConversation = (threadId: string | null, focused: boolean) => (
    <ConversationView
      threadId={threadId}
      focused={focused}
      threadGoals={threadGoals}
      workspaceLayout={workspaceLayout}
      setPaneContextMenu={setPaneContextMenu}
      topicTranscriptStore={topicTranscriptStore}
      usageStore={usageStore}
      statsPanelScope={statsPanelScope}
      statsState={statsState}
      state={state}
      themeMode={themeMode}
      cwdForThread={cwdForThread}
      openSettings={openSettings}
      respondToServerRequest={respondToServerRequest}
      loadOlderThreadHistory={loadOlderThreadHistory}
      undoWaterfallFileChanges={undoWaterfallFileChanges}
      reviewWaterfallFileChanges={reviewWaterfallFileChanges}
      renderComposerDock={renderComposerDock}
      compactionSourceByTurnId={compactionSourceByTurnId}
      modeState={modeState}
      activeThemePlugin={activeThemePlugin}
      welcomeBackgroundImage={welcomeBackgroundImage}
      welcomeDismissed={welcomeDismissed}
      showAssistantUsageDetails={showAssistantUsageDetails}
      waterfallDisplayMode={waterfallDisplayMode}
      chatTypography={chatTypography}
      pendingAppends={pendingAppends}
      threadLoadProgress={threadLoadProgress}
      authSession={authSession}
      slashNotice={slashNotice}
      requestMonitor={requestMonitor}
      isMobile={isMobile}
      t={t}
      usePromptSuggestion={usePromptSuggestion}
      latestHistoryThread={latestHistoryThread}
      openExistingThread={openExistingThread}
      requestNewSession={requestNewSession}
      permission={permission}
      handleOpenCommandBlacklistSettings={handleOpenCommandBlacklistSettings}
      setOfficialLoginOpen={setOfficialLoginOpen}
      openDiscordInvite={openDiscordInvite}
      setFreeModelAccessOpen={setFreeModelAccessOpen}
      loadThreadIntoCache={loadThreadIntoCache}
      setStatsPanelScope={setStatsPanelScope}
      setSlashNotice={setSlashNotice}
      setComposerSuggestion={setComposerSuggestion}
      setActiveGoalStatus={setActiveGoalStatus}
      clearActiveGoal={clearActiveGoal}
      cancelActiveGoal={cancelActiveGoal}
      editLastUserMessage={editLastUserMessage}
      deletePendingMessage={deletePendingMessage}
      openBrowserPreview={openBrowserPreview}
      webPreview={webPreview}
      closeWebPreview={closeWebPreview}
      finishThreadLoadProgress={finishThreadLoadProgress}
      detachedTaskSnapshot={detachedTaskSnapshot}
      threadHistoryPages={threadHistoryPages}
    />
  );

  const renderSplitPane = (threadId: string, side: "left" | "right", paneId: string = side) => (
    <SplitPaneView
      threadId={threadId}
      side={side}
      paneId={paneId}
      historyThreads={historyThreads}
      state={state}
      focusSplitThread={focusSplitThread}
      workspaceLayout={workspaceLayout}
      setWorkspaceLayout={setWorkspaceLayout}
      setPaneContextMenu={setPaneContextMenu}
      splitView={splitView}
      setSplitView={setSplitView}
      closeWorkspacePaneAndCollapse={closeWorkspacePaneAndCollapse}
      t={t}
      runningThreadIds={runningThreadIds}
      renderConversation={renderConversation}
    />
  );



  const currentUserLabel = authSession?.user?.email ?? "Local session";
  const historyThreads = state.threads;
  const latestHistoryThread = historyThreads.reduce<ThreadEntry | null>((latest, thread) => {
    if (!latest) return thread;
    const threadTimestamp = thread.updatedAt ?? thread.createdAt ?? 0;
    const latestTimestamp = latest.updatedAt ?? latest.createdAt ?? 0;
    return threadTimestamp > latestTimestamp ? thread : latest;
  }, null);
  const allTurns = state.turns;
  const activeGoal = state.activeThreadId ? threadGoals[state.activeThreadId] ?? null : null;
  const modeState: WorkbenchModeState = {
    fast: fastModeEnabled,
    plan: planModeEnabled,
    goalActive: Boolean(activeGoal)
  };
  const conversationWorking = hasConversationWork(state.activeThreadId, activeRunningTurn, pendingAcceptedThreads, conversationStarting);
  const conversationStatus = getConversationStatus(state.connected, state.engine.phase, conversationWorking, Boolean(activeTurnRetry), conversationStarting);
  const conversationStatusColor = conversationStatusColorFor(conversationStatus);
  // Claude cold start takes 10s+ (spawn → CLI init handshake): surface the
  // staged `thread/claude/startup` badge in the composer instead of a bare
  // ready/running label while the runtime is still warming up.
  const claudeStartupStage = state.activeThreadId ? state.claudeStartupStages[state.activeThreadId]?.stage : undefined;
  const conversationStatusLabel = claudeStartupStage && isClaudeStartupStage(claudeStartupStage) && claudeStartupStage !== "ready"
    ? t(claudeStartupStageLocaleKey(claudeStartupStage))
    : activeTurnRetry?.message ?? conversationStatusLabelFor(conversationStatus, connectionStatus, t);
  const connectionNotice = connectionNoticeFor(connectionStatus, t);
  const composerConnected = connectionStatus.phase === "connected" || state.connected;
  const activeConversationReadOnly = Boolean(state.activeThreadId && writerConflictThreadIdsRef.current.has(state.activeThreadId));
  const metricsThread = state.activeThreadId ? state.threads.find((thread) => thread.id === state.activeThreadId) : null;
  const systemMetricsScope = metricsThread?.workspaceMode === "ssh" && metricsThread.sshCommand
    ? { type: "ssh" as const, command: metricsThread.sshCommand, cwd: metricsThread.sshCwd || metricsThread.cwd || "/" }
    : { type: "local" as const };
  const settingAssistantProvider = state.providers.find((provider) => provider.id === settingAssistantProviderId) ?? null;
  const settingAssistantEffectiveModel = settingAssistantModel || settingAssistantProvider?.defaultModel || settingAssistantProvider?.nativeModels[0] || "";
  const settingAssistantReady = Boolean(settingAssistantProvider && settingAssistantEffectiveModel);
  /**
   * Only a thread that already lives on the remote node can be backgrounded, so
   * the composer offers the switch for those and offers to start one otherwise.
   * There is no third option: a locally started thread cannot be promoted,
   * because its CLI process is a child of this machine's server.
   */

  const reasoningIndex = Math.max(0, reasoningOptions.findIndex((option) => option.value === reasoningEffort));
  const selectedReasoning = reasoningOptions[reasoningIndex] ?? reasoningOptions[0];
  const reasoningTranslationKey = `settings.codex.option.${reasoningEffort.trim().toLowerCase()}`;
  const translatedReasoningLabel = t(reasoningTranslationKey);
  const selectedReasoningLabel = translatedReasoningLabel === reasoningTranslationKey
    ? selectedReasoning?.label ?? reasoningEffort
    : translatedReasoningLabel;
  const reasoningMax = Math.max(0, reasoningOptions.length - 1);
  const showReasoningGlow = reasoningIndex === reasoningMax && reasoningMax > 0;
  const effectiveSelectedModel = resolveSelectedModel(state.providers, activeProviderId, selectedModel, activeGroupId);

  const newChatBackendPreview = buildNewChatBackendPreview({
    cwd: workspaceMode === "ssh" ? normalizeSshWorkspaceCwd(sshCwd) || DEFAULT_SSH_WORKSPACE_CWD : normalizeWorkspaceCwd(cwd) || localWorkspaceDefaultPath,
    model: effectiveSelectedModel,
    modelProvider: resolveSelectedModelProvider(state.providers, activeProviderId, codexConfig?.modelProvider),
    permission,
    reasoningEffort,
    budgetLimit: newChatBudgetLimit,
    workspaceMode,
    sshCommand,
    additionalRoots
  });
  const dangerDialogPreset = permissionPresets.find((preset) => preset.id === dangerDialogIntent?.nextPermission);
  const newChatSetupDialogOpen = newChatSetupOpen && workspaceSelectionPending && !state.activeThreadId && !dangerDialogIntent;
  const workspacePickerCacheKey = workspaceDirectoryCacheKey(workspaceMode, sshCommand, workspacePickerPath);
  const workspacePickerEntries = fileDirectories[workspacePickerCacheKey] ?? [];
  const workspacePickerFolders = workspacePickerEntries.filter((entry) => entry.isDirectory);
  const workspacePickerFiles = workspaceMode === "local"
    ? workspacePickerEntries.filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".code-workspace"))
    : [];
  const workspacePickerParent = parentWorkspacePath(workspacePickerPath);
  const workspacePickerLoading = workspacePickerLoadingKey === workspacePickerCacheKey;
  const sshInstallCommand = sshCodexInstallCommand(sshPreflightIssue?.os ?? "");
  const workspaceSetupBusy = sshConfigHostProbing || sshInstallBusy || workspaceAgentsBusy;
  const sshConfigHostControl = (
    <SshConfigHostControl
        t={t}
        workspaceMode={workspaceMode}
        sshConfigHostAlias={sshConfigHostAlias}
        selectSshConfigHost={selectSshConfigHost}
        sshConfigHosts={sshConfigHosts}
        sshConfigHostsLoading={sshConfigHostsLoading}
        sshConfigHostProbing={sshConfigHostProbing}
        sshConfigProbeError={sshConfigProbeError}
    />
  );
  void currentUserLabel;

  const updateAgentRuntime = (patch: Partial<ThreadRuntimeSelection["agents"]>) => {
    const selectionKey = state.activeThreadId ?? NEW_CONVERSATION_SELECTION_KEY;
    const agents = { ...selectionForThread(state.activeThreadId).agents, ...patch };
    updateRuntimeSelectionForKey(selectionKey, { agents });
  };

  const { checkAgentReadiness, applyRecommendedAgentRoster } = useAgentReadinessOps({ state, dispatch, client, t, activeThreadIdRef, composerModels, runtimeSelection, selectedModel, resolveComposerReasoningOptions, agentReadiness, setAgentReadiness, setAgentReadinessLoading, updateAgentRuntime, runningThreadIds, activeProviderId, activeGroupId, reasoningEffort });
  const updateAgentRosterRole = (roleId: string, patch: Partial<AgentRosterRole>) => {
    updateAgentRuntime({
      roles: runtimeSelection.agents.roles.map((role) => role.id === roleId ? { ...role, ...patch } : role)
    });
  };
  const addAgentRosterRole = () => {
    const index = runtimeSelection.agents.roles.length + 1;
    updateAgentRuntime({
      roles: [...runtimeSelection.agents.roles, {
        id: `custom-${Date.now().toString(36)}`,
        name: `${t("app.agentsRole")} ${index}`,
        responsibility: "",
        model: "",
        reasoningEffort: "",
        enabled: true
      }]
    });
  };

  const agentSummary = runtimeSelection.agents.mode === "inherit"
    ? t("app.agentsDefault")
    : runtimeSelection.agents.mode === "disabled"
      ? t("app.agentsOff")
      : runtimeSelection.agents.roles.some((role) => role.enabled)
        ? `${runtimeSelection.agents.roles.filter((role) => role.enabled).length} ${t("app.agentsRoles")}`
        : `${runtimeSelection.agents.childCount ?? t("app.agentsDefault")}`;

  const agentReadinessDisplay = describeAgentReadiness(agentReadiness);

  const runtimeControlSet = (
    <RuntimeControlSet
        t={t}
        activeRunningTurn={activeRunningTurn}
        activeProviderId={activeProviderId}
        activeGroupId={activeGroupId}
        runtimeSelection={runtimeSelection}
        selectProviderForCurrentThread={selectProviderForCurrentThread}
        updateImageRuntimeSelection={updateImageRuntimeSelection}
        setOfficialLoginOpen={setOfficialLoginOpen}
        openSettings={openSettings}
        selectedModel={selectedModel}
        composerModels={composerModels}
        freebuffSession={freebuffSession}
        setFreebuffSwitchTargetModel={setFreebuffSwitchTargetModel}
        setFreebuffSwitchDialogOpen={setFreebuffSwitchDialogOpen}
        activeThreadIdRef={activeThreadIdRef}
        setSelectedModel={setSelectedModel}
        updateNewConversationRuntimeSelection={updateNewConversationRuntimeSelection}
        clineBalance={clineBalance}
        refreshFreebuffSession={refreshFreebuffSession}
        refreshClineBalance={refreshClineBalance}
        handleReleaseFreebuffSlotFromChip={handleReleaseFreebuffSlotFromChip}
        freebuffAutoFailover={freebuffAutoFailover}
        setFreebuffAutoFailover={setFreebuffAutoFailover}
        showReasoningGlow={showReasoningGlow}
        setRuntimeConfigAnchor={setRuntimeConfigAnchor}
        setReasoningAnchor={setReasoningAnchor}
        selectedReasoningLabel={selectedReasoningLabel}
        state={state}
    />
  );



  // The CLI backend is selected when a new conversation is created (or restored
  // from history), so mid-conversation switching is temporarily disabled. The
  // composer toggle is hidden until a later release re-enables it; the JSX path
  // and its "temporarily unavailable" notice are kept so the feature flag can be
  // flipped back without rewriting the block.
  const composerCliBackendAction = (
    <ComposerCliBackendAction
        t={t}
        claudeCliEnabled={claudeCliEnabled}
        isClaudeBackend={isClaudeBackend}
        setSlashNotice={setSlashNotice}
    />
  );

  const composerFreeSavingsAction = (
    <FreeSavingsAction
        compactMode={compactMode}
        setCompactMode={setCompactMode}
        freeAutoCompactThreshold={freeAutoCompactThreshold}
        setFreeAutoCompactThreshold={setFreeAutoCompactThreshold}
        freeAutoCompactProviderId={freeAutoCompactProviderId}
        setFreeAutoCompactProvider={setFreeAutoCompactProvider}
        freeAutoCompactGroupId={freeAutoCompactGroupId}
        setFreeAutoCompactGroup={setFreeAutoCompactGroup}
        freeAutoCompactModel={freeAutoCompactModel}
        setFreeAutoCompactModel={setFreeAutoCompactModel}
        jevCompressThreshold={jevCompressThreshold}
        setJevCompressThreshold={setJevCompressThreshold}
        freeCompactMenuAnchor={freeCompactMenuAnchor}
        setFreeCompactMenuAnchor={setFreeCompactMenuAnchor}
        freeCompactionProviderOptions={freeCompactionProviderOptions}
        freeCompactionGroupOptions={freeCompactionGroupOptions}
        freeCompactionModels={freeCompactionModels}
        freeCompactionReadiness={freeCompactionReadiness}
        setFreeModelAccessOpen={setFreeModelAccessOpen}
        compactCapabilityWarning={compactCapabilityWarning}
    />
  );

  const composerAgentsAction = (
    <ComposerAgentsAction
        t={t}
        agentSummary={agentSummary}
        runtimeSelection={runtimeSelection}
        agentsAnchor={agentsAnchor}
        setRuntimeConfigAnchor={setRuntimeConfigAnchor}
        setAgentsAnchor={setAgentsAnchor}
        checkAgentReadiness={checkAgentReadiness}
    />
  );


  const activeProvider = state.providers.find((provider) => provider.id === activeProviderId);
  const activeProviderLabel = (isAgyBackend && (!activeProviderId || activeProviderId === "agy-official"))
    ? (t("topbar.relay.agyOfficial") || "Antigravity 官方")
    : (isGrokBackend && (!activeProviderId || activeProviderId === "grok-official"))
      ? "Grok 官方"
      : (isOpencodeBackend && (!activeProviderId || activeProviderId === "opencode-local"))
        ? "OpenCode 本地"
        : (isOpencodeV2Backend && (!activeProviderId || activeProviderId === "opencode-local"))
          ? "OpenCode v2 本地"
          : activeProvider?.name ?? activeProvider?.id ?? (isAgyBackend ? (t("topbar.relay.agyOfficial") || "Antigravity 官方") : isGrokBackend ? "Grok 官方" : t("app.defaultRelay"));
  const imageChannels = state.providers.flatMap((provider) => (provider.groups ?? []).flatMap((group) => {
    const supportsImages = group.capabilities?.imageGeneration ?? group.image?.generations ?? group.kind === "image";
    if (!supportsImages || group.status === "disabled" || group.image?.availability === "unavailable") return [];
    const model = group.image?.defaultModel ?? group.models?.find(isLikelyImageModelId) ?? "gpt-image-2";
    const billing = group.image?.billing;
    const priceLabel = billing?.mode === "per_image" ? `$${billing.usdPerImage.toFixed(2)} / image`
      : billing?.mode === "token_multiplier" ? `Token x${billing.multiplier}` : undefined;
    return [{ providerId: provider.id, groupId: group.id, label: `${provider.name} / ${group.name} / ${model}`, model, notice: group.image?.notice, priceLabel }];
  }));
  const sideChatPermissionLabel = permission === "dangerBypass" ? "Bypass approvals" : "Ask for approval";


  const workbench = useWorkbenchRuntime({  state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId , access, taskTabs: taskTabsRuntime, threadWorkspace, selection, goals, composer, settings , renderConversation, renderSplitPane, activeConversationReadOnly, activeProviderLabel, composerAgentsAction, composerCliBackendAction, composerFreeSavingsAction, runtimeControlSet, composerConnected, composerWorkingStatus, connectionNotice, conversationStatus, conversationStatusLabel, conversationWorking, imageChannels, modeState, newChatSetupDialogOpen, reactivateThreadSubscription, selectedReasoning, sideChatPermissionLabel, workspaceSetupBusy, focusSplitThread });
  const {
    renderWorkspaceNode, renderWorkspaceLayout, renderComposerDock, renderCenterPanel, renderSideChatPanel, renderRightWorkspacePanel, openOfficialWebsite,
    openDiscordInvite, openWorkspaceInVscode, openWorkspaceWith, closeOpenWithMenu, sideChatThreadIds, openedThreadCatalog, unfilteredMainThreads,
    mainThreads, orderedMainThreads, openTaskTabs, taskTabs, splitViewCandidates, beginSplitView, splitPaneWithThread,
    applyWorkspacePreset, separateSplitView, reverseCurrentSplitView, closeSplitSide, selectVisibleTaskTab, placeTaskInSplitSide, closeTaskTabs,
    closeTaskTab, setRemoteThreadMode, detachTaskTab, moveVisibleTaskTab, selectHistoryThread, selectHistoryThreadAfterAttach,
  } = workbench;
  const contextTaskTabIndex = taskTabContextMenu ? openTaskTabs.findIndex((thread) => thread.id === taskTabContextMenu.threadId) : -1;
  const contextTaskTab = contextTaskTabIndex >= 0 ? openTaskTabs[contextTaskTabIndex] : null;
  const contextRemoteLifecycle = contextTaskTab
    ? remoteLifecycleOverrides[contextTaskTab.id] ?? contextTaskTab.remoteLifecycleMode
    : undefined;
  const contextRemoteLifecyclePending = Boolean(contextTaskTab && remoteLifecyclePendingIds.has(contextTaskTab.id));
  const contextPaneThread = paneContextMenu ? mainThreads.find((thread) => thread.id === paneContextMenu.threadId) ?? null : null;
  const contextPaneRemoteLifecycle = contextPaneThread
    ? remoteLifecycleOverrides[contextPaneThread.id] ?? contextPaneThread.remoteLifecycleMode
    : undefined;
  const contextPaneRemoteLifecyclePending = Boolean(contextPaneThread && remoteLifecyclePendingIds.has(contextPaneThread.id));
  const activeTextGroupId = resolveTextRuntimeGroupId(state.providers, activeProviderId, activeGroupId, effectiveSelectedModel);
  const activeTextGroup = activeProvider?.groups?.find((group) => group.id === activeTextGroupId && group.kind !== "image");
  // This is intentionally a plain derivation. Authentication screens return
  // above this point, so using a Hook here would change the Hook count when
  // authStatus transitions from checking to ready (React error #310).
  const permissionLabel = permissionPresetDisplayLabel(permission, t);
  const activeThreadTurns = state.activeThreadId ? turnsByThreadId.get(state.activeThreadId) ?? [] : [];
  const activeThreadUsage = state.activeThreadId ? threadTokenUsage[state.activeThreadId] ?? undefined : undefined;
  let projectStats = projectStatsCacheRef.current;
  if (!projectStats || projectStats.turns !== allTurns || projectStats.threads !== historyThreads || projectStats.usage !== threadTokenUsage) {
    projectStats = {
      turns: allTurns,
      threads: historyThreads,
      usage: threadTokenUsage,
      projectUsage: sumTokenBreakdowns(Object.values(threadTokenUsage).map((usage) => usage.total)),
      historyUsageByThread: buildHistoryUsageByThread(threadTokenUsage),
      requestMonitor: buildRequestMonitorEntries(allTurns, historyThreads, threadTokenUsage),
    };
    projectStatsCacheRef.current = projectStats;
  }
  const { projectUsage, historyUsageByThread, requestMonitor } = projectStats;
  const statsState: WorkbenchStatsState = {
    scope: statsPanelScope ?? "status",
    activeThreadId: state.activeThreadId,
    model: effectiveSelectedModel,
    provider: activeProviderLabel,
    reasoningEffort: fastModeEnabled ? `${reasoningEffortLabel(fastReasoningEffort(reasoningOptions, reasoningEffort))} (Fast)` : reasoningEffortLabel(reasoningEffort),
    permissionLabel,
    sessionTurns: activeThreadTurns.length,
    sessionItems: activeThreadTurns.reduce((total, turn) => total + turn.items.length, 0),
    projectThreads: historyThreads.length,
    projectTurns: allTurns.length,
    threadUsage: activeThreadUsage,
    projectUsage,
    goal: activeGoal,
    modes: modeState
  };

  const onboardingRole: "solo" | "team" = members.length > 1 ? "team" : "solo";
  const shouldAutoStartTour = workspaceSelectionPending && !state.activeThreadId;

  const wb = {
    activateProvider, activeProviderId, activeProviderLabel, activeWorkspaceAdditionalRoots, activeWorkspaceCwd, addAgentRosterRole, additionalRoots,
    agentReadiness, agentReadinessDisplay, agentReadinessJsonOpen, agentReadinessLoading, agentReasoningOptions, agentRosterManagerThreadId, agentsAnchor,
    agyCliEnabled, auggieCliEnabled, clineCliEnabled, commandCodeCliEnabled, allThemePlugins, allowedPermissions, appInstalled, applyRecommendedAgentRoster, applyWorkspacePreset, applyWorkspaceVmPolicyForCwd,
    archiveHistoryThread, auditEvents, authSession, authStatus, beginSplitView, callMcpTool, cancelOfficialOpenAiOAuth,
    cancelTopBarHide, capacityTurnRetryEnabled, changeOpenFileContent, chatTypography, checkAgentReadiness, checkCodexCliUpdate, claudeCliEnabled,
    cliBackendEnabled, cliBackendToggleError, cliBackendVersionLabel, cliInstallations, cliSwitchBusy, cliSwitchConfirmTarget, cliSwitchError,
    cliSwitchNotice, cliSwitcherAnchor, closeDangerDialog, closeOpenWithMenu, closeRightWorkspace, closeSplitSide, closeTaskTab,
    closeTaskTabs, closeWorkspacePaneAndCollapse, codexCliEnabled, codexCliUpdateBusy, codexCliUpdateDialogOpen, codexCliUpdateError, codexCliUpdateStatus,
    codexConfig, codexConfigError, codexConfigLoading, codexConfigSaving, compactCapabilityWarning, compactMode, composerModels,
    confirmDangerDialog, confirmWorkspaceSelection, connectionNotice, connectionStatus, contextPaneRemoteLifecycle, contextPaneRemoteLifecyclePending, contextPaneThread,
    contextRemoteLifecycle, contextRemoteLifecyclePending, contextTaskTab, contextTaskTabIndex, conversationStatus, conversationStatusColor, conversationStatusLabel,
    conversationWorking, copyRelayShare, createRelayShare, createSkill, createWorkspaceFolder, customThemePlugins, cwd,
    cwdForThread, dangerDialogAcknowledged, dangerDialogIntent, dangerDialogPreset, deleteHistoryThread, deleteProvider, desktopLayout,
    detachTaskTab, detachedThreadId, dispatch, downloadProfile, downloadRelayBackup, downloadRelayConfig, draggedTaskTabId,
    effectiveBackgroundScene, effectiveSelectedModel, enterImmersiveView, exitImmersiveView, exportHistoryThread, fastModeEnabled, fileDirectories,
    filesPanelLayout, finishSetupGuide, freeAutoCompactEnabled, freeAutoCompactGroupId, freeAutoCompactModel, freeAutoCompactProviderId, freeAutoCompactThreshold,
    freeCompactionChannelOptions, freeModelAccessOpen, freeModelNotice, freeOllamaEnabled, freebuffSession, freebuffSwitchBusy, freebuffSwitchDialogOpen,
    freebuffSwitchTargetModel, grokCliEnabled, handleAllocateMemberBalance, handleCliBackendToggle, handleCliPluginToggleFromList, handleCliSwitchConfirm, handleConfirmFreebuffSwitch,
    handleCreateMember, handleDeleteMember, handleInstallApp, handleKeepCurrentFreebuffModel, handleNewConversationCliBackend, handleSelectRecentWorkspace, handleUpdateMember,
    historyBackendFilter, historyBackendFilterUserTouchedRef, historyBackgroundImage, historyDateRange, historyLoadProgress, historyLoading, historySearchTerm,
    historyThreads, historyUsageByThread, historyViewMode, immersiveComposerCompact, immersiveComposerHintOpen, immersiveExitHintOpen, immersiveHintSequence,
    immersiveTaskTabsOpen, immersiveView, importRelayShareDirectly, injectClaudeDesktop, injectCursorDesktop, insertPluginMention, installPlugin,
    installPromptEvent, installSshCodex, installThemePlugin, installedThemePluginIds, installingPluginIds, isAgyBackend, isClaudeBackend,
    isCodexBackend, isGrokBackend, isMiniBackend, isMobile, isMuseBackend, isOpencodeBackend, isPiBackend,
    jevCompressThreshold, leftPanelVisible, loadAuditEvents, loadBasics, loadCodexConfig, loadHistory, loadTooling,
    localWorkspaceDefaultPath, localWorkspaceInfo, localWorkspaceProjectsPath, locale, mainThreads, mcpOauthUrls, mcpResourceContents,
    members, membersError, membersLoading, miniVersion, mobileHistoryOpen, mobileTopBarCollapsed, mobileTopBarExpanded,
    mobileTopMenuAnchor, moveVisibleTaskTab, museCliEnabled, newChatAdditionalRootsExpanded, newChatBackendPreview, newChatBudgetLimit, newChatSetupDialogOpen,
    officialLoginNotice, officialLoginOpen, onThemeModeChange, onboardingRole, openCodeWorkspaceFile, openDiscordInvite, openFile,
    openOfficialWebsite, openRelayShareExport, openSettings, openTaskTabs, openTopBar, openWithApps, openWithAppsLoading,
    openWithMenuPosition, openWithTarget, openWorkspacePicker, openWorkspaceWith, opencodeCliEnabled, opencodeV2CliEnabled, paneContextMenu,
    panelLayout, pendingPaneSplit, permission, persistWorkspaceForActiveThread, petDockEnabled, piCliEnabled, placeTaskInSplitSide,
    planModeEnabled, pluginAuthNotices, pluginDetails, pluginSkillPreviews, readDirectory, readFile, readMcpResource,
    readPluginDetail, readPluginSkill, readSkillPreview, reasoningAnchor, reasoningEffort, reasoningIndex, reasoningMax,
    reasoningOptions, recheckSshWorkspace, refreshCliInstallations, relayShareExportBusy, relayShareExportConfirm, relayShareExportError, relayShareExportOpen,
    relayShareExportPassword, relayShareExportText, relayShareImportBusy, relayShareImportError, relayShareImportOpen, relayShareImportPassword, relayShareImportText,
    reloadMcp, reloadMembers, removeCustomThemePlugin, renameHistoryThread, renderCenterPanel, renderRightWorkspacePanel, replaySetupGuide,
    requestNewSession, requestPermissionChange, resolveComposerReasoningOptions, restoreProvider, reverseCurrentSplitView, rightWorkspaceVisible, runningThreadIds,
    runtimeConfigAnchor, runtimeControlSet, runtimeSelection, saveCustomThemePlugin, saveOpenFile, saveProvider, saveSkillExtraRoots,
    scheduleTopBarHide, selectHistoryThread, selectVisibleTaskTab, selectedModel, selectedReasoning, selectedReasoningLabel, separateSplitView,
    setAdditionalRoots, setAgentReadinessJsonOpen, setAgentRosterManagerThreadId, setAgentsAnchor, setCapacityTurnRetryEnabled, setChatTypography, setCliSwitchConfirmTarget,
    setCliSwitchError, setCliSwitchNotice, setCliSwitcherAnchor, setCodexCliUpdateBusy, setCodexCliUpdateDialogOpen, setCodexCliUpdateError, setCompactMode,
    setCwd, setDangerDialogAcknowledged, setDraggedTaskTabId, setFilesPanelLayout, setFreeAutoCompactEnabled, setFreeAutoCompactGroup, setFreeAutoCompactModel,
    setFreeAutoCompactProvider, setFreeAutoCompactThreshold, setFreeModelAccessOpen, setFreeModelNotice, setFreebuffSwitchDialogOpen, setHistoryBackendFilter, setHistoryDateRange,
    setHistorySearchTerm, setHistoryViewMode, setImmersiveComposerHintOpen, setImmersiveExitHintOpen, setImmersiveTaskTabsOpen, setIncludeAutomationHistory, setJevCompressThreshold,
    setLeftPanelVisible, setLocale, setMobileHistoryOpen, setMobileTopBarCollapsedPersisted, setMobileTopBarExpanded, setMobileTopMenuAnchor, setNewChatAdditionalRootsExpanded,
    setNewChatBudgetLimit, setNewChatSetupOpen, setOfficialLoginNotice, setOfficialLoginOpen, setPaneContextMenu, setPanelLayout, setPendingPaneSplit,
    setPetDockEnabled, setReasoningAnchor, setReasoningEffort, setRelayShareExportConfirm, setRelayShareExportError, setRelayShareExportOpen, setRelayShareExportPassword,
    setRelayShareImportError, setRelayShareImportOpen, setRelayShareImportPassword, setRelayShareImportText, setRemoteThreadMode, setRightWorkspaceTab, setRightWorkspaceVisible,
    setRuntimeConfigAnchor, setSettingAssistantModel, setSettingAssistantProviderId, setSettingsOpen, setShowAssistantUsageDetails, setSplitViewBaseThreadId, setSplitViewMenuAnchor,
    setSplitViewMenuPosition, setSplitViewSearch, setSshCommand, setSshConfigHostAlias, setSshCwd, setSshInstallConfirming, setSshPreflightIssue,
    setStatsPanelScope, setTaskNotificationPreferences, setTaskTabContextMenu, setTopBarOpen, setTopBarPinned, setWaterfallDisplayMode, setWorkspaceLayout,
    setWorkspaceMode, setWorkspaceNewFolderName, setWorkspacePickerOpen, setWorkspacePickerPath, settingAssistantEffectiveModel, settingAssistantModel, settingAssistantProviderId,
    settingAssistantReady, settingsOpen, settingsPluginTab, settingsRelayTarget, settingsSection, setupGuideOpen, shellBackgroundImage,
    shellBackgroundVideo, shouldAutoStartTour, showAssistantUsageDetails, showOpenWithMenu, showReasoningGlow, skillExtraRoots, skillPreviews,
    splitDropHandledRef, splitPaneWithThread, splitView, splitViewCandidates, splitViewMenuAnchor, splitViewMenuPosition, splitViewSearch,
    sshCommand, sshConfigHostAlias, sshConfigHostControl, sshCwd, sshDetectedHome, sshInstallBusy, sshInstallCommand,
    sshInstallConfirming, sshInstallError, sshPreflightIssue, startMcpOauth, startOfficialOpenAiOAuth, state, syncFreeOllama,
    syncOmniRouteFree, systemMetricsScope, t, taskNotificationPreferences, taskTabContextMenu, taskTabs, testProviderWithCodex,
    themeMode, themeTuning, threadRuntimeSelections, toggleSkill, topBarOpen, topBarPinned, unfilteredMainThreads,
    uninstallPlugin, uninstallThemePlugin, updateAgentRosterRole, updateAgentRuntime, uploadCapabilityCatalog, uploadProfile, uploadRelayBackup,
    uploadRelayConfig, useSaferModeFromDangerDialog, waterfallDisplayMode, windowsDesktop, windowsWorkspaceHost, workspaceCreateBusy, workspaceHostPlatform,
    workspaceLayout, workspaceMode, workspaceNewFolderName, workspacePickerFiles, workspacePickerFolders, workspacePickerLoading, workspacePickerOpen,
    workspacePickerParent, workspacePickerPath, workspacePickerPurpose, workspaceSetupBusy, writeCodexConfigField, writeCodexConfigValue,
  };
  return <WorkbenchRoot wb={wb} />;
}
