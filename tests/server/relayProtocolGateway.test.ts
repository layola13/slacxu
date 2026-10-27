import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChannelGroupConfig, ProviderConfig, RelayResponseProtocol } from "@codex-ui/shared";
import {
  FREE_CHANNEL_EGRESS_MODE,
  FREE_CHANNEL_MAX_DELAY_MS,
  FREE_CHANNEL_RETRY_DELAYS_MS,
  ignoredProxyPoolEnvKeys,
  isFreeChannelGroup,
  noteDirectEgressOnly,
  joinRelayEndpoint,
  orderedRelayKeys,
  resolveFreeRetryDelayMs,
  resolveProtocolEndpoint,
  runNativeAnthropicRequest,
  runRelayAnthropicRequest,
  runRelayChatRequest,
  runRelayChatRequestWithKeyFailover,
  runRelayJevRequest,
  runRelayJevRequestWithKeyFailover,
  runRelayProtocolRequest,
  runRelayProtocolRequestWithKeyFailover,
  summarizeResponsesRequestTools
} from "../../backends/relay-config/src/relay/relayProtocolGateway.ts";
import { clearFreebuffSession } from "../../backends/relay-config/src/relay/freebuffSession.ts";
import {
  OPENCODE_KERNEL_CHAT_USER_AGENT,
  OPENCODE_KERNEL_RESPONSES_USER_AGENT,
  OPENCODE_REQUEST_PATTERN,
  OPENCODE_SESSION_PATTERN
} from "../../backends/relay-config/src/relay/omniRouteFree.ts";

const originalFetch = globalThis.fetch;
const golden = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/relayProtocolGolden.json"), "utf8")) as {
  parallelToolContinuation: {
    input: unknown[];
    expected: {
      openaiMessages: unknown[];
      anthropicMessages: unknown[];
      geminiContents: unknown[];
    };
  };
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function provider(): ProviderConfig {
  return {
    id: "deepkey",
    kind: "responsesRelay",
    name: "DeepKey",
    baseUrl: "https://deepkey.top/v1",
    nativeModels: ["test-model"],
    modelAliases: [],
    defaultModel: "test-model"
  };
}

function group(protocol: RelayResponseProtocol): ChannelGroupConfig {
  return {
    id: protocol,
    name: protocol,
    groupRatio: 1,
    models: ["test-model"],
    responseProtocol: protocol,
    responseProtocolMode: "fixed",
    authType: "inherit",
    credentialMode: "group",
    keys: ["test-key"]
  };
}

function request(stream = false, reasoningEffort = "high", model = "test-model"): Request {
  return new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: reasoningEffort, summary: "auto" },
      instructions: "Be concise",
      input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
      tools: [{ type: "function", name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
      stream
    })
  });
}

function anthropicRequest(stream = false): Request {
  return new Request("http://127.0.0.1/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": "local" },
    body: JSON.stringify({
      model: "test-model",
      max_tokens: 128,
      system: "Be concise",
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      tools: [{ name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } }],
      stream
    })
  });
}

function ollamaProvider(): ProviderConfig {
  return { ...provider(), id: "free-ollama", kind: "ollama", name: "Free Ollama", baseUrl: "http://ollama.example/v1" };
}

function namespacedAgentRequest(stream = false): Request {
  return new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      input: [{ role: "user", content: [{ type: "input_text", text: "create an agent" }] }],
      tools: [{
        type: "namespace",
        name: "collaboration",
        description: "Multi-agent collaboration tools",
        tools: [{
          type: "function",
          name: "spawn_agent",
          description: "Create a child agent",
          parameters: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"]
          }
        }]
      }],
      stream
    })
  });
}

function toolContinuationRequest(): Request {
  return new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      instructions: "Use both results",
      input: golden.parallelToolContinuation.input,
      tools: [{ type: "function", name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } }],
      parallel_tool_calls: true
    })
  });
}

function mockFetch(responseBody: unknown): Array<{ url: string; headers: Headers; body: Record<string, unknown> }> {
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const bodyText = typeof init?.body === "string"
      ? init.body
      : init?.body == null
        ? "{}"
        : await new Response(init.body).text();
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(bodyText) as Record<string, unknown>
    });
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

function mockSseFetch(chunks: string[]): Array<{ url: string; headers: Headers; body: Record<string, unknown> }> {
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  return calls;
}

test("joins versioned relay paths without duplicating v1", () => {
  expect(joinRelayEndpoint("https://deepkey.top/v1", "/v1/messages")).toBe("https://deepkey.top/v1/messages");
  expect(joinRelayEndpoint("https://deepkey.top/v1", "/v1beta/models/x:generateContent")).toBe("https://deepkey.top/v1beta/models/x:generateContent");
  expect(joinRelayEndpoint("https://relay.example/prefix", "/v1/responses")).toBe("https://relay.example/prefix/v1/responses");
});

test("rejects a catalog model that does not support the fixed group protocol before fetch", async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response("{}");
  }) as typeof fetch;
  const incompatibleProvider: ProviderConfig = {
    ...provider(),
    capabilityCatalog: {
      schema: "codex-react-ui.relay-catalog.v1",
      success: true,
      auto_groups: [],
      data: [{ model_name: "test-model", enable_groups: ["anthropic"], supported_endpoint_types: ["openai"] }],
      group_ratio: {},
      usable_group: {},
      supported_endpoint: {},
      vendors: [],
      imported_at: 1,
      source_hash: "fixture",
      warnings: []
    }
  };

  const response = await runRelayProtocolRequest({
    request: request(),
    provider: incompatibleProvider,
    group: group("anthropic"),
    apiKey: "test-key"
  });
  const body = await response.json() as { error?: { message?: string } };
  expect(response.status).toBe(400);
  expect(body.error?.message).toContain("does not support group protocol anthropic");
  expect(fetchCalls).toBe(0);
});

test("converts Responses requests and Chat Completions tool calls", async () => {
  const calls = mockFetch({
    model: "test-model",
    choices: [{ finish_reason: "tool_calls", message: { content: "", tool_calls: [{ id: "call_1", function: { name: "read_file", arguments: "{\"path\":\"a.txt\"}" } }] } }],
    usage: { prompt_tokens: 11, completion_tokens: 4 }
  });

  const response = await runRelayProtocolRequest({ request: request(), provider: provider(), group: group("openai"), apiKey: "test-key" });
  const body = await response.json() as Record<string, unknown>;
  expect(calls[0]?.url).toBe("https://deepkey.top/v1/chat/completions");
  expect(calls[0]?.headers.get("Authorization")).toBe("Bearer test-key");
  expect(calls[0]?.body).toMatchObject({ model: "test-model", stream: false, reasoning_effort: "high" });
  expect((calls[0]?.body.messages as unknown[])).toHaveLength(2);
  expect((calls[0]?.body.tools as unknown[])).toHaveLength(1);
  expect(body.status).toBe("completed");
  expect((body.output as Array<Record<string, unknown>>)[0]).toMatchObject({ type: "function_call", call_id: "call_1", name: "read_file" });
});

test("forwards the Codex User-Agent to the upstream relay", async () => {
  const calls = mockFetch({
    model: "test-model",
    choices: [{ finish_reason: "stop", message: { content: "pong" } }]
  });
  const relayRequest = request();
  relayRequest.headers.set("User-Agent", "codex_react_ui/0.146.0 (Windows 11; x86_64) WindowsTerminal");

  const response = await runRelayProtocolRequest({ request: relayRequest, provider: provider(), group: group("openai"), apiKey: "test-key" });

  expect(response.status).toBe(200);
  expect(calls[0]?.headers.get("User-Agent")).toBe("codex_react_ui/0.146.0 (Windows 11; x86_64) WindowsTerminal");
});

test("runs a no-auth relay once without an Authorization header", async () => {
  const calls = mockFetch({
    model: "test-model",
    choices: [{ finish_reason: "stop", message: { content: "pong" } }]
  });
  const noAuthGroup = { ...group("openai"), authType: "none" as const, keys: [] };

  const response = await runRelayProtocolRequestWithKeyFailover({
    request: request(),
    provider: provider(),
    group: noAuthGroup,
    apiKeys: []
  });

  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.headers.has("Authorization")).toBe(false);
});

test("uses each group's Base URL instead of the provider Base URL", () => {
  const isolatedGroup = { ...group("openai"), baseUrl: "https://group.example/v1" };
  expect(resolveProtocolEndpoint(provider(), isolatedGroup, "openai", "test-model"))
    .toBe("https://group.example/v1/chat/completions");
});

test("accepts a relay configured only with a group Base URL", async () => {
  const calls = mockFetch({ model: "test-model", choices: [{ message: { content: "pong" }, finish_reason: "stop" }] });
  const groupOnlyProvider = { ...provider(), baseUrl: undefined };
  const isolatedGroup = { ...group("openai"), baseUrl: "https://group-only.example/v1" };

  const response = await runRelayProtocolRequest({
    request: request(),
    provider: groupOnlyProvider,
    group: isolatedGroup,
    apiKey: "test-key"
  });

  expect(response.status).toBe(200);
  expect(calls[0]?.url).toBe("https://group-only.example/v1/chat/completions");
});

test("turns image tool continuation 429s into delayed Responses retry events", async () => {
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    calls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({ error: { message: "Image token rate limit reached" } }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "7" }
    });
  }) as typeof fetch;
  const imageRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      stream: true,
      input: [
        { type: "function_call", call_id: "call_image", name: "view_image", arguments: "{}" },
        {
          type: "function_call_output",
          call_id: "call_image",
          output: [{ type: "input_image", image_url: "data:image/png;base64,Zm9v", detail: "high" }]
        }
      ]
    })
  });

  const response = await runRelayProtocolRequest({
    request: imageRequest,
    provider: provider(),
    group: group("openai-response"),
    apiKey: "test-key"
  });
  const body = await response.text();

  expect(calls).toHaveLength(1);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  expect(response.headers.get("Retry-After")).toBe("7");
  expect(body).toContain("response.failed");
  expect(body).toContain("rate_limit_exceeded");
  expect(body).toContain("Please try again in 7s");
  expect(body).not.toContain("Zm9v");
});

test("keeps image tool outputs as native image parts for Chat Completions", async () => {
  const calls = mockFetch({
    model: "test-model",
    choices: [{ message: { content: "done" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 1 }
  });
  const imageUrl = "data:image/png;base64,Zm9v";
  const imageRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      input: [
        { type: "function_call", call_id: "call_image", name: "view_image", arguments: "{}" },
        { type: "function_call_output", call_id: "call_image", output: [{ type: "input_image", image_url: imageUrl, detail: "high" }] }
      ]
    })
  });

  await runRelayProtocolRequest({ request: imageRequest, provider: provider(), group: group("openai"), apiKey: "test-key" });

  const messages = calls[0]?.body.messages as Array<Record<string, unknown>>;
  expect(JSON.stringify(messages)).not.toContain(`[Image: ${imageUrl}]`);
  expect(messages).toContainEqual({ role: "tool", tool_call_id: "call_image", content: "[Image attached]" });
  expect(messages).toContainEqual({ role: "user", content: [{ type: "image_url", image_url: { url: imageUrl } }] });
});

test("keeps image tool outputs as native image parts for Responses upstreams", async () => {
  const calls = mockFetch({ id: "resp_done", object: "response", status: "completed", output: [] });
  const imageUrl = "data:image/jpeg;base64,Zm9v";
  const imageRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      input: [
        { type: "function_call", call_id: "call_image", name: "image_view", arguments: "{}" },
        { type: "function_call_output", call_id: "call_image", output: [{ type: "input_text", text: "viewed" }, { type: "input_image", image_url: imageUrl, detail: "high" }] }
      ]
    })
  });

  await runRelayProtocolRequest({ request: imageRequest, provider: provider(), group: group("openai-response"), apiKey: "test-key" });

  const upstreamInput = calls[0]?.body.input as Array<Record<string, unknown>>;
  const toolOut = upstreamInput.find((entry) => entry.type === "function_call_output") as Record<string, unknown>;
  const parts = toolOut.output as Array<Record<string, unknown>>;
  expect(parts).toContainEqual({ type: "input_text", text: "viewed" });
  expect(parts).toContainEqual({ type: "input_image", image_url: imageUrl, detail: "high" });
});

test("normalizes relay context-window failures for Codex auto-compaction", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: { message: "上下文超出模型窗口，请减少历史消息、文件内容或新开会话后重试", type: "relay_protocol_error", code: 400 }
  }), { status: 400, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  expect(body).toContain("response.failed");
  expect(body).toContain("context_length_exceeded");
});

test("keeps ordinary upstream 429 responses unchanged", async () => {
  globalThis.fetch = (async () => new Response("ordinary limit", {
    status: 429,
    headers: { "Content-Type": "text/plain", "Retry-After": "11" }
  })) as typeof fetch;

  const response = await runRelayProtocolRequest({
    request: request(true),
    provider: provider(),
    group: group("openai-response"),
    apiKey: "test-key"
  });

  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("11");
  expect(await response.text()).toBe("ordinary limit");
});

