import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Group as PanelGroup, Panel } from "react-resizable-panels";
import { ResizeHandle } from "./ResizeHandle";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import DeleteIcon from "@mui/icons-material/Delete";
import DescriptionIcon from "@mui/icons-material/Description";
import DownloadIcon from "@mui/icons-material/Download";
import FolderIcon from "@mui/icons-material/Folder";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import SecurityIcon from "@mui/icons-material/Security";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import ForumIcon from "@mui/icons-material/Forum";
import PersonIcon from "@mui/icons-material/Person";
import type { DangerousPermissionAuditEvent, JsonValue, ProviderConfig } from "@codex-ui/shared";
import type {
  McpResourceContentEntry,
  PluginAppEntry,
  FsDirectoryEntry,
  PendingServerRequest,
  PluginDetailEntry,
  PluginEntry,
  PluginInstallAuthNotice,
  PluginMarketplace,
  SkillEntry,
  TerminalSession,
  ToolingState
} from "../state/codexClient";
import { isApprovalServerRequest } from "../serverRequests";
import { TerminalConsole } from "./TerminalConsole";

const MonacoEditor = lazy(async () => {
  const module = await import("./MonacoEditor");
  return { default: module.MonacoEditor };
});

type Props = {
  account: JsonValue | null;
  providers: ProviderConfig[];
  activeThreadId: string | null;
  pendingRequests: PendingServerRequest[];
  tooling: ToolingState;
  toolingLoading: boolean;
  pluginDetails: Record<string, PluginDetailEntry>;
  pluginSkillPreviews: Record<string, string>;
  pluginAuthNotices: Record<string, PluginInstallAuthNotice>;
  skillExtraRoots: string[];
  skillPreviews: Record<string, string>;
  mcpResourceContents: Record<string, McpResourceContentEntry[]>;
  mcpOauthUrls: Record<string, string>;
  cwd: string;
  fileDirectories: Record<string, FsDirectoryEntry[]>;
  openFile: { path: string; content: string; savedContent: string; loading: boolean; saving: boolean } | null;
  terminalSessions: TerminalSession[];
  filesPanelLayout?: Record<string, number>;
  onFilesPanelLayoutChange?: (layout: Record<string, number>) => void;
  auditEvents: DangerousPermissionAuditEvent[];
  onAnswerRequest: (id: string | number, decision: "accept" | "acceptForSession" | "decline" | "cancel") => void;
  onExportProfile: () => Promise<void>;
  onImportProfile: (file: File) => Promise<number>;
  onReloadAuditEvents: () => Promise<void>;
  onReloadTooling: () => void;
  onReloadMcp: () => void;
  onStartMcpOauth: (serverName: string) => void;
  onReadMcpResource: (serverName: string, uri: string) => void;
  onCallMcpTool: (serverName: string, toolName: string, args: JsonValue) => Promise<JsonValue>;
  onToggleSkill: (skill: SkillEntry, enabled: boolean) => void;
  onSaveSkillExtraRoots: (roots: string[]) => void;
  onReadSkillPreview: (skill: SkillEntry) => void;
  onReadPluginDetail: (marketplace: PluginMarketplace, plugin: PluginEntry) => void;
  onReadPluginSkill: (marketplace: PluginMarketplace, plugin: PluginEntry, skillName: string) => void;
  onInsertPluginMention: (marketplace: PluginMarketplace, plugin: PluginEntry) => void;
  onInstallPlugin: (marketplace: PluginMarketplace, plugin: PluginEntry) => void;
  onUninstallPlugin: (plugin: PluginEntry) => void;
  onReadDirectory: (path: string) => void;
  onReadFile: (path: string) => void;
  onChangeOpenFileContent: (content: string) => void;
  onSaveOpenFile: () => void;
  onRunTerminalCommand: (command: string, cwd: string, size: { rows: number; cols: number }) => void;
  onWriteTerminalInput: (processId: string, input: string) => void;
  onTerminateTerminal: (processId: string) => void;
  onResizeTerminal: (processId: string, size: { rows: number; cols: number }) => void;
};

