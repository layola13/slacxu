// Regression tests for: echo-repeat, context amnesia, /goal placebo.
// Run: bun test test/loop.test.ts (no network: pure helpers only).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBaseSystem, buildActionNudge, buildMemoryItem, boundPrefixForSummary, cleanGoalMarker, digestToolOutputs,
  ensureThreadBudget, estimateThreadChars, goalSystemSuffix, hasGoalToolEvidence,
  isEchoOfPrompt, isGoalBlocked, isGoalDone, isGoalTerminalSupported, loadThreadAuto, loadThreadAutoWithDropped,
  needsActionNudge, parseGoalArgs, runPrompt,
  shouldWrapUp, withCompactedMemory,
} from "../src/loop.ts";
import { toChatMessages, toResponsesInput } from "../src/responses.ts";
import type { ThreadItem } from "../src/types.ts";

describe("output contract (anti-echo)", () => {
  test("base system forbids repeating the request", () => {
    const s = buildBaseSystem("", [], 0);
    expect(s).toContain("Never repeat");
    expect(s).toContain("summary");
  });
  test("depth 0 keeps subagent suffix, depth 1 drops it", () => {
    expect(buildBaseSystem("", [], 0)).toContain("Sub-agents:");
    expect(buildBaseSystem("", [], 1)).not.toContain("Sub-agents:");
  });
});

describe("parseGoalArgs", () => {
  test("parses objective", () => {
    expect(parseGoalArgs("/goal fix login and verify")).toBe("fix login and verify");
  });
  test("bare /goal -> empty (usage)", () => {
    expect(parseGoalArgs("/goal")).toBe("");
    expect(parseGoalArgs("/goal   ")).toBe("");
  });
  test("non-goal -> null", () => {
    expect(parseGoalArgs("hello")).toBeNull();
    expect(parseGoalArgs("/goals x")).toBeNull();
    expect(parseGoalArgs("/status")).toBeNull();
  });
});

describe("goal markers", () => {
  test("DONE/BLOCKED detection", () => {
    expect(isGoalDone("did it\nGOAL_DONE")).toBe(true);
    expect(isGoalDone("GOAL_DONE\nmore claims after marker")).toBe(false);
    expect(isGoalDone("GOAL_DONE extra")).toBe(false);
    expect(isGoalBlocked("stuck\nGOAL_BLOCKED")).toBe(true);
    expect(isGoalBlocked("GOAL_BLOCKED\nnot actually blocked")).toBe(false);
    expect(isGoalDone("nothing")).toBe(false);
  });
  test("cleanGoalMarker strips marker lines only", () => {
    expect(cleanGoalMarker("fixed x\n- evidence\nGOAL_DONE")).toBe("fixed x\n- evidence");
    expect(cleanGoalMarker("GOAL_BLOCKED")).toBe("");
  });
  test("goal suffix demands evidence + markers + no echo", () => {
    const s = goalSystemSuffix("fix X");
    expect(s).toContain("GOAL_DONE");
    expect(s).toContain("GOAL_BLOCKED");
    expect(s).toContain("evidence");
    expect(s).toContain("Never repeat");
  });
});

describe("hasGoalToolEvidence", () => {
  test("requires a call and its output within the current goal", () => {
    const thread: ThreadItem[] = [
      { type: "function_call", callId: "old", name: "read", args: "{}" },
      { type: "function_call_output", callId: "old", output: "old result" },
      { type: "user", text: "new goal" },
      { type: "function_call", callId: "new", name: "test", args: "{}" },
      { type: "function_call_output", callId: "new", output: "tests passed" },
    ];
    expect(hasGoalToolEvidence(thread, 2)).toBe(true);
    expect(hasGoalToolEvidence(thread, 4)).toBe(false);
  });

  test("does not accept an unmatched output as evidence", () => {
    expect(hasGoalToolEvidence([
      { type: "function_call_output", callId: "missing", output: "result" },
    ])).toBe(false);
  });
});

