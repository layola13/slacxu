import type { JsonValue } from "@codex-ui/shared";
import type { ThreadEntry, WorkbenchTurn } from "../../state/codexClient";

export interface PanelTranscriptProjection {
  turns: WorkbenchTurn[];
  turnsByThreadId: Map<string, WorkbenchTurn[]>;
  threads: ThreadEntry[];
}

export function indexTurnsByThread(
  turns: WorkbenchTurn[],
  previous = new Map<string, WorkbenchTurn[]>(),
): Map<string, WorkbenchTurn[]> {
  const index = new Map<string, WorkbenchTurn[]>();
  for (const turn of turns) {
    const bucket = index.get(turn.threadId);
    if (bucket) bucket.push(turn);
    else index.set(turn.threadId, [turn]);
  }
  for (const [threadId, bucket] of index) {
    const oldBucket = previous.get(threadId);
    if (oldBucket && oldBucket.length === bucket.length && oldBucket.every((turn, position) => turn === bucket[position])) {
      index.set(threadId, oldBucket);
    }
  }
  return index;
}

export function buildPanelTranscriptProjections(input: {
  activeMainThreadIds: Iterable<string>;
  previous?: Map<string, PanelTranscriptProjection>;
  threads: ThreadEntry[];
  turnsByThreadId: Map<string, WorkbenchTurn[]>;
  summaryTurnsByThreadId?: Map<string, WorkbenchTurn[]>;
}): Map<string, PanelTranscriptProjection> {
  const childIdsByParent = new Map<string, string[]>();
  const threadById = new Map(input.threads.map((thread) => [thread.id, thread]));
  for (const thread of input.threads) {
    if (!thread.parentThreadId) continue;
    const ids = childIdsByParent.get(thread.parentThreadId);
    if (ids) ids.push(thread.id);
    else childIdsByParent.set(thread.parentThreadId, [thread.id]);
  }

  const panels = new Map<string, PanelTranscriptProjection>();
  for (const threadId of input.activeMainThreadIds) {
    const thread = threadById.get(threadId);
    if (!thread || thread.parentThreadId) continue;
    const scoped = new Map<string, WorkbenchTurn[]>();
    const scopedThreads = [thread];
    const mainTurns = input.turnsByThreadId.get(thread.id) ?? [];
    scoped.set(thread.id, mainTurns);
    const childIds = new Set(childIdsByParent.get(thread.id) ?? []);
    for (const turn of mainTurns) collectAgentThreadIds(turn, childIds);
    for (const childId of childIds) {
      const childThread = threadById.get(childId);
      if (childThread) scopedThreads.push(childThread);
      // Parent panes need child lifecycle state for the agent rail, but never
      // the child's transcript body. The selected child subscribes to its own
      // projection instead of making every child stream invalidate the parent.
      scoped.set(childId, input.summaryTurnsByThreadId?.get(childId) ?? []);
    }
    const previous = input.previous?.get(thread.id);
    panels.set(thread.id, sameProjection(previous, scoped, scopedThreads) ? previous! : { turns: mainTurns, turnsByThreadId: scoped, threads: scopedThreads });
  }
  return panels;
}

function collectAgentThreadIds(turn: WorkbenchTurn, target: Set<string>): void {
  for (const item of turn.items) {
    if (item.agentThreadId) target.add(item.agentThreadId);
    const payload = record(item.payload);
    const receiverIds = Array.isArray(payload.receiverThreadIds)
      ? payload.receiverThreadIds
      : (Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []);
    for (const value of receiverIds) {
      if (typeof value === "string" && value) target.add(value);
    }
    const payloadThreadId = text(payload.agentThreadId) ?? text(payload.receiverThreadId) ?? text(item.agentThreadId);
    if (payloadThreadId) target.add(payloadThreadId);
  }
}

export function sameProjection(
  previous: PanelTranscriptProjection | undefined,
  scoped: Map<string, WorkbenchTurn[]>,
  threads: ThreadEntry[],
): boolean {
  if (!previous || previous.threads.length !== threads.length || !previous.threads.every((thread, index) => thread === threads[index])) return false;
  const previousBuckets = [...previous.turnsByThreadId.entries()];
  const buckets = [...scoped.entries()];
  return previousBuckets.length === buckets.length && buckets.every(([id, turns], index) => previousBuckets[index]?.[0] === id && previousBuckets[index]?.[1] === turns);
}

function record(value: JsonValue | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
