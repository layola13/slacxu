import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  Popover,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ImageIcon from "@mui/icons-material/Image";
import LinkIcon from "@mui/icons-material/Link";
import ForumIcon from "@mui/icons-material/Forum";
import BuildIcon from "@mui/icons-material/Build";
import AppsIcon from "@mui/icons-material/Apps";
import MovieIcon from "@mui/icons-material/Movie";
import CloseIcon from "@mui/icons-material/Close";
import DescriptionIcon from "@mui/icons-material/Description";
import StopIcon from "@mui/icons-material/Stop";
import AssessmentIcon from "@mui/icons-material/Assessment";
import BoltIcon from "@mui/icons-material/Bolt";
import ChecklistIcon from "@mui/icons-material/Checklist";
import CompressIcon from "@mui/icons-material/Compress";
import DifferenceIcon from "@mui/icons-material/Difference";
import EditNoteIcon from "@mui/icons-material/EditNote";
import FlagIcon from "@mui/icons-material/Flag";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import PanToolAltIcon from "@mui/icons-material/PanToolAlt";
import RateReviewIcon from "@mui/icons-material/RateReview";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ViewStreamIcon from "@mui/icons-material/ViewStream";
import SecurityIcon from "@mui/icons-material/Security";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import PsychologyIcon from "@mui/icons-material/Psychology";
import { alpha } from "@mui/material/styles";
import { contextUsageMetrics } from "../contextUsage";
import { countActiveEnhanceTools, createDefaultSaVmPolicyConfig, permissionPresets, type PermissionPresetId, type SaVmFsAccess, type SaVmPolicyConfig } from "@codex-ui/shared";
import type { ComposerImageAttachment, ComposerMention, PluginAppEntry, SkillEntry, ThreadEntry } from "../state/codexClient";
import { themeVisualTuning, type ThemePlugin } from "../theme";
import type { TranslateFn } from "../i18n";
import { shouldOpenComposerAddMenu } from "./composerMenuShortcuts";
import { readWorkspaceDragData } from "../components/workspaceDrag";
import type { WaterfallDisplayMode } from "../waterfall/chatRows";
import { submitComposerWhenAccepted } from "./composerSubmission";
import { permissionPresetDisplayDescription, permissionPresetDisplayLabel } from "../permissionPresetDisplay";
import { isWorkspaceSkillPath } from "../app/skills/skillScope";
import { cliPlugin, DEFAULT_CLI_BACKEND } from "../app/cli/cliPlugins";
import { isRelayShareText } from "../app/relayShare";
import { VmToolsSettingsTab } from "../../../../frontends/vmtool-security/src/security/VmToolsSettingsTab";
import { VmContextSavingsTab } from "../../../../frontends/free-mode/src/free/VmContextSavingsTab";
import { EnhanceToolsDialog } from "../../../../frontends/enhance/src/enhance/EnhanceToolsDialog";
import { JevSettingsDialog } from "../../../../frontends/jev/src/jev/JevSettingsDialog";
import { listProjectRelayDirectory } from "../state/codexClient";
import { JEV_ERROR_EVENT, JEV_RESULT_EVENT, shouldAcceptJevVerdictForThread, startJevAutoJudgeListener } from "../../../../frontends/jev/src/jev/jevAutoJudge";
import { jevBaseHost, loadJevConfig, saveJevConfig, type JevConfig } from "../../../../frontends/jev/src/jev/jevConfig";
import { buildJevNudgeText, buildJevPlanNudgeText, buildJevSubNudgeText, formatJevCauseAction, formatJevPlanLabel, formatJevSubLabel, formatJevVerdictLabel, type JevPlanVerdict, type JevSubVerdict, type JevVerdict } from "../../../../frontends/jev/src/jev/jevQuestions";
import { loadWorkspaceVmPolicy } from "../utils/recentWorkspaces";

type Props = {
  cwd: string;
  additionalRoots?: string[];
  onAddAdditionalRoot?: () => void;
  onRemoveAdditionalRoot?: (root: string) => void;
  permission: PermissionPresetId;
  disabled: boolean;
  pendingMention: ComposerMention | null;
  suggestedPrompt?: { id: string; text: string } | null;
  activeThemePlugin?: ThemePlugin | null;
  backgroundImage?: string;
  sendBlockedReason?: string;
  sessionToken?: string | null;
  t: TranslateFn;
  modeBadges?: {
    fast: boolean;
    plan: boolean;
    goalActive: boolean;
  };
  dangerBypassConfirmed: boolean;
  permissionScopeLabel?: string;
  running?: boolean;
  workingStatus?: ComposerWorkingStatus | null;
  statusKind?: string;
  statusLabel?: string;
  /** Display name of the currently selected CLI backend (placeholder text). */
  backendName?: string;
  runtimeControls?: ReactNode;
  contextTrailingAction?: ReactNode;
  gitBranch?: string | null;
  gitDirtyCount?: number;
  onOpenGit?: () => void;
  vmEnabled?: boolean;
  onVmEnabledChange?: (enabled: boolean) => void;
  vmPolicy?: SaVmPolicyConfig;
  onVmPolicyChange?: (policy: SaVmPolicyConfig) => void;
  onVmSave?: (input: { enabled: boolean; policy: SaVmPolicyConfig; cwd?: string }) => Promise<void> | void;
  compact?: boolean;
  onToggleCompact?: () => void;
  imageChannels?: Array<{ providerId: string; groupId: string; label: string; model: string; notice?: string; priceLabel?: string }>;
  selectedImageChannel?: string;
  onImageChannelChange?: (providerId: string, groupId: string, model: string) => void;
  contextUsage?: { usedTokens: number; contextWindow: number | null } | null;
  waterfallDisplayMode?: WaterfallDisplayMode;
  allowedPermissions?: PermissionPresetId[];
  onMentionConsumed: () => void;
  onUserActivity?: () => void;
  onSuggestedPromptConsumed?: () => void;
  onPermissionChange?: (permission: PermissionPresetId) => void;
  onWaterfallDisplayModeChange?: (mode: WaterfallDisplayMode) => void;
  onTogglePlanMode?: () => void;
  onStop?: () => void;
  threads?: ThreadEntry[];
  skills?: SkillEntry[];
  apps?: PluginAppEntry[];
  onOpenApps?: () => void;
  onSend: (text: string, images: ComposerImageAttachment[], mentions: ComposerMention[]) => boolean | Promise<boolean>;
  onSteer?: (text: string, images: ComposerImageAttachment[], mentions: ComposerMention[]) => boolean | Promise<boolean>;
  onRelayShareDetected?: (value: string) => void;
  mobileLayout?: boolean;
  mobileRelayAction?: ReactNode;
  /** 当前激活对话 id：JEV verdict 全局广播，必须只响应本对话，避免跨对话误督促。 */
  activeThreadId?: string | null;
};

type VmEditorTab = "execution" | "filesystem" | "network" | "savings" | "preview" | "tools";

const VM_GIT_COMMAND_OPTIONS = [
  { command: "status", safety: "safe", labelKey: "composer.vmGitStatus", descriptionKey: "composer.vmGitStatusHelp" },
  { command: "pull", safety: "safe", labelKey: "composer.vmGitPull", descriptionKey: "composer.vmGitPullHelp" },
  { command: "push", safety: "safe", labelKey: "composer.vmGitPush", descriptionKey: "composer.vmGitPushHelp" },
  { command: "add", safety: "danger", labelKey: "composer.vmGitAdd", descriptionKey: "composer.vmGitAddHelp" },
  { command: "commit", safety: "danger", labelKey: "composer.vmGitCommit", descriptionKey: "composer.vmGitCommitHelp" },
  { command: "restore", safety: "danger", labelKey: "composer.vmGitRestore", descriptionKey: "composer.vmGitRestoreHelp" },
  { command: "clean", safety: "danger", labelKey: "composer.vmGitClean", descriptionKey: "composer.vmGitCleanHelp" },
  { command: "revert", safety: "danger", labelKey: "composer.vmGitRevert", descriptionKey: "composer.vmGitRevertHelp" },
  { command: "reset", safety: "danger", labelKey: "composer.vmGitReset", descriptionKey: "composer.vmGitResetHelp" },
  { command: "checkout", safety: "danger", labelKey: "composer.vmGitCheckout", descriptionKey: "composer.vmGitCheckoutHelp" },
  { command: "switch", safety: "danger", labelKey: "composer.vmGitSwitch", descriptionKey: "composer.vmGitSwitchHelp" },
  { command: "merge", safety: "danger", labelKey: "composer.vmGitMerge", descriptionKey: "composer.vmGitMergeHelp" },
  { command: "rebase", safety: "danger", labelKey: "composer.vmGitRebase", descriptionKey: "composer.vmGitRebaseHelp" }
] as const;

function isGitCommandRule(rule: { path: string; args?: string[] }, command: string): boolean {
  const executable = rule.path.replace(/\\/g, "/").toLowerCase().split("/").at(-1);
  return (executable === "git" || executable === "git.exe") && rule.args?.[0] === command;
}

export type ComposerWorkingStatus = {
  active: boolean;
  startedAt: number;
  backgroundTerminalCount: number;
  inputTokens: number;
  outputTokens: number;
  activityLabel?: string;
  retrying?: {
    message: string;
    details?: string;
  };
};

function trailingSkillQuery(value: string): string | null {
  const match = /(?:^|\s)\$([\w-]*)$/.exec(value);
  return match ? match[1] ?? "" : null;
}

