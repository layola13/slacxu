import { afterEach, expect, test } from "bun:test";
import type { ProviderConfig } from "@codex-ui/shared";
import { runImageGeneration, selectImageGenerationProtocol } from "../../apps/server/src/imageProtocols.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function provider(image: ProviderConfig["image"], baseUrl = "https://deepkey.top/v1"): ProviderConfig {
  return {
    id: "image-relay",
    kind: "responsesRelay",
    name: "Image Relay",
    baseUrl,
    defaultModel: "gpt-5.5",
    image,
    nativeModels: ["gpt-5.5"],
    modelAliases: [],
    createdAt: 1,
    updatedAt: 1
  };
}

test("selectImageGenerationProtocol honors configured defaults before model auto routing", () => {
  const relay = provider({
    generations: true,
    protocols: ["openaiImages", "geminiChatCompletions", "deepkeyAsyncVideos"],
    defaultProtocol: "geminiChatCompletions"
  });

  expect(selectImageGenerationProtocol(relay, "nano_banana_2")).toBe("geminiChatCompletions");
  expect(selectImageGenerationProtocol(relay, "nano_banana_2", "deepkeyAsyncVideos")).toBe("deepkeyAsyncVideos");
});

test("selectImageGenerationProtocol keeps legacy model-based routing when no protocols are configured", () => {
  expect(selectImageGenerationProtocol(provider({ generations: true }), "nano_banana_2")).toBe("deepkeyAsyncVideos");
  expect(selectImageGenerationProtocol(provider({ generations: true }), "gemini-3.1-flash-image-preview")).toBe("geminiChatCompletions");
  expect(selectImageGenerationProtocol(provider({ generations: true }), "gpt-image-2-1k")).toBe("openaiImages");
});

test("runImageGeneration maps Gemini native protocol from DeepKey v1 base URL to v1beta generateContent", async () => {
  const calls: Array<{ url: string; body: unknown; headers: Headers }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null,
      headers: new Headers(init?.headers)
    });
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }]
            }
          }
        ]
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const result = await runImageGeneration({
    provider: provider({
      generations: true,
      protocols: ["geminiGenerateContent"],
      defaultProtocol: "geminiGenerateContent"
    }),
    apiKey: "sk-test",
    prompt: "glass banana",
    model: "gemini-3.1-flash-image-preview",
    options: {}
  });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://deepkey.top/v1beta/models/gemini-3.1-flash-image-preview:generateContent");
  expect(calls[0]?.headers.get("Authorization")).toBe("Bearer sk-test");
  expect(calls[0]?.headers.get("X-Goog-Api-Key")).toBe("sk-test");
  expect(result.status).toBe(200);
  // Path-only contract: the normalized upstream payload carries b64Json only
  // as transient input for persistImageApiResult (disk -> {savedPath}); no
  // data: URL is synthesized, so history/SQLite can never see bitmap bytes.
  expect(result.body).toMatchObject({
    endpoint: "generateContent",
    data: [{ b64Json: "aW1hZ2U=", mediaType: "image/png" }]
  });
  expect(JSON.stringify(result.body)).not.toContain("data:image/");
});

test("runImageGeneration does not send OpenAI image options to Gemini chat completions", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : {}
    });
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [{ image_url: { url: "https://example.test/result.png" } }]
            }
          }
        ]
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const result = await runImageGeneration({
    provider: provider({
      generations: true,
      protocols: ["geminiChatCompletions"],
      defaultProtocol: "geminiChatCompletions"
    }),
    apiKey: "sk-test",
    prompt: "glass banana",
    model: "gemini-3.1-flash-image-preview",
    options: { response_format: "url", size: "1024x1024", n: 1 }
  });

  expect(calls[0]?.url).toBe("https://deepkey.top/v1/chat/completions");
  expect(calls[0]?.body.response_format).toBeUndefined();
  expect(calls[0]?.body.size).toBeUndefined();
  expect(calls[0]?.body.n).toBeUndefined();
  expect(result.body).toMatchObject({
    endpoint: "chat/completions",
    data: [{ url: "https://example.test/result.png" }]
  });
});
