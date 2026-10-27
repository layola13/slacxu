import { afterEach, expect, test } from "bun:test";
import { fetchProviderModels, testProvider } from "../../apps/server/src/providerModels.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJsonFetch(payload: unknown, status = 200): Array<{ url: string; method: string; headers: Headers; body: unknown }> {
  const calls: Array<{ url: string; method: string; headers: Headers; body: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null
    });
    return new Response(JSON.stringify(payload), { status });
  }) as typeof fetch;
  return calls;
}

test("fetchProviderModels fetches OpenAI-compatible models with bearer auth", async () => {
  const calls = mockJsonFetch({
    data: [{ id: "z-model" }, { id: "a-model" }, { id: "a-model" }]
  });

  const result = await fetchProviderModels({
    baseUrl: "https://relay.example",
    apiKey: "sk-relay",
    kind: "responsesRelay"
  });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://relay.example/v1/models");
  expect(calls[0]?.headers.get("Authorization")).toBe("Bearer sk-relay");
  expect(result).toEqual({
    endpoint: "https://relay.example/v1/models",
    models: ["a-model", "z-model"]
  });
});

test("fetchProviderModels fetches Gemini-style models and strips models prefix", async () => {
  const calls = mockJsonFetch({
    models: [{ name: "models/gemini-2.5-pro" }, { name: "models/gemini-2.5-flash" }]
  });

  const result = await fetchProviderModels({
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "gemini-key",
    kind: "gemini"
  });

  expect(calls[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models");
  expect(calls[0]?.headers.get("X-Goog-Api-Key")).toBe("gemini-key");
  expect(calls[0]?.headers.get("Authorization")).toBe("Bearer gemini-key");
  expect(result.models).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
});

test("fetchProviderModels fetches Anthropic-like models with Anthropic headers", async () => {
  const calls = mockJsonFetch({
    data: [{ id: "claude-opus-4-6" }, { id: "claude-sonnet-4-5" }]
  });

  const result = await fetchProviderModels({
    baseUrl: "https://api.anthropic.com",
    apiKey: "anthropic-key",
    kind: "anthropic"
  });

  expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/models");
  expect(calls[0]?.headers.get("Anthropic-Version")).toBe("2023-06-01");
  expect(calls[0]?.headers.get("X-Api-Key")).toBe("anthropic-key");
  expect(calls[0]?.headers.get("Authorization")).toBe("Bearer anthropic-key");
  expect(result.models).toEqual(["claude-opus-4-6", "claude-sonnet-4-5"]);
});

test("fetchProviderModels retains upstream reasoning and context capability metadata", async () => {
  mockJsonFetch({
    data: [{
      id: "claude-opus-4-8",
      capabilities: {
        supported_reasoning_efforts: ["low", "high", "xhigh", "max"],
        context_window: 1_000_000,
        max_output_tokens: 128_000
      }
    }]
  });
  const result = await fetchProviderModels({
    baseUrl: "https://relay.example",
    apiKey: "relay-key",
    protocol: "anthropic"
  });
  expect(result.models).toEqual(["claude-opus-4-8"]);
  expect(result.modelCapabilities).toEqual({
    "claude-opus-4-8": {
      reasoningEfforts: ["low", "high", "xhigh", "max"],
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      source: "upstream"
    }
  });
});

test("fetchProviderModels reports upstream HTTP failures", async () => {
  const calls = mockJsonFetch({ error: "bad key" }, 401);

  const result = await fetchProviderModels({
    baseUrl: "https://relay.example/v1",
    apiKey: "bad-key",
    kind: "responsesRelay"
  });

  expect(calls[0]?.url).toBe("https://relay.example/v1/models");
  expect(result.models).toEqual([]);
  expect(result.endpoint).toBe("https://relay.example/v1/models");
  expect(result.error).toContain("HTTP 401");
  expect(result.error).toContain("bad key");
});

test("testProvider uses the Responses endpoint and request shape for responsesRelay", async () => {
  const calls = mockJsonFetch({
    id: "resp_test",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "pong" }]
      }
    ]
  });

  const result = await testProvider({
    baseUrl: "https://relay.example/v1",
    apiKey: "sk-relay",
    kind: "responsesRelay",
    model: "gpt-5.6-sol"
  });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://relay.example/v1/responses");
  expect(calls[0]?.method).toBe("POST");
  expect(calls[0]?.headers.get("Authorization")).toBe("Bearer sk-relay");
  expect(calls[0]?.body).toEqual({
    model: "gpt-5.6-sol",
    input: "Reply with exactly: pong",
    max_output_tokens: 24
  });
  expect(calls[0]?.body).not.toHaveProperty("messages");
  expect(result.ok).toBe(true);
  expect(result.endpoint).toBe("https://relay.example/v1/responses");
  expect(result.message).toContain("Responses test passed");
});

test("testProvider reports Responses failures without falling back to chat completions", async () => {
  const calls = mockJsonFetch({ error: { message: "responses unavailable" } }, 404);

  const result = await testProvider({
    baseUrl: "https://relay.example/v1",
    apiKey: "sk-relay",
    kind: "responsesRelay",
    model: "gpt-5.6-sol"
  });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://relay.example/v1/responses");
  expect(result.ok).toBe(false);
  expect(result.message).toContain("Responses test failed: HTTP 404");
  expect(result.message).not.toContain("Chat Completions");
});

test("testProvider uses Anthropic Messages with group authentication", async () => {
  const calls = mockJsonFetch({ content: [{ type: "text", text: "pong" }] });
  const result = await testProvider({
    baseUrl: "https://relay.example/v1",
    apiKey: "claude-key",
    kind: "responsesRelay",
    protocol: "anthropic",
    authType: "anthropic",
    model: "claude-sonnet-4-6"
  });
  expect(calls[0]?.url).toBe("https://relay.example/v1/messages");
  expect(calls[0]?.headers.get("X-Api-Key")).toBe("claude-key");
  expect(calls[0]?.headers.get("Anthropic-Version")).toBe("2023-06-01");
  expect(calls[0]?.body).toMatchObject({ model: "claude-sonnet-4-6", max_tokens: 24 });
  expect(result.ok).toBe(true);
  expect(result.message).toContain("Anthropic Messages test passed");
});

test("testProvider uses Gemini native endpoint and query-key auth without exposing it in the result", async () => {
  const calls = mockJsonFetch({ candidates: [{ content: { parts: [{ text: "pong" }] } }] });
  const result = await testProvider({
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "gemini-secret",
    kind: "gemini",
    protocol: "gemini",
    authType: "google_query_key",
    model: "gemini-2.5-flash"
  });
  expect(calls[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=gemini-secret");
  expect(calls[0]?.headers.has("X-Goog-Api-Key")).toBe(false);
  expect(calls[0]?.headers.has("Authorization")).toBe(false);
  expect(calls[0]?.body).toHaveProperty("contents");
  expect(result.ok).toBe(true);
  expect(result.endpoint).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  expect(JSON.stringify(result)).not.toContain("gemini-secret");
});

test("testProvider reports native Gemini failures without protocol fallback", async () => {
  const calls = mockJsonFetch({ error: { message: "model unavailable" } }, 404);
  const result = await testProvider({
    baseUrl: "https://relay.example/v1",
    apiKey: "gemini-key",
    protocol: "gemini",
    authType: "google_api_key",
    model: "gemini-3-pro"
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://relay.example/v1beta/models/gemini-3-pro:generateContent");
  expect(result.ok).toBe(false);
  expect(result.message).toContain("Gemini generateContent test failed: HTTP 404");
});