export function RightInspector({
  filesPanelLayout,
  onFilesPanelLayoutChange,
  account,
  providers,
  activeThreadId,
  pendingRequests,
  tooling,
  toolingLoading,
  pluginDetails,
  pluginSkillPreviews,
  pluginAuthNotices,
  skillExtraRoots,
  skillPreviews,
  mcpResourceContents,
  mcpOauthUrls,
  cwd,
  fileDirectories,
  openFile,
  terminalSessions,
  auditEvents,
  onAnswerRequest,
  onExportProfile,
  onImportProfile,
  onReloadAuditEvents,
  onReloadTooling,
  onReloadMcp,
  onStartMcpOauth,
  onReadMcpResource,
  onCallMcpTool,
  onToggleSkill,
  onSaveSkillExtraRoots,
  onReadSkillPreview,
  onReadPluginDetail,
  onReadPluginSkill,
  onInsertPluginMention,
  onInstallPlugin,
  onUninstallPlugin,
  onReadDirectory,
  onReadFile,
  onChangeOpenFileContent,
  onSaveOpenFile,
  onRunTerminalCommand,
  onWriteTerminalInput,
  onTerminateTerminal,
  onResizeTerminal
}: Props) {
  const [tab, setTab] = useState(0);
  return (
    <Box
      sx={{
        borderLeft: { xs: 0, md: "1px solid" },
        borderTop: { xs: "1px solid", md: 0 },
        borderColor: "divider",
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        gridTemplateRows: { xs: "auto auto", md: "auto minmax(0, 1fr)" },
        bgcolor: (theme) => alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.46 : 0.38)
      }}
    >
      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          px: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.58 : 0.64)
        }}
      >
        <Tab label="Config" />
        <Tab label="Tools" />
        <Tab label="Files" />
      </Tabs>
      <Box sx={{ overflow: "auto", p: { xs: 1.25, sm: 1.5 } }}>
        {tab === 0 && (
          <ConfigTab
            account={account}
            providers={providers}
            onExportProfile={onExportProfile}
            onImportProfile={onImportProfile}
            auditEvents={auditEvents}
            onReloadAuditEvents={onReloadAuditEvents}
          />
        )}
        {tab === 1 && (
          <ToolsTab
            activeThreadId={activeThreadId}
            pendingRequests={pendingRequests}
            tooling={tooling}
            toolingLoading={toolingLoading}
            pluginDetails={pluginDetails}
            pluginSkillPreviews={pluginSkillPreviews}
            pluginAuthNotices={pluginAuthNotices}
            skillExtraRoots={skillExtraRoots}
            skillPreviews={skillPreviews}
            mcpResourceContents={mcpResourceContents}
            mcpOauthUrls={mcpOauthUrls}
            onAnswerRequest={onAnswerRequest}
            onReloadTooling={onReloadTooling}
            onReloadMcp={onReloadMcp}
            onStartMcpOauth={onStartMcpOauth}
            onReadMcpResource={onReadMcpResource}
            onCallMcpTool={onCallMcpTool}
            onToggleSkill={onToggleSkill}
            onSaveSkillExtraRoots={onSaveSkillExtraRoots}
            onReadSkillPreview={onReadSkillPreview}
            onReadPluginDetail={onReadPluginDetail}
            onReadPluginSkill={onReadPluginSkill}
            onInsertPluginMention={onInsertPluginMention}
            onInstallPlugin={onInstallPlugin}
            onUninstallPlugin={onUninstallPlugin}
          />
        )}
        {tab === 2 && (
          <FilesTab
            filesPanelLayout={filesPanelLayout}
            onFilesPanelLayoutChange={onFilesPanelLayoutChange}
            cwd={cwd}
            fileDirectories={fileDirectories}
            openFile={openFile}
            terminalSessions={terminalSessions}
            onReadDirectory={onReadDirectory}
            onReadFile={onReadFile}
            onChangeOpenFileContent={onChangeOpenFileContent}
            onSaveOpenFile={onSaveOpenFile}
            onRunTerminalCommand={onRunTerminalCommand}
            onWriteTerminalInput={onWriteTerminalInput}
            onTerminateTerminal={onTerminateTerminal}
            onResizeTerminal={onResizeTerminal}
          />
        )}
      </Box>
    </Box>
  );
}

function ConfigTab({
  account,
  providers,
  onExportProfile,
  onImportProfile,
  auditEvents,
  onReloadAuditEvents
}: {
  account: JsonValue | null;
  providers: ProviderConfig[];
  onExportProfile: () => Promise<void>;
  onImportProfile: (file: File) => Promise<number>;
  auditEvents: DangerousPermissionAuditEvent[];
  onReloadAuditEvents: () => Promise<void>;
}) {
  return (
    <Stack spacing={1.5}>
      <CompanionPanel providers={providers} auditCount={auditEvents.length} />
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          background: (theme) =>
            theme.palette.mode === "dark"
              ? "linear-gradient(180deg, rgba(14,22,34,0.96), rgba(9,14,22,0.98))"
              : "linear-gradient(180deg, rgba(235,247,255,0.95), rgba(255,255,255,0.98))"
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <ForumIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>
            My contacts
          </Typography>
          <Chip size="small" label="2/8" />
        </Stack>
        <Stack spacing={1}>
          {[
            { name: "Codex 小蓝", status: "online", detail: "Code review, docs, bug fixing" },
            { name: "Workspace Twin", status: "ready", detail: `${providers.length} relay channel${providers.length === 1 ? "" : "s"} configured` }
          ].map((friend) => (
            <Stack
              key={friend.name}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ p: 1, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "background.paper" }}
            >
              <Box
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: 1,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  boxShadow: "0 8px 18px rgba(24,119,242,0.18)"
                }}
              >
                <PersonIcon fontSize="small" />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 750 }}>
                  {friend.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                  {friend.detail}
                </Typography>
              </Box>
              <Chip size="small" label={friend.status} color={friend.status === "online" ? "success" : "primary"} variant="outlined" />
            </Stack>
          ))}
        </Stack>
      </Paper>
      <ProfilePanel providerCount={providers.length} onExportProfile={onExportProfile} onImportProfile={onImportProfile} />
      <AuditPanel events={auditEvents} onReload={onReloadAuditEvents} />
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <SecurityIcon fontSize="small" />
          <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
            Account
          </Typography>
        </Stack>
        <Typography component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere", mt: 1 }}>
          {JSON.stringify(account, null, 2)}
        </Typography>
      </Paper>
    </Stack>
  );
}

