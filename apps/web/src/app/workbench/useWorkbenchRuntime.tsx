import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { CenterPanelView } from "../../shell/CenterPanelView";
import { ComposerDockView } from "../../shell/ComposerDockView";
import { RightWorkspacePanelView } from "../../shell/RightWorkspacePanelView";
import { SideChatPanelView } from "../../shell/SideChatPanelView";
import { WorkspaceLayoutView, WorkspaceNodeView } from "../../shell/WorkspaceNodeView";
import { type ThreadEntry, setRemoteThreadForeground } from "../../state/codexClient";
import { type WorkspaceLayoutNode } from "../../taskTabs";
import { saveWorkspaceVmPolicy } from "../../utils/recentWorkspaces";
import { catalogForOpenedThreads, displayThreadTitle, filterThreadsByDateRange } from "../threads/threadCatalog";
import { cliPlugin } from "../cli/cliPlugins";
import { reconcileOpenedTaskTabOrder } from "../../taskTabs";
import { DISCORD_INVITE_URL, OFFICIAL_WEBSITE_URL } from "./appConstants";
import { formatErrorText } from "./appUtils";

import { useSplitReconcileEffects, useTaskTabsSplit } from "./useTaskTabsSplit";
import { ComposerBackgroundControl } from "../../shell/ComposerChromeActions";
import type { ThreadCatalog } from "../threads/threadCatalog";
import type { ComposerWorkingStatus } from "../../composer/Composer";
import type { ReasoningOption } from "../../settings/SettingsDrawer";
import type { AppProps } from "./appConstants";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { useAccessRuntime } from "./useAccessRuntime";
import type { useTaskTabsRuntime } from "./useTaskTabsRuntime";
import type { useThreadWorkspaceRuntime } from "./useThreadWorkspaceRuntime";
import type { useSelectionRuntime } from "./useSelectionRuntime";
import type { useGoalRuntime } from "./useGoalRuntime";
import type { useComposerRuntime } from "./useComposerRuntime";
import type { useSettingsRuntime } from "./useSettingsRuntime";

