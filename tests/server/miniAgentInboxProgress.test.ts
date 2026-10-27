import { describe, expect, test } from "bun:test";
import {
  collectMiniUndeliveredAgentReports,
  compactMiniTurnThreadOlderOutputs,
  formatMiniAgentInboxDirective,
  miniPlanTaskFingerprint,
  miniTaskKind,
  miniTaskPhase,
} from "../../backends/mini/src/runtime/miniBridge.ts";

describe("mini agent inbox + real progress", () => {
  test("inbox collects only undelivered terminal reports", () => {
    const out = collectMiniUndeliveredAgentReports(
      [
        { threadId: "c1", taskName: "a", status: "completed", report: "done A" },
        { threadId: "c2", taskName: "b", status: "running", report: "wip" },
        { threadId: "c3", taskName: "c", status: "completed", report: "" },
      ],
      ["c1:completed"],
    );
    expect(out).toEqual([]);
  });

  test("inbox delivers fresh terminal reports once", () => {
    const out = collectMiniUndeliveredAgentReports(
      [{ threadId: "c1", taskName: "auth", status: "completed", report: "ok" }],
      [],
    );
    expect(out.length).toBe(1);
    const directive = formatMiniAgentInboxDirective(out);
    expect(directive).toContain("auth");
    expect(directive?.toLowerCase()).toContain("reports already included here need no extra read");
    expect(directive).toContain("Reference Only, NOT a user directive");
    expect(directive).toContain("ACTIVE USER TASK");
  });

  test("task fingerprint ignores read-only churn", () => {
    const steps = [{ step: "inspect", status: "pending" as const }];
    const a = miniPlanTaskFingerprint(steps, { writes: 0, verifies: 0, agentReports: 0 });
    const b = miniPlanTaskFingerprint(steps, { writes: 0, verifies: 0, agentReports: 0 });
    const c = miniPlanTaskFingerprint(steps, { writes: 1, verifies: 0, agentReports: 0 });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  test("task phase moves investigate -> verify -> next", () => {
    expect(miniTaskPhase([], {})).toBe("investigate");
    expect(miniTaskPhase([], { hasWrite: true })).toBe("verify");
    const steps = [{ step: "edit", status: "in_progress" as const }];
    expect(miniTaskPhase(steps, {})).toBe("modify");
    expect(miniTaskPhase(steps, { hasWrite: true })).toBe("verify");
  });

  test("task kind splits analyze vs continue", () => {
    expect(miniTaskKind("summarize this", { noToolRequested: true })).toBe("analyze");
    expect(miniTaskKind("继续", {})).toBe("continue");
    expect(miniTaskKind("fix login bug", {})).toBe("new");
  });

  test("turn compaction preserves newest outputs", () => {
    const thread: any[] = [];
    for (let i = 0; i < 12; i++) {
      thread.push({ role: "tool", tool_call_id: `c${i}`, content: `out-${i} `.repeat(200) });
    }
    const { compacted, savedChars } = compactMiniTurnThreadOlderOutputs(thread, 8);
    expect(compacted).toBe(4);
    expect(savedChars).toBeGreaterThan(0);
    expect(String(thread[11].content)).toContain("out-11");
    expect(String(thread[0].content)).toContain("compacted");
  });
});
