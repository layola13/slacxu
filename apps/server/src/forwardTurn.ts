import { EventEmitter } from "node:events";
import {
  parseForwardModelId,
  type ForwardInventoryProvider,
  type ForwardRoute,
} from "./forwardModel.js";

/**
 * 对外 /v1 转发的 turn 执行器 (P3a 非流 / P3b 流式共用)。
 *
 * 远端执行模式: 每个外部请求建一个一次性内部 thread (ownerId=forward,
 * 与用户历史隔离), 跑完一个 turn 即删。直接驱动各 cliBackend 的单例
 * bridge (request + notification), 不经过 workbench 的 session/RPC 管道。
 */

export const FORWARD_OWNER_ID = "forward";
export const FORWARD_DEFAULT_TIMEOUT_MS = 600_000;

export interface ForwardBridge extends EventEmitter {
  request(method: string, params?: unknown): Promise<unknown>;
}

export interface ForwardNotification {
  method?: string;
  params?: Record<string, any> | null;
}

export interface ForwardTurnInput {
  /** 已解析的转发路由。 */
  route: ForwardRoute;
  /** 拼好的 prompt 文本 (由 chat messages / responses input 组装)。 */
  prompt: string;
  cwd: string;
  ownerId?: string;
  /** turn 级超时; 超时后尝试 interrupt + 删 thread。 */
  timeoutMs?: number;
  /** 增量文本回调 (P3b SSE 用; P3a 不传; source 区分 delta 与 completed 全文)。 */
  onDelta?: (text: string, source: "delta" | "completed") => void;
  /** 外部中断信号 (如 HTTP 客户端断开)。 */
  signal?: AbortSignal;
}

