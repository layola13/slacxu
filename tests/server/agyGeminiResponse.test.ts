import { describe, expect, it } from "bun:test";
import type http from "node:http";
import {
  formatAgyGeminiResponse,
  forwardAgyGeminiStream,
  isAgyGeminiEndpoint,
} from "../../backends/agy/src/runtime/agyGeminiResponse.js";
import { AgyProxyServer, type AgyUpstreamProtocol } from "../../backends/agy/src/runtime/agyCompatibleProxy.js";

function parseChunks(text: string): any[] {
  return text.split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5)));
}

describe("AGY Gemini response framing", () => {
  it("distinguishes Code Assist RPCs from native Gemini endpoints", () => {
    expect(isAgyGeminiEndpoint("/v1internal:streamGenerateContent")).toBe(false);
    expect(isAgyGeminiEndpoint("/v1internal/streamGenerateContent")).toBe(false);
    expect(isAgyGeminiEndpoint("/v1beta/models/test:streamGenerateContent")).toBe(true);
    expect(isAgyGeminiEndpoint("/v1/models/test:streamGenerateContent")).toBe(true);
    expect(isAgyGeminiEndpoint("/models/test:streamGenerateContent")).toBe(true);
  });

  it("unwraps native Gemini output and wraps Code Assist output exactly once", () => {
    const response = { candidates: [{ content: { parts: [{ text: "hello" }] } }] };
    expect(formatAgyGeminiResponse(response, true)).toEqual(response);
    expect(formatAgyGeminiResponse({ response }, true)).toEqual(response);
    expect(formatAgyGeminiResponse(response, false)).toEqual({ response });
    expect(formatAgyGeminiResponse({ response }, false)).toEqual({ response });
  });

  it("normalizes fragmented native SSE with UTF-8, CRLF, multiline data and an unterminated final event", async () => {
    const text = 'event: message\r\ndata: {"candidates":\r\ndata: [{"content":{"parts":[{"text":"你好"}]}}]}\r\n\r\ndata: {"usageMetadata":{"totalTokenCount":7}}';
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    let output = "";
    const response = { write(chunk: string) { output += chunk; } } as unknown as http.ServerResponse;
    await forwardAgyGeminiStream(body, response, false);
    const chunks = parseChunks(output);
    expect(output).toContain("event: message");
    expect(chunks[0].response.candidates[0].content.parts[0].text).toBe("你好");
    expect(chunks[1].response.usageMetadata.totalTokenCount).toBe(7);
    expect(body.locked).toBe(false);
  });

  for (const protocol of ["openai", "openai-response", "anthropic", "gemini"] as AgyUpstreamProtocol[]) {
    for (const nativeClient of [false, true]) {
      it(`${protocol} preserves text and tools with ${nativeClient ? "native Gemini" : "Code Assist"} framing`, async () => {
        let upstreamPath = "";
        const tool = { id: "call-test", name: "read_file", args: { path: "test.txt" } };
        const geminiResult = {
          candidates: [{ content: { role: "model", parts: [{ text: "hello" }, { functionCall: tool }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
        };
        const upstream = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            upstreamPath = new URL(request.url).pathname;
            const body = await request.json() as any;
            expect(body.model ?? upstreamPath).toContain("target-model");
            if (protocol === "gemini") {
              return new Response(`data: ${JSON.stringify(geminiResult)}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
            }
            if (protocol === "openai-response") {
              return Response.json({
                output: [
                  { type: "message", content: [{ type: "output_text", text: "hello" }] },
                  { type: "function_call", call_id: tool.id, name: tool.name, arguments: JSON.stringify(tool.args) },
                ],
              });
            }
            if (protocol === "anthropic") {
              return Response.json({ content: [{ type: "text", text: "hello" }, { type: "tool_use", id: tool.id, name: tool.name, input: tool.args }] });
            }
            const chunk = { choices: [{ delta: { content: "hello", tool_calls: [{ index: 0, id: tool.id, function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }, finish_reason: "tool_calls" }] };
            return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
          },
        });
        const proxy = new AgyProxyServer({ targetBaseUrl: `http://127.0.0.1:${upstream.port}`, targetModel: "target-model", protocol, apiKeys: ["mock-key"] });
        try {
          const url = await proxy.start();
          const path = nativeClient ? "/v1beta/models/cli-model:streamGenerateContent" : "/v1internal:streamGenerateContent";
          const request = { contents: [{ role: "user", parts: [{ text: "hello" }] }] };
          const response = await fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nativeClient ? request : { request }) });
          expect(response.status).toBe(200);
          const chunks = parseChunks(await response.text());
          for (const chunk of chunks) expect(Boolean(chunk.response)).toBe(!nativeClient);
          const results = chunks.map((chunk) => nativeClient ? chunk : chunk.response);
          const parts = results.flatMap((result) => result.candidates?.[0]?.content?.parts ?? []);
          expect(parts.find((part) => part.text)?.text).toBe("hello");
          expect(parts.find((part) => part.functionCall)?.functionCall).toEqual(tool);
          expect(results.some((result) => result.candidates?.[0]?.finishReason === "STOP")).toBe(true);
          expect(upstreamPath).toBe(protocol === "gemini" ? "/v1beta/models/target-model:streamGenerateContent" : protocol === "anthropic" ? "/v1/messages" : protocol === "openai-response" ? "/v1/responses" : "/v1/chat/completions");
        } finally {
          await proxy.stop();
          await upstream.stop(true);
        }
      });
    }
  }

  for (const nativeClient of [false, true]) {
    it(`normalizes plain native Gemini JSON for ${nativeClient ? "native Gemini" : "Code Assist"} clients`, async () => {
      const result = { candidates: [{ content: { role: "model", parts: [{ text: "json-fallback" }] }, finishReason: "STOP" }] };
      const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return Response.json(result); } });
      const proxy = new AgyProxyServer({ targetBaseUrl: `http://127.0.0.1:${upstream.port}`, targetModel: "test", protocol: "gemini" });
      try {
        const url = await proxy.start();
        const path = nativeClient ? "/v1/models/test:streamGenerateContent" : "/v1internal:streamGenerateContent";
        const response = await fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [] }) });
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        expect(parseChunks(await response.text())).toEqual([nativeClient ? result : { response: result }]);
      } finally {
        await proxy.stop();
        await upstream.stop(true);
      }
    });
  }

  it("returns native Gemini-shaped error chunks instead of a wrapped empty response", async () => {
    const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return Response.json({ error: { message: "Model does not support this protocol." } }, { status: 400 }); } });
    const proxy = new AgyProxyServer({ targetBaseUrl: `http://127.0.0.1:${upstream.port}`, targetModel: "test", protocol: "openai-response" });
    try {
      const url = await proxy.start();
      const response = await fetch(`${url}/v1beta/models/test:streamGenerateContent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello" }] }] }) });
      expect(response.status).toBe(200);
      const chunk = parseChunks(await response.text())[0];
      expect(chunk.response).toBeUndefined();
      expect(chunk.candidates[0].content.parts[0].text).toContain("Model does not support this protocol.");
      expect(chunk.candidates[0].finishReason).toBe("STOP");
    } finally {
      await proxy.stop();
      await upstream.stop(true);
    }
  });
});
