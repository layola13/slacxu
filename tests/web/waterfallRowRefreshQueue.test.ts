import { expect, test } from "bun:test";
import { WaterfallRowRefreshQueue } from "../../apps/web/src/waterfall/waterfallRowRefreshQueue";

test("waterfall row refresh queue keeps only the latest pending snapshot and flushes serially", () => {
  const initialRows = [{ key: "a" }] as never[];
  const firstRows = [{ key: "b" }] as never[];
  const latestRows = [{ key: "c" }] as never[];
  const queue = new WaterfallRowRefreshQueue(initialRows);

  expect(queue.enqueue(firstRows)).toBe(true);
  expect(queue.enqueue(latestRows)).toBe(true);
  expect(queue.hasPending()).toBe(true);

  expect(queue.beginFlush()).toBe(latestRows);
  expect(queue.beginFlush()).toBe(null);

  queue.markApplied(latestRows);
  expect(queue.beginFlush()).toBe(null);
  expect(queue.hasPending()).toBe(false);
  expect(queue.enqueue(latestRows)).toBe(false);
});

test("waterfall row refresh queue collapses a burst of 100 snapshots to 1 final flush", () => {
  const initialRows = [{ key: "initial" }] as never[];
  const queue = new WaterfallRowRefreshQueue(initialRows);

  const snapshots: any[][] = [];
  for (let i = 0; i < 100; i++) {
    const snap = [{ key: `row-${i}` }];
    snapshots.push(snap);
    expect(queue.enqueue(snap as never[])).toBe(true);
  }

  expect(queue.hasPending()).toBe(true);

  // Exactly the 100th snapshot should be returned
  const flushed = queue.beginFlush();
  expect(flushed).toBe(snapshots[99] as never[]);

  // Intermediate snapshots are dropped; subsequent beginFlush returns null until applied
  expect(queue.beginFlush()).toBe(null);

  queue.markApplied(flushed!);
  expect(queue.hasPending()).toBe(false);
  expect(queue.beginFlush()).toBe(null);
});

