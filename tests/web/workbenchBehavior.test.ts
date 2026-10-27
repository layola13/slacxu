import { expect, test } from "bun:test";
import type { ProviderConfig } from "@codex-ui/shared";
import { appReducer } from "../../apps/web/src/app/appReducer";
import { clampFreeAutoCompactThreshold } from "../../frontends/free-mode/src/free/freeAutoCompactPreferences";
import { checkFreeCompactionReadiness } from "../../frontends/free-mode/src/free/freeCompactionReadiness";
import { PendingSendGate } from "../../apps/web/src/composer/PendingSendGate";
import { initialClientState } from "../../apps/web/src/state/codexClient";
import {
  closeWorkspacePane,
  createWorkspaceLayout,
  layoutPaneIds,
  parseWorkspaceLayoutState,
  replaceWorkspacePaneThread,
  splitWorkspacePane
} from "../../apps/web/src/taskTabs";

function provider(id: string, groups: ProviderConfig["groups"] = []): ProviderConfig {
  return {
    id,
    kind: "responsesRelay",
    name: id,
    nativeModels: [],
    modelAliases: [],
    groups
  } as ProviderConfig;
}

test("free compaction readiness rejects every unsafe activation state", () => {
  const base = {
    currentModel: "gpt-5.6",
    providers: [provider("relay")],
    workspaceMode: "local",
    activeThreadId: "thread-1"
  } as const;

  expect(checkFreeCompactionReadiness({ ...base, activeThreadId: null })).toMatchObject({ reason: "no-active-thread" });
  expect(checkFreeCompactionReadiness({ ...base, workspaceMode: "ssh" })).toMatchObject({ reason: "remote-workspace" });
  expect(checkFreeCompactionReadiness({ ...base, currentModel: "" })).toMatchObject({ reason: "no-current-model" });
  expect(checkFreeCompactionReadiness({ ...base, manualProviderId: "relay", manualGroupId: "group" })).toMatchObject({ reason: "manual-route-incomplete" });
  expect(checkFreeCompactionReadiness({ ...base, manualProviderId: "missing", manualGroupId: "group", manualFreeModel: "compact" })).toMatchObject({ reason: "provider-missing" });
});

test("free compaction threshold is rounded and clamped to the supported range", () => {
  expect(clampFreeAutoCompactThreshold(49)).toBe(50);
  expect(clampFreeAutoCompactThreshold(72.6)).toBe(73);
  expect(clampFreeAutoCompactThreshold(96)).toBe(95);
});

test("pending send reservations remain isolated and release after failure", () => {
  const gate = new PendingSendGate();
  expect(gate.beginCommit("a")).toBe(true);
  expect(gate.beginCommit("a")).toBe(true);
  expect(gate.cancel("a")).toBe(false);
  expect(gate.canCommit("b")).toBe(true);
  expect(gate.cancel("b")).toBe(true);
  expect(gate.canCommit("a")).toBe(true);
  expect(gate.canCommit("b")).toBe(false);
  gate.release("a");
  gate.release("b");
  expect(gate.beginCommit("a")).toBe(true);
  expect(gate.beginCommit("b")).toBe(true);
});

test("closing a focused split pane promotes a surviving pane and clears invalid maximize state", () => {
  const layout = createWorkspaceLayout(["left", "middle", "right"], "columns");
  const focused = { ...layout, focusedPaneId: "pane-2", maximizedPaneId: "pane-2" };
  const next = closeWorkspacePane(focused, "pane-2");

  expect(layoutPaneIds(next.root)).toEqual(["pane-1", "pane-3"]);
  expect(next.focusedPaneId).toBe("pane-1");
  expect(next.maximizedPaneId).toBeNull();
  expect(next.panes.map((pane) => pane.threadId)).toEqual(["left", "right"]);
});

test("split and replace operations reject duplicate panes and swap existing threads", () => {
  const layout = createWorkspaceLayout(["a", "b"], "columns");
  expect(splitWorkspacePane(layout, "missing", "right", { id: "pane-3", threadId: "c" })).toBeNull();
  expect(splitWorkspacePane(layout, "pane-1", "right", { id: "pane-1", threadId: "c" })).toBeNull();

  const swapped = replaceWorkspacePaneThread(layout, "pane-1", "b");
  expect(swapped.panes.map((pane) => pane.threadId)).toEqual(["b", "a"]);
  expect(swapped.focusedPaneId).toBe("pane-1");
});

test("persisted workspace layouts reject duplicate pane ids, thread ids, and dangling nodes", () => {
  const layout = createWorkspaceLayout(["a", "b"], "columns");
  const serialized = JSON.parse(JSON.stringify(layout)) as Record<string, unknown>;

  expect(parseWorkspaceLayoutState({ ...serialized, panes: [layout.panes[0], { ...layout.panes[1], id: "pane-1" }] })).toBeNull();
  expect(parseWorkspaceLayoutState({ ...serialized, panes: [layout.panes[0], { ...layout.panes[1], threadId: "a" }] })).toBeNull();
  expect(parseWorkspaceLayoutState({ ...serialized, root: { type: "pane", paneId: "missing" } })).toBeNull();
});

test("app reducer deduplicates server requests and bounds error history", () => {
  let state = appReducer(initialClientState, {
    type: "serverRequest",
    message: { id: "request-1", method: "approval", params: {} } as never
  });
  state = appReducer(state, {
    type: "serverRequest",
    message: { id: "request-1", method: "approval-updated", params: { value: true } } as never
  });
  expect(state.pendingRequests).toHaveLength(1);
  expect(state.pendingRequests[0]).toMatchObject({ id: "request-1", method: "approval-updated" });

  for (let index = 0; index < 10; index += 1) {
    state = appReducer(state, { type: "error", message: `error-${index}` });
  }
  expect(state.errors).toHaveLength(8);
  expect(state.errors[0]).toBe("error-9");
  state = appReducer(state, { type: "serverRequestResolved", id: "request-1" });
  expect(state.pendingRequests).toHaveLength(0);
});

test("app reducer evicts only transcripts belonging to requested threads", () => {
  const turns = [
    { id: "turn-a", threadId: "thread-a", status: "completed", items: [] },
    { id: "turn-b", threadId: "thread-b", status: "completed", items: [] }
  ] as never;
  const state = { ...initialClientState, turns };
  const next = appReducer(state, { type: "threadTranscriptsEvicted", threadIds: ["thread-a"] });
  expect(next.turns.map((turn) => turn.id)).toEqual(["turn-b"]);
});
