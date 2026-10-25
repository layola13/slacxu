import { useCallback, useSyncExternalStore } from "react";
import type { ThreadTokenUsageState, TokenUsageBreakdown } from "../../components/ChatPanel";
import type { ThreadEntry } from "../../state/codexClient";
import { priceTokenBreakdownFromSnapshot, sumTokenBreakdowns } from "./usagePricing";

const EMPTY_TURN_USAGE: Record<string, TokenUsageBreakdown> = {};
type Listener = () => void;

export interface TopicUsageSnapshot {
  threadUsage?: ThreadTokenUsageState;
  turnUsage: Record<string, TokenUsageBreakdown>;
  requestUsage: Record<string, Record<string, TokenUsageBreakdown>>;
}

export class TopicUsageStore {
  private readonly threadUsage = new Map<string, ThreadTokenUsageState>();
  private readonly contextWindowOverrides = new Map<string, number | null>();
  private readonly turnUsage = new Map<string, TokenUsageBreakdown>();
  private readonly requestUsageByTurn = new Map<string, Map<string, TokenUsageBreakdown>>();
  private readonly turnUsageBaselines = new Map<string, TokenUsageBreakdown>();
  private readonly turnIdsByThread = new Map<string, Set<string>>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly versions = new Map<string, number>();
  private readonly snapshots = new Map<string, TopicUsageSnapshot>();
  private allThreadUsageSnapshot: Record<string, ThreadTokenUsageState> = {};
  private allThreadUsageDirty = false;
  private readonly ownerTopicByThread = new Map<string, string>();
  private readonly threadIdsByTopic = new Map<string, Set<string>>();
  private readonly pending = new Map<string, { threadId: string; turnId?: string; usage: ThreadTokenUsageState }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly finalizationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly finalizedTurns = new Set<string>();
  private readonly scheduledNotifyTopics = new Set<string>();
  private scheduledNotifyTimer: ReturnType<typeof setTimeout> | null = null;
  private listenerWakeCount = 0;
  private updateCount = 0;

  replaceCatalog(threads: readonly ThreadEntry[]): void {
    // History search and automation filters expose partial catalogs. Keep
    // routing for already observed agents until explicit eviction so an active
    // child never becomes a temporary root topic while the sidebar is filtered.
    for (const thread of threads) this.registerThread(thread);
  }

  registerThread(thread: Pick<ThreadEntry, "id" | "parentThreadId">): void {
    const ownerTopicId = thread.parentThreadId ?? thread.id;
    const previousOwner = this.ownerTopicByThread.get(thread.id);
    if (previousOwner === ownerTopicId) return;
    if (previousOwner) {
      const previousIds = this.threadIdsByTopic.get(previousOwner);
      previousIds?.delete(thread.id);
      if (previousIds?.size === 0) this.threadIdsByTopic.delete(previousOwner);
    }
    this.ownerTopicByThread.set(thread.id, ownerTopicId);
    let topicThreadIds = this.threadIdsByTopic.get(ownerTopicId);
    if (!topicThreadIds) {
      topicThreadIds = new Set();
      this.threadIdsByTopic.set(ownerTopicId, topicThreadIds);
    }
    topicThreadIds.add(thread.id);
    if (previousOwner) this.snapshots.delete(previousOwner);
    this.snapshots.delete(ownerTopicId);
  }

  update(threadId: string | undefined, turnId: string | undefined, usage: ThreadTokenUsageState): void {
    if (!threadId) return;
    this.updateCount += 1;
    this.write(threadId, turnId, usage);
    const listeners = this.listeners.get(threadId);
    if (!listeners?.size) return;
    this.versions.set(threadId, (this.versions.get(threadId) ?? 0) + 1);
    for (const listener of listeners) {
      this.listenerWakeCount += 1;
      listener();
    }
  }

