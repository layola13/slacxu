import http from "node:http";
import type { ChannelGroupConfig, ProviderConfig } from "@codex-ui/shared";
import { openCodeThreadHeaders } from "@cxu/sdk-backend";
import { formatAgyGeminiResponse, forwardAgyGeminiStream, isAgyGeminiEndpoint } from "./agyGeminiResponse.js";
import RAW_LOAD_RESP_JSON from "./agy_load_code_assist_resp_fixture.json" with { type: "json" };
import RAW_MODELS_RESP_JSON from "./agy_models_resp_fixture.json" with { type: "json" };

/* ------------------------------------------------------------------ *
 * Code Assist Mock Fixtures
 * ------------------------------------------------------------------ */

const RAW_LOAD_RESP: Record<string, any> = RAW_LOAD_RESP_JSON;
const RAW_MODELS_RESP: Record<string, any> = RAW_MODELS_RESP_JSON;


export const DEFAULT_LOAD_RESP = RAW_LOAD_RESP;

function mergeModelIds(values: any, preferred: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const candidates = [preferred, ...(Array.isArray(values) ? values : [])];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const trimmed = c.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function buildModelsResp(
  cliModel = "gemini-3.8-flash-low",
  targetModel = "gemini-3.8-flash-low",
  displayName?: string
): Record<string, any> {
  const base = JSON.parse(JSON.stringify(RAW_MODELS_RESP));
  const models = base.models && typeof base.models === "object" ? base.models : {};
  base.models = models;

  let template = models[cliModel];
  if (!template) {
    const defaultId = base.defaultAgentModelId;
    if (typeof defaultId === "string" && models[defaultId]) {
      template = models[defaultId];
    } else {
      for (const val of Object.values(models)) {
        if (val && typeof val === "object") {
          template = val;
          break;
        }
      }
    }
  }

  if (!template) {
    template = {
      supportsImages: true,
      supportsThinking: true,
      thinkingBudget: 4000,
      recommended: true,
      maxTokens: 1048576,
      maxOutputTokens: 65536,
      tokenizerType: "LLAMA_WITH_SPECIAL",
      quotaInfo: { remainingFraction: 1.0 },
      model: "MODEL_PLACEHOLDER_M20",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      modelProvider: "MODEL_PROVIDER_GOOGLE",
    };
  }

  const entry = JSON.parse(JSON.stringify(template));
  entry.displayName = displayName || targetModel || cliModel;
  // The CLI resolves the internal model key from this field, not only from
  // the surrounding models map. Leaving a fixture placeholder here makes the
  // process fail later with "unknown model key" after the conversation starts.
  entry.model = cliModel;
  entry.recommended = true;
  models[cliModel] = entry;

  base.defaultAgentModelId = cliModel;
  for (const k of [
    "commandModelIds",
    "tabModelIds",
    "imageGenerationModelIds",
    "mqueryModelIds",
    "webSearchModelIds",
    "commitMessageModelIds",
  ]) {
    base[k] = mergeModelIds(base[k], cliModel);
  }

  const sorts = Array.isArray(base.agentModelSorts) && base.agentModelSorts.length > 0
    ? base.agentModelSorts
    : [{ displayName: "Recommended", groups: [{ modelIds: [] }] }];
  base.agentModelSorts = sorts;

  const firstSort = sorts[0] && typeof sorts[0] === "object" ? sorts[0] : {};
  sorts[0] = firstSort;
  const groups = Array.isArray(firstSort.groups) && firstSort.groups.length > 0
    ? firstSort.groups
    : [{ modelIds: [] }];
  firstSort.groups = groups;
  const firstGroup = groups[0] && typeof groups[0] === "object" ? groups[0] : {};
  groups[0] = firstGroup;
  firstGroup.modelIds = mergeModelIds(firstGroup.modelIds, cliModel);

  return base;
}

export function unwrapGenerateRequest(raw: any): any {
  if (
    raw &&
    typeof raw === "object" &&
    raw.request &&
    (raw.request.contents || raw.request.systemInstruction)
  ) {
    return raw.request;
  }
  return raw;
}

export function geminiToOpenAiMessages(req: any): any[] {
  const messages: any[] = [];

  const sysInst = req?.systemInstruction;
  if (sysInst && typeof sysInst === "object") {
    const parts = Array.isArray(sysInst.parts) ? sysInst.parts : [];
    const sysText = parts
      .map((p: any) => (p && typeof p.text === "string" ? p.text : ""))
      .join("");
    if (sysText.trim()) {
      messages.push({ role: "system", content: sysText });
    }
  }

  const contents = Array.isArray(req?.contents) ? req.contents : [];
  for (const msg of contents) {
    if (!msg || typeof msg !== "object") continue;
    let role = msg.role || "user";
    if (role === "model") role = "assistant";

    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    let contentText = "";
    const toolCalls: any[] = [];
    const toolResponses: any[] = [];

    for (const p of parts) {
      if (!p || typeof p !== "object") continue;
      if (p.text != null) {
        contentText += String(p.text);
      } else if (p.functionCall) {
        const fc = p.functionCall || {};
        const name = fc.name || "tool";
        let args = fc.args ?? {};
        if (typeof args !== "string") {
          try {
            args = JSON.stringify(args);
          } catch {
            args = "{}";
          }
        }
        toolCalls.push({
          id: fc.id || name,
          type: "function",
          function: { name, arguments: args },
        });
      } else if (p.functionResponse) {
        const fr = p.functionResponse || {};
        const name = fr.name || "tool";
        const resp = fr.response ?? {};
        toolResponses.push({
          role: "tool",
          tool_call_id: fr.id || name,
          content: typeof resp === "string" ? resp : JSON.stringify(resp),
        });
      }
    }

    const openaiMsg: any = { role, content: contentText };
    if (toolCalls.length > 0) {
      openaiMsg.tool_calls = toolCalls;
      if (!contentText) {
        openaiMsg.content = null;
      }
    }

    if (Boolean(openaiMsg.content) || (openaiMsg.tool_calls && openaiMsg.tool_calls.length > 0)) {
      messages.push(openaiMsg);
    }
    if (toolResponses.length > 0) {
      messages.push(...toolResponses);
    }
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: "(empty request)" });
  }

  return messages;
}

