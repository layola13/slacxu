import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { GatewayRequestStore } from "../../apps/server/src/gatewayRequestStore.ts";

test("gateway requests log begin/finish lifecycle without touching bodies", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  const started = store.begin({
    ownerId: "owner",
    threadId: "thread-1",
    endpoint: "responses",
    providerId: "jiji",
    groupId: "default",
    model: "gpt-5.6-luna",
    stream: true,
  });
  expect(started.id.startsWith("gw-")).toBe(true);
  expect(started.ok).toBeUndefined();
  expect(started.stream).toBe(true);

  store.finish(started.id, { upstreamStatus: 200, ok: true });
  const rows = store.list("owner", {});
  expect(rows).toMatchObject([{
    threadId: "thread-1",
    endpoint: "responses",
    providerId: "jiji",
    groupId: "default",
    model: "gpt-5.6-luna",
    stream: true,
    upstreamStatus: 200,
    ok: true,
  }]);
  expect(rows[0]?.latencyMs).toBeDefined();
  expect(store.list("another-owner", {} as never)).toEqual([]);
  db.close();
});

test("gateway request failures record ok=false with error", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  const started = store.begin({
    ownerId: "owner",
    endpoint: "chat/completions",
    providerId: "deepkey",
    groupId: "codex-team",
  });
  store.finish(started.id, { ok: false, error: "fetch failed" });
  expect(store.list("owner", {})).toMatchObject([{ ok: false, error: "fetch failed" }]);
  db.close();
});

test("gateway daily counts aggregate ok/fail per local date with zero fill", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  const ok = store.begin({ ownerId: "owner", endpoint: "messages", providerId: "p", groupId: "g" });
  store.finish(ok.id, { upstreamStatus: 200, ok: true });
  const fail = store.begin({ ownerId: "owner", endpoint: "messages", providerId: "p", groupId: "g" });
  store.finish(fail.id, { upstreamStatus: 502, ok: false });
  const days = store.dailyCounts("owner", 7);
  expect(days.length).toBe(7);
  const total = days.reduce((s, d) => s + d.count, 0);
  expect(total).toBe(2);
  expect(days[days.length - 1]).toMatchObject({ count: 2, okCount: 1, failCount: 1 });
  expect(store.dailyCounts("nobody", 7).reduce((s, d) => s + d.count, 0)).toBe(0);
  db.close();
});

test("gateway overview counts totals and calendar periods", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  const a = store.begin({ ownerId: "owner", endpoint: "responses", providerId: "p", groupId: "g" });
  store.finish(a.id, { upstreamStatus: 200, ok: true });
  store.begin({ ownerId: "owner", endpoint: "messages", providerId: "p", groupId: "g" });
  expect(store.overview("owner")).toMatchObject({
    total: 2, okCount: 1, failCount: 0, pendingCount: 1, today: 2, thisWeek: 2, thisMonth: 2,
  });
  expect(store.overview("nobody")).toMatchObject({ total: 0, today: 0 });
  expect(store.overview(null)).toMatchObject({ total: 2 });
  db.close();
});

test("gateway byDimension groups topN with ok/fail split", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  for (let i = 0; i < 3; i += 1) {
    const row = store.begin({ ownerId: "owner", endpoint: "responses", providerId: "p1", groupId: "g1", model: "m-a" });
    store.finish(row.id, { upstreamStatus: 200, ok: true });
  }
  const row = store.begin({ ownerId: "owner", endpoint: "chat/completions", providerId: "p2", groupId: "g2", model: "m-b" });
  store.finish(row.id, { upstreamStatus: 500, ok: false });
  expect(store.byDimension("owner", "model", 7, 10)).toMatchObject([
    { name: "m-a", count: 3, okCount: 3, failCount: 0 },
    { name: "m-b", count: 1, okCount: 0, failCount: 1 },
  ]);
  expect(store.byDimension("owner", "endpoint", 7, 10).map((entry) => entry.name).sort()).toEqual(["chat/completions", "responses"]);
  expect(store.byDimension("owner", "group", 7, 10)).toMatchObject([
    { name: "g1", providerId: "p1", count: 3 },
    { name: "g2", providerId: "p2", count: 1 },
  ]);
  db.close();
});

