import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const FREEBUFF_BASE_URL = "https://www.codebuff.com/api/v1";
export const FREEBUFF_SESSION_URL = `${FREEBUFF_BASE_URL}/freebuff/session`;
export const FREEBUFF_AGENT_RUNS_URL = `${FREEBUFF_BASE_URL}/agent-runs`;
export const FREEBUFF_CHAT_COMPLETIONS_URL = `${FREEBUFF_BASE_URL}/chat/completions`;

export const FREEBUFF_SYSTEM_PROMPT_PREFIX =
  "You are Buffy, the coding agent behind Codebuff. You help users with software engineering tasks: fixing bugs, adding functionality, refactoring, and explaining code.";

export const FREEBUFF_SIGNATURE_TOOL = {
  type: "function" as const,
  function: {
    name: "decide",
    description: "Internal agent decision helper",
    parameters: { type: "object", properties: {} }
  }
};

export const FREEBUFF_MODEL_AGENT_MAP: Record<string, string> = {
  "z-ai/glm-5.3-flash": "base3-free-glm-5-3-flash",
  "mimo/mimo-v2.5": "base3-free-mimo",
  "deepseek/deepseek-v4-flash": "base3-free-deepseek-flash",
  "openai/gpt-5.6-luna": "base3-free-luna",
  "openai/gpt-5.6-luna-es": "base3-free-luna-es",
  "minimax/minimax-m3": "base3-free-minimax-m3",
  "upstage/solar-pro-4": "base3-free-solar-pro4",
  "meta/muse-spark-1.3": "base3-free-muse-spark-1-3",
  "anthropic/claude-fable-5": "base3-free-fable"
};

export const DEFAULT_FREEBUFF_MODELS = [
  "z-ai/glm-5.3-flash",
  "mimo/mimo-v2.5",
  "deepseek/deepseek-v4-flash",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-luna-es",
  "minimax/minimax-m3",
  "upstage/solar-pro-4"
];

export function getFreebuffAgentId(model: string): string {
  const normalized = model.trim().toLowerCase();
  for (const [key, agentId] of Object.entries(FREEBUFF_MODEL_AGENT_MAP)) {
    if (key.toLowerCase() === normalized) return agentId;
  }
  if (normalized.includes("glm")) return "base3-free-glm-5-3-flash";
  if (normalized.includes("mimo")) return "base3-free-mimo";
  if (normalized.includes("deepseek")) return "base3-free-deepseek-flash";
  if (normalized.includes("luna-es")) return "base3-free-luna-es";
  if (normalized.includes("luna")) return "base3-free-luna";
  if (normalized.includes("minimax")) return "base3-free-minimax-m3";
  if (normalized.includes("solar")) return "base3-free-solar-pro4";
  if (normalized.includes("fable")) return "base3-free-fable";
  if (normalized.includes("muse-spark")) return "base3-free-muse-spark-1-3";
  return "base3-free-glm-5-3-flash";
}

export function resolveFreebuffCredentialsPath(): string {
  if (process.env.FREEBUFF_CREDENTIALS_PATH?.trim()) {
    return process.env.FREEBUFF_CREDENTIALS_PATH.trim();
  }
  if (process.env.MANICODE_CREDENTIALS_PATH?.trim()) {
    return process.env.MANICODE_CREDENTIALS_PATH.trim();
  }
  return join(homedir(), ".config", "manicode", "credentials.json");
}

export type FreebuffCredentials = {
  token: string;
  userId: string;
};

export async function resolveLocalFreebuffCredentials(
  options: { credentialsPath?: string } = {}
): Promise<FreebuffCredentials | null> {
  if (process.env.FREEBUFF_API_KEY?.trim()) {
    return {
      token: process.env.FREEBUFF_API_KEY.trim(),
      userId: process.env.FREEBUFF_USER_ID?.trim() || "freebuff-user"
    };
  }
  if (process.env.CODEBUFF_API_KEY?.trim()) {
    return {
      token: process.env.CODEBUFF_API_KEY.trim(),
      userId: process.env.FREEBUFF_USER_ID?.trim() || "freebuff-user"
    };
  }

  const filePath = options.credentialsPath || resolveFreebuffCredentialsPath();
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const defaultEntry = parsed?.default;
    const token = typeof defaultEntry?.authToken === "string" ? defaultEntry.authToken.trim() : "";
    const userId = typeof defaultEntry?.id === "string" ? defaultEntry.id.trim() : "freebuff-user";
    if (token) return { token, userId };
  } catch {
    // Ignore read or parse error
  }
  return null;
}

