import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { expect, test } from "bun:test";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { JsonRpcMessage } from "@codex-ui/shared";
import { CodeCliBridge } from "../../apps/server/src/codeCliBridge";

function fakeSpawn(
  onSpawn: (child: ChildProcessWithoutNullStreams) => void,
): (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams {
  return () => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    onSpawn(child);
    return child;
  };
}

function send(child: ChildProcessWithoutNullStreams, message: unknown): void {
  child.stdout.write(`${JSON.stringify(message)}\n`);
}

test("Claude bridge projects parallel Agent tools as readable child threads", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({
    model: "claude-sonnet-5",
    providerId: "gateai",
    groupId: "group-claude",
    cwd: process.cwd(),
  });

  const notifications: JsonRpcMessage[] = [];
  bridge.on("message", (message) => notifications.push(message));
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  const parentThreadId = started.thread.id;
  const turn = await bridge.request("turn/start", {
    threadId: parentThreadId,
    input: "Run review and tests concurrently",
  }) as { turn: { id: string } };
  expect(child).toBeDefined();

  send(child!, { type: "system", subtype: "init", session_id: "session-agents" });
  send(child!, {
    type: "assistant",
    session_id: "session-agents",
    uuid: "assistant-spawn",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "agent-review",
          name: "Agent",
          input: {
            subagent_type: "reviewer",
            description: "Review agent",
            prompt: "Review the implementation",
            model: "claude-sonnet-5",
          },
        },
        {
          type: "tool_use",
          id: "agent-tests",
          name: "Task",
          input: {
            subagent_type: "tester",
            description: "Test agent",
            prompt: "Run focused tests",
          },
        },
      ],
    },
  });
  send(child!, {
    type: "assistant",
    session_id: "session-agents",
    uuid: "assistant-spawn-replay",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: "agent-review", name: "Agent", input: { subagent_type: "reviewer", prompt: "Review the implementation" } },
        { type: "tool_use", id: "agent-tests", name: "Task", input: { subagent_type: "tester", prompt: "Run focused tests" } },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const childStarted = notifications.filter((message) => message.method === "thread/started")
    .map((message) => (message.params as { thread?: Record<string, unknown> } | undefined)?.thread)
    .filter((thread): thread is Record<string, unknown> => thread?.parentThreadId === parentThreadId);
  expect(childStarted).toHaveLength(2);
  const reviewThreadId = String(childStarted.find((thread) => thread.agentRole === "reviewer")?.id);
  const testThreadId = String(childStarted.find((thread) => thread.agentRole === "tester")?.id);
  expect(reviewThreadId).not.toBe("undefined");
  expect(testThreadId).not.toBe("undefined");

  send(child!, {
    type: "stream_event",
    session_id: "session-agents",
    uuid: "review-output",
    parent_tool_use_id: "agent-review",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Reviewing" } },
  });
  send(child!, {
    type: "assistant",
    session_id: "session-agents",
    uuid: "review-output",
    parent_tool_use_id: "agent-review",
    message: { role: "assistant", content: [{ type: "text", text: "Review complete" }] },
  });
  send(child!, {
    type: "assistant",
    session_id: "session-agents",
    uuid: "test-output",
    parent_tool_use_id: "agent-tests",
    message: { role: "assistant", content: [{ type: "text", text: "Tests complete" }] },
  });
  send(child!, {
    type: "user",
    session_id: "session-agents",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "agent-review",
          content: "Async agent launched successfully.\nagentId: task-review\nThe agent is working in the background.",
        },
        {
          type: "tool_result",
          tool_use_id: "agent-tests",
          content: "Async agent launched successfully.\nagentId: task-tests\nThe agent is working in the background.",
        },
      ],
    },
  });
  send(child!, {
    type: "system",
    subtype: "task_started",
    session_id: "session-agents",
    task_id: "task-review",
    tool_use_id: "agent-review",
    description: "Review agent",
  });
  send(child!, {
    type: "system",
    subtype: "task_started",
    session_id: "session-agents",
    task_id: "task-tests",
    tool_use_id: "agent-tests",
    description: "Test agent",
  });
  send(child!, {
    type: "system",
    subtype: "task_notification",
    session_id: "session-agents",
    task_id: "task-review",
    tool_use_id: "agent-review",
    status: "completed",
    summary: "Review complete",
    output_file: "review.txt",
  });
  send(child!, {
    type: "system",
    subtype: "task_notification",
    session_id: "session-agents",
    task_id: "task-tests",
    tool_use_id: "agent-tests",
    status: "completed",
    summary: "Tests complete",
    output_file: "tests.txt",
  });
  send(child!, {
    type: "result",
    subtype: "success",
    session_id: "session-agents",
    is_error: false,
    result: "Parallel work finished",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const childDelta = notifications.find((message) => {
    if (message.method !== "item/agentMessage/delta") return false;
    const params = message.params as { threadId?: string; delta?: string } | undefined;
    return params?.threadId === reviewThreadId && params.delta === "Reviewing";
  });
  expect(childDelta).toBeDefined();

  for (const childThreadId of [reviewThreadId, testThreadId]) {
    const terminal = notifications.find((message) => {
      if (message.method !== "turn/completed") return false;
      const params = message.params as { threadId?: string } | undefined;
      return params?.threadId === childThreadId;
    });
    expect(terminal).toBeDefined();
  }

  const groupItems = notifications.filter((message) => {
    if (message.method !== "item/started" && message.method !== "item/completed") return false;
    const params = message.params as { item?: { type?: string } } | undefined;
    return params?.item?.type === "collabAgentToolCall";
  });
  expect(new Set(groupItems.map((message) => {
    const params = message.params as { item?: { id?: string } } | undefined;
    return params?.item?.id;
  })).size).toBe(1);
  expect(groupItems.some((message) => message.method === "item/started")).toBe(true);
  const completedGroup = groupItems.findLast((message) => message.method === "item/completed");
  const completedItem = (completedGroup?.params as { item?: Record<string, unknown> } | undefined)?.item;
  expect(completedItem?.status).toBe("completed");
  expect(completedItem?.receiverThreadIds).toEqual(expect.arrayContaining([reviewThreadId, testThreadId]));

  const reviewHistory = await bridge.request("thread/read", {
    threadId: reviewThreadId,
    includeTurns: true,
  }) as { thread: { parentThreadId?: string; agentRole?: string; turns?: Array<{ status?: string; items?: Array<Record<string, unknown>> }> } };
  expect(reviewHistory.thread.parentThreadId).toBe(parentThreadId);
  expect(reviewHistory.thread.agentRole).toBe("reviewer");
  expect(reviewHistory.thread.turns?.[0]?.status).toBe("completed");
  expect(reviewHistory.thread.turns?.[0]?.items?.some((item) => item.content === "Review complete")).toBe(true);

  const parentHistory = await bridge.request("thread/read", {
    threadId: parentThreadId,
    includeTurns: true,
  }) as { thread: { turns?: Array<{ id?: string; items?: Array<Record<string, unknown>> }> } };
  const parentTurn = parentHistory.thread.turns?.find((entry) => entry.id === turn.turn.id);
  expect(parentTurn?.items?.some((item) => item.type === "collabAgentToolCall" && item.status === "completed")).toBe(true);

  await bridge.request("thread/delete", { threadId: reviewThreadId });
  const remainingChild = await bridge.request("thread/read", { threadId: testThreadId, includeTurns: true }) as {
    thread: { id?: string; turns?: Array<{ status?: string }> };
  };
  expect(remainingChild.thread.id).toBe(testThreadId);
  expect(remainingChild.thread.turns?.[0]?.status).toBe("completed");
  const groupAfterChildDelete = notifications.findLast((message) => {
    if (message.method !== "item/completed") return false;
    return (message.params as { item?: { type?: string } } | undefined)?.item?.type === "collabAgentToolCall";
  });
  expect((groupAfterChildDelete?.params as { item?: { receiverThreadIds?: string[] } } | undefined)?.item?.receiverThreadIds).toEqual([testThreadId]);
  const notificationCount = notifications.length;
  send(child!, {
    type: "system",
    subtype: "task_notification",
    session_id: "session-agents",
    task_id: "task-review",
    status: "completed",
    summary: "Late review notification",
    output_file: "review.txt",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(notifications).toHaveLength(notificationCount);

  bridge.stop();
});

test("Claude bridge keeps async agents running after the parent result", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const notifications: JsonRpcMessage[] = [];
  bridge.on("message", (message) => notifications.push(message));

  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Start one background review" });
  send(child!, { type: "system", subtype: "init", session_id: "session-parent-first" });
  send(child!, {
    type: "assistant",
    session_id: "session-parent-first",
    uuid: "assistant-parent-first",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "agent-parent-first",
        name: "Agent",
        input: { subagent_type: "reviewer", description: "Async review", prompt: "Review in the background" },
      }],
    },
  });
  send(child!, {
    type: "user",
    session_id: "session-parent-first",
    message: {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "agent-parent-first",
        content: "Async agent launched successfully.\nagentId: task-parent-first\nThe agent is working in the background.",
      }],
    },
  });
  send(child!, {
    type: "result",
    subtype: "success",
    session_id: "session-parent-first",
    is_error: false,
    result: "The review is running in the background.",
  });
  send(child!, {
    type: "system",
    subtype: "task_notification",
    session_id: "session-parent-first",
    task_id: "task-parent-first",
    status: "running",
    summary: "Still reviewing",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const childThreadStarted = notifications.find((message) => {
    if (message.method !== "thread/started") return false;
    return (message.params as { thread?: { parentThreadId?: string } } | undefined)?.thread?.parentThreadId === started.thread.id;
  });
  const childThreadId = String((childThreadStarted?.params as { thread?: { id?: string } } | undefined)?.thread?.id);
  expect(childThreadId).not.toBe("undefined");
  const parentWhileChildRuns = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as {
    thread: { turns?: Array<{ status?: string }> };
  };
  expect(parentWhileChildRuns.thread.turns?.[0]?.status).toBe("running");
  expect(notifications.some((message) => {
    if (message.method !== "turn/completed") return false;
    return (message.params as { threadId?: string } | undefined)?.threadId === started.thread.id;
  })).toBe(false);
  expect(notifications.some((message) => {
    if (message.method !== "turn/completed") return false;
    return (message.params as { threadId?: string } | undefined)?.threadId === childThreadId;
  })).toBe(false);
  const runningGroup = notifications.findLast((message) => {
    if (message.method !== "item/started") return false;
    return (message.params as { item?: { type?: string } } | undefined)?.item?.type === "collabAgentToolCall";
  });
  expect((runningGroup?.params as { item?: { status?: string; agentsStates?: Record<string, { status?: string }> } } | undefined)?.item?.status).toBe("inProgress");
  expect((runningGroup?.params as { item?: { agentsStates?: Record<string, { status?: string }> } } | undefined)?.item?.agentsStates?.[childThreadId]?.status).toBe("running");

  send(child!, {
    type: "system",
    subtype: "task_notification",
    session_id: "session-parent-first",
    task_id: "task-parent-first",
    status: "completed",
    summary: "Async review complete",
    output_file: "review.txt",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(notifications.some((message) => {
    if (message.method !== "turn/completed") return false;
    return (message.params as { threadId?: string } | undefined)?.threadId === childThreadId;
  })).toBe(true);
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-parent-first", state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const parentAfterChildCompletes = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as {
    thread: { turns?: Array<{ status?: string }> };
  };
  expect(parentAfterChildCompletes.thread.turns?.[0]?.status).toBe("completed");
  expect(notifications.some((message) => {
    if (message.method !== "turn/completed") return false;
    return (message.params as { threadId?: string } | undefined)?.threadId === started.thread.id;
  })).toBe(true);

  bridge.stop();
});

test("Claude bridge fails running agent projections when the CLI exits", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43121",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const notifications: JsonRpcMessage[] = [];
  bridge.on("message", (message) => notifications.push(message));

  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Delegate this" });
  send(child!, { type: "system", subtype: "init", session_id: "session-failure" });
  send(child!, {
    type: "assistant",
    session_id: "session-failure",
    uuid: "assistant-failure",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "agent-failure", name: "Agent", input: { subagent_type: "reviewer", prompt: "Review" } }],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  child!.emit("exit", 1, null);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const childThreadStarted = notifications.find((message) => {
    if (message.method !== "thread/started") return false;
    return (message.params as { thread?: { parentThreadId?: string } } | undefined)?.thread?.parentThreadId === started.thread.id;
  });
  const childThreadId = (childThreadStarted?.params as { thread?: { id?: string } } | undefined)?.thread?.id;
  expect(childThreadId).toBeString();
  expect(notifications.some((message) => {
    if (message.method !== "turn/failed") return false;
    return (message.params as { threadId?: string } | undefined)?.threadId === childThreadId;
  })).toBe(true);
  const terminalGroup = notifications.findLast((message) => {
    if (message.method !== "item/completed") return false;
    return (message.params as { item?: { type?: string } } | undefined)?.item?.type === "collabAgentToolCall";
  });
  expect((terminalGroup?.params as { item?: { status?: string } } | undefined)?.item?.status).toBe("failed");
});

