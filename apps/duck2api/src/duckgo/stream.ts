import { randomUUID } from "node:crypto";
import {
  reasoningChunkWithModel,
  stopChunkWithModel,
  textChunkWithModel,
  toolCallChunkWithModel,
  usageChunk,
  type ToolCall,
  type UpstreamEvent,
} from "./response.js";
import { ToolSimulationStream, nativeToolCall } from "./tool-simulation.js";

// Port of duckgo.Handler (internal/duckgo/request.go:1020-1189): incremental
// playgame tool-simulation parser (ToolSimulationStream, request.go:630-1019)
// plus text/reasoning passthrough.

export interface StreamStats {
  start: number;
  promptTokens: number;
  cachedTokens: number;
  effort: string;
}

export interface StreamResult {
  text: string;
  outputTokens: number;
  ttftMs: number;
  totalMs: number;
  toolCalls: ToolCall[];
}

export interface ConsumeOptions {
  body: ReadableStream<Uint8Array> | null;
  /** Model echoed on stop/usage chunks (oldRequest.Model). */
  requestModel: string;
  /** "none" disables reasoning passthrough. */
  reasoningEffort: string;
  toolSimulation: boolean;
  stream: boolean;
  stats: StreamStats;
  write: (sseLine: string) => void | Promise<void>;
  countTokens: (text: string) => number;
}

export async function consumeUpstream(opts: ConsumeOptions): Promise<StreamResult | null> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  const toolParser = new ToolSimulationStream();
  let firstToken = false;
  let ttftMs = 0;
  const markFirst = () => {
    if (!firstToken) {
      firstToken = true;
      ttftMs = Date.now() - opts.stats.start;
    }
  };
  const emitPart = async (part: { text?: string; toolCall?: ToolCall }): Promise<boolean> => {
    if (part.toolCall) {
      toolCalls.push(part.toolCall);
      if (opts.stream) {
        try {
          await opts.write(
            `data: ${JSON.stringify(toolCallChunkWithModel(part.toolCall, opts.requestModel, toolCalls.length - 1))}\n\n`,
          );
        } catch {
          return false;
        }
      }
      return true;
    }
    const value = part.text ?? "";
    if (value === "" && !opts.stream) return true;
    text += value;
    if (opts.stream && value !== "") {
      try {
        await opts.write(
          `data: ${JSON.stringify(textChunkWithModel(value, opts.requestModel))}\n\n`,
        );
      } catch {
        return false;
      }
    }
    return true;
  };

  if (opts.body) {
    const reader = opts.body.getReader();
    // Go parity (request.go: Handler + readResponseBody): the upstream body is
    // owned here and must be closed on every exit path. Bun throws
    // "Body object should not be disturbed or locked" if a locked reader is
    // abandoned via early return, so cancel + release before returning null.
    const decoder = new TextDecoder();
    let buf = "";
    let upstreamFailed = false;
    try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value && value.length > 0) buf += decoder.decode(value, { stream: !done });
      if (done) {
        buf += decoder.decode();
      }
      let idx: number;
      let fatal = false;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line.length < 6) continue;
        const payload = line.slice(6); // strip "data: "
        if (payload.startsWith("[DONE]")) continue;
        let event: UpstreamEvent;
        try {
          event = JSON.parse(payload) as UpstreamEvent;
        } catch {
          continue;
        }
        // Strict parity with Go: a missing/non-success action aborts the
        // whole turn with an upstream error (request.go:1060).
        if (event.action !== "success") {
          upstreamFailed = true;
          break;
        }
        if (event.role === "tool-invocation") {
          // Search waterfall projection (deliberate delta from Go chat
          // Handler, which drops these events): surface Duck.ai server-side
          // activity (WebSearch, GenerateImage) as OpenAI tool calls so the
          // chat waterfall shows search steps. Calls are kept even when
          // answer text follows (Go responses clears them on continuation
          // and only recovers on abrupt end, which would hide search in
          // normal flows). Emitted inline so the step appears before the
          // answer; result-state events carry no content and are skipped.
          if (event.state === "call") {
            const call = nativeToolCall(event);
            if (call) {
              markFirst();
              toolCalls.push(call);
              if (opts.stream) {
                try {
                  await opts.write(
                    `data: ${JSON.stringify(toolCallChunkWithModel(call, opts.requestModel, toolCalls.length - 1))}\n\n`,
                  );
                } catch {
                  fatal = true;
                  break;
                }
              }
            }
          }
          continue;
        }
        if (event.role === "reasoning" && opts.reasoningEffort !== "none") {
          markFirst();
          if (event.text && opts.stream) {
            try {
              await opts.write(`data: ${JSON.stringify(reasoningChunkWithModel(event.text, event.model ?? opts.requestModel))}\n\n`);
            } catch {
              fatal = true;
              break;
            }
          }
        }
        if (event.message) {
          markFirst();
          if (opts.toolSimulation) {
            for (const part of toolParser.push(event.message)) {
              if (!(await emitPart(part))) {
                fatal = true;
                break;
              }
            }
            if (fatal) break;
          } else {
            text += event.message;
            if (opts.stream) {
              try {
                await opts.write(
                  `data: ${JSON.stringify(textChunkWithModel(event.message, event.model ?? opts.requestModel))}\n\n`,
                );
              } catch {
                fatal = true;
                break;
              }
            }
          }
        }
      }
      if (fatal) { upstreamFailed = true; break; }
      if (upstreamFailed) break;
      if (done) break;
    }
    } finally {
      // Always release the lock (Go: defer response.Body.Close()).
      // Cancel drains the upstream connection when we abort early.
      if (upstreamFailed) {
        try { await reader.cancel(); } catch { /* already closed */ }
      }
      try { reader.releaseLock(); } catch { /* already released */ }
    }
    if (upstreamFailed) return null;
  }

  if (opts.toolSimulation) {
    for (const part of toolParser.flush()) {
      if (part.toolCall) {
        toolCalls.push(part.toolCall);
        if (opts.stream) {
          try {
            await opts.write(
              `data: ${JSON.stringify(toolCallChunkWithModel(part.toolCall, opts.requestModel, toolCalls.length - 1))}\n\n`,
            );
          } catch {
            return null;
          }
        }
        continue;
      }
      const value = part.text ?? "";
      text += value;
      if (opts.stream && value !== "") {
        try {
          await opts.write(`data: ${JSON.stringify(textChunkWithModel(value, opts.requestModel))}\n\n`);
        } catch {
          return null;
        }
      }
    }
  }

  const outputTokens = opts.countTokens(text);
  const totalMs = Date.now() - opts.stats.start;

  if (opts.stream) {
    const finishReason = toolCalls.length > 0 ? "tool_calls" : "stop";
    try {
      await opts.write(`data: ${JSON.stringify(stopChunkWithModel(finishReason, opts.requestModel))}\n\n`);
      await opts.write(
        `data: ${JSON.stringify(
          usageChunk(
            opts.requestModel,
            opts.stats.promptTokens,
            outputTokens,
            opts.stats.cachedTokens,
            ttftMs,
            totalMs,
            opts.stats.effort,
          ),
        )}\n\n`,
      );
    } catch {
      return null;
    }
  }

  return { text, outputTokens, ttftMs, totalMs, toolCalls };
}

