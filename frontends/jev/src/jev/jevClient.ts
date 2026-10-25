import { JEV_DEFAULT_BASE_URL, JEV_DEFAULT_MODEL } from "./jevConfig";

export type JevQuestionMap = Record<string, unknown>;

export interface JevEvaluateParams {
  sessionToken: string | null | undefined;
  baseUrl?: string;
  apiKey: string;
  model?: string;
  providerId?: string;
  groupId?: string;
  bridgeProtocol?: string;
  state: string;
  questions: JevQuestionMap;
}

export interface JevProxySuccess {
  data: unknown;
  latencyMs?: number;
}

async function postJevProxy(
  path: "/api/jev/evaluate" | "/api/jev/test",
  sessionToken: string | null | undefined,
  payload: Record<string, unknown>,
): Promise<JevProxySuccess> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { "x-codex-ui-token": sessionToken } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as { data?: unknown; error?: string; latencyMs?: number; status?: number };
  if (!response.ok) {
    throw new Error(body.error || `JEV request failed (${response.status})`);
  }
  return { data: body.data, latencyMs: body.latencyMs };
}

export async function evaluateJev(params: JevEvaluateParams): Promise<JevProxySuccess> {
  return postJevProxy("/api/jev/evaluate", params.sessionToken, {
    baseUrl: params.baseUrl?.trim() || JEV_DEFAULT_BASE_URL,
    apiKey: params.apiKey,
    model: params.model?.trim() || JEV_DEFAULT_MODEL,
    providerId: params.providerId?.trim() || undefined,
    groupId: params.groupId?.trim() || undefined,
    bridgeProtocol: params.bridgeProtocol?.trim() || undefined,
    bridge: params.providerId?.trim() ? "openai" : undefined,
    state: params.state,
    questions: params.questions,
  });
}

export async function testJevConnection(params: {
  sessionToken: string | null | undefined;
  baseUrl?: string;
  apiKey: string;
  model?: string;
  providerId?: string;
  groupId?: string;
  bridgeProtocol?: string;
}): Promise<JevProxySuccess> {
  return postJevProxy("/api/jev/test", params.sessionToken, {
    baseUrl: params.baseUrl?.trim() || JEV_DEFAULT_BASE_URL,
    apiKey: params.apiKey,
    model: params.model?.trim() || JEV_DEFAULT_MODEL,
    providerId: params.providerId?.trim() || undefined,
    groupId: params.groupId?.trim() || undefined,
    bridgeProtocol: params.bridgeProtocol?.trim() || undefined,
    bridge: params.providerId?.trim() ? "openai" : undefined,
  });
}
