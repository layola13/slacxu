import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanDataGarbage, cleanDataGarbageSync } from "../../apps/server/src/dataGarbageCleaner.ts";

function createFixtureDataDir(): string {
  const dir = join(tmpdir(), `codex-garbage-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("cleans codex-tmp files on exitMode and startup age cutoff", () => {
  const dataDir = createFixtureDataDir();
  try {
    const codexTmp = join(dataDir, "codex-tmp");
    mkdirSync(codexTmp, { recursive: true });

    const freshFile = join(codexTmp, "fresh.tmp");
    const oldFile = join(codexTmp, "old.tmp");
    writeFileSync(freshFile, "fresh content");
    writeFileSync(oldFile, "old content");

    // Make oldFile 2 hours old
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(oldFile, twoHoursAgo, twoHoursAgo);

    // Startup run with 1 hour threshold: should clean oldFile, keep freshFile
    const startupResult = cleanDataGarbageSync({
      dataDir,
      tempFileMaxAgeMs: 60 * 60 * 1000,
      exitMode: false
    });

    expect(startupResult.details.codexTmpFiles).toBe(1);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(freshFile)).toBe(true);

    // Exit run: should clean freshFile as well
    const exitResult = cleanDataGarbageSync({
      dataDir,
      exitMode: true
    });

    expect(exitResult.details.codexTmpFiles).toBe(1);
    expect(existsSync(freshFile)).toBe(false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("cleans virtual-codex/.tmp plugins and git temp directories", () => {
  const dataDir = createFixtureDataDir();
  try {
    const vDotTmp = join(dataDir, "virtual-codex", ".tmp");
    const pluginsDir = join(vDotTmp, "plugins", "sample-plugin");
    const gitDir = join(vDotTmp, "git-clone-12345");
    const normalTmp = join(dataDir, "virtual-codex", "tmp");

    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(gitDir, { recursive: true });
    mkdirSync(normalTmp, { recursive: true });

    writeFileSync(join(pluginsDir, "plugin.json"), "{}");
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main");
    writeFileSync(join(normalTmp, "temp_data.bin"), "temp");

    const result = cleanDataGarbageSync({
      dataDir,
      exitMode: true
    });

    expect(result.details.virtualCodexDotTmpFiles).toBeGreaterThanOrEqual(2);
    expect(result.details.virtualCodexTmpFiles).toBe(1);
    expect(existsSync(pluginsDir)).toBe(false);
    expect(existsSync(gitDir)).toBe(false);
    expect(existsSync(join(normalTmp, "temp_data.bin"))).toBe(false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("cleans expired session rollouts and prunes empty date directories", () => {
  const dataDir = createFixtureDataDir();
  try {
    const sessionsDir = join(dataDir, "virtual-codex", "sessions", "2026", "08", "30");
    const freshSessionsDir = join(dataDir, "virtual-codex", "sessions", "2026", "09", "05");
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(freshSessionsDir, { recursive: true });

    const oldRollout = join(sessionsDir, "rollout-2026-08-30T10-00-00-abc.jsonl");
    const freshRollout = join(freshSessionsDir, "rollout-2026-09-05T10-00-00-xyz.jsonl");

    writeFileSync(oldRollout, '{"type":"turn","content":"old"}');
    writeFileSync(freshRollout, '{"type":"turn","content":"fresh"}');

    // Make oldRollout 7 days old
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    utimesSync(oldRollout, sevenDaysAgo, sevenDaysAgo);

    const result = cleanDataGarbageSync({
      dataDir,
      sessionRetentionDays: 3
    });

    expect(result.details.expiredSessionRollouts).toBe(1);
    expect(existsSync(oldRollout)).toBe(false);
    expect(existsSync(freshRollout)).toBe(true);

    // The empty 2026/08/30 dir should be pruned
    expect(existsSync(sessionsDir)).toBe(false);
    // The fresh dir should remain
    expect(existsSync(freshSessionsDir)).toBe(true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("cleans stale writer locks", () => {
  const dataDir = createFixtureDataDir();
  try {
    const locksDir = join(dataDir, "virtual-codex", "thread-writer-locks");
    mkdirSync(locksDir, { recursive: true });

    const staleLock = join(locksDir, "thread-stale.lock");
    writeFileSync(staleLock, "pid: 9999");
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(staleLock, tenMinutesAgo, tenMinutesAgo);

    const freshLock = join(locksDir, "thread-fresh.lock");
    writeFileSync(freshLock, "pid: 1111");

    const result = cleanDataGarbageSync({
      dataDir,
      exitMode: false
    });

    expect(result.details.staleLocks).toBe(1);
    expect(existsSync(staleLock)).toBe(false);
    expect(existsSync(freshLock)).toBe(true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("cleans stale restore backups older than cutoff hours", () => {
  const dataDir = createFixtureDataDir();
  try {
    const oldBackup = join(dataDir, "restore-backup-20260830-164242");
    const oldImport = join(dataDir, "relay-import-isolated-20260830");
    const freshBackup = join(dataDir, "restore-backup-fresh");

    mkdirSync(oldBackup, { recursive: true });
    mkdirSync(oldImport, { recursive: true });
    mkdirSync(freshBackup, { recursive: true });

    writeFileSync(join(oldBackup, "data.sqlite"), "binary backup data");
    writeFileSync(join(oldImport, "dump.json"), "{}");
    writeFileSync(join(freshBackup, "fresh.sqlite"), "fresh data");

    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(oldBackup, twoDaysAgo, twoDaysAgo);
    utimesSync(oldImport, twoDaysAgo, twoDaysAgo);

    const result = cleanDataGarbageSync({
      dataDir,
      backupRetentionHours: 24
    });

    expect(result.details.staleBackups).toBe(2);
    expect(existsSync(oldBackup)).toBe(false);
    expect(existsSync(oldImport)).toBe(false);
    expect(existsSync(freshBackup)).toBe(true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("respects dryRun without deleting files", () => {
  const dataDir = createFixtureDataDir();
  try {
    const codexTmp = join(dataDir, "codex-tmp");
    mkdirSync(codexTmp, { recursive: true });
    const tmpFile = join(codexTmp, "sample.tmp");
    writeFileSync(tmpFile, "content to measure");

    const result = cleanDataGarbageSync({
      dataDir,
      exitMode: true,
      dryRun: true
    });

    expect(result.cleanedFilesCount).toBe(1);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(existsSync(tmpFile)).toBe(true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("async cleanDataGarbage returns expected result", async () => {
  const dataDir = createFixtureDataDir();
  try {
    const codexTmp = join(dataDir, "codex-tmp");
    mkdirSync(codexTmp, { recursive: true });
    writeFileSync(join(codexTmp, "file.tmp"), "payload");

    const result = await cleanDataGarbage({
      dataDir,
      exitMode: true
    });

    expect(result.details.codexTmpFiles).toBe(1);
    expect(result.freedBytes).toBe(7);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
