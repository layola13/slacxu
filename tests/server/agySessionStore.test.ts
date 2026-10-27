import { expect, test } from "bun:test";
import { AgySessionStore } from "../../backends/agy/src/runtime/agySessionStore";
import { LocalDatabase } from "../../apps/server/src/localDatabase";

function createStore(): AgySessionStore {
  const db = new LocalDatabase();
  return new AgySessionStore(db.connection);
}

const OWNER_A = "owner-agy-a-" + Date.now();
const OWNER_B = "owner-agy-b-" + Date.now();

test("upsert and get: persists AGY conversation ID and stateJson", () => {
  const store = createStore();
  const record = store.upsert({
    threadId: "agy-t-001",
    ownerId: OWNER_A,
    conversationId: "conv-uuid-1234",
    cliVersion: "1.0.0",
    model: "gemini-2.5-pro",
    cwd: "D:/projects/test",
    permissionMode: "dangerBypass",
    stateJson: JSON.stringify({ preview: "Hello AGY", turns: [] })
  });

  expect(record.threadId).toBe("agy-t-001");
  expect(record.conversationId).toBe("conv-uuid-1234");
  expect(record.model).toBe("gemini-2.5-pro");

  const fetched = store.get(OWNER_A, "agy-t-001");
  expect(fetched).not.toBeNull();
  expect(fetched!.conversationId).toBe("conv-uuid-1234");
  expect(fetched!.stateJson).toContain("Hello AGY");
});

test("upsert: preserves existing fields when not provided", () => {
  const store = createStore();
  store.upsert({
    threadId: "agy-t-002",
    ownerId: OWNER_A,
    conversationId: "conv-init",
    model: "gemini-2.5-pro",
    cwd: "D:/projects/test"
  });

  const updated = store.upsert({
    threadId: "agy-t-002",
    ownerId: OWNER_A,
    conversationId: "conv-updated"
  });

  expect(updated.conversationId).toBe("conv-updated");
  expect(updated.model).toBe("gemini-2.5-pro");
  expect(updated.cwd).toBe("D:/projects/test");
});

test("listByOwner: returns only threads for that owner", () => {
  const store = createStore();
  const owner = "owner-agy-list-" + Date.now();
  store.upsert({ threadId: "t-1", ownerId: owner, conversationId: "c-1" });
  store.upsert({ threadId: "t-2", ownerId: owner, conversationId: "c-2" });
  store.upsert({ threadId: "t-3", ownerId: OWNER_B, conversationId: "c-3" });

  const list = store.listByOwner(owner);
  expect(list.length).toBe(2);
  expect(list.some(r => r.threadId === "t-1")).toBe(true);
  expect(list.some(r => r.threadId === "t-2")).toBe(true);
});

test("delete and deleteByThread", () => {
  const store = createStore();
  const owner = "owner-agy-del-" + Date.now();
  store.upsert({ threadId: "t-del-1", ownerId: owner, conversationId: "c-1" });
  expect(store.delete("t-del-1", owner)).toBe(true);
  expect(store.get(owner, "t-del-1")).toBeNull();

  store.upsert({ threadId: "t-del-2", ownerId: OWNER_A, conversationId: "c-2" });
  store.upsert({ threadId: "t-del-2", ownerId: OWNER_B, conversationId: "c-2" });
  expect(store.deleteByThread("t-del-2")).toBe(2);
  expect(store.get(OWNER_A, "t-del-2")).toBeNull();
  expect(store.get(OWNER_B, "t-del-2")).toBeNull();
});

test("findByConversationId and findByThreadId", () => {
  const store = createStore();
  const threadId = "t-find-c-" + Date.now();
  const convId = "conv-find-" + Date.now();
  store.upsert({ threadId, ownerId: OWNER_A, conversationId: convId });
  const found = store.findByConversationId(convId);
  expect(found).not.toBeNull();
  expect(found!.threadId).toBe(threadId);

  const byThread = store.findByThreadId(threadId);
  expect(byThread).not.toBeNull();
  expect(byThread!.conversationId).toBe(convId);
});
