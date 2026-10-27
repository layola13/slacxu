import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { EngineStatus, JsonRpcFailure, JsonRpcId, JsonValue } from "@codex-ui/shared";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import {
  VirtualCodexConfigStore,
  VirtualConfigCodexRuntimeClient,
  resolveVirtualCodexConfigPath,
  syncModelProvidersToUserConfig
} from "../../backends/codex/src/runtime/virtualCodexConfig.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("places the virtual config under CODEX_UI_DATA_DIR and ignores CODEX_HOME", () => {
  expect(resolveVirtualCodexConfigPath(
    { CODEX_UI_DATA_DIR: "D:\\ultra", CODEX_HOME: "C:\\Users\\zhan\\.codex" },
    "C:\\Users\\zhan"
  )).toBe("D:\\ultra\\virtual-codex\\config.toml");
});

test("reads an empty config without touching the real Codex config", async () => {
  const root = temporaryRoot();
  const realConfig = join(root, ".codex", "config.toml");
  const virtualConfig = join(root, ".codex-ultra", "virtual-codex", "config.toml");
  await mkdir(dirname(realConfig), { recursive: true });
  await writeFile(realConfig, "model = \"real-model\"\n");

  const store = new VirtualCodexConfigStore(virtualConfig, join(root, "missing-config.toml"));
  expect(await store.read()).toEqual({ config: {}, origins: {}, layers: null });
  expect(await readFile(realConfig, "utf8")).toBe("model = \"real-model\"\n");
  expect(existsSync(virtualConfig)).toBe(false);
});

test("migrates safe Multi Agent settings without pinning child model defaults", async () => {
  const root = temporaryRoot();
  const realConfig = join(root, ".codex", "config.toml");
  const virtualConfig = join(root, ".codex-ultra", "virtual-codex", "config.toml");
  await mkdir(dirname(realConfig), { recursive: true });
  await writeFile(realConfig, [
    "model = \"paid-model\"",
    "[features.multi_agent_v2]",
    "enabled = true",
    "max_concurrent_threads_per_session = 101",
    "expose_spawn_agent_model_overrides = true",
    "[agents]",
    "enabled = true",
    "max_concurrent_threads_per_session = 5",
    "default_subagent_model = \"gpt-5.6-luna\"",
    "default_subagent_reasoning_effort = \"max\"",
    "[model_providers.secret]",
    "base_url = \"https://secret.example/v1\"",
    "env_key = \"SECRET_API_KEY\"",
    ""
  ].join("\n"));

  const store = new VirtualCodexConfigStore(virtualConfig, realConfig);
  expect((await store.read() as any).config).toEqual({
    features: {
      multi_agent_v2: {
        enabled: true,
        max_concurrent_threads_per_session: 101,
        expose_spawn_agent_model_overrides: true
      }
    },
    agents: {
      enabled: true,
      max_concurrent_threads_per_session: 5
    }
  });
});

test("preserves virtual Multi Agent overrides during migration", async () => {
  const root = temporaryRoot();
  const realConfig = join(root, ".codex", "config.toml");
  const virtualConfig = join(root, ".codex-ultra", "virtual-codex", "config.toml");
  await mkdir(dirname(realConfig), { recursive: true });
  await mkdir(dirname(virtualConfig), { recursive: true });
  await writeFile(realConfig, [
    "[features.multi_agent_v2]",
    "enabled = true",
    "max_concurrent_threads_per_session = 101",
    "[agents]",
    "default_subagent_model = \"global-model\"",
    "default_subagent_reasoning_effort = \"max\"",
    ""
  ].join("\n"));
  await writeFile(virtualConfig, [
    "[features.multi_agent_v2]",
    "enabled = false",
    "max_concurrent_threads_per_session = 6",
    "[agents]",
    "default_subagent_model = \"virtual-model\"",
    ""
  ].join("\n"));

  const store = new VirtualCodexConfigStore(virtualConfig, realConfig);
  expect((await store.read() as any).config).toEqual({
    features: {
      multi_agent_v2: {
        enabled: false,
        max_concurrent_threads_per_session: 6
      }
    },
    agents: {
      default_subagent_model: "virtual-model"
    }
  });
});

