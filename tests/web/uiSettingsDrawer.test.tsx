import { expect, test } from "bun:test";
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SettingsDrawer,
  AdvancedModelMappingEditor,
  RelayGroupExplorer,
  RelayCatalogTree,
  ThemeModeCards,
  ThemePluginManager,
  AuditSettingsPanel,
  ProfileSettingsPanel,
  SkillsSettingsPanel
} from "../../apps/web/src/settings/SettingsDrawer";
import { SecuritySettingsPanel } from "../../apps/web/src/components/SecuritySettingsPanel";
import { WorkspaceFilesSettingsPanel } from "../../apps/web/src/components/WorkspaceFilesSettingsPanel";
import { CodexPluginSettingsPanel } from "../../apps/web/src/components/CodexPluginSettingsPanel";
import { UsageBillingPanel } from "../../apps/web/src/components/UsageBillingPanel";
import type {
  ChannelGroupConfig,
  DangerousPermissionAuditEvent,
  ProviderConfig,
  ThemePlugin,
  ToolingState
} from "@codex-ui/shared";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined }
});

const t = (key: string, params?: Record<string, unknown>) => {
  if (params) {
    let res = key;
    for (const [k, v] of Object.entries(params)) {
      res += `:${k}=${String(v)}`;
    }
    return res;
  }
  return key;
};

const sampleProviders: ProviderConfig[] = [
  {
    id: "p-jiji",
    name: "吉吉 中转",
    kind: "openai",
    baseUrl: "https://api.jiji.example/v1",
    nativeModels: ["gpt-5.6-luna", "gpt-5.6-sol"],
    channelGroups: [
      {
        id: "g-default",
        name: "default",
        kind: "text",
        status: "enabled",
        groupRatio: 1.0,
        models: ["gpt-5.6-luna", "gpt-5.6-sol"]
      }
    ],
    relayList: { enabled: true }
  },
  {
    id: "p-deepkey",
    name: "DeepKey 中转",
    kind: "openai",
    baseUrl: "https://api.deepkey.example/v1",
    nativeModels: ["gpt-5.6-terra"],
    channelGroups: [
      {
        id: "g-team",
        name: "codex-team",
        kind: "text",
        status: "enabled",
        groupRatio: 0.08,
        models: ["gpt-5.6-terra"]
      }
    ],
    relayList: { enabled: true }
  }
];

const sampleTooling: ToolingState = {
  mcpServers: [],
  skillGroups: [
    {
      cwd: "/workspace/project",
      skills: [
        {
          name: "git-commit-helper",
          displayName: "Git Commit Helper",
          description: "Generates conventional commit messages",
          path: "/workspace/project/.skills/git-commit.md",
          scope: "workspace",
          enabled: true
        }
      ],
      errors: []
    }
  ],
  hookGroups: [],
  pluginMarketplaces: [
    {
      name: "official",
      plugins: [
        {
          id: "plugin-weather",
          name: "weather",
          displayName: "Weather Tool",
          description: "Fetch real-time weather information",
          version: "1.0.0",
          installed: false,
          enabled: true,
          source: "official",
          availability: "available",
          authPolicy: "none",
          installPolicy: "available",
          defaultPrompt: [],
          screenshotUrls: [],
          capabilities: [],
          keywords: []
        }
      ]
    }
  ],
  installedPluginMarketplaces: [],
  apps: [],
  featuredPluginIds: [],
  marketplaceErrors: []
};

const codexBackendEnabled = {
  codex: true,
  claude: false,
  agy: false,
  grok: false,
  muse: false,
  pi: false,
  opencode: false
};

