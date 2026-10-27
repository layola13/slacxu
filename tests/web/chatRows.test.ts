import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";
import { buildChatSearchResults } from "../../apps/web/src/waterfall/ChatSearchOverlay.tsx";
import { ChatRow, activitySummary, collapseUserMessageText, commandForDisplay, commandOutputPreview, compactFileChangeActivityDetail } from "../../apps/web/src/waterfall/ChatRow.tsx";
import {
  applyWaterfallDisplayMode,
  buildChatRows,
  buildIncrementalChatRows,
  cleanPreviewUrl,
  createIncrementalChatRowsCache,
  detectLocalPreviewUrl,
  isTurnLiveStatus,
  normalizeReasoningMarkdown,
  selectTurnsForWaterfallMode
} from "../../apps/web/src/waterfall/chatRows.ts";

test("file change summaries show only the filename while retaining the full tooltip value", () => {
  expect(compactFileChangeActivityDetail("E:\\projects\\sci\\src\\runtime\\sa_std_windows.zig (+2 -1)", "E:\\projects\\sci\\src\\runtime\\sa_std_windows.zig"))
    .toBe("sa_std_windows.zig (+2 -1)");
  expect(compactFileChangeActivityDetail("/srv/app/src/main.ts (+1 -0)", "/srv/app/src/main.ts"))
    .toBe("main.ts (+1 -0)");
});

test("waterfall modes only filter derived rows and never mutate transcript rows", () => {
  const nowMs = Date.UTC(2026, 7, 1, 12);
  const oldSeconds = (nowMs - 3 * 60 * 60 * 1000) / 1000;
  const recentSeconds = (nowMs - 30 * 60 * 1000) / 1000;
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-old", threadId: "thread-modes", status: "completed", startedAt: oldSeconds, completedAt: oldSeconds, items: [
        { id: "old-user", type: "userMessage", title: "You", text: "Keep old prompt", status: "completed" },
        { id: "old-command", type: "commandExecution", title: "Ran", text: "old output", status: "completed" },
        { id: "old-file", type: "fileChange", title: "Edit", text: "old edit", status: "completed" },
        { id: "old-tool", type: "mcpToolCall", title: "Read", text: "old tool", status: "completed" },
        { id: "old-dynamic-tool", type: "dynamicToolCall", title: "Search", text: "old dynamic tool", status: "completed" },
        { id: "old-subagent", type: "subAgentActivity", title: "Agent activity", text: "old agent activity", status: "completed" },
        { id: "old-image-view", type: "imageView", title: "Image view", text: "old image", status: "completed" },
        { id: "old-assistant", type: "agentMessage", title: "Codex", text: "Keep old answer", status: "completed" }
      ]
    },
    {
      id: "turn-recent", threadId: "thread-modes", status: "completed", startedAt: recentSeconds, completedAt: recentSeconds, items: [
        { id: "recent-command", type: "commandExecution", title: "Ran", text: "recent output", status: "completed" }
      ]
    },
    {
      id: "turn-live", threadId: "thread-modes", status: "inProgress", startedAt: oldSeconds, items: [
        { id: "live-command", type: "commandExecution", title: "Running", text: "", status: "inProgress" }
      ]
    }
  ];
  const rows = buildChatRows(turns);
  const originalKeys = rows.map((row) => row.key);
  const originalItems = turns.map((turn) => turn.items);

  expect(applyWaterfallDisplayMode(rows, "full", nowMs).rows).toBe(rows);
  const compact = applyWaterfallDisplayMode(rows, "recent-tools", nowMs);
  expect(compact.hiddenCount).toBe(6);
  expect(compact.rows.some((row) => rowContainsItemId(row, "old-command"))).toBe(false);
  expect(compact.rows.some((row) => rowContainsItemId(row, "old-file"))).toBe(false);
  expect(compact.rows.some((row) => rowContainsItemId(row, "old-tool"))).toBe(false);
  expect(compact.rows.some((row) => rowContainsItemId(row, "old-dynamic-tool"))).toBe(false);
  expect(compact.rows.some((row) => rowContainsItemId(row, "old-subagent"))).toBe(false);
  expect(compact.rows.some((row) => rowContainsItemId(row, "old-image-view"))).toBe(false);
  expect(compact.rows.some((row) => rowContainsItemId(row, "old-user"))).toBe(true);
  expect(compact.rows.some((row) => rowContainsItemId(row, "old-assistant"))).toBe(true);
  expect(compact.rows.some((row) => rowContainsItemId(row, "recent-command"))).toBe(true);
  expect(compact.rows.some((row) => rowContainsItemId(row, "live-command"))).toBe(true);
  expect(rows.map((row) => row.key)).toEqual(originalKeys);
  const selectedTurns = selectTurnsForWaterfallMode(turns, "recent-tools", nowMs);
  expect(selectedTurns[0]?.items.map((item) => item.id)).toEqual(["old-user", "old-assistant"]);
  expect(turns.map((turn) => turn.items)).toEqual(originalItems);
});

test("post-compaction mode starts at the latest completed compaction and otherwise falls back to compact", () => {
  const nowMs = Date.UTC(2026, 7, 1, 12);
  const oldSeconds = (nowMs - 3 * 60 * 60 * 1000) / 1000;
  const turns: WorkbenchTurn[] = [
    { id: "before", threadId: "thread-compact", status: "completed", startedAt: oldSeconds, items: [
      { id: "before-user", type: "userMessage", title: "You", text: "Before", status: "completed" },
      { id: "before-command", type: "commandExecution", title: "Ran", text: "before", status: "completed" }
    ] },
    { id: "first-compaction", threadId: "thread-compact", status: "completed", items: [
      { id: "compact-one", type: "contextCompaction", title: "Context compaction", text: "", status: "completed" },
      { id: "between", type: "agentMessage", title: "Codex", text: "Between", status: "completed" }
    ] },
    { id: "active-compaction", threadId: "thread-compact", status: "inProgress", items: [
      { id: "compact-running", type: "contextCompaction", title: "Context compaction", text: "", status: "inProgress" }
    ] },
    { id: "last-compaction", threadId: "thread-compact", status: "completed", items: [
      { id: "compact-two", type: "contextCompaction", title: "Context compaction", text: "", status: "completed" },
      { id: "after", type: "agentMessage", title: "Codex", text: "After", status: "completed" }
    ] }
  ];
  const rows = buildChatRows(turns);
  const aggressive = applyWaterfallDisplayMode(rows, "post-compaction", nowMs);
  expect(aggressive.rows.map((row) => row.item.id)).toEqual(["compact-two", "after"]);
  expect(aggressive.hiddenCount).toBe(rows.length - 2);
  const selectedTurns = selectTurnsForWaterfallMode(turns, "post-compaction", nowMs);
  expect(selectedTurns.map((turn) => turn.id)).toEqual(["last-compaction"]);
  expect(selectedTurns[0]?.items.map((item) => item.id)).toEqual(["compact-two", "after"]);

  const withoutCompaction = buildChatRows([turns[0]!, {
    id: "live", threadId: "thread-compact", status: "inProgress", startedAt: oldSeconds, items: [
      { id: "live-tool", type: "commandExecution", title: "Running", text: "", status: "inProgress" }
    ]
  }]);
  const fallback = applyWaterfallDisplayMode(withoutCompaction, "post-compaction", nowMs);
  expect(fallback.rows.some((row) => row.item.id === "before-command")).toBe(false);
  expect(fallback.rows.some((row) => row.item.id === "before-user")).toBe(true);
  expect(fallback.rows.some((row) => row.item.id === "live-tool")).toBe(true);
});
import { createStableChatRowsCache, stableChatRows } from "../../apps/web/src/waterfall/stableChatRows.ts";
import { estimateChatRowSize } from "../../apps/web/src/waterfall/chatRowEstimates.ts";
import { captureVisibleVirtualRowAnchor, remeasureMountedVirtualRows, restoreVirtualRowAnchor } from "../../apps/web/src/waterfall/virtualRowMeasurements.ts";

