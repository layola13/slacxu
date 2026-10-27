import { describe, expect, test } from "bun:test";
import {
  MAX_MINI_PLAN_STALL_STEERS,
  MAX_MINI_TASK_EVASION_STEERS,
  MINI_GREETING_EVASION_RE,
  MINI_SHORT_TASK_RULE,
  miniHasDevelopmentContext,
  miniIsAnalysisOnlyPrompt,
  miniPlanStallCorrection,
  miniPromptNeedsWorkspaceAction,
  miniTaskEvasionCorrection,
} from "../../backends/mini/src/runtime/miniTaskIntent.ts";
import { formatMiniEnvBlock, formatMiniLiveTurnPrompt, miniPromptWantsWrite, miniTaskKind } from "../../backends/mini/src/runtime/miniBridge.ts";

const priorMessages = [
  { type: "userMessage", turnId: "prior", text: "浏览这个项目" },
  { type: "toolCall", turnId: "prior", name: "sa_vm", status: "completed", arguments: '{"action":"read_file","path":"index.html"}' },
  { type: "agentMessage", turnId: "prior", text: "项目已浏览：愤怒的小鸟网页版。当前无明确的修改需求，请说明下一步：修复玩法还是新增功能？" },
];

describe("mini concise task intent", () => {
  test("short development requests are sufficient without an exhaustive verb list", () => {
    for (const prompt of ["抛物线，设计角度", "抛物线，角度", "暗黑模式", "trajectory prediction", "加上重置按钮"]) {
      expect(miniPromptNeedsWorkspaceAction(prompt)).toBe(true);
      expect(miniPromptWantsWrite(prompt, { hasDevelopmentContext: true })).toBe(true);
    }
    expect(miniPromptWantsWrite("抛物线，角度")).toBe(false);
    expect(miniPromptWantsWrite("抛物线，设计角度")).toBe(true);
  });

  test("only the latest prior user turn supplies development context", () => {
    expect(miniHasDevelopmentContext(priorMessages, "current")).toBe(true);
    expect(miniHasDevelopmentContext([
      ...priorMessages,
      { type: "userMessage", turnId: "later", text: "你好" },
      { type: "agentMessage", turnId: "later", text: "你好！" },
      { type: "userMessage", turnId: "current", text: "抛物线" },
    ], "current")).toBe(false);
    expect(miniHasDevelopmentContext([
      { type: "userMessage", turnId: "current", text: "抛物线" },
      { type: "agentMessage", turnId: "current", text: "项目下一步" },
    ], "current")).toBe(false);
  });

  test("greetings and conceptual answers do not force tools or writes", () => {
    for (const prompt of ["你好", "谢谢！", "hello", "say hi briefly", "什么是抛物线", "解释发射角度", "What is dark mode?", "What is a plan?", "这个函数是做什么的", "and now summarize it", "你是什么模型？", "你是谁", "请问你是什么模型", "which model are you", "who are you"]) {
      expect(miniPromptNeedsWorkspaceAction(prompt)).toBe(false);
      expect(miniPromptWantsWrite(prompt, { hasDevelopmentContext: true })).toBe(false);
    }
    for (const prompt of ["只分析这个bug，不要修改", "设计角度，只讨论", "analysis only: fix login", "do not edit the code"]) {
      expect(miniIsAnalysisOnlyPrompt(prompt)).toBe(true);
      expect(miniTaskKind(prompt)).toBe("analyze");
      expect(miniPromptWantsWrite(prompt, { hasDevelopmentContext: true })).toBe(false);
    }
    expect(miniTaskKind("修复 read-only sandbox 的错误提示")).toBe("new");
    expect(miniPromptWantsWrite("修复 read-only sandbox 的错误提示")).toBe(true);
  });

  test("history framing preserves current-task precedence and follow-up interpretation", () => {
    for (const hasHistory of [true, false]) {
      const prompt = formatMiniLiveTurnPrompt("抛物线，设计角度", hasHistory);
      expect(prompt).toContain(MINI_SHORT_TASK_RULE);
      expect(prompt).toContain("抛物线，设计角度");
    }
    expect(formatMiniLiveTurnPrompt("抛物线", true)).toContain("answers to the previous assistant question");
    expect(formatMiniLiveTurnPrompt("抛物线", true)).toContain("not a new execution request");
  });
});

