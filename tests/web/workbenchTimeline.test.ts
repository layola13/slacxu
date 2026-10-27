import { expect, test } from "bun:test";
import {
  composerInputToUserInput,
  applyNotification,
  applyNotificationPreservingActiveThread,
  applyNotificationsPreservingActiveThread,
  reviewStartTurnToWorkbenchTurn,
  coalesceStreamingWorkbenchNotifications,
  initialClientState,
  threadReadToTurns,
  threadResponseIncludesTranscript,
  threadTurnsPageToTurns,
  type ClientState,
  type WorkbenchItem,
  type WorkbenchTurn
} from "../../apps/web/src/state/codexClient.ts";

test("metadata-only resume responses do not suppress paginated transcript loading", () => {
  expect(threadResponseIncludesTranscript({ thread: { id: "thread-main", turns: [] } })).toBe(false);
  expect(threadResponseIncludesTranscript({
    thread: { id: "thread-main", turns: [{ id: "turn-1", status: "completed", items: [] }] }
  })).toBe(true);
});
import {
  mergeWorkbenchTurns,
  orderWorkbenchItems,
  orderWorkbenchTurns,
  upsertWorkbenchItem,
  upsertWorkbenchTurn
} from "../../apps/web/src/state/workbenchTimeline.ts";

function item(id: string, overrides: Partial<WorkbenchItem> = {}): WorkbenchItem {
  return { id, type: "agentMessage", title: "Codex", text: id, ...overrides };
}

function turn(id: string, overrides: Partial<WorkbenchTurn> = {}): WorkbenchTurn {
  return { id, threadId: "thread-main", status: "inProgress", items: [], ...overrides };
}

function notify(state: ClientState, method: string, params: Record<string, unknown>): ClientState {
  return applyNotification(state, { method, params });
}

test("late transcript activity does not revive an interrupted turn", () => {
  const state: ClientState = {
    ...initialClientState,
    activeThreadId: "thread-main",
    turns: [turn("turn-stop", { status: "interrupted", startedAt: 10, completedAt: 11 })]
  };

  const fromDerivedActivity = notify(state, "turn/started", {
    threadId: "thread-main",
    runtimeActivityReactivation: true,
    turn: { id: "turn-stop", threadId: "thread-main", status: "inProgress", startedAt: 20 }
  });
  expect(fromDerivedActivity.turns[0]?.status).toBe("interrupted");

  const fromLateStarted = notify(state, "turn/started", {
    threadId: "thread-main",
    turn: { id: "turn-stop", threadId: "thread-main", status: "inProgress", startedAt: 20 }
  });
  expect(fromLateStarted.turns[0]?.status).toBe("interrupted");

  const fromLateItem = notify(state, "item/agentMessage/delta", {
    threadId: "thread-main",
    turnId: "turn-stop",
    itemId: "answer",
    delta: "late output"
  });
  expect(fromLateItem.turns[0]?.status).toBe("interrupted");
});

test("uploaded Office attachments expose their readable local path to Codex", () => {
  const docxPath = String.raw`C:\Users\zhan\.codex-ultra\attachments\default.docx`;
  const input = composerInputToUserInput("Inspect this document", [{
    id: "docx-1",
    name: "default.docx",
    url: docxPath,
    path: docxPath,
    size: 38116,
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "file"
  }]);

  expect(input).toEqual([
    { type: "text", text: `Inspect this document\n${docxPath}`, text_elements: [] },
    { type: "mention", name: "default.docx", path: docxPath }
  ]);
});

test("Office attachment paths are not duplicated when already present in the prompt", () => {
  const xlsxPath = String.raw`C:\Users\zhan\.codex-ultra\attachments\book.xlsx`;
  const input = composerInputToUserInput(`Inspect ${xlsxPath}`, [{
    id: "xlsx-1",
    name: "book.xlsx",
    url: xlsxPath,
    path: xlsxPath,
    size: 2048,
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "file"
  }]);

  expect(input[0]).toEqual({ type: "text", text: `Inspect ${xlsxPath}`, text_elements: [] });
});

test("image view history keeps only the local path for lazy preview loading", () => {
  const path = String.raw`E:\projects\codex-react-ui\snapshot\website-desktop.png`;
  const loaded = threadReadToTurns({
    thread: {
      id: "thread-image-view",
      turns: [{ id: "turn-image-view", status: "completed", items: [{ id: "image-view-1", type: "imageView", path }] }]
    }
  });

  expect(loaded.turns[0]?.items[0]).toEqual(expect.objectContaining({
    type: "imageView",
    title: "Image view",
    images: [{ url: path, name: path }]
  }));
  expect(JSON.stringify(loaded.turns[0]?.items[0])).not.toContain("base64");
});

test("descending thread history pages are normalized into chronological order", () => {
  const page = threadTurnsPageToTurns("thread-main", {
    data: [
      { id: "turn-new", status: "completed", startedAt: 20, completedAt: 21, itemsView: "full", items: [] },
      { id: "turn-old", status: "completed", startedAt: 10, completedAt: 11, itemsView: "full", items: [] }
    ],
    nextCursor: "older-page"
  }, "desc");

  expect(page.turns.map((entry) => entry.id)).toEqual(["turn-old", "turn-new"]);
  expect(page.nextCursor).toBe("older-page");
});

test("thread metadata exposes whether history is truly paginated", () => {
  const paginated = threadReadToTurns({ thread: { id: "thread-paged", historyMode: "paginated", turns: [] } });
  const legacy = threadReadToTurns({ thread: { id: "thread-legacy", turns: [] } });

  expect(paginated.thread?.historyMode).toBe("paginated");
  expect(legacy.thread?.historyMode).toBe("legacy");
});

test("thread metadata preserves the Claude history backend", () => {
  const claude = threadReadToTurns({ thread: { id: "thread-claude", cliBackend: "claude", turns: [] } });
  // No default: more CLIs may be added, so an absent backend stays unknown
  // instead of being assumed to be codex.
  const unspecified = threadReadToTurns({ thread: { id: "thread-codex", turns: [] } });
  const codex = threadReadToTurns({ thread: { id: "thread-codex-explicit", cliBackend: "codex", turns: [] } });

  expect(claude.thread?.cliBackend).toBe("claude");
  expect(unspecified.thread?.cliBackend).toBeUndefined();
  expect(codex.thread?.cliBackend).toBe("codex");
});

test("thread metadata restores additional writable directories", () => {
  const loaded = threadReadToTurns({
    thread: {
      id: "thread-workspace-roots",
      cwd: String.raw`E:\projects\primary`,
      additionalRoots: [String.raw`E:\projects\shared`, String.raw`D:\data`],
      workspaceMode: "local",
      turns: []
    }
  });

  expect(loaded.thread).toMatchObject({
    cwd: String.raw`E:\projects\primary`,
    additionalRoots: [String.raw`E:\projects\shared`, String.raw`D:\data`]
  });
});

test("ignored protocol notifications preserve the client state reference", () => {
  const state = { ...initialClientState, activeThreadId: "thread-main" };
  const next = applyNotificationPreservingActiveThread(state, {
    method: "thread/tokenUsage/updated",
    params: { threadId: "thread-main", turnId: "turn-main" },
  });

  expect(next).toBe(state);
});

