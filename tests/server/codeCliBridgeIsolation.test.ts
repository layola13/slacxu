import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { expect, test } from "bun:test";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { CodeCliBridge, codeCliNeedsManagedConfigDir, codeCliNeedsRunningProcess } from "../../apps/server/src/codeCliBridge";
import type { ClaudeCompactionInput } from "../../backends/claude/src/runtime/claudeCompactionRunner";

type SpawnCapture = {
  command: string;
  args: string[];
  options: SpawnOptionsWithoutStdio;
};

test("Claude bridge freezes one relay environment per conversation", async () => {
  const firstRuntimeEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-one",
    CLAUDE_CONFIG_DIR: "C:/virtual-claude/thread-one",
    ANTHROPIC_BASE_URL: "https://global.invalid/v1",
    ANTHROPIC_API_KEY: "global-key",
    ANTHROPIC_AUTH_TOKEN: "global-token",
    CLAUDE_CODE_OAUTH_TOKEN: "global-oauth",
    CLAUDE_CODE_USE_BEDROCK: "1",
  };
  const secondRuntimeEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-two",
    CLAUDE_CONFIG_DIR: "C:/virtual-claude/thread-two",
  };
  const firstCaptures: SpawnCapture[] = [];
  const secondCaptures: SpawnCapture[] = [];
  const firstBridge = new CodeCliBridge(() => firstRuntimeEnv, capturingSpawn(firstCaptures));
  const secondBridge = new CodeCliBridge(() => secondRuntimeEnv, capturingSpawn(secondCaptures));

  firstRuntimeEnv.CODEX_UI_PORT = "49999";
  firstRuntimeEnv.CODEX_UI_RELAY_GATEWAY_TOKEN = "mutated-after-construction";
  firstBridge.configure({
    model: "claude-sonnet-5",
    modelProvider: "gateai",
    groupId: "group-claude",
    cwd: process.cwd(),
    sandbox: "dangerFullAccess",
    approvalPolicy: "never",
  });
  secondBridge.configure({
    model: "claude-haiku-4-5-20251001",
    providerId: "deepkey",
    groupId: "catalog:claude-kiro-sale",
    cwd: process.cwd(),
  });

  await Promise.all([firstBridge.start(), secondBridge.start()]);

  const first = firstCaptures[0]!;
  const second = secondCaptures[0]!;
  const firstEnv = first.options.env!;
  const secondEnv = second.options.env!;
  expect(firstEnv.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:43121/api/relay-gateway/gateai/group-claude");
  expect(firstEnv.ANTHROPIC_API_KEY).toBe("gateway-one");
  expect(firstEnv.CLAUDE_CONFIG_DIR).toBe("C:/virtual-claude/thread-one");
  expect(firstEnv.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe("1");
  expect(firstEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  expect(firstEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  expect(firstEnv.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
  expect(first.args).toContain("claude-sonnet-5");
  expect(first.args).toContain("--dangerously-skip-permissions");
  expect(first.args.slice(first.args.indexOf("--permission-mode"), first.args.indexOf("--permission-mode") + 2)).toEqual(["--permission-mode", "bypassPermissions"]);
  expect(secondEnv.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:43121/api/relay-gateway/deepkey/catalog%3Aclaude-kiro-sale");
  expect(secondEnv.ANTHROPIC_API_KEY).toBe("gateway-two");
  expect(secondEnv.CLAUDE_CONFIG_DIR).toBe("C:/virtual-claude/thread-two");
  expect(second.args).toContain("claude-haiku-4-5-20251001");
  expect(second.args).not.toContain("--dangerously-skip-permissions");

  firstBridge.stop();
  secondBridge.stop();
});

test("Claude bridge reports the real Claude Code User-Agent", async () => {
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test" }), capturingSpawn([]));

  const initialize = await bridge.request("initialize") as { userAgent?: string };
  expect(initialize.userAgent).toBe("claude-code/2.1.222");
});

test("Claude bridge starts read-only sessions in Claude plan mode", async () => {
  const captures: SpawnCapture[] = [];
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), capturingSpawn(captures));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd(), sandbox: "read-only", approvalPolicy: "on-request" });
  await bridge.start();
  const args = captures[0]!.args;
  expect(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2)).toEqual(["--permission-mode", "plan"]);
  expect(args).not.toContain("--dangerously-skip-permissions");
  bridge.stop();
});

