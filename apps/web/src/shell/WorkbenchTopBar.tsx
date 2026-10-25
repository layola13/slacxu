import { AppBar, Box, Button, Chip, FormControl, IconButton, MenuItem, Select, Toolbar, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import AssessmentIcon from "@mui/icons-material/Assessment";
import BoltIcon from "@mui/icons-material/Bolt";
import ChecklistIcon from "@mui/icons-material/Checklist";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import SettingsIcon from "@mui/icons-material/Settings";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import type { ComponentProps, Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import type { PermissionPresetId } from "@codex-ui/shared";
import { DiscordIcon } from "../components/icons/DiscordIcon";
import { NewChatButton } from "../components/NewChatButton";
import { SystemMetricsTopBarBadge } from "../components/SystemMetricsTopBarBadge";
import { ThemeQuickSwitcher } from "../components/ThemeQuickSwitcher";
import { MobileTopBar } from "../mobile/MobileTopBar";
import { MobileTopBarDropdownContent } from "../mobile/MobileTopBarDropdown";
import { fastReasoningEffort } from "../app/workbench/appUtils";
import { displayThreadTitle } from "../app/threads/threadCatalog";
import { reasoningEffortLabel } from "../modelReasoning";
import { describeCliSwitcherTooltip } from "../app/cli/cliBackendLabels";
import { localeOptions, type Locale } from "../i18n";
import type { ThemeBackgroundMedia } from "../components/ThemeBackgroundMedia";
import type { ReasoningOption, SettingsSectionId } from "../settings/SettingsDrawer";
import type { CodexPluginSettingsTab } from "../components/CodexPluginSettingsPanel";
import type { RightWorkspaceTab } from "../components/RightWorkspacePanel";
import type { CliBackendVersionLabelBackend } from "../app/cli/useCliInstallations";
import type { ThreadRuntimeSelection } from "../app/runtime/useThreadRuntimeSelections";
import type { ClientState, CliInstallationKind, CodexCliUpdateStatus, ThreadEntry } from "../state/codexClient";
import type { TranslateFn } from "../i18n";

export interface WorkbenchTopBarProps {
  t: TranslateFn;
  immersiveView: boolean;
  isMobile: boolean;
  topBarPinned: boolean;
  openTopBar: () => void;
  scheduleTopBarHide: () => void;
  topBarOpen: boolean;
  themeTuning: ComponentProps<typeof ThemeBackgroundMedia>["tuning"];
  enterImmersiveView: () => void;
  openOfficialWebsite: () => void;
  openDiscordInvite: () => void;
  fastModeEnabled: boolean;
  reasoningOptions: ReasoningOption[];
  reasoningEffort: string;
  planModeEnabled: boolean;
  permission: PermissionPresetId;
  requestNewSession: (permission: PermissionPresetId) => void;
  state: Pick<ClientState, "token" | "engine" | "activeThreadId">;
  systemMetricsScope: ComponentProps<typeof MobileTopBarDropdownContent>["scope"];
  desktopLayout: boolean;
  rightWorkspaceVisible: boolean;
  closeRightWorkspace: () => void;
  setRightWorkspaceTab: Dispatch<SetStateAction<RightWorkspaceTab>>;
  setRightWorkspaceVisible: Dispatch<SetStateAction<boolean>>;
  setStatsPanelScope: Dispatch<SetStateAction<"status" | "stats" | null>>;
  themeMode: ComponentProps<typeof ThemeQuickSwitcher>["themeMode"];
  allThemePlugins: ComponentProps<typeof ThemeQuickSwitcher>["themes"];
  installedThemePluginIds: ComponentProps<typeof ThemeQuickSwitcher>["installedThemePluginIds"];
  onThemeModeChange: ComponentProps<typeof ThemeQuickSwitcher>["onThemeChange"];
  openSettings: (section?: SettingsSectionId, pluginTab?: CodexPluginSettingsTab, relayTarget?: { providerId?: string; groupId?: string }) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  conversationStatusColor: ComponentProps<typeof Chip>["color"];
  conversationStatusLabel: string;
  runtimeSelection: ThreadRuntimeSelection;
  cliBackendVersionLabel: (backend: CliBackendVersionLabelBackend) => string | null;
  codexCliUpdateStatus: CodexCliUpdateStatus | null;
  setCliSwitcherAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  refreshCliInstallations: (token: string, kinds?: CliInstallationKind[]) => void;
  isClaudeBackend: boolean;
  isAgyBackend: boolean;
  isGrokBackend: boolean;
  isMuseBackend: boolean;
  isPiBackend: boolean;
  isOpencodeBackend: boolean;
  isCodexBackend: boolean;
  setTopBarPinned: Dispatch<SetStateAction<boolean>>;
  cancelTopBarHide: () => void;
  setTopBarOpen: Dispatch<SetStateAction<boolean>>;
  setMobileTopMenuAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  mobileTopBarCollapsed: boolean;
  setMobileTopBarCollapsedPersisted: (value: boolean) => void;
  historyThreads: ThreadEntry[];
  activeProviderLabel: string;
  selectedModel: string;
  conversationStatus: ComponentProps<typeof MobileTopBar>["statusKind"];
  conversationWorking: boolean;
  mobileTopBarExpanded: boolean;
  setMobileTopBarExpanded: Dispatch<SetStateAction<boolean>>;
  setMobileHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setRuntimeConfigAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
}

export function WorkbenchTopBar(props: WorkbenchTopBarProps) {
  const {
    t,
    immersiveView,
    isMobile,
    topBarPinned,
    openTopBar,
    scheduleTopBarHide,
    topBarOpen,
    themeTuning,
    enterImmersiveView,
    openOfficialWebsite,
    openDiscordInvite,
    fastModeEnabled,
    reasoningOptions,
    reasoningEffort,
    planModeEnabled,
    permission,
    requestNewSession,
    state,
    systemMetricsScope,
    desktopLayout,
    rightWorkspaceVisible,
    closeRightWorkspace,
    setRightWorkspaceTab,
    setRightWorkspaceVisible,
    setStatsPanelScope,
    themeMode,
    allThemePlugins,
    installedThemePluginIds,
    onThemeModeChange,
    openSettings,
    locale,
    setLocale,
    conversationStatusColor,
    conversationStatusLabel,
    runtimeSelection,
    cliBackendVersionLabel,
    codexCliUpdateStatus,
    setCliSwitcherAnchor,
    refreshCliInstallations,
    isClaudeBackend,
    isAgyBackend,
    isGrokBackend,
    isMuseBackend,
    isPiBackend,
    isOpencodeBackend,
    isCodexBackend,
    setTopBarPinned,
    cancelTopBarHide,
    setTopBarOpen,
    setMobileTopMenuAnchor,
    mobileTopBarCollapsed,
    setMobileTopBarCollapsedPersisted,
    historyThreads,
    activeProviderLabel,
    selectedModel,
    conversationStatus,
    conversationWorking,
    mobileTopBarExpanded,
    setMobileTopBarExpanded,
    setMobileHistoryOpen,
    setRuntimeConfigAnchor,
  } = props;
  const isOpencodeV2Backend = runtimeSelection.cliBackend === "opencode-v2";
  return (
    <>
      <AppBar
        data-testid="primary-app-bar"
        data-immersive={immersiveView ? "true" : "false"}
        position="static"
        color="inherit"
        elevation={0}
        onPointerEnter={topBarPinned ? undefined : openTopBar}
        onPointerLeave={topBarPinned ? undefined : scheduleTopBarHide}
        onFocusCapture={topBarPinned ? undefined : openTopBar}
        onBlurCapture={topBarPinned ? undefined : (event: React.FocusEvent<HTMLElement, Element>) => {
          const next = event.relatedTarget as Node | null;
          if (next && event.currentTarget.contains(next)) return;
          scheduleTopBarHide();
        }}
        sx={{
          zIndex: 1,
          display: immersiveView || isMobile ? "none" : "flex",
          justifySelf: "end",
          width: "100%",
          minWidth: 0,
          top: "auto",
          left: "auto",
          right: "auto",
          transform: "none",
          borderRadius: 0,
          border: 0,
          bgcolor: (theme: import("@mui/material/styles").Theme) => alpha(theme.palette.background.paper, themeTuning.panelSurfaceOpacity),
          boxShadow: "none",
          transition: "width 280ms cubic-bezier(.2,.8,.2,1), transform 280ms cubic-bezier(.2,.8,.2,1)",
          overflow: "hidden",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          ...(topBarPinned ? {} : {
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1150,
            transform: topBarOpen ? "translateY(0)" : "translateY(-100%)",
            visibility: topBarOpen ? "visible" : "hidden",
            transition: "width 280ms cubic-bezier(.2,.8,.2,1), transform 220ms ease, visibility 220ms",
          }),
        }}
      >
        <Toolbar variant="dense" sx={{ gap: { xs: 0.5, sm: 1 }, minHeight: 54, px: { xs: 0.75, sm: 1.5, lg: 2 }, overflow: "hidden" }}>
          <Tooltip title={`${t("app.enterImmersiveView")} · F11`}><IconButton
            size="small"
            aria-label={t("app.enterImmersiveView")}
            data-testid="immersive-view-toggle"
            onClick={enterImmersiveView}
            sx={{ color: "primary.main", width: 32, height: 32, flex: "0 0 auto" }}
          >
            <PlayArrowIcon sx={{ fontSize: 20 }} />
          </IconButton></Tooltip>
          <Button
            aria-label="Open Codex Ultra official website"
            onClick={openOfficialWebsite}
            sx={{ display: "inline-flex", minWidth: 0, px: 0.25, color: "text.primary", fontSize: { xs: 13, sm: 17 }, lineHeight: 1, fontWeight: 800, textTransform: "none", whiteSpace: "nowrap", wordBreak: "keep-all", overflow: "hidden", textOverflow: "ellipsis", flex: "0 1 auto" }}
          >
            {t("app.title")}
          </Button>
          <Tooltip title={t("app.discordTooltip")}>
            <IconButton
              size="small"
              aria-label={t("app.discordTooltip")}
              data-testid="discord-invite-button"
              onClick={openDiscordInvite}
              sx={{ color: "#5865F2", width: 32, height: 32, flex: "0 0 auto" }}
            >
              <DiscordIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          <Box sx={{ display: "contents" }}>
          {fastModeEnabled && (
            <Tooltip title={t("app.fastTooltip", { effort: reasoningEffortLabel(fastReasoningEffort(reasoningOptions, reasoningEffort)) })}>
              <Chip
                size="small"
                color="warning"
                icon={<BoltIcon />}
                label={t("app.fast")}
                data-testid="topbar-fast-badge"
                sx={{ display: { xs: "none", sm: "inline-flex" }, fontWeight: 800 }}
              />
            </Tooltip>
          )}
          {planModeEnabled && (
            <Tooltip title={t("app.planTooltip")}>
              <Chip
                size="small"
                color="primary"
                icon={<ChecklistIcon />}
                label={t("app.plan")}
                data-testid="topbar-plan-badge"
                sx={{ display: { xs: "none", sm: "inline-flex" }, fontWeight: 800 }}
              />
            </Tooltip>
          )}
          <Box sx={{ display: { xs: "none", lg: "block" }, flex: "0 0 auto" }}>
            <NewChatButton currentPermission={permission} t={t} onNew={requestNewSession} />
          </Box>
          {!immersiveView && <SystemMetricsTopBarBadge token={state.token ?? undefined} scope={systemMetricsScope} />}
          <Box sx={{ flex: 1, minWidth: 0 }} />
          {desktopLayout && <Tooltip title={rightWorkspaceVisible ? t("app.hideWorkspace") : t("app.openWorkspace")}>
            <IconButton
              size="small"
              onClick={() => {
                if (rightWorkspaceVisible) closeRightWorkspace();
                else {
                  setRightWorkspaceTab("sidechat");
                  setRightWorkspaceVisible(true);
                }
              }}
              aria-label={rightWorkspaceVisible ? t("app.hideWorkspace") : t("app.openWorkspace")}
              color={rightWorkspaceVisible ? "primary" : "default"}
            >
              <ViewColumnIcon fontSize="small" />
            </IconButton>
          </Tooltip>}
          <Tooltip title={t("app.sessionStats")}>
            <IconButton
              size="small"
              onClick={() => setStatsPanelScope("status")}
              aria-label={t("app.sessionStats")}
              data-testid="topbar-session-stats-button"
            >
              <AssessmentIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <ThemeQuickSwitcher
            themeMode={themeMode}
            themes={allThemePlugins}
            installedThemePluginIds={installedThemePluginIds}
            t={t}
            onThemeChange={onThemeModeChange}
            onOpenAppearance={() => openSettings("appearance")}
          />
          <FormControl size="small" sx={{ minWidth: { xs: 96, sm: 128 }, display: { xs: "none", sm: "inline-flex" } }}>
            <Select
              value={locale}
              inputProps={{ "aria-label": t("app.language") }}
              onChange={(event: import("@mui/material/Select").SelectChangeEvent<string>) => setLocale(event.target.value as Locale)}
              sx={{ "& .MuiSelect-select": { py: 0.55, fontSize: 13, fontWeight: 750 } }}
            >
              {localeOptions.map((option: { readonly value: "en"; readonly label: "English"; } | { readonly value: "zh"; readonly label: "简体中文"; } | { readonly value: "zh-TW"; readonly label: "繁體中文"; } | { readonly value: "ja"; readonly label: "日本語"; } | { readonly value: "ko"; readonly label: "한국어"; } | { readonly value: "vi"; readonly label: "Tiếng Việt"; } | { readonly value: "de"; readonly label: "Deutsch"; } | { readonly value: "fr"; readonly label: "Français"; } | { readonly value: "es"; readonly label: "Español"; } | { readonly value: "pt"; readonly label: "Português"; }) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Chip
            size="small"
            color={conversationStatusColor}
            label={conversationStatusLabel}
            data-testid="topbar-conversation-status"
            sx={{ display: { xs: "none", sm: "inline-flex" }, fontWeight: 850 }}
          />

          <Tooltip title={describeCliSwitcherTooltip({
            backend: runtimeSelection.cliBackend,
            versionLabel: cliBackendVersionLabel(runtimeSelection.cliBackend),
            codexCliUpdateStatus,
            engineVersion: state.engine.codexVersion,
            engineMessage: state.engine.message,
            t
          })}>
            <Box
              onClick={(event: ReactMouseEvent<HTMLDivElement, MouseEvent>) => {
                setCliSwitcherAnchor(event.currentTarget);
                if (state.token) refreshCliInstallations(state.token);
              }}
              data-testid="topbar-cli-switcher-trigger"
              sx={{ position: "relative", width: 28, height: 28, flex: "0 0 28px", cursor: "pointer" }}>
              <Box
                component="img"
                src={isClaudeBackend ? "/icons/claudecode-color.svg" : isAgyBackend ? "/icons/agy-color.svg" : isGrokBackend ? "/icons/grok.svg" : isMuseBackend ? "/icons/muse.png" : isPiBackend ? "/icons/pi.svg" : isOpencodeBackend ? "/icons/opencode.svg" : isOpencodeV2Backend ? "/icons/opencode-v2.svg" : isCodexBackend ? "/icons/codex-color.svg" : "/icons/mini.svg"}
                alt={isClaudeBackend ? "Claude CLI" : isAgyBackend ? "Antigravity CLI" : isGrokBackend ? "Grok CLI" : isMuseBackend ? "Muse CLI" : isPiBackend ? "Pi Agent" : isOpencodeBackend ? "OpenCode CLI" : isOpencodeV2Backend ? "OpenCode v2 CLI" : isCodexBackend ? "Codex CLI" : "Mini"}
                data-testid="topbar-codex-cli-logo"
                data-cli-backend={isClaudeBackend ? "claude" : isAgyBackend ? "agy" : isGrokBackend ? "grok" : isMuseBackend ? "muse" : isPiBackend ? "pi" : isOpencodeBackend ? "opencode" : isOpencodeV2Backend ? "opencode-v2" : isCodexBackend ? "codex" : "mini"}
                sx={{ width: 28, height: 28, objectFit: "contain" }}
              />
              {isCodexBackend && codexCliUpdateStatus?.updateAvailable && (
                <Box
                  sx={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "#d32f2f",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 0 4px rgba(0,0,0,0.3)",
                  }}
                >
                  1
                </Box>
              )}
            </Box>
          </Tooltip>
          <Button size="small" startIcon={<SettingsIcon />} onClick={() => openSettings("codex")} sx={{ display: { xs: "none", md: "inline-flex" } }}>
            {t("settings.title")}
          </Button>
          <Tooltip title={topBarPinned ? (t("topbar.unpinTopBar") || "Unpin top bar (auto-hide)") : (t("topbar.pinTopBar") || "Pin top bar")}>
            <IconButton
              size="small"
              aria-label={topBarPinned ? (t("topbar.unpinTopBar") || "Unpin top bar (auto-hide)") : (t("topbar.pinTopBar") || "Pin top bar")}
              aria-pressed={topBarPinned}
              data-testid="topbar-pin-toggle"
              onClick={() => {
                const next = !topBarPinned;
                setTopBarPinned(next);
                if (next) {
                  cancelTopBarHide();
                  setTopBarOpen(false);
                } else {
                  openTopBar();
                }
              }}
              color={topBarPinned ? "primary" : "default"}
              sx={{ flex: "0 0 auto" }}
            >
              {topBarPinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          {!desktopLayout && <IconButton size="small" aria-label={t("app.moreActions")} onClick={(event: ReactMouseEvent<HTMLButtonElement, MouseEvent>) => setMobileTopMenuAnchor(event.currentTarget)}><MoreVertIcon fontSize="small" /></IconButton>}
          </Box>
        </Toolbar>
      </AppBar>
      {isMobile && !immersiveView && (
        mobileTopBarCollapsed ? (
          <Tooltip title={t("topbar.showTopBar")}>
            <IconButton
              aria-label={t("topbar.showTopBar")}
              data-testid="mobile-show-topbar-button"
              onClick={() => setMobileTopBarCollapsedPersisted(false)}
              sx={{
                position: "absolute",
                top: 8,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 12,
                width: 36,
                height: 36,
                borderRadius: 999,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "background.paper",
                boxShadow: (theme: import("@mui/material/styles").Theme) => theme.customShadows?.card || "0 4px 12px rgba(0,0,0,0.12)"
              }}
            >
              <ExpandMoreIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
        <MobileTopBar
          title={
            state.activeThreadId
              ? (historyThreads.find((t: ThreadEntry) => t.id === state.activeThreadId)
                ? displayThreadTitle(historyThreads.find((t: ThreadEntry) => t.id === state.activeThreadId)!)
                : state.activeThreadId)
              : t("app.title")
          }
          providerLabel={activeProviderLabel}
          modelLabel={selectedModel || t("app.model")}
          statusKind={conversationStatus}
          statusLabel={conversationStatusLabel}
          running={conversationWorking}
          dropdownOpen={mobileTopBarExpanded}
          onToggleDropdown={() => setMobileTopBarExpanded((expanded: boolean) => !expanded)}
          onOpenHistory={() => setMobileHistoryOpen(true)}
          onOpenRelay={(event: ReactMouseEvent<HTMLElement, MouseEvent>) => setRuntimeConfigAnchor(event.currentTarget)}
          onNewChat={() => {
            setMobileTopBarExpanded(false);
            requestNewSession(permission);
          }}
          onCollapseTopBar={() => setMobileTopBarCollapsedPersisted(true)}
          collapseTopBarLabel={t("topbar.toggleTopBar")}
          dropdownContent={
            <MobileTopBarDropdownContent
              token={state.token ?? undefined}
              scope={systemMetricsScope}
              locale={locale}
              onLocaleChange={setLocale}
              t={t}
              themeMode={themeMode}
              themes={allThemePlugins}
              installedThemePluginIds={installedThemePluginIds}
              onThemeChange={onThemeModeChange}
              onOpenAppearance={() => openSettings("appearance")}
              isClaudeBackend={isClaudeBackend}
              isAgyBackend={isAgyBackend}
              isGrokBackend={isGrokBackend}
              isPiBackend={isPiBackend}
              isOpencodeBackend={isOpencodeBackend}
              isOpencodeV2Backend={isOpencodeV2Backend}
              isCodexBackend={isCodexBackend}
              onOpenCliSwitcher={(event) => setCliSwitcherAnchor(event.currentTarget)}
              onRefreshCli={() => { if (state.token) refreshCliInstallations(state.token); }}
              fastModeEnabled={fastModeEnabled}
              planModeEnabled={planModeEnabled}
              onOpenStats={() => setStatsPanelScope("status")}
              onOpenSettings={() => openSettings("codex")}
            />
          }
        />
        )
      )}
    </>
  );
}
