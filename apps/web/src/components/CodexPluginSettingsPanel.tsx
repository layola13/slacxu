import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import ExtensionIcon from "@mui/icons-material/Extension";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import type { JsonValue } from "@codex-ui/shared";
import type {
  HookGroup,
  McpResourceContentEntry,
  PluginAppEntry,
  PluginDetailEntry,
  PluginEntry,
  PluginInstallAuthNotice,
  PluginMarketplace,
  ToolingState
} from "../state/codexClient";
import type { TranslateFn } from "../i18n";

export type CodexPluginSettingsTab = "marketplace" | "installed" | "mcp" | "hooks" | "apps";

type Props = {
  activeThreadId: string | null;
  tooling: ToolingState;
  toolingLoading: boolean;
  t: TranslateFn;
  initialTab?: CodexPluginSettingsTab;
  pluginDetails: Record<string, PluginDetailEntry>;
  pluginSkillPreviews: Record<string, string>;
 pluginAuthNotices: Record<string, PluginInstallAuthNotice>;
 installingPluginIds: Set<string>;
 mcpResourceContents: Record<string, McpResourceContentEntry[]>;
  mcpOauthUrls: Record<string, string>;
  onReloadTooling: () => void;
  onReloadMcp: () => void;
  onStartMcpOauth: (serverName: string) => void;
  onReadMcpResource: (serverName: string, uri: string) => void;
  onCallMcpTool: (serverName: string, toolName: string, args: JsonValue) => Promise<JsonValue>;
  onReadPluginDetail: (marketplace: PluginMarketplace, plugin: PluginEntry) => void;
  onReadPluginSkill: (marketplace: PluginMarketplace, plugin: PluginEntry, skillName: string) => void;
  onInsertPluginMention: (marketplace: PluginMarketplace, plugin: PluginEntry) => void;
  onInstallPlugin: (marketplace: PluginMarketplace, plugin: PluginEntry) => void;
  onUninstallPlugin: (plugin: PluginEntry) => void;
};

export function CodexPluginSettingsPanel({
  activeThreadId,
  tooling,
  toolingLoading,
  t,
  initialTab = "marketplace",
  pluginDetails,
  pluginSkillPreviews,
 pluginAuthNotices,
 installingPluginIds,
 mcpResourceContents,
  mcpOauthUrls,
  onReloadTooling,
  onReloadMcp,
  onStartMcpOauth,
  onReadMcpResource,
  onCallMcpTool,
  onReadPluginDetail,
  onReadPluginSkill,
  onInsertPluginMention,
  onInstallPlugin,
  onUninstallPlugin
}: Props) {
  const [tab, setTab] = useState<CodexPluginSettingsTab>(initialTab);
  const pluginCount = tooling.pluginMarketplaces.reduce((count, marketplace) => count + marketplace.plugins.length, 0);
  const installedPlugins = useMemo(() => installedPluginEntries(tooling), [tooling]);
  const authAppCount = tooling.apps.filter((app) => app.isAccessible === false || app.installUrl).length;
  const hookCount = tooling.hookGroups.reduce((count, group) => count + group.hooks.length, 0);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 850 }}>
            {t("settings.plugins.panelTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("settings.plugins.panelDescription")}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button size="small" startIcon={<RefreshIcon />} onClick={onReloadTooling}>
            {t("settings.plugins.refresh")}
          </Button>
          {toolingLoading && <CircularProgress size={18} />}
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={t("settings.plugins.count.installed", { count: installedPlugins.length })} color={installedPlugins.length ? "success" : "default"} />
        <Chip size="small" label={t("settings.plugins.count.available", { count: pluginCount })} variant="outlined" />
        <Chip size="small" label={t("settings.plugins.count.mcpServers", { count: tooling.mcpServers.length })} variant="outlined" />
        <Chip size="small" label={t("settings.plugins.count.hooks", { count: hookCount })} variant="outlined" />
        <Chip size="small" label={t("settings.plugins.count.appAuth", { count: authAppCount })} color={authAppCount ? "warning" : "default"} variant="outlined" />
      </Stack>

      {tooling.marketplaceErrors.map((message) => (
        <Alert key={message} severity="warning">
          {message}
        </Alert>
      ))}

      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          aria-label={t("settings.plugins.tabsAria")}
          sx={{ px: 1, borderBottom: "1px solid", borderColor: "divider" }}
        >
          <Tab value="marketplace" label={t("settings.plugins.tab.marketplace", { count: pluginCount })} />
          <Tab value="installed" label={t("settings.plugins.tab.installed", { count: installedPlugins.length })} />
          <Tab value="mcp" label={t("settings.plugins.tab.mcp", { count: tooling.mcpServers.length })} />
          <Tab value="hooks" label={t("settings.plugins.tab.hooks", { count: hookCount })} />
          <Tab value="apps" label={t("settings.plugins.tab.apps", { count: tooling.apps.length })} />
        </Tabs>
        <Box sx={{ p: { xs: 1.25, sm: 1.5 } }}>
          {tab === "marketplace" && (
            <PluginMarketplaceSettings
              tooling={tooling}
              t={t}
              pluginDetails={pluginDetails}
              pluginSkillPreviews={pluginSkillPreviews}
              pluginAuthNotices={pluginAuthNotices}
              installingPluginIds={installingPluginIds}
              onReadPluginDetail={onReadPluginDetail}
              onReadPluginSkill={onReadPluginSkill}
              onInsertPluginMention={onInsertPluginMention}
              onInstallPlugin={onInstallPlugin}
              onUninstallPlugin={onUninstallPlugin}
            />
          )}
          {tab === "installed" && (
            <InstalledPluginSettings
              installedPlugins={installedPlugins}
              t={t}
              pluginDetails={pluginDetails}
              pluginSkillPreviews={pluginSkillPreviews}
              installingPluginIds={installingPluginIds}
              onReadPluginDetail={onReadPluginDetail}
              onReadPluginSkill={onReadPluginSkill}
              onInsertPluginMention={onInsertPluginMention}
              onUninstallPlugin={onUninstallPlugin}
            />
          )}
          {tab === "mcp" && (
            <McpSettings
              activeThreadId={activeThreadId}
              tooling={tooling}
              t={t}
              mcpResourceContents={mcpResourceContents}
              mcpOauthUrls={mcpOauthUrls}
              onReloadMcp={onReloadMcp}
              onStartMcpOauth={onStartMcpOauth}
              onReadMcpResource={onReadMcpResource}
              onCallMcpTool={onCallMcpTool}
            />
          )}
          {tab === "hooks" && <HooksSettings hookGroups={tooling.hookGroups} t={t} />}
          {tab === "apps" && <PluginAppsSettings apps={tooling.apps} t={t} />}
        </Box>
      </Paper>
    </Stack>
  );
}

