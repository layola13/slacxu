import type { JsonValue } from "@codex-ui/shared";

/**
 * Narrow type definitions for the Claude Code stream-json protocol.
 * These are intentionally minimal — they cover only the message shapes
 * the projector needs to inspect. Unknown fields are ignored.
 *
 * Reference: E:\projects\codecli\src\entrypoints\sdk\coreSchemas.ts
 *            E:\projects\codecli\src\entrypoints\sdk\controlSchemas.ts
 */

export interface ClaudeSystemInitMessage {
  type: "system";
  subtype: "init";
  session_id: string;
  claude_code_version: string;
  cwd: string;
  model: string;
  permissionMode: string;
  tools: string[];
}

export interface ClaudeAssistantMessage {
  type: "assistant";
  session_id: string;
  uuid?: string;
  parent_tool_use_id: string | null;
  message: {
    id?: string;
    role: "assistant";
    content: ClaudeContentBlock[];
  };
  error?: { type: string; message: string };
}

export interface ClaudeUserMessage {
  type: "user";
  session_id?: string;
  uuid?: string;
  parent_tool_use_id: string | null;
  message: {
    role: "user";
    content: unknown;
  };
}

export interface ClaudeResultMessage {
  type: "result";
  subtype: "success" | "error_during_execution" | "error_max_turns" | "error_max_budget_usd" | "error_max_structured_output_retries";
  session_id: string;
  uuid?: string;
  is_error: boolean;
  result?: string;
  errors?: string[];
  duration_ms: number;
  total_cost_usd: number;
  num_turns: number;
}

export interface ClaudeStreamEventMessage {
  type: "stream_event";
  session_id: string;
  uuid?: string;
  parent_tool_use_id: string | null;
  event: {
    type: string;
    content_block?: { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown };
    delta?: { type: string; text?: string; thinking?: string; partial_json?: string };
    index?: number;
    message?: { id?: string; model?: string };
  };
}

export interface ClaudeControlRequestMessage {
  type: "control_request";
  request_id: string;
  session_id?: string;
  request: {
    subtype: "can_use_tool" | "interrupt" | "set_permission_mode" | "set_model" | "set_max_thinking_tokens";
    model?: string;
    max_thinking_tokens?: number | null;
    tool_name?: string;
    tool_use_id?: string;
    input?: Record<string, unknown>;
    title?: string;
    description?: string;
    display_name?: string;
    decision_reason?: string;
  };
}

export interface ClaudeControlResponseMessage {
  type: "control_response";
  request_id?: string;
  response: {
    subtype: "success" | "error";
    request_id: string;
    response?: Record<string, unknown>;
    error?: string;
  };
}

export interface ClaudeStreamlinedTextMessage {
  type: "streamlined_text";
  session_id: string;
  uuid?: string;
  text: string;
}

export type ClaudeMessage =
  | ClaudeSystemInitMessage
  | ClaudeAssistantMessage
  | ClaudeUserMessage
  | ClaudeResultMessage
  | ClaudeStreamEventMessage
  | ClaudeControlRequestMessage
  | ClaudeControlResponseMessage
  | ClaudeStreamlinedTextMessage
  | { type: string; session_id?: string; [key: string]: unknown };

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown }
  | { type: "thinking"; thinking: string }
  | { type: string; [key: string]: unknown };

/**
 * Parse a raw NDJSON line into a typed Claude message.
 * Returns null for unparseable lines.
 */
export function parseClaudeMessage(line: string): ClaudeMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed) as ClaudeMessage;
  } catch {
    return null;
  }
}

/**
 * Extract the session_id from any Claude message.
 */
export function extractSessionId(message: ClaudeMessage): string | undefined {
  return typeof (message as { session_id?: unknown }).session_id === "string"
    ? (message as { session_id: string }).session_id
    : undefined;
}

/**
 * Correct control_response structure for Claude Code 2.x.
 * The response object wraps subtype, request_id, and an optional response field.
 */
export function buildControlResponse(
  requestId: string,
  allowed: boolean,
  denyReason?: string
): JsonValue {
  if (!allowed) {
    return {
      type: "control_response",
      response: {
        subtype: "error",
        request_id: requestId,
        error: denyReason ?? "Permission denied by user"
      }
    } as JsonValue;
  }
  return {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: { behavior: "allow" }
    }
  } as JsonValue;
}

/**
 * Build a control_request to interrupt the current turn.
 */
export function buildInterruptRequest(requestId: string): JsonValue {
  return {
    type: "control_request",
    request_id: requestId,
    request: { subtype: "interrupt" }
  } as JsonValue;
}
