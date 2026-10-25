import { useState, type MouseEvent, type ReactNode } from "react";
import { Button, ButtonGroup, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import ShieldIcon from "@mui/icons-material/Shield";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import type { PermissionPresetId } from "@codex-ui/shared";
import type { TranslateFn } from "../i18n";

type NewChatMode = {
  id: PermissionPresetId;
  labelKey: Parameters<TranslateFn>[0];
  descriptionKey: Parameters<TranslateFn>[0];
  icon: ReactNode;
};

type Props = {
  currentPermission: PermissionPresetId;
  label?: string;
  size?: "small" | "medium";
  t: TranslateFn;
  onNew: (permission: PermissionPresetId) => void;
};

const newChatModes: NewChatMode[] = [
  {
    id: "workspaceAsk",
    labelKey: "newChat.workspace",
    descriptionKey: "newChat.workspaceDescription",
    icon: <ShieldIcon fontSize="small" color="primary" />
  },
  {
    id: "fullAsk",
    labelKey: "newChat.fullAccess",
    descriptionKey: "newChat.fullAccessDescription",
    icon: <LockOpenIcon fontSize="small" color="warning" />
  },
  {
    id: "dangerBypass",
    labelKey: "newChat.danger",
    descriptionKey: "newChat.dangerDescription",
    icon: <ErrorOutlineIcon fontSize="small" color="primary" />
  }
];

export function NewChatButton({ currentPermission, label, size = "small", t, onNew }: Props) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const buttonLabel = label ?? t("newChat.label");

  function openMenu(event: MouseEvent<HTMLButtonElement>) {
    setAnchorEl(event.currentTarget);
  }

  function closeMenu() {
    setAnchorEl(null);
  }

  function choose(permission: PermissionPresetId) {
    closeMenu();
    onNew(permission);
  }

  return (
    <>
      <ButtonGroup size={size} variant="outlined" aria-label={t("newChat.aria")} data-testid="new-chat-button">
        <Button startIcon={<AddIcon />} onClick={() => onNew(currentPermission)}>
          {buttonLabel}
        </Button>
        <Button aria-label={t("newChat.chooseMode")} aria-haspopup="menu" aria-expanded={open ? "true" : undefined} onClick={openMenu} sx={{ px: 0.75 }}>
          <ArrowDropDownIcon fontSize="small" />
        </Button>
      </ButtonGroup>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={closeMenu}
        MenuListProps={{ "aria-label": t("newChat.modes"), dense: true }}
        PaperProps={{ sx: { minWidth: 300 } }}
      >
        {newChatModes.map((mode) => (
          <MenuItem data-testid={`new-chat-mode-${mode.id}`} key={mode.id} selected={currentPermission === mode.id} onClick={() => choose(mode.id)}>
            <ListItemIcon>{mode.icon}</ListItemIcon>
            <ListItemText
              primary={t(mode.labelKey)}
              secondary={
                <Typography variant="caption" color="text.secondary">
                  {t(mode.descriptionKey)}
                </Typography>
              }
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
