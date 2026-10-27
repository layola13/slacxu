import { describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MiniBridge,
  MINI_GOAL_CONTINUATION_ITEM_TYPE,
  MINI_GOAL_CONTINUATION_MARKER,
  MINI_GOAL_USAGE_LIMIT_ERROR_RE,
  MINI_GOAL_STAGNANT_LIMIT,
  buildMiniGoalContinuationPrompt,
  miniGoalToolFingerprint,
  miniGoalTurnFingerprint,
  noteMiniGoalTurnProgress,
  historyItemToText,
  isMiniGoalContinuationMessage,
  migrateMiniLegacyContinuations,
  miniHistoryLinesFromMessages,
  type MiniSnapshot,
} from "../../backends/mini/src/runtime/miniBridge.ts";

function threadIdOf(result: unknown): string {
  const rec = result as Record<string, unknown>;
  const thread = rec.thread as Record<string, unknown>;
  return String(thread.id ?? rec.threadId ?? "");
}

/** Select the live task, not the earlier recap or a replayed user turn. */
function currentTaskText(body: any): string {
  const users = (body?.messages ?? []).filter((message: any) => message.role === "user")
    .map((message: any) => typeof message.content === "string"
      ? message.content
      : (message.content ?? []).map((part: any) => part.text ?? "").join("\n"));
  const current = users.filter((text: string) => text.startsWith("[ACTIVE USER TASK - CURRENT TURN ONLY]:"));
  const text = current.at(-1) ?? users.find((candidate: string) => candidate.includes("[Task context:"));
  expect(text).toBeDefined();
  return text ?? "";
}

/** A TCP black hole: accepts connections, never responds (hangs fetches until abort). */
async function startHangServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => {
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  expect(port).toBeGreaterThan(0);
  return { server, port };
}

/** One goal turn's items: tool reads of `paths`, plus assistant prose. */
function goalTurn(turnId: string, paths: string[], text: string): any[] {
  return [
    ...paths.map((p) => ({ type: "toolCall", turnId, name: "sa_vm", arguments: `{"action":"read_file","path":"${p}"}`, output: `content of ${p}` })),
    { type: "agentMessage", turnId, text },
  ];
}

