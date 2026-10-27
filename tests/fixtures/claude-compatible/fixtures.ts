import type { ClaudeMessage } from "../../../backends/claude/src/runtime/claudeCompatibleProtocol.js";

/**
 * Fixture: A complete successful turn.
 * system/init -> assistant text -> result success
 */
export const FIXTURE_COMPLETE_TURN: ClaudeMessage[] = [
  {
    type: "system",
    subtype: "init",
    session_id: "sess-abc-123",
    claude_code_version: "2.1.222",
    cwd: "/home/user/project",
    model: "claude-sonnet-4-20250514",
    permissionMode: "default",
    tools: ["Read", "Write", "Bash"]
  },
  {
    type: "assistant",
    session_id: "sess-abc-123",
    uuid: "msg-001",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Hello! How can I help you?" }
      ]
    }
  },
  {
    type: "result",
    subtype: "success",
    session_id: "sess-abc-123",
    uuid: "result-001",
    is_error: false,
    result: "Hello! How can I help you?",
    duration_ms: 1000,
    total_cost_usd: 0.001,
    num_turns: 1
  }
];

/**
 * Fixture: A turn with a tool call and tool result.
 */
export const FIXTURE_TOOL_TURN: ClaudeMessage[] = [
  {
    type: "system",
    subtype: "init",
    session_id: "sess-tool-456",
    claude_code_version: "2.1.222",
    cwd: "/home/user/project",
    model: "claude-sonnet-4-20250514",
    permissionMode: "default",
    tools: ["Read", "Write", "Bash"]
  },
  {
    type: "assistant",
    session_id: "sess-tool-456",
    uuid: "msg-tool-001",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Let me read that file." },
        { type: "tool_use", id: "tool-001", name: "Read", input: { file_path: "/tmp/test.txt" } }
      ]
    }
  },
  {
    type: "user",
    session_id: "sess-tool-456",
    uuid: "msg-tool-result",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tool-001", content: "File contents here" }
      ]
    }
  },
  {
    type: "result",
    subtype: "success",
    session_id: "sess-tool-456",
    uuid: "result-tool",
    is_error: false,
    result: "I read the file successfully.",
    duration_ms: 2000,
    total_cost_usd: 0.002,
    num_turns: 1
  }
];

/**
 * Fixture: A failed turn (error during execution).
 */
export const FIXTURE_FAILED_TURN: ClaudeMessage[] = [
  {
    type: "system",
    subtype: "init",
    session_id: "sess-fail-789",
    claude_code_version: "2.1.222",
    cwd: "/home/user/project",
    model: "claude-sonnet-4-20250514",
    permissionMode: "default",
    tools: ["Read", "Write", "Bash"]
  },
  {
    type: "assistant",
    session_id: "sess-fail-789",
    uuid: "msg-fail-001",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Attempting operation..." }
      ]
    }
  },
  {
    type: "result",
    subtype: "error_during_execution",
    session_id: "sess-fail-789",
    uuid: "result-fail",
    is_error: true,
    errors: ["API rate limit exceeded"],
    duration_ms: 500,
    total_cost_usd: 0.001,
    num_turns: 1
  }
];

/**
 * Fixture: A turn with streaming events (partial messages).
 */
export const FIXTURE_STREAMING_TURN: ClaudeMessage[] = [
  {
    type: "system",
    subtype: "init",
    session_id: "sess-stream-000",
    claude_code_version: "2.1.222",
    cwd: "/home/user/project",
    model: "claude-sonnet-4-20250514",
    permissionMode: "default",
    tools: ["Read", "Write", "Bash"]
  },
  {
    type: "stream_event",
    session_id: "sess-stream-000",
    uuid: "stream-001",
    parent_tool_use_id: null,
    event: {
      type: "content_block_start",
      content_block: { type: "text", text: "Hello" }
    }
  },
  {
    type: "stream_event",
    session_id: "sess-stream-000",
    uuid: "stream-001",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text: " world" }
    }
  },
  {
    type: "result",
    subtype: "success",
    session_id: "sess-stream-000",
    uuid: "result-stream",
    is_error: false,
    result: "Hello world",
    duration_ms: 100,
    total_cost_usd: 0.001,
    num_turns: 1
  }
];

/**
 * Fixture: A turn with a permission request.
 */
export const FIXTURE_PERMISSION_TURN: ClaudeMessage[] = [
  {
    type: "system",
    subtype: "init",
    session_id: "sess-perm-111",
    claude_code_version: "2.1.222",
    cwd: "/home/user/project",
    model: "claude-sonnet-4-20250514",
    permissionMode: "default",
    tools: ["Read", "Write", "Bash"]
  },
  {
    type: "control_request",
    request_id: "req-perm-001",
    session_id: "sess-perm-111",
    request: {
      subtype: "can_use_tool",
      tool_name: "Bash",
      tool_use_id: "tool-perm-001",
      input: { command: "rm -rf /tmp/test" },
      title: "Run bash command",
      description: "Execute: rm -rf /tmp/test"
    }
  }
];

/**
 * Fixture: A duplicate result message (idempotency test).
 */
export const FIXTURE_DUPLICATE_RESULT: ClaudeMessage[] = [
  {
    type: "system",
    subtype: "init",
    session_id: "sess-dup-222",
    claude_code_version: "2.1.222",
    cwd: "/home/user/project",
    model: "claude-sonnet-4-20250514",
    permissionMode: "default",
    tools: ["Read"]
  },
  {
    type: "assistant",
    session_id: "sess-dup-222",
    uuid: "msg-dup-001",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Response" }
      ]
    }
  },
  {
    type: "result",
    subtype: "success",
    session_id: "sess-dup-222",
    uuid: "result-dup-001",
    is_error: false,
    result: "Response",
    duration_ms: 100,
    total_cost_usd: 0.001,
    num_turns: 1
  },
  // Duplicate result - should be ignored
  {
    type: "result",
    subtype: "success",
    session_id: "sess-dup-222",
    uuid: "result-dup-001",
    is_error: false,
    result: "Response",
    duration_ms: 100,
    total_cost_usd: 0.001,
    num_turns: 1
  }
];

/**
 * Fixture: An unknown message type.
 */
export const FIXTURE_UNKNOWN_EVENT: ClaudeMessage[] = [
  {
    type: "unknown_future_type",
    session_id: "sess-unk-333",
    data: { foo: "bar" }
  }
];

/**
 * Fixture: Process exit scenario — no result message received.
 */
export const FIXTURE_PROCESS_EXIT: ClaudeMessage[] = [
  {
    type: "system",
    subtype: "init",
    session_id: "sess-exit-444",
    claude_code_version: "2.1.222",
    cwd: "/home/user/project",
    model: "claude-sonnet-4-20250514",
    permissionMode: "default",
    tools: ["Read"]
  },
  {
    type: "assistant",
    session_id: "sess-exit-444",
    uuid: "msg-exit-001",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Working on it..." }
      ]
    }
  }
  // No result message — process exits unexpectedly
];
