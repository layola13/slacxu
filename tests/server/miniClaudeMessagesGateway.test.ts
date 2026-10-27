import { afterEach, expect, test } from "bun:test";
import type { ChannelGroupConfig, ProviderConfig, RelayResponseProtocol } from "@codex-ui/shared";
import { miniChatThreadToAnthropicBody } from "../../backends/mini/src/runtime/miniBridge.ts";
import { runRelayAnthropicRequest } from "../../backends/relay-config/src/relay/relayProtocolGateway.ts";

const originalFetch = globalThis.fetch;
const model = "claude-haiku-5-5";
const provider: ProviderConfig = {
  id: "test", kind: "responsesRelay", name: "Test", baseUrl: "https://relay.example/v1",
  nativeModels: [model], modelAliases: [], defaultModel: model,
};

function group(protocol: RelayResponseProtocol): ChannelGroupConfig {
  return {
    id: "mixed", name: "Mixed", groupRatio: 1, models: [model],
    responseProtocol: protocol, responseProtocolMode: "fixed",
    authType: "inherit", credentialMode: "group", keys: ["test-key"],
  };
}

function request(body: Record<string, unknown>): Request {
  return new Request("http://127.0.0.1/api/relay-gateway/test/mixed/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "anthropic-beta": "interleaved-thinking-2025-05-14" },
    body: JSON.stringify(body),
  });
}

function miniBody(stream: boolean): Record<string, unknown> {
  return {
    ...miniChatThreadToAnthropicBody([{ role: "user", content: "ping" }], {
      model, tools: [], effort: "high",
    }),
    stream,
  };
}

function mockFetch(response: () => Response) {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({
      url: String(url), body: JSON.parse(await new Response(init?.body).text()),
      headers: new Headers(init?.headers),
    });
    return response();
  }) as typeof fetch;
  return calls;
}

afterEach(() => { globalThis.fetch = originalFetch; });

for (const protocol of ["openai", "openai-response", "anthropic", "gemini"] as const) {
  for (const stream of [false, true]) {
    test(`Mini Claude preserves native Messages with ${protocol} group default (stream=${stream})`, async () => {
      const upstreamText = stream
        ? 'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        : JSON.stringify({ id: "msg_test", type: "message", content: [{ type: "text", text: "pong" }] });
      const calls = mockFetch(() => new Response(upstreamText, {
        headers: { "Content-Type": stream ? "text/event-stream" : "application/json" },
      }));
      const body = miniBody(stream);
      body.messages = [
        { role: "user", content: "first" },
        { role: "assistant", content: [
          { type: "thinking", thinking: "reasoning", signature: "original-signature" },
          { type: "text", text: "answer" },
        ] },
        { role: "user", content: [{ type: "text", text: "ping", cache_control: { type: "ephemeral" } }] },
      ];
      body.tools = [{ name: "read_file", description: "Read", input_schema: { type: "object" } }];
      const response = await runRelayAnthropicRequest({ request: request(body), provider, group: group(protocol), apiKey: "test-key" });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(upstreamText);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://relay.example/v1/messages");
      expect(calls[0]?.body.thinking).toEqual({ type: "adaptive" });
      expect(calls[0]?.body.output_config).toEqual({ effort: "high" });
      expect(calls[0]?.body.reasoning).toBeUndefined();
      expect(calls[0]?.body.reasoning_effort).toBeUndefined();
      expect(calls[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
      expect(calls[0]?.headers.get("anthropic-beta")).toBe("interleaved-thinking-2025-05-14");
    });
  }
}

for (const [requestedModel, selectedModel] of [[model, "upstream-alias"], ["local-alias", model]]) {
  test(`keeps Messages when model mapping is ${requestedModel} -> ${selectedModel}`, async () => {
    const calls = mockFetch(() => Response.json({ type: "message", content: [] }));
    const body = { ...miniBody(false), model: requestedModel };
    const mappedGroup = { ...group("openai-response"), modelMapping: [{ from: requestedModel!, to: selectedModel! }] };
    const response = await runRelayAnthropicRequest({ request: request(body), provider, group: mappedGroup, apiKey: "test-key" });
    expect(response.status).toBe(200);
    expect(calls[0]?.url).toBe("https://relay.example/v1/messages");
    expect(calls[0]?.body).toEqual({ ...body, model: selectedModel });
  });
}

for (const status of [400, 404, 405]) {
  test(`Claude Messages upstream ${status} never falls back to Chat or Responses`, async () => {
    const calls = mockFetch(() => Response.json({ error: "Messages unsupported" }, { status }));
    const response = await runRelayAnthropicRequest({ request: request(miniBody(true)), provider, group: group("openai-response"), apiKey: "test-key" });
    expect(response.status).toBe(status);
    await response.text();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://relay.example/v1/messages");
  });
}

test("Claude capability mismatch fails instead of translating to OpenAI", async () => {
  const calls = mockFetch(() => Response.json({}));
  const incompatibleProvider: ProviderConfig = {
    ...provider,
    capabilityCatalog: {
      schema: "codex-react-ui.relay-catalog.v1", success: true,
      data: [{ model_name: model, enable_groups: ["mixed"], supported_endpoint_types: ["openai-response"] }],
      auto_groups: [], group_ratio: {}, usable_group: {}, supported_endpoint: {}, vendors: [],
    },
  };
  const response = await runRelayAnthropicRequest({ request: request(miniBody(false)), provider: incompatibleProvider, group: group("openai-response"), apiKey: "test-key" });
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("does not support group protocol anthropic");
  expect(calls).toHaveLength(0);
});