test("Claude bridge rejects thread/fork without starting Claude or persisting a fork", async () => {
  const captures: SpawnCapture[] = [];
  const snapshots: string[] = [];
  const bridge = new CodeCliBridge(
    () => ({ CODECLI_BIN: "claude-test" }),
    capturingSpawn(captures),
    undefined,
    undefined,
    (snapshot) => snapshots.push(snapshot.threadId),
  );

  await expect(bridge.request("thread/fork", { threadId: "parent-thread" })).rejects.toThrow(
    "Claude backend does not support thread/fork",
  );
  expect(captures).toHaveLength(0);
  expect(snapshots).toHaveLength(0);
});

test("Claude history reads do not start the CLI process", async () => {
  const captures: SpawnCapture[] = [];
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test" }), capturingSpawn(captures));
  bridge.restoreSession({
    threadId: "history-thread",
    model: "claude-sonnet-5",
    permissionMode: "default",
    createdAt: 1,
    turns: [{ id: "history-turn", status: "completed", createdAt: 2 }],
    messages: [{ type: "agentMessage", id: "history-item", turnId: "history-turn", content: "restored" }],
    goalStatus: null,
    conversation: [{ role: "assistant", text: "restored" }],
  });

  const result = await bridge.request("thread/read", { threadId: "history-thread", includeTurns: true }) as {
    thread?: { turns?: Array<{ items?: Array<{ content?: string }> }> };
  };
  expect(result.thread?.turns?.[0]?.items?.[0]?.content).toBe("restored");
  expect(captures).toHaveLength(0);
});

test("Claude recovery persists only the restored thread's interrupted turn", async () => {
  const snapshots: Array<{ threadId: string; providerId?: string; groupId?: string; turns: Array<{ status: string }> }> = [];
  const bridgeA = new CodeCliBridge(
    () => ({ CODECLI_BIN: "claude-test" }),
    capturingSpawn([]),
    undefined,
    undefined,
    (snapshot) => snapshots.push(snapshot),
  );
  const bridgeB = new CodeCliBridge(
    () => ({ CODECLI_BIN: "claude-test" }),
    capturingSpawn([]),
    undefined,
    undefined,
    (snapshot) => snapshots.push(snapshot),
  );
  bridgeB.restoreSession({
    threadId: "thread-b",
    providerId: "relay-b",
    groupId: "group-b",
    model: "model-b",
    permissionMode: "default",
    createdAt: 1,
    turns: [{ id: "turn-b", status: "completed", createdAt: 2 }],
    messages: [],
    goalStatus: null,
    conversation: [],
  });
  bridgeA.restoreSession({
    threadId: "thread-a",
    providerId: "relay-a",
    groupId: "group-a",
    model: "model-a",
    permissionMode: "default",
    createdAt: 1,
    turns: [{ id: "turn-a", status: "running", createdAt: 2 }],
    messages: [],
    goalStatus: null,
    conversation: [],
  });

  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({
    threadId: "thread-a",
    providerId: "relay-a",
    groupId: "group-a",
    turns: [{ id: "turn-a", status: "interrupted", createdAt: 2 }],
  });
  await bridgeA.request("turn/interrupt", { threadId: "thread-a" });
  expect(snapshots).toHaveLength(1);
  expect(bridgeB.getSessionSnapshot("thread-b")?.turns[0]?.status).toBe("completed");
});

test("Claude bridge restores dangerous bypass and relay routing from a persisted snapshot", async () => {
  const captures: SpawnCapture[] = [];
  const bridge = new CodeCliBridge(
    () => ({
      CODECLI_BIN: "claude-test",
      CODEX_UI_PORT: "43121",
      CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
    }),
    capturingSpawn(captures),
  );
  bridge.restoreSession({
    threadId: "danger-restore-thread",
    externalSessionId: "danger-restore-session",
    model: "claude-sonnet-5",
    permissionMode: "bypassPermissions",
    cwd: process.cwd(),
    providerId: "gateai",
    groupId: "group-claude",
    sandbox: "dangerFullAccess",
    approvalPolicy: "never",
    createdAt: 1,
    turns: [],
    messages: [],
    goalStatus: null,
    conversation: [],
  });

  await bridge.start();
  const args = captures[0]!.args;
  expect(args.slice(args.indexOf("--resume"), args.indexOf("--resume") + 2)).toEqual([
    "--resume",
    "danger-restore-session",
  ]);
  expect(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2)).toEqual([
    "--permission-mode",
    "bypassPermissions",
  ]);
  expect(args).toContain("--dangerously-skip-permissions");
  expect(captures[0]!.options.env?.ANTHROPIC_BASE_URL).toBe(
    "http://127.0.0.1:43121/api/relay-gateway/gateai/group-claude",
  );
  bridge.stop();
});