function rowContainsItemId(row: ReturnType<typeof buildChatRows>[number], itemId: string): boolean {
  return row.item.id === itemId || (row.groupedRows?.some((groupedRow) => rowContainsItemId(groupedRow, itemId)) ?? false);
}

test("only active turn statuses are treated as live", () => {
  expect(isTurnLiveStatus("inProgress")).toBe(true);
  expect(isTurnLiveStatus("in_progress")).toBe(true);
  expect(isTurnLiveStatus("running")).toBe(true);
  expect(isTurnLiveStatus("completed")).toBe(false);
  expect(isTurnLiveStatus("interrupted")).toBe(false);
  expect(isTurnLiveStatus("failed")).toBe(false);
});

test("consecutive retry errors collapse into one expandable retry group", () => {
  const turns: WorkbenchTurn[] = [{
    id: "turn-retry-errors",
    threadId: "thread-retry-errors",
    status: "inProgress",
    items: [
      {
        id: "retry-error-1",
        type: "retryError",
        title: "Retrying",
        text: "Selected model is at capacity",
        status: "failed",
        payload: {
          retryError: true,
          retrySource: "codex",
          additionalDetails: "upstream returned 503"
        }
      },
      {
        id: "retry-error-2",
        type: "retryError",
        title: "Retrying",
        text: "The model provider is rate-limiting requests",
        status: "running",
        payload: {
          retryError: true,
          retrySource: "app",
          additionalDetails: "retry 2 of 3 after 5000ms"
        }
      }
    ]
  }];

  const rows = buildChatRows(turns);
  expect(rows).toHaveLength(1);
  const retryGroup = rows[0];
  expect(retryGroup?.kind).toBe("retryErrorGroup");
  expect(retryGroup?.groupedRows?.map((row) => row.item.id)).toEqual(["retry-error-1", "retry-error-2"]);

  const collapsedHtml = renderToStaticMarkup(createElement(ChatRow, {
    row: retryGroup!,
    t: (key: string) => key,
    expanded: false
  }));
  expect(collapsedHtml).toContain('data-testid="retry-error-group"');
  expect(collapsedHtml).toContain('data-retrying="true"');
  expect(collapsedHtml).toContain('data-testid="retry-error-pulse"');
  expect(collapsedHtml).not.toContain('data-testid="retry-error-details"');
  expect(collapsedHtml).not.toContain("upstream returned 503");

  const expandedHtml = renderToStaticMarkup(createElement(ChatRow, {
    row: retryGroup!,
    t: (key: string) => key,
    expanded: true
  }));
  expect(expandedHtml).toContain('data-testid="retry-error-details"');
  expect(expandedHtml).toContain("Selected model is at capacity");
  expect(expandedHtml).toContain("upstream returned 503");
  expect(expandedHtml).toContain("Codex retry");
  expect(expandedHtml).toContain("App retry");
});

test("an exhausted retry group no longer renders as retrying", () => {
  const retryGroup = buildChatRows([{
    id: "turn-retry-exhausted",
    threadId: "thread-retry-exhausted",
    status: "failed",
    items: [{
      id: "retry-error-exhausted",
      type: "retryError",
      title: "Retry exhausted",
      text: "Selected model is at capacity",
      status: "failed",
      payload: { retryError: true, retrySource: "app", exhausted: true }
    }]
  }])[0];
  if (!retryGroup) throw new Error("Missing exhausted retry group");
  expect(retryGroup.status).toBe("failed");
  const html = renderToStaticMarkup(createElement(ChatRow, {
    row: retryGroup,
    t: (key: string) => key,
    expanded: false
  }));
  expect(html).toContain('data-retrying="false"');
  expect(html).not.toContain("retry-error-breathe");
});

test("a live mini 502 retry group shows attempt progress", () => {
  const retryGroup = buildChatRows([{
    id: "turn-mini-retry",
    threadId: "thread-mini-retry",
    status: "inProgress",
    items: [{
      id: "mini-retry-turn-mini-retry",
      type: "retryError",
      title: "Retrying request (2/5)",
      text: "502 Bad Gateway",
      status: "running",
      payload: { retryError: true, retrySource: "mini", attempt: 2, max: 5, willRetry: true }
    }]
  }])[0];
  if (!retryGroup) throw new Error("Missing mini retry group");
  expect(retryGroup.kind).toBe("retryErrorGroup");
  expect(retryGroup.title).toContain("retrying 2/5");
  const html = renderToStaticMarkup(createElement(ChatRow, { row: retryGroup, t: (key: string) => key, expanded: false }));
  expect(html).toContain("retrying 2/5");
  const expandedHtml = renderToStaticMarkup(createElement(ChatRow, { row: retryGroup, t: (key: string) => key, expanded: true }));
  expect(expandedHtml).toContain("Mini retry");
  expect(expandedHtml).toContain("502 Bad Gateway");
});

test("review mode events render as expandable waterfall rows", () => {
  const row = buildChatRows([{
    id: "turn-review-mode",
    threadId: "thread-review-mode",
    status: "completed",
    items: [{
      id: "entered-review",
      type: "enteredReviewMode",
      title: "Entered review mode",
      text: "Review the current patch",
      status: "completed"
    }]
  }])[0];
  expect(row?.kind).toBe("reviewMode");
  const collapsed = renderToStaticMarkup(createElement(ChatRow, { row: row!, t: (key: string) => key, expanded: false }));
  const expanded = renderToStaticMarkup(createElement(ChatRow, { row: row!, t: (key: string) => key, expanded: true }));
  expect(collapsed).not.toContain("Review the current patch");
  expect(expanded).toContain('data-testid="review-mode-details"');
  expect(expanded).toContain("Review the current patch");
});

test("historical interrupted rows do not keep the waterfall pinned to latest", () => {
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-interrupted",
      threadId: "thread-goal",
      status: "interrupted",
      items: [
        {
          id: "assistant-interrupted",
          type: "agentMessage",
          title: "Codex",
          text: "Partial historical response"
        }
      ]
    },
    {
      id: "turn-running",
      threadId: "thread-goal",
      status: "inProgress",
      items: [
        {
          id: "assistant-running",
          type: "agentMessage",
          title: "Codex",
          text: "Current response"
        }
      ]
    }
  ];

  const rows = buildChatRows(turns);
  expect(rows.find((row) => row.item.id === "assistant-interrupted")?.isLive).toBe(false);
  expect(rows.find((row) => row.item.id === "assistant-running")?.isLive).toBe(true);
});

test("folded command payloads stay lazy but remain searchable", () => {
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-commands",
      threadId: "thread-large",
      status: "completed",
      items: [
        {
          id: "command-one",
          type: "commandExecution",
          title: "Bash",
          text: "first output",
          status: "completed",
          payload: { command: "bun test", hiddenMarker: "payload-only-marker" }
        },
        {
          id: "command-two",
          type: "commandExecution",
          title: "Bash",
          text: "second output",
          status: "completed",
          payload: { command: "bun run build" }
        }
      ]
    }
  ];

  const rows = buildChatRows(turns);
  const folded = rows.find((row) => row.kind === "toolActivityGroup");
  expect(folded?.text).toBe("");
  expect(folded?.item.payload).toEqual({ count: 2, commandCount: 2, editCount: 0, toolCount: 0 });
  expect(folded?.groupedRows?.map((row) => activitySummary(row).detail)).toEqual(["bun test", "bun run build"]);
  expect(buildChatSearchResults(rows, "payload-only-marker", "commands").map((result) => result.row.kind)).toEqual(["toolActivityGroup"]);
});

