import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LocalDatabase } from "../../apps/server/src/localDatabase.ts";
import { ThreadRuntimeMetadataStore } from "../../apps/server/src/threadRuntimeMetadataStore.ts";
import { writeCodexModelCatalog } from "../../apps/server/src/codexModelCatalog.ts";
import { resolveRelayGatewayTarget } from "../../apps/server/src/relayRuntimeSelection.ts";
import { VirtualCodexConfigStore } from "../../backends/codex/src/runtime/virtualCodexConfig.ts";
import type { ChannelGroupConfig, ProviderConfig } from "@codex-ui/shared";

describe("provider routing and catalog isolation", () => {
  test("writeCodexModelCatalog merges models from official ChatGPT and third-party relays with visibility list", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-ultra-multi-channel-"));
    try {
      const jijiGroup: ChannelGroupConfig = {
        id: "default",
        name: "default",
        groupRatio: 1,
        models: ["gpt-5.6-sol", "gpt-5.6-luna"],
        keys: ["sk-jiji"]
      };
      const officialGroup: ChannelGroupConfig = {
        id: "default",
        name: "default",
        groupRatio: 1,
        models: ["gpt-5-turbo", "o3-mini"],
        keys: []
      };
      const deepkeyGroup: ChannelGroupConfig = {
        id: "codex-team",
        name: "codex-team",
        groupRatio: 0.08,
        models: ["gpt-5.6-terra"],
        keys: ["sk-deepkey"]
      };

      writeCodexModelCatalog(home, jijiGroup, "gpt-5.6-sol");
      writeCodexModelCatalog(home, officialGroup, "gpt-5-turbo");
      const finalPath = writeCodexModelCatalog(home, deepkeyGroup, "gpt-5.6-terra");

      const catalog = JSON.parse(readFileSync(finalPath, "utf8"));
      const slugs = catalog.models.map((m: Record<string, unknown>) => m.slug);

      expect(slugs).toContain("gpt-5.6-sol");
      expect(slugs).toContain("gpt-5.6-luna");
      expect(slugs).toContain("gpt-5-turbo");
      expect(slugs).toContain("o3-mini");
      expect(slugs).toContain("gpt-5.6-terra");

      for (const model of catalog.models) {
        expect(model.visibility).toBe("list");
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("threadRuntimeMetadataStore keeps thread-scoped model and providerId strictly isolated", () => {
    const db = new LocalDatabase(":memory:");
    const store = new ThreadRuntimeMetadataStore(db);

    store.put("user-1", {
      threadId: "thread-relay-jiji",
      providerId: "jiji",
      groupId: "default",
      model: "gpt-5.6-sol",
      reasoningEffort: "high"
    });

    store.put("user-1", {
      threadId: "thread-official-chatgpt",
      providerId: "official-openai",
      groupId: "default",
      model: "gpt-5-turbo",
      reasoningEffort: "medium"
    });

    const thread1 = store.get("user-1", "thread-relay-jiji");
    const thread2 = store.get("user-1", "thread-official-chatgpt");

    expect(thread1?.providerId).toBe("jiji");
    expect(thread1?.model).toBe("gpt-5.6-sol");

    expect(thread2?.providerId).toBe("official-openai");
    expect(thread2?.model).toBe("gpt-5-turbo");

    const resolveModelProvider = (pid: string | null) =>
      pid === "official-openai" || pid === "chatgpt" || pid === "openai" ? "openai" : pid;

    expect(resolveModelProvider(thread1?.providerId ?? null)).toBe("jiji");
    expect(resolveModelProvider(thread2?.providerId ?? null)).toBe("openai");
  });

  test("official chatgpt fallback is strictly isolated to openai modelProvider", () => {
    const providers: ProviderConfig[] = [
      {
        id: "official-openai",
        name: "Official ChatGPT",
        kind: "chatgpt",
        groups: [{ id: "default", name: "default", groupRatio: 1, models: ["gpt-5-turbo"], keys: [] }]
      } as ProviderConfig,
      {
        id: "jiji",
        name: "吉吉 中转",
        kind: "custom",
        groups: [{ id: "default", name: "default", groupRatio: 1, models: ["gpt-5.6-sol"], keys: ["k"] }]
      } as ProviderConfig
    ];

    const findProvider = (modelProvider: string) =>
      providers.find((entry) => entry.id === modelProvider)
      ?? (modelProvider === "openai" ? providers.find((entry) => entry.kind === "chatgpt") : undefined);

    expect(findProvider("jiji")?.id).toBe("jiji");
    expect(findProvider("openai")?.id).toBe("official-openai");
    expect(findProvider("non-existent-relay")).toBeUndefined();
  });

  test("resolveRelayGatewayTarget uses official ChatGPT runtime selection when session-id matches official thread", () => {
    const db = new LocalDatabase(":memory:");
    const store = new ThreadRuntimeMetadataStore(db);

    store.put("local", {
      threadId: "thread-official-chatgpt",
      providerId: "official-openai",
      groupId: "default",
      model: "gpt-5-turbo",
      reasoningEffort: "medium"
    });

    const headers = new Headers();
    headers.set("session-id", "thread-official-chatgpt");

    const fallback = { providerId: "omniroute-free", groupId: "opencode" };
    const target = resolveRelayGatewayTarget(headers, fallback, (threadId) => store.get("local", threadId));

    // With shared routing restored, official-openai thread uses its stored selection
    expect(target.providerId).toBe("official-openai");
    expect(target.groupId).toBe("default");
    expect(target.threadId).toBe("thread-official-chatgpt");
  });

  test("VirtualCodexConfigStore.injectThreadConfig strips legacy free relay model_provider and carries explicit thread selection", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ultra-virtual-config-"));
    try {
      const virtualConfig = join(root, ".codex-ultra", "virtual-codex", "config.toml");
      const realConfig = join(root, ".codex", "config.toml");
      await mkdir(dirname(virtualConfig), { recursive: true });
      await writeFile(virtualConfig, [
        'model_provider = "omniroute-free"',
        'model = "muse-spark-1.3-contributor-free"',
        '[features.multi_agent_v2]',
        'enabled = true',
        ''
      ].join("\n"));

      const store = new VirtualCodexConfigStore(virtualConfig, realConfig);

      // Thread 2 (official ChatGPT) starts with modelProvider: "openai", model: "gpt-5-turbo"
      const injected = await store.injectThreadConfig("thread/start", {
        model: "gpt-5-turbo",
        modelProvider: "openai"
      }) as any;

      expect(injected.modelProvider).toBe("openai");
      expect(injected.config.model_provider).toBe("openai");
      expect(injected.config.model).toBe("gpt-5-turbo");
      expect(injected.config["features.multi_agent_v2.enabled"]).toBe(true);
      expect(injected.config.model_provider).not.toBe("omniroute-free");
      expect(injected.config.model).not.toBe("muse-spark-1.3-contributor-free");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("two conversations (free relay vs official ChatGPT) maintain complete provider separation", () => {
    const db = new LocalDatabase(":memory:");
    const store = new ThreadRuntimeMetadataStore(db);

    // Conversation 1: Free relay
    const thread1Id = "thread-free-omniroute";
    store.put("local", {
      threadId: thread1Id,
      providerId: "omniroute-free",
      groupId: "opencode",
      model: "muse-spark-1.3-contributor-free",
      reasoningEffort: "medium"
    });

    // Conversation 2: Official ChatGPT
    const thread2Id = "thread-official-chatgpt";
    store.put("local", {
      threadId: thread2Id,
      providerId: "official-openai",
      groupId: "default",
      model: "gpt-5-turbo",
      reasoningEffort: "high"
    });

    const thread1 = store.get("local", thread1Id);
    const thread2 = store.get("local", thread2Id);

    expect(thread1?.providerId).toBe("omniroute-free");
    expect(thread1?.groupId).toBe("opencode");
    expect(thread1?.model).toBe("muse-spark-1.3-contributor-free");

    expect(thread2?.providerId).toBe("official-openai");
    expect(thread2?.groupId).toBe("default");
    expect(thread2?.model).toBe("gpt-5-turbo");

    // Thread 1 request to relay gateway resolves to free provider
    const headers1 = new Headers({ "session-id": thread1Id });
    const target1 = resolveRelayGatewayTarget(headers1, { providerId: "fallback", groupId: "fallback" }, (tid) => store.get("local", tid));
    expect(target1.providerId).toBe("omniroute-free");
    expect(target1.groupId).toBe("opencode");

    // Thread 2 request to relay gateway resolves to its stored official-openai selection
    const headers2 = new Headers({ "session-id": thread2Id });
    const target2 = resolveRelayGatewayTarget(headers2, { providerId: "fallback", groupId: "fallback" }, (tid) => store.get("local", tid));
    expect(target2.providerId).toBe("official-openai");
    expect(target2.groupId).toBe("default");
  });
});