test("removes legacy migrated child defaults once and preserves later explicit values", async () => {
  const root = temporaryRoot();
  const realConfig = join(root, ".codex", "config.toml");
  const virtualConfig = join(root, ".codex-ultra", "virtual-codex", "config.toml");
  await mkdir(dirname(realConfig), { recursive: true });
  await mkdir(dirname(virtualConfig), { recursive: true });
  await writeFile(realConfig, [
    "[agents]",
    "default_subagent_model = \"gpt-5.6-luna\"",
    "default_subagent_reasoning_effort = \"max\"",
    ""
  ].join("\n"));
  await writeFile(virtualConfig, [
    "[agents]",
    "default_subagent_model = \"gpt-5.6-luna\"",
    "default_subagent_reasoning_effort = \"max\"",
    ""
  ].join("\n"));

  const first = new VirtualCodexConfigStore(virtualConfig, realConfig);
  expect((await first.read() as any).config).toEqual({});

  await first.batchWrite({
    edits: [
      { keyPath: "agents.default_subagent_model", value: "gpt-5.6-luna", mergeStrategy: "replace" },
      { keyPath: "agents.default_subagent_reasoning_effort", value: "max", mergeStrategy: "replace" }
    ]
  });
  const restarted = new VirtualCodexConfigStore(virtualConfig, realConfig);
  expect((await restarted.read() as any).config).toEqual({
    agents: {
      default_subagent_model: "gpt-5.6-luna",
      default_subagent_reasoning_effort: "max"
    }
  });
});

test("removes legacy global model_context_window but preserves model and model_provider in shared config", async () => {
  const root = temporaryRoot();
  const virtualConfig = join(root, ".codex-ultra", "virtual-codex", "config.toml");
  await mkdir(dirname(virtualConfig), { recursive: true });
  await writeFile(virtualConfig, [
    "model = \"legacy-model\"",
    "model_provider = \"legacy-provider\"",
    "model_context_window = 1000000",
    "theme = \"dark\"",
    ""
  ].join("\n"));

  const store = new VirtualCodexConfigStore(virtualConfig, join(root, "missing-config.toml"));
  expect((await store.read() as any).config).toEqual({
    model: "legacy-model",
    model_provider: "legacy-provider",
    theme: "dark"
  });
  expect(await readFile(virtualConfig, "utf8")).not.toContain("model_context_window");

  await store.writeValue({
    keyPath: "model_context_window",
    value: 257_000,
    mergeStrategy: "replace"
  });
  await store.batchWrite({
    edits: [
      { keyPath: "model_context_window", value: 1_000_000, mergeStrategy: "replace" },
      { keyPath: "model", value: "current-model", mergeStrategy: "replace" },
      { keyPath: "model_provider", value: "current-provider", mergeStrategy: "replace" },
      { keyPath: "theme", value: "light", mergeStrategy: "replace" }
    ]
  });

  expect((await store.read() as any).config).toEqual({
    model: "current-model",
    model_provider: "current-provider",
    theme: "light"
  });
  expect(await readFile(virtualConfig, "utf8")).not.toContain("model_context_window");
});

test("writes a single value and reads it back with Codex-compatible metadata", async () => {
  const store = temporaryStore();
  const result = await store.writeValue({
    keyPath: "model_reasoning_effort",
    value: "xhigh",
    mergeStrategy: "replace"
  }) as Record<string, JsonValue>;

  expect(result.status).toBe("ok");
  expect(result.filePath).toBe(store.path);
  expect(typeof result.version).toBe("string");
  expect(await store.read({ includeLayers: true })).toEqual({
    config: { model_reasoning_effort: "xhigh" },
    origins: {
      model_reasoning_effort: {
        name: { type: "user", file: store.path, profile: null },
        version: result.version
      }
    },
    layers: [{
      name: { type: "user", file: store.path, profile: null },
      version: result.version,
      config: { model_reasoning_effort: "xhigh" },
      disabledReason: null
    }]
  });
});

test("applies batch edits with nested dotted keys", async () => {
  const store = temporaryStore();
  await store.batchWrite({
    edits: [
      { keyPath: "features.multi_agent_v2.enabled", value: true, mergeStrategy: "replace" },
      { keyPath: "features.multi_agent_v2.max_concurrent_threads_per_session", value: 6, mergeStrategy: "replace" },
      { keyPath: "agents.default_subagent_reasoning_effort", value: "high", mergeStrategy: "replace" }
    ]
  });

  expect((await store.read() as any).config).toEqual({
    features: {
      multi_agent_v2: {
        enabled: true,
        max_concurrent_threads_per_session: 6
      }
    },
    agents: {
      default_subagent_reasoning_effort: "high"
    }
  });
});

