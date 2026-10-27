import { expect, test } from "bun:test";
import {
  extractActualActiveTurnId,
  InterruptTurnGate,
  interruptTurnWithRetry,
  isAlreadyStoppedInterruptError,
  isRetryableInterruptError,
  isTurnNoLongerActiveError
} from "../../apps/web/src/app/turnInterruptRetry";

test("shares one in-flight stop request for repeated clicks on the same turn", async () => {
  const gate = new InterruptTurnGate();
  let calls = 0;
  let releaseFirst!: () => void;
  const first = gate.run("thread", "turn", async () => {
    calls += 1;
    await new Promise<void>((resolve) => { releaseFirst = resolve; });
  });
  const second = gate.run("thread", "turn", async () => {
    calls += 1;
  });

  expect(second).toBe(first);
  expect(calls).toBe(0);
  await Promise.resolve();
  expect(calls).toBe(1);

  releaseFirst();
  await first;
  await gate.run("thread", "turn", async () => { calls += 1; });
  expect(calls).toBe(2);
});

test("releases a failed stop request so a later explicit retry can run", async () => {
  const gate = new InterruptTurnGate();
  let calls = 0;

  await expect(gate.run("thread", "turn", async () => {
    calls += 1;
    throw new Error("transport unavailable");
  })).rejects.toThrow("transport unavailable");

  await gate.run("thread", "turn", async () => { calls += 1; });
  expect(calls).toBe(2);
});

test("retries transient interrupt timeouts and then succeeds", async () => {
  let attempts = 0;
  const events: Array<{ attempt: number; willRetry: boolean }> = [];
  await interruptTurnWithRetry({
    rpc: async () => {
      attempts += 1;
      if (attempts < 3) throw { message: "Request 'turn/interrupt' timed out after 15s" };
      return {};
    },
    threadId: "thread",
    turnId: "turn",
    delay: async () => undefined,
    onRetryEvent: (event) => events.push({ attempt: event.attempt, willRetry: event.willRetry })
  });
  expect(attempts).toBe(3);
  expect(events).toEqual([{ attempt: 1, willRetry: true }, { attempt: 2, willRetry: true }]);
});

test("treats an already stopped turn as successful after an ambiguous timeout", async () => {
  let attempts = 0;
  await interruptTurnWithRetry({
    rpc: async () => {
      attempts += 1;
      if (attempts === 1) throw { message: "WebSocket disconnected" };
      throw { message: "turn is not running" };
    },
    threadId: "thread",
    turnId: "turn",
    delay: async () => undefined
  });
  expect(attempts).toBe(2);
});

test("classifies only transient interrupt errors for replay", () => {
  expect(isRetryableInterruptError({ message: "Request 'turn/interrupt' timed out after 15s" })).toBe(true);
  expect(isRetryableInterruptError({ message: "permission denied" })).toBe(false);
  expect(isAlreadyStoppedInterruptError({ message: "no active turn" })).toBe(true);
});

test("treats a stopped remote app-server as an already stopped turn", () => {
  expect(isAlreadyStoppedInterruptError({ message: "Remote Codex app-server is not running" })).toBe(true);
  expect(isAlreadyStoppedInterruptError({ message: "Remote Codex app-server exited with code 255 signal null" })).toBe(true);
});

test("recognizes stale historical turns so callers can start a fresh turn", () => {
  expect(isTurnNoLongerActiveError({ message: "turn not found" })).toBe(true);
  expect(isTurnNoLongerActiveError(new Error("turn is not active"))).toBe(true);
  expect(isTurnNoLongerActiveError(new Error("turn id changed"))).toBe(false);
});

test("interrupts the server-authoritative turn after an active turn id race", async () => {
  const requestedTurnIds: string[] = [];
  await interruptTurnWithRetry({
    rpc: async (_method, params) => {
      const turnId = (params as { turnId: string }).turnId;
      requestedTurnIds.push(turnId);
      if (requestedTurnIds.length === 1) {
        throw {
          message: "expected active turn id 019fe615-ed64-7473-8de8-a220ff872e10 but found 019fe615-f2cb-78a1-b5ca-424881c2d631"
        };
      }
      return {};
    },
    threadId: "thread-goal-review",
    turnId: "019fe615-ed64-7473-8de8-a220ff872e10"
  });

  expect(requestedTurnIds).toEqual([
    "019fe615-ed64-7473-8de8-a220ff872e10",
    "019fe615-f2cb-78a1-b5ca-424881c2d631"
  ]);
});

test("extracts only a server-authoritative active turn mismatch", () => {
  expect(extractActualActiveTurnId({
    message: "Stop turn: expected active turn id '019fe615-ed64-7473-8de8-a220ff872e10' but found '019fe615-f2cb-78a1-b5ca-424881c2d631'"
  })).toBe("019fe615-f2cb-78a1-b5ca-424881c2d631");
  expect(extractActualActiveTurnId({ message: "active turn id 019fe615-f2cb-78a1-b5ca-424881c2d631" })).toBe(null);
});

test("limits active turn id correction to one authoritative retry", async () => {
  let attempts = 0;
  const secondMismatch = {
    message: "expected active turn id 019fe615-f2cb-78a1-b5ca-424881c2d631 but found 019fe615-faf3-7a15-b2bb-828ad1096dcc"
  };

  await expect(interruptTurnWithRetry({
    rpc: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw {
          message: "expected active turn id 019fe615-ed64-7473-8de8-a220ff872e10 but found 019fe615-f2cb-78a1-b5ca-424881c2d631"
        };
      }
      throw secondMismatch;
    },
    threadId: "thread-goal-review",
    turnId: "019fe615-ed64-7473-8de8-a220ff872e10"
  })).rejects.toBe(secondMismatch);
  expect(attempts).toBe(2);
});
