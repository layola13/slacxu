import { expect, test } from "bun:test";
import { normalizeRelayName, relayNameConflict } from "../../apps/web/src/relayNameValidation.ts";

const providers = [
  { id: "deepkey", name: "DeepKey 中转", serviceProvider: { id: "deepkey", name: "DeepKey" } },
  { id: "my-relay", name: "My Relay", serviceProvider: { id: "custom", name: "Custom" } }
] as any;

test("normalizes fixed relay aliases", () => {
  expect(normalizeRelayName("DeepKey 中转")).toBe("deepkey");
  expect(normalizeRelayName("my-relay")).toBe("my");
});

test("detects fixed and saved relay name conflicts", () => {
  expect(relayNameConflict("deepkey", providers, ["DeepKey", "Flux"])).toBe(true);
  expect(relayNameConflict("DeepKey 中转站", providers, ["DeepKey", "Flux"])).toBe(true);
  expect(relayNameConflict("my relay", providers, ["DeepKey", "Flux"])).toBe(true);
  expect(relayNameConflict("my-new-relay", providers, ["DeepKey", "Flux"])).toBe(false);
});
