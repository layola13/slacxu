import { describe, expect, test } from "bun:test";
import {
  ToolSimulationStream,
  parseToolSimulation,
  parseToolSimulations,
} from "../src/duckgo/tool-simulation.js";
import { consumeUpstream, consumeUpstreamResponses } from "../src/duckgo/stream.js";

describe("ToolSimulationStream", () => {
  test("emits plain text before complete action", () => {
    const parser = new ToolSimulationStream();
    const first = parser.push("Hello ");
    expect(first).toEqual([{ text: "Hello " }]);

    const chunks = [
      '{"play',
      'game":{"action":"exec',
      '_command","args":{"cmd":"Get-ChildItem"}}}',
    ];
    const parts = [];
    for (const chunk of chunks) {
      parts.push(...parser.push(chunk));
    }
    parts.push(...parser.flush());

    expect(parts).toHaveLength(1);
    expect(parts[0]?.toolCall).toBeDefined();
    expect(parts[0]?.toolCall?.id).toBe("call_playgame_1");
    expect(parts[0]?.toolCall?.function.name).toBe("exec_command");
    expect(parts[0]?.toolCall?.function.arguments).toBe('{"cmd":"Get-ChildItem"}');
  });

  test("accepts pretty printed envelope", () => {
    const parser = new ToolSimulationStream();
    const chunks = [
      "prefix\n{\n  \"play",
      'game" : {\n    "action" : "exec_command",\n    "args" : {\n      "cmd" : "pwd"\n    }\n  }\n}',
    ];
    const parts = [];
    for (const chunk of chunks) {
      parts.push(...parser.push(chunk));
    }
    parts.push(...parser.flush());

    expect(parts).toHaveLength(2);
    expect(parts[0]?.text).toBe("prefix\n");
    expect(parts[1]?.toolCall?.function.name).toBe("exec_command");
    const args = JSON.parse(parts[1]?.toolCall?.function.arguments ?? "{}");
    expect(args.cmd).toBe("pwd");
  });

  test("repairs windows command JSON", () => {
    const parser = new ToolSimulationStream();
    const message = '{"playgame":{"action":"exec_command","args":{"cmd":"Get-ChildItem -Path .\\sala -Recurse -File; Write-Output "done""}}}';
    const parts = [];
    for (let i = 0; i < message.length; i++) {
      parts.push(...parser.push(message.slice(i, i + 1)));
    }
    parts.push(...parser.flush());

    expect(parts).toHaveLength(1);
    expect(parts[0]?.toolCall?.function.name).toBe("exec_command");
    const args = parts[0]?.toolCall?.function.arguments ?? "";
    expect(args).toContain("Get-ChildItem -Path .\\\\sala");
    expect(args).toContain('Write-Output \\"done\\"');
  });

  test("preserves invalid marker as text", () => {
    const parser = new ToolSimulationStream();
    const parts = [
      ...parser.push('prefix {"playgame":{"action":}}'),
      ...parser.flush(),
    ];
    const text = parts.map((p) => p.text ?? "").join("");
    expect(parts.some((p) => p.toolCall != null)).toBe(false);
    expect(text).toBe('prefix {"playgame":{"action":}}');
  });

  test("fragmented windows command", () => {
    const parser = new ToolSimulationStream();
    const chunks = [
      '{"playgame":{"action":"exec_command","args":{"cmd":"dir ',
      '\\sala","workdir":"E:',
      '\\projects","shell":"powershell"}}}',
    ];
    const parts = [];
    for (const chunk of chunks) {
      parts.push(...parser.push(chunk));
    }
    parts.push(...parser.flush());

    expect(parts).toHaveLength(1);
    expect(parts[0]?.toolCall?.function.name).toBe("exec_command");
    const args = JSON.parse(parts[0]?.toolCall?.function.arguments ?? "{}");
    expect(args.cmd).toBe("dir \\sala");
  });

  test("multiple sequential tool calls in one stream", () => {
    const parser = new ToolSimulationStream();
    const chunks = [
      '{"playgame":{"action":"read_file","args":{"path":"foo.txt"}}}\n',
      '{"playgame":{"action":"write_file","args":{"path":"bar.txt","content":"hello"}}}',
    ];
    const parts = [];
    for (const chunk of chunks) {
      parts.push(...parser.push(chunk));
    }
    parts.push(...parser.flush());

    expect(parts).toHaveLength(2);
    expect(parts[0]?.toolCall?.id).toBe("call_playgame_1");
    expect(parts[0]?.toolCall?.function.name).toBe("read_file");
    expect(parts[1]?.toolCall?.id).toBe("call_playgame_2");
    expect(parts[1]?.toolCall?.function.name).toBe("write_file");
  });
});

describe("parseToolSimulations", () => {
  test("extracts single tool simulation from text", () => {
    const raw = 'Thinking here...\n{"playgame":{"action":"get_weather","args":{"city":"Beijing"}}}\nDone!';
    const { text, calls } = parseToolSimulations(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe("call_playgame_1");
    expect(calls[0]?.function.name).toBe("get_weather");
    expect(JSON.parse(calls[0]?.function.arguments ?? "{}").city).toBe("Beijing");
    expect(text).toContain("Thinking here...");
    expect(text).toContain("Done!");
  });

  test("extracts multiple tool simulations and parses single helper", () => {
    const raw = '{"playgame":{"action":"tool_a","args":{}}}\n{"playgame":{"action":"tool_b","args":{"x":1}}}';
    const { calls } = parseToolSimulations(raw);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.function.name).toBe("tool_a");
    expect(calls[1]?.function.name).toBe("tool_b");

    const single = parseToolSimulation(raw);
    expect(single.call?.function.name).toBe("tool_a");

    const none = parseToolSimulation("plain text only");
    expect(none.call).toBeNull();
    expect(none.text).toBe("plain text only");
  });
});

