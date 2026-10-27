import { afterEach, expect, test } from "bun:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { ProviderStore } from "../../apps/server/src/providerStore.ts";
import {
  buildCatalogImportPreview,
  deriveCatalogGroups,
  parseRelayCapabilityCatalog,
  reconcileRequiredImageCatalogGroups
} from "../../backends/relay-config/src/relay/relayCatalog.ts";

const fixturePath = join(import.meta.dir, "../fixtures/relayCapabilityCatalog.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (code !== "EBUSY") throw error;
        if (attempt === 5) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
});

test("parses the real relay capability catalog without dropping model metadata", () => {
  const catalog = parseRelayCapabilityCatalog(fixture, 1234);

  expect(catalog.data).toHaveLength(236);
  expect(Object.keys(fixture.supported_endpoint)).toHaveLength(10);
  expect(Object.keys(catalog.usable_group)).toHaveLength(40);
  expect(catalog.vendors).toHaveLength(7);
  expect(Object.keys(catalog.supported_endpoint)).toHaveLength(8);
  expect(catalog.supported_endpoint.videos?.aliases).toContain("vidoes");
  expect(catalog.supported_endpoint["openai-response-compact"]?.aliases).toContain("openai-responses-compact");
  expect(catalog.supported_endpoint["image-edits"]?.path).toBe("/v1/images/edits");
  expect(catalog.data.find((model) => model.model_name === "nano_banana_pro-1K")).toMatchObject({
    vendor_id: 4,
    quota_type: 1,
    model_price: 0.6,
    enable_groups: ["gemini-image"],
    supported_endpoint_types: ["openai", "videos"]
  });
  expect(catalog.warnings.some((warning) => warning.includes("Group default has no model membership"))).toBe(true);
});

test("derives stable groups with independent Anthropic, Gemini and OpenAI protocols", () => {
  const catalog = parseRelayCapabilityCatalog(fixture);
  const groups = deriveCatalogGroups(catalog);

  expect(groups).toHaveLength(40);
  expect(groups.find((group) => group.name === "claude")).toMatchObject({
    id: "catalog:claude",
    responseProtocol: "anthropic",
    responseProtocolMode: "fixed",
    credentialMode: "provider"
  });
  expect(groups.find((group) => group.name === "gemini")).toMatchObject({
    responseProtocol: "gemini",
    responseProtocolMode: "fixed"
  });
  expect(groups.find((group) => group.name === "codex")).toMatchObject({
    responseProtocol: "openai",
    responseProtocolMode: "fixed"
  });
  expect(groups.find((group) => group.name === "gpt-azure")?.responseProtocolMode).toBe("model_auto");
  expect(groups.find((group) => group.name === "gpt-image")).toMatchObject({
    kind: "image",
    capabilities: { imageGeneration: true, imageEdits: true },
    image: {
      defaultModel: "gpt-image-2-count",
      billing: { mode: "per_image", usdPerImage: 0.08 }
    }
  });
  expect(groups.find((group) => group.name === "gpt-image-adobe")?.image).toMatchObject({
    defaultModel: "gpt-image-2-count",
    billing: { mode: "per_image", usdPerImage: 0.12 }
  });
  expect(groups.find((group) => group.name === "gpt-azure")).toMatchObject({
    kind: "text",
    capabilities: { text: true, imageGeneration: true, imageEdits: true },
    image: {
      defaultModel: "gpt-image-2",
      billing: { mode: "token_multiplier", multiplier: 1.2 },
      availability: "constrained"
    }
  });
});

test("upgrades legacy image runtime groups without importing unrelated catalog groups", () => {
  const catalog = parseRelayCapabilityCatalog(fixture);
  const groups = reconcileRequiredImageCatalogGroups([{
    id: "catalog:gpt-image",
    name: "gpt-image",
    kind: "image",
    catalogGroupName: "gpt-image",
    catalogManaged: true,
    groupRatio: 0.08,
    keys: [],
    image: { generations: true, edits: true, defaultModel: "gpt-image-2-1k" }
  }], catalog);

  expect(groups).toHaveLength(3);
  expect(groups.find((group) => group.name === "gpt-image")?.image?.defaultModel).toBe("gpt-image-2-count");
  expect(groups.find((group) => group.name === "gpt-image-adobe")?.image?.billing).toMatchObject({ mode: "per_image", usdPerImage: 0.12 });
  expect(groups.find((group) => group.name === "gpt-azure")?.capabilities).toMatchObject({ text: true, imageGeneration: true, imageEdits: true });
  expect(groups.some((group) => group.name === "claude")).toBe(false);
});