test("preserves parallel tool calls and tool-result continuation for each native protocol", async () => {
  const fixtures: Array<{
    protocol: "openai" | "anthropic" | "gemini";
    response: unknown;
    assertBody: (body: Record<string, unknown>) => void;
  }> = [
    {
      protocol: "openai",
      response: { model: "test-model", choices: [{ message: { content: "done" }, finish_reason: "stop" }] },
      assertBody(body) {
        const messages = body.messages as Array<Record<string, unknown>>;
        expect(messages).toEqual(golden.parallelToolContinuation.expected.openaiMessages);
      }
    },
    {
      protocol: "anthropic",
      response: { model: "test-model", content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: {} },
      assertBody(body) {
        const messages = body.messages as Array<Record<string, unknown>>;
        expect(messages).toEqual(golden.parallelToolContinuation.expected.anthropicMessages);
      }
    },
    {
      protocol: "gemini",
      response: { modelVersion: "test-model", candidates: [{ content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP" }], usageMetadata: {} },
      assertBody(body) {
        const contents = body.contents as Array<Record<string, unknown>>;
        expect(contents).toEqual(golden.parallelToolContinuation.expected.geminiContents);
      }
    }
  ];

  for (const fixture of fixtures) {
    const calls = mockFetch(fixture.response);
    const response = await runRelayProtocolRequest({
      request: toolContinuationRequest(),
      provider: provider(),
      group: group(fixture.protocol),
      apiKey: "test-key"
    });
    expect(response.status).toBe(200);
    fixture.assertBody(calls[0]!.body);
  }
});

test("converts Responses requests to Anthropic Messages and returns Responses SSE", async () => {
  const calls = mockFetch({
    id: "msg_1",
    model: "test-model",
    content: [
      { type: "thinking", thinking: "brief reasoning" },
      { type: "text", text: "pong" },
      { type: "tool_use", id: "tool_1", name: "read_file", input: { path: "a.txt" } }
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 12, output_tokens: 5, cache_read_input_tokens: 2 }
  });

  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  const body = await response.text();
  expect(calls[0]?.url).toBe("https://deepkey.top/v1/messages");
  expect(calls[0]?.headers.get("X-Api-Key")).toBe("test-key");
  expect(calls[0]?.headers.get("Anthropic-Version")).toBe("2023-06-01");
  expect(calls[0]?.body).toMatchObject({
    model: "test-model",
    system: [{ type: "text", text: "Be concise", cache_control: { type: "ephemeral" } }],
    stream: true,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" }
  });
  expect(body).toContain("event: response.created");
  expect(body).toContain("response.output_text.delta");
  expect(body).toContain("response.function_call_arguments.done");
  expect(body).toContain("event: response.completed");
});

test("incrementally translates split Chat SSE frames and tool argument chunks", async () => {
  const first = 'data: {"model":"test-model","choices":[{"delta":{"content":"po"}}]}\n\n';
  const second = 'data: {"choices":[{"delta":{"content":"ng","tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n';
  const third = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":9,"completion_tokens":4}}\n\ndata: [DONE]\n\n';
  const calls = mockSseFetch([first.slice(0, 23), first.slice(23) + second.slice(0, 41), second.slice(41), third]);

  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: group("openai"), apiKey: "test-key" });
  const body = await response.text();
  expect(calls[0]?.body.stream).toBe(true);
  expect(calls[0]?.body.stream_options).toEqual({ include_usage: true });
  expect(body).toContain('"delta":"po"');
  expect(body).toContain('"delta":"ng"');
  expect(body).toContain('"delta":"{\\"path\\":"');
  expect(body).toContain('"arguments":"{\\"path\\":\\"a.txt\\"}"');
  expect(body).toContain('"input_tokens":9');
  expect(body).toContain('"output_tokens":4');
  expect(body).toContain('"total_tokens":13');
  expect(body).toContain("event: response.completed");
});

test("smart-routes Claude Messages to OpenAI Chat and converts the response back", async () => {
  const calls = mockFetch({
    id: "chatcmpl_1",
    model: "test-model",
    choices: [{ message: { role: "assistant", content: "pong", tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }] }, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 12, completion_tokens: 5 }
  });
  const response = await runRelayAnthropicRequest({ request: anthropicRequest(), provider: provider(), group: group("openai"), apiKey: "test-key" });
  const body = await response.json() as Record<string, unknown>;
  expect(calls[0]?.url).toBe("https://deepkey.top/v1/chat/completions");
  expect(calls[0]?.body).toMatchObject({ model: "test-model", max_tokens: 128, stream: false });
  expect((calls[0]?.body.messages as Array<Record<string, unknown>>)[0]).toMatchObject({ role: "system", content: "Be concise" });
  expect(body).toMatchObject({ type: "message", role: "assistant", stop_reason: "tool_use" });
  expect(body.content).toEqual([
    { type: "text", text: "pong" },
    { type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.txt" } }
  ]);
});

test("recovers an omitted Chat tool name for non-streaming Claude calls", async () => {
  mockFetch({
    id: "chatcmpl_empty_name",
    model: "test-model",
    choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "", arguments: '{"path":"a.txt"}' } }] }, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 3, completion_tokens: 2 }
  });
  const response = await runRelayAnthropicRequest({ request: anthropicRequest(), provider: provider(), group: group("openai"), apiKey: "test-key" });
  const body = await response.json() as { content: Array<Record<string, unknown>> };
  expect(body.content).toContainEqual(expect.objectContaining({ type: "tool_use", name: "read_file" }));
});

test("recovers an omitted Chat tool name in streamed Claude calls", async () => {
  mockSseFetch([
    `data: ${JSON.stringify({ model: "test-model", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "", arguments: '{"path":"a.txt"}' } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`
  ]);
  const response = await runRelayAnthropicRequest({ request: anthropicRequest(true), provider: provider(), group: group("openai"), apiKey: "test-key" });
  const body = await response.text();
  expect(body).toContain('"type":"tool_use"');
  expect(body).toContain('"name":"read_file"');
  expect(body).not.toContain('"name":"tool"');
});

test("smart-routes Claude Messages to OpenAI Responses", async () => {
  const calls = mockFetch({
    id: "resp_1", object: "response", status: "completed", model: "test-model",
    output: [{ type: "message", content: [{ type: "output_text", text: "pong" }] }],
    usage: { input_tokens: 4, output_tokens: 2, input_tokens_details: { cached_tokens: 0 } }
  });
  const response = await runRelayAnthropicRequest({ request: anthropicRequest(), provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const body = await response.json() as Record<string, unknown>;
  expect(calls[0]?.url).toBe("https://deepkey.top/v1/responses");
  expect(calls[0]?.body).toMatchObject({ model: "test-model", stream: false });
  expect(body).toMatchObject({ type: "message", role: "assistant", stop_reason: "end_turn" });
  expect(body.content).toEqual([{ type: "text", text: "pong" }]);
});

test("preserves DeepKey Responses function names for streamed Claude tool calls", async () => {
  const added = {
    type: "response.output_item.added",
    output_index: 0,
    item: { id: "fc_exec", type: "function_call", call_id: "call_exec", name: "", arguments: "", status: "in_progress" }
  };
  const done = {
    type: "response.output_item.done",
    output_index: 0,
    item: { id: "fc_exec", type: "function_call", call_id: "call_exec", name: "exec_command", arguments: '{"cmd":"pwd"}', status: "completed" }
  };
  const completed = {
    type: "response.completed",
    response: { id: "resp_exec", model: "test-model", status: "completed", output: [done.item], usage: { input_tokens: 3, output_tokens: 2 } }
  };
  mockSseFetch([
    `event: response.output_item.added\ndata: ${JSON.stringify(added)}\n\n`,
    `event: response.function_call_arguments.delta\ndata: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_exec", delta: '{"cmd":"pwd"}' })}\n\n`,
    `event: response.output_item.done\ndata: ${JSON.stringify(done)}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify(completed)}\n\ndata: [DONE]\n\n`
  ]);

  const response = await runRelayAnthropicRequest({ request: anthropicRequest(true), provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const body = await response.text();
  expect(body).toContain('"type":"tool_use"');
  expect(body).toContain('"name":"exec_command"');
  expect(body).not.toContain('"name":"tool"');
  expect(body).toContain('"partial_json":"{\\"cmd\\":\\"pwd\\"}"');
});

test("preserves DeepKey Responses function names for non-streaming Claude tool calls", async () => {
  mockFetch({
    id: "resp_exec",
    model: "test-model",
    status: "completed",
    output: [{ type: "function_call", id: "fc_exec", call_id: "call_exec", name: "exec_command", arguments: '{"cmd":"pwd"}' }],
    usage: { input_tokens: 3, output_tokens: 2 }
  });
  const response = await runRelayAnthropicRequest({ request: anthropicRequest(), provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const body = await response.json() as { content: Array<Record<string, unknown>> };
  expect(body.content).toContainEqual(expect.objectContaining({ type: "tool_use", name: "exec_command" }));
});

test("smart-routes streamed Claude Messages to OpenAI Chat SSE", async () => {
  const calls = mockSseFetch([
    'data: {"model":"test-model","choices":[{"delta":{"content":"po"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"ng"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
    "data: [DONE]\n\n"
  ]);
  const response = await runRelayAnthropicRequest({ request: anthropicRequest(true), provider: provider(), group: group("openai"), apiKey: "test-key" });
  const body = await response.text();
  expect(calls[0]?.url).toBe("https://deepkey.top/v1/chat/completions");
  expect(body).toContain("event: message_start");
  expect(body).toContain('"text_delta","text":"po"');
  expect(body).toContain('"text_delta","text":"ng"');
  expect(body).toContain("event: message_stop");
});

test("serializes split parallel Chat tool calls into valid Anthropic block lifecycles", async () => {
  mockSseFetch([
    'data: {"model":"test-model","choices":[{"delta":{"content":"checking"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_0","function":{"name":"read_file","arguments":"{\\"path\\":"}},{"index":1,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}},{"index":1,"function":{"arguments":"\\"b.txt\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\n',
    "data: [DONE]\n\n"
  ]);

  const response = await runRelayAnthropicRequest({ request: anthropicRequest(true), provider: provider(), group: group("openai"), apiKey: "test-key" });
  const events = (await response.text())
    .split(/\r?\n\r?\n/)
    .map((frame) => frame.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim())
    .filter((data): data is string => Boolean(data))
    .map((data) => JSON.parse(data) as { type: string; index?: number; content_block?: { type?: string }; delta?: { partial_json?: string } });

  let activeBlock: number | undefined;
  const toolArguments: string[] = [];
  for (const event of events) {
    if (event.type === "content_block_start") {
      expect(activeBlock).toBeUndefined();
      activeBlock = event.index;
      if (event.content_block?.type === "tool_use") toolArguments.push("");
    } else if (event.type === "content_block_delta") {
      expect(event.index).toBe(activeBlock);
      if (event.delta?.partial_json != null) toolArguments[toolArguments.length - 1] += event.delta.partial_json;
    } else if (event.type === "content_block_stop") {
      expect(event.index).toBe(activeBlock);
      activeBlock = undefined;
    }
  }

  expect(activeBlock).toBeUndefined();
  expect(toolArguments).toEqual(['{"path":"a.txt"}', '{"path":"b.txt"}']);
  expect(events.filter((event) => event.type === "content_block_start" && event.content_block?.type === "tool_use")).toHaveLength(2);
  expect(events.find((event) => event.type === "message_delta")).toMatchObject({ delta: { stop_reason: "tool_use" } });
});

test("fails a translated Chat stream instead of completing truncated tool arguments", async () => {
  mockSseFetch([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_truncated","function":{"name":"read_file","arguments":"{\\"path\\":\\"unterminated"}}]}}]}' + "\n\n",
    "data: [DONE]\n\n"
  ]);

  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: group("openai"), apiKey: "test-key" });
  const body = await response.text();
  expect(body).toContain("event: response.failed");
  expect(body).toContain("Remote model stream ended before tool arguments were complete");
  expect(body).not.toContain("response.function_call_arguments.done");
  expect(body).not.toContain("event: response.completed");
});

test("fails a native Responses stream when function argument deltas end mid-JSON", async () => {
  const added = {
    type: "response.output_item.added",
    output_index: 0,
    item: { id: "fc_truncated", type: "function_call", call_id: "call_truncated", name: "read_file", arguments: "", status: "in_progress" }
  };
  const delta = {
    type: "response.function_call_arguments.delta",
    item_id: "fc_truncated",
    output_index: 0,
    delta: '{"path":"unterminated'
  };
  mockSseFetch([
    `event: response.output_item.added\ndata: ${JSON.stringify(added)}\n\n`,
    `event: response.function_call_arguments.delta\ndata: ${JSON.stringify(delta)}\n\n`,
    "data: [DONE]\n\n"
  ]);

  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const body = await response.text();
  expect(body).toContain("event: response.failed");
  expect(body).toContain("incomplete_function_call_arguments");
  expect(body).not.toContain("response.function_call_arguments.done");
});

test("adds editable Claude Code headers only when enabled for an Anthropic group", async () => {
  const responseBody = {
    id: "msg_headers", model: "test-model", content: [{ type: "text", text: "pong" }],
    stop_reason: "end_turn", usage: { input_tokens: 2, output_tokens: 1 }
  };
  const disabledCalls = mockFetch(responseBody);
  await runRelayProtocolRequest({ request: request(), provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  expect(disabledCalls[0]?.headers.get("User-Agent")).toBeNull();
  expect(disabledCalls[0]?.headers.get("X-App")).toBeNull();
  expect(disabledCalls[0]?.headers.get("Anthropic-Beta")).toBeNull();

  const enabledCalls = mockFetch(responseBody);
  const enabledRequest = request();
  enabledRequest.headers.set("User-Agent", "codex_react_ui/0.146.0");
  await runRelayProtocolRequest({
    request: enabledRequest,
    provider: provider(),
    group: { ...group("anthropic"), claudeCodeHeadersEnabled: true, claudeCodeVersion: "v2.1.222" },
    apiKey: "test-key"
  });
  expect(enabledCalls[0]?.headers.get("User-Agent")).toBe("claude-cli/2.1.222 (external, cli)");
  expect(enabledCalls[0]?.headers.get("X-App")).toBe("cli");
  expect(enabledCalls[0]?.headers.get("Anthropic-Beta")).toBe("claude-code-20250219");
});

test("forwards native Anthropic requests without injecting relay group metadata", async () => {
  const calls = mockFetch({
    id: "msg_native",
    model: "claude-sonnet-5",
    content: [{ type: "text", text: "pong" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 2, output_tokens: 1 }
  });
  const anthropicGroup = {
    ...group("anthropic"),
    id: "catalog:claude-kiro-sale",
    name: "claude-kiro-sale",
    catalogGroupName: "claude-kiro-sale",
    models: ["claude-sonnet-5"],
    claudeCodeHeadersEnabled: true
  };

  const response = await runNativeAnthropicRequest({
    request: new Request("http://127.0.0.1/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Anthropic-Beta": "context-1m-2025-08-07,claude-code-20250219"
      },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 32, messages: [{ role: "user", content: "ping" }] })
    }),
    provider: provider(),
    group: anthropicGroup,
    apiKey: "test-key"
  });

  expect(response.status).toBe(200);
  expect(calls[0]?.url).toBe("https://deepkey.top/v1/messages");
  expect(calls[0]?.headers.get("x-api-key")).toBe("test-key");
  expect(calls[0]?.headers.get("Anthropic-Beta")).toBe("context-1m-2025-08-07,claude-code-20250219");
  expect(calls[0]?.body.model).toBe("claude-sonnet-5");
  expect(calls[0]?.body.group).toBeUndefined();
});

