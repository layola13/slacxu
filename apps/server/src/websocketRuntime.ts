import type { WebSocketRuntimeConfig, WebSocketRuntimeProfile } from "@codex-ui/shared";

export type ServerWebSocketRuntimeConfig = WebSocketRuntimeConfig & {
  deployment: "desktop" | "server";
  host: string;
  maxMessageBytes: number;
  maxBackpressureBytes: number;
  trustProxy: boolean;
  allowMissingOrigin: boolean;
  allowedOrigins: string[];
};

type ResolveOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

type TrustedLocalDesktopAuthOptions = ResolveOptions & {
  deployment?: "desktop" | "server";
  host?: string;
};

const PROFILE_DEFAULTS: Record<
  WebSocketRuntimeProfile,
  Omit<WebSocketRuntimeConfig, "profile" | "path">
> = {
  desktop: {
    heartbeatIntervalMs: 2_000,
    // Renderer bursts (many parallel agents restoring and streaming) must not
    // turn a transient busy main thread into a disconnect + recovery storm.
    heartbeatTimeoutMs: 90_000,
    handshakeTimeoutMs: 5_000,
    reconnectBaseDelayMs: 250,
    reconnectMaxDelayMs: 5_000,
  },
  server: {
    heartbeatIntervalMs: 5_000,
    // A saturated host can delay both the ping timer and its pong handler;
    // allow the same transient CPU stalls tolerated by the desktop profile.
    heartbeatTimeoutMs: 90_000,
    handshakeTimeoutMs: 10_000,
    reconnectBaseDelayMs: 750,
    reconnectMaxDelayMs: 30_000,
  },
  public: {
    heartbeatIntervalMs: 15_000,
    heartbeatTimeoutMs: 60_000,
    handshakeTimeoutMs: 15_000,
    reconnectBaseDelayMs: 1_500,
    reconnectMaxDelayMs: 60_000,
  },
};

export function resolveWebSocketRuntimeConfig(
  options: ResolveOptions = {},
): ServerWebSocketRuntimeConfig {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const deployment = truthy(env.CODEX_UI_DESKTOP) ? "desktop" : "server";
  const profile = resolveProfile(env.CODEX_UI_WS_PROFILE, deployment);
  const defaults = PROFILE_DEFAULTS[profile];
  const host = env.CODEX_UI_HOST?.trim() || (deployment === "desktop" ? "127.0.0.1" : "0.0.0.0");
  const heartbeatIntervalMs = positiveNumber(
    env.CODEX_UI_WS_HEARTBEAT_INTERVAL_MS,
    defaults.heartbeatIntervalMs,
  );
  const heartbeatTimeoutMs = Math.max(
    heartbeatIntervalMs * 2,
    positiveNumber(env.CODEX_UI_WS_HEARTBEAT_TIMEOUT_MS, defaults.heartbeatTimeoutMs),
  );
  const reconnectBaseDelayMs = positiveNumber(
    env.CODEX_UI_WS_RECONNECT_BASE_DELAY_MS,
    defaults.reconnectBaseDelayMs,
  );

  return {
    profile,
    deployment,
    platform,
    host,
    path: normalizeWebSocketPath(env.CODEX_UI_WS_PATH),
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    handshakeTimeoutMs: positiveNumber(
      env.CODEX_UI_WS_HANDSHAKE_TIMEOUT_MS,
      defaults.handshakeTimeoutMs,
    ),
    reconnectBaseDelayMs,
    reconnectMaxDelayMs: Math.max(
      reconnectBaseDelayMs,
      positiveNumber(
        env.CODEX_UI_WS_RECONNECT_MAX_DELAY_MS,
        defaults.reconnectMaxDelayMs,
      ),
    ),
    maxMessageBytes: positiveNumber(
      env.CODEX_UI_WS_MAX_MESSAGE_BYTES,
      profile === "public" ? 4 * 1024 * 1024 : 16 * 1024 * 1024,
    ),
    maxBackpressureBytes: positiveNumber(
      env.CODEX_UI_WS_MAX_BACKPRESSURE_BYTES,
      profile === "desktop" ? 16 * 1024 * 1024 : 8 * 1024 * 1024,
    ),
    trustProxy: truthy(env.CODEX_UI_TRUST_PROXY),
    allowMissingOrigin:
      env.CODEX_UI_WS_ALLOW_MISSING_ORIGIN === undefined
        ? profile !== "public"
        : truthy(env.CODEX_UI_WS_ALLOW_MISSING_ORIGIN),
    allowedOrigins: csv(env.CODEX_UI_ALLOWED_ORIGINS).map(normalizeOrigin).filter(Boolean),
  };
}

