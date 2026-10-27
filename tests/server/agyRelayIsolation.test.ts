import { describe, expect, it } from "bun:test";
import { AgyBridge } from "../../backends/agy/src/runtime/agyBridge.js";
import { buildSafeAgyEnv } from "../../backends/agy/src/runtime/agyCompatibleProbe.js";

describe("AGY official and relay isolation", () => {
  it("removes inherited relay routing in official mode without removing OAuth environment", () => {
    const inherited = {
      CLOUD_CODE_URL: "http://127.0.0.1:9999",
      GOOGLE_GEMINI_BASE_URL: "http://127.0.0.1:9999",
      GEMINI_API_KEY: "stale-relay-key",
      AGY_LLM_GATEWAY_URL: "http://127.0.0.1:9999/v1",
      AGY_LLM_GATEWAY_API_KEY: "stale-gateway-key",
      AGY_LLM_GATEWAY_WIRE_PROTOCOL: "openai",
      AGY_LLM_GATEWAY_MODELS: "stale-model",
      GEMINI_DIR: "isolated-google-home",
      GOOGLE_APPLICATION_CREDENTIALS: "oauth-credentials-path",
    };
    const env = buildSafeAgyEnv({}, inherited);
    expect(env.CLOUD_CODE_URL).toBeUndefined();
    expect(env.GOOGLE_GEMINI_BASE_URL).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.AGY_LLM_GATEWAY_URL).toBeUndefined();
    expect(env.AGY_LLM_GATEWAY_API_KEY).toBeUndefined();
    expect(env.AGY_LLM_GATEWAY_WIRE_PROTOCOL).toBeUndefined();
    expect(env.AGY_LLM_GATEWAY_MODELS).toBeUndefined();
    expect(env.GEMINI_DIR).toBe(inherited.GEMINI_DIR);
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe(inherited.GOOGLE_APPLICATION_CREDENTIALS);
    expect(inherited.GEMINI_API_KEY).toBe("stale-relay-key");
  });

  it("prefers LLM gateway env over the Code Assist proxy so agy needs no Google login", async () => {
    let proxyCalls = 0;
    const bridge = new AgyBridge({
      resolveRelayEnv: async (providerId) => {
        if (providerId !== "test-relay") return undefined;
        return {
          AGY_LLM_GATEWAY_URL: "http://127.0.0.1:43120/api/relay-gateway/test-relay/default/v1",
          AGY_LLM_GATEWAY_API_KEY: "gateway-key",
          AGY_LLM_GATEWAY_WIRE_PROTOCOL: "openai",
        };
      },
      resolveRelayProxyConfig: async () => {
        proxyCalls++;
        return { targetBaseUrl: "http://127.0.0.1:1", targetModel: "relay-model", protocol: "openai-response", apiKeys: ["mock-key"] };
      },
    });
    try {
      const relay = await bridge.request("thread/start", { cwd: process.cwd(), providerId: "test-relay", model: "relay-model" }) as any;
      const sessions = (bridge as any).sessions;
      const relaySession = sessions.get(relay.thread.id);
      const configure = (session: any, providerId: string) => (bridge as any).configureSessionProxy(session, providerId, undefined, session.model);

      const gatewayEnv = await configure(relaySession, "test-relay");
      expect(gatewayEnv.AGY_LLM_GATEWAY_URL).toBe("http://127.0.0.1:43120/api/relay-gateway/test-relay/default/v1");
      expect(gatewayEnv.AGY_LLM_GATEWAY_API_KEY).toBe("gateway-key");
      expect(gatewayEnv.AGY_LLM_GATEWAY_WIRE_PROTOCOL).toBe("openai");
      expect(gatewayEnv.CLOUD_CODE_URL).toBeUndefined();
      expect(relaySession.proxyServer).toBeUndefined();
      expect(proxyCalls).toBe(0);

      // The gateway env survives buildSafeAgyEnv only when explicitly provided.
      const spawned = buildSafeAgyEnv(gatewayEnv, {});
      expect(spawned.AGY_LLM_GATEWAY_URL).toBe(gatewayEnv.AGY_LLM_GATEWAY_URL);
      const officialEnv = buildSafeAgyEnv({}, gatewayEnv);
      expect(officialEnv.AGY_LLM_GATEWAY_URL).toBeUndefined();
    } finally {
      bridge.stop();
    }
  });

  it("keeps official routing independent while switching a relay session back to official", async () => {
    let relayCalls = 0;
    const bridge = new AgyBridge({
      resolveRelayProxyConfig: async (providerId) => {
        expect(providerId).toBe("test-relay");
        relayCalls++;
        return { targetBaseUrl: "http://127.0.0.1:1", targetModel: "relay-model", protocol: "openai-response", apiKeys: ["mock-key"] };
      },
    });
    try {
      const official = await bridge.request("thread/start", { cwd: process.cwd(), providerId: "agy-official", model: "gemini-3.8-flash-high" }) as any;
      const relay = await bridge.request("thread/start", { cwd: process.cwd(), providerId: "test-relay", model: "relay-model" }) as any;
      const sessions = (bridge as any).sessions;
      const officialSession = sessions.get(official.thread.id);
      const relaySession = sessions.get(relay.thread.id);
      const configure = (session: any, providerId: string) => (bridge as any).configureSessionProxy(session, providerId, undefined, session.model);

      expect(await configure(officialSession, "agy-official")).toBeUndefined();
      const relayEnv = await configure(relaySession, "test-relay");
      expect(relayEnv.CLOUD_CODE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(relayEnv.GOOGLE_GEMINI_BASE_URL).toBe(relayEnv.CLOUD_CODE_URL);
      expect(relayEnv.GEMINI_API_KEY).toBe("mock-key");
      expect(officialSession.proxyServer).toBeUndefined();
      expect(officialSession.model).toBe("gemini-3.8-flash-high");
      expect(await configure(officialSession, "agy-official")).toBeUndefined();
      const closedUrl = relaySession.proxyServer.url;
      expect(await configure(relaySession, "agy-official")).toBeUndefined();
      expect(relaySession.proxyServer).toBeUndefined();
      const officialEnv = buildSafeAgyEnv({}, relayEnv);
      expect(officialEnv.CLOUD_CODE_URL).toBeUndefined();
      expect(officialEnv.GEMINI_API_KEY).toBeUndefined();
      await expect(fetch(`${closedUrl}/healthz`)).rejects.toThrow();
      expect(relayCalls).toBe(1);
    } finally {
      bridge.stop();
    }
  });
});
