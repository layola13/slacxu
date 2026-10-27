import { describe, expect, test } from "bun:test";
import { OpencodeBridge } from "../../backends/opencode/src/runtime/opencodeBridge.ts";

describe("OpencodeBridge history reopen and continue", () => {
  test("turn/start on unmaterialized opencode thread adopts session without crashing", async () => {
    const bridge = new OpencodeBridge({
      loadMetadata: (threadId: string) => ({
        threadId,
        model: "default",
        cwd: process.cwd(),
      })
    });

    const threadId = "8193c692-7bc9-41ce-9a2f-f76e8a077a50";
    // We stub wireRuntimeEvents / runtime.executeTurn to prevent real spawn
    (bridge as any).wireRuntimeEvents = () => {};

    // Start turn
    const res = await bridge.request("turn/start", {
      threadId,
      cwd: process.cwd(),
      model: "default",
      input: [{ type: "text", text: "继续提问" }]
    }) as any;

    expect(res).toBeDefined();
    expect(res.turn).toBeDefined();
    expect(res.turn.status).toBe("inProgress");
    expect((bridge as any).sessions.has(threadId)).toBe(true);

    const session = (bridge as any).sessions.get(threadId);
    expect(session.threadId).toBe(threadId);
  });

  test("turn/start rejects foreign-owned opencode thread", async () => {
    const bridge = new OpencodeBridge();
    const threadId = "opencode-foreign-thread-123";
    (bridge as any).sessions.set(threadId, {
      threadId,
      ownerId: "user-alice",
      cwd: process.cwd(),
      model: "default",
      turns: [],
      messages: []
    });

    await expect(bridge.request("turn/start", {
      threadId,
      ownerId: "user-bob",
      cwd: process.cwd(),
      input: [{ type: "text", text: "hello" }]
    })).rejects.toThrow("OpenCode session belongs to another owner");
  });
});