function SkillMenuSection({ label, skills, onSelect }: { label: string; skills: SkillEntry[]; onSelect: (skill: SkillEntry) => void }) {
  return (
    <>
      <ListSubheader sx={{ lineHeight: 2.25, px: 1.25, fontWeight: 800 }}>{label}</ListSubheader>
      {skills.map((skill) => (
        <MenuItem key={skill.path || skill.name} onClick={() => onSelect(skill)} sx={{ borderRadius: 2, minHeight: 38, alignItems: "flex-start", py: 0.65 }}>
          <BuildIcon fontSize="small" style={{ marginRight: 14, marginTop: 3 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap>{skill.displayName || skill.name}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>{skill.shortDescription || skill.description || `$${skill.name}`}</Typography>
          </Box>
          <Typography variant="caption" color="text.disabled" sx={{ ml: 1, pt: 0.15 }}>$</Typography>
        </MenuItem>
      ))}
    </>
  );
}

const MAX_COMPOSER_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_COMPOSER_IMAGE_TOTAL_BYTES = 128 * 1024 * 1024;
const SUPPORTED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
export const COMPOSER_FILE_INPUT_ACCEPT = "*/*";
const COMPOSER_HISTORY_STORAGE_KEY = "codex-ultra.composer-input-history";
const MAX_COMPOSER_HISTORY = 100;

export function Composer({
  cwd,
  additionalRoots = [],
  onAddAdditionalRoot,
  onRemoveAdditionalRoot,
  permission,
  disabled,
  pendingMention,
  suggestedPrompt,
  activeThemePlugin,
  backgroundImage,
  sendBlockedReason,
  sessionToken,
  t,
  modeBadges = { fast: false, plan: false, goalActive: false },
  dangerBypassConfirmed,
  permissionScopeLabel,
  running = false,
  workingStatus,
  statusKind,
  statusLabel,
  runtimeControls,
  contextTrailingAction,
  gitBranch,
  gitDirtyCount = 0,
  onOpenGit,
  vmEnabled = false,
  onVmEnabledChange,
  vmPolicy,
  onVmPolicyChange,
  onVmSave,
  compact = false,
  onToggleCompact,
  imageChannels = [],
  selectedImageChannel = "",
  onImageChannelChange,
  contextUsage,
  waterfallDisplayMode = "recent-tools",
  allowedPermissions,
  onMentionConsumed,
  onUserActivity,
  onSuggestedPromptConsumed,
  onPermissionChange,
  onWaterfallDisplayModeChange,
  onTogglePlanMode,
  onStop,
  threads = [],
  skills = [],
  apps = [],
  onOpenApps,
  onSend,
  onSteer,
  onRelayShareDetected,
  mobileLayout = false,
  mobileRelayAction,
  activeThreadId = null,
  backendName,
}: Props) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ComposerImageAttachment[]>([]);
  const [mentions, setMentions] = useState<ComposerMention[]>([]);
  const [imageError, setImageError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [commandMenuAnchorEl, setCommandMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [skillMenuAnchorEl, setSkillMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [waterfallMenuAnchorEl, setWaterfallMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [mobileToolsAnchorEl, setMobileToolsAnchorEl] = useState<HTMLElement | null>(null);
  const mobileToolsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [vmDialogOpen, setVmDialogOpen] = useState(false);
  const [vmEnabledDraft, setVmEnabledDraft] = useState<boolean>(Boolean(vmEnabled));
  const [vmEditorTab, setVmEditorTab] = useState<VmEditorTab>("execution");
  const [vmDraft, setVmDraft] = useState<SaVmPolicyConfig>(() => vmPolicy ?? createDefaultSaVmPolicyConfig());
  const [vmPathInput, setVmPathInput] = useState<Record<SaVmFsAccess, string>>({ read: "", write: "", deny: "" });
  const [vmSalaRoot, setVmSalaRoot] = useState("");
  const [vmSaving, setVmSaving] = useState(false);
  const [enhanceDialogOpen, setEnhanceDialogOpen] = useState(false);
  const [jevDialogOpen, setJevDialogOpen] = useState(false);
  const [jevConfig, setJevConfig] = useState<JevConfig>(() => loadJevConfig());
  const [jevVerdict, setJevVerdict] = useState<JevVerdict | null>(null);
  const [jevError, setJevError] = useState("");
  const [jevToastOpen, setJevToastOpen] = useState(false);
  const jevToastTimerRef = useRef(0);
  const jevActiveThreadRef = useRef<string | null>(activeThreadId ?? null);
  jevActiveThreadRef.current = activeThreadId ?? null;
  // 切换对话时清空上一对话的 verdict/toast，避免串台误督促。
  useEffect(() => {
    setJevVerdict(null);
    setJevError("");
    setJevToastOpen(false);
    window.clearTimeout(jevToastTimerRef.current);
  }, [activeThreadId]);
  // 手动督促走正常发送通道 (onSend)：toast 已按归属线程过滤，
  // 此处的 verdict 必是当前对话的，新起普通一轮。
  // 不能走 onSteer——steer 只用于运行中插话，会破坏 turn 语义。

  const showJevToast = (): void => {
    setJevToastOpen(true);
    window.clearTimeout(jevToastTimerRef.current);
    jevToastTimerRef.current = window.setTimeout(() => setJevToastOpen(false), 18_000);
  };

  const handleJevNudge = (): void => {
    if (!jevVerdict) return;
    window.clearTimeout(jevToastTimerRef.current);
    setJevToastOpen(false);
    // 正常发送：新起普通一轮，不碰 steer，不清空输入框与历史。
    const text = jevVerdict.kind === "plan"
      ? buildJevPlanNudgeText(jevVerdict as JevPlanVerdict)
      : jevVerdict.kind === "brief" || jevVerdict.kind === "report"
        ? buildJevSubNudgeText(jevVerdict as JevSubVerdict)
        : buildJevNudgeText(jevVerdict);
    void Promise.resolve(onSend(text, [], [])).catch(() => undefined);
  };

  useEffect(() => {
    // 触发侧按本 Composer 当前对话过滤：后台对话的 turn 不再触发上游评审，
    // 主对话 + sidechat 各审各的对话，互不串扰。
    const stopJudge = startJevAutoJudgeListener({ getActiveThreadId: () => jevActiveThreadRef.current });
    const onResult = (event: Event): void => {
      const verdict = (event as CustomEvent<JevVerdict>).detail;
      if (!verdict) return;
      // 只允许勾起当前对话：全局广播的 verdict 必须按 threadId 过滤，
      // 否则后台对话/MCP 子代理钩子完成后会误弹到当前对话并误发送。
      if (!shouldAcceptJevVerdictForThread(jevActiveThreadRef.current, verdict.threadId)) return;
      setJevVerdict(verdict);
      setJevError("");
      // Plan / brief / report audits are display-only in v1 (manual nudge
      // via the toast button). Only turn verdicts feed the auto-nudge streak.
      // In "every" mode a sound plan only flips the status dot — no toast spam.
      if (verdict.kind === "plan") {
        let silent = false;
        try {
          const plan = verdict as JevPlanVerdict;
          silent = loadJevConfig().planReview === "every" && plan.planChoice === "sound";
        } catch {
          // Toast preference must never break verdict display.
        }
        if (!silent) showJevToast();
        return;
      }
      if (verdict.kind === "brief" || verdict.kind === "report") {
        showJevToast();
        return;
      }
      showJevToast();
      // 注意：自动督促的唯一归属是 App 层的按线程 owner（显式 threadIdOverride
      // 到 verdict 归属线程 + 归属线程 running 检查 + 用户手动停止抑制）。
      // Composer 在此绝不自动发送：全局 onSend 只认当前 active 对话，
      // 在 verdict 到达与实际发送之间的异步窗口内一旦切对话，
      // 就会把 A 的督促发到已停止的 B 对话里。展示只做 toast/状态点。
    };
    const onError = (event: Event): void => {
      const detail = (event as CustomEvent<{ message?: string; threadId?: string }>).detail;
      if (!shouldAcceptJevVerdictForThread(jevActiveThreadRef.current, detail?.threadId)) return;
      setJevError(detail?.message || t("jev.composer.failed"));
      showJevToast();
    };
    window.addEventListener(JEV_RESULT_EVENT, onResult);
    window.addEventListener(JEV_ERROR_EVENT, onError);
    return () => {
      stopJudge();
      window.clearTimeout(jevToastTimerRef.current);
      window.removeEventListener(JEV_RESULT_EVENT, onResult);
      window.removeEventListener(JEV_ERROR_EVENT, onError);
    };
  }, [t]);
  const effectivePolicy = useMemo(() => {
    return vmPolicy ?? (cwd ? loadWorkspaceVmPolicy(cwd)?.vmPolicy : undefined) ?? vmDraft;
  }, [vmPolicy, cwd, vmDraft]);
  const activeEnhanceCount = useMemo(() => {
    return countActiveEnhanceTools(effectivePolicy?.tools);
  }, [effectivePolicy?.tools]);
  const isEnhanceActive = activeEnhanceCount > 0;
  const isJevActive = jevConfig.enabled && jevConfig.apiKey.trim().length > 0;
  const isJevPlan = jevVerdict?.kind === "plan";
  const isJevSub = jevVerdict?.kind === "brief" || jevVerdict?.kind === "report";
  const jevPlan = (isJevPlan ? jevVerdict : null) as JevPlanVerdict | null;
  const jevSub = (isJevSub ? jevVerdict : null) as JevSubVerdict | null;
  const jevVerdictLabel = !jevVerdict
    ? ""
    : isJevPlan && jevPlan
      ? formatJevPlanLabel(jevPlan)
      : isJevSub && jevSub
        ? formatJevSubLabel(jevSub)
        : formatJevVerdictLabel(jevVerdict);
  const jevCauseAction = !jevVerdict || isJevPlan || isJevSub ? "" : formatJevCauseAction(jevVerdict);
  const jevCanNudge = Boolean(
    jevVerdict && (isJevPlan
      ? jevPlan?.planChoice === "incomplete" || jevPlan?.planChoice === "wrong_direction"
      : isJevSub && jevSub
        ? jevSub.kind === "brief"
          ? jevSub.subChoice !== "clear"
          : jevSub.subChoice !== "complete"
        : jevVerdict.choice !== "completed")
  );
  const jevSubTone = !jevSub
    ? undefined
    : jevSub.kind === "brief"
      ? jevSub.subChoice === "clear" ? "success" : jevSub.subChoice === "vague" ? "warning" : "error"
      : jevSub.subChoice === "complete" ? "success" : jevSub.subChoice === "failed" ? "error" : "warning";
  const jevHint = jevError || jevVerdictLabel;
  const jevDotColor = jevError
    ? "error.main"
    : !jevVerdict
      ? undefined
      : isJevPlan
        ? jevPlan?.planChoice === "sound"
          ? "success.main"
          : jevPlan?.planChoice === "wrong_direction"
            ? "error.main"
            : "warning.main"
      : isJevSub
        ? jevSubTone === "success" ? "success.main" : jevSubTone === "error" ? "error.main" : "warning.main"
      : jevVerdict.choice === "completed"
        ? "success.main"
        : jevVerdict.choice === "failed"
          ? "error.main"
          : "warning.main";
  const jevTone = jevError || (!isJevPlan && !isJevSub && jevVerdict?.choice === "failed") || jevPlan?.planChoice === "wrong_direction"
    ? "error"
    : (!isJevPlan && !isJevSub && jevVerdict?.choice === "completed") || jevPlan?.planChoice === "sound" || jevSubTone === "success"
      ? "success"
      : jevVerdict
        ? "warning"
        : "info";
  const jevToastDetail = jevError
    ? jevError
    : jevVerdict
      ? [
        `turn ${jevVerdict.turnId.slice(0, 8)}`,
        jevVerdict.model,
        typeof jevVerdict.latencyMs === "number" ? `${jevVerdict.latencyMs}ms` : "",
        jevVerdict.usage?.input_tokens != null || jevVerdict.usage?.output_tokens != null
          ? `tokens ${jevVerdict.usage?.input_tokens ?? "-"} / ${jevVerdict.usage?.output_tokens ?? "-"}`
          : ""
      ].filter(Boolean).join(" · ")
      : "";
  const jevTooltip = jevConfig.apiKey
    ? `${t("jev.composer.title")}${isJevActive ? t("jev.composer.enabled") : t("jev.composer.paused")} · ${jevBaseHost(jevConfig.baseUrl)}${jevHint ? ` · ${jevHint}` : ""}${jevCauseAction ? ` · ${jevCauseAction}` : ""}`
    : t("jev.composer.activate");

  useEffect(() => {
    if (vmPolicy) {
      setVmDraft(vmPolicy);
      setVmSalaRoot(vmPolicy.fs?.salaRoot ?? "");
    }
  }, [vmPolicy]);

  useEffect(() => {
    if (vmDialogOpen) {
      setVmEnabledDraft(Boolean(vmEnabled));
      setVmDraft(vmPolicy ?? createDefaultSaVmPolicyConfig());
      setVmSalaRoot(vmPolicy?.fs?.salaRoot ?? "");
      setVmEditorTab("execution");
    }
  }, [vmDialogOpen, vmEnabled, vmPolicy]);
  const [vmPickerBusy, setVmPickerBusy] = useState<SaVmFsAccess | null>(null);
  const [vmPickerError, setVmPickerError] = useState("");
  const [vmHttpHost, setVmHttpHost] = useState("");
  const [vmHttpPath, setVmHttpPath] = useState("/**");
  const [vmHttpGet, setVmHttpGet] = useState(true);
  const [vmHttpPost, setVmHttpPost] = useState(false);
  const [vmProcessPath, setVmProcessPath] = useState("");
  const [vmProcessArgs, setVmProcessArgs] = useState("");
  const [additionalRootsExpanded, setAdditionalRootsExpanded] = useState(false);
  const [inputHistory, setInputHistory] = useState<string[]>(() => loadComposerInputHistory());
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const addMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const draftBeforeHistoryRef = useRef("");
  const dragDepthRef = useRef(0);
  // 慢网/卡顿时发送按钮仍可点（running 要等服务端回包才变 true），双击会用
  // 同一帧的 text 闭包触发两次 onSend。用 ref 做 1200ms 同内容去重。
  const lastSubmitRef = useRef<{ key: string; at: number } | null>(null);
  const selectedPresetLabel = permissionPresetDisplayLabel(permission, t);
  const selectedPresetDescription = permissionPresetDisplayDescription(permission, t);
  const slashCommandDraft = text.trim().startsWith("/") && !text.trim().startsWith("//") && images.length === 0 && mentions.length === 0;
  const sendBlocked = disabled || (Boolean(sendBlockedReason) && !slashCommandDraft);
  const dangerNotice =
    permission === "dangerBypass"
      ? t("composer.fullAutoNotice")
      : "";
  const hasContent = text.trim().length > 0 || images.length > 0;
  const imageTotalBytes = images.reduce((total, image) => total + image.size, 0);
  const workspaceMentions = useMemo(() => mentions.filter(isWorkspacePathMention), [mentions]);
  const compactActive = compact && images.length === 0 && workspaceMentions.length === 0 && !imageError;
  const permissionOptions = useMemo(
    () => permissionPresets.filter((preset) => !allowedPermissions || allowedPermissions.includes(preset.id)),
    [allowedPermissions]
  );
  const activeSkillQuery = useMemo(() => trailingSkillQuery(text), [text]);
  const visibleSkills = useMemo(() => {
    const query = activeSkillQuery?.toLowerCase() ?? "";
    return skills.filter((skill) => skill.enabled && [skill.name, skill.displayName, skill.shortDescription, skill.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)));
  }, [activeSkillQuery, skills]);
  const personalSkills = useMemo(() => visibleSkills.filter((skill) => isWorkspaceSkillPath(skill.path, cwd)), [cwd, visibleSkills]);
  const systemSkills = useMemo(() => visibleSkills.filter((skill) => !isWorkspaceSkillPath(skill.path, cwd)), [cwd, visibleSkills]);

  useEffect(() => {
    if (!vmDialogOpen) return;
    const defaults = createDefaultSaVmPolicyConfig();
    const configured = vmPolicy ?? {};
    const base: SaVmPolicyConfig = {
      ...defaults,
      ...configured,
      fs: { ...defaults.fs, ...configured.fs },
      http: { ...defaults.http, ...configured.http },
      env: { ...defaults.env, ...configured.env },
      process: { ...defaults.process, ...configured.process },
      execution: { ...defaults.execution, ...configured.execution },
      tools: { ...defaults.tools, ...configured.tools },
      contextSavings: { ...defaults.contextSavings, ...configured.contextSavings }
    };
    const cwdPattern = `${cwd.replace(/[\\/]+$/, "")}/**`;
    const existingEntries = base.fs?.entries ?? [
      ...(base.fs?.read ?? []).map((path) => ({ path, access: "read" as const })),
      ...(base.fs?.write ?? []).map((path) => ({ path, access: "write" as const }))
    ];
    const entries = existingEntries.map((entry) => ({
      ...entry,
      path: entry.path === "${PROJECT}/**" || entry.path === "$PROJECT/**" ? cwdPattern : entry.path
    }));
    if (!entries.some((entry) => entry.path === cwdPattern && entry.access === "write")) entries.unshift({ path: cwdPattern, access: "write" });
    for (const root of additionalRoots) {
      const rootPattern = `${root.replace(/[\\/]+$/, "")}/**`;
      if (!entries.some((entry) => entry.path === rootPattern)) entries.push({ path: rootPattern, access: "read" });
    }
    setVmDraft({
      ...base,
      fs: {
        ...base.fs,
        entries,
        read: entries.filter((entry) => entry.access === "read" || entry.access === "write").map((entry) => entry.path),
        write: entries.filter((entry) => entry.access === "write").map((entry) => entry.path),
        transfer: entries.filter((entry) => entry.access === "write").map((entry) => entry.path)
      },
      execution: { javascript: base.execution?.javascript === true, python: base.execution?.python === true }
    });
    setVmPickerError("");
    setVmSalaRoot(base.fs?.salaRoot || "");
    setVmEditorTab("filesystem");
  }, [additionalRoots, cwd, vmDialogOpen, vmPolicy]);

  const vmEntries = vmDraft.fs?.entries ?? [];
  const vmCurrentWorkspacePattern = `${cwd.replace(/[\\/]+$/, "")}/**`;
  const vmPolicyPreview = useMemo(() => JSON.stringify(vmDraft, null, 2), [vmDraft]);
  const updateVmEntries = (entries: Array<{ path: string; access: SaVmFsAccess }>) => {
    setVmDraft((current) => ({
      ...current,
      fs: {
        ...current.fs,
        entries,
        read: entries.filter((entry) => entry.access === "read" || entry.access === "write").map((entry) => entry.path),
        write: entries.filter((entry) => entry.access === "write").map((entry) => entry.path),
        transfer: entries.filter((entry) => entry.access === "write").map((entry) => entry.path)
      }
    }));
  };
  const addVmPath = (access: SaVmFsAccess) => {
    const value = vmPathInput[access].trim() || cwd;
    const path = value.includes("*") ? value : `${value.replace(/[\\/]+$/, "")}/**`;
    updateVmEntries([...vmEntries.filter((entry) => !(entry.path === path && entry.access === access)), { path, access }]);
    setVmPathInput((current) => ({ ...current, [access]: "" }));
  };
  const browseVmPath = async (access: SaVmFsAccess) => {
    const picker = window.codexUltraDesktop?.pickDirectory;
    if (!picker) {
      setVmPathInput((current) => ({ ...current, [access]: current[access] || cwd }));
      setVmPickerError(t("composer.vmFolderPickerUnavailable"));
      return;
    }
    setVmPickerError("");
    setVmPickerBusy(access);
    try {
      const selectedPath = await picker(cwd);
      if (selectedPath) setVmPathInput((current) => ({ ...current, [access]: selectedPath }));
    } catch {
      setVmPickerError(t("composer.vmFolderPickerFailed"));
    } finally {
      setVmPickerBusy(null);
    }
  };
  const addVmHttpRule = () => {
    const host = vmHttpHost.trim().toLowerCase();
    if (!host || (!vmHttpGet && !vmHttpPost)) return;
    const methods = [vmHttpGet ? "GET" : "", vmHttpPost ? "POST" : ""].filter(Boolean);
    const rule = { host, methods, paths: [vmHttpPath.trim() || "/**"] };
    setVmDraft((current) => ({ ...current, http: { ...current.http, allow: [...(current.http?.allow ?? []), rule] } }));
    setVmHttpHost("");
  };
  const addVmProcessRule = () => {
    const path = vmProcessPath.trim();
    if (!path) return;
    const args = vmProcessArgs.split(",").map((item) => item.trim()).filter(Boolean);
    const rule = args.length > 0 ? { path, args } : { path };
    setVmDraft((current) => ({
      ...current,
      process: {
        ...current.process,
        exec: [...(current.process?.exec ?? []).filter((entry) => entry.path !== path), rule]
      }
    }));
    setVmProcessPath("");
    setVmProcessArgs("");
  };
  const isVmGitCommandEnabled = (command: string) => (vmDraft.process?.exec ?? []).some((rule) => isGitCommandRule(rule, command));
  const setVmGitCommandEnabled = (command: string, enabled: boolean) => {
    setVmDraft((current) => {
      const existing = current.process?.exec ?? [];
      const exec = existing.filter((rule) => !isGitCommandRule(rule, command));
      const option = VM_GIT_COMMAND_OPTIONS.find((candidate) => candidate.command === command);
      if (enabled) exec.push({ path: "git", args: command === "status" || option?.safety === "danger" ? [command, "*"] : [command] });
      return { ...current, process: { ...current.process, exec } };
    });
  };
  const saveVmPolicy = async () => {
    const pendingEntries = (Object.entries(vmPathInput) as Array<[SaVmFsAccess, string]>)
      .map(([access, value]) => {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const path = trimmed.includes("*") ? trimmed : `${trimmed.replace(/[\\/]+$/, "")}/**`;
        return { path, access };
      })
      .filter((entry): entry is { path: string; access: SaVmFsAccess } => Boolean(entry));
    const entries = [...vmEntries];
    for (const entry of pendingEntries) {
      if (!entries.some((candidate) => candidate.path === entry.path && candidate.access === entry.access)) entries.push(entry);
    }
    const nextPolicy: SaVmPolicyConfig = {
      ...vmDraft,
      fs: {
        ...vmDraft.fs,
        salaRoot: vmSalaRoot.trim() || undefined,
        entries,
        read: entries.filter((entry) => entry.access === "read" || entry.access === "write").map((entry) => entry.path),
        write: entries.filter((entry) => entry.access === "write").map((entry) => entry.path),
        transfer: entries.filter((entry) => entry.access === "write").map((entry) => entry.path)
      }
    };
    try {
      setVmSaving(true);
      await onVmSave?.({ enabled: vmEnabledDraft, policy: nextPolicy, cwd });
      onVmEnabledChange?.(vmEnabledDraft);
      onVmPolicyChange?.(nextPolicy);
      setVmDialogOpen(false);
    } finally {
      setVmSaving(false);
    }
  };

  useEffect(() => {
    if (!pendingMention) {
      return;
    }
    setText((current) => (current.trim().length === 0 ? `${pendingMention.token} ` : `${current.trimEnd()} ${pendingMention.token} `));
    setMentions((current) => {
      const existing = current.some((entry) => entry.path === pendingMention.path);
      return existing ? current : [...current, pendingMention];
    });
    onMentionConsumed();
  }, [onMentionConsumed, pendingMention]);

  useEffect(() => {
    if (!suggestedPrompt) {
      return;
    }
    setText(suggestedPrompt.text);
    setHistoryCursor(null);
    draftBeforeHistoryRef.current = "";
    onUserActivity?.();
    onSuggestedPromptConsumed?.();
  }, [onSuggestedPromptConsumed, onUserActivity, suggestedPrompt]);

  const composerBackdrop = safeThemeAssetUrl(
    backgroundImage ?? activeThemePlugin?.assets?.composerBackgroundImage ?? activeThemePlugin?.assets?.cornerImage ?? activeThemePlugin?.assets?.heroImage ?? activeThemePlugin?.assets?.appBackgroundImage
  );
  const themeTuning = themeVisualTuning(activeThemePlugin);

  const permissionControl = (
    <Tooltip
      disableInteractive
      title={[permissionScopeLabel, selectedPresetLabel, selectedPresetDescription].filter(Boolean).join(" - ")}
    >
      <FormControl
        size="small"
        sx={{
          flex: "0 0 36px",
          width: 36,
          "& .MuiOutlinedInput-root": {
            width: 36,
            height: 36,
            borderRadius: "50%",
            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94),
            boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)",
            "& fieldset": {
              borderColor: (theme) => alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.22 : 0.16)
            }
          },
          "& .MuiSelect-select": {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: "0 !important"
          },
          "& .MuiSelect-icon": { display: "none" }
        }}
      >
        <Select
          value={permission}
          data-testid="composer-permission-select"
          aria-label={t("settings.session.permissionPreset")}
          disabled={disabled || !onPermissionChange}
          onChange={(event) => {
            onUserActivity?.();
            onPermissionChange?.(event.target.value as PermissionPresetId);
          }}
          renderValue={(value) => {
            const preset = permissionPresets.find((entry) => entry.id === value);
            return (
              <PanToolAltIcon
                aria-label={preset?.label ?? value}
                sx={{
                  fontSize: 18,
                  color: preset?.id === "dangerBypass" ? "text.secondary" : preset?.severity === "warning" ? "warning.main" : "text.secondary"
                }}
              />
            );
          }}
        >
          {permissionScopeLabel && (
          <ListSubheader disableSticky sx={{ fontSize: 11, lineHeight: "28px", letterSpacing: 0, color: "text.secondary" }}>
            {permissionScopeLabel}
          </ListSubheader>
          )}
          {permissionOptions.map((preset) => (
          <MenuItem key={preset.id} value={preset.id}>
            <Stack spacing={0.25} sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>
                {permissionPresetDisplayLabel(preset.id, t)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "normal" }}>
                {permissionPresetDisplayDescription(preset.id, t)}
              </Typography>
            </Stack>
          </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Tooltip>
  );

  return (
    <Box
      onDragEnter={(event) => {
        if (disabled || !hasSupportedDropData(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (disabled || !hasSupportedDropData(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (disabled || !hasSupportedDropData(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
          setDragActive(false);
        }
      }}
      onDrop={(event) => {
        if (disabled || !hasSupportedDropData(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragActive(false);
        const workspaceDrop = readWorkspaceDragData(event.dataTransfer);
        if (workspaceDrop) {
          addWorkspaceMention(workspaceDrop);
          return;
        }
        void addAttachments(event.dataTransfer.files);
      }}
      sx={{
        position: "relative",
        pt: compactActive ? 1 : { xs: 1.25, sm: 1.5 },
        px: compactActive ? 0.5 : { xs: 1.25, sm: 1.5 },
        pb: compactActive ? 0.5 : { xs: 1.25, sm: 1.5 },
        bgcolor: (theme) => alpha(theme.palette.background.paper, themeTuning.panelSurfaceOpacity),
        backgroundImage: composerBackdrop
          ? (theme) =>
              [
                `linear-gradient(135deg, ${alpha(theme.palette.background.paper, Math.min(0.9, themeTuning.heroOverlayOpacity + 0.12))}, ${alpha(theme.palette.background.paper, themeTuning.heroOverlayOpacity)})`,
                `url("${composerBackdrop}")`
              ].join(", ")
          : undefined,
        backgroundSize: composerBackdrop ? "cover" : undefined,
        backgroundPosition: composerBackdrop ? "center" : undefined,
        outline: dragActive ? "2px solid" : "0 solid",
        outlineColor: "primary.main",
        outlineOffset: dragActive ? -4 : 0,
        transition: "padding 180ms ease, outline-color 120ms ease, outline-width 120ms ease"
      }}
    >
      {jevToastOpen && (jevVerdict || jevError) && (
        <Box
          data-testid="composer-jev-toast"
          sx={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: "100%",
            mb: 1,
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 1,
            borderRadius: 2,
            border: "1px solid",
            borderColor: `${jevTone}.main`,
            bgcolor: "background.paper",
            boxShadow: "0 12px 32px rgba(15, 23, 42, 0.22)"
          }}
        >
          <PsychologyIcon fontSize="small" color={jevTone === "info" ? "disabled" : jevTone} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1.3 }}>
              {jevError ? t("jev.composer.failed") : jevVerdictLabel}
            </Typography>
            {jevCauseAction && !jevError && (
              <Typography variant="caption" color="text.primary" sx={{ display: "block", fontWeight: 700 }}>
                {jevCauseAction}
              </Typography>
            )}
            {jevToastDetail && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {jevError ? jevToastDetail : `🧠 JEV · ${jevToastDetail}`}
              </Typography>
            )}
            {jevCanNudge && (
              <Button
                size="small"
                variant="outlined"
                color={jevTone === "info" ? "primary" : jevTone}
                data-testid="composer-jev-nudge"
                onClick={handleJevNudge}
                sx={{ mt: 0.75 }}
              >
                {t("jev.composer.nudge")}
              </Button>
            )}
          </Box>
          <IconButton
            size="small"
            aria-label={t("jev.composer.dismissVerdict")}
            data-testid="composer-jev-toast-close"
            onClick={() => {
              window.clearTimeout(jevToastTimerRef.current);
              setJevToastOpen(false);
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
      <Stack spacing={1.25}>
        {!mobileLayout && !compactActive && <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "stretch", md: "center" }}
          spacing={0.75}
          data-testid="composer-runtime-status-bar"
          sx={{ order: 10 }}
        >
          <Box sx={{ minWidth: 0, overflowX: "auto", pb: { xs: 0.25, md: 0 } }}>
            {runtimeControls}
          </Box>
          <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={0.5} sx={{ flex: "0 0 auto", minWidth: 0 }}>
          <Tooltip title={cwd}>
            <Chip
              size="small"
              icon={<FolderOpenIcon />}
              label={cwd}
              data-testid="composer-workspace-status-chip"
              sx={{
                height: 28,
                maxWidth: { xs: "100%", sm: 260, lg: 340 },
                borderRadius: 1,
                fontWeight: 750,
                "& .MuiChip-label": {
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }
              }}
            />
          </Tooltip>
          {additionalRoots.length > 0 && (
            <>
              <Tooltip title={additionalRootsExpanded ? t("workspace.hideAdditionalRoots") : t("workspace.showAdditionalRoots")}>
                <IconButton
                  size="small"
                  onClick={() => setAdditionalRootsExpanded((expanded) => !expanded)}
                  aria-label={additionalRootsExpanded ? t("workspace.hideAdditionalRoots") : t("workspace.showAdditionalRoots")}
                  aria-expanded={additionalRootsExpanded}
                  sx={{ borderRadius: 1 }}
                >
                  <ExpandMoreIcon sx={{ transform: additionalRootsExpanded ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }} />
                </IconButton>
              </Tooltip>
              <Collapse in={additionalRootsExpanded} orientation="horizontal" sx={{ display: "flex" }}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {additionalRoots.map((root) => (
                    <Tooltip key={root} title={root}>
                      <Chip size="small" icon={<FolderOpenIcon />} label={root} onDelete={onRemoveAdditionalRoot ? () => onRemoveAdditionalRoot(root) : undefined} sx={{ height: 28, maxWidth: 220, borderRadius: 1 }} />
                    </Tooltip>
                  ))}
                </Stack>
              </Collapse>
            </>
          )}
          {onAddAdditionalRoot && (
            <IconButton size="small" onClick={onAddAdditionalRoot} aria-label={t("workspace.addAdditionalRoot")} data-testid="composer-additional-root-button">
              <AddIcon fontSize="small" />
            </IconButton>
          )}
          <Chip
            size="small"
            color={running || statusKind === "connecting" ? "primary" : statusKind === "idle" ? "success" : statusKind === "disconnect" || statusKind === "engine-error" ? "error" : statusKind === "retrying" ? "warning" : "default"}
            variant={running ? "filled" : "outlined"}
            label={statusLabel ?? statusKind ?? (running ? t("composer.running") : t("composer.ready"))}
            data-testid="composer-turn-status"
            sx={{ height: 28, fontWeight: 800 }}
          />
          {workingStatus?.active && <ComposerWorkingIndicator status={workingStatus} t={t} />}
          <Tooltip
            arrow
            placement="top-end"
            title={
              <Box sx={{ maxWidth: 320 }}>
                <Typography variant="caption" sx={{ display: "block", fontWeight: 800 }}>
                  {t("composer.setup")}
                </Typography>
                <Typography variant="caption" sx={{ display: "block" }}>
                  {t("composer.workspace", { cwd })}
                </Typography>
                <Typography variant="caption" sx={{ display: "block" }}>
                  {t("composer.permissions", { permission: selectedPresetLabel })}
                </Typography>
                <Typography variant="caption" sx={{ display: "block", mt: 0.5, opacity: 0.82 }}>
                  {t("composer.setupDescription")}
                </Typography>
                <Typography variant="caption" sx={{ display: "block", mt: 0.75, fontWeight: 800 }}>
                  {t("composer.shortcuts")}
                </Typography>
                <Typography variant="caption" sx={{ display: "block", opacity: 0.82 }}>
                  {t("composer.shortcutsDescription")}
                </Typography>
              </Box>
            }
          >
            <IconButton size="small" aria-label={t("composer.setupHelp")} sx={{ borderRadius: 1 }}>
              <HelpOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {dangerNotice && (
            <Tooltip arrow placement="top-end" title={dangerNotice}>
              <IconButton
                size="small"
                aria-label={t("composer.fullAutoWarning")}
                sx={{ borderRadius: 1, color: "text.secondary", bgcolor: "action.hover" }}
              >
                <ErrorOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {sendBlockedReason && (
            <Tooltip arrow placement="top-end" title={sendBlockedReason}>
              <IconButton
                size="small"
                aria-label={t("composer.statusNotice")}
                color="info"
                sx={{ borderRadius: 1, bgcolor: (theme) => alpha(theme.palette.info.main, theme.palette.mode === "dark" ? 0.18 : 0.1) }}
              >
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          </Stack>
        </Stack>}
        {imageError && (
          <Alert severity="warning" onClose={() => setImageError("")}>
            {imageError}
          </Alert>
        )}
        {!compactActive && (modeBadges.fast || modeBadges.plan || modeBadges.goalActive) && (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap data-testid="composer-command-badges">
            {modeBadges.fast && <Chip size="small" color="warning" icon={<BoltIcon />} label={t("composer.fastBadge")} data-testid="composer-fast-badge" />}
            {modeBadges.plan && <Chip size="small" color="primary" icon={<ChecklistIcon />} label={t("composer.planBadge")} data-testid="composer-plan-badge" />}
            {modeBadges.goalActive && <Chip size="small" color="success" variant="outlined" icon={<FlagIcon />} label={t("composer.goalBadge")} data-testid="composer-goal-badge" />}
          </Stack>
        )}
        <Box sx={{ position: "relative", order: 20 }}>
          <TextField
            slotProps={{ htmlInput: { "data-testid": "composer-input" } }}
            multiline
            rows={compactActive ? 1 : mobileLayout ? 2 : 3}
            minRows={compactActive ? 1 : mobileLayout ? 2 : 3}
            maxRows={compactActive ? 1 : 8}
            placeholder={t("composer.placeholder", { name: backendName || cliPlugin(DEFAULT_CLI_BACKEND).label })}
            value={text}
            onChange={(event) => {
              const nextText = event.target.value;
              if (isRelayShareText(nextText)) {
                setText("");
                setImages((current) => {
                  current.forEach(revokeAttachmentPreview);
                  return [];
                });
                setMentions([]);
                setMenuAnchorEl(null);
                setCommandMenuAnchorEl(null);
                setSkillMenuAnchorEl(null);
                onRelayShareDetected?.(nextText.trim());
                return;
              }
              const openAddMenu = shouldOpenComposerAddMenu(text, nextText) && Boolean(addMenuButtonRef.current);
              const skillQuery = trailingSkillQuery(nextText);
              if (openAddMenu && addMenuButtonRef.current) {
                setCommandMenuAnchorEl(null);
                setSkillMenuAnchorEl(null);
                setMenuAnchorEl(addMenuButtonRef.current);
              }
              if (skillQuery !== null) {
                setMenuAnchorEl(null);
                setCommandMenuAnchorEl(null);
                setSkillMenuAnchorEl(event.currentTarget);
              } else {
                setSkillMenuAnchorEl(null);
              }
              setText(openAddMenu ? "" : nextText);
              setHistoryCursor(null);
              draftBeforeHistoryRef.current = "";
              if (event.target.value.length > 0) {
                onUserActivity?.();
              }
            }}
            onPaste={(event) => handleComposerPaste(event)}
            onKeyDown={handleTextFieldKeyDown}
            sx={{
              width: "100%",
              "& .MuiOutlinedInput-root": {
                borderRadius: compactActive ? 999 : 3,
                alignItems: compactActive ? "center" : "flex-start",
                pl: compactActive || onToggleCompact ? 5 : 1.5,
                pr: compactActive ? (running ? 14.5 : 6.5) : 1.5,
                pt: compactActive ? 0.65 : 1,
                pb: compactActive ? 0.65 : (mobileLayout ? 6.75 : 6.5),
                minHeight: compactActive ? 44 : undefined
              },
              "& textarea": {
                fontSize: mobileLayout ? 16 : 15,
                lineHeight: compactActive ? 1.4 : 1.65,
                whiteSpace: compactActive ? "nowrap" : undefined,
                overflow: compactActive ? "hidden" : undefined
              }
            }}
          />
          {onToggleCompact && <Tooltip title={compactActive ? t("composer.expand") : t("composer.collapse")}><IconButton
            size="small"
            aria-label={compactActive ? t("composer.expand") : t("composer.collapse")}
            data-testid="composer-compact-toggle"
            onClick={onToggleCompact}
            sx={{ position: "absolute", left: compactActive ? 8 : 4, top: compactActive ? "50%" : 4, transform: compactActive ? "translateY(-50%)" : "none", width: 32, height: 32, color: "primary.main", zIndex: 2 }}
          ><PlayArrowIcon sx={{ fontSize: 19, transform: compactActive ? "rotate(180deg)" : "rotate(90deg)" }} /></IconButton></Tooltip>}
          {compactActive && (
            <CompactContextStatusIndicator
              usage={contextUsage}
              running={running}
              statusKind={statusKind}
              statusLabel={statusLabel ?? statusKind ?? (running ? t("composer.running") : t("composer.ready"))}
            />
          )}
          {!compactActive && <Tooltip title={t("composer.attachTooltip")}>
            <span>
              <IconButton
                ref={addMenuButtonRef}
                data-testid="composer-add-menu-button"
                size="small"
                aria-label={t("composer.attachTooltip")}
                disabled={disabled}
                onClick={(event) => {
                  setCommandMenuAnchorEl(null);
                  setMenuAnchorEl(event.currentTarget);
                }}
                sx={{
                  position: "absolute",
                  left: mobileLayout ? 8 : 12,
                  bottom: mobileLayout ? 8 : 10,
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  border: "1px solid",
                  borderColor: "divider",
                  bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94),
                  boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)",
                  "&:hover": {
                    bgcolor: "background.paper"
                  }
                }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>}
          {!compactActive && <Stack
            direction="row"
            alignItems="center"
            spacing={mobileLayout ? 0.5 : 0.75}
            data-testid={mobileLayout ? "composer-mobile-tool-strip" : undefined}
            sx={{
              position: "absolute",
              left: mobileLayout ? 48 : 56,
              right: running ? (mobileLayout ? (onSteer ? 146 : 100) : (onSteer ? 148 : 104)) : (mobileLayout ? 54 : 60),
              bottom: mobileLayout ? 8 : 10,
              minWidth: 0,
              ...(mobileLayout ? {
                flexWrap: "nowrap",
                overflowX: "auto",
                overflowY: "hidden",
                scrollbarWidth: "none",
                pr: 1.5,
                pb: 0.25,
                maskImage: "linear-gradient(to right, black calc(100% - 16px), transparent 100%)",
                WebkitMaskImage: "linear-gradient(to right, black calc(100% - 16px), transparent 100%)",
                "&::-webkit-scrollbar": { display: "none" },
                "& .MuiIconButton-root": { width: 32, height: 32, flex: "0 0 32px" },
                "& .MuiFormControl-root": { flex: "0 0 32px", width: 32 },
                "& .MuiOutlinedInput-root": { width: "32px !important", height: "32px !important" }
              } : {})
            }}
          >
            {mobileLayout ? (
              <Tooltip title="更多命令与工具">
                <span>
                  <IconButton
                    size="small"
                    ref={mobileToolsButtonRef}
                    data-testid="composer-mobile-tools-button"
                    aria-label="更多命令与工具"
                    aria-haspopup="menu"
                    aria-expanded={mobileToolsAnchorEl ? "true" : undefined}
                    disabled={disabled}
                    onClick={(event) => {
                      setMenuAnchorEl(null);
                      setCommandMenuAnchorEl(null);
                      setSkillMenuAnchorEl(null);
                      setWaterfallMenuAnchorEl(null);
                      mobileToolsButtonRef.current = event.currentTarget;
                      setMobileToolsAnchorEl(event.currentTarget);
                    }}
                    sx={{
                      width: 32,
                      height: 32,
                      flex: "0 0 32px",
                      border: "1px solid",
                      borderColor: (vmEnabled || isEnhanceActive) ? "primary.main" : "divider",
                      color: (vmEnabled || isEnhanceActive) ? "primary.main" : "text.secondary",
                      bgcolor: (theme) => (vmEnabled || isEnhanceActive)
                        ? alpha(theme.palette.primary.main, 0.12)
                        : alpha(theme.palette.background.paper, 0.94),
                      boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)"
                    }}
                  >
                    <MoreHorizIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            ) : (
            <Tooltip title={t("composer.commandsTooltip")}>
              <span>
                <IconButton
                  size="small"
                  data-testid="composer-command-menu-button"
                  aria-label={t("composer.commandsTooltip")}
                  aria-haspopup="menu"
                  aria-expanded={commandMenuAnchorEl ? "true" : undefined}
                  disabled={disabled}
                  onClick={(event) => {
                    setMenuAnchorEl(null);
                    setCommandMenuAnchorEl(event.currentTarget);
                  }}
                  sx={{
                    width: 36,
                    height: 36,
                    flex: "0 0 36px",
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94),
                    boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)"
                  }}
                >
                  <Typography
                    component="span"
                    aria-hidden="true"
                    sx={{ fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 12, fontWeight: 850, lineHeight: 1 }}
                  >
                    {"</>"}
                  </Typography>
                </IconButton>
              </span>
            </Tooltip>
            )}
            {mobileLayout && (
              <>
                <MobileContextRingButton usage={contextUsage} />
                <MobileGitBranchButton branch={gitBranch} dirtyCount={gitDirtyCount} onOpen={onOpenGit} />
              </>
            )}
            {mobileLayout && mobileRelayAction ? mobileRelayAction : null}
            {!mobileLayout && (
            <Tooltip title="Skills">
              <span>
                <IconButton
                  size="small"
                  data-testid="composer-skills-menu-button"
                  aria-label="Skills"
                  aria-haspopup="menu"
                  aria-expanded={skillMenuAnchorEl ? "true" : undefined}
                  disabled={disabled || skills.length === 0}
                  onClick={(event) => {
                    setMenuAnchorEl(null);
                    setCommandMenuAnchorEl(null);
                    setSkillMenuAnchorEl(event.currentTarget);
                  }}
                  sx={{
                    width: 36,
                    height: 36,
                    flex: "0 0 36px",
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94),
                    boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)"
                  }}
                >
                  <BuildIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            )}
            {mobileLayout ? null : permissionControl}
            {!mobileLayout && (
            <Tooltip title={t("composer.waterfallDisplayMode")}>
              <IconButton
                size="small"
                data-testid="composer-waterfall-mode-button"
                aria-label={t("composer.waterfallDisplayMode")}
                aria-haspopup="menu"
                aria-expanded={waterfallMenuAnchorEl ? "true" : undefined}
                onClick={(event) => setWaterfallMenuAnchorEl(event.currentTarget)}
                sx={{
                  width: 36,
                  height: 36,
                  flex: "0 0 36px",
                  border: "1px solid",
                  borderColor: "divider",
                  bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94),
                  boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)"
                }}
              >
                <ViewStreamIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            )}
            <Popover
              open={mobileLayout && Boolean(mobileToolsAnchorEl)}
              anchorEl={mobileToolsAnchorEl}
              onClose={() => setMobileToolsAnchorEl(null)}
              anchorOrigin={{ vertical: "top", horizontal: "left" }}
              transformOrigin={{ vertical: "bottom", horizontal: "left" }}
              slotProps={{ paper: { sx: { p: 0.75, borderRadius: 2.5, minWidth: 232, maxWidth: "calc(100vw - 48px)", boxShadow: "0 20px 50px rgba(15, 23, 42, 0.18)" } } }}
            >
              <Stack data-testid="composer-mobile-tools-panel">
                <ListSubheader sx={{ lineHeight: "32px", px: 1.25, fontWeight: 800 }}>调用</ListSubheader>
                <MenuItem
                  data-testid="composer-mobile-tools-commands"
                  disabled={disabled}
                  onClick={() => {
                    setMobileToolsAnchorEl(null);
                    setMenuAnchorEl(null);
                    setSkillMenuAnchorEl(null);
                    if (mobileToolsButtonRef.current) setCommandMenuAnchorEl(mobileToolsButtonRef.current);
                  }}
                  sx={{ borderRadius: 2, minHeight: 40 }}
                >
                  <Typography component="span" aria-hidden="true" sx={{ fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 12, fontWeight: 850, mr: 1.75, ml: 0.25 }}>{"</>"}</Typography>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>{t("composer.commandsTooltip")}</Typography>
                  </Box>
                </MenuItem>
                <MenuItem
                  data-testid="composer-mobile-tools-skills"
                  disabled={disabled || skills.length === 0}
                  onClick={() => {
                    setMobileToolsAnchorEl(null);
                    setMenuAnchorEl(null);
                    setCommandMenuAnchorEl(null);
                    if (mobileToolsButtonRef.current) setSkillMenuAnchorEl(mobileToolsButtonRef.current);
                  }}
                  sx={{ borderRadius: 2, minHeight: 40 }}
                >
                  <BuildIcon fontSize="small" style={{ marginRight: 14 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>Skills</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{skills.length > 0 ? `${skills.length} available` : t("composer.skillsNoMatch")}</Typography>
                  </Box>
                </MenuItem>
                {(onVmEnabledChange || onVmPolicyChange) && (
                <>
                <ListSubheader sx={{ lineHeight: "32px", px: 1.25, fontWeight: 800 }}>工具</ListSubheader>
                {onVmEnabledChange && (
                <MenuItem
                  data-testid="composer-mobile-tools-vm"
                  disabled={disabled || running}
                  onClick={() => {
                    setMobileToolsAnchorEl(null);
                    setVmDialogOpen(true);
                  }}
                  sx={{ borderRadius: 2, minHeight: 40 }}
                >
                  <SecurityIcon fontSize="small" style={{ marginRight: 14 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>{t("composer.vmLabel")}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{vmEnabled ? "已启用" : t("composer.vmTooltip")}</Typography>
                  </Box>
                </MenuItem>
                )}
                {onVmPolicyChange && (
                <MenuItem
                  data-testid="composer-mobile-tools-enhance"
                  disabled={disabled || running}
                  onClick={() => {
                    setMobileToolsAnchorEl(null);
                    setEnhanceDialogOpen(true);
                  }}
                  sx={{ borderRadius: 2, minHeight: 40 }}
                >
                  <AutoAwesomeIcon fontSize="small" style={{ marginRight: 14 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>代码增强工具</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{isEnhanceActive ? `已启用 (${activeEnhanceCount} 项开启)` : "AST重构、智能诊断、高效检索"}</Typography>
                  </Box>
                </MenuItem>
                )}
                <MenuItem
                  data-testid="composer-mobile-tools-jev"
                  disabled={disabled || running}
                  onClick={() => {
                    setMobileToolsAnchorEl(null);
                    setJevDialogOpen(true);
                  }}
                  sx={{ borderRadius: 2, minHeight: 40 }}
                >
                  <PsychologyIcon fontSize="small" style={{ marginRight: 14 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>{t("jev.composer.title")}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{jevTooltip}</Typography>
                  </Box>
                </MenuItem>
                </>
                )}
                <ListSubheader sx={{ lineHeight: "32px", px: 1.25, fontWeight: 800 }}>视图</ListSubheader>
                <MenuItem
                  data-testid="composer-mobile-tools-waterfall"
                  onClick={() => {
                    setMobileToolsAnchorEl(null);
                    if (mobileToolsButtonRef.current) setWaterfallMenuAnchorEl(mobileToolsButtonRef.current);
                  }}
                  sx={{ borderRadius: 2, minHeight: 40 }}
                >
                  <ViewStreamIcon fontSize="small" style={{ marginRight: 14 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>{t("composer.waterfallDisplayMode")}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{t(`composer.waterfallMode.${waterfallDisplayMode}.label`)}</Typography>
                  </Box>
                </MenuItem>
                <ListSubheader sx={{ lineHeight: "32px", px: 1.25, fontWeight: 800 }}>会话</ListSubheader>
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ px: 1.5, py: 0.5, flexWrap: "wrap" }} data-testid="composer-mobile-tools-session">
                  <GitBranchIndicator branch={gitBranch} dirtyCount={gitDirtyCount} onOpen={onOpenGit} />
                  {contextTrailingAction}
                </Stack>
                <ListSubheader sx={{ lineHeight: "32px", px: 1.25, fontWeight: 800 }}>权限</ListSubheader>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 1.5, py: 0.75 }} data-testid="composer-mobile-tools-permission">
                  {permissionControl}
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>{selectedPresetLabel}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{permissionScopeLabel ?? selectedPresetDescription}</Typography>
                  </Box>
                </Stack>
              </Stack>
            </Popover>
            <Menu
              anchorEl={waterfallMenuAnchorEl}
              open={Boolean(waterfallMenuAnchorEl)}
              onClose={() => setWaterfallMenuAnchorEl(null)}
              anchorOrigin={{ vertical: "top", horizontal: "right" }}
              transformOrigin={{ vertical: "bottom", horizontal: "right" }}
            >
              {(["full", "recent-tools", "post-compaction"] as WaterfallDisplayMode[]).map((mode) => (
                <MenuItem
                  key={mode}
                  selected={waterfallDisplayMode === mode}
                  data-testid={`composer-waterfall-mode-${mode}`}
                  onClick={() => {
                    onWaterfallDisplayModeChange?.(mode);
                    setWaterfallMenuAnchorEl(null);
                  }}
                >
                  <Stack spacing={0.25}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>{t(`composer.waterfallMode.${mode}.label`)}</Typography>
                    <Typography variant="caption" color="text.secondary">{t(`composer.waterfallMode.${mode}.description`)}</Typography>
                  </Stack>
                </MenuItem>
              ))}
            </Menu>
            {!mobileLayout && <ContextUsageIndicator usage={contextUsage} />}
            {!mobileLayout && <GitBranchIndicator branch={gitBranch} dirtyCount={gitDirtyCount} onOpen={onOpenGit} />}
            {onVmEnabledChange && !mobileLayout && <Tooltip title={t("composer.vmTooltip")}>
              <span>
                <IconButton
                  size="small"
                  aria-label={t("composer.vmLabel")}
                  data-testid="composer-vm-button"
                  disabled={disabled || running}
                  onClick={() => setVmDialogOpen(true)}
                  sx={{
                    width: 36,
                    height: 36,
                    flex: "0 0 36px",
                    border: "1px solid",
                    borderColor: vmEnabled ? "primary.main" : "divider",
                    color: vmEnabled ? "primary.main" : "text.secondary",
                    bgcolor: (theme) => vmEnabled ? alpha(theme.palette.primary.main, 0.12) : alpha(theme.palette.background.paper, 0.94),
                    boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)",
                    "&.Mui-disabled": {
                      borderColor: vmEnabled ? "primary.main" : "divider",
                      color: vmEnabled ? "primary.main" : "text.disabled",
                      bgcolor: (theme) => vmEnabled ? alpha(theme.palette.primary.main, 0.12) : alpha(theme.palette.action.disabledBackground, 0.08)
                    }
                  }}
                >
                  <SecurityIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>}
            {onVmPolicyChange && !mobileLayout && (
              <Tooltip title={isEnhanceActive ? `代码增强工具已启用 (${activeEnhanceCount} 项开启)` : "代码增强工具 (AST重构、智能诊断、高效检索)"}>
                <span>
                  <IconButton
                    size="small"
                    aria-label="代码增强工具"
                    data-testid="composer-enhance-button"
                    disabled={disabled || running}
                    onClick={() => setEnhanceDialogOpen(true)}
                    sx={{
                      width: 36,
                      height: 36,
                      flex: "0 0 36px",
                      border: "1px solid",
                      borderColor: isEnhanceActive ? "primary.main" : "divider",
                      color: isEnhanceActive ? "primary.main" : "text.secondary",
                      bgcolor: (theme) => isEnhanceActive ? alpha(theme.palette.primary.main, 0.12) : alpha(theme.palette.background.paper, 0.94),
                      boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)",
                      "&.Mui-disabled": {
                        borderColor: isEnhanceActive ? "primary.main" : "divider",
                        color: isEnhanceActive ? "primary.main" : "text.disabled",
                        bgcolor: (theme) => isEnhanceActive ? alpha(theme.palette.primary.main, 0.12) : alpha(theme.palette.action.disabledBackground, 0.08)
                      }
                    }}
                  >
                    <AutoAwesomeIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {!mobileLayout && (
              <Tooltip title={jevTooltip}>
                <span style={{ position: "relative", display: "inline-flex" }}>
                  <IconButton
                    size="small"
                    aria-label={t("jev.composer.title")}
                    data-testid="composer-jev-button"
                    disabled={disabled || running}
                    onClick={() => setJevDialogOpen(true)}
                    sx={{
                      width: 36,
                      height: 36,
                      flex: "0 0 36px",
                      border: "1px solid",
                      borderColor: isJevActive ? "primary.main" : "divider",
                      color: isJevActive ? "primary.main" : "text.secondary",
                      bgcolor: (theme) => isJevActive ? alpha(theme.palette.primary.main, 0.12) : alpha(theme.palette.background.paper, 0.94),
                      boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)",
                      "&.Mui-disabled": {
                        borderColor: isJevActive ? "primary.main" : "divider",
                        color: isJevActive ? "primary.main" : "text.disabled",
                        bgcolor: (theme) => isJevActive ? alpha(theme.palette.primary.main, 0.12) : alpha(theme.palette.action.disabledBackground, 0.08)
                      }
                    }}
                  >
                    <PsychologyIcon fontSize="small" />
                  </IconButton>
                  {jevDotColor && (
                    <Box
                      data-testid="composer-jev-status-dot"
                      sx={{
                        position: "absolute",
                        top: 1,
                        right: 1,
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        bgcolor: jevDotColor,
                        border: "2px solid",
                        borderColor: "background.paper",
                        pointerEvents: "none"
                      }}
                    />
                  )}
                </span>
              </Tooltip>
            )}
            {mobileLayout ? null : contextTrailingAction}
          </Stack>}
          <Tooltip
            title={
              running
                ? t("composer.queuePrompt")
                : images.length > 0
                ? t("composer.imageSummary", {
                    count: images.length,
                    imageLabel: t(images.length === 1 ? "composer.imageOne" : "composer.imageOther"),
                    bytes: formatBytes(imageTotalBytes)
                  })
                : selectedPresetDescription
            }
          >
            <span>
              <IconButton
                color="primary"
                aria-label={running ? t("composer.queuePrompt") : t("composer.send")}
                disabled={sendBlocked || !hasContent}
                onClick={() => {
                  onUserActivity?.();
                  submitComposer(text, images, mentions);
                }}
                sx={{
                  position: "absolute",
                  right: compactActive ? 4 : (mobileLayout ? 8 : 12),
                  bottom: compactActive ? 4 : (mobileLayout ? 8 : 10),
                  width: compactActive ? 36 : (mobileLayout ? 38 : 40),
                  height: compactActive ? 36 : (mobileLayout ? 38 : 40),
                  bgcolor: (theme) => theme.palette.mode === "dark" ? theme.palette.primary.main : "#111827",
                  color: "#fff",
                  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.18)",
                  "&:hover": {
                    bgcolor: (theme) => theme.palette.mode === "dark" ? theme.palette.primary.dark : "#020617"
                  },
                  "&.Mui-disabled": {
                    bgcolor: "action.disabledBackground",
                    color: "action.disabled"
                  }
                }}
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          {running && onSteer && (
            <Tooltip title="steer">
              <span>
                <IconButton
                  color="secondary"
                  aria-label="Steer"
                  disabled={sendBlocked || !hasContent}
                  onClick={() => {
                    onUserActivity?.();
                    void submitComposer(text, images, mentions, onSteer);
                  }}
                  sx={{
                    position: "absolute",
                    right: compactActive ? 84 : (mobileLayout ? 100 : 104),
                    bottom: compactActive ? 4 : (mobileLayout ? 8 : 12),
                    width: mobileLayout ? 38 : 36,
                    height: mobileLayout ? 38 : 36,
                    bgcolor: (theme) => alpha(theme.palette.secondary.main, theme.palette.mode === "dark" ? 0.3 : 0.15),
                    border: "1px solid",
                    borderColor: (theme) => alpha(theme.palette.secondary.main, 0.45),
                    "&:hover": {
                      bgcolor: (theme) => alpha(theme.palette.secondary.main, theme.palette.mode === "dark" ? 0.42 : 0.24)
                    }
                  }}
                >
                  <BoltIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          {running && (
            <Tooltip title={t("composer.stop")}>
              <span>
                <IconButton
                  color="error"
                  aria-label={t("composer.stop")}
                  disabled={!onStop}
                  onClick={() => onStop?.()}
                  sx={{
                    position: "absolute",
                    right: compactActive ? 44 : (mobileLayout ? 54 : 58),
                    bottom: compactActive ? 4 : (mobileLayout ? 8 : 12),
                    width: mobileLayout ? 38 : 36,
                    height: mobileLayout ? 38 : 36,
                    bgcolor: (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.24 : 0.12),
                    color: "error.main",
                    border: "1px solid",
                    borderColor: (theme) => alpha(theme.palette.error.main, 0.38),
                    "&:hover": {
                      bgcolor: (theme) => alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.32 : 0.18)
                    }
                  }}
                >
                  <StopIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
        {images.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 0.5 }}>
            {images.map((image) => (
              <Box
                key={image.id}
                sx={{
                  width: 112,
                  flex: "0 0 auto",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  overflow: "hidden",
                  bgcolor: "background.default"
                }}
              >
                <Box sx={{ position: "relative", aspectRatio: "4 / 3", display: "grid", placeItems: "center" }}>
                  {(image.kind ?? "image") === "image" ? (
                    <Box
                      component="img"
                      src={image.previewUrl ?? image.url}
                      alt={image.name}
                      sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <DescriptionIcon color="action" sx={{ fontSize: 36 }} />
                  )}
                  <IconButton
                    size="small"
                    aria-label={`Remove ${image.name}`}
                    onClick={() => {
                      revokeAttachmentPreview(image);
                      setImages((current) => current.filter((entry) => entry.id !== image.id));
                    }}
                    sx={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      bgcolor: "rgba(255,255,255,0.9)",
                      "&:hover": { bgcolor: "background.paper" }
                    }}
                  >
                    <CloseIcon fontSize="inherit" />
                  </IconButton>
                </Box>
                <Typography
                  variant="caption"
                  title={image.name}
                  sx={{ display: "block", px: 0.75, py: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {image.name}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
        {workspaceMentions.length > 0 && (
          <Stack spacing={0.75}>
            {workspaceMentions.map((mention) => (
              <Box
                key={mention.path}
                data-testid="composer-workspace-reference"
                sx={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 1,
                  px: 1,
                  py: 0.75,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  bgcolor: "background.default"
                }}
              >
                {mention.kind === "image" ? <ImageIcon fontSize="small" color="primary" /> : <DescriptionIcon fontSize="small" color="action" />}
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" sx={{ display: "block", fontWeight: 800 }}>
                    {mention.kind === "image" ? "Image path" : "File path"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                    {mention.path}
                  </Typography>
                </Box>
                <IconButton
                  size="small"
                  aria-label={"Remove " + mention.path}
                  onClick={() => removeWorkspaceMention(mention)}
                  sx={{ alignSelf: "start" }}
                >
                  <CloseIcon fontSize="inherit" />
                </IconButton>
              </Box>
            ))}
          </Stack>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={COMPOSER_FILE_INPUT_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            void addAttachments(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void addAttachments(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <Menu
          anchorEl={menuAnchorEl}
          open={Boolean(menuAnchorEl)}
          onClose={() => setMenuAnchorEl(null)}
          anchorOrigin={{ vertical: "top", horizontal: "left" }}
          transformOrigin={{ vertical: "bottom", horizontal: "left" }}
          slotProps={{
            paper: {
              sx: {
                width: { xs: "calc(100vw - 48px)", sm: 420 },
                maxWidth: 520,
                borderRadius: 3,
                p: 1,
                boxShadow: "0 20px 50px rgba(15, 23, 42, 0.18)"
              }
            }
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ px: 1.25, py: 0.75 }}>
            {t("composer.menu.add")}
          </Typography>
          {imageChannels.length > 0 && (
            <Box sx={{ px: 1, pb: 0.75 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Image channel</InputLabel>
                <Select
                  value={selectedImageChannel}
                  label="Image channel"
                  data-testid="composer-image-channel-select"
                  onChange={(event) => {
                    const selected = imageChannels.find((entry) => `${entry.providerId}:${entry.groupId}` === event.target.value);
                    if (selected) onImageChannelChange?.(selected.providerId, selected.groupId, selected.model);
                  }}
                >
                  {imageChannels.map((entry) => (
                    <MenuItem key={`${entry.providerId}:${entry.groupId}`} value={`${entry.providerId}:${entry.groupId}`}>
                      {entry.label}{entry.priceLabel ? ` · ${entry.priceLabel}` : ""}{entry.notice ? " · 资源紧张" : ""}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          )}
          <MenuItem
            data-testid="composer-menu-upload"
            disabled={disabled}
            onClick={() => {
              setMenuAnchorEl(null);
              fileInputRef.current?.click();
            }}
            sx={{ borderRadius: 2, minHeight: 42 }}
          >
            <DescriptionIcon fontSize="small" style={{ marginRight: 14 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2">{t("composer.fileButton")}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t("composer.attachTooltip")}
              </Typography>
            </Box>
          </MenuItem>
          <ComposerMenuItem icon={<ImageIcon fontSize="small" />} label={t("chatgptShell.contextButton.addImage")} detail={t("composer.attachTooltip")} disabled={disabled} onClick={() => { setMenuAnchorEl(null); imageInputRef.current?.click(); }} />
          <ComposerMenuItem icon={<LinkIcon fontSize="small" />} label={t("chatgptShell.contextButton.addLink")} detail="Paste a URL into the composer" disabled={disabled} onClick={() => appendComposerText("https://")} />
          <ListSubheader sx={{ lineHeight: 2.4, px: 1.25 }}>{t("chatgptShell.contextButton.mentionThread")}</ListSubheader>
          {threads.slice(0, 8).map((thread) => {
            const title = thread.title || thread.name || thread.preview || thread.id.slice(0, 8);
            return <MenuItem key={thread.id} disabled={disabled} onClick={() => appendComposerMention({ name: title, path: thread.path || `thread://${thread.id}`, token: `@${title.replace(/\s+/g, "-")}`, kind: "thread" })} sx={{ borderRadius: 2, minHeight: 36 }}><ForumIcon fontSize="small" style={{ marginRight: 14 }} /><Typography variant="body2" noWrap>{title}</Typography></MenuItem>;
          })}
          <ComposerMenuItem icon={<AppsIcon fontSize="small" />} label={t("chatgptShell.contextButton.useApp")} detail={apps.length > 0 ? `${apps.length} available` : "Manage connected apps"} disabled={disabled} onClick={() => { setMenuAnchorEl(null); onOpenApps?.(); }} />
          <MenuItem
            data-testid="composer-menu-generate-image"
            disabled={disabled}
            onClick={() => {
              setMenuAnchorEl(null);
              setSlashTemplate("/image ");
            }}
            sx={{ borderRadius: 2, minHeight: 42 }}
          >
            <AutoAwesomeIcon fontSize="small" style={{ marginRight: 14 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2">Generate image</Typography>
              <Typography variant="caption" color="text.secondary">
                Create a new image from text
              </Typography>
            </Box>
          </MenuItem>
          <MenuItem
            data-testid="composer-menu-edit-image"
            disabled={disabled || images.length === 0}
            onClick={() => {
              setMenuAnchorEl(null);
              setSlashTemplate("/edit-image ");
            }}
            sx={{ borderRadius: 2, minHeight: 42 }}
          >
            <ImageIcon fontSize="small" style={{ marginRight: 14 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2">Edit selected image</Typography>
              <Typography variant="caption" color="text.secondary">
                Use attached images as input
              </Typography>
            </Box>
          </MenuItem>
          <MenuItem
            data-testid="composer-menu-create-video"
            disabled
            sx={{ borderRadius: 2, minHeight: 42 }}
          >
            <MovieIcon fontSize="small" style={{ marginRight: 14 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2">Create video</Typography>
              <Typography variant="caption" color="text.secondary">
                Coming soon
              </Typography>
            </Box>
          </MenuItem>
          {/* 移动版命令/技能/VM/增强/瀑布流折进 composer-mobile-tools-button，向上展开分组 Popover；桌面版保持横条直排 */}
        </Menu>
        <Menu
          anchorEl={skillMenuAnchorEl}
          open={Boolean(skillMenuAnchorEl)}
          onClose={() => setSkillMenuAnchorEl(null)}
          anchorOrigin={{ vertical: "top", horizontal: "left" }}
          transformOrigin={{ vertical: "bottom", horizontal: "left" }}
          slotProps={{
            paper: {
              sx: {
                width: { xs: "calc(100vw - 48px)", sm: 520 },
                maxWidth: 620,
                maxHeight: "min(560px, calc(100vh - 96px))",
                borderRadius: 3,
                p: 0.75,
                boxShadow: "0 20px 50px rgba(15, 23, 42, 0.18)"
              }
            }
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1.25, py: 0.5 }}>
            {t("composer.skillsShortcut")}
          </Typography>
          {personalSkills.length > 0 && <SkillMenuSection label={t("composer.skillsPersonal")} skills={personalSkills} onSelect={selectSkill} />}
          {systemSkills.length > 0 && <SkillMenuSection label={t("composer.skillsSystem")} skills={systemSkills} onSelect={selectSkill} />}
          {visibleSkills.length === 0 && <Typography color="text.secondary" variant="body2" sx={{ px: 1.25, py: 1 }}>
            {t("composer.skillsNoMatch")}
          </Typography>}
        </Menu>
        <Menu
          anchorEl={commandMenuAnchorEl}
          open={Boolean(commandMenuAnchorEl)}
          onClose={() => setCommandMenuAnchorEl(null)}
          anchorOrigin={{ vertical: "top", horizontal: "left" }}
          transformOrigin={{ vertical: "bottom", horizontal: "left" }}
          slotProps={{
            paper: {
              sx: {
                width: { xs: "calc(100vw - 48px)", sm: 360 },
                maxWidth: 440,
                maxHeight: "min(560px, calc(100vh - 96px))",
                borderRadius: 3,
                p: 1,
                boxShadow: "0 20px 50px rgba(15, 23, 42, 0.18)"
              }
            }
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ px: 1.25, py: 0.75 }}>
            {t("composer.menu.commands")}
          </Typography>
          <ComposerMenuItem icon={<CompressIcon fontSize="small" />} label="/compact" detail={t("composer.compactTooltip")} disabled={disabled} onClick={() => runSlashCommandShortcut("/compact")} />
          <ComposerMenuItem icon={<FlagIcon fontSize="small" />} label="/goal" detail={t("composer.goalTooltip")} disabled={disabled} onClick={() => setSlashTemplate("/goal ")} />
          <ComposerMenuItem icon={<ChecklistIcon fontSize="small" />} label="/plan" detail={t("composer.planTooltip")} disabled={disabled} onClick={() => runSlashCommandShortcut(modeBadges.plan ? "/plan off" : "/plan")} />
          <ComposerMenuItem icon={<BoltIcon fontSize="small" />} label="/fast" detail={t("composer.fastTooltip")} disabled={disabled} onClick={() => runSlashCommandShortcut("/fast")} />
          <ComposerMenuItem icon={<AssessmentIcon fontSize="small" />} label="/status" detail={t("composer.statusTooltip")} disabled={disabled} onClick={() => runSlashCommandShortcut("/status")} />
          <ComposerMenuItem icon={<AssessmentIcon fontSize="small" />} label="/stats" detail={t("composer.statsTooltip")} disabled={disabled} onClick={() => runSlashCommandShortcut("/stats")} />
          <ComposerMenuItem icon={<DifferenceIcon fontSize="small" />} label="/diff" detail={t("composer.diffTooltip")} disabled={disabled} onClick={() => runSlashCommandShortcut("/diff")} />
          <ComposerMenuItem icon={<RateReviewIcon fontSize="small" />} label="/review" detail={t("composer.reviewTooltip")} disabled={disabled} onClick={() => runSlashCommandShortcut("/review")} />
          <ComposerMenuItem icon={<EditNoteIcon fontSize="small" />} label="/rename" detail={t("composer.renameTooltip")} disabled={disabled} onClick={() => setSlashTemplate("/rename ")} />
        </Menu>
        <Dialog open={vmDialogOpen} onClose={() => setVmDialogOpen(false)} fullWidth maxWidth="md" data-testid="composer-vm-dialog">
          <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1, fontWeight: 850 }}>
            <Typography component="span" sx={{ flex: 1, fontWeight: 850 }}>{t("composer.vmPolicyTitle")}</Typography>
            {onVmEnabledChange && (
              <FormControlLabel
                sx={{ m: 0, mr: 1 }}
                control={<Switch checked={vmEnabledDraft} onChange={(event) => setVmEnabledDraft(event.target.checked)} inputProps={{ "aria-label": t("composer.vmLabel") }} />}
                label={t("composer.vmLabel")}
              />
            )}
            <IconButton aria-label={t("composer.close")} onClick={() => setVmDialogOpen(false)} size="small" data-testid="composer-vm-close">
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            <Alert severity="info" sx={{ mb: 2 }}>
              {t("composer.vmPolicyIntro")}
            </Alert>
            <Tabs value={vmEditorTab} onChange={(_, value: VmEditorTab) => setVmEditorTab(value)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
              <Tab value="execution" label={t("composer.vmTabExecution")} />
              <Tab value="filesystem" label={t("composer.vmTabFilesystem")} />
              <Tab value="network" label={t("composer.vmTabNetwork")} />
              <Tab value="savings" label={t("composer.vmTabSavings") || "上下文节省"} />
              <Tab value="preview" label={t("composer.vmTabPreview")} />
            </Tabs>
            {vmEditorTab === "execution" && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <VmToolsSettingsTab
                  vmDraft={vmDraft}
                  setVmDraft={setVmDraft}
                  onNavigateTab={(tab) => setVmEditorTab(tab)}
                />
                <Divider sx={{ my: 0.5 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 0.5 }}>{t("composer.vmGitTitle")}</Typography>
                <Alert severity="info" sx={{ mb: 1.25 }}>{t("composer.vmGitHelp")}</Alert>
                {(["safe", "danger"] as const).map((safety) => <Box key={safety} sx={{ mb: 1.25 }}>
                  <Typography variant="caption" color={safety === "danger" ? "error.main" : "success.main"} sx={{ fontWeight: 800 }}>{t(safety === "safe" ? "composer.vmGitSafe" : "composer.vmGitDanger")}</Typography>
                  <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                    {VM_GIT_COMMAND_OPTIONS.filter((option) => option.safety === safety).map((option) => <Box key={option.command} sx={{ px: 1, py: 0.75, border: "1px solid", borderColor: option.safety === "danger" ? "error.light" : "divider", borderRadius: 1.5, bgcolor: option.safety === "danger" ? (theme) => alpha(theme.palette.error.main, 0.035) : "transparent" }}>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Switch size="small" checked={isVmGitCommandEnabled(option.command)} onChange={(event) => setVmGitCommandEnabled(option.command, event.target.checked)} inputProps={{ "aria-label": t(option.labelKey) }} data-testid={`composer-vm-git-${option.command}`} />
                        <Typography variant="body2" sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 700 }}>{t(option.labelKey)}</Typography>
                        <Tooltip title={t(option.descriptionKey)}><InfoOutlinedIcon fontSize="small" color={option.safety === "danger" ? "error" : "action"} /></Tooltip>
                      </Stack>
                    </Box>)}
                  </Stack>
                </Box>)}
                <Divider sx={{ my: 0.5 }} />
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 1 }}>自定义进程与环境变量白名单 (Custom Processes & Env)</Typography>
                  <FormControlLabel control={<Switch size="small" checked={vmDraft.process?.spawn === true} onChange={(event) => setVmDraft((current) => ({ ...current, process: { ...current.process, spawn: event.target.checked } }))} />} label={t("composer.vmCustomProcesses")} />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
                    <TextField size="small" label={t("composer.vmProcessPath")} value={vmProcessPath} onChange={(event) => setVmProcessPath(event.target.value)} placeholder="rg" sx={{ flex: 1 }} />
                    <TextField size="small" label={t("composer.vmProcessArgs")} value={vmProcessArgs} onChange={(event) => setVmProcessArgs(event.target.value)} placeholder="--files" sx={{ flex: 1 }} />
                    <Button variant="outlined" onClick={addVmProcessRule}>{t("composer.add")}</Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>{t("composer.vmProcessHelp")}</Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.75 }}>
                    {(vmDraft.process?.exec ?? []).filter((rule) => !VM_GIT_COMMAND_OPTIONS.some((option) => isGitCommandRule(rule, option.command))).map((rule, index) => (
                      <Stack key={`${rule.path}-${index}`} direction="row" spacing={1} alignItems="center">
                        <Chip size="small" label="process" />
                        <Typography variant="caption" sx={{ flex: 1, overflowWrap: "anywhere" }}>{rule.path}{rule.args?.length ? ` ${rule.args.join(" ")}` : ` ${t("composer.vmProcessAnyArgs")}`}</Typography>
                        <IconButton size="small" aria-label={`${t("composer.remove")} ${rule.path}`} onClick={() => setVmDraft((current) => ({ ...current, process: { ...current.process, exec: (current.process?.exec ?? []).filter((entry) => entry !== rule) } }))}><DeleteOutlineIcon fontSize="small" /></IconButton>
                      </Stack>
                    ))}
                  </Stack>
                  <TextField sx={{ mt: 1.5 }} size="small" fullWidth label={t("composer.vmEnvironment")} value={(vmDraft.env?.allow ?? []).join(", ")} onChange={(event) => setVmDraft((current) => ({ ...current, env: { ...current.env, allow: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } }))} placeholder="CWD, PROJECT" />
                </Box>
              </Box>
            )}
            {vmEditorTab === "savings" && (
              <VmContextSavingsTab vmDraft={vmDraft} setVmDraft={setVmDraft} />
            )}
            {vmEditorTab === "filesystem" && <>
              <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 1 }}>{t("composer.vmFilesystemTitle")}</Typography>
              <TextField size="small" fullWidth label="Sala 文档路径（只读）" value={vmSalaRoot} onChange={(event) => setVmSalaRoot(event.target.value)} placeholder="留空使用当前安装包内置 Sala 路径" helperText="该路径会随当前对话保存，并默认只授予读取权限；生成的 SKILL.md 会写入解析后的绝对路径。" sx={{ mb: 1.5 }} />
              <Box sx={{ mb: 1.5, px: 1.5, py: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 2, bgcolor: (theme) => alpha(theme.palette.info.main, 0.045) }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 750 }}>{t("composer.vmCurrentWorkspace")}</Typography>
                    <Typography variant="caption" sx={{ display: "block", overflowWrap: "anywhere", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{vmCurrentWorkspacePattern}</Typography>
                  </Box>
                  <Button size="small" variant="outlined" onClick={() => setVmPathInput((current) => ({ ...current, write: current.write || cwd }))}>{t("composer.vmUseCurrentWorkspace")}</Button>
                </Stack>
              </Box>
              {(["read", "write", "deny"] as SaVmFsAccess[]).map((access) => {
                const accessLabel = access === "read" ? t("composer.vmAccessRead") : access === "write" ? t("composer.vmAccessWrite") : t("composer.vmAccessDeny");
                return <Box key={access} sx={{ mb: 1.25 }}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
                    <TextField size="small" fullWidth label={t("composer.vmPathLabel", { access: accessLabel })} helperText={access !== "deny" ? t("composer.vmPathDefaultHint") : undefined} value={vmPathInput[access]} onChange={(event) => setVmPathInput((current) => ({ ...current, [access]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addVmPath(access); } }} placeholder={access === "deny" ? `${cwd}/secrets` : cwd} />
                    <Button variant="outlined" startIcon={<FolderOpenIcon />} disabled={vmPickerBusy !== null} onClick={() => void browseVmPath(access)} data-testid={`composer-vm-browse-${access}`}>{t("composer.vmBrowse")}</Button>
                    <Button variant="outlined" onClick={() => addVmPath(access)} data-testid={`composer-vm-add-${access}`}>{t("composer.add")}</Button>
                  </Stack>
                </Box>;
              })}
              {vmPickerError && <Alert severity="warning" sx={{ mb: 1.25 }}>{vmPickerError}</Alert>}
              <Stack spacing={0.5}>
                {vmEntries.map((entry, index) => (
                  <Stack key={`${entry.path}-${entry.access}-${index}`} direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={entry.access} color={entry.access === "deny" ? "error" : entry.access === "write" ? "primary" : "default"} />
                    <Typography variant="caption" sx={{ flex: 1, overflowWrap: "anywhere" }}>{entry.path}</Typography>
                    <IconButton size="small" aria-label={`${t("composer.remove")} ${entry.path}`} onClick={() => updateVmEntries(vmEntries.filter((_, entryIndex) => entryIndex !== index))}><DeleteOutlineIcon fontSize="small" /></IconButton>
                  </Stack>
                ))}
              </Stack>
            </>}
            {vmEditorTab === "network" && <>
              <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 1 }}>{t("composer.vmNetworkTitle")}</Typography>
              <Alert severity="info" sx={{ mb: 1.5 }}>{t("composer.vmNetworkHelp")}</Alert>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
                <TextField size="small" label={t("composer.vmHost")} value={vmHttpHost} onChange={(event) => setVmHttpHost(event.target.value)} placeholder="api.example.com" />
                <TextField size="small" label={t("composer.vmPathGlob")} value={vmHttpPath} onChange={(event) => setVmHttpPath(event.target.value)} placeholder="/v1/**" />
                <FormControlLabel control={<Switch size="small" checked={vmHttpGet} onChange={(event) => setVmHttpGet(event.target.checked)} />} label="GET" />
                <FormControlLabel control={<Switch size="small" checked={vmHttpPost} onChange={(event) => setVmHttpPost(event.target.checked)} />} label="POST" />
                <Button variant="outlined" onClick={addVmHttpRule}>{t("composer.add")}</Button>
              </Stack>
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {(vmDraft.http?.allow ?? []).map((rule, index) => (
                  <Stack key={`${rule.host}-${index}`} direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={(rule.methods ?? ["GET", "POST"]).join("+")} />
                    <Typography variant="caption" sx={{ flex: 1, overflowWrap: "anywhere" }}>{rule.host}{rule.paths?.length ? ` ${rule.paths.join(", ")}` : ""}</Typography>
                    <IconButton size="small" aria-label={`${t("composer.remove")} ${rule.host}`} onClick={() => setVmDraft((current) => ({ ...current, http: { ...current.http, allow: (current.http?.allow ?? []).filter((_, ruleIndex) => ruleIndex !== index) } }))}><DeleteOutlineIcon fontSize="small" /></IconButton>
                  </Stack>
                ))}
              </Stack>
            </>}
            {vmEditorTab === "preview" && <>
              <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{t("composer.vmPreviewTitle")}</Typography>
              <Typography variant="caption" color="text.secondary">{t("composer.vmPreviewHelp")}</Typography>
              <Alert severity="info" sx={{ mt: 1.25, mb: 1.25 }}>{t("composer.vmVerifyHelp")}</Alert>
              <Box component="pre" data-testid="composer-vm-policy-preview" sx={{ m: 0, p: 1.5, maxHeight: 440, overflow: "auto", borderRadius: 1.5, bgcolor: "action.hover", fontSize: 12, lineHeight: 1.45, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{vmPolicyPreview}</Box>
            </>}
          </DialogContent>
          <DialogActions>
            <Button variant="contained" disabled={vmSaving} onClick={saveVmPolicy}>{vmSaving ? (t("composer.saving") || "保存中...") : t("composer.save")}</Button>
          </DialogActions>
        </Dialog>
        <EnhanceToolsDialog
          open={enhanceDialogOpen}
          onClose={() => setEnhanceDialogOpen(false)}
          policy={effectivePolicy}
          jevKeyConfigured={jevConfig.apiKey.trim().length > 0}
          t={t}
          onSave={async (updatedPolicy) => {
            setVmDraft(updatedPolicy);
            onVmPolicyChange?.(updatedPolicy);
            await onVmSave?.({ enabled: vmEnabledDraft, policy: updatedPolicy, cwd });
          }}
        />
        <JevSettingsDialog
          listRelayDirectory={listProjectRelayDirectory}
          open={jevDialogOpen}
          sessionToken={sessionToken}
          config={jevConfig}
          t={t}
          onChange={(next) => {
            // saveJevConfig verifies the local write stuck: on failure keep
            // showing the old value so the dialog never claims "on" while the
            // judge reads "off".
            if (!saveJevConfig(next)) {
              setJevError(t("jev.settings.saveFailed"));
              showJevToast();
              return;
            }
            setJevConfig(next);
            // JEV 总开关影响 skill 文案（含 JEV 主动助手节），保存后立即重同步
            // saveJevConfig 已同步写 localStorage，onVmSave 内 loadJevConfig 能读到最新值
            void onVmSave?.({ enabled: vmEnabledDraft, policy: effectivePolicy, cwd });
          }}
          onClose={() => setJevDialogOpen(false)}
        />
      </Stack>
    </Box>
  );

  function runSlashCommandShortcut(command: string): void {
    setMenuAnchorEl(null);
    setCommandMenuAnchorEl(null);
    onUserActivity?.();
    rememberComposerInput(command);
    void submitComposer(command, [], []);
  }

  function appendComposerText(value: string): void {
    setMenuAnchorEl(null);
    onUserActivity?.();
    setHistoryCursor(null);
    draftBeforeHistoryRef.current = "";
    setText((current) => current.trim().length === 0 ? value : `${current.trimEnd()} ${value}`);
  }

  function appendComposerMention(mention: ComposerMention): void {
    setMenuAnchorEl(null);
    onUserActivity?.();
    setHistoryCursor(null);
    draftBeforeHistoryRef.current = "";
    setMentions((current) => current.some((entry) => entry.path === mention.path) ? current : [...current, mention]);
    setText((current) => current.trim().length === 0 ? `${mention.token} ` : `${current.trimEnd()} ${mention.token} `);
  }

  function selectSkill(skill: SkillEntry): void {
    setSkillMenuAnchorEl(null);
    onUserActivity?.();
    setHistoryCursor(null);
    draftBeforeHistoryRef.current = "";
    const mention: ComposerMention = { name: skill.name, path: skill.path, token: `$${skill.name}`, kind: "skill" };
    setMentions((current) => current.some((entry) => entry.path === mention.path) ? current : [...current, mention]);
    setText((current) => {
      const replacement = `$${skill.name} `;
      return trailingSkillQuery(current) !== null
        ? current.replace(/(^|\s)\$[\w-]*$/, `$1${replacement}`)
        : current.trim().length === 0 ? replacement : `${current.trimEnd()} ${replacement}`;
    });
  }

  async function submitComposer(
    value: string,
    nextImages: ComposerImageAttachment[],
    nextMentions: ComposerMention[],
    submit: Props["onSend"] = onSend
  ): Promise<void> {
    if (isDuplicateSubmit(value, nextImages, nextMentions)) {
      // 去重但仍清空输入，避免用户以为没发出去而继续连击。
      setText("");
      setImages([]);
      setMentions([]);
      setHistoryCursor(null);
      draftBeforeHistoryRef.current = "";
      return;
    }
    await submitComposerWhenAccepted(
      () => submit(value, nextImages, nextMentions),
      () => {
        rememberComposerInput(value);
        setText("");
        setImages([]);
        setMentions([]);
        setHistoryCursor(null);
        draftBeforeHistoryRef.current = "";
      }
    );
  }

  function isDuplicateSubmit(value: string, nextImages: ComposerImageAttachment[], nextMentions: ComposerMention[]): boolean {
    const normalized = value.trim();
    if (!normalized && nextImages.length === 0) {
      return false;
    }
    const key = `${normalized}|img:${nextImages.length}|men:${nextMentions.map((entry) => entry.token ?? entry.path).join(",")}`;
    const now = Date.now();
    const last = lastSubmitRef.current;
    if (last && last.key === key && now - last.at < 1200) {
      return true;
    }
    lastSubmitRef.current = { key, at: now };
    return false;
  }

  function rememberComposerInput(value: string): void {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    setInputHistory((current) => {
      const withoutDuplicateTail = current[current.length - 1] === normalized ? current.slice(0, -1) : current;
      const next = [...withoutDuplicateTail, normalized].slice(-MAX_COMPOSER_HISTORY);
      saveComposerInputHistory(next);
      return next;
    });
  }

  function handleTextFieldKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const target = event.target as HTMLTextAreaElement | null;
    if (!target || target.tagName !== "TEXTAREA") {
      return;
    }
    if (event.key === "Tab" && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !running && onTogglePlanMode) {
      event.preventDefault();
      onTogglePlanMode();
      return;
    }
    if (event.key === "Escape" && running && onStop) {
      event.preventDefault();
      onStop();
      return;
    }
    const nativeEvent = event.nativeEvent as { isComposing?: boolean };
    if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !nativeEvent.isComposing) {
      if (!sendBlocked && hasContent) {
        event.preventDefault();
        onUserActivity?.();
        submitComposer(text, images, mentions);
      }
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const direction = event.key === "ArrowUp" ? -1 : 1;
    if (!shouldUseHistoryNavigation(target, direction, historyCursor !== null)) {
      return;
    }
    navigateComposerHistory(direction, target, event);
  }

  function navigateComposerHistory(direction: -1 | 1, target: HTMLTextAreaElement, event: KeyboardEvent<HTMLDivElement>): void {
    if (inputHistory.length === 0) {
      return;
    }
    if (direction === 1 && historyCursor === null) {
      return;
    }
    event.preventDefault();
    if (historyCursor === null) {
      draftBeforeHistoryRef.current = text;
    }
    const nextCursor =
      direction === -1
        ? historyCursor === null
          ? inputHistory.length - 1
          : Math.max(0, historyCursor - 1)
        : historyCursor === null
        ? null
        : historyCursor >= inputHistory.length - 1
        ? null
        : historyCursor + 1;
    const nextText = nextCursor === null ? draftBeforeHistoryRef.current : inputHistory[nextCursor] ?? "";
    setHistoryCursor(nextCursor);
    setText(nextText);
    setTimeout(() => {
      target.setSelectionRange(nextText.length, nextText.length);
    }, 0);
  }

  function setSlashTemplate(command: string): void {
    setMenuAnchorEl(null);
    setCommandMenuAnchorEl(null);
    onUserActivity?.();
    setHistoryCursor(null);
    draftBeforeHistoryRef.current = "";
    setText((current) => (current.trim().length === 0 || current.trim().startsWith("/") ? command : `${current.trimEnd()}\n${command}`));
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLDivElement>): void {
    if (disabled) {
      return;
    }
    const pastedText = event.clipboardData.getData("text/plain").trim();
    if (isRelayShareText(pastedText)) {
      event.preventDefault();
      setText("");
      setImages((current) => {
        current.forEach(revokeAttachmentPreview);
        return [];
      });
      setMentions([]);
      onRelayShareDetected?.(pastedText);
      return;
    }
    const pastedImages = clipboardImageFiles(event.clipboardData);
    if (pastedImages.length === 0) {
      return;
    }
    event.preventDefault();
    void addAttachments(pastedImages);
  }

  async function addAttachments(fileList: FileList | File[] | null): Promise<void> {
    if (!fileList) {
      return;
    }
    const files = Array.from(fileList);
    const rejected: string[] = [];
    const accepted: File[] = [];
    let nextImageTotalBytes = images
      .filter((image) => image.kind === "image")
      .reduce((total, image) => total + image.size, 0);

    for (const file of files) {
      if (!isSupportedAttachmentFile(file)) {
        rejected.push(`${file.name || "file"}: unsupported file type`);
        continue;
      }
      const isImage = isSupportedImageFile(file);
      if (isImage) {
        if (file.size > MAX_COMPOSER_IMAGE_BYTES) {
          rejected.push(`${file.name || "file"}: ${formatBytes(file.size)} exceeds ${formatBytes(MAX_COMPOSER_IMAGE_BYTES)}`);
          continue;
        }
        if (nextImageTotalBytes + file.size > MAX_COMPOSER_IMAGE_TOTAL_BYTES) {
          rejected.push(`${file.name || "file"}: selected images would exceed ${formatBytes(MAX_COMPOSER_IMAGE_TOTAL_BYTES)}`);
          continue;
        }
        nextImageTotalBytes += file.size;
      }
      accepted.push(file);
    }

    const settled = await Promise.allSettled(accepted.map((file) => readAttachmentFile(file, sessionToken, cwd)));
    const next: ComposerImageAttachment[] = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        next.push(result.value);
        return;
      }
      rejected.push(`${accepted[index]?.name || "file"}: ${attachmentErrorMessage(result.reason)}`);
    });
    if (rejected.length > 0) {
      setImageError(rejected.slice(0, 3).join("; ") + (rejected.length > 3 ? `; +${rejected.length - 3} more` : ""));
    } else {
      setImageError("");
    }
    if (next.length > 0) {
      onUserActivity?.();
    }
    setImages((current) => [...current, ...next]);
  }

  function addWorkspaceMention(drop: { name: string; path: string; kind: "file" | "image" }): void {
    setImageError("");
    setHistoryCursor(null);
    draftBeforeHistoryRef.current = "";
    onUserActivity?.();
    setMentions((current) => {
      const existing = current.some((entry) => isWorkspacePathMention(entry) && entry.path === drop.path);
      return existing
        ? current
        : [...current, { name: drop.name, path: drop.path, token: drop.path, kind: drop.kind }];
    });
    setText((current) => {
      if (current.includes(drop.path)) {
        return current;
      }
      const trimmed = current.trimEnd();
      return trimmed.length === 0 ? drop.path + " " : trimmed + "\\n" + drop.path + " ";
    });
  }

  function removeWorkspaceMention(mention: ComposerMention): void {
    setMentions((current) => current.filter((entry) => entry.path !== mention.path));
    setText((current) => removeMentionToken(current, mention.token));
    setHistoryCursor(null);
    draftBeforeHistoryRef.current = "";
  }
}

function ComposerWorkingIndicator({ status, t }: { status: ComposerWorkingStatus; t: TranslateFn }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const start = () => {
      window.clearInterval(timer);
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      setNow(Date.now());
      timer = window.setInterval(() => setNow(Date.now()), 1_000);
    };
    const stop = () => window.clearInterval(timer);
    const onVisibilityChange = () => document.visibilityState === "visible" ? start() : stop();
    start();
    window.addEventListener("focus", start);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      window.removeEventListener("focus", start);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const elapsed = formatElapsed(now - status.startedAt);
  const terminalSegment = status.backgroundTerminalCount > 0
    ? t("chat.working.backgroundTerminals", { count: status.backgroundTerminalCount })
    : "";
  const taskLabel = status.retrying?.message ?? status.activityLabel ?? "Thinking...";
  const visibleTaskLabel = truncateWorkingLabel(taskLabel, 15);
  const label = `${visibleTaskLabel} · ${elapsed}`;
  const fullLabel = `${taskLabel} · ${elapsed}`;
  const tokenSegment = `input ${status.inputTokens} · output ${status.outputTokens}`;
  const fullTooltip = [fullLabel, status.retrying?.details, tokenSegment, terminalSegment, t("chat.working.stopHint")].filter(Boolean).join(" · ");

  return (
    <Tooltip title={fullTooltip} arrow placement="top">
      <Stack
        data-testid="composer-working-indicator"
        role="status"
        aria-live="polite"
        aria-label={fullLabel}
        direction="row"
        spacing={0.65}
        alignItems="center"
        sx={{
          minWidth: 0,
          height: 28,
          px: 0.75,
          borderRadius: 999,
          color: "text.secondary",
          bgcolor: (theme) => alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.045 : 0.035)
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            bgcolor: "primary.main",
            boxShadow: (theme) => `0 0 0 0 ${alpha(theme.palette.primary.main, 0.34)}`,
            animation: "composerWorkingPulse 1400ms ease-in-out infinite",
            "@keyframes composerWorkingPulse": {
              "0%": { transform: "scale(0.88)", opacity: 0.7, boxShadow: (theme) => `0 0 0 0 ${alpha(theme.palette.primary.main, 0.3)}` },
              "55%": { transform: "scale(1.12)", opacity: 1, boxShadow: (theme) => `0 0 0 6px ${alpha(theme.palette.primary.main, 0)}` },
              "100%": { transform: "scale(0.88)", opacity: 0.7, boxShadow: (theme) => `0 0 0 0 ${alpha(theme.palette.primary.main, 0)}` }
            }
          }}
        />
        <Typography variant="caption" sx={{ fontWeight: 760, color: "text.secondary", whiteSpace: "nowrap", lineHeight: 1 }}>
          {label}
        </Typography>
        <Stack direction="row" spacing={0.25} alignItems="center" sx={{ color: "text.secondary", flex: "0 0 auto" }}>
          <ArrowUpwardIcon data-testid="working-input-tokens-icon" sx={{ fontSize: 13 }} />
          <Typography variant="caption" sx={{ fontWeight: 750, lineHeight: 1 }}>
            {formatCompactTokenCount(status.inputTokens)}
          </Typography>
          <ArrowDownwardIcon data-testid="working-output-tokens-icon" sx={{ fontSize: 13, ml: 0.25 }} />
          <Typography variant="caption" sx={{ fontWeight: 750, lineHeight: 1 }}>
            {formatCompactTokenCount(status.outputTokens)}
          </Typography>
        </Stack>
        {terminalSegment && <Typography
          variant="caption"
          sx={{ maxWidth: { xs: 74, sm: 190 }, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "text.disabled", lineHeight: 1 }}
        >
          {terminalSegment}
        </Typography>}
      </Stack>
    </Tooltip>
  );
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatCompactTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return String(Math.max(0, value));
}

function ComposerMenuItem({
  icon,
  label,
  detail,
  disabled,
  onClick,
  testId
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  disabled: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <MenuItem data-testid={testId} disabled={disabled} onClick={onClick} sx={{ borderRadius: 2, minHeight: 44 }}>
      <Box sx={{ mr: 1.75, width: 20, height: 20, display: "grid", placeItems: "center", color: "text.secondary", flex: "0 0 auto" }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 650 }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {detail}
        </Typography>
      </Box>
    </MenuItem>
  );
}

async function readAttachmentFile(file: File, sessionToken: string | null | undefined, cwd: string): Promise<ComposerImageAttachment> {
  if (isSupportedImageFile(file)) {
    return readImageFile(file, sessionToken, cwd);
  }
  const localPath = getLocalFilePath(file);
  if (localPath) {
    return {
      id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${file.name}-${Date.now()}-${Math.random()}`,
      name: file.name,
      url: localPath,
      path: localPath,
      size: 0,
      mediaType: fileMediaType(file),
      kind: "file"
    };
  }
  const uploaded = sessionToken ? await uploadAttachmentFile(file, sessionToken, cwd) : null;
  return {
    id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${file.name}-${Date.now()}-${Math.random()}`,
    name: file.name,
    url: uploaded?.path ?? "",
    path: uploaded?.path,
    size: file.size,
    mediaType: uploaded?.mediaType ?? fileMediaType(file),
    kind: "file"
  };
}

/**
 * Renderer-only preview URL lifecycle (SQLite OOM fix).
 *
 * Thumbnails used to be `data:...;base64` URLs stored in `attachment.url`,
 * so every screenshot/paste carried full bitmap bytes into turn/start and
 * from there into persisted history/SQLite (SQLITE_NOMEM). Previews are now
 * cheap `blob:` object URLs: no base64 is ever allocated, and revoking them
 * on remove/clear frees the backing blob. If you see a broken composer
 * thumbnail, check that the preview URL was created here and not revoked
 * early; if the model stops receiving images, check `path` (disk path from
 * /api/attachments/upload) and composerInputToUserInput instead — preview
 * URLs are never sent.
 */
function revokeAttachmentPreview(image: ComposerImageAttachment): void {
  const preview = image.previewUrl;
  if (preview && preview.startsWith("blob:") && typeof URL.revokeObjectURL === "function") {
    try {
      URL.revokeObjectURL(preview);
    } catch {
      // Revoking twice (remove + clear) is harmless.
    }
  }
}

async function readImageFile(file: File, sessionToken?: string | null, cwd = ""): Promise<ComposerImageAttachment> {
  const mediaType = imageMediaType(file);
  // Disk first (OOM fix): screenshots/pastes are uploaded to the server
  // attachments dir and only the returned disk `path` is sent/stored.
  // Giving the model base64 still happens, but transiently at send time on
  // the server (path -> bytes -> model payload); nothing with bitmap bytes
  // is persisted. Without a session there is no upload endpoint, so fall
  // back to a preview-only blob URL and leave `path` empty — the sender
  // (composerInputToUserInput) then emits a placeholder instead of base64,
  // and the server bridges sanitize any stray data: URL the same way.
  const uploaded = sessionToken ? await uploadAttachmentFile(file, sessionToken, cwd) : null;
  const previewUrl = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
  return {
    id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${file.name}-${Date.now()}-${Math.random()}`,
    name: file.name,
    url: previewUrl || uploaded?.path || "",
    previewUrl: previewUrl || undefined,
    path: uploaded?.path,
    size: file.size,
    mediaType,
    kind: "image"
  };
}

async function uploadAttachmentFile(file: File, sessionToken: string, cwd: string): Promise<{ path: string; mediaType: string; size: number } | null> {
  const form = new FormData();
  form.set("file", file);
  form.set("cwd", cwd);
  const response = await fetch("/api/attachments/upload", {
    method: "POST",
    headers: {
      "x-codex-ui-token": sessionToken
    },
    body: form
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Attachment upload failed (${response.status})`);
  }
  const body = await response.json() as { path?: string; mediaType?: string; size?: number };
  if (!body.path) {
    throw new Error("Attachment upload failed: missing saved path");
  }
  return {
    path: body.path,
    mediaType: body.mediaType ?? fileMediaType(file),
    size: body.size ?? file.size
  };
}

function hasSupportedDropData(dataTransfer: DataTransfer): boolean {
  if (readWorkspaceDragData(dataTransfer)) {
    return true;
  }
  if (dataTransfer.items.length > 0) {
    return Array.from(dataTransfer.items).some((item) => item.kind === "file");
  }
  return Array.from(dataTransfer.files).some(isSupportedAttachmentFile);
}

function MobileContextRingButton({ usage }: { usage?: { usedTokens: number; contextWindow: number | null } | null }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const { contextWindow: limit, usedTokens: used, ratio, percentage } = contextUsageMetrics(usage);
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const color = ratio >= 0.9 ? "error.main" : ratio >= 0.75 ? "warning.main" : "primary.main";
  const label = limit ? `${formatCompactTokens(used)} / ${formatCompactTokens(limit)}` : `${formatCompactTokens(used)} / ?`;
  const detail = limit
    ? `${formatCompactTokens(used)} / ${formatCompactTokens(limit)}${percentage != null ? ` · ${percentage}%` : ""}`
    : `${formatCompactTokens(used)} / unknown limit`;
  return (
    <>
      <IconButton
        size="small"
        data-testid="composer-mobile-context-button"
        aria-label={`Context usage ${detail}`}
        aria-haspopup="dialog"
        aria-expanded={anchorEl ? "true" : undefined}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{
          width: 32,
          height: 32,
          flex: "0 0 32px",
          border: "1px solid",
          borderColor: "divider",
          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94),
          boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)"
        }}
      >
        <Box component="svg" viewBox="0 0 20 20" sx={{ width: 20, height: 20, transform: "rotate(-90deg)" }} aria-hidden>
          <Box component="circle" cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" sx={{ color: "action.disabledBackground" }} />
          <Box component="circle" cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} sx={{ color }} />
        </Box>
      </IconButton>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 1.5, borderRadius: 2, minWidth: 220, maxWidth: "calc(100vw - 48px)" } } }}
      >
        <Stack data-testid="composer-mobile-context-popover" spacing={0.5}>
          <Typography variant="body2" sx={{ fontWeight: 800 }}>上下文用量</Typography>
          <Typography variant="caption" color="text.secondary">已用 {formatCompactTokens(used)} tokens</Typography>
          <Typography variant="caption" color="text.secondary">窗口 {limit ? `${formatCompactTokens(limit)} tokens` : "unknown"}</Typography>
          {percentage != null && <Typography variant="caption" color="text.secondary">占比 {percentage}%</Typography>}
          <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>{`Context ${label}${percentage != null ? ` (${percentage}%)` : ""}`}</Typography>
        </Stack>
      </Popover>
    </>
  );
}

function MobileGitBranchButton({ branch, dirtyCount = 0, onOpen }: { branch?: string | null; dirtyCount?: number; onOpen?: () => void }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  if (!branch) return null;
  const detail = dirtyCount > 0 ? `${branch} · ${dirtyCount} changed` : branch;
  return (
    <>
      <span style={{ position: "relative", display: "inline-flex", flex: "0 0 32px" }}>
        <IconButton
          size="small"
          data-testid="composer-mobile-git-button"
          aria-label={`Git branch ${detail}`}
          aria-haspopup="dialog"
          aria-expanded={anchorEl ? "true" : undefined}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{
            width: 32,
            height: 32,
            flex: "0 0 32px",
            border: "1px solid",
            borderColor: "divider",
            color: "text.secondary",
            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94),
            boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)"
          }}
        >
          <CallSplitIcon fontSize="small" />
        </IconButton>
        {dirtyCount > 0 && (
          <Box
            data-testid="composer-mobile-git-dirty-dot"
            aria-hidden
            sx={{ position: "absolute", top: 2, right: 2, width: 8, height: 8, borderRadius: "50%", bgcolor: "warning.main", border: "2px solid", borderColor: "background.paper", pointerEvents: "none" }}
          />
        )}
      </span>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 1.5, borderRadius: 2, minWidth: 220, maxWidth: "calc(100vw - 48px)" } } }}
      >
        <Stack data-testid="composer-mobile-git-popover" spacing={0.75}>
          <Typography variant="body2" sx={{ fontWeight: 800 }}>Git 分支</Typography>
          <Typography variant="body2" noWrap title={branch}>{branch}</Typography>
          <Typography variant="caption" color="text.secondary">{dirtyCount > 0 ? `${dirtyCount} 个未提交变更` : "工作区干净"}</Typography>
          {onOpen && (
            <Button size="small" variant="outlined" onClick={() => { setAnchorEl(null); onOpen(); }}>
              打开 Git 面板
            </Button>
          )}
        </Stack>
      </Popover>
    </>
  );
}

function GitBranchIndicator({ branch, dirtyCount = 0, onOpen }: { branch?: string | null; dirtyCount?: number; onOpen?: () => void }) {
  if (!branch) return null;
  const label = dirtyCount > 0 ? `${branch} · ${dirtyCount}` : branch;
  return (
    <Tooltip title={dirtyCount > 0 ? `Git: ${branch} · ${dirtyCount} changed — open Git panel` : `Git: ${branch} — open Git panel`}>
      <Stack
        data-testid="composer-git-branch-chip"
        direction="row"
        spacing={0.5}
        alignItems="center"
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={dirtyCount > 0 ? `Git branch ${branch}, ${dirtyCount} changed` : `Git branch ${branch}`}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (onOpen && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onOpen();
          }
        }}
        sx={{
          flex: "0 0 auto",
          height: 30,
          px: 0.75,
          maxWidth: 180,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 999,
          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94),
          cursor: onOpen ? "pointer" : "default",
          overflow: "hidden"
        }}
      >
        <CallSplitIcon sx={{ fontSize: 16, color: "text.secondary", flex: "0 0 auto" }} />
        <Typography variant="caption" sx={{ display: { xs: "none", sm: "block" }, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</Typography>
        {dirtyCount > 0 && <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "warning.main", flex: "0 0 auto" }} />}
      </Stack>
    </Tooltip>
  );
}

function ContextUsageIndicator({ usage }: { usage?: { usedTokens: number; contextWindow: number | null } | null }) {
  const { contextWindow: limit, usedTokens: used, ratio, percentage } = contextUsageMetrics(usage);
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const color = ratio >= 0.9 ? "error.main" : ratio >= 0.75 ? "warning.main" : "primary.main";
  const label = limit ? `${formatCompactTokens(used)} / ${formatCompactTokens(limit)}` : `${formatCompactTokens(used)} / ?`;
  return (
    <Tooltip title={`Context ${label}${percentage != null ? ` (${percentage}%)` : ""}`}>
      <Stack data-testid="composer-context-usage" direction="row" spacing={0.5} alignItems="center" sx={{ flex: "0 0 auto", height: 30, px: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 999, bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94) }}>
        <Box component="svg" viewBox="0 0 20 20" sx={{ width: 20, height: 20, transform: "rotate(-90deg)" }} aria-hidden>
          <Box component="circle" cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" sx={{ color: "action.disabledBackground" }} />
          <Box component="circle" cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} sx={{ color }} />
        </Box>
        <Typography variant="caption" sx={{ display: { xs: "none", sm: "block" }, fontWeight: 800, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{label}</Typography>
      </Stack>
    </Tooltip>
  );
}

function CompactContextStatusIndicator({
  usage,
  running,
  statusKind,
  statusLabel
}: {
  usage?: { usedTokens: number; contextWindow: number | null } | null;
  running: boolean;
  statusKind?: string;
  statusLabel: string;
}) {
  const { contextWindow: limit, usedTokens: used, ratio, percentage } = contextUsageMetrics(usage);
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const ringColor = ratio >= 0.9 ? "error.main" : ratio >= 0.75 ? "warning.main" : "primary.main";
  const dotColor = running
    ? "primary.main"
    : statusKind === "connecting"
      ? "primary.main"
      : statusKind === "retrying"
      ? "warning.main"
      : statusKind === "disconnect" || statusKind === "engine-error"
        ? "error.main"
        : statusKind === "idle"
          ? "success.main"
          : "text.disabled";
  const contextLabel = limit
    ? `${formatCompactTokens(used)} / ${formatCompactTokens(limit)} · ${percentage}%`
    : `${formatCompactTokens(used)} / unknown limit`;
  const fullLabel = `${statusLabel} · Context ${contextLabel}`;

  return (
    <Tooltip
      arrow
      placement="top-end"
      title={
        <Stack spacing={0.2}>
          <Typography variant="caption" sx={{ fontWeight: 850 }}>{statusLabel}</Typography>
          <Typography variant="caption">Context used: {formatCompactTokens(used)} tokens</Typography>
          <Typography variant="caption">Context window: {limit ? `${formatCompactTokens(limit)} tokens` : "unknown"}</Typography>
          {percentage != null && <Typography variant="caption">Usage: {percentage}%</Typography>}
        </Stack>
      }
    >
      <Box
        data-testid="compact-composer-status-dot"
        data-context-percentage={percentage ?? "unknown"}
        role="status"
        aria-label={fullLabel}
        sx={{
          position: "absolute", right: 46, top: -10, zIndex: 3,
          width: 22, height: 22, borderRadius: "50%",
          display: "grid", placeItems: "center",
          bgcolor: "background.paper",
          boxShadow: (theme) => `0 2px 8px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.34 : 0.16)}`,
          cursor: "help"
        }}
      >
        <Box component="svg" viewBox="0 0 20 20" aria-hidden sx={{ position: "absolute", inset: 1, width: 20, height: 20, transform: "rotate(-90deg)" }}>
          <Box component="circle" cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2.25" sx={{ color: "action.disabledBackground" }} />
          {limit && (
            <Box component="circle" cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} sx={{ color: ringColor }} />
          )}
        </Box>
        <Box
          aria-hidden
          sx={{
            position: "relative", width: 6, height: 6, borderRadius: "50%",
            bgcolor: dotColor,
            color: dotColor,
            animation: running || statusKind === "connecting" || statusKind === "retrying" ? "compact-context-status-pulse 1.8s ease-out infinite" : "none",
            "@keyframes compact-context-status-pulse": {
              "0%": { boxShadow: "0 0 0 0 currentColor" },
              "70%": { boxShadow: "0 0 0 4px transparent" },
              "100%": { boxShadow: "0 0 0 0 transparent" }
            },
            "@media (prefers-reduced-motion: reduce)": { animation: "none" }
          }}
        />
      </Box>
    </Tooltip>
  );
}

