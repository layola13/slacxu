import { EventEmitter } from "node:events";
import {
  PiRpcProcessManager,
  type PiProcessConfig,
  type PiRelayConfig,
} from "./piRpcProcessManager.js";
import {
  createPiProjectorContext,
  forceTerminatePi,
  projectPiMessage,
  toPiNotification,
  type PiProjectorContext,
} from "./piTurnProjector.js";
import type { PiRpcIncomingMessage, PiRpcSessionMessage } from "./piRpcProtocol.js";

export const PI_ABORT_ACK_TIMEOUT_MS = 2_000;
// Pi RPC does not include a turn id on lifecycle events. After an abort ACK,
// the old agent may still emit its terminal event; wait briefly for that event
// before allowing a new prompt, otherwise it can settle the new mutable ctx.
export const PI_ABORT_SETTLE_TIMEOUT_MS = 2_000;

export interface PiRuntimeConfig {
  threadId: string;
  cwd: string;
  sessionId?: string;
  model?: string;
  relayConfig?: PiRelayConfig;
  envOverrides?: Record<string, string>;
  sessionDir?: string;
}

/**
 * PiRuntimeAdapter manages the communication between Ultra's thread model
 * and an underlying Pi RPC process.
 */
export class PiRuntimeAdapter extends EventEmitter {
  private process: PiRpcProcessManager | null = null;
  private ctx: PiProjectorContext | null = null;
  private config: PiRuntimeConfig;
  private settlementWaiter: {
    resolve: () => void;
    promise: Promise<void>;
  } | null = null;

  constructor(config: PiRuntimeConfig) {
    super();
    this.config = config;
  }

  updateConfig(updates: Partial<PiRuntimeConfig>): void {
    Object.assign(this.config, updates);
  }

  get threadId(): string {
    return this.config.threadId;
  }

  get sessionId(): string | undefined {
    return this.ctx?.sessionId ?? this.config.sessionId ?? this.config.threadId;
  }

  get isRunning(): boolean {
    return this.process !== null && this.process.isRunning();
  }

  get isTurnActive(): boolean {
    return this.process !== null && this.process.isTurnActive;
  }

  /**
   * Starts the persistent Pi RPC process if not already running.
   */
  start(): void {
    if (this.process && this.process.isRunning()) return;

    const procConfig: PiProcessConfig = {
      threadId: this.config.threadId,
      workspaceCwd: this.config.cwd,
      model: this.config.model,
      sessionDir: this.config.sessionDir,
      relayConfig: this.config.relayConfig,
      envOverrides: this.config.envOverrides,
    };

    const proc = new PiRpcProcessManager(procConfig);
    this.process = proc;

    proc.on("message", (msg: PiRpcIncomingMessage) => {
      // A stopped process can still flush buffered stdout. Its events must
      // never be projected into the next turn's context.
      if (this.process !== proc) return;
      if (msg.type === "agent_settled") {
        this.settlementWaiter?.resolve();
        this.settlementWaiter = null;
      }
      if (!this.ctx) return;
      const projected = projectPiMessage(msg, this.ctx);
      for (const p of projected) {
        const notif = toPiNotification(p);
        if (notif) {
          this.emit("notification", notif);
        }
      }
    });

    proc.on("stderr", (text: string) => {
      this.emit("stderr", text);
    });

    proc.on("exit", ({ code, signal }) => {
      if (this.process !== proc) return;
      if (this.ctx && this.ctx.status === "running") {
        const fallback = forceTerminatePi(
          this.ctx,
          "failed",
          `Pi process exited unexpectedly with code=${code}, signal=${signal}`
        );
        for (const p of fallback) {
          const notif = toPiNotification(p);
          if (notif) this.emit("notification", notif);
        }
      }
      if (this.process === proc) {
        this.process = null;
      }
      this.emit("exit", { code, signal });
    });

    proc.on("error", (err: Error) => {
      if (this.process !== proc) return;
      if (this.ctx && this.ctx.status === "running") {
        const fallback = forceTerminatePi(this.ctx, "failed", err.message);
        for (const p of fallback) {
          const notif = toPiNotification(p);
          if (notif) this.emit("notification", notif);
        }
      }
      this.emit("error", err);
    });

    proc.on("timeout", ({ type, details }: { type: string; details: string }) => {
      if (this.process !== proc) return;
      if (this.ctx && this.ctx.status === "running") {
        const fallback = forceTerminatePi(this.ctx, "failed", `Pi timeout (${type}): ${details}`);
        for (const p of fallback) {
          const notif = toPiNotification(p);
          if (notif) this.emit("notification", notif);
        }
      }
    });

    proc.start();
  }

