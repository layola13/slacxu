import { afterEach, describe, expect, test } from "bun:test";
import {
  MiniBridge,
  MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS,
  MINI_ANTHROPIC_CLAUDE5_MAX_TOKENS,
  MINI_ANTHROPIC_MAX_CONTINUATIONS,
  MINI_ANTHROPIC_MAX_TOKENS,
  MINI_ANTHROPIC_TRAILING_TEXT,
  isMiniAnthropicCacheControlUnsupportedError,
  isMiniAnthropicMaxTokensRejectedError,
  isMiniContextOverflowError,
  miniAnthropicApplyPromptCache,
  miniAnthropicOutputCapForModel,
  isAnthropicEndpointUnsupportedError,
  isClaudeModelId,
  isMiniAnthropicEmptyResponseError,
  isMiniAnthropicPrefillError,
  isModelProtocolUnsupportedError,
  miniAnthropicBodyIssues,
  miniAnthropicMessagesUrl,
  miniAnthropicSkeleton,
  miniChatThreadToAnthropicBody,
  stripMiniResponsesAssistantText,
  summarizeMiniResponsesInput,
  type MiniSnapshot,
} from "../../backends/mini/src/runtime/miniBridge.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function sseResponse(frames: string[]): Response {
  return new Response(frames.map((frame) => `data: ${frame}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function protocolUnsupported(): Response {
  return new Response(
    JSON.stringify({ type: "error", error: { type: "ModelProtocolUnsupported", message: "Model does not support this protocol." } }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

function okChatAnswer(text: string): Response {
  return sseResponse([
    JSON.stringify({ choices: [{ delta: { content: text } }] }),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    "[DONE]",
  ]);
}

function okAnthropicAnswer(text: string): Response {
  return sseResponse([
    JSON.stringify({ type: "message_start", message: { id: "msg-1", usage: { input_tokens: 12, output_tokens: 0 } } }),
    JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
    JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
    JSON.stringify({ type: "content_block_stop", index: 0 }),
    JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } }),
    JSON.stringify({ type: "message_stop" }),
  ]);
}

function anthropicToolCallFrames(toolId: string, name: string, args: Record<string, unknown>): string[] {
  return [
    JSON.stringify({ type: "message_start", message: { id: "msg-t", usage: { input_tokens: 50, output_tokens: 0 } } }),
    JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: toolId, name } }),
    JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(args) } }),
    JSON.stringify({ type: "content_block_stop", index: 0 }),
    JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } }),
    JSON.stringify({ type: "message_stop" }),
  ];
}

describe("isModelProtocolUnsupportedError", () => {
  test("matches the longcat-style responses 400", () => {
    expect(isModelProtocolUnsupportedError(
      new Error('responses 400: {"type":"error","error":{"type":"ModelProtocolUnsupported","message":"Model does not support this protocol."}}'),
    )).toBe(true);
    expect(isModelProtocolUnsupportedError(
      new Error("responses 400: Model does not support this protocol"),
    )).toBe(true);
  });

  test("leaves other failures alone (no model gate, no false fallback)", () => {
    // DeepKey SSE business failure: same turn must NOT switch protocol.
    expect(isModelProtocolUnsupportedError(
      new Error("responses response.failed: The request could not be processed. Please check the request parameters."),
    )).toBe(false);
    expect(isModelProtocolUnsupportedError(new Error("responses 400: bad request"))).toBe(false);
    expect(isModelProtocolUnsupportedError(new Error("responses 500: upstream error"))).toBe(false);
    expect(isModelProtocolUnsupportedError(new Error("chat 400: Model does not support this protocol."))).toBe(false);
    expect(isModelProtocolUnsupportedError(new Error("steered"))).toBe(false);
    expect(isModelProtocolUnsupportedError(undefined)).toBe(false);
  });
});

describe("isMiniAnthropicPrefillError", () => {
  test("matches the relay prefill 400 on a valid shape", () => {
    expect(isMiniAnthropicPrefillError(
      new Error('anthropic 400: {"error":{"type":"<nil>","message":"This model does not support assistant message prefill. The conversation must end with a user message. (request id: abc)"},"type":"error"} [messages: user[1txt] > assistant[2use] > user[2res]]'),
    )).toBe(true);
    expect(isMiniAnthropicPrefillError(
      new Error("anthropic invalid_request_error: must end with a user message [messages: user[1res]]"),
    )).toBe(true);
  });

  test("leaves other failures alone", () => {
    expect(isMiniAnthropicPrefillError(new Error("mini anthropic invariant (last message is assistant — prefill rejected (skeleton: user[1txt] > assistant[1txt]))"))).toBe(false);
    expect(isMiniAnthropicPrefillError(new Error("anthropic 404: Not Found"))).toBe(false);
    expect(isMiniAnthropicPrefillError(new Error("anthropic 400: unexpected tool_use_id"))).toBe(false);
    expect(isMiniAnthropicPrefillError(new Error("chat 400: must end with a user message"))).toBe(false);
    expect(isMiniAnthropicPrefillError(new Error("steered"))).toBe(false);
    expect(isMiniAnthropicPrefillError(undefined)).toBe(false);
  });
});

describe("isMiniAnthropicEmptyResponseError", () => {
  test("matches upstream closed stream with empty response error", () => {
    expect(isMiniAnthropicEmptyResponseError(
      new Error("terminated: upstream closed Anthropic stream with empty response (no content, reasoning, or tool calls)"),
    )).toBe(true);
    expect(isMiniAnthropicEmptyResponseError(
      new Error("terminated: upstream returned empty Anthropic response (no content or tool calls)"),
    )).toBe(true);
    expect(isMiniAnthropicEmptyResponseError(
      new Error("terminated: Mini Anthropic stream ended before a terminal completion marker"),
    )).toBe(true);
  });

  test("leaves other errors alone", () => {
    expect(isMiniAnthropicEmptyResponseError(new Error("anthropic 404: Not Found"))).toBe(false);
    expect(isMiniAnthropicEmptyResponseError(new Error("anthropic 500: Internal Server Error"))).toBe(false);
    expect(isMiniAnthropicEmptyResponseError(new Error("interrupted"))).toBe(false);
    expect(isMiniAnthropicEmptyResponseError(undefined)).toBe(false);
  });
});

describe("miniChatThreadToAnthropicBody trailingUserText", () => {
  const tools = [{ name: "sa_vm", description: "workspace tools", schema: { type: "object", properties: {} } }];
  const tailThread = [
    { role: "user", content: "go" },
    {
      role: "assistant", content: null,
      tool_calls: [{ id: "t1", type: "function", function: { name: "sa_vm", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "t1", content: "out" },
  ];

  test("appends trailing text only to a pure tool_result tail", () => {
    const plain = miniChatThreadToAnthropicBody(tailThread, { model: "m", tools });
    expect(miniAnthropicSkeleton(plain.messages)).toBe("user[1txt] > assistant[1use] > user[1res]");
    const nudged = miniChatThreadToAnthropicBody(tailThread, { model: "m", tools, trailingUserText: MINI_ANTHROPIC_TRAILING_TEXT });
    expect(miniAnthropicSkeleton(nudged.messages)).toBe("user[1txt] > assistant[1use] > user[1txt+1res]");
    expect(miniAnthropicBodyIssues(nudged)).toEqual([]);
    const last = (nudged.messages as Array<Record<string, unknown>>).at(-1) as Record<string, unknown>;
    expect(last.role).toBe("user");
    expect(JSON.stringify(last.content)).toContain(MINI_ANTHROPIC_TRAILING_TEXT);
  });

  test("leaves text-tailed threads untouched (nudge N/A)", () => {
    const thread = [...tailThread, { role: "user", content: "thanks" }];
    const plain = miniChatThreadToAnthropicBody(thread, { model: "m", tools });
    const nudged = miniChatThreadToAnthropicBody(thread, { model: "m", tools, trailingUserText: MINI_ANTHROPIC_TRAILING_TEXT });
    expect(miniAnthropicSkeleton(nudged.messages)).toBe(miniAnthropicSkeleton(plain.messages));
  });
});

describe("stripMiniResponsesAssistantText", () => {
  test("converts pure-text assistant items to user recap, drops empties, keeps pairs", () => {
    const input: Array<Record<string, unknown>> = [
      { role: "user", content: [{ type: "input_text", text: "go" }] },
      { role: "assistant", content: [{ type: "output_text", text: "noted the layout" }] },
      { type: "function_call", call_id: "c1", name: "sa_vm", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "ok" },
      { role: "assistant", content: [{ type: "input_text", text: "   " }] },
      { role: "assistant", content: [{ type: "output_text", text: "a" }, { type: "refusal", refusal: "no" }] },
    ];
    expect(stripMiniResponsesAssistantText(input)).toBe(2);
    expect(input).toHaveLength(5);
    expect(input[1]).toEqual({ role: "user", content: [{ type: "input_text", text: "[earlier assistant note] noted the layout" }] });
    // Pairing untouched: call and output still adjacent by call_id.
    expect(input[2]).toMatchObject({ type: "function_call", call_id: "c1" });
    expect(input[3]).toMatchObject({ type: "function_call_output", call_id: "c1" });
    // Mixed (has refusal part) is left alone; empty assistant dropped.
    expect(input[4]).toEqual({ role: "assistant", content: [{ type: "output_text", text: "a" }, { type: "refusal", refusal: "no" }] });
  });

  test("no assistant text means no rewrite", () => {
    const input: Array<Record<string, unknown>> = [
      { role: "user", content: [{ type: "input_text", text: "go" }] },
      { type: "function_call", call_id: "c1", name: "sa_vm", arguments: "{}" },
    ];
    const before = JSON.stringify(input);
    expect(stripMiniResponsesAssistantText(input)).toBe(0);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("summarizeMiniResponsesInput", () => {
  test("censuses roles/types/sizes without content", () => {
    const summary = summarizeMiniResponsesInput([
      { role: "user", content: [{ type: "input_text", text: "hi there" }] },
      { role: "assistant", content: [{ type: "input_text", text: "reply here" }] },
      { type: "function_call", call_id: "c1", name: "sa_vm", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "ok-output" },
    ]);
    expect(summary).toContain("n=4");
    expect(summary).toContain("user:1");
    expect(summary).toContain("assistant:1");
    expect(summary).toContain("input_text:2");
    expect(summary).toContain("function_call:1");
    expect(summary).toContain("function_call_output:1");
    expect(summary).toContain("chars~");
    expect(summary).not.toContain("hi there");
    expect(summary).not.toContain("ok-output");
  });
});

describe("isAnthropicEndpointUnsupportedError", () => {
  test("matches messages 404/405 only", () => {
    expect(isAnthropicEndpointUnsupportedError(new Error("anthropic 404: Not Found"))).toBe(true);
    expect(isAnthropicEndpointUnsupportedError(new Error("anthropic 405: Method Not Allowed"))).toBe(true);
    expect(isAnthropicEndpointUnsupportedError(new Error("anthropic 400: bad request"))).toBe(false);
    expect(isAnthropicEndpointUnsupportedError(new Error("anthropic overloaded: overloaded"))).toBe(false);
    expect(isAnthropicEndpointUnsupportedError(new Error("chat 404: not found"))).toBe(false);
    expect(isAnthropicEndpointUnsupportedError(undefined)).toBe(false);
  });
});

describe("miniChatThreadToAnthropicBody", () => {
  const tools = [{ name: "sa_vm", description: "workspace tools", schema: { type: "object", properties: {} } }];

  test("extracts system, maps text/tools/results, sets required fields", () => {
    const body = miniChatThreadToAnthropicBody([
      { role: "system", content: "Be concise" },
      { role: "user", content: [{ type: "text", text: "最近改了什么？" }] },
      {
        role: "assistant", content: null,
        tool_calls: [{ id: "call-1", type: "function", function: { name: "sa_vm", arguments: '{"action":"git_status"}' } }],
      },
      { role: "tool", tool_call_id: "call-1", content: '{"status":"ok"}' },
      // Orphan without a matching tool_use in the previous assistant message
      // must be dropped: Anthropic 400s `unexpected tool_use_id` otherwise.
      { role: "tool", tool_call_id: "call-2", content: '{"status":"ok2"}' },
      { role: "assistant", content: "done" },
    ], { model: "claude-haiku-5-5", tools });
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.max_tokens).toBe(MINI_ANTHROPIC_MAX_TOKENS);
    expect(body.stream).toBe(true);
    expect(body.system).toBe("Be concise");
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "user", content: "最近改了什么？" });
    const asst = messages[1] as Record<string, unknown>;
    expect(asst.role).toBe("assistant");
    expect(asst.content).toEqual([{
      type: "tool_use", id: "call-1", name: "sa_vm", input: { action: "git_status" },
    }]);
    // Only the paired result survives; the orphan is dropped.
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call-1", content: '{"status":"ok"}' },
      ],
    });
    expect(messages[3]).toEqual({ role: "assistant", content: "done" });
    expect(body.tools).toEqual([{
      name: "sa_vm", description: "workspace tools",
      input_schema: { type: "object", properties: {} },
    }]);
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  test("maps images and skips empties, omits tools when none", () => {
    const body = miniChatThreadToAnthropicBody([
      { role: "user", content: "hi" },
      {
        role: "user",
        content: [
          { type: "text", text: "see this" },
          { type: "text", text: "   " },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          // Remote URL images are skipped (base64-only, opencode parity):
          // several relays 400 on `source:{type:"url"}`.
          { type: "image_url", image_url: { url: "https://example.com/pic.png" } },
        ],
      },
      {
        role: "assistant", content: null,
        tool_calls: [{ id: "empty-out", type: "function", function: { name: "sa_vm", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "empty-out", content: "  " },
      { role: "assistant", content: "   " },
      { role: "assistant", content: null },
      { role: "tool", tool_call_id: "", content: "x" },
    ], { model: "m", tools: [] });
    expect(body.system).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    const messages = body.messages as Array<Record<string, unknown>>;
    // Consecutive user turns merge (Anthropic forbids user/user adjacency);
    // whitespace text, remote-URL images, and empty assistant/tool entries
    // are skipped; empty tool output is coerced so the block is never empty.
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "hi" },
        { type: "text", text: "see this" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ],
    });
    const asst = messages[1] as Record<string, unknown>;
    expect(asst.role).toBe("assistant");
    expect(asst.content).toEqual([
      { type: "tool_use", id: "empty-out", name: "sa_vm", input: {} },
    ]);
    expect(messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "empty-out", content: "(empty result)" }],
    });
  });

  test("merges parallel assistant tool_uses so results stay paired", () => {
    const body = miniChatThreadToAnthropicBody([
      { role: "user", content: "go" },
      {
        role: "assistant", content: null,
        tool_calls: [{ id: "toolu_01F9tBkG7Bc1jc94hgSjKZog", type: "function", function: { name: "sa_vm", arguments: "{}" } }],
      },
      {
        role: "assistant", content: null,
        tool_calls: [{ id: "toolu_01Second", type: "function", function: { name: "sa_vm", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "toolu_01F9tBkG7Bc1jc94hgSjKZog", content: "out1" },
      { role: "tool", tool_call_id: "toolu_01Second", content: "out2" },
    ], { model: "claude-haiku-5-5", tools });
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(3);
    const ids = ((messages[1] as Record<string, unknown>).content as Array<Record<string, unknown>>)
      .filter((b) => b.type === "tool_use").map((b) => b.id);
    expect(ids).toEqual(["toolu_01F9tBkG7Bc1jc94hgSjKZog", "toolu_01Second"]);
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_01F9tBkG7Bc1jc94hgSjKZog", content: "out1" },
        { type: "tool_result", tool_use_id: "toolu_01Second", content: "out2" },
      ],
    });
  });

  test("ends with user: dangling trailing tool_use is dropped (no prefill)", () => {
    const body = miniChatThreadToAnthropicBody([
      { role: "user", content: "q" },
      {
        role: "assistant", content: null,
        tool_calls: [{ id: "A", type: "function", function: { name: "sa_vm", arguments: "{}" } }],
      },
      // Orphan result: dropped, which would expose a trailing assistant.
      { role: "tool", tool_call_id: "B", content: "orphan-only" },
    ], { model: "claude-haiku-5-5", tools });
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages).toEqual([{ role: "user", content: "q" }]);
  });

  test("ends with user: trailing assistant text gets a user continuer", () => {
    const body = miniChatThreadToAnthropicBody([
      { role: "user", content: "q" },
      { role: "assistant", content: "s1 text" },
    ], { model: "claude-haiku-5-5", tools });
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[messages.length - 1]?.role).toBe("user");
    expect(messages).toHaveLength(3);
  });

  test("enforces type object on input_schema when tool schema omits type", () => {
    const rawTools = [
      { name: "test_tool", description: "d", schema: { properties: { a: { type: "string" } } } },
    ];
    const body = miniChatThreadToAnthropicBody([
      { role: "user", content: "hi" },
    ], { model: "claude-haiku-5-5", tools: rawTools });
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.input_schema).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
    });
  });
});

describe("isClaudeModelId", () => {
  test("matches claude-prefixed models only", () => {
    expect(isClaudeModelId("claude-3-5-sonnet-20241022")).toBe(true);
    expect(isClaudeModelId("Claude-Opus-4-1")).toBe(true);
    expect(isClaudeModelId("  claude-haiku")).toBe(true);
    expect(isClaudeModelId("gpt-6.1-sol")).toBe(false);
    expect(isClaudeModelId("longcat-2.5-preview-free")).toBe(false);
    expect(isClaudeModelId("anthropic/claude-3")).toBe(true);
    expect(isClaudeModelId("openai/gpt-4o")).toBe(false);
    expect(isClaudeModelId("")).toBe(false);
    expect(isClaudeModelId(undefined)).toBe(false);
  });
});

describe("miniAnthropicMessagesUrl", () => {
  test("explicit messages/ support without double-append", () => {
    expect(miniAnthropicMessagesUrl("https://relay.example/v1")).toBe("https://relay.example/v1/messages");
    expect(miniAnthropicMessagesUrl("https://relay.example/v1/")).toBe("https://relay.example/v1/messages");
    expect(miniAnthropicMessagesUrl("https://relay.example/v1/messages")).toBe("https://relay.example/v1/messages");
    expect(miniAnthropicMessagesUrl("https://relay.example/v1/messages/")).toBe("https://relay.example/v1/messages");
    expect(miniAnthropicMessagesUrl("https://relay.example/")).toBe("https://relay.example/v1/messages");
  });
});

describe("miniAnthropicBodyIssues", () => {
  const tools = [{ name: "sa_vm", description: "w", schema: { type: "object", properties: {} } }];
  test("converter output always validates (paired parallel round)", () => {
    const body = miniChatThreadToAnthropicBody([
      { role: "user", content: "go" },
      {
        role: "assistant", content: null,
        tool_calls: [{ id: "A", type: "function", function: { name: "sa_vm", arguments: "{}" } }],
      },
      {
        role: "assistant", content: null,
        tool_calls: [{ id: "B", type: "function", function: { name: "sa_vm", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "A", content: "o1" },
      { role: "tool", tool_call_id: "B", content: "o2" },
    ], { model: "claude-haiku-5-5", tools });
    expect(miniAnthropicBodyIssues(body)).toEqual([]);
    expect(miniAnthropicSkeleton((body as Record<string, unknown>).messages))
      .toBe("user[1txt] > assistant[2use] > user[2res]");
  });
  test("flags prefill, adjacency, orphans, and empty content", () => {
    expect(miniAnthropicBodyIssues({ model: "m", messages: [] }).length).toBeGreaterThan(0);
    expect(miniAnthropicBodyIssues({
      model: "m",
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: [{ type: "text", text: "tail" }] },
      ],
    }).join("|")).toMatch(/last message is assistant/);
    expect(miniAnthropicBodyIssues({
      model: "m",
      messages: [
        { role: "user", content: "a" },
        { role: "user", content: "b" },
      ],
    }).join("|")).toMatch(/repeats role user/);
    expect(miniAnthropicBodyIssues({
      model: "m",
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: [{ type: "tool_use", id: "A", name: "sa_vm", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "B", content: "x" }] },
      ],
    }).join("|")).toMatch(/orphan tool_result B/);
    expect(miniAnthropicBodyIssues({
      model: "m",
      messages: [{ role: "user", content: "q" }, { role: "assistant", content: "" }],
    }).join("|")).toMatch(/empty content/);
  });
});

describe("mini responses -> chat protocol fallback", () => {
  type Notice = { method: string; params: Record<string, unknown> };

  async function startThread(model = "chat-only-model", relayProtocol: "responses" | "anthropic" | "chat" = "responses"): Promise<{
    bridge: MiniBridge;
    threadId: string;
    urls: string[];
    bodies: string[];
    runTurn: (input: Array<Record<string, unknown>>) => Promise<Record<string, unknown>>;
  }> {
    const urls: string[] = [];
    const bodies: string[] = [];
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol: relayProtocol,
        streamMaxRetries: 5,
      }),
      onSnapshot: (_snap: MiniSnapshot | null) => {},
    });
    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model,
      providerId: "p",
      groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    const runTurn = async (input: Array<Record<string, unknown>>) => {
      const terminalPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for turn terminal event")), 15_000);
        const handler = (n: Notice) => {
          if ((n.method === "turn/completed" || n.method === "turn/failed") && n.params.turnId) {
            clearTimeout(timer);
            bridge.off("notification", handler);
            resolve({ method: n.method, params: n.params });
          }
        };
        bridge.on("notification", handler);
      });
      await bridge.request("turn/start", { threadId, input, providerId: "p", groupId: "g", model });
      return terminalPromise;
    };
    return { bridge, threadId, urls, bodies, runTurn };
  }

  test("falls back to chat on ModelProtocolUnsupported and remembers it", async () => {
    const state = await startThread();
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      if (String(url).endsWith("/responses")) return protocolUnsupported();
      return okChatAnswer("answered over chat");
    }) as typeof fetch;

    const first = await state.runTurn([{ type: "text", text: "最近改了什么？" }]);
    expect(first.method).toBe("turn/completed");
    // First request hits /responses and is rejected; the retry goes to chat.
    // (Later same-turn rounds are first-action steers, also over chat.)
    expect(state.urls[0]).toMatch(/\/responses$/);
    expect(state.urls[1]).toMatch(/\/chat\/completions$/);
    expect(state.urls.slice(1).every((u) => /\/chat\/completions$/.test(u))).toBe(true);
    expect(state.bodies[1]).toContain("最近改了什么？");

    // Second turn goes straight to chat: no wasted responses 400 probe.
    const before = state.urls.length;
    const second = await state.runTurn([{ type: "text", text: "还有呢？" }]);
    expect(second.method).toBe("turn/completed");
    const added = state.urls.slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((u) => /\/chat\/completions$/.test(u))).toBe(true);
  }, 30_000);

  test("claude models go straight to native messages", async () => {
    const state = await startThread("claude-haiku-5-5");
    const headersList: Array<HeadersInit | undefined> = [];
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      headersList.push(init?.headers);
      if (String(url).endsWith("/messages")) return okAnthropicAnswer("answered over messages");
      return protocolUnsupported();
    }) as typeof fetch;

    const first = await state.runTurn([{ type: "text", text: "最近改了什么？" }]);
    expect(first.method).toBe("turn/completed");
    expect(state.urls.length).toBeGreaterThan(0);
    expect(state.urls.every((u) => /\/messages$/.test(u))).toBe(true);
    expect(state.bodies[0]).toContain("最近改了什么？");
    expect(state.bodies[0]).toContain("max_tokens");
    expect(state.bodies[0]).toContain("input_schema");
    const h = new Headers(headersList[0]);
    expect(h.get("x-api-key")).toBe("k");
    expect(h.get("anthropic-version")).toBe("2023-06-01");
  }, 30_000);

  test("anthropic tool_use round executes and replays as tool_result", async () => {
    const state = await startThread("claude-sonnet-4-5");
    let calls = 0;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      expect(String(url)).toMatch(/\/messages$/);
      calls += 1;
      if (calls === 1) {
        return sseResponse(anthropicToolCallFrames("toolu-1", "sa_vm", { action: "git_status" }));
      }
      return okAnthropicAnswer("status is clean");
    }) as typeof fetch;

    const terminal = await state.runTurn([{ type: "text", text: "查下git状态" }]);
    expect(terminal.method).toBe("turn/completed");
    expect(calls).toBeGreaterThanOrEqual(2);
    // The follow-up request replays the tool call and its result.
    const replay = state.bodies[1];
    expect(replay).toContain("tool_use");
    expect(replay).toContain("toolu-1");
    expect(replay).toContain("tool_result");
  }, 60_000);

  test("anthropic streamed tool_use with fragmented input_json_delta reassembles args", async () => {
    const state = await startThread("claude-sonnet-4-5");
    let calls = 0;
    const args = JSON.stringify({ action: "git_status" });
    const cut = Math.floor(args.length / 2);
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      calls += 1;
      if (calls === 1) {
        return sseResponse([
          JSON.stringify({ type: "message_start", message: { id: "msg-f", usage: { input_tokens: 40, output_tokens: 0 } } }),
          JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu-frag", name: "sa_vm", input: {} } }),
          JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: args.slice(0, cut) } }),
          JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: args.slice(cut) } }),
          JSON.stringify({ type: "content_block_stop", index: 0 }),
          JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } }),
          JSON.stringify({ type: "message_stop" }),
        ]);
      }
      return okAnthropicAnswer("status is clean");
    }) as typeof fetch;

    const terminal = await state.runTurn([{ type: "text", text: "查下git状态" }]);
    expect(terminal.method).toBe("turn/completed");
    expect(calls).toBeGreaterThanOrEqual(2);
    const replay = state.bodies[1];
    expect(replay).toContain("toolu-frag");
    expect(replay).toContain("tool_result");
    // Reassembled JSON args must replay intact (not truncated or empty).
    expect(replay).toContain("git_status");
    expect(replay).not.toContain("(empty result)");
  }, 60_000);

  test("missing messages endpoint falls back to chat for non-claude models", async () => {
    const state = await startThread("generic-messages-model", "anthropic");
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      if (String(url).endsWith("/messages")) {
        return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
      }
      return okChatAnswer("answered over chat");
    }) as typeof fetch;

    const first = await state.runTurn([{ type: "text", text: "最近改了什么？" }]);
    expect(first.method).toBe("turn/completed");
    expect(state.urls[0]).toMatch(/\/messages$/);
    expect(state.urls[1]).toMatch(/\/chat\/completions$/);
    expect(state.bodies[1]).toContain("最近改了什么？");
  }, 30_000);

  test("claude models never fall back to chat on missing messages endpoint", async () => {
    const state = await startThread("claude-opus-4-1");
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      if (String(url).endsWith("/messages")) {
        return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
      }
      return okChatAnswer("unexpected chat call");
    }) as typeof fetch;

    const first = await state.runTurn([{ type: "text", text: "最近改了什么？" }]);
    expect(first.method).toBe("turn/failed");
    expect(state.urls.filter((u) => u.endsWith("/chat/completions"))).toHaveLength(0);
  }, 30_000);

  test("late invalid_request recovers by shrinking outputs and resending unchained", async () => {
    const state = await startThread("deepkey-probe-model");
    const toolArgs = [
      { action: "read_lines", path: "backends/mini/src/runtime/miniBridge.ts", start_line: 1, end_line: 200 },
      { action: "read_lines", path: "backends/mini/src/runtime/miniBridge.ts", start_line: 201, end_line: 400 },
      { action: "read_lines", path: "backends/relay-config/src/relay/relayProtocolGateway.ts", start_line: 1, end_line: 150 },
      { action: "read_lines", path: "backends/relay-config/src/relay/relayProtocolGateway.ts", start_line: 151, end_line: 300 },
    ];
    const toolFrames: string[] = [];
    toolArgs.forEach((args, i) => {
      const item = { type: "function_call", id: `fc-${i}`, call_id: `call-${i}`, name: "sa_vm" };
      toolFrames.push(JSON.stringify({ type: "response.output_item.added", output_index: i, item }));
      toolFrames.push(JSON.stringify({ type: "response.function_call_arguments.delta", item_id: `fc-${i}`, delta: JSON.stringify(args) }));
      toolFrames.push(JSON.stringify({
        type: "response.output_item.done",
        output_index: i,
        item: { ...item, arguments: JSON.stringify(args) },
      }));
    });
    toolFrames.push(JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp-round-1",
        output: toolArgs.map((args, i) => ({
          type: "function_call", call_id: `call-${i}`, name: "sa_vm", arguments: JSON.stringify(args),
        })),
        usage: { input_tokens: 100, output_tokens: 10 },
      },
    }));
    const invalidRequest = () => new Response(
      JSON.stringify({ error: { message: "The request could not be processed. Please check the request parameters.", type: "invalid_request_error", param: "", code: "invalid_request" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
    let responsesCalls = 0;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      if (!String(url).endsWith("/responses")) {
        return okChatAnswer("unexpected chat call");
      }
      responsesCalls += 1;
      // Round 1 (tools) succeeds; the chained follow-up and its full-input
      // retry both fail like the deepkey incident; the shrunk final retry
      // succeeds with a text answer.
      if (responsesCalls <= 3) {
        return responsesCalls === 1
          ? sseResponse(toolFrames)
          : invalidRequest();
      }
      return sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "recovered after shrink" }),
        JSON.stringify({ type: "response.completed", response: { id: "resp-round-4", output: [], usage: { input_tokens: 10, output_tokens: 5 } } }),
      ]);
    }) as typeof fetch;

    const terminal = await state.runTurn([{ type: "text", text: "读四个文件片段" }]);
    expect(terminal.method).toBe("turn/completed");
    expect(responsesCalls).toBe(4);
    expect(state.urls.every((u) => /\/responses$/.test(u))).toBe(true);
    // The full-input retry and the shrunk final retry differ: shrinking cut bytes.
    expect(state.bodies[2].length).toBeGreaterThan(state.bodies[3].length);
  }, 60_000);

  test("anthropic non-streaming JSON with tool_use also executes", async () => {
    const state = await startThread("claude-sonnet-4-5");
    let calls = 0;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      expect(String(url)).toMatch(/\/messages$/);
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({
          id: "msg-1", type: "message", role: "assistant",
          content: [{ type: "tool_use", id: "toolu-9", name: "sa_vm", input: { action: "git_status" } }],
          stop_reason: "tool_use",
          usage: { input_tokens: 40, output_tokens: 12 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return okAnthropicAnswer("clean");
    }) as typeof fetch;

    const terminal = await state.runTurn([{ type: "text", text: "查下git状态" }]);
    expect(terminal.method).toBe("turn/completed");
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(state.urls.every((u) => /\/messages$/.test(u))).toBe(true);
    expect(state.bodies[1]).toContain("tool_result");
  }, 60_000);

  test("anthropic error event surfaces as a named failure", async () => {
    const state = await startThread("claude-opus-4-1");
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      return sseResponse([
        JSON.stringify({ type: "message_start", message: { id: "msg-1", usage: { input_tokens: 5, output_tokens: 0 } } }),
        JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
      ]);
    }) as typeof fetch;

    const terminal = await state.runTurn([{ type: "text", text: "hi" }]);
    expect(terminal.method).toBe("turn/failed");
    expect(String((terminal.params as Record<string, unknown>).error ?? "")).toContain("anthropic");
  }, 60_000);

  function anthropicPrefillReject(): Response {
    return new Response(
      JSON.stringify({ error: { type: "<nil>", message: "This model does not support assistant message prefill. The conversation must end with a user message. (request id: probe)" }, type: "error" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  test("anthropic prefill 400 on a tool_result tail retries once with trailing text", async () => {
    const state = await startThread("claude-sonnet-4-5");
    let calls = 0;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      expect(String(url)).toMatch(/\/messages$/);
      calls += 1;
      if (calls === 1) {
        return sseResponse(anthropicToolCallFrames("toolu-n1", "sa_vm", { action: "git_status" }));
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role?: string; content?: unknown }> };
      const last = (body.messages ?? []).at(-1);
      const blocks = Array.isArray(last?.content) ? last.content as Array<{ type?: string }> : [];
      // First replay carries a pure tool_result tail -> the relay rejects it;
      // the nudged retry appends trailing text -> the relay accepts it.
      if (!blocks.some((b) => b?.type === "text")) return anthropicPrefillReject();
      return okAnthropicAnswer("status is clean");
    }) as typeof fetch;

    const terminal = await state.runTurn([{ type: "text", text: "查下git状态" }]);
    expect(terminal.method).toBe("turn/completed");
    expect(calls).toBe(3);
    expect(state.urls.every((u) => /\/messages$/.test(u))).toBe(true);
    expect(state.bodies[1]).not.toContain("Tool results received above");
    expect(state.bodies[2]).toContain("Tool results received above");
    expect(miniAnthropicBodyIssues(JSON.parse(state.bodies[2]) as Record<string, unknown>)).toEqual([]);
  }, 60_000);

  test("anthropic prefill 400 twice flips the rest of the turn to chat for non-claude models", async () => {
    const state = await startThread("generic-messages-model", "anthropic");
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      if (String(url).endsWith("/messages")) {
        const n = state.urls.filter((u) => u.endsWith("/messages")).length;
        if (n === 1) return sseResponse(anthropicToolCallFrames("toolu-f1", "sa_vm", { action: "git_status" }));
        return anthropicPrefillReject();
      }
      return okChatAnswer("done over chat");
    }) as typeof fetch;

    const first = await state.runTurn([{ type: "text", text: "查下git状态" }]);
    expect(first.method).toBe("turn/completed");
    // R1 tools, R2 plain 400, R2 nudged 400, then the same turn continues
    // over chat with history intact (no tool re-executes: same cThread).
    expect(state.urls.filter((u) => u.endsWith("/messages"))).toHaveLength(3);
    const chats = state.urls.filter((u) => u.endsWith("/chat/completions"));
    expect(chats.length).toBeGreaterThanOrEqual(1);

    // Second turn skips the doomed shape entirely.
    const before = state.urls.length;
    const second = await state.runTurn([{ type: "text", text: "还有呢？" }]);
    expect(second.method).toBe("turn/completed");
    const added = state.urls.slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((u) => /\/chat\/completions$/.test(u))).toBe(true);
  }, 90_000);

  test("anthropic prefill 400 twice fails and never flips to chat for claude models", async () => {
    const state = await startThread("claude-sonnet-4-5");
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      if (String(url).endsWith("/messages")) {
        const n = state.urls.filter((u) => u.endsWith("/messages")).length;
        if (n === 1) return sseResponse(anthropicToolCallFrames("toolu-f1", "sa_vm", { action: "git_status" }));
        return anthropicPrefillReject();
      }
      return okChatAnswer("unexpected chat call");
    }) as typeof fetch;

    const first = await state.runTurn([{ type: "text", text: "查下git状态" }]);
    expect(first.method).toBe("turn/failed");
    expect(state.urls.filter((u) => u.endsWith("/chat/completions"))).toHaveLength(0);
  }, 30_000);

  test("unchained responses 400 carries the input census and retries once after shrinking", async () => {
    const state = await startThread("deepkey-probe-model");
    const bigArgs = (n: number) => ({ action: "read_lines", path: "backends/mini/src/runtime/miniBridge.ts", start_line: n * 200 + 1, end_line: n * 200 + 200 });
    let responsesCalls = 0;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      expect(String(url)).toMatch(/\/responses$/);
      responsesCalls += 1;
      if (responsesCalls <= 4) {
        const i = responsesCalls - 1;
        return sseResponse([
          JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: `fc-u${i}`, call_id: `call-u${i}`, name: "sa_vm" } }),
          JSON.stringify({ type: "response.function_call_arguments.delta", item_id: `fc-u${i}`, delta: JSON.stringify(bigArgs(i)) }),
          JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: `fc-u${i}`, call_id: `call-u${i}`, name: "sa_vm", arguments: JSON.stringify(bigArgs(i)) } }),
          JSON.stringify({ type: "response.completed", response: { id: `resp-u${i}`, output: [{ type: "function_call", call_id: `call-u${i}`, name: "sa_vm", arguments: JSON.stringify(bigArgs(i)) }], usage: { input_tokens: 100, output_tokens: 10 } } }),
        ]);
      }
      if (responsesCalls === 5) {
        return sseResponse([
          JSON.stringify({ type: "response.output_text.delta", delta: "turn one done" }),
          JSON.stringify({ type: "response.completed", response: { id: "resp-u4", output: [], usage: { input_tokens: 10, output_tokens: 5 } } }),
        ]);
      }
      // Turn two round 1 is unchained (new turn) and carries replayed wire
      // outputs: the relay rejects it once, the shrunk retry takes one small
      // action (so no first-action steer fires), then a text round ends it.
      if (responsesCalls === 6) {
        return new Response(
          JSON.stringify({ error: { message: "The request could not be processed. Please check the request parameters.", type: "invalid_request_error", param: "", code: "invalid_request" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      if (responsesCalls === 7) {
        return sseResponse([
          JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc-u7", call_id: "call-u7", name: "sa_vm" } }),
          JSON.stringify({ type: "response.function_call_arguments.delta", item_id: "fc-u7", delta: JSON.stringify({ action: "git_status" }) }),
          JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc-u7", call_id: "call-u7", name: "sa_vm", arguments: JSON.stringify({ action: "git_status" }) } }),
          JSON.stringify({ type: "response.completed", response: { id: "resp-u7", output: [{ type: "function_call", call_id: "call-u7", name: "sa_vm", arguments: JSON.stringify({ action: "git_status" }) }], usage: { input_tokens: 100, output_tokens: 10 } } }),
        ]);
      }
      return sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "recovered unchained" }),
        JSON.stringify({ type: "response.completed", response: { id: "resp-u8", output: [], usage: { input_tokens: 10, output_tokens: 5 } } }),
      ]);
    }) as typeof fetch;

    const first = await state.runTurn([{ type: "text", text: "读四个文件片段" }]);
    expect(first.method).toBe("turn/completed");
    const second = await state.runTurn([{ type: "text", text: "再确认一遍" }]);
    expect(second.method).toBe("turn/completed");
    expect(responsesCalls).toBe(8);
    // The failing retry and the shrunk final retry differ: shrinking cut bytes.
    expect(state.bodies[5].length).toBeGreaterThan(state.bodies[6].length);
  }, 90_000);

  test("responses replay never carries assistant text, so no strip recovery is needed", async () => {
    const state = await startThread("deepkey-probe-model");
    let responsesCalls = 0;
    const hasAssistantItem = (rawBody: string): boolean => {
      try {
        const body = JSON.parse(rawBody) as { input?: Array<{ role?: string }> };
        return (body.input ?? []).some((item) => item?.role === "assistant");
      } catch { return false; }
    };
    const toolUseGitStatus = (tag: string) => sseResponse([
      JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: `fc-${tag}`, call_id: `call-${tag}`, name: "sa_vm" } }),
      JSON.stringify({ type: "response.function_call_arguments.delta", item_id: `fc-${tag}`, delta: JSON.stringify({ action: "git_status" }) }),
      JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: `fc-${tag}`, call_id: `call-${tag}`, name: "sa_vm", arguments: JSON.stringify({ action: "git_status" }) } }),
      JSON.stringify({ type: "response.completed", response: { id: `resp-${tag}`, output: [{ type: "function_call", call_id: `call-${tag}`, name: "sa_vm", arguments: JSON.stringify({ action: "git_status" }) }], usage: { input_tokens: 100, output_tokens: 10 } } }),
    ]);
    const textAnswer = (tag: string, text: string) => sseResponse([
      JSON.stringify({ type: "response.output_text.delta", delta: text }),
      JSON.stringify({ type: "response.completed", response: { id: tag, output: [], usage: { input_tokens: 10, output_tokens: 5 } } }),
    ]);
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      expect(String(url)).toMatch(/\/responses$/);
      responsesCalls += 1;
      if (responsesCalls === 1) return toolUseGitStatus("s1");
      if (responsesCalls === 2) return textAnswer("resp-s2", "status checked");
      // Turn two round 1 replays turn one's wire thread. Assistant text is
      // never replayed into rThread, so a strict gateway has nothing to
      // reject: no 400, no strip retry. (stripMiniResponsesAssistantText
      // stays as defense for stale history; see its unit tests.)
      if (responsesCalls === 4) return toolUseGitStatus("s4");
      return textAnswer("resp-s5", "all good");
    }) as typeof fetch;

    const first = await state.runTurn([{ type: "text", text: "查下git状态" }]);
    expect(first.method).toBe("turn/completed");
    const second = await state.runTurn([{ type: "text", text: "再查一遍git状态" }]);
    expect(second.method).toBe("turn/completed");
    for (const [i, body] of state.bodies.entries()) {
      expect(hasAssistantItem(body)).toBe(false);
    }
  }, 90_000);

  test("unrecoverable responses 400 surfaces the input census on the error card", async () => {
    const state = await startThread("deepkey-probe-model");
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      return new Response(
        JSON.stringify({ error: { message: "The request could not be processed. Please check the request parameters.", type: "invalid_request_error", param: "", code: "invalid_request" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const terminal = await state.runTurn([{ type: "text", text: "直接总结一下" }]);
    expect(terminal.method).toBe("turn/failed");
    const err = String((terminal.params as Record<string, unknown>).error ?? "");
    expect(err).toContain("responses 400");
    expect(err).toContain("[input: n=");
    expect(err).toContain("roles{user:");
  }, 60_000);

  test("anthropic empty stream on tool_result tail retries within messages and never touches chat", async () => {
    const state = await startThread("claude-sonnet-4-5");
    let messagesCalls = 0;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      if (String(url).endsWith("/messages")) {
        messagesCalls += 1;
        if (messagesCalls === 1) {
          return sseResponse(anthropicToolCallFrames("toolu-e1", "sa_vm", { action: "git_status" }));
        }
        if (messagesCalls === 2) {
          // Round 2 first attempt returns an empty stream; the retry stays on
          // Messages (Claude never flips to chat).
          return sseResponse([
            JSON.stringify({ type: "message_start", message: { id: "msg-empty", usage: { input_tokens: 50, output_tokens: 0 } } }),
            JSON.stringify({ type: "message_stop" }),
          ]);
        }
        return okAnthropicAnswer("done over messages");
      }
      return okChatAnswer("unexpected chat call");
    }) as typeof fetch;

    const first = await state.runTurn([{ type: "text", text: "查下git状态" }]);
    expect(first.method).toBe("turn/completed");
    // R1 messages (tool_use), R2 messages attempt 0 (empty), R2 retry answers
    // over Messages. No chat request is ever issued.
    expect(messagesCalls).toBe(3);
    expect(state.urls.filter((u) => u.endsWith("/chat/completions"))).toHaveLength(0);

    // Second turn also stays on Messages (no chat fallback is remembered).
    const before = state.urls.length;
    const second = await state.runTurn([{ type: "text", text: "还有呢？" }]);
    expect(second.method).toBe("turn/completed");
    const added = state.urls.slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((u) => /\/messages$/.test(u))).toBe(true);
  }, 90_000);

  test("anthropic empty stream on round 1 retries within messages and never touches chat", async () => {
    const state = await startThread("claude-haiku-5-5");
    let messagesCalls = 0;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      if (String(url).endsWith("/messages")) {
        messagesCalls += 1;
        if (messagesCalls === 1) {
          return sseResponse([
            JSON.stringify({ type: "message_start", message: { id: "msg-empty", usage: { input_tokens: 10, output_tokens: 0 } } }),
            JSON.stringify({ type: "message_stop" }),
          ]);
        }
        return okAnthropicAnswer("hello over messages");
      }
      return okChatAnswer("unexpected chat call");
    }) as typeof fetch;

    const first = await state.runTurn([{ type: "text", text: "hello" }]);
    expect(first.method).toBe("turn/completed");
    expect(messagesCalls).toBe(2);
    expect(state.urls.filter((u) => u.endsWith("/chat/completions"))).toHaveLength(0);
  }, 60_000);

  test("mixed read/write round: reads after a write observe post-write state", async () => {
    const fs = await import("node:fs");
    const rel = "tests/.tmp-mini-partition.txt";
    fs.rmSync(rel, { force: true });
    const state = await startThread("claude-sonnet-4-5");
    let calls = 0;
    const toolBlocks: Array<[string, Record<string, unknown>]> = [
      ["toolu-r1", { action: "read_file", path: "package.json" }],
      ["toolu-r2", { action: "count_lines", path: "package.json" }],
      ["toolu-w", { action: "write_file", path: rel, content: "PARTITION_MARKER_42" }],
      ["toolu-r3", { action: "read_file", path: rel }],
      ["toolu-r4", { action: "count_lines", path: rel }],
    ];
    try {
      globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
        state.urls.push(String(url));
        state.bodies.push(String(init?.body ?? ""));
        calls += 1;
        if (calls === 1) {
          const frames = [JSON.stringify({ type: "message_start", message: { id: "msg-m", usage: { input_tokens: 50, output_tokens: 0 } } })];
          toolBlocks.forEach(([id, args], index) => {
            frames.push(JSON.stringify({ type: "content_block_start", index, content_block: { type: "tool_use", id, name: "sa_vm" } }));
            frames.push(JSON.stringify({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(args) } }));
            frames.push(JSON.stringify({ type: "content_block_stop", index }));
          });
          frames.push(JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 40 } }));
          frames.push(JSON.stringify({ type: "message_stop" }));
          return sseResponse(frames);
        }
        return okAnthropicAnswer("done");
      }) as typeof fetch;

      const terminal = await state.runTurn([{ type: "text", text: "读写混合" }]);
      expect(terminal.method).toBe("turn/completed");
      const replay = JSON.parse(state.bodies[1]!) as { messages: Array<{ role: string; content: unknown }> };
      const results = replay.messages.flatMap((m) => Array.isArray(m.content) ? m.content as Array<Record<string, any>> : [])
        .filter((b) => b.type === "tool_result");
      const byId = new Map(results.map((b) => [String(b.tool_use_id), JSON.stringify(b.content)]));
      // Results stay in call order and all five pair up.
      expect(results.map((b) => String(b.tool_use_id))).toEqual(toolBlocks.map(([id]) => id));
      // The read issued after the write must see the written content
      // (a whole-round prewarm before the write would read a missing file).
      expect(byId.get("toolu-r3")).toContain("PARTITION_MARKER_42");
    } finally {
      fs.rmSync(rel, { force: true });
    }
  }, 60_000);

  test("anthropic requests carry prompt-cache breakpoints on system/tools/tail", async () => {
    const state = await startThread("claude-sonnet-4-5");
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      return okAnthropicAnswer("cached");
    }) as typeof fetch;
    const first = await state.runTurn([{ type: "text", text: "hello cache" }]);
    expect(first.method).toBe("turn/completed");
    const body = JSON.parse(state.bodies[0]!) as Record<string, any>;
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools.at(-1).cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools[0].cache_control).toBeUndefined();
    const tail = body.messages.at(-1);
    expect(tail.content.at(-1).cache_control).toEqual({ type: "ephemeral" });
  }, 30_000);

  test("relay rejecting cache_control retries once without it", async () => {
    const state = await startThread("claude-sonnet-4-5");
    let calls = 0;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: "Extra inputs are not permitted: cache_control" } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return okAnthropicAnswer("ok without cache");
    }) as typeof fetch;
    const first = await state.runTurn([{ type: "text", text: "hi" }]);
    expect(first.method).toBe("turn/completed");
    expect(state.bodies[0]).toContain("cache_control");
    expect(state.bodies[1]).not.toContain("cache_control");
  }, 30_000);

  test("stop_reason max_tokens continues the round instead of truncating it", async () => {
    const state = await startThread("claude-sonnet-4-5");
    let calls = 0;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      state.bodies.push(String(init?.body ?? ""));
      calls += 1;
      if (calls === 1) {
        return sseResponse([
          JSON.stringify({ type: "message_start", message: { id: "m", usage: { input_tokens: 5, output_tokens: 0 } } }),
          JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
          JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial answ" } }),
          JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 8192 } }),
          JSON.stringify({ type: "message_stop" }),
        ]);
      }
      return okAnthropicAnswer("full answer");
    }) as typeof fetch;
    const first = await state.runTurn([{ type: "text", text: "write a lot" }]);
    expect(first.method).toBe("turn/completed");
    // No 8192 limit: the first round already asks for the escalated cap, and
    // the continuation replays the truncated prefix instead of dropping it.
    expect(JSON.parse(state.bodies[0]!).max_tokens).toBe(MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS);
    expect(JSON.parse(state.bodies[1]!).max_tokens).toBe(MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS);
    expect(state.bodies[1]).toContain("partial answ");
  }, 30_000);

  test("prompt-too-long compacts older tool outputs and retries in the same turn", async () => {
    const state = await startThread("claude-sonnet-4-5");
    let calls = 0;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      state.urls.push(String(url));
      const body = String(init?.body ?? "");
      state.bodies.push(body);
      calls += 1;
      // 10 read-only tool rounds with large outputs, then overflow once, then answer.
      if (calls <= 10) {
        return sseResponse(anthropicToolCallFrames(`toolu-${calls}`, "sa_vm", { action: "read_lines", path: "tests/server/miniProtocolFallback.test.ts", start_line: calls * 60, end_line: calls * 60 + 59 }));
      }
      if (calls === 11) {
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 maximum" } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return okAnthropicAnswer("done after compact");
    }) as typeof fetch;
    const terminal = await state.runTurn([{ type: "text", text: "loop" }]);
    expect(terminal.method).toBe("turn/completed");
    expect(calls).toBeGreaterThanOrEqual(12);
    expect(state.bodies[11]!.length).toBeLessThan(state.bodies[10]!.length);
  }, 90_000);
});

describe("mini context-overflow / cache helpers", () => {
  test("isMiniContextOverflowError matches common upstream variants", () => {
    expect(isMiniContextOverflowError(new Error("anthropic 400: prompt is too long: 210000 tokens > 200000 maximum"))).toBe(true);
    expect(isMiniContextOverflowError(new Error("chat 400: {\"error\":{\"code\":\"context_length_exceeded\"}}"))).toBe(true);
    expect(isMiniContextOverflowError(new Error("This model's maximum context length is 128000 tokens"))).toBe(true);
    expect(isMiniContextOverflowError(new Error("anthropic 400: max_tokens: must be <= 8192"))).toBe(false);
    expect(isMiniContextOverflowError(new Error("relay unavailable (503)"))).toBe(false);
  });

  test("cache_control / max_tokens rejection detectors", () => {
    expect(isMiniAnthropicCacheControlUnsupportedError(new Error("anthropic 400: Extra inputs are not permitted: cache_control"))).toBe(true);
    expect(isMiniAnthropicCacheControlUnsupportedError(new Error("anthropic 400: bad thinking"))).toBe(false);
    expect(isMiniAnthropicMaxTokensRejectedError(new Error("anthropic 400: max_tokens: 32000 > 8192, which is the maximum"))).toBe(true);
    expect(isMiniAnthropicMaxTokensRejectedError(new Error("chat 400: max_tokens"))).toBe(false);
  });

  test("miniAnthropicApplyPromptCache is pure and keeps the skeleton", () => {
    const body = miniChatThreadToAnthropicBody([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ], { model: "claude-x", tools: [{ name: "a", description: "", schema: {} }, { name: "b", description: "", schema: {} }] });
    const before = JSON.stringify(body);
    const cached = miniAnthropicApplyPromptCache(body);
    expect(JSON.stringify(body)).toBe(before);
    expect(miniAnthropicSkeleton(cached.messages)).toBe(miniAnthropicSkeleton(body.messages));
    expect(miniAnthropicBodyIssues(cached)).toEqual([]);
    expect((cached.system as any[])[0]).toEqual({ type: "text", text: "sys", cache_control: { type: "ephemeral" } });
  });
});

describe("mini anthropic max_tokens continuation", () => {
  type Notice = { method: string; params: Record<string, unknown> };
  const itemOf = (n: Notice): Record<string, unknown> => (n.params.item ?? {}) as Record<string, unknown>;

  function truncatedAnthropicSse(prefix: string): Response {
    return sseResponse([
      JSON.stringify({ type: "message_start", message: { id: "m", usage: { input_tokens: 5, output_tokens: 0 } } }),
      JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
      JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: prefix } }),
      JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 8192 } }),
      JSON.stringify({ type: "message_stop" }),
    ]);
  }

  async function startAnthropicThread(): Promise<{
    bridge: MiniBridge;
    threadId: string;
    bodies: string[];
    notices: Notice[];
    runTurn: (input: Array<Record<string, unknown>>) => Promise<Record<string, unknown>>;
  }> {
    const bodies: string[] = [];
    const notices: Notice[] = [];
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol: "anthropic",
        streamMaxRetries: 5,
      }),
      onSnapshot: (_snap: MiniSnapshot | null) => {},
    });
    bridge.on("notification", (n: Notice) => { notices.push(n); });
    const started = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "claude-sonnet-4-5",
      providerId: "p",
      groupId: "g",
    })) as unknown as { thread: { id: string } };
    const threadId = started.thread.id;
    const runTurn = async (input: Array<Record<string, unknown>>) => {
      const terminalPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for turn terminal event")), 15_000);
        const handler = (n: Notice) => {
          if ((n.method === "turn/completed" || n.method === "turn/failed") && n.params.turnId) {
            clearTimeout(timer);
            bridge.off("notification", handler);
            resolve({ method: n.method, params: n.params });
          }
        };
        bridge.on("notification", handler);
      });
      await bridge.request("turn/start", { threadId, input, providerId: "p", groupId: "g", model: "claude-sonnet-4-5" });
      return terminalPromise;
    };
    return { bridge, threadId, bodies, notices, runTurn };
  }

  test("truncated prefix stays visible and the next round continues it", async () => {
    const state = await startAnthropicThread();
    // Long enough (>260 chars) to materialize live waterfall segments: the
    // old discard-and-regenerate path revoked exactly this text.
    // Direct-answer prompt: no workspace-action steer may interleave, so the
    // turn is exactly truncate -> continue -> complete.
    const prefix = `FIRST-PART-${"x".repeat(600)}`;
    const suffix = "SECOND-PART-DONE";
    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      state.bodies.push(String(init?.body ?? ""));
      calls += 1;
      if (calls === 1) return truncatedAnthropicSse(prefix);
      return okAnthropicAnswer(suffix);
    }) as typeof fetch;
    const terminal = await state.runTurn([{ type: "text", text: "explain black holes in simple terms, at length" }]);
    expect(terminal.method).toBe("turn/completed");
    expect(calls).toBe(2);
    expect(JSON.parse(state.bodies[0]!).max_tokens).toBe(MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS);
    expect(JSON.parse(state.bodies[1]!).max_tokens).toBe(MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS);
    // Continuation: the truncated prefix is replayed into the next request
    // instead of being dropped and regenerated.
    expect(state.bodies[1]).toContain("FIRST-PART-");
    const retryNotice = state.notices.find((n) =>
      n.method === "item/completed"
      && itemOf(n).type === "retryError"
      && String(itemOf(n).text ?? "").includes("continuing with max_tokens=64000"));
    expect(retryNotice).toBeDefined();
    // Nothing streamed is ever revoked from the waterfall on this path.
    expect(state.notices.some((n) => n.method === "mini/item/rollback")).toBe(false);
    // The retry card settles instead of staying running forever.
    const recovered = state.notices.find((n) =>
      n.method === "item/completed"
      && itemOf(n).type === "retryError"
      && String(itemOf(n).title ?? "") === "Retry recovered");
    expect(recovered).toBeDefined();
    expect(String(itemOf(recovered!).status ?? "")).toBe("completed");
    // Terminal carries a server completedAt so the client never drops it as
    // ambiguous while a retry card exists.
    const turn = terminal.params.turn as Record<string, unknown>;
    expect(typeof turn.completedAt).toBe("number");
    // Final answer is prefix + continuation, not a lone truncated paragraph.
    const finalText = state.notices
      .filter((n) => n.method === "item/completed" && itemOf(n).type === "agentMessage")
      .map((n) => String(itemOf(n).text ?? ""))
      .join("");
    expect(finalText).toContain("FIRST-PART-");
    expect(finalText).toContain(suffix);
  }, 30_000);

  test("a second truncation keeps continuing instead of silently truncating", async () => {
    const state = await startAnthropicThread();
    const prefix = `FIRST-PART-${"x".repeat(600)}`;
    const mid = `MID-PART-${"y".repeat(400)}`;
    const suffix = "SECOND-PART-DONE";
    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      state.bodies.push(String(init?.body ?? ""));
      calls += 1;
      if (calls === 1) return truncatedAnthropicSse(prefix);
      if (calls === 2) return truncatedAnthropicSse(mid);
      return okAnthropicAnswer(suffix);
    }) as typeof fetch;
    const terminal = await state.runTurn([{ type: "text", text: "explain black holes in simple terms, at length" }]);
    expect(terminal.method).toBe("turn/completed");
    expect(calls).toBe(3);
    expect(JSON.parse(state.bodies[1]!).max_tokens).toBe(MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS);
    expect(JSON.parse(state.bodies[2]!).max_tokens).toBe(MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS);
    // Both truncated chunks are replayed for the final continuation round.
    expect(state.bodies[2]).toContain("FIRST-PART-");
    expect(state.bodies[2]).toContain("MID-PART-");
    expect(MINI_ANTHROPIC_MAX_CONTINUATIONS).toBeGreaterThanOrEqual(2);
    expect(state.notices.some((n) => n.method === "mini/item/rollback")).toBe(false);
    const finalText = state.notices
      .filter((n) => n.method === "item/completed" && itemOf(n).type === "agentMessage")
      .map((n) => String(itemOf(n).text ?? ""))
      .join("");
    expect(finalText).toContain("FIRST-PART-");
    expect(finalText).toContain("MID-PART-");
    expect(finalText).toContain(suffix);
  }, 30_000);

  test("relay rejecting the big cap falls back to default and remembers it", async () => {
    const state = await startAnthropicThread();
    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      state.bodies.push(String(init?.body ?? ""));
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: 64000 exceeds the maximum (8192)" } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return okAnthropicAnswer("capped answer");
    }) as typeof fetch;
    const prompt = [{ type: "text", text: "explain black holes in simple terms, at length" }];
    const first = await state.runTurn(prompt);
    expect(first.method).toBe("turn/completed");
    // First round tries big; the 400 falls back to the default cap.
    expect(JSON.parse(state.bodies[0]!).max_tokens).toBe(MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS);
    expect(JSON.parse(state.bodies[1]!).max_tokens).toBe(MINI_ANTHROPIC_MAX_TOKENS);
    const retryNotice = state.notices.find((n) =>
      n.method === "item/completed"
      && itemOf(n).type === "retryError"
      && String(itemOf(n).text ?? "").includes("retrying with default cap"));
    expect(retryNotice).toBeDefined();
    // The cap is remembered per thread+model: the next turn starts at the
    // default directly instead of paying another doomed 400 probe.
    const bodiesBefore = state.bodies.length;
    const second = await state.runTurn(prompt);
    expect(second.method).toBe("turn/completed");
    expect(state.bodies.length).toBe(bodiesBefore + 1);
    expect(JSON.parse(state.bodies[bodiesBefore]!).max_tokens).toBe(MINI_ANTHROPIC_MAX_TOKENS);
  }, 30_000);

  test("steer-discard after a continuation keeps the committed prefix visible", async () => {
    const state = await startAnthropicThread();
    // Action prompt: first-action steer and auto-continue rounds interleave,
    // and their discards must only revoke their own chunks, never the
    // already-committed truncation prefix.
    const prefix = `FIRST-PART-${"x".repeat(600)}`;
    const suffix = "SECOND-PART-DONE";
    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      state.bodies.push(String(init?.body ?? ""));
      calls += 1;
      if (calls === 1) return truncatedAnthropicSse(prefix);
      return okAnthropicAnswer(suffix);
    }) as typeof fetch;
    const terminal = await state.runTurn([{ type: "text", text: "write a long story about a lighthouse keeper" }]);
    expect(terminal.method).toBe("turn/completed");
    expect(calls).toBeGreaterThan(2);
    expect(state.bodies[1]).toContain("FIRST-PART-");
    const retryIdx = state.notices.findIndex((n) =>
      n.method === "item/completed"
      && itemOf(n).type === "retryError"
      && String(itemOf(n).text ?? "").includes("continuing with max_tokens=64000"));
    expect(retryIdx).toBeGreaterThanOrEqual(0);
    const prefixSegIds = new Set(state.notices.slice(0, retryIdx)
      .filter((n) => n.method === "item/started" && itemOf(n).type === "agentMessage")
      .map((n) => String(itemOf(n).id ?? "")));
    expect(prefixSegIds.size).toBeGreaterThan(0);
    for (const n of state.notices) {
      if (n.method !== "mini/item/rollback") continue;
      const rolled = (n.params.itemIds ?? n.params.item_ids ?? []) as unknown[];
      for (const id of rolled) {
        expect(prefixSegIds.has(String(id))).toBe(false);
      }
    }
    const finalText = state.notices
      .filter((n) => n.method === "item/completed" && itemOf(n).type === "agentMessage")
      .map((n) => String(itemOf(n).text ?? ""))
      .join("");
    expect(finalText).toContain("FIRST-PART-");
    expect(finalText).toContain(suffix);
  }, 30_000);

  test("miniAnthropicOutputCapForModel follows official per-family caps", () => {
    expect(miniAnthropicOutputCapForModel("claude-sonnet-4-5")).toBe(MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS);
    expect(miniAnthropicOutputCapForModel("claude-opus-4-5")).toBe(MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS);
    expect(miniAnthropicOutputCapForModel("claude-haiku-4-5")).toBe(MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS);
    expect(miniAnthropicOutputCapForModel("claude-sonnet-5-5")).toBe(MINI_ANTHROPIC_CLAUDE5_MAX_TOKENS);
    expect(miniAnthropicOutputCapForModel("claude-opus-5")).toBe(MINI_ANTHROPIC_CLAUDE5_MAX_TOKENS);
    expect(miniAnthropicOutputCapForModel("claude-sonnet-4-6")).toBe(MINI_ANTHROPIC_CLAUDE5_MAX_TOKENS);
    expect(miniAnthropicOutputCapForModel("claude-opus-4-8")).toBe(MINI_ANTHROPIC_CLAUDE5_MAX_TOKENS);
    expect(MINI_ANTHROPIC_CLAUDE4_MAX_TOKENS).toBe(64_000);
    expect(MINI_ANTHROPIC_CLAUDE5_MAX_TOKENS).toBe(128_000);
  });
});

