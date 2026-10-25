import React, { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  Link,
  Popover,
  Stack,
  Switch,
  Tooltip,
  Typography,
  alpha,
  useTheme
} from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { FreebuffSessionStatus, ClineBalanceInfo } from "../state/codexClient";

export interface ComposerQuotaChipProps {
  activeGroupId?: string | null;
  selectedModel?: string | null;
  freebuffSession: FreebuffSessionStatus | null;
  clineBalance: ClineBalanceInfo | null;
  onRefreshFreebuff: () => Promise<unknown>;
  onRefreshCline: () => Promise<unknown>;
  onReleaseFreebuffSlot?: () => Promise<unknown>;
  freebuffAutoFailover: boolean;
  onToggleFreebuffAutoFailover: (enabled: boolean) => void;
}

export const ComposerQuotaChip: React.FC<ComposerQuotaChipProps> = ({
  activeGroupId,
  selectedModel,
  freebuffSession,
  clineBalance,
  onRefreshFreebuff,
  onRefreshCline,
  onReleaseFreebuffSlot,
  freebuffAutoFailover,
  onToggleFreebuffAutoFailover
}) => {
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);

  const isFreebuff = activeGroupId === "freebuff";
  const isCline = activeGroupId === "cline-free" || (activeGroupId && activeGroupId.includes("cline"));

  if (!isFreebuff && !isCline) {
    return null;
  }

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const open = Boolean(anchorEl);

  // Freebuff specific data
  const freebucks = freebuffSession?.freebucks;
  const freebucksBalance = freebucks?.balance ?? 0;
  const prices = freebucks?.prices || {};
  const currentModelPrice = selectedModel ? (prices[selectedModel] ?? (selectedModel.includes("solar") ? 0 : 5)) : 5;
  const isAffordable = freebucksBalance >= currentModelPrice;
  const isFreebuffActive = Boolean(freebuffSession?.active && freebuffSession.model === selectedModel);
  const remainingSeconds = freebuffSession?.remainingSeconds ?? 0;
  const remainingMinutes = Math.floor(remainingSeconds / 60);

  // Cline specific data
  const clineCredits = clineBalance?.credits ?? 0;
  const formattedClineBalance = clineBalance?.formattedBalance || "$0.00";

  let chipLabel = "";
  let chipColor: "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" = "default";
  let chipIcon: React.ReactElement | undefined = undefined;

  if (isFreebuff) {
    chipIcon = <BoltIcon sx={{ fontSize: "16px !important", color: isAffordable ? "warning.main" : "error.main" }} />;
    if (!isAffordable) {
      chipLabel = `${freebucksBalance} FB (需 ${currentModelPrice})`;
      chipColor = "error";
    } else if (isFreebuffActive) {
      chipLabel = `${freebucksBalance} FB · ⏳ ${remainingMinutes}m`;
      chipColor = "success";
    } else {
      chipLabel = `${freebucksBalance} FB`;
      chipColor = "default";
    }
  } else if (isCline) {
    chipIcon = <CreditCardIcon sx={{ fontSize: "15px !important", color: clineCredits < 1 ? "warning.main" : "primary.main" }} />;
    chipLabel = formattedClineBalance;
    chipColor = clineCredits < 1 ? "warning" : "default";
  }

  return (
    <>
      <Tooltip title={isFreebuff ? "点击查看 Freebuff 会话与额度详情" : "点击查看 Cline 账户余额详情"}>
        <Chip
          size="small"
          icon={chipIcon}
          label={chipLabel}
          color={chipColor}
          variant={chipColor === "default" ? "outlined" : "filled"}
          onClick={handleOpen}
          data-testid="composer-quota-chip"
          sx={{
            height: 28,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            px: 0.5,
            transition: "all 0.2s ease",
            borderColor: chipColor === "default" ? alpha(theme.palette.divider, 0.8) : undefined,
            "&:hover": {
              bgcolor: alpha(theme.palette.primary.main, 0.08),
              borderColor: theme.palette.primary.main
            }
          }}
        />
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
        slotProps={{
          paper: {
            sx: {
              p: 2,
              width: 320,
              maxWidth: "92vw",
              borderRadius: 2,
              boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
              border: "1px solid",
              borderColor: "divider"
            }
          }
        }}
      >
        {isFreebuff && (
          <Stack spacing={1.5}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <BoltIcon color="warning" fontSize="small" />
                <Typography variant="subtitle2" fontWeight={600}>
                  Freebuff 实时额度
                </Typography>
              </Stack>
              <IconButton
                size="small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onRefreshFreebuff();
                  } finally {
                    setBusy(false);
                  }
                }}
                title="刷新额度与插槽状态"
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Stack>

            <Divider />

            {/* Slot status */}
            <Box sx={{ p: 1.25, bgcolor: alpha(theme.palette.background.default, 0.6), borderRadius: 1.5, border: "1px solid", borderColor: "divider" }}>
              <Typography variant="caption" color="text.secondary" fontWeight={500} display="block" sx={{ mb: 0.5 }}>
                会话插槽 (1小时自动续期)
              </Typography>
              {freebuffSession?.active && freebuffSession.model ? (
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "success.main", boxShadow: "0 0 5px rgba(76, 175, 80, 0.9)" }} />
                  <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>
                    {freebuffSession.model}
                  </Typography>
                  <Typography variant="caption" color="success.main" fontWeight={600}>
                    {remainingMinutes}m {remainingSeconds % 60}s
                  </Typography>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  ⚪ 暂无锁定插槽（发送时自动准入）
                </Typography>
              )}
            </Box>

            {/* Freebucks & Quota */}
            <Stack spacing={0.75} sx={{ px: 0.5 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  可用 Freebucks:
                </Typography>
                <Typography variant="body2" fontWeight={700} color={isAffordable ? "text.primary" : "error.main"}>
                  {freebucksBalance} FB
                </Typography>
              </Stack>

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  今日配额 (剩余/总量):
                </Typography>
                <Typography variant="body2" fontWeight={500}>
                  {freebucks?.daily?.remaining ?? "--"} / {freebucks?.daily?.limit ?? "--"} FB
                </Typography>
              </Stack>

              {freebucks?.daily?.resetAt && (
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">
                    每日重置时间:
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(freebucks.daily.resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </Typography>
                </Stack>
              )}

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  当前模型单价:
                </Typography>
                <Typography variant="body2" fontWeight={600} color={currentModelPrice === 0 ? "success.main" : "text.primary"}>
                  {currentModelPrice === 0 ? "0 FB (限免)" : `${currentModelPrice} FB / 次`}
                </Typography>
              </Stack>
            </Stack>

            {!isAffordable && (
              <Box sx={{ p: 1, bgcolor: alpha(theme.palette.error.main, 0.08), borderRadius: 1, border: "1px solid", borderColor: "error.light" }}>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <WarningAmberIcon color="error" fontSize="small" />
                  <Typography variant="caption" color="error.main" fontWeight={500}>
                    当前代币不足以支付 {currentModelPrice} FB，建议切换至 Solar Pro 4 (0 FB) 或充值。
                  </Typography>
                </Stack>
              </Box>
            )}

            <Divider />

            {/* Auto failover switch */}
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={freebuffAutoFailover}
                    onChange={(e) => onToggleFreebuffAutoFailover(e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2" fontWeight={500}>
                    额度耗尽时自动降级模型
                  </Typography>
                }
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ pl: 4.5, mt: -0.5 }}>
                当前模型配额用尽时，自动切换至同价或更便宜的可用模型继续执行。
              </Typography>
            </Box>

            {/* Release slot button */}
            {freebuffSession?.active && onReleaseFreebuffSlot && (
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<DeleteOutlineIcon fontSize="small" />}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onReleaseFreebuffSlot();
                  } finally {
                    setBusy(false);
                    handleClose();
                  }
                }}
                sx={{ textTransform: "none", fontSize: 12 }}
              >
                释放当前模型插槽
              </Button>
            )}
          </Stack>
        )}

        {isCline && (
          <Stack spacing={1.5}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <CreditCardIcon color="primary" fontSize="small" />
                <Typography variant="subtitle2" fontWeight={600}>
                  Cline 账户余额
                </Typography>
              </Stack>
              <IconButton
                size="small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onRefreshCline();
                  } finally {
                    setBusy(false);
                  }
                }}
                title="刷新余额"
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Stack>

            <Divider />

            <Stack spacing={1} sx={{ px: 0.5 }}>
              {clineBalance?.email && (
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">
                    绑定账号:
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {clineBalance.email}
                  </Typography>
                </Stack>
              )}

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  剩余余额:
                </Typography>
                <Typography variant="h6" fontWeight={700} color={clineCredits < 1 ? "warning.main" : "text.primary"}>
                  {formattedClineBalance}
                </Typography>
              </Stack>

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  可用积分 (Credits):
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {clineCredits.toFixed(4)}
                </Typography>
              </Stack>
            </Stack>

            <Divider />

            <Button
              size="small"
              variant="contained"
              endIcon={<OpenInNewIcon fontSize="small" />}
              component={Link}
              href="https://app.cline.bot/dashboard/account?tab=credits"
              target="_blank"
              rel="noopener noreferrer"
              sx={{ textTransform: "none", fontSize: 13 }}
            >
              前往 Cline 控制台充值
            </Button>
          </Stack>
        )}
      </Popover>
    </>
  );
};
