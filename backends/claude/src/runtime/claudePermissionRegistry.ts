/**
 * Tracks pending permission requests from Claude-compatible runtimes.
 * Each request is bound to its owning thread, turn, and runtime instance,
 * so responses are never routed to the wrong bridge.
 *
 * This registry is separate from the SSH server request map to prevent
 * a Claude permission response from being sent to a Codex app-server bridge.
 */

export interface PendingClaudePermission {
  /** Server-facing request ID (e.g., "claude-perm-req-001") */
  serverRequestId: string;
  /** Claude CLI's internal request_id */
  claudeRequestId: string;
  /** Internal thread ID */
  threadId: string;
  /** Owner of the thread */
  ownerId: string;
  /** Active turn ID */
  turnId: string;
  /** The runtime that owns this request */
  runtimeId: string;
  /** Timestamp when the request was created */
  createdAt: number;
  /** Timeout in ms */
  timeoutMs: number;
  /** Timer handle */
  timer: ReturnType<typeof setTimeout> | null;
}

export type PermissionResponse =
  | { allowed: true }
  | { allowed: false; denyReason?: string };

const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class ClaudePermissionRegistry {
  private pending = new Map<string, PendingClaudePermission>();
  private byClaudeRequestId = new Map<string, string>();

  /**
   * Register a new pending permission request.
   * Returns the server-facing request ID.
   */
  register(input: {
    claudeRequestId: string;
    threadId: string;
    ownerId: string;
    turnId: string;
    runtimeId: string;
    timeoutMs?: number;
  }): string {
    const serverRequestId = "claude-perm-" + input.claudeRequestId;
    const timeoutMs = input.timeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;

    // Clean up any existing entry with the same serverRequestId
    this.cancel(serverRequestId);

    const entry: PendingClaudePermission = {
      serverRequestId,
      claudeRequestId: input.claudeRequestId,
      threadId: input.threadId,
      ownerId: input.ownerId,
      turnId: input.turnId,
      runtimeId: input.runtimeId,
      createdAt: Date.now(),
      timeoutMs,
      timer: null,
    };

    entry.timer = setTimeout(() => {
      this.handleTimeout(serverRequestId);
    }, timeoutMs);
    entry.timer.unref();

    this.pending.set(serverRequestId, entry);
    this.byClaudeRequestId.set(input.claudeRequestId, serverRequestId);

    return serverRequestId;
  }

  /**
   * Look up a pending permission by its server-facing request ID.
   */
  get(serverRequestId: string): PendingClaudePermission | undefined {
    return this.pending.get(serverRequestId);
  }

  /**
   * Look up a pending permission by the Claude CLI's request_id.
   */
  getByClaudeRequestId(claudeRequestId: string): PendingClaudePermission | undefined {
    const serverRequestId = this.byClaudeRequestId.get(claudeRequestId);
    if (!serverRequestId) return undefined;
    return this.pending.get(serverRequestId);
  }

  /**
   * Consume a permission request (remove it from the registry).
   * Returns the entry if found, or undefined if it was already consumed or timed out.
   */
  consume(serverRequestId: string): PendingClaudePermission | undefined {
    const entry = this.pending.get(serverRequestId);
    if (!entry) return undefined;

    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    this.pending.delete(serverRequestId);
    this.byClaudeRequestId.delete(entry.claudeRequestId);

    return entry;
  }

  /**
   * Cancel a pending permission request (e.g., when the turn is interrupted
   * or the process exits). Does NOT trigger the timeout callback.
   */
  cancel(serverRequestId: string): void {
    const entry = this.pending.get(serverRequestId);
    if (!entry) return;

    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    this.pending.delete(serverRequestId);
    this.byClaudeRequestId.delete(entry.claudeRequestId);
  }

  /**
   * Cancel all pending permissions for a given runtime.
   * Used when a process exits or a turn is force-terminated.
   */
  cancelAllForRuntime(runtimeId: string): string[] {
    const cancelled: string[] = [];
    for (const [serverRequestId, entry] of this.pending) {
      if (entry.runtimeId === runtimeId) {
        if (entry.timer) clearTimeout(entry.timer);
        this.pending.delete(serverRequestId);
        this.byClaudeRequestId.delete(entry.claudeRequestId);
        cancelled.push(serverRequestId);
      }
    }
    return cancelled;
  }

  /**
   * Cancel all pending permissions for a given thread.
   */
  cancelAllForThread(threadId: string): string[] {
    const cancelled: string[] = [];
    for (const [serverRequestId, entry] of this.pending) {
      if (entry.threadId === threadId) {
        if (entry.timer) clearTimeout(entry.timer);
        this.pending.delete(serverRequestId);
        this.byClaudeRequestId.delete(entry.claudeRequestId);
        cancelled.push(serverRequestId);
      }
    }
    return cancelled;
  }

  /**
   * Get the count of pending permissions (for diagnostics).
   */
  get size(): number {
    return this.pending.size;
  }

  /**
   * List all pending permissions (for diagnostics).
   */
  list(): PendingClaudePermission[] {
    return Array.from(this.pending.values());
  }

  /**
   * Check if there are pending permissions for a given thread.
   */
  hasPendingForThread(threadId: string): boolean {
    for (const entry of this.pending.values()) {
      if (entry.threadId === threadId) return true;
    }
    return false;
  }

  private handleTimeout(serverRequestId: string): void {
    const entry = this.pending.get(serverRequestId);
    if (!entry) return;

    this.pending.delete(serverRequestId);
    this.byClaudeRequestId.delete(entry.claudeRequestId);

    // The runtime should listen for the timeout and deny the permission
    // This is handled by emitting a timeout event
    this.onTimeout?.(entry);
  }

  /**
   * Callback invoked when a permission request times out.
   * Set by the runtime to handle auto-denial.
   */
  onTimeout: ((entry: PendingClaudePermission) => void) | null = null;
}
