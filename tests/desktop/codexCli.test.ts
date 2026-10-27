import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { INSTALL_COMMAND, findCodexCli, resolveCodexVersionProbe } = require("../../desktop/codex-cli.cjs") as {
  INSTALL_COMMAND: string;
  findCodexCli: (
    env: NodeJS.ProcessEnv,
    platform: NodeJS.Platform,
    probe: (command: string) => string | { version: string; appServerSupported: boolean } | null,
    report?: (attempt: { candidate: string; detail: string }) => void,
    installDirectory?: string,
    bundledDirectory?: string,
  ) => { command: string; version: string; env: NodeJS.ProcessEnv } | null;
  resolveCodexVersionProbe: (
    command: string,
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv,
  ) => { executable: string; args: string[]; windowsVerbatimArguments: boolean };
};

test("uses an explicitly configured Codex executable before PATH", () => {
  const detected = findCodexCli(
    { CODEX_BIN: "codex-custom", PATH: "C:\\Windows\\System32" },
    "win32",
    (command) => command === "codex-custom" ? "codex-cli 1.2.3" : null
  );
  expect(detected?.command).toBe("codex-custom");
  expect(detected?.version).toBe("codex-cli 1.2.3");
  expect(detected?.env.CODEX_BIN).toBe("codex-custom");
});

test("reports a missing CLI and exposes the supported npm install command", () => {
  expect(findCodexCli({ PATH: "" }, "linux", () => null)).toBeNull();
  expect(INSTALL_COMMAND).toBe("npm install -g @openai/codex");
});

test("keeps the absolute Windows npm shim path for the Node server", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-cli-test-"));
  try {
    const npmDirectory = join(root, "npm");
    const shim = join(npmDirectory, "codex.cmd");
    require("node:fs").mkdirSync(npmDirectory, { recursive: true });
    writeFileSync(shim, "@echo off\r\n");
    const detected = findCodexCli(
      { APPDATA: root, PATH: "C:\\Windows\\System32" },
      "win32",
      (command) => command === shim ? "codex-cli 0.145" : null,
    );
    expect(detected?.command).toBe(shim);
    expect(detected?.env.CODEX_BIN).toBe(shim);
    expect(detected?.env.PATH?.startsWith(npmDirectory)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts Path casing used by some Windows launch environments", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-cli-path-test-"));
  try {
    const shim = join(root, "codex.cmd");
    writeFileSync(shim, "@echo off\r\n");
    const detected = findCodexCli(
      { Path: root },
      "win32",
      (command) => command === shim ? "codex-cli 0.145" : null,
    );
    expect(detected?.command).toBe(shim);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports failed candidates for desktop diagnostics", () => {
  const attempts: Array<{ candidate: string; detail: string }> = [];
  expect(findCodexCli(
    { PATH: "" },
    "linux",
    () => null,
    (attempt) => attempts.push(attempt),
  )).toBeNull();
  expect(attempts).toEqual([{ candidate: "codex", detail: "version probe failed" }]);
});

test("prefers the native Windows Codex binary behind an npm shim", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-cli-native-test-"));
  try {
    const npmDirectory = join(root, "npm");
    const shim = join(npmDirectory, "codex.cmd");
    const nativeBinary = join(
      npmDirectory,
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    );
    mkdirSync(join(nativeBinary, ".."), { recursive: true });
    writeFileSync(shim, "@echo off\r\n");
    writeFileSync(nativeBinary, "native codex placeholder");
    const detected = findCodexCli(
      { APPDATA: root, PATH: "C:\\Windows\\System32" },
      "win32",
      (command) => command === nativeBinary ? "codex-cli 0.145" : null,
    );
    expect(detected?.command).toBe(nativeBinary);
    expect(detected?.env.CODEX_BIN).toBe(nativeBinary);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("skips an older Codex CLI that cannot run app-server", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-cli-version-test-"));
  try {
    const appDataDirectory = join(root, "appdata");
    const oldDirectory = join(appDataDirectory, "npm");
    const currentDirectory = join(root, "current");
    require("node:fs").mkdirSync(oldDirectory, { recursive: true });
    require("node:fs").mkdirSync(currentDirectory, { recursive: true });
    const oldShim = join(oldDirectory, "codex.cmd");
    const currentShim = join(currentDirectory, "codex.cmd");
    writeFileSync(oldShim, "@echo off\r\n");
    writeFileSync(currentShim, "@echo off\r\n");
    const attempts: Array<{ candidate: string; detail: string }> = [];
    const detected = findCodexCli(
      { APPDATA: appDataDirectory, PATH: currentDirectory },
      "win32",
      (command) => command === oldShim
        ? { version: "codex-cli 0.40.0", appServerSupported: false }
        : command === currentShim
          ? { version: "codex-cli 0.145.0", appServerSupported: true }
          : null,
      (attempt) => attempts.push(attempt),
    );
    expect(detected?.command).toBe(currentShim);
    expect(attempts.some((attempt) => attempt.candidate === oldShim && attempt.detail.includes("does not support codex app-server"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses codex.exe beside Codex Ultra after configured and PATH candidates", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-cli-install-directory-test-"));
  try {
    const pathDirectory = join(root, "path");
    const installedCodex = join(root, "codex.exe");
    const pathCodex = join(pathDirectory, "codex.exe");
    mkdirSync(pathDirectory, { recursive: true });
    writeFileSync(installedCodex, "native codex placeholder");
    writeFileSync(pathCodex, "native codex placeholder");
    const attempts: string[] = [];
    const detected = findCodexCli(
      { PATH: pathDirectory },
      "win32",
      (command) => {
        attempts.push(command);
        return command === installedCodex ? "codex-cli 0.145.0" : null;
      },
      undefined,
      root,
    );
    expect(detected?.command).toBe(installedCodex);
    expect(attempts.indexOf(pathCodex)).toBeLessThan(attempts.indexOf(installedCodex));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detects the bundled standalone app-server without requiring a Codex CLI install", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-cli-bundled-server-test-"));
  try {
    const bundled = join(root, "codex-app-server.exe");
    writeFileSync(bundled, "native app-server placeholder");
    const detected = findCodexCli(
      { PATH: "" },
      "win32",
      (command) => command === bundled ? { version: "codex-app-server 0.0.0", appServerSupported: true } : null,
      undefined,
      undefined,
      root,
    );
    expect(detected?.command).toBe(bundled);
    expect(detected?.env.CODEX_BIN).toBe(bundled);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("probes Windows npm command shims without turning quotes into literal characters", () => {
  const probe = resolveCodexVersionProbe(
    "D:\\Program Files\\nodejs\\codex.cmd",
    "win32",
    { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  );
  expect(probe).toEqual({
    executable: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", 'call "D:\\Program Files\\nodejs\\codex.cmd" --version'],
    windowsVerbatimArguments: true,
  });
});
