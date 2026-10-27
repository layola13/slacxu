import { expect, test } from "bun:test";
import { TopicTranscriptStore } from "../../apps/web/src/app/transcripts/topicTranscriptStore.ts";
import { buildChatRows } from "../../apps/web/src/waterfall/chatRows.ts";
import type { ThreadEntry, WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";

const thread = (id: string, parentThreadId?: string): ThreadEntry => ({ id, parentThreadId, title: id });
const turn = (id: string, threadId: string): WorkbenchTurn => ({ id, threadId, status: "inProgress", items: [] });

test("parent transcript listeners are isolated from child bodies while the selected child updates", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main-a"), thread("agent-a", "main-a"), thread("main-b")]);
  store.mergeTurns([turn("turn-agent-a", "agent-a"), turn("turn-b", "main-b")]);
  let aUpdates = 0;
  let agentUpdates = 0;
  let bUpdates = 0;
  store.subscribe("main-a", () => aUpdates++);
  store.subscribe("agent-a", () => agentUpdates++);
  store.subscribe("main-b", () => bUpdates++);

  store.applyNotifications([{
    method: "item/agentMessage/delta",
    params: { threadId: "agent-a", turnId: "turn-agent-a", itemId: "message-a", delta: "hello" }
  }]);

  expect(aUpdates).toBe(0);
  expect(agentUpdates).toBe(1);
  expect(bUpdates).toBe(0);
  expect(store.getProjection("main-a").turnsByThreadId.get("agent-a")?.[0]?.items).toEqual([]);
  expect(store.getProjection("agent-a").turns[0]?.items[0]?.text).toBe("hello");
});

test("child thread registration routes the first delta into a bounded parent overview", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main")]);
  store.applyNotifications([{
    method: "thread/started",
    params: { thread: { id: "agent", parentThreadId: "main", name: "worker" } }
  }, {
    method: "turn/started",
    params: { threadId: "agent", turn: { id: "agent-turn" } }
  }, {
    method: "item/agentMessage/delta",
    params: { threadId: "agent", turnId: "agent-turn", itemId: "answer", delta: "first token" }
  }]);

  const projection = store.getProjection("main");
  expect(projection.threads.map((entry) => entry.id)).toContain("agent");
  expect(projection.turnsByThreadId.get("agent")?.[0]?.items).toEqual([]);
  expect(store.getThreadTurns("agent")).toHaveLength(0);
  expect(store.getAgentOverview("main").get("agent")).toMatchObject({
    turnId: "agent-turn",
    itemId: "answer",
    text: "first token"
  });
});

test("completed child items keep the agent overview working until the turn ends", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  store.applyNotifications([{
    method: "turn/started",
    params: { threadId: "agent", turn: { id: "agent-turn", status: "inProgress" } }
  }, {
    method: "item/completed",
    params: {
      threadId: "agent",
      turnId: "agent-turn",
      item: { id: "answer", type: "agentMessage", text: "Intermediate answer", status: "completed" }
    }
  }]);

  expect(store.getAgentOverview("main").get("agent")).toMatchObject({ status: "inProgress", text: "Intermediate answer" });
  expect(store.getProjection("main").turnsByThreadId.get("agent")?.[0]?.status).toBe("inProgress");

  store.applyNotifications([{
    method: "turn/completed",
    params: { threadId: "agent", turnId: "agent-turn", turn: { id: "agent-turn", status: "completed" } }
  }]);
  expect(store.getAgentOverview("main").get("agent")?.status).toBe("completed");
});

test("fifteen interleaved child registrations remain visible in the parent projection", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main")]);
  store.applyNotifications([{
    method: "turn/started",
    params: { threadId: "main", turn: { id: "main-turn", threadId: "main", status: "inProgress" } }
  }, {
    method: "item/started",
    params: {
      threadId: "main",
      turnId: "main-turn",
      item: {
        id: "spawn",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        status: "inProgress",
        receiverThreadIds: Array.from({ length: 15 }, (_, index) => `agent-${index + 1}`),
        agentsStates: Object.fromEntries(Array.from({ length: 15 }, (_, index) => [
          `agent-${index + 1}`,
          { status: "running" }
        ]))
      }
    }
  }]);
  let wakes = 0;
  store.subscribe("main", () => wakes++);

  for (let index = 1; index <= 15; index += 1) {
    store.registerNotificationRouting({
      method: "thread/started",
      params: { thread: { id: `agent-${index}`, parentThreadId: "main", status: "running" } }
    });
    store.applyNotifications([{
      method: "turn/started",
      params: { threadId: `agent-${index}`, turn: { id: `agent-turn-${index}`, threadId: `agent-${index}`, status: "inProgress" } }
    }, {
      method: "item/agentMessage/delta",
      params: { threadId: `agent-${index}`, turnId: `agent-turn-${index}`, itemId: `answer-${index}`, delta: `agent ${index}` }
    }]);
  }

  const projection = store.getProjection("main");
  expect(projection.threads.filter((entry) => entry.parentThreadId === "main")).toHaveLength(15);
  expect([...projection.turnsByThreadId.keys()].filter((id) => id.startsWith("agent-"))).toHaveLength(15);
  expect(wakes).toBeGreaterThanOrEqual(15);
});