export function publicWebSocketRuntimeConfig(
  config: ServerWebSocketRuntimeConfig,
): WebSocketRuntimeConfig {
  return {
    profile: config.profile,
    platform: config.platform,
    path: config.path,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    heartbeatTimeoutMs: config.heartbeatTimeoutMs,
    handshakeTimeoutMs: config.handshakeTimeoutMs,
    reconnectBaseDelayMs: config.reconnectBaseDelayMs,
    reconnectMaxDelayMs: config.reconnectMaxDelayMs,
  };
}

export function trustedLocalDesktopAuthEnabled(
  options: TrustedLocalDesktopAuthOptions = {},
): boolean {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const deployment = options.deployment ?? (truthy(env.CODEX_UI_DESKTOP) ? "desktop" : "server");
  const host = options.host ?? (env.CODEX_UI_HOST?.trim() || (deployment === "desktop" ? "127.0.0.1" : "0.0.0.0"));
  return platform === "win32"
    && deployment === "desktop"
    && truthy(env.CODEX_UI_TRUSTED_LOCAL_AUTH)
    && isLoopbackHost(host);
}

export function isWebSocketOriginAllowed(
  request: Request,
  config: ServerWebSocketRuntimeConfig,
): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    return config.allowMissingOrigin;
  }
  const origin = normalizeOrigin(originHeader);
  if (!origin) return false;
  if (config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin)) {
    return true;
  }

  const requestOrigin = effectiveRequestOrigin(request, config.trustProxy);
  if (requestOrigin && origin === requestOrigin) {
    return true;
  }
  return config.profile === "desktop" && isLoopbackOrigin(origin);
}

function resolveProfile(
  value: string | undefined,
  deployment: "desktop" | "server",
): WebSocketRuntimeProfile {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return deployment === "desktop" ? "desktop" : "server";
  }
  if (normalized === "desktop" || normalized === "server" || normalized === "public") {
    return normalized;
  }
  throw new Error(
    `Unsupported CODEX_UI_WS_PROFILE '${value}'. Use 'desktop', 'server', 'public', or 'auto'.`,
  );
}

function effectiveRequestOrigin(request: Request, trustProxy: boolean): string {
  const url = new URL(request.url);
  if (!trustProxy) return url.origin;
  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const protocol = forwardedProto === "https" ? "https:" : forwardedProto === "http" ? "http:" : url.protocol;
  const host = forwardedHost || url.host;
  return normalizeOrigin(`${protocol}//${host}`);
}

function firstForwardedValue(value: string | null): string {
  return value?.split(",")[0]?.trim() ?? "";
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function normalizeOrigin(value: string): string {
  if (value === "*") return value;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeWebSocketPath(value: string | undefined): string {
  const trimmed = value?.trim() || "/ws";
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (path === "/" || path.includes("?") || path.includes("#")) {
    throw new Error(
      `Invalid CODEX_UI_WS_PATH '${value}'. Use a non-root URL path without a query string or fragment.`,
    );
  }
  return path.replace(/\/{2,}/g, "/");
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function csv(value: string | undefined): string[] {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}