test("gateway listPage filters and cursor paginates", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  for (let i = 0; i < 5; i += 1) {
    const row = store.begin({
      ownerId: "owner", threadId: i % 2 === 0 ? "t-even" : "t-odd",
      endpoint: "responses", providerId: "p", groupId: "g", model: `m-${i}`,
    });
    store.finish(row.id, { upstreamStatus: i === 4 ? 500 : 200, ok: i !== 4 });
  }
  const first = store.listPage("owner", {}, { limit: 2 });
  expect(first.entries.length).toBe(2);
  expect(first.nextCursor).not.toBeNull();
  const second = store.listPage("owner", {}, { limit: 2, cursor: first.nextCursor! });
  expect(second.entries.length).toBe(2);
  const rest = store.listPage("owner", {}, { limit: 2, cursor: second.nextCursor! });
  expect(rest.entries.length).toBe(1);
  expect(rest.nextCursor).toBeNull();
  expect(store.listPage("owner", { threadId: "t-even" }, { limit: 10 }).entries.length).toBe(3);
  expect(store.listPage("owner", { ok: false }, { limit: 10 }).entries.map((entry) => entry.model)).toEqual(["m-4"]);
  expect(store.listPage("owner", { modelContains: "m-1" }, { limit: 10 }).entries.length).toBe(1);
  db.close();
});

test("direct sidecar counts a turn with no gateway rows and dedups relay turns", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  const windowStart = Date.now() - 1000;
  // Relay turn: begin/finish first, sidecar must stay silent.
  const relay = store.begin({ ownerId: "local", threadId: "t-relay", turnId: "turn-1", endpoint: "chat/completions", providerId: "p", groupId: "g" });
  store.finish(relay.id, { upstreamStatus: 200, ok: true });
  expect(store.countByThreadSince("local", "t-relay", windowStart)).toBe(1);
  // Direct turn: no rows -> recordDirect inserts one completed row (unknown upstream/latency).
  expect(store.countByThreadSince("local", "t-direct", windowStart)).toBe(0);
  expect(store.existsByTurn("local", "t-relay", "turn-1")).toBe(true);
  expect(store.existsByTurn("local", "t-direct", "turn-9")).toBe(false);
  const direct = store.recordDirect({ ownerId: "local", threadId: "t-direct", turnId: "turn-9", model: "opencode/big-pickle", backend: "opencode", status: "completed" });
  expect(direct).toMatchObject({ endpoint: "direct/opencode", ok: true, status: "completed", source: "direct", model: "opencode/big-pickle" });
  expect(direct).not.toHaveProperty("upstreamStatus");
  expect(direct).not.toHaveProperty("latencyMs");
  expect(store.countByThreadSince("local", "t-direct", windowStart)).toBe(1);
  expect(store.overview("local")).toMatchObject({ total: 2, okCount: 2 });
  expect(store.byDimension("local", "endpoint", 7, 10).map((entry) => entry.name).sort()).toEqual(["chat/completions", "direct/opencode"]);
  db.close();
});

test("gateway status five-state lifecycle with source and TTFT", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  const started = store.begin({
    ownerId: "owner", endpoint: "responses", providerId: "p", groupId: "g",
    model: "m", source: "playground",
  });
  expect(started.status).toBe("pending");
  expect(started.source).toBe("playground");
  store.markFirstToken(started.id);
  const processing = store.list("owner", {})[0];
  expect(processing?.status).toBe("processing");
  expect(processing?.ttftMs).toBeDefined();
  const ttft = processing?.ttftMs ?? 0;
  store.finish(started.id, { upstreamStatus: 200, ok: true });
  const done = store.list("owner", {})[0];
  // finish 保留首字 TTFT，不覆盖。
  expect(done).toMatchObject({ status: "completed", ok: true, source: "playground" });
  expect(done?.ttftMs).toBe(ttft);
  expect(done?.latencyMs).toBeDefined();
  db.close();
});

test("gateway cancel marks canceled and ok=false", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  const started = store.begin({ ownerId: "owner", endpoint: "messages", providerId: "p", groupId: "g" });
  store.cancel(started.id, "client closed");
  expect(store.list("owner", {})).toMatchObject([{ status: "canceled", ok: false, error: "client closed" }]);
  db.close();
});

test("gateway listPage status/source filters keep ok compat", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  const a = store.begin({ ownerId: "o", endpoint: "responses", providerId: "p", groupId: "g", source: "api" });
  store.finish(a.id, { upstreamStatus: 200, ok: true });
  const b = store.begin({ ownerId: "o", endpoint: "responses", providerId: "p", groupId: "g", source: "test" });
  store.finish(b.id, { upstreamStatus: 500, ok: false });
  const c = store.begin({ ownerId: "o", endpoint: "responses", providerId: "p", groupId: "g", source: "test" });
  store.cancel(c.id);
  expect(store.listPage("o", { status: "completed" }, { limit: 10 }).entries.length).toBe(1);
  expect(store.listPage("o", { statusIn: ["failed", "canceled"] }, { limit: 10 }).entries.length).toBe(2);
  expect(store.listPage("o", { source: "test" }, { limit: 10 }).entries.length).toBe(2);
  // 旧 ok 布尔仍可用。
  expect(store.listPage("o", { ok: true }, { limit: 10 }).entries.length).toBe(1);
  expect(store.listPage("o", { ok: false }, { limit: 10 }).entries.length).toBe(2);
  db.close();
});