test("coalesces interleaved streaming deltas by target", () => {
  const notifications = coalesceStreamingWorkbenchNotifications([
    { method: "item/agentMessage/delta", params: { threadId: "thread-main", turnId: "turn-main", itemId: "item-a", delta: "Hello" } },
    { method: "item/agentMessage/delta", params: { threadId: "thread-main", turnId: "turn-main", itemId: "item-a", delta: " world" } },
    { method: "item/agentMessage/delta", params: { threadId: "thread-main", turnId: "turn-main", itemId: "item-b", delta: "Next" } },
    { method: "item/agentMessage/delta", params: { threadId: "thread-main", turnId: "turn-main", itemId: "item-a", delta: " later" } },
  ]);

  expect(notifications).toHaveLength(2);
  expect((notifications[0]?.params as { delta?: string }).delta).toBe("Hello world later");
  expect((notifications[1]?.params as { itemId?: string }).itemId).toBe("item-b");
});

test("coalesces Mini deltas when target aliases mix camelCase and snake_case", () => {
  const notifications = coalesceStreamingWorkbenchNotifications([
    { method: "item/agentMessage/delta", params: { threadId: "thread-mini", turnId: "turn-mini", itemId: "answer", delta: "Hello" } },
    { method: "item/agentMessage/delta", params: { thread_id: "thread-mini", turn_id: "turn-mini", item_id: "answer", delta: " Mini" } },
  ]);

  expect(notifications).toHaveLength(1);
  expect((notifications[0]?.params as { delta?: string }).delta).toBe("Hello Mini");
});

test("does not coalesce deltas across an item completion boundary", () => {
  const notifications = coalesceStreamingWorkbenchNotifications([
    { method: "item/agentMessage/delta", params: { threadId: "thread-mini", turnId: "turn-mini", itemId: "answer", delta: "Before" } },
    { method: "item/completed", params: { threadId: "thread-mini", turnId: "turn-mini", item: { id: "answer", type: "agentMessage", text: "Before" } } },
    { method: "item/agentMessage/delta", params: { thread_id: "thread-mini", turn_id: "turn-mini", item_id: "answer", delta: "After" } },
  ]);

  expect(notifications).toHaveLength(3);
  expect((notifications[0]?.params as { delta?: string }).delta).toBe("Before");
  expect((notifications[2]?.params as { delta?: string }).delta).toBe("After");
});

test("does not coalesce deltas across a terminal turn boundary", () => {
  const notifications = coalesceStreamingWorkbenchNotifications([
    { method: "item/agentMessage/delta", params: { threadId: "thread-mini", turnId: "turn-mini", itemId: "answer", delta: "Before" } },
    { method: "turn/completed", params: { threadId: "thread-mini", turnId: "turn-mini", turn: { id: "turn-mini", status: "completed" } } },
    { method: "item/agentMessage/delta", params: { thread_id: "thread-mini", turn_id: "turn-mini", item_id: "answer", delta: "After" } },
  ]);

  expect(notifications).toHaveLength(3);
  expect(notifications[1]?.method).toBe("turn/completed");
  expect((notifications[2]?.params as { delta?: string }).delta).toBe("After");
});

test("terminal turn without thread identity still forms a coalescing boundary", () => {
  const notifications = coalesceStreamingWorkbenchNotifications([
    { method: "item/agentMessage/delta", params: { threadId: "thread-mini", turnId: "turn-mini", itemId: "answer", delta: "Before" } },
    { method: "turn/completed", params: { turn: { id: "turn-mini", status: "completed" } } },
    { method: "item/agentMessage/delta", params: { thread_id: "thread-mini", turn_id: "turn-mini", item_id: "answer", delta: "After" } },
  ]);

  expect(notifications).toHaveLength(3);
});

test("terminal boundary without thread identity does not block another thread", () => {
  const notifications = coalesceStreamingWorkbenchNotifications([
    { method: "item/agentMessage/delta", params: { threadId: "thread-a", turnId: "shared-turn", itemId: "answer", delta: "A" } },
    { method: "turn/completed", params: { turn: { id: "shared-turn", status: "completed" } } },
    { method: "item/agentMessage/delta", params: { threadId: "thread-b", turnId: "shared-turn", itemId: "answer", delta: "B" } },
    { method: "item/agentMessage/delta", params: { threadId: "thread-b", turnId: "shared-turn", itemId: "answer", delta: "C" } },
  ]);

  expect(notifications).toHaveLength(3);
  expect((notifications[2]?.params as { delta?: string }).delta).toBe("BC");
});

test("item restart separates deltas when Mini retries the same segment ID", () => {
  const notifications = coalesceStreamingWorkbenchNotifications([
    { method: "item/agentMessage/delta", params: { threadId: "thread-mini", turnId: "turn-mini", itemId: "answer-s1", delta: "partial" } },
    { method: "item/started", params: { threadId: "thread-mini", turnId: "turn-mini", item: { id: "answer-s1", type: "agentMessage", status: "inProgress", text: "" } } },
    { method: "item/agentMessage/delta", params: { threadId: "thread-mini", turnId: "turn-mini", itemId: "answer-s1", delta: "complete" } },
  ]);

  expect(notifications).toHaveLength(3);
  expect((notifications[0]?.params as { delta?: string }).delta).toBe("partial");
  expect((notifications[2]?.params as { delta?: string }).delta).toBe("complete");
});

test("Mini retry rollback clears failed partial text when a coalesced batch is projected", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-mini",
    turn: { id: "turn-mini-retry", threadId: "thread-mini", status: "inProgress" }
  });
  const notifications = coalesceStreamingWorkbenchNotifications([
    { method: "item/agentMessage/delta", params: { threadId: "thread-mini", turnId: "turn-mini-retry", itemId: "mini-msg-turn-mini-retry-s1", delta: "failed partial" } },
    { method: "mini/item/rollback", params: { threadId: "thread-mini", turnId: "turn-mini-retry", itemIds: ["mini-msg-turn-mini-retry-s1"] } },
    { method: "item/agentMessage/delta", params: { threadId: "thread-mini", turnId: "turn-mini-retry", itemId: "mini-msg-turn-mini-retry-s2", delta: "retried answer" } },
    { method: "turn/completed", params: { threadId: "thread-mini", turn: { id: "turn-mini-retry", threadId: "thread-mini", status: "completed" } } }
  ]);
  state = applyNotificationsPreservingActiveThread(state, notifications);
  expect(state.turns[0]?.items.map((entry) => entry.text)).toEqual(["retried answer"]);
});

