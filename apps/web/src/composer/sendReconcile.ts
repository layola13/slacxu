import type { WorkbenchTurn } from "../state/codexClient";
import { observeTurnStarted } from "../goalContinuation";
import { isRunningTurnStatus } from "../app/transcripts/topicRuntimeIndex";

/**
 * 发送结果不明的错误：RPC 超时（-32001）或 WebSocket 中断。服务端可能已经
 * 收下 turn/start 并落库，此时按失败处理并引导用户重发必然造成重复消息。
 */
export function isAmbiguousSendError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  if (record.code === -32001) {
    return true;
  }
  const message = extractErrorMessage(error);
  return message.includes("timed out") || message.includes("WebSocket disconnected");
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
      if (value && typeof value === "object") {
        const nested = extractErrorMessage(value);
        if (nested && nested !== "[object Object]") {
          return nested;
        }
      }
    }
    try {
      return JSON.stringify(record);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function sendTextsMatch(actualText: string, expectedText: string): boolean {
  const actual = actualText.trim();
  const expected = expectedText.trim();
  if (!expected) {
    return true;
  }
  return actual === expected || actual.includes(expected) || expected.includes(actual);
}

/**
 * 超时对账：在最新 turns 里找本次发送之后、同线程、同文案的 running turn。
 * 找到即说明服务端已收下本次发送，调用方应按已提交处理，等正常 echo 消除
 * waiting 占位，而不是提示用户重发。
 */
export function findReconciledSendTurn(
  turns: readonly WorkbenchTurn[],
  threadId: string,
  inputText: string,
  sendStartedAt: number
): string | null {
  const expected = inputText.trim();
  if (!expected) {
    return null;
  }
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn || turn.threadId !== threadId || !isRunningTurnStatus(turn.status)) {
      continue;
    }
    // startedAt 是秒级时间戳，允许 5s 时钟偏差。
    if (typeof turn.startedAt === "number" && turn.startedAt * 1000 < sendStartedAt - 5000) {
      continue;
    }
    const matched = turn.items.some((item) => item.type === "userMessage" && sendTextsMatch(item.text, expected));
    if (matched) {
      return turn.id;
    }
  }
  return null;
}

/**
 * 首轮冷启动（spawn → CLI init 握手 10s+）时 turn/start 回执可能丢失，
 * 但服务端其实已经收下。本函数先做一次即时对账；找不到时给 live
 * subscription 一个有界窗口（12s）补发 turn/started，到了就按已提交处理，
 * 避免误报红错、避免用户重发造成重复消息。返回 reconciled turnId 或 null。
 */
export async function reconcileAmbiguousSend(
  source: EventTarget,
  readTurns: () => readonly WorkbenchTurn[],
  threadId: string,
  inputText: string,
  sendStartedAt: number,
  waitMs = 12_000
): Promise<string | null> {
  const immediate = findReconciledSendTurn(readTurns(), threadId, inputText, sendStartedAt);
  if (immediate) return immediate;
  const lateWaiter = observeTurnStarted(source, threadId, waitMs);
  try {
    const lateTurnId = await lateWaiter.waitFor(null).catch(() => null);
    if (!lateTurnId) return null;
    // 等 reducer 把通知落进 transcript 快照再做第二次对账。
    await new Promise((resolve) => setTimeout(resolve, 500));
    return findReconciledSendTurn(readTurns(), threadId, inputText, sendStartedAt) ?? lateTurnId;
  } finally {
    lateWaiter.dispose();
  }
}
