import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { convertAPIRequestWithOptions } from "./duckgo/convert.js";
import { postConversation } from "./duckgo/upstream.js";
import { consumeUpstream, consumeUpstreamResponses } from "./duckgo/stream.js";
import { newChatCompletionFull } from "./duckgo/response.js";
import { cacheHeaders, countMessagesTokens, countToken, hashPrompt, recordCache } from "./duckgo/tokens.js";
import { apiError, apiRequestSchema, imageGenerationSchema, listModels, messageText, parseReasoningEffort, type ApiMessage } from "./types.js";
import { readImageResponse } from "./duckgo/image.js";

const PREFIX = process.env["PREFIX"] ?? "";
const API_KEYS = new Set(
  (process.env["API_KEYS"] ?? process.env["API_KEY"] ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean),
);

export function createApp() {
  const app = new Hono();

  app.get("/", (c) => c.text("duck2api-ts ok"));
  app.get("/ping", (c) => c.text("pong"));

  const v1 = new Hono();

  // Authorization (port of middlewares.Authorization): empty allow-list means
  // open access, matching the Go behavior of skipping auth without keys.
  v1.use("*", async (c, next) => {
    if (API_KEYS.size === 0) return next();
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : header;
    if (!API_KEYS.has(token)) {
      return c.json(apiError("Unauthorized", "authentication_error", "unauthorized"), 401);
    }
    await next();
  });

  v1.on("OPTIONS", "/v1/chat/completions", (c) => c.body(null, 204));
  v1.post(
    "/v1/chat/completions",
    zValidator("json", apiRequestSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          apiError("Request must be proper JSON", "invalid_request_error", "bad_json"),
          400,
        );
      }
      return undefined;
    }),
    async (c) => {
      const body = c.req.valid("json");
      // Resolve thinking effort: flat reasoning_effort OR nested
      // {"effort":"low"} (Codex/Responses shape), else env fallback.
      // Port of Handler.duckduckgo effort block (handlers.go:68-77).
      let effort = body.reasoning_effort ?? "";
      if (!effort) effort = parseReasoningEffort(body.reasoning);
      if (!effort) effort = process.env["CLAUDE_CODE_EFFORT_LEVEL"] ?? "";

      // Only enable web search when the client explicitly requests it
      // (handlers.go:272 `WebSearch != nil && *WebSearch`).
      const webSearch = body.web_search === true;
      // Pure-conversation channel: client `tools` are never projected
      // upstream (no manifest prompt, no playgame simulation).
      const translated = convertAPIRequestWithOptions(body, {
        reasoningEffort: effort,
        webSearch,
      });

      // Usage/cache reflect what actually goes upstream (pure conversation:
      // system/developer/tool content is intercepted, never tokenized).
      const projectedInput = translated.messages as ApiMessage[];
      const inputTokens = countMessagesTokens(projectedInput);
      const promptHash = hashPrompt(projectedInput.map((m) => `${messageText(m.content)}\n`).join(""));
      const cache = recordCache(promptHash, inputTokens);

      const proxyUrl = process.env["PROXY_URL"] ?? "";
      const upstream = await postConversation(translated, "", proxyUrl);
      if (!upstream.ok) {
        const status = upstream.status as 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503;
        if (upstream.status === 503 && upstream.retryAfterSec !== undefined) {
          c.header("Retry-After", String(upstream.retryAfterSec));
        }
        return c.json(
          apiError(upstream.errorBody ?? "upstream request failed", "upstream_error", String(upstream.status)),
          (status >= 400 && status <= 599 ? status : 500) as 500,
        );
      }

      const start = Date.now();
      const stats = { start, promptTokens: inputTokens, cachedTokens: cache.read, effort };

      // Cache headers before the first byte (handlers.go:114-116 + setCacheHeaders).
      c.header("X-Cache-Creation-Tokens", String(cache.creation));
      c.header("X-Cache-Read-Tokens", String(cache.read));
      const ch = cacheHeaders(promptHash);
      c.header("X-Cache", ch.xCache);
      if (ch.xCache === "HIT") c.header("Age", String(ch.age));

      if (!body.stream) {
        const result = await consumeUpstream({
          body: upstream.body ?? null,
          requestModel: translated.model,
          reasoningEffort: translated.reasoningEffort,
          toolSimulation: translated.toolSimulation === true,
          stream: false,
          stats,
          write: () => {},
          countTokens: countToken,
        });
        if (!result) {
          return c.json(apiError("Error", "upstream_error"), 500);
        }
        c.header("X-TTFT-Ms", String(result.ttftMs));
        c.header("X-Total-Time-Ms", String(result.totalMs));
        return c.json(
          newChatCompletionFull(
            result.text,
            translated.model,
            inputTokens,
            result.outputTokens,
            cache.read,
            result.ttftMs,
            result.totalMs,
            effort,
            result.toolCalls,
          ),
        );
      }

      // Stream path: newline-delimited SSE + terminal data: [DONE] (handlers.go:143-144).
      const sse = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enc = new TextEncoder();
          const sink = (line: string) => {
            controller.enqueue(enc.encode(line));
          };
          const result = await consumeUpstream({
            body: upstream.body ?? null,
            requestModel: translated.model,
            reasoningEffort: translated.reasoningEffort,
            toolSimulation: translated.toolSimulation === true,
            stream: true,
            stats,
            write: sink,
            countTokens: countToken,
          });
          // NOTE: X-TTFT-Ms/X-Total-Time-Ms headers cannot be set after the
          // Response starts flowing; timing already rides in the usage chunk
          // (same as Go: "the same values are in the final usage chunk").
          void result;
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(sse, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
      });
    },
  );

  v1.on("OPTIONS", "/v1/responses", (c) => c.body(null, 204));
  v1.post("/v1/responses", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json(
        apiError("Request must be proper JSON", "invalid_request_error", "bad_json"),
        400,
      );
    }

    const model = typeof body.model === "string" && body.model ? body.model : "gpt-5.4-mini";
    let effort = typeof body.reasoning_effort === "string" ? body.reasoning_effort.trim() : "";
    if (!effort) effort = parseReasoningEffort(body.reasoning);
    if (!effort) effort = process.env["CLAUDE_CODE_EFFORT_LEVEL"] ?? "";
    if (!effort && Array.isArray(body.include) && body.include.some((item: unknown) => typeof item === "string" && item.includes("reasoning"))) {
      effort = "low";
    }

    const messages: ApiMessage[] = [];
    // Pure-conversation channel: `instructions` (system prompt) is
    // intercepted and never sent upstream. Only human dialogue passes.
    if (typeof body.input === "string") {
      if (body.input.trim()) messages.push({ role: "user", content: body.input });
    } else if (Array.isArray(body.input)) {
      for (const item of body.input) {
        if (typeof item === "string") {
          if (item.trim()) messages.push({ role: "user", content: item });
          continue;
        }
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const type = String(rec.type ?? "");
        if (type === "message" || !type) {
          const rawRole = String(rec.role ?? "");
          const role = (rawRole === "assistant" || rawRole === "system") ? rawRole : "user";
          const rawContent = rec.content;
          if (typeof rawContent === "string") {
            if (rawContent.trim()) messages.push({ role, content: rawContent });
          } else if (Array.isArray(rawContent)) {
            messages.push({ role, content: rawContent as never });
          }
          continue;
        }
        if (type === "function_call" || type === "function_call_output") {
          // Pure-conversation channel: tool calls and tool results are
          // dropped entirely (no playgame envelope, no plain-text relay).
          continue;
        }
      }
    }

    const isStream = body.stream === true;
    // Responses API mirrors chat: only explicit web_search=true enables it.
    // Pure-conversation channel: client `tools` are never projected upstream.
    const webSearch = body.web_search === true;
    const translated = convertAPIRequestWithOptions(
      { model, messages, stream: isStream, reasoning_effort: effort },
      { reasoningEffort: effort, webSearch }
    );

    // Usage/cache reflect what actually goes upstream (pure conversation:
    // instructions/system/tool content is intercepted, never tokenized).
    const projectedInput = translated.messages as ApiMessage[];
    const inputTokens = countMessagesTokens(projectedInput);
    const promptHash = hashPrompt(projectedInput.map((m) => `${messageText(m.content)}\n`).join(""));
    const cache = recordCache(promptHash, inputTokens);

    const proxyUrl = process.env["PROXY_URL"] ?? "";
    const upstream = await postConversation(translated, "", proxyUrl);
    if (!upstream.ok) {
      const status = upstream.status as 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503;
      if (upstream.status === 503 && upstream.retryAfterSec !== undefined) {
        c.header("Retry-After", String(upstream.retryAfterSec));
      }
      return c.json(
        apiError(upstream.errorBody ?? "upstream request failed", "upstream_error", String(upstream.status)),
        (status >= 400 && status <= 599 ? status : 500) as 500,
      );
    }

    const start = Date.now();
    const stats = { start, promptTokens: inputTokens, cachedTokens: cache.read, effort };

    c.header("X-Cache-Creation-Tokens", String(cache.creation));
    c.header("X-Cache-Read-Tokens", String(cache.read));
    const ch = cacheHeaders(promptHash);
    c.header("X-Cache", ch.xCache);
    if (ch.xCache === "HIT") c.header("Age", String(ch.age));

    if (!isStream) {
      const result = await consumeUpstreamResponses({
        body: upstream.body ?? null,
        requestModel: translated.model,
        reasoningEffort: translated.reasoningEffort,
        toolSimulation: translated.toolSimulation === true,
        stream: false,
        stats,
        write: () => {},
        countTokens: countToken,
      });
      if (!result) {
        return c.json(apiError("Error", "upstream_error"), 500);
      }
      c.header("X-TTFT-Ms", String(result.ttftMs));
      c.header("X-Total-Time-Ms", String(result.totalMs));
      return c.json(result.response);
    }

    const sse = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        const sink = (line: string) => {
          controller.enqueue(enc.encode(line));
        };
        await consumeUpstreamResponses({
          body: upstream.body ?? null,
          requestModel: translated.model,
          reasoningEffort: translated.reasoningEffort,
          toolSimulation: translated.toolSimulation === true,
          stream: true,
          stats,
          write: sink,
          countTokens: countToken,
        });
        controller.close();
      },
    });
    return new Response(sse, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  });

  v1.on("OPTIONS", "/v1/models", (c) => c.body(null, 204));
  // Port of Handler.engines (handlers.go:1037).
  v1.get("/v1/models", (c) => c.json(listModels()));

  v1.on("OPTIONS", "/v1/images/generations", (c) => c.body(null, 204));
  // Port of Handler.imageGenerations (handlers.go:777): chat request with
  // GenerateImage enabled, images extracted from the ui-component SSE parts.
  v1.post(
    "/v1/images/generations",
    zValidator("json", imageGenerationSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          apiError("Request must be proper JSON", "invalid_request_error", "bad_json"),
          400,
        );
      }
      return undefined;
    }),
    async (c) => {
      const body = c.req.valid("json");
      if (!body.prompt.trim()) {
        return c.json(apiError("prompt is required", "invalid_request_error", "missing_prompt"), 400);
      }
      const model = body.model?.trim() ? body.model.trim() : "gpt-5.4-nano";
      let effort = body.reasoning_effort ?? "";
      if (!effort) effort = parseReasoningEffort(body.reasoning);
      if (!effort) effort = process.env["CLAUDE_CODE_EFFORT_LEVEL"] ?? "";

      const translated = convertAPIRequestWithOptions(
        { model, messages: [{ role: "user", content: body.prompt }], stream: false, reasoning_effort: effort },
        { reasoningEffort: effort, generateImage: true },
      );

      const proxyUrl = process.env["PROXY_URL"] ?? "";
      const upstream = await postConversation(translated, "", proxyUrl);
      if (!upstream.ok) {
        const status = upstream.status as 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503;
        return c.json(
          apiError(upstream.errorBody ?? "Failed to generate image", "upstream_error", String(upstream.status)),
          (status >= 400 && status <= 599 ? status : 500) as 500,
        );
      }

      let sseText = "";
      if (upstream.body) {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (value && value.length > 0) sseText += decoder.decode(value, { stream: !done });
          if (done) {
            sseText += decoder.decode();
            break;
          }
        }
      }
      const result = readImageResponse(sseText);
      const data = result.images
        .filter((img) => img.b64 !== "")
        .map((img) => ({ b64_json: img.b64, revised_prompt: result.text }));
      if (data.length === 0) {
        return c.json(apiError("No images were generated", "internal_server_error", "no_images"), 500);
      }
      return c.json({ created: Math.floor(Date.now() / 1000), data });
    },
  );

  const base = PREFIX === "" ? "/" : PREFIX.startsWith("/") ? PREFIX : `/${PREFIX}`;
  app.route(base, v1);
  return app;
}
