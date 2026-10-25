import { createHash, randomUUID } from "node:crypto";
import type {
  ChannelGroupConfig,
  JsonValue,
  ProviderConfig,
  RelayResponseProtocol
} from "@codex-ui/shared";
import { freeOllamaModelSupportsThinking } from "./freeOllama.js";
import { resolveModelMaxOutputTokens, stripModelContextVariant } from "@codex-ui/shared";
import { modelSupportsProtocol, resolveModelProtocol } from "./relayCatalog.js";
import {
  getOrEnsureFreebuffSession,
  clearFreebuffSession,
  createFreebuffRunId,
  FREEBUFF_SYSTEM_PROMPT_PREFIX,
  FREEBUFF_SIGNATURE_TOOL,
  type FreebuffSessionInfo
} from "./freebuffSession.js";
import {
  applyMuseSparkMinOutputTokens,
  applyOpenCodeHeaders,
  buildOpencodeObservedRetryBody,
  buildOpencodeUpstreamBody,
  configuredOpencodePlaceholderToolNames,
  isGatedOpencodeFreeTierRequest,
  isOpenCodeGroup,
  isOwnOpencodeToolsRetryableRefusal,
  MUSE_SPARK_MIN_OUTPUT_TOKENS,
  noteOpencodeFreeTierOutcome,
  OMNIROUTE_FREE_BASE_URL,
  opencodeAttemptFor,
  opencodeRetryScopeApplies,
  projectOpencodeSessionBody,
  resolveOpencodeTargetFormat,
  surfaceFromBaseUrl,
  OPENCODE_BACKEND_USER_AGENTS,
  OPENCODE_CLI_BACKEND_HEADER,
  rotateOpenCodeSession,
  buildKernelBody,
  buildKernelHeaders,
  canonicalOpencodeId,
  kernelIdentityFor,
  kernelSurfaceForRequest,
  kernelUrlFor,
  kernelUrlForSurface,
  shouldUseKernelSend
} from "./omniRouteFree.js";

// Embedded duck2api (TS port): the `d2api` free group never leaves this
// process — requests dispatch in-process to the app the host provides
// through PluginHostServices instead of HTTP.
// NOTE: duck2api reads PREFIX/API_KEYS at module import; the host loads
// it at boot, so keep process env settled before the first d2api turn.
// fetch-impersonate stays external in the server bundle and loads by
// default (Chrome146, Go parity); only explicit DUCK_FETCH=native opts
// out to native fetch.
import { pluginHostServices, type PluginHostServices } from "@cxu/sdk-backend";

type CanonicalContentPart =
  | { type: "text"; text: string; cacheControl?: JsonValue }
  | { type: "image"; url: string; mimeType?: string; cacheControl?: JsonValue };

type CanonicalToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type CanonicalMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: CanonicalContentPart[];
  toolCallId?: string;
  toolCalls?: CanonicalToolCall[];
  /** Cache breakpoint applied to the last content block when re-emitted (Responses/Anthropic). */
  cacheControl?: JsonValue;
};

type CanonicalTool = {
  name: string;
  responseName: string;
  namespace?: string;
  description?: string;
  inputSchema: Record<string, JsonValue>;
  responseType: "function_call" | "custom_tool_call";
  cacheControl?: JsonValue;
};

type RelayToolIdentity = {
  name: string;
  namespace?: string;
  transportName: string;
};

type RelayToolCompatibility = {
  bySource: Map<string, RelayToolIdentity>;
  byTransportName: Map<string, RelayToolIdentity>;
  byUniqueResponseName: Map<string, RelayToolIdentity>;
};

type PreparedResponsesRequest = {
  body: Record<string, unknown>;
  tools: RelayToolCompatibility;
};

type CanonicalRequest = {
  model: string;
  instructions?: string;
  reasoningEffort?: string;
  reasoningSummary?: string;
  messages: CanonicalMessage[];
  tools: CanonicalTool[];
  toolChoice?: JsonValue;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  /** Cache breakpoint for the system prompt, carried from an Anthropic system block array. */
  systemCacheControl?: JsonValue;
  /**
   * Stable key forwarded to an OpenAI-compatible upstream as `prompt_cache_key`
   * so the upstream keeps the conversation's prompt prefix cached across turns.
   * Resolved from the inbound `prompt_cache_key`/`metadata.prompt_cache_key`, or —
   * matching cc-switch — a real per-session identity (never a per-request UUID).
   * Mirrors cc-switch: an explicit client key wins; a real session id is the only
   * fallback; if neither is present nothing is injected upstream.
   */
  promptCacheKey?: string;
  /**
   * Explicit web-search request (duck2api `web_search`). Carried end-to-end
   * only when the client sets it; canonicalToChat forwards it so Duck.ai
   * enables server-side search instead of relying on auto-detect.
   */
  webSearch?: boolean;
};

type CanonicalResult = {
  model: string;
  text: string;
  reasoning?: string;
  toolCalls: CanonicalToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
  };
  finishReason?: string;
};

type CanonicalStreamEvent =
  | { type: "metadata"; model?: string; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheWriteInputTokens?: number; finishReason?: string }
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "tool_start"; index: number; id?: string; name?: string }
  | { type: "tool_arguments_delta"; index: number; delta: string; id?: string; name?: string }
  | { type: "error"; message: string };

export type RelayToolDiagnostic = {
  id: number;
  recordedAt: number;
  model: string;
  protocol: RelayResponseProtocol;
  toolCount: number;
  toolNames: string[];
};

const relayToolDiagnostics: RelayToolDiagnostic[] = [];
let relayToolDiagnosticId = 0;
const relayKeyCursors = new Map<string, number>();
const RELAY_UPSTREAM_STATUS_HEADER = "x-codex-relay-upstream-status";
const RELAY_FAILOVER_CANDIDATE_HEADER = "x-codex-relay-failover-candidate";

export const RELAY_UPSTREAM_HEADERS_TIMEOUT_MS = 30_000;
export const RELAY_FAILOVER_BUDGET_MS = 300_000;

export async function fetchUpstreamWithHeadersTimeout(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  headersTimeoutMs: number = RELAY_UPSTREAM_HEADERS_TIMEOUT_MS
): Promise<Response> {
  const timeoutMs = Number.isFinite(headersTimeoutMs) && headersTimeoutMs > 0
    ? Math.floor(headersTimeoutMs)
    : RELAY_UPSTREAM_HEADERS_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = fetch(input, init);
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Upstream headers timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    pending.then(() => undefined, () => undefined);
  }
}

const DEFAULT_ENDPOINTS: Record<RelayResponseProtocol, string> = {
  "openai-response": "/v1/responses",
  openai: "/v1/chat/completions",
  anthropic: "/v1/messages",
  gemini: "/v1beta/models/{model}:generateContent"
};

export async function runRelayProtocolRequest(input: {
  request: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKey: string;
}): Promise<Response> {
  const rawBody = await input.request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return errorResponse(400, "Relay gateway requires a JSON Responses request");
  }
  const requestRecord = rawBody as Record<string, unknown>;
  const selectedModel = resolveMappedModel(input.group, stringValue(requestRecord.model) ?? input.group.models?.[0] ?? input.provider.defaultModel ?? "");
  if (!selectedModel) return errorResponse(400, "Relay gateway request has no model");
  if (input.group.status === "disabled") return errorResponse(409, `Relay group ${input.group.name} is disabled`);

  const baseSelectedModel = stripModelContextVariant(selectedModel).baseModel;
  const catalogModel = input.provider.capabilityCatalog?.data.find((model) => model.model_name === selectedModel || model.model_name === baseSelectedModel);
  if (hasRemoteCompactionV2Trigger(requestRecord) && !catalogModel?.supported_endpoint_types.includes("openai-response-compaction-v2")) {
    return errorResponse(400, `Model ${selectedModel} does not advertise openai-response-compaction-v2 support; use local compaction or a compatible relay`);
  }
  if (new URL(input.request.url).pathname.endsWith("/responses/compact")) {
    if (!catalogModel?.supported_endpoint_types.includes("openai-response-compact")) {
      return errorResponse(400, `Model ${selectedModel} does not advertise openai-response-compact support`);
    }
    return proxyResponsesCompactRequest({ ...input, rawBody: { ...requestRecord, model: selectedModel } });
  }
  const protocol = resolveModelProtocol(input.group, catalogModel);
  if (process.env.CODEX_UI_RELAY_TOOL_DIAGNOSTICS === "1") {
    const diagnostic = recordRelayToolDiagnostic(summarizeResponsesRequestTools(requestRecord, selectedModel, protocol));
    console.info("[relay-tools]", diagnostic);
  }
  if (!modelSupportsProtocol(catalogModel, protocol)) {
    return errorResponse(400, `Model ${selectedModel} does not support group protocol ${protocol}`);
  }
  if (!input.group.baseUrl && !input.provider.baseUrl) {
    return errorResponse(400, `Relay group ${input.group.name} is missing baseUrl`);
  }

  const preparedRequest = prepareResponsesRequestForRelay({ ...requestRecord, model: selectedModel });
  const canonical = responsesRequestToCanonical(preparedRequest.body, selectedModel, preparedRequest.tools);
  const selectedCapability = input.group.modelCapabilities?.[selectedModel]
    ?? input.group.modelCapabilities?.[baseSelectedModel];
  canonical.maxOutputTokens ??= resolveModelMaxOutputTokens(selectedModel, selectedCapability);
  const resolvedResponseCacheKey = resolveCanonicalPromptCacheKey(
    input.request,
    preparedRequest.body,
    conversationPromptCacheAnchor(canonical)
  );
  if (resolvedResponseCacheKey) canonical.promptCacheKey = resolvedResponseCacheKey;
  const wantsStream = requestRecord.stream === true;
  // cc-switch mirror: a Codex Responses request aimed at a Claude (anthropic-wire)
  // upstream must never be passthrough-forwarded as a raw Responses body. new-api's
  // responses→claude converter stamps no `cache_control` breakpoints, and Codex emits
  // none, so the cache would read 0. Instead translate to Anthropic Messages — the
  // canonical path runs `canonicalToAnthropic`, which auto-stamps the standard Claude
  // cache_control breakpoints (system / trailing tool / prefix message). Only remain
  // on the openai-response passthrough when the upstream genuinely speaks Responses
  // (an OpenAI-native model, where implicit prefix caching + prompt_cache_key is the
  // correct mechanism). Require an EXPLICIT anthropic capability in the catalog —
  // modelSupportsProtocol(undefined, ...) is deliberately permissive, so absence of a
  // catalog (or a model that only advertises openai-response) keeps the passthrough.
  let effectiveProtocol = protocol;
  if (isEmbeddedD2ApiGroup(input.group) || isEmbeddedOpencodeLocalGroup(input.provider)) {
    effectiveProtocol = "openai";
  } else if (protocol === "openai-response" && Boolean(catalogModel?.supported_endpoint_types.includes("anthropic"))) {
    effectiveProtocol = "anthropic";
  }
  if (protocol === "openai-response" && effectiveProtocol === "openai-response") {
    return proxyResponsesRequest({
      ...input,
      rawBody: preparedRequest.body,
      toolCompatibility: preparedRequest.tools,
      protocol,
      selectedModel,
      promptCacheKey: resolvedResponseCacheKey,
      userAgent: input.request.headers.get("user-agent")
    });
  }

  if (wantsStream) {
    return runCanonicalUpstreamStream({
      provider: input.provider,
      group: input.group,
      apiKey: input.apiKey,
      protocol: effectiveProtocol as Exclude<RelayResponseProtocol, "openai-response">,
      request: canonical,
      signal: input.request.signal,
      userAgent: input.request.headers.get("user-agent"),
      sourceHeaders: input.request.headers
    });
  }

  const upstream = await runCanonicalUpstream({
    provider: input.provider,
    group: input.group,
    apiKey: input.apiKey,
    protocol: effectiveProtocol as Exclude<RelayResponseProtocol, "openai-response">,
    request: canonical,
    signal: input.request.signal,
    userAgent: input.request.headers.get("user-agent"),
    sourceHeaders: input.request.headers
  });
  if (!upstream.ok) return upstream.response;
  const responseBody = canonicalResultToResponses(upstream.result, canonical.tools);
  return jsonResponse(responseBody, 200);
}

function hasRemoteCompactionV2Trigger(record: Record<string, unknown>): boolean {
  return Array.isArray(record.input) && record.input.some((item) => asRecord(item).type === "compaction");
}

export function isFreebuffGroup(group?: ChannelGroupConfig, provider?: ProviderConfig): boolean {
  return group?.id === "freebuff" || provider?.id === "freebuff";
}

export const FREE_CHANNEL_RETRY_DELAYS_MS = [2000, 5000, 10000];
export const FREE_CHANNEL_MAX_DELAY_MS = 10000;

/**
 * Free-channel egress policy: LOCAL DIRECT ONLY.
 *
 * goproxy (`zen.go` `zenExecute` + `config.go` `loadProxyPool`) spreads
 * keyless Zen turns over a WEBSHARE-style proxy pool: every account owns a
 * dedicated exit IP, a 429 marks that IP `rateTried`, and the next attempt
 * picks another proxy (`pickZenAccount`, `zenProxyKey`, `SharedEgressGuard`).
 * That is an egress-IP rotation feature, not a free-tier contract feature.
 *
 * Codex Ultra never dials the free tier through a proxy pool: every attempt
 * leaves the host with its own IP, so a retry below is only a local re-dial
 * (plus an `opencode` session rotation) and never an IP switch. The goproxy
 * `.env` keys are deliberately inert here — reading them would silently turn
 * a direct deployment into an IP-polling one.
 */
export const FREE_CHANNEL_EGRESS_MODE = "direct" as const;

/** goproxy egress-pool env keys that must stay inert in direct mode. */
const IGNORED_PROXY_POOL_ENV_KEYS = [
  "WEBSHARE_PROXIES",
  "WEBSHARE_API_KEY",
  "WEBSHARE_FILE",
  "WEBSHARE_ENABLE",
  "WEBSHARE_MODE",
  "WEBSHARE_ROTATE_TOKENS",
  "WEBSHARE_IDLE_RELEASE_MIN",
  "SHARE_429_ROTATE_AFTER_S",
  "NETWORK_ROTATION_SHARED_EGRESS_GUARD",
] as const;

/** Which proxy-pool env keys are set but intentionally ignored (direct egress). */
export function ignoredProxyPoolEnvKeys(
  env: Record<string, string | undefined> = process.env
): string[] {
  return IGNORED_PROXY_POOL_ENV_KEYS.filter((key) => {
    const value = env[key];
    return typeof value === "string" && value.trim() !== "";
  });
}

let notedIgnoredProxyPoolEnv = false;

/**
 * One-time notice so a copied goproxy `.env` never looks honoured. Returns the
 * ignored keys (also used by tests); never throws and never reads the values.
 */
export function noteDirectEgressOnly(
  env: Record<string, string | undefined> = process.env
): string[] {
  const keys = ignoredProxyPoolEnvKeys(env);
  if (keys.length > 0 && !notedIgnoredProxyPoolEnv) {
    notedIgnoredProxyPoolEnv = true;
    console.info(
      `[relay-retry] egress=direct: ignoring ${keys.join(", ")} (free channel never rotates egress IPs)`
    );
  }
  return keys;
}

/** Test hook for the once-only direct-egress notice. */
export function resetDirectEgressNoticeForTest(): void {
  notedIgnoredProxyPoolEnv = false;
}

export function isFreeChannelGroup(group?: ChannelGroupConfig, provider?: ProviderConfig): boolean {
  if (!group) return false;
  return (
    isOpenCodeGroup(group) ||
    isFreebuffGroup(group, provider) ||
    group.authType === "none" ||
    group.id === "opencode-free" ||
    group.id === "opencode" ||
    group.id === "cline-free" ||
    group.id === "kilocode" ||
    group.id === "d2api" ||
    Boolean(group.baseUrl && (
      group.baseUrl.includes("opencode.ai") ||
      group.baseUrl.includes("kilo.ai") ||
      group.baseUrl.includes("cline.bot") ||
      group.baseUrl.includes("freebuff")
    ))
  );
}

/** d2api free group is served by the embedded duck2api TS app, not HTTP. */
export function isEmbeddedD2ApiGroup(group?: ChannelGroupConfig | null): boolean {
  return group?.id === "d2api";
}

/**
 * opencode-local is served by the in-process OpenCode runtime (direct
 * `opencode serve` turn, same path as workbench `cliBackend=opencode`
 * turns), not by HTTP-forwarding to a pseudo baseUrl. The group's
 * `http://127.0.0.1:4096` baseUrl is only a placeholder — forwarding
 * OpenAI-protocol traffic there 401s (serve password + wrong protocol),
 * and Zen free tier must originate from the official client anyway
 * (blocked for external proxies since 2026-09-09).
 */
export function isEmbeddedOpencodeLocalGroup(provider?: ProviderConfig | null): boolean {
  return provider?.id === "opencode-local";
}

export interface EmbeddedOpencodePromptInput {
  model: string;
  prompt: string;
  signal?: AbortSignal | null;
  /** Called live per assistant delta; absent for buffered (non-stream) calls. */
  onDelta?: (delta: string) => void;
  /** Declared client function names the turn may request (transcript only). */
  toolNames?: string[];
}

export interface EmbeddedOpencodeTurnResult {
  text: string;
  toolCall?: { id: string; name: string; arguments: string };
}

export type EmbeddedOpencodeRunner = (
  input: EmbeddedOpencodePromptInput,
) => Promise<EmbeddedOpencodeTurnResult>;

/**
 * Parse a model-emitted JSON tool call back into a structured call. Pure.
 * The local turn cannot execute foreign functions, so when the prompt
 * carries client tool declarations the model is instructed to reply with
 * ONLY `{"name": "...", "arguments": {...}}`; this recovers that reply
 * into a real `tool_calls` entry for the CLIENT to execute locally
 * (in the user's own working directory). Strict whole-response match only:
 * mixed prose + JSON stays plain text (null), otherwise normal answers
 * containing a JSON example would be swallowed and rendered as blank.
 */
export function extractJsonToolCall(text: string, toolNames: string[]): EmbeddedOpencodeTurnResult["toolCall"] | null {
  if (!Array.isArray(toolNames) || toolNames.length === 0) return null;
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const candidates: string[] = [];
  const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) {
    candidates.push(String(fence[1] ?? "").trim());
  } else {
    // Strict whole-response match only: the model is instructed to reply
    // with ONLY the JSON tool call when it wants a tool. Scanning prose
    // for embedded {...} spans caused normal answers containing a JSON
    // example to be swallowed (text wiped to "" + tool_calls), which
    // renders as "answer disappeared after completion".
    candidates.push(raw);
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name || !toolNames.includes(name)) continue;
    let args = "{}";
    const rawArgs = record.arguments ?? record.args ?? record.parameters;
    if (typeof rawArgs === "string") {
      try {
        JSON.parse(rawArgs);
        args = rawArgs;
      } catch {
        continue;
      }
    } else if (rawArgs && typeof rawArgs === "object") {
      try {
        args = JSON.stringify(rawArgs);
      } catch {
        continue;
      }
    } else if (rawArgs !== undefined) {
      continue;
    }
    return { id: `call_${randomUUID().replaceAll("-", "").slice(0, 24)}`, name, arguments: args };
  }
  return null;
}

let embeddedOpencodeRunner: EmbeddedOpencodeRunner | null = null;

/**
 * Wired once by the server entrypoint (it owns the OpencodeBridge).
 * The gateway stays bridge-agnostic; without a runner, opencode-local
 * gateway calls fail closed with 502 instead of 401ing against 4096.
 */
export function setEmbeddedOpencodeRunner(runner: EmbeddedOpencodeRunner | null): void {
  embeddedOpencodeRunner = runner;
}

/**
 * Classify a local-turn failure for the wire: Zen throttling surfaces as
 * 429 so clients back off properly instead of reading every failure as a
 * generic 502 (their retry loops treat the two very differently).
 */
export function embeddedOpencodeErrorStatus(message: string): number {
  const text = String(message ?? "").toLowerCase();
  if (/\b429\b|rate[\s_-]*limit|too many requests|quota|insufficient_quota|throttl/.test(text)) return 429;
  return 502;
}

/** Run one prompt through the injected in-process OpenCode runtime. */
async function runEmbeddedOpencodeLocalResult(
  request: CanonicalRequest,
  signal: AbortSignal,
): Promise<CanonicalResult> {
  if (!embeddedOpencodeRunner) {
    throw new Error("opencode-local bridge is not configured on this server");
  }
  const toolNames = (request.tools ?? []).map((tool) => tool.responseName || tool.name).filter(Boolean);
  const out = await embeddedOpencodeRunner({
    model: request.model,
    prompt: canonicalToPlainPrompt(request),
    signal,
    toolNames,
  });
  const text = String(out?.text ?? "");
  const direct = out?.toolCall && toolNames.includes(out.toolCall.name) ? out.toolCall : null;
  const call = direct ?? extractJsonToolCall(text, toolNames);
  return {
    model: request.model,
    text: call ? "" : text,
    toolCalls: call ? [{ id: call.id, name: call.name, arguments: call.arguments }] : [],
    usage: { inputTokens: 0, outputTokens: 0 },
    finishReason: call ? "tool_calls" : "stop",
  };
}

/**
 * Run one prompt through the injected runtime, forwarding assistant deltas
 * live. Returns the authoritative final text (runner result wins, streamed
 * accumulation is the fallback).
 */
async function runEmbeddedOpencodeLocalLive(
  request: CanonicalRequest,
  signal: AbortSignal,
  onDelta: (delta: string) => void,
): Promise<{ text: string; toolCall: EmbeddedOpencodeTurnResult["toolCall"] | null }> {
  if (!embeddedOpencodeRunner) {
    throw new Error("opencode-local bridge is not configured on this server");
  }
  const toolNames = (request.tools ?? []).map((tool) => tool.responseName || tool.name).filter(Boolean);
  let streamed = "";
  const out = await embeddedOpencodeRunner({
    model: request.model,
    prompt: canonicalToPlainPrompt(request),
    signal,
    toolNames,
    onDelta: (delta) => {
      if (!delta) return;
      streamed += delta;
      try { onDelta(delta); } catch { /* consumer-side, ignore */ }
    },
  });
  const text = String(out?.text ?? "") || streamed;
  const direct = out?.toolCall && toolNames.includes(out.toolCall.name) ? out.toolCall : null;
  const call = direct ?? extractJsonToolCall(text, toolNames);
  return { text: call ? "" : text, toolCall: call };
}

const EMBEDDED_OPENCODE_SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive",
  // Ask intermediate reverse proxies (tunnel ingress) not to buffer SSE;
  // without this some proxies hold all chunks until upstream closes,
  // which re-triggers client stall detectors on long turns.
  "x-accel-buffering": "no",
};

/** Live chat-chunk SSE: role frame first, content frames per delta, then stop. */
function streamEmbeddedOpencodeChatTurn(request: CanonicalRequest, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const id = `chatcmpl_${randomUUID().replaceAll("-", "")}`;
  const created = Math.floor(Date.now() / 1000);
  const base = { id, object: "chat.completion.chunk", created, model: request.model };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendChoice = (choice: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...base, choices: [choice] })}\n\n`));
        } catch { /* client gone */ }
      };
      sendChoice({ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null });
      void (async () => {
        let toolCall: EmbeddedOpencodeTurnResult["toolCall"] | null = null;
        try {
          const out = await runEmbeddedOpencodeLocalLive(request, signal, (delta) => {
            sendChoice({ index: 0, delta: { content: delta }, finish_reason: null });
          });
          toolCall = out.toolCall;
        } catch {
          // Mid-stream failure surfaces as a truncated stop; the client
          // already holds whatever deltas arrived.
        }
        if (toolCall) {
          sendChoice({
            index: 0,
            delta: { tool_calls: [{ index: 0, id: toolCall.id, type: "function", function: { name: toolCall.name, arguments: toolCall.arguments } }] },
            finish_reason: null,
          });
          sendChoice({ index: 0, delta: {}, finish_reason: "tool_calls" });
        } else {
          sendChoice({ index: 0, delta: {}, finish_reason: "stop" });
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...base, choices: [] })}\n\n`));
        } catch { /* ignore */ }
        try {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch { /* ignore */ }
        try { controller.close(); } catch { /* ignore */ }
      })();
    },
  });
  return new Response(body, { status: 200, headers: EMBEDDED_OPENCODE_SSE_HEADERS });
}

