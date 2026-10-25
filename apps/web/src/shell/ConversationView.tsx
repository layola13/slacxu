import { Box } from "@mui/material";
import { lazy } from "react";
import type { ComponentProps, Dispatch, MouseEvent as ReactMouseEvent, ReactNode, SetStateAction } from "react";
import type { AuthSession, JsonValue, PermissionPresetId } from "@codex-ui/shared";
import { TopicConversationBoundary } from "../app/transcripts/TopicConversationBoundary";
import { runningTurnsForThread } from "../app/transcripts/topicRuntimeIndex";
import type { ThreadHistoryPageState } from "../app/threads/threadHistoryService";
import { EMPTY_ERRORS, EMPTY_PENDING_APPENDS, EMPTY_PENDING_REQUESTS, EMPTY_REQUEST_MONITOR } from "../app/workbench/appConstants";
import type { DetachedTaskSnapshot, SlashCommandNotice } from "../app/workbench/appConstants";
import { findLastTurnUsage } from "../app/workbench/appUtils";
import { ChatPanel, type GoalBannerState, type GoalStatus, type WorkbenchModeState, type WorkbenchStatsState } from "../components/ChatPanel";
import type { SettingsSectionId } from "../settings/SettingsDrawer";
import type { CodexPluginSettingsTab } from "../components/CodexPluginSettingsPanel";
import { applyWaterfallDisplayMode, buildChatRows, selectTurnsForWaterfallMode, type WaterfallDisplayMode } from "../waterfall/chatRows";
import type { ChatTokenUsage, ChatWaterfallRow } from "../waterfall/types";
import type { TranslateFn } from "../i18n";
import type { ClientState, PendingServerRequest, ThreadEntry, WorkbenchTurn } from "../state/codexClient";
import { orderWorkbenchTurns } from "../state/workbenchTimeline";
import type { WebPreviewState } from "../webPreview";
import type { WorkspaceLayoutState } from "../taskTabs";

const ChatGptShell = lazy(async () => {
  const module = await import("../components/chatgpt-shell/ChatGptShell");
  return { default: module.ChatGptShell };
});

type ChatPanelProps = ComponentProps<typeof ChatPanel>;
type BoundaryProps = ComponentProps<typeof TopicConversationBoundary>;

export interface ConversationViewProps {
  threadId: string | null;
  focused: boolean;
  threadGoals: Record<string, GoalBannerState>;
  workspaceLayout: WorkspaceLayoutState | null;
  setPaneContextMenu: Dispatch<SetStateAction<{ paneId: string; threadId: string; mouseX: number; mouseY: number } | null>>;
  topicTranscriptStore: BoundaryProps["transcriptStore"];
  usageStore: BoundaryProps["usageStore"];
  statsPanelScope: "status" | "stats" | null;
  statsState: WorkbenchStatsState;
  state: ClientState;
  themeMode: string;
  cwdForThread: (threadId: string | null) => string | null;
  openSettings: (section?: SettingsSectionId, pluginTab?: CodexPluginSettingsTab, relayTarget?: { providerId?: string; groupId?: string }) => void;
  respondToServerRequest: (id: string | number, result: JsonValue) => void;
  loadOlderThreadHistory: (threadId: string) => Promise<void>;
  undoWaterfallFileChanges: (rows: ChatWaterfallRow[]) => Promise<unknown>;
  reviewWaterfallFileChanges: (rows: ChatWaterfallRow[]) => void;
  renderComposerDock: (official?: boolean) => ReactNode;
  compactionSourceByTurnId: ChatPanelProps["compactionSourceByTurnId"];
  modeState: WorkbenchModeState;
  activeThemePlugin: ChatPanelProps["activeThemePlugin"];
  welcomeBackgroundImage: ChatPanelProps["welcomeBackgroundImage"];
  welcomeDismissed: boolean;
  showAssistantUsageDetails: boolean;
  waterfallDisplayMode: WaterfallDisplayMode;
  chatTypography: ChatPanelProps["chatTypography"];
  pendingAppends: ChatPanelProps["pendingAppends"];
  threadLoadProgress: ChatPanelProps["threadLoadProgress"];
  authSession: AuthSession | null;
  slashNotice: SlashCommandNotice | null;
  requestMonitor: ChatPanelProps["requestMonitor"];
  isMobile: boolean;
  t: TranslateFn;
  usePromptSuggestion: ChatPanelProps["onPromptSelect"];
  latestHistoryThread: ThreadEntry | null;
  openExistingThread: (threadId: string) => Promise<unknown>;
  requestNewSession: (nextPermission: PermissionPresetId) => void;
  permission: PermissionPresetId;
  handleOpenCommandBlacklistSettings: () => void;
  setOfficialLoginOpen: Dispatch<SetStateAction<boolean>>;
  openDiscordInvite: () => void;
  setFreeModelAccessOpen: Dispatch<SetStateAction<boolean>>;
  loadThreadIntoCache: (threadId: string) => Promise<unknown>;
  setStatsPanelScope: Dispatch<SetStateAction<"status" | "stats" | null>>;
  setSlashNotice: Dispatch<SetStateAction<SlashCommandNotice | null>>;
  setComposerSuggestion: Dispatch<SetStateAction<{ id: string; text: string } | null>>;
  setActiveGoalStatus: (status: GoalStatus) => Promise<unknown>;
  clearActiveGoal: () => Promise<unknown>;
  cancelActiveGoal: () => Promise<unknown>;
  editLastUserMessage: (threadId: string, turnId: string, text: string) => void;
  deletePendingMessage: ChatPanelProps["onDeletePendingMessage"];
  openBrowserPreview: ChatPanelProps["onOpenPreview"];
  webPreview: WebPreviewState | null;
  closeWebPreview: () => void;
  finishThreadLoadProgress: ChatPanelProps["onTranscriptRendered"];
  detachedTaskSnapshot: DetachedTaskSnapshot | null;
  threadHistoryPages: Record<string, ThreadHistoryPageState>;
}