export function geminiAllowedToolNames(req: any): Set<string> {
  const cfg = req?.toolConfig?.functionCallingConfig;
  if (!cfg || typeof cfg !== "object") return new Set();
  const names = cfg.allowedFunctionNames;
  if (!Array.isArray(names)) return new Set();
  return new Set(names.map((n: any) => String(n).trim()).filter(Boolean));
}

export function normalizeSchema(node: any): any {
  if (Array.isArray(node)) {
    return node.map(normalizeSchema);
  }
  if (node && typeof node === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "type" && typeof v === "string") {
        out[k] = v.toLowerCase();
      } else {
        out[k] = normalizeSchema(v);
      }
    }
    return out;
  }
  return node;
}

export function geminiToolsToOpenAi(req: any): any[] {
  const out: any[] = [];
  const allowedNames = geminiAllowedToolNames(req);
  const tools = Array.isArray(req?.tools) ? req.tools : [];
  for (const t of tools) {
    if (!t || typeof t !== "object") continue;
    const fds = Array.isArray(t.functionDeclarations) ? t.functionDeclarations : [];
    for (const fd of fds) {
      if (!fd || typeof fd !== "object") continue;
      const name = fd.name;
      if (!name) continue;
      if (allowedNames.size > 0 && !allowedNames.has(name)) continue;
      const params = normalizeSchema(fd.parameters || { type: "object", properties: {} });
      out.push({
        type: "function",
        function: {
          name,
          description: fd.description || "",
          parameters: params,
        },
      });
    }
  }
  return out;
}

export function geminiToolChoiceToOpenAi(req: any, tools: any[]): any {
  if (!tools || tools.length === 0) return undefined;
  const cfg = req?.toolConfig?.functionCallingConfig;
  if (!cfg || typeof cfg !== "object") return undefined;

  const mode = String(cfg.mode || "").toUpperCase();
  if (mode === "NONE") return "none";
  if (mode === "ANY") {
    const allowedNames = geminiAllowedToolNames(req);
    if (allowedNames.size === 1) {
      return { type: "function", function: { name: Array.from(allowedNames)[0] } };
    }
    return "required";
  }
  if (mode === "AUTO" || mode === "VALIDATED") return "auto";
  return undefined;
}

export function buildOpenAiPayload(
  raw: any,
  targetModel: string,
  options: {
    reasoningEffort?: string;
    maxTokens?: number;
    maxCompletionTokens?: number;
  } = {}
): Record<string, any> {
  const req = unwrapGenerateRequest(raw);
  const messages = geminiToOpenAiMessages(req);

  const payload: Record<string, any> = {
    model: targetModel,
    messages,
    stream: true,
  };

  const tools = geminiToolsToOpenAi(req);
  if (tools.length > 0) {
    payload.tools = tools;
    const toolChoice = geminiToolChoiceToOpenAi(req, tools);
    if (toolChoice !== undefined) {
      payload.tool_choice = toolChoice;
    }
  }

  const gen = req?.generationConfig;
  if (gen && typeof gen === "object") {
    const maxOut = gen.maxOutputTokens;
    if (typeof maxOut === "number" && maxOut > 0) {
      payload.max_tokens = Math.min(maxOut, 16384);
    }
    const temp = gen.temperature;
    if (typeof temp === "number") {
      payload.temperature = temp;
    }
  }

  if (options.reasoningEffort) {
    payload.reasoning_effort = options.reasoningEffort;
  }
  if (options.maxCompletionTokens && options.maxCompletionTokens > 0) {
    payload.max_completion_tokens = options.maxCompletionTokens;
  }
  if (options.maxTokens && options.maxTokens > 0 && !payload.max_tokens) {
    payload.max_tokens = options.maxTokens;
  }

  return payload;
}

export function resolveOpenAiChatEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

export type AgyUpstreamProtocol = "gemini" | "openai" | "openai-response" | "anthropic";

/**
 * Normalize the relay group `responseProtocol` to the upstream wire protocol
 * the AGY proxy must speak. Gemini-native targets (googleapis / /v1beta)
 * keep native behavior; every other value maps explicitly so
 * `openai-response` and `anthropic` relays are never forced through
 * chat/completions (which they reject with ModelProtocolUnsupported).
 */