test("equivalent catalog mirrors preserve canonical threads without waking React subscribers", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([
    { ...thread("main"), status: "running" },
    { ...thread("agent", "main"), status: "running", agentNickname: "Sort" }
  ]);
  const initialProjection = store.getProjection("main");
  let wakes = 0;
  store.subscribe("main", () => wakes++);

  store.replaceCatalog([
    { ...thread("main"), status: "running" },
    { ...thread("agent", "main"), status: "running", agentNickname: "Sort" }
  ]);

  expect(wakes).toBe(0);
  expect(store.getProjection("main")).toBe(initialProjection);
});

test("partial child metadata preserves ownership and bounded background storage", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([
    thread("main"),
    { ...thread("agent", "main"), agentNickname: "Sort", agentRole: "worker" }
  ]);

  store.mergeSnapshot({ id: "agent", title: "partial read" }, [turn("agent-turn", "agent")]);

  expect(store.getProjection("main").threads.find((entry) => entry.id === "agent")).toMatchObject({
    parentThreadId: "main",
    agentNickname: "Sort",
    agentRole: "worker",
    title: "partial read"
  });
  expect(store.hasThreadTranscript("agent")).toBe(false);
  expect(store.diagnostics()).toMatchObject({
    topicBucketCount: 0,
    summaryBucketCount: 1,
    loadedSnapshotThreadCount: 0,
    reducedThreadCount: 0
  });
});

test("partial snapshots cannot promote fifteen background children to root topics", () => {
  const store = new TopicTranscriptStore();
  const agents = Array.from({ length: 15 }, (_, index) => thread(`agent-${index + 1}`, "main"));
  store.replaceCatalog([thread("main"), ...agents]);
  store.mergeSnapshot(thread("main"), [turn("main-turn", "main")]);

  for (const agent of agents) {
    store.mergeSnapshot({ id: agent.id }, [turn(`${agent.id}-turn`, agent.id)]);
  }

  expect(store.getProjection("main").threads.filter((entry) => entry.parentThreadId === "main")).toHaveLength(15);
  expect(store.diagnostics()).toMatchObject({
    topicBucketCount: 1,
    summaryBucketCount: 16,
    loadedSnapshotThreadCount: 1,
    reducedThreadCount: 0
  });
});

test("real child catalog changes wake the parent exactly once", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([
    thread("main"),
    { ...thread("agent", "main"), status: "running", agentNickname: "Sort" }
  ]);
  let wakes = 0;
  store.subscribe("main", () => wakes++);

  store.replaceCatalog([
    { ...thread("main") },
    { ...thread("agent", "main"), status: "completed", agentNickname: "Sort" }
  ]);

  expect(wakes).toBe(1);
  expect(store.getProjection("main").threads.find((entry) => entry.id === "agent")?.status).toBe("completed");
});

test("completed items preserve preceding delta text in one topic batch", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main")]);
  store.mergeTurns([turn("turn-main", "main")]);
  store.applyNotifications([{
    method: "item/agentMessage/delta",
    params: { threadId: "main", turnId: "turn-main", itemId: "answer", delta: "partial" }
  }, {
    method: "item/completed",
    params: { threadId: "main", turnId: "turn-main", item: { id: "answer", type: "agentMessage", text: "complete" } }
  }]);

  expect(store.getThreadTurns("main")[0]?.items[0]?.text).toBe("complete");
});

test("one agent burst among one hundred topics wakes only a subscribed child", () => {
  const store = new TopicTranscriptStore();
  const topics = Array.from({ length: 100 }, (_, index) => thread(`main-${index}`));
  const agents = Array.from({ length: 100 }, (_, index) => thread(`agent-${index}`, `main-${index}`));
  store.replaceCatalog([...topics, ...agents]);
  store.mergeTurns(agents.map((entry, index) => turn(`turn-${index}`, entry.id)));
  const updates = new Array(100).fill(0);
  topics.forEach((entry, index) => store.subscribe(entry.id, () => updates[index]++));
  let selectedChildUpdates = 0;
  store.subscribe("agent-42", () => selectedChildUpdates++);

  store.applyNotifications(Array.from({ length: 500 }, (_, index) => ({
    method: "item/agentMessage/delta",
    params: { threadId: "agent-42", turnId: "turn-42", itemId: "answer", delta: String(index % 10) }
  })));

  expect(updates.reduce((total, value) => total + value, 0)).toBe(0);
  expect(selectedChildUpdates).toBe(1);
  expect(store.getProjection("main-42").turnsByThreadId.get("agent-42")?.[0]?.items).toEqual([]);
  expect(store.getProjection("agent-42").turns[0]?.items[0]?.text.length).toBe(500);
});

