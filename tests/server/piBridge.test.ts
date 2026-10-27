import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the code under test
import { describe, expect, spyOn, test } from "bun:test";
import { PiBridge, PI_OFFICIAL_PROVIDER_ID } from "../../backends/pi/src/runtime/piBridge";
import { PI_ABORT_ACK_TIMEOUT_MS, PiRuntimeAdapter } from "../../backends/pi/src/runtime/piRuntimeAdapter";
import { createPiProjectorContext } from "../../backends/pi/src/runtime/piTurnProjector";

describe("piBridge", () => {
  test("PiBridge implements lifecycle methods and manages session state", async () => {
    const bridge = new PiBridge();
    const status = bridge.getStatus();
    expect(status.phase).toBe("ready");
    expect(status.transport).toBe("stdio");

    // thread/start
    const startRes = (await bridge.request("thread/start", { model: "pi-relay/default" })) as any;
    expect(startRes.threadId).toBeDefined();
    const threadId = startRes.threadId;

    expect(bridge.hasSession(threadId)).toBe(true);

    // thread/read
    const readRes = (await bridge.request("thread/read", { threadId })) as any;
    expect(readRes.thread.id).toBe(threadId);
    expect(readRes.thread.cliBackend).toBe("pi");
    expect(readRes.thread.model).toBe("pi-relay/default");

    // thread/delete
    await bridge.request("thread/delete", { threadId });
    expect(bridge.hasSession(threadId)).toBe(false);
  });

  test("handles turn/start request, user message recording, and snapshots", async () => {
    let capturedSnapshot: any = null;
    const bridge = new PiBridge({
      onSnapshot: (snap) => {
        capturedSnapshot = snap;
      },
    });

    const startRes = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "pi-relay/default",
    })) as any;
    const threadId = startRes.threadId;

    const turnRes = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Hello Pi!" }],
    })) as any;

    expect(turnRes.turn).toBeDefined();
    expect(turnRes.turn.status).toBe("inProgress");
    expect(typeof turnRes.turnId).toBe("string");

    expect(capturedSnapshot).toBeDefined();
    expect(capturedSnapshot.threadId).toBe(threadId);
    expect(capturedSnapshot.preview).toBe("Hello Pi!");
    expect(capturedSnapshot.messages.length).toBe(1);

    // Read back
    const readRes = (await bridge.request("thread/read", { threadId, includeTurns: true })) as any;
    expect(readRes.thread.id).toBe(threadId);
    expect(readRes.thread.cliBackend).toBe("pi");
    expect(readRes.thread.preview).toBe("Hello Pi!");
    expect(readRes.thread.turns.length).toBe(1);
    expect(readRes.items.length).toBe(1);

    // Restoration in fresh bridge
    const restoredBridge = new PiBridge({
      loadSnapshot: () => capturedSnapshot,
    });
    const restoredRead = (await restoredBridge.request("thread/read", { threadId })) as any;
    expect(restoredRead.thread.id).toBe(threadId);
    expect(restoredRead.thread.cliBackend).toBe("pi");
    expect(restoredRead.thread.preview).toBe("Hello Pi!");

    bridge.stop();
    restoredBridge.stop();
  });

  test("supports two turns with distinct IDs and ordered readback", async () => {
    const bridge = new PiBridge();
    const notifications: any[] = [];
    bridge.on("notification", (notification) => notifications.push(notification));

    const startRes = (await bridge.request("thread/start", {
      cwd: process.cwd(),
      model: "pi-relay/default",
    })) as any;
    const threadId = startRes.threadId;

    const first = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "First Pi turn" }],
    })) as any;
    expect(first.turn).toBeDefined();
    expect(first.turn.id).toBe(first.turnId);
    expect(first.turn.threadId).toBe(threadId);
    expect(first.turn.status).toBe("inProgress");
    expect(notifications).toContainEqual(expect.objectContaining({
      method: "turn/started",
      params: expect.objectContaining({ threadId, turnId: first.turnId, engine: "pi" }),
    }));
    expect(notifications).toContainEqual(expect.objectContaining({
      method: "item/completed",
      params: expect.objectContaining({
        threadId,
        turnId: first.turnId,
        item: expect.objectContaining({ type: "userMessage", text: "First Pi turn" }),
      }),
    }));

    const second = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Second Pi turn" }],
    })) as any;
    expect(second.turn).toBeDefined();
    expect(second.turn.id).toBe(second.turnId);
    expect(second.turn.threadId).toBe(threadId);
    expect(second.turn.status).toBe("inProgress");
    expect(second.turnId).not.toBe(first.turnId);

    const readRes = (await bridge.request("thread/read", { threadId, includeTurns: true })) as any;
    expect(readRes.thread.turns).toHaveLength(2);
    expect(readRes.thread.turns.map((turn: any) => turn.id)).toEqual([first.turnId, second.turnId]);
    const firstTurnItems = readRes.items.filter((item: any) => item.turnId === first.turnId);
    expect(firstTurnItems).toHaveLength(2);
    expect(firstTurnItems.some((item: any) => item.type === "agentMessage" && item.status === "interrupted")).toBe(true);
    expect(readRes.items.filter((item: any) => item.turnId === second.turnId)).toHaveLength(1);
    expect(readRes.items.find((item: any) => item.turnId === first.turnId)?.text).toBe("First Pi turn");
    expect(readRes.items.find((item: any) => item.turnId === second.turnId)?.text).toBe("Second Pi turn");

    bridge.stop();
  });

  test("handles thread/compact/start correctly", async () => {
    const bridge = new PiBridge();
    const notifications: any[] = [];
    bridge.on("notification", (notification) => notifications.push(notification));

    const startRes = (await bridge.request("thread/start", { cwd: process.cwd() })) as any;
    const threadId = startRes.threadId;

    const compactRes = (await bridge.request("thread/compact/start", { threadId })) as any;
    expect(compactRes.turn).toBeDefined();
    expect(compactRes.turn.status).toBe("completed");

    expect(notifications).toContainEqual(expect.objectContaining({
      method: "turn/started",
      params: expect.objectContaining({ threadId, engine: "pi" }),
    }));
    expect(notifications).toContainEqual(expect.objectContaining({
      method: "turn/completed",
      params: expect.objectContaining({ threadId, engine: "pi" }),
    }));

    bridge.stop();
  });

  test("handles thread/turns/list and turn/steer on inactive turn", async () => {
    const bridge = new PiBridge();
    const startRes = (await bridge.request("thread/start", { cwd: process.cwd() })) as any;
    const threadId = startRes.threadId;

    const turn1 = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Turn 1" }],
    })) as any;

    const listRes = (await bridge.request("thread/turns/list", { threadId })) as any;
    expect(Array.isArray(listRes.turns)).toBe(true);
    expect(listRes.turns.length).toBe(1);
    expect(listRes.turns[0].id).toBe(turn1.turnId);
    expect(listRes.turns[0].items.length).toBe(1);
    expect(listRes.turns[0].items[0].type).toBe("userMessage");

    // Steer without active turn should throw "No active turn"
    await expect(bridge.request("turn/steer", { threadId: "non-existent" })).rejects.toThrow("No active turn");

    bridge.stop();
  });

  test("turn/steer records user message, emits item/completed, and returns turn on active turn", async () => {
    const bridge = new PiBridge();
    const notifications: any[] = [];
    bridge.on("notification", (notif) => notifications.push(notif));

    const startRes = (await bridge.request("thread/start", { cwd: process.cwd() })) as any;
    const threadId = startRes.threadId;

    const turnRes = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "First turn prompt" }],
    })) as any;
    const turnId = turnRes.turnId;

    // Steer active turn with second message
    const steerRes = (await bridge.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: "text", text: "Second message via steer" }],
    })) as any;

    expect(steerRes.turn).toBeDefined();
    expect(steerRes.turn.id).toBe(turnId);
    expect(steerRes.turn.status).toBe("inProgress");
    expect(steerRes.turnId).toBe(turnId);

    // Verify item/completed notification was emitted for the steer userMessage
    const userSteerNotif = notifications.find(
      (n) => n.method === "item/completed" && n.params?.item?.text === "Second message via steer"
    );
    expect(userSteerNotif).toBeDefined();
    expect(userSteerNotif.params.turnId).toBe(turnId);
    expect(userSteerNotif.params.item.type).toBe("userMessage");
    expect(userSteerNotif.params.item.role).toBe("user");

    // Verify thread/read includes both user messages
    const readRes = (await bridge.request("thread/read", { threadId, includeTurns: true })) as any;
    expect(readRes.thread.turns).toHaveLength(1);
    expect(readRes.thread.turns[0].items).toHaveLength(2);
    expect(readRes.thread.turns[0].items[0].text).toBe("First turn prompt");
    expect(readRes.thread.turns[0].items[1].text).toBe("Second message via steer");

    // Steer with mismatched expectedTurnId should throw
    await expect(
      bridge.request("turn/steer", {
        threadId,
        expectedTurnId: "wrong-turn-id",
        input: [{ type: "text", text: "Mismatch test" }],
      })
    ).rejects.toThrow(`Expected active turn id 'wrong-turn-id' but found '${turnId}'`);

    bridge.stop();
  });

  test("turn/start preempts lingering active turn by marking it interrupted", async () => {
    const bridge = new PiBridge();
    const startRes = (await bridge.request("thread/start", { cwd: process.cwd() })) as any;
    const threadId = startRes.threadId;

    const first = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Turn 1" }],
    })) as any;

    // Start a new turn while turn 1 is still active
    const second = (await bridge.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Turn 2" }],
    })) as any;

    const readRes = (await bridge.request("thread/read", { threadId, includeTurns: true })) as any;
    expect(readRes.thread.turns).toHaveLength(2);
    const t1 = readRes.thread.turns.find((t: any) => t.id === first.turnId);
    const t2 = readRes.thread.turns.find((t: any) => t.id === second.turnId);
    expect(t1.status).toBe("interrupted");
    expect(t2.status).toBe("inProgress");

    bridge.stop();
  });

  test("failed Pi turn start is persisted and does not remain active", async () => {
    const executeTurn = spyOn(PiRuntimeAdapter.prototype, "executeTurn")
      .mockRejectedValue(new Error("upstream request failed"));
    let snapshot: any;
    const bridge = new PiBridge({ onSnapshot: (value) => { snapshot = value; } });
    const failed = new Promise<any>((resolve) => {
      bridge.on("notification", (notification) => {
        if (notification.method === "turn/failed") resolve(notification);
      });
    });

    try {
      const started = await bridge.request("thread/start", { cwd: process.cwd() }) as any;
      const result = await bridge.request("turn/start", {
        threadId: started.threadId,
        input: [{ type: "text", text: "Fail promptly" }],
      }) as any;
      const failure = await failed;

      expect(failure.params.turnId).toBe(result.turnId);
      expect(snapshot.turns.find((turn: any) => turn.id === result.turnId)?.status).toBe("failed");
      expect(snapshot.messages.some((item: any) => item.id === `pi-err-${result.turnId}`)).toBe(true);
      const turns = await bridge.request("thread/turns/list", { threadId: started.threadId }) as any;
      expect(turns.turns.find((turn: any) => turn.id === result.turnId)?.status).toBe("failed");
    } finally {
      bridge.stop();
      executeTurn.mockRestore();
    }
  });

  test("Pi interrupt uses a short abort ACK deadline and stops an unresponsive process", async () => {
    const runtime = new PiRuntimeAdapter({ threadId: "pi-interrupt", cwd: process.cwd() });
    const ctx = createPiProjectorContext("pi-interrupt", "turn-interrupt");
    (runtime as any).ctx = ctx;
    let commandOptions: any;
    let processStopped = false;
    (runtime as any).process = {
      isRunning: () => true,
      sendCommand: async (_command: unknown, options: unknown) => {
        commandOptions = options;
        throw new Error("abort ACK timed out");
      },
      stop: () => { processStopped = true; },
    };
    const notifications: any[] = [];
    runtime.on("notification", (notification) => notifications.push(notification));

    await runtime.interrupt();

    expect(commandOptions).toEqual({ ackTimeoutMs: PI_ABORT_ACK_TIMEOUT_MS });
    expect(processStopped).toBe(true);
    expect(ctx.status).toBe("interrupted");
    expect(notifications.some((notification) => notification.method === "turn/interrupted")).toBe(true);
  });


  test("cold history metadata read avoids materializing the full snapshot", async () => {
    let snapshotReads = 0;
    const bridge = new PiBridge({
      loadMetadata: (threadId) => ({ threadId, sessionId: "session", model: "pi-relay/default", cwd: "/work" }),
      loadSnapshot: () => { snapshotReads += 1; return null; },
    });

    const result = await bridge.request("thread/read", { threadId: "history", includeTurns: false }) as any;

    expect(snapshotReads).toBe(0);
    expect(result.thread).toMatchObject({ cliBackend: "pi", historyMode: "paginated", model: "pi-relay/default", cwd: "/work", turns: [] });
    expect(result.items).toEqual([]);
  });
});
