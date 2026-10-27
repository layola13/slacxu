import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { normalizeTokenUsage } from "../../packages/shared/src/tokenUsage.ts";
import { extractRingTokenUsage, nextDirectUsageRequestId, RequestUsageStore } from "../../apps/server/src/requestUsageStore.ts";

function seed() {
  const db = new Database(":memory:");
  const store = new RequestUsageStore(db as never);
  const usage = (input: number, output: number, cached = 0) => ({
    totalTokens: input + cached + output,
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteInputTokens: 0,
    outputTokens: output,
    reasoningOutputTokens: 0,
    source: "openai" as const,
  });
  store.record({ ownerId: "u1", threadId: "t1", turnId: "turn1", requestId: "r1", source: "openai", providerId: "p1", groupId: "g1", model: "m-a", usage: usage(100, 50, 10), costUsd: 0.01 });
  store.record({ ownerId: "u1", threadId: "t1", turnId: "turn2", requestId: "r2", source: "openai", providerId: "p1", groupId: "g1", model: "m-b", usage: usage(200, 100), costUsd: 0.03 });
  store.record({ ownerId: "u2", threadId: "t2", turnId: "turn1", requestId: "r3", source: "openai", providerId: "p2", groupId: "g2", model: "m-a", usage: usage(1000, 500, 100), costUsd: 0.1 });
  return { db, store };
}

test("tokenSummary buckets all/month/week/day", () => {
  const { db, store } = seed();
  const summary = store.tokenSummary(null);
  expect(summary.all).toMatchObject({ input: 1300, output: 650, cached: 110, total: 2060, count: 3 });
  expect(summary.all.cost).toBeCloseTo(0.14, 9);
  // 全部是当月/当周/当日写入，月/周/日与 all 一致。
  expect(summary.month).toMatchObject({ input: 1300, count: 3 });
  expect(summary.week).toMatchObject({ input: 1300, count: 3 });
  expect(summary.day).toMatchObject({ input: 1300, count: 3 });
  const scoped = store.tokenSummary("u2");
  expect(scoped.all).toMatchObject({ input: 1000, output: 500, cached: 100, total: 1600, count: 1 });
  expect(store.tokenSummary("nobody").all).toMatchObject({ input: 0, count: 0 });
  db.close();
});

test("tokenDaily aggregates per UTC date with cost", () => {
  const { db, store } = seed();
  const days = store.tokenDaily(null, 7);
  expect(days.length).toBe(1);
  expect(days[0]).toMatchObject({ input: 1300, output: 650, cached: 110, total: 2060, count: 3 });
  expect(days[0]?.cost).toBeCloseTo(0.14, 9);
  expect(store.tokenDaily("u1", 7)[0]).toMatchObject({ input: 300, count: 2 });
  db.close();
});

test("tokenByDimension groups by model/provider/owner ordered by total", () => {
  const { db, store } = seed();
  const byModel = store.tokenByDimension(null, "model", 30, 10);
  expect(byModel.map((r) => r.name)).toEqual(["m-a", "m-b"]);
  expect(byModel[0]).toMatchObject({ total: 1760, count: 2 });
  expect(byModel[0]?.cost).toBeCloseTo(0.11, 9);
  const byProvider = store.tokenByDimension(null, "provider", 30, 10);
  expect(byProvider.map((r) => r.name)).toEqual(["p2", "p1"]);
  const byOwner = store.tokenByDimension(null, "owner", 30, 10);
  expect(byOwner.map((r) => r.name)).toEqual(["u2", "u1"]);
  const byGroup = store.tokenByDimension(null, "group", 30, 10);
  expect(byGroup[0]).toMatchObject({ name: "g2", providerId: "p2" });
  db.close();
});

test("ring updated envelope unpacks to the round delta with collision-free direct ids", () => {
  // Mini/Opencode/Agy 环信封：{total,last,contextUsage,modelContextWindow}。
  const last = { totalTokens: 60, inputTokens: 40, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0 };
  const params = { threadId: "t", turnId: "turn-1", tokenUsage: { total: last, last, contextUsage: last, modelContextWindow: 272000 } };
  expect(extractRingTokenUsage(params)).toMatchObject({ inputTokens: 40, outputTokens: 20 });
  expect(normalizeTokenUsage(extractRingTokenUsage(params))).toMatchObject({ inputTokens: 40, outputTokens: 20, totalTokens: 60 });
  // 旧 requestUpdated 形状保持直通。
  expect(extractRingTokenUsage({ usage: { input_tokens: 5, output_tokens: 6 } })).toMatchObject({ input_tokens: 5 });
  expect(extractRingTokenUsage({})).toBeNull();
  expect(nextDirectUsageRequestId("turn-1", 0)).toBe("direct-turn-1-0");
  expect(nextDirectUsageRequestId("turn-1", 2)).toBe("direct-turn-1-2");
  expect(nextDirectUsageRequestId("turn-1", 0)).not.toBe("codex-turn-1-0");
});
