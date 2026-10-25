import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { ChannelGroupConfig } from "@codex-ui/shared";
import {
  FREEBUFF_BASE_URL,
  DEFAULT_FREEBUFF_MODELS,
  fetchFreebuffFreeModels,
  resolveLocalFreebuffCredentials
} from "./freebuffSession.js";

export {
  FREEBUFF_BASE_URL,
  DEFAULT_FREEBUFF_MODELS,
  fetchFreebuffFreeModels,
  resolveLocalFreebuffCredentials
};

export const OMNIROUTE_FREE_PROVIDER_ID = "omniroute-free";
export const OMNIROUTE_FREE_BASE_URL = "https://opencode.ai/zen/v1";
export const KILOCODE_FREE_BASE_URL = "https://api.kilo.ai/api/openrouter";
export const KILOCODE_USER_AGENT = "opencode-kilo-provider";
export const CLINE_FREE_BASE_URL = "https://api.cline.bot/api/v1";
export const CLINE_RECOMMENDED_MODELS_URL = "https://api.cline.bot/api/v1/ai/cline/recommended-models";
export const CLINE_CLIENT_VERSION = "4.1.16";
export const OPENCODE_CLIENT_VERSION = "1.18.31";
export const OPENCODE_DEFAULT_USER_AGENT = "opencode/1.18.31";
/** Canonical OpenCode session id shape: `ses_` + 12 hex + 14 base62 (upstream validates shape). */
export const OPENCODE_SESSION_PATTERN = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
/** Same shape for the request id, which the upstream accepts but does not validate. */
export const OPENCODE_REQUEST_PATTERN = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const OPENCODE_MIN_USER_AGENT_MINOR = 17;
const OPENCODE_USER_AGENT_VERSION_RE = /opencode\/(?:[a-z]+\/)?v?(\d+)\.(\d+)/i;
const OPENCODE_GENERIC_CLIENT_UA_RE =
  /^(?:curl|wget|libcurl|python-requests|python-httpx|python-urllib|aiohttp|httpie|node-fetch|node|undici|axios|got|ky|bun|deno|go-http-client|okhttp|java|apache-httpclient|postmanruntime|insomnia|openai|anthropic|async ?openai|openai-python)(?:[/\s]|$)/i;
export function satisfiesOpencodeUserAgentContract(userAgent: string | null | undefined): boolean {
  const match = String(userAgent || "").match(OPENCODE_USER_AGENT_VERSION_RE);
  if (!match) return false;
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > 1 || (major === 1 && minor >= OPENCODE_MIN_USER_AGENT_MINOR);
}
export function isGenericOpencodeClientUserAgent(userAgent: string | null | undefined): boolean {
  const value = String(userAgent || "").trim();
  return !value || OPENCODE_GENERIC_CLIENT_UA_RE.test(value);
}
const OPENCODE_BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function base62FromBytes(bytes: Buffer, length: number): string {
  return Array.from(bytes.subarray(0, length), (byte) => OPENCODE_BASE62[byte % 62]).join("");
}
/** Render an id in the canonical OpenCode shape (`prefix` + 12 hex + 14 base62). */
export function canonicalOpencodeId(prefix: "ses_" | "msg_", seed?: string): string {
  const bytes = seed !== undefined
    ? createHash("sha256").update("opencode\0" + prefix + "\0" + seed).digest()
    : randomBytes(32);
  return prefix + bytes.subarray(0, 6).toString("hex") + base62FromBytes(bytes.subarray(6), 14);
}
export const OPENCODE_CLI_VERSION_FALLBACK = OPENCODE_CLIENT_VERSION;
const OPENCODE_NPM_LATEST_URL = "https://registry.npmjs.org/opencode-ai/latest";
const OPENCODE_CLI_VERSION_TTL_MS = 6 * 60 * 60 * 1000;
const OPENCODE_CLI_FETCH_TIMEOUT_MS = 5_000;
let cachedOpencodeCliVersion: string | null = null;
let cachedOpencodeCliVersionAt = 0;
let opencodeCliVersionInFlight: Promise<string> | null = null;
function isOpencodeCliVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value.trim());
}
export function getCachedOpencodeCliVersion(): string {
  if (cachedOpencodeCliVersion && Date.now() - cachedOpencodeCliVersionAt < OPENCODE_CLI_VERSION_TTL_MS) return cachedOpencodeCliVersion;
  return cachedOpencodeCliVersion ?? OPENCODE_CLI_VERSION_FALLBACK;
}
export function refreshOpencodeCliVersion(): Promise<string> {
  if (cachedOpencodeCliVersion && Date.now() - cachedOpencodeCliVersionAt < OPENCODE_CLI_VERSION_TTL_MS) {
    return Promise.resolve(cachedOpencodeCliVersion);
  }
  if (opencodeCliVersionInFlight) return opencodeCliVersionInFlight;
  opencodeCliVersionInFlight = (async () => {
    try {
      const response = await globalThis.fetch(OPENCODE_NPM_LATEST_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(OPENCODE_CLI_FETCH_TIMEOUT_MS),
      });
      const payload = response.ok ? ((await response.json()) as { version?: unknown }) : null;
      const version = typeof payload?.version === "string" ? payload.version.trim() : "";
      if (isOpencodeCliVersion(version)) {
        cachedOpencodeCliVersion = version;
        cachedOpencodeCliVersionAt = Date.now();
      }
    } catch {
      // Registry unreachable — stale cache / pin stay valid.
    }
    return cachedOpencodeCliVersion ?? OPENCODE_CLI_VERSION_FALLBACK;
  })();
  const current = opencodeCliVersionInFlight;
  void current.finally(() => {
    if (opencodeCliVersionInFlight === current) opencodeCliVersionInFlight = null;
  });
  return current;
}
function keepsOpencodeClientUserAgent(userAgent: string | undefined, keepAgentUserAgent: boolean): boolean {
  if (satisfiesOpencodeUserAgentContract(userAgent)) return true;
  return keepAgentUserAgent && !isGenericOpencodeClientUserAgent(userAgent);
}
/** CLI identity defaults the upstream expects; `gated` = free-tier request under contract. */
export function resolveOpencodeCliDefaults(
  providerId: string,
  gated: boolean
): { userAgent: string; client: string; project: string } | undefined {
  if (/^(0|false|no|off)$/i.test(process.env.OPENCODE_SYNTHESIZE_CLI_HEADERS?.trim() ?? "")) {
    return undefined;
  }
  const envKey = `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_USER_AGENT`;
  const configuredUA = process.env[envKey]?.trim() || process.env.OPENCODE_USER_AGENT?.trim();
  // Same test guard as upstream `opencodeHeaders.ts`: test runners stub
  // global fetch and count dispatches, so the npm registry lookup must not run there.
  if (!process.env.NODE_TEST_CONTEXT && !process.env.VITEST && process.env.NODE_ENV !== "test") {
    void refreshOpencodeCliVersion();
  }
  return {
    userAgent:
      configuredUA && (!gated || satisfiesOpencodeUserAgentContract(configuredUA))
        ? configuredUA
        : `opencode/${getCachedOpencodeCliVersion()}`,
    client: process.env.OPENCODE_CLIENT?.trim() || "desktop",
    project: process.env.OPENCODE_PROJECT?.trim() || "global",
  };
}
// `OPENCODE_FREE_MODELS` (zen.go:106): models usable keyless. The `-free`
// entries are also covered by the suffix rule below; they are listed
// explicitly so this catalog stays byte-identical to the reference gateway.
const OPENCODE_FREE_MODELS = new Set([
  "big-pickle",
  "deepseek-v4-flash-free",
  "mimo-v2.5-free",
  "hy3-free",
  "nemotron-3-ultra-free",
  "north-mini-code-free",
]);
export function isPremiumOpencodeModel(model: string, provider: string): boolean {
  // opencode-go has no free tier — every model requires a key.
  if (provider === "opencode-go") return true;

  // Models ending in `-free` are always free on the noauth/zen tier.
  if (model.endsWith("-free")) return false;

  // Check the known free model catalog.
  return !OPENCODE_FREE_MODELS.has(model);
}
export function isGatedOpencodeFreeTierRequest(model: string, provider?: string, surface?: string): boolean {
  if (!model.trim()) return false;
  const resolvedSurface = surface ?? "zen";
  if (resolvedSurface !== "zen") return false;
  return !isPremiumOpencodeModel(model, provider ?? "opencode");
}

/** Upstream surface told apart by registry `baseUrl` (opencodeFreeTierContract.ts). */
export type OpencodeSurface = "zen" | "go" | "other";
const OPENCODE_ZEN_SURFACE_BASE_URL = "https://opencode.ai/zen/v1";
const OPENCODE_GO_SURFACE_BASE_URL = "https://opencode.ai/zen/go/v1";
export function surfaceFromBaseUrl(baseUrl: string | null | undefined): OpencodeSurface {
  if (baseUrl === OPENCODE_ZEN_SURFACE_BASE_URL) return "zen";
  if (baseUrl === OPENCODE_GO_SURFACE_BASE_URL) return "go";
  return "other";
}

/** Request body fields used for the conversation-stable session fingerprint. */
export interface OpencodeSessionBody {
  model?: string;
  system?: unknown;
  messages?: Array<{ role?: string; content?: unknown }>;
  input?: Array<{ role?: string; content?: unknown }>;
  tools?: Array<{ name?: string; function?: { name?: string } }>;
  metadata?: unknown;
  session_id?: unknown;
  thread_id?: unknown;
}

/** Keep only fingerprint/identity inputs; never add this projection to an upstream body. */
export function projectOpencodeSessionBody(body: unknown): OpencodeSessionBody | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const input = body as Record<string, unknown>;
  return {
    model: typeof input.model === "string" ? input.model : undefined,
    system: input.system,
    messages: Array.isArray(input.messages) ? (input.messages as OpencodeSessionBody["messages"]) : undefined,
    input: Array.isArray(input.input) ? (input.input as OpencodeSessionBody["input"]) : undefined,
    tools: Array.isArray(input.tools) ? (input.tools as OpencodeSessionBody["tools"]) : undefined,
    metadata: input.metadata,
    session_id: input.session_id,
    thread_id: input.thread_id,
  };
}

function opencodeHashShort(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

function extractOpencodeSystemPrompt(body: OpencodeSessionBody | null | undefined): string | null {
  if (!body || typeof body !== "object") return null;
  if (body.system) return typeof body.system === "string" ? body.system : JSON.stringify(body.system);
  if (Array.isArray(body.messages)) {
    const sys = body.messages.find((m) => m?.role === "system" || m?.role === "developer");
    if (sys) return typeof sys.content === "string" ? sys.content : JSON.stringify(sys.content);
  }
  return null;
}

function extractOpencodeFirstUserMessage(body: OpencodeSessionBody | null | undefined): string | null {
  if (!body || typeof body !== "object") return null;
  const messages = body.messages || body.input || [];
  if (!Array.isArray(messages)) return null;
  for (const msg of messages) {
    if (msg?.role === "user") return typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  }
  return null;
}

/** Stable session fingerprint from request characteristics (sessionManager.ts verbatim). */
export function generateOpencodeSessionId(
  body: OpencodeSessionBody | null | undefined,
  options: { provider?: string; connectionId?: string } = {},
): string | null {
  if (!body || typeof body !== "object") return null;
  const parts: string[] = [];
  if (body.model) parts.push(`model:${body.model}`);
  if (options.provider) parts.push(`provider:${options.provider}`);
  const systemPrompt = extractOpencodeSystemPrompt(body);
  if (systemPrompt) parts.push(`sys:${opencodeHashShort(systemPrompt)}`);
  const firstUser = extractOpencodeFirstUserMessage(body);
  if (firstUser) parts.push(`user0:${opencodeHashShort(firstUser)}`);
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    const toolNames = body.tools.map((t) => t.name || t.function?.name || "").filter(Boolean).sort().join(",");
    if (toolNames) parts.push(`tools:${opencodeHashShort(toolNames)}`);
  }
  if (options.connectionId) parts.push(`conn:${options.connectionId}`);
  if (parts.length === 0) return null;
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

const OPENCODE_IDENTITY_HEADER_NAMES = [
  "x-opencode-session",
  "x-ultra-thread-id",
  "x-codex-thread-id",
  "x-session-affinity",
  "x-session-id",
  "x-claude-code-session-id",
  "session_id",
  "session-id",
  "x-session_id",
  "thread_id",
  "thread-id",
  "x-thread-id",
] as const;
const OPENCODE_IDENTITY_BODY_NAMES = [
  "session_id",
  "sessionId",
  "thread_id",
  "threadId",
  "conversation_id",
  "conversationId",
] as const;

function opencodeIdentityRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function opencodeIdentityValue(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 256) return undefined;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) return undefined;
  }
  return value.trim() || undefined;
}

function opencodeBodyIdentity(value: unknown): string | undefined {
  const input = opencodeIdentityRecord(value);
  if (!input) return undefined;
  for (const key of OPENCODE_IDENTITY_BODY_NAMES) {
    const id = opencodeIdentityValue(input[key]);
    if (id) return id;
  }
  return undefined;
}

function opencodeClaudeIdentity(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return undefined;
  try {
    return opencodeBodyIdentity(JSON.parse(value));
  } catch {
    return undefined;
  }
}

/** Headers win over metadata; an opaque user/account ID is never a session ID. */
export function resolveOpencodeSessionIdentity(
  headers: Record<string, string> | Headers | null | undefined,
  body?: unknown,
): string | undefined {
  const normalized = new Map<string, string>();
  if (headers) {
    if (typeof (headers as Headers).forEach === "function") {
      (headers as Headers).forEach((value, key) => normalized.set(key.toLowerCase(), value));
    } else {
      for (const [key, value] of Object.entries(headers as Record<string, string>)) normalized.set(key.toLowerCase(), value);
    }
  }
  for (const name of OPENCODE_IDENTITY_HEADER_NAMES) {
    const id = opencodeIdentityValue(normalized.get(name));
    if (id) return id;
  }
  const input = opencodeIdentityRecord(body);
  const metadata = opencodeIdentityRecord(input?.metadata);
  return opencodeBodyIdentity(metadata) || opencodeClaudeIdentity(metadata?.user_id) || opencodeBodyIdentity(input);
}

/** The session id the caller supplied, if any. */
export function clientSuppliedOpencodeSession(
  clientHeaders: Record<string, string> | Headers | null | undefined,
  body?: unknown,
): string | undefined {
  return resolveOpencodeSessionIdentity(clientHeaders, body);
}
const OPENCODE_MODEL_PREFIXES = ["opencode/", "oc/", "opencode-zen/", "opencode-go/"] as const;

/** Strip `opencode/`-family prefixes: Responses endpoint only accepts the bare upstream id. */
export function stripOpencodeModelPrefix(model: unknown): unknown {
  if (typeof model !== "string") return model;
  for (const prefix of OPENCODE_MODEL_PREFIXES) {
    if (model.startsWith(prefix)) return model.slice(prefix.length);
  }
  return model;
}

/**
 * muse-spark (opencode-go) burns its entire output budget on invisible
 * server-side reasoning before emitting any content. Floor raised budgets
 * only — explicit large budgets and non-muse-spark models are untouched,
 * and no budget is synthesized when the caller set none.
 * Exact copy of `opencodeMuseSpark.ts`.
 */
export const MUSE_SPARK_MIN_OUTPUT_TOKENS = 512;

export function applyMuseSparkMinOutputTokens(model: string, body: Record<string, unknown>): void {
  if (!model.startsWith("muse-spark")) return;
  if (typeof body.max_tokens === "number" && Number.isFinite(body.max_tokens)) {
    if (body.max_tokens < MUSE_SPARK_MIN_OUTPUT_TOKENS) {
      body.max_tokens = MUSE_SPARK_MIN_OUTPUT_TOKENS;
    }
  }
  if (typeof body.max_output_tokens === "number" && Number.isFinite(body.max_output_tokens)) {
    if (body.max_output_tokens < MUSE_SPARK_MIN_OUTPUT_TOKENS) {
      body.max_output_tokens = MUSE_SPARK_MIN_OUTPUT_TOKENS;
    }
  }
}

const OPENCODE_MUSE_SPARK_ALIASES = new Set(["oc", "opencode", "opencode-zen", "opencode-go"]);
const OPENCODE_MUSE_SPARK_PATTERN = /^muse-spark(?:-|$)/i;
const OPENCODE_GENERIC_EFFORT_SUFFIX_RE = /-(?:ultra|max|xhigh|high|medium|low|none)$/i;

