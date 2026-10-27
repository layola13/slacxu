import { describe, expect, test } from "bun:test";
import { parseGoalObjectiveWithBudget } from "../../apps/web/src/app/goals/goalState";

describe("parseGoalObjectiveWithBudget", () => {
  test("bare leading numbers stay part of the objective (no silent budget)", () => {
    expect(parseGoalObjectiveWithBudget("5 files need renaming")).toEqual({
      objective: "5 files need renaming",
    });
    expect(parseGoalObjectiveWithBudget("3 steps to refactor")).toEqual({
      objective: "3 steps to refactor",
    });
    // Even a k-suffixed bare token without @ is kept verbatim: pre-budget
    // `/goal <text>` behavior is fully preserved.
    expect(parseGoalObjectiveWithBudget("200k files to rename")).toEqual({
      objective: "200k files to rename",
    });
  });

  test("explicit @ prefix sets the budget", () => {
    expect(parseGoalObjectiveWithBudget("@200k rename files")).toEqual({
      objective: "rename files",
      tokenBudget: 200_000,
    });
    expect(parseGoalObjectiveWithBudget("@1.5M big task")).toEqual({
      objective: "big task",
      tokenBudget: 1_500_000,
    });
    expect(parseGoalObjectiveWithBudget("@50000 small task")).toEqual({
      objective: "small task",
      tokenBudget: 50000,
    });
  });

  test("degenerate input never produces a budget", () => {
    expect(parseGoalObjectiveWithBudget("")).toEqual({ objective: "" });
    // Malformed budget attempts surface the usage error (empty objective),
    // never a literal "@…" objective.
    expect(parseGoalObjectiveWithBudget("@200k")).toEqual({ objective: "" });
    expect(parseGoalObjectiveWithBudget("@0 x")).toEqual({ objective: "" });
    expect(parseGoalObjectiveWithBudget("@99999999 obj")).toEqual({ objective: "" });
    expect(parseGoalObjectiveWithBudget("@-5 x")).toEqual({ objective: "" });
    // Genuine @-mentions are untouched.
    expect(parseGoalObjectiveWithBudget("@someone review this")).toEqual({
      objective: "@someone review this",
    });
  });
});
