import { expect, test } from "bun:test";
import {
  buildGoalContinuationPrompt,
  GOAL_CONTINUATION_MARKER,
  isGoalContinuationPrompt,
  observeTurnStarted,
} from "../../apps/web/src/goalContinuation";

test("recognizes legacy UI goal continuation prompts without generating new ones", () => {
  expect(isGoalContinuationPrompt(`${GOAL_CONTINUATION_MARKER}\nContinue the active goal`)).toBe(true);
  expect(isGoalContinuationPrompt("Continue the migration")).toBe(false);
});

test("builds a hidden continuation prompt with the persisted objective", () => {
  const prompt = buildGoalContinuationPrompt("  finish the Windows regression  ");
  expect(prompt).toBe(`${GOAL_CONTINUATION_MARKER}\nContinue working toward this persisted /goal objective:\n\nfinish the Windows regression`);
});

test("waits for the matching turn/started notification even when it arrives before the RPC result", async () => {
  const source = new EventTarget();
  const waiter = observeTurnStarted(source, "thread-1", 1_000);

  emitServerMessage(source, "turn/started", {
    threadId: "thread-2",
    turn: { id: "wrong-thread" }
  });
  emitServerMessage(source, "turn/started", {
    threadId: "thread-1",
    turn: { id: "turn-1" }
  });

  await expect(waiter.waitFor("turn-1")).resolves.toBe("turn-1");
  waiter.dispose();
});

test("does not resolve until the expected turn starts", async () => {
  const source = new EventTarget();
  const waiter = observeTurnStarted(source, "thread-1", 1_000);
  const started = waiter.waitFor("turn-expected");

  emitServerMessage(source, "turn/started", {
    threadId: "thread-1",
    turn: { id: "turn-other" }
  });
  emitServerMessage(source, "turn/started", {
    threadId: "thread-1",
    turn: { id: "turn-expected" }
  });

  await expect(started).resolves.toBe("turn-expected");
  waiter.dispose();
});

function emitServerMessage(source: EventTarget, method: string, params: unknown): void {
  const event = new Event("server-message") as Event & { detail?: unknown };
  event.detail = {
    type: "codex.notification",
    message: { method, params }
  };
  source.dispatchEvent(event);
}
