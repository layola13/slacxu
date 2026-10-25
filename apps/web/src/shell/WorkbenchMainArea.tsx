import { Box, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import { Group as PanelGroup, Panel } from "react-resizable-panels";
import type { ComponentProps, Dispatch, MutableRefObject, ReactNode, SetStateAction } from "react";
import { ResizeHandle } from "../components/ResizeHandle";
import type { ThemeBackgroundMedia } from "../components/ThemeBackgroundMedia";
import type { TranslateFn } from "../i18n";

export interface WorkbenchMainAreaProps {
  t: TranslateFn;
  immersiveView: boolean;
  isMobile: boolean;
  topBarPinned: boolean;
  themeTuning: ComponentProps<typeof ThemeBackgroundMedia>["tuning"];
  children: ReactNode;
  draggedTaskTabId: string | null;
  detachedThreadId: string | null;
  desktopLayout: boolean;
  splitDropHandledRef: MutableRefObject<boolean>;
  setDraggedTaskTabId: Dispatch<SetStateAction<string | null>>;
  placeTaskInSplitSide: (threadId: string, side: "left" | "right") => Promise<void>;
  rightWorkspaceVisible: boolean;
  panelLayout: Record<string, number> | undefined;
  setPanelLayout: Dispatch<SetStateAction<Record<string, number> | undefined>>;
  renderCenterPanel: () => ReactNode;
  renderRightWorkspacePanel: () => ReactNode;
}

export function WorkbenchMainArea({
  t,
  immersiveView,
  isMobile,
  topBarPinned,
  themeTuning,
  children,
  draggedTaskTabId,
  detachedThreadId,
  desktopLayout,
  splitDropHandledRef,
  setDraggedTaskTabId,
  placeTaskInSplitSide,
  rightWorkspaceVisible,
  panelLayout,
  setPanelLayout,
  renderCenterPanel,
  renderRightWorkspacePanel,
}: WorkbenchMainAreaProps) {
  return (
      <Box
        sx={{
          gridRow: immersiveView ? 1 : 2,
          minHeight: 0,
          minWidth: 0,
          width: "100%",
          maxWidth: "100%",
          overflow: "hidden",
          display: immersiveView || isMobile ? "flex" : "grid",
          flexDirection: "column",
          gridTemplateRows: immersiveView || isMobile ? "minmax(0, 1fr)" : "42px minmax(0, 1fr)",
          border: 0,
          borderRadius: immersiveView || !topBarPinned ? 0 : { xs: 2, sm: 3 },
          borderTopLeftRadius: immersiveView || !topBarPinned ? 0 : undefined,
          borderTopRightRadius: immersiveView || !topBarPinned ? 0 : undefined,
          bgcolor: (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.background.paper, themeTuning.workspaceSurfaceOpacity),
          boxShadow: immersiveView || !topBarPinned ? "none" : (theme: import("@mui/material/styles").Theme) => theme.customShadows?.card,
          zIndex: 1,
          position: "relative"
        }}
        data-testid="workbench-shell"
      >
        {children}
        {draggedTaskTabId && !detachedThreadId && desktopLayout && (
          <Box
            data-testid="split-view-drop-zones"
            sx={{ position: "absolute", inset: "42px 0 0", zIndex: 20, display: "grid", gridTemplateColumns: "1fr 1fr", pointerEvents: "none" }}
          >
            {(["left", "right"] as const).map((side: "left" | "right") => (
              <Box
                key={side}
                data-task-tab-strip="true"
                data-testid={`split-view-drop-${side}`}
                onDragOver={(event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                onDrop={(event: React.DragEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  const threadId = draggedTaskTabId ?? event.dataTransfer.getData("text/plain");
                  splitDropHandledRef.current = true;
                  setDraggedTaskTabId(null);
                  if (threadId) void placeTaskInSplitSide(threadId, side);
                }}
                sx={{
                  pointerEvents: "auto", m: 1, border: "2px dashed", borderColor: "primary.main", borderRadius: 1,
                  bgcolor: (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.primary.main, 0.12), display: "grid", placeItems: "center"
                }}
              >
                <Stack spacing={0.75} alignItems="center" sx={{ color: "primary.main", pointerEvents: "none" }}>
                  <ViewColumnIcon />
                  <Typography variant="caption" sx={{ fontWeight: 850 }}>{t(side === "left" ? "splitView.dropLeft" : "splitView.dropRight")}</Typography>
                </Stack>
              </Box>
            ))}
          </Box>
        )}
        <Box sx={{ height: immersiveView ? "auto" : "100%", minHeight: 0, minWidth: 0, flex: immersiveView ? "1 1 0" : undefined, overflow: desktopLayout ? "hidden" : "auto" }}>
        {desktopLayout ? (
          <Box sx={{ height: "100%", minHeight: 0, width: "100%" }}>
          <PanelGroup
            key={rightWorkspaceVisible ? "chat-with-workspace" : "chat-only"}
            orientation="horizontal"
            id="codex-react-ui-workbench-panels"
            defaultLayout={rightWorkspaceVisible ? panelLayout : undefined}
            onLayoutChanged={(layout: import("react-resizable-panels").Layout, meta: import("react-resizable-panels").LayoutChangedMeta) => {
              if (!meta.isUserInteraction) {
                return;
              }
              setPanelLayout(layout);
            }}
          >
            <Panel
              id="chat"
              defaultSize={rightWorkspaceVisible ? "68%" : "100%"}
              minSize="28%"
              style={{ minWidth: 0, minHeight: 0, height: "100%", overflow: "hidden" }}
            >
              {renderCenterPanel()}
            </Panel>
            {rightWorkspaceVisible && (
              <>
                <ResizeHandle />
                <Panel id="right-workspace" defaultSize="32%" minSize="24%" maxSize="56%" style={{ minWidth: 0, minHeight: 0, height: "100%", overflow: "hidden" }}>
                  {renderRightWorkspacePanel()}
                </Panel>
              </>
            )}
          </PanelGroup>
          </Box>
        ) : (
          <Box sx={{ height: "100%", minHeight: 0, overflow: "hidden" }}>
            {renderCenterPanel()}
          </Box>
        )}
        </Box>
      </Box>
  );
}
