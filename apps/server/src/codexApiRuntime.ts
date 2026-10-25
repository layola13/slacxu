import { randomUUID } from "node:crypto";

export type CodexApiEventKind = "engineStatus" | "notification" | "serverRequest";

export type CodexApiEvent = {
  id: number;
  recordedAt: number;
  kind: CodexApiEventKind;
  threadId: string | null;
  payload: unknown;
};

type EventWaiter = {
  predicate: (event: CodexApiEvent) => boolean;
  resolve: (events: CodexApiEvent[]) => void;
  timer: ReturnType<typeof setTimeout>;
  afterId: number;
  limit: number;
};

export class CodexApiEventStore {
  private readonly entries: CodexApiEvent[] = [];
  private readonly waiters = new Map<number, EventWaiter>();
  private nextId = 1;
  private nextWaiterId = 1;

  public constructor(private readonly maxEntries = 4_096) {}

  public latestId(): number {
    return this.nextId - 1;
  }

  public append(kind: CodexApiEventKind, payload: unknown, threadId: string | null): CodexApiEvent {
    const event: CodexApiEvent = {
      id: this.nextId++,
      recordedAt: Date.now(),
      kind,
      threadId,
      payload
    };
    this.entries.push(event);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    for (const [waiterId, waiter] of this.waiters) {
      if (!waiter.predicate(event)) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiterId);
      waiter.resolve(this.list(waiter.afterId, waiter.predicate, waiter.limit));
    }
    return event;
  }

  public list(afterId: number, predicate: (event: CodexApiEvent) => boolean, limit = 256): CodexApiEvent[] {
    const safeLimit = Math.max(1, Math.min(1_024, Math.floor(limit)));
    return this.entries.filter((event) => event.id > afterId && predicate(event)).slice(0, safeLimit);
  }

  public findLatest(predicate: (event: CodexApiEvent) => boolean): CodexApiEvent | null {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const event = this.entries[index];
      if (event && predicate(event)) return event;
    }
    return null;
  }

  public async wait(
    afterId: number,
    predicate: (event: CodexApiEvent) => boolean,
    waitMs: number,
    limit = 256
  ): Promise<CodexApiEvent[]> {
    const matches = this.list(afterId, predicate, limit);
    if (matches.length > 0 || waitMs <= 0) return matches;
    const waiterId = this.nextWaiterId++;
    return await new Promise<CodexApiEvent[]>((resolve) => {
      const scopedPredicate = (event: CodexApiEvent) => event.id > afterId && predicate(event);
      const timer = setTimeout(() => {
        this.waiters.delete(waiterId);
        resolve(this.list(afterId, predicate, limit));
      }, waitMs);
      this.waiters.set(waiterId, { predicate: scopedPredicate, resolve, timer, afterId, limit });
    });
  }
}

export type CodexApiSession = {
  id: string;
  clientId: string;
  ownerId: string | null;
  createdAt: number;
  lastSeenAt: number;
};

export class CodexApiSessionStore {
  private readonly sessions = new Map<string, CodexApiSession>();

  public constructor(
    public readonly ttlMs = 10 * 60_000,
    private readonly createId: () => string = randomUUID
  ) {}

  public create(ownerId: string | null, now = Date.now()): CodexApiSession {
    const id = this.createId();
    const session = {
      id,
      clientId: `api-${id}`,
      ownerId,
      createdAt: now,
      lastSeenAt: now
    };
    this.sessions.set(id, session);
    return session;
  }

  public get(id: string, ownerId: string | null, now = Date.now()): CodexApiSession | null {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId || now - session.lastSeenAt > this.ttlMs) return null;
    session.lastSeenAt = now;
    return session;
  }

  public delete(id: string, ownerId: string | null): CodexApiSession | null {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) return null;
    this.sessions.delete(id);
    return session;
  }

  public hasOwner(ownerId: string | null): boolean {
    for (const session of this.sessions.values()) {
      if (session.ownerId === ownerId) return true;
    }
    return false;
  }

  public sweep(now = Date.now()): CodexApiSession[] {
    const expired: CodexApiSession[] = [];
    for (const [id, session] of this.sessions) {
      if (now - session.lastSeenAt <= this.ttlMs) continue;
      this.sessions.delete(id);
      expired.push(session);
    }
    return expired;
  }
}