test("all-agent overview exposes bounded latest text without waking the parent transcript", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent-a", "main"), thread("agent-b", "main")]);
  store.mergeTurns([turn("turn-a", "agent-a"), turn("turn-b", "agent-b")]);
  let parentUpdates = 0;
  let overviewUpdates = 0;
  store.subscribe("main", () => parentUpdates++);
  store.subscribeAgentOverview("main", () => overviewUpdates++);

  store.applyNotifications(Array.from({ length: 500 }, (_, index) => ({
    method: "item/agentMessage/delta",
    params: { threadId: "agent-a", turnId: "turn-a", itemId: "answer", delta: String(index % 10) }
  })));

  expect(parentUpdates).toBe(0);
  expect(overviewUpdates).toBe(1);
  expect(store.getAgentOverview("main").get("agent-a")?.text.length).toBeLessThanOrEqual(420);
  expect(store.getAgentOverview("main").get("agent-b")?.text).toBe("");
  expect(store.getProjection("main").turnsByThreadId.get("agent-a")?.[0]?.items).toEqual([]);
});

test("child lifecycle changes wake the parent without exposing child items", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  store.mergeTurns([turn("agent-turn", "agent")]);
  let parentUpdates = 0;
  store.subscribe("main", () => parentUpdates++);

  store.applyNotifications([{
    method: "turn/completed",
    params: { threadId: "agent", turnId: "agent-turn", turn: { id: "agent-turn", status: "completed" } }
  }]);

  expect(parentUpdates).toBe(1);
  expect(store.getProjection("main").turnsByThreadId.get("agent")?.[0]).toMatchObject({ status: "completed", items: [] });
});

test("background live agent streams do not masquerade as complete snapshots", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  store.applyNotifications([{
    method: "turn/started",
    params: { threadId: "agent", turn: { id: "agent-turn" } }
  }]);
  expect(store.hasThreadTranscript("agent")).toBe(false);
  expect(store.getThreadTurns("agent")).toHaveLength(0);
  expect(store.getProjection("main").turnsByThreadId.get("agent")?.[0]).toMatchObject({
    id: "agent-turn",
    items: []
  });
});

test("background retry and tool activity reopen a completed summary turn", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  store.applyNotifications([
    { method: "turn/started", params: { threadId: "agent", turn: { id: "agent-turn", status: "inProgress" } } },
    { method: "turn/completed", params: { threadId: "agent", turn: { id: "agent-turn", status: "completed" } } },
    { method: "item/started", params: { threadId: "agent", turnId: "agent-turn", item: { id: "tool", type: "commandExecution", status: "inProgress" } } }
  ]);
  expect(store.getProjection("main").turnsByThreadId.get("agent")?.[0]).toMatchObject({ status: "inProgress" });
});

test("background Mini item starts reopen a completed summary turn", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  store.applyNotifications([
    { method: "turn/started", params: { threadId: "agent", turn: { id: "agent-turn", status: "inProgress" } } },
    { method: "turn/completed", params: { threadId: "agent", turn: { id: "agent-turn", status: "completed" } } },
    { method: "item/started", params: { thread_id: "agent", turn_id: "agent-turn", item: { id: "answer", type: "agentMessage", status: "inProgress" } } }
  ]);
  expect(store.getProjection("main").turnsByThreadId.get("agent")?.[0]).toMatchObject({ status: "inProgress" });
});

test("background Mini item starts resolve underscored turn ids", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  store.applyNotifications([{
    method: "item/started",
    params: { thread_id: "agent", turn_id: "", item: { id: "reason", turn_id: "agent-turn", type: "reasoning", status: "inProgress" } }
  }]);
  expect(store.getProjection("main").turnsByThreadId.get("agent")?.[0]).toMatchObject({
    id: "agent-turn",
    status: "inProgress",
    items: []
  });
});

