import { afterEach, expect, test } from "bun:test";
import type { ChannelGroupConfig, ProviderConfig, RelayResponseProtocol } from "@codex-ui/shared";
import { canonicalOpencodeId } from "../../backends/relay-config/src/relay/omniRouteFree.ts";
import { runRelayChatRequest, runRelayProtocolRequest } from "../../backends/relay-config/src/relay/relayProtocolGateway.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function provider(): ProviderConfig {
  return {
    id: "mini-cache-fixture",
    kind: "responsesRelay",
    name: "Mini cache fixture",
    baseUrl: "https://relay.example/v1",
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
    keys: ["upstream-key"]
  };
}

function request(
  inbound: "chat" | "responses",
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Request {
  return new Request(`http://127.0.0.1/v1/${inbound === "chat" ? "chat/completions" : "responses"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model: "test-model",
      ...(inbound === "chat"
        ? { messages: [{ role: "user", content: "ping" }] }
        : { input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }] }),
      ...body
    })
  });
}

// Same isolated fetch-capture fixture as relayProtocolGateway.test.ts; never
// contacts the fixture URL or any real upstream, including retry attempts.
function mockFetch(errorFirst = false): Array<{ headers: Headers; body: Record<string, unknown> }> {
  const calls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (_input, init) => {
    calls.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? "{}")) });
    if (errorFirst && calls.length === 1) {
      return new Response(JSON.stringify({ error: { message: "model does not support thinking" } }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      id: "fixture-response",
      object: "response",
      model: "test-model",
      status: "completed",
      output: [],
      choices: [{ message: { role: "assistant", content: "pong" }, finish_reason: "stop" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

for (const stream of [false, true]) {
  for (const source of ["explicit", "session", "metadata"] as const) {
    test(`native Responses disabled omits ${source} cache key (stream=${stream})`, async () => {
      const calls = mockFetch();
      const response = await runRelayProtocolRequest({
        request: request("responses", {
          stream,
          ...(source === "explicit" ? { prompt_cache_key: "mini-stable-hash" } : {}),
          ...(source === "metadata" ? { metadata: { promptCacheKey: "mini-stable-hash" } } : {})
        }, { "x-codex-prompt-cache-key": "private-thread" }),
        provider: provider(), group: { ...group("openai-response"), promptCacheRouting: "disabled" }, apiKey: "upstream-key"
      });
      expect(response.status).toBe(200);
      await response.text();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.body.prompt_cache_key).toBeUndefined();
    });
  }
}

for (const routing of ["auto", "enabled"] as const) {
  test(`native Responses ${routing} preserves explicit Mini identity and hashes session fallback`, async () => {
    const calls = mockFetch();
    const relayGroup = { ...group("openai-response"), promptCacheRouting: routing };
    for (const body of [{ prompt_cache_key: "mini-stable-hash" }, {}, {}]) {
      const response = await runRelayProtocolRequest({
        request: request("responses", body, { "x-codex-prompt-cache-key": "private-thread" }),
        provider: provider(), group: relayGroup, apiKey: "upstream-key"
      });
      expect(response.status).toBe(200);
      await response.text();
    }
    expect(calls[0]!.body.prompt_cache_key).toBe("mini-stable-hash");
    expect(calls[1]!.body.prompt_cache_key).toMatch(/^cxu-/);
    expect(calls[1]!.body.prompt_cache_key).not.toContain("private-thread");
    expect(calls[2]!.body.prompt_cache_key).toBe(calls[1]!.body.prompt_cache_key);
  });
}

const identityHeaders = {
  "User-Agent": "mini-cache-fixture/1",
  "x-session-affinity": "mini-affinity",
  "X-Session-Id": "mini-session",
  "x-parent-session-id": "mini-parent",
  "x-ultra-thread-id": "private-thread",
  "x-codex-prompt-cache-key": "private-cache-context",
  Authorization: "Bearer inbound-secret",
  "X-Api-Key": "inbound-key",
  Cookie: "session=inbound-cookie",
  "X-Untrusted-Header": "do-not-forward"
};

function expectFilteredIdentity(headers: Headers): void {
  expect(headers.get("x-session-affinity")).toBe("mini-affinity");
  expect(headers.get("X-Session-Id")).toBe("mini-session");
  expect(headers.get("x-parent-session-id")).toBe("mini-parent");
  expect(headers.get("Authorization")).toBe("Bearer upstream-key");
  for (const name of ["X-Api-Key", "Cookie", "X-Untrusted-Header", "x-ultra-thread-id", "x-codex-prompt-cache-key"]) {
    expect(headers.has(name)).toBe(false);
  }
}

for (const inbound of ["chat", "responses"] as const) {
  for (const stream of [false, true]) {
    for (const openCode of [false, true]) {
      test(`${inbound} conversion preserves filtered identity (stream=${stream}, OpenCode=${openCode})`, async () => {
        const calls = mockFetch();
        const response = await (inbound === "chat" ? runRelayChatRequest : runRelayProtocolRequest)({
          request: request(inbound, { stream, prompt_cache_key: "mini-stable-hash" }, identityHeaders),
          provider: provider(),
          group: { ...group("openai"), ...(openCode ? { id: "opencode" } : {}) },
          apiKey: "upstream-key"
        });
        expect(response.status).toBe(200);
        await response.text();
        expect(calls).toHaveLength(1);
        expectFilteredIdentity(calls[0]!.headers);
        expect(calls[0]!.body.prompt_cache_key).toBe("mini-stable-hash");
        // Mini thread identity wins the opencode session, canonicalized to the
        // upstream `ses_` shape (verbatim ids fail the upstream shape gate).
        if (openCode) expect(calls[0]!.headers.get("x-opencode-session")).toBe(canonicalOpencodeId("ses_", "private-thread"));
        else expect(calls[0]!.headers.get("User-Agent")).toBe("mini-cache-fixture/1");
      });
    }
  }

  test(`${inbound} conversion keeps explicit Mini cache identity across changed recap`, async () => {
    const calls = mockFetch();
    for (const recap of ["first recap", "updated recap"]) {
      const response = await (inbound === "chat" ? runRelayChatRequest : runRelayProtocolRequest)({
        request: request(inbound, {
          prompt_cache_key: "mini-stable-hash",
          ...(inbound === "chat" ? { messages: [{ role: "user", content: recap }] } : { input: recap })
        }, identityHeaders),
        provider: provider(), group: group("openai"), apiKey: "upstream-key"
      });
      expect(response.status).toBe(200);
      await response.text();
    }
    expect(calls.map((call) => call.body.prompt_cache_key)).toEqual(["mini-stable-hash", "mini-stable-hash"]);
  });
}

for (const stream of [false, true]) {
  test(`Responses conversion retry retains filtered identity (stream=${stream})`, async () => {
    const calls = mockFetch(true);
    const response = await runRelayProtocolRequest({
      request: request("responses", { model: "qwen3:8b", stream, reasoning: { effort: "high" } }, identityHeaders),
      provider: { ...provider(), id: "free-ollama", kind: "ollama" }, group: group("openai"), apiKey: "upstream-key"
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(calls).toHaveLength(2);
    for (const call of calls) expectFilteredIdentity(call.headers);
  });
}
