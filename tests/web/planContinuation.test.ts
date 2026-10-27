import { expect, test } from "bun:test";
import {
  PLAN_CONTINUATION_PROMPT,
  isPlanContinuationPrompt,
  shouldAutomaticallyContinuePlan
} from "../../apps/web/src/planContinuation";

test("recognizes internal plan continuation prompts", () => {
  expect(isPlanContinuationPrompt(PLAN_CONTINUATION_PROMPT)).toBe(true);
  expect(isPlanContinuationPrompt("Continue refining the plan")).toBe(false);
});

test("continues only while plan mode can safely advance without a completed plan", () => {
  const base = {
    planModeEnabled: true,
    connected: true,
    activeThreadId: "thread-1",
    threadId: "thread-1",
    hasRunningTurn: false,
    hasPendingRequest: false,
    hasCompletedPlan: false
  };
  expect(shouldAutomaticallyContinuePlan(base)).toBe(true);
  expect(shouldAutomaticallyContinuePlan({ ...base, planModeEnabled: false })).toBe(false);
  expect(shouldAutomaticallyContinuePlan({ ...base, connected: false })).toBe(false);
  expect(shouldAutomaticallyContinuePlan({ ...base, activeThreadId: "thread-2" })).toBe(false);
  expect(shouldAutomaticallyContinuePlan({ ...base, hasRunningTurn: true })).toBe(false);
  expect(shouldAutomaticallyContinuePlan({ ...base, hasPendingRequest: true })).toBe(false);
  expect(shouldAutomaticallyContinuePlan({ ...base, hasCompletedPlan: true })).toBe(false);
});
