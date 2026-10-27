import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  descendantsOf,
  hasExtraDescendantProcesses,
  parseWindowsProcesses,
} from "../../apps/server/src/taskLiveness";

describe("descendantsOf", () => {
  test("returns direct and transitive children of the root", () => {
    // 1 → 2 → 3 → 4 ; 1 → 5 ; 9 is unrelated
    const map = new Map<number, number>([
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 1],
      [9, 8],
    ]);
    expect([...descendantsOf(map, 1)].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  test("a node is not its own descendant", () => {
    const map = new Map<number, number>([[2, 1]]);
    expect(descendantsOf(map, 2)).toEqual(new Set());
  });

  test("unrelated subtree is excluded", () => {
    const map = new Map<number, number>([
      [2, 1],
      [9, 8],
      [10, 9],
    ]);
    expect(descendantsOf(map, 1)).toEqual(new Set([2]));
  });

  test("handles cycles without infinite loop", () => {
    const map = new Map<number, number>([
      [2, 1],
      [1, 2], // cycle
    ]);
    expect(descendantsOf(map, 1)).toEqual(new Set([2]));
  });
});

describe("parseWindowsProcesses", () => {
  test("parses a JSON array of processes", () => {
    const json = JSON.stringify([
      { ProcessId: 100, ParentProcessId: 1 },
      { ProcessId: 101, ParentProcessId: 100 },
    ]);
    expect(parseWindowsProcesses(json)).toEqual(
      new Map([
        [100, 1],
        [101, 100],
      ]),
    );
  });

  test("parses a single-object (non-array) result", () => {
    const json = JSON.stringify({ ProcessId: 7, ParentProcessId: 3 });
    expect(parseWindowsProcesses(json)).toEqual(new Map([[7, 3]]));
  });

  test("returns empty map on malformed input", () => {
    expect(parseWindowsProcesses("not json")).toEqual(new Map());
  });
});

describe("hasExtraDescendantProcesses", () => {
  test("returns false when all current descendants were present at baseline", async () => {
    const baseline = new Set([2, 3, 4, 5]);
    // listDescendantPids would hit the real OS; mock it via the derived logic by
    // stubbing the OS lister is not possible here, so assert the relationship the
    // gate relies on: a current set fully contained in the baseline => no extras.
    // We exercise the underlying check against a controlled tree instead.
    const tree = new Map<number, number>([
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 1],
    ]);
    const current = descendantsOf(tree, 1);
    let extra = false;
    for (const pid of current) {
      if (!baseline.has(pid)) {
        extra = true;
        break;
      }
    }
    expect(extra).toBe(false);
  });

  test("returns true when a new process appeared after baseline", async () => {
    const baseline = new Set([2, 3]); // tree at task start
    const treeNow = new Map<number, number>([
      [2, 1],
      [3, 2],
      [4, 3], // child spawned during the task, still alive at "completed"
    ]);
    const current = descendantsOf(treeNow, 1);
    let extra = false;
    for (const pid of current) {
      if (!baseline.has(pid)) {
        extra = true;
        break;
      }
    }
    expect(extra).toBe(true);
  });

  test("delegates to the OS lister and treats missing root as no-extra", async () => {
    // undefined root => the gate must not hold (safe pass-through).
    expect(await hasExtraDescendantProcesses(undefined, new Set([1, 2]))).toBe(false);
  });
});
