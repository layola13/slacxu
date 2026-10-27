import { describe, expect, test } from "bun:test";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";

describe("MiniBridge history reopen and continue", () => {
  test("turn/start on unmaterialized thread adopts session without crashing", async () => {
    let capturedTurn: any = null;
    const bridge = new MiniBridge({
      // Mock runMiniTurn so we don't need real network
    });
    // Stub runMiniTurn
    (bridge as any).runMiniTurn = async (_s: any, turnId: string, prompt: string) => {
      capturedTurn = { turnId, prompt };
    };

    const threadId = "8193c692-7bc9-41ce-9a2f-f76e8a077a50";
    const res = await bridge.request("turn/start", {
      threadId,
      cwd: process.cwd(),
      model: "gpt-5-mini",
      providerId: "deepkey-1",
      input: [{ type: "text", text: "继续提问" }]
    }) as any;

    expect(res).toBeDefined();
    expect(res.turn).toBeDefined();
    expect(res.turn.status).toBe("inProgress");
    expect((bridge as any).sessions.has(threadId)).toBe(true);

    const session = (bridge as any).sessions.get(threadId);
    expect(session.threadId).toBe(threadId);
    expect(session.providerId).toBe("deepkey-1");
  });

  test("turn/start rejects foreign-owned live thread", async () => {
    const bridge = new MiniBridge();
    const threadId = "foreign-thread-123";
    (bridge as any).sessions.set(threadId, {
      threadId,
      ownerId: "user-alice",
      cwd: process.cwd(),
      model: "gpt-5-mini",
      createdAt: Date.now(),
      turns: [],
      messages: []
    });

    await expect(bridge.request("turn/start", {
      threadId,
      ownerId: "user-bob",
      cwd: process.cwd(),
      input: [{ type: "text", text: "hello" }]
    })).rejects.toThrow("thread not found or not owned by this session");
  });
});
