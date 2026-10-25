import type { WorkbenchItem, WorkbenchTurn } from "../state/codexClient";
import { orderWorkbenchItems } from "../state/workbenchTimeline";
import { displayPromptText } from "../promptDisplay";
import type { ChatRequestUsage, ChatRowKind, ChatRowRole, ChatRowWidth, ChatTokenUsage, ChatWaterfallRow, CompactionSourceDetail } from "./types";

export type ChatRowFilter = (item: WorkbenchItem) => boolean;
export const HISTORICAL_TOOL_ACTIVITY_AGE_MS = 2 * 60 * 60 * 1000;
export type WaterfallDisplayMode = "full" | "recent-tools" | "post-compaction";

export function selectTurnsForWaterfallMode(
  turns: WorkbenchTurn[],
  mode: WaterfallDisplayMode,
  nowMs = Date.now()
): WorkbenchTurn[] {
  if (mode === "full" || turns.length === 0) return turns;
  if (mode === "post-compaction") {
    for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
      const turn = turns[turnIndex];
      if (!turn) continue;
      for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const item = turn.items[itemIndex];
        if ((item?.type === "contextCompaction" || item?.type === "compaction") && isCompletedActivityStatus(item.status)) {
          const boundaryTurn = itemIndex === 0 ? turn : { ...turn, items: turn.items.slice(itemIndex) };
          return [boundaryTurn, ...turns.slice(turnIndex + 1)];
        }
      }
    }
  }
  const cutoffMs = nowMs - HISTORICAL_TOOL_ACTIVITY_AGE_MS;
  let changed = false;
  const selected = turns.map((turn) => {
    const timestamp = turn.completedAt ?? turn.startedAt;
    const timestampMs = timestamp == null ? null : timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
    if (isTurnLiveStatus(turn.status) || timestampMs == null || timestampMs >= cutoffMs) return turn;
    const turnCompleted = isCompletedActivityStatus(turn.status);
    const items = turn.items.filter((item) => !isToolActivityItem(item) || (!turnCompleted && !isCompletedActivityStatus(item.status)));
    if (items.length === turn.items.length) return turn;
    changed = true;
    return { ...turn, items };
  });
  return changed ? selected : turns;
}

function isToolActivityItem(item: WorkbenchItem): boolean {
  return item.type === "commandExecution"
    || item.type === "fileChange"
    || item.type === "mcpToolCall"
    || item.type === "dynamicToolCall"
    || item.type === "toolCall"
    || item.type === "collabAgentToolCall"
    || item.type === "subAgentActivity"
    || item.type === "imageGeneration"
    || item.type === "imageView";
}

export type IncrementalChatRowsCache = {
  cacheKey: string;
  finalizedRows: ChatWaterfallRow[];
  turns: Map<string, {
    turn: WorkbenchTurn;
    tokenUsage: ChatTokenUsage | undefined;
    requestUsage: ChatRequestUsage[] | undefined;
    compactionSource: CompactionSourceDetail | undefined;
    threadBackend: string | undefined;
    rows: ChatWaterfallRow[];
  }>;
};

export function createIncrementalChatRowsCache(): IncrementalChatRowsCache {
  return { cacheKey: "", finalizedRows: [], turns: new Map() };
}

export function buildChatRows(turns: WorkbenchTurn[], filterItem: ChatRowFilter = () => true, tokenUsageByTurnId: Record<string, ChatTokenUsage> = {}, compactionSourceByTurnId: Record<string, CompactionSourceDetail> = {}, requestUsageByTurnId: Record<string, Record<string, ChatTokenUsage>> = {}, threadBackend?: string): ChatWaterfallRow[] {
  return finalizeChatRows(buildRawChatRows(turns, filterItem, tokenUsageByTurnId, compactionSourceByTurnId, requestUsageByTurnId, threadBackend));
}

export function applyWaterfallDisplayMode(
  rows: ChatWaterfallRow[],
  mode: WaterfallDisplayMode,
  nowMs = Date.now()
): { rows: ChatWaterfallRow[]; hiddenCount: number } {
  if (mode === "full" || rows.length === 0) return { rows, hiddenCount: 0 };
  if (mode === "post-compaction") {
    let boundaryIndex = -1;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if ((row?.kind === "contextCompaction" && isCompletedActivityStatus(row.status)) || row?.compactionMarker) {
        boundaryIndex = index;
        break;
      }
    }
    if (boundaryIndex >= 0) {
      return { rows: rows.slice(boundaryIndex), hiddenCount: boundaryIndex };
    }
  }
  return hideHistoricalToolActivity(rows, nowMs);
}

