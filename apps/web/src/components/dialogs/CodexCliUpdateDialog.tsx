import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import type { Dispatch, SetStateAction } from "react";
import type { CliInstallationKind, CodexCliUpdateStatus } from "../../state/codexClient";
import { formatErrorText } from "../../app/workbench/appUtils";
import type { TranslateFn } from "../../i18n";

export interface CodexCliUpdateDialogProps {
  t: TranslateFn;
  codexCliUpdateDialogOpen: boolean;
  setCodexCliUpdateDialogOpen: Dispatch<SetStateAction<boolean>>;
  codexCliUpdateStatus: CodexCliUpdateStatus | null;
  codexCliUpdateError: string | null;
  setCodexCliUpdateError: Dispatch<SetStateAction<string | null>>;
  codexCliUpdateBusy: boolean;
  setCodexCliUpdateBusy: Dispatch<SetStateAction<boolean>>;
  state: { token: string | null };
  checkCodexCliUpdate: (token: string) => void;
  refreshCliInstallations: (refreshToken: string, kinds?: CliInstallationKind[]) => void;
}

export function CodexCliUpdateDialog({
  t,
  codexCliUpdateDialogOpen,
  setCodexCliUpdateDialogOpen,
  codexCliUpdateStatus,
  codexCliUpdateError,
  setCodexCliUpdateError,
  codexCliUpdateBusy,
  setCodexCliUpdateBusy,
  state,
  checkCodexCliUpdate,
  refreshCliInstallations,
}: CodexCliUpdateDialogProps) {
  return (
      <Dialog
        data-testid="codex-cli-update-dialog"
        open={codexCliUpdateDialogOpen}
        onClose={() => { setCodexCliUpdateDialogOpen(false); setCodexCliUpdateError(null); }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box component="span" sx={{ fontSize: 20, lineHeight: 1 }}>✨</Box>
            <Typography component="span" variant="h6" sx={{ fontWeight: 850 }}>
              {t("app.codexCliUpdateTitle")}
            </Typography>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {t("app.codexCliUpdateDesc", { current: codexCliUpdateStatus?.currentVersion ?? "", latest: codexCliUpdateStatus?.latestVersion ?? "" })}
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: "monospace", bgcolor: "action.hover", p: 1, borderRadius: 1 }}>
              {t("app.codexCliUpdateCommand")}
            </Typography>
            {codexCliUpdateError && (
              <Alert severity="error" variant="filled">{codexCliUpdateError}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCodexCliUpdateDialogOpen(false); setCodexCliUpdateError(null); }}>
            {t("app.codexCliUpdateLater")}
          </Button>
          <Button
            variant="contained"
            disabled={codexCliUpdateBusy}
            onClick={async () => {
              setCodexCliUpdateBusy(true);
              setCodexCliUpdateError(null);
              try {
                const response = await fetch("/api/codex/cli-update/apply", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-codex-ui-token": state.token ?? "" },
                  body: JSON.stringify({ confirm: true }),
                });
                const body = (await response.json().catch(() => ({}))) as { data?: unknown; error?: string };
                if (!response.ok) throw new Error(body.error ?? `Update failed (${response.status})`);
                setCodexCliUpdateDialogOpen(false);
                if (state.token) {
                  checkCodexCliUpdate(state.token);
                  refreshCliInstallations(state.token, ["codex"]);
                }
              } catch (error) {
                setCodexCliUpdateError(formatErrorText(error));
              } finally {
                setCodexCliUpdateBusy(false);
              }
            }}
          >
            {codexCliUpdateBusy ? t("app.codexCliUpdating") : t("app.codexCliUpdateNow")}
          </Button>
        </DialogActions>
      </Dialog>
  );
}
