import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "bun:test";
import { applyNotification, initialClientState } from "../../apps/web/src/state/codexClient";
import { TopicTranscriptStore } from "../../apps/web/src/app/transcripts/topicTranscriptStore";
import { buildChatRows } from "../../apps/web/src/waterfall/chatRows";
import { ChatRow } from "../../apps/web/src/waterfall/ChatRow";
import { setPerformancePressureSource } from "../../apps/web/src/performance/animationBudget";

test("applyNotification reuses and updates the single retry error item in-place with a stable ID", () => {
  let state = {
    ...initialClientState,
    activeThreadId: "thread-1",
    turns: [
      {
        id: "turn-1",
        threadId: "thread-1",
        status: "inProgress",
        items: []
      }
    ]
  };

  // 1st retry error notification
  state = applyNotification(state, {
    method: "error",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      willRetry: true,
      error: { message: "Selected model is at capacity", additionalDetails: "503 Service Unavailable" }
    }
  });

  const turnAfterFirst = state.turns.find((t) => t.id === "turn-1");
  expect(turnAfterFirst).toBeDefined();
  expect(turnAfterFirst?.items).toHaveLength(1);
  const firstItem = turnAfterFirst!.items[0]!;
  expect(firstItem.id).toBe("retry-error-turn-1");
  expect(firstItem.type).toBe("retryError");
  expect(firstItem.status).toBe("running");
  expect(firstItem.text).toBe("Selected model is at capacity");

  // 2nd retry error notification on the same turn
  state = applyNotification(state, {
    method: "error",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      willRetry: true,
      error: { message: "Rate-limiting requests, retrying 2/5", additionalDetails: "429 Too Many Requests" }
    }
  });

  const turnAfterSecond = state.turns.find((t) => t.id === "turn-1");
  expect(turnAfterSecond?.items).toHaveLength(1);
  const secondItem = turnAfterSecond!.items[0]!;
  expect(secondItem.id).toBe("retry-error-turn-1");
  expect(secondItem.text).toBe("Rate-limiting requests, retrying 2/5");
  expect(secondItem.startedAt).toBe(firstItem.startedAt);

  // 3rd notification - retry stopped/failed
  state = applyNotification(state, {
    method: "error",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      willRetry: false,
      error: { message: "Selected model is at capacity" }
    }
  });

  const turnAfterThird = state.turns.find((t) => t.id === "turn-1");
  expect(turnAfterThird?.items).toHaveLength(1);
  const thirdItem = turnAfterThird!.items[0]!;
  expect(thirdItem.id).toBe("retry-error-turn-1");
  expect(thirdItem.status).toBe("failed");
  expect(thirdItem.title).toBe("Retry stopped");
});

test("TopicTranscriptStore.appendRetryErrorItem reuses and updates in-place with stable ID", () => {
  const store = new TopicTranscriptStore();
  store.replaceThreadTurns("thread-app", [
    {
      id: "turn-app-1",
      threadId: "thread-app",
      status: "inProgress",
      items: []
    }
  ]);

  // Append attempt 1
  store.appendRetryErrorItem("thread-app", "turn-app-1", {
    title: "Retrying stop request",
    text: "Stop turn: connection timed out",
    status: "running",
    retrySource: "app",
    attempt: 1,
    max: 3,
    delayMs: 500,
    exhausted: false
  });

  let turns = store.getThreadTurns("thread-app");
  expect(turns[0]?.items).toHaveLength(1);
  const item1 = turns[0]!.items[0]!;
  expect(item1.id).toBe("retry-error-turn-app-1-app");
  expect(item1.status).toBe("running");

  // Append attempt 2 (should update in-place, NOT append new item or use Date.now() ID)
  store.appendRetryErrorItem("thread-app", "turn-app-1", {
    title: "Retrying stop request",
    text: "Stop turn: connection reset",
    status: "running",
    retrySource: "app",
    attempt: 2,
    max: 3,
    delayMs: 1000,
    exhausted: false
  });

  turns = store.getThreadTurns("thread-app");
  expect(turns[0]?.items).toHaveLength(1);
  const item2 = turns[0]!.items[0]!;
  expect(item2.id).toBe("retry-error-turn-app-1-app");
  expect(item2.text).toBe("Stop turn: connection reset");
  expect(item2.startedAt).toBe(item1.startedAt);

  // Append attempt 3 (exhausted)
  store.appendRetryErrorItem("thread-app", "turn-app-1", {
    title: "Stop request failed",
    text: "Stop turn: connection lost",
    status: "failed",
    retrySource: "app",
    attempt: 3,
    max: 3,
    exhausted: true
  });

  turns = store.getThreadTurns("thread-app");
  expect(turns[0]?.items).toHaveLength(1);
  const item3 = turns[0]!.items[0]!;
  expect(item3.id).toBe("retry-error-turn-app-1-app");
  expect(item3.status).toBe("failed");
  expect(item3.title).toBe("Stop request failed");
});

