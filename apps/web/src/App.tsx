import type { JsonValue } from "@codex-ui/shared";
import { AppRoot } from "./shell/AppRoot";
import type { AppProps } from "./app/workbench/appConstants";
import { fetchSshDirectory as fetchSshDirectoryImpl } from "./app/workbench/sshUtils";
import { extractTurnIdFromRpcResult as extractTurnIdFromRpcResultImpl } from "./app/workbench/appUtils";

export { ACTIVE_TURN_RECONCILE_IDLE_MS, ACTIVE_TURN_RECONCILE_INTERVAL_MS, AGY_OFFICIAL_MODELS, AUTH_TOKEN_STORAGE_KEY, CODEX_PROVIDER_TEST_PROMPT, DEFAULT_LOCAL_WORKSPACE_PICKER_PATH, DEFAULT_NEW_CHAT_CWD, DEFAULT_SSH_WORKSPACE_COMMAND, DEFAULT_SSH_WORKSPACE_CWD, DISCORD_INVITE_URL, EMPTY_ERRORS, EMPTY_PENDING_APPENDS, EMPTY_PENDING_REQUESTS, EMPTY_REQUEST_MONITOR, GROK_OFFICIAL_MODELS, INITIAL_SOCKET_CONNECTION_STATUS, LEGAL_ACCEPTANCE_STORAGE_PREFIX, OFFICIAL_WEBSITE_URL, SESSION_KEEPALIVE_INTERVAL_MS, SESSION_KEEPALIVE_MIN_INTERVAL_MS, UI_STORAGE_KEYS } from "./app/workbench/appConstants";
export type { AppProps, AuthStatus, BeforeInstallPromptEvent, DangerDialogIntent, DetachedTaskSnapshot, PlanImplementationPrompt, SlashCommandNotice, SshConfigHost, SshPreflightResult, StartCodexTurnOptions, WorkspaceMode } from "./app/workbench/appConstants";
export { appendBoundedTerminalOutput, asRecord, buildDefaultCollaborationMode, buildHistoryUsageByThread, buildPlanCollaborationMode, buildRequestMonitorEntries, connectionNoticeFor, conversationStatusColorFor, conversationStatusLabelFor, countMatchingRealUserMessages, debugLog, decodeBase64Text, encodeBase64Text, errorMessage, fastReasoningEffort, findLastTurnUsage, formatDiffNotice, formatErrorText, hasRealUserMessageForPending, isElectronDesktopShell, isThreadNotFoundError, latestRunningPlanStep, legalReviewRequired, normalizeGitPath, normalizeTimestampMilliseconds, numberValue, parseReviewCommand, parseThreadTokenUsage, parseTokenBreakdown, parseTokenUsageBillingSnapshot, reviewTargetLabel, safeThemeAssetUrl, safeThemeVideoUrl, sanitizeDomId, sideChatTitle, stringValue, syncWorkspaceFromThread, turnContainsCompletedImplementationPlan, waitForNextPaint, waterfallFileChangePaths, withTimeout } from "./app/workbench/appUtils";
export { buildNewChatBackendPreview, isLikelyImageModelId, modelSelectionMatches, resolveComposerTextGroup, resolveConfiguredProviderId, resolveProviderSelectionId, resolveSelectedModel, resolveSelectedModelProvider, resolveTextRuntimeGroupId } from "./app/workbench/modelSelectionUtils";
export { clearLegacyPreferenceStorage, historyViewModeValue, installedThemeIdsPreference, localeValue, optionalPermissionPresetValue, parseCustomThemePluginsPreference, parseHistoryDateRange, parsePanelLayoutPreference, parseWorkspacePreference, readHistoryDateRange, readInstalledThemes, readLegacyHistoryViewMode, readPanelLayout, readStoredBoolean, readStoredString, readWaterfallDisplayMode, rightWorkspaceTabValue, themeModeValue } from "./app/workbench/preferenceUtils";
export { addWorkspaceRpcMetadata, createSshWorkspaceDirectory, fetchSshConfigHosts, fetchSshFile, installSshCodexCli, isSshWorkspaceCommand, normalizeSshWorkspaceCwd, preflightSshWorkspace, probeSshConfigHost, sshCodexInstallCommand, writeSshFile } from "./app/workbench/sshUtils";

export function App(props: AppProps) {
  return <AppRoot {...props} />;
}

async function fetchSshDirectory(token: string, command: string, path: string): Promise<JsonValue> {
  return fetchSshDirectoryImpl(token, command, path);
}

function extractTurnIdFromRpcResult(value: JsonValue): string | null {
  return extractTurnIdFromRpcResultImpl(value);
}
