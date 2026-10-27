import { expect, test } from "bun:test";
import { getConversationStatus, hasConversationWork } from "../../apps/web/src/app/conversationStatus.ts";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";

const runningTurn: WorkbenchTurn = {
  id: "turn-new",
  threadId: "thread-new",
  status: "inProgress",
  items: [],
};

test("new conversation is connecting while thread/start has no thread id yet", () => {
  expect(hasConversationWork(null, null, new Set(), true)).toBe(true);
  expect(getConversationStatus(true, "ready", true, false, true)).toBe("connecting");
});
test("a pending new conversation has no interruptible turn until turn/started", () => {
  expect(hasConversationWork(null, null, new Set(), true)).toBe(true);
  expect(hasConversationWork(null, undefined, new Set(), false)).toBe(false);
});
test("newly accepted conversation is working before turn/started arrives", () => {
  expect(hasConversationWork("thread-new", null, new Set(["thread-new"]))).toBe(true);
  expect(getConversationStatus(true, "ready", true)).toBe("working");
});

test("new conversation remains working after turn/started and becomes idle only at terminal state", () => {
  expect(hasConversationWork("thread-new", runningTurn, new Set())).toBe(true);
  expect(getConversationStatus(true, "ready", true)).toBe("working");
  expect(hasConversationWork("thread-new", null, new Set())).toBe(false);
  expect(getConversationStatus(true, "ready", false)).toBe("idle");
});

test("pending work from another thread never marks the selected new conversation working", () => {
  expect(hasConversationWork("thread-new", null, new Set(["thread-old"]))).toBe(false);
});

test("connection, engine, and interrupt retry status retain priority over a new conversation", () => {
  expect(getConversationStatus(false, "ready", true, false, true)).toBe("disconnect");
  expect(getConversationStatus(true, "starting", true, false, true)).toBe("retrying");
  expect(getConversationStatus(true, "error", true, false, true)).toBe("engine-error");
  expect(getConversationStatus(true, "ready", true, true, true)).toBe("retrying");
});