export type FreebuffSessionInfo = {
  instanceId: string;
  model: string;
  expiresAt: number;
  token: string;
  userId: string;
  agentId: string;
  isOwned?: boolean;
};

// Track instances created by Codex Ultra to avoid deleting external sessions (P0 protection)
const ownedInstanceIds = new Set<string>();

export function isOwnedFreebuffInstance(instanceId: string): boolean {
  return ownedInstanceIds.has(instanceId);
}

export function recordOwnedFreebuffInstance(instanceId: string): void {
  ownedInstanceIds.add(instanceId);
}

export function forgetOwnedFreebuffInstance(instanceId: string): void {
  ownedInstanceIds.delete(instanceId);
}

export function clearOwnedFreebuffInstances(): void {
  ownedInstanceIds.clear();
}

// Per-model session cache
const activeSessions = new Map<string, FreebuffSessionInfo>();
const activeAdmissionPromises = new Map<string, Promise<FreebuffSessionInfo>>();

export function clearFreebuffSession(model?: string): void {
  if (model) {
    activeSessions.delete(model);
    activeAdmissionPromises.delete(model);
  } else {
    activeSessions.clear();
    activeAdmissionPromises.clear();
  }
}

export function getCachedFreebuffSession(model?: string): FreebuffSessionInfo | null {
  if (model) {
    return activeSessions.get(model) || null;
  }
  const first = activeSessions.values().next();
  return first.done ? null : first.value;
}

export type FreebuffSessionStatus = {
  configured: boolean;
  active: boolean;
  model?: string;
  instanceId?: string;
  expiresAt?: number;
  remainingSeconds?: number;
  isOwned?: boolean;
  freebucks?: {
    balance: number;
    daily?: {
      limit: number;
      spent: number;
      remaining: number;
      resetAt?: string;
    };
    monthly?: {
      limitUsd: number;
      spentUsd: number;
      remainingUsd: number;
      resetAt?: string;
    };
    prices?: Record<string, number>;
    priceNotices?: Record<string, string>;
  };
  rateLimitsByModel?: Record<string, { limit: number; recentCount?: number; resetAt?: string }>;
};

export async function getFreebuffSessionStatus(
  options: { fetchImpl?: typeof fetch; credentialsPath?: string; timeoutMs?: number } = {}
): Promise<FreebuffSessionStatus> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const creds = await resolveLocalFreebuffCredentials({ credentialsPath: options.credentialsPath });
  const token = creds?.token;
  if (!token) {
    return { configured: false, active: false };
  }

  try {
    const res = await fetchImpl(FREEBUFF_SESSION_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-codebuff-api-key": token
      },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (res.ok) {
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const freebucks = body?.freebucks && typeof body.freebucks === "object"
        ? (body.freebucks as FreebuffSessionStatus["freebucks"])
        : undefined;
      const rateLimitsByModel = body?.rateLimitsByModel && typeof body.rateLimitsByModel === "object"
        ? (body.rateLimitsByModel as FreebuffSessionStatus["rateLimitsByModel"])
        : undefined;

      if (body?.status === "active" && typeof body.instanceId === "string") {
        const instanceId = body.instanceId;
        const model = typeof body.model === "string" ? body.model : "";
        let expiresAt = Date.now() + 3600_000;
        if (typeof body.expiresAt === "string") {
          const exp = new Date(body.expiresAt).getTime();
          if (Number.isFinite(exp)) expiresAt = exp;
        }
        const now = Date.now();
        const remainingSeconds = Math.max(0, Math.round((expiresAt - now) / 1000));
        const isOwned = ownedInstanceIds.has(instanceId);

        if (model && expiresAt > now) {
          activeSessions.set(model, {
            instanceId,
            model,
            expiresAt,
            token,
            userId: creds?.userId || "freebuff-user",
            agentId: getFreebuffAgentId(model),
            isOwned
          });
        }

        return {
          configured: true,
          active: true,
          model,
          instanceId,
          expiresAt,
          remainingSeconds,
          isOwned,
          freebucks,
          rateLimitsByModel
        };
      }

      return {
        configured: true,
        active: false,
        freebucks,
        rateLimitsByModel
      };
    }
  } catch {
    const cached = getCachedFreebuffSession();
    if (cached && cached.expiresAt > Date.now()) {
      return {
        configured: true,
        active: true,
        model: cached.model,
        instanceId: cached.instanceId,
        expiresAt: cached.expiresAt,
        remainingSeconds: Math.max(0, Math.round((cached.expiresAt - Date.now()) / 1000)),
        isOwned: isOwnedFreebuffInstance(cached.instanceId)
      };
    }
  }

  return { configured: true, active: false };
}

