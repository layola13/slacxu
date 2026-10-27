import { expect, test } from "bun:test";
import { TopicUsageStore } from "../../apps/web/src/app/usage/topicUsageStore.ts";
import { TopicTranscriptStore } from "../../apps/web/src/app/transcripts/topicTranscriptStore.ts";
import type { ThreadEntry } from "../../apps/web/src/state/codexClient.ts";

const usage = {
  total: { totalTokens: 10, inputTokens: 4, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 6, reasoningOutputTokens: 0 },
  last: { totalTokens: 10, inputTokens: 4, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 6, reasoningOutputTokens: 0 }
};

test("child agent usage wakes only a selected child subscription", () => {
  const store = new TopicUsageStore();
  const threads: ThreadEntry[] = Array.from({ length: 100 }, (_, index) => ({ id: `main-${index}` }));
  const agents: ThreadEntry[] = Array.from({ length: 100 }, (_, index) => ({ id: `agent-${index}`, parentThreadId: `main-${index}` }));
  store.replaceCatalog([...threads, ...agents]);
  const wakes = new Array(100).fill(0);
  threads.forEach((thread, index) => store.subscribe(thread.id, () => wakes[index]++));
  let childWakes = 0;
  store.subscribe("agent-42", () => childWakes++);

  store.update("agent-42", "turn-42", usage);

  expect(wakes.reduce((total, value) => total + value, 0)).toBe(0);
  expect(childWakes).toBe(1);
  expect(store.snapshot("main-42").turnUsage["turn-42"]).toBeUndefined();
  expect(store.snapshot("agent-42").turnUsage["turn-42"]).toEqual(usage.last);
});

test("usage bursts stay silent until the turn is finalized", async () => {
  const store = new TopicUsageStore();
  store.replaceCatalog([{ id: "main" }, { id: "agent-a", parentThreadId: "main" }, { id: "agent-b", parentThreadId: "main" }]);
  let wakes = 0;
  store.subscribe("agent-a", () => wakes++);
  for (let index = 0; index < 100; index++) {
    store.enqueue(index % 2 ? "agent-a" : "agent-b", `turn-${index % 2}`, usage);
  }
  expect(wakes).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 180));
  expect(wakes).toBe(0);
  store.finalizeTurn("agent-a", "turn-1");
  await new Promise((resolve) => setTimeout(resolve, 260));
  expect(wakes).toBe(1);
});

test("request usage is idempotent and sums into the turn", () => {
  const store = new TopicUsageStore();
  store.replaceCatalog([{ id: "thread" }]);
  const first = { totalTokens: 10, inputTokens: 6, cachedInputTokens: 2, cacheWriteInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 0 };
  const second = { totalTokens: 8, inputTokens: 5, cachedInputTokens: 1, cacheWriteInputTokens: 0, outputTokens: 3, reasoningOutputTokens: 0 };
  store.updateRequest("thread", "turn", "request-1", first);
  store.updateRequest("thread", "turn", "request-1", first);
  store.updateRequest("thread", "turn", "request-2", second);
  expect(store.snapshot("thread").requestUsage.turn).toEqual({ "request-1": first, "request-2": second });
  expect(store.getTurnUsage("turn")).toMatchObject({ totalTokens: 18, inputTokens: 11, outputTokens: 7 });
  expect(store.snapshot("thread").threadUsage?.total).toMatchObject({ totalTokens: 18, inputTokens: 11, outputTokens: 7 });
});

test("streaming request usage stays silent until the turn is finalized", async () => {
  const store = new TopicUsageStore();
  store.replaceCatalog([{ id: "thread" }]);
  let wakes = 0;
  store.subscribe("thread", () => wakes++);
  const request = { totalTokens: 10, inputTokens: 6, cachedInputTokens: 2, cacheWriteInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 0 };

  store.updateRequest("thread", "turn", "request-1", request);
  await new Promise((resolve) => setTimeout(resolve, 260));
  expect(wakes).toBe(0);

  store.finalizeTurn("thread", "turn");
  await new Promise((resolve) => setTimeout(resolve, 260));
  expect(wakes).toBe(1);
});