test("preserves quoted key segments for provider IDs containing dots", async () => {
  const store = temporaryStore();
  await store.writeValue({
    keyPath: 'model_providers."relay.example"',
    value: { name: "Relay Example", base_url: "http://127.0.0.1:43120" },
    mergeStrategy: "replace"
  });

  const read = await store.read() as any;
  expect(read.config.model_providers["relay.example"]).toEqual({
    name: "Relay Example",
    base_url: "http://127.0.0.1:43120"
  });
  const injected = await store.injectThreadConfig("thread/start", {}) as any;
  expect(injected.config).toEqual({
    'model_providers."relay.example".name': "Relay Example",
    'model_providers."relay.example".base_url': "http://127.0.0.1:43120"
  });
});

test("removes values with null replace edits", async () => {
  const store = temporaryStore();
  await store.batchWrite({
    edits: [
      { keyPath: "features.multi_agent_v2.enabled", value: true, mergeStrategy: "replace" },
      { keyPath: "theme", value: "dark", mergeStrategy: "replace" }
    ]
  });
  await store.batchWrite({
    edits: [
      { keyPath: "features.multi_agent_v2.enabled", value: null, mergeStrategy: "replace" },
      { keyPath: "theme", value: null, mergeStrategy: "replace" }
    ]
  });

  expect((await store.read() as any).config).toEqual({});
});

test("serializes concurrent writes across independent stores without losing updates", async () => {
  const store = temporaryStore();
  await Promise.all(Array.from({ length: 40 }, (_, index) => new VirtualCodexConfigStore(store.path).writeValue({
    keyPath: `test.values.value_${index}`,
    value: index,
    mergeStrategy: "replace"
  })));

  const values = (await store.read() as any).config.test.values;
  expect(Object.keys(values)).toHaveLength(40);
  for (let index = 0; index < 40; index += 1) {
    expect(values[`value_${index}`]).toBe(index);
  }
});

