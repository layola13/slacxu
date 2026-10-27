import { expect, test } from "bun:test";
import type { ProviderConfig } from "@codex-ui/shared";
import {
  checkFreeCompactionReadiness,
  findFreeCompactionGroup,
  hasFreeRelay,
  listCompactionChannelOptions
} from "../../frontends/free-mode/src/free/freeCompactionReadiness";

function freeProvider(models: string[]): ProviderConfig {
  return {
    id: "omniroute-free",
    kind: "openai",
    name: "CodexUltraFree",
    nativeModels: models,
    modelAliases: [],
    groups: [{
      id: "opencode-free",
      name: "CodexUltraFree",
      groupRatio: 0,
      keys: [],
      models
    }]
  } as ProviderConfig;
}

test("uses a manual free compaction model when automatic mapping is unavailable", () => {
  const readiness = checkFreeCompactionReadiness({
    currentModel: "gpt-5.6-sol",
    providers: [freeProvider(["mimo-v2.5-free"])],
    workspaceMode: "local",
    activeThreadId: "thread-a",
    manualProviderId: "omniroute-free",
    manualGroupId: "opencode-free",
    manualFreeModel: "mimo-v2.5-free"
  });

  expect(readiness).toEqual({
    ok: true,
    providerId: "omniroute-free",
    groupId: "opencode-free",
    model: "mimo-v2.5-free",
    mappedFrom: "gpt-5.6-sol",
    source: "manual"
  });
});

test("rejects a manual free compaction model that is no longer available", () => {
  const readiness = checkFreeCompactionReadiness({
    currentModel: "gpt-5.6-sol",
    providers: [freeProvider(["longcat-2.0-free"])],
    workspaceMode: "local",
    activeThreadId: "thread-a",
    manualProviderId: "omniroute-free",
    manualGroupId: "opencode-free",
    manualFreeModel: "mimo-v2.5-free"
  });

  expect(readiness).toMatchObject({ ok: false, reason: "manual-model-unavailable" });
});

test("requires an explicit free compaction model instead of automatic mapping", () => {
  expect(checkFreeCompactionReadiness({
    currentModel: "gpt-5.6-terra",
    providers: [freeProvider(["deepseek-v4-flash-free"])],
    workspaceMode: "local",
    activeThreadId: "thread-a"
  })).toMatchObject({ ok: false, reason: "manual-route-incomplete" });
});

test("allows a thread to choose a different configured channel and model", () => {
  const paidProvider = {
    id: "relay-a",
    kind: "responsesRelay",
    name: "Relay A",
    nativeModels: [],
    modelAliases: [],
    groups: [{
      id: "compact-group",
      name: "Compact Group",
      groupRatio: 1,
      models: ["compact-model-a", "compact-model-b"]
    }]
  } as ProviderConfig;

  expect(listCompactionChannelOptions([paidProvider])).toEqual([{
    providerId: "relay-a",
    providerName: "Relay A",
    groupId: "compact-group",
    groupName: "Compact Group",
    models: ["compact-model-a", "compact-model-b"]
  }]);
  expect(checkFreeCompactionReadiness({
    currentModel: "gpt-5.6-sol",
    providers: [paidProvider],
    workspaceMode: "local",
    activeThreadId: "thread-b",
    manualProviderId: "relay-a",
    manualGroupId: "compact-group",
    manualFreeModel: "compact-model-b"
  })).toMatchObject({
    ok: true,
    providerId: "relay-a",
    groupId: "compact-group",
    model: "compact-model-b",
    source: "manual"
  });
});

test("hides big-pickle from free compaction without removing normal relay availability", () => {
  const configuredProvider = freeProvider(["big-pickle", "mimo-v2.5-free"]);
  expect(listCompactionChannelOptions([configuredProvider])[0]?.models).toEqual(["mimo-v2.5-free"]);
  expect(configuredProvider.groups?.[0]?.models).toEqual(["big-pickle", "mimo-v2.5-free"]);
});

test("hasFreeRelay and findFreeCompactionGroup fall back to kilocode when opencode-free is empty", () => {
  const providerWithKilo: ProviderConfig = {
    id: "omniroute-free",
    kind: "openai",
    name: "CodexUltraFree",
    nativeModels: ["kilo-model-1"],
    modelAliases: [],
    groups: [
      { id: "opencode-free", name: "CodexUltraFree", groupRatio: 0, keys: [], models: [] },
      { id: "kilocode", name: "KiloCode", groupRatio: 0, keys: [], models: ["kilo-model-1"] }
    ]
  } as ProviderConfig;

  expect(hasFreeRelay([providerWithKilo])).toBe(true);
  const foundGroup = findFreeCompactionGroup([providerWithKilo]);
  expect(foundGroup?.id).toBe("kilocode");
  expect(foundGroup?.models).toEqual(["kilo-model-1"]);

  // Explicit groupId lookup
  expect(findFreeCompactionGroup([providerWithKilo], "kilocode")?.id).toBe("kilocode");
  expect(findFreeCompactionGroup([providerWithKilo], "opencode-free")?.id).toBe("opencode-free");
});
