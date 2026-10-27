import { expect, test } from "bun:test";
import type { WebSocketRuntimeConfig } from "@codex-ui/shared";
import { evaluateHeartbeatState } from "../../apps/web/src/state/codexClient.ts";

const runtime: WebSocketRuntimeConfig = {
  profile: "server",
  path: "/ws",
  heartbeatIntervalMs: 5_000,
  heartbeatTimeoutMs: 90_000,
  handshakeTimeoutMs: 10_000,
  reconnectBaseDelayMs: 750,
  reconnectMaxDelayMs: 30_000,
};

test("recent server activity keeps the connection healthy", () => {
  expect(evaluateHeartbeatState(100_000, 10_000, null, runtime)).toBe("healthy");
});

test("an inactive connection is probed before it is closed", () => {
  expect(evaluateHeartbeatState(100_000, 9_000, null, runtime)).toBe("probe");
  expect(evaluateHeartbeatState(105_000, 9_000, 100_000, runtime)).toBe("probe");
  expect(evaluateHeartbeatState(110_000, 9_000, 100_000, runtime, { visible: false })).toBe("close");
});

test("a visible renderer gets extra probe grace before forced reconnect", () => {
  expect(evaluateHeartbeatState(110_000, 9_000, 100_000, runtime, { visible: true })).toBe("probe");
  expect(evaluateHeartbeatState(115_000, 9_000, 100_000, runtime, { visible: true })).toBe("close");
});

test("any server message after a delayed render clears the stale state", () => {
  expect(evaluateHeartbeatState(106_000, 105_500, null, runtime)).toBe("healthy");
});