test("Claude bridge keeps background package builds working until task completion and session idle", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const notifications: JsonRpcMessage[] = [];
  bridge.on("message", (message) => notifications.push(message));
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Build the package in the background" });
  send(child!, { type: "system", subtype: "init", session_id: "session-package-build" });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-package-build", state: "running" });
  send(child!, { type: "assistant", session_id: "session-package-build", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "tool_use", id: "tool-package-build", name: "Bash", input: { command: "bun run build", run_in_background: true } }] } });
  send(child!, { type: "result", subtype: "success", session_id: "session-package-build", is_error: false, result: "The package build is still running." });
  send(child!, { type: "system", subtype: "task_started", session_id: "session-package-build", task_id: "task-package-build", tool_use_id: "tool-package-build" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  let parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("running");
  expect(notifications.some((message) => message.method === "turn/completed")).toBe(false);
  send(child!, { type: "system", subtype: "task_notification", session_id: "session-package-build", task_id: "task-package-build", tool_use_id: "tool-package-build", status: "completed" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("running");
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-package-build", state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("completed");
  expect(notifications.filter((message) => message.method === "turn/completed")).toHaveLength(1);
  bridge.stop();
});

test("Claude bridge retains a background task reported before its Bash tool-use", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Build in the background" });
  const sessionId = "session-task-before-tool-use";
  send(child!, { type: "system", subtype: "init", session_id: sessionId });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: sessionId, state: "running" });
  send(child!, { type: "system", subtype: "task_started", session_id: sessionId, task_id: "task-before-tool-use", tool_use_id: "tool-before-task" });
  send(child!, { type: "assistant", session_id: sessionId, parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "tool_use", id: "tool-before-task", name: "Bash", input: { command: "bun run build", run_in_background: true } }] } });
  send(child!, { type: "result", subtype: "success", session_id: sessionId, is_error: false, result: "Build started." });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: sessionId, state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  let parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("running");
  send(child!, { type: "system", subtype: "task_notification", session_id: sessionId, task_id: "task-before-tool-use", tool_use_id: "tool-before-task", status: "completed" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("completed");
  bridge.stop();
});

