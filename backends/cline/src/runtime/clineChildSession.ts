/**
 * Cline subagent child-session projection (muse pattern).
 *
 * The hub never forwards subagent tool activity to subscribers
 * (`dispatchAgentEvent` drops non-root agent ids — verified in the installed
 * cline 3.0.73 bundle), but the daemon persists every subagent transcript to
 * disk: `sessions/<root>/agent_<uuid>.messages.json` with
 * `origin.parentThreadId` pointing at the root session. When the user opens a
 * spawn collab card, the bridge resolves the card's toolCallId to that file
 * (via a small `cxu-spawns.json` index written on `tool.started`, matched by
 * task text) and projects its messages into child thread items — the same
 * read-on-open shape muse uses for `session.jsonl` children.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ClineSpawnRef {
  toolCallId: string;
  rootSessionId: string;
  task: string;
  systemPrompt: string;
  startedAt: number;
  /**
   * Delegated agent id when the CLI names one (`team_spawn_teammate` /
   * `team_run_task` `agentId`, `spawn_agent` subagent). Team transcripts are
   * persisted as `agent-<agentId>__<suffix>.messages.json`, so the id is the
   * exact join key — several cards (spawn + each run) share one file.
   */
  agentId?: string;
}

export interface ClineChildProjection {
  childId: string;
  rootSessionId: string;
  agentFile: string;
  items: Array<Record<string, unknown>>;
  /** True while the spawn card is still open (no `tool.finished` seen). */
  running: boolean;
  startedAt: number;
}

function sessionsDir(dataDir: string): string {
  return join(dataDir, "sessions");
}

function spawnsIndexPath(dataDir: string, rootSessionId: string): string {
  return join(sessionsDir(dataDir), rootSessionId, "cxu-spawns.json");
}

function readSpawnsIndex(dataDir: string, rootSessionId: string): ClineSpawnRef[] {
  try {
    const raw = readFileSync(spawnsIndexPath(dataDir, rootSessionId), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is ClineSpawnRef => {
        const record = entry as Record<string, unknown>;
        return typeof record.toolCallId === "string" && typeof record.rootSessionId === "string";
      });
    }
  } catch {
    // Missing/corrupt index: fall back to content matching.
  }
  return [];
}

/** Persist a spawn ref so child cards resolve after bridge restarts. */
export function recordClineSpawn(dataDir: string, ref: ClineSpawnRef): void {
  try {
    const dir = join(sessionsDir(dataDir), ref.rootSessionId);
    mkdirSync(dir, { recursive: true });
    const existing = readSpawnsIndex(dataDir, ref.rootSessionId);
    const index = existing.findIndex((entry) => entry.toolCallId === ref.toolCallId);
    if (index >= 0) {
      // Entries written before agentId capture lack the team join key: merge
      // it once the transcript backfill knows it, otherwise team cards fall
      // back to task-text matching and can open the wrong teammate.
      const current: ClineSpawnRef | undefined = existing[index];
      if (!current) return;
      const merged: ClineSpawnRef = {
        ...current,
        ...(current.agentId || !ref.agentId ? {} : { agentId: ref.agentId }),
        ...(current.task.trim() || !ref.task ? {} : { task: ref.task }),
        ...(current.systemPrompt.trim() || !ref.systemPrompt ? {} : { systemPrompt: ref.systemPrompt }),
      };
      if (JSON.stringify(merged) === JSON.stringify(current)) return;
      existing[index] = merged;
    } else {
      existing.push(ref);
    }
    writeFileSync(spawnsIndexPath(dataDir, ref.rootSessionId), JSON.stringify(existing.slice(-50)));
  } catch {
    // Indexing must never break turns.
  }
}

/** Tool names whose input carries a delegated task (mirrors isClineTaskTool). */
const TASK_TOOL_NAMES = new Set(["spawn_agent", "team_run_task", "team_spawn_teammate", "new_task", "task"]);

/** Roots backfilled from their transcript, with the last scan time. */
const transcriptIndexedAt = new Map<string, number>();