test("does not overwrite a damaged TOML file and leaves no temp file", async () => {
  const store = temporaryStore();
  await mkdir(dirname(store.path), { recursive: true });
  const damaged = "[features\nenabled = true\n";
  await writeFile(store.path, damaged);

  await expect(store.writeValue({
    keyPath: "theme",
    value: "dark",
    mergeStrategy: "replace"
  })).rejects.toThrow();

  expect(await readFile(store.path, "utf8")).toBe(damaged);
  expect(readdirSync(dirname(store.path)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
});

test("atomic writes leave only config.toml", async () => {
  const store = temporaryStore();
  await store.writeValue({ keyPath: "theme", value: "dark", mergeStrategy: "replace" });

  expect(readdirSync(dirname(store.path))).toEqual(["config.toml"]);
});

test("injects virtual config into start, resume, and fork while explicit config wins", async () => {
  const store = temporaryStore();
  await store.batchWrite({
    edits: [
      { keyPath: "custom.flag", value: false, mergeStrategy: "replace" },
      { keyPath: "features.multi_agent_v2.enabled", value: true, mergeStrategy: "replace" }
    ]
  });

  for (const method of ["thread/start", "thread/resume", "thread/fork"]) {
    const result = await store.injectThreadConfig(method, {
      threadId: "thread-1",
      config: { "custom.flag": true }
    }) as any;
    expect(result.config).toEqual({
      "features.multi_agent_v2.enabled": true,
      "custom.flag": true
    });
  }
});

test("thread config preserves valid context windows and removes invalid values", async () => {
  const root = temporaryRoot();
  const realConfig = join(root, ".codex", "config.toml");
  const virtualConfig = join(root, ".codex-ultra", "virtual-codex", "config.toml");
  await mkdir(dirname(realConfig), { recursive: true });
  await writeFile(realConfig, "model_context_window = 1000000\n");

  const store = new VirtualCodexConfigStore(virtualConfig, realConfig);
  const injected = await store.injectThreadConfig("thread/start", {
    model: "group-model",
    config: { model_context_window: 257_000 }
  }) as any;
  const emptyInjected = await store.injectThreadConfig("thread/start", {
    config: { model_context_window: "" }
  }) as any;
  const nullInjected = await store.injectThreadConfig("thread/start", {
    config: { model_context_window: null }
  }) as any;

  expect(injected.config.model_context_window).toBe(257_000);
  expect(emptyInjected.config).not.toHaveProperty("model_context_window");
  expect(nullInjected.config).not.toHaveProperty("model_context_window");
  expect(await readFile(realConfig, "utf8")).toBe("model_context_window = 1000000\n");
});

test("local runtime client intercepts config RPCs and leaves ordinary requests untouched", async () => {
  const store = temporaryStore();
  const inner = new RecordingClient();
  const client = new VirtualConfigCodexRuntimeClient(inner, store);

  await client.request("config/batchWrite", {
    edits: [{ keyPath: "custom.key", value: "virtual-val", mergeStrategy: "replace" }],
    filePath: "C:\\Users\\zhan\\.codex\\config.toml"
  });
  expect(inner.requests).toEqual([]);

  await client.request("thread/start", { customParam: "typed-val" });
  await client.request("account/read", { refreshToken: false });
  expect(inner.requests).toEqual([
    {
      method: "thread/start",
      params: { customParam: "typed-val", config: { "custom.key": "virtual-val" } },
      timeoutMs: undefined
    },
    {
      method: "account/read",
      params: { refreshToken: false },
      timeoutMs: undefined
    }
  ]);
});

test("virtual writes never modify a supplied real config path", async () => {
  const root = temporaryRoot();
  const realConfig = join(root, ".codex", "config.toml");
  const store = new VirtualCodexConfigStore(join(root, ".codex-ultra", "virtual-codex", "config.toml"));
  await mkdir(dirname(realConfig), { recursive: true });
  await writeFile(realConfig, "theme = \"real-theme\"\n");

  await store.batchWrite({
    filePath: realConfig,
    edits: [{ keyPath: "theme", value: "virtual-theme", mergeStrategy: "replace" }]
  });

  expect(await readFile(realConfig, "utf8")).toBe("theme = \"real-theme\"\n");
  expect((await store.read() as any).config.theme).toBe("virtual-theme");
});

test("syncModelProvidersToUserConfig synchronizes model_providers to user config", async () => {
  const root = temporaryRoot();
  const virtualConfig = join(root, ".codex-ultra", "virtual-codex", "config.toml");
  const userConfig = join(root, ".codex", "config.toml");
  await mkdir(dirname(virtualConfig), { recursive: true });
  await mkdir(dirname(userConfig), { recursive: true });

  await writeFile(virtualConfig, `
[model_providers.openai-1]
name = "opencodego"
base_url = "http://127.0.0.1:43110/api/relay-gateway/openai-1/v1"
`);

  await writeFile(userConfig, `
theme = "dark"

[plugins."browser@openai-bundled"]
enabled = true
`);

  await syncModelProvidersToUserConfig(virtualConfig, userConfig);

  const updatedUserConfig = await readFile(userConfig, "utf8");
  expect(updatedUserConfig).toContain("[model_providers.openai-1]");
  expect(updatedUserConfig).toContain('name = "opencodego"');
  expect(updatedUserConfig).toContain('theme = "dark"');
  expect(updatedUserConfig).toContain('enabled = true');
});

test("syncModelProvidersToUserConfig synchronizes activeSelection to user config", async () => {
  const root = temporaryRoot();
  const virtualConfig = join(root, ".codex-ultra", "virtual-codex", "config.toml");
  const userConfig = join(root, ".codex", "config.toml");
  await mkdir(dirname(virtualConfig), { recursive: true });
  await mkdir(dirname(userConfig), { recursive: true });

  await writeFile(virtualConfig, `
[model_providers.openai-1]
name = "opencodego"
base_url = "http://127.0.0.1:43110/api/relay-gateway/openai-1/v1"
`);

  await writeFile(userConfig, `
theme = "dark"
`);

  await syncModelProvidersToUserConfig(virtualConfig, userConfig, {
    modelProvider: "openai-1",
    model: "gpt-5.6-luna"
  });

  const updatedUserConfig = await readFile(userConfig, "utf8");
  expect(updatedUserConfig).toContain('model_provider = "openai-1"');
  expect(updatedUserConfig).toContain('model = "gpt-5.6-luna"');
});

class RecordingClient extends EventEmitter implements CodexRuntimeClient {
  public readonly requests: Array<{ method: string; params?: JsonValue; timeoutMs?: number }> = [];

  public getStatus(): EngineStatus {
    return { phase: "ready", transport: "stdio" };
  }

  public async start(): Promise<EngineStatus> {
    return this.getStatus();
  }

  public stop(): void {}

  public async restart(): Promise<EngineStatus> {
    return this.getStatus();
  }

  public async request(method: string, params?: JsonValue, timeoutMs?: number): Promise<JsonValue> {
    this.requests.push({ method, params, timeoutMs });
    return {};
  }

  public async notify(): Promise<void> {}

  public respond(_id: JsonRpcId, _result?: JsonValue, _error?: JsonRpcFailure["error"]): void {}
}

function temporaryStore(): VirtualCodexConfigStore {
  const root = temporaryRoot();
  return new VirtualCodexConfigStore(
    join(root, "virtual-codex", "config.toml"),
    join(root, "missing-config.toml")
  );
}

function temporaryRoot(): string {
  const root = join(tmpdir(), `codex-ultra-virtual-config-${randomUUID()}`);
  temporaryRoots.push(root);
  return root;
}
