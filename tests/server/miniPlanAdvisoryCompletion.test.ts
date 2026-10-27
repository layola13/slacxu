import { describe, expect, test } from "bun:test";
import {
  MINI_PLAN_AWARE_SUMMARY_RULE,
  MINI_PLAN_SYNC_RULE,
  MINI_CODEX_PROMPT_HEAD,
  carryMiniPlanForward,
  closeMiniOpenSegments,
  miniPendingPlanReminder,
  miniPlanProgressFingerprint,
  shouldContinueMiniPlan,
} from "../../backends/mini/src/runtime/miniBridge.ts";
import { CODEX_FALLBACK_INSTRUCTIONS } from "../../apps/server/src/codexFallbackInstructions.ts";

describe("mini plan stays useful without forcing ceremony", () => {
  test("planning is reserved for genuinely multi-step work and safety limits are honest", () => {
    expect(MINI_PLAN_AWARE_SUMMARY_RULE).toContain("update_plan");
    expect(MINI_PLAN_AWARE_SUMMARY_RULE).toContain("genuinely multi-step");
    expect(MINI_PLAN_AWARE_SUMMARY_RULE).toContain("safety limits are finite");
    expect(MINI_PLAN_SYNC_RULE).toContain("update_plan");
    expect(MINI_PLAN_SYNC_RULE).toContain("not a reason to repeat");
  });

  test("system prompt avoids mandatory planning, skill reads, and redundant rereads", async () => {
    const source = await Bun.file(
      new URL("../../backends/mini/src/runtime/miniBridge.ts", import.meta.url),
    ).text();
    expect(source).toContain("MINI_PLAN_AWARE_SUMMARY_RULE");
    expect(MINI_CODEX_PROMPT_HEAD).toBe(CODEX_FALLBACK_INSTRUCTIONS);
    expect(source.includes("Batch independent reads/searches as multiple sa_vm calls in one round")).toBe(true);
    expect(source).toContain("Be concise and avoid repeating tool results");
    expect(source).not.toContain("Call read_skill(name) before using a skill.");
    expect(source).not.toContain("For tasks with 3+ steps, call update_plan FIRST");
  });

  test("legacy narration classifiers stay removed", async () => {
    const source = await Bun.file(
      new URL("../../backends/mini/src/runtime/miniBridge.ts", import.meta.url),
    ).text();
    expect(source).not.toContain("MINI_ACTION_PROMISE_RE");
    expect(source).not.toContain("isMiniActionNarration");
    expect(source).not.toContain("decideMiniNoCallOutcome");
    expect(source).not.toContain("不再调用工具");
    expect(source).not.toContain("换一个支持 function calling");
  });
});

describe("mini auto-continues unfinished plans (连贯 regression)", () => {
  test("reminder is built from structured plan state, never message text", () => {
    expect(miniPendingPlanReminder([])).toBeNull();
    expect(
      miniPendingPlanReminder([
        { step: "a", status: "completed" },
        { step: "b", status: "completed" },
      ]),
    ).toBeNull();
    const note = miniPendingPlanReminder([
      { step: "done step", status: "completed" },
      { step: "read package.json", status: "in_progress" },
      { step: "write report", status: "pending" },
    ]);
    expect(note).not.toBeNull();
    expect(note).toContain("2 unfinished step(s)");
    expect(note).toContain("read package.json");
    expect(note).toContain("write report");
    expect(note).not.toContain("done step");
    expect(note).toContain("update the checklist");
    expect(note).toContain("if blocked");
  });

  test("repeated plan-only or no-progress reminders stop instead of spinning", () => {
    const steps = [{ step: "inspect files", status: "pending" as const }];
    const progress = miniPlanProgressFingerprint(steps, 0);
    const seen = new Set<string>();
    expect(shouldContinueMiniPlan(seen, progress)).toBe(true);
    expect(shouldContinueMiniPlan(seen, progress)).toBe(false);
    expect(shouldContinueMiniPlan(seen, miniPlanProgressFingerprint(steps, 1))).toBe(true);
  });

  test("continuation is guard-railed, never silently disabled", async () => {
    expect(MINI_PLAN_AWARE_SUMMARY_RULE).toContain("Continue useful unfinished work autonomously");
    const source = await Bun.file(
      new URL("../../backends/mini/src/runtime/miniBridge.ts", import.meta.url),
    ).text();
    expect(source).toContain("miniPendingPlanReminder(planSteps)");
    // Finite turn guards exist and repeated plan states are stopped early.
    expect(source).toContain("MINI_TURN_MAX_ROUNDS");
    expect(source).toContain("MINI_ROUND_CAP_NOTE");
    expect(source).toContain("shouldContinueMiniPlan(planOnlyProgressSeen, progress)");
    expect(source).toContain("shouldContinueMiniPlan(planReminderProgressSeen, progress)");
    expect(source).not.toContain("MAX_MINI_PLAN_CONTINUATIONS");
    expect(source).not.toContain("toolsDisabled");
    expect(source).not.toContain("toolOnlyStreak");
    expect(source).not.toContain("planContinuations");
    expect(source).not.toContain("Tool budget reached");
    expect(source).not.toContain("blocked: repeated identical call");
    expect(source).not.toContain("Tools are now DISABLED");
  });

  test("hard wrap-up cannot be bypassed by unfinished or empty plan calls", async () => {
    const source = await Bun.file(
      new URL("../../backends/mini/src/runtime/miniBridge.ts", import.meta.url),
    ).text();
    expect(source).toContain("let resumeNote = budgetWrapUp || noToolRequested ? null : miniPendingPlanReminder(planSteps)");
    expect(source).toContain("if (hadPlanCalls) {");
    expect(source).toContain("if (!budgetWrapUp && shouldContinueMiniPlan(planOnlyProgressSeen, progress)) continue;");
  });
});

