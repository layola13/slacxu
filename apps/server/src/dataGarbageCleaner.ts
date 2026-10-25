import { existsSync, readdirSync, rmSync, statSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { codexUiDataDir } from "./localDatabase.js";

export interface GarbageCleanOptions {
  dataDir?: string;
  sessionRetentionDays?: number;
  backupRetentionHours?: number;
  tempFileMaxAgeMs?: number;
  exitMode?: boolean;
  dryRun?: boolean;
  cleanLogs?: boolean;
  cleanSessions?: boolean;
  cleanTemp?: boolean;
  cleanBackups?: boolean;
  cleanLocks?: boolean;
  cleanClaudeOrphans?: boolean;
  cleanFileHistoryBackup?: boolean;
  fileHistoryBackupPath?: string;
}

export interface GarbageCleanResult {
  dataDir: string;
  cleanedFilesCount: number;
  cleanedDirsCount: number;
  freedBytes: number;
  errors: Array<{ path: string; error: string }>;
  details: {
    codexTmpFiles: number;
    virtualCodexTmpFiles: number;
    virtualCodexDotTmpFiles: number;
    staleLocks: number;
    expiredSessionRollouts: number;
    staleBackups: number;
    orphanClaudeDirs: number;
    logFilesCleaned: number;
    fileHistoryFilesCleaned?: number;
  };
}

const DEFAULT_SESSION_RETENTION_DAYS = 3;
const DEFAULT_BACKUP_RETENTION_HOURS = 24;
const DEFAULT_TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour for startup
const STALE_LOCK_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

function getPathSize(targetPath: string): number {
  try {
    const st = statSync(targetPath);
    if (!st.isDirectory()) {
      return st.size;
    }
    let total = 0;
    const entries = readdirSync(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      total += getPathSize(join(targetPath, entry.name));
    }
    return total;
  } catch {
    return 0;
  }
}

function removeEmptyDirsSync(dirPath: string): void {
  try {
    if (!existsSync(dirPath)) return;
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      try {
        if (statSync(fullPath).isDirectory()) {
          removeEmptyDirsSync(fullPath);
        }
      } catch {}
    }
    const remaining = readdirSync(dirPath);
    if (remaining.length === 0) {
      rmdirSync(dirPath);
    }
  } catch {}
}

/**
 * Synchronous garbage cleaner. Ideal for process exit hooks (beforeExit, SIGINT, SIGTERM)
 * or fast synchronous cleanup steps.
 */