function truncateWorkingLabel(value: string, maxLength: number): string {
  const characters = Array.from(value.trim());
  return characters.length > maxLength ? `${characters.slice(0, maxLength).join("")}...` : characters.join("");
}

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

function clipboardImageFiles(dataTransfer: DataTransfer): File[] {
  const itemFiles = Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const files = itemFiles.length > 0 ? itemFiles : Array.from(dataTransfer.files).filter(isSupportedImageFile);
  return files.map((file, index) => ensureClipboardImageName(file, index));
}

function ensureClipboardImageName(file: File, index: number): File {
  if (file.name.trim().length > 0) {
    return file;
  }
  const extension = clipboardImageExtension(file.type);
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const suffix = index > 0 ? `-${index + 1}` : "";
  return new File([file], `screenshot-${timestamp}${suffix}.${extension}`, {
    type: file.type || `image/${extension}`,
    lastModified: file.lastModified || Date.now()
  });
}

function clipboardImageExtension(mediaType: string): string {
  switch (mediaType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
}

function isWorkspacePathMention(mention: ComposerMention): boolean {
  return (mention.kind === "file" || mention.kind === "image") && mention.token === mention.path;
}

function removeMentionToken(text: string, token: string): string {
  const escaped = escapeRegExp(token);
  return text
    .replace(new RegExp("(^|\\n)" + escaped + "(?=\\s|$)", "g"), "$1")
    .replace(new RegExp("\\s+" + escaped + "(?=\\s|$)", "g"), " ")
    .replace(/\n{3,}/g, "\n\n");
}

function escapeRegExp(value: string): string {
  const specialCharacters = "\\^$.*+?()[]{}|";
  return Array.from(value, (character) => specialCharacters.includes(character) ? "\\" + character : character).join("");
}

export function isSupportedAttachmentFile(_file: File): boolean {
  return true;
}

export function getLocalFilePath(file: File): string | undefined {
  const desktopPath = typeof window !== "undefined" ? window.codexUltraDesktop?.getPathForFile?.(file) : undefined;
  if (desktopPath) return desktopPath;
  const directPath = (file as File & { path?: unknown }).path;
  if (typeof directPath === "string" && isAbsoluteFilePath(directPath)) return directPath;
  return undefined;
}

function isAbsoluteFilePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\");
}

