import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ComposerCoreInput } from "./composerCoreContext";
import type { DangerDialogIntent, WorkspaceMode } from "./appConstants";
import type { ThreadLoadProgress } from "../../components/ChatPanel";
import type { HistoryBackendFilter } from "../../history/HistorySidebar";
import type { LocalWorkspaceInfo } from "../../state/codexClient";
import type { GoalLifecycle } from "../goals/useGoalLifecycle";
import type { ThreadRuntimeSelectionsDomain } from "../runtime/useThreadRuntimeSelections";
import {
  createSaVmPolicyWithIdeTools,
  loadWorkspaceVmPolicy,
  recordRecentWorkspace,
  saveWorkspaceVmPolicy,
  type RecentWorkspaceItem,
} from "../../utils/recentWorkspaces";
import type { ChannelGroupConfig, JsonValue, PermissionPresetId, ProviderConfig } from "@codex-ui/shared";
import { fetchWorkspaceSaVmStatus, updateThreadWorkspaceMetadata, writeCodeWorkspaceFile, type ThreadEntry } from "../../state/codexClient";
import { asRecord, errorMessage, formatErrorText, stringValue, syncWorkspaceFromThread } from "./appUtils";
import { hasConfiguredProviderCredential, isAvailableRelayGroup, relayGroupSelectableModels } from "../../groupCollection";
import { isSshWorkspaceCommand, normalizeSshWorkspaceCwd } from "./sshUtils";
import { joinWorkspacePath, normalizeWorkspaceCwd, normalizeWorkspaceRoots, resolveTildeWorkspacePath } from "../../workspacePaths";
import { openTaskTab } from "../../taskTabs";
import { displayThreadTitle } from "../threads/threadCatalog";
import { modelSelectionMatches } from "./modelSelectionUtils";
import { runtimeSelectionFallbackForThread, type LoadedThreadRuntimeSelection } from "../runtime/useThreadRuntimeSelections";
import { shouldRenderCachedTranscript } from "../../threadSelection";
import { DEFAULT_CLI_BACKEND } from "../cli/cliPlugins";
import type { GoalBannerState } from "../../components/ChatPanel";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useNewSessionFlow(input: ComposerCoreInput & {
  dangerDialogIntent: DangerDialogIntent | null;
  setWorkspaceSelectionPending: Dispatch<SetStateAction<boolean>>;
  setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
  setCwd: Dispatch<SetStateAction<string>>;
  setSshCommand: Dispatch<SetStateAction<string>>;
  setSshCwd: Dispatch<SetStateAction<string>>;
  setAdditionalRoots: Dispatch<SetStateAction<string[]>>;
  setWorkspaceFilePath: Dispatch<SetStateAction<string | null>>;
  setWorkspacePickerPath: Dispatch<SetStateAction<string>>;
  setWelcomeDismissed: Dispatch<SetStateAction<boolean>>;
  setThreadLoadProgress: Dispatch<SetStateAction<ThreadLoadProgress | null>>;
  setDangerBypassConfirmed: Dispatch<SetStateAction<boolean>>;
  threadSelectionEpochRef: MutableRefObject<number>;
  newChatDefaultsAppliedRef: MutableRefObject<boolean>;
  selectedModelRef: MutableRefObject<string>;
  historyBackendFilterUserTouchedRef: MutableRefObject<boolean>;
  verifySshWorkspaceBeforeCreate: (modeOverride?: WorkspaceMode) => Promise<boolean>;
  historyBackendFilter: HistoryBackendFilter;
  loadThread: (threadId: string, selectionEpoch?: number) => Promise<boolean>;
  newChatBudgetLimit: string;
  setNewChatBudgetLimit: Dispatch<SetStateAction<string>>;
  localWorkspaceInfo: LocalWorkspaceInfo | null;
  workspaceHostPlatform: string | undefined;
  updateThreadLoadProgress: (threadId: string, progress: number, label: string) => void;
  setWorkspaceAgentsBusy: Dispatch<SetStateAction<boolean>>;
  sshCwd: string;
} & Pick<ThreadRuntimeSelectionsDomain, "updateRuntimeSelectionAndPersist" | "setRuntimePermission" | "updateRuntimeSelection"> & Pick<GoalLifecycle, "loadThreadGoal" | "freezeActiveGoalBeforeResume"> & {
  promptGoalResume: GoalLifecycle["promptResume"];
  resetGoalResume: GoalLifecycle["resetResume"];
}) {
  const {
    state, dispatch, client, t, runtimeSelection, workspaceMode, cwd, sshCommand,
    additionalRoots, workspaceFilePath, workspaceSelectionPending, localWorkspaceDefaultPath,
    activeProviderId, activeGroupId, selectedModel, reasoningEffort, reasoningOptions,
    permission, isClaudeBackend, isAgyBackend, isGrokBackend, isPiBackend, isOpencodeBackend,
    fastModeEnabled, dangerBypassPermissionConfirmed, enablePlanAutoContinuation, codexConfig,
    freebuffSession, freebuffAutoFailover, refreshFreebuffSession, ensureRuntimeProviderActivated,
    refreshProviders, applyHistoryThreads, loadAuditEvents, resumeThreadAutoNudge, cwdForThread,
    activeThreadIdRef, allHistoryThreadsRef, turnsRef, activatedProviderSelectionRef,
    pendingSendGateRef, interruptTurnGateRef, startCodexTurnInFlightRef, planContinuationTimersRef,
    writerConflictThreadIdsRef, contextWindowByTurnIdRef, pendingContextWindowByThreadRef,
    optimisticThreadIdsRef, splitMutationEpochRef, topicTranscriptStore, setPendingAppends,
    setPendingAcceptedThreads, setClosedTaskTabIds, setTaskTabOrder, setSplitView,
    setWorkspaceLayout, setComposerSuggestion, setDangerDialogAcknowledged, setDangerDialogIntent,
    setFreebuffFallbackSuggestion, setFreebuffSwitchDialogOpen, setFreebuffSwitchTargetModel,
    setNewChatSetupOpen, setOfficialLoginNotice, setOfficialLoginOpen, setPendingNewConversationCount,
    setSlashNotice, setSshInstallConfirming, setSshInstallError, setSshPreflightIssue,
    selectionForThread, patchThreadRuntimeSelection, persistThreadRuntimeSelection,
    loadPersistedThreadRuntimeSelection, updateNewConversationRuntimeSelection, setSelectedModel,
  } = input;
  const {
    dangerDialogIntent, setWorkspaceSelectionPending, setWorkspaceMode, setCwd, setSshCommand,
    setSshCwd, setAdditionalRoots, setWorkspaceFilePath, setWorkspacePickerPath, setWelcomeDismissed,
    setThreadLoadProgress, setDangerBypassConfirmed, threadSelectionEpochRef, newChatDefaultsAppliedRef,
    selectedModelRef, historyBackendFilterUserTouchedRef, verifySshWorkspaceBeforeCreate,
    historyBackendFilter, loadThread, newChatBudgetLimit, setNewChatBudgetLimit, localWorkspaceInfo,
    workspaceHostPlatform, updateThreadLoadProgress, setWorkspaceAgentsBusy,
    updateRuntimeSelectionAndPersist, setRuntimePermission, updateRuntimeSelection, historySelectionForThread, sshCwd, loadThreadGoal, freezeActiveGoalBeforeResume,
    promptGoalResume, resetGoalResume,
  } = input;
  const applyWorkspaceVmPolicyForCwd = useCallback((targetPath: string) => {
    if (!targetPath || workspaceMode === "ssh") return;
    const saved = loadWorkspaceVmPolicy(targetPath);
    if (saved) {
      updateNewConversationRuntimeSelection({
        vmEnabled: saved.vmEnabled,
        vmPolicy: saved.vmPolicy
      });
      updateRuntimeSelection({
        vmEnabled: saved.vmEnabled,
        vmPolicy: saved.vmPolicy
      });
      return;
    }
    if (state.token) {
      void fetchWorkspaceSaVmStatus(state.token, targetPath).then((status: { hasSkill: boolean; skillPath: string | null; }) => {
        if (status.hasSkill) {
          const policy = createSaVmPolicyWithIdeTools();
          saveWorkspaceVmPolicy(targetPath, true, policy);
          updateNewConversationRuntimeSelection({
            vmEnabled: true,
            vmPolicy: policy
          });
          updateRuntimeSelection({
            vmEnabled: true,
            vmPolicy: policy
          });
        }
      }).catch(() => {});
    }
  }, [state.token, updateNewConversationRuntimeSelection, updateRuntimeSelection, workspaceMode]);

  const handleSelectRecentWorkspace = useCallback((item: RecentWorkspaceItem) => {
    if (item.mode === "ssh") {
      setWorkspaceMode("ssh");
      setSshCwd(item.path);
      setWorkspacePickerPath(item.path);
      if (item.sshCommand) {
        setSshCommand(item.sshCommand);
      }
    } else {
      // Stored memories may predate the absolute-path default ("~/.opencode").
      // Resolve against the server home so selecting one never reintroduces "~".
      const resolved = resolveTildeWorkspacePath(item.path, localWorkspaceInfo?.home, workspaceHostPlatform);
      setWorkspaceMode("local");
      setCwd(resolved);
      setWorkspacePickerPath(resolved);
      applyWorkspaceVmPolicyForCwd(resolved);
    }
  }, [applyWorkspaceVmPolicyForCwd, localWorkspaceInfo?.home, workspaceHostPlatform]);

  const persistPermissionForActiveThread = useCallback(
    (nextPermission: PermissionPresetId) => {
      const threadId = activeThreadIdRef.current;
      if (!threadId) return;
      const selection = selectionForThread(threadId);
      void persistThreadRuntimeSelection({
        threadId,
        providerId: selection.providerId,
        groupId: selection.groupId,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        permission: nextPermission,
        vmEnabled: selection.vmEnabled,
        vmPolicy: selection.vmPolicy
      }).catch((error: unknown) => {
        dispatch({ type: "error", message: errorMessage("Permission save", error) });
      });
    },
    [persistThreadRuntimeSelection, selectionForThread]
  );

  const openExistingThread = useCallback(
    async (threadId: string) => {
      const selectionEpoch = ++threadSelectionEpochRef.current;
      setTaskTabOrder((current: string[]) => openTaskTab(current, threadId));
      setClosedTaskTabIds((current: string[]) => current.filter((id: string) => id !== threadId));
      let transcriptLoaded = false;
      const thread = state.threads.find((entry: ThreadEntry) => entry.id === threadId);
      resetGoalResume();
      const hasCachedTranscript = topicTranscriptStore.hasThreadTranscript(threadId);
      activeThreadIdRef.current = threadId;
      if (hasCachedTranscript) {
        setThreadLoadProgress(null);
        setWelcomeDismissed(false);
        syncWorkspaceFromThread(thread ?? null, setCwd, setWorkspaceSelectionPending, setWorkspaceMode, setSshCommand, setSshCwd, setAdditionalRoots, setWorkspaceFilePath);
        dispatch({ type: "activeThread", threadId });
        transcriptLoaded = true;
        // Warm transcripts still need their per-conversation runtime metadata.
        // Load it independently so switching back cannot briefly inherit the
        // new-chat permission/model while the cached transcript is rendered.
        void loadPersistedThreadRuntimeSelection(
          threadId,
          runtimeSelectionFallbackForThread(thread, historySelectionForThread(threadId))
        ).then((selection: LoadedThreadRuntimeSelection) => {
          if (activeThreadIdRef.current !== threadId) return;
          const persistedCwd = normalizeWorkspaceCwd(selection.cwd ?? "");
          const workspaceCwd = persistedCwd || thread?.sshCwd?.trim() || thread?.cwd?.trim() || "";
          if (!workspaceCwd) return;
          setAdditionalRoots(normalizeWorkspaceRoots(workspaceCwd, selection.additionalRoots ?? thread?.additionalRoots ?? []));
          setWorkspaceFilePath(thread?.workspaceMode === "ssh" ? null : selection.workspaceFilePath ?? null);
          if (thread?.workspaceMode === "ssh") return;
          setCwd(workspaceCwd);
          setWorkspaceMode("local");
          setWorkspaceSelectionPending(false);
          if (!selection.vmPolicy && workspaceCwd) {
            const workspaceVm = loadWorkspaceVmPolicy(workspaceCwd);
            if (workspaceVm?.vmPolicy) {
              patchThreadRuntimeSelection(threadId, {
                vmEnabled: workspaceVm.vmEnabled,
                vmPolicy: workspaceVm.vmPolicy
              });
            }
          }
        });
        // A warm transcript was already opened during this app session. Switching
        // back must only select the retained external-store projection. Replaying
        // the full transcript through the reducer, provider activation,
        // thread/resume, or history reads duplicates waterfall work.
        void loadThreadGoal(threadId);
        return;
      }
      const updateOpenProgress = (progress: number, label: string) => {
        if (!hasCachedTranscript) updateThreadLoadProgress(threadId, progress, label);
      };
      if (!hasCachedTranscript) {
        setThreadLoadProgress({
          threadId,
          title: thread ? displayThreadTitle(thread) : "Conversation",
          label: "Preparing conversation",
          progress: 8
        });
      }
      try {
        // Opening history is strictly read-only. Only an explicit user send may
        // materialize the Codex thread and acquire its writer lease.
        updateOpenProgress(10, "Reading stored transcript");
        if (!hasCachedTranscript) {
          transcriptLoaded = await loadThread(threadId, selectionEpoch);
          if (!transcriptLoaded || selectionEpoch !== threadSelectionEpochRef.current || activeThreadIdRef.current !== threadId) return;
        }
        setThreadLoadProgress((current: ThreadLoadProgress | null) => current?.threadId === threadId ? null : current);
        updateOpenProgress(12, "Freezing persisted goal");
        void freezeActiveGoalBeforeResume(threadId)
          .then((goal: GoalBannerState | null) => {
            if (!goal || selectionEpoch !== threadSelectionEpochRef.current || activeThreadIdRef.current !== threadId) return;
            setThreadLoadProgress((current: ThreadLoadProgress | null) => current?.threadId === threadId ? null : current);
            promptGoalResume(threadId, goal);
          })
          .catch((error: unknown) => console.warn("[goal resume] background freeze failed", formatErrorText(error)));
        const fallbackSelection = runtimeSelectionFallbackForThread(thread, historySelectionForThread(threadId));
        const targetSelection = await loadPersistedThreadRuntimeSelection(threadId, fallbackSelection);
        if (selectionEpoch !== threadSelectionEpochRef.current || activeThreadIdRef.current !== threadId) return;
        const persistedCwd = normalizeWorkspaceCwd(targetSelection.cwd ?? "");
        const historyThread = thread
          ?? allHistoryThreadsRef.current.find((entry: ThreadEntry) => entry.id === threadId);
        if (persistedCwd && historyThread?.workspaceMode !== "ssh") {
          setCwd(persistedCwd);
          setAdditionalRoots(normalizeWorkspaceRoots(persistedCwd, targetSelection.additionalRoots ?? historyThread?.additionalRoots ?? []));
          setWorkspaceFilePath(targetSelection.workspaceFilePath ?? null);
          setWorkspaceMode("local");
          setWorkspaceSelectionPending(false);
          if (!targetSelection.vmPolicy) {
            const workspaceVm = loadWorkspaceVmPolicy(persistedCwd);
            if (workspaceVm?.vmPolicy) {
              patchThreadRuntimeSelection(threadId, {
                vmEnabled: workspaceVm.vmEnabled,
                vmPolicy: workspaceVm.vmPolicy
              });
            }
          }
        }
      } catch (error) {
        dispatch({ type: "error", message: errorMessage("Open thread", error) });
      } finally {
        if (shouldRenderCachedTranscript({
          hasCachedTranscript,
          selectionEpoch,
          currentEpoch: threadSelectionEpochRef.current,
          threadId,
          activeThreadId: activeThreadIdRef.current
        })) {
          transcriptLoaded = true;
          updateThreadLoadProgress(threadId, 92, "Rendering conversation");
        }
      }
    },
    [freezeActiveGoalBeforeResume, historySelectionForThread, loadPersistedThreadRuntimeSelection, loadThread, loadThreadGoal, promptGoalResume, resetGoalResume, state.threads, topicTranscriptStore, updateThreadLoadProgress]
  );

  const beginNewSession = useCallback((nextPermission: PermissionPresetId) => {
    threadSelectionEpochRef.current += 1;
    splitMutationEpochRef.current += 1;
    setWorkspaceLayout(null);
    setSplitView(null);
    activeThreadIdRef.current = null;
    const targetCwd = workspaceMode === "ssh" ? sshCwd : cwd;
    const savedVm = workspaceMode === "local" && targetCwd ? loadWorkspaceVmPolicy(targetCwd) : null;
    const targetBackend = (historyBackendFilterUserTouchedRef.current && historyBackendFilter !== "mini")
      ? historyBackendFilter
      : (runtimeSelection.cliBackend ?? DEFAULT_CLI_BACKEND);
    const opencodeProvider = state.providers.find((p: ProviderConfig) => p.id === "opencode-local");
    const opencodeDefaultModel = (opencodeProvider?.defaultModel && opencodeProvider.defaultModel !== "default")
      ? opencodeProvider.defaultModel
      : (opencodeProvider?.groups?.[0]?.models?.find((m: string) => m && m !== "default") || "opencode/big-pickle");
    const opencodeGroupModel = (groupId: string): string =>
      opencodeProvider?.groups?.find((g) => g.id === groupId)?.models?.find((m: string) => m && m !== "default") ||
      opencodeDefaultModel;
    const currentProviderId = runtimeSelection.providerId;
    const currentGroupId = runtimeSelection.groupId;
    const currentModel = runtimeSelection.model;
    const isAgyRelay = Boolean(
      currentProviderId &&
      currentProviderId !== "agy-official" &&
      currentProviderId !== "grok-official" &&
      currentProviderId !== "pi-relay" &&
      currentProviderId !== "opencode-local" &&
      state.providers.some((p: ProviderConfig) => p.id === currentProviderId)
    );
    const backendInit = targetBackend === "grok"
      ? { cliBackend: "grok" as const, providerId: "grok-official", groupId: null, model: "grok-4.6" }
      : targetBackend === "agy"
      ? (isAgyRelay
        ? { cliBackend: "agy" as const, providerId: currentProviderId!, groupId: currentGroupId ?? null, model: currentModel || "gemini-3.8-flash-high" }
        : { cliBackend: "agy" as const, providerId: "agy-official", groupId: null, model: "gemini-3.8-flash-high" })
      : targetBackend === "claude"
      ? { cliBackend: "claude" as const }
      : targetBackend === "pi"
      ? { cliBackend: "pi" as const }
      : targetBackend === "opencode"
      ? { cliBackend: "opencode" as const, providerId: "opencode-local", groupId: "v1", model: opencodeGroupModel("v1") }
      : targetBackend === "opencode-v2"
      ? { cliBackend: "opencode-v2" as const, providerId: "opencode-local", groupId: "v2", model: opencodeGroupModel("v2") }
      : targetBackend === "codex"
      ? { cliBackend: "codex" as const }
      : { cliBackend: "mini" as const, providerId: currentProviderId ?? null, groupId: currentGroupId ?? null, model: currentModel || "" };
    updateNewConversationRuntimeSelection({
      permission: nextPermission,
      dangerBypassConfirmed: nextPermission === "dangerBypass",
      vmEnabled: savedVm ? savedVm.vmEnabled : false,
      vmPolicy: savedVm ? savedVm.vmPolicy : undefined,
      ...backendInit
    });
    setDangerBypassConfirmed(nextPermission === "dangerBypass");
    setWorkspaceFilePath(null);
    setWorkspacePickerPath(workspaceMode === "ssh" ? sshCwd : cwd);
    setWorkspaceSelectionPending(true);
    setNewChatSetupOpen(true);
    setNewChatBudgetLimit("");
    newChatDefaultsAppliedRef.current = false;
    setWelcomeDismissed(false);
    dispatch({ type: "newConversation" });
    if (!savedVm && workspaceMode === "local" && targetCwd) {
      applyWorkspaceVmPolicyForCwd(targetCwd);
    }
  }, [applyWorkspaceVmPolicyForCwd, cwd, historyBackendFilter, runtimeSelection.cliBackend, runtimeSelection.groupId, runtimeSelection.model, runtimeSelection.providerId, sshCwd, state.providers, updateNewConversationRuntimeSelection, workspaceMode]);

  const requestNewSession = useCallback(
    (nextPermission: PermissionPresetId) => {
      if (nextPermission === "dangerBypass") {
        threadSelectionEpochRef.current += 1;
        splitMutationEpochRef.current += 1;
        setWorkspaceLayout(null);
        setSplitView(null);
        activeThreadIdRef.current = null;
        setWorkspaceFilePath(null);
        setWorkspacePickerPath(workspaceMode === "ssh" ? sshCwd : cwd);
        setWorkspaceSelectionPending(true);
        setNewChatSetupOpen(true);
        setNewChatBudgetLimit("");
        newChatDefaultsAppliedRef.current = false;
        const targetCwd = workspaceMode === "ssh" ? sshCwd : cwd;
        const savedVm = workspaceMode === "local" && targetCwd ? loadWorkspaceVmPolicy(targetCwd) : null;
        const targetBackend = (historyBackendFilterUserTouchedRef.current && historyBackendFilter !== "mini")
          ? historyBackendFilter
          : (runtimeSelection.cliBackend ?? DEFAULT_CLI_BACKEND);
        const opencodeProvider = state.providers.find((p: ProviderConfig) => p.id === "opencode-local");
        const opencodeDefaultModel = (opencodeProvider?.defaultModel && opencodeProvider.defaultModel !== "default")
          ? opencodeProvider.defaultModel
          : (opencodeProvider?.groups?.[0]?.models?.find((m: string) => m && m !== "default") || "opencode/big-pickle");
        const opencodeGroupModel = (groupId: string): string =>
          opencodeProvider?.groups?.find((g) => g.id === groupId)?.models?.find((m: string) => m && m !== "default") ||
          opencodeDefaultModel;
        const currentProviderId = runtimeSelection.providerId;
        const currentGroupId = runtimeSelection.groupId;
        const currentModel = runtimeSelection.model;
        const isAgyRelay = Boolean(
          currentProviderId &&
          currentProviderId !== "agy-official" &&
          currentProviderId !== "grok-official" &&
          currentProviderId !== "pi-relay" &&
          currentProviderId !== "opencode-local" &&
          state.providers.some((p: ProviderConfig) => p.id === currentProviderId)
        );
        const backendInit = targetBackend === "grok"
          ? { cliBackend: "grok" as const, providerId: "grok-official", groupId: null, model: "grok-4.6" }
          : targetBackend === "agy"
          ? (isAgyRelay
            ? { cliBackend: "agy" as const, providerId: currentProviderId!, groupId: currentGroupId ?? null, model: currentModel || "gemini-3.8-flash-high" }
            : { cliBackend: "agy" as const, providerId: "agy-official", groupId: null, model: "gemini-3.8-flash-high" })
          : targetBackend === "claude"
          ? { cliBackend: "claude" as const }
          : targetBackend === "pi"
          ? { cliBackend: "pi" as const }
          : targetBackend === "opencode"
          ? { cliBackend: "opencode" as const, providerId: "opencode-local", groupId: "v1", model: opencodeGroupModel("v1") }
          : targetBackend === "opencode-v2"
          ? { cliBackend: "opencode-v2" as const, providerId: "opencode-local", groupId: "v2", model: opencodeGroupModel("v2") }
          : targetBackend === "codex"
          ? { cliBackend: "codex" as const }
          : { cliBackend: "mini" as const, providerId: currentProviderId ?? null, groupId: currentGroupId ?? null, model: currentModel || "" };
        updateNewConversationRuntimeSelection({
          permission: nextPermission,
          dangerBypassConfirmed: false,
          vmEnabled: savedVm ? savedVm.vmEnabled : false,
          vmPolicy: savedVm ? savedVm.vmPolicy : undefined,
          ...backendInit
        });
        setWelcomeDismissed(false);
        dispatch({ type: "newConversation" });
        setDangerDialogIntent({ source: "new-chat", nextPermission });
        setDangerDialogAcknowledged(false);
        if (!savedVm && workspaceMode === "local" && targetCwd) {
          applyWorkspaceVmPolicyForCwd(targetCwd);
        }
        return;
      }
      beginNewSession(nextPermission);
    },
    [applyWorkspaceVmPolicyForCwd, beginNewSession, cwd, historyBackendFilter, runtimeSelection.cliBackend, runtimeSelection.groupId, runtimeSelection.model, runtimeSelection.providerId, sshCwd, state.providers, updateNewConversationRuntimeSelection, workspaceMode]
  );

  const persistWorkspaceForActiveThread = useCallback((nextCwd: string, nextRoots: string[], nextWorkspaceFilePath?: string | null) => {
    const normalizedRoots = normalizeWorkspaceRoots(nextCwd, nextRoots);
    const requestedFilePath = nextWorkspaceFilePath === undefined ? workspaceFilePath : nextWorkspaceFilePath;
    const filePath = workspaceMode === "local" || requestedFilePath
      ? requestedFilePath || joinWorkspacePath(nextCwd, "cxu.code-workspace")
      : null;
    setWorkspaceFilePath(filePath);
    if (filePath && state.token) {
      void writeCodeWorkspaceFile(state.token, { path: filePath, cwd: nextCwd, additionalRoots: normalizedRoots })
        .catch((error: unknown) => dispatch({ type: "error", message: errorMessage("Workspace file save", error) }));
    }
    const threadId = activeThreadIdRef.current;
    if (!threadId || !state.token) return;
    void updateThreadWorkspaceMetadata(state.token, {
      threadId,
      cwd: nextCwd,
      additionalRoots: normalizedRoots,
      workspaceFilePath: filePath ?? ""
    }).catch((error: unknown) => dispatch({ type: "error", message: errorMessage("Workspace save", error) }));
  }, [state.token, workspaceFilePath, workspaceMode]);

  const requestPermissionChange = useCallback(
    (nextPermission: PermissionPresetId) => {
      if (nextPermission === "dangerBypass" && !dangerBypassPermissionConfirmed) {
        const source = activeThreadIdRef.current ? "permission" : "new-chat";
        if (source === "new-chat") {
          setWorkspacePickerPath(workspaceMode === "ssh" ? sshCwd : cwd);
          setWorkspaceSelectionPending(true);
          setNewChatSetupOpen(false);
          updateNewConversationRuntimeSelection({ permission: nextPermission, dangerBypassConfirmed: false });
        }
        setDangerDialogIntent({ source, nextPermission });
        setDangerDialogAcknowledged(false);
        return;
      }
      setRuntimePermission(nextPermission, nextPermission === "dangerBypass");
      persistPermissionForActiveThread(nextPermission);
      if (!activeThreadIdRef.current) {
        setWorkspacePickerPath(workspaceMode === "ssh" ? sshCwd : cwd);
        setWorkspaceSelectionPending(true);
        setNewChatSetupOpen(true);
      }
      if (nextPermission !== "dangerBypass") {
        setDangerBypassConfirmed(false);
      }
    },
    [cwd, dangerBypassPermissionConfirmed, persistPermissionForActiveThread, setRuntimePermission, sshCwd, updateNewConversationRuntimeSelection, workspaceMode]
  );

  const ensureWorkspaceAgents = useCallback(async (modeOverride?: WorkspaceMode): Promise<boolean> => {
    if (!state.token) {
      dispatch({ type: "error", message: "Missing session token" });
      return false;
    }
    const effectiveWorkspaceMode = modeOverride ?? workspaceMode;
    setWorkspaceAgentsBusy(true);
    try {
      const response = await fetch(effectiveWorkspaceMode === "ssh" ? "/api/ssh/ensure-agents" : "/api/workspace/ensure-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-codex-ui-token": state.token },
        body: JSON.stringify(effectiveWorkspaceMode === "ssh" ? { command: sshCommand, path: sshCwd } : { path: cwd })
      });
      const body = (await response.json().catch(() => ({}))) as JsonValue;
      if (!response.ok) throw new Error(stringValue(asRecord(body).error) ?? `AGENTS.md update failed: ${response.status}`);
      return true;
    } catch (error) {
      dispatch({ type: "error", message: formatErrorText(error) });
      return false;
    } finally {
      setWorkspaceAgentsBusy(false);
    }
  }, [cwd, sshCommand, sshCwd, state.token, workspaceMode]);

  const applyWorkspaceSelectionFromDialog = useCallback(async (modeOverride?: WorkspaceMode): Promise<boolean> => {
    const trimmedBudget = newChatBudgetLimit.trim();
    if (trimmedBudget && (!(Number(trimmedBudget) >= 0) || !Number.isFinite(Number(trimmedBudget)))) {
      dispatch({ type: "error", message: t("newChat.invalidBudget") });
      return false;
    }
    const effectiveWorkspaceMode = modeOverride ?? workspaceMode;
    if (effectiveWorkspaceMode === "ssh") {
      const normalizedRemoteCwd = normalizeSshWorkspaceCwd(sshCwd);
      if (!normalizedRemoteCwd || !isSshWorkspaceCommand(sshCommand)) {
        dispatch({ type: "error", message: t("workspace.required") });
        return false;
      }
      setSshCommand(sshCommand.trim());
      setSshCwd(normalizedRemoteCwd);
      setWorkspaceMode("ssh");
      recordRecentWorkspace(normalizedRemoteCwd, "ssh", sshCommand);
      if (!(await ensureWorkspaceAgents(effectiveWorkspaceMode))) return false;
      setWorkspaceSelectionPending(false);
      setNewChatSetupOpen(false);
      return true;
    }
    const normalized = resolveTildeWorkspacePath(normalizeWorkspaceCwd(cwd), localWorkspaceInfo?.home, workspaceHostPlatform);
    if (!normalized) {
      dispatch({ type: "error", message: t("workspace.required") });
      return false;
    }
    setCwd(normalized);
    setWorkspaceMode("local");
    recordRecentWorkspace(normalized, "local");
    applyWorkspaceVmPolicyForCwd(normalized);
    if (effectiveWorkspaceMode === "local") {
      const nextWorkspaceFilePath = workspaceFilePath || joinWorkspacePath(normalized, "cxu.code-workspace");
      setWorkspaceFilePath(nextWorkspaceFilePath);
      if (state.token) {
        try {
          await writeCodeWorkspaceFile(state.token, { path: nextWorkspaceFilePath, cwd: normalized, additionalRoots });
        } catch (error) {
          dispatch({ type: "error", message: errorMessage(t("workspace.openFile"), error) });
          return false;
        }
      }
    }
    if (!(await ensureWorkspaceAgents(effectiveWorkspaceMode))) return false;
    setWorkspaceSelectionPending(false);
    setNewChatSetupOpen(false);
    return true;
  }, [additionalRoots, applyWorkspaceVmPolicyForCwd, cwd, ensureWorkspaceAgents, localWorkspaceInfo?.home, newChatBudgetLimit, sshCommand, sshCwd, state.token, t, workspaceFilePath, workspaceHostPlatform, workspaceMode]);

  const confirmWorkspaceSelection = useCallback(async (modeOverride?: WorkspaceMode) => {
    if (!(await verifySshWorkspaceBeforeCreate(modeOverride))) return;
    await applyWorkspaceSelectionFromDialog(modeOverride);
  }, [applyWorkspaceSelectionFromDialog, verifySshWorkspaceBeforeCreate]);

  const closeDangerDialog = useCallback(() => {
    if (dangerDialogIntent?.source === "new-chat") {
      setNewChatSetupOpen(false);
    }
    setDangerDialogIntent(null);
    setDangerDialogAcknowledged(false);
  }, [dangerDialogIntent?.source]);

  const confirmDangerDialog = useCallback(async () => {
    if (!dangerDialogIntent) {
      return;
    }
    if (dangerDialogIntent.source === "new-chat" && !(await verifySshWorkspaceBeforeCreate())) return;
    if (dangerDialogIntent.source === "new-chat") {
      if (!(await applyWorkspaceSelectionFromDialog())) return;
      updateNewConversationRuntimeSelection({ permission: dangerDialogIntent.nextPermission, dangerBypassConfirmed: true });
    } else {
      setRuntimePermission(dangerDialogIntent.nextPermission, true);
      persistPermissionForActiveThread(dangerDialogIntent.nextPermission);
    }
    setDangerBypassConfirmed(true);
    if (dangerDialogIntent.source === "new-chat") {
      setWelcomeDismissed(false);
    }
    closeDangerDialog();
  }, [applyWorkspaceSelectionFromDialog, closeDangerDialog, dangerDialogIntent, persistPermissionForActiveThread, setRuntimePermission, updateNewConversationRuntimeSelection, verifySshWorkspaceBeforeCreate]);

  const useSaferModeFromDangerDialog = useCallback(() => {
    if (dangerDialogIntent?.source === "new-chat") {
      beginNewSession("workspaceAsk");
    } else {
      setRuntimePermission("workspaceAsk");
      setDangerBypassConfirmed(false);
    }
    closeDangerDialog();
  }, [beginNewSession, closeDangerDialog, dangerDialogIntent?.source, setRuntimePermission]);

  const selectProviderForCurrentThread = useCallback(async (providerId: string, groupId?: string) => {
    if (providerId === "agy-official") {
      const patch = {
        cliBackend: "agy" as const,
        providerId: "agy-official",
        groupId: null,
        model: "gemini-3.8-flash-high"
      };
      if (activeThreadIdRef.current) updateRuntimeSelectionAndPersist(patch);
      else updateNewConversationRuntimeSelection(patch);
      return Promise.resolve();
    }
    if (providerId === "agy-launch") {
      const patch = {
        cliBackend: "agy" as const,
        providerId: "agy-launch",
        groupId: "default",
        model: "gemini-3.8-flash-high"
      };
      if (activeThreadIdRef.current) updateRuntimeSelectionAndPersist(patch);
      else updateNewConversationRuntimeSelection(patch);
      return Promise.resolve();
    }
    if (providerId === "grok-official") {
      const patch = {
        cliBackend: "grok" as const,
        providerId: "grok-official",
        groupId: null,
        model: "grok-4.6"
      };
      if (activeThreadIdRef.current) updateRuntimeSelectionAndPersist(patch);
      else updateNewConversationRuntimeSelection(patch);
      return Promise.resolve();
    }
    const provider = state.providers.find((entry: ProviderConfig) => entry.id === providerId);
    if (!provider) return Promise.reject(new Error(`Provider not found: ${providerId}`));
    const hasProviderCredential = hasConfiguredProviderCredential(provider);
    const selectableGroups = provider.groups?.filter((entry: ChannelGroupConfig) => isAvailableRelayGroup(entry, hasProviderCredential)) ?? [];
    const requestedGroup = groupId ? provider.groups?.find((entry: ChannelGroupConfig) => entry.id === groupId) : undefined;
    const group = requestedGroup && isAvailableRelayGroup(requestedGroup, hasProviderCredential)
      ? requestedGroup
      : selectableGroups.find((entry: ChannelGroupConfig) => entry.kind !== "image") ?? selectableGroups[0]
        ?? requestedGroup
        ?? provider.groups?.find((entry: ChannelGroupConfig) => entry.kind !== "image")
        ?? provider.groups?.[0];
    const models = group ? relayGroupSelectableModels(provider, group) : provider.nativeModels;
    const currentModel = selectedModelRef.current;
    let selectedModel = models.some((candidate: string) => modelSelectionMatches(candidate, currentModel))
      ? currentModel
      : models[0] ?? "";
    if (group?.id === "freebuff" && freebuffSession?.active && freebuffSession.model) {
      if (models.some((candidate: string) => modelSelectionMatches(candidate, freebuffSession.model!))) {
        selectedModel = freebuffSession.model;
      }
    }
    const activeId = activeThreadIdRef.current;
    const currentSelection = activeId ? selectionForThread(activeId) : selectionForThread(null);
    const effectiveCliBackend = currentSelection.cliBackend ?? runtimeSelection.cliBackend ?? DEFAULT_CLI_BACKEND;
    const patch = {
      cliBackend: effectiveCliBackend,
      providerId,
      groupId: group?.id ?? null,
      model: selectedModel
    };
    if (activeThreadIdRef.current) updateRuntimeSelectionAndPersist(patch);
    else updateNewConversationRuntimeSelection(patch);

    return Promise.resolve();
  }, [freebuffSession, runtimeSelection.cliBackend, selectionForThread, state.providers, updateNewConversationRuntimeSelection, updateRuntimeSelectionAndPersist]);
  return {
    applyWorkspaceVmPolicyForCwd,
    handleSelectRecentWorkspace,
    persistPermissionForActiveThread,
    openExistingThread,
    beginNewSession,
    requestNewSession,
    persistWorkspaceForActiveThread,
    requestPermissionChange,
    ensureWorkspaceAgents,
    applyWorkspaceSelectionFromDialog,
    confirmWorkspaceSelection,
    closeDangerDialog,
    confirmDangerDialog,
    useSaferModeFromDangerDialog,
    selectProviderForCurrentThread,
  };
}
