import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { type ChatTypographyPreference, DEFAULT_CHAT_TYPOGRAPHY } from "../../chatTypography";
import { type PendingAppendMessage, type RequestMonitorEntry, type ThreadLoadProgress, type ThreadTokenUsageState, type TokenUsageBreakdown } from "../../components/ChatPanel";
import { type HistoryThreadUsageSummary } from "../../history/HistorySidebar";
import { RightWorkspaceTab } from "../../components/RightWorkspacePanel";
import { type WaterfallDisplayMode } from "../../waterfall/chatRows";
import { type AgentReadinessResult, type CodexCliUpdateStatus, type ComposerImageAttachment, type ComposerMention, type LocalWorkspaceInfo, type SocketConnectionStatus, type ThreadEntry, type WorkbenchTurn } from "../../state/codexClient";
import { createTaskNotificationTracker, readTaskNotificationPreferences } from "../../taskNotifications";
import { createWorkspaceLayout } from "../../taskTabs";
import { defaultLocalWorkspacePath, joinWorkspacePath } from "../../workspacePaths";
import { useCliBackendPlugins } from "../cli/useCliBackendPlugins";
import { useCliPrerequisites } from "../cli/useCliPrerequisites";
import { PendingSendGate } from "../../composer/PendingSendGate";
import { useJevAutoNudgeOwner } from "../jev/useJevAutoNudgeOwner";
import { ThreadLoadQueue } from "../threads/ThreadLoadQueue";
import { isRunningTurnStatus } from "../transcripts/topicRuntimeIndex";
import { indexTurnsByThread } from "../transcripts/transcriptProjection";
import { useTopicTranscriptRuntime } from "../transcripts/useTopicTranscriptRuntime";
import { InterruptTurnGate } from "../turnInterruptRetry";
import { type TurnRetryState, resolveTurnRetryState } from "../turnRetryState";
import { TopicUsageStore } from "../usage/topicUsageStore";
import { DEFAULT_NEW_CHAT_CWD, DangerDialogIntent, INITIAL_SOCKET_CONNECTION_STATUS, PlanImplementationPrompt, SlashCommandNotice, StartCodexTurnOptions, UI_STORAGE_KEYS, WorkspaceMode } from "./appConstants";
import { readPanelLayout, readStoredBoolean, readStoredString, readWaterfallDisplayMode } from "./preferenceUtils";
import { useHistoryState } from "./useHistoryState";
import { useImmersiveComposer } from "./useImmersiveComposer";
import { useMembersAdmin } from "./useMembersAdmin";
import { useSessionState } from "./useSessionState";
import { useSshWorkspace } from "./useSshWorkspace";
import { useTaskTabsState } from "./useTaskTabsState";
import { useThemePluginActions } from "./useThemePluginActions";
import { useWebPreview } from "./useWebPreview";
import { useWorkspacePicker } from "./useWorkspacePicker";
import { useOpenFileTabs } from "../workspace/useOpenFileTabs";
import { FREE_OLLAMA_ENABLED, type JsonValue, type ProviderConfig, type ThreadAgentRoster } from "@codex-ui/shared";

import type { AppProps } from "./appConstants";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";