const defaultDrawerProps = {
  open: true,
  disablePortal: true,
  windowsDesktop: false,
  themeMode: "system" as const,
  installedThemePluginIds: [],
  customThemePlugins: [],
  leftPanelVisible: true,
  showAssistantUsageDetails: false,
  waterfallDisplayMode: "all" as const,
  chatTypography: { fontSize: 14, lineHeight: 1.5, fontFamily: "default" },
  petDockEnabled: false,
  notificationPreferences: {},
  capacityTurnRetryEnabled: false,
  freeOllamaEnabled: true,
  freeAutoCompactEnabled: false,
  freeAutoCompactThreshold: 80,
  freeAutoCompactProviderId: null,
  freeAutoCompactGroupId: null,
  freeAutoCompactModel: null,
  compactMode: "off" as const,
  jevCompressThreshold: 85,
  compactCapabilityWarning: null,
  freeCompactionChannels: [],
  cwd: "/workspace/project",
  permission: "ask" as const,
  providers: sampleProviders,
  activeProviderId: "p-jiji",
  selectedModel: "gpt-5.6-luna",
  settingAssistantProviderId: "p-jiji",
  settingAssistantModel: "gpt-5.6-luna",
  settingAssistantReady: true,
  settingAssistantEffectiveModel: "gpt-5.6-luna",
  reasoningEffort: "medium",
  reasoningOptions: [
    { value: "low", label: "Low Reasoning" },
    { value: "medium", label: "Medium Reasoning" },
    { value: "high", label: "High Reasoning" }
  ],
  codexConfig: null,
  codexConfigLoading: false,
  codexConfigSaving: false,
  codexConfigError: null,
  tooling: sampleTooling,
  toolingLoading: false,
  skillExtraRoots: [],
  skillPreviews: {},
  fileDirectories: {},
  openFile: null,
  activeThreadId: null,
  pluginDetails: {},
  pluginSkillPreviews: {},
  pluginAuthNotices: {},
  installingPluginIds: new Set<string>(),
  mcpResourceContents: {},
  mcpOauthUrls: {},
  auditEvents: [],
  currentUser: { id: "u-admin", email: "admin@example.com", role: "admin" as const },
  members: [],
  membersLoading: false,
  membersError: null,
  allowedPermissions: ["ask" as const, "dangerBypass" as const],
  sessionToken: "auth-token-12345",
  t,
  onClose: () => {},
  onThemeModeChange: () => {},
  onReplaySetupGuide: () => {},
  onInstallThemePlugin: () => {},
  onUninstallThemePlugin: () => {},
  onSaveCustomThemePlugin: () => {},
  onRemoveCustomThemePlugin: () => {},
  onLeftPanelVisibleChange: () => {},
  onShowAssistantUsageDetailsChange: () => {},
  onWaterfallDisplayModeChange: () => {},
  onChatTypographyChange: () => {},
  onPetDockEnabledChange: () => {},
  onNotificationPreferencesChange: () => {},
  onCapacityTurnRetryEnabledChange: () => {},
  onFreeOllamaEnabledChange: () => {},
  onFreeAutoCompactEnabledChange: () => {},
  onFreeAutoCompactThresholdChange: () => {},
  onFreeAutoCompactProviderChange: () => {},
  onFreeAutoCompactGroupChange: () => {},
  onFreeAutoCompactModelChange: () => {},
  onCompactModeChange: () => {},
  onJevCompressThresholdChange: () => {},
  onCwdChange: () => {},
  onPermissionChange: () => {},
  onReasoningEffortChange: () => {},
  onSettingAssistantProviderChange: () => {},
  onSettingAssistantModelChange: () => {},
  onReloadCodexConfig: () => {},
  onCodexConfigFieldChange: () => {},
  onCodexConfigValueChange: () => {},
  onSaveProvider: async () => {},
  onActivateProvider: async () => {},
  onTestProviderWithCodex: async () => {},
  onDeleteProvider: async () => {},
  onRestoreProvider: async () => {},
  onReloadTooling: () => {},
  onReloadMcp: () => {},
  onExportProfile: async () => {},
  onImportProfile: async () => 0,
  onExportRelayConfig: async () => {},
  onImportRelayConfig: async () => 0,
  onExportRelayBackup: async () => {},
  onImportRelayBackup: async () => 0,
  onImportCapabilityCatalog: async () => ({} as any),
  onReloadAuditEvents: async () => {},
  onStartMcpOauth: () => {},
  onReadMcpResource: () => {},
  onCallMcpTool: async () => ({}),
  onToggleSkill: () => {},
  onSaveSkillExtraRoots: () => {},
  onReadSkillPreview: () => {},
  onCreateSkill: async () => {},
  onReadDirectory: () => {},
  onReadFile: () => {},
  onChangeOpenFileContent: () => {},
  onSaveOpenFile: () => {},
  onReadPluginDetail: () => {},
  onReadPluginSkill: () => {},
  onInsertPluginMention: () => {},
  onInstallPlugin: () => {},
  onUninstallPlugin: () => {},
  onReloadMembers: async () => {},
  onCreateMember: async () => {},
  onUpdateMember: async () => {},
  onDeleteMember: async () => {}
};