test.each(["xhigh", "max"])("forwards Responses reasoning effort %s to Anthropic adaptive thinking", async (reasoningEffort) => {
  const calls = mockFetch({
    id: `msg_${reasoningEffort}`,
    model: "test-model",
    content: [{ type: "text", text: "pong" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 2, output_tokens: 1 }
  });

  const response = await runRelayProtocolRequest({
    request: request(false, reasoningEffort),
    provider: provider(),
    group: group("anthropic"),
    apiKey: "test-key"
  });

  expect(response.status).toBe(200);
  expect(calls[0]?.body).toMatchObject({
    thinking: { type: "adaptive" },
    output_config: { effort: reasoningEffort }
  });
});

test("does not send reasoning_effort to ordinary Ollama models", async () => {
  const calls = mockFetch({ model: "mistral:latest", choices: [{ message: { content: "pong" }, finish_reason: "stop" }] });
  const response = await runRelayProtocolRequest({ request: request(false, "high", "mistral:latest"), provider: ollamaProvider(), group: group("openai"), apiKey: "test-key" });
  expect(response.status).toBe(200);
  expect(calls[0]?.body.reasoning_effort).toBeUndefined();
  expect(calls[0]?.body.think).toBeUndefined();
});

test("preserves reasoning_effort for non-Free Ollama providers", async () => {
  const calls = mockFetch({ model: "qwen3:8b", choices: [{ message: { content: "pong" }, finish_reason: "stop" }] });
  const providerConfig = { ...ollamaProvider(), id: "custom-ollama" };
  const response = await runRelayProtocolRequest({ request: request(false, "high", "qwen3:8b"), provider: providerConfig, group: group("openai"), apiKey: "test-key" });
  expect(response.status).toBe(200);
  expect(calls[0]?.body.reasoning_effort).toBe("high");
  expect(calls[0]?.body.think).toBeUndefined();
});
test("enables native thinking only for supported Free Ollama models", async () => {
  const calls = mockFetch({ model: "qwen3:8b", choices: [{ message: { content: "pong" }, finish_reason: "stop" }] });
  const response = await runRelayProtocolRequest({ request: request(false, "high", "qwen3:8b"), provider: ollamaProvider(), group: group("openai"), apiKey: "test-key" });
  expect(response.status).toBe(200);
  expect(calls[0]?.body.reasoning_effort).toBe("high");
});

test("retries Ollama without thinking after an unsupported-thinking error", async () => {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ body });
    if (calls.length === 1) return new Response(JSON.stringify({ error: "qwen3:8b does not support thinking" }), { status: 400 });
    return new Response(JSON.stringify({ model: "qwen3:8b", choices: [{ message: { content: "pong" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const response = await runRelayProtocolRequest({ request: request(false, "high", "qwen3:8b"), provider: ollamaProvider(), group: group("openai"), apiKey: "test-key" });
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(2);
  expect(calls[0]?.body.reasoning_effort).toBe("high");
  expect(calls[1]?.body.reasoning_effort).toBeUndefined();
});

test("retries streamed Free Ollama thinking requests without native thinking", async () => {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ body });
    if (calls.length === 1) return new Response(JSON.stringify({ error: "qwen3:8b does not support thinking" }), { status: 400 });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"pong"},"finish_reason":null}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      }
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  const response = await runRelayProtocolRequest({ request: request(true, "high", "qwen3:8b"), provider: ollamaProvider(), group: group("openai"), apiKey: "test-key" });
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(2);
  expect(calls[0]?.body.reasoning_effort).toBe("high");
  expect(calls[1]?.body.reasoning_effort).toBeUndefined();
  expect(calls[1]?.body.reasoning_effort).toBeUndefined();
});
test("summarizes relay tools without including request content", () => {
  expect(summarizeResponsesRequestTools({
    input: [{ role: "user", content: "secret prompt" }],
    tools: [
      { type: "function", name: "exec_command", parameters: { type: "object" } },
      { type: "function", function: { name: "apply_patch" } },
      { type: "namespace", namespace: "codex_app" }
    ]
  }, "gpt-test", "openai-response")).toEqual({
    model: "gpt-test",
    protocol: "openai-response",
    toolCount: 3,
    toolNames: ["exec_command", "apply_patch", "codex_app"]
  });
});

test("flattens namespace tools for Chat relays and restores the function-call namespace", async () => {
  const calls = mockFetch({
    model: "test-model",
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: "",
        tool_calls: [{
          id: "call_spawn",
          type: "function",
          function: { name: "spawn_agent", arguments: '{"message":"sort"}' }
        }]
      }
    }],
    usage: { prompt_tokens: 12, completion_tokens: 4 }
  });

  const response = await runRelayProtocolRequest({
    request: namespacedAgentRequest(),
    provider: provider(),
    group: group("openai"),
    apiKey: "test-key"
  });
  const upstreamTools = calls[0]?.body.tools as Array<{ function?: { name?: string } }>;
  expect(upstreamTools).toHaveLength(1);
  expect(upstreamTools[0]?.function?.name).toBe("spawn_agent");
  expect(JSON.stringify(upstreamTools)).not.toContain('"name":"collaboration"');

  const body = await response.json() as { output: Array<Record<string, unknown>> };
  expect(body.output).toContainEqual(expect.objectContaining({
    type: "function_call",
    name: "spawn_agent",
    namespace: "collaboration",
    call_id: "call_spawn"
  }));
});

test("flattens namespace tools for Responses relays and repairs missing response namespaces", async () => {
  const calls = mockFetch({
    id: "resp_spawn",
    object: "response",
    status: "completed",
    output: [{
      id: "fc_spawn",
      type: "function_call",
      status: "completed",
      call_id: "call_spawn",
      name: "spawn_agent",
      arguments: '{"message":"sort"}'
    }]
  });

  const response = await runRelayProtocolRequest({
    request: namespacedAgentRequest(),
    provider: provider(),
    group: group("openai-response"),
    apiKey: "test-key"
  });
  expect(calls[0]?.body.tools).toEqual([expect.objectContaining({ type: "function", name: "spawn_agent" })]);

  const body = await response.json() as { output: Array<Record<string, unknown>> };
  expect(body.output[0]).toMatchObject({
    type: "function_call",
    name: "spawn_agent",
    namespace: "collaboration"
  });
});

test("restores bare sa_vm_run to registered mcp__sa_vm__sa_vm_run for Responses relays", async () => {
  const calls = mockFetch({
    id: "resp_sa_vm",
    object: "response",
    status: "completed",
    output: [{
      id: "fc_sa_vm",
      type: "function_call",
      status: "completed",
      call_id: "call_1",
      name: "sa_vm_run",
      arguments: '{"action":"read_lines","path":"test.ts"}'
    }]
  });

  const mcpRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      tools: [{ type: "function", name: "mcp__sa_vm__sa_vm_run" }],
      input: [{ role: "user", content: "read file" }]
    })
  });

  const response = await runRelayProtocolRequest({
    request: mcpRequest,
    provider: provider(),
    group: group("openai-response"),
    apiKey: "test-key"
  });

  const body = await response.json() as { output: Array<Record<string, unknown>> };
  expect(body.output[0]).toMatchObject({
    type: "function_call",
    name: "mcp__sa_vm__sa_vm_run"
  });
});

test("removes namespace metadata from prior tool calls before a Responses continuation", async () => {
  const calls = mockFetch({ id: "resp_done", object: "response", status: "completed", output: [] });
  const base = await namespacedAgentRequest().json() as Record<string, unknown>;
  const continuation = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...base,
      input: [
        {
          type: "function_call",
          call_id: "call_spawn",
          name: "spawn_agent",
          namespace: "collaboration",
          arguments: '{"message":"sort"}'
        },
        { type: "function_call_output", call_id: "call_spawn", output: "created" }
      ]
    })
  });

  await runRelayProtocolRequest({
    request: continuation,
    provider: provider(),
    group: group("openai-response"),
    apiKey: "test-key"
  });

  const upstreamInput = calls[0]?.body.input as Array<Record<string, unknown>>;
  expect(upstreamInput[0]).toMatchObject({ type: "function_call", name: "spawn_agent" });
  expect(upstreamInput[0]).not.toHaveProperty("namespace");
  expect(upstreamInput[1]).toEqual({ type: "function_call_output", call_id: "call_spawn", output: "created" });
});

test("repairs missing namespace metadata throughout proxied Responses streams", async () => {
  const item = {
    id: "fc_spawn",
    type: "function_call",
    status: "completed",
    call_id: "call_spawn",
    name: "spawn_agent",
    arguments: '{"message":"sort"}'
  };
  const responseRecord = { id: "resp_spawn", object: "response", status: "completed", output: [item] };
  const calls = mockSseFetch([
    `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", arguments: "" } })}\n\n`,
    `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: responseRecord })}\n\ndata: [DONE]\n\n`
  ]);

  const response = await runRelayProtocolRequest({
    request: namespacedAgentRequest(true),
    provider: provider(),
    group: group("openai-response"),
    apiKey: "test-key"
  });
  const body = await response.text();
  expect(calls[0]?.body.tools).toEqual([expect.objectContaining({ type: "function", name: "spawn_agent" })]);
  expect(body.match(/"namespace":"collaboration"/g)).toHaveLength(3);
  expect(body).not.toContain('"name":"collaboration"');
});

test("translates Responses Lite additional tools and developer instructions", async () => {
  const calls = mockFetch({
    model: "gpt-5.6-sol",
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: "",
        tool_calls: [{
          id: "call_exec",
          function: { name: "exec", arguments: JSON.stringify({ input: "text(await tools.exec_command({cmd: 'pwd'}))" }) }
        }]
      }
    }],
    usage: { prompt_tokens: 21, completion_tokens: 7 }
  });
  const liteBody = {
    model: "gpt-5.6-sol",
    input: [
      {
        type: "additional_tools",
        role: "developer",
        tools: [{ type: "custom", name: "exec", description: "Run JavaScript", format: { type: "text" } }]
      },
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "You are Codex." }]
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Inspect the workspace." }]
      }
    ],
    tools: null,
    stream: false
  };
  const liteRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(liteBody)
  });

  const response = await runRelayProtocolRequest({
    request: liteRequest,
    provider: provider(),
    group: group("openai"),
    apiKey: "test-key"
  });
  const body = await response.json() as { output: Array<Record<string, unknown>> };
  const upstreamMessages = calls[0]?.body.messages as Array<Record<string, unknown>>;
  const upstreamTools = calls[0]?.body.tools as Array<Record<string, unknown>>;

  expect(upstreamMessages).toEqual([
    { role: "system", content: "You are Codex." },
    { role: "user", content: "Inspect the workspace." }
  ]);
  expect(upstreamTools).toHaveLength(1);
  expect(upstreamTools[0]).toMatchObject({ type: "function", function: { name: "exec" } });
  expect(body.output[0]).toMatchObject({
    type: "custom_tool_call",
    call_id: "call_exec",
    name: "exec",
    input: "text(await tools.exec_command({cmd: 'pwd'}))"
  });
  expect(summarizeResponsesRequestTools(liteBody, "gpt-5.6-sol", "openai")).toEqual({
    model: "gpt-5.6-sol",
    protocol: "openai",
    toolCount: 1,
    toolNames: ["exec"]
  });
});

test("unwraps JSON-wrapped custom tool input from Chat streaming relays", async () => {
  const wrapped = JSON.stringify({ input: "*** Begin Patch\n*** Add File: note.txt\n+ok\n*** End Patch" });
  const first = wrapped.slice(0, 22);
  const second = wrapped.slice(22);
  const chunks = [
    `data: ${JSON.stringify({ model: "test-model", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_patch", function: { name: "apply_patch", arguments: first } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: second } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`
  ];
  mockSseFetch(chunks);
  const customRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      input: "write a file",
      stream: true,
      tools: [{ type: "custom", name: "apply_patch", description: "Apply a patch", format: { type: "text" } }]
    })
  });

  const response = await runRelayProtocolRequest({ request: customRequest, provider: provider(), group: group("openai"), apiKey: "test-key" });
  const body = await response.text();
  expect(body).toContain('"delta":"*** Begin Patch');
  expect(body).toContain('"input":"*** Begin Patch');
  expect(body).not.toContain('"input":"{\\"input\\"');
  expect(body).not.toContain('"delta":"{\\"input\\"');
});

test("incrementally translates Anthropic thinking, text, usage and split tool JSON", async () => {
  const events = [
    ["message_start", { type: "message_start", message: { model: "test-model", usage: { input_tokens: 12, output_tokens: 0, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reason" } }],
    ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "pong" } }],
    ["content_block_start", { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tool_1", name: "read_file", input: {} } }],
    ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"path\":" } }],
    ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "\"a.txt\"}" } }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 8 } }],
    ["message_stop", { type: "message_stop" }]
  ].map(([name, value]) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`).join("");
  const calls = mockSseFetch([events.slice(0, 57), events.slice(57, 193), events.slice(193)]);

  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  const body = await response.text();
  expect(calls[0]?.headers.get("Accept")).toBe("text/event-stream");
  expect(body).toContain("response.reasoning_summary_text.delta");
  expect(body).toContain('"delta":"pong"');
  expect(body).toContain('"arguments":"{\\"path\\":\\"a.txt\\"}"');
  expect(body).toContain('"cached_tokens":3');
  expect(body).toContain('"cache_write_tokens":4');
  expect(body).toContain('"input_tokens":19');
  expect(body).toContain('"output_tokens":8');
  expect(body).toContain('"total_tokens":27');
});

test("maps Anthropic max_tokens to an incomplete Responses event", async () => {
  const events = [
    ["message_start", { type: "message_start", message: { model: "test-model", usage: { input_tokens: 20, output_tokens: 0, cache_read_input_tokens: 80 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "unfinished" } }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 8192 } }],
    ["message_stop", { type: "message_stop" }]
  ].map(([name, value]) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`).join("");
  mockSseFetch([events]);

  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  const body = await response.text();
  expect(body).toContain("event: response.incomplete");
  expect(body).toContain('"incomplete_details":{"reason":"max_output_tokens"}');
  expect(body).not.toContain("event: response.completed");
});

test("uses model-aware Anthropic output ceilings without relay-name coupling", async () => {
  const claudeGroup = {
    ...group("anthropic"),
    models: ["claude-sonnet-5[1m]"],
    modelCapabilities: {
      "claude-sonnet-5": { contextWindow: 1_000_000, maxOutputTokens: 96_000, source: "upstream" as const }
    }
  };
  const calls = mockFetch({ model: "claude-sonnet-5", content: [{ type: "text", text: "pong" }], stop_reason: "end_turn", usage: {} });
  const claudeRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5[1m]", input: "ping" })
  });

  await runRelayProtocolRequest({ request: claudeRequest, provider: provider(), group: claudeGroup, apiKey: "test-key" });
  expect(calls[0]?.body.max_tokens).toBe(96_000);
  expect(calls[0]?.body.model).toBe("claude-sonnet-5[1m]");
});

test("uses Gemini streamGenerateContent and converts streamed candidates", async () => {
  const chunks = [
    { modelVersion: "test-model", candidates: [{ content: { parts: [{ text: "po" }] } }], usageMetadata: { promptTokenCount: 7 } },
    { candidates: [{ content: { parts: [{ text: "ng" }, { functionCall: { id: "call_2", name: "read_file", args: { path: "b.txt" } } }] }, finishReason: "STOP" }], usageMetadata: { candidatesTokenCount: 5 } }
  ].map((value) => `data: ${JSON.stringify(value)}\n\n`).join("");
  const calls = mockSseFetch([chunks.slice(0, 29), chunks.slice(29)]);

  const geminiGroup = { ...group("gemini"), baseUrl: "https://gemini-group.example/v1" };
  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: geminiGroup, apiKey: "test-key" });
  const body = await response.text();
  expect(calls[0]?.url).toBe("https://gemini-group.example/v1beta/models/test-model:streamGenerateContent?alt=sse");
  expect(calls[0]?.body).not.toHaveProperty("stream");
  expect(body).toContain('"delta":"po"');
  expect(body).toContain('"delta":"ng"');
  expect(body).toContain('"name":"read_file"');
  expect(body).toContain("event: response.completed");
});