  updateRequest(threadId: string | undefined, turnId: string | undefined, requestId: string | undefined, usage: TokenUsageBreakdown): void {
    if (!threadId || !turnId || !requestId) return;
    let requests = this.requestUsageByTurn.get(turnId);
    if (!requests) { requests = new Map(); this.requestUsageByTurn.set(turnId, requests); }
    requests.set(requestId, usage);
    const turnUsage = sumTokenBreakdowns([...requests.values()]);
    if (!turnUsage) return;
    this.turnUsage.set(turnId, turnUsage);
    let ids = this.turnIdsByThread.get(threadId);
    if (!ids) { ids = new Set(); this.turnIdsByThread.set(threadId, ids); }
    ids.add(turnId);
    const allTurns = [...ids].map((id) => this.turnUsage.get(id)).filter((value): value is TokenUsageBreakdown => Boolean(value));
    const total = sumTokenBreakdowns(allTurns) ?? turnUsage;
    const previous = this.threadUsage.get(threadId);
    const contextUsage: TokenUsageBreakdown = {
      ...usage,
      // Normalized inputTokens already includes cache reads and writes.
      // The ring tracks this request's context, never billing accumulation.
      totalTokens: usage.inputTokens,
      outputTokens: 0,
      reasoningOutputTokens: 0
    };
    this.threadUsage.set(threadId, {
      total,
      last: turnUsage,
      contextUsage,
      modelContextWindow: previous?.modelContextWindow ?? null
    });
    this.allThreadUsageDirty = true;
    this.snapshots.delete(threadId);
    this.updateCount += 1;
  }

  restoreRequest(threadId: string | undefined, turnId: string | undefined, requestId: string | undefined, usage: TokenUsageBreakdown): void {
    if (!threadId || !turnId || !requestId) return;
    let requests = this.requestUsageByTurn.get(turnId);
    if (!requests) { requests = new Map(); this.requestUsageByTurn.set(turnId, requests); }
    if (requests.has(requestId)) return;
    requests.set(requestId, usage);
    const turnUsage = sumTokenBreakdowns([...requests.values()]);
    if (!turnUsage) return;
    this.turnUsage.set(turnId, turnUsage);
    let ids = this.turnIdsByThread.get(threadId);
    if (!ids) { ids = new Set(); this.turnIdsByThread.set(threadId, ids); }
    ids.add(turnId);
    const total = sumTokenBreakdowns([...ids].map((id) => this.turnUsage.get(id)).filter((value): value is TokenUsageBreakdown => Boolean(value))) ?? turnUsage;
    const previous = this.threadUsage.get(threadId);
    this.threadUsage.set(threadId, { total, last: turnUsage, ...(previous?.contextUsage ? { contextUsage: previous.contextUsage } : {}), modelContextWindow: previous?.modelContextWindow ?? null });
    this.allThreadUsageDirty = true;
    this.snapshots.delete(threadId);
    this.updateCount += 1;
    this.scheduleNotifyTopics([threadId]);
  }

  setContextWindow(threadId: string | undefined, contextWindow: number | null | undefined): void {
    if (!threadId) return;
    if (contextWindow === undefined) this.contextWindowOverrides.delete(threadId);
    else this.contextWindowOverrides.set(threadId, contextWindow);
    const previous = this.threadUsage.get(threadId);
    const nextContextWindow = contextWindow ?? null;
    if (!previous || previous.modelContextWindow === nextContextWindow) return;
    this.threadUsage.set(threadId, { ...previous, modelContextWindow: nextContextWindow });
    this.allThreadUsageDirty = true;
    this.snapshots.delete(threadId);
    this.notifyTopics([threadId]);
  }

  enqueue(threadId: string | undefined, turnId: string | undefined, usage: ThreadTokenUsageState): void {
    if (!threadId) return;
    const key = `${threadId}|${turnId ?? ""}`;
    this.pending.set(key, { threadId, turnId, usage });
    if (this.flushTimer !== null) return;
    this.flushTimer = globalThis.setTimeout(() => {
      this.flushTimer = null;
      const pending = [...this.pending.values()];
      this.pending.clear();
      for (const entry of pending) {
        this.updateCount += 1;
        this.write(entry.threadId, entry.turnId, entry.usage);
      }
      // Token usage notifications can arrive once per streamed chunk. Keep
      // updating the in-memory counters, but do not wake React while a turn is
      // active. A terminal turn event calls finalizeTurn and publishes once.
    }, 160);
  }

