import { expect, test } from "bun:test";
import {
  defaultLocalWorkspacePath,
  joinWorkspacePath,
  normalizeWorkspaceCwd,
  normalizeWorkspaceRoots,
  parentWorkspacePath,
  resolveTildeWorkspacePath,
  resolveWorkspaceNewFolderPath
} from "../../apps/web/src/workspacePaths.ts";

test("keeps Unix and home-relative workspace behavior", () => {
  expect(defaultLocalWorkspacePath("linux", "/home/user", "/srv/app")).toBe("/home/user");
  expect(defaultLocalWorkspacePath("linux", undefined, undefined)).toBe("/");
  expect(normalizeWorkspaceCwd("/home/user/projects/")).toBe("/home/user/projects");
  expect(parentWorkspacePath("~/projects/app")).toBe("~/projects");
  expect(joinWorkspacePath("/home/user", "projects")).toBe("/home/user/projects");
});

test("resolves tilde workspace paths against the server home on POSIX", () => {
  expect(resolveTildeWorkspacePath("~/.opencode", "/root", "linux")).toBe("/root/.opencode");
  expect(resolveTildeWorkspacePath("~/", "/home/user", "linux")).toBe("/home/user/");
  expect(resolveTildeWorkspacePath("~", "/root", "linux")).toBe("/root");
  expect(resolveTildeWorkspacePath("/root/.opencode", "/root", "linux")).toBe("/root/.opencode");
  expect(resolveTildeWorkspacePath("~/.opencode", "/root", "win32")).toBe("~/.opencode");
  expect(resolveTildeWorkspacePath("~/.opencode", undefined, "linux")).toBe("~/.opencode");
  expect(resolveTildeWorkspacePath("~/.opencode", "~/", "linux")).toBe("~/.opencode");
});

test("normalizes Windows drive paths without losing the drive root", () => {
  expect(defaultLocalWorkspacePath("win32", "C:\\Users\\zhan", "E:\\projects")).toBe("C:\\Users\\zhan");
  expect(normalizeWorkspaceCwd("E:/projects/code-launch/")).toBe("E:\\projects\\code-launch");
  expect(normalizeWorkspaceCwd("D:\\")).toBe("D:\\");
  expect(parentWorkspacePath("E:\\projects\\code-launch")).toBe("E:\\projects");
  expect(parentWorkspacePath("E:\\projects")).toBe("E:\\");
  expect(parentWorkspacePath("E:\\")).toBeNull();
});

test("joins and creates folders on the selected Windows drive", () => {
  expect(joinWorkspacePath("F:\\project", "next")).toBe("F:\\project\\next");
  expect(resolveWorkspaceNewFolderPath("F:\\project", "new-workspace")).toBe("F:\\project\\new-workspace");
  expect(resolveWorkspaceNewFolderPath("C:\\Users", "E:/external/repo")).toBe("E:\\external\\repo");
});

test("normalizes additional writable roots and removes the primary folder", () => {
  expect(normalizeWorkspaceRoots(String.raw`C:\Work`, ["C:/Work", "D:/Shared", "d:/shared", ""])).toEqual([String.raw`D:\Shared`]);
});
