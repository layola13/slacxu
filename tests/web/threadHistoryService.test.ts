import { expect, test } from "bun:test";
import type { JsonValue } from "@codex-ui/shared";
import {
  loadInitialThreadHistory,
  normalizeHistoricalRunningTurns,
  FAST_INITIAL_TURN_LIMIT,
  THREAD_HISTORY_RPC_TIMEOUT_MS
} from "../../apps/web/src/app/threads/threadHistoryService.ts";
import { threadReadToTurns } from "../../apps/web/src/state/codexClient.ts";

test("retries a newly published child thread until rollout metadata is readable", async () => {
  let reads = 0;
  const client = {
    async rpc(method: string): Promise<JsonValue> {
      if (method === "thread/read" && ++reads < 3) {
        throw new Error("failed to read session metadata: rollout at child.jsonl is empty");
      }
      if (method === "thread/read") {
        return { thread: { id: "child", historyMode: "paginated" } };
      }
      return { data: [], nextCursor: null };
    }
  };

  const result = await loadInitialThreadHistory(client, "child");
  expect(reads).toBe(3);
  expect(result.loaded.thread?.id).toBe("child");
});

test("metadata read is bounded so giant histories fail fast instead of hanging", async () => {
  // Regression guard: metadata must stay interactive (8s cap); the full
  // transcript is served via tail/page, never via an unbounded metadata read.
  expect(THREAD_HISTORY_RPC_TIMEOUT_MS.metadata).toBeLessThanOrEqual(8_000);

  // A slow metadata RPC still resolves instead of racing a timeout.
  const client = {
    async rpc(method: string): Promise<JsonValue> {
      if (method === "thread/read") {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 300));
        return { thread: { id: "slow", historyMode: "paginated" } };
      }
      return { data: [], nextCursor: null };
    }
  };
  const result = await loadInitialThreadHistory(client, "slow");
  expect(result.loaded.thread?.id).toBe("slow");
});

test("stages advance on real steps only (paginated path)", async () => {
  const stages: Array<{ pct: number; label: string }> = [];
  const client = {
    async rpc(method: string): Promise<JsonValue> {
      if (method === "thread/read") return { thread: { id: "paged", historyMode: "paginated" } };
      return { data: [], nextCursor: null };
    }
  };
  await loadInitialThreadHistory(client, "paged", {
    onStage: (pct, label) => { stages.push({ pct, label }); },
  });
  expect(stages.map((s) => s.pct)).toEqual([35, 70, 85]);
  expect(stages[0]!.label).toBe("Reading stored transcript");
  expect(stages[1]!.label).toBe("Decoding history");
});

test("stages advance on real steps only (legacy path without local file)", async () => {
  const stages: number[] = [];
  const client = {
    async rpc(method: string): Promise<JsonValue> {
      if (method === "thread/read") return { thread: { id: "legacy", historyMode: "legacy", cliBackend: "codex" } };
      throw new Error(`unexpected RPC: ${method}`);
    }
  };
  await loadInitialThreadHistory(client, "legacy", {
    onStage: (pct) => { stages.push(pct); },
  });
  expect(stages).toEqual([35, 70, 85]);
});

test("does not retry permanent thread read failures", async () => {
  let reads = 0;
  const client = {
    async rpc(): Promise<JsonValue> {
      reads += 1;
      throw new Error("thread does not exist");
    }
  };

  await expect(loadInitialThreadHistory(client, "missing")).rejects.toThrow("thread does not exist");
  expect(reads).toBe(1);
});

