import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";
import { ThreadRuntimeMetadataStore } from "../../apps/server/src/threadRuntimeMetadataStore";

test("persists runtime metadata per owner and updates the actual turn selection", () => {
  const database = new Database(":memory:");
  const store = new ThreadRuntimeMetadataStore({ connection: database });

  const created = store.put("user-a", {
    threadId: "thread-1",
    providerId: "deepkey",
    groupId: "group-fast",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    permission: "dangerBypass",
    cwd: "E:\\projects\\primary",
    additionalRoots: ["E:\\projects\\shared", "D:\\data"],
    workspaceFilePath: "E:\\projects\\primary\\cxu.code-workspace",
    agents: { mode: "enabled", childCount: 5, model: "gpt-5.6-terra", reasoningEffort: "max" }
  });
  expect(created).toMatchObject({
    threadId: "thread-1",
    providerId: "deepkey",
    groupId: "group-fast",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    permission: "dangerBypass",
    agents: { mode: "enabled", childCount: 5, model: "gpt-5.6-terra", reasoningEffort: "max" }
  });
  expect(created.cwd?.toLowerCase().replace(/\\/g, "/")).toBe("e:/projects/primary");
  expect(created.additionalRoots?.map((r) => r.toLowerCase().replace(/\\/g, "/"))).toEqual(["e:/projects/shared", "d:/data"]);
  expect(created.workspaceFilePath?.toLowerCase().replace(/\\/g, "/")).toBe("e:/projects/primary/cxu.code-workspace");
  expect(created.freeAutoCompactEnabled).toBe(false);
  expect(created.freeAutoCompactThreshold).toBe(80);
  expect(store.get("user-b", "thread-1")).toBeNull();

  const updated = store.put("user-a", {
    threadId: "thread-1",
    providerId: "deepkey",
    groupId: "group-stable",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    permission: "fullAsk"
  });
  expect(updated).toMatchObject({
    groupId: "group-stable",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    permission: "fullAsk"
  });
  expect(updated?.cwd?.toLowerCase().replace(/\\/g, "/")).toBe("e:/projects/primary");
  expect(updated?.additionalRoots?.map((r) => r.toLowerCase().replace(/\\/g, "/"))).toEqual(["e:/projects/shared", "d:/data"]);
  expect(updated.createdAt).toBe(created.createdAt);
  expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  database.close();
});

test("persists free auto-compaction preferences per conversation and clamps thresholds", () => {
  const database = new Database(":memory:");
  const store = new ThreadRuntimeMetadataStore({ connection: database });
  const base = {
    threadId: "thread-free-compact",
    providerId: "deepkey",
    groupId: "codex-team",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    permission: "dangerBypass" as const
  };

  expect(store.put("user-a", {
    ...base,
    freeAutoCompactEnabled: true,
    freeAutoCompactThreshold: 12
  })).toMatchObject({
    freeAutoCompactEnabled: true,
    freeAutoCompactThreshold: 50
  });

  expect(store.put("user-a", {
    ...base,
    freeAutoCompactThreshold: 120
  })).toMatchObject({
    freeAutoCompactEnabled: true,
    freeAutoCompactThreshold: 95
  });

  expect(store.put("user-a", {
    ...base,
    freeAutoCompactProviderId: "relay-compact",
    freeAutoCompactGroupId: "compact-group",
    freeAutoCompactModel: "mimo-v2.5-free"
  })).toMatchObject({
    freeAutoCompactProviderId: "relay-compact",
    freeAutoCompactGroupId: "compact-group",
    freeAutoCompactModel: "mimo-v2.5-free"
  });

  expect(store.put("user-a", {
    ...base,
    freeAutoCompactModel: null
  }).freeAutoCompactModel).toBeNull();

  expect(store.put("user-b", {
    ...base,
    freeAutoCompactEnabled: false,
    freeAutoCompactThreshold: 72
  })).toMatchObject({
    freeAutoCompactEnabled: false,
    freeAutoCompactThreshold: 72
  });
  expect(store.get("user-a", base.threadId)).toMatchObject({
    freeAutoCompactEnabled: true,
    freeAutoCompactThreshold: 95,
    freeAutoCompactProviderId: "relay-compact",
    freeAutoCompactGroupId: "compact-group",
    freeAutoCompactModel: null
  });
  database.close();
});

