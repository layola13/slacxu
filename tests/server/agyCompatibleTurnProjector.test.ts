import { describe, expect, test } from "bun:test";
import {
  createAgyProjectorContext,
  projectAgyEvent,
  toAgyNotification,
  forceTerminateAgy,
  parseAskQuestionData,
} from "../../backends/agy/src/runtime/agyCompatibleTurnProjector";
import { extractUserInputAnswer } from "../../backends/agy/src/runtime/agyCompatibleRuntime";
import type { AgyEvent } from "../../backends/agy/src/runtime/agyCompatibleProtocol";

describe("agyCompatibleTurnProjector", () => {
  test("creates fresh projector context", () => {
    const ctx = createAgyProjectorContext("thread-1", "turn-1");
    expect(ctx.threadId).toBe("thread-1");
    expect(ctx.turnId).toBe("turn-1");
    expect(ctx.status).toBe("running");
    expect(ctx.hasStartedTurn).toBe(false);
  });

  test("projects init event into system/init and turn/started", () => {
    const ctx = createAgyProjectorContext("thread-1", "turn-1");
    const initEvent: AgyEvent = {
      event: "init",
      conversation_id: "conv-123",
      init: { cwd: "/tmp/workspace", tools: ["read_file", "write_file"] }
    };
    const projected = projectAgyEvent(initEvent, ctx);
    expect(projected.length).toBe(2);
    expect(projected[0].kind).toBe("system/init");
    expect(projected[1].kind).toBe("turn/started");
    expect(ctx.hasStartedTurn).toBe(true);
    expect(ctx.conversationId).toBe("conv-123");
  });

  test("projects agent response and thinking deltas", () => {
    const ctx = createAgyProjectorContext("thread-1", "turn-1");
    ctx.hasStartedTurn = true;

    // Thinking delta
    const thinkEvent: AgyEvent = {
      event: "step_update",
      step_update: {
        step_index: 0,
        thinking_delta: "I need to check the files..."
      }
    };
    const thinkProjected = projectAgyEvent(thinkEvent, ctx);
    expect(thinkProjected.length).toBe(2);
    expect(thinkProjected[0].kind).toBe("item/started");
    expect(thinkProjected[1].kind).toBe("item/reasoning/textDelta");
    if (thinkProjected[1].kind === "item/reasoning/textDelta") {
      expect(thinkProjected[1].delta).toBe("I need to check the files...");
    }

    // First text delta emits item/started and item/agentMessage/delta
    const textEvent: AgyEvent = {
      event: "step_update",
      step_update: {
        step_index: 1,
        step_type: "agent_response",
        text_delta: "Hello world!"
      }
    };
    const textProjected = projectAgyEvent(textEvent, ctx);
    expect(textProjected.length).toBe(2);
    expect(textProjected[0].kind).toBe("item/started");
    expect(textProjected[1].kind).toBe("item/agentMessage/delta");
    if (textProjected[1].kind === "item/agentMessage/delta") {
      expect(textProjected[1].delta).toBe("Hello world!");
    }

    // Subsequent text delta in same segment emits only item/agentMessage/delta
    const textEvent2: AgyEvent = {
      event: "step_update",
      step_update: {
        step_index: 2,
        step_type: "agent_response",
        text_delta: " How are you?"
      }
    };
    const textProjected2 = projectAgyEvent(textEvent2, ctx);
    expect(textProjected2.length).toBe(1);
    expect(textProjected2[0].kind).toBe("item/agentMessage/delta");
    if (textProjected2[0].kind === "item/agentMessage/delta") {
      expect(textProjected2[0].delta).toBe(" How are you?");
    }
  });

  test("projects tool calls lifecycle", () => {
    const ctx = createAgyProjectorContext("thread-1", "turn-1");
    ctx.hasStartedTurn = true;

    const toolEvent: AgyEvent = {
      event: "step_update",
      step_update: {
        step_index: 2,
        state: "DONE",
        tool_calls: [{ id: "call-1", name: "read_file", input: { path: "package.json" } }]
      }
    };
    const projected = projectAgyEvent(toolEvent, ctx);
    expect(projected.length).toBe(2);
    expect(projected[0].kind).toBe("item/started");
    expect(projected[1].kind).toBe("item/completed");
  });

  test("projects result event into completed items and turn completion", () => {
    const ctx = createAgyProjectorContext("thread-1", "turn-1");
    ctx.hasStartedTurn = true;
    ctx.assistantText = "Final answer.";

    const resultEvent: AgyEvent = {
      event: "result",
      result: {
        status: "SUCCESS",
        response: "Final answer."
      }
    };
    const projected = projectAgyEvent(resultEvent, ctx);
    expect(projected.length).toBe(2);
    expect(projected[0].kind).toBe("item/completed");
    if (projected[0].kind === "item/completed") {
      expect(projected[0].item.text).toBe("Final answer.");
      expect(Array.isArray(projected[0].item.content)).toBe(true);
    }
    expect(projected[1].kind).toBe("turn/completed");
    expect(ctx.status).toBe("completed");
  });

  test("projects AGY usage into the standard token usage notification", () => {
    const ctx = createAgyProjectorContext("thread-usage", "turn-usage");
    const projected = projectAgyEvent({
      event: "result",
      result: {
        conversation_id: "conversation-usage",
        status: "SUCCESS",
        response: "Done.",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          thinking_tokens: 5,
          cache_read_tokens: 10,
          total_tokens: 125,
        },
      },
    }, ctx);

    const usageEvent = projected.find((event) => event.kind === "thread/tokenUsage/updated");
    expect(usageEvent).toBeDefined();
    if (usageEvent?.kind === "thread/tokenUsage/updated") {
      expect(usageEvent.tokenUsage.total).toEqual({
        totalTokens: 125,
        inputTokens: 100,
        cachedInputTokens: 10,
        cacheWriteInputTokens: 0,
        outputTokens: 20,
        reasoningOutputTokens: 5,
      });
      expect(usageEvent.tokenUsage.contextUsage).toMatchObject({
        totalTokens: 110,
        inputTokens: 100,
        cachedInputTokens: 10,
      });
      expect(toAgyNotification(usageEvent)).toEqual({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-usage",
          turnId: "turn-usage",
          tokenUsage: usageEvent.tokenUsage,
        },
      });
    }
  });

  test("translates projected events to standard Codex JSON-RPC notifications", () => {
    const startedNotif = toAgyNotification({ kind: "turn/started", threadId: "t1", turnId: "turn-1" });
    expect(startedNotif?.method).toBe("turn/started");

    const textDeltaNotif = toAgyNotification({
      kind: "item/agentMessage/delta",
      threadId: "t1",
      turnId: "turn-1",
      itemId: "item-1",
      delta: "Hello"
    });
    expect(textDeltaNotif?.method).toBe("item/agentMessage/delta");

    const completedNotif = toAgyNotification({ kind: "turn/completed", threadId: "t1", turnId: "turn-1" });
    expect(completedNotif?.method).toBe("turn/completed");

    const failedNotif = toAgyNotification({ kind: "turn/failed", threadId: "t1", turnId: "turn-1", error: "boom" });
    expect(failedNotif?.method).toBe("turn/failed");

    const interruptedNotif = toAgyNotification({ kind: "turn/interrupted", threadId: "t1", turnId: "turn-1" });
    expect(interruptedNotif?.method).toBe("turn/interrupted");
  });

  test("preserves final response post-tool in result event without dropping it", () => {
    const ctx = createAgyProjectorContext("thread-agy-1", "turn-agy-1");

    // 1. Initial agent response before tool
    const preToolEvents = projectAgyEvent({
      event: "step_update",
      step_update: {
        step_index: 0,
        step_type: "agent_response",
        text_delta: "I will inspect the repository.",
      },
    }, ctx);
    expect(preToolEvents.some((e) => e.kind === "turn/started")).toBe(true);
    expect(preToolEvents.some((e) => e.kind === "item/started")).toBe(true);
    expect(preToolEvents.some((e) => e.kind === "item/agentMessage/delta")).toBe(true);

    // 2. Tool call arrives - completes pre-tool message and starts tool
    const toolStartEvents = projectAgyEvent({
      event: "step_update",
      step_update: {
        step_index: 1,
        state: "RUNNING",
        tool_calls: [{ id: "call-1", name: "list_dir", input: { path: "." } }],
      },
    }, ctx);
    expect(toolStartEvents.some((e) => e.kind === "item/completed" && e.item.id.includes("turn-agy-1-0"))).toBe(true);
    expect(toolStartEvents.some((e) => e.kind === "item/started" && e.item.id === "call-1")).toBe(true);

    // 3. Tool call completes
    const toolEndEvents = projectAgyEvent({
      event: "step_update",
      step_update: {
        step_index: 2,
        state: "DONE",
        tool_calls: [{ id: "call-1", name: "list_dir", input: { path: "." } }],
      },
    }, ctx);
    expect(toolEndEvents.some((e) => e.kind === "item/completed" && e.item.id === "call-1")).toBe(true);

    // 4. Result event with final response (the post-tool answer)
    const resultEvents = projectAgyEvent({
      event: "result",
      result: {
        conversation_id: "conv-1",
        status: "SUCCESS",
        response: "Repository inspection complete: found 12 files.",
      },
    }, ctx);

    // Must NOT drop the post-tool response!
    const postToolStarted = resultEvents.find((e) => e.kind === "item/started");
    expect(postToolStarted).toBeDefined();
    const postToolCompleted = resultEvents.find((e) => e.kind === "item/completed");
    expect(postToolCompleted).toBeDefined();
    if (postToolCompleted?.kind === "item/completed") {
      expect(postToolCompleted.item.text).toBe("Repository inspection complete: found 12 files.");
      expect(postToolCompleted.item.id).toContain("turn-agy-1-1");
    }
    expect(resultEvents.some((e) => e.kind === "turn/completed")).toBe(true);
  });

  test("preserves streamed post-tool response deltas and appends remaining text on result", () => {
    const ctx = createAgyProjectorContext("thread-agy-2", "turn-agy-2");

    // Pre-tool
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 0, step_type: "agent_response", text_delta: "Running tool..." },
    }, ctx);

    // Tool
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 1, state: "DONE", tool_calls: [{ id: "c1", name: "exec" }] },
    }, ctx);

    // Post-tool streaming
    const postStream = projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 2, step_type: "agent_response", text_delta: "Tool succeeded. " },
    }, ctx);
    expect(postStream.some((e) => e.kind === "item/started")).toBe(true);
    expect(postStream.some((e) => e.kind === "item/agentMessage/delta")).toBe(true);

    // Result event containing full final text
    const resEvents = projectAgyEvent({
      event: "result",
      result: {
        conversation_id: "conv-2",
        status: "SUCCESS",
        response: "Tool succeeded. Here are the details.",
      },
    }, ctx);

    // Should emit delta for the remaining portion
    const deltaEv = resEvents.find((e) => e.kind === "item/agentMessage/delta");
    expect(deltaEv).toBeDefined();
    if (deltaEv?.kind === "item/agentMessage/delta") {
      expect(deltaEv.delta).toBe("Here are the details.");
    }
    const compEv = resEvents.find((e) => e.kind === "item/completed");
    expect(compEv).toBeDefined();
    if (compEv?.kind === "item/completed") {
      expect(compEv.item.text).toBe("Tool succeeded. Here are the details.");
    }
  });

  test("starts a new segment with new reasoning ID when thinking_delta arrives after tool execution", () => {
    const ctx = createAgyProjectorContext("thread-agy-thought", "turn-agy-thought");

    // 1. Pre-tool message
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 0, step_type: "agent_response", text_delta: "Inspecting codebase..." },
    }, ctx);

    // 2. Tool call completes prior segment
    const toolStart = projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 1, state: "RUNNING", tool_calls: [{ id: "c1", name: "read_file" }] },
    }, ctx);
    expect(toolStart.some((e) => e.kind === "item/completed" && e.item.id.includes("turn-agy-thought-0"))).toBe(true);

    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 2, state: "DONE", tool_calls: [{ id: "c1", name: "read_file" }] },
    }, ctx);

    // 3. Thinking delta arrives after tool execution
    const thinkEvents = projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 3, thinking_delta: "Analyzing read_file results..." },
    }, ctx);

    const thinkDelta = thinkEvents.find((e) => e.kind === "item/reasoning/textDelta");
    expect(thinkDelta).toBeDefined();
    if (thinkDelta && thinkDelta.kind === "item/reasoning/textDelta") {
      expect(thinkDelta.itemId).toBe("agy-thought-turn-agy-thought-1");
      expect(thinkDelta.delta).toBe("Analyzing read_file results...");
    }

    // 4. Text delta arrives for this second segment
    const textEvents = projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 4, step_type: "agent_response", text_delta: "Analysis complete." },
    }, ctx);

    const msgStarted = textEvents.find((e) => e.kind === "item/started");
    expect(msgStarted).toBeDefined();
    if (msgStarted && msgStarted.kind === "item/started") {
      expect(msgStarted.item.id).toBe("agy-msg-turn-agy-thought-1");
    }

    // 5. Result completes the turn
    const resEvents = projectAgyEvent({
      event: "result",
      result: {
        conversation_id: "conv-agy-thought",
        status: "SUCCESS",
        response: "Analysis complete.",
      },
    }, ctx);

    const compMsg = resEvents.find((e) => e.kind === "item/completed" && e.item.type === "agentMessage" && e.item.id.includes("turn-agy-thought-1"));
    expect(compMsg).toBeDefined();
    if (compMsg && compMsg.kind === "item/completed") {
      expect(compMsg.item.id).toBe("agy-msg-turn-agy-thought-1");
      expect(compMsg.item.text).toBe("Analysis complete.");
      const content = compMsg.item.content as any[];
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: "reasoning", text: "Analyzing read_file results..." });
      expect(content[1]).toEqual({ type: "text", text: "Analysis complete.", text_elements: [] });
    }
  });

  test("deduplicates full session transcript in result.response against assistantText", () => {
    const ctx = createAgyProjectorContext("thread-agy-dedup", "turn-agy-dedup");

    // Pre-tool streaming: "Initial plan.\n"
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 0, step_type: "agent_response", text_delta: "Initial plan.\n" },
    }, ctx);

    // Tool call completes
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 1, state: "RUNNING", tool_calls: [{ id: "t1", name: "run" }] },
    }, ctx);
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 2, state: "DONE", tool_calls: [{ id: "t1", name: "run" }] },
    }, ctx);

    // Post-tool streaming: "Execution succeeded."
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 3, step_type: "agent_response", text_delta: "Execution succeeded." },
    }, ctx);

    // Result event arrives where agy.exe returned the full cumulative transcript
    const resEvents = projectAgyEvent({
      event: "result",
      result: {
        conversation_id: "conv-dedup",
        status: "SUCCESS",
        response: "Initial plan.\nExecution succeeded.",
      },
    }, ctx);

    // Because "Initial plan.\nExecution succeeded." is already fully accounted for in ctx.assistantText,
    // it must NOT create another segment or emit duplicate deltas!
    const extraStarted = resEvents.filter((e) => e.kind === "item/started");
    expect(extraStarted).toHaveLength(0);
    expect(resEvents.some((e) => e.kind === "turn/completed")).toBe(true);
  });

  test("completes reasoning item when assistant segment completes before tools", () => {
    const ctx = createAgyProjectorContext("thread-reason-done", "turn-reason-done");
    ctx.hasStartedTurn = true;

    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 0, thinking_delta: "Let me think..." },
    }, ctx);
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 1, step_type: "agent_response", text_delta: "Starting work." },
    }, ctx);

    const toolEvents = projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 2, state: "RUNNING", tool_calls: [{ id: "bg-1", name: "run_background", input: {} }] },
    }, ctx);
    const reasonDone = toolEvents.find((e) => e.kind === "item/completed" && (e as any).item?.type === "reasoning");
    expect(reasonDone).toBeDefined();

    const resEvents = projectAgyEvent({
      event: "result",
      result: { conversation_id: "c", status: "SUCCESS", response: "Starting work." },
    }, ctx);
    const bgDone = resEvents.find((e) => e.kind === "item/completed" && (e as any).item?.id === "bg-1");
    expect(bgDone).toBeDefined();
    expect(ctx.status).toBe("completed");
  });

  test("forceTerminateAgy surfaces stderr detail and settles pending tools", () => {
    const ctx = createAgyProjectorContext("thread-force", "turn-force");
    ctx.hasStartedTurn = true;
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 0, thinking_delta: "hmm..." },
    }, ctx);
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 1, state: "RUNNING", tool_calls: [{ id: "bg-9", name: "background_task" }] },
    }, ctx);
    const events = forceTerminateAgy(ctx, "failed", "Process exited (code=1): auth expired");
    const failed = events.find((e) => e.kind === "turn/failed");
    expect(failed).toBeDefined();
    if (failed?.kind === "turn/failed") {
      expect(failed.error).toContain("auth expired");
    }
    const toolDone = events.find((e) => e.kind === "item/completed" && (e as any).item?.id === "bg-9");
    expect(toolDone).toBeDefined();
  });

  test("completes reasoning when directly followed by tool call without intermediate text", () => {
    const ctx = createAgyProjectorContext("thread-think-tool", "turn-think-tool");
    ctx.hasStartedTurn = true;

    // Pure thinking, no agent_response
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 0, thinking_delta: "Thinking directly before tool call..." },
    }, ctx);

    // Tool call arrives immediately
    const toolEvents = projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 1, state: "RUNNING", tool_calls: [{ id: "tool-direct", name: "execute" }] },
    }, ctx);

    const reasonDone = toolEvents.find((e) => e.kind === "item/completed" && (e as any).item?.type === "reasoning");
    expect(reasonDone).toBeDefined();
    expect((reasonDone as any).item?.text).toBe("Thinking directly before tool call...");
    expect((reasonDone as any).item?.status).toBe("completed");
  });

  test("completes reasoning when turn has only thinking followed by result", () => {
    const ctx = createAgyProjectorContext("thread-think-res", "turn-think-res");
    ctx.hasStartedTurn = true;

    // Pure thinking
    projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 0, thinking_delta: "Reflecting on question..." },
    }, ctx);

    // Result arrives with final response
    const resEvents = projectAgyEvent({
      event: "result",
      result: { conversation_id: "c-res", status: "SUCCESS", response: "Final answer." },
    }, ctx);

    const reasonDone = resEvents.find((e) => e.kind === "item/completed" && (e as any).item?.type === "reasoning");
    expect(reasonDone).toBeDefined();
    expect((reasonDone as any).item?.text).toBe("Reflecting on question...");
    expect((reasonDone as any).item?.status).toBe("completed");

    const msgDone = resEvents.find((e) => e.kind === "item/completed" && (e as any).item?.type === "agentMessage");
    expect(msgDone).toBeDefined();
    expect((msgDone as any).item?.status).toBe("completed");
    expect(ctx.status).toBe("completed");
  });

  test("projects ask_question tool call into question/asked event", () => {
    const ctx = createAgyProjectorContext("thread-1", "turn-1");
    ctx.hasStartedTurn = true;

    const event: AgyEvent = {
      event: "step_update",
      step_update: {
        step_index: 1,
        state: "DONE",
        step_type: "agent_response",
        tool_calls: [{
          id: "call-ask-1",
          name: "ask_question",
          input: {
            questions: JSON.stringify([
              { is_multi_select: false, options: ["方案 A", "方案 B"], question: "选哪个方案？" }
            ]),
          },
        }],
      },
    };

    const projected = projectAgyEvent(event, ctx);
    const questionEvent = projected.find((e) => e.kind === "question/asked");
    expect(questionEvent).toBeDefined();
    if (questionEvent && questionEvent.kind === "question/asked") {
      expect(questionEvent.questions.length).toBe(1);
      expect(questionEvent.questions[0].question).toBe("选哪个方案？");
      expect(questionEvent.questions[0].options.length).toBe(2);
      expect(questionEvent.questions[0].options[0].label).toBe("方案 A");
      expect(questionEvent.questions[0].options[1].label).toBe("方案 B");
    }
    expect(ctx.pendingQuestionId).toBe("agy-ask-turn-1-1");
    expect(ctx.awaitingQuestion).toBe(true);

    // Tool call item should also be emitted
    const toolStarted = projected.find((e) => e.kind === "item/started" && (e as any).item?.name === "ask_question");
    expect(toolStarted).toBeDefined();
  });

  test("projects ask_question from step_type=tool format into question/asked event", () => {
    const ctx = createAgyProjectorContext("thread-1", "turn-1");
    ctx.hasStartedTurn = true;

    const event: AgyEvent = {
      event: "step_update",
      step_update: {
        step_index: 2,
        state: "DONE",
        step_type: "tool",
        tool_name: "ask_question",
        tool_info: {
          name: "ask_question",
          parameters: {
            questions: JSON.stringify([{ question: "确认继续？", options: ["是", "否"] }]),
          },
        },
      },
    } as any;

    const projected = projectAgyEvent(event, ctx);
    const questionEvent = projected.find((e) => e.kind === "question/asked");
    expect(questionEvent).toBeDefined();
    if (questionEvent && questionEvent.kind === "question/asked") {
      expect(questionEvent.questions[0].question).toBe("确认继续？");
      expect(questionEvent.questions[0].options.length).toBe(2);
    }
    expect(ctx.awaitingQuestion).toBe(true);
  });

  test("keeps tool params arriving under args (not just input)", () => {
    const ctx = createAgyProjectorContext("thread-args", "turn-args");
    const events = projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 0, state: "DONE", tool_calls: [{ id: "c9", name: "exec", args: { cmd: "git status" } }] },
    }, ctx);
    const completed = events.find((e) => e.kind === "item/completed");
    expect(completed).toBeDefined();
    if (completed?.kind === "item/completed") {
      expect(completed.item.toolName).toBe("exec");
      expect(completed.item.arguments).toEqual({ cmd: "git status" });
      expect(completed.item.input).toEqual({ cmd: "git status" });
    }
  });

  test("falls back to tool summary text when a call carries no params", () => {
    const ctx = createAgyProjectorContext("thread-sum", "turn-sum");
    const events = projectAgyEvent({
      event: "step_update",
      step_update: { step_index: 0, state: "DONE", tool_calls: [{ id: "c10", name: "exec", toolSummary: "ran tests" }] },
    }, ctx);
    const completed = events.find((e) => e.kind === "item/completed");
    expect(completed).toBeDefined();
    if (completed?.kind === "item/completed") {
      expect(completed.item.output).toBe("ran tests");
    }
  });
});