test("Mini retry rollback is idempotent and scoped to its turn", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-mini", turn: { id: "turn-a", threadId: "thread-mini", status: "inProgress" }
  });
  state = notify(state, "item/agentMessage/delta", {
    threadId: "thread-mini", turnId: "turn-a", itemId: "segment-a", delta: "partial"
  });
  const rollback = { method: "mini/item/rollback", params: { threadId: "thread-mini", turnId: "turn-a", itemIds: ["segment-a"] } } as const;
  state = notify(state, rollback.method, rollback.params);
  const afterFirst = state;
  state = notify(state, rollback.method, rollback.params);
  expect(state.turns[0]?.items).toEqual(afterFirst.turns[0]?.items);
  state = notify(state, "mini/item/rollback", {
    threadId: "thread-other", turnId: "turn-a", itemIds: ["segment-a"]
  });
  expect(state.turns[0]?.items).toHaveLength(0);
});

test("assistant streaming deltas refresh the visible message update time", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-main",
    turn: { id: "turn-live-time", threadId: "thread-main", status: "inProgress", startedAt: 100 }
  });
  state = notify(state, "item/agentMessage/delta", {
    threadId: "thread-main", turnId: "turn-live-time", itemId: "answer", delta: "First", updatedAt: 110
  });
  expect(state.turns[0]?.items[0]?.updatedAt).toBe(110);

  state = notify(state, "item/agentMessage/delta", {
    threadId: "thread-main", turnId: "turn-live-time", itemId: "answer", delta: " update", updatedAt: 125
  });
  expect(state.turns[0]?.items[0]).toMatchObject({ text: "First update", updatedAt: 125 });
});

test("projects streamed reasoning and preserves it when completion has an empty summary", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-main", turn: { id: "turn-reasoning", threadId: "thread-main", status: "inProgress" }
  });
  state = notify(state, "item/reasoning/summaryTextDelta", {
    threadId: "thread-main", turnId: "turn-reasoning", itemId: "reasoning-1", delta: "Inspecting "
  });
  state = notify(state, "item/reasoning/summaryTextDelta", {
    threadId: "thread-main", turnId: "turn-reasoning", itemId: "reasoning-1", delta: "the code"
  });
  expect(state.turns[0]?.items[0]).toMatchObject({ type: "reasoning", text: "Inspecting the code", status: "inProgress" });

  state = notify(state, "item/completed", {
    threadId: "thread-main", turnId: "turn-reasoning",
    item: { id: "reasoning-1", type: "reasoning", summary: [] }
  });
  expect(state.turns[0]?.items[0]).toMatchObject({ type: "reasoning", text: "Inspecting the code", status: "completed" });
});

test("assistant first-token timestamps remain item-local across completion-only turns", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-first-token", turn: { id: "turn-a", threadId: "thread-first-token", status: "inProgress", startedAt: 1_721_000_000 }
  });
  state = notify(state, "item/completed", {
    threadId: "thread-first-token", turnId: "turn-a",
    item: { id: "answer-a", type: "agentMessage", text: "A", status: "completed", firstTokenAt: 1_721_000_003 }
  });
  state = notify(state, "turn/started", {
    threadId: "thread-first-token", turn: { id: "turn-b", threadId: "thread-first-token", status: "inProgress", startedAt: 1_721_000_100 }
  });
  state = notify(state, "item/agentMessage/delta", {
    threadId: "thread-first-token", turnId: "turn-b", itemId: "answer-b", delta: "B", firstTokenAt: 1_721_000_107
  });

  expect(state.turns.find((turn) => turn.id === "turn-a")?.items[0]?.firstTokenAt).toBe(1_721_000_003);
  expect(state.turns.find((turn) => turn.id === "turn-b")?.items[0]?.firstTokenAt).toBe(1_721_000_107);
});

test("assistant first-token baselines remain local after long reasoning and tool work", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-first-token-gap",
    turn: { id: "turn-gap", threadId: "thread-first-token-gap", status: "inProgress", startedAt: 100 }
  });
  state = notify(state, "item/started", {
    threadId: "thread-first-token-gap", turnId: "turn-gap",
    item: { id: "reasoning-gap", type: "reasoning", startedAt: 101 }
  });
  state = notify(state, "item/started", {
    threadId: "thread-first-token-gap", turnId: "turn-gap",
    item: { id: "tool-gap", type: "commandExecution", command: "long task", startedAt: 110 }
  });
  state = notify(state, "item/completed", {
    threadId: "thread-first-token-gap", turnId: "turn-gap",
    item: { id: "tool-gap", type: "commandExecution", command: "long task", completedAt: 280 }
  });
  state = notify(state, "item/started", {
    threadId: "thread-first-token-gap", turnId: "turn-gap",
    item: { id: "answer-gap", type: "agentMessage", startedAt: 282 }
  });
  state = notify(state, "item/agentMessage/delta", {
    threadId: "thread-first-token-gap", turnId: "turn-gap", itemId: "answer-gap",
    delta: "Done", firstTokenAt: 284
  });

  expect(state.turns[0]?.items.find((entry) => entry.id === "answer-gap")).toMatchObject({
    startedAt: 282,
    firstTokenAt: 284
  });
});

test("coalesces reasoning summary and raw text streams independently", () => {
  const notifications = coalesceStreamingWorkbenchNotifications([
    { method: "item/reasoning/summaryTextDelta", params: { threadId: "thread-main", turnId: "turn-main", itemId: "reasoning-1", delta: "A" } },
    { method: "item/reasoning/textDelta", params: { threadId: "thread-main", turnId: "turn-main", itemId: "reasoning-1", delta: "raw" } },
    { method: "item/reasoning/summaryTextDelta", params: { threadId: "thread-main", turnId: "turn-main", itemId: "reasoning-1", delta: "B" } }
  ]);
  expect(notifications).toHaveLength(2);
  expect((notifications[0]?.params as { delta?: string }).delta).toBe("AB");
  expect((notifications[1]?.params as { delta?: string }).delta).toBe("raw");
});

test("bounds a hundred-agent interleaved delta burst to one update per agent", () => {
  const notifications = coalesceStreamingWorkbenchNotifications(Array.from({ length: 1_000 }, (_, index) => {
    const agent = index % 100;
    return {
      method: "item/agentMessage/delta",
      params: { threadId: `agent-${agent}`, turnId: `turn-${agent}`, itemId: `item-${agent}`, delta: "x" }
    };
  }));
  expect(notifications).toHaveLength(100);
  expect((notifications[0]?.params as { delta?: string }).delta).toHaveLength(10);
});

test("applies a hundred-agent streaming batch without replacing unrelated turns", () => {
  const turns = Array.from({ length: 100 }, (_, index) => turn(`turn-${index}`, {
    threadId: `agent-${index}`,
    items: [item(`item-${index}`, { text: "" })],
  }));
  const untouched = turn("turn-untouched", { threadId: "thread-main" });
  const state = { ...initialClientState, activeThreadId: "thread-main", turns: [...turns, untouched] };
  const notifications = Array.from({ length: 100 }, (_, index) => ({
    method: "item/agentMessage/delta",
    params: { threadId: `agent-${index}`, turnId: `turn-${index}`, itemId: `item-${index}`, delta: "x" },
  }));

  const next = applyNotificationsPreservingActiveThread(state, notifications);

  expect(next.activeThreadId).toBe("thread-main");
  expect(next.turns[100]).toBe(untouched);
  expect(next.turns.slice(0, 100).every((entry) => entry.items[0]?.text === "x")).toBe(true);
});