/** Registry targetFormat: muse-spark family is Responses-only, everything else is Chat Completions.
 * Mirrors upstream `resolveOpencodeTargetFormat(provider, model)` =
 * `getModelTargetFormat(aliasedProvider, model) || "openai"`: alias `opencode` -> `oc`,
 * strip `opencode/`-family prefix and `-<effort>` suffix before the format lookup.
 * Catalog rows are muse-spark-only on this provider, so the family check plus the
 * generic effort-suffix fallback below covers every `getModelTargetFormat` branch
 * reachable for `oc`/`opencode-zen`/`opencode-go` without importing the registry. */
export function resolveOpencodeTargetFormat(provider: string, model: string): string {
  const rawProvider = String(provider ?? "").trim() || "opencode";
  const aliased = rawProvider === "opencode" ? "oc" : rawProvider;
  const stripped = String(stripOpencodeModelPrefix(model) ?? "");
  const parsed = parseOpencodeEffortLevel(stripped) ?? parseOpencodeEffortLevel(String(model ?? ""));
  const bare = parsed ? parsed.baseModel : stripped;
  const familyId = bare.split("/").pop() || bare;
  if (OPENCODE_MUSE_SPARK_ALIASES.has(aliased) && OPENCODE_MUSE_SPARK_PATTERN.test(familyId)) {
    return "openai-responses";
  }
  // Generic effort-suffix fallback (mirrors the `effortStripped` branch of
  // `getModelTargetFormat`): `muse-spark-1.3-contributor-xhigh` etc. keep the base
  // model's Responses endpoint even when the suffix is not a registered tier.
  const effortStripped = familyId.replace(OPENCODE_GENERIC_EFFORT_SUFFIX_RE, "");
  if (effortStripped !== familyId && OPENCODE_MUSE_SPARK_ALIASES.has(aliased) && OPENCODE_MUSE_SPARK_PATTERN.test(effortStripped)) {
    return "openai-responses";
  }
  return "openai";
}

const OPENCODE_THINKING_MODEL_PATTERNS: RegExp[] = [/deepseek/i, /\bkimi\b/i, /\bk2\b/i, /\bminimax\b/i, /\bmimo\b/i];

/** Thinking-mode families that require `reasoning_content` echo (else upstream 400). */
export function isOpencodeThinkingMessageModel(model: string | undefined | null): boolean {
  if (!model || typeof model !== "string") return false;
  return OPENCODE_THINKING_MODEL_PATTERNS.some((re) => re.test(model));
}

function opencodeHasNonEmptyReasoningContent(message: Record<string, unknown>): boolean {
  return typeof message.reasoning_content === "string" && (message.reasoning_content as string).trim().length > 0;
}

/** Inject a placeholder `reasoning_content` on assistant messages lacking one. Idempotent. */
export function injectOpencodeReasoningContentForThinkingModel<T>(body: T): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.messages)) return body;
  let modified = false;
  const messages = (record.messages as unknown[]).map((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return message;
    const entry = message as Record<string, unknown>;
    if (entry.role !== "assistant") return message;
    if (opencodeHasNonEmptyReasoningContent(entry)) return message;
    modified = true;
    return { ...entry, reasoning_content: " " };
  });
  return modified ? ({ ...record, messages } as T) : body;
}

export const OPENCODE_ENUM_TRIGGER_VALUES = 250;
export const OPENCODE_ENUM_TRIGGER_CHARS = 15000;
export const OPENCODE_ENUM_MAX_VALUES = 200;
export const OPENCODE_ENUM_MAX_CHARS = 12000;

function opencodeEnumValueLength(value: unknown): number {
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value ?? null)?.length ?? 4;
  } catch {
    return String(value).length;
  }
}

function opencodeCombinedEnumLength(values: unknown[]): number {
  let total = 0;
  for (const value of values) total += opencodeEnumValueLength(value);
  return total;
}

function opencodeTrimSchemaNode(node: unknown, seen: Set<unknown>): number {
  if (!node || typeof node !== "object" || seen.has(node)) return 0;
  seen.add(node);
  if (Array.isArray(node)) {
    let count = 0;
    for (const item of node) count += opencodeTrimSchemaNode(item, seen);
    return count;
  }
  const record = node as Record<string, unknown>;
  let count = 0;
  const values = record.enum;
  if (
    Array.isArray(values) &&
    (values.length > OPENCODE_ENUM_TRIGGER_VALUES ||
      opencodeCombinedEnumLength(values) > OPENCODE_ENUM_TRIGGER_CHARS)
  ) {
    let kept = values.slice(0, OPENCODE_ENUM_MAX_VALUES);
    while (kept.length > 1 && opencodeCombinedEnumLength(kept) > OPENCODE_ENUM_MAX_CHARS) {
      kept = kept.slice(0, -1);
    }
    const omitted = values.length - kept.length;
    record.enum = kept;
    const note = `(+${omitted} more values allowed; list truncated for provider limits)`;
    record.description =
      typeof record.description === "string" && record.description.length > 0
        ? `${record.description} ${note}`
        : note;
    count += 1;
  }
  for (const key of Object.keys(record)) {
    if (key === "enum") continue;
    count += opencodeTrimSchemaNode(record[key], seen);
  }
  return count;
}

/** Cap oversized enums (upstream 400 past 250 values / 15000 chars). Schema-shape agnostic. */
export function trimOpencodeOversizedToolEnums(tools: unknown): number {
  if (!Array.isArray(tools)) return 0;
  const seen = new Set<unknown>();
  let trimmed = 0;
  for (const tool of tools) trimmed += opencodeTrimSchemaNode(tool, seen);
  return trimmed;
}

function opencodeClientToolNamesOf(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const tools = (body as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) return [];
  const names: string[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    const entry = tool as { name?: unknown; function?: { name?: unknown } };
    const name = typeof entry.name === "string" ? entry.name : entry.function?.name;
    if (typeof name === "string") names.push(name);
  }
  return names;
}

const OPENCODE_PLACEHOLDER_TOOL_DESCRIPTION =
  "Do not call this tool. It exists only for API compatibility and must never be invoked.";
const OPENCODE_PLACEHOLDER_TOOL_PARAMETERS = { type: "object", properties: {} } as const;
/**
 * Genuine `read` tool captured from the official CLI (opencodeKernel.ts).
 * The upstream free-tier gate refuses third-party tool vocabularies; a
 * synthetic placeholder no longer passes (live 2026-10-20: `_noop` alone ->
 * 403 FreeTierError, `_noop` + genuine `read` -> 200). Parameters must be
 * genuine; the description is optional upstream.
 */
const OPENCODE_READ_TOOL_NAME = "read";
const OPENCODE_READ_TOOL_PARAMETERS = {
  properties: {
    filePath: {
      description: "The absolute path to the file or directory to read",
      type: "string",
    },
    offset: {
      description: "The line number to start reading from (1-indexed)",
      type: "integer",
    },
    limit: {
      description: "The maximum number of lines to read (defaults to 2000)",
      type: "integer",
    },
  },
  required: ["filePath"],
  type: "object",
} as const;

function opencodeToolEntryName(tool: unknown): string | null {
  if (!tool || typeof tool !== "object") return null;
  const entry = tool as { name?: unknown; function?: { name?: unknown } };
  const name = typeof entry.name === "string" ? entry.name : entry.function?.name;
  return typeof name === "string" ? name : null;
}

/** Bring a free-tier request up to the upstream contract: stream + genuine native tool. Idempotent. */
export function applyOpencodeFreeTierRequestContract<T>(body: T, requestFormat: string | null = "openai-responses", placeholderNames: readonly string[] = []): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  const next: Record<string, unknown> = { ...record, stream: true };

  const existingTools = Array.isArray(next.tools) ? [...(next.tools as unknown[])] : [];
  const existingNames = new Set(
    existingTools.map((tool) => opencodeToolEntryName(tool)).filter((name): name is string => !!name)
  );
  const namesToAdd = placeholderNames.filter((name) => !existingNames.has(name));
  const needsReadTool = !existingNames.has(OPENCODE_READ_TOOL_NAME);
  if (namesToAdd.length === 0 && !needsReadTool) return next as T;
  if (requestFormat === "openai-responses") {
    next.tools = [
      ...existingTools,
      ...(needsReadTool
        ? [{
            type: "function",
            name: OPENCODE_READ_TOOL_NAME,
            parameters: { ...OPENCODE_READ_TOOL_PARAMETERS },
          }]
        : []),
      ...namesToAdd.map((name) => ({
        type: "function",
        name,
        description: OPENCODE_PLACEHOLDER_TOOL_DESCRIPTION,
        parameters: OPENCODE_PLACEHOLDER_TOOL_PARAMETERS,
      })),
    ];
    return next as T;
  }
  if (requestFormat === "openai" || requestFormat === null) {
    next.tools = [
      ...existingTools,
      ...(needsReadTool
        ? [{
            type: "function",
            function: {
              name: OPENCODE_READ_TOOL_NAME,
              parameters: { ...OPENCODE_READ_TOOL_PARAMETERS },
            },
          }]
        : []),
      ...namesToAdd.map((name) => ({
        type: "function",
        function: {
          name,
          description: OPENCODE_PLACEHOLDER_TOOL_DESCRIPTION,
          parameters: OPENCODE_PLACEHOLDER_TOOL_PARAMETERS,
        },
      })),
    ];
    return next as T;
  }
  return next as T;
}

// ── True-client kernel (port of open-sse/executors/opencodeKernel.ts) ──
// Keyless free-tier models on `opencode`/`opencode-zen` go out on the real
// client surface `https://opencode.ai/inference/v1` with the real client
// request shape, instead of the zen surface + synthesized contract.

export const OPENCODE_KERNEL_BASE_URL = "https://opencode.ai/inference/v1";
export const OPENCODE_KERNEL_CHAT_USER_AGENT = "opencode/1.19.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14";
export const OPENCODE_KERNEL_RESPONSES_USER_AGENT = "opencode/1.19.0 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14";
export const OPENCODE_KERNEL_PUBLIC_KEY = "public";
export type OpencodeKernelSurface = "chat" | "responses";
const OPENCODE_KERNEL_PROVIDERS = new Set(["opencode", "opencode-zen"]);
const OPENCODE_KERNEL_RESPONSES_PATTERN = /^muse-spark(?:-|$)/i;

/**
 * Kernel `read` tool parameters (zen.go `zenKernelReadParams`). The upstream
 * free-tier gate only checks the tool NAME, not the schema, so this minimal
 * genuine-looking shape is exactly what the reference implementation ships.
 */
const OPENCODE_KERNEL_READ_PARAMETERS = {
  type: "object",
  properties: { path: { type: "string" } },
  required: ["path"],
} as const;

/** Upstream's own title-generation prompt (zen.go `zenTitleTemplate`). */
const OPENCODE_KERNEL_TITLE_TEMPLATE = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- ≤50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  → create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" → Debugging production 500 errors
"refactor user service" → Refactoring user service
"why is app.js failing" → app.js failure investigation
"implement rate limiting" → Rate limiting implementation
"how do I connect postgres to my API" → Postgres API connection
"best practices for React hooks" → React hooks best practices
"@src/auth.ts can you add refresh token support" → Auth refresh token support
"@utils/parser.ts this is broken" → Parser bug fix
"look at @config.json" → Config review
"@App.tsx add dark mode toggle" → Dark mode toggle in App
</examples>`;

function resolveKernelDefaultMaxTokens(): number {
  const raw = process.env.OPENCODE_KERNEL_DEFAULT_MAX_TOKENS;
  if (raw !== undefined) {
    const parsed = Number.parseInt(String(raw), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  // zen.go `kernelDefaultTokens`, the exact default the reference kernel sends.
  return 128000;
}

export function isKernelSendEnabled(): boolean {
  return !/^(0|false|no|off)$/i.test((process.env.OPENCODE_KERNEL_SEND ?? "").trim());
}

export function kernelBaseUrl(): string {
  const override = (process.env.OPENCODE_KERNEL_BASE_URL ?? "").trim().replace(/\/$/, "");
  return override === "" ? OPENCODE_KERNEL_BASE_URL : override;
}

export function kernelUserAgent(surface: OpencodeKernelSurface): string {
  const override = (process.env.OPENCODE_KERNEL_USER_AGENT ?? "").trim();
  if (override !== "") return override;
  return surface === "responses" ? OPENCODE_KERNEL_RESPONSES_USER_AGENT : OPENCODE_KERNEL_CHAT_USER_AGENT;
}

export function kernelApiKey(): string {
  const key = (process.env.OPENCODE_API_KEY ?? "").trim();
  return key === "" ? OPENCODE_KERNEL_PUBLIC_KEY : key;
}

export function kernelModelId(model: string): string {
  const stripped = stripOpencodeModelPrefix(model);
  return typeof stripped === "string" ? stripped : model;
}

export function kernelSurfaceFor(model: string): OpencodeKernelSurface {
  return OPENCODE_KERNEL_RESPONSES_PATTERN.test(kernelModelId(model)) ? "responses" : "chat";
}

/**
 * Honour the client surface: a Responses caller expects Responses events
 * (`response.*`, `output_text.delta`, `function_call`) rather than chat
 * chunks, and free Zen models expose both surfaces keyless. This mirrors
 * zen.go `zenExecute` (`surface := zenKernelSurface(model)` then
 * `if zr.format == "openai-responses" { surface = "responses" }`).
 */
export function kernelSurfaceForRequest(
  model: string,
  requestFormat?: string | null,
): OpencodeKernelSurface {
  if (requestFormat === "openai-responses" || requestFormat === "openai-response") return "responses";
  return kernelSurfaceFor(model);
}

export function kernelUrlForSurface(surface: OpencodeKernelSurface): string {
  const path = surface === "responses" ? "/responses" : "/chat/completions";
  return `${kernelBaseUrl()}${path}`;
}

export function kernelUrlFor(model: string): string {
  return kernelUrlForSurface(kernelSurfaceFor(model));
}

export function shouldUseKernelSend(provider: string | null | undefined, model: string | null | undefined): boolean {
  if (!isKernelSendEnabled()) return false;
  if (typeof provider !== "string" || !OPENCODE_KERNEL_PROVIDERS.has(provider.toLowerCase())) return false;
  if (typeof model !== "string" || !model.trim()) return false;
  return !isPremiumOpencodeModel(model, String(provider));
}

const OPENCODE_KERNEL_BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const OPENCODE_KERNEL_ID_SUFFIX_LENGTH = 14;
let kernelLastTimestamp = 0;
let kernelIdCounter = 0;

function kernelCreateIdentifier(descending: boolean, timestamp: number = Date.now()): string {
  if (timestamp !== kernelLastTimestamp) {
    kernelLastTimestamp = timestamp;
    kernelIdCounter = 0;
  }
  kernelIdCounter++;
  const current = BigInt(timestamp) * 0x1000n + BigInt(kernelIdCounter);
  const value = descending ? ~current : current;
  const mask = 0xffn;
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & mask).toString(16).padStart(2, "0"),
  ).join("");
  const rand = randomBytes(OPENCODE_KERNEL_ID_SUFFIX_LENGTH);
  const suffix = Array.from(rand.subarray(0, OPENCODE_KERNEL_ID_SUFFIX_LENGTH), (byte) => OPENCODE_KERNEL_BASE62[byte % 62]).join("");
  return time + suffix;
}

export function kernelSessionId(): string {
  return `ses_${kernelCreateIdentifier(true)}`;
}

export function kernelRequestId(): string {
  return `msg_${kernelCreateIdentifier(false)}`;
}

export interface KernelIdentity {
  readonly session: string;
  readonly request: string;
}

export function kernelIdentity(session?: string): KernelIdentity {
  return { session: session ?? kernelSessionId(), request: kernelRequestId() };
}

const kernelIdentityByOrigin = new WeakMap<object, KernelIdentity>();

export function kernelIdentityFor(origin: unknown, sessionHint?: string): KernelIdentity {
  if (typeof origin === "object" && origin !== null) {
    const known = kernelIdentityByOrigin.get(origin);
    if (known !== undefined) return known;
    const identity = kernelIdentity(sessionHint);
    kernelIdentityByOrigin.set(origin, identity);
    return identity;
  }
  return kernelIdentity(sessionHint);
}

export function buildKernelHeaders(surface: OpencodeKernelSurface, identity: KernelIdentity): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${kernelApiKey()}`,
    "Content-Type": "application/json",
    "User-Agent": kernelUserAgent(surface),
    "x-opencode-client": "cli",
    "x-opencode-project": "global",
    "x-opencode-request": identity.request,
    "x-opencode-session": identity.session,
    "x-opencode-session-id": identity.session,
  };
  // No relay-identifying header/value may reach upstream (zenStripTraceHeaders).
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase().includes("omniroute") || headers[key]!.toLowerCase().includes("omniroute")) {
      delete headers[key];
    }
  }
  return headers;
}

function kernelIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kernelAsArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function kernelFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function kernelTextOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function kernelNormalizeChatTool(tool: unknown): { name: string; description?: string; parameters?: unknown } | null {
  if (!kernelIsRecord(tool)) return null;
  if (tool.type !== "function") return null;
  const nested = kernelIsRecord(tool.function) ? (tool.function as Record<string, unknown>) : null;
  const name = kernelTextOf(nested !== null ? nested.name : tool.name);
  if (name === undefined || name === "") return null;
  const description = kernelTextOf(nested !== null ? nested.description : tool.description);
  const parameters = nested !== null ? nested.parameters : tool.parameters;
  const out: { name: string; description?: string; parameters?: unknown } = { name };
  if (description !== undefined && description !== "") out.description = description;
  if (parameters !== undefined && parameters !== null) out.parameters = parameters;
  return out;
}

function kernelNormalizeChatTools(value: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const tool of kernelAsArray(value)) {
    const entry = kernelNormalizeChatTool(tool);
    if (entry === null) continue;
    out.push({
      type: "function",
      function: {
        name: entry.name,
        ...(entry.description !== undefined ? { description: entry.description } : {}),
        ...(entry.parameters !== undefined ? { parameters: entry.parameters } : {}),
      },
    });
  }
  return out;
}

function kernelNormalizeResponsesTool(tool: unknown): Record<string, unknown> | null {
  const entry = kernelNormalizeChatTool(tool);
  if (entry === null) return null;
  return {
    type: "function",
    name: entry.name,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.parameters !== undefined ? { parameters: entry.parameters } : {}),
  };
}

function kernelHasReadTool(tools: readonly unknown[]): boolean {
  for (const tool of tools) {
    if (!kernelIsRecord(tool)) continue;
    if (kernelTextOf(tool.name) === "read") return true;
    const fn = kernelIsRecord(tool.function) ? tool.function : null;
    if (fn !== null && kernelTextOf(fn.name) === "read") return true;
  }
  return false;
}

/**
 * The keyless free-tier admission signal (zen.go `zenFreeTierReadTool`): Zen
 * only serves "from within OpenCode", and the CLI always ships its built-in
 * read tool. A request whose tool list lacks (or omits tools entirely) `read`
 * is refused with 403 FreeTierError. The schema body is irrelevant, the name
 * is not.
 */
function kernelFreeTierReadTool(): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: "read",
      description: "Read a file or directory from the local filesystem.",
      parameters: { ...OPENCODE_KERNEL_READ_PARAMETERS },
    },
  };
}

/**
 * `isZenTitleShapedCall`: lone-`title` output schema (Claude session naming).
 * Such calls must never receive the admission `read` tool.
 */
function kernelIsTitleShapedCall(body: Record<string, unknown>): boolean {
  const pickSchema = (holder: unknown): Record<string, unknown> | null => {
    if (!kernelIsRecord(holder)) return null;
    if (holder.type === "json_schema" && kernelIsRecord(holder.json_schema) && kernelIsRecord(holder.json_schema.schema)) {
      return holder.json_schema.schema as Record<string, unknown>;
    }
    if (kernelIsRecord(holder.schema)) return holder.schema as Record<string, unknown>;
    return null;
  };
  for (const holder of [body.output_config, body.response_format]) {
    const schema = pickSchema(holder);
    if (schema === null) continue;
    const properties = kernelIsRecord(schema.properties) ? schema.properties : null;
    if (properties !== null && Object.keys(properties).length === 1 && Object.prototype.hasOwnProperty.call(properties, "title")) {
      return true;
    }
  }
  return false;
}

/**
 * `repairHollowZenTools`: inject a benign optional parameter into function
 * tools declared with empty/missing properties. The free-tier gate refuses
 * parameter-less tools (a genuine client always declares params; hollow tools
 * smell like probes) — e.g. codex's `read` with `"properties":{}`. Dropping
 * them would break sessions that need the tool, so instead they get one
 * optional `_compat` string that executors ignore. Strict tools are left
 * alone. Returns the repaired count.
 */
export function repairHollowKernelTools(tools: unknown[]): number {
  let fixed = 0;
  const fixParams = (holder: Record<string, unknown>): void => {
    if (holder.strict === true) return;
    const params = holder.parameters;
    if (!kernelIsRecord(params)) {
      holder.parameters = {
        type: "object",
        properties: { _compat: { type: "string", description: "Reserved for compatibility; do not use." } },
      };
      fixed++;
      return;
    }
    const type = kernelTextOf(params.type);
    if (type !== undefined && type !== "" && type !== "object") return;
    const properties = params.properties;
    if (kernelIsRecord(properties) && Object.keys(properties).length > 0) return;
    params.type = "object";
    params.properties = { _compat: { type: "string", description: "Reserved for compatibility; do not use." } };
    fixed++;
  };
  for (const tool of tools) {
    if (!kernelIsRecord(tool) || tool.type !== "function") continue;
    if (kernelIsRecord(tool.function)) {
      fixParams(tool.function);
    } else if (Object.prototype.hasOwnProperty.call(tool, "name")) {
      fixParams(tool);
    }
  }
  return fixed;
}

function kernelOutputEmpty(output: unknown): boolean {
  if (output === null || output === undefined) return true;
  if (typeof output === "string") return output.trim() === "";
  if (Array.isArray(output)) return output.length === 0;
  return false;
}

/**
 * Last-mile repair for strict chat upstreams (opencode.ai inference rejects
 * `invalid_request_error` when an assistant `tool_calls` message is not
 * followed by a `tool` message for every id, or when a `tool` message has
 * no preceding call): interrupted turns, client retries and history
 * replays can all leave dangling calls or orphan results behind.
 *
 * - Empty `tool_calls: []` arrays are stripped (some validators 400 them).
 * - A tool block that ends (or the array ends) with ids still pending gets
 *   a neutral synthetic result per missing id, in position.
 * - Orphan `tool` results (no preceding unmatched call) are demoted to
 *   `user` messages so no output is lost and pairing stays valid.
 *
 * Ids compare by exact string (including ""); returns the repaired list
 * plus counters for logging.
 */
export function repairKernelChatToolPairing(messages: unknown[]): {
  messages: unknown[];
  synthesized: number;
  orphaned: number;
  strippedEmptyCalls: number;
} {
  if (!Array.isArray(messages)) return { messages, synthesized: 0, orphaned: 0, strippedEmptyCalls: 0 };
  const out: unknown[] = [];
  const pending = new Map<string, number>();
  let synthesized = 0;
  let orphaned = 0;
  let strippedEmptyCalls = 0;
  const SYNTHETIC_NOTE = "[No result was returned for this tool call before the turn ended.]";
  const flushPending = () => {
    if (pending.size === 0) return;
    for (const [id, index] of pending) {
      void index;
      out.push({ role: "tool", tool_call_id: id, content: SYNTHETIC_NOTE });
      synthesized += 1;
    }
    pending.clear();
  };
  for (const raw of messages) {
    if (!kernelIsRecord(raw)) {
      flushPending();
      out.push(raw);
      continue;
    }
    const role = raw.role;
    if (role === "tool") {
      const id = typeof raw.tool_call_id === "string" ? raw.tool_call_id : "";
      if (pending.has(id)) {
        pending.delete(id);
        out.push(raw);
      } else {
        orphaned += 1;
        out.push({ role: "user", content: raw.content ?? "" });
      }
      continue;
    }
    if (role === "assistant" && Array.isArray(raw.tool_calls)) {
      flushPending();
      if (raw.tool_calls.length === 0) {
        strippedEmptyCalls += 1;
        const { tool_calls: _dropped, ...rest } = raw;
        out.push(rest);
        continue;
      }
      raw.tool_calls.forEach((call: unknown, index: number) => {
        const id = kernelIsRecord(call) && typeof call.id === "string" ? call.id : "";
        pending.set(id, index);
      });
      out.push(raw);
      continue;
    }
    flushPending();
    out.push(raw);
  }
  flushPending();
  return { messages: out, synthesized, orphaned, strippedEmptyCalls };
}

function kernelOutputKey(output: unknown): string {
  if (typeof output === "string") return `s:${output}`;
  try {
    return `j:${JSON.stringify(output)}`;
  } catch {
    return "u:unknown";
  }
}

/**
 * Drop only provably-redundant `function_call_output` items: an empty
 * placeholder when a real sibling exists for the same call id, or a
 * byte-identical repeat. Different real contents sharing one id (parallel
 * agents) are never dropped. `dedupeZenResponsesItems`.
 */
function dedupeKernelResponsesItems(items: readonly unknown[]): unknown[] {
  const hasReal = new Set<string>();
  for (const item of items) {
    if (!kernelIsRecord(item) || item.type !== "function_call_output") continue;
    const callId = kernelTextOf(item.call_id);
    if (!callId) continue;
    if (!kernelOutputEmpty(item.output)) hasReal.add(callId);
  }
  const seenBody = new Set<string>();
  const kept: unknown[] = [];
  for (const item of items) {
    if (!kernelIsRecord(item) || item.type !== "function_call_output") {
      kept.push(item);
      continue;
    }
    const callId = kernelTextOf(item.call_id);
    if (!callId) {
      kept.push(item);
      continue;
    }
    if (kernelOutputEmpty(item.output) && hasReal.has(callId)) continue;
    const key = `${callId}\u0000${kernelOutputKey(item.output)}`;
    if (seenBody.has(key)) continue;
    seenBody.add(key);
    kept.push(item);
  }
  return kept;
}

function kernelNormalizeContentPart(part: unknown): unknown {
  if (!kernelIsRecord(part)) return part;
  if (part.type === "input_text" && typeof part.text === "string") {
    return { type: "text", text: part.text };
  }
  if (part.type === "input_image" && part.image_url !== undefined) {
    return { type: "image_url", image_url: part.image_url };
  }
  return part;
}

function kernelNormalizeMessage(message: unknown): Record<string, unknown> | null {
  if (!kernelIsRecord(message)) return null;
  const role = message.role;
  if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") return null;
  const out: Record<string, unknown> = { role };
  const content = message.content;
  out.content = Array.isArray(content) ? content.map(kernelNormalizeContentPart) : (content ?? null);
  for (const key of ["name", "tool_calls", "tool_call_id"]) {
    if (message[key] !== undefined) out[key] = message[key];
  }
  return out;
}

function kernelResponsesTextOf(content: unknown): string {
  return kernelAsArray(content)
    .filter((part): part is Record<string, unknown> => kernelIsRecord(part))
    .filter((part) => part.type === "input_text" || part.type === "text")
    .map((part) => kernelTextOf(part.text) ?? "")
    .join("");
}

function kernelNormalizeMessages(body: Record<string, unknown>): unknown[] {
  const direct = body.messages;
  const out: unknown[] = [];
  if (Array.isArray(direct)) {
    for (const message of direct) {
      const normalized = kernelNormalizeMessage(message);
      if (normalized !== null) out.push(normalized);
    }
  } else {
    for (const item of kernelAsArray(body.input)) {
      if (!kernelIsRecord(item)) continue;
      const type = item.type;
      if (type === "message" && (item.role === "user" || item.role === "system")) {
        out.push({ role: String(item.role), content: kernelResponsesTextOf(item.content) });
        continue;
      }
      if (type === "message") {
        out.push({ role: "assistant", content: kernelResponsesTextOf(item.content) });
        continue;
      }
      if (type === "function_call") {
        const name = kernelTextOf(item.name) ?? "";
        out.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: kernelTextOf(item.call_id) ?? kernelTextOf(item.id) ?? "",
              type: "function",
              function: { name, arguments: kernelTextOf(item.arguments) ?? "{}" },
            },
          ],
        });
        continue;
      }
      if (type === "function_call_output") {
        out.push({
          role: "tool",
          tool_call_id: kernelTextOf(item.call_id) ?? "",
          content: kernelResponsesTextOf(item.output),
        });
      }
    }
  }
  const hasSystem = out.some((message) => kernelIsRecord(message) && message.role === "system");
  const hasDeveloper = out.some((message) => kernelIsRecord(message) && message.role === "developer");
  const instructions = kernelTextOf(body.instructions);
  if (!hasSystem && !hasDeveloper && instructions !== undefined && instructions !== "") {
    out.unshift({ role: "system", content: instructions });
  }
  return out;
}

function kernelNormalizeResponsesInput(body: Record<string, unknown>): unknown[] {
  const raw =
    Array.isArray(body.input) && body.input.length > 0
      ? dedupeKernelResponsesItems(body.input)
      : (kernelNormalizeMessages(body) as Array<Record<string, unknown>>).map((message) => {
          if (message.role === "tool") return message;
          const content = message.content;
          const parts =
            typeof content === "string"
              ? [{ type: "input_text", text: content }]
              : kernelAsArray(content).map((part) =>
                  kernelIsRecord(part) && part.type === "text" && typeof part.text === "string"
                    ? { type: "input_text", text: part.text }
                    : part,
                );
          if (message.role === "assistant" && message.tool_calls !== undefined && message.tool_calls !== null) {
            return { type: "message", role: "assistant", content: parts };
          }
          return { role: message.role, content: parts };
        });
  const base = raw.map((item) => {
    if (!kernelIsRecord(item) || item.type !== "message" || typeof item.role !== "string") return item;
    const out: Record<string, unknown> = { role: item.role, content: item.content };
    for (const key of Object.keys(item)) {
      if (key !== "type" && key !== "role" && key !== "content") out[key] = item[key];
    }
    return out;
  });
  // Codex replays the previous turn's reasoning verbatim (id + possible
  // encrypted_content, even a typeless fragment). The free tier is a
  // stateless direct call (store:false): upstream keeps no `rs_*` entries, so
  // any reference answers 400 ("was not issued to this caller" / "not found or
  // has expired"), and a typeless item is "did not match any supported type".
  // Free models cannot use it anyway — drop the whole item and keep readable
  // history only. (The chat surface already discards reasoning.)
  const filtered: unknown[] = [];
  for (const item of base) {
    if (kernelIsRecord(item)) {
      if (item.type === "reasoning") continue;
      if (Object.prototype.hasOwnProperty.call(item, "encrypted_content")) continue;
      if (!Object.prototype.hasOwnProperty.call(item, "type") && !Object.prototype.hasOwnProperty.call(item, "role")) continue;
    }
    filtered.push(item);
  }
  const hasSystem = filtered.some((item) => kernelIsRecord(item) && (item.role === "system" || item.role === "developer"));
  const instructions = kernelTextOf(body.instructions);
  if (!hasSystem && instructions !== undefined && instructions !== "") {
    filtered.unshift({ role: "system", content: [{ type: "input_text", text: instructions }] });
  }
  return filtered;
}

export function buildKernelChatBody(caller: unknown, model: string): Record<string, unknown> {
  const record = kernelIsRecord(caller) ? caller : {};
  const tools = kernelNormalizeChatTools(record.tools);
  // The upstream free tier answers 403 FreeTierError unless the request
  // carries the official client's native `read` vocabulary (live 2026-10-20:
  // `_noop` alone -> 403, `_noop` + genuine `read` -> 200, `grep_search`
  // alone -> 403). Title-generation calls are the one exception: they must
  // stay tool-less. Hollow client tools are repaired with `_compat` after the
  // admission tool is in place.
  if (!kernelHasReadTool(tools) && !kernelIsTitleShapedCall(record)) {
    tools.push(kernelFreeTierReadTool());
  }
  repairHollowKernelTools(tools);
  // Thinking families (deepseek/kimi/mimo/minimax) reject a replayed assistant
  // turn without `reasoning_content`; zen.go `buildZenKernelChatBody` runs
  // `zenInjectChatReasoning` on the normalized messages for exactly this path.
  const kernelMessages = kernelNormalizeMessages(record);
  // Strict chat upstreams (opencode.ai inference) 400 dangling `tool_calls`
  // and orphan `tool` results left by interrupted turns and client retries;
  // repair pairing here so a stale history can't poison the turn.
  const repaired = repairKernelChatToolPairing(kernelMessages);
  if (repaired.synthesized + repaired.orphaned + repaired.strippedEmptyCalls > 0) {
    console.warn(
      `[omniroute-free] repaired chat tool pairing for ${model}: ` +
        `synthesized=${repaired.synthesized} orphaned=${repaired.orphaned} ` +
        `strippedEmptyCalls=${repaired.strippedEmptyCalls}`,
    );
  }
  const repairedMessages = repaired.messages;
  // Thinking families (deepseek/kimi/mimo/minimax) reject a replayed assistant
  // turn without `reasoning_content`; zen.go `buildZenKernelChatBody` runs
  // `zenInjectChatReasoning` on the normalized messages for exactly this path.
  const thinkingScoped = isOpencodeThinkingMessageModel(model)
    ? (injectOpencodeReasoningContentForThinkingModel({ messages: repairedMessages }) as { messages: unknown[] })
    : { messages: repairedMessages };
  const body: Record<string, unknown> = {
    model: kernelModelId(model),
    messages: thinkingScoped.messages,
    ...(tools.length > 0 ? { tools } : {}),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools.length > 0 && record.tool_choice !== undefined && record.tool_choice !== null) {
    body.tool_choice = record.tool_choice;
  }
  const maxTokens =
    kernelFiniteNumber(record.max_tokens) ??
    kernelFiniteNumber(record.max_completion_tokens) ??
    kernelFiniteNumber(record.max_output_tokens) ??
    resolveKernelDefaultMaxTokens();
  body.max_tokens = maxTokens;
  const temperature = kernelFiniteNumber(record.temperature);
  if (temperature !== undefined) body.temperature = temperature;
  const topP = kernelFiniteNumber(record.top_p);
  if (topP !== undefined) body.top_p = topP;
  const frequencyPenalty = kernelFiniteNumber(record.frequency_penalty);
  if (frequencyPenalty !== undefined) body.frequency_penalty = frequencyPenalty;
  const presencePenalty = kernelFiniteNumber(record.presence_penalty);
  if (presencePenalty !== undefined) body.presence_penalty = presencePenalty;
  const seed = kernelFiniteNumber(record.seed);
  if (seed !== undefined) body.seed = seed;
  if (record.stop !== undefined && record.stop !== null) body.stop = record.stop;
  return body;
}

