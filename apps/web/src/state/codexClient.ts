import {
  DANGER_CONFIRMATION,
  type AgentProject,
  type AgyCompatibleCliSettings,
  type AuggieCompatibleCliSettings,
  type ClineCompatibleCliSettings,
  type CommandCodeCompatibleCliSettings,
  type CodexCompatibleCliSettings,
  type GrokCompatibleCliSettings,
  type MuseCompatibleCliSettings,
  type PiCompatibleCliSettings,
  type OpencodeCompatibleCliSettings,
  type CliBackend,
  type AgentProjectMessage,
  type AgentProjectVote,
  type AgentRosterRole,
  type AuthSession,
  type AuthUser,
  type CaptchaChallenge,
  type PublicAuthConfig,
  type SystemAuthSettings,
  type ThreadRuntimeMetadata,
  type SaVmPolicyConfig,
  type ThreadAgentMember,
  type ThreadAgentRoster,
  type UsageSummary,
  type EngineStatus,
  type ImageGenerationProtocol,
  type JsonRpcFailure,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonValue,
  type LegalConsentStatus,
  type LegalPolicyBundle,
  type LegalPolicyLanguage,
  type DangerousPermissionAuditEvent,
  type PermissionPresetId,
  type ProviderActivation,
  type ProviderConfig,
  type RelayBackupBundle,
  type RelayCatalogImportPreview,
  type RelayCatalogImportResult,
  type RelayResponseProtocol,
  type RelayAuthType,
  type RelayConfigBundle,
  type ServerToClientMessage,
  type UiProfile,
  type UiProfileImportResult,
  type WebSocketRuntimeConfig
} from "@codex-ui/shared";
import type { ProjectRelayGroup, ProjectRelayProvider, WorkbenchFile, WorkbenchImage, WorkbenchItem, WorkbenchTurn } from "@cxu/sdk-frontend";
export type { ProjectRelayGroup, ProjectRelayProvider, WorkbenchFile, WorkbenchImage, WorkbenchItem, WorkbenchTurn };
import { displayPromptText } from "../promptDisplay";
import { isGoalContinuationPrompt } from "../goalContinuation";
import { isPlanContinuationPrompt } from "../planContinuation";
import { joinWorkspacePath } from "../workspacePaths";
import { dispatchJevPlanCreated, dispatchJevSubagent } from "../../../../frontends/jev/src/jev/jevAutoJudge";
import { extractJevCollabBrief, extractJevCollabReport } from "../../../../frontends/jev/src/jev/jevQuestions";
import { upsertWorkbenchItem, upsertWorkbenchTurn } from "./workbenchTimeline";
export type PendingServerRequest = {
  id: string | number;
  method: string;
  params?: JsonValue;
  threadId?: string;
};

export type ThreadRequestUsageRecord = {
  ownerId: string;
  threadId: string;
  turnId: string;
  requestId: string;
  source: string;
  providerId?: string;
  groupId?: string;
  model?: string;
  usage: Record<string, unknown>;
  costUsd?: number;
  billingSnapshot?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  debitedAt?: number;
};

export async function fetchThreadUsage(token: string, threadId: string): Promise<ThreadRequestUsageRecord[]> {
  const response = await fetch(`/api/thread-usage?threadId=${encodeURIComponent(threadId)}`, {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: unknown; error?: string };
  if (!response.ok || !Array.isArray(body.data)) {
    throw new Error(body.error ?? `Failed to load thread usage (${response.status})`);
  }
  return body.data.filter((entry): entry is ThreadRequestUsageRecord => Boolean(entry && typeof entry === "object"));
}

export type FreebuffSessionStatus = {
  configured: boolean;
  active: boolean;
  model?: string;
  instanceId?: string;
  expiresAt?: number;
  remainingSeconds?: number;
  isOwned?: boolean;
  freebucks?: {
    balance: number;
    daily?: {
      limit: number;
      spent: number;
      remaining: number;
      resetAt?: string;
    };
    monthly?: {
      limitUsd: number;
      spentUsd: number;
      remainingUsd: number;
      resetAt?: string;
    };
    prices?: Record<string, number>;
    priceNotices?: Record<string, string>;
  };
  rateLimitsByModel?: Record<string, { limit: number; recentCount?: number; resetAt?: string }>;
};

export type ClineBalanceInfo = {
  configured: boolean;
  userId?: string;
  email?: string;
  displayName?: string;
  credits?: number;
  rawBalance?: number;
  formattedBalance?: string;
  error?: string;
};

export async function fetchFreebuffSessionStatus(token: string): Promise<FreebuffSessionStatus> {
  const response = await fetch("/api/codex/freebuff/session", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: FreebuffSessionStatus; error?: string };
  if (!response.ok || !body.data) {
    throw new Error(body.error ?? `Failed to fetch Freebuff session (${response.status})`);
  }
  return body.data;
}

export async function releaseFreebuffSessionSlot(token: string): Promise<{ released: boolean; message?: string }> {
  const response = await fetch("/api/codex/freebuff/session/release", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: "{}"
  });
  const body = await response.json().catch(() => ({})) as { data?: { released: boolean; message?: string }; error?: string };
  if (!response.ok || !body.data) {
    throw new Error(body.error ?? `Failed to release Freebuff session (${response.status})`);
  }
  return body.data;
}

export async function fetchClineBalance(token: string, forceRefresh = false): Promise<ClineBalanceInfo> {
  const url = forceRefresh ? "/api/codex/cline/balance?refresh=1" : "/api/codex/cline/balance";
  const response = await fetch(url, {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: ClineBalanceInfo; error?: string };
  if (!response.ok || !body.data) {
    throw new Error(body.error ?? `Failed to fetch Cline balance (${response.status})`);
  }
  return body.data;
}

export function findBestFreebuffFallback(
  currentModel: string,
  status: FreebuffSessionStatus | null
): { id: string; name: string; price: number } | null {
  if (!status) return null;
  const prices: Record<string, number> = {
    "upstage/solar-pro4": 0,
    "upstage/solar-pro-4": 0,
    "z-ai/glm-5.3-flash": 5,
    "mimo/mimo-v2.5": 10,
    "minimax/minimax-m3": 10,
    "openai/gpt-5.6-luna": 20,
    "openai/gpt-5.6-luna-es": 20,
    "deepseek/deepseek-v4-flash": 25,
    ...(status.freebucks?.prices || {})
  };

  const currentPrice = prices[currentModel] ?? 25;
  const balance = status.freebucks?.balance ?? 0;

  const candidates = [
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "mimo/mimo-v2.5", name: "Mimo 2.5" },
    { id: "minimax/minimax-m3", name: "MiniMax M3" },
    { id: "z-ai/glm-5.3-flash", name: "GLM-5.3 Flash" },
    { id: "upstage/solar-pro-4", name: "Solar Pro 4" }
  ];

  for (const c of candidates) {
    if (c.id === currentModel) continue;
    const price = prices[c.id] ?? 999;
    if (price > currentPrice) continue;
    if (price > balance) continue;
    const rl = status.rateLimitsByModel?.[c.id];
    if (rl && rl.limit > 0 && typeof rl.recentCount === "number" && rl.recentCount >= rl.limit) {
      continue;
    }
    return { id: c.id, name: c.name, price };
  }

  const solarPrice = prices["upstage/solar-pro-4"] ?? prices["upstage/solar-pro4"] ?? 0;
  if (solarPrice <= balance && currentModel !== "upstage/solar-pro-4" && currentModel !== "upstage/solar-pro4") {
    return { id: "upstage/solar-pro-4", name: "Solar Pro 4", price: solarPrice };
  }

  return null;
}

export type McpToolEntry = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonValue;
  outputSchema?: JsonValue;
  annotations?: JsonValue;
};

export type McpResourceEntry = {
  name: string;
  title?: string;
  uri?: string;
  description?: string;
};

export type McpServerEntry = {
  name: string;
  authStatus: string;
  serverInfo?: string;
  tools: McpToolEntry[];
  resources: McpResourceEntry[];
  resourceTemplates: McpResourceEntry[];
};

export type SkillEntry = {
  name: string;
  displayName: string;
  description: string;
  shortDescription?: string;
  path: string;
  scope: string;
  enabled: boolean;
};

export type SkillGroup = {
  cwd: string;
  skills: SkillEntry[];
  errors: Array<{ path: string; message: string }>;
};

export type HookEntry = {
  key: string;
  eventName: string;
  handlerType: string;
  matcher?: string;
  command?: string;
  timeoutSec?: number;
  statusMessage?: string;
  sourcePath: string;
  source: string;
  pluginId?: string;
  displayOrder?: number;
  enabled: boolean;
  isManaged: boolean;
  currentHash?: string;
  trustStatus: string;
};

export type HookGroup = {
  cwd: string;
  hooks: HookEntry[];
  warnings: string[];
  errors: Array<{ path: string; message: string }>;
};

export type PluginEntry = {
  id: string;
  remotePluginId?: string;
  name: string;
  displayName: string;
  description?: string;
  version?: string;
  localVersion?: string;
  installed: boolean;
  enabled: boolean;
  source: string;
  availability: string;
  authPolicy: string;
  installPolicy: string;
  installPolicySource?: string;
  category?: string;
  developerName?: string;
  websiteUrl?: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
  defaultPrompt: string[];
  logoUrl?: string;
  screenshotUrls: string[];
  capabilities: string[];
  keywords: string[];
};

export type PluginAppEntry = {
  id: string;
  name: string;
  description?: string;
  installUrl?: string;
  category?: string;
  isAccessible?: boolean;
  isEnabled?: boolean;
  pluginDisplayNames: string[];
  logoUrl?: string;
  developer?: string;
  website?: string;
};

export type PluginAppTemplateEntry = {
  templateId: string;
  name: string;
  description?: string;
  category?: string;
  canonicalConnectorId?: string;
  logoUrl?: string;
  materializedAppIds: string[];
  reason?: string;
};

export type PluginDetailEntry = {
  marketplaceName: string;
  marketplacePath?: string;
  plugin: PluginEntry;
  description?: string;
  shareUrl?: string;
  skills: Array<{ name: string; description?: string; enabled: boolean; path?: string; remoteReadable: boolean }>;
  hooks: Array<{ key: string; eventName: string }>;
  apps: PluginAppEntry[];
  appTemplates: PluginAppTemplateEntry[];
  mcpServers: string[];
  scheduledTaskCount?: number;
};

export type PluginInstallAuthNotice = {
  authPolicy: string;
  apps: PluginAppEntry[];
};

export type McpResourceContentEntry = {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
};

export type FsDirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
};

export type TerminalSession = {
  processId: string;
  command: string;
  cwd: string;
  workspaceMode?: "local" | "ssh";
  sshCommand?: string;
  threadId?: string;
  providerId?: string;
  groupId?: string;
  output: string;
  status: "running" | "completed" | "failed" | "terminated";
  exitCode?: number;
  rows: number;
  cols: number;
};

// Resident PTY terminal owned by our server (orca-style, no exec timeout).
// Rendered with xterm.js; output streams via terminal/data events, not state.
export type PtyTerminalSession = {
  terminalId: string;
  cwd: string;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exitCode?: number;
  createdAt: number;
};

export type ComposerMention = {
  name: string;
  path: string;
  token: string;
  kind?: "file" | "image" | "plugin" | "skill" | "thread" | "app";
};

export type PluginMarketplace = {
  name: string;
  path?: string;
  displayName?: string;
  description?: string;
  plugins: PluginEntry[];
};

export type ToolingState = {
  mcpServers: McpServerEntry[];
  skillGroups: SkillGroup[];
  hookGroups: HookGroup[];
  pluginMarketplaces: PluginMarketplace[];
  installedPluginMarketplaces: PluginMarketplace[];
  apps: PluginAppEntry[];
  featuredPluginIds: string[];
  marketplaceErrors: string[];
};

export type ModelEntry = {
  id?: string;
  model?: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string }>;
};

export type ThreadEntry = {
  id: string;
  cliBackend?: CliBackend;
  sessionId?: string;
  title?: string;
  name?: string;
  preview?: string;
  model?: string;
  modelProvider?: string;
  parentThreadId?: string;
  forkedFromId?: string;
  agentNickname?: string;
  agentRole?: string;
  createdAt?: number;
  updatedAt?: number;
  recencyAt?: number;
  status?: string;
  cwd?: string;
  additionalRoots?: string[];
  source?: string;
  threadSource?: string;
  path?: string;
  historyMode?: "legacy" | "paginated";
  workspaceMode?: "local" | "ssh";
  sshCommand?: string;
  sshCwd?: string;
  remoteExecutionMode?: "autonomous";
  remoteLifecycleMode?: "foreground" | "background";
};

export type AgentReadinessIssue = { code: string; message: string; details?: Record<string, unknown> };
export type AgentReadinessResult = {
  ready: boolean;
  code: string;
  issues: AgentReadinessIssue[];
  warnings: AgentReadinessIssue[];
  checks: Record<string, unknown>;
  config: Record<string, unknown>;
  catalog: Record<string, unknown>;
};

export async function fetchAgentReadiness(token: string, input: { agentMode?: "inherit" | "enabled" | "disabled"; providerId?: string | null; groupId?: string | null; model?: string | null; reasoningEffort?: string | null; childCount?: number | null; roles?: unknown[]; threadRunning?: boolean }): Promise<AgentReadinessResult> {
  const response = await fetch("/api/codex/agents/readiness", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(input),
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: AgentReadinessResult; error?: string };
  if (!body.data) throw new Error(body.error || `Agents readiness failed: ${response.status}`);
  return body.data;
}

export interface ClaudeCompatibleCliSettings {
  enabled: boolean;
}

export async function fetchCodexCompatibleCliSettings(token: string): Promise<CodexCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/codex-cli", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: CodexCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Codex CLI settings failed: " + response.status);
  return body.data.settings;
}

export async function updateCodexCompatibleCliSettings(token: string, enabled: boolean): Promise<CodexCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/codex-cli", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled })
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: CodexCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Codex CLI settings update failed: " + response.status);
  return body.data.settings;
}

export async function fetchAgyCompatibleCliSettings(token: string): Promise<AgyCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/agy-cli", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: AgyCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "AGY CLI settings failed: " + response.status);
  return body.data.settings;
}

export async function updateAgyCompatibleCliSettings(token: string, enabled: boolean): Promise<AgyCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/agy-cli", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled })
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: AgyCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "AGY CLI settings update failed: " + response.status);
  return body.data.settings;
}
export async function fetchAuggieCompatibleCliSettings(token: string): Promise<AuggieCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/auggie-cli", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: AuggieCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Auggie CLI settings failed: " + response.status);
  return body.data.settings;
}

export async function updateAuggieCompatibleCliSettings(token: string, enabled: boolean): Promise<AuggieCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/auggie-cli", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled })
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: AuggieCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Auggie CLI settings update failed: " + response.status);
  return body.data.settings;
}
export async function fetchClineCompatibleCliSettings(token: string): Promise<ClineCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/cline-cli", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: ClineCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Cline CLI settings failed: " + response.status);
  return body.data.settings;
}

export async function updateClineCompatibleCliSettings(token: string, enabled: boolean): Promise<ClineCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/cline-cli", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled })
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: ClineCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Cline CLI settings update failed: " + response.status);
  return body.data.settings;
}
export async function fetchCommandCodeCompatibleCliSettings(token: string): Promise<CommandCodeCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/command-code-cli", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: CommandCodeCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Command Code CLI settings failed: " + response.status);
  return body.data.settings;
}

export async function updateCommandCodeCompatibleCliSettings(token: string, enabled: boolean): Promise<CommandCodeCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/command-code-cli", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled })
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: CommandCodeCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Command Code CLI settings update failed: " + response.status);
  return body.data.settings;
}
export async function fetchGrokCompatibleCliSettings(token: string): Promise<GrokCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/grok-cli", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: GrokCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Grok CLI settings failed: " + response.status);
  return body.data.settings;
}

export async function fetchPiCompatibleCliSettings(token: string): Promise<PiCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/pi-cli", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: PiCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Pi CLI settings failed: " + response.status);
  return body.data.settings;
}

export async function updatePiCompatibleCliSettings(token: string, enabled: boolean): Promise<PiCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/pi-cli", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled })
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: PiCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Pi CLI settings update failed: " + response.status);
  return body.data.settings;
}

export async function fetchOpencodeCompatibleCliSettings(token: string): Promise<OpencodeCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/opencode-cli", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: OpencodeCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "OpenCode CLI settings failed: " + response.status);
  return body.data.settings;
}

export async function updateOpencodeCompatibleCliSettings(token: string, enabled: boolean): Promise<OpencodeCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/opencode-cli", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled })
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: OpencodeCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "OpenCode CLI settings update failed: " + response.status);
  return body.data.settings;
}

export async function fetchOpencodeV2CompatibleCliSettings(token: string): Promise<OpencodeCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/opencode-v2-cli", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: OpencodeCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "OpenCode v2 CLI settings failed: " + response.status);
  return body.data.settings;
}

export async function updateOpencodeV2CompatibleCliSettings(token: string, enabled: boolean): Promise<OpencodeCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/opencode-v2-cli", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled })
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: OpencodeCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "OpenCode v2 CLI settings update failed: " + response.status);
  return body.data.settings;
}

export async function updateGrokCompatibleCliSettings(token: string, enabled: boolean): Promise<GrokCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/grok-cli", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled })
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: GrokCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Grok CLI settings update failed: " + response.status);
  return body.data.settings;
}

export async function fetchMuseCompatibleCliSettings(token: string): Promise<MuseCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/muse-cli", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: MuseCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Muse CLI settings failed: " + response.status);
  return body.data.settings;
}

export async function updateMuseCompatibleCliSettings(token: string, enabled: boolean): Promise<MuseCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/muse-cli", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled })
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: MuseCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Muse CLI settings update failed: " + response.status);
  return body.data.settings;
}

export async function updateClaudeCompatibleCliSettings(token: string, enabled: boolean): Promise<ClaudeCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/claude-compatible-cli", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled })
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: ClaudeCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Claude CLI settings update failed: " + response.status);
  return body.data.settings;
}

