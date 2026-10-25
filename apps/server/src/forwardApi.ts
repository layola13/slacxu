import {
  buildForwardModelIds,
  FORWARD_ACTIVE_CLIS,
  FORWARD_RELAY_PROVIDER_ID,
  ForwardModelError,
  parseForwardModelId,
  toParseInventory,
  type ForwardModelInventory,
  type ForwardRoute,
} from "./forwardModel.js";
import {
  FORWARD_DEFAULT_TIMEOUT_MS,
  runForwardTurn,
  type ForwardBridge,
} from "./forwardTurn.js";
import type { CliBackend } from "@codex-ui/shared";

// index.ts 沿用旧导入位 (实际定义在 forwardModel.ts)。
export { FORWARD_RELAY_PROVIDER_ID };

/**
 * Ultra 对外 /v1 转发的 HTTP 入口 (P1: GET /v1/models)。
 *
 * - 挂载在 CXU 本端口, 与 workbench 同源 (baseURL=http://127.0.0.1:PORT/v1)。
 * - P1 仅回环可达 (与 /api/relay-gateway 一致); P2 引入转发 key 后开放远端。
 * - 错误体用 OpenAI 兼容形状 { error: { message, type } }, 便于外部 CLI 解析。
 */

export const FORWARD_LOOPBACK_ADDRESSES = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

export function isForwardLoopbackAddress(address: string | null | undefined): boolean {
  return !address || FORWARD_LOOPBACK_ADDRESSES.includes(address);
}

export const FORWARD_TOKEN_ENV_KEY = "CODEX_UI_FORWARD_TOKEN";

/**
 * 对外共享总开关 (中转站设置, 默认关闭)。
 * 存 userPreferencesStore owner="server" 的 forwardSharingEnabled。
 */
export const FORWARD_SETTINGS_OWNER = "server";
export function isForwardSharingEnabled(prefs: Record<string, unknown> | null | undefined): boolean {
  return (prefs as Record<string, unknown> | undefined)?.forwardSharingEnabled === true;
}

/**
 * 开关打开时自动生成的本地转发中转站 (对标 CodexUltraFree 导入)。
 * baseUrl 恒为回环 (注意回环: 永不写 0.0.0.0), key 为当前转发 token,
 * models 为生成时刻的 /v1/models 快照。key 轮换 (重启未配 env) 后重开
 * 一次开关即重同步；关闭开关只停 /v1, 不删该中转站。
 */
export const FORWARD_RELAY_GROUP_ID = "default";
export interface ForwardRelayProvider {
  id: string;
  name: string;
  kind: "openai";
  serviceProvider: { id: string; name: string };
  baseUrl: string;
  defaultModel: string;
  nativeModels: string[];
  modelAliases: Array<{ alias: string; model: string }>;
  stationType: "official";
  channelMode: "fast";
  remark: string;
  groups: {
    id: string;
    name: string;
    baseUrl: string;
    kind: "text";
    status: "enabled";
    groupRatio: number;
    models: string[];
    responseProtocol: "openai";
    responseProtocolMode: "fixed";
    remark: string;
    authType: "bearer";
    credentialMode: "group";
    keyMode: "single";
    keys: string[];
  }[];
  createdAt: number;
  updatedAt: number;
}
export function buildForwardRelayProvider(
  baseUrl: string,
  token: string,
  modelIds: string[],
  createdAt?: number
): ForwardRelayProvider {
  const models = [...new Set(modelIds.filter(Boolean))];
  const now = Date.now();
  return {
    id: FORWARD_RELAY_PROVIDER_ID,
    name: "Ultra本地转发",
    kind: "openai",
    serviceProvider: { id: "ultra-forward", name: "Ultra本地转发" },
    baseUrl,
    defaultModel: models[0] ?? "",
    nativeModels: models,
    modelAliases: [],
    stationType: "official",
    channelMode: "fast",
    remark: "对外共享开关自动生成 (回环 /v1); 关闭开关后停用, key 轮换后重开同步",
    groups: [
      {
        id: FORWARD_RELAY_GROUP_ID,
        name: FORWARD_RELAY_GROUP_ID,
        baseUrl,
        kind: "text",
        status: "enabled",
        groupRatio: 1,
        models,
        responseProtocol: "openai",
        responseProtocolMode: "fixed",
        remark: "转发全量模型快照 (生成时刻)",
        authType: "bearer",
        credentialMode: "group",
        keyMode: "single",
        keys: token ? [token] : [],
      },
    ],
    createdAt: createdAt ?? now,
    updatedAt: now,
  };
}