describe("mini open segments never stay inProgress (假死 regression)", () => {
  const turnId = "turn-1";
  const otherTurn = "turn-2";

  function sampleMessages(): any[] {
    return [
      {
        type: "agentMessage",
        id: `mini-msg-${turnId}-s1`,
        turnId,
        threadId: "thread-1",
        status: "inProgress",
        text: "partial report",
      },
      {
        type: "reasoning",
        id: `mini-reason-${turnId}`,
        turnId,
        threadId: "thread-1",
        status: "inProgress",
        text: "thinking",
      },
      {
        type: "agentMessage",
        id: `mini-msg-${otherTurn}-s1`,
        turnId: otherTurn,
        threadId: "thread-1",
        status: "inProgress",
        text: "other turn",
      },
      {
        type: "agentMessage",
        id: `mini-msg-${turnId}-s0`,
        turnId,
        threadId: "thread-1",
        status: "completed",
        text: "done",
      },
    ] as any[];
  }

  test("closes only this turn's inProgress agent/reasoning segments", () => {
    const messages: any[] = sampleMessages();
    const closed = closeMiniOpenSegments(messages as any, turnId, "completed");
    expect(closed).toBe(2);
    expect(messages[0].status).toBe("completed");
    expect(messages[1].status).toBe("completed");
    expect(messages[2].status).toBe("inProgress");
    expect(messages[3].status).toBe("completed");
  });

  test("supports failed/interrupted terminal states", () => {
    const failed: any[] = sampleMessages();
    expect(closeMiniOpenSegments(failed as any, turnId, "failed")).toBe(2);
    expect(failed[0].status).toBe("failed");
    const interrupted: any[] = sampleMessages();
    expect(closeMiniOpenSegments(interrupted as any, turnId, "interrupted")).toBe(2);
    expect(interrupted[1].status).toBe("interrupted");
  });

  test("every turn-end path closes open segments", async () => {
    const source = await Bun.file(
      new URL("../../backends/mini/src/runtime/miniBridge.ts", import.meta.url),
    ).text();
    const failIdx = source.indexOf("private failTurn");
    const interruptIdx = source.indexOf("private interruptTurn");
    const completedEmitIdx = source.lastIndexOf('"turn/completed"');
    expect(failIdx).toBeGreaterThanOrEqual(0);
    expect(interruptIdx).toBeGreaterThanOrEqual(0);
    expect(source.slice(failIdx, failIdx + 800)).toContain("closeMiniOpenSegments");
    expect(source.slice(interruptIdx, interruptIdx + 800)).toContain(
      "closeMiniOpenSegments",
    );
    expect(
      source.slice(completedEmitIdx - 1000, completedEmitIdx),
    ).toContain("closeMiniOpenSegments");
  });

  test("carryMiniPlanForward keeps unfinished steps across compaction", () => {
    const messages = [
      { type: "userMessage", text: "do it", status: "completed" },
      {
        type: "plan",
        plan: [
          { step: "done step", status: "completed" },
          { step: "working step", status: "in_progress" },
          { step: "todo step", status: "pending" },
        ],
      },
    ] as never[];
    const carried = carryMiniPlanForward(messages, "t1", "thread-1") as Record<string, any>;
    expect(carried).not.toBeNull();
    expect(carried.type).toBe("plan");
    expect(carried.plan.map((s: any) => s.step)).toEqual(["working step", "todo step"]);
    expect(carried.text).toContain("working step");
  });

  test("carryMiniPlanForward returns null when nothing is pending", () => {
    expect(carryMiniPlanForward([], "t1", "thread-1")).toBeNull();
    const done = [
      { type: "plan", plan: [{ step: "all done", status: "completed" }] },
    ] as never[];
    expect(carryMiniPlanForward(done, "t1", "thread-1")).toBeNull();
  });
});