describe("isGoalTerminalSupported", () => {
  const evidence: ThreadItem[] = [
    { type: "function_call", callId: "verify", name: "test", args: "{}" },
    { type: "function_call_output", callId: "verify", output: "tests passed" },
  ];

  test("requires a non-echo summary and tool output", () => {
    expect(isGoalTerminalSupported("\nGOAL_DONE", "fix login", evidence)).toBe(false);
    expect(isGoalTerminalSupported("fix login\nGOAL_DONE", "fix login", evidence)).toBe(false);
    expect(isGoalTerminalSupported("Fixed login and verified tests.\nGOAL_DONE", "fix login", evidence)).toBe(true);
    expect(isGoalTerminalSupported("Fixed login.\nGOAL_DONE", "fix login", [])).toBe(false);
  });
});

describe("shouldWrapUp", () => {
  test("empty text -> wrap", () => {
    expect(shouldWrapUp("", -1, 2)).toBe(true);
    expect(shouldWrapUp("  ", -1, -1)).toBe(true);
  });
  test("calls after last text -> wrap (stale echo case)", () => {
    expect(shouldWrapUp("echo of request", 0, 3)).toBe(true);
  });
  test("text after calls -> no wrap", () => {
    expect(shouldWrapUp("summary", 3, 2)).toBe(false);
    expect(shouldWrapUp("summary", 1, -1)).toBe(false);
  });
});

describe("isEchoOfPrompt (pure-echo guard)", () => {
  test("exact repeat -> echo", () => {
    expect(isEchoOfPrompt("fix the login redirect", "fix the login redirect")).toBe(true);
  });
  test("repeat with /command prefix stripped", () => {
    expect(isEchoOfPrompt("/goal fix the login redirect", "fix the login redirect")).toBe(true);
  });
  test("wrapped echo (Sure, ...) still echo", () => {
    expect(isEchoOfPrompt(
      "fix the login redirect and verify with tests",
      "Sure, I will fix the login redirect and verify with tests",
    )).toBe(true);
  });
  test("real summary is not echo", () => {
    expect(isEchoOfPrompt(
      "fix the login redirect",
      "Fixed redirect in src/auth.ts:42 (added returnUrl passthrough). Verified with bun test (12 pass).",
    )).toBe(false);
  });
  test("short outputs are not echoes", () => {
    expect(isEchoOfPrompt("fix it", "fix it")).toBe(true); // exact still counts
    expect(isEchoOfPrompt("fix it now please", "ok")).toBe(false);
  });
  test("empty sides -> false", () => {
    expect(isEchoOfPrompt("", "something")).toBe(false);
    expect(isEchoOfPrompt("something", "")).toBe(false);
  });
});

describe("digestToolOutputs (grounded fallback)", () => {
  test("lists calls with outputs, newest last", () => {
    const thread: ThreadItem[] = [
      { type: "user", text: "do x" },
      { type: "function_call", callId: "c1", name: "sa_vm", args: "{}" },
      { type: "function_call_output", callId: "c1", output: "line1\nline2" },
      { type: "function_call", callId: "c2", name: "mcp__fs__read", args: "{}" },
      { type: "function_call_output", callId: "c2", output: "content here" },
    ];
    const d = digestToolOutputs(thread);
    expect(d).toContain("sa_vm");
    expect(d).toContain("mcp__fs__read");
    expect(d).toContain("content here");
    expect(d.indexOf("sa_vm")).toBeLessThan(d.indexOf("mcp__fs__read"));
  });
  test("no outputs -> empty", () => {
    expect(digestToolOutputs([{ type: "user", text: "hi" }])).toBe("");
  });
  test("unknown call id falls back to 'tool'", () => {
    const d = digestToolOutputs([{ type: "function_call_output", callId: "zz", output: "o" }]);
    expect(d).toContain("tool");
  });
});

describe("loadThreadAuto (anti-amnesia)", () => {
  test("explicit initial wins", () => {
    const init: ThreadItem[] = [{ type: "user", text: "hi" }];
    expect(loadThreadAuto("/nonexistent/x.jsonl", init)).toEqual(init);
  });
  test("missing file -> []", () => {
    expect(loadThreadAuto(join(tmpdir(), `nope-${Date.now()}.jsonl`), undefined)).toEqual([]);
  });
  test("loads persisted history", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-loop-"));
    const f = join(dir, "t.jsonl");
    writeFileSync(f, [{ type: "user", text: "earlier" }, { type: "message", text: "done" }].map((x) => JSON.stringify(x)).join("\n"));
    const got = loadThreadAuto(f, undefined);
    expect(got.length).toBe(2);
    expect(got[0]).toEqual({ type: "user", text: "earlier" });
  });
  test("caps growth via MINI_THREAD_KEEP", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-loop-"));
    const f = join(dir, "t.jsonl");
    const items = Array.from({ length: 50 }, (_, i) => ({ type: "user", text: `m${i}` }));
    writeFileSync(f, items.map((x) => JSON.stringify(x)).join("\n"));
    process.env.MINI_THREAD_KEEP = "30";
    try {
      const got = loadThreadAuto(f, undefined);
      expect(got.length).toBe(30);
      expect(got[0]).toEqual({ type: "user", text: "m20" });
    } finally {
      delete process.env.MINI_THREAD_KEEP;
    }
  });
});

