import type { ThreadItem, ToolDef, TurnResult } from "./types.ts";

export type MiniProtocol = "responses" | "chat";

export function sanitizeThread(thread: ThreadItem[]): ThreadItem[] {
  const seenCall = new Set<string>();
  const seenOutput = new Set<string>();
  const out: ThreadItem[] = [];
  for (const it of thread) {
    if (it.type === "function_call") {
      if (!it.callId || seenCall.has(it.callId)) continue;
      seenCall.add(it.callId);
      out.push(it);
      continue;
    }
    if (it.type === "function_call_output") {
      if (!it.callId || seenOutput.has(it.callId)) continue;
      seenOutput.add(it.callId);
      out.push(it);
      continue;
    }
    out.push(it);
  }
  return out.filter((it) => it.type !== "function_call_output" || seenCall.has(it.callId));
}

export function toResponsesInput(thread: ThreadItem[]) {
  const out: Array<Record<string, unknown>> = [];
  for (const it of thread) {
    // Reasoning summaries are local-only: re-sending them as empty assistant
    // messages degrades coherence (model sees phantom turns). Skip them.
    if (it.type === "reasoning") continue;
    // Plan items ride as user text (server parity: restoreMiniPlan folds them
    // back into visible checklist text on compaction).
    if (it.type === "plan") out.push({ role: "user", content: [{ type: "input_text", text: it.text }] });
    if (it.type === "user") out.push({ role: "user", content: [{ type: "input_text", text: it.text }] });
    else if (it.type === "message") out.push({ role: "assistant", content: [{ type: "output_text", text: it.text }] });
    else if (it.type === "function_call") {
      out.push({ type: "function_call", call_id: it.callId, name: it.name, arguments: it.args });
    }
    else if (it.type === "function_call_output") {
      // Image results ride as native input_image blocks (Codex view_image parity);
      // plain text outputs stay strings.
      if (it.images?.length) {
        out.push({
          type: "function_call_output",
          call_id: it.callId,
          output: [
            { type: "input_text", text: it.output.slice(0, 2000) || "[Image attached]" },
            ...it.images.map((url) => ({ type: "input_image", image_url: url, detail: "high" })),
          ],
        });
      }
      else out.push({ type: "function_call_output", call_id: it.callId, output: it.output.slice(0, 8000) });
    }
  }
  return out;
}

