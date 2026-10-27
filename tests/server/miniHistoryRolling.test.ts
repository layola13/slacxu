import { describe, expect, test } from "bun:test";
import {
  MINI_HISTORY_CARRY_RATIO,
  MINI_HISTORY_SUMMARY_MAX_CHUNKS,
  MINI_HISTORY_SUMMARY_MAX_INPUT_CHARS,
  MINI_HISTORY_TAIL_BUDGET_RATIO,
  MINI_HISTORY_TAIL_CHARS,
  MINI_HISTORY_OVER_BUDGET_ITEM_CHARS,
  assembleMiniSummarizedHistory,
  chunkMiniSummaryInput,
  locateMiniHistoryAnchor,
  miniHistoryAnchor,
  miniHistoryBudgetChars,
  miniHistoryLinesFromMessages,
  miniHistoryNeedsSummary,
  pinMiniHistoryUserLines,
  planMiniHistorySummary,
  splitHistoryForSummary,
  type MiniHistorySummaryCache,
} from "../../backends/mini/src/runtime/miniBridge.js";
import { hasGoalCompleteSignal } from "../../apps/server/src/goalContinuation.js";
import { heuristicMiniTokens } from "../../backends/mini/src/runtime/miniTokenizer.js";

/** Goal session: one task message, then N continuation turns of 5 tool calls each. */
function goalSession(turns: number, outputChars = 2000): any[] {
  const msgs: any[] = [{ type: "userMessage", turnId: "t0", text: "ORIGINAL TASK: refactor module X in 12 files", status: "completed" }];
  for (let t = 1; t <= turns; t++) {
    const turnId = `t${t}`;
    msgs.push({ type: "goalContinuation", turnId, text: `[[codex-ultra:goal-continuation]]\nContinue attempt ${t}` });
    for (let k = 0; k < 5; k++) {
      msgs.push({ type: "toolCall", turnId, name: "sa_vm", arguments: `{"path":"src/f${t}_${k}.ts"}`, output: `ID[${t}.${k}] ${"x".repeat(outputChars)}`, status: "completed" });
    }
    msgs.push({ type: "agentMessage", turnId, text: `turn ${t} done: edited file number ${t} and verified`, status: "completed" });
  }
  return msgs;
}

/** Mirrors the runMiniTurn history pipeline with a fake summarizer that records what it read. */
function simulate(turns: number, contextWindow = 128_000) {
  const budget = miniHistoryBudgetChars(contextWindow);
  let cache: MiniHistorySummaryCache | undefined;
  const summarized = new Set<string>();
  const report: Array<{ turn: number; missing: string[] }> = [];
  const stats = { summarizeCalls: 0, reuses: 0 };
  for (let n = 1; n <= turns; n++) {
    const msgs = goalSession(n);
    let lines = miniHistoryLinesFromMessages(msgs, "live", 0);
    if (heuristicMiniTokens(lines.join("\n")) > budget / 4) {
      lines = miniHistoryLinesFromMessages(msgs, "live", MINI_HISTORY_OVER_BUDGET_ITEM_CHARS);
    }
    if (!miniHistoryNeedsSummary(lines, budget)) {
      report.push({ turn: n, missing: [] });
      continue;
    }
    const { older, tail } = splitHistoryForSummary(lines, Math.max(MINI_HISTORY_TAIL_CHARS, Math.floor(budget * MINI_HISTORY_TAIL_BUDGET_RATIO)));
    const plan = planMiniHistorySummary(older, cache, Math.floor(budget * MINI_HISTORY_CARRY_RATIO));
    let carry: string[] = [];
    if (plan.kind === "reuse") {
      stats.reuses++;
      carry = plan.carry;
    } else {
      stats.summarizeCalls++;
      for (const chunk of chunkMiniSummaryInput(plan.pending)) {
        for (const m of chunk.matchAll(/ID\[\d+\.\d+\]|turn \d+ done|ORIGINAL TASK/g)) summarized.add(m[0]);
      }
      cache = { anchor: miniHistoryAnchor(older), summary: "S" };
    }
    const visible = new Set<string>(summarized);
    for (const l of [...carry, ...tail]) for (const m of l.matchAll(/ID\[\d+\.\d+\]|turn \d+ done|ORIGINAL TASK/g)) visible.add(m[0]);
    const missing: string[] = [];
    for (const l of lines) {
      const key = /ID\[\d+\.\d+\]|turn \d+ done|ORIGINAL TASK/.exec(l)?.[0];
      if (key && !visible.has(key)) missing.push(key);
    }
    report.push({ turn: n, missing });
  }
  return { report, stats };
}