/**
 * Backfill the spawn index from the daemon's own root transcript
 * (`sessions/<root>/<root>.messages.json`): its `tool_use` blocks carry the
 * hub toolCallIds plus `{task, systemPrompt}` inputs. This resolves cards
 * whose `tool.started` predates the index (older sessions, bridge restarts
 * without a history load) with exact ids — no timestamp guessing.
 */
export function indexClineSpawnsFromTranscript(dataDir: string, rootSessionId: string): number {
  const key = `${dataDir}::${rootSessionId}`;
  // Re-scan at most every couple of seconds: a long-lived session keeps
  // spawning teammates, and the transcript is written incrementally.
  const lastScan = transcriptIndexedAt.get(key) ?? 0;
  if (Date.now() - lastScan < 2000) return 0;
  transcriptIndexedAt.set(key, Date.now());
  let added = 0;
  try {
    const raw = readFileSync(join(sessionsDir(dataDir), rootSessionId, `${rootSessionId}.messages.json`), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!Array.isArray(parsed.messages)) return 0;
    for (const entry of parsed.messages) {
      const message = entry as Record<string, unknown>;
      const blocks = Array.isArray(message.content) ? message.content : [];
      for (const block of blocks) {
        const part = block as Record<string, unknown>;
        if (part.type !== "tool_use") continue;
        const name = typeof part.name === "string" ? part.name.trim().toLowerCase() : "";
        if (!TASK_TOOL_NAMES.has(name)) continue;
        const id = typeof part.id === "string" ? part.id : "";
        const input = part.input as Record<string, unknown> | undefined;
        // `team_spawn_teammate` sends `rolePrompt` instead of `task`.
        const task = input && typeof input.task === "string" && input.task
          ? input.task
          : input && typeof input.rolePrompt === "string"
            ? input.rolePrompt
            : input && typeof input.description === "string" ? input.description : "";
        const agentId = input && typeof input.agentId === "string" && input.agentId
          ? input.agentId
          : input && typeof input.subagent === "string" && input.subagent
            ? input.subagent
            : input && typeof input.name === "string" ? input.name : "";
        if (!id || (!task.trim() && !agentId.trim())) continue;
        const before = readSpawnsIndex(dataDir, rootSessionId).length;
        recordClineSpawn(dataDir, {
          toolCallId: id,
          rootSessionId,
          task: task.slice(0, 4000),
          systemPrompt: input && typeof input.systemPrompt === "string" ? input.systemPrompt.slice(0, 4000) : "",
          startedAt: Date.now(),
          ...(agentId ? { agentId } : {}),
        });
        if (readSpawnsIndex(dataDir, rootSessionId).length > before) added += 1;
      }
    }
  } catch {
    // Missing/unreadable transcript: fall back to content matching.
  }
  return added;
}

/**
 * Per-agent transcripts. Two daemon naming schemes exist:
 *   subagent mode: `agent_<uuid>.messages.json`
 *   team mode:     `agent-<agentId>__<suffix>.messages.json`
 * Team mode was previously invisible here, so every team card resolved to
 * "no child thread" and the child view stayed empty.
 */
function listAgentFiles(dataDir: string, rootSessionId: string): string[] {
  try {
    return readdirSync(join(sessionsDir(dataDir), rootSessionId))
      .filter((name) => (name.startsWith("agent_") || name.startsWith("agent-")) && name.endsWith(".messages.json"))
      .map((name) => join(sessionsDir(dataDir), rootSessionId, name));
  } catch {
    return [];
  }
}

