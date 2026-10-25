import type { ChannelGroupConfig } from "@codex-ui/shared";

export type FreeOllamaSourceEntry = {
  server: string;
  models: string[];
  tps: number;
  status?: string;
};

export type FreeOllamaImportStats = {
  totalServers: number;
  eligibleServers: number;
  filteredServers: number;
};

export type FreeOllamaProbeOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  concurrency?: number;
};

export function normalizeFreeOllamaServer(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

const EMBEDDING_MODEL_PATTERN = /(?:^|[\/:._-])embed(?:ding)?s?(?:$|[\/:._-])/i;
const MODEL_SIZE_PATTERN = /(?:^|[\/:._-])([0-9]+(?:\.[0-9]+)?)([bm])(?:$|[\/:._-])/i;
const COMMON_CHAT_MODEL_PATTERN = /(?:^|[\/_-])(?:qwen|glm|deepseek|gpt-oss|mistral|mixtral|llama|codellama|minimax|kimi)(?=[A-Za-z0-9\/:._-]|$)/i;
const KNOWN_SMALL_MODEL_PATTERN = /(?:^|[\/_-])tinyllama(?:[\/:._-]|$)|(?:^|[\/_-])llama3\.2(?::latest)?$/i;
const MAX_PROBE_MODELS_PER_SERVER = 5;

/** Keep chat/generation models and drop embeddings or models explicitly below 7B. */
export function eligibleFreeOllamaModels(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  return [...new Set(models
    .filter((model): model is string => typeof model === "string")
    .map((model) => model.trim())
    .filter(Boolean)
    .filter((model) => !EMBEDDING_MODEL_PATTERN.test(model))
    .filter((model) => COMMON_CHAT_MODEL_PATTERN.test(model))
    .filter((model) => !KNOWN_SMALL_MODEL_PATTERN.test(model))
    .filter((model) => {
      const match = model.match(MODEL_SIZE_PATTERN);
      if (!match) return true;
      const amount = Number(match[1]);
      const unit = match[2]?.toLowerCase();
      const billions = unit === "m" ? amount / 1000 : amount;
      return Number.isFinite(billions) && billions >= 7;
    }))];
}

export function buildFreeOllamaGroups(entries: FreeOllamaSourceEntry[]): ChannelGroupConfig[] {
  return entries.map((entry, index) => {
    let host = entry.server;
    try { host = new URL(entry.server).host || entry.server; } catch { }
    return {
      id: `server-${index + 1}`,
      name: host,
      baseUrl: `${entry.server}/v1`,
      kind: "text",
      status: "enabled",
      groupRatio: 1,
      models: entry.models,
      modelCapabilities: Object.fromEntries(entry.models.map((model) => [model, {
        reasoningEfforts: freeOllamaModelSupportsThinking(model)
          ? ["low", "medium", "high"]
          : ["none"],
        source: "inferred"
      }])),
      responseProtocol: "openai",
      responseProtocolMode: "fixed",
      remark: `Free Ollama · ${entry.tps.toFixed(2)} TPS`,
      authType: "inherit",
      credentialMode: "group",
      keyMode: "single",
      keys: ["free-ollama"]
    };
  });
}

export function freeOllamaModelSupportsThinking(model: string): boolean {
  return /(?:deepseek-r1|qwq|qwen3(?:[.:/-]|$)|qwen3\.5(?:[.:/-]|$)|gpt-oss|kimi-k2-thinking|phi-4-reasoning|nemotron)/i.test(model);
}

export function eligibleFreeOllamaEntries(source: unknown): FreeOllamaSourceEntry[] {
  if (!Array.isArray(source)) return [];
  const seen = new Set<string>();
  return source.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const rawServer = typeof record.server === "string" ? record.server.trim().replace(/\/+$/, "") : "";
    const server = rawServer;
    const tps = typeof record.tps === "number" ? record.tps : Number(record.tps);
    const models = eligibleFreeOllamaModels(record.models);
    const status = typeof record.status === "string" ? record.status : undefined;
    const normalizedServer = server ? normalizeFreeOllamaServer(server) : "";
    if (!server || seen.has(normalizedServer) || !Number.isFinite(tps) || tps < 60 || models.length === 0 || status === "error" || status === "fake") return [];
    try {
      const parsed = new URL(server);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    } catch {
      return [];
    }
    seen.add(normalizedServer);
    return [{ server, models, tps, status }];
  });
}

