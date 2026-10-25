import { useState } from "react";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ColorLensIcon from "@mui/icons-material/ColorLens";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import HubIcon from "@mui/icons-material/Hub";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import type { TranslateFn } from "../i18n";
import type { ThemeId, ThemeMode, ThemePlugin } from "../theme";

type SetupGuideSection = "appearance" | "workspace" | "relay";

type Props = {
  open: boolean;
  themeMode: ThemeMode;
  themes: ThemePlugin[];
  installedThemePluginIds: ThemeId[];
  t: TranslateFn;
  onThemeChange: (mode: ThemeMode) => void;
  onOpenSettings: (section: SetupGuideSection) => void;
  onComplete: () => void;
  onSkip: () => void;
};

type Step = {
  titleKey: string;
  bodyKey: string;
  icon: typeof RocketLaunchIcon;
  action?: { labelKey: string; section: SetupGuideSection };
};

const STEPS: Step[] = [
  { titleKey: "setupGuide.welcomeTitle", bodyKey: "setupGuide.welcomeBody", icon: RocketLaunchIcon },
  { titleKey: "setupGuide.appearanceTitle", bodyKey: "setupGuide.appearanceBody", icon: ColorLensIcon, action: { labelKey: "setupGuide.appearanceAction", section: "appearance" } },
  { titleKey: "setupGuide.workspaceTitle", bodyKey: "setupGuide.workspaceBody", icon: FolderOpenIcon, action: { labelKey: "setupGuide.workspaceAction", section: "workspace" } },
  { titleKey: "setupGuide.connectionTitle", bodyKey: "setupGuide.connectionBody", icon: HubIcon, action: { labelKey: "setupGuide.connectionAction", section: "relay" } },
  { titleKey: "setupGuide.doneTitle", bodyKey: "setupGuide.doneBody", icon: CheckCircleIcon }
];

export function SetupGuideDialog({ open, themeMode, themes, installedThemePluginIds, t, onThemeChange, onOpenSettings, onComplete, onSkip }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex]!;
  const StepIcon = step.icon;
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const installedThemes = themes.filter((theme) => installedThemePluginIds.includes(theme.id));
  const finalStep = stepIndex === STEPS.length - 1;

  function closeWith(handler: () => void) {
    setStepIndex(0);
    handler();
  }

  return (
    <Dialog open={open} fullWidth maxWidth="md" fullScreen={fullScreen} aria-labelledby="setup-guide-title">
      <DialogTitle id="setup-guide-title" sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 1.5, bgcolor: "primary.main", color: "primary.contrastText" }}><StepIcon fontSize="small" /></Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={800}>{t("setupGuide.title")}</Typography>
            <Typography variant="caption" color="text.secondary">{t("setupGuide.progress", { current: stepIndex + 1, total: STEPS.length })}</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ py: 1 }}>
          <Box>
            <Typography variant="h5" fontWeight={800} sx={{ mb: 0.75 }}>{t(step.titleKey)}</Typography>
            <Typography color="text.secondary">{t(step.bodyKey)}</Typography>
          </Box>
          {stepIndex === 1 && (
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 1 }}>
              {installedThemes.map((theme) => {
                const active = themeMode === theme.id;
                return (
                  <Button key={theme.id} variant={active ? "contained" : "outlined"} onClick={() => onThemeChange(theme.id)} aria-label={t("themeQuickSwitcher.select", { name: theme.name })} sx={{ minHeight: 96, justifyContent: "flex-start", alignItems: "stretch", textAlign: "left", textTransform: "none", p: 1.25 }}>
                    <Stack spacing={0.75} sx={{ width: "100%" }}>
                      <Stack direction="row" spacing={0.5}>{[theme.preview.primary, theme.preview.secondary, theme.preview.background].map((color) => <Box key={color} sx={{ width: 14, height: 14, borderRadius: "50%", bgcolor: color, border: "1px solid", borderColor: "divider" }} />)}</Stack>
                      <Typography variant="body2" fontWeight={750}>{theme.name}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.78 }}>{active ? t("themeQuickSwitcher.current") : theme.description}</Typography>
                    </Stack>
                  </Button>
                );
              })}
            </Box>
          )}
          {step.action && <Button variant="outlined" startIcon={<StepIcon />} onClick={() => onOpenSettings(step.action!.section)} sx={{ alignSelf: "flex-start", textTransform: "none" }}>{t(step.action.labelKey)}</Button>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: fullScreen ? 2 : 3, py: 1.5, flexWrap: "wrap", gap: 0.5, "& .MuiButton-root": fullScreen ? { minHeight: 44 } : undefined }}>
        {!finalStep && <Button color="inherit" onClick={() => closeWith(onSkip)}>{t("setupGuide.skip")}</Button>}
        <Box sx={{ flex: 1, flexBasis: fullScreen ? "100%" : "auto", height: fullScreen ? 0 : "auto" }} />
        <Button disabled={stepIndex === 0} startIcon={<ArrowBackIcon />} onClick={() => setStepIndex((current) => current - 1)}>{t("setupGuide.back")}</Button>
        {finalStep ? <Button variant="contained" endIcon={<CheckCircleIcon />} onClick={() => closeWith(onComplete)}>{t("setupGuide.finish")}</Button> : <Button variant="contained" endIcon={<ArrowForwardIcon />} onClick={() => setStepIndex((current) => current + 1)}>{t("setupGuide.next")}</Button>}
      </DialogActions>
    </Dialog>
  );
}
