import { expect, test } from "bun:test";
import { beginThreadSelection, isThreadSelectionCurrent, shouldRenderCachedTranscript } from "../../apps/web/src/threadSelection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("rapid A/B/C/D history switches load every transcript and keep focus on D", async () => {
  const epochRef = { current: 0 };
  const activeThreadIdRef = { current: null as string | null };
  const requests = new Map(["A", "B", "C", "D"].map((threadId) => [threadId, deferred<string[]>()]));
  const loaded = new Map<string, string[]>();
  let focusedTranscript: string[] = [];

  const open = (threadId: string) => {
    const selection = beginThreadSelection(epochRef, activeThreadIdRef, threadId);
    return requests.get(threadId)!.promise.then((turns) => {
      loaded.set(threadId, turns);
      if (isThreadSelectionCurrent(selection, epochRef, activeThreadIdRef)) {
        focusedTranscript = turns;
      }
    });
  };

  const pending = [open("A"), open("B"), open("C"), open("D")];
  expect(activeThreadIdRef.current).toBe("D");

  requests.get("B")!.resolve(["B turn"]);
  requests.get("A")!.resolve(["A turn"]);
  requests.get("C")!.resolve(["C turn"]);
  await Promise.resolve();
  expect([...loaded.keys()].sort()).toEqual(["A", "B", "C"]);
  expect(focusedTranscript).toEqual([]);

  requests.get("D")!.resolve(["D turn"]);
  await Promise.all(pending);

  expect([...loaded.keys()].sort()).toEqual(["A", "B", "C", "D"]);
  expect(activeThreadIdRef.current).toBe("D");
  expect(focusedTranscript).toEqual(["D turn"]);
});

test("reselecting a thread invalidates its earlier in-flight request", async () => {
  const epochRef = { current: 0 };
  const activeThreadIdRef = { current: null as string | null };
  const firstA = beginThreadSelection(epochRef, activeThreadIdRef, "A");
  beginThreadSelection(epochRef, activeThreadIdRef, "B");
  const secondA = beginThreadSelection(epochRef, activeThreadIdRef, "A");

  expect(isThreadSelectionCurrent(firstA, epochRef, activeThreadIdRef)).toBe(false);
  expect(isThreadSelectionCurrent(secondA, epochRef, activeThreadIdRef)).toBe(true);
});

test("cached transcript advances to rendering only for the current selection", () => {
  expect(shouldRenderCachedTranscript({ hasCachedTranscript: true, selectionEpoch: 4, currentEpoch: 4, threadId: "A", activeThreadId: "A" })).toBe(true);
  expect(shouldRenderCachedTranscript({ hasCachedTranscript: false, selectionEpoch: 4, currentEpoch: 4, threadId: "A", activeThreadId: "A" })).toBe(false);
  expect(shouldRenderCachedTranscript({ hasCachedTranscript: true, selectionEpoch: 3, currentEpoch: 4, threadId: "A", activeThreadId: "A" })).toBe(false);
  expect(shouldRenderCachedTranscript({ hasCachedTranscript: true, selectionEpoch: 4, currentEpoch: 4, threadId: "A", activeThreadId: "B" })).toBe(false);
});
