import { Box, Button, CircularProgress, IconButton, Menu, MenuItem, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CloseIcon from "@mui/icons-material/Close";
import CodeIcon from "@mui/icons-material/Code";
import GroupsIcon from "@mui/icons-material/Groups";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import TerminalIcon from "@mui/icons-material/Terminal";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import type { ChangeEvent as ReactChangeEvent, ComponentProps, Dispatch, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, MutableRefObject, SetStateAction } from "react";
import type { PermissionPresetId } from "@codex-ui/shared";
import { ThreadStatusDot } from "../components/ThreadStatusDot";
import { CliBackendIcon } from "../components/CliBackendIcon";
import { displayThreadTitle, isSshThread, sshThreadTooltip } from "../app/threads/threadCatalog";
import { describeCliBackendLabel } from "../app/cli/cliBackendLabels";
import { createWorkspaceLayout, isTaskTabStripDropTarget, type SplitDirection, type SplitViewState, type WorkspaceLayoutState } from "../taskTabs";
import { formatErrorText } from "../app/workbench/appUtils";
import type { ThemeBackgroundMedia } from "../components/ThemeBackgroundMedia";
import type { SettingsSectionId } from "../settings/SettingsDrawer";
import type { CodexPluginSettingsTab } from "../components/CodexPluginSettingsPanel";
import type { DangerDialogIntent, WorkspaceMode } from "../app/workbench/appConstants";
import type { appReducer } from "../app/appReducer";
import type { ClientState, ThreadEntry } from "../state/codexClient";
import type { TranslateFn } from "../i18n";

type TaskTabMenuState = { threadId: string; mouseX: number; mouseY: number } | null;
type PaneMenuState = { paneId: string; threadId: string; mouseX: number; mouseY: number } | null;
type AnchorPosition = { top: number; left: number } | null;
type WorkspacePreset = "columns" | "rows" | "left-one-right-two" | "left-two-right-one" | "grid-2x2" | "grid-2x3";

export interface WorkbenchTaskTabsProps {
  t: TranslateFn;
  immersiveView: boolean;
  isMobile: boolean;
  topBarPinned: boolean;
  themeTuning: ComponentProps<typeof ThemeBackgroundMedia>["tuning"];
  detachedThreadId: string | null;
  desktopLayout: boolean;
  leftPanelVisible: boolean;
  mobileHistoryOpen: boolean;
  setLeftPanelVisible: Dispatch<SetStateAction<boolean>>;
  setMobileHistoryOpen: Dispatch<SetStateAction<boolean>>;
  taskTabs: ThreadEntry[];
  state: Pick<ClientState, "activeThreadId">;
  dangerDialogIntent: DangerDialogIntent | null;
  runningThreadIds: ReadonlySet<string>;
  taskTabContextMenu: TaskTabMenuState;
  setTaskTabContextMenu: Dispatch<SetStateAction<TaskTabMenuState>>;
  splitDropHandledRef: MutableRefObject<boolean>;
  draggedTaskTabId: string | null;
  setDraggedTaskTabId: Dispatch<SetStateAction<string | null>>;
  moveVisibleTaskTab: (draggedId: string, targetId: string) => void;
  detachTaskTab: (thread: ThreadEntry) => Promise<void>;
  selectVisibleTaskTab: (threadId: string) => void;
  closeTaskTab: (threadId: string) => void;
  closeTaskTabs: (threadIds: string[], preferredThreadId?: string, options?: { skipRemoteClose?: boolean }) => void;
  requestNewSession: (permission: PermissionPresetId) => void;
  permission: PermissionPresetId;
  splitViewMenuAnchor: HTMLElement | null;
  setSplitViewMenuAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  splitViewMenuPosition: AnchorPosition;
  setSplitViewMenuPosition: Dispatch<SetStateAction<AnchorPosition>>;
  splitViewSearch: string;
  setSplitViewSearch: Dispatch<SetStateAction<string>>;
  setSplitViewBaseThreadId: Dispatch<SetStateAction<string | null>>;
  pendingPaneSplit: { paneId: string; direction: SplitDirection } | null;
  setPendingPaneSplit: Dispatch<SetStateAction<{ paneId: string; direction: SplitDirection } | null>>;
  splitViewCandidates: ThreadEntry[];
  splitPaneWithThread: (threadId: string) => Promise<void>;
  splitView: SplitViewState | null;
  workspaceLayout: WorkspaceLayoutState | null;
  setWorkspaceLayout: Dispatch<SetStateAction<WorkspaceLayoutState | null>>;
  separateSplitView: () => void;
  closeSplitSide: (side: "left" | "right") => void;
  reverseCurrentSplitView: () => void;
  applyWorkspacePreset: (preset: WorkspacePreset, count: number) => Promise<void>;
  mainThreads: ThreadEntry[];
  beginSplitView: (threadId: string) => Promise<void>;
  paneContextMenu: PaneMenuState;
  setPaneContextMenu: Dispatch<SetStateAction<PaneMenuState>>;
  closeWorkspacePaneAndCollapse: (paneId: string) => void;
  contextPaneThread: ThreadEntry | null;
  contextPaneRemoteLifecycle: string | null | undefined;
  contextPaneRemoteLifecyclePending: boolean;
  setRemoteThreadMode: (threadId: string, foreground: boolean) => Promise<void>;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  showOpenWithMenu: (event: ReactMouseEvent<HTMLElement>, threadId: string) => void;
  openOfficialWebsite: () => void;
  openSettings: (section?: SettingsSectionId, pluginTab?: CodexPluginSettingsTab, relayTarget?: { providerId?: string; groupId?: string }) => void;
  openWithMenuPosition: AnchorPosition;
  closeOpenWithMenu: () => void;
  openWithAppsLoading: boolean;
  openWithApps: Array<{ id: string; label: string }>;
  openWithTarget: { cwd: string; workspaceMode: WorkspaceMode; sshCommand: string; sshCwd: string } | null;
  openWorkspaceWith: (appId: string) => void;
  setAgentRosterManagerThreadId: Dispatch<SetStateAction<string | null>>;
  openTaskTabs: ThreadEntry[];
  contextTaskTab: ThreadEntry | null | undefined;
  contextRemoteLifecycle: string | null | undefined;
  contextRemoteLifecyclePending: boolean;
  contextTaskTabIndex: number;
}

export function WorkbenchTaskTabs(props: WorkbenchTaskTabsProps) {
  const {
    t,
    immersiveView,
    isMobile,
    topBarPinned,
    themeTuning,
    detachedThreadId,
    desktopLayout,
    leftPanelVisible,
    mobileHistoryOpen,
    setLeftPanelVisible,
    setMobileHistoryOpen,
    taskTabs,
    state,
    dangerDialogIntent,
    runningThreadIds,
    taskTabContextMenu,
    setTaskTabContextMenu,
    splitDropHandledRef,
    draggedTaskTabId,
    setDraggedTaskTabId,
    moveVisibleTaskTab,
    detachTaskTab,
    selectVisibleTaskTab,
    closeTaskTab,
    closeTaskTabs,
    requestNewSession,
    permission,
    splitViewMenuAnchor,
    setSplitViewMenuAnchor,
    splitViewMenuPosition,
    setSplitViewMenuPosition,
    splitViewSearch,
    setSplitViewSearch,
    setSplitViewBaseThreadId,
    pendingPaneSplit,
    setPendingPaneSplit,
    splitViewCandidates,
    splitPaneWithThread,
    splitView,
    workspaceLayout,
    setWorkspaceLayout,
    separateSplitView,
    closeSplitSide,
    reverseCurrentSplitView,
    applyWorkspacePreset,
    mainThreads,
    beginSplitView,
    paneContextMenu,
    setPaneContextMenu,
    closeWorkspacePaneAndCollapse,
    contextPaneThread,
    contextPaneRemoteLifecycle,
    contextPaneRemoteLifecyclePending,
    setRemoteThreadMode,
    dispatch,
    showOpenWithMenu,
    openOfficialWebsite,
    openSettings,
    openWithMenuPosition,
    closeOpenWithMenu,
    openWithAppsLoading,
    openWithApps,
    openWithTarget,
    openWorkspaceWith,
    setAgentRosterManagerThreadId,
    openTaskTabs,
    contextTaskTab,
    contextRemoteLifecycle,
    contextRemoteLifecyclePending,
    contextTaskTabIndex,
  } = props;
  return (
        <Box
          role="tablist"
          data-task-tab-strip="true"
          aria-label={t("app.taskTabs")}
          sx={{
            display: immersiveView || isMobile ? "none" : "grid",
            gridTemplateColumns: "auto minmax(0, 1fr)",
            alignItems: "stretch",
            gap: 0,
            overflow: "hidden",
            overflowY: "hidden",
            pl: { xs: 1, sm: 1.5 },
            pr: { xs: 1, sm: 1.5 },
            position: "relative",
            bgcolor: immersiveView || !topBarPinned ? "transparent" : (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.background.paper, themeTuning.panelSurfaceOpacity),
            borderBottom: immersiveView || !topBarPinned ? 0 : "1px solid",
            borderColor: "divider"
          }}
        >
          {!detachedThreadId && <Tooltip title={(desktopLayout ? leftPanelVisible : mobileHistoryOpen) ? t("app.hideHistory") : t("app.showHistory")}>
            <IconButton
              size="small"
              data-testid="history-toggle-button"
              aria-label={(desktopLayout ? leftPanelVisible : mobileHistoryOpen) ? t("app.hideHistory") : t("app.showHistory")}
              onClick={() => desktopLayout ? setLeftPanelVisible((value: boolean) => !value) : setMobileHistoryOpen((value: boolean) => !value)}
              sx={{
                alignSelf: "center",
                gridColumn: 1,
                width: 30,
                height: 30,
                flex: "0 0 auto",
                zIndex: 3,
                color: "primary.contrastText",
                bgcolor: "primary.main",
                boxShadow: (theme: import("@mui/material/styles").Theme) => `0 2px 8px ${alpha(theme.palette.primary.main, 0.28)}`,
                "&:hover": { bgcolor: "primary.dark" }
              }}
            >
              <ArrowDropDownIcon fontSize="small" />
            </IconButton>
          </Tooltip>}
          <Box sx={{
            gridColumn: 2,
            alignSelf: "end",
            display: "flex",
            minWidth: 0,
            height: 36,
            overflowX: "auto",
            overflowY: "hidden",
            gap: 0,
            px: 0.5,
            pt: 0.5,
            border: 0,
            borderRadius: 0,
            bgcolor: "transparent"
          }}>
          {taskTabs.map((thread: ThreadEntry) => {
            const active = state.activeThreadId === thread.id && dangerDialogIntent?.source !== "new-chat";
            const running = runningThreadIds.has(thread.id);
            return (
              <Box
                key={thread.id}
                role="tab"
                aria-selected={active}
                draggable
                data-testid="task-tab"
                data-thread-id={thread.id}
                onContextMenu={(event: ReactMouseEvent<HTMLDivElement, MouseEvent>) => {
                  event.preventDefault();
                  event.stopPropagation();
                  window.codexUltraDesktop?.claimContextMenu();
                  setTaskTabContextMenu({ threadId: thread.id, mouseX: event.clientX, mouseY: event.clientY });
                }}
                onDragStart={(event: React.DragEvent<HTMLDivElement>) => {
                  splitDropHandledRef.current = false;
                  setDraggedTaskTabId(thread.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", thread.id);
                }}
                onDragOver={(event: React.DragEvent<HTMLDivElement>) => {
                  if (draggedTaskTabId && draggedTaskTabId !== thread.id) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event: React.DragEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  const draggedId = draggedTaskTabId ?? event.dataTransfer.getData("text/plain");
                  if (draggedId) moveVisibleTaskTab(draggedId, thread.id);
                  setDraggedTaskTabId(null);
                }}
                onDragEnd={(event: React.DragEvent<HTMLDivElement>) => {
                  setDraggedTaskTabId(null);
                  if (splitDropHandledRef.current) {
                    splitDropHandledRef.current = false;
                    return;
                  }
                  const dropTarget = event.clientX > 0 && event.clientY > 0
                    ? document.elementFromPoint(event.clientX, event.clientY)
                    : null;
                  if (isTaskTabStripDropTarget(dropTarget)) return;
                  if (detachedThreadId === thread.id) {
                    void window.codexUltraDesktop?.attachTask(thread.id);
                  } else if (!detachedThreadId) {
                    void detachTaskTab(thread);
                  }
                }}
                sx={{
                  my: 0,
                  pl: 0.75,
                  pr: 0.25,
                  // Chrome-style tabs: shrink equally as more tabs open
                  // (down to minWidth), instead of overflowing the strip;
                  // the strip only scrolls once every tab is at minWidth.
                  flex: "1 1 180px",
                  minWidth: 92,
                  maxWidth: 220,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.25,
                  minHeight: 31,
                  borderRadius: "7px 7px 0 0",
                  color: active ? "primary.main" : "text.secondary",
                  bgcolor: active ? "background.paper" : "transparent",
                  border: "1px solid",
                  borderColor: active ? "divider" : "transparent",
                  borderBottomColor: active ? "background.paper" : "transparent",
                  mb: active ? -0.125 : 0,
                  zIndex: active ? 2 : 1,
                  "& + &": { ml: -0.125 },
                  "&:hover": { bgcolor: active ? "background.paper" : "action.hover" },
                  cursor: draggedTaskTabId === thread.id ? "grabbing" : "grab",
                  opacity: draggedTaskTabId === thread.id ? 0.55 : 1
                }}
              >
                <Button
                  size="small"
                  startIcon={
                    <Stack component="span" direction="row" spacing={0.5} alignItems="center">
                      <ThreadStatusDot
                        active={active}
                        running={running}
                        runningLabel={t("composer.running")}
                        threadId={thread.id}
                      />
                      <CliBackendIcon
                        cliBackend={thread.cliBackend}
                        label={describeCliBackendLabel(thread.cliBackend, t)}
                        size={16}
                      />
                      {isSshThread(thread) ? (
                        <Tooltip title={sshThreadTooltip(thread) ?? "SSH"}>
                          <TerminalIcon data-testid="ssh-thread-indicator" aria-label={sshThreadTooltip(thread) ?? "SSH"} sx={{ fontSize: 16 }} />
                        </Tooltip>
                      ) : null}
                    </Stack>
                  }
                  onClick={() => selectVisibleTaskTab(thread.id)}
                  sx={{
                    minWidth: 0,
                    flex: "1 1 auto",
                    overflow: "hidden",
                    px: 0.5,
                    color: "inherit",
                    justifyContent: "flex-start",
                    textTransform: "none",
                    "& .MuiButton-startIcon": { mr: 0.75 }
                  }}
                >
                  <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {displayThreadTitle(thread)}
                  </Box>
                </Button>
                <Tooltip title={t("app.closeTask")}>
                  <IconButton
                    size="small"
                    aria-label={t("app.closeTask")}
                    onClick={(event: ReactMouseEvent<HTMLButtonElement, MouseEvent>) => {
                      event.stopPropagation();
                      if (detachedThreadId === thread.id) {
                        void window.codexUltraDesktop?.attachTask(thread.id);
                      } else {
                        closeTaskTab(thread.id);
                      }
                    }}
                    sx={{ width: 24, height: 24, color: "inherit" }}
                  >
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                {detachedThreadId === thread.id ? (
                  <Tooltip title={t("taskTabs.attach")}>
                    <IconButton
                      size="small"
                      aria-label={t("taskTabs.attach")}
                      onClick={() => void window.codexUltraDesktop?.attachTask(thread.id)}
                      sx={{ width: 24, height: 24, color: "inherit" }}
                    >
                      <KeyboardReturnIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </Box>
            );
          })}
          {!detachedThreadId && <Tooltip title={t("app.newTask")}>
            <Button
              data-testid="new-task-tab-button"
              role="tab" aria-label={t("app.newTask")} aria-selected={state.activeThreadId === null || dangerDialogIntent?.source === "new-chat"}
              size="small" onClick={() => requestNewSession(permission)}
              sx={{ ml: 0.5, mb: 0.5, px: 0, minWidth: 30, width: 30, height: 30, flex: "0 0 auto", position: "sticky", right: 0, zIndex: 3, borderRadius: "50%", color: (state.activeThreadId === null || dangerDialogIntent?.source === "new-chat") ? "primary.main" : "text.secondary", bgcolor: "transparent", border: 0, "&:hover": { bgcolor: "action.hover" } }}
            ><AddIcon fontSize="small" /></Button>
          </Tooltip>}
          </Box>
          <Menu
            anchorEl={splitViewMenuAnchor}
            anchorReference={splitViewMenuPosition ? "anchorPosition" : "anchorEl"}
            anchorPosition={splitViewMenuPosition ?? undefined}
            open={Boolean(splitViewMenuAnchor || splitViewMenuPosition)}
            onClose={() => { setSplitViewMenuAnchor(null); setSplitViewMenuPosition(null); setSplitViewSearch(""); setSplitViewBaseThreadId(null); setPendingPaneSplit(null); }}
            MenuListProps={{ sx: { width: 360, maxWidth: "calc(100vw - 24px)", maxHeight: 520 } }}
          >
            {pendingPaneSplit ? [
              <Box key="search" sx={{ px: 1, pt: 0.5, pb: 1 }}>
                <TextField autoFocus fullWidth size="small" value={splitViewSearch} placeholder={t("splitView.search")} inputProps={{ "aria-label": t("splitView.search") }} onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => event.stopPropagation()} onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement, Element>) => setSplitViewSearch(event.target.value)} />
              </Box>,
              ...splitViewCandidates.slice(0, 40).map((thread: ThreadEntry) => (
                <MenuItem key={thread.id} onClick={() => { void splitPaneWithThread(thread.id); }}>
                  <ThreadStatusDot active={false} running={runningThreadIds.has(thread.id)} runningLabel={t("composer.running")} threadId={thread.id} />
                  {isSshThread(thread) ? <Tooltip title={sshThreadTooltip(thread) ?? "SSH"}><TerminalIcon data-testid="ssh-thread-indicator" color="primary" sx={{ ml: 1, fontSize: 17 }} /></Tooltip> : null}
                  <Box sx={{ ml: 1, minWidth: 0 }}><Typography variant="body2" noWrap sx={{ fontWeight: runningThreadIds.has(thread.id) ? 800 : 600 }}>{displayThreadTitle(thread)}</Typography></Box>
                </MenuItem>
              )),
              ...(splitViewCandidates.length === 0 ? [<MenuItem key="empty" disabled>{t("splitView.noMatches")}</MenuItem>] : [])
            ] : (splitView || workspaceLayout) ? [
              <MenuItem key="separate" onClick={() => { separateSplitView(); setSplitViewMenuAnchor(null); setSplitViewMenuPosition(null); }}>{t("splitView.separate")}</MenuItem>,
              <MenuItem key="close-left" disabled={!splitView} onClick={() => { closeSplitSide("left"); setSplitViewMenuAnchor(null); setSplitViewMenuPosition(null); }}>{t("splitView.closeLeft")}</MenuItem>,
              <MenuItem key="close-right" disabled={!splitView} onClick={() => { closeSplitSide("right"); setSplitViewMenuAnchor(null); setSplitViewMenuPosition(null); }}>{t("splitView.closeRight")}</MenuItem>,
              <MenuItem key="reverse" disabled={!splitView} onClick={() => { reverseCurrentSplitView(); setSplitViewMenuAnchor(null); setSplitViewMenuPosition(null); }}><SwapHorizIcon fontSize="small" sx={{ mr: 1 }} />{t("splitView.reverse")}</MenuItem>,
              <MenuItem key="preset-columns" disabled={mainThreads.length < 2} onClick={() => void applyWorkspacePreset("columns", 2)}>{t("splitView.presetColumns")}</MenuItem>,
              <MenuItem key="preset-rows" disabled={mainThreads.length < 2} onClick={() => void applyWorkspacePreset("rows", 2)}>{t("splitView.presetRows")}</MenuItem>,
              <MenuItem key="preset-left-one" disabled={mainThreads.length < 3} onClick={() => void applyWorkspacePreset("left-one-right-two", 3)}>{t("splitView.presetLeftOne")}</MenuItem>,
              <MenuItem key="preset-left-two" disabled={mainThreads.length < 3} onClick={() => void applyWorkspacePreset("left-two-right-one", 3)}>{t("splitView.presetLeftTwo")}</MenuItem>,
              <MenuItem key="preset-grid-four" disabled={mainThreads.length < 4} onClick={() => void applyWorkspacePreset("grid-2x2", 4)}>{t("splitView.presetGridFour")}</MenuItem>,
              <MenuItem key="preset-grid-six" disabled={mainThreads.length < 6} onClick={() => void applyWorkspacePreset("grid-2x3", 6)}>{t("splitView.presetGridSix")}</MenuItem>
            ] : [
              <Box key="search" sx={{ px: 1, pt: 0.5, pb: 1 }}>
                <TextField
                  autoFocus
                  fullWidth
                  size="small"
                  value={splitViewSearch}
                  placeholder={t("splitView.search")}
                  inputProps={{ "aria-label": t("splitView.search") }}
                  onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => event.stopPropagation()}
                  onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement, Element>) => setSplitViewSearch(event.target.value)}
                />
              </Box>,
              ...splitViewCandidates.slice(0, 40).map((thread: ThreadEntry) => (
                <MenuItem key={thread.id} onClick={() => { void (pendingPaneSplit ? splitPaneWithThread(thread.id) : beginSplitView(thread.id)); setSplitViewMenuAnchor(null); }}>
                  <ThreadStatusDot
                    active={state.activeThreadId === thread.id}
                    running={runningThreadIds.has(thread.id)}
                    runningLabel={t("composer.running")}
                    threadId={thread.id}
                  />
                  {isSshThread(thread) ? <Tooltip title={sshThreadTooltip(thread) ?? "SSH"}><TerminalIcon data-testid="ssh-thread-indicator" color="primary" sx={{ ml: 1, fontSize: 17 }} /></Tooltip> : null}
                  <Box sx={{ ml: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: runningThreadIds.has(thread.id) ? 800 : 600 }}>
                      {displayThreadTitle(thread)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                      {runningThreadIds.has(thread.id) ? t("composer.running") : thread.preview ?? thread.cwd ?? thread.id}
                    </Typography>
                  </Box>
                </MenuItem>
              )),
              ...(splitViewCandidates.length === 0 ? [
                <MenuItem key="empty" disabled>{t("splitView.noMatches")}</MenuItem>
              ] : [])
            ]}
          </Menu>
          <Menu
            open={Boolean(paneContextMenu)}
            onClose={() => setPaneContextMenu(null)}
            anchorReference="anchorPosition"
            anchorPosition={paneContextMenu ? { top: paneContextMenu.mouseY, left: paneContextMenu.mouseX } : undefined}
          >
            <MenuItem disabled={(workspaceLayout?.panes.length ?? 1) >= 6} onClick={() => { if (paneContextMenu) { setPendingPaneSplit({ paneId: paneContextMenu.paneId, direction: "left" }); setSplitViewBaseThreadId(paneContextMenu.threadId); setSplitViewMenuPosition({ top: paneContextMenu.mouseY, left: paneContextMenu.mouseX }); setSplitViewMenuAnchor(null); setPaneContextMenu(null); } }}>{t("splitView.splitLeft")}</MenuItem>
            <MenuItem disabled={(workspaceLayout?.panes.length ?? 1) >= 6} onClick={() => { if (paneContextMenu) { setPendingPaneSplit({ paneId: paneContextMenu.paneId, direction: "right" }); setSplitViewBaseThreadId(paneContextMenu.threadId); setSplitViewMenuPosition({ top: paneContextMenu.mouseY, left: paneContextMenu.mouseX }); setSplitViewMenuAnchor(null); setPaneContextMenu(null); } }}>{t("splitView.splitRight")}</MenuItem>
            <MenuItem disabled={(workspaceLayout?.panes.length ?? 1) >= 6} onClick={() => { if (paneContextMenu) { setPendingPaneSplit({ paneId: paneContextMenu.paneId, direction: "up" }); setSplitViewBaseThreadId(paneContextMenu.threadId); setSplitViewMenuPosition({ top: paneContextMenu.mouseY, left: paneContextMenu.mouseX }); setSplitViewMenuAnchor(null); setPaneContextMenu(null); } }}>{t("splitView.splitUp")}</MenuItem>
            <MenuItem disabled={(workspaceLayout?.panes.length ?? 1) >= 6} onClick={() => { if (paneContextMenu) { setPendingPaneSplit({ paneId: paneContextMenu.paneId, direction: "down" }); setSplitViewBaseThreadId(paneContextMenu.threadId); setSplitViewMenuPosition({ top: paneContextMenu.mouseY, left: paneContextMenu.mouseX }); setSplitViewMenuAnchor(null); setPaneContextMenu(null); } }}>{t("splitView.splitDown")}</MenuItem>
            <MenuItem disabled={!workspaceLayout} onClick={() => { if (paneContextMenu && workspaceLayout) setWorkspaceLayout({ ...workspaceLayout, maximizedPaneId: workspaceLayout.maximizedPaneId === paneContextMenu.paneId ? null : paneContextMenu.paneId }); setPaneContextMenu(null); }}>{t(workspaceLayout?.maximizedPaneId === paneContextMenu?.paneId ? "splitView.restorePane" : "splitView.maximizePane")}</MenuItem>
            <MenuItem disabled={!workspaceLayout || workspaceLayout.panes.length <= 1} onClick={() => { if (paneContextMenu) closeWorkspacePaneAndCollapse(paneContextMenu.paneId); setPaneContextMenu(null); }}>{t("splitView.closePane")}</MenuItem>
            {contextPaneThread?.remoteExecutionMode === "autonomous" && contextPaneRemoteLifecycle !== "background" && <MenuItem
              disabled={contextPaneRemoteLifecyclePending}
              onClick={() => {
                const pane = paneContextMenu;
                if (pane) {
                  void setRemoteThreadMode(pane.threadId, false).then(() => closeWorkspacePaneAndCollapse(pane.paneId)).catch((error: unknown) => dispatch({ type: "error", message: formatErrorText(error) }));
                }
                setPaneContextMenu(null);
              }}
            >
              {contextPaneRemoteLifecyclePending && <CircularProgress size={16} sx={{ mr: 1 }} />}
              {t("taskTabs.background")}
            </MenuItem>}
            {contextPaneThread?.remoteExecutionMode === "autonomous" && contextPaneRemoteLifecycle === "background" && <MenuItem
              disabled={contextPaneRemoteLifecyclePending}
              onClick={() => {
                const threadId = paneContextMenu?.threadId;
                if (threadId) void setRemoteThreadMode(threadId, true).catch((error: unknown) => dispatch({ type: "error", message: formatErrorText(error) }));
                setPaneContextMenu(null);
              }}
            >
              {contextPaneRemoteLifecyclePending && <CircularProgress size={16} sx={{ mr: 1 }} />}
              {t("taskTabs.foreground")}
            </MenuItem>}
            <MenuItem onClick={(event: ReactMouseEvent<HTMLLIElement, MouseEvent>) => { if (paneContextMenu) showOpenWithMenu(event, paneContextMenu.threadId); }}><CodeIcon fontSize="small" sx={{ mr: 1, color: "#23a8f2" }} />Open with…</MenuItem>
            <MenuItem onClick={() => { openOfficialWebsite(); setPaneContextMenu(null); }}>
              <OpenInNewIcon fontSize="small" sx={{ mr: 1 }} />
              官方网站
            </MenuItem>
            <MenuItem onClick={() => { openSettings("about"); setPaneContextMenu(null); }}>
              {t("settings.nav.about")}
            </MenuItem>
          </Menu>
          <Menu
            open={Boolean(openWithMenuPosition)}
            onClose={closeOpenWithMenu}
            anchorReference="anchorPosition"
            anchorPosition={openWithMenuPosition ?? undefined}
            MenuListProps={{ "aria-label": "Open with applications" }}
          >
            {openWithAppsLoading ? <MenuItem disabled>Detecting installed applications…</MenuItem> : null}
            {!openWithAppsLoading && !window.codexUltraDesktop ? <MenuItem disabled>Available in the desktop app</MenuItem> : null}
            {!openWithAppsLoading && window.codexUltraDesktop && openWithApps.length === 0 ? <MenuItem disabled>No supported applications detected</MenuItem> : null}
            {!openWithAppsLoading && openWithApps
              .filter((app: { id: string; label: string; }) => openWithTarget?.workspaceMode !== "ssh" || app.id === "vscode" || app.id === "vscode-insiders" || app.id === "terminal")
              .map((app: { id: string; label: string; }) => (
                <MenuItem key={app.id} onClick={() => { openWorkspaceWith(app.id); closeOpenWithMenu(); setPaneContextMenu(null); setTaskTabContextMenu(null); }}>
                  {app.id === "terminal" ? <TerminalIcon fontSize="small" sx={{ mr: 1 }} /> : <CodeIcon fontSize="small" sx={{ mr: 1, color: app.id.startsWith("vscode") ? "#23a8f2" : undefined }} />}
                  {app.label}
                </MenuItem>
              ))}
          </Menu>
          <Menu
            open={Boolean(taskTabContextMenu)}
            onClose={() => setTaskTabContextMenu(null)}
            anchorReference="anchorPosition"
            anchorPosition={taskTabContextMenu ? { top: taskTabContextMenu.mouseY, left: taskTabContextMenu.mouseX } : undefined}
          >
            {(["left", "right", "up", "down"] as const).map((direction: "left" | "right" | "up" | "down") => (
              <MenuItem
                key={`tab-split-${direction}`}
                disabled={!taskTabContextMenu || !desktopLayout || mainThreads.length < 2 || (workspaceLayout?.panes.length ?? 1) >= 6}
                onClick={() => {
                  if (taskTabContextMenu) {
                    const existingPane = workspaceLayout?.panes.find((pane: import("../taskTabs").WorkspacePaneState) => pane.threadId === taskTabContextMenu.threadId);
                    const baseLayout = workspaceLayout ?? createWorkspaceLayout([taskTabContextMenu.threadId], "columns");
                    setPendingPaneSplit({ paneId: existingPane?.id ?? baseLayout.focusedPaneId, direction });
                    setSplitViewBaseThreadId(taskTabContextMenu.threadId);
                    setSplitViewMenuPosition({ top: taskTabContextMenu.mouseY, left: taskTabContextMenu.mouseX });
                  }
                  setTaskTabContextMenu(null);
                }}
              >
                {t(`splitView.split${direction[0]!.toUpperCase()}${direction.slice(1)}`)}
              </MenuItem>
            ))}
            {!splitView ? (
              <MenuItem
                disabled={!taskTabContextMenu || mainThreads.length < 2 || !desktopLayout}
                onClick={() => {
                  if (taskTabContextMenu) {
                    setSplitViewBaseThreadId(taskTabContextMenu.threadId);
                    setSplitViewMenuAnchor(null);
                    setSplitViewMenuPosition({ top: taskTabContextMenu.mouseY, left: taskTabContextMenu.mouseX });
                  }
                  setTaskTabContextMenu(null);
                }}
              >
                <ViewColumnIcon fontSize="small" sx={{ mr: 1 }} />
                {t("splitView.addTab")}
              </MenuItem>
            ) : [
              <MenuItem key="split-separate" onClick={() => { separateSplitView(); setTaskTabContextMenu(null); }}>{t("splitView.separate")}</MenuItem>,
              <MenuItem key="split-close-left" onClick={() => { closeSplitSide("left"); setTaskTabContextMenu(null); }}>{t("splitView.closeLeft")}</MenuItem>,
              <MenuItem key="split-close-right" onClick={() => { closeSplitSide("right"); setTaskTabContextMenu(null); }}>{t("splitView.closeRight")}</MenuItem>,
              <MenuItem key="split-reverse" onClick={() => { reverseCurrentSplitView(); setTaskTabContextMenu(null); }}><SwapHorizIcon fontSize="small" sx={{ mr: 1 }} />{t("splitView.reverse")}</MenuItem>
            ]}
            <MenuItem
              disabled={!taskTabContextMenu}
              onClick={() => {
                setAgentRosterManagerThreadId(taskTabContextMenu?.threadId ?? null);
                setTaskTabContextMenu(null);
              }}
            >
              <GroupsIcon fontSize="small" sx={{ mr: 1 }} />
              管理协作成员
            </MenuItem>
            <MenuItem
              disabled={!taskTabContextMenu || !window.codexUltraDesktop}
              onClick={() => {
                const thread = taskTabContextMenu ? openTaskTabs.find((entry: ThreadEntry) => entry.id === taskTabContextMenu.threadId) : null;
                if (thread) void detachTaskTab(thread);
                setTaskTabContextMenu(null);
              }}
            >
              <OpenInNewIcon fontSize="small" sx={{ mr: 1 }} />
              {t("taskTabs.detach")}
            </MenuItem>
            {contextTaskTab?.remoteExecutionMode === "autonomous" && contextRemoteLifecycle !== "background" && <MenuItem
              disabled={contextRemoteLifecyclePending}
              onClick={() => {
                const threadId = taskTabContextMenu?.threadId;
                if (threadId) void setRemoteThreadMode(threadId, false).then(() => closeTaskTabs([threadId], undefined, { skipRemoteClose: true })).catch((error: unknown) => dispatch({ type: "error", message: formatErrorText(error) }));
                setTaskTabContextMenu(null);
              }}
            >
              {contextRemoteLifecyclePending && <CircularProgress size={16} sx={{ mr: 1 }} />}
              {t("taskTabs.background")}
            </MenuItem>}
            {contextTaskTab?.remoteExecutionMode === "autonomous" && contextRemoteLifecycle === "background" && <MenuItem
              disabled={contextRemoteLifecyclePending}
              onClick={() => {
                const threadId = taskTabContextMenu?.threadId;
                if (threadId) void setRemoteThreadMode(threadId, true).catch((error: unknown) => dispatch({ type: "error", message: formatErrorText(error) }));
                setTaskTabContextMenu(null);
              }}
            >
              {contextRemoteLifecyclePending && <CircularProgress size={16} sx={{ mr: 1 }} />}
              {t("taskTabs.foreground")}
            </MenuItem>}
            <MenuItem
              onClick={() => {
                openOfficialWebsite();
                setTaskTabContextMenu(null);
              }}
            >
              <OpenInNewIcon fontSize="small" sx={{ mr: 1 }} />
              官方网站
            </MenuItem>
            <MenuItem onClick={(event: ReactMouseEvent<HTMLLIElement, MouseEvent>) => { if (taskTabContextMenu) showOpenWithMenu(event, taskTabContextMenu.threadId); }}><CodeIcon fontSize="small" sx={{ mr: 1, color: "#23a8f2" }} />Open with…</MenuItem>
            <MenuItem onClick={() => { openSettings("about"); setTaskTabContextMenu(null); }}>
              {t("settings.nav.about")}
            </MenuItem>
            <MenuItem
              onClick={() => {
                if (taskTabContextMenu) closeTaskTab(taskTabContextMenu.threadId);
                setTaskTabContextMenu(null);
              }}
            >
              {t("taskTabs.close")}
            </MenuItem>
            <MenuItem
              disabled={openTaskTabs.length <= 1}
              onClick={() => {
                if (taskTabContextMenu) {
                  closeTaskTabs(openTaskTabs.filter((thread: ThreadEntry) => thread.id !== taskTabContextMenu.threadId).map((thread: ThreadEntry) => thread.id), taskTabContextMenu.threadId);
                }
                setTaskTabContextMenu(null);
              }}
            >
              {t("taskTabs.closeOthers")}
            </MenuItem>
            <MenuItem
              disabled={contextTaskTabIndex < 0 || contextTaskTabIndex >= openTaskTabs.length - 1}
              onClick={() => {
                if (taskTabContextMenu && contextTaskTabIndex >= 0) {
                  closeTaskTabs(openTaskTabs.slice(contextTaskTabIndex + 1).map((thread: ThreadEntry) => thread.id), taskTabContextMenu.threadId);
                }
                setTaskTabContextMenu(null);
              }}
            >
              {t("taskTabs.closeRight")}
            </MenuItem>
            <MenuItem
              disabled={!openTaskTabs.some((thread: ThreadEntry) => thread.id !== state.activeThreadId && !runningThreadIds.has(thread.id))}
              onClick={() => {
                closeTaskTabs(openTaskTabs
                  .filter((thread: ThreadEntry) => thread.id !== state.activeThreadId && !runningThreadIds.has(thread.id))
                  .map((thread: ThreadEntry) => thread.id));
                setTaskTabContextMenu(null);
              }}
            >
              {t("taskTabs.hideInactive")}
            </MenuItem>
          </Menu>
        </Box>
  );
}