export function buildKernelResponsesBody(caller: unknown, model: string, identity: KernelIdentity): Record<string, unknown> {
  const record = kernelIsRecord(caller) ? caller : {};
  const tools: Array<Record<string, unknown>> = [];
  for (const tool of kernelAsArray(record.tools)) {
    const entry = kernelNormalizeResponsesTool(tool);
    if (entry !== null) tools.push(entry);
  }
  const titleCall = kernelIsTitleShapedCall(record);
  if (!kernelHasReadTool(tools) && !titleCall) {
    tools.push({ type: "function", name: "read", parameters: { ...OPENCODE_KERNEL_READ_PARAMETERS } });
  }
  repairHollowKernelTools(tools);
  const normalized = kernelNormalizeResponsesInput(record);
  const input = titleCall
    ? [
        { role: "developer", content: OPENCODE_KERNEL_TITLE_TEMPLATE },
        ...normalized.filter((item) => kernelIsRecord(item) && item.role === "user"),
      ]
    : normalized;
  const body: Record<string, unknown> = {
    model: kernelModelId(model),
    input,
    store: false,
    prompt_cache_key: identity.session,
    ...(!titleCall && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    stream: true,
  };
  const maxTokens =
    kernelFiniteNumber(record.max_output_tokens) ??
    kernelFiniteNumber(record.max_completion_tokens) ??
    kernelFiniteNumber(record.max_tokens) ??
    resolveKernelDefaultMaxTokens();
  body.max_output_tokens = maxTokens;
  if (kernelIsRecord(record.reasoning)) body.reasoning = record.reasoning;
  return body;
}

export function buildKernelBody(
  caller: unknown,
  model: string,
  identity: KernelIdentity,
  requestFormat?: string | null,
): Record<string, unknown> {
  return kernelSurfaceForRequest(model, requestFormat) === "responses"
    ? buildKernelResponsesBody(caller, model, identity)
    : buildKernelChatBody(caller, model);
}

const OPENCODE_EFFORT_LEVELS = ["none", "low", "high", "max"] as const;

/**
 * Effort-tier aliases from `opencode models opencode-go --verbose` (#8353).
 * Exact copy of `EFFORT_TIERS` in `open-sse/executors/opencode.ts`.
 */
const OPENCODE_EFFORT_TIERS: Record<string, readonly string[]> = {
  "deepseek-v4-pro": OPENCODE_EFFORT_LEVELS,
  "deepseek-v4-flash": OPENCODE_EFFORT_LEVELS,
  "glm-5.2": ["high", "max"],
  "mimo-v2.5": ["high", "max"],
  "grok-4.5": ["low", "medium", "high"],
  hy3: ["none", "low", "high"],
  "kimi-k3": ["max"],
  "qwen3.6-plus": ["high", "max"],
  "qwen3.7-max": ["high", "max"],
  "qwen3.7-plus": ["high", "max"],
  "muse-spark-1.2-contributor": ["minimal", "low", "medium", "high", "xhigh"],
  "muse-spark-1.3-contributor": ["minimal", "low", "medium", "high", "xhigh"],
};

/**
 * Parse a model string with an effort-level suffix.
 * e.g. "deepseek-v4-pro-low" -> { baseModel: "deepseek-v4-pro", effort: "low" }
 * Exact copy of `parseEffortLevel` in `open-sse/executors/opencode.ts`.
 */
export function parseOpencodeEffortLevel(model: string): { baseModel: string; effort: string } | null {
  const m = String(model || "");
  for (const [baseModel, levels] of Object.entries(OPENCODE_EFFORT_TIERS)) {
    for (const level of levels) {
      if (m === `${baseModel}-${level}`) {
        return { baseModel, effort: level };
      }
    }
  }
  return null;
}

const OPENCODE_RESP_ITEM_ID_PREFIX_BY_TYPE: Record<string, string> = {
  function_call: "fc_",
  message: "msg_",
  reasoning: "rs_",
};
const OPENCODE_SERVER_ITEM_ID_PATTERN = /^(fc|msg|rs|resp)_/;
const OPENCODE_FUNCTION_NAME_VALID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const OPENCODE_FUNCTION_NAME_SANITIZE_RE = /[^a-zA-Z0-9_-]/g;

function opencodeToRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function opencodeIsResponsesMessageItem(record: Record<string, unknown>): boolean {
  return record.type === "message" || (!record.type && typeof record.role === "string");
}

function opencodeIsInternalAssistantMessage(record: Record<string, unknown>): boolean {
  if (!opencodeIsResponsesMessageItem(record)) return false;
  if (record.role !== "assistant") return false;
  const phase = typeof record.phase === "string" ? record.phase.trim().toLowerCase() : "";
  if (!phase) return false;
  return phase === "commentary";
}

function opencodeSanitizeFunctionName(name: string): string {
  return name.replace(OPENCODE_FUNCTION_NAME_SANITIZE_RE, "_").slice(0, 128);
}

function opencodeSanitizeInputItemId(record: Record<string, unknown>): Record<string, unknown> {
  if (record.id === undefined) return record;
  if (typeof record.id !== "string") {
    const next = { ...record };
    delete next.id;
    return next;
  }
  const type = typeof record.type === "string" ? record.type : "";
  const expectedPrefix = OPENCODE_RESP_ITEM_ID_PREFIX_BY_TYPE[type];
  const hasExpectedPrefix = expectedPrefix
    ? (record.id as string).startsWith(expectedPrefix)
    : OPENCODE_SERVER_ITEM_ID_PATTERN.test(record.id as string);
  if (hasExpectedPrefix) return record;
  const next = { ...record };
  delete next.id;
  return next;
}

function opencodeImageUrlToText(value: unknown): string {
  if (typeof value === "string") return value;
  const record = opencodeToRecord(value);
  return record && typeof record.url === "string" ? record.url : "";
}

function opencodeSanitizeContentPart(part: unknown, role: string): unknown {
  const record = opencodeToRecord(part);
  if (!record) return part;
  if (record.type === "image_url") {
    const url = opencodeImageUrlToText(record.image_url);
    if (role !== "assistant") {
      const next: Record<string, unknown> = { type: "input_image", image_url: url };
      const image = opencodeToRecord(record.image_url);
      if (image?.detail !== undefined) next.detail = image.detail;
      return next;
    }
    return { type: "output_text", text: url ? `[Image: ${url}]` : "[Image]" };
  }
  if (role === "assistant" && record.type === "input_image") {
    const url = opencodeImageUrlToText(record.image_url);
    return { type: "output_text", text: url ? `[Image: ${url}]` : "[Image]" };
  }
  return part;
}

function opencodeSanitizeMessageContent(record: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(record.content)) return record;
  const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
  const content = (record.content as unknown[]).map((part) => opencodeSanitizeContentPart(part, role));
  return { ...record, content };
}

function opencodeSanitizeNestedOutputPart(part: unknown): unknown {
  const record = opencodeToRecord(part);
  if (!record) return part;
  if (record.type === "output_text" || record.type === "refusal") {
    const next: Record<string, unknown> = { ...record, type: "input_text" };
    if (typeof next.text !== "string") {
      next.text = typeof record.refusal === "string" ? record.refusal : "";
    }
    delete next.annotations;
    delete next.logprobs;
    delete next.obfuscation;
    delete next.refusal;
    return next;
  }
  return opencodeSanitizeContentPart(part, "user");
}

function opencodeSanitizeOutputContent(record: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(record.output)) return record;
  const output = (record.output as unknown[]).map(opencodeSanitizeNestedOutputPart);
  return { ...record, output };
}

function opencodeIsAgentMessageInputItem(record: Record<string, unknown>): boolean {
  return record.type === "agent_message" || record.role === "agent_message";
}

function opencodeSanitizeInputItem(item: unknown): unknown {
  const record = opencodeToRecord(item);
  if (!record) return item;
  let next = record;
  if (opencodeIsAgentMessageInputItem(next)) {
    const content = next.content;
    let bodyParts: unknown[];
    if (typeof content === "string") {
      bodyParts = [{ type: "input_text", text: content }];
    } else if (Array.isArray(content)) {
      bodyParts = (content as unknown[]).map((part) =>
        typeof part === "string" ? { type: "input_text", text: part } : part,
      );
    } else {
      try {
        bodyParts = [{ type: "input_text", text: JSON.stringify(content ?? "") }];
      } catch {
        bodyParts = [{ type: "input_text", text: String(content ?? "") }];
      }
    }
    next = {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: `[Agent message context] ${JSON.stringify({ author: next.author, recipient: next.recipient })}`,
        },
        ...bodyParts,
      ],
    };
  }
  next = opencodeSanitizeInputItemId(next);
  if (opencodeIsResponsesMessageItem(next)) next = opencodeSanitizeMessageContent(next);
  next = opencodeSanitizeOutputContent(next);
  if (
    (next.type === "function_call" || next.type === "function_call_output") &&
    typeof next.name === "string" &&
    !OPENCODE_FUNCTION_NAME_VALID_RE.test(next.name)
  ) {
    next = { ...next, name: opencodeSanitizeFunctionName(next.name) };
  }
  return next;
}

/**
 * Port of `sanitizeResponsesInputItems(items, clone=false)` as used by
 * `BaseExecutor.transformRequest`: drops internal `commentary` assistant
 * frames, then sanitizes each item in place (no clone — the body is already
 * cloned by the caller).
 */
export function sanitizeOpencodeResponsesInputItems(items: unknown[]): unknown[] {
  const sanitized: unknown[] = [];
  for (const item of items) {
    const record = opencodeToRecord(item);
    if (record && opencodeIsInternalAssistantMessage(record)) continue;
    sanitized.push(opencodeSanitizeInputItem(item));
  }
  return sanitized;
}

const OPENCODE_EXECUTOR_CONSUMED_BODY_FIELDS: readonly string[] = [
  "_claudeCodeRequiresLowercaseToolNames",
  "_nativeCodexPassthrough",
  "_nativeXaiResponsesPassthrough",
  "_nativeOpenAICompatibleResponsesPassthrough",
];
const OPENCODE_INTERNAL_BODY_FIELD_PREFIX = "_omniroute";

/** Port of `stripInternalBodyFields`: drop executor markers + `_omniroute*`. Mutates. */
export function stripOpencodeInternalBodyFields(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  for (const field of OPENCODE_EXECUTOR_CONSUMED_BODY_FIELDS) delete record[field];
  for (const key of Object.keys(record)) {
    if (key.startsWith(OPENCODE_INTERNAL_BODY_FIELD_PREFIX)) delete record[key];
  }
  return body;
}

/**
 * Port of `BaseExecutor.transformRequest` (#1674/#1884) + Responses input
 * sanitize: clone, fix empty tool descriptions, fill `unnamed_tool`,
 * sanitize `input` items, drop `prompt_cache_retention` and empty
 * `user|stop|seed|response_format`, strip internal markers.
 */
export function sanitizeOpencodeBaseBody<T>(body: T): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const cloned = { ...(body as Record<string, unknown>) } as Record<string, unknown>;
  if (Array.isArray(cloned.input)) {
    cloned.input = sanitizeOpencodeResponsesInputItems(cloned.input);
  }
  if (Array.isArray(cloned.tools)) {
    cloned.tools = (cloned.tools as unknown[]).map((tool: unknown) => {
      if (tool && typeof tool === "object" && !Array.isArray(tool)) {
        const toolRecord = tool as Record<string, unknown>;
        const toolFunction = toolRecord.function;
        if (toolFunction && typeof toolFunction === "object" && !Array.isArray(toolFunction)) {
          const func = { ...(toolFunction as Record<string, unknown>) };
          if (func.description === "") delete func.description;
          if (typeof func.name !== "string" || func.name.trim() === "") func.name = "unnamed_tool";
          return { ...toolRecord, function: func };
        }
      }
      return tool;
    });
  }
  delete cloned.prompt_cache_retention;
  for (const key of ["user", "stop", "seed", "response_format"]) {
    if (cloned[key] === "") delete cloned[key];
  }
  stripOpencodeInternalBodyFields(cloned);
  return cloned as T;
}

const OPENCODE_OBSERVED_TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
/** Port of `configuredPlaceholderToolNames`: `OPENCODE_FREE_TIER_PLACEHOLDER_TOOLS`. */
export function configuredOpencodePlaceholderToolNames(): string[] {
  const kept: string[] = [];
  for (const part of String(process.env.OPENCODE_FREE_TIER_PLACEHOLDER_TOOLS || "").split(",")) {
    const name = part.trim();
    if (kept.length >= 32) break;
    if (!OPENCODE_OBSERVED_TOOL_NAME_PATTERN.test(name)) continue;
    if (!kept.includes(name)) kept.push(name);
  }
  return kept;
}

const OPENCODE_OBSERVED_MAX_NAMES = 32;
const OPENCODE_OBSERVED_MAX_ENTRIES = 64;
const OPENCODE_OBSERVED_REFUSALS_BEFORE_FORGETTING = 3;

const opencodeObservedTools = new Map<string, readonly string[]>();
const opencodeObservedRefusals = new Map<string, number>();
function opencodeObservationKey(provider: string, model: string, session?: string): string {
  return [provider, model, session ?? ""].join("|");
}

function opencodeSanitizeObservedNames(names: readonly unknown[]): string[] {
  const kept: string[] = [];
  for (const raw of names) {
    if (kept.length >= OPENCODE_OBSERVED_MAX_NAMES) break;
    if (typeof raw !== "string" || !OPENCODE_OBSERVED_TOOL_NAME_PATTERN.test(raw)) continue;
    if (!kept.includes(raw)) kept.push(raw);
  }
  return kept;
}

/** Port of `recordAcceptedToolNames`: dual write session+model, LRU evict, clear streak. */
export function recordAcceptedOpencodeToolNames(
  provider: string,
  model: string,
  session: string | undefined,
  names: readonly unknown[],
): void {
  const kept = opencodeSanitizeObservedNames(names);
  if (kept.length === 0) return;
  const frozen = Object.freeze(kept);
  const keys = session
    ? [opencodeObservationKey(provider, model, session), opencodeObservationKey(provider, model)]
    : [opencodeObservationKey(provider, model)];
  for (const key of keys) {
    opencodeObservedTools.delete(key);
    opencodeObservedTools.set(key, frozen);
    opencodeObservedRefusals.delete(key);
  }
  while (opencodeObservedTools.size > OPENCODE_OBSERVED_MAX_ENTRIES) {
    const oldest = opencodeObservedTools.keys().next();
    if (oldest.done) break;
    opencodeObservedTools.delete(oldest.value);
    opencodeObservedRefusals.delete(oldest.value);
  }
}

/** Port of `noteRefusedBorrowedToolNames`: 3-strike forget, borrowed-only. */
export function noteRefusedBorrowedOpencodeToolNames(
  provider: string,
  model: string,
  session?: string,
): void {
  const sessionKey = opencodeObservationKey(provider, model, session);
  const key = opencodeObservedTools.has(sessionKey)
    ? sessionKey
    : opencodeObservationKey(provider, model);
  if (!opencodeObservedTools.has(key)) return;
  const streak = (opencodeObservedRefusals.get(key) ?? 0) + 1;
  if (streak < OPENCODE_OBSERVED_REFUSALS_BEFORE_FORGETTING) {
    opencodeObservedRefusals.set(key, streak);
    return;
  }
  opencodeObservedTools.delete(key);
  opencodeObservedRefusals.delete(key);
}

