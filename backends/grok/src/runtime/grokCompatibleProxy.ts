import http from "node:http";
import { randomUUID } from "node:crypto";
import type { ChannelGroupConfig, ProviderConfig } from "@codex-ui/shared";
import { openCodeThreadHeaders } from "@cxu/sdk-backend";

/* ------------------------------------------------------------------ *
 * Types & Interfaces
 * ------------------------------------------------------------------ */

export interface GrokProxyConfig {
  targetBaseUrl: string;
  targetModel: string;
  apiKeys: string[];
  provider?: ProviderConfig;
  group?: ChannelGroupConfig;
  /** Owning conversation: used to derive the stable per-thread x-opencode-session header. */
  threadId?: string;
  modelDisplayName?: string;
  grokCliModel?: string;
  reasoningEffort?: string;
  maxTokens?: number;
  maxCompletionTokens?: number;
  wireApi?: "chat" | "responses" | "anthropic" | "gemini";
  verbose?: boolean;
}

/* ------------------------------------------------------------------ *
 * Protocol Translation (Responses API <-> Chat Completions API)
 * Ported from E:\projects\grok-launch\main.py
 * ------------------------------------------------------------------ */

export function buildUpstreamUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const [pathPart = "", queryPart] = path.split("?");
  const query = queryPart ? `?${queryPart}` : "";
  let rel = pathPart.replace(/^\/+/, "");
  if (base.endsWith("/v1") && rel.startsWith("v1/")) {
    rel = rel.slice(3);
  }
  return `${base}/${rel}${query}`;
}

export type GrokWireApi = "chat" | "responses" | "anthropic" | "gemini";

/**
 * Normalize a group `responseProtocol` (or legacy wireApi value) to the
 * upstream wire protocol the Grok proxy must speak.
 *
 * CLI input protocol (Responses vs Chat, decided by request path) is
 * orthogonal: this only describes what the *upstream relay* expects, so a
 * responses-only relay (wireApi=responses) never receives chat/completions.
 */
export function normalizeGrokWireApi(value: unknown): GrokWireApi {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "responses" || v === "openai-response" || v === "openai-responses") return "responses";
  if (v === "anthropic" || v === "claude" || v === "messages") return "anthropic";
  if (v === "gemini" || v === "google" || v === "vertex") return "gemini";
  return "chat";
}

export function resolveGrokWireApi(group: ChannelGroupConfig | undefined, model?: string): GrokWireApi {
  const protocol = (group as { responseProtocol?: unknown } | undefined)?.responseProtocol;
  void model;
  return normalizeGrokWireApi(protocol ?? "chat");
}

export function resolveResponsesEndpoint(baseUrl: string): string {
  return buildUpstreamUrl(baseUrl, "/v1/responses");
}

export function resolveAnthropicEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/messages")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/messages`;
  // A base already carrying /v1/<suffix> that is not messages: append cleanly.
  return `${trimmed}/v1/messages`;
}

export function resolveGeminiGenerateEndpoint(baseUrl: string, model: string): string {
  let base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) base = "https://generativelanguage.googleapis.com";
  if (base.includes(":generateContent") || base.includes(":streamGenerateContent")) return base;
  const cleanModel = model.startsWith("models/") ? model.slice("models/".length) : model;
  if (base.endsWith("/v1beta") || base.endsWith("/v1")) {
    return `${base}/models/${cleanModel}:generateContent`;
  }
  return `${base}/v1beta/models/${cleanModel}:generateContent`;
}