function readAgentHead(file: string): { parentThreadId: string; subagent: string; firstUserText: string; mtime: number; messageCount: number } | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const origin = parsed.origin as Record<string, unknown> | undefined;
    const parentThreadId = origin && typeof origin.parentThreadId === "string" ? origin.parentThreadId : "";
    const subagent = origin && typeof origin.subagent === "string" ? origin.subagent : "";
    let firstUserText = "";
    const messages = parsed.messages;
    if (Array.isArray(messages)) {
      for (const entry of messages) {
        const message = entry as Record<string, unknown>;
        if (message.role !== "user") continue;
        const content = message.content;
        const blocks = Array.isArray(content) ? content : [];
        for (const block of blocks) {
          const part = block as Record<string, unknown>;
          if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
            firstUserText = part.text;
            break;
          }
        }
        if (firstUserText) break;
      }
    }
    const messageCount = Array.isArray(messages) ? messages.length : 0;
    return { parentThreadId, subagent, firstUserText, mtime: statSync(file).mtimeMs, messageCount };
  } catch {
    return null;
  }
}

/**
 * Resolve a spawn card's toolCallId to its on-disk agent transcript.
 * Prefers the task-text match from the spawn index; falls back to the
 * freshest unclaimed file when the bridge restarted without live events.
 */
export function findClineChildFile(
  dataDir: string,
  toolCallId: string,
  claimedFiles: Set<string> = new Set(),
): { rootSessionId: string; file: string } | null {
  const id = toolCallId.trim();
  if (!id) return null;
  try {
    const roots = readdirSync(sessionsDir(dataDir)).filter((name) => {
      try {
        return !name.startsWith(".") && statSync(join(sessionsDir(dataDir), name)).isDirectory();
      } catch {
        return false;
      }
    });
    // Indexed path: find the session whose spawn index names this card.
    // When the index misses, backfill it from the daemon's root transcript
    // (exact toolCallIds, no guessing) before falling back to content match.
    for (const root of roots) {
      let refs = readSpawnsIndex(dataDir, root);
      if (!refs.some((entry) => entry.toolCallId === id)) {
        indexClineSpawnsFromTranscript(dataDir, root);
        refs = readSpawnsIndex(dataDir, root);
      }
      let ref = refs.find((entry) => entry.toolCallId === id);
      if (!ref) continue;
      if (!ref.agentId) {
        // Index entries written before agentId capture only know the task
        // text: one (throttled) transcript backfill enriches them so team
        // cards join their transcript by id.
        indexClineSpawnsFromTranscript(dataDir, root);
        ref = readSpawnsIndex(dataDir, root).find((entry) => entry.toolCallId === id) ?? ref;
      }
      const files = listAgentFiles(dataDir, root);
      const heads = files
        .map((file) => ({ file, head: readAgentHead(file) }))
        .filter((entry): entry is { file: string; head: NonNullable<ReturnType<typeof readAgentHead>> } => Boolean(entry.head));
      // Exact join first: team members have one transcript shared by the spawn
      // card and every run card, so the same file legitimately answers several
      // toolCallIds.
      const refAgent = (ref.agentId ?? "").trim();
      if (refAgent) {
        // The same teammate can be re-spawned (new suffix, same agentId):
        // prefer the transcript that actually holds messages.
        const exact = heads
          .filter((entry) => entry.head.subagent === refAgent)
          .sort((a, b) => b.head.messageCount - a.head.messageCount || b.head.mtime - a.head.mtime);
        if (exact[0]) return { rootSessionId: root, file: exact[0].file };
      }
      const taskHead = ref.task.trim().slice(0, 160);
      let best: string | null = null;
      for (const entry of heads) {
        if (claimedFiles.has(entry.file)) continue;
        const head = entry.head;
        if (taskHead && head.firstUserText && (head.firstUserText.includes(taskHead) || taskHead.includes(head.firstUserText.slice(0, 160)))) {
          best = entry.file;
          break;
        }
      }
      if (!best) {
        const fresh = heads
          .filter((entry) => !claimedFiles.has(entry.file))
          .sort((a, b) => b.head.mtime - a.head.mtime);
        best = fresh[0]?.file ?? null;
      }
      if (best) return { rootSessionId: root, file: best };
      return null;
    }
    // Unindexed fallback (pre-index cards): single-candidate sessions only.
    for (const root of roots) {
      const files = listAgentFiles(dataDir, root).filter((file) => !claimedFiles.has(file));
      if (files.length === 1 && files[0]) return { rootSessionId: root, file: files[0] };
    }
  } catch {
    // Resolution must never break reads.
  }
  return null;
}

