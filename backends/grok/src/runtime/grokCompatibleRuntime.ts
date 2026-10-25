import { EventEmitter } from "node:events";
import { GrokCompatibleProcessManager, type GrokProcessConfig } from "./grokCompatibleProcessManager.js";
import {
  createGrokProjectorContext,
  projectGrokEvent,
  toGrokNotification,
  forceTerminateGrok,
  type GrokProjectorContext,
} from "./grokCompatibleTurnProjector.js";
import type { GrokEvent } from "./grokCompatibleProtocol.js";

export interface GrokRuntimeConfig {
  threadId: string;
  cwd: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  mode?: "acceptEdits" | "plan";
  providerId?: string;
  groupId?: string;
  envOverrides?: Record<string, string>;
}

export class GrokCompatibleRuntime extends EventEmitter {
  private process: GrokCompatibleProcessManager | null = null;
  private ctx: GrokProjectorContext | null = null;
  private config: GrokRuntimeConfig;

  constructor(config: GrokRuntimeConfig) {
    super();
    this.config = config;
  }

  setEnvOverrides(env: Record<string, string>): void {
    this.config.envOverrides = env;
  }

  updateConfig(updates: Partial<GrokRuntimeConfig>): void {
    Object.assign(this.config, updates);
  }

  get threadId(): string {
    return this.config.threadId;
  }

  get sessionId(): string | undefined {
    return this.ctx?.sessionId ?? this.config.sessionId;
  }

  async executeTurn(prompt: string, turnId: string): Promise<void> {
    if (this.process && this.process.isRunning) {
      await this.process.waitForExit(3000);
    }

    const turnCtx = createGrokProjectorContext(this.config.threadId, turnId);
    turnCtx.hasStartedTurn = true;
    if (this.config.sessionId) {
      turnCtx.sessionId = this.config.sessionId;
    }
    this.ctx = turnCtx;

    const procConfig: GrokProcessConfig = {
      prompt,
      cwd: this.config.cwd,
      sessionId: this.config.sessionId,
      model: this.config.model,
      effort: this.config.effort,
      mode: this.config.mode,
      envOverrides: this.config.envOverrides,
    };

    const proc = new GrokCompatibleProcessManager(procConfig);
    this.process = proc;

    proc.on("event", (event: GrokEvent) => {
      const projected = projectGrokEvent(event, turnCtx);
      for (const p of projected) {
        if (p.kind === "system/init") {
          this.config.sessionId = p.sessionId;
          this.emit("sessionId", p.sessionId);
        }
        const notif = toGrokNotification(p);
        if (notif) {
          this.emit("notification", notif);
        }
      }
    });

    let stderrOutput = "";
    proc.on("stderr", (text: string) => {
      stderrOutput += text;
    });

    proc.on("exit", ({ code, signal: _signal, stopping }) => {
      if (turnCtx.status === "running") {
        const errorMsg = !stopping && code !== 0
          ? (stderrOutput.trim() || `Grok process exited with code ${code}`)
          : undefined;
        const fallback = forceTerminateGrok(turnCtx, stopping ? "interrupted" : "failed", errorMsg);
        for (const p of fallback) {
          const notif = toGrokNotification(p);
          if (notif) this.emit("notification", notif);
        }
      }
      if (this.process === proc) {
        this.process = null;
      }
      if (this.ctx === turnCtx) {
        this.ctx = null;
      }
    });

    proc.on("error", (err) => {
      if (turnCtx.status === "running") {
        const fallback = forceTerminateGrok(turnCtx, "failed", err?.message || String(err));
        for (const p of fallback) {
          const notif = toGrokNotification(p);
          if (notif) this.emit("notification", notif);
        }
      }
      this.emit("error", err);
    });

    proc.start();
  }

  interrupt(): void {
    if (this.ctx && this.ctx.status === "running") {
      const fallback = forceTerminateGrok(this.ctx, "interrupted");
      for (const p of fallback) {
        const notif = toGrokNotification(p);
        if (notif) this.emit("notification", notif);
      }
    }
    if (this.process) {
      this.process.stop();
    }
  }
}
