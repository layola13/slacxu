import { describe, expect, test } from "bun:test";
import {
  createGrokProjectorContext,
  projectGrokEvent,
  toGrokNotification,
  forceTerminateGrok
} from "../../backends/grok/src/runtime/grokCompatibleTurnProjector";
import type { GrokEvent } from "../../backends/grok/src/runtime/grokCompatibleProtocol";

describe("grokCompatibleTurnProjector", () => {
  test("creates fresh projector context", () => {
    const ctx = createGrokProjectorContext("thread-1", "turn-1");
    expect(ctx.threadId).toBe("thread-1");
    expect(ctx.turnId).toBe("turn-1");
    expect(ctx.status).toBe("running");
    expect(ctx.hasStartedTurn).toBe(false);
  });

  test("projects thought and text deltas into item deltas", () => {
    const ctx = createGrokProjectorContext("thread-1", "turn-1");

    // First event triggers turn/started + reasoning item/started + delta
    // （对齐 mini/opencode：思考独立成 reasoning 项）
    const thoughtEv: GrokEvent = {
      type: "thought",
      data: "Thinking about the question...",
    };
    const projectedThought = projectGrokEvent(thoughtEv, ctx);
    expect(projectedThought.length).toBe(3);
    expect(projectedThought[0].kind).toBe("turn/started");
    expect(projectedThought[1].kind).toBe("item/started");
    if (projectedThought[1].kind === "item/started") {
      expect(projectedThought[1].item.type).toBe("reasoning");
    }
    expect(projectedThought[2].kind).toBe("item/reasoning/textDelta");
    if (projectedThought[2].kind === "item/reasoning/textDelta") {
      expect(projectedThought[2].delta).toBe("Thinking about the question...");
    }

    // First text delta settles reasoning, then emits item/started + item/agentMessage/delta
    const textEv: GrokEvent = {
      type: "text",
      data: "Hello from Grok!",
    };
    const projectedText = projectGrokEvent(textEv, ctx);
    expect(projectedText.length).toBe(3);
    expect(projectedText[0].kind).toBe("item/completed");
    if (projectedText[0].kind === "item/completed") {
      expect(projectedText[0].item.type).toBe("reasoning");
      expect(projectedText[0].item.text).toBe("Thinking about the question...");
    }
    expect(projectedText[1].kind).toBe("item/started");
    expect(projectedText[2].kind).toBe("item/agentMessage/delta");
    if (projectedText[2].kind === "item/agentMessage/delta") {
      expect(projectedText[2].delta).toBe("Hello from Grok!");
    }

    // Subsequent text delta in same segment emits only item/agentMessage/delta
    const textEv2: GrokEvent = {
      type: "text",
      data: " How are you?",
    };
    const projectedText2 = projectGrokEvent(textEv2, ctx);
    expect(projectedText2.length).toBe(1);
    expect(projectedText2[0].kind).toBe("item/agentMessage/delta");
    if (projectedText2[0].kind === "item/agentMessage/delta") {
      expect(projectedText2[0].delta).toBe(" How are you?");
    }
  });

  test("projects tool call and tool call update", () => {
    const ctx = createGrokProjectorContext("thread-1", "turn-1");
    ctx.hasStartedTurn = true;

    const toolCallEv: GrokEvent = {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "read_file",
      rawInput: { path: "package.json" },
    };
    const startProj = projectGrokEvent(toolCallEv, ctx);
    expect(startProj.length).toBe(1);
    expect(startProj[0].kind).toBe("item/started");

    const updateEv: GrokEvent = {
      type: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      rawOutput: { content: "{}" },
    };
    const endProj = projectGrokEvent(updateEv, ctx);
    expect(endProj.length).toBe(1);
    expect(endProj[0].kind).toBe("item/completed");
    if (endProj[0].kind === "item/completed") {
      expect(endProj[0].item.turnId).toBe("turn-1");
    }
  });

  test("unpacks use_tool wrapping sa-vm__sa_vm_run and preserves turnId on all items", () => {
    const ctx = createGrokProjectorContext("thread-grok-1", "turn-grok-1");
    ctx.hasStartedTurn = true;

    const grokUseToolEv: GrokEvent = {
      type: "tool_call",
      toolCallId: "call-grok-mcp-1",
      title: "use_tool",
      kind: "use_tool",
      status: "pending",
      toolName: "use_tool",
      rawInput: {
        tool_name: "sa-vm__sa_vm_run",
        tool_input: {
          action: "read_lines",
          path: "README.md",
          start_line: 1,
          end_line: 5,
        },
      },
    };

    const projected = projectGrokEvent(grokUseToolEv, ctx);
    expect(projected.length).toBe(1);
    expect(projected[0].kind).toBe("item/started");
    if (projected[0].kind === "item/started") {
      expect(projected[0].item.turnId).toBe("turn-grok-1");
      expect(projected[0].item.name).toBe("sa-vm__sa_vm_run");
      expect((projected[0].item.input as any).action).toBe("read_lines");
      expect((projected[0].item.input as any).path).toBe("README.md");
    }

    const updateEv: GrokEvent = {
      type: "tool_call_update",
      toolCallId: "call-grok-mcp-1",
      status: "completed",
      rawOutput: {
        type: "MCP",
        tool_name: "sa_vm_run",
        server_name: "sa-vm",
        output: { OkayOutput: "file content" },
      },
    };
    const completedProj = projectGrokEvent(updateEv, ctx);
    expect(completedProj.length).toBe(1);
    expect(completedProj[0].kind).toBe("item/completed");
    if (completedProj[0].kind === "item/completed") {
      expect(completedProj[0].item.turnId).toBe("turn-grok-1");
      expect(completedProj[0].item.status).toBe("completed");
    }
  });

  test("projects end event into system/init with sessionId, agentMessage, and turn/completed", () => {    const ctx = createGrokProjectorContext("thread-1", "turn-1");
    ctx.hasStartedTurn = true;
    // 走真实事件流：thought + text，再 end，避免直接改内部累积字段
    projectGrokEvent({ type: "thought", data: "reasoning here" }, ctx);
    projectGrokEvent({ type: "text", data: "Final answer text" }, ctx);

    const endEv: GrokEvent = {
      type: "end",
      stopReason: "end_turn",
      sessionId: "01a075cf-session-uuid",
      usage: { input_tokens: 100, output_tokens: 20 },
    };
    const proj = projectGrokEvent(endEv, ctx);
    expect(proj.some((p) => p.kind === "system/init" && p.sessionId === "01a075cf-session-uuid")).toBe(true);
    const completed = proj.filter((p) => p.kind === "item/completed");
    // 思考已在 text 到达时结算，end 只结算正文
    expect(completed.length).toBe(1);
    if (completed[0]?.kind === "item/completed") {
      expect(completed[0].item.type).toBe("agentMessage");
      expect(completed[0].item.text).toBe("Final answer text");
      const content = completed[0].item.content as any[];
      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({ type: "text", text: "Final answer text", text_elements: [] });
    }
    expect(proj.some((p) => p.kind === "turn/completed")).toBe(true);
    expect(ctx.sessionId).toBe("01a075cf-session-uuid");
    expect(ctx.status).toBe("completed");
  });

  test("end with a non-terminal stopReason fails the turn with the reason", () => {
    const ctx = createGrokProjectorContext("thread-cap", "turn-cap");
    ctx.hasStartedTurn = true;
    projectGrokEvent({ type: "text", data: "partial work" }, ctx);
    const proj = projectGrokEvent({ type: "end", stopReason: "max_iterations", sessionId: "sess-cap" } as GrokEvent, ctx);
    expect(proj.some((p) => p.kind === "turn/completed")).toBe(false);
    const failed = proj.find((p) => p.kind === "turn/failed");
    expect(failed).toBeDefined();
    if (failed?.kind === "turn/failed") {
      expect(failed.error).toContain("max_iterations");
    }
    expect(ctx.status).toBe("failed");
  });

  test("end holds the turn when tools are still unsettled", () => {
    const ctx = createGrokProjectorContext("thread-tools", "turn-tools");
    ctx.hasStartedTurn = true;
    projectGrokEvent({ type: "tool_call", toolCallId: "call-9", toolName: "read_file", rawInput: { path: "a.ts" } } as GrokEvent, ctx);
    const proj = projectGrokEvent({ type: "end", stopReason: "end_turn", sessionId: "sess-tools" } as GrokEvent, ctx);
    expect(proj.some((p) => p.kind === "turn/completed")).toBe(false);
    const failed = proj.find((p) => p.kind === "turn/failed");
    expect(failed).toBeDefined();
    if (failed?.kind === "turn/failed") {
      expect(failed.error).toContain("tools still running");
    }
    expect(ctx.status).toBe("failed");
  });

  test("toGrokNotification converts projected events to valid JsonRpcNotification", () => {
    const startNotif = toGrokNotification({ kind: "turn/started", threadId: "th-1", turnId: "tu-1" });
    expect(startNotif?.method).toBe("turn/started");

    const deltaNotif = toGrokNotification({ kind: "item/agentMessage/delta", threadId: "th-1", turnId: "tu-1", itemId: "msg-1", delta: "hi" });
    expect(deltaNotif?.method).toBe("item/agentMessage/delta");

    const initNotif = toGrokNotification({ kind: "system/init", threadId: "th-1", sessionId: "sess-123" });
    expect(initNotif?.method).toBe("grok/init");

    const failedNotif = toGrokNotification({ kind: "turn/failed", threadId: "th-1", turnId: "tu-1", error: "Rate limit reached" });
    expect(failedNotif?.method).toBe("turn/failed");
    expect((failedNotif?.params as any)?.error).toBe("Rate limit reached");
  });

  test("projects grok error event into agentMessage and turn/failed", () => {
    const ctx = createGrokProjectorContext("th-err-1", "tu-err-1");
    ctx.hasStartedTurn = true;

    const errEv: GrokEvent = {
      type: "error",
      message: "You’ve reached your free Grok Build usage limit for now.",
    };
    const projected = projectGrokEvent(errEv, ctx);
    expect(projected.length).toBe(3); // item/started, item/completed, turn/failed
    expect(projected[0].kind).toBe("item/started");
    expect(projected[1].kind).toBe("item/completed");
    if (projected[1].kind === "item/completed") {
      expect(projected[1].item.status).toBe("failed");
      expect(projected[1].item.text).toBe("You’ve reached your free Grok Build usage limit for now.");
      expect(projected[1].item.error).toBe("You’ve reached your free Grok Build usage limit for now.");
    }
    expect(projected[2].kind).toBe("turn/failed");
    if (projected[2].kind === "turn/failed") {
      expect(projected[2].error).toBe("You’ve reached your free Grok Build usage limit for now.");
    }
    expect(ctx.status).toBe("failed");
  });

  test("forceTerminateGrok creates failed agentMessage if terminated with error before output", () => {
    const ctx = createGrokProjectorContext("th-term-1", "tu-term-1");
    ctx.hasStartedTurn = true;

    const events = forceTerminateGrok(ctx, "failed", "Process exited with code 1");
    expect(events.length).toBe(3); // item/started, item/completed, turn/failed
    expect(events[0].kind).toBe("item/started");
    expect(events[1].kind).toBe("item/completed");
    if (events[1].kind === "item/completed") {
      expect(events[1].item.status).toBe("failed");
      expect(events[1].item.text).toBe("Process exited with code 1");
    }
    expect(events[2].kind).toBe("turn/failed");
    expect(ctx.status).toBe("failed");
  });

  test("preserves causal timeline order across interleaved text and tool calls", () => {
    const ctx = createGrokProjectorContext("thread-causal-1", "turn-causal-1");
    const sessionMessages: any[] = [];

    function process(ev: GrokEvent) {
      const projected = projectGrokEvent(ev, ctx);
      for (const p of projected) {
        if (p.kind === "item/started" || p.kind === "item/completed") {
          const item = p.item;
          const idx = sessionMessages.findIndex((m) => m && m.id === item.id);
          if (idx >= 0) {
            sessionMessages[idx] = item;
          } else {
            sessionMessages.push(item);
          }
        }
      }
      return projected;
    }

    // 1. Answer A
    const a1 = process({ type: "text", data: "Answer A part 1. " });
    expect(a1.some((e) => e.kind === "turn/started")).toBe(true);
    expect(a1.some((e) => e.kind === "item/started")).toBe(true);
    expect(a1.some((e) => e.kind === "item/agentMessage/delta")).toBe(true);

    const a2 = process({ type: "text", data: "Answer A part 2." });
    expect(a2.length).toBe(1);
    expect(a2[0].kind).toBe("item/agentMessage/delta");

    // 2. Tool 1
    const t1Start = process({
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "read_file",
      rawInput: { path: "a.ts" },
    });
    // Should complete Answer A before starting Tool 1
    expect(t1Start.some((e) => e.kind === "item/completed" && e.item.id.includes("turn-causal-1-0"))).toBe(true);
    expect(t1Start.some((e) => e.kind === "item/started" && e.item.id === "call-1")).toBe(true);

    process({
      type: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      rawOutput: { ok: true },
    });

    // 3. Tool 2 (consecutive tool)
    process({
      type: "tool_call",
      toolCallId: "call-2",
      toolName: "read_file",
      rawInput: { path: "b.ts" },
    });
    process({
      type: "tool_call_update",
      toolCallId: "call-2",
      status: "completed",
      rawOutput: { ok: true },
    });

    // 4. Answer B
    const b1 = process({ type: "text", data: "Answer B." });
    expect(b1.some((e) => e.kind === "item/started" && e.item.id.includes("turn-causal-1-1"))).toBe(true);
    expect(b1.some((e) => e.kind === "item/agentMessage/delta")).toBe(true);

    // 5. Usage signals completion of model step
    const usageProj = process({
      type: "usage",
      usage: { input_tokens: 50, output_tokens: 20 },
    });
    expect(usageProj.some((e) => e.kind === "item/completed" && e.item.id.includes("turn-causal-1-1"))).toBe(true);

    // 6. Tool 3
    process({
      type: "tool_call",
      toolCallId: "call-3",
      toolName: "write_file",
      rawInput: { path: "out.ts" },
    });
    process({
      type: "tool_call_update",
      toolCallId: "call-3",
      status: "completed",
    });

    // 7. Answer C
    const c1 = process({ type: "text", data: "Answer C final." });
    expect(c1.some((e) => e.kind === "item/started" && e.item.id.includes("turn-causal-1-2"))).toBe(true);

    // 8. End
    const endProj = process({
      type: "end",
      sessionId: "sess-causal",
      stopReason: "end_turn",
    });
    expect(endProj.some((e) => e.kind === "item/completed" && e.item.id.includes("turn-causal-1-2"))).toBe(true);
    expect(endProj.some((e) => e.kind === "turn/completed")).toBe(true);

    // Authoritative verification of sessionMessages chronological causal order:
    // [Answer A, Tool 1, Tool 2, Answer B, Tool 3, Answer C]
    expect(sessionMessages.length).toBe(6);
    expect(sessionMessages[0].type).toBe("agentMessage");
    expect(sessionMessages[0].text).toBe("Answer A part 1. Answer A part 2.");
    expect(sessionMessages[1].type).toBe("toolCall");
    expect(sessionMessages[1].id).toBe("call-1");
    expect(sessionMessages[2].type).toBe("toolCall");
    expect(sessionMessages[2].id).toBe("call-2");
    expect(sessionMessages[3].type).toBe("agentMessage");
    expect(sessionMessages[3].text).toBe("Answer B.");
    expect(sessionMessages[4].type).toBe("toolCall");
    expect(sessionMessages[4].id).toBe("call-3");
    expect(sessionMessages[5].type).toBe("agentMessage");
    expect(sessionMessages[5].text).toBe("Answer C final.");
  });

  test("starts a new segment with new reasoning ID when thought arrives after tool execution", () => {
    const ctx = createGrokProjectorContext("thread-thought-1", "turn-thought-1");

    // 1. Initial text
    projectGrokEvent({ type: "text", data: "Initial response before tool." }, ctx);

    // 2. Tool call completes prior segment
    const tStart = projectGrokEvent({
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "fetch_data",
      rawInput: { id: "123" },
    }, ctx);
    expect(tStart.some((e) => e.kind === "item/completed" && e.item.id.includes("turn-thought-1-0"))).toBe(true);

    projectGrokEvent({
      type: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
    }, ctx);

    // 3. Thought arrives after tool execution
    const thoughtEvents = projectGrokEvent({
      type: "thought",
      data: "Now reasoning about the fetched data.",
    }, ctx);

    // Should emit reasoning delta with segment index 1 (not segment 0!)
    const thoughtDelta = thoughtEvents.find((e) => e.kind === "item/reasoning/textDelta");
    expect(thoughtDelta).toBeDefined();
    if (thoughtDelta && thoughtDelta.kind === "item/reasoning/textDelta") {
      expect(thoughtDelta.itemId).toBe("grok-thought-turn-thought-1-1");
      expect(thoughtDelta.delta).toBe("Now reasoning about the fetched data.");
    }

    // 4. Subsequent text arrives for this new segment
    const textEvents = projectGrokEvent({
      type: "text",
      data: "Here is the final answer.",
    }, ctx);
    const msgStarted = textEvents.find((e) => e.kind === "item/started");
    expect(msgStarted).toBeDefined();
    if (msgStarted && msgStarted.kind === "item/started") {
      expect(msgStarted.item.id).toBe("grok-msg-turn-thought-1-1");
    }

    // 5. Text 到达时已结算思考为独立 reasoning 项，end 只结算正文（text-only）
    const thoughtCompleted = textEvents.find(
      (e) => e.kind === "item/completed" && e.item.type === "reasoning",
    );
    expect(thoughtCompleted).toBeDefined();
    if (thoughtCompleted && thoughtCompleted.kind === "item/completed") {
      expect(thoughtCompleted.item.id).toBe("grok-thought-turn-thought-1-1");
      expect(thoughtCompleted.item.text).toBe("Now reasoning about the fetched data.");
    }
    const endEvents = projectGrokEvent({
      type: "end",
      sessionId: "sess-thought",
      stopReason: "end_turn",
    }, ctx);

    const compMsg = endEvents.find((e) => e.kind === "item/completed");
    expect(compMsg).toBeDefined();
    if (compMsg && compMsg.kind === "item/completed") {
      expect(compMsg.item.type).toBe("agentMessage");
      expect(compMsg.item.id).toBe("grok-msg-turn-thought-1-1");
      expect(compMsg.item.text).toBe("Here is the final answer.");
      const content = compMsg.item.content as any[];
      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({ type: "text", text: "Here is the final answer.", text_elements: [] });
    }
  });

  test("does not duplicate reasoning into agentMessage body (waterfall Thinking vs text)", () => {
    const ctx = createGrokProjectorContext("thread-dup-1", "turn-dup-1");
    const thought = projectGrokEvent({ type: "thought", data: "The user said hi. Casual greeting." }, ctx);
    expect(thought.some((e) => e.kind === "item/started" && e.item.type === "reasoning")).toBe(true);
    const text = projectGrokEvent({ type: "text", data: "Hello! How can I help?" }, ctx);
    // 正文开始即结算思考为独立项
    const reasoningDone = text.find((e) => e.kind === "item/completed" && e.item.type === "reasoning");
    expect(reasoningDone).toBeDefined();
    if (reasoningDone && reasoningDone.kind === "item/completed") {
      expect(reasoningDone.item.text).toBe("The user said hi. Casual greeting.");
    }
    const end = projectGrokEvent({ type: "end", sessionId: "sess-dup", stopReason: "end_turn" }, ctx);
    const agentDone = end.find((e) => e.kind === "item/completed" && e.item.type === "agentMessage");
    expect(agentDone).toBeDefined();
    if (agentDone && agentDone.kind === "item/completed") {
      expect(agentDone.item.text).toBe("Hello! How can I help?");
      const content = agentDone.item.content as any[];
      expect(content.every((b) => b.type !== "reasoning")).toBe(true);
      expect(JSON.stringify(content)).not.toContain("Casual greeting");
    }
  });

  test("task tool projects subagent card with linked receiver (subagents view)", () => {
    const ctx = createGrokProjectorContext("thread-task-1", "turn-task-1");
    ctx.hasStartedTurn = true;

    // tool_call 时 receiver 未知：hold 住 started，避免幽灵 tab
    const started = projectGrokEvent({
      type: "tool_call",
      toolCallId: "call-task-1",
      toolName: "task",
      rawInput: { description: "Explore auth", prompt: "Explore auth flow", subagent_type: "explore" },
    }, ctx);
    expect(started.some((e) => e.kind === "item/started")).toBe(false);

    // terminal update 携带 subagent_id：必发 completed 并链上 receiver
    const done = projectGrokEvent({
      type: "tool_call_update",
      toolCallId: "call-task-1",
      status: "completed",
      rawOutput: { output: "found it", subagent_id: "sub-abc-123", subagent_type: "explore" },
    }, ctx);
    const completed = done.find((e) => e.kind === "item/completed");
    expect(completed).toBeDefined();
    if (completed && completed.kind === "item/completed") {
      expect(completed.item.type).toBe("collabAgentToolCall");
      expect(completed.item.tool).toBe("task");
      expect(completed.item.prompt).toBe("Explore auth flow");
      expect(completed.item.agentRole).toBe("explore");
      expect(completed.item.receiverThreadIds).toEqual(["sub-abc-123"]);
      expect(completed.item.agentThreadId).toBe("sub-abc-123");
      expect(completed.item.status).toBe("completed");
    }
  });

  test("task tool extracts subagent_id from background text notice", () => {
    const ctx = createGrokProjectorContext("thread-task-2", "turn-task-2");
    ctx.hasStartedTurn = true;
    projectGrokEvent({
      type: "tool_call",
      toolCallId: "call-task-2",
      toolName: "Task",
      rawInput: { description: "Write tests", prompt: "Write tests" },
    }, ctx);
    const done = projectGrokEvent({
      type: "tool_call_update",
      toolCallId: "call-task-2",
      status: "completed",
      rawOutput: "Subagent started in background.\nsubagent_id: sub-bg-9\ntype: general-purpose",
    }, ctx);
    const completed = done.find((e) => e.kind === "item/completed");
    expect(completed).toBeDefined();
    if (completed && completed.kind === "item/completed") {
      expect(completed.item.type).toBe("collabAgentToolCall");
      expect(completed.item.receiverThreadIds).toEqual(["sub-bg-9"]);
    }
  });

  test("non-task tools still project as plain toolCall", () => {
    const ctx = createGrokProjectorContext("thread-task-3", "turn-task-3");
    ctx.hasStartedTurn = true;
    const started = projectGrokEvent({
      type: "tool_call",
      toolCallId: "call-read-1",
      toolName: "read_file",
      rawInput: { path: "a.ts" },
    }, ctx);
    expect(started.some((e) => e.kind === "item/started" && e.item.type === "toolCall")).toBe(true);
  });

  test("pure thought turn emits reasoning completed without phantom agentMessage", () => {
    const ctx = createGrokProjectorContext("thread-thought-only-1", "turn-thought-only-1");
    projectGrokEvent({ type: "thought", data: "only thinking" }, ctx);
    const end = projectGrokEvent({ type: "end", sessionId: "sess-only", stopReason: "end_turn" }, ctx);
    const reasoningDone = end.find((e) => e.kind === "item/completed" && e.item.type === "reasoning");
    expect(reasoningDone).toBeDefined();
    expect(end.some((e) => e.kind === "item/completed" && e.item.type === "agentMessage")).toBe(false);
    expect(end.some((e) => e.kind === "turn/completed")).toBe(true);
  });
});