function CompanionPanel({ providers, auditCount }: { providers: ProviderConfig[]; auditCount: number }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        overflow: "hidden",
        background: (theme) =>
          theme.palette.mode === "dark"
            ? "linear-gradient(180deg, rgba(24,38,66,0.94), rgba(9,14,22,0.98))"
            : "linear-gradient(180deg, #EAF5FF, #FFFFFF)"
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.25, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <SmartToyIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ fontWeight: 850, flex: 1 }}>
          Codex buddy
        </Typography>
        <Chip size="small" label="LV 07" color="warning" variant="outlined" />
      </Stack>
      <Box
        sx={{
          height: 170,
          position: "relative",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          background:
            "radial-gradient(circle at 20% 18%, rgba(255,255,255,0.95), transparent 12%), radial-gradient(circle at 78% 24%, rgba(255,255,255,0.8), transparent 10%), linear-gradient(135deg, rgba(145,198,255,0.55), rgba(239,246,255,0.25))"
        }}
      >
        <Box
          sx={{
            width: 98,
            height: 98,
            borderRadius: "34px 34px 28px 28px",
            bgcolor: "#3B82F6",
            border: "3px solid",
            borderColor: "#1D4ED8",
            position: "relative",
            boxShadow: "0 18px 34px rgba(37,99,235,0.32)",
            "&:before": {
              content: '""',
              position: "absolute",
              left: 20,
              right: 20,
              top: 26,
              height: 34,
              borderRadius: 2,
              bgcolor: "#0F172A"
            },
            "&:after": {
              content: '">_"',
              position: "absolute",
              left: 34,
              top: 31,
              color: "#67E8F9",
              fontFamily: "monospace",
              fontSize: 24,
              fontWeight: 800
            }
          }}
        />
      </Box>
      <Box sx={{ p: 1.25 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Chip size="small" label="online" color="success" />
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            Codex 小蓝
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          代码有问题？找我。配置、插件、文件和终端状态都在这里盯着。
        </Typography>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`${providers.length} channels`} />
          <Chip size="small" label={`${auditCount} audits`} color={auditCount ? "warning" : "default"} />
          <Chip size="small" label="settings moved" color="primary" variant="outlined" />
        </Stack>
      </Box>
    </Paper>
  );
}

function AuditPanel({
  events,
  onReload
}: {
  events: DangerousPermissionAuditEvent[];
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <SecurityIcon fontSize="small" color={events.length ? "warning" : "inherit"} />
        <Typography variant="subtitle2" sx={{ fontWeight: 750, flex: 1 }}>
          Dangerous permission audit
        </Typography>
        <Chip size="small" label={events.length} color={events.length ? "warning" : "default"} />
        <Button
          size="small"
          startIcon={<RefreshIcon />}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onReload();
            } finally {
              setBusy(false);
            }
          }}
        >
          Refresh
        </Button>
      </Stack>
      {events.length === 0 && <Typography color="text.secondary">No dangerous permission sessions recorded.</Typography>}
      <Stack spacing={1}>
        {events.slice(0, 5).map((event) => (
          <Box key={event.id} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" color={event.severity === "critical" ? "error" : "warning"} label={event.severity} />
              <Typography variant="caption" sx={{ flex: 1, overflowWrap: "anywhere" }}>
                {event.method} {event.model ? `- ${event.model}` : ""}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, overflowWrap: "anywhere" }}>
              {formatAuditTime(event.createdAt)} {event.cwd ? `- ${event.cwd}` : ""} {event.threadId ? `- ${event.threadId}` : ""}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
              {event.reasons.join(", ")}
              {event.inputSummary ? ` - input ${event.inputSummary.items} items (${event.inputSummary.textItems} text, ${event.inputSummary.imageItems} images, ${event.inputSummary.mentionItems} mentions)` : ""}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}

function formatAuditTime(value: number): string {
  return new Date(value).toLocaleString();
}

