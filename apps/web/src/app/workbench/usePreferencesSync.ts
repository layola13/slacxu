import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { JsonValue } from "@codex-ui/shared";
import {
  LoginRequiredError,
  WorkspaceRootsError,
  fetchUserPreferences,
  fetchWorkspaceRoots,
  updateUserPreferences,
  type LocalWorkspaceInfo,
  type UserPreferences,
} from "../../state/codexClient";
import {
  clearLegacyPreferenceStorage,
  historyViewModeValue,
  installedThemeIdsPreference,
  localeValue,
  parseCustomThemePluginsPreference,
  parseHistoryDateRange,
  parsePanelLayoutPreference,
  parseWorkspacePreference,
  readHistoryDateRange,
  readLegacyHistoryViewMode,
  rightWorkspaceTabValue,
  themeModeValue,
} from "./preferenceUtils";
import { parseSplitViewState, parseWorkspaceLayoutState, twoPaneSplitView } from "../../taskTabs";
import { hasCompletedSetupGuide } from "../../setup-guide/setupGuideState";
import { requiresExplicitNewChatWorkspace } from "../../newChatWorkspacePolicy";
import { defaultLocalWorkspacePath, normalizeWorkspaceCwd, normalizeWorkspaceRoots } from "../../workspacePaths";
import { formatErrorText } from "./appUtils";
import {
  DEFAULT_LOCAL_WORKSPACE_PICKER_PATH,
  DEFAULT_NEW_CHAT_CWD,
  DEFAULT_SSH_WORKSPACE_COMMAND,
  DEFAULT_SSH_WORKSPACE_CWD,
  type AuthStatus,
} from "./appConstants";
import type { Locale } from "../../i18n";
import type { ThemeId, ThemeMode, ThemePlugin } from "../../theme";
import { parseChatTypographyPreference, type ChatTypographyPreference } from "../../chatTypography";
import type { HistoryBackendFilter, HistoryDateRangeFilter, HistoryViewMode } from "../../history/HistorySidebar";
import type { RightWorkspaceTab } from "../../components/RightWorkspacePanel";
import type { SplitViewState, WorkspaceLayoutState } from "../../taskTabs";
import {
  DEFAULT_RUNTIME_SELECTION,
  NEW_CONVERSATION_SELECTION_KEY,
  parseThreadRuntimeSelections,
  threadRuntimeSelectionsForPreferences,
  type ThreadRuntimeSelection,
  type ThreadRuntimeSelectionsDomain,
} from "../runtime/useThreadRuntimeSelections";
import type { ImageRuntimeSelection } from "../../imageRuntime";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

type LayoutState = Record<string, number> | undefined;

