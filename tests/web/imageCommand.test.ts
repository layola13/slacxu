import { afterEach, expect, test } from "bun:test";
import { executeImageCommandRequest, type ImageCommandRequest } from "../../apps/web/src/imageCommand";
import { generateProviderImage } from "../../apps/web/src/state/codexClient";
import { buildImageThreadItems } from "../../apps/web/src/imageThreadHistory";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request(overrides: Partial<ImageCommandRequest> = {}): ImageCommandRequest {
  return {
    token: "test-token",
    mode: "generate",
    providerId: "deepkey",
    groupId: "catalog:gpt-image",
    prompt: "draw a test image",
    model: "gpt-image-2-count",
    requestId: "image-job-1",
    images: [],
    ...overrides
  };
}

test("image jobs time out and always leave the job map clean", async () => {
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  const jobs = new Map<string, AbortController>();
  await expect(executeImageCommandRequest(request({ timeoutMs: 20 }), jobs)).rejects.toMatchObject({ name: "TimeoutError" });
  expect(jobs.size).toBe(0);
});

test("image jobs can be cancelled without leaking their controller", async () => {
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  const jobs = new Map<string, AbortController>();
  const pending = executeImageCommandRequest(request({ requestId: "cancel-me", timeoutMs: 5_000 }), jobs);
  expect(jobs.has("cancel-me")).toBe(true);
  jobs.get("cancel-me")?.abort(new DOMException("cancelled", "AbortError"));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(jobs.size).toBe(0);
});

test("successful image jobs return data and clean up", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ url: "https://example.test/image.png" }] }), {
    status: 200, headers: { "content-type": "application/json" }
  })) as typeof fetch;
  const jobs = new Map<string, AbortController>();
  const result = await executeImageCommandRequest(request(), jobs);
  expect(result.data?.[0]?.url).toBe("https://example.test/image.png");
  expect(jobs.size).toBe(0);
});

test("image API errors preserve HTTP status for routing and retry UI", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "rate limited" }), {
    status: 429, headers: { "content-type": "application/json" }
  })) as typeof fetch;
  await expect(generateProviderImage("test-token", {
    providerId: "deepkey", groupId: "catalog:gpt-image", prompt: "draw"
  })).rejects.toMatchObject({ message: "rate limited", status: 429 });
});

test("saved-path image history remains schema-valid without retaining base64", () => {
  const items = buildImageThreadItems({
    prompt: "draw", mode: "generate", sourceImages: [], requestId: "req",
    provider: { id: "deepkey", kind: "responsesRelay", name: "DeepKey", nativeModels: [], modelAliases: [], createdAt: 1, updatedAt: 1 },
    group: { id: "catalog:gpt-image", name: "gpt-image", groupRatio: 0.08, keys: [] },
    result: { model: "gpt-image-2-count", data: [{ savedPath: "C:\\images\\fox.png" }] }
  });
  const imageItem = items[1] as Record<string, unknown>;
  expect(imageItem.result).toBe("");
  expect(imageItem.saved_path).toBe("C:\\images\\fox.png");
  expect(JSON.stringify(imageItem)).not.toContain("base64");
});
