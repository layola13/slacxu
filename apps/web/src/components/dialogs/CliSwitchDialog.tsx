import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import type { Dispatch, SetStateAction } from "react";
import type { CliSwitchConfirmTarget } from "../../app/cli/useCliInstallations";
import type { TranslateFn } from "../../i18n";

export interface CliSwitchDialogProps {
  cliSwitchConfirmTarget: CliSwitchConfirmTarget | null;
  cliSwitchBusy: boolean;
  cliSwitchError: string | null;
  setCliSwitchConfirmTarget: Dispatch<SetStateAction<CliSwitchConfirmTarget | null>>;
  setCliSwitchError: Dispatch<SetStateAction<string | null>>;
  handleCliSwitchConfirm: () => void;
  t: TranslateFn;
}

export function CliSwitchDialog({
  cliSwitchConfirmTarget,
  cliSwitchBusy,
  cliSwitchError,
  setCliSwitchConfirmTarget,
  setCliSwitchError,
  handleCliSwitchConfirm,
  t,
}: CliSwitchDialogProps) {
  return (
      <Dialog
        data-testid="cli-switch-confirm-dialog"
        open={Boolean(cliSwitchConfirmTarget)}
        onClose={() => { if (!cliSwitchBusy) { setCliSwitchConfirmTarget(null); setCliSwitchError(null); } }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("app.cliSwitchConfirmTitle")}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Typography variant="body2">
              {t("app.cliSwitchConfirmBody", {
                backend: cliSwitchConfirmTarget?.backend === "claude"
                  ? "Claude"
                  : cliSwitchConfirmTarget?.backend === "grok"
                    ? "Grok"
                    : cliSwitchConfirmTarget?.backend === "agy"
                      ? "Antigravity"
                      : cliSwitchConfirmTarget?.backend === "pi"
                        ? "Pi"
                        : cliSwitchConfirmTarget?.backend === "opencode"
                          ? "OpenCode"
                          : cliSwitchConfirmTarget?.backend === "opencode-v2"
                            ? "OpenCode v2"
                            : cliSwitchConfirmTarget?.backend === "mini"
                            ? "Mini"
                            : "Codex",
                version: cliSwitchConfirmTarget?.version ? `v${cliSwitchConfirmTarget.version}` : "",
              })}
            </Typography>
            <Alert severity="warning" variant="outlined">{t("app.cliSwitchConfirmWarning")}</Alert>
            {cliSwitchError && <Alert severity="error" variant="filled">{cliSwitchError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={cliSwitchBusy} onClick={() => { setCliSwitchConfirmTarget(null); setCliSwitchError(null); }}>
            {t("app.cliSwitchConfirmCancel")}
          </Button>
          <Button data-testid="cli-switch-confirm-button" variant="contained" color="warning" disabled={cliSwitchBusy} onClick={handleCliSwitchConfirm}>
            {cliSwitchBusy ? t("app.cliSwitching") : t("app.cliSwitchConfirmAccept")}
          </Button>
        </DialogActions>
      </Dialog>
  );
}