export function toChatMessages(thread: ThreadItem[], system: string) {
  const msgs: Array<Record<string, unknown>> = [{ role: "system", content: system }];
  for (const it of thread) {
    // Reasoning summaries are local-only (see toResponsesInput).
    if (it.type === "reasoning") continue;
    // Plan items ride as user text (server parity).
    if (it.type === "plan") msgs.push({ role: "user", content: it.text });
    if (it.type === "user") msgs.push({ role: "user", content: it.text });
    else if (it.type === "message") msgs.push({ role: "assistant", content: it.text });
    else if (it.type === "function_call") {
      msgs.push({ role: "assistant", content: null, tool_calls: [{ id: it.callId, type: "function", function: { name: it.name, arguments: it.args } }] });
    } else if (it.type === "function_call_output") {
      if (it.images?.length) {
        msgs.push({
          role: "tool", tool_call_id: it.callId,
          content: [
            { type: "text", text: it.output.slice(0, 2000) || "[Image attached]" },
            ...it.images.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        });
      } else {
        msgs.push({ role: "tool", tool_call_id: it.callId, content: it.output.slice(0, 8000) });
      }
    }
  }
  return msgs;
}

/* ---------------- thinking/effort gating (codecli parity) ----------------
 * Original: e:/projects/codecli/src/utils/effort.ts
 * - modelSupportsEffort: opus-4-6/sonnet-4-6 allowlist true, plus the whole
 *   5th-gen Claude family (opus/sonnet/haiku/fable/mythos-5); other
 *   haiku/sonnet/opus legacy false; unknown models default true.
 * - resolveAppliedEffort: explicit > env > model default; max clamps to
 *   high on non-Opus-4-6 (API rejects max elsewhere).
 * Relay effect: legacy haiku-class models must omit reasoning/reasoning_effort
 * entirely, otherwise the gateway strips it (dashboard shows "-") and the
 * turn can 400-retry into repeated inbound rows. Exception: the 5th-gen
 * Claude family (verified: haiku-5-5, sonnet-5-5) supports thinking, so it
 * sends effort like other supported models (shared catalog default:
 * low/medium/high).
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function modelSupportsEffort(model: string): boolean {
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus-4-6") || m.includes("sonnet-4-6")) return true;
  // 5th-gen Claude families support thinking/effort (newer than the codecli
  // allowlist which predates them: verified haiku-5-5, sonnet-5-5).
  // Match dotted/underscored variants too (haiku-5.5, sonnet_5_5).
  const norm = m.replace(/[._\s]+/g, "-");
  if (/(?:^|[\/-])(opus|sonnet|haiku|fable|mythos)-5(?:[\/-]|$)/.test(norm)) return true;
  if (m.includes("haiku") || m.includes("sonnet") || m.includes("opus")) return false;
  return true;
}

export function modelSupportsMaxEffort(model: string): boolean {
  return (model ?? "").toLowerCase().includes("opus-4-6");
}

function parseEffortValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const s = String(value).trim().toLowerCase();
  if ((EFFORT_LEVELS as readonly string[]).includes(s)) return s;
  return undefined;
}

function getEffortEnvOverride(): string | null | undefined {
  const raw = (process.env.MINI_EFFORT ?? process.env.CLAUDE_CODE_EFFORT_LEVEL ?? "").trim();
  if (!raw) return undefined;
  const low = raw.toLowerCase();
  if (low === "unset" || low === "auto") return null;
  return parseEffortValue(low);
}

/** Resolve the effort to send, or undefined when the param must be omitted. */
export function resolveAppliedEffort(model: string, explicit?: string): string | undefined {
  if (!modelSupportsEffort(model)) return undefined;
  const env = getEffortEnvOverride();
  if (env === null) return undefined;
  const resolved = parseEffortValue(explicit) ?? env ?? "medium";
  if (resolved === "max" && !modelSupportsMaxEffort(model)) return "high";
  return resolved;
}

export type TurnOpts = {
  baseUrl: string;
  apiKey: string;
  model: string;
  effort?: string;
  system: string;
  thread: ThreadItem[];
  tools: ToolDef[];
  protocol?: MiniProtocol;
  /**
   * Responses-protocol chaining (upstream parity: miniBridge
   * resolveResponsesRoundInput). When set, only this prebuilt input suffix is
   * sent together with previous_response_id instead of the whole transcript.
   * Ignored by the chat protocol (no previous_response_id there).
   */
  responsesInput?: Array<Record<string, unknown>>;
  previousResponseId?: string | null;
};

export async function createTurn(opts: TurnOpts): Promise<TurnResult> {
  if ((opts.protocol ?? "responses") === "chat") return createChatTurn(opts);
  return createResponsesTurn(opts);
}

/* ---------------- upstream retry (miniBridge parity) ---------------- */

function numEnvInt(key: string, fallback: number, min: number, max: number): number {
  const t = (process.env[key] ?? "").trim();
  if (!t) return fallback;
  const n = Number(t);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export const MINI_UPSTREAM_RETRY_BASE_DELAY_MS = 500;
export const MINI_UPSTREAM_RETRY_MAX_DELAY_MS = 10_000;

/** Retryable upstream statuses (mirrors the relay-facing set in miniBridge). */
export function isUpstreamRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isAbortError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e ?? "");
  return /aborterror|aborted|operation was aborted/i.test(m);
}

export function upstreamRetryDelayMs(retryIndex: number, retryAfterMs?: number): number {
  if (retryAfterMs != null && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(MINI_UPSTREAM_RETRY_MAX_DELAY_MS, Math.round(retryAfterMs));
  }
  return Math.min(MINI_UPSTREAM_RETRY_MAX_DELAY_MS, MINI_UPSTREAM_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryIndex));
}

