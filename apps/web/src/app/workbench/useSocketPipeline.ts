import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  createDefaultSaVmPolicyConfig,
  type JsonRpcNotification,
  resolveModelContextWindow,
  stripModelContextVariant,
  type ProviderConfig,
  type ServerToClientMessage,
  type ThreadAgentMember,
  type ThreadAgentRoster,
} from "@codex-ui/shared";
import {
  type SocketConnectionStatus,
  type ComposerImageAttachment,
  type ComposerMention,
  type PtyTerminalSession,
  type WorkbenchItem,
} from "../../state/codexClient";
import {
  MODEL_CAPACITY_RETRY_DELAY_MS,
  MODEL_CAPACITY_RETRY_SUCCESS_RETENTION_MS,
  decideModelCapacityRetry,
  isModelCapacityRetryError,
  shouldClearModelCapacityRetryEntry,
} from "../modelCapacityRetry";
import { classifyRemoteTurnError } from "../../remoteTurnErrors";
import {
  collectTaskNotificationEvents,
  createTaskNotificationTracker,
  type TaskNotificationEvent,
} from "../../taskNotifications";
import { dispatchJevTurnSnapshotDelayed } from "../../../../../frontends/jev/src/jev/jevTurnSnapshotDispatch";
import { applyTokenUsagePricing, priceTokenBreakdown } from "../usage/usagePricing";
import { clampRetryCount } from "../../state/retrySettings";
import { publishPtyData, publishPtyExit } from "../../ptyDataBus";
import { resolveReportedContextWindow } from "../../contextUsage";
import { parseWorkspaceLayoutState, twoPaneSplitView, type SplitViewState, type WorkspaceLayoutState } from "../../taskTabs";
import { isRunningTurnStatus, runningTurnsForThread } from "../transcripts/topicRuntimeIndex";
import { normalizeThreadCliBackend } from "../cli/cliBackendKind";
import { resolveComposerTextGroup, resolveSelectedModel } from "./modelSelectionUtils";
import { optionalPermissionPresetValue } from "./preferenceUtils";
import {
  asRecord,
  decodeBase64Text,
  formatErrorText,
  parseThreadTokenUsage,
  parseTokenBreakdown,
  stringValue,
} from "./appUtils";
import { type TurnRetryState } from "../turnRetryState";
import type { TopicUsageStore } from "../usage/topicUsageStore";
import type { TopicTranscriptStore } from "../transcripts/topicTranscriptStore";
import type { ThreadLoadProgress } from "../../components/ChatPanel";
import type { ThreadTokenUsageState } from "../../components/ChatPanel";
import { type StartCodexTurnOptions, type AuthStatus } from "./appConstants";
import type { useTopicTranscriptRuntime } from "../transcripts/useTopicTranscriptRuntime";
import type { ThreadRuntimeSelection, ThreadRuntimeSelectionsDomain } from "../runtime/useThreadRuntimeSelections";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, WorkbenchTurn } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

import type { SocketPipelineInput } from "./socketPipelineContext";