test("maps native stream errors to a failed Responses event", async () => {
  mockSseFetch(['event: error\ndata: {"type":"error","error":{"message":"quota exhausted"}}\n\n']);
  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  const body = await response.text();
  expect(body).toContain("event: response.failed");
  expect(body).toContain("quota exhausted");
  expect(body).not.toContain("event: response.completed");
});

test("maps aborted upstream requests to a 502 response for every protocol", async () => {
  for (const protocol of ["openai-response", "openai", "anthropic", "gemini"] as const) {
    const controller = new AbortController();
    globalThis.fetch = ((_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const abort = () => reject(new DOMException("request timed out", "AbortError"));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    })) as typeof fetch;
    const abortedRequest = new Request("http://127.0.0.1/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test-model", input: "ping" }),
      signal: controller.signal
    });
    const pending = runRelayProtocolRequest({
      request: abortedRequest,
      provider: provider(),
      group: group(protocol),
      apiKey: "test-key"
    });
    controller.abort();
    const response = await pending;
    const body = await response.json() as { error?: { message?: string } };
    expect(response.status).toBe(502);
    expect(body.error?.message).toContain(`Upstream ${protocol} request failed`);
  }
});

test("maps Gemini safety blocks to a failed Responses event", async () => {
  mockSseFetch(['data: {"promptFeedback":{"blockReason":"SAFETY"},"candidates":[]}\n\n']);
  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: group("gemini"), apiKey: "test-key" });
  const body = await response.text();
  expect(body).toContain("event: response.failed");
  expect(body).toContain("Gemini blocked the request: SAFETY");
  expect(body).not.toContain("event: response.completed");
});

test("cancelling a Responses stream cancels the native upstream reader", async () => {
  let upstreamCancelled = false;
  globalThis.fetch = (async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"started"}}]}\n\n'));
      },
      cancel() {
        upstreamCancelled = true;
      }
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: group("openai"), apiKey: "test-key" });
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel("client closed");
  await Bun.sleep(0);
  expect(upstreamCancelled).toBe(true);
});

test("converts Responses requests to Gemini generateContent", async () => {
  const calls = mockFetch({
    modelVersion: "test-model",
    candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "pong" }, { functionCall: { id: "call_2", name: "read_file", args: { path: "b.txt" } } }] } }],
    usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 }
  });

  const response = await runRelayProtocolRequest({ request: request(), provider: provider(), group: group("gemini"), apiKey: "test-key" });
  const body = await response.json() as Record<string, unknown>;
  expect(calls[0]?.url).toBe("https://deepkey.top/v1beta/models/test-model:generateContent");
  expect(calls[0]?.headers.get("X-Goog-Api-Key")).toBe("test-key");
  expect(calls[0]?.body).toHaveProperty("systemInstruction");
  expect(calls[0]?.body).toHaveProperty("contents");
  expect(calls[0]?.body).toHaveProperty("tools");
  expect((body.output as Array<Record<string, unknown>>).some((item) => item.type === "message")).toBe(true);
  expect((body.output as Array<Record<string, unknown>>).some((item) => item.type === "function_call")).toBe(true);
});

test("rejects non-streaming Gemini safety blocks", async () => {
  mockFetch({ candidates: [{ finishReason: "SAFETY" }], usageMetadata: { promptTokenCount: 4 } });
  const response = await runRelayProtocolRequest({ request: request(), provider: provider(), group: group("gemini"), apiKey: "test-key" });
  const body = await response.json() as { error?: { message?: string } };
  expect(response.status).toBe(502);
  expect(body.error?.message).toContain("Gemini stopped the response for safety: SAFETY");
});

test("passes Responses protocol through without buffering the upstream body", async () => {
  const calls = mockFetch({ id: "resp_upstream", object: "response", status: "completed", output: [] });
  const response = await runRelayProtocolRequest({ request: request(), provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const body = await response.json() as Record<string, unknown>;
  expect(calls[0]?.url).toBe("https://deepkey.top/v1/responses");
  expect(calls[0]?.body).toMatchObject({ model: "test-model", stream: false, reasoning: { effort: "high", summary: "auto" } });
  expect(calls[0]?.body).not.toHaveProperty("stream_options");
  expect(body.id).toBe("resp_upstream");
});

test("rotates polling keys and fails over immediately after any upstream 4xx response", async () => {
  const pollingGroup = { ...group("openai-response"), id: "polling-failover", keyMode: "polling" as const, keys: ["key-one", "key-two"] };
  expect(orderedRelayKeys("provider-order", pollingGroup, pollingGroup.keys)).toEqual(["key-one", "key-two"]);
  expect(orderedRelayKeys("provider-order", pollingGroup, pollingGroup.keys)).toEqual(["key-two", "key-one"]);

  for (const upstreamStatus of [400, 401, 403, 404, 408, 422, 425, 429]) {
    const authorizations: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const authorization = new Headers(init?.headers).get("Authorization") ?? "";
      authorizations.push(authorization);
      if (authorization === "Bearer key-one") {
        return new Response(JSON.stringify({ error: { message: `upstream ${upstreamStatus}` } }), {
          status: upstreamStatus,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ id: `resp_ok_${upstreamStatus}`, object: "response", status: "completed", output: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    const response = await runRelayProtocolRequestWithKeyFailover({
      request: request(),
      provider: { ...provider(), id: `provider-failover-${upstreamStatus}` },
      group: pollingGroup,
      apiKeys: pollingGroup.keys
    });
    expect(response.status).toBe(200);
    expect(authorizations).toEqual(["Bearer key-one", "Bearer key-two"]);
    expect(await response.json()).toMatchObject({ id: `resp_ok_${upstreamStatus}` });
  }
});

test("returns the final upstream 4xx after every group key is exhausted", async () => {
  const pollingGroup = { ...group("openai-response"), id: "polling-exhausted", keyMode: "polling" as const, keys: ["key-one", "key-two"] };
  const authorizations: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const authorization = new Headers(init?.headers).get("Authorization") ?? "";
    authorizations.push(authorization);
    const status = authorization === "Bearer key-one" ? 429 : 403;
    return new Response(JSON.stringify({ error: { message: `upstream ${status}` } }), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  const response = await runRelayProtocolRequestWithKeyFailover({
    request: request(),
    provider: { ...provider(), id: "provider-failover-exhausted" },
    group: pollingGroup,
    apiKeys: pollingGroup.keys
  });
  expect(authorizations).toEqual(["Bearer key-one", "Bearer key-two"]);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { message: "upstream 403" } });
});

test("rewrites the final upstream status after key failover is exhausted", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "rate limited" } }), {
    status: 429,
    headers: { "Content-Type": "application/json" }
  })) as typeof fetch;
  const mappedGroup = {
    ...group("openai-response"),
    id: "status-mapped",
    statusCodeMapping: [{ from: 429, to: 503 }]
  };

  const response = await runRelayProtocolRequestWithKeyFailover({
    request: request(), provider: provider(), group: mappedGroup, apiKeys: ["test-key"]
  });

  expect(response.status).toBe(503);
  expect(response.headers.has("x-codex-relay-upstream-status")).toBe(false);
  expect(await response.json()).toMatchObject({ error: { message: "rate limited" } });
});

test("rewrites the requested model to the configured upstream model", async () => {
  const calls = mockFetch({ id: "resp_mapped", object: "response", status: "completed", output: [] });
  const mappedGroup = {
    ...group("openai-response"),
    modelMapping: [{ from: "test-model", to: "real-upstream-model" }]
  };

  const response = await runRelayProtocolRequest({
    request: request(), provider: provider(), group: mappedGroup, apiKey: "test-key"
  });

  expect(response.status).toBe(200);
  expect(calls[0]?.body.model).toBe("real-upstream-model");
});

test("preserves a virtual context suffix when mapping the base upstream model", async () => {
  const calls = mockFetch({ id: "resp_mapped_1m", object: "response", status: "completed", output: [] });
  const mappedGroup = {
    ...group("openai-response"),
    models: ["claude-opus-4-8"],
    modelMapping: [{ from: "claude-opus-4-8", to: "real-opus" }]
  };
  const contextRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-4-8[1m]",
      input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }]
    })
  });

  const response = await runRelayProtocolRequest({
    request: contextRequest, provider: provider(), group: mappedGroup, apiKey: "test-key"
  });

  expect(response.status).toBe(200);
  expect(calls[0]?.body.model).toBe("real-opus[1m]");
});

test("fails over after upstream 5xx and transport failures", async () => {
  const pollingGroup = { ...group("openai-response"), id: "polling-server-errors", keyMode: "polling" as const, keys: ["key-one", "key-two"] };

  for (const mode of ["status-503", "network-error"] as const) {
    const authorizations: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const authorization = new Headers(init?.headers).get("Authorization") ?? "";
      authorizations.push(authorization);
      if (authorization === "Bearer key-one") {
        if (mode === "network-error") {
          throw new Error("socket hang up");
        }
        return new Response(JSON.stringify({ error: { message: "upstream 503" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ id: `resp_ok_${mode}`, object: "response", status: "completed", output: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    const response = await runRelayProtocolRequestWithKeyFailover({
      request: request(),
      provider: { ...provider(), id: `provider-failover-${mode}` },
      group: pollingGroup,
      apiKeys: pollingGroup.keys
    });
    expect(authorizations).toEqual(["Bearer key-one", "Bearer key-two"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: `resp_ok_${mode}` });
  }
});

test("does not rotate keys for local request validation failures", async () => {
  const pollingGroup = {
    ...group("anthropic"),
    id: "polling-local-validation",
    keyMode: "polling" as const,
    keys: ["key-one", "key-two"]
  };
  const incompatibleProvider: ProviderConfig = {
    ...provider(),
    id: "provider-local-validation",
    capabilityCatalog: {
      schema: "codex-react-ui.relay-catalog.v1",
      success: true,
      auto_groups: [],
      data: [{ model_name: "test-model", enable_groups: ["openai"], supported_endpoint_types: ["openai"] }],
      group_ratio: {},
      usable_group: {},
      supported_endpoint: {},
      vendors: [],
      imported_at: 1,
      source_hash: "fixture",
      warnings: []
    }
  };
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response("{}");
  }) as typeof fetch;

  const response = await runRelayProtocolRequestWithKeyFailover({
    request: request(),
    provider: incompatibleProvider,
    group: pollingGroup,
    apiKeys: pollingGroup.keys
  });
  const body = await response.json() as { error?: { message?: string } };

  expect(response.status).toBe(400);
  expect(body.error?.message).toContain("does not support group protocol anthropic");
  expect(fetchCalls).toBe(0);
});

test("closes a proxied Responses stream when the upstream terminal event does not close its connection", async () => {
  let upstreamCancelled = false;
  globalThis.fetch = (async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_deepseek","status":"completed","output":[]}}\n\n'
        ));
      },
      cancel() {
        upstreamCancelled = true;
      }
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;

  const response = await runRelayProtocolRequest({ request: request(true), provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const body = await Promise.race([
    response.text(),
    Bun.sleep(500).then(() => { throw new Error("Responses proxy did not close after its terminal event"); })
  ]);

  expect(body).toContain("event: response.completed");
  expect(body.match(/data: \[DONE\]/g)).toHaveLength(1);
  expect(upstreamCancelled).toBe(true);
});

test("proxies compact only when the selected model advertises the capability", async () => {
  const capableProvider = provider();
  capableProvider.capabilityCatalog = {
    schema: "codex-react-ui.relay-catalog.v1",
    success: true,
    auto_groups: [],
    data: [{ model_name: "test-model", quota_type: 0, enable_groups: [], supported_endpoint_types: ["openai-response", "openai-response-compact"] }],
    group_ratio: {},
    usable_group: {},
    supported_endpoint: { "openai-response-compact": { path: "/v1/responses/compact", method: "POST" } },
    vendors: [],
    imported_at: 0,
    source_hash: "test",
    warnings: []
  };
  const calls = mockFetch({ output: [] });
  const compactRequest = new Request("http://127.0.0.1/v1/responses/compact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "test-model", input: [] })
  });

  const compactGroup = { ...group("openai-response"), baseUrl: "https://compact-group.example/v1" };
  const response = await runRelayProtocolRequest({ request: compactRequest, provider: capableProvider, group: compactGroup, apiKey: "test-key" });

  expect(response.status).toBe(200);
  expect(calls[0]?.url).toBe("https://compact-group.example/v1/responses/compact");
});

test("rejects remote compaction v2 when only the legacy compact endpoint is advertised", async () => {
  const capableProvider = provider();
  capableProvider.capabilityCatalog = {
    schema: "codex-react-ui.relay-catalog.v1",
    success: true,
    auto_groups: [],
    data: [{ model_name: "test-model", quota_type: 0, enable_groups: [], supported_endpoint_types: ["openai-response", "openai-response-compact"] }],
    group_ratio: {},
    usable_group: {},
    supported_endpoint: { "openai-response-compact": { path: "/v1/responses/compact", method: "POST" } },
    vendors: [],
    imported_at: 0,
    source_hash: "test",
    warnings: []
  };
  const calls = mockFetch({ output: [{ type: "message", role: "assistant", content: [] }] });
  const response = await runRelayProtocolRequest({
    request: new Request("http://127.0.0.1/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test-model", input: [{ type: "compaction" }] })
    }),
    provider: capableProvider,
    group: group("openai-response"),
    apiKey: "test-key"
  });

  expect(response.status).toBe(400);
  expect(await response.text()).toContain("does not advertise openai-response-compaction-v2 support");
  expect(calls).toHaveLength(0);
});

test("rejects compact for models without advertised compact support", async () => {
  const response = await runRelayProtocolRequest({
    request: new Request("http://127.0.0.1/v1/responses/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test-model", input: [] })
    }),
    provider: provider(),
    group: group("openai-response"),
    apiKey: "test-key"
  });

  expect(response.status).toBe(400);
  expect(await response.text()).toContain("does not advertise openai-response-compact support");
});

test("unwraps JSON-wrapped custom tool input from Responses relays", async () => {
  mockFetch({
    id: "resp_custom_tool",
    object: "response",
    status: "completed",
    output: [{
      id: "ctc_patch",
      type: "custom_tool_call",
      call_id: "call_patch",
      name: "apply_patch",
      input: JSON.stringify({ input: "*** Begin Patch\n*** Add File: note.txt\n+ok\n*** End Patch" })
    }]
  });
  const customRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      input: "write a file",
      tools: [{ type: "custom", name: "apply_patch", description: "Apply a patch", format: { type: "text" } }]
    })
  });

  const response = await runRelayProtocolRequest({ request: customRequest, provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const body = await response.json() as { output: Array<{ input?: string }> };
  expect(body.output[0]?.input).toStartWith("*** Begin Patch");
  expect(body.output[0]?.input).not.toStartWith("{");
});