/** Live Responses SSE, mirroring responsesEventStream framing. */
function streamEmbeddedOpencodeResponsesTurn(request: CanonicalRequest, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const id = `resp_${randomUUID().replaceAll("-", "")}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const itemId = `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  let seq = 0;
  const skeleton = { id, object: "response", created_at: createdAt, model: request.model };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (type: string, rest: Record<string, unknown>): void => {
        try {
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...rest })}\n\n`));
        } catch { /* client gone */ }
      };
      const pending = { ...skeleton, status: "in_progress", output: [] as JsonValue[] };
      send("response.created", { response: pending });
      send("response.in_progress", { response: pending });
      send("response.output_item.added", {
        output_index: 0,
        item: { id: itemId, type: "message", status: "in_progress", role: "assistant", content: [] },
      });
      send("response.content_part.added", {
        item_id: itemId, output_index: 0, content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      });
      void (async () => {
        let full = "";
        let toolCall: EmbeddedOpencodeTurnResult["toolCall"] | null = null;
        try {
          const out = await runEmbeddedOpencodeLocalLive(request, signal, (delta) => {
            send("response.output_text.delta", {
              item_id: itemId, output_index: 0, content_index: 0, delta, logprobs: [],
            });
          });
          full = out.text;
          toolCall = out.toolCall;
        } catch {
          // Truncated stop below; deltas already flushed.
        }
        const output: JsonValue[] = [];
        if (full || !toolCall) {
          const donePart = { type: "output_text", text: full, annotations: [] };
          const doneItem = { id: itemId, type: "message", status: "completed", role: "assistant", content: [{ ...donePart }] };
          send("response.output_text.done", {
            item_id: itemId, output_index: 0, content_index: 0, text: full, logprobs: [],
          });
          send("response.content_part.done", {
            item_id: itemId, output_index: 0, content_index: 0, part: donePart,
          });
          send("response.output_item.done", { output_index: 0, item: doneItem });
          output.push(doneItem as unknown as JsonValue);
        }
        if (toolCall) {
          const fcItem = {
            id: `fc_${randomUUID().replaceAll("-", "")}`,
            type: "function_call",
            status: "completed",
            call_id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          };
          send("response.output_item.added", { output_index: output.length, item: { ...fcItem, status: "in_progress" } });
          send("response.output_item.done", { output_index: output.length, item: fcItem });
          output.push(fcItem as unknown as JsonValue);
        }
        send("response.completed", {
          response: {
            ...skeleton, status: "completed", output,
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          },
        });
        try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* ignore */ }
        try { controller.close(); } catch { /* ignore */ }
      })();
    },
  });
  return new Response(body, { status: 200, headers: EMBEDDED_OPENCODE_SSE_HEADERS });
}

/**
 * Flatten a canonical request to the plain-text prompt a local turn needs. Pure.
 *
 * mini-opencodex policy: full retention — nothing from the client is
 * stripped. Instructions, system prompts, tool declarations, assistant
 * tool_calls and tool results are all rendered as labeled text so the
 * local turn sees the complete conversation. (The local runtime cannot
 * execute foreign tools; they arrive as transcript, not as capabilities.)
 * Each gateway call starts a fresh local thread, so this prompt is its
 * only context — order is preserved as received.
 */
export function canonicalToPlainPrompt(request: CanonicalRequest): string {
  const blocks: string[] = [];
  if (request.instructions) blocks.push(`[Instructions]\n${String(request.instructions).trim()}`);
  for (const tool of request.tools ?? []) {
    const schema = JSON.stringify(tool.inputSchema ?? {});
    const desc = String(tool.description ?? "").trim();
    blocks.push(`[Function ${tool.responseName || tool.name}]${desc ? `\n${desc}` : ""}\nArguments schema: ${schema}`);
  }
  for (const message of request.messages ?? []) {
    const texts: string[] = [];
    for (const part of message.content ?? []) {
      if (part.type === "text") {
        const clean = String(part.text ?? "").trim();
        if (clean) texts.push(clean);
      } else if (part.type === "image") {
        texts.push("[image omitted: relay gateway image input is not forwarded to the local turn]");
      }
    }
    const calls = (message.toolCalls ?? [])
      .map((call) => `[Tool call id=${call.id} name=${call.name}]\n${String(call.arguments ?? "").trim()}`)
      .filter(Boolean);
    if (message.role === "system") {
      if (texts.length > 0) blocks.push(`[System]\n${texts.join("\n")}`);
      blocks.push(...calls);
      continue;
    }
    if (message.role === "tool") {
      const tag = message.toolCallId ? ` (for ${message.toolCallId})` : "";
      if (texts.length > 0) blocks.push(`[Tool result${tag}]\n${texts.join("\n")}`);
      blocks.push(...calls);
      continue;
    }
    if (texts.length === 0 && calls.length === 0) continue;
    const label = message.role === "user" ? "User" : "Assistant";
    blocks.push(`${label}: ${[...texts, ...calls].join("\n")}`);
  }
  return blocks.join("\n\n").trim();
}

type Duck2ApiApp = ReturnType<PluginHostServices["relay"]["createDuck2ApiApp"]>;

let duck2apiApp: Duck2ApiApp | null = null;

function getDuck2ApiApp(): Duck2ApiApp {
  if (!duck2apiApp) duck2apiApp = pluginHostServices().relay.createDuck2ApiApp();
  return duck2apiApp;
}

/** Mirror duck2api PREFIX routing so in-process dispatch hits the same route. */
function duck2apiCompletionsPath(): string {
  const prefix = (process.env.PREFIX ?? "").trim();
  if (!prefix) return "/v1/chat/completions";
  const clean = (prefix.startsWith("/") ? prefix : `/${prefix}`).replace(/\/+$/, "");
  return `${clean}/v1/chat/completions`;
}

/**
 * In-process dispatch to the embedded duck2api app (same OpenAI wire shape
 * as the standalone service). The group key rides as Bearer so per-group
 * keys keep working; without a key the app stays open-access.
 * NOTE: client abort signals are not forwarded into the embedded DuckDuckGo
 * fetch — an aborted turn may still finish upstream-side.
 */
async function requestEmbeddedD2ApiCompletions(
  payload: Record<string, JsonValue>,
  apiKey: string
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };
  const key = apiKey.trim();
  if (key) headers.authorization = `Bearer ${key}`;
  try {
    return await getDuck2ApiApp().request(duck2apiCompletionsPath(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error(`Embedded duck2api request failed: ${errorMessage(error)}`);
  }
}

async function fetchEmbeddedD2ApiCompletions(
  request: CanonicalRequest,
  apiKey: string,
  stream: boolean
): Promise<Response> {
  const payload = canonicalToChat(request, {});
  if (stream) {
    payload.stream = true;
    payload.stream_options = {
      ...asRecord(payload.stream_options),
      include_usage: true
    };
  }
  return requestEmbeddedD2ApiCompletions(payload, apiKey);
}

export function resolveFreeRetryDelayMs(headers: Headers, retryIndex: number): number {
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(FREE_CHANNEL_MAX_DELAY_MS, Math.round(seconds * 1000));
    }
  }
  const retryAfterMs = headers.get("retry-after-ms")?.trim();
  if (retryAfterMs) {
    const ms = Number(retryAfterMs);
    if (Number.isFinite(ms) && ms > 0) {
      return Math.min(FREE_CHANNEL_MAX_DELAY_MS, Math.round(ms));
    }
  }
  const fallback = FREE_CHANNEL_RETRY_DELAYS_MS[retryIndex] ?? FREE_CHANNEL_MAX_DELAY_MS;
  return Math.min(FREE_CHANNEL_MAX_DELAY_MS, fallback);
}

export function isRetryableFreeStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export async function sleepWithSignal(ms: number, signal?: AbortSignal | null): Promise<boolean> {
  if (signal?.aborted) return false;
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      resolve(false);
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
  });
}

/**
 * Go parity (internal/duckgo/request.go: POSTconversation/postConversationOnce):
 * Go marshals the request struct to bytes once (`json.Marshal`) and reuses the
 * bytes for every retry. The TS relay path previously passed
 * `input.request.clone()` into every retry attempt. Bun/undici server inbound
 * Requests ride on a single-use stream: after the first clone is consumed via
 * `.json()`, a second `.clone()` on the same original throws
 * `TypeError: Body object should not be disturbed or locked`, which bubbled to
 * the top-level "Request failed" handler. Buffer once via clone-then-text and
 * rebuild a fresh Request per attempt instead.
 */
async function bufferRelayRequestForRetry(request: Request): Promise<{ url: string; method: string; headers: Headers; bodyText: string } | null> {
  try {
    const bodyText = await request.clone().text();
    return { url: request.url, method: request.method, headers: new Headers(request.headers), bodyText };
  } catch {
    return null;
  }
}

function rebuildRelayRequest(buffered: { url: string; method: string; headers: Headers; bodyText: string }, signal?: AbortSignal | null): Request {
  const headers = new Headers(buffered.headers);
  const init: RequestInit = { method: buffered.method, headers };
  if (buffered.method !== "GET" && buffered.method !== "HEAD" && buffered.bodyText) {
    init.body = buffered.bodyText;
  }
  if (signal) init.signal = signal;
  return new Request(buffered.url, init);
}

async function executeWithFreeChannelRetry(
  execute: () => Promise<Response>,
  group: ChannelGroupConfig,
  provider: ProviderConfig | undefined,
  signal?: AbortSignal | null
): Promise<Response> {
  const isFree = isFreeChannelGroup(group, provider);
  // Embedded opencode-local turns run a full local agent turn (up to the
  // runner timeout). Retrying a failed/timed-out local turn just re-runs
  // the same minutes-long stall, so local turns never retry here: fail
  // fast and let the client decide.
  const maxRetries = isFree && !isEmbeddedOpencodeLocalGroup(provider)
    ? FREE_CHANNEL_RETRY_DELAYS_MS.length
    : 0;
  // Direct local egress only: a free-channel retry re-dials from this host's
  // own IP. goproxy's WEBSHARE pool keys are never read (see
  // FREE_CHANNEL_EGRESS_MODE); the notice fires once so a copied `.env` cannot
  // be mistaken for an active IP rotation.
  if (isFree) noteDirectEgressOnly();

  for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
    const response = await execute();
    const upstreamStatus = Number(response.headers.get(RELAY_UPSTREAM_STATUS_HEADER) ?? response.status);
    const isRetryable = isFree && isRetryableFreeStatus(upstreamStatus);

    if (!isRetryable || retryCount === maxRetries) {
      return response;
    }

    const delayMs = resolveFreeRetryDelayMs(response.headers, retryCount);
    console.info(`[relay-retry] free channel upstream ${upstreamStatus}, retrying in ${delayMs}ms (${retryCount + 1}/${maxRetries})...`);
    await response.body?.cancel().catch(() => undefined);
    const ok = await sleepWithSignal(delayMs, signal);
    if (!ok) {
      // The wait was aborted (client gone). The response body above is
      // already cancelled, so it must NOT be returned: downstream
      // finalizeRelayResponse would re-wrap the dead body and throw
      // "Body object should not be disturbed or locked" (500).
      return markUpstreamFailure(errorResponse(502, "Relay upstream retry aborted"), 502);
    }
  }
  return execute();
}

export async function runRelayProtocolRequestWithKeyFailover(input: {
  request: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKeys: string[];
  failoverBudgetMs?: number;
}): Promise<Response> {
  const keys = orderedRelayKeys(input.provider.id, input.group, input.apiKeys);
  const isFree = isFreeChannelGroup(input.group, input.provider);
  const effectiveKeys = keys.length === 0 && (input.group.authType === "none" || isFreebuffGroup(input.group, input.provider) || isFree)
    ? [""]
    : keys;
  if (effectiveKeys.length === 0) return errorResponse(400, "Relay provider and group have no upstream credential");

  // Buffer once (Go: json.Marshal once, reuse bytes). Rebuilding per attempt
  // avoids clone-after-disturbed on Bun inbound streams during free retries.
  const buffered = await bufferRelayRequestForRetry(input.request);
  if (!buffered) return errorResponse(400, "Relay gateway request body is already consumed");

  let lastResponse: Response | undefined;
  const failoverStartedAt = Date.now();
  const failoverBudgetMs = typeof input.failoverBudgetMs === "number" && input.failoverBudgetMs > 0 ? input.failoverBudgetMs : RELAY_FAILOVER_BUDGET_MS;

  for (const [index, apiKey] of effectiveKeys.entries()) {
    if (index > 0 && Date.now() - failoverStartedAt >= failoverBudgetMs) {
      return finalizeRelayResponse(errorResponse(502, "Relay key failover budget exhausted"), input.group);
    }
    const response = await executeWithFreeChannelRetry(
      () => runRelayProtocolRequest({
        request: rebuildRelayRequest(buffered, input.request.signal),
        provider: input.provider,
        group: input.group,
        apiKey
      }),
      input.group,
      input.provider,
      input.request.signal
    );
    const upstreamStatus = Number(response.headers.get(RELAY_UPSTREAM_STATUS_HEADER) ?? response.status);
    const shouldFailOver =
      response.headers.get(RELAY_FAILOVER_CANDIDATE_HEADER) === "1"
      && shouldFailOverRelayKey(upstreamStatus)
      && index < effectiveKeys.length - 1;
    if (!shouldFailOver) {
      if (isOpenCodeGroup(input.group) && (upstreamStatus === 429 || upstreamStatus === 400)) {
        rotateOpenCodeSession();
      }
      return finalizeRelayResponse(response, input.group);
    }
    await response.body?.cancel().catch(() => undefined);
    lastResponse = response;
  }
  if (isOpenCodeGroup(input.group)) {
    rotateOpenCodeSession();
  }
  return finalizeRelayResponse(lastResponse ?? errorResponse(502, "Relay key failover exhausted"), input.group);
}

export async function runRelayChatRequest(input: {
  request: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKey: string;
}): Promise<Response> {
  const rawBody = await input.request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return errorResponse(400, "Relay gateway requires a JSON Chat Completions request");
  }
  const requestRecord = rawBody as Record<string, unknown>;
  const selectedModel = resolveMappedModel(input.group, stringValue(requestRecord.model) ?? input.group.models?.[0] ?? input.provider.defaultModel ?? "");
  if (!selectedModel) return errorResponse(400, "Relay gateway request has no model");
  if (input.group.status === "disabled") return errorResponse(409, `Relay group ${input.group.name} is disabled`);

  const baseSelectedModel = stripModelContextVariant(selectedModel).baseModel;
  const catalogModel = input.provider.capabilityCatalog?.data.find((model) => model.model_name === selectedModel || model.model_name === baseSelectedModel);
  const protocol = resolveModelProtocol(input.group, catalogModel);
  // Chat inbound is already /v1/chat/completions; an "openai-response" group would
  // force a chat->responses conversion, which we deliberately avoid. Keep the chat
  // protocol and route to a chat upstream instead.
  const effectiveProtocol = protocol === "openai-response" ? "openai" : protocol;
  if (!modelSupportsProtocol(catalogModel, effectiveProtocol)) {
    return errorResponse(400, `Model ${selectedModel} does not support group protocol ${effectiveProtocol}`);
  }
  if (!input.group.baseUrl && !input.provider.baseUrl) {
    return errorResponse(400, `Relay group ${input.group.name} is missing baseUrl`);
  }

  const canonical = chatRequestToCanonical(requestRecord, selectedModel);
  const selectedCapability = input.group.modelCapabilities?.[selectedModel]
    ?? input.group.modelCapabilities?.[baseSelectedModel];
  canonical.maxOutputTokens ??= resolveModelMaxOutputTokens(selectedModel, selectedCapability);
  const resolvedChatCacheKey = resolveCanonicalPromptCacheKey(
    input.request,
    requestRecord,
    conversationPromptCacheAnchor(canonical)
  );
  if (resolvedChatCacheKey) canonical.promptCacheKey = resolvedChatCacheKey;
  const wantsStream = requestRecord.stream === true;

  if (wantsStream) {
    return runCanonicalUpstreamChatStream({
      provider: input.provider,
      group: input.group,
      apiKey: input.apiKey,
      protocol: effectiveProtocol,
      request: canonical,
      signal: input.request.signal,
      userAgent: input.request.headers.get("user-agent"),
      sourceHeaders: input.request.headers
    });
  }

  const upstream = await runCanonicalUpstream({
    provider: input.provider,
    group: input.group,
    apiKey: input.apiKey,
    protocol: effectiveProtocol,
    request: canonical,
    signal: input.request.signal,
    userAgent: input.request.headers.get("user-agent"),
    sourceHeaders: input.request.headers
  });
  if (!upstream.ok) return upstream.response;
  return jsonResponse(canonicalResultToChat(upstream.result), 200);
}

export async function runRelayChatRequestWithKeyFailover(input: {
  request: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKeys: string[];
  failoverBudgetMs?: number;
}): Promise<Response> {
  const keys = orderedRelayKeys(input.provider.id, input.group, input.apiKeys);
  const isFree = isFreeChannelGroup(input.group, input.provider);
  const effectiveKeys = keys.length === 0 && (input.group.authType === "none" || isFreebuffGroup(input.group, input.provider) || isFree)
    ? [""]
    : keys;
  if (effectiveKeys.length === 0) return errorResponse(400, "Relay provider and group have no upstream credential");

  // Same Go-parity buffering as the Responses failover path above.
  const buffered = await bufferRelayRequestForRetry(input.request);
  if (!buffered) return errorResponse(400, "Relay gateway request body is already consumed");

  let lastResponse: Response | undefined;
  const failoverStartedAt = Date.now();
  const failoverBudgetMs = typeof input.failoverBudgetMs === "number" && input.failoverBudgetMs > 0 ? input.failoverBudgetMs : RELAY_FAILOVER_BUDGET_MS;

  for (const [index, apiKey] of effectiveKeys.entries()) {
    if (index > 0 && Date.now() - failoverStartedAt >= failoverBudgetMs) {
      return finalizeRelayResponse(errorResponse(502, "Relay key failover budget exhausted"), input.group);
    }
    const response = await executeWithFreeChannelRetry(
      () => runRelayChatRequest({
        request: rebuildRelayRequest(buffered, input.request.signal),
        provider: input.provider,
        group: input.group,
        apiKey
      }),
      input.group,
      input.provider,
      input.request.signal
    );
    const upstreamStatus = Number(response.headers.get(RELAY_UPSTREAM_STATUS_HEADER) ?? response.status);
    const shouldFailOver =
      response.headers.get(RELAY_FAILOVER_CANDIDATE_HEADER) === "1"
      && shouldFailOverRelayKey(upstreamStatus)
      && index < effectiveKeys.length - 1;
    if (!shouldFailOver) {
      if (isOpenCodeGroup(input.group) && (upstreamStatus === 429 || upstreamStatus === 400)) {
        rotateOpenCodeSession();
      }
      return finalizeRelayResponse(response, input.group);
    }
    await response.body?.cancel().catch(() => undefined);
    lastResponse = response;
  }
  if (isOpenCodeGroup(input.group)) {
    rotateOpenCodeSession();
  }
  return finalizeRelayResponse(lastResponse ?? errorResponse(502, "Relay key failover exhausted"), input.group);
}

const RELAY_JEV_UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Route a JEV (TypeSafe SystemOne) evaluate request to the relay group's
 * upstream. Unlike chat/messages, JEV is native passthrough: the group (or
 * provider) baseUrl already contains the full upstream path
 * (e.g. https://api.typesafe.ai/v1/systemone) and the body is forwarded
 * as {state, model, questions} with a Bearer key. Non-OK upstreams are
 * marked as failover candidates so the key-rotation wrapper can try the
 * next credential; local validation errors never rotate keys.
 */
export async function runRelayJevRequest(input: {
  request: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKey: string;
}): Promise<Response> {
  const rawBody = await input.request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return errorResponse(400, "Relay gateway requires a JSON JEV request");
  }
  const requestRecord = rawBody as Record<string, unknown>;
  const state = stringValue(requestRecord.state) ?? "";
  const questions = requestRecord.questions;
  if (!state) return errorResponse(400, "JEV request requires a non-empty 'state'");
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) {
    return errorResponse(400, "JEV request requires a 'questions' object");
  }
  const selectedModel = resolveMappedModel(input.group, stringValue(requestRecord.model) ?? input.group.models?.[0] ?? input.provider.defaultModel ?? "");
  if (!selectedModel) return errorResponse(400, "Relay gateway request has no model");
  if (input.group.status === "disabled") return errorResponse(409, `Relay group ${input.group.name} is disabled`);
  const upstreamUrl = (input.group.baseUrl || input.provider.baseUrl || "").trim();
  if (!upstreamUrl) return errorResponse(400, `Relay group ${input.group.name} is missing baseUrl`);
  let parsed: URL;
  try {
    parsed = new URL(upstreamUrl);
  } catch {
    return errorResponse(400, `Relay group ${input.group.name} has an invalid baseUrl`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return errorResponse(400, `Relay group ${input.group.name} has an invalid baseUrl`);
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELAY_JEV_UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ state, model: selectedModel, questions }),
      signal: controller.signal
    });
    const text = await upstream.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 4000) };
    }
    const latencyMs = Date.now() - startedAt;
    if (!upstream.ok) {
      return markUpstreamFailure(jsonResponse({ error: `Upstream ${upstream.status}`, status: upstream.status, data: payload as JsonValue, latencyMs } as Record<string, JsonValue>, upstream.status));
    }
    return jsonResponse({ data: payload as JsonValue, latencyMs } as Record<string, JsonValue>, 200);
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error && error.name === "AbortError" ? "Upstream timeout (30s)" : errorMessage(error);
    return markUpstreamFailure(jsonResponse({ error: message || "JEV proxy failed", latencyMs } as Record<string, JsonValue>, 502));
  } finally {
    clearTimeout(timeout);
  }
}

export async function runRelayJevRequestWithKeyFailover(input: {
  request: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKeys: string[];
  failoverBudgetMs?: number;
}): Promise<Response> {
  const keys = orderedRelayKeys(input.provider.id, input.group, input.apiKeys);
  const effectiveKeys = keys.length === 0 && input.group.authType === "none" ? [""] : keys;
  if (effectiveKeys.length === 0) return errorResponse(400, "Relay provider and group have no upstream credential");

  const buffered = await bufferRelayRequestForRetry(input.request);
  if (!buffered) return errorResponse(400, "Relay gateway request body is already consumed");

  let lastResponse: Response | undefined;
  const failoverStartedAt = Date.now();
  const failoverBudgetMs = typeof input.failoverBudgetMs === "number" && input.failoverBudgetMs > 0 ? input.failoverBudgetMs : RELAY_FAILOVER_BUDGET_MS;

  for (const [index, apiKey] of effectiveKeys.entries()) {
    if (index > 0 && Date.now() - failoverStartedAt >= failoverBudgetMs) {
      return finalizeRelayResponse(errorResponse(502, "Relay key failover budget exhausted"), input.group);
    }
    const response = await runRelayJevRequest({
      request: rebuildRelayRequest(buffered, input.request.signal),
      provider: input.provider,
      group: input.group,
      apiKey
    });
    const upstreamStatus = Number(response.headers.get(RELAY_UPSTREAM_STATUS_HEADER) ?? response.status);
    const shouldFailOver =
      response.headers.get(RELAY_FAILOVER_CANDIDATE_HEADER) === "1"
      && shouldFailOverRelayKey(upstreamStatus)
      && index < effectiveKeys.length - 1;
    if (!shouldFailOver) {
      return finalizeRelayResponse(response, input.group);
    }
    await response.body?.cancel().catch(() => undefined);
    lastResponse = response;
  }
  return finalizeRelayResponse(lastResponse ?? errorResponse(502, "Relay key failover exhausted"), input.group);
}

export async function runNativeAnthropicRequest(input: {
  request: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKey: string;
}): Promise<Response> {
  const body = await input.request.arrayBuffer();
  const raw = new Uint8Array(body);
  let parsed: Record<string, unknown> = {};
  try { parsed = asRecord(JSON.parse(new TextDecoder().decode(raw))); } catch { return errorResponse(400, "Anthropic gateway requires a JSON request"); }
  const model = stringValue(parsed.model) ?? input.group.models?.[0] ?? input.provider.defaultModel ?? "";
  if (!model) return errorResponse(400, "Anthropic request has no model");
  const endpoint = resolveProtocolEndpoint(input.provider, input.group, "anthropic", model);
  try {
    const response = await fetchUpstreamWithHeadersTimeout(endpoint, {
      method: "POST",
      headers: upstreamHeaders(
        "anthropic",
        input.group,
        input.apiKey,
        parsed.stream === true,
        input.request.headers.get("user-agent"),
        input.request.headers.get("anthropic-beta"),
        null,
        input.request.headers,
        model,
        parsed,
      ),
      body: raw,
      signal: input.request.signal
    });
    const headers = relayResponseHeaders(response.headers);
    return response.ok ? new Response(response.body, { status: response.status, headers }) : markUpstreamFailure(new Response(response.body, { status: response.status, headers }), response.status);
  } catch (error) {
    return markUpstreamFailure(errorResponse(502, `Upstream anthropic request failed: ${errorMessage(error)}`), 502);
  }
}

/** Keep Claude models on native Messages; translate other models to the relay group's protocol. */
export async function runRelayAnthropicRequest(input: {
  request: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKey: string;
}): Promise<Response> {
  const raw = await input.request.clone().json().catch(() => null);
  const record = asRecord(raw);
  const requestedModel = stringValue(record.model) ?? input.group.models?.[0] ?? input.provider.defaultModel ?? "";
  if (!requestedModel) return errorResponse(400, "Anthropic request has no model");
  const selectedModel = resolveMappedModel(input.group, requestedModel);
  const baseModel = stripModelContextVariant(selectedModel).baseModel;
  const catalogModel = input.provider.capabilityCatalog?.data.find((entry) => entry.model_name === selectedModel || entry.model_name === baseModel);
  // Mini already sends Claude as Messages. Do not undo that decision here just
  // because a mixed-model group defaults to Chat/Responses: translating would
  // discard native thinking budgets, signatures and other Messages fields.
  const isClaude = /(?:^|\/)claude/i.test(requestedModel) || /(?:^|\/)claude/i.test(selectedModel);
  const protocol = isClaude ? "anthropic" : resolveModelProtocol(input.group, catalogModel);
  if (!modelSupportsProtocol(catalogModel, protocol)) return errorResponse(400, `Model ${selectedModel} does not support group protocol ${protocol}`);
  if (protocol === "anthropic") {
    const nativeRequest = new Request(input.request.url, {
      method: input.request.method,
      headers: input.request.headers,
      body: JSON.stringify({ ...record, model: selectedModel }),
      signal: input.request.signal
    });
    return runNativeAnthropicRequest({ ...input, request: nativeRequest });
  }
  if (!input.group.baseUrl && !input.provider.baseUrl) return errorResponse(400, `Relay group ${input.group.name} is missing baseUrl`);

  const canonical = anthropicRequestToCanonical(record, selectedModel);
  const resolvedCacheKey = resolveCanonicalPromptCacheKey(
    input.request,
    record,
    conversationPromptCacheAnchor(canonical)
  );
  if (resolvedCacheKey) canonical.promptCacheKey = resolvedCacheKey;
  if (record.stream === true) {
    return runAnthropicCanonicalStream({ originalRequest: input.request, provider: input.provider, group: input.group, apiKey: input.apiKey, protocol, request: canonical });
  }
  if (protocol === "openai-response") {
    const responsePayload = canonicalToResponsesRequest(canonical, { allowPromptCacheKey: responsesPromptCacheAllowed(input.group), assistantTextType: isOpenCodeGroup(input.group) ? "output_text" : "input_text" });
    if (isOpenCodeGroup(input.group)) {
      sanitizeOpenCodePayload(responsePayload as Record<string, unknown>, selectedModel, false, { group: input.group, apiKey: input.apiKey, sourceHeaders: input.request.headers, protocol });
    }
    const endpoint = resolveProtocolEndpoint(input.provider, input.group, protocol, selectedModel);
    const responseBody = await fetchUpstreamWithHeadersTimeout(endpoint, {
      method: "POST",
      headers: upstreamHeaders(protocol, input.group, input.apiKey, false, input.request.headers.get("user-agent"), undefined, undefined, input.request.headers, selectedModel, responsePayload),
      body: JSON.stringify(responsePayload),
      signal: input.request.signal
    }).catch(() => null);
    if (!responseBody) return markUpstreamFailure(errorResponse(502, "Upstream openai-response request failed"), 502);
    const bodyText = await responseBody.text().catch(() => "");
    if (!responseBody.ok) return markUpstreamFailure(errorResponse(responseBody.status, upstreamErrorMessage(bodyText, protocol), relayResponseHeaders(responseBody.headers)), responseBody.status);
    try {
      return new Response(JSON.stringify(canonicalResultToAnthropic(responsesResponseToCanonical(JSON.parse(bodyText), selectedModel, canonical.tools))), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
    } catch (error) {
      return markUpstreamFailure(errorResponse(502, `Upstream ${protocol} returned invalid JSON: ${errorMessage(error)}`), 502);
    }
  }
  const upstream = await runCanonicalUpstream({
    provider: input.provider,
    group: input.group,
    apiKey: input.apiKey,
    protocol,
    request: canonical,
    signal: input.request.signal,
    userAgent: input.request.headers.get("user-agent"),
    sourceHeaders: input.request.headers
  });
  if (!upstream.ok) return upstream.response;
  return jsonResponse(canonicalResultToAnthropic(upstream.result), 200);
}

export async function runRelayAnthropicWithKeyFailover(input: {
  request: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKeys: string[];
  failoverBudgetMs?: number;
}): Promise<Response> {
  const keys = orderedRelayKeys(input.provider.id, input.group, input.apiKeys);
  const isFree = isFreeChannelGroup(input.group, input.provider);
  const effectiveKeys = keys.length === 0 && (input.group.authType === "none" || isFreebuffGroup(input.group, input.provider) || isFree)
    ? [""]
    : keys;
  if (effectiveKeys.length === 0) return errorResponse(400, "Relay provider and group have no upstream credential");

  // Same Go-parity buffering as the Responses/Chat/JEV failover paths above:
  // never clone the same inbound stream twice across key failover + free retry.
  const buffered = await bufferRelayRequestForRetry(input.request);
  if (!buffered) return errorResponse(400, "Relay gateway request body is already consumed");

  let last: Response | undefined;
  const failoverStartedAt = Date.now();
  const failoverBudgetMs = typeof input.failoverBudgetMs === "number" && input.failoverBudgetMs > 0 ? input.failoverBudgetMs : RELAY_FAILOVER_BUDGET_MS;

  for (const [index, apiKey] of effectiveKeys.entries()) {
    if (index > 0 && Date.now() - failoverStartedAt >= failoverBudgetMs) {
      return finalizeRelayResponse(errorResponse(502, "Relay key failover budget exhausted"), input.group);
    }
    const response = await executeWithFreeChannelRetry(
      () => runRelayAnthropicRequest({ ...input, request: rebuildRelayRequest(buffered, input.request.signal), apiKey }),
      input.group,
      input.provider,
      input.request.signal
    );
    const status = Number(response.headers.get(RELAY_UPSTREAM_STATUS_HEADER) ?? response.status);
    const retry = response.headers.get(RELAY_FAILOVER_CANDIDATE_HEADER) === "1" && shouldFailOverRelayKey(status) && index < effectiveKeys.length - 1;
    if (!retry) {
      if (isOpenCodeGroup(input.group) && (status === 429 || status === 400)) {
        rotateOpenCodeSession();
      }
      return finalizeRelayResponse(response, input.group);
    }
    await response.body?.cancel().catch(() => undefined);
    last = response;
  }
  if (isOpenCodeGroup(input.group)) {
    rotateOpenCodeSession();
  }
  return finalizeRelayResponse(last ?? errorResponse(502, "Relay key failover exhausted"), input.group);
}

export function orderedRelayKeys(providerId: string, group: ChannelGroupConfig, values: string[]): string[] {
  const keys = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (keys.length <= 1) return keys;
  const cursorKey = `${providerId}:${group.id}`;
  let start = 0;
  if (group.keyMode === "random") {
    start = Math.floor(Math.random() * keys.length);
  } else if ((group.keyMode ?? "polling") === "polling") {
    start = (relayKeyCursors.get(cursorKey) ?? 0) % keys.length;
    relayKeyCursors.set(cursorKey, (start + 1) % keys.length);
  }
  return [...keys.slice(start), ...keys.slice(0, start)];
}

function withoutInternalRelayHeaders(response: Response): Response {
  if (
    !response.headers.has(RELAY_UPSTREAM_STATUS_HEADER)
    && !response.headers.has(RELAY_FAILOVER_CANDIDATE_HEADER)
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete(RELAY_UPSTREAM_STATUS_HEADER);
  headers.delete(RELAY_FAILOVER_CANDIDATE_HEADER);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function finalizeRelayResponse(response: Response, group: ChannelGroupConfig): Response {
  const cleaned = withoutInternalRelayHeaders(response);
  const mappedStatus = group.statusCodeMapping?.find((entry) => entry.from === cleaned.status)?.to;
  if (!mappedStatus || mappedStatus === cleaned.status || mappedStatus < 200 || mappedStatus > 599) return cleaned;
  return new Response(cleaned.body, { status: mappedStatus, headers: cleaned.headers });
}

function markUpstreamFailure(response: Response, status = response.status): Response {
  const headers = new Headers(response.headers);
  headers.set(RELAY_UPSTREAM_STATUS_HEADER, String(status));
  headers.set(RELAY_FAILOVER_CANDIDATE_HEADER, "1");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function shouldFailOverRelayKey(status: number): boolean {
  // Only responses explicitly marked as upstream failures reach this check,
  // so rotating on all upstream 4xx statuses cannot turn local validation
  // errors into unnecessary key attempts. This matches the group contract:
  // a rejected key immediately yields to the next configured credential.
  return (status >= 400 && status < 500) || status >= 500;
}

async function proxyResponsesCompactRequest(input: {
  request: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKey: string;
  rawBody: Record<string, unknown>;
}): Promise<Response> {
  const configured = input.provider.capabilityCatalog?.supported_endpoint["openai-response-compact"]?.path;
  const endpoint = joinRelayEndpoint(input.group.baseUrl ?? input.provider.baseUrl ?? "", configured || "/v1/responses/compact");
  try {
    const response = await fetchUpstreamWithHeadersTimeout(endpoint, {
      method: "POST",
      headers: upstreamHeaders("openai-response", input.group, input.apiKey, false, input.request.headers.get("user-agent"), undefined, undefined, input.request.headers, undefined, input.rawBody),
      body: JSON.stringify(input.rawBody),
      signal: input.request.signal
    });
    const proxied = new Response(response.body, { status: response.status, headers: relayResponseHeaders(response.headers) });
    return response.ok ? proxied : markUpstreamFailure(proxied, response.status);
  } catch (error) {
    return markUpstreamFailure(errorResponse(502, `Upstream compact request failed: ${errorMessage(error)}`), 502);
  }
}

export function joinRelayEndpoint(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  let suffix = path.trim();
  if (/^https?:\/\//i.test(suffix)) return suffix;
  if (!suffix.startsWith("/")) suffix = `/${suffix}`;
  if (base.endsWith("/v1") && suffix.startsWith("/v1beta/")) {
    return `${base.slice(0, -3)}${suffix}`;
  }
  if (base.endsWith("/v1") && suffix.startsWith("/v1/")) {
    return `${base}${suffix.slice(3)}`;
  }
  if (base.endsWith("/v1beta") && suffix.startsWith("/v1beta/")) {
    return `${base}${suffix.slice(7)}`;
  }
  return `${base}${suffix}`;
}

/**
 * Whether a relayed request for this group must take the true-client kernel.
 *
 * "Keyless" is a property of the GROUP, not of the resolved credential: the
 * `omniroute-free` provider carries a machine-bound Codex Ultra license key
 * that is never an OpenCode credential, so the resolved `apiKey` is non-empty
 * even though the upstream is the free tier. The upstream answers 403
 * FreeTierError unless the request carries `Bearer public` plus the native
 * tool vocabulary, so the decision is driven by the group's own auth mode.
 *
 * A group that holds its own OpenCode key keeps the regular path.
 */
function shouldKernelSendFor(group: ChannelGroupConfig, model: string): boolean {
  if (!isOpenCodeGroup(group)) return false;
  if ((group.authType ?? "inherit") !== "none") return false;
  if ((group.keys ?? []).some((key) => key.trim())) return false;
  const rawId = (group.id || "").toLowerCase();
  const providerId = rawId === "opencode-free" ? "opencode" : rawId || "opencode";
  if (shouldUseKernelSend(providerId, model)) return true;
  // Fallback: opencode.ai-hosted groups without a kernel-known id still use the kernel.
  const base = (group.baseUrl ?? "").toLowerCase();
  if (base.includes("opencode.ai") && shouldUseKernelSend("opencode", model)) return true;
  return false;
}

function kernelSessionHintFromHeaders(sourceHeaders?: Headers | null): string | undefined {
  try {
    const hint = sourceHeaders?.get("x-opencode-session")?.trim()
      || sourceHeaders?.get("x-session-id")?.trim()
      || undefined;
    return hint && hint.length <= 256 ? hint : undefined;
  } catch {
    return undefined;
  }
}

export function resolveProtocolEndpoint(
  provider: ProviderConfig,
  group: ChannelGroupConfig,
  protocol: RelayResponseProtocol,
  model: string
): string {
  if ((protocol === "openai" || protocol === "openai-response") && shouldKernelSendFor(group, model)) {
    // Honour the client surface: a Responses caller gets /responses events,
    // a chat caller keeps the model's native surface (zenKernelURLFor).
    return protocol === "openai-response"
      ? kernelUrlForSurface("responses")
      : kernelUrlFor(model);
  }
  const catalogPath = provider.capabilityCatalog?.supported_endpoint[protocol]?.path;
  const template = group.endpointPathOverride || catalogPath || DEFAULT_ENDPOINTS[protocol];
  const path = template.replaceAll("{model}", encodeURIComponent(model));
  return joinRelayEndpoint(group.baseUrl ?? provider.baseUrl ?? "", path);
}

function resolveProtocolStreamEndpoint(
  provider: ProviderConfig,
  group: ChannelGroupConfig,
  protocol: Exclude<RelayResponseProtocol, "openai-response">,
  model: string
): string {
  if (protocol !== "gemini") return resolveProtocolEndpoint(provider, group, protocol, model);
  const configured = provider.capabilityCatalog?.supported_endpoint["gemini-stream"]?.path;
  const fallback = "/v1beta/models/{model}:streamGenerateContent?alt=sse";
  const override = group.endpointPathOverride?.replace(":generateContent", ":streamGenerateContent");
  const template = override || configured || fallback;
  const path = template.replaceAll("{model}", encodeURIComponent(model));
  const endpoint = joinRelayEndpoint(group.baseUrl ?? provider.baseUrl ?? "", path);
  return endpoint.includes("alt=sse") ? endpoint : `${endpoint}${endpoint.includes("?") ? "&" : "?"}alt=sse`;
}

function sanitizeOpenCodePayload(payload: Record<string, unknown>, model: string, stream?: boolean, opts?: { group?: ChannelGroupConfig | null; apiKey?: string | null; sourceHeaders?: Headers | null; protocol?: RelayResponseProtocol | null }): void {
  // True-client kernel: rebuild the caller body exactly as the real OpenCode
  // client sends it (inference/v1 chat/Responses shape). Rebuilt from the
  // pre-contract payload so injected placeholders never leak.
  if (opts?.group && shouldKernelSendFor(opts.group, typeof payload.model === "string" && String(payload.model).trim() ? String(payload.model) : model)) {
    const bareBefore = typeof payload.model === "string" ? String(payload.model) : model;
    // Upstream validates the session shape (`ses_` + 12 hex + 14 base62), so a
    // `cxu-…` prompt cache key is never sent verbatim — it seeds a deterministic
    // canonical session instead, keeping the conversation stable across requests.
    const promptKey = typeof payload.prompt_cache_key === "string" && payload.prompt_cache_key.trim() ? payload.prompt_cache_key.trim() : undefined;
    const sessionHint = kernelSessionHintFromHeaders(opts.sourceHeaders ?? null)
      ?? (promptKey ? canonicalOpencodeId("ses_", promptKey) : undefined);
    const identity = kernelIdentityFor(payload, sessionHint);
    const out = buildKernelBody(payload, bareBefore, identity, opts.protocol ?? undefined) as Record<string, unknown>;
    if (out !== (payload as unknown)) {
      for (const key of Object.keys(payload)) delete payload[key];
      Object.assign(payload, out);
    }
    return;
  }
  // Single delegation: buildOpencodeUpstreamBody mirrors
  // OpencodeExecutor.transformRequest exactly (deepseek fallback -> free-tier
  // contract -> enum trim -> client_metadata drop -> prefix strip ->
  // stream_options gate -> effort split -> reasoning_content inject).
  // Post-steps below must stay in the same file as the upstream post-steps:
  // only muse-spark max_tokens floor (opencodeMuseSpark.ts applies to
  // body.max_tokens only, never max_output_tokens).
  const effectiveStream = stream ?? (payload as Record<string, unknown>).stream === true;
  const bareBefore = typeof payload.model === "string" ? String(payload.model) : model;
  const out = buildOpencodeUpstreamBody(payload, bareBefore, effectiveStream) as Record<string, unknown>;
  if (out !== (payload as unknown)) {
    for (const key of Object.keys(payload)) delete payload[key];
    Object.assign(payload, out);
  }
  applyMuseSparkMinOutputTokens(String((payload as Record<string, unknown>).model ?? bareBefore), payload);
}

/** Port of OpencodeExecutor.noteForcedStreamOutcome + noteFreeTierRefusal (opencode.ts:232-241,417-432). */
function noteOpencodeUpstreamOutcome(payload: Record<string, unknown>, response: Response | null, bodyText: string | null, ok: boolean): void {
  const attempt = opencodeAttemptFor(payload);
  if (!attempt) return;
  if (response && ok) {
    noteOpencodeFreeTierOutcome(attempt, { ok: true, status: response.status ?? null, bodyText: null });
    return;
  }
  const status = response?.status ?? null;
  if (status !== 403 && status !== 451) {
    if (response && !ok) noteOpencodeFreeTierOutcome(attempt, { ok: false, status, bodyText });
    return;
  }
  if (!attempt.borrowed || attempt.probe) return;
  noteOpencodeFreeTierOutcome(attempt, { ok: false, status, bodyText });
}

/**
 * Port of retryFreeTierRefusalWithObservedTools (opencodeFreeTierRetry.ts:106-137):
 * one bounded retry on own-tools refusal with observed names appended. Returns the
 * retry Response on success, else null (caller keeps the original refusal).
 */
async function tryOpencodeObservedRetry(
  payload: Record<string, unknown>,
  model: string,
  group: ChannelGroupConfig,
  fetchPayload: (body: Record<string, unknown>) => Promise<Response>,
  first: Response,
  firstBodyText: string,
): Promise<Response | null> {
  const attempt = opencodeAttemptFor(payload);
  if (!attempt) return null;
  const surface = surfaceFromBaseUrl((group.baseUrl ?? OMNIROUTE_FREE_BASE_URL).trim() || OMNIROUTE_FREE_BASE_URL);
  if (!opencodeRetryScopeApplies(
    { surface, provider: group.id || "opencode", borrowed: attempt.borrowed },
    attempt.model || model,
    first.status,
    payload,
  )) return null;
  if (!isOwnOpencodeToolsRetryableRefusal(first.status, firstBodyText)) return null;
  const format = resolveOpencodeTargetFormat(group.id || "opencode", attempt.model || model);
  const merged = buildOpencodeObservedRetryBody(
    payload,
    format === "openai-responses" ? "openai-responses" : "openai",
    group.id || "opencode",
    attempt.model || model,
    attempt.session,
    configuredOpencodePlaceholderToolNames(),
  );
  if (merged === (payload as unknown)) return null;
  let retry: Response;
  try {
    retry = await fetchPayload(merged as Record<string, unknown>);
  } catch {
    return null;
  }
  if (!retry.ok) {
    await retry.body?.cancel().catch(() => undefined);
    return null;
  }
  noteOpencodeFreeTierOutcome(attempt, { ok: true, status: retry.status ?? null, bodyText: null });
  return retry;
}

/**
 * Port of withRequestShapeRetry other-shape replay (opencodeRequestShape.ts):
 * on a shape refusal, replay once with tools<->bare flipped. Returns retry
 * Response on success, else null.
 */
async function tryOpencodeShapeRetry(
  payload: Record<string, unknown>,
  model: string,
  fetchPayload: (body: Record<string, unknown>) => Promise<Response>,
  first: Response,
  firstBodyText: string,
): Promise<Response | null> {
  const attempt = opencodeAttemptFor(payload);
  if (!attempt) return null;
  if (!isOwnOpencodeToolsRetryableRefusal(first.status, firstBodyText)) return null;
  const hasTools = Array.isArray(payload.tools) && (payload.tools as unknown[]).length > 0;
  const flipped: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  if (hasTools) {
    delete flipped.tools;
    delete (flipped as Record<string, unknown>).tool_choice;
  } else {
    const withTools = buildOpencodeUpstreamBody(
      { ...(payload as Record<string, unknown>), tools: [] } as Record<string, unknown>,
      attempt.model || model,
      true,
    ) as Record<string, unknown>;
    if (!Array.isArray(withTools.tools) || (withTools.tools as unknown[]).length === 0) return null;
    Object.assign(flipped, withTools);
  }
  let retry: Response;
  try {
    retry = await fetchPayload(flipped);
  } catch {
    return null;
  }
  if (!retry.ok) {
    await retry.body?.cancel().catch(() => undefined);
    return null;
  }
  noteOpencodeFreeTierOutcome(attempt, { ok: true, status: retry.status ?? null, bodyText: null });
  return retry;
}

async function proxyResponsesRequest(input: {
  request: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKey: string;
  rawBody: Record<string, unknown>;
  toolCompatibility: RelayToolCompatibility;
  protocol: "openai-response";
  selectedModel: string;
  promptCacheKey?: string;
  userAgent?: string | null;
}): Promise<Response> {
  const endpoint = resolveProtocolEndpoint(input.provider, input.group, input.protocol, input.selectedModel);
  // The native Responses path is intentionally a passthrough, so it does not
  // go through the canonical request builders that inject the stable
  // per-thread prompt cache key. Preserve an explicit client key, and derive
  // the same stable key from the gateway session header when the client omits
  // one (which is what Codex direct requests do). The group routing switch
  // applies to explicit keys as well, just like the canonical builders.
  const rawBody = { ...input.rawBody };
  if (!responsesPromptCacheAllowed(input.group)) {
    delete rawBody.prompt_cache_key;
  } else if (!stringValue(rawBody.prompt_cache_key)) {
    const promptCacheKey = input.promptCacheKey ?? resolveCanonicalPromptCacheKey(input.request, rawBody);
    if (promptCacheKey) rawBody.prompt_cache_key = promptCacheKey;
  }
  if (isOpenCodeGroup(input.group)) {
    sanitizeOpenCodePayload(rawBody, input.selectedModel, undefined, { group: input.group, apiKey: input.apiKey, sourceHeaders: input.request.headers, protocol: input.protocol });
  }
  try {
    const response = await fetchUpstreamWithHeadersTimeout(endpoint, {
      method: "POST",
      headers: upstreamHeaders(input.protocol, input.group, input.apiKey, rawBody.stream === true, input.userAgent, undefined, undefined, input.request.headers, input.selectedModel, rawBody),
      body: JSON.stringify(rawBody),
      signal: input.request.signal
    });
    const headers = relayResponseHeaders(response.headers);
    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      const imageSummary = summarizeResponsesRequestImages(rawBody);
      const upstreamMessage = upstreamErrorMessage(body, input.protocol);
      if (rawBody.stream === true && isContextWindowError(body, upstreamMessage)) {
        return markUpstreamFailure(responsesFailureStream("context_length_exceeded", upstreamMessage, headers), response.status);
      }
      if (
        response.status === 429
        && rawBody.stream === true
        && imageSummary.toolOutputImageCount > 0
      ) {
        const retryAfterSeconds = upstreamRetryAfterSeconds(response.headers, body);
        console.warn("[relay-image] upstream rate limited a Responses image tool continuation", {
          providerId: input.provider.id,
          groupId: input.group.id,
          model: input.selectedModel,
          imageCount: imageSummary.imageCount,
          toolOutputImageCount: imageSummary.toolOutputImageCount,
          dataUrlChars: imageSummary.dataUrlChars,
          requestChars: JSON.stringify(rawBody).length,
          retryAfterSeconds,
          upstreamMessage: truncateDiagnostic(upstreamMessage)
        });
        return markUpstreamFailure(responsesRateLimitRetryStream(upstreamMessage, retryAfterSeconds, headers), response.status);
      }
      return markUpstreamFailure(new Response(body || null, { status: response.status, headers }), response.status);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream") || (rawBody.stream === true && !contentType.includes("json"))) {
      return normalizeResponsesProxyStream(response.body, response.status, headers, input.toolCompatibility);
    }
    if (contentType.includes("json")) {
      const body = await response.json().catch(() => null);
      if (body != null) {
        return new Response(JSON.stringify(normalizeRelayResponsePayload(body, input.toolCompatibility)), { status: response.status, headers });
      }
    }
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    return markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} request failed: ${errorMessage(error)}`), 502);
  }
}