/** Parse Retry-After / retry-after-ms headers plus "retry in N s" body hints. */
export function upstreamRetryAfterMs(headers?: Headers | null, bodyText?: string): number | undefined {
  const raw = headers?.get("retry-after")?.trim() ?? "";
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const rawMs = headers?.get("retry-after-ms")?.trim() ?? "";
  if (rawMs) {
    const ms = Number(rawMs);
    if (Number.isFinite(ms)) return Math.max(0, Math.round(ms));
  }
  if (bodyText) {
    const match = /(?:try again|retry)(?:\s+after|\s+in)?\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds?|s|seconds?)/i.exec(bodyText);
    if (match) {
      const value = Number(match[1]);
      const unit = (match[2] ?? "s").toLowerCase();
      if (Number.isFinite(value)) return Math.max(0, Math.round(unit.startsWith("ms") ? value : value * 1000));
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Relay-facing fetch with bounded retries (upstream parity: miniBridge
 * fetchMiniUpstream). Retryable HTTP statuses and network failures sleep with
 * exponential backoff (honoring Retry-After) and retry; anything else returns
 * as-is. After exhaustion it throws a `responses|chat <status>: <snippet>`
 * error matching the historical message shape — callers keep their `!res.ok`
 * guards for the non-retryable path.
 */
export async function fetchMiniUpstream(url: string, init: RequestInit, kind: "responses" | "chat", maxRetries?: number): Promise<Response> {
  const retries = maxRetries ?? numEnvInt("MINI_UPSTREAM_RETRIES", 3, 0, 10);
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (isAbortError(e) || attempt >= retries) throw e;
      try {
        process.stderr.write(`[mini] upstream network error (${(e as Error)?.message ?? e}), retry ${attempt + 1}/${retries}.\n`);
      } catch { /* ignore */ }
      await sleep(upstreamRetryDelayMs(attempt));
      attempt++;
      continue;
    }
    if (res.ok || !isUpstreamRetryableStatus(res.status) || attempt >= retries) {
      if (!res.ok && attempt >= retries && isUpstreamRetryableStatus(res.status)) {
        let snippet = "";
        try { snippet = (await res.text()).slice(0, 500); } catch { /* ignore */ }
        throw new Error(`${kind} ${res.status}: ${snippet} (retries exhausted)`);
      }
      return res;
    }
    let bodyText = "";
    try { bodyText = await res.text(); } catch { /* ignore */ }
    const delay = upstreamRetryDelayMs(attempt, upstreamRetryAfterMs(res.headers, bodyText));
    try {
      process.stderr.write(`[mini] upstream ${res.status}, retry ${attempt + 1}/${retries} in ${delay}ms.\n`);
    } catch { /* ignore */ }
    await sleep(delay);
    attempt++;
  }
}

/* ---------------- previous_response_id chaining (miniBridge parity) ---------------- */

/** Conversation state for responses `previous_response_id` chaining. */
export interface MiniResponsesChain {
  /** Last stored response id, or null when the next round must send full input. */
  prevId: string | null;
  /** Hash of the input prefix already stored server-side. */
  sentHash: string;
  /** Item count of that stored prefix. */
  sentCount: number;
}

export const EMPTY_MINI_RESPONSES_CHAIN: MiniResponsesChain = { prevId: null, sentHash: "", sentCount: 0 };

