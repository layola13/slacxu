import { describe, expect, test } from "bun:test";
import { committedTurnResult, resolveThreadWorkspace, validateSameThreadRollback } from "../../apps/web/src/app/threads/editConversation";

describe("edited conversation commit", () => {
  test("keeps a successful turn commit successful after reconciliation fails", () => {
    expect(committedTurnResult("thread-1", true)).toBe("thread-1");
    expect(committedTurnResult("thread-1", false)).toBeNull();
    expect(committedTurnResult(null, true)).toBeNull();
  });

  test("accepts only the original thread id after rollback", () => {
    expect(() => validateSameThreadRollback("thread-1", "thread-1")).not.toThrow();
    expect(() => validateSameThreadRollback("thread-1", "thread-copy")).toThrow("different conversation");
    expect(() => validateSameThreadRollback("thread-1", null)).toThrow("rolled-back conversation id");
  });

  test("keeps local and SSH edit routing isolated", () => {
    const fallback = {
      workspaceMode: "ssh" as const,
      sshCommand: "ssh remote.example",
      localCwd: "E:\\projects\\local",
      sshCwd: "/home/remote/project"
    };
    expect(resolveThreadWorkspace({ workspaceMode: "local", cwd: "E:\\projects\\local-thread" }, fallback)).toEqual({
      workspaceMode: "local",
      sshCommand: "",
      cwd: "E:\\projects\\local-thread",
      additionalRoots: []
    });
    expect(resolveThreadWorkspace({
      workspaceMode: "ssh",
      sshCommand: "ssh target.example",
      sshCwd: "/srv/target",
      additionalRoots: ["/srv/shared", "/srv/data"]
    }, { ...fallback, workspaceMode: "local" })).toEqual({
      workspaceMode: "ssh",
      sshCommand: "ssh target.example",
      cwd: "/srv/target",
      additionalRoots: ["/srv/shared", "/srv/data"]
    });
    expect(resolveThreadWorkspace(undefined, fallback)).toEqual({
      workspaceMode: "ssh",
      sshCommand: "ssh remote.example",
      cwd: "/home/remote/project",
      additionalRoots: []
    });
  });
});