/** Port of `confirmBorrowedToolNames`: OK on borrowed shape clears refusal streak. */
export function confirmBorrowedOpencodeToolNames(
  provider: string,
  model: string,
  session?: string,
): void {
  const sessionKey = opencodeObservationKey(provider, model, session);
  const key = opencodeObservedTools.has(sessionKey)
    ? sessionKey
    : opencodeObservationKey(provider, model);
  if (!opencodeObservedTools.has(key)) return;
  opencodeObservedRefusals.delete(key);
}

export function getObservedOpencodeToolNames(
  provider: string,
  model: string,
  session?: string,
): readonly string[] | null {
  return opencodeObservedTools.get(opencodeObservationKey(provider, model, session)) ?? null;
}

export function resetOpencodeToolObservationForTests(): void {
  opencodeObservedTools.clear();
  opencodeObservedRefusals.clear();
}

/** Port of `mergeClientToolsWithObserved` (opencodeFreeTierContract.ts): append missing observed/configured names, keep client tool shapes. */
export function mergeOpencodeClientToolsWithObserved<T>(
  body: T,
  requestFormat: string | null,
  provider: string,
  model: string,
  session: string | undefined,
  configured: readonly string[],
): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.tools) || record.tools.length === 0) return body;
  const own = session ? getObservedOpencodeToolNames(provider, model, session) : null;
  const observed = own ?? getObservedOpencodeToolNames(provider, model) ?? configured;
  const have = new Set(opencodeClientToolNamesOf(body));
  const missing = observed.filter((name) => !have.has(name));
  if (missing.length === 0) return body;
  const next: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  if (requestFormat === "openai-responses") {
    next.tools = [
      ...(record.tools as unknown[]),
      ...missing.map((name) => ({
        type: "function",
        name,
        description: OPENCODE_PLACEHOLDER_TOOL_DESCRIPTION,
        parameters: OPENCODE_PLACEHOLDER_TOOL_PARAMETERS,
      })),
    ];
    return next as T;
  }
  if (requestFormat === "openai" || requestFormat === null) {
    next.tools = [
      ...(record.tools as unknown[]),
      ...missing.map((name) => ({
        type: "function",
        function: {
          name,
          description: OPENCODE_PLACEHOLDER_TOOL_DESCRIPTION,
          parameters: OPENCODE_PLACEHOLDER_TOOL_PARAMETERS,
        },
      })),
    ];
    return next as T;
  }
  return body;
}

/** Port of opencodeGeoBlock.ts refusal predicates (fail-closed exact substrings). */
const OPENCODE_FINGERPRINT_1010_RE =
  /(?<![A-Za-z0-9_-])error[\s_-]?code[\"':=\s]{0,12}1010(?!\w)|(?<![A-Za-z0-9_-])error[-_]\s?1010(?!\w)\/?/i;
const OPENCODE_REGION_ERROR_RE = /(?<![A-Za-z0-9_-])regionerror(?![A-Za-z0-9_-])/i;
const OPENCODE_FREE_TIER_SIGNALS = ["freetiererror", "free tier can only be used"];
const OPENCODE_GEO_SIGNALS = [
  "not available in your country",
  "not available in your region",
  "unsupported_country",
  "unsupported country",
];
const OPENCODE_QUOTA_SHAPE_SIGNAL = "insufficient_quota";

function opencodeIsFingerprintRejection(bodyText: string): boolean {
  const text = String(bodyText || "");
  const lower = text.toLowerCase();
  return (
    OPENCODE_FINGERPRINT_1010_RE.test(text) ||
    lower.includes("browser_signature_banned") ||
    lower.includes("fingerprint_rejection")
  );
}

export function isOpencodeGeoBlocked(status: number, bodyText: string | null): boolean {
  if (status !== 403 && status !== 451) return false;
  const text = String(bodyText || "");
  if (opencodeIsFingerprintRejection(text)) return false;
  if (OPENCODE_REGION_ERROR_RE.test(text)) return true;
  return OPENCODE_GEO_SIGNALS.some((s) => text.toLowerCase().includes(s));
}

export function isOpencodeUserBlocked(status: number, bodyText: string | null): boolean {
  if (status !== 403 && status !== 451) return false;
  const text = String(bodyText || "");
  if (opencodeIsFingerprintRejection(text) || isOpencodeGeoBlocked(status, text)) return false;
  return text.toLowerCase().includes("user_blocked");
}

export function isOpencodeFreeTierRefusal(status: number, bodyText: string | null): boolean {
  if (status !== 403 && status !== 451) return false;
  const text = String(bodyText || "");
  if (
    opencodeIsFingerprintRejection(text) ||
    isOpencodeGeoBlocked(status, text) ||
    isOpencodeUserBlocked(status, text)
  ) {
    return false;
  }
  return OPENCODE_FREE_TIER_SIGNALS.some((s) => text.toLowerCase().includes(s));
}

export function isOpencodeQuotaShapeRefusal(status: number, bodyText: string | null): boolean {
  if (status !== 403 && status !== 451) return false;
  const text = String(bodyText || "");
  if (
    opencodeIsFingerprintRejection(text) ||
    isOpencodeGeoBlocked(status, text) ||
    isOpencodeUserBlocked(status, text)
  ) {
    return false;
  }
  return text.toLowerCase().includes(OPENCODE_QUOTA_SHAPE_SIGNAL);
}

export function isOwnOpencodeToolsRetryableRefusal(status: number, bodyText: string | null): boolean {
  return (
    isOpencodeFreeTierRefusal(status, bodyText) ||
    isOpencodeQuotaShapeRefusal(status, bodyText)
  );
}

/** Port of `isOpencodeFreeTierRefusalForProvider`: scope free-tier verdict to opencode family. */
export function isOpencodeFreeTierRefusalForProvider(
  provider: string | null | undefined,
  status: number,
  bodyText: string | null,
): boolean {
  if (!provider) return false;
  const normalized = String(provider).trim().toLowerCase();
  const family =
    normalized === "opencode" ||
    normalized === "opencode-zen" ||
    normalized === "opencode-go" ||
    normalized === "oc" ||
    normalized.startsWith("opencode/") ||
    normalized.startsWith("opencode-") ||
    normalized.startsWith("oc/");
  if (!family) return false;
  return isOpencodeFreeTierRefusal(status, bodyText);
}

/** Port of `proxyKeyOf` / `poolReselectKeyOf` (opencodeGeoBlock.ts): pool reselect keys. */
export function opencodeProxyKeyOf(proxy: { host: string; port: number } | null): string | null {
  if (!proxy) return null;
  return `${proxy.host}:${proxy.port}`;
}
export function opencodePoolReselectKeyOf(candidate: unknown): string | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as { host?: unknown; port?: unknown };
  if (typeof record.host !== "string" || typeof record.port !== "number") return null;
  return opencodeProxyKeyOf({ host: record.host, port: record.port });
}

/** Port of `preserveOpencodeSessionIdentity`: keep explicit conversation identity. */
export function preserveOpencodeSessionIdentity(
  headers: Record<string, string> | Headers | null | undefined,
  body?: unknown,
): string | undefined {
  return resolveOpencodeSessionIdentity(headers, body);
}

/** Alias ports: upstream short names used by executor imports. */
export function isBodyContractEnabled(): boolean {
  return isOpencodeFreeTierBodyContractEnabled();
}
export function attemptForOpencode(origin: unknown): OpencodeFreeTierAttempt | null {
  return opencodeAttemptFor(origin);
}
export function _resetOpencodeShapeMemoForTests(): void {
  resetOpencodeShapeMemoForTests();
}
export function _resetOpencodeToolObservationForTests(): void {
  resetOpencodeToolObservationForTests();
}
let opencodeShapeNow: () => number = () => Date.now();
export function _setOpencodeShapeClockForTests(now: () => number): void {
  opencodeShapeNow = now;
}

/**
 * Port of `retryScopeApplies` + `addsNothingBeyondFirstDispatch` (opencodeFreeTierRetry.ts).
 * Pure gateway version: no ExecutorInput/dispatch dependency; caller performs the fetch.
 */
export function opencodeRetryScopeApplies(
  ctx: { surface: OpencodeSurface; provider: string; borrowed: boolean | undefined },
  model: string,
  status: number,
  body: unknown,
): boolean {
  if (status !== 403 && status !== 451) return false;
  if (!isGatedOpencodeFreeTierRequest(model, ctx.provider, ctx.surface)) return false;
  if (ctx.borrowed) return false;
  return !!body && typeof body === "object" && !Array.isArray(body);
}
export function opencodeAddsNothingBeyondFirstDispatch(
  ctx: { provider: string; clientToolNames: readonly string[]; clientSession: string | undefined },
  model: string,
  configured: readonly string[],
  merged: unknown,
): boolean {
  const sent = new Set<string>([
    ...ctx.clientToolNames,
    ...resolveOpencodePlaceholderNames(ctx.provider, model, ctx.clientSession, configured),
  ]);
  return opencodeClientToolNamesOf(merged).every((name) => sent.has(name));
}
/** Port of `isOwnToolsRetryableRefusal` gate already covered; pure retry-body builder. */
export function buildOpencodeObservedRetryBody<T>(
  body: T,
  requestFormat: string | null,
  provider: string,
  model: string,
  session: string | undefined,
  configured: readonly string[],
): T {
  return mergeOpencodeClientToolsWithObserved(body, requestFormat, provider, model, session, configured);
}

/**
 * Port of `isShapeRefusal` + `learnFromReplay` decision core (opencodeRequestShape.ts).
 * Returns the shape to replay in, or null when no replay applies.
 */
export function opencodeReplayShapeForRefusal(
  ctx: OpencodeInjectionContext,
  verdict: OpencodeFreeTierOutcome,
): "tools" | "bare" | null {
  if (ctx.probe === false && opencodeForcedShapeNote(ctx) === false) return null;
  if (verdict.status !== 403 && verdict.status !== 451) return null;
  if (verdict.bodyText === null) return null;
  const shapeRefusal =
    isOpencodeFreeTierRefusal(verdict.status, verdict.bodyText) ||
    isOpencodeQuotaShapeRefusal(verdict.status, verdict.bodyText);
  if (!shapeRefusal) return null;
  if (!ctx.probe) return null;
  return ctx.shape === "bare" ? "tools" : "bare";
}
function opencodeForcedShapeNote(_ctx: OpencodeInjectionContext): boolean {
  return true;
}
/** Port of `learnFromReplay`: accepted teaches bare, double-refusal pauses the class. */
export function opencodeLearnFromReplay(ctx: OpencodeInjectionContext, accepted: boolean, verdict: OpencodeFreeTierOutcome): void {
  if (!accepted) {
    opencodePauseShape(ctx.key);
    try {
      ctx.replayNote(verdict);
    } catch {
      // ignore observer errors on the failure path
    }
  } else if (ctx.shape === "tools") {
    opencodeRememberBare(ctx.key);
  } else {
    opencodeBareShapeClasses.delete(ctx.key);
  }
}

/**
 * Port of `rebuildJsonFromForcedStream` (opencodeFreeTierContract.ts:478-531).
 * Lazy: only converts a successful SSE response; streaming callers/refusals/JSON pass through.
 */
export function rebuildOpencodeJsonFromForcedStream(
  response: Response,
  requestFormat: string | null,
  _model: string,
): Response {
  if (!response.ok || !response.body) return response;
  if (!(response.headers.get("content-type") || "").includes("text/event-stream")) return response;
  void requestFormat;
  const upstream = response;
  let drained = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (drained) {
        controller.close();
        return;
      }
      drained = true;
      try {
        const rawSse = await upstream.text();
        controller.enqueue(new TextEncoder().encode(rawSse));
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
    cancel(reason) {
      if (!drained && !upstream.bodyUsed && upstream.body && !upstream.body.locked) {
        void upstream.body.cancel(reason);
      }
    },
  }, { highWaterMark: 0 });
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export interface OpencodeFreeTierOutcome {
  readonly ok: boolean;
  readonly status: number | null;
  readonly bodyText: string | null;
}

export interface OpencodeFreeTierAttempt {
  readonly provider: string;
  readonly model: string;
  readonly session: string | undefined;
  readonly borrowed: boolean;
  readonly clientToolNames: readonly string[];
  readonly probe?: boolean;
}

/** Port of `noteFreeTierOutcome`: OK teaches names, borrowed refusal counts 3-strike. */
export function noteOpencodeFreeTierOutcome(
  attempt: OpencodeFreeTierAttempt | null,
  outcome: boolean | OpencodeFreeTierOutcome,
): void {
  if (!attempt) return;
  const decided: OpencodeFreeTierOutcome =
    typeof outcome === "boolean" ? { ok: outcome, status: null, bodyText: null } : outcome;
  if (decided.ok) {
    if (attempt.clientToolNames.length > 0) {
      recordAcceptedOpencodeToolNames(
        attempt.provider,
        attempt.model,
        attempt.session,
        attempt.clientToolNames,
      );
    } else if (attempt.borrowed && !attempt.probe) {
      confirmBorrowedOpencodeToolNames(attempt.provider, attempt.model, attempt.session);
    }
    return;
  }
  if (attempt.probe) return;
  if (!attempt.borrowed) return;
  if (decided.status === null) return;
  if (isOpencodeFreeTierRefusal(decided.status, decided.bodyText)) {
    noteRefusedBorrowedOpencodeToolNames(attempt.provider, attempt.model, attempt.session);
  }
}

/** Port of reasoningContentInjector.ts authentic-reasoning guards (K3 / native K2.7). */
const OPENCODE_K3_AUTHENTIC_RE = /(?:^|\/)(?:kimi-)?k3(?:$|-)/i;
const OPENCODE_NATIVE_K27_AUTHENTIC_RE = /(?:^|\/)kimi-k2\.7-code(?:$|-)/i;

export function requiresAuthenticOpencodeReasoningContent(
  provider: unknown,
  model: unknown,
): boolean {
  const normalizedModel = String(model ?? "").trim();
  if (OPENCODE_K3_AUTHENTIC_RE.test(normalizedModel)) return true;
  const normalizedProvider = String(provider ?? "").trim().toLowerCase();
  return (
    (normalizedProvider === "moonshot" || normalizedProvider === "kimi") &&
    OPENCODE_NATIVE_K27_AUTHENTIC_RE.test(normalizedModel)
  );
}

export function shouldInjectOpencodeReasoningContentPlaceholder(
  providerRequiresEcho: boolean,
  provider: unknown,
  model: string | undefined | null,
): boolean {
  return (
    providerRequiresEcho &&
    !requiresAuthenticOpencodeReasoningContent(provider, model) &&
    isOpencodeThinkingMessageModel(model)
  );
}

/** Port of `resolvePlaceholderNames`: session own -> configured -> model-wide. */
export function resolveOpencodePlaceholderNames(
  provider: string,
  model: string,
  session: string | undefined,
  configured: readonly string[],
): readonly string[] {
  const own = session ? getObservedOpencodeToolNames(provider, model, session) : null;
  if (own && own.length > 0) return own;
  if (configured && configured.length > 0) return configured;
  return getObservedOpencodeToolNames(provider, model) ?? configured;
}

/**
 * OpenCode's free DeepSeek V4 Flash endpoint accepts json_object but rejects
 * json_schema response_format with HTTP 400. Preserve the schema as an
 * instruction and downgrade only this route to json_object.
 * Exact copy of `OpencodeExecutor.applyDeepSeekJsonSchemaFallback`.
 */
export function applyOpencodeDeepSeekJsonSchemaFallback<T>(model: string, body: T, provider = "opencode"): T {
  if (model !== "deepseek-v4-flash-free" || (provider !== "opencode" && provider !== "opencode-zen")) {
    return body;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }
  const record = body as Record<string, unknown>;
  const responseFormat = record.response_format as
    | { type?: string; json_schema?: { schema?: unknown } }
    | undefined;
  if (responseFormat?.type !== "json_schema" || !responseFormat.json_schema?.schema) {
    return body;
  }
  const schemaJson = JSON.stringify(responseFormat.json_schema.schema, null, 2);
  const prompt =
    "You must respond with valid JSON that strictly follows " +
    "this JSON schema:\n```json\n" +
    schemaJson +
    "\n```\nRespond ONLY with the JSON object, no other text and no markdown code fences.";
  const messages: Array<Record<string, unknown>> = Array.isArray(record.messages)
    ? (record.messages as Array<Record<string, unknown>>).map((message) => ({ ...message }))
    : [];
  const systemMessage = messages.find((message) => message.role === "system");
  if (systemMessage) {
    if (typeof systemMessage.content === "string") {
      systemMessage.content = `${systemMessage.content}\n\n${prompt}`;
    } else if (Array.isArray(systemMessage.content)) {
      systemMessage.content.push({ type: "text", text: `\n\n${prompt}` });
    }
  } else {
    messages.unshift({ role: "system", content: prompt });
  }
  return { ...record, messages, response_format: { type: "json_object" } } as T;
}

