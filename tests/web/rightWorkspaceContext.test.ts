import { expect, test } from "bun:test";
import { conversationWorkspaceMetadata, projectWorkspaceDirectories, shouldCommitWorkspaceRequest, workspaceDirectoryCacheKey } from "../../apps/web/src/app/workspace/rightWorkspaceContext.ts";

test("keeps workspace routing independent for each conversation", () => {
  const visible = [
    { id: "local-thread", workspaceMode: "local" as const, cwd: "E:/projects/local" },
    { id: "ssh-thread", cwd: "/home/remote/project" }
  ];
  const catalog = [
    { id: "local-thread", workspaceMode: "ssh" as const, sshCommand: "ssh stale", sshCwd: "/stale" },
    { id: "ssh-thread", workspaceMode: "ssh" as const, sshCommand: "ssh remote", sshCwd: "/home/remote/project" }
  ];

  expect(conversationWorkspaceMetadata("local-thread", visible, catalog)).toEqual({
    workspaceMode: "local",
    cwd: "E:/projects/local",
    additionalRoots: []
  });
  expect(conversationWorkspaceMetadata("ssh-thread", visible, catalog)).toEqual({
    workspaceMode: "ssh",
    sshCommand: "ssh remote",
    sshCwd: "/home/remote/project",
    cwd: "/home/remote/project",
    additionalRoots: []
  });
  expect(conversationWorkspaceMetadata(null, visible, catalog)).toBeUndefined();
});

test("projects only the selected SSH host cache using real remote paths", () => {
  const cache = {
    "C:/local": ["local"],
    [workspaceDirectoryCacheKey("ssh", "ssh alpha", "/home/a")]: ["alpha-root"],
    [workspaceDirectoryCacheKey("ssh", "ssh alpha", "/home/a/src")]: ["alpha-src"],
    [workspaceDirectoryCacheKey("ssh", "ssh beta", "/home/b")]: ["beta-root"]
  };

  expect(projectWorkspaceDirectories(cache, "ssh", "ssh alpha")).toEqual({
    "/home/a": ["alpha-root"],
    "/home/a/src": ["alpha-src"]
  });
  expect(projectWorkspaceDirectories(cache, "local", "")).toEqual({ "C:/local": ["local"] });
});

test("rejects stale workspace results after context change or close", () => {
  expect(shouldCommitWorkspaceRequest(4, 4, true)).toBe(true);
  expect(shouldCommitWorkspaceRequest(4, 5, true)).toBe(false);
  expect(shouldCommitWorkspaceRequest(4, 4, false)).toBe(false);
});
