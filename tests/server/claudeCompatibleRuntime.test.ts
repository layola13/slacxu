import { expect, test } from "bun:test";
import { ClaudeCompatibleRuntime } from "../../backends/claude/src/runtime/claudeCompatibleRuntime";
import { ClaudeSessionStore } from "../../backends/claude/src/runtime/claudeSessionStore";
import { LocalDatabase } from "../../apps/server/src/localDatabase";
import type { JsonRpcNotification } from "@codex-ui/shared";

import { resolve } from "node:path";
const FAKE_CLI_DIR = resolve(process.cwd(), "tests", "fixtures", "claude-compatible", "fake-cli");
const FAKE_CLI_BIN = process.platform === "win32"
  ? FAKE_CLI_DIR + "/fake-claude.cmd"
  : FAKE_CLI_DIR + "/fake-claude.js";

function createRuntime(threadId?: string): ClaudeCompatibleRuntime {
  const db = new LocalDatabase();
  const store = new ClaudeSessionStore(db.connection);
  return new ClaudeCompatibleRuntime({
    threadId: threadId ?? ("thread-rt-" + Date.now()),
    ownerId: "owner-rt-test",
    cwd: process.cwd(),
    model: "claude-sonnet-4",
    env: { ...process.env, CODECLI_BIN: FAKE_CLI_BIN },
  }, store);
}

function waitForNotification(runtime: ClaudeCompatibleRuntime, method: string, timeoutMs = 5_000): Promise<JsonRpcNotification> {
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

test("runtime: startTurn returns immediately with turn ID", async () => {
  const runtime = createRuntime();
  const turnId = runtime.startTurn({ prompt: "Hello" });
  expect(typeof turnId).toBe("string");
  expect(turnId.length).toBeGreaterThan(0);

  // Wait for turn to complete
  await waitForNotification(runtime, "turn/completed");
  runtime.stop();
});

test("runtime: emits turn/started before turn/completed", async () => {
  const runtime = createRuntime();
  const events: string[] = [];

  runtime.on("notification", (n: JsonRpcNotification) => events.push(n.method));

  runtime.startTurn({ prompt: "Hello" });

  // Wait for completion
  await waitForNotification(runtime, "turn/completed");

  const startedIdx = events.indexOf("turn/started");
  const completedIdx = events.indexOf("turn/completed");
  expect(startedIdx).toBeGreaterThanOrEqual(0);
  expect(completedIdx).toBeGreaterThan(startedIdx);

  runtime.stop();
});

test("runtime: emits item/completed with turnId", async () => {
  const runtime = createRuntime();
  const items: JsonRpcNotification[] = [];

  runtime.on("notification", (n: JsonRpcNotification) => {
    if (n.method === "item/completed") items.push(n);
  });

  runtime.startTurn({ prompt: "Hello" });

  await waitForNotification(runtime, "turn/completed");

  expect(items.length).toBeGreaterThanOrEqual(1);
  for (const n of items) {
    expect(n.params.turnId).toBeTruthy();
  }

  runtime.stop();
});

test("runtime: persists external session ID after init", async () => {
  const db = new LocalDatabase();
  const store = new ClaudeSessionStore(db.connection);
  const threadId = "thread-persist-" + Date.now();

  const runtime = new ClaudeCompatibleRuntime({
    threadId,
    ownerId: "owner-persist",
    cwd: process.cwd(),
    model: "claude-sonnet-4",
    env: { ...process.env, CODECLI_BIN: FAKE_CLI_BIN },
  }, store);

  runtime.startTurn({ prompt: "Hello" });
  await waitForNotification(runtime, "turn/completed");

  const record = store.get("owner-persist", threadId);
  expect(record).not.toBeNull();
  expect(record!.externalSessionId).toBeTruthy();

  runtime.stop();
});

test("runtime: isTurnActive returns true during turn, false after completion", async () => {
  const runtime = createRuntime();

  expect(runtime.isTurnActive()).toBe(false);

  runtime.startTurn({ prompt: "Hello" });
  expect(runtime.isTurnActive()).toBe(true);

  await waitForNotification(runtime, "turn/completed");

  expect(runtime.isTurnActive()).toBe(false);

  runtime.stop();
});

test("runtime: stop emits turn/failed if turn is still running", async () => {
  const runtime = createRuntime();

  const turnId = runtime.startTurn({ prompt: "Hello" });
  expect(runtime.isTurnActive()).toBe(true);

  let failedNotification: JsonRpcNotification | null = null;
  runtime.on("notification", (n: JsonRpcNotification) => {
    if (n.method === "turn/failed") failedNotification = n;
  });

  // Stop before the turn completes
  runtime.stop();

  // Wait a moment for events to fire
  await new Promise(resolve => setTimeout(resolve, 500));

  // The turn should have been force-terminated
  expect(failedNotification).not.toBeNull();
  expect(runtime.isTurnActive()).toBe(false);
});