function hideHistoricalToolActivity(
  rows: ChatWaterfallRow[],
  nowMs: number
): { rows: ChatWaterfallRow[]; hiddenCount: number } {
  const cutoffMs = nowMs - HISTORICAL_TOOL_ACTIVITY_AGE_MS;
  const visible: ChatWaterfallRow[] = [];
  let hiddenCount = 0;
  let noticeIndex = -1;
  let firstHidden: ChatWaterfallRow | undefined;

  for (const row of rows) {
    const timestamp = row.completedAt ?? row.startedAt;
    const timestampMs = timestamp == null ? null : timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
    if (!row.isLive && isCompletedActivityStatus(row.status) && timestampMs != null && timestampMs < cutoffMs && isToolActivityRow(row)) {
      firstHidden ??= row;
      noticeIndex = noticeIndex < 0 ? visible.length : noticeIndex;
      hiddenCount += Math.max(1, row.itemIds.length);
      continue;
    }
    visible.push(row);
  }

  if (!firstHidden || hiddenCount === 0) return { rows, hiddenCount: 0 };
  visible.splice(noticeIndex, 0, historicalToolActivityNotice(firstHidden, hiddenCount));
  return { rows: visible, hiddenCount };
}

function isCompletedActivityStatus(status: string | undefined): boolean {
  const normalized = status?.replace(/[_-]+/g, "").toLowerCase();
  return normalized === "completed" || normalized === "complete" || normalized === "succeeded" || normalized === "success";
}

function isToolActivityRow(row: ChatWaterfallRow): boolean {
  return row.kind === "commandExecution"
    || row.kind === "commandGroup"
    || row.kind === "fileChange"
    || row.kind === "fileChangeGroup"
    || row.kind === "toolActivityGroup"
    || row.kind === "toolCall"
    || row.kind === "imageGeneration"
    || row.kind === "imageView"
    || isToolActivityItem(row.item);
}

function historicalToolActivityNotice(first: ChatWaterfallRow, count: number): ChatWaterfallRow {
  const title = `${count} historical tool ${count === 1 ? "activity" : "activities"} hidden`;
  return {
    key: `historical-tool-activity-hidden:${first.threadId}`,
    turnId: first.turnId,
    threadId: first.threadId,
    itemIds: [],
    kind: "notice",
    role: "system",
    text: title,
    title,
    status: "completed",
    item: { id: `historical-tool-activity-hidden-${first.threadId}`, type: "notice", title, text: title, status: "completed" },
    searchText: title.toLowerCase(),
    width: "full",
    isLive: false,
    startedAt: first.startedAt,
    completedAt: first.completedAt
  };
}

export function buildIncrementalChatRows(
  turns: WorkbenchTurn[],
  cache: IncrementalChatRowsCache,
  options: {
    cacheKey: string;
    filterItem?: ChatRowFilter;
    tokenUsageByTurnId?: Record<string, ChatTokenUsage>;
    requestUsageByTurnId?: Record<string, Record<string, ChatTokenUsage>>;
    compactionSourceByTurnId?: Record<string, CompactionSourceDetail>;
    threadBackend?: string;
  }
): ChatWaterfallRow[] {
  const filterItem = options.filterItem ?? (() => true);
  const tokenUsageByTurnId = options.tokenUsageByTurnId ?? {};
  const requestUsageByTurnId = options.requestUsageByTurnId ?? {};
  const compactionSourceByTurnId = options.compactionSourceByTurnId ?? {};
  if (cache.cacheKey !== options.cacheKey) {
    cache.cacheKey = options.cacheKey;
    cache.finalizedRows = [];
    cache.turns.clear();
  }

  const activeTurnIds = new Set(turns.map((turn) => turn.id));
  for (const turnId of cache.turns.keys()) {
    if (!activeTurnIds.has(turnId)) {
      cache.turns.delete(turnId);
    }
  }

  const rows: ChatWaterfallRow[] = [];
  for (const turn of turns) {
    const tokenUsage = tokenUsageByTurnId[turn.id];
    const requestUsage = requestUsageEntries(requestUsageByTurnId[turn.id]);
    const compactionSource = compactionSourceByTurnId[turn.id];
    const existing = cache.turns.get(turn.id);
    if (existing?.turn === turn && existing.tokenUsage === tokenUsage && sameRequestUsage(existing.requestUsage, requestUsage) && existing.compactionSource === compactionSource && existing.threadBackend === options.threadBackend) {
      rows.push(...existing.rows);
      continue;
    }
    const turnRows = buildRawChatRows([turn], filterItem, tokenUsageByTurnId, compactionSourceByTurnId, requestUsageByTurnId, options.threadBackend);
    cache.turns.set(turn.id, { turn, tokenUsage, requestUsage, compactionSource, threadBackend: options.threadBackend, rows: turnRows });
    rows.push(...turnRows);
  }
  cache.finalizedRows = finalizeChatRows(rows, cache.finalizedRows);
  return cache.finalizedRows;
}

