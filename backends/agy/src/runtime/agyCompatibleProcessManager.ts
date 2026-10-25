import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import {
  findAgyBin,
  buildAgySpawnArgs,
  buildSafeAgyEnv,
} from "./agyCompatibleProbe.js";
import { parseAgyLine, buildAgyPromptInput } from "./agyCompatibleProtocol.js";

export interface AgyProcessConfig {
  cwd: string;
  addDirs?: string[];
  conversationId?: string;
  model?: string;
  effort?: string;
  mode?: "accept-edits" | "plan";
  dangerouslySkipPermissions?: boolean;
  envOverrides?: Record<string, string>;
}

export class AgyCompatibleProcessManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopping = false;
  private config: AgyProcessConfig;
  private stderrTail: string[] = [];
  private pendingJsonLine = "";
  private static readonly MAX_STDERR_TAIL_LINES = 50;
  private static readonly MAX_PENDING_JSON_CHARS = 1_000_000;

  constructor(config: AgyProcessConfig) {
    super();
    this.config = config;
  }

  getStderrTail(): string {
    return this.stderrTail.join("").slice(-4000);
  }

  private handleStdoutLine(line: string): void {
    this.emit("rawLine", line);
    const candidate = this.pendingJsonLine ? `${this.pendingJsonLine}\n${line}` : line;
    const event = parseAgyLine(candidate);
    if (event) {
      this.pendingJsonLine = "";
      this.emit("event", event);
      return;
    }
    const trimmed = candidate.trim();
    if (trimmed.startsWith("{") && candidate.length < AgyCompatibleProcessManager.MAX_PENDING_JSON_CHARS) {
      this.pendingJsonLine = candidate;
      return;
    }
    this.pendingJsonLine = "";
  }
  get isRunning(): boolean {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  start(baseEnv: NodeJS.ProcessEnv = process.env): void {
    if (this.child) return;

    const bin = findAgyBin(baseEnv);
    const args = buildAgySpawnArgs({
      conversationId: this.config.conversationId,
      model: this.config.model,
      effort: this.config.effort,
      mode: this.config.mode,
      dangerouslySkipPermissions: this.config.dangerouslySkipPermissions,
      addDirs: this.config.addDirs,
      cwd: this.config.cwd,
    });
    const env = buildSafeAgyEnv(this.config.envOverrides ?? {}, baseEnv);

    try {
      this.child = spawn(bin, args, {
        cwd: this.config.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const rl = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line: string) => {
      this.handleStdoutLine(line);
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.stderrTail.push(text);
      if (this.stderrTail.length > AgyCompatibleProcessManager.MAX_STDERR_TAIL_LINES) {
        this.stderrTail.shift();
      }
      this.emit("stderr", text);
    });

    this.child.on("error", (err) => {
      this.emit("error", err);
    });

    this.child.on("close", (code, signal) => {
      this.child = null;
      this.pendingJsonLine = "";
      this.emit("exit", { code, signal, stopping: this.stopping, stderrTail: this.getStderrTail() });
    });
  }

  writePrompt(prompt: string): void {
    if (!this.child || !this.child.stdin || !this.child.stdin.writable) {
      throw new Error("Cannot write prompt: agy process is not writable");
    }
    const payload = buildAgyPromptInput(prompt);
    this.child.stdin.end(payload);
  }

  waitForExit(timeoutMs = 5000): Promise<void> {
    if (!this.isRunning) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.stop();
        resolve();
      }, timeoutMs);
      this.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  stop(): void {
    if (!this.child) return;
    this.stopping = true;
    try {
      if (this.child.stdin && !this.child.stdin.destroyed) {
        try { this.child.stdin.end(); } catch {}
      }
      if (process.platform === "win32" && this.child.pid) {
        const killer = spawn("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { windowsHide: true });
        killer.on("error", () => {
          try { this.child?.kill("SIGKILL"); } catch {}
        });
      } else {
        this.child.kill("SIGTERM");
      }
    } catch {
      try { this.child.kill(); } catch {}
    }
  }
}
