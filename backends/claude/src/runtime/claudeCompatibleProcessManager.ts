import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { JsonValue } from "@codex-ui/shared";
import {
  findClaudeBin,
  buildSafeClaudeEnv,
  ensureClaudeSpawnCwd,
  mapPermissionMode,
  buildClaudeSpawnArgs,
  spawnClaudeCommand,
} from "./claudeCompatibleProbe.js";
import { parseClaudeMessage } from "./claudeCompatibleProtocol.js";

export interface ClaudeProcessConfig {
  cwd: string;
  model?: string;
  sandbox?: string;
  approvalPolicy?: string;
  envOverrides?: Record<string, string>;
}

export interface ClaudeProcessEvents {
  line: string;
  message: Record<string, JsonValue>;
  stderr: string;
  exit: { code: number | null; signal: NodeJS.Signals | null };
  error: Error;
}

const MAX_STDERR_LINES = 1000;

function redactManagerLogText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer ***")
    .replace(/api[_-]?key["'=:\s]+[A-Za-z0-9._~+/=-]{8,}/gi, "api_key=***");
}

function managerErrnoDetails(error: unknown): Record<string, string | number | undefined> {
  const record = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const pick = (key: string): string | number | undefined => {
    const value = record[key];
    return typeof value === "string" || typeof value === "number" ? value : undefined;
  };
  return { code: pick("code"), errno: pick("errno"), syscall: pick("syscall"), path: pick("path") };
}

function logManagerEvent(level: "log" | "warn" | "error", event: string, details: Record<string, unknown>): void {
  try {
    console[level](`[claude-proc] ${event} ${redactManagerLogText(JSON.stringify(details)).slice(0, 4000)}`);
  } catch {
    // Logging must never break the process manager.
  }
}

/**
 * Manages a single Claude CLI child process.
 * Responsibilities: safe launch, NDJSON framing, stdin writes,
 * stderr diagnostics, stop/escalation, and lifecycle events.
 */
export class ClaudeCompatibleProcessManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stderrLineCount = 0;
  private stopping = false;
  private config: ClaudeProcessConfig;

  constructor(config: ClaudeProcessConfig) {
    super();
    this.config = config;
  }

  /**
   * Start the Claude CLI process with the configured model, cwd, and permission.
   * Throws if the workspace is invalid or the process fails to spawn.
   */
  start(baseEnv: NodeJS.ProcessEnv = process.env): void {
    if (this.child) return;

    try {
      this.config.cwd = ensureClaudeSpawnCwd(this.config.cwd);
    } catch (error) {
      logManagerEvent("error", "start-ensure-cwd-failed", {
        cwd: this.config.cwd,
        model: this.config.model,
        ...managerErrnoDetails(error),
        message: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }

    const bin = findClaudeBin(baseEnv);
    const permissionMode = mapPermissionMode(
      this.config.sandbox ?? "default",
      this.config.approvalPolicy ?? "on-request"
    );
    const args = buildClaudeSpawnArgs(this.config.model, permissionMode);
    const env = buildSafeClaudeEnv(baseEnv, this.config.envOverrides);

    logManagerEvent("log", "start-attempt", {
      bin,
      cwd: this.config.cwd,
      model: this.config.model,
      permissionMode,
      argCount: args.length,
    });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnClaudeCommand(bin, args, {
        cwd: this.config.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: process.platform === "win32",
      });
    } catch (error) {
      logManagerEvent("error", "start-spawn-sync-failed", {
        bin,
        cwd: this.config.cwd,
        ...managerErrnoDetails(error),
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (!child || !child.pid) {
      logManagerEvent("error", "start-missing-pid", { bin, cwd: this.config.cwd });
      throw new Error("Failed to spawn Claude CLI process");
    }
    logManagerEvent("log", "start-ok", { bin, cwd: this.config.cwd, pid: child.pid });

    this.child = child;

    child.once("exit", (code, signal) => {
      logManagerEvent(code === 0 ? "log" : "error", "child-exit", {
        cwd: this.config.cwd,
        pid: child.pid ?? null,
        code,
        signal: signal ?? null,
      });
      this.emit("exit", { code, signal });
      this.child = null;
    });

    child.once("error", (error) => {
      logManagerEvent("error", "child-error", {
        cwd: this.config.cwd,
        pid: child.pid ?? null,
        ...managerErrnoDetails(error),
        message: error instanceof Error ? error.message : String(error),
      });
      this.emit("error", error);
      this.child = null;
    });

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line: string) => {
      this.emit("line", line);

      const message = parseClaudeMessage(line);
      if (message) {
        this.emit("message", message as unknown as Record<string, JsonValue>);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text.length > 0) {
        this.stderrLineCount++;
        if (this.stderrLineCount <= MAX_STDERR_LINES) {
          if (this.stderrLineCount === 1 || /error|enoent|uv_spawn|fail/i.test(text)) {
            logManagerEvent("warn", "child-stderr", {
              cwd: this.config.cwd,
              pid: child.pid ?? null,
              line: this.stderrLineCount,
              stderr: redactManagerLogText(text).slice(0, 2000),
            });
          }
          this.emit("stderr", text);
        } else if (this.stderrLineCount === MAX_STDERR_LINES + 1) {
          logManagerEvent("warn", "child-stderr-truncated", { cwd: this.config.cwd, pid: child.pid ?? null });
        }
      }
    });

  }

  /**
   * Write a JSON message to the Claude process stdin.
   * Applies backpressure by checking writable.
   */
  writeStdin(message: JsonValue): void {
    if (!this.child || !this.child.stdin.writable) {
      logManagerEvent("error", "stdin-not-writable", {
        cwd: this.config.cwd,
        hasChild: Boolean(this.child),
        pid: this.child?.pid ?? null,
      });
      throw new Error("Claude CLI process is not running or stdin is not writable");
    }
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  /**
   * Gracefully stop the Claude process.
   * Escalates from stdin close -> SIGTERM -> SIGKILL.
   */
  stop(timeoutMs = 5_000): void {
    if (this.stopping) return;
    this.stopping = true;

    const child = this.child;
    if (!child) {
      this.stopping = false;
      return;
    }

    // Try graceful: close stdin
    try {
      child.stdin.end();
    } catch {
      // stdin already closed
    }

    const timer = setTimeout(() => {
      if (this.child === child && !child.killed) {
        if (process.platform === "win32" && child.pid) {
          // Windows 上只 kill 直接子进程会留下孙进程：用 taskkill /T /F 杀整棵树
          //（与 agy/grok/opencode/miniMcp/miniBridge 一致），失败时回退 SIGTERM。
          try {
            const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
            killer.on("error", () => {
              try { child.kill("SIGTERM"); } catch {}
            });
          } catch {
            try { child.kill("SIGTERM"); } catch {}
          }
        } else {
          try {
            child.kill("SIGTERM");
          } catch {
            // ignore
          }
        }
        // Final escalation
        const killTimer = setTimeout(() => {
          if (this.child === child && !child.killed) {
            try {
              child.kill("SIGKILL");
            } catch {
              // ignore
            }
          }
        }, 1_000);
        killTimer.unref();
      }
    }, timeoutMs);
    timer.unref();
  }

  /**
   * Check if the process is alive.
   */
  isRunning(): boolean {
    return this.child !== null && !this.child.killed;
  }

  /**
   * Get the child PID.
   */
  get pid(): number | null {
    return this.child?.pid ?? null;
  }

}
