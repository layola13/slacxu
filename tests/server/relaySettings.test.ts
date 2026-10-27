import { expect, test } from "bun:test";
import type { ProviderConfig } from "@codex-ui/shared";
import {
  buildRelaySettingsProvider,
  relaySettingsListItem,
  relaySettingsView,
  selectFetchedRelayModels,
  setRelayGroupModels
} from "../../apps/server/src/relaySettings.ts";

test("relay settings creates a named channel and group with a write-only key", () => {
  const provider = buildRelaySettingsProvider({
    providerId: "deepkey",
    providerName: "DeepKey 中转",
    baseUrl: "https://relay.example/v1",
    defaultModel: "gpt-5.6-terra",
    groupId: "catalog:codex-team",
    groupName: "codex-team",
    apiKey: "sk-settings-secret",
    groupRatio: 0.08,
    models: ["gpt-5.6-terra"]
  }, null);

  expect(provider.groups?.[0]).toMatchObject({
    id: "catalog:codex-team",
    name: "codex-team",
    groupRatio: 0.08,
    models: ["gpt-5.6-terra"],
    keys: ["sk-settings-secret"]
  });
  const view = relaySettingsView(provider);
  expect(view.groups[0]?.apiKeyConfigured).toBe(true);
  expect(JSON.stringify(view)).not.toContain("sk-settings-secret");
  expect(JSON.stringify(view)).not.toContain("keys");
});

test("relay settings list item omits heavyweight group and model data", () => {
  const provider = providerFixture();
  provider.capabilityCatalog = {
    schema_version: 1,
    data: [{ model_name: "gpt-old", supported_endpoint_types: ["openai-response"] }]
  };
  provider.groups![0] = {
    ...provider.groups![0]!,
    keys: ["sk-list-secret"],
    models: ["gpt-old", "gpt-extra"],
    modelCapabilities: { "gpt-old": { contextWindow: 128_000, source: "upstream" } },
    modelMapping: [{ from: "gpt-old", to: "upstream-model" }]
  };

  const item = relaySettingsListItem(provider);

  expect(item.defaultModel).toBe("gpt-old");
  expect(item.groupCount).toBe(2);
  expect(item.firstGroupId).toBe("default");
  expect(item.firstGroupName).toBe("default");
  expect(item.apiKeyConfigured).toBe(true);
  expect("capabilityCatalog" in item).toBe(false);
  expect(JSON.stringify(item)).not.toContain("sk-list-secret");
});

test("relay settings list item exposes quota usage rate for warnings", () => {
  const limited = { ...providerFixture(), quotaUsd: 100, usedQuotaUsd: 85 };
  const item = relaySettingsListItem(limited);
  expect(item.usedQuotaUsd).toBe(85);
  expect(item.quotaUsageRate).toBeCloseTo(0.85, 5);
  expect(JSON.stringify(item)).not.toContain("sk-original");

  const unlimited = providerFixture();
  const free = relaySettingsListItem(unlimited);
  expect(free.usedQuotaUsd).toBeNull();
  expect(free.quotaUsageRate).toBeNull();
});

test("relay settings patches one group and preserves omitted keys and unmentioned groups", () => {
  const existing = providerFixture();
  const updated = buildRelaySettingsProvider({
    providerName: "Renamed Relay",
    groups: [{ groupId: "default", groupName: "primary", groupRatio: 0.5 }]
  }, existing);

  expect(updated.name).toBe("Renamed Relay");
  expect(updated.groups).toHaveLength(2);
  expect(updated.groups?.[0]).toMatchObject({ name: "primary", groupRatio: 0.5, keys: ["sk-original"] });
  expect(updated.groups?.[1]?.id).toBe("backup");
});

test("relay settings is the explicit path for a group context window", () => {
  const existing = providerFixture();
  const updated = buildRelaySettingsProvider({
    providerName: existing.name,
    groups: [{ groupId: "default", groupName: "default", contextWindow: 257_000 }]
  }, existing);

  expect(updated.groups?.find((group) => group.id === "default")?.contextWindow).toBe(257_000);
  expect(relaySettingsView(updated).groups.find((group) => group.groupId === "default")?.contextWindow).toBe(257_000);

  const cleared = buildRelaySettingsProvider({
    providerName: existing.name,
    groups: [{ groupId: "default", groupName: "default", contextWindow: 0 }]
  }, updated);
  expect(cleared.groups?.find((group) => group.id === "default")?.contextWindow).toBeUndefined();
});

test("relay settings accepts an explicit no-auth group without a key", () => {
  const provider = buildRelaySettingsProvider({
    providerId: "omniroute-free",
    providerName: "OmniRoute Free",
    baseUrl: "https://opencode.ai/zen/v1",
    groupId: "opencode-free",
    groupName: "OpenCode Free",
    responseProtocol: "openai",
    authType: "none",
    models: ["big-pickle"]
  }, null);

  expect(provider.groups?.[0]).toMatchObject({ authType: "none", keys: [] });
  expect(relaySettingsView(provider).groups[0]?.apiKeyConfigured).toBe(true);
});

test("relay settings exposes editable Claude Code headers and defaults them off", () => {
  const existing = providerFixture();
  expect(relaySettingsView(existing).groups[0]).toMatchObject({
    claudeCodeHeadersEnabled: false,
    claudeCodeVersion: null
  });
  const updated = buildRelaySettingsProvider({
    providerName: existing.name,
    groups: [{
      groupId: "default",
      groupName: "default",
      responseProtocol: "anthropic",
      claudeCodeHeadersEnabled: true,
      claudeCodeVersion: "2.1.222"
    }]
  }, existing);
  expect(relaySettingsView(updated).groups[0]).toMatchObject({
    responseProtocol: "anthropic",
    claudeCodeHeadersEnabled: true,
    claudeCodeVersion: "2.1.222"
  });
});

test("fetched relay models default to all and support an explicit subset", () => {
  expect(selectFetchedRelayModels(["gpt-a", "gpt-b", "gpt-a"])).toEqual(["gpt-a", "gpt-b"]);
  expect(selectFetchedRelayModels(["gpt-a", "gpt-b"], ["gpt-b"])).toEqual(["gpt-b"]);
  expect(() => selectFetchedRelayModels(["gpt-a"], ["missing"])).toThrow("not returned");
});

test("setting a group model list updates provider availability and default model", () => {
  const updated = setRelayGroupModels(providerFixture(), "default", ["gpt-new", "gpt-new"]);

  expect(updated.groups?.find((group) => group.id === "default")?.models).toEqual(["gpt-new"]);
  expect(updated.nativeModels).toEqual(["gpt-new", "gpt-backup"]);
  expect(updated.defaultModel).toBe("gpt-new");
});

function providerFixture(): ProviderConfig {
  return {
    id: "relay",
    kind: "responsesRelay",
    name: "Relay",
    baseUrl: "https://relay.example/v1",
    defaultModel: "gpt-old",
    nativeModels: ["gpt-old", "gpt-backup"],
    modelAliases: [],
    groups: [
      {
        id: "default",
        name: "default",
        kind: "text",
        status: "enabled",
        groupRatio: 1,
        models: ["gpt-old"],
        keys: ["sk-original"]
      },
      {
        id: "backup",
        name: "backup",
        kind: "text",
        status: "enabled",
        groupRatio: 2,
        models: ["gpt-backup"],
        keys: ["sk-backup"]
      }
    ],
    createdAt: 1,
    updatedAt: 1
  };
}
