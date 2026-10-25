import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { JsonRpcNotification, JsonValue } from "@codex-ui/shared";
import { ClaudeCompatibleProcessManager, type ClaudeProcessConfig } from "./claudeCompatibleProcessManager.js";
import { ClaudeSessionStore } from "./claudeSessionStore.js";
import {
  createProjectorContext,
  projectMessage,
  toNotification,
  forceTerminate,
  markInterrupted,
  type ProjectedEvent,
  type ProjectorContext,
} from "./claudeCompatibleTurnProjector.js";
import {
  buildControlResponse,
  buildInterruptRequest,
  type ClaudeMessage,
} from "./claudeCompatibleProtocol.js";
import { ClaudePermissionRegistry } from "./claudePermissionRegistry.js";

export interface ClaudeRuntimeConfig {
  threadId: string;
  ownerId: string;
  cwd: string;
  model?: string;
  sandbox?: string;
  approvalPolicy?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ClaudeTurnRequest {
  prompt: string;
  turnId?: string;
}

interface PendingPermission {
  claudeRequestId: string;
  threadId: string;
  turnId: string;
}

/**
 * Orchestrates a single Claude-compatible CLI thread.
 *
 * Responsibilities:
 * - Start/stop the process manager
 * - Route parsed messages through the projector
 * - Emit JSON-RPC notifications to the server
 * - Track active turn and ensure terminal state
 * - Handle permission requests and responses
 * - Persist external session IDs for resume
 *
 * Must NOT: directly call the UI, mutate Codex relay config,
 * or handle SSH/multi-agent/plan/goal operations.
 */
export class ClaudeCompatibleRuntime extends EventEmitter {
  private process: ClaudeCompatibleProcessManager | null = null;
  private ctx: ProjectorContext | null = null;
  private activeTurnId: string | null = null;
  private pendingPermissions = new Map<string, PendingPermission>();
  private permissionRegistry: ClaudePermissionRegistry | null;
  private sessionStore: ClaudeSessionStore;
  private config: ClaudeRuntimeConfig;
  private env: NodeJS.ProcessEnv;
  private nextControlId = 1;
  private readonly runtimeId: string;

  constructor(config: ClaudeRuntimeConfig, sessionStore: ClaudeSessionStore, permissionRegistry: ClaudePermissionRegistry | null = null) {
    super();
    this.config = config;
    this.sessionStore = sessionStore;
    this.permissionRegistry = permissionRegistry;
    this.env = config.env ?? process.env;
    this.runtimeId = "rt-" + this.config.threadId;
  }

  /**
   * Start the Claude CLI process.
   */
  start(): void {
    if (this.process) return;

    const procConfig: ClaudeProcessConfig = {
      cwd: this.config.cwd,
      model: this.config.model,
      sandbox: this.config.sandbox,
      approvalPolicy: this.config.approvalPolicy,
    };

    this.process = new ClaudeCompatibleProcessManager(procConfig);

    this.process.on("message", (msg: Record<string, JsonValue>) => {
      this.handleMessage(msg as unknown as ClaudeMessage);
    });

    this.process.on("stderr", (text: string) => {
      this.emit("stderr", text);
    });

    this.process.on("exit", ({ code }) => {
      if (this.ctx && this.activeTurnId) {
        const event = forceTerminate(this.ctx, "Claude CLI process exited with code " + (code ?? "null"));
        if (event) this.emitEvent(event);
      }
      this.process = null;
      this.emit("exit", { code });
    });

    this.process.on("error", (error: Error) => {
      this.emit("error", error);
    });

    this.process.start(this.env);
  }

  /**
   * Start a turn. Returns the turn ID immediately — does NOT block
   * until the turn completes. The caller gets terminal events via
   * the "notification" emitter.
   */
  startTurn(request: ClaudeTurnRequest): string {
    if (!this.process) this.start();

    const turnId = request.turnId ?? randomUUID();
    this.activeTurnId = turnId;
    this.ctx = createProjectorContext(this.config.threadId, turnId);

    this.emitEvent({ kind: "turn/started", threadId: this.config.threadId, turnId });

    // Write the user message to stdin
    this.process!.writeStdin({
      type: "user",
      message: { role: "user", content: request.prompt },
      parent_tool_use_id: null,
    } as JsonValue);

    return turnId;
  }

