import { expect, test } from "bun:test";
import {
  buildJevBriefState,
  buildJevNudgeText,
  buildJevPlanNudgeText,
  buildJevPlanState,
  buildJevReportState,
  buildJevSubNudgeText,
  defaultJevBriefQuestions,
  defaultJevPlanQuestions,
  defaultJevReportQuestions,
  formatJevSubLabel,
  formatJevCauseAction,
  formatJevPlanLabel,
  formatJevVerdictLabel,
  parseJevBriefVerdict,
  parseJevPlanVerdict,
  parseJevReportVerdict,
  parseJevVerdict,
} from "../../frontends/jev/src/jev/jevQuestions";
import { JEV_MAX_AUTO_NUDGES, normalizeMaxJevNudges, normalizePlanReviewMode } from "../../frontends/jev/src/jev/jevConfig";
import { isJevEventInScope, shouldAcceptJevVerdictForThread, shouldAutoNudge } from "../../frontends/jev/src/jev/jevAutoJudge";

test("parses a completed verdict with confidence and usage", () => {
  const verdict = parseJevVerdict("thread-1", "turn-1", {
    model: "jev-1.13.0",
    answers: {
      task_completed: { type: "choice", choice: "completed", confidence: 0.91 },
      solution_quality: { type: "score", score: 2.8, confidence: 0.7 },
      risk_or_hallucination: { type: "noul", noul: 0.1 }
    },
    usage: { input_tokens: 400, output_tokens: 80 }
  }, 150);
  expect(verdict.choice).toBe("completed");
  expect(verdict.quality).toBe(2.8);
  expect(verdict.risk).toBe(0.1);
  expect(verdict.latencyMs).toBe(150);
  const label = formatJevVerdictLabel(verdict);
  expect(label).toContain("✅");
  expect(label).toContain("91%");
  expect(label).toContain("2.8/3.0");
});

test("failed verdict label surfaces failure and high risk", () => {
  const verdict = parseJevVerdict("thread-1", "turn-2", {
    answers: {
      task_completed: { type: "choice", choice: "failed", confidence: 0.97 },
      solution_quality: { type: "score", score: 0.4 },
      risk_or_hallucination: { type: "noul", noul: 0.85 }
    }
  });
  const label = formatJevVerdictLabel(verdict);
  expect(label).toContain("❌");
  expect(label).toContain("⚠️");
});

test("parses failure cause and suggested action", () => {
  const verdict = parseJevVerdict("thread-1", "turn-3", {
    answers: {
      task_completed: { type: "choice", choice: "failed", confidence: 0.92 },
      failure_cause: { type: "choice", choice: "blocked_environment", confidence: 0.82 },
      suggested_action: { type: "choice", choice: "revise_approach", confidence: 0.58 }
    }
  });
  expect(verdict.cause).toBe("blocked_environment");
  expect(verdict.action).toBe("revise_approach");
  const line = formatJevCauseAction(verdict);
  expect(line).toContain("原因：环境阻塞(82%)");
  expect(line).toContain("建议：换思路重做");
  const nudge = buildJevNudgeText(verdict, 1, 2);
  expect(nudge).toContain("受阻/失败");
  expect(nudge).toContain("环境阻塞");
  expect(nudge).toContain("第 1 次自动督促");
});

test("completed verdicts produce no cause line", () => {
  const verdict = parseJevVerdict("thread-1", "turn-4", {
    answers: {
      task_completed: { type: "choice", choice: "completed", confidence: 0.9 },
      failure_cause: { type: "choice", choice: "none", confidence: 1 },
      suggested_action: { type: "choice", choice: "done_no_action", confidence: 0.94 }
    }
  });
  expect(formatJevCauseAction(verdict)).toBe("");
});