export function findBestFreebuffFallback(
  currentModel: string,
  status: FreebuffSessionStatus
): { id: string; name: string; price: number } | null {
  const prices: Record<string, number> = {
    "upstage/solar-pro4": 0,
    "upstage/solar-pro-4": 0,
    "z-ai/glm-5.3-flash": 5,
    "mimo/mimo-v2.5": 10,
    "minimax/minimax-m3": 10,
    "openai/gpt-5.6-luna": 20,
    "openai/gpt-5.6-luna-es": 20,
    "deepseek/deepseek-v4-flash": 25,
    ...(status.freebucks?.prices || {})
  };

  const currentPrice = prices[currentModel] ?? 25;
  const balance = status.freebucks?.balance ?? 0;

  const candidates = [
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "mimo/mimo-v2.5", name: "Mimo 2.5" },
    { id: "minimax/minimax-m3", name: "MiniMax M3" },
    { id: "z-ai/glm-5.3-flash", name: "GLM-5.3 Flash" },
    { id: "upstage/solar-pro-4", name: "Solar Pro 4" }
  ];

  for (const c of candidates) {
    if (c.id === currentModel) continue;
    const price = prices[c.id] ?? 999;
    // Security Rule 1: Never upgrade to a more expensive model
    if (price > currentPrice) continue;
    // Security Rule 2: Balance must be able to afford the model
    if (price > balance) continue;
    // Check rate limit if present
    const rl = status.rateLimitsByModel?.[c.id];
    if (rl && rl.limit > 0 && typeof rl.recentCount === "number" && rl.recentCount >= rl.limit) {
      continue;
    }
    return { id: c.id, name: c.name, price };
  }

  const solarPrice = prices["upstage/solar-pro-4"] ?? prices["upstage/solar-pro4"] ?? 0;
  if (solarPrice <= balance && currentModel !== "upstage/solar-pro-4" && currentModel !== "upstage/solar-pro4") {
    return { id: "upstage/solar-pro-4", name: "Solar Pro 4", price: solarPrice };
  }

  return null;
}

