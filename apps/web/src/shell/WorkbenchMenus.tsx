import { Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer, FormControl, IconButton, Menu, MenuItem, Popover, Select, Slider, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, type SelectChangeEvent } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import GroupsIcon from "@mui/icons-material/Groups";
import TuneIcon from "@mui/icons-material/Tune";
import type { ChangeEvent as ReactChangeEvent, Dispatch, MouseEvent as ReactMouseEvent, ReactNode, SetStateAction } from "react";
import type { AgentRosterRole, PermissionPresetId } from "@codex-ui/shared";
import type { ThreadRuntimeSelection } from "../app/runtime/useThreadRuntimeSelections";
import type { AgentRuntimeOverride } from "@codex-ui/shared";
import type { AgentReadinessDisplay } from "../app/agents/agentReadiness";
import type { ReasoningOption, SettingsSectionId } from "../settings/SettingsDrawer";
import type { CodexPluginSettingsTab } from "../components/CodexPluginSettingsPanel";
import type { TranslateFn } from "../i18n";
import type { AgentReadinessResult, ModelEntry } from "../state/codexClient";
import type { RightWorkspaceTab } from "../components/RightWorkspacePanel";
import type { WorkspaceMode } from "../app/workbench/appConstants";

export interface WorkbenchMenusProps {
  t: TranslateFn;
  mobileTopMenuAnchor: HTMLElement | null;
  setMobileTopMenuAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  requestNewSession: (nextPermission: PermissionPresetId) => void;
  permission: PermissionPresetId;
  setStatsPanelScope: Dispatch<SetStateAction<"status" | "stats" | null>>;
  setRightWorkspaceTab: Dispatch<SetStateAction<RightWorkspaceTab>>;
  setRightWorkspaceVisible: Dispatch<SetStateAction<boolean>>;
  loadBasics: (options?: { forceHistoryRefresh?: boolean }) => Promise<unknown>;
  openSettings: (section?: SettingsSectionId, pluginTab?: CodexPluginSettingsTab, relayTarget?: { providerId?: string; groupId?: string }) => void;
  runtimeConfigAnchor: HTMLElement | null;
  setRuntimeConfigAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  isMobile: boolean;
  runtimeControlSet: ReactNode;
  activeProviderLabel: string;
  selectedModel: string;
  conversationStatusLabel: string;
  activeWorkspaceCwd: string;
  openWorkspacePicker: (purpose?: "primary" | "additional", modeOverride?: WorkspaceMode) => void;
  activeWorkspaceAdditionalRoots: string[];
  reasoningAnchor: HTMLElement | null;
  setReasoningAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  showReasoningGlow: boolean;
  selectedReasoningLabel: string;
  reasoningIndex: number;
  reasoningMax: number;
  reasoningOptions: ReasoningOption[];
  setReasoningEffort: (value: string) => void;
  selectedReasoning: ReasoningOption | undefined;
  agentsAnchor: HTMLElement | null;
  setAgentsAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  agentReadiness: AgentReadinessResult | null;
  agentReadinessLoading: boolean;
  checkAgentReadiness: (agents?: ThreadRuntimeSelection["agents"]) => Promise<unknown>;
  setAgentReadinessJsonOpen: Dispatch<SetStateAction<boolean>>;
  agentReadinessDisplay: AgentReadinessDisplay;
  runtimeSelection: ThreadRuntimeSelection;
  updateAgentRuntime: (patch: Partial<ThreadRuntimeSelection["agents"]>) => void;
  composerModels: ModelEntry[];
  agentReasoningOptions: ReasoningOption[];
  applyRecommendedAgentRoster: () => void;
  addAgentRosterRole: () => void;
  updateAgentRosterRole: (roleId: string, patch: Partial<AgentRosterRole>) => void;
  resolveComposerReasoningOptions: (model: string) => ReasoningOption[];
  state: { activeThreadId: string | null };
  agentReadinessJsonOpen: boolean;
}