test("Mini streaming notifications project once in causal waterfall order", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("mini-thread")]);
  store.applyNotifications([
    { method: "turn/started", params: { thread_id: "mini-thread", turn: { id: "mini-turn", status: "inProgress" } } },
    { method: "item/started", params: { thread_id: "mini-thread", turn_id: "mini-turn", item: { id: "reason", type: "reasoning", text: "", status: "inProgress" } } },
    { method: "item/reasoning/textDelta", params: { thread_id: "mini-thread", turn_id: "mini-turn", itemId: "reason", delta: "thinking" } },
    { method: "item/started", params: { thread_id: "mini-thread", turn_id: "mini-turn", item: { id: "answer", type: "agentMessage", text: "", status: "inProgress" } } },
    { method: "item/agentMessage/delta", params: { thread_id: "mini-thread", turn_id: "mini-turn", itemId: "answer", delta: "hello" } },
    { method: "item/completed", params: { thread_id: "mini-thread", turn_id: "mini-turn", item: { id: "answer", type: "agentMessage", text: "hello", status: "completed" } } },
    { method: "item/completed", params: { thread_id: "mini-thread", turn_id: "mini-turn", item: { id: "reason", type: "reasoning", text: "thinking", status: "completed" } } },
    { method: "turn/completed", params: { thread_id: "mini-thread", turn: { id: "mini-turn", status: "completed" } } }
  ]);
  const turns = store.getThreadTurns("mini-thread");
  const rows = buildChatRows(turns);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.items.map((item) => [item.id, item.text, item.status])).toEqual([
    ["reason", "thinking", "completed"],
    ["answer", "hello", "completed"]
  ]);
  expect(turns[0]?.status).toBe("completed");
  expect(rows.map((row) => row.itemIds)).toEqual([["answer"]]);
  expect(rows[0]?.text).toBe("hello");
  expect(rows[0]?.reasoning).toBe("thinking");
});

test("background activity does not reopen an interrupted summary turn", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  store.applyNotifications([
    { method: "turn/started", params: { threadId: "agent", turn: { id: "agent-turn", status: "inProgress" } } },
    { method: "turn/interrupted", params: { threadId: "agent", turn: { id: "agent-turn", status: "interrupted" } } },
    { method: "turn/started", params: { threadId: "agent", turn: { id: "agent-turn", status: "inProgress" } } },
    { method: "item/started", params: { threadId: "agent", turnId: "agent-turn", item: { id: "tool", type: "commandExecution", status: "inProgress" } } }
  ]);
  expect(store.getProjection("main").turnsByThreadId.get("agent")?.[0]).toMatchObject({ status: "interrupted" });
});

test("replacing a rollback snapshot removes turns absent from the original thread", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main")]);
  store.mergeSnapshot(thread("main"), [turn("turn-1", "main"), turn("turn-2", "main")]);

  store.replaceThreadTurns("main", [turn("turn-1", "main")]);

  expect(store.getThreadTurns("main").map((entry) => entry.id)).toEqual(["turn-1"]);
});

test("app interrupt retries append waterfall retry errors", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main")]);
  store.mergeTurns([turn("turn-main", "main")]);
  store.appendRetryErrorItem("main", "turn-main", {
    title: "Retrying stop request",
    text: "Stop turn timed out",
    status: "running",
    retrySource: "app",
    attempt: 1,
    max: 3,
    delayMs: 500
  });
  expect(store.getThreadTurns("main")[0]?.items[0]).toMatchObject({
    type: "retryError",
    status: "running",
    payload: { retryError: true, retrySource: "app", attempt: 1, max: 3, delayMs: 500 }
  });
});

test("one background agent burst bypasses full transcript reduction inside a hundred-agent topic", () => {
  const store = new TopicTranscriptStore();
  const agents = Array.from({ length: 100 }, (_, index) => thread(`agent-${index}`, "main"));
  store.replaceCatalog([thread("main"), ...agents]);
  store.mergeTurns(agents.map((entry, index) => turn(`turn-${index}`, entry.id)));
  const untouched = store.getThreadTurns("agent-99");

  store.applyNotifications(Array.from({ length: 500 }, (_, index) => ({
    method: "item/agentMessage/delta",
    params: { threadId: "agent-42", turnId: "turn-42", itemId: "answer", delta: String(index % 10) }
  })));

  expect(store.getThreadTurns("agent-99")).toBe(untouched);
  expect(store.getThreadTurns("agent-42")).toHaveLength(0);
  expect(store.getAgentOverview("main").get("agent-42")?.text.length).toBeLessThanOrEqual(420);
  expect(store.diagnostics()).toMatchObject({
    topicBucketCount: 0,
    summaryBucketCount: 100,
    reducedThreadCount: 0,
    reducedTurnCount: 0,
    agentOverviewTextChars: 420
  });
});

test("eviction releases transcript buckets and materialized projections", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  store.mergeTurns([turn("turn-main", "main"), turn("turn-agent", "agent")]);
  const unsubscribe = store.subscribe("main", () => undefined);
  store.getProjection("main");
  expect(store.diagnostics()).toMatchObject({ topicBucketCount: 1, summaryBucketCount: 2 });
  expect(store.diagnostics().materializedProjectionCount).toBe(1);

  store.evict(["main"]);
  expect(store.getThreadTurns("main")).toHaveLength(0);
  expect(store.getThreadTurns("agent")).toHaveLength(0);
  expect(store.diagnostics().topicBucketCount).toBe(0);
  expect(store.diagnostics().summaryBucketCount).toBe(0);
  unsubscribe();
});

