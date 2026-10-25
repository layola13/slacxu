import { lazy, useMemo, useReducer } from "react";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Popover,
  Select,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Slider,
  Snackbar,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import AddIcon from "@mui/icons-material/Add";
import AssessmentIcon from "@mui/icons-material/Assessment";
import BoltIcon from "@mui/icons-material/Bolt";
import ChecklistIcon from "@mui/icons-material/Checklist";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import CodeIcon from "@mui/icons-material/Code";
import TerminalIcon from "@mui/icons-material/Terminal";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import CloudQueueIcon from "@mui/icons-material/CloudQueue";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import FlagIcon from "@mui/icons-material/Flag";
import TuneIcon from "@mui/icons-material/Tune";
import GroupsIcon from "@mui/icons-material/Groups";
import ViewSidebarIcon from "@mui/icons-material/ViewSidebar";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import TabIcon from "@mui/icons-material/Tab";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import SettingsIcon from "@mui/icons-material/Settings";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import { LegalConsentScreen } from "../components/LegalConsentScreen";
import { CliPrerequisiteScreen } from "../components/CliPrerequisiteScreen";
import {
  FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED,
  FREE_OLLAMA_ENABLED,
  createDefaultSaVmPolicyConfig,
  hasEnhanceToolsEnabled,
  expandModelContextVariants,
  modelChoiceDisplayName,
  permissionPresets,
  permissionToTurnOverrides,
  resolveModelContextWindow,
  stripModelContextVariant,
  type AgentRosterRole,
  type AgentRuntimeOverride,
  type ChannelGroupConfig,
  type SaVmPolicyConfig,
  type ThreadAgentMember,
  type ThreadAgentRoster,
  type AuthSession,
  type AuthUser,
  type CliBackend,
  type CompactMode,
  type DangerousPermissionAuditEvent,
  type ImageGenerationProtocol,
  type JsonValue,
  type LegalPolicyBundle,
  type PermissionPresetId,
  type ProviderConfig,
  type RelayCatalogModel,
  type RelayCatalogImportResult,
  type ServerToClientMessage
} from "@codex-ui/shared";
import {
  CodexSocketClient,
  loadImageHistory,
  saveImageHistory,
  composerInputToUserInput,
  exportRelayConfig,
  exportRelayBackup,
  exportProfile,
  createMember,
  deleteMember,
  fetchAuditEvents,
  fetchProviders,
  fetchRelaySettings,
  ClaudeDesktopConfigNotFoundError,
  injectRelayToClaudeDesktop,
  CursorInstallDirNotFoundError,
  injectRelayToCursorDesktop,
  fetchAgentReadiness,
  fetchFreeModelAccessStatus,
  importFreeOllamaRelay,
  importOmniRouteFreeRelay,
  fetchSessionToken,
  startCodexEngine,
  fetchUserPreferences,
  fetchCodeWorkspaceFile,
  fetchWorkspaceDirectory,
  fetchWorkspaceFile,
  writeWorkspaceFile,
  fetchWorkspaceGit,
  fetchWorkspaceRoots,
  writeCodeWorkspaceFile,
  importProfile,
  importRelayConfig,
  importRelayBackup,
  importCapabilityCatalog,
  initialClientState,
  listMembers,
  login,
  acceptLegalPolicy,
  fetchPublicAuthConfig,
  fetchCaptcha,
  createWorkspaceDirectory,
  generateProviderImage,
  syncSaVmWorkspaceSkill,
  fetchWorkspaceSaVmStatus,
  loginWith2fa,
  registerAccount,
  reviewStartTurnToWorkbenchTurn,
  LoginRequiredError,
  WorkspaceRootsError,
  allocateMemberBalance,
  updateMember,
  updateUserPreferences,
  updateThreadWorkspaceMetadata,
  parseHookGroups,
  parseMcpServers,
  parseMcpResourceContents,
  parseApps,
  parseFsDirectory,
  parseInstalledPluginMarketplaces,
  parsePluginDetail,
  parsePluginInstallAuthNotice,
  parsePluginMarketplaces,
  parseSkillGroups,
  threadReadToTurns,
  threadResponseIncludesTranscript,
  threadTurnsPageToTurns,
  fetchThreadUsage,
  saveThreadAgentRoster,
  type ClientState,
  type ComposerImageAttachment,
  type ComposerMention,
  type CodeWorkspaceSelection,
  type FsDirectoryEntry,
  type ImageHistoryEntry,
  type McpResourceContentEntry,
  type LocalWorkspaceInfo,
  type ModelEntry,
  type PluginEntry,
  type PluginInstallAuthNotice,
  type PluginDetailEntry,
  type PluginMarketplace,
  type SkillGroup,
  type SkillEntry,
  type SocketConnectionStatus,
  type TerminalSession,
  type PtyTerminalSession,
  type CliInstallation,
  type ThreadRequestUsageRecord,
  type ThreadEntry,
  type WorkbenchItem,
  type WorkbenchTurn,
  type PendingServerRequest,
  type UserPreferences,
  type AgentReadinessResult,
  fetchFreebuffSessionStatus,
  releaseFreebuffSessionSlot,
  fetchClineBalance,
  findBestFreebuffFallback,
  type FreebuffSessionStatus,
  type ClineBalanceInfo
} from "../state/codexClient";
import { useAccessRuntime } from "../app/workbench/useAccessRuntime";
import { AuthenticatedWorkbench } from "./AuthenticatedWorkbench";
import { AuthLoadingScreen, LoginScreen } from "../components/AuthScreens";
import { useSettingsRuntime } from "../app/workbench/useSettingsRuntime";
import { useComposerRuntime } from "../app/workbench/useComposerRuntime";
import { useGoalRuntime } from "../app/workbench/useGoalRuntime";
import { useSelectionRuntime } from "../app/workbench/useSelectionRuntime";
import { useTaskTabsRuntime } from "../app/workbench/useTaskTabsRuntime";
import { useThreadWorkspaceRuntime } from "../app/workbench/useThreadWorkspaceRuntime";
import {
  saVmDynamicToolSpec,
  saVmDeveloperInstructions,
  enhanceDynamicToolSpec,
  enhanceDeveloperInstructions,
  buildSaVmThreadConfig
} from "../app/cli/saVmExecutionSpec";
import {
  loadWorkspaceVmPolicy,
  saveWorkspaceVmPolicy,
  createSaVmPolicyWithIdeTools,
  recordRecentWorkspace,
  type RecentWorkspaceItem
} from "../utils/recentWorkspaces";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import {
  checkFreeCompactionReadiness,
  describeFreeCompactionUnready,
  hasFreeRelay,
  listCompactionChannelOptions,
  shouldRefreshFreeCompactionModels,
  type CompactionChannelOption,
  type FreeCompactionReadiness,
  type FreeCompactionUnreadyReason
} from "../../../../frontends/free-mode/src/free/freeCompactionReadiness";
import {
  FREE_AUTOCOMPACT_COOLDOWN_MS,
  FREE_AUTOCOMPACT_MAX_THRESHOLD,
  FREE_AUTOCOMPACT_MIN_THRESHOLD,
  clampFreeAutoCompactThreshold
} from "../../../../frontends/free-mode/src/free/freeAutoCompactPreferences";
import { appReducer } from "../app/appReducer";
import {
  loadInitialThreadHistory,
  loadOlderThreadHistoryPage,
  SAFE_LEGACY_FULL_HISTORY_BYTES,
  SAFE_LEGACY_HISTORY_TAIL_BYTES,
  type ThreadHistoryPageState
} from "../app/threads/threadHistoryService";
import {
  decideModelCapacityRetry,
  isModelCapacityRetryError,
  MODEL_CAPACITY_RETRY_DELAY_MS,
  MODEL_CAPACITY_RETRY_SUCCESS_RETENTION_MS,
  shouldClearModelCapacityRetryEntry
} from "../app/modelCapacityRetry";
import {
  DEFAULT_RUNTIME_SELECTION,
  NEW_CONVERSATION_SELECTION_KEY,
  buildAgentThreadConfig,
  parseThreadRuntimeSelections,
  runtimeSelectionFallbackForThread,
  threadRuntimeSelectionsForPreferences,
  useThreadRuntimeSelections,
  type ThreadRuntimeSelection,
  type LoadedThreadRuntimeSelection
} from "../app/runtime/useThreadRuntimeSelections";
import {
  displayThreadTitle,
  filterThreadsByDateRange,
  loadAllThreads,
  loadHistoryThreadById,
  catalogForOpenedThreads,
  mergeThreadLists,
  mergeListedThreadsWithOptimistic,
  mergeSuccessfulThreadList,
  renameThreadAcrossCatalogs,
  isSshThread,
  sshThreadTooltip
} from "../app/threads/threadCatalog";
import {
  ChatPanel,
  type GoalBannerState,
  type GoalStatus,
  type PendingAppendMessage,
  type RequestMonitorEntry,
  type ThreadLoadProgress,
  type ThreadTokenUsageState,
  type TokenUsageBreakdown,
  type WorkbenchModeState,
  type WorkbenchStatsState
} from "../components/ChatPanel";
import {
  collectTaskNotificationEvents,
  createTaskNotificationTracker,
  readTaskNotificationPreferences,
  type TaskNotificationEvent
} from "../taskNotifications";
import {
  isTaskTabStripDropTarget,
  moveTaskTab,
  openTaskTab,
  parseSplitViewState,
  parseWorkspaceLayoutState,
  readWorkspaceLayoutState,
  readSplitViewState,
  reconcileOpenedTaskTabOrder,
  reconcileSplitViewState,
  reverseSplitView,
  createWorkspaceLayout,
  layoutPaneIds,
  splitWorkspacePane,
  closeWorkspacePane,
  replaceWorkspacePaneThread,
  reconcileWorkspaceLayout,
  twoPaneSplitView,
  type SplitViewState,
  type SplitDirection,
  type WorkspaceLayoutNode,
  type WorkspaceLayoutState,
  type WorkspacePaneState
} from "../taskTabs";
import {
  applyConfigWriteToView,
  buildDynamicConfigValueWrite,
  buildConfigValueWrite,
  parseConfigReadResponse,
  type CodexConfigFieldKey,
  type CodexUserConfigView
} from "../state/codexConfigSettings";
import {
  defaultLocalWorkspacePath,
  joinWorkspacePath,
  normalizeWorkspaceCwd,
  normalizeWorkspaceRoots,
  parentWorkspacePath,
  resolveTildeWorkspacePath,
  resolveWorkspaceNewFolderPath
} from "../workspacePaths";