  /**
   * Executes a user turn asynchronously.
   */
  async executeTurn(prompt: string, turnId: string): Promise<void> {
    this.start();

    const turnCtx = createPiProjectorContext(this.config.threadId, turnId);
    turnCtx.hasStartedTurn = true;
    turnCtx.sessionId = this.sessionId;
    this.ctx = turnCtx;

    // Send the prompt command to the Pi RPC process
    const resp = await this.process!.sendCommand({
      type: "prompt",
      message: prompt,
      streamingBehavior: "steer",
    });

    if (resp.success === false) {
      const fallback = forceTerminatePi(
        turnCtx,
        "failed",
        resp.error || "Failed to initiate prompt turn"
      );
      for (const p of fallback) {
        const notif = toPiNotification(p);
        if (notif) this.emit("notification", notif);
      }
    }
  }

  /**
   * Sends a steering message to the active turn.
   */
  async steer(message: string): Promise<void> {
    if (this.process && this.process.isRunning()) {
      await this.process.sendCommand({ type: "steer", message });
    }
  }

  /**
   * Interrupts the currently running turn.
   */
  async interrupt(): Promise<void> {
    const process = this.process;
    let settledPromise: Promise<void> | null = null;
    if (this.ctx && this.ctx.status === "running") {
      const fallback = forceTerminatePi(this.ctx, "interrupted");
      for (const p of fallback) {
        const notif = toPiNotification(p);
        if (notif) this.emit("notification", notif);
      }
    }
    if (process && process.isRunning()) {
      let resolveSettlement!: () => void;
      settledPromise = new Promise<void>((resolve) => {
        resolveSettlement = resolve;
      });
      this.settlementWaiter = { resolve: resolveSettlement, promise: settledPromise };
      try {
        await process.sendCommand({ type: "abort" }, { ackTimeoutMs: PI_ABORT_ACK_TIMEOUT_MS });
        await Promise.race([
          settledPromise,
          new Promise<void>((resolve) => setTimeout(resolve, PI_ABORT_SETTLE_TIMEOUT_MS)),
        ]);
        this.settlementWaiter = null;
        // Pi lifecycle events carry no turn id. Even after one settle event,
        // duplicate/late events are ambiguous, so never reuse this process
        // for a subsequent turn.
        if (this.process === process) this.process = null;
        process.stop(1000);
      } catch {
        // If abort ack times out or fails, stop process
        this.settlementWaiter = null;
        if (this.process === process) this.process = null;
        process.stop(1000);
      }
    }
  }

  /**
   * Reads raw transcript messages from the active session if available.
   */
  async getMessages(): Promise<PiRpcSessionMessage[]> {
    if (!this.process || !this.process.isRunning()) return [];
    try {
      const resp = await this.process.sendCommand({ type: "get_messages" });
      if (resp.success && Array.isArray((resp as any).messages)) {
        return (resp as any).messages;
      }
    } catch {
      // Fallback: empty if unavailable
    }
    return [];
  }

  /**
   * Stops the runtime process.
   */
  stop(timeoutMs = 3000): void {
    this.settlementWaiter = null;
    if (this.process) {
      this.process.stop(timeoutMs);
      this.process = null;
    }
    this.ctx = null;
  }
}
