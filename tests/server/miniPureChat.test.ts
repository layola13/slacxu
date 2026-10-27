import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MINI_PURE_CHAT_SYSTEM, MiniBridge } from "../../backends/mini/src/runtime/miniBridge.js";

describe("mini pure-chat mode (side chat duck route)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const freshCwd = () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-pure-"));
    dirs.push(dir);
    return dir;
  };

  test("pure system prompt is text-only and language-aware", () => {
    expect(MINI_PURE_CHAT_SYSTEM).toContain("text only");
    expect(MINI_PURE_CHAT_SYSTEM).toContain("SAME language");
    expect(MINI_PURE_CHAT_SYSTEM).not.toContain("sa_vm");
    expect(MINI_PURE_CHAT_SYSTEM).not.toContain("mcp__");
  });

  test("thread/start accepts the pureChat flag", async () => {
    const bridge = new MiniBridge({});
    const res = (await bridge.request("thread/start", {
      cwd: freshCwd(),
      model: "gpt-6-luna",
      providerId: "omniroute-free",
      groupId: "d2api",
      pureChat: true,
    })) as unknown as { thread?: { id?: string } };
    expect(typeof res.thread?.id).toBe("string");
  });

  test("thread/start without the flag stays agentic", async () => {
    const bridge = new MiniBridge({});
    const res = (await bridge.request("thread/start", {
      cwd: freshCwd(),
      model: "gpt-6-luna",
    })) as unknown as { thread?: { id?: string } };
    expect(typeof res.thread?.id).toBe("string");
  });

  test("pure turn completes text-only with minimal system and no tools", async () => {
    const seen: Array<{ url: string; body: any }> = [];
    const sse = [
      'data: {"id":"chatcmpl-x","object":"chat.completion.chunk","created":1,"model":"gpt-6-luna","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi there"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-x","object":"chat.completion.chunk","created":1,"model":"gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/chat/completions") {
          seen.push({ url: req.url, body: await req.json().catch(() => null) });
          return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const bridge = new MiniBridge({
        resolveRelayTarget: async () => ({
          baseUrl: `http://127.0.0.1:${server.port}`,
          apiKey: "stub",
          protocol: "chat" as const,
        }),
      });
      const started = (await bridge.request("thread/start", {
        cwd: freshCwd(),
        model: "gpt-6-luna",
        providerId: "omniroute-free",
        groupId: "d2api",
        pureChat: true,
      })) as unknown as { thread?: { id?: string } };
      const threadId = String(started.thread?.id ?? "");
      expect(threadId).not.toBe("");

      const done = new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, error: "timeout waiting for turn/completed" }), 30_000);
        bridge.on("notification", (msg: any) => {
          const method = msg?.method;
          const params = msg?.params ?? {};
          if (params.threadId !== threadId) return;
          if (method === "turn/completed") {
            clearTimeout(timer);
            resolve({ ok: true });
          } else if (method === "turn/failed") {
            clearTimeout(timer);
            resolve({ ok: false, error: String(params?.error ?? "turn failed") });
          }
        });
      });
      await bridge.request("turn/start", {
        threadId,
        input: [{ type: "text", text: "hi" }],
        model: "gpt-6-luna",
        providerId: "omniroute-free",
        groupId: "d2api",
        pureChat: true,
      });
      const result = await done;
      expect(result).toEqual({ ok: true });

      expect(seen.length).toBe(1);
      const body = seen[0]!.body;
      // No tools advertised, no web_search unless requested.
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
      expect(body.web_search).toBeUndefined();
      // Minimal pure system prompt, not the 21KB agent assembly.
      const system = Array.isArray(body.messages)
        ? body.messages.filter((m: any) => m?.role === "system")
        : [];
      expect(system.length).toBeGreaterThan(0);
      const systemContents = system.map((m: any) => m?.content ?? "");
      // First system message is the minimal pure prompt (a later summary
      // directive may follow; both are plain text, no tools).
      expect(systemContents[0]).toBe(MINI_PURE_CHAT_SYSTEM);
      const systemText = JSON.stringify(systemContents);
      expect(systemText).not.toContain("sa_vm");
      expect(systemText).not.toContain("mcp__");
      expect(systemText).not.toContain("AGENTS.md");
      // Plain dialogue message present.
      expect(JSON.stringify(body.messages)).toContain("hi");
    } finally {
      server.stop(true);
    }
  }, 60_000);

  test("web_search flag rides the raw relay payload", async () => {
    const seen: Array<{ body: any }> = [];
    const sse = [
      'data: {"id":"chatcmpl-x","object":"chat.completion.chunk","created":1,"model":"gpt-6-luna","choices":[{"index":0,"delta":{"role":"assistant","content":"sunny"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-x","object":"chat.completion.chunk","created":1,"model":"gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/chat/completions") {
          seen.push({ body: await req.json().catch(() => null) });
          return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const bridge = new MiniBridge({
        resolveRelayTarget: async () => ({
          baseUrl: `http://127.0.0.1:${server.port}`,
          apiKey: "stub",
          protocol: "chat" as const,
        }),
      });
      const started = (await bridge.request("thread/start", {
        cwd: freshCwd(),
        model: "gpt-6-luna",
        providerId: "omniroute-free",
        groupId: "d2api",
        pureChat: true,
      })) as unknown as { thread?: { id?: string } };
      const threadId = String(started.thread?.id ?? "");
      const done = new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), 30_000);
        bridge.on("notification", (msg: any) => {
          const params = msg?.params ?? {};
          if (params.threadId !== threadId) return;
          if (msg?.method === "turn/completed") {
            clearTimeout(timer);
            resolve({ ok: true });
          } else if (msg?.method === "turn/failed") {
            clearTimeout(timer);
            resolve({ ok: false, error: String(params?.error ?? "turn failed") });
          }
        });
      });
      await bridge.request("turn/start", {
        threadId,
        input: [{ type: "text", text: "广州天气" }],
        model: "gpt-6-luna",
        providerId: "omniroute-free",
        groupId: "d2api",
        pureChat: true,
        web_search: true,
      });
      const result = await done;
      expect(result).toEqual({ ok: true });
      expect(seen.length).toBe(1);
      expect(seen[0]!.body.web_search).toBe(true);
      expect(seen[0]!.body.tools).toBeUndefined();
    } finally {
      server.stop(true);
    }
  }, 60_000);
});