describe("consumeUpstream with toolSimulation", () => {
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
    requestModel: "gpt-4o-mini",
    reasoningEffort: "low",
    toolSimulation: true,
    stats: { start: Date.now(), promptTokens: 15, cachedTokens: 0, effort: "low" },
    countTokens: (s: string) => s.length,
  };

  test("streaming emits chatcmpl-playgame tool chunk and finish_reason tool_calls", async () => {
    const lines: string[] = [];
    const ev1 = JSON.stringify({ action: "success", message: 'I will run the command:\n{"play' });
    const ev2 = JSON.stringify({ action: "success", message: 'game":{"action":"bash","args":{"command":"ls -la"}}}' });

    const result = await consumeUpstream({
      ...base,
      body: fakeUpstream([ev1, ev2]),
      stream: true,
      write: (l) => void lines.push(l),
    });

    expect(result).not.toBeNull();
    expect(result?.toolCalls).toHaveLength(1);
    expect(result?.toolCalls[0]?.function.name).toBe("bash");

    const parsed = lines.map((l) => JSON.parse(l.slice(6)));
    const toolChunk = parsed.find((p) => p.id === "chatcmpl-playgame");
    expect(toolChunk).toBeDefined();
    expect(toolChunk.choices[0].delta.tool_calls[0].function.name).toBe("bash");
    expect(toolChunk.choices[0].delta.tool_calls[0].index).toBe(0);

    const stopChunk = parsed.find((p) => p.choices?.[0]?.finish_reason !== undefined && p.choices[0].finish_reason !== null);
    expect(stopChunk).toBeDefined();
    expect(stopChunk.choices[0].finish_reason).toBe("tool_calls");
  });

  test("non-streaming collects toolCalls without writes", async () => {
    const lines: string[] = [];
    const ev = JSON.stringify({
      action: "success",
      message: '{"playgame":{"action":"exec","args":{"cmd":"whoami"}}}',
    });

    const result = await consumeUpstream({
      ...base,
      body: fakeUpstream([ev]),
      stream: false,
      write: (l) => void lines.push(l),
    });

    expect(lines).toHaveLength(0);
    expect(result).not.toBeNull();
    expect(result?.toolCalls).toHaveLength(1);
    expect(result?.toolCalls[0]?.function.name).toBe("exec");
  });
});

describe("consumeUpstreamResponses with toolSimulation", () => {
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
    requestModel: "gpt-4o-mini",
    reasoningEffort: "low",
    toolSimulation: true,
    stats: { start: Date.now(), promptTokens: 20, cachedTokens: 0, effort: "low" },
    countTokens: (s: string) => s.length,
  };

  test("streaming emits function_call item events", async () => {
    const lines: string[] = [];
    const ev = JSON.stringify({
      action: "success",
      message: '{"playgame":{"action":"get_user","args":{"user_id":42}}}',
    });

    const result = await consumeUpstreamResponses({
      ...base,
      body: fakeUpstream([ev]),
      stream: true,
      write: (l) => void lines.push(l),
    });

    expect(result).not.toBeNull();
    expect(result?.toolCalls).toHaveLength(1);
    expect(result?.toolCalls[0]?.function.name).toBe("get_user");

    const events = lines
      .map((l) => {
        const m = l.match(/data: (\{.*\})/);
        return m ? JSON.parse(m[1]!) : null;
      })
      .filter(Boolean);

    const itemAdded = events.find((e) => e.type === "response.output_item.added" && e.item?.type === "function_call");
    expect(itemAdded).toBeDefined();
    expect(itemAdded.item.name).toBe("get_user");

    const argsDelta = events.find((e) => e.type === "response.function_call_arguments.delta");
    expect(argsDelta).toBeDefined();
    expect(JSON.parse(argsDelta.delta).user_id).toBe(42);

    const completed = events.find((e) => e.type === "response.completed");
    expect(completed).toBeDefined();
    expect(completed.response.output.some((o: any) => o.type === "function_call")).toBe(true);
  });

  test("non-streaming returns function_call in response.output", async () => {
    const ev = JSON.stringify({
      action: "success",
      message: '{"playgame":{"action":"calculate","args":{"expr":"2+2"}}}',
    });

    const result = await consumeUpstreamResponses({
      ...base,
      body: fakeUpstream([ev]),
      stream: false,
      write: () => {},
    });

    expect(result).not.toBeNull();
    expect(result?.toolCalls).toHaveLength(1);
    expect(result?.toolCalls[0]?.function.name).toBe("calculate");

    const output = result?.response?.output as any[];
    expect(output).toBeDefined();
    const fnCall = output.find((o) => o.type === "function_call");
    expect(fnCall).toBeDefined();
    expect(fnCall.name).toBe("calculate");
    expect(JSON.parse(fnCall.arguments).expr).toBe("2+2");
  });
});
