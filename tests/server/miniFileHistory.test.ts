import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MiniFileHistory,
  extractMiniStateJson,
  migrateMiniSqliteHistory,
  miniHistoryDisplayTitle,
  parseMiniFrontmatter,
  renderMiniHistoryFile,
  shouldRouteToMiniBackend,
  type MiniBackendRouteOptions,
  type MiniHistorySnapshot,
} from "../../backends/mini/src/runtime/miniFileHistory.ts";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";

function scratch(): { dir: string; history: MiniFileHistory; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "mini-history-"));
  return {
    dir,
    history: new MiniFileHistory(dir),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function snapshot(threadId: string, ownerId = "local"): MiniHistorySnapshot {
  return {
    threadId,
    ownerId,
    cwd: "/tmp/work",
    model: "gpt-5-mini",
    providerId: "deepkey",
    groupId: "default",
    preview: "hello world",
    effort: "high",
    turns: [{ id: "turn-1", status: "completed", createdAt: 1700000000000 }],
    messages: [
      { type: "userMessage", id: "u1", turnId: "turn-1", threadId, text: "hello world", status: "completed" },
      { type: "agentMessage", id: "a1", turnId: "turn-1", threadId, text: "hi there", status: "completed" },
      { type: "toolCall", id: "t1", turnId: "turn-1", threadId, name: "sa_vm", arguments: "{}", output: "ok", status: "completed" },
    ],
  };
}

describe("mini file history", () => {
  test("upsert writes a readable md file and round-trips the snapshot", () => {
    const { dir, history, cleanup } = scratch();
    try {
      const rec = history.upsert({ threadId: "thread-1", ownerId: "local", snapshot: snapshot("thread-1") });
      expect(rec.threadId).toBe("thread-1");
      expect(rec.model).toBe("gpt-5-mini");
      const text = readFileSync(join(dir, "thread-1.md"), "utf8");
      expect(text).toContain("thread: \"thread-1\"");
      expect(text).toContain("# hello world");
      expect(text).toContain("### User");
      expect(text).toContain("### Assistant");
      expect(text).toContain("### Tool: sa_vm");
      const stateJson = extractMiniStateJson(text);
      expect(stateJson).toBe(rec.stateJson);
      const back = history.get("local", "thread-1");
      expect(back?.stateJson).toBe(rec.stateJson);
      // Second upsert preserves createdAt.
      const again = history.upsert({ threadId: "thread-1", ownerId: "local", snapshot: snapshot("thread-1") });
      expect(again.createdAt).toBe(rec.createdAt);
    } finally {
      cleanup();
    }
  });

  test("listByOwner filters owners and sorts by recency", () => {
    const { history, cleanup } = scratch();
    try {
      history.upsert({ threadId: "aaa", ownerId: "local", snapshot: snapshot("aaa") });
      history.upsert({ threadId: "zzz", ownerId: "local", snapshot: { ...snapshot("zzz"), preview: "second" } });
      history.upsert({ threadId: "other", ownerId: "member-1", snapshot: snapshot("other", "member-1") });
      const listed = history.listByOwner("local").map((r) => r.threadId);
      expect(listed).toContain("aaa");
      expect(listed).toContain("zzz");
      expect(listed).not.toContain("other");
      // updatedAt is monotonic (same-ms writes may tie, so only assert order).
      const recs = history.listByOwner("local");
      const byId = new Map(recs.map((r) => [r.threadId, r] as const));
      expect(byId.get("zzz")!.updatedAt).toBeGreaterThanOrEqual(byId.get("aaa")!.updatedAt);
      expect(history.findByThreadId("other")?.ownerId).toBe("member-1");
      expect(history.get("local", "other")).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("listForOwner keeps legacy local history visible after login", () => {
    const { history, cleanup } = scratch();
    try {
      history.upsert({ threadId: "legacy-local", ownerId: "local", snapshot: snapshot("legacy-local") });
      history.upsert({ threadId: "owned", ownerId: "member-1", snapshot: snapshot("owned", "member-1") });
      history.upsert({ threadId: "same-id", ownerId: "local", snapshot: snapshot("same-id") });
      history.upsert({ threadId: "same-id", ownerId: "member-1", snapshot: snapshot("same-id", "member-1") });

      const visible = history.listForOwner("member-1");
      expect(visible.map((entry) => entry.threadId)).toEqual(expect.arrayContaining(["same-id", "owned", "legacy-local"]));
      expect(visible).toHaveLength(3);
      expect(visible.find((entry) => entry.threadId === "same-id")?.ownerId).toBe("member-1");
    } finally {
      cleanup();
    }
  });

  test("keeps same thread ids isolated across explicit owners", () => {
    const { history, cleanup } = scratch();
    try {
      history.upsert({ threadId: "same-id", ownerId: "member-a", snapshot: snapshot("same-id", "member-a") });
      history.upsert({ threadId: "same-id", ownerId: "member-b", snapshot: snapshot("same-id", "member-b") });
      expect(history.get("member-a", "same-id")?.ownerId).toBe("member-a");
      expect(history.get("member-b", "same-id")?.ownerId).toBe("member-b");
      expect(history.delete("member-a", "same-id")).toBe(true);
      expect(history.get("member-b", "same-id")?.ownerId).toBe("member-b");
    } finally {
      cleanup();
    }
  });

  test("deleteTree removes the parent plus sub-agent children", () => {
    const { dir, history, cleanup } = scratch();
    try {
      history.upsert({ threadId: "parent-1", ownerId: "local", snapshot: snapshot("parent-1") });
      history.upsert({
        threadId: "child-1",
        ownerId: "local",
        snapshot: { ...snapshot("child-1"), parentThreadId: "parent-1", taskName: "task_a" },
      });
      history.upsert({ threadId: "unrelated", ownerId: "local", snapshot: snapshot("unrelated") });
      const deleted = history.deleteTree("parent-1").sort();
      expect(deleted).toEqual(["child-1", "parent-1"]);
      expect(history.get("local", "parent-1")).toBeNull();
      expect(history.get("local", "child-1")).toBeNull();
      expect(history.get("local", "unrelated")).not.toBeNull();
      void dir;
    } finally {
      cleanup();
    }
  });

  test("deleteTree removes explicitly-owned parent plus sub-agent children", () => {
    const { dir, history, cleanup } = scratch();
    try {
      history.upsert({ threadId: "owner-parent", ownerId: "member-a", snapshot: snapshot("owner-parent", "member-a") });
      history.upsert({
        threadId: "owner-child",
        ownerId: "member-a",
        snapshot: { ...snapshot("owner-child", "member-a"), parentThreadId: "owner-parent", taskName: "task_a" },
      });
      history.upsert({ threadId: "owner-unrelated", ownerId: "member-a", snapshot: snapshot("owner-unrelated", "member-a") });
      const deleted = history.deleteTree("owner-parent").sort();
      expect(deleted).toEqual(["owner-child", "owner-parent"]);
      expect(history.get("member-a", "owner-parent")).toBeNull();
      expect(history.get("member-a", "owner-child")).toBeNull();
      expect(history.get("member-a", "owner-unrelated")).not.toBeNull();
      void dir;
    } finally {
      cleanup();
    }
  });

  test("listByOwner keeps dotted explicitly-owned files addressable", () => {
    const { history, cleanup } = scratch();
    try {
      history.upsert({ threadId: "dotted-1", ownerId: "member.a.b", snapshot: snapshot("dotted-1", "member.a.b") });
      expect(history.get("member.a.b", "dotted-1")?.ownerId).toBe("member.a.b");
      expect(history.listByOwner("member.a.b").map((r) => r.threadId)).toContain("dotted-1");
      expect(history.delete("member.a.b", "dotted-1")).toBe(true);
      expect(history.get("member.a.b", "dotted-1")).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("rename is stored and wins the display title", () => {
    const { dir, history, cleanup } = scratch();
    try {
      history.upsert({ threadId: "thread-9", ownerId: "local", snapshot: snapshot("thread-9") });
      history.upsert({
        threadId: "thread-9",
        ownerId: "local",
        snapshot: { ...snapshot("thread-9"), name: "My custom title", preview: "My custom title" },
      });
      const text = readFileSync(join(dir, "thread-9.md"), "utf8");
      expect(text).toContain("# My custom title");
      expect(parseMiniFrontmatter(text).name).toBe("My custom title");
      const rec = history.get("local", "thread-9");
      const snap = JSON.parse(rec!.stateJson!) as Record<string, unknown>;
      expect(miniHistoryDisplayTitle(snap)).toBe("My custom title");
    } finally {
      cleanup();
    }
  });

  test("unsafe thread ids are rejected", () => {
    const { history, cleanup } = scratch();
    try {
      expect(() => history.upsert({ threadId: "../evil", ownerId: "local", snapshot: snapshot("../evil") })).toThrow();
      expect(history.get("local", "../evil")).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("sqlite rows migrate once and converge the table to empty", () => {
    const { history, cleanup } = scratch();
    const rows = new Map<string, { threadId: string; ownerId: string; model: string | null; cwd: string | null; stateJson: string | null; createdAt: number }>();
    const fakeStore = {
      listAll: () => [...rows.values()],
      delete: (ownerId: string, threadId: string) => {
        rows.delete(`${ownerId}:${threadId}`);
      },
    } as never;
    const snap = snapshot("legacy-1");
    rows.set("local:legacy-1", {
      threadId: "legacy-1",
      ownerId: "local",
      model: "gpt-5-mini",
      cwd: "/tmp/work",
      stateJson: JSON.stringify(snap),
      createdAt: 1699999999000,
    });
    const first = migrateMiniSqliteHistory(fakeStore, history);
    expect(first.imported).toBe(1);
    expect(rows.size).toBe(0);
    expect(history.get("local", "legacy-1")?.createdAt).toBe(1699999999000);
    const second = migrateMiniSqliteHistory(fakeStore, history);
    expect(second.imported).toBe(0);
  });

  test("renderMiniHistoryFile stays stable without messages", () => {
    const text = renderMiniHistoryFile({ ...snapshot("empty-1"), preview: undefined, messages: [] }, 1700000000000, 1700000001000);
    expect(text).toContain("# Mini conversation");
    expect(extractMiniStateJson(text)).not.toBeNull();
  });
});

describe("mini thread/name/set", () => {
  test("does not expose an explicitly owned live session to another owner", async () => {
    const bridge = new MiniBridge({});
    const started = (await bridge.request("thread/start", { ownerId: "member-a", cwd: "/tmp/work", model: "gpt-5-mini" })) as unknown as { threadId: string };
    const threadId = started.threadId;
    const foreign = (await bridge.request("thread/read", { ownerId: "member-b", threadId })) as unknown as { items: unknown[] };
    expect(foreign.items).toEqual([]);
    const listed = (await bridge.request("thread/list", { ownerId: "member-b" })) as unknown as { threads: Array<{ id: string }> };
    expect(listed.threads.some((thread) => thread.id === threadId)).toBe(false);
    const owner = (await bridge.request("thread/read", { ownerId: "member-a", threadId })) as unknown as { thread: { id: string } };
    expect(owner.thread.id).toBe(threadId);
  });

  test("thread/read projects flat Mini messages into turn.items for history restore", async () => {
    const bridge = new MiniBridge({});
    const started = (await bridge.request("thread/start", { cwd: "/tmp/work", model: "gpt-5-mini" })) as unknown as { threadId: string };
    const threadId = started.threadId;
    const session = (bridge as unknown as { sessions: Map<string, { turns: Array<{ id: string; status: string; createdAt: number }>; messages: unknown[] }> }).sessions.get(threadId)!;
    session.turns.push({ id: "turn-1", status: "completed", createdAt: Date.now() });
    session.messages.push({ type: "userMessage", turnId: "turn-1", text: "hello" });
    const read = (await bridge.request("thread/read", { threadId })) as unknown as { thread: { turns: Array<{ id: string; items: unknown[] }> }; items: unknown[] };
    expect(read.items).toHaveLength(1);
    expect(read.thread.turns).toHaveLength(1);
    expect(read.thread.turns[0]?.items).toHaveLength(1);
  });

  test("rename persists and clear restores the first prompt", async () => {    const bridge = new MiniBridge({});
    const started = (await bridge.request("thread/start", { cwd: "/tmp/work", model: "gpt-5-mini" })) as unknown as { threadId: string };
    const threadId = started.threadId;
    await bridge.request("turn/start", { threadId, prompt: "check the login flow" });
    const renamed = (await bridge.request("thread/name/set", { threadId, name: "Login review" })) as unknown as { ok: boolean };
    expect(renamed.ok).toBe(true);
    const read = (await bridge.request("thread/read", { threadId })) as unknown as { thread: { name: string } };
    expect(read.thread.name).toBe("Login review");
    const cleared = (await bridge.request("thread/name/set", { threadId, name: "  " })) as unknown as { ok: boolean };
    expect(cleared.ok).toBe(true);
    const reread = (await bridge.request("thread/read", { threadId })) as unknown as { thread: { name: string } };
    expect(reread.thread.name).toBe("check the login flow");
    const missing = (await bridge.request("thread/name/set", { threadId: "nope", name: "x" })) as unknown as { ok: boolean };
    expect(missing.ok).toBe(false);
  });
});

describe("mini reopen routing (history-file fallback)", () => {
  const route = (overrides: Partial<MiniBackendRouteOptions>) =>
    shouldRouteToMiniBackend({
      paramCliBackend: undefined,
      storedCliBackend: undefined,
      threadId: "thread-1",
      ownerId: "local",
      historyExists: () => false,
      hasSession: () => false,
      ...overrides,
    });

  test("explicit mini param always routes to mini", () => {
    expect(route({ paramCliBackend: "mini" })).toBe(true);
    expect(route({ paramCliBackend: "mini", threadId: null })).toBe(true);
  });

  test("live session routes to mini without a history file", () => {
    expect(route({ hasSession: () => true })).toBe(true);
  });

  test("stored mini backend with history file routes to mini", () => {
    expect(route({ storedCliBackend: "mini", historyExists: () => true })).toBe(true);
    expect(route({ storedCliBackend: "mini", historyExists: () => false })).toBe(false);
  });

  test("orphan history file without runtime metadata routes to mini ( cold restart )", () => {
    // Threads created before cliBackend persistence have a .md file but no
    // thread_runtime_metadata row: reopening must still reach MiniBridge.
    expect(route({ storedCliBackend: undefined, historyExists: () => true })).toBe(true);
  });

  test("legacy codex-mislabeled mini file routes to mini", () => {
    expect(route({ storedCliBackend: "codex", historyExists: () => true })).toBe(true);
    expect(route({ storedCliBackend: "codex", historyExists: () => false })).toBe(false);
  });

  test("explicit foreign backend is never hijacked", () => {
    for (const storedCliBackend of ["claude", "agy", "grok", "pi", "opencode"]) {
      expect(route({ storedCliBackend, historyExists: () => true })).toBe(false);
    }
  });

  test("explicit codex param wins over a live Mini session or file (no silent fallback)", () => {
    // Regression: a codex thread once mis-created on the fallback Mini bridge
    // must not stick to Mini forever while the UI/metadata says codex.
    expect(route({ paramCliBackend: "codex", hasSession: () => true })).toBe(false);
    expect(route({ paramCliBackend: "codex", storedCliBackend: "codex", historyExists: () => true })).toBe(false);
    expect(route({ paramCliBackend: "codex", storedCliBackend: "mini", historyExists: () => true, hasSession: () => true })).toBe(false);
    // Explicit foreign backends are likewise never hijacked by Mini state.
    for (const paramCliBackend of ["claude", "agy", "grok", "pi", "opencode"]) {
      expect(route({ paramCliBackend, hasSession: () => true, historyExists: () => true })).toBe(false);
    }
    // Unspecified backend keeps the legacy orphan behavior.
    expect(route({ paramCliBackend: undefined, hasSession: () => true })).toBe(true);
    expect(route({ paramCliBackend: "", hasSession: () => true })).toBe(true);
  });

  test("missing thread id never routes to mini", () => {
    expect(route({ threadId: null, historyExists: () => true, hasSession: () => true })).toBe(false);
    expect(route({ threadId: "", historyExists: () => true })).toBe(false);
  });
});

describe("mini history state block survives --> in content", () => {
  test("round-trips snapshots containing --> losslessly", () => {
    const { history, cleanup } = scratch();
    try {
      const snap = snapshot("thread-arrow");
      (snap.messages as any[]).push(
        { type: "userMessage", id: "u2", turnId: "turn-1", threadId: "thread-arrow", text: "fix <!-- --> markers", status: "completed" },
        { type: "toolCall", id: "t2", turnId: "turn-1", threadId: "thread-arrow", name: "sa_vm", arguments: "{}", output: "a --> b", status: "completed" },
      );
      history.upsert({ threadId: "thread-arrow", ownerId: "local", snapshot: snap });
      const rec = history.get("local", "thread-arrow");
      expect(rec?.stateJson).not.toBeNull();
      const restored = JSON.parse(rec!.stateJson!) as MiniHistorySnapshot;
      expect(JSON.stringify(restored.messages)).toContain("fix <!-- --> markers");
      expect(JSON.stringify(restored.messages)).toContain("a --> b");
    } finally {
      cleanup();
    }
  });

  test("salvages legacy files written without --> escaping", () => {
    const { dir, history, cleanup } = scratch();
    try {
      const snap = snapshot("thread-legacy");
      (snap.messages as any[]).push(
        { type: "userMessage", id: "u9", turnId: "turn-1", threadId: "thread-legacy", text: "old <!-- --> file", status: "completed" },
      );
      // Simulate a pre-fix file: raw JSON between the markers.
      const raw = `---\nthread: "thread-legacy"\n---\n\n# Mini conversation\n\n<!--mini-state\n${JSON.stringify(snap)}\n-->\n`;
      writeFileSync(join(dir, "thread-legacy.md"), raw, "utf8");
      const rec = history.get("local", "thread-legacy");
      expect(rec?.stateJson).not.toBeNull();
      expect(JSON.stringify(JSON.parse(rec!.stateJson!))).toContain("old <!-- --> file");
    } finally {
      cleanup();
    }
  });

  test("extractMiniStateJson ignores --> inside the payload", () => {
    const payload = JSON.stringify({ text: "a --> b" });
    expect(extractMiniStateJson(`<!--mini-state\n${payload}\n-->\n`)).toBe(payload);
    expect(extractMiniStateJson("no state here")).toBeNull();
  });
});

describe("mini restart reopen (fresh bridge, same history dir)", () => {
  function wiredBridge(history: MiniFileHistory): MiniBridge {
    return new MiniBridge({
      onSnapshot: (snap) => {
        history.upsert({
          threadId: snap.threadId,
          ownerId: snap.ownerId ?? "local",
          model: snap.model ?? null,
          cwd: snap.cwd ?? null,
          snapshot: snap as MiniHistorySnapshot,
        });
      },
      loadSnapshot: (threadId: string, ownerId = "local") => {
        const record = history.get(ownerId, threadId)
          ?? (ownerId !== "local" ? history.get("local", threadId) : null);
        if (!record?.stateJson) return null;
        try {
          return JSON.parse(record.stateJson);
        } catch {
          return null;
        }
      },
      listSnapshots: (ownerId = "local") => history.listForOwner(ownerId).flatMap((record) => {
        if (!record.stateJson) return [];
        try {
          return [JSON.parse(record.stateJson)];
        } catch {
          return [];
        }
      }),
    });
  }

  test("thread/read and turns/list restore items after restart, --> intact", async () => {
    const { dir, history, cleanup } = scratch();
    try {
      const bridge1 = wiredBridge(history);
      const started = (await bridge1.request("thread/start", { cwd: process.cwd() })) as unknown as { threadId: string };
      const threadId = started.threadId;
      expect(threadId).toBeTruthy();
      // Simulate post-turn persisted state, including --> content.
      const snap = snapshot(threadId);
      (snap.messages as any[]).push(
        { type: "userMessage", id: "u2", turnId: "turn-1", threadId, text: "does <!-- --> survive restart?", status: "completed" },
      );
      history.upsert({ threadId, ownerId: "local", snapshot: snap });

      // "Restart": a fresh bridge over a fresh history handle on the same dir.
      const history2 = new MiniFileHistory(dir);
      const bridge2 = wiredBridge(history2);
      const listed = (await bridge2.request("thread/list", { ownerId: "local" })) as unknown as { threads: Array<{ id: string }> };
      expect(listed.threads.map((t) => t.id)).toContain(threadId);
      const read = (await bridge2.request("thread/read", { threadId, ownerId: "local" })) as unknown as { items: any[] };
      expect(read.items.length).toBe(4);
      expect(JSON.stringify(read.items)).toContain("does <!-- --> survive restart?");
      const turns = (await bridge2.request("thread/turns/list", { threadId, ownerId: "local" })) as unknown as { turns: Array<{ id: string; items: any[] }> };
      expect(turns.turns.length).toBe(1);
      expect(turns.turns[0]?.items.length).toBe(4);
    } finally {
      cleanup();
    }
  });
});
