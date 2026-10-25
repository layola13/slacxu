// For learning and research only; any other use is at your own risk.
/**
 * Auggie backend — inline Augment-compatible HTTP proxy ("redirector").
 *
 * Ports the auth-bypass + chat-stream forwarding logic of the Python prototype
 * `E:\projects\auggie-launch\main.py` into a TypeScript module that runs a
 * long-lived `node:http` server inside the server process on a random free
 * 127.0.0.1 port. The Augment CLI is pointed at this proxy via env injection,
 * which satisfies its auth gate without any real Augment login, and forwards
 * chat/completion traffic to an OpenAI-compatible upstream through the existing
 * relay gateway (`runRelayChatRequestWithKeyFailover`).
 *
 * Plan reference: `docs/auggie-embedded-backend-plan.md` §5.4 / §4.3 / §6.2.
 * Reference Python prototype: `E:\projects\auggie-launch\main.py`.
 * Reuse target: `apps/server/src/relayProtocolGateway.ts`.
 *
 * This module is purely additive. The chat-stream upstream wiring is configured
 * by the routing layer (task #6) via `configureAuggieRedirector`; until then a
 * stub error chunk is returned, but the request translation and node-graph
 * reconstruction are complete and match main.py.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { JsonValue } from "@codex-ui/shared";
import type { ChannelGroupConfig, ProviderConfig } from "@codex-ui/shared";
import { pluginHostServices } from "@cxu/sdk-backend";

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

/**
 * Upstream relay descriptor passed from the routing layer (task #6).
 * Exactly one credential shape must be supplied:
 *   - `apiKey` for a single inline key, or
 *   - `providerKeyFailover` to reuse a fully-formed provider/group station
 *     (an OpenAI-compatible relay channel resolved by the caller).
 */
export interface AuggieRedirectorConfig {
  /** Base URL of the OpenAI-compatible upstream (e.g. https://api.openai.com/v1). */
  upstreamBaseUrl: string;
  /** Model id forwarded to the upstream and advertised via `get-models`. */
  upstreamModel: string;
  /** Single inline upstream API key. Mutually exclusive with providerKeyFailover. */
  apiKey?: string;
  /**
   * Pre-resolved relay station (provider + group + key failover list) to reuse
   * for the upstream call. Mutually exclusive with apiKey.
   */
  providerKeyFailover?: {
    provider: ProviderConfig;
    group: ChannelGroupConfig;
    apiKeys: string[];
  };
  /** Optional system prompt prepended to every upstream request. */
  systemPrompt?: string;
  /** Model context window, advertised via fake models feature flags. Default 200000. */
  modelContextTokens?: number;
  /** Max output tokens advertised via fake models feature flags. Default 16000. */
  modelMaxOutputTokens?: number;
  /** Augment indexing mode advertised to the CLI. Default "complete". */
  indexingMode?: "complete" | "fast" | "none";
  /** Optional global reasoning effort forwarded to the upstream when neither a per-model override nor the request body supplies one. */
  reasoningEffort?: AuggieReasoningEffort;
  /**
   * Per-model reasoning effort overrides keyed by the chat-stream body's
   * top-level `model` field. An override always wins over the body's own
   * `reasoning_effort` (see resolveReasoningEffort); an empty string strips
   * the field from the outbound request.
   */
  reasoningEffortByModel?: Partial<Record<string, AuggieReasoningEffort>>;
  /**
   * Chat model catalog serialized into `feature_flags.model_info_registry`.
   * When omitted (or empty) a single-entry catalog for `upstreamModel` is
   * synthesized. Loaded once per CLI process start, so callers must restart
   * the bridge for catalog changes to take effect.
   */
  modelCatalog?: AuggieRedirectorModelCatalogEntry[];
  /** Compaction tuning forwarded verbatim inside `history_summary_params`. */
  historySummaryParams?: AuggieHistorySummaryParams;
  /** Version gate paired with `history_summary_params`. Default 1. */
  historySummaryMinVersion?: number;
  /**
   * Upper bound (ms) on the CLI's silent chat-stream retry loop, served via
   * the `cli_chat_stream_retry_hard_stop_ms` flag. Default 60s so an
   * unreachable upstream fails visibly instead of stalling for the CLI's
   * default hour.
   */
  chatStreamRetryHardStopMs?: number;
  /** Unlock auggie's built-in sub-agent tooling. Default true. */
  subAgentsEnabled?: boolean;
  /**
   * Push notification fired whenever a chat-stream/chat upstream response
   * carried a usable usage chunk. Informational only — the authoritative
   * consumption path is the pull-based ledger ({@link takeAuggieUpstreamUsage})
   * the agent bridge drains at turn finalization, so wiring this callback is
   * never required for accounting.
   */
  onUsage?: (record: AuggieUsageRecord) => void;
  /** Whether to emit stderr log lines for proxy activity. */
  verbose?: boolean;
  /**
   * MCP servers advertised to the CLI through the service-config endpoints
   * (`settings/get-mcp-user-configs` / `settings/get-mcp-tenant-configs`).
   * Auggie ignores ACP `session/new` mcpServers and pulls its MCP set from
   * these endpoints instead (verified against the real CLI by the
   * original integration). The host fills this with the platform servers
   * (sa-vm, plus jev when JEV MCP is enabled). Entry shape mirrors the CLI's
   * own MCP server entries; re-verify with scripts/probe-auggie-acp.mjs
   * when the CLI's protocol changes.
   */
  mcpServers?: AuggieMcpServerEntry[];
}

/** One MCP server entry as advertised via the service-config endpoints. */
export interface AuggieMcpServerEntry {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Token counts parsed from one upstream OpenAI-compatible usage payload. */
export interface AuggieParsedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
}

/** One completed redirector request whose upstream stream reported usage. */
export interface AuggieUsageRecord extends AuggieParsedUsage {
  /** The redirector-generated chat-stream/chat request id. */
  requestId: string;
  /** Upstream model id the request was translated to. */
  model?: string;
  /** Wall clock at which the upstream response finished. */
  completedAt: number;
}

export type AuggieReasoningEffort = "" | "low" | "medium" | "high";

export interface AuggieRedirectorModelCatalogEntry {
  /** Registry id (the value the CLI sends back as chat-stream's `model`). */
  id: string;
  displayName?: string;
  shortName?: string;
  description?: string;
  modelGroup?: string;
  priority?: number;
  costTier?: number;
  badges?: string[];
  isDefault?: boolean;
  disabled?: boolean;
}

export interface AuggieHistorySummaryParams {
  triggerOnTotalTokens?: number;
  historyTailSizeTokensToExclude?: number;
  maxHistoryChars?: number;
  inputBudgetTriggerRatio?: number;
}

const LOCAL_TOKEN = "fake-augment-access-token";
const DEFAULT_CONTEXT_TOKENS = 200_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
/** history_summary_params defaults: compact around 100k tokens, keep ~16k tail. */
const DEFAULT_SUMMARY_TRIGGER_TOKENS = 100_000;
const DEFAULT_SUMMARY_TAIL_EXCLUDE_TOKENS = 16_000;
const DEFAULT_SUMMARY_MAX_HISTORY_CHARS = 200_000;
const DEFAULT_SUMMARY_INPUT_BUDGET_TRIGGER_RATIO = 0.8;
const DEFAULT_HISTORY_SUMMARY_MIN_VERSION = 1;

/**
 * The exact set of `feature_flags` keys this redirector will ever emit.
 *
 * Everything the CLI does with a flag we do not send stays at its built-in
 * default — which is precisely how Sentry and Segment stay off forever:
 * `cli_enable_sentry` gates the hardcoded-DSN Sentry transport and
 * `cli_analytics_write_key` gates Segment init, so refusing to emit them
 * disables both permanently (audit §1). Any key outside this list is refused
 * at assembly time rather than silently forwarded.
 */
const AUGGIE_FEATURE_FLAG_WHITELIST = [
  "model_info_registry",
  // The CLI only consults model_info_registry when this is set, and resolves
  // the chat model through the registry (verified live: without it the agent
  // sends `model: ""` and every turn hangs).
  "enable_model_registry",
  // Registry-era aliases for the top-level default_model; the CLI reads them
  // when the registry is enabled (mirrors auggie-launch main.py).
  "additional_chat_models",
  "agent_chat_model",
  "history_summary_params",
  "history_summary_min_version",
  // Upper bound on the CLI's silent chat-stream retry loop. Serving a small
  // value makes upstream failures fail fast (and visibly) instead of stalling
  // the turn for the default 60 minutes.
  "cli_chat_stream_retry_hard_stop_ms",
  "beachhead_enable_sub_agent_tool",
  "beachheadEnableParallelToolExecution",
] as const;