export function useSocketPipeline(input: SocketPipelineInput) {
  const {
    state, dispatch, hasOpenedSocketRef, setConnectionEpoch, authStatus,
    verifySessionAfterDisconnect, setConnectionStatus, lastCodexActivityAtRef, handleGoalNotification, transcriptRuntime,
    turnsRef, activeThreadIdRef, t, activeProviderId, capacityTurnRetryEnabled,
    topicTranscriptStore, usageStore, providersRef, publishThreadTokenUsage, applyTurnRetryState,
    turnRetryStateRef, modelCapacityRetryRef, contextWindowByTurnIdRef, pendingContextWindowByThreadRef, freeCompactionContextWindowByTurnIdRef,
    freeCompactionSourceTurnIdsRef, freeCompactionWaitersRef, freeCompactAfterTurnRef, taskNotificationTrackerRef, startCodexTurnRef,
    appendTerminalOutput, enqueueTokenUsage, loadTooling, sendWindowsTaskNotification, setCompactionSourceByTurnId,
    setOfficialLoginNotice, setOfficialLoginOpen, setPendingAcceptedThreads, setPtyTerminals, setSplitView,
    setThreadAgentRosters, setWorkspaceLayout, suppressThreadAutoNudge, selectionForThread, patchThreadRuntimeSelection,
    setActiveProviderId, setActiveGroupId,
  } = input;
  const handleSocketConnected = (event: Event) => {
      const connected = Boolean((event as CustomEvent<boolean>).detail);
      dispatch({ type: "connected", connected });
      if (connected) {
        if (hasOpenedSocketRef.current) {
          setConnectionEpoch((current: number) => current + 1);
        } else {
          hasOpenedSocketRef.current = true;
        }
      }
      if (!connected && authStatus === "authenticated") {
        void verifySessionAfterDisconnect();
      }
  };
  const handleSocketConnectionStatus = (event: Event) => {
      const status = (event as CustomEvent<SocketConnectionStatus>).detail;
      setConnectionStatus(status);
      if (status.phase !== "connected") {
        console.info("[connection]", status.phase, status);
      }
  };
  const handleSocketMessage = (event: Event) => {
      const message = (event as CustomEvent<ServerToClientMessage>).detail;
      if (message.type === "engine.status") {
        dispatch({ type: "engine", status: message.status });
      }
      if (message.type === "codex.notification") {
        lastCodexActivityAtRef.current = Date.now();
        handleGoalNotification(message.message);
        // Every transcript notification enters the same ordered scheduler.
        // Terminal/control bursts otherwise rebuild a long active transcript
        // once per websocket message and can monopolize the renderer.
        transcriptRuntime.enqueue(message.message);
        const notificationParams = asRecord(message.message.params);
        const notificationTurn = asRecord(notificationParams.turn);
        const notificationTurnId = stringValue(notificationParams.turnId)
          ?? stringValue(notificationParams.turn_id)
          ?? stringValue(notificationTurn.id);
        const notificationThreadId = stringValue(notificationParams.threadId)
          ?? stringValue(notificationParams.thread_id)
          ?? stringValue(notificationTurn.threadId)
          ?? stringValue(notificationTurn.thread_id)
          ?? (notificationTurnId ? turnsRef.current.find((turn: WorkbenchTurn) => turn.id === notificationTurnId)?.threadId : undefined)
          ?? (message.message.method === "error" ? activeThreadIdRef.current ?? undefined : undefined);
        const indexedNotificationTurn = notificationTurnId
          ? turnsRef.current.find((turn: WorkbenchTurn) => turn.id === notificationTurnId)
          : undefined;
        const notificationConfirmsPendingTurn = message.message.method === "turn/started"
          || (Boolean(notificationTurnId)
            && !indexedNotificationTurn
            && (message.message.method === "turn/completed"
              || message.message.method === "turn/failed"
              || message.message.method === "turn/interrupted"
              || message.message.method.startsWith("item/")))
          || (Boolean(notificationTurnId)
            && indexedNotificationTurn
            && isRunningTurnStatus(indexedNotificationTurn.status)
            && message.message.method.startsWith("item/"));
        if (notificationThreadId && notificationConfirmsPendingTurn) {
          setPendingAcceptedThreads((current: Set<string>) => {
            if (!current.has(notificationThreadId)) return current;
            const next = new Set(current);
            next.delete(notificationThreadId);
            return next;
          });
        }        const notificationError = asRecord(notificationParams.error);
        const notificationErrorText = stringValue(notificationError.message)
          ?? stringValue(notificationParams.message)
          ?? (typeof notificationParams.error === "string" ? notificationParams.error : "");
        const notificationTurnError = asRecord(asRecord(notificationParams.turn).error);
        const notificationTurnErrorText = stringValue(notificationTurnError.message) ?? "";
        if (message.message.method === "turn/started" && notificationThreadId && notificationTurnId) {
          if (pendingContextWindowByThreadRef.current[notificationThreadId] !== undefined) {
            contextWindowByTurnIdRef.current[notificationTurnId] = pendingContextWindowByThreadRef.current[notificationThreadId] ?? null;
            delete pendingContextWindowByThreadRef.current[notificationThreadId];
          }
          const waiter = freeCompactionWaitersRef.current.get(notificationThreadId);
          if (waiter && !waiter.turnId) {
            waiter.turnId = notificationTurnId;
            freeCompactionContextWindowByTurnIdRef.current[notificationTurnId] = waiter.contextWindow;
            freeCompactionSourceTurnIdsRef.current.add(notificationTurnId);
            setCompactionSourceByTurnId((current: Record<string, { source: "free" | "native"; providerId: string; model: string }>) => ({
              ...current,
              [notificationTurnId]: {
                source: "free",
                providerId: waiter.providerId,
                model: waiter.model
              }
            }));
          }
        }
        const candidateErrorText = notificationErrorText || notificationTurnErrorText;
        if ((message.message.method === "error" && notificationParams.willRetry !== true && candidateErrorText)
          || (candidateErrorText && (message.message.method === "turn/completed" || message.message.method === "turn/failed"))) {
          const remoteErrorKind = classifyRemoteTurnError(candidateErrorText);
          if (remoteErrorKind === "incompleteToolArguments") {
            dispatch({ type: "error", message: t("notifications.incompleteToolArguments") });
          } else if (remoteErrorKind === "relayUnauthorized") {
            dispatch({ type: "error", message: t("notifications.relayUnauthorized") });
          } else if (remoteErrorKind === "officialRefreshRevoked") {
            dispatch({ type: "error", message: t("notifications.officialRefreshRevoked") });
            setOfficialLoginNotice(t("notifications.officialRefreshRevokedPrompt") || "您的官方 OpenAI 登录凭证已失效（Refresh Token 已被撤销）。请点击下方按钮重新登录授权。");
            setOfficialLoginOpen(true);
          } else if (remoteErrorKind === "opencodeClientRestricted") {
            dispatch({ type: "error", message: t("notifications.opencodeClientRestricted") || "OpenCode 免费模型仅限 OpenCode 客户端使用，请切换其他模型或中转分组。" });
          }
        }
        const notificationItemType = stringValue(asRecord(notificationParams.item).type);
        const notificationItem = asRecord(notificationParams.item);
        const notificationItemPayload = asRecord(notificationItem.payload);
        const commandBlacklistMarker = asRecord(notificationItem.commandBlacklist).ruleId
          ? asRecord(notificationItem.commandBlacklist)
          : asRecord(notificationItemPayload.commandBlacklist).ruleId
            ? asRecord(notificationItemPayload.commandBlacklist)
            : null;
        if (message.message.method === "item/completed" && commandBlacklistMarker) {
          dispatch({ type: "error", message: t("notifications.commandBlacklistBlocked") });
        }
        const assistantOutputEvent = message.message.method === "item/agentMessage/delta"
          || (message.message.method === "item/completed" && (notificationItemType === "agentMessage" || notificationItemType === "message"));
        const retryEntry = notificationThreadId ? modelCapacityRetryRef.current.get(notificationThreadId) : undefined;
        if (
          retryEntry
          && notificationTurnId
          && notificationTurnId !== retryEntry.failedTurnId
          && message.message.method !== "error"
          && (message.message.method === "turn/started"
            || message.message.method.startsWith("item/"))
        ) {
          // Keep the counter through the replacement turn. The entry is only
          // released after that turn produces a non-capacity result.
          retryEntry.retryTurnId = notificationTurnId;
        }
        if (
          retryEntry
          && notificationTurnId
          && (retryEntry.retryTurnId === notificationTurnId || retryEntry.failedTurnId === notificationTurnId)
          && message.message.method !== "error"
          && shouldClearModelCapacityRetryEntry({
            assistantOutputEvent,
            messageMethod: message.message.method,
            errorText: notificationTurnErrorText
          })
        ) {
          if (retryEntry.timer !== null) window.clearTimeout(retryEntry.timer);
          const successfulErrorTurnIds = new Set(retryEntry.errorTurnIds);
          for (const errorTurnId of successfulErrorTurnIds) {
            topicTranscriptStore.updateRetryErrorItem(notificationThreadId!, errorTurnId, {
              status: "completed",
              retrySource: "app",
              attempt: retryEntry.attempt,
              max: retryEntry.max
            });
          }
          modelCapacityRetryRef.current.delete(notificationThreadId!);
          window.setTimeout(() => {
            topicTranscriptStore.removeRetryErrorItems(notificationThreadId!, successfulErrorTurnIds);
          }, MODEL_CAPACITY_RETRY_SUCCESS_RETENTION_MS);
          if (turnRetryStateRef.current?.threadId === notificationThreadId) {
            turnRetryStateRef.current = null;
            applyTurnRetryState(null);
          }
        }
        if (
          message.message.method === "error"
          && notificationThreadId
          && isModelCapacityRetryError(notificationErrorText)
        ) {
          const codexWillRetry = notificationParams.willRetry === true;
          const thread = turnsRef.current.find((entry: WorkbenchTurn) => entry.id === notificationThreadId);
          const sourceTurn = notificationTurnId ? turnsRef.current.find((entry: WorkbenchTurn) => entry.id === notificationTurnId) : undefined;
          const prompt = [...(sourceTurn?.items ?? thread?.items ?? [])]
            .reverse()
            .find((item: WorkbenchItem) => item.type === "userMessage")?.text?.trim()
            ?? retryEntry?.prompt;
          const providerId = selectionForThread(notificationThreadId).providerId ?? activeProviderId;
          const provider = providersRef.current.find((entry: ProviderConfig) => entry.id === providerId);
          const maxRetries = clampRetryCount(provider?.streamMaxRetries);
          const entry = modelCapacityRetryRef.current.get(notificationThreadId) ?? {
            attempt: 0,
            max: maxRetries,
            timer: null,
            exhausted: false,
            errorTurnIds: new Set<string>()
          };
          entry.max = maxRetries;
          entry.lastError = notificationErrorText;
          entry.details = stringValue(notificationError.additionalDetails) ?? stringValue(notificationError.additional_details);
          if (notificationTurnId) entry.errorTurnIds.add(notificationTurnId);
          if (notificationTurnId && entry.lastFailureTurnId === notificationTurnId) {
            modelCapacityRetryRef.current.set(notificationThreadId, entry);
          } else {
            entry.lastFailureTurnId = notificationTurnId ?? entry.lastFailureTurnId;
            entry.failedTurnId = notificationTurnId ?? entry.failedTurnId;
            entry.retryTurnId = undefined;
            entry.prompt = prompt ?? entry.prompt;
            const decision = decideModelCapacityRetry({
              enabled: capacityTurnRetryEnabled,
              message: notificationErrorText,
              codexWillRetry,
              state: { attempt: entry.attempt, max: entry.max, exhausted: entry.exhausted }
            });
            entry.attempt = decision.state.attempt;
            entry.exhausted = decision.state.exhausted;
            if (codexWillRetry && entry.timer !== null) {
              window.clearTimeout(entry.timer);
              entry.timer = null;
            }
            modelCapacityRetryRef.current.set(notificationThreadId, entry);
            if (decision.action === "schedule" && entry.timer === null && prompt) {
              const retryAttempt = decision.attempt;
              applyTurnRetryState({
                threadId: notificationThreadId,
                turnId: notificationTurnId ?? "capacity",
                message: t("notifications.modelCapacityRetrying", { attempt: retryAttempt, max: entry.max }),
                details: entry.details ?? entry.lastError,
                updatedAt: Date.now()
              });
              if (notificationTurnId) {
                topicTranscriptStore.updateRetryErrorItem(notificationThreadId, notificationTurnId, {
                  status: "running",
                  retrySource: "app",
                  attempt: retryAttempt,
                  max: entry.max,
                  delayMs: MODEL_CAPACITY_RETRY_DELAY_MS
                });
              }
              const retry = async (pollCount: number = 0) => {
                const current = modelCapacityRetryRef.current.get(notificationThreadId);
                if (!current || current.attempt !== retryAttempt) return;
                const running = notificationTurnId
                  ? runningTurnsForThread(turnsRef.current, notificationThreadId).some((turn: WorkbenchTurn) => turn.id === notificationTurnId)
                  : false;
                if (running) {
                  if (pollCount >= 30) {
                    current.exhausted = true;
                    current.timer = null;
                    if (notificationTurnId) {
                      topicTranscriptStore.updateRetryErrorItem(notificationThreadId, notificationTurnId, {
                        status: "failed",
                        retrySource: "app",
                        attempt: current.attempt,
                        max: current.max,
                        exhausted: true
                      });
                    }
                    applyTurnRetryState({
                      threadId: notificationThreadId,
                      turnId: notificationTurnId ?? "capacity",
                      message: t("notifications.modelCapacityRetryExhausted", { max: current.max }),
                      details: current.details ?? current.lastError,
                      updatedAt: Date.now()
                    });
                    return;
                  }
                  current.timer = window.setTimeout(() => { current.timer = null; void retry(pollCount + 1); }, 1_000);
                  return;
                }
                current.timer = null;
                const result = await startCodexTurnRef.current(prompt, [], [], {
                  threadIdOverride: notificationThreadId,
                  forceNewTurn: true,
                  suppressUserMessage: true,
                  displayText: prompt
                });
                if (!result) {
                  current.exhausted = true;
                  if (notificationTurnId) {
                    topicTranscriptStore.updateRetryErrorItem(notificationThreadId, notificationTurnId, {
                      status: "failed",
                      retrySource: "app",
                      attempt: current.attempt,
                      max: current.max,
                      exhausted: true
                    });
                  }
                  applyTurnRetryState({
                    threadId: notificationThreadId,
                    turnId: notificationTurnId ?? "capacity",
                    message: t("notifications.modelCapacityRetryExhausted", { max: current.max }),
                    details: current.details ?? current.lastError,
                    updatedAt: Date.now()
                  });
                }
              };
              entry.timer = window.setTimeout(() => { entry.timer = null; void retry(); }, MODEL_CAPACITY_RETRY_DELAY_MS);
            } else if (decision.action === "exhausted") {
              if (notificationTurnId) {
                topicTranscriptStore.updateRetryErrorItem(notificationThreadId, notificationTurnId, {
                  status: "failed",
                  retrySource: "app",
                  attempt: entry.attempt,
                  max: entry.max,
                  exhausted: true
                });
              }
              applyTurnRetryState({
                threadId: notificationThreadId,
                turnId: notificationTurnId ?? "capacity",
                message: t("notifications.modelCapacityRetryExhausted", { max: entry.max }),
                details: entry.details ?? entry.lastError,
                updatedAt: Date.now()
              });
            }
          }
        }
        for (const taskEvent of collectTaskNotificationEvents(message.message, taskNotificationTrackerRef.current)) {
          sendWindowsTaskNotification(taskEvent);
        }
        if (message.message.method === "error" && notificationParams.willRetry === true) {
          const error = asRecord(notificationParams.error);
          if (notificationThreadId && notificationTurnId) {
            applyTurnRetryState({
              threadId: notificationThreadId,
              turnId: notificationTurnId,
              message: stringValue(error.message) ?? "Reconnecting...",
              details: stringValue(error.additionalDetails) ?? stringValue(error.additional_details),
              updatedAt: Date.now()
            });
          }
        } else if (
          notificationTurnId &&
          (message.message.method.startsWith("item/") ||
            message.message.method.startsWith("turn/") ||
            message.message.method === "thread/tokenUsage/updated"
            || message.message.method === "thread/tokenUsage/requestUpdated"
            || message.message.method === "rawResponse/completed")
        ) {
          if (turnRetryStateRef.current?.turnId === notificationTurnId) {
            turnRetryStateRef.current = null;
            applyTurnRetryState(null);
          }
        }
        if (message.message.method === "command/exec/outputDelta") {
          const params = asRecord(message.message.params);
          const processId = typeof params.processId === "string" ? params.processId : null;
          const deltaBase64 = typeof params.deltaBase64 === "string" ? params.deltaBase64 : null;
          if (processId && deltaBase64) {
            appendTerminalOutput(processId, decodeBase64Text(deltaBase64));
          }
        }
        if (message.message.method === "terminal/data") {
          const params = asRecord(message.message.params);
          const terminalId = typeof params.terminalId === "string" ? params.terminalId : null;
          const chunkBase64 = typeof params.chunkBase64 === "string" ? params.chunkBase64 : null;
          if (terminalId && chunkBase64) {
            publishPtyData(terminalId, decodeBase64Text(chunkBase64));
          }
        }
        if (message.message.method === "terminal/exit") {
          const params = asRecord(message.message.params);
          const terminalId = typeof params.terminalId === "string" ? params.terminalId : null;
          const exitCode = typeof params.exitCode === "number" ? params.exitCode : 0;
          if (terminalId) {
            publishPtyExit(terminalId, exitCode);
            setPtyTerminals((current: PtyTerminalSession[]) =>
              current.map((entry: PtyTerminalSession) => (entry.terminalId === terminalId ? { ...entry, status: "exited", exitCode } : entry))
            );
          }
        }
        if (message.message.method === "thread/tokenUsage/requestUpdated") {
          const params = asRecord(message.message.params);
          const threadId = stringValue(params.threadId);
          const turnId = stringValue(params.turnId);
          const requestId = stringValue(params.requestId);
          const usage = parseTokenBreakdown(params.usage);
          if (threadId && turnId && requestId && usage) {
            const usageSelection = selectionForThread(threadId);
            const currentProvider = state.providers.find((provider: ProviderConfig) => provider.id === usageSelection.providerId);
            const currentModel = resolveSelectedModel(state.providers, usageSelection.providerId, usageSelection.model, usageSelection.groupId);
            const currentGroup = currentProvider ? resolveComposerTextGroup(currentProvider, usageSelection.groupId, currentModel) : undefined;
            const pricedRequest = priceTokenBreakdown(usage, currentProvider, currentModel, currentGroup?.groupRatio ?? 1);
            usageStore.updateRequest(threadId, turnId, requestId, pricedRequest);
          }
        }
        if (message.message.method === "rawResponse/completed") {
          const params = asRecord(message.message.params);
          const threadId = stringValue(params.threadId);
          const turnId = stringValue(params.turnId);
          const requestId = stringValue(params.responseId);
          const usage = parseTokenBreakdown(params.usage);
          if (threadId && turnId && requestId && usage) {
            const usageSelection = selectionForThread(threadId);
            const currentProvider = state.providers.find((provider: ProviderConfig) => provider.id === usageSelection.providerId);
            const currentModel = resolveSelectedModel(state.providers, usageSelection.providerId, usageSelection.model, usageSelection.groupId);
            const currentGroup = currentProvider ? resolveComposerTextGroup(currentProvider, usageSelection.groupId, currentModel) : undefined;
            usageStore.updateRequest(threadId, turnId, "codex-" + requestId, priceTokenBreakdown(usage, currentProvider, currentModel, currentGroup?.groupRatio ?? 1));
          }
        }
        if (message.message.method === "thread/tokenUsage/updated") {
          const params = asRecord(message.message.params);
          const threadId = stringValue(params.threadId);
          const turnId = stringValue(params.turnId);
          const usage = parseThreadTokenUsage(
            params.tokenUsage
              ?? params.usage
              ?? params.token_usage
              ?? (params.total || params.total_usage ? params : undefined)
          );
          const usageSelection = selectionForThread(threadId);
          const currentProvider = state.providers.find((provider: ProviderConfig) => provider.id === usageSelection.providerId);
          const currentModel = resolveSelectedModel(state.providers, usageSelection.providerId, usageSelection.model, usageSelection.groupId);
          const currentGroup = currentProvider ? resolveComposerTextGroup(currentProvider, usageSelection.groupId, currentModel) : undefined;
          const mainContextWindow = turnId
            ? freeCompactionContextWindowByTurnIdRef.current[turnId] ?? contextWindowByTurnIdRef.current[turnId]
            : null;
          const relayContextWindow = resolveModelContextWindow(
            currentModel,
            currentGroup?.modelCapabilities?.[currentModel]
              ?? currentGroup?.modelCapabilities?.[stripModelContextVariant(currentModel).baseModel],
            currentGroup?.contextWindow
          );
          const normalizedUsage = usage ? {
            ...usage,
            modelContextWindow: resolveReportedContextWindow(
              usageSelection.cliBackend,
              usage.modelContextWindow,
              mainContextWindow ?? relayContextWindow,
              currentGroup?.contextWindow,
              stripModelContextVariant(currentModel).contextWindow
            )
          } : usage;
          const pricedUsage = normalizedUsage ? applyTokenUsagePricing(normalizedUsage, currentProvider, currentModel, currentGroup?.groupRatio ?? 1) : null;
          if (pricedUsage) {
            enqueueTokenUsage(threadId, turnId, pricedUsage);
          }
        }
        if (notificationThreadId && notificationTurnId
          && (message.message.method === "turn/completed"
            || message.message.method === "turn/failed"
            || message.message.method === "turn/interrupted")) {
          usageStore.finalizeTurn(notificationThreadId, notificationTurnId);
          window.setTimeout(() => {
            publishThreadTokenUsage(true);
          }, 260);
          delete contextWindowByTurnIdRef.current[notificationTurnId];
          delete freeCompactionContextWindowByTurnIdRef.current[notificationTurnId];
        }
        if (notificationThreadId && message.message.method === "turn/interrupted") {
          const retry = modelCapacityRetryRef.current.get(notificationThreadId);
          if (retry) {
            if (retry.timer !== null) {
              window.clearTimeout(retry.timer);
              retry.timer = null;
            }
            retry.exhausted = true;
          }
          // 用户（或服务端）中断了该线程：抑制该线程后续的 JEV 自动督促，
          // 并清掉连败记账。否则在途的旧 verdict 会在中断后到达，
          // 把已停止的对话复活——A 完成后到达的 verdict 更会错发到 B。
          suppressThreadAutoNudge(notificationThreadId);
        }
        if (notificationThreadId && message.message.method === "turn/completed") {
          // Proactive compaction used to run only before send, so a session
          // that finished a turn above the threshold stayed uncompressed until
          // the user typed again. Re-check shortly after the turn settles,
          // once its token usage has landed. Silent skip: routine "not ready"
          // outcomes must not toast after every turn.
          window.setTimeout(() => {
            void freeCompactAfterTurnRef.current?.({ threadId: notificationThreadId, silentSkip: true });
          }, 2_000);
          // JEV auto-judge: fire-and-forget snapshot dispatch. The Composer-side
          // listener checks localStorage enabled/key and no-ops when off,
          // so关闭状态零网络开销. No React hooks added here by design.
          if (notificationThreadId && notificationTurnId) {
            dispatchJevTurnSnapshotDelayed(
              {
                getTurnFromTranscriptStore: (t, u) => transcriptRuntime.store.getThreadTurns(t).find((turn: WorkbenchTurn) => turn.id === u),
                getTurnFromRuntimeIndex: (u) => turnsRef.current.find((turn: WorkbenchTurn) => turn.id === u),
              },
              { threadId: notificationThreadId, turnId: notificationTurnId, sessionToken: state.token },
            );
          }
        }
        if (notificationThreadId && notificationTurnId
          && (message.message.method === "turn/completed"
            || message.message.method === "turn/failed"
            || message.message.method === "turn/interrupted")) {
          const waiter = freeCompactionWaitersRef.current.get(notificationThreadId);
          if (waiter?.turnId === notificationTurnId) {
            freeCompactionWaitersRef.current.delete(notificationThreadId);
            if (message.message.method === "turn/completed") {
              waiter.resolve();
            } else {
              waiter.reject(new Error(`Free compaction turn ${message.message.method}`));
            }
          }
        }
        if (message.message.method === "skills/changed") {
          void loadTooling({ forceSkillReload: true });
        }
        if (message.message.method === "mcpServer/startupStatus/updated") {
          void loadTooling();
        }
        if (message.message.method === "serverRequest/resolved") {
          const params = asRecord(message.message.params);
          const requestId = params.requestId;
          if (typeof requestId === "string" || typeof requestId === "number") {
            dispatch({ type: "serverRequestResolved", id: requestId });
          }
        }
      }
      if (message.type === "codex.serverRequest") {
        dispatch({ type: "serverRequest", message: message.message });
      }
      if (message.type === "provider.saved") {
        const providers = [message.provider, ...state.providers.filter((provider: ProviderConfig) => provider.id !== message.provider.id)];
        dispatch({
          type: "providers",
          providers
        });
      }
      if (message.type === "provider.deleted") {
        const providers = state.providers.filter((provider: ProviderConfig) => provider.id !== message.providerId);
        dispatch({
          type: "providers",
          providers
        });
        if (message.providerId === activeProviderId) {
          setActiveProviderId(null);
          setActiveGroupId(null);
        }
      }
      if (message.type === "workbench.control") {
        const payload = asRecord(message.payload);
        const action = stringValue(payload.action);
        const threadId = stringValue(payload.threadId);
        if (action === "compactionRoute" && threadId) {
          const turnId = stringValue(payload.turnId);
          const source = payload.source === "native" ? "native" : payload.source === "free" ? "free" : null;
          const providerId = stringValue(payload.providerId);
          const model = stringValue(payload.model);
          if (turnId && source && providerId && model) {
            setCompactionSourceByTurnId((current: Record<string, { source: "free" | "native"; providerId: string; model: string; }>) => ({
              ...current,
              [turnId]: { source, providerId, model }
            }));
            if (source === "free") freeCompactionSourceTurnIdsRef.current.add(turnId);
            else freeCompactionSourceTurnIdsRef.current.delete(turnId);
          }
        }
        if (action === "runtime" && threadId) {
          const runtime = asRecord(payload.runtime);
          const runtimePermission = optionalPermissionPresetValue(runtime.permission);
          patchThreadRuntimeSelection(threadId, {
            providerId: runtime.providerId === null ? null : stringValue(runtime.providerId) ?? null,
            groupId: runtime.groupId === null ? null : stringValue(runtime.groupId) ?? null,
            model: stringValue(runtime.model) ?? "",
            reasoningEffort: stringValue(runtime.reasoningEffort) ?? "medium",
            cliBackend: normalizeThreadCliBackend(runtime.cliBackend),
            ...(typeof runtime.vmEnabled === "boolean" ? {
              vmEnabled: runtime.vmEnabled,
              ...(runtime.vmEnabled ? {
                vmPolicy: runtime.vmPolicy && typeof runtime.vmPolicy === "object" && !Array.isArray(runtime.vmPolicy)
                  ? runtime.vmPolicy as ThreadRuntimeSelection["vmPolicy"]
                  : createDefaultSaVmPolicyConfig()
              } : {})
            } : {}),
            ...(runtimePermission ? {
              permission: runtimePermission,
              dangerBypassConfirmed: runtimePermission === "dangerBypass"
            } : {})
          });
        }
        if (action === "agentRoster" && threadId) {
          const roster = payload.roster as unknown as ThreadAgentRoster;
          if (roster && Array.isArray(roster.members) && Array.isArray(roster.roles)) {
            setThreadAgentRosters((current: Record<string, ThreadAgentRoster>) => ({ ...current, [threadId]: roster }));
            const offlineMember = roster.members.find((member: ThreadAgentMember) => member.health?.availability === "offline");
            if (offlineMember && threadId === activeThreadIdRef.current) {
              dispatch({
                type: "error",
                message: offlineMember.activeFallbackId
                  ? `${offlineMember.name} 已下线，候选 ${offlineMember.activeFallbackId} 已接管。`
                  : `${offlineMember.name} 已下线：${offlineMember.health?.message || "渠道不可用"}`
              });
            }
          }
        }
        if (action === "layout") {
          const layout = parseWorkspaceLayoutState(payload.workspaceLayout);
          setWorkspaceLayout(layout);
          setSplitView(twoPaneSplitView(layout));
        }
        if (action === "activate" && threadId) {
          window.dispatchEvent(new CustomEvent("codex-ultra:workbench-activate", { detail: { threadId } }));
        }
      }
      if (message.type === "server.error") {
        if (message.id) {
          return;
        }
        dispatch({ type: "error", message: formatErrorText(message.message) });
      }
  };
  return { handleSocketConnected, handleSocketConnectionStatus, handleSocketMessage };
}
