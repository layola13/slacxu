import { expect, test } from "bun:test";
import { GrokSessionStore } from "../../backends/grok/src/runtime/grokSessionStore";
import { LocalDatabase } from "../../apps/server/src/localDatabase";

function createStore(): GrokSessionStore {
  const db = new LocalDatabase();
  return new GrokSessionStore(db.connection);
}

const OWNER_A = "owner-grok-a-" + Date.now();
const OWNER_B = "owner-grok-b-" + Date.now();

test("upsert and get: persists Grok session ID and stateJson", () => {
  const store = createStore();
  const record = store.upsert({
    threadId: "grok-t-001",
    ownerId: OWNER_A,
    sessionId: "01a075cf-1234-5678",
    cliVersion: "1.0.13",
    model: "grok-4.6",
    cwd: "D:/projects/test",
    permissionMode: "bypassPermissions",
    stateJson: JSON.stringify({ preview: "Hello Grok", turns: [] })
  });

  expect(record.threadId).toBe("grok-t-001");
  expect(record.sessionId).toBe("01a075cf-1234-5678");
  expect(record.model).toBe("grok-4.6");

  const fetched = store.get(OWNER_A, "grok-t-001");
  expect(fetched).not.toBeNull();
  expect(fetched!.sessionId).toBe("01a075cf-1234-5678");
  expect(fetched!.stateJson).toContain("Hello Grok");

  const byThreadId = store.findByThreadId("grok-t-001");
  expect(byThreadId).not.toBeNull();
  expect(byThreadId!.sessionId).toBe("01a075cf-1234-5678");

  const bySessionId = store.findBySessionId("01a075cf-1234-5678");
  expect(bySessionId).not.toBeNull();
  expect(bySessionId!.threadId).toBe("grok-t-001");
});

test("upsert: preserves existing fields when not provided", () => {
  const store = createStore();
  store.upsert({
    threadId: "grok-t-002",
    ownerId: OWNER_A,
    sessionId: "session-init",
    model: "grok-4.6",
    cwd: "D:/projects/test"
  });

  const updated = store.upsert({
    threadId: "grok-t-002",
    ownerId: OWNER_A,
    sessionId: "session-updated"
  });

  expect(updated.sessionId).toBe("session-updated");
  expect(updated.model).toBe("grok-4.6");
  expect(updated.cwd).toBe("D:/projects/test");
});

test("listByOwner: returns only threads for that owner", () => {
  const store = createStore();
  const owner = "owner-grok-list-" + Date.now();
  store.upsert({ threadId: "t-1", ownerId: owner, sessionId: "s-1" });
  store.upsert({ threadId: "t-2", ownerId: owner, sessionId: "s-2" });
  store.upsert({ threadId: "t-3", ownerId: "other-owner", sessionId: "s-3" });

  const list = store.listByOwner(owner);
  expect(list.length).toBe(2);
  expect(list.map((r) => r.threadId)).toContain("t-1");
  expect(list.map((r) => r.threadId)).toContain("t-2");
  expect(list.map((r) => r.threadId)).not.toContain("t-3");
});
