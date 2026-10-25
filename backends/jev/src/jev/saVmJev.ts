import { basename } from "node:path";
import type { SaVmPolicyConfig } from "@codex-ui/shared";
import type { RegressionCase, SaVmRunInput, SaVmRunResult } from "@cxu/sdk-backend";
import { loadRegressionCases, SaVmInputError } from "@cxu/sdk-backend";

export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-latest";
export const JEV_DEFAULT_TIMEOUT_MS = 15_000;
export const JEV_MAX_CONTEXT_LENGTH = 8_000;
// Default minimum interval between JEV upstream calls. Serializes burst
// jev_* tool calls so the upstream 503/429 crunch observed on 2026-09-21
// (parallel calls failed, ≥100ms serial spacing succeeded) does not recur.
export const JEV_DEFAULT_MIN_INTERVAL_MS = 500;
// Default cap on queued + in-flight JEV upstream calls. Beyond this the slot
// acquisition fails fast instead of queueing behind long (15s-timeout) calls.
export const JEV_DEFAULT_MAX_QUEUE = 16;
// ---- Cloudflare-hosted JEV (clef series, e.g. clef-flash) ----
// Runs behind Cloudflare Workers AI `ai/run`: the configured Base URL is the
// account run root
//   https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run
// and each call appends the model path, e.g.
//   {base}/@cf/cloudflare/clef-flash
// with body { model: "clef-flash", state, questions } and a Cloudflare API
// token as the Bearer key (NOT the JEV apikey).
export const CLOUDFLARE_JEV_DEFAULT_BASE_URL =
  "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/run";
export const CLOUDFLARE_JEV_DEFAULT_MODEL = "clef-flash";
export const CLOUDFLARE_JEV_MODEL_PATH_PREFIX = "@cf/cloudflare/";

/** True when the configured Base URL points at Cloudflare ai/run. */
export function isCloudflareJevUpstream(baseUrl: string): boolean {
  const v = (baseUrl || "").toLowerCase();
  return v.includes("api.cloudflare.com");
}

/**
 * Compose the full Cloudflare run URL for a JEV model.
 * - "clef-flash" -> "{base}/@cf/cloudflare/clef-flash"
 * - "@cf/cloudflare/clef-flash" (or any "@..."/"a/b" path) -> "{base}/{path}"
 */
export function buildCloudflareJevRequestUrl(baseUrl: string, model: string): string {
  const base = (baseUrl || "").trim().replace(/\/+$/, "");
  const name = (model || "").trim() || CLOUDFLARE_JEV_DEFAULT_MODEL;
  const path = name.startsWith("@")
    ? name.replace(/^\/+/, "")
    : (name.includes("/") ? name : `${CLOUDFLARE_JEV_MODEL_PATH_PREFIX}${name}`);
  return `${base}/${path}`;
}

/**
 * Effective model for a Cloudflare upstream: an explicit model is kept, while
 * a blank value (or the JEV-official default, which means the caller did not
 * choose a Cloudflare model) falls back to clef-flash instead of requesting
 * a nonexistent `@cf/cloudflare/jev-latest` path.
 */
export function resolveCloudflareJevModel(model: string): string {
  const name = (model || "").trim();
  if (!name || name === JEV_DEFAULT_MODEL) return CLOUDFLARE_JEV_DEFAULT_MODEL;
  return name;
}

/** Body model is always the bare name ("clef-flash"), never the @cf/... path. */
export function cloudflareJevBodyModel(model: string): string {
  const name = (model || "").trim();
  if (!name) return CLOUDFLARE_JEV_DEFAULT_MODEL;
  const last = name.split("/").pop()?.trim();
  return last || CLOUDFLARE_JEV_DEFAULT_MODEL;
}

/**
 * Tolerate both JEV-native ({ answers } / { data }) and Cloudflare-style
 * ({ result }) success envelopes.
 */
export function unwrapJevUpstreamPayload(parsed: unknown): Record<string, unknown> {
  const root = (parsed ?? {}) as Record<string, unknown>;
  const inner = (root.data ?? root.result ?? root) as unknown;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return root;
}

/**
 * Namespace for the padding probe below. Downstream verdict parsers only read
 * their own question ids, so this extra answer is always ignored.
 */
export const CLOUDFLARE_JEV_PAD_QUESTION_ID = "_cf_pad";

/**
 * Cloudflare rejects payloads with fewer than 2 valid questions (HTTP 422).
 * Pad single-question calls (e.g. jev_choose's lone `decision`) with a trivial
 * namespaced probe so every action works unchanged on clef models.
 */
export function padCloudflareJevQuestions(questions: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(questions ?? {});
  if (keys.length >= 2 || keys.includes(CLOUDFLARE_JEV_PAD_QUESTION_ID)) return questions;
  return {
    ...questions,
    [CLOUDFLARE_JEV_PAD_QUESTION_ID]: {
      type: "choice",
      instructions: "Padding probe: reply with the ok option.",
      criteria: { ok: "padding probe expects ok", bad: "padding probe rejects bad" },
    },
  };
}

/**
 * Connectivity-test questions for the /api/jev/test probe. Cloudflare needs
 * two well-formed choice questions; JEV official keeps its single noul probe.
 */
export function buildJevConnectivityQuestions(baseUrl: string): Record<string, unknown> {
  if (isCloudflareJevUpstream(baseUrl)) {
    return {
      cf_test_choice: {
        type: "choice",
        instructions: "Reply with the ok option.",
        criteria: { ok: "connectivity probe expects ok", bad: "connectivity probe rejects bad" },
      },
      cf_test_confirm: {
        type: "choice",
        instructions: "Confirm this connectivity probe.",
        criteria: { yes: "probe confirmed", no: "probe denied" },
      },
    };
  }
  return { is_test: { type: "noul", instructions: "Is this a connectivity test?" } };
}

export interface JevSharedConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  providerId?: string;
  groupId?: string;
  bridgeProtocol?: string;
  /** Minimum ms between JEV upstream calls (default 500). */
  minIntervalMs?: number;
  /** Set false to disable the throttle. */
  throttleEnabled?: boolean;
  /** Max queued + in-flight JEV calls before failing fast (default 16). */
  maxQueueLength?: number;
}

let sharedJevConfig: JevSharedConfig | null = null;

export function setSharedJevConfig(config: JevSharedConfig | null): void {
  sharedJevConfig = config;
}

export function getSharedJevConfig(): JevSharedConfig | null {
  return sharedJevConfig;
}

export type JevRelayExecutor = (payload: {
  state: string;
  model: string;
  questions: Record<string, unknown>;
  providerId: string;
  groupId?: string;
  bridgeProtocol?: string;
  signal?: AbortSignal;
}) => Promise<Response>;

let relayExecutor: JevRelayExecutor | null = null;

export function setJevRelayExecutor(executor: JevRelayExecutor | null): void {
  relayExecutor = executor;
}

// ---- JEV upstream throttle (serial slot + minimum interval) ----
// Control switches (precedence: explicit override > env > shared config > default):
// - JEV_MIN_INTERVAL_MS: minimum ms between upstream calls (default 500)
// - JEV_MAX_QUEUE: max queued + in-flight calls before failing fast (default 16)
// - JEV_THROTTLE_DISABLED=1: disable the throttle entirely
// - setJevThrottle({ minIntervalMs, maxQueueLength, enabled }): programmatic control (tests/settings)
let jevSlotChain: Promise<void> = Promise.resolve();
let jevLastStartAt = 0;
let jevWaiting = 0;
let jevMinIntervalOverride: number | null = null;
let jevMaxQueueOverride: number | null = null;
let jevThrottleEnabledOverride: boolean | null = null;

export function setJevThrottle(config: { minIntervalMs?: number; maxQueueLength?: number; enabled?: boolean } | null): void {
  if (config === null) {
    jevMinIntervalOverride = null;
    jevMaxQueueOverride = null;
    jevThrottleEnabledOverride = null;
    return;
  }
  if (config.minIntervalMs !== undefined) jevMinIntervalOverride = config.minIntervalMs;
  if (config.maxQueueLength !== undefined) jevMaxQueueOverride = config.maxQueueLength;
  if (config.enabled !== undefined) jevThrottleEnabledOverride = config.enabled;
}

export function resolveJevMinIntervalMs(): number {
  if (jevMinIntervalOverride !== null && Number.isFinite(jevMinIntervalOverride) && jevMinIntervalOverride >= 0) {
    return Math.min(60_000, jevMinIntervalOverride);
  }
  const fromEnvRaw = process.env.JEV_MIN_INTERVAL_MS?.trim();
  if (fromEnvRaw !== undefined && fromEnvRaw !== "") {
    const parsed = Number(fromEnvRaw);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.min(60_000, parsed);
  }
  const shared = sharedJevConfig?.minIntervalMs;
  if (typeof shared === "number" && Number.isFinite(shared) && shared >= 0) {
    return Math.min(60_000, shared);
  }
  return JEV_DEFAULT_MIN_INTERVAL_MS;
}

export function isJevThrottleEnabled(): boolean {
  if (jevThrottleEnabledOverride !== null) return jevThrottleEnabledOverride;
  if (process.env.JEV_THROTTLE_DISABLED?.trim() === "1") return false;
  if (sharedJevConfig?.throttleEnabled === false) return false;
  return true;
}

export function getJevThrottle(): { minIntervalMs: number; maxQueueLength: number; enabled: boolean } {
  return { minIntervalMs: resolveJevMinIntervalMs(), maxQueueLength: resolveJevMaxQueue(), enabled: isJevThrottleEnabled() };
}

export function resolveJevMaxQueue(): number {
  if (jevMaxQueueOverride !== null && Number.isFinite(jevMaxQueueOverride) && jevMaxQueueOverride > 0) {
    return Math.min(256, Math.floor(jevMaxQueueOverride));
  }
  const fromEnvRaw = process.env.JEV_MAX_QUEUE?.trim();
  if (fromEnvRaw !== undefined && fromEnvRaw !== "") {
    const parsed = Number(fromEnvRaw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(256, Math.floor(parsed));
  }
  const shared = sharedJevConfig?.maxQueueLength;
  if (typeof shared === "number" && Number.isFinite(shared) && shared > 0) {
    return Math.min(256, Math.floor(shared));
  }
  return JEV_DEFAULT_MAX_QUEUE;
}

async function acquireJevSlot(): Promise<() => void> {
  // Disabled: pre-fix behavior, no serialization or counting.
  if (!isJevThrottleEnabled()) return () => {};
  const maxQueue = resolveJevMaxQueue();
  if (jevWaiting >= maxQueue) {
    throw new SaVmInputError(
      `JEV overloaded: ${jevWaiting} calls already queued/in-flight (max ${maxQueue}); retry later.`
    );
  }
  jevWaiting++;
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = jevSlotChain;
  jevSlotChain = next;
  const done = () => {
    jevWaiting--;
    release();
  };
  try {
    await previous;
    const interval = resolveJevMinIntervalMs();
    if (interval > 0) {
      const waitMs = interval - (Date.now() - jevLastStartAt);
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    jevLastStartAt = Date.now();
  } catch (err) {
    done();
    throw err;
  }
  return done;
}

/**
 * Normalizes single-choice options into a 2~8 entry Record<string, string>.
 * Accepts object `{ a: "...", b: "..." }`, array `["Option A", "Option B"]`,
 * or JSON-encoded object/array string.
 */
export function normalizeChoiceOptions(raw: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeChoiceOptions(parsed);
      } catch {}
    }
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim().replace(/^[\d+*•-]\.?\s*/, "")).filter(Boolean);
    if (lines.length >= 2) {
      lines.forEach((line, index) => {
        result[String(index + 1)] = line;
      });
      return result;
    }
    return result;
  }

  if (typeof raw !== "object") return result;

  if (Array.isArray(raw)) {
    raw.forEach((item, index) => {
      const text = String(item ?? "").trim();
      if (text) {
        result[String(index + 1)] = text;
      }
    });
    return result;
  }

  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim();
    const v = String(val ?? "").trim();
    if (k && v) {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Normalizes multi-check checklist items into a 1~8 entry Record<string, string>.
 * Accepts object `{ null_safe: "...", compat: "..." }`, array `["Check A", "Check B"]`,
 * or JSON-encoded object/array string.
 */
export function normalizeChecklistItems(raw: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeChecklistItems(parsed);
      } catch {}
    }
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim().replace(/^[\d+*•-]\.?\s*/, "")).filter(Boolean);
    if (lines.length >= 1) {
      lines.forEach((line, index) => {
        result[`check_${index + 1}`] = line;
      });
      return result;
    }
    return result;
  }

  if (typeof raw !== "object") return result;

  if (Array.isArray(raw)) {
    raw.forEach((item, index) => {
      const text = String(item ?? "").trim();
      if (text) {
        result[`check_${index + 1}`] = text;
      }
    });
    return result;
  }

  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim();
    const v = String(val ?? "").trim();
    if (k && v) {
      result[k] = v;
    }
  }
  return result;
}