test("consecutive completed file changes fold without duplicating diff payloads", () => {
  const firstPayload = { path: "src/one.ts", unifiedDiff: "@@ -1 +1 @@\n-old\n+new", hiddenMarker: "first-edit-marker" };
  const secondPayload = { path: "src/two.ts", changes: [{ path: "src/two.ts", kind: "update" }] };
  const rows = buildChatRows([{
    id: "turn-edits",
    threadId: "thread-edits",
    status: "completed",
    items: [
      { id: "edit-one", type: "fileChange", title: "Edit", text: "", status: "completed", payload: firstPayload },
      { id: "edit-two", type: "fileChange", title: "Edit", text: "", status: "completed", payload: secondPayload }
    ]
  }]);

  expect(rows).toHaveLength(1);
  expect(rows[0]?.kind).toBe("toolActivityGroup");
  expect(rows[0]?.text).toBe("");
  expect(rows[0]?.item.payload).toEqual({ count: 2, commandCount: 0, editCount: 2, toolCount: 0 });
  expect(rows[0]?.groupedRows?.map((row) => row.item.payload)).toEqual([firstPayload, secondPayload]);
  expect(buildChatSearchResults(rows, "first-edit-marker", "files").map((result) => result.row.kind)).toEqual(["toolActivityGroup"]);
});

test("completed tool calls fold while live file changes remain individually visible", () => {
  const completed = buildChatRows([{
    id: "turn-single-edit", threadId: "thread-edits", status: "completed", items: [
      { id: "edit-single", type: "fileChange", title: "Edit", text: "", status: "completed", payload: { path: "src/single.ts" } }
    ]
  }]);
  const live = buildChatRows([{
    id: "turn-live-edits", threadId: "thread-edits", status: "inProgress", items: [
      { id: "edit-live-one", type: "fileChange", title: "Edit", text: "", status: "inProgress", payload: { path: "src/live-one.ts" } },
      { id: "edit-live-two", type: "fileChange", title: "Edit", text: "", status: "inProgress", payload: { path: "src/live-two.ts" } }
    ]
  }]);

  expect(completed.map((row) => row.kind)).toEqual(["toolActivityGroup"]);
  expect(live.map((row) => row.kind)).toEqual(["fileChange", "fileChange"]);
});

test("completed tool calls fold immediately while the current turn is still running", () => {
  const rows = buildChatRows([{
    id: "turn-live-tool-fold", threadId: "thread-live-tool-fold", status: "inProgress", items: [
      { id: "command-live-done-one", type: "commandExecution", title: "Shell", text: "", status: "completed", payload: { command: "rg one" } },
      { id: "command-live-done-two", type: "commandExecution", title: "Shell", text: "", status: "completed", payload: { command: "rg two" } },
      { id: "command-live-running", type: "commandExecution", title: "Shell", text: "", status: "inProgress", payload: { command: "bun test" } }
    ]
  }]);

  expect(rows.map((row) => row.kind)).toEqual(["toolActivityGroup", "commandExecution"]);
  expect(rows[0]?.groupedRows?.map((row) => row.item.id)).toEqual(["command-live-done-one", "command-live-done-two"]);
  expect(rows[1]?.item.id).toBe("command-live-running");
});

test("a completed contiguous tool run folds as one order-preserving group", () => {
  const rows = buildChatRows([{
    id: "turn-mixed-activity", threadId: "thread-mixed-activity", status: "completed", items: [
      { id: "command-one", type: "commandExecution", title: "Shell", text: "", status: "completed", payload: { command: "one" } },
      { id: "command-two", type: "commandExecution", title: "Shell", text: "", status: "completed", payload: { command: "two" } },
      { id: "edit-one", type: "fileChange", title: "Edit", text: "", status: "completed", payload: { path: "one.ts" } },
      { id: "edit-two", type: "fileChange", title: "Edit", text: "", status: "completed", payload: { path: "two.ts" } }
    ]
  }]);

  expect(rows.map((row) => row.kind)).toEqual(["toolActivityGroup"]);
  expect(rows[0]?.groupedRows?.map((row) => row.item.id)).toEqual(["command-one", "command-two", "edit-one", "edit-two"]);
});

test("completed tool groups preserve causal order around assistant text", () => {
  const rows = buildChatRows([{
    id: "turn-causal-order", threadId: "thread-causal-order", status: "completed", items: [
      { id: "command-before", type: "commandExecution", title: "Shell", text: "", status: "completed", payload: { command: "one" } },
      { id: "edit-between", type: "fileChange", title: "Edit", text: "", status: "completed", payload: { path: "one.ts" } },
      { id: "command-after-edit", type: "commandExecution", title: "Shell", text: "", status: "completed", payload: { command: "two" } },
      { id: "assistant-middle", type: "agentMessage", title: "Codex", text: "Intermediate result", status: "completed" },
      { id: "command-tail", type: "commandExecution", title: "Shell", text: "", status: "completed", payload: { command: "three" } }
    ]
  }]);

  expect(rows.map((row) => row.kind)).toEqual(["toolActivityGroup", "assistantMessage", "toolActivityGroup"]);
  expect(rows[0]?.groupedRows?.map((row) => row.item.id)).toEqual(["command-before", "edit-between", "command-after-edit"]);
  expect(rows[2]?.groupedRows?.map((row) => row.item.id)).toEqual(["command-tail"]);
});

test("assistant rows expose local preview urls from local hosts", () => {
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-preview",
      threadId: "thread-preview",
      status: "completed",
      items: [
        {
          id: "assistant-preview",
          type: "agentMessage",
          title: "Codex",
          text: "Preview ready: http://0.0.0.0:4173/"
        }
      ]
    }
  ];

  const rows = buildChatRows(turns);
  expect(rows.find((row) => row.item.id === "assistant-preview")?.previewUrl).toBe("http://0.0.0.0:4173/");
});

test("virtual row estimates follow dynamic chat typography without a copy footer", () => {
  const turns: WorkbenchTurn[] = [{
    id: "typography-turn", threadId: "thread-1", status: "completed", items: [
      { id: "typography-agent", type: "agentMessage", title: "Codex", text: "A moderately long answer that wraps across multiple lines in the chat waterfall.", status: "completed" }
    ]
  }];
  const row = buildChatRows(turns)[0]!;
  const compact = estimateChatRowSize(row, false, { fontSize: 12, lineHeight: 1.35, messageSpacing: 2, runningHighlightColor: "#3b82f6" });
  const spacious = estimateChatRowSize(row, false, { fontSize: 18, lineHeight: 2, messageSpacing: 24, runningHighlightColor: "#3b82f6" });
  expect(spacious).toBeGreaterThan(compact + 20);
  expect(estimateChatRowSize(row, false, { fontSize: 13, lineHeight: 1.52, messageSpacing: 0, runningHighlightColor: "#3b82f6" })).toBeLessThan(110);
});

test("split resize remeasures mounted virtual rows without clearing other cached sizes", () => {
  const elements = [
    { dataset: { index: "2" }, offsetHeight: 180, isConnected: true },
    { dataset: { index: "3" }, offsetHeight: 420, isConnected: true },
    { dataset: { index: "bad" }, offsetHeight: 500, isConnected: true },
    { dataset: { index: "4" }, offsetHeight: 0, isConnected: true },
    { dataset: { index: "5" }, offsetHeight: 210, isConnected: false }
  ] as unknown as NodeListOf<HTMLElement>;
  const container = {
    querySelectorAll: () => elements
  } as unknown as ParentNode;
  const resized: Array<[number, number]> = [];

  const measured = remeasureMountedVirtualRows(container, (index, height) => resized.push([index, height]));

  expect(measured).toBe(2);
  expect(resized).toEqual([[2, 180], [3, 420]]);
});

test("split resize ignores rows measured while the pane is collapsed", () => {
  const narrow = {
    dataset: { index: "2" }, offsetHeight: 900, isConnected: true,
    getBoundingClientRect: () => ({ width: 72, height: 900 }) as DOMRect
  } as unknown as HTMLElement;
  const stable = {
    dataset: { index: "3" }, offsetHeight: 240, isConnected: true,
    getBoundingClientRect: () => ({ width: 680, height: 240 }) as DOMRect
  } as unknown as HTMLElement;
  const container = { querySelectorAll: () => [narrow, stable] } as unknown as ParentNode;
  const resized: Array<[number, number]> = [];
  expect(remeasureMountedVirtualRows(container, (index, height) => resized.push([index, height]))).toBe(1);
  expect(resized).toEqual([[3, 240]]);
});