/** Tiny FNV-1a hash (avoids a crypto import for a prefix-equality check). */
export function hashMiniChainPrefix(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Resolve a responses round into full or chained input. When the thread still
 * starts with the exact prefix the server stored (hash match), only the new
 * suffix is sent with `previous_response_id`. Any mutation breaks the match
 * and falls back to a full send, so chaining can never corrupt the thread.
 */
export function resolveResponsesRoundInput<T extends Record<string, any>>(
  full: T[],
  chain: MiniResponsesChain,
): { input: T[]; previousResponseId: string | null; chained: boolean } {
  if (chain.prevId && chain.sentCount > 0 && full.length >= chain.sentCount) {
    try {
      if (hashMiniChainPrefix(JSON.stringify(full.slice(0, chain.sentCount))) === chain.sentHash) {
        return { input: full.slice(chain.sentCount), previousResponseId: chain.prevId, chained: true };
      }
    } catch {
      // Fall through to a full send.
    }
  }
  return { input: full, previousResponseId: null, chained: false };
}

/** Advance the chain after a round whose response the server stored. */
export function advanceResponsesChain<T extends Record<string, any>>(
  full: T[],
  responseId: string | null | undefined,
): MiniResponsesChain {
  if (!responseId) return EMPTY_MINI_RESPONSES_CHAIN;
  try {
    return { prevId: responseId, sentHash: hashMiniChainPrefix(JSON.stringify(full)), sentCount: full.length };
  } catch {
    return EMPTY_MINI_RESPONSES_CHAIN;
  }
}

/** A chained round the relay rejects (400 / stale id) must retry once with full input. */
export function isChainRejectedError(e: unknown, status?: number): boolean {
  if (status === 400) return true;
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /previous_response_id|previous response|invalid.*response.*id|expired.*response|response.*not found|response.*expired/i.test(msg);
}

/**
 * One responses round through the chain: send only the new suffix when the
 * thread prefix matches what the server stored, else send full input. A relay
 * rejection of a chained round retries once with full input (miniBridge
 * parity), so a stale/expired stored response degrades to one wasted call,
 * never a failed turn.
 */
export async function createChainedTurn(
  opts: TurnOpts,
  fullInput: Array<Record<string, unknown>>,
  chain: MiniResponsesChain,
): Promise<{ result: TurnResult; chain: MiniResponsesChain }> {
  const round = resolveResponsesRoundInput(fullInput, chain);
  try {
    const result = await createTurn({ ...opts, responsesInput: round.input, previousResponseId: round.previousResponseId });
    return { result, chain: advanceResponsesChain(fullInput, result.responseId) };
  } catch (e) {
    if (round.chained && isChainRejectedError(e)) {
      try {
        process.stderr.write(`[mini] previous_response_id rejected by relay; retrying with full input.\n`);
      } catch { /* ignore */ }
      const result = await createTurn({ ...opts });
      return { result, chain: advanceResponsesChain(fullInput, result.responseId) };
    }
    throw e;
  }
}

export async function createResponsesTurn(opts: TurnOpts): Promise<TurnResult> {
  const effort = resolveAppliedEffort(opts.model, opts.effort);
  const res = await fetchMiniUpstream(`${opts.baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      ...(effort ? { reasoning: { effort } } : {}),
      instructions: opts.system,
      input: opts.responsesInput ?? toResponsesInput(opts.thread),
      ...(opts.previousResponseId ? { previous_response_id: opts.previousResponseId } : {}),
      tools: opts.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.schema })),
      tool_choice: "auto",
      parallel_tool_calls: true,
    }),
  }, "responses");
  if (!res.ok) throw new Error(`responses ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = (await res.json()) as { id?: unknown; output?: Array<Record<string, any>> };
  const items: ThreadItem[] = [];
  const calls: TurnResult["calls"] = [];
  const seenCallId = new Set<string>();
  let text = "";
  for (const o of data.output ?? []) {
    if (o.type === "message" && Array.isArray(o.content)) {
      const t = o.content.map((c: any) => c.text ?? "").join("");
      text += t;
      items.push({ type: "message", text: t });
    } else if (o.type === "reasoning") {
      const t = (o.summary ?? []).map((s: any) => s.text ?? "").join("") || "";
      if (t) items.push({ type: "reasoning", text: t });
    } else if (o.type === "function_call") {
      const c = { callId: String(o.call_id ?? o.id ?? Math.random()), name: String(o.name), args: String(o.arguments ?? "{}") };
      if (seenCallId.has(c.callId)) continue;
      seenCallId.add(c.callId);
      calls.push(c);
      items.push({ type: "function_call", ...c });
    }
  }
  return { items, calls, text, responseId: typeof data.id === "string" ? data.id : undefined };
}

export async function createChatTurn(opts: TurnOpts): Promise<TurnResult> {
  const effort = resolveAppliedEffort(opts.model, opts.effort);
  const res = await fetchMiniUpstream(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: toChatMessages(opts.thread, opts.system),
      tools: opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } })),
      tool_choice: "auto",
      parallel_tool_calls: true,
    }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = (await res.json()) as { id?: unknown; choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> };
  const msg = data.choices?.[0]?.message;
  const items: ThreadItem[] = [];
  const calls: TurnResult["calls"] = [];
  const text = typeof msg?.content === "string" ? msg.content : "";
  if (text) items.push({ type: "message", text });
  const seenCallId = new Set<string>();
  for (const tc of msg?.tool_calls ?? []) {
    const c = { callId: String(tc.id ?? Math.random()), name: String(tc.function?.name ?? ""), args: String(tc.function?.arguments ?? "{}") };
    if (!c.name || seenCallId.has(c.callId)) continue;
    seenCallId.add(c.callId);
    calls.push(c);
    items.push({ type: "function_call", ...c });
  }
  return { items, calls, text, responseId: typeof data.id === "string" ? data.id : undefined };
}
