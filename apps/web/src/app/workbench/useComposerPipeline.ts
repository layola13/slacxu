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

export function useComposerPipeline(input: ComposerCoreInput & {
  ensureActiveThread: () => Promise<string>;
  interruptTurn: (threadId: string, turnId: string) => Promise<void>;
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
  const { ensureActiveThread, interruptTurn } = input;
  const startCodexTurn = useCallback(
    async (text: string, images: ComposerImageAttachment[], mentions: ComposerMention[], options: StartCodexTurnOptions = {}) => {
      const requestedThreadId = options.threadIdOverride ?? state.activeThreadId;
      if (!requestedThreadId && workspaceSelectionPending) {
        if (permission === "dangerBypass") {
          setDangerDialogIntent({ source: "new-chat", nextPermission: "dangerBypass" });
          setDangerDialogAcknowledged(false);
        } else {
          setNewChatSetupOpen(true);
        }
        return null;
      }
      if (!requestedThreadId && permission === "dangerBypass" && !dangerBypassPermissionConfirmed) {
        setDangerDialogIntent({ source: "permission", nextPermission: "dangerBypass" });
        setDangerDialogAcknowledged(false);
        return null;
      }
      const input = composerInputToUserInput(text, images, mentions, { preserveText: options.preserveText });
      if (input.length === 0) {
        return null;
      }
      if (!options.automaticPlanContinuation && requestedThreadId) {
        const scheduled = planContinuationTimersRef.current.get(requestedThreadId);
        if (scheduled !== undefined) {
          window.clearTimeout(scheduled);
          planContinuationTimersRef.current.delete(requestedThreadId);
        }
      }
      const displayText = (options.displayText ?? text).trim() || `${images.length + mentions.length} attachment${images.length + mentions.length === 1 ? "" : "s"}`;
      const inputText = text.trim() || displayText;
      const pendingThreadId = requestedThreadId;
      // 同步去重必须放在任何 await 之前，否则并发调用都读到旧 ref。
      const dedupeKey = `${pendingThreadId ?? "new-thread"}|${inputText.trim()}|img:${images.length}|men:${mentions.map((entry: ComposerMention) => entry.token ?? entry.path).join(",")}|mode:${options.collaborationMode ?? ""}|force:${options.forceNewTurn ? "1" : "0"}`;
      const dedupeNow = Date.now();
      const sendStartedAt = dedupeNow;
      const inFlightSend = startCodexTurnInFlightRef.current;
      // 上游慢/客户端网络慢时，同内容的上一次发送可能仍在 RPC 中（远超 2.5s）。
      // 此时再发一次 turn/start 必然造成重复消息，所以同 key 未落定前一律拦截。
      // 条目只在发送成功或失败落定后清除（见 clearSendDedupe），60s 是兜底，
      // 防止极端情况下落定回调丢失导致永久阻塞。
      if (inFlightSend && inFlightSend.key === dedupeKey && dedupeNow - inFlightSend.at < 60000) {
        return null;
      }
      startCodexTurnInFlightRef.current = { key: dedupeKey, at: dedupeNow };
      const clearSendDedupe = () => {
        if (startCodexTurnInFlightRef.current?.key === dedupeKey) {
          startCodexTurnInFlightRef.current = null;
        }
      };
      const pendingActiveTurn = !options.forceNewTurn && pendingThreadId ? latestActionableRunningTurn(state.turns, pendingThreadId) : null;
      const pendingReviewTurn = isReviewModeActive(pendingActiveTurn);
      const pendingAppendId = `${pendingActiveTurn && !pendingReviewTurn ? "pending-append" : "pending-user"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (!options.suppressUserMessage) {
        setPendingAppends((current: PendingAppendMessage[]) => [
          ...current,
          {
            id: pendingAppendId,
            threadId: pendingThreadId,
            turnId: pendingActiveTurn && !pendingReviewTurn ? pendingActiveTurn.id : pendingAppendId,
            text: displayText,
            inputText,
            createdAt: Date.now(),
            existingMatchingUserMessageCount: countMatchingRealUserMessages(state.turns, pendingThreadId, inputText),
            existingTurnUserMessageCount: pendingActiveTurn?.items.filter((item: WorkbenchItem) => item.type === "userMessage").length ?? 0,
            mode: pendingActiveTurn && !pendingReviewTurn ? "append" : "pendingUser"
          }
        ]);
      }
      let threadIdForResult: string | null = null;
      let creatingNewConversation = !requestedThreadId && !activeThreadIdRef.current;
      if (creatingNewConversation) {
        setPendingNewConversationCount((current: number) => current + 1);
      }
      // Once turn/start or turn/steer has acknowledged the request, the user
      // message is committed remotely. Later reconciliation (audit refresh or the
      // optional started-event waiter) must never turn that committed send
      // into a visible failure.
      let turnCommitted = false;
      try {
        const threadId = options.threadIdOverride ?? await ensureActiveThread();
        threadIdForResult = threadId;
        // 用户手动发送即表示恢复该对话：解除停止抑制。JEV 自动督促
        //（jevAutoNudge=true）不清除，否则督促自己给自己放行。
        if (!options.jevAutoNudge) {
          resumeThreadAutoNudge(threadId);
        }
        try {
          client.watchThread(threadId);
        } catch {
        }
        if (creatingNewConversation) {
          creatingNewConversation = false;
          setPendingNewConversationCount((current: number) => Math.max(0, current - 1));
        }
        // A historical thread can spend a noticeable amount of time loading
        // runtime selection/provider metadata before turn/start is issued.
        // Mark the request as accepted as soon as we know its thread so the
        // header cannot remain on the previous completed state during that
        // setup window. The error path below removes this provisional state.
        setPendingAcceptedThreads((current: Set<string>) => {
          if (current.has(threadId)) return current;
          const next = new Set(current);
          next.add(threadId);
          return next;
        });
        if (options.enablePlanAutoContinuation) {
          enablePlanAutoContinuation(threadId);
        }
        if (!options.suppressUserMessage) {
          setPendingAppends((current: PendingAppendMessage[]) => current.map((message: PendingAppendMessage) => message.id === pendingAppendId ? { ...message, threadId } : message));
        }
        const turnCwd = cwdForThread(threadId);
        const targetThread = state.threads.find((entry: ThreadEntry) => entry.id === threadId)
          ?? allHistoryThreadsRef.current.find((entry: ThreadEntry) => entry.id === threadId);
        const targetWorkspace = resolveThreadWorkspace(targetThread, {
          workspaceMode: options.workspaceModeOverride ?? workspaceMode,
          sshCommand: options.sshCommandOverride ?? sshCommand,
          localCwd: localWorkspaceDefaultPath,
          sshCwd: turnCwd
        });
        const turnAdditionalRoots = targetWorkspace.workspaceMode === "local"
          ? normalizeWorkspaceRoots(targetWorkspace.cwd, targetThread && threadId !== activeThreadIdRef.current ? targetWorkspace.additionalRoots : additionalRoots)
          : [];
        const newConversationSelection = selectionForThread(null);
        const threadSelection = await loadPersistedThreadRuntimeSelection(
          threadId,
          targetThread
            ? runtimeSelectionFallbackForThread(targetThread, selectionForThread(threadId))
            : newConversationSelection
        );
        const persistedTurnCwd = normalizeWorkspaceCwd(threadSelection.cwd ?? "");
        const effectiveTurnCwd = persistedTurnCwd || turnCwd;
        const effectiveTurnAdditionalRoots = normalizeWorkspaceRoots(
          effectiveTurnCwd,
          persistedTurnCwd ? threadSelection.additionalRoots ?? [] : turnAdditionalRoots
        );
        const isExistingThread = Boolean(targetThread);
        const selectedProviderId = threadSelection.providerId ?? (
          (isExistingThread && threadSelection.cliBackend !== "agy" && !isAgyBackend)
            ? null
            : (newConversationSelection.providerId ?? activeProviderId)
        );
        const selectedGroupId = threadSelection.groupId ?? (
          (isExistingThread && threadSelection.cliBackend !== "agy" && !isAgyBackend)
            ? null
            : (newConversationSelection.groupId ?? activeGroupId)
        );
        const selectedRuntimeModel = threadSelection.model || (isExistingThread ? targetThread?.model ?? "" : newConversationSelection.model || selectedModel);
        const resolvedSelectedProviderId = resolveProviderSelectionId(state.providers, selectedProviderId, codexConfig?.modelProvider);
        const effectiveTurnCliBackend = resolveEffectiveTurnCliBackend({
          currentBackend: runtimeSelection.cliBackend,
          threadBackend: threadSelection.cliBackend,
          resolvedProviderId: resolvedSelectedProviderId,
          fallback: threadSelection.cliBackend ?? DEFAULT_CLI_BACKEND,
        });

        let effectiveProviderId = resolvedSelectedProviderId;
        if (effectiveTurnCliBackend === "agy" && !effectiveProviderId) {
          effectiveProviderId = (activeProviderId && activeProviderId !== "agy-official" && state.providers.some((p: ProviderConfig) => p.id === activeProviderId))
            ? activeProviderId
            : "agy-official";
        }
        const isOfficialAgy = effectiveTurnCliBackend === "agy" && effectiveProviderId === "agy-official";
        const effectiveModel = isOfficialAgy
          ? (selectedRuntimeModel && AGY_OFFICIAL_MODELS.some((m: ModelEntry & { model: string; id: string; displayName: string; }) => m.model === selectedRuntimeModel) ? selectedRuntimeModel : "gemini-3.8-flash-high")
          : resolveSelectedModel(state.providers, effectiveProviderId, selectedRuntimeModel, selectedGroupId);
        const effectiveModelProvider = resolveSelectedModelProvider(state.providers, effectiveProviderId, codexConfig?.modelProvider);
        const effectivePermission = isExistingThread ? threadSelection.permission : permission;
        const effectiveDangerConfirmed = isExistingThread
          ? threadSelection.dangerBypassConfirmed
          : dangerBypassPermissionConfirmed;
        const permissionOverrides = permissionToTurnOverrides(effectivePermission, effectiveTurnCwd, effectiveTurnAdditionalRoots);
        const effectiveEffort = options.forceEffort
          ?? (threadSelection.reasoningEffort || reasoningEffort);
        const effectiveGroupId = isOfficialAgy
          ? null
          : resolveTextRuntimeGroupId(state.providers, effectiveProviderId, selectedGroupId, effectiveModel);
        if (effectiveProviderId && effectiveTurnCliBackend === "codex" && effectiveProviderId !== "agy-official" && effectiveProviderId !== "grok-official" && effectiveProviderId !== "pi-relay" && effectiveProviderId !== "opencode-local") {
          const activationKey = `${effectiveProviderId}:${effectiveGroupId ?? ""}:${effectiveModel || ""}`;
          if (activatedProviderSelectionRef.current !== activationKey) {
            await client.activateProvider(effectiveProviderId, effectiveModel || undefined, effectiveGroupId ?? undefined);
            activatedProviderSelectionRef.current = activationKey;
          }
        }
        await persistThreadRuntimeSelection({
          threadId,
          providerId: effectiveProviderId,
          groupId: effectiveGroupId,
          model: effectiveModel,
          reasoningEffort: effectiveEffort,
          freeAutoCompactEnabled: threadSelection.freeAutoCompactEnabled,
          freeAutoCompactThreshold: threadSelection.freeAutoCompactThreshold,
          freeAutoCompactModel: threadSelection.freeAutoCompactModel,
          freeAutoCompactProviderId: threadSelection.freeAutoCompactProviderId,
          freeAutoCompactGroupId: threadSelection.freeAutoCompactGroupId,
          permission: effectivePermission,
          agents: threadSelection.agents,
          cwd: effectiveTurnCwd,
          additionalRoots: effectiveTurnAdditionalRoots,
          cliBackend: effectiveTurnCliBackend,
           fastModeEnabled: threadSelection.fastModeEnabled,
           planModeEnabled: threadSelection.planModeEnabled,
           vmEnabled: threadSelection.vmEnabled,
           vmPolicy: threadSelection.vmPolicy
        });
        patchThreadRuntimeSelection(threadId, {
          providerId: effectiveProviderId,
          groupId: effectiveGroupId,
          model: effectiveModel,
          reasoningEffort: effectiveEffort,
          permission: effectivePermission,
          dangerBypassConfirmed: effectivePermission === "dangerBypass" ? effectiveDangerConfirmed : false,
        agents: threadSelection.agents,
          cliBackend: effectiveTurnCliBackend,
          vmEnabled: threadSelection.vmEnabled,
          vmPolicy: threadSelection.vmPolicy
        });
         const turnParams: Record<string, JsonValue> = {
          threadId,
          input,
          cwd: effectiveTurnCwd,
          sandboxPolicy: permissionOverrides.sandboxPolicy,
          approvalPolicy: threadSelection.vmEnabled ? "on-request" : permissionOverrides.approvalPolicy,
          effort: effectiveEffort,
          vmEnabled: threadSelection.vmEnabled,
          vmPolicy: threadSelection.vmPolicy as unknown as JsonValue,
          ...(threadSelection.vmEnabled ? {
            dynamicTools: [saVmDynamicToolSpec(threadSelection.vmPolicy)] as unknown as JsonValue,
            developerInstructions: saVmDeveloperInstructions(threadSelection.vmPolicy, effectiveTurnCliBackend)
          } : hasEnhanceToolsEnabled(threadSelection.vmPolicy?.tools) ? {
            dynamicTools: [enhanceDynamicToolSpec(threadSelection.vmPolicy)] as unknown as JsonValue,
            developerInstructions: enhanceDeveloperInstructions(threadSelection.vmPolicy)
          } : {}),
          ...(effectiveProviderId ? { providerId: effectiveProviderId } : {}),
          ...(isOfficialAgy ? { groupId: null } : effectiveGroupId ? { groupId: effectiveGroupId } : {}),
          cliBackend: effectiveTurnCliBackend
        };
        addWorkspaceRpcMetadata(
          turnParams,
          targetWorkspace.workspaceMode,
          targetWorkspace.sshCommand,
          effectiveTurnCwd,
          effectiveProviderId,
          effectiveGroupId,
          effectiveTurnAdditionalRoots
        );
        if (effectiveModel) {
          turnParams.model = effectiveModel;
        }
        if (effectiveModelProvider) {
          turnParams.modelProvider = effectiveModelProvider;
        }
        if (options.collaborationMode) {
          if (!effectiveModel) {
            throw new Error("Collaboration mode requires a selected model");
          }
          turnParams.collaborationMode =
            options.collaborationMode === "plan"
              ? buildPlanCollaborationMode(effectiveModel)
              : buildDefaultCollaborationMode(effectiveModel, effectiveEffort);
        }
        const activeTurn = options.forceNewTurn ? null : latestActionableRunningTurn(state.turns, threadId);
        const staleRunningTurns = staleRunningTurnsForThread(state.turns, threadId);
        if (!pendingSendGateRef.current.canCommit(pendingAppendId)) {
          pendingSendGateRef.current.release(pendingAppendId);
          clearSendDedupe();
          return null;
        }
        if (!pendingSendGateRef.current.beginCommit(pendingAppendId)) {
          pendingSendGateRef.current.release(pendingAppendId);
          clearSendDedupe();
          return null;
        }
        const startNewTurn = async (interruptedTurnId?: string) => {
          setPendingAcceptedThreads((current: Set<string>) => {
            if (current.has(threadId)) return current;
            const next = new Set(current);
            next.add(threadId);
            return next;
          });
          if (!options.suppressUserMessage) {
            setPendingAppends((current: PendingAppendMessage[]) => current.map((message: PendingAppendMessage) => message.id === pendingAppendId
              ? { ...message, threadId, turnId: pendingAppendId, mode: "pendingUser" }
              : message));
          }
          for (const staleTurn of staleRunningTurns) {
            if (staleTurn.id === interruptedTurnId) continue;
            console.warn("[turn/start] interrupting stale running turn before continuing thread", {
              threadId,
              turnId: staleTurn.id,
              status: staleTurn.status
            });
            await interruptTurn(threadId, staleTurn.id);
          }
          const turnStartedWaiter = options.awaitTurnStarted ? observeTurnStarted(client, threadId) : null;
          const turnProvider = state.providers.find((provider: ProviderConfig) => provider.id === effectiveProviderId);
          const turnGroup = turnProvider ? resolveComposerTextGroup(turnProvider, effectiveGroupId, effectiveModel) : undefined;
          const pendingContextWindow = resolveModelContextWindow(
            effectiveModel,
            turnGroup?.modelCapabilities?.[effectiveModel]
              ?? turnGroup?.modelCapabilities?.[stripModelContextVariant(effectiveModel).baseModel],
            turnGroup?.contextWindow
          ) ?? null;
          if (pendingContextWindow != null) turnParams.contextWindow = pendingContextWindow;
          pendingContextWindowByThreadRef.current[threadId] = pendingContextWindow;
          try {
            debugLog("turn/start", turnParams);
            const startResult = await client.rpc("turn/start", turnParams);
            turnCommitted = true;
            const turnId = extractTurnIdFromRpcResult(startResult);
            // The websocket `turn/started` notification is intentionally
            // processed through the transcript scheduler, so it can arrive
            // a few frames after `turn/start` resolves. Seed the lightweight
            // App runtime index immediately; otherwise a historical
            // completed turn remains the source for the header status while
            // the transcript store already renders the new Thinking stream.
            if (turnId) {
              dispatch({
                type: "notification",
                message: {
                  method: "turn/started",
                  params: { threadId, turn: { id: turnId, threadId, status: "inProgress" } }
                }
              });
            }
            if (turnId) {
              setPendingAcceptedThreads((current: Set<string>) => {
                if (!current.has(threadId)) return current;
                const next = new Set(current);
                next.delete(threadId);
                return next;
              });
              contextWindowByTurnIdRef.current[turnId] = pendingContextWindow;
              if (pendingContextWindowByThreadRef.current[threadId] === pendingContextWindow) {
                delete pendingContextWindowByThreadRef.current[threadId];
              }
            }
            if (turnId && !options.suppressUserMessage) {
              setPendingAppends((current: PendingAppendMessage[]) => current.map((message: PendingAppendMessage) => message.id === pendingAppendId ? { ...message, turnId } : message));
            }
            if (turnStartedWaiter) {
              const observedTurnId = await turnStartedWaiter.waitFor(turnId);
              options.onTurnStarted?.(threadId, observedTurnId);
            }
          } catch (error) {
            if (pendingContextWindowByThreadRef.current[threadId] === pendingContextWindow) {
              delete pendingContextWindowByThreadRef.current[threadId];
            }
            throw error;
          } finally {
            turnStartedWaiter?.dispose();
          }
        };
        const stopReviewAndStart = async (reviewTurnId: string) => {
          console.info("[turn/send] review turn cannot be steered; interrupting before new turn", { threadId, turnId: reviewTurnId });
          await interruptTurn(threadId, reviewTurnId);
          await startNewTurn(reviewTurnId);
        };
        if (activeTurn?.id) {
          if (isReviewModeActive(activeTurn)) {
            if (options.steerOnly) {
              throw new Error("This review turn cannot be steered. Queue the message instead.");
            }
            await stopReviewAndStart(activeTurn.id);
          } else {
            if (!options.suppressUserMessage) {
              setPendingAppends((current: PendingAppendMessage[]) => current.map((message: PendingAppendMessage) => message.id === pendingAppendId
                ? { ...message, threadId, turnId: activeTurn.id, mode: "append" }
                : message));
            }
            const steerParams: Record<string, JsonValue> = {
              threadId,
              expectedTurnId: activeTurn.id,
              input
            };
            debugLog("turn/steer", steerParams);
            try {
              await client.rpc("turn/steer", steerParams);
              turnCommitted = true;
            } catch (error) {
              if (isCannotSteerReviewTurnError(error) && !options.steerOnly) {
                await stopReviewAndStart(activeTurn.id);
              } else {
                const actualTurnId = extractActualActiveTurnId(error);
                if (!actualTurnId || actualTurnId === activeTurn.id) {
                  if (isTurnNoLongerActiveError(error)) {
                    console.info("[turn/steer] historical active turn is gone; starting a fresh turn", { threadId, turnId: activeTurn.id });
                    // steerOnly 一般来自 sendPrompt 的过期快照：客户端还以为有
                    // turn 在跑，服务端其实已经终结。直接开新 turn 保证消息送达，
                    // 而不是把 "No active turn"（CUX-RPC-*-001 包裝后更难懂）
                    // 甩给用户再让用户手动重发。review-turn 拒绝文案不会命中
                    // isTurnNoLongerActiveError，那种情况照样 throw。
                    await startNewTurn(activeTurn.id);
                  } else {
                    throw error;
                  }
                } else {
                  const retryParams: Record<string, JsonValue> = { threadId, expectedTurnId: actualTurnId, input };
                  console.warn("[turn/steer] active turn changed; retrying with server turn id", {
                    expectedTurnId: activeTurn.id,
                    actualTurnId,
                    threadId
                  });
                  debugLog("turn/steer retry", retryParams);
                  try {
                    await client.rpc("turn/steer", retryParams);
                    turnCommitted = true;
                  } catch (retryError) {
                    if (isTurnNoLongerActiveError(retryError)) {
                      console.info("[turn/steer] retry target is gone too; starting a fresh turn", {
                        expectedTurnId: activeTurn.id,
                        actualTurnId,
                        threadId
                      });
                      await startNewTurn(actualTurnId);
                    } else if (!isCannotSteerReviewTurnError(retryError) || options.steerOnly) throw retryError;
                    else await stopReviewAndStart(actualTurnId);
                  }
                }
              }
            }
          }
        } else if (options.steerOnly) {
          throw new Error("There is no active turn to steer. Send the message normally instead.");
        } else {
          await startNewTurn();
        }
        if (effectivePermission === "dangerBypass") {
          await loadAuditEvents();
        }
        pendingSendGateRef.current.release(pendingAppendId);
        clearSendDedupe();
        return threadIdForResult;
      } catch (error) {
        // 超时歧义：turn/start 服务端收到即落库并返回，客户端 20s 超时或
        // WebSocket 中断只代表“没收到回执”，不代表“没发出去”。上游慢时若直接
        // 按失败处理并引导用户重发，必然产生重复消息。先用最新 transcript 对账：
        // 同一线程在本次发送之后出现了同文案的 running turn，说明服务端已收下，
        // 按已提交处理，等正常 echo 消除 waiting 占位，不再提示重发。
        if (!turnCommitted && isAmbiguousSendError(error) && threadIdForResult) {
          const reconciledTurnId = await reconcileAmbiguousSend(
            client,
            () => turnsRef.current,
            threadIdForResult,
            inputText,
            sendStartedAt
          );
          if (reconciledTurnId) {
            turnCommitted = true;
            if (!options.suppressUserMessage) {
              setPendingAppends((current: PendingAppendMessage[]) => current.map((message: PendingAppendMessage) => message.id === pendingAppendId ? { ...message, turnId: reconciledTurnId } : message));
            }
          }
        }
        const committedResult = committedTurnResult(threadIdForResult, turnCommitted);
        if (committedResult) {
          console.warn("[turn/send] turn committed; suppressing post-start reconciliation error", error);
          pendingSendGateRef.current.release(pendingAppendId);
          clearSendDedupe();
          return committedResult;
        }
        if (!options.suppressUserMessage) {
          setPendingAppends((current: PendingAppendMessage[]) => current.filter((message: PendingAppendMessage) => message.id !== pendingAppendId));
          if (!options.automaticPlanContinuation) {
            setComposerSuggestion({ id: `send-retry-${Date.now()}`, text: inputText });
          }
        }
        console.warn("[turn/send] failed", {
          activeThreadId: state.activeThreadId,
          runningTurns: runningTurnsForThread(state.turns, state.activeThreadId)
            .map((turn: WorkbenchTurn) => ({ id: turn.id, status: turn.status, items: turn.items.length })),
          error
        });
        const message = formatErrorText(error);
        const writerConflict = isThreadWriterConflict(error);
        if (threadIdForResult) {
          setPendingAcceptedThreads((current: Set<string>) => {
            if (!current.has(threadIdForResult!)) return current;
            const next = new Set(current);
            next.delete(threadIdForResult!);
            return next;
          });
        }
        if (writerConflict) {
          if (state.activeThreadId) writerConflictThreadIdsRef.current.add(state.activeThreadId);
          dispatch({ type: "error", message: t("notifications.writerConflict.message") });
          setSlashNotice({
            id: `writer-conflict-${Date.now()}`,
            title: t("notifications.writerConflict.title"),
            message: t("notifications.writerConflict.message"),
            severity: "warning"
          });
        } else if (message.includes("Freebuff active session is currently owned") || message.includes("FREEBUFF_MODEL_LOCKED")) {
          void refreshFreebuffSession();
          setFreebuffSwitchTargetModel(selectedModel);
          setFreebuffSwitchDialogOpen(true);
        } else if (
          activeGroupId === "freebuff" &&
          (message.includes("rate_limited") ||
            message.includes("spend_limited") ||
            message.includes("out of credits") ||
            message.includes("insufficient_credits") ||
            message.includes("FREEBUFF_QUOTA_EXHAUSTED"))
        ) {
          const fallback = findBestFreebuffFallback(selectedModel, freebuffSession);
          if (fallback) {
            if (freebuffAutoFailover) {
              if (state.token) void releaseFreebuffSessionSlot(state.token).catch(() => undefined);
              if (activeThreadIdRef.current) setSelectedModel(fallback.id);
              else updateNewConversationRuntimeSelection({ model: fallback.id });
              void refreshFreebuffSession();
              setSlashNotice({
                id: `freebuff-failover-${Date.now()}`,
                title: "Freebuff 自动故障转移",
                message: `当前模型额度不足，已自动降级至 ${fallback.name} (${fallback.price} FB) 继续`,
                severity: "info"
              });
            } else {
              setFreebuffFallbackSuggestion({
                currentModel: selectedModel,
                suggestedModel: fallback,
                reason: `模型 ${selectedModel} 今日配额已耗尽或代币不足`
              });
            }
          } else {
            dispatch({ type: "error", message });
          }
        } else {
          const remoteErrorKind = classifyRemoteTurnError(message);
          if (remoteErrorKind === "officialRefreshRevoked") {
            dispatch({ type: "error", message: t("notifications.officialRefreshRevoked") });
            setOfficialLoginNotice(t("notifications.officialRefreshRevokedPrompt") || "您的官方 OpenAI 登录凭证已失效（Refresh Token 已被撤销）。请点击下方按钮重新登录授权。");
            setOfficialLoginOpen(true);
          } else if (remoteErrorKind === "opencodeClientRestricted") {
            dispatch({ type: "error", message: t("notifications.opencodeClientRestricted") || "OpenCode 免费模型仅限 OpenCode 客户端使用，请切换其他模型或中转分组。" });
          } else {
            dispatch({ type: "error", message });
          }
        }
        pendingSendGateRef.current.release(pendingAppendId);
        clearSendDedupe();
        return null;
      } finally {
        if (creatingNewConversation) {
        setPendingNewConversationCount((current: number) => Math.max(0, current - 1));
        }
      }
    },
    [
      activeProviderId,
      activeGroupId,
      client,
      codexConfig?.modelProvider,
      cwdForThread,
      dangerBypassPermissionConfirmed,
      dispatch,
      ensureActiveThread,
      ensureRuntimeProviderActivated,
      enablePlanAutoContinuation,
      fastModeEnabled,
      interruptTurn,
      loadAuditEvents,
      patchThreadRuntimeSelection,
      permission,
      persistThreadRuntimeSelection,
      reasoningEffort,
      reasoningOptions,
      selectedModel,
      sshCommand,
      state.activeThreadId,
      state.providers,
      state.turns,
      t,
      workspaceMode,
      workspaceSelectionPending
    ]
  );
  return { startCodexTurn };
}
