import { expect, test } from "bun:test";
import { isCannotSteerReviewTurnError, isReviewModeActive } from "../../apps/web/src/app/reviewTurn";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient";

function turn(items: WorkbenchTurn["items"]): WorkbenchTurn {
  return { id: "turn-review", threadId: "thread-review", status: "inProgress", items };
}

test("tracks entered and exited review mode in turn order", () => {
  expect(isReviewModeActive(turn([{ id: "enter", type: "enteredReviewMode", title: "Entered", text: "Review changes" }]))).toBe(true);
  expect(isReviewModeActive(turn([
    { id: "enter", type: "enteredReviewMode", title: "Entered", text: "Review changes" },
    { id: "exit", type: "exitedReviewMode", title: "Exited", text: "Review complete" }
  ]))).toBe(false);
});

test("recognizes review turns that reject steering", () => {
  expect(isCannotSteerReviewTurnError({ message: "cannot steer a review turn" })).toBe(true);
  expect(isCannotSteerReviewTurnError(new Error("turn id changed"))).toBe(false);
});
