import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { handleWorkspaceGitRpc, resolveRepoPath } from "../../apps/server/src/gitWorkspace";
import {
  POWERSHELL_UTF8_BOOTSTRAP,
  chunkTerminalInput,
  defaultShell,
  terminalLocaleEnv
} from "../../apps/server/src/terminalPty";

const execFileAsync = promisify(execFile);

// ---- Git ----

test("resolveRepoPath accepts git's forward-slash toplevel and drive-letter casing on win32", () => {
  if (process.platform !== "win32") return;
  expect(resolveRepoPath("D:/repo", "src\\a.ts")).toBe("D:\\repo\\src\\a.ts");
  expect(resolveRepoPath("d:/Repo", "src/a.ts", "win32").toLowerCase()).toBe("d:\\repo\\src\\a.ts");
  expect(() => resolveRepoPath("D:/repo", "..\\other\\x")).toThrow(/outside the repository/);
});

test("resolveRepoPath works for a drive/filesystem root repo and rejects escapes", () => {
  const root = process.platform === "win32" ? "C:\\" : "/";
  const inside = resolveRepoPath(root, "proj/file.txt");
  expect(inside.replace(/\\/g, "/").endsWith("proj/file.txt")).toBe(true);
  expect(() => resolveRepoPath("/srv/repo", "../etc/passwd", "linux")).toThrow(/outside the repository/);
  // A sibling sharing the prefix must not count as inside.
  expect(() => resolveRepoPath("/srv/repo", "/srv/repo-evil/x", "linux")).toThrow(/outside the repository/);
});

test("git status keeps non-ASCII file names unquoted and untracked diff is repo-relative", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cxu-git-cjk-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: dir });
    await writeFile(join(dir, "中文 文件.txt"), "你好\n");
    const status = await handleWorkspaceGitRpc("ui/git/status", { cwd: dir }) as { entries: Array<{ path: string; untracked: boolean }> };
    expect(status.entries.map((e) => e.path)).toContain("中文 文件.txt");
    const diff = await handleWorkspaceGitRpc("ui/git/diff", { cwd: dir, path: "中文 文件.txt" }) as { patch: string };
    expect(diff.patch).toContain("+你好");
    // No absolute path (`D:\...` / `/tmp/...`) leaks into the patch header.
    expect(diff.patch).not.toContain(dir.replace(/\\/g, "/"));
    expect(diff.patch).toContain("b/中文 文件.txt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

// ---- Terminal ----

test("POSIX default shell uses -l (dash/busybox safe) and falls back to /bin/sh", () => {
  const shell = defaultShell("linux", { SHELL: "/usr/bin/fish" }, (p) => p === "/usr/bin/fish");
  expect(shell).toEqual({ file: "/usr/bin/fish", args: ["-l"] });
  expect(defaultShell("linux", {}, () => false)).toEqual({ file: "/bin/sh", args: ["-l"] });
});

test("Windows default shell honors ProgramFiles and forces UTF-8 for PowerShell/cmd", () => {
  const pwsh = "E:\\Apps\\PowerShell\\7\\pwsh.exe";
  const env = { ProgramFiles: "E:\\Apps", SystemRoot: "C:\\Windows" };
  const shell = defaultShell("win32", env, (p) => p.replace(/\//g, "\\") === pwsh);
  expect(shell.file.replace(/\//g, "\\")).toBe(pwsh);
  expect(shell.args).toEqual(["-NoLogo", "-NoProfile", "-NoExit", "-Command", POWERSHELL_UTF8_BOOTSTRAP]);
  const cmd = defaultShell("win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" }, (p) => p.endsWith("cmd.exe"));
  expect(cmd.args).toEqual(["/K", "chcp 65001>nul"]);
});

test("terminal locale defaults to C.UTF-8 only when no locale is configured (POSIX only)", () => {
  expect(terminalLocaleEnv("linux", {})).toEqual({ LANG: "C.UTF-8" });
  expect(terminalLocaleEnv("linux", { LANG: "zh_CN.UTF-8" })).toEqual({});
  expect(terminalLocaleEnv("darwin", { LC_ALL: "en_US.UTF-8" })).toEqual({});
  expect(terminalLocaleEnv("win32", {})).toEqual({});
});

test("chunkTerminalInput never splits a surrogate pair and preserves content", () => {
  const text = `${"a".repeat(4095)}😀${"b".repeat(5000)}`;
  const pieces = chunkTerminalInput(text, 4096);
  expect(pieces.join("")).toBe(text);
  expect(pieces.every((p) => p.length <= 4096)).toBe(true);
  expect(pieces[0]!.endsWith("a")).toBe(true);
  expect(pieces[1]!.startsWith("😀")).toBe(true);
});
