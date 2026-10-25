export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export { normalizeTokenUsage, type NormalizedTokenUsage, type TokenUsageBreakdown, type TokenUsageSource } from "./tokenUsage.js";
export { DEFAULT_TOKEN_USAGE_RATES, priceNormalizedTokenUsage, resolveTokenUsageRate, type PricedTokenUsage, type TokenUsageBillingSnapshot, type TokenUsageRate } from "./tokenPricing.js";

export type JsonRpcId = string | number;

import type { ModelCapabilityDescriptor } from "./modelCapabilities.js";

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: JsonValue;
}

export interface JsonRpcNotification {
  method: string;
  params?: JsonValue;
}

export interface JsonRpcSuccess {
  id: JsonRpcId;
  result: JsonValue;
}

export interface JsonRpcFailure {
  id: JsonRpcId;
  error: {
    code?: number;
    message: string;
    data?: JsonValue;
  };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcFailure;

export type EnginePhase =
  | "idle"
  | "starting"
  | "ready"
  | "stopped"
  | "error"
  | "reconnecting"
  | "degraded"
  | "incompatible";

export interface EngineStatus {
  phase: EnginePhase;
  transport?: "stdio" | "daemon-unix";
  realtimeSync?: "available" | "degraded" | "unavailable";
  connectionEpoch?: number;
  daemonPid?: number;
  codexBin?: string;
  codexVersion?: string;
  appServerUserAgent?: string;
  codexHome?: string;
  message?: string;
  startedAt?: number;
}

export interface SystemCpuMetrics {
  usagePercent: number;
  cores: number;
  model: string;
  loadAvg: [number, number, number];
}

export interface SystemMemoryMetrics {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
  swapTotalBytes?: number;
  swapUsedBytes?: number;
  swapUsagePercent?: number;
}

export interface SystemDiskMetrics {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
  mountPoint: string;
}

export interface SystemHostMetrics {
  hostname: string;
  platform: string;
  arch: string;
  uptimeSec: number;
}

export interface ApplicationProcessMetrics {
  cpuUsagePercent: number;
  memoryBytes: number;
  processCount: number;
  includesCodexCli: boolean;
}

export interface SystemMetrics {
  timestamp: number;
  cpu: SystemCpuMetrics;
  memory: SystemMemoryMetrics;
  disk: SystemDiskMetrics;
  host: SystemHostMetrics;
  application: ApplicationProcessMetrics;
}

export type AuthUserRole = "admin" | "user";
export type AuthUserStatus = "active" | "disabled";

export type PermissionPresetId =
  | "readonlyAsk"
  | "workspaceAsk"
  | "fullAsk"
  | "dangerBypass";

export interface MemberCapabilities {
  maxPermission: PermissionPresetId;
  allowWrite: boolean;
  allowNetwork: boolean;
  allowDangerBypass: boolean;
  workspaceRoot: string;
}

export interface AuthUser extends MemberCapabilities {
  id: string;
  email: string;
  username: string;
  role: AuthUserRole;
  status: AuthUserStatus;
  balance: number;
  concurrency: number;
  notes?: string;
  /** Whether Google Authenticator (TOTP) is enabled for this account. */
  totpEnabled?: boolean;
  /** Relay / provider IDs this member may use. Empty = none (admins always all). */
  allowedProviderIds?: string[];
}

export interface SystemAuthSettings {
  registrationEnabled: boolean;
  captchaEnabled: boolean;
  totpEnabled: boolean;
  forceAdminTotp: boolean;
  defaultMemberBalance: number;
  defaultMemberConcurrency: number;
  updatedAt: number;
}

export interface PublicAuthConfig {
  registrationEnabled: boolean;
  captchaEnabled: boolean;
  totpEnabled: boolean;
}

export interface CaptchaChallenge {
  id: string;
  svg: string;
  /** Human-readable challenge text (e.g. "7 + 3 = ?") for accessibility fallbacks. */
  prompt?: string;
  expiresAt: number;
}

export interface AuthSession {
  authenticated?: boolean;
  token: string;
  user: AuthUser | null;
  expiresAt?: number;
  loginRequired?: boolean;
  websocket?: WebSocketRuntimeConfig;
  legalConsent?: LegalConsentStatus;
  desktopTrustedLocal?: boolean;
  desktopRuntime?: DesktopRuntimeInfo;
}

export interface DesktopRuntimeInfo {
  platform: string;
  codexAvailable: boolean;
  codexInstallCommand: string;
  codexInstallDirectory?: string;
}

export type LegalPolicyLanguage = "cn" | "en";

export interface LegalConsentStatus {
  required: boolean;
  version: string;
  minReadSeconds: number;
  acceptedAt?: number;
  language?: LegalPolicyLanguage;
}

export interface LegalPolicyDocument {
  id: "privacy" | "terms" | "license" | "thirdParty" | "legal" | "readme";
  title: string;
  file: string;
  content: string;
}

export interface LegalPolicyBundle {
  version: string;
  language: LegalPolicyLanguage;
  updatedAt: number;
  minReadSeconds: number;
  reviewStartedAt: number;
  serverNow: number;
  documents: LegalPolicyDocument[];
}

export type WebSocketRuntimeProfile = "desktop" | "server" | "public";

export interface WebSocketRuntimeConfig {
  profile: WebSocketRuntimeProfile;
  platform?: string;
  path: string;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  handshakeTimeoutMs: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
}

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApprovalPolicy = "on-request" | "never";
export type CodexSandboxPolicy =
  | { type: "readOnly"; networkAccess: boolean }
  | {
      type: "workspaceWrite";
      writableRoots: string[];
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    }
  | { type: "dangerFullAccess" };

export interface PermissionPreset {
  id: PermissionPresetId;
  label: string;
  description: string;
  sandbox: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
  severity: "normal" | "warning" | "critical";
}

export const DANGER_CONFIRMATION = "BYPASS";

export const permissionPresets: PermissionPreset[] = [
  {
    id: "readonlyAsk",
    label: "Read-only + ask",
    description: "Analyze and inspect files. Writes and risky actions require changing permissions.",
    sandbox: "read-only",
    approvalPolicy: "on-request",
    severity: "normal"
  },
  {
    id: "workspaceAsk",
    label: "Workspace write + ask",
    description: "Default. Allows workspace edits while commands, network, and extra paths request approval.",
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    severity: "normal"
  },
  {
    id: "fullAsk",
    label: "Full access + ask",
    description: "Allows broad filesystem access, while still asking before sensitive actions.",
    sandbox: "danger-full-access",
    approvalPolicy: "on-request",
    severity: "warning"
  },
  {
    id: "dangerBypass",
    label: "Safe bypass with full access",
    description: "Full local access without per-action approval prompts; configured command safeguards remain active.",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    severity: "critical"
  }
];

export function permissionToTurnOverrides(id: PermissionPresetId, cwd: string, additionalRoots: string[] = []): {
  sandbox: CodexSandboxMode;
  sandboxPolicy: CodexSandboxPolicy;
  approvalPolicy: CodexApprovalPolicy;
} {
  const preset = permissionPresets.find((entry) => entry.id === id);
  if (!preset) {
    throw new Error(`Unknown permission preset: ${id}`);
  }
  return {
    sandbox: preset.sandbox,
    sandboxPolicy: sandboxModeToPolicy(preset.sandbox, cwd, additionalRoots),
    approvalPolicy: preset.approvalPolicy
  };
}

function sandboxModeToPolicy(sandbox: CodexSandboxMode, cwd: string, additionalRoots: string[]): CodexSandboxPolicy {
  switch (sandbox) {
    case "read-only":
      return { type: "readOnly", networkAccess: false };
    case "workspace-write":
      return {
        type: "workspaceWrite",
        writableRoots: [cwd, ...additionalRoots.filter((root) => root && root !== cwd)],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false
      };
    case "danger-full-access":
      return { type: "dangerFullAccess" };
  }
}

export interface TieredContextRatio {
  minTokens: number;
  maxTokens: number | null; // null = infinity
  ratio: number;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  cacheReadUsdPerMillion?: number;
}

export type RelayResponseProtocol = "openai-response" | "openai" | "anthropic" | "gemini";

export type RelayResponseProtocolMode = "fixed" | "model_auto";

export type RelayAuthType = "none" | "inherit" | "bearer" | "anthropic" | "google_api_key" | "google_query_key";

export type RelayCredentialMode = "provider" | "group";

export interface RelayCatalogModel {
  model_name: string;
  icon?: string;
  vendor_id?: number;
  quota_type: 0 | 1;
  model_ratio?: number;
  model_price?: number;
  completion_ratio?: number;
  cache_ratio?: number;
  create_cache_ratio?: number;
  owner_by?: string;
  enable_groups: string[];
  supported_endpoint_types: string[];
  extensions?: Record<string, JsonValue>;
}

export interface RelayCatalogVendor {
  id: number;
  name: string;
  icon?: string;
  extensions?: Record<string, JsonValue>;
}

export interface RelayCatalogEndpoint {
  path: string;
  method: string;
  aliases?: string[];
  extensions?: Record<string, JsonValue>;
}

export interface RelayCapabilityCatalog {
  schema: "codex-react-ui.relay-catalog.v1";
  success: boolean;
  auto_groups: string[];
  data: RelayCatalogModel[];
  group_ratio: Record<string, number>;
  usable_group: Record<string, string>;
  supported_endpoint: Record<string, RelayCatalogEndpoint>;
  vendors: RelayCatalogVendor[];
  imported_at: number;
  source_hash: string;
  warnings: string[];
  extensions?: Record<string, JsonValue>;
}

export interface RelayCatalogImportPreview {
  provider_id: string;
  counts: {
    models: number;
    groups: number;
    vendors: number;
    endpoints: number;
  };
  changes: {
    add: number;
    update: number;
    remove: number;
    unchanged: number;
  };
  groups: ChannelGroupConfig[];
  warnings: string[];
  catalog: RelayCapabilityCatalog;
}

export interface RelayCatalogImportResult extends RelayCatalogImportPreview {
  provider: ProviderConfig;
  mode: "merge" | "replace";
}

export interface ChannelGroupConfig {
  id: string;
  name: string;
  baseUrl?: string;
  kind?: "text" | "image";
  /** Independent capabilities. This allows mixed text + image relay groups. */
  capabilities?: {
    text?: boolean;
    imageGeneration?: boolean;
    imageEdits?: boolean;
  };
  status?: "enabled" | "disabled";
  groupRatio: number;
  /** Optional per-group maximum usage quota in USD (null/undefined = unlimited). */
  quotaUsd?: number | null;
  /** Current accumulated group usage in USD. */
  usedQuotaUsd?: number;
  /** new-api-style routing priority; higher values are selected first. */
  priority?: number;
  /** new-api-style weighted random routing weight inside the same priority bucket. */
  weight?: number;
  /** Multi-key selection rule for this group. */
  keyMode?: "single" | "random" | "polling";
  /** Models configured for this group. Empty until fetched or entered manually. */
  models?: string[];
  /** Catalog endpoint capabilities available across models in this group. */
  supportedEndpointTypes?: string[];
  /** Default upstream conversation protocol for this group. */
  responseProtocol?: RelayResponseProtocol;
  /** Fixed protocol or per-model automatic protocol selection. */
  responseProtocolMode?: RelayResponseProtocolMode;
  /** Simulate Claude Code request headers for Anthropic protocol gateways. Defaults to false. */
  claudeCodeHeadersEnabled?: boolean;
  /** Claude Code version used in the simulated User-Agent. */
  claudeCodeVersion?: string;
  /**
   * Whether OpenAI-compatible translate-path requests carry a stable
   * `prompt_cache_key` so the upstream can keep its prompt prefix cached across
   * turns inside one conversation. `"auto"` (default) injects only when the
   * resolved upstream is known to accept the field; `"enabled"` always injects;
   * `"disabled"` never injects. Direct passthrough is never affected.
   */
  promptCacheRouting?: "auto" | "enabled" | "disabled";
  /** Optional path override applied after the provider base URL. */
  endpointPathOverride?: string;
  /** Authentication header/query convention used by the upstream endpoint. */
  authType?: RelayAuthType;
  /** Whether this group uses the provider credential or its own key list. */
  credentialMode?: RelayCredentialMode;
  /** Exact source group name when generated from a capability catalog. */
  catalogGroupName?: string;
  /** Marks groups managed by a capability catalog import. */
  catalogManaged?: boolean;
  /** Image generation settings for image groups. */
  image?: {
    generations?: boolean;
    edits?: boolean;
    defaultModel?: string;
    protocols?: ImageGenerationProtocol[];
    defaultProtocol?: ImageGenerationProtocol;
    modelPrices?: Array<{ model: string; usdPerImage: number }>;
    billing?: ImageBilling;
    availability?: "available" | "constrained" | "unavailable";
    notice?: string;
  };
  /** Optional per-group upstream model rewrite rules. */
  modelMapping?: Array<{ from: string; to: string }>;
  /**
   * Optional per-group upstream model rewrite rules. Unlike `modelMapping`,
   * an advanced rule can re-dispatch the request to a different channel
   * (provider) and/or a different group, sending the configured real model
   * to that target's upstream. Rules are matched by `requestModel` (the model
   * name the client requested). When `targetProviderId`/`targetGroupId` are
   * omitted, the rule falls back to the same in-group rewrite behaviour and
   * only the model string is changed (targetModel logged but no re-dispatch).
   */
  advancedModelMapping?: AdvancedModelMappingRule[];
  /** Optional per-group upstream status-code rewrite rules. */
  statusCodeMapping?: Array<{ from: number; to: number }>;
  tag?: string;
  remark?: string;
  autoBan?: boolean;
  requestLimit?: number;
  requestIntervalSeconds?: number;
  /** Per-group Codex context window override. Zero/undefined uses the model default. */
  contextWindow?: number;
  /** Capabilities discovered from the upstream model directory, keyed by model id. */
  modelCapabilities?: Record<string, ModelCapabilityDescriptor>;
  /** Whether the built-in destructive command blacklist is enforced for this group. Defaults to true. */
  commandBlacklistEnabled?: boolean;
  /** Additional case-insensitive command fragments blocked by this group. Built-ins cannot be removed. */
  commandBlacklist?: string[];
  /** Deno-style external network URL allowlist for non-search HTTP commands. Empty means deny all. */
  networkAllowlist?: string[];
  keys: string[];
  enableFallback?: boolean;
  fallbackChannelId?: string;
  fallbackGroupName?: string;
  enableTieredContext?: boolean;
  tieredContextRatios?: TieredContextRatio[];
}

export type StationType = "third_party" | "rich" | "charity" | "official";

/**
 * Advanced cross-channel model mapping rule. Compiled from the per-group
 * "advanced mapping" editor. When a request's model matches `requestModel`,
 * the relay gateway re-dispatches to `targetProviderId`/`targetGroupId`
 * (if specified) and sends `targetModel` to that target's upstream.
 */
export interface AdvancedModelMappingRule {
  /** Model name the client requests (the "from"). */
  requestModel: string;
  /** Id of the target channel/provider to dispatch to. Omit = same provider. */
  targetProviderId?: string;
  /** Id of the target group to dispatch to. Omit = same group. */
  targetGroupId?: string;
  /** Real model name to send upstream (the "to"). */
  targetModel: string;
  /** Optional free-form label shown only in the UI. */
  label?: string;
  /** Disabled rules are never matched. Defaults to enabled. */
  enabled?: boolean;
}

export type ImageGenerationProtocol =
  | "openaiImages"
  | "openaiImageEdits"
  | "geminiChatCompletions"
  | "geminiGenerateContent"
  | "deepkeyAsyncVideos";

export type ImageBilling =
  | { mode: "per_image"; usdPerImage: number; currency?: "USD" }
  | { mode: "token_multiplier"; multiplier: number; currency?: "USD" };

export interface ProviderConfig {
  id: string;
  kind: "chatgpt" | "openai" | "responsesRelay" | "ollama" | "lmstudio" | "bedrock";
  name: string;
  serviceProvider?: {
    id: string;
    name: string;
    logo?: string;
  };
  baseUrl?: string;
  apiKeyRef?: string;
  apiKeyPreview?: string;
  apiKeyStorage?: "database" | "keyring" | "memory" | "none";
  defaultModel?: string;
  /** Maximum retries after an interrupted response stream. Codex defaults to 5. */
  streamMaxRetries?: number;
  image?: {
    generations?: boolean;
    edits?: boolean;
    defaultModel?: string;
    protocols?: ImageGenerationProtocol[];
    defaultProtocol?: ImageGenerationProtocol;
    apiKey?: string;
    modelPrices?: Array<{ model: string; usdPerImage: number }>;
    billing?: ImageBilling;
    availability?: "available" | "constrained" | "unavailable";
    notice?: string;
  };
  nativeModels: string[];
  modelAliases: Array<{
    alias: string;
    model: string;
  }>;
  /** Optional UI-only labels keyed by the real model id. Never used for request routing. */
  modelDisplayNames?: Record<string, string>;
  modelRates?: Array<{
    model: string;
    inputUsdPerMillion?: number;
    cachedInputUsdPerMillion?: number;
    cacheWriteUsdPerMillion?: number;
    outputUsdPerMillion?: number;
    multiplier: number;
    inputMultiplier?: number;
    cacheReadMultiplier?: number;
    cacheWriteMultiplier?: number;
    outputMultiplier?: number;
  }>;
  /** Imported New API-style model, group, vendor, pricing and endpoint catalog. */
  capabilityCatalog?: RelayCapabilityCatalog;
  /** Remote New API-style pricing endpoint used to refresh the capability catalog. */
  capabilityCatalogUrl?: string;
  /** Relay Channel Mode: "fast" (default) or "advanced" */
  channelMode?: "fast" | "advanced";
  /** Multi-group configuration for advanced mode */
  groups?: ChannelGroupConfig[];
  /** Total quota / max usage quota in USD (null/undefined = unlimited) */
  quotaUsd?: number | null;
  /** Current accumulated usage in USD */
  usedQuotaUsd?: number;
  /** Station Type Tag: "third_party" (default), "rich", "charity", "official" */
  stationType?: StationType;
  /** For Charity Station (公益站): Enable daily check-in feature */
  enableCheckin?: boolean;
  /** For Charity Station (公益站): Daily check-in reminder (default: true, once per day) */
  remindCheckin?: boolean;
  /** Free-form notes for the relay/channel, shown in list/detail views. */
  remark?: string;
  /** Marks a relay imported through Codex Ultra's encrypted sharing format. */
  sharedImport?: {
    source: "codex-ultra-share";
    importedAt: number;
  };
  /** Soft-delete timestamp. Trashed relays remain persisted until restored. */
  trashedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderActivation {
  providerId: string;
  modelProvider: string;
  model?: string;
  groupId?: string;
  groupName?: string;
  groupKind?: ChannelGroupConfig["kind"];
  responseProtocol?: RelayResponseProtocol;
  restartedAt: number;
}

export interface UiProfile {
  schema: "codex-react-ui.profile.v1";
  exportedAt: number;
  providers: ProviderConfig[];
}

export interface UiProfileImportResult {
  importedProviders: number;
  providers: ProviderConfig[];
}

export interface RelayConfigBundle {
  schema: "codex-react-ui.relay-config.v1";
  exportedAt: number;
  includesSecrets: true;
  providers: ProviderConfig[];
}

export interface RelayBackupBundle {
  schema: "codex-react-ui.relay-backup.v1";
  exportedAt: number;
  includesSecrets: true;
  providers: ProviderConfig[];
  providerSecrets: Array<{ providerId: string; apiKey: string }>;
}

export interface DangerousPermissionAuditEvent {
  id: string;
  createdAt: number;
  method: "thread/start" | "turn/start";
  severity: "warning" | "critical";
  reasons: string[];
  cwd?: string;
  threadId?: string;
  model?: string;
  approvalPolicy?: string;
  sandbox?: string;
  sandboxPolicyType?: string;
  inputSummary?: {
    items: number;
    textItems: number;
    imageItems: number;
    mentionItems: number;
  };
}

export interface ThreadSummary {
  id: string;
  preview?: string;
  model?: string;
  modelProvider?: string;
  cwd?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: string;
}


/** Which CLI backend a conversation uses. */
export type CliBackend = "codex" | "claude" | "auggie" | "agy" | "grok" | "pi" | "opencode" | "opencode-v2" | "mini" | "muse" | "cline" | "command-code";

/**
 * Feature flag for the Claude-compatible CLI runtime.
 * Default is enabled; setting the variable to 0, false, or no disables it.
 * and exposes it through /api/codex/settings/claude-compatible-cli.
 * When disabled, the server refuses to create or resolve Claude bridges,
 * and the UI hides the Claude backend selector.
 */
export const CLAUDE_COMPATIBLE_CLI_FLAG = "claude_compatible_cli" as const;

export interface ClaudeCompatibleCliSettings {
  enabled: boolean;
}

/**
 * Feature flag for the Antigravity (AGY) CLI runtime.
 * Default is true when agy.exe is discovered.
 */
export const AGY_COMPATIBLE_CLI_FLAG = "agy_compatible_cli" as const;

export interface AgyCompatibleCliSettings {
  enabled: boolean;
}

/**
 * Feature flag for the Auggie (Augment Code) CLI runtime.
 */
export const AUGGIE_COMPATIBLE_CLI_FLAG = "auggie_compatible_cli" as const;

export interface AuggieCompatibleCliSettings {
  enabled: boolean;
}

/**
 * Feature flag for the Cline CLI runtime.
 */
export const CLINE_COMPATIBLE_CLI_FLAG = "cline_compatible_cli" as const;

export interface ClineCompatibleCliSettings {
  enabled: boolean;
}

/**
 * Feature flag for the Command Code CLI runtime.
 */
export const COMMAND_CODE_COMPATIBLE_CLI_FLAG = "command_code_compatible_cli" as const;

export interface CommandCodeCompatibleCliSettings {
  enabled: boolean;
}

/**
 * Feature flag for the Grok CLI runtime.
 * Default is true when grok.exe is discovered.
 */
export const GROK_COMPATIBLE_CLI_FLAG = "grok_compatible_cli" as const;

export interface GrokCompatibleCliSettings {
  enabled: boolean;
}

export const PI_COMPATIBLE_CLI_FLAG = "pi_compatible_cli" as const;

export interface PiCompatibleCliSettings {
  enabled: boolean;
}

export const OPENCODE_COMPATIBLE_CLI_FLAG = "opencode_compatible_cli" as const;

export interface OpencodeCompatibleCliSettings {
  enabled: boolean;
}

/**
 * Feature flag for the Codex CLI backend.
 * Default is disabled; every non-Mini backend is an opt-in plugin.
 * Exposed through /api/codex/settings/codex-cli. When disabled, the UI
 * hides the Codex backend selector and the Settings Codex section is
 * inactive; explicit Codex requests fall back to the default backend.
 */
export const CODEX_COMPATIBLE_CLI_FLAG = "codex_compatible_cli" as const;

export interface CodexCompatibleCliSettings {
  enabled: boolean;
}

/**
 * Feature flag for the Muse (Meta) CLI runtime.
 * Default is disabled; every non-Mini backend is an opt-in plugin.
 * Exposed through /api/codex/settings/muse-cli.
 */
export const MUSE_COMPATIBLE_CLI_FLAG = "muse_compatible_cli" as const;

export interface MuseCompatibleCliSettings {
  enabled: boolean;
}


export type SaVmDeletePolicy = "deny" | "rename" | "move";
export type SaVmFsAccess = "read" | "write" | "deny";

/** Codex-style filesystem rule. More specific rules override broad rules; deny wins ties. */
export interface SaVmFsEntry {
  path: string;
  access: SaVmFsAccess;
}

export interface SaVmProcessExecRule {
  path: string;
  args?: string[];
}

/** Fixed, server-owned Bun checks that may be enabled per VM thread. */
export type SaVmBunProfile =
  | "shared-typecheck"
  | "protocol-typecheck"
  | "server-typecheck"
  | "web-typecheck"
  | "free-key-typecheck"
  | "root-typecheck"
  | "shared-build"
  | "web-build"
  | "server-test-file"
  | "web-test-file"
  | "shared-test-file";

export const ALL_SA_VM_BUN_PROFILES: readonly SaVmBunProfile[] = [
  "shared-typecheck",
  "protocol-typecheck",
  "server-typecheck",
  "web-typecheck",
  "free-key-typecheck",
  "root-typecheck",
  "shared-build",
  "web-build",
  "server-test-file",
  "web-test-file",
  "shared-test-file"
] as const;

export const SA_VM_BUN_PROFILE_GROUPS: {
  typecheck: Array<{ id: SaVmBunProfile; label: string; labelKey: string }>;
  build: Array<{ id: SaVmBunProfile; label: string; labelKey: string }>;
  test: Array<{ id: SaVmBunProfile; label: string; labelKey: string }>;
} = {
  typecheck: [
    { id: "shared-typecheck", label: "Shared", labelKey: "vm.profile.shared-typecheck" },
    { id: "protocol-typecheck", label: "Protocol", labelKey: "vm.profile.protocol-typecheck" },
    { id: "server-typecheck", label: "Server", labelKey: "vm.profile.server-typecheck" },
    { id: "web-typecheck", label: "Web", labelKey: "vm.profile.web-typecheck" },
    { id: "free-key-typecheck", label: "Free-key", labelKey: "vm.profile.free-key-typecheck" },
    { id: "root-typecheck", label: "All (Root)", labelKey: "vm.profile.root-typecheck" }
  ],
  build: [
    { id: "shared-build", label: "Shared build", labelKey: "vm.profile.shared-build" },
    { id: "web-build", label: "Web build", labelKey: "vm.profile.web-build" }
  ],
  test: [
    { id: "server-test-file", label: "Server test file", labelKey: "vm.profile.server-test-file" },
    { id: "web-test-file", label: "Web test file", labelKey: "vm.profile.web-test-file" },
    { id: "shared-test-file", label: "Shared test file", labelKey: "vm.profile.shared-test-file" }
  ]
};

/** Supported subcommands for general run_bun in SA-VM. */
export type SaVmBunSubcommand = "test" | "run" | "build" | "--filter" | "filter";

export const ALL_SA_VM_BUN_SUBCOMMANDS: readonly SaVmBunSubcommand[] = [
  "test",
  "run",
  "build",
  "--filter",
  "filter"
] as const;

export const ALL_SA_VM_BUN_FILTER_SCRIPTS = [
  "typecheck",
  "build",
  "test",
  "lint"
] as const;
export type SaVmBunFilterScript = typeof ALL_SA_VM_BUN_FILTER_SCRIPTS[number];

export const SA_VM_BUN_DENIED_SUBCOMMANDS: readonly string[] = [
  "install",
  "i",
  "add",
  "a",
  "remove",
  "rm",
  "update",
  "upgrade",
  "outdated",
  "bunx",
  "x",
  "init",
  "create",
  "deploy",
  "publish",
  "login",
  "logout",
  "whoami",
  "link",
  "unlink",
  "pm",
  "patch",
  "completions",
  "shell"
] as const;

export interface SaVmBunPolicyConfig {
  enabled?: boolean;
  allowedSubcommands?: SaVmBunSubcommand[];
}

export interface SaVmHttpAllowRule {
  host: string;
  methods?: string[];
  paths?: string[];
}

export type SaVmRuntimeEngine = "native" | "vm";

/** Per-thread SA-VM broker policy. Paths are absolute or relative to cwd. */
export interface SaVmPolicyConfig {
  /** Execution engine: "native" (default: native tools with policy guard) or "vm" (SA-VM sandbox). */
  engine?: SaVmRuntimeEngine;
  fs?: {
    /** Preferred Codex-sandbox-shaped representation. */
    entries?: SaVmFsEntry[];
    /** Legacy fields retained for persisted-thread compatibility. */
    read?: string[];
    write?: string[];
    transfer?: string[];
    delete?: SaVmDeletePolicy;
    backupDir?: string | null;
    /** Installed Sala help root; implicitly read-only when configured. */
    salaRoot?: string;
  };
  http?: {
    allow?: SaVmHttpAllowRule[];
  };
  env?: {
    allow?: string[];
  };
  process?: {
    spawn?: boolean;
    exec?: SaVmProcessExecRule[];
    /** Allow only server-defined Bun profiles; never accepts arbitrary argv. */
    bunProfiles?: SaVmBunProfile[];
    /** General safe bun execution policy. */
    bun?: boolean | SaVmBunPolicyConfig;
  };
  /** Direct host script execution is opt-in while VM broker mode is enabled. */
  execution?: {
    javascript?: boolean;
    python?: boolean;
  };
  /** Granular system tool replacement toggles (default false: use system tools). */
  tools?: SaVmToolsConfig;
  /** Granular context token-saving optimization configurations (default: all disabled). */
  contextSavings?: SaVmContextSavingsConfig;
  /** Penalty & reward accountability ledger with autonomous JEV gatekeeper. */
  accountability?: SaVmAccountabilityConfig;
}

/** Penalty & reward accountability ledger configuration. */
export interface SaVmAccountabilityConfig {
  enabled?: boolean;
  ledgerPath?: string;
  autoPenalize?: boolean;
  reputationThresholdRed?: number;
  reputationThresholdYellow?: number;
  manualOverride?: boolean;
}

/** Granular context token-saving optimization configurations. */
export interface SaVmContextSavingsConfig {
  /** OPT-1: Reject full read_file when file size exceeds threshold and guide to read_lines / find_references. */
  locateBeforeRead?: boolean;
  /** Max file size in bytes for full read_file when locateBeforeRead is enabled. Default 50 * 1024 (50KB). */
  maxReadFileBytes?: number;
  /** OPT-2: Circuit breaker for grep_search (default path+line only, max_results / max_tokens limits). */
  grepCircuitBreaker?: boolean;
  /** Max matches for grep_search circuit breaker. Default 50. */
  grepMaxResults?: number;
  /** Max tokens estimate for grep_search circuit breaker. Default 3000. */
  grepMaxTokens?: number;
  /** OPT-3: Slim runner output for bun test / bun build (pass summary, fail tail retention). */
  slimRunnerOutput?: boolean;
  /** OPT-4: Parallel total byte budget & full read quota. */
  parallelBudget?: boolean;
  parallelMaxTotalBytes?: number;
  parallelMaxReadFiles?: number;
  /** OPT-9: Parallel deduplication and overlapping read_lines merge. */
  parallelDeduplication?: boolean;
  /** OPT-5: Tiered skill injection. */
  tieredSkillInjection?: boolean;
  /** OPT-6: Fold waterfall intermediate events in model turn history. */
  foldWaterfallEvents?: boolean;
  /** OPT-7: Fold read-only tool history exceeding N turns into compact summary placeholders. */
  foldHistoryReadSummaries?: boolean;
  /** Number of turns before read-only outputs are folded. Default 4. */
  historyReadFoldTurns?: number;
}

/** Granular system tool replacement configuration for gradual VM onboarding. Default: all false (system tools enabled). */
export interface SaVmToolsConfig {
  /** Replace system read tools with SA-VM. Default false (use system read tools). */
  replaceRead?: boolean;
  /** Replace system write tools with SA-VM. Default false (use system write tools). */
  replaceWrite?: boolean;
  /** Replace system apply_patch with SA-VM broker. Default false (use native apply_patch). */
  replaceApplyPatch?: boolean;
  /** Replace system command/exec tools with SA-VM. Default false (allow host terminal/exec). */
  replaceExec?: boolean;
  /** Allow model to use optimized file reading with token headroom protection (read_file, read_lines, read_file_tail). */
  readFiles?: boolean;
  /** Allow model to use precision string replacement and atomic writing (edit_file, write_file). */
  editFiles?: boolean;
  /** Allow model to use unified diff multi-file batch patching (apply_patch). */
  applyPatch?: boolean;
  /** Allow model to use high-concurrency ripgrep and fast file discovery (grep_search, grep_search_async, find_files, list_dir, file_info). */
  fastSearch?: boolean;
  /** Allow model to autonomously clear obsolete tool history to save context. Default false. */
  clearToolHistory?: boolean;
  /** Allow model to use high-precision symbol reference search with enum compression. Default false. */
  findReferences?: boolean;
  /** Allow model to use cross-file symbol rename with safety checks. Default false. */
  renameSymbol?: boolean;
  /** Allow model to extract structural file outline (functions, classes, interfaces) with line ranges. Default false. */
  fileOutline?: boolean;
  /** Allow model to move files with automatic import path updates. Default false. */
  moveWithImports?: boolean;
  /** Allow model to jump to symbol definition and extract signature/implementation without reading whole file. Default false. */
  findDefinition?: boolean;
  /** Allow model to extract code range into new file and rewrite import in source. Default false. */
  extractToFile?: boolean;
  /** Allow model to add imports cleanly to file header or merge with existing imports. Default false. */
  addImport?: boolean;
  /** Allow model to instantly check single file syntax errors without whole project build. Default false. */
  getDiagnostics?: boolean;
  /** Allow model to automatically organize, clean unused, and merge imports. Default false. */
  organizeImports?: boolean;
  /** Allow model to analyze block scope dependencies, captured closure variables, and suggested props. Default false. */
  analyzeScope?: boolean;
  /** Allow model to extract on-demand JIT class inheritance and module dependency relationship graphs (DOT / Python stub). Default false. */
  codeGraph?: boolean;
  /** Allow model to autonomously call the JEV single-choice decision helper (jev_choose) on forks. Default false (unset = follow JEV dialog master switch). */
  jevChoose?: boolean;
  /** Allow model to autonomously call the JEV multi-item delivery checklist (jev_checklist). Default false (unset = follow JEV dialog master switch). */
  jevChecklist?: boolean;
  /** Allow model to run raw JEV evaluations (jev_evaluate). Default false. */
  jevEvaluate?: boolean;
  /** Allow model to adjudicate lines of thought before extended reasoning (jev_thinking). Default false (unset = follow JEV dialog master switch). */
  jevThinking?: boolean;
  /** Allow model to request red-team review of a plan/decision (jev_redteam). Default false. */
  jevRedteam?: boolean;
  /** Allow model to rank items by a criterion (jev_rank). Default false. */
  jevRank?: boolean;
  /** Allow model to triage task scope (jev_scope). Default false. */
  jevScope?: boolean;
  /** Allow model to gate subagent dispatch before Task fan-out (jev_dispatch). Default false. */
  jevDispatch?: boolean;
  /** Allow model to audit plan-vs-constraints consistency (jev_consistency). Default false. */
  jevConsistency?: boolean;
  /** Allow model to request delivery sign-off (jev_done). Default false. */
  jevDone?: boolean;
  /** Allow model to arbitrate root cause vs symptom fix (jev_diagnose). Default false. */
  jevDiagnose?: boolean;
  /** Allow model to screen boundary risks (jev_edge_cases). Default false. */
  jevEdgeCases?: boolean;
  /** Allow model to review diff blast radius (jev_blast_radius). Default false. */
  jevBlastRadius?: boolean;
  /** Allow model to analyze user intent right after input (jev_intent). Default false (unset = follow JEV dialog master switch). */
  jevIntent?: boolean;
  /** Allow model to pick the next task after completion (jev_next). Default false (unset = follow JEV dialog master switch). */
  jevNext?: boolean;
  /** Allow model to run gated tool-history compression (jev_compress: checklist gate -> add_memory -> clear_tool_history). Default false. */
  jevCompress?: boolean;
  /** Allow model to report task progress on demand (jev_progress: band + health + next step). Default false. */
  jevProgress?: boolean;
  /** Allow model to judge whether a fact should enter long-term memory (jev_memory: skip/workspace/global). Default false. */
  jevMemory?: boolean;
}

export const ENHANCE_TOOLS_KEYS = [
  "readFiles",
  "fastSearch",
  "editFiles",
  "applyPatch",
  "fileOutline",
  "codeGraph",
  "findDefinition",
  "renameSymbol",
  "extractToFile",
  "moveWithImports",
  "addImport",
  "getDiagnostics",
  "organizeImports",
  "analyzeScope",
  "findReferences",
  "clearToolHistory",
  "jevChoose",
  "jevChecklist",
  "jevEvaluate",
  "jevThinking",
  "jevRedteam",
  "jevRank",
  "jevScope",
  "jevDispatch",
  "jevConsistency",
  "jevDone",
  "jevDiagnose",
  "jevEdgeCases",
  "jevBlastRadius",
  "jevIntent",
  "jevNext",
  "jevCompress",
  "jevProgress",
  "jevMemory"
] as const;

export type EnhanceToolKey = typeof ENHANCE_TOOLS_KEYS[number];

export function hasEnhanceToolsEnabled(tools?: SaVmToolsConfig | null): boolean {
  if (!tools) return false;
  return ENHANCE_TOOLS_KEYS.some((key) => tools[key] === true);
}

export function countActiveEnhanceTools(tools?: SaVmToolsConfig | null): number {
  if (!tools) return 0;
  let count = 0;
  for (const key of ENHANCE_TOOLS_KEYS) {
    if (tools[key] === true) {
      count++;
    }
  }
  return count;
}

export function setAllEnhanceTools(tools: SaVmToolsConfig, enabled: boolean): SaVmToolsConfig {
  return {
    ...tools,
    ...Object.fromEntries(ENHANCE_TOOLS_KEYS.map((key) => [key, enabled]))
  };
}

export function createDefaultSaVmPolicyConfig(): SaVmPolicyConfig {
  return {
    engine: "native",
    fs: {
      entries: [
        { path: "${PROJECT}/**", access: "write" }
      ],
      // Legacy mirrors are kept for older sidecars and persisted threads.
      read: ["${PROJECT}/**"],
      write: ["${PROJECT}/**"],
      transfer: ["${PROJECT}/**"],
      delete: "rename",
      backupDir: "${PROJECT}/.codex-ultra/vm-trash/**"
    },
    http: {
      allow: []
    },
    env: {
      allow: ["CWD", "PROJECT"]
    },
    process: {
      spawn: false,
      exec: [
        { path: "git", args: ["status", "*"] },
        { path: "git", args: ["pull"] },
        { path: "git", args: ["push"] }
      ],
      bun: true,
      bunProfiles: [...ALL_SA_VM_BUN_PROFILES]
    },
    execution: {
      javascript: false,
      python: false
    },
    tools: {
      replaceRead: true,
      replaceWrite: true,
      replaceApplyPatch: true,
      replaceExec: true,
      clearToolHistory: true,
      findReferences: true,
      renameSymbol: true,
      fileOutline: true,
      codeGraph: true,
      moveWithImports: true,
      findDefinition: true,
      extractToFile: true,
      addImport: true,
      getDiagnostics: true,
      organizeImports: true,
      analyzeScope: true
    },
    contextSavings: {
      locateBeforeRead: true,
      grepCircuitBreaker: true,
      slimRunnerOutput: true,
      parallelBudget: true,
      parallelDeduplication: true,
      tieredSkillInjection: true,
      foldWaterfallEvents: true,
      foldHistoryReadSummaries: true
    },
    accountability: {
      enabled: false,
      autoPenalize: true,
      reputationThresholdRed: 50,
      reputationThresholdYellow: 80
    }
  };
}

/** Per-conversation compression strategy (mutually exclusive radio). Default "off". */
export type CompactMode = "off" | "cheap" | "jev-sub" | "jev-token";

/** Relay and model selection actually used by a persisted Codex conversation. */
export interface ThreadRuntimeMetadata {
  threadId: string;
  providerId: string | null;
  groupId: string | null;
  model: string;
  reasoningEffort: string;
  /** Per-conversation preference; never a process-wide Codex setting. */
  freeAutoCompactEnabled?: boolean;
  /** Per-conversation compaction threshold, clamped to 50–95. */
  freeAutoCompactThreshold?: number;
  /** Optional per-conversation free model override used only for compaction. */
  freeAutoCompactModel?: string | null;
  /** Optional per-conversation compaction relay override. Null uses automatic free relay matching. */
  freeAutoCompactProviderId?: string | null;
  /** Optional per-conversation compaction relay group override. */
  freeAutoCompactGroupId?: string | null;
  /** Per-conversation compression strategy; legacy freeAutoCompactEnabled maps to cheap/off. */
  compactMode?: CompactMode;
  /** Per-conversation jev_compress threshold, clamped to 50–95. Default 85. */
  jevCompressThreshold?: number;
  permission?: PermissionPresetId;
  agents?: AgentRuntimeOverride;
  cwd?: string;
  additionalRoots?: string[];
  /** Local .code-workspace file selected for this conversation, if any. */
  workspaceFilePath?: string;
  /** Per-conversation CLI backend; defaults to "codex". */
  cliBackend?: CliBackend;
  /** Per-conversation fast-mode preference. */
  fastModeEnabled?: boolean;
  /** Per-conversation plan-mode preference. */
  planModeEnabled?: boolean;
  /** Per-conversation code enhancement / efficiency tools mode. */
  enhanceEnabled?: boolean;
  /** Per-conversation strict SA-VM tool execution mode. */
  vmEnabled?: boolean;
  /** Per-conversation VM broker policy; never process-global. */
  vmPolicy?: SaVmPolicyConfig;
  createdAt: number;
  updatedAt: number;
}

export type AgentRuntimeMode = "inherit" | "enabled" | "disabled";

export type AgentRoleStartPolicy = "onDemand" | "immediate";
export type AgentRoleRuntime = "native" | "independent";
export type AgentRoleWorkspaceMode = "inherit" | "shared" | "private";
export type AgentRoleWorkspaceRuntime = "local" | "ssh";
export type AgentMemberStatus = "configured" | "starting" | "active" | "idle" | "paused" | "draining" | "exited" | "failed" | "offline";
export type AgentHealthAvailability = "online" | "degraded" | "offline";
export type AgentHealthKind = "rateLimit" | "quota" | "auth" | "providerDisabled" | "providerUnavailable" | "transport" | "unknown";

export interface AgentRoleWorkspace {
  mode: AgentRoleWorkspaceMode;
  cwd: string;
  workspaceMode: AgentRoleWorkspaceRuntime;
  sshCommand?: string;
  additionalRoots?: string[];
}

/** Ordered fallback route used when a role's primary route becomes unavailable. */
export interface AgentRoleFallback {
  id: string;
  label: string;
  providerId?: string | null;
  groupId?: string | null;
  model: string;
  reasoningEffort: string;
  workspace?: AgentRoleWorkspace;
}

export interface AgentMemberHealth {
  availability: AgentHealthAvailability;
  kind: AgentHealthKind;
  code: number | string | null;
  message: string;
  consecutiveFailures: number;
  firstFailureAt: number;
  lastFailureAt: number;
  retryAt: number | null;
  retryable: boolean;
}

export interface AgentRosterRole {
  id: string;
  name: string;
  responsibility: string;
  providerId?: string | null;
  groupId?: string | null;
  model: string;
  reasoningEffort: string;
  instanceCount?: number;
  startPolicy?: AgentRoleStartPolicy;
  runtime?: AgentRoleRuntime;
  workspace?: AgentRoleWorkspace;
  fallbacks?: AgentRoleFallback[];
  enabled: boolean;
}

export interface ThreadAgentMember {
  id: string;
  parentThreadId: string;
  roleId: string;
  instanceIndex: number;
  name: string;
  responsibility: string;
  providerId: string | null;
  groupId: string | null;
  model: string;
  reasoningEffort: string;
  runtime: AgentRoleRuntime;
  workspace: AgentRoleWorkspace;
  threadId: string | null;
  status: AgentMemberStatus;
  health: AgentMemberHealth | null;
  activeFallbackId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadAgentRoster {
  threadId: string;
  roles: AgentRosterRole[];
  members: ThreadAgentMember[];
  updatedAt: number;
}

/** Per-conversation Multi Agent V2 overrides. Empty fields inherit Codex's global config. */
export interface AgentRuntimeOverride {
  mode: AgentRuntimeMode;
  childCount: number | null;
  model: string;
  reasoningEffort: string;
  roles: AgentRosterRole[];
}

export type AgentProjectStatus = "draft" | "active" | "paused" | "archived";
export type AgentProjectWorkspaceMode = "local" | "ssh";
export type AgentProjectMemberStatus = "draft" | "starting" | "active" | "paused" | "completed" | "failed";
export type AgentProjectMemberRole =
  | "boss"
  | "product"
  | "engineeringLead"
  | "engineer"
  | "art"
  | "qa"
  | "acceptance"
  | "customerAcceptance"
  | "custom";

export interface AgentProjectWorkspace {
  id: string;
  label: string;
  path: string;
  mode: AgentProjectWorkspaceMode;
  sshCommand?: string;
}

export interface AgentProjectMember {
  id: string;
  name: string;
  role: AgentProjectMemberRole;
  responsibility: string;
  instructions: string;
  providerId: string | null;
  groupId: string | null;
  model: string;
  reasoningEffort: string;
  workspaceIds: string[];
  threadId: string | null;
  status: AgentProjectMemberStatus;
}

/** A company-style room whose members are independently routed Codex threads. */
export interface AgentProject {
  id: string;
  name: string;
  description: string;
  workspaces: AgentProjectWorkspace[];
  agents: AgentProjectMember[];
  coordinatorAgentId: string | null;
  status: AgentProjectStatus;
  createdAt: number;
  updatedAt: number;
}

export type AgentProjectMessageKind = "human" | "agent" | "system" | "handoff";
export type AgentProjectDiscussionPhase = "analysis" | "challenge" | "synthesis";

/** Canonical room timeline entry projected into one shared waterfall. */
export interface AgentProjectMessage {
  id: string;
  projectId: string;
  agentId: string | null;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  kind: AgentProjectMessageKind;
  /** Discussion stage which produced this entry. Human/system entries may omit it. */
  phase?: AgentProjectDiscussionPhase;
  /** Actual route used for the turn, retained for audit and cross-route UI. */
  providerId?: string | null;
  groupId?: string | null;
  model?: string | null;
  text: string;
  createdAt: number;
  sequence: number;
}

export type AgentProjectVoteChoice = "approve" | "reject" | "abstain";
export interface AgentProjectVote {
  id: string;
  projectId: string;
  proposalId: string;
  voterId: string;
  voterType: "human" | "agent";
  choice: AgentProjectVoteChoice;
  comment: string;
  createdAt: number;
}

export function agentRuntimeThreadConfig(agents: AgentRuntimeOverride): Record<string, JsonValue> | undefined {
  if (agents.mode === "inherit") return undefined;
  const config: Record<string, JsonValue> = {
    "features.multi_agent_v2.enabled": agents.mode === "enabled"
  };
  if (agents.mode === "enabled") {
    if (agents.childCount !== null) config["features.multi_agent_v2.max_concurrent_threads_per_session"] = agents.childCount + 1;
    if (agents.model) config["agents.default_subagent_model"] = agents.model;
    if (agents.reasoningEffort) config["agents.default_subagent_reasoning_effort"] = agents.reasoningEffort;
    const rosterHint = agentRosterUsageHint(agents.roles);
    if (rosterHint) {
      config["features.multi_agent_v2.expose_spawn_agent_model_overrides"] = true;
      config["features.multi_agent_v2.root_agent_usage_hint_text"] = rosterHint;
    }
  }
  return config;
}

export function applyReasoningEffortAgentDefaults(
  reasoningEffort: string,
  agents: AgentRuntimeOverride
): { reasoningEffort: string; agents: AgentRuntimeOverride } {
  if (reasoningEffort.trim().toLowerCase() !== "ultra") return { reasoningEffort, agents };
  return {
    reasoningEffort: "ultra",
    agents: { ...agents, mode: "enabled", childCount: 30 }
  };
}

export function agentRosterUsageHint(roles: AgentRosterRole[]): string | undefined {
  const enabledRoles = roles.filter((role) => role.enabled && role.name.trim() && role.responsibility.trim()).slice(0, 12);
  if (enabledRoles.length === 0) return undefined;
  const roster = enabledRoles.map((role) => {
    const workspace = normalizeAgentRoleWorkspace(role.workspace);
    const spawnSettings = [
      role.model.trim() ? `model=${JSON.stringify(role.model.trim())}` : "model=inherit",
      role.reasoningEffort.trim() ? `reasoning_effort=${JSON.stringify(role.reasoningEffort.trim())}` : "reasoning_effort=inherit"
    ].join(", ");
    const runtimeSettings = [
      role.runtime === "independent" ? "runtime=independent" : "runtime=native",
      `workspace=${workspace.mode}`,
      `instances=${normalizeAgentInstanceCount(role.instanceCount)}`,
      `start=${role.startPolicy === "immediate" ? "immediate" : "on-demand"}`
    ].join(", ");
    return `- ${role.name.trim()} [task_name=${JSON.stringify(role.id.trim() || role.name.trim())}; ${spawnSettings}] (${runtimeSettings}): ${role.responsibility.trim()}`;
  });
  return [
    "A user-configured agent roster is available below.",
    "When delegation is useful, assign work to the best matching roster role and pass that role's model and reasoning_effort to spawn_agent.",
    "Use the listed task_name and include the responsibility in the spawn message. Do not spawn agents merely to fill the roster, and do not set agent_type unless that Codex role is separately configured.",
    ...roster
  ].join("\n").slice(0, 8_000);
}

export function parseAgentRuntimeOverride(value: unknown): AgentRuntimeOverride {
  const input = objectRecord(value);
  const mode = input?.mode === "enabled" || input?.mode === "disabled" ? input.mode : "inherit";
  const parsedChildCount = input?.childCount === null || input?.childCount === undefined ? null : Number(input.childCount);
  const childCount = parsedChildCount !== null && Number.isSafeInteger(parsedChildCount + 1) && parsedChildCount >= 1
    ? parsedChildCount
    : null;
  const roles = input?.roles;
  return {
    mode,
    childCount,
    model: cleanAgentString(input?.model, 512),
    reasoningEffort: cleanAgentString(input?.reasoningEffort, 64),
    roles: Array.isArray(roles) ? roles.flatMap((entry, index) => {
      const role = objectRecord(entry);
      if (!role) return [];
      const name = cleanAgentString(role.name, 80);
      const responsibility = cleanAgentString(role.responsibility, 800);
      if (!name && !responsibility) return [];
      return [{
        id: cleanAgentString(role.id, 64) || `role-${index + 1}`,
        name,
        responsibility,
        providerId: cleanNullableAgentString(role.providerId, 128),
        groupId: cleanNullableAgentString(role.groupId, 128),
        model: cleanAgentString(role.model, 512),
        reasoningEffort: cleanAgentString(role.reasoningEffort, 64),
        instanceCount: normalizeAgentInstanceCount(role.instanceCount),
        startPolicy: role.startPolicy === "immediate" ? "immediate" : "onDemand",
        runtime: role.runtime === "independent" ? "independent" : "native",
        workspace: normalizeAgentRoleWorkspace(role.workspace),
        fallbacks: normalizeAgentRoleFallbacks(role.fallbacks),
        enabled: role.enabled !== false
      } satisfies AgentRosterRole];
    }).slice(0, 24) : []
  };
}

export function normalizeAgentRoleFallbacks(value: unknown): AgentRoleFallback[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const fallback = objectRecord(entry);
    if (!fallback) return [];
    const model = cleanAgentString(fallback.model, 512);
    const providerId = cleanNullableAgentString(fallback.providerId, 128);
    const groupId = cleanNullableAgentString(fallback.groupId, 128);
    if (!model && !providerId && !groupId) return [];
    return [{
      id: cleanAgentString(fallback.id, 64) || `fallback-${index + 1}`,
      label: cleanAgentString(fallback.label, 120) || `Fallback ${index + 1}`,
      providerId,
      groupId,
      model,
      reasoningEffort: cleanAgentString(fallback.reasoningEffort, 64),
      workspace: normalizeAgentRoleWorkspace(fallback.workspace)
    } satisfies AgentRoleFallback];
  }).slice(0, 8);
}

export function normalizeAgentRoleWorkspace(value: unknown): AgentRoleWorkspace {
  const workspace = objectRecord(value);
  const mode = workspace?.mode === "shared" || workspace?.mode === "private" ? workspace.mode : "inherit";
  const additionalRootsInput = workspace?.additionalRoots;
  const additionalRoots = Array.isArray(additionalRootsInput)
    ? additionalRootsInput.flatMap((entry) => {
      const root = cleanAgentString(entry, 1_024);
      return root ? [root] : [];
    }).slice(0, 12)
    : [];
  const sshCommand = cleanAgentString(workspace?.sshCommand, 2_048);
  return {
    mode,
    cwd: cleanAgentString(workspace?.cwd, 1_024),
    workspaceMode: workspace?.workspaceMode === "ssh" ? "ssh" : "local",
    ...(sshCommand ? { sshCommand } : {}),
    ...(additionalRoots.length ? { additionalRoots } : {})
  };
}

export function classifyAgentFailure(
  value: unknown,
  previous?: AgentMemberHealth | null,
  now = Date.now()
): AgentMemberHealth {
  const message = agentFailureMessage(value).slice(0, 2_000) || "Agent became unavailable";
  const lower = message.toLowerCase();
  const statusCode = agentFailureStatusCode(value, message);
  const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
  let kind: AgentHealthKind = "unknown";
  let availability: AgentHealthAvailability = consecutiveFailures >= 3 ? "offline" : "degraded";
  let retryable = true;
  let retryAt: number | null = null;

  if (statusCode === 429 || /rate.?limit|too many requests|限流|请求过多/.test(lower)) {
    kind = "rateLimit";
    retryAt = now + Math.min(60_000 * (2 ** Math.min(consecutiveFailures - 1, 5)), 30 * 60_000);
  } else if (statusCode === 402 || /insufficient[_ -]?quota|quota exceeded|billing|credit|余额不足|额度不足|配额不足/.test(lower)) {
    kind = "quota";
    availability = "offline";
    retryable = false;
  } else if (statusCode === 401 || statusCode === 403 || /unauthori[sz]ed|forbidden|invalid api key|鉴权|密钥.*(无效|过期)/.test(lower)) {
    kind = "auth";
    availability = "offline";
    retryable = false;
  } else if (/relay.*disabled|provider.*disabled|group.*disabled|channel.*disabled|渠道.*(停用|禁用)|分组.*(停用|禁用)/.test(lower)) {
    kind = "providerDisabled";
    availability = "offline";
    retryable = false;
  } else if (statusCode === 502 || statusCode === 503 || /bad gateway|service unavailable|upstream unavailable|上游.*不可用/.test(lower)) {
    kind = "providerUnavailable";
    retryAt = now + Math.min(15_000 * (2 ** Math.min(consecutiveFailures - 1, 5)), 10 * 60_000);
  } else if (/connection|transport|socket|network|econn|timed? out|timeout|disconnected|网络|连接.*(断开|失败)/.test(lower)) {
    kind = "transport";
    retryAt = now + Math.min(5_000 * (2 ** Math.min(consecutiveFailures - 1, 5)), 5 * 60_000);
  }

  return {
    availability,
    kind,
    code: statusCode,
    message,
    consecutiveFailures,
    firstFailureAt: previous?.firstFailureAt ?? now,
    lastFailureAt: now,
    retryAt,
    retryable
  };
}

export function healthyAgentMember(now = Date.now()): AgentMemberHealth {
  return {
    availability: "online",
    kind: "unknown",
    code: null,
    message: "",
    consecutiveFailures: 0,
    firstFailureAt: now,
    lastFailureAt: now,
    retryAt: null,
    retryable: true
  };
}

function normalizeAgentInstanceCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, 12) : 1;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanAgentString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanNullableAgentString(value: unknown, maxLength: number): string | null {
  return cleanAgentString(value, maxLength) || null;
}

function agentFailureMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  const record = objectRecord(value);
  return cleanAgentString(record?.message ?? record?.error ?? record?.detail, 2_000) || String(value ?? "");
}

function agentFailureStatusCode(value: unknown, message: string): number | string | null {
  const record = objectRecord(value);
  const rawCode = record?.status ?? record?.statusCode ?? record?.code;
  if (typeof rawCode === "number" && Number.isInteger(rawCode)) return rawCode;
  if (typeof rawCode === "string" && rawCode.trim()) {
    const numeric = Number(rawCode);
    return Number.isInteger(numeric) ? numeric : rawCode.trim().slice(0, 64);
  }
  const match = message.match(/(?:^|[^\d])([1-5]\d\d)(?:[^\d]|$)/);
  return match?.[1] ? Number(match[1]) : null;
}

export interface ChatItem {
  id: string;
  type: string;
  text?: string;
  status?: string;
  title?: string;
  payload?: JsonValue;
}

export interface ChatTurn {
  id: string;
  threadId: string;
  status: "pending" | "inProgress" | "completed" | "failed" | "interrupted";
  items: ChatItem[];
  startedAt: number;
  completedAt?: number;
}

export type ClientToServerMessage =
  | {
      type: "heartbeat.ping";
      id: string;
      sentAt: number;
    }
  | {
      type: "heartbeat.pong";
      id: string;
      sentAt: number;
      receivedAt?: number;
    }
  | {
      type: "rpc";
      id: string;
      method: string;
      params?: JsonValue;
    }
  | {
      type: "serverResponse";
      requestId: JsonRpcId;
      result?: JsonValue;
      error?: JsonRpcFailure["error"];
    }
  | {
      type: "provider.save";
      id: string;
      provider: ProviderConfig;
      apiKey?: string;
      mergeIntoProviderId?: string;
    }
  | {
      type: "provider.delete";
      id: string;
      providerId: string;
    }
  | {
      type: "provider.trash";
      id: string;
      providerId: string;
    }
  | {
      type: "provider.restore";
      id: string;
      providerId: string;
    }
  | {
      type: "provider.activate";
      id: string;
      providerId: string;
      model?: string;
      groupId?: string;
    }
  | {
      type: "thread.watch";
      threadId: string;
    }
  | {
      type: "thread.unwatch";
      threadId: string;
    };