test("unwraps split custom tool input while preserving Responses streaming", async () => {
  const wrapped = JSON.stringify({ input: "*** Begin Patch\n*** Add File: note.txt\n+ok\n*** End Patch" });
  const first = wrapped.slice(0, 24);
  const second = wrapped.slice(24);
  const item = { id: "ctc_patch", type: "custom_tool_call", call_id: "call_patch", name: "apply_patch", input: wrapped };
  const responseRecord = { id: "resp_patch", object: "response", status: "completed", output: [item] };
  mockSseFetch([
    `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { ...item, input: "" } })}\n\n`,
    `event: response.custom_tool_call_input.delta\ndata: ${JSON.stringify({ type: "response.custom_tool_call_input.delta", item_id: "ctc_patch", output_index: 0, delta: first })}\n\n`,
    `event: response.custom_tool_call_input.delta\ndata: ${JSON.stringify({ type: "response.custom_tool_call_input.delta", item_id: "ctc_patch", output_index: 0, delta: second })}\n\n`,
    `event: response.custom_tool_call_input.done\ndata: ${JSON.stringify({ type: "response.custom_tool_call_input.done", item_id: "ctc_patch", output_index: 0, input: wrapped })}\n\n`,
    `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: responseRecord })}\n\ndata: [DONE]\n\n`
  ]);
  const customRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      input: "write a file",
      stream: true,
      tools: [{ type: "custom", name: "apply_patch", description: "Apply a patch", format: { type: "text" } }]
    })
  });

  const response = await runRelayProtocolRequest({ request: customRequest, provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const body = await response.text();
  expect(body).toContain('"delta":"*** Begin Patch');
  expect(body).toContain('"input":"*** Begin Patch');
  expect(body).not.toContain('"input":"{\\"input\\"');
  expect(body).toContain("data: [DONE]");
});

test("preserves Anthropic cache_control breakpoints when relaying to OpenAI chat", async () => {
  const calls = mockFetch({
    model: "test-model",
    choices: [{ finish_reason: "stop", message: { content: "pong" } }],
    usage: { prompt_tokens: 11, completion_tokens: 4 }
  });
  const inbound = new Request("http://127.0.0.1/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": "local" },
    body: JSON.stringify({
      model: "test-model",
      max_tokens: 128,
      system: [{ type: "text", text: "system prompt", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [{ type: "text", text: "prefix context", cache_control: { type: "ephemeral" } }] },
        { role: "assistant", content: [{ type: "text", text: "cached reply" }] }
      ],
      tools: [{ name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } }, cache_control: { type: "ephemeral" } }]
    })
  });

  await runRelayAnthropicRequest({ request: inbound, provider: provider(), group: group("openai"), apiKey: "test-key" });
  const sent = calls[0]!.body;
  const messages = sent.messages as Array<Record<string, unknown>>;
  const system = messages.find((m) => m.role === "system");
  expect(Array.isArray(system?.content)).toBe(true);
  const systemBlock = (system!.content as Array<Record<string, unknown>>)[0];
  expect(systemBlock.cache_control).toEqual({ type: "ephemeral" });
  const userMessage = messages.find((m) => m.role === "user");
  const userBlock = (userMessage!.content as Array<Record<string, unknown>>)[0];
  expect(userBlock.cache_control).toEqual({ type: "ephemeral" });
});

test("preserves Anthropic tool cache_control when relaying to Anthropic", async () => {
  const calls = mockFetch({
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [{ type: "text", text: "pong" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 11, output_tokens: 4 }
  });
  const inbound = new Request("http://127.0.0.1/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": "local" },
    body: JSON.stringify({
      model: "test-model",
      max_tokens: 128,
      system: "system prompt",
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      tools: [{ name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } }, cache_control: { type: "ephemeral" } }]
    })
  });

  await runRelayAnthropicRequest({ request: inbound, provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  const sent = calls[0]!.body;
  expect((sent.tools as Array<Record<string, unknown>>)[0]!.cache_control).toEqual({ type: "ephemeral" });
});

test("preserves Anthropic cache_control breakpoints when relaying to the Responses API", async () => {
  const calls = mockFetch({
    object: "response",
    status: "completed",
    model: "test-model",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "pong" }] }],
    usage: { input_tokens: 11, output_tokens: 4 }
  });
  const inbound = new Request("http://127.0.0.1/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": "local" },
    body: JSON.stringify({
      model: "test-model",
      max_tokens: 128,
      system: [{ type: "text", text: "system prompt", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "prefix context", cache_control: { type: "ephemeral" } }] }],
      tools: [{ name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } }, cache_control: { type: "ephemeral" } }]
    })
  });

  await runRelayAnthropicRequest({ request: inbound, provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const sent = calls[0]!.body;
  const input = sent.input as Array<Record<string, unknown>>;
  // System breakpoint carried as a system-role input item (not instructions string).
  const systemItem = input.find((item) => item.role === "system");
  expect(systemItem).toBeDefined();
  const systemBlock = (systemItem!.content as Array<Record<string, unknown>>)[0];
  expect(systemBlock.cache_control).toEqual({ type: "ephemeral" });
  expect(sent.instructions).toBeUndefined();
  const userItem = input.find((item) => item.role === "user");
  const userBlock = (userItem!.content as Array<Record<string, unknown>>)[0];
  expect(userBlock.cache_control).toEqual({ type: "ephemeral" });
});

test("auto-stamps Claude cache_control breakpoints for a cache-less Responses inbound to anthropic", async () => {
  const calls = mockFetch({
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [{ type: "text", text: "pong" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 11, output_tokens: 4 }
  });
  const responsesInbound = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      instructions: "system prompt",
      input: [
        { role: "user", content: [{ type: "input_text", text: "cached prefix" }] },
        { role: "assistant", content: [{ type: "input_text", text: "reply" }] },
        { role: "user", content: [{ type: "input_text", text: "latest turn" }] }
      ],
      tools: [{ type: "function", name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } }]
    })
  });

  await runRelayProtocolRequest({ request: responsesInbound, provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  const sent = calls[0]!.body;
  // System breakpoint auto-stamped.
  expect(Array.isArray(sent.system)).toBe(true);
  expect((sent.system as Array<Record<string, unknown>>)[0]!.cache_control).toEqual({ type: "ephemeral" });
  // Trailing tool carries the list breakpoint.
  expect((sent.tools as Array<Record<string, unknown>>)[0]!.cache_control).toEqual({ type: "ephemeral" });
  const sentMessages = sent.messages as Array<Record<string, unknown>>;
  // Breakpoint lands on the longest stable prefix (the last user message), caching the whole conversation.
  const lastUserBlock = (sentMessages.at(-1)!.content as Array<Record<string, unknown>>)[0];
  expect(lastUserBlock.cache_control).toEqual({ type: "ephemeral" });
  const firstUserBlock = (sentMessages[0]!.content as Array<Record<string, unknown>>)[0];
  expect(firstUserBlock.cache_control).toBeUndefined();
});

test("does not auto-stamp when the Responses inbound already carries cache_control", async () => {
  const calls = mockFetch({
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [{ type: "text", text: "pong" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 11, output_tokens: 4 }
  });
  const responsesInbound = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      instructions: "system prompt",
      input: [
        { role: "user", content: [{ type: "input_text", text: "cached prefix", cache_control: { type: "ephemeral" } }] },
        { role: "user", content: [{ type: "input_text", text: "latest turn" }] }
      ]
    })
  });

  await runRelayProtocolRequest({ request: responsesInbound, provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  const sent = calls[0]!.body;
  const sentMessages = sent.messages as Array<Record<string, unknown>>;
  // Two consecutive user messages merge into one; the explicit breakpoint rides on the first block.
  const mergedUser = sentMessages[0]!;
  const mergedBlocks = mergedUser.content as Array<Record<string, unknown>>;
  expect(mergedBlocks[0]!.cache_control).toEqual({ type: "ephemeral" });
  // The trailing turn keeps no breakpoint, and the system prompt is untouched (string), since intent was expressed.
  expect(mergedBlocks.at(-1)!.cache_control).toBeUndefined();
  expect(Array.isArray(sent.system)).toBe(false);
});

test("relays OpenAI chat/completions and preserves per-block cache_control to chat", async () => {
  const calls = mockFetch({
    id: "chatcmpl_1",
    model: "test-model",
    choices: [{ message: { role: "assistant", content: "pong", tool_calls: [] }, finish_reason: "stop" }],
    usage: { prompt_tokens: 11, completion_tokens: 4 }
  });
  const chatInbound = new Request("http://127.0.0.1/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      messages: [
        { role: "system", content: [{ type: "text", text: "system prompt", cache_control: { type: "ephemeral" } }] },
        { role: "user", content: [{ type: "text", text: "cached prefix", cache_control: { type: "ephemeral" } }] },
        { role: "user", content: "latest turn" }
      ],
      tools: [{ type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } }]
    })
  });

  // Group protocol openai => stays a chat/completions request (no chat->responses conversion).
  await runRelayChatRequest({ request: chatInbound, provider: provider(), group: group("openai"), apiKey: "test-key" });
  const sent = calls[0]!.body;
  expect(calls[0]!.url).toBe("https://deepkey.top/v1/chat/completions");
  const messages = sent.messages as Array<Record<string, unknown>>;
  const systemContent = messages[0]!.content as Array<Record<string, unknown>>;
  expect(systemContent[0]!.cache_control).toEqual({ type: "ephemeral" });
  const firstUser = messages.find((m) => m.role === "user")!;
  expect((firstUser.content as Array<Record<string, unknown>>)[0]!.cache_control).toEqual({ type: "ephemeral" });
});

test("relays OpenAI chat/completions to Anthropic preserving cache_control and auto-stamping when absent", async () => {
  const calls = mockFetch({
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [{ type: "text", text: "pong" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 11, output_tokens: 4 }
  });
  const chatInbound = new Request("http://127.0.0.1/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: [{ type: "text", text: "cached prefix", cache_control: { type: "ephemeral" } }] }
      ],
      tools: [{ type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object" } } }]
    })
  });

  await runRelayChatRequest({ request: chatInbound, provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  const sent = calls[0]!.body;
  expect(calls[0]!.url).toBe("https://deepkey.top/v1/messages");
  // Explicit block breakpoint preserved on the user message.
  const sentMessages = sent.messages as Array<Record<string, unknown>>;
  const firstUserBlock = (sentMessages[0]!.content as Array<Record<string, unknown>>)[0];
  expect(firstUserBlock.cache_control).toEqual({ type: "ephemeral" });
  // Inbound already expressed cache intent, so the gateway must NOT auto-stamp the system prompt.
  expect(Array.isArray(sent.system)).toBe(false);
});

test("preserves cache_control from Responses input system-role item to anthropic target", async () => {
  const calls = mockFetch({
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [{ type: "text", text: "pong" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 11, output_tokens: 4 }
  });
  const responsesInbound = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      input: [
        { role: "system", content: [{ type: "input_text", text: "system prompt", cache_control: { type: "ephemeral" } }] },
        { role: "user", content: [{ type: "input_text", text: "hello" }] }
      ]
    })
  });

  await runRelayProtocolRequest({ request: responsesInbound, provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  const sent = calls[0]!.body;
  // systemCacheControl extracted from the system-role input item → system becomes an array block.
  expect(Array.isArray(sent.system)).toBe(true);
  expect((sent.system as Array<Record<string, unknown>>)[0]!.cache_control).toEqual({ type: "ephemeral" });
  // Client expressed intent → auto-stamp must NOT fire on unrelated positions.
  const sentMessages = sent.messages as Array<Record<string, unknown>>;
  const userBlock = (sentMessages.at(-1)!.content as Array<Record<string, unknown>>).at(-1)!;
  expect(userBlock.cache_control).toBeUndefined();
});

test("canonicalToResponsesRequest does not emit tool-level cache_control", async () => {
  const calls = mockFetch({
    object: "response",
    status: "completed",
    model: "test-model",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "pong" }] }],
    usage: { input_tokens: 11, output_tokens: 4 }
  });
  const inbound = new Request("http://127.0.0.1/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": "local" },
    body: JSON.stringify({
      model: "test-model",
      max_tokens: 128,
      system: "system prompt",
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      tools: [{ name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } }, cache_control: { type: "ephemeral" } }]
    })
  });

  await runRelayAnthropicRequest({ request: inbound, provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const sent = calls[0]!.body;
  // Tool-level cache_control must not be forwarded to the Responses format.
  expect((sent.tools as Array<Record<string, unknown>>)[0]!.cache_control).toBeUndefined();
});

test("auto-stamps Claude cache_control breakpoints for a cache-less chat/completions inbound to anthropic", async () => {
  const calls = mockFetch({
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [{ type: "text", text: "pong" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 11, output_tokens: 4 }
  });
  const chatInbound = new Request("http://127.0.0.1/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: [{ type: "text", text: "cached prefix" }] },
        { role: "assistant", content: "reply" },
        { role: "user", content: "latest turn" }
      ],
      tools: [{ type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object" } } }]
    })
  });

  await runRelayChatRequest({ request: chatInbound, provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  const sent = calls[0]!.body;
  expect(Array.isArray(sent.system)).toBe(true);
  expect((sent.system as Array<Record<string, unknown>>)[0]!.cache_control).toEqual({ type: "ephemeral" });
  expect((sent.tools as Array<Record<string, unknown>>)[0]!.cache_control).toEqual({ type: "ephemeral" });
  const sentMessages = sent.messages as Array<Record<string, unknown>>;
  const lastUser = sentMessages.at(-1)!;
  expect((lastUser.content as Array<Record<string, unknown>>)[0]!.cache_control).toEqual({ type: "ephemeral" });
});

test("reports upstream OpenAI Chat prompt-cache reads on a translated Claude Messages stream", async () => {
  mockSseFetch([
    'data: {"model":"test-model","choices":[{"delta":{"content":"po"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"ng"},"finish_reason":"stop"}],"usage":{"prompt_tokens":30,"completion_tokens":6,"prompt_tokens_details":{"cached_tokens":20}}}\n\n',
    "data: [DONE]\n\n"
  ]);
  const response = await runRelayAnthropicRequest({ request: anthropicRequest(true), provider: provider(), group: group("openai"), apiKey: "test-key" });
  const body = await response.text();
  const messageDelta = body.split(/\r?\n\r?\n/)
    .map((frame) => frame.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim())
    .filter((data): data is string => Boolean(data))
    .map((data) => JSON.parse(data) as { type: string; usage?: Record<string, unknown> })
    .find((event) => event.type === "message_delta");
  expect(messageDelta?.usage).toMatchObject({ input_tokens: 30, output_tokens: 6, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 });
  // message_start seeds the Anthropic cache fields so clients can stream them early.
  expect(body).toContain('"cache_read_input_tokens":0');
  expect(body).toContain('"cache_creation_input_tokens":0');
});

test("reports upstream Responses prompt-cache reads and writes on a translated Claude Messages stream", async () => {
  const completed = {
    type: "response.completed",
    response: {
      id: "resp_cache",
      model: "test-model",
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "pong" }] }],
      usage: { input_tokens: 11, output_tokens: 2, input_tokens_details: { cached_tokens: 8, cache_write_tokens: 3 }, output_tokens_details: { reasoning_tokens: 0 } }
    }
  };
  mockSseFetch([
    `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { ...completed.response, status: "in_progress", output: [] } })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify(completed)}\n\ndata: [DONE]\n\n`
  ]);
  const response = await runRelayAnthropicRequest({ request: anthropicRequest(true), provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const body = await response.text();
  const messageDelta = body.split(/\r?\n\r?\n/)
    .map((frame) => frame.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim())
    .filter((data): data is string => Boolean(data))
    .map((data) => JSON.parse(data) as { type: string; usage?: Record<string, unknown> })
    .find((event) => event.type === "message_delta");
  expect(messageDelta?.usage).toMatchObject({ input_tokens: 11, output_tokens: 2, cache_read_input_tokens: 8, cache_creation_input_tokens: 3 });
});

