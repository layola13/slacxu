import { beforeEach, expect, test } from "bun:test";
import {
  applyNotification,
  initialClientState,
  resetTurnTimestampProvenanceForTests,
} from "../../apps/web/src/state/codexClient";

const T = "thr-ts";
const U = "turn-ts";
const n = (method: string, params: Record<string, unknown>) => ({ jsonrpc: "2.0", method, params }) as any;
const fresh = () => ({ ...initialClientState, activeThreadId: T }) as any;
const statusOf = (s: any) => s.turns.find((t: any) => t.id === U)?.status;

beforeEach(() => {
  resetTurnTimestampProvenanceForTests();
});

test("browser-fabricated startedAt never discards a server terminal (clock skew)", () => {
  let s = fresh();
  // Relay omits startedAt: client fabricates browser now.
  s = applyNotification(s, n("turn/started", { threadId: T, turnId: U, turn: { id: U, threadId: T, status: "inProgress" } }));
  const fabricatedStartedAt = s.turns.find((t: any) => t.id === U)?.startedAt;
  expect(typeof fabricatedStartedAt).toBe("number");
  // Server clock runs an hour behind the browser: completedAt < fabricated startedAt.
  s = applyNotification(s, n("turn/completed", {
    threadId: T,
    turnId: U,
    completedAt: fabricatedStartedAt - 3600,
    turn: { id: U, threadId: T, status: "completed", completedAt: fabricatedStartedAt - 3600 },
  }));
  expect(statusOf(s)).toBe("completed");
});

test("genuinely stale terminal is still dropped when startedAt is server-provided", () => {
  const serverStart = Math.floor(Date.now() / 1000);
  let s = fresh();
  s = applyNotification(s, n("turn/started", { threadId: T, turnId: U, turn: { id: U, threadId: T, status: "inProgress", startedAt: serverStart } }));
  // Delayed terminal from an earlier execution reusing the same turn id.
  s = applyNotification(s, n("turn/completed", {
    threadId: T,
    turnId: U,
    completedAt: serverStart - 10,
    turn: { id: U, threadId: T, status: "completed", completedAt: serverStart - 10 },
  }));
  expect(statusOf(s)).toBe("inProgress");
});

test("server-started turn still completes on a normal terminal", () => {
  const serverStart = Math.floor(Date.now() / 1000) - 30;
  let s = fresh();
  s = applyNotification(s, n("turn/started", { threadId: T, turnId: U, turn: { id: U, threadId: T, status: "inProgress", startedAt: serverStart } }));
  s = applyNotification(s, n("turn/completed", {
    threadId: T,
    turnId: U,
    completedAt: serverStart + 5,
    turn: { id: U, threadId: T, status: "completed", completedAt: serverStart + 5 },
  }));
  expect(statusOf(s)).toBe("completed");
});

test("untimestamped terminal stays ambiguous while a child item runs, recovers after", () => {
  let s = fresh();
  s = applyNotification(s, n("turn/started", { threadId: T, turnId: U, turn: { id: U, threadId: T, status: "inProgress" } }));
  s = applyNotification(s, n("item/started", { threadId: T, turnId: U, item: { type: "reasoning", id: "r1", turnId: U, status: "inProgress", text: "..." } }));
  // Mini-shaped terminal: no completedAt anywhere.
  s = applyNotification(s, n("turn/completed", { threadId: T, turnId: U, turn: { id: U, threadId: T, status: "completed" } }));
  expect(statusOf(s)).toBe("inProgress");
  // The stranded item lands, the next terminal (retry/dup delivery) applies.
  s = applyNotification(s, n("item/completed", { threadId: T, turnId: U, item: { type: "reasoning", id: "r1", turnId: U, status: "completed", text: "done" } }));
  s = applyNotification(s, n("turn/completed", { threadId: T, turnId: U, turn: { id: U, threadId: T, status: "completed" } }));
  expect(statusOf(s)).toBe("completed");
});