describe("parseAskQuestionData", () => {
  test("parses JSON string of questions with options", () => {
    const raw = JSON.stringify([
      { is_multi_select: false, options: ["A", "B", "C"], question: "Choose one" }
    ]);
    const result = parseAskQuestionData(raw, 0);
    expect(result.length).toBe(1);
    expect(result[0].question).toBe("Choose one");
    expect(result[0].options.length).toBe(3);
    expect(result[0].options[0].label).toBe("A");
  });

  test("parses plain string as fallback question", () => {
    const result = parseAskQuestionData("Are you sure?", 0);
    expect(result.length).toBe(1);
    expect(result[0].question).toBe("Are you sure?");
    expect(result[0].options.length).toBe(1);
    expect(result[0].options[0].label).toBe("Are you sure?");
  });

  test("parses array of question objects directly", () => {
    const result = parseAskQuestionData([
      { question: "Q1", options: ["X", "Y"] },
      { question: "Q2", options: [{ label: "Z", description: "The Z option" }] },
    ], 5);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe("q-5-0");
    expect(result[1].options[0].description).toBe("The Z option");
  });

  test("passes through is_multi_select and header fallback (real agy shape)", () => {
    const result = parseAskQuestionData([
      { question: "选哪个方案?", options: ["Session", "JWT"], is_multi_select: false },
      { question: "还要考虑什么?", options: ["SSO", "多端"], is_multi_select: true },
    ], 1, "Asking authentication requirements");
    expect(result.length).toBe(2);
    expect(result[0].multiSelect).toBe(false);
    expect(result[1].multiSelect).toBe(true);
    expect(result[0].header).toBe("Asking authentication requirements");
    expect(result[0].options[0]).toEqual({ label: "Session", description: "" });
  });

  test("parses plain string items inside array", () => {
    const result = parseAskQuestionData(["A", "B"], 2);
    expect(result.length).toBe(2);
    expect(result[0].question).toBe("A");
    expect(result[0].options[0].label).toBe("A");
  });

  test("returns empty array for null/undefined", () => {
    expect(parseAskQuestionData(null, 0)).toEqual([]);
    expect(parseAskQuestionData(undefined, 0)).toEqual([]);
  });
});