test("Claude bridge accepts a terminal task notification before task_started", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Run the test build" });
  send(child!, { type: "system", subtype: "init", session_id: "session-notification-first" });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-notification-first", state: "running" });
  send(child!, { type: "assistant", session_id: "session-notification-first", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "tool_use", id: "tool-notification-first", name: "Bash", input: { command: "bun test", run_in_background: true } }] } });
  send(child!, { type: "result", subtype: "success", session_id: "session-notification-first", is_error: false, result: "Waiting for tests." });
  send(child!, { type: "system", subtype: "task_notification", session_id: "session-notification-first", task_id: "task-notification-first", tool_use_id: "tool-notification-first", status: "completed" });
  send(child!, { type: "system", subtype: "task_started", session_id: "session-notification-first", task_id: "task-notification-first", tool_use_id: "tool-notification-first" });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-notification-first", state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("completed");
  bridge.stop();
});

test("Claude bridge reconciles an Agent terminal notification before its tool-use", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Ask an agent" });
  const sessionId = "session-agent-terminal-first";
  const toolUseId = "agent-terminal-first";
  send(child!, { type: "system", subtype: "init", session_id: sessionId });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: sessionId, state: "running" });
  send(child!, { type: "system", subtype: "task_notification", session_id: sessionId, task_id: "agent-task-terminal-first", tool_use_id: toolUseId, status: "completed", summary: "Agent finished" });
  send(child!, { type: "assistant", session_id: sessionId, parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name: "Agent", input: { prompt: "Inspect the package" } }] } });
  send(child!, { type: "result", subtype: "success", session_id: sessionId, is_error: false, result: "Agent finished." });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: sessionId, state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("completed");
  const children = await bridge.request("thread/list", {}) as { data?: Array<{ parentThreadId?: string; status?: { type?: string } }> };
  expect(children.data?.some((thread) => thread.parentThreadId === started.thread.id && thread.status?.type === "idle")).toBe(true);
  bridge.stop();
});

