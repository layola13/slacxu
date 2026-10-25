import type { WorkbenchItem, WorkbenchTurn } from "./codexClient";

const TERMINAL_STATUSES = new Set([
  "cancelled",
  "canceled",
  "complete",
  "completed",
  "declined",
  "denied",
  "error",
  "failed",
  "interrupted",
  "rejected",
  "stopped"
]);

export function normalizeWorkbenchTimestamp(value?: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value >= 1_000_000_000_000 ? value : value * 1000;
}

export function workbenchItemTimestamp(item: WorkbenchItem): number | null {
  const firstTokenAt = normalizeWorkbenchTimestamp(item.firstTokenAt);
  if (firstTokenAt != null) {
    return firstTokenAt;
  }
  const payload = asRecord(item.payload);
  return normalizeWorkbenchTimestamp(numberValue(payload?.startedAt) ?? numberValue(payload?.started_at))
    ?? normalizeWorkbenchTimestamp(numberValue(payload?.completedAt) ?? numberValue(payload?.completed_at));
}

export function workbenchTurnTimestamp(turn: WorkbenchTurn): number | null {
  return normalizeWorkbenchTimestamp(turn.startedAt) ?? normalizeWorkbenchTimestamp(turn.completedAt);
}

export function orderWorkbenchItems(items: WorkbenchItem[]): WorkbenchItem[] {
  // A turn's item array is the app-server's canonical causal order. Item
  // timestamps describe different milestones (first token for messages, start
  // or completion for tools) and are not comparable. Sorting them can move a
  // completed tool behind the assistant answer that depends on it.
  return items.slice();
}

export function orderWorkbenchTurns(turns: WorkbenchTurn[]): WorkbenchTurn[] {
  return orderFullyTimed(turns, workbenchTurnTimestamp);
}

export function upsertWorkbenchItem(items: WorkbenchItem[], incoming: WorkbenchItem): WorkbenchItem[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index < 0) {
    return [...items, incoming];
  }
  const next = items.slice();
  next[index] = mergeWorkbenchItem(items[index]!, incoming, "notification");
  return next;
}

export function upsertWorkbenchTurn(turns: WorkbenchTurn[], incoming: WorkbenchTurn): WorkbenchTurn[] {
  const index = turns.findIndex((turn) => turn.id === incoming.id);
  if (index < 0) {
    return [...turns, incoming];
  }
  const next = turns.slice();
  next[index] = mergeWorkbenchTurn(turns[index]!, incoming, "notification");
  return next;
}

export function mergeWorkbenchTurns(current: WorkbenchTurn[], loaded: WorkbenchTurn[]): WorkbenchTurn[] {
  if (current.length === 0) {
    return orderWorkbenchTurns(loaded);
  }
  if (loaded.length === 0) {
    return current;
  }

  const currentById = new Map(current.map((turn) => [turn.id, turn]));
  const loadedById = new Map(loaded.map((turn) => [turn.id, turn]));
  const ids = mergeCanonicalIds(loaded.map((turn) => turn.id), current.map((turn) => turn.id));
  const merged = ids.map((id) => {
    const existing = currentById.get(id);
    const snapshot = loadedById.get(id);
    if (existing && snapshot) {
      return mergeWorkbenchTurn(existing, snapshot, "snapshot");
    }
    return snapshot ?? existing!;
  });
  const ordered = orderWorkbenchTurns(merged);
  return sameReferences(current, ordered) ? current : ordered;
}

function mergeWorkbenchTurn(current: WorkbenchTurn, incoming: WorkbenchTurn, mode: "notification" | "snapshot"): WorkbenchTurn {
  const incomingItems = mode === "snapshot"
    ? reconcileSnapshotMessageIds(current.items, incoming.items)
    : incoming.items;
  const currentById = new Map(current.items.map((item) => [item.id, item]));
  const incomingById = new Map(incomingItems.map((item) => [item.id, item]));
  const ids = mode === "snapshot"
    ? mergeCanonicalIds(incomingItems.map((item) => item.id), current.items.map((item) => item.id))
    : mergeCanonicalIds(current.items.map((item) => item.id), incomingItems.map((item) => item.id));
  const items = ids.map((id) => {
    const existing = currentById.get(id);
    const next = incomingById.get(id);
    if (existing && next) {
      return mergeWorkbenchItem(existing, next, mode);
    }
    return next ?? existing!;
  });

  const orderedItems = orderWorkbenchItems(items);
  const status = progressiveStatus(current, incoming, mode);
  const merged: WorkbenchTurn = {
    ...current,
    ...incoming,
    threadId: incoming.threadId || current.threadId,
    status: status ?? current.status,
    startedAt: earlierTimestamp(current.startedAt, incoming.startedAt),
    completedAt: status && !isTerminalStatus(status) && mode === "notification"
      ? incoming.completedAt
      : laterTimestamp(current.completedAt, incoming.completedAt),
    items: orderedItems
  };
  return sameWorkbenchTurn(current, merged) ? current : merged;
}