test("SettingsDrawer renders Relay Station section with channels and action buttons", () => {
  const html = renderToStaticMarkup(
    <SettingsDrawer {...defaultDrawerProps} initialSection="relay" />
  );

  expect(html).toContain("settings.relay.channels");
  expect(html).toContain("settings.relay.channelsSubtitle");
  expect(html).toContain("settings.relay.addChannel");
  expect(html).toContain("导出中转站");
  expect(html).toContain("导入中转站");
  expect(html).toContain("导入分享");
  expect(html).toContain("垃圾桶");
  expect(html).toContain("settings.relay.name");
  expect(html).toContain("settings.relay.status");
  expect(html).toContain("settings.relay.supportedModels");
  expect(html).toContain("settings.relay.action");
});

test("RelayGroupExplorer UI renders channel groups, multipliers, and view modes", () => {
  const group: ChannelGroupConfig = {
    id: "g-default",
    name: "default",
    kind: "text",
    status: "enabled",
    groupRatio: 1.0,
    priority: 1,
    weight: 0,
    keyMode: "polling",
    autoBan: true,
    models: ["gpt-5.6-luna"],
    keys: []
  };

  const html = renderToStaticMarkup(
    <RelayGroupExplorer
      groups={[group]}
      total={1}
      selectedId="g-default"
      search=""
      status="all"
      protocol="all"
      sort="name_asc"
      view="list"
      t={t}
      onSearch={() => {}}
      onStatus={() => {}}
      onProtocol={() => {}}
      onSort={() => {}}
      onView={() => {}}
      onSelect={() => {}}
    />
  );

  expect(html).toContain("default");
  expect(html).toContain("data-testid=\"relay-group-explorer\"");
  expect(html).toContain("1");
});

test("AdvancedModelMappingEditor UI renders model mapping rules and add dialog", () => {
  const group: ChannelGroupConfig = {
    id: "g-default",
    name: "default",
    kind: "text",
    status: "enabled",
    groupRatio: 1.0,
    advancedModelMapping: [
      { requestModel: "gpt-5", targetModel: "gpt-5.6-luna", enabled: true }
    ]
  };

  const html = renderToStaticMarkup(
    <AdvancedModelMappingEditor
      group={group}
      providers={sampleProviders}
      open={true}
      onToggleOpen={() => {}}
      onChange={() => {}}
      t={t}
    />
  );

  expect(html).toContain("gpt-5");
  expect(html).toContain("gpt-5.6-luna");
});

test("RelayCatalogTree UI renders vendor capability catalog and model hierarchies", () => {
  const catalog = {
    version: "1.0",
    vendors: [
      { id: "v-openai", name: "OpenAI" }
    ],
    data: [
      {
        model_name: "gpt-5.6-luna",
        vendor_id: "v-openai",
        display_name: "GPT-5.6 Luna",
        features: ["chat", "vision"]
      }
    ]
  };

  const group: ChannelGroupConfig = {
    id: "g-default",
    name: "default",
    kind: "text",
    models: ["gpt-5.6-luna"]
  };

  const html = renderToStaticMarkup(
    <RelayCatalogTree
      catalog={catalog as any}
      groups={[group]}
      selection={{ models: new Set(["gpt-5.6-luna"]) }}
      onSelection={() => {}}
      t={t}
    />
  );

  expect(html).toContain("OpenAI");
});

test("ProfileSettingsPanel UI renders export and import backup actions", () => {
  const html = renderToStaticMarkup(
    <ProfileSettingsPanel
      providerCount={2}
      onExportProfile={async () => {}}
      onImportProfile={async () => 0}
      onExportRelayConfig={async () => {}}
      onImportRelayConfig={async () => 0}
      t={t}
    />
  );

  expect(html).toContain("settings.profile.title");
  expect(html).toContain("settings.profile.export");
  expect(html).toContain("settings.profile.relaySecretsWarning");
});