describe("parseAgyAskAnswerContent", () => {
  test("parses A1/A2 answer lines", async () => {
    const mod = await import("../../backends/agy/src/runtime/agyCompatibleTurnProjector.js");
    const parsed = mod.parseAgyAskAnswerContent("Created At: x\nA1: Session\nA2: SSO\nA3: 小团队");
    expect(parsed).not.toBeNull();
    expect(parsed!.answers).toEqual(["Session", "SSO", "小团队"]);
    expect(parsed!.allSkipped).toBe(false);
  });
  test("detects all skipped", async () => {
    const mod = await import("../../backends/agy/src/runtime/agyCompatibleTurnProjector.js");
    const parsed = mod.parseAgyAskAnswerContent("A1: User Skipped\nA2: User Skipped");
    expect(parsed!.allSkipped).toBe(true);
  });
  test("returns null when no answer lines", async () => {
    const mod = await import("../../backends/agy/src/runtime/agyCompatibleTurnProjector.js");
    expect(mod.parseAgyAskAnswerContent("hello world")).toBeNull();
    expect(mod.parseAgyAskAnswerContent(null)).toBeNull();
  });
});

describe("extractUserInputAnswer", () => {
  test("extracts answer from standard answers format", () => {
    const result = extractUserInputAnswer({
      answers: {
        "q-0-0": { answers: ["方案 B"] },
      },
    });
    expect(result).toBe("方案 B");
  });

  test("extracts user_note from answers", () => {
    const result = extractUserInputAnswer({
      answers: {
        "q-0-0": { answers: ["user_note: 我选自定义方案"] },
      },
    });
    expect(result).toBe("我选自定义方案");
  });

  test("falls back to decision field", () => {
    const result = extractUserInputAnswer({ decision: "accept" });
    expect(result).toBe("accept");
  });

  test("returns empty string for null", () => {
    expect(extractUserInputAnswer(null)).toBe("");
    expect(extractUserInputAnswer(undefined)).toBe("");
  });
});