function buildRawChatRows(turns: WorkbenchTurn[], filterItem: ChatRowFilter, tokenUsageByTurnId: Record<string, ChatTokenUsage>, compactionSourceByTurnId: Record<string, CompactionSourceDetail>, requestUsageByTurnId: Record<string, Record<string, ChatTokenUsage>>, threadBackend?: string): ChatWaterfallRow[] {
  const rows: ChatWaterfallRow[] = [];

  turns.forEach((turn) => {
    const reasoningBuffer: string[] = [];
    const visibleItems = orderWorkbenchItems(turn.items.filter(filterItem));
    const lastAssistantItemId = [...visibleItems].reverse().find((item) => item.type === "agentMessage")?.id;

    visibleItems.forEach((item) => {
      if (item.type === "reasoning") {
        const content = reasoningText(item);
        if (content) {
          reasoningBuffer.push(content);
        }
        return;
      }

      if (item.type === "agentMessage") {
        const row = itemToRow(turn, item, {
          reasoning: reasoningBuffer.join("\n\n").trim() || undefined,
          tokenUsage: item.id === lastAssistantItemId ? tokenUsageByTurnId[turn.id] : undefined,
          requestUsage: item.id === lastAssistantItemId ? requestUsageEntries(requestUsageByTurnId[turn.id]) : undefined
        });
        rows.push(row);
        reasoningBuffer.length = 0;
        return;
      }

      const row = itemToRow(turn, item, { compactionSource: compactionSourceByTurnId[turn.id], threadBackend });
      rows.push(row);
    });

    if (reasoningBuffer.length > 0 && isTurnLiveStatus(turn.status)) {
      const lastReasoning = [...visibleItems].reverse().find((item) => item.type === "reasoning");
      if (lastReasoning) {
        rows.push(
          itemToRow(turn, lastReasoning, {
            activeThinking: true,
            reasoning: reasoningBuffer.join("\n\n").trim(),
            tokenUsage: tokenUsageByTurnId[turn.id]
          })
        );
      }
    }
  });

  return rows;
}

function finalizeChatRows(rows: ChatWaterfallRow[], previousRows: ChatWaterfallRow[] = []): ChatWaterfallRow[] {
  if (rows.length === 0) return [];
  const visibleRows = collapseSupersededPlanRows(rows);
  if (visibleRows.length === 0) return [];
  if (rows === previousRows) return rows;

  const previousByKey = previousRows.length > 0 ? new Map(previousRows.map((row) => [row.key, row])) : null;
  let assistantMessageIndex = 0;
  let promptIndex = 0;
  const displayRows = visibleRows.map((row) => {
    if (row.kind === "userMessage") {
      promptIndex += 1;
      const label = row.floor?.index === promptIndex && row.floor.label ? row.floor.label : compactLine(row.text || row.title);
      const floor = {
        index: promptIndex,
        label
      };
      const next = row.floor?.index === floor.index && row.floor.label === floor.label ? row : { ...row, floor };
      return previousByKey ? reuseFinalizedRow(previousByKey.get(row.key), next) : next;
    }
    if (row.kind === "assistantMessage") {
      const assistantTone: ChatWaterfallRow["assistantTone"] = assistantMessageIndex % 2 === 0 ? "plain" : "tinted";
      assistantMessageIndex += 1;
      const next = row.assistantTone === assistantTone ? row : { ...row, assistantTone };
      return previousByKey ? reuseFinalizedRow(previousByKey.get(row.key), next) : next;
    }
    return previousByKey ? reuseFinalizedRow(previousByKey.get(row.key), row) : row;
  });
  const finalized = applyAssistantHeaderGrouping(
    compactConsecutiveToolActivityRows(compactConsecutiveRetryErrorRows(collapseStaleCompletedCompactions(displayRows))),
    previousByKey ?? new Map()
  );
  if (!previousByKey || previousRows.length === 0) {
    return finalized;
  }
  return finalized.map((row) => reuseFinalizedRow(previousByKey.get(row.key), row));
}

/**
 * Mini's update_plan replaces the whole checklist on every call, and the
 * carry-forward re-emits pending steps into each new turn — so a thread can
 * hold several plan cards ("Plan" drafts plus "Updated Plan" snapshots).
 * The checklist is a single live view: keep only the newest plan row per
 * thread and drop the superseded ones. State/history data is untouched.
 */
