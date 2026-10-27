import { describe, expect, test } from "bun:test";
import {
  MINI_SUBAGENT_MAX_CHILDREN,
  MINI_SUBAGENT_MAX_DEPTH,
  MINI_CHILD_TURN_CONCURRENCY_DEFAULT,
  MiniBridge,
  buildMiniSubagentPrompt,
  isMiniSubagentDepthExceeded,
  isMiniSubagentTool,
  miniCoerceSpawnMessage,
  miniChildPendingInputLimit,
  miniChildTurnConcurrency,
  miniToolsForDepth,
  miniToolArgValidationError,
  normalizeMiniSubagentToolName,
  normalizeMiniWaitTimeout,
  parseMiniSubagentTaskName,
} from "../../backends/mini/src/runtime/miniBridge.ts";

describe("mini subagent helpers", () => {
  test("task names follow codex lowercase/digits/underscores rule", () => {
    expect(parseMiniSubagentTaskName("explore_auth")).toBe("explore_auth");
    expect(parseMiniSubagentTaskName("task_1")).toBe("task_1");
    expect(parseMiniSubagentTaskName("Explore")).toBeNull();
    expect(parseMiniSubagentTaskName("has space")).toBeNull();
    expect(parseMiniSubagentTaskName("has-dash")).toBeNull();
    expect(parseMiniSubagentTaskName("")).toBeNull();
    expect(parseMiniSubagentTaskName(undefined)).toBeNull();
  });

  test("depth limit mirrors codex nesting guard", () => {
    expect(isMiniSubagentDepthExceeded(1, MINI_SUBAGENT_MAX_DEPTH)).toBe(false);
    expect(isMiniSubagentDepthExceeded(2, MINI_SUBAGENT_MAX_DEPTH)).toBe(true);
    expect(MINI_SUBAGENT_MAX_DEPTH).toBe(1);
  });

  test("wait timeout clamps like codex wait_agent", () => {
    expect(normalizeMiniWaitTimeout(undefined)).toBe(60000);
    expect(normalizeMiniWaitTimeout(0)).toBe(1000);
    expect(normalizeMiniWaitTimeout(500000)).toBe(300000);
    expect(normalizeMiniWaitTimeout(5000)).toBe(5000);
  });

  test("subagent prompt carries task, brief, and report instruction", () => {
    const prompt = buildMiniSubagentPrompt("explore_auth", "Check the login flow for races", "explorer");
    expect(prompt).toContain("explore_auth");
    expect(prompt).toContain("Check the login flow for races");
    expect(prompt).toContain("explorer");
    expect(prompt).toContain("summary");
    expect(prompt).toContain("no preamble");
    expect(prompt).toContain("as few tool calls as possible");
  });

  test("root sees spawn tools, children do not", () => {
    const root = miniToolsForDepth(0).map((t) => t.name);
    expect(root).toContain("spawn_agent");
    expect(root).toContain("wait_agent");
    expect(root).toContain("send_message");
    expect(root).not.toContain("send_input");
    // followup_task / read_agent_report are first-class (not aliases).
    expect(root).toContain("followup_task");
    expect(root).toContain("read_agent_report");
    expect(root).toContain("close_agent");
    expect(root).toContain("resume_agent");
    expect(root).toContain("list_agents");
    const child = miniToolsForDepth(1).map((t) => t.name);
    expect(child).not.toContain("spawn_agent");
    expect(child).toContain("sa_vm");
    expect(isMiniSubagentTool("spawn_agent")).toBe(true);
    expect(isMiniSubagentTool("sa_vm")).toBe(false);
  });

  test("root subagent schemas preserve AgentControl tool boundaries", () => {
    const tools = Object.fromEntries(miniToolsForDepth(0).map((tool) => [tool.name, tool])) as Record<string, any>;
    expect(tools.send_message).toBeDefined();
    expect(tools.followup_task).toBeDefined();
    expect(tools.interrupt_agent).toBeDefined();
    expect(tools.wait_agent).toBeDefined();
    expect(tools.send_message.schema.required).toEqual(["target", "message"]);
    expect(tools.followup_task.schema.required).toEqual(["target", "message"]);
    expect(tools.send_message.schema.properties.interrupt).toBeUndefined();
    expect(tools.followup_task.schema.properties.interrupt).toBeUndefined();
    expect(tools.interrupt_agent.schema.required).toEqual(["target"]);
    expect(tools.resume_agent).toBeDefined();
    expect(tools.resume_agent.schema.required).toEqual(["target"]);
    expect(tools.wait_agent.schema.properties.timeout_ms).toBeDefined();
  });

  test("invalid tool args are flagged before they can poison the upstream thread", () => {
    expect(miniToolArgValidationError("spawn_agent", {})).toContain("task_name");
    expect(miniToolArgValidationError("spawn_agent", { task_name: "task_a" })).toContain("non-empty message");
    expect(miniToolArgValidationError("spawn_agent", { message: "do x" })).toBeNull();
    expect(miniToolArgValidationError("interrupt_agent", {})).toContain("target");
    expect(miniToolArgValidationError("interrupt_agent", { target: "abc" })).toBeNull();
    expect(miniToolArgValidationError("send_message", { target: "abc" })).toContain("non-empty message");
    expect(miniToolArgValidationError("send_message", { target: "abc", message: "hi" })).toBeNull();
    expect(miniToolArgValidationError("send_message", {})).toContain("target");
    expect(normalizeMiniSubagentToolName("send_input")).toBe("send_message");
    // followup_task is first-class: queue + trigger, never a send_message alias.
    expect(normalizeMiniSubagentToolName("followup_task")).toBe("followup_task");
    expect(isMiniSubagentTool("send_input")).toBe(true);
    expect(isMiniSubagentTool("followup_task")).toBe(true);
    expect(miniToolArgValidationError("followup_task", { target: "abc" })).toContain("non-empty message");
    expect(miniToolArgValidationError("followup_task", { target: "abc", message: "hi" })).toBeNull();
    expect(miniToolArgValidationError("read_agent_report", {})).toContain("target");
    expect(miniToolArgValidationError("read_agent_report", { target: "abc" })).toBeNull();
    expect(miniToolArgValidationError("wait_agent", {})).toContain("target");
    expect(miniToolArgValidationError("wait_agent", { targets: ["abc"] })).toBeNull();
    expect(miniToolArgValidationError("close_agent", {})).toContain("target");
    expect(miniToolArgValidationError("resume_agent", {})).toContain("target");
    expect(miniToolArgValidationError("resume_agent", { target: "abc" })).toBeNull();
    expect(miniToolArgValidationError("sa_vm", {})).toContain("action");
    expect(miniToolArgValidationError("sa_vm", { action: "list_dir" })).toBeNull();
    expect(miniToolArgValidationError("read_skill", {})).toContain("name");
    expect(miniToolArgValidationError("update_plan", { whatever: 1 })).toBeNull();
    expect(miniToolArgValidationError("unknown_thing", {})).toBeNull();
  });
});

