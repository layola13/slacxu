import { expect, test } from "bun:test";
import {
  GOAL_CONTINUATION_MARKER,
  goalContinuationTurnParams,
  planAnswers,
  planTurnParams,
  runningTurnIds
} from "../../apps/server/src/codexModeApi";

test("builds a full-auto Plan turn without mutating default chat mode", () => {
  const params = planTurnParams({ threadId: "thread-plan", prompt: "Plan this", model: "gpt-test", cwd: "C:\\work" });
  expect(params.approvalPolicy).toBe("never");
  expect(params.sandboxPolicy).toEqual({ type: "dangerFullAccess" });
  expect((params.collaborationMode as { mode: string }).mode).toBe("plan");
});

test("normalizes Plan list selections into request_user_input answers", () => {
  expect(planAnswers({ answers: { approach: { answers: ["Careful"] }, empty: { answers: [] } } })).toEqual({
    answers: { approach: { answers: ["Careful"] }, empty: { answers: [] } }
  });
});

test("builds a full-auto Goal continuation and finds running turns to pause", () => {
  const params = goalContinuationTurnParams({ threadId: "thread-goal", model: "gpt-test", effort: "high" }, "Finish it");
  expect(params.approvalPolicy).toBe("never");
  expect(((params.input as Array<{ text: string }>)[0]?.text)).toStartWith(GOAL_CONTINUATION_MARKER);
  expect(runningTurnIds({ turns: [
    { id: "a", status: "inProgress" },
    { id: "b", status: "completed" },
    { id: "c", status: "running" }
  ] })).toEqual(["a", "c"]);
});
