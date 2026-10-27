import { describe, expect, test } from "bun:test";
import {
  MINI_PLAN_SYNC_RULE,
  MINI_SUMMARY_TIMEOUT_MS,
  miniSummaryRequestSignal,
} from "../../backends/mini/src/runtime/miniBridge.ts";

describe("mini turn end is the model's structural decision", () => {
  test("plan checklist stays advisory and is never parsed for intent", async () => {
    const source = await Bun.file(new URL("../../backends/mini/src/runtime/miniBridge.ts", import.meta.url)).text();
    expect(source).not.toContain("MINI_ACTION_PROMISE_RE");
    expect(source).not.toContain("isMiniActionNarration");
    expect(source).not.toContain("decideMiniNoCallOutcome");
  });

  test("system prompt teaches plan sync instead of policing output", () => {
    expect(MINI_PLAN_SYNC_RULE).toContain("update_plan");
    expect(MINI_PLAN_SYNC_RULE).toContain("final summary");
  });
});

describe("mini summary pass timeout", () => {
  test("summary requests carry an abort signal", () => {
    const signal = miniSummaryRequestSignal();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(MINI_SUMMARY_TIMEOUT_MS).toBe(120_000);
  });
});
