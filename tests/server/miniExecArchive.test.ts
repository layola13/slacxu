import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiniBridge, type MiniSnapshot } from "../../backends/mini/src/runtime/miniBridge.ts";
import { MiniFileHistory } from "../../backends/mini/src/runtime/miniFileHistory.ts";

function threadIdOf(result: unknown): string {
  const rec = result as Record<string, unknown>;
  const thread = rec.thread as Record<string, unknown>;
  return String(thread.id ?? rec.threadId ?? "");
}

describe("mini P0-1: loud unsupported methods", () => {
  test("unknown RPCs throw instead of returning silent {}", async () => {
    const bridge = new MiniBridge();
    await expect(bridge.request("thread/inject_items", {})).rejects.toThrow(
      "Mini backend does not support thread/inject_items",
    );
    await expect(bridge.request("skills/list", {})).rejects.toThrow(
      "Mini backend does not support skills/list",
    );
  });
});

describe("mini P0-1: thread/archive", () => {
  test("live session archives, hides from list, stays readable", async () => {
    const archived: Array<[string, string, boolean]> = [];
    const snapshots: MiniSnapshot[] = [];
    const bridge = new MiniBridge({
      setArchivedSnapshot: (threadId, ownerId, flag) => {
        archived.push([threadId, ownerId, flag]);
        return true;
      },
      listSnapshots: () => snapshots,
    });
    const notifications: Array<{ method: string; params: unknown }> = [];
    bridge.on("notification", (msg: unknown) => {
      const m = msg as { method: string; params: unknown };
      notifications.push({ method: m.method, params: m.params });
    });

    const cwd = mkdtempSync(join(tmpdir(), "mini-archive-"));
    try {
      const started = await bridge.request("thread/start", { cwd, ownerId: "local" });
      const threadId = threadIdOf(started);
      expect(threadId).toBeTruthy();
      expect(bridge.hasSession(threadId, "local")).toBe(true);

      const res = (await bridge.request("thread/archive", { threadId, ownerId: "local" })) as Record<string, unknown>;
      expect(res.ok).toBe(true);
      expect(bridge.hasSession(threadId, "local")).toBe(false);
      expect(notifications.some((n) => n.method === "thread/archived")).toBe(true);

      // Live session persisted the flag before eviction (no file-only fallback needed).
      expect(archived.length).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("file-only thread flips the persisted flag", async () => {
    const calls: Array<[string, string, boolean]> = [];
    const bridge = new MiniBridge({
      setArchivedSnapshot: (threadId, ownerId, flag) => {
        calls.push([threadId, ownerId, flag]);
        return true;
      },
    });
    const res = (await bridge.request("thread/archive", { threadId: "ghost-thread", ownerId: "local" })) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(true);
    expect(calls).toEqual([["ghost-thread", "local", true]]);
  });

  test("archived snapshots stay out of thread/list", async () => {
    const bridge = new MiniBridge({
      listSnapshots: () => [
        { threadId: "visible-1", cwd: tmpdir(), turns: [], messages: [] },
        { threadId: "hidden-1", cwd: tmpdir(), turns: [], messages: [], archived: true },
        { threadId: "child-1", cwd: tmpdir(), turns: [], messages: [], parentThreadId: "visible-1" },
      ],
    });
    const res = (await bridge.request("thread/list", { ownerId: "local" })) as {
      threads: Array<{ id: string }>;
    };
    const ids = res.threads.map((t) => t.id);
    expect(ids).toContain("visible-1");
    expect(ids).not.toContain("hidden-1");
    expect(ids).not.toContain("child-1");
  });
});

describe("mini P0-1: file history archived flag", () => {
  test("setArchived hides from lists but keeps reads", () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-archived-flag-"));
    try {
      const history = new MiniFileHistory(dir);
      const rec = history.upsert({
        threadId: "t-arch-1",
        ownerId: "local",
        model: "x",
        cwd: dir,
        snapshot: { threadId: "t-arch-1", ownerId: "local", cwd: dir, turns: [], messages: [] },
      });
      expect(rec.threadId).toBe("t-arch-1");
      expect(history.listForOwner("local").map((r) => r.threadId)).toContain("t-arch-1");

      expect(history.setArchived("local", "t-arch-1", true)).toBe(true);
      expect(history.listForOwner("local").map((r) => r.threadId)).not.toContain("t-arch-1");
      // Still openable + metadata visible.
      expect(history.get("local", "t-arch-1")?.threadId).toBe("t-arch-1");
      expect(history.getMetadata("local", "t-arch-1")?.archived).toBe(true);

      expect(history.setArchived("local", "t-arch-1", false)).toBe(true);
      expect(history.listForOwner("local").map((r) => r.threadId)).toContain("t-arch-1");
      expect(history.setArchived("local", "missing-thread", true)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("mini P0-1: command/exec", () => {
  test("buffered exec returns exitCode/stdout/stderr", async () => {
    const bridge = new MiniBridge();
    const res = (await bridge.request("command/exec", {
      command: [process.execPath, "-e", "process.stdout.write('mini-exec-ok')"],
      cwd: tmpdir(),
      timeoutMs: 15000,
    })) as Record<string, unknown>;
    expect(res.exitCode).toBe(0);
    expect(String(res.stdout)).toContain("mini-exec-ok");
    expect(typeof res.stderr).toBe("string");
    bridge.stop();
  });

  test("empty argv is rejected loudly", async () => {
    const bridge = new MiniBridge();
    await expect(bridge.request("command/exec", { command: [] })).rejects.toThrow("non-empty command argv");
    bridge.stop();
  });

  test("streaming exec emits outputDelta and empties buffered copies", async () => {
    const bridge = new MiniBridge();
    const deltas: Array<{ processId: string; deltaBase64: string; stream: string }> = [];
    bridge.on("notification", (msg: unknown) => {
      const m = msg as { method: string; params: { processId: string; deltaBase64: string; stream: string } };
      if (m.method === "command/exec/outputDelta") deltas.push(m.params);
    });
    const processId = "mini-stream-test-1";
    const res = (await bridge.request("command/exec", {
      processId,
      command: [process.execPath, "-e", "process.stdout.write('stream-me')"],
      cwd: tmpdir(),
      streamStdoutStderr: true,
      timeoutMs: 15000,
    })) as Record<string, unknown>;
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("");
    const text = deltas
      .filter((d) => d.processId === processId)
      .map((d) => Buffer.from(d.deltaBase64, "base64").toString("utf8"))
      .join("");
    expect(text).toContain("stream-me");
    bridge.stop();
  });

  test("stdin write + closeStdin round-trips", async () => {
    const bridge = new MiniBridge();
    const processId = "mini-stdin-test-1";
    const pending = bridge.request("command/exec", {
      processId,
      command: [
        process.execPath,
        "-e",
        "let s='';process.stdin.on('data',d=>{s+=d}).on('end',()=>process.stdout.write('echo:'+s))",
      ],
      cwd: tmpdir(),
      streamStdin: true,
      timeoutMs: 15000,
    });
    // Give the child a moment to spawn before writing.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await bridge.request("command/exec/write", {
      processId,
      deltaBase64: Buffer.from("abc").toString("base64"),
      closeStdin: true,
    });
    const res = (await pending) as Record<string, unknown>;
    expect(res.exitCode).toBe(0);
    expect(String(res.stdout)).toContain("echo:abc");
    bridge.stop();
  });

  test("terminate kills a running process (idempotent)", async () => {
    const bridge = new MiniBridge();
    const processId = "mini-term-test-1";
    const pending = bridge.request("command/exec", {
      processId,
      command: [process.execPath, "-e", "setInterval(()=>{},1000)"],
      cwd: tmpdir(),
      streamStdin: true,
      timeoutMs: 30000,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const term = (await bridge.request("command/exec/terminate", { processId })) as Record<string, unknown>;
    expect(term).toEqual({});
    const res = (await pending) as Record<string, unknown>;
    expect(typeof res.exitCode).toBe("number");
    expect(res.exitCode).not.toBe(0);
    // Second terminate is a no-op, never a throw (workspace-close race).
    await expect(bridge.request("command/exec/terminate", { processId })).resolves.toEqual({});
    bridge.stop();
  });

  test("timeout kills and reports 124", async () => {
    const bridge = new MiniBridge();
    const res = (await bridge.request("command/exec", {
      command: [process.execPath, "-e", "setInterval(()=>{},1000)"],
      cwd: tmpdir(),
      timeoutMs: 1000,
    })) as Record<string, unknown>;
    expect(res.exitCode).toBe(124);
    expect(String(res.stderr)).toContain("timed out");
    bridge.stop();
  });

  test("resize accepts without a PTY", async () => {
    const bridge = new MiniBridge();
    await expect(
      bridge.request("command/exec/resize", { processId: "nope", size: { cols: 80, rows: 24 } }),
    ).resolves.toEqual({});
    await expect(bridge.request("command/exec/write", { processId: "nope" })).rejects.toThrow("unknown process");
    bridge.stop();
  });
});
