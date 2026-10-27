import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderConfig } from "@codex-ui/shared";
import { decryptRelayShare, encryptRelayShare, isRelayShareText, RELAY_SHARE_PREFIX, validateRelaySharePasswords } from "../../apps/web/src/app/relayShare.ts";

const provider: ProviderConfig = {
  id: "shared-relay",
  kind: "responsesRelay",
  name: "Shared Relay",
  baseUrl: "https://relay.example/v1",
  nativeModels: ["gpt-test"],
  modelAliases: [],
  groups: [{
    id: "default",
    name: "default",
    groupRatio: 1,
    responseProtocol: "openai-response",
    keys: ["sk-secret"],
    models: ["gpt-test"]
  }],
  createdAt: 1,
  updatedAt: 1
};

test("relay shares use the Codex Ultra fingerprint and round trip encrypted provider secrets", async () => {
  const value = await encryptRelayShare(provider, "share-password");

  expect(value.startsWith(RELAY_SHARE_PREFIX)).toBe(true);
  expect(isRelayShareText(`  ${value}`)).toBe(true);
  expect(value).not.toContain("sk-secret");
  expect(value).not.toContain("relay.example");
  expect(await decryptRelayShare(value, "share-password")).toEqual(provider);
});

test("relay shares reject incorrect passwords and tampered text", async () => {
  const value = await encryptRelayShare(provider, "share-password");
  const tail = value.at(-1) === "0" ? "1" : "0";

  await expect(decryptRelayShare(value, "wrong-password")).rejects.toThrow("分享内容或密码无效");
  await expect(decryptRelayShare(`${value.slice(0, -1)}${tail}`, "share-password")).rejects.toThrow("分享内容或密码无效");
});

test("relay share detection does not accept the obsolete fingerprint", () => {
  expect(RELAY_SHARE_PREFIX).toBe("cxu-niumao-");
  expect(isRelayShareText("cxu-nimao-obsolete")).toBe(false);
});

test("relay share password validation always returns an actionable message", () => {
  expect(validateRelaySharePasswords("", "")).toBe("分享密码不能为空");
  expect(validateRelaySharePasswords("secret", "different")).toBe("两次输入的分享密码不一致");
  expect(validateRelaySharePasswords(" secret ", "secret")).toBeNull();
});

test("relay share compression starts consuming output before writing input", () => {
  const source = readFileSync(join(import.meta.dir, "../../apps/web/src/app/relayShare.ts"), "utf8");
  const compressStart = source.indexOf("async function compress");
  const decompressStart = source.indexOf("async function decompress");
  const compressSource = source.slice(compressStart, decompressStart);
  const decompressSource = source.slice(decompressStart);

  expect(compressSource.indexOf("new Response(stream.readable).arrayBuffer()")).toBeLessThan(compressSource.indexOf("writer.write"));
  expect(decompressSource.indexOf("new Response(stream.readable).arrayBuffer()")).toBeLessThan(decompressSource.indexOf("writer.write"));
});
