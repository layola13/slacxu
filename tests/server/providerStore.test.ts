import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { LocalDatabase, codexUiDataDir } from "../../apps/server/src/localDatabase.ts";
import { ProviderStore } from "../../apps/server/src/providerStore.ts";

const tempDirs: string[] = [];
const originalDataDir = process.env.CODEX_UI_DATA_DIR;
const originalProviderEnv = process.env.CODEX_UI_PROVIDER_ENV_TEST_API_KEY;

afterEach(async () => {
  if (originalDataDir === undefined) {
    delete process.env.CODEX_UI_DATA_DIR;
  } else {
    process.env.CODEX_UI_DATA_DIR = originalDataDir;
  }
  if (originalProviderEnv === undefined) {
    delete process.env.CODEX_UI_PROVIDER_ENV_TEST_API_KEY;
  } else {
    process.env.CODEX_UI_PROVIDER_ENV_TEST_API_KEY = originalProviderEnv;
  }
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          rmSync(dir, { recursive: true, force: true });
          break;
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
          if (code !== "EBUSY") throw error;
          if (attempt === 5) break;
          await Bun.sleep(50);
        }
      }
    }
  }
});

function tempDataDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

test("codexUiDataDir honors CODEX_UI_DATA_DIR so relay storage can live on a persistent volume", () => {
  const dir = tempDataDir("codex-ui-data-dir-");
  process.env.CODEX_UI_DATA_DIR = dir;

  expect(codexUiDataDir()).toBe(dir);
  const database = new LocalDatabase();
  expect(database.file).toBe(join(dir, "codex-ui.sqlite3"));
  database.connection.close();
});

