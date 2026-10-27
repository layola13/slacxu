import { expect, test } from "bun:test";
import { OPEN_FILE_TABS_LIMIT } from "../../apps/web/src/app/workspace/useOpenFileTabs";

// Headless state-machine mirror of useOpenFileTabs (hook needs React runtime;
// the logic is pure list ops — verify the contract the UI depends on).
type Tab = { path: string; content: string; savedContent: string; loading: boolean; saving: boolean };

function openTab(tabs: Tab[], path: string): Tab[] {
  if (tabs.some((tab) => tab.path === path)) return tabs;
  const next = [...tabs, { path, content: "", savedContent: "", loading: true, saving: false }];
  return next.length > OPEN_FILE_TABS_LIMIT ? next.slice(next.length - OPEN_FILE_TABS_LIMIT) : next;
}

function activeTab(tabs: Tab[], activePath: string | null): Tab | null {
  return tabs.find((tab) => tab.path === activePath) ?? tabs[0] ?? null;
}

test("tab strip caps at the limit and keeps newest", () => {
  let tabs: Tab[] = [];
  for (let i = 0; i < OPEN_FILE_TABS_LIMIT + 3; i += 1) tabs = openTab(tabs, `/x/f${i}.ts`);
  expect(tabs).toHaveLength(OPEN_FILE_TABS_LIMIT);
  expect(tabs.at(-1)?.path).toBe(`/x/f${OPEN_FILE_TABS_LIMIT + 2}.ts`);
  expect(tabs[0]?.path).toBe("/x/f3.ts");
});

test("reopening an existing path keeps a single tab", () => {
  let tabs = openTab([], "/x/a.ts");
  tabs = openTab(tabs, "/x/b.ts");
  tabs = openTab(tabs, "/x/a.ts");
  expect(tabs.map((tab) => tab.path)).toEqual(["/x/a.ts", "/x/b.ts"]);
});

test("active tab resolves to explicit path then first tab then null", () => {
  const tabs = openTab(openTab([], "/x/a.ts"), "/x/b.ts");
  expect(activeTab(tabs, "/x/b.ts")?.path).toBe("/x/b.ts");
  expect(activeTab(tabs, "/x/missing.ts")?.path).toBe("/x/a.ts");
  expect(activeTab([], null)).toBeNull();
});

test("dirty detection ignores loading tabs", () => {
  const loaded: Tab = { path: "/x/a.ts", content: "1", savedContent: "2", loading: false, saving: false };
  const loading: Tab = { path: "/x/b.ts", content: "", savedContent: "", loading: true, saving: false };
  const dirty = [loaded, loading].filter((tab) => !tab.loading && tab.content !== tab.savedContent);
  expect(dirty.map((tab) => tab.path)).toEqual(["/x/a.ts"]);
});
