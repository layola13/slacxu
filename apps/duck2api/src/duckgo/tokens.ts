import { createHash } from "node:crypto";
import { encodingForModel } from "js-tiktoken";
import type { ApiMessage } from "../types.js";
import { messageText } from "../types.js";

// Port of E:\projects\duck2api\util\util.go (token + cache-simulation half).

export function countToken(input: string): number {
  try {
    const enc = encodingForModel("gpt-4o-mini");
    return enc.encode(input).length;
  } catch {
    return 0;
  }
}

export function countMessagesTokens(messages: ApiMessage[]): number {
  return countToken(messages.map((m) => `${messageText(m.content)}\n`).join(""));
}

export function hashPrompt(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  tokens: number;
  createdAt: number;
  expiresAt: number;
}

const cacheStore = new Map<string, CacheEntry>();

/** Port of RecordCache: first sight -> creation, repeat within TTL -> read. */
export function recordCache(promptHash: string, tokens: number): { creation: number; read: number } {
  if (!promptHash || tokens <= 0) return { creation: 0, read: 0 };
  const now = Date.now();
  for (const [k, v] of cacheStore) {
    if (now > v.expiresAt) cacheStore.delete(k);
  }
  const hit = cacheStore.get(promptHash);
  if (hit && now < hit.expiresAt) return { creation: 0, read: hit.tokens };
  cacheStore.set(promptHash, { tokens, createdAt: now, expiresAt: now + CACHE_TTL_MS });
  return { creation: tokens, read: 0 };
}

export function cacheHeaders(promptHash: string): { xCache: "HIT" | "MISS"; age: number } {
  if (!promptHash) return { xCache: "MISS", age: 0 };
  const now = Date.now();
  const hit = cacheStore.get(promptHash);
  if (hit && now < hit.expiresAt) {
    return { xCache: "HIT", age: Math.floor((now - hit.createdAt) / 1000) };
  }
  return { xCache: "MISS", age: 0 };
}
