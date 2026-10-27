import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { AgentProjectMember, AgentProjectWorkspace } from "@codex-ui/shared";
import { ProjectRoomStore } from "../../apps/server/src/projectRoomStore.ts";

const ownerId = "owner-project-test";

function fixture() {
  const database = new Database(":memory:");
  const store = new ProjectRoomStore({ connection: database });
  const workspace: AgentProjectWorkspace = {
    id: "workspace-main",
    label: "Main workspace",
    path: "C:\\projects\\demo",
    mode: "local"
  };
  const agent: AgentProjectMember = {
    id: "agent-product",
    name: "Product",
    role: "product",
    responsibility: "Define requirements",
    instructions: "Be concise",
    providerId: "free-ollama",
    groupId: "default",
    model: "llama3.2",
    reasoningEffort: "medium",
    workspaceIds: [workspace.id],
    threadId: null,
    status: "draft"
  };
  const project = store.create(ownerId, {
    name: "Demo project",
    description: "A store test",
    workspaces: [workspace],
    agents: [agent],
    coordinatorAgentId: agent.id
  });
  return { database, store, project, agent, workspace };
}

test("Project messages receive continuous sequences and support incremental reads", () => {
  const { database, store, project } = fixture();
  try {
    const first = store.appendMessage(ownerId, {
      projectId: project.id,
      agentId: null,
      threadId: null,
      turnId: null,
      itemId: null,
      kind: "human",
      text: "Start"
    });
    const second = store.appendMessage(ownerId, {
      projectId: project.id,
      agentId: "agent-product",
      threadId: "thread-product",
      turnId: "turn-1",
      itemId: "item-1",
      kind: "agent",
      text: "Acknowledged"
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(store.listMessages(ownerId, project.id, 10, first.sequence)).toEqual([second]);
  } finally {
    database.close();
  }
});

test("Project discussion messages persist their phase and actual relay route", () => {
  const { database, store, project } = fixture();
  try {
    const appended = store.appendMessage(ownerId, {
      projectId: project.id,
      agentId: "agent-product",
      threadId: "thread-product",
      turnId: "turn-analysis",
      itemId: "item-analysis",
      kind: "handoff",
      phase: "analysis",
      providerId: "omnirouterfreee",
      groupId: "opencode-free",
      model: "longcat-2.0-free",
      text: "analysis result"
    });

    expect(appended).toMatchObject({
      phase: "analysis",
      providerId: "omnirouterfreee",
      groupId: "opencode-free",
      model: "longcat-2.0-free"
    });
    expect(store.listMessages(ownerId, project.id)).toEqual([appended]);
  } finally {
    database.close();
  }
});

test("legacy Project message tables migrate and old messages remain readable", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE agent_project_messages (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      agent_id TEXT,
      thread_id TEXT,
      turn_id TEXT,
      item_id TEXT,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      sequence INTEGER NOT NULL
    );
    INSERT INTO agent_project_messages
      (id, owner_id, project_id, agent_id, thread_id, turn_id, item_id, kind, text, created_at, sequence)
    VALUES
      ('legacy-message', 'legacy-owner', 'legacy-project', NULL, NULL, NULL, NULL, 'human', 'legacy text', 1234, 1);
  `);

  try {
    const store = new ProjectRoomStore({ connection: database });
    const columns = database.prepare("PRAGMA table_info(agent_project_messages)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "phase",
      "provider_id",
      "group_id",
      "model"
    ]));
    expect(store.listMessages("legacy-owner", "legacy-project")).toEqual([{
      id: "legacy-message",
      projectId: "legacy-project",
      agentId: null,
      threadId: null,
      turnId: null,
      itemId: null,
      kind: "human",
      providerId: null,
      groupId: null,
      model: null,
      text: "legacy text",
      createdAt: 1234,
      sequence: 1
    }]);
  } finally {
    database.close();
  }
});

test("the same thread and item are idempotent while deltas accumulate and completion replaces text", () => {
  const { database, store, project } = fixture();
  try {
    const initial = store.appendMessage(ownerId, {
      projectId: project.id,
      agentId: "agent-product",
      threadId: "thread-product",
      turnId: "turn-1",
      itemId: "item-1",
      kind: "agent",
      text: "old"
    });
    const duplicate = store.appendMessage(ownerId, {
      projectId: project.id,
      agentId: "agent-product",
      threadId: "thread-product",
      turnId: "turn-1",
      itemId: "item-1",
      kind: "agent",
      text: "ignored"
    });
    expect(duplicate).toEqual(initial);

    const deltaOne = store.appendAgentMessageDelta(ownerId, {
      projectId: project.id,
      agentId: "agent-product",
      threadId: "thread-product",
      turnId: "turn-1",
      itemId: "item-1",
      kind: "agent",
      delta: " +more"
    });
    const deltaTwo = store.appendAgentMessageDelta(ownerId, {
      projectId: project.id,
      agentId: "agent-product",
      threadId: "thread-product",
      turnId: "turn-1",
      itemId: "item-1",
      kind: "agent",
      delta: " +text"
    });
    expect(deltaOne.text).toBe("old +more");
    expect(deltaTwo.text).toBe("old +more +text");
    expect(deltaTwo.sequence).toBe(initial.sequence);

    const completed = store.upsertAgentMessage(ownerId, {
      projectId: project.id,
      agentId: "agent-product",
      threadId: "thread-product",
      turnId: "turn-1",
      itemId: "item-1",
      kind: "agent",
      text: "final answer"
    });
    expect(completed.text).toBe("final answer");
    expect(completed.id).toBe(initial.id);
    expect(store.listMessages(ownerId, project.id)).toHaveLength(1);
  } finally {
    database.close();
  }
});

test("client updates cannot forge runtime thread identity or status", () => {
  const { database, store, project, agent } = fixture();
  try {
    const created = store.get(ownerId, project.id)!;
    expect(created.agents[0]).toMatchObject({ threadId: null, status: "draft" });

    const patched = store.update(ownerId, project.id, {
      agents: [{ ...agent, threadId: "forged-thread", status: "active" }]
    })!;
    expect(patched.agents[0]).toMatchObject({ threadId: null, status: "draft" });

    const runtime = store.setRuntime(ownerId, project.id, [{ ...patched.agents[0]!, threadId: "real-thread", status: "starting" }], "active")!;
    expect(runtime).toMatchObject({ status: "active" });
    expect(runtime.agents[0]).toMatchObject({ threadId: "real-thread", status: "starting" });

    const bound = store.bindThread(ownerId, project.id, agent.id, "bound-thread");
    expect(bound.threadId).toBe("bound-thread");
    expect(store.findThread("bound-thread")).toMatchObject({ ownerId, projectId: project.id, agentId: agent.id });
    expect(store.get(ownerId, project.id)?.agents[0]).toMatchObject({ threadId: "bound-thread", status: "active" });

    expect(store.setMemberStatus(ownerId, project.id, agent.id, "paused")?.agents[0]?.status).toBe("paused");
  } finally {
    database.close();
  }
});

test("deleting a project removes its messages, votes, bindings, and sequence state", () => {
  const { database, store, project, agent } = fixture();
  try {
    store.bindThread(ownerId, project.id, agent.id, "thread-product");
    store.appendMessage(ownerId, {
      projectId: project.id,
      agentId: null,
      threadId: null,
      turnId: null,
      itemId: null,
      kind: "human",
      text: "to delete"
    });
    store.castVote(ownerId, {
      projectId: project.id,
      proposalId: "proposal-1",
      voterId: "human:owner-project-test",
      voterType: "human",
      choice: "approve",
      comment: "ok"
    });

    expect(store.delete(ownerId, project.id)).toBe(true);
    expect(store.get(ownerId, project.id)).toBeNull();
    expect(store.listMessages(ownerId, project.id)).toEqual([]);
    expect(store.listVotes(ownerId, project.id, "proposal-1")).toEqual([]);
    expect(store.listThreadBindings(ownerId, project.id)).toEqual([]);

    // A new project does not inherit the deleted project's sequence counter.
    const replacement = store.create(ownerId, {
      name: "Replacement",
      description: "",
      workspaces: [],
      agents: [],
      coordinatorAgentId: null
    });
    expect(store.appendMessage(ownerId, {
      projectId: replacement.id,
      agentId: null,
      threadId: null,
      turnId: null,
      itemId: null,
      kind: "human",
      text: "first"
    }).sequence).toBe(1);
  } finally {
    database.close();
  }
});

test("a human reject is a veto even when agents approve", () => {
  const { database, store, project } = fixture();
  try {
    for (const voterId of ["agent-a", "agent-b", "agent-c"]) {
      store.castVote(ownerId, {
        projectId: project.id,
        proposalId: "deploy-1",
        voterId,
        voterType: "agent",
        choice: "approve",
        comment: "looks good"
      });
    }
    store.castVote(ownerId, {
      projectId: project.id,
      proposalId: "deploy-1",
      voterId: `human:${ownerId}`,
      voterType: "human",
      choice: "reject",
      comment: "Not approved by customer"
    });

    expect(store.voteSummary(ownerId, project.id, "deploy-1")).toEqual({
      approved: 3,
      rejected: 1,
      abstained: 0,
      humanVeto: true,
      decision: "rejected"
    });
  } finally {
    database.close();
  }
});
