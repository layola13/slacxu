import { afterEach, expect, test } from "bun:test";
import {
  fetchUpstreamWithHeadersTimeout,
  RELAY_FAILOVER_BUDGET_MS,
  RELAY_UPSTREAM_HEADERS_TIMEOUT_MS,
  runRelayChatRequestWithKeyFailover
} from "../../backends/relay-config/src/relay/relayProtocolGateway.ts";
import type { ChannelGroupConfig, ProviderConfig } from "@codex-ui/shared";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("upstream headers timeout rejects a blackhole within budget", async () => {
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
  const startedAt = Date.now();
  const error = await fetchUpstreamWithHeadersTimeout("http://127.0.0.1:9/blackhole", {}, 150).then(
    () => null,
    (reason) => (reason instanceof Error ? reason : new Error(String(reason)))
  );
  const elapsed = Date.now() - startedAt;
  expect(error).not.toBeNull();
  expect(error?.message ?? "").toContain("Upstream headers timed out after 150ms");
  expect(elapsed).toBeLessThan(5000);
});

test("upstream helper resolves fast responses untouched", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
  const response = await fetchUpstreamWithHeadersTimeout("http://127.0.0.1:9/fast", {}, 150);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

test("upstream helper exposes default timeout and budget constants", () => {
  expect(RELAY_UPSTREAM_HEADERS_TIMEOUT_MS).toBe(30000);
  expect(RELAY_FAILOVER_BUDGET_MS).toBe(300000);
});

function paidGroup(): ChannelGroupConfig {
  return {
    id: "openai-paid",
    name: "openai-paid",
    groupRatio: 1,
    models: ["test-model"],
    baseUrl: "http://127.0.0.1:9/v1",
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    authType: "bearer",
    credentialMode: "group",
    keys: ["k1", "k2"]
  };
}

function paidProvider(): ProviderConfig {
  return {
    id: "paid-provider",
    kind: "openai",
    name: "PaidProvider",
    baseUrl: "http://127.0.0.1:9/v1",
    nativeModels: ["test-model"],
    modelAliases: [],
    defaultModel: "test-model"
  };
}

function chatRequest(): Request {
  return new Request("http://127.0.0.1/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "ping" }], stream: false })
  });
}

test("failover budget stops endless key rotation within budget", async () => {
  globalThis.fetch = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(JSON.stringify({ error: { message: "Internal Server Error" } }), { status: 500 });
  }) as unknown as typeof fetch;
  const startedAt = Date.now();
  const response = await runRelayChatRequestWithKeyFailover({
    request: chatRequest(),
    provider: paidProvider(),
    group: paidGroup(),
    apiKeys: ["k1", "k2", "k3", "k4", "k5"],
    failoverBudgetMs: 30
  });
  const elapsed = Date.now() - startedAt;
  expect(response.status).toBe(502);
  expect(elapsed).toBeLessThan(1000);
});

