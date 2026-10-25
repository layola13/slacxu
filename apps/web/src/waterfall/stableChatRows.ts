import type { ChatWaterfallRow } from "./types";

export type StableChatRowsCache = {
  rows: ChatWaterfallRow[];
};

export function createStableChatRowsCache(): StableChatRowsCache {
  return { rows: [] };
}

export function stableChatRows(nextRows: ChatWaterfallRow[], cache: StableChatRowsCache): ChatWaterfallRow[] {
  const previousByKey = new Map(cache.rows.map((row) => [row.key, row]));
  const shared = nextRows.map((nextRow) => shareRow(previousByKey.get(nextRow.key), nextRow));
  if (sameReferences(cache.rows, shared)) {
    return cache.rows;
  }
  cache.rows = shared;
  return shared;
}

function shareRow(previous: ChatWaterfallRow | undefined, next: ChatWaterfallRow): ChatWaterfallRow {
  const groupedRows = next.groupedRows
    ? shareNestedRows(previous?.groupedRows, next.groupedRows)
    : undefined;
  const candidate = groupedRows === next.groupedRows ? next : { ...next, groupedRows };
  return previous && rowsEqual(previous, candidate) ? previous : candidate;
}

function shareNestedRows(previous: ChatWaterfallRow[] | undefined, next: ChatWaterfallRow[]): ChatWaterfallRow[] {
  if (!previous) {
    return next;
  }
  const previousByKey = new Map(previous.map((row) => [row.key, row]));
  const shared = next.map((row) => shareRow(previousByKey.get(row.key), row));
  return sameReferences(previous, shared) ? previous : shared;
}

function rowsEqual(previous: ChatWaterfallRow, next: ChatWaterfallRow): boolean {
  return previous.key === next.key
    && previous.turnId === next.turnId
    && previous.threadId === next.threadId
    && sameStrings(previous.itemIds, next.itemIds)
    && previous.kind === next.kind
    && previous.role === next.role
    && previous.text === next.text
    && previous.title === next.title
    && previous.status === next.status
    && sameItem(previous.item, next.item)
    && previous.reasoning === next.reasoning
    && previous.searchText === next.searchText
    && sameFloor(previous.floor, next.floor)
    && previous.width === next.width
    && previous.isLive === next.isLive
    && previous.hideHeader === next.hideHeader
    && previous.assistantTone === next.assistantTone
    && previous.turnStartedAt === next.turnStartedAt
    && previous.startedAt === next.startedAt
    && previous.completedAt === next.completedAt
    && previous.firstTokenAt === next.firstTokenAt
    && previous.updatedAt === next.updatedAt
    && previous.previewUrl === next.previewUrl
    && previous.tokenUsage === next.tokenUsage
    && previous.requestUsage === next.requestUsage
    && previous.groupedRows === next.groupedRows
    && previous.compactionMarker === next.compactionMarker
    && previous.compactionSource === next.compactionSource
    && previous.compactionProviderId === next.compactionProviderId
    && previous.compactionModel === next.compactionModel
    && previous.compactionBackend === next.compactionBackend;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameItem(previous: ChatWaterfallRow["item"], next: ChatWaterfallRow["item"]): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  if (previous.id !== next.id || previous.type !== next.type || previous.status !== next.status || previous.title !== next.title || previous.text !== next.text) {
    return false;
  }
  if (previous.type === "agentOverview" && next.type === "agentOverview") {
    return previous.agentId === next.agentId
      && previous.agentThreadId === next.agentThreadId
      && previous.agentName === next.agentName
      && previous.agentRole === next.agentRole
      && previous.agentStatus === next.agentStatus;
  }
  if (previous.type === "toolActivityGroup" && next.type === "toolActivityGroup") {
    const p = isRecord(previous.payload) ? previous.payload : {};
    const n = isRecord(next.payload) ? next.payload : {};
    return p.count === n.count && p.commandCount === n.commandCount && p.editCount === n.editCount && p.toolCount === n.toolCount;
  }
  if (previous.type === "retryErrorGroup" && next.type === "retryErrorGroup") {
    const p = isRecord(previous.payload) ? previous.payload : {};
    const n = isRecord(next.payload) ? next.payload : {};
    return p.count === n.count && p.retrying === n.retrying && p.exhausted === n.exhausted;
  }
  return true;
}

function sameFloor(previous: ChatWaterfallRow["floor"], next: ChatWaterfallRow["floor"]): boolean {
  return previous === next || Boolean(previous && next && previous.index === next.index && previous.label === next.label);
}

function sameStrings(previous: string[], next: string[]): boolean {
  return previous === next || (previous.length === next.length && previous.every((value, index) => value === next[index]));
}

function sameReferences(previous: ChatWaterfallRow[], next: ChatWaterfallRow[]): boolean {
  return previous.length === next.length && previous.every((row, index) => row === next[index]);
}
