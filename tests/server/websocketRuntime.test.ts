import { expect, test } from "bun:test";
import {
  isWebSocketOriginAllowed,
  publicWebSocketRuntimeConfig,
  resolveWebSocketRuntimeConfig,
  trustedLocalDesktopAuthEnabled,
} from "../../apps/server/src/websocketRuntime.ts";

test("trusted local authentication is limited to Windows desktop on loopback", () => {
  expect(trustedLocalDesktopAuthEnabled({
    env: { CODEX_UI_DESKTOP: "1", CODEX_UI_TRUSTED_LOCAL_AUTH: "1" },
    platform: "win32",
    host: "127.0.0.1",
  })).toBe(true);

  expect(trustedLocalDesktopAuthEnabled({
    env: { CODEX_UI_DESKTOP: "1", CODEX_UI_TRUSTED_LOCAL_AUTH: "1" },
    platform: "linux",
    host: "127.0.0.1",
  })).toBe(false);
  expect(trustedLocalDesktopAuthEnabled({
    env: { CODEX_UI_TRUSTED_LOCAL_AUTH: "1" },
    platform: "win32",
    host: "127.0.0.1",
  })).toBe(false);
  expect(trustedLocalDesktopAuthEnabled({
    env: { CODEX_UI_DESKTOP: "1", CODEX_UI_TRUSTED_LOCAL_AUTH: "1" },
    platform: "win32",
    host: "0.0.0.0",
  })).toBe(false);
});

test("desktop profile uses loopback and fast local recovery defaults", () => {
  const config = resolveWebSocketRuntimeConfig({
    env: { CODEX_UI_DESKTOP: "1" },
    platform: "win32",
  });

  expect(config.deployment).toBe("desktop");
  expect(config.profile).toBe("desktop");
  expect(config.platform).toBe("win32");
  expect(config.host).toBe("127.0.0.1");
  expect(config.heartbeatIntervalMs).toBe(2_000);
  expect(config.heartbeatTimeoutMs).toBe(90_000);
  expect(config.reconnectMaxDelayMs).toBe(5_000);
});

test("server and public profiles use deployment-safe heartbeat defaults", () => {
  const server = resolveWebSocketRuntimeConfig({ env: {}, platform: "linux" });
  const publicServer = resolveWebSocketRuntimeConfig({
    env: { CODEX_UI_WS_PROFILE: "public" },
    platform: "linux",
  });

  expect(server.profile).toBe("server");
  expect(server.host).toBe("0.0.0.0");
  expect(server.heartbeatIntervalMs).toBe(5_000);
  expect(server.heartbeatTimeoutMs).toBe(90_000);
  expect(publicServer.heartbeatIntervalMs).toBe(15_000);
  expect(publicServer.heartbeatTimeoutMs).toBe(60_000);
  expect(publicServer.allowMissingOrigin).toBe(false);
});

test("custom timing remains internally consistent and public config omits server policy", () => {
  const config = resolveWebSocketRuntimeConfig({
    env: {
      CODEX_UI_WS_HEARTBEAT_INTERVAL_MS: "9000",
      CODEX_UI_WS_HEARTBEAT_TIMEOUT_MS: "1000",
      CODEX_UI_WS_RECONNECT_BASE_DELAY_MS: "4000",
      CODEX_UI_WS_RECONNECT_MAX_DELAY_MS: "1000",
      CODEX_UI_WS_PATH: "socket",
    },
  });
  const publicConfig = publicWebSocketRuntimeConfig(config);

  expect(config.heartbeatTimeoutMs).toBe(18_000);
  expect(config.reconnectMaxDelayMs).toBe(4_000);
  expect(config.path).toBe("/socket");
  expect(publicConfig).not.toHaveProperty("allowedOrigins");
  expect(publicConfig).not.toHaveProperty("trustProxy");
});

test("custom websocket paths are normalized and reject ambiguous URL components", () => {
  expect(
    resolveWebSocketRuntimeConfig({
      env: { CODEX_UI_WS_PATH: "bridge//socket" },
    }).path,
  ).toBe("/bridge/socket");
  expect(() =>
    resolveWebSocketRuntimeConfig({
      env: { CODEX_UI_WS_PATH: "/" },
    }),
  ).toThrow("Invalid CODEX_UI_WS_PATH");
  expect(() =>
    resolveWebSocketRuntimeConfig({
      env: { CODEX_UI_WS_PATH: "/ws?channel=desktop" },
    }),
  ).toThrow("Invalid CODEX_UI_WS_PATH");
});

test("origin validation accepts same-origin and desktop loopback but rejects public cross-origin", () => {
  const server = resolveWebSocketRuntimeConfig({ env: {} });
  const desktop = resolveWebSocketRuntimeConfig({ env: { CODEX_UI_DESKTOP: "1" } });
  const publicServer = resolveWebSocketRuntimeConfig({
    env: { CODEX_UI_WS_PROFILE: "public" },
  });

  expect(
    isWebSocketOriginAllowed(
      new Request("http://10.0.0.2:43110/ws", {
        headers: { origin: "http://10.0.0.2:43110" },
      }),
      server,
    ),
  ).toBe(true);
  expect(
    isWebSocketOriginAllowed(
      new Request("http://127.0.0.1:43110/ws", {
        headers: { origin: "http://localhost:43110" },
      }),
      desktop,
    ),
  ).toBe(true);
  expect(
    isWebSocketOriginAllowed(
      new Request("https://ui.example.com/ws", {
        headers: { origin: "https://attacker.example" },
      }),
      publicServer,
    ),
  ).toBe(false);
  expect(
    isWebSocketOriginAllowed(
      new Request("https://ui.example.com/ws"),
      publicServer,
    ),
  ).toBe(false);
});

test("trusted proxy origin validation honors forwarded protocol and host", () => {
  const config = resolveWebSocketRuntimeConfig({
    env: {
      CODEX_UI_WS_PROFILE: "public",
      CODEX_UI_TRUST_PROXY: "1",
    },
  });
  const request = new Request("http://127.0.0.1:43110/ws", {
    headers: {
      origin: "https://codex.example.com",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "codex.example.com",
    },
  });

  expect(isWebSocketOriginAllowed(request, config)).toBe(true);
});

test("explicit allowed origins permit a configured cross-origin desktop shell", () => {
  const config = resolveWebSocketRuntimeConfig({
    env: {
      CODEX_UI_WS_PROFILE: "public",
      CODEX_UI_ALLOWED_ORIGINS: "https://desktop.example",
    },
  });
  const request = new Request("https://server.example/ws", {
    headers: { origin: "https://desktop.example" },
  });

  expect(isWebSocketOriginAllowed(request, config)).toBe(true);
});
