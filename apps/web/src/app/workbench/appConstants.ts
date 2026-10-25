import { ThreadHistoryPageState } from "../../app/threads/threadHistoryService";
import { PendingAppendMessage, RequestMonitorEntry } from "../../components/ChatPanel";
import { ClientState, PendingServerRequest, SocketConnectionStatus } from "../../state/codexClient";
import type { ModelEntry } from "../../state/codexClient";
import { ThemeMode, ThemePlugin } from "../../theme";
import { PermissionPresetId } from "@codex-ui/shared";

export const UI_STORAGE_KEYS = {
  installedThemes: "codex-ultra.installed-theme-plugins",
  leftPanelVisible: "codex-ultra.left-panel-visible",
  showAssistantUsageDetails: "codex-ultra.show-assistant-usage-details",
  waterfallDisplayMode: "codex-ultra.waterfall-display-mode",
  includeAutomationHistory: "codex-ultra.include-automation-history",
  petDockEnabled: "codex-ultra.pet-dock-enabled",
  panelLayout: "codex-ultra.panel-layout",
  filesPanelLayout: "codex-ultra.files-panel-layout",
  settingAssistantProviderId: "codex-ultra.setting-assistant-provider-id",
  settingAssistantModel: "codex-ultra.setting-assistant-model",
  threadRuntimeSelections: "codex-ultra.thread-runtime-selections",
  imageRuntimeSelections: "codex-ultra.image-runtime-selections",
  historyDateRange: "codex-ultra.history-date-range",
  taskTabOrder: "codex-ultra.task-tab-order",
  splitView: "codex-ultra.split-view",
  workspaceLayout: "codex-ultra.workspace-layout",
  splitViewLayout: "codex-ultra.split-view-layout",
  taskNotificationPreferences: "codex-ultra.task-notification-preferences",
  immersiveView: "codex-ultra.immersive-view",
  topBarPinned: "codex-ultra.top-bar-pinned-v2",
  mobileTopBarCollapsed: "codex-ultra.mobile-top-bar-collapsed"
} as const;