describe("rolling history summary coverage", () => {
  test("every history line is summarized or sent raw across a 60-turn goal session", () => {
    const { report, stats } = simulate(60);
    // The summary path (fold + cached reuse) must actually be exercised.
    expect(stats.summarizeCalls).toBeGreaterThan(0);
    expect(stats.reuses).toBeGreaterThan(0);
    for (const r of report) expect({ turn: r.turn, missing: r.missing }).toEqual({ turn: r.turn, missing: [] });
  });

  test("small windows keep the same invariant", () => {
    const { report, stats } = simulate(40, 32_000);
    expect(stats.summarizeCalls).toBeGreaterThan(0);
    for (const r of report) expect({ turn: r.turn, missing: r.missing }).toEqual({ turn: r.turn, missing: [] });
  });

  test("history within budget is not summarized", () => {
    const budget = miniHistoryBudgetChars(128_000);
    const lines = miniHistoryLinesFromMessages(goalSession(3, 1000), "live", 0);
    expect(miniHistoryNeedsSummary(lines, budget)).toBe(false);
  });
});

describe("summary cache anchor", () => {
  test("anchor survives continuation fragments disappearing", () => {
    const older = ["user: a", "goal-continuation: 1", "tool x => 1", "assistant: b", "goal-continuation: 2", "tool y => 2"];
    const anchor = miniHistoryAnchor(older);
    expect(anchor.some((l) => l.startsWith("goal-continuation:"))).toBe(false);
    // Next turn: older fragments collapsed away, new lines appended.
    const next = ["user: a", "tool x => 1", "assistant: b", "tool y => 2", "tool z => 3"];
    expect(locateMiniHistoryAnchor(next, anchor)).toBe(4);
  });

  test("missing anchor forces a full re-summary instead of dropping lines", () => {
    const plan = planMiniHistorySummary(["user: new"], { anchor: ["gone"], summary: "old" }, 10_000);
    expect(plan).toEqual({ kind: "summarize", base: "", pending: ["user: new"] });
  });

  test("small pending backlog rides raw with the cached summary", () => {
    const older = ["l1", "l2", "l3", "l4", "l5"];
    const cache = { anchor: miniHistoryAnchor(older.slice(0, 3)), summary: "S" };
    expect(planMiniHistorySummary(older, cache, 10_000)).toEqual({ kind: "reuse", summary: "S", carry: ["l4", "l5"] });
  });

  test("large pending backlog is folded into the previous summary", () => {
    const older = ["l1", "l2", "l3", "x".repeat(500)];
    const cache = { anchor: miniHistoryAnchor(older.slice(0, 3)), summary: "S" };
    const plan = planMiniHistorySummary(older, cache, 100);
    expect(plan.kind).toBe("summarize");
    if (plan.kind === "summarize") {
      expect(plan.base).toBe("S");
      expect(plan.pending).toEqual(["x".repeat(500)]);
    }
  });
});

describe("chunkMiniSummaryInput", () => {
  test("keeps the whole backlog (no head-only slice) within the chunk limit", () => {
    const pending = Array.from({ length: 300 }, (_, i) => `L${i} ${"y".repeat(700)}`);
    const chunks = chunkMiniSummaryInput(pending);
    expect(chunks.length).toBeLessThanOrEqual(MINI_HISTORY_SUMMARY_MAX_CHUNKS);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MINI_HISTORY_SUMMARY_MAX_INPUT_CHARS);
    const joined = chunks.join("\n");
    for (let i = 0; i < 300; i++) expect(joined).toContain(`L${i} `);
  });

  test("short backlog is one untouched chunk", () => {
    expect(chunkMiniSummaryInput(["a", "b"])).toEqual(["a\nb"]);
  });
});