const OPENCODE_SHAPE_BARE_CLASSES_MAX = 64;
const opencodeBareShapeClasses = new Set<string>();
const opencodeShapePausedUntil = new Map<string, number>();

function opencodeShapeTextOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    const text = (content as Array<{ text?: unknown } | null>)
      .map((part) => part?.text)
      .filter((t): t is string => typeof t === "string")
      .join("");
    if (text) return text;
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/** Port of `shapeKeyOf`: provider|model|sha1(prompt). Responses=instructions, Chat=first system/developer. */
export function opencodeShapeKeyOf(provider: string, model: string, body: unknown): string {
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  let prompt = typeof record.instructions === "string" ? record.instructions : "";
  if (!prompt && Array.isArray(record.messages)) {
    const first = (record.messages as Array<Record<string, unknown>>).find(
      (m) => m && (m.role === "system" || m.role === "developer"),
    );
    prompt = opencodeShapeTextOf(first?.content);
  }
  const digest = createHash("sha1").update(prompt).digest("hex");
  return `${provider}|${model}|${digest}`;
}

function opencodeIsShapePaused(key: string): boolean {
  const until = opencodeShapePausedUntil.get(key);
  if (until === undefined) return false;
  if (until > opencodeShapeNow()) return true;
  opencodeShapePausedUntil.delete(key);
  return false;
}

/** Port of `opencodeRequestShape.ts` request-scoped state: forced shape + injection contexts + attempts. */
export interface OpencodeInjectionContext {
  readonly shape: "tools" | "bare";
  readonly key: string;
  readonly probe: boolean;
  readonly replayNote: (verdict: OpencodeFreeTierOutcome) => void;
}
const opencodeForcedShape = new WeakMap<object, "tools" | "bare">();
const opencodeInjectionContexts = new WeakMap<object, OpencodeInjectionContext>();
const opencodeContractAttempts = new WeakMap<object, OpencodeFreeTierAttempt>();
function opencodeIsTrackable(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
function opencodePauseShape(key: string): void {
  opencodeShapePausedUntil.delete(key);
  opencodeShapePausedUntil.set(key, opencodeShapeNow() + 60_000);
  while (opencodeShapePausedUntil.size > OPENCODE_SHAPE_BARE_CLASSES_MAX) {
    const oldest = opencodeShapePausedUntil.keys().next();
    if (oldest.done) break;
    opencodeShapePausedUntil.delete(oldest.value);
  }
}
function opencodeRememberBare(key: string): void {
  opencodeBareShapeClasses.delete(key);
  opencodeBareShapeClasses.add(key);
  while (opencodeBareShapeClasses.size > OPENCODE_SHAPE_BARE_CLASSES_MAX) {
    const oldest = opencodeBareShapeClasses.values().next();
    if (oldest.done) break;
    opencodeBareShapeClasses.delete(oldest.value);
  }
}

/** Port of `planShape(origin,key)`: forced wins, else remembered bare (unless paused). */
export function opencodePlanShape(key: string, origin?: object): { shape: "tools" | "bare"; probe: boolean } {
  if (origin && opencodeIsTrackable(origin)) {
    const imposed = opencodeForcedShape.get(origin);
    if (imposed) return { shape: imposed, probe: false };
  }
  if (opencodeBareShapeClasses.has(key) && !opencodeIsShapePaused(key)) return { shape: "bare", probe: true };
  return { shape: "tools", probe: !opencodeIsShapePaused(key) };
}

/** Port of requestShape attempt store: keyed by request body identity (WeakMap), never on executor. */
export function opencodeRememberAttempt(origin: object, attempt: object): void {
  opencodeContractAttempts.set(origin, attempt as OpencodeFreeTierAttempt);
}
export function opencodeRecallAttempt<T extends object>(origin: unknown): T | null {
  return opencodeIsTrackable(origin) ? ((opencodeContractAttempts.get(origin) as T | undefined) ?? null) : null;
}
export function opencodeForgetAttempt(origin: object): void {
  opencodeContractAttempts.delete(origin);
}
export function opencodeRecordInjection(origin: object, ctx: OpencodeInjectionContext): void {
  opencodeInjectionContexts.set(origin, ctx);
}
export function opencodeAttemptFor(origin: unknown): OpencodeFreeTierAttempt | null {
  return opencodeRecallAttempt<OpencodeFreeTierAttempt>(origin);
}
function opencodeWithStreaming<T>(body: T): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  return { ...(body as Record<string, unknown>), stream: true } as T;
}

/**
 * Port of `prepareFreeTierRequest` (opencodeFreeTierContract.ts:361-407).
 * Single entry point: gate check -> eligible (trackable origin + no client tools)
 * -> shapeKeyOf/planShape -> record attempt + injection -> bare=stream-only,
 * tools=apply contract. Non-eligible still records attempt for outcome noting.
 */
export function prepareOpencodeFreeTierRequest<T>(
  body: T,
  requestFormat: string | null,
  surface: OpencodeSurface,
  provider: string,
  model: string,
  session?: string,
  origin?: object,
): { body: T; attempt: OpencodeFreeTierAttempt | null } {
  const clientToolNames = opencodeClientToolNamesOf(body);
  if (!(isGatedOpencodeFreeTierRequest(model, provider, surface) && isOpencodeFreeTierBodyContractEnabled())) {
    if (origin && opencodeIsTrackable(origin)) opencodeForgetAttempt(origin);
    return { body, attempt: null };
  }
  const eligible = !!origin && opencodeIsTrackable(origin) && clientToolNames.length === 0;
  const key = eligible ? opencodeShapeKeyOf(provider, model, body) : "";
  const plan =
    origin && eligible ? opencodePlanShape(key, origin) : { shape: "tools" as const, probe: false };
  const chosen = plan.shape;
  const names = resolveOpencodePlaceholderNames(provider, model, session, configuredOpencodePlaceholderToolNames());
  const borrowed = clientToolNames.length === 0 && names.length > 0 && chosen === "tools";
  const attempt: OpencodeFreeTierAttempt = {
    provider,
    model,
    session,
    borrowed,
    clientToolNames,
    probe: plan.probe,
  };
  if (origin && opencodeIsTrackable(origin)) opencodeRememberAttempt(origin, attempt);
  if (origin && eligible) {
    opencodeRecordInjection(origin, {
      shape: chosen,
      key,
      probe: plan.probe,
      replayNote: (verdict) => noteOpencodeFreeTierOutcome({ ...attempt, probe: false }, verdict),
    });
  }
  return {
    body: chosen === "bare" ? opencodeWithStreaming(body) : applyOpencodeFreeTierRequestContract(body, requestFormat, names),
    attempt,
  };
}

/** Port of `requiresFreeTierRequestContract`: gated surface+model and body half not switched off. */
export function requiresOpencodeFreeTierRequestContract(
  surface: OpencodeSurface,
  provider: string,
  model: string,
): boolean {
  return isGatedOpencodeFreeTierRequest(model, provider, surface) && isOpencodeFreeTierBodyContractEnabled();
}

/**
 * Port of `forwardOpencodeClientHeaders` background path (`buildOpencodeBackgroundHeaders`).
 * Background traffic has no conversation: seed session before canonicalization so each
 * connection groups under one stable ses_ identity; UA synthesized to CLI identity.
 */
export function buildOpencodeBackgroundHeaders(options?: {
  seed?: string | null;
  userAgent?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  const seed = options?.seed?.trim();
  if (seed) headers["x-opencode-session"] = seed;
  // Exact upstream: bare "opencode" fallback (not versioned), then applyCliDefaults canonicalization.
  const cli = {
    userAgent:
      options?.userAgent?.trim() || process.env.OPENCODE_USER_AGENT?.trim() || "opencode",
    client: process.env.OPENCODE_CLIENT?.trim() || "desktop",
    project: process.env.OPENCODE_PROJECT?.trim() || "global",
  };
  const ua = options?.userAgent?.trim() || cli.userAgent;
  headers["User-Agent"] = ua;
  headers["x-opencode-client"] = cli.client;
  headers["x-opencode-project"] = cli.project;
  const req = headers["x-opencode-request"]?.trim();
  headers["x-opencode-request"] =
    req && OPENCODE_REQUEST_PATTERN.test(req) ? req : canonicalOpencodeId("msg_", req || undefined);
  const ses = headers["x-opencode-session"]?.trim() ?? "";
  headers["x-opencode-session"] = ses
    ? OPENCODE_SESSION_PATTERN.test(ses)
      ? ses
      : canonicalOpencodeId("ses_", ses)
    : canonicalOpencodeId("ses_");
  return headers;
}

/** Test-only reset, mirrors `_resetShapeMemoForTests`. */
export function resetOpencodeShapeMemoForTests(): void {
  opencodeBareShapeClasses.clear();
  opencodeShapePausedUntil.clear();
}

/** Port of `isBodyContractEnabled`: headers stay, body half is switchable. */
export function isOpencodeFreeTierBodyContractEnabled(): boolean {
  return (process.env.OPENCODE_FREE_TIER_REQUEST_CONTRACT || "").trim().toLowerCase() !== "off";
}

/**
 * Full upstream message assembly for an OpenCode request body.
 * Mirrors `OpencodeExecutor.transformRequest` (minus kernel-send):
 * 0. `BaseExecutor.transformRequest` sanitize clone, 1. deepseek fallback,
 * 2. free-tier contract via `prepareFreeTierRequest` (configured + observed
 * placeholder names), 3. enum trim, 4. drop `client_metadata`,
 * 5. strip `opencode/`-family prefix, 6. gate `stream_options`,
 * 7. effort split, 8. `reasoning_content` inject. Idempotent.
 */
export function buildOpencodeUpstreamBody<T>(
  body: T,
  model: string,
  stream: boolean,
  provider = "opencode",
  surface: OpencodeSurface = "zen",
  session?: string,
): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  // Order mirrors OpencodeExecutor.transformRequest exactly:
  // 0. BaseExecutor.transformRequest sanitize clone (tools/input/prompt_cache_retention/user|stop|seed|response_format/stripInternal)
  let next = sanitizeOpencodeBaseBody(body);
  // 1. deepseek json_schema -> json_object fallback (provider-gated)
  next = applyOpencodeDeepSeekJsonSchemaFallback(model, next, provider);
  // 2. free-tier contract: port of prepareFreeTierRequest (361-407).
  // gated + body-contract on; eligible = no client tools -> shapeKeyOf ->
  // planShape; bare -> withStreaming only, tools -> apply contract.
  const format = resolveOpencodeTargetFormat(provider, model);
  // Protocol repair (not contract): drop duplicate Responses inputs so a
  // client-side double-append can't 400 the turn. The kernel path dedupes in
  // kernelNormalizeResponsesInput; this covers the direct zen/v1 path.
  if (format === "openai-responses") {
    const record = next as unknown as Record<string, unknown>;
    if (Array.isArray(record.input)) record.input = dedupeKernelResponsesItems(record.input);
  }
  const prepared = prepareOpencodeFreeTierRequest(
    next,
    format === "openai-responses" ? "openai-responses" : "openai",
    surface,
    provider,
    model,
    session,
    body && typeof body === "object" ? (body as object) : undefined,
  );
  next = prepared.body as unknown as typeof next;
  // 3. cap oversized enums on every surface (covers caller + borrowed tools)
  //    and repair parameter-less function tools with the optional `_compat`
  //    param (the free-tier gate refuses hollow tools).
  const asRecord = next as unknown as Record<string, unknown>;
  if (Array.isArray(asRecord.tools)) {
    trimOpencodeOversizedToolEnums(asRecord.tools);
    repairHollowKernelTools(asRecord.tools);
  }
  // 4. drop client_metadata (OpenAI-Codex/Claude-CLI passthrough, upstream 400)
  let out: Record<string, unknown> = asRecord as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(out, "client_metadata")) {
    const { client_metadata: _dropped, ...rest } = out;
    out = rest;
  } else {
    out = { ...out };
  }
  // 5. strip opencode/ prefix (Responses only accepts bare id)
  if (typeof out.model === "string") {
    out.model = stripOpencodeModelPrefix(out.model) as string;
  }
  // 6. stream_options only on streaming Chat Completions (#13699)
  if (format !== "openai" || out.stream !== true) {
    if ("stream_options" in out) {
      const { stream_options: _dropped, ...rest } = out;
      out = rest;
    }
  }
  // 7. deepseek -effort suffix: native flat reasoning_effort contract (#4647),
  //    every other family forwards the aliased id verbatim (#10788).
  const parsed = parseOpencodeEffortLevel(model);
  if (parsed) {
    const deepseekFamily = parsed.baseModel === "deepseek-v4-pro" || parsed.baseModel === "deepseek-v4-flash";
    if (deepseekFamily) {
      out.model = parsed.baseModel;
      if (out.reasoning_effort === undefined) {
        out.reasoning_effort = parsed.effort;
      }
    }
  }
  // 8. thinking families require reasoning_content echo (#1543 / #1099)
  let result: unknown = out;
  if (isOpencodeThinkingMessageModel(model)) {
    result = injectOpencodeReasoningContentForThinkingModel(out);
  }
  void stream;
  return result as T;
}

// The OpenCode session protocol helpers live in the SDK (every backend
// consumes them); they are re-exported here so this module's existing
// importers keep their surface.
import {
  OPENCODE_BACKEND_USER_AGENTS,
  OPENCODE_CLI_BACKEND_HEADER,
  clearOpenCodeSession,
  deriveOpenCodeSessionId,
  generateOpenCodeUlid,
  getOpenCodeProjectId,
  getOpenCodeSessionId,
  openCodeThreadHeaders,
  rotateOpenCodeSession,
  type OpenCodeBackendKind,
} from "@cxu/sdk-backend";
export {
  OPENCODE_BACKEND_USER_AGENTS,
  OPENCODE_CLI_BACKEND_HEADER,
  clearOpenCodeSession,
  deriveOpenCodeSessionId,
  generateOpenCodeUlid,
  getOpenCodeProjectId,
  getOpenCodeSessionId,
  openCodeThreadHeaders,
  rotateOpenCodeSession,
  type OpenCodeBackendKind,
};

export function isOpenCodeGroup(group?: ChannelGroupConfig | null): boolean {
  if (!group) return false;
  return group.id === "opencode-free" ||
    group.id === "opencode" ||
    Boolean(group.baseUrl && group.baseUrl.includes("opencode.ai"));
}

function findOpencodeHeaderCaseInsensitive(source: Headers | null | undefined, name: string): string | undefined {
  if (!source) return undefined;
  const direct = source.get(name)?.trim();
  if (direct) return direct;
  // Headers.get is already case-insensitive; keep raw iteration as fallback for odd runtimes.
  let found: string | undefined;
  source.forEach((value, key) => {
    if (found === undefined && key.toLowerCase() === name.toLowerCase() && value.trim()) {
      found = value.trim();
    }
  });
  return found;
}

const OPENCODE_FORWARD_HEADER_KEYS = [
  "x-opencode-session",
  "x-opencode-request",
  "x-opencode-project",
  "x-opencode-client",
] as const;

const OPENCODE_AGENT_METADATA_KEYS = ["x-session-id", "x-title"] as const;

/** Fallback identity headers, same order as upstream `opencodeSessionIdentity.ts`. */
const OPENCODE_SESSION_FALLBACK_KEYS = [
  "x-opencode-session",
  "x-session-affinity",
  "x-session-id",
  "x-claude-code-session-id",
  "session_id",
  "session-id",
  "x-session_id",
  "thread_id",
  "thread-id",
  "x-thread-id",
] as const;

function resolveOpencodeFallbackSessionId(source: Headers | null | undefined): string | undefined {
  if (!source) return undefined;
  for (const key of OPENCODE_SESSION_FALLBACK_KEYS) {
    const value = findOpencodeHeaderCaseInsensitive(source, key);
    if (value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)) return value;
  }
  return undefined;
}

function applyOpencodeSessionFallback(
  headers: Headers,
  source: Headers | null | undefined,
  sessionBody?: OpencodeSessionBody,
): void {
  if (headers.get("x-opencode-session")?.trim()) return;
  // Upstream: resolveOpencodeSessionIdentity(clientHeaders, sessionBody) —
  // headers win, else body metadata/session_id/thread_id/conversation_id.
  const asRecord: Record<string, string> | null = source
    ? (() => {
        const out: Record<string, string> = {};
        source.forEach((value, key) => {
          out[key] = value;
        });
        return out;
      })()
    : null;
  const affinity =
    resolveOpencodeSessionIdentity(asRecord, sessionBody) ?? resolveOpencodeFallbackSessionId(source);
  if (!affinity) return;
  // Keep the caller's identity as-is when CLI synthesis is disabled;
  // applyCliDefaults renders it in the canonical shape when enabled.
  headers.set("x-opencode-session", affinity);
  if (!headers.get("x-opencode-request")?.trim()) headers.set("x-opencode-request", randomUUID());
}

