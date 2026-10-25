import { randomUUID } from "node:crypto";
import {
  classifyAgentFailure,
  healthyAgentMember,
  normalizeAgentRoleWorkspace,
  parseAgentRuntimeOverride,
  type AgentMemberHealth,
  type AgentMemberStatus,
  type AgentRosterRole,
  type ThreadAgentMember,
  type ThreadAgentRoster
} from "@codex-ui/shared";
import { LocalDatabase } from "./localDatabase.js";
import type { RuntimeDatabase } from "./runtime/database.js";

type ThreadAgentRosterRow = {
  parent_thread_id: string;
  roles_json: string;
  updated_at: number;
};

type ThreadAgentMemberRow = {
  member_id: string;
  parent_thread_id: string;
  role_id: string;
  instance_index: number;
  name: string;
  responsibility: string;
  provider_id: string | null;
  group_id: string | null;
  model: string;
  reasoning_effort: string;
  runtime: string;
  workspace_json: string;
  thread_id: string | null;
  status: string;
  health_json: string | null;
  active_fallback_id: string | null;
  created_at: number;
  updated_at: number;
};

export type ThreadAgentMemberPatch = Partial<Pick<
  ThreadAgentMember,
  | "name"
  | "responsibility"
  | "providerId"
  | "groupId"
  | "model"
  | "reasoningEffort"
  | "runtime"
  | "workspace"
  | "threadId"
  | "status"
  | "health"
  | "activeFallbackId"
>>;

const MEMBER_STATUSES = new Set<AgentMemberStatus>([
  "configured",
  "starting",
  "active",
  "idle",
  "paused",
  "draining",
  "exited",
  "failed",
  "offline"
]);

export class ThreadAgentRosterStore {
  private readonly db: RuntimeDatabase;

  public constructor(database: Pick<LocalDatabase, "connection"> = new LocalDatabase()) {
    this.db = database.connection;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_agent_rosters (
        owner_id TEXT NOT NULL,
        parent_thread_id TEXT NOT NULL,
        roles_json TEXT NOT NULL DEFAULT '[]',
        revision INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, parent_thread_id)
      );

