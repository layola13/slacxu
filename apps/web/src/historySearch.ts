import { displayPromptText } from "./promptDisplay";

export type HistoryThreadLike = {
  id: string;
  sessionId?: string;
  session_id?: string;
  title?: string;
  name?: string;
  threadName?: string;
  thread_name?: string;
  preview?: string;
  model?: string;
  modelProvider?: string;
  model_provider?: string;
  parentThreadId?: string;
  parent_thread_id?: string;
  agentNickname?: string;
  agent_nickname?: string;
  agentRole?: string;
  agent_role?: string;
  status?: string;
  cwd?: string;
  source?: string;
  threadSource?: string;
  thread_source?: string;
  path?: string;
  file_path?: string;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  updated_at?: number;
  recencyAt?: number;
  recency_at?: number;
};

type HistorySearchQuery = {
  folded: string;
  compact: string;
  tokens: string[];
};

type HistorySearchDocument = {
  folded: string;
  compact: string;
  tokens: string[];
  weight: number;
};

const FIELD_WEIGHT = {
  id: 280,
  session: 220,
  threadName: 190,
  title: 180,
  agent: 105,
  preview: 90,
  location: 80,
  model: 55,
  source: 45,
  status: 35
} as const;

export function extractThreadIdSearch(searchTerm: string): string | null {
  const trimmed = searchTerm.trim();
  if (!trimmed) {
    return null;
  }
  const dashed = trimmed.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0];
  if (dashed) {
    return dashed.toLowerCase();
  }
  const compact = trimmed.match(/\b[0-9a-f]{32}\b/i)?.[0];
  if (!compact) {
    return null;
  }
  const lower = compact.toLowerCase();
  return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
}