type AuggieFeatureFlagKey = (typeof AUGGIE_FEATURE_FLAG_WHITELIST)[number];

/** Flags that must never appear in a get-models response, even by accident. */
const AUGGIE_TELEMETRY_FLAG_DENYLIST = ["cli_enable_sentry", "cli_analytics_write_key"] as const;

let redirectorConfig: AuggieRedirectorConfig | undefined;

/**
 * Configure the upstream relay descriptor used for chat-stream forwarding.
 * Called once by the routing layer (task #6) before any chat-stream arrives.
 * Until this is called, chat-stream returns a stub error chunk.
 */
export function configureAuggieRedirector(config: AuggieRedirectorConfig): void {
  redirectorConfig = config;
}

function resolveConfig(): AuggieRedirectorConfig | undefined {
  return redirectorConfig;
}

function modelContextTokens(): number {
  return resolveConfig()?.modelContextTokens && resolveConfig()!.modelContextTokens! > 0
    ? resolveConfig()!.modelContextTokens!
    : DEFAULT_CONTEXT_TOKENS;
}

function modelMaxOutputTokens(): number {
  return resolveConfig()?.modelMaxOutputTokens && resolveConfig()!.modelMaxOutputTokens! > 0
    ? resolveConfig()!.modelMaxOutputTokens!
    : DEFAULT_MAX_OUTPUT_TOKENS;
}

function indexingMode(): "complete" | "fast" | "none" {
  return resolveConfig()?.indexingMode ?? "complete";
}

export function upstreamModel(): string {
  return resolveConfig()?.upstreamModel ?? "auggie-default";
}

function log(message: string): void {
  if (resolveConfig()?.verbose) console.error(`[auggie-redirector] ${message}`);
}

/* ------------------------------------------------------------------ *
 * Manager
 * ------------------------------------------------------------------ */

export interface AuggieRedirectorHandle {
  /** Base URL of the running redirector, e.g. http://127.0.0.1:54321. */
  url: string;
  /** The fake access token advertised to the client. */
  token: string;
  /** JSON string for the AUGMENT_SESSION_AUTH env var. */
  sessionAuthJson: string;
  /**
   * Returns a shallow copy of `env` with the Augment env vars injected,
   * pointing the CLI at this redirector.
   */
  injectEnvFor: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
}

let redirectorUrl: string | undefined;
let redirectorServer: http.Server | undefined;

/**
 * Ensure a redirector is running. Lazy-starts the HTTP server on first call
 * (long-lived, random free 127.0.0.1 port) and returns the handle. Subsequent
 * calls return the same handle.
 */
export async function ensureAuggieRedirector(): Promise<AuggieRedirectorHandle> {
  if (redirectorServer && redirectorUrl) {
    return makeHandle(redirectorUrl);
  }
  redirectorServer = createRedirectorServer();
  await new Promise<void>((resolve, reject) => {
    const server = redirectorServer!;
    server.once("listening", resolve);
    server.once("error", reject);
    server.listen(0, "127.0.0.1");
  });
  const address = redirectorServer!.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("auggie redirector failed to bind");
  }
  redirectorUrl = `http://127.0.0.1:${address.port}`;
  log(`listening on ${redirectorUrl}`);
  return makeHandle(redirectorUrl);
}

/** Stop the redirector and release the port. Safe to call when not running. */
export async function stopAuggieRedirector(): Promise<void> {
  if (redirectorServer) {
    await new Promise<void>((resolve) => redirectorServer!.close(() => resolve()));
    redirectorServer = undefined;
    redirectorUrl = undefined;
  }
}

function makeHandle(url: string): AuggieRedirectorHandle {
  const sessionAuthJson = JSON.stringify({
    accessToken: LOCAL_TOKEN,
    tenantURL: url,
    scopes: ["email", "profile", "offline_access"],
  });
  return {
    url,
    token: LOCAL_TOKEN,
    sessionAuthJson,
    injectEnvFor: (env) => ({
      ...env,
      AUGMENT_API_URL: url,
      AUGMENT_API_TOKEN: LOCAL_TOKEN,
      AUGMENT_SESSION_AUTH: sessionAuthJson,
      AUGMENT_INDEXING_MODE: indexingMode(),
      // undici routes fetch through EnvHttpProxyAgent when HTTP(S)_PROXY is
      // set in the host environment; the CLI's traffic must reach the
      // loopback redirector directly, never a proxy.
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    }),
  };
}

/* ------------------------------------------------------------------ *
 * HTTP server
 * ------------------------------------------------------------------ */

function createRedirectorServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (error) {
      log(`unhandled error: ${error instanceof Error ? error.message : String(error)}`);
      sendJson(res, 500, { error: "internal_error", message: "redirector crashed" });
    }
  });
  // The CLI's undici pool reuses connections across requests that can be tens
  // of seconds apart (get-models → tool init → settings → chat-stream). The
  // default 5s idle timeout closes those connections underneath the pool and
  // every reused request then fails with "UND_ERR_SOCKET: other side closed"
  // (observed verbatim in the CLI's /report-error payloads). Keep connections
  // alive well beyond any CLI think-time; headersTimeout must exceed
  // keepAliveTimeout so idle keep-alive sockets are not dropped as slow.
  server.keepAliveTimeout = 300_000;
  server.headersTimeout = 310_000;
  server.requestTimeout = 0;
  return server;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Accept HEAD as a health probe (main.py do_HEAD).
  if (req.method === "HEAD") {
    res.writeHead(200, { "Content-Length": "0" });
    res.end();
    return;
  }
  const path = safeUrlPath(req.url);
  // Always log chat traffic: the CLI retries upstream failures silently for
  // up to an hour, so "nothing happened" is unverifiable without this line.
  if (path === "chat-stream") {
    console.error("[auggie-redirector] POST chat-stream accepted");
  }
  if (req.method === "GET") {
    if (path === "" || path === "health") {
      sendJson(res, 200, { ok: true, service: "auggie-redirector", indexing_mode: indexingMode() });
      return;
    }
    if (path === "get-models" || path === "models" || path === "model-config") {
      sendJson(res, 200, fakeModels());
      return;
    }
    sendJson(res, 200, fakeGeneric(path));
    return;
  }
  if (req.method === "POST") {
    const body = await readJson(req);
    if (path === "token" || path === "auth/token" || path.endsWith("/token")) {
      sendJson(res, 200, fakeToken());
      return;
    }
    if (path === "get-models" || path === "models" || path === "model-config") {
      sendJson(res, 200, fakeModels());
      return;
    }
    if (path === "find-missing") {
      sendJson(res, 200, fakeFindMissing(body));
      return;
    }
    if (path === "batch-upload") {
      sendJson(res, 200, fakeBatchUpload(body));
      return;
    }
    // Metadata-only acknowledgement (audit §2): synthesize a checkpoint id,
    // persist nothing.
    if (path === "checkpoint-blobs") {
      sendJson(res, 200, { new_checkpoint_id: `checkpoint_${randomUUID()}` });
      return;
    }
    if (path === "chat-stream" || path === "prompt-enhancer") {
      await forwardStream(body, res);
      return;
    }
    if (path === "chat" || path === "remote-agents/chat") {
      await forwardJson(body, res);
      return;
    }
    if (
      path === "completion" ||
      path === "completion/request" ||
      path === "completion/complete" ||
      path === "chat-input-completion"
    ) {
      await forwardJson(body, res);
      return;
    }
    if (path === "completion/resolve" || path === "completion/cancel" || path === "resolve-completions") {
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 200, fakeGeneric(path));
    return;
  }
  sendJson(res, 200, fakeGeneric(path));
}

function safeUrlPath(url: string | undefined): string {
  if (!url) return "";
  let u: URL;
  try {
    u = new URL(url, "http://127.0.0.1");
  } catch {
    return "";
  }
  return u.pathname.replace(/^\/+|\/+$/g, "");
}

/* ------------------------------------------------------------------ *
 * Endpoints — fake responses (mirror main.py)
 * ------------------------------------------------------------------ */

function fakeToken(): Record<string, JsonValue> {
  return {
    access_token: LOCAL_TOKEN,
    token_type: "Bearer",
    expires_in: 31_536_000,
    scope: "email profile offline_access",
  };
}

/**
 * Serialize the configured chat catalog into the `model_info_registry` JSON
 * STRING. Deterministic: entries keep config order, fields are emitted in a
 * fixed key order, and defaults are filled per entry. Exactly one entry is
 * marked `isDefault` — the first explicit one, else the first entry — so the
 * CLI always has an unambiguous fallback model.
 */
