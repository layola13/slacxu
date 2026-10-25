import { randomBytes, randomUUID } from "node:crypto";
import type { DuckApiRequest } from "./convert.js";
import { generateVQDHash } from "./vqd.js";

// Port of E:\projects\duck2api\internal\duckgo\request.go (upstream half).
// Differences from Go (documented):
// - HTTP via fetch + manual cookie jar per proxy session; the Go build uses a
//   TLS-fingerprint client (bogdanfinn/tls-client). Fingerprint parity is a
//   known gap: expect more 418/429 until impersonation lands.
// - Proxy: honors HTTP(S)_PROXY env via fetch; explicit per-request proxyUrl
//   sessions keep separate cookie jars but share the process egress.

export const DUCK_BASE_URL = "https://duck.ai";
export const DUCK_STATUS_URL = `${DUCK_BASE_URL}/duckchat/v1/status`;
export const DUCK_CHAT_URL = `${DUCK_BASE_URL}/duckchat/v1/chat`;
export const DUCK_HOME_URL = `${DUCK_BASE_URL}/`;

export const DUCK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// Transport selection (port notes: Go uses bogdanfinn/tls-client Chrome-146
// fingerprint; native fetch has Bun's fingerprint).
// Default is impersonate (Chrome146) to match Go; only explicit
// DUCK_FETCH=native opts out. This avoids silent TLS-fingerprint mismatch
// (418/429) when the env is unset.
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn | null = null;
let duckFetchDegraded = false;

export function isDuckFetchDegraded(): boolean {
  return duckFetchDegraded;
}

async function getFetch(): Promise<FetchFn> {
  if (fetchImpl) return fetchImpl;
  const mode = (process.env["DUCK_FETCH"] ?? "impersonate").toLowerCase();
  if (mode !== "native") {
    try {
      const mod = (await import("fetch-impersonate")) as {
        default?: FetchFn;
        createFetch?: (defaults: Record<string, unknown>) => FetchFn;
      };
      const preset = process.env["DUCK_IMPERSONATE_TARGET"] ?? "chrome146";
      fetchImpl =
        mod.createFetch?.({ impersonate: preset }) ??
        (async (url: string, init?: RequestInit) =>
          (mod.default as FetchFn)(url, { ...init, impersonate: preset } as RequestInit));
    } catch (error) {
      duckFetchDegraded = true;
      console.warn(
        `[duck2api] fetch-impersonate failed to load (DUCK_FETCH=${mode}), falling back to native fetch with degraded TLS fingerprint; expect 418/429. error: ${error}`,
      );
      fetchImpl = (url, init) => fetch(url, init);
    }
  } else {
    fetchImpl = (url, init) => fetch(url, init);
  }
  return fetchImpl;
}

const REQUEST_INTERVAL_MS = 10_000;
const CHALLENGE_RETRIES = 1;
const RETRY_STEP_MS = 10_000;
const RETRY_MAX_MS = 120_000;

