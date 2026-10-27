import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { PiSessionStore } from "../../backends/pi/src/runtime/piSessionStore";
import type { RuntimeDatabase } from "../../apps/server/src/runtime/database";

describe("PiSessionStore", () => {
  let db: Database;
  let store: PiSessionStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new PiSessionStore(db as unknown as RuntimeDatabase);
  });

  afterEach(() => {
    db.close();
  });

  test("upsert creates and retrieves a session", () => {
    const record = store.upsert({
      threadId: "t-1",
      ownerId: "user-1",
      sessionId: "s-1",
      model: "pi-relay/default",
      cwd: "/workspace",
    });

    expect(record.threadId).toBe("t-1");
    expect(record.ownerId).toBe("user-1");
    expect(record.sessionId).toBe("s-1");
    expect(record.model).toBe("pi-relay/default");
    expect(record.cwd).toBe("/workspace");

    const retrieved = store.get("user-1", "t-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.sessionId).toBe("s-1");
  });

  test("upsert updates an existing session without overriding with undefined", () => {
    store.upsert({
      threadId: "t-1",
      ownerId: "user-1",
      sessionId: "s-1",
      model: "pi-relay/default",
    });

    const updated = store.upsert({
      threadId: "t-1",
      ownerId: "user-1",
      model: "pi-relay/custom",
    });

    expect(updated.sessionId).toBe("s-1");
    expect(updated.model).toBe("pi-relay/custom");
  });

  test("findByThreadId and findBySessionId work correctly", () => {
    store.upsert({
      threadId: "t-1",
      ownerId: "user-1",
      sessionId: "s-pi-42",
      model: "pi-relay/default",
    });

    const byThread = store.findByThreadId("t-1");
    expect(byThread?.sessionId).toBe("s-pi-42");

    const bySession = store.findBySessionId("s-pi-42");
    expect(bySession?.threadId).toBe("t-1");
  });

  test("listByOwner and delete work correctly", () => {
    store.upsert({ threadId: "t-1", ownerId: "u-1" });
    store.upsert({ threadId: "t-2", ownerId: "u-1" });
    store.upsert({ threadId: "t-3", ownerId: "u-2" });

    expect(store.listByOwner("u-1")).toHaveLength(2);
    expect(store.listByOwner("u-2")).toHaveLength(1);

    store.delete("u-1", "t-1");
    expect(store.listByOwner("u-1")).toHaveLength(1);
    expect(store.get("u-1", "t-1")).toBeNull();
  });
});