export async function fetchClaudeCompatibleCliSettings(token: string): Promise<ClaudeCompatibleCliSettings> {
  const response = await fetch("/api/codex/settings/claude-compatible-cli", {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: { settings: ClaudeCompatibleCliSettings }; error?: string };
  if (!body.data?.settings) throw new Error(body.error || "Claude CLI settings failed: " + response.status);
  return body.data.settings;
}

export async function setRemoteThreadForeground(token: string, threadId: string, foreground: boolean): Promise<{ threadId: string; state: "foreground" | "background" }> {
  const response = await fetch(`/api/ssh/remote-thread-routes/${foreground ? "attach" : "detach"}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-codex-ui-token": token }, body: JSON.stringify({ threadId })
  });
  const payload = await response.json().catch(() => ({})) as { data?: { threadId: string; state: "foreground" | "background" }; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error || `Failed to ${foreground ? "attach" : "detach"} remote conversation`);
  return payload.data;
}

/**
 * Starts a thread that lives on the SSH host's remote node rather than on this
 * machine. Only such a thread can be detached: a locally started thread — even
 * one whose workspace is over SSH — dies with this server's child process, so
 * it can never be promoted afterwards.
 */
export async function startRemoteBackgroundThread(token: string, input: {
  command: string;
  cwd: string;
  model?: string;
  providerId?: string;
  groupId?: string;
  cliBackend?: string;
}): Promise<{ threadId: string }> {
  const response = await fetch("/api/ssh/remote-thread/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ ...input, confirm: true })
  });
  const payload = await response.json().catch(() => ({})) as { data?: { threadId: string }; error?: string };
  if (!response.ok || !payload.data?.threadId) throw new Error(payload.error || "Failed to start the remote background conversation");
  return payload.data;
}

export async function closeRemoteThread(token: string, threadId: string): Promise<{ threadId: string; lifecycleMode: "foreground" | "background"; remoteContinues: boolean; interruptedTurnIds: string[] }> {
  const response = await fetch("/api/ssh/remote-thread-routes/close", {
    method: "POST", headers: { "Content-Type": "application/json", "x-codex-ui-token": token }, body: JSON.stringify({ threadId })
  });
  const payload = await response.json().catch(() => ({})) as { data?: { threadId: string; lifecycleMode: "foreground" | "background"; remoteContinues: boolean; interruptedTurnIds: string[] }; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error || "Failed to close remote conversation");
  return payload.data;
}

export async function closeSshThreadBridge(token: string, threadId: string): Promise<{ threadId: string; released: boolean; bridgeStopped: boolean; remainingReferences: number }> {
  const response = await fetch("/api/ssh/thread-bridges/close", {
    method: "POST", headers: { "Content-Type": "application/json", "x-codex-ui-token": token }, body: JSON.stringify({ threadId })
  });
  const payload = await response.json().catch(() => ({})) as { data?: { threadId: string; released: boolean; bridgeStopped: boolean; remainingReferences: number }; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error || "Failed to close SSH conversation");
  return payload.data;
}

export async function setRemoteThreadLifecycle(token: string, threadId: string, lifecycleMode: "foreground" | "background"): Promise<{ threadId: string; state: "foreground" | "background" }> {
  const response = await fetch("/api/ssh/remote-thread-routes/lifecycle", {
    method: "POST", headers: { "Content-Type": "application/json", "x-codex-ui-token": token }, body: JSON.stringify({ threadId, lifecycleMode })
  });
  const payload = await response.json().catch(() => ({})) as { data?: { threadId: string; state: "foreground" | "background" }; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error || "Failed to update remote lifecycle mode");
  return payload.data;
}


export type ClaudeStartupStatusState = {
  stage: "spawning" | "handshake" | "ready" | "failed";
  at: number;
  error?: string;
};

export type ClientState = {
  token: string | null;
  connected: boolean;
  engine: EngineStatus;
  account: JsonValue | null;
  models: ModelEntry[];
  providers: ProviderConfig[];
  threads: ThreadEntry[];
  activeThreadId: string | null;
  turns: WorkbenchTurn[];
  pendingRequests: PendingServerRequest[];
  tooling: ToolingState;
  toolingLoading: boolean;
  errors: string[];
  /** Per-thread Claude CLI startup stage (`thread/claude/startup`), cleared on turn/started. */
  claudeStartupStages: Record<string, ClaudeStartupStatusState>;
};

/**
 * Composer image/file attachment contract (OOM root-cause fix).
 *
 * - `path`: disk path returned by POST /api/attachments/upload. This is the
 *   ONLY image reference sent to the server / saved into chat history
 *   (as `{type:"localImage", path}`), so SQLite/JSONL never sees base64 and
 *   SQLITE_NOMEM via oversized TEXT rows is structurally impossible.
 * - `url` / `previewUrl`: renderer-only preview (blob: object URL). Never
 *   sent, never persisted — revoke with URL.revokeObjectURL when dropped.
 * - The model still receives base64, but only transiently: server bridges
 *   read the bytes from `path` at send time (readOpencodeLocalImage /
 *   readImageFromDisk / runMiniImageView) and inline them into that turn's
 *   model payload. History keeps the path.
 */
export type ComposerImageAttachment = {
  id: string;
  name: string;
  url: string;
  size: number;
  mediaType: string;
  kind?: "image" | "file";
  path?: string;
  /** Renderer-only preview (blob: URL). Never sent or persisted. */
  previewUrl?: string;
};

export const initialClientState: ClientState = {
  token: null,
  connected: false,
  engine: { phase: "idle" },
  account: null,
  models: [],
  providers: [],
  threads: [],
  activeThreadId: null,
  turns: [],
  pendingRequests: [],
  tooling: {
    mcpServers: [],
    skillGroups: [],
    hookGroups: [],
    pluginMarketplaces: [],
    installedPluginMarketplaces: [],
    apps: [],
    featuredPluginIds: [],
    marketplaceErrors: []
  },
  toolingLoading: false,
  errors: [],
  claudeStartupStages: {}
};

export type SocketConnectionStatus = {
  phase: "connecting" | "connected" | "disconnected" | "reconnecting";
  at: number;
  attempt?: number;
  delayMs?: number;
  reason?: string;
};

const PROVIDER_ACTIVATION_TIMEOUT_MS = 30_000;
const PROVIDER_MUTATION_TIMEOUT_MS = 30_000;
const RESUME_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_WEBSOCKET_RUNTIME: WebSocketRuntimeConfig = {
  profile: "desktop",
  path: "/ws",
  heartbeatIntervalMs: 2_000,
  heartbeatTimeoutMs: 30_000,
  handshakeTimeoutMs: 5_000,
  reconnectBaseDelayMs: 250,
  reconnectMaxDelayMs: 5_000
};

export class CodexSocketClient extends EventTarget {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private resumeProbeTimer: number | null = null;
  private heartbeatSequence = 0;
  private lastServerActivityAt = 0;
  private heartbeatProbeStartedAt: number | null = null;
  private reconnectAttempt = 0;
  private connectPromise: Promise<void> | null = null;
  private openStartedAt: number | null = null;
  private providerActivationQueue: Promise<unknown> = Promise.resolve();
  private closedByClient = false;
  private websocketRuntime = DEFAULT_WEBSOCKET_RUNTIME;
  private recoveryListenersAttached = false;
  private nextClientId = 1;
  private pending = new Map<
    string,
    {
      resolve: (value: JsonValue) => void;
      reject: (error: JsonRpcFailure["error"]) => void;
      timer: number;
    }
  >();

  public async connect(token: string, runtime?: WebSocketRuntimeConfig): Promise<void> {
    this.token = token;
    this.websocketRuntime = normalizeWebSocketRuntime(runtime);
    this.closedByClient = false;
    this.attachRecoveryListeners();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.dispatchConnectionStatus({ phase: "connected" });
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = this.openSocket(token);
    return this.connectPromise;
  }

  public updateToken(token: string): void {
    const changed = this.token !== token;
    this.token = token;
    if (!changed || this.closedByClient) return;
    if (this.socket?.readyState === WebSocket.OPEN || this.connectPromise) return;
    this.clearReconnectTimer();
    this.scheduleReconnect();
  }

  public disconnect(): void {
    this.closedByClient = true;
    this.detachRecoveryListeners();
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.clearResumeProbeTimer();
    this.rejectPending("WebSocket disconnected");
    this.socket?.close();
    this.socket = null;
    this.connectPromise = null;
    this.openStartedAt = null;
    this.dispatchConnectionStatus({ phase: "disconnected", reason: "Client disconnected" });
    this.dispatch("connected", false);
  }

  private openSocket(token: string): Promise<void> {
    const socket = new WebSocket(resolveWebSocketUrl(token, this.websocketRuntime));
    this.socket = socket;
    this.openStartedAt = Date.now();
    this.dispatchConnectionStatus({ phase: "connecting" });
    let opened = false;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const rejectOnce = (message: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };
      const failHandshake = (message: string) => {
        if (opened || this.socket !== socket) return;
        window.clearTimeout(handshakeTimer);
        this.socket = null;
        this.connectPromise = null;
        this.openStartedAt = null;
        rejectOnce(message);
        this.dispatchConnectionStatus({ phase: "disconnected", reason: message });
        this.dispatch("connected", false);
        try {
          socket.close();
        } catch {
          // The browser may already have discarded the failed socket.
        }
        if (!this.closedByClient) this.scheduleReconnect();
      };
      const handshakeTimer = window.setTimeout(
        () => failHandshake("WebSocket connection timed out"),
        this.websocketRuntime.handshakeTimeoutMs
      );

      socket.addEventListener("open", () => {
        if (this.socket !== socket) {
          window.clearTimeout(handshakeTimer);
          rejectOnce("WebSocket connection was superseded");
          socket.close();
          return;
        }
        window.clearTimeout(handshakeTimer);
        opened = true;
        settled = true;
        this.connectPromise = null;
        this.openStartedAt = null;
        this.reconnectAttempt = 0;
        this.clearReconnectTimer();
        this.startHeartbeat(socket);
        this.dispatchConnectionStatus({ phase: "connected" });
        this.dispatch("connected", true);
        resolve();
      });
      socket.addEventListener("error", () => {
        failHandshake("WebSocket connection failed");
      }, { once: true });
      socket.addEventListener("close", (event) => {
        if (this.socket !== socket) return;
        window.clearTimeout(handshakeTimer);
        this.stopHeartbeat(socket);
        this.socket = null;
        this.connectPromise = null;
        this.openStartedAt = null;
        if (!opened) rejectOnce("WebSocket closed before connecting");
        this.dispatchConnectionStatus({
          phase: "disconnected",
          reason: event.reason || `WebSocket closed (${event.code})`
        });
        this.dispatch("connected", false);
        this.rejectPending("WebSocket disconnected");
        if (!this.closedByClient) {
          this.scheduleReconnect();
        }
      });
      socket.addEventListener("message", (event) => {
        if (this.socket !== socket) return;
        this.handleMessage(event.data);
      });
    });
  }

  public rpc(method: string, params?: JsonValue, options: { timeoutMs?: number | null } = {}): Promise<JsonValue> {
    const id = `ui-${this.nextClientId++}`;
    return new Promise((resolve, reject) => {
      const timeoutMs = options.timeoutMs === undefined ? rpcTimeoutMs(method) : options.timeoutMs;
      const timer = timeoutMs == null ? 0 : window.setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject({ code: -32001, message: `Request '${method}' timed out after ${Math.round(timeoutMs / 1000)}s` });
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ type: "rpc", id, method, params });
      } catch (error) {
        window.clearTimeout(timer);
        this.pending.delete(id);
        reject({ code: -32000, message: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  public respondToServerRequest(id: string | number, result?: JsonValue, error?: JsonRpcFailure["error"]): void {
    this.send({ type: "serverResponse", requestId: id, result, error });
  }

  public watchThread(threadId: string): void {
    this.send({ type: "thread.watch", threadId });
  }

  public unwatchThread(threadId: string): void {
    this.send({ type: "thread.unwatch", threadId });
  }

  public saveProvider(provider: ProviderConfig, apiKey?: string, mergeIntoProviderId?: string): Promise<ProviderConfig> {
    const id = `provider-${this.nextClientId++}`;
    this.send({ type: "provider.save", id, provider, apiKey, mergeIntoProviderId });
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.removeEventListener("server-message", onMessage);
        reject(new Error(`Provider save timed out after ${PROVIDER_MUTATION_TIMEOUT_MS / 1000}s`));
      }, PROVIDER_MUTATION_TIMEOUT_MS);
      const onMessage = (event: Event) => {
        const detail = (event as CustomEvent<ServerToClientMessage>).detail;
        if (detail.type === "provider.saved" && detail.id === id) {
          window.clearTimeout(timer);
          this.removeEventListener("server-message", onMessage);
          resolve(detail.provider);
        }
        if (detail.type === "server.error" && detail.id === id) {
          window.clearTimeout(timer);
          this.removeEventListener("server-message", onMessage);
          reject(new Error(formatErrorText(detail.message)));
        }
      };
      this.addEventListener("server-message", onMessage);
    });
  }

  public activateProvider(providerId: string, model?: string, groupId?: string): Promise<ProviderActivation> {
    const task = this.providerActivationQueue
      .catch(() => undefined)
      .then(() => this.activateProviderNow(providerId, model, groupId));
    this.providerActivationQueue = task;
    return task;
  }

  private activateProviderNow(providerId: string, model?: string, groupId?: string): Promise<ProviderActivation> {
    const id = `provider-activate-${this.nextClientId++}`;
    this.send({ type: "provider.activate", id, providerId, model, groupId });
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.removeEventListener("server-message", onMessage);
        reject(new Error(`Provider activation timed out after ${PROVIDER_ACTIVATION_TIMEOUT_MS / 1000}s`));
      }, PROVIDER_ACTIVATION_TIMEOUT_MS);
      const onMessage = (event: Event) => {
        const detail = (event as CustomEvent<ServerToClientMessage>).detail;
        if (detail.type === "provider.activated" && detail.id === id) {
          window.clearTimeout(timer);
          this.removeEventListener("server-message", onMessage);
          resolve(detail.activation);
        }
        if (detail.type === "server.error" && detail.id === id) {
          window.clearTimeout(timer);
          this.removeEventListener("server-message", onMessage);
          reject(new Error(formatErrorText(detail.message)));
        }
      };
      this.addEventListener("server-message", onMessage);
    });
  }

  public deleteProvider(providerId: string): Promise<string> {
    const id = `provider-delete-${this.nextClientId++}`;
    this.send({ type: "provider.delete", id, providerId });
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.removeEventListener("server-message", onMessage);
        reject(new Error(`Provider delete timed out after ${PROVIDER_MUTATION_TIMEOUT_MS / 1000}s`));
      }, PROVIDER_MUTATION_TIMEOUT_MS);
      const onMessage = (event: Event) => {
        const detail = (event as CustomEvent<ServerToClientMessage>).detail;
        if (detail.type === "provider.deleted" && detail.id === id) {
          window.clearTimeout(timer);
          this.removeEventListener("server-message", onMessage);
          resolve(detail.providerId);
        }
        if (detail.type === "server.error" && detail.id === id) {
          window.clearTimeout(timer);
          this.removeEventListener("server-message", onMessage);
          reject(new Error(formatErrorText(detail.message)));
        }
      };
      this.addEventListener("server-message", onMessage);
    });
  }

  public trashProvider(providerId: string): Promise<string> {
    const id = `provider-trash-${this.nextClientId++}`;
    this.send({ type: "provider.trash", id, providerId });
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.removeEventListener("server-message", onMessage);
        reject(new Error(`Provider trash timed out after ${PROVIDER_MUTATION_TIMEOUT_MS / 1000}s`));
      }, PROVIDER_MUTATION_TIMEOUT_MS);
      const onMessage = (event: Event) => {
        const detail = (event as CustomEvent<ServerToClientMessage>).detail;
        if (detail.type === "provider.trashed" && detail.id === id) {
          window.clearTimeout(timer);
          this.removeEventListener("server-message", onMessage);
          resolve(detail.providerId);
        } else if (detail.type === "server.error" && detail.id === id) {
          window.clearTimeout(timer);
          this.removeEventListener("server-message", onMessage);
          reject(new Error(formatErrorText(detail.message)));
        }
      };
      this.addEventListener("server-message", onMessage);
    });
  }

  public restoreProvider(providerId: string): Promise<ProviderConfig> {
    const id = `provider-restore-${this.nextClientId++}`;
    this.send({ type: "provider.restore", id, providerId });
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.removeEventListener("server-message", onMessage);
        reject(new Error(`Provider restore timed out after ${PROVIDER_MUTATION_TIMEOUT_MS / 1000}s`));
      }, PROVIDER_MUTATION_TIMEOUT_MS);
      const onMessage = (event: Event) => {
        const detail = (event as CustomEvent<ServerToClientMessage>).detail;
        if (detail.type === "provider.restored" && detail.id === id) {
          window.clearTimeout(timer);
          this.removeEventListener("server-message", onMessage);
          resolve(detail.provider);
        } else if (detail.type === "server.error" && detail.id === id) {
          window.clearTimeout(timer);
          this.removeEventListener("server-message", onMessage);
          reject(new Error(formatErrorText(detail.message)));
        }
      };
      this.addEventListener("server-message", onMessage);
    });
  }

  private send(value: object): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    this.socket.send(JSON.stringify(value));
  }

  private handleMessage(raw: string): void {
    this.lastServerActivityAt = Date.now();
    this.heartbeatProbeStartedAt = null;
    this.clearResumeProbeTimer();
    const message = JSON.parse(raw) as ServerToClientMessage;
    if (message.type === "heartbeat.ping") {
      this.sendHeartbeatPong(message.id, message.sentAt);
      return;
    }
    if (message.type === "heartbeat.pong") {
      return;
    }
    this.dispatch("server-message", message);
    if (message.type === "rpc.result") {
      const pending = this.pending.get(message.id);
      if (pending) window.clearTimeout(pending.timer);
      pending?.resolve(message.result);
      this.pending.delete(message.id);
    }
    if (message.type === "rpc.error") {
      const pending = this.pending.get(message.id);
      if (pending) window.clearTimeout(pending.timer);
      pending?.reject(message.error);
      this.pending.delete(message.id);
    }
  }

  private dispatch<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  private scheduleReconnect(): void {
    if (!this.token || this.reconnectTimer !== null) {
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.dispatchConnectionStatus({ phase: "disconnected", reason: "Browser is offline" });
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        if (this.closedByClient || !this.token) return;
        this.scheduleReconnect();
      }, this.websocketRuntime.reconnectMaxDelayMs);
      return;
    }
    const delay = computeReconnectDelay(
      this.reconnectAttempt,
      this.websocketRuntime.reconnectBaseDelayMs,
      this.websocketRuntime.reconnectMaxDelayMs
    );
    this.reconnectAttempt += 1;
    this.dispatchConnectionStatus({
      phase: "reconnecting",
      attempt: this.reconnectAttempt,
      delayMs: delay,
      reason: "WebSocket disconnected"
    });
    this.dispatch("reconnecting", { attempt: this.reconnectAttempt, delayMs: delay });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.token || this.closedByClient || this.socket?.readyState === WebSocket.OPEN) {
        return;
      }
      if (this.connectPromise || this.socket?.readyState === WebSocket.CONNECTING || this.socket?.readyState === WebSocket.CLOSING) {
        this.scheduleReconnect();
        return;
      }
      this.connectPromise = this.openSocket(this.token).catch(() => {
        this.connectPromise = null;
        this.scheduleReconnect();
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) {
      return;
    }
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.lastServerActivityAt = Date.now();
    this.heartbeatProbeStartedAt = null;
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat(socket);
        return;
      }
      const now = Date.now();
      const heartbeatState = evaluateHeartbeatState(
        now,
        this.lastServerActivityAt,
        this.heartbeatProbeStartedAt,
        this.websocketRuntime,
        { visible: document.visibilityState === "visible" }
      );
      if (heartbeatState === "close") {
        console.warn("[websocket] heartbeat probe timed out; closing stale socket", {
          inactiveMs: now - this.lastServerActivityAt,
          probeElapsedMs: now - (this.heartbeatProbeStartedAt ?? now)
        });
        this.dispatchConnectionStatus({ phase: "disconnected", reason: "Heartbeat probe timed out" });
        this.dispatch("connected", false);
        this.rejectPending("WebSocket disconnected: heartbeat probe timed out");
        socket.close(4000, "Heartbeat probe timed out");
        return;
      }
      if (heartbeatState === "probe" && this.heartbeatProbeStartedAt === null) {
        this.heartbeatProbeStartedAt = now;
        console.warn("[websocket] server activity is delayed; probing before reconnect", {
          inactiveMs: now - this.lastServerActivityAt
        });
      }
      // The server owns the normal heartbeat cadence. Only send one client
      // probe after the server has been silent; do not duplicate pings on the
      // same channel or let agent activity create additional heartbeat traffic.
      if (heartbeatState !== "probe" || this.heartbeatProbeStartedAt !== now) return;
      try {
        this.sendHeartbeatPing(socket, now);
        this.armResumeProbe(socket, now);
      } catch {
        console.warn("[websocket] heartbeat send failed; closing socket");
        this.dispatchConnectionStatus({ phase: "disconnected", reason: "Heartbeat send failed" });
        this.dispatch("connected", false);
        this.rejectPending("WebSocket disconnected: heartbeat send failed");
        socket.close(4000, "Heartbeat send failed");
      }
    }, this.websocketRuntime.heartbeatIntervalMs);
  }

  private stopHeartbeat(socket?: WebSocket): void {
    if (socket && this.socket !== socket) {
      return;
    }
    this.heartbeatProbeStartedAt = null;
    if (this.heartbeatTimer === null) {
      return;
    }
    window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private sendHeartbeatPong(id: string, sentAt: number): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      socket.send(JSON.stringify({
        type: "heartbeat.pong",
        id,
        sentAt,
        receivedAt: Date.now()
      }));
    } catch {
      console.warn("[websocket] heartbeat pong failed; closing socket");
      this.dispatchConnectionStatus({ phase: "disconnected", reason: "Heartbeat pong failed" });
      this.dispatch("connected", false);
      this.rejectPending("WebSocket disconnected: heartbeat pong failed");
      socket.close(4000, "Heartbeat pong failed");
    }
  }

  private sendHeartbeatPing(socket: WebSocket, sentAt = Date.now()): void {
    socket.send(JSON.stringify({
      type: "heartbeat.ping",
      id: `client-${sentAt}-${this.heartbeatSequence++}`,
      sentAt
    }));
  }

  private dispatchConnectionStatus(status: Omit<SocketConnectionStatus, "at">): void {
    this.dispatch("connection-status", { ...status, at: Date.now() });
  }

  private rejectPending(message: string): void {
    if (this.pending.size === 0) {
      return;
    }
    const error = { code: -32000, message };
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private attachRecoveryListeners(): void {
    if (this.recoveryListenersAttached) return;
    window.addEventListener("online", this.handleBrowserOnline);
    window.addEventListener("offline", this.handleBrowserOffline);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.recoveryListenersAttached = true;
  }

  private detachRecoveryListeners(): void {
    if (!this.recoveryListenersAttached) return;
    window.removeEventListener("online", this.handleBrowserOnline);
    window.removeEventListener("offline", this.handleBrowserOffline);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.recoveryListenersAttached = false;
  }

  private handleBrowserOnline = () => {
    this.reconnectNow("Network connection restored");
  };

  private handleBrowserOffline = () => {
    this.clearReconnectTimer();
    this.dispatchConnectionStatus({ phase: "disconnected", reason: "Browser is offline" });
    const socket = this.socket;
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close(4000, "Browser is offline");
    }
  };

  private handleVisibilityChange = () => {
    if (document.visibilityState !== "visible" || this.closedByClient || !this.token) return;
    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      const now = Date.now();
      // A recently active channel is healthy. Do not add another ping merely
      // because the renderer became visible; the normal heartbeat owns it.
      if (now - this.lastServerActivityAt <= this.websocketRuntime.heartbeatTimeoutMs) return;
      this.heartbeatProbeStartedAt ??= now;
      try {
        this.sendHeartbeatPing(socket, now);
        this.armResumeProbe(socket, now);
      } catch {
        socket.close(4000, "Heartbeat probe failed after resume");
      }
      return;
    }
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      this.reconnectNow("Window resumed");
      return;
    }
    const now = Date.now();
    if (isStaleHandshake(this.openStartedAt, now, this.websocketRuntime.handshakeTimeoutMs)) {
      try {
        socket.close(4000, "Stale handshake after resume");
      } catch {
        // The browser may already have discarded the stalled socket.
      }
      this.socket = null;
      this.connectPromise = null;
      this.openStartedAt = null;
      this.scheduleReconnect();
    }
  };

  private reconnectNow(reason: string): void {
    if (
      !this.token ||
      this.closedByClient ||
      this.connectPromise ||
      this.socket?.readyState === WebSocket.OPEN ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    ) {
      return;
    }
    this.clearReconnectTimer();
    this.dispatchConnectionStatus({
      phase: "reconnecting",
      attempt: this.reconnectAttempt + 1,
      delayMs: 0,
      reason
    });
    this.connectPromise = this.openSocket(this.token).catch(() => {
      this.connectPromise = null;
      this.scheduleReconnect();
    });
  }

  private clearResumeProbeTimer(): void {
    if (this.resumeProbeTimer === null) return;
    window.clearTimeout(this.resumeProbeTimer);
    this.resumeProbeTimer = null;
  }

  private armResumeProbe(socket: WebSocket, sentAt: number): void {
    // Keep the oldest unanswered probe deadline. A frequent heartbeat must not
    // postpone recovery forever when the browser still reports a dead socket OPEN.
    if (this.resumeProbeTimer !== null) return;
    this.resumeProbeTimer = window.setTimeout(() => {
      this.resumeProbeTimer = null;
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN || this.lastServerActivityAt > sentAt) return;
      this.dispatchConnectionStatus({ phase: "disconnected", reason: "Window resume probe timed out" });
      this.dispatch("connected", false);
      this.rejectPending("WebSocket disconnected: window resume probe timed out");
      socket.close(4000, "Window resume probe timed out");
    }, RESUME_PROBE_TIMEOUT_MS);
  }
}

function rpcTimeoutMs(method: string): number {
  if (method === "turn/steer" || method === "turn/interrupt") {
    return 20_000;
  }
  // turn/start must cover a cold Claude handshake: measured 34s from spawn to
  // CLI init with bypassPermissions (vs 1.2s default). Healthy responses still
  // return in ms; the long cap only affects genuinely-degraded transports, and
  // the composer shows the staged startup badge meanwhile.
  if (method === "turn/start") {
    return 120_000;
  }
  if (method === "thread/read" || method === "thread/resume" || method === "thread/turns/list" || method === "thread/items/list") {
    return 310_000;
  }
  if (method === "thread/list") {
    return 120_000;
  }
  if (method === "thread/start") {
    return 30_000;
  }
  // Reloading user config can wait for the app-server to reinitialize MCP and
  // provider state. Keep the browser deadline beyond the server deadline so
  // the response is not discarded while the write is still completing.
 if (method === "config/batchWrite" || method === "config/value/write") {
   return 150_000;
 }
 if (method === "plugin/install" || method === "plugin/uninstall") {
   return 610_000;
 }
 if (/install|reload|compact|review|shellCommand/i.test(method)) {
   return 120_000;
 }
 if (/git|filesystem|directory|file|terminal|command|exec/i.test(method)) {
    return 60_000;
  }
  return 45_000;
}

export function resolveWebSocketUrl(
  token: string,
  runtime: WebSocketRuntimeConfig = DEFAULT_WEBSOCKET_RUNTIME
): string {
  const override = (window as unknown as { __CODEX_UI_WEBSOCKET_URL__?: string }).__CODEX_UI_WEBSOCKET_URL__;
  const source = override || runtime.path || "/ws";
  const url = new URL(source, window.location.href);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(
      `Cannot derive WebSocket URL from ${window.location.protocol}; desktop shells must load the Bun HTTP origin or set window.__CODEX_UI_WEBSOCKET_URL__.`
    );
  }
  url.searchParams.set("token", token);
  return url.toString();
}

function normalizeWebSocketRuntime(
  runtime: WebSocketRuntimeConfig | undefined
): WebSocketRuntimeConfig {
  if (!runtime) return DEFAULT_WEBSOCKET_RUNTIME;
  const heartbeatIntervalMs = positiveRuntimeNumber(
    runtime.heartbeatIntervalMs,
    DEFAULT_WEBSOCKET_RUNTIME.heartbeatIntervalMs
  );
  const reconnectBaseDelayMs = positiveRuntimeNumber(
    runtime.reconnectBaseDelayMs,
    DEFAULT_WEBSOCKET_RUNTIME.reconnectBaseDelayMs
  );
  return {
    profile: runtime.profile,
    platform: runtime.platform,
    path: runtime.path || DEFAULT_WEBSOCKET_RUNTIME.path,
    heartbeatIntervalMs,
    heartbeatTimeoutMs: Math.max(
      heartbeatIntervalMs * 2,
      positiveRuntimeNumber(
        runtime.heartbeatTimeoutMs,
        DEFAULT_WEBSOCKET_RUNTIME.heartbeatTimeoutMs
      )
    ),
    handshakeTimeoutMs: positiveRuntimeNumber(
      runtime.handshakeTimeoutMs,
      DEFAULT_WEBSOCKET_RUNTIME.handshakeTimeoutMs
    ),
    reconnectBaseDelayMs,
    reconnectMaxDelayMs: Math.max(
      reconnectBaseDelayMs,
      positiveRuntimeNumber(
        runtime.reconnectMaxDelayMs,
        DEFAULT_WEBSOCKET_RUNTIME.reconnectMaxDelayMs
      )
    )
  };
}
function positiveRuntimeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function evaluateHeartbeatState(
  now: number,
  lastServerActivityAt: number,
  probeStartedAt: number | null,
  runtime: WebSocketRuntimeConfig,
  options: { visible?: boolean } = {}
): "healthy" | "probe" | "close" {
  if (now - lastServerActivityAt <= runtime.heartbeatTimeoutMs) {
    return "healthy";
  }
  if (probeStartedAt === null) {
    return "probe";
  }
  const baseGraceMs = Math.max(5_000, runtime.heartbeatIntervalMs * 2);
  const busyVisibleGraceMs = options.visible !== false ? Math.max(baseGraceMs, 15_000) : baseGraceMs;
  const probeGraceMs = busyVisibleGraceMs;
  return now - probeStartedAt >= probeGraceMs ? "close" : "probe";
}

export function computeReconnectDelay(attempt: number, baseMs: number, maxMs: number): number {
  const safeBase = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 250;
  const safeMax = Number.isFinite(maxMs) && maxMs > 0 ? Math.max(safeBase, maxMs) : 5_000;
  const safeAttempt = Number.isFinite(attempt) && attempt >= 0 ? Math.min(Math.floor(attempt), 6) : 0;
  return Math.min(safeMax, safeBase * 2 ** safeAttempt);
}

export function isStaleHandshake(
  openStartedAt: number | null,
  now: number,
  handshakeTimeoutMs: number,
  graceMs = 1_000
): boolean {
  if (openStartedAt === null) return false;
  if (!Number.isFinite(openStartedAt) || !Number.isFinite(now)) return false;
  const timeout = Number.isFinite(handshakeTimeoutMs) && handshakeTimeoutMs > 0 ? handshakeTimeoutMs : 5_000;
  const grace = Number.isFinite(graceMs) && graceMs >= 0 ? graceMs : 1_000;
  return now - openStartedAt > timeout + grace;
}

export async function fetchSessionToken(token?: string | null): Promise<AuthSession> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await fetch("/api/session", {
      ...(token ? { headers: { "x-codex-ui-token": token } } : {}),
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Timed out checking UI session");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { loginRequired?: boolean };
    if (response.status === 401 && body.loginRequired) {
      throw new LoginRequiredError();
    }
    throw new Error(`Failed to read UI session: ${response.status}`);
  }
  const body = (await response.json()) as AuthSession;
  return body;
}

export async function startCodexEngine(token: string): Promise<EngineStatus> {
  const response = await fetchWithClientTimeout(
    "/api/engine/start",
    {
      method: "POST",
      headers: { "x-codex-ui-token": token }
    },
    20_000,
    "Timed out starting Codex"
  );
  const body = (await response.json().catch(() => ({}))) as EngineStatus & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Failed to start Codex (${response.status})`);
  }
  return body;
}