test("keeps context usage on the latest request instead of billing accumulation", () => {
  const store = new TopicUsageStore();
  store.replaceCatalog([{ id: "thread" }]);
  const first = { totalTokens: 130, inputTokens: 120, cachedInputTokens: 20, cacheWriteInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0 };
  const second = { totalTokens: 100, inputTokens: 90, cachedInputTokens: 15, cacheWriteInputTokens: 5, outputTokens: 10, reasoningOutputTokens: 0 };
  store.updateRequest("thread", "turn", "request-1", first);
  store.updateRequest("thread", "turn", "request-2", second);

  expect(store.getTurnUsage("turn")).toMatchObject({ totalTokens: 230, inputTokens: 210, outputTokens: 20 });
  expect(store.snapshot("thread").threadUsage?.contextUsage).toMatchObject({
    totalTokens: 90,
    inputTokens: 90,
    cachedInputTokens: 15,
    cacheWriteInputTokens: 5,
    outputTokens: 0
  });
});

test("request usage remains authoritative when a legacy total notification follows", () => {
  const store = new TopicUsageStore();
  store.replaceCatalog([{ id: "thread" }]);
  const request = { totalTokens: 18, inputTokens: 11, cachedInputTokens: 3, cacheWriteInputTokens: 0, outputTokens: 7, reasoningOutputTokens: 0 };
  store.updateRequest("thread", "turn", "request-1", request);
  store.update("thread", "turn", {
    total: { totalTokens: 900, inputTokens: 600, cachedInputTokens: 200, cacheWriteInputTokens: 0, outputTokens: 100, reasoningOutputTokens: 0 },
    last: { totalTokens: 585_000, inputTokens: 580_000, cachedInputTokens: 300_000, cacheWriteInputTokens: 0, outputTokens: 5_000, reasoningOutputTokens: 0 },
    modelContextWindow: 950_000,
  });
  const snapshot = store.snapshot("thread");
  expect(snapshot.turnUsage.turn).toEqual(request);
  expect(snapshot.threadUsage?.total).toEqual(request);
  expect(snapshot.threadUsage?.contextUsage?.totalTokens).toBe(585_000);
  expect(snapshot.threadUsage?.modelContextWindow).toBe(950_000);
});

test("finalizing a turn twice publishes only once", async () => {
  const store = new TopicUsageStore();
  store.replaceCatalog([{ id: "thread" }]);
  let wakes = 0;
  store.subscribe("thread", () => wakes++);
  store.enqueue("thread", "turn", usage);
  store.finalizeTurn("thread", "turn");
  store.finalizeTurn("thread", "turn");
  await new Promise((resolve) => setTimeout(resolve, 260));
  expect(wakes).toBe(1);
  expect(store.snapshot("thread").turnUsage.turn).toEqual(usage.last);
});

test("thread registration keeps child usage out of the parent subscription", () => {
  const usageStore = new TopicUsageStore();
  usageStore.replaceCatalog([{ id: "main" }]);
  const transcriptStore = new TopicTranscriptStore((thread) => usageStore.registerThread(thread));
  transcriptStore.replaceCatalog([{ id: "main" }]);
  let parentWakes = 0;
  let childWakes = 0;
  usageStore.subscribe("main", () => parentWakes++);
  usageStore.subscribe("agent", () => childWakes++);

  transcriptStore.registerNotificationRouting({
    method: "thread/started",
    params: { thread: { id: "agent", parentThreadId: "main" } }
  });
  usageStore.update("agent", "agent-turn", usage);

  expect(parentWakes).toBe(0);
  expect(childWakes).toBe(1);
  expect(usageStore.snapshot("main").turnUsage["agent-turn"]).toBeUndefined();
  expect(usageStore.snapshot("agent").turnUsage["agent-turn"]).toEqual(usage.last);
});