test.each(["failed", "stopped"])("Claude bridge settles a %s background task without a timeout", async (taskStatus) => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Run a background command" });
  const sessionId = `session-background-${taskStatus}`;
  const toolUseId = `tool-background-${taskStatus}`;
  const taskId = `task-background-${taskStatus}`;
  send(child!, { type: "system", subtype: "init", session_id: sessionId });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: sessionId, state: "running" });
  send(child!, { type: "assistant", session_id: sessionId, parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name: "Bash", input: { command: "build", run_in_background: true } }] } });
  send(child!, { type: "system", subtype: "task_started", session_id: sessionId, task_id: taskId, tool_use_id: toolUseId });
  send(child!, { type: "result", subtype: "success", session_id: sessionId, is_error: false, result: "Background command accepted." });
  send(child!, { type: "system", subtype: "task_notification", session_id: sessionId, task_id: taskId, tool_use_id: toolUseId, status: taskStatus });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: sessionId, state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("completed");
  bridge.stop();
});

test("Claude bridge waits for idle after requires_action and result", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Prepare a release" });
  send(child!, { type: "system", subtype: "init", session_id: "session-state-gate" });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-state-gate", state: "running" });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-state-gate", state: "requires_action" });
  send(child!, { type: "result", subtype: "success", session_id: "session-state-gate", is_error: false, result: "Release prepared." });
  await new Promise((resolve) => setTimeout(resolve, 0));
  let parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("running");
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-state-gate", state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("completed");
  bridge.stop();
});

