import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

import {
  isNativeOpencodeSessionId,
  listNativeOpencodeThreads,
  listNativeOpencodeTurns,
  nativeOpencodeFileInfo,
  readNativeOpencodeTail,
  readNativeOpencodeThread,
} from "../../backends/opencode/src/runtime/opencodeHistoryProjection.js";
import { OpencodeBridge } from "../../backends/opencode/src/runtime/opencodeBridge.js";

const SESSION_ID = "ses_testhistory0000000000000001";
const ARCHIVED_ID = "ses_testhistory0000000000000002";
const DEFAULT_TITLE_ID = "ses_testhistory0000000000000003";

// Per-test timeout so a wedged fixture DB fails fast instead of hanging the suite.
const TEST_TIMEOUT_MS = 30_000;

let fixtureHome = "";
let previousTestHome: string | undefined;

function openFixtureDb() {
  const { Database } = require("bun:sqlite") as { Database: new (path: string) => any };
  return new Database(join(fixtureHome, "opencode", "opencode.db")) as {
    exec: (sql: string) => void;
    run: (sql: string, ...args: unknown[]) => void;
    close: () => void;
  };
}

function seedFixture() {
  const { mkdirSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(join(fixtureHome, "opencode"), { recursive: true });
  const db = openFixtureDb();
  try {
    db.exec(`CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      time_archived INTEGER,
      parent_id TEXT,
      agent TEXT
    )`);
    db.exec(`CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER,
      data TEXT NOT NULL
    )`);
    db.exec(`CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER,
      data TEXT NOT NULL
    )`);

    const model = JSON.stringify({ id: "big-pickle", providerID: "opencode", variant: "default" });
    db.run(
      "INSERT INTO session (id, project_id, directory, title, model, time_created, time_updated, time_archived, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      SESSION_ID, "proj_1", "D:/projects/demo", "Demo native session", model, 1789706000000, 1789706100000, null, null,
    );
    db.run(
      "INSERT INTO session (id, project_id, directory, title, model, time_created, time_updated, time_archived, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ARCHIVED_ID, "proj_1", "D:/projects/demo", "Archived session", model, 1789705000000, 1789705001000, 1789705002000, null,
    );
    db.run(
      "INSERT INTO session (id, project_id, directory, title, model, time_created, time_updated, time_archived, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      DEFAULT_TITLE_ID, "proj_1", "D:/projects/demo", "Session abc123", model, 1789706200000, 1789706201000, null, null,
    );

    // Main session: one user message + one assistant message (text + tool).
    db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
      "msg_user1", SESSION_ID, 1789706001000,
      JSON.stringify({ role: "user", time: { created: 1789706001000 }, agent: "build" }));
    db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
      "prt_user1", "msg_user1", SESSION_ID, 1789706001000,
      JSON.stringify({ type: "text", text: "hello native history" }));
    db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
      "msg_asst1", SESSION_ID, 1789706002000,
      JSON.stringify({ role: "assistant", time: { created: 1789706002000, completed: 1789706003000 }, agent: "build" }));
    db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
      "prt_asst_text", "msg_asst1", SESSION_ID, 1789706002100,
      JSON.stringify({ type: "text", text: "hi there" }));
    db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
      "prt_asst_tool", "msg_asst1", SESSION_ID, 1789706002200,
      JSON.stringify({ type: "tool", callID: "call_1", tool: "read", state: { status: "completed", input: { filePath: "x" }, output: "ok" } }));

    // Default-titled session: preview must fall back to the first user text.
    db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
      "msg_fallback_user", DEFAULT_TITLE_ID, 1789706200100,
      JSON.stringify({ role: "user", time: { created: 1789706200100 }, agent: "build" }));
    db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
      "prt_fallback", "msg_fallback_user", DEFAULT_TITLE_ID, 1789706200100,
      JSON.stringify({ type: "text", text: "fallback preview text here" }));
  } finally {
    db.close();
  }
}

beforeEach(() => {
  previousTestHome = process.env.OPENCODE_TEST_HOME;
  fixtureHome = mkdtempSync(join(tmpdir(), "opencode-native-test-"));
  process.env.OPENCODE_TEST_HOME = fixtureHome;
  // XDG overrides would escape the fixture; neutralize for hermetic tests.
  delete process.env.XDG_DATA_HOME;
  seedFixture();
});

