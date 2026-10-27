import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CursorInstallDirNotFoundError,
  resolveCursorInstallDir,
  writeCursorRelayLauncher
} from "../../apps/server/src/cursorDesktopInjection.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFakeCursorInstall(): string {
  const installDir = mkdtempSync(join(tmpdir(), "codex-ultra-cursor-install-"));
  temporaryDirectories.push(installDir);
  writeFileSync(join(installDir, "Cursor.exe"), "", "utf8");
  return installDir;
}

test("Cursor injection writes a local-mode launcher with the relay gateway env vars", async () => {
  const installDir = createFakeCursorInstall();

  const result = await writeCursorRelayLauncher({
    baseUrl: "http://127.0.0.1:43120/api/relay-gateway/deepkey/default/",
    token: "stable-gateway-token",
    installDir
  });

  expect(result.exePath).toBe(join(installDir, "Cursor.exe"));
  expect(result.launcherPath).toBe(join(installDir, "..", "cursor-relay", "cursor-relay-launcher.cmd"));
  const launcher = readFileSync(result.launcherPath, "utf8");
  expect(launcher).toContain('set "CURSOR_LOCAL_AGENT_BASE_URL=http://127.0.0.1:43120/api/relay-gateway/deepkey/default"');
  expect(launcher).toContain('set "CURSOR_LOCAL_AGENT_API_KEY=stable-gateway-token"');
  expect(launcher).toContain(`start "" "${join(installDir, "Cursor.exe")}" --local-mode`);
});

test("Cursor injection strips trailing slashes from the gateway URL only once per re-inject", async () => {
  const installDir = createFakeCursorInstall();

  await writeCursorRelayLauncher({ baseUrl: "http://127.0.0.1:1/gw///", token: "t1", installDir });
  await writeCursorRelayLauncher({ baseUrl: "http://127.0.0.1:2/gw/", token: "t2", installDir });

  const launcher = readFileSync(join(installDir, "..", "cursor-relay", "cursor-relay-launcher.cmd"), "utf8");
  expect(launcher).toContain("CURSOR_LOCAL_AGENT_BASE_URL=http://127.0.0.1:2/gw\"");
  expect(launcher).toContain("CURSOR_LOCAL_AGENT_API_KEY=t2");
});

test("Cursor injection requires a gateway URL and token", async () => {
  const installDir = createFakeCursorInstall();

  await expect(writeCursorRelayLauncher({ baseUrl: "  ", token: "t", installDir })).rejects.toThrow("gateway URL and token");
  await expect(writeCursorRelayLauncher({ baseUrl: "http://127.0.0.1:1/gw", token: "", installDir })).rejects.toThrow("gateway URL and token");
});

test("Cursor injection rejects non-Windows platforms", async () => {
  const installDir = createFakeCursorInstall();
  await expect(writeCursorRelayLauncher({ baseUrl: "http://x/gw", token: "t", installDir, platform: "linux" }))
    .rejects.toThrow("only available on Windows");
});

test("Cursor install dir resolution accepts an explicit directory containing Cursor.exe", () => {
  const explicit = join(tmpdir(), "cursor-on-d-drive");
  const installDir = mkdtempSync(explicit);
  temporaryDirectories.push(installDir);
  writeFileSync(join(installDir, "Cursor.exe"), "", "utf8");

  // Installs outside %LOCALAPPDATA% (e.g. D:\...) are accepted when entered
  // explicitly — no drive traversal happens.
  expect(resolveCursorInstallDir({ localAppData: "C:\\missing\\AppData\\Local", installDir })).toBe(installDir);
});

test("Cursor install dir resolution reports the default path it searched before failing", () => {
  try {
    resolveCursorInstallDir({ localAppData: "Z:\\definitely-missing\\AppData\\Local" });
    throw new Error("expected CursorInstallDirNotFoundError");
  } catch (error) {
    if (!(error instanceof CursorInstallDirNotFoundError)) throw error;
    expect(error.searchedPath).toBe(join("Z:\\definitely-missing\\AppData\\Local", "Programs", "cursor"));
  }
});

test("Cursor install dir resolution rejects an explicit directory without Cursor.exe", () => {
  const empty = mkdtempSync(join(tmpdir(), "codex-ultra-cursor-empty-"));
  temporaryDirectories.push(empty);

  try {
    resolveCursorInstallDir({ installDir: empty });
    throw new Error("expected CursorInstallDirNotFoundError");
  } catch (error) {
    if (!(error instanceof CursorInstallDirNotFoundError)) throw error;
    expect(error.searchedPath).toBe(join(empty, "Cursor.exe"));
  }
});