test("reports upstream Responses prompt-cache reads and writes on a non-streamed Claude Messages request", async () => {
  mockFetch({
    id: "resp_cache",
    object: "response",
    status: "completed",
    model: "test-model",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "pong" }] }],
    usage: { input_tokens: 11, output_tokens: 2, input_tokens_details: { cached_tokens: 9, cache_write_tokens: 2 } }
  });
  const response = await runRelayAnthropicRequest({ request: anthropicRequest(), provider: provider(), group: group("openai-response"), apiKey: "test-key" });
  const body = await response.json() as { usage: Record<string, number> };
  expect(body.usage).toMatchObject({ input_tokens: 11, output_tokens: 2, cache_read_input_tokens: 9, cache_creation_input_tokens: 2 });
});

test("reports upstream OpenAI Chat prompt-cache reads on a non-streamed Claude Messages request", async () => {
  mockFetch({
    id: "chatcmpl_cache",
    model: "test-model",
    choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 30, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 24 } }
  });
  const response = await runRelayAnthropicRequest({ request: anthropicRequest(), provider: provider(), group: group("openai"), apiKey: "test-key" });
  const body = await response.json() as { usage: Record<string, number> };
  // Anthropic names the write field cache_creation_input_tokens; OpenAI Chat only reports cached hits, not writes.
  expect(body.usage).toMatchObject({ input_tokens: 30, output_tokens: 6, cache_read_input_tokens: 24 });
  expect(body.usage.cache_creation_input_tokens).toBeUndefined();
});

// --- prompt_cache_key injection on the OpenAI-compatible translate paths ---
// Mirrors cc-switch: an explicit client key wins verbatim; otherwise a real
// per-session identity (carried in the internal x-codex-prompt-cache-key
// header) is hashed into a stable cache key. Strict gateways stay opt-in.

function anthropicRequestWithCache(threadId?: string, explicitKey?: string, stream = false): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Api-Key": "local" };
  if (threadId) headers["x-codex-prompt-cache-key"] = threadId;
  const body: Record<string, unknown> = {
    model: "test-model",
    max_tokens: 128,
    system: "Be concise",
    messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
    stream
  };
  if (explicitKey) {
    body.prompt_cache_key = explicitKey;
    body.metadata = { prompt_cache_key: explicitKey };
  }
  return new Request("http://127.0.0.1/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

function chatRequestWithCache(threadId?: string, explicitKey?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (threadId) headers["x-codex-prompt-cache-key"] = threadId;
  const body: Record<string, unknown> = {
    model: "test-model",
    max_tokens: 128,
    messages: [{ role: "user", content: "ping" }],
    stream: false
  };
  if (explicitKey) body.prompt_cache_key = explicitKey;
  return new Request("http://127.0.0.1/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

function groupWithCacheRouting(protocol: RelayResponseProtocol, routing?: "auto" | "enabled" | "disabled"): ChannelGroupConfig {
  const base = group(protocol);
  if (routing) base.promptCacheRouting = routing;
  return base;
}

function openaiHostProvider(): ProviderConfig {
  return { ...provider(), id: "openai", kind: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" };
}

test("injects a stable hashed prompt_cache_key on Claude→Responses when a per-session thread id is present", async () => {
  const calls = mockFetch({
    id: "resp_cache", object: "response", status: "completed", model: "test-model",
    output: [{ type: "message", content: [{ type: "output_text", text: "pong" }] }],
    usage: { input_tokens: 4, output_tokens: 2, input_tokens_details: { cached_tokens: 0 } }
  });
  await runRelayAnthropicRequest({
    request: anthropicRequestWithCache("thread-session-123"),
    provider: provider(),
    group: groupWithCacheRouting("openai-response"),
    apiKey: "test-key"
  });
  const key = calls[0]?.body.prompt_cache_key as string | undefined;
  expect(typeof key).toBe("string");
  expect(key).toMatch(/^cxu-/); // hashed, never the raw thread id verbatim
  expect(key).not.toContain("thread-session-123");
});

test("an explicit client prompt_cache_key wins verbatim on Claude→Responses", async () => {
  const calls = mockFetch({
    id: "resp_explicit", object: "response", status: "completed", model: "test-model",
    output: [{ type: "message", content: [{ type: "output_text", text: "pong" }] }],
    usage: { input_tokens: 4, output_tokens: 2 }
  });
  await runRelayAnthropicRequest({
    request: anthropicRequestWithCache("thread-session-123", "explicit-route-key"),
    provider: provider(),
    group: groupWithCacheRouting("openai-response"),
    apiKey: "test-key"
  });
  expect(calls[0]?.body.prompt_cache_key).toBe("explicit-route-key");
});

test("disable promptCacheRouting on Claude→Responses omits prompt_cache_key even with a session id", async () => {
  const calls = mockFetch({
    id: "resp_disabled", object: "response", status: "completed", model: "test-model",
    output: [{ type: "message", content: [{ type: "output_text", text: "pong" }] }],
    usage: { input_tokens: 4, output_tokens: 2 }
  });
  await runRelayAnthropicRequest({
    request: anthropicRequestWithCache("thread-session-123"),
    provider: provider(),
    group: groupWithCacheRouting("openai-response", "disabled"),
    apiKey: "test-key"
  });
  expect(calls[0]?.body.prompt_cache_key).toBeUndefined();
});

test("injects a stable hashed prompt_cache_key on Claude→Chat for an allowlisted kind", async () => {
  const calls = mockFetch({
    id: "chatcmpl_cache_key",
    model: "test-model",
    choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 4, completion_tokens: 2 }
  });
  await runRelayAnthropicRequest({
    request: anthropicRequestWithCache("thread-session-456"),
    provider: provider(), // responsesRelay kind → kind allowlisted
    group: groupWithCacheRouting("openai"),
    apiKey: "test-key"
  });
  expect(calls[0]?.body.prompt_cache_key).toMatch(/^cxu-/);
  expect(calls[0]?.body.prompt_cache_key).not.toContain("thread-session-456");
});

test("does not inject prompt_cache_key on Claude→Chat for a strict, unallowlisted host/kind in auto", async () => {
  const calls = mockFetch({
    id: "chatcmpl_no_cache",
    model: "test-model",
    choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 4, completion_tokens: 2 }
  });
  // ollama provider (kind "ollama") with an unallowlisted host → auto opts out.
  const ollama = ollamaProvider();
  ollama.baseUrl = "https://strict.example/v1";
  await runRelayAnthropicRequest({
    request: anthropicRequestWithCache("thread-session-789"),
    provider: ollama,
    group: groupWithCacheRouting("openai"),
    apiKey: "test-key"
  });
  expect(calls[0]?.body.prompt_cache_key).toBeUndefined();
});

test("suppresses prompt_cache_key on the NVIDIA NIM gateway (kind openai) in auto despite the kind allowlist", async () => {
  const calls = mockFetch({
    id: "chatcmpl_nvidia",
    model: "test-model",
    choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 4, completion_tokens: 2 }
  });
  // NVIDIA's template is kind "openai" at https://integrate.api.nvidia.com/v1 — the kind
  // allowlist alone would inject prompt_cache_key, but the gateway rejects it with 400.
  const nvidia: ProviderConfig = { ...provider(), id: "nvidia", kind: "openai", name: "NVIDIA", baseUrl: "https://integrate.api.nvidia.com/v1" };
  await runRelayAnthropicRequest({
    request: anthropicRequestWithCache("thread-session-nvidia"),
    provider: nvidia,
    group: groupWithCacheRouting("openai"),
    apiKey: "test-key"
  });
  expect(calls[0]?.body.prompt_cache_key).toBeUndefined();
});

test("promptCacheRouting enabled still forces prompt_cache_key for NVIDIA when explicitly enabled by the operator", async () => {
  const calls = mockFetch({
    id: "chatcmpl_nvidia_forced",
    model: "test-model",
    choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 4, completion_tokens: 2 }
  });
  const nvidia: ProviderConfig = { ...provider(), id: "nvidia", kind: "openai", name: "NVIDIA", baseUrl: "https://integrate.api.nvidia.com/v1" };
  await runRelayAnthropicRequest({
    request: anthropicRequestWithCache("thread-session-nvidia2"),
    provider: nvidia,
    group: groupWithCacheRouting("openai", "enabled"),
    apiKey: "test-key"
  });
  expect(calls[0]?.body.prompt_cache_key).toMatch(/^cxu-/);
});

test("promptCacheRouting enabled forces prompt_cache_key on Claude→Chat even for an unallowlisted host", async () => {
  const calls = mockFetch({
    id: "chatcmpl_forced",
    model: "test-model",
    choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 4, completion_tokens: 2 }
  });
  const ollama = ollamaProvider();
  ollama.baseUrl = "https://strict.example/v1";
  await runRelayAnthropicRequest({
    request: anthropicRequestWithCache("thread-session-000"),
    provider: ollama,
    group: groupWithCacheRouting("openai", "enabled"),
    apiKey: "test-key"
  });
  expect(calls[0]?.body.prompt_cache_key).toMatch(/^cxu-/);
});

test("Chat→Chat relay injects the session cache key for an allowlisted host provider", async () => {
  const calls = mockFetch({
    id: "chatcmpl_chat_chat",
    model: "test-model",
    choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 4, completion_tokens: 2 }
  });
  await runRelayChatRequest({
    request: chatRequestWithCache("thread-session-chat"),
    provider: openaiHostProvider(), // api.openai.com host allowlisted
    group: groupWithCacheRouting("openai"),
    apiKey: "test-key"
  });
  expect(calls[0]?.body.prompt_cache_key).toMatch(/^cxu-/);
});

test("omits prompt_cache_key when no thread id and no explicit key are present", async () => {
  const calls = mockFetch({
    id: "chatcmpl_no_key",
    model: "test-model",
    choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 4, completion_tokens: 2 }
  });
  await runRelayAnthropicRequest({
    request: anthropicRequestWithCache(), // no header, no explicit key
    provider: provider(),
    group: groupWithCacheRouting("openai-response"),
    apiKey: "test-key"
  });
  expect(calls[0]?.body.prompt_cache_key).toBeUndefined();
});

test("direct Responses relay injects the stable session cache key", async () => {
  const calls = mockFetch({
    id: "resp_direct_cache",
    object: "response",
    status: "completed",
    model: "test-model",
    output: [{ type: "message", content: [{ type: "output_text", text: "pong" }] }],
    usage: { input_tokens: 4, output_tokens: 2 }
  });
  const directRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-prompt-cache-key": "thread-direct-123"
    },
    body: JSON.stringify({
      model: "test-model",
      instructions: "Be concise",
      input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
      stream: false
    })
  });

  await runRelayProtocolRequest({
    request: directRequest,
    provider: provider(),
    group: groupWithCacheRouting("openai-response"),
    apiKey: "test-key"
  });

  expect(calls[0]?.body.prompt_cache_key).toMatch(/^cxu-/);
  expect(calls[0]?.body.prompt_cache_key).not.toContain("thread-direct-123");
});

// cc-switch mirror: when an openai-response group is pointed at a Claude
// (anthropic-wire) upstream — the upstream advertising `anthropic` capability —
// a Codex Responses request must be translated to Anthropic Messages and auto-stamped
// with cache_control breakpoints, not passthrough-forwarded. new-api's
// responses→claude converter stamps no breakpoints and Codex emits none, so a
// passthrough reads 0 cache. This test pins that decision: explicit anthropic
// capability overrides a fixed openai-response group onto the stamp path.
test("Codex direct to a Claude-capable openai-response group translates to anthropic and auto-stamps cache_control", async () => {
  const calls = mockFetch({
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [{ type: "text", text: "pong" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 11, output_tokens: 4 }
  });
  const anthropicCapableProvider: ProviderConfig = {
    ...provider(),
    capabilityCatalog: {
      schema: "codex-react-ui.relay-catalog.v1",
      success: true,
      auto_groups: [],
      data: [{ model_name: "test-model", quota_type: 0, enable_groups: [], supported_endpoint_types: ["anthropic", "openai-response"] }],
      group_ratio: {},
      usable_group: {},
      supported_endpoint: {},
      vendors: [],
      imported_at: 1,
      source_hash: "fixture",
      warnings: []
    }
  };
  const directRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Codex carries a per-session prompt_cache_key; useful to OpenAI, useless to Claude.
      "x-codex-prompt-cache-key": "thread-direct-claude"
    },
    body: JSON.stringify({
      model: "test-model",
      instructions: "system prompt",
      input: [
        { role: "user", content: [{ type: "input_text", text: "cached prefix" }] },
        { role: "assistant", content: [{ type: "input_text", text: "reply" }] },
        { role: "user", content: [{ type: "input_text", text: "latest turn" }] }
      ],
      tools: [{ type: "function", name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } }],
      stream: false
    })
  });

  await runRelayProtocolRequest({
    request: directRequest,
    provider: anthropicCapableProvider,
    group: group("openai-response"),
    apiKey: "test-key"
  });

  const sent = calls[0]!;
  // Routed to the Anthropic Messages endpoint, not a raw Responses passthrough.
  expect(sent.url).toContain("/v1/messages");
  expect(sent.url).not.toContain("/responses");
  // Body is Anthropic Messages format: a `messages` array and a `system` array, not Responses `input`.
  expect(Array.isArray(sent.body.messages)).toBe(true);
  expect(Array.isArray(sent.body.system)).toBe(true);
  expect(sent.body.input).toBeUndefined();
  // Auto-stamped Claude cache_control breakpoints so caching hits — system, trailing tool, prefix message.
  expect((sent.body.system as Array<Record<string, unknown>>)[0]!.cache_control).toEqual({ type: "ephemeral" });
  expect((sent.body.tools as Array<Record<string, unknown>>)[0]!.cache_control).toEqual({ type: "ephemeral" });
  const lastUserBlock = ((sent.body.messages as Array<Record<string, unknown>>).at(-1)!.content as Array<Record<string, unknown>>)[0];
  expect(lastUserBlock.cache_control).toEqual({ type: "ephemeral" });
  // prompt_cache_key must NOT be emitted on the Anthropic body — it is not an Anthropic field
  // and carries no Claude caching value.
  expect(sent.body.prompt_cache_key).toBeUndefined();
});

