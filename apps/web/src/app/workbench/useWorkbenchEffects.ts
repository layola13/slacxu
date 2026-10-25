import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { hasEnhanceToolsEnabled, type ProviderConfig } from "@codex-ui/shared";
import {
  fetchCodeWorkspaceFile,
  fetchWorkspaceSaVmStatus,
  type CodeWorkspaceSelection,
} from "../../state/codexClient";
import { ACTIVE_TURN_RECONCILE_IDLE_MS, ACTIVE_TURN_RECONCILE_INTERVAL_MS } from "./appConstants";
import { createSaVmPolicyWithIdeTools, loadWorkspaceVmPolicy, saveWorkspaceVmPolicy } from "../../utils/recentWorkspaces";
import { filterHistoryThreads } from "../../historySearch";
import { errorMessage, syncWorkspaceFromThread } from "./appUtils";
import { hasConfiguredProviderCredential, isAvailableRelayGroup } from "../../groupCollection";
import { joinWorkspacePath, normalizeWorkspaceRoots } from "../../workspacePaths";
import type { ThreadHistoryPageState } from "../threads/threadHistoryService";
import type { HistoryLoadProgress } from "../../history/HistorySidebar";
import type { ComposerCoreInput } from "./composerCoreContext";
import type { DetachedTaskSnapshot, WorkspaceMode } from "./appConstants";
import type { useTopicTranscriptRuntime } from "../transcripts/useTopicTranscriptRuntime";
import type { GoalLifecycle } from "../goals/useGoalLifecycle";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient, WorkbenchTurn } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useWorkbenchEffects(input: ComposerCoreInput & {
  activeRunningTurn: WorkbenchTurn | null;
  activeWorkspaceCwd: string;
  activeWorkspaceMode: import("./appConstants").WorkspaceMode;
  additionalRootsRef: MutableRefObject<string[]>;
  clientRef: MutableRefObject<CodexSocketClient | null>;
  connectionEpoch: number;
  detachedSnapshotHydratedRef: MutableRefObject<boolean>;
  detachedSnapshotReady: boolean;
  setDetachedSnapshotReady: Dispatch<SetStateAction<boolean>>;
  setDetachedTaskSnapshot: Dispatch<SetStateAction<DetachedTaskSnapshot | null>>;
  detachedThreadId: string | null;
  handledConnectionEpochRef: MutableRefObject<number>;
  historyFullyLoadedRef: MutableRefObject<boolean>;
  historyLoadRequestRef: MutableRefObject<number>;
  historySearchTerm: string;
  loadBasics: (options?: { forceHistoryRefresh?: boolean; preserveHistory?: boolean }) => Promise<void>;
  loadHistory: (searchTerm?: string, options?: { cliBackend?: import("../../history/HistorySidebar").HistoryBackendFilter }) => Promise<void>;
  loadThreadGoal: GoalLifecycle["loadThreadGoal"];
  loadThreadIntoCache: (threadId: string, options?: { silent?: boolean }) => Promise<void>;
  preferencesReady: boolean;
  refreshProviders: (token: string, options?: { force?: boolean }) => Promise<ProviderConfig[]>;
  resolveDetachedSnapshotReadyRef: MutableRefObject<(() => void) | null>;
  setDraggedTaskTabId: Dispatch<SetStateAction<string | null>>;
  setPaneContextMenu: Dispatch<SetStateAction<{ paneId: string; threadId: string; mouseX: number; mouseY: number } | null>>;
  setPendingPaneSplit: Dispatch<SetStateAction<{ paneId: string; direction: import("../../taskTabs").SplitDirection } | null>>;
  setReasoningAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  setRuntimeConfigAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  setSplitViewMenuAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  setSplitViewMenuPosition: Dispatch<SetStateAction<{ top: number; left: number } | null>>;
  setTaskTabContextMenu: Dispatch<SetStateAction<{ threadId: string; mouseX: number; mouseY: number } | null>>;
  setHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryLoadProgress: Dispatch<SetStateAction<HistoryLoadProgress | null>>;
  setThreadHistoryPages: Dispatch<SetStateAction<Record<string, ThreadHistoryPageState>>>;
  threadHistoryPagesRef: MutableRefObject<Record<string, ThreadHistoryPageState>>;
  windowsDesktop: boolean;
  workspaceFolderMergeEpochRef: MutableRefObject<Set<string>>;
  lastCodexActivityAtRef: MutableRefObject<number>;
  isPerformancePressured: () => boolean;
  disablePlanAutoContinuation: (threadId?: string) => void;
  planImplementationPrompt: import("./appConstants").PlanImplementationPrompt | null;
  setPlanImplementationPrompt: Dispatch<SetStateAction<import("./appConstants").PlanImplementationPrompt | null>>;
  handledPlanImplementationIdsRef: MutableRefObject<Set<string>>;
  planModeEnabled: boolean;
  selectTaskTab: (threadId: string | null) => void;
  selectedModelRef: MutableRefObject<string>;
  setDetachedTaskIds: Dispatch<SetStateAction<Set<string>>>;
  freebuffSwitchDialogOpen: boolean;
  persistWorkspaceForActiveThread: (nextCwd: string, nextRoots: string[], nextWorkspaceFilePath?: string | null) => void;
  splitDropHandledRef: MutableRefObject<boolean>;
  transcriptRuntime: ReturnType<typeof useTopicTranscriptRuntime>;
  setCwd: Dispatch<SetStateAction<string>>;
  setWorkspaceSelectionPending: Dispatch<SetStateAction<boolean>>;
  setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
  setSshCommand: Dispatch<SetStateAction<string>>;
  setSshCwd: Dispatch<SetStateAction<string>>;
  setAdditionalRoots: Dispatch<SetStateAction<string[]>>;
  setWorkspaceFilePath: Dispatch<SetStateAction<string | null>>;
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
    activeRunningTurn, activeWorkspaceCwd, activeWorkspaceMode, additionalRootsRef, clientRef,
    connectionEpoch, detachedSnapshotHydratedRef, detachedSnapshotReady, setDetachedSnapshotReady,
    setDetachedTaskSnapshot, detachedThreadId, handledConnectionEpochRef, historyFullyLoadedRef,
    historyLoadRequestRef, historySearchTerm, loadBasics, loadHistory, loadThreadGoal,
    loadThreadIntoCache, preferencesReady, resolveDetachedSnapshotReadyRef,
    setDraggedTaskTabId, setPaneContextMenu, setPendingPaneSplit, setReasoningAnchor,
    setRuntimeConfigAnchor, setSplitViewMenuAnchor, setSplitViewMenuPosition, setTaskTabContextMenu,
    setHistoryLoading, setHistoryLoadProgress, setThreadHistoryPages, threadHistoryPagesRef,
    windowsDesktop, workspaceFolderMergeEpochRef, lastCodexActivityAtRef, isPerformancePressured,
    transcriptRuntime, setCwd, setWorkspaceSelectionPending, setWorkspaceMode, setSshCommand, persistWorkspaceForActiveThread, splitDropHandledRef,
    disablePlanAutoContinuation, planImplementationPrompt, setPlanImplementationPrompt,
    handledPlanImplementationIdsRef, planModeEnabled, selectTaskTab, selectedModelRef,
    setDetachedTaskIds, freebuffSwitchDialogOpen,
    setSshCwd, setAdditionalRoots, setWorkspaceFilePath,
  } = input;
  useEffect(() => {
    let active = true;
    let confirmationTimer = 0;
    let pollTimer = 0;
    let checkInFlight = false;
    const desktop = window.codexUltraDesktop;
    if (!windowsDesktop || !desktop?.gpuFeatureStatus) {
      delete document.documentElement.dataset.softwareRendering;
      return;
    }
    const applyStatus = (status: Awaited<ReturnType<typeof desktop.gpuFeatureStatus>>) => {
      if (!active) return;
      window.clearTimeout(confirmationTimer);
      const software = status?.features.gpu_compositing === "disabled_software"
        || status?.features.rasterization === "disabled_software";
      if (!software) {
        delete document.documentElement.dataset.softwareRendering;
        return;
      }
      document.documentElement.dataset.softwareRendering = "true";
      confirmationTimer = window.setTimeout(() => {
        void desktop.gpuFeatureStatus().then((confirmed: Awaited<ReturnType<typeof desktop.gpuFeatureStatus>>) => {
          if (!active) return;
          const stillSoftware = confirmed?.features.gpu_compositing === "disabled_software"
            || confirmed?.features.rasterization === "disabled_software";
          if (stillSoftware) void desktop.promptGpuRecovery?.();
          else delete document.documentElement.dataset.softwareRendering;
        }).catch(() => undefined);
      }, 3_000);
    };
    const checkGpuStatus = () => {
      if (!active || checkInFlight || document.visibilityState !== "visible" || !document.hasFocus()) return;
      checkInFlight = true;
      void desktop.gpuFeatureStatus()
        .then(applyStatus)
        .catch(() => undefined)
        .finally(() => { checkInFlight = false; });
    };
    checkGpuStatus();
    pollTimer = window.setInterval(checkGpuStatus, 30_000);
    window.addEventListener("focus", checkGpuStatus);
    return () => {
      active = false;
      window.clearTimeout(confirmationTimer);
      window.clearInterval(pollTimer);
      window.removeEventListener("focus", checkGpuStatus);
      delete document.documentElement.dataset.softwareRendering;
    };
  }, [windowsDesktop]);

  useEffect(() => {
    if (!state.connected || !state.token || !detachedSnapshotReady || connectionEpoch <= handledConnectionEpochRef.current) {
      return;
    }
    handledConnectionEpochRef.current = connectionEpoch;
    const token = state.token;
    let cancelled = false;
    void (async () => {
      try {
        try {
          await refreshProviders(token);
        } catch (error) {
          console.warn("[thread reconnect] provider refresh failed; continuing with cached providers", error);
        }
        if (cancelled) return;
        await loadBasics();
        if (cancelled) return;
        const activeThreadId = activeThreadIdRef.current;
        if (activeThreadId) {
          if (topicTranscriptStore.hasThreadTranscript(activeThreadId) || (activeThreadId === detachedThreadId && detachedSnapshotHydratedRef.current)) {
            console.info("[thread reconnect] preserving active in-memory transcript", {
              threadId: activeThreadId,
              turnCount: topicTranscriptStore.getThreadTurns(activeThreadId).length
            });
            await loadThreadGoal(activeThreadId);
          } else {
            await loadThreadIntoCache(activeThreadId);
          }
          if (!cancelled) {
            try {
              clientRef.current?.watchThread(activeThreadId);
            } catch {
              // Watch resubscription is best-effort; live events resume on next open.
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          dispatch({ type: "error", message: errorMessage("Reconnect refresh", error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionEpoch, detachedSnapshotReady, detachedThreadId, loadBasics, loadThreadGoal, loadThreadIntoCache, refreshProviders, state.connected, state.token, topicTranscriptStore]);

  useEffect(() => {
    if (!state.connected || !activeRunningTurn) {
      return;
    }
    const threadId = activeRunningTurn.threadId;
    let polling = false;
    let disposed = false;
    const reconcile = async (options: { ignoreIdle?: boolean } = {}) => {
      if (
        polling
        || disposed
        || document.visibilityState !== "visible"
        || isPerformancePressured()
        || (!options.ignoreIdle && Date.now() - lastCodexActivityAtRef.current < ACTIVE_TURN_RECONCILE_IDLE_MS)
      ) {
        return;
      }
      polling = true;
      try {
        await loadThreadIntoCache(threadId, { silent: true });
      } finally {
        polling = false;
      }
    };
    // 终态通知若在切后台、窗口失焦或 WS 断连期间丢失，仅靠轮询要等很久。
    // 切回前台或重连（effect 重建）时立刻对一次账；平时流式输出不断重置
    // idle 计时器，不会产生额外请求。
    const reconcileSoon = () => {
      if (!disposed) void reconcile({ ignoreIdle: true });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcileSoon();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", reconcileSoon);
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), ACTIVE_TURN_RECONCILE_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", reconcileSoon);
    };
  }, [activeRunningTurn?.id, activeRunningTurn?.threadId, loadThreadIntoCache, state.connected]);

  useEffect(() => {
    if (activeWorkspaceMode !== "local" || !activeWorkspaceCwd) return;
    const activeThread = state.activeThreadId;
    const currentSelection = activeThread ? selectionForThread(activeThread) : runtimeSelection;
    const saved = loadWorkspaceVmPolicy(activeWorkspaceCwd);
    if (saved?.vmPolicy) {
      const hasCurrentTools = hasEnhanceToolsEnabled(currentSelection.vmPolicy?.tools);
      const hasSavedTools = hasEnhanceToolsEnabled(saved.vmPolicy?.tools);
      if (!currentSelection.vmPolicy || (!hasCurrentTools && hasSavedTools)) {
        if (activeThread) {
          patchThreadRuntimeSelection(activeThread, {
            vmEnabled: saved.vmEnabled,
            vmPolicy: saved.vmPolicy
          });
        } else {
          updateNewConversationRuntimeSelection({
            vmEnabled: saved.vmEnabled,
            vmPolicy: saved.vmPolicy
          });
        }
      }
    } else if (!currentSelection.vmPolicy && state.token) {
      void fetchWorkspaceSaVmStatus(state.token, activeWorkspaceCwd).then((status: { hasSkill: boolean; skillPath: string | null; }) => {
        if (status.hasSkill) {
          const policy = createSaVmPolicyWithIdeTools();
          saveWorkspaceVmPolicy(activeWorkspaceCwd, false, policy);
          if (activeThread) {
            patchThreadRuntimeSelection(activeThread, {
              vmPolicy: policy
            });
          } else {
            updateNewConversationRuntimeSelection({
              vmPolicy: policy
            });
          }
        }
      }).catch(() => {});
    }
  }, [activeWorkspaceCwd, activeWorkspaceMode, patchThreadRuntimeSelection, runtimeSelection, selectionForThread, state.activeThreadId, state.token, updateNewConversationRuntimeSelection]);

  useEffect(() => {
    if (!detachedThreadId) return;
    const desktop = window.codexUltraDesktop;
    if (!desktop) {
      setDetachedSnapshotReady(true);
      return;
    }
    let cancelled = false;
    void desktop.takeDetachedTaskSnapshot(detachedThreadId)
      .then((value: unknown) => {
        if (cancelled || !value || typeof value !== "object") return;
        const snapshot = value as DetachedTaskSnapshot;
        if (snapshot.threadId !== detachedThreadId || snapshot.thread?.id !== detachedThreadId) return;
        allHistoryThreadsRef.current = [snapshot.thread];
        activeThreadIdRef.current = detachedThreadId;
        const hasSnapshotTurns = Array.isArray(snapshot.turns) && snapshot.turns.length > 0;
        detachedSnapshotHydratedRef.current = hasSnapshotTurns;
        if (hasSnapshotTurns) {
          transcriptRuntime.mergeSnapshot(snapshot.thread, snapshot.turns!);
          dispatch({ type: "threadLoaded", thread: snapshot.thread, turns: snapshot.turns! });
        }
        if (snapshot.pageState) {
          threadHistoryPagesRef.current = { ...threadHistoryPagesRef.current, [detachedThreadId]: snapshot.pageState };
          setThreadHistoryPages((current: Record<string, ThreadHistoryPageState>) => ({ ...current, [detachedThreadId]: snapshot.pageState! }));
        }
        syncWorkspaceFromThread(snapshot.thread, setCwd, setWorkspaceSelectionPending, setWorkspaceMode, setSshCommand, setSshCwd, setAdditionalRoots, setWorkspaceFilePath);
        setDetachedTaskSnapshot(snapshot);
      })
      .catch(() => undefined)
      .finally(() => {
        resolveDetachedSnapshotReadyRef.current?.();
        resolveDetachedSnapshotReadyRef.current = null;
        if (!cancelled) setDetachedSnapshotReady(true);
      });
    return () => { cancelled = true; };
  }, [detachedThreadId, transcriptRuntime.mergeSnapshot]);

  useEffect(() => {
    if (!detachedThreadId) return;
    const desktop = window.codexUltraDesktop;
    if (!desktop) {
      setDetachedSnapshotReady(true);
      return;
    }
    let cancelled = false;
    void desktop.takeDetachedTaskSnapshot(detachedThreadId)
      .then((value: unknown) => {
        if (cancelled || !value || typeof value !== "object") return;
        const snapshot = value as DetachedTaskSnapshot;
        if (snapshot.threadId !== detachedThreadId || snapshot.thread?.id !== detachedThreadId) return;
        allHistoryThreadsRef.current = [snapshot.thread];
        activeThreadIdRef.current = detachedThreadId;
        const hasSnapshotTurns = Array.isArray(snapshot.turns) && snapshot.turns.length > 0;
        detachedSnapshotHydratedRef.current = hasSnapshotTurns;
        if (hasSnapshotTurns) {
          transcriptRuntime.mergeSnapshot(snapshot.thread, snapshot.turns!);
          dispatch({ type: "threadLoaded", thread: snapshot.thread, turns: snapshot.turns! });
        }
        if (snapshot.pageState) {
          threadHistoryPagesRef.current = { ...threadHistoryPagesRef.current, [detachedThreadId]: snapshot.pageState };
          setThreadHistoryPages((current: Record<string, ThreadHistoryPageState>) => ({ ...current, [detachedThreadId]: snapshot.pageState! }));
        }
        syncWorkspaceFromThread(snapshot.thread, setCwd, setWorkspaceSelectionPending, setWorkspaceMode, setSshCommand, setSshCwd, setAdditionalRoots, setWorkspaceFilePath);
        setDetachedTaskSnapshot(snapshot);
      })
      .catch(() => undefined)
      .finally(() => {
        resolveDetachedSnapshotReadyRef.current?.();
        resolveDetachedSnapshotReadyRef.current = null;
        if (!cancelled) setDetachedSnapshotReady(true);
      });
    return () => { cancelled = true; };
  }, [detachedThreadId, transcriptRuntime.mergeSnapshot]);

  useEffect(() => {
    if (workspaceMode !== "local" || !preferencesReady || !state.token || !cwd) return;
    const resolvedWorkspaceFilePath = workspaceFilePath || joinWorkspacePath(cwd, "cxu.code-workspace");
    if (workspaceFolderMergeEpochRef.current.has(resolvedWorkspaceFilePath)) return;
    let cancelled = false;
    void fetchCodeWorkspaceFile(state.token, resolvedWorkspaceFilePath)
      .then((selection: CodeWorkspaceSelection) => {
        if (cancelled) return;
        const current = additionalRootsRef.current;
        const merged = normalizeWorkspaceRoots(cwd, [...current, ...selection.additionalRoots]);
        // Only touch state when the workspace file actually contributes new roots,
        // so user-managed additional directories and already-imported folders stay preserved.
        const grew = merged.length > normalizeWorkspaceRoots(cwd, current).length;
        if (!grew) return;
        setAdditionalRoots(merged);
        persistWorkspaceForActiveThread(cwd, merged, resolvedWorkspaceFilePath);
      })
      .catch(() => {
        // No workspace file, an invalid one, or folders that point outside an
        // allowed root: nothing to fold in. Stay silent so normal chats without a
        // .code-workspace file don't surface a spurious error.
      })
      .finally(() => {
        workspaceFolderMergeEpochRef.current.add(resolvedWorkspaceFilePath);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, persistWorkspaceForActiveThread, preferencesReady, state.token, workspaceFilePath, workspaceMode]);

  useEffect(() => {
    if (!state.connected || !state.token) {
      return;
    }
    const trimmedSearch = historySearchTerm.trim();
    historyLoadRequestRef.current += 1;

    if (!trimmedSearch) {
      // No search term: show all loaded threads
      setHistoryLoading(false);
      setHistoryLoadProgress(null);
      dispatch({ type: "threads", threads: allHistoryThreadsRef.current });
      return;
    }

    // User is searching: check if we need to load more data
    if (historyFullyLoadedRef.current) {
      // We already have full history, filter locally
      setHistoryLoading(false);
      setHistoryLoadProgress(null);
      dispatch({ type: "threads", threads: filterHistoryThreads(allHistoryThreadsRef.current, trimmedSearch) });
    } else {
      // Only have first page, load all threads with search term
      void loadHistory(trimmedSearch);
    }
  }, [historySearchTerm, state.connected, state.token, loadHistory]);

  useEffect(() => {
    const resetTransientInputState = () => {
      setDraggedTaskTabId(null);
      splitDropHandledRef.current = false;
      setTaskTabContextMenu(null);
      setPaneContextMenu(null);
      setSplitViewMenuAnchor(null);
      setSplitViewMenuPosition(null);
      setPendingPaneSplit(null);
      setReasoningAnchor(null);
      setRuntimeConfigAnchor(null);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") resetTransientInputState();
    };
    window.addEventListener("blur", resetTransientInputState);
    window.addEventListener("pagehide", resetTransientInputState);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", resetTransientInputState);
      window.removeEventListener("pagehide", resetTransientInputState);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!client || !state.connected || !state.activeThreadId) return;
    const threadId = state.activeThreadId;
    try {
      client.watchThread(threadId);
    } catch (error) {
      dispatch({ type: "error", message: errorMessage("Watch thread", error) });
      return;
    }
    return () => {
      try {
        client.unwatchThread(threadId);
      } catch {
        // The socket may already be disconnected; server-side close cleanup handles stale watches.
      }
    };
  }, [client, state.activeThreadId, state.connected]);

  useEffect(() => {
    if (activeGroupId === "freebuff" && state.token) {
      void (async () => {
        const status = await refreshFreebuffSession();
        if (status?.active && status.model) {
          const current = selectedModelRef.current;
          if (current !== status.model && !freebuffSwitchDialogOpen) {
            if (activeThreadIdRef.current) setSelectedModel(status.model);
            else updateNewConversationRuntimeSelection({ model: status.model });
          }
        }
      })();
    }
  }, [activeGroupId, state.token, refreshFreebuffSession, setSelectedModel, updateNewConversationRuntimeSelection, freebuffSwitchDialogOpen]);

  useEffect(() => {
    if (activeThreadIdRef.current) return;
    const provider = state.providers.find((entry: ProviderConfig) => entry.id === activeProviderId);
    const groups = provider?.groups ?? [];
    const hasProviderCredential = provider ? hasConfiguredProviderCredential(provider) : false;
    const activeGroup = groups.find((group: typeof groups[number]) => group.id === activeGroupId);
    if (activeGroup && isAvailableRelayGroup(activeGroup, hasProviderCredential)) {
      return;
    }
    const groupId = groups.find((group: typeof groups[number]) => group.kind !== "image" && isAvailableRelayGroup(group, hasProviderCredential))?.id
      ?? groups.find((group: typeof groups[number]) => isAvailableRelayGroup(group, hasProviderCredential))?.id
      ?? groups.find((group: typeof groups[number]) => group.kind !== "image")?.id
      ?? groups[0]?.id
      ?? null;
    updateNewConversationRuntimeSelection({ groupId });
  }, [activeGroupId, activeProviderId, state.providers, updateNewConversationRuntimeSelection]);

  useEffect(() => {
    const desktop = window.codexUltraDesktop;
    if (!desktop) return;
    const applyIds = (threadIds: string[]) => {
      setDetachedTaskIds((current: Set<string>) => {
        const next = new Set(threadIds);
        if (current.size === next.size && [...current].every((id: string) => next.has(id))) return current;
        return next;
      });
    };
    void desktop.listDetachedTasks().then(applyIds);
    const removeChanged = desktop.onDetachedTasksChanged(applyIds);
    const removeAttached = desktop.onTaskAttached((threadId: string) => {
      if (threadId) selectTaskTab(threadId);
    });
    return () => {
      removeChanged();
      removeAttached();
    };
  }, [selectTaskTab]);

  useEffect(() => {
    if (!planModeEnabled) {
      disablePlanAutoContinuation();
      if (planImplementationPrompt) {
        handledPlanImplementationIdsRef.current.add(planImplementationPrompt.itemId);
        setPlanImplementationPrompt(null);
      }
      return;
    }
    if (activeRunningTurn || planImplementationPrompt || !state.activeThreadId) {
      return;
    }
    const completedTurn = [...state.turns]
      .reverse()
      .find((turn: WorkbenchTurn) => {
        if (turn.threadId !== state.activeThreadId || turn.status.toLowerCase() !== "completed") {
          return false;
        }
        return turn.items.some(
          (item: import("../../state/codexClient").WorkbenchItem) =>
            item.type === "plan" &&
            item.status?.toLowerCase() === "completed" &&
            !item.id.startsWith("turn-plan-") &&
            item.text.trim().length > 0 &&
            !handledPlanImplementationIdsRef.current.has(item.id)
        );
      });
    const planItem = completedTurn?.items.find(
      (item: import("../../state/codexClient").WorkbenchItem) =>
        item.type === "plan" &&
        item.status?.toLowerCase() === "completed" &&
        !item.id.startsWith("turn-plan-") &&
        item.text.trim().length > 0 &&
        !handledPlanImplementationIdsRef.current.has(item.id)
    );
    if (!completedTurn || !planItem) {
      return;
    }
    disablePlanAutoContinuation(completedTurn.threadId);
    setPlanImplementationPrompt({
      threadId: completedTurn.threadId,
      turnId: completedTurn.id,
      itemId: planItem.id,
      planText: planItem.text
    });
  }, [activeRunningTurn, disablePlanAutoContinuation, planImplementationPrompt, planModeEnabled, state.activeThreadId, state.turns]);
}
