import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyNotification, initialClientState } from "../../apps/web/src/state/codexClient";
import { projectRuntimeNotifications } from "../../apps/web/src/app/transcripts/runtimeTurnProjection";
import { TopicTranscriptStore } from "../../apps/web/src/app/transcripts/topicTranscriptStore";
import { buildJevState } from "../../frontends/jev/src/jev/jevQuestions";

const T = "thr-jev";
const U = "turn-jev";
const n = (method: string, params: Record<string, unknown>) => ({ jsonrpc: "2.0", method, params }) as any;
const stream = [
  n("turn/started", { threadId: T, turnId: U, turn: { id: U, threadId: T, status: "inProgress" } }),
  n("item/completed", { threadId: T, turnId: U, item: { type: "userMessage", id: "u1", turnId: U, status: "completed", text: "最近5次提交改了什么？" } }),
  n("item/completed", { threadId: T, turnId: U, item: { type: "toolCall", id: "c1", turnId: U, status: "completed", text: "git log -5 ok" } }),
  n("item/completed", { threadId: T, turnId: U, item: { type: "agentMessage", id: "m1", turnId: U, status: "completed", text: "ANSWER_BODY" } }),
  n("turn/completed", { threadId: T, turnId: U, turn: { id: U, threadId: T, status: "completed", completedAt: 1 } }),
];
const snap = (items: any[]) => buildJevState({ threadId: T, turnId: U, items: items.map((i) => ({ type: String(i.type), title: String(i.title ?? ""), text: String(i.text ?? "") })) });

test("App runtime index drops assistant/tool items, so it cannot feed JEV", () => {
  let app: any = { ...initialClientState, activeThreadId: T };
  for (const m of projectRuntimeNotifications(stream, { activeThreadId: T })) app = applyNotification(app, m);
  const state = snap(app.turns.find((t: any) => t.id === U).items);
  expect(state).toContain("assistant_response:\n(empty)");
});

test("transcript store keeps the full turn for the JEV snapshot", () => {
  const store = new TopicTranscriptStore();
  store.replaceCatalog([{ id: T } as any]);
  for (const m of stream) store.registerNotificationRouting(m);
  store.applyNotifications(stream);
  const turn = store.getThreadTurns(T).find((t) => t.id === U)!;
  const state = snap(turn.items);
  expect(state).toContain("ANSWER_BODY");
  expect(state).toContain("git log -5 ok");
});

test("App dispatches the JEV snapshot from the transcript store", () => {
  const appSrc = readFileSync(join(import.meta.dir, "../../apps/web/src/App.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useSocketPipeline.ts"), "utf8");
  expect(appSrc).toContain("dispatchJevTurnSnapshotDelayed(");
  expect(appSrc).not.toContain("dispatchJevTurnCompleted({");
  const helperSrc = readFileSync(join(import.meta.dir, "../../frontends/jev/src/jev/jevTurnSnapshotDispatch.ts"), "utf8");
  expect(helperSrc).toContain("getTurnFromTranscriptStore(threadId, turnId)");
  // Transcript store first, runtime index only as fallback.
  const storeIdx = helperSrc.indexOf("getTurnFromTranscriptStore(threadId, turnId)");
  const fallbackIdx = helperSrc.indexOf("getTurnFromRuntimeIndex(turnId)");
  expect(storeIdx).toBeGreaterThan(-1);
  expect(fallbackIdx).toBeGreaterThan(storeIdx);
});
