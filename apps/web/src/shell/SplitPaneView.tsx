import { Box, IconButton, Tooltip, Typography, alpha } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import type { Dispatch, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, SetStateAction } from "react";
import type { ThreadEntry } from "../state/codexClient";
import { describeCliBackendLabel } from "../app/cli/cliBackendLabels";
import { CliBackendIcon } from "../components/CliBackendIcon";
import { ThreadStatusDot } from "../components/ThreadStatusDot";
import type { TranslateFn } from "../i18n";
import { displayThreadTitle } from "../app/threads/threadCatalog";
import type { SplitViewState, WorkspaceLayoutState } from "../taskTabs";

export interface SplitPaneViewProps {
  threadId: string;
  side: "left" | "right";
  paneId: string;
  historyThreads: ThreadEntry[];
  state: { activeThreadId: string | null };
  focusSplitThread: (threadId: string) => void;
  workspaceLayout: WorkspaceLayoutState | null;
  setWorkspaceLayout: Dispatch<SetStateAction<WorkspaceLayoutState | null>>;
  setPaneContextMenu: Dispatch<SetStateAction<{ paneId: string; threadId: string; mouseX: number; mouseY: number } | null>>;
  splitView: SplitViewState | null;
  setSplitView: Dispatch<SetStateAction<SplitViewState | null>>;
  closeWorkspacePaneAndCollapse: (paneId: string) => void;
  t: TranslateFn;
  runningThreadIds: Set<string>;
  renderConversation: (threadId: string | null, focused: boolean) => ReactNode;
}

export function SplitPaneView({
  threadId,
  side,
  paneId,
  historyThreads,
  state,
  focusSplitThread,
  workspaceLayout,
  setWorkspaceLayout,
  setPaneContextMenu,
  splitView,
  setSplitView,
  closeWorkspacePaneAndCollapse,
  t,
  runningThreadIds,
  renderConversation,
}: SplitPaneViewProps) {

    const thread = historyThreads.find((entry) => entry.id === threadId);
    const focused = state.activeThreadId === threadId;
    return (
      <Box
        data-testid={paneId === "pane-1" || paneId === "left" ? "split-view-left" : paneId === "pane-2" || paneId === "right" ? "split-view-right" : "workspace-pane"}
        data-pane-id={paneId}
        data-thread-id={threadId}
        data-focused={focused ? "true" : "false"}
        onPointerDown={(_event: ReactPointerEvent<HTMLElement>) => {
          focusSplitThread(threadId);
          if (workspaceLayout && workspaceLayout.focusedPaneId !== paneId) setWorkspaceLayout((current) => current ? { ...current, focusedPaneId: paneId } : current);
        }}
        onContextMenu={(event: ReactMouseEvent<HTMLElement>) => {
          event.preventDefault();
          focusSplitThread(threadId);
          setPaneContextMenu({ paneId, threadId, mouseX: event.clientX, mouseY: event.clientY });
        }}
        sx={{ height: "100%", minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "36px minmax(0, 1fr)" }}
      >
        <Box sx={{
          display: "flex", alignItems: "center", gap: 0.75, px: 1, minWidth: 0,
          borderBottom: "1px solid", borderColor: focused ? "primary.main" : "divider",
          bgcolor: focused ? (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.2 : 0.11) : "background.paper",
          boxShadow: focused ? (theme) => `inset 3px 0 0 ${theme.palette.primary.main}` : "inset 0 0 0 transparent",
          transition: "background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" }
        }}>
          <ThreadStatusDot active={focused} running={runningThreadIds.has(threadId)} runningLabel={t("composer.running")} threadId={threadId} />
          <CliBackendIcon
            cliBackend={thread?.cliBackend}
            label={describeCliBackendLabel(thread?.cliBackend, t)}
            size={14}
          />
          <Typography variant="caption" sx={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {thread ? displayThreadTitle(thread) : threadId}
          </Typography>
          {workspaceLayout && (
            <Tooltip title={t(workspaceLayout.maximizedPaneId === paneId ? "splitView.restorePane" : "splitView.maximizePane")}>
              <IconButton
                size="small"
                aria-label={t(workspaceLayout.maximizedPaneId === paneId ? "splitView.restorePane" : "splitView.maximizePane")}
                onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();
                  setWorkspaceLayout((current) => current
                    ? { ...current, focusedPaneId: paneId, maximizedPaneId: current.maximizedPaneId === paneId ? null : paneId }
                    : current);
                }}
                sx={{ width: 26, height: 26 }}
              >
                {workspaceLayout.maximizedPaneId === paneId
                  ? <CloseFullscreenIcon sx={{ fontSize: 16 }} />
                  : <OpenInFullIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t(side === "left" ? "splitView.closeLeft" : "splitView.closeRight")}>
            <IconButton
              size="small"
              aria-label={t(side === "left" ? "splitView.closeLeft" : "splitView.closeRight")}
              onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                if (workspaceLayout) {
                  closeWorkspacePaneAndCollapse(paneId);
                } else {
                  const keepThreadId = side === "left" ? splitView?.rightThreadId : splitView?.leftThreadId;
                  setSplitView(null);
                  if (keepThreadId) focusSplitThread(keepThreadId);
                }
              }}
              sx={{ width: 26, height: 26 }}
            >
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
        <Box sx={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>{renderConversation(threadId, focused)}</Box>
      </Box>
    );
}