function summarizeResponsesRequestImages(record: Record<string, unknown>): {
  imageCount: number;
  toolOutputImageCount: number;
  dataUrlChars: number;
} {
  let imageCount = 0;
  let toolOutputImageCount = 0;
  let dataUrlChars = 0;
  if (!Array.isArray(record.input)) return { imageCount, toolOutputImageCount, dataUrlChars };

  for (const rawItem of record.input) {
    const item = asRecord(rawItem);
    const type = stringValue(item.type);
    const isToolOutput = type === "function_call_output" || type === "custom_tool_call_output";
    const content = isToolOutput ? item.output ?? item.content : item.content;
    if (!Array.isArray(content)) continue;
    for (const rawPart of content) {
      const part = asRecord(rawPart);
      const partType = stringValue(part.type);
      if (partType !== "input_image" && partType !== "inputImage") continue;
      imageCount += 1;
      if (isToolOutput) toolOutputImageCount += 1;
      const url = stringValue(part.image_url) ?? stringValue(part.imageUrl) ?? stringValue(part.url);
      if (url?.startsWith("data:")) dataUrlChars += url.length;
    }
  }
  return { imageCount, toolOutputImageCount, dataUrlChars };
}

function upstreamRetryAfterSeconds(headers: Headers, body: string): number {
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return clampRetryAfterSeconds(seconds);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return clampRetryAfterSeconds((date - Date.now()) / 1000);
  }

  const match = /(?:try again|retry)(?:\s+after|\s+in)?\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds?|s|seconds?)/i.exec(body);
  if (match) {
    const value = Number(match[1]);
    const seconds = match[2]?.toLowerCase().startsWith("m") ? value / 1000 : value;
    if (Number.isFinite(seconds) && seconds > 0) return clampRetryAfterSeconds(seconds);
  }
  // Token-per-minute relays often omit Retry-After. Waiting one full window avoids
  // uploading the same image history repeatedly while the limit is still active.
  return 60;
}

function clampRetryAfterSeconds(value: number): number {
  return Math.max(1, Math.min(300, Math.ceil(value)));
}

function responsesRateLimitRetryStream(message: string, retryAfterSeconds: number, upstreamHeaders: Headers): Response {
  const retryMessage = `${message || "Upstream image request was rate limited."} Please try again in ${retryAfterSeconds}s.`;
  const event = {
    type: "response.failed",
    sequence_number: 0,
    response: {
      id: `resp_relay_${randomUUID()}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "failed",
      error: { code: "rate_limit_exceeded", message: retryMessage }
    }
  };
  const headers = new Headers(upstreamHeaders);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache");
  headers.set("Retry-After", String(retryAfterSeconds));
  return new Response(`event: response.failed\ndata: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers
  });
}

function responsesFailureStream(code: string, message: string, upstreamHeaders: Headers): Response {
  const event = {
    type: "response.failed",
    sequence_number: 0,
    response: {
      id: `resp_relay_${randomUUID()}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "failed",
      error: { code, message }
    }
  };
  const headers = new Headers(upstreamHeaders);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache");
  return new Response(`event: response.failed\ndata: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, { status: 200, headers });
}

function truncateDiagnostic(value: string, maxLength = 500): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

export function summarizeResponsesRequestTools(
  request: Record<string, unknown>,
  model: string,
  protocol: RelayResponseProtocol
): { model: string; protocol: RelayResponseProtocol; toolCount: number; toolNames: string[] } {
  const tools = responsesRequestTools(request);
  const toolNames = tools.map((value, index) => {
    const tool = asRecord(value);
    const name = stringValue(tool.name) ?? stringValue(asRecord(tool.function).name);
    const namespace = stringValue(tool.namespace);
    const type = stringValue(tool.type);
    return name ?? namespace ?? type ?? `unknown-${index}`;
  });
  return { model, protocol, toolCount: tools.length, toolNames };
}

export function listRelayToolDiagnostics(afterId = 0): { latestId: number; entries: RelayToolDiagnostic[] } {
  return {
    latestId: relayToolDiagnosticId,
    entries: relayToolDiagnostics.filter((entry) => entry.id > afterId)
  };
}

function recordRelayToolDiagnostic(summary: ReturnType<typeof summarizeResponsesRequestTools>): RelayToolDiagnostic {
  const entry = { id: ++relayToolDiagnosticId, recordedAt: Date.now(), ...summary };
  relayToolDiagnostics.push(entry);
  if (relayToolDiagnostics.length > 256) relayToolDiagnostics.splice(0, relayToolDiagnostics.length - 256);
  return entry;
}

function normalizeResponsesProxyStream(
  upstreamBody: ReadableStream<Uint8Array>,
  status: number,
  headers: Headers,
  toolCompatibility: RelayToolCompatibility
): Response {
  const reader = upstreamBody.getReader();
  const encoder = new TextEncoder();
  const bufferedInputs = new Map<string, { event: Record<string, unknown>; chunks: string[] }>();
  const bufferedFunctionArguments = new Map<string, string[]>();
  let cancelled = false;
  let terminal = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (eventName: string | undefined, value: unknown) => {
        const prefix = eventName ? `event: ${eventName}\n` : "";
        controller.enqueue(encoder.encode(`${prefix}data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`));
      };
      const flushBuffered = () => {
        for (const [key, pending] of bufferedInputs) {
          const rawInput = pending.chunks.join("");
          const normalizedInput = unwrapCustomToolInput(rawInput);
          const deltaEvent: Record<string, unknown> = {
            ...pending.event,
            type: "response.custom_tool_call_input.delta",
            delta: normalizedInput
          };
          delete deltaEvent.input;
          enqueue("response.custom_tool_call_input.delta", deltaEvent);
          bufferedInputs.delete(key);
        }
      };
      const failIncompleteFunctionArguments = (key: string, argumentsText: string) => {
        enqueue("response.failed", {
          type: "response.failed",
          response: {
            id: `resp_${randomUUID().replaceAll("-", "")}`,
            object: "response",
            status: "failed",
            output: [],
            error: {
              code: "incomplete_function_call_arguments",
              message: incompleteFunctionArgumentsMessage(argumentsText, key)
            }
          }
        });
        enqueue(undefined, "[DONE]");
        terminal = true;
      };
      try {
        await consumeSse(reader, (data, eventName) => {
          if (data === "[DONE]") {
            const incomplete = firstIncompleteFunctionArguments(bufferedFunctionArguments);
            if (incomplete) {
              failIncompleteFunctionArguments(incomplete.key, incomplete.argumentsText);
              return true;
            }
            flushBuffered();
            enqueue(undefined, data);
            terminal = true;
            return true;
          }
          let value: unknown;
          try {
            value = JSON.parse(data);
          } catch {
            enqueue(eventName, data);
            return;
          }
          const event = asRecord(value);
          const type = stringValue(event.type) ?? eventName;
          const key = customToolStreamKey(event);
          if (type === "response.function_call_arguments.delta") {
            const chunks = bufferedFunctionArguments.get(key) ?? [];
            chunks.push(stringValue(event.delta) ?? "");
            bufferedFunctionArguments.set(key, chunks);
            enqueue(eventName, normalizeRelayResponsePayload(value, toolCompatibility));
            return;
          }
          if (type === "response.function_call_arguments.done") {
            const argumentsText = normalizedFunctionArguments(
              stringValue(event.arguments) ?? bufferedFunctionArguments.get(key)?.join("") ?? ""
            );
            bufferedFunctionArguments.delete(key);
            if (!isCompleteFunctionArguments(argumentsText)) {
              failIncompleteFunctionArguments(key, argumentsText);
              return true;
            }
            enqueue(eventName ?? "response.function_call_arguments.done", { ...event, arguments: argumentsText });
            return;
          }
          if (type === "response.custom_tool_call_input.delta") {
            const pending = bufferedInputs.get(key) ?? { event, chunks: [] };
            pending.chunks.push(stringValue(event.delta) ?? "");
            bufferedInputs.set(key, pending);
            return;
          }
          if (type === "response.custom_tool_call_input.done") {
            const pending = bufferedInputs.get(key);
            const rawInput = stringValue(event.input) ?? pending?.chunks.join("") ?? "";
            const normalizedInput = unwrapCustomToolInput(rawInput);
            if (normalizedInput) {
              const deltaEvent: Record<string, unknown> = {
                ...(pending?.event ?? event),
                type: "response.custom_tool_call_input.delta",
                delta: normalizedInput
              };
              delete deltaEvent.input;
              enqueue("response.custom_tool_call_input.delta", deltaEvent);
            }
            bufferedInputs.delete(key);
            enqueue(eventName ?? "response.custom_tool_call_input.done", { ...event, input: normalizedInput });
            return;
          }
          enqueue(eventName, normalizeRelayResponsePayload(value, toolCompatibility));
          if (type === "response.completed" || type === "response.failed" || type === "response.incomplete") {
            const incomplete = firstIncompleteFunctionArguments(bufferedFunctionArguments);
            if (incomplete) {
              failIncompleteFunctionArguments(incomplete.key, incomplete.argumentsText);
              return true;
            }
            flushBuffered();
            enqueue(undefined, "[DONE]");
            terminal = true;
            return true;
          }
          return undefined;
        });
        flushBuffered();
        if (terminal) {
          await reader.cancel("Responses terminal event received").catch(() => undefined);
        }
        if (!cancelled) controller.close();
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    async cancel(reason) {
      cancelled = true;
      await reader.cancel(reason).catch(() => undefined);
    }
  });
  return new Response(body, { status, headers });
}

