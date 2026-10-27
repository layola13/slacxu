import { expect, test, describe } from "bun:test";
import {
  MAX_SNAPSHOT_BYTES,
  normalizeDetachedTaskSnapshot,
  createDebouncedTaskBroadcaster,
  shouldLoadDetachedThreadTurns
} from "../../desktop/detached-task.cjs";

describe("detached task performance and resilience (production implementation)", () => {
  test("preserves snapshot intact when under 256KB limit", () => {
    const thread = { id: "thread-small-1", title: "Small Thread", cwd: "D:/test" };
    const snapshot = {
      threadId: "thread-small-1",
      thread,
      turns: [{ id: "turn-1", status: "completed", items: [] }],
      pageState: { loading: false, nextCursor: null, paginated: true }
    };

    const result = normalizeDetachedTaskSnapshot(snapshot);
    expect(result.strippedTurns).toBe(false);
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot.turns).toHaveLength(1);
    expect(result.originalBytes).toBeLessThan(MAX_SNAPSHOT_BYTES);
    expect(result.finalBytes).toBe(result.originalBytes);
  });

  test("strips turns from detached task snapshot when size exceeds 256KB", () => {
    const thread = { id: "thread-heavy-1", title: "Heavy Thread", cwd: "D:/test" };
    const largeTurn = {
      id: "turn-1",
      status: "completed",
      items: Array.from({ length: 600 }, (_, i) => ({
        id: `item-${i}`,
        type: "toolCall",
        content: "B".repeat(600)
      }))
    };
    const snapshot = {
      threadId: "thread-heavy-1",
      thread,
      turns: [largeTurn],
      pageState: { loading: false, nextCursor: "cur-abc", paginated: true },
      scrollTop: 2048
    };

    const result = normalizeDetachedTaskSnapshot(snapshot);
    expect(result.strippedTurns).toBe(true);
    expect(result.originalBytes).toBeGreaterThan(MAX_SNAPSHOT_BYTES);
    expect(result.snapshot.turns).toBeUndefined();
    expect(result.snapshot.threadId).toBe("thread-heavy-1");
    expect(result.snapshot.pageState.nextCursor).toBe("cur-abc");
    expect(result.snapshot.scrollTop).toBe(2048);
    expect(result.finalBytes).toBeLessThan(5 * 1024);
  });

  test("handles null or non-object snapshots gracefully", () => {
    expect(normalizeDetachedTaskSnapshot(null).snapshot).toBeNull();
    expect(normalizeDetachedTaskSnapshot(undefined).snapshot).toBeNull();
    expect(normalizeDetachedTaskSnapshot("invalid" as any).snapshot).toBeNull();
  });

  test("debounces broadcastDetachedTasks within 100ms window via production broadcaster", async () => {
    const sentEvents: Array<{ channel: string; data: any }> = [];
    const mockWindow = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: any) => {
          sentEvents.push({ channel, data });
        }
      }
    };

    const broadcaster = createDebouncedTaskBroadcaster(
      () => [mockWindow],
      () => ["thread-1", "thread-2"],
      100
    );

    // Rapid triggers
    for (let i = 0; i < 5; i += 1) {
      broadcaster.trigger();
      expect(broadcaster.isPending()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    // Still pending before 100ms settles
    expect(sentEvents).toHaveLength(0);

    // Wait for settle
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(broadcaster.isPending()).toBe(false);
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].channel).toBe("desktop:detached-tasks-changed");
    expect(sentEvents[0].data).toEqual(["thread-1", "thread-2"]);
  });

  test("supports canceling pending broadcasts", async () => {
    const sentEvents: any[] = [];
    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: (...args: any[]) => sentEvents.push(args) }
    };

    const broadcaster = createDebouncedTaskBroadcaster(
      () => [mockWindow],
      () => ["thread-1"],
      100
    );

    broadcaster.trigger();
    expect(broadcaster.isPending()).toBe(true);
    broadcaster.cancel();
    expect(broadcaster.isPending()).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 130));
    expect(sentEvents).toHaveLength(0);
  });

  test("evaluates shouldLoadDetachedThreadTurns to true when snapshot turns are omitted", () => {
    const detachedThreadId = "thread-detached-123";
    const allHistoryThreads = [{ id: "thread-detached-123", title: "Existing" }];

    // Snapshot has turns (hydrated = true)
    expect(shouldLoadDetachedThreadTurns({
      detachedThreadId,
      hydrated: true,
      allHistoryThreads,
      forceHistoryRefresh: false
    })).toBe(false);

    // Snapshot omitted turns (hydrated = false) -> MUST load via RPC
    expect(shouldLoadDetachedThreadTurns({
      detachedThreadId,
      hydrated: false,
      allHistoryThreads,
      forceHistoryRefresh: false
    })).toBe(true);

    // Force refresh -> MUST load via RPC
    expect(shouldLoadDetachedThreadTurns({
      detachedThreadId,
      hydrated: true,
      allHistoryThreads,
      forceHistoryRefresh: true
    })).toBe(true);

    // Detached thread not yet in allHistoryThreads -> MUST load via RPC
    expect(shouldLoadDetachedThreadTurns({
      detachedThreadId,
      hydrated: true,
      allHistoryThreads: [],
      forceHistoryRefresh: false
    })).toBe(true);

    // No detached thread -> false
    expect(shouldLoadDetachedThreadTurns({
      detachedThreadId: null,
      hydrated: false,
      allHistoryThreads,
      forceHistoryRefresh: false
    })).toBe(false);
  });
});
