import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  codexAppServerArgs,
  findBundledCodexAppServerBinary,
  findChatGptBundledCodexBinary,
  findCodexBinary,
  isCodexCliAvailable,
  resolveCodexSpawn,
  resolveWindowsComSpec,
} from "../../apps/server/src/codexCommand.js";

test("runs a Windows npm command shim through cmd.exe", () => {
  const resolved = resolveCodexSpawn(
    "D:\\Program Files\\nodejs\\codex.cmd",
    ["app-server", "--stdio"],
    "win32",
    { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  );

  expect(resolved).toEqual({
    command: "C:\\Windows\\System32\\cmd.exe",
    args: [
      "/d",
      "/s",
      "/c",
      'call "D:\\Program Files\\nodejs\\codex.cmd" app-server --stdio',
    ],
    usesCommandShim: true,
  });
});

test("runs native Codex binaries directly", () => {
  expect(resolveCodexSpawn("codex", ["--version"], "linux", {})).toEqual({
    command: "codex",
    args: ["--version"],
    usesCommandShim: false,
  });
});

test("runs a bare Codex command through cmd.exe on Windows", () => {
  expect(resolveCodexSpawn("codex", ["app-server", "--stdio"], "win32", {
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
  })).toEqual({
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "call codex app-server --stdio"],
    usesCommandShim: true,
  });
});

test("never falls back to a bare cmd.exe name (Bun standalone compat)", () => {
  // Empty env (as in a slim Bun standalone inheritance) must still resolve
  // to an absolute System32 path so spawn failures name the real cause.
  // Note: the resolver also consults process.env, so compare case-insensitively.
  expect(resolveWindowsComSpec({}).toLowerCase()).toBe("c:\\windows\\system32\\cmd.exe");
  const resolved = resolveCodexSpawn("claude", ["--version"], "win32", {});
  expect(resolved.usesCommandShim).toBe(true);
  expect(resolved.command.toLowerCase()).toBe("c:\\windows\\system32\\cmd.exe");
});

test("uses the standalone app-server contract for bundled binaries", () => {
  expect(codexAppServerArgs("D:\\Codex Ultra\\codex_app_server.exe")).toEqual(["--listen=stdio://"]);
  expect(codexAppServerArgs("D:\\npm\\codex.exe")).toEqual(["app-server", "--stdio"]);
});