describe("reasoning not re-sent to model", () => {
  const thread: ThreadItem[] = [
    { type: "user", text: "do x" },
    { type: "reasoning", text: "thinking..." },
    { type: "message", text: "ok" },
  ];
  test("responses input skips reasoning", () => {
    const input = toResponsesInput(thread);
    expect(input.length).toBe(2);
    expect(JSON.stringify(input)).not.toContain("thinking");
  });
  test("chat messages skip reasoning", () => {
    const msgs = toChatMessages(thread, "sys");
    expect(msgs.length).toBe(3); // system + user + assistant
    expect(JSON.stringify(msgs)).not.toContain("thinking");
  });
});

describe("proactive base prompt (anti-passive)", () => {
  test("no 'then stop'; demands plan/act/verify/report", () => {
    const s = buildBaseSystem("", [], 0);
    expect(s).not.toContain("then stop");
    expect(s).toContain("Plan briefly");
    expect(s).toContain("Keep working until the request is done");
    expect(s).toContain("verify");
  });
  test("agentsMd section appended only when present", () => {
    expect(buildBaseSystem("", [], 0)).not.toContain("AGENTS.md");
    const s = buildBaseSystem("", [], 0, "Always run tests.");
    expect(s).toContain("AGENTS.md");
    expect(s).toContain("Always run tests.");
  });
});

describe("loadThreadAutoWithDropped (compact-on-overflow)", () => {
  test("explicit initial -> no dropped", () => {
    const init: ThreadItem[] = [{ type: "user", text: "hi" }];
    expect(loadThreadAutoWithDropped("/nonexistent/x.jsonl", init)).toEqual({ thread: init, dropped: [] });
  });
  test("oversized explicit initial (--resume) splits tail + dropped like the default path", () => {
    const init: ThreadItem[] = Array.from({ length: 50 }, (_, i) => ({ type: "user", text: `r${i}` }));
    process.env.MINI_THREAD_KEEP = "30";
    try {
      const { thread, dropped } = loadThreadAutoWithDropped("/nonexistent/x.jsonl", init);
      expect(thread.length).toBe(30);
      expect(thread[0]).toEqual({ type: "user", text: "r20" });
      expect(dropped.length).toBe(20);
      expect(dropped[0]).toEqual({ type: "user", text: "r0" });
    } finally {
      delete process.env.MINI_THREAD_KEEP;
    }
  });
  test("under keep -> no dropped", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-loop-"));
    const f = join(dir, "t.jsonl");
    writeFileSync(f, [{ type: "user", text: "a" }].map((x) => JSON.stringify(x)).join("\n"));
    expect(loadThreadAutoWithDropped(f, undefined)).toEqual({
      thread: [{ type: "user", text: "a" }],
      dropped: [],
    });
  });
  test("overflow splits kept tail + dropped prefix", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-loop-"));
    const f = join(dir, "t.jsonl");
    const items = Array.from({ length: 50 }, (_, i) => ({ type: "user", text: `m${i}` }));
    writeFileSync(f, items.map((x) => JSON.stringify(x)).join("\n"));
    process.env.MINI_THREAD_KEEP = "30";
    try {
      const { thread, dropped } = loadThreadAutoWithDropped(f, undefined);
      expect(thread.length).toBe(30);
      expect(thread[0]).toEqual({ type: "user", text: "m20" });
      expect(dropped.length).toBe(20);
      expect(dropped[0]).toEqual({ type: "user", text: "m0" });
    } finally {
      delete process.env.MINI_THREAD_KEEP;
    }
  });
  test("buildMemoryItem marks the compacted prefix", () => {
    const item = buildMemoryItem("did X", 20);
    expect(item.type).toBe("user");
    expect(item.type === "user" && item.text).toContain("[memory]");
    expect(item.type === "user" && item.text).toContain("20 items");
    expect(item.type === "user" && item.text).toContain("did X");
  });
  test("withCompactedMemory falls back to evidence digest when the summarizer fails", async () => {
    const cfg = { baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", cwd: tmpdir() };
    const thread: ThreadItem[] = [{ type: "user", text: "recent" }];
    const dropped: ThreadItem[] = [
      { type: "function_call", callId: "c1", name: "sa_vm", args: "{}" },
      { type: "function_call_output", callId: "c1", output: "did the thing" },
    ];
    const got = await withCompactedMemory(cfg, thread, dropped);
    expect(got.length).toBe(2);
    expect(got[0].type).toBe("user");
    if (got[0].type === "user") {
      expect(got[0].text).toContain("[memory]");
      expect(got[0].text).toContain("did the thing");
    }
    expect(got[1]).toEqual({ type: "user", text: "recent" });
  });
  test("withCompactedMemory is identity when nothing dropped", async () => {
    const cfg = { baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", cwd: tmpdir() };
    const thread: ThreadItem[] = [{ type: "user", text: "recent" }];
    expect(await withCompactedMemory(cfg, thread, [])).toBe(thread);
  });
  test("boundPrefixForSummary caps large prefixes with head + digest + tail", () => {
    const items: ThreadItem[] = Array.from({ length: 200 }, (_, i) => ({ type: "user", text: `m${i}` }));
    const bounded = boundPrefixForSummary(items, 80);
    expect(bounded.length).toBe(80);
    expect(bounded[0]).toEqual({ type: "user", text: "m0" });
    expect(bounded[bounded.length - 1]).toEqual({ type: "user", text: "m199" });
    expect(bounded[20].type === "user" && bounded[20].text).toContain("omitted 121 middle items");
    expect(boundPrefixForSummary(items.slice(0, 80), 80)).toHaveLength(80);
  });
});

