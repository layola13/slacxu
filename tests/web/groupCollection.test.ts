import { expect, test } from "bun:test";
import type { ChannelGroupConfig } from "@codex-ui/shared";
import {
  activeRelayGroupModels,
  catalogGroupTemplates,
  createInitialRelayGroupUiState,
  filterAndSortRelayGroups,
  filterCatalogGroupsByTree,
  hasConfiguredProviderCredential,
  hasConfiguredRelayGroupKey,
  incompatibleRelayGroupModels,
  isAvailableRelayGroup,
  materializeFetchedModelsForSave,
  mergeCatalogGroupDrafts,
  parseRelayGroupKeys,
  relayGroupModelsForEditing,
  relayGroupSelectableModels,
  resolveRelayTextRuntimeSelection,
  relayGroupsMissingKeys,
  relayGroupSupportsCatalogModel,
  relayGroupUsageRate
} from "../../apps/web/src/groupCollection.ts";

test("switching relay groups never carries an unavailable model", () => {
  const provider = {
    id: "relay-b",
    kind: "responsesRelay" as const,
    name: "Relay B",
    nativeModels: ["b-model"],
    modelAliases: [],
    groups: [
      { id: "b-default", name: "B default", kind: "text" as const, groupRatio: 1, models: ["b-model"], keys: [] }
    ],
    createdAt: 1,
    updatedAt: 1
  };

  expect(resolveRelayTextRuntimeSelection(provider, "b-default", "a-model")).toEqual({
    groupId: "b-default",
    model: "b-model"
  });
});

test("relay model context variants remain valid while switching channels", () => {
  const provider = {
    id: "relay-b",
    kind: "responsesRelay" as const,
    name: "Relay B",
    nativeModels: [],
    modelAliases: [],
    groups: [
      { id: "b-default", name: "B default", kind: "text" as const, groupRatio: 1, models: ["claude-sonnet-5"], keys: [] }
    ],
    createdAt: 1,
    updatedAt: 1
  };

  expect(resolveRelayTextRuntimeSelection(provider, "b-default", "claude-sonnet-5[1m]")).toEqual({
    groupId: "b-default",
    model: "claude-sonnet-5[1m]"
  });
});

test("returns image models for the explicitly selected image relay group", () => {
  const provider = {
    id: "deepkey",
    name: "DeepKey",
    nativeModels: ["gpt-5.5"],
    groups: [
      { id: "codex", name: "Codex", kind: "text" as const, models: ["gpt-5.5"] },
      { id: "gpt-image", name: "GPT Image", kind: "image" as const, models: ["gpt-image-1", "gpt-image-2"] }
    ]
  };

  expect(activeRelayGroupModels(provider, "gpt-image", "gpt-5.5")).toEqual({
    group: provider.groups[1],
    models: ["gpt-image-1", "gpt-image-2"]
  });
});

test("falls back to the group containing the selected model when the group id is stale", () => {
  const provider = {
    id: "deepkey",
    name: "DeepKey",
    nativeModels: [],
    groups: [
      { id: "codex", name: "Codex", kind: "text" as const, models: ["gpt-5.5"] },
      { id: "gpt-image", name: "GPT Image", kind: "image" as const, models: ["gpt-image-2"] }
    ]
  };

  expect(activeRelayGroupModels(provider, "removed-group", "gpt-image-2").models).toEqual(["gpt-image-2"]);
});

test("parses multiple relay keys entered one per line", () => {
  expect(parseRelayGroupKeys("sk-one\n\nsk-two\r\n sk-three "))
    .toEqual(["sk-one", "sk-two", "sk-three"]);
});

const groups: ChannelGroupConfig[] = [
  { id: "alpha", name: "Alpha", status: "enabled", groupRatio: 2, quotaUsd: 100, usedQuotaUsd: 25, priority: 2, models: ["gpt-a"], responseProtocol: "openai", keys: ["sk-alpha"] },
  { id: "beta", name: "Beta", status: "disabled", groupRatio: 0.5, quotaUsd: 10, usedQuotaUsd: 8, priority: 1, models: ["claude-a", "claude-b"], responseProtocol: "anthropic", keys: ["sk-beta"] },
  { id: "gamma", name: "Gamma", groupRatio: 1, usedQuotaUsd: 20, priority: 5, models: ["gemini-a"], responseProtocol: "gemini" }
];