test("ChatRow suppresses retry-error-breathe animation when performance pressured", () => {
  const turns = [{
    id: "turn-pressure",
    threadId: "thread-pressure",
    status: "inProgress",
    items: [
      {
        id: "retry-error-pressured",
        type: "retryError",
        title: "Retrying",
        text: "Temporary rate limit",
        status: "running",
        payload: {
          retryError: true,
          retrySource: "codex",
          retrying: true
        }
      }
    ]
  }];

  const rows = buildChatRows(turns);
  const retryGroup = rows[0];
  expect(retryGroup).toBeDefined();

  try {
    // Normal conditions: animation should be enabled
    setPerformancePressureSource("fps", false);
    const normalHtml = renderToStaticMarkup(createElement(ChatRow, {
      row: retryGroup!,
      t: (key: string) => key,
      expanded: false
    }));
    expect(normalHtml).toContain("retry-error-breathe");
    // Inline @keyframes should NOT be in the HTML (moved to global stylesheet)
    expect(normalHtml).not.toContain("@keyframes retry-error-breathe");

    // Under performance pressure: animation must be suppressed
    setPerformancePressureSource("fps", true);
    const pressuredHtml = renderToStaticMarkup(createElement(ChatRow, {
      row: retryGroup!,
      t: (key: string) => key,
      expanded: false
    }));
    expect(pressuredHtml).not.toContain("retry-error-breathe");
  } finally {
    setPerformancePressureSource("fps", false);
  }
});

test("ChatRow row keys remain strictly identical across multiple retry attempts", () => {
  let state = {
    ...initialClientState,
    activeThreadId: "thread-retry-key",
    turns: [
      {
        id: "turn-retry-key-1",
        threadId: "thread-retry-key",
        status: "inProgress",
        items: []
      }
    ]
  };

  const keys: string[] = [];

  for (let attempt = 1; attempt <= 5; attempt++) {
    state = applyNotification(state, {
      method: "error",
      params: {
        threadId: "thread-retry-key",
        turnId: "turn-retry-key-1",
        willRetry: attempt < 5,
        error: { message: `Rate limit hit attempt ${attempt}/5` }
      }
    });

    const rows = buildChatRows(state.turns);
    const retryGroup = rows.find((r) => r.kind === "retryErrorGroup");
    expect(retryGroup).toBeDefined();
    keys.push(retryGroup!.key);
  }

  expect(keys).toHaveLength(5);
  // All 5 retry attempts MUST have the exact same row key to prevent unmount/remount
  for (let i = 1; i < keys.length; i++) {
    expect(keys[i]).toBe(keys[0]);
  }
});

test("applyNotification 5 continuous ticks preserve turn.items.length === 1 and initial startedAt", () => {
  let state = {
    ...initialClientState,
    activeThreadId: "thread-5-ticks",
    turns: [
      {
        id: "turn-5-ticks-1",
        threadId: "thread-5-ticks",
        status: "inProgress",
        items: []
      }
    ]
  };

  let initialStartedAt: number | undefined;

  for (let i = 1; i <= 5; i++) {
    state = applyNotification(state, {
      method: "error",
      params: {
        threadId: "thread-5-ticks",
        turnId: "turn-5-ticks-1",
        willRetry: true,
        error: { message: `Temporary upstream outage tick ${i}` }
      }
    });

    const turn = state.turns.find((t) => t.id === "turn-5-ticks-1");
    expect(turn).toBeDefined();
    expect(turn!.items).toHaveLength(1);
    const item = turn!.items[0]!;
    expect(item.id).toBe("retry-error-turn-5-ticks-1");
    expect(item.type).toBe("retryError");
    expect(item.status).toBe("running");

    if (i === 1) {
      initialStartedAt = item.startedAt;
      expect(initialStartedAt).toBeDefined();
    } else {
      expect(item.startedAt).toBe(initialStartedAt);
    }
  }
});

