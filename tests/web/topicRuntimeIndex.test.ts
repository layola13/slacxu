import { expect, test } from "bun:test";
import {
  isRunningTurnStatus,
  latestActionableRunningTurn,
  normalizeRuntimeTimestamp,
  runningTurnsForThread,
  staleRunningTurnsForThread
} from "../../apps/web/src/app/transcripts/topicRuntimeIndex.ts";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";

const turn = (id: string, status: string, startedAt?: number): WorkbenchTurn => ({
  id,
  threadId: "thread-mixed-clock",
  status,
  ...(startedAt === undefined ? {} : { startedAt }),
  items: []
});

test("normalizes seconds and milliseconds to the same runtime clock", () => {
  expect(normalizeRuntimeTimestamp(1_725_000_000)).toBe(1_725_000_000_000);
  expect(normalizeRuntimeTimestamp(1_725_000_000_000)).toBe(1_725_000_000_000);
  expect(normalizeRuntimeTimestamp(undefined)).toBeNull();
});

test("keeps a newer seconds-based running turn actionable after millisecond terminal history", () => {
  const turns = [
    turn("old-completed", "completed", 1_725_000_000_000),
    turn("new-running", "inProgress", 1_725_000_001)
  ];
  expect(latestActionableRunningTurn(turns, "thread-mixed-clock")?.id).toBe("new-running");
  expect(staleRunningTurnsForThread(turns, "thread-mixed-clock")).toHaveLength(0);
});

test("conservatively keeps untimed running turns instead of labeling them stale", () => {
  const turns = [
    turn("completed", "completed", 1_725_000_000_000),
    turn("untimed-running", "running")
  ];
  expect(runningTurnsForThread(turns, "thread-mixed-clock")).toHaveLength(1);
  expect(latestActionableRunningTurn(turns, "thread-mixed-clock")?.id).toBe("untimed-running");
  expect(staleRunningTurnsForThread(turns, "thread-mixed-clock")).toHaveLength(0);
});

test("recognizes protocol running status spellings", () => {
  expect(isRunningTurnStatus("in_progress")).toBe(true);
  expect(isRunningTurnStatus("pending-init")).toBe(true);
  expect(isRunningTurnStatus("COMPLETED")).toBe(false);
});
