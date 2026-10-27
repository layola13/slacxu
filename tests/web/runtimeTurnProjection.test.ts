import { expect, test } from "bun:test";
import {
  projectRuntimeNotification,
  projectRuntimeNotifications,
  projectRuntimeTurn,
  projectRuntimeTurns
} from "../../apps/web/src/app/transcripts/runtimeTurnProjection.ts";
import { isReviewModeActive } from "../../apps/web/src/app/reviewTurn.ts";
import type { WorkbenchItem, WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";

function turn(id: string, threadId: string, items: WorkbenchItem[]): WorkbenchTurn {
  return { id, threadId, status: "inProgress", startedAt: 1, items };
}

test("projectRuntimeNotification keeps item/completed enteredReviewMode as a zero-body item", () => {
  const projected = projectRuntimeNotification({
    method: "item/completed",
    params: {
      threadId: "thread-main",
      turnId: "review-turn",
      item: { id: "entered", type: "enteredReviewMode", review: "Review changes", status: "completed" }
    }
  });
  expect(projected).not.toBeNull();
  const params = (projected as { params: { item: WorkbenchItem } }).params.item;
  expect(params.type).toBe("enteredReviewMode");
  expect(params.id).toBe("entered");
});

test("projectRuntimeNotification drops unrelated payload from review-mode items", () => {
  const projected = projectRuntimeNotification({
    method: "item/completed",
    params: {
      threadId: "thread-main",
      turnId: "review-turn",
      item: { id: "exited", type: "exitedReviewMode", review: "Review changes", status: "completed", reason: "done" }
    }
  });
  expect(projected).not.toBeNull();
  const params = (projected as { params: { item: WorkbenchItem } }).params.item;
  expect(params.type).toBe("exitedReviewMode");
  expect("review" in params).toBe(false);
});

test("projectRuntimeTurn keeps review-mode items so isReviewModeActive returns true", () => {
  const runtime = projectRuntimeTurn(turn("review-turn", "thread-main", [
    { id: "entered", type: "enteredReviewMode", title: "", text: "", status: "completed",
      review: "Review changes" } as unknown as WorkbenchItem
  ]));
  expect(isReviewModeActive(runtime)).toBe(true);
  expect(runtime.items.some((item) => item.type === "enteredReviewMode")).toBe(true);
});

test("projectRuntimeTurn clears active review after exitedReviewMode is reached", () => {
  const runtime = projectRuntimeTurn(turn("review-turn", "thread-main", [
    { id: "entered", type: "enteredReviewMode", title: "", text: "", status: "completed",
      review: "Review changes" } as unknown as WorkbenchItem,
    { id: "exited", type: "exitedReviewMode", title: "", text: "", status: "completed",
      review: "Review changes" } as unknown as WorkbenchItem
  ]));
  expect(isReviewModeActive(runtime)).toBe(false);
});

test("projectRuntimeNotification drops payload-only review items from non item methods", () => {
  const projected = projectRuntimeNotification({
    method: "turn/started",
    params: { threadId: "thread-main", turnId: "review-turn", turn: { id: "review-turn", status: "inProgress" } }
  });
  expect(projected).not.toBeNull();
  expect((projected as { params: { turn: { id: string } } }).params.turn.id).toBe("review-turn");
});

test("projectRuntimeNotifications preserves runtime lifecycle for live activity and userMessage items", () => {
  const projected = projectRuntimeNotifications([
    { method: "item/agentMessage/delta", params: { threadId: "thread-main", turnId: "review-turn",
      itemId: "agent-answer", delta: "Checking", firstTokenAt: 10 } },
    { method: "item/completed", params: { threadId: "thread-main", turnId: "review-turn",
      item: { id: "entered", type: "enteredReviewMode", review: "Review changes", status: "completed" } } }
  ]);
  expect(projected.length).toBe(2);
  expect(projected[0]?.method).toBe("turn/started");
  expect(projected[1]?.method).toBe("item/completed");
});

test("projectRuntimeNotifications reactivates a historical turn on first streamed activity", () => {
  const projected = projectRuntimeNotification({
    method: "item/agentMessage/delta",
    params: { threadId: "thread-main", turnId: "turn-next", itemId: "answer", delta: "Thinking" }
  });
  expect(projected).toEqual({
    method: "turn/started",
    params: {
      threadId: "thread-main",
      runtimeActivityReactivation: true,
      turn: { id: "turn-next", threadId: "thread-main", status: "inProgress" }
    }
  });
});

test("projectRuntimeNotifications skips turn/started when turn is already in-progress", () => {
  const projected = projectRuntimeNotification({
    method: "item/agentMessage/delta",
    params: { threadId: "thread-main", turnId: "turn-running", itemId: "answer", delta: "Thinking" }
  }, { inProgressTurnIds: new Set(["turn-running"]) });
  expect(projected).toBeNull();

  const batch = projectRuntimeNotifications([
    { method: "item/agentMessage/delta", params: { threadId: "thread-main", turnId: "turn-1", itemId: "a", delta: "1" } },
    { method: "item/agentMessage/delta", params: { threadId: "thread-main", turnId: "turn-1", itemId: "a", delta: "2" } },
    { method: "item/agentMessage/delta", params: { threadId: "thread-main", turnId: "turn-1", itemId: "a", delta: "3" } }
  ]);
  // Only the first delta reactivates; the remaining deltas in the batch are skipped
  expect(batch).toHaveLength(1);
  expect(batch[0]?.method).toBe("turn/started");
});

test("projectRuntimeNotification recovers underscored turn id and active thread context", () => {
  const projected = projectRuntimeNotification({
    method: "item/agentMessage/delta",
    params: { turn_id: "turn-underscore", item: { id: "answer", turn_id: "turn-underscore" }, delta: "Thinking" }
  }, { activeThreadId: "thread-active" });
  expect(projected).toEqual({
    method: "turn/started",
    params: {
      threadId: "thread-active",
      runtimeActivityReactivation: true,
      turn: { id: "turn-underscore", threadId: "thread-active", status: "inProgress" }
    }
  });
});

test("projectRuntimeNotification restores thread id from underscored turn payload", () => {
  const projected = projectRuntimeNotification({
    method: "turn/started",
    params: { turn: { id: "turn-started", thread_id: "thread-started", status: "inProgress" } }
  });
  expect(projected).toEqual({
    method: "turn/started",
    params: {
      threadId: "thread-started",
      turnId: "turn-started",
      turn: { id: "turn-started", thread_id: "thread-started", status: "inProgress", threadId: "thread-started" }
    }
  });
});
