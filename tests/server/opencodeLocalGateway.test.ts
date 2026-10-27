import { afterEach, describe, expect, test } from "bun:test";
import type { ChannelGroupConfig, ProviderConfig } from "@codex-ui/shared";
import {
  canonicalToPlainPrompt,
  isEmbeddedOpencodeLocalGroup,
  runRelayChatRequest,
  setEmbeddedOpencodeRunner,
} from "../../backends/relay-config/src/relay/relayProtocolGateway.ts";

function opencodeLocalFixtures() {
  const group = {
    id: "default",
    name: "default",
    baseUrl: "http://127.0.0.1:4096",
    kind: "text",
    status: "enabled",
    groupRatio: 1,
    models: ["opencode/muse-spark-1.3-contributor-free"],
    responseProtocol: "openai-response",
    responseProtocolMode: "fixed",
    authType: "none",
    credentialMode: "group",
    keyMode: "single",
    keys: [],
  } as unknown as ChannelGroupConfig;
  const provider = {
    id: "opencode-local",
    name: "OpenCode 本地",
    kind: "responsesRelay",
    baseUrl: "http://127.0.0.1:4096",
    defaultModel: "opencode/muse-spark-1.3-contributor-free",
    groups: [group],
  } as unknown as ProviderConfig;
  return { group, provider };
}

function chatRequest(model: string, text: string): Request {
  return new Request("http://127.0.0.1:43121/api/relay-gateway/opencode-local/default/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: text }], stream: false }),
  });
}

afterEach(() => {
  setEmbeddedOpencodeRunner(null);
});

