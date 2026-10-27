import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { codexPlatformRuntimeEnv } from "../../apps/server/src/codexRuntimeEnv.ts";

test("keeps the inherited temp environment on non-Windows platforms", () => {
  expect(codexPlatformRuntimeEnv("linux", "/srv/codex-ui", { TEMP: "/tmp/inherited" })).toEqual({});
});

test("creates an isolated Windows temp directory without overriding global CODEX_HOME", () => {
  const dataDir = join(tmpdir(), `codex-ultra-runtime-${randomUUID()}`);
  try {
    const runtimeEnv = codexPlatformRuntimeEnv("win32", dataDir, {});
    const expected = join(dataDir, "codex-tmp");
    expect(runtimeEnv).toEqual({
      TEMP: expected,
      TMP: expected,
      CODEX_SQLITE_HOME: join(homedir(), ".codex")
    });
    expect(existsSync(expected)).toBe(true);
    expect("CODEX_HOME" in runtimeEnv).toBe(false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("honors an explicit Windows Codex temp directory", () => {
  const dataDir = join(tmpdir(), `codex-ultra-runtime-${randomUUID()}`);
  const override = join(dataDir, "custom-temp");
  try {
    expect(codexPlatformRuntimeEnv("win32", dataDir, { CODEX_UI_CODEX_TEMP_DIR: override })).toEqual({
      TEMP: override,
      TMP: override,
      CODEX_SQLITE_HOME: join(homedir(), ".codex")
    });
    expect(existsSync(override)).toBe(true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("keeps SQLite state in an explicitly configured real Codex home", () => {
  const dataDir = join(tmpdir(), `codex-ultra-runtime-${randomUUID()}`);
  const realCodexHome = join(dataDir, "real-codex-home");
  try {
    expect(codexPlatformRuntimeEnv("win32", dataDir, { CODEX_HOME: realCodexHome })).toMatchObject({
      CODEX_SQLITE_HOME: realCodexHome
    });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