test("split resize restores the first visible virtual row anchor", () => {
  const containerRect = { top: 100, bottom: 500 } as DOMRect;
  let firstTop = 70;
  let secondTop = 160;
  const first = {
    dataset: { index: "2" }, isConnected: true,
    getBoundingClientRect: () => ({ top: firstTop, bottom: firstTop + 70 }) as DOMRect
  } as unknown as HTMLElement;
  const second = {
    dataset: { index: "3" }, isConnected: true,
    getBoundingClientRect: () => ({ top: secondTop, bottom: secondTop + 100 }) as DOMRect
  } as unknown as HTMLElement;
  const container = {
    scrollTop: 300,
    getBoundingClientRect: () => containerRect,
    querySelectorAll: () => [first, second],
    querySelector: (selector: string) => selector.includes("data-index='2'") ? first : selector.includes("data-index='3'") ? second : null
  } as unknown as HTMLElement;

  const anchor = captureVisibleVirtualRowAnchor(container);
  expect(anchor).toEqual({ index: 2, offsetTop: -30 });
  firstTop = 140;

  expect(restoreVirtualRowAnchor(container, anchor)).toBe(true);
  expect(container.scrollTop).toBe(370);
});


test("PowerShell executable paths are hidden only in command presentation", () => {
  const raw = '("C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command "bun test")';
  expect(commandForDisplay(raw)).toBe("bun test");
  expect(commandForDisplay("pwsh -Command bun test")).toBe("pwsh -Command bun test");
});

test("bounds expanded command output while preserving its head and tail", () => {
  const output = Array.from({ length: 420 }, (_, index) => `command output line ${String(index + 1).padStart(3, "0")} ${"x".repeat(80)}`).join("\n");
  const preview = commandOutputPreview(output, true);

  expect(preview.truncated).toBe(true);
  expect(preview.text.length).toBeLessThanOrEqual(20_000);
  expect(preview.text).toContain("command output line 001");
  expect(preview.text).toContain("command output line 420");
  expect(preview.text).toContain("omitted from rendering");
  expect(preview.omittedLines).toBeGreaterThan(0);
});

test("uses a smaller render window for live command output", () => {
  const output = Array.from({ length: 220 }, (_, index) => `live output ${index + 1} ${"y".repeat(80)}`).join("\n");
  const preview = commandOutputPreview(output, true, true);

  expect(preview.truncated).toBe(true);
  expect(preview.text.length).toBeLessThanOrEqual(12_000);
  expect(preview.renderedLines).toBeLessThanOrEqual(81);
  expect(preview.text).toContain("live output 220");
});

test("preserves unchanged row references while a later live row updates", () => {
  const firstItem = { id: "assistant-stable-1", type: "agentMessage", title: "Codex", text: "Stable history" } as const;
  const liveItem = { id: "assistant-stable-2", type: "agentMessage", title: "Codex", text: "Streaming" } as const;
  const initialTurns: WorkbenchTurn[] = [
    { id: "turn-stable-1", threadId: "thread-stable", status: "completed", items: [firstItem] },
    { id: "turn-stable-2", threadId: "thread-stable", status: "inProgress", items: [liveItem] }
  ];
  const cache = createStableChatRowsCache();
  const initialRows = stableChatRows(buildChatRows(initialTurns), cache);
  const updatedTurns: WorkbenchTurn[] = [
    initialTurns[0]!,
    {
      ...initialTurns[1]!,
      items: [{ ...liveItem, text: "Streaming update" }]
    }
  ];
  const updatedRows = stableChatRows(buildChatRows(updatedTurns), cache);
  expect(updatedRows[0]).toBe(initialRows[0]);
  expect(updatedRows[1]).not.toBe(initialRows[1]);
});

test("incremental waterfall rebuilds only the changed goal turn", () => {
  const completed: WorkbenchTurn = {
    id: "goal-turn-completed",
    threadId: "thread-goal-long",
    status: "completed",
    items: [{ id: "goal-old-answer", type: "agentMessage", title: "Codex", text: "Verified earlier work" }]
  };
  const running: WorkbenchTurn = {
    id: "goal-turn-running",
    threadId: "thread-goal-long",
    status: "inProgress",
    items: [{ id: "goal-live-answer", type: "agentMessage", title: "Codex", text: "Working" }]
  };
  const cache = createIncrementalChatRowsCache();
  const initial = buildIncrementalChatRows([completed, running], cache, { cacheKey: "thread-goal-long" });
  const completedRawRows = cache.turns.get(completed.id)?.rows;
  const runningRawRows = cache.turns.get(running.id)?.rows;
  const updatedRunning: WorkbenchTurn = {
    ...running,
    items: [{ ...running.items[0]!, text: "Working on the next verification" }]
  };
  const updated = buildIncrementalChatRows([completed, updatedRunning], cache, { cacheKey: "thread-goal-long" });

  expect(cache.turns.get(completed.id)?.rows).toBe(completedRawRows);
  expect(cache.turns.get(running.id)?.rows).not.toBe(runningRawRows);
  expect(updated[0]?.text).toBe(initial[0]?.text);
  expect(updated[1]?.text).toBe("Working on the next verification");
  expect(updated).toEqual(buildChatRows([completed, updatedRunning]));
});

test("large incremental waterfall keeps settled history references stable", () => {
  const settled = Array.from({ length: 500 }, (_, index): WorkbenchTurn => ({
    id: `settled-${index}`,
    threadId: "thread-large-stream",
    status: "completed",
    items: [
      { id: `user-${index}`, type: "userMessage", title: "You", text: `Prompt ${index}` },
      { id: `assistant-${index}`, type: "agentMessage", title: "Codex", text: `Answer ${index}` }
    ]
  }));
  const live: WorkbenchTurn = {
    id: "live-tail",
    threadId: "thread-large-stream",
    status: "inProgress",
    items: [{ id: "live-answer", type: "agentMessage", title: "Codex", text: "Starting" }]
  };
  const cache = createIncrementalChatRowsCache();
  const initial = buildIncrementalChatRows([...settled, live], cache, { cacheKey: "thread-large-stream" });
  const updated = buildIncrementalChatRows([...settled, {
    ...live,
    items: [{ ...live.items[0]!, text: "Streaming update" }]
  }], cache, { cacheKey: "thread-large-stream" });

  expect(initial).toHaveLength(1001);
  expect(updated.slice(0, 1000).every((row, index) => row === initial[index])).toBe(true);
  expect(updated.at(-1)).not.toBe(initial.at(-1));
});

test("renders context compaction as an indeterminate progress row until completion", () => {
  const activeTurn: WorkbenchTurn = {
    id: "turn-compaction",
    threadId: "thread-compaction",
    status: "inProgress",
    items: [{
      id: "compact-1",
      type: "contextCompaction",
      title: "Context compaction",
      text: "",
      status: "inProgress"
    }]
  };
  const activeRow = buildChatRows([activeTurn])[0];
  expect(activeRow?.kind).toBe("contextCompaction");
  expect(activeRow?.width).toBe("full");
  if (!activeRow) throw new Error("Missing active compaction row");

  const translations: Record<string, string> = {
    "chat.compaction.inProgressTitle": "Compacting conversation context",
    "chat.compaction.inProgressDescription": "Summarizing earlier context",
    "chat.compaction.inProgressStatus": "Compacting",
    "chat.compaction.completedTitle": "Context compaction complete",
    "chat.compaction.completedDescription": "Context summarized",
    "chat.compaction.completedStatus": "Complete"
  };
  const render = (row: typeof activeRow) => renderToStaticMarkup(createElement(ChatRow, {
    row,
    t: (key: string) => translations[key] ?? key
  }));

  const activeHtml = render(activeRow);
  expect(activeHtml).toContain('data-testid="context-compaction-progress"');
  expect(activeHtml).toContain('data-state="in-progress"');
  expect(activeHtml).toContain("Compacting conversation context");
  expect(activeHtml).toContain("MuiLinearProgress-indeterminate");

  const completedRow = buildChatRows([{ ...activeTurn, status: "completed", items: [{ ...activeTurn.items[0]!, status: "completed" }] }])[0];
  if (!completedRow) throw new Error("Missing completed compaction row");
  const completedHtml = render(completedRow);
  expect(completedHtml).toContain('data-state="completed"');
  expect(completedHtml).toContain("Context compaction complete");
  expect(completedHtml).toContain("MuiLinearProgress-determinate");
  expect(completedHtml).toContain('aria-valuenow="100"');
});

