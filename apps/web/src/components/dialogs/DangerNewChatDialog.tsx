import { Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, type Theme } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import type { ChangeEvent as ReactChangeEvent, Dispatch, MouseEvent as ReactMouseEvent, ReactNode, SetStateAction } from "react";
import type { CliBackend } from "@codex-ui/shared";
import type { DangerDialogIntent, WorkspaceMode } from "../../app/workbench/appConstants";
import { DEFAULT_SSH_WORKSPACE_CWD } from "../../app/workbench/appConstants";
import { normalizeSshWorkspaceCwd } from "../../app/workbench/sshUtils";
import { DEFAULT_CLI_BACKEND } from "../../app/cli/cliPlugins";
import { AgentRosterSetupControl } from "../AgentRosterSetupControl";
import type { AgentRosterRole } from "@codex-ui/shared";
import { RecentWorkspacesControl } from "../RecentWorkspacesControl";
import type { TranslateFn } from "../../i18n";
import type { RecentWorkspaceItem } from "../../utils/recentWorkspaces";
import type { ThreadRuntimeSelection } from "../../app/runtime/useThreadRuntimeSelections";
import { normalizeWorkspaceCwd } from "../../workspacePaths";
import type { ComponentProps } from "react";

type AgentRosterSetupProps = ComponentProps<typeof AgentRosterSetupControl>;

export interface DangerNewChatDialogProps {
  t: TranslateFn;
  isMobile: boolean;
  dangerDialogIntent: DangerDialogIntent | null;
  closeDangerDialog: () => void;
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
  sshCwd: string;
  setSshCwd: Dispatch<SetStateAction<string>>;
  cwd: string;
  setCwd: Dispatch<SetStateAction<string>>;
  setWorkspacePickerPath: Dispatch<SetStateAction<string>>;
  localWorkspaceDefaultPath: string;
  sshConfigHostAlias: string;
  setSshConfigHostAlias: Dispatch<SetStateAction<string>>;
  sshConfigHostControl: ReactNode;
  sshCommand: string;
  setSshCommand: Dispatch<SetStateAction<string>>;
  openWorkspacePicker: (purpose?: "primary" | "additional", modeOverride?: WorkspaceMode) => void;
  workspaceSetupBusy: boolean;
  handleSelectRecentWorkspace: (item: RecentWorkspaceItem) => void;
  additionalRoots: string[];
  setAdditionalRoots: Dispatch<SetStateAction<string[]>>;
  persistWorkspaceForActiveThread: (nextCwd: string, nextRoots: string[], nextWorkspaceFilePath?: string | null) => void;
  newChatAdditionalRootsExpanded: boolean;
  setNewChatAdditionalRootsExpanded: Dispatch<SetStateAction<boolean>>;
  runtimeSelection: { cliBackend?: CliBackend | null; agents: ThreadRuntimeSelection["agents"] };
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
  runtimeControlSet: ReactNode;
  providers: AgentRosterSetupProps["providers"];
  composerModels: AgentRosterSetupProps["models"];
  selectedModel: string;
  updateAgentRuntime: (patch: Partial<ThreadRuntimeSelection["agents"]>) => void;
  selectedReasoningLabel: string;
  dangerDialogPreset: unknown;
  dangerDialogAcknowledged: boolean;
  setDangerDialogAcknowledged: Dispatch<SetStateAction<boolean>>;
  useSaferModeFromDangerDialog: () => void;
  confirmDangerDialog: () => Promise<void>;
}