export function useAccessRuntime(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  themeMode: AppProps["themeMode"];
  customThemePlugins: AppProps["customThemePlugins"];
  onThemeModeChange: AppProps["onThemeModeChange"];
  onCustomThemePluginsChange: AppProps["onCustomThemePluginsChange"];
  detachedThreadId: string | null;
}) {
  const { state, dispatch, themeMode, customThemePlugins, onThemeModeChange, onCustomThemePluginsChange, detachedThreadId } = input;
  const { authStatus, setAuthStatus, authSession, setAuthSession, loginError, setLoginError, loginSubmitting, setLoginSubmitting, authSessionRef } = useSessionState();
  const [connectionStatus, setConnectionStatus] = useState<SocketConnectionStatus>(INITIAL_SOCKET_CONNECTION_STATUS);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const {
    cliPrerequisiteScreenEnabled,
    cliPrerequisitesComplete,
    cliPrerequisitesBlocked,
    markCliPrerequisitesComplete,
  } = useCliPrerequisites();
  const { members, setMembers, membersLoading, setMembersLoading, membersError, setMembersError, reloadMembers, handleCreateMember, handleUpdateMember, handleDeleteMember, handleAllocateMemberBalance } = useMembersAdmin({ state, authSession, setAuthSession });
  const [dangerBypassConfirmed, setDangerBypassConfirmed] = useState(false);
  const [dangerDialogIntent, setDangerDialogIntent] = useState<DangerDialogIntent | null>(null);
  const [dangerDialogAcknowledged, setDangerDialogAcknowledged] = useState(false);
  const [settingAssistantProviderId, setSettingAssistantProviderId] = useState<string>(() => readStoredString(UI_STORAGE_KEYS.settingAssistantProviderId, ""));
  const [settingAssistantModel, setSettingAssistantModel] = useState<string>(() => readStoredString(UI_STORAGE_KEYS.settingAssistantModel, ""));
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("local");
  const [workspaceAgentsBusy, setWorkspaceAgentsBusy] = useState(false);
  const [cwd, setCwd] = useState(DEFAULT_NEW_CHAT_CWD);
  const [additionalRoots, setAdditionalRoots] = useState<string[]>([]);
  const [workspaceFilePath, setWorkspaceFilePath] = useState<string | null>(null);
  const [newChatAdditionalRootsExpanded, setNewChatAdditionalRootsExpanded] = useState(false);
  const { workspacePickerPurpose, setWorkspacePickerPurpose, workspacePickerOpen, setWorkspacePickerOpen, workspacePickerPath, setWorkspacePickerPath } = useWorkspacePicker();
  const [workspaceSelectionPending, setWorkspaceSelectionPending] = useState(true);
  const [workspaceNewFolderName, setWorkspaceNewFolderName] = useState("");
  const {
    sshCommand,
    setSshCommand,
    sshCwd,
    setSshCwd,
    sshPreflightIssue,
    setSshPreflightIssue,
    sshInstallConfirming,
    setSshInstallConfirming,
    sshInstallBusy,
    setSshInstallBusy,
    sshInstallError,
    setSshInstallError,
    sshConfigHosts,
    setSshConfigHosts,
    sshConfigHostAlias,
    setSshConfigHostAlias,
    sshConfigHostsLoading,
    setSshConfigHostsLoading,
    sshConfigHostProbing,
    setSshConfigHostProbing,
    sshConfigProbeError,
    setSshConfigProbeError,
    sshDetectedHome,
    setSshDetectedHome,
    sshHostListRequestRef,
    sshHostProbeRequestRef,
    selectSshConfigHost,
  } = useSshWorkspace({ state, workspaceMode, setWorkspacePickerPath });
  const [workspaceCreateBusy, setWorkspaceCreateBusy] = useState(false);
  const [localWorkspaceInfo, setLocalWorkspaceInfo] = useState<LocalWorkspaceInfo | null>(null);
  const [newChatSetupOpen, setNewChatSetupOpen] = useState(false);
  const [newChatBudgetLimit, setNewChatBudgetLimit] = useState("");
  const [planImplementationPrompt, setPlanImplementationPrompt] = useState<PlanImplementationPrompt | null>(null);
  const handledPlanImplementationIdsRef = useRef(new Set<string>());
  const [statsPanelScope, setStatsPanelScope] = useState<"status" | "stats" | null>(null);
  const [slashNotice, setSlashNotice] = useState<SlashCommandNotice | null>(null);
  const [codexCliUpdateStatus, setCodexCliUpdateStatus] = useState<CodexCliUpdateStatus | null>(null);
  const [codexCliUpdateDialogOpen, setCodexCliUpdateDialogOpen] = useState(false);
  const [codexCliUpdateBusy, setCodexCliUpdateBusy] = useState(false);
  const [codexCliUpdateError, setCodexCliUpdateError] = useState<string | null>(null);
  const [freeModelNotice, setFreeModelNotice] = useState<string | null>(null);
  const [pendingAppends, setPendingAppends] = useState<PendingAppendMessage[]>([]);
  // Keeps the conversation visibly working between an accepted send and the
  // delayed turn/started notification (some history turns return no turn id).
  const [pendingAcceptedThreads, setPendingAcceptedThreads] = useState<Set<string>>(() => new Set());
  // A new thread has no id until thread/start resolves, so retain a small
  // creation hold to prevent the empty workspace from reporting Ready while
  // the first user request is already being created remotely.
  const [pendingNewConversationCount, setPendingNewConversationCount] = useState(0);
  const pendingSendGateRef = useRef(new PendingSendGate());
  const interruptTurnGateRef = useRef(new InterruptTurnGate());
  const composerWatchReactivationRef = useRef(0);
  const [turnRetryState, setTurnRetryState] = useState<TurnRetryState | null>(null);
  const turnRetryStateRef = useRef<TurnRetryState | null>(null);
  turnRetryStateRef.current = turnRetryState;
  const applyTurnRetryState = useCallback((next: TurnRetryState | null | ((current: TurnRetryState | null) => TurnRetryState | null)) => {
    setTurnRetryState((current: TurnRetryState | null) => {
      const resolved = resolveTurnRetryState(current, next);
      turnRetryStateRef.current = resolved;
      return resolved;
    });
  }, []);
  const modelCapacityRetryRef = useRef(new Map<string, {
    attempt: number;
    max: number;
    timer: number | null;
    failedTurnId?: string;
    retryTurnId?: string;
    prompt?: string;
    exhausted: boolean;
    lastFailureTurnId?: string;
    lastError?: string;
    details?: string;
    errorTurnIds: Set<string>;
  }>());
  const lastCodexActivityAtRef = useRef(Date.now());
  const [threadTokenUsage, setThreadTokenUsage] = useState<Record<string, ThreadTokenUsageState>>({});
  const threadUsagePublishTimerRef = useRef<number | null>(null);
  const threadUsagePublishBusyRef = useRef(false);
  const threadUsagePublishPendingRef = useRef<Record<string, ThreadTokenUsageState> | null>(null);
  const usageStoreRef = useRef<TopicUsageStore | null>(null);
  if (!usageStoreRef.current) usageStoreRef.current = new TopicUsageStore();
  const usageStore = usageStoreRef.current;
  const flushThreadTokenUsage = useCallback(() => {
    if (threadUsagePublishBusyRef.current) return;
    const next = threadUsagePublishPendingRef.current;
    if (!next) return;
    threadUsagePublishPendingRef.current = null;
    threadUsagePublishBusyRef.current = true;
    startTransition(() => {
      setThreadTokenUsage({ ...next });
    });
  }, []);
  useLayoutEffect(() => {
    if (!threadUsagePublishBusyRef.current) return;
    threadUsagePublishBusyRef.current = false;
    if (threadUsagePublishPendingRef.current && threadUsagePublishTimerRef.current === null) {
      threadUsagePublishTimerRef.current = window.setTimeout(() => {
        threadUsagePublishTimerRef.current = null;
        flushThreadTokenUsage();
      }, 0);
    }
  }, [flushThreadTokenUsage, threadTokenUsage]);
  useEffect(() => () => {
    if (threadUsagePublishTimerRef.current !== null) {
      window.clearTimeout(threadUsagePublishTimerRef.current);
      threadUsagePublishTimerRef.current = null;
    }
  }, []);
  const { threadLoadProgress, setThreadLoadProgress, historySearchTerm, setHistorySearchTerm, historyLoading, setHistoryLoading, historyLoadProgress, setHistoryLoadProgress, historyDateRange, setHistoryDateRange, historyViewMode, setHistoryViewMode, historyBackendFilter, setHistoryBackendFilter, historyBackendFilterUserTouchedRef, threadHistoryPages, setThreadHistoryPages, allHistoryThreadsRef, historySearchTermRef, historyLoadRequestRef, historyFullyLoadedRef, initialHistoryListStartedRef, threadHistoryPagesRef } = useHistoryState();
  // they do, the filter follows the active conversation's CLI backend so a
  // Claude thread is never silently filed under the Codex list.
  return {
    authStatus,
    setAuthStatus,
    authSession,
    setAuthSession,
    loginError,
    setLoginError,
    loginSubmitting,
    setLoginSubmitting,
    authSessionRef,
    connectionStatus,
    setConnectionStatus,
    connectionEpoch,
    setConnectionEpoch,
    cliPrerequisiteScreenEnabled,
    cliPrerequisitesComplete,
    cliPrerequisitesBlocked,
    markCliPrerequisitesComplete,
    members,
    setMembers,
    membersLoading,
    setMembersLoading,
    membersError,
    setMembersError,
    reloadMembers,
    handleCreateMember,
    handleUpdateMember,
    handleDeleteMember,
    handleAllocateMemberBalance,
    dangerBypassConfirmed,
    setDangerBypassConfirmed,
    dangerDialogIntent,
    setDangerDialogIntent,
    dangerDialogAcknowledged,
    setDangerDialogAcknowledged,
    settingAssistantProviderId,
    setSettingAssistantProviderId,
    settingAssistantModel,
    setSettingAssistantModel,
    workspaceMode,
    setWorkspaceMode,
    workspaceAgentsBusy,
    setWorkspaceAgentsBusy,
    cwd,
    setCwd,
    additionalRoots,
    setAdditionalRoots,
    workspaceFilePath,
    setWorkspaceFilePath,
    newChatAdditionalRootsExpanded,
    setNewChatAdditionalRootsExpanded,
    workspacePickerPurpose,
    setWorkspacePickerPurpose,
    workspacePickerOpen,
    setWorkspacePickerOpen,
    workspacePickerPath,
    setWorkspacePickerPath,
    workspaceSelectionPending,
    setWorkspaceSelectionPending,
    workspaceNewFolderName,
    setWorkspaceNewFolderName,
    sshCommand,
    setSshCommand,
    sshCwd,
    setSshCwd,
    sshPreflightIssue,
    setSshPreflightIssue,
    sshInstallConfirming,
    setSshInstallConfirming,
    sshInstallBusy,
    setSshInstallBusy,
    sshInstallError,
    setSshInstallError,
    sshConfigHosts,
    setSshConfigHosts,
    sshConfigHostAlias,
    setSshConfigHostAlias,
    sshConfigHostsLoading,
    setSshConfigHostsLoading,
    sshConfigHostProbing,
    setSshConfigHostProbing,
    sshConfigProbeError,
    setSshConfigProbeError,
    sshDetectedHome,
    setSshDetectedHome,
    sshHostListRequestRef,
    sshHostProbeRequestRef,
    selectSshConfigHost,
    workspaceCreateBusy,
    setWorkspaceCreateBusy,
    localWorkspaceInfo,
    setLocalWorkspaceInfo,
    newChatSetupOpen,
    setNewChatSetupOpen,
    newChatBudgetLimit,
    setNewChatBudgetLimit,
    planImplementationPrompt,
    setPlanImplementationPrompt,
    handledPlanImplementationIdsRef,
    statsPanelScope,
    setStatsPanelScope,
    slashNotice,
    setSlashNotice,
    codexCliUpdateStatus,
    setCodexCliUpdateStatus,
    codexCliUpdateDialogOpen,
    setCodexCliUpdateDialogOpen,
    codexCliUpdateBusy,
    setCodexCliUpdateBusy,
    codexCliUpdateError,
    setCodexCliUpdateError,
    freeModelNotice,
    setFreeModelNotice,
    pendingAppends,
    setPendingAppends,
    pendingAcceptedThreads,
    setPendingAcceptedThreads,
    pendingNewConversationCount,
    setPendingNewConversationCount,
    pendingSendGateRef,
    interruptTurnGateRef,
    composerWatchReactivationRef,
    turnRetryState,
    setTurnRetryState,
    turnRetryStateRef,
    applyTurnRetryState,
    modelCapacityRetryRef,
    lastCodexActivityAtRef,
    threadTokenUsage,
    setThreadTokenUsage,
    threadUsagePublishTimerRef,
    threadUsagePublishBusyRef,
    threadUsagePublishPendingRef,
    usageStoreRef,
    usageStore,
    flushThreadTokenUsage,
    threadLoadProgress,
    setThreadLoadProgress,
    historySearchTerm,
    setHistorySearchTerm,
    historyLoading,
    setHistoryLoading,
    historyLoadProgress,
    setHistoryLoadProgress,
    historyDateRange,
    setHistoryDateRange,
    historyViewMode,
    setHistoryViewMode,
    historyBackendFilter,
    setHistoryBackendFilter,
    historyBackendFilterUserTouchedRef,
    threadHistoryPages,
    setThreadHistoryPages,
    allHistoryThreadsRef,
    historySearchTermRef,
    historyLoadRequestRef,
    historyFullyLoadedRef,
    initialHistoryListStartedRef,
    threadHistoryPagesRef,
  };
}