describe("ensureThreadBudget (mid-turn anti-amnesia)", () => {
  test("identity when inside budget", () => {
    const thread: ThreadItem[] = [{ type: "user", text: "hi" }];
    expect(ensureThreadBudget(thread, 120000)).toBe(thread);
  });
  test("squeezes the middle into a [memory] digest, keeps markers + newest", () => {
    const items: ThreadItem[] = [
      { type: "user", text: "[memory] old summary" },
      ...Array.from({ length: 60 }, (_, i) => ({ type: "user", text: `mid message number ${i} with some padding text to consume chars` }) as ThreadItem),
      { type: "function_call", callId: "c1", name: "sa_vm", args: "{}" },
      { type: "function_call_output", callId: "c1", output: "fresh evidence here" },
    ];
    const got = ensureThreadBudget(items, 2000);
    expect(got.length).toBeLessThan(items.length);
    expect(estimateThreadChars(got)).toBeLessThan(estimateThreadChars(items));
    expect(got[0]).toEqual({ type: "user", text: "[memory] old summary" });
    const mid = got.find((t) => t.type === "user" && t.text.includes("squeezed out of context budget"));
    expect(mid).toBeDefined();
    expect(got[got.length - 1]).toEqual({ type: "function_call_output", callId: "c1", output: "fresh evidence here" });
  });
  test("keeps at least the newest 8 items even under a tiny budget", () => {
    const items: ThreadItem[] = Array.from({ length: 30 }, (_, i) => ({ type: "user", text: `item ${i} padding padding padding` }));
    const got = ensureThreadBudget(items, 20000);
    expect(got.length).toBeGreaterThanOrEqual(8);
    expect(got[got.length - 1]).toEqual(items[items.length - 1]);
  });
  test("repairs cut call/output pairs so fresh evidence survives sanitize", () => {    // One parallel-call turn shape: calls land first, outputs after, so a
    // budget cut can orphan kept outputs whose calls fell off the tail.
    const items: ThreadItem[] = [{ type: "user", text: "old filler" }];
    for (let i = 1; i <= 5; i++) items.push({ type: "function_call", callId: `c${i}`, name: "sa_vm", args: "{}" });
    for (let i = 1; i <= 5; i++) items.push({ type: "function_call_output", callId: `c${i}`, output: `fresh evidence number ${i} with padding` });
    items.push({ type: "user", text: "newer exchange one" });
    items.push({ type: "user", text: "newer exchange two" });
    const got = ensureThreadBudget(items, 200);
    const calls = new Set(got.filter((t) => t.type === "function_call").map((t) => t.type === "function_call" ? t.callId : ""));
    for (const t of got) {
      if (t.type === "function_call_output" && t.output.includes("fresh evidence")) {
        expect(calls.has(t.callId)).toBe(true);
      }
    }
    // Restored calls slot just before their outputs.
    const idx = (id: string) => got.findIndex((t) => t.type === "function_call" && t.callId === id);
    const outIdx = (id: string) => got.findIndex((t) => t.type === "function_call_output" && t.callId === id);
    expect(idx("c1")).toBeGreaterThanOrEqual(0);
    expect(idx("c1")).toBeLessThan(outIdx("c1"));
  });
  test("image payload chars count toward the budget", () => {
    const bigImage = "data:image/png;base64," + "A".repeat(5000);
    const fillers: ThreadItem[] = Array.from({ length: 12 }, (_, i) => ({ type: "user", text: `filler note number ${i}` }));
    const plain: ThreadItem[] = [
      ...fillers,
      { type: "function_call", callId: "v1", name: "image_view", args: "{}" },
      { type: "function_call_output", callId: "v1", output: "saw a login form" },
      { type: "user", text: "recent follow-up" },
    ];
    const withImage: ThreadItem[] = plain.map((t) =>
      t.type === "function_call_output" ? { ...t, images: [bigImage] } : t,
    );
    expect(estimateThreadChars(withImage) - estimateThreadChars(plain)).toBe(bigImage.length);
    // 450 chars fits the text-only thread but not the image-carrying one.
    expect(ensureThreadBudget(plain, 450)).toBe(plain);
    const got = ensureThreadBudget(withImage, 450);
    expect(got.some((t) => t.type === "user" && t.text.includes("squeezed out of context budget"))).toBe(true);
  });
});