test("SettingsDrawer renders Codex Engine section with reload and environment controls", () => {
  const html = renderToStaticMarkup(
    <SettingsDrawer {...defaultDrawerProps} cliBackendEnabled={codexBackendEnabled} initialSection="codex" />
  );

  expect(html).toContain("settings.section.codex");
  expect(html).toContain("settings.codex.subtitle");
  expect(html).toContain("settings.codex.userConfigSync");
  expect(html).toContain("settings.codex.reloadConfig");
});

test("SettingsDrawer renders Appearance section with ThemeModeCards and typography", () => {
  const html = renderToStaticMarkup(
    <SettingsDrawer {...defaultDrawerProps} initialSection="appearance" />
  );

  expect(html).toContain("settings.section.appearance");
  expect(html).toContain("settings.appearance.theme");
  expect(html).toContain("settings.appearance.activeSkin");
  expect(html).toContain("settings.appearance.chatTypography");
  expect(html).toContain("setupGuide.replay");
});

test("ThemeModeCards UI renders light, dark, and system options", () => {
  const html = renderToStaticMarkup(
    <ThemeModeCards
      themeMode="system"
      onThemeModeChange={() => {}}
      t={t}
    />
  );

  expect(html).toContain("settings.appearance.system");
  expect(html).toContain("settings.appearance.dark");
  expect(html).toContain("settings.appearance.light");
});

test("ThemePluginManager UI renders installed custom theme plugins", () => {
  const plugin: ThemePlugin = {
    id: "theme-neon",
    name: "Neon Cyber",
    description: "Cyberpunk high-contrast theme",
    author: "Designer",
    version: "1.0.0",
    isCustom: true,
    preview: {
      primary: "#00ffcc",
      secondary: "#ff00aa",
      background: "#0a0a12"
    },
    theme: {
      palette: {
        mode: "dark",
        primary: { main: "#00ffcc" }
      }
    }
  };

  const html = renderToStaticMarkup(
    <ThemePluginManager
      plugins={[plugin]}
      activeThemeId="theme-neon"
      installedThemePluginIds={["theme-neon"]}
      onThemeModeChange={() => {}}
      onInstallThemePlugin={() => {}}
      onUninstallThemePlugin={() => {}}
      onEditCustomThemePlugin={() => {}}
      onRemoveCustomThemePlugin={() => {}}
      t={t}
    />
  );

  expect(html).toContain("Neon Cyber");
  expect(html).toContain("Cyberpunk high-contrast theme");
});

test("SecuritySettingsPanel UI renders password, TOTP, and authentication controls", () => {
  const html = renderToStaticMarkup(
    <SecuritySettingsPanel
      token="test-token"
      isAdmin={true}
      t={t}
    />
  );

  expect(html).toContain("settings.security.changePassword");
  expect(html).toContain("settings.security.totpTitle");
});

test("AuditSettingsPanel UI renders dangerous permission audit records", () => {
  const event: DangerousPermissionAuditEvent = {
    id: "audit-1",
    createdAt: 1700000000000,
    method: "turn/start",
    severity: "critical",
    reasons: ["sandbox: danger-full-access", "approvalPolicy: never"],
    cwd: "/workspace/secure-project",
    threadId: "th-critical-99",
    model: "gpt-5.6-luna"
  };

  const html = renderToStaticMarkup(
    <AuditSettingsPanel
      events={[event]}
      onReload={async () => {}}
      t={t}
    />
  );

  expect(html).toContain("sandbox: danger-full-access");
  expect(html).toContain("approvalPolicy: never");
  expect(html).toContain("/workspace/secure-project");
});

test("WorkspaceFilesSettingsPanel UI renders workspace root and file tools", () => {
  const html = renderToStaticMarkup(
    <WorkspaceFilesSettingsPanel
      cwd="/workspace/project"
      fileDirectories={{}}
      openFile={null}
      t={t}
      onReadDirectory={() => {}}
      onReadFile={() => {}}
      onChangeOpenFileContent={() => {}}
      onSaveOpenFile={() => {}}
    />
  );

  expect(html).toContain("/workspace/project");
});