function makeParent(): any {
  return { threadId: "parent-1", cwd: process.cwd(), model: "gpt-5-mini", turns: [], messages: [] };
}

function immediateBridge(): MiniBridge {
  return new MiniBridge({
    startSubagentTurn: (child: any, prompt: string) => {
      child.turns.push({ id: "stub-turn", status: "completed", createdAt: Date.now() });
      child.messages.push({ type: "agentMessage", id: "stub-msg", turnId: "stub-turn", threadId: child.threadId, text: `stub report for ${child.taskName ?? ""}: ${prompt.slice(0, 40)}` });
      child.activeTurnId = undefined;
      child.subStatus = "completed";
      child.finalReport = `stub report for ${child.taskName ?? ""}`;
      child.pendingInputs = child.pendingInputs ?? [];
    },
  });
}

describe("mini subagent lifecycle on MiniBridge", () => {
  test("spawn -> wait collects the child report", async () => {
    const bridge = immediateBridge();
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", { task_name: "explore_auth", message: "Check login races" }));
    expect(typeof spawned.agent_id).toBe("string");
    expect(spawned.nickname).toBe("explore_auth");
    const waited = JSON.parse(await bridge.handleMiniSubagentCall(parent, "wait_agent", { targets: [spawned.agent_id], timeout_ms: 5000 }));
    expect(waited.timedOut).toBe(false);
    expect(waited.agents[0].status).toBe("completed");
    // wait_agent inlines completed reports so the parent advances without an extra read_agent_report round.
    expect(waited.agents[0].has_report).toBe(true);
    expect(typeof waited.agents[0].report).toBe("string");
    expect(waited.agents[0].report).toContain("explore_auth");
    const read = JSON.parse(await bridge.handleMiniSubagentCall(parent, "read_agent_report", { target: spawned.agent_id }));
    expect(read.report).toContain("explore_auth");
  });

  test("children cannot spawn grandchildren", async () => {
    const bridge = immediateBridge();
    const child = { ...makeParent(), threadId: "child-1", parentThreadId: "parent-1", depth: 1 };
    const out = await bridge.handleMiniSubagentCall(child, "spawn_agent", { task_name: "nested", message: "should be refused" });
    expect(out).toContain("depth limit");
  });

  test("concurrency cap matches five-child budget", async () => {
    const bridge = new MiniBridge({ startSubagentTurn: () => {} });
    const parent = makeParent();
    for (let i = 0; i < MINI_SUBAGENT_MAX_CHILDREN; i++) {
      const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", { task_name: `slot_${i}`, message: `work ${i}` }));
      expect(spawned.status).toBe("running");
    }
    const refused = await bridge.handleMiniSubagentCall(parent, "spawn_agent", { task_name: "extra", message: "no room" });
    expect(refused).toContain("concurrency limit");
  });

  test("completed children retain residency until close_agent frees a slot", async () => {
    const bridge = immediateBridge();
    const parent = makeParent();
    const children: string[] = [];
    for (let i = 0; i < MINI_SUBAGENT_MAX_CHILDREN; i++) {
      const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
        task_name: `resident_${i}`, message: `complete ${i}`,
      }));
      children.push(spawned.agent_id);
    }
    const refused = await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "resident_extra", message: "must wait for close",
    });
    expect(refused).toContain("concurrency limit");
    const closed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "close_agent", { target: children[0] }));
    expect(closed.previous_status).toBe("completed");
    const admitted = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "resident_extra", message: "slot is now free",
    }));
    expect(admitted.status).toBe("running");
  });

  test("embedded child turns use bounded FIFO admission and close cancels queued work", async () => {
    const bridge = new MiniBridge();
    const parent = makeParent();
    const started: string[] = [];
    const release: Array<() => void> = [];
    const internal = bridge as unknown as { runMiniTurn: (child: any, turnId: string, prompt: string) => Promise<void> };
    internal.runMiniTurn = async (_child, turnId) => {
      started.push(turnId);
      await new Promise<void>((resolve) => release.push(resolve));
    };
    const children: string[] = [];
    for (let i = 0; i < MINI_SUBAGENT_MAX_CHILDREN; i++) {
      const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
        task_name: `queued_${i}`, message: `work ${i}`,
      }));
      children.push(spawned.agent_id);
    }
    await Bun.sleep(0);
    expect(miniChildTurnConcurrency()).toBe(MINI_CHILD_TURN_CONCURRENCY_DEFAULT);
    expect(started).toHaveLength(MINI_CHILD_TURN_CONCURRENCY_DEFAULT);
    const closed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "close_agent", { target: children[3] }));
    expect(closed.agent_id).toBe(children[3]);
    while (release.length) release.shift()!();
    await Bun.sleep(0);
    expect(started).toHaveLength(MINI_CHILD_TURN_CONCURRENCY_DEFAULT + 1);
    while (release.length) release.shift()!();
    await Bun.sleep(0);
    expect((bridge as any).miniChildTurnsInFlight).toBe(0);
    expect((bridge as any).miniChildTurnQueue).toHaveLength(0);
  });

  test("parent thread deletion cancels active and queued child turns without late completion", async () => {
    const bridge = new MiniBridge();
    const parent = makeParent();
    const internal = bridge as unknown as {
      sessions: Map<string, any>;
      runMiniTurn: (child: any, turnId: string, prompt: string) => Promise<void>;
      miniChildTurnQueue: Array<{ child: any; turnId: string; cancelled: boolean }>;
    };
    internal.sessions.set(parent.threadId, parent);
    const started: string[] = [];
    const release: Array<() => void> = [];
    internal.runMiniTurn = async (_child, turnId) => {
      started.push(turnId);
      await new Promise<void>((resolve) => release.push(resolve));
    };
    const childIds: string[] = [];
    for (let index = 0; index < MINI_SUBAGENT_MAX_CHILDREN; index++) {
      const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
        task_name: `delete_race_${index}`,
        message: `delete race ${index}`,
      }));
      childIds.push(spawned.agent_id);
    }
    await Bun.sleep(0);
    expect(started).toHaveLength(MINI_CHILD_TURN_CONCURRENCY_DEFAULT);
    expect(internal.miniChildTurnQueue.length).toBe(MINI_SUBAGENT_MAX_CHILDREN - MINI_CHILD_TURN_CONCURRENCY_DEFAULT);

    const notifications: any[] = [];
    bridge.on("notification", (notification) => notifications.push(notification));
    await bridge.request("thread/delete", { threadId: parent.threadId });
    expect(internal.sessions.has(parent.threadId)).toBe(false);
    for (const childId of childIds) expect(internal.sessions.has(childId)).toBe(false);
    expect(internal.miniChildTurnQueue.every((entry) => entry.cancelled)).toBe(true);

    while (release.length) release.shift()!();
    await Bun.sleep(0);
    expect((bridge as any).miniChildTurnsInFlight).toBe(0);
    expect((bridge as any).miniChildTurnQueue).toHaveLength(0);
    expect(notifications.some((event) => event.method === "turn/completed")).toBe(false);
  });

  test("close_agent retains a resumable rollout; late completions stay no-ops", async () => {
    const snapshots: any[] = [];
    const deleted: string[] = [];
    const bridge = new MiniBridge({
      startSubagentTurn: () => {},
      onSnapshot: (snapshot) => {
        const index = snapshots.findIndex((entry) => entry.threadId === snapshot.threadId);
        if (index >= 0) snapshots[index] = snapshot;
        else snapshots.push(snapshot);
      },
      listSnapshots: () => snapshots,
      loadSnapshot: (threadId) => snapshots.find((snapshot) => snapshot.threadId === threadId) ?? null,
      deleteSnapshot: (threadId) => {
        deleted.push(threadId);
        for (let index = snapshots.length - 1; index >= 0; index--) {
          if (snapshots[index].threadId === threadId) snapshots.splice(index, 1);
        }
      },
    });
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "close_late",
      message: "close while the provider is still returning",
    }));
    const internal = bridge as unknown as {
      sessions: Map<string, any>;
      completeTurn: (child: any, turnId: string, text: string) => void;
    };
    const child = internal.sessions.get(spawned.agent_id)!;
    const turnId = child.activeTurnId as string;
    const notifications: any[] = [];
    bridge.on("notification", (notification) => notifications.push(notification));

    const closed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "close_agent", { target: spawned.agent_id }));
    expect(closed.previous_status).toBe("running");
    // Upstream parity: closing releases residency but retains the rollout for resume_agent.
    expect(deleted).toHaveLength(0);
    const retained = snapshots.find((entry) => entry.threadId === spawned.agent_id);
    expect(retained?.closed).toBe(true);
    expect(retained?.subStatus).toBe("interrupted");
    internal.completeTurn(child, turnId, "late provider response");
    expect(internal.sessions.has(spawned.agent_id)).toBe(false);
    expect(notifications.some((event) => event.method === "turn/completed")).toBe(false);
    // The retained rollout reopens on demand.
    const resumed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "resume_agent", { target: spawned.agent_id }));
    expect(resumed.resumed).toBe(true);
    expect(resumed.agent_id).toBe(spawned.agent_id);
    expect(resumed.status).toBe("interrupted");
    expect(internal.sessions.has(spawned.agent_id)).toBe(true);
  });

  test("repeated spawn, follow-up, and close cycles leave no resident child sessions", async () => {
    const bridge = new MiniBridge({ startSubagentTurn: () => {} });
    const parent = makeParent();
    const internal = bridge as unknown as { sessions: Map<string, any> };
    for (let round = 0; round < 20; round++) {
      const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
        task_name: `pressure_${round}`,
        message: `pressure round ${round}`,
      }));
      const queued = JSON.parse(await bridge.handleMiniSubagentCall(parent, "followup_task", {
        target: spawned.agent_id,
        message: `follow-up round ${round}`,
      }));
      expect(queued.queued).toBe(true);
      const closed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "close_agent", { target: spawned.agent_id }));
      expect(closed.agent_id).toBe(spawned.agent_id);
      expect(internal.sessions.has(spawned.agent_id)).toBe(false);
    }
    expect([...internal.sessions.values()].filter((session) => session.parentThreadId === parent.threadId)).toHaveLength(0);
    expect((bridge as any).miniChildTurnQueue).toHaveLength(0);
  });

  test("follow-up queue has a bounded memory budget", async () => {
    const bridge = new MiniBridge({ startSubagentTurn: () => {} });
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "queue_budget", message: "keep this child active",
    }));
    for (let i = 0; i < miniChildPendingInputLimit(); i++) {
      const queued = JSON.parse(await bridge.handleMiniSubagentCall(parent, "send_message", {
        target: spawned.agent_id, message: `queued ${i}`,
      }));
      expect(queued.queued).toBe(true);
    }
    const refused = await bridge.handleMiniSubagentCall(parent, "send_message", {
      target: spawned.agent_id, message: "overflow",
    });
    expect(refused).toContain("queue is full");
  });

  test("thread/read is cold-read only while child resume/direct input require parent ownership", async () => {
    const child = {
      threadId: "cold-child",
      cwd: process.cwd(),
      model: "gpt-5-mini",
      turns: [],
      messages: [],
      parentThreadId: "missing-parent",
      taskName: "cold_worker",
      agentType: "research",
      depth: 1,
      subStatus: "completed",
      finalReport: "done",
    };
    const bridge = new MiniBridge({
      loadSnapshot: (threadId) => threadId === child.threadId ? child : null,
      loadMetadata: (threadId) => threadId === child.threadId ? child : null,
    });
    const read = await bridge.request("thread/read", { threadId: child.threadId, includeTurns: false });
    expect((read as any).thread).toMatchObject({
      id: child.threadId,
      parentThreadId: child.parentThreadId,
      agentRole: child.agentType,
      canAcceptDirectInput: false,
    });
    const coldSummary = await bridge.request("thread/read", { threadId: child.threadId, includeTurns: false });
    expect((coldSummary as any).thread.canAcceptDirectInput).toBe(false);
    await expect(bridge.request("thread/resume", { threadId: child.threadId, includeTurns: false })).rejects.toThrow("parent ownership is unavailable");
    await expect(bridge.request("turn/start", { threadId: child.threadId, input: "direct child input" })).rejects.toThrow("does not accept direct input");
  });

  test("persisted child residency survives restart and remains closable", async () => {
    const parent = makeParent();
    let snapshots: any[] = Array.from({ length: MINI_SUBAGENT_MAX_CHILDREN }, (_, index) => ({
      threadId: `persisted-${index}`,
      cwd: parent.cwd,
      model: parent.model,
      turns: [],
      messages: [],
      parentThreadId: parent.threadId,
      taskName: `persisted_${index}`,
      depth: 1,
      subStatus: "completed",
      finalReport: `report ${index}`,
    }));
    snapshots.push({
      threadId: "foreign-child",
      cwd: parent.cwd,
      model: parent.model,
      turns: [],
      messages: [],
      parentThreadId: parent.threadId,
      ownerId: "other-owner",
      taskName: "foreign_child",
      depth: 1,
      subStatus: "completed",
      finalReport: "must stay hidden",
    });
    const bridge = new MiniBridge({
      onSnapshot: (snapshot: any) => {
        const index = snapshots.findIndex((entry: any) => entry.threadId === snapshot.threadId);
        if (index >= 0) snapshots[index] = snapshot;
        else snapshots.push(snapshot);
      },
      listSnapshots: () => snapshots,
      loadSnapshot: (threadId) => snapshots.find((snapshot) => snapshot.threadId === threadId) ?? null,
      deleteSnapshot: (threadId) => { snapshots = snapshots.filter((snapshot) => snapshot.threadId !== threadId); },
      startSubagentTurn: () => {},
    });
    const listed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "list_agents", {}));
    expect(listed.agents).toHaveLength(MINI_SUBAGENT_MAX_CHILDREN);
    expect(listed.agents[0]).toMatchObject({ agent_id: "persisted-0", status: "completed" });
    expect(listed.agents.some((agent: any) => agent.agent_id === "foreign-child")).toBe(false);
    const refused = await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "persisted_extra", message: "must wait for a restored child to close",
    });
    expect(refused).toContain("concurrency limit");
    const closed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "close_agent", { target: "persisted-0" }));
    expect(closed.previous_status).toBe("completed");
    // Close releases the slot but retains a closed rollout for resume_agent.
    const retained = snapshots.find((snapshot: any) => snapshot.threadId === "persisted-0");
    expect(retained?.closed).toBe(true);
    const listedAfterClose = JSON.parse(await bridge.handleMiniSubagentCall(parent, "list_agents", {}));
    expect(listedAfterClose.agents.some((agent: any) => agent.agent_id === "persisted-0")).toBe(false);
    const waitedClosed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "wait_agent", { targets: ["persisted-0"], timeout_ms: 1000 }));
    expect(waitedClosed.agents[0].status).toBe("notFound");
    const admitted = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "persisted_extra", message: "closed slot is now free",
    }));
    expect(admitted.status).toBe("running");
    await bridge.handleMiniSubagentCall(parent, "close_agent", { target: admitted.agent_id });
    const resumed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "resume_agent", { target: "persisted-0" }));
    expect(resumed.resumed).toBe(true);
    expect(resumed.status).toBe("completed");
    const readBack = JSON.parse(await bridge.handleMiniSubagentCall(parent, "read_agent_report", { target: "persisted-0" }));
    expect(readBack.report).toBe("report 0");
    // Resume re-occupies residency: the budget is full again, so a fresh spawn is refused.
    const full = await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "persisted_full", message: "budget is full again",
    });
    expect(full).toContain("concurrency limit");
  });

  test("wait times out on a stuck child instead of hanging", async () => {
    const bridge = new MiniBridge({ startSubagentTurn: () => {} });
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", { task_name: "stuck", message: "never finishes" }));
    const waited = JSON.parse(await bridge.handleMiniSubagentCall(parent, "wait_agent", { targets: [spawned.agent_id], timeout_ms: 1000 }));
    expect(waited.timedOut).toBe(true);
    expect(waited.agents[0].status).toBe("running");
  });

  test("update_plan-style todos are coerced into a spawn brief instead of looping", () => {
    const msg = miniCoerceSpawnMessage({ task_name: "task_a", todos: [{ content: "read package.json", status: "pending" }] });
    expect(msg).toContain("read package.json");
    expect(miniToolArgValidationError("spawn_agent", { task_name: "task_a", todos: [{ content: "x", status: "pending" }] })).toBeNull();
    expect(miniCoerceSpawnMessage({})).toBe("");
  });

  test("spawn output carries task_name and todos-only spawn still creates a child", async () => {
    const bridge = immediateBridge();
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", { task_name: "task_t", todos: [{ content: "do work", status: "pending" }] }));
    expect(spawned.task_name).toBe("task_t");
    expect(typeof spawned.agent_id).toBe("string");
  });

  test("wait_agent wakes on the finish event instead of polling", async () => {
    // startSubagentTurn never completes: the child stays running so wait_agent
    // genuinely parks on the waiter instead of snapshotting a settled child.
    const bridge = new MiniBridge({ startSubagentTurn: () => {} });
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", { task_name: "slow_task", message: "finish me later" }));
    const notifications: any[] = [];
    bridge.on("notification", (n) => notifications.push(n));
    const waitedPromise = bridge.handleMiniSubagentCall(parent, "wait_agent", { targets: [spawned.agent_id], timeout_ms: 5000 });
    // Complete the child through the real turn-end path after a short delay.
    const internal = bridge as unknown as {
      sessions: Map<string, any>;
      finishMiniSubagent(child: any, status: "completed", report: string): void;
    };
    const child = internal.sessions.get(spawned.agent_id)!;
    // Mirror runMiniTurnOnce: the runner clears the active turn before
    // reporting completion via finishMiniSubagent.
    setTimeout(() => {
      child.activeTurnId = undefined;
      internal.finishMiniSubagent(child, "completed", "async report for slow_task");
    }, 60);
    const startedAt = Date.now();
    const waited = JSON.parse(await waitedPromise);
    const elapsed = Date.now() - startedAt;
    expect(waited.timedOut).toBe(false);
    expect(waited.agents[0].status).toBe("completed");
    expect(waited.agents[0].has_report).toBe(true);
    // Event wake: must resolve far below the 30s lost-wakeup backstop.
    expect(elapsed).toBeLessThan(3000);
    const completed = notifications.find((n) => n.method === "agent/completed");
    expect(completed).toBeDefined();
    expect(completed.params.agent_id).toBe(spawned.agent_id);
    expect(completed.params.report).toContain("slow_task");
    const read = JSON.parse(await bridge.handleMiniSubagentCall(parent, "read_agent_report", { target: spawned.agent_id }));
    expect(read.report).toContain("slow_task");
  });

  test("child completion lands a capped marker in the parent history", async () => {
    const bridge = new MiniBridge({ startSubagentTurn: () => {} });
    const parent = makeParent();
    const internal = bridge as unknown as {
      sessions: Map<string, any>;
      finishMiniSubagent(child: any, status: "completed", report: string): void;
    };
    // Mirror production: the parent is a live session in the bridge map.
    internal.sessions.set(parent.threadId, parent);
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", { task_name: "slow_task", message: "finish me later" }));
    const child = internal.sessions.get(spawned.agent_id)!;
    const longReport = `async report for slow_task: ${"x".repeat(20000)}`;
    child.activeTurnId = undefined;
    internal.finishMiniSubagent(child, "completed", longReport);
    const markers = (parent.messages as any[]).filter((m) => m?.type === "userMessage" && String(m?.text ?? "").startsWith("[sub-agent slow_task completed]:"));
    expect(markers.length).toBe(1);
    expect(markers[0].text).toContain("slow_task");
    // Marker is capped to ~1000 tokens; the full text stays fetchable.
    expect(markers[0].text.length).toBeLessThan(5000);
    const read = JSON.parse(await bridge.handleMiniSubagentCall(parent, "read_agent_report", { target: spawned.agent_id }));
    expect(read.report.length).toBe(8000);
  });

  test("split send/followup/interrupt semantics: queue-only, trigger, redirect", async () => {
    const bridge = immediateBridge();
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", { task_name: "alias", message: "first pass" }));
    // send_message only queues, never starts a turn.
    const queued = JSON.parse(await bridge.handleMiniSubagentCall(parent, "send_message", { target: spawned.agent_id, message: "queued note" }));
    expect(queued.agent_id).toBe(spawned.agent_id);
    expect(queued.queued).toBe(true);
    expect(queued.started).toBe(false);
    // interrupt=true is rejected on send_message: use interrupt_agent instead.
    const rejected = await bridge.handleMiniSubagentCall(parent, "send_message", { target: spawned.agent_id, message: "x", interrupt: true });
    expect(rejected).toContain("interrupt_agent");
    const interrupted = JSON.parse(await bridge.handleMiniSubagentCall(parent, "interrupt_agent", { target: spawned.agent_id }));
    expect(interrupted.agent_id).toBe(spawned.agent_id);
    expect(typeof interrupted.previous_status).toBe("string");
    // followup_task queues + triggers when idle.
    const triggered = JSON.parse(await bridge.handleMiniSubagentCall(parent, "followup_task", { target: spawned.agent_id, message: "second pass" }));
    expect(triggered.agent_id).toBe(spawned.agent_id);
    expect(triggered.started).toBe(true);
    expect(triggered.queued).toBe(false);
    // retired send_input alias still routes to send_message (queue-only).
    const viaRetiredAlias = JSON.parse(await bridge.handleMiniSubagentCall(parent, "send_input", { target: spawned.agent_id, message: "third pass" }));
    expect(viaRetiredAlias.agent_id).toBe(spawned.agent_id);
    expect(viaRetiredAlias.started).toBe(false);
  });

  test("send_message queues on a finished child; followup_task resumes it; close frees the slot", async () => {
    const bridge = immediateBridge();
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", { task_name: "followup", message: "first pass" }));
    const internal = bridge as unknown as { sessions: Map<string, any> };
    const child = internal.sessions.get(spawned.agent_id)!;
    const turnsBefore = child.turns.length;
    const sent = JSON.parse(await bridge.handleMiniSubagentCall(parent, "send_message", { target: spawned.agent_id, message: "second pass" }));
    expect(sent.agent_id).toBe(spawned.agent_id);
    expect(sent.queued).toBe(true);
    expect(sent.started).toBe(false);
    expect(child.turns.length).toBe(turnsBefore);
    const resumed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "followup_task", { target: spawned.agent_id, message: "resume pass" }));
    expect(resumed.agent_id).toBe(spawned.agent_id);
    expect(resumed.queued).toBe(false);
    expect(resumed.started).toBe(true);
    expect(child.turns.length).toBeGreaterThan(turnsBefore);
    const listed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "list_agents", {}));
    expect(listed.agents.length).toBe(1);
    const closed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "close_agent", { target: spawned.agent_id }));
    expect(closed.previous_status).toBe("completed");
    const relisted = JSON.parse(await bridge.handleMiniSubagentCall(parent, "list_agents", {}));
    expect(relisted.agents.length).toBe(0);
  });

  test("send_message queues an active child without duplicating its next turn", async () => {
    let starts = 0;
    const bridge = new MiniBridge({ startSubagentTurn: () => { starts++; } });
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "active_queue", message: "hold the first turn",
    }));
    expect(starts).toBe(1);
    const sent = JSON.parse(await bridge.handleMiniSubagentCall(parent, "send_message", {
      target: spawned.agent_id, message: "run exactly one follow-up",
    }));
    expect(sent.queued).toBe(true);
    const internal = bridge as unknown as { sessions: Map<string, any>; finishMiniSubagent: (child: any, status: string, report: string) => void };
    const child = internal.sessions.get(spawned.agent_id)!;
    expect(child.pendingInputs).toEqual(["run exactly one follow-up"]);
    child.activeTurnId = undefined;
    internal.finishMiniSubagent(child, "completed", "first report");
    expect(starts).toBe(2);
  });

  test("wait_agent wakes on the child status update event", async () => {
    const bridge = new MiniBridge({ startSubagentTurn: () => {} });
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "event_wait", message: "finish from a status event",
    }));
    const internal = bridge as unknown as { sessions: Map<string, any>; finishMiniSubagent: (child: any, status: string, report: string) => void };
    const child = internal.sessions.get(spawned.agent_id)!;
    const notifications: any[] = [];
    bridge.on("notification", (notification) => notifications.push(notification));
    const pending = bridge.handleMiniSubagentCall(parent, "wait_agent", { targets: [spawned.agent_id], timeout_ms: 5000 });
    setTimeout(() => {
      child.activeTurnId = undefined;
      internal.finishMiniSubagent(child, "completed", "event report");
    }, 0);
    const waited = JSON.parse(await pending);
    expect(waited.timedOut).toBe(false);
    expect(waited.agents[0].status).toBe("completed");
    expect(waited.agents[0].has_report).toBe(true);
    expect(waited.agents[0].report).toBe("event report");
    const read = JSON.parse(await bridge.handleMiniSubagentCall(parent, "read_agent_report", { target: spawned.agent_id }));
    expect(read.report).toBe("event report");
    expect(notifications.some((event) => event.method === "agent/status/updated" && event.params?.threadId === spawned.agent_id)).toBe(true);
  });

  test("resume_agent rejects unknown targets and no-ops on live children", async () => {
    const bridge = immediateBridge();
    const parent = makeParent();
    const missing = await bridge.handleMiniSubagentCall(parent, "resume_agent", { target: "nope" });
    expect(missing).toContain("unknown closed sub-agent");
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "live_resume", message: "already open",
    }));
    const noop = JSON.parse(await bridge.handleMiniSubagentCall(parent, "resume_agent", { target: spawned.agent_id }));
    expect(noop.resumed).toBe(false);
    expect(noop.status).toBe("completed");
  });

  test("list_agents honors path_prefix and hides closed children", async () => {
    const bridge = immediateBridge();
    const parent = makeParent();
    const a = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", { task_name: "scope_a", message: "a" }));
    await bridge.handleMiniSubagentCall(parent, "spawn_agent", { task_name: "scope_b", message: "b" });
    await bridge.handleMiniSubagentCall(parent, "close_agent", { target: a.agent_id });
    const filtered = JSON.parse(await bridge.handleMiniSubagentCall(parent, "list_agents", { path_prefix: "scope_b" }));
    expect(filtered.agents).toHaveLength(1);
    expect(filtered.agents[0].task_name).toBe("scope_b");
    const all = JSON.parse(await bridge.handleMiniSubagentCall(parent, "list_agents", {}));
    expect(all.agents.some((agent: any) => agent.task_name === "scope_a")).toBe(false);
    expect(all.agents.some((agent: any) => agent.task_name === "scope_b")).toBe(true);
  });

  test("interrupt and close suppress late child-turn notifications", async () => {
    const bridge = new MiniBridge({ startSubagentTurn: () => {} });
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "late_child", message: "wait for a late event",
    }));
    const internal = bridge as unknown as {
      sessions: Map<string, any>;
      emitMiniAgentDelta: (session: any, turnId: string, itemId: string, delta: string) => void;
    };
    const child = internal.sessions.get(spawned.agent_id)!;
    const turnId = child.activeTurnId as string;
    const notifications: any[] = [];
    bridge.on("notification", (notification) => notifications.push(notification));

    await bridge.handleMiniSubagentCall(parent, "interrupt_agent", { target: spawned.agent_id });
    internal.emitMiniAgentDelta(child, turnId, "late-item", "late after interrupt");
    expect(notifications.some((event) => event.method === "item/agentMessage/delta" && (event.params as any)?.turnId === turnId)).toBe(false);

    await bridge.handleMiniSubagentCall(parent, "close_agent", { target: spawned.agent_id });
    internal.emitMiniAgentDelta(child, turnId, "late-item", "late after close");
    expect(notifications.some((event) => event.method === "item/agentMessage/delta" && (event.params as any)?.turnId === turnId)).toBe(false);
  });

  test("failed child emits turn/failed before agent status and suppresses late deltas", async () => {
    const bridge = new MiniBridge({ startSubagentTurn: () => {} });
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "failed_child", message: "fail the current turn",
    }));
    const internal = bridge as unknown as {
      sessions: Map<string, any>;
      failTurn: (child: any, turnId: string, error: string) => void;
      emitMiniAgentDelta: (session: any, turnId: string, itemId: string, delta: string) => void;
    };
    const child = internal.sessions.get(spawned.agent_id)!;
    const turnId = child.activeTurnId as string;
    const notifications: any[] = [];
    bridge.on("notification", (notification) => notifications.push(notification));
    internal.failTurn(child, turnId, "upstream exploded");
    const failed = notifications.findIndex((event) => event.method === "turn/failed" && event.params?.turnId === turnId);
    const status = notifications.findIndex((event) => event.method === "agent/status/updated" && event.params?.threadId === spawned.agent_id);
    expect(failed).toBeGreaterThanOrEqual(0);
    expect(status).toBeGreaterThan(failed);
    expect(notifications[failed]?.params?.threadId).toBe(spawned.agent_id);
    expect(notifications[status]?.params?.status).toBe("failed");
    internal.emitMiniAgentDelta(child, turnId, "late-failure-item", "late after failure");
    expect(notifications.some((event) => event.method === "item/agentMessage/delta" && event.params?.turnId === turnId)).toBe(false);
  });

  test("interrupted child drains one queued follow-up and preserves event order", async () => {
    let starts = 0;
    const bridge = new MiniBridge({ startSubagentTurn: () => { starts++; } });
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "interrupt_queue", message: "interrupt then drain",
    }));
    const queued = JSON.parse(await bridge.handleMiniSubagentCall(parent, "send_message", {
      target: spawned.agent_id, message: "the single queued follow-up",
    }));
    expect(queued.queued).toBe(true);
    expect(starts).toBe(1);
    const internal = bridge as unknown as {
      sessions: Map<string, any>;
      interruptTurn: (child: any, turnId: string) => void;
      emitMiniAgentDelta: (session: any, turnId: string, itemId: string, delta: string) => void;
    };
    const child = internal.sessions.get(spawned.agent_id)!;
    const oldTurnId = child.activeTurnId as string;
    const notifications: any[] = [];
    bridge.on("notification", (notification) => notifications.push(notification));
    internal.interruptTurn(child, oldTurnId);
    expect(starts).toBe(2);
    const interrupted = notifications.findIndex((event) => event.method === "turn/interrupted" && event.params?.turnId === oldTurnId);
    const status = notifications.findIndex((event) => event.method === "agent/status/updated" && event.params?.status === "interrupted");
    const nextStarted = notifications.findIndex((event) => event.method === "turn/started" && event.params?.turnId !== oldTurnId);
    expect(interrupted).toBeGreaterThanOrEqual(0);
    expect(status).toBeGreaterThan(interrupted);
    expect(nextStarted).toBeGreaterThan(status);
    internal.emitMiniAgentDelta(child, oldTurnId, "late-interrupt-item", "late after interrupt");
    expect(notifications.some((event) => event.method === "item/agentMessage/delta" && event.params?.turnId === oldTurnId)).toBe(false);
  });

  test("a settled child turn cannot emit duplicate late deltas", async () => {
    const bridge = new MiniBridge({ startSubagentTurn: () => {} });
    const parent = makeParent();
    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "settled_child", message: "complete before late event",
    }));
    const internal = bridge as unknown as {
      sessions: Map<string, any>;
      emitMiniAgentDelta: (session: any, turnId: string, itemId: string, delta: string) => void;
    };
    const child = internal.sessions.get(spawned.agent_id)!;
    const turnId = child.activeTurnId as string;
    const notifications: any[] = [];
    bridge.on("notification", (notification) => notifications.push(notification));

    child.turns.find((turn: any) => turn.id === turnId).status = "completed";
    child.activeTurnId = undefined;
    internal.emitMiniAgentDelta(child, turnId, "duplicate-item", "duplicate late delta");

    expect(notifications.some((event) => event.method === "item/agentMessage/delta" && (event.params as any)?.turnId === turnId)).toBe(false);
  });

  test("spawn_agent emits thread/started with parentThreadId and child turn carries parent lineage", async () => {
    const bridge = immediateBridge();
    const parent = makeParent();
    const notifications: Array<{ method: string; params: any }> = [];
    bridge.on("notification", (n: any) => notifications.push(n));

    const spawned = JSON.parse(await bridge.handleMiniSubagentCall(parent, "spawn_agent", {
      task_name: "child_task",
      agent_type: "researcher",
      message: "do deep research"
    }));

    const threadStarted = notifications.find((n) => n.method === "thread/started");
    expect(threadStarted).toBeDefined();
    expect(threadStarted?.params?.thread?.id).toBe(spawned.agent_id);
    expect(threadStarted?.params?.thread?.parentThreadId).toBe(parent.threadId);
    expect(threadStarted?.params?.thread?.agentNickname).toBe("child_task");
    expect(threadStarted?.params?.thread?.agentRole).toBe("researcher");
    expect(threadStarted?.params?.thread?.cliBackend).toBe("mini");

    const turnStarted = notifications.find((n) => n.method === "turn/started");
    expect(turnStarted).toBeDefined();
    expect(turnStarted?.params?.threadId).toBe(spawned.agent_id);
    expect(turnStarted?.params?.parentThreadId).toBe(parent.threadId);
    expect(turnStarted?.params?.turn?.parentThreadId).toBe(parent.threadId);
  });

  test("followup_task resumes a persisted child with durable protocol events", async () => {
    const parent = makeParent();
    let snapshots: any[] = [{
      threadId: "durable-child",
      cwd: parent.cwd,
      model: parent.model,
      turns: [{ id: "old-turn", status: "completed", createdAt: Date.now() - 1000 }],
      messages: [],
      parentThreadId: parent.threadId,
      taskName: "durable_worker",
      depth: 1,
      subStatus: "completed",
      finalReport: "initial report",
    }];
    let startedPrompt = "";
    const bridge = new MiniBridge({
      listSnapshots: () => snapshots,
      loadSnapshot: (threadId) => snapshots.find((snapshot) => snapshot.threadId === threadId) ?? null,
      onSnapshot: (snapshot) => {
        const index = snapshots.findIndex((entry) => entry.threadId === snapshot.threadId);
        if (index >= 0) snapshots[index] = snapshot;
        else snapshots.push(snapshot);
      },
      deleteSnapshot: (threadId) => { snapshots = snapshots.filter((snapshot) => snapshot.threadId !== threadId); },
      startSubagentTurn: (_child, prompt) => { startedPrompt = prompt; },
    });
    const notifications: Array<{ method: string; params: any }> = [];
    bridge.on("notification", (notification: any) => notifications.push(notification));

    const resumed = JSON.parse(await bridge.handleMiniSubagentCall(parent, "followup_task", {
      target: "durable-child",
      message: "perform the resumed durable instruction task",
    }));
    expect(resumed).toMatchObject({ agent_id: "durable-child", status: "running", queued: false });
    expect(startedPrompt).toBe("perform the resumed durable instruction task");
    const internal = bridge as unknown as {
      sessions: Map<string, any>;
      completeTurn: (child: any, turnId: string, text: string) => void;
      finishMiniSubagent: (child: any, status: string, report: string) => void;
    };
    const child = internal.sessions.get("durable-child")!;
    const turnId = child.activeTurnId as string;
    internal.completeTurn(child, turnId, "resumed report");
    internal.finishMiniSubagent(child, "completed", "resumed report");

    const turnStarted = notifications.findIndex((event) => event.method === "turn/started");
    const turnCompleted = notifications.findIndex((event) => event.method === "turn/completed");
    const statusUpdated = notifications.findIndex((event) => event.method === "agent/status/updated");
    expect(turnStarted).toBeGreaterThanOrEqual(0);
    expect(turnCompleted).toBeGreaterThan(turnStarted);
    expect(statusUpdated).toBeGreaterThan(turnCompleted);
    expect(notifications[turnStarted]?.params?.parentThreadId).toBe(parent.threadId);
    expect(notifications[turnCompleted]?.params?.turn?.status).toBe("completed");
    expect(notifications[statusUpdated]?.params).toMatchObject({
      threadId: "durable-child",
      parentThreadId: parent.threadId,
      status: "completed",
      report: "resumed report",
    });
    expect(snapshots[0].subStatus).toBe("completed");
    expect(snapshots[0].finalReport).toBe("resumed report");
  });
});