export function responsesRequestToChat(
  payload: Record<string, any>,
  activeModel: string,
  options?: {
    reasoningEffort?: string;
    maxTokens?: number;
    maxCompletionTokens?: number;
  }
): Record<string, any> {
  const model = activeModel;

  let inputItems: any[] = payload.input || [];
  if (typeof inputItems === "string") {
    inputItems = [{ type: "message", role: "user", content: inputItems }];
  } else if (!Array.isArray(inputItems)) {
    inputItems = [];
  }

  const messages: any[] = [];
  const systemTexts: string[] = [];

  const instructions = payload.instructions;
  if (typeof instructions === "string" && instructions.trim()) {
    systemTexts.push(instructions.trim());
  }

  const rawTools: any[] = Array.isArray(payload.tools) ? [...payload.tools] : [];
  for (const item of inputItems) {
    if (item && typeof item === "object" && item.type === "additional_tools") {
      if (Array.isArray(item.tools)) {
        rawTools.push(...item.tools);
      }
    }
  }

  for (const item of inputItems) {
    if (!item || typeof item !== "object") continue;
    const itemType = String(item.type || "");

    if (itemType === "message" || itemType === "assistant_message" || itemType === "agent_message" || (!itemType && (item.role || item.content || item.text))) {
      const rawRole = item.role;
      let role = "user";
      if (!rawRole) {
        role = (itemType === "assistant_message" || itemType === "agent_message") ? "assistant" : "user";
      } else {
        role = rawRole === "developer" ? "system" : rawRole;
      }

      let content = "";
      if (typeof item.content === "string") {
        content = item.content;
      } else if (Array.isArray(item.content)) {
        const parts: string[] = [];
        for (const p of item.content) {
          if (typeof p === "string") {
            parts.push(p);
          } else if (p && typeof p === "object") {
            const t = p.text || p.output_text || p.output_text_delta;
            if (typeof t === "string") parts.push(t);
          }
        }
        content = parts.join("");
      } else if (typeof item.text === "string") {
        content = item.text;
      }

      if (role === "system") {
        if (content) systemTexts.push(content);
      } else {
        messages.push({ role, content });
      }
    } else if (itemType === "function_call" || itemType === "custom_tool_call" || itemType === "mcp_tool_call") {
      const callId = item.call_id || `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const name = item.name || "tool";

      let argumentsStr = "{}";
      const rawArgs = item.arguments ?? item.input;
      if (typeof rawArgs === "string") {
        argumentsStr = rawArgs;
      } else if (rawArgs && typeof rawArgs === "object") {
        argumentsStr = JSON.stringify(rawArgs);
      }

      if (messages.length > 0 && messages[messages.length - 1]?.role === "assistant") {
        const last = messages[messages.length - 1];
        if (!Array.isArray(last.tool_calls)) {
          last.tool_calls = [];
        }
        last.tool_calls.push({
          id: callId,
          type: "function",
          function: { name, arguments: argumentsStr },
        });
      } else {
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: callId,
              type: "function",
              function: { name, arguments: argumentsStr },
            },
          ],
        });
      }
    } else if (
      itemType === "function_call_output" ||
      itemType === "custom_tool_call_output" ||
      itemType === "tool_search_output" ||
      itemType === "mcp_tool_call_output"
    ) {
      const callId = item.call_id || "";
      const name = item.name || "";
      let outputStr = "";
      const rawOutput = item.content ?? item.output ?? item.text ?? "";
      if (typeof rawOutput === "string") {
        outputStr = rawOutput;
      } else if (Array.isArray(rawOutput)) {
        const parts: string[] = [];
        for (const p of rawOutput) {
          if (typeof p === "string") {
            parts.push(p);
          } else if (p && typeof p === "object") {
            const t = p.text || p.output_text || p.output_text_delta;
            if (typeof t === "string") parts.push(t);
          }
        }
        outputStr = parts.join("");
      } else if (rawOutput && typeof rawOutput === "object") {
        outputStr = JSON.stringify(rawOutput);
      }

      messages.push({
        role: "tool",
        tool_call_id: callId,
        name,
        content: outputStr,
      });
    }
  }

  if (systemTexts.length > 0) {
    messages.unshift({ role: "system", content: systemTexts.join("\n\n") });
  }

  const openaiTools: any[] = [];
  for (const tool of rawTools) {
    if (!tool || typeof tool !== "object") continue;
    const tType = tool.type;
    if (tType === "function") {
      const fn = tool.function || tool;
      openaiTools.push({
        type: "function",
        function: {
          name: fn.name,
          description: fn.description || "",
          parameters: fn.parameters || {},
        },
      });
    } else if (tType === "namespace") {
      const nsName = tool.name || "";
      const subtools = Array.isArray(tool.tools) ? tool.tools : [];
      for (const sub of subtools) {
        if (!sub || typeof sub !== "object") continue;
        const fn = sub.function || sub;
        const subName = fn.name || "";
        const flatName = nsName ? `${nsName}__${subName}` : subName;
        openaiTools.push({
          type: "function",
          function: {
            name: flatName,
            description: fn.description || "",
            parameters: fn.parameters || {},
          },
        });
      }
    } else if (tType === "custom") {
      const name = tool.name || "";
      if (name === "exec_command") {
        openaiTools.push({
          type: "function",
          function: {
            name: "exec_command",
            description: tool.description || "Execute command",
            parameters: tool.parameters || {},
          },
        });
      }
    }
  }

  const outPayload: Record<string, any> = {
    model,
    messages,
    stream: Boolean(payload.stream),
  };

  if (openaiTools.length > 0) {
    outPayload.tools = openaiTools;
    outPayload.tool_choice = "auto";
  }

  for (const key of [
    "temperature",
    "top_p",
    "presence_penalty",
    "frequency_penalty",
    "max_tokens",
    "max_completion_tokens",
    "reasoning_effort",
  ]) {
    if (key in payload) {
      outPayload[key] = payload[key];
    }
  }

  if (!outPayload.reasoning_effort && options?.reasoningEffort) {
    outPayload.reasoning_effort = options.reasoningEffort;
  }
  if (!outPayload.max_completion_tokens && options?.maxCompletionTokens && options.maxCompletionTokens > 0) {
    outPayload.max_completion_tokens = options.maxCompletionTokens;
  }
  if (!outPayload.max_tokens && options?.maxTokens && options.maxTokens > 0) {
    outPayload.max_tokens = options.maxTokens;
  }

  return outPayload;
}

export function chatResponseToResponses(chatResp: Record<string, any>): Record<string, any> {
  const choices = Array.isArray(chatResp.choices) ? chatResp.choices : [];
  const outputItems: any[] = [];
  let outputText = "";

  if (choices.length > 0) {
    const choice = choices[0] || {};
    const message = choice.message || {};
    const content = message.content || "";
    outputText = typeof content === "string" ? content : "";

    const reasoning = message.reasoning_content || message.reasoning || "";
    if (reasoning && typeof reasoning === "string") {
      outputItems.push({
        type: "reasoning",
        summary: [{ type: "summary_text", text: reasoning }],
        content: [{ type: "reasoning_text", text: reasoning }],
        encrypted_content: null,
      });
    }

    if (outputText) {
      outputItems.push({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: outputText }],
      });
    }

    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const tc of toolCalls) {
      const fn = tc.function || {};
      outputItems.push({
        type: "function_call",
        id: `tc_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        call_id: tc.id || `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        name: fn.name || "tool",
        arguments: fn.arguments || "{}",
      });
    }
  }

  const usage = chatResp.usage || {};
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? (inputTokens + outputTokens);

  return {
    id: `resp_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    object: "response",
    output: outputItems,
    output_text: outputText,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
    },
    status: "completed",
  };
}

/* ------------------------------------------------------------------ *
 * Cross-protocol Translation (Chat <-> Responses <-> Anthropic/Gemini)
 * Pivot: OpenAI Chat messages. Any upstream normalizes to a Chat-style
 * completion first, then renders to the CLI's input protocol. New
 * cross-protocol paths use buffered (non-streaming) upstream fetches and
 * synthesize the CLI stream, which keeps behavior correct even when the
 * relay only speaks a single protocol (e.g. responses-only relays that
 * reject chat/completions with ModelProtocolUnsupported).
 * ------------------------------------------------------------------ */