test("finds the bundled standalone app-server before PATH on Windows", () => {
  const root = path.join(os.tmpdir(), `codex-bundled-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  const bundled = path.join(root, "codex-app-server.exe");
  writeFileSync(bundled, "native executable");

  expect(findBundledCodexAppServerBinary("win32", {}, root)).toBe(bundled);
  expect(findCodexBinary(undefined, "win32", {
    PATH: "",
    CODEX_UI_CODEX_APP_SERVER_BIN: bundled,
  }, () => undefined)).toBe(bundled);
});

test("prefers a Windows command shim over an extensionless npm shell script", () => {
  const binDir = path.join(os.tmpdir(), `codex-command-${process.pid}-${Date.now()}`);
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(binDir, "codex"), "#!/bin/sh\n");
  writeFileSync(path.join(binDir, "codex.cmd"), "@echo off\r\n");

  expect(findCodexBinary(undefined, "win32", { PATH: binDir, PATHEXT: ".COM;.EXE;.CMD;.BAT" }, undefined, binDir))
    .toBe(path.join(binDir, "codex.cmd"));
});

test("uses ChatGPT's bundled native Codex binary when Codex is not configured or on PATH", () => {
  const installDir = path.join(os.tmpdir(), `chatgpt-${process.pid}-${Date.now()}`);
  const bundledCodex = path.join(installDir, "app", "resources", "codex.exe");
  mkdirSync(path.dirname(bundledCodex), { recursive: true });
  writeFileSync(bundledCodex, "native executable");

  expect(findCodexBinary(undefined, "win32", { PATH: "" }, () => installDir, path.join(os.tmpdir(), `empty-${process.pid}-${Date.now()}`))).toBe(bundledCodex);
});

test("keeps configured and PATH Codex binaries ahead of ChatGPT's bundled copy", () => {
  const binDir = path.join(os.tmpdir(), `codex-path-${process.pid}-${Date.now()}`);
  const installDir = path.join(os.tmpdir(), `chatgpt-${process.pid}-${Date.now()}`);
  const pathCodex = path.join(binDir, "codex.exe");
  const bundledCodex = path.join(installDir, "app", "resources", "codex.exe");
  const configuredCodex = path.join(os.tmpdir(), `configured-codex-${process.pid}-${Date.now()}.exe`);
  mkdirSync(binDir, { recursive: true });
  mkdirSync(path.dirname(bundledCodex), { recursive: true });
  writeFileSync(pathCodex, "native executable");
  writeFileSync(bundledCodex, "native executable");
  writeFileSync(configuredCodex, "native executable");

  const emptyRoot = path.join(os.tmpdir(), `empty-${process.pid}-${Date.now()}`);
  expect(findCodexBinary(undefined, "win32", { PATH: binDir }, () => installDir, emptyRoot)).toBe(pathCodex);
  expect(findCodexBinary(configuredCodex, "win32", { PATH: binDir }, () => installDir, emptyRoot)).toBe(configuredCodex);
});

test("accepts only the ChatGPT resources Codex executable", () => {
  const installDir = path.join(os.tmpdir(), `chatgpt-${process.pid}-${Date.now()}`);
  const launcher = path.join(installDir, "app", "Codex.exe");
  mkdirSync(path.dirname(launcher), { recursive: true });
  writeFileSync(launcher, "launcher executable");

  expect(findChatGptBundledCodexBinary("win32", () => installDir)).toBeUndefined();
});

test("does not look for a ChatGPT bundle outside Windows", () => {
  expect(findChatGptBundledCodexBinary("linux", () => {
    throw new Error("should not run");
  })).toBeUndefined();
});

test("isCodexCliAvailable respects explicit CODEX_UI_CODEX_AVAILABLE overrides", () => {
  expect(isCodexCliAvailable("win32", { CODEX_UI_CODEX_AVAILABLE: "1" })).toBe(true);
  expect(isCodexCliAvailable("win32", { CODEX_UI_CODEX_AVAILABLE: "true" })).toBe(true);
  expect(isCodexCliAvailable("win32", { CODEX_UI_CODEX_AVAILABLE: "0" })).toBe(false);
  expect(isCodexCliAvailable("win32", { CODEX_UI_CODEX_AVAILABLE: "false" })).toBe(false);
});

test("isCodexCliAvailable discovers launchable Codex binary when env var is unset", () => {
  const binDir = path.join(os.tmpdir(), `codex-avail-${process.pid}-${Date.now()}`);
  mkdirSync(binDir, { recursive: true });
  const codexBin = path.join(binDir, "codex.exe");
  writeFileSync(codexBin, "native executable");

  expect(isCodexCliAvailable("win32", { PATH: binDir }, () => undefined, path.join(os.tmpdir(), `empty-${process.pid}`))).toBe(true);
  expect(isCodexCliAvailable("win32", { PATH: "" }, () => undefined, path.join(os.tmpdir(), `empty-${process.pid}`))).toBe(false);
});

test("isCodexCliAvailable returns false on unsupported platforms like freebsd", () => {
  expect(isCodexCliAvailable("freebsd", { CODEX_UI_CODEX_AVAILABLE: "1" })).toBe(false);
  expect(isCodexCliAvailable("openbsd", { CODEX_UI_CODEX_AVAILABLE: "1" })).toBe(false);
  expect(isCodexCliAvailable("sunos", { CODEX_UI_CODEX_AVAILABLE: "1" })).toBe(false);
});

