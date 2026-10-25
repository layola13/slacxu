import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const CODEX_HOME_ENV_KEY = "CODEX_HOME";
const STATE_FILE_NAME = "global-codex-environment.json";

type State = { previousValue: string | null; managedValue: string; enabled: boolean };
type CommandResult = { status?: number | null; error?: Error };

export type GlobalCodexEnvironmentResult = {
  enabled: boolean;
  managedValue: string;
  restored: string | null;
  skipped: boolean;
};

export function globalCodexEnvironmentStatePath(dataDir: string): string {
  return join(dataDir, STATE_FILE_NAME);
}

export function setGlobalCodexEnvironment({
  enabled,
  virtualCodexHome,
  dataDir,
  platform = process.platform,
  env = process.env,
  spawnSyncFn = spawnSync
}: {
  enabled: boolean;
  virtualCodexHome: string;
  dataDir: string;
  platform?: NodeJS.Platform | string;
  env?: NodeJS.ProcessEnv;
  spawnSyncFn?: (command: string, args: string[], options: Record<string, unknown>) => CommandResult;
}): GlobalCodexEnvironmentResult {
  const managedValue = virtualCodexHome.trim();
  if (!managedValue) throw new Error("Virtual Codex home is required");
  if (platform !== "win32") return { enabled, managedValue, restored: null, skipped: true };

  mkdirSync(dataDir, { recursive: true });
  const path = globalCodexEnvironmentStatePath(dataDir);
  const state = readState(path);
  if (enabled) {
    const previousValue = state?.previousValue ?? (normalize(env[CODEX_HOME_ENV_KEY]) || null);
    runSetx(spawnSyncFn, managedValue);
    writeState(path, { previousValue, managedValue, enabled: true });
    return { enabled: true, managedValue, restored: previousValue, skipped: false };
  }

  const previousValue = state?.previousValue ?? null;
  if (state?.managedValue) {
    if (previousValue) runSetx(spawnSyncFn, previousValue);
    else runRegDelete(spawnSyncFn);
  }
  writeState(path, { previousValue, managedValue, enabled: false });
  return { enabled: false, managedValue, restored: previousValue, skipped: false };
}

function runSetx(spawnSyncFn: NonNullable<Parameters<typeof setGlobalCodexEnvironment>[0]>["spawnSyncFn"], value: string): void {
  const result = spawnSyncFn!("setx.exe", [CODEX_HOME_ENV_KEY, value], { windowsHide: true, stdio: "ignore" });
  if (result?.error) throw result.error;
  if (result?.status !== 0) throw new Error(`setx.exe exited with code ${result?.status ?? "unknown"}`);
}

function runRegDelete(spawnSyncFn: NonNullable<Parameters<typeof setGlobalCodexEnvironment>[0]>["spawnSyncFn"]): void {
  const result = spawnSyncFn!("reg.exe", ["delete", "HKCU\\Environment", "/v", CODEX_HOME_ENV_KEY, "/f"], { windowsHide: true, stdio: "ignore" });
  if (result?.error) throw result.error;
  if (result?.status !== 0 && result?.status !== 1) throw new Error(`reg.exe exited with code ${result?.status ?? "unknown"}`);
}

function readState(path: string): State | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<State>;
    return typeof value.managedValue === "string" && typeof value.enabled === "boolean"
      ? { previousValue: typeof value.previousValue === "string" ? value.previousValue : null, managedValue: value.managedValue, enabled: value.enabled }
      : null;
  } catch {
    return null;
  }
}

function writeState(path: string, state: State): void {
  writeFileSync(path, JSON.stringify(state) + "\n", { encoding: "utf8", mode: 0o600 });
}

function normalize(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
