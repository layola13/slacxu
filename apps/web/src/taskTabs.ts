import type { ThreadEntry } from "./state/codexClient";

export type SplitViewState = {
  leftThreadId: string;
  rightThreadId: string;
};

export type LayoutDirection = "horizontal" | "vertical";
export type SplitDirection = "left" | "right" | "up" | "down";

export type WorkspaceLayoutNode =
  | { type: "pane"; paneId: string }
  | { type: "split"; id: string; direction: LayoutDirection; children: WorkspaceLayoutNode[]; sizes: number[] };

export type WorkspacePaneState = { id: string; threadId: string | null };

export type WorkspaceLayoutState = {
  version: 2;
  root: WorkspaceLayoutNode;
  panes: WorkspacePaneState[];
  focusedPaneId: string;
  maximizedPaneId: string | null;
};

export const MAX_WORKSPACE_PANES = 6;

export function paneNode(paneId: string): WorkspaceLayoutNode {
  return { type: "pane", paneId };
}

export function layoutPaneIds(root: WorkspaceLayoutNode): string[] {
  if (root.type === "pane") return [root.paneId];
  return root.children.flatMap(layoutPaneIds);
}

export function normalizeWorkspaceLayout(state: WorkspaceLayoutState): WorkspaceLayoutState {
  const normalizeNode = (node: WorkspaceLayoutNode): WorkspaceLayoutNode => {
    if (node.type === "pane") return node;
    const children = node.children.map(normalizeNode).filter(Boolean);
    if (children.length === 0) return paneNode(state.focusedPaneId);
    if (children.length === 1) return children[0]!;
    const sizes = normalizeSizes(node.sizes, children.length);
    return { ...node, children, sizes };
  };
  const root = normalizeNode(state.root);
  const paneIds = layoutPaneIds(root);
  const panes = state.panes.filter((pane, index) => paneIds.includes(pane.id) && state.panes.findIndex((candidate) => candidate.id === pane.id) === index);
  const focusedPaneId = paneIds.includes(state.focusedPaneId) ? state.focusedPaneId : paneIds[0]!;
  const maximizedPaneId = state.maximizedPaneId && paneIds.includes(state.maximizedPaneId) ? state.maximizedPaneId : null;
  return { ...state, root, panes, focusedPaneId, maximizedPaneId };
}