function PluginMarketplaceSettings({
  tooling,
  t,
  pluginDetails,
  pluginSkillPreviews,
  pluginAuthNotices,
  installingPluginIds,
  onReadPluginDetail,
  onReadPluginSkill,
  onInsertPluginMention,
  onInstallPlugin,
  onUninstallPlugin
}: {
  tooling: ToolingState;
  t: TranslateFn;
  pluginDetails: Record<string, PluginDetailEntry>;
  pluginSkillPreviews: Record<string, string>;
  pluginAuthNotices: Record<string, PluginInstallAuthNotice>;
  installingPluginIds: Set<string>;
  onReadPluginDetail: Props["onReadPluginDetail"];
  onReadPluginSkill: Props["onReadPluginSkill"];
  onInsertPluginMention: Props["onInsertPluginMention"];
  onInstallPlugin: Props["onInstallPlugin"];
  onUninstallPlugin: Props["onUninstallPlugin"];
}) {
  const [search, setSearch] = useState("");
  const filteredMarketplaces = useMemo(() => filterMarketplaces(tooling.pluginMarketplaces, search), [tooling.pluginMarketplaces, search]);

  return (
    <Stack spacing={1.25}>
      <TextField
        size="small"
        label={t("settings.plugins.search")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.75, color: "text.secondary" }} /> }}
      />
      {filteredMarketplaces.length === 0 && (
        <Typography color="text.secondary" sx={{ p: 1.5, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
          {t("settings.plugins.noMarketplaceMatch")}
        </Typography>
      )}
      {filteredMarketplaces.map((marketplace) => (
        <Paper key={marketplaceKey(marketplace)} variant="outlined" sx={{ p: 1.25, bgcolor: "background.default" }}>
          <MarketplaceHeader marketplace={marketplace} t={t} />
          <Stack spacing={1} sx={{ mt: 1 }}>
            {marketplace.plugins.length === 0 && <Typography color="text.secondary">{t("settings.plugins.noMarketplacePlugins")}</Typography>}
            {marketplace.plugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                marketplace={marketplace}
                plugin={plugin}
                featured={tooling.featuredPluginIds.includes(plugin.id)}
                t={t}
                detail={pluginDetails[plugin.id]}
               authNotice={pluginAuthNotices[plugin.id]}
               skillPreviewByKey={pluginSkillPreviews}
               installingPluginIds={installingPluginIds}
               onReadPluginDetail={onReadPluginDetail}
                onReadPluginSkill={onReadPluginSkill}
                onInsertPluginMention={onInsertPluginMention}
                onInstallPlugin={onInstallPlugin}
                onUninstallPlugin={onUninstallPlugin}
              />
            ))}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

function InstalledPluginSettings({
  installedPlugins,
  t,
  pluginDetails,
  pluginSkillPreviews,
  installingPluginIds,
  onReadPluginDetail,
  onReadPluginSkill,
  onInsertPluginMention,
  onUninstallPlugin
}: {
  installedPlugins: Array<{ key: string; marketplace: PluginMarketplace; plugin: PluginEntry }>;
  t: TranslateFn;
  pluginDetails: Record<string, PluginDetailEntry>;
  pluginSkillPreviews: Record<string, string>;
  installingPluginIds: Set<string>;
  onReadPluginDetail: Props["onReadPluginDetail"];
  onReadPluginSkill: Props["onReadPluginSkill"];
  onInsertPluginMention: Props["onInsertPluginMention"];
  onUninstallPlugin: Props["onUninstallPlugin"];
}) {
  const [selectedMentionKey, setSelectedMentionKey] = useState("");
  const selectedMention = installedPlugins.find((entry) => entry.key === selectedMentionKey) ?? installedPlugins[0];

  return (
    <Stack spacing={1.25}>
      <Paper variant="outlined" sx={{ p: 1.25, bgcolor: "background.default" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          {t("settings.plugins.composerMentionsTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("settings.plugins.composerMentionsDescription")}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
          <FormControl size="small" sx={{ flex: 1, minWidth: 180 }}>
            <InputLabel>{t("settings.plugins.installedPlugin")}</InputLabel>
            <Select
              value={selectedMention?.key ?? ""}
              label={t("settings.plugins.installedPlugin")}
              onChange={(event) => setSelectedMentionKey(event.target.value)}
              disabled={installedPlugins.length === 0}
            >
              {installedPlugins.map((entry) => (
                <MenuItem key={entry.key} value={entry.key}>
                  {entry.plugin.displayName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            size="small"
            variant="contained"
            disabled={!selectedMention}
            onClick={() => selectedMention && onInsertPluginMention(selectedMention.marketplace, selectedMention.plugin)}
          >
            {t("settings.plugins.insertMention")}
          </Button>
        </Stack>
      </Paper>
      {installedPlugins.length === 0 && (
        <Typography color="text.secondary" sx={{ p: 1.5, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
          {t("settings.plugins.noInstalled")}
        </Typography>
      )}
      {installedPlugins.map((entry) => (
        <PluginCard
          key={entry.key}
          marketplace={entry.marketplace}
          plugin={entry.plugin}
          featured={false}
          t={t}
         detail={pluginDetails[entry.plugin.id]}
         skillPreviewByKey={pluginSkillPreviews}
         installingPluginIds={installingPluginIds}
         onReadPluginDetail={onReadPluginDetail}
          onReadPluginSkill={onReadPluginSkill}
          onInsertPluginMention={onInsertPluginMention}
          onInstallPlugin={() => undefined}
          onUninstallPlugin={onUninstallPlugin}
        />
      ))}
    </Stack>
  );
}

function PluginCard({
  marketplace,
  plugin,
  featured,
  t,
  detail,
  authNotice,
  skillPreviewByKey,
  installingPluginIds,
  onReadPluginDetail,
  onReadPluginSkill,
  onInsertPluginMention,
  onInstallPlugin,
  onUninstallPlugin
}: {
  marketplace: PluginMarketplace;
  plugin: PluginEntry;
  featured: boolean;
  t: TranslateFn;
  detail?: PluginDetailEntry;
  authNotice?: PluginInstallAuthNotice;
  skillPreviewByKey: Record<string, string>;
  installingPluginIds: Set<string>;
  onReadPluginDetail: Props["onReadPluginDetail"];
  onReadPluginSkill: Props["onReadPluginSkill"];
  onInsertPluginMention: Props["onInsertPluginMention"];
  onInstallPlugin: Props["onInstallPlugin"];
  onUninstallPlugin: Props["onUninstallPlugin"];
}) {
  const unavailable = plugin.availability !== "AVAILABLE";
  const installing = installingPluginIds.has(plugin.id);

  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "flex-start" }}>
        <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ flex: 1, minWidth: 0 }}>
          <PluginLogo plugin={plugin} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
              {plugin.displayName}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
              {plugin.description || plugin.source}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25, overflowWrap: "anywhere" }}>
              {[marketplace.displayName ?? marketplace.name, plugin.developerName].filter(Boolean).join(" / ")}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap justifyContent={{ xs: "flex-start", md: "flex-end" }}>
          {installing ? (
            <Button size="small" variant="contained" disabled startIcon={<CircularProgress size={16} />}>
              {t("settings.plugins.installing")}
            </Button>
          ) : plugin.installed ? (
            <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => onUninstallPlugin(plugin)}>
              {t("settings.plugins.uninstall")}
            </Button>
          ) : (
            <Button size="small" variant="contained" startIcon={<DownloadIcon />} disabled={unavailable} onClick={() => onInstallPlugin(marketplace, plugin)}>
              {t("settings.plugins.install")}
            </Button>
          )}
          <Button size="small" onClick={() => onReadPluginDetail(marketplace, plugin)}>
            {t("settings.plugins.details")}
          </Button>
          <Button size="small" disabled={!plugin.installed || !plugin.enabled} onClick={() => onInsertPluginMention(marketplace, plugin)}>
            {t("settings.plugins.mention")}
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        <Chip size="small" label={plugin.installed ? t("settings.plugins.installed") : t("settings.plugins.available")} color={plugin.installed ? "success" : "default"} />
        {installing && <Chip size="small" label={t("settings.plugins.installing")} color="info" />}
        {plugin.installed && <Chip size="small" label={plugin.enabled ? t("settings.plugins.enabled") : t("settings.plugins.disabled")} />}
        {featured && <Chip size="small" label={t("settings.plugins.featured")} color="primary" />}
        {unavailable && <Chip size="small" label={t("settings.plugins.unavailable", { reason: translatePluginAvailability(plugin.availability, t) })} color="warning" />}
        <Chip size="small" label={t("settings.plugins.auth", { value: translatePluginAuthPolicy(plugin.authPolicy, t) })} variant="outlined" />
        <Chip size="small" label={t("settings.plugins.installPolicy", { value: translatePluginInstallPolicy(plugin.installPolicy, t) })} variant="outlined" />
        {plugin.installPolicySource && <Chip size="small" label={translatePluginPolicySource(plugin.installPolicySource, t)} variant="outlined" />}
        {plugin.category && <Chip size="small" label={translatePluginCategory(plugin.category, t)} />}
        {(plugin.localVersion || plugin.version) && <Chip size="small" label={plugin.localVersion ?? plugin.version} />}
      </Stack>

      {plugin.defaultPrompt.length > 0 && (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {plugin.defaultPrompt.map((prompt) => (
            <Typography key={prompt} variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
              {prompt}
            </Typography>
          ))}
        </Stack>
      )}

      {plugin.capabilities.length > 0 && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          {plugin.capabilities.slice(0, 6).map((capability) => (
            <Chip key={capability} size="small" variant="outlined" label={translatePluginCapability(capability, t)} />
          ))}
        </Stack>
      )}

      {plugin.websiteUrl && (
        <Button size="small" href={plugin.websiteUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />} sx={{ mt: 1 }}>
          {t("settings.plugins.website")}
        </Button>
      )}

      {authNotice && authNotice.apps.length > 0 && (
        <Box sx={{ mt: 1, borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 800 }}>
            {t("settings.plugins.authenticationNeeded")}
          </Typography>
          <Stack spacing={0.75} sx={{ mt: 0.75 }}>
            {authNotice.apps.map((app) => (
              <AppSummaryRow key={app.id} app={app} t={t} />
            ))}
          </Stack>
        </Box>
      )}

      {detail && (
        <PluginDetailView
          marketplace={marketplace}
          plugin={plugin}
          detail={detail}
          t={t}
          skillPreviewByKey={skillPreviewByKey}
          onReadPluginSkill={onReadPluginSkill}
        />
      )}
    </Box>
  );
}

function PluginDetailView({
  marketplace,
  plugin,
  detail,
  t,
  skillPreviewByKey,
  onReadPluginSkill
}: {
  marketplace: PluginMarketplace;
  plugin: PluginEntry;
  detail: PluginDetailEntry;
  t: TranslateFn;
  skillPreviewByKey: Record<string, string>;
  onReadPluginSkill: Props["onReadPluginSkill"];
}) {
  return (
    <Box sx={{ mt: 1, borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
      {detail.description && (
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
          {detail.description}
        </Typography>
      )}
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        <Chip size="small" label={t("settings.plugins.skills", { count: detail.skills.length })} />
        <Chip size="small" label={t("settings.plugins.hooks", { count: detail.hooks.length })} />
        <Chip size="small" label={t("settings.plugins.apps", { count: detail.apps.length })} />
        <Chip size="small" label={t("settings.plugins.templates", { count: detail.appTemplates.length })} />
        <Chip size="small" label={t("settings.plugins.mcp", { count: detail.mcpServers.length })} />
        {detail.scheduledTaskCount != null && <Chip size="small" label={t("settings.plugins.tasks", { count: detail.scheduledTaskCount })} />}
      </Stack>
      {detail.shareUrl && (
        <Button size="small" href={detail.shareUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />} sx={{ mt: 1 }}>
          {t("settings.plugins.share")}
        </Button>
      )}
      {detail.apps.length > 0 && (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {detail.apps.map((app) => (
            <AppSummaryRow key={app.id} app={app} t={t} />
          ))}
        </Stack>
      )}
      {detail.appTemplates.length > 0 && (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {detail.appTemplates.map((template) => (
            <Box key={template.templateId} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 0.75 }}>
              <Typography variant="caption" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
                {template.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                {[template.category, template.reason && t("settings.plugins.unavailable", { reason: template.reason })].filter(Boolean).join(" / ")}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}
      {detail.skills.length > 0 && (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {detail.skills.map((skill) => {
            const previewKey = `${plugin.id}:${skill.name}`;
            return (
              <Box key={skill.name} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 0.75 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" sx={{ flex: 1, overflowWrap: "anywhere" }}>
                    {skill.name} {skill.enabled ? "" : `(${t("settings.plugins.disabled")})`}
                  </Typography>
                  <Button size="small" disabled={!skill.remoteReadable} onClick={() => onReadPluginSkill(marketplace, plugin, skill.name)}>
                    {t("settings.plugins.preview")}
                  </Button>
                </Stack>
                {skillPreviewByKey[previewKey] && (
                  <Typography component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere", mt: 0.75, maxHeight: 180, overflow: "auto" }}>
                    {skillPreviewByKey[previewKey]}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}

function McpSettings({
  activeThreadId,
  tooling,
  t,
  mcpResourceContents,
  mcpOauthUrls,
  onReloadMcp,
  onStartMcpOauth,
  onReadMcpResource,
  onCallMcpTool
}: {
  activeThreadId: string | null;
  tooling: ToolingState;
  t: TranslateFn;
  mcpResourceContents: Record<string, McpResourceContentEntry[]>;
  mcpOauthUrls: Record<string, string>;
  onReloadMcp: Props["onReloadMcp"];
  onStartMcpOauth: Props["onStartMcpOauth"];
  onReadMcpResource: Props["onReadMcpResource"];
  onCallMcpTool: Props["onCallMcpTool"];
}) {
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({});
  const [toolResults, setToolResults] = useState<Record<string, string>>({});
  const [toolErrors, setToolErrors] = useState<Record<string, string>>({});
  const [callingTool, setCallingTool] = useState<string | null>(null);

  const submitToolCall = async (serverName: string, toolName: string, rawArgs: string): Promise<void> => {
    const key = toolCallKey(serverName, toolName);
    if (!activeThreadId) {
      setToolErrors((current) => ({ ...current, [key]: t("settings.plugins.selectConversationInfo") }));
      return;
    }
    setCallingTool(key);
    setToolErrors((current) => ({ ...current, [key]: "" }));
    try {
      const result = await onCallMcpTool(serverName, toolName, parseToolArguments(rawArgs));
      setToolResults((current) => ({ ...current, [key]: prettyJson(result) }));
    } catch (error) {
      setToolErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : String(error) }));
    } finally {
      setCallingTool(null);
    }
  };

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {t("settings.plugins.mcpTitle")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("settings.plugins.mcpDescription")}
          </Typography>
        </Box>
        <Button size="small" startIcon={<RefreshIcon />} onClick={onReloadMcp}>
          {t("settings.plugins.reloadMcp")}
        </Button>
      </Stack>
      {!activeThreadId && <Alert severity="info">{t("settings.plugins.selectConversationInfo")}</Alert>}
      {tooling.mcpServers.length === 0 && (
        <Typography color="text.secondary" sx={{ p: 1.5, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
          {t("settings.plugins.noMcpServers")}
        </Typography>
      )}
      {tooling.mcpServers.map((server) => {
        const authUrl = mcpOauthUrls[server.name];
        return (
          <Paper key={server.name} variant="outlined" sx={{ p: 1.25, bgcolor: "background.default" }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "flex-start" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
                  {server.name}
                </Typography>
                {server.serverInfo && (
                  <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                    {server.serverInfo}
                  </Typography>
                )}
              </Box>
              <Chip size="small" label={translateMcpAuthStatus(server.authStatus, t)} color={server.authStatus === "notLoggedIn" ? "warning" : "default"} />
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Chip size="small" label={t("settings.plugins.count.tools", { count: server.tools.length })} />
              <Chip size="small" label={t("settings.plugins.count.resources", { count: server.resources.length })} />
              <Chip size="small" label={t("settings.plugins.templates", { count: server.resourceTemplates.length })} />
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Button size="small" startIcon={<OpenInNewIcon />} onClick={() => onStartMcpOauth(server.name)}>
                {t("settings.plugins.oauth")}
              </Button>
              {authUrl && (
                <Button size="small" href={authUrl} target="_blank" rel="noreferrer">
                  {t("settings.plugins.authUrl")}
                </Button>
              )}
            </Stack>
            {server.tools.length > 0 && (
              <Stack spacing={1} sx={{ mt: 1 }}>
                {server.tools.slice(0, 8).map((tool) => {
                  const key = toolCallKey(server.name, tool.name);
                  const value = toolArgs[key] ?? parseToolArgumentsPreview(tool.inputSchema);
                  const disabled = !activeThreadId || callingTool === key;
                  return (
                    <Box key={tool.name} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
                            {tool.title ?? tool.name}
                          </Typography>
                          {tool.description && (
                            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                              {tool.description}
                            </Typography>
                          )}
                        </Box>
                        <Chip size="small" label={tool.name} />
                      </Stack>
                      <Typography component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, m: 0, mt: 0.75, maxHeight: 120, overflow: "auto" }}>
                        {prettyJson(tool.inputSchema)}
                      </Typography>
                      <TextField
                        size="small"
                        label={t("settings.plugins.argumentsJson")}
                        multiline
                        minRows={3}
                        fullWidth
                        sx={{ mt: 1 }}
                        value={value}
                        onChange={(event) => setToolArgs((current) => ({ ...current, [key]: event.target.value }))}
                      />
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                        <Button size="small" variant="contained" startIcon={<PlayArrowIcon />} disabled={disabled} onClick={() => void submitToolCall(server.name, tool.name, value)}>
                          {t("settings.plugins.callTool")}
                        </Button>
                        <Chip size="small" label={disabled ? t("settings.plugins.selectConversation") : t("settings.plugins.ready")} color={disabled ? "warning" : "success"} />
                      </Stack>
                      {toolErrors[key] && (
                        <Alert severity="error" sx={{ mt: 1 }}>
                          {toolErrors[key]}
                        </Alert>
                      )}
                      {toolResults[key] && (
                        <Typography component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, mt: 1, m: 0, maxHeight: 220, overflow: "auto" }}>
                          {toolResults[key]}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
                {server.tools.length > 8 && <Chip size="small" variant="outlined" label={`+${server.tools.length - 8}`} />}
              </Stack>
            )}
            {server.resources.length > 0 && (
              <Stack spacing={0.75} sx={{ mt: 1 }}>
                {server.resources.slice(0, 6).map((resource) => {
                  const uri = resource.uri;
                  const contents = uri ? mcpResourceContents[`${server.name}:${uri}`] : undefined;
                  return (
                    <Box key={resource.uri ?? resource.name} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 0.75 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="caption" sx={{ flex: 1, overflowWrap: "anywhere" }}>
                          {resource.title ?? resource.name}
                        </Typography>
                        <Button size="small" disabled={!uri} onClick={() => uri && onReadMcpResource(server.name, uri)}>
                          {t("settings.plugins.read")}
                        </Button>
                      </Stack>
                      {contents && (
                        <Typography component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere", mt: 0.75, maxHeight: 180, overflow: "auto" }}>
                          {contents.map((content) => content.text ?? `[blob ${content.mimeType ?? "application/octet-stream"}]`).join("\n\n")}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}

function HooksSettings({ hookGroups, t }: { hookGroups: HookGroup[]; t: TranslateFn }) {
  const hookCount = hookGroups.reduce((count, group) => count + group.hooks.length, 0);

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {t("settings.plugins.hooksTitle")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("settings.plugins.hooksDescription")}
          </Typography>
        </Box>
        <Chip size="small" label={t("settings.plugins.hooks", { count: hookCount })} />
      </Stack>
      {hookCount === 0 && (
        <Typography color="text.secondary" sx={{ p: 1.5, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
          {t("settings.plugins.noHooks")}
        </Typography>
      )}
      {hookGroups.map((group) => (
        <Paper key={group.cwd} variant="outlined" sx={{ p: 1.25, bgcolor: "background.default" }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "flex-start" }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
                {group.cwd}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("settings.plugins.hookSummary", { hooks: group.hooks.length, warnings: group.warnings.length, errors: group.errors.length })}
              </Typography>
            </Box>
            <Chip size="small" label={group.hooks.length} color={group.hooks.length ? "primary" : "default"} />
          </Stack>

          {group.warnings.map((warning) => (
            <Alert key={warning} severity="warning" sx={{ mt: 1 }}>
              {warning}
            </Alert>
          ))}
          {group.errors.map((error) => (
            <Alert key={`${error.path}:${error.message}`} severity="error" sx={{ mt: 1 }}>
              {[error.path, error.message].filter(Boolean).join(": ")}
            </Alert>
          ))}

          {group.hooks.map((hook) => (
            <Box key={hook.key} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1, mt: 1 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "flex-start" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
                    {hook.eventName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                    {hook.key}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap justifyContent={{ xs: "flex-start", sm: "flex-end" }}>
                  <Chip size="small" label={hook.enabled ? t("settings.plugins.enabled") : t("settings.plugins.disabled")} color={hook.enabled ? "success" : "default"} />
                  <Chip
                    size="small"
                    label={hook.trustStatus}
                    color={hook.trustStatus === "trusted" ? "success" : hook.trustStatus === "untrusted" ? "warning" : "default"}
                    variant="outlined"
                  />
                </Stack>
              </Stack>

              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                <Chip size="small" label={hook.handlerType} />
                <Chip size="small" label={hook.isManaged ? t("settings.plugins.managed") : t("settings.plugins.user")} variant="outlined" />
                <Chip size="small" label={t("settings.plugins.source", { value: hook.source })} variant="outlined" />
                {hook.matcher && <Chip size="small" label={t("settings.plugins.matcher", { value: hook.matcher })} variant="outlined" />}
                {hook.timeoutSec != null && <Chip size="small" label={t("settings.plugins.timeout", { value: hook.timeoutSec })} variant="outlined" />}
                {hook.pluginId && <Chip size="small" label={t("settings.plugins.plugin", { value: hook.pluginId })} variant="outlined" />}
              </Stack>

              {hook.statusMessage && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, overflowWrap: "anywhere" }}>
                  {hook.statusMessage}
                </Typography>
              )}
              {hook.command && (
                <Typography component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, m: 0, mt: 0.75, maxHeight: 140, overflow: "auto" }}>
                  {hook.command}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, overflowWrap: "anywhere" }}>
                {hook.sourcePath}
              </Typography>
              {hook.currentHash && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                  {hook.currentHash}
                </Typography>
              )}
            </Box>
          ))}
        </Paper>
      ))}
    </Stack>
  );
}

function PluginAppsSettings({ apps, t }: { apps: PluginAppEntry[]; t: TranslateFn }) {
  return (
    <Stack spacing={1.25}>
      {apps.length === 0 && (
        <Typography color="text.secondary" sx={{ p: 1.5, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
          {t("settings.plugins.noApps")}
        </Typography>
      )}
      {apps.map((app) => (
        <Paper key={app.id} variant="outlined" sx={{ p: 1.25, bgcolor: "background.default" }}>
          <AppSummaryRow app={app} t={t} />
        </Paper>
      ))}
    </Stack>
  );
}

function MarketplaceHeader({ marketplace, t }: { marketplace: PluginMarketplace; t: TranslateFn }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
          {marketplace.displayName ?? marketplace.name}
        </Typography>
        {marketplace.path && (
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            {marketplace.path}
          </Typography>
        )}
      </Box>
      <Chip size="small" label={t("settings.plugins.count.plugins", { count: marketplace.plugins.length })} />
    </Stack>
  );
}

function PluginLogo({ plugin }: { plugin: PluginEntry }) {
  if (plugin.logoUrl) {
    return (
      <Box
        component="img"
        src={plugin.logoUrl}
        alt=""
        sx={{ width: 36, height: 36, objectFit: "cover", borderRadius: 1, bgcolor: "action.selected", flex: "0 0 auto" }}
      />
    );
  }
  return (
    <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: "action.selected", display: "grid", placeItems: "center", flex: "0 0 auto" }}>
      <ExtensionIcon fontSize="small" color="primary" />
    </Box>
  );
}

function AppSummaryRow({ app, t }: { app: PluginAppEntry; t: TranslateFn }) {
  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 0.75 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
            {app.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
            {[app.category, app.developer, app.isEnabled === false ? t("settings.plugins.disabled") : null, app.isAccessible === false ? t("settings.plugins.needsAccess") : null]
              .filter(Boolean)
              .join(" / ")}
          </Typography>
        </Box>
        {app.installUrl && (
          <Button size="small" href={app.installUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />}>
            {t("settings.plugins.connect")}
          </Button>
        )}
      </Stack>
      {app.description && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, overflowWrap: "anywhere" }}>
          {app.description}
        </Typography>
      )}
    </Box>
  );
}

function translateMcpAuthStatus(status: string, t: TranslateFn): string {
  switch (status) {
    case "unsupported":
      return t("settings.plugins.authStatus.unsupported");
    case "notLoggedIn":
      return t("settings.plugins.authStatus.notLoggedIn");
    case "bearerToken":
      return t("settings.plugins.authStatus.bearerToken");
    case "oAuth":
      return t("settings.plugins.authStatus.oAuth");
    default:
      return t("settings.plugins.authStatus.unknown");
  }
}

function translatePluginAvailability(value: string, t: TranslateFn): string {
  switch (value) {
    case "AVAILABLE":
      return t("settings.plugins.availability.AVAILABLE");
    case "DISABLED_BY_ADMIN":
      return t("settings.plugins.availability.DISABLED_BY_ADMIN");
    default:
      return value;
  }
}

function translatePluginAuthPolicy(value: string, t: TranslateFn): string {
  switch (value) {
    case "ON_INSTALL":
      return t("settings.plugins.authPolicy.ON_INSTALL");
    case "ON_USE":
      return t("settings.plugins.authPolicy.ON_USE");
    default:
      return value;
  }
}

function translatePluginInstallPolicy(value: string, t: TranslateFn): string {
  switch (value) {
    case "NOT_AVAILABLE":
      return t("settings.plugins.installPolicyValue.NOT_AVAILABLE");
    case "AVAILABLE":
      return t("settings.plugins.installPolicyValue.AVAILABLE");
    case "INSTALLED_BY_DEFAULT":
      return t("settings.plugins.installPolicyValue.INSTALLED_BY_DEFAULT");
    default:
      return value;
  }
}

function translatePluginPolicySource(value: string, t: TranslateFn): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("workspace_setting")) {
    return t("settings.plugins.policySource.WORKSPACE_SETTING");
  }
  if (normalized.includes("implicit_canonical_app")) {
    return t("settings.plugins.policySource.IMPLICIT_CANONICAL_APP");
  }
  if (normalized.includes("developertools") || normalized.includes("developer tools")) {
    return t("settings.plugins.policySource.DeveloperTools");
  }
  return value;
}

function translatePluginCategory(value: string, t: TranslateFn): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("developertools") || normalized.includes("developer tools")) {
    return t("settings.plugins.category.DeveloperTools");
  }
  return value;
}

function translatePluginCapability(value: string, t: TranslateFn): string {
  switch (value) {
    case "Interactive":
      return t("settings.plugins.capability.Interactive");
    case "Read":
      return t("settings.plugins.capability.Read");
    case "Write":
      return t("settings.plugins.capability.Write");
    default:
      return value;
  }
}

function installedPluginEntries(tooling: ToolingState): Array<{ key: string; marketplace: PluginMarketplace; plugin: PluginEntry }> {
  const entries: Array<{ key: string; marketplace: PluginMarketplace; plugin: PluginEntry }> = [];
  const seen = new Set<string>();
  const sourceMarketplaces = tooling.installedPluginMarketplaces.length > 0 ? tooling.installedPluginMarketplaces : tooling.pluginMarketplaces;
  for (const marketplace of sourceMarketplaces) {
    for (const plugin of marketplace.plugins) {
      if (!plugin.installed || !plugin.enabled || seen.has(plugin.id)) {
        continue;
      }
      seen.add(plugin.id);
      entries.push({ key: `${marketplaceKey(marketplace)}:${plugin.id}`, marketplace, plugin });
    }
  }
  return entries;
}

function filterMarketplaces(marketplaces: PluginMarketplace[], search: string): PluginMarketplace[] {
  const needle = search.trim().toLowerCase();
  if (!needle) {
    return marketplaces;
  }
  return marketplaces
    .map((marketplace) => ({
      ...marketplace,
      plugins: marketplace.plugins.filter((plugin) =>
        [
          plugin.name,
          plugin.displayName,
          plugin.description,
          plugin.category,
          plugin.developerName,
          plugin.source,
          ...plugin.capabilities,
          ...plugin.keywords
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle))
      )
    }))
    .filter((marketplace) => marketplace.plugins.length > 0);
}

function marketplaceKey(marketplace: PluginMarketplace): string {
  return `${marketplace.name}:${marketplace.path ?? "remote"}`;
}

function toolCallKey(serverName: string, toolName: string): string {
  return `${serverName}:${toolName}`;
}

function parseToolArgumentsPreview(schema: JsonValue): string {
  return prettyJson(defaultToolArguments(schema));
}

function defaultToolArguments(schema: JsonValue): JsonValue {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const record = schema as Record<string, unknown>;
    if ("default" in record) {
      return record.default as JsonValue;
    }
  }
  return {};
}

function parseToolArguments(rawArgs: string): JsonValue {
  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return {};
  }
  return JSON.parse(trimmed) as JsonValue;
}

function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}
