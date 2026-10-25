import { Box, Button, CircularProgress, IconButton, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import GroupsIcon from "@mui/icons-material/Groups";
import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import type { PermissionPresetId } from "@codex-ui/shared";
import type { ThreadRuntimeSelection } from "../app/runtime/useThreadRuntimeSelections";
import type { SlashCommandNotice, WorkspaceMode } from "../app/workbench/appConstants";
import { formatErrorText } from "../app/workbench/appUtils";
import type { appReducer } from "../app/appReducer";
import type { ThreadEntry } from "../state/codexClient";
import type { TranslateFn } from "../i18n";

export interface ComposerBackgroundControlProps {
  t: TranslateFn;
  composerRemoteAutonomous: boolean;
  composerRemotePending: boolean;
  composerRemoteThread: ThreadEntry | null;
  composerRemoteLifecycle: string | undefined;
  setRemoteThreadMode: (threadId: string, foreground: boolean) => Promise<void>;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  workspaceMode: WorkspaceMode;
  sshCommand: string;
  remoteBackgroundStarting: boolean;
  startRemoteBackgroundConversation: () => void;
}

export function ComposerBackgroundControl({
  t,
  composerRemoteAutonomous,
  composerRemotePending,
  composerRemoteThread,
  composerRemoteLifecycle,
  setRemoteThreadMode,
  dispatch,
  workspaceMode,
  sshCommand,
  remoteBackgroundStarting,
  startRemoteBackgroundConversation,
}: ComposerBackgroundControlProps) {
  return (
composerRemoteAutonomous ? (
    <Button
      size="small"
      variant="outlined"
      disabled={composerRemotePending}
      data-testid="composer-remote-lifecycle-button"
      startIcon={composerRemotePending ? <CircularProgress size={14} /> : undefined}
      onClick={() => {
        const threadId = composerRemoteThread?.id;
        if (threadId) void setRemoteThreadMode(threadId, composerRemoteLifecycle === "background").catch((error) => dispatch({ type: "error", message: formatErrorText(error) }));
      }}
      sx={{ height: 32 }}
    >
      {t(composerRemoteLifecycle === "background" ? "taskTabs.foreground" : "taskTabs.background")}
    </Button>
  ) : workspaceMode === "ssh" && sshCommand.trim() ? (
    <Button
      size="small"
      variant="outlined"
      disabled={remoteBackgroundStarting}
      data-testid="composer-remote-background-start-button"
      startIcon={remoteBackgroundStarting ? <CircularProgress size={14} /> : undefined}
      onClick={() => void startRemoteBackgroundConversation()}
      sx={{ height: 32 }}
    >
      {t("taskTabs.startRemoteBackground")}
    </Button>
  ) : null
  );
}

const CLI_BACKEND_SWAP_AVAILABLE = false;

export interface ComposerCliBackendActionProps {
  t: TranslateFn;
  claudeCliEnabled: boolean;
  isClaudeBackend: boolean;
  setSlashNotice: Dispatch<SetStateAction<SlashCommandNotice | null>>;
}

export function ComposerCliBackendAction({
  t,
  claudeCliEnabled,
  isClaudeBackend,
  setSlashNotice,
}: ComposerCliBackendActionProps) {
  return claudeCliEnabled && CLI_BACKEND_SWAP_AVAILABLE ? (

    <Tooltip title={t("newChat.cliBackendSwapDisabled")}>
      <Box component="span" sx={{ display: "inline-flex" }}>
        <IconButton
          size="small"
          color={isClaudeBackend ? "secondary" : "default"}
          aria-label={`${t("newChat.cliBackend")}: ${isClaudeBackend ? t("newChat.cliBackendClaude") : t("newChat.cliBackendCodex")}`}
          data-testid="composer-cli-backend-toggle"
          data-cli-backend={isClaudeBackend ? "claude" : "codex"}
          onClick={() => setSlashNotice({
            id: `cli-backend-swap-${Date.now()}`,
            title: t("newChat.cliBackendSwapDisabled"),
            message: t("newChat.cliBackendSwapDisabledMessage"),
            severity: "info"
          })}
          sx={{
            width: 32,
            height: 32,
            flex: "0 0 32px",
            border: "1px solid",
            borderColor: isClaudeBackend ? "secondary.main" : "divider",
            bgcolor: (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.background.paper, 0.94)
          }}
        >
          <Box
            component="img"
            src={isClaudeBackend ? "/icons/claudecode-color.svg" : "/icons/codex-color.svg"}
            alt={isClaudeBackend ? "Claude CLI" : "Codex CLI"}
            sx={{ width: 19, height: 19, objectFit: "contain" }}
          />
        </IconButton>
      </Box>
    </Tooltip>
  ) : null;
}

export interface ComposerAgentsActionProps {
  t: TranslateFn;
  agentSummary: string;
  runtimeSelection: ThreadRuntimeSelection;
  agentsAnchor: HTMLElement | null;
  setRuntimeConfigAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  setAgentsAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  checkAgentReadiness: () => Promise<unknown>;
}

export function ComposerAgentsAction({
  t,
  agentSummary,
  runtimeSelection,
  agentsAnchor,
  setRuntimeConfigAnchor,
  setAgentsAnchor,
  checkAgentReadiness,
}: ComposerAgentsActionProps) {
  return (

    <Tooltip title={`${t("app.agents")} · ${agentSummary}`}>
      <IconButton
        size="small"
        color={runtimeSelection.agents.mode === "enabled" ? "primary" : "default"}
        aria-label={t("app.agents")}
        aria-haspopup="menu"
        aria-expanded={agentsAnchor ? "true" : undefined}
        data-testid="composer-agents-button"
        onClick={(event: ReactMouseEvent<HTMLButtonElement, MouseEvent>) => {
          setRuntimeConfigAnchor(null);
          setAgentsAnchor(event.currentTarget);
          void checkAgentReadiness();
        }}
        sx={{
          width: 32,
          height: 32,
          flex: "0 0 32px",
          border: "1px solid",
          borderColor: runtimeSelection.agents.mode === "enabled" ? "primary.main" : "divider",
          bgcolor: (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.background.paper, 0.94)
        }}
      >
        <GroupsIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Tooltip>
  
  );
}
