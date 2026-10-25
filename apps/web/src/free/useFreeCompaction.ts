import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ComposerImageAttachment, ComposerMention } from "../state/codexClient";
import type { StartCodexTurnOptions } from "../app/workbench/appConstants";
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
} from "../state/codexClient";
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
} from "../app/workbench/appUtils";
import { buildSaVmThreadConfig, enhanceDeveloperInstructions, enhanceDynamicToolSpec, saVmDeveloperInstructions, saVmDynamicToolSpec } from "../app/cli/saVmExecutionSpec";
import { addWorkspaceRpcMetadata } from "../app/workbench/sshUtils";
import { buildFailedImageThreadItems, buildImageThreadItems, buildLocalImageThreadTurns, buildPendingImageThreadItems } from "../imageThreadHistory";
import { buildServerRequestDecisionResponse } from "../serverRequests";
import { checkFreeCompactionReadiness, describeFreeCompactionUnready, shouldRefreshFreeCompactionModels } from "../../../../frontends/free-mode/src/free/freeCompactionReadiness";
import { FREE_AUTOCOMPACT_COOLDOWN_MS } from "../../../../frontends/free-mode/src/free/freeAutoCompactPreferences";
import { executeImageCommandRequest } from "../imageCommand";
import { isThreadWriterConflict } from "../app/threadWriterConflict";
import { latestActionableRunningTurn, runningTurnsForThread } from "../app/transcripts/topicRuntimeIndex";
import { normalizeWorkspaceCwd, normalizeWorkspaceRoots } from "../workspacePaths";
import { parseComposerSlashCommand, type ComposerSlashCommand } from "../composer/composerSlashCommands";
import { parseGoalObjectiveWithBudget } from "../app/goals/goalState";
import { renameThreadAcrossCatalogs } from "../app/threads/threadCatalog";
import { contextUsageMetrics, resolveDisplayedContextWindow } from "../contextUsage";
import { resolveEffectiveTurnCliBackend } from "../app/cli/resolveEffectiveTurnCliBackend";
import { resolveImageRuntime } from "../imageRuntime";
import { isLikelyImageModelId, resolveProviderSelectionId, resolveSelectedModel, resolveSelectedModelProvider, resolveTextRuntimeGroupId } from "../app/workbench/modelSelectionUtils";
import { resolveThreadWorkspace } from "../app/threads/editConversation";
import { PLAN_CONTINUATION_PROMPT, shouldAutomaticallyContinuePlan } from "../planContinuation";
import { AGY_OFFICIAL_MODELS } from "../app/workbench/appConstants";
import { DEFAULT_CLI_BACKEND } from "../app/cli/cliPlugins";
import { SIDE_CHAT_DUCK_GROUP_ID, SIDE_CHAT_DUCK_PROVIDER_ID, applySideChatDuckDefault, shouldSendSideChatWebSearch } from "../app/sidechat/sideChatDuckDefaults";
import { buildAgentThreadConfig } from "../app/runtime/useThreadRuntimeSelections";
import type { SideChatTab } from "../components/SideChatPanel";

import type { ComposerCoreInput } from "../app/workbench/composerCoreContext";
import type { ThreadTokenUsageState } from "../components/ChatPanel";

type FreeCompactionWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  cancel: () => void;
  turnId?: string;
  providerId: string;
  model: string;
  contextWindow: number | null;
};