export function resolveJevCredentials(rawInput: Record<string, unknown>): {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerId: string;
  groupId: string;
  bridgeProtocol: string;
  timeoutMs: number;
} {
  const shared = sharedJevConfig;
  const rawApiKey = (typeof rawInput.api_key === "string" ? rawInput.api_key : (typeof rawInput.apiKey === "string" ? rawInput.apiKey : ""))?.trim();
  const rawBaseUrl = (typeof rawInput.base_url === "string" ? rawInput.base_url : (typeof rawInput.baseUrl === "string" ? rawInput.baseUrl : ""))?.trim();
  const rawModel = (typeof rawInput.jev_model === "string" ? rawInput.jev_model : (typeof rawInput.model === "string" ? rawInput.model : ""))?.trim();
  const rawProviderId = (typeof rawInput.jev_provider_id === "string" ? rawInput.jev_provider_id : (typeof rawInput.providerId === "string" ? rawInput.providerId : ""))?.trim();
  const rawGroupId = (typeof rawInput.jev_group_id === "string" ? rawInput.jev_group_id : (typeof rawInput.groupId === "string" ? rawInput.groupId : ""))?.trim();
  const rawBridge = (typeof rawInput.bridgeProtocol === "string" ? rawInput.bridgeProtocol : (typeof (rawInput as Record<string, unknown>).bridge_protocol === "string" ? (rawInput as Record<string, unknown>).bridge_protocol as string : (typeof rawInput.protocol === "string" ? rawInput.protocol : "")))?.trim();

  const apiKey = rawApiKey || process.env.JEV_API_KEY?.trim() || shared?.apiKey?.trim() || "";
  const baseUrl = rawBaseUrl || process.env.JEV_BASE_URL?.trim() || shared?.baseUrl?.trim() || JEV_DEFAULT_BASE_URL;
  const model = rawModel || process.env.JEV_MODEL?.trim() || shared?.model?.trim() || JEV_DEFAULT_MODEL;
  const providerId = rawProviderId || process.env.JEV_PROVIDER_ID?.trim() || shared?.providerId?.trim() || "";
  const groupId = rawGroupId || process.env.JEV_GROUP_ID?.trim() || shared?.groupId?.trim() || "";
  const bridgeProtocol = rawBridge || (typeof shared?.bridgeProtocol === "string" ? shared.bridgeProtocol : "") || process.env.JEV_BRIDGE_PROTOCOL?.trim() || "";

  const timeoutMs = typeof rawInput.timeout_ms === "number" && rawInput.timeout_ms > 0
    ? Math.min(60_000, rawInput.timeout_ms)
    : (typeof rawInput.timeout === "number" && rawInput.timeout > 0 ? Math.min(60_000, rawInput.timeout) : JEV_DEFAULT_TIMEOUT_MS);

  return { baseUrl, apiKey, model, providerId, groupId, bridgeProtocol, timeoutMs };
}

export function truncateJevContext(contextRaw: unknown): string {
  if (typeof contextRaw !== "string") {
    if (contextRaw === null || contextRaw === undefined) return "(no context provided)";
    if (typeof contextRaw === "number") return "(no context provided)";
    try {
      return JSON.stringify(contextRaw).slice(0, JEV_MAX_CONTEXT_LENGTH);
    } catch {
      return String(contextRaw).slice(0, JEV_MAX_CONTEXT_LENGTH);
    }
  }
  const trimmed = contextRaw.trim();
  if (!trimmed) return "(empty context)";
  if (trimmed.length <= JEV_MAX_CONTEXT_LENGTH) return trimmed;
  return `${trimmed.slice(0, JEV_MAX_CONTEXT_LENGTH - 30)}\n...[truncated for JEV limit]`;
}

