import { expect, test } from "bun:test";
import {
  markGoalResumeHandled,
  resetGoalResumeDecision,
  shouldPromptGoalResume,
} from "../../apps/web/src/app/goals/goalResumeDecision";

test("does not prompt again after the user resumes the same goal", () => {
  const handledThreadIds = new Set<string>();

  expect(shouldPromptGoalResume(handledThreadIds, "thread-1")).toBe(true);
  markGoalResumeHandled(handledThreadIds, "thread-1");
  expect(shouldPromptGoalResume(handledThreadIds, "thread-1")).toBe(false);
});

test("does not repeatedly prompt after the user keeps the goal paused", () => {
  const handledThreadIds = new Set<string>();

  markGoalResumeHandled(handledThreadIds, "thread-1");
  expect(shouldPromptGoalResume(handledThreadIds, "thread-1")).toBe(false);
});

test("allows a new prompt after the goal is paused again", () => {
  const handledThreadIds = new Set<string>();

  markGoalResumeHandled(handledThreadIds, "thread-1");
  resetGoalResumeDecision(handledThreadIds, "thread-1");
  expect(shouldPromptGoalResume(handledThreadIds, "thread-1")).toBe(true);
});

test("tracks resume decisions independently per thread", () => {
  const handledThreadIds = new Set<string>();

  markGoalResumeHandled(handledThreadIds, "thread-1");
  expect(shouldPromptGoalResume(handledThreadIds, "thread-1")).toBe(false);
  expect(shouldPromptGoalResume(handledThreadIds, "thread-2")).toBe(true);
});
