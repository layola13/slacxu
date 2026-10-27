import { expect, test } from "bun:test";
import {
  MODEL_CAPACITY_RETRY_DELAY_MS,
  MODEL_CAPACITY_RETRY_SUCCESS_RETENTION_MS,
  decideModelCapacityRetry,
  isModelCapacityRetryError,
  shouldClearModelCapacityRetryEntry
} from "../../apps/web/src/app/modelCapacityRetry.ts";

const initialState = { attempt: 0, max: 2, exhausted: false };

test("capacity retry remains disabled by default", () => {
  expect(decideModelCapacityRetry({
    enabled: false,
    message: "Selected model is at capacity. Please try a different model.",
    codexWillRetry: false,
    state: initialState
  })).toEqual({ action: "disabled", state: initialState });
});

test("Codex native retry never schedules an additional application turn", () => {
  expect(decideModelCapacityRetry({
    enabled: true,
    message: "The model provider is rate-limiting requests. Please wait a moment and try again.",
    codexWillRetry: true,
    state: initialState
  })).toEqual({ action: "ignored", state: initialState });
});

test("only known capacity and rate-limit errors use the application retry policy", () => {
  expect(isModelCapacityRetryError("Selected model is at capacity. Please try a different model.")).toBe(true);
  expect(isModelCapacityRetryError("The model provider is rate-limiting requests. Please wait a moment and try again.")).toBe(true);
  expect(isModelCapacityRetryError("Authentication failed")).toBe(false);
  expect(decideModelCapacityRetry({
    enabled: true,
    message: "Authentication failed",
    codexWillRetry: false,
    state: initialState
  })).toEqual({ action: "ignored", state: initialState });
});

test("retry attempts exhaust once and never restart from one", () => {
  const first = decideModelCapacityRetry({
    enabled: true,
    message: "Selected model is at capacity",
    codexWillRetry: false,
    state: initialState
  });
  expect(first).toEqual({
    action: "schedule",
    attempt: 1,
    state: { attempt: 1, max: 2, exhausted: false }
  });
  const second = decideModelCapacityRetry({
    enabled: true,
    message: "Selected model is at capacity",
    codexWillRetry: false,
    state: first.state
  });
  expect(second).toEqual({
    action: "schedule",
    attempt: 2,
    state: { attempt: 2, max: 2, exhausted: true }
  });
  expect(decideModelCapacityRetry({
    enabled: true,
    message: "Selected model is at capacity",
    codexWillRetry: false,
    state: second.state
  })).toEqual({
    action: "exhausted",
    state: { attempt: 2, max: 2, exhausted: true }
  });
});

test("retry timing and successful cleanup policy stay fixed", () => {
  expect(MODEL_CAPACITY_RETRY_DELAY_MS).toBe(5_000);
  expect(MODEL_CAPACITY_RETRY_SUCCESS_RETENTION_MS).toBe(30_000);
  expect(shouldClearModelCapacityRetryEntry({
    assistantOutputEvent: true,
    messageMethod: "item/agentMessage/delta",
    errorText: ""
  })).toBe(true);
  expect(shouldClearModelCapacityRetryEntry({
    assistantOutputEvent: false,
    messageMethod: "turn/completed",
    errorText: ""
  })).toBe(true);
  expect(shouldClearModelCapacityRetryEntry({
    assistantOutputEvent: false,
    messageMethod: "turn/completed",
    errorText: "Selected model is at capacity"
  })).toBe(false);
});
