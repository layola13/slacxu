import { expect, test } from "bun:test";
import { appReducer } from "../../apps/web/src/app/appReducer.ts";
import { initialClientState } from "../../apps/web/src/state/codexClient.ts";
import { projectRuntimeNotification } from "../../apps/web/src/app/transcripts/runtimeTurnProjection.ts";
import { claudeStartupStageLocaleKey, isClaudeStartupStage } from "../../apps/web/src/app/claude/claudeStartupStage.ts";
import { reconcileAmbiguousSend } from "../../apps/web/src/composer/sendReconcile.ts";

test("thread/claude/startup passes the runtime projection and lands in state", () => {
  const notification = {
    method: "thread/claude/startup",
    params: { threadId: "thread-1", stage: "handshake", at: 123 }
  } as never;
  expect(projectRuntimeNotification(notification)).not.toBeNull();

  let state = appReducer(initialClientState, { type: "notification", message: notification });
  expect(state.claudeStartupStages["thread-1"]).toMatchObject({ stage: "handshake", at: 123 });
  expect(isClaudeStartupStage(state.claudeStartupStages["thread-1"]?.stage)).toBe(true);
  expect(claudeStartupStageLocaleKey("handshake")).toBe("composer.claudeStartup.handshake");
});

test("thread/claude/startup ignores unknown stages", () => {
  const state = appReducer(initialClientState, {
    type: "notification",
    message: { method: "thread/claude/startup", params: { threadId: "thread-1", stage: "warping" } } as never
  });
  expect(state.claudeStartupStages["thread-1"]).toBeUndefined();
});

test("turn/started clears the claude startup badge for that thread only", () => {
  let state = appReducer(initialClientState, {
    type: "notification",
    message: { method: "thread/claude/startup", params: { threadId: "thread-1", stage: "spawning", at: 1 } } as never
  });
  state = appReducer(state, {
    type: "notification",
    message: { method: "thread/claude/startup", params: { threadId: "thread-2", stage: "handshake", at: 2 } } as never
  });
  state = appReducer(state, {
    type: "notification",
    message: { method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1", threadId: "thread-1" } } } as never
  });
  expect(state.claudeStartupStages["thread-1"]).toBeUndefined();
  expect(state.claudeStartupStages["thread-2"]).toMatchObject({ stage: "handshake" });
});

test("reconcileAmbiguousSend returns the immediate transcript match without waiting", async () => {
  const source = new EventTarget();
  const turns = [{
    id: "turn-9",
    threadId: "thread-1",
    status: "inProgress",
    startedAt: Math.floor(Date.now() / 1000),
    items: [{ id: "u1", type: "userMessage", title: "", text: "hello", status: "completed" }]
  }] as never;
  const found = await reconcileAmbiguousSend(source, () => turns, "thread-1", "hello", Date.now() - 1000, 50);
  expect(found).toBe("turn-9");
});

test("reconcileAmbiguousSend follows a late turn/started instead of failing", async () => {
  const source = new EventTarget();
  const turns = [] as never[];
  const pending = reconcileAmbiguousSend(source, () => turns, "thread-1", "hello", Date.now() - 1000, 2000);
  await new Promise((resolve) => setTimeout(resolve, 50));
  source.dispatchEvent(new CustomEvent("server-message", {
    detail: {
      type: "codex.notification",
      message: { method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-late" } } }
    }
  }));
  expect(await pending).toBe("turn-late");
});

test("reconcileAmbiguousSend gives up after the bounded wait", async () => {
  const source = new EventTarget();
  const found = await reconcileAmbiguousSend(source, () => [], "thread-1", "hello", Date.now() - 1000, 50);
  expect(found).toBeNull();
});
