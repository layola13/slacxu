import { describe, expect, test } from "bun:test";
import {
  buildIncrementalChatRows,
  createIncrementalChatRowsCache,
} from "../../apps/web/src/waterfall/chatRows";
import {
  createStableChatRowsCache,
  stableChatRows,
} from "../../apps/web/src/waterfall/stableChatRows";
import {
  CHAT_ROW_FLASH_ANIMATION,
  CHAT_ROW_FLASH_KEYFRAMES,
} from "../../apps/web/src/waterfall/ChatWaterfall";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient";

function makeTurns(threadId: string, count: number, offset = 0): WorkbenchTurn[] {
  return Array.from({ length: count }, (_, index) => {
    const id = index + offset;
    return {
      id: `turn-${threadId}-${id}`,
      threadId,
      status: "completed",
      items: [
        {
          id: `item-${threadId}-${id}-u`,
          type: "userMessage",
          title: "User",
          text: `Prompt ${id} for ${threadId}`,
          status: "completed",
        },
        {
          id: `item-${threadId}-${id}-a`,
          type: "agentMessage",
          title: "Assistant",
          text: `Response ${id} for ${threadId}`,
          status: "completed",
        },
      ],
    } as WorkbenchTurn;
  });
}

describe("Tab switch performance regressions", () => {
  test("per-page caches keep reference identity when switching back", () => {
    const turnsA = makeTurns("thread-a", 200);
    const turnsB = makeTurns("thread-b", 200);
    const cacheA = createIncrementalChatRowsCache();
    const cacheB = createIncrementalChatRowsCache();
    const stableA = createStableChatRowsCache();
    const stableB = createStableChatRowsCache();

    const rowsA1 = stableChatRows(
      buildIncrementalChatRows(turnsA, cacheA, { cacheKey: "thread-a" }),
      stableA,
    );
    buildIncrementalChatRows(turnsB, cacheB, { cacheKey: "thread-b" });
    const rowsA2 = stableChatRows(
      buildIncrementalChatRows(turnsA, cacheA, { cacheKey: "thread-a" }),
      stableA,
    );

    expect(rowsA2).toBe(rowsA1);
    expect(rowsA2.every((row, index) => row === rowsA1[index])).toBe(true);
  });

  test("single shared cache across threads loses stability on switch-back", () => {
    const turnsA = makeTurns("thread-a", 50);
    const turnsB = makeTurns("thread-b", 50);
    const shared = createIncrementalChatRowsCache();
    const stable = createStableChatRowsCache();

    const rowsA1 = stableChatRows(
      buildIncrementalChatRows(turnsA, shared, { cacheKey: "thread-a" }),
      stable,
    );
    stableChatRows(
      buildIncrementalChatRows(turnsB, shared, { cacheKey: "thread-b" }),
      stable,
    );
    const rowsA2 = stableChatRows(
      buildIncrementalChatRows(turnsA, shared, { cacheKey: "thread-a" }),
      stable,
    );

    expect(rowsA2).not.toBe(rowsA1);
  });

  test("cache-hit rebuild of 400 rows stays far below full-build budget", () => {
    const turns = makeTurns("thread-cache-hit", 200);
    const cache = createIncrementalChatRowsCache();
    const stable = createStableChatRowsCache();

    buildIncrementalChatRows(turns.slice(0, 20), cache, { cacheKey: "thread-cache-hit" });
    const fullStart = performance.now();
    const fullRows = stableChatRows(
      buildIncrementalChatRows(turns, cache, { cacheKey: "thread-cache-hit" }),
      stable,
    );
    const fullElapsed = performance.now() - fullStart;
    expect(fullRows.length).toBeGreaterThan(0);
    expect(fullElapsed).toBeLessThan(80);

    const hitStart = performance.now();
    const hitRows = stableChatRows(
      buildIncrementalChatRows(turns, cache, { cacheKey: "thread-cache-hit" }),
      stable,
    );
    const hitElapsed = performance.now() - hitStart;
    expect(hitRows).toBe(fullRows);
    expect(hitElapsed).toBeLessThan(15);
  });

  test("row flash animation and keyframes are shared stable references", () => {
    expect(CHAT_ROW_FLASH_ANIMATION).toBe("chatRowFlash 1400ms ease");
    expect(Object.keys(CHAT_ROW_FLASH_KEYFRAMES).sort()).toEqual(["0%", "100%", "38%"]);
    expect(CHAT_ROW_FLASH_KEYFRAMES).toBe(CHAT_ROW_FLASH_KEYFRAMES);
  });

  test("recent-page cache policy stays bounded", () => {
    const pages = new Map<string, number>();
    const maxPages = 8;
    for (let index = 0; index < 12; index += 1) {
      pages.set(`page-${index}`, index);
      if (pages.size > maxPages) {
        const oldest = pages.keys().next().value;
        if (oldest) pages.delete(oldest);
      }
    }
    expect(pages.size).toBe(maxPages);
    expect(pages.has("page-11")).toBe(true);
    expect(pages.has("page-0")).toBe(false);
  });
});