function isSupportedImageFile(file: File): boolean {
  return file.type.startsWith("image/") || SUPPORTED_IMAGE_EXTENSIONS.has(fileExtension(file.name));
}

function imageMediaType(file: File): string {
  if (file.type.startsWith("image/")) {
    return file.type;
  }
  const extension = fileExtension(file.name);
  if (extension === "jpg") {
    return "image/jpeg";
  }
  if (SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    return `image/${extension}`;
  }
  return "image/*";
}

function fileMediaType(file: File): string {
  if (file.type) {
    return file.type;
  }
  switch (fileExtension(file.name)) {
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "csv":
      return "text/csv";
    case "md":
      return "text/markdown";
    case "json":
      return "application/json";
    case "txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function fileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function attachmentErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "attachment upload failed";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function safeThemeAssetUrl(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /["'()\\]/.test(trimmed)) {
    return undefined;
  }
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://") || trimmed.startsWith("blob:") || trimmed.startsWith("data:image/")) {
    return trimmed;
  }
  return undefined;
}

function loadComposerInputHistory(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMPOSER_HISTORY_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(-MAX_COMPOSER_HISTORY);
  } catch {
    return [];
  }
}

function saveComposerInputHistory(history: string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(COMPOSER_HISTORY_STORAGE_KEY, JSON.stringify(history.slice(-MAX_COMPOSER_HISTORY)));
  } catch {
    // Ignore storage quota/private-mode failures; in-memory history still works for this session.
  }
}

function shouldUseHistoryNavigation(textarea: HTMLTextAreaElement, direction: -1 | 1, browsingHistory: boolean): boolean {
  if (browsingHistory) {
    return true;
  }
  const selectionStart = textarea.selectionStart ?? 0;
  const selectionEnd = textarea.selectionEnd ?? selectionStart;
  if (selectionStart !== selectionEnd) {
    return false;
  }
  const value = textarea.value;
  if (direction === -1) {
    return !value.slice(0, selectionStart).includes("\n");
  }
  return !value.slice(selectionStart).includes("\n");
}
