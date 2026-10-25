import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import type { ChangeEvent as ReactChangeEvent, ClipboardEvent as ReactClipboardEvent, Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";

export interface RelayShareDialogsProps {
  relayShareExportOpen: boolean;
  relayShareExportBusy: boolean;
  relayShareExportPassword: string;
  relayShareExportConfirm: string;
  relayShareExportError: string | null;
  relayShareExportText: string;
  setRelayShareExportOpen: Dispatch<SetStateAction<boolean>>;
  setRelayShareExportPassword: Dispatch<SetStateAction<string>>;
  setRelayShareExportConfirm: Dispatch<SetStateAction<string>>;
  setRelayShareExportError: Dispatch<SetStateAction<string | null>>;
  createRelayShare: () => Promise<void>;
  copyRelayShare: () => Promise<void>;
  relayShareImportOpen: boolean;
  relayShareImportBusy: boolean;
  relayShareImportText: string;
  relayShareImportPassword: string;
  relayShareImportError: string | null;
  setRelayShareImportOpen: Dispatch<SetStateAction<boolean>>;
  setRelayShareImportText: Dispatch<SetStateAction<string>>;
  setRelayShareImportPassword: Dispatch<SetStateAction<string>>;
  importRelayShareDirectly: () => Promise<void>;
}

export function RelayShareDialogs({
  relayShareExportOpen,
  relayShareExportBusy,
  relayShareExportPassword,
  relayShareExportConfirm,
  relayShareExportError,
  relayShareExportText,
  setRelayShareExportOpen,
  setRelayShareExportPassword,
  setRelayShareExportConfirm,
  setRelayShareExportError,
  createRelayShare,
  copyRelayShare,
  relayShareImportOpen,
  relayShareImportBusy,
  relayShareImportText,
  relayShareImportPassword,
  relayShareImportError,
  setRelayShareImportOpen,
  setRelayShareImportText,
  setRelayShareImportPassword,
  importRelayShareDirectly,
}: RelayShareDialogsProps) {
  return (
    <>
      <Dialog open={relayShareExportOpen} onClose={() => !relayShareExportBusy && setRelayShareExportOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>分享中转站</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">分享内容包含密钥，请仅发送给可信用户。</Typography>
            <TextField label="分享密码" type="password" value={relayShareExportPassword} onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setRelayShareExportPassword(event.target.value); setRelayShareExportError(null); }} disabled={relayShareExportBusy} fullWidth />
            <TextField label="确认密码" type="password" value={relayShareExportConfirm} onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setRelayShareExportConfirm(event.target.value); setRelayShareExportError(null); }} disabled={relayShareExportBusy} fullWidth />
            {relayShareExportError ? <Alert severity="error">{relayShareExportError}</Alert> : null}
            <Button variant="contained" onClick={() => void createRelayShare()} disabled={relayShareExportBusy} startIcon={relayShareExportBusy ? <CircularProgress size={16} color="inherit" /> : undefined}>
              {relayShareExportBusy ? "正在生成分享内容…" : "生成分享内容"}
            </Button>
            {relayShareExportText ? <Stack spacing={1}>
              <TextField value={relayShareExportText} multiline minRows={4} fullWidth InputProps={{ readOnly: true }} onCopy={(event: ReactClipboardEvent<HTMLDivElement>) => event.preventDefault()} onCut={(event: ReactClipboardEvent<HTMLDivElement>) => event.preventDefault()} onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => event.preventDefault()} sx={{ "& textarea": { userSelect: "none" } }} />
              <Button variant="outlined" onClick={() => void copyRelayShare()}>复制分享内容</Button>
            </Stack> : null}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setRelayShareExportOpen(false)} disabled={relayShareExportBusy}>关闭</Button></DialogActions>
      </Dialog>
      <Dialog open={relayShareImportOpen} onClose={() => !relayShareImportBusy && setRelayShareImportOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>导入分享中转站</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <TextField label="分享内容" value={relayShareImportText} onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setRelayShareImportText(event.target.value)} multiline minRows={3} fullWidth onCopy={(event: ReactClipboardEvent<HTMLDivElement>) => event.preventDefault()} onCut={(event: ReactClipboardEvent<HTMLDivElement>) => event.preventDefault()} onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => event.preventDefault()} sx={{ "& textarea": { userSelect: "none" } }} />
            <TextField label="分享密码" type="password" value={relayShareImportPassword} onChange={(event: ReactChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setRelayShareImportPassword(event.target.value)} fullWidth />
            {relayShareImportError ? <Alert severity="error">{relayShareImportError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRelayShareImportOpen(false)} disabled={relayShareImportBusy}>取消</Button>
          <Button variant="contained" onClick={() => void importRelayShareDirectly()} disabled={relayShareImportBusy || !relayShareImportText || !relayShareImportPassword}>{relayShareImportBusy ? <CircularProgress size={18} /> : "直接导入"}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
