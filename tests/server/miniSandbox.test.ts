import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MiniBridge,
  isMiniWriteAction,
  normalizeMiniSandbox,
  type MiniSnapshot,
} from "../../backends/mini/src/runtime/miniBridge.ts";
import { MiniFileHistory } from "../../backends/mini/src/runtime/miniFileHistory.ts";

describe("mini P0-2: sandbox helpers", () => {
  test("isMiniWriteAction covers file mutations and code exec (case-insensitive)", () => {
    for (const act of [
      "write_file",
      "edit_file",
      "apply_patch",
      "delete_file",
      "move_file",
      "copy_file",
      "rename_symbol",
      "extract_to_file",
      "add_import",
      "organize_imports",
      "run_bun",
      "run_host",
      "run_js",
      "run_py",
      "exec_py",
      "write_stdin",
      "kill_session",
      "local_checkpoint",
      "restore_checkpoint",
      "WRITE_FILE",
      "Run_Host",
    ]) {
      expect(isMiniWriteAction(act)).toBe(true);
    }
    for (const act of ["read_file", "read_lines", "list_dir", "grep_search", "git_status", "git_diff", "http_fetch", "", null, undefined, 42]) {
      expect(isMiniWriteAction(act)).toBe(false);
    }
  });

  test("normalizeMiniSandbox trims or drops empties", () => {
    expect(normalizeMiniSandbox("read-only")).toBe("read-only");
    expect(normalizeMiniSandbox("  danger-full-access  ")).toBe("danger-full-access");
    expect(normalizeMiniSandbox("")).toBeUndefined();
    expect(normalizeMiniSandbox("   ")).toBeUndefined();
    expect(normalizeMiniSandbox(undefined)).toBeUndefined();
    expect(normalizeMiniSandbox(42)).toBeUndefined();
  });
});

describe("mini P0-2: sandbox persistence and echo", () => {
  test("thread/start stores sandbox/approvalPolicy and thread/read echoes them", async () => {
    const bridge = new MiniBridge();
    const cwd = mkdtempSync(join(tmpdir(), "mini-sandbox-"));
    try {
      const started = (await bridge.request("thread/start", {
        cwd,
        ownerId: "local",
        sandbox: "read-only",
        approvalPolicy: "never",
      })) as { thread: { id: string; sandbox: string | null; approvalPolicy: string | null } };
      expect(started.thread.sandbox).toBe("read-only");
      expect(started.thread.approvalPolicy).toBe("never");

      const read = (await bridge.request("thread/read", {
        threadId: started.thread.id,
        ownerId: "local",
      })) as { thread: { sandbox: string | null; approvalPolicy: string | null } };
      expect(read.thread.sandbox).toBe("read-only");
      expect(read.thread.approvalPolicy).toBe("never");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("sandbox survives a file-history round-trip and still gates exec", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-sandbox-hist-"));
    const cwd = mkdtempSync(join(tmpdir(), "mini-sandbox-cwd-"));
    try {
      const history = new MiniFileHistory(dir);
      const wire = {
        onSnapshot: (snap: MiniSnapshot) => {
          history.upsert({ threadId: snap.threadId, ownerId: snap.ownerId ?? "local", snapshot: snap });
        },
        loadSnapshot: (threadId: string, ownerId = "local") => {
          const rec = history.get(ownerId, threadId);
          if (!rec?.stateJson) return null;
          try {
            return JSON.parse(rec.stateJson) as MiniSnapshot;
          } catch {
            return null;
          }
        },
      };
      const bridge = new MiniBridge(wire);
      const started = (await bridge.request("thread/start", { cwd, ownerId: "local", sandbox: "read-only" })) as {
        thread: { id: string };
      };
      const threadId = started.thread.id;

      // Fresh bridge, same files: restored session keeps the sandbox gate.
      const revived = new MiniBridge(wire);
      expect(revived.hasSession(threadId, "local")).toBe(false);
      await expect(
        revived.request("command/exec", {
          threadId,
          ownerId: "local",
          command: [process.execPath, "-e", "1"],
          cwd,
          timeoutMs: 5000,
        }),
      ).rejects.toThrow("thread sandbox is read-only");
      // Frontmatter carries the policy for list/open paths.
      expect(history.getMetadata("local", threadId)?.sandbox).toBe("read-only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("mini P0-2: command/exec sandbox gate", () => {
  test("read-only threads reject exec, open threads allow it", async () => {
    const bridge = new MiniBridge();
    const cwd = mkdtempSync(join(tmpdir(), "mini-sandbox-exec-"));
    try {
      const ro = (await bridge.request("thread/start", { cwd, ownerId: "local", sandbox: "read-only" })) as {
        thread: { id: string };
      };
      await expect(
        bridge.request("command/exec", {
          threadId: ro.thread.id,
          command: [process.execPath, "-e", "1"],
          cwd,
          timeoutMs: 5000,
        }),
      ).rejects.toThrow("thread sandbox is read-only");

      const open = (await bridge.request("thread/start", { cwd, ownerId: "local" })) as {
        thread: { id: string };
      };
      const res = (await bridge.request("command/exec", {
        threadId: open.thread.id,
        command: [process.execPath, "-e", "process.stdout.write('ok')"],
        cwd,
        timeoutMs: 10000,
      })) as Record<string, unknown>;
      expect(res.exitCode).toBe(0);
      expect(String(res.stdout)).toContain("ok");
    } finally {
      bridge.stop();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