test("restores multiple SSH writable roots after reopening the metadata store", () => {
  const database = new Database(":memory:");
  const initialStore = new ThreadRuntimeMetadataStore({ connection: database });
  initialStore.put("user-a", {
    threadId: "ssh-thread",
    providerId: "deepkey",
    groupId: "codex-team",
    model: "gpt-5.6-terra",
    reasoningEffort: "high",
    permission: "dangerBypass",
    cwd: "/home/vscode/project",
    additionalRoots: ["/home/vscode/shared", "/srv/data", "/opt/tools"]
  });

  const reopenedStore = new ThreadRuntimeMetadataStore({ connection: database });
  expect(reopenedStore.get("user-a", "ssh-thread")).toMatchObject({
    cwd: "/home/vscode/project",
    additionalRoots: ["/home/vscode/shared", "/srv/data", "/opt/tools"]
  });
  database.close();
});

test("persists fast and plan modes independently per thread", () => {
  const database = new Database(":memory:");
  const store = new ThreadRuntimeMetadataStore({ connection: database });
  const base = {
    providerId: "relay",
    groupId: "group",
    model: "model",
    reasoningEffort: "high",
    permission: "dangerBypass" as const
  };

  store.put("user-a", { ...base, threadId: "thread-a", fastModeEnabled: true, planModeEnabled: false });
  store.put("user-a", { ...base, threadId: "thread-b", fastModeEnabled: false, planModeEnabled: true });

  expect(store.get("user-a", "thread-a")).toMatchObject({ fastModeEnabled: true, planModeEnabled: false });
  expect(store.get("user-a", "thread-b")).toMatchObject({ fastModeEnabled: false, planModeEnabled: true });
  store.put("user-a", { ...base, threadId: "thread-a", model: "new-model" });
  expect(store.get("user-a", "thread-a")).toMatchObject({ model: "new-model", fastModeEnabled: true, planModeEnabled: false });
  expect(store.get("user-a", "thread-b")).toMatchObject({ model: "model", fastModeEnabled: false, planModeEnabled: true });
  database.close();
});

test("persists strict SA-VM mode independently per thread", () => {
  const database = new Database(":memory:");
  const store = new ThreadRuntimeMetadataStore({ connection: database });
  const base = {
    providerId: "deepkey",
    groupId: "codex-team",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    permission: "workspaceAsk" as const
  };
  expect(store.put("user-a", {
    ...base,
    threadId: "vm-on",
    vmEnabled: true,
    vmPolicy: { fs: { read: ["$PROJECT/input/**"], write: ["$PROJECT/output/**"], delete: "rename", backupDir: "$PROJECT/.trash/**" }, http: { allow: [{ host: "api.example.com", methods: ["GET", "POST"] }] } }
  })).toMatchObject({ vmEnabled: true, vmPolicy: { fs: { delete: "rename" }, http: { allow: [{ host: "api.example.com" }] } } });
  expect(store.put("user-a", { ...base, threadId: "vm-off", vmEnabled: false }).vmEnabled).toBe(false);
  expect(store.get("user-a", "vm-on")?.vmEnabled).toBe(true);
  expect(store.get("user-a", "vm-on")?.vmPolicy?.fs?.read).toEqual(["$PROJECT/input/**"]);
  expect(store.get("user-b", "vm-on")).toBeNull();
  database.close();
});

test("writes and retains a default SA-VM policy when enabled without one", () => {
  const database = new Database(":memory:");
  const store = new ThreadRuntimeMetadataStore({ connection: database });
  const base = {
    providerId: "deepkey",
    groupId: "codex-team",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    permission: "workspaceAsk" as const
  };

  const enabled = store.put("user-a", { ...base, threadId: "vm-default", vmEnabled: true });
  expect(enabled.vmEnabled).toBe(true);
  expect(enabled.vmPolicy).toEqual(createDefaultSaVmPolicyConfig());
  expect(store.get("user-a", "vm-default")?.vmPolicy).toEqual(createDefaultSaVmPolicyConfig());

  const disabled = store.put("user-a", { ...base, threadId: "vm-default", vmEnabled: false });
  expect(disabled.vmEnabled).toBe(false);
  expect(disabled.vmPolicy).toEqual(createDefaultSaVmPolicyConfig());

  const customPolicy = {
    fs: { read: ["$PROJECT/input/**"] },
    http: { allow: [] },
    process: {
      bun: true,
      bunProfiles: ["web-typecheck", "server-test-file"] as any
    },
    contextSavings: {
      locateBeforeRead: true,
      maxReadFileBytes: 30000,
      slimRunnerOutput: true
    }
  };
  const customized = store.put("user-a", {
    ...base,
    threadId: "vm-default",
    vmEnabled: true,
    vmPolicy: customPolicy
  });
  expect(customized.vmPolicy).toEqual(customPolicy);
  expect(store.get("user-a", "vm-default")?.vmPolicy?.process?.bun).toBe(true);
  expect(store.get("user-a", "vm-default")?.vmPolicy?.contextSavings?.locateBeforeRead).toBe(true);
  database.close();
});

