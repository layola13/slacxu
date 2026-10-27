import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ProviderStore } from "../../apps/server/src/providerStore.ts";

async function seedStore() {
  const db = new Database(":memory:");
  const store = new ProviderStore({ connection: db });
  await store.save({
    id: "quota-relay",
    kind: "responsesRelay",
    name: "Quota Relay",
    baseUrl: "https://relay.example/v1",
    nativeModels: ["m1"],
    modelAliases: [],
    groups: [{
      id: "default",
      name: "default",
      groupRatio: 1,
      quotaUsd: 1,
      usedQuotaUsd: 0,
      keys: ["sk-quota"],
      models: ["m1"],
    }]
  });
  return { db, store };
}

test("addUsedQuota accumulates atomically and is visible to get()", async () => {
  const { db, store } = await seedStore();
  store.addUsedQuota("quota-relay", "default", 0.3);
  store.addUsedQuota("quota-relay", "default", 0.2);
  const provider = await store.get("quota-relay");
  expect(provider?.groups?.[0]?.usedQuotaUsd).toBeCloseTo(0.5, 9);
  db.close();
});

test("addUsedQuota ignores non-positive amounts and missing rows", async () => {
  const { db, store } = await seedStore();
  store.addUsedQuota("quota-relay", "default", 0);
  store.addUsedQuota("quota-relay", "default", -1);
  store.addUsedQuota("quota-relay", "default", Number.NaN);
  store.addUsedQuota("nope", "default", 5);
  store.addUsedQuota("quota-relay", "nope", 5);
  const provider = await store.get("quota-relay");
  // COALESCE(NULL→0)+0 保持 0：守卫生效且缺失行不抛错。
  expect(provider?.groups?.[0]?.usedQuotaUsd ?? 0).toBe(0);
  db.close();
});

test("accumulated usage trips the quota gate condition", async () => {
  const { db, store } = await seedStore();
  store.addUsedQuota("quota-relay", "default", 1.5);
  const group = (await store.get("quota-relay"))?.groups?.[0];
  // 与 index.ts quotaExceeded 同口径：quota>=0 且 used>=quota 即超额。
  const exceeded = typeof group?.quotaUsd === "number" && group.quotaUsd >= 0
    && typeof group?.usedQuotaUsd === "number" && group.usedQuotaUsd >= group.quotaUsd;
  expect(exceeded).toBe(true);
  db.close();
});
