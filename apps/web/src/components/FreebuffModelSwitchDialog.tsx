import CloseIcon from "@mui/icons-material/Close";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SyncAltIcon from "@mui/icons-material/SyncAlt";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography
} from "@mui/material";

export type FreebuffModelSwitchDialogProps = {
  open: boolean;
  currentModel: string;
  targetModel: string;
  remainingSeconds?: number;
  isOwned?: boolean;
  busy?: boolean;
  onConfirmSwitch: () => void | Promise<void>;
  onKeepCurrent: () => void;
  onClose: () => void;
};

function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return "即将过期";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs} 秒`;
  return `${mins} 分 ${secs} 秒`;
}

export function FreebuffModelSwitchDialog({
  open,
  currentModel,
  targetModel,
  remainingSeconds,
  isOwned,
  busy = false,
  onConfirmSwitch,
  onKeepCurrent,
  onClose
}: FreebuffModelSwitchDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          backgroundImage: "none"
        }
      }}
      data-testid="freebuff-model-switch-dialog"
    >
      <DialogTitle sx={{ m: 0, p: 2, pb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <WarningAmberIcon color="warning" sx={{ fontSize: 24 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, fontSize: 16 }}>
              切换 Freebuff 免费模型确认
            </Typography>
            <Typography variant="caption" color="text.secondary">
              上游单插槽限制与会话额度扣减提示
            </Typography>
          </Box>
          {!busy && (
            <IconButton
              aria-label="close"
              onClick={onClose}
              size="small"
              sx={{ color: "text.secondary" }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Alert severity="warning" sx={{ "& .MuiAlert-message": { fontSize: 13, lineHeight: 1.6 } }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
              Freebuff 单插槽机制与额度说明：
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2, "& li": { mb: 0.5 } }}>
              <li>
                <strong>插槽独占</strong>：上游 Codebuff 同一时间仅允许占用 <strong>1 个模型会话插槽</strong>。
              </li>
              <li>
                <strong>额度扣减</strong>：切换到新模型需要<strong>删除当前插槽并重新准入</strong>，重新准入将<strong>消耗 1 次会话额度</strong>（每日有限额）。
              </li>
              <li>
                <strong>终端影响</strong>：{isOwned
                  ? "当前插槽由 Codex Ultra 占用。"
                  : "当前插槽由外部命令行（CLI）占用。强制删除插槽将导致外部终端会话被终止。"}
              </li>
            </Box>
          </Alert>

          <Box
            sx={{
              p: 1.5,
              borderRadius: 1.5,
              bgcolor: "action.hover",
              border: "1px solid",
              borderColor: "divider"
            }}
          >
            <Stack spacing={1.5}>
              {/* Current active slot */}
              <Box
                sx={{
                  p: 1.25,
                  borderRadius: 1,
                  bgcolor: "background.paper",
                  border: "1px solid",
                  borderColor: "success.light"
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Box
                    component="span"
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: "success.main",
                      boxShadow: "0 0 6px rgba(76, 175, 80, 0.8)",
                      flexShrink: 0
                    }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 800, flex: 1, fontFamily: "monospace" }}>
                    {currentModel}
                  </Typography>
                  <Chip
                    size="small"
                    label="当前激活插槽"
                    color="success"
                    variant="outlined"
                    sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
                  />
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: 2.25 }}>
                  <Typography variant="caption" color="text.secondary">
                    {isOwned ? "Codex Ultra 本地占用" : "外部终端 CLI 占用"}
                    {remainingSeconds !== undefined && ` · 剩余约 ${formatRemainingTime(remainingSeconds)}`}
                  </Typography>
                  <Chip
                    size="small"
                    icon={<CheckCircleOutlineIcon sx={{ "&&": { fontSize: 13 } }} />}
                    label="即选即用 · 不消耗额外额度"
                    color="success"
                    sx={{ height: 18, fontSize: 10 }}
                  />
                </Stack>
              </Box>

              {/* Arrow */}
              <Stack direction="row" justifyContent="center">
                <SyncAltIcon sx={{ transform: "rotate(90deg)", color: "text.secondary", fontSize: 20 }} />
              </Stack>

              {/* Target slot */}
              <Box
                sx={{
                  p: 1.25,
                  borderRadius: 1,
                  bgcolor: "background.paper",
                  border: "1px dashed",
                  borderColor: "warning.main"
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Box
                    component="span"
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: "warning.main",
                      boxShadow: "0 0 6px rgba(255, 152, 0, 0.8)",
                      flexShrink: 0
                    }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 800, flex: 1, fontFamily: "monospace" }}>
                    {targetModel}
                  </Typography>
                  <Chip
                    size="small"
                    label="待切换新模型"
                    color="warning"
                    variant="outlined"
                    sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
                  />
                </Stack>
                <Typography variant="caption" color="warning.main" sx={{ pl: 2.25, display: "block" }}>
                  确认后将主动释放旧插槽，并重新准入消耗 1 次额度
                </Typography>
              </Box>
            </Stack>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1.5, gap: 1 }}>
        <Button
          onClick={onClose}
          disabled={busy}
          color="inherit"
          size="small"
        >
          取消
        </Button>
        <Button
          onClick={onKeepCurrent}
          disabled={busy}
          variant="outlined"
          color="success"
          size="small"
          startIcon={<CheckCircleOutlineIcon />}
          sx={{ fontWeight: 700 }}
        >
          保持当前模型 (推荐)
        </Button>
        <Button
          onClick={() => void onConfirmSwitch()}
          disabled={busy}
          variant="contained"
          color="warning"
          size="small"
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <DeleteOutlineIcon />}
          sx={{ fontWeight: 800 }}
        >
          确认删除插槽并切换
        </Button>
      </DialogActions>
    </Dialog>
  );
}