function ProfilePanel({
  providerCount,
  onExportProfile,
  onImportProfile
}: {
  providerCount: number;
  onExportProfile: () => Promise<void>;
  onImportProfile: (file: File) => Promise<number>;
}) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <DownloadIcon fontSize="small" />
        <Typography variant="subtitle2" sx={{ fontWeight: 750, flex: 1 }}>
          UI profile
        </Typography>
        <Chip size="small" label={`${providerCount} providers`} />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Export and import provider metadata without API keys.
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setStatus("");
            try {
              await onExportProfile();
              setStatus("Profile exported.");
            } catch {
              setStatus("Profile export failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Export profile
        </Button>
        <Button size="small" variant="outlined" component="label" startIcon={<UploadFileIcon />} disabled={busy}>
          Import profile
          <input
            aria-label="Import profile file"
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) {
                return;
              }
              void (async () => {
                setBusy(true);
                setStatus("");
                try {
                  const count = await onImportProfile(file);
                  setStatus(`Imported ${count} providers.`);
                } catch {
                  setStatus("Profile import failed.");
                } finally {
                  setBusy(false);
                }
              })();
            }}
          />
        </Button>
      </Stack>
      {status && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          {status}
        </Typography>
      )}
    </Paper>
  );
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function ToolsTab({
  activeThreadId,
  pendingRequests,
  tooling,
  toolingLoading,
  pluginDetails,
  pluginSkillPreviews,
  pluginAuthNotices,
  skillExtraRoots,
  skillPreviews,
  mcpResourceContents,
  mcpOauthUrls,
  onAnswerRequest,
  onReloadTooling,
  onReloadMcp,
  onStartMcpOauth,
  onReadMcpResource,
  onCallMcpTool,
  onToggleSkill,
  onSaveSkillExtraRoots,
  onReadSkillPreview,
  onReadPluginDetail,
  onReadPluginSkill,
  onInsertPluginMention,
  onInstallPlugin,
  onUninstallPlugin
}: {
  activeThreadId: string | null;
  pendingRequests: PendingServerRequest[];
  tooling: ToolingState;
  toolingLoading: boolean;
  pluginDetails: Record<string, PluginDetailEntry>;
  pluginSkillPreviews: Record<string, string>;
  pluginAuthNotices: Record<string, PluginInstallAuthNotice>;
  skillExtraRoots: string[];
  skillPreviews: Record<string, string>;
  mcpResourceContents: Record<string, McpResourceContentEntry[]>;
  mcpOauthUrls: Record<string, string>;
  onAnswerRequest: Props["onAnswerRequest"];
  onReloadTooling: Props["onReloadTooling"];
  onReloadMcp: Props["onReloadMcp"];
  onStartMcpOauth: Props["onStartMcpOauth"];
  onReadMcpResource: Props["onReadMcpResource"];
  onCallMcpTool: Props["onCallMcpTool"];
  onToggleSkill: Props["onToggleSkill"];
  onSaveSkillExtraRoots: Props["onSaveSkillExtraRoots"];
  onReadSkillPreview: Props["onReadSkillPreview"];
  onReadPluginDetail: Props["onReadPluginDetail"];
  onReadPluginSkill: Props["onReadPluginSkill"];
  onInsertPluginMention: Props["onInsertPluginMention"];
  onInstallPlugin: Props["onInstallPlugin"];
  onUninstallPlugin: Props["onUninstallPlugin"];
}) {
  const [toolTab, setToolTab] = useState(0);
  const skillCount = tooling.skillGroups.reduce((count, group) => count + group.skills.length, 0);
  const pluginCount = tooling.pluginMarketplaces.reduce((count, marketplace) => count + marketplace.plugins.length, 0);

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="subtitle2" sx={{ fontWeight: 750, flex: 1 }}>
          Tooling
        </Typography>
        {toolingLoading && <CircularProgress size={16} />}
        <Button size="small" startIcon={<RefreshIcon />} onClick={onReloadTooling}>
          Refresh
        </Button>
      </Stack>

      <ApprovalsPanel pendingRequests={pendingRequests} onAnswerRequest={onAnswerRequest} />

      {tooling.marketplaceErrors.map((message) => (
        <Alert key={message} severity="warning">
          {message}
        </Alert>
      ))}

      <Tabs value={toolTab} onChange={(_, value) => setToolTab(value)} variant="scrollable" scrollButtons="auto">
        <Tab label={`MCP ${tooling.mcpServers.length}`} />
        <Tab label={`Skills ${skillCount}`} />
        <Tab label={`Plugins ${pluginCount}`} />
      </Tabs>

      {toolTab === 0 && (
        <McpPanel
          tooling={tooling}
          mcpResourceContents={mcpResourceContents}
          mcpOauthUrls={mcpOauthUrls}
          activeThreadId={activeThreadId}
          onReloadMcp={onReloadMcp}
          onStartMcpOauth={onStartMcpOauth}
          onReadMcpResource={onReadMcpResource}
          onCallMcpTool={onCallMcpTool}
        />
      )}
      {toolTab === 1 && (
        <SkillsPanel
          tooling={tooling}
          extraRoots={skillExtraRoots}
          previews={skillPreviews}
          onToggleSkill={onToggleSkill}
          onSaveExtraRoots={onSaveSkillExtraRoots}
          onReadPreview={onReadSkillPreview}
        />
      )}
      {toolTab === 2 && (
        <PluginsPanel
          tooling={tooling}
          pluginDetails={pluginDetails}
          pluginSkillPreviews={pluginSkillPreviews}
          pluginAuthNotices={pluginAuthNotices}
          onReadPluginDetail={onReadPluginDetail}
          onReadPluginSkill={onReadPluginSkill}
          onInsertPluginMention={onInsertPluginMention}
          onInstallPlugin={onInstallPlugin}
          onUninstallPlugin={onUninstallPlugin}
        />
      )}
    </Stack>
  );
}

