export interface ThreadLoadRequestOptions {
  silent?: boolean;
}

interface QueuedLoad {
  threadId: string;
  run(): Promise<void>;
}

/** FIFO transcript loader with per-thread deduplication and bounded IO. */
export class ThreadLoadQueue {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly queue: QueuedLoad[] = [];
  private activeCount = 0;

  constructor(private readonly concurrency = 2) {}

  enqueue(threadId: string, load: () => Promise<void>): Promise<void> {
    const existing = this.inFlight.get(threadId);
    if (existing) return existing;

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const request = gate.then(load);
    this.inFlight.set(threadId, request);
    this.queue.push({ threadId, run: async () => { release(); await request; } });
    this.drain();
    void request.finally(() => {
      if (this.inFlight.get(threadId) === request) this.inFlight.delete(threadId);
    });
    return request;
  }

  has(threadId: string): boolean {
    return this.inFlight.has(threadId);
  }

  private drain(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.activeCount += 1;
      void next.run().finally(() => {
        this.activeCount = Math.max(0, this.activeCount - 1);
        globalThis.setTimeout(() => this.drain(), 0);
      });
    }
  }
}
