import { afterEach, expect, test } from "bun:test";
import { startCodexEngine } from "../../apps/web/src/state/codexClient.ts";

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) {
    (globalThis as typeof globalThis & { window?: Window }).window = originalWindow;
  } else {
    delete (globalThis as typeof globalThis & { window?: Window }).window;
  }
});

test("starts Codex through the authenticated engine endpoint", async () => {
  (globalThis as typeof globalThis & { window?: Partial<Window> }).window = {
    setTimeout: globalThis.setTimeout as unknown as Window["setTimeout"],
    clearTimeout: globalThis.clearTimeout as unknown as Window["clearTimeout"]
  };
  let request: { input: RequestInfo | URL; init?: RequestInit } | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    request = { input, init };
    return Response.json({ phase: "ready", transport: "stdio" });
  }) as typeof fetch;

  const status = await startCodexEngine("session-token");

  expect(status.phase).toBe("ready");
  expect(request?.input).toBe("/api/engine/start");
  expect(request?.init?.method).toBe("POST");
  expect(new Headers(request?.init?.headers).get("x-codex-ui-token")).toBe("session-token");
});

test("reports an engine startup failure from the server", async () => {
  (globalThis as typeof globalThis & { window?: Partial<Window> }).window = {
    setTimeout: globalThis.setTimeout as unknown as Window["setTimeout"],
    clearTimeout: globalThis.clearTimeout as unknown as Window["clearTimeout"]
  };
  globalThis.fetch = (async () => Response.json({ error: "Codex unavailable" }, { status: 503 })) as typeof fetch;

  expect(startCodexEngine("session-token")).rejects.toThrow("Codex unavailable");
});