test("gateway performanceByDimension averages latency and TTFT", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  const a = store.begin({ ownerId: "o", endpoint: "responses", providerId: "p", groupId: "g", model: "m-fast" });
  store.markFirstToken(a.id);
  store.finish(a.id, { upstreamStatus: 200, ok: true });
  const b = store.begin({ ownerId: "o", endpoint: "responses", providerId: "p", groupId: "g", model: "m-slow" });
  store.finish(b.id, { upstreamStatus: 200, ok: true });
  const rows = store.performanceByDimension("o", "model", 7, 10);
  expect(rows.length).toBe(2);
  const fast = rows.find((r) => r.name === "m-fast")!;
  expect(fast.requestCount).toBe(1);
  expect(fast.totalLatencyMs).toBeGreaterThanOrEqual(0);
  expect(fast.avgLatencyMs).toBeGreaterThanOrEqual(0);
  expect(fast.avgTtftMs).toBeGreaterThanOrEqual(0);
  db.close();
});

test("gateway performanceByDimension reports bounded p50/p95 percentiles", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  for (let i = 0; i < 5; i += 1) {
    const row = store.begin({ ownerId: "o", endpoint: "responses", providerId: "p", groupId: "g", model: "m-p" });
    store.finish(row.id, { upstreamStatus: 200, ok: true });
  }
  const rows = store.performanceByDimension("o", "model", 7, 10);
  expect(rows.length).toBe(1);
  const only = rows[0]!;
  expect(only.p50LatencyMs).toBeGreaterThanOrEqual(0);
  expect(only.p95LatencyMs).toBeGreaterThanOrEqual(only.p50LatencyMs);
  db.close();
});

test("gateway byStatus groups upstream codes with null pending bucket", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  const ok = store.begin({ ownerId: "o", endpoint: "responses", providerId: "p", groupId: "g" });
  store.finish(ok.id, { upstreamStatus: 200, ok: true });
  const fail = store.begin({ ownerId: "o", endpoint: "responses", providerId: "p", groupId: "g" });
  store.finish(fail.id, { upstreamStatus: 500, ok: false });
  // pending：begin 后不 finish，upstream_status 为 null。
  store.begin({ ownerId: "o", endpoint: "responses", providerId: "p", groupId: "g" });
  const rows = store.byStatus("o", 7, 20);
  expect(rows).toContainEqual({ statusCode: 200, count: 1, okCount: 1, failCount: 0 });
  expect(rows).toContainEqual({ statusCode: 500, count: 1, okCount: 0, failCount: 1 });
  expect(rows).toContainEqual({ statusCode: null, count: 1, okCount: 0, failCount: 0 });
  expect(store.byStatus("nobody", 7, 20)).toEqual([]);
  db.close();
});

test("gateway healthByProvider flags degraded and down providers read-only", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  for (let i = 0; i < 10; i += 1) {
    const row = store.begin({ ownerId: "o", endpoint: "responses", providerId: "good", groupId: "g" });
    store.finish(row.id, { upstreamStatus: 200, ok: true });
  }
  for (let i = 0; i < 4; i += 1) {
    const row = store.begin({ ownerId: "o", endpoint: "responses", providerId: "flaky", groupId: "g" });
    store.finish(row.id, { upstreamStatus: i < 2 ? 200 : 500, ok: i < 2 });
  }
  const bad = store.begin({ ownerId: "o", endpoint: "responses", providerId: "bad", groupId: "g" });
  store.finish(bad.id, { upstreamStatus: 500, ok: false });
  const rows = store.healthByProvider("o", 7, 50);
  expect(rows.find((r) => r.name === "good")).toMatchObject({ status: "healthy", successRate: 100 });
  expect(rows.find((r) => r.name === "flaky")).toMatchObject({ status: "degraded", successRate: 50 });
  expect(rows.find((r) => r.name === "bad")).toMatchObject({ status: "down", successRate: 0 });
  // 只读：健康摘要不改变任何请求行。
  expect(store.overview("o")).toMatchObject({ total: 15 });
  db.close();
});

test("gateway direct sidecar replay is a no-op via time-window dedup", () => {
  const db = new Database(":memory:");
  const store = new GatewayRequestStore(db as never);
  const turnStart = Date.now();
  const first = store.recordDirect({
    ownerId: "o", threadId: "t", turnId: "turn-1", backend: "opencode", ok: true,
  });
  expect(first?.endpoint).toBe("direct/opencode");
  // 模拟 UI-deferral 重放：同一 turn 窗口内已有行，第二次必须跳过。
  expect(store.countByThreadSince("o", "t", turnStart - 1000)).toBe(1);
  expect(store.overview("o")).toMatchObject({ total: 1 });
  db.close();
});
