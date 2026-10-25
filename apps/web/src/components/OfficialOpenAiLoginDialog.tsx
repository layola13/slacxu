import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

export interface OfficialOpenAiLoginDialogProps {
  open: boolean;
  onClose: () => void;
  onStartOAuth: () => Promise<{ loginId: string; authUrl: string; completion: Promise<void> }>;
  onCancelOAuth: (loginId: string) => Promise<void>;
  notice?: string | null;
}

export function OfficialOpenAiLoginDialog({
  open,
  onClose,
  onStartOAuth,
  onCancelOAuth,
  notice
}: OfficialOpenAiLoginDialogProps) {
  const [loading, setLoading] = useState(false);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setLoginId(null);
      setErrorText(null);
      setSuccessText(null);
    }
  }, [open]);

  const handleLogin = async () => {
    setLoading(true);
    setErrorText(null);
    setSuccessText(null);
    try {
      const started = await onStartOAuth();
      setLoginId(started.loginId);
      if (window.codexUltraDesktop) {
        await window.codexUltraDesktop.openExternal(started.authUrl);
      } else {
        window.open(started.authUrl, "_blank", "noopener,noreferrer");
      }
      await started.completion;
      setSuccessText("官方 OpenAI 登录成功，已加入首页模型选择器。");
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
      }, 900);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
      setLoading(false);
      setLoginId(null);
    }
  };

  const handleClose = async () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (loginId) {
      await onCancelOAuth(loginId).catch(() => undefined);
    }
    setLoginId(null);
    setLoading(false);
    onClose();
  };

  return (
    <Dialog open={open} onClose={loading ? undefined : handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>{notice ? "官方 OpenAI 重新登录" : "官方 OpenAI 登录"}</Typography>
        <IconButton size="small" onClick={() => void handleClose()} disabled={!loginId && loading}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ py: 1 }}>
          {notice ? (
            <Alert severity="warning" variant="filled" sx={{ fontWeight: 600 }}>
              {notice}
            </Alert>
          ) : null}
          <Typography variant="body2" color="text.secondary">
            使用 Codex 官方 OAuth，在浏览器中登录 ChatGPT。无需填写 API Key、Base URL 或任何中转配置。
          </Typography>
          {errorText ? <Alert severity="error" variant="outlined">{errorText}</Alert> : null}
          {successText ? <Alert severity="success" variant="outlined">{successText}</Alert> : null}
          {loading ? (
            <Alert severity="info" variant="outlined">
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={16} />
                <span>请在浏览器中完成 OpenAI 登录，完成后此窗口会自动关闭。</span>
              </Stack>
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={() => void handleClose()} disabled={loading && !loginId} color="inherit">取消</Button>
        <Button variant="contained" onClick={() => void handleLogin()} disabled={loading} startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <OpenInNewIcon />}>
          {loading ? "等待浏览器授权..." : notice ? "重新登录官方 OpenAI" : "登录官方 OpenAI"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