/** Feed turns through the settle-time progress tracker; returns the blocked flag per turn. */
function trackTurns(turns: any[][]): { blocked: boolean[]; state: Record<string, any> } {
  const state: Record<string, any> = {};
  const blocked = turns.map((items, i) => {
    const id = String(items[0]?.turnId ?? `t${i}`);
    return noteMiniGoalTurnProgress(state, miniGoalTurnFingerprint(items, id), miniGoalToolFingerprint(items, id));
  });
  return { blocked, state };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("mini goal state machine", () => {
  test("goal survives a file-history round-trip", async () => {
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
    const cwd = mkdtempSync(join(tmpdir(), "mini-goal-"));
    try {
      const started = await setup.request("thread/start", { cwd, ownerId: "local" });
      const threadId = threadIdOf(started);

      const set = (await setup.request("thread/goal/set", {
        threadId,
        ownerId: "local",
        objective: "ship the widget",
        status: "active",
      })) as { goal: { objective: string; status: string } };
      expect(set.goal.objective).toBe("ship the widget");

      // Fresh bridge, same files: the /goal session is restored, not lost.
      const revived = new MiniBridge(store);
      const got = (await revived.request("thread/goal/get", { threadId, ownerId: "local" })) as {
        goal: { objective: string; status: string } | null;
      };
      expect(got.goal?.objective).toBe("ship the widget");
      expect(got.goal?.status).toBe("active");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("quota statuses round-trip and clear wipes the goal", async () => {
    const bridge = new MiniBridge();
    const cwd = mkdtempSync(join(tmpdir(), "mini-goal-status-"));
    try {
      const started = await bridge.request("thread/start", { cwd, ownerId: "local" });
      const threadId = threadIdOf(started);
      for (const status of ["paused", "usageLimited", "budget_limited", "blocked", "completed"]) {
        const set = (await bridge.request("thread/goal/set", {
          threadId,
          ownerId: "local",
          objective: "x",
          status,
        })) as { goal: { status: string } };
        expect(["paused", "usageLimited", "budgetLimited", "blocked", "complete"]).toContain(set.goal.status);
      }
      const cleared = (await bridge.request("thread/goal/clear", { threadId, ownerId: "local" })) as {
        ok: boolean;
      };
      expect(cleared.ok).toBe(true);
      const got = (await bridge.request("thread/goal/get", { threadId, ownerId: "local" })) as { goal: null };
      expect(got.goal).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("non-continuation active turns still reject a second turn/start", async () => {
    const { server, port } = await startHangServer();
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "x", protocol: "chat" }),
    });
    const cwd = mkdtempSync(join(tmpdir(), "mini-goal-busy-"));
    try {
      // providerId forces relay resolution through the stub (hanging black hole).
      const started = await bridge.request("thread/start", { cwd, ownerId: "local", providerId: "stub" });
      const threadId = threadIdOf(started);
      // Plain prompt (no slash shortcut): runMiniTurn hangs on the black hole.
      const first = bridge.request("turn/start", { threadId, ownerId: "local", prompt: "hello" });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await expect(bridge.request("turn/start", { threadId, ownerId: "local", prompt: "again" })).rejects.toThrow(
        "already active",
      );
      await bridge.request("turn/interrupt", { threadId, ownerId: "local" });
      await first;
    } finally {
      bridge.stop();
      await closeServer(server);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("continuation fragments are internal: newest-only history, legacy migration", () => {
    const cont = (turn: string, n: number) => ({
      type: MINI_GOAL_CONTINUATION_ITEM_TYPE,
      id: `mini-goal-${turn}`,
      turnId: turn,
      threadId: "t",
      text: `${MINI_GOAL_CONTINUATION_MARKER}\nContinue working toward objective (attempt ${n}/50)`,
      content: [],
      role: "user",
      status: "completed",
    });
    const legacy = (turn: string, n: number) => ({
      ...cont(turn, n),
      type: "userMessage",
      id: `mini-user-${turn}`,
    });
    const user = { type: "userMessage", id: "u1", turnId: "t0", threadId: "t", text: "real request", content: [], role: "user", status: "completed" };
    const assistant = { type: "agentMessage", id: "a1", turnId: "t0", threadId: "t", text: "real answer with plenty of distinct words", content: [], role: "assistant", status: "completed" };

    // Both shapes are recognized as internal continuations.
    expect(isMiniGoalContinuationMessage(cont("x", 1))).toBe(true);
    expect(isMiniGoalContinuationMessage(legacy("x", 1))).toBe(true);
    expect(isMiniGoalContinuationMessage(user)).toBe(false);

    // Migration retypes legacy items, preserving ids of everything else.
    const migrated = migrateMiniLegacyContinuations([legacy("a", 1), user] as never[]) as Record<string, unknown>[];
    expect(migrated[0]!.type).toBe(MINI_GOAL_CONTINUATION_ITEM_TYPE);
    expect(migrated[0]!.id).toBe("mini-user-a");
    expect(migrated[1]).toBe(user);

    // History keeps only the single newest fragment even with mixed shapes.
    const lines = miniHistoryLinesFromMessages(
      [user, assistant, legacy("a", 1), cont("b", 2), cont("c", 3)] as never[],
      "live-turn",
      0,
    );
    const frags = lines.filter((l) => l.startsWith("goal-continuation:"));
    expect(frags).toHaveLength(1);
    expect(frags[0]).toContain("attempt 3/50");
    // Real user/assistant history survives alongside the fragment.
    expect(lines.some((l) => l.includes("real request"))).toBe(true);

    // The fragment renders through the shared history item projection.
    expect(historyItemToText(cont("c", 3) as never, 0).startsWith("goal-continuation:")).toBe(true);
  });

  test("user turn preempts a running goal continuation and resets its budget", async () => {
    const { server, port } = await startHangServer();
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "x", protocol: "chat" }),
    });
    bridge.on("notification", (msg: unknown) => {
      const m = msg as { method: string; params: Record<string, unknown> };
      notifications.push({ method: m.method, params: m.params });
    });
    const cwd = mkdtempSync(join(tmpdir(), "mini-goal-preempt-"));
    try {
      // providerId forces relay resolution through the stub (hanging black hole).
      const started = await bridge.request("thread/start", { cwd, ownerId: "local", providerId: "stub" });
      const threadId = threadIdOf(started);
      await bridge.request("thread/goal/set", { threadId, ownerId: "local", objective: "keep going", status: "active" });

      // /status completes locally -> completion schedules a goal continuation (1s).
      await bridge.request("turn/start", { threadId, ownerId: "local", prompt: "/status" });
      // Wait for the continuation turn to start (its fetch then hangs).
      const deadline = Date.now() + 15000;
      let continuationTurnId = "";
      while (Date.now() < deadline) {
        const hit = notifications.find(
          (n) =>
            n.method === "item/completed" &&
            typeof (n.params.item as Record<string, unknown> | undefined)?.text === "string" &&
            ((n.params.item as Record<string, unknown>).text as string).includes(MINI_GOAL_CONTINUATION_MARKER),
        );
        if (hit) {
          continuationTurnId = String((hit.params.item as Record<string, unknown>).turnId ?? "");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(continuationTurnId).toBeTruthy();

      // A user turn must preempt the hanging continuation instead of throwing.
      const user = (await bridge.request("turn/start", {
        threadId,
        ownerId: "local",
        prompt: "/status",
      })) as { turnId: string };
      expect(user.turnId).toBeTruthy();
      expect(user.turnId).not.toBe(continuationTurnId);

      // The preempted continuation reports interrupted.
      const interrupted = notifications.some(
        (n) => n.method === "turn/interrupted" && (n.params as Record<string, unknown>).turnId === continuationTurnId,
      );
      expect(interrupted).toBe(true);

      await bridge.request("turn/interrupt", { threadId, ownerId: "local" });
    } finally {
      bridge.stop();
      await closeServer(server);
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  test("budget exhaustion parks the goal; explicit resume renews it; new objective drops the stale cap", async () => {
    // Minimal non-streaming chat stub: one round bills 5100 tokens.
    const stub: HttpServer = createHttpServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: "done" } }],
          usage: { prompt_tokens: 5000, completion_tokens: 100 },
        }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", () => resolve()));
    const port = (stub.address() as { port: number }).port;
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "x", protocol: "chat" }),
    });
    const cwd = mkdtempSync(join(tmpdir(), "mini-goal-budget-"));
    try {
      const started = await bridge.request("thread/start", { cwd, ownerId: "local", providerId: "stub" });
      const threadId = threadIdOf(started);
      await bridge.request("thread/goal/set", {
        threadId, ownerId: "local", objective: "finish it", status: "active", tokenBudget: 100,
      });
      await bridge.request("turn/start", { threadId, ownerId: "local", prompt: "hello" });

      // The billed round (5100) exceeds the 100-token budget: the goal parks.
      const deadline = Date.now() + 15000;
      let exhausted = false;
      while (Date.now() < deadline) {
        const got = (await bridge.request("thread/goal/get", { threadId, ownerId: "local" })) as {
          goal: { status: string; tokensUsed: number } | null;
        };
        if (got.goal?.status === "budgetLimited") {
          expect(got.goal.tokensUsed).toBeGreaterThanOrEqual(100);
          exhausted = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(exhausted).toBe(true);

      // Explicit user resume renews the same-sized allowance instead of
      // bouncing straight back to budgetLimited.
      const resumed = (await bridge.request("thread/goal/set", {
        threadId, ownerId: "local", status: "active",
      })) as { goal: { status: string; tokensUsed: number; tokenBudget: number | null } };
      expect(resumed.goal.status).toBe("active");
      expect(resumed.goal.tokensUsed).toBe(0);
      expect(resumed.goal.tokenBudget).toBe(100);

      // A new objective without an explicit budget must not inherit the old cap.
      const next = (await bridge.request("thread/goal/set", {
        threadId, ownerId: "local", objective: "something else", status: "active",
      })) as { goal: { objective: string; tokenBudget: number | null } };
      expect(next.goal.objective).toBe("something else");
      expect(next.goal.tokenBudget).toBeNull();
    } finally {
      bridge.stop();
      await new Promise((resolve) => stub.close(() => resolve()));
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  test("stagnation: A/B alternating reads are caught, not just identical turns", () => {
    const turns = [0, 1, 2, 3].map((i) => goalTurn(`t${i}`, [i % 2 ? "b.ts" : "a.ts"], `checked ${i}`));
    const { blocked } = trackTurns(turns);
    // t0 a, t1 b are new work; t2 repeats a, t3 repeats b.
    expect(blocked).toEqual([false, false, false, false]);
    const more = trackTurns([...turns, goalTurn("t4", ["a.ts"], "again")]);
    expect(more.state.goalStagnantTurns).toBe(MINI_GOAL_STAGNANT_LIMIT);
    expect(more.blocked[4]).toBe(true);
  });

  test("stagnation: rewording the reply over the same tool work is still no progress", () => {
    const turns = [0, 1, 2, 3].map((i) => goalTurn(`t${i}`, ["a.ts", "b.ts"], `status report number ${i}`));
    expect(trackTurns(turns).blocked).toEqual([false, false, false, true]);
  });

  test("stagnation: text-only turns count as no progress; new tool work resets", () => {
    const talk = (id: string) => [{ type: "agentMessage", turnId: id, text: `plan restated ${id}` }];
    const { state } = trackTurns([goalTurn("t0", ["a.ts"], "x"), talk("t1"), talk("t2")]);
    expect(state.goalStagnantTurns).toBe(2);
    const reset = trackTurns([goalTurn("t0", ["a.ts"], "x"), talk("t1"), talk("t2"), goalTurn("t3", ["c.ts"], "edited c")]);
    expect(reset.state.goalStagnantTurns).toBe(0);
    expect(reset.state.goalRecentToolFingerprints).toHaveLength(2);
  });

  test("continuation prompt escalates to a final warning one turn before blocking", () => {
    const base = { goalObjective: "ship it", goalTokensUsed: 10 };
    const calm = buildMiniGoalContinuationPrompt(base, { count: 2, max: 50, stagnantTurns: 1 });
    expect(calm).not.toContain("Final notice");
    const last = buildMiniGoalContinuationPrompt(base, { count: 3, max: 50, stagnantTurns: MINI_GOAL_STAGNANT_LIMIT - 1 });
    expect(last).toContain("Final notice");
    expect(last).toContain("Work from evidence");
    expect(last).toContain("GOAL_COMPLETE on its own line");
  });

  test("goal budget running out mid-turn injects the wrap-up note into the next round", async () => {
    // Round 1: a tool call billed far over the 100-token goal budget. Round 2: text.
    const bodies: string[] = [];
    const stub: HttpServer = createHttpServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        bodies.push(raw);
        res.writeHead(200, { "Content-Type": "application/json" });
        const first = bodies.length === 1;
        res.end(JSON.stringify({
          choices: [{
            message: first
              ? { content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "no_such_tool", arguments: "{}" } }] }
              : { content: "Wrapped up: progress so far, remaining work listed." },
          }],
          usage: { prompt_tokens: 5000, completion_tokens: 100 },
        }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", () => resolve()));
    const port = (stub.address() as { port: number }).port;
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "x", protocol: "chat" }),
    });
    const cwd = mkdtempSync(join(tmpdir(), "mini-goal-midturn-"));
    try {
      const started = await bridge.request("thread/start", { cwd, ownerId: "local", providerId: "stub" });
      const threadId = threadIdOf(started);
      await bridge.request("thread/goal/set", { threadId, ownerId: "local", objective: "finish it", status: "active", tokenBudget: 100 });
      await bridge.request("turn/start", { threadId, ownerId: "local", prompt: "hello" });
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && bodies.length < 2) await new Promise((resolve) => setTimeout(resolve, 100));
      expect(bodies.length).toBeGreaterThanOrEqual(2);
      expect(bodies[0]).not.toContain("token budget is exhausted");
      expect(bodies[1]).toContain("token budget is exhausted");
      // Exactly one wrap-up round: the turn ends on text, no third request.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(bodies).toHaveLength(2);
    } finally {
      bridge.stop();
      await new Promise((resolve) => stub.close(() => resolve()));
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  test("usage-limit errors are told apart from other failures", () => {
    for (const e of ["chat 429 Too Many Requests", "insufficient_quota", "rate_limit_exceeded", "余额不足"]) {
      expect(MINI_GOAL_USAGE_LIMIT_ERROR_RE.test(e)).toBe(true);
    }
    for (const e of ["chat 400 bad request", "stream connection failed", "responses 502"]) {
      expect(MINI_GOAL_USAGE_LIMIT_ERROR_RE.test(e)).toBe(false);
    }
  });

  test("failed turn parks an active goal; banner resume restarts work with a fresh audit", async () => {
    // Every request fails fast with a non-retryable 400.
    let hits = 0;
    const stub: HttpServer = createHttpServer((req, res) => {
      hits++;
      req.resume();
      req.on("end", () => {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "bad request" } }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", () => resolve()));
    const port = (stub.address() as { port: number }).port;
    const updates: string[] = [];
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "x", protocol: "chat" }),
    });
    bridge.on("notification", (msg: unknown) => {
      const m = msg as { method: string; params: { goal?: { status?: string } } };
      if (m.method === "thread/goal/updated" && m.params.goal?.status) updates.push(m.params.goal.status);
    });
    const cwd = mkdtempSync(join(tmpdir(), "mini-goal-fail-"));
    const waitStatus = async (threadId: string, want: string) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const got = (await bridge.request("thread/goal/get", { threadId, ownerId: "local" })) as { goal: { status: string } | null };
        if (got.goal?.status === want) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    };
    try {
      const started = await bridge.request("thread/start", { cwd, ownerId: "local", providerId: "stub" });
      const threadId = threadIdOf(started);
      await bridge.request("thread/goal/set", { threadId, ownerId: "local", objective: "finish it", status: "active" });
      await bridge.request("turn/start", { threadId, ownerId: "local", prompt: "hello" });

      // Previously the goal stayed "active" with nothing scheduled.
      expect(await waitStatus(threadId, "blocked")).toBe(true);
      expect(updates).toContain("blocked");
      const hitsBeforeResume = hits;

      // Banner resume: goes active and starts a continuation turn on its own.
      const resumed = (await bridge.request("thread/goal/set", { threadId, ownerId: "local", status: "active" })) as {
        goal: { status: string };
      };
      expect(resumed.goal.status).toBe("active");
      expect(await waitStatus(threadId, "blocked")).toBe(true);
      expect(hits).toBeGreaterThan(hitsBeforeResume);
    } finally {
      bridge.stop();
      await new Promise((resolve) => stub.close(() => resolve()));
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 40000);

  test("multi-turn user prompt does not repeat completed task 1 and does not inject stale goal directive", async () => {
    const receivedBodies: any[] = [];
    let turnCount = 0;
    const stub: HttpServer = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        turnCount++;
        try { receivedBodies.push(JSON.parse(body)); } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        if (turnCount === 1) {
          // Turn 1 natural completion
          res.end(JSON.stringify({
            choices: [{ message: { content: "文件已检查完毕。\n\n目标已完成。" } }],
            usage: { prompt_tokens: 100, completion_tokens: 30 },
          }));
        } else {
          // Turn 2 response
          res.end(JSON.stringify({
            choices: [{ message: { content: "Hello World 脚本已创建完成。" } }],
            usage: { prompt_tokens: 100, completion_tokens: 30 },
          }));
        }
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", () => resolve()));
    const port = (stub.address() as { port: number }).port;
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "x", protocol: "chat" }),
    });
    const cwd = mkdtempSync(join(tmpdir(), "mini-multi-turn-"));
    try {
      const started = await bridge.request("thread/start", { cwd, ownerId: "local", providerId: "stub" });
      const threadId = threadIdOf(started);

      // Start a goal on Turn 1
      await bridge.request("thread/goal/set", { threadId, ownerId: "local", objective: "Task 1: check files", status: "active" });
      await bridge.request("turn/start", { threadId, ownerId: "local", prompt: "Task 1: check files" });

      // Wait for Turn 1 to complete and goal to settle as complete
      const deadline = Date.now() + 10000;
      let completed = false;
      while (Date.now() < deadline) {
        const got = (await bridge.request("thread/goal/get", { threadId, ownerId: "local" })) as { goal: { status: string } | null };
        if (got.goal?.status === "complete") { completed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(completed).toBe(true);

      // Turn 2: User sends a brand new task
      await bridge.request("turn/start", { threadId, ownerId: "local", prompt: "Task 2: create hello world" });
      const deadline2 = Date.now() + 10000;
      let turn2Done = false;
      while (Date.now() < deadline2) {
        const turns = (await bridge.request("thread/turns/list", { threadId, ownerId: "local" })) as { turns: Array<{ status: string }> };
        if (turns.turns.length >= 2 && turns.turns.every((t) => t.status === "completed")) { turn2Done = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(turn2Done).toBe(true);

      // Verify that Turn 2 request payloads to upstream did NOT inject stale <persisted-goal> with Task 1.
      // 0.1.34 mechanical guards may add bounded first-action steer rounds
      // (Task 2 asks to create -> tools demanded), so count is >= 2 and every
      // post-turn-1 live task must be free of Task 1 directives. Historical
      // material is allowed in the recap or the cached wire prefix.
      expect(receivedBodies.length).toBeGreaterThanOrEqual(2);
      const turn2Bodies = receivedBodies.slice(1);
      for (const body of turn2Bodies) {
        const userText = currentTaskText(body);
        expect(userText).not.toContain("<persisted-goal>");
        expect(userText).not.toContain("Task 1: check files");
        expect(userText).toContain("Task 2: create hello world");
      }
      const settledGoal = (await bridge.request("thread/goal/get", { threadId, ownerId: "local" })) as { goal: { status: string } };
      expect(settledGoal.goal.status).toBe("complete");
    } finally {
      bridge.stop();
      await new Promise((resolve) => stub.close(() => resolve()));
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  test("multi-turn active goal updates objective on substantive prompt, preserves on continuation nudge", async () => {
    let requestsReceived = 0;
    const receivedBodies: any[] = [];
    const stub: HttpServer = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        requestsReceived++;
        try { receivedBodies.push(JSON.parse(body)); } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: `Response ${requestsReceived}` } }],
          usage: { prompt_tokens: 50, completion_tokens: 20 },
        }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", () => resolve()));
    const port = (stub.address() as { port: number }).port;
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "x", protocol: "chat" }),
    });
    const cwd = mkdtempSync(join(tmpdir(), "mini-goal-substantive-"));
    try {
      const started = await bridge.request("thread/start", { cwd, ownerId: "local", providerId: "stub" });
      const threadId = threadIdOf(started);

      await bridge.request("thread/goal/set", { threadId, ownerId: "local", objective: "Task 1: old objective", status: "active" });

      // User sends substantive new prompt on the active goal thread
      await bridge.request("turn/start", { threadId, ownerId: "local", prompt: "Task 2: build microservice" });

      // Goal objective should automatically update to the new prompt
      const goalState = (await bridge.request("thread/goal/get", { threadId, ownerId: "local" })) as { goal: { objective: string } };
      expect(goalState.goal.objective).toBe("Task 2: build microservice");

      // Wait for turn to complete
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const turns = (await bridge.request("thread/turns/list", { threadId, ownerId: "local" })) as { turns: Array<{ status: string }> };
        if (turns.turns[0]?.status === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Check request 1 body: should NOT have <persisted-goal> wrapping Task 1 over Task 2
      const turn1Text = currentTaskText(receivedBodies[0]);
      expect(turn1Text).not.toContain("Task 1: old objective");
      expect(turn1Text).toContain("Task 2: build microservice");

      // Now user sends a continuation nudge: "继续"
      await bridge.request("turn/start", { threadId, ownerId: "local", prompt: "继续" });

      // Goal objective must be preserved as Task 2
      const goalStateAfterNudge = (await bridge.request("thread/goal/get", { threadId, ownerId: "local" })) as { goal: { objective: string } };
      expect(goalStateAfterNudge.goal.objective).toBe("Task 2: build microservice");

      // Wait for turn 2 to complete
      const deadline2 = Date.now() + 10000;
      while (Date.now() < deadline2) {
        const turns = (await bridge.request("thread/turns/list", { threadId, ownerId: "local" })) as { turns: Array<{ status: string }> };
        if (turns.turns.length >= 2 && turns.turns[0]?.status === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Continuation turn request should carry the active objective
      expect(receivedBodies.length).toBeGreaterThanOrEqual(2);
      const continuationBody = receivedBodies.find((body) => currentTaskText(body).includes("<persisted-goal>"));
      expect(continuationBody).toBeDefined();
      const turn2Text = currentTaskText(continuationBody);
      expect(turn2Text).toContain("<persisted-goal>");
      expect(turn2Text).toContain("Task 2: build microservice");
      expect(turn2Text).not.toContain("Task 1: old objective");
    } finally {
      bridge.stop();
      await new Promise((resolve) => stub.close(() => resolve()));
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  test("multi-turn chat isolates previous plan checklist from hijacking new user turns", async () => {
    let requestsReceived = 0;
    const reqBodies: any[] = [];
    const stub: HttpServer = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        requestsReceived++;
        try { reqBodies.push(JSON.parse(body)); } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        if (requestsReceived === 1) {
          // Turn 1 round 1: model returns update_plan with pending steps
          res.end(JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                content: "Creating plan.",
                tool_calls: [{
                  id: "call_plan_1",
                  type: "function",
                  function: {
                    name: "update_plan",
                    arguments: JSON.stringify({
                      todos: [
                        { content: "Step 1: Check dir", status: "completed" },
                        { content: "Step 2: Unfinished task", status: "pending" },
                      ],
                    }),
                  },
                }],
              },
            }],
            usage: { prompt_tokens: 50, completion_tokens: 20 },
          }));
        } else if (requestsReceived === 2) {
          // Turn 1 round 2: model reports text with pending step still present
          res.end(JSON.stringify({
            choices: [{ message: { content: "Step 1 done, step 2 still pending." } }],
            usage: { prompt_tokens: 50, completion_tokens: 20 },
          }));
        } else if (requestsReceived === 3) {
          // Turn 1 round 3: after in-turn plan reminder, model finishes Turn 1
          res.end(JSON.stringify({
            choices: [{ message: { content: "Turn 1 finished." } }],
            usage: { prompt_tokens: 50, completion_tokens: 20 },
          }));
        } else {
          // Turn 2 round 1: model responds to user prompt Task 2 with text
          res.end(JSON.stringify({
            choices: [{ message: { content: "Task 2 is complete." } }],
            usage: { prompt_tokens: 50, completion_tokens: 20 },
          }));
        }
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", () => resolve()));
    const port = (stub.address() as { port: number }).port;
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "x", protocol: "chat" }),
    });
    const cwd = mkdtempSync(join(tmpdir(), "mini-plan-isolation-"));
    try {
      const started = await bridge.request("thread/start", { cwd, ownerId: "local", providerId: "stub" });
      const threadId = threadIdOf(started);

      // Turn 1: model creates a plan with Step 2 unfinished
      await bridge.request("turn/start", { threadId, ownerId: "local", prompt: "Task 1: do plan" });
      const deadline1 = Date.now() + 10000;
      while (Date.now() < deadline1) {
        const turns = (await bridge.request("thread/turns/list", { threadId, ownerId: "local" })) as { turns: Array<{ status: string }> };
        if (turns.turns[0]?.status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const stalledTurns = (await bridge.request("thread/turns/list", { threadId, ownerId: "local" })) as { turns: Array<{ status: string }> };
      expect(stalledTurns.turns[0]?.status).toBe("failed");
      expect(requestsReceived).toBe(4);

      // Turn 2: User sends a new task (NOT a continuation nudge)
      await bridge.request("turn/start", { threadId, ownerId: "local", prompt: "Task 2: completely new task" });
      const deadline2 = Date.now() + 10000;
      while (Date.now() < deadline2) {
        const turns = (await bridge.request("thread/turns/list", { threadId, ownerId: "local" })) as { turns: Array<{ status: string }> };
        if (turns.turns.length >= 2 && turns.turns[0]?.status === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(requestsReceived).toBeGreaterThanOrEqual(5);

      // Inspect Turn 2 request: no miniPendingPlanReminder was injected
      const hasPlanReminder = reqBodies.slice(4).some((body) => body?.messages?.some((m: any) =>
        typeof m.content === "string" && m.content.includes("The plan checklist still has")
      ));
      expect(hasPlanReminder).toBe(false);
    } finally {
      bridge.stop();
      await new Promise((resolve) => stub.close(() => resolve()));
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});
