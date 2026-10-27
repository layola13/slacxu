import { describe, expect, test } from "bun:test";
import {
  buildChatCompletionResponse,
  buildForwardRelayProvider,
  estimateForwardTokens,
  FORWARD_RELAY_PROVIDER_ID,
  forwardChatUsage,
  forwardResponseObject,
  forwardResponsesUsage,
  handleForwardModelsRequest,
  handleForwardChatRequest,
  handleForwardResponsesRequest,
  responsesInputToPrompt,
  chatMessagesToPrompt,
  isForwardSharingEnabled,
  isForwardLoopbackAddress,
  resolveForwardCredential,
} from "../../apps/server/src/forwardApi.ts";

const SECURITY = new Headers({ "x-test": "1" });

function request(method: string): Request {
  return new Request("http://127.0.0.1:43121/v1/models", { method });
}

describe("forward /v1/models 入口", () => {
  test("回环判定", () => {
    expect(isForwardLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isForwardLoopbackAddress("::1")).toBe(true);
    expect(isForwardLoopbackAddress(null)).toBe(true);
    expect(isForwardLoopbackAddress("192.168.1.10")).toBe(false);
  });

  test("共享开关默认关闭", () => {
    expect(isForwardSharingEnabled(undefined)).toBe(false);
    expect(isForwardSharingEnabled(null)).toBe(false);
    expect(isForwardSharingEnabled({})).toBe(false);
    expect(isForwardSharingEnabled({ forwardSharingEnabled: false })).toBe(false);
    expect(isForwardSharingEnabled({ forwardSharingEnabled: true })).toBe(true);
  });

  test("开关打开自动生成本地转发中转站 (回环/key/快照)", () => {
    const provider = buildForwardRelayProvider(
      "http://127.0.0.1:43121/v1",
      "secret",
      ["codex-deepkey-default-gpt-5.6-luna", "opencode-deepkey-default-gpt-5.6-luna", "codex-deepkey-default-gpt-5.6-luna"]
    );
    expect(provider.id).toBe(FORWARD_RELAY_PROVIDER_ID);
    expect(provider.name).toBe("Ultra本地转发");
    expect(provider.baseUrl).toBe("http://127.0.0.1:43121/v1");
    expect(provider.baseUrl).not.toContain("0.0.0.0");
    expect(provider.defaultModel).toBe("codex-deepkey-default-gpt-5.6-luna");
    expect(provider.nativeModels).toHaveLength(2);
    const group = provider.groups[0];
    expect(group.id).toBe("default");
    expect(group.kind).toBe("text");
    expect(group.responseProtocol).toBe("openai");
    expect(group.keys).toEqual(["secret"]);
    expect(group.models).toContain("opencode-deepkey-default-gpt-5.6-luna");
  });

  test("开关关闭时三端点全回 403", async () => {
    const off = { remoteAddress: "127.0.0.1", sharingEnabled: false, listInventory: async () => [] as any[] };
    const models = await handleForwardModelsRequest(request("GET"), new URL("http://x/v1/models"), SECURITY, off);
    expect(models.status).toBe(403);
    const chatBody = new Request("http://x/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const chat = await handleForwardChatRequest(chatBody, new URL("http://x/v1/chat/completions"), SECURITY, { ...off, getBridge: async () => null, cwd: process.cwd() });
    expect(chat.status).toBe(403);
    const respBody = new Request("http://x/v1/responses", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const resp = await handleForwardResponsesRequest(respBody, new URL("http://x/v1/responses"), SECURITY, { ...off, getBridge: async () => null, cwd: process.cwd() });
    expect(resp.status).toBe(403);
    expect(((await models.json()) as any).error.type).toBe("forbidden");
  });

  test("非 GET 返回 405 OpenAI 错误体", async () => {
    const res = await handleForwardModelsRequest(request("POST"), new URL("http://x/v1/models"), SECURITY, {
      remoteAddress: "127.0.0.1",
      sharingEnabled: true,
      listInventory: async () => [],
    });
    expect(res.status).toBe(405);
    const body = await res.json() as any;
    expect(body.error.message).toContain("GET");
  });

  test("非回环 403", async () => {
    const res = await handleForwardModelsRequest(request("GET"), new URL("http://x/v1/models"), SECURITY, {
      remoteAddress: "10.0.0.5",
      sharingEnabled: true,
      forwardToken: "secret",
      listInventory: async () => [],
    });
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error.message).toContain("forward API key");
  });

  test("非回环 + 正确 Bearer/x-api-key 放行", async () => {
    const bearer = new Request("http://x/v1/models", { headers: { Authorization: "Bearer secret" } });
    const okBearer = await handleForwardModelsRequest(bearer, new URL("http://x/v1/models"), SECURITY, {
      remoteAddress: "10.0.0.5",
      sharingEnabled: true,
      forwardToken: "secret",
      listInventory: async () => [],
    });
    expect(okBearer.status).toBe(200);
    const keyed = new Request("http://x/v1/models", { headers: { "x-api-key": "secret" } });
    const okKey = await handleForwardModelsRequest(keyed, new URL("http://x/v1/models"), SECURITY, {
      remoteAddress: "10.0.0.5",
      sharingEnabled: true,
      forwardToken: "secret",
      listInventory: async () => [],
    });
    expect(okKey.status).toBe(200);
    const wrong = new Request("http://x/v1/models", { headers: { Authorization: "Bearer wrong" } });
    const denied = await handleForwardModelsRequest(wrong, new URL("http://x/v1/models"), SECURITY, {
      remoteAddress: "10.0.0.5",
      sharingEnabled: true,
      forwardToken: "secret",
      listInventory: async () => [],
    });
    expect(denied.status).toBe(401);
  });

  test("resolveForwardCredential 矩阵", () => {
    const req = (headers?: Record<string, string>) => new Request("http://x/v1/models", { headers });
    expect(resolveForwardCredential(req(), "127.0.0.1", "")).toBe(true);
    expect(resolveForwardCredential(req(), "10.0.0.5", "secret")).toBe(false);
    expect(resolveForwardCredential(req({ Authorization: "Bearer secret" }), "10.0.0.5", "secret")).toBe(true);
    expect(resolveForwardCredential(req({ "x-api-key": "secret" }), "10.0.0.5", "secret")).toBe(true);
    expect(resolveForwardCredential(req({ Authorization: "Bearer wrong" }), "10.0.0.5", "secret")).toBe(false);
  });

  test("回环返回 OpenAI list 形状 (cli-中转站-分组-模型)", async () => {
    const res = await handleForwardModelsRequest(request("GET"), new URL("http://x/v1/models"), SECURITY, {
      remoteAddress: "127.0.0.1",
      sharingEnabled: true,
      listInventory: async () => [
        { providerId: "deepkey", groupId: "codex-team", models: ["gpt-5.6-terra"] },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe("list");
    const ids = body.data.map((entry: any) => entry.id) as string[];
    expect(ids).toContain("opencode-deepkey-codex-team-gpt-5.6-terra");
    expect(body.data[0].owned_by).toBe("codex-ultra");
  });

  test("空库存返回空列表 (JEV 方案 b: 去掉空分组)", async () => {
    const res = await handleForwardModelsRequest(request("GET"), new URL("http://x/v1/models"), SECURITY, {
      remoteAddress: "127.0.0.1",
      sharingEnabled: true,
      listInventory: async () => [],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual([]);
  });

  test("库存失败 500", async () => {
    const res = await handleForwardModelsRequest(request("GET"), new URL("http://x/v1/models"), SECURITY, {
      remoteAddress: "127.0.0.1",
      sharingEnabled: true,
      listInventory: async () => {
        throw new Error("db down");
      },
    });
    expect(res.status).toBe(500);
  });
});

describe("forward /v1/chat/completions (非流, 禁透传)", () => {
  const INVENTORY = [{ providerId: "deepkey", groupId: "default", models: ["gpt-5.6-luna"] }];
  const chatDeps = (overrides: Record<string, any> = {}) => ({
    remoteAddress: "127.0.0.1",
    sharingEnabled: true,
    forwardToken: "secret",
    listInventory: async () => INVENTORY,
    getBridge: async () => null,
    cwd: process.cwd(),
    ...overrides,
  });
  const chatRequest = (body: unknown, headers?: Record<string, string>) =>
    new Request("http://127.0.0.1:43121/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const URL_ = new URL("http://127.0.0.1:43121/v1/chat/completions");

  test("chatMessagesToPrompt 组装 (共享专用: 仅 user, 过滤 system/assistant/tool)", () => {
    expect(chatMessagesToPrompt("nope")).toBe("");
    expect(
      chatMessagesToPrompt([
        { role: "system", content: "sys" },
        { role: "developer", content: "dev" },
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "yo" }] },
        { role: "tool", content: "tool-out" },
      ])
    ).toBe("hi");
    // 多轮 user 拼接, 非 user 全丢弃 (含空文本)。
    expect(
      chatMessagesToPrompt([
        { role: "user", content: "a" },
        { role: "system", content: "s" },
        { role: "user", content: [{ type: "input_text", text: "b" }] },
      ])
    ).toBe("a\n\nb");
    // 无 user 时回退 (工具循环续跑不断): tool 优先于 assistant, system 永丢。
    expect(chatMessagesToPrompt([{ role: "tool", content: "t-out" }])).toBe("t-out");
    expect(chatMessagesToPrompt([{ role: "assistant", content: "a-out" }])).toBe("a-out");
    expect(chatMessagesToPrompt([{ role: "system", content: "s" }])).toBe("");
    expect(chatMessagesToPrompt([
      { role: "assistant", content: "a-out" },
      { role: "tool", content: "t-out" },
    ])).toBe("t-out");
  });

  test("远端无 key 401", async () => {
    const res = await handleForwardChatRequest(
      chatRequest({ model: "codex-deepkey-default-gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
      URL_,
      SECURITY,
      { ...chatDeps(), remoteAddress: "10.0.0.5" }
    );
    expect(res.status).toBe(401);
  });

  test("缺 model / 空 messages / 非法 model 各自 fail-fast", async () => {
    const base = chatDeps();
    const noModel = await handleForwardChatRequest(chatRequest({ messages: [{ role: "user", content: "hi" }] }), URL_, SECURITY, base);
    expect(noModel.status).toBe(400);
    const noMsg = await handleForwardChatRequest(chatRequest({ model: "codex-deepkey-default-gpt-5.6-luna", messages: [] }), URL_, SECURITY, base);
    expect(noMsg.status).toBe(400);
    const badModel = await handleForwardChatRequest(
      chatRequest({ model: "codex-nosuch-default-x", messages: [{ role: "user", content: "hi" }] }),
      URL_,
      SECURITY,
      base
    );
    expect(badModel.status).toBe(404);
    const badBody = await badModel.json() as any;
    expect(badBody.error.type).toBe("model_not_found");
  });

  test("回环 model 请求返回 400 且明确拒绝 (loopback_not_allowed)", async () => {
    const base = chatDeps();
    const loopRes = await handleForwardChatRequest(
      chatRequest({ model: "opencode-ultra-forward-default-gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
      URL_,
      SECURITY,
      base
    );
    expect(loopRes.status).toBe(400);
    const loopBody = (await loopRes.json()) as any;
    expect(loopBody.error.type).toBe("loopback_not_allowed");
    expect(loopBody.error.message).toContain("回环拒绝");

    const directUltra = await handleForwardChatRequest(
      chatRequest({ model: "ultra-forward-default-gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
      URL_,
      SECURITY,
      base
    );
    expect(directUltra.status).toBe(400);
    const directBody = (await directUltra.json()) as any;
    expect(directBody.error.type).toBe("loopback_not_allowed");
    expect(directBody.error.message).toContain("回环拒绝");
  });

  test("stream:true 暂回 400 指引 (P3b 前)", async () => {
    const { EventEmitter } = await import("node:events");
    const emitter = new EventEmitter();
    const fakeBridge = {
      request: async (method: string) => {
        if (method === "thread/start") return { threadId: "thr-1" };
        if (method === "turn/start") {
          queueMicrotask(() => {
            emitter.emit("notification", { method: "item/delta", params: { threadId: "thr-1", turnId: "t1", delta: { type: "text", text: "he" } } });
            emitter.emit("notification", { method: "item/delta", params: { threadId: "thr-1", turnId: "t1", delta: { type: "text", text: "llo" } } });
            // completed 全文与 delta 重复时必须被去重。
            emitter.emit("notification", { method: "item/completed", params: { threadId: "thr-1", turnId: "t1", item: { id: "m", type: "agentMessage", role: "assistant", status: "completed", text: "hello" } } });
            emitter.emit("notification", { method: "turn/completed", params: { threadId: "thr-1", turnId: "t1" } });
          });
          return { turnId: "t1" };
        }
        if (method === "thread/delete") return { ok: true };
        throw new Error(`unexpected ${method}`);
      },
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
    };
    const res = await handleForwardChatRequest(
      chatRequest({ model: "codex-deepkey-default-gpt-5.6-luna", messages: [{ role: "user", content: "hi" }], stream: true }),
      URL_,
      SECURITY,
      chatDeps({ getBridge: async () => fakeBridge })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain('"role":"assistant"');
    expect(text).toContain('"content":"he"');
    expect(text).toContain('"content":"llo"');
    // "hello" 全文不应再出现一次 (去重)。
    expect(text.includes('"content":"hello"')).toBe(false);
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  test("仅 completed 全文时逐段下发", async () => {
    const { EventEmitter } = await import("node:events");
    const emitter = new EventEmitter();
    const fakeBridge = {
      request: async (method: string) => {
        if (method === "thread/start") return { threadId: "thr-1" };
        if (method === "turn/start") {
          queueMicrotask(() => {
            emitter.emit("notification", { method: "item/completed", params: { threadId: "thr-1", turnId: "t1", item: { id: "m", type: "agentMessage", role: "assistant", status: "completed", text: "solo" } } });
            emitter.emit("notification", { method: "turn/completed", params: { threadId: "thr-1", turnId: "t1" } });
          });
          return { turnId: "t1" };
        }
        if (method === "thread/delete") return { ok: true };
        throw new Error(`unexpected ${method}`);
      },
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
    };
    const res = await handleForwardChatRequest(
      chatRequest({ model: "codex-deepkey-default-gpt-5.6-luna", messages: [{ role: "user", content: "hi" }], stream: true }),
      URL_,
      SECURITY,
      chatDeps({ getBridge: async () => fakeBridge })
    );
    const text = await res.text();
    expect(text).toContain('"content":"solo"');
    expect(text).toContain('"finish_reason":"stop"');
  });

  test("静默 turn 期间吐心跳 (防 idleTimeout 掐流)", async () => {
    const { EventEmitter } = await import("node:events");
    const emitter = new EventEmitter();
    const fakeBridge = {
      request: async (method: string) => {
        if (method === "thread/start") return { threadId: "thr-1" };
        if (method === "turn/start") {
          // 180ms 静默后才终态: 心跳 50ms 应至少出现 2 次。
          setTimeout(() => {
            emitter.emit("notification", { method: "turn/completed", params: { threadId: "thr-1", turnId: "t1" } });
          }, 180);
          return { turnId: "t1" };
        }
        if (method === "thread/delete") return { ok: true };
        throw new Error(`unexpected ${method}`);
      },
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
    };
    const res = await handleForwardChatRequest(
      chatRequest({ model: "codex-deepkey-default-gpt-5.6-luna", messages: [{ role: "user", content: "hi" }], stream: true }),
      URL_,
      SECURITY,
      chatDeps({ getBridge: async () => fakeBridge, sseKeepaliveMs: 50 })
    );
    const text = await res.text();
    const pings = text.split(": ping").length - 1;
    expect(pings).toBeGreaterThanOrEqual(2);
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  test("并发超限 429", async () => {
    const { EventEmitter } = await import("node:events");
    const mkBridge = () => {
      const emitter = new EventEmitter();
      return {
        request: async (method: string) => {
          if (method === "thread/start") return { threadId: "thr-hang" };
          if (method === "turn/start") return { turnId: "t-hang" };
          if (method === "thread/delete") return { ok: true };
          if (method === "turn/interrupt") return { ok: true };
          throw new Error(`unexpected ${method}`);
        },
        on: emitter.on.bind(emitter),
        off: emitter.off.bind(emitter),
      };
    };
    const deps = chatDeps({ getBridge: async () => mkBridge(), maxConcurrent: 1, turnTimeoutMs: 300 });
    const first = handleForwardChatRequest(
      chatRequest({ model: "codex-deepkey-default-gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
      URL_,
      SECURITY,
      deps
    );
    const second = await handleForwardChatRequest(
      chatRequest({ model: "codex-deepkey-default-gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
      URL_,
      SECURITY,
      deps
    );
    expect(second.status).toBe(429);
    // 释放槽位: 中断第一个 (超时设短以便快速结束)。
    const firstRes = await first;
    expect([200, 502, 504]).toContain(firstRes.status);
  });

  test("后端未启用 502", async () => {
    const res = await handleForwardChatRequest(
      chatRequest({ model: "codex-deepkey-default-gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
      URL_,
      SECURITY,
      chatDeps()
    );
    expect(res.status).toBe(502);
    const body = await res.json() as any;
    expect(body.error.message).toContain("未启用");
  });

  test("fake bridge 端到端回 OpenAI 形状 (禁透传: 只经 bridge.request)", async () => {
    const calls: string[] = [];
    const { EventEmitter } = await import("node:events");
    const emitter = new EventEmitter();
    const fakeBridge = {
      request: async (method: string, params?: any) => {
        calls.push(method);
        if (method === "thread/start") {
          // 断言转发路由参数确经 CLI thread 传递 (无上游直调)。
          expect(params.providerId).toBe("deepkey");
          expect(params.groupId).toBe("default");
          expect(params.model).toBe("gpt-5.6-luna");
          return { threadId: "thr-1" };
        }
        if (method === "turn/start") {
          queueMicrotask(() => {
            emitter.emit("notification", { method: "item/completed", params: { threadId: "thr-1", turnId: "t1", item: { id: "m", type: "agentMessage", role: "assistant", status: "completed", text: "done" } } });
            emitter.emit("notification", { method: "turn/completed", params: { threadId: "thr-1", turnId: "t1" } });
          });
          return { turnId: "t1" };
        }
        if (method === "thread/delete") return { ok: true };
        throw new Error(`unexpected ${method}`);
      },
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
    };
    const res = await handleForwardChatRequest(
      chatRequest({ model: "codex-deepkey-default-gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
      URL_,
      SECURITY,
      chatDeps({ getBridge: async () => fakeBridge })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("codex-deepkey-default-gpt-5.6-luna");
    expect(body.choices[0].message).toEqual({ role: "assistant", content: "done" });
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(calls).toEqual(["thread/start", "turn/start", "thread/delete"]);
  });
});

describe("forward /v1/responses (双模, 禁透传)", () => {
  const INVENTORY = [{ providerId: "deepkey", groupId: "default", models: ["gpt-5.6-luna"] }];
  const deps = (overrides: Record<string, any> = {}) => ({
    remoteAddress: "127.0.0.1",
    sharingEnabled: true,
    forwardToken: "secret",
    listInventory: async () => INVENTORY,
    getBridge: async () => null,
    cwd: process.cwd(),
    ...overrides,
  });
  const responsesRequest = (body: unknown) =>
    new Request("http://127.0.0.1:43121/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const URL_ = new URL("http://127.0.0.1:43121/v1/responses");

  test("responsesInputToPrompt 组装 (user 优先, 无 user 时工具/assistant 回退不断跑)", () => {
    expect(responsesInputToPrompt("hello")).toBe("hello");
    // instructions (system 层) 直接丢弃, user 照常。
    expect(responsesInputToPrompt([{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }], "sys")).toBe("hi");
    // 工具循环续跑腿 (无 user 时): function_call_output 回退执行, 不再 400。
    expect(responsesInputToPrompt([{ type: "function_call_output", output: "42" }])).toBe("42");
    expect(responsesInputToPrompt([
      { type: "function_call", name: "x", arguments: "{}" },
      { type: "function_call_output", output: "42" },
    ])).toBe("42");
    // assistant 仅回退 (user 存在时仍丢弃)。
    expect(responsesInputToPrompt([
      { type: "message", role: "user", content: "hi" },
      { type: "message", role: "assistant", content: "yo" },
    ])).toBe("hi");
    expect(responsesInputToPrompt([{ type: "message", role: "assistant", content: "yo" }])).toBe("yo");
    // 裸消息 (无 type) 兼容; 纯 system/instructions 仍为空 (由调用方 400)。
    expect(responsesInputToPrompt([{ role: "user", content: "hi" }])).toBe("hi");
    expect(responsesInputToPrompt([{ type: "message", role: "system", content: "s" }], "sys")).toBe("");
    expect(responsesInputToPrompt([{ type: "function_call", name: "x" }])).toBe("");
  });

  test("返回组装: 上传什么组装什么 (usage全量+responses回显)", () => {
    // chat usage 按全量 messages 还原 (含被过滤的 system/tool), 远大于纯 user。
    const msgs = [
      { role: "system", content: "you are helpful, longer system prompt for token count" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "old" },
      { role: "tool", content: "tool output data" },
    ];
    const chat = buildChatCompletionResponse("m", "hello world", msgs) as any;
    expect(chat.model).toBe("m");
    expect(chat.choices[0].message).toEqual({ role: "assistant", content: "hello world" });
    expect(chat.usage.prompt_tokens).toBeGreaterThan(estimateForwardTokens("hi"));
    expect(chat.usage.total_tokens).toBe(chat.usage.prompt_tokens + chat.usage.completion_tokens);
    expect(forwardChatUsage(msgs, "hello world").prompt_tokens).toBe(chat.usage.prompt_tokens);
    // forward_echo 原样带回上传的 system/tool/assistant (非标扩展, 严格客户端忽略)。
    expect(chat.forward_echo).toEqual({ messages: msgs });
    // responses 回显上传的 instructions/tools, usage 按全量还原。
    const tools = [{ type: "function", name: "get_weather" }];
    const usage = forwardResponsesUsage([{ type: "message", role: "user", content: "hi" }], "sys up", "result here");
    const resp = forwardResponseObject("m", "result here", "completed", usage, {
      instructions: "sys up",
      tools,
      tool_choice: "auto",
      parallel_tool_calls: true,
    }, { input: [{ type: "message", role: "user", content: "hi" }], instructions: "sys up" }) as any;
    expect(resp.instructions).toBe("sys up");
    expect(resp.tools).toEqual(tools);
    expect(resp.parallel_tool_calls).toBe(true);
    expect(resp.usage.input_tokens).toBeGreaterThan(estimateForwardTokens("hi"));
    expect(resp.forward_echo).toEqual({ input: [{ type: "message", role: "user", content: "hi" }], instructions: "sys up" });
    // 缺省回标准默认值, 不破坏严格客户端。
    const def = forwardResponseObject("m", "hi", "completed") as any;
    expect(def.instructions).toBeNull();
    expect(def.tools).toEqual([]);
    // failed 不回 output (旧 || 优先级 bug 已修)。
    const failed = forwardResponseObject("m", "some text", "failed") as any;
    expect(failed.output).toEqual([]);
  });

  test("previous_response_id 明确拒绝 (v1 无状态)", async () => {
    const res = await handleForwardResponsesRequest(
      responsesRequest({ model: "codex-deepkey-default-gpt-5.6-luna", input: "hi", previous_response_id: "resp-1" }),
      URL_,
      SECURITY,
      deps()
    );
    expect(res.status).toBe(400);
  });

  test("非流回 response 对象", async () => {
    const { EventEmitter } = await import("node:events");
    const emitter = new EventEmitter();
    const fakeBridge = {
      request: async (method: string) => {
        if (method === "thread/start") return { threadId: "thr-1" };
        if (method === "turn/start") {
          queueMicrotask(() => {
            emitter.emit("notification", { method: "item/completed", params: { threadId: "thr-1", turnId: "t1", item: { id: "m", type: "agentMessage", role: "assistant", status: "completed", text: "ok" } } });
            emitter.emit("notification", { method: "turn/completed", params: { threadId: "thr-1", turnId: "t1" } });
          });
          return { turnId: "t1" };
        }
        if (method === "thread/delete") return { ok: true };
        throw new Error(`unexpected ${method}`);
      },
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
    };
    const res = await handleForwardResponsesRequest(
      responsesRequest({ model: "codex-deepkey-default-gpt-5.6-luna", input: "hi" }),
      URL_,
      SECURITY,
      deps({ getBridge: async () => fakeBridge })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe("response");
    expect(body.status).toBe("completed");
    expect(body.output[0].content[0]).toEqual({ type: "output_text", text: "ok", annotations: [] });
  });

  test("流式吐 response.created/delta/completed/done", async () => {
    const { EventEmitter } = await import("node:events");
    const emitter = new EventEmitter();
    const fakeBridge = {
      request: async (method: string) => {
        if (method === "thread/start") return { threadId: "thr-1" };
        if (method === "turn/start") {
          queueMicrotask(() => {
            emitter.emit("notification", { method: "item/delta", params: { threadId: "thr-1", turnId: "t1", delta: { type: "text", text: "ab" } } });
            emitter.emit("notification", { method: "turn/completed", params: { threadId: "thr-1", turnId: "t1" } });
          });
          return { turnId: "t1" };
        }
        if (method === "thread/delete") return { ok: true };
        throw new Error(`unexpected ${method}`);
      },
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
    };
    const res = await handleForwardResponsesRequest(
      responsesRequest({ model: "codex-deepkey-default-gpt-5.6-luna", input: "hi", stream: true }),
      URL_,
      SECURITY,
      deps({ getBridge: async () => fakeBridge })
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: response.created");
    expect(text).toContain("response.output_text.delta");
    expect(text).toContain('"delta":"ab"');
    expect(text).toContain("event: response.completed");
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });
});