describe("mini bounded task-evasion recovery", () => {
  const active = { wantsWrite: true, hasPendingPlan: false, analysisOnly: false, hasWrite: false };

  test("rejects recycling the old no-requirement answer with or without a plan", () => {
    for (const text of [
      "workspace现状（已在上下文中，无需重复读取）。暂无明确修改需求；如需我改动请直接说目标。",
      "当前无明确的修改需求，请说明下一步。",
      "No clear implementation requirement. Please specify the task.",
      "What should I do next?",
    ]) {
      expect(miniTaskEvasionCorrection(text, active)).toContain("ACTIVE USER TASK");
      expect(miniTaskEvasionCorrection(text, { ...active, wantsWrite: false, hasPendingPlan: true })).not.toBeNull();
    }
  });

  test("does not override no-task, read-only, successful changes, or concrete blockers", () => {
    const evasion = "暂无明确修改需求";
    expect(miniTaskEvasionCorrection(evasion, { ...active, wantsWrite: false })).toBeNull();
    expect(miniTaskEvasionCorrection(evasion, { ...active, analysisOnly: true, hasPendingPlan: true })).toBeNull();
    expect(miniTaskEvasionCorrection(evasion, { ...active, hasWrite: true })).toBeNull();
    expect(miniTaskEvasionCorrection("经检查，无需修改，功能已经存在。", active)).toBeNull();
    expect(miniTaskEvasionCorrection("缺少 API key，无法访问模型服务。", active)).toBeNull();
    expect(miniTaskEvasionCorrection("无法访问项目目录 D:/missing，请确认路径。", active)).toBeNull();
    expect(miniTaskEvasionCorrection("角度单位用弧度还是度？", active)).toBeNull();
  });

  test("retries are finite and distinguish stalled plans from completion", () => {
    expect(MAX_MINI_TASK_EVASION_STEERS).toBe(2);
    expect(MAX_MINI_PLAN_STALL_STEERS).toBe(1);
    expect(miniPlanStallCorrection()).toContain("not task completion");
    expect(miniPlanStallCorrection()).toContain("specific blocker");
  });

  test("catches greeting evasion when the active user task requires action", () => {
    const greetingEvasions = [
      "I'm Muse Spark (MiniAgent), ready to help with software engineering tasks in your workspace.",
      "I am MiniAgent, ready to help.",
      "你好！我是 MiniAgent，有什么可以帮您的？",
      "Hello! How can I help you today?",
    ];
    for (const text of greetingEvasions) {
      expect(MINI_GREETING_EVASION_RE.test(text)).toBe(true);
      expect(miniTaskEvasionCorrection(text, { ...active, promptNeedsAction: true })).toContain("Do not output a greeting");
      expect(miniTaskEvasionCorrection(text, { ...active, wantsWrite: false, hasToolCalls: true })).toContain("Do not output a greeting");
      expect(miniTaskEvasionCorrection(text, { ...active, analysisOnly: true, hasToolCalls: true })).toContain("Do not output a greeting");
    }
    // If the user's prompt was just a greeting, a greeting response is permitted
    expect(miniTaskEvasionCorrection("I'm ready to help.", { ...active, promptNeedsAction: false, hasToolCalls: false, wantsWrite: false })).toBeNull();
  });

  test("formatMiniEnvBlock includes working directory, git repo status, and platform (no date: it rides the live tail for cache stability)", () => {
    const block = formatMiniEnvBlock(process.cwd());
    expect(block).toContain("<env>");
    expect(block).toContain("Working directory:");
    expect(block).toContain("Is directory a git repo: yes");
    expect(block).toContain("Platform:");
    expect(block).not.toContain("Today's date:");
    expect(block).toContain("</env>");
  });
});
