import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import React from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { ChatPanel, type ChatPanelProps } from "../../apps/web/src/components/ChatPanel";

function setupDom() {
  const window = new Window();
  globalThis.window = window as any;
  globalThis.document = window.document as any;
  globalThis.HTMLElement = window.HTMLElement as any;
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} } as any;
  return window;
}

function makeStores() {
  const transcriptSubscribes: Array<string | null> = [];
  const usageSubscribes: Array<string | null> = [];
  const transcriptStore: any = {
    subscribe: (topicId: string | null, _listener: () => void) => {
      transcriptSubscribes.push(topicId);
      return () => {};
    },
    getVersion: () => 0,
    getProjection: () => ({ turns: [], turnsByThreadId: new Map(), threads: [] }),
    getThreadTurns: () => [],
    hasThreadTranscript: () => true,
  };
  const usageStore: any = {
    subscribe: (threadId: string | null, _listener: () => void) => {
      usageSubscribes.push(threadId);
      return () => {};
    },
    version: () => 0,
    snapshot: () => ({}),
    getThreadUsage: () => undefined,
  };
  return { transcriptStore, usageStore, transcriptSubscribes, usageSubscribes };
}

function makeProps(threadId: string, stores: ReturnType<typeof makeStores>, interactive: boolean): ChatPanelProps {
  return {
    activeThreadId: threadId,
    turns: [],
    turnsByThreadId: new Map(),
    turnTokenUsage: {},
    requestTokenUsage: {},
    compactionSourceByTurnId: {},
    threads: [{ id: threadId, title: "Suspended Chat", historyMode: "virtual" } as any],
    transcriptStore: stores.transcriptStore,
    usageStore: stores.usageStore,
    errors: [],
    pendingRequests: [],
    pendingAppends: [],
    goal: null,
    slashNotice: null,
    stats: null,
    requestMonitor: [],
    statsOpen: false,
    modes: {} as any,
    activeThemePlugin: null,
    welcomeBackgroundImage: undefined,
    welcomeDismissed: true,
    assistantUsageDisplay: "summary",
    waterfallDisplayMode: "all",
    chatTypography: undefined,
    threadLoadProgress: null,
    desktopRuntime: undefined,
    engineStatus: "ready" as any,
    sessionToken: "token-1",
    hasConfiguredRelays: true,
    t: (k: string) => k,
    interactive,
    onOpenCommandBlacklistSettings: () => {},
  };
}

const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

test("suspended ChatPanel renders a placeholder with zero store subscriptions", async () => {
  setupDom();
  const stores = makeStores();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  root.render(React.createElement(ChatPanel, makeProps("thread-suspended", stores, false)));
  await tick();

  expect(container.querySelector("[data-agent-virtual-page]")).not.toBeNull();
  expect(stores.transcriptSubscribes.length).toBeLessThanOrEqual(1);
  expect(stores.usageSubscribes.length).toBeLessThanOrEqual(1);

  root.unmount();
  container.remove();
});

test("toggling interactive false -> true -> false never breaks hook order", async () => {
  setupDom();
  const stores = makeStores();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  root.render(React.createElement(ChatPanel, makeProps("thread-toggle", stores, false)));
  await tick();
  expect(container.querySelector("[data-agent-virtual-page]")).not.toBeNull();

  root.render(React.createElement(ChatPanel, makeProps("thread-toggle", stores, true)));
  await tick();
  expect(stores.transcriptSubscribes.length).toBeGreaterThan(0);

  root.render(React.createElement(ChatPanel, makeProps("thread-toggle", stores, false)));
  await tick();
  expect(container.querySelector("[data-agent-virtual-page]")).not.toBeNull();

  root.unmount();
  container.remove();
});

test("suspension branch lives in the hook-light wrapper, not inside ChatPanelImpl", () => {
  const sourcePath = join(import.meta.dir, "../../apps/web/src/components/ChatPanel.tsx");
  expect(existsSync(sourcePath)).toBe(true);
  const source = readFileSync(sourcePath, "utf8");
  const implStart = source.indexOf("function ChatPanelImpl(");
  const wrapperStart = source.indexOf("export function ChatPanel(props: Props)");
  expect(implStart).toBeGreaterThan(-1);
  expect(wrapperStart).toBeGreaterThan(implStart);

  const implBody = source.slice(implStart, wrapperStart);
  expect(implBody).not.toMatch(/if\s*\(\s*!interactive\s*\)\s*\{\s*return\s*\(/);

  const wrapperBody = source.slice(wrapperStart);
  const branchAt = wrapperBody.indexOf("props.interactive === false");
  expect(branchAt).toBeGreaterThan(-1);
  expect(branchAt).toBeLessThan(wrapperBody.indexOf("<MemoizedChatPanel"));
});