test("materializes fetched models when an empty relay group is saved directly", () => {
  const emptyGroups: ChannelGroupConfig[] = [
    { id: "text", name: "Text", kind: "text", models: [] },
    { id: "image", name: "Image", kind: "image", models: ["gpt-image-2"] }
  ];

  const result = materializeFetchedModelsForSave(
    emptyGroups,
    "text",
    ["gpt-5.6-sol", "gpt-5.5", "gpt-5.6-sol"]
  );

  expect(result[0]?.models).toEqual(["gpt-5.6-sol", "gpt-5.5"]);
  expect(result[1]).toBe(emptyGroups[1]);
});

test("does not overwrite an existing relay model list with fetched candidates", () => {
  const configuredGroups: ChannelGroupConfig[] = [
    { id: "text", name: "Text", kind: "text", models: ["gpt-5.5"] }
  ];
  const result = materializeFetchedModelsForSave(configuredGroups, "text", ["gpt-5.6-sol"]);

  expect(result).toEqual(configuredGroups);
  expect(result[0]).toBe(configuredGroups[0]);
});

test("filters relay groups across metadata, model, status and protocol", () => {
  expect(filterAndSortRelayGroups(groups, { search: "claude" }).map((group) => group.id)).toEqual(["beta"]);
  expect(filterAndSortRelayGroups(groups, { status: "enabled" }).map((group) => group.id)).toEqual(["alpha", "gamma"]);
  expect(filterAndSortRelayGroups(groups, { protocol: "gemini" }).map((group) => group.id)).toEqual(["gamma"]);
});

test("separates available, stopped, and pending relay groups", () => {
  expect(isAvailableRelayGroup(groups[0]!)).toBe(true);
  expect(isAvailableRelayGroup(groups[1]!)).toBe(false);
  expect(filterAndSortRelayGroups(groups, { status: "available" }).map((group) => group.id)).toEqual(["alpha"]);
  expect(filterAndSortRelayGroups(groups, { status: "disabled" }).map((group) => group.id)).toEqual(["beta"]);
  expect(filterAndSortRelayGroups(groups, { status: "pending" }).map((group) => group.id)).toEqual(["gamma"]);
});

test("allows imported groups to inherit a configured provider credential", () => {
  const inherited: ChannelGroupConfig = {
    id: "legacy-import",
    name: "Legacy import",
    status: "enabled",
    authType: "inherit",
    credentialMode: "provider",
    keys: [],
    models: ["gpt-5.6-sol"]
  };
  const provider = {
    id: "legacy",
    name: "Legacy",
    kind: "responsesRelay" as const,
    apiKeyStorage: "database" as const,
    nativeModels: ["gpt-5.6-sol"],
    modelAliases: [],
    groups: [inherited],
    createdAt: 1,
    updatedAt: 1
  };

  expect(hasConfiguredProviderCredential(provider)).toBe(true);
  expect(isAvailableRelayGroup(inherited)).toBe(false);
  expect(isAvailableRelayGroup(inherited, true)).toBe(true);
  expect(filterAndSortRelayGroups([inherited], { status: "available" }, true)).toEqual([inherited]);
});

test("does not expose disabled inherited groups when a provider credential exists", () => {
  const disabled: ChannelGroupConfig = {
    id: "disabled-import",
    name: "Disabled import",
    status: "disabled",
    authType: "inherit",
    credentialMode: "provider",
    keys: []
  };

  expect(isAvailableRelayGroup(disabled, true)).toBe(false);
  expect(filterAndSortRelayGroups([disabled], { status: "available" }, true)).toEqual([]);
});

test("sorts relay groups stably by ratio, usage, priority and model count", () => {
  expect(filterAndSortRelayGroups(groups, { sort: "ratio_asc" }).map((group) => group.id)).toEqual(["beta", "gamma", "alpha"]);
  expect(filterAndSortRelayGroups(groups, { sort: "usage_desc" }).map((group) => group.id)).toEqual(["beta", "alpha", "gamma"]);
  expect(filterAndSortRelayGroups(groups, { sort: "priority_desc" }).map((group) => group.id)).toEqual(["gamma", "alpha", "beta"]);
  expect(filterAndSortRelayGroups(groups, { sort: "models_desc" }).map((group) => group.id)).toEqual(["beta", "alpha", "gamma"]);
});

test("computes usage only when a finite positive quota exists", () => {
  expect(relayGroupUsageRate(groups[0]!)).toBe(0.25);
  expect(relayGroupUsageRate(groups[2]!)).toBeNull();
});