export function chatRequestToResponses(
  payload: Record<string, any>,
  activeModel: string,
  options: { reasoningEffort?: string; maxTokens?: number; maxCompletionTokens?: number } = {}
): Record<string, any> {
  const messages: any[] = Array.isArray(payload.messages) ? payload.messages : [];
  const input: any[] = [];
  const instructions: string[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const role = String(msg.role || "user");
    if (role === "system" || role === "developer") {
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p: any) => (typeof p === "string" ? p : (p?.text ?? ""))).join("")
          : "";
      if (text) instructions.push(text);
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
    const contentText = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((p: any) => (typeof p === "string" ? p : (p?.text ?? ""))).join("")
        : "";
    if (contentText) {
      input.push({ type: "message", role, content: contentText });
    }
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    for (const tc of toolCalls) {
      const fn = (tc as any).function || {};
      input.push({
        type: "function_call",
        call_id: (tc as any).id || `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        name: fn.name || "tool",
        arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
      });
    }
    if (!contentText && toolCalls.length === 0) {
      input.push({ type: "message", role, content: "" });
    }
  }
  const tools: any[] = [];
  for (const tool of Array.isArray(payload.tools) ? payload.tools : []) {
    if (!tool || typeof tool !== "object") continue;
    const fn = (tool as any).function || tool;
    if (!fn?.name) continue;
    tools.push({
      type: "function",
      name: fn.name,
      description: fn.description || "",
      parameters: fn.parameters || { type: "object", properties: {} },
    });
  }
  const out: Record<string, any> = { model: activeModel, input, stream: Boolean(payload.stream) };
  if (instructions.length > 0) out.instructions = instructions.join("\n\n");
  if (tools.length > 0) {
    out.tools = tools;
    out.tool_choice = "auto";
  }
  if (payload.temperature !== undefined) out.temperature = payload.temperature;
  if ((payload as any).top_p !== undefined) out.top_p = (payload as any).top_p;
  const maxOut = (payload as any).max_completion_tokens ?? (payload as any).max_tokens ?? options.maxCompletionTokens ?? options.maxTokens;
  if (typeof maxOut === "number" && maxOut > 0) out.max_output_tokens = maxOut;
  const effort = (payload as any).reasoning_effort ?? options.reasoningEffort;
  if (effort) out.reasoning = { effort };
  return out;
}

export function responsesResponseToChat(responsesJson: Record<string, any>, model: string): Record<string, any> {
  const output = Array.isArray(responsesJson.output) ? responsesJson.output : [];
  let content = typeof responsesJson.output_text === "string" ? responsesJson.output_text : "";
  let reasoning = "";
  const toolCalls: any[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "message") {
      const parts = Array.isArray(item.content) ? item.content : [];
      for (const p of parts) {
        if (p && typeof p === "object" && typeof (p as any).text === "string") content += (p as any).text;
      }
    } else if (item.type === "reasoning") {
      const blocks = [...(Array.isArray(item.summary) ? item.summary : []), ...(Array.isArray(item.content) ? item.content : [])];
      for (const b of blocks) {
        if (b && typeof b === "object" && typeof (b as any).text === "string") reasoning += (b as any).text;
      }
    } else if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id || item.id || `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        type: "function",
        function: {
          name: item.name || "tool",
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
        },
      });
    }
  }
  const usage = (responsesJson.usage || {}) as Record<string, any>;
  const message: Record<string, any> = { role: "assistant", content: content || null };
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (!content && toolCalls.length === 0 && !reasoning) message.content = "";
  return {
    id: responsesJson.id || `chatcmpl_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop" }],
    usage: {
      prompt_tokens: usage.input_tokens ?? 0,
      completion_tokens: usage.output_tokens ?? 0,
      total_tokens: usage.total_tokens ?? ((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)),
    },
  };
}

export function openAiMessagesToAnthropicPayload(
  messages: any[],
  tools: any[],
  model: string,
  options: { maxTokens?: number; temperature?: number } = {}
): Record<string, any> {
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
        content: [{ type: "tool_result", tool_use_id: msg.tool_call_id || "", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "") }],
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
      blocks.push({ type: "tool_use", id: (tc as any).id || `toolu_${randomUUID().replace(/-/g, "").slice(0, 8)}`, name: fn.name || "tool", input });
    }
    if (blocks.length === 0) blocks.push({ type: "text", text: "(empty)" });
    anthropicMessages.push({ role: role === "assistant" ? "assistant" : "user", content: blocks });
  }
  if (anthropicMessages.length === 0) {
    anthropicMessages.push({ role: "user", content: [{ type: "text", text: "(empty)" }] });
  }
  const body: Record<string, any> = {
    model,
    max_tokens: options.maxTokens && options.maxTokens > 0 ? Math.min(options.maxTokens, 16384) : 8192,
    messages: anthropicMessages,
    stream: false,
  };
  if (systemTexts.length > 0) body.system = systemTexts.join("\n\n");
  if (typeof options.temperature === "number") body.temperature = options.temperature;
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools.map((t: any) => {
      const fn = t?.function || t || {};
      return { name: fn.name || "tool", description: fn.description || "", input_schema: fn.parameters || { type: "object", properties: {} } };
    });
  }
  return body;
}

export function anthropicResponseToChat(anthropicJson: Record<string, any>, model: string): Record<string, any> {
  const blocks = Array.isArray(anthropicJson.content) ? anthropicJson.content : [];
  let content = "";
  const toolCalls: any[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") content += b.text;
    else if (b.type === "tool_use") {
      toolCalls.push({
        id: b.id || `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        type: "function",
        function: { name: b.name || "tool", arguments: JSON.stringify(b.input ?? {}) },
      });
    }
  }
  const usage = (anthropicJson.usage || {}) as Record<string, any>;
  const message: Record<string, any> = { role: "assistant", content: content || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (!content && toolCalls.length === 0) message.content = "";
  return {
    id: anthropicJson.id || `chatcmpl_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop" }],
    usage: {
      prompt_tokens: usage.input_tokens ?? 0,
      completion_tokens: usage.output_tokens ?? 0,
      total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    },
  };
}

export function openAiMessagesToGeminiPayload(messages: any[], tools: any[], model: string): Record<string, any> {
  const systemTexts: string[] = [];
  const contents: any[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const role = String(msg.role || "user");
    if (role === "system" || role === "developer") {
      if (typeof msg.content === "string" && msg.content) systemTexts.push(msg.content);
      continue;
    }
    if (role === "tool") {
      contents.push({ role: "user", parts: [{ text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "") }] });
      continue;
    }
    const parts: any[] = [];
    if (typeof msg.content === "string" && msg.content) parts.push({ text: msg.content });
    for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
      const fn = (tc as any).function || {};
      let args: any = {};
      try {
        args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments || "{}") : (fn.arguments ?? {});
      } catch {
        args = { _raw: fn.arguments };
      }
      parts.push({ functionCall: { name: fn.name || "tool", args } });
    }
    if (parts.length === 0) parts.push({ text: "(empty)" });
    contents.push({ role: role === "assistant" ? "model" : "user", parts });
  }
  if (contents.length === 0) contents.push({ role: "user", parts: [{ text: "(empty)" }] });
  void model;
  const body: Record<string, any> = { contents };
  if (systemTexts.length > 0) body.systemInstruction = { parts: [{ text: systemTexts.join("\n\n") }] };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = [{
      functionDeclarations: tools.map((t: any) => {
        const fn = t?.function || t || {};
        return { name: fn.name || "tool", description: fn.description || "", parameters: fn.parameters || { type: "object", properties: {} } };
      }),
    }];
  }
  return body;
}

export function geminiResponseToChat(geminiJson: Record<string, any>, model: string): Record<string, any> {
  const candidates = Array.isArray(geminiJson.candidates) ? geminiJson.candidates : [];
  const first = candidates[0] || {};
  const parts = Array.isArray(first.content?.parts) ? first.content.parts : [];
  let content = "";
  const toolCalls: any[] = [];
  for (const p of parts) {
    if (p && typeof p === "object" && typeof p.text === "string") content += p.text;
    else if (p && typeof p === "object" && p.functionCall) {
      toolCalls.push({
        id: `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        type: "function",
        function: { name: p.functionCall.name || "tool", arguments: JSON.stringify(p.functionCall.args ?? {}) },
      });
    }
  }
  const usage = (geminiJson.usageMetadata || {}) as Record<string, any>;
  const message: Record<string, any> = { role: "assistant", content: content || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (!content && toolCalls.length === 0) message.content = "";
  return {
    id: `chatcmpl_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop" }],
    usage: {
      prompt_tokens: usage.promptTokenCount ?? 0,
      completion_tokens: usage.candidatesTokenCount ?? 0,
      total_tokens: usage.totalTokenCount ?? 0,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Grok Proxy Server
 * ------------------------------------------------------------------ */

export class GrokProxyServer {
  private server: http.Server | null = null;
  private port = 0;
  private config: GrokProxyConfig;

  constructor(config: GrokProxyConfig) {
    this.config = config;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get boundPort(): number {
    return this.port;
  }

  updateConfig(config: Partial<GrokProxyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * OpenCode Go compliance headers for upstream fetches: dedicated
   * codex-ultra-grok UA plus thread-stable x-opencode-session.
   */
  private openCodeHeaders(): Record<string, string> {
    return openCodeThreadHeaders(this.config.threadId, "grok");
  }

  async start(): Promise<string> {
    if (this.server) return this.url;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        sendGrokError(res, `Grok Proxy Internal Error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
          resolve();
        } else {
          reject(new Error("Failed to obtain port for GrokProxyServer"));
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
    const rawUrl = req.url || "/";
    const [path] = rawUrl.split("?");
    const method = (req.method || "GET").toUpperCase();

    if (method === "GET") {
      if (path === "/" || path === "/healthz") {
        sendJson(res, 200, {
          ok: true,
          model: this.config.targetModel,
          base: this.config.targetBaseUrl,
        });
        return;
      }
      if (path === "/v1/models" || path === "/models") {
        await this.handleModels(res);
        return;
      }
      sendJson(res, 404, { error: { message: `Not found: ${path}` } });
      return;
    }

    if (method === "POST") {
      if (path === "/v1/responses" || path === "/responses") {
        await this.handleResponses(req, res);
        return;
      }
      if (path === "/v1/chat/completions" || path === "/chat/completions") {
        await this.handleChatCompletions(req, res);
        return;
      }
      sendJson(res, 404, { error: { message: `Not found: ${path}` } });
      return;
    }

    sendJson(res, 405, { error: { message: `Method not allowed: ${method}` } });
  }

  private async handleModels(res: http.ServerResponse): Promise<void> {
    const upstreamUrl = buildUpstreamUrl(this.config.targetBaseUrl, "/v1/models");
    const keys = this.config.apiKeys.length > 0 ? this.config.apiKeys : [""];

    for (const key of keys) {
      try {
        const resp = await fetch(upstreamUrl, {
          method: "GET",
          headers: {
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
            ...this.openCodeHeaders(),
          },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          const text = await resp.text();
          const json = JSON.parse(text);
          if (Array.isArray(json?.data) && json.data.length > 0) {
            sendJson(res, 200, json);
            return;
          }
        }
      } catch {
        // Fallback to mock below
      }
    }

    // Mock models fallback
    const mockData = {
      object: "list",
      data: [
        {
          id: this.config.targetModel,
          object: "model",
          created: 1686935000,
          owned_by: "openai",
        },
        ...(this.config.targetModel !== "grok-4.6"
          ? [
              {
                id: "grok-4.6",
                object: "model",
                created: 1686935000,
                owned_by: "xai",
              },
            ]
          : []),
      ],
    };
    sendJson(res, 200, mockData);
  }

  private async handleResponses(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawBody = await readBody(req);
    let payload: Record<string, any> = {};
    try {
      payload = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
    } catch (e) {
      sendJson(res, 400, { error: { message: `Invalid JSON: ${e}` } });
      return;
    }

    const wireApi = normalizeGrokWireApi(this.config.wireApi || "chat");

    if (wireApi === "responses") {
      // Direct Responses forwarding
      await this.forwardDirectResponses(payload, res);
      return;
    }

    if (wireApi === "anthropic" || wireApi === "gemini") {
      // Responses-only CLI input, but the relay speaks Anthropic/Gemini:
      // pivot through OpenAI Chat messages, buffer the upstream response,
      // then render back to the Responses wire format.
      await this.forwardResponsesToBufferedUpstream(payload, wireApi, res);
      return;
    }

    // Translate Responses request to OpenAI Chat Completions request
    const chatPayload = responsesRequestToChat(payload, this.config.targetModel, {
      reasoningEffort: this.config.reasoningEffort,
      maxTokens: this.config.maxTokens,
      maxCompletionTokens: this.config.maxCompletionTokens,
    });

    const wantsStream = Boolean(chatPayload.stream);
    const upstreamUrl = buildUpstreamUrl(this.config.targetBaseUrl, "/v1/chat/completions");
    const keys = this.config.apiKeys.length > 0 ? this.config.apiKeys : [""];

    let upstreamResponse: Response | null = null;
    let lastError: any = null;

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const activeKey = keys[attempt];
      try {
        const response = await fetch(upstreamUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: wantsStream ? "text/event-stream" : "application/json",
            ...(activeKey ? { Authorization: `Bearer ${activeKey}` } : {}),
            ...this.openCodeHeaders(),
          },
          body: JSON.stringify(chatPayload),
        });

        if (response.ok) {
          upstreamResponse = response;
          break;
        }

        const errBody = await response.text().catch(() => "");
        lastError = new Error(`HTTP ${response.status}: ${errBody}`);

        if ([401, 402, 429].includes(response.status) || (response.status >= 500 && response.status <= 599)) {
          if (attempt < keys.length - 1) continue;
        }
        upstreamResponse = response;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < keys.length - 1) continue;
        break;
      }
    }

    if (!upstreamResponse || !upstreamResponse.ok) {
      const statusCode = upstreamResponse?.status ?? 502;
      const msg = lastError instanceof Error ? lastError.message : String(lastError || "Upstream request failed");
      sendJson(res, statusCode, { error: { message: `Chat completions forwarding failed: ${msg}` } });
      return;
    }

    const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() || "";

    if (!contentType.includes("text/event-stream") || !upstreamResponse.body) {
      // Non-streaming response or upstream returned plain JSON
      try {
        const text = await upstreamResponse.text();
        const chatJson = JSON.parse(text);
        if (chatJson.error) {
          sendJson(res, 400, { error: chatJson.error });
          return;
        }
        const responsesJson = chatResponseToResponses(chatJson);
        sendJson(res, 200, responsesJson);
      } catch (e) {
        sendJson(res, 500, { error: { message: `Error translating non-streaming response: ${e}` } });
      }
      return;
    }

    // Streaming SSE translation
    await this.streamChatToResponses(upstreamResponse, res);
  }

  private async streamChatToResponses(upstreamResponse: Response, res: http.ServerResponse): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "close",
    });

    const responseId = `resp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const assistantItemId = `msg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

    sendSseEvent(res, "response.created", {
      type: "response.created",
      response: { id: responseId },
    });

    let messageStarted = false;
    let accumulatedText = "";
    const toolCallsMap = new Map<number, { id: string; name: string; arguments: string; itemId: string }>();
    let usage: any = null;

    try {
      const reader = upstreamResponse.body!.getReader();
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

          const dataVal = trimmed.slice(5).trim();
          if (!dataVal || dataVal === "[DONE]") continue;

          let chunk: any = null;
          try {
            chunk = JSON.parse(dataVal);
          } catch {
            continue;
          }

          if (chunk.usage) {
            usage = chunk.usage;
          }

          const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
          if (choices.length === 0) continue;

          const choice = choices[0] || {};
          const delta = choice.delta || {};

          // Reasoning / thinking delta
          const reasoningDelta = delta.reasoning_content || delta.reasoning || "";
          if (reasoningDelta && typeof reasoningDelta === "string") {
            sendSseEvent(res, "response.output_text.delta", {
              type: "response.output_text.delta",
              delta: reasoningDelta,
            });
          }

          // Content delta
          const contentDelta = delta.content || "";
          if (contentDelta && typeof contentDelta === "string") {
            if (!messageStarted) {
              messageStarted = true;
              sendSseEvent(res, "response.output_item.added", {
                type: "response.output_item.added",
                item: {
                  id: assistantItemId,
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "" }],
                },
              });
            }
            accumulatedText += contentDelta;
            sendSseEvent(res, "response.output_text.delta", {
              type: "response.output_text.delta",
              delta: contentDelta,
            });
          }

          // Tool calls
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = Number(tc.index ?? 0);
              if (!toolCallsMap.has(index)) {
                toolCallsMap.set(index, {
                  id: "",
                  name: "",
                  arguments: "",
                  itemId: `tc_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
                });
              }
              const entry = toolCallsMap.get(index)!;
              if (tc.id) entry.id = tc.id;
              const fn = tc.function || {};
              if (fn.name) entry.name += fn.name;
              if (fn.arguments) entry.arguments += fn.arguments;
            }
          }
        }
      }

      // Finalize tool calls
      const sortedIndices = Array.from(toolCallsMap.keys()).sort((a, b) => a - b);
      for (let outputIndex = 0; outputIndex < sortedIndices.length; outputIndex++) {
        const index = sortedIndices[outputIndex];
        if (index === undefined) continue;
        const tcEntry = toolCallsMap.get(index);
        if (!tcEntry) continue;
        const callId = tcEntry.id || `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
        const name = tcEntry.name || "tool";
        const args = tcEntry.arguments || "{}";
        const itemId = tcEntry.itemId;

        sendSseEvent(res, "response.output_item.added", {
          type: "response.output_item.added",
          output_index: outputIndex,
          item: {
            id: itemId,
            type: "function_call",
            call_id: callId,
            name,
            arguments: "",
          },
        });

        if (args) {
          sendSseEvent(res, "response.function_call_arguments.delta", {
            type: "response.function_call_arguments.delta",
            item_id: itemId,
            output_index: outputIndex,
            delta: args,
          });
          sendSseEvent(res, "response.function_call_arguments.done", {
            type: "response.function_call_arguments.done",
            item_id: itemId,
            output_index: outputIndex,
            arguments: args,
          });
        }

        sendSseEvent(res, "response.output_item.done", {
          type: "response.output_item.done",
          output_index: outputIndex,
          item: {
            id: itemId,
            type: "function_call",
            call_id: callId,
            name,
            arguments: args,
          },
        });
      }

      // Finalize assistant message
      if (messageStarted) {
        sendSseEvent(res, "response.output_text.done", {
          type: "response.output_text.done",
          text: accumulatedText,
        });

        sendSseEvent(res, "response.output_item.done", {
          type: "response.output_item.done",
          item: {
            id: assistantItemId,
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: accumulatedText }],
          },
        });
      }

      const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
      const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
      const totalTokens = usage?.total_tokens ?? (inputTokens + outputTokens);

      sendSseEvent(res, "response.done", {
        type: "response.done",
        response: {
          id: responseId,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: totalTokens,
          },
          status: "completed",
        },
      });

      sendSseEvent(res, "response.completed", {
        type: "response.completed",
        response: {
          id: responseId,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: totalTokens,
          },
          status: "completed",
        },
      });

      res.end();
    } catch (streamErr) {
      if (!res.writableEnded) {
        sendSseEvent(res, "response.failed", {
          type: "response.failed",
          response: {
            id: responseId,
            status: "failed",
            error: { message: streamErr instanceof Error ? streamErr.message : String(streamErr) },
          },
        });
        res.end();
      }
    }
  }

  private async forwardDirectResponses(
    payload: Record<string, any>,
    res: http.ServerResponse
  ): Promise<void> {
    const upstreamUrl = buildUpstreamUrl(this.config.targetBaseUrl, "/v1/responses");
    const wantsStream = Boolean(payload.stream);
    const keys = this.config.apiKeys.length > 0 ? this.config.apiKeys : [""];
    const forwardPayload = { ...payload, model: this.config.targetModel };

    let upstreamResponse: Response | null = null;
    let lastError: any = null;

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const activeKey = keys[attempt];
      try {
        const response = await fetch(upstreamUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: wantsStream ? "text/event-stream" : "application/json",
            ...(activeKey ? { Authorization: `Bearer ${activeKey}` } : {}),
            ...this.openCodeHeaders(),
          },
          body: JSON.stringify(forwardPayload),
        });

        if (response.ok) {
          upstreamResponse = response;
          break;
        }

        const errBody = await response.text().catch(() => "");
        lastError = new Error(`HTTP ${response.status}: ${errBody}`);
        if ([401, 402, 429].includes(response.status) || (response.status >= 500 && response.status <= 599)) {
          if (attempt < keys.length - 1) continue;
        }
        upstreamResponse = response;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < keys.length - 1) continue;
        break;
      }
    }

    if (!upstreamResponse || !upstreamResponse.ok) {
      const statusCode = upstreamResponse?.status ?? 502;
      const msg = lastError instanceof Error ? lastError.message : String(lastError || "Upstream request failed");
      sendJson(res, statusCode, { error: { message: `Forwarding failed: ${msg}` } });
      return;
    }

    const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() || "";
    if (wantsStream && upstreamResponse.body) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "close",
      });
      try {
        const reader = upstreamResponse.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } catch {}
      res.end();
    } else {
      const text = await upstreamResponse.text();
      res.writeHead(200, { "Content-Type": contentType || "application/json", Connection: "close" });
      res.end(text);
    }
  }

  private async handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawBody = await readBody(req);
    let payload: Record<string, any> = {};
    try {
      payload = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
    } catch (e) {
      sendJson(res, 400, { error: { message: `Invalid JSON: ${e}` } });
      return;
    }

    const wireApi = normalizeGrokWireApi(this.config.wireApi || "chat");
    if (wireApi === "responses") {
      // Chat CLI input but the relay only speaks Responses: translate the
      // Chat request to Responses, buffer the upstream answer, and render
      // it back as Chat. This is the responses-only relay path that used
      // to fail with ModelProtocolUnsupported.
      await this.forwardChatToResponsesUpstream(payload, res);
      return;
    }
    if (wireApi === "anthropic" || wireApi === "gemini") {
      await this.forwardChatToBufferedUpstream(payload, wireApi, res);
      return;
    }

    await this.forwardChatToChatUpstream(payload, res);
  }

  private async forwardChatToChatUpstream(payload: Record<string, any>, res: http.ServerResponse): Promise<void> {
    const upstreamUrl = buildUpstreamUrl(this.config.targetBaseUrl, "/v1/chat/completions");
    const wantsStream = Boolean(payload.stream);
    const forwardPayload = { ...payload, model: this.config.targetModel };
    const keys = this.config.apiKeys.length > 0 ? this.config.apiKeys : [""];

    let upstreamResponse: Response | null = null;
    let lastError: any = null;

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const activeKey = keys[attempt];
      try {
        const response = await fetch(upstreamUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: wantsStream ? "text/event-stream" : "application/json",
            ...(activeKey ? { Authorization: `Bearer ${activeKey}` } : {}),
            ...this.openCodeHeaders(),
          },
          body: JSON.stringify(forwardPayload),
        });

        if (response.ok) {
          upstreamResponse = response;
          break;
        }

        const errBody = await response.text().catch(() => "");
        lastError = new Error(`HTTP ${response.status}: ${errBody}`);
        if ([401, 402, 429].includes(response.status) || (response.status >= 500 && response.status <= 599)) {
          if (attempt < keys.length - 1) continue;
        }
        upstreamResponse = response;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < keys.length - 1) continue;
        break;
      }
    }

    if (!upstreamResponse || !upstreamResponse.ok) {
      const statusCode = upstreamResponse?.status ?? 502;
      const msg = lastError instanceof Error ? lastError.message : String(lastError || "Upstream request failed");
      sendJson(res, statusCode, { error: { message: `Chat completions forwarding failed: ${msg}` } });
      return;
    }

    const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() || "";
    if (wantsStream && upstreamResponse.body) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "close",
      });
      try {
        const reader = upstreamResponse.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } catch {}
      res.end();
    } else {
      const text = await upstreamResponse.text();
      res.writeHead(200, { "Content-Type": contentType || "application/json", Connection: "close" });
      res.end(text);
    }
  }

  private upstreamKeys(): string[] {
    return this.config.apiKeys.length > 0 ? this.config.apiKeys : [""];
  }

  private async postUpstreamJson(url: string, body: Record<string, any>, stream: boolean): Promise<{ status: number; json: any; raw: string }> {
    const keys = this.upstreamKeys();
    let lastStatus = 502;
    let lastRaw = "";
    for (const key of keys) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: stream ? "text/event-stream" : "application/json",
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
            ...this.openCodeHeaders(),
          },
          body: JSON.stringify(body),
        });
        const raw = await response.text().catch(() => "");
        if (response.ok) {
          try {
            return { status: response.status, json: raw ? JSON.parse(raw) : {}, raw };
          } catch {
            return { status: response.status, json: {}, raw };
          }
        }
        lastStatus = response.status;
        lastRaw = raw;
        if ([401, 402, 429].includes(response.status) || (response.status >= 500 && response.status <= 599)) {
          continue;
        }
        return { status: response.status, json: this.tryParseJson(raw), raw };
      } catch (err) {
        lastRaw = err instanceof Error ? err.message : String(err);
      }
    }
    return { status: lastStatus, json: this.tryParseJson(lastRaw), raw: lastRaw };
  }

  private tryParseJson(raw: string): any {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return { _raw: raw };
    }
  }

  private upstreamErrorMessage(result: { status: number; json: any; raw: string }): string {
    const err = (result.json as any)?.error;
    const detail = typeof err === "object" ? (err.message || JSON.stringify(err)) : (err || result.raw || `HTTP ${result.status}`);
    return `HTTP ${result.status}: ${detail}`;
  }

  private async forwardChatToResponsesUpstream(payload: Record<string, any>, res: http.ServerResponse): Promise<void> {
    const wantsStream = Boolean(payload.stream);
    const responsesPayload = chatRequestToResponses(payload, this.config.targetModel, {
      reasoningEffort: this.config.reasoningEffort,
      maxTokens: this.config.maxTokens,
      maxCompletionTokens: this.config.maxCompletionTokens,
    });
    // Buffer the upstream Responses answer, then render back as Chat.
    const upstreamUrl = resolveResponsesEndpoint(this.config.targetBaseUrl);
    const result = await this.postUpstreamJson(upstreamUrl, { ...responsesPayload, stream: false }, false);
    if (result.status < 200 || result.status >= 300 || (result.json as any)?.error) {
      sendJson(res, result.status >= 400 && result.status < 600 ? result.status : 502, {
        error: { message: `Chat->Responses forwarding failed: ${this.upstreamErrorMessage(result)}` },
      });
      return;
    }
    const chatJson = responsesResponseToChat(result.json, this.config.targetModel);
    if (!wantsStream) {
      sendJson(res, 200, chatJson);
      return;
    }
    this.emitChatStreamFromComplete(res, chatJson);
  }

  private async forwardChatToBufferedUpstream(
    payload: Record<string, any>,
    wireApi: "anthropic" | "gemini",
    res: http.ServerResponse
  ): Promise<void> {
    const wantsStream = Boolean(payload.stream);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const tools = Array.isArray(payload.tools) ? payload.tools : [];
    const chatJson = await this.fetchBufferedChatFromUpstream(messages, tools, wireApi, {
      maxTokens: payload.max_tokens ?? payload.max_completion_tokens ?? this.config.maxCompletionTokens ?? this.config.maxTokens,
      temperature: payload.temperature,
    });
    if (!chatJson) {
      sendJson(res, 502, { error: { message: `Chat->${wireApi} forwarding failed: upstream request failed` } });
      return;
    }
    if ((chatJson as any).__upstreamError) {
      const { __upstreamError, ...rest } = chatJson as any;
      void rest;
      sendJson(res, (chatJson as any).__status || 502, { error: { message: `Chat->${wireApi} forwarding failed: ${__upstreamError}` } });
      return;
    }
    if (!wantsStream) {
      sendJson(res, 200, chatJson);
      return;
    }
    this.emitChatStreamFromComplete(res, chatJson);
  }

  private async forwardResponsesToBufferedUpstream(
    payload: Record<string, any>,
    wireApi: "anthropic" | "gemini",
    res: http.ServerResponse
  ): Promise<void> {
    const wantsStream = Boolean(payload.stream);
    const chatPayload = responsesRequestToChat(payload, this.config.targetModel, {
      reasoningEffort: this.config.reasoningEffort,
      maxTokens: this.config.maxTokens,
      maxCompletionTokens: this.config.maxCompletionTokens,
    });
    const messages = Array.isArray(chatPayload.messages) ? chatPayload.messages : [];
    const tools = Array.isArray(chatPayload.tools) ? chatPayload.tools : [];
    const chatJson = await this.fetchBufferedChatFromUpstream(messages, tools, wireApi, {
      maxTokens: this.config.maxCompletionTokens ?? this.config.maxTokens,
      temperature: chatPayload.temperature,
    });
    if (!chatJson || (chatJson as any).__upstreamError) {
      const detail = (chatJson as any)?.__upstreamError || "upstream request failed";
      const status = (chatJson as any)?.__status || 502;
      sendJson(res, status, { error: { message: `Responses->${wireApi} forwarding failed: ${detail}` } });
      return;
    }
    const responsesJson = chatResponseToResponses(chatJson);
    if (!wantsStream) {
      sendJson(res, 200, responsesJson);
      return;
    }
    await this.streamChatToResponsesFromComplete(responsesJson, res);
  }

  private async fetchBufferedChatFromUpstream(
    messages: any[],
    tools: any[],
    wireApi: "anthropic" | "gemini",
    options: { maxTokens?: number; temperature?: number } = {}
  ): Promise<Record<string, any> | null> {
    if (wireApi === "anthropic") {
      const body = openAiMessagesToAnthropicPayload(messages, tools, this.config.targetModel, options);
      const url = resolveAnthropicEndpoint(this.config.targetBaseUrl);
      const result = await this.postUpstreamJson(url, body, false);
      if (result.status < 200 || result.status >= 300 || (result.json as any)?.error) {
        return { __upstreamError: this.upstreamErrorMessage(result), __status: result.status } as any;
      }
      return anthropicResponseToChat(result.json, this.config.targetModel);
    }
    const body = openAiMessagesToGeminiPayload(messages, tools, this.config.targetModel);
    const url = resolveGeminiGenerateEndpoint(this.config.targetBaseUrl, this.config.targetModel);
    const result = await this.postUpstreamJson(url, body, false);
    if (result.status < 200 || result.status >= 300 || (result.json as any)?.error) {
      return { __upstreamError: this.upstreamErrorMessage(result), __status: result.status } as any;
    }
    return geminiResponseToChat(result.json, this.config.targetModel);
  }

  private emitChatStreamFromComplete(res: http.ServerResponse, chatJson: Record<string, any>): void {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "close" });
    const choice = (Array.isArray(chatJson.choices) ? chatJson.choices[0] : {}) || {};
    const message = choice.message || {};
    const id = chatJson.id || `chatcmpl_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const model = chatJson.model || this.config.targetModel;
    const base: Record<string, any> = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
    const reasoning = message.reasoning_content || message.reasoning || "";
    if (reasoning) {
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }] })}\n\n`);
    }
    const content = typeof message.content === "string" ? message.content : "";
    if (content) {
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`);
    }
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    toolCalls.forEach((tc: any, index: number) => {
      res.write(`data: ${JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: { tool_calls: [{ index, id: tc.id, type: "function", function: tc.function }] }, finish_reason: null }],
      })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop" }] })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }

   private async streamChatToResponsesFromComplete(responsesJson: Record<string, any>, res: http.ServerResponse): Promise<void> {
     const chatJson = { choices: [{ message: { content: responsesJson.output_text || "", tool_calls: [] } }] };
     void chatJson;
     res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "close" });
     const responseId = (responsesJson as any).id || `resp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
     sendSseEvent(res, "response.created", { type: "response.created", response: { id: responseId } });
     const output = Array.isArray((responsesJson as any).output) ? (responsesJson as any).output : [];
     let outputIndex = 0;
     for (const item of output) {
       if (!item || typeof item !== "object") continue;
       if (item.type === "message") {
         const parts = Array.isArray(item.content) ? item.content : [];
         const text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
         if (!text) continue;
         const itemId = item.id || `msg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
         sendSseEvent(res, "response.output_item.added", {
           type: "response.output_item.added",
           output_index: outputIndex,
           item: { id: itemId, type: "message", role: "assistant", content: [{ type: "output_text", text: "" }] },
         });
         sendSseEvent(res, "response.output_text.delta", { type: "response.output_text.delta", output_index: outputIndex, delta: text });
         sendSseEvent(res, "response.output_text.done", { type: "response.output_text.done", output_index: outputIndex, text });
         sendSseEvent(res, "response.output_item.done", {
           type: "response.output_item.done",
           output_index: outputIndex,
           item: { id: itemId, type: "message", role: "assistant", content: [{ type: "output_text", text }] },
         });
         outputIndex += 1;
       } else if (item.type === "function_call") {
         const itemId = item.id || `tc_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
         const args = typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {});
         sendSseEvent(res, "response.output_item.added", {
           type: "response.output_item.added",
           output_index: outputIndex,
           item: { id: itemId, type: "function_call", call_id: item.call_id || itemId, name: item.name || "tool", arguments: "" },
         });
         if (args) {
           sendSseEvent(res, "response.function_call_arguments.delta", {
             type: "response.function_call_arguments.delta",
             item_id: itemId,
             output_index: outputIndex,
             delta: args,
           });
           sendSseEvent(res, "response.function_call_arguments.done", {
             type: "response.function_call_arguments.done",
             item_id: itemId,
             output_index: outputIndex,
             arguments: args,
           });
         }
         sendSseEvent(res, "response.output_item.done", {
           type: "response.output_item.done",
           output_index: outputIndex,
           item: { id: itemId, type: "function_call", call_id: item.call_id || itemId, name: item.name || "tool", arguments: args },
         });
         outputIndex += 1;
       }
     }
     const usage = (responsesJson as any).usage || {};
     sendSseEvent(res, "response.completed", {
       type: "response.completed",
       response: { id: responseId, status: "completed", usage },
     });
     res.end();
   }
 }

/* ------------------------------------------------------------------ *
 * Helper functions
 * ------------------------------------------------------------------ */

function sendJson(res: http.ServerResponse, status: number, data: any): void {
  const jsonBuf = Buffer.from(JSON.stringify(data, null, 2), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(jsonBuf.length),
    Connection: "close",
  });
  res.end(jsonBuf);
}

function sendSseEvent(res: http.ServerResponse, event: string, data: any): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendGrokError(res: http.ServerResponse, message: string, statusCode = 500): void {
  try {
    if (!res.headersSent) {
      sendJson(res, statusCode, { error: { message } });
      return;
    }
    sendSseEvent(res, "response.failed", {
      type: "response.failed",
      response: {
        status: "failed",
        error: { message },
      },
    });
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