function collapseSupersededPlanRows(rows: ChatWaterfallRow[]): ChatWaterfallRow[] {
  const latestPlanIndexByThread = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.kind === "plan") {
      latestPlanIndexByThread.set(row.threadId, index);
    }
  });
  if (latestPlanIndexByThread.size === 0) return rows;
  return rows.filter((row, index) => row.kind !== "plan" || latestPlanIndexByThread.get(row.threadId) === index);
}

function collapseStaleCompletedCompactions(rows: ChatWaterfallRow[]): ChatWaterfallRow[] {  const hasCompaction = rows.some((row) => row.kind === "contextCompaction" && isCompletedActivityStatus(row.status));
  if (!hasCompaction) return rows;

  const markerTargets = new Map<number, ChatWaterfallRow>();
  const hiddenCompactions = new Set<number>();
  let pendingCompactionIndex = -1;
  let pendingCompactionTurnId = "";
  rows.forEach((row, index) => {
    if (row.kind === "contextCompaction" && isCompletedActivityStatus(row.status)) {
      if (pendingCompactionIndex >= 0) hiddenCompactions.add(pendingCompactionIndex);
      pendingCompactionIndex = index;
      pendingCompactionTurnId = row.turnId;
      return;
    }
    if (
      pendingCompactionIndex >= 0
      && row.turnId !== pendingCompactionTurnId
      && row.kind === "assistantMessage"
      && !row.isLive
    ) {
      hiddenCompactions.add(pendingCompactionIndex);
      markerTargets.set(index, rows[pendingCompactionIndex]!);
      pendingCompactionIndex = -1;
      pendingCompactionTurnId = "";
    }
  });
  return rows.flatMap((row, index) => {
    if (hiddenCompactions.has(index)) return [];
    const source = markerTargets.get(index);
    return [source ? {
      ...row,
      compactionMarker: true,
      compactionSource: source.compactionSource,
      compactionProviderId: source.compactionProviderId,
      compactionModel: source.compactionModel,
      compactionBackend: source.compactionBackend
    } : row];
  });
}

function compactConsecutiveToolActivityRows(rows: ChatWaterfallRow[]): ChatWaterfallRow[] {
  const hasToolActivity = rows.some((row) => isFoldableToolActivity(row));
  if (!hasToolActivity) return rows;

  const next: ChatWaterfallRow[] = [];
  let run: ChatWaterfallRow[] = [];

  function flushRun() {
    if (run.length === 1 && run[0]?.isLive) next.push(run[0]);
    else if (run.length > 0) next.push(toolActivityGroupRow(run));
    run = [];
  }

  for (const row of rows) {
    if (isFoldableToolActivity(row) && (isSettledActivityRow(row) || !row.isLive)) {
      if (run.length > 0 && run[0]?.turnId !== row.turnId) flushRun();
      run.push(row);
      continue;
    }
    flushRun();
    next.push(row);
  }
  flushRun();
  return next;
}

function isFoldableToolActivity(row: ChatWaterfallRow): boolean {
  return row.kind === "commandExecution" || row.kind === "fileChange" || row.kind === "toolCall";
}

function toolActivityGroupRow(rows: ChatWaterfallRow[]): ChatWaterfallRow {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const commandCount = rows.filter((row) => row.kind === "commandExecution").length;
  const editCount = rows.filter((row) => row.kind === "fileChange").length;
  const toolCount = rows.length - commandCount - editCount;
  const title = `${rows.length} tool ${rows.length === 1 ? "call" : "calls"}`;
  const status = groupedActivityStatus(rows);
  return {
    key: `tool-activity-group:${first.key}:${last.key}`,
    turnId: first.turnId,
    threadId: first.threadId,
    itemIds: rows.flatMap((row) => row.itemIds),
    kind: "toolActivityGroup",
    role: "tool",
    text: "",
    title,
    status,
    item: {
      id: `tool-activity-group-${first.item.id}-${last.item.id}`,
      type: "toolActivityGroup",
      title,
      text: "",
      status,
      payload: { count: rows.length, commandCount, editCount, toolCount }
    },
    searchText: title.toLowerCase(),
    width: "wide",
    isLive: false,
    startedAt: first.startedAt,
    completedAt: last.completedAt,
    groupedRows: rows
  };
}

function reuseFinalizedRow(previous: ChatWaterfallRow | undefined, next: ChatWaterfallRow): ChatWaterfallRow {
  return previous && finalizedRowsEqual(previous, next) ? previous : next;
}