export interface ConsumeResponsesOptions {
  body: ReadableStream<Uint8Array> | null;
  requestModel: string;
  reasoningEffort: string;
  toolSimulation: boolean;
  stream: boolean;
  stats: StreamStats;
  write: (line: string) => void | Promise<void>;
  countTokens: (text: string) => number;
}

export interface StreamResponsesResult extends StreamResult {
  response: Record<string, unknown>;
}

export async function consumeUpstreamResponses(opts: ConsumeResponsesOptions): Promise<StreamResponsesResult | null> {
  const enc = (type: string, fields: Record<string, unknown>) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;

  const responseId = `resp_${randomUUID().replaceAll("-", "")}`;
  const messageId = `msg_${randomUUID().replaceAll("-", "")}`;

  let seq = 1;
  const inProgress = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "in_progress",
    model: opts.requestModel,
    output: [],
    usage: { input_tokens: opts.stats.promptTokens, output_tokens: 0, total_tokens: opts.stats.promptTokens },
  };

  if (opts.stream) {
    await opts.write(enc("response.created", { sequence_number: seq++, response: inProgress }));
  }

  let text = "";
  const toolCalls: ToolCall[] = [];
  const toolParser = new ToolSimulationStream();
  // Native tool-invocation events recovered only when the playgame stream
  // completes without emitting plain-text continuation (handlers.go:679-754).
  const pendingNativeToolCalls: ToolCall[] = [];
  let nativeToolAwaitingContinuation = false;
  const clearNativePending = () => {
    pendingNativeToolCalls.length = 0;
    nativeToolAwaitingContinuation = false;
  };
  let ttftMs = 0;
  let firstToken = false;
  const markFirst = () => {
    if (!firstToken) {
      firstToken = true;
      ttftMs = Date.now() - opts.stats.start;
    }
  };
  const emitResponseToolCall = async (call: ToolCall, outputIndex: number): Promise<boolean> => {
    toolCalls.push(call);
    if (!opts.stream) return true;
    try {
      const item = {
        id: call.id || `call_duck2api_${toolCalls.length}`,
        type: "function_call",
        status: "in_progress",
        call_id: call.id,
        name: call.function.name,
      };
      await opts.write(enc("response.output_item.added", { sequence_number: seq++, output_index: outputIndex, item }));
      await opts.write(enc("response.function_call_arguments.delta", {
        sequence_number: seq++,
        item_id: item.id,
        output_index: outputIndex,
        delta: call.function.arguments,
      }));
      await opts.write(enc("response.function_call_arguments.done", {
        sequence_number: seq++,
        item_id: item.id,
        output_index: outputIndex,
        text: call.function.arguments,
      }));
      await opts.write(enc("response.output_item.done", {
        sequence_number: seq++,
        output_index: outputIndex,
        item: { ...item, status: "completed", arguments: call.function.arguments },
      }));
    } catch {
      return false;
    }
    return true;
  };
  const emitResponseText = async (value: string): Promise<boolean> => {
    if (value === "") return true;
    text += value;
    if (!opts.stream) return true;
    try {
      await opts.write(enc("response.output_text.delta", {
        sequence_number: seq++,
        output_index: outputIndex,
        content_index: 0,
        item_id: messageId,
        delta: value,
      }));
    } catch {
      return false;
    }
    return true;
  };
  let textItemOpened = false;
  let outputIndex = 0;
  const ensureResponseTextItem = async (): Promise<boolean> => {
    if (textItemOpened || !opts.stream) {
      textItemOpened = true;
      return true;
    }
    textItemOpened = true;
    try {
      const outputItem = {
        id: messageId,
        type: "message",
        status: "in_progress",
        role: "assistant",
        content: [],
      };
      await opts.write(enc("response.output_item.added", { sequence_number: seq++, output_index: outputIndex, item: outputItem }));
      const part = { type: "output_text", text: "", annotations: [] };
      await opts.write(enc("response.content_part.added", { sequence_number: seq++, output_index: outputIndex, content_index: 0, item_id: messageId, part }));
    } catch {
      return false;
    }
    return true;
  };
  const closeResponseTextItem = async (): Promise<boolean> => {
    if (!textItemOpened) return true;
    textItemOpened = false;
    if (!opts.stream) return true;
    try {
      const donePart = { type: "output_text", text, annotations: [] };
      await opts.write(enc("response.output_text.done", {
        sequence_number: seq++,
        output_index: outputIndex,
        content_index: 0,
        item_id: messageId,
        text,
      }));
      await opts.write(enc("response.content_part.done", {
        sequence_number: seq++,
        output_index: outputIndex,
        content_index: 0,
        item_id: messageId,
        part: donePart,
      }));
      await opts.write(enc("response.output_item.done", {
        sequence_number: seq++,
        output_index: outputIndex,
        item: { id: messageId, type: "message", status: "completed", role: "assistant", content: [donePart] },
      }));
      outputIndex++;
    } catch {
      return false;
    }
    return true;
  };

  if (opts.body) {
    const reader = opts.body.getReader();
    // Go parity: own and close the upstream body on every path (see above).
    const decoder = new TextDecoder();
    let buf = "";
    let upstreamFailed = false;
    try {
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (value && value.length > 0) buf += decoder.decode(value, { stream: !done });
      if (done) buf += decoder.decode();
      let idx: number;
      let fatal = false;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line.length < 6) continue;
        const payload = line.slice(6);
        if (payload.startsWith("[DONE]")) continue;
        let event: UpstreamEvent;
        try {
          event = JSON.parse(payload) as UpstreamEvent;
        } catch {
          continue;
        }
        if (event.action !== "success") {
          upstreamFailed = true;
          break outer;
        }
        if (event.role === "tool-invocation") {
          if (opts.toolSimulation && event.state === "call") {
            const call = nativeToolCall(event);
            if (call) {
              pendingNativeToolCalls.push(call);
              nativeToolAwaitingContinuation = true;
            }
          }
          continue;
        }
        if (event.role === "reasoning" && opts.reasoningEffort !== "none") {
          markFirst();
          if (event.text) {
            if (!(await ensureResponseTextItem())) { upstreamFailed = true; break outer; }
            if (!opts.stream) {
              if (!(await emitResponseText(event.text))) { upstreamFailed = true; break outer; }
            } else {
              try {
                await opts.write(enc("response.reasoning_text.delta", { sequence_number: seq++, item_id: messageId, delta: event.text }));
              } catch {
                fatal = true;
                break;
              }
            }
          }
          continue;
        }
        if (event.message) {
          if (nativeToolAwaitingContinuation) clearNativePending();
          markFirst();
          if (opts.toolSimulation) {
            if (!(await ensureResponseTextItem())) { upstreamFailed = true; break outer; }
            for (const part of toolParser.push(event.message)) {
              if (part.toolCall) {
                if (!(await closeResponseTextItem())) { upstreamFailed = true; break outer; }
                if (!(await emitResponseToolCall(part.toolCall, outputIndex++))) { upstreamFailed = true; break outer; }
              } else {
                if (!(await ensureResponseTextItem())) { upstreamFailed = true; break outer; }
                if (!(await emitResponseText(part.text ?? ""))) { upstreamFailed = true; break outer; }
              }
            }
            if (upstreamFailed) break;
          } else {
            if (!(await ensureResponseTextItem())) { upstreamFailed = true; break outer; }
            if (!(await emitResponseText(event.message))) { upstreamFailed = true; break outer; }
          }
        }
      }
      if (fatal) { upstreamFailed = true; break; }
      if (upstreamFailed) break;
      if (done) break;
    }
    } finally {
      if (upstreamFailed) {
        try { await reader.cancel(); } catch { /* already closed */ }
      }
      try { reader.releaseLock(); } catch { /* already released */ }
    }
    if (upstreamFailed) return null;
  }

  if (opts.toolSimulation) {
    if (!(await ensureResponseTextItem())) return null;
    for (const part of toolParser.flush()) {
      if (part.toolCall) {
        if (!(await closeResponseTextItem())) return null;
        if (!(await emitResponseToolCall(part.toolCall, outputIndex++))) return null;
      } else {
        if (!(await ensureResponseTextItem())) return null;
        if (!(await emitResponseText(part.text ?? ""))) return null;
      }
    }
  }
  // Go: pending native calls recover only when no plain-text continuation
  // arrived (pending list was cleared on any reasoning/message above).
  for (const call of pendingNativeToolCalls) {
    if (!(await closeResponseTextItem())) return null;
    if (!(await emitResponseToolCall(call, outputIndex++))) return null;
  }
  if (!(await closeResponseTextItem())) return null;

  const outputTokens = opts.countTokens(text);
  const totalMs = Date.now() - opts.stats.start;

  const output: Record<string, unknown>[] = [];
  // Text item is reconstructed for the non-stream response below; stream path
  // already emitted item/part done events with stable output indexes.
  if (text !== "" || toolCalls.length === 0) {
    const completedPart = { type: "output_text", text, annotations: [] };
    output.push({
      id: messageId,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [completedPart],
    });
  }
  for (const call of toolCalls) {
    output.push({
      id: call.id,
      type: "function_call",
      status: "completed",
      call_id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    });
  }

  const completedResponse = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: opts.requestModel,
    output,
    output_text: text,
    usage: {
      input_tokens: opts.stats.promptTokens,
      output_tokens: outputTokens,
      total_tokens: opts.stats.promptTokens + outputTokens,
    },
    timing: {
      ...(ttftMs > 0 ? { ttft_ms: ttftMs } : {}),
      ...(totalMs > 0 ? { total_ms: totalMs } : {}),
    },
    ...(opts.stats.effort ? { reasoning_effort: opts.stats.effort } : {}),
  };

  if (opts.stream) {
    try {
      await opts.write(enc("response.completed", { sequence_number: seq++, response: completedResponse }));
      await opts.write("data: [DONE]\n\n");
    } catch {
      return null;
    }
  }

  return { text, outputTokens, ttftMs, totalMs, toolCalls, response: completedResponse };
}
