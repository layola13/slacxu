import { expect, test } from "bun:test";
import { createProjectorContext, projectMessage, forceTerminate, markInterrupted, toNotification } from "../../backends/claude/src/runtime/claudeCompatibleTurnProjector";
import { buildControlResponse, buildInterruptRequest, parseClaudeMessage } from "../../backends/claude/src/runtime/claudeCompatibleProtocol";
import {
  FIXTURE_COMPLETE_TURN,
  FIXTURE_TOOL_TURN,
  FIXTURE_FAILED_TURN,
  FIXTURE_STREAMING_TURN,
  FIXTURE_PERMISSION_TURN,
  FIXTURE_DUPLICATE_RESULT,
  FIXTURE_UNKNOWN_EVENT,
  FIXTURE_PROCESS_EXIT
} from "../fixtures/claude-compatible/fixtures";

const THREAD_ID = "thread-test-001";
const TURN_ID = "turn-test-001";

function projectFixture(messages: ReturnType<typeof Array.of<typeof FIXTURE_COMPLETE_TURN[0]>>) {
  const ctx = createProjectorContext(THREAD_ID, TURN_ID);
  const events = [];
  for (const msg of messages) {
    events.push(...projectMessage(msg, ctx));
  }
  return { ctx, events };
}

test("complete turn: init, assistant text, and result produce terminal completed", () => {
  const { ctx, events } = projectFixture(FIXTURE_COMPLETE_TURN);

  const kinds = events.map(e => e.kind);
  expect(kinds).toContain("system/init");
  expect(kinds).toContain("item/completed");
  expect(kinds).toContain("turn/completed");

  const terminalEvents = kinds.filter(k => k === "turn/completed" || k === "turn/failed");
  expect(terminalEvents.length).toBe(1);

  const assistantItems = events.filter(e => e.kind === "item/completed" && e.item.type === "agentMessage");
  expect(assistantItems.length).toBe(1);
  expect(assistantItems[0].item.content).toBe("Hello! How can I help you?");

  expect(ctx.turn.status).toBe("completed");
});

test("tool turn: assistant tool_use and user tool_result produce tool items", () => {
  const { events } = projectFixture(FIXTURE_TOOL_TURN);

  const kinds = events.map(e => e.kind);
  expect(kinds).toContain("item/completed");

  const startedTool = events.find(e => e.kind === "item/started" && e.item.type === "toolCall");
  const completedTool = events.find(e => e.kind === "item/completed" && e.item.type === "toolCall");
  expect(startedTool?.item).toMatchObject({ id: "tool-001", toolName: "Read", status: "inProgress" });
  expect(completedTool?.item).toMatchObject({ id: "tool-001", toolName: "Read", status: "completed" });
  expect(completedTool?.item.result).toEqual({ content: "File contents here" });

  const terminal = events.filter(e => e.kind === "turn/completed");
  expect(terminal.length).toBe(1);
});

test("failed turn: error result produces turn/failed terminal", () => {
  const { ctx, events } = projectFixture(FIXTURE_FAILED_TURN);

  const failed = events.filter(e => e.kind === "turn/failed");
  expect(failed.length).toBe(1);
  expect(failed[0].error).toBe("API rate limit exceeded");
  expect(ctx.turn.status).toBe("failed");
});

test("streaming turn: partial messages produce delta events with string delta", () => {
  const { events } = projectFixture(FIXTURE_STREAMING_TURN);

  const deltas = events.filter(e => e.kind === "item/agentMessage/delta");
  expect(deltas.length).toBeGreaterThanOrEqual(1);
  for (const delta of deltas) {
    expect(typeof delta.delta).toBe("string");
    expect(delta.turnId).toBe(TURN_ID);
    expect(delta.itemId).toBeTruthy();
  }
});

test("streaming turn: Claude event UUID changes still stay in one assistant item", () => {
  const ctx = createProjectorContext(THREAD_ID, TURN_ID);
  const messages = [
    {
      type: "stream_event",
      session_id: "session-stable-stream",
      uuid: "event-1",
      parent_tool_use_id: null,
      event: { type: "message_start", message: { id: "message-1" } }
    },
    {
      type: "stream_event",
      session_id: "session-stable-stream",
      uuid: "event-2",
      parent_tool_use_id: null,
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "功能" } }
    },
    {
      type: "stream_event",
      session_id: "session-stable-stream",
      uuid: "event-3",
      parent_tool_use_id: null,
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "**" } }
    },
    {
      type: "result",
      subtype: "success",
      session_id: "session-stable-stream",
      is_error: false,
      result: "功能**"
    }
  ] as const;
  const events = messages.flatMap((message) => projectMessage(message, ctx));
  const deltas = events.filter((event) => event.kind === "item/agentMessage/delta");
  const completed = events.filter((event) => event.kind === "item/completed" && event.item.type === "agentMessage");

  expect(new Set(deltas.map((event) => event.itemId)).size).toBe(1);
  expect(completed).toHaveLength(1);
  expect(completed[0]?.item.content).toBe("功能**");
});