export function cleanDataGarbageSync(options: GarbageCleanOptions = {}): GarbageCleanResult {
  const dataDir = options.dataDir ?? codexUiDataDir();
  const sessionRetentionDays = options.sessionRetentionDays ?? DEFAULT_SESSION_RETENTION_DAYS;
  const backupRetentionHours = options.backupRetentionHours ?? DEFAULT_BACKUP_RETENTION_HOURS;
  const tempFileMaxAgeMs = options.exitMode ? 0 : (options.tempFileMaxAgeMs ?? DEFAULT_TEMP_FILE_MAX_AGE_MS);
  const now = Date.now();

  const cleanTemp = options.cleanTemp !== false;
  const cleanSessions = options.cleanSessions !== false;
  const cleanBackups = options.cleanBackups !== false;
  const cleanLocks = options.cleanLocks !== false;
  const cleanClaudeOrphans = options.cleanClaudeOrphans !== false;
  const cleanLogs = options.cleanLogs !== false;

  const result: GarbageCleanResult = {
    dataDir,
    cleanedFilesCount: 0,
    cleanedDirsCount: 0,
    freedBytes: 0,
    errors: [],
    details: {
      codexTmpFiles: 0,
      virtualCodexTmpFiles: 0,
      virtualCodexDotTmpFiles: 0,
      staleLocks: 0,
      expiredSessionRollouts: 0,
      staleBackups: 0,
      orphanClaudeDirs: 0,
      logFilesCleaned: 0
    }
  };

  const tryRemove = (targetPath: string, isDir: boolean, onCategorySuccess?: () => void) => {
    try {
      if (!existsSync(targetPath)) return;
      const bytes = isDir ? getPathSize(targetPath) : statSync(targetPath).size;
      if (!options.dryRun) {
        rmSync(targetPath, { recursive: true, force: true });
      }
      result.freedBytes += bytes;
      if (isDir) {
        result.cleanedDirsCount++;
      } else {
        result.cleanedFilesCount++;
      }
      onCategorySuccess?.();
    } catch (error) {
      result.errors.push({
        path: targetPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  // 1. Clean codex-tmp
  if (cleanTemp) {
    const codexTmpDir = join(dataDir, "codex-tmp");
    if (existsSync(codexTmpDir)) {
      try {
        const entries = readdirSync(codexTmpDir, { withFileTypes: true });
        for (const entry of entries) {
          const target = join(codexTmpDir, entry.name);
          try {
            const st = statSync(target);
            if (options.exitMode || (now - st.mtimeMs >= tempFileMaxAgeMs)) {
              tryRemove(target, entry.isDirectory(), () => {
                result.details.codexTmpFiles++;
              });
            }
          } catch {}
        }
      } catch {}
    }
  }

  // 2. Clean virtual-codex/.tmp (especially .tmp/plugins and git-* clones)
  if (cleanTemp) {
    const virtualCodexDotTmp = join(dataDir, "virtual-codex", ".tmp");
    if (existsSync(virtualCodexDotTmp)) {
      try {
        const entries = readdirSync(virtualCodexDotTmp, { withFileTypes: true });
        for (const entry of entries) {
          const target = join(virtualCodexDotTmp, entry.name);
          try {
            const st = statSync(target);
            // plugins and git-* are temporary build/sync artifacts, always clean if older than maxAge or on exit
            if (options.exitMode || entry.name === "plugins" || entry.name.startsWith("git-") || (now - st.mtimeMs >= tempFileMaxAgeMs)) {
              tryRemove(target, entry.isDirectory(), () => {
                result.details.virtualCodexDotTmpFiles++;
              });
            }
          } catch {}
        }
      } catch {}
    }

    // 3. Clean virtual-codex/tmp
    const virtualCodexTmp = join(dataDir, "virtual-codex", "tmp");
    if (existsSync(virtualCodexTmp)) {
      try {
        const entries = readdirSync(virtualCodexTmp, { withFileTypes: true });
        for (const entry of entries) {
          const target = join(virtualCodexTmp, entry.name);
          try {
            const st = statSync(target);
            if (options.exitMode || (now - st.mtimeMs >= tempFileMaxAgeMs)) {
              tryRemove(target, entry.isDirectory(), () => {
                result.details.virtualCodexTmpFiles++;
              });
            }
          } catch {}
        }
      } catch {}
    }
  }

  // 4. Clean virtual-codex/thread-writer-locks
  if (cleanLocks) {
    const locksDir = join(dataDir, "virtual-codex", "thread-writer-locks");
    if (existsSync(locksDir)) {
      try {
        const entries = readdirSync(locksDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".lock")) continue;
          const target = join(locksDir, entry.name);
          try {
            const st = statSync(target);
            if (options.exitMode || (now - st.mtimeMs >= STALE_LOCK_MAX_AGE_MS)) {
              tryRemove(target, false, () => {
                result.details.staleLocks++;
              });
            }
          } catch {}
        }
      } catch {}
    }
  }

  // 5. Clean expired session rollouts in virtual-codex/sessions/YYYY/MM/DD/rollout-*.jsonl
  if (cleanSessions) {
    const sessionsDir = join(dataDir, "virtual-codex", "sessions");
    if (existsSync(sessionsDir)) {
      const maxAgeMs = sessionRetentionDays * 24 * 60 * 60 * 1000;
      const scanRollouts = (dir: string) => {
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const target = join(dir, entry.name);
            if (entry.isDirectory()) {
              scanRollouts(target);
            } else if (entry.isFile() && (entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl"))) {
              try {
                const st = statSync(target);
                if (now - st.mtimeMs >= maxAgeMs) {
                  tryRemove(target, false, () => {
                    result.details.expiredSessionRollouts++;
                  });
                }
              } catch {}
            }
          }
        } catch {}
      };
      scanRollouts(sessionsDir);
      if (!options.dryRun) {
        removeEmptyDirsSync(sessionsDir);
      }
    }
  }

  // 6. Clean stale restore backups and import dumps
  if (cleanBackups) {
    const backupMaxAgeMs = backupRetentionHours * 60 * 60 * 1000;
    try {
      const entries = readdirSync(dataDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        if (name.startsWith("restore-backup-") || name.startsWith("restore-before-") || name.startsWith("relay-import-isolated-")) {
          const target = join(dataDir, name);
          try {
            const st = statSync(target);
            if (now - st.mtimeMs >= backupMaxAgeMs) {
              tryRemove(target, true, () => {
                result.details.staleBackups++;
              });
            }
          } catch {}
        }
      }
    } catch {}
  }

  // 7. Clean virtual-claude orphaned directories
  if (cleanClaudeOrphans) {
    const claudeDir = join(dataDir, "virtual-claude");
    if (existsSync(claudeDir)) {
      const orphanMaxAgeMs = 24 * 60 * 60 * 1000;
      try {
        const entries = readdirSync(claudeDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const target = join(claudeDir, entry.name);
          try {
            const st = statSync(target);
            if (now - st.mtimeMs >= orphanMaxAgeMs) {
              tryRemove(target, true, () => {
                result.details.orphanClaudeDirs++;
              });
            }
          } catch {}
        }
      } catch {}
    }
  }

  // 8. Clean debug logs if CODEX_UI_DEBUG_LOG !== "1"
  if (cleanLogs && process.env.CODEX_UI_DEBUG_LOG !== "1") {
    const logFile = join(dataDir, "log.txt");
    if (existsSync(logFile)) {
      try {
        const bytes = statSync(logFile).size;
        if (!options.dryRun) {
          unlinkSync(logFile);
        }
        result.freedBytes += bytes;
        result.cleanedFilesCount++;
        result.details.logFilesCleaned++;
      } catch (error) {
        result.errors.push({ path: logFile, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const logsDir = join(dataDir, "logs");
    if (existsSync(logsDir)) {
      try {
        const entries = readdirSync(logsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const target = join(logsDir, entry.name);
          try {
            const st = statSync(target);
            // If log file is older than 7 days or larger than 10MB
            if (now - st.mtimeMs >= 7 * 24 * 60 * 60 * 1000 || st.size > 10 * 1024 * 1024) {
              tryRemove(target, false, () => {
                result.details.logFilesCleaned++;
              });
            }
          } catch {}
        }
      } catch {}
    }
  }

  // 9. Clean FileHistory mirror if requested
  if (options.cleanFileHistoryBackup) {
    const defaultFileHistory = `E:\\FileHistory\\zhan\\SONYGOD\\Data\\C\\Users\\zhan\\.codex-ultra`;
    const targetFileHistory = options.fileHistoryBackupPath ?? (existsSync(defaultFileHistory) ? defaultFileHistory : undefined);
    if (targetFileHistory && existsSync(targetFileHistory)) {
      result.details.fileHistoryFilesCleaned = 0;
      try {
        // Clean .tmp and tmp in FileHistory virtual-codex
        const fhVirtualCodex = join(targetFileHistory, "virtual-codex");
        if (existsSync(fhVirtualCodex)) {
          const fhDotTmp = join(fhVirtualCodex, ".tmp");
          if (existsSync(fhDotTmp)) {
            tryRemove(fhDotTmp, true, () => {
              result.details.fileHistoryFilesCleaned = (result.details.fileHistoryFilesCleaned || 0) + 1;
            });
          }
          const fhTmp = join(fhVirtualCodex, "tmp");
          if (existsSync(fhTmp)) {
            tryRemove(fhTmp, true, () => {
              result.details.fileHistoryFilesCleaned = (result.details.fileHistoryFilesCleaned || 0) + 1;
            });
          }
        }
        const fhCodexTmp = join(targetFileHistory, "codex-tmp");
        if (existsSync(fhCodexTmp)) {
          tryRemove(fhCodexTmp, true, () => {
            result.details.fileHistoryFilesCleaned = (result.details.fileHistoryFilesCleaned || 0) + 1;
          });
        }
        // Clean old log (* UTC).txt files in FileHistory
        const entries = readdirSync(targetFileHistory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.startsWith("log (") && entry.name.endsWith(").txt")) {
            tryRemove(join(targetFileHistory, entry.name), false, () => {
              result.details.fileHistoryFilesCleaned = (result.details.fileHistoryFilesCleaned || 0) + 1;
            });
          }
        }
      } catch {}
    }
  }

  return result;
}

/**
 * Asynchronous garbage cleaner. Ideal for server boot and background cleanup.
 */
export async function cleanDataGarbage(options: GarbageCleanOptions = {}): Promise<GarbageCleanResult> {
  return cleanDataGarbageSync(options);
}