test("moves a stale completed compaction into a zero-row assistant marker", () => {
  const rows = buildChatRows([
    {
      id: "turn-before-compaction", threadId: "thread-marker", status: "completed", items: [
        { id: "assistant-before", type: "agentMessage", title: "Codex", text: "Before", status: "completed" }
      ]
    },
    {
      id: "turn-compaction-marker", threadId: "thread-marker", status: "completed", items: [
        { id: "compaction-marker-source", type: "contextCompaction", title: "Context compaction", text: "", status: "completed" }
      ]
    },
    {
      id: "turn-after-compaction", threadId: "thread-marker", status: "completed", items: [
        { id: "assistant-after", type: "agentMessage", title: "Codex", text: "After", status: "completed" }
      ]
    }
  ], undefined, {}, {}, {}, "codex");

  expect(rows.some((row) => row.kind === "contextCompaction")).toBe(false);
  const markedRow = rows.find((row) => row.item.id === "assistant-after");
  expect(markedRow?.compactionMarker).toBe(true);
  expect(markedRow?.hideHeader).toBe(true);
  if (!markedRow) throw new Error("Missing marked assistant row");

  const html = renderToStaticMarkup(createElement(ChatRow, {
    row: markedRow,
    t: (key: string) => key === "chat.compaction.markerTooltip" || key === "chat.compaction.nativeMarkerTooltip" ? "压缩完成" : key
  }));
  expect(html).toContain('data-testid="context-compaction-marker"');
  expect(html).toContain('aria-label="压缩完成"');
  expect(html).toContain("position:absolute");
  expect(html).not.toContain('data-testid="assistant-message-header"');
});

test("labels the compaction card and marker with the CLI that ran it", () => {
  const claudeTurn: WorkbenchTurn = {
    id: "turn-claude-compaction",
    threadId: "thread-claude-compaction",
    status: "inProgress",
    items: [{
      id: "claude-compaction-1",
      type: "contextCompaction",
      title: "Context compaction",
      text: "",
      status: "inProgress",
      payload: { cliBackend: "claude" }
    }]
  };
  const claudeRow = buildChatRows([claudeTurn])[0];
  expect(claudeRow?.compactionBackend).toBe("claude");
  if (!claudeRow) throw new Error("Missing claude compaction row");
  const claudeHtml = renderToStaticMarkup(createElement(ChatRow, {
    row: claudeRow,
    t: (key: string, values?: Record<string, string | number>) => {
      const template = key === "chat.compaction.nativeTitle" ? "{cli} 原生压缩"
        : key === "chat.compaction.inProgressDescription" ? "{cli} 正在整理较早的对话上下文"
        : key;
      return values?.cli ? template.replaceAll("{cli}", String(values.cli)) : template;
    }
  }));
  expect(claudeHtml).toContain("Claude 原生压缩");
  expect(claudeHtml).toContain("Claude 正在整理较早的对话上下文");
  expect(claudeHtml).toContain('data-compaction-backend="claude"');

  // Codex items carry no backend marker; the backend comes from the
  // thread the panel passes in (provenance, never a silent default).
  const codexRow = buildChatRows([{ ...claudeTurn, items: [{ ...claudeTurn.items[0]!, payload: undefined }] }], undefined, {}, {}, {}, "codex")[0];
  expect(codexRow?.compactionBackend).toBe("codex");
  // With neither marker nor thread backend the row stays unbranded.
  const unbrandedRow = buildChatRows([{ ...claudeTurn, items: [{ ...claudeTurn.items[0]!, payload: undefined }] }])[0];
  expect(unbrandedRow?.compactionBackend).toBeUndefined();

  // The stale-completed collapse keeps the backend on the marker row.
  const collapsed = buildChatRows([
    {
      id: "turn-claude-compaction",
      threadId: "thread-claude-compaction",
      status: "completed",
      items: [{ id: "claude-compaction-1", type: "contextCompaction", title: "Context compaction", text: "", status: "completed", payload: { cliBackend: "claude" } }]
    },
    {
      id: "turn-after-claude-compaction",
      threadId: "thread-claude-compaction",
      status: "completed",
      items: [{ id: "assistant-after-claude", type: "agentMessage", title: "Claude", text: "After", status: "completed" }]
    }
  ]);
  const markedRow = collapsed.find((row) => row.item.id === "assistant-after-claude");
  expect(markedRow?.compactionMarker).toBe(true);
  expect(markedRow?.compactionBackend).toBe("claude");
  if (!markedRow) throw new Error("Missing claude compaction marker row");
  const markerHtml = renderToStaticMarkup(createElement(ChatRow, {
    row: markedRow,
    t: (key: string, values?: Record<string, string | number>) => {
      const template = key === "chat.compaction.nativeMarkerTooltip" ? "{cli} 原生压缩完成" : key;
      return values?.cli ? template.replaceAll("{cli}", String(values.cli)) : template;
    }
  }));
  expect(markerHtml).toContain('data-compaction-backend="claude"');
  expect(markerHtml).toContain('aria-label="Claude 原生压缩完成"');
});

test("binds the free compaction source marker to its own turn", () => {
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-normal-answer",
      threadId: "thread-compaction-source",
      status: "completed",
      items: [{ id: "normal-answer", type: "agentMessage", title: "Codex", text: "Done", status: "completed" }]
    },
    {
      id: "turn-free-compaction",
      threadId: "thread-compaction-source",
      status: "completed",
      items: [{ id: "free-compaction-item", type: "contextCompaction", title: "Context compaction", text: "", status: "completed" }]
    }
  ];
  const rows = buildChatRows(turns, undefined, {}, {
    "turn-free-compaction": { source: "free", providerId: "omniroute-free", model: "mimo-v2.5-free" }
  });
  const compaction = rows.find((row) => row.turnId === "turn-free-compaction" && row.kind === "contextCompaction");
  const normal = rows.find((row) => row.turnId === "turn-normal-answer");
  expect(compaction).toMatchObject({
    compactionSource: "free",
    compactionProviderId: "omniroute-free",
    compactionModel: "mimo-v2.5-free"
  });
  expect(normal?.compactionSource).toBeUndefined();
});

test("collapses multiple completed compactions in one forward pass", () => {
  const rows = buildChatRows([{
    id: "turn-many-compactions",
    threadId: "thread-many-compactions",
    status: "completed",
    items: [
      { id: "compact-a", type: "contextCompaction", title: "Context compaction", text: "", status: "completed" },
      { id: "compact-b", type: "contextCompaction", title: "Context compaction", text: "", status: "completed" }
    ]
  }, {
    id: "turn-after-many-compactions",
    threadId: "thread-many-compactions",
    status: "completed",
    items: [{ id: "answer-after-compactions", type: "agentMessage", title: "Codex", text: "After", status: "completed" }]
  }]);

  expect(rows.filter((row) => row.kind === "contextCompaction")).toHaveLength(0);
  expect(rows.find((row) => row.item.id === "answer-after-compactions")?.compactionMarker).toBe(true);
});

test("keeps active and latest completed compactions as full progress rows", () => {
  const active = buildChatRows([{
    id: "turn-active-compaction", threadId: "thread-compaction-state", status: "inProgress", items: [
      { id: "active-compaction", type: "contextCompaction", title: "Context compaction", text: "", status: "inProgress" }
    ]
  }]);
  const latestCompleted = buildChatRows([{
    id: "turn-latest-compaction", threadId: "thread-compaction-state", status: "completed", items: [
      { id: "latest-compaction", type: "contextCompaction", title: "Context compaction", text: "", status: "completed" }
    ]
  }]);

  expect(active.map((row) => row.kind)).toEqual(["contextCompaction"]);
  expect(latestCompleted.map((row) => row.kind)).toEqual(["contextCompaction"]);
});