test("streaming turn: text and thinking blocks keep separate stable items", () => {
  const ctx = createProjectorContext(THREAD_ID, TURN_ID);
  const messages = [
    {
      type: "stream_event",
      session_id: "session-thinking-stream",
      uuid: "event-start",
      event: { type: "message_start", message: { id: "message-thinking" } }
    },
    {
      type: "stream_event",
      session_id: "session-thinking-stream",
      uuid: "event-thinking-start",
      event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "检查" } }
    },
    {
      type: "stream_event",
      session_id: "session-thinking-stream",
      uuid: "event-thinking-delta",
      event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "协议" } }
    },
    {
      type: "stream_event",
      session_id: "session-thinking-stream",
      uuid: "event-text-start",
      event: { type: "content_block_start", index: 1, content_block: { type: "text", text: "结果" } }
    },
    {
      type: "result",
      subtype: "success",
      session_id: "session-thinking-stream",
      is_error: false,
      result: "结果"
    }
  ] as const;
  const events = messages.flatMap((message) => projectMessage(message, ctx));
  const reasoningDeltas = events.filter((event) => event.kind === "item/reasoning/textDelta");
  const assistantDeltas = events.filter((event) => event.kind === "item/agentMessage/delta");
  const completedReasoning = events.filter((event) => event.kind === "item/completed" && event.item.type === "reasoning");

  expect(reasoningDeltas).toHaveLength(2);
  expect(assistantDeltas).toHaveLength(1);
  expect(reasoningDeltas[0]?.itemId).not.toBe(assistantDeltas[0]?.itemId);
  expect(completedReasoning[0]?.item.text).toBe("检查协议");
});

test("streaming turn: tool blocks start with the Claude tool_use id", () => {
  const ctx = createProjectorContext(THREAD_ID, TURN_ID);
  const events = projectMessage({
    type: "stream_event",
    session_id: "session-tool-stream",
    uuid: "event-tool",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tool-read", name: "Read", input: {} }
    }
  }, ctx);
  const started = events.find((event) => event.kind === "item/started");
  expect(started?.item).toMatchObject({ type: "toolCall", id: "tool-read", toolName: "Read", status: "inProgress" });
});

test("streaming turn: tool argument deltas update the same tool item", () => {
  const ctx = createProjectorContext(THREAD_ID, TURN_ID);
  const events = [
    ...projectMessage({
      type: "stream_event",
      session_id: "session-tool-arguments",
      event: {
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "tool-write", name: "Write", input: {} }
      }
    }, ctx),
    ...projectMessage({
      type: "stream_event",
      session_id: "session-tool-arguments",
      event: {
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: "{\"file_path\":\"a.txt\"}" }
      }
    }, ctx)
  ];
  const toolUpdates = events.filter((event) => event.kind === "item/started" && event.item.id === "tool-write");
  expect(toolUpdates).toHaveLength(2);
  expect(toolUpdates[1]?.item.arguments).toEqual({ file_path: "a.txt" });
});

test("permission request: control_request produces permissionRequest event", () => {
  const { events } = projectFixture(FIXTURE_PERMISSION_TURN);

  const perm = events.filter(e => e.kind === "item/permissionRequest");
  expect(perm.length).toBe(1);
  expect(perm[0].toolName).toBe("Bash");
  expect(perm[0].toolUseId).toBe("tool-perm-001");
  expect(perm[0].turnId).toBe(TURN_ID);
});

test("duplicate result: exactly one terminal event", () => {
  const { events } = projectFixture(FIXTURE_DUPLICATE_RESULT);

  const terminal = events.filter(e => e.kind === "turn/completed" || e.kind === "turn/failed");
  expect(terminal.length).toBe(1);

  // The result item should not be duplicated
  const resultItems = events.filter(e => e.kind === "item/completed" && e.item.type === "agentMessage");
  const uniqueIds = new Set(resultItems.map(e => e.item.id));
  expect(uniqueIds.size).toBe(resultItems.length);
  expect(resultItems.length).toBe(1);
  expect(resultItems[0].item.content).toBe("Response");
});