export type CodexCliUpdateStatus = {
  installed: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  installCommand: string;
  checkedAt: number;
};

export async function fetchCodexCliUpdateStatus(token: string): Promise<CodexCliUpdateStatus> {
  const response = await fetchWithClientTimeout(
    "/api/codex/cli-update/status",
    { headers: { "x-codex-ui-token": token }, cache: "no-store" },
    15_000,
    "Timed out checking Codex CLI update"
  );
  const body = (await response.json().catch(() => ({}))) as { data?: CodexCliUpdateStatus; error?: string };
  if (!response.ok || !body.data) {
    throw new Error(body.error ?? `Failed to check Codex CLI update (${response.status})`);
  }
  return body.data;
}

export type CliInstallation = {
  path: string;
  version?: string | null;
  source: string;
  embedded?: boolean;
  selectable?: boolean;
};

export type CliKindInstallationsStatus = {
  installations: CliInstallation[];
  preferredPath: string | null;
  effectivePath: string;
  embedded?: boolean;
  selectable?: boolean;
};

export type CliInstallationsStatus = {
  codex: CliKindInstallationsStatus;
  claude: CliKindInstallationsStatus;
  agy?: CliKindInstallationsStatus;
  auggie?: CliKindInstallationsStatus;
  cline?: CliKindInstallationsStatus;
  "command-code"?: CliKindInstallationsStatus;
  grok?: CliKindInstallationsStatus;
  muse?: CliKindInstallationsStatus;
  pi?: CliKindInstallationsStatus;
  opencode?: CliKindInstallationsStatus;
  "opencode-v2"?: CliKindInstallationsStatus;
};

export type CliInstallationKind = "codex" | "claude" | "agy" | "auggie" | "cline" | "command-code" | "grok" | "muse" | "pi" | "opencode" | "opencode-v2";

export async function fetchCliInstallations(token: string, kinds?: CliInstallationKind[]): Promise<CliInstallationsStatus> {
  const query = kinds && kinds.length > 0 ? `?kinds=${encodeURIComponent(kinds.join(","))}` : "";
  const response = await fetchWithClientTimeout(
    `/api/cli/installations${query}`,
    { headers: { "x-codex-ui-token": token }, cache: "no-store" },
    30_000,
    "Timed out detecting CLI installations"
  );
  const body = (await response.json().catch(() => ({}))) as { data?: CliInstallationsStatus; error?: string };
  if (!response.ok || !body.data) {
    throw new Error(body.error ?? `Failed to detect CLI installations (${response.status})`);
  }
  return body.data;
}

export async function selectCliInstallation(token: string, backend: "codex" | "claude" | "agy" | "auggie" | "grok" | "muse" | "pi" | "opencode" | "opencode-v2" | "cline" | "command-code", path: string | null): Promise<void> {
  const response = await fetchWithClientTimeout(
    "/api/cli/select",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
      body: JSON.stringify({ backend, path }),
    },
    10_000,
    "Timed out selecting CLI version"
  );
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Failed to switch CLI version (${response.status})`);
  }
}

export async function fetchMiniVersion(token: string): Promise<string | null> {
  const response = await fetchWithClientTimeout(
    "/api/codex/capabilities",
    { headers: { "x-codex-ui-token": token }, cache: "no-store" },
    15_000,
    "Timed out loading server capabilities"
  );
  const body = (await response.json().catch(() => ({}))) as { data?: { miniVersion?: unknown } };
  if (!response.ok) return null;
  const version = body.data?.miniVersion;
  return typeof version === "string" && version ? version : null;
}

export async function fetchLegalPolicy(token: string, language: LegalPolicyLanguage): Promise<LegalPolicyBundle> {
  const response = await fetchWithClientTimeout(
    `/api/legal/policy?lang=${language}`,
    { headers: { "x-codex-ui-token": token }, cache: "no-store" },
    10_000,
    "Timed out loading legal documents"
  );
  const body = (await response.json().catch(() => ({}))) as { data?: LegalPolicyBundle; error?: string };
  if (!response.ok || !body.data) {
    throw new Error(body.error ?? `Failed to load legal policy (${response.status})`);
  }
  return body.data;
}

export async function acceptLegalPolicy(
  token: string,
  version: string,
  language: LegalPolicyLanguage
): Promise<LegalConsentStatus> {
  const response = await fetchWithClientTimeout(
    "/api/legal/accept",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-codex-ui-token": token
      },
      body: JSON.stringify({ version, language })
    },
    10_000,
    "Timed out saving legal acceptance"
  );
  const body = (await response.json().catch(() => ({}))) as { data?: LegalConsentStatus; error?: string };
  if (!response.ok || !body.data) {
    throw new Error(body.error ?? `Failed to accept legal policy (${response.status})`);
  }
  return body.data;
}

async function fetchWithClientTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export type LoginResponse =
  | AuthSession
  | {
      requires_2fa: true;
      pendingToken: string;
      expiresAt: number;
    };

export async function fetchPublicAuthConfig(): Promise<PublicAuthConfig> {
  const response = await fetch("/api/auth/config");
  if (!response.ok) {
    return { registrationEnabled: false, captchaEnabled: false, totpEnabled: false };
  }
  return (await response.json()) as PublicAuthConfig;
}

export async function fetchCaptcha(): Promise<CaptchaChallenge> {
  const response = await fetch("/api/auth/captcha", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Captcha failed: ${response.status}`);
  }
  return (await response.json()) as CaptchaChallenge;
}

export async function login(
  email: string,
  password: string,
  captcha?: { captchaId?: string; captchaAnswer?: string }
): Promise<LoginResponse> {
  let response: Response;
  try {
    response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        captchaId: captcha?.captchaId,
        captchaAnswer: captcha?.captchaAnswer
      })
    });
  } catch (error) {
    throw new Error(`登录网络连接失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    if (typeof body.error === "string" && body.error) {
      throw new Error(body.error);
    }
    if (response.status === 401) {
      throw new Error("邮箱、密码或验证码错误");
    }
    if (response.status === 504 || response.status === 502 || response.status === 503) {
      throw new Error(`登录服务网关超时/不可用 (${response.status})，请检查网络或后端代理设置`);
    }
    throw new Error(`登录失败 (${response.status})`);
  }
  return body as LoginResponse;
}

export async function loginWith2fa(pendingToken: string, totpCode: string): Promise<AuthSession> {
  const response = await fetch("/api/login/2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingToken, totpCode })
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "2FA failed");
  }
  return body as unknown as AuthSession;
}

export async function registerAccount(input: {
  email: string;
  password: string;
  username?: string;
  captchaId?: string;
  captchaAnswer?: string;
}): Promise<AuthUser> {
  const response = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as { data?: AuthUser; error?: string };
  if (!response.ok) {
    throw new Error(body.error || `Register failed: ${response.status}`);
  }
  if (!body.data) {
    throw new Error("Register failed");
  }
  return body.data;
}

export async function fetchAdminSettings(token: string): Promise<SystemAuthSettings> {
  const response = await fetch("/api/admin/settings", {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) throw new Error(`Failed to load settings: ${response.status}`);
  const body = (await response.json()) as { data: SystemAuthSettings };
  return body.data;
}

export type UserPreferences = Record<string, JsonValue>;

export async function fetchUserPreferences(token: string): Promise<UserPreferences> {
  const response = await fetch("/api/preferences", {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) throw new Error(`Failed to load preferences: ${response.status}`);
  const body = (await response.json()) as { data?: UserPreferences };
  return body.data ?? {};
}

export async function updateUserPreferences(token: string, patch: UserPreferences): Promise<UserPreferences> {
  const response = await fetch("/api/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(patch)
  });
  const body = (await response.json().catch(() => ({}))) as { data?: UserPreferences; error?: string };
  if (!response.ok) throw new Error(body.error || `Failed to save preferences: ${response.status}`);
  return body.data ?? {};
}

async function projectRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", "x-codex-ui-token": token, ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as { data?: T; error?: string; code?: string };
  if (!response.ok) throw new ProjectApiError(body.code ?? "CUX-PROJECT-API-001", body.error || `Project request failed: ${response.status}`, response.status);
  return body.data as T;
}

export class ProjectApiError extends Error {
  public readonly code: string;
  public readonly status: number;

  public constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "ProjectApiError";
    this.code = code;
    this.status = status;
  }
}

export type ProjectDispatchResult = {
  agentId: string;
  threadId: string;
  turnId?: string | null;
  phase?: "analysis" | "challenge" | "synthesis";
  providerId?: string | null;
  groupId?: string | null;
  model?: string | null;
  ok: boolean;
  error?: string;
};
export type ProjectMessageResult = { message: AgentProjectMessage; dispatch: ProjectDispatchResult[] };

export function listAgentProjects(token: string): Promise<AgentProject[]> { return projectRequest<AgentProject[]>(token, "/api/projects"); }
export function listProjectRelayDirectory(token: string): Promise<ProjectRelayProvider[]> { return projectRequest<ProjectRelayProvider[]>(token, "/api/codex/relays"); }
export function createAgentProject(token: string, input: Omit<AgentProject, "id" | "status" | "createdAt" | "updatedAt">): Promise<AgentProject> { return projectRequest<AgentProject>(token, "/api/projects", { method: "POST", body: JSON.stringify(input) }); }
export function updateAgentProject(token: string, id: string, patch: Partial<AgentProject>): Promise<AgentProject> { return projectRequest<AgentProject>(token, `/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }); }
export function startAgentProject(token: string, id: string): Promise<AgentProject> { return projectRequest<AgentProject>(token, `/api/projects/${encodeURIComponent(id)}/start`, { method: "POST", body: "{}" }); }
export function pauseAgentProject(token: string, id: string): Promise<AgentProject> { return projectRequest<AgentProject>(token, `/api/projects/${encodeURIComponent(id)}/pause`, { method: "POST", body: "{}" }); }
export function listAgentProjectMessages(token: string, id: string, options: { after?: number; limit?: number } = {}): Promise<AgentProjectMessage[]> {
  const query = new URLSearchParams();
  if (options.after !== undefined) query.set("after", String(options.after));
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return projectRequest<AgentProjectMessage[]>(token, `/api/projects/${encodeURIComponent(id)}/messages${suffix}`);
}
export function appendAgentProjectMessage(token: string, id: string, input: Pick<AgentProjectMessage, "text" | "agentId" | "threadId" | "turnId" | "itemId" | "kind">): Promise<ProjectMessageResult> { return projectRequest<ProjectMessageResult>(token, `/api/projects/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify(input) }); }
export function castAgentProjectVote(token: string, id: string, input: Pick<AgentProjectVote, "proposalId" | "voterType" | "voterId" | "choice" | "comment">): Promise<{ vote: AgentProjectVote; summary: { approved: number; rejected: number; abstained: number; humanVeto: boolean; decision: string } }> { return projectRequest(token, `/api/projects/${encodeURIComponent(id)}/votes`, { method: "POST", body: JSON.stringify(input) }); }

export type ThreadAgentMemberPatch = Partial<Pick<
  ThreadAgentMember,
  | "name"
  | "responsibility"
  | "providerId"
  | "groupId"
  | "model"
  | "reasoningEffort"
  | "runtime"
  | "workspace"
  | "threadId"
  | "status"
  | "health"
  | "activeFallbackId"
>>;

function threadAgentRosterPath(threadId: string): string {
  return `/api/thread-agent-rosters/${encodeURIComponent(threadId)}`;
}

export function fetchThreadAgentRoster(token: string, threadId: string): Promise<ThreadAgentRoster> {
  return projectRequest<ThreadAgentRoster>(token, threadAgentRosterPath(threadId));
}

export function saveThreadAgentRoster(
  token: string,
  threadId: string,
  roles: AgentRosterRole[],
  options: { startImmediate?: boolean } = {}
): Promise<ThreadAgentRoster> {
  return projectRequest<ThreadAgentRoster>(token, threadAgentRosterPath(threadId), {
    method: "PUT",
    body: JSON.stringify({ roles, startImmediate: options.startImmediate ?? true })
  });
}

export function updateThreadAgentMember(
  token: string,
  threadId: string,
  memberId: string,
  patch: ThreadAgentMemberPatch
): Promise<ThreadAgentRoster> {
  return projectRequest<ThreadAgentRoster>(token, `${threadAgentRosterPath(threadId)}/members/${encodeURIComponent(memberId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export type ThreadAgentMemberAction = "start" | "pause" | "resume" | "exit" | "force-exit" | "retry" | "replace";

export function runThreadAgentMemberAction(
  token: string,
  threadId: string,
  memberId: string,
  action: ThreadAgentMemberAction
): Promise<ThreadAgentRoster> {
  return projectRequest<ThreadAgentRoster>(
    token,
    `${threadAgentRosterPath(threadId)}/members/${encodeURIComponent(memberId)}/${action}`,
    { method: "POST", body: "{}" }
  );
}

export async function fetchThreadRuntimeMetadata(token: string, threadId: string): Promise<ThreadRuntimeMetadata | null> {
  const response = await fetch(`/api/thread-runtime?threadId=${encodeURIComponent(threadId)}`, {
    headers: { "x-codex-ui-token": token }
  });
  const body = (await response.json().catch(() => ({}))) as { data?: ThreadRuntimeMetadata | null; error?: string };
  if (!response.ok) throw new Error(body.error || `Failed to load conversation runtime metadata: ${response.status}`);
  return body.data ?? null;
}

export async function updateThreadRuntimeMetadata(
  token: string,
  input: Pick<ThreadRuntimeMetadata, "threadId" | "providerId" | "groupId" | "model" | "reasoningEffort" | "agents" | "cwd" | "additionalRoots" | "workspaceFilePath" | "freeAutoCompactEnabled" | "freeAutoCompactThreshold" | "freeAutoCompactModel" | "freeAutoCompactProviderId" | "freeAutoCompactGroupId" | "compactMode" | "jevCompressThreshold" | "cliBackend" | "vmEnabled" | "vmPolicy"> & {
    permission: PermissionPresetId;
    fastModeEnabled?: boolean;
    planModeEnabled?: boolean;
  }
): Promise<ThreadRuntimeMetadata> {
  const response = await fetch("/api/thread-runtime", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as { data?: ThreadRuntimeMetadata; error?: string };
  if (!response.ok) throw new Error(body.error || `Failed to save conversation runtime metadata: ${response.status}`);
  if (!body.data) throw new Error("Failed to save conversation runtime metadata");
  return body.data;
}

export async function updateThreadWorkspaceMetadata(
  token: string,
  input: Pick<ThreadRuntimeMetadata, "threadId" | "cwd" | "additionalRoots" | "workspaceFilePath">
): Promise<ThreadRuntimeMetadata> {
  const response = await fetch("/api/thread-runtime", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as { data?: ThreadRuntimeMetadata; error?: string };
  if (!response.ok) throw new Error(body.error || `Failed to save conversation workspace metadata: ${response.status}`);
  if (!body.data) throw new Error("Failed to save conversation workspace metadata");
  return body.data;
}

export async function updateAdminSettings(token: string, input: Partial<SystemAuthSettings>): Promise<SystemAuthSettings> {
  const response = await fetch("/api/admin/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as { data?: SystemAuthSettings; error?: string };
  if (!response.ok) throw new Error(body.error || `Update settings failed: ${response.status}`);
  if (!body.data) throw new Error("Update settings failed");
  return body.data;
}

export async function fetchTotpStatus(token: string): Promise<{ systemEnabled: boolean; enabled: boolean; forceAdminTotp: boolean }> {
  const response = await fetch("/api/totp/status", {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) throw new Error(`TOTP status failed: ${response.status}`);
  return (await response.json()) as { systemEnabled: boolean; enabled: boolean; forceAdminTotp: boolean };
}

export async function setupTotp(token: string): Promise<{ secret: string; otpauthUrl: string; qrUrl: string }> {
  const response = await fetch("/api/totp/setup", {
    method: "POST",
    headers: { "x-codex-ui-token": token }
  });
  const body = (await response.json().catch(() => ({}))) as { secret?: string; otpauthUrl?: string; qrUrl?: string; error?: string };
  if (!response.ok) throw new Error(body.error || `TOTP setup failed: ${response.status}`);
  return body as { secret: string; otpauthUrl: string; qrUrl: string };
}

export async function enableTotp(token: string, totpCode: string): Promise<AuthUser> {
  const response = await fetch("/api/totp/enable", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ totpCode })
  });
  const body = (await response.json().catch(() => ({}))) as { data?: AuthUser; error?: string };
  if (!response.ok) throw new Error(body.error || `Enable TOTP failed: ${response.status}`);
  if (!body.data) throw new Error("Enable TOTP failed");
  return body.data;
}

export async function disableTotp(token: string, input: { totpCode?: string; password?: string }): Promise<AuthUser> {
  const response = await fetch("/api/totp/disable", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as { data?: AuthUser; error?: string };
  if (!response.ok) throw new Error(body.error || `Disable TOTP failed: ${response.status}`);
  if (!body.data) throw new Error("Disable TOTP failed");
  return body.data;
}

export class LoginRequiredError extends Error {
  public constructor() {
    super("Login required");
    this.name = "LoginRequiredError";
  }
}

export async function listMembers(token: string): Promise<AuthUser[]> {
  const response = await fetch("/api/members", {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to list members: ${response.status}`);
  }
  const body = (await response.json()) as { data?: AuthUser[] };
  return body.data ?? [];
}

export async function createMember(
  token: string,
  input: {
    email: string;
    password: string;
    username?: string;
    role?: "admin" | "user";
    status?: "active" | "disabled";
    maxPermission?: PermissionPresetId;
    allowWrite?: boolean;
    allowNetwork?: boolean;
    allowDangerBypass?: boolean;
    concurrency?: number;
    balance?: number;
    notes?: string;
    allowedProviderIds?: string[];
  }
): Promise<AuthUser> {
  const response = await fetch("/api/members", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to create member: ${response.status}`);
  }
  const body = (await response.json()) as { data: AuthUser };
  return body.data;
}

export async function updateMember(
  token: string,
  id: string,
  input: Record<string, unknown>
): Promise<AuthUser> {
  const response = await fetch(`/api/members/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to update member: ${response.status}`);
  }
  const body = (await response.json()) as { data: AuthUser };
  return body.data;
}

export async function deleteMember(token: string, id: string): Promise<void> {
  const response = await fetch(`/api/members/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to delete member: ${response.status}`);
  }
}


export async function allocateMemberBalance(
  token: string,
  id: string,
  input: { amount: number; operation?: "set" | "add" | "subtract"; notes?: string }
): Promise<AuthUser> {
  const response = await fetch(`/api/members/${encodeURIComponent(id)}/balance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : `Balance update failed (${response.status})`);
  }
  const body = (await response.json()) as { data: AuthUser };
  return body.data;
}

export async function fetchProviders(token: string): Promise<ProviderConfig[]> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await fetch("/api/providers", {
      headers: { "x-codex-ui-token": token },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Timed out loading relay channels");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; loginRequired?: boolean };
    if (response.status === 401 && body.loginRequired) {
      throw new LoginRequiredError();
    }
    throw new Error(typeof body.error === "string" && body.error ? body.error : `Failed to load relay channels: ${response.status}`);
  }
  const body = (await response.json()) as { data?: ProviderConfig[] };
  if (!Array.isArray(body.data)) {
    throw new Error("Failed to load relay channels: malformed response");
  }
  return body.data;
}

export type FetchProviderModelsResponse = {
  models: Array<{ id: string }>;
  error?: string | null;
  endpoint?: string;
};

/** Fetch upstream model IDs for a relay (OpenAI-compatible /v1/models). Mirrors axonhub fetchModels. */
export async function fetchProviderModels(
  token: string,
  input: { baseUrl: string; apiKey?: string; kind?: string; providerId?: string; groupId?: string; protocol?: RelayResponseProtocol; authType?: RelayAuthType; signal?: AbortSignal }
): Promise<FetchProviderModelsResponse> {
  const { signal, ...requestInput } = input;
  const response = await fetch("/api/provider/fetch-models", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as FetchProviderModelsResponse & { error?: string };
  if (!response.ok) {
    return {
      models: Array.isArray(body.models) ? body.models : [],
      error: typeof body.error === "string" && body.error ? body.error : `Failed to fetch models (${response.status})`,
      endpoint: body.endpoint
    };
  }
  return {
    models: Array.isArray(body.models) ? body.models : [],
    error: body.error ?? null,
    endpoint: body.endpoint
  };
}
export type TestProviderResponse = {
  ok: boolean;
  model?: string;
  prompt?: string;
  message: string;
  endpoint?: string;
  statusCode?: number;
  elapsedMs?: number;
};

export async function testProvider(
  token: string,
  input: { baseUrl: string; apiKey?: string; kind?: string; providerId?: string; groupId?: string; protocol?: RelayResponseProtocol; model?: string }
): Promise<TestProviderResponse> {
  const response = await fetch("/api/provider/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as Partial<TestProviderResponse> & { error?: string };
  if (!response.ok) {
    return {
      ok: false,
      message: body.message || body.error || `Provider test failed (${response.status})`,
      model: body.model,
      prompt: body.prompt,
      endpoint: body.endpoint,
      statusCode: body.statusCode,
      elapsedMs: body.elapsedMs
    };
  }
  return {
    ok: Boolean(body.ok),
    message: body.message || "Provider test passed",
    model: body.model,
    prompt: body.prompt,
    endpoint: body.endpoint,
    statusCode: body.statusCode,
    elapsedMs: body.elapsedMs
  };
}

/** @deprecated Use testProvider. */
export const testProviderChat = testProvider;

export async function previewCapabilityCatalog(
  token: string,
  providerId: string | null,
  catalog: JsonValue
): Promise<RelayCatalogImportPreview> {
  const response = await fetch("/api/provider/catalog/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify({ provider_id: providerId || undefined, catalog })
  });
  const body = (await response.json().catch(() => ({}))) as RelayCatalogImportPreview & { error?: string };
  if (!response.ok) throw new Error(body.error || `Capability catalog preview failed (${response.status})`);
  return body;
}

export async function previewCapabilityCatalogUrl(
  token: string,
  providerId: string | null,
  catalogUrl: string
): Promise<RelayCatalogImportPreview> {
  const response = await fetch("/api/provider/catalog/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify({ provider_id: providerId || undefined, catalog_url: catalogUrl })
  });
  const body = (await response.json().catch(() => ({}))) as RelayCatalogImportPreview & { error?: string };
  if (!response.ok) throw new Error(body.error || `Capability catalog URL failed (${response.status})`);
  return body;
}

export async function importCapabilityCatalog(
  token: string,
  providerId: string,
  catalog: JsonValue,
  mode: "merge" | "replace"
): Promise<RelayCatalogImportResult> {
  const response = await fetch("/api/provider/catalog/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify({ provider_id: providerId, catalog, mode })
  });
  const body = (await response.json().catch(() => ({}))) as RelayCatalogImportResult & { error?: string };
  if (!response.ok) throw new Error(body.error || `Capability catalog import failed (${response.status})`);
  return body;
}

export type ImageApiResult = {
  data: Array<{
    url?: string;
    b64Json?: string;
    savedPath?: string;
    mediaType?: string;
    revisedPrompt?: string;
  }>;
  created?: number;
  providerId?: string;
  providerName?: string;
  model?: string;
  prompt?: string;
  estimatedCostUsd?: number;
  imageUnitPriceUsd?: number;
  endpoint?: string;
  raw?: JsonValue;
};

export type CodeWorkspaceSelection = {
  path: string;
  cwd: string;
  additionalRoots: string[];
};

export async function fetchCodeWorkspaceFile(token: string, path: string): Promise<CodeWorkspaceSelection> {
  const response = await fetch("/api/workspace/code-workspace/read", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ path })
  });
  const body = (await response.json().catch(() => ({}))) as { data?: CodeWorkspaceSelection; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error || `Failed to open workspace file (${response.status})`);
  return body.data;
}

export async function writeCodeWorkspaceFile(token: string, input: Omit<CodeWorkspaceSelection, "additionalRoots"> & { additionalRoots: string[] }): Promise<void> {
  const response = await fetch("/api/workspace/code-workspace/write", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Failed to update workspace file (${response.status})`);
  }
}

export async function fetchWorkspaceDirectory(token: string, path: string, threadId?: string, cwd?: string): Promise<JsonValue> {
  const response = await fetch("/api/workspace/list-directory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify({ path, ...(threadId ? { threadId } : {}), ...(cwd ? { cwd } : {}) })
  });
  const body = (await response.json().catch(() => ({}))) as JsonValue & { error?: string };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Failed to list workspace directory (${response.status})`);
  }
  return body;
}

export async function fetchWorkspaceFile(token: string, path: string, threadId?: string, cwd?: string): Promise<{ dataBase64: string }> {
  const response = await fetch("/api/workspace/read-file", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify({ path, ...(threadId ? { threadId } : {}), ...(cwd ? { cwd } : {}) })
  });
  const body = (await response.json().catch(() => ({}))) as { dataBase64?: string; error?: string };
  if (!response.ok || typeof body.dataBase64 !== "string") {
    throw new Error(typeof body.error === "string" ? body.error : `Failed to read workspace file (${response.status})`);
  }
  return { dataBase64: body.dataBase64 };
}

export async function writeWorkspaceFile(token: string, path: string, dataBase64: string, threadId?: string, cwd?: string): Promise<void> {
  const response = await fetch("/api/workspace/write-file", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify({ path, dataBase64, ...(threadId ? { threadId } : {}), ...(cwd ? { cwd } : {}) })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(typeof body.error === "string" ? body.error : `Failed to write workspace file (${response.status})`);
  }
}

export async function fetchWorkspaceGit(token: string, method: string, params: Record<string, unknown>): Promise<JsonValue> {
  const response = await fetch("/api/workspace/git", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify({ method, params })
  });
  const body = (await response.json().catch(() => ({}))) as { data?: JsonValue; error?: string };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Git operation failed (${response.status})`);
  }
  return (body.data !== undefined ? body.data : body) as JsonValue;
}

