import { describe, expect, test } from "bun:test";
import {
  createOpencodeProjectorContext,
  projectOpencodeEvent,
  toOpencodeNotification,
  forceTerminateOpencode,
  extractOpencodePlanSteps,
  normalizeOpencodeQuestions,
  opencodeQuestionAnswersFromResponse,
  OPENCODE_UPSTREAM_RETRY_GRACE_MS,
} from "../../backends/opencode/src/runtime/opencodeCompatibleTurnProjector.js";
import type {
  OpencodeMessagePartDeltaEvent,
  OpencodeMessagePartUpdatedEvent,
  OpencodePermissionAskedEvent,
  OpencodeSessionErrorEvent,
  OpencodeSessionIdleEvent,
} from "../../backends/opencode/src/runtime/opencodeCompatibleProtocol.js";

describe("opencodeCompatibleTurnProjector", () => {
  test("emits turn/started on first event", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const ev: OpencodeMessagePartDeltaEvent = {
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "Hello",
      },
    };
    const projected = projectOpencodeEvent(ev, ctx);
    expect(projected[0].kind).toBe("turn/started");
    expect(ctx.hasStartedTurn).toBe(true);
  });

  test("projects text and reasoning deltas correctly", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");

    // Reasoning delta
    const reasonEv: OpencodeMessagePartDeltaEvent = {
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "prt_think",
        field: "reasoning",
        delta: "Thinking...",
      },
    };
    const p1 = projectOpencodeEvent(reasonEv, ctx);
    expect(p1.some((e) => e.kind === "item/reasoning/textDelta")).toBe(true);

    // Text delta
    const textEv: OpencodeMessagePartDeltaEvent = {
      id: "2",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "prt_text",
        field: "text",
        delta: "The answer is 42",
      },
    };
    const p2 = projectOpencodeEvent(textEv, ctx);
    expect(p2.some((e) => e.kind === "item/started")).toBe(true);
    expect(p2.some((e) => e.kind === "item/agentMessage/delta")).toBe(true);
  });

  test("preserves causal text -> tool -> text interleaving with new segments", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");

    // 1. Initial assistant text segment (0)
    const text1: OpencodeMessagePartDeltaEvent = {
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p_text_1",
        field: "text",
        delta: "Let me check the files.",
      },
    };
    const p1 = projectOpencodeEvent(text1, ctx);
    expect(ctx.textSegmentSeq).toBe(0);
    expect(ctx.hasStartedCurrentAssistantMessage).toBe(true);

    // 2. Tool arrival: MUST complete current assistant message before starting tool
    const toolStart: OpencodeMessagePartUpdatedEvent = {
      id: "2",
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          id: "p_tool_1",
          sessionID: "s1",
          messageID: "m1",
          type: "tool",
          callID: "call_read_1",
          tool: "read_file",
          state: {
            status: "running",
            input: { path: "package.json" },
          },
        },
      },
    };
    const p2 = projectOpencodeEvent(toolStart, ctx);
    // p2 must have completed the message and started the tool
    const completedMsg = p2.find((e) => e.kind === "item/completed" && (e as any).item.type === "agentMessage");
    const startedTool = p2.find((e) => e.kind === "item/started" && (e as any).item.type === "toolCall");
    expect(completedMsg).toBeDefined();
    expect(startedTool).toBeDefined();
    expect(ctx.hasCompletedCurrentAssistantMessage).toBe(true);

    // 3. Tool completes
    const toolEnd: OpencodeMessagePartUpdatedEvent = {
      id: "3",
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          id: "p_tool_1",
          sessionID: "s1",
          messageID: "m1",
          type: "tool",
          callID: "call_read_1",
          tool: "read_file",
          state: {
            status: "completed",
            output: '{"name": "codex-ultra"}',
          },
        },
      },
    };
    const p3 = projectOpencodeEvent(toolEnd, ctx);
    const completedTool = p3.find((e) => e.kind === "item/completed" && (e as any).item.type === "toolCall");
    expect(completedTool).toBeDefined();
    expect((completedTool as any).item.status).toBe("completed");

    // 4. Post-tool assistant text arrives: MUST advance to segment 1 with new message ID
    const text2: OpencodeMessagePartDeltaEvent = {
      id: "4",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p_text_2",
        field: "text",
        delta: "The package name is codex-ultra.",
      },
    };
    const p4 = projectOpencodeEvent(text2, ctx);
    expect(ctx.textSegmentSeq).toBe(1);
    expect(ctx.currentAssistantItemId).toBe("opencode-msg-turn1-1");
    const startedMsg2 = p4.find((e) => e.kind === "item/started" && (e as any).item.type === "agentMessage");
    expect(startedMsg2).toBeDefined();
    expect((startedMsg2 as any).item.id).toBe("opencode-msg-turn1-1");

    // 5. Session idle completes the turn and second assistant message
    // (quiescence: back-date activity so the deferred-idle guard passes).
    ctx.lastActivityMs = Date.now() - 3000;
    const idle: OpencodeSessionIdleEvent = {
      id: "5",
      type: "session.idle",
      properties: { sessionID: "s1" },
    };
    const p5 = projectOpencodeEvent(idle, ctx);
    const completedMsg2 = p5.find((e) => e.kind === "item/completed" && (e as any).item.id === "opencode-msg-turn1-1");
    const turnCompleted = p5.find((e) => e.kind === "turn/completed");
    expect(completedMsg2).toBeDefined();
    expect(turnCompleted).toBeDefined();
    expect(ctx.status).toBe("completed");
  });

  test("projects permission.asked to approval request", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const ask: OpencodePermissionAskedEvent = {
      id: "1",
      type: "permission.asked",
      properties: {
        id: "per_cmd_1",
        sessionID: "s1",
        permission: "bash",
        patterns: ["rm -rf /tmp/test"],
      },
    };
    const projected = projectOpencodeEvent(ask, ctx);
    const permEvent = projected.find((e) => e.kind === "permission/asked");
    expect(permEvent).toBeDefined();

    const notif = toOpencodeNotification(permEvent!);
    expect(notif?.method).toBe("item/commandExecution/requestApproval");
    expect((notif?.params as any).id).toBe("per_cmd_1");
    expect((notif?.params as any).toolName).toBe("bash");
  });

  test("projects session.error to turn/failed", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const err: OpencodeSessionErrorEvent = {
      id: "1",
      type: "session.error",
      properties: {
        sessionID: "s1",
        error: { message: "Context window exceeded" },
      },
    };
    const projected = projectOpencodeEvent(err, ctx);
    const failEvent = projected.find((e) => e.kind === "turn/failed");
    expect(failEvent).toBeDefined();
    expect((failEvent as any).error).toBe("Context window exceeded");
    expect(ctx.status).toBe("failed");
  });

  test("keeps transient session.error retryable until the third Codex-style failure", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn-session-error-retry");
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const projected = projectOpencodeEvent({
        id: String(attempt),
        type: "session.error",
        properties: { sessionID: "s1", error: { message: "Upstream HTTP 503 Service Unavailable" } },
      }, ctx);
      expect(projected.find((event) => event.kind === "turn/failed")).toBeUndefined();
      expect(ctx.status).toBe("running");
      expect(ctx.upstreamRetryAttempts).toBe(attempt);
    }
    const exhausted = projectOpencodeEvent({
      id: "3",
      type: "session.error",
      properties: { sessionID: "s1", error: { message: "Upstream HTTP 503 Service Unavailable" } },
    }, ctx);
    expect(exhausted.find((event) => event.kind === "turn/failed")).toBeDefined();
    expect(ctx.status).toBe("failed");
  });

  test("forceTerminateOpencode completes in-progress items and sets terminal state", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    // Start an assistant message
    projectOpencodeEvent({
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "Starting work...",
      },
    }, ctx);

    const termEvents = forceTerminateOpencode(ctx, "interrupted");
    expect(termEvents.some((e) => e.kind === "item/completed")).toBe(true);
    expect(termEvents.some((e) => e.kind === "turn/interrupted")).toBe(true);
    expect(ctx.status).toBe("interrupted");
  });

  test("projects session.status retry free_tier_limit to turn/failed", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    // Emit turn/started
    projectOpencodeEvent({
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "Trying model...",
      },
    }, ctx);

    const statusEv = {
      id: "2",
      type: "session.status" as const,
      properties: {
        sessionID: "s1",
        status: {
          type: "retry" as const,
          attempt: 1,
          message: "free_tier_limit",
        },
      },
    };
    const projected = projectOpencodeEvent(statusEv, ctx);
    const failEvent = projected.find((e) => e.kind === "turn/failed");
    expect(failEvent).toBeDefined();
    expect((failEvent as any).error).toContain("free tier limit reached");
    expect(ctx.status).toBe("failed");
  });

  test("projects reasoning item/started and item/completed properly", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");

    // 1. Reasoning part updated emits item/started
    const reasonEv = {
      id: "1",
      type: "message.part.updated" as const,
      properties: {
        sessionID: "s1",
        part: {
          id: "r1",
          sessionID: "s1",
          messageID: "m1",
          type: "reasoning" as const,
          text: "Deep thinking...",
        },
      },
    };
    const p1 = projectOpencodeEvent(reasonEv, ctx);
    const startedReasoning = p1.find((e) => e.kind === "item/started" && (e as any).item.type === "reasoning");
    expect(startedReasoning).toBeDefined();
    expect(p1.some((e) => e.kind === "item/reasoning/textDelta")).toBe(true);

    // 2. Subsequent text delta completes reasoning and starts agentMessage
    const textEv: OpencodeMessagePartDeltaEvent = {
      id: "2",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p_text",
        field: "text",
        delta: "Done thinking.",
      },
    };
    const p2 = projectOpencodeEvent(textEv, ctx);
    const completedReasoning = p2.find((e) => e.kind === "item/completed" && (e as any).item.type === "reasoning");
    expect(completedReasoning).toBeDefined();
    const startedAgentMsg = p2.find((e) => e.kind === "item/started" && (e as any).item.type === "agentMessage");
    expect(startedAgentMsg).toBeDefined();
  });

  test("ignores stale idle events on a fresh turn without activity", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const idle: OpencodeSessionIdleEvent = {
      id: "1",
      type: "session.idle",
      properties: { sessionID: "s1" },
    };
    const projected = projectOpencodeEvent(idle, ctx);
    expect(projected.find((e) => e.kind === "turn/completed")).toBeUndefined();
    expect(ctx.status).toBe("running");

    const statusIdle = {
      id: "2",
      type: "session.status" as const,
      properties: {
        sessionID: "s1",
        status: { type: "idle" as const },
      },
    };
    const projected2 = projectOpencodeEvent(statusIdle, ctx);
    expect(projected2.find((e) => e.kind === "turn/completed")).toBeUndefined();
    expect(ctx.status).toBe("running");
  });

  test("idle completes a fresh turn once activity was observed and quiet", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    projectOpencodeEvent({
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "answer",
      },
    }, ctx);
    ctx.lastActivityMs = Date.now() - 3000;
    const idle: OpencodeSessionIdleEvent = {
      id: "2",
      type: "session.idle",
      properties: { sessionID: "s1" },
    };
    const projected = projectOpencodeEvent(idle, ctx);
    expect(projected.find((e) => e.kind === "turn/completed")).toBeDefined();
    expect(ctx.status).toBe("completed");
  });

  test("idle defers when activity is too recent, completes after quiescence", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn-defer");
    projectOpencodeEvent({
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "streaming...",
      },
    }, ctx);
    const earlyIdle: OpencodeSessionIdleEvent = {
      id: "2",
      type: "session.idle",
      properties: { sessionID: "s1" },
    };
    const early = projectOpencodeEvent(earlyIdle, ctx);
    expect(early.find((e) => e.kind === "turn/completed")).toBeUndefined();
    expect(ctx.status).toBe("running");
    expect(ctx.deferredIdleAtMs).not.toBeNull();
    ctx.lastActivityMs = Date.now() - 3000;
    const lateIdle: OpencodeSessionIdleEvent = {
      id: "3",
      type: "session.idle",
      properties: { sessionID: "s1" },
    };
    const late = projectOpencodeEvent(lateIdle, ctx);
    expect(late.find((e) => e.kind === "turn/completed")).toBeDefined();
    expect(ctx.status).toBe("completed");
  });

  test("transient 429 stays running and completes after the retry recovers", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn-upstream-429");
    projectOpencodeEvent({
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "partial answer",
      },
    }, ctx);
    const retry = projectOpencodeEvent({
      id: "2",
      type: "session.status",
      properties: { sessionID: "s1", status: { type: "retry", attempt: 1, message: "HTTP 429 Too Many Requests" } },
    } as any, ctx);
    expect(retry.find((event) => event.kind === "turn/failed" || event.kind === "turn/completed")).toBeUndefined();
    expect(ctx.status).toBe("running");
    expect(ctx.upstreamRetryAttempts).toBe(1);

    const earlyIdle = projectOpencodeEvent({
      id: "3",
      type: "session.idle",
      properties: { sessionID: "s1" },
    } as OpencodeSessionIdleEvent, ctx);
    expect(earlyIdle.find((event) => event.kind === "turn/failed" || event.kind === "turn/completed")).toBeUndefined();

    projectOpencodeEvent({
      id: "4",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: " and recovered",
      },
    }, ctx);
    expect(ctx.upstreamIssueAtMs).toBeNull();
    ctx.lastActivityMs = Date.now() - 3000;
    const completed = projectOpencodeEvent({
      id: "5",
      type: "session.idle",
      properties: { sessionID: "s1" },
    } as OpencodeSessionIdleEvent, ctx);
    expect(completed.find((event) => event.kind === "turn/completed")).toBeDefined();
    expect(ctx.status).toBe("completed");
  });

  test("transient 5xx fails only after Codex retry-attempt threshold", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn-upstream");
    for (let attempt = 1; attempt < 3; attempt += 1) {
      const retryOut = projectOpencodeEvent({
        id: String(attempt),
        type: "session.status",
        properties: {
          sessionID: "s1",
          status: { type: "retry", attempt, message: "upstream HTTP 503 Service Unavailable" },
        },
      } as any, ctx);
      expect(retryOut.find((event) => event.kind === "turn/failed")).toBeUndefined();
      expect(ctx.status).toBe("running");
    }
    const exhausted = projectOpencodeEvent({
      id: "3",
      type: "session.status",
      properties: {
        sessionID: "s1",
        status: { type: "retry", attempt: 3, message: "upstream HTTP 503 Service Unavailable" },
      },
    } as any, ctx);
    expect(exhausted.find((event) => event.kind === "turn/failed")).toBeDefined();
    expect(ctx.status).toBe("failed");
    const idle: OpencodeSessionIdleEvent = {
      id: "3",
      type: "session.idle",
      properties: { sessionID: "s1" },
    };
    const out = projectOpencodeEvent(idle, ctx);
    expect(out.find((e) => e.kind === "turn/completed")).toBeUndefined();
  });

  test("weak upstream hint fails at Codex stalled-time threshold, with recovery completes", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn-upstream-weak");
    projectOpencodeEvent({
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "partial answer",
      },
    }, ctx);
    projectOpencodeEvent({
      id: "2",
      type: "session.status",
      properties: {
        sessionID: "s1",
        status: { type: "retry", attempt: 1, message: "socket hang up, will retry" },
      },
    } as any, ctx);
    expect(ctx.status).toBe("running");
    // Quiet with no recovery streaming: idle must fail, not complete.
    ctx.lastActivityMs = Date.now() - OPENCODE_UPSTREAM_RETRY_GRACE_MS - 1;
    if (ctx.upstreamIssueAtMs != null) ctx.upstreamIssueAtMs = Date.now() - OPENCODE_UPSTREAM_RETRY_GRACE_MS - 1;
    const idle: OpencodeSessionIdleEvent = {
      id: "3",
      type: "session.idle",
      properties: { sessionID: "s1" },
    };
    const out = projectOpencodeEvent(idle, ctx);
    expect(out.find((e) => e.kind === "turn/completed")).toBeUndefined();
    expect(out.find((e) => e.kind === "turn/failed")).toBeDefined();
    expect(ctx.status).toBe("failed");
  });

  test("session.status idle defers on recent activity, completes after quiescence", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn-status-idle");
    projectOpencodeEvent({
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "streaming...",
      },
    }, ctx);
    const statusIdle = {
      id: "2",
      type: "session.status" as const,
      properties: { sessionID: "s1", status: { type: "idle" as const } },
    };
    const early = projectOpencodeEvent(statusIdle, ctx);
    expect(early.find((e) => e.kind === "turn/completed")).toBeUndefined();
    expect(ctx.status).toBe("running");
    expect(ctx.deferredIdleAtMs).not.toBeNull();
    ctx.lastActivityMs = Date.now() - 3000;
    const late = projectOpencodeEvent({ ...statusIdle, id: "3" }, ctx);
    expect(late.find((e) => e.kind === "turn/completed")).toBeDefined();
    expect(ctx.status).toBe("completed");
  });

  test("session.status busy clears deferred idle and keeps turn running", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn-busy");
    projectOpencodeEvent({
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "working...",
      },
    }, ctx);
    const statusIdle = {
      id: "2",
      type: "session.status" as const,
      properties: { sessionID: "s1", status: { type: "idle" as const } },
    };
    projectOpencodeEvent(statusIdle, ctx);
    expect(ctx.deferredIdleAtMs).not.toBeNull();
    projectOpencodeEvent({
      id: "3",
      type: "session.status",
      properties: { sessionID: "s1", status: { type: "busy" } },
    } as any, ctx);
    expect(ctx.deferredIdleAtMs).toBeNull();
    expect(ctx.status).toBe("running");
    // Busy counts as activity: a subsequent immediate idle must defer again.
    const again = projectOpencodeEvent({ ...statusIdle, id: "4" }, ctx);
    expect(again.find((e) => e.kind === "turn/completed")).toBeUndefined();
    expect(ctx.status).toBe("running");
  });

  test("recovery streaming after weak retry lets quiet idle complete", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn-recover");
    projectOpencodeEvent({
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "partial",
      },
    }, ctx);
    projectOpencodeEvent({
      id: "2",
      type: "session.status",
      properties: {
        sessionID: "s1",
        status: { type: "retry", attempt: 1, message: "socket hang up, will retry" },
      },
    } as any, ctx);
    expect(ctx.upstreamIssueAtMs).not.toBeNull();
    // Recovery: new model output after the retry clears the failure taint.
    projectOpencodeEvent({
      id: "3",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: " recovered and finished.",
      },
    }, ctx);
    ctx.lastActivityMs = Date.now() - 3000;
    const idle: OpencodeSessionIdleEvent = {
      id: "4",
      type: "session.idle",
      properties: { sessionID: "s1" },
    };
    const out = projectOpencodeEvent(idle, ctx);
    expect(out.find((e) => e.kind === "turn/failed")).toBeUndefined();
    expect(out.find((e) => e.kind === "turn/completed")).toBeDefined();
    expect(ctx.status).toBe("completed");
  });

  test("open toolCall blocks idle until the tool reaches terminal state", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn-toolblock");
    projectOpencodeEvent({
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p_text_1",
        field: "text",
        delta: "Let me read a file.",
      },
    }, ctx);
    const toolState = (status: string) => ({
      id: "2",
      type: "message.part.updated" as const,
      properties: {
        sessionID: "s1",
        part: {
          id: "p_tool_1",
          sessionID: "s1",
          messageID: "m1",
          type: "tool" as const,
          callID: "call_read_9",
          tool: "read_file",
          state: status === "running"
            ? { status, input: { path: "package.json" } }
            : { status, output: '{"ok":true}' },
        },
      },
    });
    projectOpencodeEvent(toolState("running"), ctx);
    // Even with old activity, a running tool must defer idle (Codex parity).
    ctx.lastActivityMs = Date.now() - 3000;
    const blocked: OpencodeSessionIdleEvent = {
      id: "3",
      type: "session.idle",
      properties: { sessionID: "s1" },
    };
    const early = projectOpencodeEvent(blocked, ctx);
    expect(early.find((e) => e.kind === "turn/completed")).toBeUndefined();
    expect(ctx.status).toBe("running");
    projectOpencodeEvent({ ...toolState("completed"), id: "4" }, ctx);
    ctx.lastActivityMs = Date.now() - 3000;
    const done: OpencodeSessionIdleEvent = {
      id: "5",
      type: "session.idle",
      properties: { sessionID: "s1" },
    };
    const late = projectOpencodeEvent(done, ctx);
    expect(late.find((e) => e.kind === "turn/completed")).toBeDefined();
    expect(ctx.status).toBe("completed");
  });

  test("generic retry status waits until the third Codex-style retry attempt", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn-attempt2");
    projectOpencodeEvent({
      id: "1",
      type: "message.part.delta",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "trying...",
      },
    }, ctx);
    const out = projectOpencodeEvent({
      id: "2",
      type: "session.status",
      properties: {
        sessionID: "s1",
        status: { type: "retry", attempt: 2, message: "transient wobble" },
      },
    } as any, ctx);
    expect(out.find((e) => e.kind === "turn/failed")).toBeUndefined();
    expect(ctx.status).toBe("running");
    const exhausted = projectOpencodeEvent({
      id: "3",
      type: "session.status",
      properties: {
        sessionID: "s1",
        status: { type: "retry", attempt: 3, message: "transient wobble" },
      },
    } as any, ctx);
    expect(exhausted.find((e) => e.kind === "turn/failed")).toBeDefined();
    expect(ctx.status).toBe("failed");
  });

  test("surfaces nested session.error data.message (ProviderModelNotFoundError)", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const err: OpencodeSessionErrorEvent = {
      id: "1",
      type: "session.error",
      properties: {
        sessionID: "s1",
        error: { name: "UnknownError", data: { message: "Model not found: default/gemini-3.8-flash." } } as any,
      },
    };
    const projected = projectOpencodeEvent(err, ctx);
    const failEvent = projected.find((e) => e.kind === "turn/failed");
    expect(failEvent).toBeDefined();
    expect((failEvent as any).error).toBe("Model not found: default/gemini-3.8-flash.");
  });

  test("ignores user message parts instead of echoing them as assistant text", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    projectOpencodeEvent({
      id: "0",
      type: "message.updated",
      properties: { info: { id: "msg_user", role: "user" } },
    } as any, ctx);
    const projected = projectOpencodeEvent({
      id: "1",
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          id: "prt_user",
          sessionID: "s1",
          messageID: "msg_user",
          type: "text",
          text: "hi",
        },
      },
    } as OpencodeMessagePartUpdatedEvent, ctx);
    expect(projected.some((e) => e.kind === "item/started")).toBe(false);
    expect(ctx.assistantText).toBe("");
    expect(ctx.hasStartedCurrentAssistantMessage).toBe(false);
  });

  test("tool input survives pending -> running -> completed (no empty params)", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const toolPart = (state: Record<string, unknown>) => ({
      id: "2",
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          id: "p_tool_1",
          sessionID: "s1",
          messageID: "m1",
          type: "tool",
          callID: "call_bash_1",
          tool: "bash",
          state,
        },
      },
    }) as OpencodeMessagePartUpdatedEvent;

    // 1. pending arrives first with empty input (opencode always emits this).
    const p1 = projectOpencodeEvent(toolPart({ status: "pending", input: {}, raw: "" }), ctx);
    const startedEmpty = p1.find((e) => e.kind === "item/started" && (e as any).item.type === "toolCall");
    expect(startedEmpty).toBeDefined();
    expect((startedEmpty as any).item.input).toEqual({});

    // 2. running carries the real arguments: live row must refresh (same id).
    const p2 = projectOpencodeEvent(
      toolPart({ status: "running", input: { command: "ls -la", description: "list files" } }),
      ctx,
    );
    const refreshed = p2.find((e) => e.kind === "item/started" && (e as any).item.type === "toolCall");
    expect(refreshed).toBeDefined();
    expect((refreshed as any).item.input).toEqual({ command: "ls -la", description: "list files" });
    expect((refreshed as any).item.arguments).toEqual({ command: "ls -la", description: "list files" });
    expect((refreshed as any).item.toolName).toBe("bash");

    // 3. completed keeps the authoritative input (not the pending {} snapshot).
    const p3 = projectOpencodeEvent(
      toolPart({ status: "completed", input: { command: "ls -la", description: "list files" }, output: "ok", title: "ls" }),
      ctx,
    );
    const completed = p3.find((e) => e.kind === "item/completed" && (e as any).item.type === "toolCall");
    expect(completed).toBeDefined();
    expect((completed as any).item.status).toBe("completed");
    expect((completed as any).item.input).toEqual({ command: "ls -la", description: "list files" });
    expect((completed as any).item.arguments).toEqual({ command: "ls -la", description: "list files" });
    expect((completed as any).item.toolName).toBe("bash");
  });

  test("completed tool without input inherits the running input", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const toolPart = (state: Record<string, unknown>) => ({
      id: "2",
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          id: "p_tool_1",
          sessionID: "s1",
          messageID: "m1",
          type: "tool",
          callID: "call_read_1",
          tool: "read",
          state,
        },
      },
    }) as OpencodeMessagePartUpdatedEvent;

    projectOpencodeEvent(toolPart({ status: "pending", input: {} }), ctx);
    projectOpencodeEvent(toolPart({ status: "running", input: { filePath: "a.txt" } }), ctx);
    // Some servers omit input on the terminal update; fall back to stored args.
    const p3 = projectOpencodeEvent(toolPart({ status: "completed", output: "content" }), ctx);
    const completed = p3.find((e) => e.kind === "item/completed" && (e as any).item.type === "toolCall");
    expect(completed).toBeDefined();
    expect((completed as any).item.input).toEqual({ filePath: "a.txt" });
  });

  test("todowrite projects a plan item instead of a raw tool row (codex parity)", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const toolPart = (state: Record<string, unknown>) => ({
      id: "2",
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          id: "p_tool_todo",
          sessionID: "s1",
          messageID: "m1",
          type: "tool",
          callID: "call_todo_1",
          tool: "todowrite",
          state,
        },
      },
    }) as OpencodeMessagePartUpdatedEvent;
    const todos = [
      { content: "Write code", status: "in_progress", priority: "high" },
      { content: "Run tests", status: "pending", priority: "medium" },
    ];

    // pending carries no todos: nothing emitted yet (no empty raw row).
    const p1 = projectOpencodeEvent(toolPart({ status: "pending", input: {} }), ctx);
    expect(p1.filter((e) => e.kind === "item/started")).toHaveLength(0);

    // running carries the full list: plan item starts, still no tool row.
    const p2 = projectOpencodeEvent(toolPart({ status: "running", input: { todos } }), ctx);
    const startedPlan = p2.find((e) => e.kind === "item/started" && (e as any).item.type === "plan");
    expect(startedPlan).toBeDefined();
    expect((startedPlan as any).item.id).toBe("opencode-plan-turn1");
    expect((startedPlan as any).item.plan).toEqual([
      { step: "Write code", status: "in_progress" },
      { step: "Run tests", status: "pending" },
    ]);
    expect((startedPlan as any).item.text).toContain("- [ ] Write code _(in progress)_");
    expect(p2.some((e) => (e as any).item?.type === "toolCall")).toBe(false);

    // completed closes the same plan item, still no tool row.
    const doneTodos = [
      { content: "Write code", status: "completed", priority: "high" },
      { content: "Run tests", status: "completed", priority: "medium" },
    ];
    const p3 = projectOpencodeEvent(
      toolPart({ status: "completed", input: { todos: doneTodos }, output: JSON.stringify(doneTodos) }),
      ctx,
    );
    const completedPlan = p3.find((e) => e.kind === "item/completed" && (e as any).item.type === "plan");
    expect(completedPlan).toBeDefined();
    expect((completedPlan as any).item.status).toBe("completed");
    expect(p3.some((e) => (e as any).item?.type === "toolCall")).toBe(false);
  });

  test("todowrite denied before running falls back to a generic tool row", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const toolPart = (state: Record<string, unknown>) => ({
      id: "2",
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          id: "p_tool_todo",
          sessionID: "s1",
          messageID: "m1",
          type: "tool",
          callID: "call_todo_9",
          tool: "todowrite",
          state,
        },
      },
    }) as OpencodeMessagePartUpdatedEvent;

    projectOpencodeEvent(toolPart({ status: "pending", input: {} }), ctx);
    const p2 = projectOpencodeEvent(toolPart({ status: "error", input: {}, error: "Permission denied" }), ctx);
    const started = p2.find((e) => e.kind === "item/started" && (e as any).item.type === "toolCall");
    const completed = p2.find((e) => e.kind === "item/completed" && (e as any).item.type === "toolCall");
    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    expect((completed as any).item.status).toBe("failed");
  });

  test("todo.updated converges onto the same per-turn plan item", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const p1 = projectOpencodeEvent({
      id: "9",
      type: "todo.updated",
      properties: {
        sessionID: "s1",
        todos: [{ content: "A", status: "in_progress", priority: "high" }],
      },
    } as any, ctx);
    const started = p1.find((e) => e.kind === "item/started" && (e as any).item.type === "plan");
    expect(started).toBeDefined();
    expect((started as any).item.id).toBe("opencode-plan-turn1");

    // Identical list again: no duplicate refresh.
    const p2 = projectOpencodeEvent({
      id: "10",
      type: "todo.updated",
      properties: {
        sessionID: "s1",
        todos: [{ content: "A", status: "in_progress", priority: "high" }],
      },
    } as any, ctx);
    expect(p2.some((e) => e.kind === "item/started")).toBe(false);
  });

  test("question.asked normalizes to the requestUserInput shape", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const projected = projectOpencodeEvent({
      id: "7",
      type: "question.asked",
      properties: {
        id: "que_1",
        sessionID: "s1",
        questions: [
          {
            question: "Which target?",
            header: "Build",
            options: [
              { label: "Debug", description: "Slow but debuggable" },
              { label: "Release", description: "Optimized" },
            ],
            multiple: false,
          },
        ],
      },
    } as any, ctx);
    const asked = projected.find((e) => e.kind === "question/asked");
    expect(asked).toBeDefined();
    expect((asked as any).requestId).toBe("que_1");
    expect((asked as any).questions).toEqual([
      {
        id: "q_1",
        question: "Which target?",
        header: "Build",
        custom: true,
        options: [
          { label: "Debug", description: "Slow but debuggable" },
          { label: "Release", description: "Optimized" },
        ],
      },
    ]);
    // Never a notification: the runtime serves it as a serverRequest.
    expect(toOpencodeNotification(asked as any)).toBeNull();
  });

  test("projects OpenCode subtask parts to the Ultra collab agent item", () => {
    const ctx = createOpencodeProjectorContext("parent", "turn-subtask");
    const projected = projectOpencodeEvent({
      id: "event-subtask",
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "prt_subtask",
          sessionID: "ses_parent",
          messageID: "msg_user",
          type: "subtask",
          agent: "explore",
          description: "Inspect the repository",
          prompt: "Find the relevant files",
          childSessionID: "ses_child",
        },
      },
    } as any, ctx);
    const item = projected.find((event) => event.kind === "item/completed") as any;
    expect(item?.item).toMatchObject({
      type: "collabAgentToolCall",
      tool: "task",
      agentRole: "explore",
      agentThreadId: "ses_child",
      receiverThreadIds: ["ses_child"],
      prompt: "Find the relevant files",
    });
  });

  test("projects OpenCode task tool calls with running and completed states", () => {
    const ctx = createOpencodeProjectorContext("parent", "turn-task");
    
    // 1. Running task tool emits item/started with inProgress
    const runningEvents = projectOpencodeEvent({
      id: "event-task-running",
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "prt_task_1",
          callID: "call_task_1",
          sessionID: "ses_parent",
          messageID: "msg_asst",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "explore",
              description: "Search the codebase",
              prompt: "Search for sorting algorithms",
            },
            metadata: {
              sessionId: "ses_child_456",
              parentSessionId: "ses_parent",
            },
          },
        },
      },
    } as any, ctx);

    const started = runningEvents.find((e) => e.kind === "item/started") as any;
    expect(started).toBeDefined();
    expect(started.item).toMatchObject({
      type: "collabAgentToolCall",
      id: "opencode-subtask-call_task_1",
      tool: "task",
      status: "inProgress",
      agentRole: "explore",
      agentName: "Search the codebase",
      agentThreadId: "ses_child_456",
      receiverThreadIds: ["ses_child_456"],
      prompt: "Search for sorting algorithms",
      agentStatus: "running",
      agentsStates: {
        ses_child_456: {
          status: "running",
          message: "Search the codebase",
        },
      },
    });

    // 2. Completed task tool emits item/completed with completed
    const completedEvents = projectOpencodeEvent({
      id: "event-task-completed",
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "prt_task_1",
          callID: "call_task_1",
          sessionID: "ses_parent",
          messageID: "msg_asst",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: {
              subagent_type: "explore",
              description: "Search the codebase",
              prompt: "Search for sorting algorithms",
            },
            metadata: {
              sessionId: "ses_child_456",
            },
            output: '<task id="ses_child_456" state="completed"><task_result>Found files</task_result></task>',
          },
        },
      },
    } as any, ctx);

    const completed = completedEvents.find((e) => e.kind === "item/completed") as any;
    expect(completed).toBeDefined();
    expect(completed.item).toMatchObject({
      type: "collabAgentToolCall",
      id: "opencode-subtask-call_task_1",
      tool: "task",
      status: "completed",
      agentStatus: "completed",
      agentThreadId: "ses_child_456",
      receiverThreadIds: ["ses_child_456"],
      agentsStates: {
        ses_child_456: {
          status: "completed",
          message: "Search the codebase",
        },
      },
    });
  });

  test("collab subtask items carry truncated output for JEV report audits", () => {
    const ctx = createOpencodeProjectorContext("parent", "turn-task-output");
    const events = projectOpencodeEvent({
      id: "event-task-output",
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "prt_task_out",
          callID: "call_task_out",
          sessionID: "ses_parent",
          messageID: "msg_asst",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: {
              subagent_type: "explore",
              description: "Search the codebase",
              prompt: "Search for sorting algorithms",
            },
            metadata: { sessionId: "ses_child_out" },
            output: "Found bubble_sort in src/sort.ts with tests passing.",
          },
        },
      },
    } as any, ctx);
    const completed = events.find((e) => e.kind === "item/completed") as any;
    expect(completed?.item).toMatchObject({
      type: "collabAgentToolCall",
      tool: "task",
      prompt: "Search for sorting algorithms",
      output: "Found bubble_sort in src/sort.ts with tests passing.",
    });

    // Long outputs are truncated so audits stay within budget.
    const ctx2 = createOpencodeProjectorContext("parent", "turn-task-long");
    const longEvents = projectOpencodeEvent({
      id: "event-task-long",
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "prt_task_long",
          callID: "call_task_long",
          sessionID: "ses_parent",
          messageID: "msg_asst",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: { description: "Long job", prompt: "Do it all" },
            metadata: { sessionId: "ses_child_long" },
            output: `x`.repeat(9000),
          },
        },
      },
    } as any, ctx2);
    const longItem = longEvents.find((e) => e.kind === "item/completed") as any;
    expect(typeof longItem?.item?.output).toBe("string");
    expect((longItem?.item?.output as string).length).toBeLessThanOrEqual(6000);
  });

  test("forceTerminateOpencode properly closes inProgress collabAgentToolCall items", () => {
    const ctx = createOpencodeProjectorContext("parent", "turn-term");
    // Start a task tool call
    projectOpencodeEvent({
      id: "ev-start",
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "prt_term",
          callID: "call_term",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: { subagent_type: "test-agent", description: "Running background work" },
            metadata: { sessionId: "ses_sub_999" },
          },
        },
      },
    } as any, ctx);

    // Terminate the turn as interrupted
    const terminatedEvents = forceTerminateOpencode(ctx, "interrupted");
    const completedItem = terminatedEvents.find((e) => e.kind === "item/completed") as any;
    expect(completedItem).toBeDefined();
    expect(completedItem.item.type).toBe("collabAgentToolCall");
    expect(completedItem.item.status).toBe("interrupted");
    expect(completedItem.item.agentStatus).toBe("interrupted");
    expect(completedItem.item.agentsStates["ses_sub_999"].status).toBe("interrupted");
  });

  test("extractOpencodePlanSteps reads input.todos and falls back to JSON output", () => {    expect(extractOpencodePlanSteps({ todos: [{ content: "A", status: "completed" }] })).toEqual([
      { step: "A", status: "completed" },
    ]);
    expect(extractOpencodePlanSteps({}, "not json at all")).toBeNull();
    expect(extractOpencodePlanSteps({}, JSON.stringify([{ content: "B", status: "pending" }]))).toEqual([
      { step: "B", status: "pending" },
    ]);
    expect(extractOpencodePlanSteps({})).toBeNull();
    expect(normalizeOpencodeQuestions([{ header: "x" }])).toEqual([]);
  });

  test("opencodeQuestionAnswersFromResponse maps modal answers in order", () => {    const questions = normalizeOpencodeQuestions([
      { question: "Q1", header: "H1", options: [{ label: "A", description: "" }] },
      { question: "Q2", header: "H2", options: [{ label: "B", description: "" }] },
    ]);
    expect(
      opencodeQuestionAnswersFromResponse(questions, {
        answers: { q_1: { answers: ["A", "user_note: extra detail"] }, q_2: { answers: [] } },
      } as any)
    ).toEqual([["A", "extra detail"], []]);
    // Cancelled modal -> reject path.
    expect(opencodeQuestionAnswersFromResponse(questions, { answers: {} } as any)).toBeNull();
    expect(opencodeQuestionAnswersFromResponse(questions, undefined)).toBeNull();
  });

  test("normalizeOpencodeQuestions defaults custom input to true", () => {
    // Official opencode default: free-text input unless explicitly disabled.
    // The frontend shows the "type your own answer" box on custom !== false.
    const [implicit] = normalizeOpencodeQuestions([{ question: "Q", options: [{ label: "A" }] }]);
    expect(implicit.custom).toBe(true);
    const [explicitOff] = normalizeOpencodeQuestions([{ question: "Q", options: [{ label: "A" }], custom: false }]);
    expect(explicitOff.custom).toBe(false);
    const [explicitOn] = normalizeOpencodeQuestions([{ question: "Q", options: [{ label: "A" }], custom: true }]);
    expect(explicitOn.custom).toBe(true);
  });

  test("step-finish projects thread/tokenUsage/updated with contextUsage and contextWindow", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1", { contextWindow: 128_000 });
    const stepFinishEvent = {
      id: "ev-step-1",
      type: "message.part.updated",
      properties: {
        sessionID: "s1",
        part: {
          id: "part-finish-1",
          sessionID: "s1",
          messageID: "m1",
          type: "step-finish",
          reason: "stop",
          cost: 0.005,
          tokens: {
            total: 1650,
            input: 500,
            output: 800,
            reasoning: 200,
            cache: { read: 100, write: 50 },
          },
        },
      },
    } as any;

    const projected = projectOpencodeEvent(stepFinishEvent, ctx);
    const usageEvent = projected.find((e) => e.kind === "thread/tokenUsage/updated");
    expect(usageEvent).toBeDefined();
    expect((usageEvent as any).threadId).toBe("t1");
    expect((usageEvent as any).turnId).toBe("turn1");

    const usage = (usageEvent as any).tokenUsage;
    expect(usage.total.inputTokens).toBe(500);
    expect(usage.total.outputTokens).toBe(800);
    expect(usage.total.reasoningOutputTokens).toBe(200);
    expect(usage.total.cachedInputTokens).toBe(100);
    expect(usage.total.cacheWriteInputTokens).toBe(50);
    expect(usage.total.totalTokens).toBe(1650);

    // contextUsage has inputTokens + cachedInputTokens, 0 output
    expect(usage.contextUsage.totalTokens).toBe(600);
    expect(usage.contextUsage.outputTokens).toBe(0);
    expect(usage.modelContextWindow).toBe(128_000);

    // Maps to JsonRpcNotification (requestId = stable per-step call identity
    // for ledger dedup, axonhub RequestID equivalent).
    const notif = toOpencodeNotification(usageEvent as any);
    expect(notif).toBeDefined();
    expect(notif?.method).toBe("thread/tokenUsage/updated");
    expect(notif?.params).toEqual({
      threadId: "t1",
      turnId: "turn1",
      tokenUsage: usage,
      requestId: "opencode-turn1-part-finish-1",
    });
    expect((usageEvent as any).requestId).toBe("opencode-turn1-part-finish-1");
  });

  test("step-finish usage keeps a stable requestId across re-emissions", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const part = {
      id: "part-finish-9",
      sessionID: "s1",
      messageID: "m9",
      type: "step-finish",
      reason: "stop",
      tokens: { total: 100, input: 60, output: 30, reasoning: 10, cache: { read: 0, write: 0 } },
    };
    const first = projectOpencodeEvent({ id: "ev-a", type: "message.part.updated", properties: { sessionID: "s1", part } } as any, ctx)
      .find((e) => e.kind === "thread/tokenUsage/updated") as any;
    const replayed = projectOpencodeEvent({ id: "ev-a-replay", type: "message.part.updated", properties: { sessionID: "s1", part } } as any, ctx)
      .find((e) => e.kind === "thread/tokenUsage/updated") as any;
    expect(first?.requestId).toBe("opencode-turn1-part-finish-9");
    // Same step replayed (SSE retry/backfill) collapses to one ledger row.
    expect(replayed?.requestId).toBe(first?.requestId);
    expect(toOpencodeNotification(replayed)?.params).toMatchObject({ requestId: first?.requestId });
  });

  test("session.compacted projects contextCompaction items", () => {
    const ctx = createOpencodeProjectorContext("t1", "turn1");
    const compactedEvent = {
      id: "ev-compact-1",
      type: "session.compacted",
      properties: {
        sessionID: "s1",
      },
    } as any;

    const projected = projectOpencodeEvent(compactedEvent, ctx);
    const started = projected.find((e) => e.kind === "item/started" && (e as any).item.type === "contextCompaction");
    const completed = projected.find((e) => e.kind === "item/completed" && (e as any).item.type === "contextCompaction");

    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    expect((completed as any).item.status).toBe("completed");
    expect((completed as any).item.cliBackend).toBe("opencode");
    expect((completed as any).item.id).toBe("opencode-compact-turn1");
  });
});