test("CodexPluginSettingsPanel UI renders plugin marketplace and category tabs", () => {
  const html = renderToStaticMarkup(
    <CodexPluginSettingsPanel
      activeThreadId={null}
      tooling={sampleTooling}
      toolingLoading={false}
      t={t}
      pluginDetails={{}}
      pluginSkillPreviews={{}}
      pluginAuthNotices={{}}
      installingPluginIds={new Set()}
      mcpResourceContents={{}}
      mcpOauthUrls={{}}
      onReadPluginDetail={() => {}}
      onReadPluginSkill={() => {}}
      onInsertPluginMention={() => {}}
      onInstallPlugin={() => {}}
      onUninstallPlugin={() => {}}
      onReloadTooling={() => {}}
      onReloadMcp={() => {}}
      onStartMcpOauth={() => {}}
      onReadMcpResource={() => {}}
      onCallMcpTool={async () => ({})}
    />
  );

  expect(html).toContain("Weather Tool");
  expect(html).toContain("Fetch real-time weather information");
});

test("UsageBillingPanel UI renders statistics cards and balance ledger", () => {
  const html = renderToStaticMarkup(
    <UsageBillingPanel
      token="test-token"
      currentUser={{ id: "u-admin", email: "admin@example.com", role: "admin" }}
      members={[]}
      t={t}
    />
  );

  expect(html).toContain("settings.usage.title");
  expect(html).toContain("settings.usage.ledger");
  expect(html).toContain("settings.usage.rechargeTitle");
  expect(html).toContain("settings.usage.empty");
  expect(html).toContain("settings.usage.refresh");
});

test("SkillsSettingsPanel UI renders skills list, scope, and extra roots", () => {
  const html = renderToStaticMarkup(
    <SkillsSettingsPanel
      tooling={sampleTooling}
      extraRoots={["/extra/custom-skills"]}
      previews={{}}
      t={t}
      onToggleSkill={() => {}}
      onSaveExtraRoots={() => {}}
      onReadPreview={() => {}}
      onCreateSkill={async () => {}}
    />
  );

  expect(html).toContain("Git Commit Helper");
  expect(html).toContain("Generates conventional commit messages");
  expect(html).toContain("/extra/custom-skills");
});

test("SettingsDrawer navigation rail renders all 19 section items", () => {
  const html = renderToStaticMarkup(
    <SettingsDrawer {...defaultDrawerProps} cliBackendEnabled={codexBackendEnabled} initialSection="about" />
  );

  expect(html).toContain("settings.nav.assistant");
  expect(html).toContain("settings.nav.codex");
  expect(html).toContain("settings.nav.appearance");
  expect(html).toContain("settings.nav.layout");
  expect(html).toContain("settings.nav.notifications");
  expect(html).toContain("settings.nav.workspace");
  expect(html).toContain("settings.nav.session");
  expect(html).toContain("settings.nav.relay");
  expect(html).toContain("settings.nav.launch");
  expect(html).toContain("settings.nav.skills");
  expect(html).toContain("settings.nav.plugins");
  expect(html).toContain("settings.nav.appplugins");
  expect(html).toContain("settings.nav.pet");
  expect(html).toContain("settings.nav.permissions");
  expect(html).toContain("settings.nav.usage");
  expect(html).toContain("settings.nav.gateway");
  expect(html).toContain("settings.nav.security");
  expect(html).toContain("settings.nav.privacy");
  expect(html).toContain("settings.nav.about");
});

test("FreeAutoCompactSettings exposes all four mutually exclusive strategies", () => {
  const drawerSource = readFileSync(join(import.meta.dir, "../../apps/web/src/settings/SettingsDrawer.tsx"), "utf8");
  expect(drawerSource).toContain('value="off"');
  expect(drawerSource).toContain('value="cheap"');
  expect(drawerSource).toContain('value="jev-sub"');
  expect(drawerSource).toContain('value="jev-token"');
  expect(drawerSource).toContain("onCompactModeChange");
  expect(drawerSource).toContain("compactCapabilityWarning");
  expect(drawerSource).toContain("onJevCompressThresholdChange");

  const appSource = readFileSync(join(import.meta.dir, "../../apps/web/src/App.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/FreeSavingsAction.tsx"), "utf8");
  expect(appSource).toContain("setCompactMode");
  expect(appSource).toContain("setJevCompressThreshold");
  expect(appSource).toContain("compactCapabilityWarning");
  expect(appSource).toContain('value="off"');
  expect(appSource).toContain('value="cheap"');
  expect(appSource).toContain('value="jev-sub"');
  expect(appSource).toContain('value="jev-token"');
  expect(appSource).toContain("JEV压缩阈值");
});
