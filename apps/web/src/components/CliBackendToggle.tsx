import { useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Switch, Typography } from "@mui/material";
import type { TranslateFn } from "../i18n";
import type { CliInstallationKind } from "../state/codexClient";
import type { CliPluginBackend } from "../app/cli/useCliBackendPlugins";
import type { CliBackendUsage } from "../app/cli/cliTogglePolicy";

type Props = {
  backend: CliInstallationKind;
  backendLabel: string;
  installed: boolean;
  enabled: boolean;
  usage: CliBackendUsage;
  t: TranslateFn;
  onToggle: (backend: CliPluginBackend, next: boolean, effect: "immediate" | "restart") => void;
};

export function CliBackendToggle({ backend, backendLabel, installed, enabled, usage, t, onToggle }: Props) {
  const [pending, setPending] = useState<boolean | null>(null);
  if (!installed) {
    return (
      <Typography variant="caption" sx={{ ml: "auto", color: "text.disabled" }}>
        {t("app.cliSwitcherNotInstalled")}
      </Typography>
    );
  }
  const requestChange = (next: boolean) => {
    if (next === enabled) return;
    if (usage.inUse) {
      setPending(next);
      return;
    }
    onToggle(backend, next, "immediate");
  };
  const confirmPending = () => {
    if (pending == null) return;
    onToggle(backend, pending, "restart");
    setPending(null);
  };
  return (
    <>
      <Switch
        size="small"
        sx={{ ml: "auto" }}
        checked={enabled}
        data-testid={`cli-toggle-${backend}`}
        inputProps={{ "aria-label": `${backendLabel}${t("app.cliToggleEnable")}` }}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          event.stopPropagation();
          requestChange(event.target.checked);
        }}
      />
      <Dialog open={pending != null} onClose={() => setPending(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("app.cliSwitcherToggleTitle")}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            {t(pending ? "app.cliSwitcherToggleOnRestartBody" : "app.cliSwitcherToggleOffRestartBody", {
              name: backendLabel,
              count: String(usage.threadCount + usage.runningCount),
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)}>{t("app.cliSwitchConfirmCancel")}</Button>
          <Button
            variant="contained"
            color="warning"
            data-testid={`cli-toggle-confirm-${backend}`}
            onClick={confirmPending}
          >
            {t("app.cliSwitchConfirmAccept")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
