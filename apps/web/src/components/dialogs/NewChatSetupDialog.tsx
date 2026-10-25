import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, MenuItem, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography, type SelectChangeEvent } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import type { ChangeEvent as ReactChangeEvent, ComponentProps, Dispatch, MouseEvent as ReactMouseEvent, ReactNode, SetStateAction } from "react";
import { permissionPresets, type AgentRosterRole, type CliBackend, type PermissionPresetId, type ProviderConfig } from "@codex-ui/shared";
import { DEFAULT_SSH_WORKSPACE_CWD, type WorkspaceMode } from "../../app/workbench/appConstants";
import { normalizeSshWorkspaceCwd } from "../../app/workbench/sshUtils";
import { normalizeWorkspaceCwd } from "../../workspacePaths";
import { permissionPresetDisplayLabel } from "../../permissionPresetDisplay";
import { DEFAULT_CLI_BACKEND } from "../../app/cli/cliPlugins";
import { CliBackendPicker } from "../CliBackendPicker";
import { RecentWorkspacesControl } from "../RecentWorkspacesControl";
import { AgentRosterSetupControl } from "../AgentRosterSetupControl";
import type { ThreadRuntimeSelection } from "../../app/runtime/useThreadRuntimeSelections";
import type { ModelEntry } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export interface NewChatSetupDialogProps {
  t: TranslateFn;
  newChatSetupDialogOpen: boolean;
  setNewChatSetupOpen: Dispatch<SetStateAction<boolean>>;
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: Dispatch<SetStateAction<WorkspaceMode>>;
  setWorkspacePickerPath: Dispatch<SetStateAction<string>>;
  sshCwd: string;
  cwd: string;
  setSshCwd: Dispatch<SetStateAction<string>>;
  setCwd: Dispatch<SetStateAction<string>>;
  sshConfigHostAlias: string;
  setSshConfigHostAlias: Dispatch<SetStateAction<string>>;
  sshCommand: string;
  setSshCommand: Dispatch<SetStateAction<string>>;
  sshConfigHostControl: ReactNode;
  localWorkspaceDefaultPath: string;
  openWorkspacePicker: (purpose?: "primary" | "additional", modeOverride?: WorkspaceMode) => void;
  workspaceSetupBusy: boolean;
  handleSelectRecentWorkspace: ComponentProps<typeof RecentWorkspacesControl>["onSelectWorkspace"];
  runtimeSelection: ThreadRuntimeSelection;
  handleNewConversationCliBackend: (value: CliBackend) => void;
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
  state: { providers: ProviderConfig[] };
  composerModels: ModelEntry[];
  selectedModel: string;
  updateAgentRuntime: (patch: Partial<ThreadRuntimeSelection["agents"]>) => void;
  permission: PermissionPresetId;
  requestPermissionChange: (nextPermission: PermissionPresetId) => void;
  allowedPermissions: PermissionPresetId[];
  newChatBudgetLimit: string;
  setNewChatBudgetLimit: Dispatch<SetStateAction<string>>;
  newChatBackendPreview: unknown;
  confirmWorkspaceSelection: (modeOverride?: WorkspaceMode) => Promise<void>;
}