function finalizedRowsEqual(previous: ChatWaterfallRow, next: ChatWaterfallRow): boolean {
  return previous.turnId === next.turnId
    && previous.threadId === next.threadId
    && previous.kind === next.kind
    && previous.role === next.role
    && previous.text === next.text
    && previous.title === next.title
    && previous.status === next.status
    && previous.item === next.item
    && previous.reasoning === next.reasoning
    && previous.searchText === next.searchText
    && previous.floor?.index === next.floor?.index
    && previous.floor?.label === next.floor?.label
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
    && previous.compactionBackend === next.compactionBackend
    && previous.itemIds.length === next.itemIds.length
    && previous.itemIds.every((value, index) => value === next.itemIds[index]);
}

function itemToRow(
  turn: WorkbenchTurn,
  item: WorkbenchItem,
  options: { reasoning?: string; activeThinking?: boolean; tokenUsage?: ChatTokenUsage; requestUsage?: ChatRequestUsage[]; compactionSource?: CompactionSourceDetail; threadBackend?: string }
): ChatWaterfallRow {
  const kind = itemKind(item, options.activeThinking);
  const text = primaryText(item, options.reasoning);
  const title = item.title || fallbackTitle(kind);
  const displayText = item.type === "userMessage" ? displayPromptText(item.text) : item.text;
  const searchParts = [title, displayText, item.text, options.reasoning, item.status, item.agentName, item.agentRole].filter(
    (part): part is string => Boolean(part)
  );
  const completedPreviewUrl = kind === "assistantMessage" && !isTurnLiveStatus(turn.status) ? detectLocalPreviewUrl(item.text) : undefined;
  return {
    key: `${turn.id}:${item.id}:${options.activeThinking ? "thinking" : "item"}`,
    turnId: turn.id,
    threadId: turn.threadId,
    itemIds: [item.id],
    kind,
    role: rowRole(kind),
    text,
    title,
    status: item.status,
    item,
    reasoning: options.reasoning,
    searchText: searchParts.join("\n").toLowerCase(),
    width: rowWidth(kind, text),
    isLive: isTurnLiveStatus(turn.status),
    turnStartedAt: turn.startedAt,
    // First-token latency belongs to this assistant item. A turn may contain
    // minutes of reasoning and tools before a later assistant message starts.
    startedAt: kind === "assistantMessage" ? item.startedAt : turn.startedAt,
    completedAt: turn.completedAt,
    firstTokenAt: item.firstTokenAt,
    updatedAt: item.updatedAt ?? item.firstTokenAt ?? turn.completedAt ?? turn.startedAt,
    previewUrl: completedPreviewUrl,
    tokenUsage: options.tokenUsage,
    requestUsage: options.requestUsage,
    ...(kind === "contextCompaction" ? {
      compactionSource: options.compactionSource?.source ?? "native",
      compactionProviderId: options.compactionSource?.providerId,
      compactionModel: options.compactionSource?.model,
      compactionBackend: compactionBackendOf(item, options.threadBackend)
    } : {})
  };
}

/**
 * Provenance for a compaction row's backend (Phase 5): the item's own
 * stamped payload marker when present, else the thread's backend as
 * passed by the panel. No marker and no thread backend = unbranded
 * (undefined) — never another backend's name.
 */
function compactionBackendOf(item: WorkbenchItem, threadBackend?: string): string | undefined {
  const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload) ? item.payload : {};
  const stamped = (payload as { cliBackend?: unknown }).cliBackend;
  if (typeof stamped === "string" && stamped) return stamped;
  return threadBackend || undefined;
}

function requestUsageEntries(value: Record<string, ChatTokenUsage> | undefined): ChatRequestUsage[] | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value).map(([requestId, usage]) => ({ requestId, usage }));
  return entries.length > 0 ? entries : undefined;
}

function sameRequestUsage(previous: ChatRequestUsage[] | undefined, next: ChatRequestUsage[] | undefined): boolean {
  if (previous === next) return true;
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every((entry, index) => entry.requestId === next[index]?.requestId && entry.usage === next[index]?.usage);
}

function applyAssistantHeaderGrouping(
  rows: ChatWaterfallRow[],
  previousByKey: Map<string, ChatWaterfallRow> = new Map()
): ChatWaterfallRow[] {
  const seenAssistantKeys = new Set<string>();
  return rows.map((row) => {
    if (row.kind !== "assistantMessage") {
      return row;
    }
    const key = assistantHeaderKey(row);
    const hideHeader = seenAssistantKeys.has(key);
    seenAssistantKeys.add(key);
    const next = row.hideHeader === hideHeader ? row : { ...row, hideHeader };
    return reuseFinalizedRow(previousByKey.get(row.key), next);
  });
}

function assistantHeaderKey(row: ChatWaterfallRow): string {
  return [row.role, row.item.agentId, row.item.agentThreadId, row.item.agentName, row.title].filter(Boolean).join(":");
}