test("Claude bridge preserves dangerous bypass from legacy permission-only snapshots", async () => {
  const captures: SpawnCapture[] = [];
  const bridge = new CodeCliBridge(
    () => ({
      CODECLI_BIN: "claude-test",
      CODEX_UI_PORT: "43121",
      CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
    }),
    capturingSpawn(captures),
  );
  bridge.restoreSession({
    threadId: "legacy-danger-thread",
    externalSessionId: "legacy-danger-session",
    model: "claude-sonnet-5",
    permissionMode: "bypassPermissions",
    cwd: process.cwd(),
    providerId: "gateai",
    groupId: "group-claude",
    createdAt: 1,
    turns: [],
    messages: [],
    goalStatus: null,
    conversation: [],
  });

  await bridge.start();
  expect(captures[0]!.args).toContain("--dangerously-skip-permissions");
  expect(captures[0]!.args.slice(
    captures[0]!.args.indexOf("--permission-mode"),
    captures[0]!.args.indexOf("--permission-mode") + 2,
  )).toEqual(["--permission-mode", "bypassPermissions"]);
  bridge.stop();
});

test("Claude bridge refuses to start without a thread relay snapshot", async () => {
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), capturingSpawn([]));

  await expect(bridge.start()).rejects.toThrow("thread-scoped relay provider and group");
});

test("Claude terminal RPCs do not require a managed config directory", () => {
  expect(codeCliNeedsManagedConfigDir("thread/start")).toBe(true);
  expect(codeCliNeedsManagedConfigDir("thread/resume")).toBe(true);
  expect(codeCliNeedsManagedConfigDir("thread/delete")).toBe(false);
  expect(codeCliNeedsManagedConfigDir("thread/archive")).toBe(false);
  expect(codeCliNeedsManagedConfigDir("thread/closed")).toBe(false);
  expect(codeCliNeedsManagedConfigDir("thread/unsubscribe")).toBe(false);
  expect(codeCliNeedsManagedConfigDir("turn/interrupt")).toBe(false);
  expect(codeCliNeedsManagedConfigDir("thread/fork")).toBe(false);
  expect(codeCliNeedsRunningProcess("thread/read")).toBe(false);
  expect(codeCliNeedsRunningProcess("thread/resume")).toBe(false);
  expect(codeCliNeedsRunningProcess("thread/fork")).toBe(false);
  expect(codeCliNeedsRunningProcess("turn/start")).toBe(true);
});

test("Claude bridge leaves starting state after a synchronous spawn failure and can retry", async () => {
  const captures: SpawnCapture[] = [];
  let attempts = 0;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), (command, args, options) => {
    attempts += 1;
    if (attempts === 1) throw new Error("spawn failed synchronously");
    return capturingSpawn(captures)(command, args, options);
  });
  bridge.configure({
    model: "claude-sonnet-5",
    providerId: "gateai",
    groupId: "group-claude",
    cwd: process.cwd(),
  });

  await expect(bridge.start()).rejects.toThrow("spawn failed synchronously");
  expect(bridge.getStatus().phase).toBe("error");

  await expect(bridge.start()).resolves.toMatchObject({ phase: "ready" });
  expect(attempts).toBe(2);
  bridge.stop();
});

test("Claude bridge emits lifecycle notifications for terminal thread actions", async () => {
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), capturingSpawn([]));
  bridge.configure({
    model: "claude-sonnet-5",
    providerId: "gateai",
    groupId: "group-claude",
    cwd: process.cwd(),
  });
  const notifications: string[] = [];
  bridge.on("message", (message) => {
    if ("method" in message && !("id" in message)) notifications.push(message.method);
  });

  const started = await bridge.request("thread/start", {}) as { thread?: { id?: string } };
  const threadId = started.thread?.id;
  expect(threadId).toBeString();
  await bridge.request("thread/delete", { threadId });

  expect(notifications).toContain("thread/deleted");
  bridge.stop();
});

