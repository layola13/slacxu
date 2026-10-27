import { describe, expect, test } from "bun:test";
import { OpencodeCompatibleProcessManager } from "../../backends/opencode/src/runtime/opencodeCompatibleProcessManager.js";
import { OpencodeCompatibleRuntime } from "../../backends/opencode/src/runtime/opencodeCompatibleRuntime.js";
import type { JsonRpcNotification } from "@codex-ui/shared";

function waitTerminal(runtime: OpencodeCompatibleRuntime, timeoutMs: number): Promise<JsonRpcNotification> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      runtime.off("notification", onNotif);
      reject(new Error("timed out waiting for terminal turn event"));
    }, timeoutMs);
    const onNotif = (notif: JsonRpcNotification) => {
      if (notif.method === "turn/completed" || notif.method === "turn/failed" || notif.method === "turn/interrupted") {
        clearTimeout(timer);
        runtime.off("notification", onNotif);
        resolve(notif);
      }
    };
    runtime.on("notification", onNotif);
  });
}

describe("opencode real CLI verification", () => {
  test("bare model id no longer fails the turn (uses server default)", async () => {
    const pm = new OpencodeCompatibleProcessManager({ dangerous: true });
    const info = await pm.start();
    try {
      const runtime = new OpencodeCompatibleRuntime({
        threadId: "repro-thread-bare",
        cwd: "d:\\projects\\codex-ultra",
        model: "gemini-3.8-flash",
        dangerous: true,
        serverUrl: info.url,
        serverPassword: info.password,
      });
      const seen: string[] = [];
      const assistantTexts: string[] = [];
      runtime.on("notification", (n: JsonRpcNotification) => {
        seen.push(n.method);
        if (n.method === "item/completed") {
          const item = (n.params as any)?.item;
          if (item?.type === "agentMessage" && typeof item.text === "string") assistantTexts.push(item.text);
        }
      });
      const terminal = waitTerminal(runtime, 100000);
      await runtime.executeTurn("hi", "turn-bare-1");
      const done = await terminal;
      expect(done.method).toBe("turn/completed");
      expect(assistantTexts.length).toBeGreaterThan(0);
      const fullText = assistantTexts.join("\n");
      expect(fullText.trim()).not.toBe("hi");
      expect(fullText.length).toBeGreaterThan(10);
      console.log("BARE-MODEL assistant:", JSON.stringify(fullText.slice(0, 120)));
    } finally {
      await pm.stop();
    }
  }, 120000);

  test("provider-qualified model completes", async () => {
    const pm = new OpencodeCompatibleProcessManager({ dangerous: true });
    const info = await pm.start();
    try {
      const runtime = new OpencodeCompatibleRuntime({
        threadId: "repro-thread-qualified",
        cwd: "d:\\projects\\codex-ultra",
        model: "opencode-go/qwen3.8-flash",
        dangerous: true,
        serverUrl: info.url,
        serverPassword: info.password,
      });
      const terminal = waitTerminal(runtime, 100000);
      await runtime.executeTurn("hi", "turn-qual-1");
      const done = await terminal;
      expect(done.method).toBe("turn/completed");
    } finally {
      await pm.stop();
    }
  }, 120000);
});
