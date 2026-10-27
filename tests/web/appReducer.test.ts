import { expect, test } from "bun:test";
import { appReducer } from "../../apps/web/src/app/appReducer.ts";
import { initialClientState, type ClientState, type WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";
import { isReviewModeActive } from "../../apps/web/src/app/reviewTurn.ts";

test("thread started notifications preserve object-shaped runtime status", () => {
  const state = appReducer(initialClientState, {
    type: "notification",
    message: {
      method: "thread/started",
      params: { thread: { id: "thread-runtime", status: { type: "running" } } }
    } as never
  });

  expect(state.threads[0]).toMatchObject({ id: "thread-runtime", status: "running" });
});
function reviewStartedNotification(): ClientState {
  // 1) An item/completed carrying enteredReviewMode arrives before the
  //    review/start RPC response. projectRuntimeNotification keeps the
  //    zero-body review marker and applyNotificationPreservingActiveThread
  //    seeds the turn, so App state reflects an active review.
  const seeded: ClientState = { ...initialClientState, activeThreadId: "thread-main" };
  return appReducer(seeded, {
    type: "notification",
    message: {
      method: "item/completed",
      params: {
        threadId: "thread-main",
        turnId: "turn-review",
        item: { id: "entered", type: "enteredReviewMode", review: "Review changes", status: "completed" }
      }
    } as never
  });
}

function reviewStartTurn(): WorkbenchTurn {
  // 2) The review/start RPC response carries only a synthetic userMessage and
  //    no enteredReviewMode marker, plus running status.
  return {
    id: "turn-review",
    threadId: "thread-main",
    status: "inProgress",
    startedAt: 9000,
    items: [
      { id: "review-prompt", type: "userMessage", title: "", text: "Review changes", status: "completed" }
    ]
  };
}

test("threadTurnMerged preserves an earlier enteredReviewMode marker when the review/start response arrives late", () => {
  let state = reviewStartedNotification();
  const before = state.turns.find((turn) => turn.id === "turn-review");
  expect(before).toBeTruthy();
  expect(isReviewModeActive(before)).toBe(true, "enteredReviewMode should mark the turn active before RPC");

  state = appReducer(state, { type: "threadTurnMerged", turn: reviewStartTurn() });

  const turn = state.turns.find((entry) => entry.id === "turn-review");
  expect(turn).toBeTruthy();
  // The review-mode marker survives the merge - the send fast path still works.
  expect(isReviewModeActive(turn)).toBe(true, "threadTurnMerged must not erase enteredReviewMode");
  // The synthetic user item from the RPC response is now present.
  const user = turn?.items.find((item) => item.id === "review-prompt");
  expect(user?.type).toBe("userMessage");
  expect(user?.text).toBe("Review changes");
  // Running status from the RPC response is honored.
  expect(turn?.status).toBe("inProgress");
  // No duplicate items after the merge.
  const ids = turn?.items.map((item) => item.id) ?? [];
  expect(new Set(ids).size).toBe(ids.length);
  // The active thread is preserved.
  expect(state.activeThreadId).toBe("thread-main");
});

test("threadTurnReplaced (legacy semantics) clears the enteredReviewMode marker - documents the race", () => {
  // Identical setup, but the old replace semantics filter-and-replace, so the
  // earlier marker from notifications is dropped. This is the race being
  // fixed; kept as a regression guard against silently switching back.
  let state = reviewStartedNotification();
  expect(isReviewModeActive(state.turns.find((turn) => turn.id === "turn-review"))).toBe(true);

  state = appReducer(state, { type: "threadTurnReplaced", turn: reviewStartTurn() });

  const turn = state.turns.find((entry) => entry.id === "turn-review");
  expect(turn).toBeTruthy();
  expect(isReviewModeActive(turn)).toBe(false, "replace semantics intentionally erase the marker");
  // The synthetic user item is still landed via replace.
  expect(turn?.items.some((item) => item.id === "review-prompt")).toBe(true);
});

test("threadTurnMerged is idempotent when dispatched twice with the same review-start turn", () => {
  let state = appReducer(reviewStartedNotification(), { type: "threadTurnMerged", turn: reviewStartTurn() });
  const firstIds = state.turns.find((turn) => turn.id === "turn-review")?.items.map((item) => item.id) ?? [];
  state = appReducer(state, { type: "threadTurnMerged", turn: reviewStartTurn() });
  const secondIds = state.turns.find((turn) => turn.id === "turn-review")?.items.map((item) => item.id) ?? [];
  expect(secondIds).toEqual(firstIds);
  expect(new Set(secondIds).size).toBe(secondIds.length);
});

test("threadTurnMerged preserves exitedReviewMode so isReviewModeActive clears once review finishes", () => {
  let state = reviewStartedNotification();
  state = appReducer(state, { type: "threadTurnMerged", turn: reviewStartTurn() });
  expect(isReviewModeActive(state.turns.find((turn) => turn.id === "turn-review"))).toBe(true);

  state = appReducer(state, {
    type: "notification",
    message: {
      method: "item/completed",
      params: {
        threadId: "thread-main",
        turnId: "turn-review",
        item: { id: "exited", type: "exitedReviewMode", review: "Review changes", status: "completed" }
      }
    } as never
  });
  const turn = state.turns.find((entry) => entry.id === "turn-review");
  expect(turn?.items.some((item) => item.type === "exitedReviewMode")).toBe(true);
  expect(isReviewModeActive(turn)).toBe(false, "exitedReviewMode must end the active review");
});
