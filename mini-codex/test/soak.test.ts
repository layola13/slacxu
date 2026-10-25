// Long-run anti-amnesia soak (offline, stubbed fetch — no network).
// Proves: 12 sequential runPrompt invocations on one thread file stay chained
// (previous_response_id every round after the first), payload stays small
// (no full re-upload growth), and every note survives on disk.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureThreadBudget, loadThreadAutoWithDropped, runPrompt } from "../src/loop.ts";

describe("long-run soak (12 rounds, stubbed)", () => {
  test("stays chained, payload stays small, nothing forgotten", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-soak-"));
    const saveFile = join(dir, "thread.jsonl");
    const bodies: Array<Record<string, any>> = [];
    const realFetch = globalThis.fetch;
    let calls = 0;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      calls++;
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({ id: `resp-${calls}`, output: [{ type: "message", content: [{ text: `ack ${calls}` }] }] }),
        { status: 200 },
      );
    };
    try {
      const cfg = { baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", cwd: dir };
      const ROUNDS = 12;
      for (let i = 1; i <= ROUNDS; i++) {
        const out = await runPrompt(cfg, `soak note ${i}`, async () => "tool out", { threadFile: saveFile });
        expect(out).toContain(`ack ${i}`);
      }
      expect(bodies.length).toBe(ROUNDS);
      expect(bodies[0].previous_response_id ?? null).toBeNull();
      expect((bodies[0].input as unknown[]).length).toBeGreaterThan(0);
      for (let i = 1; i < ROUNDS; i++) {
        expect(bodies[i].previous_response_id).toBe(`resp-${i}`);
        // Chained suffix only — must not re-upload the whole transcript.
        expect((bodies[i].input as unknown[]).length).toBeLessThanOrEqual(3);
      }
      const saved = readFileSync(saveFile, "utf8");
      for (let i = 1; i <= ROUNDS; i++) expect(saved).toContain(`soak note ${i}`);
      // Sidecar holds the latest response id for the next CLI invocation.
      const chain = JSON.parse(readFileSync(`${saveFile}.chain.json`, "utf8"));
      expect(chain.prevId).toBe(`resp-${ROUNDS}`);
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });

  test("corrupt chain sidecar falls back to full send (relay recovery)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-soak-corrupt-"));
    const saveFile = join(dir, "thread.jsonl");
    const bodies: Array<Record<string, any>> = [];
    const realFetch = globalThis.fetch;
    let calls = 0;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      calls++;
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({ id: `resp-${calls}`, output: [{ type: "message", content: [{ text: `ack ${calls}` }] }] }),
        { status: 200 },
      );
    };
    try {
      const cfg = { baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m", cwd: dir };
      await runPrompt(cfg, "first note", async () => "tool out", { threadFile: saveFile });
      // Corrupt the sidecar mid-conversation (disk rot / relay restart).
      const { writeFileSync } = await import("node:fs");
      writeFileSync(`${saveFile}.chain.json`, "not-json{{", "utf8");
      const out = await runPrompt(cfg, "second note", async () => "tool out", { threadFile: saveFile });
      expect(out).toContain("ack 2");
      expect(bodies[1].previous_response_id ?? null).toBeNull();
      expect((bodies[1].input as unknown[]).length).toBeGreaterThan(1);
      const saved = readFileSync(saveFile, "utf8");
      expect(saved).toContain("first note");
      expect(saved).toContain("second note");
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });

  test("load cut carries the dropped plan forward (no cross-run plan amnesia)", async () => {
    const { applyPlanUpdate } = await import("../src/plan.ts");
    const seed: Array<Record<string, any>> = [];
    applyPlanUpdate(seed as any, { todos: [{ content: "ship fix", status: "in_progress" }] });
    for (let i = 0; i < 250; i++) seed.push({ type: "user", text: `filler ${i} ${"x".repeat(50)}` });
    // --resume path (explicit initial over the keep cap).
    const r1 = loadThreadAutoWithDropped("unused.jsonl", seed as any);
    expect(r1.dropped.length).toBeGreaterThan(0);
    expect(r1.thread.some((t: any) => t.type === "plan")).toBe(true);
    expect(r1.dropped.some((t: any) => t.type === "plan")).toBe(false);
    // Persisted-file path (default memory across CLI invocations).
    const dir = mkdtempSync(join(tmpdir(), "mini-soak-planload-"));
    const saveFile = join(dir, "thread.jsonl");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(saveFile, seed.map((t) => JSON.stringify(t)).join("\n"), "utf8");
    const r2 = loadThreadAutoWithDropped(saveFile, undefined);
    expect(r2.thread.some((t: any) => t.type === "plan")).toBe(true);
    expect(r2.dropped.some((t: any) => t.type === "plan")).toBe(false);
  });

  test("budget squeeze keeps the live plan (no plan amnesia)", async () => {
    const { applyPlanUpdate } = await import("../src/plan.ts");
    const thread: Array<Record<string, any>> = [];
    applyPlanUpdate(thread as any, { todos: [{ content: "ship fix", status: "in_progress" }] });
    for (let i = 0; i < 30; i++) {
      thread.push({ type: "function_call", callId: `c${i}`, name: "sa_vm", args: JSON.stringify({ action: "read_lines", path: `f${i}.ts` }) });
      thread.push({ type: "function_call_output", callId: `c${i}`, output: `x`.repeat(2000) });
    }
    thread.push({ type: "user", text: "current question" });
    const squeezed = ensureThreadBudget(thread as any, 20000);
    expect(squeezed.some((t: any) => t.type === "plan")).toBe(true);
    expect(squeezed[squeezed.length - 1].type).toBe("user");
  });
});
