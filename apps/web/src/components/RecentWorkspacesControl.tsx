import { useState, useEffect, useCallback, type MouseEvent } from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  Divider,
  ListItemIcon,
  ListItemText
} from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import DnsIcon from "@mui/icons-material/Dns";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  loadRecentWorkspaces,
  removeRecentWorkspace,
  clearRecentWorkspaces,
  type RecentWorkspaceItem
} from "../utils/recentWorkspaces";

interface Props {
  currentPath?: string;
  onSelectWorkspace: (item: RecentWorkspaceItem) => void;
  showChips?: boolean;
  maxChips?: number;
  size?: "small" | "medium";
}

function getBaseName(path: string): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : path;
}

export function RecentWorkspacesControl({
  currentPath,
  onSelectWorkspace,
  showChips = true,
  maxChips = 4,
  size = "small"
}: Props) {
  const [items, setItems] = useState<RecentWorkspaceItem[]>(() => loadRecentWorkspaces());
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const refresh = useCallback(() => {
    setItems(loadRecentWorkspaces());
  }, []);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("codex-recent-workspaces-changed", handler);
    return () => window.removeEventListener("codex-recent-workspaces-changed", handler);
  }, [refresh]);

  const handleOpen = (event: MouseEvent<HTMLElement>) => {
    refresh();
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelect = (item: RecentWorkspaceItem) => {
    handleClose();
    onSelectWorkspace(item);
  };

  const handleDelete = (e: MouseEvent, path: string, mode: "local" | "ssh") => {
    e.stopPropagation();
    const updated = removeRecentWorkspace(path, mode);
    setItems(updated);
  };

  const handleClearAll = (e: MouseEvent) => {
    e.stopPropagation();
    clearRecentWorkspaces();
    setItems([]);
    handleClose();
  };

  if (items.length === 0) {
    return null;
  }

  const chips = items.slice(0, maxChips);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, width: "100%" }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Tooltip title="最近使用的工作目录记忆列表">
          <Button
            size={size}
            variant="outlined"
            color="secondary"
            startIcon={<HistoryIcon fontSize="small" />}
            onClick={handleOpen}
            data-testid="recent-workspaces-button"
            sx={{
              textTransform: "none",
              fontWeight: 700,
              fontSize: 12,
              px: 1,
              py: 0.25,
              whiteSpace: "nowrap"
            }}
          >
            工作目录记忆 ({items.length})
          </Button>
        </Tooltip>

        {showChips && chips.map((item) => {
          const isCurrent = currentPath && item.path.toLowerCase() === currentPath.toLowerCase();
          const baseName = getBaseName(item.path);
          return (
            <Tooltip key={`${item.mode}:${item.path}`} title={`${item.mode === "ssh" ? "[SSH] " : ""}${item.path}`}>
              <Chip
                size="small"
                icon={item.mode === "ssh" ? <DnsIcon fontSize="inherit" /> : <FolderOpenIcon fontSize="inherit" />}
                label={baseName || item.path}
                color={isCurrent ? "primary" : "default"}
                variant={isCurrent ? "filled" : "outlined"}
                onClick={() => onSelectWorkspace(item)}
                sx={{
                  maxWidth: { xs: 150, sm: 220 },
                  fontWeight: isCurrent ? 750 : 500,
                  fontSize: 11,
                  cursor: "pointer",
                  "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" }
                }}
              />
            </Tooltip>
          );
        })}
      </Stack>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{
          sx: {
            maxWidth: 420,
            minWidth: 280,
            maxHeight: 360,
            borderRadius: 2
          }
        }}
        transformOrigin={{ horizontal: "left", vertical: "top" }}
        anchorOrigin={{ horizontal: "left", vertical: "bottom" }}
      >
        <Box sx={{ px: 2, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="caption" sx={{ fontWeight: 800, color: "text.secondary" }}>
            最近使用的工作区目录 ({items.length})
          </Typography>
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlineIcon fontSize="inherit" />}
            onClick={handleClearAll}
            sx={{ fontSize: 11, py: 0, px: 0.5, textTransform: "none" }}
          >
            清空历史
          </Button>
        </Box>
        <Divider />
        {items.map((item) => {
          const isCurrent = currentPath && item.path.toLowerCase() === currentPath.toLowerCase();
          const baseName = getBaseName(item.path);
          return (
            <MenuItem
              key={`${item.mode}:${item.path}`}
              onClick={() => handleSelect(item)}
              selected={Boolean(isCurrent)}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                py: 0.75,
                gap: 1
              }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                {item.mode === "ssh" ? <DnsIcon fontSize="small" color="primary" /> : <FolderOpenIcon fontSize="small" color="action" />}
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {baseName}
                    {item.mode === "ssh" && (
                      <Typography component="span" variant="caption" color="primary" sx={{ ml: 0.75, fontWeight: 750 }}>
                        [SSH]
                      </Typography>
                    )}
                  </Typography>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                    {item.path}
                  </Typography>
                }
              />
              <IconButton
                size="small"
                edge="end"
                onClick={(e) => handleDelete(e, item.path, item.mode)}
                title="从记忆列表中移除"
                sx={{ ml: 0.5, p: 0.25, opacity: 0.6, "&:hover": { opacity: 1 } }}
              >
                <CloseIcon fontSize="small" sx={{ fontSize: 14 }} />
              </IconButton>
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}
