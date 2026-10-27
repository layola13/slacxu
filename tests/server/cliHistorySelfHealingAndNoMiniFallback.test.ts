import { describe, expect, test } from "bun:test";
import { shouldRouteToMiniBackend } from "../../backends/mini/src/runtime/miniFileHistory.ts";
import { AgyBridge } from "../../backends/agy/src/runtime/agyBridge.ts";
import { GrokBridge } from "../../backends/grok/src/runtime/grokBridge.ts";
import { PiBridge } from "../../backends/pi/src/runtime/piBridge.ts";

describe("CLI routing: strictly no Mini fallback for other CLIs", () => {
  const mockOptions = {
    threadId: "test-thread-id",
    ownerId: "local",
    historyExists: () => true,
    hasSession: () => false,
  };

  test("shouldRouteToMiniBackend returns false for any non-mini storedCliBackend", () => {
    // NOTE: "codex" is intentionally excluded here. A stored `codex` value may
    // be a generic-fallback mislabel while the Mini history file is
    // authoritative (native Codex threads never have one); that legacy case
    // must still route to Mini (see "legacy codex-mislabeled mini file routes
    // to mini" in miniFileHistory.test.ts).
    const nonMiniBackends = ["claude", "agy", "grok", "pi", "opencode"];
    for (const backend of nonMiniBackends) {
      const result = shouldRouteToMiniBackend({
        ...mockOptions,
        storedCliBackend: backend,
      });
      expect(result).toBe(false);
    }
  });

  test("shouldRouteToMiniBackend returns false when paramCliBackend specifies another CLI", () => {
    const nonMiniBackends = ["codex", "claude", "agy", "grok", "pi", "opencode"];
    for (const backend of nonMiniBackends) {
      const result = shouldRouteToMiniBackend({
        ...mockOptions,
        paramCliBackend: backend,
        storedCliBackend: undefined,
      });
      expect(result).toBe(false);
    }
  });

  test("shouldRouteToMiniBackend returns true only for mini backend or legacy unspecified mini history", () => {
    expect(shouldRouteToMiniBackend({
      ...mockOptions,
      storedCliBackend: "mini",
    })).toBe(true);

    expect(shouldRouteToMiniBackend({
      ...mockOptions,
      storedCliBackend: undefined,
    })).toBe(true);
  });
});

describe("AgyBridge history self-healing and owner isolation", () => {
  test("turn/start on unmaterialized thread adopts session from metadata without crashing", async () => {
    const bridge = new AgyBridge({
      loadMetadata: (threadId: string) => ({
        threadId,
        model: "gemini-3.8-flash-high",
        cwd: process.cwd(),
      }),
    });
    // Stub wireRuntimeEvents to prevent actual process execution
    (bridge as any).wireRuntimeEvents = () => {};

    const threadId = "agy-unmaterialized-thread-001";
    const res = await bridge.request("turn/start", {
      threadId,
      cwd: process.cwd(),
      input: [{ type: "text", text: "AGY continue test" }],
    }) as any;

    expect(res).toBeDefined();
    expect(res.turn).toBeDefined();
    expect(["inProgress", "in_progress"]).toContain(res.turn.status);
    expect((bridge as any).sessions.has(threadId)).toBe(true);

    const session = (bridge as any).sessions.get(threadId);
    expect(session.threadId).toBe(threadId);
  });

  test("turn/start rejects foreign-owned live AGY thread", async () => {
    const bridge = new AgyBridge();
    const threadId = "agy-foreign-thread-live";
    (bridge as any).sessions.set(threadId, {
      threadId,
      ownerId: "user-alice",
      cwd: process.cwd(),
      model: "gemini-3.8-flash-high",
      turns: [],
      messages: [],
    });

    await expect(bridge.request("turn/start", {
      threadId,
      ownerId: "user-bob",
      cwd: process.cwd(),
      input: [{ type: "text", text: "hello" }],
    })).rejects.toThrow("AGY session belongs to another owner");
  });

  test("turn/start rejects foreign-owned unmaterialized AGY thread via metadata", async () => {
    const bridge = new AgyBridge({
      loadMetadata: (threadId: string) => ({
        threadId,
        ownerId: "user-alice",
        model: "gemini-3.8-flash-high",
        cwd: process.cwd(),
      }),
    });

    const threadId = "agy-foreign-thread-stored";
    await expect(bridge.request("turn/start", {
      threadId,
      ownerId: "user-bob",
      cwd: process.cwd(),
      input: [{ type: "text", text: "hello" }],
    })).rejects.toThrow("AGY session belongs to another owner");
  });
});