export function usePreferencesSync(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  themeMode: ThemeMode;
  customThemePlugins: ThemePlugin[];
  onThemeModeChange: (mode: ThemeMode) => void;
  onCustomThemePluginsChange: (plugins: ThemePlugin[]) => void;
  authStatus: AuthStatus;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  leftPanelVisible: boolean;
  setLeftPanelVisible: Dispatch<SetStateAction<boolean>>;
  showAssistantUsageDetails: boolean;
  setShowAssistantUsageDetails: Dispatch<SetStateAction<boolean>>;
  chatTypography: ChatTypographyPreference;
  setChatTypography: Dispatch<SetStateAction<ChatTypographyPreference>>;
  includeAutomationHistory: boolean;
  setIncludeAutomationHistory: Dispatch<SetStateAction<boolean>>;
  petDockEnabled: boolean;
  setPetDockEnabled: Dispatch<SetStateAction<boolean>>;
  capacityTurnRetryEnabled: boolean;
  setCapacityTurnRetryEnabled: Dispatch<SetStateAction<boolean>>;
  panelLayout: LayoutState;
  setPanelLayout: Dispatch<SetStateAction<LayoutState>>;
  filesPanelLayout: LayoutState;
  setFilesPanelLayout: Dispatch<SetStateAction<LayoutState>>;
  splitViewLayout: LayoutState;
  setSplitViewLayout: Dispatch<SetStateAction<LayoutState>>;
  splitView: SplitViewState | null;
  setSplitView: Dispatch<SetStateAction<SplitViewState | null>>;
  workspaceLayout: WorkspaceLayoutState | null;
  setWorkspaceLayout: Dispatch<SetStateAction<WorkspaceLayoutState | null>>;
  workspaceLayoutRef: { current: WorkspaceLayoutState | null };
  rightWorkspaceTab: RightWorkspaceTab;
  setRightWorkspaceTab: Dispatch<SetStateAction<RightWorkspaceTab>>;
  rightWorkspaceVisible: boolean;
  setRightWorkspaceVisible: Dispatch<SetStateAction<boolean>>;
  historyDateRange: HistoryDateRangeFilter;
  setHistoryDateRange: Dispatch<SetStateAction<HistoryDateRangeFilter>>;
  historyViewMode: HistoryViewMode;
  setHistoryViewMode: Dispatch<SetStateAction<HistoryViewMode>>;
  installedThemePluginIds: ThemeId[];
  setInstalledThemePluginIds: Dispatch<SetStateAction<ThemeId[]>>;
  threadRuntimeSelections: Record<string, ThreadRuntimeSelection>;
  imageRuntimeSelections: Record<string, ImageRuntimeSelection>;
  settingAssistantProviderId: string;
  setSettingAssistantProviderId: Dispatch<SetStateAction<string>>;
  settingAssistantModel: string;
  setSettingAssistantModel: Dispatch<SetStateAction<string>>;
  cwd: string;
  setCwd: Dispatch<SetStateAction<string>>;
  workspaceMode: import("./appConstants").WorkspaceMode;
  setWorkspaceMode: Dispatch<SetStateAction<import("./appConstants").WorkspaceMode>>;
  sshCommand: string;
  setSshCommand: Dispatch<SetStateAction<string>>;
  sshCwd: string;
  setSshCwd: Dispatch<SetStateAction<string>>;
  additionalRoots: string[];
  setAdditionalRoots: Dispatch<SetStateAction<string[]>>;
  workspaceSelectionPending: boolean;
  setWorkspaceSelectionPending: Dispatch<SetStateAction<boolean>>;
  setWorkspacePickerPath: Dispatch<SetStateAction<string>>;
  localWorkspaceDefaultPath: string;
  setLocalWorkspaceInfo: Dispatch<SetStateAction<LocalWorkspaceInfo | null>>;
  setNewChatSetupOpen: Dispatch<SetStateAction<boolean>>;
  setSetupGuideOpen: Dispatch<SetStateAction<boolean>>;
  setLoginError: Dispatch<SetStateAction<string | null>>;
  recoverOrExpireSession: () => Promise<boolean>;
  freeOllamaEnabled: boolean;
} & Pick<ThreadRuntimeSelectionsDomain, "hydratePreferences">) {
  const {
    state, dispatch, client, t, themeMode, customThemePlugins, onThemeModeChange,
    onCustomThemePluginsChange, authStatus, locale, setLocale, leftPanelVisible,
    setLeftPanelVisible, showAssistantUsageDetails, setShowAssistantUsageDetails,
    chatTypography, setChatTypography, includeAutomationHistory, setIncludeAutomationHistory,
    petDockEnabled, setPetDockEnabled, capacityTurnRetryEnabled, setCapacityTurnRetryEnabled,
    panelLayout, setPanelLayout, filesPanelLayout, setFilesPanelLayout, splitViewLayout,
    setSplitViewLayout, splitView, setSplitView, workspaceLayout, setWorkspaceLayout,
    workspaceLayoutRef, rightWorkspaceTab, setRightWorkspaceTab, rightWorkspaceVisible,
    setRightWorkspaceVisible, historyDateRange, setHistoryDateRange, historyViewMode,
    setHistoryViewMode, installedThemePluginIds, setInstalledThemePluginIds,
    threadRuntimeSelections, imageRuntimeSelections, settingAssistantProviderId,
    setSettingAssistantProviderId, settingAssistantModel, setSettingAssistantModel, cwd,
    setCwd, workspaceMode, setWorkspaceMode, sshCommand, setSshCommand, sshCwd, setSshCwd,
    additionalRoots, setAdditionalRoots, workspaceSelectionPending, setWorkspaceSelectionPending,
    setWorkspacePickerPath, localWorkspaceDefaultPath, setLocalWorkspaceInfo, setNewChatSetupOpen,
    setSetupGuideOpen, setLoginError, recoverOrExpireSession, freeOllamaEnabled,
    hydratePreferences: hydrateRuntimePreferences,
  } = input;
  const preferencesLoadedTokenRef = useRef<string | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);

  useEffect(() => {
    if (authStatus !== "authenticated" || !preferencesReady || hasCompletedSetupGuide()) {
      return;
    }
    const timer = window.setTimeout(() => setSetupGuideOpen(true), 500);
    return () => window.clearTimeout(timer);
  }, [authStatus, preferencesReady]);

  useEffect(() => {
    const token = state.token;
    if (!token || preferencesLoadedTokenRef.current === token) {
      return;
    }
    preferencesLoadedTokenRef.current = token;
    setPreferencesReady(false);
    let cancelled = false;
    void fetchUserPreferences(token)
      .then((preferences: UserPreferences) => {
        if (cancelled) return;
        const savedNewConversationPermission = parseThreadRuntimeSelections(preferences.threadRuntimeSelections)[NEW_CONVERSATION_SELECTION_KEY]?.permission
          ?? DEFAULT_RUNTIME_SELECTION.permission;
        const requiresWorkspaceConfirmation = requiresExplicitNewChatWorkspace(savedNewConversationPermission);
        const workspace = parseWorkspacePreference(preferences.workspace);
        if (workspace?.mode === "ssh") {
          setWorkspaceMode("ssh");
          setSshCommand(workspace.sshCommand);
          setSshCwd(workspace.sshCwd);
          setWorkspacePickerPath(workspace.sshCwd);
          setAdditionalRoots([]);
          setWorkspaceSelectionPending(requiresWorkspaceConfirmation);
          setNewChatSetupOpen(false);
        } else if (workspace) {
          setWorkspaceMode("local");
          setCwd(workspace.cwd);
          setSshCommand(workspace.sshCommand);
          setSshCwd(workspace.sshCwd);
          setWorkspacePickerPath(workspace.cwd);
          setAdditionalRoots(normalizeWorkspaceRoots(workspace.cwd, workspace.additionalRoots));
          setWorkspaceSelectionPending(requiresWorkspaceConfirmation);
          setNewChatSetupOpen(false);
        } else {
          setWorkspaceMode("local");
          setCwd(localWorkspaceDefaultPath);
          setWorkspacePickerPath(localWorkspaceDefaultPath);
          setAdditionalRoots([]);
          setWorkspaceSelectionPending(requiresWorkspaceConfirmation);
          setNewChatSetupOpen(false);
        }
        hydrateRuntimePreferences(preferences.threadRuntimeSelections, preferences.imageRuntimeSelections);
        const savedDateRange = parseHistoryDateRange(preferences.historyDateRange);
        if (savedDateRange) setHistoryDateRange(savedDateRange);
        const savedViewMode = historyViewModeValue(preferences.historyViewMode);
        if (savedViewMode) setHistoryViewMode(savedViewMode);
        const savedPanelLayout = parsePanelLayoutPreference(preferences.panelLayout);
        if (savedPanelLayout) setPanelLayout(savedPanelLayout);
        const savedWorkspaceLayout = parseWorkspaceLayoutState(preferences.workspaceLayout);
        if (savedWorkspaceLayout) {
          setWorkspaceLayout(savedWorkspaceLayout);
          setSplitView(twoPaneSplitView(savedWorkspaceLayout));
        } else {
          const savedSplitView = parseSplitViewState(preferences.splitView);
          if (!workspaceLayoutRef.current && (savedSplitView || preferences.splitView === null)) setSplitView(savedSplitView);
        }
        const savedSplitViewLayout = parsePanelLayoutPreference(preferences.splitViewLayout);
        if (savedSplitViewLayout || preferences.splitViewLayout === null) setSplitViewLayout(savedSplitViewLayout ?? undefined);
        const savedFilesLayout = parsePanelLayoutPreference(preferences.filesPanelLayout);
        if (savedFilesLayout) setFilesPanelLayout(savedFilesLayout);
        const savedLocale = localeValue(preferences.locale);
        if (savedLocale) setLocale(savedLocale);
        const savedCustomThemes = parseCustomThemePluginsPreference(preferences.customThemePlugins);
        if (savedCustomThemes) onCustomThemePluginsChange(savedCustomThemes);
        const savedThemeMode = themeModeValue(preferences.themeMode, savedCustomThemes ?? customThemePlugins);
        if (savedThemeMode) onThemeModeChange(savedThemeMode);
        const savedInstalledThemes = installedThemeIdsPreference(preferences.installedThemePluginIds, savedCustomThemes ?? customThemePlugins);
        if (savedInstalledThemes) setInstalledThemePluginIds(savedInstalledThemes);
        if (typeof preferences.showAssistantUsageDetails === "boolean") setShowAssistantUsageDetails(preferences.showAssistantUsageDetails);
        const savedChatTypography = parseChatTypographyPreference(preferences.chatTypography);
        if (savedChatTypography) setChatTypography(savedChatTypography);
        if (typeof preferences.includeAutomationHistory === "boolean") setIncludeAutomationHistory(preferences.includeAutomationHistory);
        if (typeof preferences.petDockEnabled === "boolean") setPetDockEnabled(preferences.petDockEnabled);
        if (typeof preferences.capacityTurnRetryEnabled === "boolean") setCapacityTurnRetryEnabled(preferences.capacityTurnRetryEnabled);
        if (typeof preferences.rightWorkspaceVisible === "boolean") setRightWorkspaceVisible(preferences.rightWorkspaceVisible);
        const savedRightTab = rightWorkspaceTabValue(preferences.rightWorkspaceTab);
        if (savedRightTab) setRightWorkspaceTab(savedRightTab);
        if (typeof preferences.settingAssistantProviderId === "string") setSettingAssistantProviderId(preferences.settingAssistantProviderId);
        if (typeof preferences.settingAssistantModel === "string") setSettingAssistantModel(preferences.settingAssistantModel);
        setPreferencesReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        preferencesLoadedTokenRef.current = null;
        dispatch({ type: "error", message: `Preferences: ${formatErrorText(error)}` });
      });
    return () => {
      cancelled = true;
    };
  }, [customThemePlugins, hydrateRuntimePreferences, localWorkspaceDefaultPath, onCustomThemePluginsChange, onThemeModeChange, setLocale, state.token]);

  useEffect(() => {
    if (!state.token || !preferencesReady) return;
    let cancelled = false;
    void fetchWorkspaceRoots(state.token)
      .then((info: LocalWorkspaceInfo) => {
        if (cancelled) return;
        setLocalWorkspaceInfo(info);
        if (!workspaceSelectionPending) return;
        const nextDefault = defaultLocalWorkspacePath(
          info.platform,
          info.home,
          info.cwd,
          info.roots.map((root: LocalWorkspaceInfo["roots"][number]) => root.path)
        );
        setCwd((current: string) => current === DEFAULT_NEW_CHAT_CWD ? nextDefault : current);
        setWorkspacePickerPath((current: string) => current === DEFAULT_LOCAL_WORKSPACE_PICKER_PATH ? nextDefault : current);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof LoginRequiredError) {
          void recoverOrExpireSession().then((keepRunning: boolean) => {
            if (!keepRunning) setLoginError(t("auth.sessionExpired"));
          });
          return;
        }
        if (error instanceof WorkspaceRootsError) {
          const reasonKey = error.kind === "proxy"
            ? "workspace.rootsProxy"
            : error.kind === "network"
            ? (error.code === "CUX-NET-001" ? "workspace.rootsTimeout" : "workspace.rootsNetwork")
            : error.kind === "auth"
              ? (error.status === 403 ? "workspace.rootsForbidden" : "workspace.rootsAuth")
              : error.kind === "server" ? "workspace.rootsServer" : "workspace.rootsFailure";
          dispatch({
            type: "error",
            message: `${t(reasonKey)} ${t("workspace.errorIssueHint", { code: error.code })}${error.message ? ` ${t("workspace.errorDetails", { detail: error.message })}` : ""}`
          });
          return;
        }
        dispatch({ type: "error", message: `Workspace roots: ${formatErrorText(error)}` });
      });
    return () => {
      cancelled = true;
    };
  }, [preferencesReady, recoverOrExpireSession, state.token, t, workspaceMode, workspaceSelectionPending, additionalRoots]);

  useEffect(() => {
    if (!preferencesReady || !state.token) {
      return;
    }
    const snapshot: UserPreferences = {
      workspace: {
        mode: "local",
        cwd: normalizeWorkspaceCwd(workspaceMode === "ssh" ? localWorkspaceDefaultPath : cwd) || localWorkspaceDefaultPath,
        sshCommand: DEFAULT_SSH_WORKSPACE_COMMAND,
        sshCwd: DEFAULT_SSH_WORKSPACE_CWD
      },
      threadRuntimeSelections: threadRuntimeSelectionsForPreferences(threadRuntimeSelections) as unknown as JsonValue,
      imageRuntimeSelections: imageRuntimeSelections as unknown as JsonValue,
      themeMode,
      customThemePlugins: customThemePlugins as unknown as JsonValue,
      installedThemePluginIds,
      locale,
      leftPanelVisible,
      showAssistantUsageDetails,
      chatTypography: chatTypography as unknown as JsonValue,
      includeAutomationHistory,
      petDockEnabled,
      capacityTurnRetryEnabled,
      freeOllamaEnabled,
      rightWorkspaceVisible,
      rightWorkspaceTab,
      panelLayout: (panelLayout ?? null) as JsonValue,
      splitView: (splitView ?? null) as JsonValue,
      workspaceLayout: (workspaceLayout ?? null) as unknown as JsonValue,
      splitViewLayout: (splitViewLayout ?? null) as JsonValue,
      filesPanelLayout: (filesPanelLayout ?? null) as JsonValue,
      historyDateRange,
      historyViewMode,
      settingAssistantProviderId,
      settingAssistantModel
    };
    const timer = window.setTimeout(() => {
      void updateUserPreferences(state.token!, snapshot)
        .then(() => clearLegacyPreferenceStorage())
        .catch((error: unknown) => console.warn("[preferences] save failed", error));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    customThemePlugins,
    capacityTurnRetryEnabled,
    cwd,
    filesPanelLayout,
    historyDateRange,
    historyViewMode,
    includeAutomationHistory,
    imageRuntimeSelections,
    installedThemePluginIds,
    leftPanelVisible,
    locale,
    panelLayout,
    splitView,
    workspaceLayout,
    splitViewLayout,
    petDockEnabled,
    preferencesReady,
    rightWorkspaceTab,
    rightWorkspaceVisible,
    settingAssistantModel,
    settingAssistantProviderId,
    showAssistantUsageDetails,
    chatTypography,
    sshCommand,
    sshCwd,
    state.token,
    themeMode,
    threadRuntimeSelections,
    workspaceMode
  ]);
  return { preferencesReady, setPreferencesReady };
}
