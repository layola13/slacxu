import { useState, useMemo, type MouseEvent } from "react";
import {
  Box,
  Button,
  Chip,
  FormControl,
  InputAdornment,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Popover,
  Select,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import CloudQueueIcon from "@mui/icons-material/CloudQueue";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import SearchIcon from "@mui/icons-material/Search";
import CheckIcon from "@mui/icons-material/Check";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ImageIcon from "@mui/icons-material/Image";
import LoginIcon from "@mui/icons-material/Login";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import type { CliBackend, ProviderConfig } from "@codex-ui/shared";
import type { TranslateFn } from "../i18n";
import {
  filterAndSortRelayGroups,
  hasConfiguredProviderCredential,
  isAvailableRelayGroup,
  relayGroupUsageRate,
  type RelayGroupProtocolFilter,
  type RelayGroupSort
} from "../groupCollection";

export interface TopBarRelayTreeSelectorProps {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activeGroupId: string | null;
  cliBackend?: CliBackend;
  t: TranslateFn;
  onActivateProvider: (providerId: string) => Promise<void>;
  onSelectGroup: (providerId: string, groupId: string) => Promise<void>;
  onSelectImageGroup?: (providerId: string, groupId: string, model: string) => void;
  onOpenOfficialLogin?: () => void;
  onOpenCreateRelay?: () => void;
  onSelectOfficialAgy?: () => void;
  onSelectOfficialGrok?: () => void;
  onSelectAgyLaunch?: () => void;
}

export function TopBarRelayTreeSelector({
  providers,
  activeProviderId,
  activeGroupId,
  cliBackend,
  t,
  onActivateProvider,
  onSelectGroup,
  onSelectImageGroup,
  onOpenOfficialLogin,
  onOpenCreateRelay,
  onSelectOfficialAgy,
  onSelectOfficialGrok,
  onSelectAgyLaunch
}: TopBarRelayTreeSelectorProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [groupAnchorEl, setGroupAnchorEl] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [groupProtocol, setGroupProtocol] = useState<RelayGroupProtocolFilter>("all");
  const [groupSort, setGroupSort] = useState<RelayGroupSort>("original");

  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const activeGroup = activeProvider?.groups?.find((group) => group.id === activeGroupId);
  const hasConfiguredRelays = providers.length > 0;
  const officialProvider = providers.find((provider) => provider.kind === "chatgpt");

  const open = Boolean(anchorEl);

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    if (!hasConfiguredRelays && onOpenCreateRelay) {
      onOpenCreateRelay();
      return;
    }
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
    setSearch("");
  };

  // Filter providers and groups by search query
  const filteredProviders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const relayProviders = providers.filter((provider) => provider !== officialProvider);
    if (!q) return relayProviders;

    return relayProviders.filter((p) => {
      const matchName = p.name.toLowerCase().includes(q);
      const matchKind = p.kind.toLowerCase().includes(q);
      const matchGroup = p.groups?.some((g) => g.name.toLowerCase().includes(q));
      return matchName || matchKind || matchGroup;
    });
  }, [officialProvider, providers, search]);

  const availableGroups = useMemo(
    () => {
      const providerCredentialConfigured = activeProvider
        ? hasConfiguredProviderCredential(activeProvider)
        : false;
      return (activeProvider?.groups ?? []).filter((group) =>
        isAvailableRelayGroup(group, providerCredentialConfigured)
      );
    },
    [activeProvider]
  );
  const showGroupTools = availableGroups.length > 10;
  const displayedGroups = useMemo(() => filterAndSortRelayGroups(availableGroups, {
    search: showGroupTools ? groupSearch : "",
    status: "available",
    protocol: showGroupTools ? groupProtocol : "all",
    sort: showGroupTools ? groupSort : "original"
  }, activeProvider ? hasConfiguredProviderCredential(activeProvider) : false), [activeProvider, availableGroups, groupProtocol, groupSearch, groupSort, showGroupTools]);

  const handleGroupClose = () => {
    setGroupAnchorEl(null);
    setGroupSearch("");
    setGroupProtocol("all");
    setGroupSort("original");
  };

  const isAgy = cliBackend === "agy";
  const isGrok = cliBackend === "grok";
  const isAgyOfficial = isAgy && (!activeProviderId || activeProviderId === "agy-official");
  const isGrokOfficial = isGrok && (!activeProviderId || activeProviderId === "grok-official");

  const activeLabel = isAgyOfficial
    ? "Antigravity 官方"
    : isGrokOfficial
      ? "Grok 官方"
      : activeProvider
        ? activeProvider.name
        : isAgy
          ? "Antigravity 官方"
          : isGrok
            ? "Grok 官方"
            : hasConfiguredRelays
              ? t("topbar.relay.defaultRelay")
              : t("topbar.relay.setupRelay");
  const activeGroupLabel = activeProvider && activeGroup
    ? `${activeGroup.name} x${formatGroupRatio(activeGroup.groupRatio)}`
    : t("topbar.relay.chooseGroup");

  return (
    <>
      <Chip
        size="small"
        clickable
        icon={<CloudQueueIcon fontSize="small" />}
        label={
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="caption" sx={{ fontWeight: 800 }}>
              {activeLabel}
            </Typography>
            <KeyboardArrowDownIcon fontSize="small" />
          </Stack>
        }
        onClick={handleOpen}
        data-testid="composer-provider-chip"
        sx={{
          maxWidth: { xs: 140, sm: 240, lg: 320 },
          display: "inline-flex",
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          px: 0.5,
          "& .MuiChip-label": {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }
        }}
      />

      {!isAgyOfficial && !isGrokOfficial && activeProvider?.groups?.length ? (
        <Chip
          size="small"
          clickable
          icon={activeGroup?.kind === "image" ? <ImageIcon fontSize="small" /> : <ChatBubbleOutlineIcon fontSize="small" />}
          label={
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="caption" sx={{ fontWeight: 800 }}>
                {activeGroupLabel}
              </Typography>
              <KeyboardArrowDownIcon fontSize="small" />
            </Stack>
          }
          onClick={(event) => setGroupAnchorEl(event.currentTarget)}
          data-testid="composer-provider-group-chip"
          sx={{
            maxWidth: { xs: 180, sm: 260, lg: 340 },
            display: "inline-flex",
            bgcolor: activeGroup?.kind === "image" ? "success.main" : "background.paper",
            color: activeGroup?.kind === "image" ? "success.contrastText" : "text.primary",
            border: "1px solid",
            borderColor: activeGroup?.kind === "image" ? "success.main" : "divider",
            "& .MuiChip-icon": { color: "inherit" },
            "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
          }}
        />
      ) : null}

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        PaperProps={{
          sx: {
            width: { xs: 300, sm: 360 },
            maxHeight: 480,
            p: 1.5,
            borderRadius: 2.5,
            boxShadow: (theme) => theme.customShadows?.z16 ?? 8
          }
        }}
      >
        <Stack spacing={1.5}>
          {/* Top Search Input */}
          <TextField
            autoFocus
            size="small"
            fullWidth
            placeholder={t("topbar.relay.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              )
            }}
          />

          <Box sx={{ overflowY: "auto", maxHeight: 380 }}>
            {isAgy || isGrok ? (
              <>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800, px: 1 }}>
                  {isGrok ? "Grok 官方" : (t("topbar.relay.agyOfficial") || "Antigravity 官方")}
                </Typography>
                <List dense disablePadding sx={{ mb: 1 }}>
                  <ListItemButton
                    selected={isGrok ? isGrokOfficial : isAgyOfficial}
                    onClick={() => {
                      handleClose();
                      if (isGrok) onSelectOfficialGrok?.();
                      else onSelectOfficialAgy?.();
                    }}
                    sx={{ borderRadius: 1.5 }}
                    data-testid={isGrok ? "composer-relay-grok-official" : "composer-relay-agy-official"}
                  >
                    <ListItemIcon sx={{ minWidth: 34 }}>
                      <Box component="img" src={isGrok ? "/icons/grok.svg" : "/icons/agy-color.svg"} sx={{ width: 20, height: 20 }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={isGrok ? "Grok 官方" : (t("topbar.relay.agyOfficial") || "Antigravity 官方 (Google OAuth)")}
                      secondary={isGrok ? "官方原生通道 · grok.exe" : (t("topbar.relay.agyOfficialDesc") || "官方原生通道 · 免费/Ultra 订阅 · 无需 API Key")}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 800 }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    {(isGrok ? isGrokOfficial : isAgyOfficial) ? <CheckIcon fontSize="small" color="primary" /> : null}
                  </ListItemButton>
                </List>
              </>
            ) : (
              <>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800, px: 1 }}>
                  OpenAI 官方
                </Typography>
                <List dense disablePadding sx={{ mb: 1 }}>
                  <ListItemButton
                    selected={officialProvider?.id === activeProviderId}
                    onClick={() => {
                      handleClose();
                      if (officialProvider) void onSelectGroup(officialProvider.id, "default").catch(() => undefined);
                      else onOpenOfficialLogin?.();
                    }}
                    sx={{ borderRadius: 1.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 34 }}><LoginIcon color="primary" fontSize="small" /></ListItemIcon>
                    <ListItemText
                      primary={officialProvider ? "OpenAI 官方" : "登录官方 OpenAI"}
                      secondary={officialProvider ? "default" : "OAuth · 无需 API Key / Base URL"}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 800 }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    {officialProvider?.id === activeProviderId ? <CheckIcon fontSize="small" color="primary" /> : null}
                  </ListItemButton>
                </List>
              </>
            )}

            {/* Antigravity 中转 (agy-launch) - only show when agy backend is selected and not using official */}
            {isAgy && !isAgyOfficial && (
              <>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800, px: 1 }}>
                  {t("topbar.relay.agyLaunchTitle") || "Antigravity 中转"}
                </Typography>
                <List dense disablePadding sx={{ mb: 1 }}>
                  <ListItemButton
                    selected={activeProviderId === "agy-launch"}
                    onClick={() => {
                      handleClose();
                      void onActivateProvider("agy-launch").catch(() => undefined);
                    }}
                    sx={{ borderRadius: 1.5 }}
                    data-testid="composer-relay-agy-launch"
                  >
                    <ListItemIcon sx={{ minWidth: 34 }}>
                      <AutoAwesomeIcon fontSize="small" color="primary" />
                    </ListItemIcon>
                    <ListItemText
                      primary={t("topbar.relay.agyLaunch") || "Antigravity 中转 (agy-launch)"}
                      secondary={t("topbar.relay.agyLaunchDesc") || "本地代理转发 · 无需 Google 登录 · 需配置 API Key"}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 800 }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                    {activeProviderId === "agy-launch" ? <CheckIcon fontSize="small" color="primary" /> : null}
                  </ListItemButton>
                </List>
              </>
            )}

            {/* All providers, including official-labelled entries, use grouped relay routing. */}
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800, px: 1 }}>
              {t("topbar.relay.relayStationsAndGroups")}
            </Typography>

            {filteredProviders.length === 0 ? (
              <Box sx={{ px: 1, py: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                  {t("topbar.relay.noMatchingRelays")}
                </Typography>
                {onOpenCreateRelay && (
                  <Button
                    size="small"
                    fullWidth
                    variant="contained"
                    color="primary"
                    onClick={() => {
                      handleClose();
                      onOpenCreateRelay();
                    }}
                    sx={{ borderRadius: 1.5, textTransform: "none", py: 0.75 }}
                  >
                    {t("topbar.relay.setupCreateRelay")}
                  </Button>
                )}
              </Box>
            ) : (
              <List dense disablePadding sx={{ width: "100%" }}>
                {filteredProviders.map((provider) => {
                    const isSelected = activeProviderId === provider.id;

                    return (
                      <Box key={provider.id} sx={{ mb: 0.5 }}>
                        <ListItemButton
                          selected={isSelected}
                          onClick={async () => {
                            handleClose();
                            if (isSelected) {
                              return;
                            }
                            void onActivateProvider(provider.id).catch(() => undefined);
                          }}
                          sx={{ borderRadius: 1.5, py: 0.75 }}
                        >
                          <ListItemText
                            primary={
                              <Stack direction="row" spacing={0.5} alignItems="center">
                                <Typography variant="body2" sx={{ fontWeight: 800 }}>
                                  {provider.name}
                                </Typography>
                                {provider.stationType === "rich" && <Chip size="small" label="🪙" sx={{ height: 18, fontSize: 11 }} />}
                                {provider.stationType === "charity" && <Chip size="small" label="💚" sx={{ height: 18, fontSize: 11 }} />}
                              </Stack>
                            }
                            secondary={`${provider.kind} | ${t("topbar.relay.groupCount", { count: provider.groups?.length ?? 0 })} | ${formatQuota(provider.quotaUsd, t)}`}
                            primaryTypographyProps={{ component: "div" }}
                            secondaryTypographyProps={{ variant: "caption" }}
                          />
                          {isSelected && <CheckIcon fontSize="small" color="primary" />}
                        </ListItemButton>
                      </Box>
                    );
                  })}
              </List>
            )}
          </Box>
        </Stack>
      </Popover>

      <Popover
        open={Boolean(groupAnchorEl)}
        anchorEl={groupAnchorEl}
        onClose={handleGroupClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        PaperProps={{ sx: { width: { xs: 320, sm: 440 }, maxHeight: 560, p: 1, borderRadius: 2, boxShadow: (theme) => theme.customShadows?.z16 ?? 8 } }}
      >
        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800, px: 1 }}>
          {t("topbar.relay.groupSelectTitle", { provider: activeProvider?.name ?? t("topbar.relay.stationFallback") })}
        </Typography>
        {showGroupTools ? (
          <Stack spacing={1} sx={{ px: 0.5, pb: 1 }}>
            <TextField
              autoFocus
              size="small"
              fullWidth
              placeholder={t("settings.relay.groupSearchPlaceholder")}
              value={groupSearch}
              onChange={(event) => setGroupSearch(event.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
            <Stack direction="row" spacing={1} sx={{ overflowX: "auto" }}>
              <FormControl size="small" sx={{ minWidth: 125 }}>
                <InputLabel>{t("settings.relay.groupProtocolFilter")}</InputLabel>
                <Select value={groupProtocol} label={t("settings.relay.groupProtocolFilter")} onChange={(event) => setGroupProtocol(event.target.value as RelayGroupProtocolFilter)}>
                  <MenuItem value="all">{t("settings.relay.filterAll")}</MenuItem>
                  <MenuItem value="openai-response">Responses</MenuItem>
                  <MenuItem value="openai">Chat</MenuItem>
                  <MenuItem value="anthropic">Anthropic</MenuItem>
                  <MenuItem value="gemini">Gemini</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>{t("settings.relay.groupSort")}</InputLabel>
                <Select value={groupSort} label={t("settings.relay.groupSort")} onChange={(event) => setGroupSort(event.target.value as RelayGroupSort)}>
                  <MenuItem value="original">{t("settings.relay.sortOriginal")}</MenuItem>
                  <MenuItem value="name_asc">{t("settings.relay.sortName")}</MenuItem>
                  <MenuItem value="ratio_asc">{t("settings.relay.sortRatioAsc")}</MenuItem>
                  <MenuItem value="ratio_desc">{t("settings.relay.sortRatioDesc")}</MenuItem>
                  <MenuItem value="usage_desc">{t("settings.relay.sortUsageDesc")}</MenuItem>
                  <MenuItem value="priority_desc">{t("settings.relay.sortPriorityDesc")}</MenuItem>
                  <MenuItem value="models_desc">{t("settings.relay.sortModelsDesc")}</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {t("settings.relay.groupResults", { shown: displayedGroups.length, total: availableGroups.length })}
            </Typography>
          </Stack>
        ) : null}
        <List dense disablePadding sx={{ maxHeight: 390, overflowY: "auto" }}>
          {displayedGroups.map((group) => {
            const selected = group.id === activeGroupId;
            const ratio = formatGroupRatio(group.groupRatio);
            return (
              <ListItemButton
                key={group.id}
                selected={selected}
                onClick={async () => {
                  if (!activeProvider) return;
                  handleGroupClose();
                  if (selected) return;
                  const imageOnly = group.kind === "image" || (group.capabilities?.imageGeneration && group.capabilities.text === false);
                  if (imageOnly && onSelectImageGroup) {
                    onSelectImageGroup(activeProvider.id, group.id, group.image?.defaultModel ?? group.models?.[0] ?? "gpt-image-2");
                  } else {
                    void onSelectGroup(activeProvider.id, group.id).catch(() => undefined);
                  }
                }}
                sx={{ borderRadius: 1, my: 0.25 }}
              >
                <ListItemIcon sx={{ minWidth: 34 }}>
                  {group.kind === "image" ? <ImageIcon color="success" fontSize="small" /> : <ChatBubbleOutlineIcon color="primary" fontSize="small" />}
                </ListItemIcon>
                <ListItemText
                  primary={`${activeProvider?.name ?? t("topbar.relay.stationFallback")} / ${group.name} x${ratio}`}
                  secondary={formatGroupSecondary(group, ratio, t)}
                  primaryTypographyProps={{ variant: "body2", fontWeight: 800 }}
                  secondaryTypographyProps={{ variant: "caption" }}
                />
                {selected ? <CheckIcon fontSize="small" color="primary" /> : null}
              </ListItemButton>
            );
          })}
          {displayedGroups.length === 0 ? (
            <Box sx={{ px: 1.5, py: 3, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">{t("settings.relay.noMatchingGroups")}</Typography>
            </Box>
          ) : null}
        </List>
      </Popover>
    </>
  );
}

function formatGroupRatio(value: number | undefined): string {
  const ratio = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return ratio.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
}

function formatGroupSecondary(group: NonNullable<ProviderConfig["groups"]>[number], ratio: string, t: TranslateFn): string {
  const kind = group.kind === "image" ? t("settings.relay.groupKindImage") : t("settings.relay.groupKindText");
  const protocol = group.responseProtocolMode === "model_auto" ? `${group.responseProtocol ?? "auto"} (auto)` : group.responseProtocol ?? "openai-response";
  const modelSummary = formatGroupModels(group, t);
  const fallback = group.enableFallback && group.fallbackGroupName ? ` | ${t("topbar.relay.fallback", { group: group.fallbackGroupName })}` : "";
  const credential = group.authType === "none"
    ? t("settings.relay.authNone")
    : group.credentialMode === "provider"
      ? t("settings.relay.credentialProvider")
      : t("topbar.relay.keys", { count: group.keys?.length ?? 0 });
  return `${kind} | ${protocol} | ${t("topbar.relay.models", { models: modelSummary })} | ${t("topbar.relay.ratio", { ratio })} | ${t("topbar.relay.quota", { quota: formatQuota(group.quotaUsd, t) })} | ${credential}${fallback}`;
}

function formatGroupModels(group: NonNullable<ProviderConfig["groups"]>[number], t: TranslateFn): string {
  const models = group.models ?? [];
  const head = models.slice(0, 2).join(", ");
  if (!head) {
    return t("settings.relay.groupModelsUnconfigured");
  }
  return models.length > 2 ? `${head} +${models.length - 2}` : head;
}

function formatQuota(value: number | null | undefined, t: TranslateFn): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value}` : t("settings.relay.unlimitedQuota");
}
