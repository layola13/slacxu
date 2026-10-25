import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED } from "@codex-ui/shared";
import {
  clearFreeModelLicense,
  fetchFreeModelAccessStatus,
  requestFreeModelRequiredCode,
  saveFreeModelLicense,
  type FreeModelAccessStatus,
  type OmniRouteFreeImportResponse
} from "../state/codexClient";
import { DiscordIcon } from "./icons/DiscordIcon";

type Props = {
  open: boolean;
  token: string | null;
  /** Model ids currently synced from the free channel; unknown when absent. */
  syncedModels?: string[];
  onClose: () => void;
  onOpenDiscord: () => void;
  onSync: () => Promise<OmniRouteFreeImportResponse>;
};

export function FreeModelAccessDialog({ open, token, syncedModels, onClose, onOpenDiscord, onSync }: Props) {
  const [status, setStatus] = useState<FreeModelAccessStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visibleModels = useMemo(() => [...new Set(syncedModels ?? [])].sort(), [syncedModels]);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      let next = await fetchFreeModelAccessStatus(token);
      // Keep the existing required-code flow for a future re-enable, but do
      // not contact it while public free-model sync is running without keys.
      if (FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED && next.configured && !next.license.valid) {
        next = await requestFreeModelRequiredCode(token);
      }
      setStatus(next);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setError(null);
    void load();
  }, [load, open]);

  const command = useMemo(() => status?.requirement?.requiredCode
    ? `/free-key required:${status.requirement.requiredCode}`
    : "", [status?.requirement?.requiredCode]);

  const openExternal = (url: string) => {
    if (window.codexUltraDesktop) void window.codexUltraDesktop.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyCommand = async () => {
    if (!command) return;
    await navigator.clipboard.writeText(command);
    setMessage("Discord 命令已复制。");
  };

  const activateAndRefresh = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const activated = await saveFreeModelLicense(token, key);
      setStatus(activated);
      const result = await onSync();
      setMessage(`密钥验证成功，已同步 ${result.importedModels} 个免费模型。`);
      setKey("");
    } catch (activateError) {
      setError(errorText(activateError));
    } finally {
      setBusy(false);
    }
  };

  const refreshModels = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await onSync();
      setMessage(`已同步 ${result.importedModels} 个免费模型；可随时点击右上角 X 关闭此窗口。`);
    } catch (refreshError) {
      setError(errorText(refreshError));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const cleared = await clearFreeModelLicense(token);
      setStatus(cleared.configured && FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED ? await requestFreeModelRequiredCode(token) : cleared);
      setMessage("本机保存的免费模型密钥已移除。");
    } catch (removeError) {
      setError(errorText(removeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" data-testid="free-model-access-dialog">
      <DialogTitle sx={{ pr: 6, position: "relative" }}>
        刷新 CodexUltraFree 免费模型
        {visibleModels.length > 0 ? (
          <Tooltip
            arrow
            placement="bottom-start"
            title={
              <Stack spacing={0.5} sx={{ py: 0.25 }}>
                <Typography variant="caption" fontWeight={800}>已同步的真实模型 ID</Typography>
                <Typography variant="caption" color="text.secondary">
                  CodexUltraFree 不再将 GPT、Claude 或其他聊天模型映射到免费渠道；请选择下列真实模型 ID。
                </Typography>
                {visibleModels.map((model) => (
                  <Typography variant="caption" key={model} sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {model}
                  </Typography>
                ))}
              </Stack>
            }
            slotProps={{ tooltip: { sx: { maxWidth: 420 } } }}
          >
            <Typography
              component="span"
              variant="caption"
              tabIndex={0}
              sx={{ ml: 1, color: "error.main", fontWeight: 900, cursor: "help", whiteSpace: "nowrap" }}
            >
              已同步 {visibleModels.length} 个真实模型
            </Typography>
          </Tooltip>
        ) : null}
        <IconButton
          aria-label="关闭"
          onClick={onClose}
          disabled={busy}
          size="small"
          color="inherit"
          sx={{ position: "absolute", top: 8, right: 8 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info">
            每天额度不限。免费模型可能有并发限制或短时 429，建议加入 Discord 群了解当前可用模型和并发情况。
          </Alert>

          <Button
            startIcon={<DiscordIcon fontSize="small" />}
            variant="outlined"
            onClick={onOpenDiscord}
            sx={{ alignSelf: "flex-start" }}
          >
            加入 Discord 群了解详情
          </Button>

          {status?.campaign ? (
            <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden" }} data-campaign-id={status.campaign.id}>
              {status.campaign.imageUrl ? (
                <Box component="img" src={status.campaign.imageUrl} alt="" sx={{ display: "block", width: "100%", maxHeight: 220, objectFit: "cover" }} />
              ) : null}
              <Stack spacing={1} sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight={800}>{status.campaign.title}</Typography>
                <Typography variant="body2" color="text.secondary">{status.campaign.message}</Typography>
                {status.campaign.targetUrl ? (
                  <Button size="small" endIcon={<OpenInNewIcon />} onClick={() => openExternal(status.campaign!.targetUrl!)} sx={{ alignSelf: "flex-start" }}>
                    查看详情
                  </Button>
                ) : null}
              </Stack>
            </Box>
          ) : null}

          {busy && !status ? <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}><CircularProgress size={28} /></Box> : null}
          {FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED && status?.serviceError ? <Alert severity="error">{status.serviceError}</Alert> : null}
          {error ? <Alert severity="error" onClose={() => setError(null)}>{error}</Alert> : null}
          {message ? <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert> : null}

          {status ? (
            <Stack spacing={1}>
              {FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED ? (
                <>
                  <Typography variant="body2"><strong>机器码：</strong>{status.machineCode}</Typography>
                  <Typography variant="body2">
                    <strong>刷新状态：</strong>{status.developmentMachine
                      ? "开发机器无限制"
                      : status.refreshRequired ? "需要刷新" : `已刷新，下次时间 ${formatDate(status.nextRequiredRefreshAt)}`}
                  </Typography>
                  {status.developmentMachine ? (
                    <Typography variant="body2"><strong>开发权限：</strong>免密、无限制</Typography>
                  ) : status.license.valid ? (
                    <>
                      <Typography variant="body2"><strong>密钥：</strong>{status.license.keyPreview ?? "已保存"}</Typography>
                      <Typography variant="body2"><strong>密钥到期：</strong>{formatDate(status.license.expiresAt)}</Typography>
                    </>
                  ) : null}
                </>
              ) : null}
            </Stack>
          ) : null}

          {FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED && status && !status.license.valid && status.configured ? (
            <>
              <Divider />
              <Alert severity="warning">
                请加入官方 Discord，在 <strong>get-free-key</strong> 频道发送下面的 Slash Command。required 码仅绑定当前机器且会过期。
              </Alert>
              <TextField
                label="Discord 命令"
                value={command}
                fullWidth
                slotProps={{ input: { readOnly: true } }}
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button startIcon={<DiscordIcon fontSize="small" />} variant="outlined" onClick={() => openExternal(status.discordInviteUrl)}>
                  打开官方 Discord
                </Button>
                <Button startIcon={<ContentCopyIcon />} variant="outlined" disabled={!command} onClick={() => void copyCommand()}>
                  复制命令
                </Button>
              </Stack>
              <TextField
                label="输入 cxu- 密钥"
                value={key}
                onChange={(event) => setKey(event.target.value.trim())}
                placeholder="cxu-..."
                fullWidth
                autoComplete="off"
                error={Boolean(key) && !/^cxu-[A-Za-z0-9]{48}$/.test(key)}
                helperText="格式为 cxu- 加 48 位字母数字，共 52 位。"
              />
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED && status?.license.valid && !status.developmentMachine ? (
          <Button color="error" startIcon={<DeleteOutlineIcon />} disabled={busy} onClick={() => void removeKey()}>
            移除密钥
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={busy}>稍后</Button>
        {FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED && status?.license.valid ? (
          <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />} disabled={busy} onClick={() => void refreshModels()}>
            {status.developmentMachine ? "立即同步" : "立即刷新"}
          </Button>
        ) : FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED ? (
          <Button variant="contained" disabled={busy || !/^cxu-[A-Za-z0-9]{48}$/.test(key)} onClick={() => void activateAndRefresh()}>
            验证密钥并刷新
          </Button>
        ) : (
          <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />} disabled={busy || !token} onClick={() => void refreshModels()}>
            确定并同步
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function formatDate(value: number | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "首次刷新后计算";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