test("ProviderStore persists relay channels in SQLite across store instances", async () => {
  const dir = tempDataDir("codex-ui-provider-store-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const first = new ProviderStore({ connection: db });
  const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  const saved = await first.save({
    id: "axon-relay",
    kind: "responsesRelay",
    name: "Axon Relay",
    serviceProvider: { id: "custom", name: "Acme AI", logo },
    baseUrl: "https://relay.example/v1",
    nativeModels: ["glm-4.5"],
    modelAliases: [],
    defaultModel: "glm-4.5",
    streamMaxRetries: 37,
    modelRates: [],
    remark: "persist me",
    sharedImport: { source: "codex-ultra-share", importedAt: 1_725_000_000_000 },
    groups: [{
      id: "default",
      name: "default",
      groupRatio: 1,
      keys: ["sk-axon"],
      models: ["claude-opus-4-8"],
      modelCapabilities: {
        "claude-opus-4-8": { reasoningEfforts: ["high", "xhigh", "max"], contextWindow: 1_000_000, source: "upstream" }
      }
    }]
  });

  const second = new ProviderStore({ connection: db });
  const providers = await second.list();

  expect(saved.id).toBe("axon-relay");
  expect(providers).toHaveLength(1);
  expect(providers[0]?.id).toBe("axon-relay");
  expect(providers[0]?.remark).toBe("persist me");
  expect(providers[0]?.sharedImport).toEqual({ source: "codex-ultra-share", importedAt: 1_725_000_000_000 });
  expect(providers[0]?.streamMaxRetries).toBe(37);
  expect(providers[0]?.serviceProvider).toEqual({ id: "custom", name: "Acme AI", logo });
  expect(providers[0]?.groups?.[0]?.modelCapabilities?.["claude-opus-4-8"]).toEqual({
    reasoningEfforts: ["high", "xhigh", "max"],
    contextWindow: 1_000_000,
    source: "upstream"
  });
  const merged = await first.save({
    ...saved,
    id: "",
    serviceProvider: { id: "custom", name: "Another vendor" }
  });
  expect(merged.id).toBe("axon-relay");
  expect(merged.groups?.map((group) => group.name)).toEqual(["default", "default-2"]);
  db.close();
});

test("ProviderStore repairs stale relay group rows from a complete provider payload", async () => {
  const db = new Database(":memory:");
  const store = new ProviderStore({ connection: db });
  await store.save({
    id: "deepkey",
    kind: "responsesRelay",
    name: "DeepKey 中转",
    baseUrl: "https://deepkey.top/v1",
    nativeModels: ["gpt-5.6-sol"],
    modelAliases: [],
    groups: [
      { id: "catalog:codex-team", name: "codex-team", status: "enabled", authType: "inherit", credentialMode: "group", keys: ["sk-team"], models: ["gpt-5.6-sol"] },
      { id: "catalog:gpt-azure", name: "gpt-azure", status: "enabled", authType: "inherit", credentialMode: "provider", keys: [], models: ["gpt-5.6-sol"] }
    ]
  }, "provider-key");

  db.prepare("DELETE FROM relay_groups WHERE provider_id = ? AND group_id = ?").run("deepkey", "catalog:gpt-azure");
  db.prepare("UPDATE relay_groups SET keys_json = '[]' WHERE provider_id = ? AND group_id = ?").run("deepkey", "catalog:codex-team");

  const restarted = new ProviderStore({ connection: db });
  const loaded = await restarted.list();
  expect(loaded[0]?.groups?.map((group) => group.id)).toEqual(["catalog:codex-team", "catalog:gpt-azure"]);
  expect(loaded[0]?.groups?.[0]?.keys).toEqual(["sk-team"]);

  await restarted.initialize();
  expect((db.prepare("SELECT COUNT(*) AS count FROM relay_groups WHERE provider_id = ?").get("deepkey") as { count: number }).count).toBe(2);
  expect((db.prepare("SELECT keys_json FROM relay_groups WHERE provider_id = ? AND group_id = ?").get("deepkey", "catalog:codex-team") as { keys_json: string }).keys_json).toBe('["sk-team"]');
  db.close();
});

test("ProviderStore persists trashed relays and restores them", async () => {
  const db = new Database(":memory:");
  const store = new ProviderStore({ connection: db });
  await store.save({
    id: "expired-relay",
    kind: "responsesRelay",
    name: "Expired Relay",
    baseUrl: "https://expired.example/v1",
    nativeModels: ["gpt-5.6-terra"],
    modelAliases: [],
    groups: [{ id: "default", name: "default", groupRatio: 1, keys: ["sk-expired"], models: ["gpt-5.6-terra"] }]
  });

  const trashed = await store.trash("expired-relay");
  expect(trashed.trashedAt).toBeNumber();
  expect(await store.list()).toHaveLength(0);
  expect((await store.listTrashed()).map((provider) => provider.id)).toEqual(["expired-relay"]);

  const restarted = new ProviderStore({ connection: db });
  expect((await restarted.listTrashed()).map((provider) => provider.id)).toEqual(["expired-relay"]);
  const restored = await restarted.restore("expired-relay");
  expect(restored.trashedAt).toBeUndefined();
  expect((await restarted.list()).map((provider) => provider.id)).toEqual(["expired-relay"]);
  expect(await restarted.listTrashed()).toHaveLength(0);
  db.close();
});

test("ProviderStore treats DeepKey relay names as instances of one service provider", async () => {
  const db = new Database(":memory:");
  const store = new ProviderStore({ connection: db });
  const saved = await store.save({
    id: "deepkey-sponsored-instance",
    kind: "responsesRelay",
    name: "Sponsor East",
    serviceProvider: { id: "custom", name: "DeepKey 中转" },
    baseUrl: "https://deepkey.top/v1",
    nativeModels: ["gpt-5.6-sol"],
    modelAliases: [],
    groups: [{ id: "default", name: "default", groupRatio: 1, keys: ["sk-deepkey"] }]
  });

  expect(saved.id).toBe("deepkey-sponsored-instance");
  expect(saved.name).toBe("Sponsor East");
  expect(saved.serviceProvider).toEqual({ id: "deepkey", name: "DeepKey", logo: undefined });

  const renamed = await store.save({ ...saved, name: "Sponsor West" });
  expect(renamed.id).toBe(saved.id);
  expect(renamed.name).toBe("Sponsor West");
  expect(renamed.serviceProvider).toEqual({ id: "deepkey", name: "DeepKey", logo: undefined });
  db.close();
});

test("ProviderStore keeps transient providers in memory and out of SQLite exports", async () => {
  const dir = tempDataDir("codex-ui-provider-transient-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });
  await store.reserveTransient("omniroute-free");
  const saved = await store.save({
    id: "omniroute-free",
    kind: "responsesRelay",
    name: "CodexUltraFree",
    baseUrl: "https://opencode.ai/zen/v1",
    defaultModel: "mimo-v2.5-free",
    nativeModels: ["mimo-v2.5-free"],
    modelAliases: [],
    modelDisplayNames: { "mimo-v2.5-free": "gpt-5.6-luna" },
    groups: [{
      id: "opencode-free",
      name: "CodexUltraFree",
      kind: "text",
      authType: "none",
      groupRatio: 0,
      models: ["mimo-v2.5-free"],
      keys: []
    }],
    createdAt: 1,
    updatedAt: 1
  });

  expect(saved.defaultModel).toBe("mimo-v2.5-free");
  expect((await store.get("omniroute-free"))?.modelDisplayNames).toEqual({ "mimo-v2.5-free": "gpt-5.6-luna" });
  expect((db.prepare("SELECT COUNT(*) AS count FROM providers WHERE id = ?").get("omniroute-free") as { count: number }).count).toBe(0);
  expect((await store.exportRelayConfig()).providers).toHaveLength(0);
  expect(await new ProviderStore({ connection: db }).get("omniroute-free")).toBeNull();
  db.close();
});

test("ProviderStore preserves an edited group modelMapping for the transient omniroute-free channel", async () => {
  const dir = tempDataDir("codex-ui-provider-free-mapping-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });
  await store.reserveTransient("omniroute-free");
  const customMapping = [
    { from: "gpt-5.5", to: "nemotron-3-ultra-free" },
    { from: "gpt-5.4", to: "big-pickle" }
  ];
  const saved = await store.save({
    id: "omniroute-free",
    kind: "responsesRelay",
    name: "CodexUltraFree",
    baseUrl: "https://opencode.ai/zen/v1",
    defaultModel: "nemotron-3-ultra-free",
    nativeModels: ["nemotron-3-ultra-free", "big-pickle"],
    modelAliases: [],
    groups: [{
      id: "opencode-free",
      name: "CodexUltraFree",
      kind: "text",
      authType: "none",
      groupRatio: 0,
      models: ["nemotron-3-ultra-free", "big-pickle"],
      keys: [],
      modelMapping: customMapping
    }],
    createdAt: 1,
    updatedAt: 1
  });

  expect(saved.groups?.[0]?.modelMapping).toEqual(customMapping);
  expect((await store.get("omniroute-free"))?.groups?.[0]?.modelMapping).toEqual(customMapping);
  db.close();
});

test("ProviderStore round-trips per-group advancedModelMapping cross-channel rules", async () => {
  const db = new Database(":memory:");
  const store = new ProviderStore({ connection: db });
  const advancedMapping = [
    { requestModel: "gpt-5", targetProviderId: "other-channel", targetGroupId: "default", targetModel: "claude-3-5-sonnet" },
    { requestModel: "gpt-4", targetModel: "gpt-4o", enabled: false }
  ];
  const saved = await store.save({
    id: "provider-advanced",
    kind: "responsesRelay",
    name: "Advanced Mapping Provider",
    baseUrl: "https://example.com/v1",
    nativeModels: ["gpt-5"],
    modelAliases: [],
    groups: [{
      id: "default",
      name: "default",
      kind: "text",
      authType: "none",
      groupRatio: 1,
      models: ["gpt-5"],
      keys: [],
      advancedModelMapping: advancedMapping
    }],
    createdAt: 1,
    updatedAt: 1
  });

  expect(saved.groups?.[0]?.advancedModelMapping).toEqual(advancedMapping);
  const reloaded = (await store.get("provider-advanced"))?.groups?.[0]?.advancedModelMapping;
  expect(reloaded).toEqual(advancedMapping);
  expect(reloaded?.[0]?.targetProviderId).toBe("other-channel");
  expect(reloaded?.[1]?.enabled).toBe(false);
  db.close();
});

test("ProviderStore treats official labels as grouped relay presentation metadata", async () => {
  const db = new Database(":memory:");
  const first = new ProviderStore({ connection: db });
  const secret = "sk-provider-database-test";

  const saved = await first.save({
    id: "deepseek",
    kind: "openai",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    nativeModels: ["deepseek-v4-flash"],
    modelAliases: [],
    stationType: "official",
    groups: [{ id: "default", name: "default", groupRatio: 1, responseProtocol: "openai", keys: [secret] }]
  });
  const second = new ProviderStore({ connection: db });
  await second.initialize();

  expect(saved.groups?.[0]?.responseProtocol).toBe("openai");
  expect((await second.get("deepseek"))?.groups?.[0]?.keys).toEqual([secret]);
  await second.delete("deepseek");
  expect(await new ProviderStore({ connection: db }).get("deepseek")).toBeNull();
  db.close();
});

test("ProviderStore migrates keyed legacy providers to normal groups and removes unkeyed ones", async () => {
  const db = new Database(":memory:");
  const store = new ProviderStore({ connection: db });
  const now = Date.now();
  const legacyDeepSeek = {
    id: "legacy-deepseek", kind: "openai", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1",
    nativeModels: ["deepseek-v4-flash"], modelAliases: [], stationType: "official", createdAt: now, updatedAt: now
  };
  const unkeyed = {
    id: "legacy-empty", kind: "responsesRelay", name: "Empty", baseUrl: "https://relay.example/v1",
    nativeModels: ["test-model"], modelAliases: [], createdAt: now, updatedAt: now
  };
  db.prepare("INSERT INTO providers (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(legacyDeepSeek.id, JSON.stringify(legacyDeepSeek), now, now);
  db.prepare("INSERT INTO providers (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(unkeyed.id, JSON.stringify(unkeyed), now, now);
  db.prepare("INSERT INTO provider_secrets (provider_id, api_key, updated_at) VALUES (?, ?, ?)").run(legacyDeepSeek.id, "sk-legacy", now);

  await store.initialize();

  const migrated = await store.get(legacyDeepSeek.id);
  expect(migrated?.groups).toEqual([expect.objectContaining({
    id: "default", responseProtocol: "openai", credentialMode: "group", keys: ["sk-legacy"]
  })]);
  expect(await store.get(unkeyed.id)).toBeNull();
  db.close();
});

test("ProviderStore preserves catalog groups that inherit a provider credential across restart", async () => {
  const db = new Database(":memory:");
  const first = new ProviderStore({ connection: db });
  await first.save({
    id: "catalog-relay",
    kind: "responsesRelay",
    name: "Catalog relay",
    baseUrl: "https://relay.example/v1",
    apiKeyRef: "env:CODEX_UI_PROVIDER_CATALOG_RELAY_API_KEY",
    nativeModels: ["gpt-image-2-count"],
    modelAliases: [],
    groups: [{
      id: "catalog:gpt-image",
      name: "gpt-image",
      kind: "image",
      credentialMode: "group",
      groupRatio: 0.08,
      keys: ["bootstrap-key"]
    }]
  }, "provider-key");
  db.prepare("UPDATE relay_groups SET credential_mode = 'provider', keys_json = '[]' WHERE provider_id = ?").run("catalog-relay");
  db.prepare("DELETE FROM provider_secrets WHERE provider_id = ?").run("catalog-relay");

  const restarted = new ProviderStore({ connection: db });
  await restarted.initialize();

  expect((await restarted.get("catalog-relay"))?.groups?.[0]).toMatchObject({
    name: "gpt-image",
    credentialMode: "provider"
  });
  db.close();
});

test("ProviderStore saves model changes for catalog groups that inherit a provider credential", async () => {
  const db = new Database(":memory:");
  const store = new ProviderStore({ connection: db });
  const provider = await store.save({
    id: "catalog-model-relay",
    kind: "responsesRelay",
    name: "Catalog model relay",
    baseUrl: "https://relay.example/v1",
    nativeModels: ["gpt-old"],
    modelAliases: [],
    groups: [{
      id: "catalog:codex",
      name: "codex",
      kind: "text",
      credentialMode: "provider",
      groupRatio: 0.08,
      models: ["gpt-old"],
      keys: []
    }]
  }, "provider-key");

  const saved = await store.save({
    ...provider,
    nativeModels: ["gpt-new"],
    groups: provider.groups?.map((group) => ({ ...group, models: ["gpt-new"] }))
  });

  expect(saved.groups?.[0]).toMatchObject({
    credentialMode: "provider",
    keys: [],
    models: ["gpt-new"]
  });
  db.close();
});

test("ProviderStore appends a group to an explicitly selected provider", async () => {
  const db = new Database(":memory:");
  const store = new ProviderStore({ connection: db });
  await store.save({
    id: "deepkey-instance",
    kind: "responsesRelay",
    name: "Sponsor DeepKey",
    serviceProvider: { id: "deepkey", name: "DeepKey" },
    baseUrl: "https://api.deepkey.top/v1",
    nativeModels: ["real-model"],
    modelAliases: [],
    groups: [{
      id: "default",
      name: "default",
      groupRatio: 1,
      models: ["real-model"],
      keys: ["old-key"]
    }]
  });

  const saved = await store.save({
    id: "",
    kind: "responsesRelay",
    name: "ignored-name",
    serviceProvider: { id: "deepkey", name: "DeepKey" },
    baseUrl: "https://sponsor.example/v1",
    nativeModels: ["mapped-model"],
    modelAliases: [],
    groups: [{
      id: "default",
      name: "default",
      groupRatio: 0.08,
      models: ["mapped-model"],
      keys: ["new-key"]
    }]
  }, undefined, "deepkey-instance");

  expect(saved.id).toBe("deepkey-instance");
  expect(saved.name).toBe("Sponsor DeepKey");
  expect(saved.groups).toHaveLength(2);
  expect(saved.groups?.[0]?.keys).toEqual(["old-key"]);
  expect(saved.groups?.[1]).toMatchObject({
    id: "default-2",
    name: "default-2",
    baseUrl: "https://sponsor.example/v1",
    keys: ["new-key"]
  });
  db.close();
});

test("codexUiDataDir migrates the legacy profile directory to codex-ultra", () => {
  const home = tempDataDir("codex-ultra-home-");
  const legacy = join(home, ".codex-react-ui");
  mkdirSync(legacy);
  writeFileSync(join(legacy, "profile-marker.txt"), "preserved", "utf8");

  const result = codexUiDataDir({}, home);

  expect(result).toBe(join(home, ".codex-ultra"));
  expect(existsSync(legacy)).toBe(false);
  expect(readFileSync(join(result, "profile-marker.txt"), "utf8")).toBe("preserved");
});

test("ProviderStore keeps differently named relay channels side by side", async () => {
  const db = new Database(":memory:");
  const store = new ProviderStore({ connection: db });
  const base = {
    kind: "responsesRelay" as const,
    baseUrl: "https://relay.example/v1",
    nativeModels: ["gpt-5.6-sol"],
    modelAliases: [],
    createdAt: 1,
    updatedAt: 1
  };

  await store.save({ ...base, id: "relay-primary", name: "Relay Primary", groups: [{ id: "default", name: "default", groupRatio: 1, keys: ["sk-primary"] }] });
  await store.save({ ...base, id: "relay-backup", name: "Relay Backup", groups: [{ id: "default", name: "default", groupRatio: 1, keys: ["sk-backup"] }] });

  expect((await store.list()).map((provider) => provider.name).sort()).toEqual(["Relay Backup", "Relay Primary"]);
  const merged = await store.save({ ...base, id: "", name: "Relay Primary", groups: [{ id: "default", name: "default", groupRatio: 1, keys: ["sk-duplicate"] }] });
  expect(merged.id).toBe("relay-primary");
  expect(merged.groups?.map((group) => group.name)).toEqual(["default", "default-2"]);
  expect((await store.list()).map((provider) => provider.name).sort()).toEqual(["Relay Backup", "Relay Primary"]);
  db.close();
});

test("ProviderStore persists image protocol configuration", async () => {
  const dir = tempDataDir("codex-ui-provider-image-protocols-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const store = new ProviderStore({ connection: db });
  await store.save({
    id: "deepkey-image",
    kind: "responsesRelay",
    name: "DeepKey Image",
    baseUrl: "https://deepkey.top/v1",
    nativeModels: ["gpt-5.5", "gemini-3.1-flash-image-preview", "nano_banana_2"],
    modelAliases: [],
    defaultModel: "gpt-5.5",
    image: {
      generations: true,
      edits: true,
      defaultModel: "gemini-3.1-flash-image-preview",
      protocols: ["openaiImages", "openaiImageEdits", "geminiChatCompletions", "geminiGenerateContent", "deepkeyAsyncVideos"],
      defaultProtocol: "geminiChatCompletions",
      billing: { mode: "per_image", usdPerImage: 0.12, currency: "USD" },
      availability: "available",
      notice: "quality channel"
    },
    groups: [{ id: "image", name: "image", kind: "image", groupRatio: 1, keys: ["sk-image"] }]
  });

  const providers = await store.list();

  expect(providers[0]?.image).toEqual({
    generations: true,
    edits: true,
    defaultModel: "gemini-3.1-flash-image-preview",
    protocols: ["openaiImages", "openaiImageEdits", "geminiChatCompletions", "geminiGenerateContent", "deepkeyAsyncVideos"],
    defaultProtocol: "geminiChatCompletions",
    billing: { mode: "per_image", usdPerImage: 0.12, currency: "USD" },
    availability: "available",
    notice: "quality channel"
  });
  db.close();
});

test("ProviderStore runtimeEnv includes externally supplied provider API keys", () => {
  process.env.CODEX_UI_PROVIDER_ENV_TEST_API_KEY = "sk-runtime-env-test";
  const dir = tempDataDir("codex-ui-provider-env-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });

  expect(store.runtimeEnv().CODEX_UI_PROVIDER_ENV_TEST_API_KEY).toBe("sk-runtime-env-test");
  db.close();
});

test("ProviderStore uses the selected group key at runtime and removes group secrets from profile exports", async () => {
  const dir = tempDataDir("codex-ui-provider-groups-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const store = new ProviderStore({ connection: db });
  await store.save({
    id: "grouped-relay",
    kind: "responsesRelay",
    name: "Grouped Relay",
    baseUrl: "https://relay.example/v1",
    nativeModels: ["codex"],
    modelAliases: [],
    groups: [
      { id: "text-main", name: "Text Main", kind: "text", groupRatio: 1, quotaUsd: 20, usedQuotaUsd: 2.5, models: ["gpt-5.5", "gpt-5.6-sol"], keys: ["sk-text-secret"] },
      { id: "image-main", name: "Image Main", kind: "image", groupRatio: 1.2, quotaUsd: 8, usedQuotaUsd: 1.25, keys: ["sk-image-secret"] }
    ]
  }, "sk-text-secret");

  store.useProviderKey("grouped-relay", "sk-image-secret");
  expect(store.runtimeEnv().CODEX_UI_PROVIDER_GROUPED_RELAY_API_KEY).toBe("sk-image-secret");
  const saved = await store.get("grouped-relay");
  expect(saved?.groups?.map((group) => ({ id: group.id, quotaUsd: group.quotaUsd, usedQuotaUsd: group.usedQuotaUsd }))).toEqual([
    { id: "text-main", quotaUsd: 20, usedQuotaUsd: 2.5 },
    { id: "image-main", quotaUsd: 8, usedQuotaUsd: 1.25 }
  ]);
  expect(saved?.groups?.find((group) => group.id === "text-main")?.models).toEqual(["gpt-5.5", "gpt-5.6-sol"]);
  const profile = await store.exportProfile();
  expect(profile.providers[0]?.groups?.map((group) => group.keys)).toEqual([[], []]);
  expect(profile.providers[0]?.groups?.map((group) => group.quotaUsd)).toEqual([20, 8]);
  db.close();
});

test("ProviderStore rejects configured relay groups without an API key", async () => {
  const dir = tempDataDir("codex-ui-provider-missing-group-key-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });

  await expect(store.save({
    id: "missing-group-key",
    kind: "responsesRelay",
    name: "Missing Group Key",
    baseUrl: "https://relay.example/v1",
    nativeModels: ["gpt-5"],
    modelAliases: [],
    groups: [
      { id: "codex", name: "codex", groupRatio: 1, keys: [] },
      { id: "claude", name: "claude", groupRatio: 1, keys: ["sk-claude"] }
    ]
  })).rejects.toThrow("codex");
  expect(await store.get("missing-group-key")).toBeNull();
  db.close();
});

test("ProviderStore persists explicitly no-auth relay groups without keys", async () => {
  const dir = tempDataDir("codex-ui-provider-no-auth-group-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });

  const saved = await store.save({
    id: "omniroute-free",
    kind: "responsesRelay",
    name: "OmniRoute Free",
    baseUrl: "https://opencode.ai/zen/v1",
    nativeModels: ["big-pickle"],
    modelAliases: [],
    groups: [
      { id: "opencode-free", name: "OpenCode Free", authType: "none", keys: [], models: ["big-pickle"], groupRatio: 1 }
    ]
  });

  expect(saved).toMatchObject({
    id: "omniroute-free",
    name: "CodexUltraFree",
    serviceProvider: { id: "codex-ultra-free", name: "CodexUltraFree" }
  });
  expect(saved.groups?.[0]?.name).toBe("CodexUltraFree");
  expect(saved.groups?.[0]).toMatchObject({ authType: "none", keys: [], models: ["big-pickle"] });
  expect((await store.get("omniroute-free"))?.groups?.[0]?.authType).toBe("none");
  db.close();
});

test("ProviderStore keeps grouped topology for official-labelled providers", async () => {
  const dir = tempDataDir("codex-ui-provider-official-topology-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });

  const saved = await store.save({
    id: "official-openai",
    kind: "responsesRelay",
    name: "Official OpenAI",
    baseUrl: "https://api.openai.com/v1",
    nativeModels: ["gpt-5.5"],
    modelAliases: [],
    stationType: "official",
    channelMode: "advanced",
    quotaUsd: 20,
    capabilityCatalogUrl: "https://deepkey.top/api/pricing",
    groups: [{ id: "default", name: "default", groupRatio: 2, keys: ["sk-official-test"] }]
  });

  expect(saved).toMatchObject({
    stationType: "official",
    channelMode: "advanced",
    nativeModels: ["gpt-5.5"]
  });
  expect(saved.groups?.[0]?.keys).toEqual(["sk-official-test"]);
  expect(saved.quotaUsd).toBe(20);
  expect(saved.capabilityCatalogUrl).toBe("https://deepkey.top/api/pricing");
  expect((db.prepare("SELECT COUNT(*) AS count FROM relay_groups WHERE provider_id = ?").get("official-openai") as { count: number }).count).toBe(1);
  db.close();
});

test("ProviderStore rejects official-labelled providers without a configured group key", async () => {
  const dir = tempDataDir("codex-ui-provider-official-key-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });

  await expect(store.save({
    id: "official-openai",
    kind: "responsesRelay",
    name: "Official OpenAI",
    baseUrl: "https://api.openai.com/v1",
    nativeModels: ["gpt-5.5"],
    modelAliases: [],
    stationType: "official"
  })).rejects.toThrow("configured group");
  expect(await store.get("official-openai")).toBeNull();
  db.close();
});

test("ProviderStore mirrors relay groups into structured SQLite rows", async () => {
  const dir = tempDataDir("codex-ui-provider-group-table-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });

  await store.save({
    id: "new-api-like-relay",
    kind: "responsesRelay",
    name: "New API Like Relay",
    baseUrl: "https://relay.example/v1",
    nativeModels: ["gpt-5", "gpt-image-2"],
    modelAliases: [],
    groups: [
      {
        id: "vip",
        name: "vip",
        kind: "text",
        status: "enabled",
        groupRatio: 0.8,
        quotaUsd: 100,
        usedQuotaUsd: 7.5,
        priority: 10,
        weight: 30,
        keyMode: "random",
        models: ["gpt-5"],
        modelMapping: [{ from: "gpt-5", to: "gpt-5-chat-latest" }],
        statusCodeMapping: [{ from: 429, to: 503 }],
        tag: "paid",
        remark: "VIP text pool",
        autoBan: true,
        requestLimit: 120,
        requestIntervalSeconds: 60,
        contextWindow: 200000,
        claudeCodeHeadersEnabled: true,
        claudeCodeVersion: "2.1.222",
        keys: ["sk-vip"]
      }
    ]
  });

  const row = db
    .prepare("SELECT provider_id, group_id, group_ratio, weight, key_mode, models_json, model_mapping_json, status_code_mapping_json, tag, remark, auto_ban, request_limit, request_interval_seconds, context_window, claude_code_headers_enabled, claude_code_version FROM relay_groups WHERE provider_id = ? AND group_id = ?")
    .get("new-api-like-relay", "vip") as
    | {
        provider_id: string;
        group_id: string;
        group_ratio: number;
        weight: number;
        key_mode: string;
        models_json: string;
        model_mapping_json: string;
        status_code_mapping_json: string;
        tag: string;
        remark: string;
        auto_ban: number;
        request_limit: number;
        request_interval_seconds: number;
        context_window: number;
        claude_code_headers_enabled: number;
        claude_code_version: string;
      }
    | undefined;

  expect(row?.provider_id).toBe("new-api-like-relay");
  expect(row?.group_ratio).toBe(0.8);
  expect(row?.weight).toBe(30);
  expect(row?.key_mode).toBe("random");
  expect(row?.claude_code_headers_enabled).toBe(1);
  expect(row?.claude_code_version).toBe("2.1.222");
  expect(JSON.parse(row?.models_json ?? "[]")).toEqual(["gpt-5"]);
  expect(JSON.parse(row?.model_mapping_json ?? "[]")).toEqual([{ from: "gpt-5", to: "gpt-5-chat-latest" }]);
  expect(JSON.parse(row?.status_code_mapping_json ?? "[]")).toEqual([{ from: 429, to: 503 }]);
  expect(row?.tag).toBe("paid");
  expect(row?.remark).toBe("VIP text pool");
  expect(row?.auto_ban).toBe(1);
  expect(row?.request_limit).toBe(120);
  expect(row?.request_interval_seconds).toBe(60);
  expect(row?.context_window).toBe(200000);
  expect((await store.get("new-api-like-relay"))?.groups?.[0]?.contextWindow).toBe(200000);

  const reloaded = await store.get("new-api-like-relay");
  expect(reloaded?.groups?.[0]).toMatchObject({
    id: "vip",
    status: "enabled",
    weight: 30,
    keyMode: "random",
    models: ["gpt-5"],
    tag: "paid",
    remark: "VIP text pool",
    autoBan: true,
    requestLimit: 120,
    requestIntervalSeconds: 60
  });
  db.close();
});

test("ProviderStore allows saveTransient for omniroute-free charity provider with keyless cline-free and freebuff groups", async () => {
  const dir = tempDataDir("codex-ui-omniroute-free-");
  const db = new Database(join(dir, "codex-ui.sqlite3"));
  const store = new ProviderStore({ connection: db });

  const saved = await store.saveTransient({
    id: "omniroute-free",
    name: "CodexUltraFree",
    kind: "responsesRelay",
    serviceProvider: { id: "codex-ultra-free", name: "CodexUltraFree" },
    baseUrl: "https://opencode.ai/api/v1",
    stationType: "charity",
    channelMode: "fast",
    nativeModels: ["gpt-5", "claude-3-7-sonnet"],
    modelAliases: [],
    groups: [
      {
        id: "opencode-free",
        name: "CodexUltraFree",
        baseUrl: "https://opencode.ai/api/v1",
        kind: "text",
        status: "enabled",
        groupRatio: 0,
        models: ["gpt-5"],
        responseProtocol: "openai-response",
        responseProtocolMode: "fixed",
        authType: "none",
        credentialMode: "group",
        keyMode: "single",
        keys: []
      },
      {
        id: "cline-free",
        name: "ClineFree",
        baseUrl: "https://api.cline.bot/v1",
        kind: "text",
        status: "enabled",
        groupRatio: 0,
        models: ["claude-3-7-sonnet"],
        responseProtocol: "openai",
        responseProtocolMode: "fixed",
        authType: "bearer",
        credentialMode: "group",
        keyMode: "single",
        keys: []
      },
      {
        id: "freebuff",
        name: "Freebuff",
        baseUrl: "https://www.codebuff.com/api/v1",
        kind: "text",
        status: "enabled",
        groupRatio: 0,
        models: ["claude-3-7-sonnet"],
        responseProtocol: "openai",
        responseProtocolMode: "fixed",
        authType: "bearer",
        credentialMode: "group",
        keyMode: "single",
        keys: []
      },
      {
        id: "d2api",
        name: "D2API",
        baseUrl: "http://127.0.0.1:44090",
        kind: "text",
        status: "enabled",
        groupRatio: 0,
        models: ["gpt-5.4-mini"],
        responseProtocol: "openai",
        responseProtocolMode: "fixed",
        authType: "none",
        credentialMode: "group",
        keyMode: "single",
        keys: []
      }
    ]
  });

  expect(saved.id).toBe("omniroute-free");
  expect(saved.groups?.length).toBe(4);
  expect(saved.groups?.find((g) => g.id === "cline-free")?.responseProtocol).toBe("openai");
  expect(saved.groups?.find((g) => g.id === "freebuff")?.responseProtocol).toBe("openai");
  expect(saved.groups?.find((g) => g.id === "d2api")?.responseProtocol).toBe("openai");
  db.close();
});