test("partial catalogs preserve active child routing and eviction releases usage buckets", () => {
  const store = new TopicUsageStore();
  store.replaceCatalog([{ id: "main" }, { id: "agent", parentThreadId: "main" }]);
  store.update("agent", "agent-turn", usage);
  store.replaceCatalog([{ id: "other" }]);

  expect(store.snapshot("agent").turnUsage["agent-turn"]).toEqual(usage.last);
  store.evict(["main"]);
  expect(store.snapshot("main").turnUsage).toEqual({});
  expect(store.diagnostics()).toMatchObject({
    usageThreadBucketCount: 0,
    usageTurnBucketCount: 0,
    usageRoutingEntryCount: 1
  });
});

test("visiting fifteen child pages releases inactive usage snapshots", () => {
  const store = new TopicUsageStore();
  const agents: ThreadEntry[] = Array.from({ length: 15 }, (_, index) => ({
    id: `agent-${index + 1}`,
    parentThreadId: "main"
  }));
  store.replaceCatalog([{ id: "main" }, ...agents]);
  agents.forEach((agent, index) => store.update(agent.id, `turn-${index + 1}`, usage));
  const unsubscribeParent = store.subscribe("main", () => undefined);
  store.snapshot("main");

  for (const agent of agents) {
    const unsubscribeChild = store.subscribe(agent.id, () => undefined);
    store.snapshot(agent.id);
    expect(store.diagnostics()).toMatchObject({
      usageSubscribedTopicCount: 2,
      usageMaterializedSnapshotCount: 2
    });
    unsubscribeChild();
    expect(store.diagnostics()).toMatchObject({
      usageSubscribedTopicCount: 1,
      usageMaterializedSnapshotCount: 1
    });
  }

  unsubscribeParent();
  expect(store.diagnostics()).toMatchObject({
    usageSubscribedTopicCount: 0,
    usageMaterializedSnapshotCount: 0
  });
});

test("derives each turn usage from its own cumulative baseline", () => {
  const store = new TopicUsageStore();
  const first = {
    total: { totalTokens: 100, inputTokens: 70, cachedInputTokens: 50, cacheWriteInputTokens: 0, outputTokens: 30, reasoningOutputTokens: 0, estimatedCostUsd: 0.01 },
    last: { totalTokens: 100, inputTokens: 70, cachedInputTokens: 50, cacheWriteInputTokens: 0, outputTokens: 30, reasoningOutputTokens: 0, estimatedCostUsd: 0.01 }
  };
  const secondCumulative = {
    total: { totalTokens: 260, inputTokens: 190, cachedInputTokens: 140, cacheWriteInputTokens: 0, outputTokens: 70, reasoningOutputTokens: 0, estimatedCostUsd: 0.026 },
    // Some relays incorrectly repeat cumulative values in `last`.
    last: { totalTokens: 260, inputTokens: 190, cachedInputTokens: 140, cacheWriteInputTokens: 0, outputTokens: 70, reasoningOutputTokens: 0, estimatedCostUsd: 0.026 }
  };
  store.update("thread", "turn-1", first);
  store.update("thread", "turn-2", secondCumulative);
  expect(store.snapshot("thread").turnUsage["turn-1"]).toMatchObject({
    ...first.last,
    totalEstimatedCostUsd: 0.01
  });
  const secondTurn = store.snapshot("thread").turnUsage["turn-2"];
  expect(secondTurn).toMatchObject({ totalTokens: 160, inputTokens: 120, cachedInputTokens: 90, outputTokens: 40 });
  expect(secondTurn?.estimatedCostUsd).toBeCloseTo(0.016, 12);
  expect(secondTurn?.totalEstimatedCostUsd).toBeCloseTo(0.026, 12);
  expect(store.snapshot("thread").threadUsage?.contextUsage?.totalTokens).toBe(260);
});

