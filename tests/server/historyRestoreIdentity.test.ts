import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiniFileHistory } from "../../backends/mini/src/runtime/miniFileHistory.ts";
import { AutoFallbackCodexRuntimeClient, type CodexRuntimeClient } from "../../backends/codex/src/runtime/codexBridge.ts";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";

function fakePrimary(): { emitter: EventEmitter; client: CodexRuntimeClient } {
  const emitter = new EventEmitter();
  const client = Object.assign(emitter, {
    getStatus: () => ({ phase: "idle" as const, transport: "daemon-unix" as const }),
    start: async () => ({ phase: "idle" as const, transport: "daemon-unix" as const }),
    stop: () => {},
    restart: async () => ({ phase: "idle" as const, transport: "daemon-unix" as const }),
    request: async () => {
      throw new Error("Codex app-server is stopped");
    },
    notify: async () => {},
    respond: () => {},
  }) as unknown as CodexRuntimeClient;
  return { emitter, client };
}

describe("history restore backend identity", () => {
  test("mini thread/read of an unknown id throws instead of faking an empty history", async () => {
    const bridge = new MiniBridge({});
    await expect(bridge.request("thread/read", { threadId: "ghost-codex-id" })).rejects.toThrow("thread not found");
    await expect(bridge.request("thread/read", { threadId: "ghost-codex-id", includeTurns: false })).rejects.toThrow("thread not found");
  });

  test("mini turns/list and items/list of an unknown id throw instead of an empty page", async () => {
    const bridge = new MiniBridge({});
    await expect(bridge.request("thread/turns/list", { threadId: "ghost-codex-id" })).rejects.toThrow("thread not found");
    await expect(bridge.request("thread/items/list", { threadId: "ghost-codex-id" })).rejects.toThrow("thread not found");
  });

  test("mini keeps the sanitized shape for a foreign-owned live session", async () => {
    const bridge = new MiniBridge({});
    const started = (await bridge.request("thread/start", { ownerId: "member-a", cwd: "/tmp/work", model: "gpt-5-mini" })) as unknown as { threadId: string };
    const foreign = (await bridge.request("thread/read", { ownerId: "member-b", threadId: started.threadId })) as unknown as { items: unknown[]; thread: { id: string } };
    expect(foreign.thread.id).toBe(started.threadId);
    expect(foreign.items).toEqual([]);
  });

  test("fallback-active codex ghost reads surface a retryable error, mini-owned still served", async () => {
    const { emitter, client } = fakePrimary();
    const mini = new MiniBridge({});
    const started = (await mini.request("thread/start", { cwd: process.cwd(), model: "gpt-5-mini" })) as unknown as { threadId: string };
    const auto = new AutoFallbackCodexRuntimeClient(client, mini);
    emitter.emit("status", { phase: "error", transport: "daemon-unix", message: "boom" });
    expect(auto.isFallbackActive()).toBe(true);

    await expect(auto.request("thread/read", { threadId: "ghost-codex-id" })).rejects.toThrow("fallback to Mini active");
    const owned = (await auto.request("thread/read", { threadId: started.threadId, includeTurns: false })) as unknown as { thread: { cliBackend: string } };
    expect(owned.thread.cliBackend).toBe("mini");
  });

  test("mini metadata stays visible from local to members but denies foreign owners", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-owner-meta-"));
    try {
      const history = new MiniFileHistory(dir);
      const snap = (threadId: string, ownerId: string) => ({
        threadId, ownerId, cwd: "/tmp/work", model: "gpt-5-mini",
        turns: [], messages: [],
      });
      history.upsert({ threadId: "t-local", ownerId: "local", snapshot: snap("t-local", "local") });
      history.upsert({ threadId: "t-alice", ownerId: "alice", snapshot: snap("t-alice", "alice") });

      expect(history.getMetadata("bob", "t-local")).not.toBeNull();
      expect(history.getMetadata("local", "t-local")).not.toBeNull();
      expect(history.getMetadata("bob", "t-alice")).toBeNull();
      expect(history.getMetadata("bob", "t-ghost")).toBeNull();
      expect(history.exists("bob", "t-local")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
