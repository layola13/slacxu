import { expect, test } from "bun:test";
import type { ProviderConfig } from "@codex-ui/shared";
import {
  createRelayDirectory,
  findRelayDirectoryProvider
} from "../../apps/server/src/relayDirectory.ts";

const providers: ProviderConfig[] = [
  {
    id: "deepkey",
    kind: "responsesRelay",
    name: "DeepKey 中转",
    baseUrl: "https://secret-relay.example/v1",
    apiKeyRef: "env:SECRET_DEEPKEY_API_KEY",
    apiKeyPreview: "sk-secret...key",
    defaultModel: "gpt-5.6-terra",
    nativeModels: ["gpt-5.6-terra", " gpt-5.6-terra "],
    modelAliases: [],
    groups: [
      {
        id: "catalog:codex-team",
        name: "codex-team",
        kind: "text",
        status: "enabled",
        groupRatio: 0.08,
        models: ["gpt-5.6-terra"],
        supportedEndpointTypes: ["openai-response"],
        responseProtocol: "openai-response",
        responseProtocolMode: "fixed",
        keys: ["sk-group-secret"]
      }
    ],
    createdAt: 1,
    updatedAt: 1
  },
  {
    id: "other",
    kind: "openai",
    name: "Other Relay",
    nativeModels: ["gpt-other"],
    modelAliases: [],
    groups: [{
      id: "disabled",
      name: "disabled",
      status: "disabled",
      groupRatio: 2,
      models: ["gpt-other"],
      keys: ["sk-other-secret"]
    }],
    createdAt: 1,
    updatedAt: 1
  }
];

test("relay directory filters member channels and maps activation ids, group ratio, and models", () => {
  const directory = createRelayDirectory(providers, new Set(["deepkey"]));

  expect(directory).toEqual([{
    providerId: "deepkey",
    providerName: "DeepKey 中转",
    providerKind: "responsesRelay",
    defaultModel: "gpt-5.6-terra",
    models: ["gpt-5.6-terra"],
    groups: [{
      groupId: "catalog:codex-team",
      groupName: "codex-team",
      kind: "text",
      enabled: true,
      groupRatio: 0.08,
      models: ["gpt-5.6-terra"],
      supportedEndpointTypes: ["openai-response"],
      responseProtocol: "openai-response",
      responseProtocolMode: "fixed"
    }]
  }]);
});

test("relay directory exposes disabled state without leaking provider or group secrets", () => {
  const directory = createRelayDirectory(providers);
  const serialized = JSON.stringify(directory);

  expect(directory[1]?.groups[0]?.enabled).toBe(false);
  expect(serialized).not.toContain("sk-group-secret");
  expect(serialized).not.toContain("sk-other-secret");
  expect(serialized).not.toContain("SECRET_DEEPKEY_API_KEY");
  expect(serialized).not.toContain("secret-relay.example");
  expect(serialized).not.toContain("apiKey");
  expect(serialized).not.toContain("keys");
});

test("relay group lookup hides missing and unassigned providers with the same null result", () => {
  expect(findRelayDirectoryProvider(providers, "missing")).toBeNull();
  expect(findRelayDirectoryProvider(providers, "other", new Set(["deepkey"]))).toBeNull();
  expect(findRelayDirectoryProvider(providers, "deepkey", new Set(["deepkey"]))?.groups[0]?.groupRatio).toBe(0.08);
});