export function buildAuggieModelInfoRegistryJson(
  catalog: AuggieRedirectorModelCatalogEntry[] | undefined,
): string {
  const entries = catalog && catalog.length > 0 ? catalog : [{ id: upstreamModel() }];
  let defaultIndex = -1;
  let firstUsableIndex = -1;
  const ids = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (typeof entry.id !== "string" || !entry.id.trim()) continue;
    ids.add(entry.id);
    if (defaultIndex < 0 && entry.isDefault === true) defaultIndex = i;
    if (firstUsableIndex < 0) firstUsableIndex = i;
  }
  // Exactly one default: the first explicit `isDefault`, else the first entry.
  if (defaultIndex < 0) defaultIndex = Math.max(0, firstUsableIndex);

  const registry: Record<string, JsonValue> = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (typeof entry.id !== "string" || !entry.id.trim()) continue;
    // The CLI's --model resolver rejects an entry whose displayName equals
    // the requested value ("Using a display name for --model is no longer
    // supported") BEFORE falling through to shortName/key matching, so the
    // display name must be a human label distinct from the id key.
    const prettified = entry.id
      .split(/[\/_-]+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ");
    // The resolver scans EVERY entry's displayName before it ever tries ids, so
    // a displayName colliding with any id in the registry hard-rejects that id
    // for `--model` — not just its own. Single-token ids that are already
    // capitalized ("Grok4") prettify back to themselves and would otherwise
    // lock themselves out, so suffix a label that can never be an id.
    const candidate = entry.displayName?.trim() || prettified;
    const displayName = ids.has(candidate) ? `${candidate} (relay)` : candidate;
    // Entry shape per the CLI's registry consumers (picker/resolvers): they
    // read displayName/shortName/description/disabled/isDefault/modelGroup/
    // priority/costTier/badges. humanName/encoding/context/maxOutput belong to
    // a DIFFERENT built-in tokenizer table and are ignored here. The id key
    // itself is what chat-stream's `model` must carry.
    registry[entry.id] = {
      displayName,
      shortName: entry.shortName?.trim() || displayName,
      description:
        entry.description?.trim() || `OpenAI-compatible upstream model via auggie-redirector (${displayName})`,
      modelGroup: entry.modelGroup?.trim() || "default",
      modelGroupPriority: 0,
      priority: typeof entry.priority === "number" ? entry.priority : i,
      costTier: typeof entry.costTier === "number" ? entry.costTier : 0,
      badges: Array.isArray(entry.badges) ? entry.badges.slice() : [],
      isNew: false,
      isLegacyModel: false,
      isDefault: i === defaultIndex,
      disabled: entry.disabled === true,
    };
  }
  // CRITICAL: model_info_registry MUST be a JSON STRING (not an object),
  // matching main.py's `json.dumps({MODEL: {...}})` — the CLI parses it once
  // at process start.
  return JSON.stringify(registry);
}

/**
 * Assemble the get-models `feature_flags` object from whitelisted values only.
 * Exported so tests can pin the exact key set.
 */
export function buildAuggieFeatureFlags(): Record<string, JsonValue> {
  const subAgents = resolveConfig()?.subAgentsEnabled ?? true;
  const summaryParams = resolveConfig()?.historySummaryParams ?? {};
  const numberOr = (value: number | undefined, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const flags: Record<AuggieFeatureFlagKey, JsonValue> = {
    model_info_registry: buildAuggieModelInfoRegistryJson(resolveConfig()?.modelCatalog),
    enable_model_registry: true,
    additional_chat_models: upstreamModel(),
    agent_chat_model: upstreamModel(),
    history_summary_params: JSON.stringify({
      trigger_on_total_tokens: numberOr(summaryParams.triggerOnTotalTokens, DEFAULT_SUMMARY_TRIGGER_TOKENS),
      history_tail_size_tokens_to_exclude: numberOr(
        summaryParams.historyTailSizeTokensToExclude,
        DEFAULT_SUMMARY_TAIL_EXCLUDE_TOKENS,
      ),
      max_history_chars: numberOr(summaryParams.maxHistoryChars, DEFAULT_SUMMARY_MAX_HISTORY_CHARS),
      input_budget_trigger_ratio: numberOr(
        summaryParams.inputBudgetTriggerRatio,
        DEFAULT_SUMMARY_INPUT_BUDGET_TRIGGER_RATIO,
      ),
    }),
    // The CLI decodes this flag as a string (live evidence: a numeric
    // value makes it reject the whole get-models response and start with an
    // empty model registry).
    history_summary_min_version:
      String(numberOr(resolveConfig()?.historySummaryMinVersion, DEFAULT_HISTORY_SUMMARY_MIN_VERSION)),
    // 60s: well above a healthy upstream round-trip, but an unreachable or
    // failing upstream surfaces as a turn error in under a minute instead of
    // the CLI's default silent one-hour retry loop.
    cli_chat_stream_retry_hard_stop_ms: numberOr(
      resolveConfig()?.chatStreamRetryHardStopMs,
      60_000,
    ),
    beachhead_enable_sub_agent_tool: subAgents,
    beachheadEnableParallelToolExecution: subAgents,
  };
  return assembleWhitelistedFlags(flags);
}

/**
 * Refuse any feature flag outside AUGGIE_FEATURE_FLAG_WHITELIST and re-emit
 * the surviving flags in whitelist order (deterministic response bodies).
 */
function assembleWhitelistedFlags(flags: Record<AuggieFeatureFlagKey, JsonValue>): Record<string, JsonValue> {
  const keys = Object.keys(flags);
  for (const key of keys) {
    if (!(AUGGIE_FEATURE_FLAG_WHITELIST as readonly string[]).includes(key)) {
      throw new Error(`auggie redirector refused non-whitelisted feature flag "${key}"`);
    }
    if ((AUGGIE_TELEMETRY_FLAG_DENYLIST as readonly string[]).includes(key)) {
      throw new Error(`auggie redirector refused telemetry-gating feature flag "${key}"`);
    }
  }
  const ordered: Record<string, JsonValue> = {};
  for (const key of AUGGIE_FEATURE_FLAG_WHITELIST) {
    if (key in flags) ordered[key] = flags[key];
  }
  return ordered;
}

function fakeModels(): Record<string, JsonValue> {
  const targetModel = upstreamModel();
  return {
    default_model: targetModel,
    models: [
      {
        name: targetModel,
        internal_name: targetModel,
        suggested_prefix_char_count: 12000,
        suggested_suffix_char_count: 12000,
        completion_timeout_ms: 600000,
      },
    ],
    languages: [
      { name: "TypeScript", vscode_name: "typescript", extensions: [".ts", ".tsx"] },
      { name: "JavaScript", vscode_name: "javascript", extensions: [".js", ".jsx", ".mjs"] },
      { name: "Python", vscode_name: "python", extensions: [".py"] },
      { name: "Markdown", vscode_name: "markdown", extensions: [".md"] },
      { name: "JSON", vscode_name: "json", extensions: [".json"] },
    ],
    feature_flags: buildAuggieFeatureFlags(),
    user_tier: "ENTERPRISE_TIER",
    user: { id: "user_auggie_launch_local", email: "proxy@example.local" },
    bootstrap_settings: { repository_allowlist_settings: { repository_urls: [], is_deny_list: false } },
  };
}

function fakeFindMissing(_body: JsonValue): Record<string, JsonValue> {
  // Always answer "nothing is missing": every blob counts as already synced so
  // the upload branch never fires and no workspace contents leave the machine
  // (audit §2). Echoing memory/blob names here would instruct the CLI to push
  // their contents, so indexingMode deliberately does not change this answer.
  return { unknown_memory_names: [], nonindexed_blob_names: [] };
}

function fakeBatchUpload(body: JsonValue): Record<string, JsonValue> {
  // Defensive echo only (audit §2): if batch-upload ever fires despite the
  // find-missing answer above, blob_names must repeat the submitted names in
  // exactly the same count and order, or the CLI re-uploads full contents for
  // every "missing" blob. Nothing is persisted — the request body is read and
  // reflected verbatim, never written to disk.
  const names: string[] = [];
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const blobs = (body as Record<string, unknown>).blobs;
    if (Array.isArray(blobs)) {
      for (const blob of blobs) {
        if (blob && typeof blob === "object" && !Array.isArray(blob)) {
          const rec = blob as Record<string, unknown>;
          const name = typeof rec.blob_name === "string" ? rec.blob_name : undefined;
          if (typeof name === "string" && name) names.push(name);
        }
      }
    }
  }
  return { blob_names: names };
}

