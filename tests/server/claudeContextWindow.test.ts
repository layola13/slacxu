import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the code under test
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { expect, test } from "bun:test";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { CodeCliBridge } from "../../apps/server/src/codeCliBridge";

/**
 * The Claude CLI owns the `[1m]` contract: `--model <id>[1m]` strips the suffix
 * out of the request body and adds the `context-1m-2025-08-07` beta header. The
 * suffix therefore never reaches the wire, so the CLI reports `modelUsage`
 * under the base id and sizes it for the model's standard window. The bridge
 * has to treat the user's explicit variant as authoritative instead.
 */

type SpawnCapture = { command: string; args: string[]; options: SpawnOptionsWithoutStdio };

const RUNTIME_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  CODECLI_BIN: "claude-test",
  CODEX_UI_PORT: "43121",
  CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
};

test("a [1m] thread is charted against the one-million window", async () => {
  const { bridge } = createBridge();
  const threadId = await startThread(bridge, "claude-opus-5[1m]");

  expect(bridge.getSessionSnapshot(threadId)?.modelContextWindow).toBe(1_000_000);
});

test("the [1m] suffix reaches the CLI so it sends the 1M beta header", async () => {
  const captures: SpawnCapture[] = [];
  const { bridge } = createBridge(captures);
  await startThread(bridge, "claude-opus-5[1m]");
  await bridge.start();

  const args = captures[0]?.args ?? [];
  expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5[1m]");
});

test("a thread without a variant still reports a window when the CLI omits one", async () => {
  const { bridge } = createBridge();
  const threadId = await startThread(bridge, "claude-opus-5");

  // Older CLI builds report `modelUsage` with token counts but no
  // `contextWindow`, which used to leave the composer with no gauge at all.
  expect(bridge.getSessionSnapshot(threadId)?.modelContextWindow).toBe(1_000_000);
});

test("a restored thread persisted before the fix recovers its window", () => {
  const { bridge } = createBridge();
  bridge.restoreSession({
    threadId: "thread-restored",
    model: "claude-opus-5[1m]",
    permissionMode: "default",
    createdAt: Date.now(),
    turns: [],
    messages: [],
    goalStatus: null,
    conversation: [],
  } as never);

  expect(bridge.getSessionSnapshot("thread-restored")?.modelContextWindow).toBe(1_000_000);
});

function createBridge(captures: SpawnCapture[] = []): { bridge: CodeCliBridge; captures: SpawnCapture[] } {
  const bridge = new CodeCliBridge(() => RUNTIME_ENV, (command, args, options) => {
    captures.push({ command, args, options });
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    return child;
  });
  return { bridge, captures };
}

async function startThread(bridge: CodeCliBridge, model: string): Promise<string> {
  const started = await bridge.request("thread/start", {
    model,
    cwd: process.cwd(),
    providerId: "relay-provider",
    groupId: "relay-group",
  });
  const thread = (started as { thread: { id: string } }).thread;
  return thread.id;
}

test("the main Claude session no longer disables native slash commands", async () => {
  const captures: SpawnCapture[] = [];
  const { bridge } = createBridge(captures);
  await startThread(bridge, "claude-opus-5");
  await bridge.start();

  const args = captures[0]?.args ?? [];
  expect(args).not.toContain("--disable-slash-commands");
});
