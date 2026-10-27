import { expect, test, describe } from "bun:test";
import {
  buildChatRows,
  buildIncrementalChatRows,
  createIncrementalChatRowsCache
} from "../../apps/web/src/waterfall/chatRows";
import {
  createStableChatRowsCache,
  stableChatRows
} from "../../apps/web/src/waterfall/stableChatRows";
import { isSameChatPanelProps } from "../../apps/web/src/components/ChatPanel";
import { resolveTurnRetryState, type TurnRetryState } from "../../apps/web/src/app/turnRetryState";
import { applyNotification, initialClientState, type WorkbenchTurn, type WorkbenchItem } from "../../apps/web/src/state/codexClient";

describe("Waterfall Performance & Regression Prevention Benchmarks", () => {
  test("Benchmark: 2,000 turns row construction completes under budget (< 80ms)", () => {
    const threadId = "thread-perf-large";
    const turns: WorkbenchTurn[] = [];

    for (let i = 0; i < 2000; i++) {
      turns.push({
        id: `turn-${i}`,
        threadId,
        status: "completed",
        items: [
          {
            id: `item-${i}-user`,
            type: "userMessage",
            title: "User",
            text: `Question ${i}`,
            status: "completed",
            startedAt: 1700000000 + i * 10
          },
          {
            id: `item-${i}-agent`,
            type: "agentMessage",
            title: "Assistant",
            text: `Answer ${i}`,
            status: "completed",
            startedAt: 1700000000 + i * 10 + 2
          }
        ]
      });
    }

    // Warmup JIT
    buildChatRows(turns.slice(0, 50));

    const t0 = performance.now();
    const rows = buildChatRows(turns);
    const elapsed = performance.now() - t0;

    expect(rows.length).toBeGreaterThanOrEqual(4000);
    // 2,000 turns (4,000+ rows) should process in less than 80ms
    expect(elapsed).toBeLessThan(80);
  });

  test("Incremental Stability: 5 consecutive retry error updates preserve 100% historical row references", () => {
    const threadId = "thread-incremental-perf";
    const historicalTurns: WorkbenchTurn[] = Array.from({ length: 500 }, (_, i) => ({
      id: `turn-hist-${i}`,
      threadId,
      status: "completed",
      items: [
        { id: `item-hist-${i}-u`, type: "userMessage", title: "User", text: `Prompt ${i}`, status: "completed" },
        { id: `item-hist-${i}-a`, type: "agentMessage", title: "Assistant", text: `Response ${i}`, status: "completed" }
      ]
    }));

    const activeTurnId = "turn-active-retry";
    let activeTurn: WorkbenchTurn = {
      id: activeTurnId,
      threadId,
      status: "inProgress",
      items: [
        { id: "active-user-1", type: "userMessage", title: "User", text: "Heavy action", status: "completed" }
      ]
    };

    const incrementalCache = createIncrementalChatRowsCache();
    const stableCache = createStableChatRowsCache();

    let allTurns = [...historicalTurns, activeTurn];
    let rows = stableChatRows(
      buildIncrementalChatRows(allTurns, incrementalCache, { cacheKey: "retry-cache-test" }),
      stableCache
    );

    const initialHistoricalRows = rows.filter((r) => r.turnId !== activeTurnId);
    expect(initialHistoricalRows).toHaveLength(1000);

    // 5 consecutive retry error notifications on active turn
    for (let attempt = 1; attempt <= 5; attempt++) {
      const retryItem: WorkbenchItem = {
        id: `retry-error-${activeTurnId}`,
        type: "retryError",
        title: "Retrying",
        text: `Rate limited attempt ${attempt}/5`,
        status: "running",
        startedAt: 1700000000,
        payload: {
          retryError: true,
          retrySource: "codex",
          attempt,
          max: 5
        }
      };

      activeTurn = {
        ...activeTurn,
        items: [activeTurn.items[0]!, retryItem]
      };
      allTurns = [...historicalTurns, activeTurn];

      rows = stableChatRows(
        buildIncrementalChatRows(allTurns, incrementalCache, { cacheKey: "retry-cache-test" }),
        stableCache
      );

      // Verify all 1,000 historical rows maintain 100% strict reference identity (===)
      const currentHistorical = rows.filter((r) => r.turnId !== activeTurnId);
      expect(currentHistorical).toHaveLength(1000);
      for (let j = 0; j < 1000; j++) {
        expect(currentHistorical[j]).toBe(initialHistoricalRows[j]);
      }
    }
  });

  test("Pure global errors update ChatPanel shell for alerts while preserving identical chat rows", () => {
    const threadId = "thread-global-error-test";
    const turns: WorkbenchTurn[] = [
      {
        id: "turn-1",
        threadId,
        status: "completed",
        items: [
          { id: "u1", type: "userMessage", title: "User", text: "Hello", status: "completed" }
        ]
      }
    ];

    const baseProps: any = {
      activeThreadId: threadId,
      turns,
      turnsByThreadId: new Map([[threadId, turns]]),
      turnTokenUsage: {},
      requestTokenUsage: {},
      compactionSourceByTurnId: {},
      threads: [{ id: threadId, title: "Chat" }],
      transcriptStore: { getThreadTurns: () => turns, hasThreadTranscript: () => true },
      usageStore: { getThreadUsage: () => undefined },
      errors: [],
      pendingRequests: [],
      pendingAppends: [],
      goal: null,
      slashNotice: null,
      stats: null,
      requestMonitor: [],
      statsOpen: false,
      modes: {},
      interactive: true,
      t: (k: string) => k
    };

    // When a pure global error arrives (no turnId), only errors array changes
    const errorProps: any = {
      ...baseProps,
      errors: ["Error from provider (Console): OpenCode's free tier can only be used in OpenCode"]
    };

    // errors differs -> ChatPanel memo yields false so outer shell re-renders to display Alert/Snackbar
    expect(isSameChatPanelProps(baseProps, errorProps)).toBe(false);
    // But turns reference is completely unchanged:
    expect(baseProps.turns).toBe(errorProps.turns);

    // Row construction output is strictly identical because turns are identical
    const rows1 = buildChatRows(baseProps.turns);
    const rows2 = buildChatRows(errorProps.turns);
    expect(rows1.length).toBe(rows2.length);
    expect(rows1[0]!.key).toBe(rows2[0]!.key);
  });

  test("resolveTurnRetryState bails out across rapid duplicate retry ticks", () => {
    let currentRetryState: TurnRetryState | null = null;
    let rootReRenderCount = 0;

    const setTurnRetryState = (next: TurnRetryState | null | ((cur: TurnRetryState | null) => TurnRetryState | null)) => {
      const resolved = resolveTurnRetryState(currentRetryState, next);
      if (resolved !== currentRetryState) {
        currentRetryState = resolved;
        rootReRenderCount++;
      }
    };

    // 1st tick: new retry error sets state -> triggers 1 re-render
    setTurnRetryState({
      threadId: "thread-tick",
      turnId: "turn-tick-1",
      message: "Selected model is at capacity",
      details: "503 Service Unavailable",
      updatedAt: 1000
    });
    expect(rootReRenderCount).toBe(1);

    // Next 10 rapid duplicate ticks with identical error message and details:
    // MUST ALL BAIL OUT and cause 0 additional root re-renders!
    for (let tick = 2; tick <= 11; tick++) {
      setTurnRetryState((prev) => ({
        threadId: "thread-tick",
        turnId: "turn-tick-1",
        message: "Selected model is at capacity",
        details: "503 Service Unavailable",
        updatedAt: 1000 + tick * 500
      }));
    }

    expect(rootReRenderCount).toBe(1); // 100% bailout rate, 0 additional re-renders

    // When error changes or clears, state updates properly
    setTurnRetryState(null);
    expect(rootReRenderCount).toBe(2);
    expect(currentRetryState).toBeNull();
  });
});
