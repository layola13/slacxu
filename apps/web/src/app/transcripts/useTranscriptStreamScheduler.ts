import { startTransition, useCallback, useEffect, useMemo, useRef } from "react";
import { coalesceStreamingWorkbenchNotifications } from "../../state/codexClient";
import type { CodexNotification } from "../appReducer";

export const DEFAULT_FLUSH_MS = 80;
export const LONG_TRANSCRIPT_FLUSH_MS = 160;
export const LONG_TRANSCRIPT_TURN_THRESHOLD = 48;
// Completion bursts are not coalescible. Keep each synchronous reducer slice
// small enough that 100+ agents cannot monopolize the renderer for seconds.
export const MAX_TRANSCRIPT_BATCH_SIZE = 256;
export const BACKLOG_YIELD_MS = 48;
export const MAX_TRANSCRIPT_QUEUE_CAP = 4096;

export interface TranscriptStreamScheduler {
  enqueue(notification: CodexNotification): void;
}

/**
 * Buffer that manages stream notifications with backpressure, eager coalescing,
 * and background backlog compression.
 */
export class TranscriptStreamBuffer {
  private queue: CodexNotification[] = [];

  constructor(private readonly maxBatchSize: number = MAX_TRANSCRIPT_BATCH_SIZE) {}

  enqueue(notification: CodexNotification): void {
    this.queue.push(notification);
    // When the queue grows significantly beyond a batch size (e.g. during a background
    // burst or heavy multi-agent streaming), compress early to bound memory.
    if (this.queue.length > this.maxBatchSize * 2) {
      this.coalesceQueue();
    }
  }

  get size(): number {
    return this.queue.length;
  }

  get hasPending(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Coalesces the entire pending queue in place. Collapses consecutive streaming
   * deltas from the same turn/item while preserving completion and lifecycle events.
   */
  coalesceQueue(): void {
    if (this.queue.length <= 1) return;
    this.queue = coalesceStreamingWorkbenchNotifications(this.queue);
    if (this.queue.length > MAX_TRANSCRIPT_QUEUE_CAP) {
      this.queue = this.queue.slice(this.queue.length - MAX_TRANSCRIPT_QUEUE_CAP);
    }
  }

  /**
   * Extracts the next batch of coalesced notifications.
   * If the backlog exceeds the batch size, coalesces the entire queue first
   * so that streaming text across multiple turns is consolidated immediately.
   */
  flushNextBatch(): CodexNotification[] | null {
    if (this.queue.length === 0) return null;
    if (this.queue.length > this.maxBatchSize) {
      this.coalesceQueue();
    }
    const queued = this.queue.splice(0, this.maxBatchSize);
    return coalesceStreamingWorkbenchNotifications(queued);
  }

  clear(): void {
    this.queue = [];
  }
}

/**
 * Owns renderer-side stream backpressure. Socket callbacks only enqueue; they
 * never run transcript reducers synchronously. This is intentionally separate
 * from App so the scheduler can later target per-topic stores without changing
 * connection or workspace code.
 */
export function useTranscriptStreamScheduler(
  consume: (notifications: CodexNotification[]) => void,
  getActiveTurnCount: () => number,
): TranscriptStreamScheduler {
  const bufferRef = useRef<TranscriptStreamBuffer>(new TranscriptStreamBuffer());
  const timerRef = useRef<number | null>(null);
  const getActiveTurnCountRef = useRef(getActiveTurnCount);
  getActiveTurnCountRef.current = getActiveTurnCount;
  const consumeRef = useRef(consume);
  consumeRef.current = consume;

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const notifications = bufferRef.current.flushNextBatch();
    if (!notifications || notifications.length === 0) return;

    startTransition(() => consumeRef.current(notifications));

    if (bufferRef.current.hasPending) {
      timerRef.current = window.setTimeout(flush, BACKLOG_YIELD_MS);
    }
  }, []);

  const enqueue = useCallback((notification: CodexNotification) => {
    bufferRef.current.enqueue(notification);
    if (timerRef.current !== null) return;
    const delay = getActiveTurnCountRef.current() >= LONG_TRANSCRIPT_TURN_THRESHOLD
      ? LONG_TRANSCRIPT_FLUSH_MS
      : DEFAULT_FLUSH_MS;
    timerRef.current = window.setTimeout(flush, delay);
  }, [flush]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (typeof document !== "undefined" && !document.hidden && bufferRef.current.hasPending) {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        bufferRef.current.coalesceQueue();
        flush();
      }
    }

    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      bufferRef.current.clear();
    };
  }, [flush]);

  return useMemo(() => ({ enqueue }), [enqueue]);
}
