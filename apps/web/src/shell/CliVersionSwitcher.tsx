import { Alert, Box, Button, CircularProgress, Popover, Stack, Switch, Tooltip, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import type { Dispatch, SetStateAction } from "react";
import type { CliBackend } from "@codex-ui/shared";
import type { CliInstallation, CliInstallationsStatus, CliInstallationKind, CodexCliUpdateStatus } from "../state/codexClient";
import { describeCliBackendUsage, type CliBackendUsageInput } from "../app/cli/cliTogglePolicy";
import type { CliBackendEnabledMap } from "../app/cli/useCliBackendPlugins";
import type { CliSwitchConfirmTarget } from "../app/cli/useCliInstallations";
import { CliBackendToggle } from "../components/CliBackendToggle";
import type { ThreadRuntimeSelection } from "../app/runtime/useThreadRuntimeSelections";
import type { TranslateFn } from "../i18n";

export interface CliVersionSwitcherProps {
  t: TranslateFn;
  cliSwitcherAnchor: HTMLElement | null;
  setCliSwitcherAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  cliBackendToggleError: string | null;
  cliInstallations: CliInstallationsStatus | null;
  isClaudeBackend: boolean;
  codexCliUpdateStatus: CodexCliUpdateStatus | null;
  setCodexCliUpdateDialogOpen: Dispatch<SetStateAction<boolean>>;
  cliBackendEnabled: CliBackendEnabledMap;
  threadRuntimeSelections: CliBackendUsageInput["selections"];
  state: { threads: CliBackendUsageInput["threads"] };
  runningThreadIds: ReadonlySet<string>;
  handleCliPluginToggleFromList: (backend: CliInstallationKind, next: boolean, effect: "immediate" | "restart") => void;
  runtimeSelection: ThreadRuntimeSelection;
  handleNewConversationCliBackend: (value: CliBackend) => void;
  cliSwitchBusy: boolean;
  setCliSwitchConfirmTarget: Dispatch<SetStateAction<CliSwitchConfirmTarget | null>>;
  isMiniBackend: boolean;
  miniVersion: string | null;
}

export function CliVersionSwitcher({
  t,
  cliSwitcherAnchor,
  setCliSwitcherAnchor,
  cliBackendToggleError,
  cliInstallations,
  isClaudeBackend,
  codexCliUpdateStatus,
  setCodexCliUpdateDialogOpen,
  cliBackendEnabled,
  threadRuntimeSelections,
  state,
  runningThreadIds,
  handleCliPluginToggleFromList,
  runtimeSelection,
  handleNewConversationCliBackend,
  cliSwitchBusy,
  setCliSwitchConfirmTarget,
  isMiniBackend,
  miniVersion,
}: CliVersionSwitcherProps) {
  return (
      <Popover
        data-testid="cli-version-switcher"
        open={Boolean(cliSwitcherAnchor)}
        anchorEl={cliSwitcherAnchor}
        onClose={() => setCliSwitcherAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 356, maxWidth: "94vw", maxHeight: 420, overflow: "auto" } } }}
      >
        <Stack sx={{ p: 1.5 }} spacing={1}>
          <Stack direction="row" alignItems="center" sx={{ px: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
              {t("app.cliSwitcherTitle")}
            </Typography>
            {!isClaudeBackend && codexCliUpdateStatus?.updateAvailable && (
              <Button
                size="small"
                sx={{ ml: "auto", py: 0 }}
                onClick={() => {
                  setCliSwitcherAnchor(null);
                  setCodexCliUpdateDialogOpen(true);
                }}
              >
                {t("app.codexCliUpdateAvailableShort")}
              </Button>
            )}
          </Stack>
          {cliBackendToggleError ? (
            <Alert severity="warning" variant="outlined">{cliBackendToggleError}</Alert>
          ) : null}
          {!cliInstallations ? (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 3, gap: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {t("app.cliSwitcherLoading") || "Loading CLI installations..."}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              {(["codex", "claude", "agy", "auggie", "cline", "command-code", "grok", "muse", "pi", "opencode", "opencode-v2"] as const).map((backend: CliInstallationKind) => {
                const status = cliInstallations[backend];
                const sectionIcon = backend === "codex" ? "/icons/codex-color.svg" : backend === "agy" ? "/icons/agy-color.svg" : backend === "auggie" ? "/icons/auggie-color.svg" : backend === "cline" ? "/icons/cline-color.svg" : backend === "command-code" ? "/icons/command-code.png" : backend === "grok" ? "/icons/grok.svg" : backend === "muse" ? "/icons/muse.png" : backend === "pi" ? "/icons/pi.svg" : backend === "opencode" ? "/icons/opencode.svg" : backend === "opencode-v2" ? "/icons/opencode-v2.svg" : "/icons/claudecode-color.svg";
                const backendLabel = backend === "codex"
                  ? t("app.cliSwitcherCodexSection")
                  : backend === "claude"
                    ? t("app.cliSwitcherClaudeSection")
                    : backend === "agy"
                      ? (t("app.cliSwitcherAgySection") || "Antigravity CLI")
                      : backend === "auggie"
                        ? (t("app.cliSwitcherAuggieSection") || "Auggie CLI")
                        : backend === "cline"
                          ? (t("app.cliSwitcherClineSection") || "Cline CLI")
                          : backend === "command-code"
                            ? (t("app.cliSwitcherCommandCodeSection") || "Command Code CLI")
                            : backend === "grok"
                              ? (t("app.cliSwitcherGrokSection") || "Grok CLI")
                              : backend === "muse"
                                ? (t("app.cliSwitcherMuseSection") || "Muse CLI")
                                : backend === "pi"
                                  ? (t("app.cliSwitcherPiSection") || "Pi Agent")
                                  : backend === "opencode"
                                    ? (t("app.cliSwitcherOpencodeSection") || "OpenCode CLI")
                                    : (t("app.cliSwitcherOpencodeV2Section") || "OpenCode v2 CLI");
                const installed = status ? (status.installations.length ?? 0) > 0 : false;
                const isCurrent = runtimeSelection.cliBackend === backend;
                const tooltip = (
                  <Stack spacing={0.25}>
                    <Typography variant="caption" sx={{ fontWeight: 800 }}>{backendLabel}</Typography>
                    {!status ? (
                      <Typography variant="caption">{t("app.cliSwitcherLoading") || "Loading..."}</Typography>
                    ) : !installed ? (
                      <Typography variant="caption">{t("app.cliSwitcherNotInstalled")}</Typography>
                    ) : status.installations.map((installation: CliInstallation) => (
                      <Typography key={installation.path} variant="caption" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                        {installation.version ? `v${installation.version}` : t("app.cliSwitcherUnknownVersion")}
                        {installation.path.toLowerCase() === status.effectivePath.toLowerCase() ? ` · ${t("app.cliSwitcherActive")}` : ""}
                        {` · ${installation.path}`}
                      </Typography>
                    ))}
                  </Stack>
                );
                return (
                  <Tooltip key={backend} arrow placement="top" title={tooltip}>
                    <Box
                      data-testid={`cli-version-tile-${backend}`}
                      onClick={() => {
                        if (status && installed && !cliSwitchBusy && runtimeSelection.cliBackend !== backend) {
                          handleNewConversationCliBackend(backend);
                          setCliSwitcherAnchor(null);
                        }
                      }}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.25,
                        px: 0.75,
                        py: 0.5,
                        borderRadius: 1.5,
                        border: "1px solid",
                        borderColor: isCurrent ? "primary.main" : "divider",
                        bgcolor: isCurrent ? "action.selected" : "transparent",
                        cursor: installed && !cliSwitchBusy ? "pointer" : "default",
                        opacity: status && !installed ? 0.5 : 1,
                        "&:hover": installed ? { bgcolor: "action.hover" } : undefined,
                      }}
                    >
                      <Box component="img" src={sectionIcon} alt="" sx={{ width: 20, height: 20, objectFit: "contain" }} />
                      {!status ? (
                        <CircularProgress size={14} />
                      ) : installed ? (
                        <CliBackendToggle
                          backend={backend}
                          backendLabel={backendLabel}
                          installed={installed}
                          enabled={cliBackendEnabled[backend] ?? false}
                          usage={describeCliBackendUsage(backend, {
                            selections: threadRuntimeSelections,
                            threads: state.threads,
                            runningThreadIds,
                          })}
                          t={t}
                          onToggle={handleCliPluginToggleFromList}
                        />
                      ) : (
                        <Switch size="small" disabled sx={{ ml: "auto" }} />
                      )}
                    </Box>
                  </Tooltip>
                );
              })}
              <Tooltip
                arrow
                placement="top"
                title={(
                  <Stack spacing={0.25}>
                    <Typography variant="caption" sx={{ fontWeight: 800 }}>{(t("app.cliSwitcherMiniSection") as string) || "Mini"}</Typography>
                    <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                      {miniVersion ? `v${miniVersion}` : (t("app.cliSwitcherUnknownVersion") as string)}
                      {isMiniBackend ? ` · ${t("app.cliSwitcherActive")}` : ""}
                      {` · ${t("app.cliSwitcherEmbedded")}`}
                    </Typography>
                  </Stack>
                )}
              >
                <Box
                  data-testid="cli-version-tile-mini"
                  onClick={() => {
                    if (!isMiniBackend) {
                      handleNewConversationCliBackend("mini");
                      setCliSwitcherAnchor(null);
                    }
                  }}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.25,
                    px: 0.75,
                    py: 0.5,
                    borderRadius: 1.5,
                    border: "1px solid",
                    borderColor: isMiniBackend ? "primary.main" : "divider",
                    bgcolor: isMiniBackend ? "action.selected" : "transparent",
                    cursor: !isMiniBackend ? "pointer" : "default",
                    "&:hover": !isMiniBackend ? { bgcolor: "action.hover" } : undefined,
                  }}
                >
                  <Box component="img" src="/icons/mini.svg" alt="" sx={{ width: 20, height: 20, objectFit: "contain" }} />
                  <CheckIcon sx={{ fontSize: 16, visibility: isMiniBackend ? "visible" : "hidden", color: "primary.main" }} />
                </Box>
              </Tooltip>
            </Box>
          )}
        </Stack>
      </Popover>
  );
}
