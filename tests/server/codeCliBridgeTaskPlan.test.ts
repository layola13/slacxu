import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { expect, test } from "bun:test";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { JsonRpcMessage } from "@codex-ui/shared";
import { CodeCliBridge } from "../../apps/server/src/codeCliBridge";

type Notification = { method: string; params: Record<string, unknown> };

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

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function startBridge(): Promise<{
  bridge: CodeCliBridge;
  child: ChildProcessWithoutNullStreams;
  threadId: string;
  notifications: Notification[];
  snapshots: unknown[];
}> {
  let child: ChildProcessWithoutNullStreams | undefined;
  const snapshots: unknown[] = [];
  const bridge = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43122",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), fakeSpawn((spawned) => { child = spawned; }), undefined, undefined, (snapshot) => snapshots.push(snapshot));
  bridge.configure({ model: "claude-sonnet-5", providerId: "gateai", groupId: "group-claude", cwd: process.cwd() });

  const notifications: Notification[] = [];
  bridge.on("message", (message: JsonRpcMessage) => notifications.push(message as unknown as Notification));
  const started = await bridge.request("thread/start", {}) as { thread: { id: string } };
  const threadId = started.thread.id;
  await bridge.request("turn/start", { threadId, input: "Plan the work" });
  send(child!, { type: "system", subtype: "init", session_id: "session-plan" });
  await flush();
  return { bridge, child: child!, threadId, notifications, snapshots };
}

function assistantToolUse(uuid: string, blocks: unknown[]): unknown {
  return {
    type: "assistant",
    session_id: "session-plan",
    uuid,
    parent_tool_use_id: null,
    message: { role: "assistant", id: "msg-" + uuid, content: blocks },
  };
}

function planItems(notifications: Notification[]): Array<Record<string, unknown>> {
  return notifications
    .filter((entry) => entry.method === "item/completed")
    .map((entry) => entry.params.item as Record<string, unknown>)
    .filter((item) => item?.type === "plan");
}

function toolCallNames(notifications: Notification[]): string[] {
  return notifications
    .filter((entry) => entry.method === "item/started" || entry.method === "item/completed")
    .map((entry) => entry.params.item as Record<string, unknown>)
    .filter((item) => item?.type === "toolCall")
    .map((item) => String(item.toolName));
}

test("Claude bridge projects TaskCreate/TaskUpdate as a Codex-shaped plan", async () => {
  const { bridge, child, threadId, notifications } = await startBridge();

  send(child, assistantToolUse("assistant-create", [
    { type: "tool_use", id: "tool-create-1", name: "TaskCreate", input: { subject: "Fix resume", description: "…" } },
    { type: "tool_use", id: "tool-create-2", name: "TaskCreate", input: { subject: "Render plan", description: "…" } },
  ]));
  await flush();

  const created = planItems(notifications).at(-1);
  expect(created?.threadId).toBe(threadId);
  expect(created?.status).toBe("pending");
  expect(created?.plan).toEqual([
    { step: "Fix resume", status: "pending", key: "tool-create-1" },
    { step: "Render plan", status: "pending", key: "tool-create-2" },
  ]);
  expect(created?.text).toBe("- [ ] Fix resume\n- [ ] Render plan");
  // The checklist replaces the tool rows rather than doubling them up.
  expect(toolCallNames(notifications)).toEqual([]);

  send(child, {
    type: "user",
    session_id: "session-plan",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tool-create-1", content: "Task #1 created successfully: Fix resume" },
        { type: "tool_result", tool_use_id: "tool-create-2", content: "Task #2 created successfully: Render plan" },
      ],
    },
  });
  await flush();
  expect(toolCallNames(notifications)).toEqual([]);

  send(child, assistantToolUse("assistant-update", [
    { type: "tool_use", id: "tool-update-1", name: "TaskUpdate", input: { taskId: "1", status: "in_progress" } },
  ]));
  await flush();

  const started = planItems(notifications).at(-1);
  expect(started?.status).toBe("inProgress");
  expect(started?.plan).toEqual([
    { step: "Fix resume", status: "in_progress", key: "tool-create-1", taskId: "1" },
    { step: "Render plan", status: "pending", key: "tool-create-2", taskId: "2" },
  ]);
  expect(started?.text).toBe("- [ ] Fix resume _(in progress)_\n- [ ] Render plan");
  // Every revision lands on one item, so the waterfall shows a single checklist.
  expect(started?.id).toBe(planItems(notifications)[0]!.id);

  send(child, assistantToolUse("assistant-finish", [
    { type: "tool_use", id: "tool-update-2", name: "TaskUpdate", input: { taskId: "1", status: "completed" } },
    { type: "tool_use", id: "tool-update-3", name: "TaskUpdate", input: { taskId: "2", status: "deleted" } },
  ]));
  await flush();

  const finished = planItems(notifications).at(-1);
  expect(finished?.status).toBe("completed");
  expect(finished?.text).toBe("- [x] Fix resume");
  bridge.stop();
});

