import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography, alpha } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ChecklistIcon from "@mui/icons-material/Checklist";
import FlagIcon from "@mui/icons-material/Flag";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import type { ChangeEvent as ReactChangeEvent, Dispatch, ReactNode, SetStateAction } from "react";
import type { CliBackend } from "@codex-ui/shared";
import { DEFAULT_CLI_BACKEND } from "../app/cli/cliPlugins";
import type { GoalResumePrompt } from "../app/goals/useGoalLifecycle";
import type { PlanImplementationPrompt, WorkspaceMode } from "../app/workbench/appConstants";
import { CliBackendPicker } from "../components/CliBackendPicker";
import { RecentWorkspacesControl } from "../components/RecentWorkspacesControl";
import type { ChatTypographyPreference } from "../chatTypography";
import type { TranslateFn } from "../i18n";
import type { ClientState } from "../state/codexClient";
import type { RecentWorkspaceItem } from "../utils/recentWorkspaces";
import { shouldShowWorkspaceSelectionPanel } from "../workspaceSelectionVisibility";
import type { WorkspaceLayoutState } from "../taskTabs";

export interface CenterPanelViewProps {
  chatTypography: ChatTypographyPreference;
  immersiveView: boolean;
  themeTuning: { workspaceSurfaceOpacity: number };
  state: ClientState;
  t: TranslateFn;
  workspaceSelectionPending: boolean;
  newChatSetupDialogOpen: boolean;
  dangerDialogIntent: { source: string } | null;
  windowsWorkspaceHost: boolean;
  cwd: string;
  setCwd: Dispatch<SetStateAction<string>>;
  workspaceSetupBusy: boolean;
  openWorkspacePicker: (purpose?: "primary" | "additional", modeOverride?: WorkspaceMode) => void;
  confirmWorkspaceSelection: (modeOverride?: WorkspaceMode) => Promise<void>;
  runtimeSelection: { cliBackend?: CliBackend | null };
  handleNewConversationCliBackend: (backend: CliBackend) => void;
  codexCliEnabled: boolean;
  claudeCliEnabled: boolean;
  agyCliEnabled: boolean;
  auggieCliEnabled: boolean;
  clineCliEnabled: boolean;
  commandCodeCliEnabled: boolean;
  grokCliEnabled: boolean;
  museCliEnabled: boolean;
  piCliEnabled: boolean;
  opencodeCliEnabled: boolean;
  opencodeV2CliEnabled: boolean;
  handleSelectRecentWorkspace: (item: RecentWorkspaceItem) => void;
  workspaceLayout: WorkspaceLayoutState | null;
  desktopLayout: boolean;
  renderWorkspaceLayout: () => ReactNode;
  renderConversation: (threadId: string | null, focused: boolean) => ReactNode;
  planImplementationPrompt: PlanImplementationPrompt | null;
  stayInPlanMode: () => void;
  implementApprovedPlan: () => Promise<void>;
  goalResumePrompt: GoalResumePrompt | null;
  goalResumeSubmitting: boolean;
  pauseGoalResume: () => Promise<void>;
  confirmGoalResume: () => Promise<void>;
  themeMode: string;
  renderComposerDock: (official?: boolean) => ReactNode;
}