export function useWorkbenchRuntime(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  themeMode: AppProps["themeMode"];
  customThemePlugins: AppProps["customThemePlugins"];
  onThemeModeChange: AppProps["onThemeModeChange"];
  onCustomThemePluginsChange: AppProps["onCustomThemePluginsChange"];
  detachedThreadId: string | null;
  renderConversation: (threadId: string | null, focused: boolean) => ReactNode;
  renderSplitPane: (threadId: string, side: "left" | "right", paneId?: string) => ReactNode;
  activeConversationReadOnly: boolean;
  activeProviderLabel: string;
  composerAgentsAction: ReactNode;
  composerCliBackendAction: ReactNode;
  composerFreeSavingsAction: ReactNode;
  runtimeControlSet: ReactNode;
  composerConnected: boolean;
  composerWorkingStatus: ComposerWorkingStatus | null;
  connectionNotice: string;
  conversationStatus: string;
  conversationStatusLabel: string;
  conversationWorking: boolean;
  imageChannels: import("../../shell/ComposerDockView").ComposerDockViewProps["imageChannels"];
  modeState: import("../../shell/ComposerDockView").ComposerDockViewProps["modeState"];
  newChatSetupDialogOpen: boolean;
  reactivateThreadSubscription: () => void;
  selectedReasoning: ReasoningOption | undefined;
  sideChatPermissionLabel: string;
  workspaceSetupBusy: boolean;
  focusSplitThread: (threadId: string) => void;
  access: ReturnType<typeof useAccessRuntime>;
  taskTabs: ReturnType<typeof useTaskTabsRuntime>;
  threadWorkspace: ReturnType<typeof useThreadWorkspaceRuntime>;
  selection: ReturnType<typeof useSelectionRuntime>;
  goals: ReturnType<typeof useGoalRuntime>;
  composer: ReturnType<typeof useComposerRuntime>;
  settings: ReturnType<typeof useSettingsRuntime>;
}) {
  const { state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId } = input;
  const {
    renderConversation, renderSplitPane, activeConversationReadOnly, activeProviderLabel,
    composerAgentsAction, composerCliBackendAction,
    composerFreeSavingsAction, runtimeControlSet, composerConnected, composerWorkingStatus,
    connectionNotice, conversationStatus, conversationStatusLabel, conversationWorking, imageChannels,
    modeState, newChatSetupDialogOpen, reactivateThreadSubscription,
    selectedReasoning, sideChatPermissionLabel, workspaceSetupBusy, focusSplitThread,
  } = input;
  const {
    connectionStatus,
    dangerDialogIntent,
    workspaceMode,
    setWorkspaceMode,
    cwd,
    setCwd,
    additionalRoots,
    setAdditionalRoots,
    setWorkspaceFilePath,
    workspaceSelectionPending,
    setWorkspaceSelectionPending,
    sshCommand,
    setSshCommand,
    sshCwd,
    setSshCwd,
    planImplementationPrompt,
    setSlashNotice,
    threadTokenUsage,
    usageStore,
    historyDateRange,
    setThreadHistoryPages,
    allHistoryThreadsRef,
    threadHistoryPagesRef,
  } = input.access;
  const {
    closedTaskTabIds,
    setClosedTaskTabIds,
    taskTabOrder,
    setTaskTabOrder,
    pendingPaneSplit,
    setPendingPaneSplit,
    setSplitViewMenuAnchor,
    setSplitViewMenuPosition,
    splitViewSearch,
    setSplitViewSearch,
    splitViewBaseThreadId,
    setSplitViewBaseThreadId,
    splitView,
    setSplitView,
    workspaceLayout,
    setWorkspaceLayout,
    detachedTaskIds,
    setDetachedTaskIds,
    splitMutationEpochRef,
    setRemoteLifecycleOverrides,
    remoteLifecyclePendingIds,
    setRemoteLifecyclePendingIds,
    setOpenWithMenuPosition,
    openWithTarget,
    setOpenWithTarget,
    windowsWorkspaceHost,
    immersiveView,
    immersiveComposerCompact,
    setImmersiveComposerCompact,
    setImmersiveComposerHintOpen,
    immersiveComposerDockRef,
    resetImmersiveComposerOffset,
    beginImmersiveComposerDrag,
    moveImmersiveComposer,
    endImmersiveComposerDrag,
    chatTypography,
    rightWorkspaceTab,
    setRightWorkspaceTab,
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
    setRuntimeConfigAnchor,
    pendingMention,
    setPendingMention,
    composerSuggestion,
    setComposerSuggestion,
    setWelcomeDismissed,
    remoteLifecycleOverrides,
    remoteBackgroundStarting,
  } = input.taskTabs;
  const {
    fileTabs,
    openFile,
    activeThreadIdRef,
    webPreview,
    closeWebPreview,
    topicTranscriptStore,
  } = input.threadWorkspace;
  const {
    runtimeSelection,
    imageRuntimeSelection,
    selectionForThread,
    historySelectionForThread,
    updateRuntimeSelection,
    updateNewConversationRuntimeSelection,
    setSelectedModel,
    updateImageRuntimeSelection,
    loadPersistedThreadRuntimeSelection,
    persistThreadRuntimeSelection,
    vmEnabled,
    selectedModel,
    handleNewConversationCliBackend,
    reasoningEffort,
    planModeEnabled,
    permission,
    dangerBypassPermissionConfirmed,
    freebuffFallbackSuggestion,
    setFreebuffFallbackSuggestion,
    refreshFreebuffSession,
    desktopLayout,
    isMobile,
    t,
    allowedPermissions,
  } = input.selection;
  const {
    client,
    goalResumePrompt,
    goalResumeSubmitting,
    confirmGoalResume,
    pauseGoalResume,
    cwdForThread,
    activeWorkspaceCwd,
    sideChatTabs,
    activeSideChatId,
    setActiveSideChatId,
    sideChatError,
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
    changeOpenFileContent,
    activeWorkspaceDirectories,
    terminalSessions,
    ptyTerminals,
    ptyFocusTerminalId,
    setPtyFocusTerminalId,
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
    composerModels,
  } = input.goals;
  const {
    stayInPlanMode,
    implementApprovedPlan,
    sendPrompt,
    steerPrompt,
    sendSideChatPrompt,
    configuredContextWindow,
    displayedContextModel,
    displayedContextGroup,
    displayedThreadContextWindow,
    activeComposerThreadUsage,
    composerGitBranch,
    composerGitDirtyCount,
    readActiveWorkspaceDirectory,
    workspaceGitRpc,
    readActiveWorkspaceFile,
    saveActiveWorkspaceFile,
    workspaceFileMutations,
    closeRightWorkspace,
    reviewWaterfallFileChanges,
    openWorkspacePicker,
    windowsDesktop,
    activeThemePlugin,
    composerBackgroundImage,
    themeTuning,
    petImage,
    showThemePet,
    activeRunningTurn,
    stopActiveTurn,
    runningThreadIds,
    startRemoteBackgroundConversation,
  } = input.composer;
  const {
    openSettings,
    handleRelayShareText,
    loadTooling,
    loadThreadIntoCache,
    handleSelectRecentWorkspace,
    openExistingThread,
    persistWorkspaceForActiveThread,
    requestPermissionChange,
    confirmWorkspaceSelection,
    selectTaskTab,
  } = input.settings;

  const renderWorkspaceNode = (node: WorkspaceLayoutNode): ReactNode => (
    <WorkspaceNodeView node={node} workspaceLayout={workspaceLayout} renderSplitPane={renderSplitPane} />
  );

  const renderWorkspaceLayout = () => (
    <WorkspaceLayoutView workspaceLayout={workspaceLayout} renderSplitPane={renderSplitPane} />
  );


  const renderComposerDock = (official: boolean = false) => (
    <ComposerDockView
      composerBackendName={cliPlugin(runtimeSelection.cliBackend).label}
      official={official}
      showThemePet={showThemePet}
      petImage={petImage}
      themeTuning={themeTuning}
      immersiveComposerDockRef={immersiveComposerDockRef}
      immersiveView={immersiveView}
      isMobile={isMobile}
      beginImmersiveComposerDrag={beginImmersiveComposerDrag}
      reactivateThreadSubscription={reactivateThreadSubscription}
      moveImmersiveComposer={moveImmersiveComposer}
      endImmersiveComposerDrag={endImmersiveComposerDrag}
      immersiveComposerCompact={immersiveComposerCompact}
      freebuffFallbackSuggestion={freebuffFallbackSuggestion}
      setFreebuffFallbackSuggestion={setFreebuffFallbackSuggestion}
      state={state}
      activeThreadIdRef={activeThreadIdRef}
      setSelectedModel={setSelectedModel}
      updateNewConversationRuntimeSelection={updateNewConversationRuntimeSelection}
      refreshFreebuffSession={refreshFreebuffSession}
      setSlashNotice={setSlashNotice}
      activeWorkspaceCwd={activeWorkspaceCwd}
      activeProviderLabel={activeProviderLabel}
      selectedModel={selectedModel}
      setRuntimeConfigAnchor={setRuntimeConfigAnchor}
      activeConversationReadOnly={activeConversationReadOnly}
      t={t}
      openWorkspacePicker={openWorkspacePicker}
      activeWorkspaceAdditionalRoots={activeWorkspaceAdditionalRoots}
      additionalRoots={additionalRoots}
      setAdditionalRoots={setAdditionalRoots}
      persistWorkspaceForActiveThread={persistWorkspaceForActiveThread}
      permission={permission}
      composerConnected={composerConnected}
      connectionStatus={connectionStatus}
      connectionNotice={connectionNotice}
      pendingMention={pendingMention}
      composerSuggestion={composerSuggestion}
      activeThemePlugin={activeThemePlugin}
      composerBackgroundImage={composerBackgroundImage}
      modeState={modeState}
      dangerBypassPermissionConfirmed={dangerBypassPermissionConfirmed}
      conversationWorking={conversationWorking}
      composerWorkingStatus={composerWorkingStatus}
      conversationStatus={conversationStatus}
      conversationStatusLabel={conversationStatusLabel}
      composerBackgroundControl={composerBackgroundControl}
      desktopLayout={desktopLayout}
      runtimeControlSet={runtimeControlSet}
      setImmersiveComposerCompact={setImmersiveComposerCompact}
      resetImmersiveComposerOffset={resetImmersiveComposerOffset}
      setImmersiveComposerHintOpen={setImmersiveComposerHintOpen}
      imageChannels={imageChannels}
      imageRuntimeSelection={imageRuntimeSelection}
      updateImageRuntimeSelection={updateImageRuntimeSelection}
      activeComposerThreadUsage={activeComposerThreadUsage}
      threadTokenUsage={threadTokenUsage}
      displayedThreadContextWindow={displayedThreadContextWindow}
      configuredContextWindow={configuredContextWindow}
      displayedContextGroup={displayedContextGroup}
      displayedContextModel={displayedContextModel}
      composerCliBackendAction={composerCliBackendAction}
      composerFreeSavingsAction={composerFreeSavingsAction}
      composerAgentsAction={composerAgentsAction}
      composerGitBranch={composerGitBranch}
      composerGitDirtyCount={composerGitDirtyCount}
      reviewWaterfallFileChanges={reviewWaterfallFileChanges}
      vmEnabled={vmEnabled}
      runtimeSelection={runtimeSelection}
      updateRuntimeSelection={updateRuntimeSelection}
      selectionForThread={selectionForThread}
      persistThreadRuntimeSelection={persistThreadRuntimeSelection}
      saveWorkspaceVmPolicy={saveWorkspaceVmPolicy}
      loadTooling={loadTooling}
      allowedPermissions={allowedPermissions}
      requestPermissionChange={requestPermissionChange}
      activeRunningTurn={activeRunningTurn}
      stopActiveTurn={stopActiveTurn}
      handleRelayShareText={handleRelayShareText}
      mainThreads={mainThreads}
      openSettings={openSettings}
      setPendingMention={setPendingMention}
      setWelcomeDismissed={setWelcomeDismissed}
      setComposerSuggestion={setComposerSuggestion}
      planModeEnabled={planModeEnabled}
      sendPrompt={sendPrompt}
      steerPrompt={steerPrompt}
      cwd={cwd}
    />
  );

  const renderCenterPanel = () => (
    <CenterPanelView
      chatTypography={chatTypography}
      immersiveView={immersiveView}
      themeTuning={themeTuning}
      state={state}
      t={t}
      workspaceSelectionPending={workspaceSelectionPending}
      newChatSetupDialogOpen={newChatSetupDialogOpen}
      dangerDialogIntent={dangerDialogIntent}
      windowsWorkspaceHost={windowsWorkspaceHost}
      cwd={cwd}
      setCwd={setCwd}
      workspaceSetupBusy={workspaceSetupBusy}
      openWorkspacePicker={openWorkspacePicker}
      confirmWorkspaceSelection={confirmWorkspaceSelection}
      runtimeSelection={runtimeSelection}
      handleNewConversationCliBackend={handleNewConversationCliBackend}
      codexCliEnabled={codexCliEnabled}
      claudeCliEnabled={claudeCliEnabled}
      agyCliEnabled={agyCliEnabled}
      auggieCliEnabled={auggieCliEnabled}
      clineCliEnabled={clineCliEnabled}
      commandCodeCliEnabled={commandCodeCliEnabled}
      grokCliEnabled={grokCliEnabled}
      museCliEnabled={museCliEnabled}
      piCliEnabled={piCliEnabled}
      opencodeCliEnabled={opencodeCliEnabled}
      opencodeV2CliEnabled={opencodeV2CliEnabled}
      handleSelectRecentWorkspace={handleSelectRecentWorkspace}
      workspaceLayout={workspaceLayout}
      desktopLayout={desktopLayout}
      renderWorkspaceLayout={renderWorkspaceLayout}
      renderConversation={renderConversation}
      planImplementationPrompt={planImplementationPrompt}
      stayInPlanMode={stayInPlanMode}
      implementApprovedPlan={implementApprovedPlan}
      goalResumePrompt={goalResumePrompt}
      goalResumeSubmitting={goalResumeSubmitting}
      pauseGoalResume={pauseGoalResume}
      confirmGoalResume={confirmGoalResume}
      themeMode={themeMode}
      renderComposerDock={renderComposerDock}
    />
  );

  const renderSideChatPanel = () => (
    <SideChatPanelView
      sideChatTabs={sideChatTabs}
      activeSideChatId={activeSideChatId}
      selectedModel={selectedModel}
      state={state}
      topicTranscriptStore={topicTranscriptStore}
      composerModels={composerModels}
      selectedReasoning={selectedReasoning}
      reasoningEffort={reasoningEffort}
      sideChatPermissionLabel={sideChatPermissionLabel}
      sideChatError={sideChatError}
      setActiveSideChatId={setActiveSideChatId}
      addSideChatTab={addSideChatTab}
      closeSideChatTab={closeSideChatTab}
      closeRightWorkspace={closeRightWorkspace}
      changeSideChatDraft={changeSideChatDraft}
      changeSideChatModel={changeSideChatModel}
      toggleSideChatWebSearch={toggleSideChatWebSearch}
      attachSideChatFiles={attachSideChatFiles}
      removeSideChatAttachment={removeSideChatAttachment}
      createSideChatImage={createSideChatImage}
      t={t}
      sendSideChatPrompt={sendSideChatPrompt}
    />
  );

  const renderRightWorkspacePanel = () => (
    <RightWorkspacePanelView
      rightWorkspaceTab={rightWorkspaceTab}
      setRightWorkspaceTab={setRightWorkspaceTab}
      renderSideChatPanel={renderSideChatPanel}
      activeWorkspaceCwd={activeWorkspaceCwd}
      activeWorkspaceDirectories={activeWorkspaceDirectories}
      openFile={openFile}
      webPreview={webPreview}
      terminalSessions={terminalSessions}
      ptyTerminals={ptyTerminals}
      createPtyTerminal={createPtyTerminal}
      writePtyTerminal={writePtyTerminal}
      killPtyTerminal={killPtyTerminal}
      forgetPtyTerminal={forgetPtyTerminal}
      resizePtyTerminal={resizePtyTerminal}
      loadPtyTail={loadPtyTail}
      ptyFocusTerminalId={ptyFocusTerminalId}
      setPtyFocusTerminalId={setPtyFocusTerminalId}
      closeWebPreview={closeWebPreview}
      closeRightWorkspace={closeRightWorkspace}
      readActiveWorkspaceDirectory={readActiveWorkspaceDirectory}
      readActiveWorkspaceFile={readActiveWorkspaceFile}
      changeOpenFileContent={changeOpenFileContent}
      saveActiveWorkspaceFile={saveActiveWorkspaceFile}
      fileTabs={fileTabs}
      workspaceFileMutations={workspaceFileMutations}
      runTerminalCommand={runTerminalCommand}
      writeTerminalInput={writeTerminalInput}
      terminateTerminal={terminateTerminal}
      resizeTerminal={resizeTerminal}
      workspaceGitRpc={workspaceGitRpc}
      activeWorkspaceSshCommand={activeWorkspaceSshCommand}
      activeWorkspaceSshCwd={activeWorkspaceSshCwd}
      windowsDesktop={windowsDesktop}
    />
  );

  const openOfficialWebsite = useCallback(() => {
    if (window.codexUltraDesktop) {
      void window.codexUltraDesktop.openExternal(OFFICIAL_WEBSITE_URL);
      return;
    }
    window.open(OFFICIAL_WEBSITE_URL, "_blank", "noopener,noreferrer");
  }, []);

  const openDiscordInvite = useCallback(() => {
    if (window.codexUltraDesktop) {
      void window.codexUltraDesktop.openExternal(DISCORD_INVITE_URL);
      return;
    }
    window.open(DISCORD_INVITE_URL, "_blank", "noopener,noreferrer");
  }, []);

  const openWorkspaceInVscode = useCallback(() => {
    void window.codexUltraDesktop?.openVscode({
      cwd: activeWorkspaceCwd,
      sshCommand: activeWorkspaceSshCommand,
      sshCwd: activeWorkspaceSshCwd
    });
  }, [activeWorkspaceCwd, activeWorkspaceSshCommand, activeWorkspaceSshCwd]);
  const openWorkspaceWith = useCallback((appId: string) => {
    const target = openWithTarget ?? { cwd: activeWorkspaceCwd, workspaceMode: activeWorkspaceMode, sshCommand: activeWorkspaceSshCommand, sshCwd: activeWorkspaceSshCwd };
    const payload = {
      cwd: target.cwd,
      sshCommand: target.workspaceMode === "ssh" ? target.sshCommand : "",
      sshCwd: target.workspaceMode === "ssh" ? target.sshCwd : ""
    };
    if (appId === "terminal") { void window.codexUltraDesktop?.openTerminal(payload); return; }
    void window.codexUltraDesktop?.openWith({ appId, ...payload });
  }, [activeWorkspaceCwd, activeWorkspaceMode, activeWorkspaceSshCommand, activeWorkspaceSshCwd, openWithTarget]);
  const closeOpenWithMenu = useCallback(() => {
    setOpenWithMenuPosition(null);
    setOpenWithTarget(null);
  }, []);







  const sideChatThreadIds = useMemo(
    () => new Set(sideChatTabs.map((tab) => tab.threadId).filter((threadId): threadId is string => Boolean(threadId))),
    [sideChatTabs]
  );
  const openedThreadCatalog = useMemo(() => catalogForOpenedThreads(
    state.threads,
    allHistoryThreadsRef.current,
    [state.activeThreadId, ...taskTabOrder, ...(workspaceLayout?.panes.map((pane) => pane.threadId) ?? [])]
  ), [state.activeThreadId, state.threads, taskTabOrder, workspaceLayout]);
  const unfilteredMainThreads = useMemo(
    () => openedThreadCatalog.filter((thread) => !sideChatThreadIds.has(thread.id) && !thread.parentThreadId),
    [openedThreadCatalog, sideChatThreadIds]
  );
  const mainThreads = useMemo(
    () => filterThreadsByDateRange(unfilteredMainThreads, historyDateRange),
    [historyDateRange, unfilteredMainThreads]
  );
  const orderedMainThreads = useMemo(() => {
    const threadById = new Map(unfilteredMainThreads.map((thread) => [thread.id, thread]));
    return reconcileOpenedTaskTabOrder(taskTabOrder, unfilteredMainThreads)
      .map((id) => threadById.get(id))
      .filter((thread): thread is ThreadEntry => Boolean(thread));
  }, [taskTabOrder, unfilteredMainThreads]);

  useEffect(() => {
    setTaskTabOrder((current) => {
      const next = reconcileOpenedTaskTabOrder(current, unfilteredMainThreads);
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [unfilteredMainThreads]);



  const openTaskTabs = orderedMainThreads.filter((thread) =>
    !closedTaskTabIds.includes(thread.id) &&
    (detachedThreadId ? thread.id === detachedThreadId : !detachedTaskIds.has(thread.id))
  );
  const taskTabs = openTaskTabs.slice(0, 12);
  const splitViewCandidates = [...mainThreads]
    .filter((thread: ThreadEntry) => pendingPaneSplit
      ? !workspaceLayout?.panes.some((pane) => pane.threadId === thread.id)
      : thread.id !== (splitViewBaseThreadId ?? state.activeThreadId))
    .filter((thread: ThreadEntry) => {
      const query = splitViewSearch.trim().toLowerCase();
      return !query || `${displayThreadTitle(thread)} ${thread.preview ?? ""} ${thread.cwd ?? ""}`.toLowerCase().includes(query);
    })
    .sort((left: ThreadEntry, right: ThreadEntry) => Number(runningThreadIds.has(right.id)) - Number(runningThreadIds.has(left.id))
      || ((right.recencyAt ?? right.updatedAt ?? 0) - (left.recencyAt ?? left.updatedAt ?? 0)));
  const { beginSplitView, splitPaneWithThread, applyWorkspacePreset, separateSplitView, reverseCurrentSplitView, closeSplitSide, selectVisibleTaskTab, placeTaskInSplitSide, closeTaskTabs, closeTaskTab, setRemoteThreadMode, detachTaskTab, moveVisibleTaskTab } = useTaskTabsSplit({ state, dispatch, client, t, splitView, setSplitView, workspaceLayout, setWorkspaceLayout, splitMutationEpochRef, setClosedTaskTabIds, setTaskTabOrder, setSplitViewMenuAnchor, setSplitViewMenuPosition, setSplitViewSearch, splitViewBaseThreadId, setSplitViewBaseThreadId, pendingPaneSplit, setPendingPaneSplit, detachedTaskIds, setDetachedTaskIds, mainThreads, orderedMainThreads, openTaskTabs, runningThreadIds, desktopLayout, detachedThreadId, activeThreadIdRef, allHistoryThreadsRef, threadHistoryPagesRef, setThreadHistoryPages, topicTranscriptStore, usageStore, loadThreadIntoCache, selectTaskTab, openExistingThread, cwdForThread, setRemoteLifecycleOverrides, setRemoteLifecyclePendingIds, remoteLifecyclePendingIds, setWorkspaceSelectionPending, setWorkspaceMode, setWorkspaceFilePath, setCwd, setAdditionalRoots, setSshCommand, setSshCwd, historySelectionForThread, loadPersistedThreadRuntimeSelection, focusSplitThread });
  const selectHistoryThread = (threadId: string) => {
    const thread = mainThreads.find((entry) => entry.id === threadId);
    if (thread?.remoteExecutionMode === "autonomous" && state.token) {
      void setRemoteThreadForeground(state.token, threadId, true)
        .then(() => {
          setRemoteLifecycleOverrides((current) => ({ ...current, [threadId]: "foreground" }));
          selectHistoryThreadAfterAttach(threadId);
        })
        .catch((error) => dispatch({ type: "error", message: formatErrorText(error) }));
      return;
    }
    selectHistoryThreadAfterAttach(threadId);
  };

  const selectHistoryThreadAfterAttach = (threadId: string) => {
    if (workspaceLayout || splitView) {
      selectVisibleTaskTab(threadId);
      return;
    }
    splitMutationEpochRef.current += 1;
    // History selection must use the same tab activation path as the top
    // strip. This clears a stale closed-tab marker before loading the topic.
    selectTaskTab(threadId);
  };

  useSplitReconcileEffects({ workspaceLayout, splitView, mainThreads, setWorkspaceLayout, setSplitView, setTaskTabOrder, topicTranscriptStore, loadThreadIntoCache, state, focusSplitThread });

  const composerRemoteThread = state.activeThreadId ? mainThreads.find((thread) => thread.id === state.activeThreadId) ?? null : null;
  const composerRemoteLifecycle = composerRemoteThread
    ? remoteLifecycleOverrides[composerRemoteThread.id] ?? composerRemoteThread.remoteLifecycleMode
    : undefined;
  const composerRemoteAutonomous = composerRemoteThread?.remoteExecutionMode === "autonomous";
  const composerRemotePending = Boolean(composerRemoteThread && remoteLifecyclePendingIds.has(composerRemoteThread.id));
  const composerBackgroundControl = (
    <ComposerBackgroundControl
        t={t}
        composerRemoteAutonomous={composerRemoteAutonomous}
        composerRemotePending={composerRemotePending}
        composerRemoteThread={composerRemoteThread}
        composerRemoteLifecycle={composerRemoteLifecycle}
        setRemoteThreadMode={setRemoteThreadMode}
        dispatch={dispatch}
        workspaceMode={workspaceMode}
        sshCommand={sshCommand}
        remoteBackgroundStarting={remoteBackgroundStarting}
        startRemoteBackgroundConversation={startRemoteBackgroundConversation}
    />
  );

  return {
    renderWorkspaceNode,
    renderWorkspaceLayout,
    renderComposerDock,
    renderCenterPanel,
    renderSideChatPanel,
    renderRightWorkspacePanel,
    openOfficialWebsite,
    openDiscordInvite,
    openWorkspaceInVscode,
    openWorkspaceWith,
    closeOpenWithMenu,
    sideChatThreadIds,
    openedThreadCatalog,
    unfilteredMainThreads,
    mainThreads,
    orderedMainThreads,
    openTaskTabs,
    taskTabs,
    splitViewCandidates,
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
    selectHistoryThread,
    selectHistoryThreadAfterAttach,
  };
}
