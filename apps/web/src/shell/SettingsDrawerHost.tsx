import { Suspense, lazy } from "react";
import { type HistoryBackendFilter, HistorySidebar } from "../history/HistorySidebar";
import { type PluginEntry, type PluginMarketplace, type SkillEntry } from "../state/codexClient";
import { type CodexConfigFieldKey } from "../state/codexConfigSettings";
import { type JsonValue } from "@codex-ui/shared";

import { Box, CircularProgress } from "@mui/material";

const SettingsDrawer = lazy(async () => {
  const module = await import("../settings/SettingsDrawer");
  return { default: module.SettingsDrawer };
});

export function SettingsDrawerHost({ wb }: { wb: any }) {
  const {
    activateProvider, activeProviderId, agyCliEnabled, auggieCliEnabled, clineCliEnabled, commandCodeCliEnabled, allowedPermissions, auditEvents,
    authSession, callMcpTool, capacityTurnRetryEnabled, changeOpenFileContent, chatTypography,
    claudeCliEnabled, cliBackendEnabled, cliBackendToggleError, codexCliEnabled, codexConfig,
    codexConfigError, codexConfigLoading, codexConfigSaving, compactCapabilityWarning, compactMode,
    createSkill, customThemePlugins, cwd, deleteProvider, downloadProfile,
    downloadRelayBackup, downloadRelayConfig, fileDirectories, filesPanelLayout, freeAutoCompactEnabled,
    freeAutoCompactGroupId, freeAutoCompactModel, freeAutoCompactProviderId, freeAutoCompactThreshold, freeCompactionChannelOptions,
    freeOllamaEnabled, grokCliEnabled, handleAllocateMemberBalance, handleCliBackendToggle, handleCreateMember,
    handleDeleteMember, handleUpdateMember, injectClaudeDesktop, injectCursorDesktop, insertPluginMention,
    installPlugin, installThemePlugin, installedThemePluginIds, installingPluginIds, jevCompressThreshold,
    leftPanelVisible, loadAuditEvents, loadCodexConfig, loadTooling, mcpOauthUrls,
    mcpResourceContents, members, membersError, membersLoading, museCliEnabled,
    onThemeModeChange, openFile, openRelayShareExport, opencodeCliEnabled, opencodeV2CliEnabled,
    permission, petDockEnabled, piCliEnabled, pluginAuthNotices, pluginDetails,
    pluginSkillPreviews, readDirectory, readFile, readMcpResource, readPluginDetail,
    readPluginSkill, readSkillPreview, reasoningEffort, reasoningOptions, reloadMcp,
    reloadMembers, removeCustomThemePlugin, replaySetupGuide, requestPermissionChange, restoreProvider,
    saveCustomThemePlugin, saveOpenFile, saveProvider, saveSkillExtraRoots, selectedModel,
    setCapacityTurnRetryEnabled, setChatTypography, setCompactMode, setCwd, setFilesPanelLayout,
    setFreeAutoCompactEnabled, setFreeAutoCompactGroup, setFreeAutoCompactModel, setFreeAutoCompactProvider, setFreeAutoCompactThreshold,
    setFreeModelAccessOpen, setIncludeAutomationHistory, setJevCompressThreshold, setLeftPanelVisible, setOfficialLoginOpen,
    setPetDockEnabled, setReasoningEffort, setRelayShareImportError, setRelayShareImportOpen, setRelayShareImportPassword,
    setRelayShareImportText, setSettingAssistantModel, setSettingAssistantProviderId, setSettingsOpen, setShowAssistantUsageDetails,
    setTaskNotificationPreferences, setWaterfallDisplayMode, settingAssistantEffectiveModel, settingAssistantModel, settingAssistantProviderId,
    settingAssistantReady, settingsOpen, settingsPluginTab, settingsRelayTarget, settingsSection,
    showAssistantUsageDetails, skillExtraRoots, skillPreviews, startMcpOauth, state,
    syncFreeOllama, t, taskNotificationPreferences, testProviderWithCodex, themeMode,
    toggleSkill, uninstallPlugin, uninstallThemePlugin, uploadCapabilityCatalog, uploadProfile,
    uploadRelayBackup, uploadRelayConfig, waterfallDisplayMode, windowsDesktop, writeCodexConfigField,
    writeCodexConfigValue,
  } = wb;
  return (
    <>
      {settingsOpen && (
        <Suspense fallback={<Box sx={{ position: "fixed", inset: 0, zIndex: 1500, display: "grid", placeItems: "center", bgcolor: "background.default" }}><CircularProgress size={28} /></Box>}>
          <SettingsDrawer
        sessionToken={state.token}
        open={settingsOpen}
        windowsDesktop={windowsDesktop}
        initialSection={settingsSection}
        initialPluginTab={settingsPluginTab}
        initialRelayProviderId={settingsRelayTarget?.providerId ?? null}
        initialRelayGroupId={settingsRelayTarget?.groupId ?? null}
        themeMode={themeMode}
        installedThemePluginIds={installedThemePluginIds}
        customThemePlugins={customThemePlugins}
        leftPanelVisible={leftPanelVisible}
        showAssistantUsageDetails={showAssistantUsageDetails}
        waterfallDisplayMode={waterfallDisplayMode}
        chatTypography={chatTypography}
        petDockEnabled={petDockEnabled}
        notificationPreferences={taskNotificationPreferences}
        capacityTurnRetryEnabled={capacityTurnRetryEnabled}
        freeOllamaEnabled={freeOllamaEnabled}
        freeAutoCompactEnabled={freeAutoCompactEnabled}
        freeAutoCompactThreshold={freeAutoCompactThreshold}
        freeAutoCompactProviderId={freeAutoCompactProviderId}
        freeAutoCompactGroupId={freeAutoCompactGroupId}
        freeAutoCompactModel={freeAutoCompactModel}
        compactMode={compactMode}
        jevCompressThreshold={jevCompressThreshold}
        compactCapabilityWarning={compactCapabilityWarning}
        freeCompactionChannels={freeCompactionChannelOptions}
        cwd={cwd}
        permission={permission}
        providers={state.providers}
        activeProviderId={activeProviderId}
        selectedModel={selectedModel}
        settingAssistantProviderId={settingAssistantProviderId}
        settingAssistantModel={settingAssistantModel}
        settingAssistantReady={settingAssistantReady}
        settingAssistantEffectiveModel={settingAssistantEffectiveModel}
        reasoningEffort={reasoningEffort}
        reasoningOptions={reasoningOptions}
        codexConfig={codexConfig}
        codexConfigLoading={codexConfigLoading}
        codexConfigSaving={codexConfigSaving || !codexCliEnabled}
        codexConfigError={codexCliEnabled ? codexConfigError : null}
        tooling={state.tooling}
        toolingLoading={state.toolingLoading}
        skillExtraRoots={skillExtraRoots}
        skillPreviews={skillPreviews}
        fileDirectories={fileDirectories}
        openFile={openFile}
        filesPanelLayout={filesPanelLayout}
        activeThreadId={state.activeThreadId}
        pluginDetails={pluginDetails}
        pluginSkillPreviews={pluginSkillPreviews}
       pluginAuthNotices={pluginAuthNotices}
       installingPluginIds={installingPluginIds}
        mcpResourceContents={mcpResourceContents}
        mcpOauthUrls={mcpOauthUrls}
        auditEvents={auditEvents}
        currentUser={authSession?.user ?? null}
        members={members}
        membersLoading={membersLoading}
        membersError={membersError}
        allowedPermissions={allowedPermissions}
        t={t}
        onClose={() => setSettingsOpen(false)}
        onThemeModeChange={onThemeModeChange}
        onReplaySetupGuide={replaySetupGuide}
        onInstallThemePlugin={installThemePlugin}
        onUninstallThemePlugin={uninstallThemePlugin}
        onSaveCustomThemePlugin={saveCustomThemePlugin}
        onRemoveCustomThemePlugin={removeCustomThemePlugin}
        onLeftPanelVisibleChange={setLeftPanelVisible}
        onShowAssistantUsageDetailsChange={setShowAssistantUsageDetails}
        onWaterfallDisplayModeChange={setWaterfallDisplayMode}
        onChatTypographyChange={setChatTypography}
        onIncludeAutomationHistoryChange={setIncludeAutomationHistory}
        onPetDockEnabledChange={setPetDockEnabled}
        onNotificationPreferencesChange={setTaskNotificationPreferences}
        onCapacityTurnRetryEnabledChange={setCapacityTurnRetryEnabled}
        onFreeOllamaEnabledChange={() => {}}
        onFreeAutoCompactEnabledChange={(enabled: boolean) => {
          setFreeAutoCompactEnabled(enabled);
        }}
        onFreeAutoCompactThresholdChange={setFreeAutoCompactThreshold}
        onFreeAutoCompactProviderChange={setFreeAutoCompactProvider}
        onFreeAutoCompactGroupChange={setFreeAutoCompactGroup}
        onFreeAutoCompactModelChange={setFreeAutoCompactModel}
        onCompactModeChange={setCompactMode}
        onJevCompressThresholdChange={setJevCompressThreshold}
        onCwdChange={setCwd}
        onPermissionChange={requestPermissionChange}
        onReasoningEffortChange={setReasoningEffort}
        onSettingAssistantProviderChange={setSettingAssistantProviderId}
        onSettingAssistantModelChange={setSettingAssistantModel}
        onOpenOfficialLogin={() => setOfficialLoginOpen(true)}
        onReloadCodexConfig={() => void loadCodexConfig()}
        onCodexConfigFieldChange={(field: CodexConfigFieldKey, value: string) => void writeCodexConfigField(field, value)}
        onCodexConfigValueChange={(keyPath: string, value: JsonValue) => void writeCodexConfigValue(keyPath, value)}
        onSaveProvider={saveProvider}
        onShareProvider={openRelayShareExport}
        onImportSharedRelay={() => {
          setRelayShareImportText("");
          setRelayShareImportPassword("");
          setRelayShareImportError(null);
          setRelayShareImportOpen(true);
        }}
        onSyncFreeOllama={syncFreeOllama}
        onRequestOmniRouteFreeSync={() => setFreeModelAccessOpen(true)}
        onActivateProvider={activateProvider}
        onInjectClaudeDesktop={injectClaudeDesktop}
        onInjectCursorDesktop={injectCursorDesktop}
        onTestProviderWithCodex={testProviderWithCodex}
        onDeleteProvider={deleteProvider}
        onRestoreProvider={restoreProvider}
        onReloadTooling={() => void loadTooling({ forceSkillReload: true })}
        onReloadMcp={() => void reloadMcp()}
        onExportProfile={() => downloadProfile()}
        onImportProfile={(file: File) => uploadProfile(file)}
        onExportRelayConfig={() => downloadRelayConfig()}
        onImportRelayConfig={(file: File) => uploadRelayConfig(file)}
        onExportRelayBackup={() => downloadRelayBackup()}
        onImportRelayBackup={(file: File) => uploadRelayBackup(file)}
        onImportCapabilityCatalog={uploadCapabilityCatalog}
        onReloadAuditEvents={() => loadAuditEvents()}
        onStartMcpOauth={(serverName: string) => void startMcpOauth(serverName)}
        onReadMcpResource={(serverName: string, uri: string) => void readMcpResource(serverName, uri)}
        onCallMcpTool={(serverName: string, toolName: string, args: JsonValue) => callMcpTool(serverName, toolName, args)}
        onToggleSkill={(skill: SkillEntry, enabled: boolean) => void toggleSkill(skill, enabled)}
        onSaveSkillExtraRoots={(roots: string[]) => void saveSkillExtraRoots(roots)}
        onReadSkillPreview={(skill: SkillEntry) => void readSkillPreview(skill)}
        onCreateSkill={createSkill}
        onFilesPanelLayoutChange={(layout: Record<string, number>) => {
          setFilesPanelLayout(layout);
        }}
        onReadDirectory={(path: string) => void readDirectory(path)}
        onReadFile={(path: string) => void readFile(path)}
        onChangeOpenFileContent={changeOpenFileContent}
        onSaveOpenFile={() => void saveOpenFile()}
        onReadPluginDetail={(marketplace: PluginMarketplace, plugin: PluginEntry) => void readPluginDetail(marketplace, plugin)}
        onReadPluginSkill={(marketplace: PluginMarketplace, plugin: PluginEntry, skillName: string) => void readPluginSkill(marketplace, plugin, skillName)}
        onInsertPluginMention={insertPluginMention}
        onInstallPlugin={(marketplace: PluginMarketplace, plugin: PluginEntry) => void installPlugin(marketplace, plugin)}
        onUninstallPlugin={(plugin: PluginEntry) => void uninstallPlugin(plugin)}
        onReloadMembers={reloadMembers}
        cliBackendEnabled={{ codex: codexCliEnabled, claude: claudeCliEnabled, agy: agyCliEnabled, auggie: auggieCliEnabled, cline: clineCliEnabled, "command-code": commandCodeCliEnabled, grok: grokCliEnabled, muse: museCliEnabled, pi: piCliEnabled, opencode: opencodeCliEnabled, "opencode-v2": opencodeV2CliEnabled }}
        cliBackendError={cliBackendToggleError}
        onCliBackendToggle={handleCliBackendToggle}
        onCreateMember={handleCreateMember}
        onUpdateMember={handleUpdateMember}
        onDeleteMember={handleDeleteMember}
        onAllocateMemberBalance={handleAllocateMemberBalance}
          />
        </Suspense>
      )}
    </>
  );
}