/** Best-effort parse of a `tool_use` input (daemon stores it as a string). */
function parseToolInput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Python-repr payloads stay raw; no data loss.
      }
      return { raw: trimmed.slice(0, 4000) };
    }
  }
  return {};
}

/**
 * Project an agent transcript file into child thread items. Block kinds are
 * the plain Anthropic content shapes the daemon persists (`text`,
 * `thinking`, `tool_use`, `tool_result`) — no hub envelope.
 */
export function projectClineChildFile(
  file: string,
  childId: string,
  running: boolean,
): ClineChildProjection | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.messages)) return null;
  const origin = parsed.origin as Record<string, unknown> | undefined;
  const rootSessionId = origin && typeof origin.parentThreadId === "string" ? origin.parentThreadId : "";
  const items: Array<Record<string, unknown>> = [];
  const toolsById = new Map<string, Record<string, unknown>>();
  let seg = 0;
  const pushText = (kind: "user" | "assistant" | "reasoning", text: string) => {
    if (!text.trim()) return;
    seg += 1;
    if (kind === "user") {
      items.push({ type: "userMessage", id: `cline-${childId}-user-${seg}`, turnId: childId, threadId: childId, content: [{ type: "text", text }], status: "completed" });
    } else if (kind === "reasoning") {
      items.push({ type: "reasoning", id: `cline-${childId}-thinking-${seg}`, turnId: childId, threadId: childId, content: text, status: "completed" });
    } else {
      items.push({ type: "agentMessage", id: `cline-${childId}-text-${seg}`, turnId: childId, threadId: childId, content: text, role: "assistant", status: "completed" });
    }
  };
  for (const entry of parsed.messages as Array<Record<string, unknown>>) {
    const blocks = Array.isArray(entry.content) ? entry.content : [];
    for (const block of blocks) {
      const part = block as Record<string, unknown>;
      const type = typeof part.type === "string" ? part.type : "";
      if (type === "text" && typeof part.text === "string") {
        pushText(entry.role === "user" ? "user" : "assistant", part.text);
      } else if (type === "thinking" && typeof part.thinking === "string") {
        pushText("reasoning", part.thinking);
      } else if (type === "tool_use") {
        const id = typeof part.id === "string" && part.id ? part.id : `cline-${childId}-tool-${seg + 1}`;
        const name = typeof part.name === "string" && part.name ? part.name : "Tool";
        const input = parseToolInput(part.input);
        const item: Record<string, unknown> = {
          type: "toolCall",
          id,
          threadId: childId,
          turnId: childId,
          name,
          tool: name,
          toolName: name,
          input,
          arguments: input,
          status: "inProgress",
        };
        toolsById.set(id, item);
        items.push(item);
      } else if (type === "tool_result") {
        const ref = typeof part.tool_use_id === "string" ? part.tool_use_id : "";
        const target = (ref && toolsById.get(ref)) ?? null;
        const content = typeof part.content === "string" ? part.content : JSON.stringify(part.content ?? "");
        const failed = part.is_error === true;
        if (target) {
          if (content) {
            target.output = content.slice(0, 4000);
            target.result = { content: content.slice(0, 4000) };
          }
          target.status = failed ? "failed" : "completed";
        } else if (ref) {
          const name = typeof part.name === "string" && part.name ? part.name : "Tool";
          items.push({
            type: "toolCall",
            id: ref,
            threadId: childId,
            turnId: childId,
            name,
            tool: name,
            toolName: name,
            ...(content ? { output: content.slice(0, 4000), result: { content: content.slice(0, 4000) } } : {}),
            status: failed ? "failed" : "completed",
          } as Record<string, unknown>);
        }
      }
    }
  }
  let startedAt = 0;
  try {
    startedAt = Math.floor(statSync(file).birthtimeMs || statSync(file).mtimeMs);
  } catch {
    // Leave zeroed.
  }
  return { childId, rootSessionId, agentFile: file, items, running, startedAt };
}
