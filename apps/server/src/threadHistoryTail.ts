import { open, stat } from "node:fs/promises";
import type { JsonValue } from "@codex-ui/shared";

export const LARGE_HISTORY_THRESHOLD_BYTES = 1024 ** 3;
export const DEFAULT_HISTORY_TAIL_BYTES = 4 * 1024 ** 2;
export const TAIL_MAX_TURNS = 2000;
export const TAIL_TEXT_LIMIT = 20_000;

type JsonRecord = Record<string, unknown>;
type TailItem = JsonRecord & { id: string; type: string };
type TailTurn = {
  id: string;
  status: string;
  startedAt?: number;
  completedAt?: number;
  items: TailItem[];
};

export type ThreadHistoryTailResult = {
  thread: JsonRecord & { turns: TailTurn[] };
  tail: { sizeBytes: number; loadedBytes: number; requestedBytes: number; truncated: boolean; droppedPartialLine: boolean; parsedLines: number };
};

export async function readThreadHistoryTail(
  historyPath: string,
  thread: JsonRecord,
  requestedBytes = DEFAULT_HISTORY_TAIL_BYTES,
): Promise<ThreadHistoryTailResult> {
  const info = await stat(historyPath);
  if (!info.isFile()) throw new Error("Thread history path is not a file");
  const byteLimit = Math.max(1, Math.min(Math.floor(requestedBytes), DEFAULT_HISTORY_TAIL_BYTES));
  // Giant single-line tool outputs can exceed the tail window: probe up to 2MB
  // further back so a cut mid-line still yields complete JSONL records instead
  // of throwing "no complete JSONL record" on 3G histories.
  let start = Math.max(0, info.size - byteLimit);
  let text = "";
  let droppedPartialLine = false;
  for (let probe = 0; probe < 3; probe += 1) {
    const handle = await open(historyPath, "r");
    try {
      const len = info.size - start;
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await handle.read(buf, 0, buf.length, start);
      text = buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
    if (start === 0) break;
    const firstNewline = text.indexOf("\n");
    if (firstNewline >= 0) {
      text = text.slice(firstNewline + 1);
      droppedPartialLine = true;
      break;
    }
    if (probe >= 2) throw new Error("The selected history tail contains no complete JSONL record");
    start = Math.max(0, start - 1024 ** 2);
  }

  const records: JsonRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed)) records.push(parsed);
    } catch {
      // A concurrently appended final record may be incomplete. Other malformed
      // complete records are ignored without widening the read to the full file.
    }
  }
  if (records.length === 0) throw new Error("No valid JSONL records were found in the selected history tail");

  return {
    thread: { ...thread, turns: projectTailRecords(records) },
    tail: {
      sizeBytes: info.size,
      loadedBytes: Buffer.byteLength(text),
      requestedBytes: byteLimit,
      truncated: start > 0,
      droppedPartialLine,
      parsedLines: records.length,
    },
  };
}

export function projectTailRecords(records: JsonRecord[]): TailTurn[] {
  const turns: TailTurn[] = [];
  const byId = new Map<string, TailTurn>();
  let current: TailTurn | undefined;
  let sequence = 0;

  const ensureTurn = (preferredId?: string): TailTurn => {
    const id = preferredId || current?.id || `tail-recovered-${sequence + 1}`;
    const existing = byId.get(id);
    if (existing) { current = existing; return existing; }
    const turn = { id, status: "completed", items: [] } satisfies TailTurn;
    turns.push(turn);
    byId.set(id, turn);
    current = turn;
    sequence += 1;
    return turn;
  };

  for (const record of records) {
    if (turns.length >= TAIL_MAX_TURNS) break;
    const outerType = stringValue(record.type);
    const payload = asRecord(record.payload);
    if (outerType === "turn_context") {
      ensureTurn(stringValue(payload.turn_id) ?? stringValue(payload.turnId));
      continue;
    }
    if (outerType === "compacted") {
      upsertItem(ensureTurn(), { id: `tail-compaction-${sequence}`, type: "contextCompaction" });
      continue;
    }
    if (outerType !== "event_msg") continue;

    const eventType = stringValue(payload.type);
    const turnId = stringValue(payload.turn_id) ?? stringValue(payload.turnId);
    if (eventType === "task_started" || eventType === "turn_started") {
      const turn = ensureTurn(turnId);
      turn.status = "inProgress";
      turn.startedAt = timestampValue(payload.started_at ?? payload.startedAt);
      continue;
    }
    if (eventType === "task_complete" || eventType === "turn_complete" || eventType === "turn_aborted") {
      const turn = ensureTurn(turnId);
      turn.status = eventType === "turn_aborted" || isRecord(payload.error) ? "failed" : "completed";
      turn.completedAt = timestampValue(payload.completed_at ?? payload.completedAt);
      continue;
    }

    const turn = ensureTurn(turnId);
    const item = eventToItem(eventType, payload, turn.items.length);
    if (item) upsertItem(turn, item);
  }
  return turns.filter((turn) => turn.items.length > 0);
}