export function DangerNewChatDialog({
  t,
  isMobile,
  dangerDialogIntent,
  closeDangerDialog,
  workspaceMode,
  setWorkspaceMode,
  sshCwd,
  setSshCwd,
  cwd,
  setCwd,
  setWorkspacePickerPath,
  localWorkspaceDefaultPath,
  sshConfigHostAlias,
  setSshConfigHostAlias,
  sshConfigHostControl,
  sshCommand,
  setSshCommand,
  openWorkspacePicker,
  workspaceSetupBusy,
  handleSelectRecentWorkspace,
  additionalRoots,
  setAdditionalRoots,
  persistWorkspaceForActiveThread,
  newChatAdditionalRootsExpanded,
  setNewChatAdditionalRootsExpanded,
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
  runtimeControlSet,
  providers,
  composerModels,
  selectedModel,
  updateAgentRuntime,
  selectedReasoningLabel,
  dangerDialogPreset,
  dangerDialogAcknowledged,
  setDangerDialogAcknowledged,
  useSaferModeFromDangerDialog,
  confirmDangerDialog,
}: DangerNewChatDialogProps) {
  return (
      <Dialog
        data-testid="danger-new-chat-dialog"
        open={Boolean(dangerDialogIntent)}
        onClose={closeDangerDialog}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
        PaperProps={{ sx: { bgcolor: "background.paper", backgroundImage: "none" } }}
      >
        {!isMobile && (
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <ErrorOutlineIcon color="primary" />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography component="span" variant="h6" sx={{ fontWeight: 850 }}>
                {t("newChat.fullAutoTitle")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {t("newChat.fullAutoSubtitle")}
              </Typography>
            </Box>
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label={t("newChat.fullAutoDanger")}
              sx={{ bgcolor: (theme: Theme) => alpha(theme.palette.success.main, theme.palette.mode === "dark" ? 0.2 : 0.1) }}
            />
          </Stack>
        </DialogTitle>
        )}
        <DialogContent dividers sx={isMobile ? { px: 2, py: 1.5 } : undefined}>
          <Stack spacing={isMobile ? 1.25 : 2}>
            {!isMobile && (
            <Alert icon={<ErrorOutlineIcon fontSize="inherit" />} severity="info" sx={{ color: "text.primary", bgcolor: "action.hover", border: "1px solid", borderColor: "divider", "& .MuiAlert-icon": { color: "text.secondary" } }}>
              {t("newChat.fullAutoWarning")}
            </Alert>
            )}
            <Box
              data-testid="danger-new-chat-details"
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 1.5
              }}
            >
              {dangerDialogIntent?.source === "new-chat" && (
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 0.75 }}>
                    {t("workspace.title")}
                  </Typography>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: {
                        xs: "minmax(0, 1fr)",
                        sm: workspaceMode === "ssh" ? "auto minmax(180px, 1fr)" : "auto minmax(0, 1fr) auto auto",
                        lg: workspaceMode === "ssh"
                          ? sshConfigHostAlias
                            ? "auto minmax(180px, 1fr) minmax(220px, 1.2fr) auto"
                            : "auto minmax(180px, 1fr) minmax(190px, 1fr) minmax(220px, 1.2fr) auto"
                          : "auto minmax(240px, 1fr) auto auto"
                      },
                      gap: 1,
                      rowGap: isMobile ? 1.25 : 1,
                      alignItems: "center",
                      minWidth: 0
                    }}
                  >
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={workspaceMode}
                      onChange={(_event: ReactMouseEvent<HTMLElement>, value: WorkspaceMode | null) => {
                        if (value !== "local" && value !== "ssh") {
                          return;
                        }
                        setWorkspaceMode(value);
                        setWorkspacePickerPath(value === "ssh" ? normalizeSshWorkspaceCwd(sshCwd) || DEFAULT_SSH_WORKSPACE_CWD : normalizeWorkspaceCwd(cwd) || localWorkspaceDefaultPath);
                      }}
                      aria-label={t("workspace.mode")}
                    >
                      <ToggleButton value="local" aria-label={t("workspace.local")}>
                        {t("workspace.local")}
                      </ToggleButton>
                      <ToggleButton value="ssh" aria-label={t("workspace.ssh")}>
                        SSH
                      </ToggleButton>
                    </ToggleButtonGroup>
                    {sshConfigHostControl}
                    {workspaceMode === "ssh" && !sshConfigHostAlias && (
                      <TextField
                        size="small"
                        label={t("workspace.sshCommand")}
                        value={sshCommand}
                        onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setSshConfigHostAlias(""); setSshCommand(event.target.value); }}
                        sx={{ minWidth: 0, width: "100%" }}
                        inputProps={{ sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 } }}
                      />
                    )}
                    <TextField
                      size="small"
                      label={workspaceMode === "ssh" ? t("workspace.remoteFolder") : t("workspace.label")}
                      value={workspaceMode === "ssh" ? sshCwd : cwd}
                      onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => (workspaceMode === "ssh" ? setSshCwd(event.target.value) : setCwd(event.target.value))}
                      sx={{ minWidth: 0, width: "100%" }}
                      inputProps={{ sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 } }}
                    />
                    <Button variant="outlined" startIcon={<FolderOpenIcon />} onClick={() => openWorkspacePicker()} sx={{ whiteSpace: "nowrap", ...(isMobile ? { minHeight: 40 } : {}) }}>
                      {t("workspace.browse")}
                    </Button>
                    {workspaceMode === "local" && (
                      <Button
                        variant="outlined"
                        startIcon={<AddIcon />}
                        disabled={workspaceSetupBusy}
                        onClick={() => openWorkspacePicker("additional")}
                        sx={{ whiteSpace: "nowrap", ...(isMobile ? { minHeight: 40 } : {}) }}
                      >
                        {t("workspace.addAdditionalRoot")}
                      </Button>
                    )}
                  </Box>
                  <Box sx={{ mt: 1 }}>
                    <RecentWorkspacesControl
                      currentPath={workspaceMode === "ssh" ? sshCwd : cwd}
                      onSelectWorkspace={handleSelectRecentWorkspace}
                      showChips={true}
                    />
                  </Box>
                  {workspaceMode === "local" && additionalRoots.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() => setNewChatAdditionalRootsExpanded((expanded: boolean) => !expanded)}
                        endIcon={(
                          <ExpandMoreIcon
                            sx={{
                              transform: newChatAdditionalRootsExpanded ? "rotate(180deg)" : "none",
                              transition: "transform 160ms ease"
                            }}
                          />
                        )}
                        aria-expanded={newChatAdditionalRootsExpanded}
                        data-testid="danger-new-chat-additional-roots-toggle"
                        sx={{ px: 0.5, minHeight: 30, fontWeight: 750 }}
                      >
                        {t("workspace.additionalRoots")} ({additionalRoots.length})
                      </Button>
                      <Collapse in={newChatAdditionalRootsExpanded}>
                        <Stack
                          direction="row"
                          spacing={0.75}
                          useFlexGap
                          flexWrap="wrap"
                          sx={{ pt: 0.75 }}
                          data-testid="danger-new-chat-additional-roots-list"
                        >
                          {additionalRoots.map((root: string) => (
                            <Tooltip key={root} title={root}>
                              <Chip
                                size="small"
                                icon={<FolderOpenIcon />}
                                label={root}
                                onDelete={() => {
                                  const next = additionalRoots.filter((entry: string) => entry !== root);
                                  setAdditionalRoots(next);
                                  persistWorkspaceForActiveThread(cwd, next);
                                }}
                                deleteIcon={<CloseIcon />}
                                aria-label={`${t("workspace.removeAdditionalRoot")}: ${root}`}
                                sx={{
                                  maxWidth: { xs: "100%", sm: 320 },
                                  borderRadius: 1,
                                  "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" }
                                }}
                              />
                            </Tooltip>
                          ))}
                        </Stack>
                      </Collapse>
                    </Box>
                  )}
                </Box>
              )}
              {/* Always visible: see note on the standard new-chat backend selector. */}
              <Box>
                  {!isMobile && (
                  <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 0.75 }}>
                    {t("newChat.cliBackend")}
                  </Typography>
                  )}
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={runtimeSelection.cliBackend ?? DEFAULT_CLI_BACKEND}
                    onChange={(_event: ReactMouseEvent<HTMLElement>, value: CliBackend | null) => {
                      if (value) {
                        handleNewConversationCliBackend(value);
                      }
                    }}
                    data-testid="cli-backend-toggle"
                    sx={isMobile ? {
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(44px, 1fr))",
                      gap: 0.5,
                      maxWidth: "100%",
                      "& .MuiToggleButton-root": {
                        gap: 0,
                        p: 0,
                        minHeight: 44,
                        minWidth: 0,
                        fontSize: 0,
                        lineHeight: 0,
                        textTransform: "none"
                      }
                    } : {
                      "& .MuiToggleButton-root": { px: 1, py: 0.75, textTransform: "none" },
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 0.5,
                      "& .MuiToggleButtonGroup-grouped": { border: "1px solid", borderColor: "divider", borderRadius: "10px !important", marginLeft: "0 !important" }
                    }}
                  >
                    {codexCliEnabled && (
                      <Tooltip title="Codex CLI" placement="top"><ToggleButton value="codex" aria-label="Codex CLI"><Box component="img" src="/icons/codex-color.svg" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                    )}
                    {claudeCliEnabled && (
                      <Tooltip title="Claude CLI" placement="top"><ToggleButton value="claude" aria-label="Claude CLI"><Box component="img" src="/icons/claudecode-color.svg" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                    )}
                    {agyCliEnabled && (
                      <Tooltip title="Antigravity CLI" placement="top"><ToggleButton value="agy" aria-label="Antigravity CLI"><Box component="img" src="/icons/agy-color.svg" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                    )}
                    {auggieCliEnabled && (
                      <Tooltip title="Auggie CLI" placement="top"><ToggleButton value="auggie" aria-label="Auggie CLI"><Box component="img" src="/icons/auggie-color.svg" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                    )}
                    {clineCliEnabled && (
                      <Tooltip title="Cline CLI" placement="top"><ToggleButton value="cline" aria-label="Cline CLI"><Box component="img" src="/icons/cline-color.svg" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                    )}
                    {commandCodeCliEnabled && (
                      <Tooltip title="Command Code CLI" placement="top"><ToggleButton value="command-code" aria-label="Command Code CLI"><Box component="img" src="/icons/command-code.png" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                    )}
                    {grokCliEnabled && (
                      <Tooltip title="Grok CLI" placement="top"><ToggleButton value="grok" aria-label="Grok CLI"><Box component="img" src="/icons/grok.svg" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                    )}
                    {museCliEnabled && (
                      <Tooltip title="Muse CLI" placement="top"><ToggleButton value="muse" aria-label="Muse CLI"><Box component="img" src="/icons/muse.png" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                    )}
                    {piCliEnabled && (
                      <Tooltip title="Pi CLI" placement="top"><ToggleButton value="pi" aria-label="Pi CLI"><Box component="img" src="/icons/pi.svg" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                    )}
                    {opencodeCliEnabled && (
                      <Tooltip title="OpenCode CLI" placement="top"><ToggleButton value="opencode" aria-label="OpenCode CLI"><Box component="img" src="/icons/opencode.svg" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                    )}
                    {opencodeV2CliEnabled && (
                      <Tooltip title="OpenCode v2 CLI" placement="top"><ToggleButton value="opencode-v2" aria-label="OpenCode v2 CLI"><Box component="img" src="/icons/opencode-v2.svg" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                    )}
                    <Tooltip title="Mini" placement="top"><ToggleButton value="mini" aria-label="Mini"><Box component="img" src="/icons/mini.svg" alt="" aria-hidden sx={{ width: 20, height: 20, objectFit: "contain" }} /></ToggleButton></Tooltip>
                  </ToggleButtonGroup>
              </Box>
              <Box>
                {!isMobile && (
                <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 0.75 }}>
                  {t("newChat.relayModel")}
                </Typography>
                )}
                <Box
                  data-testid="danger-new-chat-relay-stack"
                  sx={isMobile ? {
                    '[data-testid="composer-runtime-controls"]': {
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 1,
                      width: "100%"
                    },
                    '[data-testid="composer-runtime-controls"] > *': {
                      minWidth: 0,
                      maxWidth: "100%",
                      width: "100%"
                    },
                    '[data-testid="composer-quota-chip"]': {
                      gridColumn: "1 / -1",
                      width: "100%"
                    }
                  } : undefined}
                >
                  {runtimeControlSet}
                </Box>
              </Box>
              {!isMobile && (
              <Box sx={{ borderTop: 1, borderColor: "divider", pt: 0.5, display: "none" }}>
                <AgentRosterSetupControl
                  roles={runtimeSelection.agents.roles}
                  providers={providers}
                  models={composerModels}
                  defaultModel={selectedModel}
                  onChange={(roles: AgentRosterRole[]) => updateAgentRuntime({ mode: roles.length > 0 ? "enabled" : "inherit", roles })}
                />
              </Box>
              )}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "150px minmax(0, 1fr)" },
                  gap: 1,
                  alignItems: "center",
                  ...(isMobile ? { display: "none" } : {})
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {t("app.reasoningStrength")}
                </Typography>
                <Typography>{selectedReasoningLabel}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("newChat.fullAutoActualPermissions")}
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <Chip
                    size="small"
                    color="success"
                    variant="outlined"
                    label={t("newChat.fullAutoNoSandboxBoundary")}
                    sx={{ bgcolor: (theme: Theme) => alpha(theme.palette.success.main, theme.palette.mode === "dark" ? 0.2 : 0.1) }}
                  />
                  <Chip
                    size="small"
                    color="success"
                    variant="outlined"
                    label={t("newChat.fullAutoNoApprovalPrompts")}
                    sx={{ bgcolor: (theme: Theme) => alpha(theme.palette.success.main, theme.palette.mode === "dark" ? 0.2 : 0.1) }}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {t("newChat.fullAutoSelectedPreset")}
                </Typography>
                <Typography>{dangerDialogPreset ? t("newChat.fullAutoPreset") : dangerDialogIntent?.nextPermission ?? t("newChat.fullAutoDanger")}</Typography>
              </Box>
              {isMobile && (
                <Box data-testid="danger-new-chat-mobile-summary">
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {selectedReasoningLabel} · {t("newChat.fullAutoNoSandboxBoundary")} · {t("newChat.fullAutoNoApprovalPrompts")}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.25 }}>
                    {dangerDialogPreset ? t("newChat.fullAutoPreset") : dangerDialogIntent?.nextPermission ?? t("newChat.fullAutoDanger")}
                  </Typography>
                </Box>
              )}
            </Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={dangerDialogAcknowledged}
                  onChange={(event: ReactChangeEvent<HTMLInputElement>) => setDangerDialogAcknowledged(event.target.checked)}
                  inputProps={{ "aria-label": t("newChat.fullAutoConfirmAria") }}
                />
              }
              label={t("newChat.fullAutoAcknowledge")}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={isMobile ? { flexDirection: "row", alignItems: "center", gap: 0.75, px: 2, pb: 2 } : undefined}>
          <Button onClick={closeDangerDialog} sx={isMobile ? { minHeight: 44, px: 1 } : undefined}>{t("workspace.cancel")}</Button>
          <Button color="inherit" onClick={useSaferModeFromDangerDialog} sx={isMobile ? { minHeight: 44, px: 1, fontSize: 13, whiteSpace: "nowrap" } : undefined}>
            {isMobile ? "更安全模式" : t("newChat.fullAutoUseSaferMode")}
          </Button>
          <Button variant="contained" color="primary" disabled={!dangerDialogAcknowledged || workspaceSetupBusy} onClick={() => void confirmDangerDialog()} sx={isMobile ? { minHeight: 44, flex: 1 } : undefined}>
            {workspaceSetupBusy ? <CircularProgress color="inherit" size={18} /> : (isMobile ? "创建" : t("newChat.fullAutoCreate"))}
          </Button>
        </DialogActions>
      </Dialog>
  );
}
