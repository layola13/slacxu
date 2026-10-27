import { expect, test } from "bun:test";
import type { WorkbenchItem } from "../../apps/web/src/state/codexClient.ts";
import type { ChatWaterfallRow } from "../../apps/web/src/waterfall/types.ts";
import {
  isPendingEchoedInPersistedRows,
  mergePendingRows,
  pendingAppendRows,
  type PendingAppendMessage,
} from "../../apps/web/src/waterfall/pendingRows.ts";

function persistedUserRow(threadId: string, text: string, key: string): ChatWaterfallRow {
  const item: WorkbenchItem = { id: `item-${key}`, type: "userMessage", title: "User", text, status: "completed" };
  return {
    key, turnId: `turn-${key}`, threadId, itemIds: [item.id],
    kind: "userMessage", role: "user", text, title: "User",
    status: "completed", item, searchText: text.toLowerCase(),
    width: "prose", isLive: false,
  };
}

function pendingMessage(overrides: Partial<PendingAppendMessage> = {}): PendingAppendMessage {
  return {
    id: "pending-1", threadId: "thread-1", turnId: "pending-1",
    text: "hi", inputText: "hi", createdAt: Date.now(),
    existingMatchingUserMessageCount: 0, mode: "pendingUser",
    ...overrides,
  };
}

test("hides a pendingUser placeholder once the server echo lands", () => {
  const persisted = [persistedUserRow("thread-1", "hi", "a")];
  const pending = pendingAppendRows([pendingMessage()], "thread-1");
  expect(pending).toHaveLength(1);
  expect(mergePendingRows(persisted, pending)).toEqual(persisted);
});

test("keeps the placeholder visible while the echo has not arrived", () => {
  const pending = pendingAppendRows([pendingMessage()], "thread-1");
  expect(mergePendingRows([], pending)).toHaveLength(1);
});

test("hides append-mode placeholders when steered text is echoed, keeps queued modes", () => {
  const persisted = [persistedUserRow("thread-1", "hi", "a")];
  const append = pendingAppendRows([pendingMessage({ id: "p-append", mode: "append" })], "thread-1");
  expect(mergePendingRows(persisted, append)).toEqual(persisted);
  for (const mode of ["queued", "queuedFailed"] as const) {
    const rows = pendingAppendRows([pendingMessage({ id: `p-${mode}`, mode })], "thread-1");
    expect(mergePendingRows(persisted, rows)).toHaveLength(2);
  }
});

test("matches new-conversation placeholders without a thread id", () => {
  const persisted = [persistedUserRow("thread-9", "hi", "a")];
  const pending = pendingAppendRows([pendingMessage({ id: "p-new", threadId: null })], null);
  expect(pending).toHaveLength(1);
  expect(pending[0].threadId).toBe("pending-new-thread");
  expect(isPendingEchoedInPersistedRows(persisted, pending[0])).toBe(true);
});

test("does not match echoes from a different thread", () => {
  const persisted = [persistedUserRow("thread-other", "hi", "a")];
  const pending = pendingAppendRows([pendingMessage()], "thread-1");
  expect(isPendingEchoedInPersistedRows(persisted, pending[0])).toBe(false);
  expect(mergePendingRows(persisted, pending)).toHaveLength(2);
});

test("respects pre-existing duplicate messages via existingMatchingUserMessageCount", () => {
  // One older "hi" already existed before sending (existingCount=1).
  // A single persisted "hi" is that old one -> placeholder stays.
  const oneOld = [persistedUserRow("thread-1", "hi", "old")];
  const pending = pendingAppendRows([pendingMessage({ existingMatchingUserMessageCount: 1 })], "thread-1");
  expect(isPendingEchoedInPersistedRows(oneOld, pending[0])).toBe(false);
  // Old + new echo -> placeholder hides.
  const oldPlusEcho = [...oneOld, persistedUserRow("thread-1", "hi", "new")];
  expect(isPendingEchoedInPersistedRows(oldPlusEcho, pending[0])).toBe(true);
});
