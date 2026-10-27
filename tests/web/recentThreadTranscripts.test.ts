import { expect, test } from "bun:test";
import { touchRecentThreadTranscript } from "../../apps/web/src/state/recentThreadTranscripts.ts";

test("keeps a bounded LRU of recent non-running transcripts", () => {
  const result = touchRecentThreadTranscript(["a", "b", "c"], "d", "d", new Set(), 3);
  expect(result).toEqual({ recentThreadIds: ["b", "c", "d"], evictedThreadIds: ["a"] });
});

test("moves an existing transcript to the most-recent position", () => {
  const result = touchRecentThreadTranscript(["a", "b", "c"], "b", "b", new Set(), 3);
  expect(result).toEqual({ recentThreadIds: ["a", "c", "b"], evictedThreadIds: [] });
});

test("does not evict running transcripts when the cache is over capacity", () => {
  const result = touchRecentThreadTranscript(["running-a", "idle-b", "running-c"], "active-d", "active-d", new Set(["running-a", "running-c"]), 3);
  expect(result).toEqual({ recentThreadIds: ["running-a", "running-c", "active-d"], evictedThreadIds: ["idle-b"] });
});

test("bounds completed transcripts while preserving active and running work", () => {
  const result = touchRecentThreadTranscript(
    ["old", "running", "b", "c", "d", "e", "f", "g"],
    "active",
    "active",
    new Set(["running"])
  );
  expect(result).toEqual({
    recentThreadIds: ["running", "b", "c", "d", "e", "f", "g", "active"],
    evictedThreadIds: ["old"]
  });
});

test("preserves visible split panes when the cache exceeds its limit", () => {
  const result = touchRecentThreadTranscript(
    ["split-left", "old", "split-right", "a"],
    "new-active",
    "new-active",
    new Set(["split-left", "split-right"]),
    4
  );
  expect(result).toEqual({
    recentThreadIds: ["split-left", "split-right", "a", "new-active"],
    evictedThreadIds: ["old"]
  });
});
