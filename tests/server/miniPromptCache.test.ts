import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";
import { resolveRelayGatewayTarget } from "../../apps/server/src/relayRuntimeSelection.ts";

for (const protocol of ["chat", "responses"] as const) {
  describe(`${protocol} Mini prompt caching`, () => {
    test("keeps identity, system, tools and actual tool history stable across turns", async () => {
      const cwd = mkdtempSync(join(tmpdir(), "mini-prompt-cache-"));
      const requests: Array<{ body: any; headers: Headers }> = [];
      let turn = 0;
      let round = 0;
      const server = Bun.serve({
        hostname: "127.0.0.1", port: 0,
        async fetch(request) {
          const body = await request.json();
          requests.push({ body, headers: new Headers(request.headers) });
          round++;
          const call = { id: "cache-tool", type: "function", function: { name: "update_plan", arguments: JSON.stringify({ todos: [{ content: "检查缓存", status: "completed" }] }) } };
          const text = turn === 1 ? "你好！第一轮检查已完成。" : "继续检查的第二轮已完成。";
          if (protocol === "chat") return Response.json({ choices: [{ message: round === 1 && turn === 1 ? { tool_calls: [call] } : { content: text }, finish_reason: round === 1 && turn === 1 ? "tool_calls" : "stop" }] });
          return Response.json({ output: round === 1 && turn === 1
            ? [{ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments }]
            : [{ type: "message", content: [{ type: "output_text", text }] }] });
        },
      });
      const bridge = new MiniBridge({ resolveRelayTarget: async () => ({ baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "fixture", protocol, streamMaxRetries: 0 }) });
      const setting = process.env.SA_VM_BOOTSTRAP_DISABLED;
      process.env.SA_VM_BOOTSTRAP_DISABLED = "1";
      try {
        const started = await bridge.request("thread/start", { cwd, providerId: "fixture", model: "fixture-model", sandbox: "danger-full-access", approvalPolicy: "never" }) as { thread: { id: string } };
        const threadId = started.thread.id;
        async function run(prompt: string) {
          turn++; round = 0;
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { bridge.off("notification", handler); reject(new Error("turn timeout")); }, 15000);
            function handler(n: any) {
              if (n.method !== "turn/completed" && n.method !== "turn/failed") return;
              clearTimeout(timer); bridge.off("notification", handler);
              if (n.method === "turn/failed") reject(new Error(JSON.stringify(n.params)));
              else resolve();
            }
            bridge.on("notification", handler);
            void bridge.request("turn/start", { threadId, prompt }).catch((e) => { clearTimeout(timer); bridge.off("notification", handler); reject(e); });
          });
        }
        await run("你好");
        const firstCount = requests.length;
        expect(firstCount).toBe(2);
        await run("继续");
        const first = requests[0].body;
        const last = requests[firstCount - 1].body;
        const next = requests[firstCount].body;
        expect(next.prompt_cache_key).toBe(first.prompt_cache_key);
        expect(next.prompt_cache_key).toMatch(/^[a-f0-9]{64}$/);
        expect(next.prompt_cache_key).not.toBe(threadId);
        for (const request of requests) {
          expect(request.headers.get("x-ultra-thread-id")).toBe(threadId);
          expect(resolveRelayGatewayTarget(request.headers, { providerId: "fixture", groupId: "g" }, () => null).threadId).toBe(threadId);
        }
        expect(next.tools).toEqual(first.tools);
        const names = next.tools.map((t: any) => t.name ?? t.function.name);
        expect(names).toEqual([...names].sort());
        if (protocol === "chat") {
          expect(next.messages[0]).toEqual(first.messages[0]);
          expect(next.messages.slice(0, last.messages.length)).toEqual(last.messages);
          expect(JSON.stringify(next.messages.at(-1))).toContain("continue the in_progress plan step now");
          expect(JSON.stringify(next.messages[0])).not.toContain("earlier turns for background");
        } else {
          expect(next.instructions).toBe(first.instructions);
          expect(next.input.slice(0, last.input.length)).toEqual(last.input);
          expect(JSON.stringify(next.input.at(-1))).toContain("continue the in_progress plan step now");
          expect(next.previous_response_id).toBeUndefined();
        }
        expect(JSON.stringify(next)).toContain("cache-tool");
        if (protocol === "chat") {
          expect(JSON.stringify(next)).toContain("第一轮检查已完成");
        } else {
          // Responses never replays assistant text into input (strict
          // gateways 400 on role:"assistant"); tool history still rides.
          expect(JSON.stringify(next)).not.toContain("第一轮检查已完成");
        }
      } finally {
        if (setting === undefined) delete process.env.SA_VM_BOOTSTRAP_DISABLED;
        else process.env.SA_VM_BOOTSTRAP_DISABLED = setting;
        bridge.stop(); server.stop(true); rmSync(cwd, { recursive: true, force: true });
      }
    });
  });
}