function customToolStreamKey(event: Record<string, unknown>): string {
  return stringValue(event.item_id) ?? `output-${finiteNumber(event.output_index) ?? 0}`;
}

function normalizedFunctionArguments(value: string): string {
  return value.trim() || "{}";
}

function isCompleteFunctionArguments(value: string): boolean {
  try {
    const parsed = JSON.parse(normalizedFunctionArguments(value));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function firstIncompleteFunctionArguments(
  buffered: Map<string, string[]>
): { key: string; argumentsText: string } | null {
  for (const [key, chunks] of buffered) {
    const argumentsText = normalizedFunctionArguments(chunks.join(""));
    if (!isCompleteFunctionArguments(argumentsText)) return { key, argumentsText };
  }
  return null;
}

function incompleteFunctionArgumentsMessage(value: string, callId: string): string {
  return `Remote model stream ended before tool arguments were complete (${callId}, ${value.length} chars). The write request was not replayed automatically; continue or retry in the same conversation.`;
}

function normalizeCustomToolInputs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeCustomToolInputs);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const normalized = Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, normalizeCustomToolInputs(entry)]));
  if (normalized.type === "custom_tool_call" && typeof normalized.input === "string") {
    normalized.input = unwrapCustomToolInput(normalized.input);
  }
  if (normalized.type === "response.custom_tool_call_input.done" && typeof normalized.input === "string") {
    normalized.input = unwrapCustomToolInput(normalized.input);
  }
  return normalized;
}

function unwrapCustomToolInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return value;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (Object.keys(record).length === 1 && typeof record.input === "string") {
        return record.input;
      }
    }
  } catch {
    // Keep genuinely free-form tool input unchanged.
  }
  return value;
}

