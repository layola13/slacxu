/**
 * Protocol framing and parsing for the Antigravity CLI (`agy.exe`) stream-json mode.
 *
 * Ground truth is based on live NDJSON probes over Stdio:
 * - Event "init": Initial session handshake, conversation_id, tools, cwd.
 * - Event "step_update": Incremental turns, agent text deltas, thinking tokens, tool calls.
 * - Event "result": Final turn outcome, total usage and status.
 */

export interface AgyUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

export interface AgyToolCall {
  name: string;
  input?: Record<string, unknown>;
  id?: string;
  args?: Record<string, unknown>;
  toolAction?: string;
  toolSummary?: string;
}

export interface AgyQuestionItem {
  id?: string;
  header?: string;
  question: string;
  options?: Array<string | { label: string; description?: string }>;
  is_multi_select?: boolean;
}

export interface AgyInitEvent {
  event: "init";
  conversation_id: string;
  init: {
    cwd: string;
    tools?: string[];
    permission_mode?: string;
  };
}

export interface AgyStepUpdateEvent {
  event: "step_update";
  step_update: {
    conversation_id?: string;
    step_index: number;
    state?: "RUNNING" | "DONE" | "ERROR";
    step_type: "user_input" | "agent_response" | "tool_calls" | "planner_response" | string;
    text_delta?: string;
    thinking_delta?: string;
    tool_calls?: AgyToolCall[];
    duration_seconds?: number;
    usage?: AgyUsage;
    toolAction?: string;
    toolSummary?: string;
    content?: string;
    type?: string;
  };
}

export interface AgyResultEvent {
  event: "result";
  result: {
    conversation_id: string;
    status: "SUCCESS" | "ERROR" | string;
    response?: string;
    duration_seconds?: number;
    num_turns?: number;
    usage?: AgyUsage;
    error?: string;
  };
}

export type AgyEvent = AgyInitEvent | AgyStepUpdateEvent | AgyResultEvent | { event: string; [key: string]: unknown };

/**
 * Parse one line of NDJSON from agy.exe stdout.
 * Returns null if the line is empty, malformed, or non-JSON.
 */
export function parseAgyLine(line: string): AgyEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && "event" in parsed) {
      return parsed as AgyEvent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a stream-json user input line to send to agy.exe over stdin.
 */
export function buildAgyPromptInput(prompt: string): string {
  return JSON.stringify({
    event: "user",
    message: {
      content: prompt,
    },
  }) + "\n";
}