test("Claude bridge keeps a pending result open until its permission request is answered", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Prepare a release" });
  const sessionId = "session-pending-permission";
  send(child!, { type: "system", subtype: "init", session_id: sessionId });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: sessionId, state: "running" });
  send(child!, { type: "control_request", session_id: sessionId, request_id: "permission-1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "release" } } });
  send(child!, { type: "result", subtype: "success", session_id: sessionId, is_error: false, result: "Release prepared." });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: sessionId, state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  let parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("running");
  bridge.respond("perm-permission-1", { decision: "accept" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("completed");
  bridge.stop();
});

test("Claude bridge persists approved tool inputs and reuses them after a CLI restart", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const writes: Array<Record<string, unknown>> = [];
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  const sessionId = "session-permission-memory";
  const originalWrite = child!.stdin.write.bind(child!.stdin);
  child!.stdin.write = ((chunk: string, ...args: unknown[]) => {
    try { writes.push(JSON.parse(chunk.trim()) as Record<string, unknown>); } catch { /* test stream */ }
    return originalWrite(chunk, ...(args as []));
  }) as typeof child.stdin.write;

  const notifications: JsonRpcMessage[] = [];
  bridge.on("message", (message) => notifications.push(message));
  send(child!, { type: "system", subtype: "init", session_id: sessionId });
  send(child!, {
    type: "control_request",
    session_id: sessionId,
    request_id: "permission-memory-1",
    request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "npm test", timeout: 10 } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(notifications.filter((message) => message.method === "item/commandExecution/requestApproval")).toHaveLength(1);
  // The approval must be a JSON-RPC request (with id) so the host routes it to
  // clients as `codex.serverRequest`; notifications never render in the UI.
  const approvalRequest = notifications.find((message) => message.method === "item/commandExecution/requestApproval") as { id?: unknown; params?: Record<string, unknown> };
  expect(approvalRequest.id).toBe("perm-permission-memory-1");
  expect(approvalRequest.params?.command).toBe("npm test");
  bridge.respond("perm-permission-memory-1", { decision: "acceptForSession" });
  expect(writes.at(-1)).toMatchObject({
    type: "control_response",
    response: { request_id: "permission-memory-1", response: { behavior: "allow" } },
  });
  const snapshot = bridge.getSessionSnapshot(started.thread.id)!;
  expect(snapshot.approvedToolAllows).toHaveLength(1);

  send(child!, {
    type: "control_request",
    session_id: sessionId,
    request_id: "permission-memory-2",
    request: { subtype: "can_use_tool", tool_name: "Bash", input: { timeout: 10, command: "npm test" } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(notifications.filter((message) => message.method === "item/commandExecution/requestApproval")).toHaveLength(1);
  expect(writes.at(-1)).toMatchObject({
    type: "control_response",
    response: { request_id: "permission-memory-2", response: { behavior: "allow" } },
  });

  send(child!, {
    type: "control_request",
    session_id: sessionId,
    request_id: "permission-memory-3",
    request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "npm run build", timeout: 10 } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  // acceptForSession stored a Bash-wide "*" grant, so a different command is
  // auto-allowed without another approval card.
  expect(notifications.filter((message) => message.method === "item/commandExecution/requestApproval")).toHaveLength(1);
  expect(writes.at(-1)).toMatchObject({
    type: "control_response",
    response: { request_id: "permission-memory-3", response: { behavior: "allow" } },
  });
  bridge.stop();

  let restoredChild: ChildProcessWithoutNullStreams | undefined;
  const restoredWrites: Array<Record<string, unknown>> = [];
  const restored = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => {
    restoredChild = spawned;
    const restoredOriginalWrite = spawned.stdin.write.bind(spawned.stdin);
    spawned.stdin.write = ((chunk: string, ...args: unknown[]) => {
      try { restoredWrites.push(JSON.parse(chunk.trim()) as Record<string, unknown>); } catch { /* test stream */ }
      return restoredOriginalWrite(chunk, ...(args as []));
    }) as typeof spawned.stdin.write;
  }));
  restored.restoreSession(snapshot);
  await restored.request("turn/start", { threadId: started.thread.id, input: "Continue after restart" });
  send(restoredChild!, { type: "system", subtype: "init", session_id: sessionId });
  send(restoredChild!, {
    type: "control_request",
    session_id: sessionId,
    request_id: "permission-memory-4",
    request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "npm test", timeout: 10 } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(restoredWrites.at(-1)).toMatchObject({
    type: "control_response",
    response: { request_id: "permission-memory-4", response: { behavior: "allow" } },
  });
  restored.stop();
});

test("Claude bridge applies model and effort changes through control requests", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", reasoningEffort: "medium", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "hello" });
  const writes: Array<Record<string, unknown>> = [];
  const originalWrite = child!.stdin.write.bind(child!.stdin);
  child!.stdin.write = ((chunk: string, ...args: unknown[]) => {
    try { writes.push(JSON.parse(chunk.trim()) as Record<string, unknown>); } catch { /* test stream */ }
    return originalWrite(chunk, ...(args as []));
  }) as typeof child.stdin.write;
  const applyPromise = bridge.applyRuntimeConfig({ threadId: started.thread.id, model: "claude-opus-4-6", effort: "high" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const controls = writes.filter((entry) => entry.type === "control_request");
  expect(controls).toHaveLength(1);
  expect((controls[0]?.request as Record<string, unknown>)?.subtype).toBe("set_model");
  send(child!, { type: "control_response", response: { subtype: "success", request_id: controls[0]?.request_id } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const allControls = writes.filter((entry) => entry.type === "control_request");
  expect(allControls).toHaveLength(2);
  expect((allControls[1]?.request as Record<string, unknown>)?.subtype).toBe("set_max_thinking_tokens");
  send(child!, { type: "control_response", response: { subtype: "success", request_id: allControls[1]?.request_id } });
  await applyPromise;
  bridge.stop();
});

test("Claude bridge backfills thinking budget when --effort is unsupported", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const spawnedArgs: string[][] = [];
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), (command, args, options) => {
    spawnedArgs.push(args);
    const spawned = new EventEmitter() as ChildProcessWithoutNullStreams;
    spawned.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    spawned.stdout = new PassThrough();
    spawned.stderr = new PassThrough();
    spawned.kill = () => true;
    child = spawned;
    return spawned;
  });
  bridge.configure({ model: "claude-sonnet-5", reasoningEffort: "medium", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  // The "claude-test" bin cannot prove --effort support, so the flag must be
  // omitted (fail closed) instead of killing startup like v1.0.123 did.
  expect(spawnedArgs[0]).not.toContain("--effort");
  const writes: Array<Record<string, unknown>> = [];
  const originalWrite = child!.stdin.write.bind(child!.stdin);
  child!.stdin.write = ((chunk: string, ...args: unknown[]) => {
    try { writes.push(JSON.parse(chunk.trim()) as Record<string, unknown>); } catch { /* test stream */ }
    return originalWrite(chunk, ...(args as []));
  }) as typeof child.stdin.write;
  await bridge.request("turn/start", { threadId: started.thread.id, input: "hello" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const controls = writes.filter((entry) => entry.type === "control_request");
  expect(controls).toHaveLength(1);
  expect((controls[0]?.request as Record<string, unknown>)?.subtype).toBe("set_max_thinking_tokens");
  expect((controls[0]?.request as Record<string, unknown>)?.max_thinking_tokens).toBe(8192);
  send(child!, { type: "control_response", response: { subtype: "success", request_id: controls[0]?.request_id } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Complete the turn, then start another: the budget must not be resent to
  // the same child generation.
  send(child!, { type: "system", subtype: "init", session_id: "session-budget" });
  send(child!, { type: "result", subtype: "success", session_id: "session-budget", is_error: false, result: "done" });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-budget", state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await bridge.request("turn/start", { threadId: started.thread.id, input: "again" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(writes.filter((entry) => entry.type === "control_request")).toHaveLength(1);
  bridge.stop();
});

test("Claude bridge requires each turn's own idle before completion", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "first" });
  send(child!, { type: "system", subtype: "init", session_id: "session-next-turn" });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-next-turn", state: "running" });
  send(child!, { type: "result", subtype: "success", session_id: "session-next-turn", is_error: false, result: "first done" });
  let history = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(history.thread.turns?.[0]?.status).toBe("running");
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-next-turn", state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await bridge.request("turn/start", { threadId: started.thread.id, input: "second" });
  send(child!, { type: "result", subtype: "success", session_id: "session-next-turn", is_error: false, result: "second done" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  history = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(history.thread.turns?.map((turn) => turn.status)).toEqual(["completed", "running"]);
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-next-turn", state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  history = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(history.thread.turns?.map((turn) => turn.status)).toEqual(["completed", "completed"]);
  bridge.stop();
});

test("Claude bridge keeps a native compact boundary inside the active turn", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const notifications: JsonRpcMessage[] = [];
  bridge.on("message", (message) => notifications.push(message));
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Continue the implementation" });
  const sessionId = "session-native-compaction";
  send(child!, { type: "system", subtype: "init", session_id: sessionId });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: sessionId, state: "running" });
  send(child!, {
    type: "system",
    subtype: "compact_boundary",
    session_id: sessionId,
    compact_metadata: { trigger: "auto", pre_tokens: 190_000 },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const startedItems = notifications.filter((message) => message.method === "item/started")
    .map((message) => (message as { params: { item?: Record<string, unknown> } }).params.item)
    .filter((item) => item?.type === "contextCompaction");
  expect(startedItems).toHaveLength(1);
  expect(startedItems[0]).toMatchObject({ status: "inProgress", cliBackend: "claude" });
  let history = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(history.thread.turns?.map((turn) => turn.status)).toEqual(["running"]);
  await expect(bridge.request("turn/start", { threadId: started.thread.id, input: "must not start a second turn" })).rejects.toThrow("Turn is already active");
  send(child!, { type: "result", subtype: "success", session_id: sessionId, is_error: false, result: "Implementation continued after compaction." });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: sessionId, state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const completedItems = notifications.filter((message) => message.method === "item/completed")
    .map((message) => (message as { params: { item?: Record<string, unknown> } }).params.item)
    .filter((item) => item?.type === "contextCompaction");
  expect(completedItems).toHaveLength(1);
  expect(completedItems[0]).toMatchObject({ status: "completed", cliBackend: "claude" });
  history = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(history.thread.turns?.map((turn) => turn.status)).toEqual(["completed"]);
  bridge.stop();
});

test("Claude bridge settles an open compaction card when the CLI exits", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const notifications: JsonRpcMessage[] = [];
  bridge.on("message", (message) => notifications.push(message));
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Long turn that will crash mid-compaction" });
  const sessionId = "session-compaction-crash";
  send(child!, { type: "system", subtype: "init", session_id: sessionId });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: sessionId, state: "running" });
  send(child!, {
    type: "system",
    subtype: "compact_boundary",
    session_id: sessionId,
    compact_metadata: { trigger: "auto", pre_tokens: 190_000 },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  child!.emit("exit", 1, null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const settled = notifications.filter((message) => message.method === "item/completed")
    .map((message) => (message as { params: { item?: Record<string, unknown> } }).params.item)
    .filter((item) => item?.type === "contextCompaction");
  expect(settled).toHaveLength(1);
  expect(settled[0]).toMatchObject({ status: "completed", cliBackend: "claude" });
  bridge.stop();
});

test("Claude bridge fails a background turn immediately when the CLI exits", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const bridge = new CodeCliBridge(() => ({ CODECLI_BIN: "claude-test", CODEX_UI_PORT: "43121", CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token" }), fakeSpawn((spawned) => { child = spawned; }));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  await bridge.request("turn/start", { threadId: started.thread.id, input: "Run a long package build" });
  send(child!, { type: "system", subtype: "init", session_id: "session-exit-build" });
  send(child!, { type: "system", subtype: "session_state_changed", session_id: "session-exit-build", state: "running" });
  send(child!, { type: "assistant", session_id: "session-exit-build", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "tool_use", id: "tool-exit-build", name: "Bash", input: { command: "bun run build", run_in_background: true } }] } });
  send(child!, { type: "result", subtype: "success", session_id: "session-exit-build", is_error: false, result: "Build started." });
  child!.emit("exit", 1, null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const parent = await bridge.request("thread/read", { threadId: started.thread.id, includeTurns: true }) as { thread: { turns?: Array<{ status?: string }> } };
  expect(parent.thread.turns?.[0]?.status).toBe("failed");
  bridge.stop();
});
