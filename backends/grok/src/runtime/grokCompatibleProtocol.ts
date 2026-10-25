/**
 * Protocol framing and parsing for Grok CLI (`grok.exe`) streaming-json mode.
 *
 * Ground truth is based on live NDJSON probes over Stdio:
 * - Event "available_commands": Available tools and slash commands.
 * - Event "thought": Incremental reasoning/thinking token chunks.
 * - Event "text": Incremental agent message text chunks.
 * - Event "tool_call": Tool call start (toolCallId, toolName, kind, status, rawInput).
 * - Event "tool_call_update": Tool call progress / completion (toolCallId, status, rawOutput).
 * - Event "usage": Token usage for model response.
 * - Event "end": Final turn outcome with sessionId, stopReason, full usage and modelUsage.
 * - Event "error": Error during execution.
 */

export interface GrokUsage {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  total_tokens?: number;
}

export interface GrokThoughtEvent {
  type: "thought";
  data: string;
}

export interface GrokTextEvent {
  type: "text";
  data: string;
}

export interface GrokToolCallEvent {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: Record<string, unknown>;
  content?: unknown[];
  locations?: unknown[];
}

export interface GrokToolCallUpdateEvent {
  type: "tool_call_update";
  toolCallId: string;
  status?: "completed" | "failed" | string;
  rawOutput?: Record<string, unknown>;
  content?: unknown[];
  locations?: unknown[];
}

export interface GrokUsageEvent {
  type: "usage";
  messageId?: string;
  stopReason?: string;
  signature?: string;
  usage?: GrokUsage;
}

export interface GrokEndEvent {
  type: "end";
  stopReason: string;
  sessionId: string;
  requestId?: string;
  usage?: GrokUsage;
  num_turns?: number;
  total_cost_usd?: number;
  total_cost_usd_ticks?: number;
  modelUsage?: Record<string, unknown>;
}

export interface GrokErrorEvent {
  type: "error";
  message: string;
}

export interface GrokAvailableCommandsEvent {
  type: "available_commands";
  tools: string[];
  commands: string[];
}

export type GrokEvent =
  | GrokThoughtEvent
  | GrokTextEvent
  | GrokToolCallEvent
  | GrokToolCallUpdateEvent
  | GrokUsageEvent
  | GrokEndEvent
  | GrokErrorEvent
  | GrokAvailableCommandsEvent
  | { type: string; [key: string]: unknown };

/**
 * Parse one line of NDJSON from grok.exe stdout.
 * Returns null if the line is empty, malformed, or non-JSON.
 */
export function parseGrokLine(line: string): GrokEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
      return parsed as GrokEvent;
    }
    return null;
  } catch {
    return null;
  }
}
