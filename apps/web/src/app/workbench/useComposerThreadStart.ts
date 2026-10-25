import { useCallback } from "react";
import {
  hasEnhanceToolsEnabled,
  permissionToTurnOverrides,
  resolveModelContextWindow,
  stripModelContextVariant,
  type ChannelGroupConfig,
  type JsonValue,
  type ProviderConfig,
} from "@codex-ui/shared";
import {
  composerInputToUserInput,
  findBestFreebuffFallback,
  releaseFreebuffSessionSlot,
  saveThreadAgentRoster,
  syncSaVmWorkspaceSkill,
  threadReadToTurns,
  type ComposerImageAttachment,
  type ComposerMention,
  type FreebuffSessionStatus,
  type ModelEntry,
  type ThreadEntry,
  type WorkbenchItem,
  type WorkbenchTurn,
} from "../../state/codexClient";
import {
  asRecord,
  buildDefaultCollaborationMode,
  buildPlanCollaborationMode,
  countMatchingRealUserMessages,
  debugLog,
  extractTurnIdFromRpcResult,
  formatErrorText,
  stringValue,
} from "./appUtils";
import {
  buildSaVmThreadConfig,
  enhanceDeveloperInstructions,
  enhanceDynamicToolSpec,
  saVmDeveloperInstructions,
  saVmDynamicToolSpec,
} from "../cli/saVmExecutionSpec";
import {
  extractActualActiveTurnId,
  interruptTurnWithRetry,
  isTurnNoLongerActiveError,
  type InterruptRetryEvent,
} from "../turnInterruptRetry";
import { committedTurnResult, resolveThreadWorkspace } from "../threads/editConversation";
import { isAmbiguousSendError, reconcileAmbiguousSend } from "../../composer/sendReconcile";
import { isCannotSteerReviewTurnError, isReviewModeActive } from "../reviewTurn";
import { isThreadWriterConflict } from "../threadWriterConflict";
import { observeTurnStarted } from "../../goalContinuation";
import { loadJevConfig } from "../../../../../frontends/jev/src/jev/jevConfig";
import { mergeThreadLists } from "../threads/threadCatalog";
import { joinWorkspacePath, normalizeWorkspaceCwd, normalizeWorkspaceRoots } from "../../workspacePaths";
import {
  latestActionableRunningTurn,
  runningTurnsForThread,
  staleRunningTurnsForThread,
} from "../transcripts/topicRuntimeIndex";
import {
  resolveComposerTextGroup,
  resolveProviderSelectionId,
  resolveSelectedModel,
  resolveSelectedModelProvider,
  resolveTextRuntimeGroupId,
} from "./modelSelectionUtils";
import { DEFAULT_CLI_BACKEND } from "../cli/cliPlugins";
import { resolveEffectiveTurnCliBackend } from "../cli/resolveEffectiveTurnCliBackend";
import { buildAgentThreadConfig, runtimeSelectionFallbackForThread } from "../runtime/useThreadRuntimeSelections";
import { addWorkspaceRpcMetadata, preflightSshWorkspace } from "./sshUtils";
import { classifyRemoteTurnError } from "../../remoteTurnErrors";
import { openTaskTab } from "../../taskTabs";
import { AGY_OFFICIAL_MODELS, GROK_OFFICIAL_MODELS, type StartCodexTurnOptions } from "./appConstants";
import type { PendingAppendMessage } from "../../waterfall/pendingRows";
import type { ComposerCoreInput } from "./composerCoreContext";