export type RelaySettingsListEntry = ProviderConfig & {
  relayList: {
    groupCount: number;
    enabled: boolean;
    firstGroupId: string | null;
    firstGroupName: string | null;
    firstGroupRatio: number;
    apiKeyConfigured: boolean;
    /** 配额使用率（used/quota；不限额时为 null）。 */
    quotaUsageRate?: number | null;
  };
};

export async function fetchRelaySettingsList(token: string): Promise<RelaySettingsListEntry[]> {
  return fetchRelaySettingsListFromPath(token, "/api/codex/relay-settings");
}

export interface ForwardSettings {
  enabled: boolean;
  baseUrl: string;
  /** 回环自用 key, 可明文展示。 */
  token?: string;
  forwardRelay?: { providerId: string; modelCount: number } | null;
}

export async function fetchForwardSettings(token: string): Promise<ForwardSettings> {
  const response = await fetch("/api/codex/forward-settings", { headers: { "x-codex-ui-token": token }, cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as { data?: { enabled?: boolean; baseUrl?: string; token?: string }; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error || `Failed to load forward settings: ${response.status}`);
  return {
    enabled: body.data.enabled === true,
    baseUrl: typeof body.data.baseUrl === "string" ? body.data.baseUrl : "",
    token: typeof body.data.token === "string" ? body.data.token : undefined,
  };
}

export async function updateForwardSettings(token: string, enabled: boolean): Promise<ForwardSettings> {
  const response = await fetch("/api/codex/forward-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify({ enabled }),
  });
  const body = (await response.json().catch(() => ({}))) as { data?: { enabled?: boolean; baseUrl?: string; token?: string; forwardRelay?: { providerId: string; modelCount: number } | null }; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error || `Failed to update forward settings: ${response.status}`);
  return {
    enabled: body.data.enabled === true,
    baseUrl: typeof body.data.baseUrl === "string" ? body.data.baseUrl : "",
    token: typeof body.data.token === "string" ? body.data.token : undefined,
    forwardRelay: body.data.forwardRelay ?? null,
  };
}

export async function fetchTrashedRelaySettingsList(token: string): Promise<RelaySettingsListEntry[]> {
  return fetchRelaySettingsListFromPath(token, "/api/codex/relay-settings/trashed");
}

async function fetchRelaySettingsListFromPath(token: string, path: string): Promise<RelaySettingsListEntry[]> {
  const response = await fetch(path, { headers: { "x-codex-ui-token": token }, cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as { data?: Array<Record<string, unknown>>; error?: string };
  if (!response.ok || !Array.isArray(body.data)) throw new Error(body.error || `Failed to load relay list: ${response.status}`);
  return body.data.map((item) => {
    const firstGroupId = typeof item.firstGroupId === "string" ? item.firstGroupId : null;
    const firstGroupName = typeof item.firstGroupName === "string" ? item.firstGroupName : null;
    const firstGroupRatio = typeof item.firstGroupRatio === "number" ? item.firstGroupRatio : 1;
    return {
      id: String(item.providerId ?? ""),
      name: String(item.providerName ?? item.providerId ?? ""),
      kind: item.kind as ProviderConfig["kind"],
      baseUrl: typeof item.baseUrl === "string" ? item.baseUrl : undefined,
      apiKeyPreview: item.apiKeyConfigured === true ? "configured" : undefined,
      defaultModel: typeof item.defaultModel === "string" ? item.defaultModel : undefined,
      nativeModels: [],
      modelAliases: [],
      groups: firstGroupId ? [{
        id: firstGroupId,
        name: firstGroupName ?? firstGroupId,
        kind: "text",
        status: item.enabled === false ? "disabled" : "enabled",
        groupRatio: firstGroupRatio,
        keys: [],
        models: [],
        responseProtocol: item.firstGroupProtocol as RelayResponseProtocol | undefined
      }] : [],
      quotaUsd: typeof item.quotaUsd === "number" ? item.quotaUsd : undefined,
      usedQuotaUsd: typeof item.usedQuotaUsd === "number" ? item.usedQuotaUsd : undefined,
      stationType: item.stationType as ProviderConfig["stationType"],
      remark: typeof item.remark === "string" ? item.remark : undefined,
      serviceProvider: item.serviceProvider as ProviderConfig["serviceProvider"],
      sharedImport: item.sharedImport as ProviderConfig["sharedImport"],
      createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
      updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : 0,
      relayList: {
        groupCount: typeof item.groupCount === "number" ? item.groupCount : 0,
        enabled: item.enabled !== false,
        firstGroupId,
        firstGroupName,
        firstGroupRatio,
        apiKeyConfigured: item.apiKeyConfigured === true,
        quotaUsageRate: typeof item.quotaUsageRate === "number" ? item.quotaUsageRate : null
      }
    };
  });
}

export async function fetchRelaySettings(token: string, providerId: string, signal?: AbortSignal): Promise<ProviderConfig> {
  const response = await fetch(`/api/provider/details?providerId=${encodeURIComponent(providerId)}`, { headers: { "x-codex-ui-token": token }, cache: "no-store", signal });
  const body = (await response.json().catch(() => ({}))) as { data?: ProviderConfig; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error || `Failed to load relay settings: ${response.status}`);
  return body.data;
}

export class ClaudeDesktopConfigNotFoundError extends Error {
  readonly code = "claudeDesktopConfigLibraryNotFound";
}

export async function injectRelayToClaudeDesktop(
  token: string,
  input: {
    providerId: string;
    groupId?: string;
    models?: string[];
    model?: string;
    modelMappings?: Record<string, string>;
    configLibraryDir?: string;
  }
): Promise<{ providerId: string; groupId: string; models: string[]; baseUrl: string; configPath: string; desktopConfigPath: string }> {
  const response = await fetch("/api/claude-desktop/inject-relay", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(input)
  });
  const body = await response.json().catch(() => ({})) as {
    data?: { providerId: string; groupId: string; models: string[]; baseUrl: string; configPath: string; desktopConfigPath: string };
    error?: string;
    code?: string;
  };
  if (!response.ok || !body.data) {
    if (body.code === "claudeDesktopConfigLibraryNotFound") {
      throw new ClaudeDesktopConfigNotFoundError(body.error ?? "Claude Desktop config library directory was not found");
    }
    throw new Error(body.error ?? `Claude Desktop injection failed (${response.status})`);
  }
  return body.data;
}

export class CursorInstallDirNotFoundError extends Error {
  readonly code = "cursorInstallDirNotFound";
  readonly searchedPath?: string;

  constructor(message: string, searchedPath?: string) {
    super(message);
    this.searchedPath = searchedPath;
  }
}

export async function injectRelayToCursorDesktop(
  token: string,
  input: {
    providerId: string;
    groupId?: string;
    installDir?: string;
  }
): Promise<{ providerId: string; groupId: string; models: string[]; baseUrl: string; launcherPath: string; exePath: string }> {
  const response = await fetch("/api/cursor/inject-relay", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(input)
  });
  const body = await response.json().catch(() => ({})) as {
    data?: { providerId: string; groupId: string; models: string[]; baseUrl: string; launcherPath: string; exePath: string };
    error?: string;
    code?: string;
    searchedPath?: string;
  };
  if (!response.ok || !body.data) {
    if (body.code === "cursorInstallDirNotFound") {
      throw new CursorInstallDirNotFoundError(body.error ?? "Cursor.exe was not found", body.searchedPath);
    }
    throw new Error(body.error ?? `Cursor injection failed (${response.status})`);
  }
  return body.data;
}

export type FreeOllamaImportResponse = {
  sourceUrl: string;
  minimumTps: number;
  totalServers: number;
  eligibleServers: number;
  filteredServers: number;
  importedGroups: number;
  importedModels: number;
  settings: ProviderConfig;
};

export async function importFreeOllamaRelay(token: string, sourceUrl?: string): Promise<FreeOllamaImportResponse> {
  const response = await fetch("/api/codex/relay-settings/free-ollama/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(sourceUrl ? { sourceUrl } : {})
  });
  const body = await response.json().catch(() => ({})) as { data?: FreeOllamaImportResponse; error?: string };
  if (!response.ok || !body.data) {
    throw new Error(body.error ?? `Free Ollama sync failed (${response.status})`);
  }
  return body.data;
}

export type OmniRouteFreeImportResponse = {
  providerId: string;
  upstream: string;
  fetchedModels: number;
  importedGroups: number;
  importedModels: number;
  settings: ProviderConfig;
};

export type FreeModelCampaign = {
  id: string;
  title: string;
  message: string;
  imageUrl?: string;
  targetUrl?: string;
  startsAt?: number;
  endsAt?: number;
};

export type FreeModelAccessStatus = {
  configured: boolean;
  developmentMachine: boolean;
  machineCode: string;
  license: {
    valid: boolean;
    reason: "active" | "missing" | "invalid" | "machine_mismatch" | "expired" | "revoked";
    keyPreview?: string;
    issuedAt?: number;
    expiresAt?: number;
  };
  refreshIntervalHours: number;
  lastRefreshedAt: number | null;
  nextRequiredRefreshAt: number | null;
  refreshRequired: boolean;
  discordInviteUrl: string;
  campaign: FreeModelCampaign | null;
  storage: "keyring" | "memory" | "environment" | "none";
  requirement?: { requiredCode: string; expiresAt: number };
  serviceError?: string;
};

async function freeModelAccessRequest(token: string, path: string, init?: RequestInit): Promise<FreeModelAccessStatus> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token,
      ...(init?.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({})) as { data?: FreeModelAccessStatus; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error ?? `Free model access request failed (${response.status})`);
  return body.data;
}

export function fetchFreeModelAccessStatus(token: string): Promise<FreeModelAccessStatus> {
  return freeModelAccessRequest(token, "/api/codex/free-model-access/status");
}

export function requestFreeModelRequiredCode(token: string): Promise<FreeModelAccessStatus> {
  return freeModelAccessRequest(token, "/api/codex/free-model-access/requirement", { method: "POST", body: "{}" });
}

export function saveFreeModelLicense(token: string, key: string): Promise<FreeModelAccessStatus> {
  return freeModelAccessRequest(token, "/api/codex/free-model-access/license", {
    method: "POST",
    body: JSON.stringify({ key })
  });
}

export function clearFreeModelLicense(token: string): Promise<FreeModelAccessStatus> {
  return freeModelAccessRequest(token, "/api/codex/free-model-access/license", { method: "DELETE" });
}

export async function importOmniRouteFreeRelay(token: string): Promise<OmniRouteFreeImportResponse> {
  const response = await fetch("/api/codex/relay-settings/omniroute-free/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token }
  });
  const body = await response.json().catch(() => ({})) as { data?: OmniRouteFreeImportResponse; error?: string };
  if (!response.ok || !body.data) {
    throw new Error(body.error ?? `CodexUltraFree sync failed (${response.status})`);
  }
  return body.data;
}

export type LocalWorkspaceInfo = {
  platform: string;
  home: string;
  cwd: string;
  roots: Array<{ path: string; label: string }>;
};

export type ImageHistoryEntry = {
  threadId: string;
  turnId: string;
  requestId: string;
  status: string;
  items: JsonValue[];
  createdAt: number;
  updatedAt: number;
};

export async function loadImageHistory(token: string, threadId: string): Promise<ImageHistoryEntry[]> {
  const response = await fetch(`/api/image-history?threadId=${encodeURIComponent(threadId)}`, {
    headers: { "x-codex-ui-token": token },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({})) as { data?: ImageHistoryEntry[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? `Failed to load image history (${response.status})`);
  return Array.isArray(body.data) ? body.data : [];
}

export async function saveImageHistory(
  token: string,
  input: Pick<ImageHistoryEntry, "threadId" | "turnId" | "requestId" | "status" | "items"> & { signal?: AbortSignal }
): Promise<ImageHistoryEntry> {
  const { signal, ...requestInput } = input;
  const response = await fetch("/api/image-history", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(requestInput),
    signal
  });
  const body = await response.json().catch(() => ({})) as { data?: ImageHistoryEntry; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error ?? `Failed to save image history (${response.status})`);
  return body.data;
}

export async function fetchWorkspaceRoots(token: string): Promise<LocalWorkspaceInfo> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch("/api/workspace/roots", {
      headers: { "x-codex-ui-token": token },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new WorkspaceRootsError("network", "CUX-NET-001", 0, "Workspace roots request timed out", true);
    }
    throw new WorkspaceRootsError("network", "CUX-NET-002", 0, "Unable to reach the UI server", true);
  } finally {
    window.clearTimeout(timeout);
  }
  const body = (await response.json().catch(() => ({}))) as LocalWorkspaceInfo & { error?: string; code?: string; loginRequired?: boolean };
  if (!response.ok) {
    if (response.status === 401 && body.loginRequired) {
      throw new LoginRequiredError();
    }
    const code = typeof body.code === "string"
      ? body.code
      : response.status === 401 && !body.loginRequired ? "CUX-PROXY-001"
        : response.status === 502 || response.status === 503 ? "CUX-PROXY-002"
          : response.status >= 500 ? "CUX-SERVER-001"
            : response.status === 403 ? "CUX-AUTH-002" : "CUX-WORKSPACE-002";
    const kind: WorkspaceRootsErrorKind = response.status === 401 && !body.loginRequired
      || response.status === 502 || response.status === 503
      ? "proxy"
      : response.status >= 500 ? "server"
        : response.status === 401 || response.status === 403 ? "auth" : "workspace";
    throw new WorkspaceRootsError(kind, code, response.status, body.error || `Failed to list workspace roots (${response.status})`, response.status >= 500);
  }
  return body;
}

export type WorkspaceRootsErrorKind = "network" | "proxy" | "server" | "auth" | "workspace";

export class WorkspaceRootsError extends Error {
  public readonly kind: WorkspaceRootsErrorKind;
  public readonly code: string;
  public readonly status: number;
  public readonly retryable: boolean;

  public constructor(kind: WorkspaceRootsErrorKind, code: string, status: number, message: string, retryable: boolean) {
    super(message);
    this.name = "WorkspaceRootsError";
    this.kind = kind;
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export async function syncSaVmWorkspaceSkill(token: string, input: { cwd: string; enabled: boolean; threadId?: string | null; salaRoot?: string; policy?: SaVmPolicyConfig; jevActiveTools?: boolean }): Promise<{ path: string | null; enabled: boolean; salaRoot?: string }> {
  const response = await fetch("/api/workspace/sa-vm-skill", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-codex-ui-token": token },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as { data?: { path: string | null; enabled: boolean; salaRoot?: string }; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error || `Failed to sync SA-VM workspace skill (${response.status})`);
  return body.data;
}

export async function fetchWorkspaceSaVmStatus(token: string, cwd: string): Promise<{ hasSkill: boolean; skillPath: string | null }> {
  const params = new URLSearchParams({ cwd });
  const response = await fetch(`/api/workspace/sa-vm-status?${params.toString()}`, {
    headers: { "x-codex-ui-token": token }
  });
  const body = (await response.json().catch(() => ({}))) as { data?: { hasSkill: boolean; skillPath: string | null }; error?: string };
  if (!response.ok || !body.data) return { hasSkill: false, skillPath: null };
  return body.data;
}

export async function createWorkspaceDirectory(token: string, input: { path: string; recursive?: boolean; threadId?: string; cwd?: string }): Promise<JsonValue> {
  const response = await fetch("/api/workspace/create-directory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as JsonValue & { error?: string };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Failed to create workspace directory (${response.status})`);
  }
  return body;
}

export type WorkspacePathMutationInput = {
  path?: string;
  source?: string;
  destination?: string;
  newPath?: string;
  threadId?: string;
  cwd?: string;
  command?: string;
};

async function postWorkspacePathMutation(token: string, endpoint: string, input: WorkspacePathMutationInput): Promise<JsonValue> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as JsonValue & { error?: string };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Workspace mutation failed (${response.status})`);
  }
  return body;
}

export async function createWorkspaceFile(token: string, input: WorkspacePathMutationInput): Promise<JsonValue> {
  return postWorkspacePathMutation(token, "/api/workspace/create-file", input);
}

export async function deleteWorkspacePath(token: string, input: WorkspacePathMutationInput): Promise<JsonValue> {
  return postWorkspacePathMutation(token, "/api/workspace/delete-path", input);
}

export async function renameWorkspacePath(token: string, input: WorkspacePathMutationInput): Promise<JsonValue> {
  return postWorkspacePathMutation(token, "/api/workspace/rename-path", input);
}

export async function copyWorkspacePath(token: string, input: WorkspacePathMutationInput): Promise<JsonValue> {
  return postWorkspacePathMutation(token, "/api/workspace/copy-path", input);
}

export async function createSshWorkspaceFile(token: string, command: string, path: string): Promise<JsonValue> {
  return postWorkspacePathMutation(token, "/api/ssh/create-file", { command, path });
}

export async function createSshWorkspaceDirectory(token: string, command: string, path: string): Promise<JsonValue> {
  return postWorkspacePathMutation(token, "/api/ssh/create-directory", { command, path });
}

export async function deleteSshWorkspacePath(token: string, command: string, path: string): Promise<JsonValue> {
  return postWorkspacePathMutation(token, "/api/ssh/delete-path", { command, path });
}

export async function renameSshWorkspacePath(token: string, command: string, source: string, destination: string): Promise<JsonValue> {
  return postWorkspacePathMutation(token, "/api/ssh/rename-path", { command, source, destination });
}

export async function copySshWorkspacePath(token: string, command: string, source: string, destination: string): Promise<JsonValue> {
  return postWorkspacePathMutation(token, "/api/ssh/copy-path", { command, source, destination });
}

export async function generateProviderImage(
  token: string,
  input: { providerId: string; groupId: string; prompt: string; model?: string; protocol?: ImageGenerationProtocol; size?: string; n?: number; requestId?: string },
  signal?: AbortSignal
): Promise<ImageApiResult> {
  const response = await fetch("/api/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(input),
    signal
  });
  const body = (await response.json().catch(() => ({}))) as ImageApiResult & { error?: string };
  if (!response.ok) {
    throw imageApiError(body.error ?? `Image generation failed (${response.status})`, response.status);
  }
  return body;
}

export async function editProviderImage(
  token: string,
  input: { providerId: string; groupId: string; prompt: string; model?: string; images: File[]; size?: string; n?: number; requestId?: string },
  signal?: AbortSignal
): Promise<ImageApiResult> {
  const form = new FormData();
  form.set("providerId", input.providerId);
  form.set("groupId", input.groupId);
  form.set("prompt", input.prompt);
  if (input.model) form.set("model", input.model);
  if (input.size) form.set("size", input.size);
  if (input.n != null) form.set("n", String(input.n));
  if (input.requestId) form.set("requestId", input.requestId);
  for (const image of input.images) {
    form.append("image", image, image.name || "image.png");
  }
  const response = await fetch("/api/images/edits", {
    method: "POST",
    headers: {
      "x-codex-ui-token": token
    },
    body: form,
    signal
  });
  const body = (await response.json().catch(() => ({}))) as ImageApiResult & { error?: string };
  if (!response.ok) {
    throw imageApiError(body.error ?? `Image edit failed (${response.status})`, response.status);
  }
  return body;
}

export async function exportProfile(token: string): Promise<UiProfile> {
  const response = await fetch("/api/profile/export", {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to export profile: ${response.status}`);
  }
  return (await response.json()) as UiProfile;
}

export async function importProfile(token: string, profile: UiProfile): Promise<UiProfileImportResult> {
  const response = await fetch("/api/profile/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(profile)
  });
  if (!response.ok) {
    throw new Error(`Failed to import profile: ${response.status}`);
  }
  return (await response.json()) as UiProfileImportResult;
}

export async function exportRelayConfig(token: string): Promise<RelayConfigBundle> {
  const response = await fetch("/api/relay-config/export", {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to export relay config: ${response.status}`);
  }
  return (await response.json()) as RelayConfigBundle;
}

export async function importRelayConfig(token: string, bundle: RelayConfigBundle): Promise<UiProfileImportResult> {
  const response = await fetch("/api/relay-config/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(bundle)
  });
  if (!response.ok) {
    throw new Error(`Failed to import relay config: ${response.status}`);
  }
  return (await response.json()) as UiProfileImportResult;
}
export async function exportRelayBackup(token: string): Promise<RelayBackupBundle> {
  const response = await fetch("/api/relay-backup/export", {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to export relay backup: ${response.status}`);
  }
  return (await response.json()) as RelayBackupBundle;
}

export async function importRelayBackup(token: string, bundle: RelayBackupBundle): Promise<UiProfileImportResult> {
  const response = await fetch("/api/relay-backup/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(bundle)
  });
  if (!response.ok) {
    throw new Error(`Failed to import relay backup: ${response.status}`);
  }
  return (await response.json()) as UiProfileImportResult;
}