test("Claude bridge exposes child exit completion for config cleanup", async () => {
  let spawnedChild: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), (command, args, options) => {
    spawnedChild = capturingSpawn([])(command, args, options);
    return spawnedChild;
  });
  bridge.configure({
    model: "claude-sonnet-5",
    providerId: "gateai",
    groupId: "group-claude",
    cwd: process.cwd(),
  });
  await bridge.start();

  bridge.stop();
  await expect(bridge.waitForExit(5)).resolves.toBe(false);
  spawnedChild?.emit("exit", 0, null);
  await expect(bridge.waitForExit(50)).resolves.toBe(true);
});

test("Claude bridge stops the complete spawned process through its terminator", async () => {
  let spawnedChild: ChildProcessWithoutNullStreams | undefined;
  let terminatedChild: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), (command, args, options) => {
    spawnedChild = capturingSpawn([])(command, args, options);
    return spawnedChild;
  }, (child) => {
    terminatedChild = child;
    child.emit("exit", 0, null);
  });
  bridge.configure({
    model: "claude-sonnet-5",
    providerId: "gateai",
    groupId: "group-claude",
    cwd: process.cwd(),
  });
  await bridge.start();

  bridge.stop();

  expect(terminatedChild).toBe(spawnedChild);
  await expect(bridge.waitForExit(50)).resolves.toBe(true);
});

test("Claude bridge does not restart after child exit on terminal RPC", async () => {
  const captures: SpawnCapture[] = [];
  let spawnedChild: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), (command, args, options) => {
    spawnedChild = capturingSpawn(captures)(command, args, options);
    return spawnedChild;
  });
  bridge.configure({
    model: "claude-sonnet-5",
    providerId: "gateai",
    groupId: "group-claude",
    cwd: process.cwd(),
  });
  const notifications: string[] = [];
  bridge.on("message", (message) => {
    if ("method" in message && !("id" in message)) notifications.push(message.method);
  });

  const started = await bridge.request("thread/start", {}) as { thread?: { id?: string } };
  const threadId = started.thread?.id;
  expect(threadId).toBeString();
  spawnedChild?.emit("exit", 0, null);
  await expect(bridge.waitForExit(50)).resolves.toBe(true);

  await bridge.request("thread/delete", { threadId });

  expect(captures).toHaveLength(1);
  expect(notifications).toContain("thread/deleted");
});

test("Claude bridge projects matching assistant and result text once", async () => {
  let spawnedChild: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), (command, args, options) => {
    spawnedChild = capturingSpawn([])(command, args, options);
    return spawnedChild;
  });
  bridge.configure({
    model: "claude-sonnet-5",
    providerId: "gateai",
    groupId: "group-claude",
    cwd: process.cwd(),
  });
  const completedTexts: string[] = [];
  bridge.on("message", (message) => {
    if (!("method" in message) || message.method !== "item/completed") return;
    const params = message.params as { item?: { type?: string; content?: string } } | undefined;
    if (params?.item?.type === "agentMessage" && typeof params.item.content === "string") {
      completedTexts.push(params.item.content);
    }
  });

  const started = await bridge.request("thread/start", {}) as { thread?: { id?: string } };
  const threadId = started.thread?.id;
  expect(threadId).toBeString();
  await bridge.request("turn/start", { threadId, input: "hello" });
  spawnedChild?.stdout.write(JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "session-one",
  }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "session-one",
    uuid: "assistant-one",
    message: { role: "assistant", content: [{ type: "text", text: "same response" }] },
  }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "session-one",
    result: "same response",
  }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "session-one",
    result: "same response",
  }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(completedTexts).toEqual(["same response"]);
  bridge.stop();
});

test("Claude bridge deduplicates a result assembled from assistant text blocks", async () => {
  let spawnedChild: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), (command, args, options) => {
    spawnedChild = capturingSpawn([])(command, args, options);
    return spawnedChild;
  });
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const completedTexts: string[] = [];
  bridge.on("message", (message) => {
    if (!("method" in message) || message.method !== "item/completed") return;
    const params = message.params as { item?: { type?: string; content?: string } } | undefined;
    if (params?.item?.type === "agentMessage" && typeof params.item.content === "string") completedTexts.push(params.item.content);
  });

  const started = await bridge.request("thread/start", {}) as { thread?: { id?: string } };
  const threadId = started.thread?.id;
  await bridge.request("turn/start", { threadId, input: "hello" });
  spawnedChild?.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "session-two" }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "session-two",
    uuid: "assistant-two",
    message: { role: "assistant", content: [{ type: "text", text: "line one" }, { type: "text", text: "line two" }] },
  }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: "session-two", result: "line one\nline two" }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(completedTexts).toEqual(["line one", "line two"]);
  bridge.stop();
});

