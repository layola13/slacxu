/**
 * JEV <-> OpenAI bridge converter.
 *
 * Lets any existing OpenAI-compatible relay (chat/completions or responses)
 * serve JEV evaluations. JEV native shape:
 *   in:  { state: string, model: string, questions: { [qid]: { type, instructions, criteria } } }
 *   out: { answers: { [qid]: { choice?, score?, noul?, confidence?, reason? } }, model?, usage? }
 * Bridge keeps that shape and adds a `reason` string per answer (user request).
 */

export type JevBridgeProtocol = "openai-chat" | "openai-responses";

export type JevBridgeQuestion = {
  type?: string;
  instructions?: string;
  criteria?: unknown;
};

export function normalizeBridgeProtocol(raw: unknown): JevBridgeProtocol {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "openai-responses" || v === "responses" || v === "response") return "openai-responses";
  return "openai-chat";
}

export function isNativeJevUpstream(baseUrl: string): boolean {
  const v = (baseUrl || "").toLowerCase();
  return v.includes("systemone") || v.includes("typesafe.ai");
}

function stringifyCriteria(criteria: unknown): string {
  if (criteria == null) return "(no criteria)";
  if (typeof criteria === "string") return criteria;
  if (Array.isArray(criteria)) {
    return criteria.map((c, i) => `${i}: ${String(c)}`).join("\n");
  }
  if (typeof criteria === "object") {
    return Object.entries(criteria as Record<string, unknown>)
      .map(([k, v]) => `"${k}": ${String(v)}`)
      .join("\n");
  }
  return String(criteria);
}

export function buildJevBridgeSystemPrompt(): string {
  return [
    "You are a strict JEV (TypeSafe SystemOne) evaluation engine.",
    "You receive a STATE and a set of QUESTIONS. Answer every question.",
    "Return ONLY a single JSON object, no markdown, no prose:",
    '{"answers": {"<qid>": {"choice"|"score"|"noul": ..., "confidence": 0..1, "reason": "..."}}}',
    "Rules:",
    '- For type "choice": output {"choice": "<exact criteria key>", "confidence": 0..1, "reason": "<one sentence why>"}. The choice MUST be one of the listed criteria keys.',
    '- For type "score": output {"score": <number>, "confidence": 0..1, "reason": "..."}. If criteria is a list, score is the 0-based index into it; otherwise score 0..10.',
    '- For type "noul" (or unknown type): output {"noul": <0..1 risk/presence value>, "confidence": 0..1, "reason": "..."}.',
    "- Always include a short reason (<=140 chars) for every answer.",
    "- Confidence is 0..1. If unsure, use 0.5.",
  ].join("\n");
}

export function buildJevBridgeUserPrompt(
  state: string,
  questions: Record<string, JevBridgeQuestion>,
): string {
  const lines: string[] = [];
  lines.push("[STATE]");
  lines.push((state || "").slice(0, 8000) || "(empty)");
  lines.push("");
  lines.push("[QUESTIONS] (answer ALL, keep qids exact)");
  for (const [qid, q] of Object.entries(questions)) {
    const type = (q?.type || "choice").toString();
    lines.push(`--- qid: "${qid}" | type: ${type}`);
    lines.push(`instructions: ${(q?.instructions || "").toString().slice(0, 2000)}`);
    lines.push(`criteria:\n${stringifyCriteria(q?.criteria).slice(0, 3000)}`);
  }
  lines.push("");
  lines.push('Respond with JSON only: {"answers": {...}}');
  return lines.join("\n");
}

export function buildJevBridgeChatBody(
  model: string,
  state: string,
  questions: Record<string, JevBridgeQuestion>,
): Record<string, unknown> {
  return {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildJevBridgeSystemPrompt() },
      { role: "user", content: buildJevBridgeUserPrompt(state, questions) },
    ],
  };
}

export function buildJevBridgeResponsesBody(
  model: string,
  state: string,
  questions: Record<string, JevBridgeQuestion>,
): Record<string, unknown> {
  return {
    model,
    temperature: 0,
    instructions: buildJevBridgeSystemPrompt(),
    input: buildJevBridgeUserPrompt(state, questions),
    text: { format: { type: "json_object" } },
  };
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  // Strip code fences.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to largest {...} substring.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function clamp01(v: unknown, fallback = 0.5): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clampReason(v: unknown): string {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim().slice(0, 300);
}

