/**
 * Per-backend diagnostic event log (cline / command-code / auggie).
 *
 * Appends one JSON object per line to `<dir>/logs/<backend>-bridge.log` so
 * protocol-level diagnosis (tool event names, payload key shapes, arrival
 * order) no longer needs copy-pasting terminal output. Each bridge passes
 * its own data/home dir; when omitted, `CODEX_UI_DATA_DIR` (or
 * `~/.codex-ultra` as a last resort) is used, so isolated test nodes get
 * isolated logs automatically.
 *
 * Rotation: at 2 MiB the file is moved aside to `.1` (single backup) and a
 * fresh file starts. `CXU_BRIDGE_LOG=off` disables all writes. Every write
 * is best-effort and synchronous-small; logging must never break turns.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codexUiDataDir } from "./dataDir.js";

const MAX_LOG_BYTES = 2 * 1024 * 1024;
/** Cap for a single serialized payload (tool results can be huge). */
const MAX_ENTRY_BYTES = 64 * 1024;

export interface BridgeEventLogger {
  /** Absolute path of the active log file. */
  readonly file: string;
  /** Append one event object (a `ts` field is added automatically). */
  append(event: Record<string, unknown>): void;
}

function resolveBridgeLogDir(explicitDir?: string): string | null {
  const explicit = (explicitDir ?? "").trim();
  if (explicit) return join(explicit, "logs");
  try {
    return join(codexUiDataDir(), "logs");
  } catch {
    try {
      return join(homedir(), ".codex-ultra", "logs");
    } catch {
      return null;
    }
  }
}

function truncateEntry(text: string): string {
  if (text.length <= MAX_ENTRY_BYTES) return text;
  return text.slice(0, MAX_ENTRY_BYTES) + `…[truncated ${text.length - MAX_ENTRY_BYTES} chars]`;
}

export function createBridgeEventLogger(
  backend: string,
  dir?: string,
): BridgeEventLogger {
  const safeBackend = (backend || "unknown").replace(/[^A-Za-z0-9_-]/g, "_") || "unknown";
  const logDir = resolveBridgeLogDir(dir);
  const file = logDir ? join(logDir, `${safeBackend}-bridge.log`) : "";
  let ready = false;
  return {
    file,
    append(event: Record<string, unknown>): void {
      try {
        if (process.env.CXU_BRIDGE_LOG === "off") return;
        if (!file) return;
        if (!ready) {
          mkdirSync(logDir as string, { recursive: true });
          ready = true;
        }
        try {
          if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
            try {
              renameSync(file, `${file}.1`);
            } catch {
              // Rotation collision (concurrent writers): keep appending.
            }
          }
        } catch {
          // Stat failures must not block logging.
        }
        appendFileSync(
          file,
          truncateEntry(JSON.stringify({ ts: new Date().toISOString(), backend: safeBackend, ...event })) + "\n",
          "utf8",
        );
      } catch {
        // Logging must never break turns.
      }
    },
  };
}
