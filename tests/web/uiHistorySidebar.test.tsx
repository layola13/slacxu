import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HistorySidebar } from "../../apps/web/src/history/HistorySidebar";
import type { ThreadEntry } from "../../apps/web/src/state/codexClient";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined }
});

const t = (k: string) => k;

const sampleThreads: ThreadEntry[] = [
  {
    id: "thread-local-1",
    name: "Refactor Database Module",
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-01T11:00:00Z",
    workspaceMode: "local",
    cliBackend: "codex"
  },
  {
    id: "thread-ssh-2",
    name: "Deploy Remote Cluster",
    createdAt: "2026-03-02T10:00:00Z",
    updatedAt: "2026-03-02T11:00:00Z",
    workspaceMode: "ssh",
    sshCommand: "ssh vscode@45.129.8.163",
    cliBackend: "codex"
  }
];

test("HistorySidebar UI renders search box and action controls", () => {
  const html = renderToStaticMarkup(
    <HistorySidebar
      threads={sampleThreads}
      activeThreadId="thread-local-1"
      providerLabel="吉吉 中转"
      searchTerm=""
      backendFilter="codex"
      t={t}
      onSearchChange={() => {}}
      onBackendFilterChange={() => {}}
      onRefresh={() => {}}
      onSelect={() => {}}
      onRename={() => {}}
      onArchive={() => {}}
      onExport={() => {}}
      onDelete={() => {}}
      onOpenSettings={() => {}}
    />
  );

  expect(html).toContain("<input");
  expect(html).toContain("吉吉 中转");
  expect(html).toContain("Refactor Database Module");
  expect(html).toContain("Deploy Remote Cluster");
});

test("HistorySidebar UI renders SSH indicator for remote threads and action buttons", () => {
  const html = renderToStaticMarkup(
    <HistorySidebar
      threads={sampleThreads}
      activeThreadId="thread-ssh-2"
      providerLabel="吉吉 中转"
      searchTerm=""
      backendFilter="codex"
      t={t}
      onSearchChange={() => {}}
      onBackendFilterChange={() => {}}
      onRefresh={() => {}}
      onSelect={() => {}}
      onRename={() => {}}
      onArchive={() => {}}
      onExport={() => {}}
      onDelete={() => {}}
      onOpenSettings={() => {}}
    />
  );

  expect(html).toContain('data-testid="ssh-thread-indicator"');
  expect(html).toContain("Deploy Remote Cluster");
});

test("HistorySidebar UI renders empty state when no threads match filter", () => {
  const html = renderToStaticMarkup(
    <HistorySidebar
      threads={[]}
      activeThreadId={null}
      providerLabel="吉吉 中转"
      searchTerm="nonexistent_query"
      backendFilter="codex"
      t={t}
      onSearchChange={() => {}}
      onBackendFilterChange={() => {}}
      onRefresh={() => {}}
      onSelect={() => {}}
      onRename={() => {}}
      onArchive={() => {}}
      onExport={() => {}}
      onDelete={() => {}}
      onOpenSettings={() => {}}
    />
  );

  expect(html).toContain("history.empty");
});

test("HistorySidebar UI renders all 7 backend icon buttons with tooltip labels", () => {
  const threadsWithBackends = [
    ...sampleThreads,
    { id: "thread-agy", threadId: "thread-agy", title: "Agy Thread", cliBackend: "agy", createdAt: 1720000000, updatedAt: 1720000000 },
    { id: "thread-pi", threadId: "thread-pi", title: "Pi Thread", cliBackend: "pi", createdAt: 1720000000, updatedAt: 1720000000 },
    { id: "thread-opencode", threadId: "thread-opencode", title: "OpenCode Thread", cliBackend: "opencode", createdAt: 1720000000, updatedAt: 1720000000 },
    { id: "thread-mini", threadId: "thread-mini", title: "Mini Thread", cliBackend: "mini", createdAt: 1720000000, updatedAt: 1720000000 },
  ];
  const html = renderToStaticMarkup(
    <HistorySidebar
      threads={threadsWithBackends as any}
      activeThreadId="thread-local-1"
      providerLabel="吉吉 中转"
      searchTerm=""
      backendFilter="mini"
      t={t}
      onSearchChange={() => {}}
      onBackendFilterChange={() => {}}
      onRefresh={() => {}}
      onSelect={() => {}}
      onRename={() => {}}
      onArchive={() => {}}
      onExport={() => {}}
      onDelete={() => {}}
      onOpenSettings={() => {}}
    />
  );

  // All 7 backends exist as icon-only toggle values
  expect(html).toContain('value="codex"');
  expect(html).toContain('value="claude"');
  expect(html).toContain('value="agy"');
  expect(html).toContain('value="grok"');
  expect(html).toContain('value="pi"');
  expect(html).toContain('value="opencode"');
  expect(html).toContain('value="mini"');

  // Brand icons come from the shared CLI icon component
  expect(html).toContain('src="/icons/pi.svg"');
  expect(html).toContain('src="/icons/mini.svg"');

  // Tooltip/aria text carries name + count; buttons carry no text labels
  expect(html).toContain("history.backendMini · 1");
  expect(html).toContain("history.backendAgy · 1");
  expect(html).not.toContain(">AGY<");
});