function normalizeChoiceAnswer(
  raw: Record<string, unknown>,
  criteriaKeys: string[],
): { choice: string; confidence: number; reason: string } {
  const rawChoice = typeof raw.choice === "string" ? raw.choice.trim() : "";
  let choice = rawChoice;
  if (criteriaKeys.length > 0) {
    const lower = rawChoice.toLowerCase();
    const exact = criteriaKeys.find((k) => k === rawChoice)
      ?? criteriaKeys.find((k) => k.toLowerCase() === lower);
    choice = exact ?? rawChoice ?? criteriaKeys[0]!;
  }
  return {
    choice,
    confidence: clamp01(raw.confidence, 0.5),
    reason: clampReason(raw.reason ?? raw.why ?? raw.explanation),
  };
}

/** Extract plain text from an OpenAI chat/completions JSON payload. */
export function extractChatText(payload: unknown): string {
  const root = (payload ?? {}) as Record<string, unknown>;
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = (choices[0] ?? {}) as Record<string, unknown>;
  const message = (first.message ?? {}) as Record<string, unknown>;
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const p = (part ?? {}) as Record<string, unknown>;
        if (typeof p.text === "string") return p.text;
        if (typeof (p as { content?: unknown }).content === "string") {
          return (p as { content: string }).content;
        }
        return "";
      })
      .join("");
  }
  if (typeof first.text === "string") return first.text;
  return "";
}

/** Extract plain text from an OpenAI responses JSON payload. */
export function extractResponsesText(payload: unknown): string {
  const root = (payload ?? {}) as Record<string, unknown>;
  if (typeof root.output_text === "string" && root.output_text) return root.output_text;
  const output = Array.isArray(root.output) ? root.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const content = Array.isArray(entry.content) ? entry.content : [];
    for (const part of content) {
      const p = (part ?? {}) as Record<string, unknown>;
      if (typeof p.text === "string") chunks.push(p.text);
      else if (typeof p.output_text === "string") chunks.push(p.output_text as string);
    }
    if (typeof entry.text === "string") chunks.push(entry.text);
  }
  if (chunks.length > 0) return chunks.join("");
  return extractChatText(payload);
}

/**
 * Convert a bridge LLM text answer back to native JEV data.
 * Output shape matches native JEV: { answers, model } plus per-answer reason.
 */
export function bridgeTextToJevData(
  text: string,
  questions: Record<string, JevBridgeQuestion>,
  model: string,
): { answers: Record<string, Record<string, unknown>>; model: string } {
  const parsed = extractJsonObject(text) as Record<string, unknown> | null;
  const rawAnswers = (((parsed?.answers ?? parsed) as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const answers: Record<string, Record<string, unknown>> = {};
  for (const [qid, qRaw] of Object.entries(questions)) {
    const q = (qRaw ?? {}) as JevBridgeQuestion;
    const type = String(q.type ?? "choice").toLowerCase();
    const raw = ((rawAnswers[qid] ?? {}) as Record<string, unknown>) ?? {};
    const reason = clampReason(raw.reason ?? raw.why ?? raw.explanation);
    if (type === "score") {
      const criteria = q.criteria;
      let score: number;
      if (typeof raw.score === "number" && Number.isFinite(raw.score)) {
        score = raw.score;
      } else if (typeof raw.choice === "string" && Array.isArray(criteria)) {
        const idx = (criteria as unknown[]).findIndex((c) => String(c) === raw.choice);
        score = idx >= 0 ? idx : 0;
      } else {
        score = Number(raw.score ?? raw.noul ?? 0);
        if (!Number.isFinite(score)) score = 0;
      }
      answers[qid] = { score, confidence: clamp01(raw.confidence, 0.5), reason };
      continue;
    }
    if (type === "noul" || type === "noul_number" || (!raw.choice && (typeof raw.noul === "number" || typeof raw.noul === "string"))) {
      const noulRaw = Number(raw.noul ?? raw.score ?? 0);
      answers[qid] = {
        noul: Number.isFinite(noulRaw) ? Math.min(1, Math.max(0, noulRaw)) : 0,
        confidence: clamp01(raw.confidence, 0.5),
        reason,
      };
      continue;
    }
    const criteriaKeys = q.criteria && typeof q.criteria === "object" && !Array.isArray(q.criteria)
      ? Object.keys(q.criteria as Record<string, unknown>)
      : [];
    answers[qid] = normalizeChoiceAnswer(raw, criteriaKeys);
  }
  return { answers, model };
}