test("Claude bridge coalesces stream deltas with changing event UUIDs", async () => {
  let spawnedChild: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), (_command, _args, _options) => {
    spawnedChild = capturingSpawn([])(_command, _args, _options);
    return spawnedChild;
  });
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const deltaItemIds: string[] = [];
  const completedTexts: string[] = [];
  bridge.on("message", (message) => {
    if (!("method" in message)) return;
    if (message.method === "item/agentMessage/delta") {
      const params = message.params as { itemId?: string } | undefined;
      if (params?.itemId) deltaItemIds.push(params.itemId);
    }
    if (message.method === "item/completed") {
      const params = message.params as { item?: { type?: string; content?: string } } | undefined;
      if (params?.item?.type === "agentMessage" && typeof params.item.content === "string") {
        completedTexts.push(params.item.content);
      }
    }
  });

  const started = await bridge.request("thread/start", {}) as { thread?: { id?: string } };
  const threadId = started.thread?.id;
  await bridge.request("turn/start", { threadId, input: "hello" });
  spawnedChild?.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "session-stream" }) + "\n");
  for (const [uuid, text] of [["event-1", "功能"], ["event-2", "**"]]) {
    spawnedChild?.stdout.write(JSON.stringify({
      type: "stream_event",
      session_id: "session-stream",
      uuid,
      event: { type: "content_block_delta", delta: { type: "text_delta", text } },
    }) + "\n");
  }
  spawnedChild?.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: "session-stream", result: "功能**" }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(new Set(deltaItemIds).size).toBe(1);
  expect(completedTexts).toEqual(["功能**"]);
  bridge.stop();
});

test("Claude bridge projects result usage and model context window", async () => {
  let spawnedChild: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), (_command, _args, _options) => {
    spawnedChild = capturingSpawn([])(_command, _args, _options);
    return spawnedChild;
  });
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const usageNotifications: Array<{ method?: string; params?: Record<string, unknown> }> = [];
  bridge.on("message", (message) => {
    if ("method" in message && message.method === "thread/tokenUsage/updated") {
      usageNotifications.push(message as { method?: string; params?: Record<string, unknown> });
    }
  });

  const started = await bridge.request("thread/start", {}) as { thread?: { id?: string } };
  const threadId = started.thread?.id;
  const turn = await bridge.request("turn/start", { threadId, input: "hello" }) as { turn?: { id?: string } };
  spawnedChild?.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "session-usage" }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: "session-usage",
    event: {
      type: "message_start",
      message: { id: "message-usage", usage: { input_tokens: 120, cache_read_input_tokens: 30, cache_creation_input_tokens: 10, output_tokens: 0 } },
    },
  }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: "session-usage",
    event: { type: "message_delta", usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 40 } },
  }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({ type: "stream_event", session_id: "session-usage", event: { type: "message_stop" } }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "session-usage",
    result: "done",
    usage: { input_tokens: 120, cache_read_input_tokens: 30, cache_creation_input_tokens: 10, output_tokens: 40 },
    modelUsage: { "claude-sonnet-5": { contextWindow: 1_000_000 } },
  }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(usageNotifications).toHaveLength(1);
  expect(usageNotifications[0]?.params).toMatchObject({
    threadId,
    turnId: turn.turn?.id,
    tokenUsage: {
      total: { totalTokens: 240, inputTokens: 160, cachedInputTokens: 30, cacheWriteInputTokens: 10, outputTokens: 40 },
      last: { totalTokens: 240, inputTokens: 160, cachedInputTokens: 30, cacheWriteInputTokens: 10, outputTokens: 40 },
      modelContextWindow: 1_000_000,
    },
  });
  bridge.stop();
});

