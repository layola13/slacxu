import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import http from "node:http";
import {
  buildUpstreamUrl,
  responsesRequestToChat,
  chatResponseToResponses,
  GrokProxyServer,
} from "../../backends/grok/src/runtime/grokCompatibleProxy.js";

describe("grokCompatibleProxy - URL Building", () => {
  it("handles base URLs ending with /v1 and relative path with /v1", () => {
    expect(buildUpstreamUrl("https://api.openai.com/v1", "/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
  });

  it("handles base URLs without /v1 and relative path with /v1", () => {
    expect(buildUpstreamUrl("https://api.openai.com", "/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
  });

  it("handles trailing slashes on base URLs", () => {
    expect(buildUpstreamUrl("https://api.jiji.com/v1/", "/v1/models")).toBe(
      "https://api.jiji.com/v1/models"
    );
  });

  it("preserves query parameters", () => {
    expect(buildUpstreamUrl("https://api.openai.com/v1", "/v1/models?limit=10")).toBe(
      "https://api.openai.com/v1/models?limit=10"
    );
  });
});

describe("grokCompatibleProxy - Protocol Translation", () => {
  it("translates simple user message from Responses to Chat Completions", () => {
    const payload = {
      input: [{ type: "message", role: "user", content: "hello world" }],
    };
    const chat = responsesRequestToChat(payload, "gpt-4o");
    expect(chat.model).toBe("gpt-4o");
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toEqual({ role: "user", content: "hello world" });
    expect(chat.stream).toBe(false);
  });

  it("handles instructions by prepending system message", () => {
    const payload = {
      instructions: "You are a coding assistant.",
      input: [{ type: "message", role: "user", content: "write code" }],
    };
    const chat = responsesRequestToChat(payload, "gpt-4o");
    expect(chat.messages).toHaveLength(2);
    expect(chat.messages[0]).toEqual({ role: "system", content: "You are a coding assistant." });
    expect(chat.messages[1]).toEqual({ role: "user", content: "write code" });
  });

  it("translates tool calls and tool outputs", () => {
    const payload = {
      input: [
        { type: "message", role: "user", content: "run test" },
        {
          type: "function_call",
          call_id: "call_abc123",
          name: "exec_command",
          arguments: '{"cmd":"bun test"}',
        },
        {
          type: "function_call_output",
          call_id: "call_abc123",
          name: "exec_command",
          content: "PASS: all tests passed",
        },
      ],
    };
    const chat = responsesRequestToChat(payload, "gpt-4o");
    expect(chat.messages).toHaveLength(3);
    expect(chat.messages[0]).toEqual({ role: "user", content: "run test" });
    expect(chat.messages[1].role).toBe("assistant");
    expect(chat.messages[1].tool_calls).toHaveLength(1);
    expect(chat.messages[1].tool_calls[0].id).toBe("call_abc123");
    expect(chat.messages[1].tool_calls[0].function.name).toBe("exec_command");
    expect(chat.messages[1].tool_calls[0].function.arguments).toBe('{"cmd":"bun test"}');
    expect(chat.messages[2]).toEqual({
      role: "tool",
      tool_call_id: "call_abc123",
      name: "exec_command",
      content: "PASS: all tests passed",
    });
  });

  it("translates tools declarations including namespace and custom exec_command", () => {
    const payload = {
      input: [{ type: "message", role: "user", content: "hello" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get current weather",
            parameters: { type: "object" },
          },
        },
        {
          type: "namespace",
          name: "git",
          tools: [
            {
              type: "function",
              function: {
                name: "commit",
                description: "Commit changes",
                parameters: { type: "object" },
              },
            },
          ],
        },
        {
          type: "custom",
          name: "exec_command",
          description: "Execute shell command",
          parameters: { type: "object" },
        },
      ],
    };
    const chat = responsesRequestToChat(payload, "gpt-4o");
    expect(chat.tools).toHaveLength(3);
    expect(chat.tools[0].function.name).toBe("get_weather");
    expect(chat.tools[1].function.name).toBe("git__commit");
    expect(chat.tools[2].function.name).toBe("exec_command");
    expect(chat.tool_choice).toBe("auto");
  });

  it("passes through reasoning_effort, max_tokens, max_completion_tokens", () => {
    const payload = {
      input: [{ type: "message", role: "user", content: "think" }],
      temperature: 0.7,
    };
    const chat = responsesRequestToChat(payload, "gpt-4o", {
      reasoningEffort: "high",
      maxTokens: 4096,
      maxCompletionTokens: 8192,
    });
    expect(chat.reasoning_effort).toBe("high");
    expect(chat.max_tokens).toBe(4096);
    expect(chat.max_completion_tokens).toBe(8192);
    expect(chat.temperature).toBe(0.7);
  });

  it("translates non-streaming chat completions response to responses format", () => {
    const chatResp = {
      id: "chatcmpl-123",
      object: "chat.completion",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello from mock assistant!",
            reasoning_content: "Thinking step 1, step 2...",
            tool_calls: [
              {
                id: "call_999",
                type: "function",
                function: { name: "test_tool", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40,
      },
    };

    const resp = chatResponseToResponses(chatResp);
    expect(resp.object).toBe("response");
    expect(resp.status).toBe("completed");
    expect(resp.output_text).toBe("Hello from mock assistant!");
    expect(resp.usage).toEqual({
      input_tokens: 15,
      output_tokens: 25,
      total_tokens: 40,
    });

    // Reasoning item, assistant message item, and tool call item
    expect(resp.output).toHaveLength(3);
    expect(resp.output[0].type).toBe("reasoning");
    expect(resp.output[0].content[0].text).toBe("Thinking step 1, step 2...");
    expect(resp.output[1].type).toBe("message");
    expect(resp.output[1].content[0].text).toBe("Hello from mock assistant!");
    expect(resp.output[2].type).toBe("function_call");
    expect(resp.output[2].call_id).toBe("call_999");
    expect(resp.output[2].name).toBe("test_tool");
  });
});

describe("GrokProxyServer - End-to-End Server Tests", () => {
  let mockUpstreamServer: http.Server;
  let mockUpstreamPort = 0;
  let proxyServer: GrokProxyServer;
  let lastUpstreamHeaders: Record<string, string | string[] | undefined> = {};

  beforeAll(async () => {
    // Start mock upstream server
    mockUpstreamServer = http.createServer(async (req, res) => {
      const url = req.url || "/";
      if (req.method === "GET" && url.includes("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [{ id: "mock-model", object: "model", created: 12345, owned_by: "test" }],
          })
        );
        return;
      }

      if (req.method === "POST" && url.includes("/chat/completions")) {
        lastUpstreamHeaders = { ...req.headers };
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

        if (body.stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "close",
          });

          // Stream reasoning delta
          res.write(
            `data: ${JSON.stringify({
              choices: [{ delta: { reasoning_content: "Thinking deeply..." } }],
            })}\n\n`
          );

          // Stream text delta
          res.write(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: "Hello " } }],
            })}\n\n`
          );
          res.write(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: "world!" } }],
            })}\n\n`
          );

          // Stream tool call delta
          res.write(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_mock_1",
                        function: { name: "mock_fn", arguments: '{"key":' },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`
          );
          res.write(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: { arguments: '"val"}' },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`
          );

          res.write(
            `data: ${JSON.stringify({
              usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
              choices: [{ delta: {}, finish_reason: "stop" }],
            })}\n\n`
          );
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        // Non-streaming response
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: `Echo: ${(body.messages?.[0]?.content) || "empty"}`,
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 },
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      mockUpstreamServer.listen(0, "127.0.0.1", () => {
        const addr = mockUpstreamServer.address() as any;
        mockUpstreamPort = addr.port;
        resolve();
      });
    });

    // Start GrokProxyServer targeting mock upstream
    proxyServer = new GrokProxyServer({
      targetBaseUrl: `http://127.0.0.1:${mockUpstreamPort}/v1`,
      targetModel: "gpt-4o",
      apiKeys: ["mock-test-key"],
      reasoningEffort: "medium",
    });
    await proxyServer.start();
  });

  afterAll(async () => {
    await proxyServer.stop();
    await new Promise<void>((resolve) => mockUpstreamServer.close(() => resolve()));
  });

  it("responds to /healthz with target model and base", async () => {
    const resp = await fetch(`${proxyServer.url}/healthz`);
    expect(resp.status).toBe(200);
    const json = await resp.json();
    expect(json.ok).toBe(true);
    expect(json.model).toBe("gpt-4o");
    expect(json.base).toBe(`http://127.0.0.1:${mockUpstreamPort}/v1`);
  });

  it("responds to /v1/models by querying upstream", async () => {
    const resp = await fetch(`${proxyServer.url}/v1/models`);
    expect(resp.status).toBe(200);
    const json = await resp.json();
    expect(json.object).toBe("list");
    expect(json.data.some((m: any) => m.id === "mock-model")).toBe(true);
  });

  it("translates non-streaming POST /v1/responses through proxy", async () => {
    const resp = await fetch(`${proxyServer.url}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: [{ type: "message", role: "user", content: "ping test" }],
        stream: false,
      }),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json();
    expect(json.object).toBe("response");
    expect(json.status).toBe("completed");
    expect(json.output_text).toBe("Echo: ping test");
    expect(json.usage.total_tokens).toBe(20);
  });

  it("translates streaming SSE POST /v1/responses through proxy", async () => {    const resp = await fetch(`${proxyServer.url}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: [{ type: "message", role: "user", content: "stream test" }],
        stream: true,
      }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/event-stream");

    const text = await resp.text();
    expect(text).toContain("event: response.created");
    expect(text).toContain("Thinking deeply...");
    expect(text).toContain("event: response.output_item.added");
    expect(text).toContain("Hello ");
    expect(text).toContain("world!");
    expect(text).toContain("mock_fn");
    expect(text).toContain('\\"key\\":\\"val\\"');
    expect(text).toContain("event: response.done");
    expect(text).toContain("event: response.completed");
  });

  it("sends dedicated UA and thread-stable x-opencode-session upstream", async () => {
    const { deriveOpenCodeSessionId } = await import("../../backends/relay-config/src/relay/omniRouteFree.js");
    const threaded = new GrokProxyServer({
      targetBaseUrl: `http://127.0.0.1:${mockUpstreamPort}/v1`,
      targetModel: "gpt-4o",
      apiKeys: ["mock-test-key"],
      threadId: "grok-thread-1",
    });
    await threaded.start();
    try {
      const expectedSession = deriveOpenCodeSessionId("grok-thread-1");
      for (let round = 0; round < 2; round++) {
        const resp = await fetch(`${threaded.url}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: false }),
        });
        expect(resp.status).toBe(200);
        expect(lastUpstreamHeaders["user-agent"]).toBe("codex-ultra-grok/1.0");
        expect(lastUpstreamHeaders["x-opencode-client"]).toBe("desktop");
        expect(lastUpstreamHeaders["x-opencode-session"]).toBe(expectedSession);
        expect(typeof lastUpstreamHeaders["x-opencode-request"]).toBe("string");
      }
    } finally {
      await threaded.stop();
    }
  });
});
