import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  parseAnalyticsRange,
  RequestUsageStore,
} from "../../apps/server/src/requestUsageStore.ts";

function pricedUsage(input: number, output: number, cached = 0, write = 0, reasoning = 0, cost = 0.001) {
  return {
    totalTokens: input + cached + write + output,
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteInputTokens: write,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
    source: "normalized" as const,
    costBreakdownUsd: { input: cost / 2, cachedInput: cost / 8, cacheWrite: cost / 8, output: cost / 4 },
  };
}

test("analytics overview counts requests per turn, not per model round", () => {
  const db = new Database(":memory:");
  const store = new RequestUsageStore(db as never);
  // Same turn, three model rounds (three ledger rows) => one request.
  for (let i = 1; i <= 3; i++) {
    store.record({
      ownerId: "u", threadId: "t1", turnId: "turn1", requestId: `direct-turn1-${i}`, source: "normalized",
      providerId: "p1", groupId: "g", model: "m-a",
      usage: pricedUsage(100, 10, 0, 0, 0, 0.001), costUsd: 0.001,
    });
  }
  store.record({
    ownerId: "u", threadId: "t1", turnId: "turn2", requestId: "direct-turn2-1", source: "normalized",
    providerId: "p1", groupId: "g", model: "m-a",
    usage: pricedUsage(100, 10, 0, 0, 0, 0.001), costUsd: 0.001,
  });
  const { startMs, endMs } = parseAnalyticsRange();
  const overview = store.analyticsOverview("u", { startMs, endMs });
  expect(overview.count).toBe(2);
  // Token totals still sum every round.
  expect(overview.input).toBe(400);
});

test("analytics daily and dimension counts are per turn, not per model round", () => {
  const db = new Database(":memory:");
  const store = new RequestUsageStore(db as never);
  for (let i = 1; i <= 3; i++) {
    store.record({
      ownerId: "u", threadId: "t1", turnId: "turn1", requestId: `direct-turn1-${i}`, source: "normalized",
      providerId: "p1", groupId: "g", model: "m-a",
      usage: pricedUsage(100, 10, 0, 0, 0, 0.001), costUsd: 0.001,
    });
  }
  store.record({
    ownerId: "u", threadId: "t2", turnId: "turn3", requestId: "direct-turn3-1", source: "normalized",
    providerId: "p2", groupId: "g", model: "m-b",
    usage: pricedUsage(100, 10, 0, 0, 0, 0.001), costUsd: 0.001,
  });
  const { startMs, endMs } = parseAnalyticsRange();
  const daily = store.analyticsDaily("u", { startMs, endMs });
  expect(daily.reduce((sum, d) => sum + d.count, 0)).toBe(2);
  const byModel = store.analyticsDimension("u", { startMs, endMs }, "model");
  const modelA = byModel.find((r) => r.name === "m-a");
  expect(modelA?.count).toBe(1);
  expect(modelA?.input).toBe(300);
  expect(byModel.find((r) => r.name === "m-b")?.count).toBe(1);
});

test("analytics overview repairs pre-2026-10-04 exclusive rows (input < cached)", () => {
  const db = new Database(":memory:");
  const store = new RequestUsageStore(db as never);
  // 历史坏行：input 仅为未命中部分（绕过 normalize 直接写入，模拟旧版本数据）。
  (db as unknown as { exec: (sql: string) => void }).exec(
    `INSERT INTO request_usage_ledger (owner_id, thread_id, turn_id, request_id, source, provider_id, group_id, model, usage_json, cost_usd, billing_json, created_at, updated_at, debited_at) VALUES ` +
    `('u', 't1', 'turn1', 'legacy-1', 'normalized', 'p1', 'g', 'm-a', '{"totalTokens":56246,"inputTokens":3109,"cachedInputTokens":42218,"cacheWriteInputTokens":10249,"outputTokens":670,"reasoningOutputTokens":0,"source":"normalized"}', 0.01, NULL, 1000, 1000, NULL)`
  );
  const overview = store.analyticsOverview("u", { startMs: 0, endMs: Date.now() + 1000 });
  // 逐行还原包含式输入：max(3109, 42218 + 10249) = 52467。
  expect(overview.input).toBe(52467);
  expect(overview.cachedRead).toBe(42218);
  expect(overview.uncachedInput).toBe(52467 - 42218);
  // 命中率不再被截成 100%。
  expect(overview.cacheHitRate).toBeGreaterThan(0);
  expect(overview.cacheHitRate).toBeLessThan(100);
  expect(overview.cacheHitRate).toBeCloseTo((42218 / 52467) * 100, 0);
});

test("parseAnalyticsRange defaults to 30d and swaps inverted input", () => {
  const { startMs, endMs } = parseAnalyticsRange();
  expect(endMs - startMs).toBeGreaterThan(28 * 24 * 60 * 60 * 1000);
  const swapped = parseAnalyticsRange("2026-09-20", "2026-09-01");
  expect(swapped.startMs).toBeLessThanOrEqual(swapped.endMs);
  const bad = parseAnalyticsRange("not-a-date", "also-bad");
  expect(bad.endMs - bad.startMs).toBeGreaterThan(0);
});

