import { expect, test } from "bun:test";
import { ClaudeCompatibleProcessManager } from "../../backends/claude/src/runtime/claudeCompatibleProcessManager";
import { resolve } from "node:path";

const FAKE_CLI_DIR = resolve(process.cwd(), "tests", "fixtures", "claude-compatible", "fake-cli");
const FAKE_CLI_BIN = process.platform === "win32"
  ? resolve(FAKE_CLI_DIR, "fake-claude.cmd")
  : resolve(FAKE_CLI_DIR, "fake-claude.js");

test("process manager: starts, emits init message, and stops cleanly", async () => {
  const manager = new ClaudeCompatibleProcessManager({
    cwd: process.cwd(),
    model: "claude-sonnet-4",
  });

  const messages: Record<string, unknown>[] = [];
  let exited = false;
  let exitCode: number | null = null;

  manager.on("message", (msg) => messages.push(msg));
  manager.on("exit", ({ code }) => {
    exited = true;
    exitCode = code;
  });

  // Start with the fake CLI binary
  const env = { ...process.env, CODECLI_BIN: FAKE_CLI_BIN };
  manager.start(env);

  // Wait for init message
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for init")), 5_000);
    const check = setInterval(() => {
      if (messages.some(m => m.type === "system" && m.subtype === "init")) {
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      }
    }, 50);
  });

  expect(messages.length).toBeGreaterThanOrEqual(1);
  expect(messages[0].type).toBe("system");

  // Stop the process
  manager.stop();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    manager.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });

  expect(exited).toBe(true);
  expect(manager.isRunning()).toBe(false);
});

test("process manager: writes stdin and receives assistant response", async () => {
  const manager = new ClaudeCompatibleProcessManager({
    cwd: process.cwd(),
    model: "claude-sonnet-4",
  });

  const messages: Record<string, unknown>[] = [];

  manager.on("message", (msg) => messages.push(msg));

  const env = { ...process.env, CODECLI_BIN: FAKE_CLI_BIN };
  manager.start(env);

  // Wait for init
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for init")), 5_000);
    const check = setInterval(() => {
      if (messages.some(m => m.type === "system" && m.subtype === "init")) {
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      }
    }, 50);
  });

  // Send a user message
  manager.writeStdin({
    type: "user",
    message: { role: "user", content: "Hello" },
    parent_tool_use_id: null
  } as never);

  // Wait for assistant and result messages
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for result")), 5_000);
    const check = setInterval(() => {
      if (messages.some(m => m.type === "result")) {
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      }
    }, 50);
  });

  const assistantMsgs = messages.filter(m => m.type === "assistant");
  const resultMsgs = messages.filter(m => m.type === "result");
  expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
  expect(resultMsgs.length).toBe(1);

  manager.stop();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    manager.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
});

test("process manager: rejects invalid workspace", () => {
  const manager = new ClaudeCompatibleProcessManager({
    cwd: "Z:/nonexistent/path/that/does/not/exist",
  });

  expect(() => manager.start(process.env)).toThrow("does not exist");
});

test("process manager: pid is available after start", async () => {
  const manager = new ClaudeCompatibleProcessManager({
    cwd: process.cwd(),
  });

  expect(manager.pid).toBeNull();

  const env = { ...process.env, CODECLI_BIN: FAKE_CLI_BIN };
  manager.start(env);

  expect(manager.pid).not.toBeNull();
  expect(manager.isRunning()).toBe(true);

  manager.stop();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    manager.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
});