test("reasoning metadata remains visible alongside the thinking control", () => {
  const completed = buildChatRows([{
    id: "turn-completed-reasoning", threadId: "thread-reasoning", status: "completed", startedAt: 1_754_000_000, completedAt: 1_754_000_121, items: [
      { id: "reasoning-completed", type: "reasoning", title: "Reasoning", text: "Completed analysis", status: "completed" },
      { id: "assistant-completed", type: "agentMessage", title: "Codex", text: "Done", status: "completed", firstTokenAt: 1_754_000_004 }
    ]
  }], () => true, {
    "turn-completed-reasoning": {
      totalTokens: 1800,
      inputTokens: 1200,
      cachedInputTokens: 600,
      cacheWriteInputTokens: 0,
      outputTokens: 600,
      estimatedCostUsd: 0.0123
    }
  })[0];
  const live = buildChatRows([{
    id: "turn-live-reasoning", threadId: "thread-reasoning", status: "inProgress", startedAt: 1_754_000_000, items: [
      { id: "reasoning-live", type: "reasoning", title: "Reasoning", text: "Still analyzing", status: "inProgress" }
    ]
  }], () => true, {
    "turn-live-reasoning": {
      totalTokens: 900,
      inputTokens: 700,
      cachedInputTokens: 300,
      cacheWriteInputTokens: 0,
      outputTokens: 200
    }
  })[0];
  if (!completed || !live) throw new Error("Missing reasoning rows");
  const t = (key: string) => ({ "chat.thought": "Thought", "chat.thinking": "Thinking" })[key] ?? key;
  const completedHtml = renderToStaticMarkup(createElement(ChatRow, { row: completed, t }));
  const liveHtml = renderToStaticMarkup(createElement(ChatRow, { row: live, t }));

  expect(completedHtml).toContain("Thinking...");
  expect(completedHtml).toContain('data-testid="assistant-message-started-at"');
  expect(completedHtml).toContain('data-testid="assistant-token-usage"');
  expect(liveHtml).toContain("Thinking...");
});

test("long user prompts default to a ten-line preview without changing the source text", () => {
  const text = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
  const collapsed = collapseUserMessageText(text);
  expect(collapsed.collapsible).toBe(true);
  expect(collapsed.lineCount).toBe(12);
  expect(collapsed.preview).toBe(Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n"));

  const row = buildChatRows([{
    id: "turn-long-prompt", threadId: "thread-long-prompt", status: "completed", items: [
      { id: "long-prompt", type: "userMessage", title: "User", text, status: "completed" }
    ]
  }])[0];
  if (!row) throw new Error("Missing user message row");
  const html = renderToStaticMarkup(createElement(ChatRow, { row, t: (key: string) => key }));
  expect(html).toContain('data-testid="user-message-expand-toggle"');
  expect(html).toContain("line 10");
  expect(html).not.toContain("line 11");
  expect(row.text).toBe(text);
});

test("assistant rows expose the latest stream update without changing first-token timing", () => {
  const row = buildChatRows([{
    id: "turn-live-clock",
    threadId: "thread-live-clock",
    status: "inProgress",
    startedAt: 100,
    items: [{
      id: "assistant-live-clock",
      type: "agentMessage",
      title: "Codex",
      text: "Streaming",
      startedAt: 104,
      firstTokenAt: 106,
      updatedAt: 119
    }]
  }])[0];

  expect(row?.turnStartedAt).toBe(100);
  expect(row?.startedAt).toBe(104);
  expect(row?.firstTokenAt).toBe(106);
  expect(row?.updatedAt).toBe(119);
});

test("assistant rows calculate first-token time independently around tool calls", () => {
  const rows = buildChatRows([{
    id: "turn-item-clocks",
    threadId: "thread-item-clocks",
    status: "completed",
    startedAt: 100,
    completedAt: 204,
    items: [
      { id: "answer-a", type: "agentMessage", title: "Codex", text: "Before", startedAt: 105, firstTokenAt: 107 },
      { id: "tool", type: "commandExecution", title: "Command", text: "work", startedAt: 110 },
      { id: "answer-b", type: "agentMessage", title: "Codex", text: "After", startedAt: 202, firstTokenAt: 203 }
    ]
  }]).filter((row) => row.kind === "assistantMessage");

  expect(rows.map((row) => [row.turnStartedAt, row.startedAt, row.firstTokenAt])).toEqual([
    [100, 105, 107],
    [100, 202, 203]
  ]);
});

test("live assistant rows suppress tok/s speed details until completion", () => {
  const liveUsage = {
    totalTokens: 90,
    inputTokens: 60,
    cachedInputTokens: 10,
    cacheWriteInputTokens: 0,
    outputTokens: 20,
    estimatedCostUsd: 0.004
  };
  const completedUsage = {
    totalTokens: 120,
    inputTokens: 70,
    cachedInputTokens: 10,
    cacheWriteInputTokens: 0,
    outputTokens: 40,
    estimatedCostUsd: 0.006
  };
  const liveRow = buildChatRows([{
    id: "turn-live-speed",
    threadId: "thread-live-speed",
    status: "inProgress",
    startedAt: 100,
    items: [{
      id: "assistant-live-speed",
      type: "agentMessage",
      title: "Codex",
      text: "Streaming",
      status: "inProgress",
      startedAt: 102,
      firstTokenAt: 104
    }]
  }], undefined, { "turn-live-speed": liveUsage })[0]!;
  const completedRow = buildChatRows([{
    id: "turn-completed-speed",
    threadId: "thread-completed-speed",
    status: "completed",
    startedAt: 100,
    completedAt: 120,
    items: [{
      id: "assistant-completed-speed",
      type: "agentMessage",
      title: "Codex",
      text: "Done",
      status: "completed",
      startedAt: 102,
      firstTokenAt: 104
    }]
  }], undefined, { "turn-completed-speed": completedUsage })[0]!;

  const t = (key: string) => key;
  const liveHtml = renderToStaticMarkup(createElement(ChatRow, { row: liveRow, t }));
  const completedHtml = renderToStaticMarkup(createElement(ChatRow, { row: completedRow, t, assistantUsageDisplay: "details" }));

  expect(liveHtml).not.toContain("tok/s");
  expect(completedHtml).toContain("tok/s");
});

test("turn usage is attached only to the final assistant message", () => {
  const usage = { totalTokens: 30, inputTokens: 20, cachedInputTokens: 10, cacheWriteInputTokens: 0, outputTokens: 10, estimatedCostUsd: 0.004, totalEstimatedCostUsd: 0.02 };
  const rows = buildChatRows([{
    id: "turn-multi-answer-usage", threadId: "thread-multi-answer-usage", status: "completed", items: [
      { id: "answer-before-tool", type: "agentMessage", title: "Codex", text: "Checking" },
      { id: "tool-between", type: "commandExecution", title: "Command", text: "work" },
      { id: "answer-final", type: "agentMessage", title: "Codex", text: "Done" }
    ]
  }], () => true, { "turn-multi-answer-usage": usage }).filter((row) => row.kind === "assistantMessage");

  expect(rows[0]?.tokenUsage).toBeUndefined();
  expect(rows[1]?.tokenUsage).toBe(usage);
});

test("blacklist errors expose a direct group-settings help action", () => {
  const row = buildChatRows([{
    id: "turn-blacklist-help",
    threadId: "thread-blacklist-help",
    status: "completed",
    items: [{
      id: "blacklist-error",
      type: "error",
      title: "Dangerous operation blocked",
      text: "Dangerous operation detected; execution was blocked.",
      status: "failed",
      commandBlacklist: { providerId: "relay-1", groupId: "group-danger" }
    } as WorkbenchTurn["items"][number]]
  }])[0];
  if (!row) throw new Error("Missing blacklist error row");
  const html = renderToStaticMarkup(createElement(ChatRow, {
    row,
    t: (key: string) => ({
      "chat.commandBlacklistSettings": "Open blacklist settings",
      "chat.commandBlacklistSettingsTooltip": "Open this relay group's blacklist settings"
    })[key] ?? key,
    onOpenCommandBlacklistSettings: () => undefined
  }));
  expect(html).toContain('aria-label="Open blacklist settings"');
  expect(html).toContain("MuiSvgIcon-root");
});

test("reasoning summary parts restore Markdown bold and line breaks", () => {
  const raw = "**Planning feasibility strategy****Detailing traffic law assumptions****Evaluating pedestrian safety**";
  const normalized = normalizeReasoningMarkdown(raw);
  expect(normalized).toBe("**Planning feasibility strategy**\n\n**Detailing traffic law assumptions**\n\n**Evaluating pedestrian safety**");
  const rows = buildChatRows([{
    id: "turn-reasoning-markdown", threadId: "thread-reasoning", status: "inProgress", items: [
      { id: "reasoning-markdown", type: "reasoning", title: "Reasoning", text: raw, status: "inProgress" }
    ]
  }]);
  expect(rows[0]?.text).toBe(normalized);
  const html = renderToStaticMarkup(createElement(ChatRow, { row: rows[0]!, t: (key: string) => key, expanded: true }));
  expect(html).toContain('data-testid="thinking-preview"');
  expect(html).not.toContain("****");
  expect(html).toContain("<strong><span>Planning feasibility strategy</span></strong>");
  expect(html).toContain("<strong><span>Detailing traffic law assumptions</span></strong>");
});

test("preserves causal item order when assistant events arrive before a user message", () => {
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-order",
      threadId: "thread-order",
      status: "completed",
      items: [
        {
          id: "assistant-first",
          type: "agentMessage",
          title: "Codex",
          text: "Assistant event with an earlier timestamp",
          firstTokenAt: 100
        },
        {
          id: "user-late",
          type: "userMessage",
          title: "You",
          text: "Continue the traffic light simulation"
        }
      ]
    }
  ];

  const rows = buildChatRows(turns);
  expect(rows.map((row) => row.item.id)).toEqual(["assistant-first", "user-late"]);
});

