import { expect, test } from "bun:test";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";
import { findReconciledSendTurn, isAmbiguousSendError } from "../../apps/web/src/composer/sendReconcile.ts";

function runningTurn(id: string, threadId: string, text: string, startedAtSec: number): WorkbenchTurn {
  return {
    id, threadId, status: "running", startedAt: startedAtSec,
    items: [{ id: `user-${id}`, type: "userMessage", title: "User", text, status: "completed" }],
  };
}

test("detects rpc timeouts and websocket drops as ambiguous", () => {
  expect(isAmbiguousSendError({ code: -32001, message: "Request 'turn/start' timed out after 20s" })).toBe(true);
  expect(isAmbiguousSendError(new Error("WebSocket disconnected"))).toBe(true);
  expect(isAmbiguousSendError({ code: -32001, message: "timed out" })).toBe(true);
});

test("does not treat definite failures as ambiguous", () => {
  expect(isAmbiguousSendError(new Error("Turn is already active: t1"))).toBe(false);
  expect(isAmbiguousSendError({ code: -32000, message: "send failed" })).toBe(false);
  expect(isAmbiguousSendError(null)).toBe(false);
  expect(isAmbiguousSendError("boom")).toBe(false);
});

test("reconciles a turn that landed after the client gave up", () => {
  const sendStartedAt = Date.now();
  const startedAtSec = Math.floor(sendStartedAt / 1000) + 1;
  const turns: WorkbenchTurn[] = [runningTurn("turn-new", "thread-1", "hi", startedAtSec)];
  expect(findReconciledSendTurn(turns, "thread-1", "hi", sendStartedAt)).toBe("turn-new");
});

test("ignores turns from other threads, completed turns, and old turns", () => {
  const sendStartedAt = Date.now();
  const freshSec = Math.floor(sendStartedAt / 1000) + 1;
  const oldSec = Math.floor((sendStartedAt - 60_000) / 1000);
  const turns: WorkbenchTurn[] = [
    runningTurn("turn-other-thread", "thread-2", "hi", freshSec),
    { ...runningTurn("turn-done", "thread-1", "hi", freshSec), status: "completed" },
    runningTurn("turn-old", "thread-1", "hi", oldSec),
    runningTurn("turn-other-text", "thread-1", "hello world", freshSec),
  ];
  expect(findReconciledSendTurn(turns, "thread-1", "hi", sendStartedAt)).toBeNull();
});

test("returns null for empty input", () => {
  expect(findReconciledSendTurn([], "thread-1", "   ", Date.now())).toBeNull();
});