function ApprovalsPanel({
  pendingRequests,
  onAnswerRequest
}: {
  pendingRequests: PendingServerRequest[];
  onAnswerRequest: Props["onAnswerRequest"];
}) {
  const approvalRequests = useMemo(
    () => pendingRequests.filter(isApprovalServerRequest),
    [pendingRequests]
  );
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: approvalRequests.length ? 1 : 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 750, flex: 1 }}>
          Approvals
        </Typography>
        <Chip size="small" label={approvalRequests.length} color={approvalRequests.length ? "warning" : "default"} />
      </Stack>
      {approvalRequests.length === 0 && <Typography color="text.secondary">No pending approvals.</Typography>}
      <Stack spacing={1}>
        {approvalRequests.map((request) => (
          <Box key={String(request.id)} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1, mt: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
              {request.method}
            </Typography>
            <Typography component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere", my: 1 }}>
              {JSON.stringify(request.params, null, 2)}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="small" variant="contained" onClick={() => onAnswerRequest(request.id, "accept")}>
                Accept
              </Button>
              <Button size="small" onClick={() => onAnswerRequest(request.id, "acceptForSession")}>
                Session
              </Button>
              <Button size="small" color="warning" onClick={() => onAnswerRequest(request.id, "decline")}>
                Decline
              </Button>
              <Button size="small" color="error" onClick={() => onAnswerRequest(request.id, "cancel")}>
                Cancel
              </Button>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}

function McpPanel({
  tooling,
  mcpResourceContents,
  mcpOauthUrls,
  activeThreadId,
  onReloadMcp,
  onStartMcpOauth,
  onReadMcpResource,
  onCallMcpTool
}: {
  tooling: ToolingState;
  mcpResourceContents: Record<string, McpResourceContentEntry[]>;
  mcpOauthUrls: Record<string, string>;
  activeThreadId: string | null;
  onReloadMcp: Props["onReloadMcp"];
  onStartMcpOauth: Props["onStartMcpOauth"];
  onReadMcpResource: Props["onReadMcpResource"];
  onCallMcpTool: Props["onCallMcpTool"];
}) {
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({});
  const [toolResults, setToolResults] = useState<Record<string, string>>({});
  const [toolErrors, setToolErrors] = useState<Record<string, string>>({});
  const [toolStatuses, setToolStatuses] = useState<Record<string, string>>({});
  const [callingTool, setCallingTool] = useState<string | null>(null);

  const submitToolCall = async (serverName: string, toolName: string, rawArgs: string): Promise<void> => {
    const key = toolCallKey(serverName, toolName);
    if (!activeThreadId) {
      setToolErrors((current) => ({ ...current, [key]: "Select a conversation before calling an MCP tool." }));
      return;
    }
    setCallingTool(key);
    setToolErrors((current) => ({ ...current, [key]: "" }));
    setToolStatuses((current) => ({ ...current, [key]: "Calling tool..." }));
    try {
      const parsedArgs = parseToolArguments(rawArgs);
      const result = await onCallMcpTool(serverName, toolName, parsedArgs);
      setToolResults((current) => ({ ...current, [key]: prettyJson(result) }));
      setToolStatuses((current) => ({ ...current, [key]: "Tool call finished." }));
    } catch (error) {
      setToolErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : String(error) }));
      setToolStatuses((current) => ({ ...current, [key]: "Tool call failed." }));
    } finally {
      setCallingTool(null);
    }
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 750, flex: 1 }}>
          MCP servers
        </Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={onReloadMcp}>
          Reload
        </Button>
      </Stack>
      {!activeThreadId && (
        <Alert severity="info">
          Select a conversation to enable MCP tool calls.
        </Alert>
      )}
      {tooling.mcpServers.length === 0 && <Typography color="text.secondary">No MCP servers discovered.</Typography>}
      {tooling.mcpServers.map((server) => {
        const authUrl = mcpOauthUrls[server.name];
        return (
          <Paper key={server.name} variant="outlined" sx={{ p: 1.25 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle2" sx={{ fontWeight: 750, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                {server.name}
              </Typography>
              <Chip size="small" label={server.authStatus} color={server.authStatus === "notLoggedIn" ? "warning" : "default"} />
            </Stack>
            {server.serverInfo && (
              <Typography variant="caption" color="text.secondary">
                {server.serverInfo}
              </Typography>
            )}
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Chip size="small" label={`tools ${server.tools.length}`} />
              <Chip size="small" label={`resources ${server.resources.length}`} />
              <Chip size="small" label={`templates ${server.resourceTemplates.length}`} />
            </Stack>
            {server.tools.length > 0 && (
              <Stack spacing={1} sx={{ mt: 1 }}>
                {server.tools.slice(0, 8).map((tool) => {
                  const key = toolCallKey(server.name, tool.name);
                  const value = toolArgs[key] ?? parseToolArgumentsPreview(tool.inputSchema);
                  const disabled = !activeThreadId || callingTool === key;
                  return (
                    <Box key={tool.name} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
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
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                        Input schema
                      </Typography>
                      <Typography component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, m: 0, mt: 0.5, maxHeight: 120, overflow: "auto" }}>
                        {prettyJson(tool.inputSchema)}
                      </Typography>
                      <TextField
                        size="small"
                        label="Arguments JSON"
                        multiline
                        minRows={4}
                        fullWidth
                        sx={{ mt: 1 }}
                        value={value}
                        onChange={(event) => setToolArgs((current) => ({ ...current, [key]: event.target.value }))}
                      />
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<PlayArrowIcon />}
                          disabled={disabled}
                          onClick={() => void submitToolCall(server.name, tool.name, value)}
                        >
                          Call tool
                        </Button>
                        <Chip size="small" label={disabled ? "select conversation" : "ready"} color={disabled ? "warning" : "success"} />
                      </Stack>
                      {toolStatuses[key] && (
                        <Alert severity="info" sx={{ mt: 1 }}>
                          {toolStatuses[key]}
                        </Alert>
                      )}
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
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Button size="small" startIcon={<OpenInNewIcon />} onClick={() => onStartMcpOauth(server.name)}>
                OAuth
              </Button>
              {authUrl && (
                <Button size="small" href={authUrl} target="_blank" rel="noreferrer">
                  Auth URL
                </Button>
              )}
            </Stack>
            {server.resources.length > 0 && (
              <Stack spacing={0.75} sx={{ mt: 1 }}>
                {server.resources.slice(0, 4).map((resource) => {
                  const uri = resource.uri;
                  const contents = uri ? mcpResourceContents[`${server.name}:${uri}`] : undefined;
                  return (
                    <Box key={resource.uri ?? resource.name} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 0.75 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="caption" sx={{ flex: 1, overflowWrap: "anywhere" }}>
                          {resource.title ?? resource.name}
                        </Typography>
                        <Button size="small" disabled={!uri} onClick={() => uri && onReadMcpResource(server.name, uri)}>
                          Read
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

function SkillsPanel({
  tooling,
  extraRoots,
  previews,
  onToggleSkill,
  onSaveExtraRoots,
  onReadPreview
}: {
  tooling: ToolingState;
  extraRoots: string[];
  previews: Record<string, string>;
  onToggleSkill: Props["onToggleSkill"];
  onSaveExtraRoots: (roots: string[]) => void;
  onReadPreview: (skill: SkillEntry) => void;
}) {
  const [extraRootsText, setExtraRootsText] = useState(extraRoots.join("\n"));

  return (
    <Stack spacing={1}>
      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
          Skill roots
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Add one extra root per line. These roots are sent to `skills/extraRoots/set` and then reloaded into the inventory.
        </Typography>
        <TextField
          sx={{ mt: 1 }}
          size="small"
          fullWidth
          multiline
          minRows={3}
          label="Extra roots"
          value={extraRootsText}
          onChange={(event) => setExtraRootsText(event.target.value)}
        />
        <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
          <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={() => onSaveExtraRoots(parseLines(extraRootsText))}>
            Save roots
          </Button>
          <Chip size="small" label={`${extraRoots.length} saved`} />
        </Stack>
      </Paper>
      {tooling.skillGroups.length === 0 && <Typography color="text.secondary">No skills discovered.</Typography>}
      {tooling.skillGroups.map((group) => (
        <Paper key={group.cwd} variant="outlined" sx={{ p: 1.25 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
            {group.cwd}
          </Typography>
          {group.errors.map((error) => (
            <Alert key={`${error.path}:${error.message}`} severity="warning" sx={{ mt: 1 }}>
              {error.path}: {error.message}
            </Alert>
          ))}
          <Stack spacing={1} sx={{ mt: 1 }}>
            {group.skills.map((skill) => (
              <Box key={skill.path || skill.name} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
                      {skill.displayName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                      {skill.shortDescription || skill.description || skill.path}
                    </Typography>
                  </Box>
                  <Chip size="small" label={skill.scope} />
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ flex: 1, overflowWrap: "anywhere" }}>
                    {skill.path}
                  </Typography>
                  <FormControlLabel
                    sx={{ mr: 0 }}
                    control={<Switch size="small" checked={skill.enabled} onChange={(event) => onToggleSkill(skill, event.target.checked)} />}
                    label={skill.enabled ? "Enabled" : "Disabled"}
                  />
                </Stack>
                {skill.path && (
                  <Stack spacing={0.75} sx={{ mt: 1 }}>
                    <Button size="small" onClick={() => onReadPreview(skill)}>
                      Preview markdown
                    </Button>
                    {previews[skill.path] && (
                      <Typography component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere", m: 0, maxHeight: 240, overflow: "auto" }}>
                        {previews[skill.path]}
                      </Typography>
                    )}
                  </Stack>
                )}
              </Box>
            ))}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

function PluginsPanel({
  tooling,
  pluginDetails,
  pluginSkillPreviews,
  pluginAuthNotices,
  onReadPluginDetail,
  onReadPluginSkill,
  onInsertPluginMention,
  onInstallPlugin,
  onUninstallPlugin
}: {
  tooling: ToolingState;
  pluginDetails: Record<string, PluginDetailEntry>;
  pluginSkillPreviews: Record<string, string>;
  pluginAuthNotices: Record<string, PluginInstallAuthNotice>;
  onReadPluginDetail: Props["onReadPluginDetail"];
  onReadPluginSkill: Props["onReadPluginSkill"];
  onInsertPluginMention: Props["onInsertPluginMention"];
  onInstallPlugin: Props["onInstallPlugin"];
  onUninstallPlugin: Props["onUninstallPlugin"];
}) {
  const installedMentionPlugins = useMemo(() => {
    const entries: Array<{ key: string; marketplace: PluginMarketplace; plugin: PluginEntry }> = [];
    const seen = new Set<string>();
    const sourceMarketplaces = tooling.installedPluginMarketplaces.length > 0 ? tooling.installedPluginMarketplaces : tooling.pluginMarketplaces;
    for (const marketplace of sourceMarketplaces) {
      for (const plugin of marketplace.plugins) {
        if (!plugin.installed || !plugin.enabled || seen.has(plugin.id)) {
          continue;
        }
        seen.add(plugin.id);
        entries.push({ key: `${marketplace.name}:${plugin.id}`, marketplace, plugin });
      }
    }
    return entries;
  }, [tooling.installedPluginMarketplaces, tooling.pluginMarketplaces]);
  const [selectedMentionKey, setSelectedMentionKey] = useState("");
  const selectedMention = installedMentionPlugins.find((entry) => entry.key === selectedMentionKey) ?? installedMentionPlugins[0];

  return (
    <Stack spacing={1}>
      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
          Installed mentions
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Composer mentions are limited to plugins that are installed and enabled.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
          <FormControl size="small" sx={{ flex: 1, minWidth: 180 }}>
            <InputLabel>Installed plugin</InputLabel>
            <Select
              value={selectedMention?.key ?? ""}
              label="Installed plugin"
              onChange={(event) => setSelectedMentionKey(event.target.value)}
              disabled={installedMentionPlugins.length === 0}
            >
              {installedMentionPlugins.map((entry) => (
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
            Insert mention
          </Button>
        </Stack>
        {installedMentionPlugins.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            No installed plugins are available for mention insertion.
          </Typography>
        )}
      </Paper>
      {tooling.apps.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.25 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
            Apps
          </Typography>
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            {tooling.apps.slice(0, 6).map((app) => (
              <AppSummaryRow key={app.id} app={app} />
            ))}
          </Stack>
        </Paper>
      )}
      {tooling.pluginMarketplaces.length === 0 && <Typography color="text.secondary">No plugin marketplaces discovered.</Typography>}
      {tooling.pluginMarketplaces.map((marketplace) => (
        <Paper key={`${marketplace.name}:${marketplace.path ?? "remote"}`} variant="outlined" sx={{ p: 1.25 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
            {marketplace.displayName ?? marketplace.name}
          </Typography>
          {marketplace.path && (
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
              {marketplace.path}
            </Typography>
          )}
          <Stack spacing={1} sx={{ mt: 1 }}>
            {marketplace.plugins.length === 0 && <Typography color="text.secondary">No plugins in this marketplace.</Typography>}
            {marketplace.plugins.map((plugin) => {
              const unavailable = plugin.availability !== "AVAILABLE";
              const featured = tooling.featuredPluginIds.includes(plugin.id);
              const detail = pluginDetails[plugin.id];
              const authNotice = pluginAuthNotices[plugin.id];
              return (
                <Box key={plugin.id} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
                        {plugin.displayName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                        {plugin.description || plugin.source}
                      </Typography>
                    </Box>
                    {plugin.installed ? (
                      <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => onUninstallPlugin(plugin)}>
                        Uninstall
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<DownloadIcon />}
                        disabled={unavailable}
                        onClick={() => onInstallPlugin(marketplace, plugin)}
                      >
                        Install
                      </Button>
                    )}
                  </Stack>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                    <Button size="small" onClick={() => onReadPluginDetail(marketplace, plugin)}>
                      Details
                    </Button>
                    <Button size="small" disabled={!plugin.installed || !plugin.enabled} onClick={() => onInsertPluginMention(marketplace, plugin)}>
                      Mention
                    </Button>
                    {plugin.websiteUrl && (
                      <Button size="small" href={plugin.websiteUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />}>
                        Website
                      </Button>
                    )}
                    {detail?.shareUrl && (
                      <Button size="small" href={detail.shareUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />}>
                        Share
                      </Button>
                    )}
                  </Stack>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                    <Chip size="small" label={plugin.installed ? "installed" : "available"} color={plugin.installed ? "success" : "default"} />
                    {plugin.installed && <Chip size="small" label={plugin.enabled ? "enabled" : "disabled"} />}
                    {featured && <Chip size="small" label="featured" color="primary" />}
                    {unavailable && <Chip size="small" label={plugin.availability} color="warning" />}
                    <Chip size="small" label={`auth ${plugin.authPolicy}`} variant="outlined" />
                    <Chip size="small" label={`install ${plugin.installPolicy}`} variant="outlined" />
                    {plugin.category && <Chip size="small" label={plugin.category} />}
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
                      {plugin.capabilities.slice(0, 5).map((capability) => (
                        <Chip key={capability} size="small" variant="outlined" label={capability} />
                      ))}
                    </Stack>
                  )}
                  {authNotice && authNotice.apps.length > 0 && (
                    <Box sx={{ mt: 1, borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
                      <Typography variant="caption" sx={{ fontWeight: 750 }}>
                        Authentication needed after install
                      </Typography>
                      <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                        {authNotice.apps.map((app) => (
                          <AppSummaryRow key={app.id} app={app} />
                        ))}
                      </Stack>
                    </Box>
                  )}
                  {detail && (
                    <Box sx={{ mt: 1, borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
                      {detail.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                          {detail.description}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                        <Chip size="small" label={`skills ${detail.skills.length}`} />
                        <Chip size="small" label={`hooks ${detail.hooks.length}`} />
                        <Chip size="small" label={`apps ${detail.apps.length}`} />
                        <Chip size="small" label={`templates ${detail.appTemplates.length}`} />
                        <Chip size="small" label={`mcp ${detail.mcpServers.length}`} />
                        {detail.scheduledTaskCount != null && <Chip size="small" label={`tasks ${detail.scheduledTaskCount}`} />}
                      </Stack>
                      {detail.apps.length > 0 && (
                        <Stack spacing={0.75} sx={{ mt: 1 }}>
                          {detail.apps.map((app) => (
                            <AppSummaryRow key={app.id} app={app} />
                          ))}
                        </Stack>
                      )}
                      {detail.appTemplates.length > 0 && (
                        <Stack spacing={0.75} sx={{ mt: 1 }}>
                          {detail.appTemplates.map((template) => (
                            <Box key={template.templateId} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 0.75 }}>
                              <Typography variant="caption" sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
                                {template.name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                                {[template.category, template.reason && `unavailable ${template.reason}`].filter(Boolean).join(" / ")}
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
                                    {skill.name} {skill.enabled ? "" : "(disabled)"}
                                  </Typography>
                                  <Button size="small" disabled={!skill.remoteReadable} onClick={() => onReadPluginSkill(marketplace, plugin, skill.name)}>
                                    Preview
                                  </Button>
                                </Stack>
                                {pluginSkillPreviews[previewKey] && (
                                  <Typography component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere", mt: 0.75, maxHeight: 180, overflow: "auto" }}>
                                    {pluginSkillPreviews[previewKey]}
                                  </Typography>
                                )}
                              </Box>
                            );
                          })}
                        </Stack>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

function AppSummaryRow({ app }: { app: PluginAppEntry }) {
  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 0.75 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
            {app.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
            {[app.category, app.developer, app.isEnabled === false ? "disabled" : null, app.isAccessible === false ? "needs access" : null]
              .filter(Boolean)
              .join(" / ")}
          </Typography>
        </Box>
        {app.installUrl && (
          <Button size="small" href={app.installUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />}>
            Connect
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

function FilesTab({
  cwd,
  fileDirectories,
  openFile,
  terminalSessions,
  filesPanelLayout,
  onFilesPanelLayoutChange,
  onReadDirectory,
  onReadFile,
  onChangeOpenFileContent,
  onSaveOpenFile,
  onRunTerminalCommand,
  onWriteTerminalInput,
  onTerminateTerminal,
  onResizeTerminal
}: {
  cwd: string;
  fileDirectories: Record<string, FsDirectoryEntry[]>;
  openFile: Props["openFile"];
  terminalSessions: TerminalSession[];
  filesPanelLayout?: Record<string, number>;
  onFilesPanelLayoutChange?: (layout: Record<string, number>) => void;
  onReadDirectory: Props["onReadDirectory"];
  onReadFile: Props["onReadFile"];
  onChangeOpenFileContent: Props["onChangeOpenFileContent"];
  onSaveOpenFile: Props["onSaveOpenFile"];
  onRunTerminalCommand: Props["onRunTerminalCommand"];
  onWriteTerminalInput: Props["onWriteTerminalInput"];
  onTerminateTerminal: Props["onTerminateTerminal"];
  onResizeTerminal: Props["onResizeTerminal"];
}) {
  const [rootPath, setRootPath] = useState(cwd);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const dirty = openFile ? openFile.content !== openFile.savedContent : false;

  useEffect(() => {
    setRootPath(cwd);
  }, [cwd]);

  useEffect(() => {
    if (rootPath && !fileDirectories[rootPath]) {
      onReadDirectory(rootPath);
    }
  }, [fileDirectories, onReadDirectory, rootPath]);

  return (
    <Box sx={{ height: { xs: "auto", md: "min(72vh, 760px)" }, minHeight: 520, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}>
      <Paper variant="outlined" sx={{ p: 1.25, mb: 1 }}>
        <Stack direction="row" spacing={1}>
          <TextField size="small" label="Root path" value={rootPath} onChange={(event) => setRootPath(event.target.value)} sx={{ flex: 1 }} />
          <Button size="small" startIcon={<RefreshIcon />} onClick={() => onReadDirectory(rootPath)}>
            Load
          </Button>
        </Stack>
      </Paper>
      <Box sx={{ minHeight: 0, height: "100%" }}>
        <PanelGroup
          orientation="vertical"
          id="codex-react-ui-files-vertical"
          defaultLayout={filesPanelLayout}
          onLayoutChanged={(layout, meta) => {
            if (!meta.isUserInteraction) {
              return;
            }
            onFilesPanelLayoutChange?.(layout);
          }}
        >
          <Panel id="files-workspace" defaultSize="62%" minSize="28%">
            <Box sx={{ height: "100%", minHeight: 0, p: 0.25 }}>
              <PanelGroup orientation="horizontal" id="codex-react-ui-files-horizontal">
                <Panel id="files-explorer" defaultSize="32%" minSize="18%" maxSize="50%">
                  <Paper variant="outlined" sx={{ p: 1, height: "100%", minWidth: 0, overflow: "auto" }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
                      Explorer
                    </Typography>
                    <Box sx={{ mt: 1 }}>{renderDirectory(rootPath, 0)}</Box>
                  </Paper>
                </Panel>
                <ResizeHandle />
                <Panel id="files-editor" defaultSize="68%" minSize="30%">
                  <Paper variant="outlined" sx={{ minWidth: 0, height: "100%", overflow: "hidden", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
                          {openFile?.path ?? "No file selected"}
                        </Typography>
                        {openFile && (
                          <Typography variant="caption" color="text.secondary">
                            {dirty ? "Unsaved changes" : "Saved"}
                          </Typography>
                        )}
                      </Box>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<SaveIcon />}
                        disabled={!openFile || openFile.loading || openFile.saving || !dirty}
                        onClick={onSaveOpenFile}
                      >
                        {openFile?.saving ? "Saving" : "Save"}
                      </Button>
                    </Stack>
                    <Box sx={{ minHeight: 0 }}>
                      {openFile ? (
                        <Suspense fallback={<Box sx={{ p: 2 }}><Typography color="text.secondary">Loading editor...</Typography></Box>}>
                          <MonacoEditor
                            height="100%"
                            path={openFile.path}
                            language={languageForPath(openFile.path)}
                            value={openFile.content}
                            loading="Loading editor..."
                            options={{
                              minimap: { enabled: false },
                              scrollBeyondLastLine: false,
                              fontSize: 13,
                              wordWrap: "on",
                              automaticLayout: true
                            }}
                            onChange={(value) => onChangeOpenFileContent(value ?? "")}
                          />
                        </Suspense>
                      ) : (
                        <Box sx={{ p: 2 }}>
                          <Typography color="text.secondary">Select a file to edit.</Typography>
                        </Box>
                      )}
                    </Box>
                  </Paper>
                </Panel>
              </PanelGroup>
            </Box>
          </Panel>
          <ResizeHandle orientation="vertical" />
          <Panel id="files-terminal" defaultSize="38%" minSize="22%">
            <Paper variant="outlined" sx={{ height: "100%", minHeight: 320, overflow: "hidden" }}>
              <TerminalConsole
                cwd={cwd}
                terminalSessions={terminalSessions}
                onRunTerminalCommand={onRunTerminalCommand}
                onWriteTerminalInput={onWriteTerminalInput}
                onTerminateTerminal={onTerminateTerminal}
                onResizeTerminal={onResizeTerminal}
              />
            </Paper>
          </Panel>
        </PanelGroup>
      </Box>
    </Box>
  );

  function renderDirectory(path: string, depth: number): ReactNode {
    const entries = fileDirectories[path];
    if (!entries) {
      return (
        <Button size="small" startIcon={<FolderIcon />} onClick={() => onReadDirectory(path)} sx={{ justifyContent: "flex-start", pl: 1 + depth }}>
          Load {path === rootPath ? "root" : path.split("/").pop()}
        </Button>
      );
    }
    if (entries.length === 0) {
      return (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 1 + depth }}>
          Empty directory
        </Typography>
      );
    }
    return entries.map((entry) => (
      <Box key={entry.path}>
        <Button
          size="small"
          startIcon={entry.isDirectory ? <FolderIcon /> : <DescriptionIcon />}
          onClick={() => {
            if (entry.isDirectory) {
              setExpandedDirs((current) => ({ ...current, [entry.path]: !current[entry.path] }));
              if (!fileDirectories[entry.path]) {
                onReadDirectory(entry.path);
              }
              return;
            }
            if (entry.isFile) {
              onReadFile(entry.path);
            }
          }}
          sx={{ justifyContent: "flex-start", textAlign: "left", width: "100%", pl: 1 + depth * 1.5 }}
        >
          <Typography component="span" variant="caption" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.name}
          </Typography>
        </Button>
        {entry.isDirectory && expandedDirs[entry.path] && <Box>{renderDirectory(entry.path, depth + 1)}</Box>}
      </Box>
    ));
  }
}

function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "html":
      return "html";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "toml":
      return "toml";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
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