export function useComposerThreadStart(input: ComposerCoreInput) {
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
  const ensureActiveThread = useCallback(async (): Promise<string> => {
    if (activeThreadIdRef.current) {
      return activeThreadIdRef.current;
    }
    if (workspaceSelectionPending) {
      setNewChatSetupOpen(true);
      throw new Error(t("workspace.required"));
    }
    if (workspaceMode === "ssh") {
      if (!state.token) throw new Error("SSH workspace preflight requires an authenticated session");
      const preflight = await preflightSshWorkspace(state.token, sshCommand, cwdForThread(null));
      if (!preflight.ready) {
        setSshPreflightIssue(preflight);
        setSshInstallConfirming(false);
        setSshInstallError(null);
        throw new Error(preflight.reasons.join("; ") || "SSH workspace is not ready");
      }
    }
    const creationSelection = selectionForThread(null);
    const requestedProviderId = creationSelection.providerId ?? activeProviderId;
    const requestedGroupId = creationSelection.groupId ?? activeGroupId;
    const requestedModel = creationSelection.model || selectedModel;
    let availableProviders = state.providers;
    const requestedProviderAvailable = requestedProviderId && availableProviders.some((provider: ProviderConfig) => provider.id === requestedProviderId);
    const relayAvailable = availableProviders.some((provider: ProviderConfig) => provider.kind !== "chatgpt" && (provider.groups?.some((group: ChannelGroupConfig) => group.kind !== "image") || provider.nativeModels.length > 0));
    if (workspaceMode === "ssh" && state.token && (!requestedProviderAvailable || !relayAvailable)) {
      availableProviders = await refreshProviders(state.token, { force: true });
    }
    const isCreatingAgy = (creationSelection.cliBackend ?? runtimeSelection.cliBackend) === "agy";
    const isCreatingGrok = (creationSelection.cliBackend ?? runtimeSelection.cliBackend) === "grok";
    const isCreatingPi = (creationSelection.cliBackend ?? runtimeSelection.cliBackend) === "pi";
    const isCreatingOpencode = (creationSelection.cliBackend ?? runtimeSelection.cliBackend) === "opencode";
    const isCreatingOpencodeV2 = (creationSelection.cliBackend ?? runtimeSelection.cliBackend) === "opencode-v2";
    const effectiveCliBackend = (creationSelection.cliBackend ?? runtimeSelection.cliBackend) ?? DEFAULT_CLI_BACKEND;
    const resolvedRequestedProviderId = resolveProviderSelectionId(availableProviders, requestedProviderId, codexConfig?.modelProvider);
    const requestedProvider = availableProviders.find((provider: ProviderConfig) => provider.id === resolvedRequestedProviderId);
    const effectiveProviderId = isCreatingAgy
      ? (requestedProviderId && requestedProviderId !== "agy-official" && availableProviders.some((p: ProviderConfig) => p.id === requestedProviderId) ? requestedProviderId : "agy-official")
      : isCreatingGrok
        ? (requestedProviderId && requestedProviderId !== "grok-official" && availableProviders.some((p: ProviderConfig) => p.id === requestedProviderId) ? requestedProviderId : "grok-official")
        : isCreatingOpencode || isCreatingOpencodeV2
          ? (requestedProviderId && availableProviders.some((p: ProviderConfig) => p.id === requestedProviderId) ? requestedProviderId : "opencode-local")
          : ((workspaceMode !== "ssh" || requestedProvider?.kind !== "chatgpt" ? resolvedRequestedProviderId : null)
            ?? availableProviders.find((provider: ProviderConfig) => provider.kind !== "chatgpt" && (provider.groups?.some((group: ChannelGroupConfig) => group.kind !== "image") || provider.nativeModels.length > 0))?.id
            ?? null);
    if (workspaceMode === "ssh" && !effectiveProviderId) {
      throw new Error("SSH workspace requires a selected relay provider. Choose a relay before creating the conversation.");
    }
    const isOfficialAgy = (isCreatingAgy || isAgyBackend || effectiveCliBackend === "agy") && effectiveProviderId === "agy-official";
    const effectiveModel = isOfficialAgy
      ? (requestedModel && AGY_OFFICIAL_MODELS.some((m: ModelEntry & { model: string; id: string; displayName: string; }) => m.model === requestedModel) ? requestedModel : "gemini-3.8-flash-high")
      : isCreatingGrok && effectiveProviderId === "grok-official"
        ? (requestedModel && GROK_OFFICIAL_MODELS.some((m: ModelEntry & { model: string; id: string; displayName: string; }) => m.model === requestedModel) ? requestedModel : "grok-4.6")
        : resolveSelectedModel(availableProviders, effectiveProviderId, requestedModel, requestedGroupId);
    const effectiveModelProvider = resolveSelectedModelProvider(availableProviders, effectiveProviderId, codexConfig?.modelProvider);
    const effectiveGroupId = isOfficialAgy
      ? null
      : resolveTextRuntimeGroupId(availableProviders, effectiveProviderId, requestedGroupId, effectiveModel);
    if (effectiveProviderId && !isClaudeBackend && !isCreatingAgy && !isAgyBackend && !isCreatingGrok && !isGrokBackend && !isCreatingPi && !isPiBackend && !isCreatingOpencode && !isCreatingOpencodeV2 && !isOpencodeBackend && effectiveProviderId !== "agy-official" && effectiveProviderId !== "grok-official") {
      const activationKey = `${effectiveProviderId}:${effectiveGroupId ?? ""}:${effectiveModel || ""}`;
      if (activatedProviderSelectionRef.current !== activationKey) {
        await client.activateProvider(effectiveProviderId, effectiveModel || undefined, effectiveGroupId ?? undefined);
        activatedProviderSelectionRef.current = activationKey;
      }
    }
    const startCwd = cwdForThread(null);
    const permissionOverrides = permissionToTurnOverrides(permission, startCwd, additionalRoots);
    const startParams: Record<string, JsonValue> = {
      cwd: startCwd,
      sandbox: permissionOverrides.sandbox,
      approvalPolicy: permissionOverrides.approvalPolicy,
      sessionStartSource: "startup",
      historyMode: "legacy",
      cliBackend: effectiveCliBackend
    };
    if (runtimeSelection.vmEnabled) {
      startParams.dynamicTools = [saVmDynamicToolSpec(runtimeSelection.vmPolicy)] as unknown as JsonValue;
      startParams.developerInstructions = saVmDeveloperInstructions(runtimeSelection.vmPolicy, effectiveCliBackend);
    } else if (hasEnhanceToolsEnabled(runtimeSelection.vmPolicy?.tools)) {
      startParams.dynamicTools = [enhanceDynamicToolSpec(runtimeSelection.vmPolicy)] as unknown as JsonValue;
      startParams.developerInstructions = enhanceDeveloperInstructions(runtimeSelection.vmPolicy);
    }
    const threadConfig = buildSaVmThreadConfig(buildAgentThreadConfig(runtimeSelection.agents), runtimeSelection.vmEnabled);
    if (threadConfig) startParams.config = threadConfig;
    addWorkspaceRpcMetadata(startParams, workspaceMode, sshCommand, startCwd, effectiveProviderId, effectiveGroupId, additionalRoots);
    if (effectiveModel) {
      startParams.model = effectiveModel;
    }
    if (effectiveModelProvider) {
      startParams.modelProvider = effectiveModelProvider;
    }
    if (effectiveProviderId) {
      startParams.providerId = effectiveProviderId;
    }
    if (isOfficialAgy) {
      startParams.groupId = null;
    } else if (effectiveGroupId) {
      startParams.groupId = effectiveGroupId;
    }
    const threadResult = await client.rpc("thread/start", startParams);
    const thread = asRecord(asRecord(threadResult).thread);
    const threadId = stringValue(thread.id);
    if (!threadId) {
      throw new Error("Codex did not return a thread id");
    }
    if (state.token && runtimeSelection.agents.mode === "enabled") {
      void saveThreadAgentRoster(state.token, threadId, runtimeSelection.agents.roles, { startImmediate: true })
        .catch((error: unknown) => dispatch({
          type: "error",
          message: `Conversation created, but collaboration roles could not be started: ${formatErrorText(error)}`
        }));
    }
       await persistThreadRuntimeSelection({
      threadId,
      providerId: effectiveProviderId,
      groupId: effectiveGroupId,
      model: effectiveModel,
      reasoningEffort,
      freeAutoCompactEnabled: runtimeSelection.freeAutoCompactEnabled,
      freeAutoCompactThreshold: runtimeSelection.freeAutoCompactThreshold,
      freeAutoCompactModel: runtimeSelection.freeAutoCompactModel,
      freeAutoCompactProviderId: runtimeSelection.freeAutoCompactProviderId,
      freeAutoCompactGroupId: runtimeSelection.freeAutoCompactGroupId,
      permission,
      agents: runtimeSelection.agents,
      cwd: startCwd,
      additionalRoots: normalizeWorkspaceRoots(startCwd, additionalRoots),
      workspaceFilePath: workspaceMode === "local" ? (workspaceFilePath || joinWorkspacePath(startCwd, "cxu.code-workspace")) : "",
      cliBackend: effectiveCliBackend,
      fastModeEnabled: runtimeSelection.fastModeEnabled,
      planModeEnabled: runtimeSelection.planModeEnabled,
      vmEnabled: runtimeSelection.vmEnabled,
      vmPolicy: runtimeSelection.vmPolicy
    });
    patchThreadRuntimeSelection(threadId, {
      providerId: effectiveProviderId,
      groupId: effectiveGroupId,
      model: effectiveModel,
      reasoningEffort,
      permission,
      dangerBypassConfirmed: permission === "dangerBypass" ? dangerBypassPermissionConfirmed : false,
      agents: runtimeSelection.agents,
      cliBackend: effectiveCliBackend,
      vmEnabled: runtimeSelection.vmEnabled,
      vmPolicy: runtimeSelection.vmPolicy
    });
    if (state.token && workspaceMode === "local") {
      await syncSaVmWorkspaceSkill(state.token, {
        cwd: startCwd,
        enabled: Boolean(runtimeSelection.vmEnabled || hasEnhanceToolsEnabled(runtimeSelection.vmPolicy?.tools)),
        threadId,
        salaRoot: runtimeSelection.vmPolicy?.fs?.salaRoot,
        policy: runtimeSelection.vmPolicy,
        jevActiveTools: loadJevConfig().allowActiveTools
      }).catch((error: unknown) => console.warn("[sa-vm] failed to write thread skill", error));
    }
    const now = Math.floor(Date.now() / 1000);
    const startedThread = threadReadToTurns(threadResult).thread;
    const catalogThread: ThreadEntry = {
      ...(startedThread ?? { id: threadId }),
      id: threadId,
      model: startedThread?.model ?? effectiveModel,
      modelProvider: startedThread?.modelProvider ?? effectiveModelProvider ?? undefined,
      // The workspace selected in the new-chat dialog is authoritative. The
      // app-server may return its process cwd here, which would make the next
      // turn appear outside the thread VM roots.
      cwd: startCwd,
      createdAt: startedThread?.createdAt ?? now,
      updatedAt: startedThread?.updatedAt ?? now,
      recencyAt: startedThread?.recencyAt ?? now,
      status: startedThread?.status ?? "idle",
      // Without this the new thread sits under the Codex history filter until
      // the next full history reload re-reads it from the server.
      // Use effectiveCliBackend (freshly resolved from the new-conversation
      // selection) instead of runtimeSelection.cliBackend, which is a stale
      // closure here (ensureActiveThread deps don't include cliBackend): the
      // Codex app-server echoes no cliBackend for codex threads, so the stale
      // default ("mini") would mislabel a user-selected codex thread as mini
      // in the tab strip / history and poison runtimeSelectionFallbackForThread.
      cliBackend: startedThread?.cliBackend ?? effectiveCliBackend,
      workspaceMode: workspaceMode === "ssh" ? "ssh" : "local",
      additionalRoots: normalizeWorkspaceRoots(startCwd, additionalRoots),
      ...(workspaceMode === "ssh" ? { sshCommand: sshCommand.trim(), sshCwd: startCwd } : {})
    };
    optimisticThreadIdsRef.current.add(threadId);
    applyHistoryThreads(mergeThreadLists([catalogThread], allHistoryThreadsRef.current, state.threads));
    splitMutationEpochRef.current += 1;
    setWorkspaceLayout(null);
    setSplitView(null);
    setClosedTaskTabIds((current: string[]) => current.filter((id: string) => id !== threadId));
    activeThreadIdRef.current = threadId;
    dispatch({ type: "activeThread", threadId });
    setTaskTabOrder((current: string[]) => openTaskTab(current, threadId));
    return threadId;
  }, [activeGroupId, activeProviderId, applyHistoryThreads, client, codexConfig?.modelProvider, cwd, cwdForThread, dangerBypassPermissionConfirmed, localWorkspaceDefaultPath, patchThreadRuntimeSelection, permission, persistThreadRuntimeSelection, reasoningEffort, refreshProviders, runtimeSelection.agents, runtimeSelection.vmEnabled, runtimeSelection.vmPolicy, selectedModel, selectionForThread, sshCommand, state.providers, state.threads, state.token, t, workspaceMode, workspaceSelectionPending, additionalRoots]);

  const recordInterruptRetry = useCallback((threadId: string, turnId: string, event: InterruptRetryEvent) => {
    topicTranscriptStore.updateRetryErrorItem(threadId, turnId, {
      status: "failed",
      retrySource: "app"
    });
    const error = formatErrorText(event.error);
    topicTranscriptStore.appendRetryErrorItem(threadId, turnId, {
      title: event.willRetry ? "Retrying stop request" : "Stop request failed",
      text: `Stop turn: ${error}`,
      status: event.willRetry ? "running" : "failed",
      retrySource: "app",
      attempt: event.attempt,
      max: event.maxAttempts,
      delayMs: event.delayMs,
      exhausted: !event.willRetry,
      additionalDetails: event.willRetry
        ? `Attempt ${event.attempt} of ${event.maxAttempts}; retrying after ${event.delayMs}ms.`
        : `Attempt ${event.attempt} of ${event.maxAttempts}; no further retry is safe.`
    });
  }, [topicTranscriptStore]);

  const interruptTurn = useCallback(async (threadId: string, turnId: string) => {
    const thread = state.threads.find((t: ThreadEntry) => t.id === threadId)
      ?? allHistoryThreadsRef.current.find((t: ThreadEntry) => t.id === threadId);
    const backend = thread?.cliBackend ?? runtimeSelection.cliBackend;
    return interruptTurnGateRef.current.run(threadId, turnId, async () => {
      let retried = false;
      await interruptTurnWithRetry({
        rpc: (method: string, params: JsonValue | undefined, options: { timeoutMs?: number | null; } | undefined) => client.rpc(method, params, options),
        threadId,
        turnId,
        cliBackend: backend,
        onRetryEvent: (event: InterruptRetryEvent) => {
          retried = true;
          recordInterruptRetry(threadId, turnId, event);
        }
      });
      if (retried) {
        topicTranscriptStore.updateRetryErrorItem(threadId, turnId, {
          status: "completed",
          retrySource: "app",
          exhausted: false
        });
      }
    });
  }, [allHistoryThreadsRef, client, recordInterruptRetry, runtimeSelection.cliBackend, state.threads, topicTranscriptStore]);
  return { ensureActiveThread, recordInterruptRetry, interruptTurn };
}