describe("pinMiniHistoryUserLines", () => {
  test("keeps the first user message plus the newest within budget, in order", () => {
    const lines = ["user: first task", "tool a", "user: second", "assistant: x", "user: third", "user: fourth"];
    expect(pinMiniHistoryUserLines(lines, 1000)).toEqual(["user: first task", "user: second", "user: third", "user: fourth"]);
    const tight = pinMiniHistoryUserLines(lines, "user: first task".length + "user: fourth".length + 2);
    expect(tight[0]).toBe("user: first task");
    expect(tight[tight.length - 1]).toBe("user: fourth");
    expect(tight).not.toContain("user: second");
  });

  test("ignores continuation fragments and non-user lines", () => {
    expect(pinMiniHistoryUserLines(["goal-continuation: x", "assistant: y"], 1000)).toEqual([]);
  });

  test("assembled history leads with summary, then verbatim users, carry, tail", () => {
    const out = assembleMiniSummarizedHistory({ summary: "S", pinnedUsers: ["user: a"], carry: ["c"], tail: ["t"] });
    expect(out).toEqual(["[earlier history summary]\nS", "[earlier user messages, verbatim - already covered, background context]\nuser: a", "c", "t"]);
  });
});

describe("hasGoalCompleteSignal", () => {
  test("accepts the marker on its own line, with markdown wrapping", () => {
    expect(hasGoalCompleteSignal("GOAL_COMPLETE")).toBe(true);
    expect(hasGoalCompleteSignal("All 12 files refactored, tests green.\n\nGOAL_COMPLETE")).toBe(true);
    expect(hasGoalCompleteSignal("done\n**GOAL_COMPLETE**")).toBe(true);
    expect(hasGoalCompleteSignal("`GOAL_COMPLETE`.")).toBe(true);
  });

  test("rejects the marker inside a sentence", () => {
    expect(hasGoalCompleteSignal("Tests still fail, so I will not reply GOAL_COMPLETE yet.")).toBe(false);
    expect(hasGoalCompleteSignal("暂不回复 GOAL_COMPLETE，还有 3 个文件未改")).toBe(false);
    expect(hasGoalCompleteSignal("")).toBe(false);
  });

  test("accepts natural language Chinese and English completion signals", () => {
    expect(hasGoalCompleteSignal("目标已完成")).toBe(true);
    expect(hasGoalCompleteSignal("所有测试已通过。\n\n目标已完成。")).toBe(true);
    expect(hasGoalCompleteSignal("任务全部完成")).toBe(true);
    expect(hasGoalCompleteSignal("已全部完成")).toBe(true);
    expect(hasGoalCompleteSignal("目标已达成")).toBe(true);
    expect(hasGoalCompleteSignal("所有任务已完成！")).toBe(true);
    expect(hasGoalCompleteSignal("All tasks completed.")).toBe(true);
    expect(hasGoalCompleteSignal("Refactored code and verified.\n\nGoal completed.")).toBe(true);
    expect(hasGoalCompleteSignal("Goal achieved.")).toBe(true);
    expect(hasGoalCompleteSignal("All done.")).toBe(true);
  });

  test("rejects natural language completion phrases with negation", () => {
    expect(hasGoalCompleteSignal("目标尚未完成，还需要优化")).toBe(false);
    expect(hasGoalCompleteSignal("任务未完成")).toBe(false);
    expect(hasGoalCompleteSignal("当前无法完成目标")).toBe(false);
    expect(hasGoalCompleteSignal("not completed yet")).toBe(false);
    expect(hasGoalCompleteSignal("all tasks are not completed")).toBe(false);
    expect(hasGoalCompleteSignal("haven't completed the task")).toBe(false);
  });
});