async function runCanonicalUpstream(input: {
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKey: string;
  protocol: Exclude<RelayResponseProtocol, "openai-response">;
  request: CanonicalRequest;
  signal: AbortSignal;
  userAgent?: string | null;
  sourceHeaders?: Headers | null;
}): Promise<{ ok: true; result: CanonicalResult } | { ok: false; response: Response }> {
  // Embedded duck2api: same OpenAI wire shape, no HTTP hop.
  if (isEmbeddedD2ApiGroup(input.group) && input.protocol === "openai") {
    let response: Response;
    try {
      response = await fetchEmbeddedD2ApiCompletions(input.request, input.apiKey, false);
    } catch (error) {
      return { ok: false, response: markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} request failed: ${errorMessage(error)}`), 502) };
    }
    const bodyText = await response.text();
    if (!response.ok) {
      return { ok: false, response: markUpstreamFailure(errorResponse(response.status, upstreamErrorMessage(bodyText, input.protocol), relayResponseHeaders(response.headers)), response.status) };
    }
    return parseCanonicalChatResponse(bodyText, input.request.model, input.request.tools);
  }
  // Embedded opencode-local: run the prompt through the in-process OpenCode
  // runtime (direct serve turn) and shape the text as a canonical result.
  // This is what lets external OpenAI-protocol CLIs (codex/claude/opencode
  // via openai-compatible provider) consume Zen models through the shared
  // relay URL instead of 401ing against the 4096 placeholder.
  if (isEmbeddedOpencodeLocalGroup(input.provider) && input.protocol === "openai") {
    try {
      return { ok: true, result: await runEmbeddedOpencodeLocalResult(input.request, input.signal) };
    } catch (error) {
      const message = errorMessage(error);
      const status = embeddedOpencodeErrorStatus(message);
      // Never silent: a failed local turn must leave a trace, otherwise
      // clients only see a bare 502 with no server-side row to correlate.
      console.warn(`[opencode-local] turn failed status=${status} model=${input.request.model} error=${message.slice(0, 300)}`);
      return { ok: false, response: markUpstreamFailure(errorResponse(status, `opencode-local turn failed: ${message}`), status) };
    }
  }
  let freebuffSession: FreebuffSessionInfo | null = null;
  let freebuffRunId: string | null = null;
  if (isFreebuffGroup(input.group, input.provider)) {
    try {
      freebuffSession = await getOrEnsureFreebuffSession(input.request.model, input.apiKey);
      freebuffRunId = await createFreebuffRunId(freebuffSession.agentId, freebuffSession.token);
    } catch (err) {
      return { ok: false, response: markUpstreamFailure(errorResponse(400, errorMessage(err)), 400) };
    }
  }
  const endpoint = withProtocolQueryAuth(
    resolveProtocolEndpoint(input.provider, input.group, input.protocol, input.request.model),
    input.protocol,
    input.group.authType,
    freebuffSession?.token || input.apiKey
  );
  let payload = input.protocol === "openai"
    ? canonicalToChat(input.request, { freeOllama: input.provider.id === "free-ollama", allowPromptCacheKey: chatPromptCacheAllowed(input.provider, input.group), freebuffSession, freebuffRunId })
    : input.protocol === "anthropic"
      ? canonicalToAnthropic(input.request)
      : canonicalToGemini(input.request);
  if (isOpenCodeGroup(input.group)) {
    sanitizeOpenCodePayload(payload as Record<string, unknown>, input.request.model, undefined, { group: input.group, apiKey: input.apiKey, sourceHeaders: input.sourceHeaders ?? null, protocol: input.protocol });
  }
  let response: Response;
  const fetchPayload = async (body: Record<string, unknown>, sessionOverride?: FreebuffSessionInfo | null) => fetchUpstreamWithHeadersTimeout(endpoint, {
      method: "POST",
      headers: upstreamHeaders(input.protocol, input.group, input.apiKey, false, input.userAgent, null, sessionOverride !== undefined ? sessionOverride : freebuffSession, input.sourceHeaders, input.request.model, body),
      body: JSON.stringify(body),
      signal: input.signal
    });
  try {
    response = await fetchPayload(payload);
  } catch (error) {
    return { ok: false, response: markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} request failed: ${errorMessage(error)}`), 502) };
  }
  let bodyText = await response.text();
  if (!response.ok) {
    if (freebuffSession && (response.status === 409 || response.status === 410 || response.status === 428 || response.status === 401 || response.status === 403)) {
      clearFreebuffSession(input.request.model);
      try {
        const freshSession = await getOrEnsureFreebuffSession(input.request.model, input.apiKey);
        const freshRunId = await createFreebuffRunId(freshSession.agentId, freshSession.token);
        const retryPayload = canonicalToChat(input.request, {
          freeOllama: input.provider.id === "free-ollama",
          allowPromptCacheKey: chatPromptCacheAllowed(input.provider, input.group),
          freebuffSession: freshSession,
          freebuffRunId: freshRunId
        });
        const retryRes = await fetchPayload(retryPayload, freshSession);
        if (retryRes.ok) {
          response = retryRes;
          bodyText = await response.text();
          return parseCanonicalChatResponse(bodyText, input.request.model, input.request.tools);
        }
      } catch {
        // Fall through to the original upstream error.
      }
    }
    if (input.provider.id === "free-ollama" && input.protocol === "openai" && hasUnsupportedOllamaThinking(bodyText, payload)) {
      const retryPayload = { ...payload };
      delete retryPayload.reasoning_effort;
      delete retryPayload.think;
      try {
        response = await fetchPayload(retryPayload);
        const retryBodyText = await response.text();
        if (response.ok) {
          payload = retryPayload;
          return parseCanonicalChatResponse(retryBodyText, input.request.model, input.request.tools);
        }
      } catch {
        // Fall through to the original upstream error.
      }
    }
    if (isOpenCodeGroup(input.group)) {
      try {
        const retry = await tryOpencodeObservedRetry(payload as Record<string, unknown>, input.request.model, input.group, fetchPayload, response, bodyText);
        if (retry) {
          response = retry;
          bodyText = await response.text();
          if (response.ok) {
            noteOpencodeUpstreamOutcome(payload as Record<string, unknown>, response, null, true);
            return parseCanonicalChatResponse(bodyText, input.request.model, input.request.tools);
          }
        } else {
          const shapeRetry = await tryOpencodeShapeRetry(payload as Record<string, unknown>, input.request.model, fetchPayload, response, bodyText);
          if (shapeRetry) {
            response = shapeRetry;
            bodyText = await response.text();
            if (response.ok) {
              noteOpencodeUpstreamOutcome(payload as Record<string, unknown>, response, null, true);
              return parseCanonicalChatResponse(bodyText, input.request.model, input.request.tools);
            }
          }
        }
      } catch {
        // Fall through to the original upstream error.
      }
      noteOpencodeUpstreamOutcome(payload as Record<string, unknown>, response, bodyText, false);
    }
    return { ok: false, response: markUpstreamFailure(errorResponse(response.status, upstreamErrorMessage(bodyText, input.protocol), relayResponseHeaders(response.headers)), response.status) };
  }
  noteOpencodeUpstreamOutcome(payload as Record<string, unknown>, response, null, true);
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, response: markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} returned invalid JSON`), 502) };
  }
  try {
    const result = input.protocol === "openai"
      ? chatResponseToCanonical(body, input.request.model, input.request.tools)
      : input.protocol === "anthropic"
        ? anthropicResponseToCanonical(body, input.request.model)
        : geminiResponseToCanonical(body, input.request.model);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, response: markUpstreamFailure(errorResponse(502, errorMessage(error)), 502) };
  }
}

function parseCanonicalChatResponse(bodyText: string, model: string, tools: CanonicalTool[] = []): { ok: true; result: CanonicalResult } | { ok: false; response: Response } {
  try {
    return { ok: true, result: chatResponseToCanonical(JSON.parse(bodyText), model, tools) };
  } catch (error) {
    return { ok: false, response: markUpstreamFailure(errorResponse(502, errorMessage(error)), 502) };
  }
}

function hasUnsupportedOllamaThinking(body: string, payload: Record<string, JsonValue>): boolean {
  return payload.reasoning_effort != null && /does not support thinking|thinking is not supported|unsupported thinking/i.test(body);
}

async function runCanonicalUpstreamStream(input: {
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKey: string;
  protocol: Exclude<RelayResponseProtocol, "openai-response">;
  request: CanonicalRequest;
  signal: AbortSignal;
  userAgent?: string | null;
  sourceHeaders?: Headers | null;
}): Promise<Response> {
  // Embedded duck2api: SSE frames translate through the standard openai path.
  if (isEmbeddedD2ApiGroup(input.group) && input.protocol === "openai") {
    let response: Response;
    try {
      response = await fetchEmbeddedD2ApiCompletions(input.request, input.apiKey, true);
    } catch (error) {
      return markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} request failed: ${errorMessage(error)}`), 502);
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const message = upstreamErrorMessage(bodyText, input.protocol);
      return markUpstreamFailure(errorResponse(response.status, message, relayResponseHeaders(response.headers)), response.status);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/event-stream") || !response.body) {
      const bodyText = await response.text().catch(() => "");
      try {
        const body = JSON.parse(bodyText);
        const result = chatResponseToCanonical(body, input.request.model, input.request.tools);
        return responsesEventStream(canonicalResultToResponses(result, input.request.tools));
      } catch (error) {
        return markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} returned an invalid stream: ${errorMessage(error)}`), 502);
      }
    }
    return translateNativeEventStream(response.body, input.protocol, input.request);
  }
  // Embedded opencode-local: live SSE — deltas flush while the local
  // turn runs, so clients never sit 150s on silence (their stall
  // detectors otherwise retryError/retry the call).
  if (isEmbeddedOpencodeLocalGroup(input.provider) && input.protocol === "openai") {
    if (!embeddedOpencodeRunner) {
      return markUpstreamFailure(errorResponse(502, "opencode-local bridge is not configured on this server"), 502);
    }
    return streamEmbeddedOpencodeResponsesTurn(input.request, input.signal);
  }
  let freebuffSession: FreebuffSessionInfo | null = null;
  let freebuffRunId: string | null = null;
  if (isFreebuffGroup(input.group, input.provider)) {
    try {
      freebuffSession = await getOrEnsureFreebuffSession(input.request.model, input.apiKey);
      freebuffRunId = await createFreebuffRunId(freebuffSession.agentId, freebuffSession.token);
    } catch (err) {
      return markUpstreamFailure(errorResponse(400, errorMessage(err)), 400);
    }
  }
  const endpoint = withProtocolQueryAuth(
    resolveProtocolStreamEndpoint(input.provider, input.group, input.protocol, input.request.model),
    input.protocol,
    input.group.authType,
    freebuffSession?.token || input.apiKey
  );
  const payload = input.protocol === "openai"
    ? canonicalToChat(input.request, { freeOllama: input.provider.id === "free-ollama", allowPromptCacheKey: chatPromptCacheAllowed(input.provider, input.group), freebuffSession, freebuffRunId })
    : input.protocol === "anthropic"
      ? canonicalToAnthropic(input.request)
      : canonicalToGemini(input.request);
  if (isOpenCodeGroup(input.group)) {
    sanitizeOpenCodePayload(payload as Record<string, unknown>, input.request.model, undefined, { group: input.group, apiKey: input.apiKey, sourceHeaders: input.sourceHeaders ?? null, protocol: input.protocol });
  }
  if (input.protocol !== "gemini") payload.stream = true;
  if (input.protocol === "openai") {
    payload.stream_options = {
      ...asRecord(payload.stream_options),
      include_usage: true
    };
  }

  let response: Response;
  try {
    response = await fetchUpstreamWithHeadersTimeout(endpoint, {
      method: "POST",
      headers: upstreamHeaders(input.protocol, input.group, input.apiKey, true, input.userAgent, null, freebuffSession, input.sourceHeaders, input.request.model, payload),
      body: JSON.stringify(payload),
      signal: input.signal
    });
  } catch (error) {
    return markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} request failed: ${errorMessage(error)}`), 502);
  }
  if (!response.ok) {
    if (freebuffSession && (response.status === 409 || response.status === 410 || response.status === 428 || response.status === 401 || response.status === 403)) {
      clearFreebuffSession(input.request.model);
      try {
        const freshSession = await getOrEnsureFreebuffSession(input.request.model, input.apiKey);
        const freshRunId = await createFreebuffRunId(freshSession.agentId, freshSession.token);
        const retryPayload = canonicalToChat(input.request, {
          freeOllama: input.provider.id === "free-ollama",
          allowPromptCacheKey: chatPromptCacheAllowed(input.provider, input.group),
          freebuffSession: freshSession,
          freebuffRunId: freshRunId
        });
        if (input.protocol !== "gemini") retryPayload.stream = true;
        if (input.protocol === "openai") {
          retryPayload.stream_options = {
            ...asRecord(retryPayload.stream_options),
            include_usage: true
          };
        }
        const retryRes = await fetchUpstreamWithHeadersTimeout(endpoint, {
          method: "POST",
          headers: upstreamHeaders(input.protocol, input.group, input.apiKey, true, input.userAgent, null, freshSession, input.sourceHeaders, input.request.model, retryPayload),
          body: JSON.stringify(retryPayload),
          signal: input.signal
        });
        if (retryRes.ok) {
          response = retryRes;
        }
      } catch {
        // Fall through to error handling
      }
    }
    const bodyText = await response.text().catch(() => "");
    if (input.provider.id === "free-ollama" && input.protocol === "openai" && hasUnsupportedOllamaThinking(bodyText, payload)) {
      const retryPayload = { ...payload };
      delete retryPayload.reasoning_effort;
      delete retryPayload.think;
      try {
        response = await fetchUpstreamWithHeadersTimeout(endpoint, {
          method: "POST",
          headers: upstreamHeaders(input.protocol, input.group, input.apiKey, true, input.userAgent, null, freebuffSession, input.sourceHeaders, input.request.model, payload),
          body: JSON.stringify(retryPayload),
          signal: input.signal
        });
        if (response.ok) {
          const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
          if (!contentType.includes("text/event-stream") || !response.body) {
            const retryBody = await response.text().catch(() => "");
            try {
              return responsesEventStream(canonicalResultToResponses(chatResponseToCanonical(JSON.parse(retryBody), input.request.model, input.request.tools), input.request.tools));
            } catch {
              return markUpstreamFailure(errorResponse(502, "Upstream ollama returned an invalid retry response"), 502);
            }
          }
          return translateNativeEventStream(response.body, input.protocol, input.request);
        }
      } catch {
        // Fall through to the original upstream error.
      }
    }
    const message = upstreamErrorMessage(bodyText, input.protocol);
    if (isContextWindowError(bodyText, message)) {
      return markUpstreamFailure(responsesFailureStream("context_length_exceeded", message, relayResponseHeaders(response.headers)), response.status);
    }
    return markUpstreamFailure(errorResponse(response.status, message, relayResponseHeaders(response.headers)), response.status);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    const bodyText = await response.text().catch(() => "");
    try {
      const body = JSON.parse(bodyText);
      const result = input.protocol === "openai"
        ? chatResponseToCanonical(body, input.request.model, input.request.tools)
        : input.protocol === "anthropic"
          ? anthropicResponseToCanonical(body, input.request.model)
          : geminiResponseToCanonical(body, input.request.model);
      return responsesEventStream(canonicalResultToResponses(result, input.request.tools));
    } catch (error) {
      return markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} returned an invalid stream: ${errorMessage(error)}`), 502);
    }
  }

  return translateNativeEventStream(response.body, input.protocol, input.request);
}

// Chat Completions inbound + streaming: the Responses-oriented
// runCanonicalUpstreamStream always emits Responses-protocol SSE, which chat
// clients cannot parse. This mirrors its upstream handling but translates the
// stream into chat.completion.chunk frames instead.
async function runCanonicalUpstreamChatStream(input: {
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKey: string;
  protocol: Exclude<RelayResponseProtocol, "openai-response">;
  request: CanonicalRequest;
  signal: AbortSignal;
  userAgent?: string | null;
  sourceHeaders?: Headers | null;
}): Promise<Response> {
  // Embedded duck2api: chat-chunk frames translate through the standard openai path.
  if (isEmbeddedD2ApiGroup(input.group) && input.protocol === "openai") {
    let response: Response;
    try {
      response = await fetchEmbeddedD2ApiCompletions(input.request, input.apiKey, true);
    } catch (error) {
      return markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} request failed: ${errorMessage(error)}`), 502);
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const message = upstreamErrorMessage(bodyText, input.protocol);
      return markUpstreamFailure(errorResponse(response.status, message, relayResponseHeaders(response.headers)), response.status);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/event-stream") || !response.body) {
      const bodyText = await response.text().catch(() => "");
      try {
        const body = JSON.parse(bodyText);
        const result = chatResponseToCanonical(body, input.request.model, input.request.tools);
        return chatEventStreamFromResult(result);
      } catch (error) {
        return markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} returned an invalid stream: ${errorMessage(error)}`), 502);
      }
    }
    return translateCanonicalEventsToChat(response.body, input.protocol, input.request);
  }
  // Embedded opencode-local: live chat-chunk SSE, same rationale as above.
  if (isEmbeddedOpencodeLocalGroup(input.provider) && input.protocol === "openai") {
    if (!embeddedOpencodeRunner) {
      return markUpstreamFailure(errorResponse(502, "opencode-local bridge is not configured on this server"), 502);
    }
    return streamEmbeddedOpencodeChatTurn(input.request, input.signal);
  }
  let freebuffSession: FreebuffSessionInfo | null = null;
  if (isFreebuffGroup(input.group, input.provider)) {
    try {
      freebuffSession = await getOrEnsureFreebuffSession(input.request.model, input.apiKey);
    } catch (err) {
      return markUpstreamFailure(errorResponse(400, errorMessage(err)), 400);
    }
  }
  const endpoint = withProtocolQueryAuth(
    resolveProtocolStreamEndpoint(input.provider, input.group, input.protocol, input.request.model),
    input.protocol,
    input.group.authType,
    freebuffSession?.token || input.apiKey
  );
  const payload = input.protocol === "openai"
    ? canonicalToChat(input.request, { freeOllama: input.provider.id === "free-ollama", allowPromptCacheKey: chatPromptCacheAllowed(input.provider, input.group), freebuffSession })
    : input.protocol === "anthropic"
      ? canonicalToAnthropic(input.request)
      : canonicalToGemini(input.request);
  if (isOpenCodeGroup(input.group)) {
    sanitizeOpenCodePayload(payload as Record<string, unknown>, input.request.model, undefined, { group: input.group, apiKey: input.apiKey, sourceHeaders: input.sourceHeaders ?? null, protocol: input.protocol });
  }
  if (input.protocol !== "gemini") payload.stream = true;
  if (input.protocol === "openai") {
    payload.stream_options = {
      ...asRecord(payload.stream_options),
      include_usage: true
    };
  }

  let response: Response;
  try {
    response = await fetchUpstreamWithHeadersTimeout(endpoint, {
      method: "POST",
      headers: upstreamHeaders(input.protocol, input.group, input.apiKey, true, input.userAgent, null, freebuffSession, input.sourceHeaders, input.request.model, payload),
      body: JSON.stringify(payload),
      signal: input.signal
    });
  } catch (error) {
    return markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} request failed: ${errorMessage(error)}`), 502);
  }
  if (!response.ok) {
    if (freebuffSession && (response.status === 409 || response.status === 410 || response.status === 428 || response.status === 401 || response.status === 403)) {
      clearFreebuffSession();
    }
    const bodyText = await response.text().catch(() => "");
    const message = upstreamErrorMessage(bodyText, input.protocol);
    return markUpstreamFailure(errorResponse(response.status, message, relayResponseHeaders(response.headers)), response.status);
  }

  // Some upstreams ignore stream:true and answer with a single JSON object;
  // re-emit it as an equivalent one-shot chunk stream.
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    const bodyText = await response.text().catch(() => "");
    try {
      const body = JSON.parse(bodyText);
      const result = input.protocol === "openai"
        ? chatResponseToCanonical(body, input.request.model, input.request.tools)
        : input.protocol === "anthropic"
          ? anthropicResponseToCanonical(body, input.request.model)
          : geminiResponseToCanonical(body, input.request.model);
      return chatEventStreamFromResult(result);
    } catch (error) {
      return markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} returned an invalid stream: ${errorMessage(error)}`), 502);
    }
  }

  return translateCanonicalEventsToChat(response.body, input.protocol, input.request);
}

function chatFinishReasonToChat(finishReason: string | undefined): string {
  switch ((finishReason ?? "").toLowerCase()) {
    case "length":
    case "max_tokens":
    case "max_output_tokens":
      return "length";
    case "tool_calls":
    case "tool_use":
      return "tool_calls";
    case "content_filter":
    case "safety":
    case "recitation":
      return "content_filter";
    default:
      return "stop";
  }
}

function translateCanonicalEventsToChat(
  upstreamBody: ReadableStream<Uint8Array>,
  protocol: Exclude<RelayResponseProtocol, "openai-response">,
  request: CanonicalRequest
): Response {
  const reader = upstreamBody.getReader();
  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: Record<string, JsonValue>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      const id = `chatcmpl_${randomUUID().replaceAll("-", "")}`;
      const created = Math.floor(Date.now() / 1000);
      let model = request.model;
      let finishReason: string | undefined;
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedInputTokens = 0;
      let cacheWriteInputTokens = 0;
      send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
      try {
        await consumeSse(reader, (data) => {
          if (data === "[DONE]") return;
          let value: unknown;
          try {
            value = JSON.parse(data);
          } catch {
            throw new Error(`Upstream ${protocol} emitted invalid SSE JSON`);
          }
          const events = protocol === "openai"
            ? chatChunkToCanonicalEvents(value, request.tools)
            : protocol === "anthropic"
              ? anthropicChunkToCanonicalEvents(value, undefined)
              : geminiChunkToCanonicalEvents(value);
          for (const event of events) {
            if (event.type === "metadata") {
              if (event.model) model = event.model;
              if (event.finishReason) finishReason = event.finishReason;
              if (event.inputTokens != null) inputTokens = event.inputTokens;
              if (event.outputTokens != null) outputTokens = event.outputTokens;
              if (event.cachedInputTokens != null) cachedInputTokens = event.cachedInputTokens;
              if (event.cacheWriteInputTokens != null) cacheWriteInputTokens = event.cacheWriteInputTokens;
            } else if (event.type === "text_delta") {
              send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: event.delta }, finish_reason: null }] });
            } else if (event.type === "reasoning_delta") {
              send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { reasoning_content: event.delta }, finish_reason: null }] });
            } else if (event.type === "tool_start") {
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{
                  index: 0,
                  delta: { tool_calls: [{ index: event.index, id: event.id ?? `call_${randomUUID().replaceAll("-", "")}`, type: "function", function: { name: event.name ?? "", arguments: "" } }] },
                  finish_reason: null
                }]
              });
            } else if (event.type === "tool_arguments_delta") {
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{
                  index: 0,
                  delta: { tool_calls: [{ index: event.index, function: { arguments: event.delta } }] },
                  finish_reason: null
                }]
              });
            } else if (event.type === "error") {
              throw new Error(event.message);
            }
          }
        });
        if (!cancelled) {
          send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: chatFinishReasonToChat(finishReason) }] });
          if (inputTokens > 0 || outputTokens > 0 || cachedInputTokens > 0 || cacheWriteInputTokens > 0) {
            const promptTokens = inputTokens + cachedInputTokens + cacheWriteInputTokens;
            send({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [],
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: outputTokens,
                total_tokens: promptTokens + outputTokens,
                prompt_tokens_details: { cached_tokens: cachedInputTokens }
              }
            });
          }
          if (!closed) {
            closed = true;
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }
        }
      } catch {
        if (!closed && !cancelled) {
          closed = true;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: "Upstream relay stream failed", type: "upstream_error" } })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      }
    },
    async cancel(reason) {
      cancelled = true;
      await reader.cancel(reason).catch(() => undefined);
    }
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    }
  });
}

function chatEventStreamFromResult(result: CanonicalResult): Response {
  const encoder = new TextEncoder();
  const complete = canonicalResultToChat(result);
  const roleChunk = {
    ...complete,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]
  };
  const contentChunk = {
    ...complete,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { ...(result.text ? { content: result.text } : {}), ...(result.reasoning ? { reasoning_content: result.reasoning } : {}) }, finish_reason: null }]
  };
  const toolChunks = result.toolCalls.map((call) => ({
    ...complete,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] }, finish_reason: null }]
  }));
  const finalChunk = {
    ...complete,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: complete.finish_reason }]
  };
  const usageChunk = { ...complete, object: "chat.completion.chunk", choices: [] };
  const frames = [
    `data: ${JSON.stringify(roleChunk)}\n\n`,
    result.text || result.reasoning ? `data: ${JSON.stringify(contentChunk)}\n\n` : "",
    ...toolChunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    `data: ${JSON.stringify(finalChunk)}\n\n`,
    `data: ${JSON.stringify(usageChunk)}\n\n`,
    "data: [DONE]\n\n"
  ];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    }
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    }
  });
}

function translateNativeEventStream(
  upstreamBody: ReadableStream<Uint8Array>,
  protocol: Exclude<RelayResponseProtocol, "openai-response">,
  request: CanonicalRequest
): Response {
  const reader = upstreamBody.getReader();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writer = new ResponsesStreamWriter(controller, request.model, request.tools);
      writer.start();
      try {
        await consumeSse(reader, (data, eventName) => {
          if (data === "[DONE]") return;
          let value: unknown;
          try {
            value = JSON.parse(data);
          } catch {
            throw new Error(`Upstream ${protocol} emitted invalid SSE JSON`);
          }
          const events = protocol === "openai"
            ? chatChunkToCanonicalEvents(value, request.tools)
            : protocol === "anthropic"
              ? anthropicChunkToCanonicalEvents(value, eventName)
              : geminiChunkToCanonicalEvents(value);
          for (const event of events) writer.accept(event);
        });
        if (!cancelled) writer.complete();
      } catch (error) {
        if (!cancelled) writer.fail(errorMessage(error));
      }
    },
    async cancel(reason) {
      cancelled = true;
      await reader.cancel(reason).catch(() => undefined);
    }
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}

async function consumeSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (data: string, eventName?: string) => boolean | void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
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
}

async function runAnthropicCanonicalStream(input: {
  originalRequest: Request;
  provider: ProviderConfig;
  group: ChannelGroupConfig;
  apiKey: string;
  protocol: RelayResponseProtocol;
  request: CanonicalRequest;
}): Promise<Response> {
  let freebuffSession: FreebuffSessionInfo | null = null;
  let freebuffRunId: string | null = null;
  if (isFreebuffGroup(input.group, input.provider)) {
    try {
      const forceSwitch = input.originalRequest?.headers?.get("x-freebuff-force-switch") === "true";
      freebuffSession = await getOrEnsureFreebuffSession(input.request.model, input.apiKey, { forceSwitch });
      freebuffRunId = await createFreebuffRunId(freebuffSession.agentId, freebuffSession.token);
    } catch (err) {
      return markUpstreamFailure(errorResponse(400, errorMessage(err)), 400);
    }
  }
  const endpoint = resolveProtocolStreamEndpoint(input.provider, input.group, input.protocol === "openai-response" ? "openai" : input.protocol, input.request.model);
  const payload = input.protocol === "openai-response" ? canonicalToResponsesRequest(input.request, { allowPromptCacheKey: responsesPromptCacheAllowed(input.group), assistantTextType: isOpenCodeGroup(input.group) ? "output_text" : "input_text" }) : input.protocol === "openai" ? canonicalToChat(input.request, { freeOllama: input.provider.id === "free-ollama", allowPromptCacheKey: chatPromptCacheAllowed(input.provider, input.group), freebuffSession, freebuffRunId }) : input.protocol === "gemini" ? canonicalToGemini(input.request) : canonicalToAnthropic(input.request);
  if (isOpenCodeGroup(input.group)) {
    sanitizeOpenCodePayload(payload as Record<string, unknown>, input.request.model, undefined, { group: input.group, apiKey: input.apiKey, sourceHeaders: input.originalRequest.headers, protocol: input.protocol });
  }
  if (input.protocol !== "gemini") payload.stream = true;
  if (input.protocol === "openai") payload.stream_options = { include_usage: true };
  if (input.protocol === "openai-response") {
    const responseEndpoint = resolveProtocolEndpoint(input.provider, input.group, "openai-response", input.request.model);
    const upstream = await fetchUpstreamWithHeadersTimeout(responseEndpoint, { method: "POST", headers: upstreamHeaders("openai-response", input.group, input.apiKey, true, input.originalRequest.headers.get("user-agent"), undefined, undefined, input.originalRequest.headers, input.request.model, payload), body: JSON.stringify(payload), signal: input.originalRequest.signal }).catch(() => null);
    if (!upstream) return markUpstreamFailure(errorResponse(502, "Upstream openai-response request failed"), 502);
    if (!upstream.ok || !upstream.body) {
      if (isOpenCodeGroup(input.group) && (upstream.status === 429 || upstream.status === 400)) {
        rotateOpenCodeSession();
      }
      return markUpstreamFailure(errorResponse(upstream.status, upstreamErrorMessage(await upstream.text().catch(() => ""), "openai-response"), relayResponseHeaders(upstream.headers)), upstream.status);
    }
    return translateCanonicalEventsToAnthropic(upstream.body, "openai-response", input.request.model, input.originalRequest.signal, input.request.tools);
  }
  let upstream = await fetchUpstreamWithHeadersTimeout(withProtocolQueryAuth(endpoint, input.protocol, input.group.authType, freebuffSession?.token || input.apiKey), { method: "POST", headers: upstreamHeaders(input.protocol, input.group, input.apiKey, true, input.originalRequest.headers.get("user-agent"), null, freebuffSession, input.originalRequest.headers, input.request.model, payload), body: JSON.stringify(payload), signal: input.originalRequest.signal }).catch(() => null);
  if (!upstream) return markUpstreamFailure(errorResponse(502, `Upstream ${input.protocol} request failed`), 502);
  if (!upstream.ok || !upstream.body) {
    if (freebuffSession && (upstream.status === 409 || upstream.status === 410 || upstream.status === 428 || upstream.status === 401 || upstream.status === 403)) {
      clearFreebuffSession(input.request.model);
      try {
        const freshSession = await getOrEnsureFreebuffSession(input.request.model, input.apiKey);
        const freshRunId = await createFreebuffRunId(freshSession.agentId, freshSession.token);
        const retryPayload = canonicalToChat(input.request, {
          freeOllama: input.provider.id === "free-ollama",
          allowPromptCacheKey: chatPromptCacheAllowed(input.provider, input.group),
          freebuffSession: freshSession,
          freebuffRunId: freshRunId
        });
        retryPayload.stream = true;
        if (input.protocol === "openai") retryPayload.stream_options = { include_usage: true };
        const retryRes = await fetchUpstreamWithHeadersTimeout(withProtocolQueryAuth(endpoint, input.protocol, input.group.authType, freshSession.token), { method: "POST", headers: upstreamHeaders(input.protocol, input.group, input.apiKey, true, input.originalRequest.headers.get("user-agent"), null, freshSession, input.originalRequest.headers, input.request.model, retryPayload), body: JSON.stringify(retryPayload), signal: input.originalRequest.signal }).catch(() => null);
        if (retryRes && retryRes.ok && retryRes.body) {
          upstream = retryRes;
        }
      } catch {
        // Fall through
      }
    }
    if (!upstream.ok || !upstream.body) {
      if (isOpenCodeGroup(input.group) && (upstream.status === 429 || upstream.status === 400)) {
        rotateOpenCodeSession();
      }
      return markUpstreamFailure(errorResponse(upstream.status, upstreamErrorMessage(await upstream.text().catch(() => ""), input.protocol), relayResponseHeaders(upstream.headers)), upstream.status);
    }
  }
  return translateCanonicalEventsToAnthropic(upstream.body, input.protocol, input.request.model, input.originalRequest.signal, input.request.tools);
}

function translateCanonicalEventsToAnthropic(upstreamBody: ReadableStream<Uint8Array>, protocol: RelayResponseProtocol, model: string, signal: AbortSignal, tools: CanonicalTool[] = []): Response {
  const reader = upstreamBody.getReader();
  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (type: string, payload: Record<string, unknown>) => controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`));
      const blockTypes = new Map<number, "text" | "thinking" | "tool_use">();
      const toolBlocks = new Map<number, { id?: string; name?: string; arguments: string }>();
      const closedBlocks = new Set<number>();
      let nextBlockIndex = 0;
      let activeBlock: number | undefined;
      let textBlock: number | undefined;
      let thinkingBlock: number | undefined;
      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason: string | undefined;
      // Prompt-cache accounting (Anthropic cache_read_input_tokens /
      // cache_creation_input_tokens) reaches us from the upstream as part of the
      // terminal usage. The metadata event carries it through; without capturing
      // it here the translated message_delta would report zero cache usage even
      // though the upstream served (or wrote) a cache. Direct passthrough is
      // byte-faithful, so this only matters on the translate path.
      let cachedInputTokens = 0;
      let cacheWriteInputTokens = 0;
      let failed = false;
      const closeBlock = (index: number | undefined) => {
        if (index == null || closedBlocks.has(index)) return;
        emit("content_block_stop", { index });
        closedBlocks.add(index);
        if (activeBlock === index) activeBlock = undefined;
      };
      const startBlock = (type: "text" | "thinking" | "tool_use", content: Record<string, unknown>): number => {
        closeBlock(activeBlock);
        const index = nextBlockIndex++;
        blockTypes.set(index, type);
        emit("content_block_start", { index, content_block: { type, ...content } });
        activeBlock = index;
        return index;
      };
      emit("message_start", { message: { id: `msg_${randomUUID().replaceAll("-", "")}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
      try {
        await consumeSse(reader, (data, eventName) => {
          if (data === "[DONE]") return true;
          const parsed = (() => { try { return JSON.parse(data); } catch { return {}; } })();
          const events = protocol === "openai" ? chatChunkToCanonicalEvents(parsed, tools) : protocol === "anthropic" ? anthropicChunkToCanonicalEvents(parsed, eventName) : protocol === "gemini" ? geminiChunkToCanonicalEvents(parsed) : responsesChunkToCanonicalEvents(parsed, tools);
          for (const event of events) {
            if (event.type === "text_delta") {
              if (textBlock == null || closedBlocks.has(textBlock)) textBlock = startBlock("text", { text: "" });
              emit("content_block_delta", { index: textBlock, delta: { type: "text_delta", text: event.delta } });
            } else if (event.type === "reasoning_delta") {
              if (thinkingBlock == null || closedBlocks.has(thinkingBlock)) thinkingBlock = startBlock("thinking", { thinking: "", signature: "" });
              emit("content_block_delta", { index: thinkingBlock, delta: { type: "thinking_delta", thinking: event.delta } });
            } else if (event.type === "tool_start") {
              const tool = toolBlocks.get(event.index) ?? { arguments: "" };
              tool.id = event.id ?? tool.id;
              tool.name = event.name ?? tool.name;
              toolBlocks.set(event.index, tool);
            } else if (event.type === "tool_arguments_delta") {
              const tool = toolBlocks.get(event.index) ?? { arguments: "" };
              tool.id = event.id ?? tool.id;
              tool.name = event.name ?? tool.name;
              tool.arguments += event.delta;
              toolBlocks.set(event.index, tool);
            } else if (event.type === "metadata") {
              inputTokens = event.inputTokens ?? inputTokens;
              outputTokens = event.outputTokens ?? outputTokens;
              cachedInputTokens = event.cachedInputTokens ?? cachedInputTokens;
              cacheWriteInputTokens = event.cacheWriteInputTokens ?? cacheWriteInputTokens;
              finishReason = event.finishReason ?? finishReason;
            } else if (event.type === "error") {
              failed = true;
              emit("error", { error: { type: "api_error", message: event.message } });
              return true;
            }
          }
          return false;
        });
        if (!failed) {
          closeBlock(activeBlock);
          for (const tool of toolBlocks.values()) {
            const index = startBlock("tool_use", { id: tool.id ?? `toolu_${randomUUID().replaceAll("-", "")}`, name: tool.name ?? "tool", input: {} });
            if (tool.arguments) emit("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: tool.arguments } });
            closeBlock(index);
          }
          emit("message_delta", { delta: { stop_reason: anthropicStopReason(finishReason, toolBlocks.size > 0), stop_sequence: null }, usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: cachedInputTokens, cache_creation_input_tokens: cacheWriteInputTokens } });
          emit("message_stop", {});
        }
        if (!cancelled) controller.close();
      } catch (error) { if (!cancelled) controller.error(error); }
    },
    async cancel(reason) { cancelled = true; await reader.cancel(reason).catch(() => undefined); }
  });
  signal.addEventListener("abort", () => reader.cancel("aborted").catch(() => undefined), { once: true });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" } });
}

function responsesChunkToCanonicalEvents(value: unknown, tools: CanonicalTool[] = []): CanonicalStreamEvent[] {
  const record = asRecord(value);
  const type = stringValue(record.type);
  if (type === "response.output_text.delta") return [{ type: "text_delta", delta: stringValue(record.delta) ?? "" }];
  if (type === "response.reasoning_summary_text.delta") return [{ type: "reasoning_delta", delta: stringValue(record.delta) ?? "" }];
  if (type === "response.function_call_arguments.delta") return [{ type: "tool_arguments_delta", index: finiteNumber(record.output_index) ?? 0, id: nonEmptyStringValue(record.item_id), delta: stringValue(record.delta) ?? "" }];
  if (type === "response.output_item.added" || type === "response.output_item.done") {
    const item = asRecord(record.item);
    const itemType = stringValue(item.type);
    return itemType === "function_call" || itemType === "custom_tool_call"
      ? [{ type: "tool_start", index: finiteNumber(record.output_index) ?? 0, id: nonEmptyStringValue(item.call_id) ?? nonEmptyStringValue(item.id), name: responseFunctionCallName(item) ?? (tools.length === 1 ? tools[0]?.name : undefined) }]
      : [];
  }
  if (type === "response.completed" || type === "response.incomplete") {
    const response = asRecord(record.response);
    const usage = asRecord(response.usage);
    const events: CanonicalStreamEvent[] = [];
    for (const [index, rawItem] of (Array.isArray(response.output) ? response.output : []).entries()) {
      const item = asRecord(rawItem);
      const itemType = stringValue(item.type);
      if (itemType === "function_call" || itemType === "custom_tool_call") {
        events.push({ type: "tool_start", index, id: nonEmptyStringValue(item.call_id) ?? nonEmptyStringValue(item.id), name: responseFunctionCallName(item) ?? (tools.length === 1 ? tools[0]?.name : undefined) });
      }
    }
    events.push({
      type: "metadata",
      model: stringValue(response.model),
      inputTokens: finiteNumber(usage.input_tokens),
      outputTokens: finiteNumber(usage.output_tokens),
      cachedInputTokens: finiteNumber(asRecord(usage.input_tokens_details).cached_tokens),
      cacheWriteInputTokens: finiteNumber(asRecord(usage.input_tokens_details).cache_write_tokens),
      finishReason: stringValue(response.status)
    });
    return events;
  }
  if (type === "response.failed") {
    const response = asRecord(record.response);
    return [{ type: "error", message: stringValue(asRecord(response.error).message) ?? "Responses upstream failed" }];
  }
  return [];
}

function nonEmptyStringValue(value: unknown): string | undefined {
  const text = stringValue(value)?.trim();
  return text ? text : undefined;
}

function responseFunctionCallName(item: Record<string, unknown>): string | undefined {
  return nonEmptyStringValue(item.name)
    ?? nonEmptyStringValue(asRecord(item.function).name)
    ?? nonEmptyStringValue(item.tool_name)
    ?? nonEmptyStringValue(item.toolName);
}

function anthropicStopReason(finishReason: string | undefined, hasTools: boolean): string {
  if (hasTools) return "tool_use";
  if (finishReason === "length" || finishReason === "max_tokens" || finishReason === "incomplete") return "max_tokens";
  return "end_turn";
}

function dispatchSseFrame(frame: string, onEvent: (data: string, eventName?: string) => boolean | void): boolean {
  let eventName: string | undefined;
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? onEvent(data.join("\n"), eventName) === true : false;
}

function resolveCanonicalToolName(rawName: string | undefined, tools: CanonicalTool[]): string | undefined {
  if (!rawName) return tools.length === 1 ? tools[0]?.name : undefined;
  if (rawName === "sa_vm_run") {
    const mcp = tools.find((t) => t.name === "mcp__sa_vm__sa_vm_run" || t.name === "mcp__sa-vm__sa_vm_run");
    if (mcp) return mcp.name;
  }
  if (tools.some((t) => t.name === rawName)) return rawName;
  const mcpCandidate = tools.find((t) =>
    t.name === `mcp__sa_vm__${rawName}` ||
    t.name === `mcp__sa-vm__${rawName}` ||
    t.name.endsWith(`__${rawName}`)
  );
  return mcpCandidate ? mcpCandidate.name : rawName;
}

function chatChunkToCanonicalEvents(value: unknown, tools: CanonicalTool[] = []): CanonicalStreamEvent[] {
  let record = asRecord(value);
  if (record.success === true && record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    record = asRecord(record.data);
  }
  if (record.error) return [{ type: "error", message: upstreamErrorMessage(JSON.stringify(record), "openai") }];
  const choice = asRecord(Array.isArray(record.choices) ? record.choices[0] : undefined);
  const delta = asRecord(choice.delta);
  const events: CanonicalStreamEvent[] = [];
  const model = stringValue(record.model);
  const usage = asRecord(record.usage);
  if (model || Object.keys(usage).length > 0 || choice.finish_reason) {
    events.push({
      type: "metadata",
      model,
      inputTokens: finiteNumber(usage.prompt_tokens),
      outputTokens: finiteNumber(usage.completion_tokens),
      cachedInputTokens: finiteNumber(asRecord(usage.prompt_tokens_details).cached_tokens),
      cacheWriteInputTokens: finiteNumber(asRecord(usage.prompt_tokens_details).cache_write_tokens),
      finishReason: stringValue(choice.finish_reason)
    });
  }
  const text = contentValueToText(delta.content);
  if (text) events.push({ type: "text_delta", delta: text });
  const reasoning = stringValue(delta.reasoning_content) ?? stringValue(delta.reasoning);
  if (reasoning) events.push({ type: "reasoning_delta", delta: reasoning });
  for (const rawCall of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
    const call = asRecord(rawCall);
    const fn = asRecord(call.function);
    const index = finiteNumber(call.index) ?? 0;
    const id = stringValue(call.id);
    const rawName = nonEmptyStringValue(fn.name) ?? (tools.length === 1 ? tools[0]?.name : undefined);
    const name = resolveCanonicalToolName(rawName, tools);
    if (id || name) events.push({ type: "tool_start", index, id, name });
    const argumentsDelta = stringValue(fn.arguments);
    if (argumentsDelta) events.push({ type: "tool_arguments_delta", index, id, name, delta: argumentsDelta });
  }
  return events;
}

function anthropicChunkToCanonicalEvents(value: unknown, eventName?: string): CanonicalStreamEvent[] {
  const record = asRecord(value);
  const type = stringValue(record.type) ?? eventName;
  if (type === "error") return [{ type: "error", message: upstreamErrorMessage(JSON.stringify(record), "anthropic") }];
  if (type === "message_start") {
    const message = asRecord(record.message);
    const usage = asRecord(message.usage);
    return [{
      type: "metadata",
      model: stringValue(message.model),
      inputTokens: finiteNumber(usage.input_tokens),
      outputTokens: finiteNumber(usage.output_tokens),
      cachedInputTokens: finiteNumber(usage.cache_read_input_tokens),
      cacheWriteInputTokens: finiteNumber(usage.cache_creation_input_tokens)
    }];
  }
  if (type === "message_delta") {
    const usage = asRecord(record.usage);
    return [{
      type: "metadata",
      outputTokens: finiteNumber(usage.output_tokens),
      finishReason: stringValue(asRecord(record.delta).stop_reason)
    }];
  }
  const index = finiteNumber(record.index) ?? 0;
  if (type === "content_block_start") {
    const block = asRecord(record.content_block);
    if (block.type === "tool_use") {
      return [{ type: "tool_start", index, id: stringValue(block.id), name: stringValue(block.name) }];
    }
    const text = stringValue(block.text) ?? stringValue(block.thinking);
    return text ? [{ type: block.type === "thinking" ? "reasoning_delta" : "text_delta", delta: text }] : [];
  }
  if (type === "content_block_delta") {
    const delta = asRecord(record.delta);
    const deltaType = stringValue(delta.type);
    const text = stringValue(delta.text);
    if (text) return [{ type: "text_delta", delta: text }];
    const thinking = stringValue(delta.thinking);
    if (thinking) return [{ type: "reasoning_delta", delta: thinking }];
    const partialJson = stringValue(delta.partial_json);
    if (partialJson) return [{ type: "tool_arguments_delta", index, delta: partialJson }];
    if (deltaType === "input_json_delta") return [];
  }
  return [];
}

function geminiChunkToCanonicalEvents(value: unknown): CanonicalStreamEvent[] {
  const record = asRecord(value);
  if (record.error) return [{ type: "error", message: upstreamErrorMessage(JSON.stringify(record), "gemini") }];
  const candidate = asRecord(Array.isArray(record.candidates) ? record.candidates[0] : undefined);
  const safetyError = geminiSafetyError(record, candidate);
  if (safetyError) return [{ type: "error", message: safetyError }];
  const parts = Array.isArray(asRecord(candidate.content).parts) ? (asRecord(candidate.content).parts as unknown[]).map(asRecord) : [];
  const events: CanonicalStreamEvent[] = [];
  for (const [index, part] of parts.entries()) {
    const text = stringValue(part.text);
    if (text) events.push({ type: part.thought === true ? "reasoning_delta" : "text_delta", delta: text });
    if (part.functionCall) {
      const call = asRecord(part.functionCall);
      const id = stringValue(call.id);
      const name = stringValue(call.name);
      events.push({ type: "tool_start", index, id, name });
      events.push({ type: "tool_arguments_delta", index, id, name, delta: JSON.stringify(call.args ?? {}) });
    }
  }
  const usage = asRecord(record.usageMetadata);
  if (stringValue(record.modelVersion) || Object.keys(usage).length > 0 || candidate.finishReason) {
    events.push({
      type: "metadata",
      model: stringValue(record.modelVersion),
      inputTokens: finiteNumber(usage.promptTokenCount),
      outputTokens: finiteNumber(usage.candidatesTokenCount),
      cachedInputTokens: finiteNumber(usage.cachedContentTokenCount),
      finishReason: stringValue(candidate.finishReason)
    });
  }
  return events;
}

function prepareResponsesRequestForRelay(record: Record<string, unknown>): PreparedResponsesRequest {
  const compatibility = buildRelayToolCompatibility(responsesRequestTools(record));
  const body: Record<string, unknown> = { ...record };
  if (Array.isArray(record.tools)) {
    body.tools = flattenResponsesTools(record.tools, compatibility);
  }
  if (Array.isArray(record.input)) {
    body.input = record.input.map((value) => prepareResponsesInputItem(value, compatibility));
  }
  if (record.tool_choice && typeof record.tool_choice === "object" && !Array.isArray(record.tool_choice)) {
    body.tool_choice = prepareResponsesToolChoice(record.tool_choice as Record<string, unknown>, compatibility);
  }
  return { body, tools: compatibility };
}

function buildRelayToolCompatibility(tools: unknown[]): RelayToolCompatibility {
  const seeds = new Map<string, Omit<RelayToolIdentity, "transportName">>();
  for (const value of tools) {
    const tool = asRecord(value);
    if (stringValue(tool.type) === "namespace") {
      const namespace = stringValue(tool.name) ?? stringValue(tool.namespace);
      if (!namespace || !Array.isArray(tool.tools)) continue;
      for (const memberValue of tool.tools) {
        const name = responsesToolName(memberValue);
        if (name) seeds.set(relayToolSourceKey(namespace, name), { namespace, name });
      }
      continue;
    }
    const name = responsesToolName(tool);
    if (name) seeds.set(relayToolSourceKey(undefined, name), { name });
  }

  const nameCounts = new Map<string, number>();
  for (const seed of seeds.values()) nameCounts.set(seed.name, (nameCounts.get(seed.name) ?? 0) + 1);
  const usedTransportNames = new Set<string>();
  const identities: RelayToolIdentity[] = [];
  for (const seed of seeds.values()) {
    const baseName = seed.namespace && (nameCounts.get(seed.name) ?? 0) > 1
      ? `${seed.namespace}__${seed.name}`
      : seed.name;
    let transportName = baseName;
    let suffix = 2;
    while (usedTransportNames.has(transportName)) {
      transportName = `${baseName}__${suffix++}`;
    }
    usedTransportNames.add(transportName);
    identities.push({ ...seed, transportName });
  }

  const bySource = new Map<string, RelayToolIdentity>();
  const byTransportName = new Map<string, RelayToolIdentity>();
  const responseNameCandidates = new Map<string, RelayToolIdentity[]>();
  for (const identity of identities) {
    bySource.set(relayToolSourceKey(identity.namespace, identity.name), identity);
    byTransportName.set(identity.transportName, identity);
    if (identity.namespace) {
      const candidates = responseNameCandidates.get(identity.name) ?? [];
      candidates.push(identity);
      responseNameCandidates.set(identity.name, candidates);
    }
  }
  const byUniqueResponseName = new Map<string, RelayToolIdentity>();
  for (const [name, candidates] of responseNameCandidates) {
    if (candidates.length === 1) byUniqueResponseName.set(name, candidates[0]!);
  }
  return { bySource, byTransportName, byUniqueResponseName };
}

function flattenResponsesTools(tools: unknown[], compatibility: RelayToolCompatibility): unknown[] {
  const flattened: unknown[] = [];
  for (const value of tools) {
    const tool = asRecord(value);
    if (stringValue(tool.type) !== "namespace") {
      flattened.push(value);
      continue;
    }
    const namespace = stringValue(tool.name) ?? stringValue(tool.namespace);
    if (!namespace || !Array.isArray(tool.tools)) continue;
    for (const memberValue of tool.tools) {
      const name = responsesToolName(memberValue);
      const identity = name ? compatibility.bySource.get(relayToolSourceKey(namespace, name)) : undefined;
      if (identity) flattened.push(rewriteResponsesToolName(memberValue, identity.transportName));
    }
  }
  return flattened;
}

function prepareResponsesInputItem(value: unknown, compatibility: RelayToolCompatibility): unknown {
  const item = asRecord(value);
  if (Object.keys(item).length === 0) return value;
  if (item.type === "additional_tools" && Array.isArray(item.tools)) {
    return { ...item, tools: flattenResponsesTools(item.tools, compatibility) };
  }
  if (item.type !== "function_call" && item.type !== "custom_tool_call") return value;
  const name = stringValue(item.name);
  if (!name) return value;
  const namespace = stringValue(item.namespace);
  const identity = resolveRelayToolIdentity(name, namespace, compatibility);
  if (!identity) return value;
  const prepared: Record<string, unknown> = { ...item, name: identity.transportName };
  delete prepared.namespace;
  return prepared;
}

function prepareResponsesToolChoice(
  value: Record<string, unknown>,
  compatibility: RelayToolCompatibility
): Record<string, unknown> {
  const name = stringValue(value.name) ?? stringValue(asRecord(value.function).name);
  if (!name) return value;
  const identity = resolveRelayToolIdentity(name, stringValue(value.namespace), compatibility);
  if (!identity) return value;
  const prepared: Record<string, unknown> = { ...value };
  if (typeof value.name === "string") prepared.name = identity.transportName;
  if (value.function && typeof value.function === "object" && !Array.isArray(value.function)) {
    prepared.function = { ...(value.function as Record<string, unknown>), name: identity.transportName };
  }
  delete prepared.namespace;
  return prepared;
}

function rewriteResponsesToolName(value: unknown, name: string): Record<string, unknown> {
  const tool = asRecord(value);
  if (tool.function && typeof tool.function === "object" && !Array.isArray(tool.function)) {
    return { ...tool, function: { ...(tool.function as Record<string, unknown>), name } };
  }
  return { ...tool, name };
}

function responsesToolName(value: unknown): string | undefined {
  const tool = asRecord(value);
  return stringValue(tool.name) ?? stringValue(asRecord(tool.function).name);
}

function relayToolSourceKey(namespace: string | undefined, name: string): string {
  return `${namespace ?? ""}\u0000${name}`;
}

function resolveRelayToolIdentity(
  name: string,
  namespace: string | undefined,
  compatibility: RelayToolCompatibility
): RelayToolIdentity | undefined {
  if (namespace) {
    return compatibility.bySource.get(relayToolSourceKey(namespace, name));
  }
  return compatibility.byTransportName.get(name) ?? compatibility.byUniqueResponseName.get(name);
}

function normalizeRelayResponsePayload(value: unknown, compatibility: RelayToolCompatibility): unknown {
  const normalized = normalizeCustomToolInputs(value);
  return restoreRelayToolNamespaces(normalized, compatibility);
}

function restoreRelayToolNamespaces(value: unknown, compatibility: RelayToolCompatibility): unknown {
  if (Array.isArray(value)) return value.map((entry) => restoreRelayToolNamespaces(entry, compatibility));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const restored = Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, restoreRelayToolNamespaces(entry, compatibility)])
  );
  if (restored.type !== "function_call" && restored.type !== "custom_tool_call") return restored;
  const name = stringValue(restored.name);
  if (!name) return restored;
  if (name === "sa_vm_run") {
    for (const key of compatibility.byTransportName.keys()) {
      if (key === "mcp__sa_vm__sa_vm_run" || key === "mcp__sa-vm__sa_vm_run") {
        restored.name = key;
        break;
      }
    }
  } else if (!compatibility.byTransportName.has(name)) {
    for (const key of compatibility.byTransportName.keys()) {
      if (key === `mcp__sa_vm__${name}` || key === `mcp__sa-vm__${name}` || key.endsWith(`__${name}`)) {
        restored.name = key;
        break;
      }
    }
  }
  if (typeof restored.namespace === "string") return restored;
  const currentName = stringValue(restored.name) ?? name;
  const identity = resolveRelayToolIdentity(currentName, undefined, compatibility);
  if (!identity?.namespace) return restored;
  restored.name = identity.name;
  restored.namespace = identity.namespace;
  return restored;
}

function responsesRequestToCanonical(
  record: Record<string, unknown>,
  model: string,
  compatibility: RelayToolCompatibility
): CanonicalRequest {
  const reasoning = asRecord(record.reasoning);
  const messages: CanonicalMessage[] = [];
  const instructions = stringValue(record.instructions);
  const input = record.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: [{ type: "text", text: input }] });
  } else if (Array.isArray(input)) {
    for (const rawItem of input) appendResponsesInputItem(messages, asRecord(rawItem));
  }
  if (messages.length === 0) messages.push({ role: "user", content: [{ type: "text", text: "(empty request)" }] });
  const tools = responsesRequestTools(record)
    .map((value) => parseResponsesTool(value, compatibility))
    .filter((tool): tool is CanonicalTool => Boolean(tool));
  let systemCacheControl: JsonValue | undefined;
  for (const message of messages) {
    if (message.role !== "system") continue;
    for (let i = message.content.length - 1; i >= 0; i--) {
      const control = message.content[i]?.cacheControl;
      if (control) { systemCacheControl = control; break; }
    }
    systemCacheControl ??= message.cacheControl;
    if (systemCacheControl) break;
  }
  return {
    model,
    instructions,
    reasoningEffort: stringValue(reasoning.effort)
      ?? stringValue(record.reasoning_effort)
      ?? stringValue(record.reasoningEffort),
    reasoningSummary: stringValue(reasoning.summary),
    messages,
    tools,
    toolChoice: jsonValue(record.tool_choice),
    maxOutputTokens: finiteNumber(record.max_output_tokens),
    temperature: finiteNumber(record.temperature),
    topP: finiteNumber(record.top_p),
    ...(record.web_search === true ? { webSearch: true as const } : {}),
    ...(systemCacheControl ? { systemCacheControl } : {})
  };
}

function appendResponsesInputItem(messages: CanonicalMessage[], item: Record<string, unknown>): void {
  const type = stringValue(item.type);
  if (type === "additional_tools") return;
  if (type === "function_call" || type === "custom_tool_call") {
    const call: CanonicalToolCall = {
      id: stringValue(item.call_id) ?? stringValue(item.id) ?? randomUUID(),
      name: stringValue(item.name) ?? "tool",
      arguments: type === "custom_tool_call"
        ? JSON.stringify({ input: stringValue(item.input) ?? "" })
        : normalizedFunctionArguments(stringValue(item.arguments) ?? "")
    };
    const previous = messages.at(-1);
    if (previous?.role === "assistant") previous.toolCalls = [...(previous.toolCalls ?? []), call];
    else messages.push({ role: "assistant", content: [], toolCalls: [call] });
    return;
  }
  if (type === "function_call_output" || type === "custom_tool_call_output") {
    messages.push({
      role: "tool",
      toolCallId: stringValue(item.call_id) ?? "",
      content: parseContent(item.output ?? item.content)
    });
    return;
  }
  const role = messageRole(item.role);
  const messageCache = jsonValue(item.cache_control);
  messages.push({ role, content: parseContent(item.content), ...(messageCache ? { cacheControl: messageCache } : {}) });
}

function parseResponsesTool(value: unknown, compatibility: RelayToolCompatibility): CanonicalTool | null {
  const record = asRecord(value);
  const type = stringValue(record.type);
  const name = stringValue(record.name) ?? stringValue(asRecord(record.function).name);
  if (!name) return null;
  const description = stringValue(record.description) ?? stringValue(asRecord(record.function).description);
  const parameters = asRecord(record.parameters ?? asRecord(record.function).parameters);
  const custom = type === "custom";
  const identity = resolveRelayToolIdentity(name, undefined, compatibility);
  const toolCache = jsonValue(record.cache_control);
  return {
    name,
    responseName: identity?.name ?? name,
    namespace: identity?.namespace,
    description,
    inputSchema: custom
      ? { type: "object", properties: { input: { type: "string" } }, required: ["input"] }
      : Object.keys(parameters).length > 0 ? parameters as Record<string, JsonValue> : { type: "object", properties: {} },
    responseType: custom ? "custom_tool_call" : "function_call",
    ...(toolCache ? { cacheControl: toolCache } : {})
  };
}

function anthropicRequestToCanonical(record: Record<string, unknown>, model: string): CanonicalRequest {
  const messages: CanonicalMessage[] = [];
  const system = record.system;
  let instructions: string | undefined;
  let systemCacheControl: JsonValue | undefined;
  if (typeof system === "string") {
    instructions = system;
  } else if (Array.isArray(system)) {
    const blocks = system.map((value) => asRecord(value));
    instructions = blocks.map((part) => stringValue(part.text) ?? "").filter(Boolean).join("\n\n") || undefined;
    // Anthropic places cache_control on the trailing system block; carry it so the
    // breakpoint survives protocol translation (mirrors new-api MediaContent.CacheControl).
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const control = jsonValue(blocks[index]!.cache_control);
      if (control) { systemCacheControl = control; break; }
    }
  }
  for (const rawMessage of Array.isArray(record.messages) ? record.messages : []) {
    const message = asRecord(rawMessage);
    const role = messageRole(message.role);
    const content = Array.isArray(message.content) ? message.content : [{ type: "text", text: String(message.content ?? "") }];
    const parts: CanonicalContentPart[] = [];
    const toolCalls: CanonicalToolCall[] = [];
    for (const rawPart of content) {
      const part = asRecord(rawPart);
      const type = stringValue(part.type);
      const blockCache = jsonValue(part.cache_control);
      if (type === "text" || type === "thinking") {
        const text = stringValue(part.text) ?? stringValue(part.thinking) ?? "";
        if (text) parts.push(blockCache ? { type: "text", text, cacheControl: blockCache } : { type: "text", text });
      } else if (type === "image" || type === "image_url") {
        const source = asRecord(part.source ?? part.image_url);
        const mediaType = stringValue(source.media_type) ?? stringValue(source.mime_type);
        const sourceData = stringValue(source.data);
        const url = stringValue(source.url) ?? stringValue(part.url) ?? (sourceData ? `data:${mediaType ?? "image/*"};base64,${sourceData}` : undefined);
        if (url) parts.push(blockCache ? { type: "image", url, mimeType: mediaType, cacheControl: blockCache } : { type: "image", url, mimeType: mediaType });
      } else if (type === "tool_use") {
        toolCalls.push({ id: stringValue(part.id) ?? randomUUID(), name: stringValue(part.name) ?? "tool", arguments: JSON.stringify(part.input ?? {}) });
      } else if (type === "tool_result") {
        messages.push({ role: "tool", toolCallId: stringValue(part.tool_use_id) ?? "", content: parseContent(part.content ?? "") });
      }
    }
    if (role !== "tool" && (parts.length > 0 || toolCalls.length > 0)) {
      messages.push({ role, content: parts, toolCalls: toolCalls.length > 0 ? toolCalls : undefined });
    }
  }
  if (messages.length === 0) messages.push({ role: "user", content: [{ type: "text", text: "(empty request)" }] });
  const tools = (Array.isArray(record.tools) ? record.tools : []).map((raw): CanonicalTool | null => {
    const tool = asRecord(raw);
    const name = stringValue(tool.name);
    if (!name) return null;
    const toolCache = jsonValue(tool.cache_control);
    return {
      name,
      responseName: name,
      description: stringValue(tool.description),
      inputSchema: asRecord(tool.input_schema) as Record<string, JsonValue>,
      responseType: "function_call" as const,
      ...(toolCache ? { cacheControl: toolCache } : {})
    };
  }).filter((tool): tool is CanonicalTool => Boolean(tool));
  const thinking = asRecord(record.thinking);
  const outputConfig = asRecord(record.output_config);
  return {
    model,
    instructions,
    reasoningEffort: stringValue(outputConfig.effort)
      ?? (thinking.type === "adaptive" ? "medium" : undefined)
      ?? anthropicBudgetToEffort(thinking),
    messages,
    tools,
    toolChoice: jsonValue(record.tool_choice),
    maxOutputTokens: finiteNumber(record.max_tokens),
    temperature: finiteNumber(record.temperature),
    topP: finiteNumber(record.top_p),
    ...(systemCacheControl ? { systemCacheControl } : {})
  };
}

function chatRequestToCanonical(record: Record<string, unknown>, model: string): CanonicalRequest {
  const messages: CanonicalMessage[] = [];
  let instructions: string | undefined;
  let systemCacheControl: JsonValue | undefined;
  for (const rawMessage of Array.isArray(record.messages) ? record.messages : []) {
    const message = asRecord(rawMessage);
    const role = messageRole(message.role);
    if (role === "system") {
      // System can be a string or an array of blocks; capture the trailing block's
      // cache_control so it survives translation (mirrors anthropicRequestToCanonical).
      const content = message.content;
      if (typeof content === "string") {
        instructions = instructions ? `${instructions}\n\n${content}` : content;
      } else if (Array.isArray(content)) {
        const blocks = content.map((value) => asRecord(value));
        const text = blocks.map((part) => stringValue(part.text) ?? "").filter(Boolean).join("\n\n");
        instructions = instructions ? `${instructions}\n\n${text}` : text;
        for (let index = blocks.length - 1; index >= 0; index -= 1) {
          const control = jsonValue(blocks[index]!.cache_control);
          if (control) { systemCacheControl = control; break; }
        }
      }
      continue;
    }
    if (role === "tool") {
      messages.push({ role: "tool", toolCallId: stringValue(message.tool_call_id) ?? "", content: parseContent(message.content ?? "") });
      continue;
    }
    const rawContent = Array.isArray(message.content) ? message.content : [{ type: "text", text: String(message.content ?? "") }];
    const parts: CanonicalContentPart[] = [];
    for (const rawPart of rawContent) {
      const part = asRecord(rawPart);
      const type = stringValue(part.type);
      const blockCache = jsonValue(part.cache_control);
      if (type === "text" || type === "input_text" || type === undefined) {
        const text = stringValue(part.text) ?? (blockCache ? "" : "");
        if (text) parts.push(blockCache ? { type: "text", text, cacheControl: blockCache } : { type: "text", text });
      } else if (type === "image_url" || type === "image") {
        const source = asRecord(part.image_url ?? part.image);
        const url = stringValue(source.url) ?? stringValue(part.url);
        if (url) parts.push(blockCache ? { type: "image", url, mimeType: stringValue(source.mime_type), cacheControl: blockCache } : { type: "image", url, mimeType: stringValue(source.mime_type) });
      }
    }
    const toolCalls = Array.isArray(message.tool_calls)
      ? (message.tool_calls as unknown[]).map((raw): CanonicalToolCall => {
        const call = asRecord(raw);
        const fn = asRecord(call.function);
        return { id: stringValue(call.id) ?? randomUUID(), name: stringValue(fn.name) ?? "tool", arguments: stringValue(fn.arguments) ?? "{}" };
      })
      : undefined;
    if (parts.length > 0 || toolCalls?.length) {
      messages.push({ role, content: parts, ...(toolCalls?.length ? { toolCalls } : {}) });
    }
  }
  if (messages.length === 0) messages.push({ role: "user", content: [{ type: "text", text: "(empty request)" }] });
  const tools = (Array.isArray(record.tools) ? record.tools : []).map((raw): CanonicalTool | null => {
    const tool = asRecord(raw);
    const fn = asRecord(tool.function ?? tool);
    const name = stringValue(fn.name);
    if (!name) return null;
    const toolCache = jsonValue(tool.cache_control) ?? jsonValue(fn.cache_control);
    return {
      name,
      responseName: name,
      description: stringValue(fn.description),
      inputSchema: asRecord(fn.parameters ?? fn.input_schema) as Record<string, JsonValue>,
      responseType: "function_call" as const,
      ...(toolCache ? { cacheControl: toolCache } : {})
    };
  }).filter((tool): tool is CanonicalTool => Boolean(tool));
  return {
    model,
    instructions,
    // Chat clients (incl. mini) send the Codex effort as top-level
    // `reasoning_effort`; Responses clients send `reasoning.effort`.
    // Accept both so selecting low/medium/high/xhigh/max/ultra never
    // silently becomes a plain chat upstream.
    reasoningEffort: stringValue(asRecord(record.reasoning).effort)
      ?? stringValue(record.reasoning_effort)
      ?? stringValue(record.reasoningEffort)
      ?? stringValue(record.effort),
    messages,
    tools,
    toolChoice: jsonValue(record.tool_choice),
    maxOutputTokens: finiteNumber(record.max_tokens),
    temperature: finiteNumber(record.temperature),
    topP: finiteNumber(record.top_p),
    ...(record.web_search === true ? { webSearch: true as const } : {}),
    ...(systemCacheControl ? { systemCacheControl } : {})
  };
}

/**
 * Effort levels the OpenAI Responses API accepts on `reasoning.effort`.
 * Anything else (`max`, `ultra`, …) is a 400 on strict upstreams
 * (e.g. opencode-go) — and a 400 triggers key-failover retries across every
 * configured key, which is what burns the first turn's 20s budget. Map the
 * known UI aliases down, drop the unknown instead of forwarding poison.
 */
const RESPONSES_EFFORT_LEVELS = new Set(["minimal", "low", "medium", "high", "xhigh"]);

export function sanitizeResponsesEffort(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "max" || normalized === "ultra") return "xhigh";
  return RESPONSES_EFFORT_LEVELS.has(normalized) ? normalized : undefined;
}

/**
 * Anthropic `thinking: { type: "enabled", budget_tokens }` carries depth as a
 * token budget instead of `output_config.effort`. Map it back onto the effort
 * scale (mirrors miniBridge budgets: 1024→low, 2048→medium, 4096→high, 8192→xhigh)
 * so the depth survives the canonical request.
 */
export function anthropicBudgetToEffort(thinking: Record<string, unknown>): string | undefined {
  if (thinking.type !== "enabled") return undefined;
  const budget = typeof thinking.budget_tokens === "number" ? thinking.budget_tokens : Number(thinking.budget_tokens);
  if (!Number.isFinite(budget) || budget <= 0) return undefined;
  if (budget <= 1024) return "low";
  if (budget <= 2048) return "medium";
  if (budget <= 4096) return "high";
  return "xhigh";
}

function canonicalToResponsesRequest(request: CanonicalRequest, options: { allowPromptCacheKey?: boolean; assistantTextType?: "output_text" | "input_text" } = {}): Record<string, JsonValue> {
  const input: JsonValue[] = [];
  // opencode-go is strict: assistant history must use `output_text`, otherwise 400.
  // Other OpenAI-compatible upstreams (new-api/DeepKey etc.) accept `input_text`
  // more widely — callers pass assistantTextType per channel, opencode stays strict.
  const assistantType = options.assistantTextType ?? "output_text";
  for (const message of request.messages) {
    const isAssistant = message.role === "assistant";
    const content = message.content.map((part): JsonValue => part.type === "text"
      ? (isAssistant
        ? (part.cacheControl ? { type: assistantType, text: part.text, cache_control: part.cacheControl } : { type: assistantType, text: part.text })
        : (part.cacheControl ? { type: "input_text", text: part.text, cache_control: part.cacheControl } : { type: "input_text", text: part.text }))
      : { type: "input_image", image_url: part.url });
    input.push({ role: isAssistant ? "assistant" : message.role === "system" ? "system" : "user", content, ...(message.cacheControl ? { cache_control: message.cacheControl } : {}) });
    for (const call of message.toolCalls ?? []) input.push({ type: "function_call", call_id: call.id, name: call.name, arguments: call.arguments });
    if (message.role === "tool") {
      // Tool outputs are text-only except image_view results: preserve attached
      // images as native input_image blocks so Responses upstreams actually
      // receive them (mirrors the Chat path, which reposts images as a
      // follow-up user message). Plain text outputs stay strings.
      const images = message.content.filter((part) => part.type === "image");
      if (images.length === 0) {
        input.push({ type: "function_call_output", call_id: message.toolCallId ?? "", output: contentText(message.content) });
      } else {
        const output: JsonValue[] = [];
        const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
        output.push({ type: "input_text", text: text || "[Image attached]" });
        for (const image of images) output.push({ type: "input_image", image_url: image.url, detail: "high" });
        input.push({ type: "function_call_output", call_id: message.toolCallId ?? "", output });
      }
    }
  }
  const body: Record<string, JsonValue> = { model: request.model, input, stream: false };
  if (request.instructions) {
    if (request.systemCacheControl) {
      // The Responses format has no cache_control field on `instructions`; carry the breakpoint
      // by prepending a system-role input item (mirrors how canonicalToAnthropic outputs it).
      input.unshift({ role: "system", content: [{ type: "input_text", text: request.instructions, cache_control: request.systemCacheControl }] });
    } else {
      body.instructions = request.instructions;
    }
  }
  if (request.maxOutputTokens != null) body.max_output_tokens = request.maxOutputTokens;
  if (request.temperature != null) body.temperature = request.temperature;
  if (request.topP != null) body.top_p = request.topP;
  const responsesEffort = sanitizeResponsesEffort(request.reasoningEffort);
  if (responsesEffort) body.reasoning = { effort: responsesEffort };
  if (request.tools.length > 0) {
    // Dedupe by transport name: repeated vm-tool definitions waste tokens and
    // trip strict upstreams with "check request parameters". Keep first seen.
    const seen = new Set<string>();
    const unique = request.tools.filter((tool) => {
      if (seen.has(tool.name)) return false;
      seen.add(tool.name);
      return true;
    });
    body.tools = unique.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema
    }));
  }
  if (options.allowPromptCacheKey && request.promptCacheKey) body.prompt_cache_key = request.promptCacheKey;
  return body;
}

function responsesResponseToCanonical(value: unknown, fallbackModel: string, tools: CanonicalTool[] = []): CanonicalResult {
  const record = asRecord(value);
  const toolCalls: CanonicalToolCall[] = [];
  let text = "";
  let reasoning = "";
  for (const raw of (Array.isArray(record.output) ? record.output : [])) {
    const item = asRecord(raw);
    const type = stringValue(item.type);
    if (type === "message") {
      for (const rawPart of Array.isArray(item.content) ? item.content : []) text += stringValue(asRecord(rawPart).text) ?? "";
    } else if (type === "reasoning") {
      for (const rawPart of Array.isArray(item.summary) ? item.summary : []) reasoning += stringValue(asRecord(rawPart).text) ?? "";
    } else if (type === "function_call" || type === "custom_tool_call") {
      toolCalls.push({ id: nonEmptyStringValue(item.call_id) ?? nonEmptyStringValue(item.id) ?? randomUUID(), name: responseFunctionCallName(item) ?? (tools.length === 1 ? tools[0]!.name : "tool"), arguments: type === "custom_tool_call" ? JSON.stringify({ input: stringValue(item.input) ?? "" }) : normalizedFunctionArguments(stringValue(item.arguments) ?? "") });
    }
  }
  const usage = asRecord(record.usage);
  return { model: stringValue(record.model) ?? fallbackModel, text, reasoning: reasoning || undefined, toolCalls, usage: { inputTokens: finiteNumber(usage.input_tokens) ?? 0, outputTokens: finiteNumber(usage.output_tokens) ?? 0, cachedInputTokens: finiteNumber(asRecord(usage.input_tokens_details).cached_tokens), cacheWriteInputTokens: finiteNumber(asRecord(usage.input_tokens_details).cache_write_tokens) }, finishReason: stringValue(record.status) };
}

function canonicalResultToAnthropic(result: CanonicalResult): Record<string, JsonValue> {
  const content: JsonValue[] = [];
  if (result.reasoning) content.push({ type: "thinking", thinking: result.reasoning, signature: "relay" });
  if (result.text) content.push({ type: "text", text: result.text });
  for (const call of result.toolCalls) content.push({ type: "tool_use", id: call.id, name: nonEmptyStringValue(call.name) ?? "tool", input: parseArguments(call.arguments) });
  const stopReason = result.toolCalls.length > 0 ? "tool_use" : result.finishReason === "length" || result.finishReason === "max_output_tokens" ? "max_tokens" : "end_turn";
  return { id: `msg_${randomUUID().replaceAll("-", "")}`, type: "message", role: "assistant", model: result.model, content, stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens, ...(result.usage.cachedInputTokens != null ? { cache_read_input_tokens: result.usage.cachedInputTokens } : {}), ...(result.usage.cacheWriteInputTokens != null ? { cache_creation_input_tokens: result.usage.cacheWriteInputTokens } : {}) } };
}

function findCanonicalTool(tools: CanonicalTool[], name: string | undefined): CanonicalTool | undefined {
  if (!name) return undefined;
  const transportMatch = tools.find((tool) => tool.name === name);
  if (transportMatch) return transportMatch;
  const responseMatches = tools.filter((tool) => tool.responseName === name);
  return responseMatches.length === 1 ? responseMatches[0] : undefined;
}

function responsesRequestTools(record: Record<string, unknown>): unknown[] {
  const tools = Array.isArray(record.tools) ? [...record.tools] : [];
  if (!Array.isArray(record.input)) return tools;
  for (const rawItem of record.input) {
    const item = asRecord(rawItem);
    if (item.type === "additional_tools" && Array.isArray(item.tools)) {
      tools.push(...item.tools);
    }
  }
  return tools;
}

function canonicalToChat(
  request: CanonicalRequest,
  options: {
    freeOllama?: boolean;
    allowPromptCacheKey?: boolean;
    freebuffSession?: FreebuffSessionInfo | null;
    freebuffRunId?: string | null;
  } = {}
): Record<string, JsonValue> {
  let instructions = request.instructions;
  if (options.freebuffSession && instructions) {
    if (!instructions.startsWith(FREEBUFF_SYSTEM_PROMPT_PREFIX)) {
      instructions = `${FREEBUFF_SYSTEM_PROMPT_PREFIX}\n\n${instructions}`;
    }
  }
  const messages: JsonValue[] = [];
  if (instructions) {
    // OpenAI-compatible relays (e.g. new-api/OpenRouter) accept cache_control on a
    // system content block; keep the breakpoint the client attached to the system prompt.
    const systemContent: JsonValue = request.systemCacheControl
      ? [{ type: "text", text: instructions, cache_control: request.systemCacheControl }]
      : instructions;
    messages.push({ role: "system", content: systemContent });
  }
  for (const message of request.messages) {
    if (message.role === "tool") {
      messages.push({ role: "tool", tool_call_id: message.toolCallId ?? "", content: contentText(message.content) });
      const images = message.content.filter((part): part is Extract<CanonicalContentPart, { type: "image" }> => part.type === "image");
      if (images.length > 0) {
        messages.push({ role: "user", content: images.map((part) => ({ type: "image_url", image_url: { url: part.url } })) });
      }
      continue;
    }
    const content: JsonValue = message.content.some((part) => part.type === "image")
      ? message.content.map((part): JsonValue => part.type === "text"
        ? (part.cacheControl ? { type: "text", text: part.text, cache_control: part.cacheControl } : { type: "text", text: part.text })
        : { type: "image_url", image_url: { url: part.url } })
      : (message.content[0]?.cacheControl
        ? [{ type: "text", text: contentText(message.content), cache_control: message.content[0]!.cacheControl }]
        : contentText(message.content));
    let safeContent: JsonValue = content;
    if (message.role === "user") {
      if (typeof safeContent === "string" && !safeContent.trim()) {
        safeContent = "(empty)";
      } else if (Array.isArray(safeContent) && safeContent.length === 0) {
        safeContent = "(empty)";
      }
    }
    const entry: Record<string, JsonValue> = { role: message.role, content: safeContent };
    if (message.toolCalls?.length) {
      entry.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: normalizedFunctionArguments(call.arguments) }
      }));
    }
    messages.push(entry);
  }
  if (options.freebuffSession) {
    const firstMsg = messages[0] as Record<string, JsonValue> | undefined;
    if (!firstMsg || firstMsg.role !== "system") {
      messages.unshift({ role: "system", content: FREEBUFF_SYSTEM_PROMPT_PREFIX });
    } else if (typeof firstMsg.content === "string") {
      if (!firstMsg.content.startsWith(FREEBUFF_SYSTEM_PROMPT_PREFIX)) {
        firstMsg.content = `${FREEBUFF_SYSTEM_PROMPT_PREFIX}\n\n${firstMsg.content}`;
      }
    } else if (Array.isArray(firstMsg.content) && firstMsg.content[0] && typeof (firstMsg.content[0] as Record<string, JsonValue>).text === "string") {
      const firstBlock = firstMsg.content[0] as Record<string, JsonValue>;
      if (typeof firstBlock.text === "string" && !firstBlock.text.startsWith(FREEBUFF_SYSTEM_PROMPT_PREFIX)) {
        firstBlock.text = `${FREEBUFF_SYSTEM_PROMPT_PREFIX}\n\n${firstBlock.text}`;
      }
    }
  }
  const body: Record<string, JsonValue> = { model: request.model, messages, stream: false };
  // Codex expresses reasoning controls through the Responses API object. Chat
  // compatible relays commonly expose the same control as reasoning_effort;
  // preserve it so selecting High/Max does not silently become a plain chat.
  const chatEffort = sanitizeResponsesEffort(request.reasoningEffort);
  if (chatEffort && options.freeOllama) {
    if (freeOllamaModelSupportsThinking(request.model)) body.reasoning_effort = ollamaReasoningEffort(chatEffort);
  } else if (chatEffort) {
    body.reasoning_effort = chatEffort;
  }
  if (request.maxOutputTokens != null) body.max_tokens = request.maxOutputTokens;
  if (request.model.startsWith("muse-spark")) {
    const current = typeof body.max_tokens === "number" ? body.max_tokens : undefined;
    if (typeof current === "number" && current < MUSE_SPARK_MIN_OUTPUT_TOKENS) {
      body.max_tokens = MUSE_SPARK_MIN_OUTPUT_TOKENS;
    }
  }
  if (request.temperature != null) body.temperature = request.temperature;
  if (request.topP != null) body.top_p = request.topP;
  if (request.tools.length > 0) {
    // Same dedupe as the Responses path: opencode included. Repeated tool
    // definitions waste tokens and trip strict upstreams.
    const seenChat = new Set<string>();
    const uniqueChat = request.tools.filter((tool) => {
      if (seenChat.has(tool.name)) return false;
      seenChat.add(tool.name);
      return true;
    });
    body.tools = uniqueChat.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description ?? "", parameters: tool.inputSchema }
    }));
    const choice = chatToolChoice(request.toolChoice);
    if (choice != null) body.tool_choice = choice;
  }
  if (options.freebuffSession && Array.isArray(body.tools) && body.tools.length > 0) {
    const hasDecide = body.tools.some((t) => {
      const fn = asRecord(t).function;
      const fnRecord = asRecord(fn);
      return fnRecord.name === "decide";
    });
    if (!hasDecide) {
      body.tools.push(FREEBUFF_SIGNATURE_TOOL);
    }
  }
  if (options.freebuffSession) {
    body.codebuff_metadata = {
      freebuff_instance_id: options.freebuffSession.instanceId,
      client_id: options.freebuffSession.userId,
      run_id: options.freebuffRunId || options.freebuffSession.instanceId,
      agent_id: options.freebuffSession.agentId,
      cost_mode: "free"
    };
  }
  if (options.allowPromptCacheKey && request.promptCacheKey) body.prompt_cache_key = request.promptCacheKey;
  // Explicit web-search request (duck2api `web_search`): forwarded so the
  // embedded channel enables server-side search. Only set when requested;
  // other upstreams ignore the unknown field.
  if (request.webSearch === true) body.web_search = true;
  return body;
}

function canonicalToAnthropic(request: CanonicalRequest): Record<string, JsonValue> {
  // Claude caching is explicit: the caller must stamp cache_control breakpoints.
  // OpenAI-compatible clients (e.g. Codex talking Responses to a Claude-backed
  // relay) never send cache_control, so when the inbound expressed no caching
  // intent at all we stamp the standard Claude breakpoints ourselves — on the
  // system prompt, the trailing tool, and the longest stable message prefix.
  // If the caller already set any breakpoint we leave it untouched.
  const inboundHasCacheControl = Boolean(request.systemCacheControl)
    || request.tools.some((tool) => tool.cacheControl != null)
    || request.messages.some((message) => message.cacheControl != null || message.content.some((part) => part.cacheControl != null));
  const autoCache = inboundHasCacheControl ? undefined : ({ type: "ephemeral" } as unknown as JsonValue);

  const messages: Array<Record<string, JsonValue>> = [];
  const appendMessage = (role: "user" | "assistant", blocks: JsonValue[]) => {
    const previous = messages.at(-1);
    if (previous?.role === role && Array.isArray(previous.content)) {
      previous.content.push(...blocks);
      return;
    }
    messages.push({ role, content: blocks });
  };
  request.messages.forEach((message) => {
    if (message.role === "system") return;
    if (message.role === "tool") {
      const hasImages = message.content.some((part) => part.type === "image");
      appendMessage("user", [{
        type: "tool_result",
        tool_use_id: message.toolCallId ?? "",
        content: hasImages
          ? message.content.map((part) => part.type === "text" ? { type: "text", text: part.text } : anthropicImageBlock(part))
          : contentText(message.content)
      }]);
      return;
    }
    const blocks: JsonValue[] = message.content.map((part) => part.type === "text"
      ? (part.cacheControl ? { type: "text", text: part.text, cache_control: part.cacheControl } : { type: "text", text: part.text })
      : anthropicImageBlock(part));
    // A message-level breakpoint (from Responses input) lands on the last block;
    // skip it when a content block already carries its own cache_control.
    const lastBlock = blocks.at(-1);
    if (message.cacheControl && lastBlock && typeof lastBlock === "object" && !Array.isArray(lastBlock) && !("cache_control" in lastBlock)) {
      blocks[blocks.length - 1] = { ...lastBlock, cache_control: message.cacheControl };
    }
    for (const call of message.toolCalls ?? []) {
      blocks.push({ type: "tool_use", id: call.id, name: call.name, input: parseArguments(call.arguments) });
    }
    appendMessage(message.role === "assistant" ? "assistant" : "user", blocks);
  });
  const system = [request.instructions, ...request.messages.filter((message) => message.role === "system").map((message) => contentText(message.content))]
    .filter(Boolean)
    .join("\n\n");
  const body: Record<string, JsonValue> = {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? 8192,
    messages,
    stream: false
  };
  const systemControl = request.systemCacheControl ?? autoCache;
  if (system) body.system = systemControl ? [{ type: "text", text: system, cache_control: systemControl }] : system;
  // Anthropic's adaptive-thinking API carries the requested depth separately
  // from the thinking mode. Preserve the Responses API effort selected by the
  // user so compatible Claude relays receive high/xhigh/max verbatim.
  if (request.reasoningEffort) {
    body.thinking = { type: "adaptive" };
    body.output_config = { effort: request.reasoningEffort };
  }
  if (request.temperature != null) body.temperature = request.temperature;
  if (request.topP != null) body.top_p = request.topP;
  if (request.tools.length > 0) {
    const lastToolIndex = request.tools.length - 1;
    body.tools = request.tools.map((tool, toolIndex) => ({
      name: tool.name,
      description: tool.description ?? "",
      input_schema: tool.inputSchema,
      // Stamp the whole tool list on its trailing entry; never one breakpoint per tool.
      ...(tool.cacheControl
        ? { cache_control: tool.cacheControl }
        : autoCache && toolIndex === lastToolIndex
          ? { cache_control: autoCache }
          : {})
    }));
    const choice = anthropicToolChoice(request.toolChoice);
    if (choice) body.tool_choice = choice;
  }
  if (autoCache) applyAutomaticAnthropicMessageCacheBreakpoints(messages, body, autoCache);
  return body;
}

const ANTHROPIC_MAX_CACHE_BREAKPOINTS = 4;
const ANTHROPIC_LONG_CONTEXT_BLOCK_WINDOW = 20;

function applyAutomaticAnthropicMessageCacheBreakpoints(
  messages: Array<Record<string, JsonValue>>,
  body: Record<string, JsonValue>,
  cacheControl: JsonValue
): void {
  let structuralBreakpoints = 0;
  if (Array.isArray(body.system) && body.system.some((block) => Boolean(asRecord(block).cache_control))) structuralBreakpoints += 1;
  if (Array.isArray(body.tools) && body.tools.some((tool) => Boolean(asRecord(tool).cache_control))) structuralBreakpoints += 1;

  const remaining = ANTHROPIC_MAX_CACHE_BREAKPOINTS - structuralBreakpoints;
  if (remaining <= 0) return;

  const refs: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    for (const rawBlock of Array.isArray(message.content) ? message.content : []) {
      const block = asRecord(rawBlock);
      if (!isAutomaticAnthropicCacheableBlock(block)) continue;
      refs.push(block);
    }
  }
  const target = Math.min(refs.length >= ANTHROPIC_LONG_CONTEXT_BLOCK_WINDOW ? 2 : refs.length > 0 ? 1 : 0, remaining);
  if (target <= 0) return;

  refs[refs.length - 1]!.cache_control = cacheControl;
  if (target < 2) return;

  const targetIndex = Math.max(refs.length - 1 - ANTHROPIC_LONG_CONTEXT_BLOCK_WINDOW, 0);
  for (let index = targetIndex; index >= 0; index -= 1) {
    if (!refs[index]!.cache_control) {
      refs[index]!.cache_control = cacheControl;
      return;
    }
  }
  for (let index = targetIndex + 1; index < refs.length; index += 1) {
    if (!refs[index]!.cache_control) {
      refs[index]!.cache_control = cacheControl;
      return;
    }
  }
}

function isAutomaticAnthropicCacheableBlock(block: Record<string, unknown>): boolean {
  const type = stringValue(block.type);
  if (type === "thinking" || type === "redacted_thinking") return false;
  if (type === "text" && !stringValue(block.text)) return false;
  return true;
}

function canonicalToGemini(request: CanonicalRequest): Record<string, JsonValue> {
  const contents: Array<Record<string, JsonValue>> = [];
  const appendContent = (role: "user" | "model", parts: JsonValue[]) => {
    const previous = contents.at(-1);
    if (previous?.role === role && Array.isArray(previous.parts)) {
      previous.parts.push(...parts);
      return;
    }
    contents.push({ role, parts });
  };
  for (const message of request.messages) {
    if (message.role === "system") continue;
    const parts: JsonValue[] = [];
    if (message.role === "tool") {
      parts.push({ functionResponse: { name: toolNameForCall(request.messages, message.toolCallId), response: { output: contentText(message.content) } } });
      for (const part of message.content) {
        if (part.type === "image") parts.push(geminiImagePart(part));
      }
    } else {
      for (const part of message.content) {
        parts.push(part.type === "text" ? { text: part.text } : geminiImagePart(part));
      }
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: parseArguments(call.arguments), id: call.id } });
      }
    }
    appendContent(message.role === "assistant" ? "model" : "user", parts);
  }
  const system = [request.instructions, ...request.messages.filter((message) => message.role === "system").map((message) => contentText(message.content))]
    .filter(Boolean)
    .join("\n\n");
  const body: Record<string, JsonValue> = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const generationConfig: Record<string, JsonValue> = {};
  if (request.maxOutputTokens != null) generationConfig.maxOutputTokens = request.maxOutputTokens;
  if (request.temperature != null) generationConfig.temperature = request.temperature;
  if (request.topP != null) generationConfig.topP = request.topP;
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  if (request.tools.length > 0) {
    body.tools = [{ functionDeclarations: request.tools.map((tool) => ({ name: tool.name, description: tool.description ?? "", parameters: tool.inputSchema })) }];
    const config = geminiToolConfig(request.toolChoice);
    if (config) body.toolConfig = { functionCallingConfig: config };
  }
  return body;
}

function chatResponseToCanonical(value: unknown, fallbackModel: string, tools: CanonicalTool[] = []): CanonicalResult {
  let record = asRecord(value);
  if (record.success === true && record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    record = asRecord(record.data);
  }
  const choice = asRecord(Array.isArray(record.choices) ? record.choices[0] : undefined);
  const message = asRecord(choice.message);
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.map((raw) => {
    const call = asRecord(raw);
    const fn = asRecord(call.function);
    const rawName = nonEmptyStringValue(fn.name) ?? (tools.length === 1 ? tools[0]!.name : "tool");
    const name = resolveCanonicalToolName(rawName, tools) ?? rawName;
    return { id: nonEmptyStringValue(call.id) ?? randomUUID(), name, arguments: normalizedFunctionArguments(stringValue(fn.arguments) ?? "") };
  }) : [];
  const usage = asRecord(record.usage);
  return {
    model: stringValue(record.model) ?? fallbackModel,
    text: contentValueToText(message.content),
    reasoning: stringValue(message.reasoning_content) ?? stringValue(message.reasoning),
    toolCalls,
    usage: {
      inputTokens: finiteNumber(usage.prompt_tokens) ?? finiteNumber(usage.input_tokens) ?? 0,
      outputTokens: finiteNumber(usage.completion_tokens) ?? finiteNumber(usage.output_tokens) ?? 0,
      cachedInputTokens: finiteNumber(asRecord(usage.prompt_tokens_details).cached_tokens),
      cacheWriteInputTokens: finiteNumber(asRecord(usage.prompt_tokens_details).cache_write_tokens)
    },
    finishReason: stringValue(choice.finish_reason)
  };
}

function anthropicResponseToCanonical(value: unknown, fallbackModel: string): CanonicalResult {
  const record = asRecord(value);
  const blocks = Array.isArray(record.content) ? record.content.map(asRecord) : [];
  const text = blocks.filter((block) => block.type === "text").map((block) => stringValue(block.text) ?? "").join("");
  const reasoning = blocks.filter((block) => block.type === "thinking").map((block) => stringValue(block.thinking) ?? "").join("");
  const toolCalls = blocks.filter((block) => block.type === "tool_use").map((block) => ({
    id: stringValue(block.id) ?? randomUUID(),
    name: stringValue(block.name) ?? "tool",
    arguments: JSON.stringify(block.input ?? {})
  }));
  const usage = asRecord(record.usage);
  return {
    model: stringValue(record.model) ?? fallbackModel,
    text,
    reasoning: reasoning || undefined,
    toolCalls,
    usage: {
      inputTokens: finiteNumber(usage.input_tokens) ?? 0,
      outputTokens: finiteNumber(usage.output_tokens) ?? 0,
      cachedInputTokens: finiteNumber(usage.cache_read_input_tokens),
      cacheWriteInputTokens: finiteNumber(usage.cache_creation_input_tokens)
    },
    finishReason: stringValue(record.stop_reason)
  };
}

function geminiResponseToCanonical(value: unknown, fallbackModel: string): CanonicalResult {
  const record = asRecord(value);
  const candidate = asRecord(Array.isArray(record.candidates) ? record.candidates[0] : undefined);
  const safetyError = geminiSafetyError(record, candidate);
  if (safetyError) throw new Error(safetyError);
  const parts = Array.isArray(asRecord(candidate.content).parts) ? (asRecord(candidate.content).parts as unknown[]).map(asRecord) : [];
  const text = parts.map((part) => stringValue(part.text) ?? "").join("");
  const toolCalls = parts.filter((part) => part.functionCall != null).map((part) => {
    const call = asRecord(part.functionCall);
    return {
      id: stringValue(call.id) ?? `call_${randomUUID().replaceAll("-", "")}`,
      name: stringValue(call.name) ?? "tool",
      arguments: JSON.stringify(call.args ?? {})
    };
  });
  const usage = asRecord(record.usageMetadata);
  return {
    model: stringValue(record.modelVersion) ?? fallbackModel,
    text,
    toolCalls,
    usage: {
      inputTokens: finiteNumber(usage.promptTokenCount) ?? 0,
      outputTokens: finiteNumber(usage.candidatesTokenCount) ?? finiteNumber(usage.totalTokenCount) ?? 0,
      cachedInputTokens: finiteNumber(usage.cachedContentTokenCount)
    },
    finishReason: stringValue(candidate.finishReason)
  };
}

function geminiSafetyError(record: Record<string, unknown>, candidate: Record<string, unknown>): string | undefined {
  const blockReason = stringValue(asRecord(record.promptFeedback).blockReason);
  if (blockReason) return `Gemini blocked the request: ${blockReason}`;
  const finishReason = stringValue(candidate.finishReason);
  if (["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(finishReason ?? "")) {
    return `Gemini stopped the response for safety: ${finishReason}`;
  }
  return undefined;
}

function canonicalResultToResponses(result: CanonicalResult, tools: CanonicalTool[]): Record<string, JsonValue> {
  const output: JsonValue[] = [];
  if (result.reasoning) {
    output.push({
      id: `rs_${randomUUID().replaceAll("-", "")}`,
      type: "reasoning",
      summary: [{ type: "summary_text", text: result.reasoning }]
    });
  }
  if (result.text || result.toolCalls.length === 0) {
    output.push({
      id: `msg_${randomUUID().replaceAll("-", "")}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: result.text, annotations: [] }]
    });
  }
  for (const call of result.toolCalls) {
    const tool = findCanonicalTool(tools, call.name);
    if (tool?.responseType === "custom_tool_call") {
      const parsed = parseArguments(call.arguments);
      const item: Record<string, JsonValue> = {
        id: `ctc_${randomUUID().replaceAll("-", "")}`,
        type: "custom_tool_call",
        status: "completed",
        call_id: call.id,
        name: tool.responseName,
        input: typeof parsed.input === "string" ? parsed.input : call.arguments
      };
      if (tool.namespace) item.namespace = tool.namespace;
      output.push(item);
    } else {
      const item: Record<string, JsonValue> = {
        id: `fc_${randomUUID().replaceAll("-", "")}`,
        type: "function_call",
        status: "completed",
        call_id: call.id,
        name: tool?.responseName ?? call.name,
        arguments: normalizedFunctionArguments(call.arguments)
      };
      if (tool?.namespace) item.namespace = tool.namespace;
      output.push(item);
    }
  }
  const completeInputTokens = result.usage.inputTokens
    + (result.usage.cachedInputTokens ?? 0)
    + (result.usage.cacheWriteInputTokens ?? 0);
  const totalTokens = completeInputTokens + result.usage.outputTokens;
  const incompleteReason = responsesIncompleteReason(result.finishReason);
  return {
    id: `resp_${randomUUID().replaceAll("-", "")}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: incompleteReason ? "incomplete" : "completed",
    model: result.model,
    output,
    parallel_tool_calls: true,
    usage: {
      input_tokens: completeInputTokens,
      input_tokens_details: {
        cached_tokens: result.usage.cachedInputTokens ?? 0,
        cache_write_tokens: result.usage.cacheWriteInputTokens ?? 0
      },
      output_tokens: result.usage.outputTokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: totalTokens
    },
    ...(incompleteReason ? { incomplete_details: { reason: incompleteReason } } : {})
  };
}

function canonicalResultToChat(result: CanonicalResult): Record<string, JsonValue> {
  const message: Record<string, JsonValue> = {
    role: "assistant",
    content: result.text || null
  };
  if (result.reasoning) message.reasoning_content = result.reasoning;
  if (result.toolCalls.length > 0) {
    message.tool_calls = result.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: normalizedFunctionArguments(call.arguments) }
    }));
  }
  const completeInputTokens = result.usage.inputTokens
    + (result.usage.cachedInputTokens ?? 0)
    + (result.usage.cacheWriteInputTokens ?? 0);
  const totalTokens = completeInputTokens + result.usage.outputTokens;
  return {
    id: `chatcmpl_${randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [{
      index: 0,
      message,
      finish_reason: result.finishReason ?? "stop"
    }],
    usage: {
      prompt_tokens: completeInputTokens,
      completion_tokens: result.usage.outputTokens,
      total_tokens: totalTokens,
      prompt_tokens_details: {
        cached_tokens: result.usage.cachedInputTokens ?? 0
      }
    }
  };
}

