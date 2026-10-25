import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, Divider, IconButton, LinearProgress, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { DesktopRuntimeInfo, EngineStatus, JsonValue } from "@codex-ui/shared";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AssessmentIcon from "@mui/icons-material/Assessment";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import BoltIcon from "@mui/icons-material/Bolt";
import ChecklistIcon from "@mui/icons-material/Checklist";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import FlagIcon from "@mui/icons-material/Flag";
import ForumIcon from "@mui/icons-material/Forum";
import GridViewIcon from "@mui/icons-material/GridView";
import KeyIcon from "@mui/icons-material/Key";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import MemoryIcon from "@mui/icons-material/Memory";
import ImageIcon from "@mui/icons-material/Image";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import RefreshIcon from "@mui/icons-material/Refresh";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import { DiscordIcon } from "./icons/DiscordIcon";
import type { PendingServerRequest, ThreadEntry, WorkbenchItem, WorkbenchTurn } from "../state/codexClient";
import { isRunningTurnStatus } from "../app/transcripts/topicRuntimeIndex";
import { orderWorkbenchTurns } from "../state/workbenchTimeline";
import { themeVisualTuning, type ThemePlugin } from "../theme";
import { ChatWaterfall } from "../waterfall/ChatWaterfall";
import { AgentOverviewGrid } from "../waterfall/AgentOverviewGrid";
import { applyWaterfallDisplayMode, buildChatRows, buildIncrementalChatRows, createIncrementalChatRowsCache, selectTurnsForWaterfallMode, type WaterfallDisplayMode } from "../waterfall/chatRows";
import { createStableChatRowsCache, stableChatRows } from "../waterfall/stableChatRows";
import { mergePendingRows, pendingAppendRows } from "../waterfall/pendingRows";
import type { PendingAppendMessage } from "../waterfall/pendingRows";
export type { PendingAppendMessage };
import {
  ALL_AGENTS_PAGE,
  MAIN_AGENT_PAGE,
  agentVirtualPageKey,
  buildAllAgentOverviewRows,
  selectAgentRailSessions,
  summarizeAgentStatuses,
  type AgentVirtualPage,
} from "../waterfall/agentPages";
import { TaskPlanPanel } from "../waterfall/TaskPlanPanel";
import { latestTaskPlan } from "../waterfall/taskPlan";
import type { AssistantUsageDisplayMode, ChatWaterfallRow, CompactionSourceDetail } from "../waterfall/types";
import type { WebPreviewMode, WebPreviewState } from "../webPreview";
import type { TranslateFn } from "../i18n";
import type { SettingsSectionId } from "../settings/SettingsDrawer";
import type { ChatTypographyPreference } from "../chatTypography";
import {
  buildServerRequestDecisionResponse,
  isApprovalServerRequest,
  isUserInputServerRequest
} from "../serverRequests";
import { useAgentTranscriptOverview, useTopicTranscript, type TopicTranscriptStore } from "../app/transcripts/topicTranscriptStore";
import { useTopicUsage, type TopicUsageStore } from "../app/usage/topicUsageStore";
import { codexCliRecoveryNotice } from "../codexCliRecovery";

type OnboardingSectionId = Extract<SettingsSectionId, "relay" | "members">;

type AgentSession = {
  id: string;
  threadId?: string;
  name: string;
  role?: string;
  status?: string;
  source: "thread" | "collab" | "activity" | "message";
  loaded: boolean;
};

export type GoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

export type GoalBannerState = {
  threadId: string;
  objective: string;
  status: GoalStatus;
  tokenBudget?: number | null;
  tokensUsed?: number;
  timeUsedSeconds?: number;
};

export type TokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  estimatedCostUsd?: number;
  /** Thread cumulative cost captured with this turn update. */
  totalEstimatedCostUsd?: number;
  billingSnapshot?: TokenUsageBillingSnapshot;
  costBreakdownUsd?: {
    input: number;
    cachedInput: number;
    cacheWrite: number;
    output: number;
  };
};

export type ThreadTokenUsageState = {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  /** Raw last-token usage from Codex; unlike `last`, this is not normalized for billing deltas. */
  contextUsage?: TokenUsageBreakdown;
  modelContextWindow?: number | null;
};

export type WorkbenchStatsState = {
  scope: "status" | "stats";
  activeThreadId: string | null;
  model: string;
  provider: string;
  reasoningEffort: string;
  permissionLabel: string;
  sessionTurns: number;
  sessionItems: number;
  projectThreads: number;
  projectTurns: number;
  threadUsage?: ThreadTokenUsageState;
  lastTurnUsage?: TokenUsageBreakdown;
  projectUsage?: TokenUsageBreakdown;
  goal?: GoalBannerState | null;
  modes: WorkbenchModeState;
};

export type RequestMonitorEntry = {
  id: string;
  threadId: string;
  title: string;
  source: string;
  status: string;
  provider: string;
  model: string;
  lastTokens?: TokenUsageBreakdown;
  totalTokens?: TokenUsageBreakdown;
};

export type WorkbenchModeState = {
  fast: boolean;
  plan: boolean;
  goalActive: boolean;
};

export type SlashCommandNoticeState = {
  title: string;
  message: string;
  severity: "info" | "success" | "warning";
};

export type ThreadLoadProgress = {
  threadId: string;
  title: string;
  label: string;
  progress: number;
};

type Props = {
  turns: WorkbenchTurn[];
  turnsByThreadId?: Map<string, WorkbenchTurn[]>;
  turnTokenUsage?: Record<string, TokenUsageBreakdown>;
  requestTokenUsage?: Record<string, Record<string, TokenUsageBreakdown>>;
  compactionSourceByTurnId?: Record<string, CompactionSourceDetail>;
  threads?: ThreadEntry[];
  transcriptStore: TopicTranscriptStore;
  usageStore: TopicUsageStore;
  activeThreadId: string | null;
  errors: string[];
  pendingRequests?: PendingServerRequest[];
  goal?: GoalBannerState | null;
  slashNotice?: SlashCommandNoticeState | null;
  stats?: WorkbenchStatsState | null;
  requestMonitor?: RequestMonitorEntry[];
  statsOpen?: boolean;
  modes?: WorkbenchModeState;
  activeThemePlugin?: ThemePlugin | null;
  welcomeBackgroundImage?: string;
  welcomeDismissed?: boolean;
  assistantUsageDisplay?: AssistantUsageDisplayMode;
  chatTypography?: ChatTypographyPreference;
  waterfallDisplayMode?: WaterfallDisplayMode;
  pendingAppends?: PendingAppendMessage[];
  threadLoadProgress?: ThreadLoadProgress | null;
  desktopRuntime?: DesktopRuntimeInfo;
  engineStatus?: EngineStatus;
  sessionToken?: string | null;
  hasConfiguredRelays?: boolean;
  t: TranslateFn;
  onPromptSelect?: (text: string) => void;
  onContinueConversation?: () => void;
  onCreateConversation?: () => void;
  onOpenOnboardingSection?: (section: OnboardingSectionId) => void;
  onOpenOfficialLogin?: () => void;
  onOpenDiscord?: () => void;
  onSyncFreeModels?: () => Promise<void>;
  onAgentThreadSelect?: (threadId: string) => void;
  onStatsClose?: () => void;
  onSlashNoticeClose?: () => void;
  onAnswerServerRequest?: (id: string | number, result: JsonValue) => void;
  onGoalEdit?: () => void;
  onGoalStatusChange?: (status: GoalStatus) => void;
  onGoalClear?: () => void;
  onGoalCancel?: () => void;
  onEditUserMessage?: (threadId: string, turnId: string, text: string) => void | Promise<void>;
  onDeletePendingMessage?: (id: string) => boolean;
  onOpenCommandBlacklistSettings?: (providerId?: string, groupId?: string) => void;
  webPreview?: WebPreviewState | null;
  onOpenPreview?: (url: string, mode: WebPreviewMode) => void;
  onClosePreview?: () => void;
  onTranscriptRendered?: (threadId: string) => void;
  onLoadOlderHistory?: (threadId: string) => Promise<void>;
  hasOlderHistory?: boolean;
  loadingOlderHistory?: boolean;
  initialScrollTop?: number;
  interactive?: boolean;
  suspended?: boolean;
  mobileLayout?: boolean;
};

export type TokenUsageBillingSnapshot = {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  outputUsdPerMillion: number;
  modelMultiplier: number;
  inputMultiplier: number;
  cacheReadMultiplier: number;
  cacheWriteMultiplier: number;
  outputMultiplier: number;
  groupRatio: number;
};

function ThreadLoadingPlaceholder({ progress }: { progress: ThreadLoadProgress }) {
  return (
    <Paper
      variant="outlined"
      data-testid="thread-loading-placeholder"
      sx={{
        maxWidth: 640,
        mx: "auto",
        mt: "min(18vh, 160px)",
        p: 2,
        borderRadius: 1,
        bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.74 : 0.9),
        borderColor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.26 : 0.18)
      }}
    >
      <Stack spacing={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 850 }} noWrap>
          {progress.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {progress.label}
        </Typography>
        <LinearProgress variant="determinate" value={progress.progress} sx={{ height: 6, borderRadius: 1 }} />
      </Stack>
    </Paper>
  );
}