export function normalizeAgyUpstreamProtocol(protocol?: string, targetBaseUrl?: string): AgyUpstreamProtocol {
  if (isGeminiNativeProtocol(protocol, targetBaseUrl)) return "gemini";
  const v = String(protocol ?? "").trim().toLowerCase();
  if (v === "openai-response" || v === "openai-responses" || v === "responses") return "openai-response";
  if (v === "anthropic" || v === "claude" || v === "messages") return "anthropic";
  if (v === "gemini" || v === "google" || v === "vertex") return "gemini";
  return "openai";
}

export function resolveResponsesEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/responses`;
  return `${trimmed}/v1/responses`;
}

export function resolveAnthropicMessagesEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/messages")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

/** Map an OpenAI-chat payload (already translated from Gemini) to a Responses request. */
export function openAiPayloadToResponsesBody(openAiPayload: Record<string, any>, model: string): Record<string, any> {
  const messages: any[] = Array.isArray(openAiPayload.messages) ? openAiPayload.messages : [];
  const input: any[] = [];
  const instructions: string[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const role = String(msg.role || "user");
    if (role === "system" || role === "developer") {
      if (typeof msg.content === "string" && msg.content) instructions.push(msg.content);
      continue;
    }
    if (role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: msg.tool_call_id || "",
        output: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
      });
      continue;
    }
    if (typeof msg.content === "string" && msg.content) {
      input.push({ type: "message", role, content: msg.content });
    }
    for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
      const fn = (tc as any).function || {};
      input.push({
        type: "function_call",
        call_id: (tc as any).id || "call-agy",
        name: fn.name || "tool",
        arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
      });
    }
  }
  if (input.length === 0) input.push({ type: "message", role: "user", content: "(empty request)" });
  const body: Record<string, any> = { model, input, stream: false };
  if (instructions.length > 0) body.instructions = instructions.join("\n\n");
  const tools = Array.isArray(openAiPayload.tools) ? openAiPayload.tools : [];
  if (tools.length > 0) {
    body.tools = tools.map((t: any) => {
      const fn = t?.function || t || {};
      return {
        type: "function",
        name: fn.name || "tool",
        description: fn.description || "",
        parameters: fn.parameters || { type: "object", properties: {} },
      };
    });
    body.tool_choice = "auto";
  }
  if (typeof openAiPayload.temperature === "number") body.temperature = openAiPayload.temperature;
  if (typeof openAiPayload.max_tokens === "number") body.max_output_tokens = openAiPayload.max_tokens;
  if (openAiPayload.reasoning_effort) body.reasoning = { effort: openAiPayload.reasoning_effort };
  return body;
}

/** Map an OpenAI-chat payload (already translated from Gemini) to an Anthropic Messages request. */
export function openAiPayloadToAnthropicBody(
  openAiPayload: Record<string, any>,
  model: string,
  maxTokens = 8192
): Record<string, any> {
  const messages: any[] = Array.isArray(openAiPayload.messages) ? openAiPayload.messages : [];
  const systemTexts: string[] = [];
  const anthropicMessages: any[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const role = String(msg.role || "user");
    if (role === "system" || role === "developer") {
      if (typeof msg.content === "string" && msg.content) systemTexts.push(msg.content);
      continue;
    }
    if (role === "tool") {
      anthropicMessages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: msg.tool_call_id || "",
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
        }],
      });
      continue;
    }
    const blocks: any[] = [];
    if (typeof msg.content === "string" && msg.content) blocks.push({ type: "text", text: msg.content });
    for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
      const fn = (tc as any).function || {};
      let input: any = {};
      try {
        input = typeof fn.arguments === "string" ? JSON.parse(fn.arguments || "{}") : (fn.arguments ?? {});
      } catch {
        input = { _raw: fn.arguments };
      }
      blocks.push({ type: "tool_use", id: (tc as any).id || "toolu-agy", name: fn.name || "tool", input });
    }
    if (blocks.length === 0) blocks.push({ type: "text", text: "(empty)" });
    anthropicMessages.push({ role: role === "assistant" ? "assistant" : "user", content: blocks });
  }
  if (anthropicMessages.length === 0) {
    anthropicMessages.push({ role: "user", content: [{ type: "text", text: "(empty request)" }] });
  }
  const body: Record<string, any> = { model, max_tokens: maxTokens, messages: anthropicMessages, stream: false };
  if (systemTexts.length > 0) body.system = systemTexts.join("\n\n");
  if (typeof openAiPayload.temperature === "number") body.temperature = openAiPayload.temperature;
  const tools = Array.isArray(openAiPayload.tools) ? openAiPayload.tools : [];
  if (tools.length > 0) {
    body.tools = tools.map((t: any) => {
      const fn = t?.function || t || {};
      return {
        name: fn.name || "tool",
        description: fn.description || "",
        input_schema: fn.parameters || { type: "object", properties: {} },
      };
    });
  }
  return body;
}

export interface AgyParsedUpstreamResult {
  text: string;
  reasoning: string;
  toolCalls: Array<{ id: string; name: string; args: any }>;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export function parseResponsesUpstreamResult(json: any): AgyParsedUpstreamResult {
  const output = Array.isArray(json?.output) ? json.output : [];
  let text = typeof json?.output_text === "string" ? json.output_text : "";
  let reasoning = "";
  const toolCalls: AgyParsedUpstreamResult["toolCalls"] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "message") {
      for (const p of Array.isArray(item.content) ? item.content : []) {
        if (p && typeof p === "object" && typeof (p as any).text === "string" && !text) text += (p as any).text;
      }
    } else if (item.type === "reasoning") {
      for (const b of [...(Array.isArray(item.summary) ? item.summary : []), ...(Array.isArray(item.content) ? item.content : [])]) {
        if (b && typeof b === "object" && typeof (b as any).text === "string") reasoning += (b as any).text;
      }
    } else if (item.type === "function_call") {
      let args: any = {};
      try {
        args = typeof item.arguments === "string" ? JSON.parse(item.arguments || "{}") : (item.arguments ?? {});
      } catch {
        args = { _raw: item.arguments };
      }
      toolCalls.push({ id: item.call_id || item.id || "call-agy", name: item.name || "tool", args });
    }
  }
  const usage = (json?.usage || {}) as Record<string, any>;
  return {
    text,
    reasoning,
    toolCalls,
    usage: {
      inputTokens: Number(usage.input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0),
      totalTokens: Number(usage.total_tokens ?? 0),
    },
  };
}

export function parseAnthropicUpstreamResult(json: any): AgyParsedUpstreamResult {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  let text = "";
  const toolCalls: AgyParsedUpstreamResult["toolCalls"] = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") text += b.text;
    else if (b.type === "tool_use") {
      toolCalls.push({ id: b.id || "toolu-agy", name: b.name || "tool", args: b.input ?? {} });
    }
  }
  const usage = (json?.usage || {}) as Record<string, any>;
  return {
    text,
    reasoning: "",
    toolCalls,
    usage: {
      inputTokens: Number(usage.input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0),
      totalTokens: Number((usage.input_tokens ?? 0)) + Number((usage.output_tokens ?? 0)),
    },
  };
}

/* ------------------------------------------------------------------ *
 * AgyProxyServer
 * ------------------------------------------------------------------ */

export interface AgyProxyConfig {
  targetBaseUrl: string;
  targetModel: string;
  protocol?: string;
  apiKeys?: string[];
  /** Owning conversation: used to derive the stable per-thread x-opencode-session header. */
  threadId?: string;
  provider?: ProviderConfig;
  group?: ChannelGroupConfig;
  modelDisplayName?: string;
  agyCliModel?: string;
  reasoningEffort?: string;
  maxTokens?: number;
  maxCompletionTokens?: number;
  verbose?: boolean;
  /** Environment variables to pass through to proxy process (e.g., API keys from external relay) */
  environmentVars?: Record<string, string>;
}


export function isGeminiNativeProtocol(protocol?: string, targetBaseUrl?: string): boolean {
  if (protocol === "gemini") return true;
  if (targetBaseUrl) {
    if (/generativelanguage\.googleapis\.com/i.test(targetBaseUrl)) return true;
    if (targetBaseUrl.includes("/v1beta")) return true;
  }
  return false;
}

export function resolveGeminiStreamEndpoint(targetBaseUrl: string, model: string): string {
  let base = targetBaseUrl.trim();
  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  if (!base) base = "https://generativelanguage.googleapis.com";
  if (base.includes(":streamGenerateContent") || base.includes(":generateContent")) {
    return base;
  }
  const cleanModel = model.startsWith("models/") ? model.slice("models/".length) : model;
  if (base.endsWith("/v1beta") || base.endsWith("/v1")) {
    return `${base}/models/${cleanModel}:streamGenerateContent?alt=sse`;
  }
  return `${base}/v1beta/models/${cleanModel}:streamGenerateContent?alt=sse`;
}

export class AgyProxyServer {
  private server: http.Server | null = null;
  private port = 0;
  private config: AgyProxyConfig;

  constructor(config: AgyProxyConfig) {
    this.config = config;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get boundPort(): number {
    return this.port;
  }

  updateConfig(config: Partial<AgyProxyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * OpenCode Go compliance headers for upstream fetches: dedicated
   * codex-ultra-agy UA plus thread-stable x-opencode-session.
   */
  private openCodeHeaders(): Record<string, string> {
    return openCodeThreadHeaders(this.config.threadId, "agy");
  }

  async start(): Promise<string> {
    if (this.server) return this.url;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        sendGeminiError(res, `Agy Proxy Internal Error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
          resolve();
        } else {
          reject(new Error("Failed to obtain port for AgyProxyServer"));
        }
      });
      this.server!.on("error", reject);
    });

    return this.url;
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
      this.port = 0;
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url || "/";
    const method = (req.method || "GET").toUpperCase();

    if (method === "GET") {
      if (url === "/" || url === "/healthz") {
        sendJson(res, 200, {
          ok: true,
          model: this.config.targetModel,
          base: this.config.targetBaseUrl,
        });
        return;
      }
      sendJson(res, 200, {});
      return;
    }

    if (method === "POST") {
      const rawBody = await readBody(req);
      const path = url;

      if (path.includes("loadCodeAssist")) {
        sendJson(res, 200, DEFAULT_LOAD_RESP);
        return;
      }
      if (path.includes("fetchAvailableModels")) {
        const cliModel = this.config.agyCliModel || this.config.targetModel || "gemini-3.8-flash-low";
        const modelsResp = buildModelsResp(
          cliModel,
          this.config.targetModel,
          this.config.modelDisplayName
        );
        sendJson(res, 200, modelsResp);
        return;
      }
      if (path.includes("retrieveUserQuotaSummary")) {
        sendJson(res, 200, { quotaSummary: { remainingCredits: 999999 } });
        return;
      }
      if (path.includes("listExperiments")) {
        sendJson(res, 200, { experiments: [] });
        return;
      }
      if (path.includes("fetchUserInfo")) {
        sendJson(res, 200, { userEmail: "agy-proxy@local", userName: "agy-proxy" });
        return;
      }
      if (path.includes("streamGenerateContent") || path.includes("generateContent")) {
        const isGeminiEndpoint = isAgyGeminiEndpoint(path);
        const upstreamProtocol = normalizeAgyUpstreamProtocol(this.config.protocol, this.config.targetBaseUrl);
        if (upstreamProtocol === "gemini") {
          await this.handleGeminiNativeGenerate(rawBody, req, res, isGeminiEndpoint);
          return;
        }
        if (upstreamProtocol === "openai-response") {
          await this.handleResponsesUpstream(rawBody, req, res, isGeminiEndpoint);
          return;
        }
        if (upstreamProtocol === "anthropic") {
          await this.handleAnthropicUpstream(rawBody, req, res, isGeminiEndpoint);
          return;
        }
        await this.handleGenerate(rawBody, req, res, isGeminiEndpoint);
        return;
      }

      // Default empty JSON response for unknown RPCs
      sendJson(res, 200, {});
      return;
    }

    sendJson(res, 200, {});
  }

  
  private async handleGeminiNativeGenerate(
    rawBody: Buffer,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    isGeminiEndpoint = false
  ): Promise<void> {
    let parsed: any = null;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      sendGeminiError(res, "Invalid JSON body", 400);
      return;
    }

    const unwrapped = unwrapGenerateRequest(parsed);
    // Use apiKeys from config, or fall back to environment variable for external relays
    const keys = (this.config.apiKeys && this.config.apiKeys.length > 0)
      ? this.config.apiKeys
      : (this.config.environmentVars?.GEMINI_API_KEY || this.config.environmentVars?.API_KEY)
        ? [this.config.environmentVars.GEMINI_API_KEY || this.config.environmentVars.API_KEY]
        : [""];
    const fetchUrl = resolveGeminiStreamEndpoint(
      this.config.targetBaseUrl,
      this.config.targetModel
    );

    let upstreamResponse: Response | null = null;
    let lastError: any = null;
    const abortController = new AbortController();

    req.on("close", () => {
      abortController.abort();
    });

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const activeKey = keys[attempt];
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json",
        ...this.openCodeHeaders(),
      };
      if (activeKey) {
        headers["x-goog-api-key"] = activeKey;
        headers["Authorization"] = `Bearer ${activeKey}`;
      }

      try {
        const response = await fetch(fetchUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(unwrapped),
          signal: abortController.signal,
        });

        if (response.ok) {
          upstreamResponse = response;
          break;
        }

        const errBody = await response.text().catch(() => "");
        let detailMsg = errBody;
        try {
          const parsedErr = JSON.parse(errBody);
          detailMsg = parsedErr.error?.message || parsedErr.message || errBody;
        } catch {}
        const errorMsg = detailMsg
          ? (detailMsg.startsWith("HTTP") ? detailMsg : `HTTP ${response.status}: ${detailMsg}`)
          : `HTTP ${response.status}: Upstream request failed`;
        lastError = Object.assign(new Error(errorMsg), {
          status: response.status,
          body: errBody,
          detail: detailMsg,
        });

        if ([401, 402, 429].includes(response.status) || (response.status >= 500 && response.status <= 599)) {
          if (attempt < keys.length - 1) {
            continue;
          }
        }
        upstreamResponse = response;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < keys.length - 1) {
          continue;
        }
        break;
      }
    }

    if (!upstreamResponse || !upstreamResponse.ok) {
      const statusCode = upstreamResponse?.status ?? ((lastError as any)?.status || 500);
      const detail = (lastError as any)?.detail || (lastError as any)?.body;
      const errMsg = detail
        ? (detail.startsWith("HTTP") ? detail : `HTTP ${statusCode}: ${detail}`)
        : (lastError instanceof Error ? lastError.message : String(lastError || "Upstream request failed"));
      sendGeminiError(res, errMsg, statusCode, isGeminiEndpoint);
      return;
    }

    const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.includes("text/event-stream") || !upstreamResponse.body) {
      const text = await upstreamResponse.text().catch(() => "");
      try {
        const json = JSON.parse(text);
        if (json.error) {
          const errDetail = json.error.message || json.error.code || JSON.stringify(json.error);
          const errStatus = typeof json.error.code === "number" && json.error.code >= 400 && json.error.code < 600
            ? json.error.code
            : 400;
          sendGeminiError(res, errDetail, errStatus, isGeminiEndpoint);
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "close",
        });
        sendGeminiChunk(res, json, isGeminiEndpoint);
        res.end();
        return;
      } catch {
        res.writeHead(200, { "Content-Type": contentType || "application/json" });
        res.end(text);
        return;
      }
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "close",
    });

    try {
      await forwardAgyGeminiStream(upstreamResponse.body, res, isGeminiEndpoint);
    } catch (streamErr) {
      if (!res.writableEnded) {
        sendGeminiError(res, `Upstream stream error: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`, 500, isGeminiEndpoint);
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  private upstreamKeys(): string[] {
    if (this.config.apiKeys && this.config.apiKeys.length > 0) return this.config.apiKeys;
    const envKey = this.config.environmentVars?.GEMINI_API_KEY || this.config.environmentVars?.API_KEY;
    return envKey ? [envKey] : [""];
  }

  private async postUpstreamJson(url: string, body: Record<string, any>): Promise<{ status: number; json: any; raw: string }> {
    const keys = this.upstreamKeys();
    let lastStatus = 502;
    let lastRaw = "";
    for (const key of keys) {
      try {
        const activeHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...this.openCodeHeaders(),
        };
        if (key) activeHeaders["Authorization"] = `Bearer ${key}`;
        const response = await fetch(url, { method: "POST", headers: activeHeaders, body: JSON.stringify(body) });
        const raw = await response.text().catch(() => "");
        let parsed: any = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = { _raw: raw };
        }
        if (response.ok && !parsed?.error) return { status: response.status, json: parsed, raw };
        lastStatus = response.status;
        lastRaw = raw;
        if ([401, 402, 429].includes(response.status) || (response.status >= 500 && response.status <= 599)) continue;
        return { status: response.status, json: parsed, raw };
      } catch (err) {
        lastRaw = err instanceof Error ? err.message : String(err);
      }
    }
    let fallback: any = {};
    try {
      fallback = lastRaw ? JSON.parse(lastRaw) : {};
    } catch {
      fallback = { _raw: lastRaw };
    }
    return { status: lastStatus, json: fallback, raw: lastRaw };
  }

  private upstreamDetail(result: { status: number; json: any; raw: string }): string {
    const err = result.json?.error;
    const detail = err && typeof err === "object" ? (err.message || JSON.stringify(err)) : (err || result.raw);
    return detail ? `HTTP ${result.status}: ${detail}` : `HTTP ${result.status}: Upstream request failed`;
  }

  private emitParsedAsGemini(res: http.ServerResponse, parsed: AgyParsedUpstreamResult, isGeminiEndpoint = false): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "close",
    });
    if (parsed.reasoning) {
      sendGeminiChunk(res, {
        response: {
          candidates: [{ content: { role: "model", parts: [{ text: parsed.reasoning, thought: true }] } }],
        },
      }, isGeminiEndpoint);
    }
    if (parsed.text) {
      sendGeminiChunk(res, {
        response: {
          candidates: [{ content: { role: "model", parts: [{ text: parsed.text }] } }],
        },
      }, isGeminiEndpoint);
    }
    for (const tc of parsed.toolCalls) {
      sendGeminiChunk(res, {
        response: {
          candidates: [{
            content: {
              role: "model",
              parts: [{ functionCall: { name: tc.name, args: tc.args, ...(tc.id ? { id: tc.id } : {}) } }],
            },
          }],
        },
      }, isGeminiEndpoint);
    }
    sendGeminiChunk(res, {
      response: {
        ...(parsed.usage.totalTokens > 0 ? {
          usageMetadata: {
            promptTokenCount: parsed.usage.inputTokens,
            candidatesTokenCount: parsed.usage.outputTokens,
            totalTokenCount: parsed.usage.totalTokens,
          },
        } : {}),
        candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }],
      },
    }, isGeminiEndpoint);
    res.end();
  }

  /**
   * Gemini CLI input -> Responses-only relay. Buffered upstream fetch, then
   * re-emitted as Gemini SSE. Without this branch the request was forced
   * through chat/completions and rejected with ModelProtocolUnsupported.
   */
  private async handleResponsesUpstream(
    rawBody: Buffer,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    isGeminiEndpoint = false
  ): Promise<void> {
    void req;
    let raw: any = {};
    try {
      raw = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
    } catch (e) {
      sendGeminiError(res, `Invalid JSON: ${e}`, 400, isGeminiEndpoint);
      return;
    }
    const openaiPayload = buildOpenAiPayload(raw, this.config.targetModel, {
      reasoningEffort: this.config.reasoningEffort,
      maxTokens: this.config.maxTokens,
      maxCompletionTokens: this.config.maxCompletionTokens,
    });
    const responsesBody = openAiPayloadToResponsesBody(openaiPayload, this.config.targetModel);
    const url = resolveResponsesEndpoint(this.config.targetBaseUrl);
    const result = await this.postUpstreamJson(url, responsesBody);
    if (result.status < 200 || result.status >= 300 || result.json?.error) {
      sendGeminiError(res, this.upstreamDetail(result), result.status, isGeminiEndpoint);
      return;
    }
    this.emitParsedAsGemini(res, parseResponsesUpstreamResult(result.json), isGeminiEndpoint);
  }

  /** Gemini CLI input -> Anthropic-messages relay (same buffered pattern). */
  private async handleAnthropicUpstream(
    rawBody: Buffer,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    isGeminiEndpoint = false
  ): Promise<void> {
    void req;
    let raw: any = {};
    try {
      raw = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
    } catch (e) {
      sendGeminiError(res, `Invalid JSON: ${e}`, 400, isGeminiEndpoint);
      return;
    }
    const openaiPayload = buildOpenAiPayload(raw, this.config.targetModel, {
      reasoningEffort: this.config.reasoningEffort,
      maxTokens: this.config.maxTokens,
      maxCompletionTokens: this.config.maxCompletionTokens,
    });
    const maxTokens = typeof openaiPayload.max_tokens === "number" && openaiPayload.max_tokens > 0
      ? Math.min(openaiPayload.max_tokens, 16384)
      : 8192;
    const anthropicBody = openAiPayloadToAnthropicBody(openaiPayload, this.config.targetModel, maxTokens);
    const url = resolveAnthropicMessagesEndpoint(this.config.targetBaseUrl);
    const result = await this.postUpstreamJson(url, anthropicBody);
    if (result.status < 200 || result.status >= 300 || result.json?.error) {
      sendGeminiError(res, this.upstreamDetail(result), result.status, isGeminiEndpoint);
      return;
    }
    this.emitParsedAsGemini(res, parseAnthropicUpstreamResult(result.json), isGeminiEndpoint);
  }

  private async handleGenerate(
    rawBody: Buffer,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    isGeminiEndpoint = false
  ): Promise<void> {
    let raw: any = {};
    try {
      raw = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
    } catch (e) {
      sendJson(res, 400, { error: `Invalid JSON: ${e}` });
      return;
    }

    const openaiPayload = buildOpenAiPayload(raw, this.config.targetModel, {
      reasoningEffort: this.config.reasoningEffort,
      maxTokens: this.config.maxTokens,
      maxCompletionTokens: this.config.maxCompletionTokens,
    });

    const apiUrl = resolveOpenAiChatEndpoint(this.config.targetBaseUrl);
    const keys = (this.config.apiKeys && this.config.apiKeys.length > 0) ? this.config.apiKeys : [""];

    const abortController = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    let upstreamResponse: Response | undefined;
    let lastError: any;

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const activeKey = keys[attempt];
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        ...this.openCodeHeaders(),
      };
      if (activeKey) {
        headers["Authorization"] = `Bearer ${activeKey}`;
      }

      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(openaiPayload),
          signal: abortController.signal,
        });

        if (response.ok) {
          upstreamResponse = response;
          break;
        }

        const errBody = await response.text().catch(() => "");
        let detailMsg = errBody;
        try {
          const parsed = JSON.parse(errBody);
          detailMsg = parsed.error?.message || parsed.message || errBody;
        } catch {}
        const errorMsg = detailMsg
          ? (detailMsg.startsWith("HTTP") ? detailMsg : `HTTP ${response.status}: ${detailMsg}`)
          : `HTTP ${response.status}: Upstream request failed`;
        lastError = Object.assign(new Error(errorMsg), {
          status: response.status,
          body: errBody,
          detail: detailMsg,
        });

        // If 401, 402, 429, or 5xx, continue to next key if available
        if ([401, 402, 429].includes(response.status) || (response.status >= 500 && response.status <= 599)) {
          if (attempt < keys.length - 1) {
            continue;
          }
        }
        upstreamResponse = response;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < keys.length - 1) {
          continue;
        }
        break;
      }
    }

    if (!upstreamResponse || !upstreamResponse.ok) {
      const statusCode = upstreamResponse?.status ?? ((lastError as any)?.status || 500);
      const detail = (lastError as any)?.detail || (lastError as any)?.body;
      const errMsg = detail
        ? (detail.startsWith("HTTP") ? detail : `HTTP ${statusCode}: ${detail}`)
        : (lastError instanceof Error ? lastError.message : String(lastError || "Upstream request failed"));
      sendGeminiError(res, errMsg, statusCode, isGeminiEndpoint);
      return;
    }

    const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() || "";

    // If upstream answered with plain JSON instead of SSE
    if (!contentType.includes("text/event-stream") || !upstreamResponse.body) {
      const text = await upstreamResponse.text().catch(() => "");
      try {
        const json = JSON.parse(text);
        if (json.error) {
          const errDetail = json.error.message || json.error.code || JSON.stringify(json.error);
          const errStatus = typeof json.error.code === "number" && json.error.code >= 400 && json.error.code < 600
            ? json.error.code
            : 400;
          sendGeminiError(res, errDetail, errStatus, isGeminiEndpoint);
          return;
        }
        const choice = json.choices?.[0];
        const message = choice?.message || {};
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "close",
        });

        if (typeof message.content === "string" && message.content) {
          sendGeminiChunk(res, {
            response: {
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [{ text: message.content }],
                  },
                },
              ],
            },
          }, isGeminiEndpoint);
        }

        if (Array.isArray(message.tool_calls)) {
          for (const tc of message.tool_calls) {
            let args = {};
            try {
              args = typeof tc.function?.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : (tc.function?.arguments || {});
            } catch {
              args = { _raw: tc.function?.arguments };
            }
            sendGeminiChunk(res, {
              response: {
                candidates: [
                  {
                    content: {
                      role: "model",
                      parts: [
                        {
                          functionCall: {
                            name: tc.function?.name || "tool",
                            args,
                            ...(tc.id ? { id: tc.id } : {}),
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            }, isGeminiEndpoint);
          }
        }

        const finishReason = choice?.finish_reason === "length"
          ? "MAX_TOKENS"
          : choice?.finish_reason === "tool_calls"
          ? "STOP"
          : (choice?.finish_reason?.toUpperCase() || "STOP");

        sendGeminiChunk(res, {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [] },
                finishReason,
              },
            ],
          },
        }, isGeminiEndpoint);
        res.end();
        return;
      } catch {
        sendGeminiError(res, `Failed to parse upstream response: ${text}`, 500, isGeminiEndpoint);
        return;
      }
    }

    // Stream SSE back to client
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "close",
    });

    const accumulatedToolCalls = new Map<number, { name: string; argsStr: string; id: string }>();
    let lastFinishReason: string | undefined;
    let lastUsage: Record<string, unknown> | undefined;

    try {
      const reader = upstreamResponse.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") break;

          try {
            const chunk = JSON.parse(dataStr);
            if (chunk.usage && typeof chunk.usage === "object") {
              lastUsage = chunk.usage as Record<string, unknown>;
            }
            const choices = chunk.choices || [];
            if (!choices.length) continue;
            const choice = choices[0];
            if (choice.finish_reason) {
              lastFinishReason = choice.finish_reason;
            }
            const delta = choice.delta || choice.message || {};

            // Normal text
            const content = delta.content;
            if (typeof content === "string" && content) {
              sendGeminiChunk(res, {
                response: {
                  candidates: [
                    {
                      content: {
                        role: "model",
                        parts: [{ text: content }],
                      },
                    },
                  ],
                },
              }, isGeminiEndpoint);
            }

            // Reasoning content
            const reasoning = delta.reasoning_content || delta.reasoning;
            if (typeof reasoning === "string" && reasoning) {
              sendGeminiChunk(res, {
                response: {
                  candidates: [
                    {
                      content: {
                        role: "model",
                        // Gemini's thought marker keeps relay reasoning out of the final answer
// while allowing agy.exe to expose it through its reasoning projector.
                         parts: [{ text: reasoning, thought: true }],
                      },
                    },
                  ],
                },
              }, isGeminiEndpoint);
            }

            // Streaming tool calls
            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = Number(tc.index ?? 0);
                let slot = accumulatedToolCalls.get(idx);
                if (!slot) {
                  slot = { name: "", argsStr: "", id: "" };
                  accumulatedToolCalls.set(idx, slot);
                }
                if (tc.id) slot.id = tc.id;
                const fn = tc.function || {};
                if (fn.name) slot.name = fn.name;
                if (fn.arguments) slot.argsStr += fn.arguments;
              }
            }
          } catch {
            // Ignore partial/malformed lines
          }
        }
      }

      // Emit completed tool calls
      const sortedIndices = Array.from(accumulatedToolCalls.keys()).sort((a, b) => a - b);
      for (const idx of sortedIndices) {
        const tc = accumulatedToolCalls.get(idx)!;
        let args = {};
        try {
          args = JSON.parse(tc.argsStr || "{}");
        } catch {
          args = { _raw: tc.argsStr };
        }
        const functionCall: Record<string, any> = {
          name: tc.name || "tool",
          args,
        };
        if (tc.id) functionCall.id = tc.id;

        sendGeminiChunk(res, {
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ functionCall }],
                },
              },
            ],
          },
        }, isGeminiEndpoint);
      }

      // Emit final finishReason chunk
      const finishReason = lastFinishReason === "length"
        ? "MAX_TOKENS"
        : lastFinishReason === "tool_calls"
        ? "STOP"
        : (lastFinishReason?.toUpperCase() || "STOP");

      sendGeminiChunk(res, {
        response: {
          ...(lastUsage ? {
            usageMetadata: {
              promptTokenCount: Number(lastUsage.prompt_tokens ?? lastUsage.input_tokens ?? 0),
              candidatesTokenCount: Number(lastUsage.completion_tokens ?? lastUsage.output_tokens ?? 0),
              totalTokenCount: Number(lastUsage.total_tokens ?? 0),
              ...(Number((lastUsage.prompt_tokens_details as any)?.cached_tokens ?? lastUsage.cached_input_tokens ?? 0) > 0
                ? { cachedContentTokenCount: Number((lastUsage.prompt_tokens_details as any)?.cached_tokens ?? lastUsage.cached_input_tokens) }
                : {})
            }
          } : {}),
          candidates: [
            {
              content: { role: "model", parts: [] },
              finishReason,
            },
          ],
        },
      }, isGeminiEndpoint);
      res.end();
    } catch (streamErr) {
      if (!res.writableEnded) {
        sendGeminiError(res, `Upstream stream error: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`, 500, isGeminiEndpoint);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function sendJson(res: http.ServerResponse, status: number, data: any): void {
  const jsonBuf = Buffer.from(JSON.stringify(data, null, 2), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(jsonBuf.length),
    "Connection": "close",
  });
  res.end(jsonBuf);
}

function sendGeminiChunk(res: http.ServerResponse, obj: any, isGeminiEndpoint = false): void {
  res.write(`data: ${JSON.stringify(formatAgyGeminiResponse(obj, isGeminiEndpoint))}\n\n`);
}


function sendGeminiError(res: http.ServerResponse, message: string, _statusCode = 500, _isGeminiEndpoint = false): void {
  try {
    if (!res.headersSent) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "close",
      });
    }
    // Match agy-launch: Never send HTTP 401/403/500 to agy.exe from CLOUD_CODE_URL,
    // because agy.exe intercepts 4xx/5xx as Google Code Assist auth failure and opens the OAuth browser login window.
    // Instead, stream the error as a model text chunk so it prints clearly and stops gracefully.
    sendGeminiChunk(res, {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: `[Antigravity Error] ${message}` }],
            },
            finishReason: "STOP",
          },
        ],
      },
    }, _isGeminiEndpoint);
    res.end();
  } catch {}
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