export async function probeFreeOllamaEntries(
  entries: FreeOllamaSourceEntry[],
  options: FreeOllamaProbeOptions = {}
): Promise<FreeOllamaSourceEntry[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 15_000);
  const concurrency = Math.max(1, Math.min(entries.length || 1, options.concurrency ?? 4));
  const results = new Array<FreeOllamaSourceEntry | null>(entries.length).fill(null);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < entries.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await probeFreeOllamaEntry(entries[index]!, fetchImpl, timeoutMs);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results.filter((entry): entry is FreeOllamaSourceEntry => entry != null);
}

async function probeFreeOllamaEntry(
  entry: FreeOllamaSourceEntry,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<FreeOllamaSourceEntry | null> {
  try {
    const tagsResponse = await fetchImpl(`${entry.server}/api/tags`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!tagsResponse.ok) return null;
    const tagsBody = await tagsResponse.json() as { models?: Array<{ name?: unknown; model?: unknown }> };
    const liveModels = eligibleFreeOllamaModels(tagsBody.models?.map((model) => model.name ?? model.model));
    const liveNames = new Set(liveModels.map(normalizeFreeOllamaModel));
    const models = entry.models.filter((model) => liveNames.has(normalizeFreeOllamaModel(model)));
    const probeModels = selectFreeOllamaProbeModels(models);
    for (const probeModel of probeModels) {
      try {
        const chatResponse = await fetchImpl(`${entry.server}/v1/chat/completions`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            model: probeModel,
            messages: [{ role: "user", content: "Reply with OK." }],
            stream: false
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!chatResponse.ok) continue;
        const chatBody = await chatResponse.json() as {
          model?: unknown;
          choices?: Array<{ message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown } }>;
        };
        const responseModel = typeof chatBody.model === "string" ? chatBody.model : "";
        const message = chatBody.choices?.[0]?.message;
        const hasOutput = [message?.content, message?.reasoning, message?.reasoning_content]
          .some((value) => typeof value === "string" && value.trim().length > 0);
        if (normalizeFreeOllamaModel(responseModel) !== normalizeFreeOllamaModel(probeModel) || !hasOutput) continue;
        return {
          ...entry,
          models: [probeModel, ...models.filter((model) => normalizeFreeOllamaModel(model) !== normalizeFreeOllamaModel(probeModel))]
        };
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function selectFreeOllamaProbeModels(models: string[]): string[] {
  return [...models]
    .sort((left, right) => freeOllamaProbeScore(left) - freeOllamaProbeScore(right))
    .slice(0, MAX_PROBE_MODELS_PER_SERVER);
}

function freeOllamaProbeScore(model: string): number {
  const normalized = normalizeFreeOllamaModel(model);
  if (normalized === "mistral:latest") return 0;
  if (/^llama3(?:\.1)?:8b/.test(normalized)) return 1;
  if (/^deepseek-r1:(?:[7-9]|[1-9][0-9]+)b/.test(normalized)) return 2;
  if (/^llama3(?::latest|$)/.test(normalized)) return 3;
  if (/^qwen/.test(normalized) && !normalized.includes(":cloud")) return 4;
  if (/^gpt-oss/.test(normalized)) return 5;
  if (normalized.includes(":cloud") || normalized.includes("verif_sys")) return 100;
  return 20;
}

function normalizeFreeOllamaModel(model: string): string {
  return model.trim().toLowerCase();
}