test("repairs the effective policy for a legacy enabled VM row", () => {
  const database = new Database(":memory:");
  const store = new ThreadRuntimeMetadataStore({ connection: database });
  store.put("user-a", {
    threadId: "legacy-vm",
    providerId: "deepkey",
    groupId: "codex-team",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    permission: "workspaceAsk"
  });
  database.prepare("UPDATE thread_runtime_metadata SET vm_enabled = 1, vm_policy_json = NULL WHERE owner_id = ? AND thread_id = ?").run("user-a", "legacy-vm");
  const reopenedStore = new ThreadRuntimeMetadataStore({ connection: database });
  expect(reopenedStore.get("user-a", "legacy-vm")?.vmPolicy).toEqual(createDefaultSaVmPolicyConfig());
  expect(database.prepare("SELECT vm_policy_json FROM thread_runtime_metadata WHERE owner_id = ? AND thread_id = ?").get("user-a", "legacy-vm")).toEqual({
    vm_policy_json: JSON.stringify(createDefaultSaVmPolicyConfig())
  });
  database.close();
});

test("updates workspace fields without overwriting a newer runtime selection", () => {
  const database = new Database(":memory:");
  const store = new ThreadRuntimeMetadataStore({ connection: database });
  store.put("user-a", {
    threadId: "thread-race",
    providerId: "relay-new",
    groupId: "group-new",
    model: "model-new",
    reasoningEffort: "max",
    permission: "dangerBypass"
  });

  expect(store.updateWorkspace("user-a", {
    threadId: "thread-race",
    cwd: "/work/main",
    additionalRoots: ["/work/shared", "/data"]
  })).toMatchObject({
    providerId: "relay-new",
    groupId: "group-new",
    model: "model-new",
    reasoningEffort: "max",
    cwd: "/work/main",
    additionalRoots: ["/work/shared", "/data"]
  });
  database.close();
});

test("migrates legacy runtime metadata without inventing a lower permission", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE thread_runtime_metadata (
      owner_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      provider_id TEXT,
      group_id TEXT,
      model TEXT NOT NULL DEFAULT '',
      reasoning_effort TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, thread_id)
    );
    INSERT INTO thread_runtime_metadata (
      owner_id, thread_id, provider_id, group_id, model, reasoning_effort, created_at, updated_at
    ) VALUES ('user-a', 'legacy-thread', 'deepkey', 'codex-team', 'gpt-5.5', 'high', 1, 1);
  `);

  const store = new ThreadRuntimeMetadataStore({ connection: database });
  expect(store.get("user-a", "legacy-thread")).toMatchObject({
    threadId: "legacy-thread",
    model: "gpt-5.5",
    permission: undefined
  });

  expect(store.put("user-a", {
    threadId: "legacy-thread",
    providerId: "deepkey",
    groupId: "codex-team",
    model: "gpt-5.5",
    reasoningEffort: "high",
    permission: "dangerBypass"
  }).permission).toBe("dangerBypass");
  database.close();
});

test("ignores unversioned permissions written by the legacy default", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE thread_runtime_metadata (
      owner_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      provider_id TEXT,
      group_id TEXT,
      model TEXT NOT NULL DEFAULT '',
      reasoning_effort TEXT NOT NULL DEFAULT '',
      permission TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, thread_id)
    );
    INSERT INTO thread_runtime_metadata (
      owner_id, thread_id, provider_id, group_id, model, reasoning_effort, permission, created_at, updated_at
    ) VALUES ('local', 'polluted-thread', 'deepkey', 'codex-team', 'gpt-5.6-sol', 'medium', 'workspaceAsk', 1, 1);
  `);

  const store = new ThreadRuntimeMetadataStore({ connection: database });
  expect(store.get("local", "polluted-thread")?.permission).toBeUndefined();

  expect(store.put("local", {
    threadId: "polluted-thread",
    providerId: "deepkey",
    groupId: "codex-team",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    permission: "dangerBypass"
  }).permission).toBe("dangerBypass");
  database.close();
});

