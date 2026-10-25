import type { WorkbenchItem, WorkbenchTurn } from "../state/codexClient";
import type { AgentTranscriptOverview } from "../app/transcripts/topicTranscriptStore";
import type { ChatWaterfallRow } from "./types";

export type AgentPageSession = {
  id: string;
  threadId?: string;
  name: string;
  role?: string;
  status?: string;
};

export type AgentVirtualPage =
  | { kind: "main" }
  | { kind: "all" }
  | { kind: "agent"; agentId: string };

export function summarizeAgentStatuses(agents: readonly AgentPageSession[]): { completed: number; failed: number } {
  let completed = 0;
  let failed = 0;
  for (const agent of agents) {
    const status = agent.status?.replace(/[_-]+/g, "").trim().toLowerCase();
    if (["completed", "shutdown", "done", "success"].includes(status ?? "")) completed += 1;
    if (["failed", "errored", "notfound"].includes(status ?? "")) failed += 1;
  }
  return { completed, failed };
}

export const MAIN_AGENT_PAGE: AgentVirtualPage = { kind: "main" };
export const ALL_AGENTS_PAGE: AgentVirtualPage = { kind: "all" };
export const MAX_AGENT_RAIL_ITEMS = 16;

export function agentVirtualPageKey(threadId: string | null, page: AgentVirtualPage): string {
  const topic = threadId ?? "new";
  if (page.kind === "agent") return `${topic}:agent:${page.agentId}`;
  return `${topic}:${page.kind}`;
}

export function selectAgentRailSessions<T extends AgentPageSession>(
  activeAgents: readonly T[],
  selectedAgent: T | null,
  limit = MAX_AGENT_RAIL_ITEMS,
): T[] {
  if (limit <= 0) return [];
  const selectedInActive = selectedAgent && activeAgents.some((agent) => agent.id === selectedAgent.id);
  const visible = activeAgents.slice(0, limit);
  if (!selectedAgent || selectedInActive) return visible;
  if (visible.length < limit) return [...visible, selectedAgent];
  return [...visible.slice(0, Math.max(0, limit - 1)), selectedAgent];
}

/**
 * The all-agents page is a compact projection, not a second transcript store.
 * One status row per agent keeps the overview bounded even with 100+ agents and
 * lets the same ChatWaterfall virtualizer render both overview and detail pages.
 */
export function buildAllAgentOverviewRows(
  agents: readonly AgentPageSession[],
  turnsByThreadId: ReadonlyMap<string, WorkbenchTurn[]>,
  parentThreadId: string | null,
  transcriptOverview: ReadonlyMap<string, AgentTranscriptOverview> = new Map(),
): ChatWaterfallRow[] {
  return agents.map((agent, index) => {
    const childTurns = agent.threadId ? turnsByThreadId.get(agent.threadId) ?? [] : [];
    const latestTurn = childTurns.at(-1);
    const overview = agent.threadId ? transcriptOverview.get(agent.threadId) : undefined;
    const status = latestTurn?.status ?? overview?.status ?? agent.status ?? "waiting";
    const role = agent.role?.trim();
    const text = overview?.text || (role ? `${role} | ${status}` : status);
    const threadId = agent.threadId ?? parentThreadId ?? agent.id;
    const itemId = `agent-overview-${safeId(agent.id)}`;
    const item: WorkbenchItem = {
      id: itemId,
      type: "agentOverview",
      title: agent.name,
      text,
      status,
      agentId: agent.id,
      agentThreadId: agent.threadId,
      agentName: agent.name,
      agentRole: agent.role,
      agentStatus: status,
    };
    return {
      key: `agent-overview:${agent.id}`,
      turnId: overview?.turnId ?? latestTurn?.id ?? `agent-overview-turn-${safeId(agent.id)}`,
      threadId,
      itemIds: [itemId],
      kind: "status",
      role: "system",
      text,
      title: `${index + 1}. ${agent.name}`,
      status,
      item,
      searchText: [agent.name, agent.role, status, text, agent.id, agent.threadId].filter(Boolean).join("\n").toLowerCase(),
      width: "full",
      isLive: isLiveAgentStatus(status),
      startedAt: overview?.updatedAt ?? latestTurn?.startedAt,
      completedAt: latestTurn?.completedAt,
    };
  });
}

function isLiveAgentStatus(status: string): boolean {
  const normalized = status.replace(/[_-]+/g, "").toLowerCase();
  return ["active", "running", "inprogress", "started", "interacted", "pendinginit", "working"].includes(normalized);
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-");
}
