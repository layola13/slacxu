import { EventEmitter } from "node:events";
import { expect, test } from "bun:test";
import { join } from "node:path";

const { openWithArgs, resolveDesktopApps, spawnDetached } = require("../../desktop/open-with.cjs") as {
  openWithArgs(appId: string, target: { cwd: string; sshCommand?: string; sshCwd?: string }): string[] | null;
  resolveDesktopApps(options: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; execFileSync: (...args: any[]) => string; pathExists?: (path: string) => boolean }): Array<{ id: string; label: string; executable: string }>;
  spawnDetached(spawn: (...args: any[]) => EventEmitter & { unref(): void }, executable: string, args: string[]): Promise<boolean>;
};

test("resolves a Windows GUI executable from its actual install directory", () => {
  const local = "C:\\Users\\test\\AppData\\Local";
  const expected = join(local, "Programs", "Microsoft VS Code", "Code.exe");
  const apps = resolveDesktopApps({
    platform: "win32", env: { LOCALAPPDATA: local, ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    execFileSync: () => "C:\\tools\\code\nC:\\tools\\code.cmd\n", pathExists: (candidate) => candidate === expected
  });
  expect(apps.find((app) => app.id === "vscode")?.executable).toBe(expected);
});

test("falls back to a PATH launcher when no standard GUI install exists", () => {
  const apps = resolveDesktopApps({
    platform: "win32", env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    execFileSync: (_file, args) => args[0] === "code" ? "C:\\tools\\code.cmd\n" : "", pathExists: () => false
  });
  expect(apps.find((app) => app.id === "vscode")?.executable).toBe("C:\\tools\\code.cmd");
});

test("infers the real GUI executable from a nonstandard-drive PATH launcher", () => {
  const executable = "E:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe";
  const apps = resolveDesktopApps({
    platform: "win32", env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    execFileSync: (_file, args) => args[0] === "code"
      ? "E:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code\n"
      : "",
    pathExists: (candidate) => candidate.toLowerCase() === executable.toLowerCase()
  });
  expect(apps.find((app) => app.id === "vscode")?.executable.toLowerCase()).toBe(executable.toLowerCase());
});

test("builds local and SSH VS Code workspace arguments", () => {
  expect(openWithArgs("vscode", { cwd: "E:\\projects\\sci" })).toEqual(["--reuse-window", "E:\\projects\\sci"]);
  expect(openWithArgs("vscode", { cwd: "", sshCommand: "ssh vscode@45.129.8.163", sshCwd: "~/projects" })).toEqual([
    "--reuse-window", "--remote", "ssh-remote+vscode@45.129.8.163", "~/projects"
  ]);
  expect(openWithArgs("zed", { cwd: "", sshCommand: "ssh host" })).toBeNull();
});

test("reports asynchronous launch success and failure accurately", async () => {
  let unrefCalled = false;
  const success = await spawnDetached(() => {
    const child = Object.assign(new EventEmitter(), { unref: () => { unrefCalled = true; } });
    queueMicrotask(() => child.emit("spawn"));
    return child;
  }, "Code.exe", []);
  expect(success).toBe(true);
  expect(unrefCalled).toBe(true);

  const failure = await spawnDetached(() => {
    const child = Object.assign(new EventEmitter(), { unref: () => {} });
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));
    return child;
  }, "missing.exe", []);
  expect(failure).toBe(false);
});