export function normalizeSizes(sizes: number[], count: number): number[] {
  if (count <= 0) return [];
  const values = Array.from({ length: count }, (_, index) => Number.isFinite(sizes[index]) && sizes[index]! > 0 ? sizes[index]! : 1);
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

export function createWorkspaceLayout(threadIds: string[], layout: "columns" | "rows" | "left-one-right-two" | "left-two-right-one" | "grid-2x2" | "grid-2x3" = "columns"): WorkspaceLayoutState {
  const ids = threadIds.slice(0, MAX_WORKSPACE_PANES);
  const panes = ids.map((threadId, index) => ({ id: `pane-${index + 1}`, threadId }));
  const makeSplit = (direction: LayoutDirection, children: WorkspaceLayoutNode[], id: string): WorkspaceLayoutNode => ({
    type: "split", id, direction, children, sizes: normalizeSizes([], children.length)
  });
  const nodes = panes.map((pane) => paneNode(pane.id));
  let root: WorkspaceLayoutNode = nodes[0] ?? paneNode("pane-1");
  if (layout === "left-one-right-two" && nodes.length >= 3) {
    root = makeSplit("horizontal", [nodes[0]!, makeSplit("vertical", [nodes[1]!, nodes[2]!], "split-right")], "split-root");
  } else if (layout === "left-two-right-one" && nodes.length >= 3) {
    root = makeSplit("horizontal", [makeSplit("vertical", [nodes[0]!, nodes[1]!], "split-left"), nodes[2]!], "split-root");
  } else if (layout === "grid-2x2" && nodes.length >= 4) {
    root = makeSplit("vertical", [makeSplit("horizontal", nodes.slice(0, 2), "split-top"), makeSplit("horizontal", nodes.slice(2, 4), "split-bottom")], "split-root");
  } else if (layout === "grid-2x3" && nodes.length >= 6) {
    root = makeSplit("vertical", [makeSplit("horizontal", nodes.slice(0, 3), "split-top"), makeSplit("horizontal", nodes.slice(3, 6), "split-bottom")], "split-root");
  } else if (layout === "rows") {
    root = makeSplit("vertical", nodes, "split-root");
  } else if (nodes.length > 1) {
    root = makeSplit("horizontal", nodes, "split-root");
  }
  return normalizeWorkspaceLayout({ version: 2, root, panes, focusedPaneId: panes[0]?.id ?? "pane-1", maximizedPaneId: null });
}

export function splitWorkspacePane(state: WorkspaceLayoutState, paneId: string, direction: SplitDirection, newPane: WorkspacePaneState): WorkspaceLayoutState | null {
  if (!layoutPaneIds(state.root).includes(paneId) || layoutPaneIds(state.root).length >= MAX_WORKSPACE_PANES || state.panes.some((pane) => pane.id === newPane.id)) return null;
  const splitDirection: LayoutDirection = direction === "left" || direction === "right" ? "horizontal" : "vertical";
  const insertBefore = direction === "left" || direction === "up";
  let inserted = false;
  const visit = (node: WorkspaceLayoutNode): WorkspaceLayoutNode => {
    if (node.type === "pane") {
      if (node.paneId !== paneId) return node;
      inserted = true;
      const children = insertBefore ? [paneNode(newPane.id), node] : [node, paneNode(newPane.id)];
      return makeWorkspaceSplit(splitDirection, children, `split-${newPane.id}`);
    }
    if (node.direction === splitDirection && node.children.some((child) => child.type === "pane" && child.paneId === paneId)) {
      inserted = true;
      const index = node.children.findIndex((child) => child.type === "pane" && child.paneId === paneId);
      const at = insertBefore ? index : index + 1;
      const children = [...node.children];
      children.splice(at, 0, paneNode(newPane.id));
      return { ...node, children, sizes: normalizeSizes(node.sizes, children.length) };
    }
    return { ...node, children: node.children.map(visit) };
  };
  const root = visit(state.root);
  return inserted ? normalizeWorkspaceLayout({ ...state, root, panes: [...state.panes, newPane], focusedPaneId: newPane.id }) : null;
}

export function closeWorkspacePane(state: WorkspaceLayoutState, paneId: string): WorkspaceLayoutState {
  const remove = (node: WorkspaceLayoutNode): WorkspaceLayoutNode | null => {
    if (node.type === "pane") return node.paneId === paneId ? null : node;
    const children = node.children.map(remove).filter((child): child is WorkspaceLayoutNode => Boolean(child));
    if (children.length === 0) return null;
    if (children.length === 1) return children[0]!;
    return { ...node, children, sizes: normalizeSizes(node.sizes, children.length) };
  };
  const root = remove(state.root) ?? paneNode(state.focusedPaneId);
  const nextPanes = state.panes.filter((pane) => pane.id !== paneId);
  const focusedPaneId = state.focusedPaneId === paneId ? nextPanes[0]?.id ?? "pane-1" : state.focusedPaneId;
  return normalizeWorkspaceLayout({ ...state, root, panes: nextPanes, focusedPaneId, maximizedPaneId: state.maximizedPaneId === paneId ? null : state.maximizedPaneId });
}

export function replaceWorkspacePaneThread(state: WorkspaceLayoutState, paneId: string, threadId: string): WorkspaceLayoutState {
  const target = state.panes.find((pane) => pane.id === paneId);
  if (!target || target.threadId === threadId) return state;
  const existing = state.panes.find((pane) => pane.threadId === threadId);
  const panes = state.panes.map((pane) => {
    if (pane.id === paneId) return { ...pane, threadId };
    if (existing && pane.id === existing.id) return { ...pane, threadId: target.threadId };
    return pane;
  });
  return normalizeWorkspaceLayout({ ...state, panes, focusedPaneId: paneId });
}

export function twoPaneSplitView(state: WorkspaceLayoutState | null): SplitViewState | null {
  if (!state) return null;
  const paneIds = layoutPaneIds(state.root);
  if (paneIds.length !== 2) return null;
  const threadIds = paneIds.map((paneId) => state.panes.find((pane) => pane.id === paneId)?.threadId ?? null);
  return threadIds[0] && threadIds[1] ? { leftThreadId: threadIds[0], rightThreadId: threadIds[1] } : null;
}

export function reconcileWorkspaceLayout(state: WorkspaceLayoutState | null, threadIds: string[]): WorkspaceLayoutState | null {
  if (!state) return null;
  const available = new Set(threadIds);
  if (!state.panes.some((pane) => pane.threadId && available.has(pane.threadId))) return null;
  let next = state;
  for (const pane of state.panes) {
    if ((!pane.threadId || !available.has(pane.threadId)) && next.panes.length > 1) {
      next = closeWorkspacePane(next, pane.id);
    }
  }
  const last = next.panes[0];
  return last && last.threadId && available.has(last.threadId) ? next : null;
}

export function readWorkspaceLayoutState(storage: Pick<Storage, "getItem">, key: string): WorkspaceLayoutState | null {
  try { return parseWorkspaceLayoutState(JSON.parse(storage.getItem(key) ?? "null")); } catch { return null; }
}

export function parseWorkspaceLayoutState(value: unknown): WorkspaceLayoutState | null {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!record || record.version !== 2 || !Array.isArray(record.panes)) return null;
  const panes = record.panes.flatMap((entry) => {
    const pane = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
    return pane && typeof pane.id === "string" && pane.id.trim() && (pane.threadId === null || typeof pane.threadId === "string")
      ? [{ id: pane.id.trim(), threadId: pane.threadId as string | null }] : [];
  });
  if (!panes.length || panes.length > MAX_WORKSPACE_PANES || new Set(panes.map((pane) => pane.id)).size !== panes.length) return null;
  const threadIds = panes.flatMap((pane) => pane.threadId ? [pane.threadId] : []);
  if (new Set(threadIds).size !== threadIds.length) return null;
  const parseNode = (entry: unknown, depth = 0): WorkspaceLayoutNode | null => {
    if (depth > MAX_WORKSPACE_PANES * 2 || !entry || typeof entry !== "object") return null;
    const node = entry as Record<string, unknown>;
    if (node.type === "pane" && typeof node.paneId === "string") return paneNode(node.paneId);
    if (node.type !== "split" || typeof node.id !== "string" || (node.direction !== "horizontal" && node.direction !== "vertical") || !Array.isArray(node.children)) return null;
    const children = node.children.map((child) => parseNode(child, depth + 1));
    if (children.length < 2 || children.some((child) => !child)) return null;
    const sizes = Array.isArray(node.sizes) ? node.sizes.filter((size): size is number => typeof size === "number") : [];
    return { type: "split", id: node.id, direction: node.direction, children: children as WorkspaceLayoutNode[], sizes: normalizeSizes(sizes, children.length) };
  };
  const root = parseNode(record.root);
  if (!root) return null;
  const paneIds = layoutPaneIds(root);
  if (paneIds.length !== panes.length || new Set(paneIds).size !== paneIds.length || paneIds.some((id) => !panes.some((pane) => pane.id === id))) return null;
  const focusedPaneId = typeof record.focusedPaneId === "string" && paneIds.includes(record.focusedPaneId) ? record.focusedPaneId : paneIds[0]!;
  const maximizedPaneId = typeof record.maximizedPaneId === "string" && paneIds.includes(record.maximizedPaneId) ? record.maximizedPaneId : null;
  return normalizeWorkspaceLayout({ version: 2, root, panes, focusedPaneId, maximizedPaneId });
}

