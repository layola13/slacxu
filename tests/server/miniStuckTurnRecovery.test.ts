import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiniFileHistory } from "../../backends/mini/src/runtime/miniFileHistory.ts";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";

/**
 * Regression: a mini turn stuck `inProgress` after an upstream 502-retry
 * abort / reload / restart must not brick the thread forever.
 * - cold restore heals orphaned `inProgress` turns to `interrupted`
 * - `turn/interrupt` settles an orphan even with no live `activeTurnId`
 * - `turn/start` releases a stale slot pointing at an already-settled turn
 */
function coldBridge(history: MiniFileHistory) {
  return new MiniBridge({
    loadSnapshot: (tid: string, ownerId = "local") => {
      const rec = history.get(ownerId, tid);
      if (!rec?.stateJson) return null;
      try {
        return JSON.parse(rec.stateJson);
      } catch {
        return null;
      }
    },
    onSnapshot: (snap: any) => {
      history.upsert({ threadId: snap.threadId, ownerId: snap.ownerId ?? "local", snapshot: snap });
    },
    listSnapshots: () => [],
  });
}

test("cold restore heals orphaned inProgress turn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mini-stuck-restore-"));
  try {
    const history = new MiniFileHistory(dir);
    const writer = new MiniBridge({ loadSnapshot: () => null, listSnapshots: () => [] });
    const started = (await writer.request("thread/start", { ownerId: "local", cwd: "/tmp/work", model: "gpt-5-mini" })) as any;
    const threadId = started.threadId as string;
    const session = (writer as any).sessions.get(threadId);
    session.turns.push({ id: "turn-stuck", status: "inProgress", createdAt: Date.now() });
    session.messages.push({ type: "userMessage", id: "u-stuck", turnId: "turn-stuck", threadId, text: "hello", status: "completed" });
    history.upsert({ threadId, ownerId: "local", snapshot: { ...session } });

    const cold = coldBridge(history);
    const read = (await cold.request("thread/read", { threadId, includeTurns: true })) as any;
    const turn = read.thread.turns.find((t: any) => t.id === "turn-stuck");
    expect(turn?.status).toBe("interrupted");
    expect(read.thread.status?.type).toBe("idle");
    // Healed snapshot is persisted so a reload stops spinning too.
    const rec = history.get("local", threadId);
    expect(rec?.stateJson).toContain("interrupted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("turn/interrupt settles orphan with no live activeTurnId", async () => {
  const bridge = new MiniBridge({ loadSnapshot: () => null, listSnapshots: () => [] });
  const started = (await bridge.request("thread/start", { ownerId: "local", cwd: "/tmp/work", model: "gpt-5-mini" })) as any;
  const threadId = started.threadId as string;
  const session = (bridge as any).sessions.get(threadId);
  session.turns.push({ id: "turn-orphan", status: "inProgress", createdAt: Date.now() });
  session.messages.push({ type: "userMessage", id: "u-orphan", turnId: "turn-orphan", threadId, text: "hi", status: "completed" });
  expect(session.activeTurnId).toBeUndefined();

  const res = (await bridge.request("turn/interrupt", { threadId, turnId: "turn-orphan" })) as any;
  expect(res?.ok).toBe(true);
  expect(session.turns.find((t: any) => t.id === "turn-orphan")?.status).toBe("interrupted");
});

test("turn/start releases stale slot pointing at settled turn", async () => {
  const bridge = new MiniBridge({ loadSnapshot: () => null, listSnapshots: () => [] });
  const started = (await bridge.request("thread/start", { ownerId: "local", cwd: "/tmp/work", model: "gpt-5-mini" })) as any;
  const threadId = started.threadId as string;
  const session = (bridge as any).sessions.get(threadId);
  session.turns.push({ id: "turn-done", status: "completed", createdAt: Date.now() });
  session.activeTurnId = "turn-done"; // stale slot: turn settled, slot never released

  // Must NOT throw "Turn is already active".
  const res = (await bridge.request("turn/start", { threadId, prompt: "hello again" })) as any;
  expect(res?.turnId).toBeString();
  expect(res.turnId).not.toBe("turn-done");
});

async function staleSlotBridge(status: string) {
  const bridge = new MiniBridge({ loadSnapshot: () => null, listSnapshots: () => [] });
  const started = (await bridge.request("thread/start", { ownerId: "local", cwd: "/tmp/work", model: "gpt-5-mini" })) as any;
  const threadId = started.threadId as string;
  const session = (bridge as any).sessions.get(threadId);
  session.turns.push({ id: "turn-slot", status, createdAt: Date.now() });
  session.activeTurnId = "turn-slot";
  return { bridge, threadId, session };
}

test("review/start releases stale slot pointing at settled turn", async () => {
  const { bridge, threadId, session } = await staleSlotBridge("failed");
  await bridge.request("review/start", { threadId, target: { type: "uncommittedChanges" } });
  expect(session.activeTurnId).not.toBe("turn-slot");
});

test("thread/compact/start releases stale slot pointing at settled turn", async () => {
  const { bridge, threadId, session } = await staleSlotBridge("interrupted");
  await bridge.request("thread/compact/start", { threadId });
  expect(session.activeTurnId).not.toBe("turn-slot");
});

test("turn/interrupt settles orphan referenced by stale activeTurnId with no live loop", async () => {
  const { bridge, threadId, session } = await staleSlotBridge("inProgress");
  const res = (await bridge.request("turn/interrupt", { threadId, turnId: "turn-slot" })) as any;
  expect(res?.ok).toBe(true);
  expect(session.turns.find((t: any) => t.id === "turn-slot")?.status).toBe("interrupted");
  expect(session.activeTurnId).toBeUndefined();
});

test("live inProgress slot still blocks review and compact", async () => {
  const { bridge, threadId } = await staleSlotBridge("inProgress");
  await expect(bridge.request("review/start", { threadId, target: { type: "uncommittedChanges" } })).rejects.toThrow("Turn is already active");
  await expect(bridge.request("thread/compact/start", { threadId })).rejects.toThrow("Cannot compact while a turn is running");
});
