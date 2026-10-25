import { getEncoding } from "js-tiktoken";

// Base64 data URLs (images/audio/video) would otherwise dominate the count;
// blank them before measuring, mirroring the previous char heuristic.
const DATA_URL_RE = /data:(?:image|audio|video)\/[^;,]+;base64,[A-Za-z0-9+/=]+/g;

// CJK characters cost roughly one token each on common BPE tokenizers while
// latin averages ~4 chars/token — the fallback keeps that split so CJK-heavy
// sessions are not under-read when the WASM encoder cannot load.
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/g;

type Encoder = { encode(text: string): number[] };

let cachedEncoder: Encoder | null = null;
let encoderFailed = false;

function o200k(): Encoder | null {
  if (cachedEncoder) return cachedEncoder;
  if (encoderFailed) return null;
  try {
    cachedEncoder = getEncoding("o200k_base") as unknown as Encoder;
    return cachedEncoder;
  } catch {
    encoderFailed = true;
    return null;
  }
}

export function cleanMiniTokenText(text: unknown): string {
  const s = typeof text === "string" ? text : String(text ?? "");
  return s.replace(DATA_URL_RE, "[attachment]");
}

export function heuristicMiniTokens(cleaned: string): number {
  const cjk = cleaned.match(CJK_RE)?.length ?? 0;
  return Math.max(0, Math.ceil(cjk * 1.2 + (cleaned.length - cjk) / 4));
}

/**
 * Exact-ish token count (o200k_base, the GPT-5-era OpenAI encoding most relay
 * models share) with heuristic fallback when the encoder cannot load.
 * Pure function of text — safe for per-round budget checks.
 */
export function countMiniTokens(text: unknown): number {
  const cleaned = cleanMiniTokenText(text);
  if (!cleaned) return 0;
  try {
    const enc = o200k();
    if (enc) return enc.encode(cleaned).length;
  } catch {
    // Fall through to the heuristic below.
  }
  return heuristicMiniTokens(cleaned);
}