test("live item insertion preserves notification arrival order", () => {
  let items: WorkbenchItem[] = [];
  items = upsertWorkbenchItem(items, item("user", { type: "userMessage", title: "You" }));
  items = upsertWorkbenchItem(items, item("assistant-first", { firstTokenAt: 1_721_000_001 }));
  items = upsertWorkbenchItem(items, item("command", { type: "commandExecution", firstTokenAt: undefined }));
  items = upsertWorkbenchItem(items, item("assistant-later", { firstTokenAt: 1_721_000_003 }));

  expect(items.map((entry) => entry.id)).toEqual(["user", "assistant-first", "command", "assistant-later"]);
  expect(orderWorkbenchItems(items).map((entry) => entry.id)).toEqual(["user", "assistant-first", "command", "assistant-later"]);
});

test("authoritative notifications can replace plan text while late starts cannot erase streamed text", () => {
  let items = [item("plan", { type: "plan", text: "A longer obsolete plan", status: "inProgress" })];
  items = upsertWorkbenchItem(items, item("plan", { type: "plan", text: "Current plan", status: "inProgress" }));
  expect(items[0]?.text).toBe("Current plan");

  items = upsertWorkbenchItem(items, item("plan", { type: "plan", text: "", status: undefined }));
  expect(items[0]?.text).toBe("Current plan");
});

test("fully timed items preserve canonical protocol order", () => {
  const items = [
    item("milliseconds-later", { firstTokenAt: 1_721_000_002_000 }),
    item("seconds-first", { firstTokenAt: 1_721_000_001 })
  ];
  expect(orderWorkbenchItems(items).map((entry) => entry.id)).toEqual(["milliseconds-later", "seconds-first"]);
});

test("tool calls remain before the assistant answer despite incomparable timestamps", () => {
  const items = [
    item("reasoning", { type: "reasoning", firstTokenAt: 1_721_000_001 }),
    item("tool", { type: "mcpToolCall", firstTokenAt: 1_721_000_010, payload: { completedAt: 1_721_000_010 } }),
    item("answer", { type: "agentMessage", firstTokenAt: 1_721_000_002 })
  ];
  expect(orderWorkbenchItems(items).map((entry) => entry.id)).toEqual(["reasoning", "tool", "answer"]);
});

test("an incomplete timestamp set keeps canonical protocol order", () => {
  const items = [
    item("first-timed", { firstTokenAt: 20 }),
    item("untimed-command", { type: "commandExecution" }),
    item("later-event-with-earlier-clock", { firstTokenAt: 10 })
  ];
  expect(orderWorkbenchItems(items).map((entry) => entry.id)).toEqual(items.map((entry) => entry.id));
});

test("stale snapshots retain live rows and do not regress terminal state or streamed text", () => {
  const current = [turn("turn-plan", {
    status: "completed",
    startedAt: 1_721_000_000,
    completedAt: 1_721_000_010,
    items: [
      item("user", { type: "userMessage", title: "You", text: "/plan investigate" }),
      item("turn-plan-turn-plan", {
        type: "plan",
        title: "Updated Plan",
        text: "- [x] Inspect\n- [ ] Fix",
        status: "completed",
        payload: { plan: [{ step: "Inspect", status: "completed" }, { step: "Fix", status: "completed" }] }
      }),
      item("assistant", { text: "The complete streamed response", status: "completed" })
    ]
  })];
  const stale = [turn("turn-plan", {
    status: "inProgress",
    startedAt: 1_721_000_000_000,
    items: [
      item("user", { type: "userMessage", title: "You", text: "/plan investigate" }),
      item("assistant", { text: "The complete", status: "inProgress" })
    ]
  })];

  const merged = mergeWorkbenchTurns(current, stale);
  expect(merged[0]?.status).toBe("completed");
  expect(merged[0]?.items.map((entry) => entry.id)).toEqual(["user", "turn-plan-turn-plan", "assistant"]);
  expect(merged[0]?.items.find((entry) => entry.id === "assistant")?.text).toBe("The complete streamed response");
  expect(merged[0]?.items.find((entry) => entry.id === "assistant")?.status).toBe("completed");
});

test("an old terminal snapshot cannot finish a live turn", () => {
  const current = [turn("turn-live", { status: "inProgress", startedAt: 200, items: [] })];
  const stale = [turn("turn-live", { status: "completed", startedAt: 100, completedAt: 150, items: [] })];
  expect(mergeWorkbenchTurns(current, stale)[0]?.status).toBe("inProgress");
});
test("snapshot reconciliation does not duplicate a live user message when item ids differ", () => {
  const live = [turn("turn-plan", {
    items: [
      item("live-user-id", { type: "userMessage", title: "You", text: "Implement the plan." }),
      item("live-plan", { type: "plan", text: "Implement the checklist" })
    ]
  })];
  const snapshot = [turn("turn-plan", {
    items: [
      item("snapshot-user-id", { type: "userMessage", title: "You", text: "Implement the plan." }),
      item("live-plan", { type: "plan", text: "Implement the checklist" })
    ]
  })];

  const merged = mergeWorkbenchTurns(live, snapshot);
  expect(merged[0]?.items.filter((entry) => entry.type === "userMessage")).toHaveLength(1);
  expect(merged[0]?.items[0]?.id).toBe("live-user-id");
});

test("snapshot reconciliation preserves intentionally repeated user messages", () => {
  const live = [turn("turn-steered", {
    items: [
      item("live-user-1", { type: "userMessage", title: "You", text: "Try again" }),
      item("live-user-2", { type: "userMessage", title: "You", text: "Try again" })
    ]
  })];
  const snapshot = [turn("turn-steered", {
    items: [
      item("snapshot-user-1", { type: "userMessage", title: "You", text: "Try again" }),
      item("snapshot-user-2", { type: "userMessage", title: "You", text: "Try again" })
    ]
  })];

  const merged = mergeWorkbenchTurns(live, snapshot);
  expect(merged[0]?.items.filter((entry) => entry.type === "userMessage").map((entry) => entry.id)).toEqual([
    "live-user-1",
    "live-user-2"
  ]);
});

test("identical reconnect snapshots preserve the existing turn and item references", () => {
  const current = [turn("reconnect-turn", {
    status: "inProgress",
    items: [
      item("reconnect-user", { type: "userMessage", title: "You", text: "Continue the goal" }),
      item("reconnect-agent", {
        text: "Streaming response",
        status: "inProgress",
        images: [{ url: "https://example.invalid/image.png", name: "preview" }],
        payload: { nested: { status: "running" }, values: [1, 2, 3] }
      })
    ]
  })];
  const snapshot = [turn("reconnect-turn", {
    status: "inProgress",
    items: [
      item("reconnect-user", { type: "userMessage", title: "You", text: "Continue the goal" }),
      item("reconnect-agent", {
        text: "Streaming response",
        status: "inProgress",
        images: [{ url: "https://example.invalid/image.png", name: "preview" }],
        payload: { nested: { status: "running" }, values: [1, 2, 3] }
      })
    ]
  })];

  const merged = mergeWorkbenchTurns(current, snapshot);
  expect(merged).toBe(current);
  expect(merged[0]).toBe(current[0]);
  expect(merged[0]?.items[1]).toBe(current[0]?.items[1]);
});

