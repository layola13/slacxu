import { describe, expect, test } from "bun:test";
import {
  MAX_MINI_BUDGET_EXCUSE_CORRECTIONS,
  MAX_MINI_CODE_INTENT_CONTINUATIONS,
  MINI_BUDGET_EXCUSE_RE,
  MINI_CODE_INTENT_RE,
  MINI_PLAN_AWARE_SUMMARY_RULE,
  miniBudgetExcuseCorrection,
  miniCodeIntentCorrection,
  miniUnknownToolError,
} from "../../backends/mini/src/runtime/miniBridge.ts";

describe("mini budget-excuse guard (幻觉预算回归)", () => {
  test("detects Chinese budget excuses from the reported screenshot", () => {
    expect(MINI_BUDGET_EXCUSE_RE.test("说明：受本轮工具预算限制，第2-5步尚未完成")).toBe(true);
    expect(MINI_BUDGET_EXCUSE_RE.test("工具预算已用尽，无法继续")).toBe(true);
    expect(MINI_BUDGET_EXCUSE_RE.test("受到轮数限制，只能做到这里")).toBe(true);
    expect(MINI_BUDGET_EXCUSE_RE.test("token budget exceeded, stopping")).toBe(true);
  });

  test("detects English budget excuses", () => {
    expect(MINI_BUDGET_EXCUSE_RE.test("I hit the tool-call budget limit, stopping here")).toBe(true);
    expect(MINI_BUDGET_EXCUSE_RE.test("budget reached, remaining steps skipped")).toBe(true);
    expect(MINI_BUDGET_EXCUSE_RE.test("ran out of tool calls")).toBe(true);
    expect(MINI_BUDGET_EXCUSE_RE.test("round limit hit")).toBe(true);
  });

  test("does not flag normal summaries or capacity errors", () => {
    expect(MINI_BUDGET_EXCUSE_RE.test("Done: ran 5 tool call(s), all steps completed.")).toBe(false);
    expect(MINI_BUDGET_EXCUSE_RE.test("Selected model is at capacity")).toBe(false);
    expect(MINI_BUDGET_EXCUSE_RE.test("")).toBe(false);
    expect(miniBudgetExcuseCorrection("Done, all finished.")).toBeNull();
  });

  test("correction points to a useful next action only before safety caps", () => {
    const fix = miniBudgetExcuseCorrection("受本轮工具预算限制，剩下以后再说");
    expect(fix).not.toBeNull();
    expect(fix!).toContain("configured turn safety limit still has room");
    expect(fix!).toContain("smallest useful tool call");
  });

  test("corrections are capped per turn so a stubborn model cannot burn forever", () => {
    expect(MAX_MINI_BUDGET_EXCUSE_CORRECTIONS).toBeGreaterThanOrEqual(1);
    expect(MAX_MINI_BUDGET_EXCUSE_CORRECTIONS).toBeLessThanOrEqual(5);
  });

  test("summary rule states that turn safety limits are finite", () => {
    expect(MINI_PLAN_AWARE_SUMMARY_RULE).toContain("safety limits are finite");
    expect(MINI_PLAN_AWARE_SUMMARY_RULE).toContain("report any remaining work honestly");
  });

  test("explicit no-tool requests do not bypass the hard round and input budgets", async () => {
    const source = await Bun.file(
      new URL("../../backends/mini/src/runtime/miniBridge.ts", import.meta.url),
    ).text();
    expect(source).toContain("if (!budgetWrapUp && miniTurnCapTripped(rounds, totalToolCalls, turnLimits))");
    expect(source).toContain("if (!budgetWrapUp) {");
    expect(source).not.toContain("!budgetWrapUp && !noToolRequested");
  });
});

describe("mini code-intent continuation (说了要改却没落盘)", () => {
  test("detects Chinese modification intent without a tool call", () => {
    expect(MINI_CODE_INTENT_RE.test("我已经确认改动点，接下来我将修改 A 和 B")).toBe(true);
    expect(MINI_CODE_INTENT_RE.test("准备为文件添加错误处理")).toBe(true);
    expect(MINI_CODE_INTENT_RE.test("让我来修复这个竞态")).toBe(true);
    expect(MINI_CODE_INTENT_RE.test("现在就改")).toBe(true);
  });

  test("detects English modification intent", () => {
    expect(MINI_CODE_INTENT_RE.test("I'll now modify the handler")).toBe(true);
    expect(MINI_CODE_INTENT_RE.test("Let me fix the race condition")).toBe(true);
    expect(MINI_CODE_INTENT_RE.test("Next, I will update the config")).toBe(true);
  });

  test("does not flag plain summaries or budget excuses", () => {
    expect(MINI_CODE_INTENT_RE.test("Done: ran 5 tool call(s), all steps completed.")).toBe(false);
    expect(MINI_CODE_INTENT_RE.test("改动已完成，总结如下")).toBe(false);
    expect(MINI_CODE_INTENT_RE.test("")).toBe(false);
    expect(miniCodeIntentCorrection("All done, nothing to change.")).toBeNull();
  });

  test("correction requests implementation within permissions and permits an honest blocker", () => {
    const fix = miniCodeIntentCorrection("接下来我将修改登录逻辑");
    expect(fix).not.toBeNull();
    expect(fix!).toContain("sa_vm");
    expect(fix!).toContain("apply_patch");
    expect(fix!).toContain("When permitted");
    expect(fix!).toContain("execution is blocked");
    expect(fix!).not.toContain("ask for permission");
  });

  test("continuations are capped per turn", () => {
    expect(MAX_MINI_CODE_INTENT_CONTINUATIONS).toBeGreaterThanOrEqual(1);
    expect(MAX_MINI_CODE_INTENT_CONTINUATIONS).toBeLessThanOrEqual(5);
  });
});

describe("mini unknown-tool recovery hint", () => {
  test("sa_vm actions get the exact retry shape", () => {
    expect(miniUnknownToolError("apply_patch")).toContain('{"action":"apply_patch"');
    expect(miniUnknownToolError("write_file")).toContain("sa_vm");
    expect(miniUnknownToolError("read_file")).toContain("workspace-relative path");
  });

  test("shell spellings point at the run_host allowlist", () => {
    expect(miniUnknownToolError("bash")).toContain("run_host");
    expect(miniUnknownToolError("powershell")).toContain("allowlisted");
  });

  test("anything else still names the sa_vm fallback", () => {
    expect(miniUnknownToolError("frobnicator")).toContain("unknown tool: frobnicator");
    expect(miniUnknownToolError("frobnicator")).toContain("sa_vm");
    expect(miniUnknownToolError("")).toBe("unknown tool: ");
  });
});