describe("needsActionNudge (anti-passive)", () => {
  test("fires for action-like prompts with zero tool calls", () => {
    expect(needsActionNudge("修复登录跳转 bug", -1)).toBe(true);
    expect(needsActionNudge("implement the login redirect", -1)).toBe(true);
    expect(needsActionNudge("看看 src/loop.ts 里的问题", -1)).toBe(true);
  });
  test("silent when tools were used, for greetings, or slash commands", () => {
    expect(needsActionNudge("修复登录跳转 bug", 2)).toBe(false);
    expect(needsActionNudge("你好", -1)).toBe(false);
    expect(needsActionNudge("/status", -1)).toBe(false);
    expect(needsActionNudge("/goal fix it", -1)).toBe(false);
    expect(needsActionNudge("", -1)).toBe(false);
  });
  test("buildActionNudge demands tool action with evidence", () => {
    const item = buildActionNudge("修复登录跳转");
    expect(item.type).toBe("user");
    if (item.type === "user") {
      expect(item.text).toContain("without using any tools");
      expect(item.text).toContain("sa_vm");
    }
  });
});

describe("runPrompt integration (stubbed fetch, no network)", () => {
  test("overflow compacts to [memory] AND a passive answer triggers the action nudge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-e2e-"));
    const saveFile = join(dir, "thread.jsonl");
    const seed: ThreadItem[] = Array.from({ length: 25 }, (_, i) => ({ type: "user", text: `earlier note ${i}` }));
    writeFileSync(saveFile, seed.map((t) => JSON.stringify(t)).join("\n"));
    process.env.MINI_THREAD_KEEP = "10";
    const bodies: Array<Record<string, any>> = [];
    const realFetch = globalThis.fetch;
    const msg = (text: string) => ({ output: [{ type: "message", content: [{ text }] }] });
    let calls = 0;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      calls++;
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      const body = bodies[bodies.length - 1] as Record<string, any>;
      const system = String((body as any).instructions ?? "");
      if (system.includes("Summarize this earlier")) return new Response(JSON.stringify(msg("prior summary here")), { status: 200 });
      if (calls === 2) return new Response(JSON.stringify(msg("我来修复这个登录bug")), { status: 200 });
      return new Response(JSON.stringify(msg("已经看完了")), { status: 200 });
    };
    try {
      const cfg = { baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", cwd: dir };
      const out = await runPrompt(cfg, "修复登录bug问题", async () => "tool out", { threadFile: saveFile });
      // 1 x compaction summary + 2 x agent turns (initial + nudge), no wrap-up
      // (the passive texts are non-empty and not echoes).
      expect(calls).toBe(3);
      // The nudge turn's input carries the action-nudge instruction.
      const wire = bodies.map((b) => JSON.stringify(b.input ?? []));
      expect(wire.some((s) => s.includes("without using any tools"))).toBe(true);
      // The persisted transcript leads with the [memory] compaction item.
      const saved = readFileSync(saveFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      expect(saved[0].type).toBe("user");
      expect(String(saved[0].text)).toContain("[memory]");
      expect(String(saved[0].text)).toContain("prior summary here");
      expect(out).toBe("已经看完了");
    } finally {
      (globalThis as any).fetch = realFetch;
      delete process.env.MINI_THREAD_KEEP;
    }
  });
  test("/goal with a tool-shy model names the zero-tool problem on re-nudge", async () => {    const dir = mkdtempSync(join(tmpdir(), "mini-goal-"));
    const saveFile = join(dir, "thread.jsonl");
    process.env.MINI_GOAL_MAX_TURNS = "8";
    const bodies: Array<Record<string, any>> = [];
    const realFetch = globalThis.fetch;
    const msg = (text: string) => ({ output: [{ type: "message", content: [{ text }] }] });
    (globalThis as any).fetch = async (_url: string, init: any) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify(msg("还在看代码")), { status: 200 });
    };
    try {
      const cfg = { baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", cwd: dir };
      const out = await runPrompt(cfg, "/goal 修登录问题", async () => "tool out", { threadFile: saveFile });
      // Budget floor is 8: one text-only turn per segment, then exhaustion.
      expect(bodies.length).toBe(8);
      const wire = bodies.map((b) => JSON.stringify(b.input ?? []));
      expect(wire.some((s) => s.includes("have not used any tools yet"))).toBe(true);
      expect(out).toContain("turn budget exhausted");
    } finally {
      (globalThis as any).fetch = realFetch;
      delete process.env.MINI_GOAL_MAX_TURNS;
    }
  });
  test("a text-only sub-agent gets one action nudge before its report is accepted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-child-"));
    const saveFile = join(dir, "thread.jsonl");
    const bodies: Array<Record<string, any>> = [];
    const realFetch = globalThis.fetch;
    const msg = (text: string) => ({ output: [{ type: "message", content: [{ text }] }] });
    let rootTurns = 0;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      bodies.push(body);
      const input = JSON.stringify((body as any).input ?? []);
      // Child turns carry the task-brief marker in their thread.
      if (input.includes("Task brief from the parent agent")) {
        return new Response(JSON.stringify(msg("收到，正在处理")), { status: 200 });
      }
      rootTurns++;
      if (rootTurns === 1) {
        return new Response(JSON.stringify({
          output: [{
            type: "function_call", call_id: "spawn1", name: "spawn_agent",
            arguments: JSON.stringify({ task_name: "t1", message: "查一下登录跳转的实现" }),
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify(msg("已分派子代理")), { status: 200 });
    };
    try {
      const cfg = { baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", cwd: dir };
      const out = await runPrompt(cfg, "查一下登录跳转的实现路径", async () => "tool out", { threadFile: saveFile });
      expect(out).toBe("已分派子代理");
      // The child runs in the background: wait for its second (post-nudge) turn.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const childTurns = bodies.filter((b) => JSON.stringify((b as any).input ?? []).includes("Task brief from the parent agent"));
        if (childTurns.length >= 2) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const childInputs = bodies
        .filter((b) => JSON.stringify((b as any).input ?? []).includes("Task brief from the parent agent"))
        .map((b) => JSON.stringify((b as any).input ?? []));
      expect(childInputs.length).toBeGreaterThanOrEqual(2);
      expect(childInputs[1]).toContain("without using any tools");
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });
});
