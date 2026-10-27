import { expect, test } from "bun:test";
import { ClaudePermissionRegistry } from "../../backends/claude/src/runtime/claudePermissionRegistry";

function createRegistry(): ClaudePermissionRegistry {
  return new ClaudePermissionRegistry();
}

test("register: creates entry with server-facing request ID", () => {
  const reg = createRegistry();
  const id = reg.register({
    claudeRequestId: "req-001",
    threadId: "thread-001",
    ownerId: "owner-001",
    turnId: "turn-001",
    runtimeId: "rt-001"
  });
  expect(id).toBe("claude-perm-req-001");
  expect(reg.size).toBe(1);
});

test("get: retrieves entry by server request ID", () => {
  const reg = createRegistry();
  reg.register({
    claudeRequestId: "req-002",
    threadId: "thread-002",
    ownerId: "owner-002",
    turnId: "turn-002",
    runtimeId: "rt-002"
  });
  const entry = reg.get("claude-perm-req-002");
  expect(entry).toBeDefined();
  expect(entry!.claudeRequestId).toBe("req-002");
  expect(entry!.threadId).toBe("thread-002");
  expect(entry!.turnId).toBe("turn-002");
});

test("getByClaudeRequestId: retrieves entry by Claude's request_id", () => {
  const reg = createRegistry();
  reg.register({
    claudeRequestId: "req-003",
    threadId: "thread-003",
    ownerId: "owner-003",
    turnId: "turn-003",
    runtimeId: "rt-003"
  });
  const entry = reg.getByClaudeRequestId("req-003");
  expect(entry).toBeDefined();
  expect(entry!.serverRequestId).toBe("claude-perm-req-003");
});

test("consume: removes and returns the entry", () => {
  const reg = createRegistry();
  reg.register({
    claudeRequestId: "req-004",
    threadId: "thread-004",
    ownerId: "owner-004",
    turnId: "turn-004",
    runtimeId: "rt-004"
  });
  const entry = reg.consume("claude-perm-req-004");
  expect(entry).toBeDefined();
  expect(reg.size).toBe(0);
  expect(reg.get("claude-perm-req-004")).toBeUndefined();
});

test("consume: returns undefined for non-existent request", () => {
  const reg = createRegistry();
  expect(reg.consume("nonexistent")).toBeUndefined();
});

test("cancel: removes entry without triggering timeout", () => {
  const reg = createRegistry();
  reg.register({
    claudeRequestId: "req-005",
    threadId: "thread-005",
    ownerId: "owner-005",
    turnId: "turn-005",
    runtimeId: "rt-005"
  });
  reg.cancel("claude-perm-req-005");
  expect(reg.size).toBe(0);
});

test("cancelAllForRuntime: removes all permissions for a runtime", () => {
  const reg = createRegistry();
  reg.register({ claudeRequestId: "r1", threadId: "t1", ownerId: "o1", turnId: "tu1", runtimeId: "rt-A" });
  reg.register({ claudeRequestId: "r2", threadId: "t2", ownerId: "o2", turnId: "tu2", runtimeId: "rt-A" });
  reg.register({ claudeRequestId: "r3", threadId: "t3", ownerId: "o3", turnId: "tu3", runtimeId: "rt-B" });

  const cancelled = reg.cancelAllForRuntime("rt-A");
  expect(cancelled.length).toBe(2);
  expect(reg.size).toBe(1);
});

test("cancelAllForThread: removes all permissions for a thread", () => {
  const reg = createRegistry();
  reg.register({ claudeRequestId: "r1", threadId: "t-shared", ownerId: "o1", turnId: "tu1", runtimeId: "rt-A" });
  reg.register({ claudeRequestId: "r2", threadId: "t-shared", ownerId: "o1", turnId: "tu2", runtimeId: "rt-A" });
  reg.register({ claudeRequestId: "r3", threadId: "t-other", ownerId: "o2", turnId: "tu3", runtimeId: "rt-B" });

  const cancelled = reg.cancelAllForThread("t-shared");
  expect(cancelled.length).toBe(2);
  expect(reg.size).toBe(1);
});

test("hasPendingForThread: returns true when permissions are pending", () => {
  const reg = createRegistry();
  expect(reg.hasPendingForThread("t-pending")).toBe(false);
  reg.register({ claudeRequestId: "r1", threadId: "t-pending", ownerId: "o1", turnId: "tu1", runtimeId: "rt-A" });
  expect(reg.hasPendingForThread("t-pending")).toBe(true);
});

test("hasPendingForThread: returns false after consume", () => {
  const reg = createRegistry();
  reg.register({ claudeRequestId: "r1", threadId: "t-pending2", ownerId: "o1", turnId: "tu1", runtimeId: "rt-A" });
  reg.consume("claude-perm-r1");
  expect(reg.hasPendingForThread("t-pending2")).toBe(false);
});

test("timeout: triggers onTimeout callback", async () => {
  const reg = createRegistry();
  let timedOut = false;
  reg.onTimeout = () => { timedOut = true; };

  reg.register({
    claudeRequestId: "req-timeout",
    threadId: "thread-timeout",
    ownerId: "owner-timeout",
    turnId: "turn-timeout",
    runtimeId: "rt-timeout",
    timeoutMs: 50
  });

  await new Promise(resolve => setTimeout(resolve, 100));
  expect(timedOut).toBe(true);
  expect(reg.size).toBe(0);
});

test("register: replaces existing entry with same serverRequestId", () => {
  const reg = createRegistry();
  reg.register({ claudeRequestId: "req-dup", threadId: "t1", ownerId: "o1", turnId: "tu1", runtimeId: "rt-A" });
  expect(reg.size).toBe(1);
  // Re-register with same claudeRequestId
  reg.register({ claudeRequestId: "req-dup", threadId: "t1", ownerId: "o1", turnId: "tu2", runtimeId: "rt-A" });
  expect(reg.size).toBe(1);
  const entry = reg.get("claude-perm-req-dup");
  expect(entry!.turnId).toBe("tu2");
});

test("list: returns all pending permissions", () => {
  const reg = createRegistry();
  reg.register({ claudeRequestId: "r1", threadId: "t1", ownerId: "o1", turnId: "tu1", runtimeId: "rt-A" });
  reg.register({ claudeRequestId: "r2", threadId: "t2", ownerId: "o2", turnId: "tu2", runtimeId: "rt-B" });
  const list = reg.list();
  expect(list.length).toBe(2);
});
