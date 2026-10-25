import { SettingsDrawerHost } from "./SettingsDrawerHost";
import { WorkbenchChatGptShell } from "./WorkbenchChatGptShell";
import { WorkbenchDrawers } from "./WorkbenchShellExtras";
import { AgentRosterManagerDialog } from "../components/AgentRosterManagerDialog";
import { FreeModelAccessDialog } from "../components/FreeModelAccessDialog";
import { FreebuffModelSwitchDialog } from "../components/FreebuffModelSwitchDialog";
import { OfficialOpenAiLoginDialog } from "../components/OfficialOpenAiLoginDialog";
import { SettingsSectionId } from "../settings/SettingsDrawer";
import { CliSwitchDialog } from "../components/dialogs/CliSwitchDialog";
import { CodexCliUpdateDialog } from "../components/dialogs/CodexCliUpdateDialog";
import { DangerNewChatDialog } from "../components/dialogs/DangerNewChatDialog";
import { NewChatSetupDialog } from "../components/dialogs/NewChatSetupDialog";
import { RelayShareDialogs } from "../components/dialogs/RelayShareDialogs";
import { SshCodexInstallDialog } from "../components/dialogs/SshCodexInstallDialog";
import { WorkspacePickerDialog } from "../components/dialogs/WorkspacePickerDialog";
import { CliVersionSwitcher } from "./CliVersionSwitcher";
import { WorkbenchMainArea } from "./WorkbenchMainArea";
import { WorkbenchMenus } from "./WorkbenchMenus";
import { WorkbenchOverlays } from "./WorkbenchOverlays";
import { WorkbenchTaskTabs } from "./WorkbenchTaskTabs";
import { WorkbenchTopBar } from "./WorkbenchTopBar";
import { OnboardingTour } from "../onboarding/OnboardingTour";
import { SetupGuideDialog } from "../setup-guide/SetupGuideDialog";
import { recordRecentWorkspace } from "../utils/recentWorkspaces";
import { type ChannelGroupConfig, type ProviderConfig } from "@codex-ui/shared";
import { Alert, Box, Snackbar } from "@mui/material";



