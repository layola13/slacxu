import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import http from "node:http";
import {
  unwrapGenerateRequest,
  geminiToOpenAiMessages,
  geminiAllowedToolNames,
  normalizeSchema,
  geminiToolsToOpenAi,
  geminiToolChoiceToOpenAi,
  buildOpenAiPayload,
  resolveOpenAiChatEndpoint,
  isGeminiNativeProtocol,
  resolveGeminiStreamEndpoint,
  AgyProxyServer,
  DEFAULT_LOAD_RESP,
  buildModelsResp,
} from "../../backends/agy/src/runtime/agyCompatibleProxy.js";

describe("agyCompatibleProxy - Protocol Translation", () => {
  it("unwraps generate request when wrapped in request property", () => {
    const raw = {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
      },
    };
    const unwrapped = unwrapGenerateRequest(raw);
    expect(unwrapped.contents).toBeDefined();
    expect(unwrapped.contents[0].parts[0].text).toBe("hi");
  });

  it("converts system instruction and user/model messages", () => {
    const req = {
      systemInstruction: {
        parts: [{ text: "You are a helpful assistant." }],
      },
      contents: [
        { role: "user", parts: [{ text: "Hello!" }] },
        { role: "model", parts: [{ text: "Hi there!" }] },
      ],
    };
    const messages = geminiToOpenAiMessages(req);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: "system", content: "You are a helpful assistant." });
    expect(messages[1]).toEqual({ role: "user", content: "Hello!" });
    expect(messages[2]).toEqual({ role: "assistant", content: "Hi there!" });
  });

  it("converts functionCall and functionResponse to OpenAI tool_calls and tool messages", () => {
    const req = {
      contents: [
        { role: "user", parts: [{ text: "list files" }] },
        {
          role: "model",
          parts: [
            { text: "I will inspect the directory." },
            {
              functionCall: {
                id: "call-1",
                name: "list_dir",
                args: { DirectoryPath: "/tmp" },
              },
            },
          ],
        },
        {
          role: "model",
          parts: [
            {
              functionResponse: {
                id: "call-1",
                name: "list_dir",
                response: { output: "ok" },
              },
            },
          ],
        },
      ],
    };

    const messages = geminiToOpenAiMessages(req);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(messages[1].tool_calls).toHaveLength(1);
    expect(messages[1].tool_calls[0].id).toBe("call-1");
    expect(messages[1].tool_calls[0].function.name).toBe("list_dir");
    expect(JSON.parse(messages[1].tool_calls[0].function.arguments)).toEqual({ DirectoryPath: "/tmp" });

    expect(messages[2].role).toBe("tool");
    expect(messages[2].tool_call_id).toBe("call-1");
    expect(JSON.parse(messages[2].content)).toEqual({ output: "ok" });
  });

  it("normalizes uppercase JSON schema types to lowercase", () => {
    const schema = {
      type: "OBJECT",
      properties: {
        path: { type: "STRING" },
        limit: { type: "INTEGER" },
        items: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
      },
    };
    const normalized = normalizeSchema(schema);
    expect(normalized.type).toBe("object");
    expect(normalized.properties.path.type).toBe("string");
    expect(normalized.properties.limit.type).toBe("integer");
    expect(normalized.properties.items.type).toBe("array");
    expect(normalized.properties.items.items.type).toBe("string");
  });

  it("translates function declarations to OpenAI tools", () => {
    const req = {
      tools: [
        {
          functionDeclarations: [
            {
              name: "read_file",
              description: "Read file contents",
              parameters: {
                type: "OBJECT",
                properties: { path: { type: "STRING" } },
                required: ["path"],
              },
            },
          ],
        },
      ],
    };
    const tools = geminiToolsToOpenAi(req);
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("read_file");
    expect(tools[0].function.description).toBe("Read file contents");
    expect(tools[0].function.parameters.type).toBe("object");
    expect(tools[0].function.parameters.properties.path.type).toBe("string");
  });

  it("translates toolConfig modes correctly", () => {
    const tools = [{ type: "function", function: { name: "read_file" } }, { type: "function", function: { name: "write_file" } }];

    // VALIDATED / AUTO -> auto
    expect(
      geminiToolChoiceToOpenAi({ toolConfig: { functionCallingConfig: { mode: "VALIDATED" } } }, tools)
    ).toBe("auto");
    expect(
      geminiToolChoiceToOpenAi({ toolConfig: { functionCallingConfig: { mode: "AUTO" } } }, tools)
    ).toBe("auto");

    // NONE -> none
    expect(
      geminiToolChoiceToOpenAi({ toolConfig: { functionCallingConfig: { mode: "NONE" } } }, tools)
    ).toBe("none");

    // ANY with single function -> specific tool
    expect(
      geminiToolChoiceToOpenAi(
        { toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["read_file"] } } },
        tools
      )
    ).toEqual({ type: "function", function: { name: "read_file" } });

    // ANY with multiple functions -> required
    expect(
      geminiToolChoiceToOpenAi(
        { toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["read_file", "write_file"] } } },
        tools
      )
    ).toBe("required");
  });

  it("builds complete OpenAI payload with target model", () => {
    const raw = {
      request: {
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      },
    };
    const payload = buildOpenAiPayload(raw, "gpt-5.6-luna", { reasoningEffort: "high" });
    expect(payload.model).toBe("gpt-5.6-luna");
    expect(payload.stream).toBe(true);
    expect(payload.temperature).toBe(0.7);
    expect(payload.max_tokens).toBe(2048);
    expect(payload.reasoning_effort).toBe("high");
    expect(payload.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("resolves OpenAI chat endpoint correctly", () => {
    expect(resolveOpenAiChatEndpoint("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/chat/completions");
    expect(resolveOpenAiChatEndpoint("https://api.openai.com")).toBe("https://api.openai.com/v1/chat/completions");
    expect(resolveOpenAiChatEndpoint("https://api.openai.com/v1/chat/completions")).toBe("https://api.openai.com/v1/chat/completions");
    expect(resolveOpenAiChatEndpoint("https://relay.example.com/prefix/v1/")).toBe("https://relay.example.com/prefix/v1/chat/completions");
  });
});

describe("agyCompatibleProxy - Mock Endpoints and Server", () => {
  let mockUpstream: http.Server;
  let upstreamPort = 0;
  let receivedUpstreamPayload: any = null;
  let receivedAuthHeader: string | null = null;
  let lastUpstreamHeaders: Record<string, string | string[] | undefined> = {};

  beforeAll(async () => {
    mockUpstream = http.createServer((req, res) => {
      receivedAuthHeader = req.headers.authorization ?? null;
      lastUpstreamHeaders = { ...req.headers };
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          receivedUpstreamPayload = JSON.parse(body);
        } catch {}

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });

        // Emit text delta
        res.write('data: {"choices":[{"delta":{"content":"Hello from mock upstream!"}}]}\n\n');

        // Emit reasoning delta and usage metadata from the relay.
        res.write('data: {"choices":[{"delta":{"reasoning_content":"Plan first."}}],"usage":{"prompt_tokens":12,"completion_tokens":7,"total_tokens":19,"prompt_tokens_details":{"cached_tokens":3}}}\n\n');

        // Emit tool call delta
        res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-test-1","function":{"name":"read_file","arguments":"{\\"path\\":\\"/test\\"}"}}]}}]}\n\n');

        // Emit [DONE]
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });

    await new Promise<void>((resolve) => {
      mockUpstream.listen(0, "127.0.0.1", () => {
        const addr = mockUpstream.address() as any;
        upstreamPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
  });

  it("serves healthz, loadCodeAssist, and fetchAvailableModels", async () => {
    const proxy = new AgyProxyServer({
      targetBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      targetModel: "gpt-5.6-luna",
      apiKeys: ["sk-test-secret-key"],
      modelDisplayName: "GPT-5.6-Luna",
    });

    const proxyUrl = await proxy.start();
    expect(proxyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    try {
      // 1. Healthz
      const healthResp = await fetch(`${proxyUrl}/healthz`);
      expect(healthResp.status).toBe(200);
      const healthJson = await healthResp.json();
      expect(healthJson.ok).toBe(true);
      expect(healthJson.model).toBe("gpt-5.6-luna");

      // 2. loadCodeAssist
      const loadResp = await fetch(`${proxyUrl}/v1internal:loadCodeAssist`, { method: "POST" });
      expect(loadResp.status).toBe(200);
      const loadJson = await loadResp.json();
      expect(loadJson.currentTier?.id).toBe("free-tier");

      // 3. fetchAvailableModels
      const modelsResp = await fetch(`${proxyUrl}/v1internal:fetchAvailableModels`, { method: "POST" });
      expect(modelsResp.status).toBe(200);
      const modelsJson = await modelsResp.json();
      expect(modelsJson.models["gemini-3.8-flash-low"]).toBeDefined();
      expect(modelsJson.models["gpt-5.6-luna"]).toBeDefined();
      expect(modelsJson.models["gpt-5.6-luna"].displayName).toBe("GPT-5.6-Luna");
    } finally {
      await proxy.stop();
    }
  });

  it("translates streamGenerateContent to upstream OpenAI and streams Gemini chunks back", async () => {
    const proxy = new AgyProxyServer({
      targetBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      targetModel: "gpt-5.6-luna",
      apiKeys: ["sk-test-secret-key"],
    });

    const proxyUrl = await proxy.start();

    try {
      const geminiRequest = {
        request: {
          contents: [{ role: "user", parts: [{ text: "Tell me a joke" }] }],
        },
      };

      const resp = await fetch(`${proxyUrl}/v1internal:streamGenerateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiRequest),
      });

      expect(resp.status).toBe(200);
      expect(resp.headers.get("content-type")).toContain("text/event-stream");

      // Verify upstream received translated OpenAI request
      expect(receivedUpstreamPayload).toBeDefined();
      expect(receivedUpstreamPayload.model).toBe("gpt-5.6-luna");
      expect(receivedUpstreamPayload.messages).toEqual([{ role: "user", content: "Tell me a joke" }]);
      expect(receivedAuthHeader).toBe("Bearer sk-test-secret-key");

      // Read returned Gemini SSE chunks
      const text = await resp.text();
      expect(text).toContain("data:");

      // Parse all chunks
      const parsedChunks = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("data:"))
        .map((l) => JSON.parse(l.slice(5).trim()));

      // Should have:
      // 1. Text delta chunk
      const textChunk = parsedChunks.find(
        (c) => c.response?.candidates?.[0]?.content?.parts?.[0]?.text === "Hello from mock upstream!"
      );
      expect(textChunk).toBeDefined();

      const reasoningChunk = parsedChunks.find(
        (c) => c.response?.candidates?.[0]?.content?.parts?.[0]?.text === "Plan first."
      );
      expect(reasoningChunk?.response.candidates[0].content.parts[0].thought).toBe(true);

      const usageChunk = parsedChunks.find((c) => c.response?.usageMetadata);
      expect(usageChunk?.response.usageMetadata).toEqual({
        promptTokenCount: 12,
        candidatesTokenCount: 7,
        totalTokenCount: 19,
        cachedContentTokenCount: 3,
      });

      // 2. Completed function call chunk
      const fnChunk = parsedChunks.find(
        (c) => c.response?.candidates?.[0]?.content?.parts?.[0]?.functionCall?.name === "read_file"
      );
      expect(fnChunk).toBeDefined();
      expect(fnChunk.response.candidates[0].content.parts[0].functionCall.args).toEqual({ path: "/test" });
      expect(fnChunk.response.candidates[0].content.parts[0].functionCall.id).toBe("call-test-1");

      // 3. FinishReason STOP chunk
      const stopChunk = parsedChunks.find(
        (c) => c.response?.candidates?.[0]?.finishReason === "STOP"
      );
      expect(stopChunk).toBeDefined();
    } finally {
      await proxy.stop();
    }
  });

  it("sends dedicated UA and thread-stable x-opencode-session upstream", async () => {
    const { deriveOpenCodeSessionId } = await import("../../backends/relay-config/src/relay/omniRouteFree.js");
    const proxy = new AgyProxyServer({
      targetBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      targetModel: "gpt-5.6-luna",
      apiKeys: ["sk-test-secret-key"],
      threadId: "agy-thread-1",
    });
    const proxyUrl = await proxy.start();
    try {
      const expectedSession = deriveOpenCodeSessionId("agy-thread-1");
      for (let round = 0; round < 2; round++) {
        const resp = await fetch(`${proxyUrl}/v1internal:streamGenerateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request: { contents: [{ role: "user", parts: [{ text: "header check" }] }] } }),
        });
        expect(resp.status).toBe(200);
        await resp.text();
        expect(lastUpstreamHeaders["user-agent"]).toBe("codex-ultra-agy/1.0");
        expect(lastUpstreamHeaders["x-opencode-client"]).toBe("desktop");
        expect(lastUpstreamHeaders["x-opencode-session"]).toBe(expectedSession);
        expect(typeof lastUpstreamHeaders["x-opencode-request"]).toBe("string");
        expect(receivedAuthHeader).toBe("Bearer sk-test-secret-key");
      }
    } finally {
      await proxy.stop();
    }
  });

  it("maps finish_reason length to MAX_TOKENS in streaming chunks", async () => {
    let lengthServerPort = 0;
    const lengthServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"Truncated text"},"finish_reason":"length"}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });

    await new Promise<void>((resolve) => {
      lengthServer.listen(0, "127.0.0.1", () => {
        lengthServerPort = (lengthServer.address() as any).port;
        resolve();
      });
    });

    const proxy = new AgyProxyServer({
      targetBaseUrl: `http://127.0.0.1:${lengthServerPort}/v1`,
      targetModel: "gpt-5.6-luna",
    });
    const proxyUrl = await proxy.start();

    try {
      const resp = await fetch(`${proxyUrl}/v1internal:streamGenerateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } }),
      });
      expect(resp.status).toBe(200);
      const text = await resp.text();
      const chunks = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("data:"))
        .map((l) => JSON.parse(l.slice(5).trim()));

      const maxTokensChunk = chunks.find(
        (c) => c.response?.candidates?.[0]?.finishReason === "MAX_TOKENS"
      );
      expect(maxTokensChunk).toBeDefined();
    } finally {
      await proxy.stop();
      await new Promise<void>((resolve) => lengthServer.close(() => resolve()));
    }
  });

  it("returns HTTP 200 with Antigravity Error SSE text chunk when upstream returns 429 to prevent OAuth popup", async () => {
    let errServerPort = 0;
    const errServer = http.createServer((_req, res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit exceeded, please retry later." } }));
    });

    await new Promise<void>((resolve) => {
      errServer.listen(0, "127.0.0.1", () => {
        errServerPort = (errServer.address() as any).port;
        resolve();
      });
    });

    const proxy = new AgyProxyServer({
      targetBaseUrl: `http://127.0.0.1:${errServerPort}/v1`,
      targetModel: "gpt-5.6-luna",
    });
    const proxyUrl = await proxy.start();

    try {
      const resp = await fetch(`${proxyUrl}/v1internal:streamGenerateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } }),
      });
      // agy.exe intercepts 4xx/5xx as Google Code Assist auth failure and opens OAuth browser login window.
      // AgyProxyServer must emit HTTP 200 SSE text candidate with [Antigravity Error] instead.
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("[Antigravity Error]");
      expect(text).toContain("Rate limit exceeded");
    } finally {
      await proxy.stop();
      await new Promise<void>((resolve) => errServer.close(() => resolve()));
    }
  });

  it("preserves upstream HTTP 400 error body as Antigravity Error SSE chunk to prevent OAuth popup", async () => {
    let errServerPort = 0;
    const errServer = http.createServer((_req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid model parameters: temperature must be <= 2" } }));
    });

    await new Promise<void>((resolve) => {
      errServer.listen(0, "127.0.0.1", () => {
        errServerPort = (errServer.address() as any).port;
        resolve();
      });
    });

    const proxy = new AgyProxyServer({
      targetBaseUrl: `http://127.0.0.1:${errServerPort}/v1`,
      targetModel: "gpt-5.6-luna",
    });
    const proxyUrl = await proxy.start();

    try {
      const resp = await fetch(`${proxyUrl}/v1internal:streamGenerateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { contents: [{ role: "user", parts: [{ text: "test" }] }] } }),
      });
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("[Antigravity Error]");
      expect(text).toContain("Invalid model parameters");
    } finally {
      await proxy.stop();
      await new Promise<void>((resolve) => errServer.close(() => resolve()));
    }
  });

  it("forwards json.error in non-stream plain JSON response as Antigravity Error SSE chunk", async () => {
    let jsonErrPort = 0;
    const jsonErrServer = http.createServer((_req, res) => {
      // Non-compliant upstream returns 200 OK with application/json, but body has error object
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Context window exceeded", code: 400 } }));
    });

    await new Promise<void>((resolve) => {
      jsonErrServer.listen(0, "127.0.0.1", () => {
        jsonErrPort = (jsonErrServer.address() as any).port;
        resolve();
      });
    });

    const proxy = new AgyProxyServer({
      targetBaseUrl: `http://127.0.0.1:${jsonErrPort}/v1`,
      targetModel: "gpt-5.6-luna",
    });
    const proxyUrl = await proxy.start();

    try {
      const resp = await fetch(`${proxyUrl}/v1internal:streamGenerateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { contents: [{ role: "user", parts: [{ text: "test" }] }] } }),
      });
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("[Antigravity Error]");
      expect(text).toContain("Context window exceeded");
    } finally {
      await proxy.stop();
      await new Promise<void>((resolve) => jsonErrServer.close(() => resolve()));
    }
  });

  it("identifies native Gemini protocols correctly", () => {
    expect(isGeminiNativeProtocol("gemini", "https://api.example.com")).toBe(true);
    expect(isGeminiNativeProtocol(undefined, "https://generativelanguage.googleapis.com")).toBe(true);
    expect(isGeminiNativeProtocol(undefined, "https://deepkey.top/v1beta")).toBe(true);
    expect(isGeminiNativeProtocol(undefined, "https://api.openai.com/v1")).toBe(false);
  });

  it("resolves Gemini stream endpoints properly", () => {
    expect(resolveGeminiStreamEndpoint("https://deepkey.top/v1beta", "gemini-3.8-flash")).toBe(
      "https://deepkey.top/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse"
    );
    expect(resolveGeminiStreamEndpoint("https://generativelanguage.googleapis.com", "gemini-2.5-flash")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
    );
  });

  it("routes native Gemini protocol directly in AgyProxyServer", async () => {
    let receivedBody: any = null;
    let receivedHeaders: any = null;
    let nativeGeminiPort = 0;

    const nativeServer = http.createServer(async (req, res) => {
      receivedHeaders = req.headers;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));

      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "Gemini native response" }] } }]
      })}

`);
      res.end();
    });

    await new Promise<void>((resolve) => {
      nativeServer.listen(0, "127.0.0.1", () => {
        nativeGeminiPort = (nativeServer.address() as any).port;
        resolve();
      });
    });

    const proxy = new AgyProxyServer({
      targetBaseUrl: `http://127.0.0.1:${nativeGeminiPort}/v1beta`,
      targetModel: "gemini-3.8-flash",
      protocol: "gemini",
      apiKeys: ["test-key-123"],
    });
    const proxyUrl = await proxy.start();

    try {
      const resp = await fetch(`${proxyUrl}/v1internal:streamGenerateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } }),
      });
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("Gemini native response");
      expect(receivedHeaders["x-goog-api-key"]).toBe("test-key-123");
      expect(receivedBody.contents[0].parts[0].text).toBe("hello");
    } finally {
      await proxy.stop();
      await new Promise<void>((resolve) => nativeServer.close(() => resolve()));
    }
  });
});

