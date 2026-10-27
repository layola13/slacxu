import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStore } from "../../apps/server/src/authStore";
import { RequestUsageStore } from "../../apps/server/src/requestUsageStore";

function usage() {
  return {
    source: "openai" as const,
    totalTokens: 120,
    inputTokens: 100,
    cachedInputTokens: 20,
    cacheWriteInputTokens: 0,
    outputTokens: 20,
    reasoningOutputTokens: 4,
    estimatedCostUsd: 0.0123,
    billingSnapshot: {
      inputUsdPerMillion: 1,
      cachedInputUsdPerMillion: 0.1,
      cacheWriteUsdPerMillion: 1,
      outputUsdPerMillion: 2,
      modelMultiplier: 1,
      inputMultiplier: 1,
      cacheReadMultiplier: 1,
      cacheWriteMultiplier: 1,
      outputMultiplier: 1,
      groupRatio: 1
    }
  };
}

test("request usage ledger survives a store restart and remains idempotent", () => {
  const database = new Database(":memory:");
  const first = new RequestUsageStore({ exec: (sql) => database.exec(sql), prepare: (sql) => database.prepare(sql), close: () => database.close() });
  first.record({ ownerId: "user-1", threadId: "thread-1", turnId: "turn-1", requestId: "request-1", source: "openai", providerId: "relay", groupId: "default", model: "gpt-5.5", usage: usage(), costUsd: 0.0123, billingSnapshot: usage().billingSnapshot });
  first.record({ ownerId: "user-1", threadId: "thread-1", turnId: "turn-1", requestId: "request-1", source: "openai", providerId: "relay", groupId: "default", model: "gpt-5.5", usage: usage(), costUsd: 0.0123, billingSnapshot: usage().billingSnapshot });
  const restarted = new RequestUsageStore({ exec: (sql) => database.exec(sql), prepare: (sql) => database.prepare(sql), close: () => database.close() });
  const records = restarted.list("user-1", "thread-1");
  expect(records).toHaveLength(1);
  expect(records[0]?.requestId).toBe("request-1");
  expect(records[0]?.usage).toMatchObject({ totalTokens: 120, estimatedCostUsd: 0.0123 });
  database.close();
});

test("balance debit is idempotent for a persisted request reference", async () => {
  const database = new Database(":memory:");
  const store = new AuthStore({ connection: database } as never, {
    jwtSecret: "ledger-test-secret",
    adminEmail: "admin@example.com",
    adminPassword: "ChangeMe123!",
    tokenExpireHours: 24,
    membersRoot: mkdtempSync(join(tmpdir(), "codex-ledger-members-"))
  });
  await store.initialize();
  const member = await store.createUser({ email: "ledger@example.com", password: "MemberPass123!", balance: 1 });
  const first = store.debitBalance(member.id, 0.25, { threadId: "thread-1", method: "rawResponse/completed", referenceId: "codex-response-1" });
  const second = store.debitBalance(member.id, 0.25, { threadId: "thread-1", method: "rawResponse/completed", referenceId: "codex-response-1" });
  expect(first.balance).toBeCloseTo(0.75, 12);
  expect(second.balance).toBeCloseTo(0.75, 12);
  expect(store.listBalanceLedger(member.id, 20).filter((entry) => entry.reference_id === "codex-response-1")).toHaveLength(1);
  database.close();
});