function reconcileSnapshotMessageIds(current: WorkbenchItem[], snapshot: WorkbenchItem[]): WorkbenchItem[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const claimedCurrentIds = new Set(snapshot.filter((item) => currentById.has(item.id)).map((item) => item.id));
  return snapshot.map((item) => {
    if (!isReconciledMessageType(item.type) || currentById.has(item.id)) {
      return item;
    }
    const equivalent = current.find((candidate) =>
      !claimedCurrentIds.has(candidate.id) &&
      candidate.type === item.type &&
      normalizeMessageText(candidate.text) === normalizeMessageText(item.text) &&
      compatibleOptionalIdentity(candidate.agentId, item.agentId) &&
      compatibleOptionalIdentity(candidate.agentThreadId, item.agentThreadId)
    );
    if (!equivalent) {
      return item;
    }
    claimedCurrentIds.add(equivalent.id);
    return { ...item, id: equivalent.id };
  });
}

function compatibleOptionalIdentity(current?: string, snapshot?: string): boolean {
  return !current || !snapshot || current === snapshot;
}

function isReconciledMessageType(type: string): boolean {
  return type === "userMessage" || type === "agentMessage";
}

function normalizeMessageText(value: string): string {
  return value.trim().replace(/\r\n?/g, "\n");
}

function mergeWorkbenchItem(
  current: WorkbenchItem,
  incoming: WorkbenchItem,
  mode: "notification" | "snapshot"
): WorkbenchItem {
  const currentTerminal = isTerminalStatus(current.status);
  const incomingTerminal = isTerminalStatus(incoming.status);
  const preferIncoming = mode === "notification"
    || incomingTerminal
    || (!currentTerminal && incoming.text.length > current.text.length);
  const preferred = preferIncoming ? incoming : current;
  const fallback = preferIncoming ? current : incoming;

  const merged: WorkbenchItem = {
    ...fallback,
    ...preferred,
    status: progressiveItemStatus(current.status, incoming.status),
    text: mergeItemText(current.text, incoming.text, mode, preferIncoming),
    startedAt: earlierTimestamp(current.startedAt, incoming.startedAt),
    firstTokenAt: earlierTimestamp(current.firstTokenAt, incoming.firstTokenAt),
    images: longerArray(current.images, incoming.images, preferIncoming),
    files: longerArray(current.files, incoming.files, preferIncoming),
    payload: mergePayload(fallback.payload, preferred.payload)
  };
  return sameWorkbenchItem(current, merged) ? current : merged;
}

function progressiveStatus(
  current: WorkbenchTurn,
  incoming: WorkbenchTurn,
  mode: "notification" | "snapshot",
): string | undefined {
  const currentStatus = current.status;
  const incomingStatus = incoming.status;
  if (mode === "snapshot" && !isTerminalStatus(currentStatus) && isTerminalStatus(incomingStatus)) {
    // A history/reconcile snapshot can be older than the live notification
    // stream. Never let that snapshot make an active turn look finished unless
    // it carries a trustworthy completion timestamp after the live turn began.
    // 注意用 < 而不是 <=：服务端时间戳是秒级，1s 内完成的 turn 会出现
    // completedAt == startedAt，用 <= 会把这种合法终态也拒掉，导致 working 卡死。
    const currentStartedAt = normalizeWorkbenchTimestamp(current.startedAt);
    const incomingStartedAt = normalizeWorkbenchTimestamp(incoming.startedAt);
    const incomingCompletedAt = normalizeWorkbenchTimestamp(incoming.completedAt);
    if (
      incomingCompletedAt == null
      || (currentStartedAt != null && incomingCompletedAt < currentStartedAt)
      || (currentStartedAt != null && incomingStartedAt != null && incomingStartedAt < currentStartedAt)
    ) {
      return currentStatus;
    }
  }
  if (isTerminalStatus(currentStatus) && !isTerminalStatus(incomingStatus)) {
    if (mode === "snapshot") return currentStatus;
    const completedAt = normalizeWorkbenchTimestamp(current.completedAt);
    const startedAt = normalizeWorkbenchTimestamp(incoming.startedAt);
    if (completedAt == null || startedAt == null || startedAt <= completedAt) return currentStatus;
  }
  return incomingStatus ?? currentStatus;
}

function progressiveItemStatus(current?: string, incoming?: string): string | undefined {
  if (isTerminalStatus(current) && !isTerminalStatus(incoming)) return current;
  return incoming ?? current;
}

function isTerminalStatus(value?: string): boolean {
  return TERMINAL_STATUSES.has((value ?? "").replace(/[_-]+/g, "").toLowerCase());
}

function mergeItemText(
  current: string,
  incoming: string,
  mode: "notification" | "snapshot",
  preferIncoming: boolean
): string {
  if (current === incoming) {
    return current;
  }
  if (mode === "notification") {
    return incoming || current;
  }
  if (current.startsWith(incoming)) {
    return current;
  }
  if (incoming.startsWith(current)) {
    return incoming;
  }
  if (current.length !== incoming.length) {
    return current.length > incoming.length ? current : incoming;
  }
  return preferIncoming ? incoming : current;
}