test("snapshot reconciliation deduplicates renumbered assistant messages while preserving live tool order", () => {
  const live = [turn("turn-lossy-snapshot", {
    status: "completed",
    items: [
      item("live-user", { type: "userMessage", title: "You", text: "Plan Windows support" }),
      item("live-agent-1", { text: "I will inspect the project first." }),
      item("live-tool-1", { type: "commandExecution", title: "Command", text: "Read build.zig" }),
      item("live-tool-2", { type: "dynamicToolCall", title: "Tool", text: "Inspect runtime bindings" }),
      item("live-agent-2", { text: "The build currently assumes Linux paths." }),
      item("live-patch", { type: "dynamicToolCall", title: "Patch", text: "Write the compatibility plan" }),
      item("live-agent-3", { text: "The plan is ready." })
    ]
  })];
  const snapshot = [turn("turn-lossy-snapshot", {
    status: "completed",
    items: [
      item("item-1", { type: "userMessage", title: "You", text: "Plan Windows support" }),
      item("item-2", { text: "I will inspect the project first." }),
      item("item-3", { text: "The build currently assumes Linux paths." }),
      item("item-4", { text: "The plan is ready." })
    ]
  })];

  const merged = mergeWorkbenchTurns(live, snapshot);
  expect(merged[0]?.items.map((entry) => entry.id)).toEqual([
    "live-user",
    "live-agent-1",
    "live-tool-1",
    "live-tool-2",
    "live-agent-2",
    "live-patch",
    "live-agent-3"
  ]);
  expect(merged[0]?.items.filter((entry) => entry.type === "agentMessage")).toHaveLength(3);
});

test("snapshot reconciliation matches repeated assistant text by occurrence without swallowing tool calls", () => {
  const live = [turn("turn-repeated-assistant", {
    status: "completed",
    items: [
      item("assistant-first", { text: "Continuing the investigation." }),
      item("tool-between", { type: "commandExecution", text: "Inspect files" }),
      item("assistant-second", { text: "Continuing the investigation." })
    ]
  })];
  const snapshot = [turn("turn-repeated-assistant", {
    status: "completed",
    items: [
      item("snapshot-first", { text: "Continuing the investigation." }),
      item("snapshot-second", { text: "Continuing the investigation." })
    ]
  })];

  const merged = mergeWorkbenchTurns(live, snapshot);
  expect(merged[0]?.items.map((entry) => entry.id)).toEqual([
    "assistant-first",
    "tool-between",
    "assistant-second"
  ]);
});

test("lossy snapshots reconcile assistant messages when agent metadata is omitted", () => {
  const live = [turn("turn-lossy-agent", {
    items: [
      item("live-agent", {
        text: "I will inspect the project first.",
        agentId: "root",
        agentThreadId: "thread-agent-root"
      })
    ]
  })];
  const snapshot = [turn("turn-lossy-agent", {
    items: [item("snapshot-agent", { text: "I will inspect the project first." })]
  })];

  expect(mergeWorkbenchTurns(live, snapshot)[0]?.items.map((entry) => entry.id)).toEqual(["live-agent"]);
});

test("snapshot reconciliation keeps distinct assistants separate when both identities are known", () => {
  const live = [turn("turn-distinct-agents", {
    items: [item("live-agent", { text: "Shared update", agentId: "agent-a" })]
  })];
  const snapshot = [turn("turn-distinct-agents", {
    items: [item("snapshot-agent", { text: "Shared update", agentId: "agent-b" })]
  })];

  expect(mergeWorkbenchTurns(live, snapshot)[0]?.items.map((entry) => entry.id)).toEqual([
    "snapshot-agent",
    "live-agent"
  ]);
});

test("protocol notifications reconcile with lossy thread snapshots without duplicate assistant rows", () => {
  const threadId = "thread-protocol-reconcile";
  const turnId = "turn-protocol-reconcile";
  let state = notify(initialClientState, "turn/started", {
    threadId,
    turn: { id: turnId, threadId, status: "inProgress", startedAt: 1_710_000_100 }
  });
  for (const protocolItem of [
    { id: "live-user", type: "userMessage", content: [{ type: "text", text: "Plan Windows support" }] },
    { id: "live-agent-1", type: "agentMessage", text: "I will inspect the project first." },
    { id: "live-tool", type: "commandExecution", command: "rg platform assumptions", status: "completed" },
    { id: "live-agent-2", type: "agentMessage", text: "The build currently assumes Linux paths." }
  ]) {
    state = notify(state, "item/completed", { threadId, turnId, item: protocolItem });
  }
  state = notify(state, "turn/completed", {
    threadId,
    turn: { id: turnId, threadId, status: "completed", completedAt: 1_710_000_110 }
  });

  const snapshot = threadReadToTurns({
    thread: {
      id: threadId,
      turns: [{
        id: turnId,
        threadId,
        status: "completed",
        startedAt: 1_710_000_100,
        completedAt: 1_710_000_110,
        items: [
          { id: "item-1", type: "userMessage", content: [{ type: "text", text: "Plan Windows support" }] },
          { id: "item-2", type: "agentMessage", text: "I will inspect the project first." },
          { id: "item-3", type: "agentMessage", text: "The build currently assumes Linux paths." }
        ]
      }]
    }
  });

  const merged = mergeWorkbenchTurns(state.turns, snapshot.turns);
  expect(merged[0]?.items.map((entry) => entry.id)).toEqual([
    "live-user",
    "live-agent-1",
    "live-tool",
    "live-agent-2"
  ]);
});

test("late turn started notifications cannot erase already received plan rows", () => {
  const existing = turn("turn-late", {
    items: [item("plan", { type: "plan", title: "Updated Plan", payload: { plan: [{ step: "Inspect", status: "inProgress" }] } })]
  });
  const merged = upsertWorkbenchTurn([existing], turn("turn-late", { startedAt: 1_721_000_000, items: [] }));
  expect(merged[0]?.items.map((entry) => entry.id)).toEqual(["plan"]);
});

test("a newer activity notification reopens a turn after retry recovery", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-retry",
    turn: { id: "turn-retry", threadId: "thread-retry", status: "inProgress", startedAt: 100 }
  });
  state = notify(state, "turn/completed", {
    threadId: "thread-retry",
    turn: { id: "turn-retry", threadId: "thread-retry", status: "completed", completedAt: 110 }
  });
  state = notify(state, "turn/started", {
    threadId: "thread-retry",
    turn: { id: "turn-retry", threadId: "thread-retry", status: "inProgress", startedAt: 120 }
  });
  expect(state.turns[0]).toMatchObject({ status: "inProgress", completedAt: undefined });
});

