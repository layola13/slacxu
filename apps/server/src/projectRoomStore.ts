import { randomBytes } from "node:crypto";
import type {
  AgentProject,
  AgentProjectMember,
  AgentProjectMessage,
  AgentProjectDiscussionPhase,
  AgentProjectWorkspace,
  AgentProjectVote
} from "@codex-ui/shared";
import { LocalDatabase } from "./localDatabase.js";
import type { RuntimeDatabase } from "./runtime/database.js";

export type CreateAgentProjectInput = Pick<
  AgentProject,
  "name" | "description" | "workspaces" | "agents" | "coordinatorAgentId"
>;

/** Fields which may be edited by a project owner. Runtime fields are server-owned. */
export type UpdateAgentProjectInput = Partial<
  Pick<AgentProject, "name" | "description" | "workspaces" | "agents" | "coordinatorAgentId">
> & { status?: AgentProject["status"] };

export type AppendAgentProjectMessageInput = Omit<
  AgentProjectMessage,
  "id" | "createdAt" | "sequence"
> & { createdAt?: number };

export type UpdateAgentProjectMessageInput = Pick<
  AgentProjectMessage,
  "projectId" | "agentId" | "threadId" | "turnId" | "itemId" | "kind" | "phase" | "providerId" | "groupId" | "model" | "text"
> & { createdAt?: number };

export type ProjectThreadBinding = {
  ownerId: string;
  projectId: string;
  agentId: string;
  threadId: string;
  createdAt: number;
  updatedAt: number;
};

type MessageRow = {
  id: string;
  project_id: string;
  agent_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  item_id: string | null;
  kind: string;
  phase: string | null;
  provider_id: string | null;
  group_id: string | null;
  model: string | null;
  text: string;
  created_at: number;
  sequence: number;
};

type VoteRow = {
  id: string;
  project_id: string;
  proposal_id: string;
  voter_id: string;
  voter_type: string;
  choice: string;
  comment: string;
  created_at: number;
};

type ThreadRow = {
  owner_id: string;
  project_id: string;
  agent_id: string;
  thread_id: string;
  created_at: number;
  updated_at: number;
};

const MESSAGE_COLUMNS = "id, project_id, agent_id, thread_id, turn_id, item_id, kind, phase, provider_id, group_id, model, text, created_at, sequence";

const PROJECT_STATUSES = new Set<AgentProject["status"]>([
  "draft",
  "active",
  "paused",
  "archived"
]);

const MEMBER_STATUSES = new Set<AgentProjectMember["status"]>([
  "draft",
  "starting",
  "active",
  "paused",
  "completed",
  "failed"
]);

const MEMBER_ROLES = [
  "boss",
  "product",
  "engineeringLead",
  "engineer",
  "art",
  "qa",
  "acceptance",
  "customerAcceptance",
  "custom"
] as const satisfies readonly AgentProjectMember["role"][];

export class ProjectRoomStore {
  private readonly db: RuntimeDatabase;

