import type { WorkbenchItem } from "../state/codexClient";
import type { ChatWaterfallRow } from "./types";

export type PendingAppendMessage = {
  id: string;
  threadId: string | null;
  turnId: string;
  text: string;
  inputText?: string;
  createdAt: number;
  existingMatchingUserMessageCount?: number;
  existingTurnUserMessageCount?: number;
  mode?: "append" | "pendingUser" | "queued" | "queuedFailed";
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function pendingAppendRows(pendingAppends: PendingAppendMessage[], activeThreadId: string | null): ChatWaterfallRow[] {
  return pendingAppends
    .filter((message) => message.threadId === activeThreadId)
    .map((message) => {
      const item: WorkbenchItem = {
        id: message.id,
        type: "pendingAppend",
        title: "You",
        text: message.text,
        status: message.mode === "queuedFailed" ? "failed" : "waiting",
        payload: {
          mode: message.mode ?? "append",
          inputText: message.inputText ?? message.text,
          existingMatchingUserMessageCount: message.existingMatchingUserMessageCount ?? 0
        }
      };
      return {
        key: `pending-append:${message.id}`,
        turnId: message.turnId,
        threadId: message.threadId ?? "pending-new-thread",
        itemIds: [message.id],
        kind: "userMessage",
        role: "user",
        text: message.text,
        title: "You",
        status: "waiting",
        item,
        searchText: message.text.toLowerCase(),
        width: "prose",
        isLive: true,
        startedAt: message.createdAt
      } satisfies ChatWaterfallRow;
    });
}

export function mergePendingRows(persistedRows: ChatWaterfallRow[], pendingRows: ChatWaterfallRow[]): ChatWaterfallRow[] {
  if (pendingRows.length === 0) {
    return persistedRows;
  }
  // An optimistic message belongs to the active composer thread and must be
  // shown after that thread's existing transcript. Timestamp-based insertion
  // is unsafe while Split View is switching focus: restored turns can carry
  // older/missing timestamps and would make the new message appear mid-stream.
  // The real server item will reconcile with this row and remove the pending
  // entry once it arrives.
  // 渲染期兜底：服务端回包已落库（persisted 里已有同文案 User 行）但
  // pendingAppends state 还没被清理（JS 卡顿/慢网时 effect 延迟）时，
  // 直接隐藏 pending，避免 User + You 同屏重复。
  // pendingUser（新 turn）和 append（steer 进运行中 turn）都会产生持久回显，
  // 都适用；queued/queuedFailed 是队列状态，必须保持可见。
  const visiblePendingRows = pendingRows.filter((row) => {
    const payload = asRecord(row.item.payload);
    const mode = stringValue(payload.mode) ?? "append";
    if (mode !== "pendingUser" && mode !== "append") {
      return true;
    }
    return !isPendingEchoedInPersistedRows(persistedRows, row);
  });
  return [...persistedRows, ...visiblePendingRows];
}

export function isPendingEchoedInPersistedRows(persistedRows: ChatWaterfallRow[], pendingRow: ChatWaterfallRow): boolean {
  const payload = asRecord(pendingRow.item.payload);
  const rawExpected = typeof payload.inputText === "string" && payload.inputText.trim()
    ? payload.inputText
    : pendingRow.text;
  const expected = rawExpected.trim();
  const existingCount = typeof payload.existingMatchingUserMessageCount === "number" && Number.isFinite(payload.existingMatchingUserMessageCount)
    ? payload.existingMatchingUserMessageCount
    : 0;
  let matchingCount = 0;
  // 新会话的占位 threadId 为 null（渲染为 pending-new-thread），此时不做线程
  // 过滤——这类占位只可能属于当前活跃线程；否则慢网时回显永远匹配不上，
  // waiting 占位和持久消息同屏，看起来像重复发送。
  const pendingThreadId = pendingRow.threadId === "pending-new-thread" ? null : pendingRow.threadId;
  for (const candidate of persistedRows) {
    if (candidate.kind !== "userMessage") {
      continue;
    }
    if (pendingThreadId && candidate.threadId !== pendingThreadId) {
      continue;
    }
    if (pendingUserTextsMatch(candidate.text, expected)) {
      matchingCount += 1;
      if (matchingCount > existingCount) {
        return true;
      }
    }
  }
  return false;
}

export function pendingUserTextsMatch(actualText: string, expectedText: string): boolean {
  const actual = actualText.trim();
  const expected = expectedText.trim();
  if (!expected) {
    return true;
  }
  return actual === expected || actual.includes(expected) || expected.includes(actual);
}