function applyOpencodeCliDefaults(
  headers: Headers,
  cliDefaults: { userAgent: string; client: string; project: string },
  keepAgentUserAgent = false,
  sessionBody?: OpencodeSessionBody,
): void {
  const currentUa = headers.get("User-Agent")?.trim() || headers.get("user-agent")?.trim() || undefined;
  if (!keepsOpencodeClientUserAgent(currentUa, keepAgentUserAgent)) {
    headers.set("User-Agent", cliDefaults.userAgent);
  }
  if (!headers.get("x-opencode-client")?.trim()) headers.set("x-opencode-client", cliDefaults.client);
  if (!headers.get("x-opencode-project")?.trim()) headers.set("x-opencode-project", cliDefaults.project);
  // Both ids go out in the canonical shape. A client value already in that shape is kept;
  // anything else (UUID, opaque conversation key) is translated deterministically.
  const clientRequestId = headers.get("x-opencode-request")?.trim() || "";
  headers.set(
    "x-opencode-request",
    clientRequestId && OPENCODE_REQUEST_PATTERN.test(clientRequestId)
      ? clientRequestId
      : canonicalOpencodeId("msg_", clientRequestId || undefined),
  );
  const clientSessionId = headers.get("x-opencode-session")?.trim() || "";
  headers.set(
    "x-opencode-session",
    clientSessionId
      ? OPENCODE_SESSION_PATTERN.test(clientSessionId)
        ? clientSessionId
        : canonicalOpencodeId("ses_", clientSessionId)
      : canonicalOpencodeId("ses_", generateOpencodeSessionId(sessionBody ?? null) ?? undefined),
  );
}

export function forwardOpencodeClientHeaders(
  headers: Headers,
  source: Headers | null | undefined,
  options?: {
    synthesizeRequestId?: boolean;
    cliDefaults?: { userAgent: string; client: string; project: string };
    keepAgentUserAgent?: boolean;
    forwardUserAgent?: boolean;
    sessionBody?: OpencodeSessionBody;
  },
): void {
  // 1. Forward User-Agent (opt-out for generic providers).
  const clientUa = findOpencodeHeaderCaseInsensitive(source, "User-Agent");
  if (clientUa && options?.forwardUserAgent !== false) {
    headers.set("User-Agent", clientUa);
  }
  // 2. Forward x-opencode-* metadata headers (case-insensitive, client wins).
  for (const name of OPENCODE_FORWARD_HEADER_KEYS) {
    const value = findOpencodeHeaderCaseInsensitive(source, name);
    if (value) headers.set(name, value);
  }
  // 2b. Forward agent-metadata headers (x-session-id, x-title).
  for (const name of OPENCODE_AGENT_METADATA_KEYS) {
    const value = findOpencodeHeaderCaseInsensitive(source, name);
    if (value) headers.set(name, value);
  }
  // 3. Synthesize session/request id from fallback headers.
  if (options?.synthesizeRequestId || options?.cliDefaults) {
    applyOpencodeSessionFallback(headers, source, options?.sessionBody);
  }
  // 4. Synthesize the OpenCode CLI identity Cloudflare expects for keys the client did not supply.
  if (options?.cliDefaults) {
    applyOpencodeCliDefaults(headers, options.cliDefaults, options.keepAgentUserAgent === true, options?.sessionBody);
  }
}

export function applyOpenCodeHeaders(
  headers: Headers,
  apiKey?: string | null,
  sourceHeaders?: Headers | null,
  options?: { keepAgentUserAgent?: boolean; providerId?: string; gated?: boolean; requestFormat?: string | null; baseUrl?: string; sessionBody?: OpencodeSessionBody },
): void {
  const normalizedFormat = (options?.requestFormat ?? "openai-responses").trim() || "openai-responses";
  const normalizedBase = (options?.baseUrl ?? OMNIROUTE_FREE_BASE_URL).trim();
  const useZenApiKeyAuth =
    normalizedFormat === "claude" ||
    (normalizedFormat === "openai-responses" && normalizedBase === OMNIROUTE_FREE_BASE_URL);
  const gated = options?.gated ?? true;
  const cliDefaults = resolveOpencodeCliDefaults(options?.providerId ?? "opencode", gated);
  forwardOpencodeClientHeaders(headers, sourceHeaders ?? null, {
    synthesizeRequestId: true,
    cliDefaults: cliDefaults ?? undefined,
    keepAgentUserAgent: options?.keepAgentUserAgent === true,
    sessionBody: options?.sessionBody,
  });
  // Fallback when synthesis is disabled via OPENCODE_SYNTHESIZE_CLI_HEADERS=0.
  if (!cliDefaults) {
    if (!headers.get("User-Agent")?.trim()) {
      headers.set("User-Agent", process.env.OPENCODE_USER_AGENT?.trim() || OPENCODE_DEFAULT_USER_AGENT);
    }
    if (!headers.get("x-opencode-client")?.trim()) {
      headers.set("x-opencode-client", process.env.OPENCODE_CLIENT?.trim() || "desktop");
    }
    if (!headers.get("x-opencode-project")?.trim()) headers.set("x-opencode-project", getOpenCodeProjectId());
    if (!headers.get("x-opencode-session")?.trim()) headers.set("x-opencode-session", canonicalOpencodeId("ses_"));
    if (!headers.get("x-opencode-request")?.trim()) {
      headers.set("x-opencode-request", canonicalOpencodeId("msg_"));
    }
  }
  if (apiKey?.trim()) {
    if (useZenApiKeyAuth || normalizedFormat === "claude") {
      headers.set("x-api-key", apiKey.trim());
    } else {
      headers.set("Authorization", `Bearer ${apiKey.trim()}`);
    }
    if (normalizedFormat === "claude") {
      headers.set("anthropic-version", "2023-06-01");
    }
  } else {
    headers.delete("Authorization");
  }
}

export type OmniRouteFreeModel = {
  id: string;
  ownedBy?: string;
};

export type KiloCodeFreeModel = {
  id: string;
  name?: string;
};

export type OmniRouteFreeFetchOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  includeLocal?: boolean;
};

export const EXPLICIT_FREE_MODELS = new Set([
  "big-pickle",
  "beam-free",
  "mimo-v2.6-flash-free",
  "nemotron-3.5-super-vl-free",
  "nemotron-3.5-lightning-free",
  "longcat-2.5-preview-free",
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "minimax-m3.1-flash-free",
]);

export function eligibleOmniRouteFreeModels(value: unknown): OmniRouteFreeModel[] {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [];
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    const record = typeof entry === "string"
      ? { id: entry }
      : entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {};
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const normalized = id.toLowerCase();
    // Local CLI catalogs prefix models from other providers (e.g.
    // `opencode-go/beam-free`, `kilocode/...:free`); those do not exist on
    // the zen free surface, so only accept bare or `opencode/`-scoped ids.
    const prefix = normalized.includes("/") ? normalized.split("/")[0] : "";
    if (prefix && prefix !== "opencode") return [];
    const bare = normalized.replace(/^opencode\//i, "");
    if (!id || seen.has(normalized) || (!bare.endsWith("-free") && !bare.endsWith(":free") && !EXPLICIT_FREE_MODELS.has(bare))) return [];
    seen.add(normalized);
    return [{ id, ownedBy: typeof record.owned_by === "string" ? record.owned_by : undefined }];
  });
}

export function eligibleKiloCodeFreeModels(value: unknown): KiloCodeFreeModel[] {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [];
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    const record = typeof entry === "string"
      ? { id: entry }
      : entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {};
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : undefined;
    const isFree = record.isFree === true;
    const normalized = id.toLowerCase();
    if (!id || seen.has(normalized)) return [];
    if (!isFree && !normalized.endsWith(":free") && !normalized.endsWith("-free")) return [];
    seen.add(normalized);
    return [{ id, name }];
  });
}

export type ClineFreeModel = {
  id: string;
  name?: string;
};

export function eligibleClineFreeModels(value: unknown): ClineFreeModel[] {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data) ? (record.data as Record<string, unknown>) : record;
  const freeList = Array.isArray(data.free) ? data.free : (Array.isArray(record.free) ? record.free : (Array.isArray(value) ? value : []));
  const seen = new Set<string>();
  return freeList.flatMap((entry) => {
    const item = typeof entry === "string" ? { id: entry } : (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {});
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : undefined;
    const normalized = id.toLowerCase();
    if (!id || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ id, name }];
  });
}

export function resolveClineProvidersJsonPath(): string {
  if (process.env.CLINE_SETTINGS_PATH?.trim()) {
    return process.env.CLINE_SETTINGS_PATH.trim();
  }
  return join(homedir(), ".cline", "data", "settings", "providers.json");
}

export type ResolveClineTokenOptions = {
  forceRefresh?: boolean;
  fetchImpl?: typeof fetch;
  settingsPath?: string;
};

let cachedClineToken: {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
} | null = null;

export function clearClineTokenCache(): void {
  cachedClineToken = null;
}

export function formatClineToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("workos:") ? trimmed : `workos:${trimmed}`;
}

