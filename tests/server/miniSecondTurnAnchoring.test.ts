import { describe, expect, test } from "bun:test";
import {
  assembleMiniSummarizedHistory,
  buildMiniHistoryPayload,
  miniHistoryLinesFromMessages,
  miniPendingPlanReminder,
  pinMiniHistoryUserLines,
} from "../../backends/mini/src/runtime/miniBridge.ts";

/**
 * Regression: "mini 只记得第一个任务" — the second user turn re-executed
 * the first task. Root cause (jev_diagnose h1 @99%): the flattened
 * narrative history framed earlier turns as standing orders ("MUST
 * respect") and replayed the first user request verbatim, so the model
 * anchored on task 1 and discounted the live prompt. The history block
 * must frame earlier turns as a COMPLETED record and grant the latest
 * user message supremacy.
 */
describe("mini second-turn anchoring", () => {
  const turn1 = "t1";
  const turn2 = "t2";
  const messages: any[] = [
    { type: "userMessage", id: "mini-user-t1", turnId: turn1, threadId: "th", text: "TASK ONE: paint the fence red", role: "user", status: "completed" },
    { type: "toolCall", id: "mini-tool-t1-c1", turnId: turn1, threadId: "th", name: "sa_vm", arguments: '{"action":"read_file","path":"fence.txt"}', output: "fence is blue", status: "completed" },
    { type: "agentMessage", id: "mini-msg-t1", turnId: turn1, threadId: "th", text: "Painted the fence red, verified by reading fence.txt." },
  ];

  test("turn-2 history keeps task-1 evidence but frames it as completed background", () => {
    for (const protocol of ["chat", "responses"] as const) {
      const lines = miniHistoryLinesFromMessages(messages, turn2, 0);
      const joined = lines.join("\n");
      expect(joined).toContain("TASK ONE");
      expect(joined).toContain("fence is blue");
      const { historyBlock, recapText } = buildMiniHistoryPayload(lines, protocol);
      expect(historyBlock).toContain("background context");
      expect(historyBlock).toContain("the latest user message below is the current task");
      expect(historyBlock).not.toContain("MUST respect");
      if (protocol === "responses") {
        expect(recapText).toContain("background context only");
      }
    }
  });

  test("verbatim first-user pin is labeled handled background, not new orders", () => {
    const pinned = pinMiniHistoryUserLines(["user: TASK ONE: paint the fence red", "assistant: done"], 1000);
    expect(pinned).toContain("user: TASK ONE: paint the fence red");
    const out = assembleMiniSummarizedHistory({ summary: "S", pinnedUsers: pinned, carry: [], tail: [] });
    expect(out.join("\n")).toContain("already covered");
    expect(out.join("\n")).toContain("background context");
  });

  test("stale plan reminder yields to a fresh unrelated user task", () => {
    const note = miniPendingPlanReminder([{ step: "paint the fence", status: "in_progress" }]);
    expect(note).not.toBeNull();
    expect(note).toContain("follow the user message instead");
  });
});