function forwardSharingDisabled(security: Headers): Response {
  return forwardError("对外共享未开启 (请在中转站设置中打开对外共享开关)", 403, security, "forbidden");
}

/**
 * P2 转发凭证: 回环直接放行 (与 relay-gateway 一致), 非回环必须
 * `Authorization: Bearer <token>` 或 `x-api-key: <token>`。
 */
export function resolveForwardCredential(
  request: Request,
  remoteAddress: string | null | undefined,
  forwardToken: string
): boolean {
  if (isForwardLoopbackAddress(remoteAddress)) return true;
  if (!forwardToken) return false;
  const authorization = request.headers.get("Authorization") ?? "";
  if (authorization === `Bearer ${forwardToken}`) return true;
  return request.headers.get("x-api-key") === forwardToken;
}

function forwardJson(value: unknown, status: number, security: Headers): Response {
  const responseHeaders = new Headers(security);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function forwardError(message: string, status: number, security: Headers, type = "invalid_request_error"): Response {
  return forwardJson({ error: { message, type } }, status, security);
}

export interface ForwardModelsDeps {
  remoteAddress?: string | null;
  /** P2 转发 key; 为空表示仅回环 (与 P1 行为一致)。 */
  forwardToken?: string;
  /** 对外共享总开关 (默认 false); 关闭时 /v1 全回 403。 */
  sharingEnabled?: boolean;
  listInventory: () => Promise<ForwardModelInventory[]>;
}

/** GET /v1/models: cli × 有效文本分组 × 已同步模型笛卡尔展开 (JEV 方案 b)。 */
export async function handleForwardModelsRequest(
  request: Request,
  _url: URL,
  security: Headers,
  deps: ForwardModelsDeps
): Promise<Response> {
  if (request.method !== "GET") {
    return forwardError("Only GET /v1/models is supported", 405, security);
  }
  if (!deps.sharingEnabled) return forwardSharingDisabled(security);
  if (!resolveForwardCredential(request, deps.remoteAddress, deps.forwardToken ?? "")) {
    // 回环必放行, 走到这里一定是非回环且 key 缺失/错误。
    return forwardError("Invalid or missing forward API key", 401, security, "authentication_error");
  }
  let inventory: ForwardModelInventory[];
  try {
    inventory = await deps.listInventory();
  } catch (error) {
    return forwardError(
      `Failed to list forward inventory: ${error instanceof Error ? error.message : String(error)}`,
      500,
      security,
      "server_error"
    );
  }
  const ids = buildForwardModelIds(FORWARD_ACTIVE_CLIS, inventory);
  return forwardJson(
    {
      object: "list",
      data: ids.map((id) => ({ id, object: "model", created: 0, owned_by: "codex-ultra" })),
    },
    200,
    security
  );
}

export interface ForwardChatDeps extends ForwardModelsDeps {
  /** 按 cliBackend 取执行 bridge (禁透传: 一律经 CLI 发送, 无直调上游)。 */
  getBridge: (cli: CliBackend) => Promise<ForwardBridge | null>;
  /** forward thread 的工作目录 (默认进程 cwd, 可配 CODEX_UI_FORWARD_CWD)。 */
  cwd: string;
  turnTimeoutMs?: number;
  /** 并发上限 (默认 4, 可配 CODEX_UI_FORWARD_MAX_CONCURRENT); 超限回 429。 */
  maxConcurrent?: number;
  /** SSE 心跳间隔 ms (默认 20s; 单测可注短)。 */
  sseKeepaliveMs?: number;
}

/** 单进程内的转发并发槽 (同步 check-and-act, 无竞态)。 */
let forwardInFlight = 0;
export function forwardSlotStatus(): { inFlight: number } {
  return { inFlight: forwardInFlight };
}
function acquireForwardSlot(limit: number): boolean {
  if (forwardInFlight >= limit) return false;
  forwardInFlight += 1;
  return true;
}
function releaseForwardSlot(): void {
  forwardInFlight = Math.max(0, forwardInFlight - 1);
}

/**
 * SSE 心跳间隔: turn 静默期 (无 delta) 靠 `: ping` 注释续命,
 * 避免被 Bun idleTimeout 掐流。OpenAI 客户端忽略注释行。
 */
export const FORWARD_SSE_KEEPALIVE_MS = 20_000;

export interface ForwardChatMessage {
  role?: string;
  content?: unknown;
}

/** chat messages → 单 prompt 文本 (共享专用)。
 * 两档: 优先只收 user 输入 (过滤 system/developer);
 * 无 user 文本时回退到 tool 输出再到 assistant (工具循环续跑腿, 避免 400 中断)。
 * system/developer 永不进入执行。 */
export function chatMessagesToPrompt(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const userBlocks: string[] = [];
  const toolBlocks: string[] = [];
  const assistantBlocks: string[] = [];
  for (const entry of messages) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    // user 优先; system/developer 永远丢弃, 防止外部多层系统提示词注入到底层 CLI 执行。
    const rawRole = typeof record.role === "string" ? record.role.toLowerCase() : "user";
    const text = chatContentToText(record.content);
    if (!text.trim()) continue;
    if (rawRole === "user") userBlocks.push(text);
    else if (rawRole === "tool") toolBlocks.push(text);
    else if (rawRole === "assistant") assistantBlocks.push(text);
    // system/developer/function 等: 永远丢弃。
  }
  if (userBlocks.length > 0) return userBlocks.join("\n\n").trim();
  if (toolBlocks.length > 0) return toolBlocks.join("\n\n").trim();
  if (assistantBlocks.length > 0) return assistantBlocks.join("\n\n").trim();
  return "";
}

function chatContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  // 部分客户端 content 直接给对象 (如 { type: "input_text", text: "..." }), 同样提取。
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
    if (typeof record.refusal === "string") return record.refusal;
    if (typeof record.output === "string") return record.output;
    return "";
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (part && typeof part === "object") {
        const record = part as Record<string, unknown>;
        // 标准 OpenAI content part: { type: "text"|"input_text"|"output_text", text: string }
        if (typeof record.text === "string") {
          // image_url / input_audio 等非文本 part 没有 text 字段, 此处不会误收。
          parts.push(record.text);
          continue;
        }
        if (typeof record.content === "string") {
          parts.push(record.content);
          continue;
        }
        // refusal part: { type: "refusal", refusal: string }
        if (typeof record.refusal === "string" && record.refusal) {
          parts.push(record.refusal);
          continue;
        }
        // function_call_output 的 output 对象形态: { output: "…" }
        if (typeof record.output === "string" && record.output) {
          parts.push(record.output);
          continue;
        }
        // 其余 (image_url / input_audio / file 等) 安全跳过, 不污染 prompt。
      }
    }
    return parts.join("");
  }
  return "";
}

/** responses input → prompt 文本 (共享专用)。
 * 两档: 优先只收 user 消息; 无 user 文本时回退到 function_call_output 再到 assistant
 * (工具循环续跑腿, 避免 400 中断)。instructions/system/developer 与 function_call
 * 本体永不进入执行。 */