test("multi-block assistant text suppresses the equivalent final result", () => {
  const ctx = createProjectorContext(THREAD_ID, TURN_ID);
  const events = [
    ...projectMessage({
      type: "assistant",
      session_id: "session-multi",
      uuid: "assistant-multi",
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "line one" }, { type: "text", text: "line two" }]
      }
    }, ctx),
    ...projectMessage({
      type: "result",
      subtype: "success",
      session_id: "session-multi",
      uuid: "result-multi",
      is_error: false,
      result: "line one\nline two"
    }, ctx)
  ];

  const assistantItems = events.filter(e => e.kind === "item/completed" && e.item.type === "agentMessage");
  expect(assistantItems.map(event => event.item.content)).toEqual(["line one", "line two"]);
  expect(events.filter(event => event.kind === "turn/completed")).toHaveLength(1);
});

test("unknown event: no events produced, no crash", () => {
  const { events } = projectFixture(FIXTURE_UNKNOWN_EVENT);
  expect(events.length).toBe(0);
});

test("process exit: forceTerminate produces terminal event when turn is running", () => {
  const ctx = createProjectorContext(THREAD_ID, TURN_ID);
  for (const msg of FIXTURE_PROCESS_EXIT) {
    projectMessage(msg, ctx);
  }
  expect(ctx.turn.status).toBe("running");

  const event = forceTerminate(ctx, "Process exited");
  expect(event).not.toBeNull();
  expect(event!.kind).toBe("turn/failed");
  expect(event!.error).toBe("Process exited");

  // Second force should be null (already terminal)
  const second = forceTerminate(ctx);
  expect(second).toBeNull();
});

test("interrupt: markInterrupted produces terminal interrupted event", () => {
  const ctx = createProjectorContext(THREAD_ID, TURN_ID);
  for (const msg of FIXTURE_COMPLETE_TURN.slice(0, 2)) {
    projectMessage(msg, ctx);
  }

  const event = markInterrupted(ctx);
  expect(event).not.toBeNull();
  expect(event!.kind).toBe("turn/interrupted");

  // Second interrupt should be null
  const second = markInterrupted(ctx);
  expect(second).toBeNull();
});

test("toNotification: produces correct method names for each event kind", () => {
  const ctx = createProjectorContext(THREAD_ID, TURN_ID);
  const events = [];
  for (const msg of FIXTURE_COMPLETE_TURN) {
    events.push(...projectMessage(msg, ctx));
  }

  const notifications = events.map(toNotification);
  const methods = notifications.map(n => n.method);
  expect(methods).toContain("system/init");
  expect(methods).toContain("item/completed");
  expect(methods).toContain("turn/completed");

  // Every notification must have threadId in params
  for (const n of notifications) {
    expect(n.params.threadId).toBe(THREAD_ID);
  }
});

test("toNotification: delta event has string delta and turnId", () => {
  const ctx = createProjectorContext(THREAD_ID, TURN_ID);
  const events = [];
  for (const msg of FIXTURE_STREAMING_TURN) {
    events.push(...projectMessage(msg, ctx));
  }

  const deltas = events.filter(e => e.kind === "item/agentMessage/delta");
  for (const delta of deltas) {
    const n = toNotification(delta);
    expect(n.method).toBe("item/agentMessage/delta");
    expect(typeof n.params.delta).toBe("string");
    expect(n.params.turnId).toBe(TURN_ID);
  }
});

test("parseClaudeMessage: valid JSON returns parsed message", () => {
  const msg = parseClaudeMessage(JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }));
  expect(msg).not.toBeNull();
  expect(msg!.type).toBe("system");
});

test("parseClaudeMessage: empty line returns null", () => {
  expect(parseClaudeMessage("")).toBeNull();
  expect(parseClaudeMessage("   ")).toBeNull();
});

test("parseClaudeMessage: invalid JSON returns null", () => {
  expect(parseClaudeMessage("{invalid}")).toBeNull();
});

test("buildControlResponse: allow produces correct structure for Claude 2.x", () => {
  const response = buildControlResponse("req-001", true) as { type: string; response: { subtype: string; request_id: string; response: Record<string, unknown> } };
  expect(response.type).toBe("control_response");
  expect(response.response.subtype).toBe("success");
  expect(response.response.request_id).toBe("req-001");
  expect(response.response.response.behavior).toBe("allow");
});

test("buildControlResponse: deny produces error structure", () => {
  const response = buildControlResponse("req-002", false, "User denied") as { type: string; response: { subtype: string; request_id: string; error: string } };
  expect(response.type).toBe("control_response");
  expect(response.response.subtype).toBe("error");
  expect(response.response.request_id).toBe("req-002");
  expect(response.response.error).toBe("User denied");
});

test("buildInterruptRequest: produces correct control_request", () => {
  const request = buildInterruptRequest("interrupt-001") as { type: string; request_id: string; request: { subtype: string } };
  expect(request.type).toBe("control_request");
  expect(request.request_id).toBe("interrupt-001");
  expect(request.request.subtype).toBe("interrupt");
});