test("Claude bridge projects TodoWrite as a plan and keeps unknown task payloads visible", async () => {
  const { bridge, child, notifications } = await startBridge();

  send(child, assistantToolUse("assistant-todo", [
    {
      type: "tool_use",
      id: "tool-todo",
      name: "TodoWrite",
      input: {
        todos: [
          { content: "Read the runtime", status: "completed", activeForm: "Reading the runtime" },
          { content: "Patch the projector", status: "in_progress", activeForm: "Patching the projector" },
          { content: "Add tests", status: "pending", activeForm: "Adding tests" },
        ],
      },
    },
  ]));
  await flush();

  const plan = planItems(notifications).at(-1);
  expect(plan?.status).toBe("inProgress");
  expect(plan?.text).toBe("- [x] Read the runtime\n- [ ] Patch the projector _(in progress)_\n- [ ] Add tests");

  // A payload the projector cannot read must not vanish from the transcript.
  send(child, assistantToolUse("assistant-unknown", [
    { type: "tool_use", id: "tool-todo-empty", name: "TodoWrite", input: { unexpected: true } },
  ]));
  await flush();
  expect(toolCallNames(notifications)).toEqual(["TodoWrite"]);
  bridge.stop();
});

test("Claude bridge restores plan state so a reopened thread keeps one checklist", async () => {
  const first = await startBridge();
  send(first.child, assistantToolUse("assistant-create", [
    { type: "tool_use", id: "tool-create-1", name: "TaskCreate", input: { subject: "Fix resume" } },
    { type: "tool_use", id: "tool-create-2", name: "TaskCreate", input: { subject: "Render plan" } },
  ]));
  await flush();
  send(first.child, {
    type: "user",
    session_id: "session-plan",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tool-create-2", content: "Task #2 created successfully: Render plan" }],
    },
  });
  await flush();
  const snapshot = first.bridge.getSessionSnapshot(first.threadId)!;
  first.bridge.stop();

  let reopenedChild: ChildProcessWithoutNullStreams | undefined;
  const reopened = new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43122",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
  }), fakeSpawn((spawned) => { reopenedChild = spawned; }));
  reopened.restoreSession(snapshot);
  const notifications: Notification[] = [];
  reopened.on("message", (message: JsonRpcMessage) => notifications.push(message as unknown as Notification));
  await reopened.request("turn/start", { threadId: first.threadId, input: "Continue" });
  send(reopenedChild!, { type: "system", subtype: "init", session_id: "session-plan-2" });
  await flush();

  send(reopenedChild!, assistantToolUse("assistant-resume-update", [
    { type: "tool_use", id: "tool-update-1", name: "TaskUpdate", input: { taskId: "2", status: "completed" } },
  ]));
  await flush();

  const plan = planItems(notifications).at(-1);
  expect(plan?.text).toBe("- [ ] Fix resume\n- [x] Render plan");
  reopened.stop();
});