function longerArray<T>(current: T[] | undefined, incoming: T[] | undefined, preferIncoming: boolean): T[] | undefined {
  if (!current) return incoming;
  if (!incoming) return current;
  if (current.length !== incoming.length) {
    return current.length > incoming.length ? current : incoming;
  }
  return preferIncoming ? incoming : current;
}

function mergePayload(fallback: WorkbenchItem["payload"], preferred: WorkbenchItem["payload"]): WorkbenchItem["payload"] {
  const fallbackRecord = asRecord(fallback);
  const preferredRecord = asRecord(preferred);
  if (fallbackRecord && preferredRecord) {
    return { ...fallbackRecord, ...preferredRecord } as WorkbenchItem["payload"];
  }
  return preferred ?? fallback;
}

function earlierTimestamp(current?: number, incoming?: number): number | undefined {
  const currentTime = normalizeWorkbenchTimestamp(current);
  const incomingTime = normalizeWorkbenchTimestamp(incoming);
  if (currentTime == null) return incoming;
  if (incomingTime == null) return current;
  return currentTime <= incomingTime ? current : incoming;
}

function laterTimestamp(current?: number, incoming?: number): number | undefined {
  const currentTime = normalizeWorkbenchTimestamp(current);
  const incomingTime = normalizeWorkbenchTimestamp(incoming);
  if (currentTime == null) return incoming;
  if (incomingTime == null) return current;
  return currentTime >= incomingTime ? current : incoming;
}

function orderFullyTimed<T>(items: T[], timestamp: (item: T) => number | null): T[] {
  const decorated = items.map((item, index) => ({ item, index, timestamp: timestamp(item) }));
  if (decorated.some((entry) => entry.timestamp == null)) {
    return items.slice();
  }
  const ordered = decorated
    .sort((left, right) => left.timestamp! - right.timestamp! || left.index - right.index)
    .map((entry) => entry.item);
  return sameReferences(items, ordered) ? items : ordered;
}

function sameWorkbenchTurn(current: WorkbenchTurn, next: WorkbenchTurn): boolean {
  return current.id === next.id
    && current.threadId === next.threadId
    && current.status === next.status
    && current.startedAt === next.startedAt
    && current.completedAt === next.completedAt
    && sameReferences(current.items, next.items);
}

function sameWorkbenchItem(current: WorkbenchItem, next: WorkbenchItem): boolean {
  return current.id === next.id
    && current.type === next.type
    && current.title === next.title
    && current.text === next.text
    && current.status === next.status
    && current.firstTokenAt === next.firstTokenAt
    && current.updatedAt === next.updatedAt
    && current.agentId === next.agentId
    && current.agentThreadId === next.agentThreadId
    && current.agentName === next.agentName
    && current.agentRole === next.agentRole
    && current.agentStatus === next.agentStatus
    && sameSerializable(current.images, next.images)
    && sameSerializable(current.files, next.files)
    && sameSerializable(current.payload, next.payload);
}

function sameReferences<T>(current: T[], next: T[]): boolean {
  return current === next || (current.length === next.length && current.every((item, index) => item === next[index]));
}

function sameSerializable(current: unknown, next: unknown): boolean {
  if (current === next) {
    return true;
  }
  if (Array.isArray(current) || Array.isArray(next)) {
    return Array.isArray(current)
      && Array.isArray(next)
      && current.length === next.length
      && current.every((value, index) => sameSerializable(value, next[index]));
  }
  const currentRecord = asRecord(current);
  const nextRecord = asRecord(next);
  if (!currentRecord || !nextRecord) {
    return false;
  }
  const currentKeys = Object.keys(currentRecord);
  const nextKeys = Object.keys(nextRecord);
  return currentKeys.length === nextKeys.length
    && currentKeys.every((key) => Object.prototype.hasOwnProperty.call(nextRecord, key) && sameSerializable(currentRecord[key], nextRecord[key]));
}

function mergeCanonicalIds(primary: string[], secondary: string[]): string[] {
  const result = unique(primary);
  const present = new Set(result);

  for (let index = 0; index < secondary.length; index += 1) {
    const id = secondary[index]!;
    if (present.has(id)) {
      continue;
    }
    const previous = findPresentNeighbor(secondary, index, -1, present);
    const next = findPresentNeighbor(secondary, index, 1, present);
    if (next) {
      result.splice(result.indexOf(next), 0, id);
    } else if (previous) {
      result.splice(result.lastIndexOf(previous) + 1, 0, id);
    } else {
      result.push(id);
    }
    present.add(id);
  }
  return result;
}

function findPresentNeighbor(ids: string[], start: number, direction: -1 | 1, present: Set<string>): string | null {
  for (let index = start + direction; index >= 0 && index < ids.length; index += direction) {
    const id = ids[index]!;
    if (present.has(id)) {
      return id;
    }
  }
  return null;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