      CREATE TABLE IF NOT EXISTS thread_agent_members (
        owner_id TEXT NOT NULL,
        parent_thread_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        instance_index INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL,
        responsibility TEXT NOT NULL DEFAULT '',
        provider_id TEXT,
        group_id TEXT,
        model TEXT NOT NULL DEFAULT '',
        reasoning_effort TEXT NOT NULL DEFAULT '',
        runtime TEXT NOT NULL DEFAULT 'native',
        workspace_json TEXT NOT NULL DEFAULT '{}',
        thread_id TEXT,
        status TEXT NOT NULL DEFAULT 'configured',
        health_json TEXT,
        active_fallback_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, parent_thread_id, member_id)
      );

      CREATE INDEX IF NOT EXISTS idx_thread_agent_members_parent_status
        ON thread_agent_members(owner_id, parent_thread_id, status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_thread_agent_members_child_thread
        ON thread_agent_members(thread_id, updated_at DESC);
    `);
    try {
      this.db.exec("ALTER TABLE thread_agent_members ADD COLUMN active_fallback_id TEXT");
    } catch {
      // Column already exists.
    }
  }

  public get(ownerId: string, parentThreadId: string): ThreadAgentRoster | null {
    const roster = this.db.prepare(`
      SELECT parent_thread_id, roles_json, updated_at
      FROM thread_agent_rosters
      WHERE owner_id = ? AND parent_thread_id = ?
      LIMIT 1
    `).get(ownerId, parentThreadId) as ThreadAgentRosterRow | undefined;
    if (!roster) return null;
    return {
      threadId: roster.parent_thread_id,
      roles: parseRoles(roster.roles_json),
      members: this.listMembers(ownerId, parentThreadId),
      updatedAt: roster.updated_at
    };
  }

  public putRoles(ownerId: string, parentThreadId: string, input: unknown): ThreadAgentRoster {
    const roles = parseAgentRuntimeOverride({ mode: "enabled", roles: input }).roles;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO thread_agent_rosters (
        owner_id, parent_thread_id, roles_json, revision, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(owner_id, parent_thread_id) DO UPDATE SET
        roles_json = excluded.roles_json,
        revision = thread_agent_rosters.revision + 1,
        updated_at = excluded.updated_at
    `).run(ownerId, parentThreadId, JSON.stringify(roles), now, now);

    const existing = this.listMembers(ownerId, parentThreadId);
    const desiredKeys = new Set<string>();
    for (const role of roles.filter((entry) => entry.enabled)) {
      const instanceCount = role.instanceCount ?? 1;
      for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
        const key = memberSlotKey(role.id, instanceIndex);
        desiredKeys.add(key);
        const current = existing.find((member) =>
          member.roleId === role.id
          && member.instanceIndex === instanceIndex
          && member.status !== "exited"
        );
        if (current) {
          this.patchMember(ownerId, parentThreadId, current.id, memberConfiguration(role));
        } else {
          this.insertMember(ownerId, parentThreadId, role, instanceIndex, now);
        }
      }
    }

    for (const member of existing) {
      if (member.status === "exited") continue;
      if (!desiredKeys.has(memberSlotKey(member.roleId, member.instanceIndex))) {
        this.patchMember(ownerId, parentThreadId, member.id, { status: "exited" });
      }
    }
    return this.get(ownerId, parentThreadId)!;
  }

  public getMember(ownerId: string, parentThreadId: string, memberId: string): ThreadAgentMember | null {
    const row = this.db.prepare(`${memberSelectSql()}
      WHERE owner_id = ? AND parent_thread_id = ? AND member_id = ?
      LIMIT 1
    `).get(ownerId, parentThreadId, memberId) as ThreadAgentMemberRow | undefined;
    return row ? mapMemberRow(row) : null;
  }

  public findByChildThread(threadId: string): ThreadAgentMember | null {
    const row = this.db.prepare(`${memberSelectSql()}
      WHERE thread_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(threadId) as ThreadAgentMemberRow | undefined;
    return row ? mapMemberRow(row) : null;
  }

  public getAnyByChildThread(threadId: string): { ownerId: string; member: ThreadAgentMember } | null {
    return threadId ? this.findMemberLocationByThread(threadId) : null;
  }

  public patchMember(ownerId: string, parentThreadId: string, memberId: string, patch: ThreadAgentMemberPatch): ThreadAgentMember {
    const current = this.getMember(ownerId, parentThreadId, memberId);
    if (!current) throw new Error("Agent member not found");
    const next: ThreadAgentMember = {
      ...current,
      ...patch,
      providerId: patch.providerId === undefined ? current.providerId : cleanNullable(patch.providerId, 128),
      groupId: patch.groupId === undefined ? current.groupId : cleanNullable(patch.groupId, 128),
      name: patch.name === undefined ? current.name : cleanText(patch.name, 80),
      responsibility: patch.responsibility === undefined ? current.responsibility : cleanText(patch.responsibility, 800),
      model: patch.model === undefined ? current.model : cleanText(patch.model, 512),
      reasoningEffort: patch.reasoningEffort === undefined ? current.reasoningEffort : cleanText(patch.reasoningEffort, 64),
      runtime: patch.runtime === "independent" ? "independent" : patch.runtime === undefined ? current.runtime : "native",
      workspace: patch.workspace === undefined ? current.workspace : normalizeAgentRoleWorkspace(patch.workspace),
      threadId: patch.threadId === undefined ? current.threadId : cleanNullable(patch.threadId, 512),
      status: patch.status === undefined ? current.status : normalizeStatus(patch.status),
      health: patch.health === undefined ? current.health : normalizeHealth(patch.health),
      activeFallbackId: patch.activeFallbackId === undefined ? current.activeFallbackId : cleanNullable(patch.activeFallbackId, 64),
      updatedAt: Date.now()
    };
    this.db.prepare(`
      UPDATE thread_agent_members SET
        name = ?, responsibility = ?, provider_id = ?, group_id = ?, model = ?,
        reasoning_effort = ?, runtime = ?, workspace_json = ?, thread_id = ?,
        status = ?, health_json = ?, active_fallback_id = ?, updated_at = ?
      WHERE owner_id = ? AND parent_thread_id = ? AND member_id = ?
    `).run(
      next.name,
      next.responsibility,
      next.providerId,
      next.groupId,
      next.model,
      next.reasoningEffort,
      next.runtime,
      JSON.stringify(next.workspace),
      next.threadId,
      next.status,
      next.health ? JSON.stringify(next.health) : null,
      next.activeFallbackId,
      next.updatedAt,
      ownerId,
      parentThreadId,
      memberId
    );
    this.touchRoster(ownerId, parentThreadId, next.updatedAt);
    return next;
  }

  public replaceMember(ownerId: string, parentThreadId: string, memberId: string): ThreadAgentMember {
    const current = this.getMember(ownerId, parentThreadId, memberId);
    if (!current) throw new Error("Agent member not found");
    this.patchMember(ownerId, parentThreadId, memberId, { status: "exited" });
    const now = Date.now();
    const replacement: ThreadAgentMember = {
      ...current,
      id: randomUUID(),
      threadId: null,
      status: "configured",
      health: null,
      activeFallbackId: null,
      createdAt: now,
      updatedAt: now
    };
    this.insertMemberRecord(ownerId, replacement);
    this.touchRoster(ownerId, parentThreadId, now);
    return replacement;
  }

  public recordFailureByThread(threadId: string, value: unknown): ThreadAgentMember | null {
    const located = this.findMemberLocationByThread(threadId);
    if (!located) return null;
    const health = classifyAgentFailure(value, located.member.health);
    return this.patchMember(located.ownerId, located.member.parentThreadId, located.member.id, {
      health,
      status: health.availability === "offline" ? "offline" : "failed"
    });
  }

  public markHealthyByThread(threadId: string): ThreadAgentMember | null {
    const located = this.findMemberLocationByThread(threadId);
    if (!located) return null;
    if (located.member.status === "paused" || located.member.status === "draining" || located.member.status === "exited") {
      return located.member;
    }
    return this.patchMember(located.ownerId, located.member.parentThreadId, located.member.id, {
      health: healthyAgentMember(),
      status: "active"
    });
  }

  private listMembers(ownerId: string, parentThreadId: string): ThreadAgentMember[] {
    const rows = this.db.prepare(`${memberSelectSql()}
      WHERE owner_id = ? AND parent_thread_id = ?
      ORDER BY created_at ASC, instance_index ASC
    `).all(ownerId, parentThreadId) as ThreadAgentMemberRow[];
    return rows.map(mapMemberRow);
  }

  private insertMember(ownerId: string, parentThreadId: string, role: AgentRosterRole, instanceIndex: number, now: number): ThreadAgentMember {
    const member: ThreadAgentMember = {
      id: randomUUID(),
      parentThreadId,
      roleId: role.id,
      instanceIndex,
      name: role.name,
      responsibility: role.responsibility,
      providerId: role.providerId ?? null,
      groupId: role.groupId ?? null,
      model: role.model,
      reasoningEffort: role.reasoningEffort,
      runtime: role.runtime ?? "native",
      workspace: normalizeAgentRoleWorkspace(role.workspace),
      threadId: null,
      status: "configured",
      health: null,
      activeFallbackId: null,
      createdAt: now,
      updatedAt: now
    };
    this.insertMemberRecord(ownerId, member);
    return member;
  }

  private insertMemberRecord(ownerId: string, member: ThreadAgentMember): void {
    this.db.prepare(`
      INSERT INTO thread_agent_members (
        owner_id, parent_thread_id, member_id, role_id, instance_index, name,
        responsibility, provider_id, group_id, model, reasoning_effort, runtime,
        workspace_json, thread_id, status, health_json, active_fallback_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ownerId,
      member.parentThreadId,
      member.id,
      member.roleId,
      member.instanceIndex,
      member.name,
      member.responsibility,
      member.providerId,
      member.groupId,
      member.model,
      member.reasoningEffort,
      member.runtime,
      JSON.stringify(member.workspace),
      member.threadId,
      member.status,
      member.health ? JSON.stringify(member.health) : null,
      member.activeFallbackId,
      member.createdAt,
      member.updatedAt
    );
  }

  private findMemberLocationByThread(threadId: string): { ownerId: string; member: ThreadAgentMember } | null {
    const row = this.db.prepare(`
      SELECT owner_id, ${memberSelectColumns()}
      FROM thread_agent_members
      WHERE thread_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(threadId) as (ThreadAgentMemberRow & { owner_id: string }) | undefined;
    return row ? { ownerId: row.owner_id, member: mapMemberRow(row) } : null;
  }

  private touchRoster(ownerId: string, parentThreadId: string, now: number): void {
    this.db.prepare(`
      UPDATE thread_agent_rosters SET updated_at = ?
      WHERE owner_id = ? AND parent_thread_id = ?
    `).run(now, ownerId, parentThreadId);
  }
}

function memberConfiguration(role: AgentRosterRole): ThreadAgentMemberPatch {
  return {
    name: role.name,
    responsibility: role.responsibility,
    providerId: role.providerId ?? null,
    groupId: role.groupId ?? null,
    model: role.model,
    reasoningEffort: role.reasoningEffort,
    runtime: role.runtime ?? "native",
    workspace: normalizeAgentRoleWorkspace(role.workspace)
  };
}

function memberSlotKey(roleId: string, instanceIndex: number): string {
  return `${roleId}\u0000${instanceIndex}`;
}

function memberSelectSql(): string {
  return `SELECT ${memberSelectColumns()} FROM thread_agent_members`;
}

function memberSelectColumns(): string {
  return `member_id, parent_thread_id, role_id, instance_index, name, responsibility,
    provider_id, group_id, model, reasoning_effort, runtime, workspace_json,
    thread_id, status, health_json, active_fallback_id, created_at, updated_at`;
}

function mapMemberRow(row: ThreadAgentMemberRow): ThreadAgentMember {
  return {
    id: row.member_id,
    parentThreadId: row.parent_thread_id,
    roleId: row.role_id,
    instanceIndex: row.instance_index,
    name: row.name,
    responsibility: row.responsibility,
    providerId: row.provider_id,
    groupId: row.group_id,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    runtime: row.runtime === "independent" ? "independent" : "native",
    workspace: parseWorkspace(row.workspace_json),
    threadId: row.thread_id,
    status: normalizeStatus(row.status),
    health: parseHealth(row.health_json),
    activeFallbackId: row.active_fallback_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseRoles(value: string): AgentRosterRole[] {
  try {
    return parseAgentRuntimeOverride({ mode: "enabled", roles: JSON.parse(value) }).roles;
  } catch {
    return [];
  }
}

function parseWorkspace(value: string): ThreadAgentMember["workspace"] {
  try {
    return normalizeAgentRoleWorkspace(JSON.parse(value));
  } catch {
    return normalizeAgentRoleWorkspace(undefined);
  }
}

function parseHealth(value: string | null): AgentMemberHealth | null {
  if (!value) return null;
  try {
    return normalizeHealth(JSON.parse(value));
  } catch {
    return null;
  }
}

function normalizeHealth(value: unknown): AgentMemberHealth | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const health = value as Partial<AgentMemberHealth>;
  const availability = health.availability === "offline" || health.availability === "degraded" ? health.availability : "online";
  const kinds = new Set<AgentMemberHealth["kind"]>(["rateLimit", "quota", "auth", "providerDisabled", "providerUnavailable", "transport", "unknown"]);
  return {
    availability,
    kind: kinds.has(health.kind ?? "unknown") ? health.kind ?? "unknown" : "unknown",
    code: typeof health.code === "number" || typeof health.code === "string" ? health.code : null,
    message: cleanText(health.message, 2_000),
    consecutiveFailures: safeInteger(health.consecutiveFailures, 0),
    firstFailureAt: safeInteger(health.firstFailureAt, Date.now()),
    lastFailureAt: safeInteger(health.lastFailureAt, Date.now()),
    retryAt: health.retryAt === null ? null : safeInteger(health.retryAt, null),
    retryable: health.retryable !== false
  };
}

function normalizeStatus(value: unknown): AgentMemberStatus {
  return typeof value === "string" && MEMBER_STATUSES.has(value as AgentMemberStatus)
    ? value as AgentMemberStatus
    : "configured";
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanNullable(value: unknown, maxLength: number): string | null {
  return cleanText(value, maxLength) || null;
}

function safeInteger<T extends number | null>(value: unknown, fallback: T): number | T {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
