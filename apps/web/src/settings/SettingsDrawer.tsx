import { relayNameConflict } from "../relayNameValidation";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  LinearProgress,
  MenuItem,
  Paper,
  Radio,
  Select,
  Slider,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  AdvancedModelMappingRule,
  ChannelGroupConfig,
  CompactMode,
  DangerousPermissionAuditEvent,
  ImageGenerationProtocol,
  JsonValue,
  ProviderConfig,
  RelayCapabilityCatalog,
  RelayCatalogImportPreview,
  RelayCatalogImportResult,
  StationType
} from "@codex-ui/shared";
import { Fragment, forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Dispatch, type MouseEvent, type ReactNode, type SetStateAction } from "react";
import CloseIcon from "@mui/icons-material/Close";
import AssessmentIcon from "@mui/icons-material/Assessment";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ColorLensIcon from "@mui/icons-material/ColorLens";
import ComputerIcon from "@mui/icons-material/Computer";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import DashboardCustomizeIcon from "@mui/icons-material/DashboardCustomize";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import ExtensionIcon from "@mui/icons-material/Extension";
import WidgetsIcon from "@mui/icons-material/Widgets";
import LayersIcon from "@mui/icons-material/Layers";
import MemoryIcon from "@mui/icons-material/Memory";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PsychologyIcon from "@mui/icons-material/Psychology";
import PetsIcon from "@mui/icons-material/Pets";
import LightModeIcon from "@mui/icons-material/LightMode";
import RefreshIcon from "@mui/icons-material/Refresh";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import HubIcon from "@mui/icons-material/Hub";
import TerminalIcon from "@mui/icons-material/Terminal";
import SaveIcon from "@mui/icons-material/Save";
import SearchIcon from "@mui/icons-material/Search";
import SecurityIcon from "@mui/icons-material/Security";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import GitHubIcon from "@mui/icons-material/GitHub";
import SettingsSuggestIcon from "@mui/icons-material/SettingsSuggest";
import StorageIcon from "@mui/icons-material/Storage";
import { DEFAULT_CHAT_TYPOGRAPHY, type ChatTypographyPreference } from "../chatTypography";
import type { WaterfallDisplayMode } from "../waterfall/chatRows";
import { clampRetryCount } from "../state/retrySettings";
import TokenIcon from "@mui/icons-material/Token";
import TuneIcon from "@mui/icons-material/Tune";
import AddIcon from "@mui/icons-material/Add";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RestoreFromTrashIcon from "@mui/icons-material/RestoreFromTrash";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import GridViewIcon from "@mui/icons-material/GridView";
import TableRowsIcon from "@mui/icons-material/TableRows";
import ViewListIcon from "@mui/icons-material/ViewList";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ShareIcon from "@mui/icons-material/Share";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";

const OFFICIAL_WEBSITE_URL = "https://codex-ultra.top";
const OFFICIAL_GITHUB_URL = "https://github.com/layola13/codex-ultra";
// Cursor's "local mode" gateway is a compile-time build flag (buildFlags.js
// localMode:!0) that only exists in Cursor's enterprise/on-prem builds; the
// consumer Windows build ignores --local-mode entirely, so the injected
// launcher cannot bypass its login wall. Entry hidden until a workable
// activation path exists.
const CURSOR_INJECTION_ENABLED = false;
const FETCHED_MODELS_PAGE_SIZE = 30;
const ALL_CODEX_CONFIG_PAGE_SIZE = 40;
const DEFAULT_CLAUDE_CODE_VERSION = "2.1.223";
const CLAUDE_MODEL_PATTERN = /(?:^|[./:_-])claude(?:[./:_-]|$)/i;
const CLAUDE_FAMILY_MAPPING_MODELS = [
  { model: "claude-fable-5", tier: "fable" },
  { model: "claude-haiku-4-5", tier: "haiku" },
  { model: "claude-haiku-4-5-20251001", tier: "haiku" },
  { model: "claude-opus-4-5-20251101", tier: "opus" },
  { model: "claude-opus-4-6", tier: "opus" },
  { model: "claude-opus-4-7", tier: "opus" },
  { model: "claude-opus-4-8", tier: "opus" },
  { model: "claude-opus-4.8", tier: "opus" },
  { model: "claude-sonnet-4-5-20250929", tier: "sonnet" },
  { model: "claude-sonnet-4-6", tier: "sonnet" },
  { model: "claude-sonnet-5", tier: "sonnet" }
] as const;
const CLAUDE_FAMILY_MAPPING_OPTIONS = CLAUDE_FAMILY_MAPPING_MODELS.flatMap((entry) => [
  entry,
  { ...entry, model: `${entry.model}[1m]` }
] as const);
const DEFAULT_CLAUDE_FAMILY_MAPPING_MODEL = "claude-sonnet-5";
const CLAUDE_FAMILY_MAPPING_DEFAULT_ORDER = [
  DEFAULT_CLAUDE_FAMILY_MAPPING_MODEL,
  ...CLAUDE_FAMILY_MAPPING_OPTIONS.map((entry) => entry.model).filter((model) => model !== DEFAULT_CLAUDE_FAMILY_MAPPING_MODEL)
];

function defaultClaudeModelMappings(models: string[], current: Record<string, string> = {}): Record<string, string> {
  const used = new Set<string>();
  return Object.fromEntries(models.flatMap((model) => {
    if (CLAUDE_MODEL_PATTERN.test(stripModelContextVariant(model).baseModel)) return [];
    const existing = current[model];
    const target = existing && !used.has(stripModelContextVariant(existing).baseModel)
      ? existing
      : CLAUDE_FAMILY_MAPPING_DEFAULT_ORDER.find((candidate) => !used.has(stripModelContextVariant(candidate).baseModel));
    if (!target) return [];
    used.add(stripModelContextVariant(target).baseModel);
    return [[model, target]];
  }));
}

function openOfficialWebsite(event: MouseEvent<HTMLAnchorElement>) {
  if (!window.codexUltraDesktop) return;
  event.preventDefault();
  void window.codexUltraDesktop.openExternal(OFFICIAL_WEBSITE_URL);
}

function openOfficialGithub(event: MouseEvent<HTMLAnchorElement>) {
  if (!window.codexUltraDesktop) return;
  event.preventDefault();
  void window.codexUltraDesktop.openExternal(OFFICIAL_GITHUB_URL);
}
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import WavesIcon from "@mui/icons-material/Waves";
import {
  expandModelContextVariants,
  FREE_OLLAMA_ENABLED,
  modelChoiceDisplayName,
  permissionPresets,
  stripModelContextVariant,
  type AuthUser,
  type LegalPolicyBundle,
  type PermissionPresetId
} from "@codex-ui/shared";
import {
  CODEX_CONFIG_FIELD_META,
  formatConfigValueForField,
  getConfigValueAtPath,
  getDynamicCodexConfigFields,
  parseDynamicConfigFieldValue,
  type CodexConfigFieldKey,
  type CodexUserConfigView,
  type DynamicCodexConfigField
} from "../state/codexConfigSettings";
import {
  REFERENCE_BACKGROUND_TUNING,
  clampThemeBlur,
  isHexColor,
  percentToUnit,
  themePlugins,
  themeVisualTuning,
  unitToPercent,
  type ThemeBackgroundScene,
  type ThemeId,
  type ThemeMode,
  type ThemePlugin
} from "../theme";
import type {
  FsDirectoryEntry,
  McpResourceContentEntry,
  PluginDetailEntry,
  PluginEntry,
  PluginInstallAuthNotice,
  PluginMarketplace,
  SkillEntry,
  ToolingState
} from "../state/codexClient";
import { fetchForwardSettings, fetchLegalPolicy, fetchProviderModels, fetchRelaySettings, fetchRelaySettingsList, fetchTrashedRelaySettingsList, previewCapabilityCatalog, previewCapabilityCatalogUrl, testProvider, updateForwardSettings, type ForwardSettings, type FreeOllamaImportResponse, type RelaySettingsListEntry } from "../state/codexClient";
import { paginateRelayList } from "../app/settings/relayListPagination";
import { CodexPluginSettingsPanel, type CodexPluginSettingsTab } from "../components/CodexPluginSettingsPanel";
import { PluginManagerPanel } from "./PluginManagerPanel";
import { PetDock } from "../components/PetDock";
import {
  FREE_AUTOCOMPACT_DEFAULT_THRESHOLD,
  FREE_AUTOCOMPACT_MAX_THRESHOLD,
  FREE_AUTOCOMPACT_MIN_THRESHOLD,
  clampFreeAutoCompactThreshold
} from "../../../../frontends/free-mode/src/free/freeAutoCompactPreferences";
import type { CompactionChannelOption } from "../../../../frontends/free-mode/src/free/freeCompactionReadiness";
import { WorkspaceFilesSettingsPanel, type OpenWorkspaceFile } from "../components/WorkspaceFilesSettingsPanel";

import { MembersPermissionsPanel } from "../components/MembersPermissionsPanel";
import { CliBackendSettingsPanel } from "../components/CliBackendSettingsPanel";
import { SecuritySettingsPanel } from "../components/SecuritySettingsPanel";
import { UsageBillingPanel } from "../components/UsageBillingPanel";
import { GatewayStatsPanel } from "../components/GatewayStatsPanel";
import { VendorLogo } from "../components/VendorLogo";
import { MarkdownMessage } from "../components/MarkdownMessage";
import type { TranslateFn, TranslationKey } from "../i18n";
import type { TaskNotificationPreferences } from "../taskNotifications";
import { useTour } from "../onboarding/useOnboarding";
import {
  catalogGroupTemplates,
  createInitialRelayGroupUiState,
  filterAndSortRelayGroups,
  filterCatalogGroupsByTree,
  hasConfiguredRelayGroupKey,
  incompatibleRelayGroupModels,
  materializeFetchedModelsForSave,
  mergeCatalogGroupDrafts,
  parseRelayGroupKeys,
  relayGroupModelsForEditing,
  relayGroupSelectableModels,
  relayGroupsMissingKeys,
  relayGroupUsageRate,
  type RelayGroupProtocolFilter,
  type RelayCatalogTreeSelection,
  type RelayGroupSort,
  type RelayGroupStatusFilter
} from "../groupCollection";
import { buildAdvancedRelayDirectory, defaultAdvancedRelayVendor, type AdvancedRelayVendorOption } from "../advancedRelayDirectory";

function FreeAutoCompactSettings({
  enabled,
  threshold,
  providerId,
  groupId,
  model,
  channels,
  compactMode,
  jevCompressThreshold,
  compactCapabilityWarning,
  onEnabledChange,
  onThresholdChange,
  onProviderChange,
  onGroupChange,
  onModelChange,
  onCompactModeChange,
  onJevCompressThresholdChange,
  t
}: {
  enabled: boolean;
  threshold: number;
  providerId: string | null;
  groupId: string | null;
  model: string | null;
  channels: CompactionChannelOption[];
  compactMode: CompactMode;
  jevCompressThreshold: number;
  compactCapabilityWarning: string | null;
  onEnabledChange(enabled: boolean): void;
  onThresholdChange(threshold: number): void;
  onProviderChange(providerId: string | null): void;
  onGroupChange(groupId: string | null): void;
  onModelChange(model: string | null): void;
  onCompactModeChange(mode: CompactMode): void;
  onJevCompressThresholdChange(threshold: number): void;
  t: TranslateFn;
}) {
  const providerOptions = Array.from(new Map(channels.map((option) => [option.providerId, option])).values());
  const groupOptions = providerId ? channels.filter((option) => option.providerId === providerId) : [];
  const selectedChannel = providerId
    ? groupOptions.find((option) => option.groupId === groupId) ?? null
    : null;
  const models = selectedChannel?.models ?? [];
  const missingProvider = Boolean(providerId && !providerOptions.some((option) => option.providerId === providerId));
  const missingGroup = Boolean(providerId && !selectedChannel);
  const missingModel = Boolean(model && !models.includes(model));

  return (
    <SettingRow
      title="省钱模式（自动上下文压缩）"
      description="仅当前对话：廉价模型在发送前达到阈值时压缩并恢复路由；JEV模式裁剪工具历史。四种策略互斥，切换线程显示该线程自己的值。"
    >
      <Stack spacing={1} sx={{ width: 280 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          fullWidth
          value={compactMode}
          onChange={(_, v) => { if (v) onCompactModeChange(v as CompactMode); }}
          aria-label="压缩策略"
        >
          <ToggleButton value="off" aria-label="关闭压缩">关闭</ToggleButton>
          <ToggleButton value="cheap" aria-label="廉价模型压缩">廉价模型</ToggleButton>
          <ToggleButton value="jev-sub" aria-label={t("jev.drawer.subAria")}>{t("jev.drawer.subLabel")}</ToggleButton>
          <ToggleButton value="jev-token" aria-label={t("jev.drawer.tokenAria")}>{t("jev.drawer.tokenLabel")}</ToggleButton>
        </ToggleButtonGroup>
        {compactMode === "cheap" && (
        <>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{FREE_AUTOCOMPACT_MIN_THRESHOLD}%</Typography>
          <Slider
            size="small"
            value={threshold}
            min={FREE_AUTOCOMPACT_MIN_THRESHOLD}
            max={FREE_AUTOCOMPACT_MAX_THRESHOLD}
            step={1}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${v}%`}
            onChange={(_, v) => onThresholdChange(typeof v === "number" ? clampFreeAutoCompactThreshold(v) : threshold)}
          />
          <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{FREE_AUTOCOMPACT_MAX_THRESHOLD}%</Typography>
        </Stack>
        <FormControl size="small" fullWidth>
          <InputLabel>压缩渠道</InputLabel>
          <Select
            value={providerId ?? "__select__"}
            label="压缩渠道"
            onChange={(event) => onProviderChange(event.target.value === "__select__" ? null : event.target.value)}
          >
            <MenuItem value="__select__">请选择压缩渠道和模型</MenuItem>
            {missingProvider && <MenuItem value={providerId!} disabled>{`${providerId}（已不可用）`}</MenuItem>}
            {providerOptions.map((option) => <MenuItem key={option.providerId} value={option.providerId}>{option.providerName}</MenuItem>)}
          </Select>
        </FormControl>
        {providerId && (
          <FormControl size="small" fullWidth>
            <InputLabel>渠道分组</InputLabel>
            <Select
              value={groupId ?? "__default__"}
              label="渠道分组"
              onChange={(event) => onGroupChange(event.target.value === "__default__" ? null : event.target.value)}
            >
              {missingGroup && groupId && <MenuItem value={groupId} disabled>{`${groupId}（已不可用）`}</MenuItem>}
              {groupOptions.map((option) => (
                <MenuItem key={`${option.providerId}:${option.groupId ?? "default"}`} value={option.groupId ?? "__default__"}>{option.groupName}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {providerId && (
          <FormControl size="small" fullWidth>
            <InputLabel>压缩模型</InputLabel>
            <Select value={model ?? ""} label="压缩模型" onChange={(event) => onModelChange(event.target.value)}>
              {missingModel && <MenuItem value={model!} disabled>{`${model}（已不可用）`}</MenuItem>}
              {models.map((entry) => <MenuItem key={entry} value={entry}>{entry}</MenuItem>)}
            </Select>
          </FormControl>
        )}
        <Typography variant="caption" color={missingProvider || missingGroup || missingModel ? "warning.main" : "text.secondary"}>
          {missingProvider
            ? "所选压缩渠道已不可用，请重新选择或切回自动匹配。"
            : missingGroup
              ? "所选渠道分组已不可用，请重新选择。"
              : missingModel
                ? "所选压缩模型已不可用，请重新选择。"
                : providerId
                  ? "手动路由只用于此对话的上下文压缩，不会改变聊天模型。"
                  : "自动模式会检查免费渠道和当前聊天模型的映射；未获取时会弹出获取窗口。"}
        </Typography>
        <Typography variant="caption" color="text.secondary">{`当前阈值：${threshold}% · 默认 ${FREE_AUTOCOMPACT_DEFAULT_THRESHOLD}%`}</Typography>
        </>)}
        {(compactMode === "jev-sub" || compactMode === "jev-token") && (
        <>
        {compactCapabilityWarning && (
          <Typography variant="caption" color="warning.main">{compactCapabilityWarning}</Typography>
        )}
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{FREE_AUTOCOMPACT_MIN_THRESHOLD}%</Typography>
          <Slider
            size="small"
            value={jevCompressThreshold}
            min={FREE_AUTOCOMPACT_MIN_THRESHOLD}
            max={FREE_AUTOCOMPACT_MAX_THRESHOLD}
            step={1}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${v}%`}
            aria-label={t("jev.drawer.thresholdAria")}
            onChange={(_, v) => onJevCompressThresholdChange(typeof v === "number" ? clampFreeAutoCompactThreshold(v) : jevCompressThreshold)}
          />
          <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{FREE_AUTOCOMPACT_MAX_THRESHOLD}%</Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">{t("jev.drawer.thresholdCaption", { value: jevCompressThreshold })}</Typography>
        </>)}
      </Stack>
    </SettingRow>
  );
}

const MULTI_AGENT_V2_QUICK_FIELDS: DynamicCodexConfigField[] = [
  {
    keyPath: "features.multi_agent_v2.enabled",
    label: "Features / Multi Agent V2 / Enabled",
    description: "Expose Codex multi-agent collaboration tools for new sessions.",
    kind: "boolean",
    group: "features",
    defaultValue: true,
    source: "schema"
  },
  {
    keyPath: "features.multi_agent_v2.max_concurrent_threads_per_session",
    label: "Features / Multi Agent V2 / Max Concurrent Threads Per Session",
    description: "Maximum total agent threads per session, including the root agent.",
    kind: "number",
    group: "features",
    source: "schema"
  },
  {
    keyPath: "features.context_management.experimental_mode",
    label: "Features / Context Management / Experimental Mode",
    description: "Enables experimental context management in the Codex engine.",
    kind: "boolean",
    group: "features",
    defaultValue: true,
    source: "schema"
  }
];

export type ReasoningOption = {
  value: string;
  label: string;
  description?: string;
};

export type SettingsSectionId =
  | "assistant"
  | "codex"
  | "appearance"
  | "layout"
  | "notifications"
  | "workspace"
  | "session"
  | "relay"
  | "launch"
  | "skills"
  | "plugins"
  | "appplugins"
  | "pet"
  | "members"
  | "usage"
  | "gateway"
  | "security"
  | "privacy"
  | "about";

type Props = {
  open: boolean;
  windowsDesktop?: boolean;
  disablePortal?: boolean;
  initialSection?: SettingsSectionId;
  initialPluginTab?: CodexPluginSettingsTab;
  initialRelayProviderId?: string | null;
  initialRelayGroupId?: string | null;
  themeMode: ThemeMode;
  installedThemePluginIds: ThemeId[];
  customThemePlugins: ThemePlugin[];
  leftPanelVisible: boolean;
  showAssistantUsageDetails: boolean;
  waterfallDisplayMode: WaterfallDisplayMode;
  chatTypography: ChatTypographyPreference;
  petDockEnabled: boolean;
  notificationPreferences: TaskNotificationPreferences;
  capacityTurnRetryEnabled: boolean;
  freeOllamaEnabled: boolean;
  freeAutoCompactEnabled: boolean;
  freeAutoCompactThreshold: number;
  freeAutoCompactProviderId: string | null;
  freeAutoCompactGroupId: string | null;
  freeAutoCompactModel: string | null;
  compactMode: CompactMode;
  jevCompressThreshold: number;
  compactCapabilityWarning: string | null;
  freeCompactionChannels: CompactionChannelOption[];
  cwd: string;
  permission: PermissionPresetId;
  providers: ProviderConfig[];
  activeProviderId: string | null;
  selectedModel: string;
  settingAssistantProviderId: string;
  settingAssistantModel: string;
  settingAssistantReady: boolean;
  settingAssistantEffectiveModel: string;
  reasoningEffort: string;
  reasoningOptions: ReasoningOption[];
  codexConfig: CodexUserConfigView | null;
  codexConfigLoading: boolean;
  codexConfigSaving: boolean;
  codexConfigError: string | null;
  tooling: ToolingState;
  toolingLoading: boolean;
  skillExtraRoots: string[];
  skillPreviews: Record<string, string>;
  fileDirectories: Record<string, FsDirectoryEntry[]>;
  openFile: OpenWorkspaceFile | null;
  filesPanelLayout?: Record<string, number>;
  activeThreadId: string | null;
  pluginDetails: Record<string, PluginDetailEntry>;
  pluginSkillPreviews: Record<string, string>;
  pluginAuthNotices: Record<string, PluginInstallAuthNotice>;
  installingPluginIds: Set<string>;
  mcpResourceContents: Record<string, McpResourceContentEntry[]>;
  mcpOauthUrls: Record<string, string>;
  auditEvents: DangerousPermissionAuditEvent[];
  currentUser: AuthUser | null;
  members: AuthUser[];
  membersLoading: boolean;
  membersError: string | null;
  allowedPermissions: PermissionPresetId[];
  t: TranslateFn;
  onClose: () => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onReplaySetupGuide: () => void;
  onInstallThemePlugin: (id: ThemeId) => void;
  onUninstallThemePlugin: (id: ThemeId) => void;
  onSaveCustomThemePlugin: (plugin: ThemePlugin) => void;
  onRemoveCustomThemePlugin: (id: ThemeId) => void;
  onLeftPanelVisibleChange: (visible: boolean) => void;
  onShowAssistantUsageDetailsChange: (visible: boolean) => void;
  onWaterfallDisplayModeChange: (mode: WaterfallDisplayMode) => void;
  onChatTypographyChange: (value: ChatTypographyPreference) => void;
  onIncludeAutomationHistoryChange?: (enabled: boolean) => void;
  onPetDockEnabledChange: (enabled: boolean) => void;
  onNotificationPreferencesChange: (preferences: TaskNotificationPreferences) => void;
  onCapacityTurnRetryEnabledChange: (enabled: boolean) => void;
  onFreeOllamaEnabledChange: (enabled: boolean) => void;
  onFreeAutoCompactEnabledChange: (enabled: boolean) => void;
  onFreeAutoCompactThresholdChange: (threshold: number) => void;
  onFreeAutoCompactProviderChange: (providerId: string | null) => void;
  onFreeAutoCompactGroupChange: (groupId: string | null) => void;
  onFreeAutoCompactModelChange: (model: string | null) => void;
  onCompactModeChange: (mode: CompactMode) => void;
  onJevCompressThresholdChange: (threshold: number) => void;
  onCwdChange: (cwd: string) => void;
  onPermissionChange: (permission: PermissionPresetId) => void;
  onReasoningEffortChange: (effort: string) => void;
  onSettingAssistantProviderChange: (providerId: string) => void;
  onSettingAssistantModelChange: (model: string) => void;
  onReloadCodexConfig: () => void;
  onCodexConfigFieldChange: (field: CodexConfigFieldKey, value: string) => void;
  onCodexConfigValueChange: (keyPath: string, value: JsonValue) => void;
  onSaveProvider: (provider: ProviderConfig, apiKey?: string, mergeIntoProviderId?: string) => Promise<void>;
  onShareProvider?: (provider: ProviderConfig) => void;
  onImportSharedRelay?: () => void;
  onSyncFreeOllama: () => Promise<FreeOllamaImportResponse>;
  onRequestOmniRouteFreeSync: () => void;
  onActivateProvider: (providerId: string, model?: string, groupId?: string) => Promise<void>;
  onInjectClaudeDesktop?: (
    providerId: string,
    groupId?: string,
    models?: string[],
    modelMappings?: Record<string, string>
  ) => Promise<void>;
  onInjectCursorDesktop?: (providerId: string, groupId?: string) => Promise<void>;
  onOpenOfficialLogin?: () => void;
  onTestProviderWithCodex: (providerId: string, model?: string) => Promise<void>;
  onDeleteProvider: (providerId: string) => Promise<void>;
  onRestoreProvider: (providerId: string) => Promise<void>;
  onReloadTooling: () => void;
  onReloadMcp: () => void;
  onExportProfile: () => Promise<void>;
  onImportProfile: (file: File) => Promise<number>;
  onExportRelayConfig: () => Promise<void>;
  onImportRelayConfig: (file: File) => Promise<number>;
  onExportRelayBackup: () => Promise<void>;
  onImportRelayBackup: (file: File) => Promise<number>;
  onImportCapabilityCatalog: (providerId: string, catalog: JsonValue, mode: "merge" | "replace") => Promise<RelayCatalogImportResult>;
  onReloadAuditEvents: () => Promise<void>;
  onStartMcpOauth: (serverName: string) => void;
  onReadMcpResource: (serverName: string, uri: string) => void;
  onCallMcpTool: (serverName: string, toolName: string, args: JsonValue) => Promise<JsonValue>;
  onToggleSkill: (skill: SkillEntry, enabled: boolean) => void;
  onSaveSkillExtraRoots: (roots: string[]) => void;
  onReadSkillPreview: (skill: SkillEntry) => void;
  onCreateSkill: (input: { name: string; description: string; instructions: string }) => Promise<void>;
  onFilesPanelLayoutChange?: (layout: Record<string, number>) => void;
  onReadDirectory: (path: string) => void;
  onReadFile: (path: string) => void;
  onChangeOpenFileContent: (content: string) => void;
  onSaveOpenFile: () => void;
  onReadPluginDetail: (marketplace: PluginMarketplace, plugin: PluginEntry) => void;
  onReadPluginSkill: (marketplace: PluginMarketplace, plugin: PluginEntry, skillName: string) => void;
  onInsertPluginMention: (marketplace: PluginMarketplace, plugin: PluginEntry) => void;
  onInstallPlugin: (marketplace: PluginMarketplace, plugin: PluginEntry) => void;
  onUninstallPlugin: (plugin: PluginEntry) => void;
  onReloadMembers: () => Promise<void>;
  onCliBackendToggle?: (backend: "codex" | "claude" | "agy" | "grok" | "muse" | "pi" | "opencode" | "opencode-v2", enabled: boolean) => Promise<void>;
  cliBackendEnabled?: { codex: boolean; claude: boolean; agy: boolean; auggie: boolean; cline: boolean; "command-code": boolean; grok: boolean; muse: boolean; pi: boolean; opencode: boolean; "opencode-v2": boolean };
  cliBackendError?: string | null;
  onCreateMember: (input: {
    email: string;
    password: string;
    username?: string;
    role?: "admin" | "user";
    maxPermission?: PermissionPresetId;
    allowWrite?: boolean;
    allowNetwork?: boolean;
    allowDangerBypass?: boolean;
    balance?: number;
    concurrency?: number;
    notes?: string;
    allowedProviderIds?: string[];
  }) => Promise<void>;
  onUpdateMember: (id: string, input: Record<string, unknown>) => Promise<void>;
  onDeleteMember: (id: string) => Promise<void>;
  onAllocateMemberBalance?: (id: string, amount: number, operation?: "set" | "add" | "subtract", notes?: string) => Promise<void>;
  sessionToken?: string | null;
};

const NAV_ITEMS: Array<{ id: SettingsSectionId; labelKey: TranslationKey; icon: ReactNode }> = [
  { id: "assistant", labelKey: "settings.nav.assistant", icon: <SettingsSuggestIcon fontSize="small" /> },
  { id: "codex", labelKey: "settings.nav.codex", icon: <StorageIcon fontSize="small" /> },
  { id: "appearance", labelKey: "settings.nav.appearance", icon: <ColorLensIcon fontSize="small" /> },
  { id: "layout", labelKey: "settings.nav.layout", icon: <DashboardCustomizeIcon fontSize="small" /> },
  { id: "notifications", labelKey: "settings.nav.notifications", icon: <NotificationsActiveIcon fontSize="small" /> },
  { id: "workspace", labelKey: "settings.nav.workspace", icon: <StorageIcon fontSize="small" /> },
  { id: "session", labelKey: "settings.nav.session", icon: <TuneIcon fontSize="small" /> },
  { id: "relay", labelKey: "settings.nav.relay", icon: <MemoryIcon fontSize="small" /> },
  { id: "launch", labelKey: "settings.nav.launch", icon: <RocketLaunchIcon fontSize="small" /> },
  { id: "skills", labelKey: "settings.nav.skills", icon: <PsychologyIcon fontSize="small" /> },
  { id: "plugins", labelKey: "settings.nav.plugins", icon: <ExtensionIcon fontSize="small" /> },
  { id: "appplugins", labelKey: "settings.nav.appplugins", icon: <WidgetsIcon fontSize="small" /> },
  { id: "pet", labelKey: "settings.nav.pet", icon: <PetsIcon fontSize="small" /> },
  { id: "members", labelKey: "settings.nav.permissions", icon: <SecurityIcon fontSize="small" /> },
  { id: "usage", labelKey: "settings.nav.usage", icon: <AssessmentIcon fontSize="small" /> },
  { id: "gateway", labelKey: "settings.nav.gateway", icon: <HubIcon fontSize="small" /> },
  { id: "security", labelKey: "settings.nav.security", icon: <SecurityIcon fontSize="small" /> },
  { id: "privacy", labelKey: "settings.nav.privacy", icon: <SecurityIcon fontSize="small" /> },
  { id: "about", labelKey: "settings.nav.about", icon: <InfoOutlinedIcon fontSize="small" /> }
];

const WINDOWS_HIDDEN_SETTINGS = new Set<SettingsSectionId>(["members", "workspace", "session", "security"]);

export function SettingsDrawer({
  open,
  windowsDesktop = false,
  disablePortal = false,
  initialSection = "assistant",
  initialPluginTab = "marketplace",
  initialRelayProviderId = null,
  initialRelayGroupId = null,
  themeMode,
  installedThemePluginIds,
  customThemePlugins,
  leftPanelVisible,
  showAssistantUsageDetails,
  waterfallDisplayMode,
  petDockEnabled,
  notificationPreferences,
  capacityTurnRetryEnabled,
  freeOllamaEnabled,
  freeAutoCompactEnabled,
  freeAutoCompactThreshold,
  freeAutoCompactProviderId,
  freeAutoCompactGroupId,
  freeAutoCompactModel,
  compactMode,
  jevCompressThreshold,
  compactCapabilityWarning,
  freeCompactionChannels,
  cwd,
  permission,
  providers,
  activeProviderId,
  selectedModel,
  settingAssistantProviderId,
  settingAssistantModel,
  settingAssistantReady,
  settingAssistantEffectiveModel,
  reasoningEffort,
  reasoningOptions,
  codexConfig,
  codexConfigLoading,
  codexConfigSaving,
  codexConfigError,
  tooling,
  toolingLoading,
  skillExtraRoots,
  skillPreviews,
  fileDirectories,
  openFile,
  filesPanelLayout,
  activeThreadId,
  pluginDetails,
  pluginSkillPreviews,
  pluginAuthNotices,
  installingPluginIds,
  mcpResourceContents,
  mcpOauthUrls,
  auditEvents,
  currentUser,
  sessionToken,
  cliBackendEnabled,
  cliBackendError,
  onCliBackendToggle,
  members,
  membersLoading,
  membersError,
  allowedPermissions,
  t,
  onClose,
  onThemeModeChange,
  onReplaySetupGuide,
  chatTypography,
  onInstallThemePlugin,
  onUninstallThemePlugin,
  onSaveCustomThemePlugin,
  onRemoveCustomThemePlugin,
  onLeftPanelVisibleChange,
  onShowAssistantUsageDetailsChange,
  onWaterfallDisplayModeChange,
  onChatTypographyChange,
  onIncludeAutomationHistoryChange,
  onPetDockEnabledChange,
  onNotificationPreferencesChange,
  onCapacityTurnRetryEnabledChange,
  onFreeOllamaEnabledChange,
  onFreeAutoCompactEnabledChange,
  onFreeAutoCompactThresholdChange,
  onFreeAutoCompactProviderChange,
  onFreeAutoCompactGroupChange,
  onFreeAutoCompactModelChange,
  onCompactModeChange,
  onJevCompressThresholdChange,
  onCwdChange,
  onPermissionChange,
  onReasoningEffortChange,
  onSettingAssistantProviderChange,
  onSettingAssistantModelChange,
  onReloadCodexConfig,
  onCodexConfigFieldChange,
  onCodexConfigValueChange,
  onSaveProvider,
  onShareProvider,
  onImportSharedRelay,
  onSyncFreeOllama,
  onRequestOmniRouteFreeSync,
  onActivateProvider,
  onInjectClaudeDesktop,
  onInjectCursorDesktop,
  onTestProviderWithCodex,
  onDeleteProvider,
  onRestoreProvider,
  onReloadTooling,
  onReloadMcp,
  onExportProfile,
  onImportProfile,
  onExportRelayConfig,
  onImportRelayConfig,
  onExportRelayBackup,
  onImportRelayBackup,
  onImportCapabilityCatalog,
  onReloadAuditEvents,
  onStartMcpOauth,
  onReadMcpResource,
  onCallMcpTool,
  onToggleSkill,
  onSaveSkillExtraRoots,
  onReadSkillPreview,
  onCreateSkill,
  onFilesPanelLayoutChange,
  onReadDirectory,
  onReadFile,
  onChangeOpenFileContent,
  onSaveOpenFile,
  onReadPluginDetail,
  onReadPluginSkill,
  onInsertPluginMention,
  onInstallPlugin,
  onUninstallPlugin,
  onReloadMembers,
  onCreateMember,
  onUpdateMember,
  onDeleteMember,
  onAllocateMemberBalance
}: Props) {
  const isCodexPluginEnabled = cliBackendEnabled?.codex ?? false;
  const [section, setSection] = useState<SettingsSectionId>(() => (initialSection === "codex" && !isCodexPluginEnabled ? "assistant" : initialSection));
  const tour = useTour();
  const [codexConfigMode, setCodexConfigMode] = useState<"quick" | "all">("quick");
  const [codexConfigSearch, setCodexConfigSearch] = useState("");
  const [codexConfigPage, setCodexConfigPage] = useState(0);
  const [editingThemePlugin, setEditingThemePlugin] = useState<ThemePlugin | null>(null);
  const codexConfigListRef = useRef<HTMLDivElement | null>(null);
  const activeProvider = providers.find((provider) => provider.id === activeProviderId);
  const settingAssistantProvider = providers.find((provider) => provider.id === settingAssistantProviderId) ?? null;
  const settingAssistantModelOptions = settingAssistantProvider ? providerModelOptions(settingAssistantProvider) : [];
  const selectedReasoning = reasoningOptions.find((option) => option.value === reasoningEffort);
  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => (
      (!windowsDesktop || !WINDOWS_HIDDEN_SETTINGS.has(item.id))
      && (item.id !== "members" || currentUser?.role === "admin")
      && (item.id !== "codex" || isCodexPluginEnabled)
    )),
    [currentUser?.role, isCodexPluginEnabled, windowsDesktop]
  );
  const permissionChoices = useMemo(
    () => permissionPresets.filter((preset) => allowedPermissions.includes(preset.id)),
    [allowedPermissions]
  );
  const isAdmin = currentUser?.role === "admin";
  const canEditCodexConfig = isAdmin || !currentUser; // local-token mode: full access
  const canManageRelay = isAdmin || !currentUser;

  const allThemePlugins = useMemo(
    () => [...themePlugins, ...customThemePlugins.filter((plugin) => !themePlugins.some((entry) => entry.id === plugin.id))],
    [customThemePlugins]
  );
  const dynamicCodexConfigFields = useMemo(
    () => (codexConfigMode === "all" ? getDynamicCodexConfigFields(codexConfig?.rawConfig) : []),
    [codexConfig?.rawConfig, codexConfigMode]
  );
  const filteredDynamicCodexConfigFields = useMemo(() => {
    const needle = codexConfigSearch.trim().toLowerCase();
    return dynamicCodexConfigFields.filter((field) => {
      if (!needle) {
        return true;
      }
      return (
        field.keyPath.toLowerCase().includes(needle) ||
        field.label.toLowerCase().includes(needle) ||
        field.description.toLowerCase().includes(needle)
      );
    });
  }, [codexConfigSearch, dynamicCodexConfigFields]);
  const dynamicCodexConfigGroupSummaries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const field of filteredDynamicCodexConfigFields) {
      counts.set(field.group, (counts.get(field.group) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([group, count]) => ({ group, count }));
  }, [filteredDynamicCodexConfigFields]);
  const codexConfigPageCount = Math.max(1, Math.ceil(filteredDynamicCodexConfigFields.length / ALL_CODEX_CONFIG_PAGE_SIZE));
  const activeCodexConfigPage = Math.min(codexConfigPage, codexConfigPageCount - 1);
  const pagedDynamicCodexConfigFields = useMemo(() => {
    const start = activeCodexConfigPage * ALL_CODEX_CONFIG_PAGE_SIZE;
    return filteredDynamicCodexConfigFields.slice(start, start + ALL_CODEX_CONFIG_PAGE_SIZE);
  }, [activeCodexConfigPage, filteredDynamicCodexConfigFields]);
  const handleDynamicCodexConfigValueCommit = useCallback(
    (keyPath: string, value: JsonValue) => onCodexConfigValueChange(keyPath, value),
    [onCodexConfigValueChange]
  );
  const codexConfigVirtualizer = useVirtualizer({
    count: pagedDynamicCodexConfigFields.length,
    getScrollElement: () => codexConfigListRef.current,
    estimateSize: (index) => {
      const field = pagedDynamicCodexConfigFields[index];
      if (!field) return 120;
      return field.kind === "textarea" || field.kind === "json" ? 240 : 120;
    },
    overscan: 4,
    measureElement: (element) => element.getBoundingClientRect().height
  });
  const codexConfigVirtualItems = codexConfigVirtualizer.getVirtualItems();

  useEffect(() => {
    if (open) {
      let nextSection = windowsDesktop && WINDOWS_HIDDEN_SETTINGS.has(initialSection)
        ? (initialSection === "session" ? "assistant" : (isCodexPluginEnabled ? "codex" : "assistant"))
        : initialSection;
      if (nextSection === "codex" && !isCodexPluginEnabled) {
        nextSection = "assistant";
      }
      setSection(nextSection);
      setCodexConfigMode("quick");
      setCodexConfigSearch("");
      setCodexConfigPage(0);
      if (nextSection === "members" && currentUser?.role === "admin") {
        void onReloadMembers();
      }
    }
  }, [currentUser?.role, initialSection, isCodexPluginEnabled, onReloadMembers, open, windowsDesktop]);

  useEffect(() => {
    if (!isCodexPluginEnabled && section === "codex") {
      setSection("assistant");
    }
  }, [isCodexPluginEnabled, section]);

  useEffect(() => {
    if (codexConfigPage !== activeCodexConfigPage) {
      setCodexConfigPage(activeCodexConfigPage);
    }
  }, [activeCodexConfigPage, codexConfigPage]);

  useEffect(() => {
    if (codexConfigMode !== "all") return;
    setCodexConfigPage(0);
  }, [codexConfigMode, codexConfigSearch]);

  useEffect(() => {
    if (codexConfigMode !== "all") return;
    codexConfigListRef.current?.scrollTo({ top: 0 });
    codexConfigVirtualizer.scrollToOffset(0);
  }, [activeCodexConfigPage, codexConfigMode, codexConfigVirtualizer]);

  return (
    <Drawer
      data-testid="settings-drawer"
      anchor="left"
      open={open}
      onClose={onClose}
      transitionDuration={windowsDesktop ? 0 : undefined}
      ModalProps={{
        disableScrollLock: true,
        keepMounted: false,
        disablePortal
      }}
      PaperProps={{
        sx: {
          width: "100vw",
          height: "100vh",
          maxWidth: "100vw",
          maxHeight: "100vh",
          bgcolor: "background.default",
          borderRight: "1px solid",
          borderColor: "divider"
        }
      }}
    >
      <Box sx={{ height: "100%", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}>
        <Stack
          direction="row"
          spacing={1.25}
          alignItems="center"
          sx={{
            px: 2.5,
            py: 1.75,
            borderBottom: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            boxShadow: (theme) =>
              theme.palette.mode === "light"
                ? "0 0 2px 0 rgba(145 158 171 / 0.2), 0 8px 16px -8px rgba(145 158 171 / 0.16)"
                : "none"
          }}
        >
          <SettingsSuggestIcon color="primary" />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800 }}>
              {t("settings.title")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("settings.subtitle")}
            </Typography>
          </Box>
          <Button size="small" startIcon={<CloseIcon />} onClick={onClose} aria-label={t("settings.closeSettings")}>
            {t("settings.closeSettings")}
          </Button>
        </Stack>

        <Box
          sx={{
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "220px minmax(0, 1fr)" }
          }}
        >
          <Box
            sx={{
              borderRight: { md: "1px solid" },
              borderBottom: { xs: "1px solid", md: 0 },
              borderColor: "divider",
              bgcolor: "background.paper",
              overflow: "auto"
            }}
          >
            <List dense disablePadding sx={{ py: 1 }}>
              {visibleNavItems.map((item) => {
                const label = t(item.labelKey);
                return (
                <ListItemButton
                  key={item.id}
                  selected={section === item.id}
                  onClick={() => {
                    setSection(item.id);
                    if (item.id === "members") {
                      void onReloadMembers();
                    }
                  }}
                  aria-label={t("settings.openSection", { section: label })}
                  sx={{ mx: 1, borderRadius: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}>{item.icon}</ListItemIcon>
                  <ListItemText
                    primary={label}
                    primaryTypographyProps={{ variant: "body2", fontWeight: section === item.id ? 700 : 600 }}
                  />
                </ListItemButton>
                );
              })}
            </List>
          </Box>

          <Box sx={{ minWidth: 0, overflow: "auto", px: { xs: 1.5, sm: 2.5 }, py: 2, bgcolor: "background.default" }}>
            <SettingAssistantSetupBanner
              providers={providers}
              ready={settingAssistantReady}
              provider={settingAssistantProvider}
              model={settingAssistantEffectiveModel}
              t={t}
              onOpenAssistant={() => setSection("assistant")}
              onOpenRelay={() => setSection("relay")}
            />
            {section === "assistant" && (
              <SettingsSection icon={<AutoAwesomeIcon fontSize="small" />} title={t("settings.section.assistant")} subtitle={t("settings.assistant.modelDescription")}>
                <Stack spacing={1.25}>
                  <Alert severity={settingAssistantReady ? "success" : "warning"} variant="outlined">
                    {settingAssistantReady
                      ? t("settings.assistant.readyDescription", { provider: settingAssistantProvider?.name ?? "-", model: settingAssistantEffectiveModel || "-" })
                      : t("settings.assistant.chooseModelDescription")}
                  </Alert>
                  <SettingRow title={t("settings.assistant.modelTitle")} description={t("settings.assistant.modelDescription")}>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ minWidth: { xs: "100%", sm: 420 } }}>
                      <FormControl size="small" sx={{ minWidth: 220 }}>
                        <InputLabel>{t("settings.assistant.provider")}</InputLabel>
                        <Select
                          value={settingAssistantProviderId}
                          label={t("settings.assistant.provider")}
                          onChange={(event) => {
                            onSettingAssistantProviderChange(event.target.value);
                            onSettingAssistantModelChange("");
                          }}
                        >
                          <MenuItem value="">{t("settings.assistant.selectProvider")}</MenuItem>
                          {providers.map((provider) => (
                            <MenuItem key={provider.id} value={provider.id}>
                              {provider.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControl size="small" sx={{ minWidth: 180 }} disabled={!settingAssistantProvider}>
                        <InputLabel>{t("settings.assistant.model")}</InputLabel>
                        <Select
                          value={settingAssistantModel}
                          label={t("settings.assistant.model")}
                          onChange={(event) => onSettingAssistantModelChange(event.target.value)}
                        >
                          <MenuItem value="">{t("settings.assistant.defaultModel")}</MenuItem>
                          {settingAssistantModelOptions.map((option) => (
                            <MenuItem key={option.value} value={option.value}>
                              {option.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>
                  </SettingRow>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button size="small" variant="contained" startIcon={<TuneIcon />} onClick={() => setSection("assistant")}>
                      {t("settings.assistant.configureModel")}
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<MemoryIcon />} onClick={() => setSection("relay")}>
                      {t("settings.assistant.setupRelay")}
                    </Button>
                  </Stack>
                </Stack>
              </SettingsSection>
            )}
            {section === "codex" && isCodexPluginEnabled && (
              <SettingsSection icon={<StorageIcon fontSize="small" />} title={t("settings.section.codex")} subtitle={t("settings.codex.subtitle")}>
                {!isCodexPluginEnabled ? (
                  <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
                    <Alert severity="warning" variant="outlined">
                      {t("settings.codex.pluginDisabled")}
                    </Alert>
                  </Box>
                ) : null}
                {!canEditCodexConfig ? (
                  <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
                    <Alert severity="info" variant="outlined">
                      {t("settings.codex.memberReadOnly")}
                    </Alert>
                  </Box>
                ) : null}
                <SettingRow
                  title={t("settings.codex.userConfigSync")}
                  description={t("settings.codex.userConfigSyncDescription")}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    {codexConfigLoading || codexConfigSaving ? <CircularProgress size={18} /> : null}
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<RefreshIcon />}
                      onClick={onReloadCodexConfig}
                      disabled={codexConfigLoading || codexConfigSaving || !isCodexPluginEnabled}
                      aria-label={t("settings.codex.reloadConfig")}
                    >
                      {t("settings.codex.reloadConfig")}
                    </Button>
                  </Stack>
                </SettingRow>
                {codexConfigError ? (
                  <Box sx={{ px: 1.5, pb: 1.5 }}>
                    <Alert severity="error" variant="outlined">
                      {codexConfigError}
                    </Alert>
                  </Box>
                ) : null}
                {!codexConfig && !codexConfigLoading ? (
                  <Box sx={{ px: 1.5, pb: 1.5 }}>
                    <Alert severity="info" variant="outlined">
                      {t("settings.codex.engineReadyNotice")}
                    </Alert>
                  </Box>
                ) : null}
                <SettingRow
                  title={t("settings.codex.configCoverage")}
                  description={t("settings.codex.configCoverageDescription")}
                >
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      size="small"
                      variant={codexConfigMode === "quick" ? "contained" : "outlined"}
                      disabled={!isCodexPluginEnabled}
                      onClick={() => {
                        setCodexConfigMode("quick");
                        setCodexConfigPage(0);
                      }}
                    >
                      {t("settings.codex.quickSettings")}
                    </Button>
                    <Button
                      size="small"
                      variant={codexConfigMode === "all" ? "contained" : "outlined"}
                      disabled={!isCodexPluginEnabled}
                      onClick={() => {
                        setCodexConfigMode("all");
                        setCodexConfigPage(0);
                      }}
                    >
                      {t("settings.codex.allConfig")}
                    </Button>
                  </Stack>
                </SettingRow>
                {codexConfigMode === "quick" ? (
                  <>
                    {MULTI_AGENT_V2_QUICK_FIELDS.map((field) => {
                      const storedValue = getConfigValueAtPath(codexConfig?.rawConfig ?? {}, field.keyPath);
                      const value = (field.keyPath === "features.multi_agent_v2.enabled" || field.keyPath === "features.context_management.experimental_mode") && storedValue === undefined
                        ? true
                        : storedValue;
                      return (
                        <DynamicCodexConfigFieldRow
                          key={field.keyPath}
                          field={field}
                          value={value}
                          disabled={!codexConfig || codexConfigSaving || !canEditCodexConfig || !isCodexPluginEnabled}
                          t={t}
                          onCommitValue={handleDynamicCodexConfigValueCommit}
                        />
                      );
                    })}
                    {CODEX_CONFIG_FIELD_META.map((field) => {
                      const localizedField = localizeQuickCodexConfigField(field, t);
                      return (
                        <CodexConfigFieldRow
                          key={field.key}
                          fieldKey={field.key}
                          label={localizedField.label}
                          description={localizedField.description}
                          kind={field.kind}
                          options={localizedField.options}
                          readOnly={field.readOnly}
                          value={codexConfig?.[field.key] ?? ""}
                          disabled={!codexConfig || Boolean(field.readOnly) || codexConfigSaving || !canEditCodexConfig || !isCodexPluginEnabled}
                          unsetLabel={t("settings.codex.unset")}
                          onCommit={(next) => onCodexConfigFieldChange(field.key, next)}
                        />
                      );
                    })}
                  </>
                ) : (
                  <Box>
                    <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.default" }}>
                      <TextField
                        size="small"
                        fullWidth
                        disabled={!isCodexPluginEnabled}
                        label={t("settings.codex.searchAllConfig")}
                        value={codexConfigSearch}
                        onChange={(event) => setCodexConfigSearch(event.target.value)}
                        inputProps={{ "aria-label": t("settings.codex.searchAllConfig") }}
                      />
                      <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }} sx={{ mt: 0.75 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                          {t("settings.codex.schemaRuntimeSettings", { count: filteredDynamicCodexConfigFields.length })}
                        </Typography>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`${activeCodexConfigPage + 1} / ${codexConfigPageCount}`}
                          />
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={activeCodexConfigPage === 0}
                            onClick={() => setCodexConfigPage((current) => Math.max(0, current - 1))}
                          >
                            Prev
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={activeCodexConfigPage >= codexConfigPageCount - 1}
                            onClick={() => setCodexConfigPage((current) => Math.min(codexConfigPageCount - 1, current + 1))}
                          >
                            Next
                          </Button>
                        </Stack>
                      </Stack>
                      {dynamicCodexConfigGroupSummaries.length > 0 ? (
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                          {dynamicCodexConfigGroupSummaries.map((group) => (
                            <Chip
                              key={group.group}
                              size="small"
                              variant="outlined"
                              label={`${localizeCodexConfigSegment(group.group, t)} ${group.count}`}
                            />
                          ))}
                        </Stack>
                      ) : null}
                    </Box>
                    {pagedDynamicCodexConfigFields.length === 0 ? (
                      <Box sx={{ px: 1.5, py: 2 }}>
                        <Alert severity="info" variant="outlined">
                          No matching Codex config fields.
                        </Alert>
                      </Box>
                    ) : (
                      <Box
                        ref={codexConfigListRef}
                        sx={{
                          height: 560,
                          maxHeight: "60vh",
                          overflow: "auto",
                          position: "relative",
                          bgcolor: "background.paper"
                        }}
                      >
                        <Box sx={{ height: codexConfigVirtualizer.getTotalSize(), position: "relative" }}>
                          {codexConfigVirtualItems.map((virtualItem) => {
                            const field = pagedDynamicCodexConfigFields[virtualItem.index];
                            if (!field) return null;
                            return (
                              <Box
                                key={field.keyPath}
                                ref={codexConfigVirtualizer.measureElement}
                                data-index={virtualItem.index}
                                sx={{
                                  position: "absolute",
                                  top: 0,
                                  left: 0,
                                  width: "100%",
                                  transform: `translateY(${virtualItem.start}px)`
                                }}
                              >
                                <DynamicCodexConfigFieldRow
                                  field={field}
                                  value={getConfigValueAtPath(codexConfig?.rawConfig ?? {}, field.keyPath)}
                                  disabled={!codexConfig || codexConfigSaving || !canEditCodexConfig || !isCodexPluginEnabled}
                                  t={t}
                                  onCommitValue={handleDynamicCodexConfigValueCommit}
                                />
                              </Box>
                            );
                          })}
                        </Box>
                      </Box>
                    )}
                  </Box>
                )}
                <SettingRow title={t("settings.codex.configSource")} description={t("settings.codex.configSourceDescription")}>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label="config/read" color="primary" variant="outlined" />
                    <Chip size="small" label="Codex JSON schema" color="primary" variant="outlined" />
                  </Stack>
                </SettingRow>
                <FreeAutoCompactSettings
                  enabled={freeAutoCompactEnabled}
                  threshold={freeAutoCompactThreshold}
                  providerId={freeAutoCompactProviderId}
                  groupId={freeAutoCompactGroupId}
                  model={freeAutoCompactModel}
                  channels={freeCompactionChannels}
                  compactMode={compactMode}
                  jevCompressThreshold={jevCompressThreshold}
                  compactCapabilityWarning={compactCapabilityWarning}
                  onEnabledChange={onFreeAutoCompactEnabledChange}
                  onThresholdChange={onFreeAutoCompactThresholdChange}
                  onProviderChange={onFreeAutoCompactProviderChange}
                  onGroupChange={onFreeAutoCompactGroupChange}
                  onModelChange={onFreeAutoCompactModelChange}
                  onCompactModeChange={onCompactModeChange}
                  onJevCompressThresholdChange={onJevCompressThresholdChange}
                  t={t}
                />
              </SettingsSection>
            )}

            {section === "appearance" && (
              <SettingsSection icon={<ColorLensIcon fontSize="small" />} title={t("settings.section.appearance")} subtitle={t("settings.appearance.subtitle")}>
                <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
                  <Typography variant="h6" sx={{ fontSize: 20, fontWeight: 850 }}>
                    {t("settings.appearance.theme")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {t("settings.appearance.themeDescription")}
                  </Typography>
                  <ThemeModeCards themeMode={themeMode} onThemeModeChange={onThemeModeChange} t={t} />
                </Box>
                <SettingRow title={t("settings.appearance.activeSkin")} description={t("settings.appearance.activeSkinDescription")}>
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>{t("settings.appearance.skin")}</InputLabel>
                    <Select
                      value={themeMode}
                      label={t("settings.appearance.skin")}
                      inputProps={{ "aria-label": t("settings.appearance.skin") }}
                      onChange={(event) => onThemeModeChange(event.target.value as ThemeMode)}
                    >
                      <MenuItem value="system">{t("settings.appearance.system")}</MenuItem>
                      {allThemePlugins
                        .filter((plugin) => installedThemePluginIds.includes(plugin.id))
                        .map((plugin) => (
                          <MenuItem key={plugin.id} value={plugin.id}>
                            {plugin.name}
                          </MenuItem>
                        ))}
                    </Select>
                  </FormControl>
                </SettingRow>
                <ThemePluginManager
                  plugins={allThemePlugins}
                  activeThemeId={themeMode}
                  installedThemePluginIds={installedThemePluginIds}
                  onThemeModeChange={onThemeModeChange}
                  onInstallThemePlugin={onInstallThemePlugin}
                  onUninstallThemePlugin={onUninstallThemePlugin}
                  onEditCustomThemePlugin={setEditingThemePlugin}
                  t={t}
                  onRemoveCustomThemePlugin={(id) => {
                    onRemoveCustomThemePlugin(id);
                    setEditingThemePlugin((current) => (current?.id === id ? null : current));
                  }}
                />
                <SettingRow title={t("setupGuide.replay")} description={t("setupGuide.replayDescription")}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      onClose();
                      window.setTimeout(onReplaySetupGuide, 0);
                    }}
                    sx={{ textTransform: "none" }}
                  >
                    {t("setupGuide.replay")}
                  </Button>
                </SettingRow>
                <CustomThemePluginEditor
                  editingPlugin={editingThemePlugin}
                  onCancelEdit={() => setEditingThemePlugin(null)}
                  t={t}
                  onSave={(plugin) => {
                    onSaveCustomThemePlugin(plugin);
                    setEditingThemePlugin(null);
                  }}
                />
                <SettingRow title={t("settings.appearance.chatTypography")} description={t("settings.appearance.chatTypographyDescription")}>
                  <Stack spacing={1.25} sx={{ width: { xs: "100%", sm: 280 } }}>
                    <Box>
                      <Typography variant="caption">{t("settings.appearance.chatFontSize")} · {chatTypography.fontSize}px</Typography>
                      <Slider size="small" min={11} max={18} step={0.5} value={chatTypography.fontSize} onChange={(_, value) => onChatTypographyChange({ ...chatTypography, fontSize: Number(value) })} />
                    </Box>
                    <Box>
                      <Typography variant="caption">{t("settings.appearance.chatLineHeight")} · {chatTypography.lineHeight.toFixed(2)}</Typography>
                      <Slider size="small" min={1.25} max={2} step={0.05} value={chatTypography.lineHeight} onChange={(_, value) => onChatTypographyChange({ ...chatTypography, lineHeight: Number(value) })} />
                    </Box>
                    <Box>
                      <Typography variant="caption">{t("settings.appearance.chatMessageSpacing")} · {chatTypography.messageSpacing}px</Typography>
                      <Slider size="small" min={0} max={24} step={1} value={chatTypography.messageSpacing} onChange={(_, value) => onChatTypographyChange({ ...chatTypography, messageSpacing: Number(value) })} />
                    </Box>
                    <Box>
                      <Typography variant="caption">{t("settings.appearance.goalMaxLines")} · {chatTypography.goalMaxLines}</Typography>
                      <Slider size="small" min={1} max={12} step={1} value={chatTypography.goalMaxLines} onChange={(_, value) => onChatTypographyChange({ ...chatTypography, goalMaxLines: Number(value) })} />
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography variant="caption">{t("settings.appearance.runningHighlightColor")}</Typography>
                      <Box component="input" type="color" aria-label={t("settings.appearance.runningHighlightColor")} value={chatTypography.runningHighlightColor} onChange={(event) => onChatTypographyChange({ ...chatTypography, runningHighlightColor: event.target.value })} sx={{ width: 42, height: 28, p: 0, border: 0, bgcolor: "transparent", cursor: "pointer" }} />
                    </Stack>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => onChatTypographyChange({ ...DEFAULT_CHAT_TYPOGRAPHY })}
                      disabled={chatTypography.fontSize === DEFAULT_CHAT_TYPOGRAPHY.fontSize && chatTypography.lineHeight === DEFAULT_CHAT_TYPOGRAPHY.lineHeight && chatTypography.messageSpacing === DEFAULT_CHAT_TYPOGRAPHY.messageSpacing && chatTypography.goalMaxLines === DEFAULT_CHAT_TYPOGRAPHY.goalMaxLines && chatTypography.runningHighlightColor === DEFAULT_CHAT_TYPOGRAPHY.runningHighlightColor}
                      sx={{ alignSelf: "flex-start" }}
                    >
                      {t("settings.appearance.chatTypographyReset")}
                    </Button>
                  </Stack>
                </SettingRow>
                <SettingRow title={t("settings.appearance.skinSafety")} description={t("settings.appearance.skinSafetyDescription")}>
                  <Chip size="small" label={t("settings.appearance.separated")} color="success" variant="outlined" />
                </SettingRow>
              </SettingsSection>
            )}

            {section === "layout" && (
              <SettingsSection icon={<DashboardCustomizeIcon fontSize="small" />} title={t("settings.section.layout")} subtitle={t("settings.layout.subtitle")}>
                <SettingRow title={t("settings.layout.historyPanel")} description={t("settings.layout.historyPanelDescription")}>
                  <Switch
                    checked={leftPanelVisible}
                    onChange={(event) => onLeftPanelVisibleChange(event.target.checked)}
                    inputProps={{ "aria-label": t("settings.layout.historyPanel") }}
                  />
                </SettingRow>
                <SettingRow title={t("settings.layout.assistantUsageDetails")} description={t("settings.layout.assistantUsageDetailsDescription")}>
                  <Switch
                    checked={showAssistantUsageDetails}
                    onChange={(event) => onShowAssistantUsageDetailsChange(event.target.checked)}
                    inputProps={{ "aria-label": t("settings.layout.assistantUsageDetails") }}
                  />
                </SettingRow>
                <SettingRow title={t("settings.layout.waterfallDisplayMode")} description={t("settings.layout.waterfallDisplayModeDescription")}>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={waterfallDisplayMode}
                    aria-label={t("settings.layout.waterfallDisplayMode")}
                    onChange={(_, value: WaterfallDisplayMode | null) => {
                      if (value) onWaterfallDisplayModeChange(value);
                    }}
                    sx={{ flexWrap: "wrap", justifyContent: "flex-end" }}
                  >
                    <ToggleButton value="full">{t("settings.layout.waterfallModeFull")}</ToggleButton>
                    <ToggleButton value="recent-tools">{t("settings.layout.waterfallModeRecentTools")}</ToggleButton>
                    <ToggleButton value="post-compaction">{t("settings.layout.waterfallModePostCompaction")}</ToggleButton>
                  </ToggleButtonGroup>
                </SettingRow>
                <SettingRow title={t("settings.layout.rightWorkspace")} description={t("settings.layout.rightWorkspaceDescription")}>
                  <Chip size="small" label={t("settings.layout.toolbarControlled")} color="primary" variant="outlined" />
                </SettingRow>
                <SettingRow title={t("settings.layout.workspaceCwd")} description={t("settings.layout.workspaceCwdDescription")}>
                  <TextField
                    size="small"
                    value={cwd}
                    onChange={(event) => onCwdChange(event.target.value)}
                    disabled={Boolean(currentUser) && currentUser?.role !== "admin"}
                    helperText={currentUser && currentUser.role !== "admin" ? currentUser.workspaceRoot : undefined}
                    sx={{ minWidth: 240 }}
                  />
                </SettingRow>
              </SettingsSection>
            )}

            {section === "notifications" && (
              <SettingsSection
                icon={<NotificationsActiveIcon fontSize="small" />}
                title={t("settings.section.notifications")}
                subtitle={t("settings.notifications.subtitle")}
              >
                <SettingRow title={t("settings.notifications.turnCompleted")} description={t("settings.notifications.turnCompletedDescription")}>
                  <Switch
                    checked={notificationPreferences.turnCompleted}
                    onChange={(event) => onNotificationPreferencesChange({ ...notificationPreferences, turnCompleted: event.target.checked })}
                    inputProps={{ "aria-label": t("settings.notifications.turnCompleted") }}
                  />
                </SettingRow>
                <SettingRow title={t("settings.notifications.planStepsCompleted")} description={t("settings.notifications.planStepsCompletedDescription")}>
                  <Switch
                    checked={notificationPreferences.planStepsCompleted}
                    onChange={(event) => onNotificationPreferencesChange({ ...notificationPreferences, planStepsCompleted: event.target.checked })}
                    inputProps={{ "aria-label": t("settings.notifications.planStepsCompleted") }}
                  />
                </SettingRow>
                <SettingRow title={t("settings.notifications.remoteErrors")} description={t("settings.notifications.remoteErrorsDescription")}>
                  <Switch
                    checked={notificationPreferences.remoteErrors}
                    onChange={(event) => onNotificationPreferencesChange({ ...notificationPreferences, remoteErrors: event.target.checked })}
                    inputProps={{ "aria-label": t("settings.notifications.remoteErrors") }}
                  />
                </SettingRow>
                <SettingRow title={t("settings.notifications.capacityTurnRetry")} description={t("settings.notifications.capacityTurnRetryDescription")}>
                  <Switch
                    checked={capacityTurnRetryEnabled}
                    onChange={(event) => onCapacityTurnRetryEnabledChange(event.target.checked)}
                    inputProps={{ "aria-label": t("settings.notifications.capacityTurnRetry") }}
                  />
                </SettingRow>
              </SettingsSection>
            )}

            {section === "workspace" && (
              <SettingsSection icon={<StorageIcon fontSize="small" />} title={t("settings.section.workspace")} subtitle={t("settings.workspace.subtitle")}>
                <WorkspaceFilesSettingsPanel
                  cwd={cwd}
                  fileDirectories={fileDirectories}
                  openFile={openFile}
                  filesPanelLayout={filesPanelLayout}
                  t={t}
                  onFilesPanelLayoutChange={onFilesPanelLayoutChange}
                  onReadDirectory={onReadDirectory}
                  onReadFile={onReadFile}
                  onChangeOpenFileContent={onChangeOpenFileContent}
                  onSaveOpenFile={onSaveOpenFile}
                />
              </SettingsSection>
            )}

            {section === "session" && (
              <SettingsSection icon={<TuneIcon fontSize="small" />} title={t("settings.section.session")} subtitle={t("settings.session.subtitle")}>
                <SettingRow title={t("settings.session.selectedModel")} description={t("settings.session.selectedModelDescription")}>
                  <Chip size="small" label={selectedModel || t("settings.session.notSelected")} />
                </SettingRow>
                <SettingRow title={t("settings.session.reasoningStrength")} description={selectedReasoning?.description || t("settings.session.reasoningStrengthDescription")}>
                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>{t("settings.session.effort")}</InputLabel>
                    <Select
                      value={reasoningEffort}
                      label={t("settings.session.effort")}
                      inputProps={{ "aria-label": t("settings.session.reasoningStrength") }}
                      onChange={(event) => onReasoningEffortChange(event.target.value)}
                    >
                      {reasoningOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </SettingRow>
                <SettingRow title={t("settings.session.permissionPreset")} description={t("settings.session.permissionPresetDescription")}>
                  <FormControl size="small" sx={{ minWidth: 220 }}>
                    <InputLabel>{t("settings.session.permissions")}</InputLabel>
                    <Select value={permission} label={t("settings.session.permissions")} onChange={(event) => onPermissionChange(event.target.value as PermissionPresetId)}>
                      {permissionChoices.map((preset) => (
                        <MenuItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </SettingRow>
                {currentUser ? (
                  <SettingRow title={t("settings.members.yourCaps")} description={t("settings.members.yourCapsDescription")}>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={currentUser.maxPermission} color="primary" variant="outlined" />
                      <Chip size="small" label={currentUser.allowWrite ? "write" : "no-write"} variant="outlined" />
                      <Chip size="small" label={currentUser.allowDangerBypass ? "danger-ok" : "no-danger"} color={currentUser.allowDangerBypass ? "warning" : "default"} variant="outlined" />
                      <Chip size="small" label={`${t("settings.members.balance")}: ${Number(currentUser.balance).toFixed(2)}`} color="secondary" variant="outlined" />
                    </Stack>
                  </SettingRow>
                ) : null}
              </SettingsSection>
            )}

            {section === "relay" && (
              <RelaySettingsPanel
                providers={providers}
                activeProviderId={activeProviderId}
                activeProvider={activeProvider}
                initialProviderId={initialRelayProviderId}
                initialGroupId={initialRelayGroupId}
                selectedModel={selectedModel}
                canManage={canManageRelay}
                sessionToken={sessionToken}
                t={t}
                onSaveProvider={onSaveProvider}
                onShareProvider={onShareProvider}
                onImportSharedRelay={onImportSharedRelay}
                onSyncFreeOllama={onSyncFreeOllama}
                onRequestOmniRouteFreeSync={onRequestOmniRouteFreeSync}
                freeOllamaEnabled={freeOllamaEnabled}
                onFreeOllamaEnabledChange={onFreeOllamaEnabledChange}
                onActivateProvider={onActivateProvider}
                windowsDesktop={windowsDesktop}
                isCodexEnabled={isCodexPluginEnabled}
                onInjectClaudeDesktop={onInjectClaudeDesktop}
                onInjectCursorDesktop={onInjectCursorDesktop}
                onTestProviderWithCodex={onTestProviderWithCodex}
                onImportCapabilityCatalog={onImportCapabilityCatalog}
                onExportRelayBackup={onExportRelayBackup}
                onImportRelayBackup={onImportRelayBackup}
                onDeleteProvider={onDeleteProvider}
                onRestoreProvider={onRestoreProvider}
              />
            )}

            {section === "launch" && (
              <SettingsSection icon={<RocketLaunchIcon fontSize="small" />} title={t("settings.section.launch")} subtitle={t("settings.launch.subtitle")}>
                {onCliBackendToggle && cliBackendEnabled ? (
                  <CliBackendSettingsPanel
                    enabled={cliBackendEnabled}
                    disabled={currentUser != null && currentUser.role !== "admin"}
                    error={cliBackendError ?? null}
                    t={t}
                    onToggle={(backend, enabled) => void onCliBackendToggle(backend, enabled)}
                  />
                ) : null}
              </SettingsSection>
            )}

            {section === "skills" && (
              <SettingsSection icon={<PsychologyIcon fontSize="small" />} title={t("settings.section.skills")} subtitle={t("settings.skills.subtitle")}>
                <SkillsSettingsPanel
                  tooling={tooling}
                  extraRoots={skillExtraRoots}
                  previews={skillPreviews}
                  t={t}
                  onToggleSkill={onToggleSkill}
                  onSaveExtraRoots={onSaveSkillExtraRoots}
                  onReadPreview={onReadSkillPreview}
                  onCreateSkill={onCreateSkill}
                />
              </SettingsSection>
            )}

            {section === "plugins" && (
              <SettingsSection icon={<ExtensionIcon fontSize="small" />} title={t("settings.section.plugins")} subtitle={t("settings.plugins.subtitle")}>
                <CodexPluginSettingsPanel
                  key={`${open ? "open" : "closed"}:${initialPluginTab}`}
                  activeThreadId={activeThreadId}
                  tooling={tooling}
                  toolingLoading={toolingLoading}
                  t={t}
                  initialTab={initialPluginTab}
                  pluginDetails={pluginDetails}
                  pluginSkillPreviews={pluginSkillPreviews}
                  pluginAuthNotices={pluginAuthNotices}
                  installingPluginIds={installingPluginIds}
                  mcpResourceContents={mcpResourceContents}
                  mcpOauthUrls={mcpOauthUrls}
                  onReloadTooling={onReloadTooling}
                  onReloadMcp={onReloadMcp}
                  onStartMcpOauth={onStartMcpOauth}
                  onReadMcpResource={onReadMcpResource}
                  onCallMcpTool={onCallMcpTool}
                  onReadPluginDetail={onReadPluginDetail}
                  onReadPluginSkill={onReadPluginSkill}
                  onInsertPluginMention={onInsertPluginMention}
                  onInstallPlugin={onInstallPlugin}
                  onUninstallPlugin={onUninstallPlugin}
                />
              </SettingsSection>
            )}

            {section === "appplugins" && (
              <SettingsSection icon={<WidgetsIcon fontSize="small" />} title={t("settings.section.appplugins")} subtitle={t("settings.appplugins.subtitle")}>
                <PluginManagerPanel t={t} />
              </SettingsSection>
            )}

            {section === "pet" && (
              <SettingsSection icon={<PetsIcon fontSize="small" />} title={t("settings.section.pet")} subtitle={t("settings.pet.subtitle")}>
                {windowsDesktop ? (
                  <Alert severity="info" sx={{ m: 2 }} data-testid="windows-pet-coming-soon">
                    {t("settings.pet.windowsComingSoon")}
                  </Alert>
                ) : (
                  <>
                    <SettingRow title={t("settings.pet.threeDock")} description={t("settings.pet.threeDockDescription")}>
                      <FormControlLabel
                        control={<Switch checked={petDockEnabled} onChange={(event) => onPetDockEnabledChange(event.target.checked)} />}
                        label={t("settings.pet.enabled")}
                      />
                    </SettingRow>
                    <PetDock enabled={petDockEnabled} />
                  </>
                )}
              </SettingsSection>
            )}

            {section === "members" && currentUser?.role === "admin" && (
              <MembersPermissionsPanel
                members={members}
                providers={providers}
                loading={membersLoading}
                error={membersError}
                t={t}
                onReload={onReloadMembers}
                onCreate={onCreateMember}
                onUpdate={onUpdateMember}
                onDelete={onDeleteMember}
                onAllocateBalance={onAllocateMemberBalance}
              />
            )}

            {section === "usage" && sessionToken ? (
              <UsageBillingPanel
                token={sessionToken}
                currentUser={currentUser}
                members={members}
                t={t}
                onBalanceChanged={() => void onReloadMembers()}
              />
            ) : null}

            {section === "gateway" && sessionToken ? (
              <GatewayStatsPanel
                token={sessionToken}
                currentUser={currentUser}
                members={members}
                t={t}
              />
            ) : null}

            {section === "security" && sessionToken ? (
              <SecuritySettingsPanel token={sessionToken} isAdmin={currentUser?.role === "admin"} t={t} />
            ) : null}

            {section === "privacy" && (
              <SettingsSection icon={<SecurityIcon fontSize="small" />} title={t("settings.section.privacy")} subtitle={t("settings.privacy.subtitle")}>
                <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Stack spacing={1.25}>
                    <ProfileSettingsPanel
                      providerCount={providers.length}
                      onExportProfile={onExportProfile}
                      onImportProfile={onImportProfile}
                      onExportRelayConfig={onExportRelayConfig}
                      onImportRelayConfig={onImportRelayConfig}
                      t={t}
                    />
                    <AuditSettingsPanel events={auditEvents} onReload={onReloadAuditEvents} t={t} />
                  </Stack>
                </Box>
                <SettingRow title={t("settings.privacy.providerKeyHandling")} description={t("settings.privacy.providerKeyHandlingDescription")}>
                  <Chip size="small" label={t("settings.privacy.masked")} color="success" variant="outlined" />
                </SettingRow>
                <SettingRow title={t("settings.privacy.dangerousModeAudit")} description={t("settings.privacy.dangerousModeAuditDescription")}>
                  <Chip size="small" label={t("settings.pet.enabled")} color="warning" variant="outlined" />
                </SettingRow>
              </SettingsSection>
            )}

            {section === "about" && sessionToken ? (
              <LegalDocumentsSettingsPanel token={sessionToken} t={t} />
            ) : null}
            {tour ? (
              <Box sx={{ mt: 2, px: { xs: 1.5, sm: 2.5 } }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    onClose();
                    window.setTimeout(() => void tour.replayTour(), 0);
                  }}
                  sx={{ textTransform: "none" }}
                >
                  {t("onboarding.replayTour")}
                </Button>
              </Box>
            ) : null}
          </Box>
        </Box>
      </Box>
    </Drawer>
  );
}

function LegalDocumentsSettingsPanel({ token, t }: { token: string; t: TranslateFn }) {
  const [bundles, setBundles] = useState<{ cn: LegalPolicyBundle; en: LegalPolicyBundle } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDocument, setOpenDocument] = useState<{ title: string; content: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([fetchLegalPolicy(token, "cn"), fetchLegalPolicy(token, "en")])
      .then(([cn, en]) => {
        if (!cancelled) setBundles({ cn, en });
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const groups = [
    { id: "thirdParty", title: t("settings.about.thirdParty"), detail: t("settings.about.referenceProjects"), files: [["cn", "THIRD_PARTY_LICENSES.md"], ["en", "THIRD_PARTY_LICENSES_EN.md"]] },
    { id: "license", title: t("settings.about.license"), detail: t("settings.about.licenseThreshold"), files: [["en", "LICENSE"]] },
    { id: "privacy", title: t("settings.about.privacy"), files: [["cn", "PRIVACY.md"], ["en", "PRIVACY_EN.md"]] },
    { id: "terms", title: t("settings.about.terms"), files: [["cn", "TERMS.md"], ["en", "TERMS_EN.md"]] },
    { id: "legal", title: t("settings.about.legal"), files: [["cn", "LEGAL.md"], ["en", "LEGAL_EN.md"]] }
  ] as const;

  function showDocument(id: string, language: "cn" | "en", title: string) {
    const document = bundles?.[language].documents.find((entry) => entry.id === id);
    if (document) setOpenDocument({ title: `${title} · ${document.file}`, content: document.content });
  }

  return (
    <SettingsSection icon={<InfoOutlinedIcon fontSize="small" />} title={t("settings.section.about")} subtitle={t("settings.about.subtitle")}>
      <Box sx={{ p: { xs: 1.25, sm: 2 } }}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          <Button
            href={OFFICIAL_WEBSITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openOfficialWebsite}
            endIcon={<OpenInNewIcon />}
            variant="outlined"
            sx={{ textTransform: "none" }}
          >
            官方网站 · codex-ultra.top
          </Button>
          <Button
            href={OFFICIAL_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openOfficialGithub}
            startIcon={<GitHubIcon />}
            endIcon={<OpenInNewIcon />}
            variant="outlined"
            sx={{ textTransform: "none" }}
          >
            {t("settings.about.github")}
           </Button>
         </Stack>
         {error ? <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert> : null}
        {loading ? <LinearProgress sx={{ mb: 1.5 }} /> : null}
        <Alert severity="info" sx={{ mb: 1.5 }}>{t("settings.about.applicableLaw")}</Alert>
        <ErrorCodeReference t={t} />
        <Stack data-testid="about-legal-documents" divider={<Divider flexItem />} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
          {groups.map((group, index) => (
            <Box key={group.id} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(260px, 0.8fr) minmax(0, 1.2fr)" }, gap: 1, px: 1.5, py: 1.25, bgcolor: index % 2 ? "action.hover" : "background.paper" }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{index + 1}. {group.title}</Typography>
                {"detail" in group && group.detail ? <Typography variant="caption" color="text.secondary">{group.detail}</Typography> : null}
              </Box>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                {group.files.map(([language, file]) => (
                  <Button
                    key={file}
                    size="small"
                    variant="outlined"
                    disabled={!bundles}
                    onClick={() => showDocument(group.id, language, group.title)}
                    sx={{ justifyContent: "flex-start", textTransform: "none" }}
                  >
                    {language === "cn" ? "中文" : "English"} · {file}
                  </Button>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>
      <Dialog open={Boolean(openDocument)} onClose={() => setOpenDocument(null)} fullWidth maxWidth="lg" data-testid="about-legal-document-dialog">
        <DialogTitle sx={{ pr: 6 }}>{openDocument?.title}</DialogTitle>
        <IconButton aria-label={t("settings.close")} onClick={() => setOpenDocument(null)} sx={{ position: "absolute", right: 10, top: 10 }}><CloseIcon /></IconButton>
        <DialogContent dividers sx={{ maxHeight: "72vh" }}>
          {openDocument ? <MarkdownMessage text={openDocument.content} /> : null}
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

const ERROR_CODE_REFERENCE = [
  ["CUX-AUTH-001", "auth", "session", "reauth"],
  ["CUX-AUTH-002", "auth", "forbidden", "admin"],
  ["CUX-NET-001", "network", "timeout", "networkAction"],
  ["CUX-NET-002", "network", "unreachable", "networkAction"],
  ["CUX-PROXY-001", "proxy", "unauthorized", "proxyAction"],
  ["CUX-PROXY-002", "proxy", "gateway", "proxyAction"],
  ["CUX-SERVER-001", "server", "failure", "serverAction"],
  ["CUX-WORKSPACE-001", "workspace", "rootsFailure", "workspaceAction"],
  ["CUX-WORKSPACE-002", "workspace", "rejected", "workspaceAction"],
  ["CUX-PROJECT-API-001", "project", "projectApi", "projectAction"],
  ["CUX-PROJECT-START-001", "project", "projectStart", "projectAction"],
  ["CUX-PROJECT-PAUSE-001", "project", "projectPause", "projectAction"],
  ["CUX-PROJECT-DISPATCH-001", "project", "projectDispatch", "projectAction"],
  ["CUX-PROJECT-DISPATCH-002", "project", "projectNoAgents", "projectAction"],
  ["CUX-PROJECT-THREAD-001", "project", "projectThread", "projectAction"],
  ["CUX-PROJECT-DISCUSSION-001", "project", "projectDiscussionRunning", "projectWaitAction"],
  ["CUX-PROJECT-DISCUSSION-002", "project", "projectDiscussionRoutes", "projectRouteAction"],
  ["CUX-PROJECT-DISCUSSION-003", "project", "projectDiscussionTimeout", "projectNetworkAction"],
  ["CUX-PROJECT-MODEL-001", "project", "projectForbiddenModel", "projectModelAction"]
] as const;

function ErrorCodeReference({ t }: { t: TranslateFn }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCodes = ERROR_CODE_REFERENCE.filter(([code, category, meaning, action]) => {
    if (!normalizedQuery) return true;
    return [code, t(`settings.errorCode.${category}`), t(`settings.errorCode.${meaning}`), t(`settings.errorCode.${action}`)]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  return (
    <Box data-testid="about-error-codes" sx={{ mb: 1.5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t("settings.about.errorCodesTitle")}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t("settings.about.errorCodesDescription")}</Typography>
      <TextField
        size="small"
        fullWidth
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("settings.about.errorCodesSearch")}
        inputProps={{ "aria-label": t("settings.about.errorCodesSearch") }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        sx={{ mb: 1 }}
      />
      <Stack divider={<Divider flexItem />} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
        {visibleCodes.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>{t("settings.about.errorCodesNoResults")}</Typography>
        ) : visibleCodes.map(([code, category, meaning, action], index) => (
          <Box key={code} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(150px, 0.35fr) minmax(0, 1fr)" }, gap: 1, px: 1.5, py: 1.15, bgcolor: index % 2 ? "action.hover" : "background.paper" }}>
            <Box>
              <Typography component="code" variant="body2" sx={{ fontWeight: 800 }}>{code}</Typography>
              <Typography variant="caption" display="block" color="text.secondary">{t(`settings.errorCode.${category}`)}</Typography>
            </Box>
            <Box>
              <Typography variant="body2">{t(`settings.errorCode.${meaning}`)}</Typography>
              <Typography variant="caption" color="text.secondary">{t("settings.about.errorCodesAction")}: {t(`settings.errorCode.${action}`)}</Typography>
            </Box>
          </Box>
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>{t("settings.about.errorCodesIssueHint")}</Typography>
    </Box>
  );
}

type RelayTemplateId =
  | "openai"
  | "custom"
  | "linuxdo"
  | "deepseek"
  | "deepkey"
  | "gemini"
  | "anthropic"
  | "moonshot"
  | "zhipu"
  | "minimax"
  | "mistral"
  | "nvidia"
  | "groq"
  | "openrouter"
  | "siliconflow"
  | "xai"
  | "cohere"
  | "together"
  | "fireworks"
  | "cerebras"
  | "github-models"
  | "huggingface"
  | "modelscope"
  | "ppio"
  | "aihubmix"
  | "dmxapi"
  | "302ai"
  | "baichuan"
  | "stepfun"
  | "dashscope"
  | "perplexity"
  | "yi"
  | "infini"
  | "ollama"
  | "lmstudio"
  | "agy-launch";

const IMAGE_PROTOCOL_OPTIONS: Array<{
  id: ImageGenerationProtocol;
  label: string;
  description: string;
  generation: boolean;
}> = [
  { id: "openaiImages", label: "OpenAI images/generations", description: "/v1/images/generations", generation: true },
  { id: "openaiImageEdits", label: "OpenAI images/edits", description: "/v1/images/edits", generation: false },
  { id: "geminiChatCompletions", label: "Gemini chat image", description: "/v1/chat/completions", generation: true },
  { id: "geminiGenerateContent", label: "Gemini generateContent", description: "/v1beta/models/{model}:generateContent", generation: true },
  { id: "deepkeyAsyncVideos", label: "DeepKey async image", description: "POST /v1/videos + GET /v1/videos/{task_id}", generation: true }
];

const DEEPKEY_IMAGE_MODELS = [
  "gpt-image-2-1k",
  "gpt-image-2-2k",
  "gpt-image-2-4k",
  "gpt-image-2-async",
  "gpt-image-2-2K-async",
  "gpt-image-2-4K-async",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "nano_banana_2",
  "nano_banana_2-2K",
  "nano_banana_2-4K",
  "nano_banana_pro-1K",
  "nano_banana_pro-2K",
  "nano_banana_pro-4K"
];

const RELAY_PROVIDER_TEMPLATES: Array<{
  id: RelayTemplateId;
  label: string;
  icon: ReactNode;
  kind: ProviderConfig["kind"];
  apiFormat: ProviderConfig["kind"];
  baseUrl: string;
  nativeModels: string;
  catalogUrl?: string;
  image?: ProviderConfig["image"];
}> = [
  {
    id: "openai",
    label: "OpenAI",
    icon: <TokenIcon fontSize="small" />,
    kind: "responsesRelay",
    apiFormat: "responsesRelay",
    baseUrl: "https://api.openai.com/v1",
    nativeModels: "gpt-5.6-sol,gpt-5.5",
    image: { generations: false, edits: false, defaultModel: "gpt-image-2", protocols: ["openaiImages", "openaiImageEdits"], defaultProtocol: "openaiImages" }
  },
  {
    id: "custom",
    label: "Custom",
    icon: <AddIcon fontSize="small" />,
    kind: "responsesRelay",
    apiFormat: "responsesRelay",
    baseUrl: "",
    nativeModels: ""
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    icon: <SearchIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    nativeModels: "deepseek-chat,deepseek-reasoner",
  },
  {
    id: "deepkey",
    label: "DeepKey",
    icon: <HubIcon fontSize="small" />,
    kind: "responsesRelay",
    apiFormat: "responsesRelay",
    baseUrl: "https://deepkey.top/v1",
    catalogUrl: "https://deepkey.top/api/pricing",
    nativeModels: ["gpt-5.6-sol", "gpt-5.5", ...DEEPKEY_IMAGE_MODELS].join(","),
    image: {
      generations: false,
      edits: false,
      defaultModel: "gpt-image-2-1k",
      protocols: ["openaiImages", "openaiImageEdits", "geminiChatCompletions", "geminiGenerateContent", "deepkeyAsyncVideos"],
      defaultProtocol: "openaiImages"
    }
  },
  {
    id: "linuxdo",
    label: "Linux DO",
    icon: <HubIcon fontSize="small" />,
    kind: "responsesRelay",
    apiFormat: "responsesRelay",
    baseUrl: "https://hub.linux.do/v1",
    nativeModels: ""
  },
  {
    id: "gemini",
    label: "Gemini",
    icon: <AutoAwesomeIcon fontSize="small" />,
    kind: "responsesRelay",
    apiFormat: "responsesRelay",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    nativeModels: "gemini-2.5-pro,gemini-2.5-flash",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    icon: <ViewInArIcon fontSize="small" />,
    kind: "responsesRelay",
    apiFormat: "responsesRelay",
    baseUrl: "https://api.anthropic.com/v1",
    nativeModels: "claude-opus-4-6,claude-sonnet-4-5",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    icon: <DarkModeIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    nativeModels: "kimi-k2,kimi-latest",
  },
  {
    id: "zhipu",
    label: "Zhipu",
    icon: <PsychologyIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    nativeModels: "glm-4.5,glm-4.5-air,glm-4-plus",
  },
  {
    id: "minimax",
    label: "MiniMax",
    icon: <WavesIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.minimax.chat/v1",
    nativeModels: "minimax-m1,abab6.5s-chat",
  },
  {
    id: "mistral",
    label: "Mistral",
    icon: <AutoAwesomeIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    nativeModels: "mistral-large-latest,codestral-latest,ministral-8b-latest",
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    icon: <MemoryIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    nativeModels: "meta/llama-3.1-405b-instruct,nvidia/llama-3.1-nemotron-70b-instruct",
  },
  {
    id: "groq",
    label: "Groq",
    icon: <RocketLaunchIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    nativeModels: "llama-3.3-70b-versatile,moonshotai/kimi-k2-instruct",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    icon: <LayersIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    nativeModels: "openai/gpt-5,anthropic/claude-sonnet-4.5,google/gemini-2.5-pro",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    icon: <HubIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    nativeModels: "deepseek-ai/DeepSeek-V3.2,Qwen/Qwen3-Coder-480B-A35B-Instruct",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    icon: <PsychologyIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.x.ai/v1",
    nativeModels: "grok-4,grok-code-fast-1",
  },
  {
    id: "cohere",
    label: "Cohere",
    icon: <TokenIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.cohere.com/compatibility/v1",
    nativeModels: "command-a-03-2025,command-r-plus-08-2024",
  },
  {
    id: "together",
    label: "Together",
    icon: <HubIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.together.xyz/v1",
    nativeModels: "meta-llama/Llama-3.3-70B-Instruct-Turbo,Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8",
  },
  {
    id: "fireworks",
    label: "Fireworks",
    icon: <RocketLaunchIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    nativeModels: "accounts/fireworks/models/llama-v3p1-405b-instruct,accounts/fireworks/models/qwen3-coder-480b-a35b-instruct",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    icon: <MemoryIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    nativeModels: "llama3.1-8b,llama-4-scout-17b-16e-instruct",
  },
  {
    id: "github-models",
    label: "GitHub Models",
    icon: <ExtensionIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://models.github.ai/inference/v1",
    nativeModels: "openai/gpt-4.1,meta/llama-4-scout-17b-16e-instruct",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    icon: <StorageIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://router.huggingface.co/v1",
    nativeModels: "Qwen/Qwen3-Coder-480B-A35B-Instruct,meta-llama/Llama-3.3-70B-Instruct",
  },
  {
    id: "modelscope",
    label: "ModelScope",
    icon: <StorageIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    nativeModels: "Qwen/Qwen3-Coder-480B-A35B-Instruct,deepseek-ai/DeepSeek-V3.2",
  },
  {
    id: "ppio",
    label: "PPIO",
    icon: <MemoryIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.ppinfra.com/v3/openai/v1",
    nativeModels: "deepseek/deepseek-v3.1,qwen/qwen3-coder",
  },
  {
    id: "aihubmix",
    label: "AiHubMix",
    icon: <HubIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://aihubmix.com/v1",
    nativeModels: "gpt-4o,claude-sonnet-4-5,gemini-2.5-pro",
  },
  {
    id: "dmxapi",
    label: "DMXAPI",
    icon: <HubIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://www.dmxapi.cn/v1",
    nativeModels: "gpt-4o,claude-sonnet-4-5,gemini-2.5-pro",
  },
  {
    id: "302ai",
    label: "302.AI",
    icon: <HubIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.302.ai/v1",
    nativeModels: "gpt-4o,claude-sonnet-4-5,gemini-2.5-pro",
  },
  {
    id: "baichuan",
    label: "Baichuan",
    icon: <AutoAwesomeIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.baichuan-ai.com/v1",
    nativeModels: "Baichuan4-Turbo,Baichuan4-Air",
  },
  {
    id: "stepfun",
    label: "StepFun",
    icon: <KeyboardArrowRightIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.stepfun.com/v1",
    nativeModels: "step-2-mini,step-2-16k,step-1-8k",
  },
  {
    id: "dashscope",
    label: "DashScope",
    icon: <AutoAwesomeIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    nativeModels: "qwen3-coder-plus,qwen-plus,qwen-max",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    icon: <SearchIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.perplexity.ai/v1",
    nativeModels: "sonar-pro,sonar-reasoning-pro",
  },
  {
    id: "yi",
    label: "LingYiWanWu",
    icon: <PsychologyIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://api.lingyiwanwu.com/v1",
    nativeModels: "yi-large,yi-lightning",
  },
  {
    id: "infini",
    label: "Infini",
    icon: <HubIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "https://cloud.infini-ai.com/maas/v1",
    nativeModels: "deepseek-v3.1,qwen3-coder",
  },
  {
    id: "ollama",
    label: "Ollama",
    icon: <ComputerIcon fontSize="small" />,
    kind: "ollama",
    apiFormat: "ollama",
    baseUrl: "http://localhost:11434/v1",
    nativeModels: "llama3.3,qwen3-coder",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    icon: <ComputerIcon fontSize="small" />,
    kind: "lmstudio",
    apiFormat: "lmstudio",
    baseUrl: "http://localhost:1234/v1",
    nativeModels: "local-model",
  },
  {
    id: "agy-launch",
    label: "Antigravity (agy-launch)",
    icon: <AutoAwesomeIcon fontSize="small" />,
    kind: "openai",
    apiFormat: "openai",
    baseUrl: "http://127.0.0.1:0",
    nativeModels: "gemini-3.8-flash-high,gemini-3.8-flash-medium,gemini-3.8-flash-low,gemini-3.8-pro-high,gemini-3.8-pro-low",
    catalogUrl: "https://github.com/your-repo/agy-launch",
  }
];

const DEFAULT_RELAY_PROVIDER_TEMPLATE = RELAY_PROVIDER_TEMPLATES[0]!;

const RELAY_PROVIDER_TEMPLATE_PRIORITY: RelayTemplateId[] = [
  "openai",
  "anthropic",
  "gemini",
  "xai",
  "deepseek",
  "deepkey",
  "linuxdo",
  "custom"
];

// Keep the complete template catalog above for future sponsored placements.
// Only established providers and the explicitly enabled relay stations appear in Add Channel.
const VISIBLE_RELAY_PROVIDER_TEMPLATE_IDS = new Set<RelayTemplateId>(RELAY_PROVIDER_TEMPLATE_PRIORITY);

type RelayProviderTemplate = (typeof RELAY_PROVIDER_TEMPLATES)[number];

function normalizeTemplateUrl(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

function normalizeTemplateBaseUrl(value?: string): string {
  return normalizeTemplateUrl(value).replace(/\/v1$/, "");
}

function identifyRelayProviderTemplate(provider: ProviderConfig): RelayProviderTemplate | undefined {
  const savedTemplate = RELAY_PROVIDER_TEMPLATES.find((entry) => entry.id === provider.serviceProvider?.id);
  if (savedTemplate) {
    return savedTemplate;
  }
  const providerBaseUrl = normalizeTemplateBaseUrl(provider.baseUrl);
  if (providerBaseUrl) {
    const baseMatch = RELAY_PROVIDER_TEMPLATES.find((entry) => normalizeTemplateBaseUrl(entry.baseUrl) === providerBaseUrl);
    if (baseMatch) {
      return baseMatch;
    }
  }
  const providerCatalogUrl = normalizeTemplateUrl(provider.capabilityCatalogUrl);
  if (providerCatalogUrl) {
    const catalogMatch = RELAY_PROVIDER_TEMPLATES.find(
      (entry) => normalizeTemplateUrl(entry.catalogUrl) === providerCatalogUrl
    );
    if (catalogMatch) {
      return catalogMatch;
    }
  }
  return undefined;
}

function findRelayProviderTemplate(provider: ProviderConfig): RelayProviderTemplate {
  return identifyRelayProviderTemplate(provider)
    ?? RELAY_PROVIDER_TEMPLATES.find((entry) => entry.kind === provider.kind)
    ?? DEFAULT_RELAY_PROVIDER_TEMPLATE;
}

function templateDefaultStationType(template: RelayProviderTemplate): StationType {
  return template.id === "deepkey" || template.id === "linuxdo" || template.id === "custom" ? "third_party" : "official";
}

function templateDefaultResponseProtocol(template: RelayProviderTemplate): NonNullable<ChannelGroupConfig["responseProtocol"]> {
  return template.kind === "openai" ? "openai" : "openai-response";
}

type AdvancedRelayConnectionDraft = {
  name: string;
  targetProviderId: string | null;
  serviceProviderId: string;
  serviceProviderName: string;
  baseUrl: string;
  apiKey: string;
  protocol: NonNullable<ChannelGroupConfig["responseProtocol"]>;
};

type AdvancedRelayConnectionHandle = {
  value: () => AdvancedRelayConnectionDraft;
};

const AdvancedRelayConnectionStep = memo(forwardRef<AdvancedRelayConnectionHandle, {
  directory: ReadonlyArray<AdvancedRelayVendorOption>;
  initialValue: AdvancedRelayConnectionDraft;
  t: TranslateFn;
  onChange?: (value: AdvancedRelayConnectionDraft) => void;
}>(({ directory, initialValue, t, onChange }, ref) => {
  const [draft, setDraft] = useState(initialValue);
  const [vendorSearch, setVendorSearch] = useState("");
  const visibleVendors = useMemo(() => {
    const needle = vendorSearch.trim().toLowerCase();
    return needle
      ? directory.filter((entry) => entry.name.toLowerCase().includes(needle))
      : directory;
  }, [directory, vendorSearch]);
  useImperativeHandle(ref, () => ({ value: () => draft }), [draft]);
  useEffect(() => onChange?.(draft), [draft, onChange]);

  const selectVendor = (vendor: AdvancedRelayVendorOption) => {
    setDraft((current) => ({
      ...current,
      targetProviderId: vendor.targetProviderId,
      serviceProviderId: vendor.serviceProviderId,
      serviceProviderName: vendor.name,
      name: vendor.targetProviderName ?? `${vendor.name} 1`,
      baseUrl: vendor.baseUrl || current.baseUrl,
      protocol: vendor.protocol
    }));
  };

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "220px minmax(0, 1fr)" }, minHeight: 390, border: "1px solid", borderColor: "divider" }}>
      <Box sx={{ bgcolor: "action.hover", borderRight: { md: "1px solid" }, borderBottom: { xs: "1px solid", md: 0 }, borderColor: "divider", p: 1.25 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 1 }}>{t("settings.relay.vendorDirectory")}</Typography>
        <TextField
          size="small"
          fullWidth
          value={vendorSearch}
          onChange={(event) => setVendorSearch(event.target.value)}
          placeholder={t("settings.relay.vendorSearch")}
          InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.75, color: "text.secondary" }} /> }}
          sx={{ mb: 1 }}
        />
        <Stack spacing={0.65} sx={{ maxHeight: 315, overflowY: "auto" }}>
          {visibleVendors.map((vendor) => {
            const selected = draft.targetProviderId
              ? draft.targetProviderId === vendor.targetProviderId
              : !vendor.targetProviderId && draft.serviceProviderId === vendor.serviceProviderId;
            return (
              <Button
                key={vendor.id}
                data-testid={`relay-vendor-${vendor.serviceProviderId}`}
                variant={selected ? "contained" : "text"}
                color={selected ? "primary" : "inherit"}
                onClick={() => selectVendor(vendor)}
                startIcon={<VendorLogo name={vendor.name} size={19} />}
                sx={{ justifyContent: "flex-start", minHeight: 42, px: 1.25, bgcolor: selected ? undefined : "background.paper" }}
              >
                {vendor.name}
              </Button>
            );
          })}
        </Stack>
      </Box>
      <Stack spacing={1.25} sx={{ p: { xs: 1.5, md: 2 } }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{draft.serviceProviderName || t("settings.relay.customProvider")}</Typography>
          <Typography variant="caption" color="text.secondary">{t("settings.relay.instanceDescription")}</Typography>
        </Box>
        <TextField
          autoFocus
          size="small"
          fullWidth
          label={t("settings.relay.instanceName")}
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          disabled={Boolean(draft.targetProviderId)}
          error={!draft.name.trim()}
          helperText={!draft.name.trim() ? t("settings.relay.channelNameRequired") : t("settings.relay.instanceRenameHint")}
        />
        {draft.serviceProviderId === "custom" ? (
          <TextField
            size="small"
            fullWidth
            label={t("settings.relay.customProviderName")}
            value={draft.serviceProviderName}
            onChange={(event) => setDraft((current) => ({ ...current, serviceProviderName: event.target.value }))}
          />
        ) : null}
        <TextField
          size="small"
          fullWidth
          label={t("settings.relay.baseUrl")}
          value={draft.baseUrl}
          onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
        />
        <TextField
          size="small"
          fullWidth
          type="password"
          label={t("settings.relay.apiKey")}
          value={draft.apiKey}
          onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
        />
        <FormControl size="small" fullWidth>
          <InputLabel>{t("settings.relay.responseProtocol")}</InputLabel>
          <Select
            value={draft.protocol}
            label={t("settings.relay.responseProtocol")}
            onChange={(event) => setDraft((current) => ({
              ...current,
              protocol: event.target.value as AdvancedRelayConnectionDraft["protocol"]
            }))}
          >
            <MenuItem value="openai-response">OpenAI Responses</MenuItem>
            <MenuItem value="openai">OpenAI Chat Completions</MenuItem>
            <MenuItem value="anthropic">Anthropic Messages</MenuItem>
            <MenuItem value="gemini">Gemini Native</MenuItem>
          </Select>
        </FormControl>
        <Alert severity="info">{t("settings.relay.quickModelsAutoFetch")}</Alert>
      </Stack>
    </Box>
  );
}));

AdvancedRelayConnectionStep.displayName = "AdvancedRelayConnectionStep";

export function RelaySettingsPanel({
  providers,
  activeProviderId,
  activeProvider,
  initialProviderId,
  initialGroupId,
  selectedModel,
  canManage = true,
  sessionToken,
  t,
  onSaveProvider,
  onShareProvider,
  onImportSharedRelay,
  onSyncFreeOllama,
  onRequestOmniRouteFreeSync,
  freeOllamaEnabled,
  onFreeOllamaEnabledChange,
  onActivateProvider,
  windowsDesktop = false,
  isCodexEnabled = true,
  onInjectClaudeDesktop,
  onInjectCursorDesktop,
  onTestProviderWithCodex,
  onImportCapabilityCatalog,
  onExportRelayBackup,
  onImportRelayBackup,
  onDeleteProvider,
  onRestoreProvider
}: {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activeProvider?: ProviderConfig;
  initialProviderId?: string | null;
  initialGroupId?: string | null;
  selectedModel: string;
  canManage?: boolean;
  sessionToken?: string | null;
  t: TranslateFn;
  onSaveProvider: (provider: ProviderConfig, apiKey?: string, mergeIntoProviderId?: string) => Promise<void>;
  onShareProvider?: (provider: ProviderConfig) => void;
  onImportSharedRelay?: () => void;
  onSyncFreeOllama: () => Promise<FreeOllamaImportResponse>;
  onRequestOmniRouteFreeSync: () => void;
  freeOllamaEnabled: boolean;
  onFreeOllamaEnabledChange: (enabled: boolean) => void;
  onActivateProvider: (providerId: string, model?: string, groupId?: string) => Promise<void>;
  windowsDesktop?: boolean;
  isCodexEnabled?: boolean;
  onInjectClaudeDesktop?: (
    providerId: string,
    groupId?: string,
    models?: string[],
    modelMappings?: Record<string, string>
  ) => Promise<void>;
  onInjectCursorDesktop?: (providerId: string, groupId?: string) => Promise<void>;
  onTestProviderWithCodex: (providerId: string, model?: string) => Promise<void>;
  onImportCapabilityCatalog: (providerId: string, catalog: JsonValue, mode: "merge" | "replace") => Promise<RelayCatalogImportResult>;
  onExportRelayBackup: () => Promise<void>;
  onImportRelayBackup: (file: File) => Promise<number>;
  onDeleteProvider: (providerId: string) => Promise<void>;
  onRestoreProvider: (providerId: string) => Promise<void>;
}) {
  type RelayView = "list" | "form";
  type TestStatus = { state: "passed" | "failed"; message: string };

  const [relayView, setRelayView] = useState<RelayView>("list");
  const [relayListProviders, setRelayListProviders] = useState<RelaySettingsListEntry[]>([]);
  const [trashedRelayProviders, setTrashedRelayProviders] = useState<RelaySettingsListEntry[]>([]);
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const [trashConfirmProvider, setTrashConfirmProvider] = useState<RelaySettingsListEntry | null>(null);
  const [trashMutationId, setTrashMutationId] = useState<string | null>(null);
  const [editingProviderDetails, setEditingProviderDetails] = useState<ProviderConfig | null>(null);
  const [relayListLoading, setRelayListLoading] = useState(false);
  const [relayDetailsLoading, setRelayDetailsLoading] = useState<string | null>(null);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [stationTypeFilters, setStationTypeFilters] = useState<StationType[]>([]);
  const [templateStationTypeFilters, setTemplateStationTypeFilters] = useState<StationType[]>([]);
  const [templateId, setTemplateId] = useState<RelayTemplateId>("openai");
  const template = RELAY_PROVIDER_TEMPLATES.find((entry) => entry.id === templateId) ?? DEFAULT_RELAY_PROVIDER_TEMPLATE;
  const [apiFormat, setApiFormat] = useState<ProviderConfig["kind"]>(template.apiFormat);
  const [name, setName] = useState(t("settings.relay.defaultChannelName"));
  const channelNameInputRef = useRef<HTMLInputElement | null>(null);
  const [serviceProviderName, setServiceProviderName] = useState(template.label);
  const [serviceProviderLogo, setServiceProviderLogo] = useState("");
  const [serviceProviderLogoError, setServiceProviderLogoError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState(template.baseUrl);
  const [remark, setRemark] = useState("");
  const [streamMaxRetries, setStreamMaxRetries] = useState("5");
  const [quotaUsd, setQuotaUsd] = useState<string>("");
  const [stationType, setStationType] = useState<StationType>("third_party");
  const [enableCheckin, setEnableCheckin] = useState<boolean>(true);
  const [remindCheckin, setRemindCheckin] = useState<boolean>(true);
  const [groups, setGroups] = useState<ChannelGroupConfig[]>([
    {
      id: "group-default",
      name: "default",
      kind: "text",
      status: "enabled",
      groupRatio: 1.0,
      quotaUsd: null,
      priority: 1,
      weight: 0,
      keyMode: "polling",
      autoBan: true,
      keys: [],
      enableFallback: false,
      fallbackGroupName: undefined
    }
  ]);
  const [providerModels, setProviderModels] = useState<Record<string, string>>({});
  const [claudeInjectionProvider, setClaudeInjectionProvider] = useState<ProviderConfig | null>(null);
  const [claudeInjectionGroupId, setClaudeInjectionGroupId] = useState("");
  const [claudeInjectionModelsSelected, setClaudeInjectionModelsSelected] = useState<string[]>([]);
  const [claudeInjectionModelMappings, setClaudeInjectionModelMappings] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [relayListPage, setRelayListPage] = useState(0);
  const [templateSearch, setTemplateSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveValidationError, setSaveValidationError] = useState<string | null>(null);
  const [riskConfirmationOpen, setRiskConfirmationOpen] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [unsavedChangesDialogOpen, setUnsavedChangesDialogOpen] = useState(false);
  const initialFormSnapshotRef = useRef<{
    templateId: RelayTemplateId;
    apiFormat: ProviderConfig["kind"];
    name: string;
    serviceProviderName: string;
    serviceProviderLogo: string;
    baseUrl: string;
    remark: string;
    streamMaxRetries: string;
    quotaUsd: string;
    catalogUrl: string;
    stationType: StationType;
    enableCheckin: boolean;
    remindCheckin: boolean;
    groups: ChannelGroupConfig[];
  } | null>(null);
  const captureFormSnapshot = () => {
    initialFormSnapshotRef.current = {
      templateId,
      apiFormat,
      name,
      serviceProviderName,
      serviceProviderLogo,
      baseUrl,
      remark,
      streamMaxRetries,
      quotaUsd,
      catalogUrl,
      stationType,
      enableCheckin,
      remindCheckin,
      groups: groups.map((group) => ({
        ...group,
        keys: [...(group.keys ?? [])],
        models: [...(group.models ?? [])]
      }))
    };
  };
  type NewChannelDialogMode = "chooser" | "quick" | "advanced" | null;
  const [newChannelDialogMode, setNewChannelDialogMode] = useState<NewChannelDialogMode>(null);
  const [quickChannelName, setQuickChannelName] = useState("");
  const [quickChannelBaseUrl, setQuickChannelBaseUrl] = useState("");
  const [quickChannelApiKey, setQuickChannelApiKey] = useState("");
  const [quickChannelProtocol, setQuickChannelProtocol] = useState<NonNullable<ChannelGroupConfig["responseProtocol"]>>("openai-response");
  const [quickServiceProviderId, setQuickServiceProviderId] = useState<RelayTemplateId>("openai");
  const [quickServiceProviderName, setQuickServiceProviderName] = useState("OpenAI");
  const [quickTargetProviderId, setQuickTargetProviderId] = useState<string | null>(null);
  const [quickConnectionKey, setQuickConnectionKey] = useState(0);
  const quickConnectionRef = useRef<AdvancedRelayConnectionHandle | null>(null);
  const [quickFetchedModels, setQuickFetchedModels] = useState<string[]>([]);
  const [quickManualModels, setQuickManualModels] = useState(false);
  const [quickManualModelsText, setQuickManualModelsText] = useState("");
  const [quickCreateError, setQuickCreateError] = useState<string | null>(null);
  const [quickCreating, setQuickCreating] = useState(false);
  const [advancedStep, setAdvancedStep] = useState(0);
  const [advancedGroupName, setAdvancedGroupName] = useState("default");
  const [advancedGroupRatio, setAdvancedGroupRatio] = useState("1");
  const [advancedPriority, setAdvancedPriority] = useState("1");
  const [advancedWeight, setAdvancedWeight] = useState("0");
  const [advancedModelMapping, setAdvancedModelMapping] = useState("");
  const [advancedStatusMapping, setAdvancedStatusMapping] = useState("");
  const [advancedRemark, setAdvancedRemark] = useState("");
  const [advancedServiceProviderId, setAdvancedServiceProviderId] = useState<RelayTemplateId>("openai");
  const [advancedServiceProviderName, setAdvancedServiceProviderName] = useState("OpenAI");
  const [advancedTargetProviderId, setAdvancedTargetProviderId] = useState<string | null>(null);
  const advancedConnectionRef = useRef<AdvancedRelayConnectionHandle | null>(null);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [relayBackupBusy, setRelayBackupBusy] = useState(false);
  const exportRelayBackupFile = async () => {
    setRelayBackupBusy(true);
    try {
      await onExportRelayBackup();
    } finally {
      setRelayBackupBusy(false);
    }
  };
  const importRelayBackupFile = async (file: File) => {
    if (!window.confirm("导入中转站备份将按中转站 ID 合并配置，可能覆盖同 ID 配置。继续吗？")) return;
    setRelayBackupBusy(true);
    try {
      await onImportRelayBackup(file);
      setRelayListProviders([]);
      await refreshRelayList();
    } finally {
      setRelayBackupBusy(false);
    }
  };
  const [testStatuses, setTestStatuses] = useState<Record<string, TestStatus>>({});
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});
  const [visibleGroupKeys, setVisibleGroupKeys] = useState<Record<string, boolean>>({});
  const [groupKeyDrafts, setGroupKeyDrafts] = useState<Record<string, string>>({});
  const [groupModelMappingDrafts, setGroupModelMappingDrafts] = useState<Record<string, string>>({});
  const [groupStatusCodeMappingDrafts, setGroupStatusCodeMappingDrafts] = useState<Record<string, string>>({});
  const [groupAdvancedMappingOpen, setGroupAdvancedMappingOpen] = useState<Record<string, boolean>>({});
  const [modelTargetGroupId, setModelTargetGroupId] = useState("group-default");
  const [groupEditorId, setGroupEditorId] = useState("group-default");
  const [groupSearch, setGroupSearch] = useState("");
  const [groupStatusFilter, setGroupStatusFilter] = useState<RelayGroupStatusFilter>("available");
  const [groupProtocolFilter, setGroupProtocolFilter] = useState<RelayGroupProtocolFilter>("all");
  const [groupSort, setGroupSort] = useState<RelayGroupSort>("original");
  const [groupView, setGroupView] = useState<"list" | "details" | "large_icons">("details");
  const [catalogGroupBrowserOpen, setCatalogGroupBrowserOpen] = useState(false);
  const [catalogGroupSearch, setCatalogGroupSearch] = useState("");
  const [catalogGroupProtocol, setCatalogGroupProtocol] = useState<RelayGroupProtocolFilter>("all");
  const [catalogGroupSort, setCatalogGroupSort] = useState<RelayGroupSort>("original");
  const [catalogGroupView, setCatalogGroupView] = useState<"list" | "details" | "large_icons">("details");
  const [catalogTreeSelection, setCatalogTreeSelection] = useState<RelayCatalogTreeSelection>({ level: "all" });
  const [draftGroupId, setDraftGroupId] = useState<string | null>(null);
  const [catalogUrl, setCatalogUrl] = useState("");
  const hasUnsavedChanges = useMemo(() => {
    const snapshot = initialFormSnapshotRef.current;
    if (!snapshot) return false;
    if (
      templateId !== snapshot.templateId ||
      apiFormat !== snapshot.apiFormat ||
      name !== snapshot.name ||
      serviceProviderName !== snapshot.serviceProviderName ||
      serviceProviderLogo !== snapshot.serviceProviderLogo ||
      baseUrl !== snapshot.baseUrl ||
      remark !== snapshot.remark ||
      streamMaxRetries !== snapshot.streamMaxRetries ||
      quotaUsd !== snapshot.quotaUsd ||
      catalogUrl !== snapshot.catalogUrl ||
      stationType !== snapshot.stationType ||
      enableCheckin !== snapshot.enableCheckin ||
      remindCheckin !== snapshot.remindCheckin
    ) {
      return true;
    }
    if (groups.length !== snapshot.groups.length) return true;
    return groups.some((group, index) => {
      const snapGroup = snapshot.groups[index];
      if (!snapGroup) return true;
      return (
        group.id !== snapGroup.id ||
        group.name !== snapGroup.name ||
        group.kind !== snapGroup.kind ||
        group.status !== snapGroup.status ||
        group.groupRatio !== snapGroup.groupRatio ||
        group.quotaUsd !== snapGroup.quotaUsd ||
        group.priority !== snapGroup.priority ||
        group.weight !== snapGroup.weight ||
        group.keyMode !== snapGroup.keyMode ||
        group.autoBan !== snapGroup.autoBan ||
        group.enableFallback !== snapGroup.enableFallback ||
        group.fallbackGroupName !== snapGroup.fallbackGroupName ||
        group.responseProtocol !== snapGroup.responseProtocol ||
        group.responseProtocolMode !== snapGroup.responseProtocolMode ||
        group.authType !== snapGroup.authType ||
        group.credentialMode !== snapGroup.credentialMode ||
        group.commandBlacklistEnabled !== snapGroup.commandBlacklistEnabled ||
        JSON.stringify(group.commandBlacklist) !== JSON.stringify(snapGroup.commandBlacklist) ||
        JSON.stringify(group.networkAllowlist) !== JSON.stringify(snapGroup.networkAllowlist) ||
        JSON.stringify(group.models) !== JSON.stringify(snapGroup.models) ||
        JSON.stringify(group.keys) !== JSON.stringify(snapGroup.keys) ||
        JSON.stringify(group.modelMapping) !== JSON.stringify(snapGroup.modelMapping) ||
        JSON.stringify(group.statusCodeMapping) !== JSON.stringify(snapGroup.statusCodeMapping)
      );
    });
  }, [templateId, apiFormat, name, serviceProviderName, serviceProviderLogo, baseUrl, remark, streamMaxRetries, quotaUsd, catalogUrl, stationType, enableCheckin, remindCheckin, groups]);

  const hasImageGroups = useMemo(() => groups.some((group) => group.kind === "image"), [groups]);

  // axonhub-style fetch models panel state
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [selectedFetchedModels, setSelectedFetchedModels] = useState<string[]>([]);
  const [showFetchedModelsPanel, setShowFetchedModelsPanel] = useState(false);
  const [fetchedModelsSearch, setFetchedModelsSearch] = useState("");
  const [showNotAddedModelsOnly, setShowNotAddedModelsOnly] = useState(false);
  const [fetchedModelsPage, setFetchedModelsPage] = useState(0);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsMessage, setFetchModelsMessage] = useState<string | null>(null);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [catalogInput, setCatalogInput] = useState<JsonValue | null>(null);
  const [catalogPreview, setCatalogPreview] = useState<RelayCatalogImportPreview | null>(null);
  const [catalogDraft, setCatalogDraft] = useState<RelayCapabilityCatalog | undefined>(undefined);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogMessage, setCatalogMessage] = useState<string | null>(null);
  const [freeOllamaBusy, setFreeOllamaBusy] = useState(false);
  const [freeOllamaMessage, setFreeOllamaMessage] = useState<string | null>(null);
  const [freeOllamaError, setFreeOllamaError] = useState<string | null>(null);
  const [freeOllamaConfirmOpen, setFreeOllamaConfirmOpen] = useState(false);
  const [forwardSharing, setForwardSharing] = useState<ForwardSettings | null>(null);
  const [forwardSharingBusy, setForwardSharingBusy] = useState(false);
  const [forwardSharingError, setForwardSharingError] = useState<string | null>(null);
  const [forwardConfigCopied, setForwardConfigCopied] = useState(false);

  const copyForwardConfig = useCallback(async () => {
    if (!forwardSharing?.baseUrl) return;
    const text = `baseUrl: ${forwardSharing.baseUrl}\nkey: ${forwardSharing.token ?? ""}\nmodel: 先 GET ${forwardSharing.baseUrl}/models 选一条 (形如 {cli}-{中转站}-{分组}-{模型})`;
    try {
      await navigator.clipboard.writeText(text);
      setForwardConfigCopied(true);
      setTimeout(() => setForwardConfigCopied(false), 2000);
    } catch {
      setForwardSharingError("复制失败，请手动记录 baseUrl 与 key");
    }
  }, [forwardSharing]);

  const refreshForwardSharing = useCallback(async () => {
    if (!sessionToken) return;
    try {
      setForwardSharing(await fetchForwardSettings(sessionToken));
      setForwardSharingError(null);
    } catch (error) {
      // 非管理员或服务异常时保持关闭态, 不打断中转站列表。
      setForwardSharingError(error instanceof Error ? error.message : String(error));
    }
  }, [sessionToken]);

  const requestForwardSharingChange = useCallback(async (enabled: boolean) => {
    if (!sessionToken || forwardSharingBusy) return;
    const previous = forwardSharing;
    setForwardSharingBusy(true);
    setForwardSharingError(null);
    try {
      setForwardSharing(await updateForwardSettings(sessionToken, enabled));
    } catch (error) {
      setForwardSharing(previous);
      setForwardSharingError(error instanceof Error ? error.message : String(error));
    } finally {
      setForwardSharingBusy(false);
    }
  }, [sessionToken, forwardSharingBusy, forwardSharing]);

  const requestFreeOllamaEnabledChange = (enabled: boolean) => {
    if (!enabled) {
      onFreeOllamaEnabledChange(false);
      setFreeOllamaMessage(null);
      setFreeOllamaError(null);
      return;
    }
    setFreeOllamaConfirmOpen(true);
  };

  const syncFreeOllamaNow = async () => {
    if (freeOllamaBusy) return;
    setFreeOllamaBusy(true);
    setFreeOllamaMessage(null);
    setFreeOllamaError(null);
    try {
      const result = await onSyncFreeOllama();
      setFreeOllamaMessage(`已同步 ${result.importedGroups} 个分组、${result.importedModels} 个模型；过滤 ${result.filteredServers} 个 TPS < ${result.minimumTps} 的服务`);
    } catch (error) {
      setFreeOllamaError(error instanceof Error ? error.message : String(error));
    } finally {
      setFreeOllamaBusy(false);
    }
  };

  const refreshRelayList = useCallback(async () => {
    if (!sessionToken) return;
    setRelayListLoading(true);
    try {
      setRelayListProviders(await fetchRelaySettingsList(sessionToken));
    } catch {
      // Keep the last successful lightweight list visible on transient failures.
    } finally {
      setRelayListLoading(false);
    }
  }, [sessionToken]);

  const refreshTrashedRelayList = useCallback(async () => {
    if (!sessionToken) return;
    setTrashedRelayProviders(await fetchTrashedRelaySettingsList(sessionToken));
  }, [sessionToken]);

  const openTrashDialog = useCallback(() => {
    void refreshTrashedRelayList().catch(() => undefined);
    setTrashDialogOpen(true);
  }, [refreshTrashedRelayList]);

  const trashProvider = useCallback(async () => {
    if (!trashConfirmProvider) return;
    setTrashMutationId(trashConfirmProvider.id);
    try {
      await onDeleteProvider(trashConfirmProvider.id);
      setTrashConfirmProvider(null);
      await refreshRelayList();
    } finally {
      setTrashMutationId(null);
    }
  }, [onDeleteProvider, refreshRelayList, trashConfirmProvider]);

  const restoreProvider = useCallback(async (providerId: string) => {
    if (!sessionToken) return;
    setTrashMutationId(providerId);
    try {
      await onRestoreProvider(providerId);
      await Promise.all([refreshRelayList(), refreshTrashedRelayList()]);
    } finally {
      setTrashMutationId(null);
    }
  }, [onRestoreProvider, refreshRelayList, refreshTrashedRelayList, sessionToken]);

  useEffect(() => {
    if (relayView === "list") void refreshRelayList();
  }, [refreshRelayList, relayView]);

  useEffect(() => {
    if (relayView === "list") void refreshForwardSharing();
  }, [refreshForwardSharing, relayView]);

  useEffect(() => {
    if (!canManage && relayView === "form") {
      setRelayView("list");
    }
  }, [canManage, relayView]);

  const editingProvider = editingProviderDetails?.id === editingProviderId
    ? editingProviderDetails
    : providers.find((provider) => provider.id === editingProviderId);
  const modelTargetGroup = groups.find((group) => group.id === modelTargetGroupId) ?? groups[0];
  const targetGroupModelList = modelTargetGroup?.models ?? [];
  const groupApiKey = useMemo(() => groups.flatMap((group) => group.keys ?? []).find((key) => key.trim())?.trim() ?? "", [groups]);
  const hasProviderCredential = Boolean(groupApiKey || editingProvider?.apiKeyPreview);
  const groupsMissingKeys = useMemo(
    () => relayGroupsMissingKeys(groups, hasProviderCredential),
    [groups, hasProviderCredential]
  );
  const canSaveConfiguredGroups = groups.length > 0 && groupsMissingKeys.length === 0;
  const groupMappingsValid = groups.every((group) => (
    isValidGroupMappingDraft(groupModelMappingDrafts[group.id] ?? formatGroupMapping(group.modelMapping))
    && isValidStatusCodeMappingDraft(groupStatusCodeMappingDrafts[group.id] ?? formatStatusCodeMapping(group.statusCodeMapping))
  ));
  const canSaveCustomProvider = templateId !== "custom" || Boolean(serviceProviderName.trim() && baseUrl.trim());
  const channelNameRequired = !name.trim();
  const duplicateChannelName = providers.some(
    (provider) => provider.id !== editingProviderId
      && !channelNameRequired
      && provider.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
  const channelNameError = channelNameRequired
    ? t("settings.relay.channelNameRequired")
    : duplicateChannelName
      ? t("settings.relay.duplicateChannelName")
      : undefined;
  const canSaveChannel = canSaveConfiguredGroups
    && canSaveCustomProvider
    && groupMappingsValid
    && !channelNameRequired
    && !duplicateChannelName;

  const configuredTemplateIds = useMemo(() => new Set(
    providers
      .map(identifyRelayProviderTemplate)
      .filter((entry): entry is RelayProviderTemplate => Boolean(entry))
      .map((entry) => entry.id)
  ), [providers]);

  const advancedRelayDirectory = useMemo<AdvancedRelayVendorOption[]>(() => {
    const templates = RELAY_PROVIDER_TEMPLATES
      .filter((entry) => VISIBLE_RELAY_PROVIDER_TEMPLATE_IDS.has(entry.id))
      .sort((left, right) => RELAY_PROVIDER_TEMPLATE_PRIORITY.indexOf(left.id) - RELAY_PROVIDER_TEMPLATE_PRIORITY.indexOf(right.id))
      .map((entry) => ({
        id: entry.id,
        name: entry.id === "custom" ? t("settings.relay.customProvider") : entry.label,
        baseUrl: entry.baseUrl,
        protocol: templateDefaultResponseProtocol(entry)
      }));
    return buildAdvancedRelayDirectory(
      providers,
      templates,
      (provider) => identifyRelayProviderTemplate(provider)?.id
    );
  }, [providers, t]);

  const filteredProviders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return relayListProviders.filter((provider) => {
      const providerStationType = provider.stationType ?? "third_party";
      if (stationTypeFilters.length > 0 && !stationTypeFilters.includes(providerStationType)) {
        return false;
      }
      if (!needle) return true;
      return [
          provider.name,
          provider.serviceProvider?.name,
          provider.kind,
          provider.baseUrl,
          provider.defaultModel,
          provider.remark,
          ...provider.nativeModels,
          ...(provider.groups ?? []).flatMap((group) => [
            group.name,
            group.tag,
            group.remark,
            ...(group.models ?? []),
            ...(group.modelMapping ?? []).flatMap((mapping) => [mapping.from, mapping.to])
          ]),
          ...providerTags(provider, provider.id === activeProviderId)
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [activeProviderId, relayListProviders, search, stationTypeFilters]);
  const relayListPagination = useMemo(
    () => paginateRelayList(filteredProviders, relayListPage),
    [filteredProviders, relayListPage],
  );

  useEffect(() => {
    setRelayListPage(0);
  }, [search, stationTypeFilters]);

  useEffect(() => {
    if (relayListPage !== relayListPagination.page) {
      setRelayListPage(relayListPagination.page);
    }
  }, [relayListPage, relayListPagination.page]);

  const filteredFetchedModels = useMemo(() => {
    let models = fetchedModels;
    if (showNotAddedModelsOnly) {
      models = models.filter((model) => !targetGroupModelList.includes(model));
    }
    const needle = fetchedModelsSearch.trim().toLowerCase();
    if (needle) {
      models = models.filter((model) => model.toLowerCase().includes(needle));
    }
    return models;
  }, [fetchedModels, fetchedModelsSearch, showNotAddedModelsOnly, targetGroupModelList]);
  const fetchedModelsPageCount = Math.max(1, Math.ceil(filteredFetchedModels.length / FETCHED_MODELS_PAGE_SIZE));
  const safeFetchedModelsPage = Math.min(fetchedModelsPage, fetchedModelsPageCount - 1);
  const visibleFetchedModels = useMemo(
    () => filteredFetchedModels.slice(
      safeFetchedModelsPage * FETCHED_MODELS_PAGE_SIZE,
      (safeFetchedModelsPage + 1) * FETCHED_MODELS_PAGE_SIZE
    ),
    [filteredFetchedModels, safeFetchedModelsPage]
  );
  const selectedFetchedModelSet = useMemo(() => new Set(selectedFetchedModels), [selectedFetchedModels]);
  const targetGroupModelSet = useMemo(() => new Set(targetGroupModelList), [targetGroupModelList]);

  const addedGroups = groups;
  const activeCatalog = catalogPreview?.catalog ?? catalogDraft ?? editingProvider?.capabilityCatalog;
  const catalogTemplateGroups = useMemo(() => catalogGroupTemplates(activeCatalog, groups), [activeCatalog, groups]);
  const treeFilteredCatalogGroups = useMemo(
    () => filterCatalogGroupsByTree(catalogTemplateGroups, activeCatalog, catalogTreeSelection),
    [activeCatalog, catalogTemplateGroups, catalogTreeSelection]
  );
  const useGroupExplorer = addedGroups.length > 10;
  const filteredAddedGroups = useMemo(() => filterAndSortRelayGroups(addedGroups, {
    search: useGroupExplorer ? groupSearch : "",
    status: groupStatusFilter,
    protocol: useGroupExplorer ? groupProtocolFilter : "all",
    sort: useGroupExplorer ? groupSort : "original"
  }), [addedGroups, groupProtocolFilter, groupSearch, groupSort, groupStatusFilter, useGroupExplorer]);
  const displayedGroups = useMemo(() => {
    const draft = draftGroupId ? addedGroups.find((group) => group.id === draftGroupId) : undefined;
    return draft && !filteredAddedGroups.some((group) => group.id === draft.id)
      ? [...filteredAddedGroups, draft]
      : filteredAddedGroups;
  }, [addedGroups, draftGroupId, filteredAddedGroups]);
  const displayedCatalogGroups = useMemo(() => filterAndSortRelayGroups(treeFilteredCatalogGroups, {
    search: catalogGroupSearch,
    status: "all",
    protocol: catalogGroupProtocol,
    sort: catalogGroupSort
  }), [catalogGroupProtocol, catalogGroupSearch, catalogGroupSort, treeFilteredCatalogGroups]);
  const selectedExplorerGroup = useGroupExplorer
    ? displayedGroups.find((group) => group.id === groupEditorId) ?? displayedGroups[0]
    : undefined;
  const groupsToEdit = useGroupExplorer ? (selectedExplorerGroup ? [selectedExplorerGroup] : []) : displayedGroups;

  const filteredRelayProviderTemplates = useMemo(() => {
    const needle = templateSearch.trim().toLowerCase();
    const visibleTemplates = RELAY_PROVIDER_TEMPLATES.filter((entry) =>
      VISIBLE_RELAY_PROVIDER_TEMPLATE_IDS.has(entry.id)
      && (entry.id === "custom" || !configuredTemplateIds.has(entry.id))
      && (
        templateStationTypeFilters.length === 0 || templateStationTypeFilters.includes(templateDefaultStationType(entry))
      )
    );
    if (!needle) {
      return visibleTemplates;
    }
    return visibleTemplates.filter((entry) =>
      [entry.id, entry.label, entry.kind, entry.apiFormat, entry.baseUrl, entry.nativeModels]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [configuredTemplateIds, templateSearch, templateStationTypeFilters]);

  const visibleRelayProviderTemplates = useMemo(() => {
    if (editingProvider) {
      return [findRelayProviderTemplate(editingProvider)];
    }
    const priority = new Map(RELAY_PROVIDER_TEMPLATE_PRIORITY.map((id, index) => [id, index]));
    return [...filteredRelayProviderTemplates].sort((left, right) => {
      const leftPriority = priority.get(left.id) ?? RELAY_PROVIDER_TEMPLATE_PRIORITY.length;
      const rightPriority = priority.get(right.id) ?? RELAY_PROVIDER_TEMPLATE_PRIORITY.length;
      return leftPriority - rightPriority || left.label.localeCompare(right.label);
    });
  }, [editingProvider, filteredRelayProviderTemplates]);

  const handleServiceProviderLogo = (file?: File) => {
    setServiceProviderLogoError(null);
    if (!file) return;
    if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type) || file.size > 512 * 1024) {
      setServiceProviderLogoError(t("settings.relay.customProviderLogoInvalid"));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        setServiceProviderLogo(reader.result);
      }
    });
    reader.addEventListener("error", () => setServiceProviderLogoError(t("settings.relay.customProviderLogoInvalid")));
    reader.readAsDataURL(file);
  };

  const clearFetchedModelsState = () => {
    setFetchedModels([]);
    setSelectedFetchedModels([]);
    setShowFetchedModelsPanel(false);
    setFetchedModelsSearch("");
    setShowNotAddedModelsOnly(false);
    setFetchedModelsPage(0);
    setFetchModelsMessage(null);
    setFetchModelsError(null);
  };

  const clearCatalogState = () => {
    setCatalogInput(null);
    setCatalogPreview(null);
    setCatalogDraft(undefined);
    setCatalogError(null);
    setCatalogMessage(null);
    setCatalogBusy(false);
  };

  const clearCatalogPreview = () => {
    setCatalogInput(null);
    setCatalogPreview(null);
    setCatalogError(null);
  };

  const defaultGroupTemplate = (kind: ChannelGroupConfig["kind"] = "text", models: string[] = []): ChannelGroupConfig => ({
    id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: "default",
    kind,
    status: "enabled",
    groupRatio: 1.0,
    quotaUsd: null,
    priority: 1,
    weight: 0,
    keyMode: "polling",
    models,
    responseProtocol: templateDefaultResponseProtocol(template),
    responseProtocolMode: "fixed",
    authType: "inherit",
    credentialMode: "group",
    commandBlacklistEnabled: true,
    commandBlacklist: [],
    networkAllowlist: [],
    image: kind === "image" ? defaultGroupImageConfig(template.image) : undefined,
    autoBan: true,
    keys: [],
    enableFallback: false,
    fallbackGroupName: undefined
  });

  const resetGroupUiState = (nextGroups: ChannelGroupConfig[]) => {
    const initialState = createInitialRelayGroupUiState(nextGroups);
    setExpandedGroupIds(initialState.expandedById);
    setVisibleGroupKeys({});
    setGroupKeyDrafts(Object.fromEntries(nextGroups.map((group) => [group.id, (group.keys ?? []).join("\n")])));
    setGroupModelMappingDrafts(Object.fromEntries(nextGroups.map((group) => [group.id, formatGroupMapping(group.modelMapping)])));
    setGroupStatusCodeMappingDrafts(Object.fromEntries(nextGroups.map((group) => [group.id, formatStatusCodeMapping(group.statusCodeMapping)])));
    setModelTargetGroupId(initialState.selectedId);
    setGroupEditorId(initialState.selectedId);
    setGroupSearch("");
    setGroupStatusFilter(nextGroups.some((group) => (group.keys ?? []).some((key) => key.trim())) ? "available" : "pending");
    setGroupProtocolFilter("all");
    setGroupSort("original");
    setCatalogGroupBrowserOpen(false);
    setCatalogGroupSearch("");
    setCatalogGroupProtocol("all");
    setCatalogGroupSort("original");
    setCatalogTreeSelection({ level: "all" });
    setDraftGroupId(null);
  };

  const toggleGroupExpanded = (groupId: string) => {
    setExpandedGroupIds((current) => ({ ...current, [groupId]: !current[groupId] }));
  };

  const toggleGroupKeysVisible = (groupId: string) => {
    setVisibleGroupKeys((current) => ({ ...current, [groupId]: !current[groupId] }));
  };

  const openGroupForConfiguration = (groupId: string) => {
    setDraftGroupId(groupId);
    setGroupStatusFilter("pending");
    setGroupEditorId(groupId);
    setModelTargetGroupId(groupId);
    setExpandedGroupIds((current) => ({ ...current, [groupId]: true }));
    setVisibleGroupKeys((current) => ({ ...current, [groupId]: true }));
    setCatalogGroupBrowserOpen(false);
  };

  const addCatalogGroup = (group: ChannelGroupConfig) => {
    setGroups((current) => current.some((entry) => entry.id === group.id)
      ? current
      : [...current, { ...group, credentialMode: "group", status: "enabled" }]);
    openGroupForConfiguration(group.id);
  };

  const addCustomGroup = () => {
    const newGroup: ChannelGroupConfig = {
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `group_${groups.length + 1}`,
      kind: "text",
      status: "enabled",
      groupRatio: 1,
      quotaUsd: null,
      priority: groups.length + 1,
      weight: 0,
      keyMode: "polling",
      responseProtocol: templateDefaultResponseProtocol(template),
      responseProtocolMode: "fixed",
      authType: "inherit",
      credentialMode: "group",
      autoBan: true,
      keys: [],
      enableFallback: false
    };
    setGroups((current) => [...current, newGroup]);
    openGroupForConfiguration(newGroup.id);
  };

  const updateGroupImage = (groupId: string, updater: (image: NonNullable<ChannelGroupConfig["image"]>) => NonNullable<ChannelGroupConfig["image"]>) => {
    setGroups(groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }
      return { ...group, image: updater(group.image ?? defaultGroupImageConfig(template.image)) };
    }));
  };

  const toggleGroupImageProtocol = (groupId: string, protocol: ImageGenerationProtocol) => {
    updateGroupImage(groupId, (image) => {
      const current = image.protocols ?? [];
      const protocols = current.includes(protocol) ? current.filter((entry) => entry !== protocol) : [...current, protocol];
      const defaultProtocol = image.defaultProtocol && protocols.includes(image.defaultProtocol) ? image.defaultProtocol : protocols.find((entry) => IMAGE_PROTOCOL_OPTIONS.find((option) => option.id === entry)?.generation);
      return {
        ...image,
        edits: protocol === "openaiImageEdits" ? !current.includes(protocol) : image.edits,
        protocols,
        defaultProtocol
      };
    });
  };

  const resetFormFromTemplate = (entry: (typeof RELAY_PROVIDER_TEMPLATES)[number]) => {
    setTemplateId(entry.id);
    setApiFormat(entry.apiFormat);
    setServiceProviderName(entry.id === "custom" ? "" : entry.label);
    setServiceProviderLogo("");
    setServiceProviderLogoError(null);
    setName(entry.label === "OpenAI" ? t("settings.relay.defaultChannelName") : t("settings.relay.templateChannelName", { provider: entry.label }));
    setBaseUrl(entry.baseUrl);
    setRemark("");
    setStreamMaxRetries("5");
    setCatalogUrl(entry.catalogUrl ?? "");
    setQuotaUsd("");
    const nextStationType = templateDefaultStationType(entry);
    setStationType(nextStationType);
    setEnableCheckin(true);
    setRemindCheckin(true);
    const nextGroups = [defaultGroupTemplate(entry.image?.generations ? "image" : "text")];
    setGroups(nextGroups);
    resetGroupUiState(nextGroups);
    clearFetchedModelsState();
    clearCatalogState();
    captureFormSnapshot();
  };

  const openAdvancedAddChannel = () => {
    if (!canManage) {
      return;
    }
    setQuickCreateError(null);
    setQuickFetchedModels([]);
    setQuickManualModels(false);
    setQuickManualModelsText("");
    setAdvancedStep(0);
    setAdvancedGroupName("default");
    setAdvancedGroupRatio("1");
    setAdvancedPriority("1");
    setAdvancedWeight("0");
    setAdvancedModelMapping("");
    setAdvancedStatusMapping("");
    setAdvancedRemark("");
    setAdvancedServiceProviderId("openai");
    setAdvancedServiceProviderName("OpenAI");
    setAdvancedTargetProviderId(null);
    setNewChannelDialogMode("advanced");
  };

  const startAddChannel = () => {
    if (!canManage) {
      return;
    }
    setQuickChannelName("");
    setQuickChannelBaseUrl("");
    setQuickChannelApiKey("");
    setQuickChannelProtocol("openai-response");
    setQuickFetchedModels([]);
    setQuickManualModels(false);
    setQuickManualModelsText("");
    setQuickCreateError(null);
    setNewChannelDialogMode("chooser");
  };

  const openQuickAddChannel = () => {
    const vendor = defaultAdvancedRelayVendor(advancedRelayDirectory);
    if (vendor) {
      setQuickChannelName(vendor.targetProviderName ?? `${vendor.name} 1`);
      setQuickChannelBaseUrl(vendor.baseUrl);
      setQuickChannelProtocol(vendor.protocol);
      setQuickServiceProviderId(vendor.serviceProviderId as RelayTemplateId);
      setQuickServiceProviderName(vendor.name);
      setQuickTargetProviderId(vendor.targetProviderId);
    }
    setQuickConnectionKey((value) => value + 1);
    setQuickManualModels(false);
    setQuickManualModelsText("");
    setQuickCreateError(null);
    setNewChannelDialogMode("quick");
  };

  const syncQuickConnection = useCallback((connection: AdvancedRelayConnectionDraft) => {
    setQuickChannelName(connection.name);
    setQuickChannelBaseUrl(connection.baseUrl);
    setQuickChannelApiKey(connection.apiKey);
    setQuickChannelProtocol(connection.protocol);
    setQuickServiceProviderId(connection.serviceProviderId as RelayTemplateId);
    setQuickServiceProviderName(connection.serviceProviderName);
    setQuickTargetProviderId(connection.targetProviderId);
    setQuickCreateError(null);
  }, []);

  const startEditChannel = async (provider: ProviderConfig, focusGroupId?: string | null) => {
    if (!canManage) {
      return;
    }
    if (sessionToken) {
      setRelayDetailsLoading(provider.id);
      try {
        provider = await fetchRelaySettings(sessionToken, provider.id);
      } catch (error) {
        setSaveValidationError(formatRelayErrorText(error));
        return;
      } finally {
        setRelayDetailsLoading(null);
      }
    }
    setEditingProviderDetails(provider);
    setNewChannelDialogMode(null);
    const matchingTemplate = findRelayProviderTemplate(provider);
    setTemplateSearch("");
    setTemplateId(matchingTemplate.id);
    setApiFormat(provider.kind);
    setServiceProviderName(provider.serviceProvider?.name ?? matchingTemplate.label);
    setServiceProviderLogo(provider.serviceProvider?.logo ?? "");
    setServiceProviderLogoError(null);
    setName(provider.name);
    setBaseUrl(provider.baseUrl ?? "");
    setRemark(provider.remark ?? "");
    setStreamMaxRetries(String(provider.streamMaxRetries ?? 5));
    setCatalogUrl(provider.capabilityCatalogUrl ?? matchingTemplate.catalogUrl ?? "");
    setQuotaUsd(provider.quotaUsd != null ? String(provider.quotaUsd) : "");
    setStationType(provider.stationType ?? templateDefaultStationType(matchingTemplate));
    setEnableCheckin(provider.enableCheckin ?? true);
    setRemindCheckin(provider.remindCheckin ?? true);
    if (provider.groups && provider.groups.length > 0) {
      const nextGroups = provider.groups.map((group) => {
        const kind = group.kind ?? (provider.image?.generations ? "image" : "text");
        return {
          ...group,
          models: filterModelsForGroup(relayGroupModelsForEditing(provider, { ...group, kind }), kind),
          kind,
          status: group.status ?? "enabled",
          keyMode: group.keyMode ?? "polling",
          image: kind === "image" ? group.image ?? provider.image ?? defaultGroupImageConfig(matchingTemplate.image) : undefined,
          autoBan: group.autoBan ?? true,
          enableTieredContext: undefined,
          tieredContextRatios: undefined
        };
      });
      setGroups(nextGroups);
      resetGroupUiState(nextGroups);
      const focusedGroup = focusGroupId ? nextGroups.find((group) => group.id === focusGroupId) : undefined;
      if (focusedGroup) {
        setGroupStatusFilter("all");
        setGroupEditorId(focusedGroup.id);
        setModelTargetGroupId(focusedGroup.id);
        setDraftGroupId(focusedGroup.id);
        setExpandedGroupIds((current) => ({ ...current, [focusedGroup.id]: true }));
      }
    } else {
      const nextGroups: ChannelGroupConfig[] = [defaultGroupTemplate(provider.image?.generations ? "image" : "text", provider.nativeModels)];
      setGroups(nextGroups);
      resetGroupUiState(nextGroups);
    }
    setEditingProviderId(provider.id);
    clearFetchedModelsState();
    clearCatalogState();
    setRelayView("form");
    captureFormSnapshot();
  };

  const initialRelayTargetKey = `${initialProviderId ?? ""}:${initialGroupId ?? ""}`;
  const handledInitialRelayTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialProviderId || !canManage || !initialRelayTargetKey || handledInitialRelayTargetRef.current === initialRelayTargetKey) return;
    const provider = providers.find((entry) => entry.id === initialProviderId);
    if (!provider) return;
    handledInitialRelayTargetRef.current = initialRelayTargetKey;
    void startEditChannel(provider, initialGroupId);
  }, [canManage, initialGroupId, initialProviderId, initialRelayTargetKey, providers]);

  const handleCatalogFile = async (file: File) => {
    if (!sessionToken) {
      setCatalogError(t("settings.relay.catalogLoadFailed"));
      return;
    }
    setCatalogBusy(true);
    setCatalogError(null);
    setCatalogMessage(null);
    try {
      const parsed = JSON.parse(await file.text()) as JsonValue;
      const preview = await previewCapabilityCatalog(sessionToken, editingProviderId, parsed);
      setCatalogInput(parsed);
      setCatalogPreview(preview);
    } catch (error) {
      setCatalogInput(null);
      setCatalogPreview(null);
      setCatalogError(error instanceof Error ? error.message : String(error));
    } finally {
      setCatalogBusy(false);
    }
  };

  const refreshCatalogUrl = async (): Promise<RelayCatalogImportPreview | null> => {
    const nextUrl = catalogUrl.trim();
    if (!sessionToken || !nextUrl || catalogBusy) return null;
    setCatalogBusy(true);
    setCatalogError(null);
    setCatalogMessage(null);
    try {
      const preview = await previewCapabilityCatalogUrl(sessionToken, editingProviderId, nextUrl);
      setCatalogInput(preview.catalog as unknown as JsonValue);
      setCatalogPreview(preview);
      return preview;
    } catch (error) {
      setCatalogInput(null);
      setCatalogPreview(null);
      setCatalogError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setCatalogBusy(false);
    }
  };

  const openCatalogGroupBrowser = () => {
    setCatalogGroupBrowserOpen(true);
    if (!activeCatalog && catalogUrl.trim()) {
      void refreshCatalogUrl();
    }
  };

  const commitCatalogImport = async (mode: "merge" | "replace") => {
    if (!catalogInput || !catalogPreview || catalogBusy) return;
    setCatalogBusy(true);
    setCatalogError(null);
    setCatalogMessage(null);
    try {
      if (!editingProviderId) {
        const nextGroups = mergeCatalogGroupDrafts(groups, catalogPreview.groups, mode);
        setGroups(nextGroups);
        resetGroupUiState(nextGroups);
        setGroupStatusFilter("all");
        setCatalogDraft(catalogPreview.catalog);
      } else {
        const result = await onImportCapabilityCatalog(editingProviderId, catalogInput, mode);
        const nextGroups = result.provider.groups ?? [];
        setGroups(nextGroups);
        resetGroupUiState(nextGroups);
        setGroupStatusFilter("all");
        setCatalogDraft(result.provider.capabilityCatalog);
      }
      setCatalogPreview(null);
      setCatalogInput(null);
      setCatalogMessage(t(mode === "replace" ? "settings.relay.catalogReplaceSuccess" : "settings.relay.catalogMergeSuccess"));
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
    } finally {
      setCatalogBusy(false);
    }
  };

  const firstGroupApiKey = (group: ChannelGroupConfig) => (group.keys ?? []).find((key) => key.trim())?.trim() ?? "";
  const canFetchModelsForGroup = (group: ChannelGroupConfig) =>
    Boolean(baseUrl.trim()) && Boolean(firstGroupApiKey(group) || editingProvider?.apiKeyPreview);

  const handleFetchModels = async (groupId: string) => {
    if (!canManage || fetchingModels) {
      return;
    }
    const group = groups.find((entry) => entry.id === groupId);
    if (!group) {
      return;
    }
    const apiKey = firstGroupApiKey(group);
    setModelTargetGroupId(group.id);
    if (!baseUrl.trim()) {
      setFetchModelsError(t("settings.relay.fetchModelsNeedBaseUrl"));
      return;
    }
    if (!apiKey && !editingProvider?.apiKeyPreview) {
      setFetchModelsError(t("settings.relay.fetchModelsNeedKey"));
      return;
    }
    if (!sessionToken) {
      setFetchModelsError(t("settings.relay.fetchModelsFailed"));
      return;
    }

    setFetchingModels(true);
    setFetchModelsError(null);
    setFetchModelsMessage(null);
    try {
      const result = await fetchProviderModels(sessionToken, {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey || undefined,
        kind: apiFormat,
        providerId: editingProviderId ?? undefined,
        groupId: group.id,
        protocol: group.responseProtocol
      });
      if (result.error && result.models.length === 0) {
        setFetchModelsError(result.error || t("settings.relay.fetchModelsFailed"));
        return;
      }
      const models = result.models.map((entry) => entry.id).filter(Boolean);
      setFetchedModels(models);
      setSelectedFetchedModels((group.models?.length ?? 0) === 0
        ? filterModelsForGroup(models, group.kind)
        : []);
      setShowFetchedModelsPanel(true);
      setFetchedModelsSearch("");
      setShowNotAddedModelsOnly(false);
      setFetchedModelsPage(0);
      const count = models.length;
      setFetchModelsMessage(
        count > 100
          ? t("settings.relay.fetchModelsSuccessLarge", { count })
          : t("settings.relay.fetchModelsSuccess", { count })
      );
      if (result.error) {
        setFetchModelsError(result.error);
      }
    } catch (error) {
      setFetchModelsError(formatRelayErrorText(error) || t("settings.relay.fetchModelsFailed"));
    } finally {
      setFetchingModels(false);
    }
  };

  const toggleFetchedModelSelection = (model: string) => {
    setSelectedFetchedModels((prev) => (prev.includes(model) ? prev.filter((entry) => entry !== model) : [...prev, model]));
  };

  const selectAllFilteredModels = () => {
    setSelectedFetchedModels(filteredFetchedModels);
  };

  const deselectAllFetchedModels = () => {
    setSelectedFetchedModels([]);
  };

  // Toggle semantics from axonhub: selected already-active models are removed; others are added.
  const applySelectedFetchedModels = () => {
    if (selectedFetchedModels.length === 0 || !modelTargetGroup) {
      return;
    }
    const current = filterModelsForGroup(targetGroupModelList, modelTargetGroup.kind);
    const selectedForGroup = filterModelsForGroup(selectedFetchedModels, modelTargetGroup.kind);
    const toRemove = new Set(selectedForGroup.filter((model) => current.includes(model)));
    const toAdd = selectedForGroup.filter((model) => !current.includes(model));
    const next = filterModelsForGroup([...current.filter((model) => !toRemove.has(model)), ...toAdd], modelTargetGroup.kind);
    setGroups(groups.map((group) => (group.id === modelTargetGroup.id ? { ...group, models: next } : group)));
    setSelectedFetchedModels([]);
  };

  const imageConfigFromForm = (): ProviderConfig["image"] => {
    if (!hasImageGroups) {
      return undefined;
    }
    const imageGroups = groups.filter((group) => group.kind === "image").map((group) => group.image).filter((image): image is NonNullable<ChannelGroupConfig["image"]> => Boolean(image));
    const protocols = Array.from(new Set(imageGroups.flatMap((image) => image.protocols ?? [])));
    if (imageGroups.some((image) => image.edits) && !protocols.includes("openaiImageEdits")) {
      protocols.push("openaiImageEdits");
    }
    const generationProtocols = protocols.filter((protocol) => IMAGE_PROTOCOL_OPTIONS.find((option) => option.id === protocol)?.generation);
    const defaultProtocol = imageGroups.find((image) => image.defaultProtocol)?.defaultProtocol ?? generationProtocols[0];
    const defaultModel = imageGroups.find((image) => image.defaultModel?.trim())?.defaultModel?.trim() ?? "";
    const modelPrices = imageGroups.flatMap((image) => image.modelPrices ?? []);
    const hasGenerations = imageGroups.some((image) => image.generations);
    const hasEdits = imageGroups.some((image) => image.edits);
    if (!hasGenerations && !hasEdits && !defaultModel && protocols.length === 0 && modelPrices.length === 0) {
      return undefined;
    }
    return {
      generations: hasGenerations,
      edits: hasEdits,
      defaultModel: defaultModel || undefined,
      protocols: protocols.length > 0 ? protocols : undefined,
      defaultProtocol,
      modelPrices: modelPrices.length > 0 ? modelPrices : undefined
    };
  };

  const saveChannel = async () => {
    if (!canManage || saving) {
      return;
    }
    if (!canSaveChannel) {
      const message = channelNameRequired
        ? t("settings.relay.channelNameRequired")
        : duplicateChannelName
          ? t("settings.relay.duplicateChannelName")
          : groups.length === 0
        ? t("settings.relay.groupRequired")
        : groupsMissingKeys.length > 0
          ? t("settings.relay.groupKeysMissing", { groups: groupsMissingKeys.map((group) => group.name).join(", ") })
          : !groupMappingsValid
            ? `${t("settings.relay.groupModelMappingHelp")} ${t("settings.relay.groupStatusCodeMappingHelp")}`
            : t("settings.relay.groupRequired");
      setSaveValidationError(message);
      if (channelNameRequired || duplicateChannelName) {
        channelNameInputRef.current?.focus();
        channelNameInputRef.current?.select();
      }
      if (groupsMissingKeys[0]) {
        setExpandedGroupIds((current) => ({ ...current, [groupsMissingKeys[0]!.id]: true }));
        setGroupEditorId(groupsMissingKeys[0].id);
      }
      return;
    }
    setSaveValidationError(null);
    const groupsForSave = materializeFetchedModelsForSave(groups, modelTargetGroup?.id, selectedFetchedModels);
    const normalizedGroups = groupsForSave.map((group, index) => ({
      ...group,
      kind: group.kind ?? "text",
      status: group.status ?? "enabled",
      quotaUsd: group.quotaUsd != null ? group.quotaUsd : undefined,
      usedQuotaUsd: group.usedQuotaUsd,
      priority: index + 1,
      weight: group.weight != null ? Math.max(0, group.weight) : undefined,
      keyMode: group.keyMode ?? "polling",
      models: group.catalogManaged ? group.models ?? [] : filterModelsForGroup(group.models ?? [], group.kind),
      image: group.kind === "image" ? group.image : undefined,
      modelMapping: parseGroupMapping(groupModelMappingDrafts[group.id] ?? formatGroupMapping(group.modelMapping)),
      statusCodeMapping: parseStatusCodeMapping(groupStatusCodeMappingDrafts[group.id] ?? formatStatusCodeMapping(group.statusCodeMapping)),
      advancedModelMapping: normalizeAdvancedModelMapping(group.advancedModelMapping),
      tag: group.tag?.trim() || undefined,
      remark: group.remark?.trim() || undefined,
      autoBan: group.autoBan ?? true,
      requestLimit: group.requestLimit != null ? Math.max(0, group.requestLimit) : undefined,
      requestIntervalSeconds: group.requestIntervalSeconds != null ? Math.max(0, group.requestIntervalSeconds) : undefined,
      contextWindow: group.contextWindow && group.contextWindow >= 1024 ? Math.round(group.contextWindow) : undefined,
      keys: (group.keys ?? []).map((key) => key.trim()).filter(Boolean),
      enableFallback: Boolean(group.enableFallback && group.fallbackGroupName),
      fallbackGroupName: group.enableFallback ? group.fallbackGroupName : undefined,
      enableTieredContext: undefined,
      tieredContextRatios: undefined
    }));
    const nativeModelList = Array.from(new Set(normalizedGroups.filter((group) => group.kind !== "image").flatMap((group) => group.models ?? [])));
    const defaultTextGroup = normalizedGroups.find((group) => group.kind !== "image") ?? normalizedGroups[0];
    const editingProvider = editingProviderDetails?.id === editingProviderId
      ? editingProviderDetails
      : editingProviderId
        ? providers.find((provider) => provider.id === editingProviderId) ?? relayListProviders.find((provider) => provider.id === editingProviderId)
        : undefined;
    const now = Date.now();
    setSaving(true);
    try {
      await onSaveProvider(
        {
          id: editingProvider?.id ?? "",
          kind: apiFormat,
          name: name.trim() || template.label,
          serviceProvider: {
            id: templateId,
            name: serviceProviderName.trim() || template.label,
            logo: serviceProviderLogo || undefined
          },
          baseUrl: baseUrl.trim() || undefined,
          apiKeyRef: editingProvider?.apiKeyRef,
          apiKeyPreview: editingProvider?.apiKeyPreview,
          apiKeyStorage: editingProvider?.apiKeyStorage,
          defaultModel: defaultTextGroup?.models?.[0] ?? nativeModelList[0] ?? editingProvider?.defaultModel ?? selectedModel,
          streamMaxRetries: clampRetryCount(streamMaxRetries),
          image: imageConfigFromForm(),
          nativeModels: nativeModelList,
          modelAliases: [],
          modelRates: undefined,
          capabilityCatalog: catalogPreview?.catalog ?? catalogDraft ?? editingProvider?.capabilityCatalog,
          capabilityCatalogUrl: catalogUrl.trim() || undefined,
          channelMode: "advanced",
          groups: normalizedGroups,
          quotaUsd: quotaUsd.trim() ? parseFloat(quotaUsd) : undefined,
          stationType,
          enableCheckin: stationType === "charity" ? enableCheckin : undefined,
          remindCheckin: stationType === "charity" ? remindCheckin : undefined,
          remark: remark.trim() || undefined,
          sharedImport: editingProvider?.sharedImport,
          createdAt: editingProvider?.createdAt ?? now,
          updatedAt: now
        },
        groupApiKey || undefined
      );
      setRelayView("list");
      setEditingProviderId(null);
      setEditingProviderDetails(null);
      clearFetchedModelsState();
      initialFormSnapshotRef.current = null;
      await refreshRelayList();
    } finally {
      setSaving(false);
    }
  };

  const quickChannelNameRequired = !quickChannelName.trim();
  const quickChannelValid = !quickChannelNameRequired
    && Boolean(quickChannelBaseUrl.trim())
    && Boolean(quickChannelApiKey.trim());
  const advancedGroupRatioNumber = Number(advancedGroupRatio);
  const advancedPriorityNumber = Number(advancedPriority);
  const advancedWeightNumber = Number(advancedWeight);
  const advancedSettingsValid = Boolean(advancedGroupName.trim())
    && Number.isFinite(advancedGroupRatioNumber)
    && advancedGroupRatioNumber >= 0
    && Number.isFinite(advancedPriorityNumber)
    && advancedPriorityNumber >= 0
    && Number.isInteger(advancedPriorityNumber)
    && Number.isFinite(advancedWeightNumber)
    && advancedWeightNumber >= 0
    && Number.isInteger(advancedWeightNumber)
    && isValidGroupMappingDraft(advancedModelMapping)
    && isValidStatusCodeMappingDraft(advancedStatusMapping);

  const fetchQuickChannelModels = async (connection: AdvancedRelayConnectionDraft = {
    name: quickChannelName,
    targetProviderId: quickTargetProviderId,
    serviceProviderId: quickServiceProviderId,
    serviceProviderName: quickServiceProviderName,
    baseUrl: quickChannelBaseUrl,
    apiKey: quickChannelApiKey,
    protocol: quickChannelProtocol
  }): Promise<string[]> => {
    if (!sessionToken) throw new Error(t("settings.relay.fetchModelsFailed"));
    const result = await fetchProviderModels(sessionToken, {
      baseUrl: connection.baseUrl.trim(),
      apiKey: connection.apiKey.trim(),
      kind: "responsesRelay",
      protocol: connection.protocol
    });
    const models = result.models.map((entry) => entry.id.trim()).filter(Boolean);
    if (models.length === 0) throw new Error(result.error || t("settings.relay.quickNoModels"));
    setQuickFetchedModels(models);
    return models;
  };

  const saveQuickChannel = async () => {
    if (!canManage || quickCreating) return;
    const connection = quickConnectionRef.current?.value() ?? {
      name: quickChannelName,
      targetProviderId: quickTargetProviderId,
      serviceProviderId: quickServiceProviderId,
      serviceProviderName: quickServiceProviderName,
      baseUrl: quickChannelBaseUrl,
      apiKey: quickChannelApiKey,
      protocol: quickChannelProtocol
    };
    if (!connection.name.trim() || !connection.baseUrl.trim() || !connection.apiKey.trim()) {
      setQuickCreateError(!connection.name.trim()
        ? t("settings.relay.channelNameRequired")
        : t("settings.relay.quickRequired"));
      return;
    }
    if (!sessionToken) {
      setQuickCreateError(t("settings.relay.fetchModelsFailed"));
      return;
    }
    setQuickCreating(true);
    setQuickCreateError(null);
    try {
      const manualModels = quickManualModels ? parseQuickManualModelsText(quickManualModelsText) : [];
      if (quickManualModels && manualModels.length === 0) {
        setQuickCreateError(t("settings.relay.quickManualModelsRequired"));
        return;
      }
      const models = quickManualModels ? manualModels : await fetchQuickChannelModels(connection);
      const now = Date.now();
      const group: ChannelGroupConfig = {
        ...defaultGroupTemplate("text", models),
        responseProtocol: connection.protocol,
        responseProtocolMode: "fixed",
        keys: [connection.apiKey.trim()],
        models,
        catalogManaged: false
      };
      const targetProvider = connection.targetProviderId
        ? providers.find((provider) => provider.id === connection.targetProviderId)
        : undefined;
      if (connection.targetProviderId && !targetProvider) {
        throw new Error(t("settings.relay.quickCreateFailed"));
      }
      await onSaveProvider({
        id: "",
        kind: "responsesRelay",
        name: targetProvider?.name ?? connection.name.trim(),
        serviceProvider: {
          id: targetProvider?.serviceProvider?.id ?? connection.serviceProviderId,
          name: targetProvider?.serviceProvider?.name ?? (connection.serviceProviderName.trim() || connection.serviceProviderId)
        },
        baseUrl: connection.baseUrl.trim(),
        defaultModel: models[0],
        nativeModels: models,
        modelAliases: [],
        groups: [group],
        channelMode: "advanced",
        stationType: "third_party",
        createdAt: now,
        updatedAt: now
      }, connection.apiKey.trim(), targetProvider?.id);
      setNewChannelDialogMode(null);
      setQuickFetchedModels([]);
      setQuickManualModels(false);
      setQuickManualModelsText("");
      setRelayView("list");
      await refreshRelayList();
    } catch (error) {
      setQuickCreateError(formatRelayErrorText(error) || t("settings.relay.quickCreateFailed"));
    } finally {
      setQuickCreating(false);
    }
  };

  const advanceAdvancedChannel = async () => {
    if (quickCreating) return;
    if (advancedStep !== 0) {
      if (!advancedSettingsValid) {
        setQuickCreateError(t("settings.relay.advancedValidationError"));
        return;
      }
      setQuickCreateError(null);
      setAdvancedStep((step) => Math.min(2, step + 1));
      return;
    }
    const connection = advancedConnectionRef.current?.value() ?? {
      name: quickChannelName,
      targetProviderId: advancedTargetProviderId,
      serviceProviderId: advancedServiceProviderId,
      serviceProviderName: advancedServiceProviderName,
      baseUrl: quickChannelBaseUrl,
      apiKey: quickChannelApiKey,
      protocol: quickChannelProtocol
    };
    if (!connection.name.trim() || !connection.baseUrl.trim() || !connection.apiKey.trim()) {
      setQuickCreateError(!connection.name.trim() ? t("settings.relay.channelNameRequired") : t("settings.relay.quickRequired"));
      return;
    }
    setQuickCreating(true);
    setQuickCreateError(null);
    try {
      await fetchQuickChannelModels(connection);
      setQuickChannelName(connection.name);
      setAdvancedTargetProviderId(connection.targetProviderId);
      setAdvancedServiceProviderId(connection.serviceProviderId as RelayTemplateId);
      setAdvancedServiceProviderName(connection.serviceProviderName);
      setQuickChannelBaseUrl(connection.baseUrl);
      setQuickChannelApiKey(connection.apiKey);
      setQuickChannelProtocol(connection.protocol);
      setAdvancedStep(1);
    } catch (error) {
      setQuickCreateError(formatRelayErrorText(error) || t("settings.relay.fetchModelsFailed"));
    } finally {
      setQuickCreating(false);
    }
  };

  const createAdvancedChannel = async () => {
    if (!quickChannelValid || !advancedSettingsValid || quickCreating || quickFetchedModels.length === 0) {
      if (!advancedSettingsValid) setQuickCreateError(t("settings.relay.advancedValidationError"));
      return;
    }
    setQuickCreating(true);
    setQuickCreateError(null);
    try {
      const now = Date.now();
      const group: ChannelGroupConfig = {
        ...defaultGroupTemplate("text", quickFetchedModels),
        id: advancedGroupName.trim() || "default",
        name: advancedGroupName.trim() || "default",
        groupRatio: advancedGroupRatioNumber,
        priority: advancedPriorityNumber,
        weight: advancedWeightNumber,
        responseProtocol: quickChannelProtocol,
        responseProtocolMode: "fixed",
        keys: [quickChannelApiKey.trim()],
        models: quickFetchedModels,
        modelMapping: parseGroupMapping(advancedModelMapping),
        statusCodeMapping: parseStatusCodeMapping(advancedStatusMapping),
        remark: advancedRemark.trim() || undefined,
        catalogManaged: false
      };
      const targetProvider = advancedTargetProviderId
        ? providers.find((provider) => provider.id === advancedTargetProviderId)
        : undefined;
      if (advancedTargetProviderId && !targetProvider) {
        throw new Error(t("settings.relay.advancedValidationError"));
      }
      await onSaveProvider({
        id: "",
        kind: "responsesRelay",
        name: targetProvider?.name ?? quickChannelName.trim(),
        serviceProvider: {
          id: targetProvider?.serviceProvider?.id ?? advancedServiceProviderId,
          name: targetProvider?.serviceProvider?.name ?? (advancedServiceProviderName.trim() || advancedServiceProviderId)
        },
        baseUrl: quickChannelBaseUrl.trim(),
        defaultModel: quickFetchedModels[0],
        nativeModels: quickFetchedModels,
        modelAliases: [],
        groups: [group],
        channelMode: "advanced",
        stationType: "third_party",
        createdAt: now,
        updatedAt: now
      }, quickChannelApiKey.trim(), targetProvider?.id);
      setNewChannelDialogMode(null);
      setRelayView("list");
      await refreshRelayList();
    } catch (error) {
      setQuickCreateError(formatRelayErrorText(error) || t("settings.relay.quickCreateFailed"));
    } finally {
      setQuickCreating(false);
    }
  };

  const activateChannel = async (provider: ProviderConfig, model?: string) => {
    const group = defaultTextGroup(provider);
    setBusyProviderId(provider.id);
    try {
      await onActivateProvider(provider.id, model || (group ? providerGroupTestModels(provider, group)[0] : provider.defaultModel), group?.id);
    } finally {
      setBusyProviderId(null);
    }
  };

  const injectCursorDesktop = async (provider: ProviderConfig) => {
    if (!CURSOR_INJECTION_ENABLED || !onInjectCursorDesktop) return;
    // Cursor local mode consumes native model ids directly, so no model
    // selection dialog is needed — just the relay's default text group.
    const group = provider.groups?.find((entry) => entry.kind !== "image" && entry.status !== "disabled")
      ?? provider.groups?.find((entry) => entry.kind !== "image");
    setBusyProviderId(provider.id);
    try {
      await onInjectCursorDesktop(provider.id, group?.id);
      setTestStatuses((current) => ({
        ...current,
        [provider.id]: { state: "passed", message: `Cursor 启动器已生成（${group?.name || group?.id || "默认分组"}）；双击 cursor-relay-launcher.cmd 以本地模式启动 Cursor` }
      }));
    } catch (error) {
      setTestStatuses((current) => ({ ...current, [provider.id]: { state: "failed", message: formatRelayErrorText(error) } }));
    } finally {
      setBusyProviderId(null);
    }
  };

  const openClaudeDesktopInjection = async (provider: ProviderConfig) => {
    setRelayDetailsLoading(provider.id);
    try {
      const details = sessionToken ? await fetchRelaySettings(sessionToken, provider.id) : provider;
      setClaudeInjectionProvider(details);
      setClaudeInjectionGroupId("");
      setClaudeInjectionModelsSelected([]);
      setClaudeInjectionModelMappings({});
    } catch (error) {
      setTestStatuses((current) => ({
        ...current,
        [provider.id]: { state: "failed", message: formatRelayErrorText(error) }
      }));
    } finally {
      setRelayDetailsLoading(null);
    }
  };

  const closeClaudeDesktopInjection = () => {
    if (claudeInjectionProvider && busyProviderId === claudeInjectionProvider.id) return;
    setClaudeInjectionProvider(null);
    setClaudeInjectionGroupId("");
    setClaudeInjectionModelsSelected([]);
    setClaudeInjectionModelMappings({});
  };

  const injectClaudeDesktop = async () => {
    if (!onInjectClaudeDesktop) return;
    const provider = claudeInjectionProvider;
    const group = provider?.groups?.find((entry) => entry.id === claudeInjectionGroupId);
    const nonClaudeModels = claudeInjectionModelsSelected.filter((model) => !CLAUDE_MODEL_PATTERN.test(stripModelContextVariant(model).baseModel));
    if (!provider || !group || claudeInjectionModelsSelected.length === 0 || nonClaudeModels.some((model) => !claudeInjectionModelMappings[model])) return;
    setBusyProviderId(provider.id);
    try {
      await onInjectClaudeDesktop(provider.id, group.id, claudeInjectionModelsSelected, claudeInjectionModelMappings);
      setTestStatuses((current) => ({
        ...current,
        [provider.id]: { state: "passed", message: `Claude \u914d\u7f6e\u5df2\u5199\u5165\uff1a${group.name || group.id}\uff0c${claudeInjectionModelsSelected.length} \u4e2a\u6a21\u578b\uff1b\u8bf7\u5b8c\u5168\u9000\u51fa\u5e76\u91cd\u542f Claude Desktop` }
      }));
      setClaudeInjectionProvider(null);
      setClaudeInjectionGroupId("");
      setClaudeInjectionModelsSelected([]);
      setClaudeInjectionModelMappings({});
    } catch (error) {
      setTestStatuses((current) => ({ ...current, [provider.id]: { state: "failed", message: formatRelayErrorText(error) } }));
    } finally {
      setBusyProviderId(null);
    }
  };

  const testChannel = async (provider: ProviderConfig, model?: string) => {
    const selected = provider.groups?.some((entry) => (entry.models?.length ?? 0) > 0)
      ? model || defaultProviderModel(provider)
      : undefined;
    const group = defaultTextGroup(provider);
    const protocol = group?.responseProtocol ?? (provider.kind === "responsesRelay" ? "openai-response" : "openai");
    setBusyProviderId(provider.id);
    setTestStatuses((current) => ({
      ...current,
      [provider.id]: {
        state: "passed",
        message: t("settings.relay.testingProtocol", { protocol })
      }
    }));
    try {
      if (!sessionToken) {
        throw new Error(t("settings.relay.testProtocolFailed", { protocol }));
      }
      const result = await testProvider(sessionToken, {
        baseUrl: provider.baseUrl ?? "",
        kind: provider.kind,
        providerId: provider.id,
        groupId: group?.id,
        protocol,
        model: selected
      });
      setTestStatuses((current) => ({
        ...current,
        [provider.id]: {
          state: result.ok ? "passed" : "failed",
          message: result.ok
            ? t("settings.relay.testProtocolPassed", {
                protocol,
                model: result.model ?? model ?? "-",
                ms: result.elapsedMs ?? 0
              })
            : result.message
        }
      }));
    } catch (error) {
      setTestStatuses((current) => ({
        ...current,
        [provider.id]: { state: "failed", message: formatRelayErrorText(error) }
      }));
    } finally {
      setBusyProviderId(null);
    }
  };

  const testChannelWithCodex = async (provider: ProviderConfig, model?: string) => {
    setBusyProviderId(provider.id);
    setTestStatuses((current) => ({
      ...current,
      [provider.id]: { state: "passed", message: t("settings.relay.startingCodexTest") }
    }));
    try {
      await onTestProviderWithCodex(provider.id, model || defaultProviderModel(provider));
    } catch (error) {
      setTestStatuses((current) => ({
        ...current,
        [provider.id]: { state: "failed", message: formatRelayErrorText(error) }
      }));
    } finally {
      setBusyProviderId(null);
    }
  };

  const formTitle = editingProvider ? t("settings.relay.editChannel") : t("settings.relay.addChannel");
  const selectionIncludesActive = selectedFetchedModels.some((model) => targetGroupModelList.includes(model));
  const claudeInjectionGroups = (claudeInjectionProvider?.groups ?? []).filter((group) => group.kind !== "image" && group.status !== "disabled");
  const claudeInjectionGroup = claudeInjectionGroups.find((group) => group.id === claudeInjectionGroupId);
  const claudeInjectionModels = claudeInjectionProvider && claudeInjectionGroup
    ? expandModelContextVariants(relayGroupSelectableModels(claudeInjectionProvider, claudeInjectionGroup))
    : [];
  const claudeInjectionNonClaudeModels = claudeInjectionModelsSelected.filter(
    (model) => !CLAUDE_MODEL_PATTERN.test(stripModelContextVariant(model).baseModel)
  );
  const claudeInjectionMappingsComplete = claudeInjectionNonClaudeModels.every(
    (model) => Boolean(claudeInjectionModelMappings[model])
  );

  return (
    <SettingsSection
      icon={<MemoryIcon fontSize="small" />}
      title={relayView === "form" ? t("settings.relay.modelChannel") : t("settings.relay.channels")}
      subtitle={relayView === "form" ? t("settings.relay.formSubtitle", { title: formTitle }) : t("settings.relay.channelsSubtitle")}
    >
      {!canManage ? (
        <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
          <Alert severity="info" variant="outlined">
            {t("settings.relay.memberReadOnly")}
          </Alert>
        </Box>
      ) : null}
      {relayView === "form" && canManage ? (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: showFetchedModelsPanel ? "210px minmax(0, 1fr) minmax(280px, 360px)" : "230px minmax(0, 1fr)"
          },
          minHeight: 430
        }}
      >
        <Box data-testid="relay-provider-picker" sx={{ borderRight: { lg: "1px solid" }, borderBottom: { xs: "1px solid", lg: 0 }, borderColor: "divider", bgcolor: "background.default" }}>
          <Box sx={{ px: 1.5, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
            <Stack spacing={1}>
              <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between">
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  {t("settings.relay.serviceProvider")}
                </Typography>
                {!editingProvider ? (
                  <Tooltip title={t("settings.relay.providerFilterHelp")}>
                    <IconButton size="small" aria-label={t("settings.relay.providerFilterHelp")}>
                      <HelpOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </Stack>
              {!editingProvider ? (
                <>
                  <TextField
                    size="small"
                    fullWidth
                    value={templateSearch}
                    onChange={(event) => setTemplateSearch(event.target.value)}
                    placeholder="Search providers"
                    inputProps={{ "aria-label": "Search service providers" }}
                    InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.75, color: "text.secondary" }} /> }}
                  />
                  <FormControl size="small" fullWidth>
                    <InputLabel>{t("settings.relay.stationType")}</InputLabel>
                    <Select
                      multiple
                      value={templateStationTypeFilters}
                      label={t("settings.relay.stationType")}
                      inputProps={{ "aria-label": t("settings.relay.stationType") }}
                      onChange={(event) => {
                        const value = event.target.value;
                        setTemplateStationTypeFilters(typeof value === "string" ? value.split(",") as StationType[] : value as StationType[]);
                      }}
                      renderValue={(selected) => selected.map((value) => t(`settings.relay.stationType.${value}` as TranslationKey)).join(", ")}
                    >
                      {(["third_party", "rich", "charity", "official"] as StationType[]).map((value) => (
                        <MenuItem key={value} value={value}>
                          <Checkbox size="small" checked={templateStationTypeFilters.includes(value)} />
                          <ListItemText primary={t(`settings.relay.stationType.${value}` as TranslationKey)} />
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </>
              ) : null}
            </Stack>
          </Box>
          <Stack spacing={1} sx={{ p: 1.25, maxHeight: { lg: "calc(100vh - 270px)" }, overflowY: "auto" }}>
            {visibleRelayProviderTemplates.map((entry) => {
              const selected = entry.id === templateId;
              const displayLabel = entry.id === "custom" && selected
                ? serviceProviderName.trim() || t("settings.relay.customProviderShort")
                : entry.id === "custom" ? t("settings.relay.customProviderShort") : entry.label;
              return (
                <Button
                  key={entry.id}
                  data-testid={`relay-provider-template-${entry.id}`}
                  color={selected ? "primary" : "inherit"}
                  variant={selected ? "outlined" : "text"}
                  onClick={editingProvider ? undefined : () => resetFormFromTemplate(entry)}
                  disableRipple={Boolean(editingProvider)}
                  startIcon={<Radio checked={selected} size="small" />}
                  sx={{
                    justifyContent: "flex-start",
                    borderColor: selected ? "primary.main" : "divider",
                    bgcolor: selected ? "action.selected" : "background.paper",
                    cursor: editingProvider ? "default" : "pointer",
                    py: 1.05,
                    gap: 0.5,
                    "& .MuiButton-startIcon": { mr: 0.5 }
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    {entry.id === "custom" && selected && serviceProviderLogo ? (
                      <Box component="img" src={serviceProviderLogo} alt="" sx={{ width: 20, height: 20, objectFit: "contain", flex: "0 0 auto" }} />
                    ) : entry.icon}
                    <Typography variant="body2" sx={{ fontWeight: selected ? 800 : 600 }}>
                      {displayLabel}
                    </Typography>
                  </Stack>
                </Button>
              );
            })}
          </Stack>
        </Box>

        <Box sx={{ p: { xs: 1.5, sm: 2 }, bgcolor: "background.paper" }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
              <Box>
                <Typography variant="h6" sx={{ fontSize: 20, fontWeight: 850, color: "primary.main" }}>
                  {formTitle}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {editingProvider ? t("settings.relay.editDescription") : t("settings.relay.addDescription")}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={activeProvider?.name ?? t("settings.relay.officialDefault")} color={activeProvider ? "primary" : "default"} />
                <Chip size="small" label={t("settings.relay.savedCount", { count: providers.length })} variant="outlined" />
              </Stack>
            </Stack>

            <Stack spacing={1.5}>
              {templateId === "custom" ? (
                <RelayFormRow label={t("settings.relay.customProvider")}>
                  <Stack spacing={1.25} sx={{ width: "100%" }}>
                    <TextField
                      size="small"
                      fullWidth
                      required
                      label={t("settings.relay.customProviderName")}
                      value={serviceProviderName}
                      onChange={(event) => setServiceProviderName(event.target.value)}
                      inputProps={{ "aria-label": t("settings.relay.customProviderName") }}
                    />
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      {serviceProviderLogo ? (
                        <Box
                          component="img"
                          data-testid="custom-provider-logo-preview"
                          src={serviceProviderLogo}
                          alt=""
                          sx={{ width: 40, height: 40, objectFit: "contain", border: "1px solid", borderColor: "divider", borderRadius: 1, p: 0.5 }}
                        />
                      ) : null}
                      <Button size="small" variant="outlined" component="label" startIcon={<UploadFileIcon />}>
                        {t("settings.relay.uploadProviderLogo")}
                        <input
                          hidden
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          aria-label={t("settings.relay.customProviderLogo")}
                          onChange={(event) => {
                            handleServiceProviderLogo(event.target.files?.[0]);
                            event.target.value = "";
                          }}
                        />
                      </Button>
                      {serviceProviderLogo ? (
                        <IconButton
                          size="small"
                          aria-label={t("settings.relay.removeProviderLogo")}
                          onClick={() => setServiceProviderLogo("")}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      ) : null}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {t("settings.relay.customProviderLogoHelp")}
                    </Typography>
                    {serviceProviderLogoError ? <Alert severity="error" variant="outlined">{serviceProviderLogoError}</Alert> : null}
                  </Stack>
                </RelayFormRow>
              ) : null}
              <RelayFormRow label={t("settings.relay.channelName")}>
                <TextField
                  size="small"
                  fullWidth
                  label={t("settings.relay.channelName")}
                  value={name}
                  inputRef={channelNameInputRef}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSaveValidationError(null);
                  }}
                  error={Boolean(channelNameError)}
                  helperText={channelNameError}
                  inputProps={{ "aria-label": t("settings.relay.channelName") }}
                />
              </RelayFormRow>
              <RelayFormRow label={t("settings.relay.baseUrl")}>
                <TextField size="small" fullWidth label={t("settings.relay.baseUrl")} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} inputProps={{ "aria-label": t("settings.relay.baseUrl") }} />
              </RelayFormRow>
              <RelayFormRow label={t("settings.relay.streamMaxRetries")}>
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  label={t("settings.relay.streamMaxRetries")}
                  value={streamMaxRetries}
                  onChange={(event) => setStreamMaxRetries(event.target.value)}
                  onBlur={() => setStreamMaxRetries(String(clampRetryCount(streamMaxRetries)))}
                  helperText={t("settings.relay.streamMaxRetriesHelp")}
                  inputProps={{ min: 5, max: 100, step: 1, "aria-label": t("settings.relay.streamMaxRetries") }}
                />
              </RelayFormRow>
              <RelayFormRow label={t("settings.relay.stationType")}>
                <Stack spacing={1.25} sx={{ width: "100%" }}>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={stationType}
                    onChange={(_, v) => v && setStationType(v as StationType)}
                    sx={{
                      flexWrap: "wrap",
                      gap: 0.5,
                      "& .MuiToggleButton-root": {
                        px: 1.75,
                        py: 0.75,
                        fontWeight: 800,
                        borderRadius: "999px !important",
                        border: "1px solid",
                        borderColor: "divider"
                      }
                    }}
                  >
                    <ToggleButton value="third_party">
                      {t("settings.relay.stationType.third_party")}
                    </ToggleButton>
                    <ToggleButton value="rich" sx={{ color: "#d97706 !important" }}>
                      {t("settings.relay.stationType.rich")}
                    </ToggleButton>
                    <ToggleButton value="charity" sx={{ color: "#16a34a !important" }}>
                      {t("settings.relay.stationType.charity")}
                    </ToggleButton>
                    <ToggleButton value="official" sx={{ color: "#2563eb !important" }}>
                      {t("settings.relay.stationType.official")}
                    </ToggleButton>
                  </ToggleButtonGroup>

                  {stationType === "rich" && (
                    <Alert severity="warning" variant="outlined" icon={<Box component="span" sx={{ fontSize: 18 }}>🪙</Box>} sx={{ borderRadius: 2 }}>
                      已设为【富可敌国】中转站！节点将带有专属金币 Icon 🪙 与尊贵标识。
                    </Alert>
                  )}

                  {stationType === "charity" && (
                    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(22,101,52,0.15)" : "rgba(240,253,244,0.9)", borderColor: "success.main" }}>
                      <Stack spacing={1}>
                        <Typography variant="body2" sx={{ fontWeight: 800, color: "success.main" }}>
                          💚 公益站专属扩展功能
                        </Typography>
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                          <FormControlLabel
                            control={
                              <Switch
                                size="small"
                                checked={enableCheckin}
                                onChange={(e) => setEnableCheckin(e.target.checked)}
                              />
                            }
                            label={t("settings.relay.enableCheckin")}
                          />
                          <FormControlLabel
                            control={
                              <Switch
                                size="small"
                                checked={remindCheckin}
                                onChange={(e) => setRemindCheckin(e.target.checked)}
                              />
                            }
                            label={t("settings.relay.remindCheckin")}
                          />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {t("settings.relay.charityNotice")}
                        </Typography>
                      </Stack>
                    </Paper>
                  )}
                </Stack>
              </RelayFormRow>
              <RelayFormRow label={t("settings.relay.quotaUsd")}>
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  inputProps={{ step: "0.01", min: 0 }}
                  label={t("settings.relay.quotaUsd")}
                  placeholder={t("settings.relay.quotaUsdPlaceholder")}
                  value={quotaUsd}
                  onChange={(event) => setQuotaUsd(event.target.value)}
                  helperText={t("settings.relay.quotaUsdHelp")}
                />
              </RelayFormRow>
              <RelayFormRow label={t("settings.relay.groups")}>
                  <Stack spacing={1.5} sx={{ width: "100%" }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        {t("settings.relay.groups")} ({addedGroups.length})
                      </Typography>
                      <Stack direction="row" spacing={1}>
                        <Button size="small" variant="outlined" component="label" startIcon={<UploadFileIcon />} disabled={catalogBusy}>
                          {t("settings.relay.importCatalog")}
                          <input
                            type="file"
                            accept="application/json,.json"
                            hidden
                            onChange={(event) => {
                              const file = event.currentTarget.files?.[0];
                              event.currentTarget.value = "";
                              if (file) void handleCatalogFile(file);
                            }}
                          />
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          color="primary"
                          startIcon={catalogBusy && !activeCatalog ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
                          onClick={openCatalogGroupBrowser}
                          sx={{ fontWeight: 800 }}
                        >
                          {t("settings.relay.addGroup")}
                        </Button>
                      </Stack>
                    </Stack>
                    <TextField
                      size="small"
                      fullWidth
                      label={t("settings.relay.catalogUrl")}
                      placeholder="https://relay.example/api/pricing"
                      value={catalogUrl}
                      onChange={(event) => {
                        setCatalogUrl(event.target.value);
                        setCatalogError(null);
                      }}
                      onBlur={() => void refreshCatalogUrl()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void refreshCatalogUrl();
                        }
                      }}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <Tooltip
                              arrow
                              title={(
                                <Box sx={{ maxWidth: 480 }}>
                                  <Typography variant="caption" component="div" sx={{ mb: 0.75 }}>
                                    {t("settings.relay.catalogUrlHelp")}
                                  </Typography>
                                  <Box component="pre" sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: "rgba(0,0,0,0.3)", whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.35 }}>
{`{
  "success": true,
  "data": [{
    "model_name": "gpt-5",
    "quota_type": 0,
    "enable_groups": ["codex"],
    "supported_endpoint_types": ["openai-response"]
  }],
  "group_ratio": { "codex": 1 },
  "usable_group": { "codex": "codex" },
  "auto_groups": [],
  "supported_endpoint": {},
  "vendors": []
}`}
                                  </Box>
                                </Box>
                              )}
                            >
                              <IconButton size="small" aria-label={t("settings.relay.catalogUrlHelpLabel")}>
                                <HelpOutlineIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={t("settings.relay.catalogRefresh")}>
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={!catalogUrl.trim() || catalogBusy}
                                  onClick={() => void refreshCatalogUrl()}
                                  aria-label={t("settings.relay.catalogRefresh")}
                                >
                                  {catalogBusy ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                                </IconButton>
                              </span>
                            </Tooltip>
                          </InputAdornment>
                        )
                      }}
                      helperText={t("settings.relay.catalogUrlHint")}
                    />
                    <Dialog
                      open={catalogGroupBrowserOpen}
                      onClose={() => setCatalogGroupBrowserOpen(false)}
                      fullWidth
                      maxWidth="lg"
                    >
                      <DialogTitle>{t("settings.relay.catalogBrowserTitle")}</DialogTitle>
                      <DialogContent dividers sx={{ p: { xs: 1, sm: 2 } }}>
                        {catalogBusy && !activeCatalog ? <LinearProgress sx={{ mb: 1.5 }} /> : null}
                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "250px minmax(0, 1fr)" }, gap: 1.5, alignItems: "start" }}>
                          <RelayCatalogTree
                            catalog={activeCatalog}
                            groups={catalogTemplateGroups}
                            selection={catalogTreeSelection}
                            onSelection={setCatalogTreeSelection}
                            t={t}
                          />
                          <RelayGroupExplorer
                            groups={displayedCatalogGroups}
                            total={treeFilteredCatalogGroups.length}
                            selectedId={null}
                            search={catalogGroupSearch}
                            status="all"
                            protocol={catalogGroupProtocol}
                            sort={catalogGroupSort}
                            view={catalogGroupView}
                            showStatusFilter={false}
                            t={t}
                            onSearch={setCatalogGroupSearch}
                            onStatus={() => undefined}
                            onProtocol={setCatalogGroupProtocol}
                            onSort={setCatalogGroupSort}
                            onView={setCatalogGroupView}
                            onSelect={addCatalogGroup}
                          />
                        </Box>
                      </DialogContent>
                      <DialogActions>
                        <Button onClick={() => setCatalogGroupBrowserOpen(false)}>{t("settings.relay.catalogCancel")}</Button>
                        <Button variant="outlined" startIcon={<AddIcon />} onClick={addCustomGroup}>
                          {t("settings.relay.addCustomGroup")}
                        </Button>
                      </DialogActions>
                    </Dialog>
                    {catalogMessage ? <Alert severity="success" variant="outlined">{catalogMessage}</Alert> : null}
                    {catalogError ? <Alert severity="error" variant="outlined">{catalogError}</Alert> : null}
                    {catalogPreview ? (
                      <Paper variant="outlined" sx={{ p: 1.5 }}>
                        <Stack spacing={1.25}>
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            <Chip size="small" label={t("settings.relay.catalogModels", { count: catalogPreview.counts.models })} />
                            <Chip size="small" label={t("settings.relay.catalogGroups", { count: catalogPreview.counts.groups })} />
                            <Chip size="small" label={t("settings.relay.catalogVendors", { count: catalogPreview.counts.vendors })} />
                            <Chip size="small" label={t("settings.relay.catalogEndpoints", { count: catalogPreview.counts.endpoints })} />
                            <Chip size="small" color="success" variant="outlined" label={`+${catalogPreview.changes.add}`} />
                            <Chip size="small" color="warning" variant="outlined" label={`~${catalogPreview.changes.update}`} />
                            <Chip size="small" color="error" variant="outlined" label={`-${catalogPreview.changes.remove}`} />
                          </Stack>
                          {catalogPreview.warnings.length > 0 ? (
                            <Alert severity="warning" variant="outlined">
                              {catalogPreview.warnings.slice(0, 4).join(" ")}
                              {catalogPreview.warnings.length > 4 ? ` (+${catalogPreview.warnings.length - 4})` : ""}
                            </Alert>
                          ) : null}
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button size="small" onClick={clearCatalogPreview} disabled={catalogBusy}>{t("settings.relay.catalogCancel")}</Button>
                            <Button size="small" variant="outlined" color="warning" onClick={() => void commitCatalogImport("replace")} disabled={catalogBusy}>
                              {t("settings.relay.catalogReplace")}
                            </Button>
                            <Button size="small" variant="contained" onClick={() => void commitCatalogImport("merge")} disabled={catalogBusy}>
                              {t("settings.relay.catalogMerge")}
                            </Button>
                          </Stack>
                        </Stack>
                      </Paper>
                    ) : null}
                    {!canSaveConfiguredGroups ? (
                      <Alert severity="warning" variant="outlined">
                        {groups.length === 0
                          ? t("settings.relay.groupRequired")
                          : t("settings.relay.groupKeysMissing", { groups: groupsMissingKeys.map((group) => group.name).join(", ") })}
                      </Alert>
                    ) : null}

                    {!useGroupExplorer ? (
                      <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={groupStatusFilter}
                        onChange={(_event, value) => value && setGroupStatusFilter(value as RelayGroupStatusFilter)}
                        aria-label={t("settings.relay.groupStatusFilter")}
                        sx={{ alignSelf: "flex-start", maxWidth: "100%", overflowX: "auto" }}
                      >
                        <ToggleButton value="available">{t("settings.relay.groupAvailable")}</ToggleButton>
                        <ToggleButton value="disabled">{t("settings.relay.groupStopped")}</ToggleButton>
                        <ToggleButton value="pending">{t("settings.relay.groupPending")}</ToggleButton>
                        <ToggleButton value="all">{t("settings.relay.filterAll")}</ToggleButton>
                      </ToggleButtonGroup>
                    ) : null}

                    {useGroupExplorer ? (
                      <RelayGroupExplorer
                        groups={displayedGroups}
                        total={addedGroups.length}
                        selectedId={selectedExplorerGroup?.id ?? null}
                        search={groupSearch}
                        status={groupStatusFilter}
                        protocol={groupProtocolFilter}
                        sort={groupSort}
                        view={groupView}
                        t={t}
                        onSearch={setGroupSearch}
                        onStatus={setGroupStatusFilter}
                        onProtocol={setGroupProtocolFilter}
                        onSort={setGroupSort}
                        onView={setGroupView}
                        onSelect={(group) => {
                          setGroupEditorId(group.id);
                          setModelTargetGroupId(group.id);
                          setExpandedGroupIds((current) => ({ ...current, [group.id]: true }));
                        }}
                      />
                    ) : null}

                    {!useGroupExplorer && displayedGroups.length === 0 ? (
                      <Alert severity="info" variant="outlined">{t("settings.relay.noGroupsForFilter")}</Alert>
                    ) : null}

                    {groupsToEdit.map((group) => {
                      const groupIdx = groups.findIndex((entry) => entry.id === group.id);
                      const keyText = groupKeyDrafts[group.id] ?? (group.keys || []).join("\n");
                      const groupExpanded = expandedGroupIds[group.id] ?? (groupIdx === 0 && hasConfiguredRelayGroupKey(group));
                      const groupKeysVisible = visibleGroupKeys[group.id] ?? (group.keys?.length ?? 0) === 0;
                      const maskedKeyText = (group.keys || []).map((key) => (key ? "*".repeat(Math.min(Math.max(key.length, 8), 32)) : "")).join("\n");
                      const keyCount = group.keys?.length ?? 0;
                      const incompatibleModels = incompatibleRelayGroupModels(group, activeCatalog);
                      const incompatibleModelSummary = incompatibleModels.length > 5
                        ? `${incompatibleModels.slice(0, 5).join(", ")} (+${incompatibleModels.length - 5})`
                        : incompatibleModels.join(", ");
                      return (
                        <Paper
                          key={group.id}
                          variant="outlined"
                          sx={{
                            p: 1.5,
                            borderRadius: 1,
                            borderColor: "divider",
                            bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(15,23,42,0.6)" : "rgba(248,250,252,0.9)")
                          }}
                        >
                          <Stack spacing={1.75}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                              <Button
                                size="small"
                                variant="text"
                                color="inherit"
                                startIcon={groupExpanded ? <KeyboardArrowDownIcon /> : <KeyboardArrowRightIcon />}
                                onClick={() => {
                                  if (!groupExpanded) setDraftGroupId(group.id);
                                  toggleGroupExpanded(group.id);
                                }}
                                aria-expanded={groupExpanded}
                                aria-label={t(groupExpanded ? "settings.relay.collapseGroup" : "settings.relay.expandGroup", { name: group.name })}
                                sx={{ justifyContent: "flex-start", flex: 1, minWidth: 0, textTransform: "none", px: 0.5 }}
                              >
                                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
                                  <Chip size="small" color="primary" label={t("settings.relay.groupNumber", { number: groupIdx + 1 })} sx={{ fontWeight: 800 }} />
                                  <Typography variant="subtitle1" sx={{ fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {group.name}
                                  </Typography>
                                  <Chip size="small" variant="outlined" label={t("settings.relay.groupRatioChip", { ratio: group.groupRatio })} />
                                  <Chip size="small" variant="outlined" label={t("settings.relay.groupWeightChip", { weight: group.weight ?? 0 })} />
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label={`${t("settings.relay.groupQuotaUsdShort")}: ${group.quotaUsd != null ? `$${group.quotaUsd}` : t("settings.relay.unlimitedQuota")}`}
                                  />
                                  <Chip size="small" variant="outlined" color={group.kind === "image" ? "success" : "info"} label={group.kind === "image" ? t("settings.relay.groupKindImage") : t("settings.relay.groupKindText")} />
                                  <Chip size="small" variant="outlined" label={group.responseProtocol ?? "openai-response"} />
                                  {group.catalogManaged ? <Chip size="small" color="secondary" variant="outlined" label={t("settings.relay.catalogManaged")} /> : null}
                                  <Chip
                                    size="small"
                                    color={group.status === "disabled" ? "default" : "success"}
                                    variant="outlined"
                                    label={t(group.status === "disabled" ? "settings.relay.groupDisabled" : "settings.relay.groupEnabled")}
                                  />
                                  {group.tag ? <Chip size="small" variant="outlined" label={group.tag} /> : null}
                                  <Chip size="small" variant="outlined" label={t("settings.relay.groupKeyCount", { count: keyCount })} />
                                </Stack>
                              </Button>
                              <Stack direction="row" spacing={0.5} alignItems="center">
                                <Tooltip title={t(group.status === "disabled" ? "settings.relay.groupDisabled" : "settings.relay.groupEnabled")}>
                                  <Switch
                                    size="small"
                                    checked={group.status !== "disabled"}
                                    inputProps={{ "aria-label": t("settings.relay.groupStatus") }}
                                    onChange={(event) => {
                                      const status = event.target.checked ? "enabled" : "disabled";
                                      setGroups((current) => current.map((entry) => entry.id === group.id ? { ...entry, status } : entry));
                                    }}
                                  />
                                </Tooltip>
                                {groups.length > 1 && (
                                  <IconButton
                                    size="small"
                                    color="error"
                                    aria-label={t("settings.relay.deleteGroup", { name: group.name })}
                                    onClick={() => {
                                      setGroups(groups
                                        .filter((entry) => entry.id !== group.id)
                                        .map((entry) => entry.fallbackGroupName === group.name ? { ...entry, enableFallback: false, fallbackGroupName: undefined } : entry));
                                      if (modelTargetGroupId === group.id) {
                                        setModelTargetGroupId(groups.find((entry) => entry.id !== group.id)?.id ?? "group-default");
                                      }
                                      if (groupEditorId === group.id) {
                                        setGroupEditorId(groups.find((entry) => entry.id !== group.id)?.id ?? "group-default");
                                      }
                                      if (draftGroupId === group.id) {
                                        setDraftGroupId(null);
                                      }
                                      setExpandedGroupIds((current) => {
                                        const { [group.id]: _removed, ...next } = current;
                                        return next;
                                      });
                                      setVisibleGroupKeys((current) => {
                                        const { [group.id]: _removed, ...next } = current;
                                        return next;
                                      });
                                    }}
                                  >
                                    <DeleteOutlineIcon fontSize="small" />
                                  </IconButton>
                                )}
                              </Stack>
                            </Stack>

                            {groupExpanded ? (
                              <>
                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                              <TextField
                                size="small"
                                fullWidth
                                type="number"
                                inputProps={{ step: 1024, min: 0 }}
                                label={t("settings.relay.groupContextWindow")}
                                value={group.contextWindow ?? ""}
                                onChange={(event) => {
                                  const value = event.target.value.trim();
                                  const parsed = value ? Math.max(0, Math.round(Number(value))) : undefined;
                                  setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, contextWindow: Number.isFinite(parsed ?? NaN) ? parsed : undefined } : entry));
                                }}
                                helperText={t("settings.relay.groupContextWindowHelp")}
                              />
                              <TextField
                                size="small"
                                fullWidth
                                label={t("settings.relay.groupName")}
                                value={group.name}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setGroups(groups.map((entry) => {
                                    if (entry.id === group.id) return { ...entry, name: val };
                                    return entry.fallbackGroupName === group.name ? { ...entry, fallbackGroupName: val } : entry;
                                  }));
                                }}
                                placeholder="default / vip / svip / fallback"
                              />
                              <TextField
                                size="small"
                                fullWidth
                                type="number"
                                inputProps={{ step: "0.01", min: 0 }}
                                label={t("settings.relay.groupRatio")}
                                value={group.groupRatio}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  const parsed = raw ? Number(raw) : 0;
                                  const val = Number.isFinite(parsed) ? Math.max(0, parsed) : group.groupRatio;
                                  setGroups(groups.map((g) => (g.id === group.id ? { ...g, groupRatio: val } : g)));
                                }}
                                helperText={t("settings.relay.groupRatioHelp")}
                              />
                              <TextField
                                size="small"
                                fullWidth
                                type="number"
                                inputProps={{ step: "0.01", min: 0 }}
                                label={t("settings.relay.groupQuotaUsd")}
                                value={group.quotaUsd ?? ""}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  const nextQuota = raw ? Math.max(0, Number(raw)) : null;
                                  setGroups(groups.map((g) => (g.id === group.id ? { ...g, quotaUsd: Number.isFinite(nextQuota ?? NaN) ? nextQuota : null } : g)));
                                }}
                                helperText={t("settings.relay.groupQuotaUsdHelp")}
                              />
                            </Stack>

                            <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                              <FormControl size="small" fullWidth>
                                <InputLabel>{t("settings.relay.responseProtocol")}</InputLabel>
                                <Select
                                  label={t("settings.relay.responseProtocol")}
                                  value={group.responseProtocol ?? "openai-response"}
                                  onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, responseProtocol: event.target.value as ChannelGroupConfig["responseProtocol"] } : entry))}
                                >
                                  <MenuItem value="openai-response">OpenAI Responses</MenuItem>
                                  <MenuItem value="openai">OpenAI Chat Completions</MenuItem>
                                  <MenuItem value="anthropic">Anthropic Messages</MenuItem>
                                  <MenuItem value="gemini">Gemini Native</MenuItem>
                                </Select>
                              </FormControl>
                              <FormControl size="small" fullWidth>
                                <InputLabel>{t("settings.relay.responseProtocolMode")}</InputLabel>
                                <Select
                                  label={t("settings.relay.responseProtocolMode")}
                                  value={group.responseProtocolMode ?? "fixed"}
                                  onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, responseProtocolMode: event.target.value as ChannelGroupConfig["responseProtocolMode"] } : entry))}
                                >
                                  <MenuItem value="fixed">{t("settings.relay.protocolFixed")}</MenuItem>
                                  <MenuItem value="model_auto">{t("settings.relay.protocolModelAuto")}</MenuItem>
                                </Select>
                              </FormControl>
                              <FormControl size="small" fullWidth>
                                <InputLabel>{t("settings.relay.credentialMode")}</InputLabel>
                                <Select
                                  label={t("settings.relay.credentialMode")}
                                  value={group.credentialMode ?? "group"}
                                  onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, credentialMode: event.target.value as ChannelGroupConfig["credentialMode"] } : entry))}
                                >
                                  <MenuItem value="provider">{t("settings.relay.credentialProvider")}</MenuItem>
                                  <MenuItem value="group">{t("settings.relay.credentialGroup")}</MenuItem>
                                </Select>
                              </FormControl>
                              <FormControl size="small" fullWidth>
                                <InputLabel>{t("settings.relay.authType")}</InputLabel>
                                <Select
                                  label={t("settings.relay.authType")}
                                  value={group.authType ?? "inherit"}
                                  onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, authType: event.target.value as ChannelGroupConfig["authType"] } : entry))}
                                >
                                  <MenuItem value="inherit">{t("settings.relay.authInherit")}</MenuItem>
                                  <MenuItem value="none">{t("settings.relay.authNone")}</MenuItem>
                                  <MenuItem value="bearer">Bearer</MenuItem>
                                  <MenuItem value="anthropic">Anthropic</MenuItem>
                                  <MenuItem value="google_api_key">Google API Key</MenuItem>
                                  <MenuItem value="google_query_key">Google Query Key</MenuItem>
                                </Select>
                              </FormControl>
                            </Stack>
                            {group.responseProtocol === "anthropic" ? (
                              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
                                <FormControlLabel
                                  control={<Switch
                                    size="small"
                                    checked={group.claudeCodeHeadersEnabled === true}
                                    onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id
                                      ? { ...entry, claudeCodeHeadersEnabled: event.target.checked, claudeCodeVersion: entry.claudeCodeVersion || DEFAULT_CLAUDE_CODE_VERSION }
                                      : entry))}
                                  />}
                                  label={t("settings.relay.claudeCodeHeaders")}
                                  sx={{ minWidth: { sm: 240 }, mr: 0 }}
                                />
                                <TextField
                                  size="small"
                                  fullWidth
                                  disabled={group.claudeCodeHeadersEnabled !== true}
                                  label={t("settings.relay.claudeCodeVersion")}
                                  value={group.claudeCodeVersion ?? DEFAULT_CLAUDE_CODE_VERSION}
                                  onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id
                                    ? { ...entry, claudeCodeVersion: event.target.value }
                                    : entry))}
                                  helperText={t("settings.relay.claudeCodeHeadersHelp")}
                                />
                              </Stack>
                            ) : null}
                            <TextField
                              size="small"
                              fullWidth
                              label={t("settings.relay.groupBaseUrlOverride")}
                              value={group.baseUrl ?? ""}
                              placeholder={baseUrl || "https://relay.example/v1"}
                              helperText={t("settings.relay.groupBaseUrlOverrideHelp")}
                              onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id
                                ? { ...entry, baseUrl: event.target.value.trim() || undefined }
                                : entry))}
                            />
                            <TextField
                              size="small"
                              fullWidth
                              label={t("settings.relay.endpointPathOverride")}
                              value={group.endpointPathOverride ?? ""}
                              placeholder="/v1/messages"
                              onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, endpointPathOverride: event.target.value || undefined } : entry))}
                            />
                            {(group.supportedEndpointTypes?.length ?? 0) > 0 ? (
                              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {group.supportedEndpointTypes?.map((endpoint) => <Chip key={endpoint} size="small" variant="outlined" label={endpoint} />)}
                              </Stack>
                            ) : null}
                            {incompatibleModels.length > 0 ? (
                              <Alert severity="warning" variant="outlined">
                                {t("settings.relay.incompatibleGroupModels", {
                                  protocol: group.responseProtocol ?? "openai-response",
                                  models: incompatibleModelSummary
                                })}
                              </Alert>
                            ) : null}

                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "flex-start" }}>
                              <TextField
                                size="small"
                                fullWidth
                                multiline
                                minRows={2}
                                maxRows={5}
                                label={t("settings.relay.keyPool")}
                                value={groupKeysVisible ? keyText : maskedKeyText}
                                onChange={(e) => {
                                  if (!groupKeysVisible) {
                                    return;
                                  }
                                  const draft = e.target.value;
                                  setGroupKeyDrafts((current) => ({ ...current, [group.id]: draft }));
                                  const lines = parseRelayGroupKeys(draft);
                                  setGroups(groups.map((g) => (g.id === group.id ? { ...g, keys: lines } : g)));
                                }}
                                placeholder="sk-key1&#10;sk-key2&#10;sk-key3"
                                InputProps={{ readOnly: !groupKeysVisible }}
                                helperText={group.keys?.length
                                  ? t(groupKeysVisible ? "settings.relay.keyPoolVisibleHelp" : "settings.relay.keyPoolHiddenHelp", { count: group.keys.length })
                                  : editingProvider?.apiKeyPreview && groupIdx === 0
                                    ? t("settings.relay.keyPoolSavedKeyHelp", { preview: "****" })
                                    : t("settings.relay.keyPoolEmptyHelp")}
                              />
                              <Tooltip title={groupKeysVisible ? t("settings.relay.hideGroupKeys") : t("settings.relay.showGroupKeys")}>
                                <IconButton
                                  size="small"
                                  aria-label={groupKeysVisible ? t("settings.relay.hideGroupKeys") : t("settings.relay.showGroupKeys")}
                                  onClick={() => toggleGroupKeysVisible(group.id)}
                                  sx={{ mt: { sm: 0.5 }, alignSelf: { xs: "flex-end", sm: "flex-start" } }}
                                >
                                  {groupKeysVisible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                                </IconButton>
                              </Tooltip>
                            </Stack>

                            <ToggleButtonGroup
                              exclusive
                              size="small"
                              value={group.kind ?? "text"}
                              onChange={(_, value) => {
                                if (!value) return;
                                setGroups(groups.map((entry) => (entry.id === group.id ? {
                                  ...entry,
                                  kind: value as "text" | "image",
                                  models: filterModelsForGroup(entry.models ?? [], value as ChannelGroupConfig["kind"]),
                                  image: value === "image" ? entry.image ?? defaultGroupImageConfig(template.image) : undefined
                                } : entry)));
                              }}
                            >
                              <ToggleButton value="text">{t("settings.relay.groupKindText")}</ToggleButton>
                              <ToggleButton value="image">{t("settings.relay.groupKindImage")}</ToggleButton>
                            </ToggleButtonGroup>

                            {(group.kind ?? "text") === "image" ? (
                              <Box component="details" sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, bgcolor: "background.default" }}>
                                <Box component="summary" sx={{ cursor: "pointer", fontWeight: 800, color: "text.secondary" }}>
                                  {t("settings.relay.imageGroupProtocols")}
                                </Box>
                                <Stack spacing={1.25} sx={{ mt: 1 }}>
                                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} flexWrap="wrap" useFlexGap>
                                    <FormControlLabel
                                      control={<Switch size="small" checked={group.image?.generations ?? true} onChange={(event) => updateGroupImage(group.id, (image) => ({ ...image, generations: event.target.checked }))} />}
                                      label={t("settings.relay.imageGenerationEnabled")}
                                      sx={{ mr: 0 }}
                                    />
                                    <FormControlLabel
                                      control={<Switch size="small" checked={Boolean(group.image?.edits)} onChange={(event) => updateGroupImage(group.id, (image) => {
                                        const current: ImageGenerationProtocol[] = image.protocols ?? [];
                                        const protocols: ImageGenerationProtocol[] = event.target.checked && !current.includes("openaiImageEdits")
                                          ? [...current, "openaiImageEdits"]
                                          : current.filter((entry) => entry !== "openaiImageEdits");
                                        return { ...image, edits: event.target.checked, protocols };
                                      })} />}
                                      label={t("settings.relay.imageEditsEnabled")}
                                      sx={{ mr: 0 }}
                                    />
                                  </Stack>
                                  <Stack direction={{ xs: "column", md: "row" }} spacing={1.25}>
                                    <TextField
                                      size="small"
                                      fullWidth
                                      label={t("settings.relay.defaultImageModel")}
                                      value={group.image?.defaultModel ?? ""}
                                      onChange={(event) => updateGroupImage(group.id, (image) => ({ ...image, defaultModel: event.target.value }))}
                                      placeholder="gpt-image-2-1k / gpt-image-2-2k / gpt-image-2-4k"
                                      inputProps={{ "aria-label": t("settings.relay.defaultImageModel") }}
                                    />
                                    <FormControl size="small" fullWidth>
                                      <InputLabel>{t("settings.relay.defaultImageProtocol")}</InputLabel>
                                      <Select
                                        value={group.image?.defaultProtocol ?? ""}
                                        label={t("settings.relay.defaultImageProtocol")}
                                        inputProps={{ "aria-label": t("settings.relay.defaultImageProtocol") }}
                                        onChange={(event) => updateGroupImage(group.id, (image) => ({ ...image, defaultProtocol: event.target.value as ImageGenerationProtocol | undefined }))}
                                      >
                                        <MenuItem value="">{t("settings.relay.autoByModel")}</MenuItem>
                                        {IMAGE_PROTOCOL_OPTIONS.filter((option) => option.generation).map((option) => (
                                          <MenuItem key={option.id} value={option.id} disabled={(group.image?.protocols?.length ?? 0) > 0 && !group.image?.protocols?.includes(option.id)}>
                                            {option.label}
                                          </MenuItem>
                                        ))}
                                      </Select>
                                    </FormControl>
                                  </Stack>
                                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 0.75 }}>
                                    {IMAGE_PROTOCOL_OPTIONS.map((option) => (
                                      <Box
                                        key={option.id}
                                        sx={{
                                          border: "1px solid",
                                          borderColor: group.image?.protocols?.includes(option.id) ? "primary.main" : "divider",
                                          borderRadius: 1,
                                          px: 1,
                                          py: 0.75,
                                          bgcolor: group.image?.protocols?.includes(option.id) ? "action.selected" : "background.paper"
                                        }}
                                      >
                                        <FormControlLabel
                                          control={<Checkbox size="small" checked={Boolean(group.image?.protocols?.includes(option.id))} onChange={() => toggleGroupImageProtocol(group.id, option.id)} />}
                                          label={
                                            <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                                              <Typography variant="body2" sx={{ fontWeight: 800 }}>
                                                {option.label}
                                              </Typography>
                                              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                                                {option.description}
                                              </Typography>
                                            </Stack>
                                          }
                                          sx={{ alignItems: "flex-start", mr: 0, width: "100%" }}
                                        />
                                      </Box>
                                    ))}
                                  </Box>
                                  <TextField
                                    size="small"
                                    fullWidth
                                    multiline
                                    minRows={3}
                                    label={t("settings.relay.imageModelPrices")}
                                    value={formatImageModelPrices(group.image?.modelPrices)}
                                    onChange={(event) => updateGroupImage(group.id, (image) => ({ ...image, modelPrices: parseImageModelPrices(event.target.value) }))}
                                    helperText={t("settings.relay.imageModelPricesHelp")}
                                    placeholder="gpt-image-2-1k=0.02&#10;gpt-image-2-2k=0.04&#10;gpt-image-2-4k=0.08"
                                  />
                                  <Typography variant="caption" color="text.secondary">
                                    {t("settings.relay.imageSlashCommandHelp")}
                                  </Typography>
                                </Stack>
                              </Box>
                            ) : null}

                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                              <FormControl size="small" fullWidth>
                                <InputLabel>{t("settings.relay.groupStatus")}</InputLabel>
                                <Select
                                  label={t("settings.relay.groupStatus")}
                                  value={group.status ?? "enabled"}
                                  onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, status: event.target.value as "enabled" | "disabled" } : entry))}
                                >
                                  <MenuItem value="enabled">{t("settings.relay.groupEnabled")}</MenuItem>
                                  <MenuItem value="disabled">{t("settings.relay.groupDisabled")}</MenuItem>
                                </Select>
                              </FormControl>
                              <TextField
                                size="small"
                                fullWidth
                                type="number"
                                inputProps={{ step: "0.01", min: 0 }}
                                label={t("settings.relay.groupWeight")}
                                value={group.weight ?? ""}
                                onChange={(event) => {
                                  const value = event.target.value.trim();
                                  const parsed = value ? Math.max(0, Number(value)) : undefined;
                                  setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, weight: Number.isFinite(parsed ?? NaN) ? parsed : undefined } : entry));
                                }}
                                helperText={t("settings.relay.groupWeightHelp")}
                              />
                              <FormControl size="small" fullWidth>
                                <InputLabel>{t("settings.relay.groupKeyMode")}</InputLabel>
                                <Select
                                  label={t("settings.relay.groupKeyMode")}
                                  value={group.keyMode ?? "polling"}
                                  onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, keyMode: event.target.value as ChannelGroupConfig["keyMode"] } : entry))}
                                >
                                  <MenuItem value="single">{t("settings.relay.groupKeyModeSingle")}</MenuItem>
                                  <MenuItem value="random">{t("settings.relay.groupKeyModeRandom")}</MenuItem>
                                  <MenuItem value="polling">{t("settings.relay.groupKeyModePolling")}</MenuItem>
                                </Select>
                              </FormControl>
                            </Stack>

                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                              <Stack spacing={1} sx={{ width: "100%" }}>
                                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
                                  <TextField
                                    size="small"
                                    fullWidth
                                    label={t("settings.relay.groupModels")}
                                    value={(group.models ?? []).join(", ")}
                                    onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, models: parseCsvForGroup(event.target.value, entry.kind) } : entry))}
                                    helperText={t("settings.relay.groupModelsHelp")}
                                  />
                                  <Button
                                    variant="outlined"
                                    startIcon={fetchingModels && modelTargetGroup?.id === group.id ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                                    onClick={() => void handleFetchModels(group.id)}
                                    disabled={!canFetchModelsForGroup(group) || fetchingModels || !sessionToken}
                                    sx={{ whiteSpace: "nowrap", minWidth: { sm: 148 } }}
                                  >
                                    {t("settings.relay.fetchModels")}
                                  </Button>
                                </Stack>
                                <Typography variant="caption" color="text.secondary">
                                  {t("settings.relay.groupModelsTargetHelp")}
                                </Typography>
                                {modelTargetGroup?.id === group.id && fetchModelsMessage ? (
                                  <Alert severity="success" variant="outlined" onClose={() => setFetchModelsMessage(null)}>
                                    {fetchModelsMessage}
                                  </Alert>
                                ) : null}
                                {modelTargetGroup?.id === group.id && fetchModelsError ? (
                                  <Alert severity="error" variant="outlined" onClose={() => setFetchModelsError(null)}>
                                    {fetchModelsError}
                                  </Alert>
                                ) : null}
                                {(group.models?.length ?? 0) > 0 ? (
                                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                    {(group.models ?? []).slice(0, 12).map((model) => (
                                      <Chip
                                        key={model}
                                        size="small"
                                        label={model}
                                        onDelete={() => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, models: (entry.models ?? []).filter((candidate) => candidate !== model) } : entry))}
                                        sx={{ maxWidth: 220, borderRadius: 1 }}
                                      />
                                    ))}
                                    {(group.models?.length ?? 0) > 12 ? <Chip size="small" variant="outlined" label={t("settings.relay.moreModels", { count: (group.models?.length ?? 0) - 12 })} /> : null}
                                  </Stack>
                                ) : null}
                              </Stack>
                              <TextField
                                size="small"
                                fullWidth
                                label={t("settings.relay.groupTag")}
                                value={group.tag ?? ""}
                                onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, tag: event.target.value } : entry))}
                                placeholder="vip / image / fallback"
                              />
                            </Stack>

                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                              <TextField
                                size="small"
                                fullWidth
                                multiline
                                minRows={2}
                                label={t("settings.relay.groupModelMapping")}
                                value={groupModelMappingDrafts[group.id] ?? formatGroupMapping(group.modelMapping)}
                                onChange={(event) => setGroupModelMappingDrafts((current) => ({ ...current, [group.id]: event.target.value }))}
                                error={!isValidGroupMappingDraft(groupModelMappingDrafts[group.id] ?? formatGroupMapping(group.modelMapping))}
                                helperText={t("settings.relay.groupModelMappingHelp")}
                                placeholder="gpt-5=gpt-5-chat-latest"
                              />
                              <TextField
                                size="small"
                                fullWidth
                                multiline
                                minRows={2}
                                label={t("settings.relay.groupStatusCodeMapping")}
                                value={groupStatusCodeMappingDrafts[group.id] ?? formatStatusCodeMapping(group.statusCodeMapping)}
                                onChange={(event) => setGroupStatusCodeMappingDrafts((current) => ({ ...current, [group.id]: event.target.value }))}
                                error={!isValidStatusCodeMappingDraft(groupStatusCodeMappingDrafts[group.id] ?? formatStatusCodeMapping(group.statusCodeMapping))}
                                helperText={t("settings.relay.groupStatusCodeMappingHelp")}
                                placeholder="429=503"
                              />
                            </Stack>

                            <AdvancedModelMappingEditor
                              group={group}
                              providers={providers}
                              open={groupAdvancedMappingOpen[group.id] === true}
                              onToggleOpen={() => setGroupAdvancedMappingOpen((current) => ({ ...current, [group.id]: !(current[group.id] === true) }))}
                              onChange={(nextRules) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, advancedModelMapping: nextRules } : entry))}
                              t={t}
                            />

                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                              <TextField
                                size="small"
                                fullWidth
                                type="number"
                                inputProps={{ step: "0.01", min: 0 }}
                                label={t("settings.relay.groupRequestLimit")}
                                value={group.requestLimit ?? ""}
                                onChange={(event) => {
                                  const value = event.target.value.trim();
                                  const parsed = value ? Math.max(0, Number(value)) : undefined;
                                  setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, requestLimit: Number.isFinite(parsed ?? NaN) ? parsed : undefined } : entry));
                                }}
                              />
                              <TextField
                                size="small"
                                fullWidth
                                type="number"
                                inputProps={{ step: "0.01", min: 0 }}
                                label={t("settings.relay.groupRequestIntervalSeconds")}
                                value={group.requestIntervalSeconds ?? ""}
                                onChange={(event) => {
                                  const value = event.target.value.trim();
                                  const parsed = value ? Math.max(0, Number(value)) : undefined;
                                  setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, requestIntervalSeconds: Number.isFinite(parsed ?? NaN) ? parsed : undefined } : entry));
                                }}
                              />
                              <FormControlLabel
                                control={
                                  <Switch
                                    size="small"
                                    checked={group.autoBan ?? true}
                                    onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, autoBan: event.target.checked } : entry))}
                                  />
                                }
                                label={t("settings.relay.groupAutoBan")}
                                sx={{ minWidth: 180 }}
                              />
                            </Stack>

                            <TextField
                              size="small"
                              fullWidth
                              multiline
                              minRows={2}
                              maxRows={4}
                              label={t("settings.relay.groupRemark")}
                              value={group.remark ?? ""}
                              onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, remark: event.target.value } : entry))}
                              placeholder={t("settings.relay.groupRemarkPlaceholder")}
                            />

                            <Box>
                              <Stack spacing={1}>
                                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} justifyContent="space-between">
                                  <FormControlLabel
                                    control={
                                      <Switch
                                        size="small"
                                        checked={Boolean(group.enableFallback)}
                                        disabled={groups.length < 2}
                                        onChange={(e) => {
                                          const checked = e.target.checked;
                                          const fallback = groups.find((entry) => entry.id !== group.id)?.name;
                                          setGroups(groups.map((entry) => entry.id === group.id ? {
                                            ...entry,
                                            enableFallback: checked,
                                            fallbackGroupName: checked ? entry.fallbackGroupName ?? fallback : undefined
                                          } : entry));
                                        }}
                                      />
                                    }
                                    label={t("settings.relay.enableFallback")}
                                  />
                                  <FormControl size="small" sx={{ minWidth: 220 }} disabled={!group.enableFallback}>
                                    <InputLabel>{t("settings.relay.fallbackGroup")}</InputLabel>
                                    <Select
                                      label={t("settings.relay.fallbackGroup")}
                                      value={group.fallbackGroupName ?? ""}
                                      inputProps={{ "aria-label": t("settings.relay.fallbackGroupFor", { name: group.name }) }}
                                      onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, fallbackGroupName: event.target.value || undefined } : entry))}
                                    >
                                      <MenuItem value="">{t("settings.relay.fallbackGroupNone")}</MenuItem>
                                      {groups.filter((entry) => entry.id !== group.id).map((entry) => (
                                        <MenuItem key={entry.id} value={entry.name}>{entry.name}</MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                </Stack>
                              </Stack>
                            </Box>

                            <Box component="details" sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, bgcolor: "background.default" }}>
                              <Box component="summary" sx={{ cursor: "pointer", listStyle: "none" }}>
                                <Stack direction="row" spacing={0.5} alignItems="center">
                                  <SecurityIcon fontSize="small" color={group.commandBlacklistEnabled === false ? "warning" : "inherit"} />
                                  <Typography variant="body2" sx={{ fontWeight: 800 }}>{t("settings.relay.commandBlacklist")}</Typography>
                                  <Tooltip title={t("settings.relay.commandBlacklistHelp")}>
                                    <HelpOutlineIcon fontSize="small" color="action" />
                                  </Tooltip>
                                </Stack>
                              </Box>
                              <Stack spacing={1} sx={{ mt: 1 }}>
                                <FormControlLabel
                                  control={<Switch
                                    size="small"
                                    checked={group.commandBlacklistEnabled !== false}
                                    onChange={(event) => {
                                      if (!event.target.checked && !window.confirm(t("settings.relay.commandBlacklistDisableConfirm"))) return;
                                      setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, commandBlacklistEnabled: event.target.checked } : entry));
                                    }}
                                    inputProps={{ "aria-label": t("settings.relay.commandBlacklist") }}
                                  />}
                                  label={t("settings.relay.commandBlacklist")}
                                />
                                {group.commandBlacklistEnabled === false ? (
                                  <Alert severity="warning" variant="outlined" icon={<WarningAmberIcon fontSize="small" />}>
                                    {t("settings.relay.commandBlacklistDisabledWarning")}
                                  </Alert>
                                ) : null}
                                <TextField size="small" fullWidth multiline minRows={2} label={t("settings.relay.commandBlacklistCustom")}
                                  value={(group.commandBlacklist ?? []).join("\n")}
                                  onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, commandBlacklist: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) } : entry))}
                                  helperText={t("settings.relay.commandBlacklistCustomHelp")} />
                                <TextField size="small" fullWidth multiline minRows={2} label={t("settings.relay.networkAllowlist")}
                                  value={(group.networkAllowlist ?? []).join("\n")}
                                  onChange={(event) => setGroups(groups.map((entry) => entry.id === group.id ? { ...entry, networkAllowlist: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) } : entry))}
                                  helperText={t("settings.relay.networkAllowlistHelp")} />
                              </Stack>
                            </Box>

                              </>
                            ) : null}

                          </Stack>
                        </Paper>
                      );
                    })}
                  </Stack>
              </RelayFormRow>
              <RelayFormRow label={t("settings.relay.remark")}>
                <TextField
                  size="small"
                  fullWidth
                  multiline
                  minRows={2}
                  label={t("settings.relay.remark")}
                  placeholder={t("settings.relay.remarkPlaceholder")}
                  value={remark}
                  onChange={(event) => setRemark(event.target.value)}
                  helperText={t("settings.relay.remarkHelp")}
                  inputProps={{ "aria-label": t("settings.relay.remark") }}
                />
              </RelayFormRow>
              <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ pt: 0.5 }}>
                {saveValidationError ? (
                  <Alert severity="error" variant="outlined" onClose={() => setSaveValidationError(null)} sx={{ flex: 1 }}>
                    {saveValidationError}
                  </Alert>
                ) : null}
                <Button
                  variant="outlined"
                  onClick={() => {
                    if (hasUnsavedChanges) {
                      setUnsavedChangesDialogOpen(true);
                    } else {
                      setRelayView("list");
                      clearFetchedModelsState();
                    }
                  }}
                >
                  {t("settings.relay.backToChannels")}
                </Button>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      if (editingProvider) {
                        void startEditChannel(editingProvider);
                      } else {
                        resetFormFromTemplate(template);
                      }
                    }}
                    disabled={saving}
                  >
                    {t("settings.relay.reset")}
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                    onClick={() => {
                      if (!canSaveChannel) {
                        void saveChannel();
                        return;
                      }
                      setSaveValidationError(null);
                      setRiskAcknowledged(false);
                      setRiskConfirmationOpen(true);
                    }}
                    disabled={saving}
                  >
                    {editingProvider ? t("settings.relay.save") : t("settings.relay.create")}
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          </Stack>
        </Box>

        {showFetchedModelsPanel ? (
          <Box
            sx={{
              borderLeft: { lg: "1px solid" },
              borderTop: { xs: "1px solid", lg: 0 },
              borderColor: "divider",
              bgcolor: "background.default",
              p: 1.5,
              display: "flex",
              flexDirection: "column",
              minHeight: 360,
              maxHeight: { lg: 640 }
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                {t("settings.relay.fetchedModels")}
              </Typography>
              <IconButton size="small" aria-label={t("settings.relay.closeFetchedPanel")} onClick={() => clearFetchedModelsState()}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
            <TextField
              size="small"
              fullWidth
              placeholder={t("settings.relay.fetchedModelsSearch")}
              value={fetchedModelsSearch}
              onChange={(event) => {
                setFetchedModelsSearch(event.target.value);
                setFetchedModelsPage(0);
              }}
              InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.75, color: "text.secondary" }} /> }}
              sx={{ mb: 1 }}
            />
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
              <FormControlLabel
                control={<Checkbox size="small" checked={showNotAddedModelsOnly} onChange={(event) => {
                  setShowNotAddedModelsOnly(event.target.checked);
                  setFetchedModelsPage(0);
                }} />}
                label={<Typography variant="caption">{t("settings.relay.showNotAddedOnly")}</Typography>}
                sx={{ mr: 0 }}
              />
              <Stack direction="row" spacing={0.5}>
                <Button size="small" variant="outlined" onClick={selectAllFilteredModels} disabled={filteredFetchedModels.length === 0}>
                  {t("settings.relay.selectAll")}
                </Button>
                <Button size="small" variant="outlined" onClick={deselectAllFetchedModels} disabled={selectedFetchedModels.length === 0}>
                  {t("settings.relay.deselectAll")}
                </Button>
              </Stack>
            </Stack>
            <Box sx={{ flex: 1, overflow: "auto", minHeight: 180, pr: 0.5 }}>
              {filteredFetchedModels.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                  {fetchedModels.length === 0 ? t("settings.relay.noModelsFetched") : t("settings.relay.noChannels")}
                </Typography>
              ) : (
                <Stack spacing={0.5}>
                  {visibleFetchedModels.map((model) => {
                    const isAdded = targetGroupModelSet.has(model);
                    const isSelected = selectedFetchedModelSet.has(model);
                    return (
                      <Box
                        key={model}
                        onClick={() => toggleFetchedModelSelection(model)}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          px: 1,
                          py: 0.75,
                          borderRadius: 1,
                          cursor: "pointer",
                          border: "1px solid",
                          borderColor: isSelected ? "primary.main" : "divider",
                          bgcolor: isSelected ? "action.selected" : isAdded ? "action.hover" : "background.paper"
                        }}
                      >
                        <Checkbox size="small" checked={isSelected} tabIndex={-1} disableRipple />
                        <Tooltip title={model}>
                          <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "JetBrains Mono, monospace" }}>
                            {model}
                          </Typography>
                        </Tooltip>
                        {isAdded && !isSelected ? <Chip size="small" label={t("settings.relay.alreadyAdded")} sx={{ height: 20 }} /> : null}
                        {isAdded && isSelected ? <Chip size="small" color="error" label={t("settings.relay.willRemove")} sx={{ height: 20 }} /> : null}
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </Box>
            {filteredFetchedModels.length > FETCHED_MODELS_PAGE_SIZE ? (
              <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.75} sx={{ pt: 1 }}>
                <IconButton
                  size="small"
                  aria-label="Previous model page"
                  disabled={safeFetchedModelsPage === 0}
                  onClick={() => setFetchedModelsPage((page) => Math.max(0, page - 1))}
                >
                  <ChevronLeftIcon fontSize="small" />
                </IconButton>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 92, textAlign: "center" }}>
                  {`${safeFetchedModelsPage + 1} / ${fetchedModelsPageCount} · ${filteredFetchedModels.length}`}
                </Typography>
                <IconButton
                  size="small"
                  aria-label="Next model page"
                  disabled={safeFetchedModelsPage >= fetchedModelsPageCount - 1}
                  onClick={() => setFetchedModelsPage((page) => Math.min(fetchedModelsPageCount - 1, page + 1))}
                >
                  <ChevronRightIcon fontSize="small" />
                </IconButton>
              </Stack>
            ) : null}
            <Stack spacing={1} sx={{ pt: 1, borderTop: "1px solid", borderColor: "divider", mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {t("settings.relay.selectedCount", { count: selectedFetchedModels.length })}
                {selectionIncludesActive ? ` · ${t("settings.relay.removeSelectedFromActive")}` : ""}
              </Typography>
              <Button variant="contained" size="small" onClick={applySelectedFetchedModels} disabled={selectedFetchedModels.length === 0}>
                {selectionIncludesActive
                  ? t("settings.relay.confirmSelection")
                  : t("settings.relay.addSelected", { count: selectedFetchedModels.length })}
              </Button>
            </Stack>
          </Box>
        ) : null}
      </Box>
      ) : null}

      {relayView === "list" ? (
      <Box sx={{ bgcolor: "background.default", p: { xs: 1.25, sm: 2 } }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ xs: "stretch", md: "flex-end" }} justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h4" sx={{ fontWeight: 900, fontSize: { xs: 28, sm: 36 }, lineHeight: 1.1 }}>
                {t("settings.relay.channels")}
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mt: 0.75, maxWidth: 720 }}>
                {t("settings.relay.channelsSubtitle")}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={{ xs: "flex-start", md: "flex-end" }}>
              {canManage ? (
                <>
                  <Button size="small" variant="contained" startIcon={<AddIcon />} sx={{ borderRadius: 999 }} onClick={startAddChannel}>
                    {t("settings.relay.addChannel")}
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<DownloadIcon />} sx={{ borderRadius: 999 }} disabled={relayBackupBusy} onClick={() => void exportRelayBackupFile()}>
                    导出中转站
                  </Button>
                  <Button size="small" variant="outlined" component="label" startIcon={<UploadFileIcon />} sx={{ borderRadius: 999 }} disabled={relayBackupBusy}>
                    导入中转站
                    <input
                      hidden
                      type="file"
                      accept="application/json,.json"
                      aria-label="导入中转站"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void importRelayBackupFile(file);
                      }}
                    />
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<UploadFileIcon />} sx={{ borderRadius: 999 }} onClick={onImportSharedRelay}>
                    导入分享
                  </Button>
                  <Tooltip title="垃圾桶">
                    <IconButton size="small" aria-label="垃圾桶" onClick={openTrashDialog}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t("settings.relay.omniRouteFreeWarning")}>
                    <span>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<RefreshIcon />}
                        sx={{ borderRadius: 999 }}
                        onClick={onRequestOmniRouteFreeSync}
                      >
                        {t("settings.relay.omniRouteFreeSync")}
                      </Button>
                    </span>
                  </Tooltip>
                </>
              ) : (
                <Chip size="small" label={t("settings.relay.viewOnly")} color="default" variant="outlined" sx={{ borderRadius: 999, fontWeight: 700 }} />
              )}
            </Stack>
          </Stack>

          <Stack spacing={1.5}>
            {canManage && FREE_OLLAMA_ENABLED ? (
              <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }} data-testid="free-ollama-toggle-card">
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between">
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{t("settings.relay.freeOllama")}</Typography>
                    <Typography variant="body2" color="text.secondary">{t("settings.relay.freeOllamaDisabledDescription")}</Typography>
                  </Box>
                  <Switch
                    checked={freeOllamaEnabled}
                    onChange={(event) => requestFreeOllamaEnabledChange(event.target.checked)}
                    inputProps={{ "aria-label": t("settings.relay.freeOllama") }}
                  />
                </Stack>
                {freeOllamaEnabled ? (
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between" sx={{ mt: 1.25, pt: 1.25, borderTop: "1px solid", borderColor: "divider" }}>
                    <Typography variant="body2" color="warning.main">{t("settings.relay.freeOllamaWarning")}</Typography>
                    <Button variant="contained" size="small" startIcon={freeOllamaBusy ? <CircularProgress size={15} color="inherit" /> : <RefreshIcon />} onClick={() => void syncFreeOllamaNow()} disabled={freeOllamaBusy}>
                      {freeOllamaBusy ? t("settings.relay.freeOllamaSyncing") : t("settings.relay.freeOllamaSync")}
                    </Button>
                  </Stack>
                ) : null}
                {freeOllamaMessage ? <Alert severity="success" sx={{ mt: 1 }} onClose={() => setFreeOllamaMessage(null)}>{freeOllamaMessage}</Alert> : null}
                {freeOllamaError ? <Alert severity="error" sx={{ mt: 1 }} onClose={() => setFreeOllamaError(null)}>{freeOllamaError}</Alert> : null}
              </Paper>
            ) : null}
            {canManage ? (
              <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }} data-testid="forward-sharing-toggle-card">
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between">
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>对外共享 (/v1 转发)</Typography>
                    <Typography variant="body2" color="text.secondary">
                      打开后自动生成本地转发中转站 (免手动录入)，外部 CLI 可经 {forwardSharing?.baseUrl || "http://127.0.0.1:端口/v1"} 调用中转站模型 (model 名形如 {"{cli}-{中转站}-{分组}-{模型}"})；默认关闭，远端调用需转发 key，key 轮换后重开一次即重同步。
                    </Typography>
                    {forwardSharing?.enabled && forwardSharing.forwardRelay ? (
                      <Typography variant="body2" color="success.main" sx={{ mt: 0.5 }}>
                        已生成中转站 Ultra本地转发 ({forwardSharing.forwardRelay.modelCount} 个模型)，key 已自动填入。
                      </Typography>
                    ) : null}
                  </Box>
                  <Switch
                    checked={forwardSharing?.enabled === true}
                    disabled={forwardSharingBusy || !sessionToken}
                    onChange={(event) => void requestForwardSharingChange(event.target.checked)}
                    inputProps={{ "aria-label": "对外共享" }}
                  />
                </Stack>
                {forwardSharing?.enabled && forwardSharing.token ? (
                  <Box sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: "action.hover" }} data-testid="forward-sharing-config">
                    <Typography variant="caption" component="div" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                      baseUrl: {forwardSharing.baseUrl}
                    </Typography>
                    <Typography variant="caption" component="div" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                      key: {forwardSharing.token}
                    </Typography>
                    <Button size="small" variant="outlined" sx={{ mt: 0.75, borderRadius: 999 }} onClick={() => void copyForwardConfig()}>
                      {forwardConfigCopied ? "已复制" : "复制配置"}
                    </Button>
                  </Box>
                ) : null}
                {forwardSharingError ? <Alert severity="error" sx={{ mt: 1 }} onClose={() => setForwardSharingError(null)}>{forwardSharingError}</Alert> : null}
              </Paper>
            ) : null}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={t("settings.relay.allCount", { count: relayListProviders.length })} color="primary" sx={{ borderRadius: 999, fontWeight: 800 }} />
              {Object.entries(providerCounts(relayListProviders)).map(([kind, count]) => (
                <Chip
                  key={kind}
                  size="small"
                  label={`${providerKindLabel(kind)} ${count}`}
                  variant="outlined"
                  avatar={<Box component="span">{providerKindInitial(kind)}</Box>}
                  sx={{ borderRadius: 999, bgcolor: "background.paper" }}
                />
              ))}
            </Stack>

            <Stack direction={{ xs: "column", xl: "row" }} spacing={1.25} alignItems={{ xs: "stretch", xl: "center" }} justifyContent="space-between">
              <TextField
                size="small"
                placeholder={t("settings.relay.searchPlaceholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.75, color: "text.secondary" }} /> }}
                sx={{
                  maxWidth: { xl: 620 },
                  "& .MuiOutlinedInput-root": { borderRadius: 999, bgcolor: "background.paper" }
                }}
              />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {[
                  t("settings.relay.status"),
                  t("settings.relay.tag"),
                  t("settings.relay.model")
                ].map((label) => (
                  <Button key={label} size="small" variant="outlined" startIcon={<AddIcon />} sx={{ borderRadius: 999, color: "text.secondary" }}>
                    {label}
                  </Button>
                ))}
                <FormControl size="small" sx={{ minWidth: 190 }}>
                  <InputLabel>{t("settings.relay.serviceProvider")}</InputLabel>
                  <Select
                    multiple
                    value={stationTypeFilters}
                    label={t("settings.relay.serviceProvider")}
                    inputProps={{ "aria-label": t("settings.relay.serviceProvider") }}
                    onChange={(event) => {
                      const value = event.target.value;
                      setStationTypeFilters(typeof value === "string" ? value.split(",") as StationType[] : value as StationType[]);
                    }}
                    renderValue={(selected) => selected.length === 0
                      ? t("settings.relay.filterAll")
                      : selected.map((value) => t(`settings.relay.stationType.${value}` as TranslationKey)).join(", ")}
                  >
                    {(["third_party", "rich", "charity", "official"] as StationType[]).map((value) => (
                      <MenuItem key={value} value={value}>
                        <Checkbox size="small" checked={stationTypeFilters.includes(value)} />
                        <ListItemText primary={t(`settings.relay.stationType.${value}` as TranslationKey)} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Tooltip title={t("settings.relay.providerFilterHelp")}>
                  <IconButton size="small" aria-label={t("settings.relay.providerFilterHelp")}>
                    <HelpOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {stationTypeFilters.length > 0 ? (
                  <IconButton size="small" aria-label={t("settings.relay.clearProviderFilters")} onClick={() => setStationTypeFilters([])}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                ) : null}
                <Divider orientation="vertical" flexItem sx={{ display: { xs: "none", sm: "block" } }} />
                <Button size="small" variant="outlined" startIcon={<TuneIcon />} sx={{ borderRadius: 1.5, color: "text.secondary" }}>
                  {t("settings.relay.columns")}
                </Button>
              </Stack>
            </Stack>
          </Stack>

          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{
              borderRadius: 1.5,
              bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(17, 24, 39, 0.72)" : "rgba(255, 255, 255, 0.72)",
              backdropFilter: "blur(18px)",
              overflowX: "auto"
            }}
          >
            <Table size="small" stickyHeader sx={{ minWidth: 820 }}>
              <TableHead>
                <TableRow
                  sx={{
                    "& th": {
                      bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(31, 41, 55, 0.92)" : "rgba(231, 233, 228, 0.92)",
                      fontWeight: 850,
                      color: "text.secondary",
                      borderColor: "divider",
                      py: 1.5
                    }
                  }}
                >
                  <TableCell sx={{ width: 40 }} />
                  <TableCell>{t("settings.relay.name")}</TableCell>
                  <TableCell>{t("settings.relay.status")}</TableCell>
                  <TableCell>{t("settings.relay.supportedModels")}</TableCell>
                  <TableCell>{t("settings.relay.remark")}</TableCell>
                  <TableCell align="center">{t("settings.relay.health")}</TableCell>
                  <TableCell align="center">{t("settings.relay.orderingWeight")}</TableCell>
                  <TableCell align="right">{t("settings.relay.action")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredProviders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Typography color="text.secondary" sx={{ py: 2 }}>
                        {t("settings.relay.noChannels")}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  relayListPagination.items.map((provider) => {
                    const active = provider.id === activeProviderId;
                    const modelOptions = providerModelOptions(provider);
                    const groupModelList = providerGroupModelList(provider);
                    const supportedModels = providerSupportedModelList(provider);
                    const providerEnabled = provider.relayList.enabled;
                    const selectedProviderModel = providerModels[provider.id] ?? modelOptions[0]?.value ?? provider.defaultModel ?? "";
                    const testStatus = testStatuses[provider.id];
                    const expanded = expandedProviderId === provider.id;
                    return (
                      <Fragment key={provider.id}>
                        <TableRow
                          hover
                          sx={{
                            bgcolor: active ? "action.selected" : "transparent",
                            "& td": { borderColor: "divider", py: 1.25 }
                          }}
                        >
                          <TableCell>
                            <IconButton
                              size="small"
                              aria-label={t("settings.relay.expandProvider", { name: provider.name })}
                              onClick={() => setExpandedProviderId(expanded ? null : provider.id)}
                            >
                              {expanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                            </IconButton>
                          </TableCell>
                          <TableCell sx={{ minWidth: 320 }}>
                            <Stack spacing={0.35} sx={{ minWidth: 0 }}>
                              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
                                {canManage && provider.kind !== "chatgpt" && !provider.sharedImport ? (
                                  <Tooltip title={t("settings.relay.editProvider", { name: provider.name })}>
                                    <IconButton size="small" aria-label={t("settings.relay.editProvider", { name: provider.name })} onClick={() => void startEditChannel(provider)} disabled={relayDetailsLoading === provider.id}>
                                      {relayDetailsLoading === provider.id ? <CircularProgress size={16} /> : <EditIcon fontSize="small" />}
                                    </IconButton>
                                  </Tooltip>
                                ) : null}
                                {provider.id !== "omniroute-free" ? <Tooltip title={t(provider.kind === "responsesRelay" ? "settings.relay.testResponses" : "settings.relay.test")}>
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="primary"
                                      aria-label={t(provider.kind === "responsesRelay" ? "settings.relay.testResponses" : "settings.relay.test")}
                                      onClick={() => void testChannel(provider, selectedProviderModel)}
                                      disabled={busyProviderId === provider.id}
                                    >
                                      {busyProviderId === provider.id ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon fontSize="small" />}
                                    </IconButton>
                                  </span>
                                </Tooltip> : null}
                                {provider.id !== "omniroute-free" && isCodexEnabled ? <Tooltip title={t("settings.relay.testWithCodexHint")}>
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="secondary"
                                      aria-label={t("settings.relay.testWithCodex")}
                                      onClick={() => void testChannelWithCodex(provider, selectedProviderModel)}
                                      disabled={busyProviderId === provider.id}
                                    >
                                      <PsychologyIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip> : null}
                                {provider.id !== "omniroute-free" && !provider.sharedImport && onShareProvider ? (
                                  <Tooltip title="分享中转站">
                                    <IconButton size="small" color="info" aria-label="分享中转站" onClick={() => onShareProvider(provider)}>
                                      <ShareIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                ) : null}
                                <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
                                  {provider.name}
                                </Typography>
                                {provider.serviceProvider?.logo ? (
                                  <Box component="img" src={provider.serviceProvider.logo} alt="" sx={{ width: 20, height: 20, objectFit: "contain", flex: "0 0 auto" }} />
                                ) : (
                                  <VendorLogo name={provider.serviceProvider?.name ?? findRelayProviderTemplate(provider).label} size={20} />
                                )}
                                <Tooltip title={`${t(`settings.relay.stationType.${provider.stationType ?? "third_party"}` as TranslationKey)} · ${providerKindLabel(provider.kind)}`}>
                                  <Box component="span" sx={{ display: "inline-flex", color: "text.secondary" }}>
                                    {provider.stationType === "official" ? <CheckCircleIcon fontSize="small" color="primary" />
                                      : provider.stationType === "charity" ? <AutoAwesomeIcon fontSize="small" color="success" />
                                        : provider.stationType === "rich" ? <TokenIcon fontSize="small" color="warning" />
                                          : <HubIcon fontSize="small" />}
                                  </Box>
                                </Tooltip>
                                {provider.id === "omniroute-free" ? (
                                  <Chip
                                    size="small"
                                    color="success"
                                    variant="outlined"
                                    icon={<AttachMoneyIcon fontSize="small" />}
                                    label={t("settings.relay.freeBadge")}
                                    sx={{ height: 20, borderRadius: 1 }}
                                  />
                                ) : null}
                                {provider.sharedImport?.source === "codex-ultra-share" ? (
                                  <Tooltip title={t("settings.relay.sharedImported") as string}>
                                    <Chip
                                      size="small"
                                      color="info"
                                      variant="outlined"
                                      icon={<ShareIcon fontSize="small" />}
                                      label={t("settings.relay.sharedBadge")}
                                      sx={{ height: 20, borderRadius: 1 }}
                                    />
                                  </Tooltip>
                                ) : null}
                                {active ? <Chip size="small" color="primary" label={t("settings.relay.active")} sx={{ height: 20, borderRadius: 1 }} /> : null}
                              </Stack>
                              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere", display: "block" }}>
                                {provider.id === "omniroute-free" || provider.sharedImport?.source === "codex-ultra-share" ? t("settings.relay.managedProvider") : `${provider.baseUrl || t("settings.relay.managedProvider")} ${provider.apiKeyPreview ? "- ****" : ""}`}
                                {` • ${t("settings.relay.quotaUsd")}: ${provider.quotaUsd != null ? `$${provider.quotaUsd}` : t("settings.relay.unlimitedQuota")} • ${providerGroupQuotaSummary(provider, t)}`}
                              </Typography>
                              {testStatus ? (
                                <Typography variant="caption" color={testStatus.state === "failed" ? "error.main" : "success.main"} sx={{ overflowWrap: "anywhere" }}>
                                  {testStatus.message}
                                </Typography>
                              ) : null}
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              color={providerEnabled ? "success" : "default"}
                              variant="outlined"
                              label={t(providerEnabled ? "settings.relay.groupEnabled" : "settings.relay.groupDisabled")}
                            />
                            {provider.relayList.quotaUsageRate != null && provider.relayList.quotaUsageRate >= 0.8 ? (
                              <Chip
                                size="small"
                                color={provider.relayList.quotaUsageRate >= 0.95 ? "error" : "warning"}
                                variant="filled"
                                label={`quota ${Math.round(provider.relayList.quotaUsageRate * 100)}%`}
                                sx={{ ml: 0.5, height: 20, borderRadius: 1 }}
                              />
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                              {provider.relayList.groupCount > 0 ? (
                                <Tooltip
                                  placement="top"
                                  title={(
                                    <Box sx={{ maxWidth: 420 }}>
                                      <Typography variant="caption" component="div">
                                        {t("settings.relay.catalogGroups", { count: provider.relayList.groupCount })}
                                      </Typography>
                                    </Box>
                                  )}
                                >
                                  <Chip
                                    size="small"
                                    icon={<HubIcon fontSize="small" />}
                                    color={provider.relayList.enabled ? "success" : "default"}
                                    label={t("settings.relay.catalogGroups", { count: provider.relayList.groupCount })}
                                    variant="outlined"
                                  />
                                </Tooltip>
                              ) : null}
                              <Tooltip
                                placement="top"
                                title={supportedModels.length > 0 ? (
                                  <Box sx={{ maxWidth: 420, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                                    {supportedModels.join("\n")}
                                  </Box>
                                ) : t("settings.relay.noModels")}
                              >
                                <Chip size="small" icon={<TokenIcon fontSize="small" />} label={t("settings.relay.catalogModels", { count: supportedModels.length })} variant="outlined" />
                              </Tooltip>
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ maxWidth: 180 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={provider.remark || undefined}>
                              {provider.remark?.trim() || t("settings.relay.noRemark")}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Tooltip title={active ? t("settings.relay.activeHealth") : t("settings.relay.readyHealth")}>
                              <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: active ? "primary.main" : "success.main", mx: "auto", boxShadow: "0 0 8px rgba(34,197,94,0.42)" }} />
                            </Tooltip>
                          </TableCell>
                          <TableCell align="center">
                            <Typography variant="body2" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
                              {providerRateSummary(provider)}
                            </Typography>
                          </TableCell>
                          <TableCell align="right" sx={{ minWidth: 180 }}>
                            <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                              <FormControl size="small" sx={{ minWidth: 120, maxWidth: 170 }}>
                                <InputLabel>{t("settings.relay.model")}</InputLabel>
                                <Select
                                  value={selectedProviderModel}
                                  label={t("settings.relay.model")}
                                  onChange={(event) => setProviderModels((current) => ({ ...current, [provider.id]: event.target.value }))}
                                >
                                  {modelOptions.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>
                                      {option.label}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                              <Tooltip title={t("settings.relay.activate")}>
                                <span>
                                  <IconButton
                                    size="small"
                                    color="primary"
                                    aria-label={t("settings.relay.activate")}
                                    onClick={() => void activateChannel(provider, selectedProviderModel)}
                                    disabled={busyProviderId === provider.id}
                                  >
                                    <PlayArrowIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              {canManage && windowsDesktop && onInjectClaudeDesktop && provider.kind !== "chatgpt" ? (
                                <Tooltip title="注入 Claude Desktop">
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="secondary"
                                      aria-label="注入 Claude Desktop"
                                      onClick={() => void openClaudeDesktopInjection(provider)}
                                      disabled={busyProviderId === provider.id || relayDetailsLoading === provider.id}
                                    >
                                      {relayDetailsLoading === provider.id ? <CircularProgress size={16} color="inherit" /> : <HubIcon fontSize="small" />}
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              ) : null}
                              {CURSOR_INJECTION_ENABLED && canManage && windowsDesktop && onInjectCursorDesktop && provider.kind !== "chatgpt" ? (
                                <Tooltip title="注入 Cursor（本地模式）">
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="secondary"
                                      aria-label="注入 Cursor（本地模式）"
                                      onClick={() => void injectCursorDesktop(provider)}
                                      disabled={busyProviderId === provider.id}
                                    >
                                      <TerminalIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              ) : null}
                              {canManage && provider.id !== "omniroute-free" && provider.kind !== "chatgpt" ? (
                                <Tooltip title="移入垃圾桶">
                                  <IconButton
                                    size="small"
                                    color="error"
                                    aria-label={`删除 ${provider.name}`}
                                    onClick={() => setTrashConfirmProvider(provider)}
                                    disabled={trashMutationId === provider.id}
                                  >
                                    {trashMutationId === provider.id ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineIcon fontSize="small" />}
                                  </IconButton>
                                </Tooltip>
                              ) : null}
                            </Stack>
                          </TableCell>
                        </TableRow>
                        {expanded ? (
                          <TableRow key={`${provider.id}-expanded`}>
                            <TableCell colSpan={8} sx={{ bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(15,23,42,0.55)" : "rgba(248,250,252,0.92)", py: 2 }}>
                              <Box sx={{ px: { xs: 0.5, sm: 1.5 } }}>
                                <Stack spacing={2}>
                                  <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                                        {t("settings.relay.basicInfo")}
                                      </Typography>
                                      <Stack spacing={0.75}>
                                        <Stack direction="row" spacing={1} justifyContent="space-between">
                                          <Typography variant="caption" color="text.secondary">{t("settings.relay.baseUrl")}</Typography>
                                          <Typography variant="caption" sx={{ fontFamily: "JetBrains Mono, monospace", textAlign: "right", overflowWrap: "anywhere", maxWidth: "70%" }}>
                                            {provider.sharedImport?.source === "codex-ultra-share" ? t("settings.relay.managedProvider") : provider.baseUrl || t("settings.relay.managedProvider")}
                                          </Typography>
                                        </Stack>
                                        {provider.stationType === "official" ? (
                                          <Stack direction="row" spacing={1} justifyContent="space-between">
                                            <Typography variant="caption" color="text.secondary">{t("settings.relay.apiFormat")}</Typography>
                                            <Typography variant="caption">{providerKindLabel(provider.kind)}</Typography>
                                          </Stack>
                                        ) : null}
                                        <Stack direction="row" spacing={1} justifyContent="space-between">
                                          <Typography variant="caption" color="text.secondary">{t("settings.relay.createdAt")}</Typography>
                                          <Typography variant="caption">{formatProviderDateTime(provider.createdAt)}</Typography>
                                        </Stack>
                                        <Stack direction="row" spacing={1} justifyContent="space-between">
                                          <Typography variant="caption" color="text.secondary">{t("settings.relay.updatedAt")}</Typography>
                                          <Typography variant="caption">{formatProviderDateTime(provider.updatedAt)}</Typography>
                                        </Stack>
                                      </Stack>
                                    </Box>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                                        {t("settings.relay.additionalInfo")}
                                      </Typography>
                                      <Stack spacing={0.75}>
                                        <Stack direction="row" spacing={1} justifyContent="space-between">
                                          <Typography variant="caption" color="text.secondary">{t("settings.relay.orderingWeight")}</Typography>
                                          <Typography variant="caption" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
                                            {providerRateSummary(provider)}
                                          </Typography>
                                        </Stack>
                                        <Stack direction="row" spacing={1} justifyContent="space-between">
                                          <Typography variant="caption" color="text.secondary">{t("settings.relay.remark")}</Typography>
                                          <Typography variant="caption" sx={{ textAlign: "right", maxWidth: "70%", overflowWrap: "anywhere" }} title={provider.remark || undefined}>
                                            {provider.remark?.trim() || t("settings.relay.noRemark")}
                                          </Typography>
                                        </Stack>
                                      </Stack>
                                    </Box>
                                  </Stack>
                                  {provider.id !== "omniroute-free" && groupModelList.length > 0 ? (
                                    <Box>
                                      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                                        {t("settings.relay.supportedModels")}
                                      </Typography>
                                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                        {groupModelList.slice(0, 8).map((model) => (
                                          <Chip key={model} size="small" label={model} sx={{ fontFamily: "JetBrains Mono, monospace", borderRadius: 1 }} />
                                        ))}
                                        {groupModelList.length > 8 ? (
                                          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                                            {t("settings.relay.moreModels", { count: groupModelList.length - 8 })}
                                          </Typography>
                                        ) : null}
                                      </Stack>
                                    </Box>
                                  ) : null}
                                </Stack>
                              </Box>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
            <Typography variant="body2" color="text.secondary">
              {relayListLoading ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
              {t("settings.relay.showingEntries", { start: relayListPagination.start, end: relayListPagination.end, total: filteredProviders.length })}
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button
                size="small"
                variant="outlined"
                disabled={relayListPagination.page === 0}
                onClick={() => setRelayListPage((page) => Math.max(0, page - 1))}
              >
                {t("settings.relay.previous")}
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={relayListPagination.page >= relayListPagination.pageCount - 1}
                onClick={() => setRelayListPage((page) => Math.min(relayListPagination.pageCount - 1, page + 1))}
              >
                {t("settings.relay.next")}
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Box>
      ) : null}
      <Dialog open={Boolean(trashConfirmProvider)} onClose={() => setTrashConfirmProvider(null)} maxWidth="xs" fullWidth>
        <DialogTitle>移入垃圾桶？</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            {trashConfirmProvider ? `“${trashConfirmProvider.name}”将从中转站列表隐藏，可随时从垃圾桶还原。` : ""}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTrashConfirmProvider(null)}>取消</Button>
          <Button color="error" variant="contained" onClick={() => void trashProvider()} disabled={Boolean(trashMutationId)}>
            移入垃圾桶
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={trashDialogOpen} onClose={() => setTrashDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>垃圾桶</DialogTitle>
        <DialogContent dividers>
          {trashedRelayProviders.length === 0 ? (
            <Typography variant="body2" color="text.secondary">垃圾桶为空</Typography>
          ) : (
            <List disablePadding>
              {trashedRelayProviders.map((provider) => (
                <ListItemButton key={provider.id} disableRipple sx={{ px: 0 }}>
                  <ListItemText primary={provider.name} secondary={provider.baseUrl || provider.id} />
                  <Tooltip title="还原">
                    <span>
                      <IconButton
                        aria-label={`还原 ${provider.name}`}
                        onClick={() => void restoreProvider(provider.id)}
                        disabled={trashMutationId === provider.id}
                      >
                        {trashMutationId === provider.id ? <CircularProgress size={18} /> : <RestoreFromTrashIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTrashDialogOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={newChannelDialogMode === "chooser"}
        onClose={() => setNewChannelDialogMode(null)}
        fullWidth
        maxWidth="sm"
        data-testid="new-relay-channel-mode-dialog"
      >
        <DialogTitle>{t("settings.relay.newChannelModeTitle")}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("settings.relay.newChannelModeSubtitle")}
          </Typography>
          <Stack spacing={1.25}>
            <Button
              variant="contained"
              size="large"
              startIcon={<RocketLaunchIcon />}
              onClick={openQuickAddChannel}
              sx={{ justifyContent: "flex-start", textAlign: "left", py: 1.25 }}
              data-testid="quick-create-relay"
            >
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{t("settings.relay.quickCreate")}</Typography>
                <Typography variant="caption" sx={{ display: "block", opacity: 0.8 }}>{t("settings.relay.quickCreateDescription")}</Typography>
              </Box>
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<SettingsSuggestIcon />}
              onClick={openAdvancedAddChannel}
              sx={{ justifyContent: "flex-start", textAlign: "left", py: 1.25 }}
              data-testid="advanced-create-relay"
            >
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{t("settings.relay.advancedCreate")}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{t("settings.relay.advancedCreateDescription")}</Typography>
              </Box>
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewChannelDialogMode(null)}>{t("settings.cancel")}</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={newChannelDialogMode === "quick"}
        onClose={quickCreating ? undefined : () => setNewChannelDialogMode(null)}
        disableEscapeKeyDown={quickCreating}
        fullWidth
        maxWidth="md"
        data-testid="quick-relay-channel-dialog"
      >
        <DialogTitle>{t("settings.relay.quickCreate")}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {t("settings.relay.quickCreateDescription")}
            </Typography>
            <AdvancedRelayConnectionStep
              key={`quick-${quickConnectionKey}`}
              ref={quickConnectionRef}
              directory={advancedRelayDirectory}
              initialValue={{
                name: quickChannelName,
                targetProviderId: quickTargetProviderId,
                serviceProviderId: quickServiceProviderId,
                serviceProviderName: quickServiceProviderName,
                baseUrl: quickChannelBaseUrl,
                apiKey: quickChannelApiKey,
                protocol: quickChannelProtocol
              }}
              onChange={syncQuickConnection}
              t={t}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={quickManualModels}
                  onChange={(event) => setQuickManualModels(event.target.checked)}
                  disabled={quickCreating}
                  data-testid="quick-manual-models-toggle"
                />
              }
              label={t("settings.relay.quickManualModels")}
            />
            {quickManualModels ? (
              <TextField
                label={t("settings.relay.quickManualModels")}
                placeholder={t("settings.relay.quickManualModelsPlaceholder")}
                value={quickManualModelsText}
                onChange={(event) => setQuickManualModelsText(event.target.value)}
                multiline
                minRows={2}
                fullWidth
                size="small"
                disabled={quickCreating}
                data-testid="quick-manual-models-input"
              />
            ) : null}
            {!quickManualModels && quickFetchedModels.length > 0 ? (
              <Alert severity="success" variant="outlined">
                {t("settings.relay.quickModelsFetched", { count: quickFetchedModels.length })}
              </Alert>
            ) : null}
            {quickCreateError ? <Alert severity="error" variant="outlined">{quickCreateError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewChannelDialogMode("chooser")} disabled={quickCreating}>{t("settings.relay.backToModes")}</Button>
          <Button
            variant="contained"
            startIcon={quickCreating ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            onClick={() => void saveQuickChannel()}
            disabled={!quickChannelValid || quickCreating}
            data-testid="save-quick-relay-channel"
          >
            {quickCreating ? t("settings.relay.quickCreating") : t("settings.relay.save")}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={newChannelDialogMode === "advanced"}
        onClose={quickCreating ? undefined : () => setNewChannelDialogMode(null)}
        disableEscapeKeyDown={quickCreating}
        fullWidth
        maxWidth="md"
        data-testid="advanced-relay-channel-dialog"
      >
        <DialogTitle>{t("settings.relay.advancedWizardTitle", { step: advancedStep + 1 })}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1}>
              {[0, 1, 2].map((step) => (
                <Chip key={step} color={advancedStep === step ? "primary" : "default"} label={t(`settings.relay.advancedStep${step + 1}`)} />
              ))}
            </Stack>
            {advancedStep === 0 ? (
              <AdvancedRelayConnectionStep
                ref={advancedConnectionRef}
                directory={advancedRelayDirectory}
                initialValue={{
                  name: quickChannelName,
                  targetProviderId: advancedTargetProviderId,
                  serviceProviderId: advancedServiceProviderId,
                  serviceProviderName: advancedServiceProviderName,
                  baseUrl: quickChannelBaseUrl,
                  apiKey: quickChannelApiKey,
                  protocol: quickChannelProtocol
                }}
                t={t}
              />
            ) : null}
            {advancedStep === 1 ? (
              <Stack spacing={1}>
                <TextField size="small" label={t("settings.relay.groupName")} value={advancedGroupName} onChange={(event) => { setAdvancedGroupName(event.target.value); setQuickCreateError(null); }} error={!advancedGroupName.trim()} helperText={t("settings.relay.groupNameIncrementHint")} />
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1 }}>
                  <TextField size="small" type="number" inputProps={{ min: 0, step: "any" }} label={t("settings.relay.groupRatio")} value={advancedGroupRatio} onChange={(event) => { setAdvancedGroupRatio(event.target.value); setQuickCreateError(null); }} error={!Number.isFinite(advancedGroupRatioNumber) || advancedGroupRatioNumber < 0} />
                  <TextField size="small" type="number" inputProps={{ min: 0, step: 1 }} label={t("settings.relay.priority")} value={advancedPriority} onChange={(event) => { setAdvancedPriority(event.target.value); setQuickCreateError(null); }} error={!Number.isInteger(advancedPriorityNumber) || advancedPriorityNumber < 0} />
                  <TextField size="small" type="number" inputProps={{ min: 0, step: 1 }} label={t("settings.relay.weight")} value={advancedWeight} onChange={(event) => { setAdvancedWeight(event.target.value); setQuickCreateError(null); }} error={!Number.isInteger(advancedWeightNumber) || advancedWeightNumber < 0} />
                </Box>
                <TextField size="small" multiline minRows={3} label={t("settings.relay.groupModelMapping")} value={advancedModelMapping} onChange={(event) => { setAdvancedModelMapping(event.target.value); setQuickCreateError(null); }} error={!isValidGroupMappingDraft(advancedModelMapping)} helperText={t("settings.relay.mappingOptionalHint")} />
                <TextField size="small" multiline minRows={2} label={t("settings.relay.groupStatusCodeMapping")} value={advancedStatusMapping} onChange={(event) => { setAdvancedStatusMapping(event.target.value); setQuickCreateError(null); }} error={!isValidStatusCodeMappingDraft(advancedStatusMapping)} helperText={t("settings.relay.mappingOptionalHint")} />
                <TextField size="small" multiline minRows={2} label={t("settings.relay.remark")} value={advancedRemark} onChange={(event) => setAdvancedRemark(event.target.value)} />
                <Alert severity="info">{t("settings.relay.advancedDefaultsReady")}</Alert>
              </Stack>
            ) : null}
            {advancedStep === 2 ? (
              <Stack spacing={1}>
                <List dense disablePadding>
                  <ListItemText primary={t("settings.relay.serviceProvider")} secondary={advancedServiceProviderName} />
                  <ListItemText primary={t("settings.relay.channelName")} secondary={quickChannelName} />
                  <ListItemText primary={t("settings.relay.baseUrl")} secondary={quickChannelBaseUrl} />
                  <ListItemText primary={t("settings.relay.groupName")} secondary={advancedGroupName || "default"} />
                  <ListItemText primary={t("settings.relay.models")} secondary={t("settings.relay.quickModelsFetched", { count: quickFetchedModels.length })} />
                  <ListItemText primary={t("settings.relay.responseProtocol")} secondary={quickChannelProtocol} />
                </List>
                <Alert severity="success">{t("settings.relay.advancedCreateSummary")}</Alert>
              </Stack>
            ) : null}
            {quickCreateError ? <Alert severity="error">{quickCreateError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => advancedStep === 0 ? setNewChannelDialogMode("chooser") : setAdvancedStep((step) => Math.max(0, step - 1))} disabled={quickCreating}>
            {advancedStep === 0 ? t("settings.relay.backToModes") : t("settings.back")}
          </Button>
          {advancedStep < 2 ? (
            <Button variant="contained" onClick={() => void advanceAdvancedChannel()} disabled={(advancedStep === 1 && !advancedSettingsValid) || quickCreating}>
              {quickCreating ? <CircularProgress size={16} color="inherit" /> : t("settings.next")}
            </Button>
          ) : (
            <Button variant="contained" startIcon={quickCreating ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />} onClick={() => void createAdvancedChannel()} disabled={!advancedSettingsValid || quickCreating}>
              {t("settings.relay.createChannel")}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(claudeInjectionProvider)}
        onClose={closeClaudeDesktopInjection}
        fullWidth
        maxWidth="xs"
        data-testid="claude-desktop-injection-dialog"
      >
        <DialogTitle>{"\u6ce8\u5165 Claude Desktop"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {claudeInjectionProvider
                ? `\u9009\u62e9\u201c${claudeInjectionProvider.name}\u201d\u4e2d\u8981\u5199\u5165 Claude Desktop \u7684\u5206\u7ec4\u3002`
                : "\u8bf7\u9009\u62e9\u6ce8\u5165\u5206\u7ec4\u3002"}
            </Typography>
            <FormControl size="small" fullWidth>
              <InputLabel shrink>{"\u6ce8\u5165\u5206\u7ec4"}</InputLabel>
              <Select
                value={claudeInjectionGroupId}
                label={"\u6ce8\u5165\u5206\u7ec4"}
                onChange={(event) => {
                  const groupId = event.target.value;
                  const group = claudeInjectionGroups.find((entry) => entry.id === groupId);
                  const models = claudeInjectionProvider && group
                    ? expandModelContextVariants(relayGroupSelectableModels(claudeInjectionProvider, group))
                    : [];
                  setClaudeInjectionGroupId(groupId);
                  const selectedModels = models[0] ? [models[0]] : [];
                  setClaudeInjectionModelsSelected(selectedModels);
                  setClaudeInjectionModelMappings(defaultClaudeModelMappings(selectedModels));
                }}
                displayEmpty
              >
                <MenuItem value="" disabled>{"\u8bf7\u9009\u62e9\u5206\u7ec4"}</MenuItem>
                {claudeInjectionGroups.map((group) => (
                  <MenuItem key={group.id} value={group.id}>
                    {`${group.name || group.id} \u00b7 ${formatMultiplier(group.groupRatio ?? 1)}x`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth disabled={!claudeInjectionGroupId || claudeInjectionModels.length === 0}>
              <InputLabel shrink>{"\u6ce8\u5165\u6a21\u578b"}</InputLabel>
              <Select
                multiple
                value={claudeInjectionModelsSelected}
                label={"\u6ce8\u5165\u6a21\u578b"}
                onChange={(event) => {
                  const value = event.target.value;
                  const selectedModels = typeof value === "string" ? value.split(",") : value;
                  setClaudeInjectionModelsSelected(selectedModels);
                  setClaudeInjectionModelMappings((current) => defaultClaudeModelMappings(selectedModels, current));
                }}
                renderValue={(selected) => selected.map((model) => modelChoiceDisplayName(
                  model,
                  claudeInjectionProvider?.modelDisplayNames?.[model]
                    ?? claudeInjectionProvider?.modelDisplayNames?.[stripModelContextVariant(model).baseModel]
                )).join(", ")}
              >
                {claudeInjectionModels.map((model) => (
                  <MenuItem key={model} value={model}>
                    <Checkbox size="small" checked={claudeInjectionModelsSelected.includes(model)} />
                    <ListItemText primary={modelChoiceDisplayName(
                      model,
                      claudeInjectionProvider?.modelDisplayNames?.[model]
                        ?? claudeInjectionProvider?.modelDisplayNames?.[stripModelContextVariant(model).baseModel]
                    )} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {claudeInjectionNonClaudeModels.length > 0 ? (
              <Stack spacing={1}>
                <Alert severity="warning">{"\u975e Claude \u6a21\u578b\u9700\u8981\u6620\u5c04\u5230 Claude \u6a21\u578b\u65cf\uff0c\u771f\u5b9e\u8bf7\u6c42\u4ecd\u4f7f\u7528\u539f\u6a21\u578b ID\u3002"}</Alert>
                {claudeInjectionNonClaudeModels.map((model) => (
                  <Box
                    key={model}
                    sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1fr) minmax(0, 1fr)" }, gap: 1, alignItems: "center" }}
                  >
                    <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{model}</Typography>
                    <FormControl size="small" fullWidth>
                      <InputLabel>{"\u6620\u5c04\u4e3a"}</InputLabel>
                      <Select
                        value={claudeInjectionModelMappings[model] ?? ""}
                        label={"\u6620\u5c04\u4e3a"}
                        onChange={(event) => setClaudeInjectionModelMappings((current) => ({ ...current, [model]: event.target.value }))}
                        data-testid={`claude-model-mapping-${model}`}
                      >
                        {CLAUDE_FAMILY_MAPPING_OPTIONS.map((option) => (
                          <MenuItem
                            key={option.model}
                            value={option.model}
                            disabled={Object.entries(claudeInjectionModelMappings).some(([source, target]) =>
                              source !== model
                              && stripModelContextVariant(target).baseModel === stripModelContextVariant(option.model).baseModel
                            )}
                          >
                            {option.model}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                ))}
              </Stack>
            ) : null}
            {claudeInjectionGroupId && claudeInjectionModels.length === 0 ? (
              <Alert severity="warning">{"\u6240\u9009\u5206\u7ec4\u6ca1\u6709\u53ef\u6ce8\u5165\u7684\u6587\u672c\u6a21\u578b\u3002"}</Alert>
            ) : null}
            <Alert severity="info">{"\u786e\u8ba4\u540e\u53ea\u4f1a\u5199\u5165 Claude Desktop \u7b2c\u4e09\u65b9\u914d\u7f6e\uff0c\u4e0d\u4f1a\u7ed5\u8fc7 Claude \u5b98\u65b9\u767b\u5f55\u3002"}</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeClaudeDesktopInjection} disabled={Boolean(claudeInjectionProvider && busyProviderId === claudeInjectionProvider.id)}>
            {t("settings.cancel")}
          </Button>
          <Button
            variant="contained"
            startIcon={claudeInjectionProvider && busyProviderId === claudeInjectionProvider.id ? <CircularProgress size={16} color="inherit" /> : <HubIcon />}
            disabled={!claudeInjectionGroupId || claudeInjectionModelsSelected.length === 0 || !claudeInjectionMappingsComplete || Boolean(claudeInjectionProvider && busyProviderId === claudeInjectionProvider.id)}
            onClick={() => void injectClaudeDesktop()}
          >
            {"\u786e\u8ba4\u6ce8\u5165"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={freeOllamaConfirmOpen} onClose={() => setFreeOllamaConfirmOpen(false)} fullWidth maxWidth="xs" data-testid="free-ollama-enable-confirm">
        <DialogTitle>{t("settings.relay.freeOllamaConfirmTitle")}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning">{t("settings.relay.freeOllamaConfirmMessage")}</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFreeOllamaConfirmOpen(false)}>{t("settings.cancel")}</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              onFreeOllamaEnabledChange(true);
              setFreeOllamaConfirmOpen(false);
            }}
          >
            {t("settings.relay.freeOllamaConfirm")}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={riskConfirmationOpen}
        onClose={saving ? undefined : () => setRiskConfirmationOpen(false)}
        disableEscapeKeyDown={saving}
        fullWidth
        maxWidth="sm"
        data-testid="relay-risk-confirmation-dialog"
      >

        <DialogTitle>{editingProviderId ? t("settings.relay.riskEditTitle") : t("settings.relay.riskCreateTitle")}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 1.5 }}>{t("settings.relay.riskDescription")}</Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>{t("settings.relay.riskDetails")}</Typography>
          <FormControlLabel
            control={<Checkbox checked={riskAcknowledged} onChange={(event) => setRiskAcknowledged(event.target.checked)} />}
            label={t("settings.relay.riskAcknowledgement")}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRiskConfirmationOpen(false)} disabled={saving}>{t("settings.cancel")}</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={!riskAcknowledged || saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            onClick={() => {
              void (async () => {
                try {
                  await saveChannel();
                  setRiskConfirmationOpen(false);
                  setRiskAcknowledged(false);
                } catch {
                  // The shared save handler already surfaces the error in the workbench.
                }
              })();
            }}
          >
            {t("settings.relay.riskConfirmSave")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={unsavedChangesDialogOpen}
        onClose={() => setUnsavedChangesDialogOpen(false)}
        fullWidth
        maxWidth="xs"
        data-testid="relay-unsaved-changes-dialog"
      >
        <DialogTitle>{t("settings.relay.unsavedChangesTitle")}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 1.5 }}>{t("settings.relay.unsavedChangesMessage")}</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnsavedChangesDialogOpen(false)}>{t("settings.cancel")}</Button>
          <Button
            variant="outlined"
            color="warning"
            onClick={() => {
              setUnsavedChangesDialogOpen(false);
              setRelayView("list");
              clearFetchedModelsState();
              initialFormSnapshotRef.current = null;
            }}
          >
            {t("settings.relay.unsavedChangesDiscard")}
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => {
              setUnsavedChangesDialogOpen(false);
              if (!canSaveChannel) {
                void saveChannel();
                return;
              }
              setSaveValidationError(null);
              setRiskAcknowledged(false);
              setRiskConfirmationOpen(true);
            }}
          >
            {t("settings.relay.save")}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsSection>
  );
}

function RelayFormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "170px minmax(0, 1fr)" },
        gap: { xs: 0.75, md: 2 },
        alignItems: "start"
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 700, pt: { md: 1 } }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

export function parseQuickManualModelsText(value: string): string[] {
  const seen = new Set<string>();
  for (const entry of value.split(/[,，、\s]+/)) {
    const model = entry.trim();
    if (model && !seen.has(model)) seen.add(model);
  }
  return [...seen];
}

function formatRelayErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
    try {
      return JSON.stringify(record);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function providerModelOptions(provider: ProviderConfig): Array<{ value: string; label: string }> {
  const fallbackModels = provider.defaultModel ? [provider.defaultModel] : [];
  const defaultGroup = defaultTextGroup(provider);
  const groupModels = defaultGroup ? relayGroupSelectableModels(provider, defaultGroup) : [];
  const nativeModelOptions = (provider.groups?.length ?? 0) > 0
    ? groupModels
    : provider.nativeModels.length > 0
      ? provider.nativeModels
      : fallbackModels;
  return [
    ...nativeModelOptions.map((model) => ({ value: model, label: provider.modelDisplayNames?.[model] ?? model }))
  ].filter((entry, index, entries) => entries.findIndex((candidate) => candidate.value === entry.value) === index);
}

function defaultTextGroup(provider: ProviderConfig): ChannelGroupConfig | undefined {
  return provider.groups?.find((group) => group.kind !== "image" && group.status !== "disabled") ?? provider.groups?.find((group) => group.kind !== "image") ?? provider.groups?.[0];
}

function defaultProviderModel(provider: ProviderConfig): string | undefined {
  if ((provider.groups?.length ?? 0) > 0) {
    const group = defaultTextGroup(provider);
    return (group ? providerGroupTestModels(provider, group)[0] : undefined) ?? provider.defaultModel ?? provider.nativeModels[0];
  }
  return provider.defaultModel ?? provider.nativeModels[0];
}

function providerGroupModelList(provider: ProviderConfig): string[] {
  return Array.from(new Set((provider.groups ?? []).flatMap((group) => providerGroupDisplayModels(provider, group))));
}

function providerSupportedModelList(provider: ProviderConfig): string[] {
  return Array.from(new Set([
    ...provider.nativeModels,
    ...providerGroupModelList(provider),
    ...(provider.defaultModel ? [provider.defaultModel] : [])
  ].filter(Boolean)));
}

function providerGroupDisplayModels(provider: ProviderConfig, group: ChannelGroupConfig): string[] {
  return relayGroupModelsForEditing(provider, group);
}

function providerGroupTestModels(provider: ProviderConfig, group: ChannelGroupConfig): string[] {
  return (group.models?.length ? group.models : provider.nativeModels).filter(Boolean);
}

function providerCounts(providers: ProviderConfig[]): Record<string, number> {
  return providers.reduce<Record<string, number>>((counts, provider) => {
    counts[provider.kind] = (counts[provider.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function providerKindLabel(kind: string): string {
  switch (kind) {
    case "responsesRelay":
      return "Responses";
    case "chatgpt":
      return "ChatGPT";
    case "openai":
      return "OpenAI";
    case "ollama":
      return "Ollama";
    case "lmstudio":
      return "LM Studio";
    case "bedrock":
      return "Bedrock";
    default:
      return kind;
  }
}

function providerKindInitial(kind: string): string {
  return providerKindLabel(kind).slice(0, 1).toUpperCase();
}

function providerTags(provider: ProviderConfig, active: boolean): string[] {
  return [provider.kind === "responsesRelay" ? "relay" : provider.kind, active ? "active" : "saved"].filter(Boolean);
}

function providerRateSummary(provider: ProviderConfig): string {
  const groups = provider.groups ?? [];
  if (groups.length === 0) {
    return "1x";
  }
  const multipliers = groups.map((group) => group.groupRatio ?? 1);
  const unique = [...new Set(multipliers.map((value) => formatMultiplier(value)))];
  if (unique.length === 1) {
    return `${unique[0]}x`;
  }
  const min = Math.min(...multipliers);
  const max = Math.max(...multipliers);
  return `${groups.length} groups ${formatMultiplier(min)}-${formatMultiplier(max)}x`;
}

function providerGroupQuotaSummary(provider: ProviderConfig, t: TranslateFn): string {
  const groups = provider.groups ?? [];
  if (groups.length === 0) {
    return `${t("settings.relay.groupQuotaUsdShort")}: ${t("settings.relay.unlimitedQuota")}`;
  }
  const quotas = groups
    .map((group) => group.quotaUsd)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (quotas.length === 0) {
    return `${t("settings.relay.groupQuotaUsdShort")}: ${t("settings.relay.unlimitedQuota")}`;
  }
  if (quotas.length === groups.length && new Set(quotas).size === 1) {
    return `${t("settings.relay.groupQuotaUsdShort")}: $${quotas[0]}`;
  }
  const min = Math.min(...quotas);
  const max = Math.max(...quotas);
  const limited = `${quotas.length}/${groups.length}`;
  return `${t("settings.relay.groupQuotaUsdShort")}: ${limited} $${min}-${max}`;
}

function formatMultiplier(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : "1";
}

function formatProviderDateTime(value?: number): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCsvForGroup(value: string, kind: ChannelGroupConfig["kind"]): string[] {
  return filterModelsForGroup(parseCsv(value), kind);
}

function filterModelsForGroup(models: string[], kind: ChannelGroupConfig["kind"]): string[] {
  const wantsImage = kind === "image";
  return Array.from(new Set(models.map((model) => model.trim()).filter((model) => model && isLikelyImageModel(model) === wantsImage)));
}

function isLikelyImageModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return DEEPKEY_IMAGE_MODELS.some((entry) => entry.toLowerCase() === normalized)
    || /\b(image|img|nano[_-]?banana|flux|midjourney|mj|dall[-_ ]?e|stable[-_ ]?diffusion|sdxl|hidream|ideogram|recraft|imagen|seedream|kolors|wan2?\.?2|kling|jimeng)\b/i.test(normalized);
}

function defaultGroupImageConfig(template?: ProviderConfig["image"]): NonNullable<ChannelGroupConfig["image"]> {
  return {
    generations: template?.generations ?? true,
    edits: template?.edits ?? false,
    defaultModel: template?.defaultModel,
    protocols: template?.protocols,
    defaultProtocol: template?.defaultProtocol,
    modelPrices: template?.modelPrices
  };
}

function formatImageModelPrices(value: NonNullable<ChannelGroupConfig["image"]>["modelPrices"]): string {
  return (value ?? []).map((entry) => `${entry.model}=${entry.usdPerImage}`).join("\n");
}

function parseImageModelPrices(value: string): NonNullable<ChannelGroupConfig["image"]>["modelPrices"] | undefined {
  const entries = value
    .split(/\r?\n|,/)
    .map((entry) => {
      const [model, price] = entry.split("=").map((part) => part.trim());
      const usdPerImage = price ? Number(price) : NaN;
      return model && Number.isFinite(usdPerImage) && usdPerImage >= 0 ? { model, usdPerImage } : null;
    })
    .filter((entry): entry is { model: string; usdPerImage: number } => Boolean(entry));
  return entries.length > 0 ? entries : undefined;
}

function formatGroupMapping(value: ChannelGroupConfig["modelMapping"]): string {
  return (value ?? []).map((entry) => `${entry.from}=${entry.to}`).join("\n");
}

function normalizeAdvancedModelMapping(value: ChannelGroupConfig["advancedModelMapping"]): ChannelGroupConfig["advancedModelMapping"] {
  const rules = (value ?? []).filter((rule) => rule.requestModel?.trim() && rule.targetModel?.trim());
  const compact = rules.map((rule) => {
    const next: AdvancedModelMappingRule = {
      requestModel: rule.requestModel.trim(),
      targetModel: rule.targetModel.trim()
    };
    if (rule.targetProviderId?.trim()) next.targetProviderId = rule.targetProviderId.trim();
    if (rule.targetGroupId?.trim()) next.targetGroupId = rule.targetGroupId.trim();
    if (rule.label?.trim()) next.label = rule.label.trim();
    if (rule.enabled === false) next.enabled = false;
    return next;
  });
  return compact.length > 0 ? compact : undefined;
}

type AdvancedModelMappingEditorProps = {
  group: ChannelGroupConfig;
  providers: ProviderConfig[];
  open: boolean;
  onToggleOpen: () => void;
  onChange: (rules: AdvancedModelMappingRule[] | undefined) => void;
  t: TranslateFn;
};

export function AdvancedModelMappingEditor({ group, providers, open, onToggleOpen, onChange, t }: AdvancedModelMappingEditorProps) {
  const committedRules: AdvancedModelMappingRule[] = group.advancedModelMapping ?? [];
  // Keep a raw draft so an in-progress (still-empty) rule stays visible in the
  // popup instead of being dropped by the normalize-on-commit filter.
  const [draftRules, setDraftRules] = useState<AdvancedModelMappingRule[]>(committedRules);
  const [dialogIndex, setDialogIndex] = useState<number | null>(null);
  const [dialogRule, setDialogRule] = useState<AdvancedModelMappingRule | null>(null);

  useEffect(() => {
    setDraftRules(committedRules);
  }, [committedRules]);

  const commit = (next: AdvancedModelMappingRule[]) => {
    setDraftRules(next);
    onChange(normalizeAdvancedModelMapping(next));
  };

  const openAddDialog = () => {
    setDialogRule({ requestModel: "", targetModel: "", enabled: true } as AdvancedModelMappingRule);
    setDialogIndex(null);
  };
  const openEditDialog = (index: number) => {
    const rule = draftRules[index];
    if (!rule) return;
    setDialogRule({ ...rule });
    setDialogIndex(index);
  };
  const closeDialog = () => {
    setDialogRule(null);
    setDialogIndex(null);
  };
  const saveDialog = () => {
    if (!dialogRule) return;
    const next = dialogIndex === null
      ? [...draftRules, dialogRule]
      : draftRules.map((rule, i) => (i === dialogIndex ? dialogRule : rule));
    commit(next);
    closeDialog();
  };
  const removeRule = (index: number) => {
    commit(draftRules.filter((_, i) => i !== index));
  };

  const dialogProvider = dialogRule?.targetProviderId ? providers.find((p) => p.id === dialogRule.targetProviderId) : undefined;

  return (
    <Box sx={{ borderRadius: 1, border: 1, borderColor: "divider" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1, py: 0.5 }}>
        <FormControlLabel
          control={
            <IconButton size="small" onClick={onToggleOpen} aria-label={t("settings.relay.advancedMappingToggle")}>
              {open ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
            </IconButton>
          }
          label={
            <Typography variant="caption" sx={{ flex: 1 }}>
              {t("settings.relay.advancedMappingLabel")}
              {draftRules.length > 0 ? ` (${draftRules.length})` : ""}
            </Typography>
          }
          sx={{ mr: 1 }}
          onClick={onToggleOpen}
        />
        <Button size="small" startIcon={<AddIcon />} onClick={openAddDialog} sx={{ borderRadius: 999 }}>
          {t("settings.relay.advancedMappingAddRule")}
        </Button>
      </Stack>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <Box sx={{ px: 1, pb: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {t("settings.relay.advancedMappingHelp")}
          </Typography>
          {draftRules.length === 0 ? (
            <Typography variant="caption" color="text.disabled">
              {t("settings.relay.advancedMappingEmpty")}
            </Typography>
          ) : (
            <Stack spacing={1}>
              {draftRules.map((rule, index) => (
                <Stack key={index} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip
                    size="small"
                    label={`${rule.requestModel || "?"} → ${rule.targetProviderId ? (providers.find((p) => p.id === rule.targetProviderId)?.name ?? rule.targetProviderId) : t("settings.relay.advancedMappingSameChannel")}/${rule.targetGroupId ? (dialogProvider?.groups?.find((g) => g.id === rule.targetGroupId)?.name ?? rule.targetGroupId) : t("settings.relay.advancedMappingSameGroup")} : ${rule.targetModel || "?"}`}
                  />
                  {rule.enabled === false && (
                    <Typography variant="caption" color="text.disabled">{t("settings.relay.advancedMappingEnableRule")}</Typography>
                  )}
                  <IconButton size="small" onClick={() => openEditDialog(index)} aria-label={t("settings.relay.advancedMappingAddRule")}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => removeRule(index)} aria-label={t("settings.relay.advancedMappingRemoveRule")}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      </Collapse>

      <Dialog open={dialogRule !== null} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>
          {dialogIndex === null ? t("settings.relay.advancedMappingAddRule") : t("settings.relay.advancedMappingLabel")}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField
              size="small"
              fullWidth
              label={t("settings.relay.advancedMappingRequestModel")}
              value={dialogRule?.requestModel ?? ""}
              onChange={(event) => setDialogRule((current) => current ? { ...current, requestModel: event.target.value } : current)}
              placeholder="gpt-5"
            />
            <Select
              size="small"
              fullWidth
              value={dialogRule?.targetProviderId ?? ""}
              displayEmpty
              onChange={(event) => setDialogRule((current) => current ? { ...current, targetProviderId: event.target.value || undefined, targetGroupId: undefined } : current)}
              renderValue={(value) => value ? (providers.find((p) => p.id === value)?.name ?? value) : t("settings.relay.advancedMappingSameChannel")}
            >
              <MenuItem value="">{t("settings.relay.advancedMappingSameChannel")}</MenuItem>
              {providers.map((provider) => (
                <MenuItem key={provider.id} value={provider.id}>{provider.name}</MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              fullWidth
              value={dialogRule?.targetGroupId ?? ""}
              displayEmpty
              disabled={!dialogRule?.targetProviderId}
              onChange={(event) => setDialogRule((current) => current ? { ...current, targetGroupId: event.target.value || undefined } : current)}
              renderValue={(value) => {
                if (!value) return t("settings.relay.advancedMappingSameGroup");
                const g = dialogProvider?.groups?.find((entry) => entry.id === value);
                return g?.name ?? value;
              }}
            >
              <MenuItem value="">{t("settings.relay.advancedMappingSameGroup")}</MenuItem>
              {(dialogProvider?.groups ?? [])
                .filter((g) => g.kind !== "image")
                .map((g) => (
                  <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>
                ))}
            </Select>
            <TextField
              size="small"
              fullWidth
              label={t("settings.relay.advancedMappingActualModel")}
              value={dialogRule?.targetModel ?? ""}
              onChange={(event) => setDialogRule((current) => current ? { ...current, targetModel: event.target.value } : current)}
              placeholder="claude-3-5-sonnet"
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={dialogRule?.enabled !== false}
                  onChange={(event) => setDialogRule((current) => current ? { ...current, enabled: event.target.checked } : current)}
                />
              }
              label={t("settings.relay.advancedMappingEnableRule")}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>{t("settings.cancel") ?? "Cancel"}</Button>
          <Button variant="contained" onClick={saveDialog} disabled={!(dialogRule?.requestModel?.trim() && dialogRule?.targetModel?.trim())}>
            t("settings.permissions.save")
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function parseGroupMapping(value: string): ChannelGroupConfig["modelMapping"] {
  const entries = value
    .split(/\r?\n|,/)
    .map((entry) => {
      const [from, to] = entry.split("=").map((part) => part.trim());
      return from && to ? { from, to } : null;
    })
    .filter((entry): entry is { from: string; to: string } => Boolean(entry));
  return entries.length > 0 ? entries : undefined;
}

function isValidGroupMappingDraft(value: string): boolean {
  return mappingDraftLines(value).every((entry) => {
    const parts = entry.split("=");
    return parts.length === 2 && Boolean(parts[0]?.trim()) && Boolean(parts[1]?.trim());
  });
}

function formatStatusCodeMapping(value: ChannelGroupConfig["statusCodeMapping"]): string {
  return (value ?? []).map((entry) => `${entry.from}=${entry.to}`).join("\n");
}

function parseStatusCodeMapping(value: string): ChannelGroupConfig["statusCodeMapping"] {
  const entries = value
    .split(/\r?\n|,/)
    .map((entry) => {
      const [fromRaw, toRaw] = entry.split("=").map((part) => part.trim());
      const from = Number(fromRaw);
      const to = Number(toRaw);
      return isMappableHttpStatus(from) && isMappableHttpStatus(to) ? { from, to } : null;
    })
    .filter((entry): entry is { from: number; to: number } => Boolean(entry));
  return entries.length > 0 ? entries : undefined;
}

function isValidStatusCodeMappingDraft(value: string): boolean {
  return mappingDraftLines(value).every((entry) => {
    const parts = entry.split("=");
    if (parts.length !== 2) return false;
    return isMappableHttpStatus(Number(parts[0]?.trim())) && isMappableHttpStatus(Number(parts[1]?.trim()));
  });
}

function mappingDraftLines(value: string): string[] {
  return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
}

function isMappableHttpStatus(value: number): boolean {
  return Number.isInteger(value) && value >= 200 && value <= 599;
}

type QuickCodexConfigField = (typeof CODEX_CONFIG_FIELD_META)[number];

function localizeQuickCodexConfigField(
  field: QuickCodexConfigField,
  t: TranslateFn
): Pick<QuickCodexConfigField, "label" | "description" | "options"> {
  return {
    label: translateWithFallback(t, `settings.codex.quick.${field.key}.label`, field.label),
    description: translateWithFallback(t, `settings.codex.quick.${field.key}.description`, field.description),
    options: localizeCodexConfigOptions(field.options, t)
  };
}

function localizeCodexConfigOptions(
  options: Array<{ value: string; label: string }> | undefined,
  t: TranslateFn
): Array<{ value: string; label: string }> | undefined {
  return options?.map((option) => ({
    ...option,
    label: translateWithFallback(t, `settings.codex.option.${option.value}`, option.label)
  }));
}

function localizeDynamicCodexConfigLabel(field: DynamicCodexConfigField, t: TranslateFn): string {
  const direct = translateWithFallback(t, `settings.codex.dynamic.${field.keyPath}.label`, "");
  if (direct) {
    return direct;
  }
  return field.keyPath
    .split(".")
    .map((segment) => localizeCodexConfigSegment(segment, t))
    .join(" / ");
}

function localizeDynamicCodexConfigDescription(field: DynamicCodexConfigField, t: TranslateFn): string {
  return translateWithFallback(t, `settings.codex.dynamic.${field.keyPath}.description`, field.description);
}

function localizeCodexConfigSegment(segment: string, t: TranslateFn): string {
  const words = segment.split(/[_-]+/).filter(Boolean);
  if (words.length === 0) {
    return segment;
  }
  return words.map((word) => translateWithFallback(t, `settings.codex.segment.${word.toLowerCase()}`, labelFromRawConfigWord(word))).join(" ");
}

function labelFromRawConfigWord(word: string): string {
  return word.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function translateWithFallback(t: TranslateFn, key: string, fallback: string): string {
  const translated = t(key as TranslationKey);
  return translated === key ? fallback : translated;
}

function CodexConfigFieldRow({
  fieldKey,
  label,
  description,
  kind,
  options,
  readOnly,
  value,
  disabled,
  unsetLabel,
  onCommit
}: {
  fieldKey: CodexConfigFieldKey;
  label: string;
  description: string;
  kind: "text" | "select" | "textarea";
  options?: Array<{ value: string; label: string }>;
  readOnly?: boolean;
  value: string;
  disabled: boolean;
  unsetLabel: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value, fieldKey]);

  if (kind === "textarea") {
    return (
      <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25, mb: 1 }}>
          {description}
        </Typography>
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={3}
          maxRows={8}
          label={label}
          value={draft}
          disabled={disabled}
          inputProps={{ "aria-label": label, readOnly: Boolean(readOnly) }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (!readOnly && draft !== value) {
              onCommit(draft);
            }
          }}
        />
      </Box>
    );
  }

  return (
    <SettingRow title={label} description={description}>
      {kind === "select" ? (
        <FormControl size="small" sx={{ minWidth: 180 }} disabled={disabled}>
          <InputLabel id={`codex-config-${fieldKey}-label`}>{label}</InputLabel>
          <Select
            labelId={`codex-config-${fieldKey}-label`}
            label={label}
            value={value || ""}
            inputProps={{ "aria-label": label }}
            onChange={(event) => onCommit(event.target.value)}
          >
            {!value ? (
              <MenuItem value="">
                <em>{unsetLabel}</em>
              </MenuItem>
            ) : null}
            {(options ?? []).map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      ) : (
        <TextField
          size="small"
          label={label}
          value={draft}
          disabled={disabled}
          inputProps={{ "aria-label": label, readOnly: Boolean(readOnly) }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (!readOnly && draft !== value) {
              onCommit(draft);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !readOnly && draft !== value) {
              onCommit(draft);
            }
          }}
          sx={{ minWidth: 180 }}
        />
      )}
    </SettingRow>
  );
}

const DynamicCodexConfigFieldRow = memo(function DynamicCodexConfigFieldRow({
  field,
  value,
  disabled,
  t,
  onCommitValue
}: {
  field: DynamicCodexConfigField;
  value: unknown;
  disabled: boolean;
  t: TranslateFn;
  onCommitValue: (keyPath: string, value: JsonValue) => void;
}) {
  const localizedLabel = localizeDynamicCodexConfigLabel(field, t);
  const localizedDescription = localizeDynamicCodexConfigDescription(field, t);
  const localizedOptions = localizeCodexConfigOptions(field.options, t);
  const formattedValue = useMemo(() => formatConfigValueForField(field, value), [field, value]);
  const [draft, setDraft] = useState(formattedValue);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(formattedValue);
    setError(null);
  }, [formattedValue, field.keyPath]);

  const commitTextValue = () => {
    if (draft === formattedValue) {
      return;
    }
    const parsed = parseDynamicConfigFieldValue(field, draft);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onCommitValue(field.keyPath, parsed.value);
  };

  const fieldCaption = (
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {localizedLabel}
        </Typography>
        <Chip size="small" label={localizeCodexConfigSegment(field.group, t)} variant="outlined" />
        <Chip size="small" label={field.keyPath} variant="outlined" />
        {field.source === "runtime" ? <Chip size="small" label={t("settings.codex.runtime")} color="warning" variant="outlined" /> : null}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {localizedDescription}
      </Typography>
      {field.defaultValue !== undefined ? (
        <Typography variant="caption" color="text.secondary">
          {t("settings.codex.defaultValue", { value: formatDefaultValue(field.defaultValue) })}
        </Typography>
      ) : null}
    </Stack>
  );

  if (field.kind === "boolean") {
    return (
      <SettingRow title={fieldCaption} description={null}>
        <Switch
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => {
            const parsed = parseDynamicConfigFieldValue(field, event.target.checked);
            if (!("error" in parsed)) {
              onCommitValue(field.keyPath, parsed.value);
            }
          }}
          inputProps={{ "aria-label": localizedLabel }}
        />
      </SettingRow>
    );
  }

  if (field.kind === "select") {
    return (
      <SettingRow title={fieldCaption} description={null}>
        <FormControl size="small" sx={{ minWidth: 220 }} disabled={disabled}>
          <InputLabel id={`dynamic-codex-config-${field.keyPath}-label`}>{localizedLabel}</InputLabel>
          <Select
            labelId={`dynamic-codex-config-${field.keyPath}-label`}
            label={localizedLabel}
            value={formattedValue}
            inputProps={{ "aria-label": localizedLabel }}
            onChange={(event) => {
              const parsed = parseDynamicConfigFieldValue(field, event.target.value);
              if (!("error" in parsed)) {
                onCommitValue(field.keyPath, parsed.value);
              }
            }}
          >
            {!formattedValue ? (
              <MenuItem value="">
                <em>{t("settings.codex.unset")}</em>
              </MenuItem>
            ) : null}
            {(localizedOptions ?? []).map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </SettingRow>
    );
  }

  if (field.kind === "textarea" || field.kind === "json") {
    return (
      <Box sx={{ p: 1.5, borderTop: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
        {fieldCaption}
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={field.kind === "json" ? 4 : 3}
          maxRows={10}
          label={field.kind === "json" ? `${localizedLabel} JSON` : localizedLabel}
          value={draft}
          disabled={disabled}
          error={Boolean(error)}
          helperText={error ?? (field.kind === "json" ? t("settings.codex.editJsonHelp") : t("settings.codex.blurToSave"))}
          inputProps={{ "aria-label": localizedLabel }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitTextValue}
          sx={{ mt: 1 }}
        />
      </Box>
    );
  }

  return (
    <SettingRow title={fieldCaption} description={null}>
      <TextField
        size="small"
        label={localizedLabel}
        type={field.kind === "number" ? "number" : "text"}
        value={draft}
        disabled={disabled}
        error={Boolean(error)}
        helperText={error}
        inputProps={{ "aria-label": localizedLabel }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitTextValue}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commitTextValue();
          }
        }}
        sx={{ minWidth: 220 }}
      />
    </SettingRow>
  );
});

function formatDefaultValue(value: unknown): string {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function SettingsSection({
  icon,
  title,
  subtitle,
  children
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Box sx={{ pb: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        {icon}
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
          {title}
        </Typography>
      </Stack>
      {subtitle ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.25 }}>
          {subtitle}
        </Typography>
      ) : null}
      <Box
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          overflow: "hidden",
          bgcolor: "background.paper",
          boxShadow: (theme) =>
            theme.palette.mode === "light"
              ? "0 0 2px 0 rgba(145 158 171 / 0.2), 0 12px 24px -4px rgba(145 158 171 / 0.12)"
              : "0 0 0 1px rgba(255,255,255,0.04)"
        }}
      >
        {children}
      </Box>
    </Box>
  );
}



export function ProfileSettingsPanel({
  providerCount,
  onExportProfile,
  onImportProfile,
  onExportRelayConfig,
  onImportRelayConfig,
  t
}: {
  providerCount: number;
  onExportProfile: () => Promise<void>;
  onImportProfile: (file: File) => Promise<number>;
  onExportRelayConfig: () => Promise<void>;
  onImportRelayConfig: (file: File) => Promise<number>;
  t: TranslateFn;
}) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "background.default" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <DownloadIcon fontSize="small" />
        <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>
          {t("settings.profile.title")}
        </Typography>
        <Chip size="small" label={t("settings.profile.providerCount", { count: providerCount })} />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        {t("settings.profile.subtitle")}
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setStatus("");
            try {
              await onExportProfile();
              setStatus(t("settings.profile.exported"));
            } catch {
              setStatus(t("settings.profile.exportFailed"));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("settings.profile.export")}
        </Button>
        <Button size="small" variant="outlined" component="label" startIcon={<UploadFileIcon />} disabled={busy}>
          {t("settings.profile.import")}
          <input
            aria-label={t("settings.profile.import")}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) {
                return;
              }
              void (async () => {
                setBusy(true);
                setStatus("");
                try {
                  const count = await onImportProfile(file);
                  setStatus(t("settings.profile.importedCount", { count }));
                } catch {
                  setStatus(t("settings.profile.importFailed"));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          />
        </Button>
      </Stack>
      <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
        {t("settings.profile.relaySecretsWarning")}
      </Alert>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          startIcon={<DownloadIcon />}
          disabled={busy}
          onClick={async () => {
            if (!window.confirm(t("settings.profile.exportRelayConfirm"))) {
              return;
            }
            setBusy(true);
            setStatus("");
            try {
              await onExportRelayConfig();
              setStatus(t("settings.profile.relayExported"));
            } catch {
              setStatus(t("settings.profile.exportFailed"));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("settings.profile.exportRelayWithKeys")}
        </Button>
        <Button size="small" variant="outlined" color="warning" component="label" startIcon={<UploadFileIcon />} disabled={busy}>
          {t("settings.profile.importRelayWithKeys")}
          <input
            aria-label={t("settings.profile.importRelayWithKeys")}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file || !window.confirm(t("settings.profile.importRelayConfirm"))) {
                return;
              }
              void (async () => {
                setBusy(true);
                setStatus("");
                try {
                  const count = await onImportRelayConfig(file);
                  setStatus(t("settings.profile.importedCount", { count }));
                } catch {
                  setStatus(t("settings.profile.importFailed"));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          />
        </Button>
      </Stack>
      {status && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          {status}
        </Typography>
      )}
    </Paper>
  );
}

export function AuditSettingsPanel({
  events,
  onReload,
  t
}: {
  events: DangerousPermissionAuditEvent[];
  onReload: () => Promise<void>;
  t: TranslateFn;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "background.default" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <SecurityIcon fontSize="small" color={events.length ? "warning" : "inherit"} />
        <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>
          {t("settings.audit.title")}
        </Typography>
        <Chip size="small" label={events.length} color={events.length ? "warning" : "default"} />
        <Button
          size="small"
          startIcon={<RefreshIcon />}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onReload();
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("history.refresh")}
        </Button>
      </Stack>
      {events.length === 0 && <Typography color="text.secondary">{t("settings.audit.empty")}</Typography>}
      <Stack spacing={1}>
        {events.slice(0, 5).map((event) => (
          <Box key={event.id} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" color={event.severity === "critical" ? "error" : "warning"} label={event.severity} />
              <Typography variant="caption" sx={{ flex: 1, overflowWrap: "anywhere" }}>
                {event.method} {event.model ? `- ${event.model}` : ""}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, overflowWrap: "anywhere" }}>
              {formatAuditTime(event.createdAt)} {event.cwd ? `- ${event.cwd}` : ""} {event.threadId ? `- ${event.threadId}` : ""}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
              {event.reasons.join(", ")}
              {event.inputSummary ? ` - input ${event.inputSummary.items} items (${event.inputSummary.textItems} text, ${event.inputSummary.imageItems} images, ${event.inputSummary.mentionItems} mentions)` : ""}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}

function formatAuditTime(value: number): string {
  return new Date(value).toLocaleString();
}

export function SkillsSettingsPanel({
  tooling,
  extraRoots,
  previews,
  t,
  onToggleSkill,
  onSaveExtraRoots,
  onReadPreview,
  onCreateSkill
}: {
  tooling: ToolingState;
  extraRoots: string[];
  previews: Record<string, string>;
  t: TranslateFn;
  onToggleSkill: (skill: SkillEntry, enabled: boolean) => void;
  onSaveExtraRoots: (roots: string[]) => void;
  onReadPreview: (skill: SkillEntry) => void;
  onCreateSkill: (input: { name: string; description: string; instructions: string }) => Promise<void>;
}) {
  const [extraRootsText, setExtraRootsText] = useState(extraRoots.join("\n"));
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setExtraRootsText(extraRoots.join("\n"));
  }, [extraRoots]);

  const closeCreateDialog = () => {
    if (creating) return;
    setCreateOpen(false);
    setCreateError("");
  };

  const createSkill = async () => {
    const normalizedName = name.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedName)) {
      setCreateError(t("settings.skills.invalidName"));
      return;
    }
    if (!description.trim()) {
      setCreateError(t("settings.skills.descriptionRequired"));
      return;
    }
    if (!instructions.trim()) {
      setCreateError(t("settings.skills.instructionsRequired"));
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      await onCreateSkill({ name: normalizedName, description: description.trim(), instructions: instructions.trim() });
      setCreateOpen(false);
      setName("");
      setDescription("");
      setInstructions("");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Stack spacing={1.25} sx={{ p: 1.5 }}>
      <Paper variant="outlined" sx={{ p: 1.25, bgcolor: "background.default" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          {t("settings.skills.title")}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t("settings.skills.subtitle")}
        </Typography>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)} sx={{ mt: 1, alignSelf: "flex-start" }}>
          {t("settings.skills.create")}
        </Button>
        <TextField
          sx={{ mt: 1 }}
          size="small"
          fullWidth
          multiline
          minRows={3}
          label={t("settings.skills.extraRoots")}
          value={extraRootsText}
          onChange={(event) => setExtraRootsText(event.target.value)}
        />
        <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
          <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={() => onSaveExtraRoots(parseLines(extraRootsText))}>
            {t("settings.skills.saveRoots")}
          </Button>
          <Chip size="small" label={t("settings.skills.savedCount", { count: extraRoots.length })} />
        </Stack>
      </Paper>

      {tooling.skillGroups.length === 0 && (
        <Typography color="text.secondary" sx={{ p: 1.5, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
          {t("settings.skills.empty")}
        </Typography>
      )}

      {tooling.skillGroups.map((group) => (
        <Paper key={group.cwd} variant="outlined" sx={{ p: 1.25, bgcolor: "background.default" }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
                {group.cwd}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {group.skills.length} skills / {group.errors.length} errors
              </Typography>
            </Box>
            <Chip size="small" label={group.skills.length} />
          </Stack>
          {group.errors.map((error) => (
            <Alert key={`${error.path}:${error.message}`} severity="warning" sx={{ mt: 1 }}>
              {error.path}: {error.message}
            </Alert>
          ))}
          <Stack spacing={1} sx={{ mt: 1 }}>
            {group.skills.map((skill) => (
              <Box key={skill.path || skill.name} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
                      {skill.displayName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                      {skill.shortDescription || skill.description || skill.path}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={skill.scope} />
                    <FormControlLabel
                      sx={{ mr: 0 }}
                      control={<Switch size="small" checked={skill.enabled} onChange={(event) => onToggleSkill(skill, event.target.checked)} />}
                      label={skill.enabled ? t("settings.skills.enabled") : t("settings.skills.disabled")}
                    />
                  </Stack>
                </Stack>
                {skill.path && (
                  <Stack spacing={0.75} sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                      {skill.path}
                    </Typography>
                    <Button size="small" onClick={() => onReadPreview(skill)} sx={{ alignSelf: "flex-start" }}>
                      {t("settings.skills.previewMarkdown")}
                    </Button>
                    {previews[skill.path] && (
                      <Typography component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere", m: 0, maxHeight: 240, overflow: "auto" }}>
                        {previews[skill.path]}
                      </Typography>
                    )}
                  </Stack>
                )}
              </Box>
            ))}
          </Stack>
        </Paper>
      ))}
      <Dialog open={createOpen} onClose={closeCreateDialog} fullWidth maxWidth="sm">
        <DialogTitle>{t("settings.skills.create")}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">{t("settings.skills.createHint")}</Typography>
            {createError && <Alert severity="error">{createError}</Alert>}
            <TextField autoFocus required label={t("settings.skills.name")} value={name} onChange={(event) => setName(event.target.value)} helperText={t("settings.skills.nameHint")} />
            <TextField required label={t("settings.skills.description")} value={description} onChange={(event) => setDescription(event.target.value)} />
            <TextField required multiline minRows={9} label={t("settings.skills.instructions")} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCreateDialog} disabled={creating}>{t("settings.cancel")}</Button>
          <Button variant="contained" onClick={() => void createSkill()} disabled={creating} startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}>
            {t("settings.skills.create")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export function ThemeModeCards({
  themeMode,
  onThemeModeChange,
  t
}: {
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  t: TranslateFn;
}) {
  const cards: Array<{
    mode: ThemeMode;
    label: string;
    description: string;
    icon: ReactNode;
    swatches: string[];
  }> = [
    {
      mode: "system",
      label: t("settings.appearance.system"),
      description: t("settings.appearance.systemDescription"),
      icon: <ComputerIcon fontSize="small" />,
      swatches: ["#F8FAF5", "#FFFFFF", "#111827"]
    },
    {
      mode: "official-light",
      label: t("settings.appearance.light"),
      description: t("settings.appearance.lightDescription"),
      icon: <LightModeIcon fontSize="small" />,
      swatches: ["#FFFFFF", "#E5E7EB", "#1877F2"]
    },
    {
      mode: "codex-light",
      label: t("settings.appearance.codexLight"),
      description: t("settings.appearance.codexLightDescription"),
      icon: <LightModeIcon fontSize="small" />,
      swatches: ["#FFFFFF", "#F5F5F5", "#339CFF"]
    },
    {
      mode: "official-black",
      label: t("settings.appearance.dark"),
      description: t("settings.appearance.darkDescription"),
      icon: <DarkModeIcon fontSize="small" />,
      swatches: ["#070A0E", "#10161D", "#61F3F3"]
    },
    {
      mode: "codex-dark",
      label: t("settings.appearance.codexDark"),
      description: t("settings.appearance.codexDarkDescription"),
      icon: <DarkModeIcon fontSize="small" />,
      swatches: ["#181818", "#202020", "#339CFF"]
    },
    {
      mode: "chatgpt",
      label: t("settings.appearance.chatgpt"),
      description: t("settings.appearance.chatgptDescription"),
      icon: <AutoAwesomeIcon fontSize="small" />,
      swatches: ["#FFFFFF", "#F4F4F4", "#10a37f"]
    }
  ];

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1.5 }}>
      {cards.map((card) => {
        const active =
          themeMode === card.mode ||
          (card.mode === "official-light" &&
            (themeMode === "codex" || themeMode === "atmospheric-codex" || themeMode === "dollar-green" || themeMode === "sakura-pink" || themeMode === "claude-warm")) ||
          (card.mode === "official-black" && (themeMode === "studio-black-gold" || themeMode === "developer-leaf"));
        return (
          <Button
            key={card.mode}
            variant="outlined"
            color={active ? "primary" : "inherit"}
            onClick={() => onThemeModeChange(card.mode)}
            sx={{
              p: 1,
              minHeight: 132,
              borderColor: active ? "primary.main" : "divider",
              bgcolor: active ? "action.selected" : "background.default",
              justifyContent: "stretch",
              textAlign: "left"
            }}
          >
            <Stack spacing={1} sx={{ width: "100%" }}>
              <Box
                sx={{
                  height: 58,
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                  overflow: "hidden",
                  display: "grid",
                  gridTemplateColumns: "1fr 1.45fr"
                }}
              >
                <Box sx={{ bgcolor: card.swatches[0], borderRight: "1px solid", borderColor: "divider", p: 0.75 }}>
                  <Box sx={{ height: 8, width: "70%", bgcolor: card.swatches[1], borderRadius: 0.5, mb: 0.75 }} />
                  <Box sx={{ height: 7, width: "52%", bgcolor: card.swatches[2], opacity: 0.5, borderRadius: 0.5 }} />
                </Box>
                <Box sx={{ bgcolor: card.swatches[1], p: 0.75 }}>
                  <Box sx={{ height: 10, width: "35%", bgcolor: card.swatches[2], borderRadius: 0.5, mb: 0.75 }} />
                  <Box sx={{ height: 16, width: "100%", bgcolor: card.mode === "official-black" ? "#252A3A" : "#E5E7EB", borderRadius: 0.75 }} />
                </Box>
              </Box>
              <Stack direction="row" spacing={0.75} alignItems="center">
                {card.icon}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>
                    {card.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {card.description}
                  </Typography>
                </Box>
                {active ? <CheckCircleIcon fontSize="small" color="primary" /> : <Radio size="small" checked={false} />}
              </Stack>
            </Stack>
          </Button>
        );
      })}
    </Box>
  );
}

export function ThemePluginManager({
  plugins,
  activeThemeId,
  installedThemePluginIds,
  onThemeModeChange,
  onInstallThemePlugin,
  onUninstallThemePlugin,
  onEditCustomThemePlugin,
  onRemoveCustomThemePlugin,
  t
}: {
  plugins: ThemePlugin[];
  activeThemeId: ThemeMode;
  installedThemePluginIds: ThemeId[];
  onThemeModeChange: (mode: ThemeMode) => void;
  onInstallThemePlugin: (id: ThemeId) => void;
  onUninstallThemePlugin: (id: ThemeId) => void;
  onEditCustomThemePlugin: (plugin: ThemePlugin) => void;
  onRemoveCustomThemePlugin: (id: ThemeId) => void;
  t: TranslateFn;
}) {
  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider" }}>
      {plugins.map((plugin) => {
        const installed = installedThemePluginIds.includes(plugin.id);
        const active = activeThemeId === plugin.id;
        const removable = plugin.source !== "official" && installed && !active;
        const deletable = plugin.source === "user-defined" && !active;
        return (
          <Stack
            key={plugin.id}
            direction={{ xs: "column", sm: "row" }}
            spacing={1.25}
            alignItems={{ xs: "stretch", sm: "center" }}
            sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={0.25} sx={{ flex: "0 0 auto" }} aria-hidden>
                {[plugin.preview.primary, plugin.preview.secondary, plugin.preview.background].map((color) => (
                  <Box
                    key={`${plugin.id}-${color}`}
                    sx={{
                      width: 18,
                      height: 28,
                      bgcolor: color,
                      borderRadius: 0.75,
                      border: "1px solid",
                      borderColor: "divider"
                    }}
                  />
                ))}
              </Stack>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {plugin.name}
                  </Typography>
                  <Chip
                    size="small"
                    label={
                      plugin.source === "official"
                        ? t("settings.theme.source.official")
                        : plugin.source === "customer-slot"
                          ? t("settings.theme.source.customer")
                          : plugin.source === "user-defined"
                            ? t("settings.theme.source.user")
                            : t("settings.theme.source.local")
                    }
                  />
                  {active && <Chip size="small" label={t("settings.theme.active")} color="primary" />}
                  {plugin.assets && <Chip size="small" label={t("settings.theme.media")} variant="outlined" />}
                  {plugin.assets?.petImage && <Chip size="small" label={t("settings.theme.avatar")} variant="outlined" />}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
                  {plugin.description}
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={1} justifyContent={{ xs: "flex-start", sm: "flex-end" }}>
              {installed ? (
                <Button size="small" variant={active ? "contained" : "outlined"} disabled={active} onClick={() => onThemeModeChange(plugin.id)}>
                  {active ? t("settings.theme.activeButton") : t("settings.theme.switch")}
                </Button>
              ) : (
                <Button size="small" variant="outlined" startIcon={<ExtensionIcon />} onClick={() => onInstallThemePlugin(plugin.id)}>
                  {t("settings.theme.install")}
                </Button>
              )}
              {removable && (
                <Button size="small" color="inherit" onClick={() => onUninstallThemePlugin(plugin.id)}>
                  {t("settings.theme.remove")}
                </Button>
              )}
              {plugin.source === "user-defined" && (
                <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => onEditCustomThemePlugin(plugin)} aria-label={t("settings.theme.editAria", { name: plugin.name })}>
                  {t("settings.theme.edit")}
                </Button>
              )}
              {deletable && (
                <IconButton size="small" aria-label={t("settings.theme.deleteAria", { name: plugin.name })} onClick={() => onRemoveCustomThemePlugin(plugin.id)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>
          </Stack>
        );
      })}
    </Box>
  );
}

function CustomThemePluginEditor({
  editingPlugin,
  onCancelEdit,
  onSave,
  t
}: {
  editingPlugin: ThemePlugin | null;
  onCancelEdit: () => void;
  onSave: (plugin: ThemePlugin) => void;
  t: TranslateFn;
}) {
  const [name, setName] = useState(t("settings.theme.myStudio"));
  const [description, setDescription] = useState(t("settings.theme.defaultDescription"));
  const [primary, setPrimary] = useState("#0F766E");
  const [secondary, setSecondary] = useState("#F59E0B");
  const [background, setBackground] = useState("#F8FAFC");
  const [appBackgroundImage, setAppBackgroundImage] = useState("");
  const [appBackgroundVideo, setAppBackgroundVideo] = useState("");
  const [composerBackgroundImage, setComposerBackgroundImage] = useState("");
  const [welcomeBackgroundImage, setWelcomeBackgroundImage] = useState("");
  const [historyBackgroundImage, setHistoryBackgroundImage] = useState("");
  const [heroImage, setHeroImage] = useState("");
  const [cornerImage, setCornerImage] = useState("");
  const [petImage, setPetImage] = useState("");
  const [petEnabled, setPetEnabled] = useState(true);
  const [decorationIntensity, setDecorationIntensity] = useState<"none" | "subtle" | "rich">("subtle");
  const [useBackgroundAsHero, setUseBackgroundAsHero] = useState(true);
  const [backgroundLayerOpacity, setBackgroundLayerOpacity] = useState(unitToPercent(REFERENCE_BACKGROUND_TUNING.backgroundLayerOpacity));
  const [backgroundOverlayOpacity, setBackgroundOverlayOpacity] = useState(unitToPercent(REFERENCE_BACKGROUND_TUNING.backgroundOverlayOpacity));
  const [effectsLayerOpacity, setEffectsLayerOpacity] = useState(unitToPercent(REFERENCE_BACKGROUND_TUNING.effectsLayerOpacity));
  const [workspaceSurfaceOpacity, setWorkspaceSurfaceOpacity] = useState(unitToPercent(REFERENCE_BACKGROUND_TUNING.workspaceSurfaceOpacity));
  const [heroOverlayOpacity, setHeroOverlayOpacity] = useState(unitToPercent(REFERENCE_BACKGROUND_TUNING.heroOverlayOpacity));
  const [panelSurfaceOpacity, setPanelSurfaceOpacity] = useState(unitToPercent(REFERENCE_BACKGROUND_TUNING.panelSurfaceOpacity));
  const [blurStrength, setBlurStrength] = useState(REFERENCE_BACKGROUND_TUNING.blurStrength);
  const [toneColor, setToneColor] = useState(REFERENCE_BACKGROUND_TUNING.toneColor);
  const [toneOpacity, setToneOpacity] = useState(unitToPercent(REFERENCE_BACKGROUND_TUNING.toneOpacity));
  const [sceneRenderer, setSceneRenderer] = useState<"none" | "canvas" | "three">("none");
  const [scenePreset, setScenePreset] = useState<ThemeBackgroundScene["preset"]>("aurora");
  const [sceneColor, setSceneColor] = useState(REFERENCE_BACKGROUND_TUNING.toneColor);
  const [sceneSecondaryColor, setSceneSecondaryColor] = useState("#F8B4C4");
  const [sceneSpeed, setSceneSpeed] = useState(0.65);
  const [sceneDensity, setSceneDensity] = useState(55);
  const [sceneOpacity, setSceneOpacity] = useState(54);
  const [dark, setDark] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backgroundFileRef = useRef<HTMLInputElement | null>(null);
  const videoFileRef = useRef<HTMLInputElement | null>(null);
  const themeImportRef = useRef<HTMLInputElement | null>(null);
  const safeBackgroundPreview = isSafeThemeImageUrl(appBackgroundImage) ? appBackgroundImage.trim() : "";
  const safeVideoPreview = isSafeThemeVideoUrl(appBackgroundVideo) ? appBackgroundVideo.trim() : "";
  const editing = Boolean(editingPlugin);

  useEffect(() => {
    if (!editingPlugin) {
      return;
    }
    loadThemeDraft(editingPlugin);
  }, [editingPlugin]);

  function resetDraft() {
    setName(t("settings.theme.myStudio"));
    setDescription(t("settings.theme.defaultDescription"));
    setPrimary("#0F766E");
    setSecondary("#F59E0B");
    setBackground("#F8FAFC");
    setAppBackgroundImage("");
    setAppBackgroundVideo("");
    setComposerBackgroundImage("");
    setWelcomeBackgroundImage("");
    setHistoryBackgroundImage("");
    setHeroImage("");
    setCornerImage("");
    setPetImage("");
    setPetEnabled(true);
    setUseBackgroundAsHero(true);
    setDecorationIntensity("subtle");
    setBackgroundLayerOpacity(unitToPercent(REFERENCE_BACKGROUND_TUNING.backgroundLayerOpacity));
    setBackgroundOverlayOpacity(unitToPercent(REFERENCE_BACKGROUND_TUNING.backgroundOverlayOpacity));
    setEffectsLayerOpacity(unitToPercent(REFERENCE_BACKGROUND_TUNING.effectsLayerOpacity));
    setWorkspaceSurfaceOpacity(unitToPercent(REFERENCE_BACKGROUND_TUNING.workspaceSurfaceOpacity));
    setHeroOverlayOpacity(unitToPercent(REFERENCE_BACKGROUND_TUNING.heroOverlayOpacity));
    setPanelSurfaceOpacity(unitToPercent(REFERENCE_BACKGROUND_TUNING.panelSurfaceOpacity));
    setBlurStrength(REFERENCE_BACKGROUND_TUNING.blurStrength);
    setToneColor(REFERENCE_BACKGROUND_TUNING.toneColor);
    setToneOpacity(unitToPercent(REFERENCE_BACKGROUND_TUNING.toneOpacity));
    setSceneRenderer("none");
    setScenePreset("aurora");
    setSceneColor(REFERENCE_BACKGROUND_TUNING.toneColor);
    setSceneSecondaryColor("#F8B4C4");
    setSceneSpeed(0.65);
    setSceneDensity(55);
    setSceneOpacity(54);
    setDark(false);
    setError(null);
  }

  function buildThemePluginDraft(overrides: Partial<ThemePlugin["assets"]> = {}): ThemePlugin | null {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("settings.theme.errorNameRequired"));
      return null;
    }
    if (![primary, secondary, background].every((value) => isHexColor(value.trim()))) {
      setError(t("settings.theme.errorPreviewHex"));
      return null;
    }
    const nextAppBackgroundImage = overrides.appBackgroundImage ?? appBackgroundImage;
    const nextAppBackgroundVideo = overrides.appBackgroundVideo ?? appBackgroundVideo;
    const nextComposerBackgroundImage = overrides.composerBackgroundImage ?? composerBackgroundImage;
    const nextWelcomeBackgroundImage = overrides.welcomeBackgroundImage ?? welcomeBackgroundImage;
    const nextHistoryBackgroundImage = overrides.historyBackgroundImage ?? historyBackgroundImage;
    const nextHeroImage = overrides.heroImage ?? heroImage;
    const nextCornerImage = overrides.cornerImage ?? cornerImage;
    const nextPetImage = overrides.petImage ?? petImage;
    const imageFields = [nextAppBackgroundImage, nextComposerBackgroundImage, nextWelcomeBackgroundImage, nextHistoryBackgroundImage, nextHeroImage, nextCornerImage, nextPetImage].map((value) => value.trim()).filter(Boolean);
    if (!imageFields.every(isSafeThemeImageUrl)) {
      setError(t("settings.theme.errorImageUrl"));
      return null;
    }
    if (nextAppBackgroundVideo.trim() && !isSafeThemeVideoUrl(nextAppBackgroundVideo)) {
      setError(t("settings.theme.errorVideoUrl"));
      return null;
    }
    if (![toneColor, sceneColor, sceneSecondaryColor].every((value) => isHexColor(value.trim()))) {
      setError(t("settings.theme.errorToneHex"));
      return null;
    }
    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28);
    const id = editingPlugin?.id ?? (`user-${slug || "theme"}-${Math.random().toString(36).slice(2, 7)}` as ThemeId);
    const assets = removeEmptyThemeAssets({
      appBackgroundImage: nextAppBackgroundImage.trim(),
      appBackgroundVideo: nextAppBackgroundVideo.trim(),
      composerBackgroundImage: nextComposerBackgroundImage.trim(),
      welcomeBackgroundImage: nextWelcomeBackgroundImage.trim(),
      historyBackgroundImage: nextHistoryBackgroundImage.trim(),
      heroImage: nextHeroImage.trim(),
      cornerImage: nextCornerImage.trim(),
      petImage: nextPetImage.trim()
    });
    const backgroundScene =
      sceneRenderer === "none"
        ? undefined
        : {
            renderer: sceneRenderer,
            preset: scenePreset,
            color: sceneColor.trim(),
            secondaryColor: sceneSecondaryColor.trim(),
            speed: clampDecimal(sceneSpeed, 0.65, 0.1, 3),
            density: percentToUnit(sceneDensity),
            opacity: percentToUnit(sceneOpacity)
          };
    setError(null);
    return {
      id,
      name: trimmed,
      description: description.trim() || t("settings.theme.defaultDescription"),
      source: "user-defined",
      installedByDefault: false,
      preview: {
        primary: primary.trim(),
        secondary: secondary.trim(),
        background: background.trim()
      },
      dark,
      assets,
      layout: {
        heroEnabled: Boolean(nextHeroImage.trim() || nextWelcomeBackgroundImage.trim()) || (useBackgroundAsHero && Boolean(nextAppBackgroundImage.trim())),
        petEnabled,
        decorationIntensity,
        backgroundLayerOpacity: percentToUnit(backgroundLayerOpacity),
        backgroundOverlayOpacity: percentToUnit(backgroundOverlayOpacity),
        effectsLayerOpacity: percentToUnit(effectsLayerOpacity),
        workspaceSurfaceOpacity: percentToUnit(workspaceSurfaceOpacity),
        heroOverlayOpacity: percentToUnit(heroOverlayOpacity),
        panelSurfaceOpacity: percentToUnit(panelSurfaceOpacity),
        blurStrength: clampThemeBlur(blurStrength),
        toneColor: toneColor.trim(),
        toneOpacity: percentToUnit(toneOpacity),
        backgroundScene
      }
    };
  }

  function loadThemeDraft(plugin: ThemePlugin) {
    setName(plugin.name);
    setDescription(plugin.description);
    setPrimary(plugin.preview.primary);
    setSecondary(plugin.preview.secondary);
    setBackground(plugin.preview.background);
    setAppBackgroundImage(plugin.assets?.appBackgroundImage ?? "");
    setAppBackgroundVideo(plugin.assets?.appBackgroundVideo ?? "");
    setComposerBackgroundImage(plugin.assets?.composerBackgroundImage ?? "");
    setWelcomeBackgroundImage(plugin.assets?.welcomeBackgroundImage ?? "");
    setHistoryBackgroundImage(plugin.assets?.historyBackgroundImage ?? "");
    setHeroImage(plugin.assets?.heroImage ?? "");
    setCornerImage(plugin.assets?.cornerImage ?? "");
    setPetImage(plugin.assets?.petImage ?? "");
    setPetEnabled(plugin.layout?.petEnabled !== false);
    setUseBackgroundAsHero(plugin.layout?.heroEnabled !== false);
    setDecorationIntensity(plugin.layout?.decorationIntensity ?? "subtle");
    const tuning = themeVisualTuning(plugin);
    setBackgroundLayerOpacity(unitToPercent(tuning.backgroundLayerOpacity));
    setBackgroundOverlayOpacity(unitToPercent(tuning.backgroundOverlayOpacity));
    setEffectsLayerOpacity(unitToPercent(tuning.effectsLayerOpacity));
    setWorkspaceSurfaceOpacity(unitToPercent(tuning.workspaceSurfaceOpacity));
    setHeroOverlayOpacity(unitToPercent(tuning.heroOverlayOpacity));
    setPanelSurfaceOpacity(unitToPercent(tuning.panelSurfaceOpacity));
    setBlurStrength(tuning.blurStrength);
    setToneColor(tuning.toneColor);
    setToneOpacity(unitToPercent(tuning.toneOpacity));
    const scene = plugin.layout?.backgroundScene;
    setSceneRenderer(scene?.renderer ?? "none");
    setScenePreset(scene?.preset ?? "aurora");
    setSceneColor(scene?.color && isHexColor(scene.color) ? scene.color : tuning.toneColor);
    setSceneSecondaryColor(scene?.secondaryColor && isHexColor(scene.secondaryColor) ? scene.secondaryColor : "#F8B4C4");
    setSceneSpeed(clampDecimal(scene?.speed, 0.65, 0.1, 3));
    setSceneDensity(unitToPercent(scene?.density ?? 0.55));
    setSceneOpacity(unitToPercent(scene?.opacity ?? 0.54));
    setDark(Boolean(plugin.dark));
    setError(null);
  }

  function exportThemeDraft() {
    const plugin = buildThemePluginDraft();
    if (!plugin) {
      return;
    }
    const blob = new Blob([`${JSON.stringify(plugin, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${plugin.id}.theme.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function exportThemeZipDraft() {
    const plugin = buildThemePluginDraft();
    if (!plugin) {
      return;
    }
    try {
      const blob = await createThemeZipBlob(plugin);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${plugin.id}.theme.zip`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (zipError) {
      setError(zipError instanceof Error ? zipError.message : String(zipError));
    }
  }

  return (
    <Box sx={{ p: 1.5, borderTop: "1px solid", borderColor: "divider", bgcolor: "background.default" }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <AddIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          {editing ? t("settings.theme.editPlugin") : t("settings.theme.definePlugin")}
        </Typography>
        {editing && (
          <Button
            size="small"
            color="inherit"
            onClick={() => {
              resetDraft();
              onCancelEdit();
            }}
          >
            {t("settings.theme.newTheme")}
          </Button>
        )}
      </Stack>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <TextField size="small" label={t("settings.theme.name")} value={name} onChange={(event) => setName(event.target.value)} sx={{ flex: 1 }} inputProps={{ "aria-label": t("settings.theme.name") }} />
          <TextField
            size="small"
            label={t("settings.theme.description")}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            sx={{ flex: 1.4 }}
            inputProps={{ "aria-label": t("settings.theme.description") }}
          />
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
          <TextField size="small" label={t("settings.theme.primary")} value={primary} onChange={(event) => setPrimary(event.target.value)} inputProps={{ "aria-label": t("settings.theme.primary") }} />
          <TextField size="small" label={t("settings.theme.secondary")} value={secondary} onChange={(event) => setSecondary(event.target.value)} inputProps={{ "aria-label": t("settings.theme.secondary") }} />
          <TextField size="small" label={t("settings.theme.background")} value={background} onChange={(event) => setBackground(event.target.value)} inputProps={{ "aria-label": t("settings.theme.background") }} />
          <FormControlLabel control={<Switch checked={dark} onChange={(event) => setDark(event.target.checked)} inputProps={{ "aria-label": t("settings.appearance.dark") }} />} label={t("settings.appearance.dark")} />
        </Stack>
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
            {t("settings.theme.mediaAssets")}
          </Typography>
          <Paper
            variant="outlined"
            sx={{
              minHeight: 132,
              borderRadius: 1,
              overflow: "hidden",
              position: "relative",
              bgcolor: "background.paper",
              backgroundImage: safeBackgroundPreview
                ? (theme) =>
                    [
                      `linear-gradient(90deg, rgba(255,255,255,${Math.min(0.9, percentToUnit(heroOverlayOpacity) + 0.14)}) 0%, rgba(255,255,255,${percentToUnit(heroOverlayOpacity)}) 48%, rgba(255,255,255,${Math.max(0, percentToUnit(heroOverlayOpacity) * 0.28)}) 100%)`,
                      `url("${safeBackgroundPreview}")`
                    ].join(", ")
                : (theme) =>
                    [
                      `linear-gradient(135deg, ${theme.palette.background.paper}, ${theme.palette.background.default})`,
                      `radial-gradient(circle at 82% 20%, ${primary}33, transparent 34%)`
                    ].join(", "),
              backgroundSize: safeBackgroundPreview ? "cover" : "auto",
              backgroundPosition: "center"
            }}
            data-testid="custom-theme-background-preview"
          >
            <Stack spacing={1} sx={{ p: 1.5, maxWidth: 440, position: "relative", zIndex: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                {t("settings.theme.previewTitle")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("settings.theme.previewDescription")}
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {[primary, secondary, background].map((color) => (
                  <Box key={color} sx={{ width: 28, height: 28, borderRadius: 0.75, bgcolor: color, border: "1px solid", borderColor: "divider" }} />
                ))}
                {safeBackgroundPreview && <Chip size="small" label={appBackgroundImage.startsWith("data:image/") ? t("settings.theme.localImage") : t("settings.theme.remoteImage")} color="primary" />}
                {appBackgroundImage.trim().toLowerCase().includes("gif") && <Chip size="small" label={t("settings.theme.gifReady")} color="primary" variant="outlined" />}
                {safeVideoPreview && <Chip size="small" label={appBackgroundVideo.startsWith("data:video/") ? t("settings.theme.localVideo") : t("settings.theme.remoteVideo")} color="secondary" />}
              </Stack>
            </Stack>
          </Paper>
          <ThemeMediaField label={t("settings.theme.mainChatBackground")} value={appBackgroundImage} onChange={setAppBackgroundImage} onClear={() => setAppBackgroundImage("")} t={t}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={() => backgroundFileRef.current?.click()}
              aria-label={t("settings.theme.chooseImage")}
              sx={{ flex: "0 0 auto" }}
            >
              {t("settings.theme.chooseImage")}
            </Button>
            <input
              ref={backgroundFileRef}
              type="file"
              aria-label="Background image file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                event.currentTarget.value = "";
                if (!file) {
                  return;
                }
                void readThemeImageFile(file)
                  .then((url) => {
                    setAppBackgroundImage(url);
                    setAppBackgroundVideo("");
                  })
                  .catch((imageError) => {
                    setError(imageError instanceof Error ? imageError.message : String(imageError));
                  });
              }}
            />
          </ThemeMediaField>
          <ThemeMediaField label={t("settings.theme.welcomeBackground")} value={welcomeBackgroundImage} onChange={setWelcomeBackgroundImage} onClear={() => setWelcomeBackgroundImage("")} t={t} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
            <ThemeMediaField label={t("settings.theme.composerBackground")} value={composerBackgroundImage} onChange={setComposerBackgroundImage} onClear={() => setComposerBackgroundImage("")} t={t} />
            <ThemeMediaField label={t("settings.theme.historyBackground")} value={historyBackgroundImage} onChange={setHistoryBackgroundImage} onClear={() => setHistoryBackgroundImage("")} t={t} />
          </Stack>
          <ThemeMediaField label={t("settings.theme.legacyHeroImage")} value={heroImage} onChange={setHeroImage} onClear={() => setHeroImage("")} t={t} />
          <ThemeMediaField label={t("settings.theme.workbenchVideo")} value={appBackgroundVideo} onChange={setAppBackgroundVideo} onClear={() => setAppBackgroundVideo("")} t={t}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={() => videoFileRef.current?.click()}
              aria-label={t("settings.theme.chooseVideo")}
              sx={{ flex: "0 0 auto" }}
            >
              {t("settings.theme.chooseVideo")}
            </Button>
            <input
              ref={videoFileRef}
              type="file"
              aria-label="Background video file"
              accept="video/mp4,video/webm"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                event.currentTarget.value = "";
                if (!file) {
                  return;
                }
                void readThemeVideoFile(file)
                  .then((url) => {
                    setAppBackgroundVideo(url);
                    setError(null);
                  })
                  .catch((videoError) => {
                    setError(videoError instanceof Error ? videoError.message : String(videoError));
                  });
              }}
            />
          </ThemeMediaField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
            <ThemeMediaField label={t("settings.theme.cornerImage")} value={cornerImage} onChange={setCornerImage} onClear={() => setCornerImage("")} t={t} />
            <ThemeMediaField label={t("settings.theme.petImage")} value={petImage} onChange={setPetImage} onClear={() => setPetImage("")} t={t} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
            <FormControl size="small" sx={{ minWidth: 190 }}>
              <InputLabel>{t("settings.theme.decorations")}</InputLabel>
              <Select
                value={decorationIntensity}
                label={t("settings.theme.decorations")}
                inputProps={{ "aria-label": t("settings.theme.decorations") }}
                onChange={(event) => setDecorationIntensity(event.target.value as "none" | "subtle" | "rich")}
              >
                <MenuItem value="none">{t("settings.theme.none")}</MenuItem>
                <MenuItem value="subtle">{t("settings.theme.subtle")}</MenuItem>
                <MenuItem value="rich">{t("settings.theme.rich")}</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={<Switch checked={petEnabled} onChange={(event) => setPetEnabled(event.target.checked)} inputProps={{ "aria-label": t("settings.theme.showPet") }} />}
              label={t("settings.theme.showPet")}
            />
            <FormControlLabel
              control={<Switch checked={useBackgroundAsHero} onChange={(event) => setUseBackgroundAsHero(event.target.checked)} inputProps={{ "aria-label": t("settings.theme.useBackgroundAsHero") }} />}
              label={t("settings.theme.useBackgroundAsHero")}
            />
          </Stack>
          <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1, bgcolor: "background.paper" }}>
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                {t("settings.theme.backgroundTuning")}
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1 }}>
                <ThemeNumberField label={t("settings.theme.backgroundMediaStrength")} value={backgroundLayerOpacity} onChange={setBackgroundLayerOpacity} min={0} max={100} />
                <ThemeNumberField label={t("settings.theme.backgroundOverlayOpacity")} value={backgroundOverlayOpacity} onChange={setBackgroundOverlayOpacity} min={0} max={100} />
                <ThemeNumberField label={t("settings.theme.effectsLayerOpacity")} value={effectsLayerOpacity} onChange={setEffectsLayerOpacity} min={0} max={100} />
                <ThemeNumberField label={t("settings.theme.workspaceSurfaceOpacity")} value={workspaceSurfaceOpacity} onChange={setWorkspaceSurfaceOpacity} min={0} max={100} />
                <ThemeNumberField label={t("settings.theme.heroOverlayOpacity")} value={heroOverlayOpacity} onChange={setHeroOverlayOpacity} min={0} max={100} />
                <ThemeNumberField label={t("settings.theme.panelOpacity")} value={panelSurfaceOpacity} onChange={setPanelSurfaceOpacity} min={0} max={100} />
                <ThemeNumberField label={t("settings.theme.glassBlur")} value={blurStrength} onChange={setBlurStrength} min={0} max={40} suffix="px" />
                <TextField size="small" label={t("settings.theme.toneColor")} value={toneColor} onChange={(event) => setToneColor(event.target.value)} inputProps={{ "aria-label": t("settings.theme.toneColor") }} />
                <ThemeNumberField label={t("settings.theme.toneOpacity")} value={toneOpacity} onChange={setToneOpacity} min={0} max={100} />
              </Box>
            </Stack>
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1, bgcolor: "background.paper" }}>
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                {t("settings.theme.dynamicBackground")}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <FormControl size="small" sx={{ minWidth: 190 }}>
                  <InputLabel>{t("settings.theme.dynamicBackground")}</InputLabel>
                  <Select
                    value={sceneRenderer}
                    label={t("settings.theme.dynamicBackground")}
                    inputProps={{ "aria-label": t("settings.theme.dynamicBackground") }}
                    onChange={(event) => setSceneRenderer(event.target.value as "none" | "canvas" | "three")}
                  >
                    <MenuItem value="none">{t("settings.theme.none")}</MenuItem>
                    <MenuItem value="canvas">{t("settings.theme.canvasLoop")}</MenuItem>
                    <MenuItem value="three">{t("settings.theme.threeLoop")}</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 180 }} disabled={sceneRenderer === "none"}>
                  <InputLabel>{t("settings.theme.scenePreset")}</InputLabel>
                  <Select
                    value={scenePreset}
                    label={t("settings.theme.scenePreset")}
                    inputProps={{ "aria-label": t("settings.theme.scenePreset") }}
                    onChange={(event) => setScenePreset(event.target.value as ThemeBackgroundScene["preset"])}
                  >
                    <MenuItem value="aurora">{t("settings.theme.aurora")}</MenuItem>
                    <MenuItem value="particles">{t("settings.theme.particles")}</MenuItem>
                    <MenuItem value="orbit">{t("settings.theme.orbit")}</MenuItem>
                  </Select>
                </FormControl>
                <TextField size="small" label={t("settings.theme.sceneColor")} value={sceneColor} disabled={sceneRenderer === "none"} onChange={(event) => setSceneColor(event.target.value)} inputProps={{ "aria-label": t("settings.theme.sceneColor") }} />
                <TextField size="small" label={t("settings.theme.sceneSecondary")} value={sceneSecondaryColor} disabled={sceneRenderer === "none"} onChange={(event) => setSceneSecondaryColor(event.target.value)} inputProps={{ "aria-label": t("settings.theme.sceneSecondary") }} />
              </Stack>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1 }}>
                <ThemeNumberField label={t("settings.theme.sceneSpeed")} value={sceneSpeed} onChange={setSceneSpeed} min={0.1} max={3} step={0.05} suffix="x" disabled={sceneRenderer === "none"} />
                <ThemeNumberField label={t("settings.theme.sceneDensity")} value={sceneDensity} onChange={setSceneDensity} min={10} max={100} disabled={sceneRenderer === "none"} />
                <ThemeNumberField label={t("settings.theme.sceneOpacity")} value={sceneOpacity} onChange={setSceneOpacity} min={0} max={100} disabled={sceneRenderer === "none"} />
              </Box>
            </Stack>
          </Paper>
        </Stack>
        {error ? (
          <Alert severity="error" variant="outlined">
            {error}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} alignItems="center">
          <Stack direction="row" spacing={0.5} aria-hidden>
            {[primary, secondary, background].map((color) => (
              <Box key={color} sx={{ width: 22, height: 22, borderRadius: 0.75, bgcolor: color, border: "1px solid", borderColor: "divider" }} />
            ))}
          </Stack>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              const plugin = buildThemePluginDraft();
              if (plugin) {
                onSave(plugin);
              }
            }}
            aria-label={editing ? t("settings.theme.saveChanges") : t("settings.theme.savePlugin")}
          >
            {editing ? t("settings.theme.saveChanges") : t("settings.theme.savePlugin")}
          </Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={exportThemeDraft} aria-label={t("settings.theme.exportJson")}>
            {t("settings.theme.exportJson")}
          </Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => void exportThemeZipDraft()} aria-label={t("settings.theme.exportZip")}>
            {t("settings.theme.exportZip")}
          </Button>
          <Button size="small" variant="outlined" startIcon={<UploadFileIcon />} onClick={() => themeImportRef.current?.click()} aria-label={t("settings.theme.importTheme")}>
            {t("settings.theme.importTheme")}
          </Button>
          <input
            ref={themeImportRef}
            type="file"
            aria-label="Custom theme plugin JSON or ZIP file"
            accept="application/json,application/zip,.json,.zip"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = "";
              if (!file) {
                return;
              }
              void readThemePluginFile(file)
                .then((plugin) => {
                  loadThemeDraft(plugin);
                  onCancelEdit();
                })
                .catch((importError) => {
                  setError(importError instanceof Error ? importError.message : String(importError));
                });
            }}
          />
        </Stack>
      </Stack>
    </Box>
  );
}

function ThemeNumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled = false
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <TextField
      size="small"
      type="number"
      label={suffix ? `${label} (${suffix})` : `${label} (%)`}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(clampDecimal(Number(event.target.value), value, min, max))}
      inputProps={{ min, max, step, "aria-label": `Theme ${label.toLowerCase()}` }}
    />
  );
}

function ThemeMediaField({
  label,
  value,
  onChange,
  onClear,
  t,
  children
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  t: TranslateFn;
  children?: ReactNode;
}) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} sx={{ width: "100%", minWidth: 0 }}>
      <TextField
        size="small"
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        sx={{ flex: 1, minWidth: 0 }}
        inputProps={{ "aria-label": label }}
      />
      <Tooltip title={t("settings.theme.clear")}>
        <span>
          <IconButton size="small" aria-label={t("settings.theme.clear")} disabled={!value.trim()} onClick={onClear}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      {children}
    </Stack>
  );
}

function isSafeThemeImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /["'()\\]/.test(trimmed)) {
    return false;
  }
  return trimmed.startsWith("https://") || trimmed.startsWith("http://") || trimmed.startsWith("blob:") || trimmed.startsWith("data:image/");
}

function isSafeThemeVideoUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /["'()\\]/.test(trimmed)) {
    return false;
  }
  return trimmed.startsWith("https://") || trimmed.startsWith("http://") || trimmed.startsWith("blob:") || trimmed.startsWith("data:video/");
}

const MAX_THEME_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_THEME_VIDEO_BYTES = 6 * 1024 * 1024;
const MAX_THEME_JSON_BYTES = 16 * 1024 * 1024;
const MAX_THEME_ZIP_BYTES = 32 * 1024 * 1024;
const THEME_ZIP_MANIFEST = "theme.json";
const THEME_ASSET_FIELDS = [
  "appBackgroundImage",
  "appBackgroundVideo",
  "composerBackgroundImage",
  "welcomeBackgroundImage",
  "historyBackgroundImage",
  "heroImage",
  "cornerImage",
  "petImage"
] as const satisfies ReadonlyArray<keyof NonNullable<ThemePlugin["assets"]>>;

function readThemeImageFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Theme background must be an image file."));
  }
  if (file.size > MAX_THEME_IMAGE_BYTES) {
    return Promise.reject(new Error("Theme background image must be smaller than 6 MiB."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      if (result.startsWith("data:image/")) {
        resolve(result);
      } else {
        reject(new Error("Theme background could not be converted to a data:image URL."));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Theme background image could not be read."));
    reader.readAsDataURL(file);
  });
}

function readThemeVideoFile(file: File): Promise<string> {
  const supported = file.type === "video/mp4" || file.type === "video/webm" || /\.(mp4|webm)$/i.test(file.name);
  if (!supported) {
    return Promise.reject(new Error("Theme background video must be an MP4 or WebM file."));
  }
  if (file.size > MAX_THEME_VIDEO_BYTES) {
    return Promise.reject(new Error("Theme background video must be smaller than 6 MiB."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      if (result.startsWith("data:video/")) {
        resolve(result);
      } else {
        reject(new Error("Theme background could not be converted to a data:video URL."));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Theme background video could not be read."));
    reader.readAsDataURL(file);
  });
}

async function readThemePluginFile(file: File): Promise<ThemePlugin> {
  if (isThemeZipFile(file)) {
    return readThemePluginZipFile(file);
  }
  if (file.size > MAX_THEME_JSON_BYTES) {
    throw new Error("Theme plugin JSON must be smaller than 16 MiB.");
  }
  const parsed = JSON.parse(await file.text()) as unknown;
  return normalizeImportedThemePlugin(parsed);
}

async function createThemeZipBlob(plugin: ThemePlugin): Promise<Blob> {
  const { manifest, assets } = themePluginToZipManifest(plugin);
  const encoder = new TextEncoder();
  const entries: ZipEntryInput[] = [
    {
      path: THEME_ZIP_MANIFEST,
      data: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`)
    },
    ...assets
  ];
  return new Blob([uint8ToArrayBuffer(createStoredZip(entries))], { type: "application/zip" });
}

function themePluginToZipManifest(plugin: ThemePlugin): { manifest: ThemePlugin; assets: ZipEntryInput[] } {
  const manifest = structuredClone(plugin) as ThemePlugin;
  const assets: ZipEntryInput[] = [];
  if (!manifest.assets) {
    return { manifest, assets };
  }
  const nextAssets: NonNullable<ThemePlugin["assets"]> = { ...manifest.assets };
  for (const field of THEME_ASSET_FIELDS) {
    const value = nextAssets[field];
    if (!value?.startsWith("data:")) {
      continue;
    }
    const dataUrl = parseThemeDataUrl(value);
    const fieldKind = field === "appBackgroundVideo" ? "video" : "image";
    if (fieldKind === "image" && !dataUrl.mime.startsWith("image/")) {
      throw new Error("Theme ZIP image assets must use data:image URLs.");
    }
    if (fieldKind === "video" && !dataUrl.mime.startsWith("video/")) {
      throw new Error("Theme ZIP video assets must use data:video URLs.");
    }
    const maxBytes = fieldKind === "video" ? MAX_THEME_VIDEO_BYTES : MAX_THEME_IMAGE_BYTES;
    if (dataUrl.data.byteLength > maxBytes) {
      throw new Error(fieldKind === "video" ? "Theme background video must be smaller than 6 MiB." : "Theme background image must be smaller than 6 MiB.");
    }
    const path = `assets/${field}.${extensionForMime(dataUrl.mime, fieldKind)}`;
    assets.push({ path, data: dataUrl.data });
    nextAssets[field] = path;
  }
  manifest.assets = removeEmptyThemeAssets(nextAssets);
  return { manifest, assets };
}

async function readThemePluginZipFile(file: File): Promise<ThemePlugin> {
  if (file.size > MAX_THEME_ZIP_BYTES) {
    throw new Error("Theme ZIP must be smaller than 32 MiB.");
  }
  const files = await readZipEntries(new Uint8Array(await file.arrayBuffer()));
  const manifestBytes = files.get(THEME_ZIP_MANIFEST);
  if (!manifestBytes) {
    throw new Error("Theme ZIP must contain theme.json at the archive root.");
  }
  if (manifestBytes.byteLength > MAX_THEME_JSON_BYTES) {
    throw new Error("Theme plugin JSON must be smaller than 16 MiB.");
  }
  const parsed = JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown;
  return normalizeImportedThemePlugin(resolveThemeZipAssetPaths(parsed, files));
}

function resolveThemeZipAssetPaths(value: unknown, files: Map<string, Uint8Array>): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }
  const rawAssets = isPlainRecord(value.assets) ? value.assets : {};
  const assets: Record<string, unknown> = { ...rawAssets };
  for (const field of THEME_ASSET_FIELDS) {
    const entry = rawAssets[field];
    if (typeof entry !== "string") {
      continue;
    }
    const path = normalizeZipPath(entry);
    if (!path || isExternalThemeAssetPath(path)) {
      continue;
    }
    const data = files.get(path);
    if (!data) {
      throw new Error(`Theme ZIP is missing asset ${path}.`);
    }
    const fieldKind = field === "appBackgroundVideo" ? "video" : "image";
    const maxBytes = fieldKind === "video" ? MAX_THEME_VIDEO_BYTES : MAX_THEME_IMAGE_BYTES;
    if (data.byteLength > maxBytes) {
      throw new Error(fieldKind === "video" ? "Theme background video must be smaller than 6 MiB." : "Theme background image must be smaller than 6 MiB.");
    }
    const mime = mimeForThemeAsset(path, fieldKind);
    assets[field] = `data:${mime};base64,${uint8ToBase64(data)}`;
  }
  return {
    ...value,
    assets
  };
}

type ZipEntryInput = {
  path: string;
  data: Uint8Array;
};

type ZipEntryRecord = ZipEntryInput & {
  crc: number;
  offset: number;
};

function isThemeZipFile(file: File): boolean {
  return file.type === "application/zip" || /\.zip$/i.test(file.name);
}

function isExternalThemeAssetPath(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("blob:") || value.startsWith("data:");
}

function parseThemeDataUrl(value: string): { mime: string; data: Uint8Array } {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(value);
  if (!match) {
    throw new Error("Theme media data URL is invalid.");
  }
  const mime = match[1]?.toLowerCase();
  const payload = match[3];
  if (!mime || typeof payload !== "string") {
    throw new Error("Theme media data URL is invalid.");
  }
  if (match[2]) {
    const binary = atob(payload);
    const data = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      data[index] = binary.charCodeAt(index);
    }
    return { mime, data };
  }
  return { mime, data: new TextEncoder().encode(decodeURIComponent(payload)) };
}

function extensionForMime(mime: string, kind: "image" | "video"): string {
  switch (mime.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    default:
      return kind === "video" ? "bin" : "img";
  }
}

function mimeForThemeAsset(path: string, kind: "image" | "video"): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".mp4")) {
    return "video/mp4";
  }
  if (lower.endsWith(".webm")) {
    return "video/webm";
  }
  return kind === "video" ? "video/mp4" : "image/png";
}

function uint8ToBase64(data: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
    const chunk = data.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function createStoredZip(entries: ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const records: ZipEntryRecord[] = [];
  let offset = 0;
  for (const entry of entries) {
    const path = normalizeZipPath(entry.path);
    if (!path) {
      throw new Error("Theme ZIP entry path is invalid.");
    }
    const nameBytes = encoder.encode(path);
    const crc = crc32(entry.data);
    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.byteLength, true);
    localView.setUint32(22, entry.data.byteLength, true);
    localView.setUint16(26, nameBytes.byteLength, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, entry.data);
    records.push({ path, data: entry.data, crc, offset });
    offset += localHeader.byteLength + entry.data.byteLength;
  }
  const centralOffset = offset;
  for (const record of records) {
    const nameBytes = encoder.encode(record.path);
    const header = new Uint8Array(46 + nameBytes.byteLength);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint32(16, record.crc, true);
    view.setUint32(20, record.data.byteLength, true);
    view.setUint32(24, record.data.byteLength, true);
    view.setUint16(28, nameBytes.byteLength, true);
    view.setUint32(42, record.offset, true);
    header.set(nameBytes, 46);
    centralParts.push(header);
    offset += header.byteLength;
  }
  const centralSize = offset - centralOffset;
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, records.length, true);
  endView.setUint16(10, records.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  return concatUint8Arrays([...localParts, ...centralParts, end]);
}

async function readZipEntries(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const endOffset = findZipEndOfCentralDirectory(view);
  if (endOffset < 0) {
    throw new Error("Theme ZIP could not be read.");
  }
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const files = new Map<string, Uint8Array>();
  let cursor = centralOffset;
  const decoder = new TextDecoder();
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (cursor + 46 > data.byteLength || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("Theme ZIP central directory is invalid.");
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameStart = cursor + 46;
    const path = normalizeZipPath(decoder.decode(data.subarray(nameStart, nameStart + fileNameLength)));
    cursor = nameStart + fileNameLength + extraLength + commentLength;
    if (!path || path.endsWith("/")) {
      continue;
    }
    if ((flags & 0x1) !== 0) {
      throw new Error("Encrypted theme ZIP files are not supported.");
    }
    if (localOffset + 30 > data.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error("Theme ZIP local file header is invalid.");
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const compressedStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressedEnd = compressedStart + compressedSize;
    if (compressedEnd > data.byteLength) {
      throw new Error("Theme ZIP asset data is truncated.");
    }
    const compressed = data.subarray(compressedStart, compressedEnd);
    const fileData = method === 0 ? compressed : await inflateZipEntry(method, compressed);
    files.set(path, fileData);
  }
  return files;
}

function findZipEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

async function inflateZipEntry(method: number, compressed: Uint8Array): Promise<Uint8Array> {
  if (method !== 8 || typeof DecompressionStream === "undefined") {
    throw new Error("Theme ZIP uses an unsupported compression method.");
  }
  const stream = new Blob([uint8ToArrayBuffer(compressed)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function normalizeZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../../../../apps/web/src/") || normalized === ".." || normalized.includes("\0")) {
    return null;
  }
  return normalized;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function uint8ToArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

let crc32Table: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getCrc32Table(): Uint32Array {
  if (crc32Table) {
    return crc32Table;
  }
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  crc32Table = table;
  return table;
}

function normalizeImportedThemePlugin(value: unknown): ThemePlugin {
  if (!isPlainRecord(value)) {
    throw new Error("Theme plugin JSON must be an object.");
  }
  const preview = isPlainRecord(value.preview) ? value.preview : null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const primary = typeof preview?.primary === "string" ? preview.primary.trim() : "";
  const secondary = typeof preview?.secondary === "string" ? preview.secondary.trim() : "";
  const background = typeof preview?.background === "string" ? preview.background.trim() : "";
  if (!name || !primary || !secondary || !background) {
    throw new Error("Theme plugin JSON requires name and preview colors.");
  }
  if (![primary, secondary, background].every(isHexColor)) {
    throw new Error("Imported theme preview colors must be hex colors.");
  }
  const rawAssets = isPlainRecord(value.assets) ? value.assets : {};
  const assets = removeEmptyThemeAssets({
    appBackgroundImage: typeof rawAssets.appBackgroundImage === "string" ? rawAssets.appBackgroundImage.trim() : "",
    appBackgroundVideo: typeof rawAssets.appBackgroundVideo === "string" ? rawAssets.appBackgroundVideo.trim() : "",
    composerBackgroundImage: typeof rawAssets.composerBackgroundImage === "string" ? rawAssets.composerBackgroundImage.trim() : "",
    welcomeBackgroundImage: typeof rawAssets.welcomeBackgroundImage === "string" ? rawAssets.welcomeBackgroundImage.trim() : "",
    historyBackgroundImage: typeof rawAssets.historyBackgroundImage === "string" ? rawAssets.historyBackgroundImage.trim() : "",
    heroImage: typeof rawAssets.heroImage === "string" ? rawAssets.heroImage.trim() : "",
    cornerImage: typeof rawAssets.cornerImage === "string" ? rawAssets.cornerImage.trim() : "",
    petImage: typeof rawAssets.petImage === "string" ? rawAssets.petImage.trim() : ""
  });
  if (assets?.appBackgroundImage && !isSafeThemeImageUrl(assets.appBackgroundImage)) {
    throw new Error("Imported theme background image must be http(s), blob, or data:image.");
  }
  if (assets?.appBackgroundVideo && !isSafeThemeVideoUrl(assets.appBackgroundVideo)) {
    throw new Error("Imported theme background video must be http(s), blob, or data:video.");
  }
  if ([assets?.composerBackgroundImage, assets?.welcomeBackgroundImage, assets?.historyBackgroundImage, assets?.heroImage, assets?.cornerImage, assets?.petImage].some((entry) => entry && !isSafeThemeImageUrl(entry))) {
    throw new Error("Imported theme image media must be http(s), blob, or data:image.");
  }
  const rawLayout = isPlainRecord(value.layout) ? value.layout : {};
  const decorationIntensity =
    rawLayout.decorationIntensity === "none" || rawLayout.decorationIntensity === "rich" || rawLayout.decorationIntensity === "subtle"
      ? rawLayout.decorationIntensity
      : "subtle";
  const backgroundScene = normalizeThemeBackgroundScene(rawLayout.backgroundScene, primary, secondary);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return {
    id: `user-${slug || "theme"}-import` as ThemeId,
    name,
    description: description || "Imported user theme plugin.",
    source: "user-defined",
    installedByDefault: false,
    preview: { primary, secondary, background },
    dark: Boolean(value.dark),
    assets,
    layout: {
      heroEnabled: rawLayout.heroEnabled !== false,
      petEnabled: rawLayout.petEnabled !== false,
      decorationIntensity,
      backgroundLayerOpacity: clampUnitNumber(rawLayout.backgroundLayerOpacity, REFERENCE_BACKGROUND_TUNING.backgroundLayerOpacity),
      backgroundOverlayOpacity: clampUnitNumber(rawLayout.backgroundOverlayOpacity, REFERENCE_BACKGROUND_TUNING.backgroundOverlayOpacity),
      effectsLayerOpacity: clampUnitNumber(rawLayout.effectsLayerOpacity, REFERENCE_BACKGROUND_TUNING.effectsLayerOpacity),
      workspaceSurfaceOpacity: clampUnitNumber(rawLayout.workspaceSurfaceOpacity, REFERENCE_BACKGROUND_TUNING.workspaceSurfaceOpacity),
      heroOverlayOpacity: clampUnitNumber(rawLayout.heroOverlayOpacity, REFERENCE_BACKGROUND_TUNING.heroOverlayOpacity),
      panelSurfaceOpacity: clampUnitNumber(rawLayout.panelSurfaceOpacity, REFERENCE_BACKGROUND_TUNING.panelSurfaceOpacity),
      blurStrength: clampThemeBlur(readNumber(rawLayout.blurStrength), REFERENCE_BACKGROUND_TUNING.blurStrength),
      toneColor: typeof rawLayout.toneColor === "string" && isHexColor(rawLayout.toneColor) ? rawLayout.toneColor : primary,
      toneOpacity: clampUnitNumber(rawLayout.toneOpacity, REFERENCE_BACKGROUND_TUNING.toneOpacity),
      backgroundScene
    }
  };
}

function normalizeThemeBackgroundScene(value: unknown, fallbackColor: string, fallbackSecondaryColor: string): ThemeBackgroundScene | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const renderer = value.renderer === "canvas" || value.renderer === "three" ? value.renderer : null;
  const preset = value.preset === "aurora" || value.preset === "particles" || value.preset === "orbit" ? value.preset : null;
  if (!renderer || !preset) {
    return undefined;
  }
  const color = typeof value.color === "string" && isHexColor(value.color) ? value.color : fallbackColor;
  const secondaryColor = typeof value.secondaryColor === "string" && isHexColor(value.secondaryColor) ? value.secondaryColor : fallbackSecondaryColor;
  return {
    renderer,
    preset,
    color,
    secondaryColor,
    speed: clampDecimal(readNumber(value.speed), 0.65, 0.1, 3),
    density: clampUnitNumber(value.density, 0.55),
    opacity: clampUnitNumber(value.opacity, 0.54)
  };
}

function readNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function clampUnitNumber(value: unknown, fallback: number): number {
  return clampDecimal(readNumber(value), fallback, 0, 1);
}

function clampDecimal(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numberValue));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function removeEmptyThemeAssets(assets: NonNullable<ThemePlugin["assets"]>): ThemePlugin["assets"] | undefined {
  const entries = Object.entries(assets).filter(([, value]) => typeof value === "string" && value.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function RelayCatalogTree({
  catalog,
  groups,
  selection,
  onSelection,
  t
}: {
  catalog: RelayCapabilityCatalog | undefined;
  groups: ChannelGroupConfig[];
  selection: RelayCatalogTreeSelection;
  onSelection: (selection: RelayCatalogTreeSelection) => void;
  t: TranslateFn;
}) {
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const candidateModels = new Set(groups.flatMap((group) => group.models ?? []));
  const models = (catalog?.data ?? []).filter((model) => candidateModels.has(model.model_name));
  const vendorNames = new Map((catalog?.vendors ?? []).map((vendor) => [vendor.id, vendor.name]));
  const vendorIds = [...new Set(models.map((model) => model.vendor_id ?? null))];
  const vendors = vendorIds
    .map((vendorId) => ({
      id: vendorId,
      name: vendorId == null
        ? t("settings.relay.catalogTreeUnknownVendor")
        : vendorNames.get(vendorId) ?? `#${vendorId}`,
      models: models.filter((model) => (model.vendor_id ?? null) === vendorId)
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));

  const toggle = (setter: Dispatch<SetStateAction<Set<string>>>, key: string) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Paper variant="outlined" sx={{ maxHeight: { xs: 280, md: 560 }, overflowY: "auto", borderRadius: 1 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", px: 1.5, pt: 1, fontWeight: 800 }}>
        {t("settings.relay.catalogTreeTitle")}
      </Typography>
      <List dense disablePadding aria-label={t("settings.relay.catalogTreeTitle")}>
        <ListItemButton selected={selection.level === "all"} onClick={() => onSelection({ level: "all" })}>
          <ListItemIcon sx={{ minWidth: 32 }}><FolderOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("settings.relay.catalogTreeAll")} secondary={t("settings.relay.catalogGroups", { count: groups.length })} />
        </ListItemButton>
        {vendors.map((vendor) => {
          const vendorKey = vendor.id == null ? "unknown" : String(vendor.id);
          const expanded = expandedVendors.has(vendorKey);
          const vendorSelected = selection.level === "vendor" && selection.vendorId === vendor.id;
          return (
            <Fragment key={vendorKey}>
              <ListItemButton
                selected={vendorSelected}
                onClick={() => {
                  onSelection({ level: "vendor", vendorId: vendor.id });
                  toggle(setExpandedVendors, vendorKey);
                }}
              >
                <ListItemIcon sx={{ minWidth: 54 }}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                    <VendorLogo name={vendor.name} size={18} />
                  </Stack>
                </ListItemIcon>
                <ListItemText primary={vendor.name} secondary={t("settings.relay.catalogModels", { count: vendor.models.length })} primaryTypographyProps={{ noWrap: true }} />
              </ListItemButton>
              <Collapse in={expanded} timeout="auto" unmountOnExit>
                <List dense disablePadding>
                  {vendor.models
                    .slice()
                    .sort((left, right) => left.model_name.localeCompare(right.model_name, undefined, { numeric: true, sensitivity: "base" }))
                    .map((model) => {
                      const modelGroups = groups.filter((group) => (group.models ?? []).includes(model.model_name));
                      const modelExpanded = expandedModels.has(model.model_name);
                      const modelSelected = selection.level === "model" && selection.modelName === model.model_name;
                      return (
                        <Fragment key={model.model_name}>
                          <ListItemButton
                            selected={modelSelected}
                            sx={{ pl: 3 }}
                            onClick={() => {
                              onSelection({ level: "model", modelName: model.model_name });
                              toggle(setExpandedModels, model.model_name);
                            }}
                          >
                            <ListItemIcon sx={{ minWidth: 50 }}>
                              <Stack direction="row" spacing={0.5} alignItems="center">
                                {modelExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                                <VendorLogo name={model.icon ?? model.model_name} size={16} />
                              </Stack>
                            </ListItemIcon>
                            <ListItemText primary={model.model_name} secondary={t("settings.relay.catalogGroups", { count: modelGroups.length })} primaryTypographyProps={{ noWrap: true }} />
                          </ListItemButton>
                          <Collapse in={modelExpanded} timeout="auto" unmountOnExit>
                            <List dense disablePadding>
                              {modelGroups.map((group) => {
                                const groupName = group.catalogGroupName ?? group.name;
                                return (
                                  <ListItemButton
                                    key={group.id}
                                    selected={selection.level === "group" && selection.groupName === groupName}
                                    sx={{ pl: 6 }}
                                    onClick={() => onSelection({ level: "group", groupName })}
                                  >
                                    <ListItemIcon sx={{ minWidth: 28 }}><FolderOutlinedIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText primary={group.name} secondary={`x${formatRelayGroupRatio(group.groupRatio)}`} primaryTypographyProps={{ noWrap: true }} />
                                  </ListItemButton>
                                );
                              })}
                            </List>
                          </Collapse>
                        </Fragment>
                      );
                    })}
                </List>
              </Collapse>
            </Fragment>
          );
        })}
      </List>
    </Paper>
  );
}

export function RelayGroupExplorer({
  groups,
  total,
  selectedId,
  search,
  status,
  protocol,
  sort,
  view,
  showStatusFilter = true,
  t,
  onSearch,
  onStatus,
  onProtocol,
  onSort,
  onView,
  onSelect
}: {
  groups: ChannelGroupConfig[];
  total: number;
  selectedId: string | null;
  search: string;
  status: RelayGroupStatusFilter;
  protocol: RelayGroupProtocolFilter;
  sort: RelayGroupSort;
  view: "list" | "details" | "large_icons";
  showStatusFilter?: boolean;
  t: TranslateFn;
  onSearch: (value: string) => void;
  onStatus: (value: RelayGroupStatusFilter) => void;
  onProtocol: (value: RelayGroupProtocolFilter) => void;
  onSort: (value: RelayGroupSort) => void;
  onView: (value: "list" | "details" | "large_icons") => void;
  onSelect: (group: ChannelGroupConfig) => void;
}) {
  const groupIcon = (group: ChannelGroupConfig, size: "small" | "large" = "small") => (
    <FolderOutlinedIcon
      color={group.status === "disabled" ? "disabled" : group.kind === "image" ? "success" : "primary"}
      sx={size === "large" ? { fontSize: 46 } : undefined}
      fontSize={size === "small" ? "small" : undefined}
    />
  );
  const secondary = (group: ChannelGroupConfig) =>
    `${group.responseProtocol ?? "openai-response"} | x${formatRelayGroupRatio(group.groupRatio)} | ${formatRelayGroupUsage(group, t)}`;

  return (
    <Box data-testid="relay-group-explorer" sx={{ width: "100%", maxWidth: "100%", minWidth: 0, border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden", bgcolor: "background.paper" }}>
      <Stack spacing={1} sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.default" }}>
        <Stack direction={{ xs: "column", lg: "row" }} spacing={1} alignItems={{ lg: "center" }} sx={{ minWidth: 0 }}>
          <TextField
            size="small"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t("settings.relay.groupSearchPlaceholder")}
            sx={{ flex: 1, minWidth: { lg: 220 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }}
          />
          <Stack direction="row" spacing={1} sx={{ width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "auto", pb: 0.25 }}>
            {showStatusFilter ? (
              <FormControl size="small" sx={{ minWidth: 118 }}>
                <InputLabel>{t("settings.relay.groupStatusFilter")}</InputLabel>
                <Select value={status} label={t("settings.relay.groupStatusFilter")} onChange={(event) => onStatus(event.target.value as RelayGroupStatusFilter)}>
                  <MenuItem value="available">{t("settings.relay.groupAvailable")}</MenuItem>
                  <MenuItem value="disabled">{t("settings.relay.groupStopped")}</MenuItem>
                  <MenuItem value="pending">{t("settings.relay.groupPending")}</MenuItem>
                  <MenuItem value="all">{t("settings.relay.filterAll")}</MenuItem>
                </Select>
              </FormControl>
            ) : null}
            <FormControl size="small" sx={{ minWidth: 148 }}>
              <InputLabel>{t("settings.relay.groupProtocolFilter")}</InputLabel>
              <Select value={protocol} label={t("settings.relay.groupProtocolFilter")} onChange={(event) => onProtocol(event.target.value as RelayGroupProtocolFilter)}>
                <MenuItem value="all">{t("settings.relay.filterAll")}</MenuItem>
                <MenuItem value="openai-response">Responses</MenuItem>
                <MenuItem value="openai">Chat Completions</MenuItem>
                <MenuItem value="anthropic">Anthropic</MenuItem>
                <MenuItem value="gemini">Gemini</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel>{t("settings.relay.groupSort")}</InputLabel>
              <Select value={sort} label={t("settings.relay.groupSort")} onChange={(event) => onSort(event.target.value as RelayGroupSort)}>
                <MenuItem value="original">{t("settings.relay.sortOriginal")}</MenuItem>
                <MenuItem value="name_asc">{t("settings.relay.sortName")}</MenuItem>
                <MenuItem value="ratio_asc">{t("settings.relay.sortRatioAsc")}</MenuItem>
                <MenuItem value="ratio_desc">{t("settings.relay.sortRatioDesc")}</MenuItem>
                <MenuItem value="usage_desc">{t("settings.relay.sortUsageDesc")}</MenuItem>
                <MenuItem value="priority_desc">{t("settings.relay.sortPriorityDesc")}</MenuItem>
                <MenuItem value="models_desc">{t("settings.relay.sortModelsDesc")}</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={view}
            onChange={(_event, value) => value && onView(value as "list" | "details" | "large_icons")}
            sx={{ alignSelf: { xs: "flex-end", lg: "center" } }}
          >
            <Tooltip title={t("settings.relay.groupViewList")}><ToggleButton value="list" aria-label={t("settings.relay.groupViewList")}><ViewListIcon fontSize="small" /></ToggleButton></Tooltip>
            <Tooltip title={t("settings.relay.groupViewDetails")}><ToggleButton value="details" aria-label={t("settings.relay.groupViewDetails")}><TableRowsIcon fontSize="small" /></ToggleButton></Tooltip>
            <Tooltip title={t("settings.relay.groupViewLargeIcons")}><ToggleButton value="large_icons" aria-label={t("settings.relay.groupViewLargeIcons")}><GridViewIcon fontSize="small" /></ToggleButton></Tooltip>
          </ToggleButtonGroup>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {t("settings.relay.groupResults", { shown: groups.length, total })}
        </Typography>
      </Stack>

      {groups.length === 0 ? (
        <Box sx={{ px: 2, py: 4, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">{t("settings.relay.noMatchingGroups")}</Typography>
        </Box>
      ) : view === "details" ? (
        <TableContainer sx={{ maxHeight: 360 }}>
          <Table stickyHeader size="small" aria-label={t("settings.relay.groups")}>
            <TableHead>
              <TableRow>
                <TableCell>{t("settings.relay.groupName")}</TableCell>
                <TableCell>{t("settings.relay.responseProtocol")}</TableCell>
                <TableCell align="right">{t("settings.relay.groupRatio")}</TableCell>
                <TableCell align="right">{t("settings.relay.groupUsageRate")}</TableCell>
                <TableCell align="right">{t("settings.relay.groupModels")}</TableCell>
                <TableCell>{t("settings.relay.groupStatus")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.map((group) => (
                <TableRow
                  key={group.id}
                  hover
                  selected={group.id === selectedId}
                  role="button"
                  tabIndex={0}
                  aria-selected={group.id === selectedId}
                  onClick={() => onSelect(group)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(group);
                    }
                  }}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                      {groupIcon(group)}
                      <Typography variant="body2" noWrap sx={{ fontWeight: group.id === selectedId ? 800 : 600 }}>{group.name}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>{group.responseProtocol ?? "openai-response"}</TableCell>
                  <TableCell align="right">x{formatRelayGroupRatio(group.groupRatio)}</TableCell>
                  <TableCell align="right">{formatRelayGroupUsage(group, t)}</TableCell>
                  <TableCell align="right">{group.models?.length ?? 0}</TableCell>
                  <TableCell>{formatRelayGroupStatus(group, t)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : view === "list" ? (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, maxHeight: 360, overflowY: "auto", p: 0.5 }}>
          {groups.map((group) => (
            <ListItemButton key={group.id} selected={group.id === selectedId} onClick={() => onSelect(group)} sx={{ minHeight: 52, borderRadius: 0.5 }}>
              <ListItemIcon sx={{ minWidth: 34 }}>{groupIcon(group)}</ListItemIcon>
              <ListItemText
                primary={group.name}
                secondary={secondary(group)}
                primaryTypographyProps={{ variant: "body2", fontWeight: group.id === selectedId ? 800 : 600, noWrap: true }}
                secondaryTypographyProps={{ variant: "caption", noWrap: true }}
              />
            </ListItemButton>
          ))}
        </Box>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 0.5, p: 1, maxHeight: 390, overflowY: "auto" }}>
          {groups.map((group) => (
            <Button
              key={group.id}
              color="inherit"
              aria-pressed={group.id === selectedId}
              onClick={() => onSelect(group)}
              sx={{
                minWidth: 0,
                minHeight: 118,
                px: 1,
                py: 1.25,
                borderRadius: 1,
                border: "1px solid",
                borderColor: group.id === selectedId ? "primary.main" : "transparent",
                bgcolor: group.id === selectedId ? "action.selected" : "transparent",
                textTransform: "none"
              }}
            >
              <Stack spacing={0.5} alignItems="center" sx={{ minWidth: 0, width: "100%" }}>
                {groupIcon(group, "large")}
                <Typography variant="body2" noWrap sx={{ width: "100%", fontWeight: group.id === selectedId ? 800 : 600 }}>{group.name}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ width: "100%" }}>{secondary(group)}</Typography>
              </Stack>
            </Button>
          ))}
        </Box>
      )}
    </Box>
  );
}

function formatRelayGroupUsage(group: ChannelGroupConfig, t: TranslateFn): string {
  const rate = relayGroupUsageRate(group);
  if (rate == null) return t("settings.relay.groupUsageUnlimited");
  return `${(rate * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function formatRelayGroupStatus(group: ChannelGroupConfig, t: TranslateFn): string {
  if (!hasConfiguredRelayGroupKey(group)) return t("settings.relay.groupPending");
  return group.status === "disabled" ? t("settings.relay.groupStopped") : t("settings.relay.groupAvailable");
}

function formatRelayGroupRatio(value: number | undefined): string {
  const ratio = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return ratio.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function SettingAssistantSetupBanner({
  providers,
  ready,
  provider,
  model,
  t,
  onOpenAssistant,
  onOpenRelay
}: {
  providers: ProviderConfig[];
  ready: boolean;
  provider: ProviderConfig | null;
  model: string;
  t: TranslateFn;
  onOpenAssistant: () => void;
  onOpenRelay: () => void;
}) {
  const hasProviders = providers.length > 0;
  return (
    <Paper variant="outlined" sx={{ mb: 1.5, p: 1.25, borderRadius: 2, bgcolor: ready ? "background.paper" : "background.default" }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ xs: "stretch", md: "center" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
            <SettingsSuggestIcon color={ready ? "success" : "warning"} fontSize="small" />
            <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
              {t("settings.assistant.title")}
            </Typography>
            <Chip size="small" color={ready ? "success" : "warning"} label={ready ? t("settings.assistant.ready") : t("settings.assistant.needsSetup")} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {ready
              ? t("settings.assistant.readyDescription", { provider: provider?.name ?? "-", model: model || "-" })
              : hasProviders
              ? t("settings.assistant.chooseModelDescription")
              : t("settings.assistant.noProviderDescription")}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button size="small" variant={ready ? "contained" : "outlined"} startIcon={<AutoAwesomeIcon />} onClick={onOpenAssistant}>
            {t("settings.assistant.open")}
          </Button>
          <Button size="small" variant={ready ? "outlined" : "contained"} startIcon={<TuneIcon />} onClick={onOpenAssistant}>
            {t("settings.assistant.configureModel")}
          </Button>
          <Button size="small" variant="outlined" startIcon={<MemoryIcon />} onClick={onOpenRelay}>
            {t("settings.assistant.setupRelay")}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function SettingRow({
  title,
  description,
  children
}: {
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.25}
        alignItems={{ xs: "stretch", sm: "center" }}
        sx={{ p: 1.5, bgcolor: "background.paper" }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {typeof title === "string" ? (
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
          ) : (
            title
          )}
          {description ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
              {description}
            </Typography>
          ) : null}
        </Box>
        <Box sx={{ flex: "0 0 auto" }}>{children}</Box>
      </Stack>
      <Divider />
    </>
  );
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
