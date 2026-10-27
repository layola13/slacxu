import { expect, test } from "bun:test";
import type { ProviderConfig } from "@codex-ui/shared";
import { buildAdvancedRelayDirectory, defaultAdvancedRelayVendor } from "../../apps/web/src/advancedRelayDirectory.ts";

const templates = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", protocol: "openai-response" as const },
  { id: "deepkey", name: "DeepKey", baseUrl: "https://deepkey.top/v1", protocol: "openai-response" as const },
  { id: "custom", name: "Custom", baseUrl: "", protocol: "openai-response" as const }
];

function provider(id: string, name: string, serviceProviderId: string): ProviderConfig {
  return {
    id,
    name,
    kind: "responsesRelay",
    serviceProvider: { id: serviceProviderId, name: serviceProviderId },
    nativeModels: [],
    modelAliases: [],
    createdAt: 1,
    updatedAt: 1
  };
}

test("shows provider names only while reusing existing instances internally", () => {
  const directory = buildAdvancedRelayDirectory([
    provider("deepseek-main", "DeepSeek Sponsor", "deepseek"),
    provider("deepkey-main", "DeepKey 1", "deepkey")
  ], templates, (entry) => entry.serviceProvider?.id);

  expect(directory).toContainEqual(expect.objectContaining({
    id: "template:deepseek",
    targetProviderId: "deepseek-main",
    targetProviderName: "DeepSeek Sponsor",
    serviceProviderId: "deepseek",
    name: "DeepSeek"
  }));
  expect(directory).toContainEqual(expect.objectContaining({
    id: "template:deepkey",
    targetProviderId: "deepkey-main",
    targetProviderName: "DeepKey 1",
    serviceProviderId: "deepkey",
    name: "DeepKey"
  }));
  expect(directory.some((entry) => entry.id === "template:custom")).toBe(true);
  expect(directory.some((entry) => entry.name === "DeepSeek Sponsor" || entry.name === "DeepKey 1")).toBe(false);
});

test("shows one provider entry even when legacy data has multiple instances", () => {
  const directory = buildAdvancedRelayDirectory([
    provider("deepseek-a", "DeepSeek A", "deepseek"),
    provider("deepseek-b", "DeepSeek B", "deepseek")
  ], templates, (entry) => entry.serviceProvider?.id);

  expect(directory.filter((entry) => entry.serviceProviderId === "deepseek")).toEqual([
    expect.objectContaining({ targetProviderId: "deepseek-a", targetProviderName: "DeepSeek A", name: "DeepSeek" })
  ]);
});

test("keeps unconfigured templates available for creating the first instance", () => {
  const directory = buildAdvancedRelayDirectory([], templates, () => undefined);
  expect(directory.map((entry) => entry.id)).toEqual([
    "template:deepseek",
    "template:deepkey",
    "template:custom"
  ]);
  expect(directory.every((entry) => entry.targetProviderId === null)).toBe(true);
});

test("does not add unknown or custom instances to the provider directory", () => {
  const directory = buildAdvancedRelayDirectory([
    provider("local-anyrouter", "local_anyrouter", "custom"),
    provider("private-vendor", "Private Vendor 1", "private-vendor")
  ], templates, (entry) => entry.serviceProvider?.id);

  expect(directory.map((entry) => entry.name)).toEqual(["DeepSeek", "DeepKey", "Custom"]);
  expect(directory.find((entry) => entry.serviceProviderId === "custom")?.targetProviderId).toBeNull();
});

test("quick create defaults to the provider template and keeps its instance as a merge target", () => {
  const directory = buildAdvancedRelayDirectory([
    provider("openai-sponsor", "OpenAI Sponsor 1", "openai"),
    provider("deepseek-main", "DeepSeek Instance", "deepseek")
  ], [
    { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", protocol: "openai-response" },
    { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", protocol: "openai" }
  ], (entry) => entry.serviceProvider?.id);

  expect(defaultAdvancedRelayVendor(directory)).toEqual(expect.objectContaining({
    name: "OpenAI",
    serviceProviderId: "openai",
    targetProviderId: "openai-sponsor",
    targetProviderName: "OpenAI Sponsor 1"
  }));
  expect(defaultAdvancedRelayVendor(directory, "missing")?.name).toBe("DeepSeek");
});