function backoff(retryNumber: number): number {
  const n = Math.max(1, retryNumber);
  return Math.min(n * RETRY_STEP_MS, RETRY_MAX_MS);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function randomHex(byteLength: number): string {
  try {
    return randomBytes(byteLength).toString("hex");
  } catch {
    return Date.now().toString(16);
  }
}

/** Minimal cookie jar: name=value pairs per proxy session. */
class Jar {
  private cookies = new Map<string, string>();
  store(setCookie: string[] | undefined): void {
    if (!setCookie) return;
    for (const line of setCookie) {
      const pair = line.split(";", 1)[0];
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  clear(): void {
    this.cookies.clear();
  }
}

interface Session {
  jar: Jar;
  vqd: string;
  feVersion: string;
  feExpireAt: number;
}

const sessions = new Map<string, Session>();

function sessionFor(proxyUrl: string): Session {
  let s = sessions.get(proxyUrl);
  if (!s) {
    s = { jar: new Jar(), vqd: "", feVersion: "", feExpireAt: 0 };
    sessions.set(proxyUrl, s);
  }
  return s;
}

export function resetSession(proxyUrl: string): void {
  const s = sessions.get(proxyUrl);
  if (!s) return;
  s.jar.clear();
  s.vqd = "";
  s.feVersion = "";
  s.feExpireAt = 0;
}

function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    "content-type": "application/json",
    origin: DUCK_BASE_URL,
    pragma: "no-cache",
    referer: DUCK_HOME_URL,
    "sec-ch-ua": `"Google Chrome";v="146", "Chromium";v="146", "Not)A;Brand";v="24"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"Windows"`,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": DUCK_UA,
    ...extra,
  };
}

function collectCookies(res: Response, jar: Jar): void {
  const raw: string[] | undefined =
    // Bun/undici expose getSetCookie(); fallback to single header.
    typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : undefined;
  if (raw) {
    jar.store(raw);
    return;
  }
  const single = res.headers.get("set-cookie");
  if (single) jar.store([single]);
}

export function createFESignals(nowMs = Date.now()): string {
  // Reproduce the frontend event log: load -> ponder -> type -> send.
  const randBelow = (n: number) => (n <= 0 ? 0 : Math.floor(Math.random() * n));
  const impression = 50 + randBelow(100);
  const action = impression + 5000 + randBelow(25000);
  const finish = action + 1000 + randBelow(9000);
  const startChat = finish + 10 + randBelow(90);
  const end = startChat + randBelow(10);
  const payload = {
    start: nowMs - end,
    events: [
      { name: "onboarding_impression", delta: impression },
      { name: "action", delta: action, trusted: true },
      { name: "onboarding_finish", delta: finish },
      { name: "startNewChat_free", delta: startChat },
    ],
    end,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

async function fetchFEVersion(session: Session): Promise<string> {
  if (session.feVersion !== "" && session.feExpireAt > Date.now()) return session.feVersion;
  const doFetch = await getFetch();
  const headers = baseHeaders({ accept: "text/html" });
  const cookie = session.jar.header();
  if (cookie) headers["cookie"] = cookie;
  const res = await doFetch(DUCK_HOME_URL, { headers });
  collectCookies(res, session.jar);
  const body = await res.text();
  const tag = body.match(/data-version-tag="([^"]+)"/)?.[1];
  const sha = body.match(/data-version-sha="([^"]+)"/)?.[1];
  if (!tag || !sha) throw new Error("duck.ai version metadata not found");
  session.feVersion = `${tag}-${sha}`;
  session.feExpireAt = Date.now() + 30 * 60_000;
  return session.feVersion;
}

/** Fresh VQD token for one conversation (port of fetchXVQD). */
async function fetchXVQD(session: Session): Promise<{ token?: string; status?: number }> {
  const doFetch = await getFetch();
  const headers = baseHeaders({ accept: "*/*", "x-vqd-accept": "1" });
  const cookie = session.jar.header();
  if (cookie) headers["cookie"] = cookie;
  const res = await doFetch(DUCK_STATUS_URL, { headers });
  collectCookies(res, session.jar);
  if (res.status < 200 || res.status >= 300) {
    // Go parity (fetchXVQD): caller maps the status; close the body without
    // disturbing it for reuse.
    await res.body?.cancel().catch(() => undefined);
    return { status: res.status };
  }
  // Go parity: fetchXVQD only needs the x-vqd-hash-1 header; the status body
  // is discarded via Close, never read. Cancel instead of arrayBuffer() so we
  // never disturb/lock a body we don't own.
  await res.body?.cancel().catch(() => undefined);
  const hash = res.headers.get("x-vqd-hash-1");
  if (!hash) throw new Error("no x-vqd-hash-1 token");
  return { token: await generateVQDHash(hash) };
}

export interface ConversationResult {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  /** Upstream SSE body stream (only when ok). */
  body?: ReadableStream<Uint8Array> | null;
  /** Error payload for non-ok mapping. */
  errorBody?: string;
  retryAfterSec?: number;
}

let lastConversationEnd = 0;
let rateLimitUntil = 0;
let rateLimitFails = 0;
let queue: Promise<void> = Promise.resolve();

async function waitSlot(): Promise<void> {
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  const prev = queue;
  queue = next;
  try {
    await prev;
    const now = Date.now();
    let wait = 0;
    if (lastConversationEnd > 0) wait = Math.max(wait, lastConversationEnd + REQUEST_INTERVAL_MS - now);
    wait = Math.max(wait, rateLimitUntil - now);
    if (wait > 0) await sleep(wait);
  } finally {
    lastConversationEnd = Date.now();
    release();
  }
}

function cooldownResult(): ConversationResult {
  const seconds = Math.max(1, Math.ceil((rateLimitUntil - Date.now()) / 1000) + 1);
  return {
    ok: false,
    status: 503,
    headers: { "content-type": "application/json", "retry-after": String(seconds), "x-upstream-status": "429" },
    errorBody: `{"error":"Duck.ai conversation cooldown active","retry_after":${seconds}}`,
    retryAfterSec: seconds,
  };
}

async function postOnce(session: Session, request: DuckApiRequest, token: string): Promise<Response> {
  const doFetch = await getFetch();
  const headers = baseHeaders({
    accept: "text/event-stream",
    priority: "u=1, i",
    "x-ddg-journey-id": randomHex(16),
    "x-fe-signals": createFESignals(),
    "x-vqd-hash-1": token,
  });
  try {
    const fe = await fetchFEVersion(session);
    if (fe) headers["x-fe-version"] = fe;
  } catch {
    // FE version is best-effort; the conversation may still succeed.
  }
  const cookie = session.jar.header();
  if (cookie) headers["cookie"] = cookie;
  // Strip local-only fields (json:"-") before sending.
  const { toolSimulation: _ignored, ...wire } = request;
  void _ignored;
  const res = await doFetch(DUCK_CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(wire),
  });
  collectCookies(res, session.jar);
  return res;
}

