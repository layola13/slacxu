import { expect, test } from "bun:test";
import { PendingSendGate } from "../../apps/web/src/composer/PendingSendGate.ts";

test("cancels a waiting message before it enters a turn", () => {
  const gate = new PendingSendGate();
  expect(gate.cancel("pending-1")).toBe(true);
  expect(gate.canCommit("pending-1")).toBe(false);
  expect(gate.beginCommit("pending-1")).toBe(false);
  gate.release("pending-1");
  expect(gate.canCommit("pending-1")).toBe(true);
});

test("does not cancel a message after the turn request committed", () => {
  const gate = new PendingSendGate();
  expect(gate.beginCommit("pending-2")).toBe(true);
  expect(gate.cancel("pending-2")).toBe(false);
  expect(gate.canCommit("pending-2")).toBe(true);
});