describe("GrokBridge history self-healing and owner isolation", () => {
  test("turn/start on unmaterialized thread adopts session from metadata without crashing", async () => {
    const bridge = new GrokBridge({
      loadMetadata: (threadId: string) => ({
        threadId,
        model: "grok-4.6",
        cwd: process.cwd(),
      }),
    });
    // Stub wireRuntimeEvents to prevent actual process execution
    (bridge as any).wireRuntimeEvents = () => {};

    const threadId = "grok-unmaterialized-thread-001";
    const res = await bridge.request("turn/start", {
      threadId,
      cwd: process.cwd(),
      input: [{ type: "text", text: "Grok continue test" }],
    }) as any;

    expect(res).toBeDefined();
    expect(res.turn).toBeDefined();
    expect(res.turn.status).toBe("inProgress");
    expect((bridge as any).sessions.has(threadId)).toBe(true);

    const session = (bridge as any).sessions.get(threadId);
    expect(session.threadId).toBe(threadId);
  });

  test("turn/start rejects foreign-owned live Grok thread", async () => {
    const bridge = new GrokBridge();
    const threadId = "grok-foreign-thread-live";
    (bridge as any).sessions.set(threadId, {
      threadId,
      ownerId: "user-alice",
      cwd: process.cwd(),
      model: "grok-4.6",
      turns: [],
      messages: [],
    });

    await expect(bridge.request("turn/start", {
      threadId,
      ownerId: "user-bob",
      cwd: process.cwd(),
      input: [{ type: "text", text: "hello" }],
    })).rejects.toThrow("Grok session belongs to another owner");
  });

  test("turn/start rejects foreign-owned unmaterialized Grok thread via metadata", async () => {
    const bridge = new GrokBridge({
      loadMetadata: (threadId: string) => ({
        threadId,
        ownerId: "user-alice",
        model: "grok-4.6",
        cwd: process.cwd(),
      }),
    });

    const threadId = "grok-foreign-thread-stored";
    await expect(bridge.request("turn/start", {
      threadId,
      ownerId: "user-bob",
      cwd: process.cwd(),
      input: [{ type: "text", text: "hello" }],
    })).rejects.toThrow("Grok session belongs to another owner");
  });
});

describe("PiBridge history self-healing and owner isolation", () => {
  test("turn/start on unmaterialized thread adopts session from metadata without crashing", async () => {
    const bridge = new PiBridge({
      loadMetadata: (threadId: string) => ({
        threadId,
        model: "pi-relay/default",
        cwd: process.cwd(),
      }),
    });
    // Stub wireRuntimeEvents to prevent actual process execution
    (bridge as any).wireRuntimeEvents = () => {};

    const threadId = "pi-unmaterialized-thread-001";
    const res = await bridge.request("turn/start", {
      threadId,
      cwd: process.cwd(),
      input: [{ type: "text", text: "Pi continue test" }],
    }) as any;

    expect(res).toBeDefined();
    expect(res.turn).toBeDefined();
    expect(res.turn.status).toBe("inProgress");
    expect((bridge as any).sessions.has(threadId)).toBe(true);

    const session = (bridge as any).sessions.get(threadId);
    expect(session.threadId).toBe(threadId);
  });

  test("turn/start rejects foreign-owned live Pi thread", async () => {
    const bridge = new PiBridge();
    const threadId = "pi-foreign-thread-live";
    (bridge as any).sessions.set(threadId, {
      threadId,
      ownerId: "user-alice",
      cwd: process.cwd(),
      model: "pi-relay/default",
      turns: [],
      messages: [],
    });

    await expect(bridge.request("turn/start", {
      threadId,
      ownerId: "user-bob",
      cwd: process.cwd(),
      input: [{ type: "text", text: "hello" }],
    })).rejects.toThrow("Pi session belongs to another owner");
  });

  test("turn/start rejects foreign-owned unmaterialized Pi thread via metadata", async () => {
    const bridge = new PiBridge({
      loadMetadata: (threadId: string) => ({
        threadId,
        ownerId: "user-alice",
        model: "pi-relay/default",
        cwd: process.cwd(),
      }),
    });

    const threadId = "pi-foreign-thread-stored";
    await expect(bridge.request("turn/start", {
      threadId,
      ownerId: "user-bob",
      cwd: process.cwd(),
      input: [{ type: "text", text: "hello" }],
    })).rejects.toThrow("Pi session belongs to another owner");
  });
});