async function executeJevCall(
  payload: { state: string; model: string; questions: Record<string, unknown> },
  creds: ReturnType<typeof resolveJevCredentials>
): Promise<{ ok: true; data: Record<string, unknown>; latencyMs: number } | { ok: false; error: string; latencyMs: number; status?: number }> {
  const startedAt = Date.now();
  // Serialize upstream calls with a minimum start interval (see throttle above).
  const releaseSlot = await acquireJevSlot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), creds.timeoutMs);

  try {
    if (!creds.apiKey && creds.providerId && relayExecutor) {
      const response = await relayExecutor({
        state: payload.state,
        model: payload.model,
        questions: payload.questions,
        providerId: creds.providerId,
        groupId: creds.groupId || undefined,
        bridgeProtocol: creds.bridgeProtocol || undefined,
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { raw: text };
      }
      if (!response.ok) {
        const errorMsg = (parsed as { error?: string })?.error || `Relay upstream failed (${response.status})`;
        return { ok: false, error: errorMsg, latencyMs, status: response.status };
      }
      const data = (parsed as { data?: Record<string, unknown> })?.data || (parsed as Record<string, unknown>);
      return { ok: true, data, latencyMs };
    }

    if (!creds.apiKey) {
      return {
        ok: false,
        error: "JEV is not configured. Please set JEV_API_KEY in environment or configure JEV in settings.",
        latencyMs: Date.now() - startedAt,
        status: 401,
      };
    }

    // Cloudflare-hosted JEV (clef series): POST {base}/@cf/cloudflare/{model}
    // with a bare body model name. JEV official: POST base directly.
    const cloudflareUpstream = isCloudflareJevUpstream(creds.baseUrl);
    const effectiveModel = cloudflareUpstream ? resolveCloudflareJevModel(payload.model) : payload.model;
    const requestUrl = cloudflareUpstream
      ? buildCloudflareJevRequestUrl(creds.baseUrl, effectiveModel)
      : creds.baseUrl;
    const requestBody = cloudflareUpstream
      ? {
        state: payload.state,
        model: cloudflareJevBodyModel(effectiveModel),
        questions: padCloudflareJevQuestions(payload.questions),
      }
      : payload;
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    if (!response.ok) {
      const errorMsg = (parsed as { error?: string })?.error || `JEV upstream returned ${response.status}`;
      return { ok: false, error: errorMsg, latencyMs, status: response.status };
    }
    const data = unwrapJevUpstreamPayload(parsed);
    return { ok: true, data, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error && error.name === "AbortError"
      ? `JEV upstream timed out after ${creds.timeoutMs}ms`
      : (error instanceof Error ? error.message : String(error));
    return { ok: false, error: message, latencyMs, status: 502 };
  } finally {
    clearTimeout(timeout);
    releaseSlot();
  }
}

/**
 * Autonomous Single-Choice evaluation (分叉单选).
 * Evaluates 2~8 options against the given question and context.
 */
export async function nativeJevChoose(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const question = (rawInput.question || (rawInput as Record<string, unknown>).query || (rawInput as Record<string, unknown>).prompt || "").toString().trim();
  if (!question) {
    throw new SaVmInputError("action 'jev_choose' requires a non-empty 'question' parameter");
  }

  const rawOptions = rawInput.options ?? rawInput.criteria ?? (rawInput as Record<string, unknown>).choices;
  const options = normalizeChoiceOptions(rawOptions);
  const optionKeys = Object.keys(options);
  if (optionKeys.length < 2) {
    throw new SaVmInputError(`action 'jev_choose' requires at least 2 options (received ${optionKeys.length})`);
  }
  if (optionKeys.length > 8) {
    // Truncate to first 8 options
    for (const k of optionKeys.slice(8)) {
      delete options[k];
    }
  }

  const context = truncateJevContext(rawInput.context ?? rawInput.content ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const payload = {
    state: `[Question Context]\n${context}\n\n[Decision Question]\n${question}`,
    model: creds.model,
    questions: {
      decision: {
        type: "choice",
        instructions: question,
        criteria: options,
      },
    },
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV evaluate failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const decisionAnswer = answers.decision ?? {};
  const chosenKey = typeof decisionAnswer.choice === "string" ? decisionAnswer.choice.trim() : "";
  const confidence = typeof decisionAnswer.confidence === "number" && Number.isFinite(decisionAnswer.confidence)
    ? decisionAnswer.confidence
    : 1.0;
  const chosenDesc = options[chosenKey] || options[chosenKey.toLowerCase()] || chosenKey;

  const confPercent = Math.round(confidence * 100);
  const summary = [
    `【JEV 单选决策结果】`,
    `• 推荐方案：[${chosenKey}]（置信度 ${confPercent}%）`,
    `• 方案描述：${chosenDesc}`,
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  const outputObject = {
    action: "jev_choose",
    question,
    choice: chosenKey,
    confidence,
    description: chosenDesc,
    all_options: options,
    summary,
    latencyMs: callResult.latencyMs,
    raw: rootData,
  };

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify(outputObject, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/**
 * Autonomous Multi-Choice Checklist evaluation (交付多选自检).
 * Concurrently evaluates 1~8 checklist criteria against the context.
 */
export async function nativeJevChecklist(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawChecks = rawInput.checks ?? rawInput.options ?? rawInput.criteria;
  const checks = normalizeChecklistItems(rawChecks);
  const checkKeys = Object.keys(checks);
  if (checkKeys.length < 1) {
    throw new SaVmInputError("action 'jev_checklist' requires at least 1 check item in 'checks'");
  }
  if (checkKeys.length > 8) {
    for (const k of checkKeys.slice(8)) {
      delete checks[k];
    }
  }

  const context = truncateJevContext(rawInput.context ?? rawInput.content ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const questions: Record<string, unknown> = {};
  for (const [key, desc] of Object.entries(checks)) {
    questions[key] = {
      type: "choice",
      instructions: `Does the provided code/context satisfy this requirement: ${desc}?`,
      criteria: {
        pass: `Yes, satisfied: ${desc}`,
        fail: `No, not satisfied or violated: ${desc}`,
      },
    };
  }

  const payload = {
    state: `[Context to Verify]\n${context}`,
    model: creds.model,
    questions,
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV checklist failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const checkResults: Record<string, { passed: boolean; confidence: number; choice: string; description: string }> = {};

  let passedCount = 0;
  const totalCount = Object.keys(checks).length;

  for (const [key, desc] of Object.entries(checks)) {
    const ans = answers[key] ?? {};
    const choice = typeof ans.choice === "string" ? ans.choice.trim().toLowerCase() : "";
    const confidence = typeof ans.confidence === "number" && Number.isFinite(ans.confidence) ? ans.confidence : 1.0;
    const passed = choice === "pass";
    if (passed) passedCount += 1;

    checkResults[key] = {
      passed,
      confidence,
      choice,
      description: desc,
    };
  }

  const allPassed = passedCount === totalCount;
  const summaryLines = [
    `【JEV 交付自检清单结果】`,
    `• 总体判定：${allPassed ? "✅ 全部通过" : `⚠️ ${totalCount - passedCount} 项未通过`} (${passedCount}/${totalCount})`,
    `• 逐项结果：`,
  ];
  for (const [key, item] of Object.entries(checkResults)) {
    const icon = item.passed ? "✅ 通过" : "❌ 未通过";
    const conf = Math.round(item.confidence * 100);
    summaryLines.push(`  - [${key}] ${icon} (${conf}%): ${item.description}`);
  }
  summaryLines.push(`• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`);

  const outputObject = {
    action: "jev_checklist",
    all_passed: allPassed,
    passed_count: passedCount,
    total_count: totalCount,
    checks: checkResults,
    summary: summaryLines.join("\n"),
    latencyMs: callResult.latencyMs,
    raw: rootData,
  };

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify(outputObject, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/**
 * Autonomous raw JEV evaluate (通用原生评估).
 */
export async function nativeJevEvaluate(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const questions = (rawInput as Record<string, unknown>).questions as Record<string, unknown> | undefined;
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) {
    throw new SaVmInputError("action 'jev_evaluate' requires a 'questions' object");
  }

  const state = truncateJevContext(rawInput.context ?? rawInput.content ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const payload = {
    state,
    model: creds.model,
    questions,
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV evaluate failed: ${callResult.error}`,
      saVmEvents: [],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify(callResult.data, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Reserved JEV thinking verdict: enough information, act now instead of further thinking. */
export const JEV_ACT_NOW_KEY = "__act_now";
export const JEV_ACT_NOW_DESC = "已有足够信息，直接行动，避免过度思考";

/** Fixed red-team risk taxonomy for `jev_redteam` (keys are stable verdict codes). */
export const JEV_REDTEAM_RISKS: Record<string, string> = {
  data_loss: "数据丢失/污染：迁移、删除、重命名、并发写覆盖导致数据不可恢复",
  security_hole: "安全缺口：鉴权绕过、越权、密钥/凭据泄露、注入面扩大",
  race_condition: "竞态与一致性：并发、时序、缓存/订阅状态错乱、双写冲突",
  compat_break: "兼容性断裂：公开 API/存储格式/协议变更，老客户端与历史数据遭殃",
  silent_wrong: "静默错误：不报错但结果错，最难发现（金额、权限判定、计费）",
  perf_regression: "性能退化：慢查询、N+1、内存泄漏、上下文爆炸拖垮服务",
  rollback_impossible: "无法回滚：一旦上线出问题，没有安全回退路径",
  scope_creep: "范围蔓延：改动超出目标，把不相关模块拖下水",
};

/** Go / no-go verdict options for `jev_redteam`. */
export const JEV_REDTEAM_VERDICTS: Record<string, string> = {
  proceed: "可按原计划执行，未发现阻塞性风险",
  harden_first: "先加固再执行：补测试、回滚方案、灰度或 feature flag 后再上",
  stop: "风险过高，建议推倒重来或大幅缩小范围",
};

/**
 * Advisory red-team review (红队找茬, purely opt-in).
 * The model submits a target plan/decision; JEV returns the most likely
 * failure mode (fixed risk taxonomy) plus a go / harden-first / stop verdict.
 * Complements `jev_choose` (which picks among the model's own options) by
 * pointing at blind spots the model did not list.
 */
export async function nativeJevRedteam(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawTarget = (rawInput as Record<string, unknown>).target
    ?? rawInput.question
    ?? (rawInput as Record<string, unknown>).prompt;
  const target = (rawTarget ?? "").toString().trim();
  if (!target) {
    throw new SaVmInputError("action 'jev_redteam' requires a non-empty 'target' parameter");
  }

  const context = truncateJevContext(rawInput.context ?? rawInput.content ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const payload = {
    state: `[Red-Team Target]\n${target}\n\n[Context]\n${context}`,
    model: creds.model,
    questions: {
      primary_risk: {
        type: "choice",
        instructions: `Which failure mode is most likely if this plan is executed as described? Target: ${target}`,
        criteria: JEV_REDTEAM_RISKS,
      },
      verdict: {
        type: "choice",
        instructions: `Given the most likely failure mode above, can this plan proceed? Target: ${target}`,
        criteria: JEV_REDTEAM_VERDICTS,
      },
    },
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV red-team review failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const riskAnswer = answers.primary_risk ?? {};
  const verdictAnswer = answers.verdict ?? {};
  const riskKey = typeof riskAnswer.choice === "string" ? riskAnswer.choice.trim() : "";
  const riskConfidence = typeof riskAnswer.confidence === "number" && Number.isFinite(riskAnswer.confidence)
    ? riskAnswer.confidence
    : 1.0;
  const verdictKey = typeof verdictAnswer.choice === "string" ? verdictAnswer.choice.trim() : "";
  const verdictConfidence = typeof verdictAnswer.confidence === "number" && Number.isFinite(verdictAnswer.confidence)
    ? verdictAnswer.confidence
    : 1.0;
  const riskDesc = JEV_REDTEAM_RISKS[riskKey] || JEV_REDTEAM_RISKS[riskKey.toLowerCase()] || riskKey;
  const verdictDesc = JEV_REDTEAM_VERDICTS[verdictKey] || verdictKey;

  const summary = [
    `【JEV 红队审查】`,
    `• 最可能翻车点：[${riskKey}] ${riskDesc}（置信度 ${Math.round(riskConfidence * 100)}%）`,
    `• 裁决：[${verdictKey}] ${verdictDesc}（置信度 ${Math.round(verdictConfidence * 100)}%）`,
    `• 目标：${target}`,
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_redteam",
      target,
      primary_risk: riskKey,
      risk_confidence: riskConfidence,
      risk_description: riskDesc,
      verdict: verdictKey,
      verdict_confidence: verdictConfidence,
      verdict_description: verdictDesc,
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/**
 * Advisory pre-thinking adjudication (思考前裁决, purely opt-in).
 * The model lists 1~4 candidate lines of thought for a goal; JEV picks the
 * most promising one or returns the built-in `__act_now` brake verdict.
 * Never blocks: on failure/timeout the caller falls back to model_decide.
 */
export async function nativeJevThinking(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawGoal = (rawInput as Record<string, unknown>).goal
    ?? rawInput.question
    ?? (rawInput as Record<string, unknown>).query
    ?? (rawInput as Record<string, unknown>).prompt
    ?? (rawInput as Record<string, unknown>).task
    ?? rawInput.content;
  const goal = (rawGoal ?? "").toString().trim();
  if (!goal) {
    throw new SaVmInputError("action 'jev_thinking' requires a non-empty 'goal' parameter");
  }

  const rawThoughts = (rawInput as Record<string, unknown>).thoughts
    ?? rawInput.options
    ?? rawInput.criteria
    ?? (rawInput as Record<string, unknown>).choices;
  const thoughts = normalizeChoiceOptions(rawThoughts);
  let thoughtKeys = Object.keys(thoughts);
  if (thoughtKeys.length < 1) {
    throw new SaVmInputError("action 'jev_thinking' requires at least 1 thought in 'thoughts'");
  }
  if (thoughtKeys.length > 4) {
    // Truncate to first 4 thoughts; the brake option always stays.
    for (const k of thoughtKeys.slice(4)) {
      delete thoughts[k];
    }
    thoughtKeys = Object.keys(thoughts);
  }
  if (JEV_ACT_NOW_KEY in thoughts) {
    throw new SaVmInputError(`thought key '${JEV_ACT_NOW_KEY}' is reserved for the act-now brake verdict`);
  }

  const context = truncateJevContext(rawInput.context ?? rawInput.content ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const payload = {
    state: `[Thinking Goal]\n${goal}\n\n[Context]\n${context}`,
    model: creds.model,
    questions: {
      direction: {
        type: "choice",
        instructions: `Which line of thought should be pursued for this goal, or is there enough information to act now without further thinking? Goal: ${goal}`,
        criteria: {
          ...thoughts,
          [JEV_ACT_NOW_KEY]: JEV_ACT_NOW_DESC,
        },
      },
    },
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV thinking adjudication failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const directionAnswer = answers.direction ?? {};
  const chosenKey = typeof directionAnswer.choice === "string" ? directionAnswer.choice.trim() : "";
  const confidence = typeof directionAnswer.confidence === "number" && Number.isFinite(directionAnswer.confidence)
    ? directionAnswer.confidence
    : 1.0;
  const actNow = chosenKey === JEV_ACT_NOW_KEY;
  const chosenDesc = actNow
    ? JEV_ACT_NOW_DESC
    : (thoughts[chosenKey] || thoughts[chosenKey.toLowerCase()] || chosenKey);

  const confPercent = Math.round(confidence * 100);
  const summary = actNow
    ? [
      `【JEV 思考裁决结果】`,
      `• 裁决：无需再想，直接行动（置信度 ${confPercent}%）`,
      `• 目标：${goal}`,
      `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
    ].join("\n")
    : [
      `【JEV 思考裁决结果】`,
      `• 建议深入思路：[${chosenKey}]（置信度 ${confPercent}%）`,
      `• 思路描述：${chosenDesc}`,
      `• 目标：${goal}`,
      `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
    ].join("\n");

  const outputObject = {
    action: "jev_thinking",
    goal,
    choice: chosenKey,
    act_now: actNow,
    confidence,
    description: chosenDesc,
    all_thoughts: thoughts,
    summary,
    latencyMs: callResult.latencyMs,
    raw: rootData,
  };

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify(outputObject, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Size verdict options for `jev_scope`. */
export const JEV_SCOPE_VERDICTS: Record<string, string> = {
  right_sized: "大小合适，一次可交付，无需拆分或合并",
  split_2_3: "太大，建议拆成 2~3 个可独立交付的子任务",
  split_many: "太大，建议拆成 4 个以上子任务或先切出 MVP",
  merge: "太小，建议合并到相邻任务一起做，避免碎片化",
};

/** Per-constraint status options for `jev_consistency`. */
export const JEV_CONSISTENCY_STATUS: Record<string, string> = {
  holds: "计划满足该约束",
  violated: "计划违反该约束，必须修改计划",
  unclear: "上下文不足，无法判定是否满足",
};

/**
 * Advisory top-k ranking (排序, purely opt-in).
 * The model submits 2~6 items with a ranking criterion; JEV picks rank_1..rank_k
 * (k = min(n, 3)) as separate choice questions. The server dedupes repeated
 * picks and appends unranked items in submission order.
 */
export async function nativeJevRank(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawItems = (rawInput as Record<string, unknown>).items
    ?? rawInput.options
    ?? (rawInput as Record<string, unknown>).choices;
  const items = normalizeChoiceOptions(rawItems);
  let itemKeys = Object.keys(items);
  if (itemKeys.length < 2) {
    throw new SaVmInputError("action 'jev_rank' requires at least 2 items in 'items'");
  }
  if (itemKeys.length > 6) {
    for (const k of itemKeys.slice(6)) {
      delete items[k];
    }
    itemKeys = Object.keys(items);
  }
  const rawCriterion = (rawInput as Record<string, unknown>).criterion
    ?? (rawInput as Record<string, unknown>).criteria
    ?? rawInput.question;
  const criterion = (rawCriterion ?? "overall value").toString().trim() || "overall value";

  const context = truncateJevContext(rawInput.context ?? rawInput.content ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const rankCount = Math.min(itemKeys.length, 3);
  const questions: Record<string, unknown> = {};
  for (let rank = 1; rank <= rankCount; rank++) {
    questions[`rank_${rank}`] = {
      type: "choice",
      instructions: rank === 1
        ? `Which item ranks #1 by ${criterion}?`
        : `Which item ranks #${rank} by ${criterion}? Do NOT repeat items already chosen for higher ranks.`,
      criteria: items,
    };
  }

  const payload = {
    state: `[Ranking Criterion]\n${criterion}\n\n[Context]\n${context}`,
    model: creds.model,
    questions,
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV ranking failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const ranking: Array<{ key: string; description: string; rank: number; confidence: number }> = [];
  const picked = new Set<string>();
  for (let rank = 1; rank <= rankCount; rank++) {
    const answer = answers[`rank_${rank}`] ?? {};
    const rawKey = typeof answer.choice === "string" ? answer.choice.trim() : "";
    const key = items[rawKey] !== undefined ? rawKey : items[rawKey.toLowerCase()] !== undefined ? rawKey.toLowerCase() : "";
    if (!key || picked.has(key)) continue;
    picked.add(key);
    const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
      ? answer.confidence
      : 1.0;
    ranking.push({ key, description: items[key] ?? key, rank, confidence });
  }
  const unranked = itemKeys.filter((k) => !picked.has(k));

  const summary = [
    `【JEV 排序（${criterion}）】`,
    ...ranking.map((entry) => `• #${entry.rank} [${entry.key}] ${entry.description}（置信度 ${Math.round(entry.confidence * 100)}%）`),
    ...(unranked.length > 0 ? [`• 未入围：${unranked.map((k) => `[${k}]`).join("、")}`] : []),
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_rank",
      criterion,
      ranking,
      unranked,
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/**
 * Advisory task-scope triage (范围把关, purely opt-in).
 * The model submits a task (optionally with candidate split phases); JEV
 * returns a size verdict and, when phases are given, the weakest unit.
 */
export async function nativeJevScope(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawTask = (rawInput as Record<string, unknown>).task
    ?? rawInput.question
    ?? (rawInput as Record<string, unknown>).prompt
    ?? (rawInput as Record<string, unknown>).goal
    ?? rawInput.content;
  const task = (rawTask ?? "").toString().trim();
  if (!task) {
    throw new SaVmInputError("action 'jev_scope' requires a non-empty 'task' parameter");
  }
  const rawPhases = (rawInput as Record<string, unknown>).phases
    ?? rawInput.options
    ?? (rawInput as Record<string, unknown>).units;
  const phases = normalizeChoiceOptions(rawPhases);
  let phaseKeys = Object.keys(phases);
  if (phaseKeys.length > 6) {
    for (const k of phaseKeys.slice(6)) {
      delete phases[k];
    }
    phaseKeys = Object.keys(phases);
  }

  const context = truncateJevContext(rawInput.context ?? rawInput.content ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const questions: Record<string, unknown> = {
    size: {
      type: "choice",
      instructions: `Is this task rightly sized for a single delivery? Task: ${task}`,
      criteria: JEV_SCOPE_VERDICTS,
    },
  };
  if (phaseKeys.length > 0) {
    questions["weakest_unit"] = {
      type: "choice",
      instructions: `Which candidate split unit is riskiest or least clearly defined? Task: ${task}`,
      criteria: phases,
    };
  }

  const payload = {
    state: `[Task]\n${task}\n\n[Context]\n${context}`,
    model: creds.model,
    questions,
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV scope triage failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const sizeAnswer = answers.size ?? {};
  const sizeKey = typeof sizeAnswer.choice === "string" ? sizeAnswer.choice.trim() : "";
  const sizeConfidence = typeof sizeAnswer.confidence === "number" && Number.isFinite(sizeAnswer.confidence)
    ? sizeAnswer.confidence
    : 1.0;
  let weakestUnit = "";
  let weakestConfidence = 1.0;
  if (phaseKeys.length > 0) {
    const weakestAnswer = answers.weakest_unit ?? {};
    const rawWeakest = typeof weakestAnswer.choice === "string" ? weakestAnswer.choice.trim() : "";
    weakestUnit = phases[rawWeakest] !== undefined ? rawWeakest : "";
    weakestConfidence = typeof weakestAnswer.confidence === "number" && Number.isFinite(weakestAnswer.confidence)
      ? weakestAnswer.confidence
      : 1.0;
  }

  const summary = [
    `【JEV 范围把关】`,
    `• 体量裁决：[${sizeKey}] ${JEV_SCOPE_VERDICTS[sizeKey] || sizeKey}（置信度 ${Math.round(sizeConfidence * 100)}%）`,
    ...(weakestUnit ? [`• 最弱环节：[${weakestUnit}] ${phases[weakestUnit]}（置信度 ${Math.round(weakestConfidence * 100)}%）`] : []),
    `• 任务：${task}`,
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_scope",
      task,
      size_verdict: sizeKey,
      size_confidence: sizeConfidence,
      size_description: JEV_SCOPE_VERDICTS[sizeKey] || sizeKey,
      weakest_unit: weakestUnit || null,
      weakest_confidence: weakestConfidence,
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Dispatch strategy verdicts for `jev_dispatch` (subagents 分配前门禁). */
export const JEV_DISPATCH_STRATEGIES: Record<string, string> = {
  single: "单 agent 直做，无需拆分或派 subagents",
  parallel: "子任务相互独立，可并行派多个 subagents",
  sequential: "子任务有依赖，必须串行执行，一次只派一个",
  parallel_batches: "部分独立部分依赖，按批次并行，每批内并行、批间串行",
};

/**
 * Advisory subagent-dispatch gate (分配前门禁, purely opt-in but REQUIRED before Task/subagents).
 * The model submits a task plus optional candidate subtasks (2~6); JEV returns
 * a dispatch strategy (single/parallel/sequential/parallel_batches), the weakest
 * unit, and a deterministic dispatch_plan with parallelism. Bridge-safe:
 * task<=question, subtasks<=options, constraints<=context, slots<=target.
 */
export async function nativeJevDispatch(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawTask = (rawInput as Record<string, unknown>).task
    ?? rawInput.question
    ?? (rawInput as Record<string, unknown>).prompt
    ?? (rawInput as Record<string, unknown>).goal
    ?? rawInput.content;
  const task = (rawTask ?? "").toString().trim();
  if (!task) {
    throw new SaVmInputError("action 'jev_dispatch' requires a non-empty 'task' parameter (alias: 'question')");
  }
  const rawSubtasks = (rawInput as Record<string, unknown>).subtasks
    ?? rawInput.options
    ?? (rawInput as Record<string, unknown>).items
    ?? (rawInput as Record<string, unknown>).phases
    ?? (rawInput as Record<string, unknown>).choices;
  const hasSubtasks = rawSubtasks !== undefined && rawSubtasks !== null
    && (typeof rawSubtasks !== "string" || rawSubtasks.trim() !== "");
  const subtasks = normalizeChoiceOptions(rawSubtasks);
  let subtaskKeys = Object.keys(subtasks);
  if (hasSubtasks && subtaskKeys.length === 1) {
    throw new SaVmInputError("action 'jev_dispatch' requires at least 2 subtasks in 'options' when subtasks are provided (or omit 'options' for single-vs-split verdict)");
  }
  if (subtaskKeys.length > 6) {
    for (const k of subtaskKeys.slice(6)) {
      delete subtasks[k];
    }
    subtaskKeys = Object.keys(subtasks);
  }

  const context = truncateJevContext(rawInput.context ?? (rawInput as Record<string, unknown>).state);
  const slotHint = ((rawInput as Record<string, unknown>).target ?? "").toString().trim();
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const subtaskList = subtaskKeys.length > 0
    ? subtaskKeys.map((k) => `[${k}] ${subtasks[k]}`).join("\n")
    : "(none — judge single vs need_split)";
  const questions: Record<string, unknown> = {
    strategy: {
      type: "choice",
      instructions: `Before spawning subagents, which dispatch strategy fits this task? Task: ${task}`,
      criteria: JEV_DISPATCH_STRATEGIES,
    },
  };
  if (subtaskKeys.length > 0) {
    questions["weakest_unit"] = {
      type: "choice",
      instructions: `Which candidate subtask is riskiest or least clearly defined? Task: ${task}`,
      criteria: subtasks,
    };
  }

  const payload = {
    state: `[Task]\n${task}\n\n[Candidate Subtasks]\n${subtaskList}\n\n[Constraints]\n${context}\n\n[Slots]\n${slotHint || "(no slot hint)"}`,
    model: creds.model,
    questions,
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV dispatch gate failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const strategyAnswer = answers.strategy ?? {};
  const rawStrategy = typeof strategyAnswer.choice === "string" ? strategyAnswer.choice.trim().toLowerCase() : "";
  const strategy = JEV_DISPATCH_STRATEGIES[rawStrategy] !== undefined ? rawStrategy : "single";
  const strategyConfidence = typeof strategyAnswer.confidence === "number" && Number.isFinite(strategyAnswer.confidence)
    ? strategyAnswer.confidence
    : 1.0;
  let weakestUnit = "";
  let weakestConfidence = 1.0;
  if (subtaskKeys.length > 0) {
    const weakestAnswer = answers.weakest_unit ?? {};
    const rawWeakest = typeof weakestAnswer.choice === "string" ? weakestAnswer.choice.trim() : "";
    weakestUnit = subtasks[rawWeakest] !== undefined ? rawWeakest : "";
    weakestConfidence = typeof weakestAnswer.confidence === "number" && Number.isFinite(weakestAnswer.confidence)
      ? weakestAnswer.confidence
      : 1.0;
  }

  const slotMatch = `${slotHint}\n${context}`.match(/max_parallel\s*=\s*(\d+)/i);
  const hintedParallel = slotMatch ? Math.max(1, Math.min(8, parseInt(slotMatch[1]!, 10))) : 0;
  const n = subtaskKeys.length;
  const parallelism = hintedParallel > 0 ? hintedParallel
    : strategy === "single" ? 1
    : strategy === "sequential" ? 1
    : n === 0 ? 1
    : strategy === "parallel" ? Math.max(1, Math.min(8, n))
    : Math.max(1, Math.min(4, n));
  const dispatchPlan = n === 0 || strategy === "single"
    ? [{ key: "single", description: task, batch: 1 }]
    : strategy === "sequential"
    ? subtaskKeys.map((k, i) => ({ key: k, description: subtasks[k] ?? k, batch: i + 1 }))
    : strategy === "parallel"
    ? subtaskKeys.map((k) => ({ key: k, description: subtasks[k] ?? k, batch: 1 }))
    : subtaskKeys.map((k, i) => ({ key: k, description: subtasks[k] ?? k, batch: i < Math.ceil(n / 2) ? 1 : 2 }));

  const summary = [
    `【JEV 分配门禁】`,
    `• 策略：[${strategy}] ${JEV_DISPATCH_STRATEGIES[strategy] || strategy}（置信度 ${Math.round(strategyConfidence * 100)}%）`,
    ...(weakestUnit ? [`• 最弱环节：[${weakestUnit}] ${subtasks[weakestUnit]}（置信度 ${Math.round(weakestConfidence * 100)}%）`] : []),
    `• 并行度：${parallelism}`,
    `• 任务：${task}`,
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_dispatch",
      task,
      strategy,
      strategy_confidence: strategyConfidence,
      strategy_description: JEV_DISPATCH_STRATEGIES[strategy] || strategy,
      subtasks,
      weakest_unit: weakestUnit || null,
      weakest_confidence: weakestConfidence,
      parallelism,
      dispatch_plan: dispatchPlan,
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/**
 * Advisory plan-vs-constraints audit (一致性审计, purely opt-in).
 * Unlike `jev_checklist` (which audits whether evidence satisfies checks),
 * this judges whether the PLAN itself violates each hard constraint:
 * per-constraint {holds, violated, unclear} plus an overall verdict.
 */
export async function nativeJevConsistency(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawPlan = (rawInput as Record<string, unknown>).plan
    ?? rawInput.question
    ?? (rawInput as Record<string, unknown>).prompt
    ?? rawInput.content;
  const plan = (rawPlan ?? "").toString().trim();
  if (!plan) {
    throw new SaVmInputError("action 'jev_consistency' requires a non-empty 'plan' parameter");
  }
  const rawConstraints = (rawInput as Record<string, unknown>).constraints
    ?? rawInput.checks
    ?? (rawInput as Record<string, unknown>).criteria;
  const constraints = normalizeChecklistItems(rawConstraints);
  const constraintKeys = Object.keys(constraints);
  if (constraintKeys.length < 1) {
    throw new SaVmInputError("action 'jev_consistency' requires at least 1 constraint in 'constraints'");
  }
  if (constraintKeys.length > 8) {
    for (const k of constraintKeys.slice(8)) {
      delete constraints[k];
    }
  }

  const context = truncateJevContext(rawInput.context ?? rawInput.content ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const questions: Record<string, unknown> = {};
  for (const key of Object.keys(constraints)) {
    questions[key] = {
      type: "choice",
      instructions: `Does the plan violate this constraint? Constraint: ${constraints[key]}`,
      criteria: JEV_CONSISTENCY_STATUS,
    };
  }

  const payload = {
    state: `[Plan]\n${plan}\n\n[Context]\n${context}`,
    model: creds.model,
    questions,
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV consistency audit failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const details: Record<string, { status: string; confidence: number; description: string }> = {};
  let violatedCount = 0;
  let unclearCount = 0;
  for (const key of Object.keys(constraints)) {
    const answer = answers[key] ?? {};
    const rawStatus = typeof answer.choice === "string" ? answer.choice.trim().toLowerCase() : "";
    const status = rawStatus === "violated" || rawStatus === "unclear" ? rawStatus : "holds";
    const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
      ? answer.confidence
      : 1.0;
    if (status === "violated") violatedCount += 1;
    if (status === "unclear") unclearCount += 1;
    details[key] = { status, confidence, description: constraints[key] ?? key };
  }
  const consistent = violatedCount === 0;
  const total = Object.keys(constraints).length;

  const summary = [
    `【JEV 一致性审计】`,
    `• 总体：${consistent ? "一致" : "存在违反"}（${total - violatedCount}/${total} 通过${unclearCount > 0 ? `，${unclearCount} 项存疑` : ""}）`,
    ...Object.entries(details).map(([key, entry]) =>
      entry.status === "holds"
        ? `• [${key}] ✅ 满足（置信度 ${Math.round(entry.confidence * 100)}%）`
        : entry.status === "violated"
          ? `• [${key}] ❌ 违反（置信度 ${Math.round(entry.confidence * 100)}%）：${entry.description}`
          : `• [${key}] ❓ 存疑（置信度 ${Math.round(entry.confidence * 100)}%）：${entry.description}`),
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_consistency",
      plan,
      consistent,
      violated_count: violatedCount,
      unclear_count: unclearCount,
      total_count: total,
      constraints: details,
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Completion states for `jev_done`. */
export const JEV_DONE_STATES: Record<string, string> = {
  truly_completed: "原始要求均有实际代码和测试支撑，无偷工减料",
  incomplete_with_todos: "遗留 TODO、跳过未测或只完成部分子项",
  unverified_claim: "宣称完成但缺乏可信验证证据（未跑测试/编译）",
  diverged: "解决的问题并非用户最初要的问题",
};

/** Delivery verdicts for `jev_done`. */
export const JEV_DONE_VERDICTS: Record<string, string> = {
  deliver_to_user: "可向用户汇报交付",
  keep_working: "存在缺口，必须继续工作，不得交差",
};

/**
 * Splits a bridge-packed triple back into sections. Only used when the caller
 * could only send `question` (bridge drops every other jev_done field).
 * Markers (case-insensitive): 原始需求/原始请求/[Original Request] for the
 * request, 实际工作/[Actual Work] for the work, 证据/验证证据/[Verification
 * Evidence]/[Evidence] for the evidence. Returns only sections found.
 */
export function splitPackedDoneSections(text: string): { request?: string; work?: string; evidence?: string } {
  const lower = text.toLowerCase();
  const workMarkers = ["[actual work]", "实际工作"];
  const evMarkers = ["[verification evidence]", "[evidence]", "验证证据", "验证结果", "证据"];
  const reqMarkers = ["[original request]", "原始需求", "原始请求"];
  const firstIndexOf = (haystack: string, markers: string[]): number => {
    let best = -1;
    for (const marker of markers) {
      const i = haystack.indexOf(marker);
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    return best;
  };
  const workIdx = firstIndexOf(lower, workMarkers);
  if (workIdx < 0) return {};
  const requestPart = text.slice(0, workIdx).trim();
  const rest = text.slice(workIdx).replace(/^(\[actual work\]|实际工作)\s*[:：|]?\s*/i, "");
  const evIdx = firstIndexOf(rest.toLowerCase(), evMarkers);
  const workPart = (evIdx >= 0 ? rest.slice(0, evIdx) : rest).trim();
  const evPart = evIdx >= 0
    ? rest.slice(evIdx).replace(/^(\[verification evidence\]|\[evidence\]|验证证据|验证结果|证据)\s*[:：|]?\s*/i, "").trim()
    : "";
  let reqOut = requestPart;
  const reqIdx = firstIndexOf(requestPart.toLowerCase(), reqMarkers);
  if (reqIdx >= 0) {
    const matched = reqMarkers
      .filter((m) => requestPart.toLowerCase().indexOf(m) === reqIdx)
      .sort((a, b) => b.length - a.length);
    const marker = matched[0] ?? "";
    reqOut = requestPart.slice(reqIdx + marker.length).replace(/^[\s:：|]+/, "").trim();
  }
  return {
    request: reqOut || undefined,
    work: workPart || undefined,
    evidence: evPart || undefined,
  };
}

/**
 * Advisory delivery sign-off (交付核准, purely opt-in).
 * Before telling the user "done", the model submits the original request,
 * the actual work and the verification evidence; JEV judges the completion
 * state plus an explicit deliver / keep-working verdict. Counters false
 * completion (TODO leftovers, unverified claims, diverged work).
 */
export async function nativeJevDone(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawRequest = (rawInput as Record<string, unknown>).user_request
    ?? (rawInput as Record<string, unknown>).request
    ?? rawInput.question
    ?? (rawInput as Record<string, unknown>).goal
    ?? (rawInput as Record<string, unknown>).prompt;
  const userRequest = (rawRequest ?? "").toString().trim();
  if (!userRequest) {
    throw new SaVmInputError("action 'jev_done' requires a non-empty 'user_request' parameter");
  }
  const rawWork = (rawInput as Record<string, unknown>).actual_work
    ?? (rawInput as Record<string, unknown>).work
    ?? rawInput.content
    // Bridge compat: the opencode sa_vm_run bridge forwards question+context
    // for jev_done but drops content/user_request/actual_work/evidence, so the
    // packed triple may arrive via context (see .opencode/skills/jev/SKILL.md).
    ?? rawInput.context;
  let actualWork = (rawWork ?? "").toString().trim();
  let evidence = (((rawInput as Record<string, unknown>).evidence) ?? "").toString().trim();
  let packedRequest = userRequest;
  // Last resort: only `question` survived transit. Callers may pack the whole
  // triple into it with section markers (原始需求/实际工作/证据 or
  // [Original Request]/[Actual Work]/[Verification Evidence]); split it back.
  // Only triggers when actual_work is otherwise empty, so direct callers that
  // pass actual_work explicitly are never affected.
  if (!actualWork && packedRequest) {
    const sections = splitPackedDoneSections(packedRequest);
    if (sections.work) {
      if (sections.request) packedRequest = sections.request;
      actualWork = sections.work;
      if (sections.evidence) evidence = sections.evidence;
    }
  }
  if (!actualWork) {
    throw new SaVmInputError("action 'jev_done' requires a non-empty 'actual_work' parameter");
  }

  const context = truncateJevContext(rawInput.context ?? rawInput.content ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const payload = {
    state: `[Original Request]\n${packedRequest}\n\n[Actual Work]\n${actualWork || "(not described)"}\n\n[Verification Evidence]\n${evidence || "(no evidence provided)"}\n\n[Context]\n${context}`,
    model: creds.model,
    questions: {
      completion: {
        type: "choice",
        instructions: "Does the actual work with its evidence truly fulfill the original request?",
        criteria: JEV_DONE_STATES,
      },
      delivery: {
        type: "choice",
        instructions: "Should this be delivered to the user now, or must work continue?",
        criteria: JEV_DONE_VERDICTS,
      },
    },
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV delivery sign-off failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const completionAnswer = answers.completion ?? {};
  const deliveryAnswer = answers.delivery ?? {};
  const completionKey = typeof completionAnswer.choice === "string" ? completionAnswer.choice.trim() : "";
  const completionConfidence = typeof completionAnswer.confidence === "number" && Number.isFinite(completionAnswer.confidence)
    ? completionAnswer.confidence
    : 1.0;
  const deliveryKey = typeof deliveryAnswer.choice === "string" ? deliveryAnswer.choice.trim() : "";
  const deliveryConfidence = typeof deliveryAnswer.confidence === "number" && Number.isFinite(deliveryAnswer.confidence)
    ? deliveryAnswer.confidence
    : 1.0;

  // Audit historical regression cases touched by the request/work/evidence
  const allCases = loadRegressionCases(undefined, (rawInput as Record<string, unknown>).cwd as string | undefined);
  const auditedCases = allCases.filter((c: RegressionCase) => {
    const cBase = basename(c.component).toLowerCase();
    const cId = c.id.toLowerCase();
    return actualWork.toLowerCase().includes(cBase)
      || userRequest.toLowerCase().includes(cBase)
      || evidence.toLowerCase().includes(cBase)
      || evidence.toLowerCase().includes(cId);
  });

  const summary = [
    `【JEV 交付核准】`,
    `• 完成态：[${completionKey}] ${JEV_DONE_STATES[completionKey] || completionKey}（置信度 ${Math.round(completionConfidence * 100)}%）`,
    `• 裁决：[${deliveryKey}] ${JEV_DONE_VERDICTS[deliveryKey] || deliveryKey}（置信度 ${Math.round(deliveryConfidence * 100)}%）`,
    ...(auditedCases.length > 0 ? [
      `• 历史案例审计：关联到 ${auditedCases.length} 个历史防回归案例 [${auditedCases.map((c: RegressionCase) => c.id).join(", ")}]`
    ] : []),
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_done",
      user_request: userRequest,
      completion_state: completionKey,
      completion_confidence: completionConfidence,
      delivery: deliveryKey,
      delivery_confidence: deliveryConfidence,
      historical_regression_cases_audited: auditedCases.map((c: RegressionCase) => ({ id: c.id, title: c.title, component: c.component })),
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Fix-nature verdicts for `jev_diagnose`. */
export const JEV_FIX_NATURE: Record<string, string> = {
  root_cause_fix: "治本：修复真正根因",
  symptom_patch: "治标：防御性补丁，缓解症状但根因仍在",
  risky_mask: "掩盖：可能隐藏真正错误，制造更大隐患",
};

/**
 * Advisory root-cause arbitration (根因仲裁, purely opt-in).
 * Given an error/failure plus 2~4 hypotheses, JEV picks the most likely true
 * root cause; when a proposed fix is supplied it additionally judges whether
 * the fix cures the cause or merely patches (or masks) the symptom.
 */
export async function nativeJevDiagnose(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawError = (rawInput as Record<string, unknown>).error_summary
    ?? (rawInput as Record<string, unknown>).error
    ?? rawInput.question
    ?? rawInput.content;
  const errorSummary = (rawError ?? "").toString().trim();
  if (!errorSummary) {
    throw new SaVmInputError("action 'jev_diagnose' requires a non-empty 'error_summary' parameter");
  }
  const rawHypotheses = (rawInput as Record<string, unknown>).hypotheses
    ?? rawInput.options
    ?? (rawInput as Record<string, unknown>).causes;
  const hypotheses = normalizeChoiceOptions(rawHypotheses);
  const hypothesisKeys = Object.keys(hypotheses);
  if (hypothesisKeys.length < 2) {
    throw new SaVmInputError("action 'jev_diagnose' requires at least 2 hypotheses in 'hypotheses'");
  }
  if (hypothesisKeys.length > 4) {
    for (const k of hypothesisKeys.slice(4)) {
      delete hypotheses[k];
    }
  }
  const rawFix = (rawInput as Record<string, unknown>).proposed_fix
    ?? (rawInput as Record<string, unknown>).fix;
  const proposedFix = (rawFix ?? "").toString().trim();

  const context = truncateJevContext(rawInput.context ?? rawInput.content ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const questions: Record<string, unknown> = {
    most_likely_cause: {
      type: "choice",
      instructions: `Which hypothesis is the true root cause of this failure? Error: ${errorSummary}`,
      criteria: hypotheses,
    },
  };
  if (proposedFix) {
    questions["fix_nature"] = {
      type: "choice",
      instructions: `Does the proposed fix cure the root cause, merely patch the symptom, or risk masking the real error? Proposed fix: ${proposedFix}`,
      criteria: JEV_FIX_NATURE,
    };
  }

  const payload = {
    state: `[Error]\n${errorSummary}\n\n[Proposed Fix]\n${proposedFix || "(none proposed)"}\n\n[Context]\n${context}`,
    model: creds.model,
    questions,
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV diagnosis failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const causeAnswer = answers.most_likely_cause ?? {};
  const rawCause = typeof causeAnswer.choice === "string" ? causeAnswer.choice.trim() : "";
  const causeKey = hypotheses[rawCause] !== undefined ? rawCause : "";
  const causeConfidence = typeof causeAnswer.confidence === "number" && Number.isFinite(causeAnswer.confidence)
    ? causeAnswer.confidence
    : 1.0;
  let fixNature = "";
  let fixConfidence = 1.0;
  if (proposedFix) {
    const fixAnswer = answers.fix_nature ?? {};
    const rawNature = typeof fixAnswer.choice === "string" ? fixAnswer.choice.trim().toLowerCase() : "";
    fixNature = rawNature === "symptom_patch" || rawNature === "risky_mask" ? rawNature : "root_cause_fix";
    fixConfidence = typeof fixAnswer.confidence === "number" && Number.isFinite(fixAnswer.confidence)
      ? fixAnswer.confidence
      : 1.0;
  }

  const summary = [
    `【JEV 根因仲裁】`,
    `• 最可能根因：[${causeKey || "?"}] ${hypotheses[causeKey] || "未能判定"}（置信度 ${Math.round(causeConfidence * 100)}%）`,
    ...(proposedFix ? [`• 拟定修复性质：[${fixNature}] ${JEV_FIX_NATURE[fixNature]}（置信度 ${Math.round(fixConfidence * 100)}%）`] : []),
    `• 报错：${errorSummary}`,
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_diagnose",
      error_summary: errorSummary,
      most_likely_cause: causeKey || null,
      cause_confidence: causeConfidence,
      cause_description: hypotheses[causeKey] || null,
      proposed_fix: proposedFix || null,
      fix_nature: fixNature || null,
      fix_confidence: fixConfidence,
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Boundary-risk dimensions for `jev_edge_cases` (keys are stable codes). */
export const JEV_EDGE_DIMENSIONS: Record<string, string> = {
  boundary_numbers: "边界数值：0、-1、NaN、MAX_SAFE_INTEGER、越界浮点",
  null_empty_omitted: "空与缺省：空串、空白串、未传可选参数、显式 null",
  encoding_and_symbols: "编码符号：中文 UTF-8、反斜杠转义、emoji、URL 编码字符",
  reentrancy_and_idempotency: "重入幂等：重复调用、并发触发、非幂等副作用",
  abort_and_timeout: "中断超时：处理中途被上游断开、超时、取消信号",
};

/**
 * Advisory boundary-risk screen (边界筛查, purely opt-in).
 * Given a code signature plus implementation, JEV names the 1~2 boundary
 * dimensions most likely to be missed or crash-prone, so the model can add
 * targeted assertions. Counters happy-path-only test habits.
 */
export async function nativeJevEdgeCases(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawCode = (rawInput as Record<string, unknown>).code
    ?? rawInput.content
    ?? (rawInput as Record<string, unknown>).source
    ?? (rawInput as Record<string, unknown>).diff;
  const code = (rawCode ?? "").toString().trim();
  if (!code) {
    throw new SaVmInputError("action 'jev_edge_cases' requires a non-empty 'code' parameter");
  }

  const context = truncateJevContext(rawInput.context ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const payload = {
    state: `[Code Under Review]\n${code.slice(0, 4000)}\n\n[Context]\n${context}`,
    model: creds.model,
    questions: {
      weakest_dimension: {
        type: "choice",
        instructions: "Which boundary dimension is most likely missed or crash-prone in this implementation?",
        criteria: JEV_EDGE_DIMENSIONS,
      },
      runner_up_dimension: {
        type: "choice",
        instructions: "Which boundary dimension is the second most likely missed or crash-prone? Do NOT repeat the weakest one.",
        criteria: JEV_EDGE_DIMENSIONS,
      },
    },
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV edge-case screen failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const pick = (answerKey: string): { key: string; confidence: number } => {
    const answer = answers[answerKey] ?? {};
    const rawKey = typeof answer.choice === "string" ? answer.choice.trim().toLowerCase() : "";
    const key = JEV_EDGE_DIMENSIONS[rawKey] !== undefined ? rawKey : "";
    const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
      ? answer.confidence
      : 1.0;
    return { key, confidence };
  };
  const weakest = pick("weakest_dimension");
  const runnerUpRaw = pick("runner_up_dimension");
  const runnerUp = runnerUpRaw.key && runnerUpRaw.key !== weakest.key ? runnerUpRaw : { key: "", confidence: 1.0 };

  const summary = [
    `【JEV 边界筛查】`,
    `• 最脆弱维度：[${weakest.key || "?"}] ${JEV_EDGE_DIMENSIONS[weakest.key] || "未能判定"}（置信度 ${Math.round(weakest.confidence * 100)}%）`,
    ...(runnerUp.key ? [`• 次脆弱维度：[${runnerUp.key}] ${JEV_EDGE_DIMENSIONS[runnerUp.key]}（置信度 ${Math.round(runnerUp.confidence * 100)}%）`] : []),
    `• 建议：针对上述维度补充断言（空/边界/编码/重入/中断），不要只测 Happy Path`,
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_edge_cases",
      weakest_dimension: weakest.key || null,
      weakest_confidence: weakest.confidence,
      runner_up_dimension: runnerUp.key || null,
      runner_up_confidence: runnerUp.confidence,
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Blast-radius side-effect classes for `jev_blast_radius` (review a DIFF, not a plan). */
export const JEV_BLAST_CLASSES: Record<string, string> = {
  local_only: "纯内部实现优化，零外部依赖泄露",
  api_break: "破坏外部调用方、SDK 或 HTTP/WebSocket 协议格式",
  state_leak: "订阅、Lease、定时器或未清理缓存跨会话残留",
  perf_cliff: "引入 N+1、全表扫描或无上界的上下文堆积",
};

/** Merge verdicts for `jev_blast_radius`. */
export const JEV_BLAST_VERDICTS: Record<string, string> = {
  safe_to_apply: "安全可合入",
  needs_compat_shim: "需补兼容层后再合入",
  needs_regression_tests: "需加固回归测试后再合入",
};

/**
 * Advisory diff blast-radius review (爆炸半径审查, purely opt-in).
 * Unlike `jev_redteam` (which reviews a PLAN before acting), this reviews a
 * concrete DIFF before apply/commit: fixed side-effect classes plus a
 * merge verdict. Use redteam for plans, blast_radius for diffs.
 */
export async function nativeJevBlastRadius(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawDiff = (rawInput as Record<string, unknown>).diff
    ?? rawInput.patch
    ?? rawInput.content;
  const diff = (rawDiff ?? "").toString().trim();
  if (!diff) {
    throw new SaVmInputError("action 'jev_blast_radius' requires a non-empty 'diff' parameter");
  }
  const rawTarget = (rawInput as Record<string, unknown>).target_component
    ?? (rawInput as Record<string, unknown>).target
    ?? (rawInput as Record<string, unknown>).file;
  const targetComponent = (rawTarget ?? "").toString().trim();

  const context = truncateJevContext(rawInput.context ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const payload = {
    state: `[Diff Under Review]${targetComponent ? ` (${targetComponent})` : ""}\n${diff.slice(0, 6000)}\n\n[Context]\n${context}`,
    model: creds.model,
    questions: {
      side_effect: {
        type: "choice",
        instructions: `Which side-effect class best describes this diff?${targetComponent ? ` Target component: ${targetComponent}.` : ""}`,
        criteria: JEV_BLAST_CLASSES,
      },
      merge_verdict: {
        type: "choice",
        instructions: "Can this diff be merged as-is, or what must happen first?",
        criteria: JEV_BLAST_VERDICTS,
      },
    },
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV blast-radius review failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const effectAnswer = answers.side_effect ?? {};
  const verdictAnswer = answers.merge_verdict ?? {};
  const effectKey = typeof effectAnswer.choice === "string" ? effectAnswer.choice.trim().toLowerCase() : "";
  const effect = JEV_BLAST_CLASSES[effectKey] !== undefined ? effectKey : "";
  const effectConfidence = typeof effectAnswer.confidence === "number" && Number.isFinite(effectAnswer.confidence)
    ? effectAnswer.confidence
    : 1.0;
  const rawVerdict = typeof verdictAnswer.choice === "string" ? verdictAnswer.choice.trim().toLowerCase() : "";
  const verdict = JEV_BLAST_VERDICTS[rawVerdict] !== undefined ? rawVerdict : "";
  const verdictConfidence = typeof verdictAnswer.confidence === "number" && Number.isFinite(verdictAnswer.confidence)
    ? verdictAnswer.confidence
    : 1.0;

  // Identify historical regression cases associated with the target component or diff
  const allCases = loadRegressionCases(undefined, (rawInput as Record<string, unknown>).cwd as string | undefined);
  const matchedCases = allCases.filter((c: RegressionCase) => {
    if (targetComponent) {
      const tc = targetComponent.toLowerCase();
      const cc = c.component.toLowerCase();
      if (cc.includes(tc) || tc.includes(basename(cc).toLowerCase())) return true;
    }
    const cBase = basename(c.component).toLowerCase();
    if (diff.toLowerCase().includes(cBase)) return true;
    return false;
  });

  const summary = [
    `【JEV 爆炸半径审查】`,
    `• 副作用分类：[${effect || "?"}] ${JEV_BLAST_CLASSES[effect] || "未能判定"}（置信度 ${Math.round(effectConfidence * 100)}%）`,
    `• 合入裁决：[${verdict || "?"}] ${JEV_BLAST_VERDICTS[verdict] || "未能判定"}（置信度 ${Math.round(verdictConfidence * 100)}%）`,
    ...(targetComponent ? [`• 目标组件：${targetComponent}`] : []),
    ...(matchedCases.length > 0 ? [
      `• 历史回归风险：关联到 ${matchedCases.length} 个历史案例 [${matchedCases.map((c: RegressionCase) => c.id).join(", ")}]`,
      `  建议交付前执行: sa_vm_run({ action: 'replay_case', component: '${targetComponent || matchedCases[0]?.component || ""}' })`
    ] : []),
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_blast_radius",
      target_component: targetComponent || null,
      side_effect: effect || null,
      side_effect_confidence: effectConfidence,
      merge_verdict: verdict || null,
      merge_confidence: verdictConfidence,
      historical_regression_cases: matchedCases.map((c: RegressionCase) => ({ id: c.id, title: c.title, component: c.component })),
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Intent taxonomy for `jev_intent` (keys are stable codes). */
export const JEV_INTENT_TYPES: Record<string, string> = {
  code_change: "代码变更：新增功能、修改逻辑、重构、样式调整",
  bug_fix: "修 Bug：复现、定位根因、修复并补回归测试",
  investigation: "勘察诊断：只读排查、找根因、收敛证据再下结论",
  explanation: "答疑解惑：解释概念、代码逻辑、文档说明",
  review: "评审：审 diff、审方案、找风险与边界遗漏",
  plan: "规划：拆任务、排优先级、定方案",
  test_verify: "验证：跑测试、复现步骤、确认修复效果",
  other: "其他：以上均不贴切，需进一步澄清",
};

/** Clarity verdicts for `jev_intent`. */
export const JEV_INTENT_CLARITY: Record<string, string> = {
  clear: "意图明确，可直接动手",
  needs_clarification: "缺关键信息，动手前必须追问",
  ambiguous: "存在多种合理解读，需用户确认后再动手",
};

/** First-step playbook per intent type (local, deterministic). */
export const JEV_INTENT_FIRST_STEPS: Record<string, string> = {
  code_change: "先定位相关文件与符号，小步修改并验证",
  bug_fix: "先复现并锁定最小复现，再修再补回归测试",
  investigation: "先只读勘察收敛证据，再下结论，不急着改代码",
  explanation: "直接回答，必要时引用文件行号",
  review: "拉取 diff 逐项过风险与边界",
  plan: "先拆范围再排优先级，避免 epic 直接开干",
  test_verify: "先跑相关测试看红绿，再谈结论",
  other: "先向用户确认理解再动手",
};

/**
 * Advisory user-intent analysis (意图分析, purely opt-in).
 * Call right after user input: JEV picks the most likely interpretation
 * (from caller-provided candidates, or from the built-in intent taxonomy)
 * plus a clarity verdict, so the model knows whether to act, ask, or confirm.
 */
export async function nativeJevIntent(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawText = (rawInput as Record<string, unknown>).input
    ?? rawInput.question
    ?? rawInput.content;
  const userText = (rawText ?? "").toString().trim();
  if (!userText) {
    throw new SaVmInputError("action 'jev_intent' requires a non-empty 'question' parameter (the raw user input)");
  }
  const rawOptions = (rawInput as Record<string, unknown>).interpretations
    ?? rawInput.options;
  const hasCandidates = rawOptions !== undefined && rawOptions !== null
    && (typeof rawOptions !== "string" || rawOptions.trim() !== "");
  let candidates: Record<string, string> = {};
  if (hasCandidates) {
    candidates = normalizeChoiceOptions(rawOptions);
    const keys = Object.keys(candidates);
    if (keys.length < 2) {
      throw new SaVmInputError("action 'jev_intent' requires at least 2 candidate interpretations in 'options' (or omit 'options' to use the built-in taxonomy)");
    }
    if (keys.length > 6) {
      for (const k of keys.slice(6)) {
        delete candidates[k];
      }
    }
  }

  const context = truncateJevContext(rawInput.context ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const intentCriteria = hasCandidates ? candidates : JEV_INTENT_TYPES;
  const payload = {
    state: `[User Input]\n${userText}\n\n[Context]\n${context}`,
    model: creds.model,
    questions: {
      primary_intent: {
        type: "choice",
        instructions: `What does the user most likely want? User input: ${userText}`,
        criteria: intentCriteria,
      },
      clarity: {
        type: "choice",
        instructions: `Is the user input clear enough to act on directly, or must the model ask/confirm first? User input: ${userText}`,
        criteria: JEV_INTENT_CLARITY,
      },
    },
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV intent analysis failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const intentAnswer = answers.primary_intent ?? {};
  const rawIntent = typeof intentAnswer.choice === "string" ? intentAnswer.choice.trim() : "";
  const intentKey = intentCriteria[rawIntent] !== undefined ? rawIntent : "";
  const intentConfidence = typeof intentAnswer.confidence === "number" && Number.isFinite(intentAnswer.confidence)
    ? intentAnswer.confidence
    : 1.0;
  const clarityAnswer = answers.clarity ?? {};
  const rawClarity = typeof clarityAnswer.choice === "string" ? clarityAnswer.choice.trim().toLowerCase() : "";
  const clarity = JEV_INTENT_CLARITY[rawClarity] !== undefined ? rawClarity : "";
  const clarityConfidence = typeof clarityAnswer.confidence === "number" && Number.isFinite(clarityAnswer.confidence)
    ? clarityAnswer.confidence
    : 1.0;
  const firstStep = hasCandidates
    ? "按该解读制定计划并着手执行"
    : (JEV_INTENT_FIRST_STEPS[intentKey] ?? "先确认理解再动手");

  const summary = [
    `【JEV 意图分析】`,
    `• 最可能意图：[${intentKey || "?"}] ${intentCriteria[intentKey] || "未能判定"}（置信度 ${Math.round(intentConfidence * 100)}%）`,
    `• 清晰度：[${clarity || "?"}] ${JEV_INTENT_CLARITY[clarity] || "未能判定"}（置信度 ${Math.round(clarityConfidence * 100)}%）`,
    `• 建议第一步：${firstStep}`,
    `• 输入：${userText.slice(0, 200)}`,
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_intent",
      user_input: userText,
      primary_intent: intentKey || null,
      intent_confidence: intentConfidence,
      intent_description: intentCriteria[intentKey] || null,
      clarity: clarity || null,
      clarity_confidence: clarityConfidence,
      clarity_description: JEV_INTENT_CLARITY[clarity] || null,
      suggested_first_step: firstStep,
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Momentum verdicts for `jev_next` (keys are stable codes). */
export const JEV_NEXT_VERDICTS: Record<string, string> = {
  continue_now: "有明确下一步，主动续上",
  confirm_first: "有候选但需用户确认再续",
  stop: "已收尾，无需续接",
};

/**
 * Advisory next-task continuation (续接下一步, purely opt-in).
 * Call right after a task completes: JEV picks the best next task from
 * caller-provided candidates (or judges momentum from context backlog)
 * plus a continue/confirm/stop verdict, so the model can chain work
 * proactively instead of idling after each delivery.
 */
export async function nativeJevNext(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawWork = (rawInput as Record<string, unknown>).completed_work
    ?? (rawInput as Record<string, unknown>).completed
    ?? rawInput.question
    ?? rawInput.content;
  const completedWork = (rawWork ?? "").toString().trim();
  if (!completedWork) {
    throw new SaVmInputError("action 'jev_next' requires a non-empty 'question' parameter (summary of the just-completed work)");
  }
  const rawOptions = (rawInput as Record<string, unknown>).candidates
    ?? rawInput.options;
  const hasCandidates = rawOptions !== undefined && rawOptions !== null
    && (typeof rawOptions !== "string" || rawOptions.trim() !== "");
  let candidates: Record<string, string> = {};
  if (hasCandidates) {
    candidates = normalizeChoiceOptions(rawOptions);
    const keys = Object.keys(candidates);
    if (keys.length < 2) {
      throw new SaVmInputError("action 'jev_next' requires at least 2 candidate next tasks in 'options' (or omit 'options' to judge momentum from context)");
    }
    if (keys.length > 6) {
      for (const k of keys.slice(6)) {
        delete candidates[k];
      }
    }
  }

  const context = truncateJevContext(rawInput.context ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const questions: Record<string, unknown> = {};
  if (hasCandidates) {
    questions["next_task"] = {
      type: "choice",
      instructions: `Given the just-completed work, which candidate should be done next? Completed: ${completedWork}`,
      criteria: candidates,
    };
  }
  questions["momentum"] = {
    type: "choice",
    instructions: hasCandidates
      ? `Should the model continue into the next task immediately, confirm with the user first, or stop? Completed: ${completedWork}`
      : `Based on the completed work and remaining backlog in context, should the model continue working, or is everything done? Completed: ${completedWork}`,
    criteria: JEV_NEXT_VERDICTS,
  };

  const payload = {
    state: `[Completed]\n${completedWork}\n\n[Context]\n${context}`,
    model: creds.model,
    questions,
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV next-task analysis failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  let nextKey = "";
  let nextConfidence = 1.0;
  if (hasCandidates) {
    const nextAnswer = answers.next_task ?? {};
    const rawNext = typeof nextAnswer.choice === "string" ? nextAnswer.choice.trim() : "";
    nextKey = candidates[rawNext] !== undefined ? rawNext : "";
    nextConfidence = typeof nextAnswer.confidence === "number" && Number.isFinite(nextAnswer.confidence)
      ? nextAnswer.confidence
      : 1.0;
  }
  const momentumAnswer = answers.momentum ?? {};
  const rawMomentum = typeof momentumAnswer.choice === "string" ? momentumAnswer.choice.trim().toLowerCase() : "";
  const momentum = JEV_NEXT_VERDICTS[rawMomentum] !== undefined ? rawMomentum : "";
  const momentumConfidence = typeof momentumAnswer.confidence === "number" && Number.isFinite(momentumAnswer.confidence)
    ? momentumAnswer.confidence
    : 1.0;
  const autoContinue = momentum === "continue_now";

  const summary = [
    `【JEV 续接分析】`,
    ...(hasCandidates ? [`• 下一步：[${nextKey || "?"}] ${candidates[nextKey] || "未能判定"}（置信度 ${Math.round(nextConfidence * 100)}%）`] : [`• 候选未给，按上下文 backlog 判定动量`]),
    `• 动量裁决：[${momentum || "?"}] ${JEV_NEXT_VERDICTS[momentum] || "未能判定"}（置信度 ${Math.round(momentumConfidence * 100)}%）`,
    `• 是否主动续上：${autoContinue ? "是（直接开干下一步）" : "否（先确认或收尾）"}`,
    `• 已完成：${completedWork.slice(0, 200)}`,
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_next",
      completed_work: completedWork,
      next_task: nextKey || null,
      next_confidence: nextConfidence,
      next_description: (hasCandidates ? candidates[nextKey] : null) || null,
      momentum: momentum || null,
      momentum_confidence: momentumConfidence,
      auto_continue: autoContinue,
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Progress bands for `jev_progress` (keys are stable codes). */
export const JEV_PROGRESS_BANDS: Record<string, string> = {
  s0_25: "起步 0–25%：刚开工或仍在探路",
  s25_50: "推进 25–50%：骨架已立，主体未成",
  s50_75: "过半 50–75%：主体完成，收尾未验",
  s75_99: "收尾 75–99%：只差验证与合入",
  s100: "完成 100%：已交付可验收",
};

/** Health verdicts for `jev_progress` (keys are stable codes). */
export const JEV_PROGRESS_VERDICTS: Record<string, string> = {
  on_track: "在轨：按计划推进，继续当前下一步",
  at_risk: "风险：有阻塞苗头，需先清障碍再推进",
  blocked: "阻塞：已被卡住，停下先解阻塞",
  done: "已完成：无需再推进，转验收",
};

const JEV_PROGRESS_BAND_PERCENT: Record<string, number> = {
  s0_25: 12,
  s25_50: 37,
  s50_75: 62,
  s75_99: 87,
  s100: 100,
};

/**
 * Advisory task-progress check (任务进度裁决, purely opt-in).
 * For a named task with optional phases and a completed-so-far summary,
 * JEV returns a progress band + health verdict + next step, like a boss
 * asking for status. Trigger manually on long multi-phase work only;
 * never poll every turn. Bridge-safe aliases: task <= question,
 * phases <= options, completed <= content.
 */
export async function nativeJevProgress(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawTask = (rawInput as Record<string, unknown>).task
    ?? rawInput.question
    ?? (rawInput as Record<string, unknown>).prompt
    ?? (rawInput as Record<string, unknown>).goal;
  const task = (rawTask ?? "").toString().trim();
  if (!task) {
    throw new SaVmInputError("action 'jev_progress' requires a non-empty 'task' parameter (use 'question' through the bridge)");
  }
  const rawCompleted = (rawInput as Record<string, unknown>).completed
    ?? (rawInput as Record<string, unknown>).actual_work
    ?? (rawInput as Record<string, unknown>).work
    ?? rawInput.content
    ?? "";
  const completed = (rawCompleted ?? "").toString().trim();
  const rawPhases = (rawInput as Record<string, unknown>).phases
    ?? rawInput.options
    ?? (rawInput as Record<string, unknown>).units;
  const phases = normalizeChoiceOptions(rawPhases);
  let phaseKeys = Object.keys(phases);
  if (phaseKeys.length > 6) {
    for (const k of phaseKeys.slice(6)) {
      delete phases[k];
    }
    phaseKeys = Object.keys(phases);
  }

  const context = truncateJevContext(rawInput.context ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const questions: Record<string, unknown> = {
    progress_band: {
      type: "choice",
      instructions: `How far along is this task? Task: ${task}`,
      criteria: JEV_PROGRESS_BANDS,
    },
    health: {
      type: "choice",
      instructions: `Is this task on track, at risk, blocked, or done? Task: ${task}`,
      criteria: JEV_PROGRESS_VERDICTS,
    },
  };
  if (phaseKeys.length > 0) {
    questions["next_step"] = {
      type: "choice",
      instructions: `Given what is completed, which phase should be done next? Task: ${task}`,
      criteria: phases,
    };
  }

  const payload = {
    state: `[Task]\n${task}\n\n[Completed]\n${completed || "(nothing reported yet)"}\n\n[Context]\n${context}`,
    model: creds.model,
    questions,
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV progress check failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const bandAnswer = answers.progress_band ?? {};
  const rawBand = typeof bandAnswer.choice === "string" ? bandAnswer.choice.trim() : "";
  let band = JEV_PROGRESS_BANDS[rawBand] !== undefined ? rawBand : "s0_25";
  const bandConfidence = typeof bandAnswer.confidence === "number" && Number.isFinite(bandAnswer.confidence)
    ? bandAnswer.confidence
    : 1.0;
  const healthAnswer = answers.health ?? {};
  const rawHealth = typeof healthAnswer.choice === "string" ? healthAnswer.choice.trim().toLowerCase() : "";
  const health = JEV_PROGRESS_VERDICTS[rawHealth] !== undefined ? rawHealth : "on_track";
  const healthConfidence = typeof healthAnswer.confidence === "number" && Number.isFinite(healthAnswer.confidence)
    ? healthAnswer.confidence
    : 1.0;
  let nextStep = "";
  let nextConfidence = 1.0;
  if (phaseKeys.length > 0) {
    const nextAnswer = answers.next_step ?? {};
    const rawNext = typeof nextAnswer.choice === "string" ? nextAnswer.choice.trim() : "";
    nextStep = phases[rawNext] !== undefined ? rawNext : "";
    nextConfidence = typeof nextAnswer.confidence === "number" && Number.isFinite(nextAnswer.confidence)
      ? nextAnswer.confidence
      : 1.0;
  }
  if (health === "done") band = "s100";
  const percent = JEV_PROGRESS_BAND_PERCENT[band] ?? 12;

  const summary = [
    `【JEV 进度裁决】`,
    `• 进度：[${band}] ${JEV_PROGRESS_BANDS[band]}（约 ${percent}%，置信度 ${Math.round(bandConfidence * 100)}%）`,
    `• 健康度：[${health}] ${JEV_PROGRESS_VERDICTS[health]}（置信度 ${Math.round(healthConfidence * 100)}%）`,
    ...(nextStep ? [`• 下一步：[${nextStep}] ${phases[nextStep]}（置信度 ${Math.round(nextConfidence * 100)}%）`] : [`• 下一步：未给候选阶段，按健康度行动`]),
    `• 任务：${task.slice(0, 200)}`,
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_progress",
      task,
      completed: completed || null,
      progress_band: band,
      percent_hint: percent,
      band_confidence: bandConfidence,
      health,
      health_confidence: healthConfidence,
      health_description: JEV_PROGRESS_VERDICTS[health],
      next_step: nextStep || null,
      next_confidence: nextConfidence,
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Memory-scope verdicts for `jev_memory` (skip/workspace/global). */
export const JEV_MEMORY_SCOPES: Record<string, string> = {
  skip: "不值得记忆：临时任务状态、一次性输出、无复用价值",
  workspace: "工程记忆：仅当前工作区复用（架构暗知识、环境规则、调试线索）",
  global: "全局记忆：跨工程复用（用户偏好、通用约定、工具链密码端口等）",
};

/** Judge whether a fact should enter long-term memory (skip/workspace/global). Never throws on input; throws SaVmInputError on empty fact. */
export async function nativeJevMemory(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawFact = (rawInput as Record<string, unknown>).fact
    ?? (rawInput as Record<string, unknown>).content
    ?? (rawInput as Record<string, unknown>).text
    ?? rawInput.question
    ?? (rawInput as Record<string, unknown>).prompt
    ?? "";
  const fact = (rawFact ?? "").toString().trim();
  if (!fact) {
    throw new SaVmInputError("action 'jev_memory' requires a non-empty 'fact' parameter (use 'question' through the bridge)");
  }
  const context = truncateJevContext((rawInput as Record<string, unknown>).context);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const payload = {
    state: `[Fact]\n${fact.slice(0, 2000)}\n\n[Context]\n${context}`,
    model: creds.model,
    questions: {
      memory_scope: {
        type: "choice",
        instructions: `Should this fact enter long-term memory? Fact: ${fact.slice(0, 300)}`,
        criteria: JEV_MEMORY_SCOPES,
      },
    },
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  // Local fallback when JEV upstream is unavailable: cheap durability heuristic
  // so SessionEnd auto-triage still works offline (skip ephemeral, workspace by default).
  if (!callResult.ok) {
    const t = fact.slice(0, 600);
    const ephemeral = /^(ok|done|好的|收到|执行完毕|temp|tmp|log|日志片段)/i.test(t) || t.length < 16;
    const globalHint = /偏好|记住|always |never |别再|下次|以后|password|port|端口|token|key:|env|环境|全局|global|convention|user prefers/i.test(t);
    const scope = ephemeral ? "skip" : (globalHint ? "global" : "workspace");
    const key = fact.slice(0, 24).replace(/\s+/g, "_") || "memory";
    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: JSON.stringify({
        action: "jev_memory",
        scope,
        confidence: 0.5,
        fallback: callResult.error,
        suggested_params: scope === "skip" ? null : { action: "add_memory", key, content: fact.slice(0, 1000), scope },
        summary: `【JEV 记忆裁决·本地回退】scope=${scope}（上游不可用：${callResult.error}）`,
      }, null, 2),
      stderr: "",
      saVmEvents: [],
      saVmViolation: null,
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const scopeAnswer = answers.memory_scope ?? {};
  const rawScope = typeof scopeAnswer.choice === "string" ? scopeAnswer.choice.trim().toLowerCase() : "";
  const scope = JEV_MEMORY_SCOPES[rawScope] !== undefined ? rawScope : "workspace";
  const confidence = typeof scopeAnswer.confidence === "number" && Number.isFinite(scopeAnswer.confidence)
    ? scopeAnswer.confidence
    : 1.0;
  const key = fact.slice(0, 24).replace(/\s+/g, "_") || "memory";
  const summary = [
    `【JEV 记忆裁决】`,
    `• 范围：[${scope}] ${JEV_MEMORY_SCOPES[scope]}（置信度 ${Math.round(confidence * 100)}%）`,
    scope === "skip" ? `• 建议：跳过，不写记忆` : `• 建议：add_memory key='${key}' scope='${scope}'`,
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_memory",
      scope,
      confidence,
      suggested_params: scope === "skip" ? null : { action: "add_memory", key, content: fact.slice(0, 1000), scope },
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

/** Efficiency tiers for `jev_which` */
export const JEV_WHICH_EFFICIENCY_TIERS: Record<string, string> = {
  maximum_efficiency: "极致能效：单步 AST/结构化直达，节省 90%+ Token，零副作用",
  high_efficiency: "高能效：定向切片或批量并发，杜绝低效循环与大文件漫灌",
  moderate_efficiency: "常规能效：可用但需警惕上下文开销与边界",
  anti_pattern_avoided: "低效/危险反模式拦截：原方案存在严重浪费或风险，已重定向至推荐工具",
};

/** Built-in engineering tool catalog for tool arbitration */
export const JEV_DEFAULT_ENGINEERING_TOOLS: Record<string, string> = {
  find_definition: "查函数/类/符号定义与源头实现预览（AST 单步直达，防大文件全文 read_file）",
  find_references: "查函数/符号调用方与所有被引用处（精确词法索引，防泛搜 grep）",
  file_outline: "提取单文件结构、函数签名与行号大纲（防盲读超大源码）",
  workspace_outline: "提取目录/工程级符号大纲与 repo_map 架构总览",
  read_lines: "定向阅读已知行号区间代码（文件 > 500 行严禁全量 read_file）",
  read_file_tail: "末尾流式直读排查日志与崩溃异常栈（严禁全量读大日志）",
  edit_file: "单处代码精准局部原子替换（带安全备份，防全量覆写）",
  apply_patch: "跨文件批量修改与复杂重构（标准 Unified Diff，带回滚检验）",
  code_graph: "宏观类继承拓扑与模块调用链（仅用于宏观依赖梳理，严禁微观编码替代）",
  grep_search_async: "高并发多关键词搜索与大范围模式定位",
  run_js: "跨文件批量复杂循环与数据处理（受限 TS 脚本，单次替代 3 次以上单步）",
};

function generateToolUsageRecommendation(
  bestTool: string,
  target?: string,
  _intent?: string
): { suggested_params: Record<string, unknown>; anti_pattern: string } {
  switch (bestTool) {
    case "find_definition":
      return {
        suggested_params: { action: "find_definition", symbol: target || "TargetSymbol", include_body: true },
        anti_pattern: "严禁针对符号盲目 grep_search 广域泛搜，严禁大文件全量 read_file 读取数千行！",
      };
    case "find_references":
      return {
        suggested_params: { action: "find_references", symbol: target || "TargetSymbol", detail: false },
        anti_pattern: "严禁循环 grep_search 或手写脚本逐个读文件正则拼凑调用方！",
      };
    case "file_outline":
      return {
        suggested_params: { action: "file_outline", path: target || "path/to/file.ts" },
        anti_pattern: "仅为查看文件结构大纲时，严禁盲目调用 read_file 吞入上千行源码！",
      };
    case "workspace_outline":
      return {
        suggested_params: { action: "workspace_outline", dir: target || "." },
        anti_pattern: "严禁在终端运行递归列目录脚本或递归读取全仓文件！",
      };
    case "read_lines":
      return {
        suggested_params: { action: "read_lines", path: target || "path/to/file.ts", start_line: 1, end_line: 100 },
        anti_pattern: "文件超过 500 行时，严禁使用 read_file 全量读取，必须使用 read_lines 定向切片！",
      };
    case "read_file_tail":
      return {
        suggested_params: { action: "read_file_tail", path: target || "path/to/log.log", lines: 50 },
        anti_pattern: "排查错误日志时，严禁使用 read_file 或终端 cat 读整个大日志！",
      };
    case "edit_file":
      return {
        suggested_params: { action: "edit_file", path: target || "path/to/file.ts", old_text: "/* exact target */", new_text: "/* replacement */" },
        anti_pattern: "单处局部修改严禁手写脚本或用 write_file 覆写数千行全文件！",
      };
    case "apply_patch":
      return {
        suggested_params: { action: "apply_patch", patch: "*** Begin Patch\n*** Update File: path/to/file.ts\n..." },
        anti_pattern: "跨文件或多处联动修改，严禁连续调用多次碎片化 edit_file！",
      };
    case "code_graph":
      return {
        suggested_params: { action: "code_graph", target: target || "ClassName", mode: "symbol_hierarchy", depth: 2, format: "dot" },
        anti_pattern: "严禁将 code_graph 用于微观写代码场景；拿到拓扑后切忌无脑遍历，应结合 find_definition！",
      };
    case "grep_search_async":
      return {
        suggested_params: { action: "grep_search_async", queries: target ? [target] : ["pattern1", "pattern2"] },
        anti_pattern: "多个关键词搜索时，严禁串行循环单个 grep_search！",
      };
    case "run_js":
      return {
        suggested_params: { action: "run_js", content: "export async function main(): Promise<number> {\n  // computation logic\n  return 0;\n}" },
        anti_pattern: "单文件单步操作绝不手写 TS，大文本字面量与多文件搬运严禁内联写入 TS source！",
      };
    default:
      return {
        suggested_params: { action: bestTool, ...(target ? { target } : {}) },
        anti_pattern: `请遵从 ${bestTool} 的边界与能效准则，避免低效重复调用。`,
      };
  }
}

/**
 * Advisory engineering tool efficiency arbitration (工具高能效选型与反模式拦截, purely opt-in).
 * Given an engineering intent and optional candidate tools, JEV arbitrates the
 * highest-efficiency, lowest-context-cost tool (e.g. find_definition vs grep vs read_file),
 * emits concrete parameter templates, and flags anti-patterns.
 */
export async function nativeJevWhich(
  rawInput: SaVmRunInput,
  _policy?: SaVmPolicyConfig,
  _cwd?: string,
  startedAt: number = Date.now()
): Promise<SaVmRunResult> {
  const rawIntent = (rawInput as Record<string, unknown>).intent
    ?? (rawInput as Record<string, unknown>).task
    ?? rawInput.question
    ?? rawInput.content;
  const intent = (rawIntent ?? "").toString().trim();
  if (!intent) {
    throw new SaVmInputError("action 'jev_which' requires a non-empty 'intent' or 'question' parameter (engineering task or purpose)");
  }
  const target = ((rawInput as Record<string, unknown>).target ?? "").toString().trim();
  const rawOptions = (rawInput as Record<string, unknown>).candidates
    ?? (rawInput as Record<string, unknown>).tools
    ?? rawInput.options;
  const hasCandidates = rawOptions !== undefined && rawOptions !== null
    && (typeof rawOptions !== "string" || rawOptions.trim() !== "");
  let candidates: Record<string, string> = {};
  if (hasCandidates) {
    candidates = normalizeChoiceOptions(rawOptions);
    const keys = Object.keys(candidates);
    if (keys.length < 2) {
      throw new SaVmInputError("action 'jev_which' requires at least 2 candidate tools in 'candidates' or 'options' (or omit to let JEV select from the full engineering catalog)");
    }
    if (keys.length > 8) {
      for (const k of keys.slice(8)) {
        delete candidates[k];
      }
    }
  } else {
    // Default to the built-in engineering tool catalog
    candidates = { ...JEV_DEFAULT_ENGINEERING_TOOLS };
  }

  const context = truncateJevContext(rawInput.context ?? (rawInput as Record<string, unknown>).state);
  const creds = resolveJevCredentials(rawInput as Record<string, unknown>);

  const questions: Record<string, unknown> = {
    best_tool: {
      type: "choice",
      instructions: `Given the engineering intent${target ? ` targeting '${target}'` : ""}, which tool provides the highest token efficiency, lowest context footprint, and fastest execution without anti-patterns? Intent: ${intent}`,
      criteria: candidates,
    },
    efficiency_tier: {
      type: "choice",
      instructions: `What efficiency tier does this tool selection represent? Intent: ${intent}`,
      criteria: JEV_WHICH_EFFICIENCY_TIERS,
    },
  };

  const payload = {
    state: `[Engineering Intent]\n${intent}${target ? `\n\n[Target]\n${target}` : ""}\n\n[Context]\n${context}`,
    model: creds.model,
    questions,
  };

  const callResult = await executeJevCall(payload, creds);
  const durationMs = Date.now() - startedAt;

  if (!callResult.ok) {
    return {
      ok: false,
      kind: callResult.status === 401 ? "capability_denied" : "sa_error",
      exitCode: callResult.status === 401 ? 228 : 1,
      stdout: "",
      stderr: `JEV tool efficiency arbitration failed (${callResult.status ?? 502}): ${callResult.error}`,
      saVmEvents: [
        { event: "violation", kind: "jev_error", reason: callResult.error },
      ],
      saVmViolation: { reason: callResult.error },
      durationMs,
    };
  }

  const rootData = callResult.data;
  const answers = (rootData.answers ?? {}) as Record<string, Record<string, unknown>>;
  const toolAnswer = answers.best_tool ?? {};
  const rawTool = typeof toolAnswer.choice === "string" ? toolAnswer.choice.trim() : "";
  const bestTool = candidates[rawTool] !== undefined ? rawTool : Object.keys(candidates)[0] ?? "";
  const toolConfidence = typeof toolAnswer.confidence === "number" && Number.isFinite(toolAnswer.confidence)
    ? toolAnswer.confidence
    : 1.0;

  const tierAnswer = answers.efficiency_tier ?? {};
  const rawTier = typeof tierAnswer.choice === "string" ? tierAnswer.choice.trim().toLowerCase() : "";
  const efficiencyTier = JEV_WHICH_EFFICIENCY_TIERS[rawTier] !== undefined ? rawTier : "high_efficiency";

  // Generate suggested call pattern & anti-pattern warnings based on bestTool
  const recommendation = generateToolUsageRecommendation(bestTool, target, intent);

  const summary = [
    `【JEV 工具能效仲裁 (jev_which)】`,
    `• 推荐首选工具：[${bestTool}] ${candidates[bestTool] || bestTool}（置信度 ${Math.round(toolConfidence * 100)}%）`,
    `• 能效等级：[${efficiencyTier}] ${JEV_WHICH_EFFICIENCY_TIERS[efficiencyTier]}`,
    `• 推荐调用范式：sa_vm_run(${JSON.stringify(recommendation.suggested_params)})`,
    `• 严禁反模式：${recommendation.anti_pattern}`,
    `• 意图：${intent.slice(0, 160)}`,
    `• 耗时：${callResult.latencyMs}ms · 模型：${creds.model}`,
  ].join("\n");

  return {
    ok: true,
    kind: "success",
    exitCode: 0,
    stdout: JSON.stringify({
      action: "jev_which",
      intent,
      target: target || null,
      recommended_action: bestTool,
      confidence: toolConfidence,
      tool_description: candidates[bestTool] || null,
      efficiency_tier: efficiencyTier,
      tier_description: JEV_WHICH_EFFICIENCY_TIERS[efficiencyTier],
      suggested_params: recommendation.suggested_params,
      anti_pattern: recommendation.anti_pattern,
      summary,
      latencyMs: callResult.latencyMs,
      raw: rootData,
    }, null, 2),
    stderr: "",
    saVmEvents: [],
    saVmViolation: null,
    durationMs,
  };
}

