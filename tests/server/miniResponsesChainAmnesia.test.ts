import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";

// Regression: a relay (e.g. starhubapi) serving an OpenAI model returns
// response ids but silently ignores previous_response_id. Chained round 2 then
// carried only the tool output, and the model forgot the user request ("What
// would you like me to work on?"). OpenAI models behind relays must get the
// full input every round; other models keep previous_response_id chaining.
async function runTwoRounds(model: string): Promise<any[]> {
  const cwd = mkdtempSync(join(tmpdir(), "mini-chain-amnesia-"));
  const bodies: any[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const body = await request.json();
      bodies.push(body);
      const n = bodies.length;
      if (n === 1) {
        return Response.json({ id: "resp-1", output: [{ type: "function_call", call_id: "c1", name: "update_plan", arguments: JSON.stringify({ todos: [{ content: "定位 App.tsx", status: "completed" }] }) }] });
      }
      return Response.json({ id: `resp-${n}`, output: [{ type: "message", content: [{ type: "output_text", text: "拆分方案如下。" }] }] });
    },
  });
  const prevEnv = { boot: process.env.SA_VM_BOOTSTRAP_DISABLED, chain: process.env.MINI_RESPONSES_CHAINING };
  process.env.SA_VM_BOOTSTRAP_DISABLED = "1";
  delete process.env.MINI_RESPONSES_CHAINING;
  const bridge = new MiniBridge({ resolveRelayTarget: async () => ({ baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "k", protocol: "responses" as const, streamMaxRetries: 0 }) });
  try {
    const started = await bridge.request("thread/start", { cwd, providerId: "fixture", model, sandbox: "danger-full-access", approvalPolicy: "never" }) as { thread: { id: string } };
    const prompt = "评估任务，如果要将App.tsx按最小单元模块拆分再组合，你给出什么方案？";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("turn timeout")), 15000);
      bridge.on("notification", (n: any) => {
        if (n.method === "turn/completed") { clearTimeout(timer); resolve(); }
        if (n.method === "turn/failed") { clearTimeout(timer); reject(new Error(JSON.stringify(n.params))); }
      });
      void bridge.request("turn/start", { threadId: started.thread.id, prompt }).catch(reject);
    });
    return bodies;
  } finally {
    if (prevEnv.boot === undefined) delete process.env.SA_VM_BOOTSTRAP_DISABLED; else process.env.SA_VM_BOOTSTRAP_DISABLED = prevEnv.boot;
    if (prevEnv.chain !== undefined) process.env.MINI_RESPONSES_CHAINING = prevEnv.chain;
    bridge.stop(); server.stop(true); rmSync(cwd, { recursive: true, force: true });
  }
}

test("OpenAI model on a relay: round 2 resends the user request without previous_response_id", async () => {
  const bodies = await runTwoRounds("gpt-6.1-sol");
  expect(bodies.length).toBeGreaterThanOrEqual(2);
  const round2 = bodies[1];
  expect(round2.previous_response_id).toBeUndefined();
  expect(JSON.stringify(round2.input)).toContain("App.tsx按最小单元模块拆分");
  expect(JSON.stringify(round2.input)).toContain("c1");
});

test("non-OpenAI model on a relay keeps previous_response_id chaining", async () => {
  const bodies = await runTwoRounds("deepseek-v3");
  expect(bodies.length).toBeGreaterThanOrEqual(2);
  expect(bodies[1].previous_response_id).toBe("resp-1");
});