test("Claude bridge projects thinking deltas separately and retains streamed text for compaction", async () => {
  let spawnedChild: ChildProcessWithoutNullStreams | undefined;
  const compactionTranscripts: string[] = [];
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), (_command, _args, _options) => {
    spawnedChild = capturingSpawn([])(_command, _args, _options);
    return spawnedChild;
  }, undefined, async (input) => {
    compactionTranscripts.push(input.transcript);
    return "summary";
  });
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const methods: string[] = [];
  bridge.on("message", (message) => {
    if ("method" in message) methods.push(message.method);
  });

  const started = await bridge.request("thread/start", {}) as { thread?: { id?: string } };
  const threadId = started.thread?.id;
  await bridge.request("turn/start", { threadId, input: "hello" });
  spawnedChild?.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "session-reasoning" }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: "session-reasoning",
    uuid: "event-start",
    event: { type: "message_start", message: { id: "message-reasoning" } },
  }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: "session-reasoning",
    uuid: "event-thinking",
    event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "先检查" } },
  }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: "session-reasoning",
    uuid: "event-text",
    event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "完成" } },
  }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: "session-reasoning", result: "完成" }) + "\n");
  spawnedChild?.stdout.write(JSON.stringify({ type: "system", subtype: "session_state_changed", session_id: "session-reasoning", state: "idle" }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(methods).toContain("item/reasoning/textDelta");
  expect(methods).toContain("item/agentMessage/delta");
  expect(methods).toContain("turn/completed");

  await bridge.request("thread/compact/start", {
    threadId,
    __claudeCompactionRoute: { providerId: "omniroute-free", groupId: "opencode-free", model: "free-model" },
  });
  await waitFor(() => compactionTranscripts.length === 1);
  expect(compactionTranscripts[0]).toContain("Assistant: 完成");
  bridge.stop();
});

test("Claude bridge compacts through the supplied route and injects the summary into a fresh main session", async () => {
  const captures: SpawnCapture[] = [];
  const stdinWrites: string[][] = [];
  const children: ChildProcessWithoutNullStreams[] = [];
  const compactionInputs: ClaudeCompactionInput[] = [];
  const spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams => {
    captures.push({ command, args, options });
    const writes: string[] = [];
    stdinWrites.push(writes);
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    child.stdin = new Writable({ write(chunk, _encoding, callback) { writes.push(chunk.toString()); callback(); } });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    children.push(child);
    return child;
  };
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), spawn, (child) => child.emit("exit", 0, null), async (input) => {
    compactionInputs.push(input);
    return "Keep the accepted architecture and continue with the remaining tests.";
  });
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const notifications: string[] = [];
  bridge.on("message", (message) => {
    if ("method" in message && !("id" in message)) notifications.push(message.method);
  });

  const started = await bridge.request("thread/start", {}) as { thread?: { id?: string } };
  const threadId = started.thread?.id;
  await bridge.request("turn/start", { threadId, input: "design the bridge" });
  children[0]?.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "session-before" }) + "\n");
  children[0]?.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "session-before",
    uuid: "assistant-before",
    message: { role: "assistant", content: [{ type: "text", text: "Use one process per thread." }] },
  }) + "\n");
  children[0]?.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: "session-before", result: "Use one process per thread." }) + "\n");
  children[0]?.stdout.write(JSON.stringify({ type: "system", subtype: "session_state_changed", session_id: "session-before", state: "idle" }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const compactResult = await bridge.request("thread/compact/start", {
    threadId,
    __claudeCompactionRoute: { providerId: "omniroute-free", groupId: "opencode-free", model: "mimo-v2.5-free" },
  }) as { turn?: { id?: string } };
  await waitFor(() => notifications.filter((method) => method === "turn/completed").length >= 2);

  expect(compactResult.turn?.id).toBeString();
  expect(compactionInputs).toHaveLength(1);
  expect(compactionInputs[0]?.route).toEqual({ providerId: "omniroute-free", groupId: "opencode-free", model: "mimo-v2.5-free" });
  expect(compactionInputs[0]?.transcript).toBe("User: design the bridge\n\nAssistant: Use one process per thread.");
  expect(captures).toHaveLength(2);
  expect(captures[1]?.args).toContain("claude-sonnet-5");

  await bridge.request("turn/start", { threadId, input: "continue" });
  const resumedMessage = JSON.parse(stdinWrites[1]?.at(-1) ?? "{}") as { message?: { content?: string } };
  expect(resumedMessage.message?.content).toContain("<conversation-summary>");
  expect(resumedMessage.message?.content).toContain("Keep the accepted architecture");
  expect(resumedMessage.message?.content).toContain("continue");
  bridge.stop();
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for test condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("Claude bridge persists each user message before its assistant response", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), (command, args, options) => {
    child = capturingSpawn([])(command, args, options);
    return child;
  });
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });

  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  const threadId = started.thread.id;
  await bridge.request("turn/start", { threadId, input: "first question" });
  child!.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "ordered-session" }) + "\n");
  child!.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "ordered-session",
    uuid: "assistant-first",
    message: { role: "assistant", content: [{ type: "text", text: "first answer" }] },
  }) + "\n");
  child!.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: "ordered-session", result: "first answer" }) + "\n");
  child!.stdout.write(JSON.stringify({ type: "system", subtype: "session_state_changed", session_id: "ordered-session", state: "idle" }) + "\n");
  await waitFor(() => bridge.getSessionSnapshot(threadId)?.turns[0]?.status === "completed");

  await bridge.request("turn/start", { threadId, input: "second question" });
  child!.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "ordered-session",
    uuid: "assistant-second",
    message: { role: "assistant", content: [{ type: "text", text: "second answer" }] },
  }) + "\n");
  child!.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: "ordered-session", result: "second answer" }) + "\n");
  child!.stdout.write(JSON.stringify({ type: "system", subtype: "session_state_changed", session_id: "ordered-session", state: "idle" }) + "\n");
  await waitFor(() => bridge.getSessionSnapshot(threadId)?.turns[1]?.status === "completed");

  const history = await bridge.request("thread/read", { threadId, includeTurns: true }) as {
    thread: { turns: Array<{ items: Array<{ type?: string; content?: unknown }> }> };
  };
  expect(history.thread.turns.map((turn) => turn.items.map((item) => [item.type, item.content]))).toEqual([
    [["userMessage", [{ type: "text", text: "first question", text_elements: [] }]], ["agentMessage", "first answer"]],
    [["userMessage", [{ type: "text", text: "second question", text_elements: [] }]], ["agentMessage", "second answer"]],
  ]);
  bridge.stop();
});

