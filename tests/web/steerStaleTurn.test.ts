import { expect, test } from "bun:test";
import {
  extractActualActiveTurnId,
  isAlreadyStoppedInterruptError,
  isTurnNoLongerActiveError,
} from "../../apps/web/src/app/turnInterruptRetry.ts";
import { isCannotSteerReviewTurnError } from "../../apps/web/src/app/reviewTurn.ts";

test("stale steer targets are recognized, including CUX-wrapped errors", () => {
  expect(isTurnNoLongerActiveError(new Error("No active turn"))).toBe(true);
  expect(isTurnNoLongerActiveError({
    code: -32000,
    message: "CUX-RPC-LOCAL-001 execution=local stage=rpc method=turn/steer thread=85433cd1 cause=No active turn",
  })).toBe(true);
  expect(isTurnNoLongerActiveError(new Error("Turn is already active: abc"))).toBe(false);
});

test("review-turn refusals are not treated as gone turns", () => {
  // 服务端/其他后端的 review 拒绝文案（顺序为 cannot steer ... review turn）
  expect(isCannotSteerReviewTurnError(new Error("cannot steer review turn"))).toBe(true);
  expect(isTurnNoLongerActiveError(new Error("cannot steer a review turn"))).toBe(false);
  // 客户端 steerOnly + review 时的本地抛错也不能被当成 turn 消失
  const localReviewError = new Error("This review turn cannot be steered. Queue the message instead.");
  expect(isTurnNoLongerActiveError(localReviewError)).toBe(false);
});

test("already-stopped interrupts stay silent", () => {
  expect(isAlreadyStoppedInterruptError(new Error("No active turn"))).toBe(true);
  expect(extractActualActiveTurnId(new Error("Expected active turn id 'aaaaaaaa-1111-2222-3333-444444444444' but found 'bbbbbbbb-1111-2222-3333-444444444444'")))
    .toBe("bbbbbbbb-1111-2222-3333-444444444444");
});
