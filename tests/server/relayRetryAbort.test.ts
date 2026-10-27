import { afterEach, expect, test } from "bun:test";
import type { ChannelGroupConfig, ProviderConfig } from "@codex-ui/shared";
import { runRelayChatRequestWithKeyFailover } from "../../backends/relay-config/src/relay/relayProtocolGateway.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Free-channel retry abort must fail closed with a fresh 502, never by
 * returning the already-cancelled upstream body (which made
 * finalizeRelayResponse throw "Body object should not be disturbed or
 * locked" -> 500 "Unexpected server error").
 */
test("aborted free-channel retry returns 502 JSON instead of throwing", async () => {
  globalThis.fetch = (async () =>
    new Response("upstream down", { status: 502 })) as unknown as typeof fetch;
  const group = {
    id: "kilocode",
    name: "kilocode",
    baseUrl: "http://127.0.0.1:9/unused",
    kind: "text",
    status: "enabled",
    groupRatio: 1,
    models: ["kilo-auto/free"],
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    authType: "none",
    credentialMode: "group",
    keyMode: "single",
    keys: [],
  } as unknown as ChannelGroupConfig;
  const provider = {
    id: "omniroute-free",
    name: "CodexUltraFree",
    kind: "responsesRelay",
    baseUrl: "http://127.0.0.1:9/unused",
    defaultModel: "kilo-auto/free",
    groups: [group],
  } as unknown as ProviderConfig;

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const request = new Request("http://127.0.0.1:43121/api/relay-gateway/omniroute-free/kilocode/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "kilo-auto/free", messages: [{ role: "user", content: "hi" }], stream: false }),
    signal: controller.signal,
  });
  const res = await runRelayChatRequestWithKeyFailover({
    request, provider, group, apiKeys: ["k"],
  });
  expect(res.status).toBe(502);
  const body = (await res.json()) as { error?: { message?: string } };
  expect(typeof body?.error?.message).toBe("string");
});