export function responsesInputToPrompt(input: unknown, _instructions?: unknown): string {
  // instructions (system 层) 直接丢弃: 共享通道理论只接收 user 输入。
  if (typeof input === "string") {
    return input.trim();
  }
  if (!Array.isArray(input)) return "";
  const userBlocks: string[] = [];
  const toolBlocks: string[] = [];
  const assistantBlocks: string[] = [];
  const pushText = (text: string, bucket: string[]): void => {
    if (text.trim()) bucket.push(text);
  };
  for (const entry of input) {
    if (typeof entry === "string") {
      pushText(entry.trim(), userBlocks);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const kind = typeof record.type === "string" ? record.type : "";
    if (kind === "message" || (!kind && ("role" in record || "content" in record))) {
      // 兼容无 type 的裸消息 { role, content }; 仅保留 user, assistant 降级回退。
      // system / developer 直接过滤。
      const role = typeof record.role === "string" ? record.role.toLowerCase() : "user";
      const text = chatContentToText(record.content);
      if (!text.trim()) continue;
      if (role === "user") pushText(text, userBlocks);
      else if (role === "assistant") pushText(text, assistantBlocks);
      // system/developer: 丢弃。
    } else if (kind === "function_call_output") {
      const text = typeof record.output === "string" ? record.output : chatContentToText(record.output);
      pushText(text, toolBlocks);
    }
    // function_call / reasoning / item_reference: 远端执行模式内部消化, 不回抛不执行。
  }
  if (userBlocks.length > 0) return userBlocks.join("\n\n").trim();
  if (toolBlocks.length > 0) return toolBlocks.join("\n\n").trim();
  if (assistantBlocks.length > 0) return assistantBlocks.join("\n\n").trim();
  return "";
}

function forwardResponseId(): string {
  return `resp-fwd-${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

/**
 * 标准 OpenAI Responses 对象转换层 (JEV-a)。
 * 对齐 https://platform.openai.com/docs/api-reference/responses/create :
 * id / object:"response" / created_at / model / status / output / usage 必备;
 * parallel_tool_calls / tool_choice / tools / incomplete_details 补齐以兼容严格客户端。
 * 注意旧代码 `text || status === "completed" ? [...] : []` 因 || 优先级导致
 * failed 带文本时仍回 output, 现修正为仅 completed 回 output。
 */
export interface ForwardResponseRestore {
  instructions?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  parallel_tool_calls?: unknown;
}

export function forwardResponseObject(modelId: string, text: string, status: "completed" | "failed", usageOverride?: { input_tokens: number; output_tokens: number; total_tokens: number }, restore?: ForwardResponseRestore, echo?: { input?: unknown; instructions?: unknown }): Record<string, unknown> {
  const id = forwardResponseId();
  const completed = status === "completed";
  const outputTokens = estimateForwardTokens(text ?? "");
  const usage = usageOverride ?? (completed
    ? { input_tokens: 0, output_tokens: outputTokens, total_tokens: outputTokens }
    : { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
  // 返回组装: 用户上传什么就组装什么 (标准 Responses 字段原样回显, 执行仍只用 user)。
  // instructions/tools/tool_choice/parallel_tool_calls 均回请求值, 不硬编码 null/[]。
  const instructions = restore && "instructions" in (restore as Record<string, unknown>)
    ? (restore as Record<string, unknown>).instructions ?? null
    : null;
  const tools = Array.isArray(restore?.tools) ? restore.tools : [];
  const tool_choice = restore?.tool_choice ?? "auto";
  const parallel_tool_calls = typeof restore?.parallel_tool_calls === "boolean" ? restore.parallel_tool_calls : false;
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: modelId,
    status,
    output: completed
      ? [
          {
            type: "message",
            id: `${id}-msg-0`,
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: text ?? "", annotations: [] }],
          },
        ]
      : [],
    parallel_tool_calls,
    tool_choice,
    tools,
    incomplete_details: null,
    instructions,
    previous_response_id: null,
    usage,
    // 非标扩展 forward_echo 原样带回上传的 input+instructions (严格客户端忽略)。
    ...(echo === undefined ? {} : { forward_echo: { input: echo.input ?? "", instructions: echo.instructions ?? null } }),
  };
}

/**
 * 返回组装层: 执行只用 user prompt, 但 usage 按原始请求全量组装回去。
 * estimate 按 ~4 chars/token 估算, 保证 system/tool/assistant 被计入 prompt_tokens,
 * 客户端按标准 OpenAI usage 做账时与原始请求一致。
 */
export function estimateForwardTokens(text: string): number {
  const len = (text ?? "").length;
  if (len <= 0) return 0;
  return Math.max(1, Math.ceil(len / 4));
}

/** chat 全量原始 messages(含被过滤的 system/tool/assistant) → prompt_tokens 还原。 */
export function forwardChatUsage(originalMessages: unknown, resultText: string): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  const prompt_tokens = estimateForwardTokens(
    typeof originalMessages === "string" ? originalMessages : JSON.stringify(originalMessages ?? "")
  );
  const completion_tokens = estimateForwardTokens(resultText ?? "");
  return { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens };
}

/** responses 全量原始 input+instructions(含被过滤部分) → input_tokens 还原。 */
export function forwardResponsesUsage(originalInput: unknown, instructions: unknown, resultText: string): { input_tokens: number; output_tokens: number; total_tokens: number } {
  const input_tokens = estimateForwardTokens(JSON.stringify({ input: originalInput ?? "", instructions: instructions ?? "" }));
  const output_tokens = estimateForwardTokens(resultText ?? "");
  return { input_tokens, output_tokens, total_tokens: input_tokens + output_tokens };
}

/** 标准 chat.completion 组装: model 回原始请求 model, content 为 CLI 文本, usage 按全量还原。
 * 非标扩展 forward_echo 原样带回上传的 messages (含被过滤的 system/tool/assistant),
 * 严格 OpenAI 客户端忽略该字段, 宽松客户端可用它做历史还原。 */
export function buildChatCompletionResponse(modelId: string, cliText: string, originalMessages?: unknown): Record<string, unknown> {
  return {
    id: forwardCompletionId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: cliText ?? "" },
        finish_reason: "stop",
      },
    ],
    usage: forwardChatUsage(originalMessages, cliText),
    forward_echo: { messages: Array.isArray(originalMessages) ? originalMessages : [] },
  };
}

export interface ForwardResponsesRun {
  modelId: string;
  route: ForwardRoute;
  bridge: ForwardBridge;
  prompt: string;
  limit: number;
  /** 按原始全量 input+instructions 估算的 input_tokens(返回组装用, 执行仍只用 user prompt)。 */
  promptTokens: number;
  /** 原始请求上传的 instructions/tools/tool_choice/parallel_tool_calls, 返回原样组装。 */
  restore: ForwardResponseRestore;
  /** 原始上传 input+instructions 原样带回 (非标 forward_echo)。 */
  echo: { input: unknown; instructions: unknown };
}

async function resolveForwardResponsesRun(
  request: Request,
  security: Headers,
  deps: ForwardChatDeps,
  body: Record<string, unknown>
): Promise<
  | { ok: true; run: ForwardResponsesRun; stream: boolean }
  | { ok: false; response: Response }
> {
  const fail = (message: string, status: number, type = "invalid_request_error"): { ok: false; response: Response } => ({
    ok: false,
    response: forwardError(message, status, security, type),
  });
  if (!resolveForwardCredential(request, deps.remoteAddress, deps.forwardToken ?? "")) {
    return fail("Invalid or missing forward API key", 401, "authentication_error");
  }
  const modelId = typeof body.model === "string" ? body.model.trim() : "";
  if (!modelId) return fail("model is required (format {cli}-{provider}-{group}-{model})", 400);
  if (typeof body.previous_response_id === "string" && body.previous_response_id.trim()) {
    return fail("previous_response_id 续聊 v1 不支持 (无状态单次执行)", 400);
  }
  const prompt = responsesInputToPrompt(body.input, body.instructions);
  if (!prompt) return fail("input 为空或无文本内容", 400);
  let inventory: ForwardModelInventory[];
  try {
    inventory = await deps.listInventory();
  } catch (error) {
    return fail(`Failed to list forward inventory: ${error instanceof Error ? error.message : String(error)}`, 500, "server_error");
  }
  let route: ForwardRoute;
  try {
    route = parseForwardModelId(modelId, toParseInventory(inventory));
  } catch (error) {
    if (error instanceof ForwardModelError && error.code === "loopback") {
      return fail(error.message, 400, "loopback_not_allowed");
    }
    return fail(error instanceof Error ? error.message : String(error), 404, "model_not_found");
  }
  const limit = deps.maxConcurrent ?? 4;
  if (!acquireForwardSlot(limit)) {
    return fail(`转发并发已满 (${limit} 路), 请稍后重试`, 429, "rate_limit_error");
  }
  let bridge: ForwardBridge | null;
  try {
    bridge = await deps.getBridge(route.cliBackend);
  } catch (error) {
    releaseForwardSlot();
    return fail(`CLI 后端不可用 (${route.cliBackend}): ${error instanceof Error ? error.message : String(error)}`, 502, "server_error");
  }
  if (!bridge) {
    releaseForwardSlot();
    return fail(`CLI 后端未启用: ${route.cliBackend}`, 502, "server_error");
  }
  // 返回组装用: 按原始全量 input+instructions 估算 input_tokens (执行仍只用 user prompt)。
  const promptTokens = estimateForwardTokens(JSON.stringify({ input: body.input ?? "", instructions: body.instructions ?? "" }));
  // 用户上传什么就组装什么: instructions/tools/tool_choice/parallel_tool_calls 原样带回返回体。
  const restore: ForwardResponseRestore = {
    instructions: body.instructions ?? null,
    tools: body.tools ?? [],
    tool_choice: body.tool_choice ?? "auto",
    parallel_tool_calls: body.parallel_tool_calls ?? false,
  };
  const echo = { input: body.input ?? "", instructions: body.instructions ?? null };
  return { ok: true, run: { modelId, route, bridge, prompt, limit, promptTokens, restore, echo }, stream: body.stream === true };
}

/**
 * POST /v1/responses (禁透传: 一律经选中 CLI 执行)。
 * 最小可用 SSE 子集: response.created → output_text.delta* → completed + done。
 */
export async function handleForwardResponsesRequest(
  request: Request,
  _url: URL,
  security: Headers,
  deps: ForwardChatDeps
): Promise<Response> {
  if (request.method !== "POST") {
    return forwardError("Only POST /v1/responses is supported", 405, security);
  }
  if (!deps.sharingEnabled) return forwardSharingDisabled(security);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return forwardError("Invalid JSON body", 400, security);
  }
  const resolved = await resolveForwardResponsesRun(request, security, deps, body);
  if (!resolved.ok) return resolved.response;
  const { run, stream } = resolved;
  if (stream) return forwardResponsesStream(request, security, deps, run);
  let result;
  try {
    result = await runForwardTurn(run.bridge, {
      route: run.route,
      prompt: run.prompt,
      cwd: deps.cwd,
      timeoutMs: deps.turnTimeoutMs ?? FORWARD_DEFAULT_TIMEOUT_MS,
      signal: request.signal,
    });
  } catch (error) {
    releaseForwardSlot();
    return forwardError(
      `forward turn 启动失败: ${error instanceof Error ? error.message : String(error)}`,
      502,
      security,
      "server_error"
    );
  }
  releaseForwardSlot();
  if (result.finishReason !== "stop") {
    const status = result.finishReason === "timeout" ? 504 : 502;
    return forwardError(
      result.error || `forward turn 未完成 (${result.finishReason})`,
      status,
      security,
      status === 504 ? "timeout_error" : "server_error"
    );
  }
  // 返回按原始请求组装: model 回请求 model, usage 按全量 input+instructions 还原,
  // instructions/tools/tool_choice/parallel_tool_calls 按上传原样带回, forward_echo 带回原文。
  const usage = forwardResponsesUsage(body.input, body.instructions, result.text);
  return forwardJson(forwardResponseObject(run.modelId, result.text, "completed", usage, run.restore, run.echo), 200, security);
}

function forwardResponsesStream(
  request: Request,
  security: Headers,
  deps: ForwardChatDeps,
  run: ForwardResponsesRun
): Response {
  const responseId = forwardResponseId();
  const createdAt = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  let released = false;
  const releaseOnce = (): void => {
    if (released) return;
    released = true;
    releaseForwardSlot();
  };
  let seq = 0;
  // 标准 OpenAI Responses SSE 包络: { type, sequence_number, ...eventPayload }。
  // 不再顶层外加自定义 response_id (严格客户端会校验), response id 放在 response 对象内。
  const envelope = (type: string, extra: Record<string, unknown>): string => {
    seq += 1;
    return `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq, ...extra })}\n\n`;
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const keepaliveMs = deps.sseKeepaliveMs ?? FORWARD_SSE_KEEPALIVE_MS;
      const heartbeat = keepaliveMs > 0
        ? setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              // 客户端已断开, finally 负责收尾。
            }
          }, keepaliveMs)
        : null;
      if (heartbeat) (heartbeat as unknown as { unref?: () => void }).unref?.();
      controller.enqueue(encoder.encode(envelope("response.created", {
        response: { id: responseId, object: "response", created_at: createdAt, model: run.modelId, status: "in_progress", output: [] },
      })));
      let sawDelta = false;
      try {
        const result = await runForwardTurn(run.bridge, {
          route: run.route,
          prompt: run.prompt,
          cwd: deps.cwd,
          timeoutMs: deps.turnTimeoutMs ?? FORWARD_DEFAULT_TIMEOUT_MS,
          signal: request.signal,
          onDelta: (text, source) => {
            if (source === "delta") {
              sawDelta = true;
              controller.enqueue(encoder.encode(envelope("response.output_text.delta", { item_id: `${responseId}-msg-0`, output_index: 0, delta: text })));
            } else if (!sawDelta) {
              controller.enqueue(encoder.encode(envelope("response.output_text.delta", { item_id: `${responseId}-msg-0`, output_index: 0, delta: text })));
            }
          },
        });
        if (result.finishReason === "stop") {
          const outputTokens = estimateForwardTokens(result.text ?? "");
          controller.enqueue(encoder.encode(envelope("response.completed", {
            response: forwardResponseObject(run.modelId, result.text, "completed", {
              input_tokens: run.promptTokens,
              output_tokens: outputTokens,
              total_tokens: run.promptTokens + outputTokens,
            }, run.restore, run.echo),
          })));
        } else {
          controller.enqueue(encoder.encode(envelope("response.failed", {
            response: { id: responseId, object: "response", created_at: createdAt, model: run.modelId, status: "failed", output: [], error: { message: result.error || result.finishReason } },
          })));
        }
      } catch (error) {
        controller.enqueue(encoder.encode(envelope("response.failed", {
          response: { id: responseId, object: "response", created_at: createdAt, model: run.modelId, status: "failed", output: [], error: { message: error instanceof Error ? error.message : String(error) } },
        })));
      } finally {
        // 双兼容收尾: 严格 OpenAI 客户端以 response.completed/failed 为终态,
        // 宽松 SSE 客户端以纯 `data: [DONE]` (无 event 行, 对标 chat 流) 判结束。
        // 旧 `event: response.done` + `[DONE]` 混写非标准, 已去掉 event 行。
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        if (heartbeat) clearInterval(heartbeat);
        releaseOnce();
        controller.close();
      }
    },
    cancel() {
      releaseOnce();
    },
  });
  const headers = new Headers(security);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");
  return new Response(stream, { status: 200, headers });
}

function forwardCompletionId(): string {
  return `chatcmpl-fwd-${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

/**
 * POST /v1/chat/completions (P3a 非流; stream:true 暂 400 指引, P3b 接 SSE)。
 * 全程经选中 CLI 执行, 禁止透传上游。
 */
export async function handleForwardChatRequest(
  request: Request,
  _url: URL,
  security: Headers,
  deps: ForwardChatDeps
): Promise<Response> {
  if (request.method !== "POST") {
    return forwardError("Only POST /v1/chat/completions is supported", 405, security);
  }
  if (!deps.sharingEnabled) return forwardSharingDisabled(security);
  if (!resolveForwardCredential(request, deps.remoteAddress, deps.forwardToken ?? "")) {
    return forwardError("Invalid or missing forward API key", 401, security, "authentication_error");
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return forwardError("Invalid JSON body", 400, security);
  }
  const modelId = typeof body.model === "string" ? body.model.trim() : "";
  if (!modelId) return forwardError("model is required (format {cli}-{provider}-{group}-{model})", 400, security);
  const prompt = chatMessagesToPrompt(body.messages);
  if (!prompt) return forwardError("messages 为空或无文本内容", 400, security);
  let inventory: ForwardModelInventory[];
  try {
    inventory = await deps.listInventory();
  } catch (error) {
    return forwardError(
      `Failed to list forward inventory: ${error instanceof Error ? error.message : String(error)}`,
      500,
      security,
      "server_error"
    );
  }
  let route: ForwardRoute;
  try {
    route = parseForwardModelId(modelId, toParseInventory(inventory));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ForwardModelError && error.code === "loopback") {
      return forwardError(message, 400, security, "loopback_not_allowed");
    }
    return forwardError(message, 404, security, "model_not_found");
  }
  const limit = deps.maxConcurrent ?? 4;
  if (!acquireForwardSlot(limit)) {
    return forwardError(
      `转发并发已满 (${limit} 路), 请稍后重试`,
      429,
      security,
      "rate_limit_error"
    );
  }
  let bridge: ForwardBridge | null;
  try {
    bridge = await deps.getBridge(route.cliBackend);
  } catch (error) {
    releaseForwardSlot();
    return forwardError(
      `CLI 后端不可用 (${route.cliBackend}): ${error instanceof Error ? error.message : String(error)}`,
      502,
      security,
      "server_error"
    );
  }
  if (!bridge) {
    releaseForwardSlot();
    return forwardError(`CLI 后端未启用: ${route.cliBackend}`, 502, security, "server_error");
  }
  if (body.stream === true) {
    const promptTokens = estimateForwardTokens(JSON.stringify(body.messages ?? ""));
    const streamOptions = body.stream_options as Record<string, unknown> | undefined;
    const includeUsage = streamOptions?.include_usage === true;
    const echoMessages = Array.isArray(body.messages) ? body.messages : [];
    return forwardChatStream(request, security, deps, { modelId, route, bridge, prompt, limit, promptTokens, includeUsage, echoMessages });
  }
  let result;
  try {
    result = await runForwardTurn(bridge, {
      route,
      prompt,
      cwd: deps.cwd,
      timeoutMs: deps.turnTimeoutMs ?? FORWARD_DEFAULT_TIMEOUT_MS,
      signal: request.signal,
    });
  } catch (error) {
    releaseForwardSlot();
    return forwardError(
      `forward turn 启动失败: ${error instanceof Error ? error.message : String(error)}`,
      502,
      security,
      "server_error"
    );
  }
  releaseForwardSlot();
  if (result.finishReason !== "stop") {
    const status = result.finishReason === "timeout" ? 504 : 502;
    return forwardError(
      result.error || `forward turn 未完成 (${result.finishReason})`,
      status,
      security,
      status === 504 ? "timeout_error" : "server_error"
    );
  }
  // 返回按原始请求组装: model 回请求 model, content 为 CLI 文本, usage 按全量 messages 还原。
  return forwardJson(buildChatCompletionResponse(modelId, result.text, body.messages), 200, security);
}