test("falls back to last usage when cumulative counters reset", () => {
  const store = new TopicUsageStore();
  store.update("thread-reset", "turn-before-reset", {
    total: { totalTokens: 1000, inputTokens: 800, cachedInputTokens: 400, cacheWriteInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 0, estimatedCostUsd: 0.1 },
    last: { totalTokens: 100, inputTokens: 80, cachedInputTokens: 40, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0, estimatedCostUsd: 0.01 }
  });
  const afterReset = { totalTokens: 60, inputTokens: 45, cachedInputTokens: 20, cacheWriteInputTokens: 0, outputTokens: 15, reasoningOutputTokens: 0, estimatedCostUsd: 0.006 };
  store.update("thread-reset", "turn-after-reset", { total: afterReset, last: afterReset });
  expect(store.snapshot("thread-reset").turnUsage["turn-after-reset"]).toMatchObject({
    ...afterReset, totalEstimatedCostUsd: 0.006
  });
});

test("changing billing multipliers affects only the new turn and preserves previous cost", () => {
  const store = new TopicUsageStore();
  const fullPrice = { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.2, cacheWriteUsdPerMillion: 2, outputUsdPerMillion: 12, modelMultiplier: 1, inputMultiplier: 1, cacheReadMultiplier: 1, cacheWriteMultiplier: 1, outputMultiplier: 1, groupRatio: 1 };
  const discounted = { ...fullPrice, groupRatio: 0.08 };
  store.update("thread-price-change", "turn-full-price", {
    total: { totalTokens: 200, inputTokens: 150, cachedInputTokens: 100, cacheWriteInputTokens: 0, outputTokens: 50, reasoningOutputTokens: 0, billingSnapshot: fullPrice },
    last: { totalTokens: 200, inputTokens: 150, cachedInputTokens: 100, cacheWriteInputTokens: 0, outputTokens: 50, reasoningOutputTokens: 0 }
  });
  const firstCost = store.snapshot("thread-price-change").turnUsage["turn-full-price"]?.estimatedCostUsd ?? 0;
  store.update("thread-price-change", "turn-discounted", {
    total: { totalTokens: 400, inputTokens: 300, cachedInputTokens: 200, cacheWriteInputTokens: 0, outputTokens: 100, reasoningOutputTokens: 0, billingSnapshot: discounted },
    last: { totalTokens: 400, inputTokens: 300, cachedInputTokens: 200, cacheWriteInputTokens: 0, outputTokens: 100, reasoningOutputTokens: 0 }
  });
  const snapshot = store.snapshot("thread-price-change");
  const secondCost = snapshot.turnUsage["turn-discounted"]?.estimatedCostUsd ?? 0;
  expect(secondCost).toBeCloseTo(firstCost * 0.08, 12);
  expect(snapshot.threadUsage?.total.estimatedCostUsd).toBeCloseTo(firstCost + secondCost, 12);
  expect(snapshot.turnUsage["turn-discounted"]?.totalEstimatedCostUsd).toBeCloseTo(firstCost + secondCost, 12);
});

test("thread context window override survives late usage from another model", () => {
  const store = new TopicUsageStore();
  const usageA = {
    ...usage,
    modelContextWindow: 257_000,
    contextUsage: { ...usage.last, totalTokens: 230_000 }
  };
  const usageB = {
    ...usage,
    modelContextWindow: 1_000_000,
    contextUsage: { ...usage.last, totalTokens: 240_000 }
  };
  store.setContextWindow("thread", 257_000);
  store.update("thread", "turn-a", usageA);
  store.setContextWindow("thread", 1_000_000);
  store.update("thread", "turn-b", usageB);
  store.setContextWindow("thread", 257_000);
  store.update("thread", "turn-a", usageA);
  expect(store.snapshot("thread").threadUsage?.modelContextWindow).toBe(257_000);
});
