import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiniFileHistory, shouldRouteToMiniBackend } from "../../backends/mini/src/runtime/miniFileHistory.ts";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";

/**
 * Regression: mini threads with a history file but no runtime metadata
 * (created before cliBackend persistence, or mislabeled `codex`) must still
 * reopen from the history list via the history-file fallback.
 */
test("orphan mini thread cold-restores end to end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mini-orphan-e2e-"));
  try {
    const writer = new MiniBridge({
      loadSnapshot: () => null,
      listSnapshots: () => [],
    });
    const started = await writer.request("thread/start", { ownerId: "local", cwd: "/tmp/work", model: "gpt-5-mini" }) as any;
    const threadId = started.threadId as string;
    const session = (writer as any).sessions.get(threadId);
    session.turns.push({ id: "turn-1", status: "completed", createdAt: Date.now() });
    session.messages.push({ type: "userMessage", id: "u1", turnId: "turn-1", threadId, text: "hello", status: "completed" });
    session.messages.push({ type: "agentMessage", id: "a1", turnId: "turn-1", threadId, text: "hi", status: "completed" });
    session.preview = "again";
    session.turns.push({ id: "turn-2", status: "completed", createdAt: Date.now() + 1 });
    session.messages.push({ type: "userMessage", id: "u2", turnId: "turn-2", threadId, text: "again", status: "completed" });
    session.messages.push({ type: "agentMessage", id: "a2", turnId: "turn-2", threadId, text: "hello again", status: "completed" });
    // Persist through the real file history, then drop the live session
    // (simulates a server restart): only the .md file remains, no runtime meta.
    const history = new MiniFileHistory(dir);
    history.upsert({ threadId, ownerId: "local", snapshot: { ...session } });

    // 1. routing with NO stored metadata + file exists -> mini
    expect(shouldRouteToMiniBackend({
      paramCliBackend: undefined,
      storedCliBackend: undefined,
      threadId,
      ownerId: "local",
      historyExists: (o, t) => history.exists(o, t),
      hasSession: () => false,
    })).toBe(true);
    // 2. mislabeled `codex` metadata + file exists -> mini
    expect(shouldRouteToMiniBackend({
      paramCliBackend: undefined,
      storedCliBackend: "codex",
      threadId,
      ownerId: "local",
      historyExists: (o, t) => history.exists(o, t),
      hasSession: () => false,
    })).toBe(true);

    // 3. cold restore through a fresh bridge wired as in index.ts
    const cold = new MiniBridge({
      loadMetadata: (tid: string) => history.getMetadata("local", tid),
      loadSnapshot: (tid: string, ownerId = "local") => {
        const rec = history.get(ownerId, tid);
        if (!rec?.stateJson) return null;
        try {
          return JSON.parse(rec.stateJson);
        } catch {
          return null;
        }
      },
      listSnapshots: () => [],
    });
    expect(cold.hasSession(threadId)).toBe(false);
    const read = await cold.request("thread/read", { threadId, includeTurns: false }) as any;
    expect(read.thread?.cliBackend).toBe("mini");
    expect(read.thread?.historyMode).toBe("paginated");
    expect(read.thread?.preview).toBe("again");
    expect(read.items).toHaveLength(0);
    expect(read.thread.turns).toHaveLength(0);
    const turns = await cold.request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc" }) as any;
    expect(turns.turns).toHaveLength(1);
    expect(turns.nextCursor).toBe("turn-2");
    expect(turns.turns[0].id).toBe("turn-2");
    expect(turns.turns[0].items).toHaveLength(2);
    const older = await cold.request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", cursor: turns.nextCursor }) as any;
    expect(older.turns.map((turn: any) => turn.id)).toEqual(["turn-1"]);
    expect(older.nextCursor).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
