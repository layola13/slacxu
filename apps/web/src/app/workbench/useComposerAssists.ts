import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ComposerImageAttachment, ComposerMention } from "../../state/codexClient";
import type { PlanImplementationPrompt, StartCodexTurnOptions } from "./appConstants";
import type { GoalLifecycle } from "../goals/useGoalLifecycle";
import type { GoalBannerState } from "../../components/ChatPanel";
import type { SettingsSectionId } from "../../settings/SettingsDrawer";
import type { CodexPluginSettingsTab } from "../../components/CodexPluginSettingsPanel";
import type { useTopicTranscriptRuntime } from "../transcripts/useTopicTranscriptRuntime";
import type { CliBackend, PermissionPresetId } from "@codex-ui/shared";
import {
  FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED,
  hasEnhanceToolsEnabled,
  permissionToTurnOverrides,
  type JsonValue,
  type ProviderConfig,
} from "@codex-ui/shared";
import {
  composerInputToUserInput,
  fetchFreeModelAccessStatus,
  fetchWorkspaceGit,
  importOmniRouteFreeRelay,
  reviewStartTurnToWorkbenchTurn,
  saveImageHistory,
  type ClientState,
  type ModelEntry,
  type PendingServerRequest,
  type ThreadEntry,
  type WorkbenchTurn,
} from "../../state/codexClient";
import {
  asRecord,
  debugLog,
  errorMessage,
  formatDiffNotice,
  formatErrorText,
  parseReviewCommand,
  reviewTargetLabel,
  sideChatTitle,
  stringValue,
  turnContainsCompletedImplementationPlan,
  waitForNextPaint,
  withTimeout,
} from "./appUtils";
import { buildSaVmThreadConfig, enhanceDeveloperInstructions, enhanceDynamicToolSpec, saVmDeveloperInstructions, saVmDynamicToolSpec } from "../cli/saVmExecutionSpec";
import { addWorkspaceRpcMetadata } from "./sshUtils";
import { buildFailedImageThreadItems, buildImageThreadItems, buildLocalImageThreadTurns, buildPendingImageThreadItems } from "../../imageThreadHistory";
import { buildServerRequestDecisionResponse } from "../../serverRequests";
import { checkFreeCompactionReadiness, describeFreeCompactionUnready, shouldRefreshFreeCompactionModels } from "../../../../../frontends/free-mode/src/free/freeCompactionReadiness";
import { FREE_AUTOCOMPACT_COOLDOWN_MS } from "../../../../../frontends/free-mode/src/free/freeAutoCompactPreferences";
import { executeImageCommandRequest } from "../../imageCommand";
import { isThreadWriterConflict } from "../threadWriterConflict";
import { latestActionableRunningTurn, runningTurnsForThread } from "../transcripts/topicRuntimeIndex";
import { normalizeWorkspaceCwd, normalizeWorkspaceRoots } from "../../workspacePaths";
import { parseComposerSlashCommand, type ComposerSlashCommand } from "../../composer/composerSlashCommands";
import { parseGoalObjectiveWithBudget } from "../goals/goalState";
import { renameThreadAcrossCatalogs } from "../threads/threadCatalog";
import { contextUsageMetrics, resolveDisplayedContextWindow } from "../../contextUsage";
import { resolveEffectiveTurnCliBackend } from "../cli/resolveEffectiveTurnCliBackend";
import { resolveImageRuntime } from "../../imageRuntime";
import { isLikelyImageModelId, resolveProviderSelectionId, resolveSelectedModel, resolveSelectedModelProvider, resolveTextRuntimeGroupId } from "./modelSelectionUtils";
import { resolveThreadWorkspace } from "../threads/editConversation";
import { PLAN_CONTINUATION_PROMPT, shouldAutomaticallyContinuePlan } from "../../planContinuation";
import { AGY_OFFICIAL_MODELS } from "./appConstants";
import { DEFAULT_CLI_BACKEND } from "../cli/cliPlugins";
import { SIDE_CHAT_DUCK_GROUP_ID, SIDE_CHAT_DUCK_PROVIDER_ID, applySideChatDuckDefault, shouldSendSideChatWebSearch } from "../sidechat/sideChatDuckDefaults";
import { buildAgentThreadConfig } from "../runtime/useThreadRuntimeSelections";
import type { SideChatTab } from "../../components/SideChatPanel";