test("auto-nudge only fires for failed/partial while idle and within budget", () => {
  const base = { running: false, autoNudge: true, consecutiveFailures: 0, maxNudges: 2 };
  expect(shouldAutoNudge({ ...base, choice: "failed" })).toBe(true);
  expect(shouldAutoNudge({ ...base, choice: "partial" })).toBe(true);
  expect(shouldAutoNudge({ ...base, choice: "failed", consecutiveFailures: 2 })).toBe(false);
  expect(shouldAutoNudge({ ...base, choice: "completed" })).toBe(false);
  expect(shouldAutoNudge({ ...base, choice: "needs_user_confirmation" })).toBe(false);
  expect(shouldAutoNudge({ ...base, choice: "failed", running: true })).toBe(false);
  expect(shouldAutoNudge({ ...base, choice: "failed", autoNudge: false })).toBe(false);
});

test("verdict choice is normalized so sloppy model output still nudges", () => {
  const parse = (choice: unknown): string | undefined =>
    parseJevVerdict("t", "u", { answers: { task_completed: { choice } } }).choice;
  expect(parse("failed")).toBe("failed");
  expect(parse(" failed ")).toBe("failed");
  expect(parse("Failed")).toBe("failed");
  expect(parse("FAILED")).toBe("failed");
  expect(parse("completed")).toBe("completed");
  expect(parse("complete")).toBe("completed");
  expect(parse("done")).toBe("completed");
  expect(parse("partial")).toBe("partial");
  expect(parse("needs_user_confirmation")).toBe("needs_user_confirmation");
  expect(parse("need-user-confirmation")).toBe("needs_user_confirmation");
  // Normalized failures must pass the nudge gate (previously " Failed " or
  // "complete" silently skipped auto-nudge while the UI showed "已评判").
  const base = { running: false, autoNudge: true, consecutiveFailures: 0, maxNudges: 2 };
  expect(shouldAutoNudge({ ...base, choice: parse(" Failed ") })).toBe(true);
  expect(shouldAutoNudge({ ...base, choice: parse("done") })).toBe(false);
});

test("auto-nudge budget supports up to 1000 attempts", () => {
  expect(JEV_MAX_AUTO_NUDGES).toBe(1000);
  expect(normalizeMaxJevNudges(1000)).toBe(1000);
  expect(normalizeMaxJevNudges(1500)).toBe(1000);
  expect(normalizeMaxJevNudges(0)).toBe(1);
  const base = { running: false, autoNudge: true, choice: "failed", maxNudges: 1000 };
  expect(shouldAutoNudge({ ...base, consecutiveFailures: 998 })).toBe(true);
  expect(shouldAutoNudge({ ...base, consecutiveFailures: 999 })).toBe(true);
  expect(shouldAutoNudge({ ...base, consecutiveFailures: 1000 })).toBe(false);
});

test("plan review mode accepts off/created/every and legacy booleans", () => {
  expect(normalizePlanReviewMode("off")).toBe("off");
  expect(normalizePlanReviewMode("created")).toBe("created");
  expect(normalizePlanReviewMode("every")).toBe("every");
  expect(normalizePlanReviewMode(true)).toBe("created");
  expect(normalizePlanReviewMode(false)).toBe("off");
  expect(normalizePlanReviewMode("nope")).toBe("off");
});

test("plan verdict parses cause-free shape with completeness and risk", () => {
  expect(Object.keys(defaultJevPlanQuestions())).toEqual(["plan_verdict", "plan_completeness", "plan_risk"]);
  const state = buildJevPlanState("- [ ] a\n- [ ] b", "Do things");
  expect(state).toContain("task_plan:");
  const verdict = parseJevPlanVerdict("thread-9", "turn-9", {
    model: "jev-1.13.0",
    answers: {
      plan_verdict: { type: "choice", choice: "incomplete", confidence: 0.77 },
      plan_completeness: { type: "score", score: 1.2 },
      plan_risk: { type: "noul", noul: 0.2 }
    }
  }, 210);
  expect(verdict.kind).toBe("plan");
  expect(verdict.planChoice).toBe("incomplete");
  const label = formatJevPlanLabel(verdict);
  expect(label).toContain("📋 计划审核");
  expect(label).toContain("计划不完整");
  expect(label).toContain("1.2/3.0");
  const nudge = buildJevPlanNudgeText(verdict);
  expect(nudge).toContain("计划不完整");
  expect(nudge).toContain("update_plan");
});

