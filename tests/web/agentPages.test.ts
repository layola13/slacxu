import { expect, test } from "bun:test";
import {
  ALL_AGENTS_PAGE,
  agentVirtualPageKey,
  buildAllAgentOverviewRows,
  selectAgentRailSessions,
  summarizeAgentStatuses,
} from "../../apps/web/src/waterfall/agentPages.ts";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";
import { overviewLaneCount } from "../../apps/web/src/waterfall/AgentOverviewGrid.tsx";

test("uses one stable virtual page key per main, all, and agent page", () => {
  expect(agentVirtualPageKey("parent", { kind: "main" })).toBe("parent:main");
  expect(agentVirtualPageKey("parent", ALL_AGENTS_PAGE)).toBe("parent:all");
  expect(agentVirtualPageKey("parent", { kind: "agent", agentId: "child-1" })).toBe("parent:agent:child-1");
});

test("adapts the all-agent grid to a full window or split pane", () => {
  expect(overviewLaneCount(1500)).toBe(3);
  expect(overviewLaneCount(900)).toBe(2);
  expect(overviewLaneCount(519)).toBe(1);
});

test("bounds the shortcut rail while retaining a selected completed agent", () => {
  const active = Array.from({ length: 100 }, (_, index) => ({
    id: `agent-${index + 1}`,
    name: `Agent ${index + 1}`,
  }));
  const selected = { id: "agent-completed", name: "Completed agent", status: "completed" };
  const rail = selectAgentRailSessions(active, selected);

  expect(rail).toHaveLength(16);
  expect(rail.at(-1)?.id).toBe("agent-completed");
  expect(selectAgentRailSessions(active, null)).toEqual(active.slice(0, 16));
});

test("counts successful and failed agents separately", () => {
  expect(summarizeAgentStatuses([
    { id: "working", name: "Working", status: "working" },
    { id: "completed", name: "Completed", status: "completed" },
    { id: "failed", name: "Failed", status: "failed" },
    { id: "missing", name: "Missing", status: "notFound" },
  ])).toEqual({ completed: 1, failed: 2 });
});

test("flattens all agents into one bounded virtual row list", () => {
  const turns = new Map<string, WorkbenchTurn[]>([["child-1", [{
    id: "turn-1",
    threadId: "child-1",
    status: "inProgress",
    startedAt: 10,
    items: [],
  }]]]);
  const agents = Array.from({ length: 100 }, (_, index) => ({
    id: `agent-${index + 1}`,
    threadId: `child-${index + 1}`,
    name: `Agent ${index + 1}`,
    role: `role-${index + 1}`,
    status: "completed",
  }));

  const rows = buildAllAgentOverviewRows(agents, turns, "parent", new Map([["child-1", {
    threadId: "child-1",
    turnId: "turn-1",
    status: "completed",
    text: "Latest visible output",
  }]]));

  expect(rows).toHaveLength(100);
  expect(new Set(rows.map((row) => row.key)).size).toBe(100);
  expect(rows[0]).toMatchObject({
    key: "agent-overview:agent-1",
    threadId: "child-1",
    status: "inProgress",
    isLive: true,
    text: "Latest visible output",
  });
  expect(rows[99]).toMatchObject({
    threadId: "child-100",
    status: "completed",
    isLive: false,
  });
});