test("defaults keyless relay groups to collapsed and selects the first configured group", () => {
  const configuredGroups: ChannelGroupConfig[] = [
    { id: "empty", name: "Empty", keys: [] },
    { id: "blank", name: "Blank", keys: ["   "] },
    { id: "configured", name: "Configured", keys: ["sk-configured"] },
    { id: "configured-later", name: "Configured later", keys: ["sk-later"] }
  ];

  expect(hasConfiguredRelayGroupKey(configuredGroups[1]!)).toBe(false);
  expect(createInitialRelayGroupUiState(configuredGroups)).toEqual({
    selectedId: "configured",
    expandedById: {
      empty: false,
      blank: false,
      configured: true,
      "configured-later": false
    }
  });
});

test("selects but does not expand the first group when every group is keyless", () => {
  expect(createInitialRelayGroupUiState([
    { id: "first", name: "First", keys: [] },
    { id: "second", name: "Second" }
  ])).toEqual({
    selectedId: "first",
    expandedById: { first: false, second: false }
  });
});

test("requires a key for every configured relay group", () => {
  expect(relayGroupsMissingKeys(groups).map((group) => group.id)).toEqual(["gamma"]);
  expect(relayGroupsMissingKeys([
    { id: "blank", name: "Blank", groupRatio: 1, keys: ["   "] },
    { id: "ready", name: "Ready", groupRatio: 1, keys: ["sk-ready"] }
  ]).map((group) => group.id)).toEqual(["blank"]);
});

test("identifies catalog models that cannot use a fixed group protocol", () => {
  const catalog = {
    schema: "codex-react-ui.relay-catalog.v1" as const,
    success: true,
    auto_groups: [],
    data: [
      { model_name: "chat-only", enable_groups: ["mixed"], supported_endpoint_types: ["openai"] },
      { model_name: "messages-ready", enable_groups: ["mixed"], supported_endpoint_types: ["anthropic", "openai"] }
    ],
    group_ratio: {},
    usable_group: {},
    supported_endpoint: {},
    vendors: [],
    imported_at: 1,
    source_hash: "fixture",
    warnings: []
  };
  const fixedGroup: ChannelGroupConfig = {
    id: "mixed",
    name: "Mixed",
    models: ["chat-only", "messages-ready", "manual-model"],
    responseProtocol: "anthropic",
    responseProtocolMode: "fixed"
  };

  expect(incompatibleRelayGroupModels(fixedGroup, catalog)).toEqual(["chat-only"]);
  expect(relayGroupSupportsCatalogModel({ ...fixedGroup, responseProtocolMode: "model_auto" }, catalog.data[0])).toBe(true);
});

test("derives add-group candidates from the catalog without creating configured groups", () => {
  const catalog = {
    schema: "codex-react-ui.relay-catalog.v1" as const,
    success: true,
    auto_groups: [],
    data: [
      { model_name: "gpt", quota_type: 0 as const, enable_groups: ["codex"], supported_endpoint_types: ["openai"] },
      { model_name: "claude", quota_type: 0 as const, enable_groups: ["claude"], supported_endpoint_types: ["anthropic"] }
    ],
    group_ratio: { codex: 1, claude: 2 },
    usable_group: { codex: "Codex", claude: "Claude" },
    supported_endpoint: {},
    vendors: [],
    imported_at: 1,
    source_hash: "fixture",
    warnings: []
  };

  expect(catalogGroupTemplates(catalog).map((group) => [group.name, group.responseProtocol])).toEqual([
    ["codex", "openai"],
    ["claude", "anthropic"]
  ]);
  expect(catalogGroupTemplates(catalog, [{ id: "selected", name: "codex", groupRatio: 1, keys: [] }]).map((group) => group.name)).toEqual(["claude"]);
  const templates = catalogGroupTemplates(catalog);
  expect(filterCatalogGroupsByTree(templates, catalog, { level: "vendor", vendorId: null }).map((group) => group.name)).toEqual(["codex", "claude"]);
  expect(filterCatalogGroupsByTree(templates, catalog, { level: "model", modelName: "claude" }).map((group) => group.name)).toEqual(["claude"]);
  expect(filterCatalogGroupsByTree(templates, catalog, { level: "group", groupName: "codex" }).map((group) => group.name)).toEqual(["codex"]);
});

