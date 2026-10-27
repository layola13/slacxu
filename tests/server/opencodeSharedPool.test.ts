import { beforeEach, describe, expect, test } from "bun:test";
import {
  __resetSharedOpencodePoolForTests,
  __seedSharedOpencodePoolForTests,
  __sharedOpencodePoolSnapshotForTests,
  buildOpencodeConfigContent,
  ensureOpencodeShutdownHooks,
  fingerprintOpencodeProcessConfig,
  opencodeSharedPoolIdleMs,
  releaseSharedOpencodeServer,
  sharedOpencodePoolRefCount,
  shutdownSharedOpencodePool,
  shutdownSharedOpencodePoolSync,
  type OpencodeProcessConfig,
} from "../../backends/opencode/src/runtime/opencodeCompatibleProcessManager.js";
import { createOpencodeProjectorContext } from "../../backends/opencode/src/runtime/opencodeCompatibleTurnProjector.js";
import { OpencodeCompatibleRuntime } from "../../backends/opencode/src/runtime/opencodeCompatibleRuntime.js";

function relay(models: string[], extra?: Record<string, unknown>) {
  return {
    providerId: "codex-relay",
    baseURL: "http://127.0.0.1:43121/api/relay-gateway/p/g/v1",
    apiKey: "k",
    models,
    ...extra,
  };
}

