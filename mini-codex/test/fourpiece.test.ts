// Four-piece catch-up: plan/todo, previous_response_id chaining, MEMORY.md, upstream retry.
// Run: bun test test/fourpiece.test.ts (no network: pure helpers + stubbed fetch).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPlanUpdate, extractPlanSteps, formatPlanText, validatePlanSteps } from "../src/plan.ts";
import { appendMiniMemory, loadMiniMemory } from "../src/memory.ts";
import { runPrompt, estimateThreadChars } from "../src/loop.ts";
import {
  advanceResponsesChain,
  createChainedTurn,
  EMPTY_MINI_RESPONSES_CHAIN,
  isChainRejectedError,
  isUpstreamRetryableStatus,
  resolveResponsesRoundInput,
  upstreamRetryAfterMs,
  upstreamRetryDelayMs,
} from "../src/responses.ts";
import type { ThreadItem } from "../src/types.ts";

describe("plan helpers", () => {
  test("extract accepts todos and steps shapes", () => {
    expect(extractPlanSteps({ todos: [{ content: "a", status: "completed" }] }))?.toEqual([{ step: "a", status: "completed" }]);
    expect(extractPlanSteps({ steps: [{ step: "b", status: "doing" }] }))?.toEqual([{ step: "b", status: "in_progress" }]);
    expect(extractPlanSteps({})).toBeNull();
  });
  test("validate rejects two in_progress", () => {
    expect(validatePlanSteps([{ step: "a", status: "in_progress" }, { step: "b", status: "in_progress" }])).toContain("only one");
    expect(validatePlanSteps([{ step: "a", status: "in_progress" }])).toBeNull();
  });
  test("apply replaces the live plan item", () => {
    const thread: ThreadItem[] = [];
    const t1 = applyPlanUpdate(thread, { todos: [{ content: "a", status: "pending" }] });
    expect(t1).toContain("0/1");
    expect(thread.length).toBe(1);
    applyPlanUpdate(thread, { todos: [{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }] });
    expect(thread.length).toBe(1);
    expect(thread[0].type).toBe("plan");
    expect(formatPlanText([{ step: "x", status: "completed" }])).toContain("[x]");
  });
  test("plan text counts toward the context budget", () => {
    const thread: ThreadItem[] = [{ type: "plan", plan: [{ step: "a", status: "pending" }], text: "task plan (0/1 done):\n- [ ] a" }];
    expect(estimateThreadChars(thread)).toBeGreaterThan(0);
  });
});

describe("MEMORY.md", () => {
  test("empty cwd has no memory block", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-mem-"));
    expect(loadMiniMemory(dir)).toBe("");
  });
  test("repo memory loads and remember round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-mem-"));
    writeFileSync(join(dir, "MEMORY.md"), "# notes\n- prefers bun\n");
    const block = loadMiniMemory(dir);
    expect(block).toContain("prefers bun");
    expect(block).toContain("remember");
    expect(appendMiniMemory(dir, "uses pnpm for legacy pkg")).toContain("remembered");
    expect(readFileSync(join(dir, "MEMORY.md"), "utf8")).toContain("uses pnpm");
    expect(appendMiniMemory(dir, "   ")).toContain("needs {text}");
  });
});