function eventToItem(type: string | undefined, payload: JsonRecord, index: number): TailItem | null {
  const embedded = asRecord(payload.item);
  if ((type === "item_started" || type === "item_completed") && stringValue(embedded.id)) {
    return truncateTailItem(embedded as TailItem);
  }
  const id = stringValue(payload.call_id) ?? stringValue(payload.item_id) ?? `tail-${type ?? "item"}-${index}`;
  switch (type) {
    case "user_message":
      return truncateTailItem({ id, type: "userMessage", content: userMessageContent(payload) });
    case "agent_message":
      return truncateTailItem({ id, type: "agentMessage", text: stringValue(payload.message) ?? "" });
    case "agent_reasoning":
      return truncateTailItem({ id, type: "reasoning", summary: [stringValue(payload.text) ?? ""] });
    case "exec_command_begin":
    case "exec_command_end":
      return truncateTailItem({
        id, type: "commandExecution", command: arrayOrString(payload.command),
        aggregatedOutput: stringValue(payload.aggregated_output) ?? stringValue(payload.formatted_output) ?? "",
        status: type.endsWith("begin") ? "inProgress" : commandStatus(payload),
      });
    case "patch_apply_begin":
    case "patch_apply_end":
      return { id, type: "fileChange", changes: payload.changes ?? {}, status: type.endsWith("begin") ? "inProgress" : commandStatus(payload) };
    case "mcp_tool_call_begin":
    case "mcp_tool_call_end": {
      const invocation = asRecord(payload.invocation);
      return { id, type: "mcpToolCall", server: invocation.server, tool: invocation.tool, arguments: invocation.arguments, result: payload.result, error: payload.error, status: type.endsWith("begin") ? "inProgress" : commandStatus(payload) };
    }
    case "view_image_tool_call":
      return stringValue(payload.path) ? { id, type: "imageView", path: stringValue(payload.path)! } : null;
    case "context_compacted":
      return { id, type: "contextCompaction", status: "completed" };
    case "error":
      return { id, type: "error", text: stringValue(payload.message) ?? "Unknown history error", status: "failed" };
    default:
      return null;
  }
}

function upsertItem(turn: TailTurn, item: TailItem): void {
  const index = turn.items.findIndex((current) => current.id === item.id);
  if (index >= 0) turn.items[index] = { ...turn.items[index], ...item };
  else turn.items.push(item);
}

function truncateTailItem<T extends TailItem>(item: T): T {
  const out: Record<string, unknown> = { ...item };
  for (const key of ["text", "aggregatedOutput"] as const) {
    const value = (out as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > TAIL_TEXT_LIMIT) {
      (out as Record<string, unknown>)[key] = `${value.slice(0, TAIL_TEXT_LIMIT)}\n…[历史过长已截断，原文共 ${value.length} 字符]`;
    }
  }
  const summary = (out as Record<string, unknown>).summary;
  if (Array.isArray(summary)) {
    (out as Record<string, unknown>).summary = summary.map((entry) =>
      typeof entry === "string" && entry.length > TAIL_TEXT_LIMIT
        ? `${entry.slice(0, TAIL_TEXT_LIMIT)}\n…[历史过长已截断，原文共 ${entry.length} 字符]`
        : entry);
  }
  return out as T;
}

function userMessageContent(payload: JsonRecord): JsonValue[] {
  const content: JsonValue[] = [];
  const message = stringValue(payload.message);
  if (message) content.push({ type: "text", text: message, text_elements: Array.isArray(payload.text_elements) ? payload.text_elements as JsonValue[] : [] });
  for (const path of Array.isArray(payload.local_images) ? payload.local_images : []) {
    if (typeof path === "string") content.push({ type: "localImage", path });
  }
  return content;
}

function commandStatus(payload: JsonRecord): string {
  const status = stringValue(payload.status);
  if (status) return status;
  const exitCode = typeof payload.exit_code === "number" ? payload.exit_code : 0;
  return exitCode === 0 ? "completed" : "failed";
}

function arrayOrString(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return typeof value === "string" ? [value] : [];
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value > 10_000_000_000 ? value : value * 1_000;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function asRecord(value: unknown): JsonRecord { return isRecord(value) ? value : {}; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
