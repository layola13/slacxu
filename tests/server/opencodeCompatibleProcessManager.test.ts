import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the code under test
import { describe, expect, test } from "bun:test";
import {
  isPortAvailable,
  findAvailableOpencodePort,
  OpencodeCompatibleProcessManager,
  buildOpencodeSharedRelayUrl,
  buildOpencodeSharedRelayProvider,
  isOpencodeSharedRelayBlocked,
} from "../../backends/opencode/src/runtime/opencodeCompatibleProcessManager.js";

describe("opencodeCompatibleProcessManager", () => {
  test("isPortAvailable rejects reserved ports 43120 and 43121", async () => {
    expect(await isPortAvailable(43120)).toBe(false);
    expect(await isPortAvailable(43121)).toBe(false);
  });

  test("findAvailableOpencodePort finds an available port starting >= 4096", async () => {
    const port = await findAvailableOpencodePort(4096);
    expect(port).toBeGreaterThanOrEqual(4096);
    expect(port).not.toBe(43120);
    expect(port).not.toBe(43121);
  });

  test("process manager exposes stopped initial status and config", () => {
    const mgr = new OpencodeCompatibleProcessManager({
      port: 4100,
      dangerous: true,
    });
    expect(mgr.isRunning).toBe(false);
    expect(mgr.url).toBeUndefined();
    expect(mgr.password).toBeUndefined();
    expect(mgr.config.dangerous).toBe(true);
  });

  test("shared relay url follows the cli/v1 contract (opencode/v1)", () => {
    expect(buildOpencodeSharedRelayUrl("deepkey-1", "codex-team", 43121)).toBe(
      "http://127.0.0.1:43121/api/relay-gateway/deepkey-1/codex-team/v1",
    );
    expect(buildOpencodeSharedRelayUrl("吉吉 中转", "default", 43121)).toBe(
      `http://127.0.0.1:43121/api/relay-gateway/${encodeURIComponent("吉吉 中转")}/default/v1`,
    );
  });

  test("shared relay refuses Zen free targets (must use opencode-local)", () => {
    expect(isOpencodeSharedRelayBlocked("x", "opencode-free")).toBe(true);
    expect(isOpencodeSharedRelayBlocked("x", "opencode")).toBe(true);
    expect(isOpencodeSharedRelayBlocked(undefined, undefined, "https://opencode.ai/zen/v1")).toBe(true);
    expect(isOpencodeSharedRelayBlocked("deepkey-1", "codex-team")).toBe(false);
    expect(() => buildOpencodeSharedRelayUrl("any", "opencode-free", 43121)).toThrow();
    expect(() => buildOpencodeSharedRelayProvider("https://opencode.ai/zen/v1", ["a-free"])).toThrow();
  });

  test("shared relay provider uses codex-relay loopback shape", () => {
    const url = buildOpencodeSharedRelayUrl("deepkey-1", "codex-team", 43121);
    const provider = buildOpencodeSharedRelayProvider(url, ["gpt-5.6-terra", " gpt-5.6-terra "]);
    expect(provider.providerId).toBe("codex-relay");
    expect(provider.baseURL).toBe(url);
    expect(provider.apiKey).toBe("loopback");
    expect(provider.models).toEqual(["gpt-5.6-terra"]);
    expect(() => buildOpencodeSharedRelayProvider(url, [])).toThrow();
  });
});