import type { ComposerCoreInput } from "./composerCoreContext";

export function useComposerAssists(input: ComposerCoreInput & {
  startCodexTurn: (text: string, images: ComposerImageAttachment[], mentions: ComposerMention[], options?: StartCodexTurnOptions) => Promise<string | null>;
  disablePlanAutoContinuation: (threadId?: string) => void;
  planModeEnabled: boolean;
  planModeEnabledRef: MutableRefObject<boolean>;
  planImplementationPrompt: PlanImplementationPrompt | null;
  setPlanImplementationPrompt: Dispatch<SetStateAction<PlanImplementationPrompt | null>>;
  autoContinuePlanThreadsRef: MutableRefObject<Set<string>>;
  handledPlanTurnIdsRef: MutableRefObject<Set<string>>;
  handledPlanImplementationIdsRef: MutableRefObject<Set<string>>;
  planContinuationInFlightRef: MutableRefObject<Set<string>>;
  transcriptRuntime: ReturnType<typeof useTopicTranscriptRuntime>;
  connectedRef: MutableRefObject<boolean>;
  pendingRequestsRef: MutableRefObject<import("../../state/codexClient").ClientState["pendingRequests"]>;
  threadGoals: Record<string, GoalBannerState>;
  setThreadGoal: GoalLifecycle["setGoal"];
  clearActiveGoal: GoalLifecycle["clearActiveGoal"];
  setActiveGoalStatus: GoalLifecycle["setGoalStatus"];
  loadThread: (threadId: string, selectionEpoch?: number) => Promise<boolean>;
  ensureActiveThread: () => Promise<string>;
  isMiniBackend: boolean;
  loadThreadIntoCache: (threadId: string) => Promise<void>;
  openSettings: (section?: SettingsSectionId, pluginTab?: CodexPluginSettingsTab, relayTarget?: { providerId?: string; groupId?: string }) => void;
  requestNewSession: (permission: PermissionPresetId) => void;
  setHistorySearchTerm: Dispatch<SetStateAction<string>>;
  setLeftPanelVisible: Dispatch<SetStateAction<boolean>>;
  setStatsPanelScope: Dispatch<SetStateAction<"status" | "stats" | null>>;
  setWelcomeDismissed: Dispatch<SetStateAction<boolean>>;
  startCodexTurnRef: MutableRefObject<(text: string, images: ComposerImageAttachment[], mentions: ComposerMention[], options?: StartCodexTurnOptions) => Promise<string | null>>;
  imageJobsRef: MutableRefObject<Map<string, AbortController>>;
  renameCliBackendFor: (threadId: string) => CliBackend | undefined;
  providersRef: MutableRefObject<ProviderConfig[]>;
}) {
  const {
    state, dispatch, client, t, runtimeSelection, workspaceMode, cwd, sshCommand,
    additionalRoots, workspaceFilePath, workspaceSelectionPending, localWorkspaceDefaultPath,
    activeProviderId, activeGroupId, selectedModel, reasoningEffort, reasoningOptions,
    permission, isClaudeBackend, isAgyBackend, isGrokBackend, isPiBackend, isOpencodeBackend, isOpencodeV2Backend,
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
  const { authSession, imageRuntimeSelection, historySelectionForThread, updateRuntimeSelection, updateImageRuntimeSelection, setThreadRuntimePersistencePaused, awaitThreadRuntimePersistence } = input;
  const {
    startCodexTurn, disablePlanAutoContinuation, planModeEnabled, planModeEnabledRef,
    planImplementationPrompt, setPlanImplementationPrompt, autoContinuePlanThreadsRef,
    handledPlanTurnIdsRef, handledPlanImplementationIdsRef, planContinuationInFlightRef,
    transcriptRuntime, connectedRef, pendingRequestsRef, threadGoals, setThreadGoal,
    clearActiveGoal, setActiveGoalStatus, loadThread, loadThreadIntoCache, openSettings,
    requestNewSession, setHistorySearchTerm, setLeftPanelVisible, setStatsPanelScope, ensureActiveThread, isMiniBackend,
    setWelcomeDismissed, startCodexTurnRef, imageJobsRef, renameCliBackendFor, providersRef,
  } = input;  const schedulePlanContinuation = useCallback((threadId: string, delayMs: number = 700, debounce: boolean = false) => {
    if (!autoContinuePlanThreadsRef.current.has(threadId)
      || planContinuationInFlightRef.current.has(threadId)) {
      return;
    }
    const existingTimer = planContinuationTimersRef.current.get(threadId);
    if (existingTimer !== undefined) {
      if (!debounce) return;
      window.clearTimeout(existingTimer);
      planContinuationTimersRef.current.delete(threadId);
    }
    const timer = window.setTimeout(() => {
      planContinuationTimersRef.current.delete(threadId);
      const hasRunningTurn = runningTurnsForThread(turnsRef.current, threadId).length > 0;
      const hasCompletedPlan = turnsRef.current.some((turn: WorkbenchTurn) =>
        turn.threadId === threadId
        && !handledPlanTurnIdsRef.current.has(turn.id)
        && turnContainsCompletedImplementationPlan(turn)
      );
      if (!shouldAutomaticallyContinuePlan({
        planModeEnabled: planModeEnabledRef.current,
        connected: connectedRef.current,
        activeThreadId: activeThreadIdRef.current,
        threadId,
        hasRunningTurn,
        hasPendingRequest: pendingRequestsRef.current.length > 0,
        hasCompletedPlan
      })) {
        if (hasCompletedPlan || !planModeEnabledRef.current) {
          disablePlanAutoContinuation(threadId);
        }
        return;
      }
      for (const turn of turnsRef.current) {
        if (turn.threadId === threadId && turn.status === "completed") {
          handledPlanTurnIdsRef.current.add(turn.id);
        }
      }
      planContinuationInFlightRef.current.add(threadId);
      void startCodexTurnRef.current(
        PLAN_CONTINUATION_PROMPT,
        [],
        [],
        {
          collaborationMode: "plan",
          forceNewTurn: true,
          preserveText: true,
          automaticPlanContinuation: true,
          suppressUserMessage: true
        }
      ).finally(() => {
        planContinuationInFlightRef.current.delete(threadId);
      });
    }, delayMs);
    planContinuationTimersRef.current.set(threadId, timer);
  }, [disablePlanAutoContinuation]);

  useEffect(() => {
    const threadId = state.activeThreadId;
    if (!threadId || !autoContinuePlanThreadsRef.current.has(threadId)) return;
    const hasCompletedPlan = state.turns.some((turn: WorkbenchTurn) =>
      turn.threadId === threadId
      && !handledPlanTurnIdsRef.current.has(turn.id)
      && turnContainsCompletedImplementationPlan(turn)
    );
    if (hasCompletedPlan || !planModeEnabled) {
      disablePlanAutoContinuation(threadId);
      return;
    }
    const hasNewCompletedTurn = state.turns.some((turn: WorkbenchTurn) =>
      turn.threadId === threadId
      && turn.status === "completed"
      && !handledPlanTurnIdsRef.current.has(turn.id)
    );
    if (hasNewCompletedTurn) {
      schedulePlanContinuation(threadId, 700, true);
    }
  }, [disablePlanAutoContinuation, planModeEnabled, schedulePlanContinuation, state.activeThreadId, state.connected, state.pendingRequests, state.turns]);

  useEffect(() => {
    for (const threadId of [...autoContinuePlanThreadsRef.current]) {
      if (threadId !== state.activeThreadId) {
        disablePlanAutoContinuation(threadId);
      }
    }
  }, [disablePlanAutoContinuation, state.activeThreadId]);

  useEffect(() => () => {
    for (const timer of planContinuationTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    planContinuationTimersRef.current.clear();
  }, []);

  const stayInPlanMode = useCallback(() => {
    if (planImplementationPrompt) {
      handledPlanImplementationIdsRef.current.add(planImplementationPrompt.itemId);
    }
    setPlanImplementationPrompt(null);
  }, [planImplementationPrompt]);

  const implementApprovedPlan = useCallback(async () => {
    if (!planImplementationPrompt) {
      return;
    }
    handledPlanImplementationIdsRef.current.add(planImplementationPrompt.itemId);
    disablePlanAutoContinuation(planImplementationPrompt.threadId);
    setPlanImplementationPrompt(null);
    updateRuntimeSelection({ planModeEnabled: false });
    await startCodexTurn("Implement the plan.", [], [], { collaborationMode: "default", forceNewTurn: true });
  }, [disablePlanAutoContinuation, planImplementationPrompt, startCodexTurn, updateRuntimeSelection]);

  const setGoalForActiveThread = useCallback(
    async (objective: string) => {
      if (permission === "dangerBypass" && !dangerBypassPermissionConfirmed) {
        setDangerDialogIntent({ source: "permission", nextPermission: "dangerBypass" });
        setDangerDialogAcknowledged(false);
        return;
      }
      const parsed = parseGoalObjectiveWithBudget(objective);
      if (!parsed.objective) {
        dispatch({ type: "error", message: "Usage: /goal [@budget e.g. @200k] <objective>" });
        return;
      }
      try {
        const threadId = await ensureActiveThread();
        await setThreadGoal(threadId, parsed.objective, parsed.tokenBudget ?? undefined);
        // Codex goal runtime starts and continues active goal turns when the thread is idle.
      } catch (error) {
        dispatch({ type: "error", message: errorMessage("Goal set", error) });
      }
    },
    [dangerBypassPermissionConfirmed, ensureActiveThread, permission, setThreadGoal]
  );

  const renameActiveThread = useCallback(
    async (name: string) => {
      const threadId = state.activeThreadId;
      if (!threadId) {
        dispatch({ type: "error", message: "Select or start a conversation before renaming it" });
        return;
      }
      const normalized = name.trim();
      if (!normalized) {
        setComposerSuggestion({ id: `rename-${Date.now()}`, text: "/rename " });
        return;
      }
      try {
        await client.rpc("thread/name/set", { threadId, name: normalized });
        applyHistoryThreads(renameThreadAcrossCatalogs(allHistoryThreadsRef.current, state.threads, threadId, normalized, renameCliBackendFor(threadId)));
        setSlashNotice({
          id: `rename-${Date.now()}`,
          title: "Thread renamed",
          message: normalized,
          severity: "success"
        });
      } catch (error) {
        dispatch({ type: "error", message: errorMessage("Rename thread", error) });
      }
    },
    [applyHistoryThreads, client, renameCliBackendFor, state.activeThreadId, state.threads]
  );

  const startReview = useCallback(
    async (target: JsonValue, delivery: "inline" | "detached") => {
      if (permission === "dangerBypass" && !dangerBypassPermissionConfirmed) {
        setDangerDialogIntent({ source: "permission", nextPermission: "dangerBypass" });
        setDangerDialogAcknowledged(false);
        return;
      }
      try {
        const threadId = await ensureActiveThread();
        if (isMiniBackend) {
          await client.rpc("review/start", { threadId, target, delivery, cliBackend: "mini" });
          setSlashNotice({
            id: `review-${Date.now()}`,
            title: "Review started",
            message: reviewTargetLabel(target),
            severity: "success"
          });
          return;
        }
        const result = await client.rpc("review/start", { threadId, target, delivery });
        const reviewThreadId = stringValue(asRecord(result).reviewThreadId) ?? threadId;
        if (delivery === "detached" && reviewThreadId !== threadId) {
          void loadThreadIntoCache(reviewThreadId);
        }
        // Consume the turn returned by review/start so the inline review
        // waterfall is visible immediately. Inline review turns emit item
        // notifications but no parent `turn/started`, so seed the turn here
        // in both the TopicTranscriptStore (the waterfall driver) and App state.
        if (delivery === "inline") {
          const reviewTurn = reviewStartTurnToWorkbenchTurn(reviewThreadId, asRecord(asRecord(result).turn));
          if (reviewTurn) {
            transcriptRuntime.mergeTurn(reviewTurn);
            dispatch({ type: "threadTurnMerged", turn: reviewTurn });
          }
        }
        setSlashNotice({
          id: `review-${Date.now()}`,
          title: delivery === "detached" ? "Detached review started" : "Review started",
          message: reviewTargetLabel(target),
          severity: "success"
        });
      } catch (error) {
        dispatch({ type: "error", message: errorMessage("Review start", error) });
      }
    },
    [client, dangerBypassPermissionConfirmed, ensureActiveThread, isMiniBackend, loadThreadIntoCache, permission, transcriptRuntime.mergeTurn]
  );

  const showDiffToRemote = useCallback(async () => {
    try {
      const result = asRecord(
        state.token
          ? await fetchWorkspaceGit(state.token, "gitDiffToRemote", { cwd }).catch(() => client.rpc("gitDiffToRemote", { cwd }))
          : await client.rpc("gitDiffToRemote", { cwd })
      );
      const sha = stringValue(result.sha);
      const diff = stringValue(result.diff) ?? "";
      setSlashNotice({
        id: `diff-${Date.now()}`,
        title: "Diff to remote",
        message: formatDiffNotice(sha, diff),
        severity: diff.trim() ? "info" : "success"
      });
    } catch (error) {
      dispatch({ type: "error", message: errorMessage("Diff to remote", error) });
    }
  }, [client, cwd, state.token]);

  const compactActiveThread = useCallback(async () => {
    const threadId = state.activeThreadId;
    if (!threadId) {
      dispatch({ type: "error", message: "Select or start a conversation before compacting context" });
      return;
    }
    try {
      const compactParams: Record<string, JsonValue> = { threadId };
      if (isClaudeBackend) {
        const providerId = activeProviderId ?? "";
        const model = resolveSelectedModel(state.providers, providerId, selectedModel, activeGroupId);
        const groupId = resolveTextRuntimeGroupId(state.providers, providerId, activeGroupId, model);
        if (!providerId || !groupId || !model) {
          throw new Error("Claude compaction requires an active relay, text group, and model");
        }
        compactParams.__claudeCompactionRoute = { providerId, groupId, model };
      } else if (isAgyBackend || isGrokBackend || isPiBackend || isOpencodeBackend || isOpencodeV2Backend || isMiniBackend) {
        compactParams.cliBackend = isOpencodeV2Backend ? "opencode-v2" : isOpencodeBackend ? "opencode" : isPiBackend ? "pi" : isGrokBackend ? "grok" : isMiniBackend ? "mini" : "agy";
        if (activeProviderId) compactParams.providerId = activeProviderId;
        if (activeGroupId) compactParams.groupId = activeGroupId;
        if (selectedModel) compactParams.model = selectedModel;
      }
      await client.rpc("thread/compact/start", compactParams);
      setSlashNotice({
        id: `compact-${Date.now()}`,
        title: "Context compaction started",
        message: `Compacting ${threadId}`,
        severity: "success"
      });
    } catch (error) {
      dispatch({ type: "error", message: errorMessage("Compact context", error) });
    }
  }, [activeGroupId, activeProviderId, client, isClaudeBackend, isAgyBackend, isGrokBackend, isPiBackend, isOpencodeBackend, isOpencodeV2Backend, isMiniBackend, selectedModel, state.activeThreadId, state.providers]);

  const resumeThreadFromSlash = useCallback(
    async (threadId?: string) => {
      const targetThreadId = threadId?.trim();
      if (!targetThreadId) {
        setLeftPanelVisible(true);
        setHistorySearchTerm("");
        setSlashNotice({
          id: `resume-history-${Date.now()}`,
          title: "Resume history opened",
          message: "Select a Codex thread from the left history rail to resume it.",
          severity: "info"
        });
        return;
      }
      try {
        const resumeCwd = cwdForThread(targetThreadId);
        const fallbackSelection = historySelectionForThread(targetThreadId);
        const targetSelection = await loadPersistedThreadRuntimeSelection(targetThreadId, fallbackSelection);
        const effectiveProviderId = resolveProviderSelectionId(state.providers, targetSelection.providerId ?? activeProviderId, codexConfig?.modelProvider);
        const effectiveModel = resolveSelectedModel(state.providers, effectiveProviderId, targetSelection.model || selectedModel, targetSelection.groupId);
        const effectiveModelProvider = resolveSelectedModelProvider(state.providers, effectiveProviderId, codexConfig?.modelProvider);
        const effectiveGroupId = resolveTextRuntimeGroupId(state.providers, effectiveProviderId, targetSelection.groupId, effectiveModel);
        const targetThread = state.threads.find((entry: ClientState["threads"][number]) => entry.id === targetThreadId)
          ?? allHistoryThreadsRef.current.find((entry: ThreadEntry) => entry.id === targetThreadId);
        const persistedResumeCwd = normalizeWorkspaceCwd(targetSelection.cwd ?? "");
        const resumeAdditionalRoots = normalizeWorkspaceRoots(
          persistedResumeCwd || resumeCwd,
          targetSelection.additionalRoots ?? targetThread?.additionalRoots ?? []
        );
        const permissionOverrides = permissionToTurnOverrides(targetSelection.permission, resumeCwd, resumeAdditionalRoots);
        const resumeParams: Record<string, JsonValue> = {
          threadId: targetThreadId,
          cwd: resumeCwd,
          ...(resumeAdditionalRoots.length > 0 ? { runtimeWorkspaceRoots: [resumeCwd, ...resumeAdditionalRoots] } : {}),
          approvalPolicy: permissionOverrides.approvalPolicy,
          sandbox: permissionOverrides.sandbox
        };
        if (targetSelection.vmEnabled) {
          resumeParams.config = buildSaVmThreadConfig(undefined, true)!;
          resumeParams.developerInstructions = saVmDeveloperInstructions(targetSelection.vmPolicy, targetSelection.cliBackend);
        } else if (hasEnhanceToolsEnabled(targetSelection.vmPolicy?.tools)) {
          resumeParams.dynamicTools = [enhanceDynamicToolSpec(targetSelection.vmPolicy)] as unknown as JsonValue;
          resumeParams.developerInstructions = enhanceDeveloperInstructions(targetSelection.vmPolicy);
        }
        if (effectiveModel) {
          resumeParams.model = effectiveModel;
        }
        if (effectiveModelProvider) {
          resumeParams.modelProvider = effectiveModelProvider;
        }
        if (effectiveProviderId) {
          resumeParams.providerId = effectiveProviderId;
        }
        if (effectiveGroupId) {
          resumeParams.groupId = effectiveGroupId;
        }
        debugLog("slash thread/resume", resumeParams);
        await client.rpc("thread/resume", resumeParams);
        await loadThread(targetThreadId);
        setSlashNotice({
          id: `resume-${Date.now()}`,
          title: "Thread resumed",
          message: targetThreadId,
          severity: "success"
        });
      } catch (error) {
        if (isThreadWriterConflict(error)) {
          writerConflictThreadIdsRef.current.add(targetThreadId);
          dispatch({ type: "error", message: t("notifications.writerConflict.message") });
          setSlashNotice({
            id: `writer-conflict-${Date.now()}`,
            title: t("notifications.writerConflict.title"),
            message: t("notifications.writerConflict.message"),
            severity: "warning"
          });
        } else {
          dispatch({ type: "error", message: errorMessage("Resume thread", error) });
        }
      }
    },
    [activeProviderId, client, codexConfig?.modelProvider, cwdForThread, historySelectionForThread, loadPersistedThreadRuntimeSelection, loadThread, selectedModel, state.providers, t]
  );

  const runImageCommand = useCallback(
    async (command: Extract<ComposerSlashCommand, { type: "image" }>, images: ComposerImageAttachment[]) => {
      const prompt = command.prompt.trim();
      if (!prompt) {
        setComposerSuggestion({ id: `image-${Date.now()}`, text: command.mode === "edit" ? "/edit-image " : "/image " });
        return;
      }
      if (!state.token) {
        dispatch({ type: "error", message: "Image generation requires an active session" });
        return;
      }
      const resolvedImageRuntime = resolveImageRuntime(state.providers, imageRuntimeSelection, command.mode, activeProviderId);
      if (!resolvedImageRuntime) {
        dispatch({ type: "error", message: "当前中转站没有生图分组，请配置后继续" });
        return;
      }
      const { provider, group: imageGroup } = resolvedImageRuntime;
      const imageConfig = imageGroup.image ?? provider.image;
      if (command.mode === "generate" && !imageConfig?.generations) {
        dispatch({ type: "error", message: `${provider.name} does not advertise /images/generations` });
        return;
      }
      if (command.mode === "edit" && !imageConfig?.edits) {
        dispatch({ type: "error", message: `${provider.name} does not advertise /images/edits` });
        return;
      }
      const imageAttachments = images.filter((image: ComposerImageAttachment) => (image.kind ?? "image") === "image");
      if (command.mode === "edit" && imageAttachments.length === 0) {
        dispatch({ type: "error", message: "Attach an image before using /edit-image" });
        return;
      }

      const requestedModel = command.model?.trim();
      if (requestedModel && !isLikelyImageModelId(requestedModel)) {
        dispatch({ type: "error", message: "图片分组只能使用图片模型，请选择图片模型后再生成" });
        return;
      }
      const imageModels = (imageGroup.models ?? []).filter(isLikelyImageModelId);
      const model = requestedModel
        ?? (imageConfig?.defaultModel && isLikelyImageModelId(imageConfig.defaultModel) ? imageConfig.defaultModel : undefined)
        ?? imageModels[0]
        ?? resolvedImageRuntime.model;
      const requestId = crypto.randomUUID();
      updateImageRuntimeSelection({ providerId: provider.id, groupId: imageGroup.id, model });

      let pendingThreadId: string | null = null;
      let pendingTurnId: string | null = null;
      try {
        const threadId = await ensureActiveThread();
        pendingThreadId = threadId;
        updateImageRuntimeSelection({ providerId: provider.id, groupId: imageGroup.id, model }, threadId);
        const localTurnId = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingTurnId = localTurnId;
        const pendingItems = buildPendingImageThreadItems({
          prompt,
          mode: command.mode,
          sourceImages: imageAttachments,
          provider,
          group: imageGroup,
          requestId,
          model
        });
        const pendingTurns = buildLocalImageThreadTurns({
          threadId,
          turnId: localTurnId,
          prompt,
          mode: command.mode,
          sourceImages: imageAttachments,
          result: null,
          provider,
          group: imageGroup,
          requestId,
          items: pendingItems,
          status: "running"
        });
        transcriptRuntime.mergeSnapshot(null, pendingTurns);
        dispatch({
          type: "threadMerged",
          thread: null,
          turns: pendingTurns
        });
        await waitForNextPaint();
        const result = await executeImageCommandRequest({
          token: state.token, mode: command.mode, providerId: provider.id, groupId: imageGroup.id, prompt, model, requestId,
          protocol: command.protocol ?? imageConfig?.defaultProtocol, images: imageAttachments
        }, imageJobsRef.current);
        if (!result.data?.length) {
          throw new Error("Image API returned no images");
        }
        const items = buildImageThreadItems({
          prompt,
          mode: command.mode,
          sourceImages: imageAttachments,
          result,
          provider,
          group: imageGroup,
          requestId
        });
        const completedTurns = buildLocalImageThreadTurns({
            threadId,
            turnId: localTurnId,
            prompt,
            mode: command.mode,
            sourceImages: imageAttachments,
            result,
            provider,
            group: imageGroup,
            requestId,
            items,
            status: "completed"
          });
        if (completedTurns[0]) {
          transcriptRuntime.replaceTurn(completedTurns[0]);
          dispatch({ type: "threadTurnReplaced", turn: completedTurns[0] });
        }
        try {
          await withTimeout(
            saveImageHistory(state.token, { threadId, turnId: localTurnId, requestId, status: "completed", items }),
            10_000,
            "Timed out saving generated image to thread"
          );
        } catch (error) {
          const message = `Image generated, but saving it to history failed: ${formatErrorText(error)}`;
          console.warn(message, error);
          setSlashNotice({
            id: `image-save-failed-${Date.now()}`,
            title: "Image history save failed",
            message,
            severity: "warning"
          });
          return;
        }
        setSlashNotice({
          id: `image-${Date.now()}`,
          title: command.mode === "edit" ? "Image edit completed" : "Image generated",
          message: `${provider.name} · ${model}`,
          severity: "success"
        });
      } catch (error) {
        if (pendingThreadId && pendingTurnId) {
          const failedItems = buildFailedImageThreadItems({
            prompt,
            mode: command.mode,
            sourceImages: imageAttachments,
            provider,
            group: imageGroup,
            requestId,
            model,
            message: formatErrorText(error)
          });
          const failedTurns = buildLocalImageThreadTurns({
              threadId: pendingThreadId,
              turnId: pendingTurnId,
              prompt,
              mode: command.mode,
              sourceImages: imageAttachments,
              result: null,
              provider,
              items: failedItems,
              status: "failed"
            });
          if (failedTurns[0]) {
            transcriptRuntime.replaceTurn(failedTurns[0]);
            dispatch({ type: "threadTurnReplaced", turn: failedTurns[0] });
          }
          try {
            await withTimeout(saveImageHistory(state.token, {
              threadId: pendingThreadId, turnId: pendingTurnId, requestId, status: "failed", items: failedItems
            }), 10_000, "Timed out saving image failure to history");
          } catch (historyError) {
            console.warn("[image history] failed to persist failed job", { requestId, error: historyError });
          }
        }
        dispatch({ type: "error", message: errorMessage(command.mode === "edit" ? "Image edit" : "Image generation", error) });
      }
    },
    [activeProviderId, ensureActiveThread, imageRuntimeSelection, state.providers, state.token, transcriptRuntime.mergeSnapshot, transcriptRuntime.replaceTurn, updateImageRuntimeSelection]
  );

  const answerRequest = useCallback(
    (id: string | number, decision: "accept" | "acceptForSession" | "decline" | "cancel") => {
      const request = state.pendingRequests.find((entry: PendingServerRequest) => entry.id === id);
      client.respondToServerRequest(id, buildServerRequestDecisionResponse(request?.method, request?.params, decision));
      dispatch({ type: "serverRequestResolved", id });
    },
    [client, state.pendingRequests]
  );

  const respondToServerRequest = useCallback(
    (id: string | number, result: JsonValue) => {
      client.respondToServerRequest(id, result);
      dispatch({ type: "serverRequestResolved", id });
    },
    [client]
  );

  return {
    schedulePlanContinuation,
    stayInPlanMode,
    implementApprovedPlan,
    setGoalForActiveThread,
    renameActiveThread,
    startReview,
    showDiffToRemote,
    compactActiveThread,
    resumeThreadFromSlash,
    runImageCommand,
    answerRequest,
    respondToServerRequest,
  };
}
