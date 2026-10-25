import { Box, Button, IconButton, Snackbar, Stack, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SettingsIcon from "@mui/icons-material/Settings";
import TabIcon from "@mui/icons-material/Tab";
import type { ComponentProps, Dispatch, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import type { PermissionPresetId } from "@codex-ui/shared";
import { ThemeBackgroundMedia } from "../components/ThemeBackgroundMedia";
import { SystemMetricsTopBarBadge } from "../components/SystemMetricsTopBarBadge";
import { ThreadStatusDot } from "../components/ThreadStatusDot";
import { CliBackendIcon } from "../components/CliBackendIcon";
import { displayThreadTitle } from "../app/threads/threadCatalog";
import { describeCliBackendLabel } from "../app/cli/cliBackendLabels";
import type { SettingsSectionId } from "../settings/SettingsDrawer";
import type { CodexPluginSettingsTab } from "../components/CodexPluginSettingsPanel";
import type { DangerDialogIntent } from "../app/workbench/appConstants";
import type { ClientState, ThreadEntry } from "../state/codexClient";
import type { TranslateFn } from "../i18n";

export interface WorkbenchOverlaysProps {
  t: TranslateFn;
  detachedThreadId: string | null;
  shellBackgroundImage: ComponentProps<typeof ThemeBackgroundMedia>["imageUrl"];
  shellBackgroundVideo: ComponentProps<typeof ThemeBackgroundMedia>["videoUrl"];
  effectiveBackgroundScene: ComponentProps<typeof ThemeBackgroundMedia>["scene"];
  themeTuning: ComponentProps<typeof ThemeBackgroundMedia>["tuning"];
  immersiveView: boolean;
  immersiveHintSequence: number;
  immersiveExitHintOpen: boolean;
  setImmersiveExitHintOpen: Dispatch<SetStateAction<boolean>>;
  immersiveComposerHintOpen: boolean;
  setImmersiveComposerHintOpen: Dispatch<SetStateAction<boolean>>;
  immersiveComposerCompact: boolean;
  connectionStatus: { phase: string };
  immersiveTaskTabsOpen: boolean;
  setImmersiveTaskTabsOpen: Dispatch<SetStateAction<boolean>>;
  openSettings: (section?: SettingsSectionId, pluginTab?: CodexPluginSettingsTab, relayTarget?: { providerId?: string; groupId?: string }) => void;
  state: Pick<ClientState, "token" | "activeThreadId">;
  systemMetricsScope: ComponentProps<typeof SystemMetricsTopBarBadge>["scope"];
  exitImmersiveView: () => void;
  desktopLayout: boolean;
  leftPanelVisible: boolean;
  setLeftPanelVisible: Dispatch<SetStateAction<boolean>>;
  mobileHistoryOpen: boolean;
  setMobileHistoryOpen: Dispatch<SetStateAction<boolean>>;
  taskTabs: ThreadEntry[];
  dangerDialogIntent: DangerDialogIntent | null;
  selectVisibleTaskTab: (threadId: string) => void;
  setTaskTabContextMenu: Dispatch<SetStateAction<{ threadId: string; mouseX: number; mouseY: number } | null>>;
  runningThreadIds: ReadonlySet<string>;
  requestNewSession: (permission: PermissionPresetId) => void;
  permission: PermissionPresetId;
  topBarPinned: boolean;
  topBarOpen: boolean;
  setTopBarOpen: Dispatch<SetStateAction<boolean>>;
  cancelTopBarHide: () => void;
  openTopBar: () => void;
}

export function WorkbenchOverlays({
  t,
  detachedThreadId,
  shellBackgroundImage,
  shellBackgroundVideo,
  effectiveBackgroundScene,
  themeTuning,
  immersiveView,
  immersiveHintSequence,
  immersiveExitHintOpen,
  setImmersiveExitHintOpen,
  immersiveComposerHintOpen,
  setImmersiveComposerHintOpen,
  immersiveComposerCompact,
  connectionStatus,
  immersiveTaskTabsOpen,
  setImmersiveTaskTabsOpen,
  openSettings,
  state,
  systemMetricsScope,
  exitImmersiveView,
  desktopLayout,
  leftPanelVisible,
  setLeftPanelVisible,
  mobileHistoryOpen,
  setMobileHistoryOpen,
  taskTabs,
  dangerDialogIntent,
  selectVisibleTaskTab,
  setTaskTabContextMenu,
  runningThreadIds,
  requestNewSession,
  permission,
  topBarPinned,
  topBarOpen,
  setTopBarOpen,
  cancelTopBarHide,
  openTopBar,
}: WorkbenchOverlaysProps) {
  return (
    <>
      {!detachedThreadId && (shellBackgroundImage || shellBackgroundVideo || effectiveBackgroundScene) && (
        <ThemeBackgroundMedia imageUrl={shellBackgroundImage} videoUrl={shellBackgroundVideo} scene={effectiveBackgroundScene} tuning={themeTuning} />
      )}
      <Box
        data-testid="theme-background-effects"
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          background: (theme: import("@mui/material/styles").Theme) =>
            [
              `radial-gradient(ellipse at top right, ${alpha(themeTuning.toneColor, themeTuning.toneOpacity)}, transparent 68%)`,
              `linear-gradient(135deg, ${alpha(theme.palette.background.default, themeTuning.backgroundOverlayOpacity)}, ${alpha(theme.palette.background.default, Math.max(0, themeTuning.backgroundOverlayOpacity - 0.05))})`
            ].join(", ")
        }}
      />
      {immersiveView && (
        <>
          <Snackbar
            key={`immersive-exit-hint-${immersiveHintSequence}`}
            open={immersiveExitHintOpen}
            autoHideDuration={3600}
            onClose={(_: Event | React.SyntheticEvent<unknown, Event>, reason: import("@mui/material/Snackbar").SnackbarCloseReason) => { if (reason !== "clickaway") setImmersiveExitHintOpen(false); }}
            anchorOrigin={{ vertical: "top", horizontal: "center" }}
            TransitionProps={{ appear: true }}
            sx={{
              zIndex: 30,
              mt: connectionStatus.phase === "connected" ? 1 : 7,
              "& .MuiSnackbarContent-root": {
                minWidth: 0,
                px: 1.5,
                py: 0.75,
                borderRadius: 1.5,
                bgcolor: "rgba(24,24,27,.94)",
                color: "common.white",
                justifyContent: "center",
                animation: "immersiveHintFromTop 240ms cubic-bezier(.2,.8,.2,1)"
              },
              "@keyframes immersiveHintFromTop": {
                "0%": { opacity: 0, transform: "translateY(-16px)" },
                "100%": { opacity: 1, transform: "translateY(0)" }
              }
            }}
            message={t("app.immersiveExitHint")}
          />
          <Snackbar
            key={`immersive-composer-hint-${immersiveHintSequence}`}
            open={immersiveComposerHintOpen && immersiveComposerCompact}
            autoHideDuration={4200}
            onClose={(_: Event | React.SyntheticEvent<unknown, Event>, reason: import("@mui/material/Snackbar").SnackbarCloseReason) => { if (reason !== "clickaway") setImmersiveComposerHintOpen(false); }}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            TransitionProps={{ appear: true }}
            sx={{
              zIndex: 30,
              mb: { xs: 8, sm: 9 },
              "& .MuiSnackbarContent-root": {
                minWidth: 0,
                px: 1.5,
                py: 0.75,
                borderRadius: 1.5,
                bgcolor: "rgba(24,24,27,.94)",
                color: "common.white",
                animation: "immersiveHintFromLeft 260ms cubic-bezier(.2,.8,.2,1)"
              },
              "@keyframes immersiveHintFromLeft": {
                "0%": { opacity: 0, transform: "translateX(-18px)" },
                "100%": { opacity: 1, transform: "translateX(0)" }
              }
            }}
            message={t("app.immersiveComposerHint")}
          />
          <Stack
            data-testid="immersive-left-toolbar"
            spacing={0.75}
            sx={{ position: "fixed", top: 56, left: 10, zIndex: 15, alignItems: "center" }}
          >
            <Tooltip title={immersiveTaskTabsOpen ? t("app.hideHistory") : t("app.taskTabs")} placement="right">
              <IconButton
                data-testid="immersive-task-tabs-toggle"
                aria-label={immersiveTaskTabsOpen ? "Hide immersive task tabs" : "Show immersive task tabs"}
                onClick={() => setImmersiveTaskTabsOpen((open: boolean) => !open)}
                sx={{
                  width: 32, height: 32,
                  color: immersiveTaskTabsOpen ? "primary.contrastText" : "primary.main",
                  bgcolor: immersiveTaskTabsOpen ? "primary.main" : (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.background.paper, 0.9),
                  boxShadow: 4,
                  "&:hover": { bgcolor: immersiveTaskTabsOpen ? "primary.dark" : "action.hover" }
                }}
              >
                <TabIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("settings.title")} placement="right">
              <IconButton
                data-testid="immersive-settings"
                aria-label={t("settings.title")}
                onClick={() => openSettings("codex")}
                sx={{ width: 32, height: 32, color: "primary.main", bgcolor: (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.background.paper, 0.9), boxShadow: 4 }}
              >
                <SettingsIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("app.systemMonitor")} placement="right">
              <Box sx={{ width: 32, height: 32, bgcolor: (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.background.paper, 0.9), borderRadius: 1.5, boxShadow: 4 }}>
                <SystemMetricsTopBarBadge token={state.token ?? undefined} scope={systemMetricsScope} compact />
              </Box>
            </Tooltip>
            <Tooltip title={`${t("app.exitImmersiveView")} · F11`} placement="right">
              <IconButton
                data-testid="immersive-exit-button"
                aria-label={t("app.exitImmersiveView")}
                onClick={exitImmersiveView}
                sx={{ width: 32, height: 32, color: "text.secondary", bgcolor: (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.background.paper, 0.9), boxShadow: 4 }}
              >
                <CloseIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Stack>
          {immersiveTaskTabsOpen && (
            <>
              <Box
                data-testid="immersive-task-tabs-backdrop"
                onClick={() => setImmersiveTaskTabsOpen(false)}
                sx={{ position: "fixed", inset: 0, zIndex: 12, bgcolor: "transparent" }}
              />
              <Box
                data-testid="immersive-task-tabs-overlay"
                role="tablist"
                aria-label="Immersive task tabs"
                onClick={(event: ReactMouseEvent<HTMLDivElement, MouseEvent>) => event.stopPropagation()}
                sx={{
                  position: "fixed", top: 0, left: 50, right: { xs: 0, sm: 0 }, zIndex: 14,
                  height: 38, minWidth: 0, display: "flex", alignItems: "center", gap: 0.5,
                  px: 0.75, overflowX: "auto", overflowY: "hidden",
                  borderBottom: "1px solid", borderColor: "divider", borderRadius: 0,
                  bgcolor: (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.background.paper, 0.96),
                  boxShadow: 8, backdropFilter: "blur(12px)"
                }}
              >
                <Tooltip title={(desktopLayout ? leftPanelVisible : mobileHistoryOpen) ? t("app.hideHistory") : t("app.showHistory")}>
                  <IconButton
                    size="small"
                    aria-label={t("app.showHistory")}
                    onClick={() => { setImmersiveTaskTabsOpen(false); desktopLayout ? setLeftPanelVisible(true) : setMobileHistoryOpen(true); }}
                    sx={{ width: 28, height: 28, flex: "0 0 auto", color: "primary.contrastText", bgcolor: "primary.main", "&:hover": { bgcolor: "primary.dark" } }}
                  >
                    <ArrowDropDownIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {taskTabs.map((thread: ThreadEntry) => {
                  const active = state.activeThreadId === thread.id && dangerDialogIntent?.source !== "new-chat";
                  return (
                    <Button
                      key={thread.id}
                      role="tab"
                      aria-selected={active}
                      onClick={() => { selectVisibleTaskTab(thread.id); setImmersiveTaskTabsOpen(false); }}
                      onContextMenu={(event: ReactMouseEvent<HTMLButtonElement, MouseEvent>) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setTaskTabContextMenu({ threadId: thread.id, mouseX: event.clientX, mouseY: event.clientY });
                      }}
                      startIcon={
                        <Stack component="span" direction="row" spacing={0.5} alignItems="center">
                          <ThreadStatusDot active={active} running={runningThreadIds.has(thread.id)} runningLabel={t("composer.running")} threadId={thread.id} />
                          <CliBackendIcon
                            cliBackend={thread.cliBackend}
                        label={describeCliBackendLabel(thread.cliBackend, t)}
                            size={14}
                          />
                        </Stack>
                      }
                      sx={{
                        minWidth: 0, maxWidth: 220, height: 30, flex: "0 0 auto", px: 1,
                        color: active ? "primary.main" : "text.secondary",
                        bgcolor: active ? "action.selected" : "transparent",
                        border: "1px solid", borderColor: active ? "primary.main" : "transparent",
                        borderRadius: 1, textTransform: "none"
                      }}
                    >
                      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayThreadTitle(thread)}</Box>
                    </Button>
                  );
                })}
                {!detachedThreadId && (
                  <Tooltip title={t("app.newTask")}>
                    <IconButton
                      size="small"
                      aria-label={t("app.newTask")}
                      onClick={() => { setImmersiveTaskTabsOpen(false); requestNewSession(permission); }}
                      sx={{ width: 28, height: 28, flex: "0 0 auto", color: "primary.main" }}
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </>
          )}
        </>
      )}
      {!immersiveView && !topBarPinned && (
        <Box
          data-testid="top-bar-hover-strip"
          role="button"
          tabIndex={0}
          aria-expanded={topBarOpen}
          aria-label={t("topbar.toggleTopBar") || "Toggle top bar"}
          onPointerEnter={(event: ReactPointerEvent<HTMLDivElement>) => {
            if (event.pointerType === "touch") {
              cancelTopBarHide();
              setTopBarOpen((open: boolean) => !open);
            } else {
              openTopBar();
            }
          }}
          onFocus={openTopBar}
          onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              cancelTopBarHide();
              setTopBarOpen((open: boolean) => !open);
            }
          }}
          sx={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: 10,
            zIndex: 1140,
            cursor: "pointer",
            outline: "none",
            background: "transparent",
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 }
          }}
        />
      )}
      {!immersiveView && !topBarPinned && !topBarOpen && (
        <Tooltip title={t("topbar.showTopBar") || "Show top bar"}>
          <IconButton
            size="small"
            aria-label={t("topbar.showTopBar") || "Show top bar"}
            data-testid="topbar-restore-button"
            onClick={openTopBar}
            sx={{
              position: "fixed",
              top: 2,
              right: 8,
              zIndex: 1160,
              width: 26,
              height: 22,
              borderRadius: 1.5,
              bgcolor: "background.paper",
              border: 1,
              borderColor: "divider",
              boxShadow: 1,
              opacity: 0.75,
              "&:hover": { opacity: 1 }
            }}
          >
            <ExpandMoreIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </>
  );
}