test("never probes a local Codex rollout file for Claude or remote threads", async () => {
  // Claude histories now reopen through the paginated turns API (same as mini);
  // SSH/autonomous threads stay on their runtime bridge. None of them may
  // probe thread/history/fileInfo or thread/history/tail for a local path.
  const cases: Array<{ thread: Record<string, unknown>; expected: string[] }> = [
    {
      thread: { id: "claude", cliBackend: "claude", path: "/home/vscode/.codex/sessions/missing.jsonl" },
      expected: ["thread/read", "thread/turns/list"],
    },
    {
      thread: { id: "ssh", workspaceMode: "ssh", path: "/home/vscode/.codex/sessions/missing.jsonl" },
      expected: ["thread/read", "thread/read"],
    },
    {
      thread: { id: "autonomous", remoteExecutionMode: "autonomous", path: "/home/vscode/.codex/sessions/missing.jsonl" },
      expected: ["thread/read", "thread/read"],
    },
  ];
  for (const { thread, expected } of cases) {
    const calls: string[] = [];
    const client = {
      async rpc(method: string): Promise<JsonValue> {
        calls.push(method);
        if (method === "thread/read" && calls.length === 1) return { thread };
        if (method === "thread/read") return { thread, turns: [] };
        if (method === "thread/turns/list") return { data: [], nextCursor: null };
        throw new Error(`unexpected RPC: ${method}`);
      }
    };

    await loadInitialThreadHistory(client, String(thread.id));

    expect(calls).toEqual(expected);
  }
});

test("normalizes stale running history without changing thread identity", () => {
  const history = {
    thread: { id: "thread-stable", name: "Stable history" },
    turns: [
      { id: "turn-running", threadId: "thread-stable", status: "inProgress", items: [] },
      { id: "turn-pending", threadId: "thread-stable", status: "pending_init", items: [] },
      { id: "turn-complete", threadId: "thread-stable", status: "completed", items: [] }
    ]
  } as ReturnType<typeof normalizeHistoricalRunningTurns>;

  const normalized = normalizeHistoricalRunningTurns(history);

  expect(normalized.thread?.id).toBe("thread-stable");
  expect(normalized.turns.map((turn) => turn.status)).toEqual(["interrupted", "interrupted", "completed"]);
  expect(normalized.turns.map((turn) => turn.id)).toEqual(["turn-running", "turn-pending", "turn-complete"]);
  expect(history.turns[0]?.status).toBe("inProgress");
});

test("preserves a live running turn while loading history", () => {
  const history = {
    thread: { id: "thread-live" },
    turns: [{ id: "turn-live", threadId: "thread-live", status: "inProgress", items: [] }]
  } as ReturnType<typeof normalizeHistoricalRunningTurns>;

  const normalized = normalizeHistoricalRunningTurns(history, {
    preserveRunningTurnIds: new Set(["turn-live"])
  });

  expect(normalized.turns[0]?.status).toBe("inProgress");
});

test("preserves an object-shaped running thread status during a cold history reopen", () => {
  const history = threadReadToTurns({
    thread: {
      id: "thread-codecli-live",
      cliBackend: "claude",
      status: { type: "running" },
      turns: [{ id: "turn-codecli-live", status: "running", items: [] }]
    }
  });

  expect(history.thread?.status).toBe("running");
  expect(normalizeHistoricalRunningTurns(history).turns[0]?.status).toBe("running");
});
test("preserves an active server thread during a cold history reopen", () => {
  const history = {
    thread: { id: "thread-live", status: "active" },
    turns: [{ id: "turn-live", threadId: "thread-live", status: "inProgress", items: [] }]
  } as ReturnType<typeof normalizeHistoricalRunningTurns>;

  expect(normalizeHistoricalRunningTurns(history).turns[0]?.status).toBe("inProgress");
});

test("agent histories use the same paginated reopen path as Codex", async () => {
  const calls: Array<{ method: string; params?: Record<string, JsonValue> }> = [];
  const client = {
    async rpc(method: string, params?: Record<string, JsonValue>): Promise<JsonValue> {
      calls.push({ method, params });
      if (method === "thread/read") return { thread: { id: "agent", cliBackend: "mini", historyMode: "paginated" } };
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      throw new Error(`unexpected RPC: ${method}`);
    }
  };

  await loadInitialThreadHistory(client, "agent");

  expect(calls.map(({ method }) => method)).toEqual(["thread/read", "thread/turns/list"]);
  expect(calls[0]?.params).toEqual({ threadId: "agent", includeTurns: false });
  expect(calls[1]?.params).toMatchObject({ threadId: "agent", cursor: null, limit: FAST_INITIAL_TURN_LIMIT, sortDirection: "desc" });
});

