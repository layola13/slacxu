/**
 * Pi Agent RPC protocol types and message framing.
 * Reference: E:\projects\pi\packages\coding-agent\src\modes\rpc\rpc-types.ts
 */

// ============================================================================
// Commands (stdin)
// ============================================================================

export type PiRpcCommand =
  | { id?: string; type: "prompt"; message: string; images?: unknown[]; streamingBehavior?: "steer" | "followUp" }
  | { id?: string; type: "steer"; message: string; images?: unknown[] }
  | { id?: string; type: "follow_up"; message: string; images?: unknown[] }
  | { id?: string; type: "abort" }
  | { id?: string; type: "new_session"; parentSession?: string }
  | { id?: string; type: "get_state" }
  | { id?: string; type: "set_model"; provider: string; modelId: string }
  | { id?: string; type: "get_available_models" }
  | { id?: string; type: "set_thinking_level"; level: string }
  | { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
  | { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
  | { id?: string; type: "compact"; customInstructions?: string }
  | { id?: string; type: "set_auto_retry"; enabled: boolean }
  | { id?: string; type: "get_messages" }
  | { id?: string; type: "get_session_stats" }
  | { id?: string; type: string; [key: string]: unknown };

// ============================================================================
// Responses (stdout)
// ============================================================================

export interface PiRpcResponseSuccess {
  id?: string;
  type: "response";
  command: string;
  success: true;
  data?: unknown;
}

export interface PiRpcResponseError {
  id?: string;
  type: "response";
  command: string;
  success: false;
  error: string;
}

export type PiRpcResponse = PiRpcResponseSuccess | PiRpcResponseError;

// ============================================================================
// Extension UI Requests & Responses
// ============================================================================

export interface PiRpcExtensionUIRequest {
  type: "extension_ui_request";
  id: string;
  method: "select" | "confirm" | "input" | "editor" | "notify" | "setStatus" | "setWidget" | "setTitle" | string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  timeout?: number;
  [key: string]: unknown;
}

export type PiRpcExtensionUIResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

// ============================================================================
// Session Events (stdout)
// ============================================================================

export interface PiRpcMessageContent {
  type: "text" | "thinking" | "toolCall" | string;
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  [key: string]: unknown;
}

export interface PiRpcAssistantMessageEvent {
  type:
    | "thinking_start"
    | "thinking_delta"
    | "thinking_end"
    | "text_start"
    | "text_delta"
    | "text_end"
    | "toolcall_start"
    | "toolcall_delta"
    | "toolcall_end"
    | string;
  contentIndex?: number;
  delta?: string;
  content?: string;
  id?: string;
  toolName?: string;
  name?: string;
  arguments?: unknown;
  toolCall?: unknown;
  partial?: unknown;
  [key: string]: unknown;
}

export interface PiRpcUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface PiRpcSessionMessage {
  role?: "user" | "assistant" | "system" | "tool" | "toolResult" | "custom" | string;
  content?: PiRpcMessageContent[] | string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  api?: string;
  provider?: string;
  model?: string;
  usage?: PiRpcUsage;
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export type PiRpcEvent =
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "message_start"; message: PiRpcSessionMessage }
  | { type: "message_update"; assistantMessageEvent: PiRpcAssistantMessageEvent }
  | { type: "message_end"; message: PiRpcSessionMessage }
  | { type: "turn_end"; message?: PiRpcSessionMessage }
  | { type: "agent_end"; messages?: PiRpcSessionMessage[] }
  | { type: "agent_settled" }
  | { type: string; [key: string]: unknown };

export type PiRpcIncomingMessage =
  | PiRpcResponse
  | PiRpcExtensionUIRequest
  | PiRpcEvent;

// ============================================================================
// Framing & Sanitization
// ============================================================================

/**
 * Strict newline-delimited framing buffer.
 * Does not use readline; preserves surrogate pairs and UTF-8 stream boundaries.
 */
export class PiLineFramingBuffer {
  private buffer = "";

  /**
   * Append a chunk of UTF-8 text and extract all complete lines.
   */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx: number;

    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      lines.push(line);
    }

    return lines;
  }

  /**
   * Clear any remaining buffered text.
   */
  clear(): void {
    this.buffer = "";
  }

  /**
   * Return any incomplete buffered text.
   */
  get remaining(): string {
    return this.buffer;
  }
}

/**
 * Parse a single JSON line from Pi stdout.
 * Returns null if the line is not valid JSON. Unknown types pass through safely.
 */
export function parsePiRpcLine(line: string): PiRpcIncomingMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return parsed as PiRpcIncomingMessage;
    }
  } catch {
    // Malformed JSON
  }
  return null;
}

/**
 * Serialize a command to a newline-terminated JSON string.
 */
export function formatPiRpcCommand(cmd: PiRpcCommand): string {
  return JSON.stringify(cmd) + "\n";
}

/**
 * Serialize an extension UI response to a newline-terminated JSON string.
 */
export function formatPiExtensionUIResponse(res: PiRpcExtensionUIResponse): string {
  return JSON.stringify(res) + "\n";
}

/**
 * Sanitize secrets (API keys, Authorization headers, tokens) from logs and error messages.
 */
export function sanitizePiRpcText(text: string): string {
  return text
    .replace(/(sk-[a-zA-Z0-9_\-]{8,})/g, "sk-***")
    .replace(/(Bearer\s+)[a-zA-Z0-9_\-\.]{8,}/gi, "$1***")
    .replace(/(api[_-]?key["':\s]+)[a-zA-Z0-9_\-]{8,}/gi, "$1***");
}