test("Claude bridge appends steer input to the active turn without creating a phantom turn", async () => {
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), capturingSpawn([]));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const notifications: Array<{ method?: string; params?: Record<string, unknown> }> = [];
  bridge.on("message", (message) => notifications.push(message as typeof notifications[number]));

  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  const threadId = started.thread.id;
  const first = await bridge.request("turn/start", { threadId, input: "Start the work" }) as { turn: { id: string } };
  const turnId = first.turn.id;
  const steered = await bridge.request("turn/steer", { threadId, expectedTurnId: turnId, input: "Also check packaging" }) as { turn: { id: string } };

  expect(steered.turn.id).toBe(turnId);
  const session = bridge.getSessionSnapshot(threadId);
  expect(session?.turns).toHaveLength(1);
  expect(session?.turns[0]?.id).toBe(turnId);
  expect(session?.messages.map((message) => (message as { turnId?: string }).turnId)).toEqual([turnId, turnId]);
  expect(session?.conversation).toEqual([
    { role: "user", text: "Start the work" },
    { role: "user", text: "Also check packaging" },
  ]);
  expect(notifications.filter((message) => message.method === "turn/started")).toHaveLength(1);
  expect(notifications.filter((message) => message.method === "item/completed").map((message) => message.params?.turnId)).toEqual([turnId, turnId]);
  bridge.stop();
});

test("Claude bridge rejects a stale steer after the active turn has completed", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), (command, args, options) => {
    child = capturingSpawn([])(command, args, options);
    return child;
  });
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });

  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  const threadId = started.thread.id;
  const first = await bridge.request("turn/start", { threadId, input: "First prompt" }) as { turn: { id: string } };
  child!.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "stale-steer-session" }) + "\n");
  child!.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: "stale-steer-session", result: "Done" }) + "\n");
  child!.stdout.write(JSON.stringify({ type: "system", subtype: "session_state_changed", session_id: "stale-steer-session", state: "idle" }) + "\n");
  await waitFor(() => bridge.getSessionSnapshot(threadId)?.turns[0]?.status === "completed");

  await expect(bridge.request("turn/steer", { threadId, expectedTurnId: first.turn.id, input: "Second prompt" })).rejects.toThrow("No active turn");
  const second = await bridge.request("turn/start", { threadId, input: "Second prompt" }) as { turn: { id: string } };
  child!.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "stale-steer-session",
    uuid: "assistant-second-after-stale-steer",
    message: { role: "assistant", content: [{ type: "text", text: "Second answer" }] },
  }) + "\n");
  child!.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: "stale-steer-session", result: "Second answer" }) + "\n");
  child!.stdout.write(JSON.stringify({ type: "system", subtype: "session_state_changed", session_id: "stale-steer-session", state: "idle" }) + "\n");
  await waitFor(() => bridge.getSessionSnapshot(threadId)?.turns[1]?.status === "completed");

  const history = await bridge.request("thread/read", { threadId, includeTurns: true }) as {
    thread: { turns: Array<{ id: string; items: Array<{ type?: string; content?: unknown }> }> };
  };
  expect(history.thread.turns).toHaveLength(2);
  expect(history.thread.turns[1]?.id).toBe(second.turn.id);
  expect(history.thread.turns[1]?.items.map((item) => item.type)).toEqual(["userMessage", "agentMessage"]);
  expect(history.thread.turns[1]?.items.map((item) => item.content)).toEqual([
    [{ type: "text", text: "Second prompt", text_elements: [] }],
    "Second answer",
  ]);
  bridge.stop();
});