describe("opencode shared serve pool", () => {
  beforeEach(async () => {
    await __resetSharedOpencodePoolForTests();
  });
  test("fingerprint shares across cwd but isolates dangerous/relay/mcp/binary", () => {
    const base: OpencodeProcessConfig = {
      dangerous: false,
      relayProvider: relay(["gpt-5.6-luna"]),
    };
    const otherCwd: OpencodeProcessConfig = { ...base, cwd: "/tmp/other-cwd" };
    expect(fingerprintOpencodeProcessConfig(base)).toBe(fingerprintOpencodeProcessConfig(otherCwd));

    const dangerous: OpencodeProcessConfig = { ...base, dangerous: true };
    expect(fingerprintOpencodeProcessConfig(base)).not.toBe(fingerprintOpencodeProcessConfig(dangerous));

    const otherModel: OpencodeProcessConfig = {
      ...base,
      relayProvider: relay(["gpt-5.6-terra"]),
    };
    expect(fingerprintOpencodeProcessConfig(base)).not.toBe(fingerprintOpencodeProcessConfig(otherModel));

    const otherGroup: OpencodeProcessConfig = {
      ...base,
      relayProvider: { ...relay(["gpt-5.6-luna"]), baseURL: "http://127.0.0.1:43121/api/relay-gateway/p/other/v1" },
    };
    expect(fingerprintOpencodeProcessConfig(base)).not.toBe(fingerprintOpencodeProcessConfig(otherGroup));

    const withMcp: OpencodeProcessConfig = {
      ...base,
      saVmMcp: { scriptPath: "/tmp/sa-vm-mcp.mjs" },
    };
    expect(fingerprintOpencodeProcessConfig(base)).not.toBe(fingerprintOpencodeProcessConfig(withMcp));

    const otherBin: OpencodeProcessConfig = { ...base, binPath: "/tmp/other-opencode" };
    expect(fingerprintOpencodeProcessConfig(base)).not.toBe(fingerprintOpencodeProcessConfig(otherBin));

    const passThrough: OpencodeProcessConfig = { ...base, isolateThirdParty: true };
    expect(fingerprintOpencodeProcessConfig(base)).not.toBe(fingerprintOpencodeProcessConfig(passThrough));
  });

  test("release of an unknown manager stops it directly and pool stays empty", () => {
    let stopped = false;
    const fake = { stop: async () => { stopped = true; } } as any;
    const remaining = releaseSharedOpencodeServer("no-such-key", fake);
    expect(remaining).toBe(0);
    expect(stopped).toBe(true);
    expect(__sharedOpencodePoolSnapshotForTests()).toEqual([]);
  });

  test("release with stopWhenLast on unknown manager still stops it directly", () => {
    let stopped = false;
    const fake = { stop: async () => { stopped = true; } } as any;
    const remaining = releaseSharedOpencodeServer("no-such-key-either", fake, { stopWhenLast: true });
    expect(remaining).toBe(0);
    expect(stopped).toBe(true);
    expect(__sharedOpencodePoolSnapshotForTests()).toEqual([]);
  });

  test("pool idle window defaults to five minutes and is configurable", () => {
    const saved = process.env.CODEX_UI_OPENCODE_POOL_IDLE_MS;
    delete process.env.CODEX_UI_OPENCODE_POOL_IDLE_MS;
    try {
      expect(opencodeSharedPoolIdleMs()).toBe(5 * 60_000);
      process.env.CODEX_UI_OPENCODE_POOL_IDLE_MS = "0";
      expect(opencodeSharedPoolIdleMs()).toBe(0);
      process.env.CODEX_UI_OPENCODE_POOL_IDLE_MS = "abc";
      expect(opencodeSharedPoolIdleMs()).toBe(5 * 60_000);
    } finally {
      if (saved === undefined) delete process.env.CODEX_UI_OPENCODE_POOL_IDLE_MS;
      else process.env.CODEX_UI_OPENCODE_POOL_IDLE_MS = saved;
    }
  });

  function lunaRelay() {
    return {
      providerID: "codex-relay",
      baseURL: "http://127.0.0.1:43121/api/relay-gateway/p/g/v1",
      apiKey: "k",
      models: ["gpt-5.6-luna"],
      targetModel: "gpt-5.6-luna",
    };
  }

  function runtimeWithPooledRef() {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: "thread-pool-detach",
      cwd: "/tmp/cwd-a",
      sessionId: "session-pool-detach",
      dangerous: false,
      relay: lunaRelay(),
    });
    let stopped = false;
    const fake = { stop: async () => { stopped = true; }, off: () => {} } as any;
    (runtime as any).processManager = fake;
    (runtime as any).serverInfo = { url: "http://127.0.0.1:9", password: "p" };
    // 模拟已持有池引用：key 不在池中（过期/测试注入），detach 应走安全释放路径。
    (runtime as any).pooledServerKey = "stale-test-key";
    (runtime as any).spawnedFingerprint = fingerprintOpencodeProcessConfig((runtime as any).buildProcConfig());
    return { runtime, fake, wasStopped: () => stopped };
  }

  test("updateConfig keeps pooled server on cwd-only change, detaches on relay change", () => {
    const { runtime, fake, wasStopped } = runtimeWithPooledRef();
    try {
      runtime.updateConfig({ cwd: "/tmp/cwd-b" });
      expect((runtime as any).processManager).toBe(fake);
      expect(wasStopped()).toBe(false);

      runtime.updateConfig({
        relay: { ...lunaRelay(), models: ["gpt-5.6-terra"], targetModel: "gpt-5.6-terra" },
      });
      expect((runtime as any).processManager).toBeNull();
      expect(wasStopped()).toBe(true);
    } finally {
      runtime.stop();
    }
  });

  test("stop releases pooled reference without throwing and clears local state", () => {
    const { runtime, fake } = runtimeWithPooledRef();
    runtime.stop();
    expect((runtime as any).processManager).toBeNull();
    expect((runtime as any).serverInfo).toBeNull();
    expect((runtime as any).pooledServerKey).toBeNull();
    expect(fake).toBeDefined();
  });

  test("fingerprint never collides when OPENCODE_CONFIG_CONTENT differs (no stale MCP/relay reuse)", () => {
    // 池复用的正确性命脉：内容变了指纹必须变，否则新 turn 会跑在固化了旧 MCP/relay 的进程上。
    // 反方向允许过度隔离（指纹变内容不变），只测单向。
    const NO_RELAY_NO_MCP: OpencodeProcessConfig = { dangerous: false };
    const DANGEROUS: OpencodeProcessConfig = { dangerous: true };
    const RELAY_A: OpencodeProcessConfig = { dangerous: false, relayProvider: relay(["m-a"]) };
    const RELAY_B_MODELS: OpencodeProcessConfig = { dangerous: false, relayProvider: relay(["m-b"]) };
    const RELAY_C_KEY: OpencodeProcessConfig = {
      dangerous: false,
      relayProvider: { ...relay(["m-a"]), apiKey: "other-key" },
    };
    const MCP_ON: OpencodeProcessConfig = {
      dangerous: false,
      relayProvider: relay(["m-a"]),
      saVmMcp: { scriptPath: "/tmp/sa-vm-mcp.mjs" },
    };
    const MCP_ON_RELAY: OpencodeProcessConfig = {
      dangerous: false,
      relayProvider: relay(["m-a"]),
      saVmMcp: { scriptPath: "/tmp/sa-vm-mcp.mjs" },
    };
    const RELAY_A_WITH_MCP: OpencodeProcessConfig = { ...RELAY_A, saVmMcp: { scriptPath: "/tmp/sa-vm-mcp.mjs" } };
    const RELAY_A_PASS_THROUGH: OpencodeProcessConfig = {
      ...RELAY_A,
      saVmMcp: { scriptPath: "/tmp/sa-vm-mcp.mjs" },
      isolateThirdParty: true,
    };
    const variants: OpencodeProcessConfig[] = [
      NO_RELAY_NO_MCP, DANGEROUS, RELAY_A, RELAY_B_MODELS, RELAY_C_KEY, MCP_ON, MCP_ON_RELAY, RELAY_A_WITH_MCP,
      RELAY_A_PASS_THROUGH,
    ];
    const contentOf = (c: OpencodeProcessConfig): string =>
      buildOpencodeConfigContent(c.dangerous, c.relayProvider, c.saVmMcp, c.isolateThirdParty === true);
    for (let i = 0; i < variants.length; i += 1) {
      for (let j = i + 1; j < variants.length; j += 1) {
        const a = variants[i]!;
        const b = variants[j]!;
        if (contentOf(a) !== contentOf(b)) {
          expect(
            fingerprintOpencodeProcessConfig(a) === fingerprintOpencodeProcessConfig(b),
            `content differs but fingerprint collides: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
          ).toBe(false);
        }
      }
    }
    // cwd/port 只影响本进程寻址，不进内容也不进指纹：同配置不同 cwd 必须共享。
    expect(
      fingerprintOpencodeProcessConfig({ ...RELAY_A, cwd: "/tmp/a" }),
    ).toBe(fingerprintOpencodeProcessConfig({ ...RELAY_A, cwd: "/tmp/b", port: 41234 }));
  });

  function runningRuntimeWithSession(sessionId: string): { runtime: OpencodeCompatibleRuntime; notifications: any[] } {
    const runtime = new OpencodeCompatibleRuntime({
      threadId: `thread-${sessionId}`,
      cwd: "/tmp/cwd-a",
      sessionId,
      dangerous: false,
      relay: lunaRelay(),
      turnStallTimeoutMs: 0,
    });
    const ctx = createOpencodeProjectorContext(`thread-${sessionId}`, `turn-${sessionId}`);
    ctx.sessionId = sessionId;
    (runtime as any).ctx = ctx;
    (runtime as any).isTurnRunning = true;
    const notifications: any[] = [];
    runtime.on("notification", (n) => notifications.push(n));
    return { runtime, notifications };
  }

  function unattributedFatalError(id: string): any {
    return {
      id,
      type: "session.error",
      properties: { error: { message: "unauthorized: bad credentials" } },
    };
  }

  test("unattributed session.error fails a sole-holder turn (fail-fast, JEV-visible)", () => {
    // 非池化（独立进程）：无归属错误必然属于本会话，恢复 bea89c71 之前的 fail-fast。
    const { runtime, notifications } = runningRuntimeWithSession("session-sole");
    (runtime as any).handleSseEvent(unattributedFatalError("e-sole"));
    expect(notifications.some((n) => n.method === "turn/failed")).toBe(true);
    expect((runtime as any).isTurnRunning).toBe(false);
    runtime.stop();
  });

  test("unattributed session.error is dropped when the pool entry is shared (no cross-talk fail)", () => {
    const key = fingerprintOpencodeProcessConfig({
      dangerous: false,
      relayProvider: relay(["gpt-5.6-luna"]),
    });
    const fakeManager = { stop: async () => {}, off: () => {}, isRunning: true } as any;
    __seedSharedOpencodePoolForTests(
      key,
      fakeManager,
      { url: "http://127.0.0.1:9", hostname: "127.0.0.1", port: 9, password: "p" },
      2,
    );
    expect(sharedOpencodePoolRefCount(key)).toBe(2);
    const { runtime, notifications } = runningRuntimeWithSession("session-shared");
    (runtime as any).pooledServerKey = key;
    (runtime as any).processManager = fakeManager;
    (runtime as any).handleSseEvent(unattributedFatalError("e-shared"));
    expect(notifications.some((n) => n.method === "turn/failed")).toBe(false);
    expect((runtime as any).ctx.status).toBe("running");
    expect((runtime as any).isTurnRunning).toBe(true);
    runtime.stop();
  });

  test("unattributed session.error on an idle runtime changes nothing (no double-terminal)", () => {
    const { runtime, notifications } = runningRuntimeWithSession("session-idle-err");
    (runtime as any).ctx.status = "completed";
    (runtime as any).isTurnRunning = false;
    (runtime as any).handleSseEvent(unattributedFatalError("e-idle"));
    expect(notifications).toEqual([]);
    expect((runtime as any).ctx.status).toBe("completed");
    runtime.stop();
  });

  test("parent-exit shutdown clears the pool and tree-kills holders (no orphan serve)", () => {
    let treeKilled = 0;
    const fakeTree = { killTreeSync: () => { treeKilled += 1; }, stop: async () => {}, isRunning: true } as any;
    __seedSharedOpencodePoolForTests(
      "shutdown-sync-key",
      fakeTree,
      { url: "http://127.0.0.1:9", hostname: "127.0.0.1", port: 9, password: "p" },
      1,
    );
    expect(__sharedOpencodePoolSnapshotForTests().length).toBe(1);
    ensureOpencodeShutdownHooks();
    ensureOpencodeShutdownHooks();
    shutdownSharedOpencodePoolSync();
    expect(treeKilled).toBe(1);
    expect(__sharedOpencodePoolSnapshotForTests()).toEqual([]);
    // 空池上重复调用必须安全（exit 钩子可能与信号处理器各跑一次）。
    shutdownSharedOpencodePoolSync();
    expect(__sharedOpencodePoolSnapshotForTests()).toEqual([]);
  });

  test("async shutdown awaits stop() and clears the pool", async () => {
    let stopped = false;
    const fake = { stop: async () => { stopped = true; }, isRunning: true } as any;
    __seedSharedOpencodePoolForTests(
      "shutdown-async-key",
      fake,
      { url: "http://127.0.0.1:9", hostname: "127.0.0.1", port: 9, password: "p" },
      1,
    );
    await shutdownSharedOpencodePool();
    expect(stopped).toBe(true);
    expect(__sharedOpencodePoolSnapshotForTests()).toEqual([]);
  });
});