function fakeGeneric(path: string): Record<string, JsonValue> {
  if (path === "get-credit-info") {
    return {
      credits: { remaining: 999999, used: 0, limit: 999999 },
      subscription: { status: "active", tier: "enterprise" },
    };
  }
  if (path === "get-billing-summary") {
    return { billing_summary: { status: "active", plan: "enterprise", usage: 0, limit: 999999 } };
  }
  if (path === "context-canvas/list") {
    return { canvases: [], context_canvases: [], next_page_token: "" };
  }
  if (path === "settings/get-mcp-user-configs" || path === "settings/get-mcp-tenant-configs") {
    // Auggie pulls its MCP server set from these service-config endpoints
    // (it ignores ACP session/new mcpServers). Serve the host-configured
    // platform servers (sa-vm / jev); empty when none are configured.
    const servers = resolveConfig()?.mcpServers ?? [];
    return {
      settings: {},
      configs: servers.map((server) => ({
        name: server.name,
        command: server.command,
        args: server.args,
        env: server.env ?? {},
      })),
      permissions: [],
      allowed: true,
    };
  }
  if (path.startsWith("settings/")) {
    return { settings: {}, configs: [], permissions: [], allowed: true };
  }
  if (path.startsWith("tenant-secrets/") || path.startsWith("user-secrets/")) {
    return { secrets: [], ok: true };
  }
  if (path.startsWith("remote-agents/")) {
    return { agents: [], remote_agents: [], messages: [], chat_history: [] };
  }
  if (path.startsWith("cloud-agents/")) {
    return { agents: [], messages: [], ok: true };
  }
  if (path.startsWith("agent-workspace/")) {
    return { updates: [], events: [], last_seq_id: 0, ok: true };
  }
  if (path === "checkpoint-blobs") {
    return { new_checkpoint_id: `checkpoint_${randomUUID()}` };
  }
  if (path === "agents/list-remote-tools" || path === "agents/check-tool-safety") {
    return { tools: [], is_safe: true, ok: true };
  }
  if (path === "report-error" || path === "record-user-events" || path === "client-metrics" || path.includes("feedback")) {
    return { ok: true };
  }
  if (path === "chat/exchanges/list") {
    return { chat_history: [] };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Request translation — port of main.py build_openai_messages/tools
 * ------------------------------------------------------------------ */

type Loose = Record<string, unknown>;
type AnyValue = unknown;

function textFromValue(value: AnyValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const entry of value) {
      if (typeof entry === "string") {
        parts.push(entry);
      } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const rec = entry as Loose;
        const text = rec.text ?? rec.content ?? rec.message;
        if (typeof text === "string") parts.push(text);
      }
    }
    return parts.join("\n");
  }
  if (typeof value === "object") {
    const rec = value as Loose;
    for (const key of ["text", "content", "message", "prompt", "query", "input"]) {
      const v = rec[key];
      if (typeof v === "string") return v;
    }
  }
  return "";
}