test("Claude bridge persists mutation snapshots including external session and terminal state", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const snapshots: Array<{ externalSessionId?: string; conversation: Array<{ role: string; text: string }>; turns: Array<{ status: string }> }> = [];
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), (command, args, options) => {
    child = capturingSpawn([])(command, args, options);
    return child;
  }, undefined, undefined, (snapshot) => snapshots.push(snapshot as typeof snapshots[number]));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread?: { id?: string } };
  const threadId = started.thread!.id!;
  await bridge.request("turn/start", { threadId, input: "hello" });
  child!.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "persisted-session" }) + "\n");
  child!.stdout.write(JSON.stringify({ type: "assistant", session_id: "persisted-session", uuid: "assistant-persist", message: { content: [{ type: "text", text: "world" }] } }) + "\n");
  child!.stdout.write(JSON.stringify({ type: "result", subtype: "success", session_id: "persisted-session", result: "world" }) + "\n");
  child!.stdout.write(JSON.stringify({ type: "system", subtype: "session_state_changed", session_id: "persisted-session", state: "idle" }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const latest = snapshots.at(-1)!;
  expect(latest.externalSessionId).toBe("persisted-session");
  expect(latest.conversation).toEqual([{ role: "user", text: "hello" }, { role: "assistant", text: "world" }]);
  expect(latest.turns[0]?.status).toBe("completed");
  bridge.stop();
});

test("Claude bridge restores a persisted session snapshot and exposes a defensive copy", () => {
  const snapshot = {
    threadId: "thread-restore",
    externalSessionId: "claude-session-restore",
    model: "claude-sonnet-5",
    permissionMode: "default",
    cwd: process.cwd(),
    createdAt: 123,
    turns: [{ id: "turn-restore", status: "completed", createdAt: 124 }],
    messages: [{ type: "agentMessage", id: "item-restore", content: "hello" }],
    goalStatus: null,
    conversation: [{ role: "user", text: "hello" }, { role: "assistant", text: "world" }],
  } as const;
  const bridge = new CodeCliBridge();
  bridge.restoreSession(snapshot);
  const restored = bridge.getSessionSnapshot("thread-restore");
  expect(restored).not.toBeNull();
  expect(restored?.threadId).toBe("thread-restore");
  expect(restored?.externalSessionId).toBe("claude-session-restore");
  expect(restored?.turns[0]?.status).toBe("completed");
  expect(restored?.conversation).toEqual(snapshot.conversation);
  restored!.conversation.push({ role: "user", text: "mutated" });
  expect(bridge.getSessionSnapshot("thread-restore")?.conversation).toHaveLength(2);
});

test("Claude bridge keeps the configured permission when re-configured without one", async () => {
  const captures: SpawnCapture[] = [];
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), capturingSpawn(captures));
  bridge.configure({
    model: "claude-sonnet-5",
    providerId: "gateai",
    groupId: "group-claude",
    cwd: process.cwd(),
    sandbox: "dangerFullAccess",
    approvalPolicy: "never",
  });
  // resolveClaudeBridgeForThread refreshes live bridges with just the threadId;
  // that must not downgrade the spawn to default/on-request.
  bridge.configure({ threadId: "thread-permission-keep" });
  await bridge.start();
  const args = captures[0]!.args;
  expect(args).toContain("--dangerously-skip-permissions");
  expect(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2)).toEqual(["--permission-mode", "bypassPermissions"]);
  bridge.stop();
});

function capturingSpawn(captures: SpawnCapture[]) {
  return (command: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams => {
    captures.push({ command, args, options });
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    return child;
  };
}
