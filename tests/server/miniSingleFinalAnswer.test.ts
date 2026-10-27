import { afterEach, expect, test } from "bun:test";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";

type Protocol = "chat" | "anthropic" | "responses";
type PlanStatus = "in_progress" | "completed";
type Event = { method: string; params: any };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function sse(frames: unknown[]): Response {
  return new Response(frames.map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

function response(protocol: Protocol, text: string, index: number, plan?: PlanStatus, stream = false): Response {
  const args = { todos: [{ content: "核实配置", status: plan }] };
  const id = `plan-${index}`;
  if (protocol === "chat") {
    const delta = plan
      ? { tool_calls: [{ index: 0, id, function: { name: "update_plan", arguments: JSON.stringify(args) } }] }
      : { content: text };
    return sse([{ choices: [{ delta }] }, "[DONE]"]);
  }
  if (protocol === "anthropic") {
    return sse([
      { type: "message_start", message: { id: `msg-${index}`, usage: { input_tokens: 12, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: plan ? { type: "tool_use", id, name: "update_plan" } : { type: "text" } },
      { type: "content_block_delta", index: 0, delta: plan ? { type: "input_json_delta", partial_json: JSON.stringify(args) } : { type: "text_delta", text } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: plan ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ]);
  }
  const body = {
    id: `resp-${index}`, status: "completed",
    output: plan
      ? [{ type: "function_call", id, call_id: id, name: "update_plan", arguments: JSON.stringify(args) }]
      : [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
    usage: { input_tokens: 12, output_tokens: 20 },
  };
  if (stream) {
    return sse([
      { type: "response.created", response: { id: body.id, status: "in_progress" } },
      ...(plan
        ? [{ type: "response.output_item.done", output_index: 0, item: body.output[0] }]
        : [{ type: "response.output_text.delta", item_id: `answer-${index}`, output_index: 0, content_index: 0, delta: text }]),
      { type: "response.completed", response: body },
    ]);
  }
  return Response.json(body);
}

async function run(protocol: Protocol, options: { corrections?: number; fail?: boolean; direct?: boolean; final?: string; long?: boolean; stream?: boolean } = {}) {
  const model = protocol === "anthropic" ? "claude-haiku-5-5" : "test-model";
  const snapshots: Array<{ messages: any[] }> = [];
  const bridge = new MiniBridge({
    resolveRelayTarget: async () => ({ baseUrl: "https://relay.example/v1", apiKey: "test", protocol, streamMaxRetries: 0 }),
    onSnapshot: (snapshot) => { snapshots.push(JSON.parse(JSON.stringify(snapshot))); },
  });
  const started = await bridge.request("thread/start", { cwd: process.cwd(), model, providerId: "p", groupId: "g" }) as { thread: { id: string } };
  const threadId = started.thread.id;
  const answer = options.final ?? (options.long === false ? "核实结果：无需修改。" : `核实结果：配置已经符合要求，无需修改。\n${Array.from({ length: 20 }, (_, i) => `检查项 ${i + 1}：配置值与项目预期一致。`).join("\n")}`);
  const corrections = options.corrections ?? 1;
  const requests: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: any, init: any) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    const index = requests.length;
    const plan = options.direct ? undefined : index === 1 ? "in_progress" : !options.fail && index === corrections + 2 ? "completed" : undefined;
    return response(protocol, answer, index, plan, options.stream);
  }) as typeof fetch;
  const notifications: Event[] = [];
  const terminal = new Promise<string>((resolve) => {
    bridge.on("notification", (event: Event) => {
      notifications.push(event);
      if (event.method === "turn/completed" || event.method === "turn/failed") resolve(event.method);
    });
  });
  await bridge.request("turn/start", { threadId, prompt: "核实项目配置是否正确", providerId: "p", groupId: "g", model });
  const method = await terminal;
  const read = await bridge.request("thread/read", { threadId, includeTurns: true }) as { items: any[] };
  return { answer, requests, notifications, snapshots, method, items: read.items };
}

for (const { protocol, stream } of [
  { protocol: "chat", stream: true },
  { protocol: "anthropic", stream: true },
  { protocol: "responses", stream: false },
  { protocol: "responses", stream: true },
] as const) {
  const label = `${protocol} ${stream ? "SSE" : "JSON"}`;
  for (const long of [false, true]) {
    test(`${label}: corrected ${long ? "materialized long" : "buffered short"} candidates leave only one final answer`, async () => {
      const state = await run(protocol, { corrections: 2, long, stream });
      expect(state.method).toBe("turn/completed");
      expect(state.requests).toHaveLength(5);
      expect(state.items.filter((item) => item.type === "agentMessage").map((item) => item.text)).toEqual([state.answer]);
      const completed = state.notifications.filter((event) => event.method === "item/completed" && event.params.item?.type === "agentMessage");
      expect(completed).toHaveLength(1);
      expect(completed[0].params.item.text).toBe(state.answer);
      const rollbacks = state.notifications.filter((event) => event.method === "mini/item/rollback");
      if (long) expect(rollbacks).toHaveLength(2);
      // The next request must not replay rejected answers, via explicit history
      // or a Responses previous_response_id retaining them on the upstream.
      for (const request of state.requests.slice(2)) {
        expect(JSON.stringify(request.body)).not.toContain(state.answer.slice(0, 15));
      }
      if (protocol === "responses") {
        expect(state.requests[2].body.previous_response_id).toBeUndefined();
        expect(state.requests[3].body.previous_response_id).toBeUndefined();
      }
      const latest = state.snapshots.at(-1)!;
      expect(latest.messages.filter((item) => item.type === "agentMessage").map((item) => item.text)).toEqual([state.answer]);
    }, 20_000);
  }

  test(`${label}: no-progress failure does not keep rejected answers`, async () => {
    const state = await run(protocol, { fail: true, stream });
    expect(state.method).toBe("turn/failed");
    expect(state.requests.length).toBeLessThanOrEqual(6);
    expect(state.items.filter((item) => item.type === "agentMessage")).toHaveLength(0);
    expect(state.notifications.filter((event) => event.method === "item/completed" && event.params.item?.type === "agentMessage")).toHaveLength(0);
  }, 20_000);

  test(`${label}: a direct final answer is preserved without extra rounds`, async () => {
    const state = await run(protocol, { direct: true, stream });
    expect(state.method).toBe("turn/completed");
    expect(state.requests).toHaveLength(1);
    expect(state.items.filter((item) => item.type === "agentMessage").map((item) => item.text)).toEqual([state.answer]);
  }, 20_000);

  test(`${label}: a question awaiting the user remains visible despite a pending plan`, async () => {
    const state = await run(protocol, { final: "请选择需要核实的配置文件？", stream });
    expect(state.method).toBe("turn/completed");
    expect(state.requests).toHaveLength(2);
    expect(state.items.filter((item) => item.type === "agentMessage").map((item) => item.text)).toEqual([state.answer]);
  }, 20_000);
}