  public constructor(database: Pick<LocalDatabase, "connection"> = new LocalDatabase()) {
    this.db = database.connection;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_projects (
        owner_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, project_id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_projects_owner_updated
        ON agent_projects(owner_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS agent_project_messages (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        agent_id TEXT,
        thread_id TEXT,
        turn_id TEXT,
        item_id TEXT,
        kind TEXT NOT NULL,
        phase TEXT,
        provider_id TEXT,
        group_id TEXT,
        model TEXT,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        sequence INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_project_messages_project_sequence
        ON agent_project_messages(owner_id, project_id, sequence, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_project_messages_agent_item
        ON agent_project_messages(owner_id, project_id, thread_id, item_id)
        WHERE thread_id IS NOT NULL AND item_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS agent_project_sequences (
        owner_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        next_sequence INTEGER NOT NULL,
        PRIMARY KEY (owner_id, project_id)
      );

      CREATE TABLE IF NOT EXISTS agent_project_threads (
        owner_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, project_id, agent_id),
        UNIQUE(owner_id, thread_id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_project_threads_thread
        ON agent_project_threads(thread_id);

      CREATE TABLE IF NOT EXISTS agent_project_votes (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        voter_id TEXT NOT NULL,
        voter_type TEXT NOT NULL,
        choice TEXT NOT NULL,
        comment TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(owner_id, project_id, proposal_id, voter_id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_project_votes_proposal
        ON agent_project_votes(owner_id, project_id, proposal_id, created_at);
    `);

    // Project messages predate cross-route discussions. Keep existing rooms
    // readable while adding the audit fields used by the unified waterfall.
    for (const [column, ddl] of [
      ["phase", "TEXT"],
      ["provider_id", "TEXT"],
      ["group_id", "TEXT"],
      ["model", "TEXT"]
    ] as const) {
      try { this.db.prepare(`ALTER TABLE agent_project_messages ADD COLUMN ${column} ${ddl}`).run(); } catch {}
    }

    // Backfill the sequence table for projects created by the first demo build.
    this.db.exec(`
      INSERT INTO agent_project_sequences(owner_id, project_id, next_sequence)
      SELECT owner_id, project_id, MAX(sequence)
      FROM agent_project_messages
      GROUP BY owner_id, project_id
      ON CONFLICT(owner_id, project_id) DO NOTHING;
    `);
  }

  public list(ownerId: string): AgentProject[] {
    const rows = this.db
      .prepare(`SELECT payload FROM agent_projects WHERE owner_id = ? ORDER BY updated_at DESC`)
      .all(ownerId) as Array<{ payload: string }>;
    return rows.flatMap((row) => parseProject(row.payload));
  }

  public get(ownerId: string, projectId: string): AgentProject | null {
    const row = this.db
      .prepare(`SELECT payload FROM agent_projects WHERE owner_id = ? AND project_id = ? LIMIT 1`)
      .get(ownerId, projectId) as { payload: string } | undefined;
    return row ? parseProject(row.payload)[0] ?? null : null;
  }

  public create(ownerId: string, input: CreateAgentProjectInput): AgentProject {
    const now = Date.now();
    const workspaces = normalizeWorkspaces(input.workspaces);
    const agents = normalizeAgents(input.agents, new Set(workspaces.map((entry) => entry.id)));
    const coordinatorAgentId = validCoordinator(input.coordinatorAgentId, agents);
    const project: AgentProject = {
      id: makeId("project"),
      name: clean(input.name, 160) || "Untitled Project",
      description: clean(input.description, 4000),
      workspaces,
      agents,
      coordinatorAgentId,
      status: "draft",
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO agent_projects(owner_id, project_id, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(ownerId, project.id, JSON.stringify(project), now, now);
    return project;
  }

  public update(ownerId: string, projectId: string, patch: UpdateAgentProjectInput): AgentProject | null {
    const current = this.get(ownerId, projectId);
    if (!current) return null;

    const workspaces = patch.workspaces === undefined
      ? current.workspaces
      : normalizeWorkspaces(patch.workspaces);
    const agents = patch.agents === undefined
      ? current.agents
      : normalizeAgents(
        patch.agents,
        new Set(workspaces.map((entry) => entry.id)),
        current.agents
      );
    const nextStatus = patch.status !== undefined && PROJECT_STATUSES.has(patch.status)
      ? patch.status
      : current.status;
    const next: AgentProject = {
      ...current,
      ...(patch.name !== undefined ? { name: clean(patch.name, 160) || current.name } : {}),
      ...(patch.description !== undefined ? { description: clean(patch.description, 4000) } : {}),
      workspaces,
      agents,
      coordinatorAgentId: patch.coordinatorAgentId === undefined
        ? validCoordinator(current.coordinatorAgentId, agents)
        : validCoordinator(patch.coordinatorAgentId, agents),
      status: nextStatus,
      updatedAt: Date.now()
    };
    this.saveProject(ownerId, next);
    const retainedAgentIds = new Set(agents.map((agent) => agent.id));
    for (const binding of this.listThreadBindings(ownerId, projectId)) {
      if (!retainedAgentIds.has(binding.agentId)) {
        this.db
          .prepare(`DELETE FROM agent_project_threads WHERE owner_id = ? AND project_id = ? AND agent_id = ?`)
          .run(ownerId, projectId, binding.agentId);
      }
    }
    return next;
  }

  /** Apply server-owned thread identities and lifecycle states. */
  public setRuntime(
    ownerId: string,
    projectId: string,
    runtimeAgents: AgentProjectMember[],
    status?: AgentProject["status"]
  ): AgentProject | null {
    const current = this.get(ownerId, projectId);
    if (!current) return null;
    const runtimeById = new Map(runtimeAgents.map((agent) => [agent.id, agent]));
    const agents = current.agents.map((agent) => {
      const runtime = runtimeById.get(agent.id);
      if (!runtime) return agent;
      return {
        ...agent,
        threadId: cleanNullable(runtime.threadId, 512),
        status: MEMBER_STATUSES.has(runtime.status) ? runtime.status : agent.status
      };
    });
    const next: AgentProject = {
      ...current,
      agents,
      status: status && PROJECT_STATUSES.has(status) ? status : current.status,
      updatedAt: Date.now()
    };
    this.saveProject(ownerId, next);
    return next;
  }

  public delete(ownerId: string, projectId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM agent_projects WHERE owner_id = ? AND project_id = ?`)
      .run(ownerId, projectId) as { changes?: number };
    this.db.prepare(`DELETE FROM agent_project_messages WHERE owner_id = ? AND project_id = ?`).run(ownerId, projectId);
    this.db.prepare(`DELETE FROM agent_project_votes WHERE owner_id = ? AND project_id = ?`).run(ownerId, projectId);
    this.db.prepare(`DELETE FROM agent_project_threads WHERE owner_id = ? AND project_id = ?`).run(ownerId, projectId);
    this.db.prepare(`DELETE FROM agent_project_sequences WHERE owner_id = ? AND project_id = ?`).run(ownerId, projectId);
    return Number(result.changes ?? 0) > 0;
  }

  public appendMessage(ownerId: string, input: AppendAgentProjectMessageInput): AgentProjectMessage {
    const project = this.get(ownerId, input.projectId);
    if (!project) throw new Error("Project not found");
    const threadId = cleanNullable(input.threadId, 512);
    const itemId = cleanNullable(input.itemId, 512);
    if (threadId && itemId) {
      const existing = this.db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS}
           FROM agent_project_messages
           WHERE owner_id = ? AND project_id = ? AND thread_id = ? AND item_id = ? LIMIT 1`
        )
        .get(ownerId, input.projectId, threadId, itemId) as MessageRow | undefined;
      if (existing) return mapMessage(existing);
    }

    const createdAt = input.createdAt ?? Date.now();
    const sequence = this.nextSequence(ownerId, input.projectId);
    const message: AgentProjectMessage = {
      id: makeId("message"),
      projectId: input.projectId,
      agentId: cleanNullable(input.agentId, 256),
      threadId,
      turnId: cleanNullable(input.turnId, 512),
      itemId,
      kind: messageKind(input.kind),
      phase: discussionPhase(input.phase) ?? undefined,
      providerId: cleanNullable(input.providerId, 512),
      groupId: cleanNullable(input.groupId, 512),
      model: cleanNullable(input.model, 512),
      text: clean(input.text, 100_000),
      createdAt,
      sequence
    };
    try {
      this.db
        .prepare(
          `INSERT INTO agent_project_messages
           (id, owner_id, project_id, agent_id, thread_id, turn_id, item_id, kind, phase, provider_id, group_id, model, text, created_at, sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          message.id,
          ownerId,
          message.projectId,
          message.agentId,
          message.threadId,
          message.turnId,
          message.itemId,
          message.kind,
          message.phase ?? null,
          message.providerId ?? null,
          message.groupId ?? null,
          message.model ?? null,
          message.text,
          message.createdAt,
          message.sequence
        );
    } catch (error) {
      // A duplicate notification can race between the lookup and insert.
      if (threadId && itemId && isUniqueConstraint(error)) {
        const existing = this.db
          .prepare(
            `SELECT ${MESSAGE_COLUMNS}
             FROM agent_project_messages
             WHERE owner_id = ? AND project_id = ? AND thread_id = ? AND item_id = ? LIMIT 1`
          )
          .get(ownerId, input.projectId, threadId, itemId) as MessageRow | undefined;
        if (existing) return mapMessage(existing);
      }
      throw error;
    }
    return message;
  }

  /**
   * Insert or replace a server-owned Agent message. Codex can emit a final
   * `item/completed` after one or more streaming deltas; replacing the same
   * thread/item projection keeps the room timeline idempotent.
   */
  public upsertAgentMessage(ownerId: string, input: UpdateAgentProjectMessageInput): AgentProjectMessage {
    const threadId = cleanNullable(input.threadId, 512);
    const itemId = cleanNullable(input.itemId, 512);
    if (!threadId || !itemId) {
      return this.appendMessage(ownerId, { ...input, threadId, itemId });
    }
    const existing = this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS}
         FROM agent_project_messages
         WHERE owner_id = ? AND project_id = ? AND thread_id = ? AND item_id = ? LIMIT 1`
      )
      .get(ownerId, input.projectId, threadId, itemId) as MessageRow | undefined;
    const text = clean(input.text, 100_000);
    if (existing) {
      const createdAt = input.createdAt ?? existing.created_at;
      this.db
        .prepare(
          `UPDATE agent_project_messages
           SET agent_id = ?, turn_id = ?, kind = ?, phase = ?, provider_id = ?, group_id = ?, model = ?, text = ?, created_at = ?
           WHERE id = ?`
        )
        .run(
          cleanNullable(input.agentId, 256),
          cleanNullable(input.turnId, 512),
          messageKind(input.kind),
          discussionPhase(input.phase) ?? existing.phase,
          input.providerId === undefined ? existing.provider_id : cleanNullable(input.providerId, 512),
          input.groupId === undefined ? existing.group_id : cleanNullable(input.groupId, 512),
          input.model === undefined ? existing.model : cleanNullable(input.model, 512),
          text,
          createdAt,
          existing.id
        );
      const updated = this.db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS}
           FROM agent_project_messages WHERE id = ? LIMIT 1`
        )
        .get(existing.id) as MessageRow;
      return mapMessage(updated);
    }
    return this.appendMessage(ownerId, {
      projectId: input.projectId,
      agentId: input.agentId,
      threadId,
      turnId: input.turnId,
      itemId,
      kind: input.kind,
      phase: input.phase,
      providerId: input.providerId,
      groupId: input.groupId,
      model: input.model,
      text,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt })
    });
  }