test("analytics overview sums tokens cost and hit rate", () => {
  const db = new Database(":memory:");
  const store = new RequestUsageStore(db as never);
  store.record({
    ownerId: "u", threadId: "t1", turnId: "turn1", requestId: "r1", source: "openai",
    providerId: "p1", groupId: "g", model: "m-a",
    usage: pricedUsage(1000, 500, 200, 100, 50, 0.01), costUsd: 0.01,
  });
  store.record({
    ownerId: "u", threadId: "t1", turnId: "turn2", requestId: "r2", source: "openai",
    providerId: "p2", groupId: "g", model: "m-b",
    usage: pricedUsage(2000, 1000, 0, 0, 0, 0.02), costUsd: 0.02,
  });
  const { startMs, endMs } = parseAnalyticsRange();
  const overview = store.analyticsOverview("u", { startMs, endMs });
  expect(overview.count).toBe(2);
  expect(overview.input).toBe(3000);
  expect(overview.output).toBe(1500);
  expect(overview.cachedRead).toBe(200);
  expect(overview.cacheWrite).toBe(100);
  expect(overview.reasoning).toBe(50);
  expect(overview.uncachedInput).toBe(2800);
  // 200/3000 = 6.7% (rounded to 1 decimal).
  expect(overview.cacheHitRate).toBeCloseTo(6.7, 0);
  expect(overview.cost).toBeCloseTo(0.03, 5);
  // NOTE: bun 1.4.2 的 toMatchObject(expect.any(Number)) 会污染其后数值断言
  //（"must be numbers or bigints" 误报），此处改用 typeof 直断。
  expect(typeof overview.costBreakdown?.input).toBe("number");
  expect(typeof overview.costBreakdown?.output).toBe("number");
  expect((overview.costBreakdown?.input ?? 0) + (overview.costBreakdown?.output ?? 0)).toBeGreaterThan(0);
  // provider 过滤 AND。
  const filtered = store.analyticsOverview("u", { startMs, endMs, providerId: "p1" });
  expect(filtered.count).toBe(1);
  expect(filtered.input).toBe(1000);
  db.close();
});

test("analytics daily backfills missing dates", () => {
  const db = new Database(":memory:");
  const store = new RequestUsageStore(db as never);
  store.record({
    ownerId: "u", threadId: "t", turnId: "turn1", requestId: "r1", source: "openai",
    usage: pricedUsage(100, 50), costUsd: 0.001,
  });
  const fmtDay = (ms: number): string => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // record() 落库 created_at=now，故用“今天±”动态区间，避免固定日期漂移出界。
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const { startMs, endMs } = parseAnalyticsRange(fmtDay(nowMs - 2 * dayMs), fmtDay(nowMs));
  const daily = store.analyticsDaily("u", { startMs, endMs });
  expect(daily.length).toBe(3);
  expect(daily.map((d) => d.date)).toEqual([fmtDay(nowMs - 2 * dayMs), fmtDay(nowMs - dayMs), fmtDay(nowMs)]);
  expect(daily.reduce((s, d) => s + d.count, 0)).toBe(1);
  db.close();
});

test("analytics dimension groups by provider and model", () => {
  const db = new Database(":memory:");
  const store = new RequestUsageStore(db as never);
  store.record({
    ownerId: "u", threadId: "t", turnId: "t1", requestId: "r1", source: "openai",
    providerId: "p1", model: "m-a", usage: pricedUsage(100, 10), costUsd: 0.001,
  });
  store.record({
    ownerId: "u", threadId: "t", turnId: "t2", requestId: "r2", source: "openai",
    providerId: "p1", model: "m-a", usage: pricedUsage(100, 10), costUsd: 0.002,
  });
  void pricedUsage(200, 20);
  const { startMs, endMs } = parseAnalyticsRange();
  const byModel = store.analyticsDimension("u", { startMs, endMs }, "model", 10);
  expect(byModel).toMatchObject([{ name: "m-a", count: 2, input: 200 }]);
  expect(byModel[0]?.uncachedInput).toBe(200);
  const byProvider = store.analyticsDimension("u", { startMs, endMs }, "provider", 10);
  expect(byProvider).toMatchObject([{ name: "p1", count: 2 }]);
  db.close();
});

test("sumForThreadTurns batches turn and thread keys", () => {
  const db = new Database(":memory:");
  const store = new RequestUsageStore(db as never);
  store.record({
    ownerId: "u", threadId: "t1", turnId: "turn1", requestId: "r1", source: "openai",
    usage: pricedUsage(100, 10), costUsd: 0.001,
  });
  const sums = store.sumForThreadTurns("u", [{ threadId: "t1", turnId: "turn1" }, { threadId: "t1" }]);
  const sep = " ";
  expect(sums.get(`t1${sep}turn1`)?.total).toBe(110);
  expect(sums.get(`t1${sep}`)?.total).toBe(110);
  expect(store.sumForThreadTurns("u", []).size).toBe(0);
  db.close();
});
