import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AgySettingsRestoreResult =
  | "restored"
  | "skipped-clean"
  | "skipped-external-change"
  | "skipped-no-snapshot";

export function resolveAgySettingsPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (!home) return null;
  return join(home, ".gemini", "antigravity-cli", "settings.json");
}

let snapshot: { path: string; existed: boolean; raw: string | null } | null = null;
let lastWrittenRaw: string | null = null;
let modifiedByUs = false;

export function resetAgySettingsGuardForTests(): void {
  snapshot = null;
  lastWrittenRaw = null;
  modifiedByUs = false;
}

export function snapshotAgySettings(env: NodeJS.ProcessEnv = process.env): void {
  if (snapshot) return;
  const path = resolveAgySettingsPath(env);
  if (!path) return;
  try {
    if (existsSync(path)) {
      snapshot = { path, existed: true, raw: readFileSync(path, "utf8") };
    } else {
      snapshot = { path, existed: false, raw: null };
    }
  } catch {
    return;
  }
}

export function noteAgySettingsWritten(raw: string): void {
  modifiedByUs = true;
  lastWrittenRaw = raw;
}

export function restoreAgySettings(env: NodeJS.ProcessEnv = process.env): AgySettingsRestoreResult {
  if (!snapshot) return "skipped-no-snapshot";
  if (!modifiedByUs) return "skipped-clean";
  const path = snapshot.path;
  void env;
  let current: string | null = null;
  try {
    current = existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return "skipped-external-change";
  }
  if (current !== lastWrittenRaw) {
    console.warn("[agySettings] settings.json changed after our last write; skip restore to avoid clobbering external edits");
    return "skipped-external-change";
  }
  try {
    if (snapshot.existed) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, snapshot.raw ?? "", "utf8");
    } else if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch (err) {
    console.warn("[agySettings] Failed to restore settings.json:", err);
    return "skipped-external-change";
  }
  modifiedByUs = false;
  return "restored";
}
