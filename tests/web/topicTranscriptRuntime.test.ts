import { expect, test } from "bun:test";
import { appReducer } from "../../apps/web/src/app/appReducer.ts";
import { TopicTranscriptStore } from "../../apps/web/src/app/transcripts/topicTranscriptStore.ts";
import { projectRuntimeNotification, projectRuntimeTurn } from "../../apps/web/src/app/transcripts/runtimeTurnProjection.ts";
import { isHighFrequencyTranscriptDelta } from "../../apps/web/src/app/transcripts/useTopicTranscriptRuntime.ts";
import { MAX_TRANSCRIPT_BATCH_SIZE } from "../../apps/web/src/app/transcripts/useTranscriptStreamScheduler.ts";
import { initialClientState, type WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";

test("high-frequency transcript deltas never enter the global App summary reducer", () => {
  const methods = Array.from({ length: 500 }, (_, index) =>
    index % 3 === 0 ? "item/agentMessage/delta" : index % 3 === 1 ? "item/plan/delta" : "item/commandExecution/outputDelta"
  );
  expect(methods.filter((method) => !isHighFrequencyTranscriptDelta(method))).toHaveLength(0);
  expect(isHighFrequencyTranscriptDelta("item/completed")).toBe(false);
  expect(isHighFrequencyTranscriptDelta("turn/completed")).toBe(false);
});

test("large assistant, command and image bodies never enter the App runtime projection", () => {
  const body = "x".repeat(1_000_000);
  const turn: WorkbenchTurn = {
    id: "turn-large", threadId: "thread-large", status: "completed", items: [
      { id: "user", type: "userMessage", title: "User", text: "keep me" },
      { id: "assistant", type: "agentMessage", title: "Codex", text: body },
      { id: "command", type: "commandExecution", title: "Command", text: body, payload: { output: body } },
      { id: "image", type: "imageGeneration", title: "Image", text: body, images: [{ url: `data:image/png;base64,${body}` }] },
      { id: "plan", type: "plan", title: "Plan", text: "Inspect", payload: { plan: [{ step: "Inspect", status: "completed" }], result: body } }
    ]
  };
  const projected = projectRuntimeTurn(turn);
  expect(projected.items.map((item) => item.id)).toEqual(["user", "plan"]);
  expect(JSON.stringify(projected)).not.toContain(body);
  expect(projected.items[1]?.payload).toEqual({ plan: [{ step: "Inspect", status: "completed" }] });
});

test("terminal lifecycle notifications discard embedded transcript bodies", () => {
  const body = "terminal-body-".repeat(50_000);
  const projected = projectRuntimeNotification({
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: { id: "turn-1", threadId: "thread-1", status: "completed", items: [{ id: "answer", text: body }] }
    }
  });
  expect(projected).not.toBeNull();
  expect(JSON.stringify(projected)).not.toContain(body);
  const started = appReducer(initialClientState, {
    type: "notification",
    message: { method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1", threadId: "thread-1" } } }
  });
  const completed = appReducer(started, { type: "notification", message: projected! });
  expect(completed.turns[0]).toMatchObject({ id: "turn-1", status: "completed", items: [] });
});

test("projected user content arrays still clear matching pending input", () => {
  const projected = projectRuntimeNotification({
    method: "item/completed",
    params: {
      threadId: "thread-1", turnId: "turn-1",
      item: { id: "user-1", type: "userMessage", content: [{ type: "text", text: "continue work" }] }
    }
  });
  expect((projected?.params as { item?: { text?: string } }).item?.text).toBe("continue work");
});

test("non-coalescible agent completion storms are split into bounded renderer slices", () => {
  const completions = Array.from({ length: 500 }, (_, index) => ({
    method: "item/completed",
    params: { threadId: `agent-${index}`, turnId: `turn-${index}`, item: { id: `answer-${index}`, type: "agentMessage", text: "done" } }
  }));
  expect(MAX_TRANSCRIPT_BATCH_SIZE).toBeLessThanOrEqual(256);
  expect(Math.ceil(completions.length / MAX_TRANSCRIPT_BATCH_SIZE)).toBeGreaterThanOrEqual(2);
  expect(completions.map(projectRuntimeNotification).filter(Boolean)).toHaveLength(0);
});

test("the app routes every transcript notification through renderer backpressure", async () => {
  const source = await Bun.file(new URL("../../apps/web/src/App.tsx", import.meta.url)).text()
    + await Bun.file(new URL("../../apps/web/src/app/workbench/useSocketPipeline.ts", import.meta.url)).text();
  const runtimeSource = await Bun.file(new URL("../../apps/web/src/app/transcripts/useTopicTranscriptRuntime.ts", import.meta.url)).text();
  expect(source).toContain("transcriptRuntime.enqueue(message.message)");
  expect(source).not.toContain("transcriptRuntime.applyImmediate(message.message)");
  expect(runtimeSource).not.toContain("applyImmediate");
});

test("reopening a closed tab restores the retained topic snapshot into App state", () => {
  const thread = { id: "thread-reopen", title: "Reopen me" };
  const turn: WorkbenchTurn = {
    id: "turn-reopen",
    threadId: thread.id,
    status: "completed",
    items: [{ id: "user-reopen", type: "userMessage", title: "User", text: "retained content" }]
  };
  const store = new TopicTranscriptStore();
  store.mergeSnapshot(thread, [turn]);

  const withoutTranscript = appReducer({ ...initialClientState, threads: [thread], turns: [turn] }, {
    type: "threadTranscriptsEvicted",
    threadIds: [thread.id]
  });
  expect(withoutTranscript.turns).toEqual([]);
  expect(store.hasThreadTranscript(thread.id)).toBe(true);

  const reopened = appReducer(withoutTranscript, {
    type: "threadLoaded",
    thread,
    turns: store.getThreadTurns(thread.id)
  });
  expect(reopened.activeThreadId).toBe(thread.id);
  expect(reopened.turns).toHaveLength(1);
  expect(reopened.turns[0]?.items[0]?.text).toBe("retained content");
});