export const AGY_OFFICIAL_MODELS: Array<ModelEntry & { model: string; id: string; displayName: string }> = [
  { id: "gemini-3.8-flash-high", model: "gemini-3.8-flash-high", displayName: "Gemini 3.8 Flash (High)" },
  { id: "gemini-3.8-flash-medium", model: "gemini-3.8-flash-medium", displayName: "Gemini 3.8 Flash (Medium)" },
  { id: "gemini-3.8-flash-low", model: "gemini-3.8-flash-low", displayName: "Gemini 3.8 Flash (Low)" },
  { id: "gemini-3.7-flash-high", model: "gemini-3.7-flash-high", displayName: "Gemini 3.7 Flash (High)" },
  { id: "gemini-3.7-flash-medium", model: "gemini-3.7-flash-medium", displayName: "Gemini 3.7 Flash (Medium)" },
  { id: "gemini-3.7-flash-low", model: "gemini-3.7-flash-low", displayName: "Gemini 3.7 Flash (Low)" },
  { id: "gemini-3.6-flash-high", model: "gemini-3.6-flash-high", displayName: "Gemini 3.6 Flash (High)" },
  { id: "gemini-3.1-pro-high", model: "gemini-3.1-pro-high", displayName: "Gemini 3.1 Pro (High)" },
  { id: "gemini-3.1-pro-low", model: "gemini-3.1-pro-low", displayName: "Gemini 3.1 Pro (Low)" },
  { id: "claude-sonnet-4-6", model: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6 (Thinking)" },
  { id: "claude-opus-4-6-thinking", model: "claude-opus-4-6-thinking", displayName: "Claude Opus 4.6 (Thinking)" },
  { id: "gpt-oss-120b-medium", model: "gpt-oss-120b-medium", displayName: "GPT-OSS 120B (Medium)" },
];

export const GROK_OFFICIAL_MODELS: Array<ModelEntry & { model: string; id: string; displayName: string }> = [
  { id: "grok-4.6", model: "grok-4.6", displayName: "Grok 4.6" },
];

export const DEFAULT_NEW_CHAT_CWD = "~/";

export const DEFAULT_LOCAL_WORKSPACE_PICKER_PATH = "~/";

export const DEFAULT_SSH_WORKSPACE_COMMAND = "ssh user@192.168.11.1";

export const DEFAULT_SSH_WORKSPACE_CWD = "/home/user";

export const CODEX_PROVIDER_TEST_PROMPT = "Reply with exactly: CODEX_RELAY_OK";

export const MAX_TERMINAL_OUTPUT_CHARS = 160_000;

export type AppProps = {
  themeMode: ThemeMode;
  customThemePlugins: ThemePlugin[];
  onThemeModeChange: (mode: ThemeMode) => void;
  onCustomThemePluginsChange: (plugins: ThemePlugin[]) => void;
};

export type DangerDialogIntent = {
  source: "new-chat" | "permission";
  nextPermission: PermissionPresetId;
};

export type WorkspaceMode = "local" | "ssh";

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type StartCodexTurnOptions = {
  threadIdOverride?: string;
  /** JEV 自动督促的内部发送：不清除用户手动停止抑制标记。 */
  jevAutoNudge?: boolean;
  workspaceModeOverride?: "local" | "ssh";
  sshCommandOverride?: string;
  preserveText?: boolean;
  forceEffort?: string;
  collaborationMode?: "plan" | "default";
  displayText?: string;
  forceNewTurn?: boolean;
  automaticPlanContinuation?: boolean;
  enablePlanAutoContinuation?: boolean;
  suppressUserMessage?: boolean;
  awaitTurnStarted?: boolean;
  onTurnStarted?: (threadId: string, turnId: string) => void;
  steerOnly?: boolean;
};

export type PlanImplementationPrompt = {
  threadId: string;
  turnId: string;
  itemId: string;
  planText: string;
};

export type SlashCommandNotice = {
  id: string;
  title: string;
  message: string;
  severity: "info" | "success" | "warning";
};

export type DetachedTaskSnapshot = {
  threadId: string;
  thread: ClientState["threads"][number];
  turns?: ClientState["turns"];
  pageState?: ThreadHistoryPageState;
  scrollTop?: number;
};

export const AUTH_TOKEN_STORAGE_KEY = "codex-ultra.authToken";

export const LEGAL_ACCEPTANCE_STORAGE_PREFIX = "codex-ultra.legalAcceptance";

export const OFFICIAL_WEBSITE_URL = "https://codex-ultra.top";

export const DISCORD_INVITE_URL = "https://discord.gg/QCNUx8FaV";

export const ACTIVE_TURN_RECONCILE_INTERVAL_MS = 20_000;

export const ACTIVE_TURN_RECONCILE_IDLE_MS = 15_000;

// The server rotates a session once it is past half its lifetime, so polling
// well inside the shortest supported lifetime keeps an open app signed in.
export const SESSION_KEEPALIVE_INTERVAL_MS = 15 * 60_000;

export const SESSION_KEEPALIVE_MIN_INTERVAL_MS = 60_000;

export type AuthStatus = "checking" | "loginRequired" | "legalRequired" | "authenticated";

export type SshPreflightResult = {
  ready: boolean; connected: boolean; os: string; arch: string; codexPath: string; codexVersion: string;
  appServerAvailable: boolean; cwdExists: boolean; cwdReadable: boolean; cwdWritable: boolean; reasons: string[];
};

export type SshConfigHost = { alias: string; hostname: string; user: string; port: number; configFile: string };

export const INITIAL_SOCKET_CONNECTION_STATUS: SocketConnectionStatus = {
  phase: "disconnected",
  at: 0,
  reason: "Not connected"
};

export const EMPTY_ERRORS: string[] = [];

export const EMPTY_PENDING_APPENDS: PendingAppendMessage[] = [];

export const EMPTY_PENDING_REQUESTS: PendingServerRequest[] = [];

export const EMPTY_REQUEST_MONITOR: RequestMonitorEntry[] = [];
