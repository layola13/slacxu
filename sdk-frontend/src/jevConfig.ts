export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-latest";
/** Cloudflare-hosted JEV (clef series): account run root; per-call model path is appended server-side. */
export const CLOUDFLARE_JEV_DEFAULT_BASE_URL =
  "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/run";
export const CLOUDFLARE_JEV_DEFAULT_MODEL = "clef-flash";
export const JEV_STORAGE_KEY = "codex-ultra.jev-config";

/** Direct upstream channel for JEV calls: official JEV or Cloudflare-hosted clef models. */
export type JevUpstreamProvider = "jev" | "cloudflare";

export function isCloudflareJevBaseUrl(baseUrl: string): boolean {
  return (baseUrl || "").toLowerCase().includes("api.cloudflare.com");
}

export function normalizeJevUpstreamProvider(
  value: unknown,
  baseUrl?: string,
  fallback: JevUpstreamProvider = "jev",
): JevUpstreamProvider {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "cloudflare" || v === "cf" || v === "clef") return "cloudflare";
  if (v === "jev" || v === "typesafe" || v === "systemone") return "jev";
  // Backward compatible: derive from a previously saved Base URL.
  if (baseUrl && isCloudflareJevBaseUrl(baseUrl)) return "cloudflare";
  return fallback;
}
export const JEV_MAX_AUTO_NUDGES = 1000;

export function normalizeMaxJevNudges(value: unknown, fallback = 2): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(JEV_MAX_AUTO_NUDGES, Math.max(1, Math.round(value)));
}

/** off: never review plans; created: audit once when created; every: audit each update. */
export type JevPlanReviewMode = "off" | "created" | "every";

export type JevBridgeProtocol = "openai-chat" | "openai-responses";

export interface JevConfig {
  enabled: boolean;
  /** Direct upstream channel: "jev" (official) or "cloudflare" (clef series). */
  upstream: JevUpstreamProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** bridge via existing relay: provider/group selected in JEV panel. Empty = direct JEV upstream. */
  providerId: string;
  groupId: string;
  bridgeProtocol: JevBridgeProtocol;
  /** failed/partial verdicts auto-steer the agent to continue (bounded). */
  autoNudge: boolean;
  maxNudges: number;
  /** review the task plan when created and/or on every update. */
  planReview: JevPlanReviewMode;
  /** review subagent task briefs at spawn_agent time. */
  reviewBrief: boolean;
  /** review subagent completion reports at wait_agent time. */
  reviewReport: boolean;
  /** opt-in: expose JEV active decision helper (jev_choose/jev_checklist) in sa-vm SKILL. Default off. */
  allowActiveTools: boolean;
}

export function defaultJevConfig(): JevConfig {
  return {
    enabled: false,
    upstream: "jev",
    baseUrl: JEV_DEFAULT_BASE_URL,
    apiKey: "",
    model: JEV_DEFAULT_MODEL,
    providerId: "",
    groupId: "",
    bridgeProtocol: "openai-chat",
    autoNudge: false,
    maxNudges: 2,
    planReview: "off",
    reviewBrief: false,
    reviewReport: false,
    allowActiveTools: true,
  };
}

export function normalizeJevBridgeProtocol(value: unknown): JevBridgeProtocol {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "openai-responses" || v === "responses") return "openai-responses";
  return "openai-chat";
}

export function loadJevConfig(): JevConfig {
  const fallback = defaultJevConfig();
  try {
    const raw = localStorage.getItem(JEV_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<JevConfig>;
    const baseUrl = typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : fallback.baseUrl;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
      upstream: normalizeJevUpstreamProvider(
        (parsed as Record<string, unknown>).upstream,
        baseUrl,
        fallback.upstream,
      ),
      baseUrl,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : fallback.model,
      autoNudge: typeof parsed.autoNudge === "boolean" ? parsed.autoNudge : false,
      maxNudges: normalizeMaxJevNudges(parsed.maxNudges, fallback.maxNudges),
      planReview: normalizePlanReviewMode((parsed as Record<string, unknown>).planReview, fallback.planReview),
      reviewBrief: typeof parsed.reviewBrief === "boolean" ? parsed.reviewBrief : false,
      reviewReport: typeof parsed.reviewReport === "boolean" ? parsed.reviewReport : false,
      allowActiveTools: typeof parsed.allowActiveTools === "boolean" ? parsed.allowActiveTools : fallback.allowActiveTools,
      providerId: typeof parsed.providerId === "string" ? parsed.providerId : "",
      groupId: typeof parsed.groupId === "string" ? parsed.groupId : "",
      bridgeProtocol: normalizeJevBridgeProtocol((parsed as Record<string, unknown>).bridgeProtocol),
    };
  } catch {
    return fallback;
  }
}

/**
 * Persist JEV config to localStorage (the source `loadJevConfig` reads) and
 * best-effort sync it to the server. Returns false when the local write did
 * not stick (storage blocked/quota/private mode): callers must surface an
 * error and keep showing the old value, otherwise the dialog claims "on"
 * while the judge keeps reading "off". Never throws.
 */
export function saveJevConfig(config: JevConfig, sessionToken?: string | null): boolean {
  try {
    localStorage.setItem(JEV_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage may be unavailable; report instead of silently diverging.
    return false;
  }
  try {
    const raw = localStorage.getItem(JEV_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<JevConfig>;
    if (
      Boolean(parsed.enabled) !== Boolean(config.enabled) ||
      String(parsed.apiKey ?? "") !== String(config.apiKey ?? "") ||
      String(parsed.providerId ?? "") !== String(config.providerId ?? "")
    ) {
      return false;
    }
  } catch {
    return false;
  }
  void fetch("/api/jev/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { "x-codex-ui-token": sessionToken } : {}),
    },
    body: JSON.stringify(config),
  }).catch(() => {
    // Background sync best-effort
  });
  return true;
}

export function jevBaseHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

export function normalizePlanReviewMode(value: unknown, fallback: JevPlanReviewMode = "off"): JevPlanReviewMode {
  if (value === "created" || value === "every" || value === "off") return value;
  // Tolerate the earlier boolean switch shape: true means audit on creation.
  if (value === true) return "created";
  return fallback;
}

export const JEV_PLAN_REVIEW_OPTIONS: { value: JevPlanReviewMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "created", label: "Review once on creation" },
  { value: "every", label: "Review on every update" },
];
