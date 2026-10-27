import { describe, expect, test } from "bun:test";
import { GrokBridge, GROK_OFFICIAL_PROVIDER_ID, buildGrokOfficialProvider } from "../../backends/grok/src/runtime/grokBridge";

describe("grokBridge", () => {
  test("buildGrokOfficialProvider creates valid official provider config with grok-4.6", () => {
    const provider = buildGrokOfficialProvider();
    expect(provider.id).toBe(GROK_OFFICIAL_PROVIDER_ID);
    expect(provider.id).toBe("grok-official");
    expect(provider.name).toBe("Grok 官方");
    expect(provider.defaultModel).toBe("grok-4.6");
    expect(provider.nativeModels).toEqual(["grok-4.6"]);
    expect(provider.serviceProvider.id).toBe("xai-grok");
    expect(provider.groups?.[0]?.models).toEqual(["grok-4.6"]);
  });

  test("GrokBridge implements lifecycle methods and manages session state", async () => {
    const bridge = new GrokBridge();
    const status = bridge.getStatus();
    expect(status.phase).toBe("ready");
    expect(status.transport).toBe("stdio");

    // thread/start
    const startRes = (await bridge.request("thread/start", { model: "grok-4.6" })) as any;
    expect(startRes.threadId).toBeDefined();
    const threadId = startRes.threadId;

    expect(bridge.hasSession(threadId)).toBe(true);

    // thread/read
    const readRes = (await bridge.request("thread/read", { threadId })) as any;
    expect(readRes.thread.id).toBe(threadId);
    expect(readRes.thread.model).toBe("grok-4.6");

    // thread/delete
    await bridge.request("thread/delete", { threadId });
    expect(bridge.hasSession(threadId)).toBe(false);
  });

  test("handles turn/start request, user message recording, and snapshots", async () => {
    let capturedSnapshot: any = null;
    const bridge = new GrokBridge({
      onSnapshot: (snap) => {
        capturedSnapshot = snap;
      },
    });

    const startRes = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "grok-4.6",
    })) as any;
    const threadId = startRes.threadId;

    const turnRes = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Hello Grok!" }],
    })) as any;

    expect(turnRes.turn).toBeDefined();
    expect(turnRes.turn.status).toBe("inProgress");
    expect(typeof turnRes.turnId).toBe("string");

    expect(capturedSnapshot).toBeDefined();
    expect(capturedSnapshot.threadId).toBe(threadId);
    expect(capturedSnapshot.preview).toBe("Hello Grok!");
    expect(capturedSnapshot.messages.length).toBe(1);

    // Read back
    const readRes = (await bridge.request("thread/read", { threadId, includeTurns: true })) as any;
    expect(readRes.thread.id).toBe(threadId);
    expect(readRes.thread.preview).toBe("Hello Grok!");
    expect(readRes.thread.turns.length).toBe(1);
    expect(readRes.items.length).toBe(1);

    // Restoration in fresh bridge
    const restoredBridge = new GrokBridge({
      loadSnapshot: () => capturedSnapshot,
    });
    const restoredRead = (await restoredBridge.request("thread/read", { threadId })) as any;
    expect(restoredRead.thread.id).toBe(threadId);
    expect(restoredRead.thread.preview).toBe("Hello Grok!");

    bridge.stop();
    restoredBridge.stop();
  });

  test("supports two turns with distinct IDs and ordered readback", async () => {
    const bridge = new GrokBridge();
    const notifications: any[] = [];
    bridge.on("notification", (notification) => notifications.push(notification));

    const startRes = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "grok-4.6",
    })) as any;
    const threadId = startRes.threadId;

    const first = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "First Grok turn" }],
    })) as any;
    expect(first.turn).toBeDefined();
    expect(first.turn.id).toBe(first.turnId);
    expect(first.turn.threadId).toBe(threadId);
    expect(first.turn.status).toBe("inProgress");
    expect(notifications).toContainEqual(expect.objectContaining({
      method: "turn/started",
      params: expect.objectContaining({ threadId, turnId: first.turnId }),
    }));
    expect(notifications).toContainEqual(expect.objectContaining({
      method: "item/completed",
      params: expect.objectContaining({
        threadId,
        turnId: first.turnId,
        item: expect.objectContaining({ type: "userMessage", text: "First Grok turn" }),
      }),
    }));

    const second = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Second Grok turn" }],
    })) as any;
    expect(second.turn).toBeDefined();
    expect(second.turn.id).toBe(second.turnId);
    expect(second.turn.threadId).toBe(threadId);
    expect(second.turn.status).toBe("inProgress");
    expect(second.turnId).not.toBe(first.turnId);
    expect(notifications).toContainEqual(expect.objectContaining({
      method: "turn/started",
      params: expect.objectContaining({ threadId, turnId: second.turnId }),
    }));
    expect(notifications).toContainEqual(expect.objectContaining({
      method: "item/completed",
      params: expect.objectContaining({
        threadId,
        turnId: second.turnId,
        item: expect.objectContaining({ type: "userMessage", text: "Second Grok turn" }),
      }),
    }));

    const readRes = (await bridge.request("thread/read", { threadId, includeTurns: true })) as any;
    expect(readRes.thread.turns).toHaveLength(2);
    expect(readRes.thread.turns.map((turn: any) => turn.id)).toEqual([first.turnId, second.turnId]);
    expect(readRes.items.filter((item: any) => item.turnId === first.turnId)).toHaveLength(1);
    expect(readRes.items.filter((item: any) => item.turnId === second.turnId)).toHaveLength(1);
    expect(readRes.items.find((item: any) => item.turnId === first.turnId)?.text).toBe("First Grok turn");
    expect(readRes.items.find((item: any) => item.turnId === second.turnId)?.text).toBe("Second Grok turn");

    bridge.stop();
  });

  test("handles compact, goal, and interrupt requests", async () => {
    const bridge = new GrokBridge();
    const startRes = (await bridge.request("thread/start", { model: "grok-4.6" })) as any;
    const threadId = startRes.threadId;

    // Compact
    const compactRes = (await bridge.request("thread/compact/start", { threadId })) as any;
    expect(compactRes.turn).toBeDefined();
    expect(compactRes.turn.status).toBe("completed");

    // Goal set & get
    const setGoalRes = (await bridge.request("thread/goal/set", { threadId, objective: "Test objective", status: "active" })) as any;
    expect(setGoalRes.ok).toBe(true);

    const getGoalRes = (await bridge.request("thread/goal/get", { threadId })) as any;
    expect(getGoalRes.goal.objective).toBe("Test objective");
    expect(getGoalRes.goal.status).toBe("active");

    // Interrupt
    const interruptRes = (await bridge.request("turn/interrupt", { threadId })) as any;
    expect(interruptRes.ok).toBe(true);

    bridge.stop();
  });

  test("ignores late item/started notification when existing item is already terminal", async () => {
    const bridge = new GrokBridge();
    const startRes = (await bridge.request("thread/start", { model: "grok-4.6" })) as any;
    const threadId = startRes.threadId;

    await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Test turn" }],
    });

    const session = (bridge as any).sessions.get(threadId);
    expect(session).toBeDefined();

    // Add a completed assistant item
    session.messages.push({
      type: "agentMessage",
      id: "msg-grok-terminal-1",
      threadId,
      turnId: session.activeTurnId,
      status: "completed",
      text: "Finished grok message",
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
            id: "msg-grok-terminal-1",
            threadId,
            turnId: session.activeTurnId,
            status: "inProgress",
            text: "",
          },
        },
      });
    }

    const item = session.messages.find((m: any) => m.id === "msg-grok-terminal-1");
    expect(item).toBeDefined();
    expect(item.status).toBe("completed");
    expect(item.text).toBe("Finished grok message");

    bridge.stop();
  });

  test("cold history metadata read avoids materializing the full snapshot", async () => {
    let snapshotReads = 0;
    const bridge = new GrokBridge({
      loadMetadata: (threadId) => ({ threadId, sessionId: "session", model: "grok-4.6", cwd: "/work" }),
      loadSnapshot: () => { snapshotReads += 1; return null; },
    });

    const result = await bridge.request("thread/read", { threadId: "history", includeTurns: false }) as any;

    expect(snapshotReads).toBe(0);
    expect(result.thread).toMatchObject({ cliBackend: "grok", historyMode: "paginated", model: "grok-4.6", cwd: "/work", turns: [] });
    expect(result.items).toEqual([]);
  });
});

