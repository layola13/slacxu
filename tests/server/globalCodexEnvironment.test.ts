import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setGlobalCodexEnvironment } from "../../apps/server/src/globalCodexEnvironment.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("publishes virtual CODEX_HOME and restores the previous value", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "codex-global-env-"));
  dirs.push(dataDir);
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawn = (command: string, args: string[]) => { calls.push({ command, args }); return { status: 0 }; };
  const first = setGlobalCodexEnvironment({ enabled: true, virtualCodexHome: "C:\\virtual-codex", dataDir, platform: "win32", env: { CODEX_HOME: "C:\\user-codex" }, spawnSyncFn: spawn });
  const second = setGlobalCodexEnvironment({ enabled: false, virtualCodexHome: "C:\\virtual-codex", dataDir, platform: "win32", env: {}, spawnSyncFn: spawn });
  expect(first.enabled).toBe(true);
  expect(second.restored).toBe("C:\\user-codex");
  expect(calls[0]?.args).toEqual(["CODEX_HOME", "C:\\virtual-codex"]);
  expect(calls[1]?.args).toEqual(["CODEX_HOME", "C:\\user-codex"]);
});

test("does not touch environment on non-Windows", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "codex-global-env-"));
  dirs.push(dataDir);
  let called = false;
  const result = setGlobalCodexEnvironment({ enabled: true, virtualCodexHome: "/tmp/virtual-codex", dataDir, platform: "linux", spawnSyncFn: () => { called = true; return { status: 0 }; } });
  expect(result.skipped).toBe(true);
  expect(called).toBe(false);
});