export interface ForwardStreamRun {
  modelId: string;
  route: ForwardRoute;
  bridge: ForwardBridge;
  prompt: string;
  limit: number;
  /** 按原始全量 messages 估算的 prompt_tokens(返回组装用); stream include_usage 时回尾包。 */
  promptTokens: number;
  includeUsage: boolean;
  /** 原始上传 messages 原样带回 (非标 forward_echo, 严格客户端忽略)。 */
  echoMessages: unknown[];
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * POST /v1/chat/completions stream:true → OpenAI SSE。
 * 去重策略: 收到过 delta 片段就忽略 completed 全文 (防复读);
 * 只有 completed 全文时逐段下发。终态异常时先吐 error 包再 [DONE]。
 */
export function forwardChatStream(
  request: Request,
  security: Headers,
  deps: ForwardChatDeps,
  run: ForwardStreamRun
): Response {
  const created = Math.floor(Date.now() / 1000);
  const completionId = forwardCompletionId();
  const encoder = new TextEncoder();
  let released = false;
  const releaseOnce = (): void => {
    if (released) return;
    released = true;
    releaseForwardSlot();
  };
  const keepaliveMs = deps.sseKeepaliveMs ?? FORWARD_SSE_KEEPALIVE_MS;
  const baseChunk = (delta: Record<string, unknown>, finish: string | null) => ({
    id: completionId,
    object: "chat.completion.chunk",
    created,
    model: run.modelId,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  let sawDelta = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const heartbeat = keepaliveMs > 0
        ? setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              // 客户端已断开, finally 负责收尾。
            }
          }, keepaliveMs)
        : null;
      if (heartbeat) (heartbeat as unknown as { unref?: () => void }).unref?.();
      const send = (text: string): void => {
        controller.enqueue(encoder.encode(sseChunk(baseChunk({ content: text }, null))));
      };
      controller.enqueue(encoder.encode(sseChunk(baseChunk({ role: "assistant" }, null))));
      try {
        const result = await runForwardTurn(run.bridge, {
          route: run.route,
          prompt: run.prompt,
          cwd: deps.cwd,
          timeoutMs: deps.turnTimeoutMs ?? FORWARD_DEFAULT_TIMEOUT_MS,
          signal: request.signal,
          onDelta: (text, source) => {
            if (source === "delta") {
              sawDelta = true;
              send(text);
            } else if (!sawDelta) {
              send(text);
            }
          },
        });
        if (result.finishReason === "stop") {
          // 非标扩展 forward_echo 随终态带回上传原文 (严格客户端忽略)。
          controller.enqueue(encoder.encode(sseChunk({ ...baseChunk({}, "stop"), forward_echo: { messages: run.echoMessages } })));
          // 返回组装: 请求了 stream_options.include_usage 时按原始全量补 usage 尾包。
          if (run.includeUsage) {
            const completionTokens = estimateForwardTokens(result.text ?? "");
            controller.enqueue(encoder.encode(sseChunk({
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model: run.modelId,
              choices: [],
              usage: {
                prompt_tokens: run.promptTokens,
                completion_tokens: completionTokens,
                total_tokens: run.promptTokens + completionTokens,
              },
              forward_echo: { messages: run.echoMessages },
            })));
          }
        } else {
          controller.enqueue(
            encoder.encode(sseChunk({ error: { message: result.error || result.finishReason, type: result.finishReason === "timeout" ? "timeout_error" : "server_error" } }))
          );
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(sseChunk({ error: { message: error instanceof Error ? error.message : String(error), type: "server_error" } }))
        );
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        if (heartbeat) clearInterval(heartbeat);
        releaseOnce();
        controller.close();
      }
    },
    cancel() {
      releaseOnce();
    },
  });
  const headers = new Headers(security);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");
  return new Response(stream, { status: 200, headers });
}
