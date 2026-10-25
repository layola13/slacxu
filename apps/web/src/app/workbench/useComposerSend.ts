import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ComposerImageAttachment, ComposerMention } from "../../state/codexClient";
import type { StartCodexTurnOptions } from "./appConstants";
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
import type { useComposerAssists } from "./useComposerAssists";
import type { RightWorkspaceTab } from "../../components/RightWorkspacePanel";
import type { ThreadTokenUsageState } from "../../components/ChatPanel";
import type { useTopicTranscriptRuntime } from "../transcripts/useTopicTranscriptRuntime";

export function useComposerSend(input: ComposerCoreInput & {
  startCodexTurn: (text: string, images: ComposerImageAttachment[], mentions: ComposerMention[], options?: StartCodexTurnOptions) => Promise<string | null>;
  ensureActiveThread: () => Promise<string>;
  planModeEnabled: boolean;
  isMiniBackend: boolean;
  resumeThreadFromSlash: ReturnType<typeof useComposerAssists>["resumeThreadFromSlash"];
  compactActiveThread: ReturnType<typeof useComposerAssists>["compactActiveThread"];
  startReview: ReturnType<typeof useComposerAssists>["startReview"];
  runImageCommand: ReturnType<typeof useComposerAssists>["runImageCommand"];
  renameActiveThread: ReturnType<typeof useComposerAssists>["renameActiveThread"];
  setGoalForActiveThread: ReturnType<typeof useComposerAssists>["setGoalForActiveThread"];
  showDiffToRemote: ReturnType<typeof useComposerAssists>["showDiffToRemote"];
  sideChatTabs: SideChatTab[];
  setSideChatTabs: Dispatch<SetStateAction<SideChatTab[]>>;
  setSideChatError: Dispatch<SetStateAction<string | null>>;
  sideChatInFlightRef: MutableRefObject<Set<string>>;
  setRightWorkspaceTab: Dispatch<SetStateAction<RightWorkspaceTab>>;
  setRightWorkspaceVisible: Dispatch<SetStateAction<boolean>>;
  threadTokenUsage: Record<string, ThreadTokenUsageState>;
  transcriptRuntime: ReturnType<typeof useTopicTranscriptRuntime>;
  setActiveGoalStatus: import("../goals/useGoalLifecycle").GoalLifecycle["setGoalStatus"];
  disablePlanAutoContinuation: (threadId?: string) => void;
  threadGoals: Record<string, import("../../components/ChatPanel").GoalBannerState>;
  setWelcomeDismissed: Dispatch<SetStateAction<boolean>>;
  setStatsPanelScope: Dispatch<SetStateAction<"status" | "stats" | null>>;
  requestNewSession: (permission: import("@codex-ui/shared").PermissionPresetId) => void;
  openSettings: (section?: import("../../settings/SettingsDrawer").SettingsSectionId, pluginTab?: import("../../components/CodexPluginSettingsPanel").CodexPluginSettingsTab, relayTarget?: { providerId?: string; groupId?: string }) => void;
  clearActiveGoal: import("../goals/useGoalLifecycle").GoalLifecycle["clearActiveGoal"];
  providersRef: MutableRefObject<ProviderConfig[]>;
  freeCompactBarrierRef: MutableRefObject<(() => Promise<void>) | null>;
  jevCompressDirectiveRef: MutableRefObject<((options?: { threadId?: string }) => Promise<string | void>) | null>;
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
    startCodexTurn, ensureActiveThread, planModeEnabled, isMiniBackend, resumeThreadFromSlash,
    compactActiveThread, startReview, runImageCommand, renameActiveThread, setGoalForActiveThread,
    showDiffToRemote, sideChatTabs, setSideChatTabs, setSideChatError, sideChatInFlightRef,
    setRightWorkspaceTab, setRightWorkspaceVisible, threadTokenUsage, transcriptRuntime,
    setActiveGoalStatus, disablePlanAutoContinuation, threadGoals, setWelcomeDismissed,
    setStatsPanelScope, requestNewSession, openSettings, clearActiveGoal, providersRef,
    freeCompactBarrierRef, jevCompressDirectiveRef,
  } = input;
  const handleComposerSlashCommand = useCallback(
    async (command: ComposerSlashCommand, images: ComposerImageAttachment[], mentions: ComposerMention[]) => {
      switch (command.type) {
        case "image":
          await runImageCommand(command, images);
          return;
        case "fast":
          updateRuntimeSelection({ fastModeEnabled: command.enabled ?? !fastModeEnabled });
          return;
        case "stats":
          setStatsPanelScope(command.scope);
          return;
        case "assistantTurn":
          await startCodexTurn(command.prompt, images, mentions);
          return;
        case "plan":
          if (command.action === "toggle") {
            if (planModeEnabled) disablePlanAutoContinuation();
            updateRuntimeSelection({ planModeEnabled: !planModeEnabled });
            return;
          }
          if (command.action === "on") {
            updateRuntimeSelection({ planModeEnabled: true });
            return;
          }
          if (command.action === "off") {
            disablePlanAutoContinuation();
            updateRuntimeSelection({ planModeEnabled: false });
            return;
          }
          updateRuntimeSelection({ planModeEnabled: true });
          await startCodexTurn(command.prompt, images, mentions, {
            collaborationMode: "plan",
            enablePlanAutoContinuation: true
          });
          return;
        case "goal":
          if (command.action === "set") {
            await setGoalForActiveThread(command.objective);
            return;
          }
          if (command.action === "clear") {
            await clearActiveGoal();
            return;
          }
          if (command.action === "pause") {
            await setActiveGoalStatus("paused");
            return;
          }
          if (command.action === "resume") {
            await setActiveGoalStatus("active");
            return;
          }
          if (command.action === "complete") {
            await setActiveGoalStatus("complete");
            return;
          }
          if (command.action === "edit") {
            const existing = state.activeThreadId ? threadGoals[state.activeThreadId] : null;
            setComposerSuggestion({ id: `goal-edit-${Date.now()}`, text: existing ? `/goal ${existing.objective}` : "/goal " });
            return;
          }
          setStatsPanelScope("status");
          return;
        case "rename":
          await renameActiveThread(command.name);
          return;
        case "review": {
          const review = parseReviewCommand(command.value);
          await startReview(review.target, review.delivery);
          return;
        }
        case "diff":
          await showDiffToRemote();
          return;
        case "compact":
          await compactActiveThread();
          return;
        case "resumeThread":
          await resumeThreadFromSlash(command.threadId);
          return;
        case "newConversation":
          requestNewSession(command.permission ?? permission);
          return;
        case "openSettings":
          openSettings(command.section, command.pluginTab);
          return;
        case "openWorkspace":
          setRightWorkspaceTab(command.tab);
          setRightWorkspaceVisible(true);
          return;
        case "unsupported":
          if (isClaudeBackend || isAgyBackend || isGrokBackend || isPiBackend || isOpencodeBackend || isOpencodeV2Backend) {
            // The Claude/AGY CLI interprets some slash commands through its own
            // native handling; forward the raw text as a normal turn so the
            // CLI can process it instead of dropping it on a notice.
            await startCodexTurn(`/${command.name}`, images, mentions);
            return;
          }
          setSlashNotice({
            id: `unsupported-slash-${Date.now()}`,
            title: `/${command.name} is not available in Web`,
            message: "This Codex command requires a TUI-only workflow or a Web equivalent that is not implemented yet.",
            severity: "warning"
          });
          return;
      }
    },
    [
      clearActiveGoal,
      compactActiveThread,
      disablePlanAutoContinuation,
      isClaudeBackend,
      openSettings,
      permission,
      renameActiveThread,
      requestNewSession,
      resumeThreadFromSlash,
      runImageCommand,
      setActiveGoalStatus,
      setGoalForActiveThread,
      showDiffToRemote,
      startReview,
      startCodexTurn,
      state.activeThreadId,
      threadGoals
    ]
  );

  const sendPrompt = useCallback(
    async (text: string, images: ComposerImageAttachment[], mentions: ComposerMention[]) => {
      setWelcomeDismissed(true);
      const slashCommand = parseComposerSlashCommand(text, images, mentions);
      if (slashCommand) {
        await handleComposerSlashCommand(slashCommand, images, mentions);
        return true;
      }
      try { await freeCompactBarrierRef.current?.(); } catch (error) { console.warn("[free-auto-compact] barrier threw:", error); }
      let compressDirective = "";
      try { compressDirective = (await jevCompressDirectiveRef.current?.()) ?? ""; } catch (error) { console.warn("[jev-compress] directive threw:", error); }
      const activeTurn = state.activeThreadId ? latestActionableRunningTurn(state.turns, state.activeThreadId) : null;
      if (state.activeThreadId && activeTurn) {
        const threadId = await startCodexTurn(text, images, mentions, { steerOnly: true });
        return Boolean(threadId);
      }
      const threadId = await startCodexTurn(
        compressDirective ? `${text}\n\n${compressDirective}` : text,
        images,
        mentions,
        planModeEnabled
          ? { collaborationMode: "plan", enablePlanAutoContinuation: true, ...(compressDirective ? { displayText: text } : {}) }
          : (compressDirective ? { displayText: text } : {})
      );
      return Boolean(threadId);
    },
    [handleComposerSlashCommand, planModeEnabled, startCodexTurn, state.activeThreadId, state.turns]
  );

  const steerPrompt = useCallback(
    async (text: string, images: ComposerImageAttachment[], mentions: ComposerMention[]) => {
      setWelcomeDismissed(true);
      const threadId = await startCodexTurn(text, images, mentions, { steerOnly: true });
      return Boolean(threadId);
    },
    [startCodexTurn]
  );

  const sendSideChatPrompt = useCallback(
    async (tabId: string, text: string) => {
      const commandText = text;
      const titleText = commandText.trim();
      if (!titleText || sideChatInFlightRef.current.has(tabId)) {
        return;
      }
      const tab = sideChatTabs.find((entry: SideChatTab) => entry.id === tabId);
      if (!tab || tab.sending) {
        return;
      }
      if (permission === "dangerBypass" && !dangerBypassPermissionConfirmed) {
        setDangerDialogIntent({ source: "permission", nextPermission: "dangerBypass" });
        setDangerDialogAcknowledged(false);
        return;
      }
      const localMessage = {
        id: `sidechat-message-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text: commandText
      };
      sideChatInFlightRef.current.add(tabId);
      setSideChatError(null);
    setSideChatTabs((current: SideChatTab[]) =>
        current.map((entry: SideChatTab) =>
          entry.id === tabId
            ? {
                ...entry,
                title: entry.userMessages.length === 0 ? sideChatTitle(titleText, current.filter((candidate: SideChatTab) => candidate.id !== entry.id).length + 1) : entry.title,
                draft: "",
                sending: true,
                userMessages: [...entry.userMessages, localMessage]
              }
            : entry
        )
      );
      try {
        let threadId = tab.threadId;
        let turnCwd = cwdForThread(threadId);
        const existingSideThread = threadId
          ? state.threads.find((entry: ClientState["threads"][number]) => entry.id === threadId)
            ?? allHistoryThreadsRef.current.find((entry: ThreadEntry) => entry.id === threadId)
          : undefined;
        const sideWorkspace = resolveThreadWorkspace(existingSideThread, {
          workspaceMode,
          sshCommand,
          localCwd: localWorkspaceDefaultPath,
          sshCwd: turnCwd
        });
        const sideAdditionalRoots = sideWorkspace.workspaceMode === "local"
          ? normalizeWorkspaceRoots(sideWorkspace.cwd, existingSideThread ? sideWorkspace.additionalRoots : additionalRoots)
          : [];
        // Fresh side chat tabs default to the duck2api route (gpt-6-luna);
        // existing threads keep their persisted selection.
        const baseSideSelection = threadId ? selectionForThread(threadId) : selectionForThread(null);
        const duckSelected = threadId
          ? baseSideSelection
          : applySideChatDuckDefault(baseSideSelection, state.providers);
        // Explicit per-tab model switch wins over the duck default.
        const tabModelOverride = tab.modelOverride?.trim() ? tab.modelOverride.trim() : null;
        const sideThreadSelection = tabModelOverride
          ? { ...duckSelected, model: tabModelOverride }
          : duckSelected;
        // Duck default route runs on the mini agent; the global backend
        // (e.g. opencode) must not override a fresh side chat tab.
        const sideDuckDefaulted = !threadId
          && sideThreadSelection.providerId === SIDE_CHAT_DUCK_PROVIDER_ID
          && sideThreadSelection.groupId === SIDE_CHAT_DUCK_GROUP_ID;
        const sideRequestedProviderId = sideThreadSelection.providerId ?? activeProviderId;
        const sideResolvedProviderId = resolveProviderSelectionId(state.providers, sideRequestedProviderId, codexConfig?.modelProvider);
        const sideEffectiveCliBackend = sideDuckDefaulted
          ? "mini"
          : resolveEffectiveTurnCliBackend({
          currentBackend: runtimeSelection.cliBackend,
          threadBackend: sideThreadSelection.cliBackend,
          resolvedProviderId: sideResolvedProviderId,
          fallback: sideThreadSelection.cliBackend ?? runtimeSelection.cliBackend ?? DEFAULT_CLI_BACKEND,
          includeMini: true,
        });

        let effectiveProviderId = sideResolvedProviderId;
        if (sideEffectiveCliBackend === "agy" && !effectiveProviderId) {
          effectiveProviderId = (activeProviderId && activeProviderId !== "agy-official" && state.providers.some((p: ProviderConfig) => p.id === activeProviderId))
            ? activeProviderId
            : "agy-official";
        }
        const isOfficialAgy = sideEffectiveCliBackend === "agy" && effectiveProviderId === "agy-official";
        const effectiveModel = isOfficialAgy
          ? (sideThreadSelection.model && AGY_OFFICIAL_MODELS.some((m: ModelEntry & { model: string; id: string; displayName: string }) => m.model === sideThreadSelection.model) ? sideThreadSelection.model : "gemini-3.8-flash-high")
          : resolveSelectedModel(state.providers, effectiveProviderId, sideThreadSelection.model || selectedModel, sideThreadSelection.groupId ?? activeGroupId);
        const effectiveModelProvider = resolveSelectedModelProvider(state.providers, effectiveProviderId, codexConfig?.modelProvider);
        const effectiveGroupId = isOfficialAgy
          ? null
          : resolveTextRuntimeGroupId(state.providers, effectiveProviderId, sideThreadSelection.groupId ?? activeGroupId, effectiveModel);
        let permissionOverrides = permissionToTurnOverrides(permission, turnCwd, sideAdditionalRoots);
        if (!threadId) {
          if (effectiveProviderId && sideEffectiveCliBackend === "codex" && effectiveProviderId !== "agy-official" && effectiveProviderId !== "grok-official" && effectiveProviderId !== "pi-relay" && effectiveProviderId !== "opencode-local") {
            const sideActivationKey = `${effectiveProviderId}:${effectiveGroupId ?? ""}:${effectiveModel || ""}`;
            if (activatedProviderSelectionRef.current !== sideActivationKey) {
              await client.activateProvider(effectiveProviderId, effectiveModel || undefined, effectiveGroupId ?? undefined);
              activatedProviderSelectionRef.current = sideActivationKey;
            }
          }
          const startParams: Record<string, JsonValue> = {
            cwd: turnCwd,
            sandbox: permissionOverrides.sandbox,
            approvalPolicy: permissionOverrides.approvalPolicy,
            sessionStartSource: "startup",
            historyMode: "legacy",
            cliBackend: sideEffectiveCliBackend
          };
          // Pure-conversation side chat (duck route): no agent tools, no
          // developer instructions, no thread config — plain dialogue only.
          // Route-matched (not just fresh tabs) so existing duck threads
          // stay pure too.
          const sidePureChat = sideThreadSelection.providerId === SIDE_CHAT_DUCK_PROVIDER_ID
            && sideThreadSelection.groupId === SIDE_CHAT_DUCK_GROUP_ID;
          if (sidePureChat) {
            startParams.pureChat = true;
          } else if (runtimeSelection.vmEnabled) {
            startParams.dynamicTools = [saVmDynamicToolSpec(runtimeSelection.vmPolicy)] as unknown as JsonValue;
            startParams.developerInstructions = saVmDeveloperInstructions(runtimeSelection.vmPolicy, sideEffectiveCliBackend);
          } else if (hasEnhanceToolsEnabled(runtimeSelection.vmPolicy?.tools)) {
            startParams.dynamicTools = [enhanceDynamicToolSpec(runtimeSelection.vmPolicy)] as unknown as JsonValue;
            startParams.developerInstructions = enhanceDeveloperInstructions(runtimeSelection.vmPolicy);
          }
          const threadConfig = buildSaVmThreadConfig(buildAgentThreadConfig(runtimeSelection.agents), runtimeSelection.vmEnabled);
          if (threadConfig && !sidePureChat) startParams.config = threadConfig;
          addWorkspaceRpcMetadata(startParams, workspaceMode, sshCommand, turnCwd, effectiveProviderId, effectiveGroupId, additionalRoots);
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
          threadId = typeof thread.id === "string" ? thread.id : null;
          if (!threadId) {
            throw new Error("Codex did not return a sidechat thread id");
          }
          const nextThreadId = threadId;
          setSideChatTabs((current: SideChatTab[]) => current.map((entry: SideChatTab) => (entry.id === tabId ? { ...entry, threadId: nextThreadId } : entry)));
        } else {
          turnCwd = cwdForThread(threadId);
          permissionOverrides = permissionToTurnOverrides(permission, turnCwd, sideAdditionalRoots);
        }
        const turnParams: Record<string, JsonValue> = {
          threadId,
          input: composerInputToUserInput(commandText, tab.attachments ?? [], [], { preserveText: true }),
          cwd: turnCwd,
          sandboxPolicy: permissionOverrides.sandboxPolicy,
          approvalPolicy: permissionOverrides.approvalPolicy,
          effort: reasoningEffort,
          cliBackend: sideEffectiveCliBackend,
          ...(effectiveProviderId ? { providerId: effectiveProviderId } : {}),
          ...(isOfficialAgy ? { groupId: null } : effectiveGroupId ? { groupId: effectiveGroupId } : {})
        };
        // Duck.ai-style server-side web search (relayed end-to-end to the
        // embedded channel when set). Duck route only — other backends
        // would receive an unknown param.
        if (shouldSendSideChatWebSearch(tab.webSearch, sideThreadSelection)) {
          turnParams.web_search = true;
        }
        // Pure-conversation side chat travels on the turn too (miniBridge
        // gates tools/MCP/skills/memory off it).
        if (sideThreadSelection.providerId === SIDE_CHAT_DUCK_PROVIDER_ID
          && sideThreadSelection.groupId === SIDE_CHAT_DUCK_GROUP_ID) {
          turnParams.pureChat = true;
        }
        addWorkspaceRpcMetadata(turnParams, sideWorkspace.workspaceMode, sideWorkspace.sshCommand, turnCwd, effectiveProviderId, effectiveGroupId, sideAdditionalRoots);
        if (effectiveModel) {
          turnParams.model = effectiveModel;
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
          cwd: turnCwd,
          additionalRoots: sideAdditionalRoots,
          cliBackend: sideEffectiveCliBackend,
           fastModeEnabled: runtimeSelection.fastModeEnabled,
           planModeEnabled: runtimeSelection.planModeEnabled,
           vmEnabled: runtimeSelection.vmEnabled,
           vmPolicy: runtimeSelection.vmPolicy
        });
        await client.rpc("turn/start", turnParams);
        if (permission === "dangerBypass") {
          await loadAuditEvents();
        }
        setSideChatTabs((current: SideChatTab[]) => current.map((entry: SideChatTab) => (entry.id === tabId ? { ...entry, sending: false, attachments: [] } : entry)));
      } catch (error) {
        setSideChatError(formatErrorText(error));
        setSideChatTabs((current: SideChatTab[]) =>
          current.map((entry: SideChatTab) =>
            entry.id === tabId
              ? { ...entry, draft: commandText, sending: false, userMessages: entry.userMessages.filter((message: { id: string; text: string }) => message.id !== localMessage.id) }
              : entry
          )
        );
      } finally {
        sideChatInFlightRef.current.delete(tabId);
      }
    },
    [
      activeProviderId,
      activeGroupId,
      client,
      codexConfig?.modelProvider,
      cwdForThread,
      dangerBypassPermissionConfirmed,
      isAgyBackend,
      isClaudeBackend,
      isGrokBackend,
      isOpencodeBackend,
      isPiBackend,
      loadAuditEvents,
      permission,
      persistThreadRuntimeSelection,
      reasoningEffort,
      runtimeSelection.agents,
      runtimeSelection.cliBackend,
      runtimeSelection.fastModeEnabled,
      runtimeSelection.groupId,
      runtimeSelection.model,
      runtimeSelection.planModeEnabled,
      runtimeSelection.providerId,
      runtimeSelection.vmEnabled,
      runtimeSelection.vmPolicy,
      selectedModel,
      selectionForThread,
      sideChatTabs,
      sshCommand,
      state.providers,
      workspaceMode
    ]
  );
  return {
    handleComposerSlashCommand,
    sendPrompt,
    steerPrompt,
    sendSideChatPrompt,
  };
}