function itemKind(item: WorkbenchItem, activeThinking?: boolean): ChatRowKind {
  if (item.type === "userMessage") return "userMessage";
  if (item.type === "agentMessage") return "assistantMessage";
  if (item.type === "plan") return "plan";
  if (item.type === "reasoning" && activeThinking) return "reasoningPreview";
  if (item.type === "commandExecution") return "commandExecution";
  if (item.type === "imageGeneration") return "imageGeneration";
  if (item.type === "imageView") return "imageView";
  if (item.type === "contextCompaction" || item.type === "compaction") return "contextCompaction";
  if (item.type === "enteredReviewMode" || item.type === "exitedReviewMode") return "reviewMode";
  if (item.type === "fileChange") return "fileChange";
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall" || item.type === "toolCall" || item.type === "toolUse" || item.type === "tool_use" || item.type === "collabAgentToolCall") return "toolCall";
  if (item.type.toLowerCase().includes("error")) return "error";
  return "status";
}

function compactConsecutiveCommandRows(rows: ChatWaterfallRow[]): ChatWaterfallRow[] {
  const next: ChatWaterfallRow[] = [];
  let run: ChatWaterfallRow[] = [];

  function flushRun() {
    if (run.length === 0) {
      return;
    }
    next.push(commandGroupRow(run));
    run = [];
  }

  for (const row of rows) {
    if (row.kind === "commandExecution" && (isSettledActivityRow(row) || !row.isLive)) {
      run.push(row);
      continue;
    }
    flushRun();
    next.push(row);
  }
  flushRun();
  return next;
}

function commandGroupRow(rows: ChatWaterfallRow[]): ChatWaterfallRow {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const title = `${rows.length} command${rows.length === 1 ? "" : "s"} hidden`;
  const status = groupedActivityStatus(rows);
  return {
    key: `command-group:${first.key}:${last.key}`,
    turnId: first.turnId,
    threadId: first.threadId,
    itemIds: rows.flatMap((row) => row.itemIds),
    kind: "commandGroup",
    role: "tool",
    text: "",
    title,
    status,
    item: {
      id: `command-group-${first.item.id}-${last.item.id}`,
      type: "commandGroup",
      title,
      text: "",
      status: "completed",
      payload: {
        count: rows.length
      }
    },
    searchText: title.toLowerCase(),
    width: "wide",
    isLive: false,
    startedAt: first.startedAt,
    completedAt: last.completedAt,
    groupedRows: rows
  };
}

function isSettledActivityRow(row: ChatWaterfallRow): boolean {
  const status = row.status?.replace(/[_-]+/g, "").toLowerCase();
  return status === "completed"
    || status === "complete"
    || status === "succeeded"
    || status === "success"
    || status === "failed"
    || status === "error"
    || status === "cancelled"
    || status === "canceled"
    || status === "interrupted";
}

function compactConsecutiveFileChangeRows(rows: ChatWaterfallRow[]): ChatWaterfallRow[] {
  const next: ChatWaterfallRow[] = [];
  let run: ChatWaterfallRow[] = [];

  function flushRun() {
    if (run.length === 0) {
      return;
    }
    next.push(fileChangeGroupRow(run));
    run = [];
  }

  for (const row of rows) {
    if (row.kind === "fileChange" && (isSettledActivityRow(row) || !row.isLive)) {
      run.push(row);
      continue;
    }
    flushRun();
    next.push(row);
  }
  flushRun();
  return next;
}

function fileChangeGroupRow(rows: ChatWaterfallRow[]): ChatWaterfallRow {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const fileCount = uniqueFileChangePaths(rows).size || rows.length;
  const title = `Edited ${fileCount} ${fileCount === 1 ? "file" : "files"}`;
  const status = groupedActivityStatus(rows);
  return {
    key: `file-change-group:${first.key}:${last.key}`,
    turnId: first.turnId,
    threadId: first.threadId,
    itemIds: rows.flatMap((row) => row.itemIds),
    kind: "fileChangeGroup",
    role: "tool",
    text: "",
    title,
    status,
    item: {
      id: `file-change-group-${first.item.id}-${last.item.id}`,
      type: "fileChangeGroup",
      title,
      text: "",
      status,
      payload: { count: fileCount, eventCount: rows.length }
    },
    searchText: title.toLowerCase(),
    width: "wide",
    isLive: false,
    startedAt: first.startedAt,
    completedAt: last.completedAt,
    groupedRows: rows
  };
}

