// Port of E:\projects\duck2api\typings\official\response.go (chat half).
// Fixed IDs and extra fields are byte-compatible with the Go output.

export const CHATCMPL_ID = "chatcmpl-QXlha2FBbmROaXhpZUFyZUF3ZXNvbWUK";

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  index?: number;
  id: string;
  type: string;
  function: ToolCallFunction;
}

interface Delta {
  content?: string;
  role?: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
}

interface ChunkChoice {
  index: number;
  delta?: Delta;
  finish_reason?: string | null;
}

export interface ChatChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChunkChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  timing?: { ttft_ms?: number; total_ms?: number };
  reasoning_effort?: string;
}

function baseChunk(model: string): ChatChunk {
  return { id: CHATCMPL_ID, object: "chat.completion.chunk", created: 0, model, choices: [] };
}

export function textChunkWithModel(text: string, model: string): ChatChunk {
  const c = baseChunk(model);
  c.choices = [{ index: 0, delta: { content: text }, finish_reason: null }];
  return c;
}

export function reasoningChunkWithModel(text: string, model: string): ChatChunk {
  const c = baseChunk(model);
  c.choices = [{ index: 0, delta: { reasoning_content: text }, finish_reason: null }];
  return c;
}

export function toolCallChunkWithModel(call: ToolCall, model: string, index = 0): ChatChunk {
  const c = baseChunk(model);
  c.id = "chatcmpl-playgame";
  const toolCall = call.index !== undefined ? call : { index, ...call };
  c.choices = [{ index: 0, delta: { tool_calls: [toolCall] } }];
  return c;
}

export function stopChunkWithModel(reason: string, model: string): ChatChunk {
  const c = baseChunk(model);
  c.choices = [{ index: 0, finish_reason: reason }];
  return c;
}

export function usageChunk(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number,
  ttftMs: number,
  totalMs: number,
  effort: string,
): ChatChunk {
  const c = baseChunk(model);
  c.usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    ...(cachedTokens > 0 ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {}),
  };
  c.timing = { ttft_ms: ttftMs, total_ms: totalMs };
  c.reasoning_effort = effort;
  return c;
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
  choices: Array<{
    index: number;
    message: { role: string; content: string; tool_calls?: ToolCall[] };
    finish_reason?: string | null;
  }>;
  timing?: { ttft_ms?: number; total_ms?: number };
  reasoning_effort?: string;
}

export function newChatCompletionFull(
  text: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number,
  ttftMs: number,
  totalMs: number,
  effort: string,
  toolCalls: ToolCall[] = [],
): ChatCompletion {
  return {
    id: CHATCMPL_ID,
    object: "chat.completion",
    created: 0,
    model,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      ...(cachedTokens > 0 ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {}),
    },
    timing: { ttft_ms: ttftMs, total_ms: totalMs },
    reasoning_effort: effort,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        ...(toolCalls.length > 0 ? { finish_reason: "tool_calls" } : {}),
      },
    ],
  };
}

/** Upstream duck.ai SSE event (typings/duckgo/response.go ApiResponse). */
export interface UpstreamEvent {
  message?: string;
  action?: string;
  model?: string;
  role?: string;
  state?: string;
  text?: string;
  id?: string;
  partIndex?: number;
  toolName?: string;
  toolCallId?: string;
  toolArguments?: string;
  result?: string;
  parts?: UpstreamImagePart[];
  data?: UpstreamImageData | null;
  summaryText?: string[];
  encryptedText?: string;
}

export interface UpstreamImagePart {
  type?: string;
  result?: string;
  format?: string;
  width?: number;
  height?: number;
  data?: UpstreamImageData | null;
}

export interface UpstreamImageData {
  b64Image?: string;
  format?: string;
  width?: number;
  height?: number;
  status?: string;
  title?: string;
  type?: string;
}