test("live turn items remain chronological across untimed command events", () => {
  const turns: WorkbenchTurn[] = [{
    id: "turn-live-order",
    threadId: "thread-plan",
    status: "inProgress",
    items: [
      { id: "user", type: "userMessage", title: "You", text: "Plan this" },
      { id: "assistant-first", type: "agentMessage", title: "Codex", text: "I will inspect first", firstTokenAt: 1_721_000_001 },
      { id: "command", type: "commandExecution", title: "Read", text: "README.md" },
      { id: "assistant-later", type: "agentMessage", title: "Codex", text: "Inspection complete", firstTokenAt: 1_721_000_003 }
    ]
  }];

  expect(buildChatRows(turns).map((row) => row.item.id)).toEqual(["user", "assistant-first", "command", "assistant-later"]);
});

test("row keys remain stable when an earlier item arrives during reconciliation", () => {
  const base: WorkbenchTurn = {
    id: "turn-stable-keys",
    threadId: "thread-plan",
    status: "inProgress",
    items: [{ id: "assistant", type: "agentMessage", title: "Codex", text: "Response" }]
  };
  const originalKey = buildChatRows([base])[0]?.key;
  const reconciledKey = buildChatRows([{ ...base, items: [
    { id: "user", type: "userMessage", title: "You", text: "Prompt" },
    ...base.items
  ] }]).find((row) => row.item.id === "assistant")?.key;

  expect(reconciledKey).toBe(originalKey);
});

test("a user steer message stays between the assistant updates it interrupted", () => {
  const turns: WorkbenchTurn[] = [{
    id: "turn-steer-order",
    threadId: "thread-goal",
    status: "inProgress",
    items: [
      { id: "initial-user", type: "userMessage", title: "You", text: "Start the goal" },
      { id: "assistant-before-steer", type: "agentMessage", title: "Codex", text: "Working on it" },
      { id: "steer-user", type: "userMessage", title: "You", text: "Also check packaging" },
      { id: "assistant-after-steer", type: "agentMessage", title: "Codex", text: "Packaging included" }
    ]
  }];

  expect(buildChatRows(turns).map((row) => row.item.id)).toEqual([
    "initial-user",
    "assistant-before-steer",
    "steer-user",
    "assistant-after-steer"
  ]);
});

test("keeps a confirmed steer at the tail when the initial prompt arrives late", () => {
  const turns: WorkbenchTurn[] = [{
    id: "turn-late-initial-steer",
    threadId: "thread-goal",
    status: "inProgress",
    items: [
      { id: "assistant-before-initial", type: "agentMessage", title: "Codex", text: "Working" },
      { id: "initial-user-late", type: "userMessage", title: "You", text: "Start the goal" },
      { id: "assistant-before-steer", type: "agentMessage", title: "Codex", text: "Still working" },
      { id: "steer-user", type: "userMessage", title: "You", text: "Also check packaging" },
      { id: "assistant-after-steer", type: "agentMessage", title: "Codex", text: "Packaging included" }
    ]
  }];

  expect(buildChatRows(turns).map((row) => row.item.id)).toEqual([
    "assistant-before-initial",
    "initial-user-late",
    "assistant-before-steer",
    "steer-user",
    "assistant-after-steer"
  ]);
});

test("uses Codex activity verbs for command actions, terminal waits, and file edits", () => {
  const summary = (item: WorkbenchTurn["items"][number], turnStatus = "inProgress") => {
    const row = buildChatRows([{ id: `turn-${item.id}`, threadId: "thread-actions", status: turnStatus, items: [item] }])[0];
    if (!row) throw new Error(`Missing row for ${item.id}`);
    return activitySummary(row);
  };

  expect(summary({
    id: "read",
    type: "commandExecution",
    title: "Command",
    text: "",
    status: "completed",
    payload: { command: "cat README.md", commandActions: [{ type: "read", name: "README.md", path: "/repo/README.md" }] }
  })).toEqual({ label: "Read", detail: "README.md" });
  expect(summary({
    id: "batched-cmd",
    type: "toolCall",
    title: "Command",
    text: "",
    status: "completed",
    toolName: "run_commands",
    input: { commands: ["git status", "git diff"], cwd: "d:\\projects\\x" },
    arguments: { commands: ["git status", "git diff"], cwd: "d:\\projects\\x" },
  })).toEqual({ label: "Command", detail: "git status && git diff" });  expect(summary({
    id: "list",
    type: "commandExecution",
    title: "Command",
    text: "",
    status: "completed",
    payload: { command: "ls apps", commandActions: [{ type: "listFiles", path: "apps", command: "ls apps" }] }
  })).toEqual({ label: "List", detail: "apps" });
  expect(summary({
    id: "search",
    type: "commandExecution",
    title: "Command",
    text: "",
    status: "completed",
    payload: { command: "rg plan apps", commandActions: [{ type: "search", query: "plan", path: "apps", command: "rg plan apps" }] }
  })).toEqual({ label: "Search", detail: "plan in apps" });
  expect(summary({
    id: "ran",
    type: "commandExecution",
    title: "Command",
    text: "done",
    status: "completed",
    payload: { command: "bun test", commandActions: [{ type: "unknown", command: "bun test" }] }
  })).toEqual({ label: "Ran", detail: "bun test" });
  expect(summary({
    id: "running",
    type: "commandExecution",
    title: "Command",
    text: "",
    status: "inProgress",
    payload: { command: "bun test", commandActions: [{ type: "unknown", command: "bun test" }] }
  }, "inProgress")).toEqual({ label: "Running", detail: "bun test" });
  expect(summary({
    id: "waited",
    type: "commandExecution",
    title: "Command",
    text: "",
    status: "completed",
    payload: { command: "bun run dev", terminalInteraction: { stdin: "" } }
  })).toEqual({ label: "Waited for background terminal", detail: "bun run dev" });
  expect(summary({
    id: "edited",
    type: "fileChange",
    title: "File change",
    text: "",
    status: "completed",
    payload: { changes: [{ path: "apps/web/src/App.tsx", kind: "update" }] }
  })).toEqual({ label: "Edited", detail: "apps/web/src/App.tsx" });
});