export interface ForwardTurnResult {
  route: ForwardRoute;
  threadId: string;
  turnId: string;
  /** 累积的 assistant 文本 (远端执行模式的最终答复)。 */
  text: string;
  finishReason: "stop" | "error" | "interrupted" | "timeout";
  error?: string;
  durationMs: number;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function stringField(record: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function notificationTurnId(notif: ForwardNotification): string {
  const params = asRecord(notif.params);
  return (
    stringField(params, "turnId", "turn_id") ||
    stringField(asRecord(params.turn), "id", "turnId") ||
    stringField(asRecord(params.item), "turnId", "turn_id") ||
    ""
  );
}

/** 从 item 通知里提取 assistant 文本 (后端无关的启发式 + 递归)。 */
export function extractForwardItemText(item: unknown): string {
  const texts: string[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || node == null) return;
    if (typeof node === "string") return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const kind = typeof record.type === "string" ? record.type : typeof record.kind === "string" ? record.kind : "";
    // 工具调用/工具结果/推理过程不计入最终答复文本。
    if (/tool|function|reasoning|thinking|delta|progress/i.test(kind)) {
      // delta 片段由调用方经 onDelta 单独处理, 这里跳过避免污染终态文本。
      return;
    }
    for (const key of ["text", "content", "message", "output"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) texts.push(value);
      else if (value && typeof value === "object") visit(value, depth + 1);
    }
    // 兜底: 形如 { role: "assistant", parts: [...] } 的结构继续下钻。
    for (const key of ["parts", "blocks", "items", "elements"]) {
      if (Array.isArray(record[key])) visit(record[key], depth + 1);
    }
  };
  visit(item, 0);
  return texts.join("");
}

/** 是否疑似 assistant 文本项 (过滤 user/tool 项)。 */
function isAssistantItem(item: unknown): boolean {
  const record = asRecord(item);
  const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
  if (role === "user" || role === "tool" || role === "system") return false;
  const kind = `${typeof record.type === "string" ? record.type : ""} ${typeof record.kind === "string" ? record.kind : ""}`;
  if (/tool|function_call|function_result|user_message/i.test(kind)) return false;
  return true;
}

function turnResultText(turnParams: Record<string, any>): string {
  return (
    stringField(turnParams, "error", "message") ||
    stringField(asRecord(turnParams.turn), "error", "message") ||
    ""
  );
}

/**
 * 跑完一个一次性 turn 并回最终文本。bridge 由调用方按 cliBackend 注入
 * (index.ts 侧映射各单例), 解析库存亦由调用方注入, 便于单测 fake。
 */
export async function runForwardTurn(
  bridge: ForwardBridge,
  input: ForwardTurnInput
): Promise<ForwardTurnResult> {
  const startedAt = Date.now();
  const ownerId = input.ownerId ?? FORWARD_OWNER_ID;
  const timeoutMs = input.timeoutMs ?? FORWARD_DEFAULT_TIMEOUT_MS;
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("forward prompt 为空");
  const route = input.route;

  const startRes = asRecord(
    await bridge.request("thread/start", {
      ownerId,
      cwd: input.cwd,
      model: route.model,
      modelProvider: route.providerId,
      providerId: route.providerId,
      groupId: route.groupId,
      cliBackend: route.cliBackend,
      sandbox: "workspace-write",
      approvalPolicy: "never",
    })
  );
  const threadId = stringField(startRes, "threadId", "thread_id") || stringField(asRecord(startRes.thread), "id");
  if (!threadId) throw new Error("forward thread/start 未返回 threadId");

  let turnId = "";
  let settled = false;
  let finishReason: ForwardTurnResult["finishReason"] = "stop";
  let failure = "";
  const chunks: string[] = [];
  const buffered: ForwardNotification[] = [];

  const cleanup = async (): Promise<void> => {
    await bridge.request("thread/delete", { threadId }).catch(() => undefined);
  };

  const onNotification = (notif: ForwardNotification): void => {
    if (!notif || typeof notif.method !== "string") return;
    const params = asRecord(notif.params);
    const thread = stringField(params, "threadId", "thread_id") || stringField(asRecord(params.thread), "threadId");
    if (thread && thread !== threadId) return;
    if (notif.method === "item/completed" || notif.method === "item/updated") {
      const item = params.item;
      if (turnId && notificationTurnId(notif) !== turnId) {
        buffered.push(notif);
        return;
      }
      if (isAssistantItem(item)) {
        const text = extractForwardItemText(item);
        if (text) {
          chunks.push(text);
          input.onDelta?.(text, "completed");
        }
      }
      return;
    }
    if (notif.method === "item/delta") {
      if (turnId && notificationTurnId(notif) !== turnId) return;
      const deltaText = extractForwardItemText(params.delta ?? params.item ?? params);
      if (deltaText) input.onDelta?.(deltaText, "delta");
      return;
    }
    if (notif.method === "turn/completed" || notif.method === "turn/failed" || notif.method === "turn/interrupted") {
      if (turnId && notificationTurnId(notif) && notificationTurnId(notif) !== turnId) return;
      if (settled) return;
      settled = true;
      if (notif.method === "turn/completed") {
        finishReason = "stop";
      } else if (notif.method === "turn/interrupted") {
        finishReason = "interrupted";
        failure = turnResultText(params) || "turn interrupted";
      } else {
        finishReason = "error";
        failure = turnResultText(params) || "turn failed";
      }
    }
  };

  (bridge as EventEmitter).on("notification", onNotification);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onAbort = (): void => {
    if (settled) return;
    settled = true;
    finishReason = "interrupted";
    failure = "client disconnected";
    void bridge.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const turnRes = asRecord(
      await bridge.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt }],
        cwd: input.cwd,
        model: route.model,
      })
    );
    turnId = stringField(turnRes, "turnId", "turn_id") || stringField(asRecord(turnRes.turn), "id");
    // turnId 落定后重放缓冲的 item 事件。
    for (const notif of buffered.splice(0)) {
      if (notificationTurnId(notif) === turnId || !notificationTurnId(notif)) onNotification(notif);
    }

    await new Promise<void>((resolve) => {
      if (settled) {
        resolve();
        return;
      }
      const done = (): void => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      const poll = (): void => {
        if (settled) done();
        else timer = setTimeout(poll, 50);
      };
      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          finishReason = "timeout";
          failure = `forward turn 超时 (${Math.round(timeoutMs / 1000)}s)`;
          void bridge.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
        }
        done();
      }, timeoutMs);
      poll();
    });
  } finally {
    (bridge as EventEmitter).off("notification", onNotification);
    input.signal?.removeEventListener("abort", onAbort);
    if (timer) clearTimeout(timer);
    await cleanup();
  }

  let text = chunks.join("");
  if (!text && finishReason === "stop") {
    // 终态无累积文本时读回 thread 做兜底。
    try {
      const readRes = await bridge.request("thread/read", { threadId }).catch(() => null);
      text = extractLastAssistantText(readRes);
    } catch {
      // 忽略兜底失败, 返回空文本由调用方判定。
    }
  }

  return {
    route,
    threadId,
    turnId,
    text,
    finishReason,
    ...(failure ? { error: failure } : {}),
    durationMs: Date.now() - startedAt,
  };
}

/** thread/read 结果里找最后一段 assistant 文本 (兜底用, 后端无关)。 */
export function extractLastAssistantText(readResult: unknown): string {
  let last = "";
  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || node == null) return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (isAssistantItem(node)) {
      const text = extractForwardItemText(node);
      if (text.trim()) last = text;
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") visit(value, depth + 1);
    }
  };
  visit(readResult, 0);
  return last;
}

/** 解析 forward model id, 失败抛 OpenAI 兼容错误信息。 */
export function resolveForwardRoute(modelId: string, inventory: ForwardInventoryProvider[]): ForwardRoute {
  return parseForwardModelId(modelId, inventory);
}