  /**
   * Interrupt the active turn.
   */
  interrupt(): void {
    if (!this.process || !this.activeTurnId || !this.ctx) return;

    const interruptId = "interrupt-" + this.nextControlId++;
    this.process.writeStdin(buildInterruptRequest(interruptId));

    const event = markInterrupted(this.ctx);
    if (event) {
      this.emitEvent(event);
      this.pendingPermissions.clear();
      this.permissionRegistry?.cancelAllForThread(this.config.threadId);
    }
  }

  /**
   * Respond to a permission request from Claude.
   */
  respondToPermission(serverRequestId: string, allowed: boolean, denyReason?: string): void {
    const pending = this.pendingPermissions.get(serverRequestId);
    if (pending) {
      this.pendingPermissions.delete(serverRequestId);
      this.permissionRegistry?.consume(serverRequestId);
    } else if (this.permissionRegistry) {
      const fromRegistry = this.permissionRegistry.consume(serverRequestId);
      if (fromRegistry) {
        if (!this.process) return;
        this.process.writeStdin(buildControlResponse(fromRegistry.claudeRequestId, allowed, denyReason));
      }
      return;
    }
    if (!pending || !this.process) return;
    this.process.writeStdin(buildControlResponse(pending.claudeRequestId, allowed, denyReason));
  }

  /**
   * Stop the Claude process and clean up.
   */
  stop(): void {
    if (this.ctx && this.activeTurnId) {
      const event = forceTerminate(this.ctx, "Runtime stopped");
      if (event) this.emitEvent(event);
    }
    this.process?.stop();
    this.pendingPermissions.clear();
    this.permissionRegistry?.cancelAllForRuntime(this.runtimeId);
  }

  /**
   * Check if the runtime has an active (non-terminal) turn.
   */
  isTurnActive(): boolean {
    return this.ctx !== null && this.ctx.turn.status === "running";
  }

  /**
   * Get the external session ID, if known.
   */
  getExternalSessionId(): string | null {
    return this.ctx?.sessionToThread
      ? Array.from(this.ctx.sessionToThread.entries()).find(([_, v]) => v === this.config.threadId)?.[0] ?? null
      : null;
  }

  private handleMessage(message: ClaudeMessage): void {
    if (!this.ctx) return;

    const events = projectMessage(message, this.ctx);

    // Persist session ID on system/init
    if (message.type === "system" && message.subtype === "init") {
      const sessionId = (message as { session_id?: string }).session_id;
      if (sessionId) {
        const version = (message as { claude_code_version?: string }).claude_code_version;
        const model = (message as { model?: string }).model;
        const cwd = (message as { cwd?: string }).cwd;
        const permissionMode = (message as { permissionMode?: string }).permissionMode;
        this.sessionStore.upsert({
          threadId: this.config.threadId,
          ownerId: this.config.ownerId,
          externalSessionId: sessionId,
          cliVersion: version ?? null,
          model: model ?? null,
          cwd: cwd ?? null,
          permissionMode: permissionMode ?? null,
        });
      }
    }

    // Track permission requests
    if (message.type === "control_request") {
      const req = (message as { request_id?: string; request?: { subtype?: string } });
      if (req.request?.subtype === "can_use_tool" && req.request_id && this.activeTurnId) {
        const serverRequestId = this.permissionRegistry
          ? this.permissionRegistry.register({
              claudeRequestId: req.request_id,
              threadId: this.config.threadId,
              ownerId: this.config.ownerId,
              turnId: this.activeTurnId,
              runtimeId: this.runtimeId,
            })
          : "claude-perm-" + req.request_id;
        this.pendingPermissions.set(serverRequestId, {
          claudeRequestId: req.request_id,
          threadId: this.config.threadId,
          turnId: this.activeTurnId,
        });
        // Override the requestId in projected events with the server-facing ID
        for (const ev of events) {
          if (ev.kind === "item/permissionRequest") {
            (ev as { requestId: string }).requestId = serverRequestId;
          }
        }
      }
    }

    // Check for terminal state
    const terminalEvent = events.find(e =>
      e.kind === "turn/completed" || e.kind === "turn/failed" || e.kind === "turn/interrupted"
    );
    if (terminalEvent) {
      this.activeTurnId = null;
      this.pendingPermissions.clear();
      this.permissionRegistry?.cancelAllForThread(this.config.threadId);
    }

    for (const event of events) {
      this.emitEvent(event);
    }
  }

  private emitEvent(event: ProjectedEvent): void {
    const notification = toNotification(event);
    this.emit("notification", notification as JsonRpcNotification);
  }
}