export async function fetchAuditEvents(token: string): Promise<DangerousPermissionAuditEvent[]> {
  const response = await fetch("/api/audit/events", {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to read audit events: ${response.status}`);
  }
  const body = (await response.json()) as { data?: DangerousPermissionAuditEvent[] };
  return body.data ?? [];
}

/**
 * Turn ids whose `startedAt` arrived in the server wire payload (authoritative,
 * same clock as server `completedAt`). The staleness guard in the terminal
 * branch compares `completedAt` against `startedAt`; that comparison is only
 * valid when both timestamps share a clock. A browser-fabricated `startedAt`
 * (turn/started without one) must never discard a server terminal event,
 * otherwise cross-machine clock skew pins the turn in running state forever.
 */
const serverStartedTurnIds = new Set<string>();

/** Test hook: clear server-timestamp provenance between isolated cases. */
export function resetTurnTimestampProvenanceForTests(): void {
  serverStartedTurnIds.clear();
}

export function applyNotification(state: ClientState, notification: JsonRpcNotification): ClientState {
  const method = notification.method;
  const params = asRecord(notification.params);
  if (method === "thread/started") {
    const thread = asRecord(params.thread);
    const id = stringValue(thread.id);
    if (!id) {
      return state;
    }
    const entry: ThreadEntry = {
      id,
      ...(stringValue(thread.cliBackend ?? thread.cli_backend) === "claude" || stringValue(thread.cliBackend ?? thread.cli_backend) === "auggie"
        ? { cliBackend: stringValue(thread.cliBackend ?? thread.cli_backend) as "claude" | "auggie" }
        : stringValue(thread.cliBackend ?? thread.cli_backend) === "agy"
          ? { cliBackend: "agy" as const }
          : stringValue(thread.cliBackend ?? thread.cli_backend) === "grok"
            ? { cliBackend: "grok" as const }
            : stringValue(thread.cliBackend ?? thread.cli_backend) === "muse"
              ? { cliBackend: "muse" as const }
              : stringValue(thread.cliBackend ?? thread.cli_backend) === "pi"
              ? { cliBackend: "pi" as const }
              : stringValue(thread.cliBackend ?? thread.cli_backend) === "opencode"
                ? { cliBackend: "opencode" as const }
                : stringValue(thread.cliBackend ?? thread.cli_backend) === "opencode-v2"
                  ? { cliBackend: "opencode-v2" as const }
                  : stringValue(thread.cliBackend ?? thread.cli_backend) === "mini"
                    ? { cliBackend: "mini" as const }
                    : stringValue(thread.cliBackend ?? thread.cli_backend) === "codex" ? { cliBackend: "codex" as const } : {}),
      sessionId: stringValue(thread.sessionId) ?? stringValue(thread.session_id),
      title: stringValue(thread.name) ?? stringValue(thread.title) ?? stringValue(thread.threadName) ?? stringValue(thread.thread_name),
      name: stringValue(thread.name) ?? stringValue(thread.threadName) ?? stringValue(thread.thread_name),
      preview: displayPromptText(stringValue(thread.preview) ?? ""),
      model: stringValue(thread.model),
      modelProvider: stringValue(thread.modelProvider) ?? stringValue(thread.model_provider),
      parentThreadId: stringValue(thread.parentThreadId) ?? stringValue(thread.parent_thread_id),
      forkedFromId: stringValue(thread.forkedFromId) ?? stringValue(thread.forked_from_id),
      agentNickname: stringValue(thread.agentNickname) ?? stringValue(thread.agent_nickname),
      agentRole: stringValue(thread.agentRole) ?? stringValue(thread.agent_role),
      createdAt: numberValue(thread.createdAt) ?? numberValue(thread.created_at),
      updatedAt: numberValue(thread.updatedAt) ?? numberValue(thread.updated_at),
      recencyAt: numberValue(thread.recencyAt) ?? numberValue(thread.recency_at),
      status: threadStatusValue(thread.status),
      cwd: stringValue(thread.cwd),
      source: sourceLabel(thread.source ?? thread.thread_source),
      threadSource: sourceLabel(thread.threadSource ?? thread.thread_source),
      path: stringValue(thread.path) ?? stringValue(thread.file_path)
    };
    return {
      ...state,
      activeThreadId: id,
      threads: upsertById(state.threads, entry)
    };
  }
  if (method === "thread/name/updated") {
    const threadId = stringValue(params.threadId) ?? stringValue(params.thread_id);
    const name = stringValue(params.name);
    if (!threadId || !name) {
      return state;
    }
    return {
      ...state,
      threads: state.threads.map((thread) => (thread.id === threadId ? { ...thread, title: name, name, preview: name } : thread))
    };
  }
  if (method === "thread/archived" || method === "thread/deleted") {
    const threadId = stringValue(params.threadId) ?? stringValue(params.thread_id);
    if (!threadId) {
      return state;
    }
    const claudeStartupStages = { ...state.claudeStartupStages };
    delete claudeStartupStages[threadId];
    return {
      ...state,
      activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
      threads: state.threads.filter((thread) => thread.id !== threadId),
      turns: method === "thread/deleted" ? state.turns.filter((turn) => turn.threadId !== threadId) : state.turns,
      claudeStartupStages
    };
  }
  if (method === "thread/unarchived") {
    return state;
  }
  if (method === "mini/item/rollback") {
    const threadId = stringValue(params.threadId) ?? stringValue(params.thread_id);
    const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
    const itemIds = new Set(asArray(params.itemIds ?? params.item_ids).map(stringValue).filter((id): id is string => Boolean(id)));
    if (!turnId || itemIds.size === 0) return state;
    return {
      ...state,
      turns: state.turns.map((turn) => turn.id === turnId && (!threadId || turn.threadId === threadId)
        ? { ...turn, items: turn.items.filter((item) => !itemIds.has(item.id)) }
        : turn)
    };
  }
  if (method === "thread/claude/startup") {
    const threadId = stringValue(params.threadId) ?? stringValue(params.thread_id);
    const stage = stringValue(params.stage);
    if (!threadId || (stage !== "spawning" && stage !== "handshake" && stage !== "ready" && stage !== "failed")) {
      return state;
    }
    const at = numberValue(params.at) ?? Date.now();
    const error = stringValue(params.error) ?? undefined;
    return {
      ...state,
      claudeStartupStages: {
        ...state.claudeStartupStages,
        [threadId]: { stage, at, ...(error ? { error } : {}) }
      }
    };
  }
  if (method === "turn/started") {
    const turn = asRecord(params.turn);
    const id = stringValue(turn.id);
    const threadId = stringValue(params.threadId) ?? stringValue(params.thread_id) ?? stringValue(turn.threadId) ?? state.activeThreadId;
    if (!id || !threadId) {
      return state;
    }
    const existing = state.turns.find((entry) => entry.id === id);
    if (isInterruptedWorkbenchStatus(existing?.status)) {
      return state;
    }
    const claudeStartupStages = { ...state.claudeStartupStages };
    // First real turn means the CLI handshake completed; drop the startup badge.
    delete claudeStartupStages[threadId];
    // Record timestamp provenance for the terminal-event staleness guard:
    // only a server-provided startedAt shares a clock with completedAt.
    if (numberValue(turn.startedAt) != null) serverStartedTurnIds.add(id);
    else serverStartedTurnIds.delete(id);
    return {
      ...state,
      activeThreadId: threadId,
      claudeStartupStages,
      turns: upsertWorkbenchTurn(state.turns, {
        id,
        threadId,
        status: "inProgress",
        startedAt: numberValue(turn.startedAt) ?? Math.floor(Date.now() / 1000),
        items: []
      })
    };
  }
  if (method === "item/started" || method === "item/completed") {
    const item = asRecord(params.item);
    const itemId = stringValue(item.id);
    const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
    if (!itemId || !turnId) {
      return state;
    }
    const normalizedType = normalizeWorkbenchItemType(stringValue(item.type) ?? inferItemType(item), item);
    const notificationThreadId = stringValue(params.threadId) ?? stringValue(params.thread_id);
    const activeCompaction = normalizedType === "contextCompaction" && method === "item/completed"
      ? [...state.turns].reverse().flatMap((turn) =>
          !notificationThreadId || turn.threadId === notificationThreadId
            ? [...turn.items].reverse().map((item) => ({ turnId: turn.id, item }))
            : []
        ).find((entry) => entry.item.type === "contextCompaction" && !isTerminalWorkbenchStatus(entry.item.status))
      : undefined;
    const effectiveTurnId = activeCompaction?.turnId ?? turnId;
    const turnItems = state.turns.find((turn) => turn.id === effectiveTurnId)?.items ?? [];
    const compactionItem = activeCompaction?.item ?? (normalizedType === "contextCompaction"
      ? [...turnItems].reverse().find((existing) => existing.type === "contextCompaction" && !isTerminalWorkbenchStatus(existing.status))
      : undefined);
    const effectiveItemId = method === "item/completed" && compactionItem ? compactionItem.id : itemId;
    const existingItem = turnItems.find((existing) => existing.id === effectiveItemId);
    const existingPayload = asRecord(existingItem?.payload);
    const completedText = sanitizeRelayErrorText(itemText(item));
    // Some Codex/relay combinations stream reasoning through delta
    // notifications, then complete the item with an empty summary. Preserve
    // the accumulated text so the completed Thinking control remains visible.
    const normalizedText = normalizedType === "reasoning" && !completedText.trim()
      ? existingItem?.text ?? ""
      : completedText;
    if ((normalizedType === "userMessage" || normalizedType === "goalContinuation") && isInternalContinuationPrompt(normalizedText)) {
      return state;
    }
    const nextItem: WorkbenchItem = {
      id: effectiveItemId,
      type: normalizedType,
      title: itemTitle(item),
      text: normalizedText,
      images: itemImages(item),
      files: itemFiles(item),
      status: stringValue(item.status) ?? (method === "item/completed" ? "completed" : normalizedType === "contextCompaction" ? "inProgress" : undefined),
      startedAt: existingItem?.startedAt
        ?? numberValue(item.startedAt)
        ?? numberValue(item.started_at)
        ?? (method === "item/started" ? Date.now() / 1000 : undefined),
      // Preserve the item's own protocol timestamp when the completion is the
      // first notification we receive. Never borrow a timestamp from another
      // assistant/reasoning item in the same turn.
      firstTokenAt: existingItem?.firstTokenAt
        ?? numberValue(item.firstTokenAt)
        ?? numberValue(item.first_token_at),
      updatedAt: numberValue(item.updatedAt)
        ?? numberValue(item.updated_at)
        ?? (method === "item/completed" ? Date.now() / 1000 : existingItem?.updatedAt),
      ...agentItemMetadata(item, params, method === "item/completed"),
      payload: { ...existingPayload, ...item } as JsonValue
    };
    const itemThreadId = notificationThreadId
      ?? state.turns.find((turn) => turn.id === effectiveTurnId)?.threadId
      // 绝不回退到 state.activeThreadId：后台对话的通知若缺 threadId，
      // 会被盖上当前对话的 id，导致跨对话误督促（Composer 过滤也救不了）。
      // 实在无归属时用 turnId 占位，Composer 按 threadId 过滤会 fail-closed 丢弃。
      ?? turnId;
    // JEV subagent audit: spawn_agent completions carry the task brief in
    // arguments, wait_agent completions carry final reports in output.
    // The listener gates by switch and dedupes per agent, so this stays cheap.
    if (method === "item/completed" && (normalizedType === "toolCall" || normalizedType === "toolUse" || normalizedType === "tool_use")) {
      try {
        const toolName = stringValue(item.name);
        const sessionToken = typeof state.token === "string" ? state.token : undefined;
        if (toolName === "spawn_agent") {
          const args = asRecord(JSON.parse(String(item.arguments ?? item.args ?? "{}")));
          const brief = stringValue(args.message) ?? stringValue(args.text) ?? stringValue(args.prompt) ?? "";
          const taskName = stringValue(args.task_name) ?? stringValue(args.taskName) ?? "";
          const out = asRecord(JSON.parse(String(item.output ?? "{}")));
          const agentId = stringValue(out.agent_id) ?? "";
          if (agentId && brief.trim()) {
            dispatchJevSubagent({
              kind: "brief",
              threadId: itemThreadId,
              turnId: effectiveTurnId,
              agentId,
              taskName,
              brief: brief.slice(0, 4000),
              sessionToken,
            });
          }
        } else if (toolName === "wait_agent") {
          const out = asRecord(JSON.parse(String(item.output ?? "{}")));
          const agents = Array.isArray(out.agents) ? out.agents : [];
          for (const entry of agents) {
            const agent = asRecord(entry);
            const status = stringValue(agent.status) ?? "";
            const report = stringValue(agent.report) ?? "";
            const agentId = stringValue(agent.agent_id) ?? "";
            if (!agentId || !report.trim()) continue;
            if (status !== "completed" && status !== "failed" && status !== "interrupted") continue;
            dispatchJevSubagent({
              kind: "report",
              threadId: itemThreadId,
              turnId: effectiveTurnId,
              agentId,
              status,
              report: report.slice(0, 6000),
              sessionToken,
            });
          }
        }
      } catch {
        // Subagent audit dispatch must never break item rendering.
      }
    }
    // JEV collab audit (opencode `task` / claude `Agent`): both backends
    // project subtask calls as collabAgentToolCall items with the brief in
    // prompt. Briefs fire on started (still steerable) with completed as
    // fallback; reports fire on completed. The listener dedupes per agent.
    // JEV plan audit for backends without turn/plan/updated (opencode
    // todowrite, claude task list): plan-type item/completed carries the
    // whole list. turn/plan/updated flows dedupe downstream — no double.
    try {
      const rawItem = item as Record<string, unknown>;
      const jevToken = typeof state.token === "string" ? state.token : undefined;
      if (stringValue(rawItem.type) === "collabAgentToolCall") {
        // On completion prefer the report (the brief already had its chance
        // at started); fall back to a late brief only when there is no
        // substantive report — never toast twice for one item.
        if (method === "item/completed") {
          const report = extractJevCollabReport(rawItem);
          if (report) {
            dispatchJevSubagent({
              kind: "report",
              threadId: itemThreadId,
              turnId: effectiveTurnId,
              agentId: report.agentId,
              taskName: report.taskName,
              status: report.status,
              report: report.report,
              sessionToken: jevToken,
            });
          } else {
            const brief = extractJevCollabBrief(rawItem);
            if (brief) {
              dispatchJevSubagent({
                kind: "brief",
                threadId: itemThreadId,
                turnId: effectiveTurnId,
                agentId: brief.agentId,
                taskName: brief.taskName,
                brief: brief.brief,
                sessionToken: jevToken,
              });
            }
          }
        } else {
          const brief = extractJevCollabBrief(rawItem);
          if (brief) {
            dispatchJevSubagent({
              kind: "brief",
              threadId: itemThreadId,
              turnId: effectiveTurnId,
              agentId: brief.agentId,
              taskName: brief.taskName,
              brief: brief.brief,
              sessionToken: jevToken,
            });
          }
        }
      } else if (method === "item/completed" && normalizedType === "plan" && completedText.trim()) {
        const ownerTurn = state.turns.find((turn) => turn.id === effectiveTurnId);
        const userPrompt = ownerTurn?.items
          .filter((entry) => entry.type === "userMessage" && typeof entry.text === "string" && entry.text.trim())
          .map((entry) => String(entry.text))
          .join("\n---\n")
          .slice(0, 2000) ?? "";
        dispatchJevPlanCreated({
          threadId: itemThreadId,
          turnId: effectiveTurnId,
          planText: completedText.slice(0, 6000),
          userPrompt,
          sessionToken: jevToken,
        });
      }
    } catch {
      // JEV audit dispatch must never break item rendering.
    }
    const turnExists = state.turns.some((turn) => turn.id === effectiveTurnId);
    return {
      ...state,
      turns: turnExists
        ? state.turns.map((turn) =>
            turn.id === effectiveTurnId
              ? {
                  ...reactivateTurnForActivity(turn, method === "item/started"),
                  items: upsertWorkbenchItem(turn.items, nextItem)
                }
              : turn
          )
        : upsertWorkbenchTurn(state.turns, {
            id: effectiveTurnId,
            threadId: itemThreadId,
            status: "inProgress",
            startedAt: nextItem.startedAt ?? Math.floor(Date.now() / 1000),
            items: [nextItem]
          })
    };
  }
  if (method === "item/commandExecution/outputDelta") {
    const itemId = stringValue(params.itemId) ?? stringValue(params.item_id);
    const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
    const delta = stringValue(params.delta) ?? "";
    if (!itemId || !turnId) {
      return state;
    }
    return updateTurnItem(state, turnId, itemId, (existing) => ({
      ...(existing ?? {
        id: itemId,
        type: "commandExecution",
        title: "Command",
        text: "",
        status: "inProgress"
      }),
      type: "commandExecution",
      title: existing?.title || "Command",
      text: `${existing?.text ?? ""}${delta}`,
      status: existing?.status ?? "inProgress",
      firstTokenAt: existing?.firstTokenAt ?? Date.now() / 1000
    }));
  }
  if (method === "item/fileChange/patchUpdated") {
    const itemId = stringValue(params.itemId) ?? stringValue(params.item_id);
    const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
    if (!itemId || !turnId) {
      return state;
    }
    return updateTurnItem(state, turnId, itemId, (existing) => ({
      ...(existing ?? {
        id: itemId,
        type: "fileChange",
        title: "File change",
        text: "",
        status: "inProgress"
      }),
      type: "fileChange",
      title: existing?.title || "File change",
      status: existing?.status ?? "inProgress",
      firstTokenAt: existing?.firstTokenAt ?? Date.now() / 1000,
      payload: {
        ...asRecord(existing?.payload),
        changes: Array.isArray(params.changes) ? params.changes : []
      } as JsonValue
    }));
  }
  if (method === "item/commandExecution/terminalInteraction") {
    const itemId = stringValue(params.itemId) ?? stringValue(params.item_id);
    const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
    if (!itemId || !turnId) {
      return state;
    }
    return updateTurnItem(state, turnId, itemId, (existing) => ({
      ...(existing ?? {
        id: itemId,
        type: "commandExecution",
        title: "Command",
        text: "",
        status: "inProgress"
      }),
      type: "commandExecution",
      title: existing?.title || "Command",
      firstTokenAt: existing?.firstTokenAt ?? Date.now() / 1000,
      payload: {
        ...asRecord(existing?.payload),
        terminalInteraction: params
      } as JsonValue
    }));
  }
  if (method === "item/agentMessage/delta") {
    const itemId = stringValue(params.itemId) ?? stringValue(params.item_id);
    const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
    const delta = stringValue(params.delta) ?? "";
    const metadata = agentItemMetadata(params);
    if (!itemId || !turnId) {
      return state;
    }
    const messageThreadId = stringValue(params.threadId) ?? stringValue(params.thread_id) ?? state.activeThreadId ?? turnId;
    if (!state.turns.some((turn) => turn.id === turnId)) {
      state = {
        ...state,
        turns: upsertWorkbenchTurn(state.turns, {
          id: turnId,
          threadId: messageThreadId,
          status: "inProgress",
          startedAt: Date.now() / 1000,
          items: []
        })
      };
    }
    return {
      ...state,
      turns: state.turns.map((turn) => {
        if (turn.id !== turnId) {
          return turn;
        }
        const existing = turn.items.find((item) => item.id === itemId);
        const item: WorkbenchItem = existing ?? {
          id: itemId,
          type: "agentMessage",
          title: "Codex",
          text: ""
        };
        return {
          ...reactivateTurnForActivity(turn),
          items: upsertWorkbenchItem(turn.items, {
            ...item,
            ...mergeAgentItemMetadata(item, metadata),
            startedAt: item.startedAt
              ?? numberValue(params.startedAt)
              ?? numberValue(params.started_at),
            firstTokenAt: item.firstTokenAt
              ?? numberValue(params.firstTokenAt)
              ?? numberValue(params.first_token_at)
              ?? Date.now() / 1000,
            updatedAt: numberValue(params.updatedAt)
              ?? numberValue(params.updated_at)
              ?? Date.now() / 1000,
            text: `${item.text}${delta}`
          })
        };
      })
    };
  }
  if (method === "item/reasoning/summaryPartAdded" || method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
    const itemId = stringValue(params.itemId) ?? stringValue(params.item_id);
    const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
    const delta = stringValue(params.delta) ?? "";
    if (!itemId || !turnId) {
      return state;
    }
    return updateTurnItem(state, turnId, itemId, (existing) => ({
      ...(existing ?? {
        id: itemId,
        type: "reasoning",
        title: "Reasoning",
        text: "",
        status: "inProgress"
      }),
      type: "reasoning",
      title: existing?.title || "Reasoning",
      text: `${existing?.text ?? ""}${delta}`,
      status: existing?.status ?? "inProgress",
      firstTokenAt: existing?.firstTokenAt ?? Date.now() / 1000
    }));
  }
  if (method === "item/plan/delta") {
    const itemId = stringValue(params.itemId) ?? stringValue(params.item_id);
    const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
    const delta = stringValue(params.delta) ?? "";
    if (!itemId || !turnId) {
      return state;
    }
    const planThreadId = stringValue(params.threadId) ?? stringValue(params.thread_id) ?? state.activeThreadId ?? turnId;
    if (!state.turns.some((turn) => turn.id === turnId)) {
      state = {
        ...state,
        turns: upsertWorkbenchTurn(state.turns, {
          id: turnId,
          threadId: planThreadId,
          status: "inProgress",
          startedAt: Date.now() / 1000,
          items: []
        })
      };
    }
    return {
      ...state,
      turns: state.turns.map((turn) => {
        if (turn.id !== turnId) {
          return turn;
        }
        // A fresh plan revision supersedes the consolidated snapshot: keep only
        // one plan card per turn so "Plan" and "Updated Plan" never show together.
        const consolidatedId = `turn-plan-${turnId}`;
        const baseItems = itemId === consolidatedId
          ? turn.items
          : turn.items.filter((item) => item.id !== consolidatedId);
        const existing = baseItems.find((item) => item.id === itemId);
        const item: WorkbenchItem = existing ?? {
          id: itemId,
          type: "plan",
          title: "Plan",
          text: "",
          status: "inProgress"
        };
        return {
          ...reactivateTurnForActivity(turn),
          items: upsertWorkbenchItem(baseItems, {
            ...item,
            type: "plan",
            title: item.title || "Plan",
            status: item.status ?? "inProgress",
            firstTokenAt: item.firstTokenAt ?? Date.now() / 1000,
            text: `${item.text}${delta}`
          })
        };
      })
    };
  }
  if (method === "turn/plan/updated") {
    const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
    const threadId = stringValue(params.threadId) ?? stringValue(params.thread_id) ?? state.turns.find((turn) => turn.id === turnId)?.threadId ?? state.activeThreadId;
    if (!turnId || !threadId) {
      return state;
    }
    const planText = formatPlanUpdateText(params);
    const planStatus = planUpdateStatus(params);
    const now = Date.now() / 1000;
    const planItemId = `turn-plan-${turnId}`;
    const nextTurns = state.turns.some((turn) => turn.id === turnId)
      ? state.turns.map((turn) => {
          if (turn.id !== turnId) {
            return turn;
          }
          const existing = turn.items.find((item) => item.id === planItemId);
          // The consolidated snapshot supersedes the streaming draft: drop any
          // other plan card in this turn so only "Updated Plan" remains visible.
          const baseItems = turn.items.filter((item) => item.id === planItemId || item.type !== "plan");
          return {
            ...reactivateTurnForActivity(turn),
            items: upsertWorkbenchItem(baseItems, {
              id: planItemId,
              type: "plan",
              title: "Updated Plan",
              text: planText,
              status: planStatus,
              firstTokenAt: existing?.firstTokenAt ?? now,
              payload: params as JsonValue
            })
          };
        })
      : upsertWorkbenchTurn(state.turns, {
          id: turnId,
          threadId,
          status: "inProgress",
          startedAt: now,
          items: [
            {
              id: planItemId,
              type: "plan",
              title: "Updated Plan",
              text: planText,
              status: planStatus,
              firstTokenAt: now,
              payload: params as JsonValue
            }
          ]
        });
    // JEV plan audit: notify on every plan revision; the listener gates by
    // mode (off / created / every) and dedupes, so this stays cheap.
    // The dispatch must never break plan rendering.
    try {
      if (planText.trim()) {
        const ownerTurn = state.turns.find((turn) => turn.id === turnId)
          ?? nextTurns.find((turn) => turn.id === turnId);
        const userPrompt = ownerTurn?.items
          .filter((item) => item.type === "userMessage" && typeof item.text === "string" && item.text.trim())
          .map((item) => String(item.text))
          .join("\n---\n")
          .slice(0, 2000) ?? "";
        // JEV 分发专用归属：绝不回退 activeThreadId（同 item/completed 修法），
        // 无归属用 turnId 占位，Composer 按 threadId 过滤会 fail-closed 丢弃。
        // 注意：`threadId` 仍用于下方 activeThreadId 状态更新，不得改动。
        const jevThreadId = stringValue(params.threadId) ?? stringValue(params.thread_id)
          ?? ownerTurn?.threadId
          ?? turnId;
        dispatchJevPlanCreated({
          threadId: jevThreadId,
          turnId,
          planText: planText.slice(0, 6000),
          userPrompt,
          sessionToken: typeof state.token === "string" ? state.token : undefined,
        });
      }
    } catch {
      // Plan audit dispatch must never break plan rendering.
    }
    return {
      ...state,
      activeThreadId: threadId,
      turns: nextTurns
    };
  }
  if (method === "turn/completed" || method === "turn/failed" || method === "turn/interrupted") {    const turn = asRecord(params.turn);
    const id = stringValue(turn.id) ?? stringValue(params.turnId) ?? stringValue(params.turn_id);
    if (!id) {
      return state;
    }
    const fallbackStatus = method === "turn/completed" ? "completed" : method === "turn/interrupted" ? "interrupted" : "failed";
    const payloadStatus = stringValue(turn.status);
    const terminalStatus = payloadStatus && isTerminalWorkbenchStatus(payloadStatus) ? payloadStatus : fallbackStatus;
    const completedThreadId = stringValue(params.threadId) ?? stringValue(params.thread_id) ?? stringValue(turn.threadId) ?? stringValue(turn.thread_id) ?? state.turns.find((entry) => entry.id === id)?.threadId;
    const hasTurn = state.turns.some((entry) => entry.id === id);
    if (!hasTurn) {
      return {
        ...state,
        turns: upsertWorkbenchTurn(state.turns, {
          id,
          threadId: completedThreadId ?? state.activeThreadId ?? id,
          status: fallbackStatus,
          completedAt: numberValue(turn.completedAt) ?? numberValue(turn.completed_at) ?? Math.floor(Date.now() / 1000),
          items: []
        })
      };
    }
    const existingTurn = state.turns.find((entry) => entry.id === id);
    const incomingCompletedAt = numberValue(turn.completedAt) ?? numberValue(turn.completed_at);
    const existingStartedAt = numberValue(existingTurn?.startedAt);
    // A delayed terminal notification from an earlier execution must not
    // finish a newer retry/continuation that reuses the same turn id.
    // The comparison is only valid when both timestamps share a clock
    // (server-provided startedAt); a browser-fabricated startedAt must
    // never discard a server terminal, otherwise clock skew pins the turn
    // in running state forever.
    if (existingTurn && incomingCompletedAt != null && existingStartedAt != null
      && serverStartedTurnIds.has(id)
      && incomingCompletedAt < existingStartedAt && !isTerminalWorkbenchStatus(existingTurn.status)) {
      return state;
    }
    serverStartedTurnIds.delete(id);
    if (existingTurn && incomingCompletedAt == null && !isTerminalWorkbenchStatus(existingTurn.status)
      && existingTurn.items.some((item) => isRunningWorkbenchStatus(item.status) && item.type !== "contextCompaction")) {
      // Some relays omit completedAt. While a child item is still running,
      // an untimestamped terminal event is ambiguous and may be stale.
      return state;
    }
    return {
      ...state,
      turns: state.turns.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: terminalStatus,
              completedAt: numberValue(turn.completedAt) ?? numberValue(turn.completed_at) ?? Math.floor(Date.now() / 1000),
              items: completeActiveCompactions(entry.items, fallbackStatus)
            }
          : entry.threadId === completedThreadId
            ? { ...entry, items: completeActiveCompactions(entry.items, fallbackStatus) }
            : entry
      )
    };
  }
  if (method === "error") {
    const error = asRecord(params.error);
    const errorMessage = stringValue(error.message)
      ?? stringValue(params.message)
      ?? (typeof params.error === "string" ? params.error : undefined);
    const retryError = params.willRetry === true
      || Boolean(errorMessage && /(selected model is at capacity|rate-?limiting requests|stream connection failed|responses_retry|error sending request|didn't complete gracefully|waiting to retry)/i.test(errorMessage));
    if (retryError) {
      const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
      const threadId = stringValue(params.threadId) ?? stringValue(params.thread_id) ?? state.turns.find((turn) => turn.id === turnId)?.threadId ?? state.activeThreadId;
      if (!turnId || !threadId) return state;
      const existingTurn = state.turns.find((turn) => turn.id === turnId);
      const stableId = `retry-error-${turnId}`;
      const isCodexRetryItem = (item: WorkbenchItem) =>
        item.id === stableId || (asRecord(item.payload).retryError === true && asRecord(item.payload).retrySource !== "app");
      const existingItem = existingTurn?.items.find(isCodexRetryItem);
      const now = Date.now() / 1000;
      const retryItem: WorkbenchItem = {
        id: stableId,
        type: "retryError",
        title: params.willRetry === true ? "Retrying request" : "Retry stopped",
        text: errorMessage ?? "Codex retry error",
        status: params.willRetry === true ? "running" : "failed",
        startedAt: existingItem ? existingItem.startedAt : now,
        updatedAt: now,
        payload: {
          ...(existingItem ? asRecord(existingItem.payload) : {}),
          retryError: true,
          retrySource: stringValue(asRecord(params).retrySource) ?? (params.willRetry === true ? "codex" : "terminal"),
          willRetry: params.willRetry === true,
          ...(stringValue(error.additionalDetails) ?? stringValue(error.additional_details)
            ? { additionalDetails: stringValue(error.additionalDetails) ?? stringValue(error.additional_details) }
            : {}),
          ...(numberValue(error.status) ?? numberValue(params.status) != null
            ? { status: numberValue(error.status) ?? numberValue(params.status) }
            : {}),
          ...(typeof asRecord(params).attempt === "number" ? { attempt: asRecord(params).attempt } : {}),
          ...(typeof asRecord(params).stalled === "boolean" ? { stalled: asRecord(params).stalled } : {}),
          ...(typeof asRecord(params).elapsedMs === "number" ? { elapsedMs: asRecord(params).elapsedMs } : {}),
          ...(stringValue(asRecord(params).actionHint) ? { actionHint: stringValue(asRecord(params).actionHint) } : {}),
          ...(typeof asRecord(params).exhausted === "boolean" ? { exhausted: asRecord(params).exhausted } : {})
        } as JsonValue
      };
      const consolidateItems = (items: WorkbenchItem[]): WorkbenchItem[] => {
        let placed = false;
        const result: WorkbenchItem[] = [];
        for (const item of items) {
          if (isCodexRetryItem(item)) {
            if (!placed) {
              result.push(retryItem);
              placed = true;
            }
          } else {
            result.push(item);
          }
        }
        if (!placed) {
          result.push(retryItem);
        }
        return result;
      };
      return {
        ...state,
        turns: existingTurn
          ? state.turns.map((turn) => turn.id === turnId
            ? {
                ...reactivateTurnForActivity(turn, params.willRetry === true),
                items: consolidateItems(turn.items)
              }
            : turn)
          : upsertWorkbenchTurn(state.turns, {
              id: turnId,
              threadId,
              status: params.willRetry === true ? "inProgress" : "failed",
              startedAt: now,
              items: [retryItem]
            })
      };
    }
    return {
      ...state,
      errors: [errorMessage ?? "Codex error", ...state.errors].slice(0, 8)
    };
  }
  return state;
}

function imageApiError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function isTerminalWorkbenchStatus(status?: string): boolean {
  return ["completed", "complete", "failed", "cancelled", "canceled", "interrupted"].includes((status ?? "").toLowerCase());
}

function isRunningWorkbenchStatus(status?: string): boolean {
  return ["inprogress", "pending", "pending_init", "running", "started", "active"].includes((status ?? "").replace(/[-]/g, "_").toLowerCase());
}

function reactivateTurnForActivity(turn: WorkbenchTurn, active = true): WorkbenchTurn {
  if (!active || !isTerminalWorkbenchStatus(turn.status) || isInterruptedWorkbenchStatus(turn.status)) return turn;
  return { ...turn, status: "inProgress", completedAt: undefined };
}

function isInterruptedWorkbenchStatus(status?: string): boolean {
  return ["interrupted", "cancelled", "canceled"].includes((status ?? "").toLowerCase());
}

function completeActiveCompactions(items: WorkbenchItem[], status: string): WorkbenchItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.type !== "contextCompaction" || isTerminalWorkbenchStatus(item.status)) return item;
    changed = true;
    return { ...item, status };
  });
  return changed ? next : items;
}

export function applyNotificationPreservingActiveThread(
  state: ClientState,
  notification: JsonRpcNotification,
): ClientState {
  const activeThreadId = state.activeThreadId;
  const next = applyNotification(state, notification);
  if (next === state) {
    return state;
  }
  if (next.activeThreadId === activeThreadId) {
    return next;
  }
  return { ...next, activeThreadId };
}

export function applyNotificationsPreservingActiveThread(
  state: ClientState,
  notifications: JsonRpcNotification[],
): ClientState {
  if (notifications.length === 0) return state;
  if (!notifications.every(isTurnLocalStreamingNotification)) {
    let next = state;
    let streamingSegment: JsonRpcNotification[] = [];
    const flushStreamingSegment = () => {
      if (streamingSegment.length === 0) return;
      next = applyTurnLocalStreamingNotifications(next, streamingSegment);
      streamingSegment = [];
    };
    for (const notification of notifications) {
      if (isTurnLocalStreamingNotification(notification)) {
        streamingSegment.push(notification);
      } else {
        flushStreamingSegment();
        next = applyNotificationPreservingActiveThread(next, notification);
      }
    }
    flushStreamingSegment();
    return next;
  }
  return applyTurnLocalStreamingNotifications(state, notifications);
}

function applyTurnLocalStreamingNotifications(
  state: ClientState,
  notifications: JsonRpcNotification[],
): ClientState {
  // Streaming bursts from many agents are independent by turn. Index the turn
  // once so a hundred-agent batch does not scan and copy the full transcript a
  // hundred times. Ordering within each turn remains exactly the wire order.
  const notificationsByTurnId = new Map<string, JsonRpcNotification[]>();
  for (const notification of notifications) {
    const params = asRecord(notification.params);
    const turnId = stringValue(params.turnId)
      ?? stringValue(params.turn_id)
      ?? stringValue(asRecord(params.item).turnId)
      ?? stringValue(asRecord(params.item).turn_id);
    if (!turnId) continue;
    const bucket = notificationsByTurnId.get(turnId);
    if (bucket) bucket.push(notification);
    else notificationsByTurnId.set(turnId, [notification]);
  }

  // Seed stub turns for any review/agent stream whose turn arrived without a
  // preceding `turn/started` (e.g. inline /review, which emits items but no
  // parent TurnStarted). Without this, the indexed fast-path below drops
  // every event for an unknown turnId.
  let seededState = state;
  for (const [turnId, turnNotifications] of notificationsByTurnId) {
    if (seededState.turns.some((turn) => turn.id === turnId)) continue;
    const seedParams = asRecord(turnNotifications[0]?.params);
    const seedThreadId =
      stringValue(seedParams.threadId) ??
      stringValue(seedParams.thread_id) ??
      stringValue(asRecord(seedParams.item).threadId) ??
      stringValue(asRecord(seedParams.item).thread_id) ??
      seededState.activeThreadId ??
      turnId;
    seededState = {
      ...seededState,
      turns: upsertWorkbenchTurn(seededState.turns, {
        id: turnId,
        threadId: seedThreadId,
        status: "inProgress",
        startedAt: Date.now() / 1000,
        items: []
      })
    };
  }
  if (seededState !== state) {
    state = seededState;
  }

  const turnIndexById = new Map(state.turns.map((turn, index) => [turn.id, index]));
  const changedTurns = new Map<number, WorkbenchTurn>();
  for (const [turnId, turnNotifications] of notificationsByTurnId) {
    const turnIndex = turnIndexById.get(turnId);
    if (turnIndex === undefined) continue;
    const originalTurn = state.turns[turnIndex]!;
    let scopedState = { ...state, turns: [originalTurn] };
    for (const notification of turnNotifications) {
      scopedState = applyNotificationPreservingActiveThread(scopedState, notification);
    }
    const nextTurn = scopedState.turns[0];
    if (nextTurn && nextTurn !== originalTurn) changedTurns.set(turnIndex, nextTurn);
  }
  if (changedTurns.size === 0) return state;
  const turns = state.turns.slice();
  for (const [index, turn] of changedTurns) turns[index] = turn;
  return { ...state, turns };
}

function isTurnLocalStreamingNotification(notification: JsonRpcNotification): boolean {
  if (!isStreamingWorkbenchNotification(notification)) return false;
  const params = asRecord(notification.params);
  if (!(stringValue(params.turnId) ?? stringValue(params.turn_id))) return false;
  if (notification.method !== "item/completed") return true;
  const item = asRecord(params.item);
  return normalizeWorkbenchItemType(stringValue(item.type) ?? inferItemType(item), item) !== "contextCompaction";
}

export function isStreamingWorkbenchNotification(notification: JsonRpcNotification): boolean {
  return notification.method === "item/agentMessage/delta"
    || notification.method === "item/reasoning/summaryPartAdded"
    || notification.method === "item/reasoning/summaryTextDelta"
    || notification.method === "item/reasoning/textDelta"
    || notification.method === "item/plan/delta"
    || notification.method === "item/commandExecution/outputDelta"
    // Completed items may arrive in large bursts. Applying them in one reducer
    // action preserves protocol order without rebuilding the waterfall once per item.
    || notification.method === "item/completed";
}

export function coalesceStreamingWorkbenchNotifications(
  notifications: JsonRpcNotification[],
): JsonRpcNotification[] {
  const coalesced: JsonRpcNotification[] = [];
  const deltaTargetIndex = new Map<string, number>();
  for (const notification of notifications) {
    if (notification.method === "mini/item/rollback") {
      const params = asRecord(notification.params);
      const threadId = stringValue(params.threadId) ?? stringValue(params.thread_id);
      const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
      const itemIds = new Set(asArray(params.itemIds ?? params.item_ids).map(stringValue).filter((id): id is string => Boolean(id)));
      for (const key of deltaTargetIndex.keys()) {
        const [, targetThreadId, targetTurnId, targetItemId] = key.split("|");
        if (targetTurnId === turnId && itemIds.has(targetItemId ?? "") && (!threadId || targetThreadId === threadId)) {
          deltaTargetIndex.delete(key);
        }
      }
    }
    if (notification.method === "turn/completed" || notification.method === "turn/failed" || notification.method === "turn/interrupted") {
      const params = asRecord(notification.params);
      const turn = asRecord(params.turn);
      const threadId = stringValue(params.threadId) ?? stringValue(params.thread_id)
        ?? stringValue(turn.threadId) ?? stringValue(turn.thread_id);
      const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id) ?? stringValue(turn.id);
      if (turnId) {
        for (const key of deltaTargetIndex.keys()) {
          const [, targetThreadId, targetTurnId] = key.split("|");
          if (targetTurnId === turnId && (!threadId || targetThreadId === threadId)) {
            deltaTargetIndex.delete(key);
          }
        }
      }
    }
    if (notification.method === "item/started" || notification.method === "item/completed") {
      const params = asRecord(notification.params);
      const item = asRecord(params.item);
      const threadId = stringValue(params.threadId) ?? stringValue(params.thread_id);
      const turnId = stringValue(params.turnId) ?? stringValue(params.turn_id);
      const itemId = stringValue(item.id);
      if (turnId && itemId) {
        for (const key of deltaTargetIndex.keys()) {
          const [, targetThreadId, targetTurnId, targetItemId] = key.split("|");
          if (targetTurnId === turnId && targetItemId === itemId && (!threadId || targetThreadId === threadId)) {
            deltaTargetIndex.delete(key);
          }
        }
      }
    }
    const key = streamingNotificationTargetKey(notification);
    const previousIndex = key ? deltaTargetIndex.get(key) : undefined;
    const previous = previousIndex === undefined ? undefined : coalesced[previousIndex];
    if (!previous || !sameStreamingNotificationTarget(previous, notification)) {
      if (key) deltaTargetIndex.set(key, coalesced.length);
      coalesced.push(notification);
      continue;
    }
    const previousParams = asRecord(previous.params);
    const nextParams = asRecord(notification.params);
    coalesced[previousIndex!] = {
      ...notification,
      params: {
        ...previousParams,
        ...nextParams,
        delta: `${stringValue(previousParams.delta) ?? ""}${stringValue(nextParams.delta) ?? ""}`,
      },
    };
  }
  return coalesced;
}

function streamingNotificationTargetKey(notification: JsonRpcNotification): string | null {
  if (notification.method === "item/completed" || !isStreamingWorkbenchNotification(notification)) return null;
  const params = asRecord(notification.params);
  return [notification.method, stringValue(params.threadId) ?? stringValue(params.thread_id), stringValue(params.turnId) ?? stringValue(params.turn_id), stringValue(params.itemId) ?? stringValue(params.item_id)].join("|");
}

function sameStreamingNotificationTarget(
  previous: JsonRpcNotification,
  next: JsonRpcNotification,
): boolean {
  if (previous.method === "item/completed" || previous.method !== next.method || !isStreamingWorkbenchNotification(previous)) {
    return false;
  }
  const previousParams = asRecord(previous.params);
  const nextParams = asRecord(next.params);
  return (stringValue(previousParams.threadId) ?? stringValue(previousParams.thread_id))
      === (stringValue(nextParams.threadId) ?? stringValue(nextParams.thread_id))
    && (stringValue(previousParams.turnId) ?? stringValue(previousParams.turn_id))
      === (stringValue(nextParams.turnId) ?? stringValue(nextParams.turn_id))
    && (stringValue(previousParams.itemId) ?? stringValue(previousParams.item_id))
      === (stringValue(nextParams.itemId) ?? stringValue(nextParams.item_id));
}

function formatPlanUpdateText(params: Record<string, unknown>): string {
  const explanation = stringValue(params.explanation);
  const plan = Array.isArray(params.plan) ? params.plan : [];
  const lines = plan
    .map((entry) => {
      const item = asRecord(entry);
      const step = stringValue(item.step) ?? stringValue(item.text);
      if (!step) {
        return "";
      }
      const status = stringValue(item.status);
      if (status === "completed") {
        return `- [x] ${step}`;
      }
      if (status === "inProgress" || status === "in_progress") {
        return `- [ ] ${step} _(in progress)_`;
      }
      return `- [ ] ${step}`;
    })
    .filter(Boolean);
  return [explanation, lines.join("\n")].filter(Boolean).join("\n\n");
}

function planUpdateStatus(params: Record<string, unknown>): string {
  const plan = Array.isArray(params.plan) ? params.plan.map(asRecord) : [];
  if (plan.some((entry) => {
    const status = stringValue(entry.status);
    return status === "inProgress" || status === "in_progress";
  })) {
    return "inProgress";
  }
  if (plan.length > 0 && plan.every((entry) => stringValue(entry.status) === "completed")) {
    return "completed";
  }
  return "pending";
}

export function dangerousConfirmationMatches(value: string): boolean {
  return value.trim() === DANGER_CONFIRMATION;
}

export function threadReadToTurns(value: JsonValue): { thread: ThreadEntry | null; turns: WorkbenchTurn[] } {
  const thread = asRecord(asRecord(value).thread);
  const threadId = stringValue(thread.id);
  if (!threadId) {
    return { thread: null, turns: [] };
  }
  const turns = Array.isArray(thread.turns)
    ? thread.turns.map((turn) => turnToWorkbenchTurn(threadId, asRecord(turn))).filter(isPresent)
    : [];
  return {
    thread: threadToEntry(thread),
    turns
  };
}

export function composerInputToUserInput(
  text: string,
  images: ComposerImageAttachment[],
  mentions: ComposerMention[] = [],
  options: { preserveText?: boolean } = {}
): JsonValue[] {
  const input: JsonValue[] = [];
  const trimmed = text.trim();
  const attachedFilePaths = images
    .filter((attachment) => attachment.kind === "file" && Boolean(attachment.path))
    .map((attachment) => attachment.path!)
    .filter((path, index, paths) => paths.indexOf(path) === index && !trimmed.includes(path));
  const baseTextValue = options.preserveText ? text : trimmed;
  const textValue = [baseTextValue, ...attachedFilePaths].filter(Boolean).join(baseTextValue ? "\n" : "");
  if (textValue) {
    input.push({ type: "text", text: textValue, text_elements: [] });
  }
  for (const mention of mentions) {
    if (trimmed.includes(mention.token)) {
      input.push(mention.kind === "skill"
        ? { type: "skill", name: mention.name, path: mention.path }
        : { type: "mention", name: mention.name, path: mention.path });
    }
  }
  for (const image of images) {
    if ((image.kind ?? "image") === "image") {
      // Path-only send (OOM fix): screenshots/pastes are uploaded to disk
      // first (see readImageFile) and only the disk `path` travels in
      // turn/start. The server hydrates path->base64 transiently for the
      // model call; chat history/SQLite keeps the path. A data:/base64 URL
      // here would be persisted into history and can SQLITE_NOMEM the DB,
      // so it is never sent — emit a placeholder instead.
      const diskPath = (image.path ?? "").trim();
      if (diskPath && !/^\s*data:/i.test(diskPath) && !diskPath.includes(";base64,")) {
        input.push({
          type: "localImage",
          path: diskPath,
          detail: "auto"
        });
        continue;
      }
      input.push({
        type: "text",
        text: `[Attached image "${image.name}" was omitted: upload it first so only a disk path is sent]`,
        text_elements: []
      });
      continue;
    }
    if (image.path) {
      input.push({
        type: "mention",
        name: image.name,
        path: image.path
      });
      continue;
    }
    input.push({
      type: "text",
      text: `[Attached file: ${image.name} (${image.mediaType || "application/octet-stream"}, ${image.size} bytes)]`,
      text_elements: []
    });
  }
  return input;
}

export function parseMcpServers(value: JsonValue): McpServerEntry[] {
  const data = asArray(asRecord(value).data);
  return data.map((entry) => {
    const server = asRecord(entry);
    const toolsRecord = asRecord(server.tools);
    return {
      name: stringValue(server.name) ?? "Unnamed MCP server",
      authStatus: stringValue(server.authStatus) ?? "unknown",
      serverInfo: serverInfoLabel(server.serverInfo),
      tools: Object.values(toolsRecord).map((tool) => mcpToolToEntry(asRecord(tool))),
      resources: asArray(server.resources).map((resource) => mcpResourceToEntry(asRecord(resource))),
      resourceTemplates: asArray(server.resourceTemplates).map((resource) => mcpResourceToEntry(asRecord(resource)))
    };
  });
}

export function parseSkillGroups(value: JsonValue): SkillGroup[] {
  return asArray(asRecord(value).data).map((entry) => {
    const group = asRecord(entry);
    return {
      cwd: stringValue(group.cwd) ?? "global",
      skills: asArray(group.skills).map((skill) => skillToEntry(asRecord(skill))),
      errors: asArray(group.errors).map((error) => {
        const raw = asRecord(error);
        return {
          path: stringValue(raw.path) ?? "unknown",
          message: stringValue(raw.message) ?? "Unable to load skill"
        };
      })
    };
  });
}

export function parseHookGroups(value: JsonValue): HookGroup[] {
  return asArray(asRecord(value).data).map((entry) => {
    const group = asRecord(entry);
    return {
      cwd: stringValue(group.cwd) ?? "global",
      hooks: asArray(group.hooks).map((hook) => hookToEntry(asRecord(hook))),
      warnings: asArray(group.warnings).map(String),
      errors: asArray(group.errors).map((error) => {
        const raw = asRecord(error);
        return {
          path: stringValue(raw.path) ?? "unknown",
          message: stringValue(raw.message) ?? "Unable to load hook"
        };
      })
    };
  });
}

export function parsePluginMarketplaces(value: JsonValue): Pick<ToolingState, "pluginMarketplaces" | "featuredPluginIds" | "marketplaceErrors"> {
  const record = asRecord(value);
  return {
    pluginMarketplaces: asArray(record.marketplaces).map((marketplace) => marketplaceToEntry(asRecord(marketplace))),
    featuredPluginIds: asArray(record.featuredPluginIds).map(String),
    marketplaceErrors: asArray(record.marketplaceLoadErrors).map((error) => {
      const raw = asRecord(error);
      return [stringValue(raw.marketplacePath), stringValue(raw.message)].filter(Boolean).join(": ") || "Marketplace load failed";
    })
  };
}

export function parseInstalledPluginMarketplaces(value: JsonValue): Pick<ToolingState, "installedPluginMarketplaces" | "marketplaceErrors"> {
  const record = asRecord(value);
  return {
    installedPluginMarketplaces: asArray(record.marketplaces).map((marketplace) => marketplaceToEntry(asRecord(marketplace))),
    marketplaceErrors: asArray(record.marketplaceLoadErrors).map((error) => {
      const raw = asRecord(error);
      return [stringValue(raw.marketplacePath), stringValue(raw.message)].filter(Boolean).join(": ") || "Installed plugin load failed";
    })
  };
}

export function parsePluginDetail(value: JsonValue): PluginDetailEntry | null {
  const detail = asRecord(asRecord(value).plugin);
  const summary = asRecord(detail.summary);
  const marketplaceName = stringValue(detail.marketplaceName);
  if (!marketplaceName) {
    return null;
  }
  return {
    marketplaceName,
    marketplacePath: stringValue(detail.marketplacePath),
    plugin: pluginToEntry(summary),
    description: stringValue(detail.description),
    shareUrl: stringValue(detail.shareUrl),
    skills: asArray(detail.skills).map((skill) => {
      const raw = asRecord(skill);
      return {
        name: stringValue(raw.name) ?? "skill",
        description: stringValue(raw.description) ?? stringValue(raw.shortDescription),
        enabled: boolValue(raw.enabled) ?? false,
        path: stringValue(raw.path),
        remoteReadable: stringValue(summary.remotePluginId) != null
      };
    }),
    hooks: asArray(detail.hooks).map((hook) => {
      const raw = asRecord(hook);
      return {
        key: stringValue(raw.key) ?? "hook",
        eventName: stringValue(raw.eventName) ?? "hook"
      };
    }),
    apps: asArray(detail.apps).map((app) => {
      const raw = asRecord(app);
      return appSummaryToEntry(raw);
    }),
    appTemplates: asArray(detail.appTemplates).map((template) => appTemplateToEntry(asRecord(template))),
    mcpServers: asArray(detail.mcpServers).map(String),
    scheduledTaskCount: Array.isArray(detail.scheduledTasks) ? detail.scheduledTasks.length : undefined
  };
}

export function parsePluginInstallAuthNotice(value: JsonValue): PluginInstallAuthNotice {
  const record = asRecord(value);
  return {
    authPolicy: stringValue(record.authPolicy) ?? "unknown",
    apps: asArray(record.appsNeedingAuth).map((app) => appSummaryToEntry(asRecord(app)))
  };
}

export function parseApps(value: JsonValue): PluginAppEntry[] {
  return asArray(asRecord(value).data).map((app) => {
    const raw = asRecord(app);
    const branding = asRecord(raw.branding);
    return {
      id: stringValue(raw.id) ?? "app",
      name: stringValue(raw.name) ?? "App",
      description: stringValue(raw.description),
      installUrl: stringValue(raw.installUrl),
      category: stringValue(branding.category),
      isAccessible: boolValue(raw.isAccessible),
      isEnabled: boolValue(raw.isEnabled),
      pluginDisplayNames: asArray(raw.pluginDisplayNames).map(String),
      logoUrl: stringValue(raw.logoUrl) ?? stringValue(raw.logoUrlDark),
      developer: stringValue(branding.developer),
      website: stringValue(branding.website)
    };
  });
}

export function parseMcpResourceContents(value: JsonValue): McpResourceContentEntry[] {
  return asArray(asRecord(value).contents).map((entry) => {
    const raw = asRecord(entry);
    return {
      uri: stringValue(raw.uri) ?? "resource",
      mimeType: stringValue(raw.mimeType),
      text: stringValue(raw.text),
      blob: stringValue(raw.blob)
    };
  });
}

export function parseFsDirectory(value: JsonValue, parentPath: string): FsDirectoryEntry[] {
  return asArray(asRecord(value).entries)
    .map((entry) => {
      const raw = asRecord(entry);
      const name = stringValue(raw.fileName) ?? "";
      if (!name) {
        return null;
      }
      return {
        name,
        path: joinPath(parentPath, name),
        isDirectory: boolValue(raw.isDirectory) ?? false,
        isFile: boolValue(raw.isFile) ?? false
      };
    })
    .filter(isPresent)
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const found = items.some((item) => item.id === next.id);
  return found ? items.map((item) => (item.id === next.id ? next : item)) : [next, ...items];
}

function updateTurnItem(
  state: ClientState,
  turnId: string,
  itemId: string,
  update: (existing: WorkbenchItem | undefined) => WorkbenchItem
): ClientState {
  const turn = state.turns.find((entry) => entry.id === turnId);
  if (!turn) {
    return {
      ...state,
      turns: upsertWorkbenchTurn(state.turns, {
        id: turnId,
        threadId: state.activeThreadId ?? turnId,
        status: "inProgress",
        startedAt: Math.floor(Date.now() / 1000),
        items: [update(undefined)]
      })
    };
  }
  return {
    ...state,
    turns: state.turns.map((entry) =>
      entry.id === turnId
        ? {
            ...reactivateTurnForActivity(entry),
            items: upsertWorkbenchItem(entry.items, update(entry.items.find((item) => item.id === itemId)))
          }
        : entry
    )
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function threadStatusValue(value: unknown): string | undefined {
  return stringValue(value) ?? stringValue(asRecord(value).type);
}


function formatErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
    try {
      return JSON.stringify(record);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function numberLikeValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function serverInfoLabel(value: unknown): string | undefined {
  const info = asRecord(value);
  const name = stringValue(info.name);
  const title = stringValue(info.title);
  const version = stringValue(info.version);
  return [title ?? name, version].filter(Boolean).join(" ") || undefined;
}

function mcpToolToEntry(tool: Record<string, unknown>): McpToolEntry {
  return {
    name: stringValue(tool.name) ?? "unnamed-tool",
    title: stringValue(tool.title),
    description: stringValue(tool.description),
    inputSchema: "inputSchema" in tool ? (tool.inputSchema as JsonValue) : {},
    outputSchema: "outputSchema" in tool ? (tool.outputSchema as JsonValue) : undefined,
    annotations: "annotations" in tool ? (tool.annotations as JsonValue) : undefined
  };
}

function mcpResourceToEntry(resource: Record<string, unknown>): McpResourceEntry {
  return {
    name: stringValue(resource.name) ?? stringValue(resource.uri) ?? stringValue(resource.uriTemplate) ?? "resource",
    title: stringValue(resource.title),
    uri: stringValue(resource.uri) ?? stringValue(resource.uriTemplate),
    description: stringValue(resource.description)
  };
}

function skillToEntry(skill: Record<string, unknown>): SkillEntry {
  const skillInterface = asRecord(skill.interface);
  const displayName = stringValue(skillInterface.displayName) ?? stringValue(skill.name) ?? "Unnamed skill";
  return {
    name: stringValue(skill.name) ?? displayName,
    displayName,
    description: stringValue(skill.description) ?? stringValue(skillInterface.shortDescription) ?? "",
    shortDescription: stringValue(skill.shortDescription) ?? stringValue(skillInterface.shortDescription),
    path: stringValue(skill.path) ?? "",
    scope: stringValue(skill.scope) ?? "unknown",
    enabled: boolValue(skill.enabled) ?? false
  };
}

function hookToEntry(hook: Record<string, unknown>): HookEntry {
  return {
    key: stringValue(hook.key) ?? "hook",
    eventName: stringValue(hook.eventName) ?? "hook",
    handlerType: stringValue(hook.handlerType) ?? "command",
    matcher: stringValue(hook.matcher),
    command: stringValue(hook.command),
    timeoutSec: numberLikeValue(hook.timeoutSec),
    statusMessage: stringValue(hook.statusMessage),
    sourcePath: stringValue(hook.sourcePath) ?? "unknown",
    source: stringValue(hook.source) ?? "unknown",
    pluginId: stringValue(hook.pluginId),
    displayOrder: numberLikeValue(hook.displayOrder),
    enabled: boolValue(hook.enabled) ?? false,
    isManaged: boolValue(hook.isManaged) ?? false,
    currentHash: stringValue(hook.currentHash),
    trustStatus: stringValue(hook.trustStatus) ?? "unknown"
  };
}

function marketplaceToEntry(marketplace: Record<string, unknown>): PluginMarketplace {
  const marketplaceInterface = asRecord(marketplace.interface);
  return {
    name: stringValue(marketplace.name) ?? "marketplace",
    path: stringValue(marketplace.path),
    displayName: stringValue(marketplaceInterface.displayName),
    plugins: asArray(marketplace.plugins).map((plugin) => pluginToEntry(asRecord(plugin)))
  };
}

function pluginToEntry(plugin: Record<string, unknown>): PluginEntry {
  const pluginInterface = asRecord(plugin.interface);
  return {
    id: stringValue(plugin.id) ?? stringValue(plugin.name) ?? "plugin",
    remotePluginId: stringValue(plugin.remotePluginId),
    name: stringValue(plugin.name) ?? stringValue(plugin.id) ?? "plugin",
    displayName: stringValue(pluginInterface.displayName) ?? stringValue(plugin.name) ?? "Plugin",
    description: stringValue(pluginInterface.shortDescription) ?? stringValue(pluginInterface.longDescription),
    version: stringValue(plugin.version),
    localVersion: stringValue(plugin.localVersion),
    installed: boolValue(plugin.installed) ?? false,
    enabled: boolValue(plugin.enabled) ?? false,
    source: sourceLabel(plugin.source),
    availability: stringValue(plugin.availability) ?? "unknown",
    authPolicy: stringValue(plugin.authPolicy) ?? "unknown",
    installPolicy: stringValue(plugin.installPolicy) ?? "unknown",
    installPolicySource: stringValue(plugin.installPolicySource),
    category: stringValue(pluginInterface.category),
    developerName: stringValue(pluginInterface.developerName),
    websiteUrl: stringValue(pluginInterface.websiteUrl),
    privacyPolicyUrl: stringValue(pluginInterface.privacyPolicyUrl),
    termsOfServiceUrl: stringValue(pluginInterface.termsOfServiceUrl),
    defaultPrompt: asArray(pluginInterface.defaultPrompt).map(String),
    logoUrl: stringValue(pluginInterface.logoUrl) ?? stringValue(pluginInterface.logoUrlDark) ?? stringValue(pluginInterface.composerIconUrl),
    screenshotUrls: asArray(pluginInterface.screenshotUrls).map(String),
    capabilities: asArray(pluginInterface.capabilities).map(String),
    keywords: asArray(plugin.keywords).map(String)
  };
}

function appSummaryToEntry(app: Record<string, unknown>): PluginAppEntry {
  return {
    id: stringValue(app.id) ?? "app",
    name: stringValue(app.name) ?? "App",
    description: stringValue(app.description),
    installUrl: stringValue(app.installUrl),
    category: stringValue(app.category),
    pluginDisplayNames: []
  };
}

function appTemplateToEntry(template: Record<string, unknown>): PluginAppTemplateEntry {
  return {
    templateId: stringValue(template.templateId) ?? "template",
    name: stringValue(template.name) ?? "App template",
    description: stringValue(template.description),
    category: stringValue(template.category),
    canonicalConnectorId: stringValue(template.canonicalConnectorId),
    logoUrl: stringValue(template.logoUrl) ?? stringValue(template.logoUrlDark),
    materializedAppIds: asArray(template.materializedAppIds).map(String),
    reason: stringValue(template.reason)
  };
}

function sourceLabel(value: unknown): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  const source = asRecord(value);
  const type = stringValue(source.type);
  switch (type) {
    case "local":
      return stringValue(source.path) ?? "local";
    case "git":
      return stringValue(source.url) ?? "git";
    case "npm":
      return stringValue(source.package) ?? "npm";
    case "remote":
      return "remote";
    default:
      return "unknown";
  }
}

function joinPath(parentPath: string, name: string): string {
  return joinWorkspacePath(parentPath, name);
}

export function threadResponseIncludesTranscript(value: JsonValue): boolean {
  const turns = asRecord(asRecord(value).thread).turns;
  return Array.isArray(turns) && turns.length > 0;
}

export function threadTurnsPageToTurns(threadId: string, value: JsonValue, sortDirection: "asc" | "desc" = "desc"): { turns: WorkbenchTurn[]; nextCursor: string | null } {
  const response = asRecord(value);
  const data = Array.isArray(response.data) ? response.data : [];
  const ordered = sortDirection === "desc" ? data.slice().reverse() : data;
  return {
    turns: ordered.map((turn) => turnToWorkbenchTurn(threadId, asRecord(turn))).filter(isPresent),
    nextCursor: stringValue(response.nextCursor) ?? null
  };
}

function threadToEntry(thread: Record<string, unknown>): ThreadEntry {
  const name = stringValue(thread.name) ?? stringValue(thread.threadName) ?? stringValue(thread.thread_name);
  const preview = stringValue(thread.preview) ?? name;
  return {
    id: String(thread.id ?? ""),
    ...(stringValue(thread.cliBackend ?? thread.cli_backend) === "claude" || stringValue(thread.cliBackend ?? thread.cli_backend) === "auggie"
      ? { cliBackend: stringValue(thread.cliBackend ?? thread.cli_backend) as "claude" | "auggie" }
      : stringValue(thread.cliBackend ?? thread.cli_backend) === "agy"
        ? { cliBackend: "agy" as const }
        : stringValue(thread.cliBackend ?? thread.cli_backend) === "grok"
          ? { cliBackend: "grok" as const }
          : stringValue(thread.cliBackend ?? thread.cli_backend) === "muse"
            ? { cliBackend: "muse" as const }
          : stringValue(thread.cliBackend ?? thread.cli_backend) === "pi"
            ? { cliBackend: "pi" as const }
            : stringValue(thread.cliBackend ?? thread.cli_backend) === "opencode"
              ? { cliBackend: "opencode" as const }
              : stringValue(thread.cliBackend ?? thread.cli_backend) === "opencode-v2"
                ? { cliBackend: "opencode-v2" as const }
                : stringValue(thread.cliBackend ?? thread.cli_backend) === "mini"
                  ? { cliBackend: "mini" as const }
                  : stringValue(thread.cliBackend ?? thread.cli_backend) === "codex" ? { cliBackend: "codex" as const } : {}),
    sessionId: stringValue(thread.sessionId) ?? stringValue(thread.session_id),
    title: name ?? stringValue(thread.title) ?? stringValue(thread.thread_name),
    name,
    preview: preview ? displayPromptText(preview) : undefined,
    model: stringValue(thread.model),
    modelProvider: stringValue(thread.modelProvider) ?? stringValue(thread.model_provider),
    parentThreadId: stringValue(thread.parentThreadId) ?? stringValue(thread.parent_thread_id),
    forkedFromId: stringValue(thread.forkedFromId) ?? stringValue(thread.forked_from_id),
    agentNickname: stringValue(thread.agentNickname) ?? stringValue(thread.agent_nickname),
    agentRole: stringValue(thread.agentRole) ?? stringValue(thread.agent_role),
    createdAt: numberValue(thread.createdAt) ?? numberValue(thread.created_at),
    updatedAt: numberValue(thread.updatedAt) ?? numberValue(thread.updated_at),
    recencyAt: numberValue(thread.recencyAt) ?? numberValue(thread.recency_at),
    status: threadStatusValue(thread.status),
    historyMode: thread.historyMode === "paginated"
      || ["opencode", "mini", "grok", "muse", "pi", "claude", "agy"].includes(stringValue(thread.cliBackend ?? thread.cli_backend) ?? "")
      ? "paginated"
      : "legacy",
    cwd: stringValue(thread.cwd),
    additionalRoots: stringArrayValue(thread.additionalRoots ?? thread.additional_roots),
    workspaceMode: stringValue(thread.workspaceMode ?? thread.workspace_mode) === "ssh" ? "ssh" : undefined,
    sshCommand: stringValue(thread.sshCommand ?? thread.ssh_command),
    sshCwd: stringValue(thread.sshCwd ?? thread.ssh_cwd),
    remoteExecutionMode: stringValue(thread.remoteExecutionMode ?? thread.remote_execution_mode) === "autonomous" ? "autonomous" : undefined,
    remoteLifecycleMode: stringValue(thread.remoteLifecycleMode ?? thread.remote_lifecycle_mode) === "foreground" ? "foreground" : stringValue(thread.remoteLifecycleMode ?? thread.remote_lifecycle_mode) === "background" ? "background" : undefined,
    source: sourceLabel(thread.source ?? thread.thread_source),
    threadSource: sourceLabel(thread.threadSource ?? thread.thread_source),
    path: stringValue(thread.path) ?? stringValue(thread.file_path)
  };
}

export function turnToWorkbenchTurn(threadId: string, turn: Record<string, unknown>): WorkbenchTurn | null {
  const id = stringValue(turn.id);
  if (!id) {
    return null;
  }
  const items = Array.isArray(turn.items)
    ? turn.items.map((item) => threadItemToWorkbenchItem(asRecord(item))).filter(isPresent)
    : [];
  return {
    id,
    threadId,
    status: stringValue(turn.status) ?? "completed",
    startedAt: numberValue(turn.startedAt),
    completedAt: numberValue(turn.completedAt) ?? numberValue(turn.completed_at),
    items
  };
}

/**
 * Parse the `turn` payload returned by `review/start` into a WorkbenchTurn.
 * Inline review turns emit item notifications but no parent `turn/started`,
 * so the caller seeds the turn here using `reviewThreadId` as the thread id.
 * The returned object always carries an explicit `threadId`; it never falls
 * back to a missing turn-supplied thread id, because the review/start
 * response may omit it.
 */
export function reviewStartTurnToWorkbenchTurn(
  reviewThreadId: string,
  turn: Record<string, unknown> | null | undefined
): WorkbenchTurn | null {
  const record = asRecord(turn);
  const id = stringValue(record.id);
  if (!id) {
    return null;
  }
  const threadId = stringValue(record.threadId) ?? reviewThreadId;
  const parsed = turnToWorkbenchTurn(threadId, record);
  if (parsed) {
    // A fresh review/start turn is running unless the response states otherwise;
    // turnToWorkbenchTurn defaults to "completed" which is only right for thread/read.
    if (!stringValue(record.status)) {
      return { ...parsed, status: "inProgress" };
    }
    return parsed;
  }
  // Defensive in-progress stub. `turnToWorkbenchTurn` only returns null when
  // the turn id is missing, which is already guarded above, so this branch is
  // currently unreachable. Keep it as a safety net in case the projection
  // learns to reject malformed bodies without losing the parsed id.
  return {
    id,
    threadId,
    status: stringValue(record.status) ?? "inProgress",
    startedAt: numberValue(record.startedAt),
    items: []
  };
}

function threadItemToWorkbenchItem(item: Record<string, unknown>): WorkbenchItem | null {
  const id = stringValue(item.id);
  if (!id) {
    return null;
  }
  const rawType = stringValue(item.type) ?? inferItemType(item);
  const type = normalizeWorkbenchItemType(rawType, item);
  const text = sanitizeRelayErrorText(itemText(item));
  if ((type === "userMessage" || type === "goalContinuation") && isInternalContinuationPrompt(text)) {
    return null;
  }
  return {
    id,
    type,
    title: itemTitle(item),
    text,
    images: itemImages(item),
    files: itemFiles(item),
    status: stringValue(item.status),
    startedAt: numberValue(item.startedAt) ?? numberValue(item.started_at),
    firstTokenAt: numberValue(item.firstTokenAt) ?? numberValue(item.first_token_at),
    updatedAt: numberValue(item.updatedAt) ?? numberValue(item.updated_at),
    ...agentItemMetadata(item),
    payload: item as JsonValue
  };
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
  return [...new Set(entries)];
}

function isInternalContinuationPrompt(value: string): boolean {
  return isGoalContinuationPrompt(value) || isPlanContinuationPrompt(value);
}

/**
 * Relay/upstream wire errors (e.g. `chat 400: {"error":...,
 * "type":"relay_protocol_error"}`) must never leak raw JSON into the
 * transcript. Collapse them to a short friendly message that KEEPS the
 * upstream reason (content-free, max ~200 chars): a bare "偶发/重试"
 * hid persistent shape rejections for weeks (duck2api every-message 400).
 * Exported for tests.
 */
export function sanitizeRelayErrorText(text: string): string {
  if (!text || !text.includes("relay_protocol_error")) return text;
  const detail = extractRelayErrorDetail(text);
  const statusMatch = text.match(/\bchat (\d{3})\b/) ?? text.match(/"status":\s*(\d{3})/);
  const status = statusMatch?.[1] ?? "";
  // "偶发" was wrong: shape rejections fail every turn until fixed.
  const tail400 = detail ? `：${detail}，可重试或切换模型/分组。` : "，请重试一次。";
  if (text.includes("ERR_BAD_REQUEST") || status === "400") {
    return `上游服务拒绝了本次请求（relay 400）${tail400}`;
  }
  if (status === "429") {
    return `上游限流（relay 429）${detail ? `：${detail}，稍后再试。` : "，稍后重试。"}`;
  }
  if (status === "502" || status === "503") {
    return `上游服务暂时不可用（relay ${status}）${detail ? `：${detail}，稍后再试。` : "，稍后重试。"}`;
  }
  return "上游请求失败，请重试一次。";
}

/**
 * Pull `.error.message` out of a relay_protocol_error envelope, unwrapping
 * one or two levels of nested JSON error blobs (some channels nest
 * `{"action":"error","type":"ERR_BAD_REQUEST"}` as the message). Returns ""
 * when there is no human-readable message so callers fall back to generic
 * copy. Never returns raw JSON.
 */
function extractRelayErrorDetail(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) return "";
  try {
    const body = JSON.parse(text.slice(start)) as Record<string, unknown>;
    const err = (body.error ?? {}) as Record<string, unknown>;
    const raw = typeof err.message === "string" ? err.message
      : typeof body.message === "string" ? body.message : "";
    return flattenRelayErrorMessage(raw);
  } catch {
    return "";
  }
}

function flattenRelayErrorMessage(raw: string, depth = 0): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean || depth > 2) return "";
  if (!clean.startsWith("{")) return clean.slice(0, 200);
  try {
    const rec = JSON.parse(clean) as Record<string, unknown>;
    const inner = typeof rec.message === "string" ? rec.message : "";
    if (inner && inner !== clean) return flattenRelayErrorMessage(inner, depth + 1);
    return "";
  } catch {
    return "";
  }
}

function inferItemType(item: Record<string, unknown>): string {
  if ("result" in item && ("revised_prompt" in item || "revisedPrompt" in item)) return "imageGeneration";
  if ("text" in item) return "agentMessage";
  if ("command" in item) return "commandExecution";
  if ("changes" in item) return "fileChange";
  if ("summary" in item) return "reasoning";
  return "item";
}

function normalizeWorkbenchItemType(type: string, item: Record<string, unknown>): string {
  if (type === "message") {
    const role = stringValue(item.role);
    if (role === "user") return "userMessage";
    if (role === "assistant") return "agentMessage";
  }
  if (type === "image_generation_call") {
    return "imageGeneration";
  }
  if (type === "plan") {
    return "plan";
  }
  if (type === "toolUse" || type === "tool_use") {
    return "toolCall";
  }
  if (type === "compaction" || type === "context_compaction") {
    return "contextCompaction";
  }
  return type;
}

function itemTitle(item: Record<string, unknown>): string {
  const type = stringValue(item.type) ?? inferItemType(item);
  switch (type) {
    case "agentMessage":
      return "Codex";
    case "userMessage":
      return "User";
    case "commandExecution":
      return "Command";
    case "fileChange":
      return "File change";
    case "reasoning":
      return "Reasoning";
    case "toolCall":
    case "toolUse":
    case "tool_use":
      return stringValue(item.toolName) ?? stringValue(item.name) ?? "Tool";
    case "plan":
      return "Plan";
    case "contextCompaction":
      return "Context compaction";
    case "enteredReviewMode":
      return "Entered review mode";
    case "exitedReviewMode":
      return "Exited review mode";
    case "mcpToolCall":
      return [`MCP`, stringValue(item.server), stringValue(item.tool)].filter(Boolean).join(" / ");
    case "dynamicToolCall":
      return [`Tool`, stringValue(item.namespace), stringValue(item.tool)].filter(Boolean).join(" / ");
    case "collabAgentToolCall":
      return "Parallel agent";
    case "subAgentActivity":
      return "Agent activity";
    case "image_generation_call":
    case "imageGeneration":
      return "Image generation";
    case "imageView":
      return "Image view";
    default:
      return type;
  }
}

function itemText(item: Record<string, unknown>): string {
  const itemType = stringValue(item.type);
  if (itemType === "enteredReviewMode" || itemType === "exitedReviewMode") {
    return stringValue(item.review) ?? "";
  }
  if (itemType === "image_generation_call" || itemType === "imageGeneration") {
    return stringValue(item.revised_prompt) ?? stringValue(item.revisedPrompt) ?? "";
  }
  if (stringValue(item.type) === "mcpToolCall") {
    const payload = asRecord(item.result);
    const error = asRecord(item.error);
    const errorMessage = stringValue(error.message);
    if (errorMessage) {
      return errorMessage;
    }
    if (Array.isArray(payload.content) && payload.content.length > 0) {
      return payload.content.map((entry) => summarizeJsonValue(entry)).filter(Boolean).join("\n");
    }
    if ("structuredContent" in payload && payload.structuredContent != null) {
      return summarizeJsonValue(payload.structuredContent);
    }
    if ("arguments" in item) {
      return summarizeJsonValue(item.arguments);
    }
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  if (Array.isArray(item.content)) {
    const fromContent = item.content
      .map((entry) => {
        const block = asRecord(entry);
        const blockType = stringValue(block.type);
        // 瀑布流：思考独立渲染为 Thinking 行，正文只保留 text。
        // 旧 grok/agy/pi 历史把 reasoning 块塞进 agentMessage.content，
        // 这里过滤避免正文重复思考内容。
        if (
          blockType === "reasoning" ||
          blockType === "reasoning_text" ||
          blockType === "thinking"
        ) {
          return "";
        }
        if (
          blockType === "text" ||
          blockType === "input_text" ||
          blockType === "output_text" ||
          blockType === "inputText" ||
          blockType === "outputText"
        ) {
          return stringValue(block.text) ?? "";
        }
        if (blockType === "localImage") {
          return "[image]";
        }
        if (blockType === "image") {
          return "[image]";
        }
        if (blockType === "input_image" || blockType === "inputImage") {
          return "[image]";
        }
        if (blockType === "skill" || blockType === "mention") {
          return `@${stringValue(block.name) ?? "mention"}`;
        }
        return stringValue(block.text) ?? "";
      })
      .filter(Boolean)
      .join("\n");
    if (fromContent) {
      return fromContent;
    }
  }
  if (typeof item.text === "string") {
    return item.text;
  }
  if (stringValue(item.type) === "collabAgentToolCall") {
    const tool = stringValue(item.tool);
    const prompt = stringValue(item.prompt);
    const receivers = asArray(item.receiverThreadIds).map(String).filter(Boolean);
    return [
      tool ? `Tool: ${tool}` : "",
      prompt ? `Prompt: ${prompt}` : "",
      receivers.length > 0 ? `Agents: ${receivers.join(", ")}` : ""
    ].filter(Boolean).join("\n");
  }
  if (stringValue(item.type) === "subAgentActivity") {
    return [
      stringValue(item.kind) ? `Status: ${stringValue(item.kind)}` : "",
      stringValue(item.agentPath) ? `Agent: ${stringValue(item.agentPath)}` : ""
    ].filter(Boolean).join("\n");
  }
  if (Array.isArray(item.command)) {
    return item.command.map(String).join(" ");
  }
  if (typeof item.aggregatedOutput === "string") {
    return item.aggregatedOutput;
  }
  return "";
}

function itemImages(item: Record<string, unknown>): WorkbenchImage[] | undefined {
  const itemType = stringValue(item.type);
  if (itemType === "imageView") {
    const path = stringValue(item.path);
    return path ? [{ url: path, name: path }] : undefined;
  }
  if (itemType === "image_generation_call" || itemType === "imageGeneration") {
    // Path-first render (SQLite OOM fix): history rows are path-only
    // ({saved_path}, result:""), so prefer the disk path. A legacy poisoned
    // row may still carry base64 in `result` — materializing it as a data:
    // URL would allocate the whole bitmap in the renderer, so long payloads
    // are ignored (short values are kept for backward-compat thumbnails).
    const savedPath = stringValue(item.savedPath) ?? stringValue(item.saved_path);
    const b64 = stringValue(item.result);
    const shortB64 = b64 && b64.trim().length > 0 && b64.trim().length < 4096 ? b64.trim() : undefined;
    const url = savedPath ?? (shortB64 ? `data:image/png;base64,${shortB64}` : undefined);
    return url
      ? [{
          url,
          name: "generated-image.png",
          revisedPrompt: stringValue(item.revised_prompt) ?? stringValue(item.revisedPrompt),
          model: stringValue(item.model),
          providerName: stringValue(item.provider_name) ?? stringValue(item.providerName),
          estimatedCostUsd: numberValue(item.estimated_cost_usd) ?? numberValue(item.estimatedCostUsd),
          unitPriceUsd: numberValue(item.image_unit_price_usd) ?? numberValue(item.imageUnitPriceUsd)
        }]
      : undefined;
  }
  if (!Array.isArray(item.content)) {
    return undefined;
  }
  const images = item.content
    .map((entry): WorkbenchImage | null => {
      const block = asRecord(entry);
      if (block.type === "image") {
        const url = stringValue(block.url);
        return url ? { url, detail: stringValue(block.detail) } : null;
      }
      if (block.type === "input_image" || block.type === "inputImage") {
        const url = stringValue(block.image_url) ?? stringValue(block.imageUrl) ?? stringValue(block.url);
        return url ? { url, detail: stringValue(block.detail) } : null;
      }
      if (block.type === "localImage") {
        const path = stringValue(block.path);
        return path ? { url: path, name: path, detail: stringValue(block.detail) } : null;
      }
      return null;
    })
    .filter(isPresent);
  return images.length > 0 ? images : undefined;
}

function itemFiles(item: Record<string, unknown>): WorkbenchFile[] | undefined {
  if (!Array.isArray(item.content)) {
    return undefined;
  }
  const files = item.content
    .map((entry): WorkbenchFile | null => {
      const block = asRecord(entry);
      if (block.type === "mention") {
        const path = stringValue(block.path);
        const name = stringValue(block.name) ?? path;
        return name ? { name, path } : null;
      }
      if (block.type === "file" || block.type === "document") {
        const path = stringValue(block.path);
        const url = stringValue(block.url);
        const name = stringValue(block.name) ?? path ?? url;
        return name
          ? {
              name,
              path,
              url,
              mediaType: stringValue(block.mediaType) ?? stringValue(block.mimeType),
              size: numberValue(block.size)
            }
          : null;
      }
      return null;
    })
    .filter(isPresent);
  return files.length > 0 ? files : undefined;
}

function agentItemMetadata(...recordsOrFlags: Array<Record<string, unknown> | boolean | undefined>): Partial<WorkbenchItem> {
  const markCompleted = recordsOrFlags.some((entry) => entry === true);
  const records = recordsOrFlags.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
  const nestedRecords = records.flatMap((record) => [asRecord(record.agent), asRecord(record.subagent), asRecord(record.subAgent)]);
  const sources = [...records, ...nestedRecords];
  const agentThreadId =
    firstString(sources, ["agentThreadId", "subagentThreadId", "subAgentThreadId", "receiverThreadId"]) ??
    firstString(nestedRecords, ["threadId"]);
  const agentId = firstString(sources, ["agentId", "subagentId", "subAgentId", "agentPath"]) ?? firstString(nestedRecords, ["id"]) ?? agentThreadId;
  const agentName =
    firstString(sources, ["agentName", "agentNickname", "subagentName", "subAgentName", "name", "displayName"]) ??
    firstString(sources, ["agentPath"]);
  const agentRole = firstString(sources, ["agentRole", "role"]);
  const rawStatus = firstString(sources, ["agentStatus", "subagentStatus", "subAgentStatus", "status", "kind"]);
  const agentStatus = markCompleted && agentId ? "completed" : rawStatus ? normalizeAgentItemStatus(rawStatus) : undefined;
  const metadata: Partial<WorkbenchItem> = {};
  if (agentId) {
    metadata.agentId = agentId;
  }
  if (agentThreadId) {
    metadata.agentThreadId = agentThreadId;
  }
  if (agentName) {
    metadata.agentName = agentName;
  }
  if (agentRole) {
    metadata.agentRole = agentRole;
  }
  if (agentStatus) {
    metadata.agentStatus = agentStatus;
  }
  return metadata;
}

function mergeAgentItemMetadata(existing: WorkbenchItem, next: Partial<WorkbenchItem>): Partial<WorkbenchItem> {
  return {
    agentId: next.agentId ?? existing.agentId,
    agentThreadId: next.agentThreadId ?? existing.agentThreadId,
    agentName: next.agentName ?? existing.agentName,
    agentRole: next.agentRole ?? existing.agentRole,
    agentStatus: next.agentStatus ?? existing.agentStatus
  };
}

function firstString(records: Array<Record<string, unknown>>, keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = stringValue(record[key]);
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function normalizeAgentItemStatus(value: string): string {
  switch (value) {
    case "started":
    case "interacted":
    case "inProgress":
    case "pendingInit":
      return "running";
    case "errored":
      return "failed";
    default:
      return value;
  }
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

function summarizeJsonValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}


export async function fetchUsageSummary(
  token: string,
  options?: { days?: number; userId?: string }
): Promise<UsageSummary> {
  const params = new URLSearchParams();
  if (options?.days) params.set("days", String(options.days));
  if (options?.userId) params.set("userId", options.userId);
  const qs = params.toString() ? `?${params}` : "";
  const response = await fetch(`/api/usage/summary${qs}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load usage summary: ${response.status}`);
  }
  const body = (await response.json()) as { data: UsageSummary };
  return body.data;
}

export async function fetchUsageLedger(
  token: string,
  options?: { limit?: number; userId?: string }
): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.userId) params.set("userId", options.userId);
  const qs = params.toString() ? `?${params}` : "";
  const response = await fetch(`/api/usage/ledger${qs}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load usage ledger: ${response.status}`);
  }
  const body = (await response.json()) as { data: Array<Record<string, unknown>> };
  return body.data ?? [];
}

export type GatewayOverview = {
  total: number; okCount: number; failCount: number; pendingCount: number;
  today: number; thisWeek: number; thisMonth: number;
};

export type GatewayDailyCount = { date: string; count: number; okCount: number; failCount: number };

export type GatewayDimensionRow = {
  name: string; providerId?: string; count: number; okCount: number; failCount: number;
};

export type GatewayRequestRecord = {
  id: string; ownerId: string; threadId?: string; turnId?: string;
  endpoint: string; providerId: string; groupId: string; model?: string; stream: boolean;
  upstreamStatus?: number; ok?: boolean; error?: string;
  status?: "pending" | "processing" | "completed" | "failed" | "canceled";
  source?: "api" | "playground" | "test" | "direct" | "unknown";
  startedAt: number; headersAt?: number; ttftMs?: number; latencyMs?: number;
  tokens?: { total: number; input: number; output: number; cachedRead: number; cacheWrite: number; reasoning: number };
  costUsd?: number; costBreakdown?: { input: number; cachedInput: number; cacheWrite: number; output: number };
  tokensPerSecond?: number; cacheHitRate?: number;
  createdAt: number; updatedAt: number;
};

export type GatewayRequestPage = { entries: GatewayRequestRecord[]; nextCursor: string | null };

/** 对标 axonhub executions 状态统计：上游状态码分布；null 为未收到上游响应(pending/processing)。 */
export type GatewayStatusRow = {
  statusCode: number | null; count: number; okCount: number; failCount: number;
};

export async function fetchGatewayByStatus(
  token: string,
  options?: { days?: number; limit?: number; userId?: string }
): Promise<GatewayStatusRow[]> {
  const response = await fetch(`/api/gateway/by-status${gatewayParams({ days: options?.days, limit: options?.limit, userId: options?.userId })}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway status breakdown: ${response.status}`);
  }
  const body = (await response.json()) as { data: GatewayStatusRow[] };
  return body.data ?? [];
}

/** 通道健康摘要（只读；自动禁用另起任务）。 */
export type GatewayHealthRow = {
  name: string; requestCount: number; okCount: number; failCount: number;
  successRate: number; status: "healthy" | "degraded" | "down" | "unknown";
};

export async function fetchGatewayHealth(
  token: string,
  options?: { days?: number; limit?: number; userId?: string }
): Promise<GatewayHealthRow[]> {
  const response = await fetch(`/api/gateway/health${gatewayParams({ days: options?.days, limit: options?.limit, userId: options?.userId })}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway health: ${response.status}`);
  }
  const body = (await response.json()) as { data: GatewayHealthRow[] };
  return body.data ?? [];
}

function gatewayParams(options: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchGatewayOverview(
  token: string,
  options?: { days?: number; userId?: string }
): Promise<{ overview: GatewayOverview; daily: GatewayDailyCount[] }> {
  const response = await fetch(`/api/gateway/overview${gatewayParams({ days: options?.days, userId: options?.userId })}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway overview: ${response.status}`);
  }
  const body = (await response.json()) as { data: { overview: GatewayOverview; daily: GatewayDailyCount[] } };
  return body.data;
}

export async function fetchGatewayBy(
  token: string,
  options: { dimension: "provider" | "group" | "model" | "endpoint"; days?: number; limit?: number; userId?: string }
): Promise<GatewayDimensionRow[]> {
  const response = await fetch(`/api/gateway/by${gatewayParams({ dimension: options.dimension, days: options.days, limit: options.limit, userId: options.userId })}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway breakdown: ${response.status}`);
  }
  const body = (await response.json()) as { data: GatewayDimensionRow[] };
  return body.data ?? [];
}

export async function fetchGatewayRequests(
  token: string,
  options?: {
    limit?: number; cursor?: string; providerId?: string; groupId?: string; model?: string;
    ok?: boolean; status?: string; source?: string; threadId?: string; endpoint?: string; userId?: string;
  }
): Promise<GatewayRequestPage> {
  const response = await fetch(`/api/gateway/requests${gatewayParams({
    limit: options?.limit, cursor: options?.cursor, providerId: options?.providerId,
    groupId: options?.groupId, model: options?.model,
    ...(options?.ok === true ? { ok: "true" } : options?.ok === false ? { ok: "false" } : {}),
    status: options?.status, source: options?.source,
    threadId: options?.threadId, endpoint: options?.endpoint, userId: options?.userId,
  })}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway requests: ${response.status}`);
  }
  const body = (await response.json()) as { data: GatewayRequestPage };
  return body.data ?? { entries: [], nextCursor: null };
}

export type UsageTokenBucket = {
  input: number; output: number; cached: number; total: number; cost: number; count: number;
  cachedRead?: number; cacheWrite?: number; reasoning?: number;
  costBreakdown?: { input: number; cachedInput: number; cacheWrite: number; output: number };
};

export type UsageTokenSummary = {
  all: UsageTokenBucket; month: UsageTokenBucket; week: UsageTokenBucket; day: UsageTokenBucket;
};

export type UsageTokenDaily = UsageTokenBucket & { date: string };

export type UsageTokenDimensionRow = UsageTokenBucket & { name: string; providerId?: string };

export async function fetchGatewayTokensSummary(
  token: string,
  options?: { userId?: string }
): Promise<UsageTokenSummary> {
  const response = await fetch(`/api/gateway/tokens/summary${gatewayParams({ userId: options?.userId })}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway token summary: ${response.status}`);
  }
  const body = (await response.json()) as { data: UsageTokenSummary };
  return body.data;
}

export async function fetchGatewayTokensDaily(
  token: string,
  options?: { days?: number; userId?: string }
): Promise<UsageTokenDaily[]> {
  const response = await fetch(`/api/gateway/tokens/daily${gatewayParams({ days: options?.days, userId: options?.userId })}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway token daily: ${response.status}`);
  }
  const body = (await response.json()) as { data: UsageTokenDaily[] };
  return body.data ?? [];
}

export async function fetchGatewayTokensBy(
  token: string,
  options: { dimension: "provider" | "group" | "model" | "owner"; days?: number; limit?: number; userId?: string }
): Promise<UsageTokenDimensionRow[]> {
  const response = await fetch(`/api/gateway/tokens/by${gatewayParams({ dimension: options.dimension, days: options.days, limit: options.limit, userId: options.userId })}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway token breakdown: ${response.status}`);
  }
  const body = (await response.json()) as { data: UsageTokenDimensionRow[] };
  return body.data ?? [];
}

export type AnalyticsOverview = UsageTokenBucket & { uncachedInput: number; cacheHitRate: number };
export type AnalyticsDailyRow = UsageTokenBucket & { date: string; uncachedInput: number };
export type AnalyticsDimensionRow = UsageTokenDimensionRow & { uncachedInput: number };

export async function fetchGatewayAnalytics(
  token: string,
  options: {
    mode: "overview" | "daily" | "dimension";
    dimension?: "provider" | "group" | "model" | "owner";
    startDate?: string; endDate?: string;
    providerId?: string; groupId?: string; model?: string; ownerId?: string; userId?: string;
    limit?: number;
  }
): Promise<unknown> {
  const response = await fetch(`/api/gateway/analytics${gatewayParams({
    mode: options.mode, dimension: options.dimension,
    startDate: options.startDate, endDate: options.endDate,
    providerId: options.providerId, groupId: options.groupId, model: options.model,
    ownerId: options.ownerId, userId: options.userId, limit: options.limit,
  })}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway analytics: ${response.status}`);
  }
  const body = (await response.json()) as { data: unknown };
  return body.data;
}

export async function fetchGatewayAnalyticsOverview(
  token: string,
  options: {
    startDate?: string; endDate?: string;
    providerId?: string; groupId?: string; model?: string; ownerId?: string; userId?: string;
  }
): Promise<AnalyticsOverview> {
  return fetchGatewayAnalytics(token, { ...options, mode: "overview" }) as Promise<AnalyticsOverview>;
}

export async function fetchGatewayAnalyticsDaily(
  token: string,
  options: {
    startDate?: string; endDate?: string;
    providerId?: string; groupId?: string; model?: string; ownerId?: string; userId?: string;
  }
): Promise<AnalyticsDailyRow[]> {
  return fetchGatewayAnalytics(token, { ...options, mode: "daily" }) as unknown as Promise<AnalyticsDailyRow[]>;
}

export async function fetchGatewayAnalyticsDimension(
  token: string,
  options: {
    dimension: "provider" | "group" | "model" | "owner";
    startDate?: string; endDate?: string;
    providerId?: string; groupId?: string; model?: string; ownerId?: string; userId?: string;
    limit?: number;
  }
): Promise<AnalyticsDimensionRow[]> {
  return fetchGatewayAnalytics(token, { ...options, mode: "dimension" }) as unknown as Promise<AnalyticsDimensionRow[]>;
}

export type GatewayPerformanceRow = {
  name: string; providerId?: string; requestCount: number;
  avgLatencyMs: number; avgTtftMs: number; totalLatencyMs: number;
  /** 有界样本分位（后端新增；旧缓存缺失时为 undefined，前端按 — 处理）。 */
  p50LatencyMs?: number; p95LatencyMs?: number;
  tokensTotal: number; throughput: number; confidence: "high" | "medium" | "low";
};

export async function fetchGatewayPerformance(
  token: string,
  options: { dimension: "provider" | "model"; days?: number; limit?: number; userId?: string }
): Promise<GatewayPerformanceRow[]> {
  const response = await fetch(`/api/gateway/performance${gatewayParams({
    dimension: options.dimension, days: options.days, limit: options.limit, userId: options.userId,
  })}`, {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    throw new Error(`Failed to load gateway performance: ${response.status}`);
  }
  const body = (await response.json()) as { data: GatewayPerformanceRow[] };
  return body.data ?? [];
}


export async function changeOwnPassword(
  token: string,
  input: {
    currentPassword: string;
    newPassword: string;
    captchaId: string;
    captchaAnswer: string;
  }
): Promise<AuthUser> {
  const response = await fetch("/api/me/password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as { data?: AuthUser; error?: string };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Password change failed (${response.status})`);
  }
  if (!body.data) {
    throw new Error("Password change failed");
  }
  return body.data;
}

