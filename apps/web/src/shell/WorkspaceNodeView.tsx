import type { ReactNode } from "react";
import { Group as PanelGroup, Panel } from "react-resizable-panels";
import { ResizeHandle } from "../components/ResizeHandle";
import { layoutPaneIds, type WorkspaceLayoutNode, type WorkspaceLayoutState } from "../taskTabs";

export interface WorkspaceNodeViewProps {
  node: WorkspaceLayoutNode;
  workspaceLayout: WorkspaceLayoutState | null;
  renderSplitPane: (threadId: string, side: "left" | "right", paneId?: string) => ReactNode;
}

function renderNode(node: WorkspaceLayoutNode, props: Omit<WorkspaceNodeViewProps, "node">): ReactNode {
  const workspaceLayout = props.workspaceLayout;

    if (!workspaceLayout) return null;
    if (workspaceLayout.maximizedPaneId && !layoutPaneIds(node).includes(workspaceLayout.maximizedPaneId)) return null;
    if (node.type === "pane") {
      if (workspaceLayout.maximizedPaneId && node.paneId !== workspaceLayout.maximizedPaneId) return null;
      const pane = workspaceLayout.panes.find((entry) => entry.id === node.paneId);
      if (!pane?.threadId) return null;
      const index = layoutPaneIds(workspaceLayout.root).indexOf(node.paneId);
      return props.renderSplitPane(pane.threadId, index === 0 ? "left" : "right", node.paneId);
    }
    const visibleChildren = workspaceLayout.maximizedPaneId
      ? node.children.filter((child: WorkspaceLayoutNode) => layoutPaneIds(child).includes(workspaceLayout.maximizedPaneId!))
      : node.children;
    if (visibleChildren.length === 1) return renderNode(visibleChildren[0]!, props);
    return (
      <PanelGroup orientation={node.direction} id={`workspace-${node.id}`} style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}>
        {visibleChildren.flatMap((child: WorkspaceLayoutNode, index: number) => [
          <Panel key={`${node.id}-${index}`} id={`${node.id}-${index}`} defaultSize={`${(node.sizes[node.children.indexOf(child)] ?? 1 / visibleChildren.length) * 100}%`} minSize={node.direction === "horizontal" ? "18%" : "20%"} style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            {renderNode(child, props)}
          </Panel>,
          ...(index < visibleChildren.length - 1 ? [<ResizeHandle key={`${node.id}-handle-${index}`} />] : [])
        ])}
      </PanelGroup>
    );
}

export function WorkspaceNodeView(props: WorkspaceNodeViewProps) {
  return renderNode(props.node, props);
}

export interface WorkspaceLayoutViewProps {
  workspaceLayout: WorkspaceLayoutState | null;
  renderSplitPane: (threadId: string, side: "left" | "right", paneId?: string) => ReactNode;
}

export function WorkspaceLayoutView(props: WorkspaceLayoutViewProps) {
  const workspaceLayout = props.workspaceLayout;

    if (!workspaceLayout) return null;
    if (!workspaceLayout.maximizedPaneId) return renderNode(workspaceLayout.root, props);
    const pane = workspaceLayout.panes.find((entry) => entry.id === workspaceLayout.maximizedPaneId);
    if (!pane?.threadId) return renderNode(workspaceLayout.root, props);
    const index = layoutPaneIds(workspaceLayout.root).indexOf(pane.id);
    return props.renderSplitPane(pane.threadId, index === 0 ? "left" : "right", pane.id);
}
