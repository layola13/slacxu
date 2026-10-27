import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the code under test
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  OpencodeBridge,
  OPENCODE_OFFICIAL_PROVIDER_ID,
  buildOpencodeOfficialProvider,
} from "../../backends/opencode/src/runtime/opencodeBridge";
import { inferOpencodeModelLimits } from "../../backends/opencode/src/runtime/opencodeCompatibleProcessManager";

describe("opencodeBridge", () => {
  test("buildOpencodeOfficialProvider creates v1/v2 groups without default/free groups", () => {
    const provider = buildOpencodeOfficialProvider();
    expect(provider.id).toBe(OPENCODE_OFFICIAL_PROVIDER_ID);
    expect(provider.name).toBe("OpenCode 本地");
    expect(provider.groups.map((g) => g.id)).toEqual(["v1", "v2"]);
    expect(provider.groups[0]?.name).toBe("OpenCode v1");
    expect(provider.groups[1]?.name).toBe("OpenCode v2");
    expect(provider.defaultModel).toBe(provider.groups[0]?.models[0]);
    expect(provider.serviceProvider.id).toBe("opencode");
  });

  test("buildOpencodeOfficialProvider splits v1 and v2 live models", () => {
    const v1Models = ["opencode/big-pickle", "myapi/claude-sonnet-4.6"];
    const v2Models = ["opencode-go/gpt-6-luna", "opencode/claude-haiku-5-5"];
    const provider = buildOpencodeOfficialProvider(v1Models, v2Models);
    expect(provider.id).toBe(OPENCODE_OFFICIAL_PROVIDER_ID);
    expect(provider.defaultModel).toBe("opencode/big-pickle");
    expect(provider.nativeModels).toEqual([...v1Models, ...v2Models]);
    expect(provider.groups[0]?.id).toBe("v1");
    expect(provider.groups[0]?.models).toEqual(v1Models);
    expect(provider.groups[1]?.id).toBe("v2");
    expect(provider.groups[1]?.models).toEqual(v2Models);
  });

  test("buildOpencodeOfficialProvider falls back per generation when a binary is missing", () => {
    const provider = buildOpencodeOfficialProvider([], ["opencode-go/gpt-6-luna"]);
    expect(provider.groups[0]?.id).toBe("v1");
    expect(provider.groups[0]?.models).toContain("opencode/big-pickle");
    expect(provider.groups[1]?.models).toEqual(["opencode-go/gpt-6-luna"]);
  });

  test("OpencodeBridge implements lifecycle methods and manages session state", async () => {
    const bridge = new OpencodeBridge();
    const status = bridge.getStatus();
    expect(status.phase).toBe("ready");
    expect(status.transport).toBe("stdio");

    // thread/start
    const startRes = (await bridge.request("thread/start", { model: "default" })) as any;
    expect(startRes.threadId).toBeDefined();
    const threadId = startRes.threadId;

    expect(bridge.hasSession(threadId)).toBe(true);

    // thread/read
    const readRes = (await bridge.request("thread/read", { threadId })) as any;
    expect(readRes.thread.id).toBe(threadId);
    expect(readRes.thread.cliBackend).toBe("opencode");
    expect(readRes.thread.model).toBe("default");

    // thread/delete
    await bridge.request("thread/delete", { threadId });
    expect(bridge.hasSession(threadId)).toBe(false);
  });

  test("thread/read includeTurns:false serves metadata without parsing the full snapshot", async () => {
    // Loads the sanitized replica of the real stuck history
    // (tests/server/fixtures/opencode-giant-snapshot.json): one 224KB giant
    // tool-output message inside a ~1.1MB snapshot (489 messages). The
    // metadata RPC must stay volume-independent so the 18% stage can't hit
    // the 8s timeout. Fixture is checked in so any machine reproduces it.
    const giantSnapshot = (await import("./fixtures/opencode-giant-snapshot.json")).default as any;
    expect(giantSnapshot.messages).toHaveLength(489);
    expect(String(giantSnapshot.messages[0].text).length).toBeGreaterThan(224 * 1024);
    let snapshotCalls = 0;
    const bridge = new OpencodeBridge({
      loadSnapshot: () => {
        snapshotCalls += 1;
        return giantSnapshot;
      },
      loadMetadata: (threadId) => ({ threadId, sessionId: "ses_opencode_1", model: "heavy-model", cwd: "/heavy" }),
    });

    const meta = (await bridge.request("thread/read", { threadId: "restored-1", includeTurns: false })) as any;
    expect(meta.thread.id).toBe("restored-1");
    expect(meta.thread.sessionId).toBe("ses_opencode_1");
    expect(meta.thread.model).toBe("heavy-model");
    expect(meta.thread.cwd).toBe("/heavy");
    expect(meta.thread.cliBackend).toBe("opencode");
    expect(meta.thread.turns).toEqual([]);
    expect(meta.items).toEqual([]);
    expect(meta.thread.messages).toBeUndefined();
    // Metadata response stays tiny regardless of snapshot volume.
    expect(JSON.stringify(meta).length).toBeLessThan(10 * 1024);
    // Proof the 18% metadata RPC no longer touches state_json.
    expect(snapshotCalls).toBe(0);

    // Full reads still restore the snapshot as before.
    const full = (await bridge.request("thread/read", { threadId: "restored-1", includeTurns: true })) as any;
    expect(snapshotCalls).toBe(1);
    expect(full.thread.messages).toHaveLength(489);
    expect(String(full.thread.messages[0].text).length).toBeGreaterThan(224 * 1024);
  });

  test("thread/read includeTurns:false falls through to snapshot when metadata misses", async () => {
    const bridge = new OpencodeBridge({
      loadSnapshot: (threadId) => ({
        threadId,
        model: "fallback-model",
        cwd: "/fallback",
        turns: [],
        messages: [],
      }),
      loadMetadata: () => null,
    });

    const meta = (await bridge.request("thread/read", { threadId: "restored-2", includeTurns: false })) as any;
    expect(meta.thread.id).toBe("restored-2");
    expect(meta.thread.model).toBe("fallback-model");
    expect(meta.thread.turns).toEqual([]);
  });

  test("handles turn/start request, user message recording, and snapshots", async () => {
    let capturedSnapshot: any = null;
    const bridge = new OpencodeBridge({
      onSnapshot: (snap) => {
        capturedSnapshot = snap;
      },
    });

    const startRes = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "default",
    })) as any;
    const threadId = startRes.threadId;

    const turnRes = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Hello OpenCode!" }],
    })) as any;

    expect(turnRes.turn).toBeDefined();
    expect(turnRes.turn.status).toBe("inProgress");
    expect(typeof turnRes.turnId).toBe("string");

    expect(capturedSnapshot).toBeDefined();
    expect(capturedSnapshot.threadId).toBe(threadId);
    expect(capturedSnapshot.preview).toBe("Hello OpenCode!");
    expect(capturedSnapshot.messages.length).toBe(1);

    // Read back
    const readRes = (await bridge.request("thread/read", { threadId })) as any;
    expect(readRes.thread.id).toBe(threadId);
    expect(readRes.thread.cliBackend).toBe("opencode");
    expect(readRes.thread.messages.length).toBe(1);
    expect(readRes.thread.messages[0].text).toBe("Hello OpenCode!");
    expect(readRes.thread.messages[0].role).toBe("user");
    expect(readRes.thread.messages[0].type).toBe("userMessage");
    expect(readRes.thread.turns.length).toBe(1);
    expect(readRes.thread.turns[0].items.length).toBe(1);
    expect(readRes.thread.turns[0].items[0].type).toBe("userMessage");
    expect(readRes.items.length).toBe(1);
  });

  test("late terminal notifications do not clear a newer active turn", async () => {
    const bridge = new OpencodeBridge();
    const start = (await bridge.request("thread/start", { cwd: process.cwd() })) as any;
    const session = (bridge as any).sessions.get(start.threadId);
    const handlers: Record<string, (value: any) => void> = {};
    session.turns.push(
      { id: "old-completed", status: "inProgress", createdAt: Date.now() },
      { id: "old-failed", status: "inProgress", createdAt: Date.now() },
      { id: "old-interrupted", status: "inProgress", createdAt: Date.now() },
      { id: "new-active", status: "inProgress", createdAt: Date.now() },
    );
    session.activeTurnId = "new-active";

    (bridge as any).wireRuntimeEvents(session, {
      on: (event: string, handler: (value: any) => void) => { handlers[event] = handler; },
    });

    for (const method of ["turn/completed", "turn/failed", "turn/interrupted"]) {
      const turnId = method === "turn/completed" ? "old-completed"
        : method === "turn/failed" ? "old-failed" : "old-interrupted";
      handlers.notification({ method, params: { threadId: start.threadId, turnId } });
      expect(session.activeTurnId).toBe("new-active");
    }

    expect(session.turns.find((turn: any) => turn.id === "old-completed").status).toBe("completed");
    expect(session.turns.find((turn: any) => turn.id === "old-failed").status).toBe("failed");
    expect(session.turns.find((turn: any) => turn.id === "old-interrupted").status).toBe("interrupted");
  });

  test("turn/start 回环拒绝: ultra-forward + opencode-* 模型", async () => {
    const bridge = new OpencodeBridge({
      resolveRelayTarget: async (_providerId, _groupId, model) => ({
        baseUrl: "http://127.0.0.1:43121/v1",
        targetModel: model || "opencode/muse-spark-1.3",
      }),
    });
    const start = (await bridge.request("thread/start", { cwd: process.cwd() })) as any;
    await expect(
      bridge.request("turn/start", {
        threadId: start.threadId,
        providerId: "ultra-forward",
        model: "opencode-opencode-local-default-opencode/muse-spark-1.3",
        prompt: "hello",
      })
    ).rejects.toThrow("回环拒绝");
  });

  test("respond method handles permission decisions correctly", async () => {
    const bridge = new OpencodeBridge();
    // Does not throw when responding to unknown id or without session
    expect(() => {
      bridge.respond("req-1", { decision: "accept" });
      bridge.respond("req-2", { decision: "decline" });
      bridge.respond("req-3", { decision: "always" });
      bridge.respond("req-4", { decision: "acceptForSession" });
      bridge.respond("req-5", { decision: "approved_for_session" });
    }).not.toThrow();

    // Verify targeted routing and acceptForSession -> always
    const start1 = (await bridge.request("thread/start", { cwd: process.cwd() })) as any;
    const start2 = (await bridge.request("thread/start", { cwd: process.cwd() })) as any;

    const replies1: Array<{ id: string; reply: string }> = [];
    const replies2: Array<{ id: string; reply: string }> = [];

    const sess1 = (bridge as any).sessions.get(start1.threadId);
    const sess2 = (bridge as any).sessions.get(start2.threadId);

    sess1.runtime = {
      replyPermission: async (id: string, reply: string) => { replies1.push({ id, reply }); return true; },
      respondToQuestionRequest: () => false,
      hasPendingQuestion: () => false,
      on: () => {},
    };
    sess2.runtime = {
      replyPermission: async (id: string, reply: string) => { replies2.push({ id, reply }); return true; },
      respondToQuestionRequest: () => false,
      hasPendingQuestion: () => false,
      on: () => {},
    };

    // Register a request specifically owned by session 1
    (bridge as any).pendingRequestOwners.set("req-perm-s1", sess1);

    // Respond with acceptForSession
    bridge.respond("req-perm-s1", { decision: "acceptForSession" });

    // Must be mapped to "always" and delivered ONLY to session 1
    expect(replies1).toEqual([{ id: "req-perm-s1", reply: "always" }]);
    expect(replies2).toEqual([]);
  });

  test("thread/turns/list and thread/compact/start work correctly", async () => {
    const bridge = new OpencodeBridge();
    const notifications: any[] = [];
    bridge.on("notification", (notif) => notifications.push(notif));

    const startRes = (await bridge.request("thread/start", { model: "default" })) as any;
    const threadId = startRes.threadId;

    const turnsRes = (await bridge.request("thread/turns/list", { threadId })) as any;
    expect(Array.isArray(turnsRes.turns)).toBe(true);

    const compactRes = (await bridge.request("thread/compact/start", { threadId })) as any;
    expect(compactRes.turn?.status).toBe("inProgress");
    expect(typeof compactRes.turn?.id).toBe("string");
    expect(compactRes.turnId).toBe(compactRes.turn?.id);

    // Verify turn/started and item/started notifications
    expect(notifications.some((n) => n.method === "turn/started" && n.params?.turnId === compactRes.turnId)).toBe(true);
    expect(notifications.some((n) => n.method === "item/started" && n.params?.item?.type === "contextCompaction")).toBe(true);
  });

  test("thread/turns/list honors limit/cursor/summary for live sessions", async () => {
    const bridge = new OpencodeBridge();
    const startRes = (await bridge.request("thread/start", { cwd: process.cwd() })) as any;
    const threadId = startRes.threadId;
    for (let i = 0; i < 3; i += 1) {
      await bridge.request("turn/start", {
        threadId,
        input: [{ type: "text", text: `question ${i}` }],
      });
    }
    const p1 = (await bridge.request("thread/turns/list", { threadId, limit: 2 })) as any;
    expect(p1.data).toHaveLength(2);
    expect(p1.nextCursor).toBe(p1.data[1].id);
    expect(p1.data[0].itemsView).toBe("summary");
    // Summary keeps only user + last assistant, not the full transcript.
    for (const turn of p1.data) {
      expect(turn.items.length).toBeLessThanOrEqual(2);
    }
    const p2 = (await bridge.request("thread/turns/list", {
      threadId,
      limit: 2,
      cursor: p1.nextCursor,
    })) as any;
    expect(p2.data).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    // Full view still returns everything on the page.
    const full = (await bridge.request("thread/turns/list", {
      threadId,
      limit: 10,
      itemsView: "full",
    })) as any;
    expect(full.data).toHaveLength(3);
    expect(full.nextCursor).toBeNull();
    // Metadata-only read carries no transcript (history-open fast path).
    const meta = (await bridge.request("thread/read", { threadId, includeTurns: false })) as any;
    expect(meta.thread.turns).toEqual([]);
    expect(meta.thread.messages).toEqual([]);
    expect(meta.items).toEqual([]);
  });

  test("turn/start emits user notifications and groups A->B->A turns in order", async () => {
    const bridge = new OpencodeBridge();
    const notifications: any[] = [];
    bridge.on("notification", (notif: any) => {
      notifications.push(notif);
    });

    const startRes = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "default",
    })) as any;
    const threadId = startRes.threadId;

    const turn1 = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "first question" }],
    })) as any;
    expect(typeof turn1.turnId).toBe("string");

    const turn2 = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "second question" }],
    })) as any;
    expect(typeof turn2.turnId).toBe("string");
    expect(turn2.turnId).not.toBe(turn1.turnId);

    const userNotifs = notifications.filter(
      (n) => n.method === "item/completed" && (n.params as any)?.item?.type === "userMessage"
    );
    expect(userNotifs.length).toBe(2);
    expect(userNotifs[0].params.turnId).toBe(turn1.turnId);
    expect(userNotifs[1].params.turnId).toBe(turn2.turnId);

    const readRes = (await bridge.request("thread/read", { threadId })) as any;
    expect(readRes.thread.turns.length).toBe(2);
    expect(readRes.thread.turns[0].id).toBe(turn1.turnId);
    expect(readRes.thread.turns[1].id).toBe(turn2.turnId);
    expect(readRes.thread.turns[0].items.map((i: any) => i.type)).toEqual(["userMessage"]);
    expect(readRes.thread.turns[1].items.map((i: any) => i.type)).toEqual(["userMessage"]);
    expect(readRes.thread.turns[0].items[0].text).toBe("first question");
    expect(readRes.thread.turns[1].items[0].text).toBe("second question");

    const listRes = (await bridge.request("thread/turns/list", { threadId })) as any;
    expect(Array.isArray(listRes.data)).toBe(true);
    expect(listRes.data.length).toBe(2);
    expect(listRes.data[0].items[0].type).toBe("userMessage");
    expect(typeof listRes.data[0].startedAt).toBe("number");
  });

  test("turn/start falls back to prompt string and preserves attachments", async () => {
    const bridge = new OpencodeBridge();
    const startRes = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "default",
    })) as any;
    const threadId = startRes.threadId;

    await bridge.request("turn/start", {
      threadId,
      prompt: "  hello via prompt  ",
    });
    const readRes = (await bridge.request("thread/read", { threadId })) as any;
    expect(readRes.thread.turns[0].items[0].text).toBe("hello via prompt");
  });

  test("thread/compact/start executes summarize and settles turn and item notifications", async () => {
    const bridge = new OpencodeBridge();
    const notifications: any[] = [];
    bridge.on("notification", (notif) => notifications.push(notif));

    const startRes = (await bridge.request("thread/start", { model: "default" })) as any;
    const threadId = startRes.threadId;

    // Mock runtime.summarize to simulate successful server-side compaction
    const session = (bridge as any).sessions.get(threadId);
    let summarizeCalled = false;
    let summarizeOptions: any = null;
    session.runtime = {
      summarize: async (opts: any) => {
        summarizeCalled = true;
        summarizeOptions = opts;
        return true;
      },
      on: () => {},
      updateConfig: () => {},
    };

    const compactRes = (await bridge.request("thread/compact/start", {
      threadId,
      providerId: "codex-relay",
      model: "claude-3-5-sonnet",
    })) as any;

    expect(compactRes.turn?.status).toBe("inProgress");
    expect(compactRes.turnId).toBeDefined();

    // Allow async runCompaction to settle
    await new Promise((r) => setTimeout(r, 20));

    expect(summarizeCalled).toBe(true);
    expect(summarizeOptions).toEqual({
      providerID: "codex-relay",
      modelID: "claude-3-5-sonnet",
    });

    // Check terminal notifications
    const completedNotif = notifications.find(
      (n) => n.method === "turn/completed" && n.params?.turnId === compactRes.turnId
    );
    expect(completedNotif).toBeDefined();
    expect(completedNotif.params.turn.status).toBe("completed");

    const itemCompleted = notifications.find(
      (n) => n.method === "item/completed" && n.params?.item?.type === "contextCompaction"
    );
    expect(itemCompleted).toBeDefined();
    expect(itemCompleted.params.item.status).toBe("completed");

    // Session is no longer active
    expect(session.activeTurnId).toBeUndefined();
    expect(session.turns.find((t: any) => t.id === compactRes.turnId)?.status).toBe("completed");
  });

  test("thread/start and thread/read preserve name, parentThreadId, and additionalRoots", async () => {
    let capturedSnapshot: any = null;
    const bridge = new OpencodeBridge({
      onSnapshot: (snap) => {
        capturedSnapshot = snap;
      },
    });

    const startRes = (await bridge.request("thread/start", {
      name: "Custom OpenCode Task",
      parentThreadId: "parent-uuid-1",
      additionalRoots: ["D:/extra/root1"],
      model: "default",
      providerId: "opencode-local",
      groupId: "default",
    })) as any;

    expect(startRes.thread.name).toBe("Custom OpenCode Task");
    expect(startRes.thread.parentThreadId).toBe("parent-uuid-1");
    expect(startRes.thread.additionalRoots).toEqual(["D:/extra/root1"]);
    expect(startRes.thread.cliBackend).toBe("opencode");

    expect(capturedSnapshot).toBeDefined();
    expect(capturedSnapshot.name).toBe("Custom OpenCode Task");
    expect(capturedSnapshot.parentThreadId).toBe("parent-uuid-1");
    expect(capturedSnapshot.additionalRoots).toEqual(["D:/extra/root1"]);

    const readRes = (await bridge.request("thread/read", { threadId: startRes.threadId })) as any;
    expect(readRes.thread.name).toBe("Custom OpenCode Task");
    expect(readRes.thread.parentThreadId).toBe("parent-uuid-1");
    expect(readRes.thread.additionalRoots).toEqual(["D:/extra/root1"]);
    expect(readRes.thread.providerId).toBe("opencode-local");
    expect(readRes.thread.groupId).toBe("default");
  });

  test("thread/name/set renames live and restored sessions and updates snapshots", async () => {
    let lastSnapshot: any = null;
    const bridge = new OpencodeBridge({
      onSnapshot: (snap) => {
        lastSnapshot = snap;
      },
    });

    const startRes = (await bridge.request("thread/start", { model: "default" })) as any;
    const threadId = startRes.threadId;

    const renameRes = (await bridge.request("thread/name/set", {
      threadId,
      name: "Renamed Project Chat",
    })) as any;
    expect(renameRes.ok).toBe(true);

    expect(lastSnapshot.name).toBe("Renamed Project Chat");
    expect(lastSnapshot.preview).toBe("Renamed Project Chat");

    const readRes = (await bridge.request("thread/read", { threadId })) as any;
    expect(readRes.thread.name).toBe("Renamed Project Chat");
    expect(readRes.thread.title).toBe("Renamed Project Chat");
    expect(readRes.thread.preview).toBe("Renamed Project Chat");
  });

  test("thread/list returns live and restored sessions while filtering child threads", async () => {
    const bridge = new OpencodeBridge({
      listSnapshots: () => [
        {
          threadId: "snap-root",
          sessionId: "snap-root",
          name: "Restored Root",
          cwd: "D:/projects/demo",
          model: "default",
          turns: [],
          messages: [{ type: "userMessage", text: "Hello" }],
        },
        {
          threadId: "snap-child",
          parentThreadId: "snap-root",
          cwd: "D:/projects/demo",
          model: "default",
          turns: [],
          messages: [],
        },
      ],
    });

    // Create live root and live child
    await bridge.request("thread/start", { name: "Live Root" });
    await bridge.request("thread/start", { name: "Live Child", parentThreadId: "some-parent" });

    const listRes = (await bridge.request("thread/list", {})) as any;
    expect(Array.isArray(listRes.threads)).toBe(true);
    const ids = listRes.threads.map((t: any) => t.id);

    // Root sessions should be included
    expect(ids).toContain("snap-root");
    const snapRoot = listRes.threads.find((t: any) => t.id === "snap-root");
    expect(snapRoot.name).toBe("Restored Root");
    expect(snapRoot.cliBackend).toBe("opencode");

    // Child sessions should be filtered out of top-level listing
    expect(ids).not.toContain("snap-child");
    const liveChild = listRes.threads.find((t: any) => t.name === "Live Child");
    expect(liveChild).toBeUndefined();
  });

  test("thread/list includes native child sessions with parentThreadId (tab second source)", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-native-"));
    const dbPath = join(dir, "opencode.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, model TEXT, time_created INTEGER, time_updated INTEGER, parent_id TEXT, agent TEXT, time_archived INTEGER)");
    db.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER)");
    db.exec("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT, time_created INTEGER)");
    const now = Date.now();
    db.prepare("INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?)").run("ses_parent_t", "Parent", "/tmp", null, now, now, null, null, null);
    db.prepare("INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?)").run("ses_kid_t", "Child", "/tmp", null, now, now, "ses_parent_t", "general", null);
    db.close();
    const prev = process.env.OPENCODE_DB;
    process.env.OPENCODE_DB = dbPath;
    try {
      const bridge = new OpencodeBridge({});
      return bridge.request("thread/list", {}).then((listRes: any) => {
        const threads = listRes.threads as any[];
        const kid = threads.find((t) => t.id === "ses_kid_t");
        expect(kid).toBeDefined();
        expect(kid.parentThreadId).toBe("ses_parent_t");
        expect(kid.agentRole).toBe("general");
        // Top-level parent still listed exactly once.
        expect(threads.filter((t) => t.id === "ses_parent_t")).toHaveLength(1);
      });
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_DB;
      else process.env.OPENCODE_DB = prev;
    }
  });

  test("thread/list partitions restored snapshots by API generation (v1/v2 icons stay distinct)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-gen-partition-"));
    const dbPath = join(dir, "opencode.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, model TEXT, time_created INTEGER, time_updated INTEGER, parent_id TEXT, agent TEXT, time_archived INTEGER)");
    db.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER)");
    db.exec("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT, time_created INTEGER)");
    db.close();
    const snapshots = [
      { threadId: "t-v1", cwd: "/tmp", model: "opencode/big-pickle", apiVersion: 1, turns: [], messages: [] },
      { threadId: "t-v2", cwd: "/tmp", model: "opencode-go/gpt-6-luna", apiVersion: 2, turns: [], messages: [] },
      { threadId: "t-legacy", cwd: "/tmp", model: "default", turns: [], messages: [] },
    ] as const;
    const prev = process.env.OPENCODE_DB;
    process.env.OPENCODE_DB = dbPath;
    try {
      const v1 = new OpencodeBridge({ listSnapshots: () => [...snapshots] });
      const v1Res = (await v1.request("thread/list", {})) as any;
      const v1Ids = (v1Res.threads as any[]).map((t) => t.id);
      expect(v1Ids).toContain("t-v1");
      expect(v1Ids).toContain("t-legacy");
      expect(v1Ids).not.toContain("t-v2");
      for (const t of (v1Res.threads as any[]).filter((t) => t.id === "t-v1" || t.id === "t-legacy")) {
        expect(t.cliBackend).toBe("opencode");
      }
      const v2 = new OpencodeBridge({ opencodeApiVersion: 2, listSnapshots: () => [...snapshots] });
      const v2Res = (await v2.request("thread/list", {})) as any;
      const v2Ids = (v2Res.threads as any[]).map((t) => t.id);
      expect(v2Ids).toEqual(["t-v2"]);
      expect(v2Res.threads[0].cliBackend).toBe("opencode-v2");
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_DB;
      else process.env.OPENCODE_DB = prev;
    }
  });

  test("inferOpencodeModelLimits respects relay contextWindow, capability, and Muse Spark 1M default", () => {
    // 1. Explicit relay group contextWindow wins
    const explicit = inferOpencodeModelLimits("muse-spark-1.3-contributor-free", 500_000);
    expect(explicit.context).toBe(500_000);

    // 2. Model capability descriptor wins if present
    const withCap = inferOpencodeModelLimits("custom-model", null, { contextWindow: 300_000 });
    expect(withCap.context).toBe(300_000);

    // 3. Known variant suffix [1m] wins
    const variant = inferOpencodeModelLimits("custom-model[1m]");
    expect(variant.context).toBe(1_000_000);

    // 4. Muse Spark inherits the shared 1M default, including provider-prefixed ids.
    const generic = inferOpencodeModelLimits("opencode/muse-spark-1.3-contributor-free");
    expect(generic.context).toBe(1_000_000);
    expect(inferOpencodeModelLimits("muse-spark-1.3-contributor").context).toBe(1_000_000);
    expect(inferOpencodeModelLimits("muse-spark-1.3-contributor[1m]").context).toBe(1_000_000);
    expect(inferOpencodeModelLimits("custom-model").context).toBe(128_000);

    // 5. Zen free tier defaults to 1M, except big-pickle which stays 200K.
    expect(inferOpencodeModelLimits("opencode/beam-free").context).toBe(1_000_000);
    expect(inferOpencodeModelLimits("opencode/deepseek-v4.1-flash-free").context).toBe(1_000_000);
    expect(inferOpencodeModelLimits("opencode/mimo-v2.6-flash-free").context).toBe(1_000_000);
    expect(inferOpencodeModelLimits("opencode/big-pickle").context).toBe(200_000);
    expect(inferOpencodeModelLimits("opencode/big-pickle").output).toBe(8_192);
  });
});