// An openai-response group backed by an OpenAI-native model (catalog advertises only
// openai-response) must remain on the Responses passthrough — where implicit prefix
// caching + prompt_cache_key is the correct mechanism (mirrors cc-switch chat path).
test("Codex direct to an openai-native openai-response group stays on the Responses passthrough", async () => {
  const calls = mockFetch({
    id: "resp_native_passthrough",
    object: "response",
    status: "completed",
    model: "test-model",
    output: [{ type: "message", content: [{ type: "output_text", text: "pong" }] }],
    usage: { input_tokens: 4, output_tokens: 2 }
  });
  const openaiNativeProvider: ProviderConfig = {
    ...provider(),
    capabilityCatalog: {
      schema: "codex-react-ui.relay-catalog.v1",
      success: true,
      auto_groups: [],
      data: [{ model_name: "test-model", quota_type: 0, enable_groups: [], supported_endpoint_types: ["openai-response"] }],
      group_ratio: {},
      usable_group: {},
      supported_endpoint: {},
      vendors: [],
      imported_at: 1,
      source_hash: "fixture",
      warnings: []
    }
  };
  const directRequest = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-prompt-cache-key": "thread-direct-openai" },
    body: JSON.stringify({
      model: "test-model",
      instructions: "Be concise",
      input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
      stream: false
    })
  });

  await runRelayProtocolRequest({
    request: directRequest,
    provider: openaiNativeProvider,
    group: groupWithCacheRouting("openai-response"),
    apiKey: "test-key"
  });

  const sent = calls[0]!;
  // Passthrough: Responses endpoint and Responses body shape preserved.
  expect(sent.url).toContain("/responses");
  expect(Array.isArray(sent.body.input)).toBe(true);
  expect(sent.body.messages).toBeUndefined();
  // Stable session cache key injected for OpenAI implicit caching.
  expect(sent.body.prompt_cache_key).toMatch(/^cxu-/);
});

test("scopes the fallback Responses cache key to the conversation prompt head", async () => {
  const calls = mockFetch({
    id: "resp_anchor",
    object: "response",
    status: "completed",
    model: "test-model",
    output: [{ type: "message", content: [{ type: "output_text", text: "pong" }] }],
    usage: { input_tokens: 4, output_tokens: 2 }
  });
  const openaiNativeProvider: ProviderConfig = {
    ...provider(),
    capabilityCatalog: {
      schema: "codex-react-ui.relay-catalog.v1",
      success: true,
      auto_groups: [],
      data: [{ model_name: "test-model", quota_type: 0, enable_groups: [], supported_endpoint_types: ["openai-response"] }],
      group_ratio: {}, usable_group: {}, supported_endpoint: {}, vendors: [], imported_at: 1, source_hash: "fixture", warnings: []
    }
  };
  const makeRequest = (head: string) => new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-prompt-cache-key": "shared-session" },
    body: JSON.stringify({
      model: "test-model",
      instructions: "same system",
      input: [{ role: "user", content: [{ type: "input_text", text: head }] }],
      stream: false
    })
  });

  await runRelayProtocolRequest({ request: makeRequest("subagent A"), provider: openaiNativeProvider, group: group("openai-response"), apiKey: "test-key" });
  await runRelayProtocolRequest({ request: makeRequest("subagent B"), provider: openaiNativeProvider, group: group("openai-response"), apiKey: "test-key" });

  expect(calls[0]!.body.prompt_cache_key).toMatch(/^cxu-/);
  expect(calls[1]!.body.prompt_cache_key).toMatch(/^cxu-/);
  expect(calls[0]!.body.prompt_cache_key).not.toBe(calls[1]!.body.prompt_cache_key);
});

test("adds a second Claude message breakpoint for long contexts without exceeding four", async () => {
  const calls = mockFetch({
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [{ type: "text", text: "pong" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 11, output_tokens: 4 }
  });
  const content = Array.from({ length: 50 }, (_, index) => ({ type: "input_text", text: "chunk-" + index }));
  const responsesInbound = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      instructions: "system prompt",
      input: [{ role: "user", content }],
      tools: [{ type: "function", name: "read_file", description: "Read a file", parameters: { type: "object", properties: {} } }]
    })
  });

  await runRelayProtocolRequest({ request: responsesInbound, provider: provider(), group: group("anthropic"), apiKey: "test-key" });
  const sent = calls[0]!.body;
  const sentMessages = sent.messages as Array<Record<string, unknown>>;
  const marked = (sentMessages[0]!.content as Array<Record<string, unknown>>)
    .map((block, index) => block.cache_control ? index : -1)
    .filter((index) => index >= 0);
  const toolBreakpoints = (sent.tools as Array<Record<string, unknown>>).filter((tool) => tool.cache_control).length;
  const systemBreakpoints = (sent.system as Array<Record<string, unknown>>).filter((block) => block.cache_control).length;
  expect(marked).toEqual([29, 49]);
  expect(systemBreakpoints + toolBreakpoints + marked.length).toBe(4);
});

test("injects Cline client headers and unwraps response for cline-free group", async () => {
  const calls = mockFetch({
    success: true,
    data: {
      model: "deepseek/deepseek-v4-flash",
      choices: [{ finish_reason: "stop", message: { content: "hello from cline" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }
  });

  const responsesInbound = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      input: "hello"
    })
  });

  const clineGroup = {
    ...group("openai"),
    id: "cline-free",
    baseUrl: "https://api.cline.bot/api/v1",
    authType: "bearer" as const
  };

  const response = await runRelayProtocolRequest({
    request: responsesInbound,
    provider: provider(),
    group: clineGroup,
    apiKey: "raw-jwt-without-prefix"
  });

  expect(calls).toHaveLength(1);
  const reqHeaders = calls[0]!.headers;
  expect(reqHeaders.get("User-Agent")).toBe("Cline/4.1.16");
  expect(reqHeaders.get("HTTP-Referer")).toBe("https://cline.bot");
  expect(reqHeaders.get("X-Title")).toBe("Cline");
  expect(reqHeaders.get("X-CLIENT-TYPE")).toBe("vscode");
  expect(reqHeaders.get("Authorization")).toBe("Bearer workos:raw-jwt-without-prefix");

  expect(response.status).toBe(200);
  const body = (await response.json()) as { output: Array<{ content?: Array<{ text?: string }> }> };
  expect(body.output[0]?.content?.[0]?.text).toBe("hello from cline");
});

test("keyless opencode-free goes out through the true-client kernel with Bearer public", async () => {
  const calls = mockFetch({
    model: "nemotron-3.5-lightning-free",
    choices: [{ finish_reason: "stop", message: { content: "hello from opencode free" } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 }
  });

  const responsesInbound = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nemotron-3.5-lightning-free",
      input: "hello"
    })
  });

  const opencodeGroup = {
    ...group("openai"),
    id: "opencode-free",
    baseUrl: "https://opencode.ai/zen/v1",
    authType: "none" as const,
    keys: []
  };

  const response = await runRelayProtocolRequest({
    request: responsesInbound,
    provider: provider(),
    group: opencodeGroup,
    apiKey: ""
  });

  expect(calls).toHaveLength(1);
  const reqHeaders = calls[0]!.headers;
  // Keyless opencode-free goes out through the true-client kernel
  // (inference/v1 + Bearer public + CLI identity), not the zen surface.
  expect(reqHeaders.get("User-Agent")).toBe(OPENCODE_KERNEL_CHAT_USER_AGENT);
  expect(reqHeaders.get("x-opencode-client")).toBe("cli");
  expect(reqHeaders.get("Authorization")).toBe("Bearer public");

  expect(reqHeaders.get("x-opencode-project")).toBe("global");
  expect(OPENCODE_SESSION_PATTERN.test(reqHeaders.get("x-opencode-session") ?? "")).toBe(true);
  expect(OPENCODE_REQUEST_PATTERN.test(reqHeaders.get("x-opencode-request") ?? "")).toBe(true);

  expect(response.status).toBe(200);
  const body = (await response.json()) as { output: Array<{ content?: Array<{ text?: string }> }> };
  expect(body.output[0]?.content?.[0]?.text).toBe("hello from opencode free");
});

test("OpenCode kernel payload rebuild drops zen-only fields and honors the explicit token budget", async () => {
  const calls = mockFetch({
    model: "muse-spark-1.2-contributor-free",
    choices: [{ finish_reason: "stop", message: { content: "ok" } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 }
  });

  const responsesInbound = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "muse-spark-1.2-contributor-free",
      input: "hello",
      max_output_tokens: 100,
      client_metadata: { platform: "codex" },
      response_format: {
        type: "json_schema",
        json_schema: { schema: { type: "object", properties: { key: { type: "string" } } } }
      }
    })
  });

  const opencodeGroup = {
    ...group("openai-response"),
    id: "opencode-free",
    baseUrl: "https://opencode.ai/zen/v1",
    authType: "none" as const,
    keys: []
  };

  await runRelayProtocolRequest({
    request: responsesInbound,
    provider: provider(),
    group: opencodeGroup,
    apiKey: ""
  });

  expect(calls).toHaveLength(1);
  const sentBody = calls[0]!.body;
  expect(sentBody.client_metadata).toBeUndefined();
  // Kernel rebuild: an explicit caller budget always wins (no zen floor).
  expect(sentBody.max_tokens ?? sentBody.max_output_tokens).toBe(100);

  // Test DeepSeek V4 Flash free json_schema downgrade
  const deepseekCalls = mockFetch({
    model: "deepseek-v4-flash-free",
    choices: [{ finish_reason: "stop", message: { content: '{"result":true}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 }
  });

  const deepseekInbound = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-v4-flash-free",
      input: "generate json",
      client_metadata: { session: "123" },
      response_format: {
        type: "json_schema",
        json_schema: { schema: { type: "object", properties: { result: { type: "boolean" } } } }
      }
    })
  });

  await runRelayProtocolRequest({
    request: deepseekInbound,
    provider: provider(),
    group: opencodeGroup,
    apiKey: ""
  });

  expect(deepseekCalls).toHaveLength(1);
  const deepseekSentBody = deepseekCalls[0]!.body;
  expect(deepseekSentBody.client_metadata).toBeUndefined();
  // Kernel rebuild is field-by-field: zen-only response_format never goes out.
  expect(deepseekSentBody.response_format).toBeUndefined();
  expect(deepseekSentBody.stream).toBe(true);
});

test("OpenCode kernel honours a Responses group surface for chat-native models", async () => {
  const calls = mockFetch({
    id: "resp_kernel",
    object: "response",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }],
    usage: { input_tokens: 10, output_tokens: 5 }
  });
  const responsesInbound = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "beam-free",
      input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
      max_output_tokens: 64
    })
  });
  const opencodeGroup = {
    ...group("openai-response"),
    id: "opencode-free",
    baseUrl: "https://opencode.ai/zen/v1",
    authType: "none" as const,
    keys: [] as string[],
    models: ["beam-free"]
  };
  await runRelayProtocolRequest({
    request: responsesInbound,
    provider: provider(),
    group: opencodeGroup,
    apiKey: ""
  });

  expect(calls).toHaveLength(1);
  // Responses caller -> /inference/v1/responses + Responses UA, not chat.
  expect(calls[0]!.url).toBe("https://opencode.ai/inference/v1/responses");
  const reqHeaders = calls[0]!.headers;
  expect(reqHeaders.get("User-Agent")).toBe(OPENCODE_KERNEL_RESPONSES_USER_AGENT);
  expect(reqHeaders.get("Authorization")).toBe("Bearer public");
  expect(reqHeaders.get("x-opencode-client")).toBe("cli");

  const sentBody = calls[0]!.body;
  // Chat-native model still speaks the Responses shape for a Responses caller.
  expect(sentBody.messages).toBeUndefined();
  expect(sentBody.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "hello" }] }]);
  expect(sentBody.include).toBeUndefined();
  expect(sentBody.max_output_tokens).toBe(64);
  // Free-tier admission tool travels in the flat Responses shape.
  expect(sentBody.tools).toEqual([
    { type: "function", name: "read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }
  ]);
});

test("keyless opencode-free chat goes out through the true-client kernel", async () => {
  const calls = mockFetch({
    id: "chatcmpl-kernel",
    model: "beam-free",
    choices: [{ message: { content: "hello from kernel chat" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 }
  });
  const chatInbound = new Request("http://127.0.0.1/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "opencode/beam-free",
      messages: [{ role: "user", content: "hello" }]
    })
  });
  const opencodeGroup = {
    ...group("openai"),
    id: "opencode-free",
    baseUrl: "https://opencode.ai/zen/v1",
    authType: "none" as const,
    keys: [] as string[],
    models: ["opencode/beam-free"]
  };
  const response = await runRelayChatRequest({
    request: chatInbound,
    provider: provider(),
    group: opencodeGroup,
    apiKey: ""
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://opencode.ai/inference/v1/chat/completions");
  const reqHeaders = calls[0]!.headers;
  expect(reqHeaders.get("User-Agent")).toBe(OPENCODE_KERNEL_CHAT_USER_AGENT);
  expect(reqHeaders.get("x-opencode-client")).toBe("cli");
  expect(reqHeaders.get("Authorization")).toBe("Bearer public");
  expect(OPENCODE_SESSION_PATTERN.test(reqHeaders.get("x-opencode-session") ?? "")).toBe(true);
  expect(OPENCODE_REQUEST_PATTERN.test(reqHeaders.get("x-opencode-request") ?? "")).toBe(true);
  const sentBody = calls[0]!.body;
  expect(sentBody.model).toBe("beam-free");
  expect(sentBody.stream).toBe(true);
  expect(sentBody.messages).toEqual([{ role: "user", content: "hello" }]);
  expect(response.status).toBe(200);
});

test("injects Freebuff session, Buffy prompt prefix, codebuff_metadata, and decide tool for freebuff group", async () => {
  clearFreebuffSession();
  const calls: Array<{ url: string; method: string; headers: Headers; body?: any }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    let parsedBody: any = undefined;
    if (init?.body && typeof init.body === "string") {
      try { parsedBody = JSON.parse(init.body); } catch {}
    }
    calls.push({ url, method, headers, body: parsedBody });

    if (url.includes("/freebuff/session")) {
      return Response.json({
        status: "active",
        instanceId: "inst_mock_fb_123",
        model: "z-ai/glm-5.3-flash",
        expiresAt: "2099-01-01T00:00:00.000Z"
      });
    }

    if (url.includes("/agent-runs")) {
      return Response.json({
        runId: "run_mock_fb_456"
      });
    }

    if (url.includes("/chat/completions")) {
      return Response.json({
        id: "chatcmpl-fb-1",
        model: "z-ai/glm-5.3-flash",
        choices: [{ finish_reason: "stop", message: { content: "hello from freebuff" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      });
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const responsesInbound = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "z-ai/glm-5.3-flash",
      input: "hello",
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } }
          }
        }
      ]
    })
  });

  const freebuffGroup = {
    ...group("openai"),
    id: "freebuff",
    baseUrl: "https://codebuff.com/api/v1",
    authType: "bearer" as const
  };

  const response = await runRelayProtocolRequest({
    request: responsesInbound,
    provider: provider(),
    group: freebuffGroup,
    apiKey: "fb-live-token"
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { output: Array<{ content?: Array<{ text?: string }> }> };
  expect(body.output[0]?.content?.[0]?.text).toBe("hello from freebuff");

  const chatCall = calls.find((c) => c.url.includes("/chat/completions"));
  expect(chatCall).toBeDefined();
  expect(chatCall!.headers.get("Authorization")).toBe("Bearer fb-live-token");
  expect(chatCall!.headers.get("x-codebuff-api-key")).toBe("fb-live-token");
  expect(chatCall!.headers.get("x-freebuff-instance-id")).toBe("inst_mock_fb_123");

  // Verify Buffy system prompt prefix
  expect(chatCall!.body.messages[0].role).toBe("system");
  expect(chatCall!.body.messages[0].content).toContain("You are Buffy, the coding agent behind Codebuff");

  // Verify signature tool 'decide' was appended
  const toolNames = chatCall!.body.tools.map((t: any) => t.function.name);
  expect(toolNames).toContain("read_file");
  expect(toolNames).toContain("decide");

  // Verify codebuff_metadata
  expect(chatCall!.body.codebuff_metadata).toMatchObject({
    freebuff_instance_id: "inst_mock_fb_123",
    run_id: "run_mock_fb_456",
    agent_id: "base3-free-glm-5-3-flash",
    cost_mode: "free"
  });
});