export async function releaseFreebuffSession(
  options: { fetchImpl?: typeof fetch; credentialsPath?: string; timeoutMs?: number; explicitToken?: string } = {}
): Promise<{ released: boolean; message?: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const creds = await resolveLocalFreebuffCredentials({ credentialsPath: options.credentialsPath });
  const token = options.explicitToken?.trim() || creds?.token;
  if (!token) {
    return { released: false, message: "No token configured" };
  }

  try {
    const res = await fetchImpl(FREEBUFF_SESSION_URL, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-codebuff-api-key": token
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    activeSessions.clear();
    activeAdmissionPromises.clear();
    ownedInstanceIds.clear();
    return { released: res.ok, message: res.ok ? "Session released" : `HTTP ${res.status}` };
  } catch (error) {
    activeSessions.clear();
    activeAdmissionPromises.clear();
    ownedInstanceIds.clear();
    return { released: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function getOrEnsureFreebuffSession(
  targetModel: string,
  explicitToken?: string,
  options: { fetchImpl?: typeof fetch; credentialsPath?: string; timeoutMs?: number; forceSwitch?: boolean } = {}
): Promise<FreebuffSessionInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const creds = await resolveLocalFreebuffCredentials({ credentialsPath: options.credentialsPath });
  const token = explicitToken?.trim() || creds?.token;
  if (!token) {
    throw new Error("Freebuff requires an authentication token. Log in with freebuff CLI or set FREEBUFF_API_KEY.");
  }
  const userId = creds?.userId || "freebuff-user";
  const agentId = getFreebuffAgentId(targetModel);
  const now = Date.now();

  const cached = activeSessions.get(targetModel);
  if (
    cached &&
    cached.token === token &&
    cached.expiresAt - now > 60_000
  ) {
    return cached;
  }

  const existingPromise = activeAdmissionPromises.get(targetModel);
  if (existingPromise) {
    return await existingPromise;
  }

  const admissionPromise = (async () => {
    try {
      let instanceId: string | null = null;
      let expiresAt = now + 3600_000;
      let isOwned = false;

      // 1. Check existing server session via GET
      try {
        const getRes = await fetchImpl(FREEBUFF_SESSION_URL, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "x-codebuff-api-key": token
          },
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (getRes.ok) {
          const getBody = (await getRes.json().catch(() => null)) as Record<string, unknown> | null;
          if (getBody?.status === "active" && typeof getBody.instanceId === "string") {
            const currentInstanceId = getBody.instanceId;
            const currentModel = typeof getBody.model === "string" ? getBody.model : "";
            let serverExpiresAt = now + 3600_000;
            if (typeof getBody.expiresAt === "string") {
              const exp = new Date(getBody.expiresAt).getTime();
              if (Number.isFinite(exp)) serverExpiresAt = exp;
            }

            const isCurrentlyOwned = ownedInstanceIds.has(currentInstanceId);

            if (currentModel === targetModel && serverExpiresAt > now) {
              // Existing server session matches target model: adopt or reuse safely
              instanceId = currentInstanceId;
              expiresAt = serverExpiresAt;
              isOwned = isCurrentlyOwned;
            } else if (currentModel !== targetModel) {
              // Active session exists for a DIFFERENT model
              if (isCurrentlyOwned || options.forceSwitch) {
                // Safe to release if we own it OR if caller explicitly requested forceSwitch
                await fetchImpl(FREEBUFF_SESSION_URL, {
                  method: "DELETE",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "x-codebuff-api-key": token
                  },
                  signal: AbortSignal.timeout(10_000)
                }).catch(() => undefined);
                ownedInstanceIds.delete(currentInstanceId);
                activeSessions.delete(currentModel);
              } else {
                // P0 PROTECTION: Session belongs to external client (e.g. user CLI); NEVER DELETE unless forceSwitch!
                const remainingSec = Math.max(0, Math.round((serverExpiresAt - now) / 1000));
                if (serverExpiresAt > now) {
                  const error = new Error(
                    `Freebuff active session is currently owned by an external client for model "${currentModel}" (instance ${currentInstanceId}, expires in ${remainingSec}s). Codex Ultra will not terminate your external CLI session. Please select model "${currentModel}" or wait until the session expires.`
                  );
                  Object.assign(error, {
                    code: "FREEBUFF_MODEL_LOCKED",
                    currentModel,
                    targetModel,
                    remainingSeconds: remainingSec,
                    instanceId: currentInstanceId
                  });
                  throw error;
                }
                // If expired, fall through to attempt admission
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("Freebuff active session is currently owned")) {
          throw error;
        }
        // Fall through to admission
      }

      // 2. If no valid session for this model, admit via POST
      if (!instanceId) {
        let postRes = await fetchImpl(FREEBUFF_SESSION_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "x-codebuff-api-key": token,
            "x-freebuff-model": targetModel
          },
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (postRes.status === 409) {
          const conflictBody = (await postRes.json().catch(() => null)) as Record<string, unknown> | null;
          const conflictInstanceId = typeof conflictBody?.instanceId === "string" ? conflictBody.instanceId : null;
          if (conflictInstanceId && (ownedInstanceIds.has(conflictInstanceId) || options.forceSwitch)) {
            // Safe to delete if owned or if forceSwitch requested
            await fetchImpl(FREEBUFF_SESSION_URL, {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${token}`,
                "x-codebuff-api-key": token
              },
              signal: AbortSignal.timeout(10_000)
            }).catch(() => undefined);
            ownedInstanceIds.delete(conflictInstanceId);

            postRes = await fetchImpl(FREEBUFF_SESSION_URL, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "x-codebuff-api-key": token,
                "x-freebuff-model": targetModel
              },
              signal: AbortSignal.timeout(timeoutMs)
            });
          } else {
            throw new Error(`Failed to admit Freebuff session for ${targetModel}: Model slot is currently locked by an external session.`);
          }
        }

        const postBody = (await postRes.json().catch(() => null)) as Record<string, unknown> | null;
        if (!postRes.ok || postBody?.status !== "active" || typeof postBody.instanceId !== "string") {
          const errMsg = typeof postBody?.message === "string"
            ? postBody.message
            : (typeof postBody?.status === "string" ? `Freebuff admission status: ${postBody.status}` : `HTTP ${postRes.status}`);
          throw new Error(`Failed to admit Freebuff session for ${targetModel}: ${errMsg}`);
        }

        instanceId = postBody.instanceId;
        isOwned = true;
        ownedInstanceIds.add(instanceId);
        if (typeof postBody.expiresAt === "string") {
          const exp = new Date(postBody.expiresAt).getTime();
          if (Number.isFinite(exp) && exp > now) expiresAt = exp;
        }
      }

      const sessionInfo: FreebuffSessionInfo = {
        instanceId,
        model: targetModel,
        expiresAt,
        token,
        userId,
        agentId,
        isOwned
      };
      activeSessions.set(targetModel, sessionInfo);
      return sessionInfo;
    } finally {
      activeAdmissionPromises.delete(targetModel);
    }
  })();

  activeAdmissionPromises.set(targetModel, admissionPromise);
  return await admissionPromise;
}

export async function createFreebuffRunId(
  agentId: string,
  token: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fallbackRunId = `run_${randomUUID()}`;
  try {
    const runRes = await fetchImpl(FREEBUFF_AGENT_RUNS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-codebuff-api-key": token
      },
      body: JSON.stringify({
        action: "START",
        agentId,
        ancestorRunIds: []
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (runRes.ok) {
      const runBody = (await runRes.json().catch(() => null)) as Record<string, unknown> | null;
      if (typeof runBody?.runId === "string" && runBody.runId.trim()) {
        return runBody.runId.trim();
      }
    }
  } catch {
    // Fallback to generated runId
  }
  return fallbackRunId;
}

export async function fetchFreebuffFreeModels(
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; token?: string; credentialsPath?: string } = {}
): Promise<{ models: string[]; fetchedModels: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 10_000);
  const creds = await resolveLocalFreebuffCredentials({ credentialsPath: options.credentialsPath });
  const token = options.token || creds?.token;

  if (!token) {
    return {
      models: [...DEFAULT_FREEBUFF_MODELS],
      fetchedModels: DEFAULT_FREEBUFF_MODELS.length
    };
  }

  try {
    const res = await fetchImpl(FREEBUFF_SESSION_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-codebuff-api-key": token
      },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const freebucks = data?.freebucks as Record<string, unknown> | undefined;
      const prices = freebucks?.prices as Record<string, number> | undefined;
      if (prices && typeof prices === "object") {
        const models = Object.keys(prices).filter((m) => typeof m === "string" && m.trim());
        if (models.length > 0) {
          return { models: [...new Set(models)], fetchedModels: models.length };
        }
      }
    }
  } catch {
    // Fall back to default models
  }

  return {
    models: [...DEFAULT_FREEBUFF_MODELS],
    fetchedModels: DEFAULT_FREEBUFF_MODELS.length
  };
}
