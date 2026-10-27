import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  noteAgySettingsWritten,
  resetAgySettingsGuardForTests,
  resolveAgySettingsPath,
  restoreAgySettings,
  snapshotAgySettings,
} from "../../backends/agy/src/runtime/agySettingsGuard";

let fakeHome = "";
let env: NodeJS.ProcessEnv;
let settingsPath = "";

function simulateOurWrite(raw: string): void {
  mkdirSync(join(fakeHome, ".gemini", "antigravity-cli"), { recursive: true });
  writeFileSync(settingsPath, raw, "utf8");
  noteAgySettingsWritten(raw);
}

beforeEach(() => {
  resetAgySettingsGuardForTests();
  fakeHome = mkdtempSync(join(tmpdir(), "agy-settings-guard-"));
  env = { USERPROFILE: fakeHome, HOME: fakeHome } as NodeJS.ProcessEnv;
  settingsPath = resolveAgySettingsPath(env) as string;
});

afterEach(() => {
  resetAgySettingsGuardForTests();
  try {
    rmSync(fakeHome, { recursive: true, force: true });
  } catch {}
});

describe("agySettingsGuard", () => {
  test("restore is a no-op when nothing was snapshotted", () => {
    expect(restoreAgySettings(env)).toBe("skipped-no-snapshot");
  });

  test("restore is a no-op when snapshot exists but we never wrote", () => {
    mkdirSync(join(fakeHome, ".gemini", "antigravity-cli"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ modelProvider: "third-party" }), "utf8");
    snapshotAgySettings(env);
    expect(restoreAgySettings(env)).toBe("skipped-clean");
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).modelProvider).toBe("third-party");
  });

  test("our write + restore round-trips a pre-existing third-party file", () => {
    mkdirSync(join(fakeHome, ".gemini", "antigravity-cli"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ modelProvider: "third-party" }), "utf8");
    snapshotAgySettings(env);
    simulateOurWrite(JSON.stringify({ modelProvider: "gemini" }));
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).modelProvider).toBe("gemini");
    expect(restoreAgySettings(env)).toBe("restored");
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).modelProvider).toBe("third-party");
    expect(restoreAgySettings(env)).toBe("skipped-clean");
  });

  test("our write + restore removes a file our run created", () => {
    expect(existsSync(settingsPath)).toBe(false);
    snapshotAgySettings(env);
    simulateOurWrite(JSON.stringify({ modelProvider: "gemini" }));
    expect(existsSync(settingsPath)).toBe(true);
    expect(restoreAgySettings(env)).toBe("restored");
    expect(existsSync(settingsPath)).toBe(false);
  });

  test("restore skips when the file changed after our last write", () => {
    mkdirSync(join(fakeHome, ".gemini", "antigravity-cli"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ modelProvider: "third-party" }), "utf8");
    snapshotAgySettings(env);
    simulateOurWrite(JSON.stringify({ modelProvider: "gemini" }));
    writeFileSync(settingsPath, JSON.stringify({ modelProvider: "user-edited" }), "utf8");
    expect(restoreAgySettings(env)).toBe("skipped-external-change");
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).modelProvider).toBe("user-edited");
  });

  test("first snapshot wins when called twice", () => {
    mkdirSync(join(fakeHome, ".gemini", "antigravity-cli"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ modelProvider: "first" }), "utf8");
    snapshotAgySettings(env);
    writeFileSync(settingsPath, JSON.stringify({ modelProvider: "second" }), "utf8");
    snapshotAgySettings(env);
    simulateOurWrite(JSON.stringify({ modelProvider: "gemini" }));
    expect(restoreAgySettings(env)).toBe("restored");
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).modelProvider).toBe("first");
  });
});