test("imports catalog rows transactionally and remains idempotent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-ui-relay-catalog-"));
  tempDirs.push(dir);
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });
  await store.save({
    id: "deepkey",
    kind: "responsesRelay",
    name: "DeepKey",
    baseUrl: "https://deepkey.top/v1",
    nativeModels: ["existing-model"],
    modelAliases: [],
    groups: [{
      id: "manual",
      name: "manual",
      groupRatio: 1,
      responseProtocol: "openai-response",
      responseProtocolMode: "fixed",
      credentialMode: "group",
      keys: ["test-only-key"]
    }]
  }, "provider-test-key");

  const preview = await store.previewCapabilityCatalog("deepkey", fixture);
  expect(preview.counts).toEqual({ models: 236, groups: 40, vendors: 7, endpoints: 8 });
  expect(preview.changes.add).toBe(40);

  const first = await store.importCapabilityCatalog("deepkey", fixture, "merge");
  const second = await store.importCapabilityCatalog("deepkey", fixture, "merge");
  expect(first.provider.groups).toHaveLength(41);
  expect(second.provider.groups).toHaveLength(41);
  expect(second.changes).toMatchObject({ add: 0, remove: 0, unchanged: 40 });
  expect(second.provider.groups?.find((group) => group.id === "manual")?.keys).toEqual(["test-only-key"]);

  expect((db.prepare("SELECT COUNT(*) AS count FROM relay_catalog_models WHERE provider_id = ?").get("deepkey") as { count: number }).count).toBe(236);
  expect((db.prepare("SELECT COUNT(*) AS count FROM relay_catalog_groups WHERE provider_id = ?").get("deepkey") as { count: number }).count).toBe(40);
  expect((db.prepare("SELECT COUNT(*) AS count FROM relay_model_enable_groups WHERE provider_id = ?").get("deepkey") as { count: number }).count).toBeGreaterThan(236);
  expect((db.prepare("SELECT response_protocol FROM relay_catalog_groups WHERE provider_id = ? AND group_name = ?").get("deepkey", "claude") as { response_protocol: string }).response_protocol).toBe("anthropic");
  expect((db.prepare("SELECT COUNT(*) AS count FROM relay_groups WHERE provider_id = ?").get("deepkey") as { count: number }).count).toBe(41);
  const profile = await store.exportProfile();
  expect(profile.providers[0]?.capabilityCatalog?.data).toHaveLength(236);
  expect(profile.providers[0]?.groups?.every((group) => group.keys?.length === 0)).toBe(true);
  expect(JSON.stringify(profile)).not.toContain("provider-test-key");
  db.close();
});

test("merging a matching catalog group preserves its existing group key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-ui-relay-existing-key-"));
  tempDirs.push(dir);
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });
  await store.save({
    id: "deepkey",
    kind: "responsesRelay",
    name: "DeepKey",
    baseUrl: "https://deepkey.top/v1",
    nativeModels: ["gpt-5"],
    modelAliases: [],
    groups: [{ id: "existing-codex", name: "codex", groupRatio: 1, keys: ["existing-codex-key"] }]
  }, "provider-test-key");
  const result = await store.importCapabilityCatalog("deepkey", fixture, "merge");
  expect(result.provider.groups?.find((group) => group.name === "codex")).toMatchObject({
    id: "existing-codex",
    keys: ["existing-codex-key"],
    credentialMode: "group",
    catalogManaged: true
  });
  db.close();
});

test("catalog imports require an existing keyed provider with a base URL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-ui-relay-catalog-provider-"));
  tempDirs.push(dir);
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });
  expect(store.importCapabilityCatalog("missing", fixture)).rejects.toThrow("Provider not found");
  await store.save({ id: "empty", kind: "responsesRelay", name: "Empty", nativeModels: [], modelAliases: [], groups: [{ id: "default", name: "default", groupRatio: 1, keys: ["sk-empty"] }] });
  expect(store.importCapabilityCatalog("empty", fixture)).rejects.toThrow("Base URL");
  await store.save({ id: "empty", kind: "responsesRelay", name: "Empty", baseUrl: "https://relay.example/v1", nativeModels: [], modelAliases: [], groups: [{ id: "default", name: "default", groupRatio: 1, keys: ["sk-empty"] }] });
  const result = await store.importCapabilityCatalog("empty", fixture);
  expect(result.provider.capabilityCatalog?.data).toHaveLength(236);
  db.close();
});

test("catalog imports support official-labelled providers through normal groups", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-ui-relay-catalog-official-"));
  tempDirs.push(dir);
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });
  await store.save({
    id: "official-openai",
    kind: "responsesRelay",
    name: "Official OpenAI",
    baseUrl: "https://api.openai.com/v1",
    nativeModels: ["gpt-5.5"],
    modelAliases: [],
    stationType: "official",
    groups: [{ id: "default", name: "default", groupRatio: 1, keys: ["sk-official-test"] }]
  });

  expect((await store.previewCapabilityCatalog("official-openai", fixture)).catalog.data).toHaveLength(236);
  expect((await store.importCapabilityCatalog("official-openai", fixture)).provider.stationType).toBe("official");
  db.close();
});

test("preview reports updates and replace-only removals for managed groups", () => {
  const catalog = parseRelayCapabilityCatalog(fixture);
  const groups = deriveCatalogGroups(catalog);
  const preview = buildCatalogImportPreview("deepkey", [
    ...groups.map((group) => group.name === "claude" ? { ...group, groupRatio: 99 } : group),
    { ...groups[0]!, id: "catalog:removed", name: "removed", catalogGroupName: "removed" }
  ], fixture);

  expect(preview.changes.update).toBe(1);
  expect(preview.changes.remove).toBe(1);
});

test("catalog extensions remain idempotent and unwrap nested chains", () => {
  // Simulate deeply nested extensions from previous saves
  let nested: any = { group_overrides: { test: 1 } };
  for (let i = 0; i < 50; i++) {
    nested = { extensions: nested };
  }

  const catalogWithNested = {
    ...fixture,
    data: [
      {
        ...fixture.data[0],
        extensions: nested
      }
    ]
  };

  const parsed1 = parseRelayCapabilityCatalog(catalogWithNested);
  expect(parsed1.data[0]?.extensions).toEqual({ group_overrides: { test: 1 } });

  // Re-parsing the parsed result should be strictly idempotent (no nested extensions)
  const parsed2 = parseRelayCapabilityCatalog(parsed1, 1000);
  expect(parsed2.data[0]?.extensions).toEqual({ group_overrides: { test: 1 } });

  const parsed3 = parseRelayCapabilityCatalog(parsed2, 1000);
  expect(parsed3.data[0]?.extensions).toEqual({ group_overrides: { test: 1 } });
  expect(JSON.stringify(parsed3).length).toBe(JSON.stringify(parsed2).length);
});