/**
 * Port of POSTconversation: cooldown fast-fail, slot pacing, per-conversation
 * VQD, 429 -> recorded cooldown + 503 mapping, single bounded 418 retry with a
 * fresh session/VQD/UUIDs.
 */
export async function postConversation(
  request: DuckApiRequest,
  explicitToken: string,
  proxyUrl: string,
): Promise<ConversationResult> {
  const session = sessionFor(proxyUrl);
  await waitSlot();
  try {
    if (!explicitToken && rateLimitUntil > Date.now()) return cooldownResult();

    let token = explicitToken;
    if (!token) {
      const fresh = await fetchXVQD(session);
      if (fresh.status !== undefined) {
        if (fresh.status === 429) return rateLimited(proxyUrl);
        return {
          ok: false,
          status: fresh.status,
          headers: { "content-type": "application/json" },
          errorBody: `{"error":"Duck.ai status check failed","status":${fresh.status}}`,
        };
      }
      token = fresh.token ?? "";
    }

    let res = await postOnce(session, request, token);
    if (res.status === 429) return rateLimited(proxyUrl, res);
    if (res.status >= 200 && res.status < 300) {
      rateLimitFails = 0;
      rateLimitUntil = 0;
      return { ok: true, status: res.status, headers: {}, body: res.body };
    }
    if (res.status === 400) {
      // Duck.ai intermittently answers 400 ERR_BAD_REQUEST even for a valid
      // wire (observed on trivial follow-ups right after a 200). Retry once
      // with a fresh session/VQD/UUIDs like the 418 path, but without the
      // challenge backoff sleep. A repeat 400 means the payload itself is
      // rejected: surface it instead of looping.
      await res.body?.cancel().catch(() => undefined);
      resetSession(proxyUrl);
      const retrySession = sessionFor(proxyUrl);
      request.durableStream.messageId = randomUUID();
      request.durableStream.conversationId = randomUUID();
      const retryToken = await fetchXVQD(retrySession);
      if (retryToken.status !== undefined) {
        if (retryToken.status === 429) return rateLimited(proxyUrl);
        return {
          ok: false,
          status: retryToken.status,
          headers: { "content-type": "application/json" },
          errorBody: `{"error":"Duck.ai status check failed","status":${retryToken.status}}`,
        };
      }
      res = await postOnce(retrySession, request, retryToken.token ?? "");
      if (res.status === 429) return rateLimited(proxyUrl, res);
      if (res.status >= 200 && res.status < 300) {
        rateLimitFails = 0;
        rateLimitUntil = 0;
        return { ok: true, status: res.status, headers: {}, body: res.body };
      }
    }
    if (res.status !== 418) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, headers: {}, errorBody: text };
    }

    // 418 challenge retries (bounded to CHALLENGE_RETRIES=1): fresh
    // session/VQD/UUIDs each round. Returns inside; the loop bound is the
    // retry budget.
    for (let challengeAttempt = 0; challengeAttempt < CHALLENGE_RETRIES; challengeAttempt++) {
      const firstBody = await res.text().catch(() => "");
      void firstBody;
      await sleep(backoff(1));
      resetSession(proxyUrl);
      const retrySession = sessionFor(proxyUrl);
      request.durableStream.messageId = randomUUID();
      request.durableStream.conversationId = randomUUID();
      const fresh = await fetchXVQD(retrySession);
      if (fresh.status !== undefined) {
        if (fresh.status === 429) return rateLimited(proxyUrl);
        return {
          ok: false,
          status: fresh.status,
          headers: { "content-type": "application/json" },
          errorBody: `{"error":"Duck.ai status check failed","status":${fresh.status}}`,
        };
      }
      res = await postOnce(retrySession, request, fresh.token ?? "");
      if (res.status === 429) return rateLimited(proxyUrl, res);
      if (res.status >= 200 && res.status < 300) {
        rateLimitFails = 0;
        rateLimitUntil = 0;
        return { ok: true, status: res.status, headers: {}, body: res.body };
      }
      if (res.status === 418) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: 502, headers: {}, errorBody: text };
      }
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, headers: {}, errorBody: text };
    }
    const exhausted = await res.text().catch(() => "");
    return { ok: false, status: 502, headers: {}, errorBody: exhausted };
  } finally {
    lastConversationEnd = Date.now();
  }
}

function rateLimited(proxyUrl: string, res?: Response): ConversationResult {
  rateLimitFails++;
  const waitMs = backoff(rateLimitFails);
  rateLimitUntil = Math.max(rateLimitUntil, Date.now() + waitMs);
  resetSession(proxyUrl);
  // Go parity (rateLimitedConversationResponse): drain the 429 body so the
  // connection is released instead of leaking a locked stream.
  if (res) void res.body?.cancel().catch(() => undefined);
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  return {
    ok: false,
    status: 503,
    headers: { "retry-after": String(seconds), "x-upstream-status": "429" },
    errorBody: `{"error":"upstream rate limited","retry_after":${seconds}}`,
    retryAfterSec: seconds,
  };
}