function uniqueFileChangePaths(rows: ChatWaterfallRow[]): Set<string> {
  const paths = new Set<string>();
  for (const row of rows) {
    const payload = isRecord(row.item.payload) ? row.item.payload : {};
    for (const key of ["path", "filePath", "name"]) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) paths.add(value.trim());
    }
    if (Array.isArray(payload.changes)) {
      for (const entry of payload.changes) {
        if (!isRecord(entry)) continue;
        const value = entry.path ?? entry.filePath ?? entry.name;
        if (typeof value === "string" && value.trim()) paths.add(value.trim());
      }
    }
  }
  return paths;
}

function groupedActivityStatus(rows: ChatWaterfallRow[]): "completed" | "failed" {
  return rows.some((row) => ["failed", "error", "cancelled", "canceled", "interrupted"].includes(row.status?.toLowerCase() ?? ""))
    ? "failed"
    : "completed";
}

function rowRole(kind: ChatRowKind): ChatRowRole {
  switch (kind) {
    case "userMessage":
      return "user";
    case "assistantMessage":
    case "plan":
    case "reasoningPreview":
      return "assistant";
    case "toolCall":
    case "toolActivityGroup":
    case "toolResult":
    case "fileChange":
    case "fileChangeGroup":
    case "commandExecution":
    case "commandGroup":
    case "imageGeneration":
    case "imageView":
      return "tool";
    default:
      return "system";
  }
}

function rowWidth(kind: ChatRowKind, text: string): ChatRowWidth {
  if (kind === "commandExecution" || kind === "commandGroup" || kind === "fileChange" || kind === "fileChangeGroup" || kind === "toolCall" || kind === "toolActivityGroup" || kind === "imageGeneration" || kind === "imageView" || text.includes("```")) {
    return "wide";
  }
  if (kind === "status" || kind === "notice" || kind === "checkpoint" || kind === "contextCompaction" || kind === "reviewMode") {
    return "full";
  }
  return "prose";
}

function primaryText(item: WorkbenchItem, reasoning?: string): string {
  if (item.type === "reasoning") {
    return reasoningText(item) || reasoning || "";
  }
  if (item.type === "userMessage") {
    return displayPromptText(item.text);
  }
  return item.text;
}

export function reasoningText(item: WorkbenchItem): string {
  if (item.text.trim()) {
    return normalizeReasoningMarkdown(item.text);
  }
  const payload = isRecord(item.payload) ? item.payload : {};
  const summary = payload.summary;
  if (typeof summary === "string") {
    return normalizeReasoningMarkdown(summary);
  }
  if (Array.isArray(summary)) {
    return normalizeReasoningMarkdown(
      summary.map((entry) => (typeof entry === "string" ? entry : summarizeReasoningEntry(entry))).filter(Boolean).join("\n")
    );
  }
  if (isRecord(summary)) {
    return normalizeReasoningMarkdown(summarizeReasoningEntry(summary));
  }
  return "";
}

function compactConsecutiveRetryErrorRows(rows: ChatWaterfallRow[]): ChatWaterfallRow[] {
  const hasRetryError = rows.some((row) => row.kind === "error" && isRecord(row.item.payload) && row.item.payload.retryError === true);
  if (!hasRetryError) return rows;

  const next: ChatWaterfallRow[] = [];
  let run: ChatWaterfallRow[] = [];

  function flushRun() {
    if (run.length > 0) next.push(retryErrorGroupRow(run));
    run = [];
  }

  for (const row of rows) {
    if (row.kind === "error" && isRecord(row.item.payload) && row.item.payload.retryError === true) {
      if (run.length > 0 && run[0]?.threadId !== row.threadId) flushRun();
      run.push(row);
      continue;
    }
    flushRun();
    next.push(row);
  }
  flushRun();
  return next;
}

function retryErrorGroupRow(rows: ChatWaterfallRow[]): ChatWaterfallRow {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const retrying = rows.some((row) => row.status === "running");
  const exhausted = rows.some((row) => isRecord(row.item.payload) && row.item.payload.exhausted === true);
  const status = retrying ? "running" : exhausted ? "failed" : last.status ?? "failed";
  // Surface live retry progress (e.g. mini 502 backoff "attempt 2/5") so the
  // user can see the turn is still retrying instead of a silent spinner.
  const lastPayload = isRecord(last.item.payload) ? last.item.payload : {};
  const attempt = typeof lastPayload.attempt === "number" ? lastPayload.attempt : undefined;
  const max = typeof lastPayload.max === "number" ? lastPayload.max : undefined;
  const progress = retrying && attempt !== undefined && max !== undefined ? ` · retrying ${attempt}/${max}` : "";
  const title = `${rows.length} retry ${rows.length === 1 ? "event" : "events"}${progress}`;
  return {
    key: `retry-error-group:${first.key}:${last.key}`,
    turnId: last.turnId,
    threadId: first.threadId,
    itemIds: rows.flatMap((row) => row.itemIds),
    kind: "retryErrorGroup",
    role: "system",
    text: last.text,
    title,
    status,
    item: {
      id: `retry-error-group-${first.item.id}-${last.item.id}`,
      type: "retryErrorGroup",
      title,
      text: last.text,
      status,
      payload: { retrying, exhausted, count: rows.length }
    },
    searchText: rows.map((row) => row.searchText).join("\n"),
    width: "wide",
    isLive: retrying,
    startedAt: first.startedAt,
    updatedAt: last.updatedAt,
    groupedRows: rows
  };
}