export type ServerToClientMessage =
  | { type: "heartbeat.ping"; id: string; sentAt: number }
  | { type: "heartbeat.pong"; id: string; sentAt: number; receivedAt: number }
  | { type: "engine.status"; status: EngineStatus }
  | { type: "rpc.result"; id: string; result: JsonValue }
  | { type: "rpc.error"; id: string; error: JsonRpcFailure["error"] }
  | { type: "codex.notification"; message: JsonRpcNotification }
  | { type: "codex.serverRequest"; message: JsonRpcRequest }
  | { type: "provider.saved"; id: string; provider: ProviderConfig }
  | { type: "provider.deleted"; id: string; providerId: string }
  | { type: "provider.trashed"; id: string; providerId: string }
  | { type: "provider.restored"; id: string; provider: ProviderConfig }
  | { type: "provider.activated"; id: string; activation: ProviderActivation }
  | { type: "workbench.control"; payload: Record<string, JsonValue> }
  | { type: "server.error"; id?: string; message: string };


export type BalanceLedgerEntry = {
  id: string;
  user_id: string;
  user_email?: string;
  delta: number;
  balance_after: number;
  operation: string;
  reason?: string;
  thread_id?: string;
  method?: string;
  reference_id?: string;
  created_at: number;
};

export type UsageDailyPoint = {
  date: string;
  debit: number;
  credit: number;
  turns: number;
};