test("brief review parses vagueness and suggests supplementing", () => {
  expect(Object.keys(defaultJevBriefQuestions())).toEqual(["brief_verdict", "brief_completeness", "brief_risk"]);
  const state = buildJevBriefState("task_a", "Do the thing");
  expect(state).toContain("task_brief:");
  const verdict = parseJevBriefVerdict("thread-1", "turn-1", "agent-1", "task_a", {
    answers: {
      brief_verdict: { type: "choice", choice: "vague", confidence: 0.7 },
      brief_completeness: { type: "score", score: 1.1 },
      brief_risk: { type: "noul", noul: 0.2 }
    }
  });
  expect(verdict.kind).toBe("brief");
  const label = formatJevSubLabel(verdict);
  expect(label).toContain("📤 分派审核");
  expect(label).toContain("分派含糊");
  const nudge = buildJevSubNudgeText(verdict);
  expect(nudge).toContain("send_message");
});

test("report review parses failure and suggests reclaiming", () => {
  expect(Object.keys(defaultJevReportQuestions())).toEqual(["report_verdict", "report_quality", "report_usable"]);
  const state = buildJevReportState("task_a", "failed", "It broke");
  expect(state).toContain("final_report:");
  const verdict = parseJevReportVerdict("thread-1", "turn-2", "agent-1", "task_a", {
    answers: {
      report_verdict: { type: "choice", choice: "failed", confidence: 0.9 },
      report_quality: { type: "score", score: 0.5 },
      report_usable: { type: "noul", noul: 0.1 }
    }
  });
  expect(verdict.kind).toBe("report");
  const label = formatJevSubLabel(verdict);
  expect(label).toContain("📥 汇报审核");
  expect(label).toContain("汇报失败");
});

test("thread scope gate only accepts the active conversation", () => {
  // 同对话接受。
  expect(shouldAcceptJevVerdictForThread("thread-A", "thread-A")).toBe(true);
  // 后台对话/MCP 子代理钩子必须丢弃，杜绝跨对话误督促。
  expect(shouldAcceptJevVerdictForThread("thread-A", "thread-B")).toBe(false);
  // 新对话未落库时，有明确目标的交给对应对话处理。
  expect(shouldAcceptJevVerdictForThread(null, "thread-B")).toBe(false);
  expect(shouldAcceptJevVerdictForThread(undefined, "thread-B")).toBe(false);
  // 无目标老格式不静默丢弃。
  expect(shouldAcceptJevVerdictForThread("thread-A", undefined)).toBe(true);
  expect(shouldAcceptJevVerdictForThread("thread-A", "")).toBe(true);
  expect(shouldAcceptJevVerdictForThread(null, undefined)).toBe(true);
  // 非法输入 fail-closed 或宽容处理，不抛异常。
  expect(shouldAcceptJevVerdictForThread("thread-A", 123)).toBe(true);
  expect(shouldAcceptJevVerdictForThread(123 as unknown as string, "thread-B")).toBe(false);
});

test("trigger side only judges the current thread", () => {
  // 未传 scope 时保持老行为（全部受理），避免误杀。
  expect(isJevEventInScope(undefined, "thread-B")).toBe(true);
  expect(isJevEventInScope({}, "thread-B")).toBe(true);
  // 本对话的事件才触发评审。
  const scopeA = { getActiveThreadId: () => "thread-A" };
  expect(isJevEventInScope(scopeA, "thread-A")).toBe(true);
  // 后台对话/MCP 子代理钩子的事件直接丢弃，不烧上游。
  expect(isJevEventInScope(scopeA, "thread-B")).toBe(false);
  // 当前对话为空时，有明确目标的事件不触发。
  expect(isJevEventInScope({ getActiveThreadId: () => null }, "thread-B")).toBe(false);
  // 无目标老格式不静默丢弃。
  expect(isJevEventInScope(scopeA, undefined)).toBe(true);
});