export function ConversationView({
  threadId,
  focused,
  threadGoals,
  workspaceLayout,
  setPaneContextMenu,
  topicTranscriptStore,
  usageStore,
  statsPanelScope,
  statsState,
  state,
  themeMode,
  cwdForThread,
  openSettings,
  respondToServerRequest,
  loadOlderThreadHistory,
  undoWaterfallFileChanges,
  reviewWaterfallFileChanges,
  renderComposerDock,
  compactionSourceByTurnId,
  modeState,
  activeThemePlugin,
  welcomeBackgroundImage,
  welcomeDismissed,
  showAssistantUsageDetails,
  waterfallDisplayMode,
  chatTypography,
  pendingAppends,
  threadLoadProgress,
  authSession,
  slashNotice,
  requestMonitor,
  isMobile,
  t,
  usePromptSuggestion,
  latestHistoryThread,
  openExistingThread,
  requestNewSession,
  permission,
  handleOpenCommandBlacklistSettings,
  setOfficialLoginOpen,
  openDiscordInvite,
  setFreeModelAccessOpen,
  loadThreadIntoCache,
  setStatsPanelScope,
  setSlashNotice,
  setComposerSuggestion,
  setActiveGoalStatus,
  clearActiveGoal,
  cancelActiveGoal,
  editLastUserMessage,
  deletePendingMessage,
  openBrowserPreview,
  webPreview,
  closeWebPreview,
  finishThreadLoadProgress,
  detachedTaskSnapshot,
  threadHistoryPages,
}: ConversationViewProps) {

    const threadGoal = threadId ? threadGoals[threadId] ?? null : null;
    // Split-view must keep both panes mounted: `focused` only controls input
    // ownership (composer/callbacks/stats), not visibility. Unmounting the
    // background pane (previous perf shortcut) made dual-pane collapse to a
    // single visible window. Background panes stay read-only: heavy props are
    // already gated to EMPTY_* below and ChatWaterfall skips auto-scroll when
    // interactive=false.
    return (
      <Box data-testid={focused && !workspaceLayout ? "conversation-context-surface" : undefined} sx={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0 }} onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
        if (!focused || workspaceLayout || !threadId) return;
        event.preventDefault();
        setPaneContextMenu({ paneId: "pane-1", threadId, mouseX: event.clientX, mouseY: event.clientY });
      }}>
      <TopicConversationBoundary transcriptStore={topicTranscriptStore} usageStore={usageStore} topicId={threadId}>
      {({ transcript: panelTurns, usage: topicUsage }, conversationStores) => {
        // Keep the secondary pane mounted so split view remains visible, but
        // only project that pane's own transcript. Rendering every loaded
        // thread/subagent in both waterfalls was the perf regression that led
        // to the old one-pane shortcut.
        const visibleTurns = focused
          ? panelTurns.turns
          : panelTurns.turns.filter((turn: WorkbenchTurn) => turn.threadId === threadId);
        const visibleTurnsByThreadId = focused
          ? panelTurns.turnsByThreadId
          : new Map(threadId ? [[threadId, visibleTurns]] : []);
        const visibleThreads = focused
          ? panelTurns.threads
          : panelTurns.threads.filter((entry: ThreadEntry) => entry.id === threadId || entry.parentThreadId === threadId);
        const isStatsOpen = focused && Boolean(statsPanelScope);
        let threadStats: WorkbenchStatsState | null = null;
        if (isStatsOpen) {
          const threadTurns = threadId ? panelTurns.turnsByThreadId.get(threadId) ?? [] : [];
          threadStats = {
            ...statsState,
            activeThreadId: threadId,
            sessionTurns: threadTurns.length,
            sessionItems: threadTurns.reduce((total: number, turn: WorkbenchTurn) => total + turn.items.length, 0),
            threadUsage: topicUsage.threadUsage,
            lastTurnUsage: findLastTurnUsage(threadTurns, topicUsage.turnUsage),
            goal: threadGoal
          };
        }

        const activePendingRequests = focused
          ? (threadId ? state.pendingRequests.filter((r: PendingServerRequest) => !r.threadId || r.threadId === threadId) : state.pendingRequests)
          : EMPTY_PENDING_REQUESTS;

        if (themeMode === "chatgpt") {
          const chatgptTurns = threadId
            ? orderWorkbenchTurns(visibleTurns.filter((turn: WorkbenchTurn) => turn.threadId === threadId))
            : [];
          const chatgptSelected = selectTurnsForWaterfallMode(chatgptTurns, waterfallDisplayMode);
          const chatgptUsage = topicUsage.turnUsage as Record<string, ChatTokenUsage>;
          const chatgptBuilt = buildChatRows(chatgptSelected, undefined, chatgptUsage);
          const chatgptRows = applyWaterfallDisplayMode(chatgptBuilt, waterfallDisplayMode).rows;
          const chatgptRunning = runningTurnsForThread(panelTurns.turns, threadId).length > 0;
          return (
            <ChatGptShell
              rows={chatgptRows}
              activeThreadId={threadId}
              running={chatgptRunning}
              cwd={cwdForThread(threadId) ?? ""}
              goalLabel={threadGoal?.objective ?? null}
              pendingRequests={activePendingRequests}
              hasOlderHistory={Boolean(threadId && threadHistoryPages[threadId]?.nextCursor)}
              loadingOlderHistory={Boolean(threadId && threadHistoryPages[threadId]?.loading)}
              t={t}
              onOpenSettings={focused ? () => openSettings("appearance") : undefined}
              onAnswerServerRequest={(id: string | number, response: Record<string, unknown>) => void respondToServerRequest(id, response as unknown as Parameters<typeof respondToServerRequest>[1])}
              onLoadOlderHistory={threadId ? () => void loadOlderThreadHistory(threadId) : undefined}
              onUndoFileChanges={focused ? (rows: ChatWaterfallRow[]) => void undoWaterfallFileChanges(rows) : undefined}
              onReviewFileChanges={focused ? reviewWaterfallFileChanges : undefined}
              composer={focused ? renderComposerDock(true) : undefined}
            />
          );
        }

        return (
      <ChatPanel
        turns={visibleTurns}
        turnsByThreadId={visibleTurnsByThreadId}
        turnTokenUsage={focused ? topicUsage.turnUsage : {}}
        requestTokenUsage={focused ? topicUsage.requestUsage : {}}
        compactionSourceByTurnId={compactionSourceByTurnId}
        threads={visibleThreads}
        transcriptStore={conversationStores.transcriptStore}
        usageStore={conversationStores.usageStore}
        activeThreadId={threadId}
        errors={focused ? state.errors : EMPTY_ERRORS}
        pendingRequests={activePendingRequests}
        goal={threadGoal}
        slashNotice={focused ? slashNotice : null}
        stats={threadStats}
        requestMonitor={focused ? requestMonitor : EMPTY_REQUEST_MONITOR}
        statsOpen={isStatsOpen}
        modes={{ ...modeState, goalActive: Boolean(threadGoal) }}
        activeThemePlugin={activeThemePlugin}
        welcomeBackgroundImage={welcomeBackgroundImage}
        welcomeDismissed={welcomeDismissed}
        assistantUsageDisplay={showAssistantUsageDetails ? "details" : "summary"}
        waterfallDisplayMode={waterfallDisplayMode}
        chatTypography={chatTypography}
        pendingAppends={focused ? pendingAppends : EMPTY_PENDING_APPENDS}
        threadLoadProgress={threadLoadProgress?.threadId === threadId ? threadLoadProgress : null}
        desktopRuntime={authSession?.desktopRuntime}
        engineStatus={state.engine}
        sessionToken={state.token}
        mobileLayout={isMobile}
        hasConfiguredRelays={state.providers.length > 0}
        t={t}
        onPromptSelect={focused ? usePromptSuggestion : undefined}
        onContinueConversation={focused && latestHistoryThread ? () => void openExistingThread(latestHistoryThread.id) : undefined}
        onCreateConversation={focused ? () => requestNewSession(permission) : undefined}
        onOpenOnboardingSection={focused ? (section: "relay" | "members") => openSettings(section) : undefined}
        onOpenCommandBlacklistSettings={focused ? handleOpenCommandBlacklistSettings : undefined}
        onOpenOfficialLogin={focused ? () => setOfficialLoginOpen(true) : undefined}
        onOpenDiscord={focused ? openDiscordInvite : undefined}
        onSyncFreeModels={focused ? async () => { setFreeModelAccessOpen(true); } : undefined}
        onAgentThreadSelect={(agentThreadId: string) => {
          if (topicTranscriptStore.hasThreadTranscript(agentThreadId)) return;
          const release = topicTranscriptStore.retainThreadTranscript(agentThreadId);
          void loadThreadIntoCache(agentThreadId);
          // Bridge only the click-to-subscription commit. Keeping this retain
          // until queued IO completed made every rapidly visited child reduce
          // full live transcripts while it waited behind the load queue.
          globalThis.setTimeout(release, 0);
        }}
        onStatsClose={focused ? () => setStatsPanelScope(null) : undefined}
        onSlashNoticeClose={focused ? () => setSlashNotice(null) : undefined}
        onAnswerServerRequest={respondToServerRequest}
        onGoalEdit={focused ? () => setComposerSuggestion({ id: `goal-edit-${Date.now()}`, text: threadGoal ? `/goal ${threadGoal.objective}` : "/goal " }) : undefined}
        onGoalStatusChange={focused ? (status: GoalStatus) => void setActiveGoalStatus(status) : undefined}
        onGoalClear={focused ? () => void clearActiveGoal() : undefined}
        onGoalCancel={focused ? () => void cancelActiveGoal() : undefined}
        onEditUserMessage={focused ? (editThreadId: string, editTurnId: string, text: string) => editLastUserMessage(editThreadId, editTurnId, text) : undefined}
        onDeletePendingMessage={focused ? deletePendingMessage : undefined}
        onOpenPreview={focused ? openBrowserPreview : undefined}
        webPreview={focused ? webPreview : null}
        onClosePreview={focused ? closeWebPreview : undefined}
        onTranscriptRendered={finishThreadLoadProgress}
        onLoadOlderHistory={loadOlderThreadHistory}
        hasOlderHistory={Boolean(threadId && threadHistoryPages[threadId]?.nextCursor)}
        loadingOlderHistory={Boolean(threadId && threadHistoryPages[threadId]?.loading)}
        initialScrollTop={focused ? detachedTaskSnapshot?.scrollTop : undefined}
        interactive={focused}
      />
        );
      }}
      </TopicConversationBoundary>
      </Box>
    );
}
