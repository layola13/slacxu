import { Alert, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import type { Dispatch, SetStateAction } from "react";
import type { SshPreflightResult } from "../../app/workbench/appConstants";
import type { TranslateFn } from "../../i18n";

export interface SshCodexInstallDialogProps {
  t: TranslateFn;
  sshPreflightIssue: SshPreflightResult | null;
  setSshPreflightIssue: Dispatch<SetStateAction<SshPreflightResult | null>>;
  setSshInstallConfirming: Dispatch<SetStateAction<boolean>>;
  sshInstallBusy: boolean;
  sshInstallCommand: string;
  sshInstallConfirming: boolean;
  sshInstallError: string | null;
  recheckSshWorkspace: () => Promise<void>;
  installSshCodex: () => Promise<void>;
}

export function SshCodexInstallDialog({
  t,
  sshPreflightIssue,
  setSshPreflightIssue,
  setSshInstallConfirming,
  sshInstallBusy,
  sshInstallCommand,
  sshInstallConfirming,
  sshInstallError,
  recheckSshWorkspace,
  installSshCodex,
}: SshCodexInstallDialogProps) {
  return (
      <Dialog
        data-testid="ssh-codex-install-dialog"
        open={Boolean(sshPreflightIssue)}
        onClose={() => { if (!sshInstallBusy) { setSshPreflightIssue(null); setSshInstallConfirming(false); } }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("workspace.sshInstallTitle")}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Alert severity={sshPreflightIssue?.connected ? "warning" : "error"}>
              {t(sshPreflightIssue?.connected ? "workspace.sshInstallRequired" : "workspace.sshConnectionRequired")}
            </Alert>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Chip label={`${t("workspace.sshRemoteOs")}: ${sshPreflightIssue?.os || t("workspace.sshUnknown")}`} />
              <Chip label={`${t("workspace.sshRemoteArch")}: ${sshPreflightIssue?.arch || t("workspace.sshUnknown")}`} />
            </Stack>
            {sshPreflightIssue?.reasons.map((reason: string) => <Typography key={reason} variant="body2" color="text.secondary">• {reason}</Typography>)}
            {!sshPreflightIssue?.connected ? (
              <Alert severity="info" sx={{ whiteSpace: "pre-line" }}>{t("workspace.sshConnectionHelp")}</Alert>
            ) : sshInstallCommand ? (
              <>
                <TextField
                  label={t("workspace.sshInstallCommand")}
                  value={sshInstallCommand}
                  multiline
                  minRows={2}
                  InputProps={{ readOnly: true }}
                  inputProps={{ sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 } }}
                />
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button onClick={() => void navigator.clipboard.writeText(sshInstallCommand)}>{t("workspace.sshCopyCommand")}</Button>
                  <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                    {t("workspace.sshInstallAlternatives")}
                  </Typography>
                </Stack>
              </>
            ) : (
              <Alert severity="error">{t("workspace.sshUnsupportedPlatform")}</Alert>
            )}
            {sshInstallConfirming && (
              <Alert severity="error">
                {t("workspace.sshInstallConfirm")}
              </Alert>
            )}
            {sshInstallError && <Alert severity="error">{sshInstallError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={sshInstallBusy} onClick={() => { setSshPreflightIssue(null); setSshInstallConfirming(false); }}>{t("workspace.cancel")}</Button>
          <Button disabled={sshInstallBusy} startIcon={sshInstallBusy ? <CircularProgress size={16} /> : <RefreshIcon />} onClick={() => void recheckSshWorkspace()}>
            {t("workspace.sshRecheck")}
          </Button>
          {sshPreflightIssue?.connected && sshInstallCommand && !sshInstallConfirming && (
            <Button variant="contained" disabled={sshInstallBusy} onClick={() => setSshInstallConfirming(true)}>{t("workspace.sshInstall")}</Button>
          )}
          {sshPreflightIssue?.connected && sshInstallCommand && sshInstallConfirming && (
            <Button color="error" variant="contained" disabled={sshInstallBusy} onClick={() => void installSshCodex()}>
              {t("workspace.sshInstallConfirmed")}
            </Button>
          )}
        </DialogActions>
      </Dialog>
  );
}
