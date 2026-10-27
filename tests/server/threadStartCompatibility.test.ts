import { describe, expect, test } from "bun:test";
import type { JsonValue } from "@codex-ui/shared";
import {
  isAgentLoopDiedBeforeTurnStart,
  isPaginatedThreadHistoryUnsupported,
  isThreadMissingBeforeTurnStart,
  requestWithLocalAgentLoopRecovery,
  requestWithThreadStartHistoryFallback
} from "../../apps/server/src/threadStartCompatibility";

describe("thread/start history compatibility", () => {
  test("retries an older CLI once without paginated history", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const result = await requestWithThreadStartHistoryFallback({
      method: "thread/start",
      params: { cwd: "/tmp/project", historyMode: "paginated" },
      request: async (method, params) => {
        calls.push({ method, params });
        if (calls.length === 1) throw new Error("paginated_threads is not supported yet");
        return { thread: { id: "legacy-thread" } };
      }
    });

    expect(result).toEqual({ thread: { id: "legacy-thread" } });
    expect(calls).toEqual([
      { method: "thread/start", params: { cwd: "/tmp/project", historyMode: "paginated" } },
      { method: "thread/start", params: { cwd: "/tmp/project" } }
    ]);
  });

  test("does not replay ambiguous transport failures", async () => {
    let calls = 0;
    await expect(requestWithThreadStartHistoryFallback({
      method: "thread/start",
      params: { historyMode: "paginated" },
      request: async () => {
        calls += 1;
        throw new Error("stream disconnected before completion");
      }
    })).rejects.toThrow("stream disconnected before completion");
    expect(calls).toBe(1);
  });

  test("does not retry other methods or unrelated errors", async () => {
    expect(isPaginatedThreadHistoryUnsupported({ message: "historyMode is unsupported" })).toBe(true);
    expect(isPaginatedThreadHistoryUnsupported(new Error("Unauthorized"))).toBe(false);
    let calls = 0;
    await expect(requestWithThreadStartHistoryFallback({
      method: "turn/start",
      params: { historyMode: "paginated" },
      request: async () => {
        calls += 1;
        throw new Error("paginated_threads is not supported yet");
      }
    })).rejects.toThrow("paginated_threads is not supported yet");
    expect(calls).toBe(1);
  });
});

describe("local agent loop recovery", () => {
  test("resumes and retries one local turn after the agent loop closes", async () => {
    const calls: Array<{ method: string; params?: JsonValue }> = [];
    const resumed: string[] = [];
    let turnStartAttempts = 0;

    const result = await requestWithLocalAgentLoopRecovery({
      method: "turn/start",
      params: { threadId: "thread-closed", input: [] },
      local: true,
      request: async (method, params) => {
        calls.push({ method, params });
        if (method === "turn/start" && turnStartAttempts++ === 0) {
          throw new Error("failed to start turn: internal error; agent loop died unexpectedly");
        }
        return method === "turn/start" ? { turn: { id: "turn-retried" } } : {};
      },
      onResumed: (threadId) => resumed.push(threadId)
    });

    expect(result).toEqual({ turn: { id: "turn-retried" } });
    expect(calls.map((call) => call.method)).toEqual(["turn/start", "thread/resume", "turn/start"]);
    expect(resumed).toEqual(["thread-closed"]);
  });

  test("resumes a stored local thread after the app-server restarts", async () => {
    const calls: Array<{ method: string; params?: JsonValue }> = [];
    const resumed: string[] = [];
    let turnStartAttempts = 0;

    const result = await requestWithLocalAgentLoopRecovery({
      method: "turn/start",
      params: { threadId: "01a00419-b092-7c93-8712-dae9e2668344", input: [] },
      local: true,
      request: async (method, params) => {
        calls.push({ method, params });
        if (method === "turn/start" && turnStartAttempts++ === 0) {
          throw new Error(
            "CUX-RPC-LOCAL-001 execution=local stage=start-turn method=turn/start "
            + "thread=01a00419-b092-7c93-8712-dae9e2668344 "
            + "cause=thread not found: 01a00419-b092-7c93-8712-dae9e2668344"
          );
        }
        return method === "turn/start" ? { turn: { id: "turn-after-restart" } } : {};
      },
      onResumed: (threadId) => resumed.push(threadId)
    });

    expect(result).toEqual({ turn: { id: "turn-after-restart" } });
    expect(calls.map((call) => call.method)).toEqual(["turn/start", "thread/resume", "turn/start"]);
    expect(resumed).toEqual(["01a00419-b092-7c93-8712-dae9e2668344"]);
  });

  test("forwards turn context when rebuilding a missing local thread", async () => {
    const calls: Array<{ method: string; params?: JsonValue }> = [];
    let attempts = 0;
    await requestWithLocalAgentLoopRecovery({
      method: "turn/start",
      params: {
        threadId: "thread-reopen",
        input: [],
        cwd: "C:/workspace",
        model: "gpt-5.6-luna",
        modelProvider: "吉吉 中转",
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" }
      },
      local: true,
      resumeParams: {
        threadId: "thread-reopen",
        cwd: "C:/workspace",
        model: "gpt-5.6-luna",
        modelProvider: "吉吉 中转",
        approvalPolicy: "never",
        sandbox: "danger-full-access"
      },
      request: async (method, params) => {
        calls.push({ method, params });
        if (method === "turn/start" && attempts++ === 0) throw new Error("thread not found: thread-reopen");
        return { turn: { id: "turn-reopened" } };
      }
    });

    expect(calls[1]).toEqual({
      method: "thread/resume",
      params: {
        threadId: "thread-reopen",
        cwd: "C:/workspace",
        model: "gpt-5.6-luna",
        modelProvider: "吉吉 中转",
        approvalPolicy: "never",
        sandbox: "danger-full-access"
      }
    });
  });

  test("does not replay remote or unrelated failures", async () => {
    await expect(requestWithLocalAgentLoopRecovery({
      method: "turn/start",
      params: { threadId: "thread-remote" },
      local: false,
      request: async () => {
        throw new Error("failed to start turn: internal error; agent loop died unexpectedly");
      }
    })).rejects.toThrow("agent loop died unexpectedly");

    await expect(requestWithLocalAgentLoopRecovery({
      method: "turn/start",
      params: { threadId: "thread-remote" },
      local: false,
      request: async () => {
        throw new Error("thread not found: thread-remote");
      }
    })).rejects.toThrow("thread not found: thread-remote");

    await expect(requestWithLocalAgentLoopRecovery({
      method: "turn/start",
      params: { threadId: "thread-local" },
      local: true,
      request: async () => {
        throw new Error("upstream relay returned 503");
      }
    })).rejects.toThrow("upstream relay returned 503");
  });

  test("retries a missing local thread only once", async () => {
    const calls: string[] = [];
    await expect(requestWithLocalAgentLoopRecovery({
      method: "turn/start",
      params: { threadId: "thread-still-missing" },
      local: true,
      request: async (method) => {
        calls.push(method);
        if (method === "thread/resume") return {};
        throw new Error("thread not found: thread-still-missing");
      }
    })).rejects.toThrow("thread not found: thread-still-missing");
    expect(calls).toEqual(["turn/start", "thread/resume", "turn/start"]);
  });

  test("recognizes nested Codex RPC error shapes", () => {
    expect(isAgentLoopDiedBeforeTurnStart({
      error: { message: "failed to start turn: internal error; agent loop died unexpectedly" }
    })).toBe(true);
    expect(isThreadMissingBeforeTurnStart({
      error: { message: "thread not found: stored-thread" }
    })).toBe(true);
  });
});
