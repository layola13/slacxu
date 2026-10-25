import { Box, Collapse, IconButton, Tooltip, Typography } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import AddIcon from "@mui/icons-material/Add";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SpeedIcon from "@mui/icons-material/Speed";
import type { ReactNode } from "react";

type Props = {
  title?: string;
  providerLabel: string;
  modelLabel: string;
  statusKind?: string;
  statusLabel?: string;
  running?: boolean;
  dropdownOpen?: boolean;
  onToggleDropdown?: () => void;
  dropdownContent?: ReactNode;
  onOpenHistory: () => void;
  onOpenRelay: (event: React.MouseEvent<HTMLElement>) => void;
  onNewChat: () => void;
  onCollapseTopBar?: () => void;
  collapseTopBarLabel?: string;
};

// 移动版顶栏（52px）：
// 左侧：历史抽屉按钮 + 紧凑中转设置按钮（不占满，点击弹出设置）
// 中间：当前对话标题 + 下拉提示（点击可切换顶栏下拉）
// 右侧：下拉性能/语言面板按钮 + 新建对话 + 按钮
export function MobileTopBar({
  title,
  providerLabel,
  modelLabel,
  statusKind,
  statusLabel,
  running,
  dropdownOpen,
  onToggleDropdown,
  dropdownContent,
  onOpenHistory,
  onOpenRelay,
  onNewChat,
  onCollapseTopBar,
  collapseTopBarLabel
}: Props) {
  const statusColor =
    running || statusKind === "connecting"
      ? "#3b82f6"
      : statusKind === "idle"
        ? "#22c55e"
        : statusKind === "disconnect" || statusKind === "engine-error"
          ? "#ef4444"
          : statusKind === "retrying"
            ? "#f59e0b"
            : "#9ca3af";

  return (
    <Box
      sx={{
        flex: "0 0 auto",
        minWidth: 0,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxWidth: "100%",
        borderBottom: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper"
      }}
    >
      <Box
        data-testid="mobile-top-bar"
        sx={{
          height: 52,
          flex: "0 0 52px",
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 0.75,
          px: 1,
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box"
        }}
      >
        {/* 左侧：汉堡历史按钮 + 状态点（标题优先，中转设置只留状态点，点击仍进设置） */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: "0 0 auto", minWidth: 0 }}>
          <IconButton
            aria-label="history"
            data-testid="mobile-history-button"
            onClick={onOpenHistory}
            sx={{ width: 36, height: 36 }}
          >
            <MenuIcon fontSize="small" />
          </IconButton>
          <Tooltip title={`${providerLabel} · ${modelLabel}`}>
            <Box
              component="button"
              type="button"
              data-testid="mobile-status-capsule"
              aria-label="relay-settings"
              onClick={onOpenRelay}
              style={{ cursor: "pointer" }}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: 999,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "action.hover",
                color: "text.primary",
                flex: "0 0 auto",
                overflow: "hidden"
              }}
            >
              <Box
                data-testid="mobile-status-dot"
                data-status-kind={statusKind ?? (running ? "running" : "idle")}
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  flex: "0 0 auto",
                  bgcolor: statusColor,
                  boxShadow: running ? `0 0 6px ${statusColor}` : "none"
                }}
              />
            </Box>
          </Tooltip>
        </Box>

        {/* 中间：当前对话标题（点击可下拉查看顶栏性能与语言等） */}
        <Box
          component="button"
          type="button"
          onClick={onToggleDropdown}
          style={{ cursor: onToggleDropdown ? "pointer" : "default" }}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.25,
            border: 0,
            bgcolor: "transparent",
            p: 0,
            color: "inherit",
            textAlign: "center"
          }}
        >
          <Typography
            variant="subtitle2"
            noWrap
            data-testid="mobile-conversation-title"
            sx={{
              fontWeight: 800,
              fontSize: 13,
              lineHeight: 1.2,
              minWidth: 0,
              flexShrink: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              textAlign: "center",
              maxWidth: "100%"
            }}
          >
            {title || "Codex Ultra"}
          </Typography>
          {onToggleDropdown && (
            <ExpandMoreIcon
              sx={{
                fontSize: 16,
                color: "text.secondary",
                flex: "0 0 auto",
                transform: dropdownOpen ? "rotate(180deg)" : "none",
                transition: "transform 180ms ease"
              }}
            />
          )}
        </Box>

        {/* 右侧：下拉性能/设置触发按钮 + 新建对话 + 折叠顶栏按钮 */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: "0 0 auto" }}>
          {onToggleDropdown && (
            <Tooltip title="性能与语言">
              <IconButton
                aria-label="system-topbar"
                data-testid="mobile-topbar-dropdown-button"
                onClick={onToggleDropdown}
                color={dropdownOpen ? "primary" : "default"}
                sx={{ width: 34, height: 34 }}
              >
                <SpeedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <IconButton
            aria-label="new chat"
            data-testid="mobile-new-chat-button"
            onClick={onNewChat}
            color="primary"
            sx={{ width: 36, height: 36 }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
          {onCollapseTopBar && (
            <Tooltip title={collapseTopBarLabel ?? "收起顶栏"}>
              <IconButton
                aria-label={collapseTopBarLabel ?? "收起顶栏"}
                data-testid="mobile-collapse-topbar-button"
                onClick={onCollapseTopBar}
                sx={{ width: 34, height: 34 }}
              >
                <ExpandLessIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* 下拉看性能，语言。。。etc 顶栏 */}
      {dropdownContent && (
        <Collapse in={dropdownOpen} unmountOnExit>
          <Box
            data-testid="mobile-topbar-dropdown"
            sx={{
              borderTop: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
              px: 1.25,
              py: 1,
              boxShadow: (theme) => theme.customShadows?.card || "0 4px 12px rgba(0,0,0,0.12)"
            }}
          >
            {dropdownContent}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}
