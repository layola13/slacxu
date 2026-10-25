import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";
import type { JsonValue } from "@codex-ui/shared";

type LegacyImageView = { id: string; type: "imageView"; path: string };
type CachedHistory = { modifiedAtMs: number; size: number; byTurnId: Map<string, LegacyImageView[]> };

const historyCache = new Map<string, CachedHistory>();

export async function restoreLegacyImageViews(result: JsonValue, historyPath: string): Promise<JsonValue> {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const response = result as Record<string, unknown>;
  const thread = asRecord(response.thread);
  const hasThreadTurns = Array.isArray(thread.turns) && thread.turns.length > 0;
  const hasPageTurns = Array.isArray(response.data) && response.data.length > 0;
  if (!hasThreadTurns && !hasPageTurns) return result;
  const byTurnId = await readLegacyImageViews(historyPath);
  if (byTurnId.size === 0) return result;
  if (Array.isArray(thread.turns)) {
    const turns = restoreTurns(thread.turns, byTurnId);
    if (turns !== thread.turns) {
      response.thread = { ...thread, turns };
    }
  }
  if (Array.isArray(response.data)) {
    response.data = restoreTurns(response.data, byTurnId);
  }
  return result;
}

export async function readLegacyImageViews(historyPath: string): Promise<Map<string, LegacyImageView[]>> {
  const info = statSync(historyPath);
  const cached = historyCache.get(historyPath);
  if (cached && cached.modifiedAtMs === info.mtimeMs && cached.size === info.size) return cached.byTurnId;

  const byTurnId = new Map<string, LegacyImageView[]>();
  const lines = createInterface({ input: createReadStream(historyPath), crlfDelay: Infinity });
  for await (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (entry.type !== "response_item") continue;
    const payload = asRecord(entry.payload);
    if (payload.type !== "function_call" || payload.name !== "view_image") continue;
    const turnId = stringValue(asRecord(payload.internal_chat_message_metadata_passthrough).turn_id);
    const id = stringValue(payload.call_id) ?? stringValue(payload.id);
    const path = viewImagePath(payload.arguments);
    if (!turnId || !id || !path) continue;
    const items = byTurnId.get(turnId) ?? [];
    if (!items.some((item) => item.id === id)) items.push({ id, type: "imageView", path });
    byTurnId.set(turnId, items);
  }
  historyCache.set(historyPath, { modifiedAtMs: info.mtimeMs, size: info.size, byTurnId });
  return byTurnId;
}

function restoreTurns(turns: unknown[], byTurnId: Map<string, LegacyImageView[]>): unknown[] {
  let changed = false;
  const restored = turns.map((value) => {
    const turn = asRecord(value);
    const turnId = stringValue(turn.id);
    const legacyItems = turnId ? byTurnId.get(turnId) : undefined;
    if (!legacyItems?.length) return value;
    const items = Array.isArray(turn.items) ? turn.items : [];
    const existingIds = new Set(items.map((item) => stringValue(asRecord(item).id)).filter(Boolean));
    const missing = legacyItems.filter((item) => !existingIds.has(item.id));
    if (missing.length === 0) return value;
    changed = true;
    return { ...turn, items: [...items, ...missing] };
  });
  return changed ? restored : turns;
}

function viewImagePath(argumentsValue: unknown): string | undefined {
  if (typeof argumentsValue !== "string") return stringValue(asRecord(argumentsValue).path);
  try {
    return stringValue(asRecord(JSON.parse(argumentsValue)).path);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