function ollamaReasoningEffort(effort: string): string {
  return effort.toLowerCase() === "xhigh" ? "high" : effort;
}

function responsesIncompleteReason(finishReason: string | undefined): string | undefined {
  if (!finishReason) return undefined;
  switch (finishReason.toLowerCase()) {
    case "max_tokens":
    case "length":
    case "max_output_tokens":
      return "max_output_tokens";
    default:
      return undefined;
  }
}

type StreamOutputState = {
  index: number;
  id: string;
  kind: "message" | "reasoning" | "function_call" | "custom_tool_call";
  text: string;
  callId?: string;
  name?: string;
  namespace?: string;
};

class ResponsesStreamWriter {
  private readonly encoder = new TextEncoder();
  private readonly responseId = `resp_${randomUUID().replaceAll("-", "")}`;
  private readonly createdAt = Math.floor(Date.now() / 1000);
  private readonly outputs: StreamOutputState[] = [];
  private readonly toolOutputs = new Map<number, StreamOutputState>();
  private sequence = 0;
  private model: string;
  private inputTokens = 0;
  private outputTokens = 0;
  private cachedInputTokens = 0;
  private cacheWriteInputTokens = 0;
  private finishReason?: string;
  private closed = false;
  private message?: StreamOutputState;
  private reasoning?: StreamOutputState;

