import { describe, expect, test } from "bun:test";
import { AgyBridge, resolveAgyWorkspaceDirs, type AgySessionSnapshot } from "../../backends/agy/src/runtime/agyBridge";
import type { JsonRpcNotification } from "@codex-ui/shared";

describe("AgyBridge", () => {
  test("initial status is ready or stdio", () => {
    const bridge = new AgyBridge();
    const status = bridge.getStatus();
    expect(status.transport).toBe("stdio");
  });

  test("handles thread/start request", async () => {
    const bridge = new AgyBridge();
    const result = await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-2.5-pro",
      providerId: "agy-official",
    }) as any;

    expect(result.thread).toBeDefined();
    expect(result.thread.cliBackend).toBe("agy");
    expect(typeof result.thread.id).toBe("string");
  });

  test("emits turn/started and userMessage item/completed on turn/start", async () => {
    const bridge = new AgyBridge();
    const notifications: JsonRpcNotification[] = [];
    bridge.on("notification", (notif) => {
      notifications.push(notif);
    });

    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-2.5-pro",
    }) as any;
    const threadId = startRes.thread.id;

    const turnRes = await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Hello Antigravity!" }],
    }) as any;

    expect(turnRes.turn).toBeDefined();
    expect(typeof turnRes.turn.id).toBe("string");
    expect(turnRes.turn.status).toBe("in_progress");

    // Notifications must contain turn/started and item/completed (userMessage)
    const started = notifications.find((n) => n.method === "turn/started");
    expect(started).toBeDefined();
    expect((started?.params as any)?.threadId).toBe(threadId);

    const userMessage = notifications.find((n) => n.method === "item/completed");
    expect(userMessage).toBeDefined();
    const item = (userMessage?.params as any)?.item;
    expect(item?.type).toBe("userMessage");
    expect(item?.text).toBe("Hello Antigravity!");
    expect(item?.role).toBe("user");
    expect(item?.status).toBe("completed");

    bridge.stop();
  });

  test("handles thread/read request with turns and items", async () => {
    const bridge = new AgyBridge();
    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-2.5-pro",
    }) as any;
    const threadId = startRes.thread.id;

    await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Test turn for read" }],
    });

    const readRes = await bridge.request("thread/read", { threadId, includeTurns: true }) as any;
    expect(readRes.thread).toBeDefined();
    expect(readRes.thread.id).toBe(threadId);
    expect(readRes.thread.cliBackend).toBe("agy");
    expect(readRes.thread.turns.length).toBe(1);
    expect(readRes.items.length).toBeGreaterThanOrEqual(1);

    bridge.stop();
  });

  test("restores session from loadSnapshot callback on thread/read", async () => {
    const snapshots = new Map<string, AgySessionSnapshot>();
    const bridge = new AgyBridge({
      onSnapshot: (snap) => {
        snapshots.set(snap.threadId, snap);
      },
      loadSnapshot: (threadId) => snapshots.get(threadId) ?? null,
    });

    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-2.5-pro",
    }) as any;
    const threadId = startRes.thread.id;

    await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Persistent message" }],
    });

    expect(snapshots.has(threadId)).toBe(true);

    // Create a new bridge instance simulating server restart
    const newBridge = new AgyBridge({
      loadSnapshot: (id) => snapshots.get(id) ?? null,
    });

    const readRes = await newBridge.request("thread/read", { threadId, includeTurns: true }) as any;
    expect(readRes.thread).toBeDefined();
    expect(readRes.thread.id).toBe(threadId);
    expect(readRes.thread.preview).toBe("Persistent message");
    expect(readRes.thread.turns.length).toBe(1);
    expect(readRes.items.length).toBe(1);

    newBridge.stop();
    bridge.stop();
  });

  test("handles thread/compact/start slash command", async () => {
    const bridge = new AgyBridge();
    const notifications: JsonRpcNotification[] = [];
    bridge.on("notification", (n) => notifications.push(n));

    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-2.5-pro",
    }) as any;
    const threadId = startRes.thread.id;

    const compactRes = await bridge.request("thread/compact/start", { threadId }) as any;
    expect(compactRes.turn).toBeDefined();
    expect(compactRes.turn.status).toBe("inProgress");

    const started = notifications.find((n) => n.method === "item/started");
    expect(started).toBeDefined();
    expect((started?.params as any)?.item?.type).toBe("compaction");

    bridge.stop();
  });

  test("handles plan mode on turn/start", async () => {
    const bridge = new AgyBridge();
    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-2.5-pro",
    }) as any;
    const threadId = startRes.thread.id;

    const turnRes = await bridge.request("turn/start", {
      threadId,
      collaborationMode: "plan",
      input: [{ type: "text", text: "Create a plan" }],
    }) as any;

    expect(turnRes.turn).toBeDefined();
    expect(turnRes.turn.status).toBe("in_progress");

    bridge.stop();
  });

  test("handles thread/goal/set and thread/goal/get", async () => {
    const bridge = new AgyBridge();
    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-2.5-pro",
    }) as any;
    const threadId = startRes.thread.id;

    const setRes = await bridge.request("thread/goal/set", {
      threadId,
      objective: "Build a rocket",
    }) as any;
    expect(setRes.ok).toBe(true);
    expect(setRes.goal.objective).toBe("Build a rocket");
    expect(setRes.goal.status).toBe("active");

    const getRes = await bridge.request("thread/goal/get", { threadId }) as any;
    expect(getRes.goal.objective).toBe("Build a rocket");
    expect(getRes.goal.status).toBe("active");

    bridge.stop();
  });

  test("resolveAgyWorkspaceDirs extracts runtimeWorkspaceRoots, workspace.cwd and cwd", () => {
    const fromRoots = resolveAgyWorkspaceDirs({
      runtimeWorkspaceRoots: ["D:\\projects\\codex-ultra", "D:\\projects\\sub-root"],
      cwd: ""
    });
    expect(fromRoots.cwd).toBe("D:\\projects\\codex-ultra");
    expect(fromRoots.addDirs).toEqual(["D:\\projects\\codex-ultra", "D:\\projects\\sub-root"]);

    const fromWorkspaceObj = resolveAgyWorkspaceDirs({
      workspace: { cwd: "E:\\projects\\my-workspace" },
      cwd: ""
    });
    expect(fromWorkspaceObj.cwd).toBe("E:\\projects\\my-workspace");
    expect(fromWorkspaceObj.addDirs).toEqual(["E:\\projects\\my-workspace"]);

    const fallback = resolveAgyWorkspaceDirs({});
    expect(fallback.cwd).toBe(process.cwd());
    expect(fallback.addDirs).toEqual([process.cwd()]);
  });

  test("thread/start preserves workspace addDirs", async () => {
    let savedSnapshot: AgySessionSnapshot | null = null;
    const bridge = new AgyBridge({
      onSnapshot: (snap) => {
        savedSnapshot = snap;
      }
    });

    const res = await bridge.request("thread/start", {
      runtimeWorkspaceRoots: ["D:\\projects\\codex-ultra"],
      cwd: "D:\\projects\\codex-ultra",
      model: "gemini-3.8-flash-high"
    }) as any;

    expect(res.thread.cwd).toBe("D:\\projects\\codex-ultra");
    expect(savedSnapshot).toBeDefined();
    expect((savedSnapshot as any)?.addDirs).toContain("D:\\projects\\codex-ultra");

    bridge.stop();
  });

  test("hasSession returns true for active sessions", async () => {
    const bridge = new AgyBridge();
    expect(bridge.hasSession("non-existent-thread")).toBe(false);

    const res = await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-2.5-pro",
    }) as any;
    const threadId = res.thread.id;
    expect(bridge.hasSession(threadId)).toBe(true);
    bridge.stop();
  });

  test("handles turn/interrupt request and immediately emits turn/interrupted", async () => {
    const bridge = new AgyBridge();
    const notifications: JsonRpcNotification[] = [];
    bridge.on("notification", (notif) => {
      notifications.push(notif);
    });

    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-2.5-pro",
    }) as any;
    const threadId = startRes.thread.id;

    const turnRes = await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Turn to be interrupted" }],
    }) as any;
    const turnId = turnRes.turn.id;
    expect(turnRes.turn.status).toBe("in_progress");

    // Call turn/interrupt
    const interruptRes = await bridge.request("turn/interrupt", { threadId, turnId }) as any;
    expect(interruptRes.ok).toBe(true);

    // Verify turn/interrupted notification was emitted
    const interruptedNotif = notifications.find((n) => n.method === "turn/interrupted");
    expect(interruptedNotif).toBeDefined();
    expect((interruptedNotif?.params as any)?.threadId).toBe(threadId);
    expect((interruptedNotif?.params as any)?.turnId).toBe(turnId);
    expect((interruptedNotif?.params as any)?.turn?.status).toBe("interrupted");

    // Verify thread/read reflects interrupted state
    const readRes = await bridge.request("thread/read", { threadId, includeTurns: true }) as any;
    expect(readRes.thread.status.type).toBe("idle");
    const turn = readRes.thread.turns.find((t: any) => t.id === turnId);
    expect(turn).toBeDefined();
    expect(turn.status).toBe("interrupted");

    bridge.stop();
  });

  test("preserves developerInstructions and prepends to execution prompt while keeping userItem clean", async () => {
    let capturedSnapshot: AgySessionSnapshot | undefined;
    const bridge = new AgyBridge({
      onSnapshot: (snap) => {
        capturedSnapshot = snap;
      }
    });
    const notifications: JsonRpcNotification[] = [];
    bridge.on("notification", (notif) => {
      notifications.push(notif);
    });

    const devInstructions = "CRITICAL: You are running in SA-VM mode. Use sa_vm_run MCP tool.";
    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-3.8-flash-high",
      developerInstructions: devInstructions,
    }) as any;
    const threadId = startRes.thread.id;

    expect(capturedSnapshot?.developerInstructions).toBe(devInstructions);

    await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Evaluate App.tsx refactoring" }],
    });

    const userMessage = notifications.find((n) => n.method === "item/completed");
    expect(userMessage).toBeDefined();
    const item = (userMessage?.params as any)?.item;
    expect(item?.text).toBe("Evaluate App.tsx refactoring");
    expect(item?.text).not.toContain("CRITICAL: You are running in SA-VM mode");

    expect(capturedSnapshot?.developerInstructions).toBe(devInstructions);
    bridge.stop();
  });

  test("ignores late item/started notification when existing item is already terminal", async () => {
    const bridge = new AgyBridge();
    const startRes = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-2.5-pro",
    })) as any;
    const threadId = startRes.thread.id;

    await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Test turn" }],
    });

    const session = (bridge as any).sessions.get(threadId);
    expect(session).toBeDefined();

    // Add a completed assistant item
    session.messages.push({
      type: "agentMessage",
      id: "msg-terminal-1",
      threadId,
      turnId: session.activeTurnId,
      status: "completed",
      text: "Finished message",
    });

    // Simulate late item/started notification arriving from runtime
    if (session.runtime) {
      session.runtime.emit("notification", {
        method: "item/started",
        params: {
          threadId,
          turnId: session.activeTurnId,
          item: {
            type: "agentMessage",
            id: "msg-terminal-1",
            threadId,
            turnId: session.activeTurnId,
            status: "inProgress",
            text: "",
          },
        },
      });
    }

    const item = session.messages.find((m: any) => m.id === "msg-terminal-1");
    expect(item).toBeDefined();
    expect(item.status).toBe("completed");
    expect(item.text).toBe("Finished message");

    bridge.stop();
  });

  test("Official -> DeepKey dynamic switching injects CLOUD_CODE_URL while keeping cliBackend agy", async () => {
    let resolvedRelay: string | undefined;
    const bridge = new AgyBridge({
      resolveRelayProxyConfig: async (providerId, _groupId, model) => {
        resolvedRelay = providerId;
        if (providerId === "deepkey") {
          return {
            targetBaseUrl: "https://api.deepkey.com/v1",
            targetModel: model || "gemini-2.5-pro",
            apiKeys: ["sk-deepkey-test"],
          };
        }
        return undefined;
      },
    });

    // Start with official
    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "gemini-3.8-flash-high",
      providerId: "agy-official",
    }) as any;
    const threadId = startRes.thread.id;
    expect(startRes.thread.cliBackend).toBe("agy");

    // Turn 1: Official mode
    const turn1Res = await bridge.request("turn/start", {
      threadId,
      providerId: "agy-official",
      input: [{ type: "text", text: "Round 1: Official" }],
    }) as any;
    expect(turn1Res.turn.status).toBe("in_progress");
    const session = (bridge as any).sessions.get(threadId);
    expect(session.proxyServer).toBeUndefined();

    // Turn 2: Switch to DeepKey
    const turn2Res = await bridge.request("turn/start", {
      threadId,
      providerId: "deepkey",
      model: "gemini-2.5-pro",
      input: [{ type: "text", text: "Round 2: DeepKey" }],
    }) as any;
    expect(turn2Res.turn.status).toBe("in_progress");
    expect(resolvedRelay).toBe("deepkey");
    expect(session.proxyServer).toBeDefined();
    expect(session.proxyServer.url).toContain("http://127.0.0.1:");
    expect(session.providerId).toBe("deepkey");

    bridge.stop();
  });

  test("DeepKey -> Official dynamic switching stops proxy and clears CLOUD_CODE_URL", async () => {
    const bridge = new AgyBridge({
      resolveRelayProxyConfig: async (providerId) => {
        if (providerId === "deepkey") {
          return {
            targetBaseUrl: "https://api.deepkey.com/v1",
            targetModel: "gemini-2.5-pro",
            apiKeys: ["sk-deepkey-test"],
          };
        }
        return undefined;
      },
    });

    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      providerId: "deepkey",
    }) as any;
    const threadId = startRes.thread.id;

    // Round 1: DeepKey
    await bridge.request("turn/start", {
      threadId,
      providerId: "deepkey",
      groupId: "deepkey-group",
      model: "gemini-2.5-pro",
      input: [{ type: "text", text: "Round 1 DeepKey" }],
    });
    const session = (bridge as any).sessions.get(threadId);
    expect(session.proxyServer).toBeDefined();
    expect(session.proxyServer.url).toContain("http://127.0.0.1:");
    expect(session.providerId).toBe("deepkey");
    expect(session.groupId).toBe("deepkey-group");
    expect(session.model).toBe("gemini-2.5-pro");

    // Round 2: Switch to Official
    await bridge.request("turn/start", {
      threadId,
      providerId: "agy-official",
      input: [{ type: "text", text: "Round 2 Official" }],
    });
    expect(session.proxyServer).toBeUndefined();
    expect(session.providerId).toBe("agy-official");
    expect(session.groupId).toBeUndefined();
    expect(session.model).toBe("gemini-3.8-flash-high");

    bridge.stop();
  });

  test("DeepKey -> Other third-party (SiliconFlow) dynamically updates proxy config", async () => {
    const bridge = new AgyBridge({
      resolveRelayProxyConfig: async (providerId) => {
        if (providerId === "deepkey") {
          return {
            targetBaseUrl: "https://api.deepkey.com/v1",
            targetModel: "gemini-2.5-pro",
            apiKeys: ["sk-deepkey-test"],
          };
        }
        if (providerId === "siliconflow") {
          return {
            targetBaseUrl: "https://api.siliconflow.cn/v1",
            targetModel: "Qwen/Qwen2.5-72B-Instruct",
            apiKeys: ["sk-silicon-test"],
          };
        }
        return undefined;
      },
    });

    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      providerId: "deepkey",
    }) as any;
    const threadId = startRes.thread.id;

    // Round 1: DeepKey
    await bridge.request("turn/start", {
      threadId,
      providerId: "deepkey",
      input: [{ type: "text", text: "Round 1" }],
    });
    const session = (bridge as any).sessions.get(threadId);
    expect(session.proxyServer).toBeDefined();
    expect((session.proxyServer as any).config.targetModel).toBe("gemini-2.5-pro");
    expect((session.proxyServer as any).config.targetBaseUrl).toBe("https://api.deepkey.com/v1");

    // Round 2: SiliconFlow
    await bridge.request("turn/start", {
      threadId,
      providerId: "siliconflow",
      input: [{ type: "text", text: "Round 2" }],
    });
    expect(session.proxyServer).toBeDefined();
    expect((session.proxyServer as any).config.targetModel).toBe("Qwen/Qwen2.5-72B-Instruct");
    expect((session.proxyServer as any).config.targetBaseUrl).toBe("https://api.siliconflow.cn/v1");
    expect(session.providerId).toBe("siliconflow");

    bridge.stop();
  });

  test("Third-party proxy config failure throws error and does NOT fall back to official bare execution", async () => {
    const bridge = new AgyBridge({
      resolveRelayProxyConfig: async () => undefined,
    });

    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      providerId: "invalid-relay",
    }) as any;
    const threadId = startRes.thread.id;

    await expect(bridge.request("turn/start", {
      threadId,
      providerId: "invalid-relay",
      input: [{ type: "text", text: "Should fail" }],
    })).rejects.toThrow("AGY relay proxy configuration failed");

    bridge.stop();
  });

  test("Third-party proxy config failure preserves previous valid session state and does NOT pollute session", async () => {
    const bridge = new AgyBridge({
      resolveRelayProxyConfig: async (providerId) => {
        if (providerId === "deepkey") {
          return {
            targetBaseUrl: "https://api.deepkey.com/v1",
            targetModel: "gemini-2.5-pro",
            apiKeys: ["sk-deepkey-test"],
          };
        }
        return undefined;
      },
    });

    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      providerId: "deepkey",
      groupId: "deepkey-group",
      model: "gemini-2.5-pro",
    }) as any;
    const threadId = startRes.thread.id;

    // Turn 1: Valid DeepKey turn
    await bridge.request("turn/start", {
      threadId,
      providerId: "deepkey",
      groupId: "deepkey-group",
      model: "gemini-2.5-pro",
      input: [{ type: "text", text: "Turn 1" }],
    });

    const session = (bridge as any).sessions.get(threadId);
    expect(session.providerId).toBe("deepkey");
    expect(session.groupId).toBe("deepkey-group");
    expect(session.model).toBe("gemini-2.5-pro");

    // Turn 2: Attempt switch to invalid-relay (fails)
    await expect(bridge.request("turn/start", {
      threadId,
      providerId: "invalid-relay",
      groupId: "invalid-group",
      model: "invalid-model",
      input: [{ type: "text", text: "Turn 2 should fail" }],
    })).rejects.toThrow("AGY relay proxy configuration failed");

    // Verify session was NOT polluted by invalid-relay
    expect(session.providerId).toBe("deepkey");
    expect(session.groupId).toBe("deepkey-group");
    expect(session.model).toBe("gemini-2.5-pro");

    bridge.stop();
  });

  test("AgyCompatibleRuntime hard guard throws when non-official provider lacks CLOUD_CODE_URL", async () => {
    const { AgyCompatibleRuntime } = await import("../../backends/agy/src/runtime/agyCompatibleRuntime.js");
    const runtime = new AgyCompatibleRuntime({
      threadId: "test-thread",
      cwd: process.cwd(),
      providerId: "deepkey",
      // envOverrides has no CLOUD_CODE_URL
    });

    await expect(runtime.executeTurn("Test prompt", "turn-1")).rejects.toThrow(
      "AGY relay selected but CLOUD_CODE_URL is missing"
    );
  });

  test("AgyCompatibleRuntime allows execution without CLOUD_CODE_URL when providerId is agy-official", async () => {
    const { AgyCompatibleRuntime } = await import("../../backends/agy/src/runtime/agyCompatibleRuntime.js");
    const runtime = new AgyCompatibleRuntime({
      threadId: "test-thread",
      cwd: process.cwd(),
      providerId: "agy-official",
    });

    let caughtError: any = null;
    try {
      await runtime.executeTurn("Test prompt", "turn-1");
    } catch (err: any) {
      caughtError = err;
    }
    if (caughtError) {
      expect(caughtError.message).not.toContain("CLOUD_CODE_URL is missing");
    }
    runtime.interrupt();
  });

  test("executeTurn failure emits turn/failed and clears activeTurnId to prevent waiting hang", async () => {
    const bridge = new AgyBridge();
    const notifications: JsonRpcNotification[] = [];
    bridge.on("notification", (notif) => {
      notifications.push(notif);
    });

    const startRes = await bridge.request("thread/start", {
      cwd: process.cwd(),
      providerId: "agy-official",
    }) as any;
    const threadId = startRes.thread.id;

    // Start turn
    const turnRes = await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Failing turn" }],
    }) as any;
    const turnId = turnRes.turn.id;

    const session = (bridge as any).sessions.get(threadId);
    expect(session).toBeDefined();

    // Mock runtime.executeTurn to reject immediately
    session.runtime.executeTurn = async () => {
      throw new Error("Simulated runtime crash");
    };

    // Wait for the pendingTurnTimer (10ms) to fire and reject
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(session.activeTurnId).toBeUndefined();
    const turnEntry = session.turns.find((t: any) => t.id === turnId);
    expect(turnEntry?.status).toBe("failed");

    const failedNotif = notifications.find((n) => n.method === "turn/failed");
    expect(failedNotif).toBeDefined();
    expect((failedNotif?.params as any)?.turnId).toBe(turnId);
    expect((failedNotif?.params as any)?.error?.message).toBe("Simulated runtime crash");

    bridge.stop();
  });

  test("restoreSession updates providerId, groupId, and model on existing session", () => {
    const bridge = new AgyBridge();
    const threadId = "restore-test-thread";

    // First restoration
    const session1 = bridge.restoreSession({
      threadId,
      providerId: "deepkey",
      groupId: "group-1",
      model: "gemini-2.5-pro",
      turns: [],
      messages: [],
    });
    expect(session1.providerId).toBe("deepkey");
    expect(session1.groupId).toBe("group-1");
    expect(session1.model).toBe("gemini-2.5-pro");

    // Second restoration on existing session with updated provider/group/model
    const session2 = bridge.restoreSession({
      threadId,
      providerId: "siliconflow",
      groupId: "group-2",
      model: "Qwen/Qwen2.5-72B-Instruct",
      turns: [],
      messages: [],
    });

    expect(session2).toBe(session1);
    expect(session2.providerId).toBe("siliconflow");
    expect(session2.groupId).toBe("group-2");
    expect(session2.model).toBe("Qwen/Qwen2.5-72B-Instruct");

    bridge.stop();
  });
});

