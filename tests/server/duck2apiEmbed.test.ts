import { describe, expect, test } from "bun:test";
import { isEmbeddedD2ApiGroup, runRelayProtocolRequest } from "../../backends/relay-config/src/relay/relayProtocolGateway.ts";
import { buildD2ApiFreeGroup, D2API_DEFAULT_MODELS } from "../../backends/relay-config/src/relay/omniRouteFree.ts";
import { createApp } from "../../apps/duck2api/src/server.ts";
import { apiRequestSchema, listModels, messageText } from "../../apps/duck2api/src/types.ts";
import { convertAPIRequestWithOptions } from "../../apps/duck2api/src/duckgo/convert.ts";

describe("duck2api embedded free group", () => {
  test("isEmbeddedD2ApiGroup routes only the d2api group in-process", () => {
    expect(isEmbeddedD2ApiGroup({ id: "d2api" } as never)).toBe(true);
    expect(isEmbeddedD2ApiGroup({ id: "opencode-free" } as never)).toBe(false);
    expect(isEmbeddedD2ApiGroup(undefined)).toBe(false);
    expect(isEmbeddedD2ApiGroup(null)).toBe(false);
  });

  test("embedded model table matches the free-group default table (no drift)", () => {
    const embedded = listModels().data.map((m) => m.id).sort();
    expect(embedded).toEqual([...D2API_DEFAULT_MODELS].sort());
    const group = buildD2ApiFreeGroup([]);
    expect([...group.models].sort()).toEqual(embedded);
  });

  test("in-process GET /v1/models serves the embedded directory (no network)", async () => {
    const app = createApp();
    const res = await app.request("/v1/models");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(body.data.map((m) => m.id).sort()).toEqual([...D2API_DEFAULT_MODELS].sort());
  });

  test("assistant content:null (standard OpenAI tool-call shape) validates and coerces", () => {
    const parsed = apiRequestSchema.safeParse({
      model: "gpt-5.4-mini",
      messages: [
        { role: "user", content: "check git status" },
        { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "exec", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call-1", content: "clean" },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const assistant = parsed.data.messages[1]!;
      expect(assistant.content).toBe("");
      // Converted safely: null never reaches DuckDuckGo mapping code.
      const duck = convertAPIRequestWithOptions(parsed.data);
      expect(duck.messages.map((m) => m.role)).toEqual(["user"]);
    }
    // Missing content behaves the same; runtime nulls never throw.
    expect(messageText(null as never)).toBe("");
  });

  test("assistant messages fold into the user stream (duck.ai rejects assistant role)", () => {
    const duck = convertAPIRequestWithOptions({
      model: "gpt-6-luna",
      messages: [
        { role: "user", content: "你是什么模型？" },
        { role: "assistant", content: "我是 gpt-6-luna，这是你选择的模型。" },
        { role: "user", content: "知道了" },
      ],
    });
    expect(duck.messages.map((m) => m.role)).toEqual(["user", "user", "user"]);
    const folded = duck.messages[1]!;
    expect(Array.isArray(folded.content)).toBe(true);
    expect(JSON.stringify(folded.content)).toContain("[assistant] 我是 gpt-6-luna");
  });

  test("in-process POST /v1/chat/completions rejects bad JSON without upstream", async () => {
    const app = createApp();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "", messages: [] })
    });
    expect(res.status).toBe(400);
  });

  test("in-process POST /v1/responses rejects bad JSON without upstream", async () => {
    const app = createApp();
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json"
    });
    expect(res.status).toBe(400);
  });

  test("in-process OPTIONS /v1/responses responds with 204", async () => {
    const app = createApp();
    const res = await app.request("/v1/responses", { method: "OPTIONS" });
    expect(res.status).toBe(204);
  });

  test("runRelayProtocolRequest routes d2api group locally and respects status", async () => {
    const group = { ...buildD2ApiFreeGroup([]), status: "disabled" as const };
    const provider = {
      id: "omniroute-free",
      name: "CodexUltraFree",
      kind: "responsesRelay",
      baseUrl: "https://opencode.ai/zen/v1",
      groups: [group],
    };
    const req = new Request("http://127.0.0.1:43110/api/relay-gateway/omniroute-free/d2api/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        input: [{ role: "user", content: "hi" }]
      })
    });
    const res = await runRelayProtocolRequest({
      request: req,
      provider: provider as never,
      group,
      apiKey: ""
    });
    expect(res.status).toBe(409);
  });
});