function ChatPanelImpl({
  turns,
  turnsByThreadId: sharedTurnsByThreadId,
  turnTokenUsage = {},
  requestTokenUsage = {},
  compactionSourceByTurnId = {},
  threads = [],
  transcriptStore,
  usageStore,
  activeThreadId,
  errors,
  pendingRequests = [],
  goal,
  slashNotice,
  stats,
  requestMonitor = [],
  statsOpen = false,
  modes = { fast: false, plan: false, goalActive: false },
  activeThemePlugin,
  welcomeBackgroundImage,
  welcomeDismissed = false,
  assistantUsageDisplay = "summary",
  chatTypography,
  waterfallDisplayMode = "recent-tools",
  pendingAppends = [],
  threadLoadProgress,
  desktopRuntime,
  engineStatus,
  sessionToken,
  hasConfiguredRelays = true,
  t,
  onPromptSelect,
  onContinueConversation,
  onCreateConversation,
  onOpenOnboardingSection,
  onOpenOfficialLogin,
  onOpenDiscord,
  onSyncFreeModels,
  onAgentThreadSelect,
  onStatsClose,
  onSlashNoticeClose,
  onAnswerServerRequest,
  onGoalEdit,
  onGoalStatusChange,
  onGoalClear,
  onGoalCancel,
  onEditUserMessage,
  onDeletePendingMessage,
  onOpenCommandBlacklistSettings,
  onOpenPreview,
  webPreview,
  onClosePreview,
  onTranscriptRendered,
  onLoadOlderHistory,
  hasOlderHistory = false,
  loadingOlderHistory = false,
  initialScrollTop,
  interactive = true,
  mobileLayout = false
}: Props) {
  const [agentPage, setAgentPage] = useState<AgentVirtualPage>(MAIN_AGENT_PAGE);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const reportedTranscriptLoadRef = useRef<string | null>(null);
  const agentSessionCacheRef = useRef<{ threadId: string | null; sessions: Map<string, AgentSession> }>({ threadId: null, sessions: new Map() });
  const rowCachesRef = useRef(new Map<string, { stable: ReturnType<typeof createStableChatRowsCache>; incremental: ReturnType<typeof createIncrementalChatRowsCache> }>());
  const visibleTurnTokenUsageRef = useRef<Record<string, TokenUsageBreakdown>>({});
  const pageScrollPositionsRef = useRef(new Map<string, number>());
  const handleScrollActivity = useCallback(() => undefined, []);

  useEffect(() => {
    setAgentPage(MAIN_AGENT_PAGE);
    pageScrollPositionsRef.current.clear();
    reportedTranscriptLoadRef.current = null;
  }, [activeThreadId]);

  const localTurnsByThreadId = useMemo(() => {
    if (sharedTurnsByThreadId) return sharedTurnsByThreadId;
    const index = new Map<string, WorkbenchTurn[]>();
    for (const turn of turns) {
      const bucket = index.get(turn.threadId);
      if (bucket) bucket.push(turn); else index.set(turn.threadId, [turn]);
    }
    return index;
  }, [sharedTurnsByThreadId, turns]);
  const turnsByThreadId = localTurnsByThreadId;
  // P1 memo-chain stabilization: reuse the previous Map (and per-thread buckets)
  // when nothing actually changed, so background subagent streaming on other
  // threads no longer invalidates the active thread's whole memo cascade.
  const stableTurnsByThreadId = useStableTurnsByThreadId(turnsByThreadId);
  const activeThreadTurns = useMemo(() => activeThreadId ? stableTurnsByThreadId.get(activeThreadId) ?? EMPTY_WORKBENCH_TURNS : EMPTY_WORKBENCH_TURNS, [activeThreadId, stableTurnsByThreadId]);
  const agentSessions = useMemo(() => buildAgentSessions(activeThreadTurns, threads, activeThreadId, stableTurnsByThreadId), [activeThreadId, activeThreadTurns, threads, stableTurnsByThreadId]);
  if (agentSessionCacheRef.current.threadId !== activeThreadId) {
    agentSessionCacheRef.current = { threadId: activeThreadId, sessions: new Map() };
  }
  const stableAgentSessions = useMemo(() => {
    const cache = agentSessionCacheRef.current.sessions;
    return agentSessions.map((agent) => {
      const previous = cache.get(agent.id);
      const stable = previous ? {
        ...agent,
        name: mergeAgentName(previous.name, agent.name),
        role: agent.role ?? previous.role,
        threadId: agent.threadId ?? previous.threadId
      } : agent;
      cache.set(stable.id, stable);
      return stable;
    });
  }, [agentSessions]);
  const activeAgents = useMemo(
    () => stableAgentSessions.filter((agent) => isCurrentlyActiveAgent(agent, activeThreadTurns, stableTurnsByThreadId)),
    [activeThreadTurns, stableAgentSessions, stableTurnsByThreadId]
  );
  const selectedAgentId = agentPage.kind === "agent" ? agentPage.agentId : null;
  const allAgentsSelected = agentPage.kind === "all";
  const selectedAgent = useMemo(
    () => selectedAgentId ? stableAgentSessions.find((agent) => agent.id === selectedAgentId) ?? agentSessionCacheRef.current.sessions.get(selectedAgentId) ?? null : null,
    [selectedAgentId, stableAgentSessions]
  );
  const railAgents = useMemo(
    () => selectAgentRailSessions(activeAgents, selectedAgent),
    [activeAgents, selectedAgent]
  );
  const selectedAgentThreadId = selectedAgent?.threadId ?? null;
  // The active child subscription follows the page immediately. Deferring this
  // value kept the previous page's projection alive during a busy stream and
  // allowed rapid agent switching to retain concurrent render work.
  const selectedAgentTranscript = useTopicTranscript(transcriptStore, selectedAgentThreadId);
  const selectedAgentUsage = useTopicUsage(usageStore, selectedAgentThreadId);
  const visibleAgents = stableAgentSessions;
  const virtualPageKey = agentVirtualPageKey(activeThreadId, agentPage);
  let pageCaches = rowCachesRef.current.get(virtualPageKey);
  if (!pageCaches) {
    pageCaches = { stable: createStableChatRowsCache(), incremental: createIncrementalChatRowsCache() };
    rowCachesRef.current.set(virtualPageKey, pageCaches);
    if (rowCachesRef.current.size > 8) {
      const oldest = rowCachesRef.current.keys().next().value;
      if (oldest) rowCachesRef.current.delete(oldest);
    }
    visibleTurnTokenUsageRef.current = {};
  }
  const stableRowsCache = pageCaches.stable;
  const incrementalRowsCache = pageCaches.incremental;
  const pageInitialScrollTop = pageScrollPositionsRef.current.get(virtualPageKey)
    ?? (agentPage.kind === "main" ? initialScrollTop : undefined);
  const rememberPageScroll = useCallback((scrollTop: number) => {
    pageScrollPositionsRef.current.set(virtualPageKey, scrollTop);
  }, [virtualPageKey]);

  const waterfallSourceTurns = useMemo(() => {
    if (!activeThreadId) return [];
    if (allAgentsSelected) return [];
    if (!selectedAgentThreadId) {
      return activeThreadTurns;
    }
    return [...activeThreadTurns, ...selectedAgentTranscript.turns];
  }, [activeThreadId, activeThreadTurns, allAgentsSelected, selectedAgentThreadId, selectedAgentTranscript.turns]);
  const waterfallTurns = useMemo(
    () => selectTurnsForWaterfallMode(waterfallSourceTurns, waterfallDisplayMode),
    [waterfallDisplayMode, waterfallSourceTurns]
  );
  // A selected agent page renders the parent turn alongside the child turn.
  // Keep both usage buckets visible; using only the child map made the
  // parent's time/token metadata disappear as soon as an agent was selected.
  const visibleUsageSource = useMemo(
    () => selectedAgentThreadId
      ? { ...turnTokenUsage, ...selectedAgentUsage.turnUsage }
      : turnTokenUsage,
    [selectedAgentThreadId, selectedAgentUsage.turnUsage, turnTokenUsage]
  );
  const visibleTurnTokenUsage = useMemo(() => {
    if (waterfallTurns.length === 0) {
      if (Object.keys(visibleTurnTokenUsageRef.current).length === 0) {
        return visibleTurnTokenUsageRef.current;
      }
      visibleTurnTokenUsageRef.current = {};
      return visibleTurnTokenUsageRef.current;
    }
    const next: Record<string, TokenUsageBreakdown> = {};
    let changed = false;
    for (const turn of waterfallTurns) {
      const usage = visibleUsageSource[turn.id];
      if (usage) {
        next[turn.id] = usage;
        if (visibleTurnTokenUsageRef.current[turn.id] !== usage) {
          changed = true;
        }
      }
    }
    const previousKeys = Object.keys(visibleTurnTokenUsageRef.current);
    if (!changed && previousKeys.length === Object.keys(next).length) {
      return visibleTurnTokenUsageRef.current;
    }
    visibleTurnTokenUsageRef.current = next;
    return next;
  }, [visibleUsageSource, waterfallTurns]);
  const persistedRows = useMemo(() => {
    if (allAgentsSelected) return [];
    const nextRows = selectedAgent
      ? agentConversationRows(waterfallTurns, activeThreadId, selectedAgent, visibleTurnTokenUsage, compactionSourceByTurnId, requestTokenUsage)
      : mainConversationRows(waterfallTurns, activeThreadId, visibleTurnTokenUsage, incrementalRowsCache, compactionSourceByTurnId, requestTokenUsage, threads.find((thread) => thread.id === activeThreadId)?.cliBackend);
    return selectedAgent ? stableChatRows(nextRows, stableRowsCache) : nextRows;
  }, [activeThreadId, allAgentsSelected, compactionSourceByTurnId, requestTokenUsage, selectedAgent, visibleTurnTokenUsage, waterfallTurns, threads]);
  const displayRows = useMemo(
    () => allAgentsSelected ? persistedRows : applyWaterfallDisplayMode(persistedRows, waterfallDisplayMode).rows,
    [allAgentsSelected, persistedRows, waterfallDisplayMode]
  );
  const chatRows = useMemo(
    () => selectedAgent || allAgentsSelected
      ? displayRows
      : mergePendingRows(displayRows, pendingAppendRows(pendingAppends, activeThreadId)),
    [activeThreadId, allAgentsSelected, displayRows, pendingAppends, selectedAgent]
  );
  const hasAnyVisibleThreadActivity = useMemo(
    () => activeThreadTurns.some((turn) => turn.items.length > 0),
    [activeThreadTurns]
  );
  const loadingActiveThread = Boolean(threadLoadProgress && (!activeThreadId || threadLoadProgress.threadId === activeThreadId));
  const showEmptyConversation = chatRows.length === 0 && !loadingActiveThread && !welcomeDismissed
    && (selectedAgent || allAgentsSelected || !hasAnyVisibleThreadActivity);
  const hasParallelAgents = visibleAgents.length > 0;
  const showStickyGoal = Boolean(goal);
  const taskPlan = useMemo(
    () => latestTaskPlan(waterfallSourceTurns, selectedAgent && !allAgentsSelected ? selectedAgent.threadId ?? null : activeThreadId),
    [activeThreadId, allAgentsSelected, selectedAgent, waterfallSourceTurns]
  );
  useEffect(() => {
    if (!interactive) return;
    if (
      activeThreadId &&
      threadLoadProgress?.threadId === activeThreadId &&
      threadLoadProgress.progress < 92
    ) {
      reportedTranscriptLoadRef.current = null;
    }
    if (
      !activeThreadId ||
      threadLoadProgress?.threadId !== activeThreadId ||
      threadLoadProgress.progress < 92 ||
      threadLoadProgress.progress >= 100 ||
      reportedTranscriptLoadRef.current === activeThreadId
    ) {
      return;
    }
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        reportedTranscriptLoadRef.current = activeThreadId;
        onTranscriptRendered?.(activeThreadId);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [activeThreadId, chatRows.length, interactive, onTranscriptRendered, threadLoadProgress?.progress, threadLoadProgress?.threadId]);

  const selectAgent = useCallback((agent: AgentSession) => {
    setAgentPage({ kind: "agent", agentId: agent.id });
    if (agent.threadId) {
      onAgentThreadSelect?.(agent.threadId);
    }
  }, [onAgentThreadSelect]);

  const closeAgent = useCallback(() => {
    setAgentPage(MAIN_AGENT_PAGE);
  }, []);

  const openAgentFromOverview = useCallback((agentId: string) => {
    const agent = agentSessionCacheRef.current.sessions.get(agentId);
    if (agent) selectAgent(agent);
  }, [selectAgent]);

  return (
    <Box
      data-agent-virtual-page={virtualPageKey}
      sx={{
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        maxWidth: "100%",
        height: "100%",
        overflow: "hidden",
        display: "grid",
        boxSizing: "border-box",
        justifySelf: "stretch",
        position: "relative",
        gridTemplateColumns: hasParallelAgents ? { xs: "54px minmax(0, 1fr)", sm: "64px minmax(0, 1fr)" } : "minmax(0, 1fr)"
      }}
    >
      {threadLoadProgress && (
        <Box
          data-testid="thread-load-progress"
          sx={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 8,
            width: "min(560px, calc(100% - 32px))",
            px: 1.25,
            py: 1,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.94 : 0.97),
            boxShadow: (theme) => theme.customShadows?.z8,
            pointerEvents: "none"
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="subtitle2" noWrap sx={{ fontWeight: 850 }}>
                {threadLoadProgress.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                {threadLoadProgress.label}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>
              {Math.round(threadLoadProgress.progress)}%
            </Typography>
          </Stack>
          <LinearProgress variant="determinate" value={threadLoadProgress.progress} sx={{ height: 4 }} />
        </Box>
      )}
      {hasParallelAgents && (
        <ParallelAgentsRail
          agents={railAgents}
          totalAgentCount={visibleAgents.length}
          selectedAgentId={selectedAgentId}
          allAgentsSelected={allAgentsSelected}
          onSelectMain={() => setAgentPage(MAIN_AGENT_PAGE)}
          onSelectAll={() => setAgentPage(ALL_AGENTS_PAGE)}
          onSelectAgent={selectAgent}
        />
      )}
      <Box
        sx={{
          minHeight: 0,
          minWidth: 0,
          width: "100%",
          height: "100%",
          overflow: "hidden",
          display: "grid",
          boxSizing: "border-box",
          gridTemplateRows: showStickyGoal ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)"
        }}
      >
        {goal && (
          <Box
            data-testid="chat-sticky-goal-surface"
            sx={{
              borderBottom: "1px solid",
              borderColor: "divider",
              bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.94 : 0.97),
              px: { xs: 1, sm: 1.5, lg: 2 },
              py: 1
            }}
          >
            <Box sx={{ maxWidth: 1120, mx: "auto" }}>
              <GoalBanner
                goal={goal}
                t={t}
                onEdit={onGoalEdit}
                onStatusChange={onGoalStatusChange}
                onClear={onGoalClear}
                onCancel={onGoalCancel}
                maxLines={chatTypography?.goalMaxLines ?? 3}
              />
            </Box>
          </Box>
        )}
        <Box sx={{ minHeight: 0, minWidth: 0, width: "100%", maxWidth: "100%", position: "relative", overflow: "hidden" }}>
          {allAgentsSelected ? (
            <AllAgentsOverviewPage
              transcriptStore={transcriptStore}
              activeThreadId={activeThreadId}
              agents={visibleAgents}
              turnsByThreadId={stableTurnsByThreadId}
              resetKey={virtualPageKey}
              initialScrollTop={pageInitialScrollTop}
              interactive={interactive}
              onOpenAgent={openAgentFromOverview}
              onScrollPositionChange={rememberPageScroll}
              before={
                <AllAgentsConversationHeader
                  agents={visibleAgents}
                  activeCount={activeAgents.length}
                  onClose={closeAgent}
                />
              }
            />
          ) : (
            <Box
              sx={{
                height: "100%",
                minHeight: 0,
                minWidth: 0,
                width: "100%",
                maxWidth: "100%",
                display: "grid",
                gridTemplateRows: selectedAgent ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
              }}
            >
              {selectedAgent && (
                <Box sx={{ px: { xs: 1.25, sm: 2 }, pt: 1.25, pb: 0.75 }}>
                  <Box sx={{ maxWidth: 1120, mx: "auto" }}>
                    <AgentConversationHeader agent={selectedAgent} onClose={closeAgent} />
                  </Box>
                </Box>
              )}
              <ChatWaterfall
                resetKey={virtualPageKey}
                mobileLayout={mobileLayout}
                initialScrollTop={pageInitialScrollTop}
                interactive={interactive}
                rows={chatRows}
                t={t}
                assistantUsageDisplay={assistantUsageDisplay}
                typography={chatTypography}
                onOpenPreview={onOpenPreview}
                webPreview={webPreview}
                onClosePreview={onClosePreview}
                onEditUserMessage={agentPage.kind === "main" && onEditUserMessage
                  ? (row, text) => onEditUserMessage(row.threadId, row.turnId, text)
                  : undefined}
                onDeletePendingMessage={agentPage.kind === "main" ? onDeletePendingMessage : undefined}
                onOpenCommandBlacklistSettings={onOpenCommandBlacklistSettings}
                onScrollActivity={handleScrollActivity}
                onScrollPositionChange={rememberPageScroll}
                sessionToken={sessionToken}
                hasOlder={agentPage.kind === "main" && hasOlderHistory}
                loadingOlder={agentPage.kind === "main" && loadingOlderHistory}
                onReachTop={agentPage.kind === "main" && activeThreadId && onLoadOlderHistory ? () => onLoadOlderHistory(activeThreadId) : undefined}
                before={
                  <Stack spacing={1.75} sx={{ maxWidth: 1120, mx: "auto" }}>
                {errors.map((error, index) => (error ? <Alert key={`${error}-${index}`} severity="error">{error}</Alert> : null))}
                {slashNotice && (
                  <Alert
                    data-testid="slash-command-result"
                    severity={slashNotice.severity}
                    onClose={onSlashNoticeClose}
                    sx={{
                      alignItems: "flex-start",
                      "& .MuiAlert-message": {
                        minWidth: 0,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere"
                      }
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                      {slashNotice.title}
                    </Typography>
                    <Typography variant="body2" component="div">
                      {slashNotice.message}
                    </Typography>
                  </Alert>
                )}
                {requestMonitor.length > 0 && (
                  <Stack direction="row" alignItems="center" justifyContent="flex-end">
                    <Button data-testid="request-monitor-button" size="small" variant="outlined" startIcon={<AssessmentIcon />} onClick={() => setRequestsOpen(true)} sx={{ borderRadius: 1 }}>
                      {t("chat.requests")}
                      <Chip size="small" label={requestMonitor.length} sx={{ ml: 1, height: 20 }} />
                    </Button>
                  </Stack>
                )}
                {(modes.fast || modes.plan) && (
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap data-testid="chat-mode-badges">
                    {modes.fast && <Chip size="small" color="warning" icon={<BoltIcon />} label={t("app.fast")} data-testid="fast-mode-badge" />}
                    {modes.plan && <Chip size="small" color="primary" icon={<ChecklistIcon />} label={t("app.plan")} data-testid="plan-mode-badge" />}
                  </Stack>
                )}
                {loadingActiveThread && chatRows.length === 0 && threadLoadProgress && (
                  <ThreadLoadingPlaceholder progress={threadLoadProgress} />
                )}
                    {showEmptyConversation && (
                      <EmptyConversation
                        selectedAgent={selectedAgent}
                        activeThemePlugin={activeThemePlugin}
                        welcomeBackgroundImage={welcomeBackgroundImage}
                        desktopRuntime={desktopRuntime}
                        engineStatus={engineStatus}
                        hasConfiguredRelays={hasConfiguredRelays}
                        t={t}
                        onPromptSelect={onPromptSelect}
                        onContinueConversation={onContinueConversation}
                        onCreateConversation={onCreateConversation}
                        onOpenOnboardingSection={onOpenOnboardingSection}
                        onOpenOfficialLogin={onOpenOfficialLogin}
                        onOpenDiscord={onOpenDiscord}
                        onSyncFreeModels={onSyncFreeModels}
                      />
                    )}
                  </Stack>
                }
              />
            </Box>
          )}
          <TaskPlanPanel plan={taskPlan} t={t} />
        </Box>
      </Box>
      <Dialog
        open={pendingRequests.length > 0 && Boolean(onAnswerServerRequest)}
        onClose={() => undefined}
        disableEscapeKeyDown
        fullWidth
        maxWidth="md"
        aria-labelledby="pending-server-requests-title"
        data-testid="pending-server-requests-dialog"
      >
        <DialogContent sx={{ p: 1.5 }}>
          {onAnswerServerRequest && (
            <PendingServerRequestsPanel pendingRequests={pendingRequests} onAnswerServerRequest={onAnswerServerRequest} />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={requestsOpen}
        onClose={() => setRequestsOpen(false)}
        fullWidth
        maxWidth="lg"
        data-testid="request-monitor-dialog"
      >
        <DialogTitle sx={{ pr: 6 }}>
          {t("chat.requests")}
          <IconButton
            aria-label={t("chat.closeRequests")}
            onClick={() => setRequestsOpen(false)}
            sx={{ position: "absolute", right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 0, pb: 2 }}>
          <RequestMonitorTable entries={requestMonitor} t={t} />
        </DialogContent>
      </Dialog>
      {statsOpen && stats && (
        <Box
          data-testid="session-stats-dialog"
          sx={{
            position: "absolute",
            top: { xs: 8, sm: 12 },
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(900px, calc(100% - 24px))",
            zIndex: 4
          }}
        >
          <StatsPanel stats={stats} t={t} onClose={onStatsClose} />
        </Box>
      )}
    </Box>
  );
}

function GoalBanner({
  goal,
  t,
  onEdit,
  onStatusChange,
  onClear,
  onCancel,
  maxLines
}: {
  goal: GoalBannerState;
  t: TranslateFn;
  onEdit?: () => void;
  onStatusChange?: (status: GoalStatus) => void;
  onClear?: () => void;
  onCancel?: () => void;
  maxLines: number;
}) {
  const paused = goal.status === "paused";
  const complete = goal.status === "complete";
  // budgetLimited / blocked / usageLimited all park the goal: the button must
  // offer an explicit resume-to-active entry, otherwise the goal is stuck
  // (thread/goal/set accepts active and renews the allowance).
  const resumable =
    paused || goal.status === "blocked" || goal.status === "budgetLimited" || goal.status === "usageLimited";
  return (
    <Paper
      data-testid="sticky-goal-bar"
      data-goal-status={goal.status}
      variant="outlined"
      sx={{
        p: 1,
        borderRadius: 1,
        bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.84 : 0.9)
      }}
    >
      <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
          <FlagIcon fontSize="small" color={complete ? "success" : paused ? "disabled" : "primary"} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 800, textTransform: "uppercase" }}>
              {t("chat.goal")}
            </Typography>
            <Typography sx={{ fontWeight: 750, overflowWrap: "anywhere", lineHeight: 1.35, maxHeight: `${maxLines * 1.35}em`, overflowY: "auto", scrollbarGutter: "stable" }}>{goal.objective}</Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip size="small" label={goalStatusLabel(goal.status)} color={complete ? "success" : paused ? "default" : "primary"} />
          {typeof goal.tokensUsed === "number" && <Chip size="small" variant="outlined" label={`${formatNumber(goal.tokensUsed)} tokens`} />}
          {goal.tokenBudget != null && <Chip size="small" variant="outlined" label={`${formatNumber(goal.tokenBudget)} budget`} />}
          {typeof goal.timeUsedSeconds === "number" && goal.timeUsedSeconds > 0 && (
            <Chip size="small" variant="outlined" label={formatDuration(goal.timeUsedSeconds)} />
          )}
          <Tooltip title={t("chat.editGoal")}>
            <IconButton size="small" aria-label={t("chat.editGoal")} onClick={onEdit}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={resumable ? t("chat.resumeGoal") : t("chat.pauseGoal")}>
            <IconButton
              size="small"
              aria-label={resumable ? t("chat.resumeGoal") : t("chat.pauseGoal")}
              onClick={() => onStatusChange?.(resumable ? "active" : "paused")}
              disabled={complete}
            >
              {resumable ? <PlayCircleIcon fontSize="small" /> : <PauseCircleIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title={t("chat.clearGoal")}>
            <IconButton size="small" aria-label={t("chat.clearGoal")} onClick={onClear}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button
            size="small"
            color="error"
            variant="outlined"
            startIcon={<StopCircleIcon fontSize="small" />}
            onClick={onCancel}
            disabled={!onCancel}
          >
            {t("chat.cancelGoal")}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function StatsPanel({ stats, t, onClose }: { stats: WorkbenchStatsState; t: TranslateFn; onClose?: () => void }) {
  return (
    <Paper
      data-testid="slash-stats-panel"
      variant="outlined"
      sx={{
        p: 1.25,
        borderRadius: 1,
        bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.68 : 0.74)
      }}
    >
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} alignItems="center">
          <AssessmentIcon fontSize="small" color="primary" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
              {stats.scope === "stats" ? t("chat.projectStats") : t("chat.sessionStatus")}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
              {stats.activeThreadId ? `Thread ${stats.activeThreadId}` : t("chat.noActiveThread")}
            </Typography>
          </Box>
          <Button size="small" onClick={onClose}>
            {t("chat.close")}
          </Button>
        </Stack>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
            gap: 0.75
          }}
        >
          <StatsMetric label="Thread tokens" value={formatTokenValue(stats.threadUsage?.total.totalTokens)} />
          <StatsMetric label="Project tokens" value={formatTokenValue(stats.projectUsage?.totalTokens)} />
          <StatsMetric label={t("chat.stats.turnInput")} value={formatTokenValue(stats.lastTurnUsage?.inputTokens)} />
          <StatsMetric label={t("chat.stats.turnOutput")} value={formatTokenValue(stats.lastTurnUsage?.outputTokens)} />
          <StatsMetric label={t("chat.stats.turnCost")} value={formatStatsCost(stats.lastTurnUsage?.estimatedCostUsd)} />
          <StatsMetric label={t("chat.stats.threadCost")} value={formatStatsCost(stats.threadUsage?.total.estimatedCostUsd)} />
          <StatsMetric label={t("chat.stats.projectCost")} value={formatStatsCost(stats.projectUsage?.estimatedCostUsd)} />
          <StatsMetric label="Thread turns" value={formatNumber(stats.sessionTurns)} />
          <StatsMetric label="Project turns" value={formatNumber(stats.projectTurns)} />
          <StatsMetric label="Model" value={stats.model || "Engine default"} compact />
          <StatsMetric label="Provider" value={stats.provider || "default"} compact />
          <StatsMetric label="Reasoning" value={stats.reasoningEffort} compact />
          <StatsMetric label="Permissions" value={stats.permissionLabel} compact />
        </Box>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={stats.modes.fast ? "Fast on" : "Fast off"} color={stats.modes.fast ? "warning" : "default"} icon={<BoltIcon />} />
          <Chip size="small" label={stats.modes.plan ? "Plan on" : "Plan off"} color={stats.modes.plan ? "primary" : "default"} icon={<ChecklistIcon />} />
          <Chip size="small" label={stats.goal ? `Goal ${goalStatusLabel(stats.goal.status)}` : "No goal"} />
          <Chip size="small" label={`${formatNumber(stats.projectThreads)} threads indexed`} />
          <Chip size="small" label={`${formatNumber(stats.sessionItems)} items in thread`} />
        </Stack>
      </Stack>
    </Paper>
  );
}

