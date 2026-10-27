import { expect, test } from "bun:test";
import { closeWorkspacePane, createWorkspaceLayout, layoutPaneIds, openTaskTab, parseSplitViewState, parseWorkspaceLayoutState, readSplitViewState, reconcileOpenedTaskTabOrder, reconcileSplitViewState, reconcileWorkspaceLayout, replaceWorkspacePaneThread, reverseSplitView, splitWorkspacePane, twoPaneSplitView } from "../../apps/web/src/taskTabs";

function storage(value: string | null) {
  return { getItem: () => value };
}

test("reads and validates persisted split view state", () => {
  expect(readSplitViewState(storage(JSON.stringify({ leftThreadId: "left", rightThreadId: "right" })), "split")).toEqual({
    leftThreadId: "left",
    rightThreadId: "right"
  });
  expect(readSplitViewState(storage(JSON.stringify({ leftThreadId: "same", rightThreadId: "same" })), "split")).toBeNull();
  expect(readSplitViewState(storage("not-json"), "split")).toBeNull();
  expect(parseSplitViewState({ leftThreadId: " left ", rightThreadId: " right " })).toEqual({ leftThreadId: "left", rightThreadId: "right" });
});

test("reconciles and reverses split view state", () => {
  const split = { leftThreadId: "left", rightThreadId: "right" };
  expect(reconcileSplitViewState(split, ["left", "right", "third"])).toEqual(split);
  expect(reconcileSplitViewState(split, ["left"])).toBeNull();
  expect(reverseSplitView(split)).toEqual({ leftThreadId: "right", rightThreadId: "left" });
});

test("keeps only explicitly opened task tabs and appends newly activated conversations", () => {
  const threads = [{ id: "opened" }, { id: "history-only" }] as never[];
  expect(reconcileOpenedTaskTabOrder(["missing", "opened"], threads)).toEqual(["opened"]);
  expect(openTaskTab(["opened"], "history-only")).toEqual(["opened", "history-only"]);
  expect(openTaskTab(["opened"], "opened")).toEqual(["opened"]);
});

test("creates common recursive workspace layouts", () => {
  const leftOne = createWorkspaceLayout(["a", "b", "c"], "left-one-right-two");
  expect(leftOne.root).toMatchObject({
    type: "split", direction: "horizontal",
    children: [{ type: "pane" }, { type: "split", direction: "vertical" }]
  });
  expect(layoutPaneIds(leftOne.root)).toEqual(["pane-1", "pane-2", "pane-3"]);
  expect(createWorkspaceLayout(["a", "b", "c", "d"], "grid-2x2").root).toMatchObject({
    type: "split", direction: "vertical",
    children: [{ type: "split", direction: "horizontal" }, { type: "split", direction: "horizontal" }]
  });
});

test("validates persisted recursive workspace layouts", () => {
  const layout = createWorkspaceLayout(["a", "b", "c", "d"], "grid-2x2");
  expect(parseWorkspaceLayoutState(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  expect(parseWorkspaceLayoutState({ ...layout, panes: [...layout.panes, layout.panes[0]] })).toBeNull();
  expect(parseWorkspaceLayoutState({ ...layout, root: { type: "pane", paneId: "missing" } })).toBeNull();
  expect(parseWorkspaceLayoutState({ ...layout, panes: layout.panes.map((pane) => ({ ...pane, threadId: "same" })) })).toBeNull();
});

test("splits a pane in four directions and flattens matching groups", () => {
  const initial = createWorkspaceLayout(["a", "b"], "columns");
  const next = splitWorkspacePane(initial, "pane-1", "right", { id: "pane-3", threadId: "c" });
  expect(next).not.toBeNull();
  expect(next?.root).toMatchObject({ type: "split", direction: "horizontal" });
  expect(layoutPaneIds(next!.root)).toEqual(["pane-1", "pane-3", "pane-2"]);
  const nested = splitWorkspacePane(next!, "pane-3", "down", { id: "pane-4", threadId: "d" });
  expect(layoutPaneIds(nested!.root)).toEqual(["pane-1", "pane-3", "pane-4", "pane-2"]);
});

test("closes panes, promotes surviving children, and enforces the six-pane limit", () => {
  const grid = createWorkspaceLayout(["a", "b", "c", "d"], "grid-2x2");
  const withoutTopLeft = closeWorkspacePane(grid, "pane-1");
  expect(layoutPaneIds(withoutTopLeft.root)).toEqual(["pane-2", "pane-3", "pane-4"]);
  const six = createWorkspaceLayout(["a", "b", "c", "d", "e", "f"], "grid-2x3");
  expect(splitWorkspacePane(six, "pane-1", "left", { id: "pane-7", threadId: "g" })).toBeNull();
});

test("replaces or swaps pane threads while keeping legacy two-pane state synchronized", () => {
  const layout = createWorkspaceLayout(["a", "b"], "columns");
  const replaced = replaceWorkspacePaneThread(layout, "pane-1", "c");
  expect(replaced.panes.map((pane) => pane.threadId)).toEqual(["c", "b"]);
  expect(twoPaneSplitView(replaced)).toEqual({ leftThreadId: "c", rightThreadId: "b" });
  const swapped = replaceWorkspacePaneThread(replaced, "pane-1", "b");
  expect(swapped.panes.map((pane) => pane.threadId)).toEqual(["b", "c"]);
  expect(twoPaneSplitView(createWorkspaceLayout(["a", "b", "c"], "columns"))).toBeNull();
});

test("removes unavailable threads from restored recursive layouts", () => {
  const grid = createWorkspaceLayout(["a", "b", "c", "d"], "grid-2x2");
  const reconciled = reconcileWorkspaceLayout(grid, ["a", "d"]);
  expect(reconciled?.panes.map((pane) => pane.threadId)).toEqual(["a", "d"]);
  expect(reconcileWorkspaceLayout(grid, ["missing"])).toBeNull();
});