export function NewChatSetupDialog(props: NewChatSetupDialogProps) {
  const {
    t,
    newChatSetupDialogOpen,
    setNewChatSetupOpen,
    workspaceMode,
    setWorkspaceMode,
    setWorkspacePickerPath,
    sshCwd,
    cwd,
    setSshCwd,
    setCwd,
    sshConfigHostAlias,
    setSshConfigHostAlias,
    sshCommand,
    setSshCommand,
    sshConfigHostControl,
    localWorkspaceDefaultPath,
    openWorkspacePicker,
    workspaceSetupBusy,
    handleSelectRecentWorkspace,
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
    state,
    composerModels,
    selectedModel,
    updateAgentRuntime,
    permission,
    requestPermissionChange,
    allowedPermissions,
    newChatBudgetLimit,
    setNewChatBudgetLimit,
    newChatBackendPreview,
    confirmWorkspaceSelection,
  } = props;
  return (
      <Dialog
        data-testid="new-chat-setup-dialog"
        open={newChatSetupDialogOpen}
        onClose={() => setNewChatSetupOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <AddIcon color="primary" />
            <Box sx={{ minWidth: 0 }}>
              <Typography component="span" variant="h6" sx={{ fontWeight: 850 }}>
                {t("newChat.setupTitle")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {t("newChat.setupSubtitle")}
              </Typography>
            </Box>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
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
                <Button variant="outlined" startIcon={<FolderOpenIcon />} disabled={workspaceSetupBusy} onClick={() => openWorkspacePicker()} sx={{ whiteSpace: "nowrap" }}>
                  {t("workspace.browse")}
                </Button>
                {workspaceMode === "local" && (
                  <Button variant="outlined" startIcon={<AddIcon />} disabled={workspaceSetupBusy} onClick={() => openWorkspacePicker("additional")}>
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
            </Box>

            {/* Backend selector stays visible even without alt CLIs: the new-conversation
                default is Mini, so a hidden group silently builds Mini threads while the
                user picks a Codex relay/model. Explicit selection always wins. */}
            <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 0.75 }}>
                  {t("newChat.cliBackend")}
                </Typography>
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
                />
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 0.75 }}>
                {t("newChat.relayModel")}
              </Typography>
              {runtimeControlSet}
            </Box>
            <Box sx={{ borderTop: 1, borderColor: "divider", pt: 0.5, display: "none" }}>
              <AgentRosterSetupControl
                roles={runtimeSelection.agents.roles}
                providers={state.providers}
                models={composerModels}
                defaultModel={selectedModel}
                onChange={(roles: AgentRosterRole[]) => updateAgentRuntime({ mode: roles.length > 0 ? "enabled" : "inherit", roles })}
              />
            </Box>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1fr) minmax(0, 1fr)" },
                gap: 1.25
              }}
            >
              <FormControl size="small" fullWidth>
                <Select
                  value={permission}
                  inputProps={{ "aria-label": t("settings.session.permissionPreset") }}
                  onChange={(event: SelectChangeEvent<PermissionPresetId>) => requestPermissionChange(event.target.value as PermissionPresetId)}
                >
                  {permissionPresets
                    .filter((preset: (typeof permissionPresets)[number]) => allowedPermissions.includes(preset.id))
                    .map((preset: (typeof permissionPresets)[number]) => (
                      <MenuItem key={preset.id} value={preset.id}>
                        {permissionPresetDisplayLabel(preset.id, t)}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                type="number"
                label={t("newChat.budgetLimit")}
                value={newChatBudgetLimit}
                onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setNewChatBudgetLimit(event.target.value)}
                inputProps={{ min: 0, step: "0.01" }}
                helperText={t("newChat.budgetLimitHelp")}
                fullWidth
              />
            </Box>

            <Box
              component="details"
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                bgcolor: "background.default",
                "& > summary": {
                  cursor: "pointer",
                  px: 1.25,
                  py: 1,
                  fontWeight: 800
                }
              }}
            >
              <Box component="summary">{t("newChat.backendParameters")}</Box>
              <Typography
                component="pre"
                data-testid="new-chat-backend-params"
                sx={{
                  m: 0,
                  px: 1.25,
                  pb: 1.25,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12
                }}
              >
                {JSON.stringify(newChatBackendPreview, null, 2)}
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewChatSetupOpen(false)}>{t("workspace.cancel")}</Button>
          <Button variant="contained" disabled={workspaceSetupBusy} onClick={() => void confirmWorkspaceSelection()}>
            {workspaceSetupBusy ? <CircularProgress color="inherit" size={18} /> : t("newChat.create")}
          </Button>
        </DialogActions>
      </Dialog>
  );
}