function StatsMetric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <Box
      sx={{
        minWidth: 0,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
        p: 0.85
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700 }}>
        {label}
      </Typography>
      <Typography
        title={value}
        sx={{
          fontWeight: compact ? 700 : 850,
          fontSize: compact ? 13 : 18,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function goalStatusLabel(status: GoalStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "blocked":
      return "Blocked";
    case "usageLimited":
      return "Usage limited";
    case "budgetLimited":
      return "Budget limited";
    case "complete":
      return "Complete";
    default:
      return status;
  }
}

function formatTokenValue(value?: number): string {
  return typeof value === "number" ? formatNumber(value) : "waiting for usage";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes <= 0) {
    return `${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours <= 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

function ParallelAgentsRail({
  agents,
  totalAgentCount,
  selectedAgentId,
  allAgentsSelected,
  onSelectMain,
  onSelectAll,
  onSelectAgent
}: {
  agents: AgentSession[];
  totalAgentCount: number;
  selectedAgentId: string | null;
  allAgentsSelected: boolean;
  onSelectMain: () => void;
  onSelectAll: () => void;
  onSelectAgent: (agent: AgentSession) => void;
}) {
  const mainSelected = !selectedAgentId && !allAgentsSelected;
  return (
    <Box
      data-testid="parallel-agent-rail"
      aria-label="Parallel agents"
      sx={{
        minHeight: 0,
        overflowY: "auto",
        borderRight: "1px solid",
        borderColor: "divider",
        bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.68 : 0.76),
        py: 1,
        px: { xs: 0.5, sm: 0.75 },
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.75
      }}
    >
      <Tooltip title="Main conversation" placement="right">
        <IconButton
          size="small"
          aria-label="Open main conversation"
          data-testid="parallel-agent-main"
          onClick={onSelectMain}
          color={mainSelected ? "primary" : "default"}
          sx={railButtonSx(mainSelected)}
        >
          <ForumIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={`All agents (${totalAgentCount})`} placement="right">
        <IconButton
          size="small"
          aria-label="Open all agents"
          data-testid="parallel-agent-all"
          onClick={onSelectAll}
          color={allAgentsSelected ? "primary" : "default"}
          sx={railButtonSx(allAgentsSelected)}
        >
          <GridViewIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Divider flexItem sx={{ my: 0.25 }} />
      {agents.map((agent, index) => {
        const active = selectedAgentId === agent.id;
        const testId = sanitizeTestId(agent.id);
        return (
          <Box key={agent.id} data-testid={`parallel-agent-slot-${testId}`} sx={{ position: "relative", width: "100%", display: "grid", placeItems: "center" }}>
            <Tooltip title={agentTooltipTitle(agent)} placement="right">
              <IconButton
                size="small"
                aria-label={`Open agent ${agent.name}`}
                data-testid={`parallel-agent-button-${testId}`}
                onClick={() => onSelectAgent(agent)}
                color={active ? "primary" : "default"}
                sx={railButtonSx(active)}
              >
                <Avatar
                  sx={{
                    width: 28,
                    height: 28,
                    fontSize: 13,
                    fontWeight: 800,
                    bgcolor: agentAvatarColor(index),
                    color: "primary.contrastText"
                  }}
                >
                  {agentInitial(agent.name)}
                </Avatar>
              </IconButton>
            </Tooltip>
          </Box>
        );
      })}
    </Box>
  );
}

function AgentConversationHeader({ agent, onClose }: { agent: AgentSession; onClose: () => void }) {
  return (
    <Paper
      data-testid="parallel-agent-header"
      variant="outlined"
      sx={{
        p: 1.25,
        borderRadius: 1,
        bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.72 : 0.82)
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <AccountTreeIcon fontSize="small" color="primary" />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {agent.name}
          </Typography>
          {agent.role && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {agent.role}
            </Typography>
          )}
        </Box>
        <VisibleStatusChip status={agent.status} />
        <Tooltip title={`Close ${agent.name} view`}>
          <IconButton size="small" aria-label={`Close agent ${agent.name} view`} onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Paper>
  );
}

function formatStatsCost(value?: number): string {
  if (value == null) return "—";
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return `$${value.toFixed(6)}`;
}

function AllAgentsConversationHeader({
  agents,
  activeCount,
  onClose,
}: {
  agents: AgentSession[];
  activeCount: number;
  onClose: () => void;
}) {
  const { completed: completedCount, failed: failedCount } = summarizeAgentStatuses(agents);
  return (
    <Paper
      data-testid="parallel-agent-all-header"
      variant="outlined"
      sx={{
        p: 1.25,
        borderRadius: 1,
        bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.72 : 0.82),
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <GridViewIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ minWidth: 0, flex: 1, fontWeight: 800 }}>
          All agents
        </Typography>
        <Chip size="small" label={`${agents.length} total`} />
        {activeCount > 0 && <Chip size="small" color="primary" label={`${activeCount} active`} />}
        {completedCount > 0 && <Chip size="small" color="success" label={`${completedCount} completed`} />}
        {failedCount > 0 && <Chip size="small" color="error" label={`${failedCount} failed`} />}
        <Tooltip title="Close all-agents view">
          <IconButton size="small" aria-label="Close all-agents view" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Paper>
  );
}

function AllAgentsOverviewPage({
  transcriptStore,
  activeThreadId,
  agents,
  turnsByThreadId,
  resetKey,
  initialScrollTop,
  interactive,
  onOpenAgent,
  onScrollPositionChange,
  before,
}: {
  transcriptStore: TopicTranscriptStore;
  activeThreadId: string | null;
  agents: AgentSession[];
  turnsByThreadId: ReadonlyMap<string, WorkbenchTurn[]>;
  resetKey: string;
  initialScrollTop?: number;
  interactive: boolean;
  onOpenAgent: (agentId: string) => void;
  onScrollPositionChange: (scrollTop: number) => void;
  before: React.ReactNode;
}) {
  const transcriptOverview = useAgentTranscriptOverview(transcriptStore, activeThreadId);
  const stableRowsCacheRef = useRef(createStableChatRowsCache());
  const rows = useMemo(() => stableChatRows(
    buildAllAgentOverviewRows(agents, turnsByThreadId, activeThreadId, transcriptOverview),
    stableRowsCacheRef.current,
  ), [activeThreadId, agents, transcriptOverview, turnsByThreadId]);
  return (
    <AgentOverviewGrid
      rows={rows}
      before={before}
      resetKey={resetKey}
      initialScrollTop={initialScrollTop}
      interactive={interactive}
      onOpenAgent={onOpenAgent}
      onScrollPositionChange={onScrollPositionChange}
    />
  );
}

function EmptyConversation({
  selectedAgent,
  activeThemePlugin,
  welcomeBackgroundImage,
  desktopRuntime,
  engineStatus,
  hasConfiguredRelays,
  t,
  onPromptSelect,
  onContinueConversation,
  onCreateConversation,
  onOpenOnboardingSection,
  onOpenOfficialLogin,
  onOpenDiscord
  ,onSyncFreeModels
}: {
  selectedAgent: AgentSession | null;
  activeThemePlugin?: ThemePlugin | null;
  welcomeBackgroundImage?: string;
  desktopRuntime?: DesktopRuntimeInfo;
  engineStatus?: EngineStatus;
  hasConfiguredRelays: boolean;
  t: TranslateFn;
  onPromptSelect?: (text: string) => void;
  onContinueConversation?: () => void;
  onCreateConversation?: () => void;
  onOpenOnboardingSection?: (section: OnboardingSectionId) => void;
  onOpenOfficialLogin?: () => void;
  onOpenDiscord?: () => void;
  onSyncFreeModels?: () => Promise<void>;
}) {
  if (!selectedAgent) {
    return (
      <DefaultWorkbenchEmpty
        activeThemePlugin={activeThemePlugin}
        welcomeBackgroundImage={welcomeBackgroundImage}
        desktopRuntime={desktopRuntime}
        engineStatus={engineStatus}
        hasConfiguredRelays={hasConfiguredRelays}
        t={t}
        onPromptSelect={onPromptSelect}
        onContinueConversation={onContinueConversation}
        onCreateConversation={onCreateConversation}
        onOpenOnboardingSection={onOpenOnboardingSection}
        onOpenOfficialLogin={onOpenOfficialLogin}
        onOpenDiscord={onOpenDiscord}
        onSyncFreeModels={onSyncFreeModels}
      />
    );
  }
  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2, sm: 3 },
        borderRadius: 1,
        bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.58 : 0.74),
        boxShadow: (theme) => theme.customShadows?.card
      }}
    >
      <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 750 }}>
        {`${selectedAgent.name} has no visible messages yet`}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        The agent thread is available, and messages will appear here as Codex streams them.
      </Typography>
    </Paper>
  );
}

function DefaultWorkbenchEmpty({
  activeThemePlugin,
  welcomeBackgroundImage,
  desktopRuntime,
  engineStatus,
  hasConfiguredRelays,
  t,
  onPromptSelect,
  onContinueConversation,
  onCreateConversation,
  onOpenOnboardingSection,
  onOpenOfficialLogin,
  onOpenDiscord
  ,onSyncFreeModels
}: {
  activeThemePlugin?: ThemePlugin | null;
  welcomeBackgroundImage?: string;
  desktopRuntime?: DesktopRuntimeInfo;
  engineStatus?: EngineStatus;
  hasConfiguredRelays: boolean;
  t: TranslateFn;
  onPromptSelect?: (text: string) => void;
  onContinueConversation?: () => void;
  onCreateConversation?: () => void;
  onOpenOnboardingSection?: (section: OnboardingSectionId) => void;
  onOpenOfficialLogin?: () => void;
  onOpenDiscord?: () => void;
  onSyncFreeModels?: () => Promise<void>;
}) {
  const cliRecovery = codexCliRecoveryNotice(engineStatus, desktopRuntime);
  const heroImage =
    activeThemePlugin?.layout?.heroEnabled === false
      ? undefined
      : safeThemeAssetUrl(welcomeBackgroundImage ?? activeThemePlugin?.assets?.welcomeBackgroundImage ?? activeThemePlugin?.assets?.heroImage ?? activeThemePlugin?.assets?.appBackgroundImage);
  const cornerImage = safeThemeAssetUrl(activeThemePlugin?.assets?.cornerImage);
  const richDecorations = activeThemePlugin?.layout?.decorationIntensity === "rich";
  const themeTuning = themeVisualTuning(activeThemePlugin);
  const windowsDesktop = desktopRuntime?.platform === "win32";
  return (
    <Box data-testid="default-workbench-empty" sx={{ display: "grid", alignItems: "center" }}>
      <Box
        sx={{
          position: "relative",
          overflow: "hidden",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          bgcolor: (theme) => alpha(theme.palette.background.paper, themeTuning.workspaceSurfaceOpacity),
          boxShadow: (theme) => theme.customShadows?.card,
          px: { xs: 1.25, sm: 2, md: 2.5 },
          py: { xs: 1.25, sm: 1.5 },
          backgroundImage: heroImage
            ? (theme) =>
                [
                  `linear-gradient(90deg, ${alpha(theme.palette.background.paper, Math.min(0.9, themeTuning.heroOverlayOpacity + 0.14))} 0%, ${alpha(theme.palette.background.paper, themeTuning.heroOverlayOpacity)} 48%, ${alpha(theme.palette.background.paper, Math.max(0, themeTuning.heroOverlayOpacity * 0.28))} 100%)`,
                  `radial-gradient(circle at 12% 24%, ${alpha(themeTuning.toneColor, themeTuning.toneOpacity)}, transparent 42%)`,
                  `url("${heroImage}")`
                ].join(", ")
            : (theme) =>
                [
                  `radial-gradient(circle at 18% 12%, ${alpha(theme.palette.primary.main, 0.16)}, transparent 34%)`,
                  `radial-gradient(circle at 82% 18%, ${alpha(theme.palette.secondary.main, 0.12)}, transparent 28%)`,
                  `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.84)}, ${alpha(theme.palette.background.default, 0.66)})`
                ].join(", "),
          backgroundSize: heroImage ? "cover" : "auto",
          backgroundPosition: "center"
        }}
      >
        {richDecorations && (
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              backgroundImage:
                "radial-gradient(circle at 12% 32%, rgba(255,255,255,0.52) 0 2px, transparent 3px), radial-gradient(circle at 72% 18%, rgba(255,255,255,0.46) 0 2px, transparent 3px)",
              opacity: Math.min(0.72, themeTuning.toneOpacity + 0.28)
            }}
          />
        )}
        <Stack spacing={{ xs: 1, sm: 1.2 }} sx={{ position: "relative", zIndex: 1 }}>
          <Stack spacing={0.35} sx={{ maxWidth: 620 }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <AutoAwesomeIcon color="primary" fontSize="small" />
              <Typography variant="caption" color="primary" sx={{ fontWeight: 800 }}>
                {t("chat.emptyBrand")}
              </Typography>
            </Stack>
            <Typography component="h2" sx={{ fontSize: { xs: 19, md: 22 }, lineHeight: 1.12, fontWeight: 850 }}>
              {t("chat.emptyTitle")}
            </Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 540, fontSize: 12.5, lineHeight: 1.35 }}>
              {t("chat.emptySubtitle")}
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
              {onOpenDiscord && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DiscordIcon fontSize="small" />}
                  onClick={onOpenDiscord}
                  data-testid="welcome-discord-button"
                  sx={{ color: "#5865F2", borderColor: "#5865F2", textTransform: "none", fontWeight: 750 }}
                >
                  {t("chat.discordJoin")}
                </Button>
              )}
              {onSyncFreeModels && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<RefreshIcon fontSize="small" />}
                  onClick={() => void onSyncFreeModels()}
                  data-testid="welcome-free-models-button"
                  sx={{ textTransform: "none", fontWeight: 750 }}
                >
                  {t("chat.freeModelsSync")}
                </Button>
              )}
            </Stack>
          </Stack>
          {cliRecovery.required && (
            <Alert
              severity="warning"
              variant="outlined"
              data-testid="codex-cli-install-reminder"
              action={(
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<ContentCopyIcon />}
                onClick={() => void copyTextToClipboard(cliRecovery.command)}
                >
                  {t("onboarding.codexCli.copy")}
                </Button>
              )}
            >
              <Typography variant="body2" sx={{ fontWeight: 800 }}>
                {cliRecovery.reason === "missing" ? t("onboarding.codexCli.missing") : t("onboarding.codexCli.startFailed")}
              </Typography>
              <Box component="code" sx={{ display: "block", mt: 0.5, fontSize: 11, overflowWrap: "anywhere" }}>
                {cliRecovery.command}
              </Box>
            </Alert>
          )}
          {!hasConfiguredRelays && (
            <Alert
              severity="info"
              variant="outlined"
              data-testid="relay-setup-reminder"
              action={(
                <Button color="inherit" size="small" onClick={() => onOpenOnboardingSection?.("relay")}>
                  {t("onboarding.relayMissing.action")}
                </Button>
              )}
            >
              <Typography variant="body2" sx={{ fontWeight: 800 }}>
                {t("onboarding.relayMissing.title")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("onboarding.relayMissing.detail")}
              </Typography>
            </Alert>
          )}
          {hasConfiguredRelays ? (
            <ConfiguredQuickActions
              t={t}
              canContinue={Boolean(onContinueConversation)}
              onContinue={onContinueConversation}
              onCreateConversation={onCreateConversation}
              onCreateImage={() => onPromptSelect?.("/image ")}
            />
          ) : (
            <OnboardingGuide
              t={t}
              windowsDesktop={windowsDesktop}
              onPromptSelect={onPromptSelect}
              onOpenSection={onOpenOnboardingSection}
              onOpenOfficialLogin={onOpenOfficialLogin}
            />
          )}
        </Stack>
        {cornerImage && (
          <Box
            component="img"
            src={cornerImage}
            alt=""
            sx={{
              position: "absolute",
              right: { xs: 12, md: 24 },
              bottom: { xs: 12, md: 18 },
              width: { xs: 72, md: 118 },
              aspectRatio: "1 / 1",
              objectFit: "cover",
              borderRadius: 1.5,
              border: "1px solid",
              borderColor: "divider",
              boxShadow: (theme) => theme.customShadows?.z8,
              display: { xs: "none", md: "block" },
              transform: "rotate(3deg)"
            }}
          />
        )}
      </Box>
    </Box>
  );
}

function onboardingSteps(t: TranslateFn, windowsDesktop: boolean) {
  const steps = [
    {
      id: "official",
      step: "1",
      icon: <VpnKeyIcon fontSize="small" />,
      title: t("onboarding.codex.official.title"),
      detail: t("onboarding.codex.official.detail"),
      action: t("onboarding.codex.official.action"),
      isOfficial: true
    },
    {
      id: "relay",
      step: "2",
      icon: <MemoryIcon fontSize="small" />,
      title: t("onboarding.codex.relay.title"),
      detail: t("onboarding.codex.relay.detail"),
      action: t("onboarding.codex.relay.action"),
      section: "relay" as OnboardingSectionId
    },
    {
      id: "test",
      step: "3",
      icon: <BoltIcon fontSize="small" />,
      title: t("onboarding.codex.test.title"),
      detail: t("onboarding.codex.test.detail"),
      action: t("onboarding.codex.test.action"),
      prompt: t("onboarding.codex.test.prompt")
    },
    {
      id: "auth",
      step: "4",
      icon: <KeyIcon fontSize="small" />,
      title: t("onboarding.codex.auth.title"),
      detail: t("onboarding.codex.auth.detail"),
      action: t("onboarding.codex.auth.action"),
      section: "members" as OnboardingSectionId
    }
  ];
  const visibleSteps = steps.filter((step) => step.id !== "official");
  return windowsDesktop ? visibleSteps.filter((step) => step.section !== "members") : visibleSteps;
}

export function ChatPanel(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const callbacks = useMemo(() => ({
    onPromptSelect: (text: string) => latest.current.onPromptSelect?.(text),
    onContinueConversation: () => latest.current.onContinueConversation?.(),
    onCreateConversation: () => latest.current.onCreateConversation?.(),
    onOpenOnboardingSection: (section: OnboardingSectionId) => latest.current.onOpenOnboardingSection?.(section),
    onOpenOfficialLogin: () => latest.current.onOpenOfficialLogin?.(),
    onOpenDiscord: () => latest.current.onOpenDiscord?.(),
    onSyncFreeModels: () => latest.current.onSyncFreeModels?.() ?? Promise.resolve(),
    onAgentThreadSelect: (threadId: string) => latest.current.onAgentThreadSelect?.(threadId),
    onStatsClose: () => latest.current.onStatsClose?.(),
    onSlashNoticeClose: () => latest.current.onSlashNoticeClose?.(),
    onAnswerServerRequest: (id: string | number, result: JsonValue) => latest.current.onAnswerServerRequest?.(id, result),
    onGoalEdit: () => latest.current.onGoalEdit?.(),
    onGoalStatusChange: (status: GoalStatus) => latest.current.onGoalStatusChange?.(status),
    onGoalClear: () => latest.current.onGoalClear?.(),
    onGoalCancel: () => latest.current.onGoalCancel?.(),
    onEditUserMessage: (threadId: string, turnId: string, text: string) => latest.current.onEditUserMessage?.(threadId, turnId, text),
    onDeletePendingMessage: (id: string) => latest.current.onDeletePendingMessage?.(id) ?? false,
    onOpenPreview: (url: string, mode: WebPreviewMode) => latest.current.onOpenPreview?.(url, mode),
    onClosePreview: () => latest.current.onClosePreview?.(),
    onTranscriptRendered: (threadId: string) => latest.current.onTranscriptRendered?.(threadId),
    onLoadOlderHistory: (threadId: string) => latest.current.onLoadOlderHistory?.(threadId) ?? Promise.resolve(),
    onOpenCommandBlacklistSettings: (providerId?: string, groupId?: string) => latest.current.onOpenCommandBlacklistSettings?.(providerId, groupId)
  }), []);
  // Background split panes stay mounted (visible) but lightweight: the impl
  // gates subscriptions side-effects/scroll by `interactive`, while App.tsx
  // already passes EMPTY_* data and undefined write-callbacks when unfocused.
  // Unmounting here collapsed dual-pane to a single visible window.
  if (props.interactive === false) {
    return <MemoizedChatPanel
      {...props}
      onPromptSelect={undefined}
      onContinueConversation={undefined}
      onCreateConversation={undefined}
      onOpenOnboardingSection={undefined}
      onOpenOfficialLogin={undefined}
      onOpenDiscord={undefined}
      onSyncFreeModels={undefined}
      onAgentThreadSelect={undefined}
      onStatsClose={undefined}
      onSlashNoticeClose={undefined}
      onAnswerServerRequest={undefined}
      onGoalEdit={undefined}
      onGoalStatusChange={undefined}
      onGoalClear={undefined}
      onGoalCancel={undefined}
      onEditUserMessage={undefined}
      onDeletePendingMessage={undefined}
      onOpenPreview={undefined}
      onClosePreview={undefined}
      onTranscriptRendered={undefined}
      onLoadOlderHistory={undefined}
      onOpenCommandBlacklistSettings={undefined}
    />;
  }
  return <MemoizedChatPanel
    {...props}
    onPromptSelect={props.onPromptSelect ? callbacks.onPromptSelect : undefined}
    onContinueConversation={props.onContinueConversation ? callbacks.onContinueConversation : undefined}
    onCreateConversation={props.onCreateConversation ? callbacks.onCreateConversation : undefined}
    onOpenOnboardingSection={props.onOpenOnboardingSection ? callbacks.onOpenOnboardingSection : undefined}
    onOpenOfficialLogin={props.onOpenOfficialLogin ? callbacks.onOpenOfficialLogin : undefined}
    onOpenDiscord={props.onOpenDiscord ? callbacks.onOpenDiscord : undefined}
    onSyncFreeModels={props.onSyncFreeModels ? callbacks.onSyncFreeModels : undefined}
    onAgentThreadSelect={props.onAgentThreadSelect ? callbacks.onAgentThreadSelect : undefined}
    onStatsClose={props.onStatsClose ? callbacks.onStatsClose : undefined}
    onSlashNoticeClose={props.onSlashNoticeClose ? callbacks.onSlashNoticeClose : undefined}
    onAnswerServerRequest={props.onAnswerServerRequest ? callbacks.onAnswerServerRequest : undefined}
    onGoalEdit={props.onGoalEdit ? callbacks.onGoalEdit : undefined}
    onGoalStatusChange={props.onGoalStatusChange ? callbacks.onGoalStatusChange : undefined}
    onGoalClear={props.onGoalClear ? callbacks.onGoalClear : undefined}
    onGoalCancel={props.onGoalCancel ? callbacks.onGoalCancel : undefined}
    onEditUserMessage={props.onEditUserMessage ? callbacks.onEditUserMessage : undefined}
    onDeletePendingMessage={props.onDeletePendingMessage ? callbacks.onDeletePendingMessage : undefined}
    onOpenPreview={props.onOpenPreview ? callbacks.onOpenPreview : undefined}
    onClosePreview={props.onClosePreview ? callbacks.onClosePreview : undefined}
    onTranscriptRendered={props.onTranscriptRendered ? callbacks.onTranscriptRendered : undefined}
    onLoadOlderHistory={props.onLoadOlderHistory ? callbacks.onLoadOlderHistory : undefined}
    onOpenCommandBlacklistSettings={props.onOpenCommandBlacklistSettings ? callbacks.onOpenCommandBlacklistSettings : undefined}
  />;
}

export type ChatPanelProps = Props;

export function isSameChatPanelProps(previous: Props, next: Props): boolean {
  if (previous.suspended && next.suspended) return true;
  return previous.activeThreadId === next.activeThreadId
    && previous.turns === next.turns
    && previous.turnsByThreadId === next.turnsByThreadId
    && sameScopedTurnUsage(previous.turns, previous.turnTokenUsage, next.turnTokenUsage)
    && previous.requestTokenUsage === next.requestTokenUsage
    && previous.compactionSourceByTurnId === next.compactionSourceByTurnId
    && previous.threads === next.threads
    && previous.transcriptStore === next.transcriptStore
    && previous.usageStore === next.usageStore
    && shallowArrayEqual(previous.errors, next.errors)
    && previous.pendingRequests === next.pendingRequests
    && previous.pendingAppends === next.pendingAppends
    && previous.threadLoadProgress === next.threadLoadProgress
    && previous.goal === next.goal
    && previous.slashNotice === next.slashNotice
    && sameRequestMonitor(previous.requestMonitor, next.requestMonitor)
    && previous.statsOpen === next.statsOpen
    && (!next.statsOpen || sameStats(previous.stats, next.stats))
    && sameModes(previous.modes, next.modes)
    && previous.waterfallDisplayMode === next.waterfallDisplayMode
    && previous.chatTypography === next.chatTypography
    && previous.assistantUsageDisplay === next.assistantUsageDisplay
    && previous.activeThemePlugin === next.activeThemePlugin
    && previous.welcomeBackgroundImage === next.welcomeBackgroundImage
    && previous.welcomeDismissed === next.welcomeDismissed
    && previous.hasOlderHistory === next.hasOlderHistory
    && previous.loadingOlderHistory === next.loadingOlderHistory
    && previous.initialScrollTop === next.initialScrollTop
    && previous.interactive === next.interactive
    && previous.mobileLayout === next.mobileLayout
    && previous.sessionToken === next.sessionToken
    && previous.hasConfiguredRelays === next.hasConfiguredRelays
    && previous.desktopRuntime === next.desktopRuntime
    && previous.engineStatus === next.engineStatus
    && sameCallbackAvailability(previous, next)
    && previous.t === next.t;
}

const MemoizedChatPanel = memo(ChatPanelImpl, isSameChatPanelProps);

function sameCallbackAvailability(previous: Props, next: Props): boolean {
  const keys: Array<keyof Props> = [
    "onPromptSelect", "onContinueConversation", "onCreateConversation", "onOpenOnboardingSection",
    "onOpenOfficialLogin", "onOpenDiscord", "onSyncFreeModels", "onAgentThreadSelect", "onStatsClose", "onSlashNoticeClose",
    "onAnswerServerRequest", "onGoalEdit", "onGoalStatusChange", "onGoalClear", "onGoalCancel", "onEditUserMessage", "onDeletePendingMessage",
    "onOpenPreview", "onClosePreview", "onTranscriptRendered", "onLoadOlderHistory", "onOpenCommandBlacklistSettings"
  ];
  return keys.every((key) => Boolean(previous[key]) === Boolean(next[key]));
}

export function sameRequestMonitor(previous?: RequestMonitorEntry[], next?: RequestMonitorEntry[]): boolean {
  if (previous === next) return true;
  if (!previous || !next) return (previous?.length ?? 0) === (next?.length ?? 0);
  if (previous.length !== next.length) return false;
  return previous.every((entry, i) => entry.id === next[i]?.id && entry.status === next[i]?.status);
}

function shallowArrayEqual<T>(previous: readonly T[], next: readonly T[]): boolean {
  return previous === next || (previous.length === next.length && previous.every((value, index) => value === next[index]));
}

export function sameModes(previous?: WorkbenchModeState, next?: WorkbenchModeState): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return Object.keys({ ...previous, ...next }).every((key) => previous[key as keyof WorkbenchModeState] === next[key as keyof WorkbenchModeState]);
}

export function sameTokenBreakdown(previous?: TokenUsageBreakdown | null, next?: TokenUsageBreakdown | null): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.totalTokens === next.totalTokens
    && previous.inputTokens === next.inputTokens
    && previous.outputTokens === next.outputTokens
    && previous.cachedInputTokens === next.cachedInputTokens;
}

export function sameStats(previous?: WorkbenchStatsState | null, next?: WorkbenchStatsState | null): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.activeThreadId === next.activeThreadId
    && previous.sessionTurns === next.sessionTurns
    && previous.sessionItems === next.sessionItems
    && previous.threadUsage === next.threadUsage
    && previous.lastTurnUsage === next.lastTurnUsage
    && previous.goal === next.goal
    && previous.projectTurns === next.projectTurns
    && previous.projectThreads === next.projectThreads
    && previous.model === next.model
    && previous.provider === next.provider
    && previous.reasoningEffort === next.reasoningEffort
    && previous.permissionLabel === next.permissionLabel
    && sameModes(previous.modes, next.modes)
    && sameTokenBreakdown(previous.projectUsage, next.projectUsage);
}

export function sameScopedTurnUsage(
  turns: WorkbenchTurn[],
  previous?: Record<string, TokenUsageBreakdown>,
  next?: Record<string, TokenUsageBreakdown>,
): boolean {
  if (previous === next) return true;
  return turns.every((turn) => previous?.[turn.id] === next?.[turn.id]);
}

function ConfiguredQuickActions({
  t,
  canContinue,
  onContinue,
  onCreateConversation,
  onCreateImage
}: {
  t: TranslateFn;
  canContinue: boolean;
  onContinue?: () => void;
  onCreateConversation?: () => void;
  onCreateImage: () => void;
}) {
  const actions = [
    {
      id: "continue",
      icon: <ForumIcon fontSize="small" />,
      title: t("onboarding.ready.continue.title"),
      detail: t("onboarding.ready.continue.detail"),
      disabled: !canContinue,
      onClick: onContinue
    },
    {
      id: "new",
      icon: <AutoAwesomeIcon fontSize="small" />,
      title: t("onboarding.ready.new.title"),
      detail: t("onboarding.ready.new.detail"),
      disabled: false,
      onClick: onCreateConversation
    },
    {
      id: "image",
      icon: <ImageIcon fontSize="small" />,
      title: t("onboarding.ready.image.title"),
      detail: t("onboarding.ready.image.detail"),
      disabled: false,
      onClick: onCreateImage
    }
  ];
  return (
    <Paper
      variant="outlined"
      data-testid="configured-quick-actions"
      sx={{
        p: { xs: 0.85, md: 1 },
        borderRadius: 1.5,
        bgcolor: (theme) => alpha(theme.palette.success.main, theme.palette.mode === "dark" ? 0.11 : 0.06),
        borderColor: (theme) => alpha(theme.palette.success.main, 0.3)
      }}
    >
      <Stack spacing={0.75}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 900, fontSize: 13 }}>
            {t("onboarding.ready.title")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("onboarding.ready.subtitle")}
          </Typography>
        </Box>
        <Box sx={{ display: "grid", gap: 0.75, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" } }}>
          {actions.map((action) => (
            <Button
              key={action.id}
              variant="outlined"
              color="inherit"
              disabled={action.disabled}
              onClick={action.onClick}
              data-testid={`configured-action-${action.id}`}
              sx={{ justifyContent: "flex-start", textAlign: "left", p: 0.85, borderRadius: 1 }}
            >
              <Stack direction="row" spacing={0.85} alignItems="flex-start">
                <Box sx={{ color: "primary.main", display: "flex", mt: 0.1 }}>{action.icon}</Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 850, fontSize: 12 }}>{action.title}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5, lineHeight: 1.2 }}>
                    {action.detail}
                  </Typography>
                </Box>
              </Stack>
            </Button>
          ))}
        </Box>
      </Stack>
    </Paper>
  );
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function OnboardingGuide({
  t,
  windowsDesktop,
  onPromptSelect,
  onOpenSection,
  onOpenOfficialLogin
}: {
  t: TranslateFn;
  windowsDesktop: boolean;
  onPromptSelect?: (text: string) => void;
  onOpenSection?: (section: OnboardingSectionId) => void;
  onOpenOfficialLogin?: () => void;
}) {
  const steps = onboardingSteps(t, windowsDesktop);
  return (
    <Paper
      variant="outlined"
      data-testid="codex-onboarding-guide"
      sx={{
        p: { xs: 0.85, md: 1 },
        borderRadius: 1.5,
        bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.13 : 0.08),
        borderColor: (theme) => alpha(theme.palette.primary.main, 0.32)
      }}
    >
      <Stack spacing={0.75}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ sm: "center" }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 900, lineHeight: 1.15, fontSize: 13 }}>
              {t("onboarding.codex.title")}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.15, fontSize: 11 }}>
              {t("onboarding.codex.subtitle")}
            </Typography>
          </Box>
          <Chip size="small" color="primary" label={t("onboarding.codex.priority")} sx={{ fontWeight: 800, height: 20, fontSize: 11, alignSelf: { xs: "flex-start", sm: "center" } }} />
        </Stack>
        <Box sx={{ display: "grid", gap: 0.75, gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: `repeat(${steps.length}, minmax(0, 1fr))` } }}>
          {steps.map((item) => (
            <Button
              key={item.id}
              variant="outlined"
              color="inherit"
              onClick={() => {
                if (item.isOfficial) {
                  onOpenOfficialLogin?.();
                  return;
                }
                if (item.prompt) {
                  onPromptSelect?.(item.prompt);
                  return;
                }
                if (item.section) {
                  onOpenSection?.(item.section);
                }
              }}
              sx={{
                minHeight: 0,
                justifyContent: "flex-start",
                textAlign: "left",
                p: 0.7,
                borderRadius: 1,
                bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.58 : 0.84),
                borderColor: "divider",
                "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" }
              }}
            >
              <Stack spacing={0.35} sx={{ minWidth: 0, alignItems: "flex-start" }}>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Avatar sx={{ width: 22, height: 22, fontSize: 11, fontWeight: 900, bgcolor: "primary.main" }}>{item.step}</Avatar>
                  <Box sx={{ color: "primary.main", display: "flex" }}>{item.icon}</Box>
                </Stack>
                <Typography sx={{ fontWeight: 850, fontSize: 11.5, lineHeight: 1.15 }}>{item.title}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5, lineHeight: 1.2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {item.detail}
                </Typography>
                <Chip size="small" label={item.action} variant="outlined" sx={{ mt: "auto", height: 18, fontSize: 10, maxWidth: "100%" }} />
              </Stack>
            </Button>
          ))}
        </Box>
      </Stack>
    </Paper>
  );
}

function PendingServerRequestsPanel({
  pendingRequests,
  onAnswerServerRequest
}: {
  pendingRequests: PendingServerRequest[];
  onAnswerServerRequest: (id: string | number, result: JsonValue) => void;
}) {
  return (
    <Paper data-testid="pending-server-requests" variant="outlined" sx={{ p: 1, borderRadius: 1, borderColor: "warning.main", bgcolor: (theme) => alpha(theme.palette.warning.main, theme.palette.mode === "dark" ? 0.12 : 0.08) }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography id="pending-server-requests-title" variant="subtitle2" sx={{ fontWeight: 850, flex: 1 }}>
            Codex needs your input
          </Typography>
          <Chip size="small" color="warning" label={pendingRequests.length} />
        </Stack>
        {pendingRequests.map((request) => {
          const params = asRecord(request.params);
          const questions = requestQuestions(request);
          const requestKey = String(request.id);
          if (isUserInputServerRequest(request)) {
            return (
              <RequestUserInputCard
                key={requestKey}
                request={request}
                questions={questions}
                onAnswer={onAnswerServerRequest}
              />
            );
          }
          if (isApprovalServerRequest(request)) return (
            <Box key={requestKey} sx={{ pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>
                {requestTitle(request)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25, overflowWrap: "anywhere" }}>
                {requestSummary(request, params)}
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.85 }}>
                <Button size="small" variant="contained" onClick={() => onAnswerServerRequest(request.id, buildServerRequestDecisionResponse(request.method, request.params, "accept"))}>
                  Allow
                </Button>
                <Button size="small" variant="outlined" onClick={() => onAnswerServerRequest(request.id, buildServerRequestDecisionResponse(request.method, request.params, "acceptForSession"))}>
                  Allow session
                </Button>
                <Button size="small" color="warning" onClick={() => onAnswerServerRequest(request.id, buildServerRequestDecisionResponse(request.method, request.params, "decline"))}>
                  Decline
                </Button>
                <Button size="small" color="error" onClick={() => onAnswerServerRequest(request.id, buildServerRequestDecisionResponse(request.method, request.params, "cancel"))}>
                  Cancel
                </Button>
              </Stack>
            </Box>
          );
          return (
            <Box key={requestKey} sx={{ pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>
                Unsupported Codex request
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25, overflowWrap: "anywhere" }}>
                {request.method}
              </Typography>
              <Button
                size="small"
                color="error"
                sx={{ mt: 0.85 }}
                onClick={() => onAnswerServerRequest(request.id, buildServerRequestDecisionResponse(request.method, request.params, "cancel"))}
              >
                Cancel
              </Button>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}

function RequestUserInputCard({
  request,
  questions,
  onAnswer
}: {
  request: PendingServerRequest;
  questions: RequestQuestion[];
  onAnswer: (id: string | number, result: JsonValue) => void;
}) {
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string | string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const ready = questions.every((question) => {
    const selected = selectedOptions[question.id];
    const note = notes[question.id]?.trim() ?? "";
    // Official opencode `custom=true`: free text alone is submittable.
    // `custom` absent (legacy Codex) keeps the old option-only behavior.
    if (question.options.length === 0) {
      return Boolean(note);
    }
    if (note && question.custom === true) {
      return true;
    }
    if (question.multiSelect) {
      const list = Array.isArray(selected) ? selected : [];
      return list.length > 0;
    }
    if (typeof selected !== "string" || !selected) {
      return false;
    }
    return selected !== OTHER_ANSWER_LABEL || Boolean(note);
  });

  return (
    <Box data-testid={`request-user-input-${sanitizeTestId(String(request.id))}`} sx={{ pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
      <Typography variant="body2" sx={{ fontWeight: 850 }}>
        {requestTitle(request)}
      </Typography>
      <Stack spacing={1.25} sx={{ mt: 0.85 }}>
        {questions.map((question, index) => {
          const rawSelected = selectedOptions[question.id];
          const multiList = question.multiSelect && Array.isArray(rawSelected) ? rawSelected : [];
          const singleSelected = !question.multiSelect && typeof rawSelected === "string" ? rawSelected : undefined;
          const hasOther = question.multiSelect ? multiList.includes(OTHER_ANSWER_LABEL) : singleSelected === OTHER_ANSWER_LABEL;
          // Official opencode custom=true adds a "type your own answer" box.
          // Absent custom (legacy Codex) preserves option-only behavior.
          const showFreeform = question.options.length === 0 || hasOther || question.custom === true;
          const toggleMulti = (label: string) => {
            setSelectedOptions((current) => {
              const prev = Array.isArray(current[question.id]) ? (current[question.id] as string[]) : [];
              const next = prev.includes(label) ? prev.filter((entry) => entry !== label) : [...prev, label];
              return { ...current, [question.id]: next };
            });
          };
          return (
            <Box key={question.id}>
              <Typography variant="caption" sx={{ display: "block", fontWeight: 850 }}>
                {questions.length > 1 ? `${index + 1}. ` : ""}
                {question.header || question.question}
              </Typography>
              {question.header && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.2 }}>
                  {question.question}
                </Typography>
              )}
              {question.options.length > 0 && (
                <Stack spacing={0.55} sx={{ mt: 0.65 }}>
                  {question.options.map((option) => {
                    const active = question.multiSelect ? multiList.includes(option.label) : singleSelected === option.label;
                    return (
                      <Button
                        key={option.label}
                        size="small"
                        disabled={submitting}
                        variant={active ? "contained" : "outlined"}
                        onClick={() => question.multiSelect ? toggleMulti(option.label) : setSelectedOptions((current) => ({ ...current, [question.id]: option.label }))}
                        sx={{ borderRadius: 1, justifyContent: "flex-start", textAlign: "left", px: 1 }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography component="span" variant="body2" sx={{ display: "block", fontWeight: 800 }}>
                            {question.multiSelect ? `${active ? "☑" : "☐"} ${option.label}` : option.label}
                          </Typography>
                          {option.description && (
                            <Typography
                              component="span"
                              variant="caption"
                              sx={{ display: "block", color: active ? "inherit" : "text.secondary", opacity: active ? 0.86 : 1 }}
                            >
                              {option.description}
                            </Typography>
                          )}
                        </Box>
                      </Button>
                    );
                  })}
                  {question.isOther && (
                    <Button
                      size="small"
                      disabled={submitting}
                      variant={hasOther ? "contained" : "outlined"}
                      onClick={() => question.multiSelect ? toggleMulti(OTHER_ANSWER_LABEL) : setSelectedOptions((current) => ({ ...current, [question.id]: OTHER_ANSWER_LABEL }))}
                      sx={{ borderRadius: 1, justifyContent: "flex-start" }}
                    >
                      Other
                    </Button>
                  )}
                </Stack>
              )}
              {showFreeform && (question.isSecret || question.options.length > 0 ? (
                <TextField
                  fullWidth
                  size="small"
                  disabled={submitting}
                  type={question.isSecret ? "password" : "text"}
                  label={question.options.length > 0 ? "Other answer" : "Your answer"}
                  value={notes[question.id] ?? ""}
                  onChange={(event) => setNotes((current) => ({ ...current, [question.id]: event.target.value }))}
                  autoComplete="off"
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ mt: 0.65 }}
                />
              ) : (
                <Box
                  component="textarea"
                  aria-label="Your answer"
                  rows={3}
                  disabled={submitting}
                  value={notes[question.id] ?? ""}
                  onChange={(event) => setNotes((current) => ({ ...current, [question.id]: event.target.value }))}
                  sx={{
                    display: "block",
                    width: "100%",
                    height: 72,
                    mt: 0.65,
                    p: 1,
                    boxSizing: "border-box",
                    resize: "none",
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                    bgcolor: "background.paper",
                    color: "text.primary",
                    font: "inherit",
                    "&:focus": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -1 }
                  }}
                />
              ))}
            </Box>
          );
        })}
      </Stack>
      <Stack direction="row" spacing={0.75} sx={{ mt: 1 }}>
        <Button
          size="small"
          variant="contained"
          disabled={!ready || submitting}
          onClick={() => {
            setSubmitting(true);
            onAnswer(request.id, buildUserInputResponse(questions, selectedOptions, notes));
          }}
        >
          {submitting ? "Submitting..." : "Submit"}
        </Button>
        <Button
          size="small"
          color="error"
          disabled={submitting}
          onClick={() => {
            setSubmitting(true);
            onAnswer(request.id, { answers: {} });
          }}
        >
          Cancel
        </Button>
      </Stack>
    </Box>
  );
}

const OTHER_ANSWER_LABEL = "Other";

function buildUserInputResponse(
  questions: RequestQuestion[],
  selected: Record<string, string | string[]>,
  notes: Record<string, string>
): JsonValue {
  const answers: Record<string, JsonValue> = {};
  questions.forEach((question) => {
    const answerList: JsonValue[] = [];
    const rawSelected = selected[question.id];
    const selectedList = Array.isArray(rawSelected) ? rawSelected : (rawSelected ? [rawSelected] : []);
    const note = notes[question.id]?.trim();
    for (const entry of selectedList) {
      if (entry === OTHER_ANSWER_LABEL) continue;
      answerList.push(entry);
    }
    // Custom free text rides the same `user_note:` channel opencode accepts
    // as a plain string answer (official `answers: string[][]`).
    if (note && (selectedList.includes(OTHER_ANSWER_LABEL) || selectedList.length === 0 || question.custom === true)) {
      if (!answerList.some((entry) => entry === `user_note: ${note}`)) {
        answerList.push(`user_note: ${note}`);
      }
    }
    answers[question.id] = { answers: answerList };
  });
  return { answers };
}

type RequestQuestion = {
  id: string;
  header: string;
  question: string;
  multiSelect: boolean;
  isOther: boolean;
  isSecret: boolean;
  // Mirrors official opencode `custom` (default true). False hides free input.
  custom?: boolean;
  options: Array<{ label: string; description: string }>;
};

function requestQuestions(request: PendingServerRequest): RequestQuestion[] {
  const params = asRecord(request.params);
  const questions: unknown[] = Array.isArray(params.questions) ? params.questions : [];
  return questions.flatMap((entry: unknown) => {
    const question = asRecord(entry);
    const id = stringValue(question.id);
    if (!id) {
      return [];
    }
    const options = Array.isArray(question.options)
      ? (question.options as unknown[]).flatMap((option: unknown) => {
          if (typeof option === "string") return option.trim() ? [{ label: option, description: "" }] : [];
          const optionRecord = asRecord(option);
          const label = stringValue(optionRecord.label);
          return label ? [{ label, description: stringValue(optionRecord.description) ?? "" }] : [];
        })
      : [];
    return [
      {
        id,
        header: stringValue(question.header) ?? "",
        question: stringValue(question.question) ?? id,
        multiSelect: question.multiSelect === true || question.is_multi_select === true || question.isMultiSelect === true,
        isOther: question.isOther === true,
        isSecret: question.isSecret === true,
        custom: question.custom === true ? true : (question.custom === false ? false : undefined),
        options
      }
    ];
  });
}

function requestTitle(request: PendingServerRequest): string {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval":
      return "Command approval";
    case "item/fileChange/requestApproval":
    case "applyPatchApproval":
      return "File change approval";
    case "item/permissions/requestApproval":
      return "Permission request";
    case "item/tool/requestUserInput":
      return "Choose an option";
    default:
      return request.method;
  }
}

function requestSummary(request: PendingServerRequest, params: Record<string, unknown>): string {
  const command = stringValue(params.command) ?? (Array.isArray(params.command) ? params.command.map(String).join(" ") : undefined);
  const cwd = stringValue(params.cwd);
  const reason = stringValue(params.reason);
  const grantRoot = stringValue(params.grantRoot);
  const parts = [command, cwd ? `cwd ${cwd}` : undefined, grantRoot ? `root ${grantRoot}` : undefined, reason].filter((part): part is string => Boolean(part));
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  return JSON.stringify(request.params ?? {}, null, 2);
}

function RequestMonitorTable({ entries, t }: { entries: RequestMonitorEntry[]; t: TranslateFn }) {
  return (
    <Paper
      data-testid="homepage-request-monitor"
      variant="outlined"
      sx={{
        borderRadius: 1,
        overflow: "hidden",
        bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.58 : 0.78)
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.25, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <AssessmentIcon fontSize="small" color="primary" />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
            {t("chat.requests")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("chat.requestsSubtitle")}
          </Typography>
        </Box>
        <Chip size="small" label={t("chat.requestsTracked", { count: entries.length })} />
      </Stack>
      {entries.length === 0 ? (
        <Box sx={{ px: 1.25, py: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            {t("chat.requestsEmpty")}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Box
            component="table"
            sx={{
              width: "100%",
              minWidth: 720,
              borderCollapse: "collapse",
              "& th, & td": {
                px: 1.25,
                py: 0.85,
                borderBottom: "1px solid",
                borderColor: "divider",
                textAlign: "left",
                verticalAlign: "middle"
              },
              "& th": {
                typography: "caption",
                color: "text.secondary",
                fontWeight: 800,
                bgcolor: "action.hover"
              },
              "& td": {
                typography: "body2"
              },
              "& tr:last-of-type td": {
                borderBottom: 0
              }
            }}
          >
            <thead>
              <tr>
                <th>{t("chat.request")}</th>
                <th>{t("chat.source")}</th>
                <th>{t("chat.status")}</th>
                <th>{t("chat.requestModel")}</th>
                <th>{t("chat.lastTokens")}</th>
                <th>{t("chat.totalTokens")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <Typography variant="body2" sx={{ fontWeight: 750, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.id}
                    </Typography>
                  </td>
                  <td>
                    <Chip size="small" label={entry.source} variant="outlined" />
                  </td>
                  <td>
                    <VisibleStatusChip status={entry.status} color={entry.status === "failed" ? "error" : entry.status === "inProgress" ? "warning" : "default"} />
                  </td>
                  <td>
                    <Typography variant="body2" sx={{ maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.model || t("chat.engineDefault")}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.provider || t("chat.default")}
                    </Typography>
                  </td>
                  <td>{formatUsageCell(entry.lastTokens, t)}</td>
                  <td>{formatUsageCell(entry.totalTokens, t)}</td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      )}
    </Paper>
  );
}

function formatUsageCell(usage: TokenUsageBreakdown | undefined, t: TranslateFn): string {
  if (!usage) {
    return t("chat.waiting");
  }
  return `${formatNumber(usage.totalTokens)} total / ${formatNumber(usage.outputTokens)} out`;
}

function VisibleStatusChip({
  status,
  color = "default"
}: {
  status?: string;
  color?: "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning";
}) {
  if (!status || isSilentStatus(status)) {
    return null;
  }
  return <Chip size="small" label={status} color={color} />;
}

function agentTooltipTitle(agent: AgentSession): string {
  return agent.status && !isSilentStatus(agent.status) ? `${agent.name} - ${agent.status}` : agent.name;
}

const EMPTY_WORKBENCH_TURNS: WorkbenchTurn[] = [];

/**
 * P1 memo-chain stabilization. The upstream map is rebuilt whenever the turns
 * array identity changes (every notification batch), which used to invalidate
 * the whole ChatPanel memo cascade even when background subagent threads were
 * the only thing streaming. Reuse the previous Map (and per-thread buckets)
 * when element identities are unchanged so the active thread's chain holds.
 */
function useStableTurnsByThreadId(map: Map<string, WorkbenchTurn[]>): Map<string, WorkbenchTurn[]> {
  const ref = useRef<{ source: Map<string, WorkbenchTurn[]>; stable: Map<string, WorkbenchTurn[]> } | null>(null);
  return useMemo(() => {
    const prev = ref.current?.stable;
    if (prev && prev !== map) {
      let same = prev.size === map.size;
      if (same) {
        for (const [key, bucket] of map) {
          const prevBucket = prev.get(key);
          if (prevBucket === bucket) continue;
          if (!prevBucket || prevBucket.length !== bucket.length) { same = false; break; }
          for (let i = 0; i < bucket.length; i++) {
            if (prevBucket[i] !== bucket[i]) { same = false; break; }
          }
          if (!same) break;
        }
      }
      if (same) {
        ref.current = { source: map, stable: prev };
        return prev;
      }
      const merged = new Map<string, WorkbenchTurn[]>();
      for (const [key, bucket] of map) {
        const prevBucket = prev.get(key);
        merged.set(
          key,
          prevBucket && prevBucket.length === bucket.length && prevBucket.every((turn, index) => turn === bucket[index])
            ? prevBucket
            : bucket
        );
      }
      ref.current = { source: map, stable: merged };
      return merged;
    }
    const stable = prev ?? map;
    ref.current = { source: map, stable };
    return stable;
  }, [map]);
}

function buildAgentSessions(activeTurns: WorkbenchTurn[], threads: ThreadEntry[], activeThreadId: string | null, turnsByThreadId: Map<string, WorkbenchTurn[]>): AgentSession[] {
  if (!activeThreadId) {
    return [];
  }
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const loadedThreadIds = new Set(turnsByThreadId.keys());
  const candidates: AgentSession[] = [];

  threads
    .filter((thread) => thread.parentThreadId === activeThreadId)
    .forEach((thread, index) => {
      candidates.push({
        id: thread.id,
        threadId: thread.id,
        name: agentThreadName(thread, index),
        role: thread.agentRole,
        status: normalizeAgentStatus(thread.status),
        source: "thread",
        loaded: loadedThreadIds.has(thread.id)
      });
    });

  activeTurns.forEach((turn) => {
    turn.items.forEach((item) => {
      if (item.type === "collabAgentToolCall") {
        const itemRecord = item as unknown as Record<string, unknown>;
        const payload = isRecord(item.payload) ? item.payload : itemRecord;
        const agentStates = isRecord(payload.agentsStates)
          ? payload.agentsStates
          : (isRecord(itemRecord.agentsStates) ? itemRecord.agentsStates as Record<string, unknown> : {});
        const receiverThreadIds = asStringArray(payload.receiverThreadIds).length > 0
          ? asStringArray(payload.receiverThreadIds)
          : asStringArray(itemRecord.receiverThreadIds);
        const ids = receiverThreadIds.length > 0 ? receiverThreadIds : Object.keys(agentStates);
        ids.forEach((threadId, index) => {
          const thread = threadById.get(threadId);
          const state = isRecord(agentStates[threadId]) ? agentStates[threadId] : {};
          candidates.push({
            id: threadId,
            threadId,
            name: thread ? agentThreadName(thread, index) : agentFallbackName(threadId, candidates.length),
            role: thread?.agentRole ?? stringValue(payload.tool),
            status: normalizeAgentStatus(stringValue(state.status) ?? item.status),
            source: "collab",
            loaded: loadedThreadIds.has(threadId)
          });
        });
      }
      if (item.type === "subAgentActivity") {
        const payload = isRecord(item.payload) ? item.payload : {};
        const threadId = stringValue(payload.agentThreadId) ?? item.agentThreadId;
        if (threadId) {
          const thread = threadById.get(threadId);
          candidates.push({
            id: threadId,
            threadId,
            name: thread ? agentThreadName(thread, candidates.length) : stringValue(payload.agentPath) ?? `Agent ${candidates.length + 1}`,
            role: thread?.agentRole ?? stringValue(payload.agentPath),
            status: normalizeAgentStatus(stringValue(payload.kind)),
            source: "activity",
            loaded: loadedThreadIds.has(threadId)
          });
        }
      }
      if (item.agentId || item.agentThreadId) {
        const id = item.agentId ?? item.agentThreadId;
        if (id) {
          candidates.push({
            id,
            threadId: item.agentThreadId,
            name: item.agentName ?? item.agentRole ?? agentFallbackName(id, candidates.length),
            role: item.agentRole,
            status: normalizeAgentStatus(item.agentStatus ?? item.status),
            source: "message",
            loaded: Boolean(item.agentThreadId && loadedThreadIds.has(item.agentThreadId))
          });
        }
      }
    });
  });

  // One physical agent surfaces through several sources with different ids:
  // child threads use the thread UUID, collab payloads use receiver thread
  // ids, sub-agent activity uses agentThreadId, and generic message items fall
  // back to item.agentId. Union-find groups those aliases so a logical agent
  // renders exactly one icon instead of one entry per id form.
  const parentId = new Map<string, string>();
  function find(id: string): string {
    const parent = parentId.get(id);
    if (!parent || parent === id) return id;
    const root = find(parent);
    parentId.set(id, root);
    return root;
  }
  function union(a: string, b: string): void {
    if (a === b) return;
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parentId.set(rootB, rootA);
  }
  for (const candidate of candidates) {
    find(candidate.id);
    if (candidate.threadId) {
      find(candidate.threadId);
      union(candidate.id, candidate.threadId);
    }
  }

  const byRoot = new Map<string, AgentSession[]>();
  for (const candidate of candidates) {
    const root = find(candidate.id);
    const bucket = byRoot.get(root) ?? [];
    bucket.push(candidate);
    byRoot.set(root, bucket);
  }

  const sessions: AgentSession[] = [];
  for (const bucket of byRoot.values()) {
    // Prefer a known child-thread UUID as the canonical identity so later
    // sources merge into the same entry regardless of arrival order.
    const canonicalThreadId = bucket.find((entry) => entry.threadId && threadById.has(entry.threadId))?.threadId
      ?? bucket.find((entry) => entry.threadId)?.threadId;
    const canonicalId = canonicalThreadId ?? bucket[0]!.id;
    let merged: AgentSession | undefined;
    for (const candidate of bucket) {
      const next = { ...candidate, id: canonicalId };
      merged = merged
        ? {
            ...merged,
            ...next,
            threadId: next.threadId ?? merged.threadId,
            name: mergeAgentName(merged.name, next.name),
            role: next.role ?? merged.role,
            status: mergeAgentStatus(merged.status, next.status),
            loaded: Boolean(next.loaded || merged.loaded),
            source: merged.source
          }
        : next;
    }
    if (merged) sessions.push(merged);
  }

  return sessions.map((session) => {
    const threadTurns = session.threadId ? turnsByThreadId.get(session.threadId) ?? [] : [];
    const latestTurnStatus = threadTurns.at(-1)?.status ? normalizeAgentStatus(threadTurns.at(-1)!.status) : undefined;
    if (!latestTurnStatus) return session;
    // Live activity outranks a terminal event: an out-of-order or replayed
    // terminal notification must not fold a still-running agent into
    // "completed", while a genuinely finished thread must not stay "running".
    if (threadTurns.some((turn) => isRunningTurnStatus(turn.status))) return { ...session, status: "running" };
    return { ...session, status: latestTurnStatus };
  });
}

function mergeAgentName(existing: string | undefined, next: string | undefined): string {
  if (existing && isGenericAgentName(next) && !isGenericAgentName(existing)) {
    return existing;
  }
  return next || existing || "Agent";
}

function isGenericAgentName(value: string | undefined): boolean {
  return !value || /^Agent(?: \d+)?$/.test(value);
}

function agentFallbackName(id: string, index: number): string {
  const readable = id
    .replace(/^agent[-_]?/i, "")
    .replace(/[-_]?thread$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!readable || readable === id) {
    return `Agent ${index + 1}`;
  }
  return readable.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const MAIN_CONVERSATION_ITEM_FILTER = (item: WorkbenchItem) => !item.agentId && !item.agentThreadId;

function mainConversationRows(
  turns: WorkbenchTurn[],
  activeThreadId: string | null,
  turnTokenUsage: Record<string, TokenUsageBreakdown>,
  cache: ReturnType<typeof createIncrementalChatRowsCache>,
  compactionSourceByTurnId: Record<string, CompactionSourceDetail>,
  requestTokenUsage: Record<string, Record<string, TokenUsageBreakdown>>,
  threadBackend?: string
): ChatWaterfallRow[] {
  const visibleTurns = activeThreadId ? orderWorkbenchTurns(turns.filter((turn) => turn.threadId === activeThreadId)) : [];
  return buildIncrementalChatRows(visibleTurns, cache, {
    cacheKey: activeThreadId ?? "no-thread",
    filterItem: MAIN_CONVERSATION_ITEM_FILTER,
    tokenUsageByTurnId: turnTokenUsage,
    requestUsageByTurnId: requestTokenUsage,
    threadBackend,
    compactionSourceByTurnId
  });
}

function agentConversationRows(turns: WorkbenchTurn[], activeThreadId: string | null, agent: AgentSession, turnTokenUsage: Record<string, TokenUsageBreakdown>, compactionSourceByTurnId: Record<string, CompactionSourceDetail>, requestTokenUsage: Record<string, Record<string, TokenUsageBreakdown>>): ChatWaterfallRow[] {
  const visibleTurns = orderWorkbenchTurns(turns.map((turn) => {
    if (agent.threadId && turn.threadId === agent.threadId) {
      return turn;
    }
    if (turn.threadId !== activeThreadId) {
      return { ...turn, items: [] };
    }
    return { ...turn, items: turn.items.filter((item) => itemBelongsToAgent(item, agent)) };
  }));
  return buildChatRows(visibleTurns, undefined, turnTokenUsage, compactionSourceByTurnId, requestTokenUsage);
}

function hasThreadActivity(turns: WorkbenchTurn[], activeThreadId: string | null): boolean {
  const visibleTurns = activeThreadId ? turns.filter((turn) => turn.threadId === activeThreadId) : [];
  return visibleTurns.some((turn) => turn.items.length > 0);
}

function itemBelongsToAgent(item: WorkbenchItem, agent: AgentSession): boolean {
  const ids = new Set([agent.id, agent.threadId].filter((value): value is string => Boolean(value)));
  return itemReferencesAgent(item, ids);
}

function agentThreadName(thread: ThreadEntry, index: number): string {
  return thread.agentNickname ?? thread.agentRole ?? thread.preview ?? `Agent ${index + 1}`;
}

function normalizeAgentStatus(value?: string): string | undefined {
  switch (value) {
    case "started":
    case "interacted":
    case "inProgress":
    case "pendingInit":
      return "running";
    case "errored":
    case "notFound":
      return "failed";
    default:
      return value;
  }
}

function mergeAgentStatus(current?: string, next?: string): string | undefined {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return agentStatusRank(next) >= agentStatusRank(current) ? next : current;
}

function agentStatusRank(status: string): number {
  if (["failed", "errored", "notFound"].includes(status)) return 5;
  if (["completed", "shutdown", "done", "success"].includes(status)) return 4;
  if (status === "interrupted") return 3;
  if (["running", "inProgress", "started", "interacted"].includes(status)) return 2;
  return 1;
}

function isTerminalAgentStatus(status?: string): boolean {
  return Boolean(status && ["completed", "shutdown", "done", "success", "failed", "errored", "notFound"].includes(status));
}

function isActiveAgentStatus(status?: string): boolean {
  const normalized = status?.replace(/[_-]+/g, "").trim().toLowerCase();
  return Boolean(normalized && ["active", "running", "inprogress", "started", "interacted", "pendinginit", "working"].includes(normalized));
}

function isCurrentlyActiveAgent(agent: AgentSession, activeTurns: WorkbenchTurn[], turnsByThreadId: Map<string, WorkbenchTurn[]>): boolean {
  if (isTerminalAgentStatus(agent.status)) {
    return false;
  }
  const childThreadIds = new Set([agent.id, agent.threadId].filter((value): value is string => Boolean(value)));
  const childTurns = [...childThreadIds].flatMap((threadId) => turnsByThreadId.get(threadId) ?? []);
  const latestChildTurn = childTurns.at(-1);
  if (latestChildTurn) {
    if (isTerminalAgentStatus(latestChildTurn.status)) return false;
    if (isActiveAgentStatus(latestChildTurn.status)) return true;
  }
  if (isActiveAgentStatus(agent.status)) return true;
  return activeTurns.some((turn) =>
    isActiveAgentStatus(turn.status) &&
    turn.items.some((item) => itemReferencesAgent(item, childThreadIds) && !isTerminalAgentStatus(item.agentStatus ?? item.status))
  );
}

function itemReferencesAgent(item: WorkbenchItem, agentIds: Set<string>): boolean {
  if ((item.agentId && agentIds.has(item.agentId)) || (item.agentThreadId && agentIds.has(item.agentThreadId))) {
    return true;
  }
  const itemRecord = item as unknown as Record<string, unknown>;
  const payload = isRecord(item.payload) ? item.payload : itemRecord;
  const referencedIds = [
    ...asStringArray(payload.receiverThreadIds),
    ...asStringArray(itemRecord.receiverThreadIds),
    stringValue(payload.agentThreadId),
    stringValue(payload.receiverThreadId),
    stringValue(itemRecord.agentThreadId),
    stringValue(itemRecord.receiverThreadId),
  ].filter((value): value is string => Boolean(value));
  if (referencedIds.some((id) => agentIds.has(id))) {
    return true;
  }
  const agentStates = isRecord(payload.agentsStates)
    ? payload.agentsStates
    : (isRecord(itemRecord.agentsStates) ? itemRecord.agentsStates as Record<string, unknown> : {});
  return Object.keys(agentStates).some((id) => agentIds.has(id));
}

function isSilentStatus(status: string): boolean {
  return ["completed", "complete", "done", "success", "shutdown"].includes(status.trim().toLowerCase());
}

function railButtonSx(active: boolean) {
  return {
    width: { xs: 38, sm: 44 },
    height: { xs: 38, sm: 44 },
    borderRadius: 2,
    border: "1px solid",
    borderColor: active ? "primary.main" : "divider",
    bgcolor: active ? "action.selected" : "background.paper",
    boxShadow: active ? "0 0 0 3px rgba(25, 118, 210, 0.14)" : "none",
    "&:hover": {
      bgcolor: "action.hover"
    }
  };
}

function agentAvatarColor(index: number): string {
  const colors = ["primary.main", "secondary.main", "success.main", "warning.main", "info.main"] as const;
  return colors[index % colors.length] ?? "primary.main";
}

function agentInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "A";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function sanitizeTestId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-");
}

function isRenderableImageUrl(url: string): boolean {
  return url.startsWith("data:image/") || url.startsWith("blob:") || url.startsWith("http://") || url.startsWith("https://");
}

function renderMcpToolCall(item: { payload?: unknown }) {
  const payload = isRecord(item.payload) ? item.payload : null;
  if (!payload) {
    return null;
  }
  const server = stringValue(payload.server);
  const tool = stringValue(payload.tool);
  const args = "arguments" in payload ? payload.arguments : undefined;
  const result = isRecord(payload.result) ? payload.result : null;
  const errorMessage = payload.error == null ? undefined : formatErrorText(payload.error);

  return (
    <Box sx={{ mt: 1, pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
        {server && <Chip size="small" label={server} />}
        {tool && <Chip size="small" label={tool} />}
        <VisibleStatusChip status={stringValue(payload.status)} />
        {typeof payload.durationMs === "number" && <Chip size="small" label={`${payload.durationMs}ms`} />}
      </Stack>
      {args != null && (
        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Arguments
          </Typography>
          <Typography component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, m: 0, mt: 0.5 }}>
            {prettyJson(args)}
          </Typography>
        </Box>
      )}
      {errorMessage && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {errorMessage}
        </Alert>
      )}
      {result && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            Result
          </Typography>
          {result.content != null && (
            <Typography component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, m: 0, mt: 0.5 }}>
              {prettyJson(result.content)}
            </Typography>
          )}
          {result.structuredContent != null && (
            <Typography component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, m: 0, mt: 0.5 }}>
              {prettyJson(result.structuredContent)}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function formatErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error)) {
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = error[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
      if (isRecord(value)) {
        return formatErrorText(value);
      }
    }
    return prettyJson(error);
  }
  return String(error);
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