test("tool activity reopens a completed turn while the tool is still running", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-tool",
    turn: { id: "turn-tool", threadId: "thread-tool", status: "inProgress", startedAt: 100 }
  });
  state = notify(state, "turn/completed", {
    threadId: "thread-tool",
    turn: { id: "turn-tool", threadId: "thread-tool", status: "completed", completedAt: 110 }
  });
  state = notify(state, "item/started", {
    threadId: "thread-tool",
    turnId: "turn-tool",
    item: { id: "tool-1", type: "commandExecution", status: "inProgress" }
  });
  expect(state.turns[0]).toMatchObject({ status: "inProgress", completedAt: undefined });
  expect(state.turns[0]?.items[0]).toMatchObject({ id: "tool-1", status: "inProgress" });
});

test("a late completed snapshot without timestamps cannot finish a live turn", () => {
  const current = [turn("turn-no-clock", { status: "inProgress", startedAt: 1_725_000_000 })];
  const stale = [turn("turn-no-clock", { status: "completed", items: [item("partial", { text: "partial" })] })];
  const merged = mergeWorkbenchTurns(current, stale);
  expect(merged[0]?.status).toBe("inProgress");
  expect(merged[0]?.completedAt).toBeUndefined();
});

test("an old terminal event cannot finish a turn after newer streamed activity", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-extreme",
    turn: { id: "turn-extreme", threadId: "thread-extreme", status: "inProgress", startedAt: 200 }
  });
  state = notify(state, "item/commandExecution/outputDelta", {
    threadId: "thread-extreme", turnId: "turn-extreme", itemId: "tool", delta: "still running"
  });
  state = notify(state, "turn/completed", {
    threadId: "thread-extreme",
    turn: { id: "turn-extreme", threadId: "thread-extreme", status: "completed", completedAt: 150 }
  });
  expect(state.turns[0]?.status).toBe("inProgress");
  expect(state.turns[0]?.completedAt).toBeUndefined();
});

test("duplicate lifecycle notifications are idempotent and preserve streamed content", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-idempotent", turn: { id: "turn-idempotent", status: "inProgress" }
  });
  state = notify(state, "item/agentMessage/delta", {
    threadId: "thread-idempotent", turnId: "turn-idempotent", itemId: "answer", delta: "first"
  });
  const before = state.turns[0];
  state = notify(state, "turn/started", {
    threadId: "thread-idempotent", turn: { id: "turn-idempotent", status: "inProgress" }
  });
  expect(state.turns[0]?.items[0]?.text).toBe("first");
  expect(state.turns[0]?.status).toBe("inProgress");
  expect(state.turns[0]).toBe(before);
});

test("terminal method wins over a stale in-progress payload status", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-terminal-method", turn: { id: "turn-terminal-method", status: "inProgress", startedAt: 100 }
  });
  state = notify(state, "turn/completed", {
    threadId: "thread-terminal-method", turn: { id: "turn-terminal-method", status: "inProgress", completedAt: 200 }
  });
  expect(state.turns[0]?.status).toBe("completed");
});

test("snake_case terminal notifications resolve identity and preserve active guards", () => {
  let state = notify(initialClientState, "turn/started", {
    thread_id: "thread-snake", turn: { id: "turn-snake", thread_id: "thread-snake", status: "inProgress", startedAt: 300 }
  });
  state = notify(state, "item/commandExecution/outputDelta", {
    thread_id: "thread-snake", turn_id: "turn-snake", item_id: "tool-snake", delta: "running"
  });
  state = notify(state, "turn/completed", {
    thread_id: "thread-snake", turn_id: "turn-snake", turn: { id: "turn-snake", thread_id: "thread-snake", completedAt: 250 }
  });
  expect(state.turns[0]?.status).toBe("inProgress");
});

test("a second send reactivates the same historical thread after terminal state", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-repeat", turn: { id: "turn-first", status: "inProgress", startedAt: 50 }
  });
  state = notify(state, "turn/completed", {
    threadId: "thread-repeat", turn: { id: "turn-first", status: "completed", completedAt: 100 }
  });
  state = notify(state, "turn/started", {
    threadId: "thread-repeat", turn: { id: "turn-second", status: "inProgress", startedAt: 200 }
  });
  expect(state.activeThreadId).toBe("thread-repeat");
  expect(state.turns.find((entry) => entry.id === "turn-second")?.status).toBe("inProgress");
  expect(state.turns.find((entry) => entry.id === "turn-first")?.status).toBe("completed");
});

test("goal continuation turns retain canonical order when a newer turn is untimed", () => {
  const turns = [
    turn("goal-first", { status: "completed", startedAt: 1_721_000_000, items: [item("goal-answer-first")] }),
    turn("goal-continuation", { status: "inProgress", items: [item("goal-command", { type: "commandExecution" }), item("goal-answer-later")] })
  ];
  expect(orderWorkbenchTurns(turns).map((entry) => entry.id)).toEqual(["goal-first", "goal-continuation"]);
});

test("notification reducer keeps plan, command, and assistant events in arrival order", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-main",
    turn: { id: "turn-events", threadId: "thread-main", status: "inProgress" }
  });
  state = notify(state, "item/completed", {
    threadId: "thread-main",
    turnId: "turn-events",
    item: { id: "event-user", type: "userMessage", text: "/plan inspect ordering" }
  });
  state = notify(state, "item/agentMessage/delta", {
    threadId: "thread-main",
    turnId: "turn-events",
    itemId: "event-assistant-first",
    delta: "Starting inspection"
  });
  state = notify(state, "item/started", {
    threadId: "thread-main",
    turnId: "turn-events",
    item: { id: "event-command", type: "commandExecution", command: "rg ordering", status: "inProgress" }
  });
  state = notify(state, "turn/plan/updated", {
    threadId: "thread-main",
    turnId: "turn-events",
    plan: [{ step: "Keep event order", status: "inProgress" }]
  });
  state = notify(state, "item/agentMessage/delta", {
    threadId: "thread-main",
    turnId: "turn-events",
    itemId: "event-assistant-later",
    delta: "Inspection finished"
  });

  expect(state.turns[0]?.items.map((entry) => entry.id)).toEqual([
    "event-user",
    "event-assistant-first",
    "event-command",
    "turn-plan-turn-events",
    "event-assistant-later"
  ]);
});

test("streaming plan draft is replaced by the consolidated plan update", () => {
  let state = notify(initialClientState, "turn/started", {
    threadId: "thread-main",
    turn: { id: "turn-plan-dedupe", threadId: "thread-main", status: "inProgress" }
  });
  state = notify(state, "item/plan/delta", {
    threadId: "thread-main",
    turnId: "turn-plan-dedupe",
    itemId: "plan-draft-1",
    delta: "step one"
  });
  expect(state.turns[0]?.items.map((entry) => entry.id)).toEqual(["plan-draft-1"]);
  state = notify(state, "turn/plan/updated", {
    threadId: "thread-main",
    turnId: "turn-plan-dedupe",
    plan: [{ step: "step one", status: "pending" }]
  });
  expect(state.turns[0]?.items.map((entry) => entry.id)).toEqual(["turn-plan-turn-plan-dedupe"]);
  expect(state.turns[0]?.items[0]?.title).toBe("Updated Plan");
  // A late revision restarts the draft instead of stacking a second card.
  state = notify(state, "item/plan/delta", {
    threadId: "thread-main",
    turnId: "turn-plan-dedupe",
    itemId: "plan-draft-1",
    delta: "step two"
  });
  expect(state.turns[0]?.items.map((entry) => entry.id)).toEqual(["plan-draft-1"]);
});