export async function resolveLocalClineToken(
  options: ResolveClineTokenOptions = {}
): Promise<string | null> {
  if (process.env.CLINE_API_KEY?.trim()) {
    return formatClineToken(process.env.CLINE_API_KEY);
  }

  const now = Date.now();
  if (cachedClineToken && !options.forceRefresh) {
    if (cachedClineToken.expiresAt > 0 && cachedClineToken.expiresAt - now > 300_000) {
      return cachedClineToken.accessToken;
    }
  }

  const filePath = options.settingsPath || resolveClineProvidersJsonPath();
  if (!existsSync(filePath)) {
    return cachedClineToken?.accessToken || null;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const auth = parsed?.providers?.cline?.settings?.auth;
    if (!auth || typeof auth !== "object") {
      return cachedClineToken?.accessToken || null;
    }

    let accessToken = typeof auth.accessToken === "string" ? auth.accessToken.trim() : "";
    let refreshToken = typeof auth.refreshToken === "string" ? auth.refreshToken.trim() : "";
    let expiresAt = typeof auth.expiresAt === "number"
      ? auth.expiresAt
      : (typeof auth.expiresAt === "string" ? new Date(auth.expiresAt).getTime() : 0);

    const needsRefresh = Boolean(
      refreshToken && (options.forceRefresh || (expiresAt > 0 && expiresAt - now < 300_000))
    );

    if (needsRefresh) {
      const fetchImpl = options.fetchImpl ?? fetch;
      try {
        const refreshResponse = await fetchImpl(`${CLINE_FREE_BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": `Cline/${CLINE_CLIENT_VERSION}`,
            "X-CLIENT-TYPE": "vscode",
            "X-CLIENT-VERSION": CLINE_CLIENT_VERSION,
            "X-CORE-VERSION": CLINE_CLIENT_VERSION,
            "X-PLATFORM": process.platform === "win32" ? "win32" : (process.platform === "darwin" ? "darwin" : "linux"),
          },
          body: JSON.stringify({
            refreshToken,
            grantType: "refresh_token"
          }),
          signal: AbortSignal.timeout(10_000)
        });

        if (refreshResponse.ok) {
          const json = await refreshResponse.json() as Record<string, unknown>;
          const data = (json?.data && typeof json.data === "object" ? json.data : json) as Record<string, unknown>;
          if (typeof data.accessToken === "string" && data.accessToken.trim()) {
            accessToken = formatClineToken(data.accessToken);
            if (typeof data.refreshToken === "string" && data.refreshToken.trim()) {
              refreshToken = data.refreshToken.trim();
            }
            if (typeof data.expiresAt === "number" && Number.isFinite(data.expiresAt)) {
              expiresAt = data.expiresAt;
            } else if (typeof data.expiresAt === "string" && data.expiresAt) {
              const parsedTime = new Date(data.expiresAt).getTime();
              if (Number.isFinite(parsedTime) && parsedTime > 0) {
                expiresAt = parsedTime;
              } else {
                expiresAt = now + 3600_000;
              }
            } else {
              expiresAt = now + 3600_000;
            }

            auth.accessToken = accessToken;
            if (refreshToken) auth.refreshToken = refreshToken;
            auth.expiresAt = expiresAt;

            try {
              writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8");
            } catch {
              // Ignore file write failure
            }
          }
        }
      } catch {
        // Network failure during refresh; fallback to existing token
      }
    }

    if (accessToken) {
      accessToken = formatClineToken(accessToken);
      cachedClineToken = { accessToken, refreshToken, expiresAt };
      return accessToken;
    }
  } catch {
    // Parsing error
  }

  return cachedClineToken?.accessToken || null;
}

// 1. 原来的 free 分组 (CodexUltraFree，zen 免费模型目前只支持 chat/completions)
export function buildOmniRouteFreeGroup(models: string[]): ChannelGroupConfig {
  const availableModels = [...new Set(models)];
  return {
    id: "opencode-free",
    name: "CodexUltraFree",
    baseUrl: OMNIROUTE_FREE_BASE_URL,
    kind: "text",
    status: "enabled",
    groupRatio: 0,
    models: availableModels,
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    remark: "CodexUltraFree managed free models",
    authType: "none",
    credentialMode: "group",
    keyMode: "single",
    keys: []
  };
}

// 2. 新增 opencode 分组 (OpenCode 独立分组，协议使用 chat/completions)
export function buildOpenCodeGroup(models: string[]): ChannelGroupConfig {
  const availableModels = [...new Set(models)];
  return {
    id: "opencode",
    name: "OpenCode",
    baseUrl: OMNIROUTE_FREE_BASE_URL,
    kind: "text",
    status: "enabled",
    groupRatio: 0,
    models: availableModels,
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    remark: "OpenCode managed free models",
    authType: "none",
    credentialMode: "group",
    keyMode: "single",
    keys: []
  };
}

// 3. 新增 kilocode 分组 (KiloCode 独立分组，默认使用 openai-response 协议)
export function buildKiloCodeGroup(models: string[]): ChannelGroupConfig {
  const availableModels = [...new Set(models)];
  return {
    id: "kilocode",
    name: "KiloCode",
    baseUrl: KILOCODE_FREE_BASE_URL,
    kind: "text",
    status: "enabled",
    groupRatio: 0,
    models: availableModels,
    responseProtocol: "openai-response",
    responseProtocolMode: "fixed",
    remark: "KiloCode managed free models",
    authType: "none",
    credentialMode: "group",
    keyMode: "single",
    keys: []
  };
}

// 4. 新增 cline-free 分组 (Cline 独立分组，使用 openai 协议 + Bearer Token)
export function buildClineFreeGroup(models: string[], apiKey = ""): ChannelGroupConfig {
  const availableModels = [...new Set(models)];
  return {
    id: "cline-free",
    name: "ClineFree",
    baseUrl: CLINE_FREE_BASE_URL,
    kind: "text",
    status: "enabled",
    groupRatio: 0,
    models: availableModels,
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    remark: "Cline managed promotional free models",
    authType: "bearer",
    credentialMode: "group",
    keyMode: "single",
    keys: apiKey ? [apiKey] : []
  };
}

// 5. 新增 freebuff 分组 (Freebuff 独立分组，使用 openai 协议 + Bearer Token)
export function buildFreebuffGroup(models: string[], apiKey = ""): ChannelGroupConfig {
  const availableModels = [...new Set(models)];
  return {
    id: "freebuff",
    name: "Freebuff",
    baseUrl: FREEBUFF_BASE_URL,
    kind: "text",
    status: "enabled",
    groupRatio: 0,
    models: availableModels.length > 0 ? availableModels : [...DEFAULT_FREEBUFF_MODELS],
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    remark: "Freebuff managed promotional free models",
    authType: "bearer",
    credentialMode: "group",
    keyMode: "single",
    keys: apiKey ? [apiKey] : []
  };
}

// 6. 新增 d2api 分组 (自托管 DuckDuckGo 免费后端，OpenAI 兼容协议；
//    无需 key，默认上下文 20K；仅当 d2api 服务端设置了 Authorization 才需要 key)
export const D2API_BASE_URL = "http://127.0.0.1:44090";
export const D2API_DEFAULT_CONTEXT_WINDOW = 20_000;
export const D2API_DEFAULT_MODELS = [
  "claude-haiku-4-5",
  "mistral-small-2603",
  "tinfoil/gpt-oss-120b",
  "gpt-6-luna",
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "tinfoil/gemma4-31b"
];

export function buildD2ApiFreeGroup(models: string[], apiKey = "", baseUrl = ""): ChannelGroupConfig {
  // Migrate delisted flagship: old persisted groups may still carry gpt-5.6-luna.
  const availableModels = [...new Set(models.map((m) => {
    const lower = m.toLowerCase().trim();
    if (lower === "gpt-5.6-luna" || lower === "gpt-5.6-luna-thinking") return "gpt-6-luna";
    return m;
  }))];
  const key = apiKey.trim();
  return {
    id: "d2api",
    name: "D2API",
    baseUrl: baseUrl.trim() || D2API_BASE_URL,
    kind: "text",
    status: "enabled",
    groupRatio: 0,
    models: availableModels.length > 0 ? availableModels : [...D2API_DEFAULT_MODELS],
    contextWindow: D2API_DEFAULT_CONTEXT_WINDOW,
    responseProtocol: "openai",
    responseProtocolMode: "fixed",
    remark: "D2API managed free models (DuckDuckGo backend)",
    authType: key ? "bearer" : "none",
    credentialMode: "group",
    keyMode: "single",
    keys: key ? [key] : []
  };
}

export type D2ApiFreeFetchOptions = OmniRouteFreeFetchOptions & {
  baseUrl?: string;
};

/** Probe a local/remote d2api instance for its model directory (OpenAI shape). */
export async function fetchD2ApiFreeModels(
  options: D2ApiFreeFetchOptions = {}
): Promise<{ models: string[]; fetchedModels: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 10_000);
  const base = (options.baseUrl?.trim() || D2API_BASE_URL).replace(/\/+$/, "");
  const modelsResponse = await fetchImpl(`${base}/v1/models`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!modelsResponse.ok) throw new Error(`D2API models returned HTTP ${modelsResponse.status}`);
  const payload = await modelsResponse.json() as unknown;
  const entries = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  const ids = [...new Set(entries
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
        return ((entry as { id: string }).id).trim();
      }
      return "";
    })
    .filter((id) => id.length > 0))];
  if (ids.length === 0) throw new Error("D2API returned no models");
  return { models: ids, fetchedModels: ids.length };
}

export type BuildAllFreeGroupsOptions = {
  hasClineCredentials?: boolean;
  hasFreebuffCredentials?: boolean;
  d2apiModels?: string[];
  d2apiApiKey?: string;
  d2apiBaseUrl?: string;
};

export function buildAllFreeGroups(
  _opencodeModels: string[],
  kiloModels: string[],
  clineModelsOrExisting?: string[] | ChannelGroupConfig[],
  freebuffModelsOrExisting?: string[] | ChannelGroupConfig[] | BuildAllFreeGroupsOptions,
  existingGroupsArg?: ChannelGroupConfig[] | BuildAllFreeGroupsOptions,
  optionsArg?: BuildAllFreeGroupsOptions
): ChannelGroupConfig[] {
  let clineModels: string[] | undefined = undefined;
  let freebuffModels: string[] | undefined = undefined;
  let existingGroups: ChannelGroupConfig[] = [];
  let options: BuildAllFreeGroupsOptions | undefined = undefined;

  const isOptions = (val: unknown): val is BuildAllFreeGroupsOptions =>
    typeof val === "object" && val !== null && !Array.isArray(val) && !("id" in val);

  if (isOptions(optionsArg)) {
    options = optionsArg;
  } else if (isOptions(existingGroupsArg)) {
    options = existingGroupsArg;
  } else if (isOptions(freebuffModelsOrExisting)) {
    options = freebuffModelsOrExisting;
  }

  const isGroupConfigArray = (val: unknown): val is ChannelGroupConfig[] =>
    Array.isArray(val) && val.length > 0 && typeof val[0] === "object" && val[0] !== null && "id" in val[0];

  if (Array.isArray(existingGroupsArg)) {
    existingGroups = existingGroupsArg;
    if (Array.isArray(clineModelsOrExisting) && !isGroupConfigArray(clineModelsOrExisting)) {
      clineModels = clineModelsOrExisting as string[];
    }
    if (Array.isArray(freebuffModelsOrExisting) && !isGroupConfigArray(freebuffModelsOrExisting)) {
      freebuffModels = freebuffModelsOrExisting as string[];
    }
  } else if (Array.isArray(freebuffModelsOrExisting)) {
    if (isGroupConfigArray(freebuffModelsOrExisting)) {
      existingGroups = freebuffModelsOrExisting;
      if (Array.isArray(clineModelsOrExisting) && !isGroupConfigArray(clineModelsOrExisting)) {
        clineModels = clineModelsOrExisting as string[];
      }
    } else {
      if (Array.isArray(clineModelsOrExisting) && !isGroupConfigArray(clineModelsOrExisting)) {
        clineModels = clineModelsOrExisting as string[];
      }
      freebuffModels = freebuffModelsOrExisting as string[];
      existingGroups = [];
    }
  } else if (Array.isArray(clineModelsOrExisting)) {
    if (isGroupConfigArray(clineModelsOrExisting)) {
      existingGroups = clineModelsOrExisting;
    } else {
      clineModels = clineModelsOrExisting as string[];
      existingGroups = [];
    }
  }

  const existingKilo = existingGroups.find((g) => g.id === "kilocode");
  const existingCline = existingGroups.find((g) => g.id === "cline-free");
  const existingFreebuff = existingGroups.find((g) => g.id === "freebuff");
  const existingD2Api = existingGroups.find((g) => g.id === "d2api");

  // 新抓取优先！仅抓取失败或结果为空时回退沿用旧模型
  const kiloModelsMerged = kiloModels.length > 0 ? [...new Set(kiloModels)] : (existingKilo?.models ?? []);

  const groupKiloCode: ChannelGroupConfig = {
    ...buildKiloCodeGroup(kiloModelsMerged),
    ...(existingKilo ? {
      name: existingKilo.name || "KiloCode",
      modelMapping: existingKilo.modelMapping
    } : {}),
    models: kiloModelsMerged,
    responseProtocol: "openai-response",
    responseProtocolMode: "fixed"
  };

  // OpenCode 免费渠道已下线，仅保留 KiloCode 及其它显式启用的免费渠道。
  const groups = [groupKiloCode];

  // 彩蛋机制：未安装或未配置凭据时静默隐藏；一旦检测到凭据或已配置 keys，自动点亮
  let includeCline = false;
  if (options?.hasClineCredentials !== undefined) {
    includeCline = options.hasClineCredentials || Boolean(existingCline?.keys && existingCline.keys.length > 0);
  } else {
    includeCline = clineModels !== undefined || Boolean(existingCline);
  }

  let includeFreebuff = false;
  if (options?.hasFreebuffCredentials !== undefined) {
    includeFreebuff = options.hasFreebuffCredentials || Boolean(existingFreebuff?.keys && existingFreebuff.keys.length > 0);
  } else {
    includeFreebuff = freebuffModels !== undefined || Boolean(existingFreebuff);
  }

  if (includeCline) {
    const clineModelsMerged = (clineModels && clineModels.length > 0)
      ? [...new Set(clineModels)]
      : (existingCline?.models ?? []);

    const groupCline: ChannelGroupConfig = {
      ...buildClineFreeGroup(clineModelsMerged),
      ...(existingCline ? {
        name: existingCline.name || "ClineFree",
        modelMapping: existingCline.modelMapping,
        keys: existingCline.keys?.length ? existingCline.keys : []
      } : {}),
      models: clineModelsMerged,
      responseProtocol: "openai",
      responseProtocolMode: "fixed"
    };
    groups.push(groupCline);
  }

  if (includeFreebuff) {
    const freebuffModelsMerged = (freebuffModels && freebuffModels.length > 0)
      ? [...new Set(freebuffModels)]
      : (existingFreebuff?.models ?? [...DEFAULT_FREEBUFF_MODELS]);

    const groupFreebuff: ChannelGroupConfig = {
      ...buildFreebuffGroup(freebuffModelsMerged),
      ...(existingFreebuff ? {
        name: existingFreebuff.name || "Freebuff",
        modelMapping: existingFreebuff.modelMapping,
        keys: existingFreebuff.keys?.length ? existingFreebuff.keys : []
      } : {}),
      models: freebuffModelsMerged,
      responseProtocol: "openai",
      responseProtocolMode: "fixed"
    };
    groups.push(groupFreebuff);
  }

  // d2api 自托管免费组：显式传入模型（import 探测）即纳入；否则沿用已入库的组。
  const includeD2Api = options?.d2apiModels !== undefined || Boolean(existingD2Api);
  if (includeD2Api) {
    const rawMerged = (options?.d2apiModels && options.d2apiModels.length > 0)
      ? [...new Set(options.d2apiModels)]
      : (existingD2Api?.models ?? [...D2API_DEFAULT_MODELS]);
    // Migrate delisted flagship in persisted groups.
    const d2apiModelsMerged = [...new Set(rawMerged.map((m) => {
      const lower = m.toLowerCase().trim();
      if (lower === "gpt-5.6-luna" || lower === "gpt-5.6-luna-thinking") return "gpt-6-luna";
      return m;
    }))];
    const d2apiKey = options?.d2apiApiKey?.trim()
      || (existingD2Api?.keys?.[0]?.trim() ?? "");
    const d2apiBase = options?.d2apiBaseUrl?.trim()
      || existingD2Api?.baseUrl?.trim()
      || D2API_BASE_URL;

    const groupD2Api: ChannelGroupConfig = {
      ...buildD2ApiFreeGroup(d2apiModelsMerged, d2apiKey, d2apiBase),
      ...(existingD2Api ? {
        name: existingD2Api.name || "D2API",
        modelMapping: existingD2Api.modelMapping,
        keys: d2apiKey ? [d2apiKey] : []
      } : {}),
      models: d2apiModelsMerged,
      baseUrl: d2apiBase,
      contextWindow: D2API_DEFAULT_CONTEXT_WINDOW,
      responseProtocol: "openai",
      responseProtocolMode: "fixed"
    };
    groups.push(groupD2Api);
  }

  return groups;
}

export async function fetchLocalOpencodeFreeModels(
  options: { bin?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<{ models: string[]; fetchedModels: number }> {
  const { listOpencodeModelsAsync } = await import("../../../opencode/src/runtime/opencodeCompatibleProbe.js");
  const models = await listOpencodeModelsAsync(options.bin, options.env ?? process.env, options.timeoutMs ?? 10_000);
  const eligible = eligibleOmniRouteFreeModels(models);
  const normalized = [...new Set(eligible.map((entry) => entry.id.replace(/^opencode\//i, "")))];
  return {
    models: normalized,
    fetchedModels: normalized.length
  };
}

export async function fetchOmniRouteFreeModels(
  options: OmniRouteFreeFetchOptions = {}
): Promise<{ models: string[]; fetchedModels: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 10_000);
  const shouldIncludeLocal = options.includeLocal ?? (options.fetchImpl === undefined);

  let localModels: string[] = [];
  if (shouldIncludeLocal) {
    try {
      const local = await fetchLocalOpencodeFreeModels({ timeoutMs: Math.min(timeoutMs, 5_000) });
      localModels = local.models;
    } catch {
      // Local CLI unavailable or failed, proceed to remote
    }
  }

  let remoteModels: string[] = [];
  let remoteError: Error | null = null;
  try {
    const headers = new Headers({ Accept: "application/json" });
    applyOpenCodeHeaders(headers);
    const modelsResponse = await fetchImpl(`${OMNIROUTE_FREE_BASE_URL}/models`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!modelsResponse.ok) {
      remoteError = new Error(`OpenCode Free models returned HTTP ${modelsResponse.status}`);
    } else {
      const eligible = eligibleOmniRouteFreeModels(await modelsResponse.json());
      remoteModels = eligible.map((entry) => entry.id.replace(/^opencode\//i, ""));
    }
  } catch (err) {
    remoteError = err instanceof Error ? err : new Error(String(err));
  }

  // The live `/models` catalog is authoritative for the zen free surface; a
  // local CLI may still advertise delisted ids (e.g. nemotron-3-ultra-free)
  // that upstream now answers with 410. Only fall back to the local list when
  // the remote catalog is unavailable.
  const combined = [...new Set(remoteModels.length > 0 ? remoteModels : localModels)];
  if (combined.length === 0) {
    const fallbackList = [...EXPLICIT_FREE_MODELS].map((m) => m.replace(/^opencode\//i, ""));
    if (fallbackList.length > 0) {
      return {
        models: fallbackList,
        fetchedModels: fallbackList.length
      };
    }
    if (remoteError) throw remoteError;
    throw new Error("OpenCode Free returned no eligible free chat models");
  }

  return {
    models: combined,
    fetchedModels: combined.length
  };
}

export async function fetchKiloCodeFreeModels(
  options: OmniRouteFreeFetchOptions = {}
): Promise<{ models: string[]; fetchedModels: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 10_000);
  const modelsResponse = await fetchImpl(`${KILOCODE_FREE_BASE_URL}/models`, {
    headers: {
      Accept: "application/json",
      "User-Agent": KILOCODE_USER_AGENT
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!modelsResponse.ok) throw new Error(`KiloCode Free models returned HTTP ${modelsResponse.status}`);
  const eligible = eligibleKiloCodeFreeModels(await modelsResponse.json());
  if (eligible.length === 0) throw new Error("KiloCode Free returned no eligible free models");
  return {
    models: eligible.map((entry) => entry.id),
    fetchedModels: eligible.length
  };
}

export async function fetchClineFreeModels(
  options: OmniRouteFreeFetchOptions = {}
): Promise<{ models: string[]; fetchedModels: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 10_000);
  const modelsResponse = await fetchImpl(CLINE_RECOMMENDED_MODELS_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": `Cline/${CLINE_CLIENT_VERSION}`
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!modelsResponse.ok) throw new Error(`Cline Free models returned HTTP ${modelsResponse.status}`);
  const eligible = eligibleClineFreeModels(await modelsResponse.json());
  if (eligible.length === 0) throw new Error("Cline Free returned no eligible free models");
  return {
    models: eligible.map((entry) => entry.id),
    fetchedModels: eligible.length
  };
}

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

let cachedClineBalance: { data: ClineBalanceInfo; expiresAt: number } | null = null;

export async function fetchClineBalance(
  options: { forceRefresh?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<ClineBalanceInfo> {
  const now = Date.now();
  if (cachedClineBalance && !options.forceRefresh && cachedClineBalance.expiresAt > now) {
    return cachedClineBalance.data;
  }

  const token = await resolveLocalClineToken({ fetchImpl: options.fetchImpl });
  if (!token) {
    return { configured: false, error: "No Cline token found" };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const authToken = token.startsWith("workos:") ? token : `workos:${token}`;

  try {
    const meRes = await fetchImpl(`${CLINE_FREE_BASE_URL}/users/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        "X-CLIENT-TYPE": "vscode",
        "X-CLIENT-VERSION": CLINE_CLIENT_VERSION,
      },
      signal: AbortSignal.timeout(10_000)
    });

    if (!meRes.ok) {
      return { configured: true, error: `Failed to fetch Cline user (${meRes.status})` };
    }

    const meJson = (await meRes.json().catch(() => ({}))) as Record<string, unknown>;
    const meData = (meJson?.data && typeof meJson.data === "object" ? meJson.data : meJson) as Record<string, unknown>;
    const userId = typeof meData?.id === "string" ? meData.id : "";
    const email = typeof meData?.email === "string" ? meData.email : "";
    const displayName = typeof meData?.displayName === "string" ? meData.displayName : "";

    if (!userId) {
      return { configured: true, email, displayName, error: "User ID not found in Cline response" };
    }

    const balRes = await fetchImpl(`${CLINE_FREE_BASE_URL}/users/${userId}/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        "X-CLIENT-TYPE": "vscode",
        "X-CLIENT-VERSION": CLINE_CLIENT_VERSION,
      },
      signal: AbortSignal.timeout(10_000)
    });

    if (!balRes.ok) {
      return { configured: true, userId, email, displayName, error: `Failed to fetch balance (${balRes.status})` };
    }

    const balJson = (await balRes.json().catch(() => ({}))) as Record<string, unknown>;
    const balData = (balJson?.data && typeof balJson.data === "object" ? balJson.data : balJson) as Record<string, unknown>;
    const rawBalance = typeof balData?.balance === "number" ? balData.balance : 0;
    const credits = Math.round((rawBalance / 10000) * 100) / 100;
    const formattedBalance = `$${credits.toFixed(2)}`;

    const result: ClineBalanceInfo = {
      configured: true,
      userId,
      email,
      displayName,
      credits,
      rawBalance,
      formattedBalance
    };

    cachedClineBalance = { data: result, expiresAt: now + 45_000 };
    return result;
  } catch (err) {
    return { configured: true, error: err instanceof Error ? err.message : String(err) };
  }
}

