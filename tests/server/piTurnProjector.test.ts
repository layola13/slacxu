import { describe, expect, test } from "bun:test";
import {
  createPiProjectorContext,
  projectPiMessage,
  toPiNotification,
  forceTerminatePi,
} from "../../backends/pi/src/runtime/piTurnProjector";

describe("piTurnProjector", () => {
  test("projects turn lifecycle and message deltas into Ultra notifications", () => {
    const ctx = createPiProjectorContext("t-1", "turn-1");

    // 1. Initial agent_start projects turn/started
    const p1 = projectPiMessage({ type: "agent_start" }, ctx);
    expect(p1).toHaveLength(1);
    expect(p1[0].kind).toBe("turn/started");
    const notif1 = toPiNotification(p1[0]);
    expect(notif1?.method).toBe("turn/started");
    expect((notif1?.params as any)?.engine).toBe("pi");

    // 2. Thinking delta
    const p2 = projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "Let me consider...",
      },
    }, ctx);
    expect(p2).toHaveLength(2);
    expect(p2[0].kind).toBe("item/started");
    expect((p2[0] as any).item.type).toBe("reasoning");
    expect(p2[1].kind).toBe("item/reasoning/textDelta");
    expect((p2[1] as any).delta).toBe("Let me consider...");

    // 3. Text delta
    const p3 = projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Hello from Pi!",
      },
    }, ctx);
    // Starts assistant item + delta
    expect(p3.some((e) => e.kind === "item/started")).toBe(true);
    expect(p3.some((e) => e.kind === "item/agentMessage/delta")).toBe(true);

    // 4. agent_settled terminates turn
    const p4 = projectPiMessage({ type: "agent_settled" }, ctx);
    expect(p4.some((e) => e.kind === "item/completed")).toBe(true);
    expect(p4.some((e) => e.kind === "turn/completed")).toBe(true);
    expect(ctx.status).toBe("completed");
    expect(ctx.assistantText).toBe("Hello from Pi!");
    expect(ctx.reasoningText).toBe("Let me consider...");
  });

  test("handles command failure and error termination", () => {
    const ctx = createPiProjectorContext("t-2", "turn-2");

    const p = projectPiMessage({
      type: "response",
      command: "prompt",
      success: false,
      error: "Authentication failed",
    }, ctx);

    expect(ctx.status).toBe("failed");
    expect(p.some((e) => e.kind === "turn/failed")).toBe(true);
    const failEvt = p.find((e) => e.kind === "turn/failed") as any;
    expect(failEvt.error).toBe("Authentication failed");
  });

  test("forceTerminatePi generates correct terminal state for interrupted turns", () => {
    const ctx = createPiProjectorContext("t-3", "turn-3");
    ctx.assistantText = "Partial text";
    const events = forceTerminatePi(ctx, "interrupted");

    expect(ctx.status).toBe("interrupted");
    expect(events.some((e) => e.kind === "item/completed")).toBe(true);
    expect(events.some((e) => e.kind === "turn/interrupted")).toBe(true);
  });

  test("projects toolcall_start, delta, end, execution_start, and execution_end with stable ID and type toolCall", () => {
    const ctx = createPiProjectorContext("t-4", "turn-4");

    // 1. toolcall_start emits item/started with type: toolCall
    const p1 = projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        id: "call_read_1",
        toolName: "read_file",
      },
    }, ctx);

    const started = p1.find((e) => e.kind === "item/started") as any;
    expect(started).toBeDefined();
    expect(started.item.type).toBe("toolCall");
    expect(started.item.toolName).toBe("read_file");
    expect(started.item.name).toBe("read_file");
    expect(started.item.id).toBe("call_read_1");
    expect(started.item.status).toBe("inProgress");

    // 2. toolcall_delta buffers streaming arguments chunks without creating extra items
    const p2a = projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '{"path": "src/',
      },
    }, ctx);
    expect(p2a).toHaveLength(0);

    const p2b = projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: 'index.ts"}',
      },
    }, ctx);
    expect(p2b).toHaveLength(0);

    // 3. toolcall_end finalizes arguments on the active tool item
    const p3 = projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          id: "call_read_1",
          name: "read_file",
          arguments: { path: "src/index.ts" },
        },
      },
    }, ctx);
    expect(p3).toHaveLength(0);
    const activeTool = ctx.activeToolItems.get("call_read_1");
    expect(activeTool?.arguments).toEqual({ path: "src/index.ts" });

    // 4. tool_execution_start updates active item in place
    const p4 = projectPiMessage({
      type: "tool_execution_start",
      toolCallId: "call_read_1",
      toolName: "read_file",
      args: { path: "src/index.ts" },
    }, ctx);
    expect(p4).toHaveLength(0);

    // 5. tool_execution_end completes the item with the SAME ID and status completed
    const p5 = projectPiMessage({
      type: "tool_execution_end",
      toolCallId: "call_read_1",
      toolName: "read_file",
      result: "file content here",
      isError: false,
    }, ctx);

    expect(p5).toHaveLength(1);
    const completed = p5[0] as any;
    expect(completed.kind).toBe("item/completed");
    expect(completed.item.id).toBe("call_read_1"); // EXACT SAME ID
    expect(completed.item.type).toBe("toolCall");
    expect(completed.item.status).toBe("completed");
    expect(completed.item.result).toBe("file content here");
  });

  test("resolves stable ID via contentIndex aliasing when explicit id arrives at toolcall_end", () => {
    const ctx = createPiProjectorContext("t-5", "turn-5");

    // toolcall_start with only contentIndex
    const p1 = projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        toolName: "edit_file",
      },
    }, ctx);

    const started = p1.find((e) => e.kind === "item/started") as any;
    expect(started).toBeDefined();
    const initialId = started.item.id;
    expect(initialId).toBe("pi-tool-turn-5-0-0");
    expect(started.item.type).toBe("toolCall");

    // toolcall_end introduces explicit id call_edit_99
    projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          id: "call_edit_99",
          name: "edit_file",
          arguments: { target: "test.ts" },
        },
      },
    }, ctx);

    // tool_execution_end uses call_edit_99 -> resolves to initialId to preserve single row
    const pEnd = projectPiMessage({
      type: "tool_execution_end",
      toolCallId: "call_edit_99",
      toolName: "edit_file",
      result: "edited successfully",
      isError: false,
    }, ctx);

    expect(pEnd).toHaveLength(1);
    expect((pEnd[0] as any).item.id).toBe(initialId);
    expect((pEnd[0] as any).item.status).toBe("completed");
    expect((pEnd[0] as any).item.type).toBe("toolCall");
  });

  test("agent_settled auto-completes any inProgress tools without duplicating completed tools", () => {
    const ctx = createPiProjectorContext("t-6", "turn-6");

    // Start a tool call
    projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        id: "call_unfinished",
        toolName: "search",
      },
    }, ctx);

    // agent_settled arrives while tool is still inProgress
    const pSettled = projectPiMessage({ type: "agent_settled" }, ctx);

    const completedTools = pSettled.filter((e) => e.kind === "item/completed" && (e as any).item.type === "toolCall");
    expect(completedTools).toHaveLength(1);
    expect((completedTools[0] as any).item.id).toBe("call_unfinished");
    expect((completedTools[0] as any).item.status).toBe("completed");
  });

  test("preserves all 6 tool calls across sequential messages with repeated contentIndex and orders timeline strictly", () => {
    const ctx = createPiProjectorContext("t-multi", "turn-multi");
    const simulatedSessionMessages: any[] = [];
    const applyNotification = (evtList: any[]) => {
      for (const evt of evtList) {
        if (evt.kind === "item/started" || evt.kind === "item/completed") {
          const item = evt.item;
          const idx = simulatedSessionMessages.findIndex((m) => m.id === item.id);
          if (idx >= 0) {
            simulatedSessionMessages[idx] = item;
          } else {
            simulatedSessionMessages.push(item);
          }
        }
      }
    };

    // --- Message 0 (Answer A + Tools 1 & 2) ---
    applyNotification(projectPiMessage({ type: "message_start", message: { role: "assistant" } }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Answer A" },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: "call_1", toolName: "tool1" },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: { id: "call_1", name: "tool1" } },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, id: "call_2", toolName: "tool2" },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { id: "call_2", name: "tool2" } },
    }, ctx));
    applyNotification(projectPiMessage({ type: "message_end", message: { role: "assistant" } }, ctx));

    // Execute Tools 1 & 2
    applyNotification(projectPiMessage({ type: "tool_execution_start", toolCallId: "call_1", toolName: "tool1" }, ctx));
    applyNotification(projectPiMessage({ type: "tool_execution_end", toolCallId: "call_1", toolName: "tool1", result: "res1", isError: false }, ctx));
    applyNotification(projectPiMessage({ type: "message_end", message: { role: "toolResult", toolCallId: "call_1", content: "res1" } }, ctx));

    applyNotification(projectPiMessage({ type: "tool_execution_start", toolCallId: "call_2", toolName: "tool2" }, ctx));
    applyNotification(projectPiMessage({ type: "tool_execution_end", toolCallId: "call_2", toolName: "tool2", result: "res2", isError: false }, ctx));
    applyNotification(projectPiMessage({ type: "message_end", message: { role: "toolResult", toolCallId: "call_2", content: "res2" } }, ctx));

    // --- Message 1 (Answer B + Tools 3 & 4 with repeated contentIndex 0 & 1) ---
    applyNotification(projectPiMessage({ type: "message_start", message: { role: "assistant" } }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Answer B" },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: "call_3", toolName: "tool3" },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: { id: "call_3", name: "tool3" } },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, id: "call_4", toolName: "tool4" },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { id: "call_4", name: "tool4" } },
    }, ctx));
    applyNotification(projectPiMessage({ type: "message_end", message: { role: "assistant" } }, ctx));

    // Execute Tools 3 & 4
    applyNotification(projectPiMessage({ type: "tool_execution_start", toolCallId: "call_3", toolName: "tool3" }, ctx));
    applyNotification(projectPiMessage({ type: "tool_execution_end", toolCallId: "call_3", toolName: "tool3", result: "res3", isError: false }, ctx));
    applyNotification(projectPiMessage({ type: "message_end", message: { role: "toolResult", toolCallId: "call_3", content: "res3" } }, ctx));

    applyNotification(projectPiMessage({ type: "tool_execution_start", toolCallId: "call_4", toolName: "tool4" }, ctx));
    applyNotification(projectPiMessage({ type: "tool_execution_end", toolCallId: "call_4", toolName: "tool4", result: "res4", isError: false }, ctx));
    applyNotification(projectPiMessage({ type: "message_end", message: { role: "toolResult", toolCallId: "call_4", content: "res4" } }, ctx));

    // --- Message 2 (Answer C + Tools 5 & 6 with repeated contentIndex 0 & 1) ---
    applyNotification(projectPiMessage({ type: "message_start", message: { role: "assistant" } }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Answer C" },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: "call_5", toolName: "tool5" },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: { id: "call_5", name: "tool5" } },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, id: "call_6", toolName: "tool6" },
    }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { id: "call_6", name: "tool6" } },
    }, ctx));
    applyNotification(projectPiMessage({ type: "message_end", message: { role: "assistant" } }, ctx));

    // Execute Tools 5 & 6
    applyNotification(projectPiMessage({ type: "tool_execution_start", toolCallId: "call_5", toolName: "tool5" }, ctx));
    applyNotification(projectPiMessage({ type: "tool_execution_end", toolCallId: "call_5", toolName: "tool5", result: "res5", isError: false }, ctx));
    applyNotification(projectPiMessage({ type: "message_end", message: { role: "toolResult", toolCallId: "call_5", content: "res5" } }, ctx));

    applyNotification(projectPiMessage({ type: "tool_execution_start", toolCallId: "call_6", toolName: "tool6" }, ctx));
    applyNotification(projectPiMessage({ type: "tool_execution_end", toolCallId: "call_6", toolName: "tool6", result: "res6", isError: false }, ctx));
    applyNotification(projectPiMessage({ type: "message_end", message: { role: "toolResult", toolCallId: "call_6", content: "res6" } }, ctx));

    // --- Message 3 (Final Answer D) ---
    applyNotification(projectPiMessage({ type: "message_start", message: { role: "assistant" } }, ctx));
    applyNotification(projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Answer D" },
    }, ctx));
    applyNotification(projectPiMessage({ type: "message_end", message: { role: "assistant" } }, ctx));

    // Finish turn
    applyNotification(projectPiMessage({ type: "agent_settled" }, ctx));

    // 1. Verify all 6 tool calls are preserved
    expect(ctx.activeToolItems.size).toBe(6);
    for (const toolId of ["call_1", "call_2", "call_3", "call_4", "call_5", "call_6"]) {
      const tool = ctx.activeToolItems.get(toolId);
      expect(tool).toBeDefined();
      expect(tool?.status).toBe("completed");
      expect(tool?.type).toBe("toolCall");
    }

    // 2. Verify total messages in session match exact expected sequence:
    // Answer A -> Tool 1 -> Tool 2 -> Answer B -> Tool 3 -> Tool 4 -> Answer C -> Tool 5 -> Tool 6 -> Answer D
    expect(simulatedSessionMessages).toHaveLength(10);
    expect(simulatedSessionMessages[0].type).toBe("agentMessage");
    expect(simulatedSessionMessages[0].text).toBe("Answer A");

    expect(simulatedSessionMessages[1].type).toBe("toolCall");
    expect(simulatedSessionMessages[1].id).toBe("call_1");

    expect(simulatedSessionMessages[2].type).toBe("toolCall");
    expect(simulatedSessionMessages[2].id).toBe("call_2");

    expect(simulatedSessionMessages[3].type).toBe("agentMessage");
    expect(simulatedSessionMessages[3].text).toBe("Answer B");

    expect(simulatedSessionMessages[4].type).toBe("toolCall");
    expect(simulatedSessionMessages[4].id).toBe("call_3");

    expect(simulatedSessionMessages[5].type).toBe("toolCall");
    expect(simulatedSessionMessages[5].id).toBe("call_4");

    expect(simulatedSessionMessages[6].type).toBe("agentMessage");
    expect(simulatedSessionMessages[6].text).toBe("Answer C");

    expect(simulatedSessionMessages[7].type).toBe("toolCall");
    expect(simulatedSessionMessages[7].id).toBe("call_5");

    expect(simulatedSessionMessages[8].type).toBe("toolCall");
    expect(simulatedSessionMessages[8].id).toBe("call_6");

    expect(simulatedSessionMessages[9].type).toBe("agentMessage");
    expect(simulatedSessionMessages[9].text).toBe("Answer D");
  });

  test("correctly parses tool name, arguments and id from partial.content[contentIndex] on toolcall_start", () => {
    const ctx = createPiProjectorContext("t-partial", "turn-partial");

    const events = projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 1,
        partial: {
          role: "assistant",
          content: [
            { type: "text", text: "Prefix text" },
            {
              type: "toolCall",
              id: "call_from_partial_42",
              name: "custom_pi_tool",
              arguments: { target: "test.json", verbose: true },
            },
          ],
        },
      },
    }, ctx);

    const started = events.find((e) => e.kind === "item/started") as any;
    expect(started).toBeDefined();
    expect(started.item.id).toBe("call_from_partial_42");
    expect(started.item.type).toBe("toolCall");
    expect(started.item.toolName).toBe("custom_pi_tool");
    expect(started.item.name).toBe("custom_pi_tool");
    expect(started.item.arguments).toEqual({ target: "test.json", verbose: true });
  });

  test("preserves distinct fallback IDs across messages when explicit IDs arrive with delay", () => {
    const ctx = createPiProjectorContext("t-delay", "turn-delay");

    // Message 0: toolcall_start without explicit id (contentIndex: 0)
    const p1 = projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, toolName: "first_tool" },
    }, ctx);
    const start1 = p1.find((e) => e.kind === "item/started") as any;
    expect(start1.item.id).toBe("pi-tool-turn-delay-0-0");

    // Delayed explicit id on toolcall_end
    projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: { id: "real_call_alpha", name: "first_tool" },
      },
    }, ctx);
    projectPiMessage({ type: "message_end", message: { role: "assistant" } }, ctx);

    // Message 1: toolcall_start without explicit id (contentIndex: 0 again!)
    const p2 = projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, toolName: "second_tool" },
    }, ctx);
    const start2 = p2.find((e) => e.kind === "item/started") as any;
    expect(start2.item.id).toBe("pi-tool-turn-delay-1-0"); // Must not collide with pi-tool-turn-delay-0-0!

    // Delayed explicit id on toolcall_end
    projectPiMessage({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: { id: "real_call_beta", name: "second_tool" },
      },
    }, ctx);
    projectPiMessage({ type: "message_end", message: { role: "assistant" } }, ctx);

    // End execution of both
    const end1 = projectPiMessage({
      type: "tool_execution_end",
      toolCallId: "real_call_alpha",
      toolName: "first_tool",
      result: "res_alpha",
    }, ctx);
    expect((end1[0] as any).item.id).toBe("pi-tool-turn-delay-0-0");

    const end2 = projectPiMessage({
      type: "tool_execution_end",
      toolCallId: "real_call_beta",
      toolName: "second_tool",
      result: "res_beta",
    }, ctx);
    expect((end2[0] as any).item.id).toBe("pi-tool-turn-delay-1-0");

    expect(ctx.activeToolItems.size).toBe(2);
    expect(ctx.activeToolItems.get("pi-tool-turn-delay-0-0")?.status).toBe("completed");
    expect(ctx.activeToolItems.get("pi-tool-turn-delay-1-0")?.status).toBe("completed");
  });

  test("forceTerminatePi preserves completed tools and finalizes interrupted messages properly", () => {
    const ctx = createPiProjectorContext("t-term", "turn-term");

    // Complete tool 1
    projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: "c1", toolName: "tool1" },
    }, ctx);
    projectPiMessage({
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "tool1",
      result: "ok",
    }, ctx);
    projectPiMessage({ type: "message_end", message: { role: "assistant" } }, ctx);

    // Start message 1 with text and incomplete tool 2
    projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Working on tool 2..." },
    }, ctx);
    projectPiMessage({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: "c2", toolName: "tool2" },
    }, ctx);

    // Interrupted!
    const termEvents = forceTerminatePi(ctx, "interrupted");

    // c1 was already completed
    expect(ctx.activeToolItems.get("c1")?.status).toBe("completed");
    // c2 was inProgress -> terminated as failed/interrupted
    expect(ctx.activeToolItems.get("c2")?.status).toBe("failed");
    expect(termEvents.some((e) => e.kind === "turn/interrupted")).toBe(true);
  });
});