test("unsubscribing releases a completed child projection immediately", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  store.mergeTurns([turn("agent-turn", "agent")]);
  const unsubscribe = store.subscribe("agent", () => undefined);
  store.mergeSnapshot(thread("agent", "main"), [turn("agent-turn", "agent")]);
  store.getProjection("agent");
  expect(store.diagnostics()).toMatchObject({ materializedProjectionCount: 1, topicBucketCount: 1 });
  unsubscribe();
  expect(store.diagnostics()).toMatchObject({ materializedProjectionCount: 0, topicBucketCount: 0 });
  expect(store.hasThreadTranscript("agent")).toBe(false);
});

test("unsubscribing a root topic keeps its full transcript body warm", () => {
  const store = new TopicTranscriptStore();
  const unsubscribe = store.subscribe("goal-main", () => undefined);
  store.mergeSnapshot(thread("goal-main"), Array.from({ length: 12 }, (_, index) => ({
    id: `goal-turn-${index}`,
    threadId: "goal-main",
    status: "completed",
    items: [{ id: `answer-${index}`, type: "agentMessage", title: "Codex", text: "x".repeat(10_000) }]
  })));

  expect(store.hasThreadTranscript("goal-main")).toBe(true);
  expect(store.getThreadTurns("goal-main")).toHaveLength(12);
  unsubscribe();

  expect(store.hasThreadTranscript("goal-main")).toBe(true);
  expect(store.getThreadTurns("goal-main")).toHaveLength(12);
  expect(store.diagnostics()).toMatchObject({ topicBucketCount: 1, summaryBucketCount: 1 });

  store.applyNotifications([{
    method: "turn/started",
    params: { threadId: "goal-main", turn: { id: "goal-background-turn", status: "inProgress" } }
  }, ...Array.from({ length: 500 }, (_, index) => ({
    method: "item/agentMessage/delta",
    params: { threadId: "goal-main", turnId: "goal-background-turn", itemId: "background-answer", delta: String(index % 10) }
  }))]);

  expect(store.getThreadTurns("goal-main")).toHaveLength(13);
  expect(store.diagnostics()).toMatchObject({
    topicBucketCount: 1,
    loadedSnapshotThreadCount: 1,
    materializedProjectionCount: 0
  });
  store.evict(["goal-main"]);
  expect(store.hasThreadTranscript("goal-main")).toBe(false);
});

test("resubscribing a root topic reuses its warm snapshot until explicit eviction", () => {
  const store = new TopicTranscriptStore();
  const unsubscribe = store.subscribe("goal-main", () => undefined);
  store.mergeSnapshot(thread("goal-main"), [turn("old-turn", "goal-main")]);
  unsubscribe();

  const unsubscribeAgain = store.subscribe("goal-main", () => undefined);
  store.mergeSnapshot(thread("goal-main"), [turn("old-turn", "goal-main")]);

  expect(store.hasThreadTranscript("goal-main")).toBe(true);
  expect(store.getThreadTurns("goal-main").map((entry) => entry.id)).toEqual(["old-turn"]);
  unsubscribeAgain();
  store.evict(["goal-main"]);

  const unsubscribeFresh = store.subscribe("goal-main", () => undefined);
  store.mergeSnapshot(thread("goal-main"), [turn("fresh-turn", "goal-main")]);
  expect(store.getThreadTurns("goal-main").map((entry) => entry.id)).toEqual(["fresh-turn"]);
  unsubscribeFresh();
});

test("repeated root subscribe switching does not duplicate warm turns or projections", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("a"), thread("b")]);
  store.mergeSnapshot(thread("a"), [turn("a-turn", "a")]);
  store.mergeSnapshot(thread("b"), [turn("b-turn", "b")]);

  for (let index = 0; index < 20; index += 1) {
    const unsubscribeA = store.subscribe("a", () => undefined);
    store.getProjection("a");
    unsubscribeA();
    const unsubscribeB = store.subscribe("b", () => undefined);
    store.getProjection("b");
    unsubscribeB();
  }

  expect(store.hasThreadTranscript("a")).toBe(true);
  expect(store.hasThreadTranscript("b")).toBe(true);
  expect(store.getThreadTurns("a").map((entry) => entry.id)).toEqual(["a-turn"]);
  expect(store.getThreadTurns("b").map((entry) => entry.id)).toEqual(["b-turn"]);
  expect(store.diagnostics()).toMatchObject({
    subscribedTopicCount: 0,
    materializedProjectionCount: 0,
    topicBucketCount: 2
  });
});

