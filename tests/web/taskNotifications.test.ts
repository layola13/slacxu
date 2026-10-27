import { expect, test } from "bun:test";
import {
  collectTaskNotificationEvents,
  createTaskNotificationTracker,
  readTaskNotificationPreferences
} from "../../apps/web/src/taskNotifications.ts";

test("task notification preferences default every category to enabled", () => {
  const storage = { getItem: () => null };
  expect(readTaskNotificationPreferences(storage, "prefs")).toEqual({
    turnCompleted: true,
    planStepsCompleted: true,
    remoteErrors: true
  });
});

test("completed turns and plan steps notify once across repeated events", () => {
  const tracker = createTaskNotificationTracker();
  const completedTurn = {
    method: "turn/completed",
    params: { threadId: "thread-1", turn: { id: "turn-1" } }
  };
  expect(collectTaskNotificationEvents(completedTurn, tracker)).toHaveLength(1);
  expect(collectTaskNotificationEvents(completedTurn, tracker)).toHaveLength(0);

  const firstPlan = {
    method: "turn/plan/updated",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      plan: [{ step: "Inspect", status: "completed" }, { step: "Build", status: "inProgress" }]
    }
  };
  expect(collectTaskNotificationEvents(firstPlan, tracker)).toEqual([
    expect.objectContaining({ type: "planStepsCompleted", steps: ["Inspect"] })
  ]);
  expect(collectTaskNotificationEvents(firstPlan, tracker)).toHaveLength(0);

  const secondPlan = {
    ...firstPlan,
    params: {
      ...firstPlan.params,
      plan: [{ step: "Inspect", status: "completed" }, { step: "Build", status: "done" }]
    }
  };
  expect(collectTaskNotificationEvents(secondPlan, tracker)).toEqual([
    expect.objectContaining({ type: "planStepsCompleted", steps: ["Build"] })
  ]);
});

test("remote errors expose status and retry state without duplicate notifications", () => {
  const tracker = createTaskNotificationTracker();
  const error = {
    method: "error",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      willRetry: true,
      error: {
        message: "exceeded retry limit, last status: 429 Too Many Requests",
        codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 429 } }
      }
    }
  };
  expect(collectTaskNotificationEvents(error, tracker)).toEqual([
    expect.objectContaining({ type: "remoteError", status: 429, willRetry: true })
  ]);
  expect(collectTaskNotificationEvents(error, tracker)).toHaveLength(0);
});