test("preserves group models and migrates legacy provider-level models for editing", () => {
  const provider = {
    id: "relay-a",
    kind: "responsesRelay" as const,
    name: "Relay A",
    nativeModels: ["gpt-5.5", "gpt-5.6-sol"],
    modelAliases: [],
    createdAt: 1,
    updatedAt: 1
  };
  expect(relayGroupModelsForEditing(provider, {
    id: "explicit",
    name: "Explicit",
    kind: "text",
    groupRatio: 1,
    models: ["gpt-5.6-sol"],
    keys: []
  })).toEqual(["gpt-5.6-sol"]);
  expect(relayGroupModelsForEditing(provider, {
    id: "legacy",
    name: "Legacy",
    kind: "text",
    groupRatio: 1,
    models: [],
    keys: []
  })).toEqual(["gpt-5.5", "gpt-5.6-sol"]);
  expect(relayGroupModelsForEditing(provider, {
    id: "image",
    name: "Image",
    kind: "image",
    groupRatio: 1,
    models: [],
    keys: []
  })).toEqual([]);
});

test("keeps mapped and upstream model ids selectable together", () => {
  const provider = {
    id: "relay-a",
    kind: "responsesRelay" as const,
    name: "Relay A",
    nativeModels: ["real-model"],
    modelAliases: [],
    createdAt: 1,
    updatedAt: 1
  };
  expect(relayGroupSelectableModels(provider, {
    id: "default",
    name: "Default",
    groupRatio: 1,
    models: ["real-model"],
    modelMapping: [
      { from: "gpt-5.6", to: "real-model" },
      { from: "legacy-model", to: "second-real-model" }
    ]
  })).toEqual(["real-model", "gpt-5.6", "legacy-model", "second-real-model"]);
});

test("keeps free upstream models and every available UI mapping selectable", () => {
  const provider = {
    id: "omniroute-free",
    kind: "responsesRelay" as const,
    name: "CodexUltraFree",
    nativeModels: ["longcat-2.0-free", "mimo-v2.5-free"],
    modelAliases: [],
    createdAt: 1,
    updatedAt: 1
  };
  expect(relayGroupSelectableModels(provider, {
    id: "opencode-free",
    name: "CodexUltraFree",
    groupRatio: 0,
    models: ["longcat-2.0-free", "mimo-v2.5-free"],
    modelMapping: [
      { from: "gpt-5.6-sol", to: "longcat-2.0-free" },
      { from: "codex-auto-review", to: "longcat-2.0-free" },
      { from: "gpt-5.6-luna", to: "mimo-v2.5-free" }
    ]
  })).toEqual([
    "longcat-2.0-free",
    "mimo-v2.5-free",
    "gpt-5.6-sol",
    "codex-auto-review",
    "gpt-5.6-luna"
  ]);
});

test("merges catalog groups into a draft while preserving local credentials", () => {
  const existing: ChannelGroupConfig[] = [
    { id: "local-codex", name: "codex", groupRatio: 1, keys: ["sk-local"], credentialMode: "group" },
    { id: "manual", name: "manual", groupRatio: 1, keys: ["sk-manual"] }
  ];
  const imported: ChannelGroupConfig[] = [
    { id: "catalog:codex", name: "codex", catalogGroupName: "codex", catalogManaged: true, groupRatio: 2, keys: [], credentialMode: "provider" },
    { id: "catalog:claude", name: "claude", catalogGroupName: "claude", catalogManaged: true, groupRatio: 3, keys: [], credentialMode: "provider" }
  ];

  const merged = mergeCatalogGroupDrafts(existing, imported, "merge");
  expect(merged).toHaveLength(3);
  expect(merged.find((group) => group.name === "codex")).toMatchObject({
    id: "local-codex",
    groupRatio: 2,
    keys: ["sk-local"],
    credentialMode: "group",
    catalogManaged: true
  });
  expect(merged.find((group) => group.name === "claude")?.credentialMode).toBe("provider");
  expect(merged.find((group) => group.name === "manual")?.id).toBe("manual");
});

test("replace removes stale catalog groups but preserves manual groups", () => {
  const existing: ChannelGroupConfig[] = [
    { id: "stale", name: "stale", catalogManaged: true, groupRatio: 1, keys: [] },
    { id: "manual", name: "manual", groupRatio: 1, keys: ["sk-manual"] }
  ];
  const imported: ChannelGroupConfig[] = [
    { id: "catalog:new", name: "new", catalogManaged: true, groupRatio: 1, keys: [], credentialMode: "provider" }
  ];

  expect(mergeCatalogGroupDrafts(existing, imported, "replace").map((group) => group.name)).toEqual(["manual", "new"]);
});

test("provider-inherited catalog groups accept an available provider credential", () => {
  const inherited: ChannelGroupConfig = {
    id: "catalog:claude",
    name: "claude",
    groupRatio: 1,
    credentialMode: "provider",
    keys: []
  };
  expect(relayGroupsMissingKeys([inherited], false)).toEqual([inherited]);
  expect(relayGroupsMissingKeys([inherited], true)).toEqual([]);
});