test("partial saves merge with the stored per-conversation relay instead of wiping it", () => {
  const database = new Database(":memory:");
  const store = new ThreadRuntimeMetadataStore({ connection: database });
  store.put("user-a", {
    threadId: "thread-relay",
    providerId: "opencode-local",
    groupId: "default",
    model: "opencode/muse-spark-1.3",
    reasoningEffort: "medium",
    permission: "dangerBypass"
  });

  // A permission-only or route-omitted save must keep the relay/model.
  expect(store.put("user-a", {
    threadId: "thread-relay",
    permission: "fullAsk"
  })).toMatchObject({
    providerId: "opencode-local",
    groupId: "default",
    model: "opencode/muse-spark-1.3",
    permission: "fullAsk"
  });

  // Explicit null/empty route values also preserve the stored route.
  expect(store.put("user-a", {
    threadId: "thread-relay",
    providerId: null,
    groupId: null,
    model: "",
    reasoningEffort: "",
    permission: "fullAsk"
  })).toMatchObject({
    providerId: "opencode-local",
    groupId: "default",
    model: "opencode/muse-spark-1.3"
  });

  // A non-empty route still replaces the stored one.
  expect(store.put("user-a", {
    threadId: "thread-relay",
    providerId: "deepkey",
    groupId: "codex-team",
    model: "gpt-5.6-terra",
    reasoningEffort: "high",
    permission: "fullAsk"
  })).toMatchObject({
    providerId: "deepkey",
    groupId: "codex-team",
    model: "gpt-5.6-terra",
    reasoningEffort: "high"
  });
  database.close();
});

test("compactMode radio migrates legacy boolean with write-through", () => {
  const database = new Database(":memory:");
  const store = new ThreadRuntimeMetadataStore({ connection: database });
  const base = {
    threadId: "thread-compact-mode",
    providerId: "deepkey",
    groupId: "codex-team",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    permission: "dangerBypass" as const
  };

  // New thread defaults to off.
  expect(store.put("user-a", { ...base })).toMatchObject({ compactMode: "off", jevCompressThreshold: 85 });
  // Legacy boolean maps to cheap/off and writes through.
  expect(store.put("user-a", { ...base, freeAutoCompactEnabled: true })).toMatchObject({
    compactMode: "cheap",
    freeAutoCompactEnabled: true
  });
  // Explicit mode wins and syncs the legacy boolean for old gates.
  expect(store.put("user-a", { ...base, compactMode: "jev-sub" })).toMatchObject({
    compactMode: "jev-sub",
    freeAutoCompactEnabled: false
  });
  expect(store.put("user-a", { ...base, compactMode: "jev-token", jevCompressThreshold: 30 })).toMatchObject({
    compactMode: "jev-token",
    jevCompressThreshold: 50
  });
  // Illegal mode falls back to off; legacy switch still overrides back to cheap.
  expect(store.put("user-a", { ...base, compactMode: "turbo" as any })).toMatchObject({ compactMode: "off" });
  expect(store.put("user-a", { ...base, freeAutoCompactEnabled: true })).toMatchObject({
    compactMode: "cheap",
    freeAutoCompactEnabled: true
  });
  database.close();
});

test("persists the opencode-v2 cli backend identity verbatim", () => {
  const database = new Database(":memory:");
  const store = new ThreadRuntimeMetadataStore({ connection: database });

  const created = store.put("user-a", {
    threadId: "thread-v2",
    providerId: "opencode-local",
    groupId: "default",
    model: "opencode/big-pickle",
    cliBackend: "opencode-v2"
  });
  // The row mapper must not collapse v2 into the codex default: bridge
  // routing resolves a persisted thread's backend from this value.
  expect(created?.cliBackend).toBe("opencode-v2");
  expect(store.get("user-a", "thread-v2")?.cliBackend).toBe("opencode-v2");
  expect(store.getAny("thread-v2")?.cliBackend).toBe("opencode-v2");

  const v1 = store.put("user-a", {
    threadId: "thread-v1",
    providerId: "opencode-local",
    groupId: "default",
    model: "opencode/big-pickle",
    cliBackend: "opencode"
  });
  expect(v1?.cliBackend).toBe("opencode");
  expect(store.getAny("thread-v1")?.cliBackend).toBe("opencode");
  database.close();
});