afterEach(() => {
  if (previousTestHome === undefined) delete process.env.OPENCODE_TEST_HOME;
  else process.env.OPENCODE_TEST_HOME = previousTestHome;
  if (fixtureHome) rmSync(fixtureHome, { recursive: true, force: true });
});

describe("opencode native history projection", () => {
  test("isNativeOpencodeSessionId matches ses_* ids only", () => {
    expect(isNativeOpencodeSessionId("ses_abc123")).toBe(true);
    expect(isNativeOpencodeSessionId("  ses_abc123  ")).toBe(true);
    expect(isNativeOpencodeSessionId("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
    expect(isNativeOpencodeSessionId("")).toBe(false);
  }, TEST_TIMEOUT_MS);

  test("listNativeOpencodeThreads returns catalog entries without archived sessions", () => {
    const threads = listNativeOpencodeThreads(200);
    const byId = new Map(threads.map((t) => [String((t as Record<string, unknown>).id), t]));
    expect(byId.has(SESSION_ID)).toBe(true);
    expect(byId.has(ARCHIVED_ID)).toBe(false);
    const entry = byId.get(SESSION_ID) as Record<string, unknown>;
    expect(entry.cliBackend).toBe("opencode");
    expect(entry.preview).toBe("Demo native session");
    expect(entry.cwd).toBe("D:/projects/demo");
    expect(entry.model).toBe("opencode/big-pickle");
    expect(entry.status).toEqual({ type: "notLoaded" });
    // Default title falls back to the first user message text.
    expect(String((byId.get(DEFAULT_TITLE_ID) as Record<string, unknown>).preview)).toBe("fallback preview text here");
  }, TEST_TIMEOUT_MS);

  test("readNativeOpencodeThread metadata omits turns when includeTurns=false", () => {
    const read = readNativeOpencodeThread(SESSION_ID, { includeTurns: false })!;
    expect(read).not.toBeNull();
    expect((read.thread as Record<string, unknown>).cliBackend).toBe("opencode");
    expect(((read.thread as Record<string, unknown>).turns ?? []) as unknown[]).toEqual([]);
    expect(read.items).toEqual([]);
  }, TEST_TIMEOUT_MS);

  test("readNativeOpencodeThread projects user/assistant/tool items into one turn", () => {
    const read = readNativeOpencodeThread(SESSION_ID, { includeTurns: true })!;
    const thread = read.thread as Record<string, unknown>;
    const turns = thread.turns as Array<{ id: string; status: string; items: Array<{ type: string }> }>;
    expect(turns.length).toBe(1);
    expect(turns[0]!.status).toBe("completed");
    const types = turns[0]!.items.map((i) => i.type).sort();
    expect(types).toEqual(["agentMessage", "toolCall", "userMessage"]);
    expect(read.tail.truncated).toBe(false);
    expect(thread.preview).toBe("hello native history");
  }, TEST_TIMEOUT_MS);

  test("readNativeOpencodeThread returns null for unknown sessions", () => {
    expect(readNativeOpencodeThread("ses_doesnotexist00000000000", { includeTurns: true })).toBeNull();
  }, TEST_TIMEOUT_MS);

  test("huge texts/tool outputs are clipped for history replay (thread/read 15s)", () => {
    const bigId = "ses_bighistory00000000000001";
    const bigUser = "u".repeat(60_000);
    const bigOutput = "o".repeat(50_000);
    const db = openFixtureDb();
    try {
      const model = JSON.stringify({ id: "big-pickle", providerID: "opencode", variant: "default" });
      db.run(
        "INSERT INTO session (id, project_id, directory, title, model, time_created, time_updated, time_archived, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        bigId, "proj_1", "D:/projects/demo", "Big session", model, 1789709000000, 1789709100000, null, null,
      );
      db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
        "msg_big_user", bigId, 1789709001000,
        JSON.stringify({ role: "user", time: { created: 1789709001000 }, agent: "build" }));
      db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
        "prt_big_user", "msg_big_user", bigId, 1789709001000,
        JSON.stringify({ type: "text", text: bigUser }));
      db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
        "msg_big_asst", bigId, 1789709002000,
        JSON.stringify({ role: "assistant", time: { created: 1789709002000, completed: 1789709003000 }, agent: "build" }));
      db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
        "prt_big_tool", "msg_big_asst", bigId, 1789709002100,
        JSON.stringify({ type: "tool", callID: "call_big", tool: "bash", state: { status: "completed", input: { command: "clone" }, output: bigOutput } }));
    } finally {
      db.close();
    }
    const read = readNativeOpencodeThread(bigId, { includeTurns: true })!;
    const items = read.items as Array<Record<string, unknown>>;
    const user = items.find((i) => i.type === "userMessage")!;
    const tool = items.find((i) => i.type === "toolCall")!;
    expect(String(user.text).length).toBeLessThan(bigUser.length);
    expect(String(user.text)).toContain("原文共 60000 字符");
    expect(String(tool.output).length).toBeLessThan(bigOutput.length);
    expect(String(tool.output)).toContain("原文共 50000 字符");
    // 回放载荷有界: 60k+50k 原文必须压到 KB 级。
    expect(JSON.stringify(read.items).length).toBeLessThan(100_000);
  }, TEST_TIMEOUT_MS);

  test("listNativeOpencodeTurns paginates and summarizes", () => {
    const page = listNativeOpencodeTurns(SESSION_ID, { limit: 32, cursor: null, sortDirection: "desc", itemsView: "summary" })!;
    expect(page.nextCursor).toBeNull();
    expect(page.data.length).toBe(1);
    // Summary keeps user + last assistant only (tool row dropped).
    expect(page.data[0]!.items.map((i) => String((i as Record<string, unknown>).type)).sort()).toEqual(["agentMessage", "userMessage"]);
    const full = listNativeOpencodeTurns(SESSION_ID, { limit: 32, cursor: null, itemsView: "full" })!;
    expect(full.data[0]!.items.length).toBe(3);
  }, TEST_TIMEOUT_MS);

  test("readNativeOpencodeThread advertises paginated history", () => {
    const read = readNativeOpencodeThread(SESSION_ID, { includeTurns: false })!;
    // Paginated mode routes web history opens through thread/turns/list
    // (newest 32-turn page) instead of the legacy full-read/tail path that
    // froze restores on long sessions.
    expect((read.thread as Record<string, unknown>).historyMode).toBe("paginated");
    const full = readNativeOpencodeThread(SESSION_ID, { includeTurns: true })!;
    expect((full.thread as Record<string, unknown>).historyMode).toBe("paginated");
  }, TEST_TIMEOUT_MS);

  test("listNativeOpencodeTurns pages along turn boundaries without overlap", () => {
    const pagedId = "ses_pagedturns00000000000001";
    const turns = 12;
    const base = 1789710000000;
    const db = openFixtureDb();
    try {
      const model = JSON.stringify({ id: "big-pickle", providerID: "opencode", variant: "default" });
      db.run(
        "INSERT INTO session (id, project_id, directory, title, model, time_created, time_updated, time_archived, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        pagedId, "proj_1", "D:/projects/demo", "Paged session", model, base, base + 100000, null, null,
      );
      for (let i = 0; i < turns; i += 1) {
        const t = base + i * 1000;
        db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
          `msg_page_u${i}`, pagedId, t, JSON.stringify({ role: "user", time: { created: t }, agent: "build" }));
        db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
          `prt_page_u${i}`, `msg_page_u${i}`, pagedId, t, JSON.stringify({ type: "text", text: `question ${i}` }));
        db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
          `msg_page_a${i}`, pagedId, t + 500, JSON.stringify({ role: "assistant", time: { created: t + 500, completed: t + 600 }, agent: "build" }));
        db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
          `prt_page_a${i}`, `msg_page_a${i}`, pagedId, t + 500, JSON.stringify({ type: "text", text: `answer ${i}` }));
      }
    } finally {
      db.close();
    }
    const userText = (turn: { items: Array<Record<string, unknown>> }) =>
      String(turn.items.find((i) => i.type === "userMessage")?.text ?? "");
    const page1 = listNativeOpencodeTurns(pagedId, { limit: 5, cursor: null, sortDirection: "desc", itemsView: "full" })!;
    expect(page1.data.map((t) => userText(t as { items: Array<Record<string, unknown>> }))).toEqual(
      ["question 11", "question 10", "question 9", "question 8", "question 7"],
    );
    expect(page1.nextCursor).toBeTruthy();
    const page2 = listNativeOpencodeTurns(pagedId, { limit: 5, cursor: page1.nextCursor, sortDirection: "desc", itemsView: "full" })!;
    expect(page2.data.map((t) => userText(t as { items: Array<Record<string, unknown>> }))).toEqual(
      ["question 6", "question 5", "question 4", "question 3", "question 2"],
    );
    expect(page2.nextCursor).toBeTruthy();
    const page3 = listNativeOpencodeTurns(pagedId, { limit: 5, cursor: page2.nextCursor, sortDirection: "desc", itemsView: "full" })!;
    expect(page3.data.map((t) => userText(t as { items: Array<Record<string, unknown>> }))).toEqual(
      ["question 1", "question 0"],
    );
    expect(page3.nextCursor).toBeNull();
  }, TEST_TIMEOUT_MS);

  test("listNativeOpencodeTurns caps scanning on a single giant turn", () => {
    const giantId = "ses_giantturn00000000000001";
    const base = 1789720000000;
    const db = openFixtureDb();
    try {
      const model = JSON.stringify({ id: "big-pickle", providerID: "opencode", variant: "default" });
      db.run(
        "INSERT INTO session (id, project_id, directory, title, model, time_created, time_updated, time_archived, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        giantId, "proj_1", "D:/projects/demo", "Giant turn", model, base, base + 100000, null, null,
      );
      db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
        "msg_giant_u", giantId, base, JSON.stringify({ role: "user", time: { created: base }, agent: "build" }));
      db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
        "prt_giant_u", "msg_giant_u", giantId, base, JSON.stringify({ type: "text", text: "go" }));
      for (let i = 0; i < 300; i += 1) {
        db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
          `msg_giant_a${i}`, giantId, base + 100 + i, JSON.stringify({ role: "assistant", time: { created: base + 100 + i }, agent: "build" }));
        db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
          `prt_giant_a${i}`, `msg_giant_a${i}`, giantId, base + 100 + i, JSON.stringify({ type: "text", text: `step ${i}` }));
      }
    } finally {
      db.close();
    }
    const page = listNativeOpencodeTurns(giantId, { limit: 5, cursor: null, sortDirection: "desc", itemsView: "full" })!;
    expect(page.data.length).toBe(1);
    expect(page.nextCursor).toBeNull();
  }, TEST_TIMEOUT_MS);

  test("nativeOpencodeFileInfo and readNativeOpencodeTail expose the backing store", () => {
    const info = nativeOpencodeFileInfo(SESSION_ID)!;
    expect(info.sessionId).toBe(SESSION_ID);
    expect(info.path.endsWith("opencode.db")).toBe(true);
    expect(info.sizeBytes).toBeGreaterThan(0);
    const tail = readNativeOpencodeTail(SESSION_ID)!;
    expect(((tail.thread as Record<string, unknown>).turns ?? []) as unknown[]).toHaveLength(1);
    expect((tail.tail as Record<string, unknown>).truncated).toBe(false);
  }, TEST_TIMEOUT_MS);

  test("large native sessions truncate to the bounded window", () => {    const db = openFixtureDb();
    try {
      const base = 1789707000000;
      for (let i = 0; i < 250; i += 1) {
        const mid = `msg_bulk_${i}`;
        db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
          mid, SESSION_ID, base + i * 1000, JSON.stringify({ role: "user", time: { created: base + i * 1000 } }));
        db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
          `prt_bulk_${i}`, mid, SESSION_ID, base + i * 1000, JSON.stringify({ type: "text", text: `bulk ${i}` }));
      }
    } finally {
      db.close();
    }
    const read = readNativeOpencodeThread(SESSION_ID, { includeTurns: true, maxMessages: 200 })!;
    expect(read.tail.truncated).toBe(true);
    expect(read.tail.loadedMessages).toBe(200);
    expect(read.tail.totalMessages).toBe(252);
  }, TEST_TIMEOUT_MS);

  test("user-message subtask parts project child linkage and timestamps", () => {
    const parent = "ses_subtaskparent00000000001";
    const child = "ses_subtaskchild000000000001";
    const db = openFixtureDb();
    try {
      const model = JSON.stringify({ id: "big-pickle", providerID: "opencode", variant: "default" });
      db.run(
        "INSERT INTO session (id, project_id, directory, title, model, time_created, time_updated, time_archived, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        parent, "proj_1", "D:/projects/demo", "Subtask parent", model, 1789708000000, 1789708100000, null, null,
      );
      db.run(
        "INSERT INTO session (id, project_id, directory, title, model, time_created, time_updated, time_archived, parent_id, agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        child, "proj_1", "D:/projects/demo", "Subtask child", model, 1789708001000, 1789708002000, null, parent, "explore",
      );
      db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
        "msg_sub_user", parent, 1789708000100,
        JSON.stringify({ role: "user", time: { created: 1789708000100 }, agent: "build" }));
      db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
        "prt_sub_user", "msg_sub_user", parent, 1789708000100,
        JSON.stringify({ type: "text", text: "run a subtask" }));
      db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
        "prt_sub_task", "msg_sub_user", parent, 1789708000200,
        JSON.stringify({ type: "subtask", agent: "explore", description: "Inspect repo", prompt: "find files", childSessionID: child }));
    } finally {
      db.close();
    }
    const read = readNativeOpencodeThread(parent, { includeTurns: true })!;
    const turns = (read.thread as Record<string, unknown>).turns as Array<{ items: Array<Record<string, unknown>> }>;
    const collab = turns.flatMap((t) => t.items).find((i) => i.type === "collabAgentToolCall");
    expect(collab).toBeDefined();
    expect(collab!.agentThreadId).toBe(child);
    expect(collab!.receiverThreadIds).toEqual([child]);
    expect(typeof collab!.startedAt).toBe("number");
    expect(typeof collab!.completedAt).toBe("number");
  }, TEST_TIMEOUT_MS);
});