test("visiting fifteen child pages retains only the parent and selected projection", () => {
  const store = new TopicTranscriptStore();
  const agents = Array.from({ length: 15 }, (_, index) => thread(`agent-${index + 1}`, "main"));
  store.replaceCatalog([thread("main"), ...agents]);
  store.mergeTurns([
    turn("main-turn", "main"),
    ...agents.map((agent, index) => turn(`agent-turn-${index + 1}`, agent.id))
  ]);
  const unsubscribeParent = store.subscribe("main", () => undefined);
  store.getProjection("main");

  for (const agent of agents) {
    const unsubscribeChild = store.subscribe(agent.id, () => undefined);
    store.mergeSnapshot(agent, [turn(`loaded-${agent.id}`, agent.id)]);
    store.getProjection(agent.id);
    expect(store.diagnostics()).toMatchObject({
      subscribedTopicCount: 2,
      materializedProjectionCount: 2,
      topicBucketCount: 2
    });
    unsubscribeChild();
    expect(store.diagnostics()).toMatchObject({
      subscribedTopicCount: 1,
      materializedProjectionCount: 1,
      topicBucketCount: 1
    });
  }

  unsubscribeParent();
  expect(store.diagnostics()).toMatchObject({
    subscribedTopicCount: 0,
    materializedProjectionCount: 0
  });
});

test("empty snapshots are cached and eviction makes them loadable again", () => {
  const store = new TopicTranscriptStore();
  store.mergeSnapshot(thread("empty"), []);
  expect(store.hasThreadTranscript("empty")).toBe(true);
  expect(store.getThreadTurns("empty")).toHaveLength(0);
  store.evict(["empty"]);
  expect(store.hasThreadTranscript("empty")).toBe(false);
});

test("incomplete restores are never cached and stay retryable", () => {
  const store = new TopicTranscriptStore();
  store.mergeSnapshot(thread("partial"), [], { incomplete: true });
  expect(store.hasThreadTranscript("partial")).toBe(false);
  // A later complete restore caches normally.
  store.mergeSnapshot(thread("partial"), [turn("partial-turn", "partial")]);
  expect(store.hasThreadTranscript("partial")).toBe(true);
});

test("incomplete merge clears a previously cached marker instead of keeping it", () => {
  const store = new TopicTranscriptStore();
  store.mergeSnapshot(thread("main"), [turn("main-turn", "main")]);
  expect(store.hasThreadTranscript("main")).toBe(true);
  store.mergeSnapshot(thread("main"), [], { incomplete: true });
  expect(store.hasThreadTranscript("main")).toBe(false);
});

test("replacing a turn clears stale reverse routing indexes", () => {
  const store = new TopicTranscriptStore();
  store.mergeSnapshot(thread("main"), [turn("old-turn", "main")]);
  store.replaceThreadTurns("main", [turn("new-turn", "main")]);
  store.applyNotifications([{
    method: "item/agentMessage/delta",
    params: { turnId: "old-turn", itemId: "stale", delta: "must not route" }
  }]);
  expect(store.getThreadTurns("main")[0]?.items).toHaveLength(0);
});

test("selected child retains full deltas and releases the body on unsubscribe", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  const unsubscribe = store.subscribe("agent", () => undefined);
  store.applyNotifications([{
    method: "turn/started",
    params: { threadId: "agent", turn: { id: "agent-turn" } }
  }, ...Array.from({ length: 600 }, (_, index) => ({
    method: "item/agentMessage/delta",
    params: { threadId: "agent", turnId: "agent-turn", itemId: "answer", delta: String(index % 10) }
  }))]);

  expect(store.getThreadTurns("agent")[0]?.items[0]?.text).toHaveLength(600);
  expect(store.diagnostics()).toMatchObject({ topicBucketCount: 1, reducedThreadCount: 1 });
  unsubscribe();
  expect(store.getThreadTurns("agent")).toHaveLength(0);
  expect(store.getAgentOverview("main").get("agent")?.text.length).toBeLessThanOrEqual(420);
});

test("one hundred background agents retain only bounded lifecycle and overview state", () => {
  const store = new TopicTranscriptStore();
  const agents = Array.from({ length: 100 }, (_, index) => thread(`agent-${index}`, "main"));
  store.replaceCatalog([thread("main"), ...agents]);

  for (let index = 0; index < agents.length; index += 1) {
    const agent = agents[index]!;
    const notifications = [{
      method: "turn/started",
      params: { threadId: agent.id, turn: { id: `turn-${index}` } }
    }, ...Array.from({ length: 1000 }, (_, token) => ({
      method: "item/agentMessage/delta",
      params: { threadId: agent.id, turnId: `turn-${index}`, itemId: "answer", delta: String(token % 10) }
    }))];
    store.applyNotifications(notifications);
  }

  expect(store.diagnostics()).toMatchObject({
    topicBucketCount: 0,
    summaryBucketCount: 100,
    agentOverviewCount: 100,
    agentOverviewTextChars: 42_000,
    reducedThreadCount: 0,
    reducedTurnCount: 0
  });
  expect([...store.getAgentOverview("main").values()].every((entry) => entry.text.length <= 420)).toBe(true);
});