describe("responses chaining", () => {
  test("empty chain sends full; matching prefix sends suffix only", () => {
    const full = [{ role: "user" }, { role: "user" }];
    const first = resolveResponsesRoundInput(full, EMPTY_MINI_RESPONSES_CHAIN);
    expect(first.chained).toBe(false);
    expect(first.input.length).toBe(2);
    const chain = advanceResponsesChain(full, "resp-1");
    expect(chain.prevId).toBe("resp-1");
    const extended = [...full, { role: "user" }];
    const second = resolveResponsesRoundInput(extended, chain);
    expect(second.chained).toBe(true);
    expect(second.previousResponseId).toBe("resp-1");
    expect(second.input.length).toBe(1);
  });
  test("mutated prefix falls back to full send", () => {
    const full = [{ role: "user", t: "a" }];
    const chain = advanceResponsesChain(full, "resp-1");
    const changed = [{ role: "user", t: "zzz" }, { role: "user", t: "new" }];
    const r = resolveResponsesRoundInput(changed, chain);
    expect(r.chained).toBe(false);
    expect(r.previousResponseId).toBeNull();
  });
  test("no response id keeps the chain empty", () => {
    expect(advanceResponsesChain([{ a: 1 }], undefined)).toEqual(EMPTY_MINI_RESPONSES_CHAIN);
  });
  test("chain rejection is detected", () => {
    expect(isChainRejectedError(new Error("x"), 400)).toBe(true);
    expect(isChainRejectedError(new Error("previous_response_id expired"))).toBe(true);
    expect(isChainRejectedError(new Error("boom"), 500)).toBe(false);
  });
  test("chained turn sends previous_response_id on round two (stubbed)", async () => {
    const bodies: Array<Record<string, any>> = [];
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      const n = bodies.length;
      return new Response(JSON.stringify({ id: `resp-${n}`, output: [{ type: "message", content: [{ text: `t${n}` }] }] }), { status: 200 });
    };
    try {
      const base = { baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", effort: "low", system: "s", thread: [] as ThreadItem[], tools: [] };
      const full1 = [{ role: "user", content: "hi" }];
      const r1 = await createChainedTurn(base, full1 as any, { ...EMPTY_MINI_RESPONSES_CHAIN });
      expect(r1.result.responseId).toBe("resp-1");
      expect(bodies[0].previous_response_id ?? null).toBeNull();
      const full2 = [...full1, { role: "user", content: "more" }];
      const r2 = await createChainedTurn(base, full2 as any, r1.chain);
      expect(bodies[1].previous_response_id).toBe("resp-1");
      expect((bodies[1].input as unknown[]).length).toBe(1);
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });
  test("rejected chained round retries once with full input (stubbed)", async () => {
    const bodies: Array<Record<string, any>> = [];
    const realFetch = globalThis.fetch;
    let calls = 0;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      calls++;
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      if (calls === 1) return new Response("previous_response_id expired", { status: 400 });
      return new Response(JSON.stringify({ id: "resp-new", output: [{ type: "message", content: [{ text: "recovered" }] }] }), { status: 200 });
    };
    try {
      const base = { baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", effort: "low", system: "s", thread: [] as ThreadItem[], tools: [] };
      const full = [{ role: "user", content: "hi" }];
      const chain = advanceResponsesChain(full as any, "resp-stale");
      const r = await createChainedTurn(base, [...full, { role: "user", content: "new" }] as any, chain);
      expect(calls).toBe(2);
      expect(r.result.text).toBe("recovered");
      expect(r.chain.prevId).toBe("resp-new");
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });
});

describe("upstream retry helpers", () => {
  test("retryable statuses", () => {
    expect(isUpstreamRetryableStatus(429)).toBe(true);
    expect(isUpstreamRetryableStatus(503)).toBe(true);
    expect(isUpstreamRetryableStatus(400)).toBe(false);
    expect(isUpstreamRetryableStatus(200)).toBe(false);
  });
  test("backoff honors Retry-After", () => {
    expect(upstreamRetryDelayMs(0)).toBe(500);
    expect(upstreamRetryDelayMs(1)).toBe(1000);
    expect(upstreamRetryDelayMs(99)).toBe(10000);
    expect(upstreamRetryDelayMs(0, 250)).toBe(250);
    expect(upstreamRetryAfterMs(new Headers({ "retry-after": "2" }))).toBe(2000);
    expect(upstreamRetryAfterMs(null, "try again in 3 s")).toBe(3000);
    expect(upstreamRetryAfterMs(null, "nothing here")).toBeUndefined();
  });
  test("retry then succeed (stubbed 503 -> 200)", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    (globalThis as any).fetch = async () => {
      calls++;
      if (calls === 1) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ id: "r2", output: [{ type: "message", content: [{ text: "ok" }] }] }), { status: 200 });
    };
    try {
      const dir = mkdtempSync(join(tmpdir(), "mini-retry-"));
      const out = await runPrompt({ baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", cwd: dir }, "hello world note", async () => "tool out", { threadFile: join(dir, "t.jsonl") });
      expect(calls).toBe(2);
      expect(out).toContain("ok");
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });
});

describe("chain sidecar across invocations (stubbed)", () => {
  test("second CLI run chains with previous_response_id instead of re-uploading", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-chain-"));
    const saveFile = join(dir, "thread.jsonl");
    const bodies: Array<Record<string, any>> = [];
    const realFetch = globalThis.fetch;
    let calls = 0;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      calls++;
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ id: `resp-${calls}`, output: [{ type: "message", content: [{ text: `ack ${calls}` }] }] }), { status: 200 });
    };
    try {
      const cfg = { baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", cwd: dir };
      const out1 = await runPrompt(cfg, "note alpha", async () => "tool out", { threadFile: saveFile });
      expect(out1).toContain("ack 1");
      expect(bodies[0].previous_response_id ?? null).toBeNull();
      expect(bodies.length).toBe(1);
      // Regression lock for the aliasing wipe: the first turn must carry the
      // user prompt, never an empty input (total amnesia).
      expect((bodies[0].input as unknown[]).length).toBe(1);
      const out2 = await runPrompt(cfg, "note beta", async () => "tool out", { threadFile: saveFile });
      expect(out2).toContain("ack 2");
      expect(bodies.length).toBe(2);
      // The second run reuses the stored response instead of re-uploading all 3 items.
      expect(bodies[1].previous_response_id).toBe("resp-1");
      expect((bodies[1].input as unknown[]).length).toBeLessThan(3);
      // Both notes survive in the persisted transcript (no amnesia across runs).
      const saved = readFileSync(saveFile, "utf8");
      expect(saved).toContain("note alpha");
      expect(saved).toContain("note beta");
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });
});

describe("remember + update_plan dispatch (stubbed)", () => {
  test("remember persists to MEMORY.md and update_plan lands in the transcript", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-disp-"));
    const saveFile = join(dir, "thread.jsonl");
    const realFetch = globalThis.fetch;
    let calls = 0;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      calls++;
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (String(body.instructions ?? "").includes("Summarize this earlier")) {
        return new Response(JSON.stringify({ output: [{ type: "message", content: [{ text: "s" }] }] }), { status: 200 });
      }
      if (calls <= 2) {
        const name = calls === 1 ? "remember" : "update_plan";
        const args = name === "remember" ? { text: "user prefers bun" } : { todos: [{ content: "fix x", status: "in_progress" }] };
        return new Response(JSON.stringify({ id: `resp-${calls}`, output: [{ type: "function_call", call_id: `c${calls}`, name, arguments: JSON.stringify(args) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "resp-3", output: [{ type: "message", content: [{ text: "done, verified" }] }] }), { status: 200 });
    };
    try {
      const out = await runPrompt({ baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", cwd: dir }, "修复登录问题并记住偏好", async () => "tool ok", { threadFile: saveFile });
      expect(out).toContain("done");
      expect(readFileSync(join(dir, "MEMORY.md"), "utf8")).toContain("user prefers bun");
      const saved = readFileSync(saveFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      expect(saved.some((t: any) => t.type === "plan")).toBe(true);
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });
});
