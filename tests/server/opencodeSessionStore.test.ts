import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { OpencodeSessionStore } from "../../backends/opencode/src/runtime/opencodeSessionStore";
import type { RuntimeDatabase } from "../../apps/server/src/runtime/database";

describe("OpencodeSessionStore", () => {
  let db: Database;
  let store: OpencodeSessionStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new OpencodeSessionStore(db as unknown as RuntimeDatabase);
  });

  afterEach(() => {
    db.close();
  });

  test("upsert creates and retrieves a session", () => {
    const record = store.upsert({
      threadId: "t-1",
      ownerId: "user-1",
      sessionId: "s-1",
      model: "default",
      cwd: "/workspace",
    });

    expect(record.threadId).toBe("t-1");
    expect(record.ownerId).toBe("user-1");
    expect(record.sessionId).toBe("s-1");
    expect(record.model).toBe("default");
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
      model: "default",
    });

    const updated = store.upsert({
      threadId: "t-1",
      ownerId: "user-1",
      model: "claude-3-5-sonnet",
    });

    expect(updated.sessionId).toBe("s-1");
    expect(updated.model).toBe("claude-3-5-sonnet");
  });

  test("findByThreadId and findBySessionId work correctly", () => {
    store.upsert({
      threadId: "t-1",
      ownerId: "user-1",
      sessionId: "ses_opencode_99",
      model: "default",
    });

    const byThread = store.findByThreadId("t-1");
    expect(byThread?.sessionId).toBe("ses_opencode_99");

    const bySession = store.findBySessionId("ses_opencode_99");
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

    store.deleteByThreadId("t-2");
    expect(store.listByOwner("u-1")).toHaveLength(0);
  });

  test("listForOwner keeps legacy local sessions visible after login", () => {
    store.upsert({ threadId: "legacy", ownerId: "local" });
    store.upsert({ threadId: "owned", ownerId: "u-1" });
    store.upsert({ threadId: "same", ownerId: "local" });
    store.upsert({ threadId: "same", ownerId: "u-1" });

    const visible = store.listForOwner("u-1");
    expect(visible).toHaveLength(3);
    expect(visible.map((entry) => entry.threadId)).toEqual(expect.arrayContaining(["legacy", "owned", "same"]));
    expect(visible.find((entry) => entry.threadId === "same")?.ownerId).toBe("u-1");
  });

  test("getMetadata reads light columns without state_json", async () => {
    // Same checked-in replica as the bridge giant-history test: proves the
    // light-column read works against a real-scale ~1.1MB state_json blob.
    const giantSnapshot = (await import("./fixtures/opencode-giant-snapshot.json")).default as any;
    const giantState = JSON.stringify(giantSnapshot);
    expect(giantState.length).toBeGreaterThan(1_000_000);
    store.upsert({
      threadId: "t-1",
      ownerId: "user-1",
      sessionId: "ses_opencode_99",
      model: "default",
      cwd: "/workspace",
      stateJson: giantState,
    });

    const meta = store.getMetadata("user-1", "t-1");
    expect(meta).not.toBeNull();
    expect(meta?.threadId).toBe("t-1");
    expect(meta?.sessionId).toBe("ses_opencode_99");
    expect(meta?.model).toBe("default");
    expect(meta?.cwd).toBe("/workspace");
    expect(meta).not.toHaveProperty("stateJson");

    expect(store.getMetadata("user-1", "missing")).toBeNull();
  });

  test("findMetadataBySessionId covers native ses_* ids materialized under UUID threads", () => {
    store.upsert({
      threadId: "uuid-1",
      ownerId: "local",
      sessionId: "ses_opencode_99",
      model: "default",
      cwd: "/workspace",
      stateJson: JSON.stringify({ threadId: "uuid-1", turns: [], messages: [] }),
    });

    const meta = store.findMetadataBySessionId("ses_opencode_99");
    expect(meta?.threadId).toBe("uuid-1");
    expect(meta?.sessionId).toBe("ses_opencode_99");
    expect(meta).not.toHaveProperty("stateJson");
    expect(store.findMetadataBySessionId("ses_missing")).toBeNull();
  });

  test("findMetadataByThreadId finds metadata across owners without state_json", () => {
    store.upsert({
      threadId: "uuid-cross-owner",
      ownerId: "other-user",
      sessionId: "ses_other_1",
      model: "gpt-4o",
      cwd: "/repo",
      stateJson: JSON.stringify({ threadId: "uuid-cross-owner", turns: [], messages: [] }),
    });

    const meta = store.findMetadataByThreadId("uuid-cross-owner");
    expect(meta?.threadId).toBe("uuid-cross-owner");
    expect(meta?.ownerId).toBe("other-user");
    expect(meta?.sessionId).toBe("ses_other_1");
    expect(meta?.model).toBe("gpt-4o");
    expect(meta?.cwd).toBe("/repo");
    expect(meta).not.toHaveProperty("stateJson");
    expect(store.findMetadataByThreadId("uuid-nonexistent")).toBeNull();
  });
});