test("retained history load merges with live deltas and becomes complete before selection mounts", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  store.applyNotifications([{
    method: "turn/started",
    params: { threadId: "agent", turn: { id: "live-turn" } }
  }, {
    method: "item/agentMessage/delta",
    params: { threadId: "agent", turnId: "live-turn", itemId: "answer", delta: "live" }
  }]);
  const releaseLoad = store.retainThreadTranscript("agent");
  store.applyNotifications([{
    method: "item/agentMessage/delta",
    params: { threadId: "agent", turnId: "live-turn", itemId: "answer", delta: " delta" }
  }]);
  store.mergeSnapshot(thread("agent", "main"), [{
    id: "history-turn",
    threadId: "agent",
    status: "completed",
    items: [{ id: "history", type: "agentMessage", title: "Codex", text: "history", status: "completed" }]
  }]);

  expect(store.hasThreadTranscript("agent")).toBe(true);
  expect(store.getThreadTurns("agent").map((entry) => entry.id)).toEqual(["history-turn", "live-turn"]);
  expect(store.getThreadTurns("agent").at(-1)?.items[0]?.text).toBe("live delta");
  const unsubscribe = store.subscribe("agent", () => undefined);
  releaseLoad();
  expect(store.getThreadTurns("agent")).toHaveLength(2);
  unsubscribe();
  expect(store.getThreadTurns("agent")).toHaveLength(0);
  expect(store.hasThreadTranscript("agent")).toBe(false);
});

test("inline review turn appears in the store when no turn/started was emitted", () => {
  // Codex inline /review emits item/completed for enteredReviewMode without a
  // parent turn/started. The store routes through applyNotificationsPreservingActiveThread,
  // whose reducer must seed the missing turn so the review waterfall is visible
  // in getThreadTurns without needing a Stop/refresh.
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("thread-main")]);

  store.applyNotifications([{
    method: "item/completed",
    params: {
      threadId: "thread-main",
      turnId: "turn-review-inline",
      item: { id: "entered-review-mode", type: "enteredReviewMode", review: "Review uncommitted changes", status: "completed" }
    }
  }]);

  const turns = store.getThreadTurns("thread-main");
  expect(turns.some((entry) => entry.id === "turn-review-inline")).toBe(true);
  const reviewTurn = turns.find((entry) => entry.id === "turn-review-inline");
  expect(reviewTurn?.threadId).toBe("thread-main");
  expect(reviewTurn?.items[0]).toMatchObject({
    type: "enteredReviewMode",
    text: "Review uncommitted changes"
  });
});

test("inline review sub-agent stream seeds its turn in the store", () => {
  // The review sub-agent emits agentMessage/delta onto a turn that never received
  // turn/started. The streaming batch path must seed that turn inside the store.
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("thread-main")]);

  store.applyNotifications([{
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-main",
      turnId: "turn-review-stream",
      itemId: "review-answer",
      delta: "Looking at the diff"
    }
  }]);

  const turns = store.getThreadTurns("thread-main");
  const reviewTurn = turns.find((entry) => entry.id === "turn-review-stream");
  expect(reviewTurn).toBeTruthy();
  expect(reviewTurn?.items[0]).toMatchObject({ type: "agentMessage", text: "Looking at the diff" });
});