export function filterHistoryThreads<T extends HistoryThreadLike>(threads: T[], searchTerm: string): T[] {
  const query = buildHistorySearchQuery(searchTerm);
  if (!query.folded) {
    return threads;
  }
  const directThreadId = extractThreadIdSearch(searchTerm);
  return threads
    .map((thread) => {
      if (directThreadId && thread.id.toLowerCase() === directThreadId) {
        return { thread, score: Number.MAX_SAFE_INTEGER };
      }
      return { thread, score: historySearchScore(thread, query) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return recencyOf(b.thread) - recencyOf(a.thread);
    })
    .map((entry) => entry.thread);
}

function buildHistorySearchQuery(value: string): HistorySearchQuery {
  const folded = normalizeHistorySearchText(value);
  const compact = folded.replace(/\s+/g, "");
  const tokens = folded.split(" ").filter(Boolean);
  return { folded, compact, tokens };
}

function historySearchScore(thread: HistoryThreadLike, query: HistorySearchQuery): number {
  const documents = historySearchDocuments(thread);

  let score = 0;
  for (const document of documents) {
    if (document.folded.includes(query.folded)) {
      score = Math.max(score, 900 + document.weight + query.folded.length);
    }
    if (query.compact && document.compact.includes(query.compact)) {
      score = Math.max(score, 850 + document.weight + query.compact.length);
    }
    if (query.compact.length >= 3 && isOrderedSubsequence(query.compact, document.compact)) {
      score = Math.max(score, Math.max(45, 120 + document.weight - Math.max(0, document.compact.length - query.compact.length)));
    }
    if (query.compact.length >= 4 && query.compact.length <= 64) {
      const distance = boundedLevenshtein(query.compact, document.compact.slice(0, Math.max(query.compact.length + 6, 12)), maxEditDistance(query.compact.length));
      if (distance !== null) {
        score = Math.max(score, 170 + Math.round(document.weight * 0.5) - distance * 18);
      }
    }
  }

  if (query.tokens.length === 0) {
    return score;
  }

  let matchedTokens = 0;
  let tokenScore = 0;
  for (const token of query.tokens) {
    const best = bestHistoryTokenScore(token, documents);
    if (best > 0) {
      matchedTokens += 1;
      tokenScore += best;
    }
  }
  const requiredMatches = query.tokens.length <= 2 ? query.tokens.length : Math.ceil(query.tokens.length * 0.65);
  if (matchedTokens >= requiredMatches) {
    score = Math.max(score, tokenScore + matchedTokens * 35);
  }

  return score;
}

function historySearchDocuments(thread: HistoryThreadLike): HistorySearchDocument[] {
  const documents: HistorySearchDocument[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, weight: number) => {
    if (typeof value !== "string" || value.length === 0) {
      return;
    }
    const document = buildHistorySearchDocument(value, weight);
    if (!document.folded) {
      return;
    }
    const key = `${document.weight}:${document.folded}`;
    if (!seen.has(key)) {
      seen.add(key);
      documents.push(document);
    }
  };

  add(thread.id, FIELD_WEIGHT.id);
  add(thread.sessionId ?? thread.session_id, FIELD_WEIGHT.session);
  add(thread.name, FIELD_WEIGHT.threadName);
  add(thread.threadName ?? thread.thread_name, FIELD_WEIGHT.threadName);
  add(thread.title, FIELD_WEIGHT.title);
  add(thread.preview, FIELD_WEIGHT.preview);
  if (thread.preview) {
    add(displayPromptText(thread.preview), FIELD_WEIGHT.preview + 25);
  }
  add(thread.cwd, FIELD_WEIGHT.location);
  add(thread.path ?? thread.file_path, FIELD_WEIGHT.location);
  add(thread.agentNickname ?? thread.agent_nickname, FIELD_WEIGHT.agent);
  add(thread.agentRole ?? thread.agent_role, FIELD_WEIGHT.agent);
  add(thread.model, FIELD_WEIGHT.model);
  add(thread.modelProvider ?? thread.model_provider, FIELD_WEIGHT.model);
  add(thread.source, FIELD_WEIGHT.source);
  add(thread.threadSource ?? thread.thread_source, FIELD_WEIGHT.source);
  add(thread.status, FIELD_WEIGHT.status);

  return documents;
}

function bestHistoryTokenScore(token: string, documents: HistorySearchDocument[]): number {
  const tokenCompact = token.replace(/\s+/g, "");
  let best = 0;
  for (const document of documents) {
    if (document.folded.includes(token)) {
      best = Math.max(best, 95 + Math.round(document.weight * 0.55) + token.length);
    }
    if (tokenCompact && document.compact.includes(tokenCompact)) {
      best = Math.max(best, 90 + Math.round(document.weight * 0.55) + tokenCompact.length);
    }
    if (tokenCompact.length >= 3 && isOrderedSubsequence(tokenCompact, document.compact)) {
      best = Math.max(best, 55 + Math.round(document.weight * 0.45));
    }
    for (const candidate of document.tokens) {
      if (candidate === token) {
        best = Math.max(best, 120 + Math.round(document.weight * 0.6) + token.length);
        continue;
      }
      if (candidate.includes(token) || token.includes(candidate)) {
        best = Math.max(best, 85 + Math.round(document.weight * 0.5) + Math.min(candidate.length, token.length));
        continue;
      }
      const distance = boundedLevenshtein(token, candidate, maxEditDistance(token.length));
      if (distance !== null) {
        best = Math.max(best, 80 + Math.round(document.weight * 0.45) - distance * 14);
      }
    }
  }
  return best;
}

function buildHistorySearchDocument(value: string, weight: number): HistorySearchDocument {
  const folded = normalizeHistorySearchText(value);
  return {
    folded,
    compact: folded.replace(/\s+/g, ""),
    tokens: folded.split(" ").filter(Boolean),
    weight
  };
}

function normalizeHistorySearchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/['’`]/g, "")
    .replace(/[_/\\.-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isOrderedSubsequence(needle: string, haystack: string): boolean {
  if (!needle || !haystack || needle.length > haystack.length) {
    return false;
  }
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index === needle.length) {
        return true;
      }
    }
  }
  return false;
}

function maxEditDistance(length: number): number {
  if (length <= 2) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  return 3;
}

function boundedLevenshtein(left: string, right: string, maxDistance: number): number | null {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return null;
  }
  if (left === right) {
    return 0;
  }
  if (maxDistance === 0) {
    return null;
  }

  let previous: number[] = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) {
      return null;
    }
    previous = current;
  }
  const distance = previous[right.length]!;
  return distance <= maxDistance ? distance : null;
}

function recencyOf(thread: HistoryThreadLike): number {
  return thread.recencyAt ?? thread.recency_at ?? thread.updatedAt ?? thread.updated_at ?? thread.createdAt ?? thread.created_at ?? 0;
}
