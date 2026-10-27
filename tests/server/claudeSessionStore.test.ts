import { expect, test } from "bun:test";
import { ClaudeSessionStore } from "../../backends/claude/src/runtime/claudeSessionStore";
import { LocalDatabase } from "../../apps/server/src/localDatabase";

function createStore(): ClaudeSessionStore {
  const db = new LocalDatabase();
  return new ClaudeSessionStore(db.connection);
}

const OWNER_A = "owner-session-a-" + Date.now();
const OWNER_B = "owner-session-b-" + Date.now();

test("upsert and get: persists external session ID", () => {
  const store = createStore();
  const record = store.upsert({
    threadId: "thread-001",
    ownerId: OWNER_A,
    externalSessionId: "sess-abc-123",
    cliVersion: "2.1.222",
    model: "claude-sonnet-4",
    cwd: "/home/user/project",
    permissionMode: "default"
  });
  expect(record.threadId).toBe("thread-001");
  expect(record.externalSessionId).toBe("sess-abc-123");
  expect(record.cliVersion).toBe("2.1.222");

  const fetched = store.get(OWNER_A, "thread-001");
  expect(fetched).not.toBeNull();
  expect(fetched!.externalSessionId).toBe("sess-abc-123");
});

test("upsert: preserves existing fields when not provided", () => {
  const store = createStore();
  store.upsert({
    threadId: "thread-002",
    ownerId: OWNER_A,
    externalSessionId: "sess-001",
    cliVersion: "2.1.222",
    model: "claude-sonnet-4",
    cwd: "/home/user",
    permissionMode: "default"
  });

  const updated = store.upsert({
    threadId: "thread-002",
    ownerId: OWNER_A,
    externalSessionId: "sess-002"
  });

  expect(updated.externalSessionId).toBe("sess-002");
  expect(updated.cliVersion).toBe("2.1.222");
  expect(updated.model).toBe("claude-sonnet-4");
  expect(updated.cwd).toBe("/home/user");
});

test("get: returns null for non-existent thread", () => {
  const store = createStore();
  expect(store.get(OWNER_A, "nonexistent")).toBeNull();
});

test("listByOwner: returns all threads for an owner", () => {
  const store = createStore();
  const oid = "owner-list-" + Date.now() + "-" + Math.random();
  store.upsert({ threadId: "t-l1", ownerId: oid, externalSessionId: "s-l1" });
  store.upsert({ threadId: "t-l2", ownerId: oid, externalSessionId: "s-l2" });
  store.upsert({ threadId: "t-l3", ownerId: OWNER_B, externalSessionId: "s-l3" });

  const results = store.listByOwner(oid);
  expect(results.length).toBe(2);
  expect(results.some(r => r.threadId === "t-l1")).toBe(true);
  expect(results.some(r => r.threadId === "t-l2")).toBe(true);
});

test("delete: removes a session record", () => {
  const store = createStore();
  const oid = "owner-del-" + Date.now();
  store.upsert({ threadId: "t-del", ownerId: oid, externalSessionId: "s-del" });
  expect(store.delete("t-del", oid)).toBe(true);
  expect(store.get(oid, "t-del")).toBeNull();
});

test("deleteByThread: removes every owner record for an authoritative thread deletion", () => {
  const store = createStore();
  const threadId = "shared-delete-" + Date.now();
  store.upsert({ threadId, ownerId: OWNER_A, externalSessionId: "owner-a-session" });
  store.upsert({ threadId, ownerId: OWNER_B, externalSessionId: "owner-b-session" });

  expect(store.deleteByThread(threadId)).toBe(2);
  expect(store.get(OWNER_A, threadId)).toBeNull();
  expect(store.get(OWNER_B, threadId)).toBeNull();
});

test("findByExternalSession: finds thread by Claude session ID", () => {
  const store = createStore();
  const sessId = "unique-sess-" + Date.now() + "-" + Math.random();
  store.upsert({ threadId: "t-find", ownerId: OWNER_A, externalSessionId: sessId });
  const found = store.findByExternalSession(sessId);
  expect(found).not.toBeNull();
  expect(found!.threadId).toBe("t-find");
});

test("findByExternalSession: returns null for unknown session", () => {
  const store = createStore();
  expect(store.findByExternalSession("nonexistent")).toBeNull();
});

test("upsert: COALESCE preserves external session when not provided", () => {
  const store = createStore();
  const oid = "owner-coal-" + Date.now();
  store.upsert({ threadId: "t-coal", ownerId: oid, externalSessionId: "sess-keep" });
  const updated = store.upsert({ threadId: "t-coal", ownerId: oid, model: "new-model" });
  expect(updated.externalSessionId).toBe("sess-keep");
  expect(updated.model).toBe("new-model");
});


test("upsert: persists serialized session state", () => {
  const store = createStore();
  const ownerId = "owner-state-" + Date.now();
  const stateJson = JSON.stringify({ threadId: "t-state", turns: [{ id: "turn-1", status: "completed" }] });
  const saved = store.upsert({ threadId: "t-state", ownerId, stateJson });
  expect(saved.stateJson).toBe(stateJson);
  expect(JSON.parse(store.get(ownerId, "t-state")!.stateJson!)).toEqual({ threadId: "t-state", turns: [{ id: "turn-1", status: "completed" }] });
});


test("upsert: tracks the config dir a thread resumes through", () => {
  const store = createStore();
  const ownerId = "owner-configdir-" + Date.now();
  const configDir = "/data/virtual-claude/" + ownerId;
  store.upsert({ threadId: "t-config-a", ownerId, configDir });
  store.upsert({ threadId: "t-config-b", ownerId, configDir });
  expect(store.get(ownerId, "t-config-a")!.configDir).toBe(configDir);
  expect(store.countByConfigDir(configDir)).toBe(2);
  expect(store.listConfigDirs()).toContain(configDir);

  // A later write that omits the directory must not orphan the transcript.
  store.upsert({ threadId: "t-config-a", ownerId, model: "claude-opus-5" });
  expect(store.get(ownerId, "t-config-a")!.configDir).toBe(configDir);

  store.deleteByThread("t-config-a");
  expect(store.countByConfigDir(configDir)).toBe(1);
  store.deleteByThread("t-config-b");
  expect(store.countByConfigDir(configDir)).toBe(0);
});
