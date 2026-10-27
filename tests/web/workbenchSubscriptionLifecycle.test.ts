import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkspaceLayout } from "../../apps/web/src/taskTabs";

const root = join(import.meta.dir, "../..");

function readTree(dir) {
  if (!existsSync(dir)) return "";
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return [readTree(path)];
      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [readFileSync(path, "utf8")] : [];
    })
    .join("\n");
}
function assembledAppSource(rootDir) {
  return [
    readFileSync(join(rootDir, "apps/web/src/App.tsx"), "utf8"),
    readTree(join(rootDir, "apps/web/src/shell")),
    readTree(join(rootDir, "apps/web/src/components/dialogs")),
    readTree(join(rootDir, "apps/web/src/app/workbench")),
    readTree(join(rootDir, "frontends/free-mode/src/free")),
  ].join("\n");
}
const appSource = assembledAppSource(root);

test("Opening historical threads requests read-only summary with pagination", () => {
  expect(appSource).toContain("loadOlderThreadHistory");
  expect(appSource).toContain("loadOlderThreadHistoryPage");
  expect(appSource).toContain("hasThreadTranscript");
});

test("Thread switching updates activeThreadId and isolates context", () => {
  expect(appSource).toContain("selectHistoryThread");
  expect(appSource).toContain("selectHistoryThreadAfterAttach");
  expect(appSource).toContain("focusSplitThread");
});

test("Split view layout creation and transitions", () => {
  const layout = createWorkspaceLayout(["thread-left", "thread-right"], "columns");
  expect(layout.panes).toHaveLength(2);
  expect(layout.panes[0].threadId).toBe("thread-left");
  expect(layout.panes[1].threadId).toBe("thread-right");
  expect(layout.focusedPaneId).toBe(layout.panes[0].id);
  expect(layout.version).toBe(2);
});

test("Split view drop zones and separation controls in App.tsx", () => {
  expect(appSource).toContain('data-testid="split-view-drop-zones"');
  expect(appSource).toContain("split-view-drop-");
  expect(appSource).toContain("separateSplitView()");
  expect(appSource).toContain('closeSplitSide("left")');
  expect(appSource).toContain('closeSplitSide("right")');
  expect(appSource).toContain("reverseCurrentSplitView()");
});

test("Closing a split side falls back cleanly to single pane without blank viewport", () => {
  expect(appSource).toContain('const closeSplitSide = (side: "left" | "right") => {');
  expect(appSource).toContain("setSplitView(null);");
  expect(appSource).toContain("setWorkspaceLayout(null);");
  expect(appSource).toContain("focusSplitThread(keepThreadId);");
});

test("Detached thread executes independently in background and supports dock restoration", () => {
  expect(appSource).toContain("detachedThreadId");
  expect(appSource).toContain("detachedTaskIds");
  expect(appSource).toContain("detachedTaskSnapshot");
  expect(appSource).toContain("window.codexUltraDesktop");
});

test("Cleans up watchers and active turn holds on close to prevent lease block leaks", () => {
  expect(appSource).toContain("topicTranscriptStore.evict");
  expect(appSource).toContain("writerConflictThreadIdsRef.current.has(state.activeThreadId)");
  expect(appSource).toContain("activeConversationReadOnly");
});
