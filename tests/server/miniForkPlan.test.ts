import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MiniBridge,
  extractUserInputAnswer,
  type MiniSnapshot,
} from "../../backends/mini/src/runtime/miniBridge.ts";

function threadIdOf(result: unknown): string {
  const rec = result as Record<string, unknown>;
  const thread = rec.thread as Record<string, unknown>;
  return String(thread.id ?? rec.threadId ?? "");
}

describe("mini P0-3: thread/fork", () => {
  test("missing thread and bad turn fail loudly", async () => {
    const bridge = new MiniBridge();
    await expect(bridge.request("thread/fork", {})).rejects.toThrow("threadId");
    await expect(bridge.request("thread/fork", { threadId: "no-such-thread" })).rejects.toThrow("thread not found");
  });

  test("fork copies transcript, honors lastTurnId and overrides", async () => {
    const persisted: MiniSnapshot[] = [];
    const store = {
      onSnapshot: (snap: MiniSnapshot) => {
        const copy = JSON.parse(JSON.stringify(snap)) as MiniSnapshot;
        const idx = persisted.findIndex((s) => s.threadId === copy.threadId);
        if (idx >= 0) persisted[idx] = copy;
        else persisted.push(copy);
      },
      loadSnapshot: (threadId: string) => persisted.find((s) => s.threadId === threadId) ?? null,
    };
    const setup = new MiniBridge(store);
    const cwd = mkdtempSync(join(tmpdir(), "mini-fork-"));
    try {
      const started = await setup.request("thread/start", {
        cwd,
        ownerId: "local",
        model: "fork-model",
        sandbox: "read-only",
      });
      const parentId = threadIdOf(started);

      // Seed two turns with messages in the persisted copy, then fork from a
      // fresh bridge so the parent is restored from disk (offline-safe and
      // closer to the real resume path than poking live memory).
      const snap = persisted.find((s) => s.threadId === parentId)!;
      snap.turns = [
        { id: "turn-1", status: "completed", createdAt: Date.now() },
        { id: "turn-2", status: "completed", createdAt: Date.now() },
      ];
      snap.messages = [
        { type: "userMessage", id: "u1", turnId: "turn-1", threadId: parentId, text: "first" },
        { type: "agentMessage", id: "a1", turnId: "turn-1", threadId: parentId, text: "reply one" },
        { type: "userMessage", id: "u2", turnId: "turn-2", threadId: parentId, text: "second" },
        { type: "agentMessage", id: "a2", turnId: "turn-2", threadId: parentId, text: "reply two" },
      ] as unknown as MiniSnapshot["messages"];
      const bridge = new MiniBridge(store);

      // Full fork: everything copied under a new id, parent untouched.
      const full = (await bridge.request("thread/fork", { threadId: parentId, ownerId: "local" })) as {
        thread: { id: string; model: string; sandbox: string | null };
        threadId: string;
      };
      expect(full.threadId).toBeTruthy();
      expect(full.threadId).not.toBe(parentId);
      expect(full.thread.model).toBe("fork-model");
      expect(full.thread.sandbox).toBe("read-only");

      const fullRead = (await bridge.request("thread/read", { threadId: full.threadId, ownerId: "local" })) as {
        thread: { turns: Array<{ id: string }> };
        items: unknown[];
      };
      expect(fullRead.thread.turns.map((t) => t.id)).toEqual(["turn-1", "turn-2"]);
      expect(fullRead.items.length).toBe(4);

      // Partial fork through turn-1: later turns/messages dropped.
      const partial = (await bridge.request("thread/fork", {
        threadId: parentId,
        ownerId: "local",
        lastTurnId: "turn-1",
        model: "other-model",
      })) as { thread: { id: string; model: string } };
      const partialRead = (await bridge.request("thread/read", {
        threadId: partial.thread.id,
        ownerId: "local",
      })) as { thread: { turns: Array<{ id: string }> }; items: unknown[] };
      expect(partialRead.thread.turns.map((t) => t.id)).toEqual(["turn-1"]);
      expect(partialRead.items.length).toBe(2);
      expect(partial.thread.model).toBe("other-model");

      // Unknown turn id fails loudly.
      await expect(
        bridge.request("thread/fork", { threadId: parentId, ownerId: "local", lastTurnId: "nope" }),
      ).rejects.toThrow("turn not found");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("fork refuses live in-progress turns", async () => {
    const bridge = new MiniBridge({ loadSnapshot: () => null });
    const started = (await bridge.request("thread/start", { ownerId: "local", cwd: tmpdir() })) as { threadId: string };
    const parentId = started.threadId;
    const session = (bridge as any).sessions.get(parentId);
    session.turns.push({ id: "live-turn", status: "inProgress", createdAt: Date.now() });
    session.messages.push({ type: "userMessage", id: "u", turnId: "live-turn", threadId: parentId, text: "hi" });
    session.activeTurnId = "live-turn"; // genuinely running: fork must refuse
    await expect(
      bridge.request("thread/fork", { threadId: parentId, ownerId: "local", lastTurnId: "live-turn" }),
    ).rejects.toThrow("in-progress turn");
  });

  test("fork proceeds after cold-restored orphan heals", async () => {
    const stuck: MiniSnapshot = {
      threadId: "stuck-parent",
      ownerId: "local",
      cwd: tmpdir(),
      turns: [{ id: "live-turn", status: "inProgress", createdAt: Date.now() }],
      messages: [{ type: "userMessage", id: "u", turnId: "live-turn", threadId: "stuck-parent", text: "hi" }],
    };
    const bridge = new MiniBridge({ loadSnapshot: () => stuck });
    // No live turn owns the restored snapshot, so the orphan settles to
    // `interrupted` on restore and fork is allowed through it.
    const forked = (await bridge.request("thread/fork", {
      threadId: "stuck-parent",
      ownerId: "local",
      lastTurnId: "live-turn",
    })) as { threadId: string };
    expect(typeof forked.threadId).toBe("string");
    const read = (await bridge.request("thread/read", {
      threadId: "stuck-parent",
      ownerId: "local",
      includeTurns: true,
    })) as { thread: { turns: Array<{ id: string; status: string }> } };
    expect(read.thread.turns.find((t) => t.id === "live-turn")?.status).toBe("interrupted");
  });
});

describe("mini P0-3: plan/respond chain (already wired, pinned by test)", () => {
  test("extractUserInputAnswer understands planAnswers shape", () => {
    expect(extractUserInputAnswer({ answers: { q1: { answers: ["Minimal", "user_note: extra"] } } })).toBe(
      "Minimal, extra",
    );
    expect(extractUserInputAnswer({ decision: "go" })).toBe("go");
    expect(extractUserInputAnswer(undefined)).toBe("");
  });

  test("server request -> respond resolves the pending turn question", async () => {
    const bridge = new MiniBridge();
    const serverRequests: Array<{ id: string | number; method: string }> = [];
    bridge.on("message", (msg: unknown) => {
      const m = msg as { id: string | number; method: string };
      if (m && typeof m === "object" && "id" in m) serverRequests.push({ id: m.id, method: m.method });
    });

    const pending = bridge.handleMiniRequestUserInput(
      { threadId: "plan-thread" } as never,
      "turn-1",
      { questions: [{ id: "choice", question: "Pick one", options: ["Minimal", "Full"] }] },
    );
    // Let the emit land.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(serverRequests.length).toBe(1);
    expect(serverRequests[0]!.method).toBe("item/tool/requestUserInput");
    expect(bridge.hasPendingUserInput(String(serverRequests[0]!.id))).toBe(true);

    // This is exactly what POST /api/codex/plan/respond funnels into
    // (respondToCodexServerRequest -> pendingMiniServerRequests -> respond).
    bridge.respond(serverRequests[0]!.id, { answers: { choice: { answers: ["Minimal"] } } });
    await expect(pending).resolves.toContain("Minimal");
    expect(bridge.hasPendingUserInput(String(serverRequests[0]!.id))).toBe(false);
    bridge.stop();
  });

  test("respond on unknown ids is a safe no-op", () => {
    const bridge = new MiniBridge();
    expect(() => bridge.respond("missing-id", { ok: true })).not.toThrow();
    expect(bridge.hasPendingUserInput("missing-id")).toBe(false);
    bridge.stop();
  });
});
