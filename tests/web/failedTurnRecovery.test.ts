import { describe, expect, test } from "bun:test";
import {
  isPollutingErrorText,
  planForkCleanRecovery,
  shouldExcludeItemFromResend,
} from "../../apps/web/src/app/transcripts/failedTurnRecovery";

describe("failedTurnRecovery", () => {
  test("detects stream-retry pollution text", () => {
    expect(isPollutingErrorText("stream connection failed; waiting to retry turn_id=abc error=Connection failed")).toBe(true);
    expect(isPollutingErrorText("task abc didn't complete gracefully after 100ms")).toBe(true);
    expect(isPollutingErrorText("Selected model is at capacity")).toBe(false);
    expect(shouldExcludeItemFromResend("retryError", "anything")).toBe(true);
    expect(shouldExcludeItemFromResend("agentMessage", "stream connection failed")).toBe(true);
    expect(shouldExcludeItemFromResend("agentMessage", "normal answer")).toBe(false);
  });

  test("plans fork-clean from the last healthy turn and preserves the failed prompt", () => {
    const plan = planForkCleanRecovery(
      [
        { id: "t1", threadId: "th", status: "completed", items: [{ id: "u1", type: "userMessage", text: "first" }] },
        {
          id: "t2",
          threadId: "th",
          status: "inProgress",
          items: [
            { id: "u2", type: "userMessage", text: "do the thing" },
            { id: "retry-error-t2", type: "retryError", text: "stream connection failed; waiting to retry", status: "running" },
          ],
        },
      ],
      "t2",
    );
    expect(plan.forkFromTurnId).toBe("t1");
    expect(plan.failedTurnIds).toEqual(["t2"]);
    expect(plan.resendText).toBe("do the thing");
    expect(plan.reason).toBe("active-turn-polluted");
  });

  test("returns no-failed-turn when history is healthy", () => {
    const plan = planForkCleanRecovery([
      { id: "t1", threadId: "th", status: "completed", items: [] },
    ]);
    expect(plan.forkFromTurnId).toBeNull();
    expect(plan.reason).toBe("no-failed-turn");
  });
});
