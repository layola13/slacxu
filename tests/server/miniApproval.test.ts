import { describe, expect, test } from "bun:test";
import {
  MiniBridge,
  miniApprovalLane,
  miniApprovalTarget,
  miniNeedsApproval,
  parseMiniApprovalDecision,
} from "../../backends/mini/src/runtime/miniBridge.ts";

describe("mini approval gate predicate", () => {
  test("never and unset run without prompts; explicit policies ask", () => {
    expect(miniNeedsApproval(undefined, false)).toBe(false);
    expect(miniNeedsApproval("", false)).toBe(false);
    expect(miniNeedsApproval("never", false)).toBe(false);
    expect(miniNeedsApproval("  NEVER  ", false)).toBe(false);
    expect(miniNeedsApproval("bypass", false)).toBe(false);
    expect(miniNeedsApproval("on-request", false)).toBe(true);
    expect(miniNeedsApproval("untrusted", false)).toBe(true);
    // "Allow session" suppresses everything, even under ask policies.
    expect(miniNeedsApproval("on-request", true)).toBe(false);
    expect(miniNeedsApproval(undefined, true)).toBe(false);
  });
});

describe("mini approval lanes", () => {
  test("file lane covers deletion only", () => {
    for (const act of [
      "delete_file",
      "safe_delete",
      "delete",
      "remove_file",
    ]) {
      expect(miniApprovalLane(act)).toBe("file");
    }
  });

  test("exec lane covers js and py script execution only", () => {
    for (const act of [
      "run_js",
      "exec_js",
      "run_py",
      "exec_py",
      "run_python",
      "RUN_JS",
      "RUN_PY",
    ]) {
      expect(miniApprovalLane(act)).toBe("exec");
    }
  });

  test("non-delete mutations, host commands, and reads never gate", () => {
    for (const act of [
      "write_file",
      "edit_file",
      "apply_patch",
      "move_file",
      "copy_file",
      "rename_symbol",
      "extract_to_file",
      "add_import",
      "organize_imports",
      "run_host",
      "exec_host",
      "run_bun",
      "run_bun_profile",
      "run_project_check",
      "read_file",
      "list_dir",
      "grep_search",
      "git_status",
      "git_diff",
      "http_fetch",
      "",
      null,
      undefined,
    ]) {
      expect(miniApprovalLane(act)).toBeNull();
    }
  });

  test("target extraction prefers paths, then commands", () => {
    expect(miniApprovalTarget({ path: "a/b.ts" })).toBe("a/b.ts");
    expect(miniApprovalTarget({ action: "run_host", exe: "bun", args: ["x", "y"] })).toBe("bun x y");
    expect(miniApprovalTarget({ action: "write_file" })).toBe("");
    expect(miniApprovalTarget({})).toBe("");
  });
});

describe("mini approval decision parsing", () => {
  test("item/* and legacy spellings", () => {
    expect(parseMiniApprovalDecision({ decision: "accept" })).toBe("accept");
    expect(parseMiniApprovalDecision({ decision: "approved" })).toBe("accept");
    expect(parseMiniApprovalDecision({ decision: "acceptForSession" })).toBe("session");
    expect(parseMiniApprovalDecision({ decision: "approved_for_session" })).toBe("session");
    expect(parseMiniApprovalDecision({ decision: "decline" })).toBe("decline");
    expect(parseMiniApprovalDecision({ decision: "denied" })).toBe("decline");
    expect(parseMiniApprovalDecision({ decision: "cancel" })).toBe("cancel");
    expect(parseMiniApprovalDecision({ decision: "abort" })).toBe("cancel");
    expect(parseMiniApprovalDecision({})).toBe("decline");
    expect(parseMiniApprovalDecision(undefined)).toBe("decline");
    expect(parseMiniApprovalDecision({ decision: "accept" }, { message: "boom" })).toBe("cancel");
  });
});

describe("mini approval modal round-trip", () => {
  async function oneDecision(
    answer: { result?: Record<string, unknown>; error?: { message: string } } | "timeout",
  ): Promise<{ decision: string; method: string; params: Record<string, unknown> }> {
    const bridge = new MiniBridge();
    try {
      let seen: { id: string | number; method: string; params: Record<string, unknown> } | null = null;
      bridge.on("message", (msg: unknown) => {
        const m = msg as { id: string | number; method: string; params: Record<string, unknown> };
        if (m && typeof m === "object" && "id" in m) seen = { id: m.id, method: m.method, params: m.params };
      });
      const pending = bridge.requestMiniApproval(
        { threadId: "t-approval", cwd: "/tmp" } as never,
        "turn-1",
        "file",
        { action: "write_file", target: "a.txt", reason: "mini file change: sa_vm write_file a.txt" },
        answer === "timeout" ? 50 : 5000,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).not.toBeNull();
      expect(seen!.method).toBe("item/fileChange/requestApproval");
      expect(bridge.hasPendingApproval(String(seen!.id))).toBe(true);
      if (answer === "timeout") {
        const decision = await pending;
        return { decision, method: seen!.method, params: seen!.params };
      }
      bridge.respond(seen!.id, answer.result as never, answer.error as never);
      const decision = await pending;
      expect(bridge.hasPendingApproval(String(seen!.id))).toBe(false);
      return { decision, method: seen!.method, params: seen!.params };
    } finally {
      bridge.stop();
    }
  }

  test("accept proceeds", async () => {
    const r = await oneDecision({ result: { decision: "accept" } });
    expect(r.decision).toBe("accept");
    expect(r.params.threadId).toBe("t-approval");
  });

  test("acceptForSession grants the bypass", async () => {
    const r = await oneDecision({ result: { decision: "acceptForSession" } });
    expect(r.decision).toBe("session");
  });

  test("decline denies", async () => {
    const r = await oneDecision({ result: { decision: "decline" } });
    expect(r.decision).toBe("decline");
  });

  test("cancel aborts", async () => {
    const r = await oneDecision({ result: { decision: "cancel" } });
    expect(r.decision).toBe("cancel");
  });

  test("error cancels", async () => {
    const r = await oneDecision({ error: { message: "gone" } });
    expect(r.decision).toBe("cancel");
  });

  test("silence times out into decline", async () => {
    const r = await oneDecision("timeout");
    expect(r.decision).toBe("timeout");
  });

  test("exec lane uses the command-execution method", async () => {
    const bridge = new MiniBridge();
    try {
      let method = "";
      bridge.on("message", (msg: unknown) => {
        const m = msg as { method: string };
        if (m && typeof m === "object" && "id" in m) method = m.method;
      });
      const pending = bridge.requestMiniApproval(
        { threadId: "t-exec", cwd: "/tmp" } as never,
        "turn-1",
        "exec",
        { action: "run_host", target: "bun x", reason: "mini command execution" },
        5000,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(method).toBe("item/commandExecution/requestApproval");
      // Interrupt semantics: aborting the thread cancels the card.
      (bridge as unknown as { abortPendingUserInput: (t: string) => void }).abortPendingUserInput("t-exec");
      await expect(pending).resolves.toBe("cancel");
    } finally {
      bridge.stop();
    }
  });

  test("respond on unknown ids is a safe no-op", () => {
    const bridge = new MiniBridge();
    expect(() => bridge.respond("missing-approval", { decision: "accept" })).not.toThrow();
    expect(bridge.hasPendingApproval("missing-approval")).toBe(false);
    bridge.stop();
  });
});