test("context compaction notifications retain one item and expose lifecycle status", () => {
  const threadId = "thread-compaction";
  const turnId = "turn-compaction";
  let state = notify(initialClientState, "turn/started", {
    threadId,
    turn: { id: turnId, threadId, status: "inProgress" }
  });
  state = notify(state, "item/started", {
    threadId,
    turnId,
    item: { id: "compact-1", type: "contextCompaction" }
  });

  expect(state.turns[0]?.items).toEqual([expect.objectContaining({
    id: "compact-1",
    type: "contextCompaction",
    title: "Context compaction",
    status: "inProgress"
  })]);

  state = notify(state, "item/completed", {
    threadId,
    turnId,
    item: { id: "compact-1", type: "contextCompaction" }
  });
  expect(state.turns[0]?.items).toHaveLength(1);
  expect(state.turns[0]?.items[0]).toEqual(expect.objectContaining({
    id: "compact-1",
    type: "contextCompaction",
    status: "completed"
  }));
});

test("context compaction completion replaces an active item even when Codex changes its id", () => {
  const threadId = "thread-compaction-rekey";
  const turnId = "turn-compaction-rekey";
  let state = notify(initialClientState, "turn/started", { threadId, turn: { id: turnId, threadId } });
  state = notify(state, "item/started", { threadId, turnId, item: { id: "compact-running", type: "contextCompaction" } });
  state = notify(state, "item/completed", { threadId, turnId, item: { id: "compact-complete", type: "contextCompaction" } });

  expect(state.turns[0]?.items).toHaveLength(1);
  expect(state.turns[0]?.items[0]).toEqual(expect.objectContaining({ id: "compact-running", status: "completed" }));
});

test("context compaction completion closes an active item from an earlier turn in the same thread", () => {
  const threadId = "thread-compaction-cross-turn";
  let state = notify(initialClientState, "turn/started", { threadId, turn: { id: "turn-before-compact", threadId } });
  state = notify(state, "item/started", { threadId, turnId: "turn-before-compact", item: { id: "compact-running", type: "contextCompaction" } });
  state = notify(state, "turn/started", { threadId, turn: { id: "turn-after-compact", threadId } });
  state = notify(state, "item/completed", { threadId, turnId: "turn-after-compact", item: { id: "compact-complete", type: "contextCompaction" } });

  expect(state.turns.find((turn) => turn.id === "turn-before-compact")?.items).toEqual([
    expect.objectContaining({ id: "compact-running", status: "completed" })
  ]);
  expect(state.turns.find((turn) => turn.id === "turn-after-compact")?.items).toHaveLength(0);
});

test("turn completion stops an orphaned context compaction animation", () => {
  const threadId = "thread-compaction-turn-complete";
  const turnId = "turn-compaction-turn-complete";
  let state = notify(initialClientState, "turn/started", { threadId, turn: { id: turnId, threadId } });
  state = notify(state, "item/started", { threadId, turnId, item: { id: "compact-running", type: "contextCompaction" } });
  state = notify(state, "turn/completed", { threadId, turn: { id: turnId, threadId, status: "completed" } });

  expect(state.turns[0]?.items[0]).toEqual(expect.objectContaining({ id: "compact-running", status: "completed" }));
});

test("plan update received before turn started survives the late start event", () => {
  let state = notify(initialClientState, "turn/plan/updated", {
    threadId: "thread-main",
    turnId: "turn-plan-first",
    plan: [{ step: "Plan arrived first", status: "inProgress" }]
  });
  state = notify(state, "turn/started", {
    threadId: "thread-main",
    turn: { id: "turn-plan-first", threadId: "thread-main", status: "inProgress", startedAt: 1_721_000_000 }
  });

  expect(state.turns[0]?.items.map((entry) => entry.id)).toEqual(["turn-plan-turn-plan-first"]);
});

test("projects review mode details for expandable waterfall rows", () => {
  const loaded = threadReadToTurns({
    thread: {
      id: "thread-review-mode",
      turns: [{
        id: "turn-review-mode",
        status: "completed",
        items: [
          { id: "entered-review", type: "enteredReviewMode", review: "Review the authentication changes" },
          { id: "exited-review", type: "exitedReviewMode", review: "No blocking findings" }
        ]
      }]
    }
  });
  expect(loaded.turns[0]?.items).toMatchObject([
    { type: "enteredReviewMode", title: "Entered review mode", text: "Review the authentication changes" },
    { type: "exitedReviewMode", title: "Exited review mode", text: "No blocking findings" }
  ]);
});

test("inline review creates its turn when no turn/started arrives", () => {
  // Codex emits EnteredReviewMode / ExitedReviewMode items for inline /review
  // without a preceding `turn/started`. The reducer must auto-create the turn
  // so the review waterfall is visible without needing Stop/refresh.
  let state = { ...initialClientState, activeThreadId: "thread-main" };
  state = notify(state, "item/started", {
    threadId: "thread-main",
    turnId: "turn-review",
    item: { id: "entered-review", type: "enteredReviewMode", review: "Review uncommitted changes" }
  });

  const reviewTurn = state.turns.find((turn) => turn.id === "turn-review");
  expect(reviewTurn).toBeTruthy();
  expect(reviewTurn?.threadId).toBe("thread-main");
  expect(reviewTurn?.status).toBe("inProgress");
  expect(reviewTurn?.items.map((entry) => entry.id)).toEqual(["entered-review"]);
  expect(reviewTurn?.items[0]).toMatchObject({
    type: "enteredReviewMode",
    title: "Entered review mode",
    text: "Review uncommitted changes"
  });

  state = notify(state, "item/completed", {
    threadId: "thread-main",
    turnId: "turn-review",
    item: { id: "exited-review", type: "exitedReviewMode", review: "No blocking findings", status: "completed" }
  });

  const completed = state.turns.find((turn) => turn.id === "turn-review");
  expect(completed?.items.map((entry) => entry.id)).toEqual(["entered-review", "exited-review"]);
  expect(completed?.items[1]).toMatchObject({
    type: "exitedReviewMode",
    title: "Exited review mode",
    text: "No blocking findings"
  });

  // turn/completed closes the auto-created review turn cleanly.
  state = notify(state, "turn/completed", {
    threadId: "thread-main",
    turn: { id: "turn-review", threadId: "thread-main", status: "completed" }
  });
  expect(state.turns.find((turn) => turn.id === "turn-review")?.status).toBe("completed");
});

test("review item/agentMessage/delta lands on an auto-created review turn", () => {
  // A sub-agent stream under an inline review also arrives without turn/started;
  // updateTurnItem must auto-create the turn so streamed text is not dropped.
  let state = { ...initialClientState, activeThreadId: "thread-main" };
  state = notify(state, "item/agentMessage/delta", {
    threadId: "thread-main",
    turnId: "turn-sub-review",
    itemId: "sub-msg",
    delta: "Looking at ",
    firstTokenAt: 1000
  });

  const created = state.turns.find((turn) => turn.id === "turn-sub-review");
  expect(created).toBeTruthy();
  expect(created?.status).toBe("inProgress");
  expect(created?.items.map((entry) => entry.id)).toEqual(["sub-msg"]);
  expect(created?.items[0]).toMatchObject({ type: "agentMessage", text: "Looking at ", firstTokenAt: 1000 });
});