function normalizeSchema(value: AnyValue): AnyValue {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (value && typeof value === "object") {
    const rec = value as Loose;
    const out: Loose = {};
    for (const [k, v] of Object.entries(rec)) {
      out[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : normalizeSchema(v);
    }
    return out;
  }
  return value;
}

function parseToolSchema(tool: Loose): Loose {
  for (const key of ["input_schema_json", "input_schema", "parameters"]) {
    const schema = tool[key];
    if (schema && typeof schema === "object" && !Array.isArray(schema)) {
      return normalizeSchema(schema) as Loose;
    }
    if (typeof schema === "string" && schema.trim()) {
      try {
        const parsed = JSON.parse(schema);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return normalizeSchema(parsed) as Loose;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return { type: "object", properties: {} };
}

function buildOpenaiTools(body: AnyValue): Loose[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const rec = body as Loose;
  const definitions = rec.tool_definitions;
  if (!Array.isArray(definitions)) return [];
  const tools: Loose[] = [];
  for (const item of definitions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const def = item as Loose;
    const name = def.name;
    if (typeof name !== "string" || !name) continue;
    tools.push({
      type: "function",
      function: {
        name,
        description: String(def.description ?? ""),
        parameters: parseToolSchema(def),
      },
    });
  }
  return tools;
}

function nodeText(node: AnyValue): string {
  if (!node || typeof node !== "object" || Array.isArray(node)) return "";
  const rec = node as Loose;
  const textNode = rec.text_node;
  if (textNode && typeof textNode === "object" && !Array.isArray(textNode)) {
    const tn = textNode as Loose;
    const text = textFromValue(tn.content ?? tn.text);
    if (text) return text;
  }
  return textFromValue(rec.content ?? rec.text ?? rec.message);
}

function nodeToolUse(node: AnyValue): Loose | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const rec = node as Loose;
  const toolUse = rec.tool_use;
  if (!toolUse || typeof toolUse !== "object" || Array.isArray(toolUse)) return null;
  const tu = toolUse as Loose;
  const name = tu.tool_name ?? tu.name;
  const callId = tu.tool_use_id ?? tu.id ?? `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let args = tu.input_json ?? tu.arguments ?? tu.input ?? "{}";
  if (typeof args !== "string") args = JSON.stringify(args);
  if (typeof name === "string" && name) {
    return { id: String(callId), type: "function", function: { name, arguments: args as string } };
  }
  return null;
}

function nodeToolResult(node: AnyValue): Loose | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const rec = node as Loose;
  const result = rec.tool_result_node ?? rec.tool_result ?? rec.tool_use_result ?? rec.toolUseResult;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Loose;
  const callId = r.tool_use_id ?? r.tool_call_id ?? r.id;
  // Mirror main.py's `or` chain: an empty string/zero falls through to the
  // next candidate (so an empty `content` yields the `result`/`output`/...
  // value rather than a literal "").
  const content = r.content || r.result || r.output || r.text || r;
  if (callId) {
    return {
      role: "tool",
      tool_call_id: String(callId),
      content: textFromValue(content) || JSON.stringify(content),
    };
  }
  return null;
}

function appendHistoryMessages(messages: Loose[], body: AnyValue): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const rec = body as Loose;
  const history = rec.chat_history ?? rec.history;
  if (!Array.isArray(history)) return;
  for (const record of history) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    const h = record as Loose;
    const requestNodes = Array.isArray(h.request_nodes) ? h.request_nodes : [];
    const responseNodes = Array.isArray(h.response_nodes) ? h.response_nodes : [];
    for (const node of requestNodes) {
      const tr = nodeToolResult(node);
      if (tr) messages.push(tr);
    }
    const userText =
      requestNodes.map((n) => nodeText(n)).filter(Boolean).join("\n") || textFromValue(h.request_message);
    if (userText) messages.push({ role: "user", content: userText });
    const assistantText =
      responseNodes.map((n) => nodeText(n)).filter(Boolean).join("\n") || textFromValue(h.response_text);
    const toolCalls = responseNodes.map((n) => nodeToolUse(n)).filter(Boolean) as Loose[];
    if (assistantText || toolCalls.length > 0) {
      const msg: Loose = { role: "assistant", content: assistantText || null };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      messages.push(msg);
    }
  }
}

function appendCurrentToolResults(messages: Loose[], body: AnyValue): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const rec = body as Loose;
  const nodes = rec.nodes;
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    const tr = nodeToolResult(node);
    if (tr) messages.push(tr);
  }
}

function currentMessageText(body: AnyValue): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return textFromValue(body);
  }
  const rec = body as Loose;
  for (const key of ["message", "request_message", "current_message", "prompt", "query", "input"]) {
    const value = textFromValue(rec[key]).trim();
    if (value) return value;
  }
  const requestNodes = rec.request_nodes;
  if (Array.isArray(requestNodes)) {
    const text = requestNodes.map((n) => nodeText(n)).filter(Boolean).join("\n").trim();
    if (text) return text;
  }
  const nodes = rec.nodes;
  if (Array.isArray(nodes)) {
    const text = nodes.map((n) => nodeText(n)).filter(Boolean).join("\n").trim();
    if (text) return text;
  }
  return "";
}

function buildOpenaiMessages(body: AnyValue): Loose[] {
  const messages: Loose[] = [];
  const system = resolveConfig()?.systemPrompt?.trim() ?? "";
  if (system) messages.push({ role: "system", content: system });

  appendHistoryMessages(messages, body);
  appendCurrentToolResults(messages, body);

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const rec = body as Loose;
    const rawMessages = rec.messages;
    if (Array.isArray(rawMessages)) {
      for (const entry of rawMessages) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const e = entry as Loose;
        const roleRaw = String(e.role ?? e.speaker ?? "user").toLowerCase();
        let outRole: string;
        if (roleRaw === "assistant" || roleRaw === "agent" || roleRaw === "bot") outRole = "assistant";
        else if (roleRaw === "system" || roleRaw === "developer") outRole = "system";
        else outRole = "user";
        const content = textFromValue(e.content ?? e.text ?? e.message);
        if (content) messages.push({ role: outRole, content });
      }
    }
  }

  const current = currentMessageText(body);
  if (current) {
    const last = messages[messages.length - 1];
    if (!last || (last as Loose).content !== current) {
      messages.push({ role: "user", content: current });
    }
  }
  if (messages.length === 0) {
    messages.push({ role: "user", content: "(empty request)" });
  }
  return messages;
}

function estimateMsgCharCount(msg: Loose): number {
  let cnt = String(msg.content ?? "").length;
  const toolCalls = msg.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      if (tc && typeof tc === "object" && !Array.isArray(tc)) {
        const t = tc as Loose;
        const fn = t.function as Loose | undefined;
        cnt += String(fn?.name ?? "").length + String(fn?.arguments ?? "").length;
      }
    }
  }
  return cnt;
}

function truncateMessagesToContextLimit(messages: Loose[], maxContextTokens: number): Loose[] {
  if (messages.length === 0 || maxContextTokens <= 0) return messages;
  const maxInputTokens = Math.max(10000, maxContextTokens - 16384);
  const budgetChars = Math.floor(maxInputTokens * 3.2);
  const totalChars = messages.reduce((sum, m) => sum + estimateMsgCharCount(m), 0);
  if (totalChars <= budgetChars) return messages;

  const systemMsg = messages[0]?.role === "system" ? messages[0] : undefined;
  const lastMsg = messages[messages.length - 1]!;
  const keptHead: Loose[] = systemMsg ? [systemMsg] : [];
  const middle = messages.slice(systemMsg ? 1 : 0, -1);
  let currentBudget =
    budgetChars - keptHead.reduce((s, m) => s + estimateMsgCharCount(m), 0) - estimateMsgCharCount(lastMsg);
  const keptMiddle: Loose[] = [];
  for (let i = middle.length - 1; i >= 0; i--) {
    const m = middle[i]!;
    const cost = estimateMsgCharCount(m);
    if (currentBudget - cost >= 0) {
      keptMiddle.push(m);
      currentBudget -= cost;
    } else {
      if (cost > currentBudget && currentBudget > 1000 && typeof m.content === "string") {
        keptMiddle.push({ ...m, content: m.content.slice(0, currentBudget) + "\n... [truncated due to context limit]" });
      }
      break;
    }
  }
  keptMiddle.reverse();
  return [...keptHead, ...keptMiddle, lastMsg];
}

/**
 * Build the outbound OpenAI Chat Completions body from an Augment
 * chat-stream/chat payload. Exported so tests can pin request translation
 * (reasoning_effort injection, message/tool mapping).
 */
export function buildOpenaiRequest(body: AnyValue, stream: boolean): Record<string, unknown> {
  const rawMessages = buildOpenaiMessages(body);
  const limit = modelContextTokens();
  const messages = truncateMessagesToContextLimit(rawMessages, limit);
  const request: Loose = {
    model: upstreamModel(),
    messages,
    stream,
  };
  const tools = buildOpenaiTools(body);
  if (tools.length > 0) {
    request.tools = tools;
    request.tool_choice = "auto";
  }
  if (stream) request.stream_options = { include_usage: true };
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const rec = body as Loose;
    if (typeof rec.temperature === "number") request.temperature = rec.temperature;
    const maxTokens = rec.max_tokens ?? rec.max_output_tokens;
    if (typeof maxTokens === "number" && maxTokens > 0) request.max_tokens = maxTokens;
  }
  const effort = resolveReasoningEffort(body);
  if (effort) request.reasoning_effort = effort;
  return request;
}

/**
 * Resolve the top-level `reasoning_effort` written into outbound chat bodies.
 *
 * Precedence (audit §5: the CLI has NO local setter for reasoning_effort, so
 * any value arriving in the request body was injected upstream of us rather
 * than chosen by the user in the CLI):
 *   1. `reasoningEffortByModel[incoming.model]` when present — always wins,
 *      replacing whatever the body carried; an empty-string override strips
 *      the field entirely.
 *   2. The incoming body's own `reasoning_effort`, passed through untouched
 *      (trimmed/lowercased) so a caller-side composer can still steer it.
 *   3. The global `reasoningEffort` config default.
 */
function resolveReasoningEffort(body: AnyValue): string | undefined {
  const cfg = resolveConfig();
  const rec = body && typeof body === "object" && !Array.isArray(body) ? (body as Loose) : {};
  const selectedModel = typeof rec.model === "string" ? rec.model : undefined;
  if (selectedModel && cfg?.reasoningEffortByModel && selectedModel in cfg.reasoningEffortByModel) {
    const override = cfg.reasoningEffortByModel[selectedModel]?.trim().toLowerCase();
    return override || undefined;
  }
  const incoming = typeof rec.reasoning_effort === "string" ? rec.reasoning_effort.trim().toLowerCase() : "";
  if (incoming) return incoming;
  const fallback = cfg?.reasoningEffort?.trim().toLowerCase();
  return fallback || undefined;
}

/* ------------------------------------------------------------------ *
 * Stream tool-call merging + node-graph reconstruction (port of main.py)
 * ------------------------------------------------------------------ */

type ToolCall = Loose;

function mergeStreamToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  const mergedByKey = new Map<string, ToolCall>();
  const order: string[] = [];
  let lastKey = "";
  let anon = 0;
  for (const call of toolCalls) {
    const index = call.index;
    const callId = typeof call.id === "string" && call.id ? call.id : null;
    const fn = (call.function && typeof call.function === "object" ? call.function : {}) as Loose;
    const name = typeof fn.name === "string" && fn.name ? fn.name : null;
    const args = typeof fn.arguments === "string" ? fn.arguments : null;
    let key: string;
    if (callId && mergedByKey.has(callId)) key = callId;
    else if (typeof index === "number") key = `index:${index}`;
    else if (callId) key = callId;
    else if (lastKey && !name) key = lastKey;
    else {
      key = `anon:${anon++}`;
    }
    if (!mergedByKey.has(key)) {
      mergedByKey.set(key, {
        id: callId ?? `tool_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        type: "function",
        function: {},
      });
      order.push(key);
    }
    const merged = mergedByKey.get(key)!;
    if (callId) (merged as Loose).id = callId;
    const mergedFn = ((merged as Loose).function ?? {}) as Loose;
    (merged as Loose).function = mergedFn;
    if (name) {
      const oldName = typeof mergedFn.name === "string" ? mergedFn.name : "";
      mergedFn.name = !oldName || (name as string).startsWith(oldName) ? name : oldName;
    }
    if (args != null) {
      const oldArgs = typeof mergedFn.arguments === "string" ? mergedFn.arguments : "";
      mergedFn.arguments = !oldArgs || (args as string).startsWith(oldArgs) ? args : oldArgs + (args as string);
    }
    lastKey = key;
  }
  return order
    .map((k) => mergedByKey.get(k)!)
    .filter((m) => {
      const fn = (m as Loose).function;
      return fn && typeof fn === "object" && (fn as Loose).name;
    });
}