export function normalizeReasoningMarkdown(value: string): string {
  return value
    .trim()
    // Chat-compatible relays stream adjacent bold summary parts as **A****B**.
    // Restore the Markdown block boundary before marked parses the content.
    .replace(/\*{4}(?=[^\s*])/g, "**\n\n**");
}

function summarizeReasoningEntry(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    for (const key of ["text", "summary", "content", "message"]) {
      const nested = value[key];
      if (typeof nested === "string" && nested.trim()) {
        return nested;
      }
    }
    return safeJson(value);
  }
  return "";
}

function fallbackTitle(kind: ChatRowKind): string {
  switch (kind) {
    case "userMessage":
      return "You";
    case "assistantMessage":
      return "Codex";
    case "plan":
      return "Plan";
    case "reasoningPreview":
      return "Thinking";
    case "commandExecution":
      return "Command";
    case "commandGroup":
      return "Commands";
    case "fileChange":
      return "File change";
    case "fileChangeGroup":
      return "Edited files";
    case "imageView":
      return "Image view";
    case "imageGeneration":
      return "Image generation";
    case "toolCall":
      return "Tool";
    case "toolActivityGroup":
      return "Tool calls";
    case "contextCompaction":
      return "Context compaction";
    default:
      return "Status";
  }
}

function compactLine(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}

export function isTurnLiveStatus(status: string): boolean {
  const normalized = status.replace(/[_-]+/g, "").toLowerCase();
  return normalized === "inprogress" || normalized === "running" || normalized === "started";
}

function safeJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

export function cleanPreviewUrl(raw: string): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  let text = raw.trim();
  if (!text) return undefined;

  // Strip wrapping markdown marks, quotes, brackets, braces, parens
  text = text.replace(/^[`'"<(\[{]+/, "").replace(/[`'">)\]}]+$/, "");
  // Strip trailing punctuation (both Latin and CJK)
  text = text.replace(/[.,;:!?，。；：！？、…]+$/, "");
  text = text.replace(/[`'"]+$/, "");

  // If missing protocol, prepend http://
  if (!/^https?:\/\//i.test(text)) {
    text = `http://${text}`;
  }

  try {
    const url = new URL(text);
    const isLocal =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "0.0.0.0" ||
      url.hostname === "[::1]";
    if (!isLocal) return undefined;
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;

    // Sanitize pathname: cut off before any non-ASCII characters (e.g. Chinese text)
    if (url.pathname) {
      url.pathname = url.pathname.replace(/[`'"]+$/g, "");
      const firstNonAscii = url.pathname.search(/[^\x20-\x7E]/);
      if (firstNonAscii >= 0) {
        url.pathname = url.pathname.slice(0, firstNonAscii);
      }
      url.pathname = url.pathname.replace(/[.,;:!?，。；：！？、…`'"]+$/, "");
      if (!url.pathname) {
        url.pathname = "/";
      }
    }

    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function detectLocalPreviewUrl(value: string): string | undefined {
  if (!value || typeof value !== "string") return undefined;

  // Explicit URL: http(s)://(host)(:port)?(/path)?
  // Character class strictly restricted to valid URL ASCII characters to prevent capturing backticks/CJK
  const explicitMatches = [...value.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d{1,5})?(?:\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]*)?/gi)];
  for (let i = explicitMatches.length - 1; i >= 0; i--) {
    const candidate = explicitMatches[i]?.[0];
    if (candidate) {
      const cleaned = cleanPreviewUrl(candidate);
      if (cleaned) return cleaned;
    }
  }

  // Implicit URL: (host)(:port)?(/path)?
  const implicitMatches = [...value.matchAll(/\b(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d{1,5})?(?:\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]*)?/gi)];
  for (let i = implicitMatches.length - 1; i >= 0; i--) {
    const candidate = implicitMatches[i]?.[0];
    if (candidate) {
      const cleaned = cleanPreviewUrl(candidate);
      if (cleaned) return cleaned;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
