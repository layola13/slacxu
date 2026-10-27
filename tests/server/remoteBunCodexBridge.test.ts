import { describe, expect, test } from "bun:test";

// Keep the retry policy executable without opening SSH. This protects the
// invariant that write RPCs are never replayed after an ambiguous network cut.
import {
  isRemoteRpcRetrySafe,
  isRemoteTransportFailure,
  REMOTE_RECONNECT_MAX_ATTEMPTS,
  remoteReconnectDelayMs
} from "../../backends/codex/src/runtime/remoteBunCodexBridge";

describe("remote SSH reconnect policy", () => {
  test("retries only read RPCs", () => {
    expect(isRemoteRpcRetrySafe("thread/read")).toBe(true);
    expect(isRemoteRpcRetrySafe("thread/turns/list")).toBe(true);
    expect(isRemoteRpcRetrySafe("turn/start")).toBe(false);
    expect(isRemoteRpcRetrySafe("turn/interrupt")).toBe(false);
    expect(isRemoteRpcRetrySafe("thread/goal/set")).toBe(false);
  });
  test("distinguishes transport failures from remote RPC errors", () => {
    expect(isRemoteTransportFailure(new Error("fetch failed: ECONNRESET"))).toBe(true);
    expect(isRemoteTransportFailure(new Error("Relay group is disabled"))).toBe(false);
  });
  test("backs off to a stable low-frequency probe for long outages", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 100].map(remoteReconnectDelayMs)).toEqual([
      250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000
    ]);
  });
  test("bounds reconnect attempts during an outage", () => {
    expect(REMOTE_RECONNECT_MAX_ATTEMPTS).toBe(8);
  });
});