test("shows string batched commands and sa-vm list params", () => {
  const summary = (item: WorkbenchTurn["items"][number], turnStatus = "inProgress") => {
    const row = buildChatRows([{ id: `turn-${item.id}`, threadId: "thread-actions", status: turnStatus, items: [item] }])[0];
    if (!row) throw new Error(`Missing row for ${item.id}`);
    return activitySummary(row);
  };

  // cline run_commands carries a single string (not an array).
  expect(summary({
    id: "str-cmd",
    type: "toolCall",
    title: "Command",
    text: "",
    status: "completed",
    toolName: "run_commands",
    input: { commands: "cd /d d:\\projects\\x && dir /b" },
    arguments: { commands: "cd /d d:\\projects\\x && dir /b" },
  })).toEqual({ label: "Command", detail: "cd /d d:\\projects\\x && dir /b" });
  // sa-vm list_dir keeps its dir param visible.
  expect(summary({
    id: "vm-list",
    type: "toolCall",
    title: "vm-list",
    text: "",
    status: "completed",
    toolName: "sa-vm__sa_vm_run",
    input: { action: "list_dir", dir: "apps", depth: 2, max_entries: 120 },
    arguments: { action: "list_dir", dir: "apps", depth: 2, max_entries: 120 },
  })).toEqual({ label: "vm-list", detail: "apps" });
});

test("attaches request-level usage to the last assistant row", () => {
  const turns: WorkbenchTurn[] = [{
    id: "turn-usage-requests",
    threadId: "thread-usage-requests",
    status: "completed",
    items: [
      { id: "assistant-first", type: "agentMessage", title: "Codex", text: "First" },
      { id: "assistant-last", type: "agentMessage", title: "Codex", text: "Last" }
    ]
  }];
  const request = { totalTokens: 12, inputTokens: 10, cachedInputTokens: 8, cacheWriteInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 1 };
  const rows = buildChatRows(turns, undefined, {}, {}, { "turn-usage-requests": { "response-1": request } });
  expect(rows[0]?.requestUsage).toBeUndefined();
  expect(rows[1]?.requestUsage).toEqual([{ requestId: "response-1", usage: request }]);
});

test("cleanPreviewUrl strips markdown backticks, brackets and punctuation", () => {
  expect(cleanPreviewUrl("`http://127.0.0.1:4174/`")).toBe("http://127.0.0.1:4174/");
  expect(cleanPreviewUrl("'http://localhost:3000'")).toBe("http://localhost:3000/");
  expect(cleanPreviewUrl('"http://[::1]:8080"')).toBe("http://[::1]:8080/");
  expect(cleanPreviewUrl("http://localhost:3000/index.html.")).toBe("http://localhost:3000/index.html");
  expect(cleanPreviewUrl("http://localhost:3000/index.html；")).toBe("http://localhost:3000/index.html");
  expect(cleanPreviewUrl("http://localhost:3000/index.html。")).toBe("http://localhost:3000/index.html");
  expect(cleanPreviewUrl("127.0.0.1:4174")).toBe("http://127.0.0.1:4174/");
  expect(cleanPreviewUrl("localhost:5173/test.html")).toBe("http://localhost:5173/test.html");
  expect(cleanPreviewUrl("http://0.0.0.0:3000")).toBe("http://0.0.0.0:3000/");
  expect(cleanPreviewUrl("0.0.0.0:8080/app")).toBe("http://0.0.0.0:8080/app");
  expect(cleanPreviewUrl("http://example.com")).toBeUndefined();
});

test("detectLocalPreviewUrl safely extracts URL without backticks or subsequent Chinese text", () => {
  const textWithChinese = "你可以访问 `http://127.0.0.1:4173/` 预览HTML；如果服务已关闭，请在终端重新启动。";
  expect(detectLocalPreviewUrl(textWithChinese)).toBe("http://127.0.0.1:4173/");

  const textWithBackticks = "Server running at `http://127.0.0.1:4174/`";
  expect(detectLocalPreviewUrl(textWithBackticks)).toBe("http://127.0.0.1:4174/");

  const textWithBareHost = "Started dev server on 127.0.0.1:5173";
  expect(detectLocalPreviewUrl(textWithBareHost)).toBe("http://127.0.0.1:5173/");

  const textMultiple = "Old at http://localhost:3000, now switched to `http://localhost:3001/`";
  expect(detectLocalPreviewUrl(textMultiple)).toBe("http://localhost:3001/");

  const textZero = "Listening on http://0.0.0.0:8000/";
  expect(detectLocalPreviewUrl(textZero)).toBe("http://0.0.0.0:8000/");
});

test("toolUse and tool_use item types are mapped to toolCall and compact into toolActivityGroup", () => {
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-pi-tools",
      threadId: "thread-pi",
      status: "completed",
      items: [
        { id: "pi-tool-1", type: "toolUse", title: "read_file", toolName: "read_file", name: "read_file", status: "completed", payload: { path: "src/main.ts" } },
        { id: "pi-tool-2", type: "tool_use", title: "edit_file", toolName: "edit_file", name: "edit_file", status: "completed", payload: { path: "src/main.ts" } },
      ],
    },
  ];

  const rows = buildChatRows(turns);
  // Consecutive settled toolCall rows are compacted into toolActivityGroup
  expect(rows).toHaveLength(1);
  expect(rows[0]?.kind).toBe("toolActivityGroup");
  expect(rows[0]?.title).toBe("2 tool calls");

  // A live single toolUse row maps to kind toolCall (not fallback status)
  const liveTurns: WorkbenchTurn[] = [
    {
      id: "turn-pi-live",
      threadId: "thread-pi",
      status: "inProgress",
      items: [
        { id: "pi-tool-live", type: "toolUse", title: "search", toolName: "search", name: "search", status: "inProgress", payload: { query: "export" } },
      ],
    },
  ];
  const liveRows = buildChatRows(liveTurns);
  expect(liveRows).toHaveLength(1);
  expect(liveRows[0]?.kind).toBe("toolCall");
  const summary = activitySummary(liveRows[0]!);
  expect(summary.label).toBe("Search");
  expect(summary.detail).toBe('"export"');
});

test("keeps only the newest plan card per thread so Plan and Updated Plan never show together", () => {
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-old",
      threadId: "thread-mini",
      status: "completed",
      items: [
        { id: "turn-plan-turn-old", type: "plan", title: "Updated Plan", text: "- [x] done", status: "completed" }
      ]
    },
    {
      id: "turn-new",
      threadId: "thread-mini",
      status: "inProgress",
      items: [
        { id: "mini-plan-turn-new", type: "plan", title: "Plan", text: "- [ ] next", status: "inProgress" }
      ]
    }
  ];

  const rows = buildChatRows(turns);
  const planRows = rows.filter((row) => row.kind === "plan");
  expect(planRows).toHaveLength(1);
  expect(planRows[0]?.item.id).toBe("mini-plan-turn-new");
});

test("plan cards from different threads are kept independently", () => {
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-a",
      threadId: "thread-a",
      status: "completed",
      items: [{ id: "plan-a", type: "plan", title: "Updated Plan", text: "- [x] done", status: "completed" }]
    },
    {
      id: "turn-b",
      threadId: "thread-b",
      status: "inProgress",
      items: [{ id: "plan-b", type: "plan", title: "Plan", text: "- [ ] next", status: "inProgress" }]
    }
  ];

  const rows = buildChatRows(turns);
  expect(rows.filter((row) => row.kind === "plan")).toHaveLength(2);
});
