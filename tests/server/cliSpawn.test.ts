import { expect, test } from "bun:test";
import { resolveCliSpawn, spawnCliSync } from "../../sdk-backend/src/cliSpawn.js";

// The three Phase-8 backends (auggie / cline / command-code) spawn npm
// CLIs that land on Windows as `.cmd` shims under paths like
// `d:\Program Files\nodejs\`. Node/Bun refuse to spawn those directly
// (EINVAL), and feeding the shim to `node` exits with code 1. The SDK
// resolver — the same logic the Codex backend has always used — wraps
// shims in cmd.exe instead.

const WIN_ENV = { ComSpec: "C:\\Windows\\System32\\cmd.exe" };

test("wraps a Windows .cmd shim in cmd.exe with the path quoted", () => {
  const resolved = resolveCliSpawn(
    "d:\\Program Files\\nodejs\\cline.cmd",
    ["hub", "start", "--discovery-path", "C:\\data\\hub-discovery.json"],
    "win32",
    WIN_ENV,
  );
  expect(resolved.usesCommandShim).toBe(true);
  expect(resolved.command).toBe("C:\\Windows\\System32\\cmd.exe");
  expect(resolved.args).toEqual([
    "/d",
    "/s",
    "/c",
    'call "d:\\Program Files\\nodejs\\cline.cmd" hub start --discovery-path C:\\data\\hub-discovery.json',
  ]);
});

test("wraps .bat shims and bare command names on Windows", () => {
  expect(resolveCliSpawn("C:\\tools\\command-code.bat", ["-p"], "win32", WIN_ENV).usesCommandShim).toBe(true);
  const bare = resolveCliSpawn("auggie", ["--acp"], "win32", WIN_ENV);
  expect(bare.usesCommandShim).toBe(true);
  expect(bare.args[3]).toBe("call auggie --acp");
});

test("runs .ps1 shims through powershell.exe -File", () => {
  const resolved = resolveCliSpawn("C:\\tools\\cline.ps1", ["--version"], "win32", {
    SystemRoot: "C:\\Windows",
  });
  expect(resolved.usesCommandShim).toBe(true);
  // On a host where no powershell.exe exists at the SystemRoot candidate
  // paths, the resolver falls back to the bare name (verbatim host logic).
  expect(resolved.command).toBe("powershell.exe");
  expect(resolved.args).toEqual([
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "C:\\tools\\cline.ps1",
    "--version",
  ]);
});

test("passes real executables and non-Windows platforms through untouched", () => {
  const exe = resolveCliSpawn("C:\\tools\\cline.exe", ["--version"], "win32", WIN_ENV);
  expect(exe).toEqual({ command: "C:\\tools\\cline.exe", args: ["--version"], usesCommandShim: false });
  const linux = resolveCliSpawn("/home/user/.local/bin/cline.cmd", ["--version"], "linux", {});
  expect(linux.usesCommandShim).toBe(false);
  expect(linux.command).toBe("/home/user/.local/bin/cline.cmd");
  const mac = resolveCliSpawn("/usr/local/bin/auggie", ["--acp"], "darwin", {});
  expect(mac.usesCommandShim).toBe(false);
});

test("quotes cmd arguments containing spaces and escapes %", () => {
  const resolved = resolveCliSpawn("C:\\tools\\cline.cmd", ["--label", "my workspace", "100%"], "win32", WIN_ENV);
  expect(resolved.args[3]).toBe('call C:\\tools\\cline.cmd --label "my workspace" "100%%"');
});

test("spawnCliSync runs a real executable through the passthrough path", () => {
  const result = spawnCliSync(process.execPath, ["--version"], { encoding: "utf8", timeout: 10_000 });
  expect(result.status).toBe(0);
  expect(String(result.stdout)).toMatch(/v?\d+\.\d+\.\d+/);
});