  flushAndNotify(threadId?: string): void {
    const pending = [...this.pending.values()].filter((entry) => !threadId || entry.threadId === threadId);
    for (const entry of pending) this.pending.delete(entry.threadId + "|" + (entry.turnId ?? ""));
    if (this.pending.size === 0 && this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const topics = new Set<string>();
    for (const entry of pending) {
      this.updateCount += 1;
      this.write(entry.threadId, entry.turnId, entry.usage);
      topics.add(this.ownerTopicByThread.get(entry.threadId) ?? entry.threadId);
    }
    if (threadId) topics.add(this.ownerTopicByThread.get(threadId) ?? threadId);
    for (const topicId of this.scheduledNotifyTopics) {
      if (!threadId || topicId === threadId) topics.add(topicId);
    }
    this.scheduledNotifyTopics.clear();
    if (this.scheduledNotifyTimer !== null) {
      clearTimeout(this.scheduledNotifyTimer);
      this.scheduledNotifyTimer = null;
    }
    this.notifyTopics(topics);
  }

  /** Publish the final usage snapshot once after a turn reaches a terminal state. */
  finalizeTurn(threadId: string | undefined, turnId: string | undefined): void {
    if (!threadId || !turnId) return;
    const key = `${threadId}|${turnId}`;
    if (this.finalizedTurns.has(key) || this.finalizationTimers.has(key)) return;
    this.finalizedTurns.add(key);
    if (this.finalizedTurns.size > 5_000) {
      const oldest = this.finalizedTurns.values().next().value;
      if (oldest) this.finalizedTurns.delete(oldest);
    }
    this.finalizationTimers.set(key, globalThis.setTimeout(() => {
      this.finalizationTimers.delete(key);
      const pending = this.pending.get(key);
      if (pending) {
        this.pending.delete(key);
        this.updateCount += 1;
        this.write(pending.threadId, pending.turnId, pending.usage);
      }
      const topics = new Set<string>([threadId]);
      for (const topicId of this.scheduledNotifyTopics) {
        if (topicId === threadId) topics.add(topicId);
      }
      this.scheduledNotifyTopics.clear();
      if (this.scheduledNotifyTimer !== null) {
        clearTimeout(this.scheduledNotifyTimer);
        this.scheduledNotifyTimer = null;
      }
      this.notifyTopics(topics);
    }, 220));
  }

  snapshot(threadId: string | null): TopicUsageSnapshot {
    if (!threadId) return { turnUsage: EMPTY_TURN_USAGE, requestUsage: {} };
    const cached = this.snapshots.get(threadId);
    if (cached) return cached;
    const turnUsage: Record<string, TokenUsageBreakdown> = {};
    for (const turnId of this.turnIdsByThread.get(threadId) ?? []) {
      const usage = this.turnUsage.get(turnId);
      if (usage) turnUsage[turnId] = usage;
    }
    const requestUsage: Record<string, Record<string, TokenUsageBreakdown>> = {};
    for (const turnId of this.turnIdsByThread.get(threadId) ?? []) {
      const requests = this.requestUsageByTurn.get(turnId);
      if (requests?.size) requestUsage[turnId] = Object.fromEntries(requests);
    }
    const next = { threadUsage: this.threadUsage.get(threadId), turnUsage, requestUsage };
    this.snapshots.set(threadId, next);
    return next;
  }

  allThreadUsage(): Record<string, ThreadTokenUsageState> {
    if (this.allThreadUsageDirty) {
      this.allThreadUsageSnapshot = Object.fromEntries(this.threadUsage);
      this.allThreadUsageDirty = false;
    }
    return this.allThreadUsageSnapshot;
  }

  getTurnUsage(turnId: string | null | undefined): TokenUsageBreakdown | undefined {
    return turnId ? this.turnUsage.get(turnId) : undefined;
  }

  private write(threadId: string, turnId: string | undefined, usage: ThreadTokenUsageState): void {
    const previousThreadUsage = this.threadUsage.get(threadId);
    const contextUsage = usage.contextUsage ?? usage.last;
    const contextWindow = this.contextWindowOverrides.has(threadId)
      ? this.contextWindowOverrides.get(threadId) ?? null
      : usage.modelContextWindow ?? null;
    let normalizedUsage: ThreadTokenUsageState = { ...usage, contextUsage, modelContextWindow: contextWindow };
    if (turnId && this.requestUsageByTurn.has(turnId)) {
      const requestUsage = sumTokenBreakdowns([...(this.requestUsageByTurn.get(turnId)?.values() ?? [])]);
      if (requestUsage) {
        this.turnUsage.set(turnId, requestUsage);
        let ids = this.turnIdsByThread.get(threadId);
        if (!ids) { ids = new Set(); this.turnIdsByThread.set(threadId, ids); }
        ids.add(turnId);
        const allTurns = [...ids].map((id) => this.turnUsage.get(id)).filter((value): value is TokenUsageBreakdown => Boolean(value));
        normalizedUsage = {
          ...usage,
          contextUsage,
          modelContextWindow: contextWindow,
          total: sumTokenBreakdowns(allTurns) ?? requestUsage,
          last: requestUsage,
        };
      }
    } else if (turnId) {
      let baseline = this.turnUsageBaselines.get(turnId);
      if (!baseline && !this.turnUsage.has(turnId) && previousThreadUsage) {
        baseline = previousThreadUsage.total;
        this.turnUsageBaselines.set(turnId, baseline);
      }
      const cumulativeReset = baseline ? usage.total.totalTokens < baseline.totalTokens : false;
      const rawTurnUsage = baseline && !cumulativeReset ? subtractUsageTokens(usage.total, baseline) : usage.last;
      const turnUsage = usage.total.billingSnapshot
        ? priceTokenBreakdownFromSnapshot(rawTurnUsage, usage.total.billingSnapshot)
        : rawTurnUsage;
      const previousTotalCost = cumulativeReset ? 0 : previousThreadUsage?.total.estimatedCostUsd ?? 0;
      const cumulativeCost = turnUsage.estimatedCostUsd != null ? previousTotalCost + turnUsage.estimatedCostUsd : usage.total.estimatedCostUsd;
      normalizedUsage = {
        ...usage,
        contextUsage,
        total: {
          ...usage.total,
          ...(cumulativeCost != null ? { estimatedCostUsd: cumulativeCost } : {}),
          ...(turnUsage.costBreakdownUsd ? { costBreakdownUsd: addCostBreakdowns(cumulativeReset ? undefined : previousThreadUsage?.total.costBreakdownUsd, turnUsage.costBreakdownUsd) } : {})
        },
        last: turnUsage
      };
      this.turnUsage.set(turnId, {
        ...turnUsage,
        ...(cumulativeCost != null ? { totalEstimatedCostUsd: cumulativeCost } : {}),
        ...(usage.total.billingSnapshot ? { billingSnapshot: usage.total.billingSnapshot } : {})
      });
      let ids = this.turnIdsByThread.get(threadId);
      if (!ids) { ids = new Set(); this.turnIdsByThread.set(threadId, ids); }
      ids.add(turnId);
    }
    this.threadUsage.set(threadId, normalizedUsage);
    this.allThreadUsageDirty = true;
    this.snapshots.delete(threadId);
  }

  private notifyTopics(topicIds: Iterable<string>): void {
    for (const topicId of topicIds) {
      const listeners = this.listeners.get(topicId);
      if (!listeners?.size) continue;
      this.versions.set(topicId, (this.versions.get(topicId) ?? 0) + 1);
      for (const listener of listeners) {
        this.listenerWakeCount += 1;
        listener();
      }
    }
  }

  private scheduleNotifyTopics(topicIds: Iterable<string>): void {
    for (const topicId of topicIds) this.scheduledNotifyTopics.add(topicId);
    if (this.scheduledNotifyTimer !== null) return;
    this.scheduledNotifyTimer = globalThis.setTimeout(() => {
      this.scheduledNotifyTimer = null;
      const topics = [...this.scheduledNotifyTopics];
      this.scheduledNotifyTopics.clear();
      this.notifyTopics(topics);
    }, 220);
  }

  evict(topicIds: Iterable<string>): void {
    const affectedTopics = new Set<string>();
    for (const topicId of topicIds) {
      const scopedThreadIds = new Set(this.threadIdsByTopic.get(topicId) ?? [topicId]);
      scopedThreadIds.add(topicId);
      for (const threadId of scopedThreadIds) {
        affectedTopics.add(this.ownerTopicByThread.get(threadId) ?? threadId);
        this.threadUsage.delete(threadId);
        this.contextWindowOverrides.delete(threadId);
        for (const turnId of this.turnIdsByThread.get(threadId) ?? []) this.turnUsage.delete(turnId);
        for (const turnId of this.turnIdsByThread.get(threadId) ?? []) this.requestUsageByTurn.delete(turnId);
        for (const turnId of this.turnIdsByThread.get(threadId) ?? []) this.turnUsageBaselines.delete(turnId);
        this.turnIdsByThread.delete(threadId);
        this.ownerTopicByThread.delete(threadId);
        for (const key of this.pending.keys()) {
          if (key.startsWith(`${threadId}|`)) this.pending.delete(key);
        }
      }
      this.threadIdsByTopic.delete(topicId);
      this.snapshots.delete(topicId);
    }
    if (affectedTopics.size > 0) {
      this.allThreadUsageDirty = true;
      this.notifyTopics(affectedTopics);
    }
  }

  subscribe(threadId: string | null, listener: Listener): () => void {
    if (!threadId) return () => undefined;
    let listeners = this.listeners.get(threadId);
    if (!listeners) { listeners = new Set(); this.listeners.set(threadId, listeners); }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (!listeners?.size) {
        this.listeners.delete(threadId);
        this.snapshots.delete(threadId);
      }
    };
  }