describe("resolveOpencodeModelPayload", () => {
  test("keeps provider/model ids and defaults empty to big-pickle", async () => {
    const mod = await import("../../backends/opencode/src/runtime/opencodeCompatibleRuntime.js");
    expect(mod.resolveOpencodeModelPayload("opencode/big-pickle")).toEqual({ providerID: "opencode", modelID: "big-pickle" });
    expect(mod.resolveOpencodeModelPayload("")).toEqual({ providerID: "opencode", modelID: "big-pickle" });
    expect(mod.resolveOpencodeModelPayload("default")).toEqual({ providerID: "opencode", modelID: "big-pickle" });
    expect(mod.resolveOpencodeModelPayload("opencode-go/qwen3.8-flash")).toEqual({ providerID: "opencode-go", modelID: "qwen3.8-flash" });
  });
  test("drops bare ids without provider prefix instead of fabricating default provider", async () => {
    const mod = await import("../../backends/opencode/src/runtime/opencodeCompatibleRuntime.js");
    expect(mod.resolveOpencodeModelPayload("gemini-3.8-flash")).toBeUndefined();
    expect(mod.resolveOpencodeModelPayload("gpt-4o")).toBeUndefined();
  });
});

describe("inferOpencodeModelLimits and buildOpencodeConfigContent", () => {
  test("infers context and output limits based on model names", async () => {
    const { inferOpencodeModelLimits } = await import("../../backends/opencode/src/runtime/opencodeCompatibleProcessManager.js");
    expect(inferOpencodeModelLimits("claude-3-5-sonnet-200k").context).toBe(200_000);
    expect(inferOpencodeModelLimits("claude-3-5-sonnet").output).toBe(8_192);
    expect(inferOpencodeModelLimits("gemini-1.5-pro-1m").context).toBe(1_000_000);
    expect(inferOpencodeModelLimits("gpt-4o").context).toBe(128_000);
    expect(inferOpencodeModelLimits("gpt-4o").output).toBe(16_384);
    expect(inferOpencodeModelLimits("qwen-32k").context).toBe(32_768);
    expect(inferOpencodeModelLimits("unknown-model").context).toBe(128_000);
  });

  test("buildOpencodeConfigContent injects auto-compaction and model limits", async () => {
    const { buildOpencodeConfigContent } = await import("../../backends/opencode/src/runtime/opencodeCompatibleProcessManager.js");
    const jsonStr = buildOpencodeConfigContent(false, {
      providerId: "codex-relay",
      baseURL: "http://127.0.0.1:4096/v1",
      apiKey: "test-key",
      models: ["claude-3-5-sonnet", "gpt-4o"],
    });
    const cfg = JSON.parse(jsonStr);
    expect(cfg.compaction).toEqual({
      auto: true,
      prune: true,
      reserved: 20000,
    });
    expect(cfg.provider["codex-relay"].models["claude-3-5-sonnet"].limit).toEqual({
      context: 200_000,
      output: 8_192,
    });
    expect(cfg.provider["codex-relay"].models["gpt-4o"].limit).toEqual({
      context: 128_000,
      output: 16_384,
    });
  });
});