import type { AppProps } from "../app/workbench/appConstants";
import { fetchSshDirectory as fetchSshDirectoryImpl } from "../app/workbench/sshUtils";
import { extractTurnIdFromRpcResult as extractTurnIdFromRpcResultImpl } from "../app/workbench/appUtils";

const SettingsDrawer = lazy(async () => {
  const module = await import("../settings/SettingsDrawer");
  return { default: module.SettingsDrawer };
});

const SideChatPanel = lazy(async () => {
  const module = await import("../components/SideChatPanel");
  return { default: module.SideChatPanel };
});

const RightWorkspacePanel = lazy(async () => {
  const module = await import("../components/RightWorkspacePanel");
  return { default: module.RightWorkspacePanel };
});
const ChatGptShell = lazy(async () => {
  const module = await import("../components/chatgpt-shell/ChatGptShell");
  return { default: module.ChatGptShell };
});





















export function AppRoot({ themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange }: AppProps) {
  const detachedThreadId = useMemo(() => new URLSearchParams(window.location.search).get("detachedThread")?.trim() || null, []);
  const [state, dispatch] = useReducer(appReducer, initialClientState);
  const access = useAccessRuntime({ state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId });
  const { cliPrerequisiteScreenEnabled, cliPrerequisitesComplete } = access;
  const {
    authStatus, authSession, loginError, loginSubmitting, cliPrerequisitesBlocked, markCliPrerequisitesComplete,
  } = access;
  const taskTabs = useTaskTabsRuntime({  state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId , access });
  const threadWorkspace = useThreadWorkspaceRuntime({  state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId , access, taskTabs });
  const selection = useSelectionRuntime({  state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId , access, taskTabs, threadWorkspace });
  const goals = useGoalRuntime({  state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId , access, taskTabs, threadWorkspace, selection });
  const settings = useSettingsRuntime({  state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId , access, taskTabs, threadWorkspace, selection, goals });
  const composer = useComposerRuntime({  state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId , access, taskTabs, threadWorkspace, selection, goals, settings });
  const {
    acceptCurrentLegalPolicy, leaveLegalReview, handleLogin, handleRegister, handleLogin2fa,
  } = settings;
  if (cliPrerequisiteScreenEnabled && !cliPrerequisitesComplete || authStatus !== "authenticated") {
    if (cliPrerequisitesBlocked) {
      return <CliPrerequisiteScreen onComplete={markCliPrerequisitesComplete} />;
    }
    if (authStatus === "checking") {
      return <AuthLoadingScreen />;
    }
    if (authStatus === "legalRequired" && authSession) {
      return <LegalConsentScreen session={authSession} onAccept={acceptCurrentLegalPolicy} onLogout={leaveLegalReview} />;
    }
    if (authStatus === "loginRequired") {
      return (
        <LoginScreen
          error={loginError}
          submitting={loginSubmitting}
          onSubmit={handleLogin}
          onRegister={handleRegister}
          onLogin2fa={handleLogin2fa}
        />
      );
    }
    return (
      <LoginScreen
        error={loginError}
        submitting={loginSubmitting}
        onSubmit={handleLogin}
        onRegister={handleRegister}
        onLogin2fa={handleLogin2fa}
      />
    );
  }
  /* app-root-end */
  return (
    <AuthenticatedWorkbench
      state={state}
      dispatch={dispatch}
      themeMode={themeMode}
      customThemePlugins={customThemePlugins}
      onThemeModeChange={onThemeModeChange}
      onCustomThemePluginsChange={onCustomThemePluginsChange}
      detachedThreadId={detachedThreadId}
      access={access}
      taskTabs={taskTabs}
      threadWorkspace={threadWorkspace}
      selection={selection}
      goals={goals}
      composer={composer}
      settings={settings}
    />
  );
}

async function fetchSshDirectory(token: string, command: string, path: string): Promise<JsonValue> {
  return fetchSshDirectoryImpl(token, command, path);
}

function extractTurnIdFromRpcResult(value: JsonValue): string | null {
  return extractTurnIdFromRpcResultImpl(value);
}
















































