export type LaunchEnvValues = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

export type LaunchAdapterStatus = {
  id: string;
  repo: string;
  cloneUrl: string | null;
  cloneable: boolean;
  installed: boolean;
  wrapperPath: string | null;
  productCliPath: string | null;
  productCliPresent: boolean;
  sourceDir: string | null;
  sourcePresent: boolean;
  envPath: string;
  envPresent: boolean;
  envConfigured: boolean;
  envPreview: { baseUrl: string | null; model: string | null; hasApiKey: boolean };
  needsInstall: boolean;
  needsSetup?: boolean;
};

export type LaunchAdaptersDetectResponse = {
  sourceRoot: string;
  adapters: LaunchAdapterStatus[];
};

export type InstallLaunchResultItem = {
  id: string;
  ok: boolean;
  steps: string[];
  error?: string;
  status?: LaunchAdapterStatus;
};

export async function fetchLaunchAdapters(token: string): Promise<LaunchAdaptersDetectResponse> {
  const response = await fetch("/api/launch-adapters", {
    headers: { "x-codex-ui-token": token }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Failed to detect launch adapters: ${response.status}`);
  }
  return (await response.json()) as LaunchAdaptersDetectResponse;
}

export async function installLaunchAdapters(
  token: string,
  input: {
    ids?: string[];
    missingOnly?: boolean;
    skipCli?: boolean;
    envMode?: "shared" | "separate" | "none";
    sharedEnv?: LaunchEnvValues;
    separateEnv?: Record<string, LaunchEnvValues>;
    forceEnv?: boolean;
    sourceRoot?: string;
    skipModelTest?: boolean;
  },
  onProgress?: (logs: Array<{ time: string; text: string; level: "info" | "success" | "error" | "warn" }>) => void
): Promise<{ results: InstallLaunchResultItem[]; adapters: LaunchAdapterStatus[] }> {
  const response = await fetch("/api/launch-adapters/install", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as {
    jobId?: string;
    results?: InstallLaunchResultItem[];
    adapters?: LaunchAdapterStatus[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || `Install failed: ${response.status}`);
  }

  if (body.results) {
    return {
      results: body.results,
      adapters: body.adapters ?? []
    };
  }

  if (!body.jobId) {
    throw new Error("Server did not return a valid installation job ID.");
  }

  const jobId = body.jobId;
  const maxWaitMs = 600_000; // 10 min timeout
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 350));
    const statusResp = await fetch(`/api/launch-adapters/job-status?jobId=${encodeURIComponent(jobId)}`, {
      headers: { "x-codex-ui-token": token }
    });
    if (!statusResp.ok) {
      continue;
    }
    const statusData = (await statusResp.json().catch(() => ({}))) as {
      status?: "running" | "completed" | "failed";
      progressStep?: string;
      logs?: Array<{ time: string; text: string; level: "info" | "success" | "error" | "warn" }>;
      results?: InstallLaunchResultItem[];
      adapters?: LaunchAdapterStatus[];
      error?: string;
    };

    if (statusData.logs && statusData.logs.length) {
      onProgress?.(statusData.logs);
    }

    if (statusData.status === "completed") {
      return {
        results: statusData.results ?? [],
        adapters: statusData.adapters ?? []
      };
    }
    if (statusData.status === "failed") {
      throw new Error(statusData.error || "Installation job failed on server.");
    }
  }

  throw new Error("Installation job timed out after 10 minutes.");
}

export async function writeLaunchAdapterEnvs(
  token: string,
  input: {
    mode: "shared" | "separate";
    ids?: string[];
    sharedEnv?: LaunchEnvValues;
    separateEnv?: Record<string, LaunchEnvValues>;
    force?: boolean;
  }
): Promise<{
  results: Array<{ id: string; ok: boolean; path: string; wrote: boolean; error?: string }>;
  adapters: LaunchAdapterStatus[];
}> {
  const response = await fetch("/api/launch-adapters/env", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(input)
  });
  const body = (await response.json().catch(() => ({}))) as {
    results?: Array<{ id: string; ok: boolean; path: string; wrote: boolean; error?: string }>;
    adapters?: LaunchAdapterStatus[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || `Write env failed: ${response.status}`);
  }
  return {
    results: body.results ?? [],
    adapters: body.adapters ?? []
  };
}

export async function testLaunchAdapterModel(
  token: string,
  env: LaunchEnvValues
): Promise<{ ok: boolean; step1Ok?: boolean; step2Ok?: boolean; message: string; statusCode?: number }> {
  const response = await fetch("/api/launch-adapters/test-model", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-codex-ui-token": token
    },
    body: JSON.stringify(env)
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    step1Ok?: boolean;
    step2Ok?: boolean;
    message?: string;
    statusCode?: number;
  };
  return {
    ok: body.ok ?? response.ok,
    step1Ok: body.step1Ok,
    step2Ok: body.step2Ok,
    message: body.message || (response.ok ? "Test succeeded" : `HTTP ${response.status}`),
    statusCode: body.statusCode ?? response.status
  };
}



