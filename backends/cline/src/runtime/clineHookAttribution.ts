/**
 * Teammate tool attribution for cline team mode (cline 3.0.73, reversed).
 *
 * The hub subscriber stream carries NO agent attribution on tool/delta
 * events — verified in the installed bundle
 * (`@cline/core/dist/hub/daemon/entry.js`, projector `ZK`): only
 * `session.notice` keeps `teamAgentId`/`teamRole`. A teammate's
 * `tool.started/updated/finished` arrives on the root session stream with
 * exactly the lead's envelope shape, so projecting everything into the main
 * waterfall renders subagent tools as main-task rows.
 *
 * The daemon does persist the routing out-of-band, and this module reads
 * exactly that (read-only, never writes daemon files):
 *
 * 1. `logs/hooks.jsonl` — every tool call fires a `tool_call` hook line with
 *    `tool_call.id` (identical to the hub `toolCallId`, verified 112/112 on a
 *    live team session), `agent_id` (runtime uuid), `taskId` (conversation)
 *    and `sessionContext.rootSessionId`. Tailed incrementally.
 * 2. `db/teams.db` `team_events` — `teammate_spawned` payloads join a runtime
 *    uuid to the team agent id (`teammate.runtimeAgentId` -> `agentId`, e.g.
 *    `agent_b28c…` -> `server-arch`). Loaded over node:sqlite; when sqlite is
 *    unavailable the map simply stays empty.
 * 3. `sessions/<root>/cxu-spawns.json` — the existing spawn index joins the
 *    team agent id to the child card (toolCallId). Newest card wins, so a
 *    `team_run_task` run card is preferred over its `team_spawn_teammate`.
 *
 * Anything unresolvable returns null and the caller keeps today's behaviour
 * (main waterfall) — attribution can only move rows into a child card, never
 * drop a tool.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSpawnsIndex } from "./clineChildSession.js";

export interface HookToolOwner {
  runtimeAgentId: string;
  rootSessionId: string;
  convId: string;
}

interface TeamMemberLink {
  teamAgentId: string;
  rootSessionId: string;
}

interface SqliteDb {
  prepare: (sql: string) => { all: (...params: unknown[]) => Array<Record<string, unknown>> };
  close: () => void;
}

const HOOK_TAIL_REWIND_BYTES = 2 * 1024 * 1024;
const TEAM_LOAD_MIN_MS = 10_000;
const SPAWN_INDEX_CACHE_MS = 2_000;
const MAX_TOOL_OWNERS = 4_000;

function hooksLogPath(dataDir: string): string {
  return join(dataDir, "logs", "hooks.jsonl");
}

function teamsDbPath(dataDir: string): string {
  return join(dataDir, "db", "teams.db");
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type SqliteCtor = new (path: string, options?: Record<string, unknown>) => SqliteDb;

export class ClineHookAttribution {
  private hookOffset = -1;
  private toolOwners = new Map<string, HookToolOwner>();
  private agentRoot = new Map<string, string>();
  private convRoot = new Map<string, string>();
  private teamLinks = new Map<string, TeamMemberLink>();
  private teamLoadAt = 0;
  private sqliteCtor: SqliteCtor | null = null;
  private sqliteWarmed = false;
  private sqliteUnusable = false;
  private spawnCache = new Map<string, { at: number; refs: ReturnType<typeof readSpawnsIndex> }>();

  /**
   * Resolve a hub toolCallId to the child card (spawn/run toolCallId) that
   * owns it, scoped to one root session. Null = lead's own tool (or unknown).
   * Purely synchronous over cached maps; call `primeTeamLinks` on spawn/run
   * events so the sqlite join is warm before the first tool lands.
   */
  resolveChildCard(dataDir: string, rootSessionId: string, toolCallId: string): string | null {
    if (!toolCallId || !rootSessionId) return null;
    this.tailHooks(dataDir);
    const owner = this.toolOwners.get(toolCallId);
    if (!owner || owner.rootSessionId !== rootSessionId) return null;
    // The spawn row flushes before the teammate's first tool runs, but the
    // join may simply not have been loaded yet: one synchronous reload covers
    // it (node:sqlite is fully synchronous once imported).
    let link = this.teamLinks.get(owner.runtimeAgentId);
    if ((!link || link.rootSessionId !== rootSessionId) && this.loadTeamLinks(dataDir, true)) {
      link = this.teamLinks.get(owner.runtimeAgentId);
    }
    if (!link || link.rootSessionId !== rootSessionId) return null;
    const refs = this.cachedSpawns(dataDir, rootSessionId);
    for (let index = refs.length - 1; index >= 0; index -= 1) {
      const ref = refs[index];
      if (ref && ref.agentId === link.teamAgentId) return ref.toolCallId;
    }
    return null;
  }

  /**
   * Warm the runtime-uuid -> team-agent join: import sqlite (async, once) and
   * load current rows when already importable. Never throws. Call on bridge
   * start and on every team spawn/run event so the join is hot before the
   * first teammate tool lands.
   */
  primeTeamLinks(dataDir: string): void {
    this.tailHooks(dataDir);
    void this.warmSqlite().then(() => {
      this.loadTeamLinks(dataDir, false);
    });
  }

  private async warmSqlite(): Promise<void> {
    if (this.sqliteWarmed || this.sqliteUnusable) return;
    try {
      const mod = await import("node:sqlite") as { DatabaseSync?: SqliteCtor };
      if (typeof mod.DatabaseSync === "function") this.sqliteCtor = mod.DatabaseSync;
      else this.sqliteUnusable = true;
    } catch {
      this.sqliteUnusable = true;
    } finally {
      this.sqliteWarmed = true;
    }
  }

  /** Last hook byte consumed (memory only; cold start rewinds a bounded tail). */
  private tailHooks(dataDir: string): void {
    let size = -1;
    try {
      size = statSync(hooksLogPath(dataDir)).size;
    } catch {
      return;
    }
    if (size < 0) return;
    let from = this.hookOffset;
    if (from < 0) from = Math.max(0, size - HOOK_TAIL_REWIND_BYTES);
    else if (from > size) from = 0;
    if (from >= size) return;
    let text = "";
    try {
      text = readFileSync(hooksLogPath(dataDir)).subarray(from, size).toString("utf8");
    } catch {
      return;
    }
    // A cold-start rewind can land mid-line: drop the partial head.
    const headEnd = from > 0 ? text.indexOf("\n") : -1;
    const lines = (headEnd >= 0 ? text.slice(headEnd + 1) : text).split("\n");
    for (const line of lines) {
      if (!line.includes("agent_start") && !line.includes("tool_call")) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const ctx = parsed.sessionContext as Record<string, unknown> | undefined;
      const root = stringField(ctx?.rootSessionId);
      const agentId = stringField(parsed.agent_id);
      const conv = stringField(parsed.taskId);
      if (!root || !agentId) continue;
      // agent_start carries the runtime before its first tool: register the
      // root early so the spawn-row join resolves on first contact.
      this.agentRoot.set(agentId, root);
      if (conv) this.convRoot.set(conv, root);
      if (parsed.hookName !== "tool_call") continue;
      const call = parsed.tool_call as Record<string, unknown> | undefined;
      const id = stringField(call?.id);
      if (!id) continue;
      this.toolOwners.set(id, { runtimeAgentId: agentId, rootSessionId: root, convId: conv });
      if (this.toolOwners.size > MAX_TOOL_OWNERS) {
        const oldest = this.toolOwners.keys().next().value;
        if (oldest !== undefined) this.toolOwners.delete(oldest);
      }
      this.agentRoot.set(agentId, root);
      if (conv) this.convRoot.set(conv, root);
    }
    this.hookOffset = size;
  }

  private cachedSpawns(dataDir: string, rootSessionId: string): ReturnType<typeof readSpawnsIndex> {
    const key = `${dataDir}::${rootSessionId}`;
    const cached = this.spawnCache.get(key);
    if (cached && Date.now() - cached.at < SPAWN_INDEX_CACHE_MS) return cached.refs;
    const refs = readSpawnsIndex(dataDir, rootSessionId);
    this.spawnCache.set(key, { at: Date.now(), refs });
    return refs;
  }

  /**
   * (Re)load the runtime-uuid -> team-agent join. Synchronous once sqlite is
   * warm. Forced reloads (link miss on a known owner) are throttled to avoid
   * hammering the daemon's database during tool bursts. Returns true when a
   * load ran.
   */
  private loadTeamLinks(dataDir: string, forced: boolean): boolean {
    if (!this.sqliteCtor) return false;
    const now = Date.now();
    if (!forced && now - this.teamLoadAt < TEAM_LOAD_MIN_MS) return false;
    this.teamLoadAt = now;
    let db: SqliteDb | null = null;
    try {
      db = new this.sqliteCtor(teamsDbPath(dataDir), { readOnly: true });
      const rows = db.prepare(
        "SELECT payload_json FROM team_events WHERE event_type = 'teammate_spawned'",
      ).all();
      for (const row of rows) {
        const raw = row["payload_json"];
        if (typeof raw !== "string") continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (payload.type !== "teammate_spawned") continue;
        const teamAgentId = stringField(payload.agentId);
        const mate = payload.teammate as Record<string, unknown> | undefined;
        const runtimeAgentId = stringField(mate?.runtimeAgentId);
        if (!teamAgentId || !runtimeAgentId) continue;
        const conv = stringField(mate?.conversationId);
        const root = this.agentRoot.get(runtimeAgentId)
          ?? (conv ? (this.convRoot.get(conv) ?? "") : "")
          ?? "";
        if (!root) continue;
        this.teamLinks.set(runtimeAgentId, { teamAgentId, rootSessionId: root });
      }
    } catch {
      // Daemon write lock / missing db: keep old links, retry next window.
    } finally {
      try {
        db?.close();
      } catch {
        // Ignore close errors on a read-only handle.
      }
    }
    return true;
  }
}