  constructor(
    private readonly controller: ReadableStreamDefaultController<Uint8Array>,
    model: string,
    private readonly tools: CanonicalTool[]
  ) {
    this.model = model;
  }

  start(): void {
    const response = this.response("in_progress", []);
    this.emit("response.created", { response });
    this.emit("response.in_progress", { response });
  }

  accept(event: CanonicalStreamEvent): void {
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "metadata") {
      if (event.model) this.model = event.model;
      if (event.inputTokens != null) this.inputTokens = event.inputTokens;
      if (event.outputTokens != null) this.outputTokens = event.outputTokens;
      if (event.cachedInputTokens != null) this.cachedInputTokens = event.cachedInputTokens;
      if (event.cacheWriteInputTokens != null) this.cacheWriteInputTokens = event.cacheWriteInputTokens;
      if (event.finishReason) this.finishReason = event.finishReason;
      return;
    }
    if (event.type === "text_delta") {
      const output = this.ensureMessage();
      output.text += event.delta;
      this.emit("response.output_text.delta", {
        item_id: output.id,
        output_index: output.index,
        content_index: 0,
        delta: event.delta,
        logprobs: []
      });
      return;
    }
    if (event.type === "reasoning_delta") {
      const output = this.ensureReasoning();
      output.text += event.delta;
      this.emit("response.reasoning_summary_text.delta", {
        item_id: output.id,
        output_index: output.index,
        summary_index: 0,
        delta: event.delta
      });
      return;
    }
    const output = this.ensureTool(event.index, event.id, event.name);
    if (event.type === "tool_start") return;
    output.text += event.delta;
    if (output.kind === "custom_tool_call") {
      // Chat-compatible relays encode custom free-form input as function JSON.
      // Buffer until the call is complete so the JSON wrapper can be removed
      // before Codex receives any tool-input delta.
      return;
    }
    this.emit("response.function_call_arguments.delta", {
      item_id: output.id,
      output_index: output.index,
      delta: event.delta
    });
  }

  complete(): void {
    if (this.closed) return;
    const incompleteFunctionCall = this.outputs.find((output) =>
      output.kind === "function_call" && !isCompleteFunctionArguments(normalizedFunctionArguments(output.text))
    );
    if (incompleteFunctionCall) {
      this.fail(incompleteFunctionArgumentsMessage(incompleteFunctionCall.text, incompleteFunctionCall.callId ?? incompleteFunctionCall.id));
      return;
    }
    for (const output of this.outputs) {
      if (output.kind === "message") {
        this.emit("response.output_text.done", {
          item_id: output.id,
          output_index: output.index,
          content_index: 0,
          text: output.text,
          logprobs: []
        });
        this.emit("response.content_part.done", {
          item_id: output.id,
          output_index: output.index,
          content_index: 0,
          part: { type: "output_text", text: output.text, annotations: [] }
        });
      } else if (output.kind === "reasoning") {
        this.emit("response.reasoning_summary_text.done", {
          item_id: output.id,
          output_index: output.index,
          summary_index: 0,
          text: output.text
        });
        this.emit("response.reasoning_summary_part.done", {
          item_id: output.id,
          output_index: output.index,
          summary_index: 0,
          part: { type: "summary_text", text: output.text }
        });
      } else {
        const custom = output.kind === "custom_tool_call";
        if (custom) {
          output.text = unwrapCustomToolInput(output.text);
          if (output.text) {
            this.emit("response.custom_tool_call_input.delta", {
              item_id: output.id,
              output_index: output.index,
              delta: output.text
            });
          }
        } else {
          output.text = normalizedFunctionArguments(output.text);
        }
        this.emit(custom ? "response.custom_tool_call_input.done" : "response.function_call_arguments.done", {
          item_id: output.id,
          output_index: output.index,
          [custom ? "input" : "arguments"]: output.text
        });
      }
      this.emit("response.output_item.done", {
        output_index: output.index,
        item: this.outputItem(output, "completed")
      });
    }
    const incompleteReason = responsesIncompleteReason(this.finishReason);
    const response = this.response(incompleteReason ? "incomplete" : "completed", this.outputs.map((output) => this.outputItem(output, "completed")));
    if (incompleteReason) response.incomplete_details = { reason: incompleteReason };
    this.emit(incompleteReason ? "response.incomplete" : "response.completed", { response });
    this.enqueue("data: [DONE]\n\n");
    this.closed = true;
    this.controller.close();
  }

  fail(message: string): void {
    if (this.closed) return;
    this.emit("response.failed", {
      response: {
        ...this.response("failed", this.outputs.map((output) => this.outputItem(output, "in_progress"))),
        error: { code: "upstream_stream_error", message }
      }
    });
    this.enqueue("data: [DONE]\n\n");
    this.closed = true;
    this.controller.close();
  }

  private ensureMessage(): StreamOutputState {
    if (this.message) return this.message;
    const output = this.addOutput("message", `msg_${randomUUID().replaceAll("-", "")}`);
    this.message = output;
    this.emit("response.output_item.added", { output_index: output.index, item: this.outputItem(output, "in_progress") });
    this.emit("response.content_part.added", {
      item_id: output.id,
      output_index: output.index,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] }
    });
    return output;
  }

  private ensureReasoning(): StreamOutputState {
    if (this.reasoning) return this.reasoning;
    const output = this.addOutput("reasoning", `rs_${randomUUID().replaceAll("-", "")}`);
    this.reasoning = output;
    this.emit("response.output_item.added", { output_index: output.index, item: this.outputItem(output, "in_progress") });
    this.emit("response.reasoning_summary_part.added", {
      item_id: output.id,
      output_index: output.index,
      summary_index: 0,
      part: { type: "summary_text", text: "" }
    });
    return output;
  }

  private ensureTool(index: number, id?: string, name?: string): StreamOutputState {
    const existing = this.toolOutputs.get(index);
    if (existing) {
      if (id) existing.callId = id;
      if (name) {
        const tool = findCanonicalTool(this.tools, name);
        existing.name = tool?.responseName ?? name;
        existing.namespace = tool?.namespace;
      }
      return existing;
    }
    const tool = findCanonicalTool(this.tools, name);
    const kind = tool?.responseType === "custom_tool_call" ? "custom_tool_call" : "function_call";
    const output = this.addOutput(kind, `${kind === "function_call" ? "fc" : "ctc"}_${randomUUID().replaceAll("-", "")}`);
    output.callId = id ?? `call_${randomUUID().replaceAll("-", "")}`;
    output.name = tool?.responseName ?? name ?? "tool";
    output.namespace = tool?.namespace;
    this.toolOutputs.set(index, output);
    this.emit("response.output_item.added", { output_index: output.index, item: this.outputItem(output, "in_progress") });
    return output;
  }

  private addOutput(kind: StreamOutputState["kind"], id: string): StreamOutputState {
    const output: StreamOutputState = { index: this.outputs.length, id, kind, text: "" };
    this.outputs.push(output);
    return output;
  }

  private outputItem(output: StreamOutputState, status: "in_progress" | "completed"): Record<string, unknown> {
    if (output.kind === "message") {
      return {
        id: output.id,
        type: "message",
        status,
        role: "assistant",
        content: status === "completed" ? [{ type: "output_text", text: output.text, annotations: [] }] : []
      };
    }
    if (output.kind === "reasoning") {
      return {
        id: output.id,
        type: "reasoning",
        summary: status === "completed" ? [{ type: "summary_text", text: output.text }] : []
      };
    }
    const item: Record<string, unknown> = {
      id: output.id,
      type: output.kind,
      status,
      call_id: output.callId,
      name: output.name,
      [output.kind === "custom_tool_call" ? "input" : "arguments"]:
        output.kind === "custom_tool_call" ? output.text : normalizedFunctionArguments(output.text)
    };
    if (output.namespace) item.namespace = output.namespace;
    return item;
  }

  private response(status: "in_progress" | "completed" | "incomplete" | "failed", output: Array<Record<string, unknown>>): Record<string, unknown> {
    const completeInputTokens = this.inputTokens + this.cachedInputTokens + this.cacheWriteInputTokens;
    return {
      id: this.responseId,
      object: "response",
      created_at: this.createdAt,
      status,
      model: this.model,
      output,
      parallel_tool_calls: true,
      metadata: this.finishReason ? { finish_reason: this.finishReason } : {},
      usage: status === "in_progress" ? null : {
        input_tokens: completeInputTokens,
        input_tokens_details: { cached_tokens: this.cachedInputTokens, cache_write_tokens: this.cacheWriteInputTokens },
        output_tokens: this.outputTokens,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: completeInputTokens + this.outputTokens
      }
    };
  }

  private emit(type: string, payload: Record<string, unknown>): void {
    const event = { type, sequence_number: this.sequence++, ...payload };
    this.enqueue(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  private enqueue(value: string): void {
    if (!this.closed) this.controller.enqueue(this.encoder.encode(value));
  }
}

function responsesEventStream(response: Record<string, JsonValue>): Response {
  const pending = { ...response, status: "in_progress", output: [] };
  const events: Array<Record<string, JsonValue>> = [
    { type: "response.created", sequence_number: 0, response: pending },
    { type: "response.in_progress", sequence_number: 1, response: pending }
  ];
  let sequence = 2;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const [outputIndex, rawItem] of output.entries()) {
    const item = asRecord(rawItem);
    const itemId = stringValue(item.id) ?? `item_${outputIndex}`;
    const type = stringValue(item.type);
    events.push({ type: "response.output_item.added", sequence_number: sequence++, output_index: outputIndex, item: { ...item, status: "in_progress" } as JsonValue });
    if (type === "message") {
      const content = Array.isArray(item.content) ? item.content : [];
      const text = content.map((part) => stringValue(asRecord(part).text) ?? "").join("");
      const part = { type: "output_text", text: "", annotations: [] };
      events.push({ type: "response.content_part.added", sequence_number: sequence++, item_id: itemId, output_index: outputIndex, content_index: 0, part });
      if (text) events.push({ type: "response.output_text.delta", sequence_number: sequence++, item_id: itemId, output_index: outputIndex, content_index: 0, delta: text, logprobs: [] });
      events.push({ type: "response.output_text.done", sequence_number: sequence++, item_id: itemId, output_index: outputIndex, content_index: 0, text, logprobs: [] });
      events.push({ type: "response.content_part.done", sequence_number: sequence++, item_id: itemId, output_index: outputIndex, content_index: 0, part: { ...part, text } });
    } else if (type === "function_call") {
      const args = normalizedFunctionArguments(stringValue(item.arguments) ?? "");
      if (args) events.push({ type: "response.function_call_arguments.delta", sequence_number: sequence++, item_id: itemId, output_index: outputIndex, delta: args });
      events.push({ type: "response.function_call_arguments.done", sequence_number: sequence++, item_id: itemId, output_index: outputIndex, arguments: args });
    } else if (type === "custom_tool_call") {
      const content = stringValue(item.input) ?? "";
      if (content) events.push({ type: "response.custom_tool_call_input.delta", sequence_number: sequence++, item_id: itemId, output_index: outputIndex, delta: content });
      events.push({ type: "response.custom_tool_call_input.done", sequence_number: sequence++, item_id: itemId, output_index: outputIndex, input: content });
    }
    events.push({ type: "response.output_item.done", sequence_number: sequence++, output_index: outputIndex, item: item as JsonValue });
  }
  const terminalType = response.status === "incomplete" ? "response.incomplete" : "response.completed";
  events.push({ type: terminalType, sequence_number: sequence, response });
  const encoded = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(encoded, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}

// Mirrors cc-switch: a stable `prompt_cache_key` is forwarded to an
// OpenAI-compatible upstream so it keeps the conversation's prompt prefix
// cached across turns. The key is carried to the canonical layer in this
// internal header (set by the relay gateway entrypoint from the resolved
// thread id). An explicit client-supplied body key always wins; only a real
// per-session identity is eligible as a fallback — never a per-request UUID.
const PROMPT_CACHE_KEY_HEADER = "x-codex-prompt-cache-key";

/** Deterministic non-cryptographic hash (djb2) so the real thread id is not
 *  leaked upstream verbatim, while keeping the value stable per conversation. */
function stablePromptCacheKeyHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return `cxu-${hash.toString(36)}`;
}