function toolCallsToNodes(toolCalls: ToolCall[], startingId = 2): Loose[] {
  const nodes: Loose[] = [];
  let nodeId = startingId;
  for (const call of mergeStreamToolCalls(toolCalls)) {
    const fn = ((call as Loose).function && typeof (call as Loose).function === "object" ? (call as Loose).function : {}) as Loose;
    const name = fn.name;
    const args = typeof fn.arguments === "string" ? fn.arguments : "{}";
    const callId = (call as Loose).id ?? `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    if (typeof name !== "string" || !name) continue;
    nodes.push({
      id: nodeId,
      type: 5,
      tool_use: { tool_name: name, tool_use_id: String(callId), input_json: args },
    });
    nodeId += 1;
  }
  return nodes;
}

function estimateUsage(openaiRequest: Loose, usage: AnyValue): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    const u = usage as Loose;
    const prompt = Number(u.prompt_tokens ?? 0) | 0;
    const completion = Number(u.completion_tokens ?? 0) | 0;
    const total = Number(u.total_tokens ?? prompt + completion) | 0;
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
  }
  const chars = JSON.stringify(openaiRequest.messages ?? []).length;
  const prompt = Math.max(1, Math.floor(chars / 4));
  return { prompt_tokens: prompt, completion_tokens: 0, total_tokens: prompt };
}

function augmentUsage(openaiRequest: Loose, usage: AnyValue): Loose {
  const basic = estimateUsage(openaiRequest, usage);
  return {
    input_tokens: basic.prompt_tokens,
    output_tokens: basic.completion_tokens,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    system_prompt_tokens: 0,
    chat_history_tokens: 0,
    current_message_tokens: basic.prompt_tokens,
    tool_definitions_tokens: 0,
    tool_result_tokens: 0,
    assistant_response_tokens: basic.completion_tokens,
    max_context_tokens: modelContextTokens(),
    max_output_tokens: modelMaxOutputTokens(),
  };
}

function augmentChatResponse(
  text: string,
  requestId: string,
  openaiRequest: Loose,
  usage: AnyValue,
  toolCalls: ToolCall[] | null,
): Loose {
  const tokenUsage = augmentUsage(openaiRequest, usage);
  const nodes: Loose[] = [];
  if (text) {
    // type-2 "main text finished" pins the full text for uploaded history;
    // the CLI joins per-line `text` deltas itself, so the final line must NOT
    // repeat the full string in `text` (it would double the transcript).
    nodes.push({ id: 1, type: 2, content: text });
  }
  nodes.push(...toolCallsToNodes(toolCalls ?? [], nodes.length + 1));
  // NOTE: response-side node type 10 is a HISTORY-SUMMARY marker, not usage —
  // emitting one here made the CLI treat the turn as a summarization boundary
  // and stall its completion. Usage travels in the top-level `usage` field of
  // the BackChatResult line instead (docs/reverse-engineering-summary.md §3).
  // stop_reason strings map through the CLI's enum by NAME; only
  // END_TURN/TOOL_USE_REQUESTED (etc.) decode meaningfully.
  const stopReason = nodes.some((n) => (n as Loose).type === 5) ? "TOOL_USE_REQUESTED" : "END_TURN";
  return {
    // Empty delta text: the accumulated transcript already has everything.
    text: "",
    request_id: requestId,
    stop_reason: stopReason,
    usage: tokenUsage,
    nodes,
  };
}

/* ------------------------------------------------------------------ *
 * Chat-stream forwarding via the relay gateway
 * ------------------------------------------------------------------ */

/**
 * Build a minimal provider/group station from the redirector's config that
 * `runRelayChatRequestWithKeyFailover` can route to. When `providerKeyFailover`
 * is supplied it is reused verbatim; otherwise a single-key station is
 * synthesized from `upstreamBaseUrl`/`upstreamModel`/`apiKey`.
 */
function resolveRelayStation():
  | { provider: ProviderConfig; group: ChannelGroupConfig; apiKeys: string[] }
  | undefined {
  const cfg = resolveConfig();
  if (!cfg) return undefined;
  if (cfg.providerKeyFailover) {
    return {
      provider: cfg.providerKeyFailover.provider,
      group: cfg.providerKeyFailover.group,
      apiKeys: cfg.providerKeyFailover.apiKeys,
    };
  }
  if (!cfg.apiKey) return undefined;
  const baseUrl = cfg.upstreamBaseUrl.replace(/\/+$/, "");
  const now = Date.now();
  const provider: ProviderConfig = {
    id: "auggie-redirector-upstream",
    kind: "openai",
    name: "auggie-redirector upstream",
    baseUrl,
    nativeModels: [cfg.upstreamModel],
    modelAliases: [],
    createdAt: now,
    updatedAt: now,
  };
  const group: ChannelGroupConfig = {
    id: "auggie-redirector-group",
    name: "auggie-redirector",
    baseUrl,
    status: "enabled",
    groupRatio: 1,
    keyMode: "single",
    models: [cfg.upstreamModel],
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    authType: "bearer",
    credentialMode: "group",
    keys: [cfg.apiKey],
  };
  return { provider, group, apiKeys: [cfg.apiKey] };
}

/**
 * Invoke `runRelayChatRequestWithKeyFailover` with an OpenAI Chat Completions
 * request body. Returns the upstream Response whose body is an SSE stream
 * (stream:true) or a JSON completion (stream:false). The relay gateway
 * internally converts chat→canonical→upstream and normalizes the SSE.
 */
function callRelay(openaiRequest: Loose): Promise<Response> {
  const station = resolveRelayStation();
  const requestId = randomUUID();
  if (!station) {
    // No upstream configured — return a synthetic 502 so callers can surface
    // a stub error without crashing the redirector. Logged loudly: the CLI
    // treats 5xx as retryable and would otherwise loop silently for an hour.
    console.error("[auggie-redirector] chat-stream rejected: no upstream relay configured");
    return Promise.resolve(
      new Response(
        JSON.stringify({
          error: "upstream_unconfigured",
          message: "auggie redirector has no upstream relay descriptor configured",
          request_id: requestId,
        }),
        { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } },
      ),
    );
  }
  const requestInit: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(openaiRequest),
  };
  const relayRequest = new Request("http://auggie-redirector.local/v1/chat/completions", requestInit);
  return pluginHostServices().relay.runChatRequestWithKeyFailover({
    request: relayRequest,
    provider: station.provider,
    group: station.group,
    apiKeys: station.apiKeys,
  });
}

/* ------------------------------------------------------------------ *
 * Upstream usage parsing + accounting ledger
 *
 * Auggie emits no usage/cost data over ACP (no usage_update), so token usage
 * for auggie threads is recovered here: the redirector sees the upstream
 * OpenAI-compatible responses, which carry a usage payload either as the
 * `stream_options.include_usage` chat chunk or on the terminal
 * `response.completed` / non-stream JSON body. Parsed records land in a small
 * bounded ledger that AuggieAgentBridge drains when a turn finalizes and
 * re-emits as `thread/tokenUsage/requestUpdated`, feeding the same
 * requestUsageStore path codex turns use.
 * ------------------------------------------------------------------ */

/** Upper bound on buffered usage records; oldest are dropped first. */
const USAGE_LEDGER_LIMIT = 256;

const usageLedger: AuggieUsageRecord[] = [];

function usageNumber(value: unknown): number | undefined {
  const n = typeof value === "number"
    ? value
    : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

function usageSubObject(value: unknown): Loose | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Loose : undefined;
}

function normalizeAuggieUsageNumbers(usage: Loose): AuggieParsedUsage | null {
  // Accept both OpenAI Chat Completions keys and Responses-API keys.
  const prompt = usageNumber(usage.prompt_tokens ?? usage.input_tokens);
  const completion = usageNumber(usage.completion_tokens ?? usage.output_tokens);
  const total = usageNumber(usage.total_tokens);
  if (prompt === undefined && completion === undefined && total === undefined) return null;
  const cached =
    usageNumber(usageSubObject(usage.prompt_tokens_details)?.cached_tokens)
    ?? usageNumber(usage.cached_tokens)
    ?? usageNumber(usageSubObject(usage.input_tokens_details)?.cached_tokens)
    ?? usageNumber(usage.cache_read_input_tokens);
  const reasoning =
    usageNumber(usageSubObject(usage.completion_tokens_details)?.reasoning_tokens)
    ?? usageNumber(usage.reasoning_tokens)
    ?? usageNumber(usageSubObject(usage.output_tokens_details)?.reasoning_tokens);
  return {
    promptTokens: prompt ?? 0,
    completionTokens: completion ?? 0,
    totalTokens: total ?? (prompt ?? 0) + (completion ?? 0),
    ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
    ...(reasoning !== undefined ? { reasoningOutputTokens: reasoning } : {}),
  };
}

/**
 * Defensive parse of one upstream SSE/JSON frame's usage payload. Handles:
 *   - OpenAI chat chunk with `stream_options.include_usage`: `{usage:{...}}`,
 *   - Responses-API terminal event: `{type:"response.completed",
 *     response:{usage:{input_tokens, output_tokens, ...}}}`,
 *   - non-stream chat body: `{choices:[...], usage:{...}}`.
 * Returns null for anything else (missing usage, wrong shapes, garbage) so
 * absent data degrades silently — no invented numbers.
 */
export function parseAuggieUsageChunk(value: unknown): AuggieParsedUsage | null {
  const rec = usageSubObject(value);
  if (!rec) return null;
  let parsed: AuggieParsedUsage | null = null;
  const direct = normalizeAuggieUsageNumbers(usageSubObject(rec.usage) ?? {});
  if (direct) parsed = direct;
  const responseUsage = normalizeAuggieUsageNumbers(
    usageSubObject(usageSubObject(rec.response)?.usage) ?? {},
  );
  // Later frames win within one stream (the include_usage chunk is last).
  if (responseUsage) parsed = responseUsage;
  return parsed;
}

/**
 * Sum several per-request usage records into one aggregate. Returns null when
 * nothing usable remains (empty input or all-zero totals).
 */
export function aggregateAuggieUsageRecords(
  records: readonly AuggieParsedUsage[],
): AuggieParsedUsage | null {
  let prompt = 0;
  let completion = 0;
  let total = 0;
  let cached: number | undefined;
  let reasoning: number | undefined;
  for (const record of records) {
    prompt += record.promptTokens || 0;
    completion += record.completionTokens || 0;
    total += record.totalTokens || record.promptTokens + record.completionTokens;
    if (record.cachedInputTokens !== undefined) cached = (cached ?? 0) + record.cachedInputTokens;
    if (record.reasoningOutputTokens !== undefined) reasoning = (reasoning ?? 0) + record.reasoningOutputTokens;
  }
  if (total <= 0) return null;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
    ...(reasoning !== undefined ? { reasoningOutputTokens: reasoning } : {}),
  };
}

/**
 * Drain usage records completed at or after `completedAfterMs`. Drained
 * records are removed from the ledger so concurrent turn finalizations each
 * claim every record exactly once (first finalizer wins).
 */
export function takeAuggieUpstreamUsage(completedAfterMs = 0): AuggieUsageRecord[] {
  const taken: AuggieUsageRecord[] = [];
  for (let i = usageLedger.length - 1; i >= 0; i--) {
    const record = usageLedger[i]!;
    if (record.completedAt >= completedAfterMs) {
      taken.unshift(record);
      usageLedger.splice(i, 1);
    }
  }
  return taken;
}

function recordUpstreamUsage(requestId: string, model: string | undefined, usage: AuggieParsedUsage): void {
  const record: AuggieUsageRecord = { ...usage, requestId, completedAt: Date.now(), ...(model ? { model } : {}) };
  usageLedger.push(record);
  if (usageLedger.length > USAGE_LEDGER_LIMIT) {
    usageLedger.splice(0, usageLedger.length - USAGE_LEDGER_LIMIT);
  }
  try {
    resolveConfig()?.onUsage?.(record);
  } catch {
    /* listener errors never break streaming */
  }
}

/* ------------------------------------------------------------------ *
 * forward_stream / forward_json (port of main.py)
 * ------------------------------------------------------------------ */

function compactUpstreamError(message: string, maxChars = 1000): string {
  let text = (message ?? "").trim();
  const lower = text.toLowerCase();
  if (lower.includes("<html") || lower.includes("<!doctype html")) {
    const titleStart = lower.indexOf("<title>");
    const titleEnd = lower.indexOf("</title>");
    let title = "";
    if (titleStart >= 0 && titleEnd > titleStart) {
      title = text.slice(titleStart + "<title>".length, titleEnd).trim();
    }
    text = title ? `HTML upstream error page: ${title}` : "HTML upstream error page returned by gateway";
  }
  if (text.length > maxChars) text = text.slice(0, maxChars).trimEnd() + "...";
  return text;
}

function forwardJsonError(res: http.ServerResponse, message: string, status = 502): void {
  sendJson(res, status, { error: "upstream_error", message: compactUpstreamError(message, 2000) });
}

async function forwardJson(body: JsonValue, res: http.ServerResponse): Promise<void> {
  const openaiRequest = buildOpenaiRequest(body, false);
  const requestId = randomUUID();
  let relayResponse: Response;
  try {
    relayResponse = await callRelay(openaiRequest);
  } catch (error) {
    forwardJsonError(res, error instanceof Error ? error.message : String(error));
    return;
  }
  if (!relayResponse.ok) {
    const text = await relayResponse.text().catch(() => "");
    forwardJsonError(res, text, relayResponse.status === 401 || relayResponse.status === 403 ? 502 : relayResponse.status);
    return;
  }
  const raw = await relayResponse.text();
  let data: AnyValue = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  const text = extractChatText(data);
  let toolCalls: ToolCall[] = [];
  const choices = (data as Loose).choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const message = (first as Loose).message;
      if (message && typeof message === "object" && !Array.isArray(message)) {
        const tcs = (message as Loose).tool_calls;
        if (Array.isArray(tcs)) {
          toolCalls = tcs.filter((t): t is Loose => t && typeof t === "object" && !Array.isArray(t));
        }
      }
    }
  }
  const usage = (data as Loose).usage;
  const parsedUsage = parseAuggieUsageChunk(data);
  if (parsedUsage) recordUpstreamUsage(requestId, upstreamModel(), parsedUsage);
  const finalResponse = augmentChatResponse(text, requestId, openaiRequest, usage, toolCalls);
  sendJson(res, 200, finalResponse);
}

function extractChatText(data: AnyValue): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const rec = data as Loose;
  const choices = rec.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const f = first as Loose;
      const message = f.message;
      if (message && typeof message === "object" && !Array.isArray(message)) {
        return textFromValue((message as Loose).content);
      }
      return textFromValue(f.text);
    }
  }
  return textFromValue(rec.text ?? rec.content);
}

async function forwardStream(body: JsonValue, res: http.ServerResponse): Promise<void> {
  const openaiRequest = buildOpenaiRequest(body, true);
  const requestId = randomUUID();
  let relayResponse: Response;
  try {
    relayResponse = await callRelay(openaiRequest);
  } catch (error) {
    sendJson(res, 502, {
      error: "upstream_error",
      message: compactUpstreamError(error instanceof Error ? error.message : String(error)),
      request_id: requestId,
    });
    return;
  }
  if (!relayResponse.ok || !relayResponse.body) {
    const text = await relayResponse.text().catch(() => "");
    log(`upstream error status=${relayResponse.status} body=${compactUpstreamError(text, 400)}`);
    sendJson(res, relayResponse.status === 401 || relayResponse.status === 403 ? 502 : relayResponse.status, {
      error: "upstream_error",
      message: compactUpstreamError(text, 2000),
      status: relayResponse.status,
      request_id: requestId,
    });
    return;
  }
  log(`upstream ${relayResponse.status} ${relayResponse.headers.get("content-type") ?? ""} streaming`);

  // Send the streaming response headers. The body is chunked JSON-lines (like
  // main.py): each chunk is a JSON object terminated by "\n". The chunked
  // transfer framing is written BY HAND below (matching main.py byte-for-byte)
  // because Bun's node:http compatibility layer does not reliably auto-frame
  // when Transfer-Encoding is declared manually — strict HTTP clients (the
  // CLI's undici fetch) then stall on the malformed body even though lenient
  // readers (Bun's own fetch) parse it fine.
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "Transfer-Encoding": "chunked",
  });

  // Payload framing: with "Transfer-Encoding: chunked" declared in the
  // headers above, Node's http.ServerResponse applies chunked framing to
  // every res.write itself. Writing manual chunk-size lines here too would
  // double-encode (the CLI would unwrap once and try to JSON.parse the inner
  // framing bytes, silently dropping every line), so write the raw payload
  // and let Node frame it.
  const writeChunk = (value: Loose): void => {
    res.write(Buffer.from(JSON.stringify(value) + "\n", "utf-8"));
    // Bun's node:http compat layer buffers writes made from async callbacks
    // (e.g. after awaiting the upstream stream) until an explicit flush; the
    // CLI then sees the heartbeat but never the deltas. Node has no such
    // method, hence the optional call.
    (res as { flush?: () => void }).flush?.();
    const sock = (res as { socket?: { writableLength?: number; destroyed?: boolean } }).socket;
    log(`post-write socket writableLength=${sock?.writableLength ?? "?"} destroyed=${sock?.destroyed ?? "?"}`);
  };

  const accumulated: string[] = [];
  let reasoningNodeId = 5000;
  const streamStartedAt = Date.now();
  log(`forwardStream begin (headers+heartbeat next)`);
  const toolCalls: ToolCall[] = [];
  let usage: AnyValue = null;
  // Usage parsed from whichever upstream frame carries it (chat include_usage
  // chunk or the terminal response.completed event); recorded once the stream
  // is fully consumed so a mid-stream failure still keeps the last seen value.
  let parsedUsage: AuggieParsedUsage | null = null;

  // Send the opening heartbeat. main.py emits it before reading upstream.
  writeChunk({ text: "", heartbeat: true, request_id: requestId });

  try {
    // The relay gateway emits a responses-API SSE stream even for chat inbound
    // (it translates everything to canonical then back to responses events on
    // the translate path). Parse the SSE and extract per-delta text + tool
    // call accumulation, mirroring main.py's read of the upstream SSE.
    await consumeResponsesSse(relayResponse.body, (eventName, data) => {
      if (!data) return;
      log(`sse frame ${eventName ?? "-"}`);
      if (data.length < 600) log(`sse data ${data}`);
      else {
        try {
          const preview = JSON.parse(data) as Loose;
          const choice0 = Array.isArray(preview.choices) && preview.choices[0]
            ? JSON.stringify((preview.choices[0] as Loose).delta ?? (preview.choices[0] as Loose))
            : "n/a";
          log(`sse delta0 ${choice0.slice(0, 300)}`);
        } catch { /* keep terse */ }
      }
      let value: AnyValue;
      try {
        value = JSON.parse(data);
      } catch {
        return;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const rec = value as Loose;
      parsedUsage = parseAuggieUsageChunk(value) ?? parsedUsage;
      const type = (rec.type as string) ?? eventName;
      if (!type && Array.isArray(rec.choices)) {
        // OpenAI chat-completion chunk. For chat inbound the relay gateway
        // forces effectiveProtocol "openai" and re-emits canonical events as
        // chat.completion.chunk SSE (no `type` field), so this branch — not
        // the responses-API branches below — carries the actual stream.
        for (const choice of rec.choices) {
          if (!choice || typeof choice !== "object" || Array.isArray(choice)) continue;
          const delta = (choice as Loose).delta;
          if (!delta || typeof delta !== "object" || Array.isArray(delta)) continue;
          const d = delta as Loose;
          // Reasoning models (e.g. minimax-m3, deepseek-r1) stream their
          // thinking as `delta.reasoning_content` before any visible content.
          // The chat-stream contract has no reasoning field, but the CLI
          // consumes thinking via type-8 nodes — forward it there. Without
          // this the CLI sees a long run of empty lines, treats the response
          // as empty, and silently stalls the turn.
          if (typeof d.reasoning_content === "string" && d.reasoning_content.length > 0) {
            writeChunk({
              text: "",
              nodes: [{ id: reasoningNodeId++, type: 8, thinking: { content: d.reasoning_content } }],
              request_id: requestId,
            });
          }
          if (typeof d.content === "string" && d.content.length > 0) {
            accumulated.push(d.content);
            log(`chat delta ${JSON.stringify(d.content).slice(0, 30)} at ${Date.now() - streamStartedAt}ms`);
            writeChunk({ text: d.content, delta: d.content, request_id: requestId });
          }
          if (Array.isArray(d.tool_calls)) {
            for (const rawCall of d.tool_calls) {
              if (!rawCall || typeof rawCall !== "object" || Array.isArray(rawCall)) continue;
              const call = rawCall as Loose;
              const fn = call.function && typeof call.function === "object" ? call.function as Loose : undefined;
              toolCalls.push({
                index: typeof call.index === "number" ? call.index : 0,
                id: typeof call.id === "string" ? call.id : undefined,
                function: {
                  name: typeof fn?.name === "string" ? fn.name : undefined,
                  arguments: typeof fn?.arguments === "string" ? fn.arguments : undefined,
                },
              });
            }
          }
        }
        return;
      }
      if (type === "response.output_text.delta") {
        const delta = typeof rec.delta === "string" ? rec.delta : "";
        if (delta) {
          accumulated.push(delta);
          log(`stream delta ${JSON.stringify(delta).slice(0, 40)} -> ${requestId}`);
          writeChunk({ text: delta, delta, request_id: requestId });
        }
        return;
      }
      if (type === "response.function_call_arguments.delta") {
        // Track per-index tool call; map to OpenAI tool_calls shape so
        // tool_calls_to_nodes / merge_stream_tool_calls can reconstruct nodes.
        const index = typeof rec.output_index === "number" ? rec.output_index : 0;
        const id = typeof rec.item_id === "string" ? rec.item_id : undefined;
        const delta = typeof rec.delta === "string" ? rec.delta : "";
        toolCalls.push({ index, id, function: { arguments: delta } });
        return;
      }
      if (type === "response.output_item.added" || type === "response.output_item.done") {
        const item = rec.item;
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const i = item as Loose;
          const itemType = i.type;
          if (itemType === "function_call" || itemType === "custom_tool_call") {
            const index = typeof rec.output_index === "number" ? rec.output_index : 0;
            const id = (i.call_id ?? i.id) as string | undefined;
            const name = i.name as string | undefined;
            const args = i.arguments as string | undefined;
            toolCalls.push({
              index,
              id: typeof id === "string" ? id : undefined,
              function: {
                name: typeof name === "string" ? name : undefined,
                arguments: typeof args === "string" ? args : undefined,
              },
            });
          }
        }
        return;
      }
      if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
        const response = rec.response;
        if (response && typeof response === "object" && !Array.isArray(response)) {
          const r = response as Loose;
          const u = r.usage;
          if (u && typeof u === "object" && !Array.isArray(u)) {
            usage = u;
          }
          // Capture any terminal tool calls that arrived bundled in the final
          // output (not streamed as argument deltas).
          const output = r.output;
          if (Array.isArray(output)) {
            for (const rawItem of output) {
              if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
              const item = rawItem as Loose;
              const itemType = item.type;
              if (itemType === "function_call" || itemType === "custom_tool_call") {
                const id = (item.call_id ?? item.id) as string | undefined;
                const name = item.name as string | undefined;
                const args = item.arguments as string | undefined;
                toolCalls.push({
                  id: typeof id === "string" ? id : undefined,
                  function: {
                    name: typeof name === "string" ? name : undefined,
                    arguments: typeof args === "string" ? args : undefined,
                  },
                });
              }
            }
          }
        }
        if (type === "response.failed") return true;
        return;
      }
      return;
    });
  } catch (error) {
    writeChunk({
      error: "upstream_error",
      message: compactUpstreamError(error instanceof Error ? error.message : String(error)),
      request_id: requestId,
    });
  } finally {
    if (parsedUsage) recordUpstreamUsage(requestId, upstreamModel(), parsedUsage);
    const finalText = accumulated.join("");
    const final = augmentChatResponse(finalText, requestId, openaiRequest, usage, toolCalls);
    (final as Loose).done = true;
    writeChunk(final);
    // Node emits the zero-length terminator chunk on res.end() now that the
    // framing is automatic.
    res.end();
  }
}

/**
 * Minimal SSE consumer for the relay's responses-API event stream. Invokes
 * `onEvent(eventName, data)` for each `data:` payload; return true to stop.
 */
async function consumeResponsesSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (eventName: string | undefined, data: string) => boolean | void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        if (dispatchSseFrame(frame, onEvent)) return;
      }
      if (done) break;
    }
    if (buffer.trim()) dispatchSseFrame(buffer, onEvent);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function dispatchSseFrame(
  frame: string,
  onEvent: (eventName: string | undefined, data: string) => boolean | void,
): boolean {
  let eventName: string | undefined;
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? onEvent(eventName, data.join("\n")) === true : false;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Hard cap on how much of a request body we buffer (drain-only beyond this). */
const MAX_BUFFERED_BODY_BYTES = 64 * 1024 * 1024;

async function readJson(req: http.IncomingMessage): Promise<JsonValue> {
  const length = Number(req.headers["content-length"] ?? "0");
  if (!Number.isFinite(length) || length <= 0) return {};
  const chunks: Buffer[] = [];
  let buffered = 0;
  // Drain the request stream to its natural end. Breaking out of the iterator
  // as soon as Content-Length bytes have been seen leaves the stream paused
  // mid-flight, and Bun's node:http compat then tears the connection down
  // before our response is written (client sees an empty 200 +
  // "Connection: close"). Always run the stream dry; only buffering is capped.
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    if (buffered < MAX_BUFFERED_BODY_BYTES) {
      chunks.push(buf);
      buffered += buf.length;
    }
  }
  const raw = Buffer.concat(chunks);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf-8")) as JsonValue;
  } catch {
    // Mirror main.py's degraded fallback so malformed bodies don't crash.
    return { _raw: raw.toString("utf-8") } as Record<string, JsonValue> as JsonValue;
  }
}

function sendJson(res: http.ServerResponse, status: number, value: JsonValue | Loose): void {
  const data = Buffer.from(JSON.stringify(value), "utf-8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(data.length),
    "Cache-Control": "no-cache",
  });

  res.end(data);
}