export function useFreeCompaction(input: ComposerCoreInput & {
  freeCompactionWaitersRef: MutableRefObject<Map<string, FreeCompactionWaiter>>;
  freeCompactionContextWindowByTurnIdRef: MutableRefObject<Record<string, number | null>>;
  freeCompactionSourceTurnIdsRef: MutableRefObject<Set<string>>;
  freeAutoCompactCooldownRef: MutableRefObject<Record<string, number>>;
  jevCompressCooldownRef: MutableRefObject<Record<string, number>>;
  jevCompressWarnedRef: MutableRefObject<Record<string, number>>;
  jevCompressBaselineRef: MutableRefObject<Record<string, { turns: number; items: number }>>;
  freeAutoCompactBusyRef: MutableRefObject<boolean>;
  freeCompactBarrierRef: MutableRefObject<(() => Promise<void>) | null>;
  jevCompressDirectiveRef: MutableRefObject<((options?: { threadId?: string }) => Promise<string | void>) | null>;
  freeModelRefreshRef: MutableRefObject<{ token: string; promise: Promise<ProviderConfig[]> } | null>;
  freeModelRefreshedTokenRef: MutableRefObject<string | null>;
  freeModelAccessPromptedRef: MutableRefObject<string | null>;
  freeModelStartupRefreshedRef: MutableRefObject<string | null>;
  setCompactionSourceByTurnId: Dispatch<SetStateAction<Record<string, { source: "free" | "native"; providerId: string; model: string }>>>;
  setFreeModelAccessOpen: Dispatch<SetStateAction<boolean>>;
  setFreeModelNotice: Dispatch<SetStateAction<string | null>>;
  configuredContextWindow: number | null;
  providersRef: MutableRefObject<ProviderConfig[]>;
  threadTokenUsage: Record<string, ThreadTokenUsageState>;
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
  const { authSession, imageRuntimeSelection, historySelectionForThread, updateRuntimeSelection, updateImageRuntimeSelection, setThreadRuntimePersistencePaused, awaitThreadRuntimePersistence } = input;
  const {
    freeCompactionWaitersRef, freeCompactionContextWindowByTurnIdRef, freeCompactionSourceTurnIdsRef,
    freeAutoCompactCooldownRef, jevCompressCooldownRef, jevCompressWarnedRef, jevCompressBaselineRef,
    freeAutoCompactBusyRef, freeCompactBarrierRef, jevCompressDirectiveRef, freeModelRefreshRef,
    freeModelRefreshedTokenRef, freeModelAccessPromptedRef, freeModelStartupRefreshedRef,
    setCompactionSourceByTurnId, setFreeModelAccessOpen, setFreeModelNotice, configuredContextWindow, providersRef,
    threadTokenUsage,
  } = input;
  const refreshFreeCompactionModels = useCallback((force = false): Promise<ProviderConfig[]> => {
    const token = state.token;
    if (!token) return Promise.reject(new Error("Authentication required"));
    if (!force && freeModelRefreshedTokenRef.current === token) {
      return Promise.resolve(providersRef.current);
    }
    const inFlight = freeModelRefreshRef.current;
    if (inFlight?.token === token) return inFlight.promise;

    const task = importOmniRouteFreeRelay(token)
      .then(() => refreshProviders(token, { force: true }))
      .then((providers: ProviderConfig[]) => {
        freeModelRefreshedTokenRef.current = token;
        return providers;
      });
    const tracked = task.finally(() => {
      if (freeModelRefreshRef.current?.promise === tracked) freeModelRefreshRef.current = null;
    });
    freeModelRefreshRef.current = { token, promise: tracked };
    return tracked;
  }, [refreshProviders, state.token]);

  const notifyFreeModelSyncSuccess = useCallback((importedModels?: number) => {
    const text = typeof importedModels === "number" && importedModels > 0
      ? t("chat.freeModelsRefreshed", { count: importedModels })
      : t("chat.freeModelsRefreshedSimple");
    setFreeModelNotice(text);
    if (window.codexUltraDesktop?.notify) {
      void window.codexUltraDesktop.notify({
        title: "Codex Ultra",
        body: text,
        tag: "free-model-sync"
      }).catch((err: unknown) => console.warn("[desktop-notification] failed to notify free model sync", err));
    }
  }, [t]);

  const syncOmniRouteFree = useCallback(async () => {
    const token = state.token;
    if (!token) throw new Error("Authentication required");
    const result = await importOmniRouteFreeRelay(token);
    await refreshProviders(token, { force: true });
    freeModelRefreshedTokenRef.current = token;
    notifyFreeModelSyncSuccess(result.importedModels);
    return result;
  }, [notifyFreeModelSyncSuccess, refreshProviders, state.token]);

  useEffect(() => {
    if (!state.token || (authSession?.user && authSession.user.role !== "admin")) return;
    if (freeModelStartupRefreshedRef.current !== state.token) {
      freeModelStartupRefreshedRef.current = state.token;
      void syncOmniRouteFree().catch((error: unknown) => {
        console.warn("[omniroute-free] startup model refresh failed", error);
      });
      return;
    }
    if (!shouldRefreshFreeCompactionModels(
      runtimeSelection.freeAutoCompactEnabled,
      runtimeSelection.freeAutoCompactProviderId
    )) return;
    void refreshFreeCompactionModels().catch((error: unknown) => {
      console.warn("[free-auto-compact] startup model refresh failed", error);
    });
  }, [
    authSession?.user,
    refreshFreeCompactionModels,
    runtimeSelection.freeAutoCompactEnabled,
    runtimeSelection.freeAutoCompactProviderId,
    state.activeThreadId,
    state.token,
    syncOmniRouteFree
  ]);

  useEffect(() => {
    if (!FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED || !state.token || authSession?.user?.role !== "admin" || !state.providers.some((provider: ProviderConfig) => provider.id === "omniroute-free")) return;
    let cancelled = false;
    const checkRefresh = async () => {
      try {
        const status = await fetchFreeModelAccessStatus(state.token!);
        if (cancelled || !status.configured || !status.refreshRequired) return;
        const promptKey = `${status.license.expiresAt ?? status.license.reason}:${status.lastRefreshedAt ?? "never"}`;
        if (freeModelAccessPromptedRef.current === promptKey) return;
        freeModelAccessPromptedRef.current = promptKey;
        setFreeModelAccessOpen(true);
      } catch {
        // A transient licensing-service outage must not block the rest of the workbench.
      }
    };
    void checkRefresh();
    const timer = window.setInterval(() => void checkRefresh(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authSession?.user?.role, state.providers, state.token]);







  const runFreeCompactionBeforeSend = useCallback(async (options?: { threadId?: string; silentSkip?: boolean }): Promise<void> => {
    const threadId = options?.threadId ?? activeThreadIdRef.current;
    if (!threadId) return;
    const threadSelection = selectionForThread(threadId);
    if (!threadSelection.freeAutoCompactEnabled) return;
    if (freeAutoCompactBusyRef.current) return;
    if (workspaceMode !== "local") return;
    if (latestActionableRunningTurn(state.turns, threadId)) {
      console.info("[free-auto-compact] skip: the active thread already has a running turn");
      return;
    }

    const readinessInput = {
      currentModel: threadSelection.model,
      providers: state.providers,
      workspaceMode,
      activeThreadId: threadId,
      manualProviderId: threadSelection.freeAutoCompactProviderId,
      manualGroupId: threadSelection.freeAutoCompactGroupId,
      manualFreeModel: threadSelection.freeAutoCompactModel
    };
    let readiness = checkFreeCompactionReadiness(readinessInput);
    if (!readiness.ok && shouldRefreshFreeCompactionModels(
      threadSelection.freeAutoCompactEnabled,
      threadSelection.freeAutoCompactProviderId,
      readiness.reason
    )) {
      try {
        const refreshedProviders = await refreshFreeCompactionModels(true);
        readiness = checkFreeCompactionReadiness({ ...readinessInput, providers: refreshedProviders });
      } catch (error) {
        console.warn("[free-auto-compact] pre-send model refresh failed", error);
      }
    }
    if (!readiness.ok) {
      // The post-turn check runs automatically after every completed turn, so
      // it must not toast on every routine "not ready" outcome.
      if (!options?.silentSkip) {
        setSlashNotice({
          id: `free-compact-skip-${Date.now()}`,
          title: "省钱模式跳过免费压缩",
          message: describeFreeCompactionUnready(readiness.reason, readiness.detail),
          severity: "warning"
        });
      }
      console.warn("[free-auto-compact] skip:", readiness.reason, readiness.detail ?? "");
      return;
    }

    const tokenState = threadTokenUsage[threadId];
    const activeContextWindow = resolveDisplayedContextWindow(tokenState?.modelContextWindow, configuredContextWindow);
    const usageInput = tokenState && activeContextWindow != null
      ? {
          usedTokens: (tokenState.contextUsage ?? tokenState.last).totalTokens,
          contextWindow: activeContextWindow
        }
      : null;
    const metrics = contextUsageMetrics(usageInput);
    if (metrics.percentage == null || metrics.percentage < threadSelection.freeAutoCompactThreshold) return;

    const cooldownUntil = freeAutoCompactCooldownRef.current[threadId] ?? 0;
    if (Date.now() < cooldownUntil) {
      console.info("[free-auto-compact] within cooldown, deferring");
      return;
    }

    freeAutoCompactBusyRef.current = true;
    freeAutoCompactCooldownRef.current[threadId] = Date.now() + FREE_AUTOCOMPACT_COOLDOWN_MS;
    setThreadRuntimePersistencePaused(threadId, true);
    try {
      await awaitThreadRuntimePersistence(threadId);
    } catch (error) {
      freeAutoCompactBusyRef.current = false;
      setThreadRuntimePersistencePaused(threadId, false);
      throw error;
    }
    setSlashNotice({
      id: `free-compact-start-${Date.now()}`,
      title: "省钱模式触发免费压缩",
      message: `上下文 ${metrics.percentage}% ≥ ${threadSelection.freeAutoCompactThreshold}%，仅临时为当前对话路由到 ${readiness.providerId}/${readiness.model} 压缩`,
      severity: "success"
    });
    try {
      const completion = new Promise<void>((resolve: (value: void | PromiseLike<void>) => void, reject: (reason?: unknown) => void) => {
        const timeout = window.setTimeout(() => {
          freeCompactionWaitersRef.current.delete(threadId);
          reject(new Error("Free compaction timed out after 5 minutes"));
        }, 5 * 60_000);
        const waiter = {
          resolve: () => {
            window.clearTimeout(timeout);
            resolve();
          },
          reject: (error: Error) => {
            window.clearTimeout(timeout);
            reject(error);
          },
          cancel: () => {
            window.clearTimeout(timeout);
            if (freeCompactionWaitersRef.current.get(threadId) === waiter) {
              freeCompactionWaitersRef.current.delete(threadId);
            }
          },
          providerId: readiness.providerId,
          model: readiness.model,
          contextWindow: configuredContextWindow
        };
        freeCompactionWaitersRef.current.set(threadId, waiter);
      });
      const compactResult = asRecord(await client.rpc("thread/compact/start", { threadId }));
      const compactTurnId = stringValue(asRecord(compactResult.turn).id) ?? stringValue(compactResult.turnId);
      if (!compactTurnId) throw new Error("Free compaction did not return a turn ID");
      const waiter = freeCompactionWaitersRef.current.get(threadId);
      if (waiter) {
        if (waiter.turnId && waiter.turnId !== compactTurnId) {
          throw new Error(`Free compaction turn mismatch: ${waiter.turnId} != ${compactTurnId}`);
        }
        waiter.turnId = compactTurnId;
        freeCompactionContextWindowByTurnIdRef.current[compactTurnId] = waiter.contextWindow;
        freeCompactionSourceTurnIdsRef.current.add(compactTurnId);
        setCompactionSourceByTurnId((current: Record<string, { source: "free" | "native"; providerId: string; model: string }>) => ({
          ...current,
          [compactTurnId]: {
            source: "free",
            providerId: waiter.providerId,
            model: waiter.model
          }
        }));
      }
      await completion;
      setSlashNotice({
        id: `free-compact-done-${Date.now()}`,
        title: "省钱模式压缩完成",
        message: `已用 ${readiness.providerId}/${readiness.model} 压缩；当前对话的 relay、模型与上下文配置始终保持不变。`,
        severity: "success"
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setSlashNotice({
        id: `free-compact-error-${Date.now()}`,
        title: "免费压缩失败",
        message: text,
        severity: "warning"
      });
      console.warn("[free-auto-compact] failed:", text);
    } finally {
      freeAutoCompactBusyRef.current = false;
      freeCompactionWaitersRef.current.get(threadId)?.cancel();
      setThreadRuntimePersistencePaused(threadId, false);
    }
  }, [
    client,
    configuredContextWindow,
    awaitThreadRuntimePersistence,
    refreshFreeCompactionModels,
    selectionForThread,
    setSlashNotice,
    setThreadRuntimePersistencePaused,
    state.providers,
    state.turns,
    threadTokenUsage,
    workspaceMode
  ]);

  const runJevCompressDirective = useCallback(async (options?: { threadId?: string }): Promise<string | void> => {
    const threadId = options?.threadId ?? activeThreadIdRef.current;
    if (!threadId) return;
    const threadSelection = selectionForThread(threadId);
    const mode = threadSelection.compactMode ?? (threadSelection.freeAutoCompactEnabled ? "cheap" : "off");
    if (mode !== "jev-sub" && mode !== "jev-token") return;
    if (workspaceMode !== "local") return;
    if (latestActionableRunningTurn(state.turns, threadId)) return;
    const tools = threadSelection.vmPolicy?.tools;
    const now = Date.now();
    if (!tools?.jevCompress || !tools?.clearToolHistory) {
      // 兜底(a)：能力未开则提醒一次（同线程60s内不再打扰），不注入、不拦截发送。
      if (now >= (jevCompressWarnedRef.current[threadId] ?? 0)) {
        jevCompressWarnedRef.current[threadId] = now + FREE_AUTOCOMPACT_COOLDOWN_MS;
        setSlashNotice({
          id: `jev-compress-warn-${now}`,
          title: "JEV压缩未启用能力开关",
          message: !tools?.jevCompress
            ? "当前对话的压缩策略需要代码增强工具第 7 节的 jev_compress，请先开启"
            : "当前对话的压缩策略需要代码增强工具第 6 节的 clear_tool_history，请先开启",
          severity: "warning"
        });
      }
      return;
    }
    // 增量门控（JEV选c）：计数快照先行，变了再bounded确认工具类型；无新增直接跳过。
    // 类型集对齐 chatRows.ts isToolActivityItem（image类除外，只盯可剪的调用输出）。
    const isPrunableToolItem = (type: string): boolean => type === "commandExecution"
      || type === "fileChange"
      || type === "mcpToolCall"
      || type === "dynamicToolCall"
      || type === "toolCall"
      || type === "collabAgentToolCall"
      || type === "subAgentActivity";
    let turnCount = 0;
    let itemCount = 0;
    let latestItems: Array<{ type: string }> = [];
    for (const turn of state.turns) {
      if (turn.threadId !== threadId) continue;
      turnCount += 1;
      const items = Array.isArray(turn.items) ? turn.items : [];
      itemCount += items.length;
      latestItems = items as Array<{ type: string }>;
    }
    const baseline = jevCompressBaselineRef.current[threadId];
    if (baseline && baseline.turns === turnCount && baseline.items === itemCount) return;
    const hasNewTool = latestItems.slice(-40).some((item: { type: string }) => isPrunableToolItem(item.type));
    jevCompressBaselineRef.current[threadId] = { turns: turnCount, items: itemCount };
    if (!hasNewTool) return;
    if (mode === "jev-token") {
      const tokenState = threadTokenUsage[threadId];      const activeContextWindow = resolveDisplayedContextWindow(tokenState?.modelContextWindow, configuredContextWindow);
      const usageInput = tokenState && activeContextWindow != null
        ? {
            usedTokens: (tokenState.contextUsage ?? tokenState.last).totalTokens,
            contextWindow: activeContextWindow
          }
        : null;
      const metrics = contextUsageMetrics(usageInput);
      const threshold = threadSelection.jevCompressThreshold ?? 85;
      if (metrics.percentage == null || metrics.percentage < threshold) return;
    }
    if (now < (jevCompressCooldownRef.current[threadId] ?? 0)) return;
    jevCompressCooldownRef.current[threadId] = now + FREE_AUTOCOMPACT_COOLDOWN_MS;
    const planMode = mode === "jev-sub" ? "subscription" : "token";
    return `[compress]若自上次裁剪有新增工具输出，先执行 sa_vm_run({action:"jev_compress",mode:"${planMode}"}) 再答，不复述。`;
  }, [
    configuredContextWindow,
    selectionForThread,
    setSlashNotice,
    state.turns,
    threadTokenUsage,
    workspaceMode
  ]);
  return {
    refreshFreeCompactionModels,
    notifyFreeModelSyncSuccess,
    syncOmniRouteFree,
    runFreeCompactionBeforeSend,
    runJevCompressDirective,
  };
}