test("applyNotification consolidates legacy dynamic-ID retry items into a single stable item", () => {
  const initialStartedAt = 1700000000;
  let state = {
    ...initialClientState,
    activeThreadId: "thread-legacy",
    turns: [
      {
        id: "turn-legacy-1",
        threadId: "thread-legacy",
        status: "inProgress",
        items: [
          {
            id: "user-msg-1",
            type: "userMessage",
            status: "completed",
            text: "Hello"
          },
          // 2 legacy dynamic retry items
          {
            id: "retry-error-turn-legacy-1-12345",
            type: "retryError",
            status: "running",
            title: "Retrying",
            text: "Initial capacity error",
            startedAt: initialStartedAt,
            payload: { retryError: true, retrySource: "codex" }
          },
          {
            id: "retry-error-turn-legacy-1-67890",
            type: "retryError",
            status: "running",
            title: "Retrying",
            text: "Second capacity error",
            startedAt: initialStartedAt + 2,
            payload: { retryError: true, retrySource: "codex" }
          }
        ]
      }
    ]
  };

  expect(state.turns[0]!.items).toHaveLength(3);

  // New notification should consolidate the 2 legacy retry items into 1 stable item
  state = applyNotification(state, {
    method: "error",
    params: {
      threadId: "thread-legacy",
      turnId: "turn-legacy-1",
      willRetry: true,
      error: { message: "Model overloaded, retrying 3/5" }
    }
  });

  const turn = state.turns.find((t) => t.id === "turn-legacy-1")!;
  // userMessage + 1 consolidated retryError item = 2 items total
  expect(turn.items).toHaveLength(2);
  expect(turn.items[0]!.id).toBe("user-msg-1");
  const retryItem = turn.items[1]!;
  expect(retryItem.id).toBe("retry-error-turn-legacy-1");
  expect(retryItem.text).toBe("Model overloaded, retrying 3/5");
  expect(retryItem.startedAt).toBe(initialStartedAt);
});

test("Codex CLI channel and App channel retry items coexist independently without colliding", () => {
  const store = new TopicTranscriptStore();
  store.replaceThreadTurns("thread-dual", [
    {
      id: "turn-dual-1",
      threadId: "thread-dual",
      status: "inProgress",
      items: [
        {
          id: "retry-error-turn-dual-1",
          type: "retryError",
          title: "Codex retrying",
          text: "Model capacity 503",
          status: "running",
          payload: { retryError: true, retrySource: "codex" }
        }
      ]
    }
  ]);

  // App channel appends its own retry item
  store.appendRetryErrorItem("thread-dual", "turn-dual-1", {
    title: "App fallback retrying",
    text: "Waiting for capacity failover",
    status: "running",
    retrySource: "app",
    attempt: 1,
    max: 3
  });

  let turns = store.getThreadTurns("thread-dual");
  expect(turns[0]!.items).toHaveLength(2);
  expect(turns[0]!.items[0]!.id).toBe("retry-error-turn-dual-1");
  expect(turns[0]!.items[1]!.id).toBe("retry-error-turn-dual-1-app");

  // Updating the app item must NOT touch or overwrite the codex item
  store.updateRetryErrorItem("thread-dual", "turn-dual-1", {
    status: "failed",
    retrySource: "app",
    attempt: 3,
    max: 3,
    exhausted: true
  });

  turns = store.getThreadTurns("thread-dual");
  expect(turns[0]!.items).toHaveLength(2);
  const codexItem = turns[0]!.items[0]!;
  const appItem = turns[0]!.items[1]!;

  expect(codexItem.status).toBe("running"); // untouched
  expect(codexItem.id).toBe("retry-error-turn-dual-1");

  expect(appItem.status).toBe("failed"); // updated
  expect(appItem.id).toBe("retry-error-turn-dual-1-app");
});

