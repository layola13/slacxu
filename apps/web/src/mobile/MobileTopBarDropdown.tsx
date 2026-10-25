import { Box, Chip, FormControl, IconButton, MenuItem, Select, Stack, Tooltip } from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";
import ChecklistIcon from "@mui/icons-material/Checklist";
import AssessmentIcon from "@mui/icons-material/Assessment";
import SettingsIcon from "@mui/icons-material/Settings";
import { SystemMetricsTopBarBadge } from "../components/SystemMetricsTopBarBadge";
import { ThemeQuickSwitcher } from "../components/ThemeQuickSwitcher";
import { localeOptions, type Locale, type TranslateFn } from "../i18n";
import type { ThemeMode, ThemePlugin, ThemeId } from "../theme";

type MetricsScope = { type: "local" } | { type: "ssh"; command: string; cwd: string };

type Props = {
  token?: string;
  scope: MetricsScope;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  t: TranslateFn;
  themeMode: ThemeMode;
  themes: ThemePlugin[];
  installedThemePluginIds: ThemeId[];
  onThemeChange: (mode: ThemeMode) => void;
  onOpenAppearance: () => void;
  isClaudeBackend: boolean;
  isAgyBackend: boolean;
  isGrokBackend: boolean;
  isPiBackend: boolean;
  isOpencodeBackend: boolean;
  isOpencodeV2Backend?: boolean;
  isCodexBackend: boolean;
  onOpenCliSwitcher: (event: React.MouseEvent<HTMLElement>) => void;
  onRefreshCli: () => void;
  fastModeEnabled: boolean;
  planModeEnabled: boolean;
  onOpenStats: () => void;
  onOpenSettings: () => void;
};

// 移动端下拉区合并为单行：左侧放 CLI + 快捷徽标 + 性能，右侧放语言 + 主题 + 统计 + 设置。
// 与顶栏 52px 合计 2 行，替代此前的 3 行（顶栏 + 性能语言行 + CLI 设置行）。
export function MobileTopBarDropdownContent({
  token,
  scope,
  locale,
  onLocaleChange,
  t,
  themeMode,
  themes,
  installedThemePluginIds,
  onThemeChange,
  onOpenAppearance,
  isClaudeBackend,
  isAgyBackend,
  isGrokBackend,
  isPiBackend,
  isOpencodeBackend,
  isOpencodeV2Backend,
  isCodexBackend,
  onOpenCliSwitcher,
  onRefreshCli,
  fastModeEnabled,
  planModeEnabled,
  onOpenStats,
  onOpenSettings
}: Props) {
  const cliSrc = isClaudeBackend
    ? "/icons/claudecode-color.svg"
    : isAgyBackend
      ? "/icons/agy-color.svg"
      : isGrokBackend
        ? "/icons/grok.svg"
        : isPiBackend
          ? "/icons/pi.svg"
          : isOpencodeBackend
            ? "/icons/opencode.svg"
            : isOpencodeV2Backend
              ? "/icons/opencode-v2.svg"
              : isCodexBackend
                ? "/icons/codex-color.svg"
                : "/icons/mini.svg";
  const cliAlt = isClaudeBackend
    ? "Claude CLI"
    : isAgyBackend
      ? "Antigravity CLI"
      : isGrokBackend
        ? "Grok CLI"
        : isPiBackend
          ? "Pi Agent"
          : isOpencodeBackend
            ? "OpenCode CLI"
            : isOpencodeV2Backend
              ? "OpenCode v2 CLI"
              : isCodexBackend
              ? "Codex CLI"
              : "Mini";
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        flexWrap="wrap"
        useFlexGap
        data-testid="mobile-topbar-dropdown-merged"
      >
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, flex: "1 1 auto" }}>
          <Tooltip title={cliAlt}>
            <Box
              onClick={(event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
                onOpenCliSwitcher(event);
                onRefreshCli();
              }}
              data-testid="mobile-topbar-cli-switcher-trigger"
              sx={{ position: "relative", width: 26, height: 26, flex: "0 0 26px", cursor: "pointer", display: "flex", alignItems: "center" }}
            >
              <Box component="img" src={cliSrc} alt={cliAlt} sx={{ width: 26, height: 26, objectFit: "contain" }} />
            </Box>
          </Tooltip>
          {fastModeEnabled && (
            <Chip size="small" color="warning" icon={<BoltIcon />} label={t("app.fast")} sx={{ height: 24, fontSize: 11, fontWeight: 800 }} />
          )}
          {planModeEnabled && (
            <Chip size="small" color="primary" icon={<ChecklistIcon />} label={t("app.plan")} sx={{ height: 24, fontSize: 11, fontWeight: 800 }} />
          )}
          <SystemMetricsTopBarBadge token={token} scope={scope} compact />
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flex: "0 0 auto" }}>
          <FormControl size="small" sx={{ minWidth: 86 }}>
            <Select
              value={locale}
              inputProps={{ "aria-label": t("app.language") }}
              onChange={(event) => onLocaleChange(event.target.value as Locale)}
              sx={{ "& .MuiSelect-select": { py: 0.5, fontSize: 12, fontWeight: 750 } }}
            >
              {localeOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <ThemeQuickSwitcher
            themeMode={themeMode}
            themes={themes}
            installedThemePluginIds={installedThemePluginIds}
            t={t}
            onThemeChange={onThemeChange}
            onOpenAppearance={onOpenAppearance}
          />
          <Tooltip title={t("app.sessionStats")}>
            <IconButton
              size="small"
              onClick={onOpenStats}
              aria-label={t("app.sessionStats")}
              data-testid="mobile-topbar-session-stats-button"
              sx={{ width: 32, height: 32 }}
            >
              <AssessmentIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("settings.title")}>
            <IconButton
              size="small"
              onClick={onOpenSettings}
              aria-label={t("settings.title")}
              sx={{ width: 32, height: 32 }}
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
    </Box>
  );
}