export function WorkbenchRoot({ wb }: { wb: any }) {
  const {
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
  } = wb;
  return (
    <OnboardingTour t={t} role={onboardingRole} shouldAutoStart={shouldAutoStartTour}>
      <>
      <WorkbenchChatGptShell wb={wb} />
      <Box
      sx={{
        height: "100dvh",
        maxHeight: "100dvh",
        boxSizing: "border-box",
        display: themeMode === "chatgpt" && !immersiveView ? "contents" : "grid",
        gridTemplateRows: immersiveView
          ? "minmax(0, 1fr)"
          : isMobile
            ? "auto minmax(0, 1fr)"
            : topBarPinned
              ? "56px minmax(0, 1fr)"
              : "0px minmax(0, 1fr)",
        gap: immersiveView || !topBarPinned || isMobile ? 0 : { xs: 1, sm: 1.25, lg: 1.5 },
        p: immersiveView || !topBarPinned || isMobile ? 0 : { xs: 1, sm: 1.5, lg: 2.5 },
        position: "relative",
        bgcolor: "background.default",
        overflow: "hidden",
        transition: "grid-template-rows 280ms cubic-bezier(.2,.8,.2,1), padding 280ms cubic-bezier(.2,.8,.2,1)",
        "@media (prefers-reduced-motion: reduce)": { transition: "none" }
      }}
    >
      {(themeMode !== "chatgpt" || immersiveView) && (
      <>
      <WorkbenchOverlays
        t={t}
        detachedThreadId={detachedThreadId}
        shellBackgroundImage={shellBackgroundImage}
        shellBackgroundVideo={shellBackgroundVideo}
        effectiveBackgroundScene={effectiveBackgroundScene}
        themeTuning={themeTuning}
        immersiveView={immersiveView}
        immersiveHintSequence={immersiveHintSequence}
        immersiveExitHintOpen={immersiveExitHintOpen}
        setImmersiveExitHintOpen={setImmersiveExitHintOpen}
        immersiveComposerHintOpen={immersiveComposerHintOpen}
        setImmersiveComposerHintOpen={setImmersiveComposerHintOpen}
        immersiveComposerCompact={immersiveComposerCompact}
        connectionStatus={connectionStatus}
        immersiveTaskTabsOpen={immersiveTaskTabsOpen}
        setImmersiveTaskTabsOpen={setImmersiveTaskTabsOpen}
        openSettings={openSettings}
        systemMetricsScope={systemMetricsScope}
        exitImmersiveView={exitImmersiveView}
        desktopLayout={desktopLayout}
        leftPanelVisible={leftPanelVisible}
        setLeftPanelVisible={setLeftPanelVisible}
        mobileHistoryOpen={mobileHistoryOpen}
        setMobileHistoryOpen={setMobileHistoryOpen}
        taskTabs={taskTabs}
        dangerDialogIntent={dangerDialogIntent}
        selectVisibleTaskTab={selectVisibleTaskTab}
        setTaskTabContextMenu={setTaskTabContextMenu}
        runningThreadIds={runningThreadIds}
        requestNewSession={requestNewSession}
        permission={permission}
        topBarPinned={topBarPinned}
        topBarOpen={topBarOpen}
        setTopBarOpen={setTopBarOpen}
        cancelTopBarHide={cancelTopBarHide}
        openTopBar={openTopBar}
        state={state}
      />
      <WorkbenchTopBar
        t={t}
        immersiveView={immersiveView}
        isMobile={isMobile}
        topBarPinned={topBarPinned}
        openTopBar={openTopBar}
        scheduleTopBarHide={scheduleTopBarHide}
        topBarOpen={topBarOpen}
        themeTuning={themeTuning}
        enterImmersiveView={enterImmersiveView}
        openOfficialWebsite={openOfficialWebsite}
        openDiscordInvite={openDiscordInvite}
        fastModeEnabled={fastModeEnabled}
        reasoningOptions={reasoningOptions}
        reasoningEffort={reasoningEffort}
        planModeEnabled={planModeEnabled}
        permission={permission}
        requestNewSession={requestNewSession}
        systemMetricsScope={systemMetricsScope}
        desktopLayout={desktopLayout}
        rightWorkspaceVisible={rightWorkspaceVisible}
        closeRightWorkspace={closeRightWorkspace}
        setRightWorkspaceTab={setRightWorkspaceTab}
        setRightWorkspaceVisible={setRightWorkspaceVisible}
        setStatsPanelScope={setStatsPanelScope}
        themeMode={themeMode}
        allThemePlugins={allThemePlugins}
        installedThemePluginIds={installedThemePluginIds}
        onThemeModeChange={onThemeModeChange}
        openSettings={openSettings}
        locale={locale}
        setLocale={setLocale}
        conversationStatusColor={conversationStatusColor}
        conversationStatusLabel={conversationStatusLabel}
        runtimeSelection={runtimeSelection}
        cliBackendVersionLabel={cliBackendVersionLabel}
        codexCliUpdateStatus={codexCliUpdateStatus}
        setCliSwitcherAnchor={setCliSwitcherAnchor}
        refreshCliInstallations={refreshCliInstallations}
        isClaudeBackend={isClaudeBackend}
        isAgyBackend={isAgyBackend}
        isGrokBackend={isGrokBackend}
        isMuseBackend={isMuseBackend}
        isPiBackend={isPiBackend}
        isOpencodeBackend={isOpencodeBackend}
        isCodexBackend={isCodexBackend}
        setTopBarPinned={setTopBarPinned}
        cancelTopBarHide={cancelTopBarHide}
        setTopBarOpen={setTopBarOpen}
        setMobileTopMenuAnchor={setMobileTopMenuAnchor}
        mobileTopBarCollapsed={mobileTopBarCollapsed}
        setMobileTopBarCollapsedPersisted={setMobileTopBarCollapsedPersisted}
        historyThreads={historyThreads}
        activeProviderLabel={activeProviderLabel}
        selectedModel={selectedModel}
        conversationStatus={conversationStatus}
        conversationWorking={conversationWorking}
        mobileTopBarExpanded={mobileTopBarExpanded}
        setMobileTopBarExpanded={setMobileTopBarExpanded}
        setMobileHistoryOpen={setMobileHistoryOpen}
        setRuntimeConfigAnchor={setRuntimeConfigAnchor}
        state={state}
      />
      <WorkbenchMainArea
        t={t}
        immersiveView={immersiveView}
        isMobile={isMobile}
        topBarPinned={topBarPinned}
        themeTuning={themeTuning}
        draggedTaskTabId={draggedTaskTabId}
        detachedThreadId={detachedThreadId}
        desktopLayout={desktopLayout}
        splitDropHandledRef={splitDropHandledRef}
        setDraggedTaskTabId={setDraggedTaskTabId}
        placeTaskInSplitSide={placeTaskInSplitSide}
        rightWorkspaceVisible={rightWorkspaceVisible}
        panelLayout={panelLayout}
        setPanelLayout={setPanelLayout}
        renderCenterPanel={renderCenterPanel}
        renderRightWorkspacePanel={renderRightWorkspacePanel}
      >
        <WorkbenchTaskTabs
          t={t}
          immersiveView={immersiveView}
          isMobile={isMobile}
          topBarPinned={topBarPinned}
          themeTuning={themeTuning}
          detachedThreadId={detachedThreadId}
          desktopLayout={desktopLayout}
          leftPanelVisible={leftPanelVisible}
          mobileHistoryOpen={mobileHistoryOpen}
          setLeftPanelVisible={setLeftPanelVisible}
          setMobileHistoryOpen={setMobileHistoryOpen}
          taskTabs={taskTabs}
          dangerDialogIntent={dangerDialogIntent}
          runningThreadIds={runningThreadIds}
          taskTabContextMenu={taskTabContextMenu}
          setTaskTabContextMenu={setTaskTabContextMenu}
          splitDropHandledRef={splitDropHandledRef}
          draggedTaskTabId={draggedTaskTabId}
          setDraggedTaskTabId={setDraggedTaskTabId}
          moveVisibleTaskTab={moveVisibleTaskTab}
          detachTaskTab={detachTaskTab}
          selectVisibleTaskTab={selectVisibleTaskTab}
          closeTaskTab={closeTaskTab}
          closeTaskTabs={closeTaskTabs}
          requestNewSession={requestNewSession}
          permission={permission}
          splitViewMenuAnchor={splitViewMenuAnchor}
          setSplitViewMenuAnchor={setSplitViewMenuAnchor}
          splitViewMenuPosition={splitViewMenuPosition}
          setSplitViewMenuPosition={setSplitViewMenuPosition}
          splitViewSearch={splitViewSearch}
          setSplitViewSearch={setSplitViewSearch}
          setSplitViewBaseThreadId={setSplitViewBaseThreadId}
          pendingPaneSplit={pendingPaneSplit}
          setPendingPaneSplit={setPendingPaneSplit}
          splitViewCandidates={splitViewCandidates}
          splitPaneWithThread={splitPaneWithThread}
          splitView={splitView}
          workspaceLayout={workspaceLayout}
          setWorkspaceLayout={setWorkspaceLayout}
          separateSplitView={separateSplitView}
          closeSplitSide={closeSplitSide}
          reverseCurrentSplitView={reverseCurrentSplitView}
          applyWorkspacePreset={applyWorkspacePreset}
          mainThreads={mainThreads}
          beginSplitView={beginSplitView}
          paneContextMenu={paneContextMenu}
          setPaneContextMenu={setPaneContextMenu}
          closeWorkspacePaneAndCollapse={closeWorkspacePaneAndCollapse}
          contextPaneThread={contextPaneThread}
          contextPaneRemoteLifecycle={contextPaneRemoteLifecycle}
          contextPaneRemoteLifecyclePending={contextPaneRemoteLifecyclePending}
          setRemoteThreadMode={setRemoteThreadMode}
          dispatch={dispatch}
          showOpenWithMenu={showOpenWithMenu}
          openOfficialWebsite={openOfficialWebsite}
          openSettings={openSettings}
          openWithMenuPosition={openWithMenuPosition}
          closeOpenWithMenu={closeOpenWithMenu}
          openWithAppsLoading={openWithAppsLoading}
          openWithApps={openWithApps}
          openWithTarget={openWithTarget}
          openWorkspaceWith={openWorkspaceWith}
          setAgentRosterManagerThreadId={setAgentRosterManagerThreadId}
          openTaskTabs={openTaskTabs}
          contextTaskTab={contextTaskTab}
          contextRemoteLifecycle={contextRemoteLifecycle}
          contextRemoteLifecyclePending={contextRemoteLifecyclePending}
          contextTaskTabIndex={contextTaskTabIndex}
        state={state}
        />
      </WorkbenchMainArea>
      </>
      )}
      <WorkbenchDrawers wb={wb} />
      <WorkbenchMenus
        t={t}
        mobileTopMenuAnchor={mobileTopMenuAnchor}
        setMobileTopMenuAnchor={setMobileTopMenuAnchor}
        requestNewSession={requestNewSession}
        permission={permission}
        setStatsPanelScope={setStatsPanelScope}
        setRightWorkspaceTab={setRightWorkspaceTab}
        setRightWorkspaceVisible={setRightWorkspaceVisible}
        loadBasics={loadBasics}
        openSettings={openSettings}
        runtimeConfigAnchor={runtimeConfigAnchor}
        setRuntimeConfigAnchor={setRuntimeConfigAnchor}
        isMobile={isMobile}
        runtimeControlSet={runtimeControlSet}
        activeProviderLabel={activeProviderLabel}
        selectedModel={selectedModel}
        conversationStatusLabel={conversationStatusLabel}
        activeWorkspaceCwd={activeWorkspaceCwd}
        openWorkspacePicker={openWorkspacePicker}
        activeWorkspaceAdditionalRoots={activeWorkspaceAdditionalRoots}
        reasoningAnchor={reasoningAnchor}
        setReasoningAnchor={setReasoningAnchor}
        showReasoningGlow={showReasoningGlow}
        selectedReasoningLabel={selectedReasoningLabel}
        reasoningIndex={reasoningIndex}
        reasoningMax={reasoningMax}
        reasoningOptions={reasoningOptions}
        setReasoningEffort={setReasoningEffort}
        selectedReasoning={selectedReasoning}
        agentsAnchor={agentsAnchor}
        setAgentsAnchor={setAgentsAnchor}
        agentReadiness={agentReadiness}
        agentReadinessLoading={agentReadinessLoading}
        checkAgentReadiness={checkAgentReadiness}
        setAgentReadinessJsonOpen={setAgentReadinessJsonOpen}
        agentReadinessDisplay={agentReadinessDisplay}
        runtimeSelection={runtimeSelection}
        updateAgentRuntime={updateAgentRuntime}
        composerModels={composerModels}
        agentReasoningOptions={agentReasoningOptions}
        applyRecommendedAgentRoster={applyRecommendedAgentRoster}
        addAgentRosterRole={addAgentRosterRole}
        updateAgentRosterRole={updateAgentRosterRole}
        resolveComposerReasoningOptions={resolveComposerReasoningOptions}
        state={state}
        agentReadinessJsonOpen={agentReadinessJsonOpen}
      />
      <NewChatSetupDialog
        t={t}
        newChatSetupDialogOpen={newChatSetupDialogOpen}
        setNewChatSetupOpen={setNewChatSetupOpen}
        workspaceMode={workspaceMode}
        setWorkspaceMode={setWorkspaceMode}
        setWorkspacePickerPath={setWorkspacePickerPath}
        sshCwd={sshCwd}
        cwd={cwd}
        setSshCwd={setSshCwd}
        setCwd={setCwd}
        sshConfigHostAlias={sshConfigHostAlias}
        setSshConfigHostAlias={setSshConfigHostAlias}
        sshCommand={sshCommand}
        setSshCommand={setSshCommand}
        sshConfigHostControl={sshConfigHostControl}
        localWorkspaceDefaultPath={localWorkspaceDefaultPath}
        openWorkspacePicker={openWorkspacePicker}
        workspaceSetupBusy={workspaceSetupBusy}
        handleSelectRecentWorkspace={handleSelectRecentWorkspace}
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
        runtimeControlSet={runtimeControlSet}
        composerModels={composerModels}
        selectedModel={selectedModel}
        updateAgentRuntime={updateAgentRuntime}
        permission={permission}
        requestPermissionChange={requestPermissionChange}
        allowedPermissions={allowedPermissions}
        newChatBudgetLimit={newChatBudgetLimit}
        setNewChatBudgetLimit={setNewChatBudgetLimit}
        newChatBackendPreview={newChatBackendPreview}
        confirmWorkspaceSelection={confirmWorkspaceSelection}
        state={state}
      />
      <AgentRosterManagerDialog
        open={Boolean(agentRosterManagerThreadId)}
        token={state.token ?? ""}
        threadId={agentRosterManagerThreadId}
        providers={state.providers}
        models={composerModels}
        defaultModel={selectedModel}
        onClose={() => setAgentRosterManagerThreadId(null)}
      />
      <SshCodexInstallDialog
        t={t}
        sshPreflightIssue={sshPreflightIssue}
        setSshPreflightIssue={setSshPreflightIssue}
        setSshInstallConfirming={setSshInstallConfirming}
        sshInstallBusy={sshInstallBusy}
        sshInstallCommand={sshInstallCommand}
        sshInstallConfirming={sshInstallConfirming}
        sshInstallError={sshInstallError}
        recheckSshWorkspace={recheckSshWorkspace}
        installSshCodex={installSshCodex}
      />
      <WorkspacePickerDialog
        t={t}
        workspacePickerOpen={workspacePickerOpen}
        setWorkspacePickerOpen={setWorkspacePickerOpen}
        workspacePickerPath={workspacePickerPath}
        setWorkspacePickerPath={setWorkspacePickerPath}
        workspaceMode={workspaceMode}
        setWorkspaceMode={setWorkspaceMode}
        sshConfigHostAlias={sshConfigHostAlias}
        setSshConfigHostAlias={setSshConfigHostAlias}
        sshConfigHostControl={sshConfigHostControl}
        sshCommand={sshCommand}
        setSshCommand={setSshCommand}
        sshDetectedHome={sshDetectedHome}
        localWorkspaceDefaultPath={localWorkspaceDefaultPath}
        localWorkspaceProjectsPath={localWorkspaceProjectsPath}
        workspacePickerParent={workspacePickerParent}
        readDirectory={readDirectory}
        windowsWorkspaceHost={windowsWorkspaceHost}
        localWorkspaceInfo={localWorkspaceInfo}
        workspaceNewFolderName={workspaceNewFolderName}
        setWorkspaceNewFolderName={setWorkspaceNewFolderName}
        createWorkspaceFolder={createWorkspaceFolder}
        workspaceCreateBusy={workspaceCreateBusy}
        workspacePickerLoading={workspacePickerLoading}
        workspacePickerFolders={workspacePickerFolders}
        workspacePickerFiles={workspacePickerFiles}
        openCodeWorkspaceFile={openCodeWorkspaceFile}
        workspacePickerPurpose={workspacePickerPurpose}
        cwd={cwd}
        sshCwd={sshCwd}
        additionalRoots={additionalRoots}
        setAdditionalRoots={setAdditionalRoots}
        setNewChatAdditionalRootsExpanded={setNewChatAdditionalRootsExpanded}
        setSshCwd={setSshCwd}
        setCwd={setCwd}
        recordRecentWorkspace={recordRecentWorkspace}
        persistWorkspaceForActiveThread={persistWorkspaceForActiveThread}
        applyWorkspaceVmPolicyForCwd={applyWorkspaceVmPolicyForCwd}
        workspaceHostPlatform={workspaceHostPlatform}
      />
      <DangerNewChatDialog
        t={t}
        isMobile={isMobile}
        dangerDialogIntent={dangerDialogIntent}
        closeDangerDialog={closeDangerDialog}
        workspaceMode={workspaceMode}
        setWorkspaceMode={setWorkspaceMode}
        sshCwd={sshCwd}
        setSshCwd={setSshCwd}
        cwd={cwd}
        setCwd={setCwd}
        setWorkspacePickerPath={setWorkspacePickerPath}
        localWorkspaceDefaultPath={localWorkspaceDefaultPath}
        sshConfigHostAlias={sshConfigHostAlias}
        setSshConfigHostAlias={setSshConfigHostAlias}
        sshConfigHostControl={sshConfigHostControl}
        sshCommand={sshCommand}
        setSshCommand={setSshCommand}
        openWorkspacePicker={openWorkspacePicker}
        workspaceSetupBusy={workspaceSetupBusy}
        handleSelectRecentWorkspace={handleSelectRecentWorkspace}
        additionalRoots={additionalRoots}
        setAdditionalRoots={setAdditionalRoots}
        persistWorkspaceForActiveThread={persistWorkspaceForActiveThread}
        newChatAdditionalRootsExpanded={newChatAdditionalRootsExpanded}
        setNewChatAdditionalRootsExpanded={setNewChatAdditionalRootsExpanded}
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
        runtimeControlSet={runtimeControlSet}
        providers={state.providers}
        composerModels={composerModels}
        selectedModel={selectedModel}
        updateAgentRuntime={updateAgentRuntime}
        selectedReasoningLabel={selectedReasoningLabel}
        dangerDialogPreset={dangerDialogPreset}
        dangerDialogAcknowledged={dangerDialogAcknowledged}
        setDangerDialogAcknowledged={setDangerDialogAcknowledged}
        useSaferModeFromDangerDialog={useSaferModeFromDangerDialog}
        confirmDangerDialog={confirmDangerDialog}
      />
      <FreeModelAccessDialog
        open={freeModelAccessOpen}
        token={state.token}
        syncedModels={
          state.providers.find((provider: ProviderConfig) => provider.id === "omniroute-free")?.nativeModels
          ?? state.providers.find((provider: ProviderConfig) => provider.id === "omniroute-free")?.groups?.flatMap((group: ChannelGroupConfig) => group.models ?? [])
        }
        onClose={() => setFreeModelAccessOpen(false)}
        onOpenDiscord={openDiscordInvite}
        onSync={syncOmniRouteFree}
      />
      <FreebuffModelSwitchDialog
        open={freebuffSwitchDialogOpen}
        currentModel={freebuffSession?.model || selectedModel}
        targetModel={freebuffSwitchTargetModel}
        remainingSeconds={freebuffSession?.remainingSeconds}
        isOwned={freebuffSession?.isOwned}
        busy={freebuffSwitchBusy}
        onConfirmSwitch={handleConfirmFreebuffSwitch}
        onKeepCurrent={handleKeepCurrentFreebuffModel}
        onClose={() => setFreebuffSwitchDialogOpen(false)}
      />
      <RelayShareDialogs
        relayShareExportOpen={relayShareExportOpen}
        relayShareExportBusy={relayShareExportBusy}
        relayShareExportPassword={relayShareExportPassword}
        relayShareExportConfirm={relayShareExportConfirm}
        relayShareExportError={relayShareExportError}
        relayShareExportText={relayShareExportText}
        setRelayShareExportOpen={setRelayShareExportOpen}
        setRelayShareExportPassword={setRelayShareExportPassword}
        setRelayShareExportConfirm={setRelayShareExportConfirm}
        setRelayShareExportError={setRelayShareExportError}
        createRelayShare={createRelayShare}
        copyRelayShare={copyRelayShare}
        relayShareImportOpen={relayShareImportOpen}
        relayShareImportBusy={relayShareImportBusy}
        relayShareImportText={relayShareImportText}
        relayShareImportPassword={relayShareImportPassword}
        relayShareImportError={relayShareImportError}
        setRelayShareImportOpen={setRelayShareImportOpen}
        setRelayShareImportText={setRelayShareImportText}
        setRelayShareImportPassword={setRelayShareImportPassword}
        importRelayShareDirectly={importRelayShareDirectly}
      />
      <SettingsDrawerHost wb={wb} />
      <SetupGuideDialog
        open={setupGuideOpen}
        themeMode={themeMode}
        themes={allThemePlugins}
        installedThemePluginIds={installedThemePluginIds}
        t={t}
        onThemeChange={onThemeModeChange}
        onOpenSettings={(section: SettingsSectionId) => {
          finishSetupGuide();
          openSettings(section);
        }}
        onComplete={finishSetupGuide}
        onSkip={finishSetupGuide}
      />
      <OfficialOpenAiLoginDialog
        open={officialLoginOpen}
        notice={officialLoginNotice}
        onClose={() => {
          setOfficialLoginOpen(false);
          setOfficialLoginNotice(null);
        }}
        onStartOAuth={startOfficialOpenAiOAuth}
        onCancelOAuth={cancelOfficialOpenAiOAuth}
      />
      <Snackbar
        open={authStatus === "authenticated" && connectionStatus.phase !== "connected"}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert
          severity={connectionStatus.phase === "disconnected" ? "error" : "warning"}
          variant="filled"
          data-testid="connection-status-alert"
          sx={{ maxWidth: 560 }}
        >
          {connectionNotice}
        </Alert>
      </Snackbar>
      <Snackbar
        open={state.errors.length > 0}
        autoHideDuration={6000}
        onClose={() => dispatch({ type: "clearError" })}
      >
        <Alert severity="error" variant="filled">
          {state.errors[0]}
        </Alert>
      </Snackbar>
      <CodexCliUpdateDialog
        t={t}
        codexCliUpdateDialogOpen={codexCliUpdateDialogOpen}
        setCodexCliUpdateDialogOpen={setCodexCliUpdateDialogOpen}
        codexCliUpdateStatus={codexCliUpdateStatus}
        codexCliUpdateError={codexCliUpdateError}
        setCodexCliUpdateError={setCodexCliUpdateError}
        codexCliUpdateBusy={codexCliUpdateBusy}
        setCodexCliUpdateBusy={setCodexCliUpdateBusy}
        checkCodexCliUpdate={checkCodexCliUpdate}
        refreshCliInstallations={refreshCliInstallations}
        state={state}
      />
      <CliVersionSwitcher
        t={t}
        cliSwitcherAnchor={cliSwitcherAnchor}
        setCliSwitcherAnchor={setCliSwitcherAnchor}
        cliBackendToggleError={cliBackendToggleError}
        cliInstallations={cliInstallations}
        isClaudeBackend={isClaudeBackend}
        codexCliUpdateStatus={codexCliUpdateStatus}
        setCodexCliUpdateDialogOpen={setCodexCliUpdateDialogOpen}
        cliBackendEnabled={cliBackendEnabled}
        threadRuntimeSelections={threadRuntimeSelections}
        runningThreadIds={runningThreadIds}
        handleCliPluginToggleFromList={handleCliPluginToggleFromList}
        runtimeSelection={runtimeSelection}
        handleNewConversationCliBackend={handleNewConversationCliBackend}
        cliSwitchBusy={cliSwitchBusy}
        setCliSwitchConfirmTarget={setCliSwitchConfirmTarget}
        isMiniBackend={isMiniBackend}
        miniVersion={miniVersion}
        state={state}
      />
      <CliSwitchDialog
        cliSwitchConfirmTarget={cliSwitchConfirmTarget}
        cliSwitchBusy={cliSwitchBusy}
        cliSwitchError={cliSwitchError}
        setCliSwitchConfirmTarget={setCliSwitchConfirmTarget}
        setCliSwitchError={setCliSwitchError}
        handleCliSwitchConfirm={handleCliSwitchConfirm}
        t={t}
      />
      <Snackbar
        open={Boolean(cliSwitchNotice)}
        autoHideDuration={6000}
        onClose={() => setCliSwitchNotice(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="success" variant="filled" onClose={() => setCliSwitchNotice(null)}>{cliSwitchNotice}</Alert>
      </Snackbar>
      <Snackbar
        open={Boolean(freeModelNotice)}
        autoHideDuration={6000}
        onClose={() => setFreeModelNotice(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="success" variant="filled" onClose={() => setFreeModelNotice(null)}>{freeModelNotice}</Alert>
      </Snackbar>
      </Box>
      </>
    </OnboardingTour>
  );
}
