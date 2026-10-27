import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.js";

test("mini turn lifecycle notifications carry server wall-clock timestamps", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "mini-turn-timestamps-"));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      await request.json();
      return Response.json({
        choices: [{ message: { content: "hello!" }, finish_reason: "stop" }],
      });
    },
  });

  try {
    const bridge = new MiniBridge({
      resolveRelayTarget: async () => ({
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        apiKey: "fixture",
        protocol: "chat",
        contextWindow: 100_000,
        streamMaxRetries: 0,
      }),
    });

    const started = await bridge.request("thread/start", {
      cwd,
      providerId: "fixture",
      model: "fixture-model",
      sandbox: "read-only",
      approvalPolicy: "never",
    }) as { thread: { id: string } };
    const threadId = started.thread.id;

    const seen: Array<{ method: string; params: Record<string, unknown> }> = [];
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Mini fixture turn timed out")), 15_000);
      const handler = (notification: { method: string; params: Record<string, unknown> }) => {
        seen.push(notification);
        if (notification.method === "turn/completed" || notification.method === "turn/failed") {
          clearTimeout(timer);
          bridge.off("notification", handler);
          resolve();
        }
      };
      bridge.on("notification", handler);
      void bridge.request("turn/start", { threadId, prompt: "hello" }).catch(reject);
    });
    await done;

    const turnStarted = seen.find((x) => x.method === "turn/started");
    expect(turnStarted).toBeDefined();
    const wireStartedAt = (turnStarted!.params.turn as Record<string, unknown>)?.startedAt;
    expect(typeof wireStartedAt).toBe("number");

    const terminal = seen.find((x) => x.method === "turn/completed")!;
    expect(terminal).toBeDefined();
    expect(typeof terminal.params.completedAt).toBe("number");
    expect(typeof (terminal.params.turn as Record<string, unknown>)?.completedAt).toBe("number");
    // Same-clock sanity: completion is not before start.
    expect(Number(terminal.params.completedAt)).toBeGreaterThanOrEqual(Number(wireStartedAt));
  } finally {
    server.stop();
  }
});