export function WorkbenchMenus({
  t,
  mobileTopMenuAnchor,
  setMobileTopMenuAnchor,
  requestNewSession,
  permission,
  setStatsPanelScope,
  setRightWorkspaceTab,
  setRightWorkspaceVisible,
  loadBasics,
  openSettings,
  runtimeConfigAnchor,
  setRuntimeConfigAnchor,
  isMobile,
  runtimeControlSet,
  activeProviderLabel,
  selectedModel,
  conversationStatusLabel,
  activeWorkspaceCwd,
  openWorkspacePicker,
  activeWorkspaceAdditionalRoots,
  reasoningAnchor,
  setReasoningAnchor,
  showReasoningGlow,
  selectedReasoningLabel,
  reasoningIndex,
  reasoningMax,
  reasoningOptions,
  setReasoningEffort,
  selectedReasoning,
  agentsAnchor,
  setAgentsAnchor,
  agentReadiness,
  agentReadinessLoading,
  checkAgentReadiness,
  setAgentReadinessJsonOpen,
  agentReadinessDisplay,
  runtimeSelection,
  updateAgentRuntime,
  composerModels,
  agentReasoningOptions,
  applyRecommendedAgentRoster,
  addAgentRosterRole,
  updateAgentRosterRole,
  resolveComposerReasoningOptions,
  state,
  agentReadinessJsonOpen,
}: WorkbenchMenusProps) {
  return (
    <>
      <Menu anchorEl={mobileTopMenuAnchor} open={Boolean(mobileTopMenuAnchor)} onClose={() => setMobileTopMenuAnchor(null)}>
        <MenuItem onClick={() => { requestNewSession(permission); setMobileTopMenuAnchor(null); }}>{t("app.newTask")}</MenuItem>
        <MenuItem onClick={() => { setStatsPanelScope("status"); setMobileTopMenuAnchor(null); }}>{t("app.sessionStats")}</MenuItem>
        <MenuItem onClick={() => { setRightWorkspaceTab("sidechat"); setRightWorkspaceVisible(true); setMobileTopMenuAnchor(null); }}>{t("app.openWorkspace")}</MenuItem>
        <MenuItem onClick={() => { void loadBasics({ forceHistoryRefresh: true }); setMobileTopMenuAnchor(null); }}>{t("app.refresh")}</MenuItem>
        <MenuItem onClick={() => { openSettings("codex"); setMobileTopMenuAnchor(null); }}>{t("settings.title")}</MenuItem>
      </Menu>
      <Popover
        open={Boolean(runtimeConfigAnchor) && !isMobile}
        anchorEl={runtimeConfigAnchor}
        onClose={() => setRuntimeConfigAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        PaperProps={{ sx: { width: "calc(100vw - 32px)", maxWidth: 380, p: 1.25, borderRadius: 2 } }}
      >
        {runtimeControlSet}
      </Popover>
      <Drawer
        anchor="bottom"
        open={Boolean(runtimeConfigAnchor) && isMobile}
        onClose={() => setRuntimeConfigAnchor(null)}
        data-testid="mobile-relay-sheet"
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "82dvh", overflow: "hidden" } }}
      >
        <Box sx={{ pt: 1, pb: 2, px: 2, overflowY: "auto" }}>
          <Box sx={{ width: 40, height: 4, borderRadius: 999, bgcolor: "divider", mx: "auto", mb: 1.5 }} />
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>中转 · 模型 · 推理</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {activeProviderLabel} · {selectedModel || t("app.model")} · {conversationStatusLabel}
              </Typography>
            </Box>
            <IconButton size="small" aria-label="close" onClick={() => setRuntimeConfigAnchor(null)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Box sx={{ minWidth: 0 }}>{runtimeControlSet}</Box>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 0.75 }}>工作目录</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              icon={<FolderOpenIcon />}
              label={activeWorkspaceCwd}
              sx={{ height: 30, maxWidth: "100%", flex: 1, justifyContent: "flex-start", "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }}
            />
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                setRuntimeConfigAnchor(null);
                openWorkspacePicker("primary", "local");
              }}
              sx={{ flex: "0 0 auto" }}
            >
              更换
            </Button>
          </Stack>
          {activeWorkspaceAdditionalRoots.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, overflowWrap: "anywhere" }}>
              附加目录 {activeWorkspaceAdditionalRoots.length} 个（桌面端管理）
            </Typography>
          )}
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              fullWidth
              onClick={() => {
                setRuntimeConfigAnchor(null);
                openSettings("relay");
              }}
            >
              中转站设置
            </Button>
            <Button
              size="small"
              variant="outlined"
              fullWidth
              onClick={() => {
                setRuntimeConfigAnchor(null);
                openSettings("codex");
              }}
            >
              {t("settings.title")}
            </Button>
          </Stack>
        </Box>
      </Drawer>
      <Popover
        open={Boolean(reasoningAnchor)}
        anchorEl={reasoningAnchor}
        onClose={() => setReasoningAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        PaperProps={{ sx: { width: 320, p: 2, mt: 0.75 } }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <TuneIcon fontSize="small" color={showReasoningGlow ? "primary" : "inherit"} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                {t("app.reasoningStrength")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("app.reasoningSentAs")}
              </Typography>
            </Box>
            <Chip size="small" label={selectedReasoningLabel} color={showReasoningGlow ? "primary" : "default"} />
          </Stack>
          <Slider
            value={reasoningIndex}
            min={0}
            max={reasoningMax}
            step={1}
            marks={reasoningOptions.map((option: ReasoningOption, index: number) => {
              const translationKey = `settings.codex.option.${option.value.trim().toLowerCase()}`;
              const translatedLabel = t(translationKey);
              return { value: index, label: translatedLabel === translationKey ? option.label : translatedLabel };
            })}
            onChange={(_: Event, value: number) => {
              const index = Array.isArray(value) ? value[0] : value;
              const next = reasoningOptions[index];
              if (next) {
                setReasoningEffort(next.value);
              }
            }}
            sx={{
              mx: 1,
              ...(showReasoningGlow
                ? {
                    "& .MuiSlider-thumb": {
                      boxShadow: "0 0 0 8px rgba(97, 243, 243, 0.12), 0 0 24px rgba(97, 243, 243, 0.42)"
                    }
                  }
                : {})
            }}
          />
          <Typography variant="body2" color="text.secondary">
            {selectedReasoning?.description ?? t("app.reasoningDescription")}
          </Typography>
        </Stack>
      </Popover>
      <Popover
        open={Boolean(agentsAnchor)}
        anchorEl={agentsAnchor}
        onClose={() => setAgentsAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        PaperProps={{ sx: { width: 680, maxWidth: "calc(100vw - 24px)", maxHeight: "min(760px, calc(100vh - 40px))", overflowY: "auto", p: 1.5, mb: 0.75, borderRadius: 2 } }}
      >
        <Stack spacing={1.5} data-testid="composer-agents-menu">
          <Stack direction="row" alignItems="center" spacing={1}>
            <GroupsIcon color="primary" />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>{t("app.agentsTitle")}</Typography>
              <Typography variant="caption" color="text.secondary">{t("app.agentsDescription")}</Typography>
            </Box>
          </Stack>
          <Alert
            severity={agentReadiness?.ready ? "success" : agentReadiness ? "warning" : "info"}
            icon={agentReadinessLoading ? <CircularProgress size={18} /> : undefined}
            action={<Stack direction="row" spacing={0.5}>
              <Button size="small" onClick={() => void checkAgentReadiness()} disabled={agentReadinessLoading}>重新检查</Button>
              {agentReadiness && <Button size="small" onClick={() => setAgentReadinessJsonOpen(true)}>查看 JSON</Button>}
            </Stack>}
          >
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {agentReadinessLoading ? "正在检查 Agents 配置…" : agentReadinessDisplay.title}
            </Typography>
            {!agentReadinessLoading && agentReadinessDisplay.detail && <Typography variant="caption" display="block">{agentReadinessDisplay.detail}</Typography>}
          </Alert>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={runtimeSelection.agents.mode}
            onChange={(_event: ReactMouseEvent<HTMLElement>, value: AgentRuntimeOverride["mode"] | null) => {
              if (!value) return;
              const agents = { ...runtimeSelection.agents, mode: value };
              updateAgentRuntime({ mode: value });
              void checkAgentReadiness(agents);
            }}
            aria-label="Agent mode"
          >
            <ToggleButton value="inherit">{t("app.agentsDefault")}</ToggleButton>
            <ToggleButton value="enabled">{t("app.agentsOn")}</ToggleButton>
            <ToggleButton value="disabled">{t("app.agentsOff")}</ToggleButton>
          </ToggleButtonGroup>
          {runtimeSelection.agents.mode === "enabled" && <>
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{t("app.agentsChildCount")}</Typography>
                <Typography variant="caption" color="text.secondary">{runtimeSelection.agents.childCount ?? t("app.agentsGlobalDefault")}</Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }}>
                <TextField
                  size="small"
                  type="number"
                  value={runtimeSelection.agents.childCount ?? ""}
                  placeholder={t("app.agentsGlobalDefault")}
                  inputProps={{ min: 1, step: 1, "aria-label": "Child agent count" }}
                  onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                    const value = event.target.value === "" ? null : Math.max(1, Math.floor(Number(event.target.value)));
                    if (value === null || Number.isSafeInteger(value + 1)) updateAgentRuntime({ childCount: value });
                  }}
                  sx={{ width: 120 }}
                />
                <Button size="small" onClick={() => updateAgentRuntime({ childCount: null })} disabled={runtimeSelection.agents.childCount === null}>{t("app.agentsUseGlobalCount")}</Button>
              </Stack>
            </Box>
            <FormControl size="small" fullWidth>
              <Select
                value={runtimeSelection.agents.model}
                displayEmpty
                inputProps={{ "aria-label": "Sub-agent model" }}
                onChange={(event: SelectChangeEvent<string>) => updateAgentRuntime({ model: event.target.value })}
              >
                <MenuItem value="">{t("app.agentsDefaultModel")}</MenuItem>
                {composerModels.map((entry: ModelEntry) => {
                  const value = entry.model ?? entry.id ?? "";
                  return <MenuItem key={value} value={value}>{entry.displayName ?? value}</MenuItem>;
                })}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <Select
                value={runtimeSelection.agents.reasoningEffort}
                displayEmpty
                inputProps={{ "aria-label": "Sub-agent reasoning effort" }}
                onChange={(event: SelectChangeEvent<string>) => updateAgentRuntime({ reasoningEffort: event.target.value })}
              >
                <MenuItem value="">{t("app.agentsDefaultReasoning")}</MenuItem>
                {agentReasoningOptions.map((option: ReasoningOption) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
              </Select>
            </FormControl>
            <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>{t("app.agentsRoster")}</Typography>
                  <Typography variant="caption" color="text.secondary">{t("app.agentsRosterDescription")}</Typography>
                </Box>
                <Stack direction="row" spacing={0.75}>
                  <Button size="small" variant="outlined" onClick={applyRecommendedAgentRoster}>{t("app.agentsRecommendedRoster")}</Button>
                  <Tooltip title={t("app.agentsAddRole")}><IconButton size="small" onClick={addAgentRosterRole} aria-label={t("app.agentsAddRole")}><AddIcon fontSize="small" /></IconButton></Tooltip>
                </Stack>
              </Stack>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {runtimeSelection.agents.roles.map((role: AgentRosterRole) => {
                  const roleReasoningOptions = resolveComposerReasoningOptions(role.model || runtimeSelection.agents.model || selectedModel);
                  return <Box key={role.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Checkbox size="small" checked={role.enabled} onChange={(event: ReactChangeEvent<HTMLInputElement>) => updateAgentRosterRole(role.id, { enabled: event.target.checked })} inputProps={{ "aria-label": `${role.name} enabled` }} />
                      <TextField size="small" value={role.name} label={t("app.agentsRoleName")} onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateAgentRosterRole(role.id, { name: event.target.value })} sx={{ flex: 1, minWidth: 120 }} />
                      <FormControl size="small" sx={{ flex: 1.25, minWidth: 150 }}>
                        <Select value={role.model} displayEmpty inputProps={{ "aria-label": `${role.name} model` }} onChange={(event: SelectChangeEvent<string>) => updateAgentRosterRole(role.id, { model: event.target.value, reasoningEffort: "" })}>
                          <MenuItem value="">{t("app.agentsDefaultModel")}</MenuItem>
                          {composerModels.map((entry: ModelEntry) => {
                            const value = entry.model ?? entry.id ?? "";
                            return <MenuItem key={value} value={value}>{entry.displayName ?? value}</MenuItem>;
                          })}
                        </Select>
                      </FormControl>
                      <FormControl size="small" sx={{ minWidth: 120 }}>
                        <Select value={role.reasoningEffort} displayEmpty inputProps={{ "aria-label": `${role.name} reasoning effort` }} onChange={(event: SelectChangeEvent<string>) => updateAgentRosterRole(role.id, { reasoningEffort: event.target.value })}>
                          <MenuItem value="">{t("app.agentsDefaultReasoning")}</MenuItem>
                          {roleReasoningOptions.map((option: ReasoningOption) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                        </Select>
                      </FormControl>
                      <Tooltip title={t("app.agentsRemoveRole")}><IconButton size="small" onClick={() => updateAgentRuntime({ roles: runtimeSelection.agents.roles.filter((entry: AgentRosterRole) => entry.id !== role.id) })} aria-label={t("app.agentsRemoveRole")}><CloseIcon fontSize="small" /></IconButton></Tooltip>
                    </Stack>
                    <TextField fullWidth size="small" multiline minRows={2} value={role.responsibility} label={t("app.agentsResponsibility")} onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateAgentRosterRole(role.id, { responsibility: event.target.value })} sx={{ mt: 1 }} />
                  </Box>;
                })}
                {runtimeSelection.agents.roles.length === 0 && <Typography variant="caption" color="text.secondary">{t("app.agentsRosterEmpty")}</Typography>}
              </Stack>
            </Box>
            {state.activeThreadId && <Typography variant="caption" color="text.secondary">{t("app.agentsExistingThreadNotice")}</Typography>}
          </>}
        </Stack>
      </Popover>
      <Dialog open={agentReadinessJsonOpen} onClose={() => setAgentReadinessJsonOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Agents 诊断 JSON</DialogTitle>
        <DialogContent>
          <TextField fullWidth multiline minRows={16} value={agentReadiness ? JSON.stringify(agentReadiness, null, 2) : ""} InputProps={{ readOnly: true }} sx={{ mt: 1, fontFamily: "monospace" }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => agentReadiness && void navigator.clipboard.writeText(JSON.stringify(agentReadiness, null, 2))}>复制 JSON</Button>
          <Button onClick={() => setAgentReadinessJsonOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
