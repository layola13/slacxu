import { describe, expect, test } from "bun:test";
import { consumeUpstream } from "../src/duckgo/stream.js";
import { CHATCMPL_ID } from "../src/duckgo/response.js";

function fakeUpstream(events: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const payload = events.map((e) => `data: ${e}\n\n`).join("");
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(payload));
      c.close();
    },
  });
}

const base = {
  requestModel: "m",
  reasoningEffort: "low",
  toolSimulation: false,
  stats: { start: Date.now(), promptTokens: 10, cachedTokens: 0, effort: "low" },
  countTokens: (s: string) => s.length,
};

const ev1 = JSON.stringify({ action: "success", message: "Hello", model: "gpt-4o-mini" });
const ev2 = JSON.stringify({ action: "success", message: " world", model: "gpt-4o-mini" });

describe("consumeUpstream", () => {
  test("non-stream accumulates without writes", async () => {
    const lines: string[] = [];
    const r = await consumeUpstream({
      ...base,
      body: fakeUpstream([ev1, ev2]),
      stream: false,
      write: (l) => void lines.push(l),
    });
    expect(r?.text).toBe("Hello world");
    expect(lines).toHaveLength(0);
    expect(r?.outputTokens).toBe(11);
  });

  test("stream emits chunks, stop and usage", async () => {
    const lines: string[] = [];
    const r = await consumeUpstream({
      ...base,
      body: fakeUpstream([ev1, ev2]),
      stream: true,
      write: (l) => void lines.push(l),
    });
    expect(r?.text).toBe("Hello world");
    const parsed = lines.map((l) => JSON.parse(l.slice(6)) as any);
    expect(parsed[0].choices[0].delta.content).toBe("Hello");
    expect(parsed[1].choices[0].delta.content).toBe(" world");
    expect(parsed[2].choices[0].finish_reason).toBe("stop");
    expect(parsed[3].usage.prompt_tokens).toBe(10);
    expect(parsed[3].usage.completion_tokens).toBe(11);
    expect(parsed.every((p) => p.id === CHATCMPL_ID)).toBe(true);
  });

  test("reasoning passthrough with DONE/short-line skips", async () => {
    const lines: string[] = [];
    const r = await consumeUpstream({
      ...base,
      body: fakeUpstream([
        JSON.stringify({ action: "success", role: "reasoning", text: "thinking", model: "m" }),
        "[DONE]",
        "x",
      ]),
      stream: true,
      write: (l) => void lines.push(l),
    });
    const first = JSON.parse(lines[0].slice(6)) as any;
    expect(first.choices[0].delta.reasoning_content).toBe("thinking");
    expect(r?.text).toBe("");
  });

  test("non-success action aborts the turn", async () => {
    const r = await consumeUpstream({
      ...base,
      body: fakeUpstream([JSON.stringify({ action: "error", message: "nope" })]),
      stream: false,
      write: () => {},
    });
    expect(r).toBeNull();
  });

  test("search waterfall: native WebSearch call projects as tool call", async () => {
    // Real Duck.ai search flow: answer preface, tool-invocation call,
    // tool-invocation result, final answer.
    const call = JSON.stringify({
      action: "success",
      role: "tool-invocation",
      state: "call",
      toolName: "WebSearch",
      toolCallId: "call-search-1",
      toolArguments: '{"query":"广州天气"}',
    });
    const resultEv = JSON.stringify({
      action: "success",
      role: "tool-invocation",
      state: "result",
      toolCallId: "call-search-1",
      result: "search complete",
    });
    const ans = JSON.stringify({ action: "success", message: "广州今日晴", model: "m" });
    const r = await consumeUpstream({
      ...base,
      body: fakeUpstream([call, resultEv, ans]),
      stream: false,
      write: () => {},
    });
    expect(r?.text).toBe("广州今日晴");
    expect(r?.toolCalls).toHaveLength(1);
    expect(r?.toolCalls[0]?.function.name).toBe("web_search");
    expect(r?.toolCalls[0]?.id).toBe("call-search-1");
  });

  test("search waterfall streams tool chunk before answer", async () => {
    const call = JSON.stringify({
      action: "success",
      role: "tool-invocation",
      state: "call",
      toolName: "WebSearch",
      toolCallId: "call-search-1",
      toolArguments: '{"query":"广州天气"}',
    });
    const ans = JSON.stringify({ action: "success", message: "广州今日晴", model: "m" });
    const lines: string[] = [];
    const r = await consumeUpstream({
      ...base,
      body: fakeUpstream([call, ans]),
      stream: true,
      write: (l) => void lines.push(l),
    });
    expect(r?.toolCalls).toHaveLength(1);
    const parsed = lines.map((l) => JSON.parse(l.slice(6)) as any);
    // tool_call chunk (chatcmpl-playgame id) precedes the answer chunk.
    expect(parsed[0].id).toBe("chatcmpl-playgame");
    expect(parsed[0].choices[0].delta.tool_calls[0].function.name).toBe("web_search");
    expect(parsed[1].choices[0].delta.content).toBe("广州今日晴");
    expect(parsed[parsed.length - 2].choices[0].finish_reason).toBe("tool_calls");
  });
});
