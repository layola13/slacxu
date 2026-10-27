import { expect, test } from "bun:test";
import { ThreadLoadQueue } from "../../apps/web/src/app/threads/ThreadLoadQueue.ts";

test("thread load queue deduplicates a thread and limits concurrent IO", async () => {
  const queue = new ThreadLoadQueue(2);
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  let active = 0;
  let peak = 0;
  const load = (id: string) => queue.enqueue(id, async () => {
    started.push(id);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.set(id, resolve));
    active -= 1;
  });

  const a = load("a");
  const duplicateA = load("a");
  const b = load("b");
  const c = load("c");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(a).toBe(duplicateA);
  expect(started).toEqual(["a", "b"]);
  expect(peak).toBe(2);

  releases.get("a")?.();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(started).toEqual(["a", "b", "c"]);
  releases.get("b")?.();
  releases.get("c")?.();
  await Promise.all([a, b, c]);
});
