import { expect, test } from "bun:test";
import { resolveTurnRetryState, type TurnRetryState } from "../../apps/web/src/app/turnRetryState";

test("resolveTurnRetryState returns same reference when fields are identical (React bailout)", () => {
  const current: TurnRetryState = {
    threadId: "thread-1",
    turnId: "turn-1",
    message: "Model capacity reached",
    details: "503 Service Unavailable",
    updatedAt: 1000
  };

  // Same content, but new object with updated timestamp
  const next: TurnRetryState = {
    threadId: "thread-1",
    turnId: "turn-1",
    message: "Model capacity reached",
    details: "503 Service Unavailable",
    updatedAt: 2000
  };

  const resolved = resolveTurnRetryState(current, next);
  expect(resolved).toBe(current); // Strict reference equality preserves React memo bailout
});

test("resolveTurnRetryState bails out with functional updater when contents match", () => {
  const current: TurnRetryState = {
    threadId: "thread-1",
    turnId: "turn-1",
    message: "Rate limit exceeded",
    details: undefined,
    updatedAt: 1000
  };

  const resolved = resolveTurnRetryState(current, (prev) => ({
    threadId: prev!.threadId,
    turnId: prev!.turnId,
    message: prev!.message,
    details: undefined,
    updatedAt: 3000
  }));

  expect(resolved).toBe(current);
});

test("resolveTurnRetryState handles null transitions correctly", () => {
  const state: TurnRetryState = {
    threadId: "thread-1",
    turnId: "turn-1",
    message: "Error",
    updatedAt: 1000
  };

  expect(resolveTurnRetryState(null, null)).toBeNull();
  expect(resolveTurnRetryState(state, null)).toBeNull();
  expect(resolveTurnRetryState(null, state)).toBe(state);
  expect(resolveTurnRetryState(null, () => null)).toBeNull();
  expect(resolveTurnRetryState(null, () => state)).toBe(state);
  expect(resolveTurnRetryState(state, () => null)).toBeNull();
});

test("resolveTurnRetryState returns new reference when semantic fields change", () => {
  const base: TurnRetryState = {
    threadId: "thread-1",
    turnId: "turn-1",
    message: "Rate limit",
    details: "429 Too Many Requests",
    updatedAt: 1000
  };

  // Changed message
  const nextMessage = resolveTurnRetryState(base, { ...base, message: "Model overloaded" });
  expect(nextMessage).not.toBe(base);
  expect(nextMessage?.message).toBe("Model overloaded");

  // Changed turnId
  const nextTurn = resolveTurnRetryState(base, { ...base, turnId: "turn-2" });
  expect(nextTurn).not.toBe(base);
  expect(nextTurn?.turnId).toBe("turn-2");

  // Changed threadId
  const nextThread = resolveTurnRetryState(base, { ...base, threadId: "thread-2" });
  expect(nextThread).not.toBe(base);
  expect(nextThread?.threadId).toBe("thread-2");

  // Changed details
  const nextDetails = resolveTurnRetryState(base, { ...base, details: "503 Unavailable" });
  expect(nextDetails).not.toBe(base);
  expect(nextDetails?.details).toBe("503 Unavailable");

  // Details added from undefined
  const withoutDetails: TurnRetryState = { ...base, details: undefined };
  const addedDetails = resolveTurnRetryState(withoutDetails, { ...withoutDetails, details: "info" });
  expect(addedDetails).not.toBe(withoutDetails);
  expect(addedDetails?.details).toBe("info");
});