describe("opencode subtask linkage (codex parity)", () => {
  const taskPart = (state: any) => ({
    id: "ev-task",
    type: "message.part.updated",
    properties: {
      sessionID: "ses_parent",
      part: {
        id: "prt_hold",
        callID: "call_hold",
        sessionID: "ses_parent",
        messageID: "msg_a",
        type: "tool",
        tool: "task",
        state,
      },
    },
  }) as any;

  test("holds back item/started until the child session id is known", () => {
    const ctx = createOpencodeProjectorContext("parent", "turn-hold");
    const pending = projectOpencodeEvent(taskPart({
      status: "running",
      input: { subagent_type: "explore", description: "Search", prompt: "find" },
    }), ctx);
    expect(pending.some((e) => e.kind === "item/started")).toBe(false);

    const linked = projectOpencodeEvent(taskPart({
      status: "running",
      input: { subagent_type: "explore", description: "Search", prompt: "find" },
      title: "Search",
      metadata: { parentSessionId: "ses_parent", sessionId: "ses_kid_1" },
      time: { start: 1 },
    }), ctx);
    const started = linked.find((e) => e.kind === "item/started") as any;
    expect(started?.item).toMatchObject({
      type: "collabAgentToolCall",
      agentThreadId: "ses_kid_1",
      receiverThreadIds: ["ses_kid_1"],
    });
  });

  test("terminal update without child id still emits (visibility over linkage)", () => {
    const ctx = createOpencodeProjectorContext("parent", "turn-term-nolink");
    const out = projectOpencodeEvent(taskPart({
      status: "completed",
      input: { subagent_type: "explore" },
      output: "done (no session tag)",
      time: { start: 1, end: 2 },
    }), ctx);
    const completed = out.find((e) => e.kind === "item/completed") as any;
    expect(completed?.item.type).toBe("collabAgentToolCall");
    expect(completed?.item.status).toBe("completed");
  });

  test("turn end marks unlinked subtask interrupted, linked keeps completed", () => {
    const ctx = createOpencodeProjectorContext("parent", "turn-idleclose");
    // Unlinked running subtask (permission never answered): held back, but
    // force-stash it to simulate a pre-fix emitted row reaching turn end.
    // Phantoms never resolve server-side, so they must not block idle forever;
    // turn-end marks them interrupted (Codex background-cleanup parity).
    const ghost = {
      type: "collabAgentToolCall",
      id: "opencode-subtask-call_ghost",
      threadId: "parent",
      turnId: "turn-idleclose",
      tool: "task",
      status: "inProgress",
      senderThreadId: "parent",
      receiverThreadIds: [],
      agentId: "call_ghost",
      agentStatus: "running",
      agentsStates: {},
    };
    ctx.activeToolItems.set("call_ghost", ghost as any);
    // Linked running subtask.
    projectOpencodeEvent(taskPart({
      status: "running",
      input: { subagent_type: "explore" },
      metadata: { sessionId: "ses_kid_2" },
      time: { start: 1 },
    }), ctx);
    // Codex parity: a real running child means the turn is still working.
    const early = projectOpencodeEvent({ id: "ev-idle-early", type: "session.status", properties: { status: { type: "idle" } } } as any, ctx);
    expect(early.find((e) => e.kind === "turn/completed")).toBeUndefined();
    expect(ctx.status).toBe("running");
    // Linked child finishes; only the phantom remains.
    const linkedEnd = projectOpencodeEvent(taskPart({
      status: "completed",
      input: { subagent_type: "explore" },
      output: "done",
      metadata: { sessionId: "ses_kid_2" },
      time: { start: 1, end: 2 },
    }), ctx);
    expect(linkedEnd.find((e) => e.kind === "item/completed")).toBeDefined();
    ctx.lastActivityMs = Date.now() - 3000;
    const out = projectOpencodeEvent({ id: "ev-idle", type: "session.status", properties: { status: { type: "idle" } } } as any, ctx);
    const done = out.filter((e) => e.kind === "item/completed") as any[];
    const ghostDone = done.find((e) => e.item.id === "opencode-subtask-call_ghost");
    expect(ghostDone.item.status).toBe("interrupted");
    expect(ghostDone.item.agentStatus).toBe("interrupted");
    expect(out.find((e) => e.kind === "turn/completed")).toBeDefined();
    expect(ctx.status).toBe("completed");
  });
});