test("free channel retry policy: validates 2s, 5s, 10s ladder and 10s cap", () => {
  expect(FREE_CHANNEL_RETRY_DELAYS_MS).toEqual([2000, 5000, 10000]);
  expect(FREE_CHANNEL_MAX_DELAY_MS).toBe(10000);

  // Default ladder when no Retry-After header is provided
  const emptyHeaders = new Headers();
  expect(resolveFreeRetryDelayMs(emptyHeaders, 0)).toBe(2000);
  expect(resolveFreeRetryDelayMs(emptyHeaders, 1)).toBe(5000);
  expect(resolveFreeRetryDelayMs(emptyHeaders, 2)).toBe(10000);
  expect(resolveFreeRetryDelayMs(emptyHeaders, 3)).toBe(10000); // capped

  // Respects upstream retry-after seconds below cap
  const headersWith3s = new Headers({ "retry-after": "3" });
  expect(resolveFreeRetryDelayMs(headersWith3s, 0)).toBe(3000);

  // Enforces 10-second cap when upstream requests longer delay
  const headersWith60s = new Headers({ "retry-after": "60" });
  expect(resolveFreeRetryDelayMs(headersWith60s, 0)).toBe(10000);

  const headersWith15000ms = new Headers({ "retry-after-ms": "15000" });
  expect(resolveFreeRetryDelayMs(headersWith15000ms, 0)).toBe(10000);

  const headersWith4000ms = new Headers({ "retry-after-ms": "4000" });
  expect(resolveFreeRetryDelayMs(headersWith4000ms, 0)).toBe(4000);
});

test("free channel egress is local direct: goproxy webshare pool keys stay inert", () => {
  expect(FREE_CHANNEL_EGRESS_MODE).toBe("direct");
  // A copied goproxy `.env` must be reported as ignored, never honoured.
  expect(
    ignoredProxyPoolEnvKeys({
      WEBSHARE_PROXIES: "http://u:p@45.38.107.97:6014",
      WEBSHARE_ENABLE: "1",
      SHARE_429_ROTATE_AFTER_S: "120",
      UNRELATED: "x",
    })
  ).toEqual(["WEBSHARE_PROXIES", "WEBSHARE_ENABLE", "SHARE_429_ROTATE_AFTER_S"]);
  // Empty / whitespace values are not "configured".
  expect(ignoredProxyPoolEnvKeys({ WEBSHARE_API_KEY: "  ", WEBSHARE_FILE: "" })).toEqual([]);
  // Nothing configured: nothing to warn about.
  expect(noteDirectEgressOnly({})).toEqual([]);
});

test("isFreeChannelGroup correctly identifies all free channels and excludes paid relays", () => {
  // Free channels
  expect(isFreeChannelGroup({ ...group("openai"), id: "opencode-free" })).toBe(true);
  expect(isFreeChannelGroup({ ...group("openai"), id: "opencode" })).toBe(true);
  expect(isFreeChannelGroup({ ...group("openai"), id: "custom", baseUrl: "https://opencode.ai/zen/v1" })).toBe(true);
  expect(isFreeChannelGroup({ ...group("openai"), id: "cline-free" })).toBe(true);
  expect(isFreeChannelGroup({ ...group("openai"), id: "kilocode" })).toBe(true);
  expect(isFreeChannelGroup({ ...group("openai"), id: "freebuff" })).toBe(true);
  expect(isFreeChannelGroup({ ...group("openai"), id: "no-auth-custom", authType: "none" })).toBe(true);

  // Paid relays
  expect(isFreeChannelGroup({ ...group("openai"), id: "deepkey", baseUrl: "https://api.deepkey.com/v1", authType: "bearer" })).toBe(false);
  expect(isFreeChannelGroup({ ...group("anthropic"), id: "claude-direct", baseUrl: "https://api.anthropic.com", authType: "anthropic" })).toBe(false);
});

test("runRelayProtocolRequestWithKeyFailover silently retries on 429 for free channels and succeeds", async () => {
  let callCount = 0;
  const upstreamBodies: string[] = [];
  globalThis.fetch = (async (input, init) => {
    callCount++;
    // Every attempt (including retries) must carry the full intact body:
    // a disturbed/locked reuse would throw or arrive empty here.
    upstreamBodies.push(String((init as RequestInit)?.body ?? ""));
    if (callCount === 1) {
      // First call returns 429 with retry-after header (fast 10ms for test)
      return new Response(JSON.stringify({
        type: "error",
        error: { type: "FreeUsageLimitError", message: "Rate limit exceeded" }
      }), {
        status: 429,
        headers: { "Content-Type": "application/json", "retry-after-ms": "10" }
      });
    }
    // Second call succeeds
    return new Response(JSON.stringify({
      id: "resp_retry_success",
      object: "response",
      status: "completed",
      model: "mimo-v2.5-free",
      output: [{ type: "message", content: [{ type: "output_text", text: "recovered after 429 backoff" }] }],
      usage: { input_tokens: 5, output_tokens: 5 }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  const responsesInbound = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mimo-v2.5-free",
      input: "hello"
    })
  });

  const opencodeGroup = {
    ...group("openai-response"),
    id: "opencode-free",
    baseUrl: "https://opencode.ai/zen/v1",
    authType: "none" as const,
    keys: []
  };

  const response = await runRelayProtocolRequestWithKeyFailover({
    request: responsesInbound,
    provider: provider(),
    group: opencodeGroup,
    apiKeys: []
  });

  expect(callCount).toBe(2);
  expect(response.status).toBe(200);
  const data = await response.json() as any;
  expect(data.output[0]?.content[0]?.text).toBe("recovered after 429 backoff");
  expect(upstreamBodies).toHaveLength(2);
  for (const raw of upstreamBodies) {
    const sent = JSON.parse(raw) as Record<string, unknown>;
    expect(String(sent.model ?? "")).toContain("mimo-v2.5");
  }
});

test("runRelayChatRequestWithKeyFailover silently retries on 429 for free channels and succeeds", async () => {
  let callCount = 0;
  const upstreamBodies: string[] = [];
  globalThis.fetch = (async (input, init) => {
    callCount++;
    upstreamBodies.push(String((init as RequestInit)?.body ?? ""));
    if (callCount === 1) {
      return new Response(JSON.stringify({
        error: { message: "Too many requests", type: "rate_limit_error" }
      }), {
        status: 429,
        headers: { "Content-Type": "application/json", "retry-after-ms": "10" }
      });
    }
    return new Response(JSON.stringify({
      id: "chatcmpl_retry_success",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "recovered chat completion" } }],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  const chatInbound = new Request("http://127.0.0.1/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }]
    })
  });

  const clineFreeGroup = {
    ...group("openai"),
    id: "cline-free",
    baseUrl: "https://api.cline.bot/v1",
    authType: "none" as const,
    keys: []
  };

  const response = await runRelayChatRequestWithKeyFailover({
    request: chatInbound,
    provider: provider(),
    group: clineFreeGroup,
    apiKeys: []
  });

  expect(callCount).toBe(2);
  expect(response.status).toBe(200);
  const data = await response.json() as any;
  expect(data.choices[0]?.message?.content).toBe("recovered chat completion");
  expect(upstreamBodies).toHaveLength(2);
  for (const raw of upstreamBodies) {
    const sent = JSON.parse(raw) as Record<string, unknown>;
    expect(String(sent.model ?? "")).toContain("gpt-4o-mini");
    expect(Array.isArray(sent.messages)).toBe(true);
  }
});





function jevProvider(): ProviderConfig {
  return {
    id: "jev-relay",
    kind: "responsesRelay",
    name: "JEV",
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    nativeModels: ["jev-latest"],
    modelAliases: [],
    defaultModel: "jev-latest"
  };
}

function jevGroup(): ChannelGroupConfig {
  return {
    id: "jev",
    name: "jev",
    groupRatio: 1,
    models: ["jev-latest"],
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    authType: "inherit",
    credentialMode: "group",
    keys: ["jev-key-1", "jev-key-2"]
  };
}

function jevRequest(payload: unknown): Request {
  return new Request("http://127.0.0.1/api/relay-gateway/jev-relay/jev/v1/jev/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

const jevQuestions = {
  task_completed: { type: "choice", instructions: "Done?", criteria: { completed: "yes", failed: "no" } }
};

test("JEV runner rejects invalid requests before any upstream fetch", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response("{}", { status: 200 }); }) as typeof fetch;
  for (const payload of [
    {},
    { state: "", questions: jevQuestions },
    { state: "s" },
    { state: "s", questions: [] }
  ]) {
    const response = await runRelayJevRequest({ request: jevRequest(payload), provider: jevProvider(), group: jevGroup(), apiKey: "k" });
    expect(response.status).toBe(400);
  }
  expect(calls).toBe(0);
});

test("JEV runner rejects disabled groups and bad baseUrls without fetching", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response("{}", { status: 200 }); }) as typeof fetch;
  const payload = { state: "s", questions: jevQuestions, model: "jev-latest" };
  const disabled = await runRelayJevRequest({ request: jevRequest(payload), provider: jevProvider(), group: { ...jevGroup(), status: "disabled" }, apiKey: "k" });
  expect(disabled.status).toBe(409);
  const noUrl = await runRelayJevRequest({ request: jevRequest(payload), provider: { ...jevProvider(), baseUrl: "" }, group: { ...jevGroup(), baseUrl: "" }, apiKey: "k" });
  expect(noUrl.status).toBe(400);
  const badUrl = await runRelayJevRequest({ request: jevRequest(payload), provider: jevProvider(), group: { ...jevGroup(), baseUrl: "not-a-url" }, apiKey: "k" });
  expect(badUrl.status).toBe(400);
  expect(calls).toBe(0);
});

test("JEV runner forwards Bearer auth and returns upstream data with latency", async () => {
  let seenAuth = "";
  let seenBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    seenAuth = String(init?.headers?.Authorization ?? "");
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ answers: { task_completed: { choice: "completed", confidence: 0.9 } }, model: "jev-latest" }), { status: 200 });
  }) as typeof fetch;
  const response = await runRelayJevRequest({
    request: jevRequest({ state: "do work", questions: jevQuestions, model: "jev-latest" }),
    provider: jevProvider(),
    group: jevGroup(),
    apiKey: "jev-key-1"
  });
  expect(response.status).toBe(200);
  expect(seenAuth).toBe("Bearer jev-key-1");
  expect(seenBody).toEqual({ state: "do work", model: "jev-latest", questions: jevQuestions });
  const data = await response.json() as any;
  expect(data.data.answers.task_completed.choice).toBe("completed");
  expect(typeof data.latencyMs).toBe("number");
});

test("JEV failover rotates to the next key on upstream 401", async () => {
  const seen: string[] = [];
  let calls = 0;
  globalThis.fetch = (async (_url: any, init: any) => {
    calls += 1;
    seen.push(String(init?.headers?.Authorization ?? ""));
    if (calls === 1) return new Response(JSON.stringify({ error: "bad key" }), { status: 401 });
    return new Response(JSON.stringify({ answers: {}, model: "jev-latest" }), { status: 200 });
  }) as typeof fetch;
  const response = await runRelayJevRequestWithKeyFailover({
    request: jevRequest({ state: "s", questions: jevQuestions, model: "jev-latest" }),
    provider: jevProvider(),
    group: jevGroup(),
    apiKeys: ["jev-key-1", "jev-key-2"]
  });
  expect(calls).toBe(2);
  expect(seen).toEqual(["Bearer jev-key-1", "Bearer jev-key-2"]);
  expect(response.status).toBe(200);
});

test("responses assistant text stays strict on opencode, lenient elsewhere, tools deduped", async () => {
  const okBody = {
    object: "response",
    status: "completed",
    model: "test-model",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "pong" }] }],
    usage: { input_tokens: 11, output_tokens: 4 }
  };
  const anthropicInbound = () => new Request("http://127.0.0.1/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test-model",
      max_tokens: 128,
      system: "system prompt",
      messages: [
        { role: "user", content: [{ type: "text", text: "ping" }] },
        { role: "assistant", content: [{ type: "text", text: "reply" }] },
        { role: "user", content: [{ type: "text", text: "latest" }] }
      ],
      tools: [
        { name: "sa_vm", description: "a", input_schema: { type: "object", properties: {} } },
        { name: "sa_vm", description: "dup", input_schema: { type: "object", properties: {} } }
      ]
    })
  });

  const openCodeGroup: ChannelGroupConfig = {
    ...group("openai-response"),
    id: "opencode",
    name: "opencode",
    baseUrl: "https://opencode.ai/api"
  };
  const otherGroup = group("openai-response");

  const openCalls = mockFetch(okBody);
  await runRelayAnthropicRequest({ request: anthropicInbound(), provider: provider(), group: openCodeGroup, apiKey: "k" });
  const openInput = openCalls[0]!.body.input as Array<Record<string, unknown>>;
  const openAssistant = openInput.find((item) => item.role === "assistant");
  expect(((openAssistant!.content as Array<Record<string, unknown>>)[0]! as Record<string, unknown>).type).toBe("output_text");
  expect((openCalls[0]!.body.tools as unknown[]).length).toBe(1);

  const otherCalls = mockFetch(okBody);
  await runRelayAnthropicRequest({ request: anthropicInbound(), provider: provider(), group: otherGroup, apiKey: "k" });
  const otherInput = otherCalls[0]!.body.input as Array<Record<string, unknown>>;
  const otherAssistant = otherInput.find((item) => item.role === "assistant");
  expect(((otherAssistant!.content as Array<Record<string, unknown>>)[0]! as Record<string, unknown>).type).toBe("input_text");
  expect((otherCalls[0]!.body.tools as unknown[]).length).toBe(1);
});