describe("opencode-local embedded gateway (mini-opencodex)", () => {
  test("provider-scoped detection (never hijacks other relays)", () => {
    const { provider } = opencodeLocalFixtures();
    expect(isEmbeddedOpencodeLocalGroup(provider)).toBe(true);
    expect(isEmbeddedOpencodeLocalGroup({ ...provider, id: "omniroute-free" } as ProviderConfig)).toBe(false);
    expect(isEmbeddedOpencodeLocalGroup(undefined)).toBe(false);
  });

  test("canonical prompt retains everything: instructions, system, tools, calls, results", () => {
    const prompt = canonicalToPlainPrompt({
      model: "opencode/muse-spark-1.3-contributor-free",
      instructions: "Be brief.",
      messages: [
        { role: "system", content: [{ type: "text", text: "sys" }] },
        { role: "user", content: [{ type: "text", text: "hello" }, { type: "image", url: "data:x", mimeType: "image/png" }] },
        {
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
          toolCalls: [{ id: "c1", name: "get_weather", arguments: "{\"city\":\"Paris\"}" }],
        },
        { role: "tool", toolCallId: "c1", content: [{ type: "text", text: "sunny" }] },
        { role: "user", content: [{ type: "text", text: "bye" }] },
      ],
      tools: [{
        name: "get_weather", responseName: "get_weather", description: "Get weather",
        inputSchema: { type: "object" }, responseType: "function_call",
      }],
    });
    expect(prompt).toContain("[Instructions]\nBe brief.");
    expect(prompt).toContain("[System]\nsys");
    expect(prompt).toContain("[Function get_weather]");
    expect(prompt).toContain("Get weather");
    expect(prompt).toContain("[Tool call id=c1 name=get_weather]");
    expect(prompt).toContain("Paris");
    expect(prompt).toContain("[Tool result (for c1)]");
    expect(prompt).toContain("sunny");
    expect(prompt).toContain("User: hello");
    expect(prompt).toContain("image omitted");
    expect(prompt).toContain("Assistant: hi");
    expect(prompt).toContain("User: bye");
    expect(prompt.indexOf("[Instructions]")).toBeLessThan(prompt.indexOf("User: hello"));
    expect(prompt.indexOf("User: hello")).toBeLessThan(prompt.indexOf("User: bye"));
  });

  test("chat completions runs through the injected runner (no HTTP forward)", async () => {
    const { group, provider } = opencodeLocalFixtures();
    let seen: { model: string; prompt: string } | null = null;
    setEmbeddedOpencodeRunner(async (input) => {
      seen = { model: input.model, prompt: input.prompt };
      return { text: "LOCALBRIDGE_OK" };
    });
    const res = await runRelayChatRequest({
      request: chatRequest("opencode/muse-spark-1.3-contributor-free", "say LOCALBRIDGE_OK"),
      provider, group, apiKey: "loopback",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { choices: Array<{ message: { content: string } }> };
    expect(body.choices[0].message.content).toContain("LOCALBRIDGE_OK");
    expect(seen?.model).toBe("opencode/muse-spark-1.3-contributor-free");
    expect(seen?.prompt ?? "").toContain("say LOCALBRIDGE_OK");
  });

  test("fails closed with 502 when no runner is wired", async () => {
    const { group, provider } = opencodeLocalFixtures();
    const res = await runRelayChatRequest({
      request: chatRequest("opencode/muse-spark-1.3-contributor-free", "hi"),
      provider, group, apiKey: "loopback",
    });
    expect(res.status).toBe(502);
  });

  test("streaming chat flushes live deltas in order then DONE", async () => {
    const { group, provider } = opencodeLocalFixtures();
    setEmbeddedOpencodeRunner(async (input) => {
      input.onDelta?.("AAA");
      input.onDelta?.("BBB");
      return { text: "AAABBB" };
    });
    const res = await runRelayChatRequest({
      request: new Request("http://127.0.0.1:43121/api/relay-gateway/opencode-local/default/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "opencode/muse-spark-1.3-contributor-free",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        }),
      }),
      provider, group, apiKey: "loopback",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
    const body = await res.text();
    const aaa = body.indexOf('"content":"AAA"');
    const bbb = body.indexOf('"content":"BBB"');
    expect(aaa).toBeGreaterThan(-1);
    expect(bbb).toBeGreaterThan(aaa);
    expect(body).toContain('"finish_reason":"stop"');
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  test("extractJsonToolCall recovers strict JSON calls, rejects the rest", async () => {
    const mod = await import("../../backends/relay-config/src/relay/relayProtocolGateway.ts");
    expect(mod.extractJsonToolCall('{"name":"get_weather","arguments":{"city":"Paris"}}', ["get_weather"])?.name).toBe("get_weather");
    expect(mod.extractJsonToolCall('```json\n{"name":"get_weather","arguments":{}}\n```', ["get_weather"])?.arguments).toBe("{}");
    expect(mod.extractJsonToolCall("just text", ["get_weather"])).toBeNull();
    expect(mod.extractJsonToolCall('{"name":"other","arguments":{}}', ["get_weather"])).toBeNull();
    expect(mod.extractJsonToolCall('{"name":"get_weather"}', [])).toBeNull();
    // Mixed prose + JSON must NOT become a tool call: normal answers often
    // contain a JSON example, and swallowing them wipes the visible answer
    // (text -> "" + tool_calls renders as blank after completion).
    expect(mod.extractJsonToolCall(
      'Sure, calling it now: {"name": "get_weather", "arguments": {"city": "Paris"}} done.',
      ["get_weather"],
    )).toBeNull();
    expect(mod.extractJsonToolCall('nope {"name":"other"} then {"name":"get_weather","arguments":{}}', ["get_weather"]))
      .toBeNull();
    // Prose answer with a JSON example for a declared tool stays plain text.
    expect(mod.extractJsonToolCall(
      '可以用 read_file 查看，这是示例：{"name": "read_file", "arguments": {"path": "a.ts"}} 请参考。',
      ["read_file", "edit_file"],
    )).toBeNull();
  });

  test("declared tools come back as client-executable tool_calls", async () => {
    const { group, provider } = opencodeLocalFixtures();
    setEmbeddedOpencodeRunner(async () => ({
      text: '{"name":"get_weather","arguments":{"city":"Paris"}}',
    }));
    const res = await runRelayChatRequest({
      request: new Request("http://127.0.0.1:43121/api/relay-gateway/opencode-local/default/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "opencode/muse-spark-1.3-contributor-free",
          messages: [{ role: "user", content: "weather in Paris?" }],
          tools: [{ type: "function", function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } } }],
          stream: false,
        }),
      }),
      provider, group, apiKey: "loopback",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      choices: Array<{ finish_reason: string; message: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>;
    };
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.choices[0].message.tool_calls?.[0]?.function.name).toBe("get_weather");
    expect(body.choices[0].message.tool_calls?.[0]?.function.arguments).toContain("Paris");
  });

  test("rate-limit failures surface as 429, others as 502", async () => {
    const mod = await import("../../backends/relay-config/src/relay/relayProtocolGateway.ts");
    expect(mod.embeddedOpencodeErrorStatus("upstream 429 Too Many Requests")).toBe(429);
    expect(mod.embeddedOpencodeErrorStatus("RATE_LIMIT_EXCEEDED")).toBe(429);
    expect(mod.embeddedOpencodeErrorStatus("insufficient_quota")).toBe(429);
    expect(mod.embeddedOpencodeErrorStatus("boom")).toBe(502);
    const { group, provider } = opencodeLocalFixtures();
    setEmbeddedOpencodeRunner(async () => { throw new Error("429 rate limited, retry later"); });
    const res = await runRelayChatRequest({
      request: chatRequest("opencode/muse-spark-1.3-contributor-free", "hi"),
      provider, group, apiKey: "loopback",
    });
    expect(res.status).toBe(429);
  });

  test("failed local turn never retries (single attempt)", async () => {
    const { group, provider } = opencodeLocalFixtures();
    let calls = 0;
    setEmbeddedOpencodeRunner(async () => {
      calls += 1;
      throw new Error("boom");
    });
    const res = await runRelayChatRequest({
      request: chatRequest("opencode/muse-spark-1.3-contributor-free", "hi"),
      provider, group, apiKey: "loopback",
    });
    expect(res.status).toBe(502);
    expect(calls).toBe(1);
  });
});
