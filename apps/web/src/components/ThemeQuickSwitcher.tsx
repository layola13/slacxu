import { useState } from "react";
import CheckIcon from "@mui/icons-material/Check";
import ColorLensIcon from "@mui/icons-material/ColorLens";
import SettingsIcon from "@mui/icons-material/Settings";
import { Box, Button, IconButton, ListItemIcon, ListItemText, MenuItem, Popover, Stack, Tooltip, Typography } from "@mui/material";
import type { TranslateFn } from "../i18n";
import type { ThemeId, ThemeMode, ThemePlugin } from "../theme";

type Props = {
  themeMode: ThemeMode;
  themes: ThemePlugin[];
  installedThemePluginIds: ThemeId[];
  t: TranslateFn;
  onThemeChange: (mode: ThemeMode) => void;
  onOpenAppearance: () => void;
};

export function ThemeQuickSwitcher({ themeMode, themes, installedThemePluginIds, t, onThemeChange, onOpenAppearance }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const installedThemes = themes.filter((theme) => installedThemePluginIds.includes(theme.id));

  function selectTheme(mode: ThemeMode) {
    onThemeChange(mode);
    setAnchor(null);
  }

  return (
    <>
      <Tooltip title={t("themeQuickSwitcher.open")}>
        <IconButton size="small" aria-label={t("themeQuickSwitcher.open")} data-testid="theme-quick-switcher-button" onClick={(event) => setAnchor(event.currentTarget)}>
          <ColorLensIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 286, maxWidth: "calc(100vw - 24px)", mt: 0.75 } } }}
      >
        <Box sx={{ px: 1.5, pt: 1.25, pb: 0.75 }}>
          <Typography variant="subtitle2" fontWeight={800}>{t("themeQuickSwitcher.open")}</Typography>
        </Box>
        {installedThemes.map((theme) => {
          const active = theme.id === themeMode;
          return (
            <MenuItem key={theme.id} selected={active} onClick={() => selectTheme(theme.id)} aria-label={t("themeQuickSwitcher.select", { name: theme.name })} sx={{ py: 1 }}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                {active ? <CheckIcon fontSize="small" color="primary" /> : <Stack direction="row" spacing={0.25}>{[theme.preview.primary, theme.preview.secondary, theme.preview.background].map((color) => <Box key={color} sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, border: "1px solid", borderColor: "divider" }} />)}</Stack>}
              </ListItemIcon>
              <ListItemText primary={theme.name} secondary={active ? t("themeQuickSwitcher.current") : theme.description} slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }} />
            </MenuItem>
          );
        })}
        <Box sx={{ borderTop: "1px solid", borderColor: "divider", p: 0.75 }}>
          <Button fullWidth size="small" startIcon={<SettingsIcon />} onClick={() => { setAnchor(null); onOpenAppearance(); }} sx={{ justifyContent: "flex-start", textTransform: "none" }}>
            {t("themeQuickSwitcher.more")}
          </Button>
        </Box>
      </Popover>
    </>
  );
}