function makeWorkspaceSplit(direction: LayoutDirection, children: WorkspaceLayoutNode[], id: string): Extract<WorkspaceLayoutNode, { type: "split" }> {
  return { type: "split", id, direction, children, sizes: normalizeSizes([], children.length) };
}

export function reconcileTaskTabOrder(current: string[], threads: ThreadEntry[]): string[] {
  const available = new Set(threads.map((thread) => thread.id));
  const retained = current.filter((id, index) => available.has(id) && current.indexOf(id) === index);
  const retainedSet = new Set(retained);
  return [...retained, ...threads.map((thread) => thread.id).filter((id) => !retainedSet.has(id))];
}

export function reconcileOpenedTaskTabOrder(current: string[], threads: ThreadEntry[]): string[] {
  const available = new Set(threads.map((thread) => thread.id));
  return current.filter((id, index) => available.has(id) && current.indexOf(id) === index);
}

export function openTaskTab(order: string[], threadId: string): string[] {
  return order.includes(threadId) ? order : [...order, threadId];
}

export function moveTaskTab(order: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId || !order.includes(draggedId) || !order.includes(targetId)) return order;
  const next = order.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex, 0, draggedId);
  return next;
}

export function isTaskTabStripDropTarget(target: EventTarget | null): boolean {
  const candidate = target as { closest?: (selector: string) => unknown } | null;
  return Boolean(candidate && typeof candidate.closest === "function" && candidate.closest('[data-task-tab-strip="true"]'));
}

export function readTaskTabOrder(storage: Pick<Storage, "getItem">, key: string): string[] {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
  } catch {
    return [];
  }
}

export function readSplitViewState(storage: Pick<Storage, "getItem">, key: string): SplitViewState | null {
  try {
    return parseSplitViewState(JSON.parse(storage.getItem(key) ?? "null"));
  } catch {
    return null;
  }
}

export function parseSplitViewState(value: unknown): SplitViewState | null {
  const record = value && typeof value === "object" ? value as Partial<SplitViewState> : null;
  const leftThreadId = typeof record?.leftThreadId === "string" ? record.leftThreadId.trim() : "";
  const rightThreadId = typeof record?.rightThreadId === "string" ? record.rightThreadId.trim() : "";
  return leftThreadId && rightThreadId && leftThreadId !== rightThreadId
    ? { leftThreadId, rightThreadId }
    : null;
}

export function reconcileSplitViewState(
  splitView: SplitViewState | null,
  availableThreadIds: Iterable<string>
): SplitViewState | null {
  if (!splitView) return null;
  const available = new Set(availableThreadIds);
  return available.has(splitView.leftThreadId) && available.has(splitView.rightThreadId)
    ? splitView
    : null;
}

export function reverseSplitView(splitView: SplitViewState): SplitViewState {
  return { leftThreadId: splitView.rightThreadId, rightThreadId: splitView.leftThreadId };
}