test("batch streaming auto-creates a review turn when only deltas arrive", () => {
  // Real review sub-agent streams arrive in one applyNotificationsPreservingActiveThread
  // batch without a preceding turn/started. The coalesced fast-path must seed the
  // missing turn rather than dropping every event via `turnIndex === undefined`.
  const state = { ...initialClientState, activeThreadId: "thread-main" };
  const next = applyNotificationsPreservingActiveThread(state, [{
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-main",
      turnId: "turn-review-batch",
      itemId: "review-answer",
      delta: "正在检查",
      firstTokenAt: 5000
    }
  }]);

  const reviewTurn = next.turns.find((turn) => turn.id === "turn-review-batch");
  expect(reviewTurn).toBeTruthy();
  expect(reviewTurn?.threadId).toBe("thread-main");
  expect(reviewTurn?.status).toBe("inProgress");
  expect(reviewTurn?.items.find((item) => item.id === "review-answer")).toMatchObject({
    type: "agentMessage",
    text: "正在检查",
    firstTokenAt: 5000
  });
});

test("batch of review item/completed events seeds the turn before the indexed update", () => {
  // An inline review emits enteredReviewMode item/completed for an unknown
  // turnId and no turn/started. The batch path shares the same single-reducer
  // upsert, but assert through the batch entry point to prove the seeded turn
  // survives into the final turns array.
  const state = { ...initialClientState, activeThreadId: "thread-main" };
  const next = applyNotificationsPreservingActiveThread(state, [{
    method: "item/completed",
    params: {
      threadId: "thread-main",
      turnId: "turn-review-items",
      item: { id: "entered-mode", type: "enteredReviewMode", review: "Review the diff", status: "completed" }
    }
  }]);

  const reviewTurn = next.turns.find((turn) => turn.id === "turn-review-items");
  expect(reviewTurn).toBeTruthy();
  expect(reviewTurn?.threadId).toBe("thread-main");
  expect(reviewTurn?.items.map((item) => item.id)).toEqual(["entered-mode"]);
  expect(reviewTurn?.items[0]).toMatchObject({
    type: "enteredReviewMode",
    text: "Review the diff"
  });
});

test("reviewStartTurnToWorkbenchTurn uses reviewThreadId when the response omits it", () => {
  // review/start returns { reviewThreadId, turn: {...} } but the turn payload
  // may omit threadId. The helper must always stamp reviewThreadId so the seeded
  // turn belongs to the right thread.
  const parsed = reviewStartTurnToWorkbenchTurn("thread-review-xyz", {
    id: "turn-from-review-start",
    status: "inProgress",
    startedAt: 123
  });

  expect(parsed).toEqual(expect.objectContaining({
    id: "turn-from-review-start",
    threadId: "thread-review-xyz",
    status: "inProgress",
    startedAt: 123
  }));
});

test("reviewStartTurnToWorkbenchTurn keeps an explicit turn.threadId over the reviewThreadId", () => {
  // When review/start provides a threadId on the turn payload the helper must
  // respect it rather than clobbering it with reviewThreadId.
  const parsed = reviewStartTurnToWorkbenchTurn("thread-fallback", {
    id: "turn-with-thread",
    threadId: "thread-explicit",
    status: "inProgress"
  });

  expect(parsed?.threadId).toBe("thread-explicit");
  expect(parsed?.id).toBe("turn-with-thread");
});

test("reviewStartTurnToWorkbenchTurn returns null for a response without a turn id", () => {
  // Guard: when review/start returns a turn-less or id-less payload the helper
  // returns null so the caller`s `if (reviewTurn)` guard skips seeding.
  expect(reviewStartTurnToWorkbenchTurn("thread-review-xyz", null)).toBeNull();
  expect(reviewStartTurnToWorkbenchTurn("thread-review-xyz", { status: "inProgress" })).toBeNull();
  expect(reviewStartTurnToWorkbenchTurn("thread-review-xyz", {})).toBeNull();
});
test("batch seeding an unknown background delta preserves the selected thread", () => {
  // Real-world hazard: the user is viewing thread-A while a background child
  // agent on thread-B emits its first agentMessage/delta with no preceding
  // turn/started. applyNotificationsPreservingActiveThread must seed the
  // thread-B turn WITHOUT switching activeThreadId away from thread-A. The
  // function contract is *PreservingActiveThread; the former seed assigned
  // activeThreadId: seedThreadId and leaked through the batch path.
  const state = { ...initialClientState, activeThreadId: "thread-selected" };

  const next = applyNotificationsPreservingActiveThread(state, [{
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-background",
      turnId: "turn-background-agent",
      itemId: "background-msg",
      delta: "Working in the background",
      firstTokenAt: 1234
    }
  }]);

  // The unknown background turn is created...
  const backgroundTurn = next.turns.find((turn) => turn.id === "turn-background-agent");
  expect(backgroundTurn).toBeTruthy();
  expect(backgroundTurn?.threadId).toBe("thread-background");
  expect(backgroundTurn?.items.find((item) => item.id === "background-msg")?.text).toBe("Working in the background");
  // ...while the selected thread stays selected.
  expect(next.activeThreadId).toBe("thread-selected");
});

test("single-reducer seeding an unknown background delta preserves the selected thread", () => {
  // Same invariant through the single-notification entry point: an unknown
  // background turnId must be created without stealing the active thread.
  let state = { ...initialClientState, activeThreadId: "thread-selected" };
  state = applyNotificationPreservingActiveThread(state, {
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-background",
      turnId: "turn-bg-single",
      itemId: "bg-msg",
      delta: "Streaming in the background",
      firstTokenAt: 4321
    }
  });

  expect(state.turns.some((turn) => turn.id === "turn-bg-single")).toBe(true);
  expect(state.turns.find((turn) => turn.id === "turn-bg-single")?.threadId).toBe("thread-background");
  expect(state.activeThreadId).toBe("thread-selected");
});

test("item/started for an unknown background turn preserves the selected thread", () => {
  // enteredReviewMode for an unknown background turnId must seed the turn
  // without switching the active thread.
  let state = { ...initialClientState, activeThreadId: "thread-selected" };
  state = applyNotificationPreservingActiveThread(state, {
    method: "item/completed",
    params: {
      threadId: "thread-background",
      turnId: "turn-bg-items",
      item: { id: "entered-bg", type: "enteredReviewMode", review: "Review bg", status: "completed" }
    }
  });
  expect(state.turns.some((turn) => turn.id === "turn-bg-items")).toBe(true);
  expect(state.turns.find((turn) => turn.id === "turn-bg-items")?.threadId).toBe("thread-background");
  expect(state.activeThreadId).toBe("thread-selected");
});