  /** Append a streaming delta to the canonical Agent message projection. */
  public appendAgentMessageDelta(
    ownerId: string,
    input: Omit<UpdateAgentProjectMessageInput, "text"> & { delta: string }
  ): AgentProjectMessage {
    const threadId = cleanNullable(input.threadId, 512);
    const itemId = cleanNullable(input.itemId, 512);
    if (!threadId || !itemId) {
      return this.appendMessage(ownerId, { ...input, text: input.delta, threadId, itemId });
    }
    const existing = this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS}
         FROM agent_project_messages
         WHERE owner_id = ? AND project_id = ? AND thread_id = ? AND item_id = ? LIMIT 1`
      )
      .get(ownerId, input.projectId, threadId, itemId) as MessageRow | undefined;
    return this.upsertAgentMessage(ownerId, {
      projectId: input.projectId,
      agentId: input.agentId,
      threadId,
      turnId: input.turnId,
      itemId,
      kind: input.kind,
      phase: input.phase ?? discussionPhase(existing?.phase) ?? undefined,
      providerId: input.providerId === undefined ? existing?.provider_id : input.providerId,
      groupId: input.groupId === undefined ? existing?.group_id : input.groupId,
      model: input.model === undefined ? existing?.model : input.model,
      // Streaming chunks are significant byte-for-byte: a leading space is
      // often the separator between two tokens. Limit size without trimming.
      text: `${existing?.text ?? ""}${clip(input.delta, 100_000)}`
    });
  }

  public listMessages(ownerId: string, projectId: string, limit = 500, afterSequence = 0): AgentProjectMessage[] {
    const rows = this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS}
         FROM agent_project_messages
         WHERE owner_id = ? AND project_id = ? AND sequence > ?
         ORDER BY sequence ASC LIMIT ?`
      )
      .all(
        ownerId,
        projectId,
        Math.max(0, Number.isFinite(afterSequence) ? Math.floor(afterSequence) : 0),
        Math.min(2000, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 500)))
      ) as MessageRow[];
    return rows.map(mapMessage);
  }

  public bindThread(ownerId: string, projectId: string, agentId: string, threadId: string): ProjectThreadBinding {
    const project = this.get(ownerId, projectId);
    if (!project) throw new Error("Project not found");
    const agent = project.agents.find((entry) => entry.id === agentId);
    if (!agent) throw new Error("Project agent not found");
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO agent_project_threads(owner_id, project_id, agent_id, thread_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, project_id, agent_id) DO UPDATE SET thread_id = excluded.thread_id, updated_at = excluded.updated_at`
      )
      .run(ownerId, projectId, agentId, clean(threadId, 512), now, now);
    const normalizedThreadId = clean(threadId, 512);
    const agents = project.agents.map((entry) => entry.id === agentId
      ? { ...entry, threadId: normalizedThreadId, status: "active" as const }
      : entry);
    this.setRuntime(ownerId, projectId, agents);
    return { ownerId, projectId, agentId, threadId: normalizedThreadId, createdAt: now, updatedAt: now };
  }

  public unbindThread(ownerId: string, projectId: string, agentId: string): void {
    this.db.prepare(`DELETE FROM agent_project_threads WHERE owner_id = ? AND project_id = ? AND agent_id = ?`).run(ownerId, projectId, agentId);
  }

  public findThread(threadId: string): ProjectThreadBinding | null {
    const row = this.db
      .prepare(
        `SELECT owner_id, project_id, agent_id, thread_id, created_at, updated_at
         FROM agent_project_threads WHERE thread_id = ? LIMIT 1`
      )
      .get(threadId) as ThreadRow | undefined;
    return row ? mapThread(row) : null;
  }

  public listThreadBindings(ownerId: string, projectId: string): ProjectThreadBinding[] {
    const rows = this.db
      .prepare(
        `SELECT owner_id, project_id, agent_id, thread_id, created_at, updated_at
         FROM agent_project_threads WHERE owner_id = ? AND project_id = ? ORDER BY created_at ASC`
      )
      .all(ownerId, projectId) as ThreadRow[];
    return rows.map(mapThread);
  }

  public setMemberStatus(ownerId: string, projectId: string, agentId: string, status: AgentProjectMember["status"]): AgentProject | null {
    if (!MEMBER_STATUSES.has(status)) return this.get(ownerId, projectId);
    const project = this.get(ownerId, projectId);
    if (!project) return null;
    const agents = project.agents.map((entry) => entry.id === agentId ? { ...entry, status } : entry);
    return this.setRuntime(ownerId, projectId, agents);
  }

  public listVotes(ownerId: string, projectId: string, proposalId: string): AgentProjectVote[] {
    const rows = this.db
      .prepare(
        `SELECT id, project_id, proposal_id, voter_id, voter_type, choice, comment, created_at
         FROM agent_project_votes
         WHERE owner_id = ? AND project_id = ? AND proposal_id = ? ORDER BY created_at ASC`
      )
      .all(ownerId, projectId, proposalId) as VoteRow[];
    return rows.map(mapVote);
  }

  public castVote(ownerId: string, input: Omit<AgentProjectVote, "id" | "createdAt">): AgentProjectVote {
    if (!this.get(ownerId, input.projectId)) throw new Error("Project not found");
    const choice: AgentProjectVote["choice"] = input.choice === "reject" || input.choice === "abstain" ? input.choice : "approve";
    const voterType: AgentProjectVote["voterType"] = input.voterType === "agent" ? "agent" : "human";
    const now = Date.now();
    const vote: AgentProjectVote = {
      projectId: input.projectId,
      proposalId: clean(input.proposalId, 256),
      voterId: clean(input.voterId, 256),
      voterType,
      choice,
      comment: clean(input.comment, 4000),
      id: makeId("vote"),
      createdAt: now
    };
    if (!vote.proposalId || !vote.voterId) throw new Error("proposalId and voterId are required");
    this.db
      .prepare(
        `INSERT INTO agent_project_votes
         (id, owner_id, project_id, proposal_id, voter_id, voter_type, choice, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, project_id, proposal_id, voter_id)
         DO UPDATE SET voter_type = excluded.voter_type, choice = excluded.choice,
           comment = excluded.comment, created_at = excluded.created_at`
      )
      .run(vote.id, ownerId, vote.projectId, vote.proposalId, vote.voterId, vote.voterType, vote.choice, vote.comment, vote.createdAt);
    return this.listVotes(ownerId, vote.projectId, vote.proposalId).find((entry) => entry.voterId === vote.voterId)!;
  }

  public voteSummary(ownerId: string, projectId: string, proposalId: string): {
    approved: number;
    rejected: number;
    abstained: number;
    humanVeto: boolean;
    decision: "approved" | "rejected" | "pending";
  } {
    const votes = this.listVotes(ownerId, projectId, proposalId);
    const approved = votes.filter((vote) => vote.choice === "approve").length;
    const rejected = votes.filter((vote) => vote.choice === "reject").length;
    const abstained = votes.filter((vote) => vote.choice === "abstain").length;
    const humanVeto = votes.some((vote) => vote.voterType === "human" && vote.choice === "reject");
    return {
      approved,
      rejected,
      abstained,
      humanVeto,
      decision: humanVeto || rejected > approved
        ? "rejected"
        : approved > rejected && approved > 0 ? "approved" : "pending"
    };
  }

  private nextSequence(ownerId: string, projectId: string): number {
    const row = this.db
      .prepare(
        `INSERT INTO agent_project_sequences(owner_id, project_id, next_sequence)
         VALUES (?, ?, 1)
         ON CONFLICT(owner_id, project_id)
         DO UPDATE SET next_sequence = agent_project_sequences.next_sequence + 1
         RETURNING next_sequence`
      )
      .get(ownerId, projectId) as { next_sequence: number } | undefined;
    return Number(row?.next_sequence ?? 1);
  }

  private saveProject(ownerId: string, project: AgentProject): void {
    this.db
      .prepare(
        `UPDATE agent_projects SET payload = ?, updated_at = ?
         WHERE owner_id = ? AND project_id = ?`
      )
      .run(JSON.stringify(project), project.updatedAt, ownerId, project.id);
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function cleanNullable(value: unknown, max: number): string | null {
  const result = clean(value, max);
  return result || null;
}

function parseProject(payload: string): AgentProject[] {
  try {
    const value = JSON.parse(payload) as AgentProject;
    return value && typeof value === "object" ? [value] : [];
  } catch {
    return [];
  }
}

function normalizeWorkspaces(value: unknown): AgentProjectWorkspace[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.slice(0, 32).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<AgentProjectWorkspace>;
    const path = clean(item.path, 2000);
    if (!path) return [];
    let id = clean(item.id, 100) || `workspace-${index + 1}`;
    while (ids.has(id)) id = `${id}-${index + 1}`;
    ids.add(id);
    const sshCommand = clean(item.sshCommand, 1000);
    return [{
      id,
      label: clean(item.label, 160) || path,
      path,
      mode: item.mode === "ssh" ? "ssh" : "local",
      ...(sshCommand ? { sshCommand } : {})
    }];
  });
}

function normalizeAgents(
  value: unknown,
  workspaceIds: Set<string>,
  previous: AgentProjectMember[] = []
): AgentProjectMember[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.slice(0, 32).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<AgentProjectMember>;
    const name = clean(item.name, 160);
    if (!name) return [];
    let id = clean(item.id, 100) || `agent-${index + 1}`;
    while (ids.has(id)) id = `${id}-${index + 1}`;
    ids.add(id);
    const old = previous.find((candidate) => candidate.id === id);
    const role = MEMBER_ROLES.includes(item.role as AgentProjectMember["role"])
      ? item.role as AgentProjectMember["role"]
      : "custom";
    const selectedWorkspaceIds = Array.isArray(item.workspaceIds)
      ? item.workspaceIds.filter((entry): entry is string => typeof entry === "string" && workspaceIds.has(entry)).slice(0, 32)
      : [];
    return [{
      id,
      name,
      role,
      responsibility: clean(item.responsibility, 2000),
      instructions: clean(item.instructions, 8000),
      providerId: cleanNullable(item.providerId, 512),
      groupId: cleanNullable(item.groupId, 512),
      model: clean(item.model, 512),
      reasoningEffort: clean(item.reasoningEffort, 64),
      workspaceIds: selectedWorkspaceIds,
      // Thread identity and lifecycle state are never accepted from a client.
      threadId: old?.threadId ?? null,
      status: old?.status ?? "draft"
    }];
  });
}

function validCoordinator(value: unknown, agents: AgentProjectMember[]): string | null {
  const candidate = cleanNullable(value, 100);
  return candidate && agents.some((agent) => agent.id === candidate) ? candidate : null;
}

function messageKind(value: unknown): AgentProjectMessage["kind"] {
  return value === "agent" || value === "system" || value === "handoff" ? value : "human";
}

function discussionPhase(value: unknown): AgentProjectDiscussionPhase | null {
  return value === "analysis" || value === "challenge" || value === "synthesis" ? value : null;
}

function isUniqueConstraint(error: unknown): boolean {
  return /unique|constraint/i.test(error instanceof Error ? error.message : String(error));
}

function mapMessage(row: MessageRow): AgentProjectMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    agentId: row.agent_id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    itemId: row.item_id,
    kind: messageKind(row.kind),
    ...(discussionPhase(row.phase) ? { phase: discussionPhase(row.phase)! } : {}),
    providerId: row.provider_id,
    groupId: row.group_id,
    model: row.model,
    text: row.text,
    createdAt: row.created_at,
    sequence: row.sequence
  };
}

function mapThread(row: ThreadRow): ProjectThreadBinding {
  return {
    ownerId: row.owner_id,
    projectId: row.project_id,
    agentId: row.agent_id,
    threadId: row.thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapVote(row: VoteRow): AgentProjectVote {
  return {
    id: row.id,
    projectId: row.project_id,
    proposalId: row.proposal_id,
    voterId: row.voter_id,
    voterType: row.voter_type === "agent" ? "agent" : "human",
    choice: row.choice === "reject" || row.choice === "abstain" ? row.choice : "approve",
    comment: row.comment,
    createdAt: row.created_at
  };
}