  version(threadId: string | null): number { return threadId ? this.versions.get(threadId) ?? 0 : 0; }

  diagnostics() {
    return {
      usageThreadBucketCount: this.threadUsage.size,
      usageTurnBucketCount: this.turnUsage.size,
      usageRoutingEntryCount: this.ownerTopicByThread.size,
      usageSubscribedTopicCount: this.listeners.size,
      usageMaterializedSnapshotCount: this.snapshots.size,
      usagePendingCount: this.pending.size,
      usageUpdateCount: this.updateCount,
      usageListenerWakeCount: this.listenerWakeCount
    };
  }
}

function subtractUsageTokens(current: TokenUsageBreakdown, baseline: TokenUsageBreakdown): TokenUsageBreakdown {
  const estimatedCostUsd = current.estimatedCostUsd != null && baseline.estimatedCostUsd != null
    ? Math.max(0, current.estimatedCostUsd - baseline.estimatedCostUsd)
    : undefined;
  const costBreakdownUsd = current.costBreakdownUsd && baseline.costBreakdownUsd ? {
    input: Math.max(0, current.costBreakdownUsd.input - baseline.costBreakdownUsd.input),
    cachedInput: Math.max(0, current.costBreakdownUsd.cachedInput - baseline.costBreakdownUsd.cachedInput),
    cacheWrite: Math.max(0, current.costBreakdownUsd.cacheWrite - baseline.costBreakdownUsd.cacheWrite),
    output: Math.max(0, current.costBreakdownUsd.output - baseline.costBreakdownUsd.output)
  } : undefined;
  return {
    totalTokens: Math.max(0, current.totalTokens - baseline.totalTokens),
    inputTokens: Math.max(0, current.inputTokens - baseline.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - baseline.cachedInputTokens),
    cacheWriteInputTokens: Math.max(0, current.cacheWriteInputTokens - baseline.cacheWriteInputTokens),
    outputTokens: Math.max(0, current.outputTokens - baseline.outputTokens),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - baseline.reasoningOutputTokens),
    ...(estimatedCostUsd != null ? { estimatedCostUsd } : {}),
    ...(costBreakdownUsd ? { costBreakdownUsd } : {}),
    ...(current.billingSnapshot ? { billingSnapshot: current.billingSnapshot } : {})
  };
}

function addCostBreakdowns(left: TokenUsageBreakdown["costBreakdownUsd"], right: NonNullable<TokenUsageBreakdown["costBreakdownUsd"]>): NonNullable<TokenUsageBreakdown["costBreakdownUsd"]> {
  return { input: (left?.input ?? 0) + right.input, cachedInput: (left?.cachedInput ?? 0) + right.cachedInput, cacheWrite: (left?.cacheWrite ?? 0) + right.cacheWrite, output: (left?.output ?? 0) + right.output };
}

export function useTopicUsage(store: TopicUsageStore, threadId: string | null): TopicUsageSnapshot {
  const subscribe = useCallback((listener: Listener) => store.subscribe(threadId, listener), [store, threadId]);
  const getSnapshot = useCallback(() => store.version(threadId), [store, threadId]);
  useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot
  );
  return store.snapshot(threadId);
}
