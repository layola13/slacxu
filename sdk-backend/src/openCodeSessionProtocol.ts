/**
 * OpenCode session protocol helpers (moved from the relay-config
 * plugin so every backend can use them through the SDK).
 *
 * Pure protocol surface: per-backend User-Agent identities, the
 * gateway-internal backend hint header, deterministic per-thread
 * session ids, and the process-rotated session/project identity the
 * OpenCode-compatible upstreams key routing and prompt caching on.
 * The only state is the process-local rotated session cache below.
 */
import { createHash, randomUUID } from "node:crypto";

/**
 * Dedicated OpenCode Go client identities per backend runtime.
 * OpenCode Go requires a purpose-built User-Agent (never a generic SDK /
 * HTTP-library name such as curl): each programming-agent backend sends
 * its own identifier so upstream can attribute typical agent traffic.
 */
export const OPENCODE_BACKEND_USER_AGENTS = {
  pi: "codex-ultra-pi/1.0",
  grok: "codex-ultra-grok/1.0",
  agy: "codex-ultra-agy/1.0",
  claude: "codex-ultra-claude/1.0",
  openclaude: "codex-ultra-openclaude/1.0",
} as const;
export type OpenCodeBackendKind = keyof typeof OPENCODE_BACKEND_USER_AGENTS;

/**
 * Gateway-internal hint identifying which CLI backend a relayed request came
 * from (`claude` | `openclaude`). Sent by the Claude bridges on
 * `ANTHROPIC_CUSTOM_HEADERS`; the relay gateway consumes it for per-backend
 * User-Agent attribution and never forwards it upstream (`upstreamHeaders()`
 * builds a fresh header set and only copies a small passthrough whitelist).
 */
export const OPENCODE_CLI_BACKEND_HEADER = "x-codex-cli-backend";

/**
 * Stable per-conversation OpenCode session id derived deterministically
 * from the caller thread id. Unlike the process-rotated
 * getOpenCodeSessionId(), this value is identical for every request of the
 * same conversation and survives process restarts, which is what upstream
 * routing and prompt caching key on. Different threads map to different
 * ids; the sha256 digest is UUID-formatted for header compatibility.
 */
export function deriveOpenCodeSessionId(threadId: string): string {
  const digest = createHash("sha256")
    .update(`codex-ultra-opencode-session:${threadId.trim()}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20)}`;
}

/**
 * Record-form OpenCode Go headers for runtimes that build plain-object
 * fetch headers (Pi/Grok/Agy proxies). Same contract as
 * applyOpenCodeHeaders — dedicated UA, desktop client, stable
 * per-conversation session, fresh request id — but keyed by threadId
 * instead of the process-rotated session. Never sets Authorization
 * (callers keep their own key handling); callers targeting non-OpenCode
 * upstreams can spread this unconditionally, unknown headers are ignored.
 */
export function openCodeThreadHeaders(
  threadId: string | null | undefined,
  backend: OpenCodeBackendKind,
): Record<string, string> {
  const trimmed = threadId?.trim();
  return {
    "User-Agent": process.env.OPENCODE_USER_AGENT?.trim() || OPENCODE_BACKEND_USER_AGENTS[backend],
    "x-opencode-client": process.env.OPENCODE_CLIENT?.trim() || "desktop",
    "x-opencode-project": getOpenCodeProjectId(),
    "x-opencode-session": trimmed ? deriveOpenCodeSessionId(trimmed) : getOpenCodeSessionId(),
    "x-opencode-request": randomUUID(),
  };
}

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_BASE32_LEN = CROCKFORD_BASE32.length;

export function generateOpenCodeUlid(seedTime: number = Date.now()): string {
  let timeStr = "";
  let time = Math.max(0, Math.floor(seedTime));
  for (let i = 9; i >= 0; i--) {
    const mod = time % CROCKFORD_BASE32_LEN;
    timeStr = CROCKFORD_BASE32.charAt(mod) + timeStr;
    time = Math.floor(time / CROCKFORD_BASE32_LEN);
  }
  let randStr = "";
  for (let i = 0; i < 16; i++) {
    const rand = Math.floor(Math.random() * CROCKFORD_BASE32_LEN);
    randStr += CROCKFORD_BASE32.charAt(rand);
  }
  return timeStr + randStr;
}

let cachedOpenCodeProjectId: string | null = null;
let cachedOpenCodeSessionId: string | null = null;
let openCodeSessionCreatedAt = 0;
const OPENCODE_SESSION_TTL_MS = 45 * 60 * 1000; // 45 minutes

export function getOpenCodeProjectId(): string {
  if (!cachedOpenCodeProjectId) {
    cachedOpenCodeProjectId = process.env.OPENCODE_PROJECT?.trim() || "global";
  }
  return cachedOpenCodeProjectId;
}

export function getOpenCodeSessionId(forceNew = false): string {
  const now = Date.now();
  if (forceNew || !cachedOpenCodeSessionId || (now - openCodeSessionCreatedAt) > OPENCODE_SESSION_TTL_MS) {
    cachedOpenCodeSessionId = randomUUID();
    openCodeSessionCreatedAt = now;
  }
  return cachedOpenCodeSessionId;
}

export function rotateOpenCodeSession(): void {
  getOpenCodeSessionId(true);
}

export function clearOpenCodeSession(): void {
  cachedOpenCodeSessionId = null;
  cachedOpenCodeProjectId = null;
  openCodeSessionCreatedAt = 0;
}