describe("opencodeBridge native history fallback", () => {
  test("thread/read, turns/list, fileInfo and tail serve native sessions read-only", async () => {
    const bridge = new OpencodeBridge();
    const threadId = SESSION_ID;

    const read = (await bridge.request("thread/read", { threadId, includeTurns: true })) as any;
    expect(read.thread.cliBackend).toBe("opencode");
    expect(read.thread.id).toBe(threadId);
    expect(Array.isArray(read.thread.turns)).toBe(true);
    expect(read.thread.turns.length).toBe(1);
    // Read-only: nothing materialized in the bridge or snapshot store.
    expect(bridge.hasSession(threadId)).toBe(false);

    const meta = (await bridge.request("thread/read", { threadId, includeTurns: false })) as any;
    expect(meta.thread.turns).toEqual([]);

    const page = (await bridge.request("thread/turns/list", { threadId, limit: 32 })) as any;
    expect(Array.isArray(page.data)).toBe(true);
    expect(page.data.length).toBe(1);

    const info = (await bridge.request("thread/history/fileInfo", { threadId })) as any;
    expect(info.sessionId).toBe(threadId);
    expect(info.sizeBytes).toBeGreaterThan(0);

    const tail = (await bridge.request("thread/history/tail", { threadId })) as any;
    expect(Array.isArray(tail.thread.turns)).toBe(true);
    expect(tail.thread.turns.length).toBe(1);
  }, TEST_TIMEOUT_MS);

  test("thread/resume materializes a native session so follow-up turns can start", async () => {
    const snapshots: unknown[] = [];
    const bridge = new OpencodeBridge({ onSnapshot: (snap) => snapshots.push(snap) });
    const threadId = SESSION_ID;

    const resumed = (await bridge.request("thread/resume", { threadId })) as any;
    expect(resumed.thread.id).toBe(threadId);
    expect(resumed.thread.turns.length).toBe(1);
    expect(bridge.hasSession(threadId)).toBe(true);
    expect(snapshots.length).toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);

  test("unknown thread ids keep the previous empty-thread behavior", async () => {
    const bridge = new OpencodeBridge();
    const read = (await bridge.request("thread/read", { threadId: "nope-not-a-session" })) as any;
    expect(read.thread.turns).toEqual([]);
    expect(read.items).toEqual([]);
  }, TEST_TIMEOUT_MS);

  test("top-level titled native sessions are not labeled as sidechat", () => {
    const list = listNativeOpencodeThreads(200);
    const top = list.find((t) => t.id === SESSION_ID);
    expect(top).toBeDefined();
    expect(top?.name).toBe("Demo native session");
    expect(top?.title).toBe("Demo native session");
    // agentNickname drives the 侧聊 chip; only real agent sessions may set it.
    expect((top as any)?.agentNickname).toBeUndefined();
    expect((top as any)?.agentRole).toBeUndefined();
  }, TEST_TIMEOUT_MS);

  test("listNativeOpencodeThreads filters out child sessions by default and sets name/title", () => {
    const db = openFixtureDb();
    const CHILD_ID = "ses_testhistorychild00000000001";
    try {
      db.run(
        "INSERT INTO session (id, project_id, directory, title, model, time_created, time_updated, time_archived, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        CHILD_ID, "proj_1", "D:/projects/demo", "Child Subtask", null, 1789706300000, 1789706301000, null, SESSION_ID,
      );
    } finally {
      db.close();
    }

    // By default, child sessions should be filtered out
    const defaultList = listNativeOpencodeThreads(200);
    const childDefault = defaultList.find((t) => t.id === CHILD_ID);
    expect(childDefault).toBeUndefined();

    // When explicitly requesting subagents, child session is included
    const fullList = listNativeOpencodeThreads({ limit: 200, includeSubagents: true });
    const childFull = fullList.find((t) => t.id === CHILD_ID);
    expect(childFull).toBeDefined();
    expect(childFull?.parentThreadId).toBe(SESSION_ID);
    expect(childFull?.name).toBe("Child Subtask");
    expect(childFull?.title).toBe("Child Subtask");

    // readNativeOpencodeThread preserves parentThreadId and custom title
    const childRead = readNativeOpencodeThread(CHILD_ID, { includeTurns: false })!;
    expect(childRead).not.toBeNull();
    expect((childRead.thread as any).parentThreadId).toBe(SESSION_ID);
    expect((childRead.thread as any).name).toBe("Child Subtask");
    expect((childRead.thread as any).title).toBe("Child Subtask");
  }, TEST_TIMEOUT_MS);

  test("projects tool: task parts in assistant history to collabAgentToolCall items", () => {
    const db = openFixtureDb();
    const SUBAGENT_SESSION_ID = "ses_testhistorychild00000000002";
    try {
      // 1. Insert child session
      db.run(
        "INSERT INTO session (id, project_id, directory, title, model, time_created, time_updated, time_archived, parent_id, agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        SUBAGENT_SESSION_ID, "proj_1", "D:/projects/demo", "Code Review Subagent", null, 1789706400000, 1789706401000, null, SESSION_ID, "reviewer",
      );
      // 2. Insert assistant task tool call part
      db.run(
        "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
        "prt_asst_task", "msg_asst1", SESSION_ID, 1789706002300,
        JSON.stringify({
          type: "tool",
          callID: "call_task_history_1",
          tool: "task",
          state: {
            status: "completed",
            input: {
              subagent_type: "reviewer",
              description: "Review implementation",
              prompt: "Check code changes for bugs",
            },
            metadata: {
              sessionId: SUBAGENT_SESSION_ID,
            },
            output: `<task id="${SUBAGENT_SESSION_ID}" state="completed"><task_result>No bugs found</task_result></task>`,
          },
        }),
      );
    } finally {
      db.close();
    }

    const read = readNativeOpencodeThread(SESSION_ID, { includeTurns: true })!;
    expect(read).not.toBeNull();
    const collabItem = read.items.find((item: any) => item.type === "collabAgentToolCall") as any;
    expect(collabItem).toBeDefined();
    expect(collabItem).toMatchObject({
      type: "collabAgentToolCall",
      tool: "task",
      status: "completed",
      agentRole: "reviewer",
      agentName: "Review implementation",
      agentThreadId: SUBAGENT_SESSION_ID,
      receiverThreadIds: [SUBAGENT_SESSION_ID],
      prompt: "Check code changes for bugs",
      agentsStates: {
        [SUBAGENT_SESSION_ID]: {
          status: "completed",
          message: "Review implementation",
        },
      },
    });

    // Check child session thread metadata
    const childRead = readNativeOpencodeThread(SUBAGENT_SESSION_ID, { includeTurns: false })!;
    expect(childRead).not.toBeNull();
    expect((childRead.thread as any).parentThreadId).toBe(SESSION_ID);
    expect((childRead.thread as any).agentRole).toBe("reviewer");
  }, TEST_TIMEOUT_MS);
});