export function CenterPanelView({
  chatTypography,
  immersiveView,
  themeTuning,
  state,
  t,
  workspaceSelectionPending,
  newChatSetupDialogOpen,
  dangerDialogIntent,
  windowsWorkspaceHost,
  cwd,
  setCwd,
  workspaceSetupBusy,
  openWorkspacePicker,
  confirmWorkspaceSelection,
  runtimeSelection,
  handleNewConversationCliBackend,
  codexCliEnabled,
  claudeCliEnabled,
  agyCliEnabled,
  auggieCliEnabled,
  clineCliEnabled,
  commandCodeCliEnabled,
  grokCliEnabled,
  museCliEnabled,
  piCliEnabled,
  opencodeCliEnabled,
  opencodeV2CliEnabled,
  handleSelectRecentWorkspace,
  workspaceLayout,
  desktopLayout,
  renderWorkspaceLayout,
  renderConversation,
  planImplementationPrompt,
  stayInPlanMode,
  implementApprovedPlan,
  goalResumePrompt,
  goalResumeSubmitting,
  pauseGoalResume,
  confirmGoalResume,
  themeMode,
  renderComposerDock,
}: CenterPanelViewProps) {

    return (
      <Box
        sx={{
          minWidth: 0,
          minHeight: 0,
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          "--chat-font-size": `${chatTypography.fontSize}px`,
          "--chat-line-height": chatTypography.lineHeight,
          "--chat-message-spacing": `${chatTypography.messageSpacing}px`,
          "--chat-running-highlight": chatTypography.runningHighlightColor,
          "--immersive-composer-space": immersiveView ? "188px" : "0px",
          borderInline: 0,
          bgcolor: (theme) => alpha(theme.palette.background.default, themeTuning.workspaceSurfaceOpacity),
          zIndex: 1,
          position: "relative"
        }}
      >
        <Box sx={{ flex: "0 0 auto", minHeight: 0, minWidth: 0, width: "100%", overflow: "hidden" }}>
          {state.engine.phase === "starting" && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 2 }}>
              <CircularProgress size={18} />
              <Typography variant="body2">{t("app.engineStarting")}</Typography>
            </Box>
          )}
          {shouldShowWorkspaceSelectionPanel({
            workspaceSelectionPending,
            activeThreadId: state.activeThreadId,
            newChatSetupDialogOpen,
            dangerNewChatDialogOpen: dangerDialogIntent?.source === "new-chat"
          }) && (
            <Box
              data-testid="workspace-selection-panel"
              sx={{
                m: { xs: 1, sm: 1.5 },
                p: { xs: 1.5, sm: 2 },
                border: "1px solid",
                borderColor: "primary.main",
                borderRadius: 2,
                bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.14 : 0.08)
              }}
            >
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ xs: "stretch", md: "center" }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                  <FolderOpenIcon color="primary" />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                      {t("workspace.title")}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t(windowsWorkspaceHost ? "workspace.descriptionWindows" : "workspace.description")}
                    </Typography>
                  </Box>
                </Stack>
                <TextField
                  size="small"
                  label={t("workspace.label")}
                  value={cwd}
                  onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setCwd(event.target.value)}
                  sx={{ minWidth: { xs: "100%", md: 320 } }}
                />
                <Button variant="outlined" startIcon={<FolderOpenIcon />} disabled={workspaceSetupBusy} onClick={() => openWorkspacePicker("primary", "local")}>
                  {t("workspace.browse")}
                </Button>
                <Button variant="contained" disabled={workspaceSetupBusy} onClick={() => void confirmWorkspaceSelection("local")}>
                  {t("workspace.use")}
                </Button>
                <Button variant="outlined" startIcon={<AddIcon />} disabled={workspaceSetupBusy} onClick={() => openWorkspacePicker("additional", "local")}>
                  {t("workspace.addAdditionalRoot")}
                </Button>
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }} sx={{ mt: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 800, whiteSpace: "nowrap" }}>CLI</Typography>
                <CliBackendPicker
                  value={runtimeSelection.cliBackend ?? DEFAULT_CLI_BACKEND}
                  onChange={handleNewConversationCliBackend}
                  codexEnabled={codexCliEnabled}
                  claudeEnabled={claudeCliEnabled}
                  agyEnabled={agyCliEnabled}
                  auggieEnabled={auggieCliEnabled}
                  clineEnabled={clineCliEnabled}
                  commandCodeEnabled={commandCodeCliEnabled}
                  grokEnabled={grokCliEnabled}
                  museEnabled={museCliEnabled}
                  piEnabled={piCliEnabled}
                  opencodeEnabled={opencodeCliEnabled}
                  opencodeV2Enabled={opencodeV2CliEnabled}
                  testId="workspace-cli-backend-toggle"
                />
              </Stack>
              <Box sx={{ mt: 1 }}>
                <RecentWorkspacesControl
                  currentPath={cwd}
                  onSelectWorkspace={handleSelectRecentWorkspace}
                  showChips={true}
                />
              </Box>
            </Box>
          )}
        </Box>
        <Box sx={{ flex: "1 1 0", minHeight: 0, minWidth: 0, width: "100%", maxWidth: "100%", overflow: "hidden" }}>
          {workspaceLayout && desktopLayout ? renderWorkspaceLayout() : renderConversation(state.activeThreadId, true)}
        </Box>
        <Dialog
          open={Boolean(planImplementationPrompt)}
          onClose={() => undefined}
          disableEscapeKeyDown
          fullWidth
          maxWidth="sm"
          data-testid="plan-implementation-dialog"
        >
          <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <ChecklistIcon color="primary" />
            Implement this plan?
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">
              The plan is ready. Start implementation in Default mode, or stay in Plan mode to revise it.
            </Typography>
            {planImplementationPrompt?.planText && (
              <Box
                component="pre"
                sx={{
                  mt: 1.5,
                  mb: 0,
                  p: 1.25,
                  maxHeight: 280,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  fontFamily: "inherit",
                  fontSize: 13,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  bgcolor: "background.default"
                }}
              >
                {planImplementationPrompt.planText}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={stayInPlanMode}>Cancel and stay in Plan mode</Button>
            <Button variant="contained" onClick={() => void implementApprovedPlan()}>
              Yes, implement this plan
            </Button>
          </DialogActions>
        </Dialog>
        <Dialog
          open={Boolean(goalResumePrompt)}
          onClose={() => undefined}
          disableEscapeKeyDown
          fullWidth
          maxWidth="sm"
          data-testid="goal-resume-dialog"
        >
          <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <FlagIcon color="success" />
            {t("goal.resumeDialog.title")}
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">
              {t("goal.resumeDialog.description")}
            </Typography>
            <Box
              sx={{
                mt: 1.5,
                p: 1.25,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                bgcolor: "background.default"
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.4, fontWeight: 750 }}>
                {t("goal.resumeDialog.objective")}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {goalResumePrompt?.goal.objective}
              </Typography>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button
              color="warning"
              startIcon={<PauseCircleIcon />}
              onClick={() => void pauseGoalResume()}
            >
              {t("goal.resumeDialog.pause")}
            </Button>
            <Button
              variant="contained"
              color="success"
              startIcon={goalResumeSubmitting ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
              disabled={goalResumeSubmitting}
              onClick={() => void confirmGoalResume()}
            >
              {goalResumeSubmitting ? t("goal.resumeDialog.resuming") : t("goal.resumeDialog.confirm")}
            </Button>
          </DialogActions>
        </Dialog>
        {themeMode !== "chatgpt" ? renderComposerDock() : null}
      </Box>
    );
}