test("mergeTurn lands a review/start turn without waiting for notifications", () => {
  // App.startReview consumes review/start and calls transcriptRuntime.mergeTurn
  // (= store.mergeTurn). The seeded review turn must be immediately visible via
  // getThreadTurns, before any item notification arrives.
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("thread-main")]);

  store.mergeTurn({
    id: "turn-from-review-start",
    threadId: "thread-main",
    status: "inProgress",
    startedAt: 999,
    items: []
  });

  const turns = store.getThreadTurns("thread-main");
  expect(turns.some((entry) => entry.id === "turn-from-review-start")).toBe(true);
  const reviewTurn = turns.find((entry) => entry.id === "turn-from-review-start");
  expect(reviewTurn?.threadId).toBe("thread-main");
  expect(reviewTurn?.status).toBe("inProgress");
});
test("mergeTurn preserves live items when the review/start response arrives after deltas", () => {
  // Critical ordering: item/agentMessage/delta notifications land first and
  // stream real text into the review turn. The review/start RPC response may
  // arrive afterwards carrying only a synthetic user item (or empty items).
  // replaceTurn would filter the same-id turn and replace it, erasing the live
  // streamed items. mergeTurn must preserve them via item-level merge.
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("thread-main")]);

  // 1) A live review sub-agent stream arrives with no preceding turn/started.
  store.applyNotifications([{
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-main",
      turnId: "turn-review-order",
      itemId: "review-live-answer",
      delta: "Checking the uncommitted diff",
      firstTokenAt: 7000
    }
  }]);

  const before = store.getThreadTurns("thread-main").find((entry) => entry.id === "turn-review-order");
  expect(before?.items.some((item) => item.id === "review-live-answer")).toBe(true);
  expect(before?.items.find((item) => item.id === "review-live-answer")?.text).toBe("Checking the uncommitted diff");

  // 2) The review/start response now arrives carrying no items (or a synthetic
  //    user item), which must not erase the streamed agentMessage.
  store.mergeTurn({
    id: "turn-review-order",
    threadId: "thread-main",
    status: "inProgress",
    startedAt: 9000,
    items: []
  });

  const after = store.getThreadTurns("thread-main").find((entry) => entry.id === "turn-review-order");
  expect(after).toBeTruthy();
  // The streamed item survives the merge.
  const live = after?.items.find((item) => item.id === "review-live-answer");
  expect(live?.type).toBe("agentMessage");
  expect(live?.text).toBe("Checking the uncommitted diff");
  expect(live?.firstTokenAt).toBe(7000);
});
test("mergeTurn preserves live items and adds the synthetic user item from review/start", () => {
  // Real ordering: review sub-agent streams an agentMessage first, then the
  // review/start RPC arrives carrying a synthetic userMessage item. mergeTurn
  // must keep the streamed agent item AND add the synthetic user item, with no
  // duplication and original order preserved.
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("thread-main")]);

  store.applyNotifications([{
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-main",
      turnId: "turn-review-user",
      itemId: "review-live-answer",
      delta: "Inspecting uncommitted changes",
      firstTokenAt: 7000
    }
  }]);

  const before = store.getThreadTurns("thread-main").find((entry) => entry.id === "turn-review-user");
  expect(before?.items.some((item) => item.id === "review-live-answer")).toBe(true);
  expect(before?.items.find((item) => item.id === "review-live-answer")?.text).toBe("Inspecting uncommitted changes");

  store.mergeTurn({
    id: "turn-review-user",
    threadId: "thread-main",
    status: "inProgress",
    startedAt: 9000,
    items: [
      { id: "review-prompt", type: "userMessage", title: "", text: "Review changes", status: "completed" }
    ]
  });

  const after = store.getThreadTurns("thread-main").find((entry) => entry.id === "turn-review-user");
  expect(after).toBeTruthy();
  const live = after?.items.find((item) => item.id === "review-live-answer");
  expect(live?.type).toBe("agentMessage");
  expect(live?.text).toBe("Inspecting uncommitted changes");
  expect(live?.firstTokenAt).toBe(7000);
  const user = after?.items.find((item) => item.id === "review-prompt");
  expect(user?.type).toBe("userMessage");
  expect(user?.text).toBe("Review changes");
  // No duplicate items after the merge.
  const ids = after?.items.map((item) => item.id) ?? [];
  expect(new Set(ids).size).toBe(ids.length);
});

test("mergeTurn does not duplicate a userMessage item already present from the delta stream", () => {
  // Defensive ordering: the same synthetic user item may appear both in the
  // notification stream and in the review/start response. mergeTurn must dedupe
  // by item id rather than append a second copy.
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("thread-main")]);

  store.applyNotifications([{
    method: "item/completed",
    params: {
      threadId: "thread-main",
      turnId: "turn-review-dedupe",
      item: { id: "user-1", type: "userMessage", title: "", text: "Review", status: "completed" }
    }
  }]);
  store.mergeTurn({
    id: "turn-review-dedupe",
    threadId: "thread-main",
    status: "inProgress",
    startedAt: 9000,
    items: [
      { id: "user-1", type: "userMessage", title: "", text: "Review", status: "completed" }
    ]
  });

  const after = store.getThreadTurns("thread-main").find((entry) => entry.id === "turn-review-dedupe");
  const matching = after?.items.filter((item) => item.id === "user-1") ?? [];
  expect(matching.length).toBe(1);
  expect(matching[0]?.type).toBe("userMessage");
});


test("Claude tool calls keep readable overview titles", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([thread("main"), thread("agent", "main")]);
  store.applyNotifications([{
    method: "turn/started",
    params: { threadId: "agent", turn: { id: "agent-turn" } }
  }, {
    method: "item/started",
    params: {
      threadId: "agent",
      turnId: "agent-turn",
      item: { id: "tool-1", type: "toolCall", toolName: "Read", arguments: { path: "README.md" }, status: "inProgress" }
    }
  }]);
  expect(store.getAgentOverview("main").get("agent")).toMatchObject({ itemType: "toolCall", text: "Read" });
});
