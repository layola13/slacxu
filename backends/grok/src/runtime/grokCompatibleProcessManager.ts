import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import {
  findGrokBin,
  buildGrokSpawnArgs,
  buildSafeGrokEnv,
} from "./grokCompatibleProbe.js";
import { parseGrokLine } from "./grokCompatibleProtocol.js";

export interface GrokProcessConfig {
  prompt: string;
  cwd: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  mode?: "acceptEdits" | "plan";
  envOverrides?: Record<string, string>;
}

export class GrokCompatibleProcessManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopping = false;
  private config: GrokProcessConfig;

  constructor(config: GrokProcessConfig) {
    super();
    this.config = config;
  }

  get isRunning(): boolean {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  start(baseEnv: NodeJS.ProcessEnv = process.env): void {
    if (this.child) return;

    const bin = findGrokBin(baseEnv);
    const args = buildGrokSpawnArgs({
      prompt: this.config.prompt,
      sessionId: this.config.sessionId,
      model: this.config.model,
      effort: this.config.effort,
      mode: this.config.mode,
      cwd: this.config.cwd,
    });
    const env = buildSafeGrokEnv(this.config.envOverrides ?? {}, baseEnv);

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
      this.emit("rawLine", line);
      const event = parseGrokLine(line);
      if (event) {
        this.emit("event", event);
      }
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.emit("stderr", text);
    });

    this.child.on("error", (err) => {
      this.emit("error", err);
    });

    this.child.on("close", (code, signal) => {
      this.child = null;
      this.emit("exit", { code, signal, stopping: this.stopping });
    });
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