export type UsageSummary = {
  balance: number | null;
  totalDebit: number;
  totalCredit: number;
  turnCount: number;
  todayDebit: number;
  periodDays: number;
  daily: UsageDailyPoint[];
  byOperation: Array<{ operation: string; count: number; total: number }>;
  topUsers?: Array<{ userId: string; email: string; debit: number; turns: number }>;
};

export const FREE_OLLAMA_ENABLED = false;

// Temporarily keep the free-model key/license flow available for a future
// rollout, but do not require a key while the public free-model sync is open.
export const FREE_MODEL_LICENSE_ENFORCEMENT_ENABLED = false;

export function isProviderFeatureEnabled(providerId: string): boolean {
  return FREE_OLLAMA_ENABLED || providerId.trim().toLowerCase() !== "free-ollama";
}

export {
  AGENT_ENGINE_CATALOG,
  AGENT_RUNTIME_BRIDGE_PLAN,
  agentEngineByLaunchId,
  getAgentEngine,
  isAgentEngineId,
  plannedChatEngines,
  type AgentEngineCapabilities,
  type AgentEngineDefinition,
  type AgentEngineId,
  type AgentProtocol,
  type AgentRuntimeBridgePlan
} from "./agentEngines.js";

export {
  DEFAULT_REASONING_EFFORTS,
  expandModelContextVariants,
  inferModelCapabilities,
  inferModelVerbosity,
  mergeModelCapabilities,
  modelChoiceDisplayName,
  normalizeModelVerbosity,
  normalizeReasoningEfforts,
  normalizedModelId,
  resolveModelContextWindow,
  resolveModelMaxOutputTokens,
  resolveModelVerbosity,
  resolveReasoningEfforts,
  stripModelContextVariant,
  type ModelCapabilityDescriptor,
  type ModelContextVariant,
  type ModelVerbosity,
  type ReasoningEffortValue
} from "./modelCapabilities.js";