test("fileInfo failure degrades to incomplete instead of a cacheable empty history", async () => {
  const client = {
    async rpc(method: string): Promise<JsonValue> {
      if (method === "thread/read") return { thread: { id: "big", cliBackend: "codex", path: "/tmp/rollout.jsonl" } };
      if (method === "thread/history/fileInfo") throw new Error("ENOENT: no such file");
      throw new Error(`unexpected RPC: ${method}`);
    }
  };

  const result = await loadInitialThreadHistory(client, "big");
  expect(result.loaded.turns).toEqual([]);
  expect(result.incomplete).toBe(true);
  expect(result.notice).toBeTruthy();
});

test("empty tail falls back to a bounded full read instead of caching zero turns", async () => {
  const calls: string[] = [];
  const client = {
    async rpc(method: string, params?: Record<string, JsonValue>): Promise<JsonValue> {
      calls.push(method);
      if (method === "thread/read" && (params as Record<string, JsonValue> | undefined)?.includeTurns === false) {
        return { thread: { id: "big", cliBackend: "codex", path: "/tmp/rollout.jsonl" } };
      }
      if (method === "thread/history/fileInfo") return { sizeBytes: 8 * 1024 * 1024 };
      if (method === "thread/history/tail") return { thread: { id: "big", turns: [] } };
      if (method === "thread/read") {
        return { thread: { id: "big", turns: [{ id: "t1", status: "completed", items: [] }] } };
      }
      throw new Error(`unexpected RPC: ${method}`);
    }
  };

  const result = await loadInitialThreadHistory(client, "big");
  expect(calls).toContain("thread/history/tail");
  expect(result.loaded.turns).toHaveLength(1);
  expect(result.incomplete).toBeUndefined();
});

test("empty tail on a 1GB+ history skips the full read and reports incomplete", async () => {
  const calls: string[] = [];
  const client = {
    async rpc(method: string, params?: Record<string, JsonValue>): Promise<JsonValue> {
      calls.push(method);
      if (method === "thread/read" && (params as Record<string, JsonValue> | undefined)?.includeTurns === false) {
        return { thread: { id: "huge", cliBackend: "codex", path: "/tmp/rollout.jsonl" } };
      }
      if (method === "thread/history/fileInfo") return { sizeBytes: 3 * 1024 * 1024 * 1024 };
      if (method === "thread/history/tail") return { thread: { id: "huge", turns: [] } };
      throw new Error(`unexpected RPC: ${method}`);
    }
  };

  const result = await loadInitialThreadHistory(client, "huge");
  expect(calls).toEqual(["thread/read", "thread/history/fileInfo", "thread/history/tail"]);
  expect(result.loaded.turns).toEqual([]);
  expect(result.incomplete).toBe(true);
});

test("empty tail and empty full read report incomplete so the next open retries", async () => {
  const client = {
    async rpc(method: string, params?: Record<string, JsonValue>): Promise<JsonValue> {
      if (method === "thread/read" && (params as Record<string, JsonValue> | undefined)?.includeTurns === false) {
        return { thread: { id: "big", cliBackend: "codex", path: "/tmp/rollout.jsonl" } };
      }
      if (method === "thread/history/fileInfo") return { sizeBytes: 8 * 1024 * 1024 };
      if (method === "thread/history/tail") return { thread: { id: "big", turns: [] } };
      if (method === "thread/read") return { thread: { id: "big", turns: [] } };
      throw new Error(`unexpected RPC: ${method}`);
    }
  };

  const result = await loadInitialThreadHistory(client, "big");
  expect(result.loaded.turns).toEqual([]);
  expect(result.incomplete).toBe(true);
  expect(result.notice).toBeTruthy();
});