/** An explicit client cache key wins; otherwise fall back to the real session
 *  identity carried in the internal header. Returns undefined when neither is
 *  present, in which case nothing is injected upstream. The explicit client key
 *  is forwarded verbatim (it is the provider's own opaque key); the per-session
 *  identity is hashed so the real thread id is not leaked upstream while the
 *  value stays deterministic and stable across a conversation's turns. */
function resolveCanonicalPromptCacheKey(
  request: Request,
  record: Record<string, unknown>,
  conversationAnchor?: string
): string | undefined {
  const explicit = stringValue(record.prompt_cache_key)
    ?? stringValue(asRecord(record.metadata).prompt_cache_key)
    ?? stringValue(asRecord(record.metadata).promptCacheKey);
  const trimmedExplicit = explicit?.trim();
  if (trimmedExplicit) return trimmedExplicit;
  const header = request.headers.get(PROMPT_CACHE_KEY_HEADER)?.trim();
  if (!header) return undefined;
  return stablePromptCacheKeyHash(conversationAnchor ? `${header}\u0000${conversationAnchor}` : header);
}

const PROMPT_CACHE_ANCHOR_MAX_BYTES_PER_UNIT = 4096;

/**
 * Derive a stable conversation fingerprint from the immutable prompt head.
 * A single client session may multiplex multiple Claude Code subagents, so a
 * session-only key lets one conversation evict another upstream. Hashing the
 * leading instructions plus the first user turn keeps later turns stable while
 * separating those sibling conversations without leaking prompt text.
 */
function conversationPromptCacheAnchor(request: CanonicalRequest): string | undefined {
  const hash = createHash("sha256");
  let hashed = false;
  const writeUnit = (value: string) => {
    const capped = value.length > PROMPT_CACHE_ANCHOR_MAX_BYTES_PER_UNIT
      ? value.slice(0, PROMPT_CACHE_ANCHOR_MAX_BYTES_PER_UNIT)
      : value;
    hash.update(String(value.length));
    hash.update(":");
    hash.update(capped);
  };
  const writeMessage = (role: string, message: CanonicalMessage) => {
    hash.update(role);
    hash.update("\u0000");
    for (const part of message.content) {
      hash.update(part.type);
      hash.update("\u001f");
      if (part.type === "text") writeUnit(part.text);
      else writeUnit(part.url);
      hash.update("\u001f");
    }
    hash.update("\u001e");
    hashed = true;
  };

  if (request.instructions) {
    hash.update("system");
    hash.update("\u0000");
    writeUnit(request.instructions);
    hash.update("\u001e");
    hashed = true;
  }

  for (const message of request.messages) {
    if (message.role !== "system" && message.role !== "user") break;
    writeMessage(message.role, message);
    if (message.role === "user") break;
  }

  return hashed ? hash.digest("hex").slice(0, 16) : undefined;
}

/** Hosts known to accept `prompt_cache_key` on Chat Completions without rejecting
 *  unknown fields. Mirrors cc-switch's `should_send_codex_chat_prompt_cache_key`
 *  allowlist (api.openai.com, api.kimi.com/coding). */
function promptCacheHostAllowed(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { return false; }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, "");
  if (host === "api.openai.com") return true;
  if (host === "api.kimi.com") return path === "/coding" || path.startsWith("/coding/");
  return false;
}

/** NVIDIA's NIM gateway (integrate.api.nvidia.com) speaks the OpenAI Chat
 *  Completions protocol but strictly rejects unknown body fields — sending
 *  `prompt_cache_key` makes it return `400 Unsupported parameter(s)`. Its
 *  provider/template `kind` is the generic `"openai"`, so the kind allowlist
 *  alone would otherwise inject the key. This denylist takes precedence over
 *  the kind allowlist in `auto` so the key is suppressed for NVIDIA specifically;
 *  everything else is unchanged and `promptCacheRouting: "enabled"` still forces it. */
function promptCacheHostDenied(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { return false; }
  const host = parsed.hostname.toLowerCase();
  if (host === "integrate.api.nvidia.com") return true;
  return false;
}

/** Provider kinds whose upstreams are OpenAI-compatible relays (e.g. new-api)
 *  that accept `prompt_cache_key` rather than a strict, unknown-field-rejecting
 *  gateway. Used as the product-level allowlist when the host is not in cc-switch's
 *  explicit list. */
function promptCacheKindAllowed(provider: ProviderConfig): boolean {
  return provider.kind === "chatgpt" || provider.kind === "openai" || provider.kind === "responsesRelay";
}

/** Gate for the Responses native and translate paths: inject whenever a key resolved and the
 *  group has not disabled it. cc-switch injects on the Claude→Responses path with
 *  no host gate, so we do not host-gate here either. */
function responsesPromptCacheAllowed(group: ChannelGroupConfig): boolean {
  return group.promptCacheRouting !== "disabled";
}

/** Gate for the Chat translate path: host- or kind-allowlisted by default (auto),
 *  forced on, or forced off. Matches cc-switch's caution that unknown gateways may
 *  400 on the unsupported `prompt_cache_key` field. */
function chatPromptCacheAllowed(provider: ProviderConfig, group: ChannelGroupConfig): boolean {
  const routing = group.promptCacheRouting ?? "auto";
  if (routing === "disabled") return false;
  if (routing === "enabled") return true;
  // NVIDIA's NIM gateway rejects the OpenAI-only `prompt_cache_key` field with 400;
  // suppress it in `auto` even though the generic `"openai"` kind would otherwise allow it.
  if (promptCacheHostDenied(group.baseUrl) || promptCacheHostDenied(provider.baseUrl)) return false;
  return promptCacheHostAllowed(group.baseUrl) || promptCacheHostAllowed(provider.baseUrl) || promptCacheKindAllowed(provider);
}

function upstreamHeaders(
  protocol: RelayResponseProtocol,
  group: ChannelGroupConfig,
  apiKey: string,
  stream = false,
  sourceUserAgent?: string | null,
  sourceAnthropicBeta?: string | null,
  freebuffSession?: FreebuffSessionInfo | null,
  sourceHeaders?: Headers | null,
  modelForHeaders?: string | null,
  bodyForHeaders?: unknown
): Headers {
  const headers = new Headers({ "Content-Type": "application/json", "Accept": stream ? "text/event-stream" : "application/json" });
  const userAgent = sourceUserAgent?.trim();
  if (userAgent) headers.set("User-Agent", userAgent);
  if (group.id === "kilocode" || (group.baseUrl && group.baseUrl.includes("api.kilo.ai"))) {
    headers.set("User-Agent", "opencode-kilo-provider");
  }
  if (group.id === "cline-free" || (group.baseUrl && group.baseUrl.includes("api.cline.bot"))) {
    headers.set("User-Agent", "Cline/4.1.16");
    headers.set("HTTP-Referer", "https://cline.bot");
    headers.set("X-Title", "Cline");
    headers.set("X-CLIENT-TYPE", "vscode");
    headers.set("X-CLIENT-VERSION", "4.1.16");
    headers.set("X-CORE-VERSION", "4.1.16");
    headers.set("X-PLATFORM", process.platform === "win32" ? "win32" : (process.platform === "darwin" ? "darwin" : "linux"));
    headers.set("X-IS-MULTIROOT", "false");
  }
  if (isFreebuffGroup(group) || freebuffSession) {
    const fbToken = apiKey || freebuffSession?.token;
    if (fbToken) {
      headers.set("Authorization", `Bearer ${fbToken}`);
      headers.set("x-codebuff-api-key", fbToken);
    }
    if (freebuffSession?.instanceId) {
      headers.set("x-freebuff-instance-id", freebuffSession.instanceId);
    }
  }
  let openCodeDedicatedUa: string | null = null;
  if (isOpenCodeGroup(group)) {
    // True-client kernel: bearer-public + CLI identity only (opencodeKernel.ts).
    const kernelModelGuess = typeof modelForHeaders === "string" && modelForHeaders.trim()
      ? modelForHeaders.trim()
      : (bodyForHeaders && typeof bodyForHeaders === "object" && !Array.isArray(bodyForHeaders)
        ? String((bodyForHeaders as Record<string, unknown>).model ?? "").trim()
        : (Array.isArray(group.models) && typeof group.models[0] === "string" ? group.models[0].trim() : ""));
    if ((protocol === "openai" || protocol === "openai-response") && kernelModelGuess && shouldKernelSendFor(group, kernelModelGuess)) {
      const surface = kernelSurfaceForRequest(kernelModelGuess, protocol);
      const identity = kernelIdentityFor(bodyForHeaders ?? {}, kernelSessionHintFromHeaders(sourceHeaders ?? null));
      const record = buildKernelHeaders(surface, identity);
      const kernelHeaders = new Headers({ "Content-Type": "application/json" });
      for (const [key, value] of Object.entries(record)) kernelHeaders.set(key, value);
      return kernelHeaders;
    }
    // Mirror OpencodeExecutor.buildHeaders (opencode.ts:1338-1411) exactly:
    // Content-Type already set above; key分流 -> anthropic-version ->
    // stream||gated Accept -> cliDefaults(provider,gated) -> forward with
    // keepAgent(go&&!gated) + sessionBody fingerprint. Auth/Accept/identity
    // all derive from surface(baseUrl)/requestFormat(protocol)/model.
    const openCodeBase = (group.baseUrl ?? OMNIROUTE_FREE_BASE_URL).trim() || OMNIROUTE_FREE_BASE_URL;
    const openCodeSurface = surfaceFromBaseUrl(openCodeBase);
    const openCodeProviderId = group.id || "opencode";
    const openCodeModel = typeof modelForHeaders === "string" && modelForHeaders.trim()
      ? modelForHeaders.trim()
      : (bodyForHeaders && typeof bodyForHeaders === "object" && !Array.isArray(bodyForHeaders)
        ? String((bodyForHeaders as Record<string, unknown>).model ?? "").trim()
        : (Array.isArray(group.models) && typeof group.models[0] === "string" ? group.models[0].trim() : ""));
    const openCodeFormat = protocol === "anthropic" ? "claude"
      : protocol === "openai-response" ? "openai-responses"
      : protocol === "gemini" ? "gemini"
      : "openai";
    const openCodeGated = openCodeModel
      ? isGatedOpencodeFreeTierRequest(openCodeModel, openCodeProviderId, openCodeSurface)
      : false;
    if (stream || openCodeGated) headers.set("Accept", "text/event-stream");
    else headers.set("Accept", "application/json");
    applyOpenCodeHeaders(headers, apiKey, sourceHeaders ?? null, {
      providerId: openCodeProviderId,
      gated: openCodeGated,
      requestFormat: openCodeFormat,
      baseUrl: openCodeBase,
      keepAgentUserAgent: openCodeSurface === "go" && !openCodeGated,
      sessionBody: projectOpencodeSessionBody(bodyForHeaders),
    });
    // Dedicated per-backend UA for Claude runtimes (the CLI bridges send the
    // hint on ANTHROPIC_CUSTOM_HEADERS). Applied below after the claude-cli
    // override so OpenCode attribution wins on OpenCode upstreams only.
    openCodeDedicatedUa = resolveOpenCodeBackendUserAgent(sourceHeaders);
    console.info(
      `[opencode-headers] group=${group.id} surface=${openCodeSurface} format=${openCodeFormat} gated=${openCodeGated} ` +
      `sessionId=${headers.get("x-opencode-session") ?? "-"} auth=${apiKey?.trim() ? (headers.has("x-api-key") ? "x-api-key" : "bearer") : "none"}`
    );
  }
  const anthropicBetas = new Map<string, string>();
  for (const value of sourceAnthropicBeta?.split(",") ?? []) {
    const beta = value.trim();
    if (beta) anthropicBetas.set(beta.toLowerCase(), beta);
  }
  const authType = group.authType ?? "inherit";
  if (authType === "none") {
    headers.delete("Authorization");
    if (protocol === "anthropic" && anthropicBetas.size > 0) headers.set("Anthropic-Beta", [...anthropicBetas.values()].join(","));
    return headers;
  }
  if (authType === "bearer" || authType === "inherit" || protocol === "openai" || protocol === "openai-response") {
    let token = apiKey;
    if (token && (group.id === "cline-free" || (group.baseUrl && group.baseUrl.includes("api.cline.bot")))) {
      token = token.startsWith("workos:") ? token : `workos:${token}`;
    }
    if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  }
  if (authType === "anthropic" || (authType === "inherit" && protocol === "anthropic")) {
    headers.set("X-Api-Key", apiKey);
    headers.set("Anthropic-Version", "2023-06-01");
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  if (protocol === "anthropic" && group.claudeCodeHeadersEnabled === true) {
    const version = normalizedClaudeCodeVersion(group.claudeCodeVersion);
    headers.set("User-Agent", `claude-cli/${version} (external, cli)`);
    headers.set("X-App", "cli");
    anthropicBetas.set("claude-code-20250219", "claude-code-20250219");
  }
  if (protocol === "anthropic" && anthropicBetas.size > 0) headers.set("Anthropic-Beta", [...anthropicBetas.values()].join(","));
  // OpenCode attribution wins on OpenCode upstreams: a CLI-bridge backend hint
  // selects the dedicated per-backend UA even when the claude-cli override
  // above fired. Only OpenCode groups can set the hint variable.
  if (openCodeDedicatedUa) headers.set("User-Agent", openCodeDedicatedUa);
  if (authType === "google_api_key" || (authType === "inherit" && protocol === "gemini")) {
    headers.set("X-Goog-Api-Key", apiKey);
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  // Transparent passthrough of the caller's native session identity
  // (Codex x-session-affinity / X-Session-Id / x-parent-session-id).
  // OpenCode Go recognizes these to identify the real client; per official
  // docs they must be preserved when forwarding. Never overwrites values
  // already set.
  if (sourceHeaders) {
    for (const name of ["x-session-affinity", "X-Session-Id", "x-parent-session-id"]) {
      const value = sourceHeaders.get(name)?.trim();
      if (value && !headers.get(name)) {
        headers.set(name, value);
      }
    }
  }
  return headers;
}

export const DEFAULT_CLAUDE_CODE_VERSION = "2.1.223";

/**
 * Fill a missing group baseUrl from the provider so downstream decisions see
 * the URL that will actually be called (endpoint resolution already uses
 * `group.baseUrl ?? provider.baseUrl`). Returns the same reference when
 * nothing needs filling; never mutates its inputs.
 */
export function withEffectiveGroupBaseUrl(group: ChannelGroupConfig, providerBaseUrl?: string | null): ChannelGroupConfig {
  if (group.baseUrl?.trim() || !providerBaseUrl?.trim()) return group;
  return { ...group, baseUrl: providerBaseUrl };
}

/**
 * Stable per-conversation session id for OpenCode routing, derived from the
 * inbound caller thread/session headers when present (mirrors the documented
 * `sessionHeader` pattern: one stable id per conversation, not per request).
 * Returns null when the caller supplied no thread context.
 */
export function resolveThreadStableSessionId(sourceHeaders?: Headers | null): string | null {
  if (!sourceHeaders) return null;
  const ref = sourceHeaders.get("x-ultra-thread-id")?.trim()
    || sourceHeaders.get("x-codex-thread-id")?.trim()
    || sourceHeaders.get("session-id")?.trim()
    || sourceHeaders.get("x-session-id")?.trim()
    || sourceHeaders.get("thread-id")?.trim()
    || sourceHeaders.get("x-thread-id")?.trim();
  return ref || null;
}

/**
 * Dedicated OpenCode User-Agent for CLI-bridge traffic, selected by the
 * gateway-internal backend hint the Claude bridges send on
 * `ANTHROPIC_CUSTOM_HEADERS`. Strict allowlist: any other value (or none)
 * keeps the existing generic UA. `OPENCODE_USER_AGENT` env still wins when
 * set, matching `openCodeThreadHeaders` precedence.
 */
export function resolveOpenCodeBackendUserAgent(sourceHeaders?: Headers | null): string | null {
  const hint = sourceHeaders?.get(OPENCODE_CLI_BACKEND_HEADER)?.trim().toLowerCase();
  if (hint !== "claude" && hint !== "openclaude") return null;
  return process.env.OPENCODE_USER_AGENT?.trim() || OPENCODE_BACKEND_USER_AGENTS[hint];
}
function normalizedClaudeCodeVersion(value: string | undefined): string {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized && /^[0-9]+(?:\.[0-9A-Za-z-]+)+$/.test(normalized) ? normalized : DEFAULT_CLAUDE_CODE_VERSION;
}

function withProtocolQueryAuth(endpoint: string, protocol: RelayResponseProtocol, authType: ChannelGroupConfig["authType"], apiKey: string): string {
  if (protocol !== "gemini" || authType !== "google_query_key") return endpoint;
  const url = new URL(endpoint);
  url.searchParams.set("key", apiKey);
  return url.toString();
}

function relayResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  for (const name of [
    "content-type",
    "cache-control",
    "retry-after",
    "retry-after-ms",
    "x-request-id",
    "openai-processing-ms",
    "x-ratelimit-limit-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens"
  ]) {
    const value = upstream.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function parseContent(value: unknown): CanonicalContentPart[] {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (!Array.isArray(value)) return value == null ? [] : [{ type: "text", text: String(value) }];
  const parts: CanonicalContentPart[] = [];
  for (const raw of value) {
    if (typeof raw === "string") {
      parts.push({ type: "text", text: raw });
      continue;
    }
    const part = asRecord(raw);
    const type = stringValue(part.type);
    const blockCache = jsonValue(part.cache_control);
    const text = stringValue(part.text) ?? stringValue(part.output_text) ?? stringValue(part.input_text);
    if (text != null || ["text", "input_text", "output_text"].includes(type ?? "")) {
      parts.push(blockCache ? { type: "text", text: text ?? "", cacheControl: blockCache } : { type: "text", text: text ?? "" });
      continue;
    }
    const url = stringValue(part.image_url) ?? stringValue(asRecord(part.image_url).url) ?? stringValue(part.url);
    if (url) parts.push(blockCache ? { type: "image", url, mimeType: stringValue(part.mime_type), cacheControl: blockCache } : { type: "image", url, mimeType: stringValue(part.mime_type) });
  }
  return parts;
}

function anthropicImageBlock(part: Extract<CanonicalContentPart, { type: "image" }>): JsonValue {
  const data = dataUrlParts(part.url);
  return data
    ? { type: "image", source: { type: "base64", media_type: data.mimeType, data: data.data } }
    : { type: "text", text: `[Image: ${part.url}]` };
}

function geminiImagePart(part: Extract<CanonicalContentPart, { type: "image" }>): JsonValue {
  const data = dataUrlParts(part.url);
  return data
    ? { inlineData: { mimeType: data.mimeType, data: data.data } }
    : { fileData: { mimeType: part.mimeType ?? "image/*", fileUri: part.url } };
}

function dataUrlParts(value: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  return match ? { mimeType: match[1]!, data: match[2]! } : null;
}

function chatToolChoice(value: JsonValue | undefined): JsonValue | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  const name = stringValue(record.name);
  return name ? { type: "function", function: { name } } : undefined;
}

function anthropicToolChoice(value: JsonValue | undefined): JsonValue | undefined {
  if (value === "none") return undefined;
  if (value === "required") return { type: "any" };
  if (value === "auto" || value == null) return { type: "auto" };
  const name = stringValue(asRecord(value).name);
  return name ? { type: "tool", name } : { type: "auto" };
}

function geminiToolConfig(value: JsonValue | undefined): JsonValue | undefined {
  if (value === "none") return { mode: "NONE" };
  if (value === "required") return { mode: "ANY" };
  const name = stringValue(asRecord(value).name);
  return name ? { mode: "ANY", allowedFunctionNames: [name] } : { mode: "AUTO" };
}

function toolNameForCall(messages: CanonicalMessage[], callId: string | undefined): string {
  for (const message of messages) {
    const call = message.toolCalls?.find((entry) => entry.id === callId);
    if (call) return call.name;
  }
  return "tool";
}

function contentText(parts: CanonicalContentPart[]): string {
  return parts.map((part) => part.type === "text" ? part.text : "[Image attached]").join("\n");
}

function contentValueToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => stringValue(asRecord(part).text) ?? "").join("");
}

function resolveMappedModel(group: ChannelGroupConfig, selectedModel: string): string {
  let model = selectedModel;
  const variant = stripModelContextVariant(selectedModel);
  const suffix = variant.contextWindow ? selectedModel.slice(variant.baseModel.length) : "";
  const seen = new Set<string>();
  for (let index = 0; index < 8; index += 1) {
    if (seen.has(model)) return model;
    seen.add(model);
    const baseMapped = suffix && model === selectedModel
      ? group.modelMapping?.find((entry) => entry.from === variant.baseModel)?.to
      : undefined;
    const next = group.modelMapping?.find((entry) => entry.from === model)?.to
      ?? (baseMapped ? `${baseMapped}${suffix}` : undefined);
    if (!next || next === model) return isOpenCodeGroup(group) ? model.replace(/^opencode\//i, "") : model;
    model = next;
  }
  return isOpenCodeGroup(group) ? model.replace(/^opencode\//i, "") : model;
}

function messageRole(value: unknown): CanonicalMessage["role"] {
  switch (value) {
    case "system":
    case "developer": return "system";
    case "assistant": return "assistant";
    case "tool": return "tool";
    default: return "user";
  }
}

function parseArguments(value: string): Record<string, JsonValue> {
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed) as Record<string, JsonValue>;
  } catch {
    return { input: value };
  }
}

function upstreamErrorMessage(bodyText: string, protocol: string): string {
  try {
    const body = asRecord(JSON.parse(bodyText));
    return stringValue(asRecord(body.error).message) ?? stringValue(body.error) ?? stringValue(body.message) ?? `${protocol} upstream request failed`;
  } catch {
    return bodyText.trim().slice(0, 1000) || `${protocol} upstream request failed`;
  }
}

function isContextWindowError(bodyText: string, message: string): boolean {
  try {
    const body = asRecord(JSON.parse(bodyText));
    const error = asRecord(body.error);
    const code = stringValue(error.code) ?? stringValue(body.code);
    if (code && ["context_length_exceeded", "context_window_exceeded", "prompt_too_long"].includes(code.toLowerCase())) return true;
  } catch {
    // Fall back to relay-specific messages below.
  }
  return /context (?:window|length).*(?:exceed|too (?:large|long))|(?:exceed|超出).*context|上下文.*(?:超出|超过).*(?:窗口|限制)|上下文超出模型窗口/i.test(message);
}

function jsonResponse(body: Record<string, JsonValue>, status: number, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(status: number, message: string, extraHeaders?: HeadersInit): Response {
  return jsonResponse({ error: { message, type: "relay_protocol_error", code: status } }, status, extraHeaders);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value as JsonValue;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const values = value.map(jsonValue);
    return values.every((entry) => entry !== undefined) ? values as JsonValue[] : undefined;
  }
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const parsed = jsonValue(entry);
      if (parsed !== undefined) result[key] = parsed;
    }
    return result;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
