import { expect, test } from "bun:test";
import { ClaudeCompatibleRuntime } from "../../backends/claude/src/runtime/claudeCompatibleRuntime";
import { ClaudeSessionStore } from "../../backends/claude/src/runtime/claudeSessionStore";
import { ClaudePermissionRegistry } from "../../backends/claude/src/runtime/claudePermissionRegistry";
import { LocalDatabase } from "../../apps/server/src/localDatabase";
import { resolve } from "node:path";
import type { JsonRpcNotification } from "@codex-ui/shared";
import { sandboxToPermissionMode } from "../../apps/server/src/codeCliBridge";

const FAKE_CLI_DIR = resolve(process.cwd(), "tests", "fixtures", "claude-compatible", "fake-cli");
const FAKE_PERM_BIN = process.platform === "win32"
  ? resolve(FAKE_CLI_DIR, "fake-claude-perm.cmd")
  : resolve(FAKE_CLI_DIR, "fake-claude-perm.js");

function waitForNotification(runtime: ClaudeCompatibleRuntime, method: string, timeoutMs = 10_000): Promise<JsonRpcNotification> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for " + method)), timeoutMs);
    const handler = (n: JsonRpcNotification) => {
      if (n.method === method) {
        clearTimeout(timer);
        runtime.off("notification", handler);
        resolve(n);
      }
    };
    runtime.on("notification", handler);
  });
}

test("permission round-trip: runtime registers permission and responds to allow", async () => {
  const db = new LocalDatabase();
  const store = new ClaudeSessionStore(db.connection);
  const permReg = new ClaudePermissionRegistry();

  const runtime = new ClaudeCompatibleRuntime({
    threadId: "thread-perm-001",
    ownerId: "owner-perm-test",
    cwd: process.cwd(),
    model: "claude-sonnet-4",
    env: { ...process.env, CODECLI_BIN: FAKE_PERM_BIN },
  }, store, permReg);

  let permNotification: JsonRpcNotification | null = null;
  runtime.on("notification", (n: JsonRpcNotification) => {
    if (n.method === "item/tool/requestPermission") {
      permNotification = n;
    }
  });

  runtime.startTurn({ prompt: "Run a command" });

  // Wait for the permission request notification
  await waitForNotification(runtime, "item/tool/requestPermission", 10_000);

  expect(permNotification).not.toBeNull();
  expect(permNotification!.params.id).toBeTruthy();
  expect(permReg.size).toBe(1);

  // Respond with allow
  runtime.respondToPermission(permNotification!.params.id as string, true);
  expect(permReg.size).toBe(0);

  // Wait for turn completion
  await waitForNotification(runtime, "turn/completed", 10_000);

  runtime.stop();
});

test("permission: registry cancels all when turn completes", async () => {
  const db = new LocalDatabase();
  const store = new ClaudeSessionStore(db.connection);
  const permReg = new ClaudePermissionRegistry();

  const runtime = new ClaudeCompatibleRuntime({
    threadId: "thread-perm-002",
    ownerId: "owner-perm-test",
    cwd: process.cwd(),
    model: "claude-sonnet-4",
    env: { ...process.env, CODECLI_BIN: FAKE_PERM_BIN },
  }, store, permReg);

  runtime.startTurn({ prompt: "Run a command" });

  // Wait for permission request
  await waitForNotification(runtime, "item/tool/requestPermission", 10_000);
  expect(permReg.size).toBe(1);

  // Allow the permission so the turn can complete
  const notifications: JsonRpcNotification[] = [];
  runtime.on("notification", (n: JsonRpcNotification) => notifications.push(n));
  // Get the permission notification from the first handler
  for (const n of notifications) {
    if (n.method === "item/tool/requestPermission") {
      runtime.respondToPermission(n.params.id as string, true);
      break;
    }
  }

  await waitForNotification(runtime, "turn/completed", 10_000);
  expect(permReg.size).toBe(0);

  runtime.stop();
});

test("permission: interrupt cancels pending permissions", async () => {
  const db = new LocalDatabase();
  const store = new ClaudeSessionStore(db.connection);
  const permReg = new ClaudePermissionRegistry();

  const runtime = new ClaudeCompatibleRuntime({
    threadId: "thread-perm-003",
    ownerId: "owner-perm-test",
    cwd: process.cwd(),
    model: "claude-sonnet-4",
    env: { ...process.env, CODECLI_BIN: FAKE_PERM_BIN },
  }, store, permReg);

  runtime.startTurn({ prompt: "Run a command" });

  // Wait for permission request
  await waitForNotification(runtime, "item/tool/requestPermission", 10_000);
  expect(permReg.size).toBe(1);

  // Interrupt the turn
  runtime.interrupt();
  expect(permReg.size).toBe(0);

  runtime.stop();
});

test("permission: stop cancels all pending permissions", async () => {
  const db = new LocalDatabase();
  const store = new ClaudeSessionStore(db.connection);
  const permReg = new ClaudePermissionRegistry();

  const runtime = new ClaudeCompatibleRuntime({
    threadId: "thread-perm-004",
    ownerId: "owner-perm-test",
    cwd: process.cwd(),
    model: "claude-sonnet-4",
    env: { ...process.env, CODECLI_BIN: FAKE_PERM_BIN },
  }, store, permReg);

  runtime.startTurn({ prompt: "Run a command" });

  // Wait for permission request
  await waitForNotification(runtime, "item/tool/requestPermission", 10_000);
  expect(permReg.size).toBe(1);

  // Stop the runtime
  runtime.stop();
  expect(permReg.size).toBe(0);
});


test("permission mapping: supports default, read-only, and dangerous bypass modes", () => {
  expect(sandboxToPermissionMode({})).toBe("default");
  expect(sandboxToPermissionMode({ sandboxPolicy: { type: "readOnly" } })).toBe("plan");
  expect(sandboxToPermissionMode({ sandboxPolicy: { type: "dangerFullAccess" } })).toBe("bypassPermissions");
  expect(sandboxToPermissionMode({ approvalPolicy: "never", sandboxPolicy: { type: "readOnly" } })).toBe("bypassPermissions");
  expect(sandboxToPermissionMode({ sandbox: "danger-full-access" })).toBe("bypassPermissions");
  expect(sandboxToPermissionMode({ sandbox: "read-only" })).toBe("plan");
});
