import { EventEmitter } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import type { JsonRpcRequest, JsonValue, ModelCapabilityDescriptor } from "@codex-ui/shared";
import {
  OpencodeCompatibleProcessManager,
  acquireSharedOpencodeServer,
  fingerprintOpencodeProcessConfig,
  inferOpencodeModelLimits,
  releaseSharedOpencodeServer,
  sharedOpencodePoolRefCount,
  type OpencodeProcessConfig,
  type OpencodeSaVmMcpConfig,
  type OpencodeServerInfo,
} from "./opencodeCompatibleProcessManager.js";
import {
  createOpencodeProjectorContext,
  projectOpencodeEvent,
  toOpencodeNotification,
  forceTerminateOpencode,
  opencodeQuestionAnswersFromResponse,
  OPENCODE_IDLE_QUIESCE_MS,
  OPENCODE_UPSTREAM_RETRY_GRACE_MS,
  type NormalizedOpencodeQuestion,
  type OpencodeProjectorContext,
  type OpencodeProjectedEvent,
} from "./opencodeCompatibleTurnProjector.js";
import {
  parseOpencodeSseChunk,
  splitOpencodeSseRecords,
  type OpencodeSseEvent,
} from "./opencodeCompatibleProtocol.js";
import { pathOnlyHistoryPlaceholder, toPathOnlyImageBlock } from "@cxu/sdk-backend";

export interface OpencodeRelayConfig {
  /** Custom provider ID, must match OPENCODE_CONFIG_CONTENT provider key. */
  providerID: string;
  baseURL: string;
  apiKey: string;
  models: string[];
  /** Upstream model ID to send (e.g. gpt-5.6-luna). */
  targetModel: string;
  contextWindow?: number;
  modelCapability?: ModelCapabilityDescriptor | null;
}

export interface OpencodeRuntimeConfig {
  threadId: string;
  cwd: string;
  sessionId?: string;
  model?: string;
  dangerous?: boolean;
  binPath?: string;
  /** Prepended before `serve ...` (embedded JS bundle entry). */
  serverEntryArgs?: string[];
  envOverrides?: Record<string, string>;
  serverUrl?: string;
  serverPassword?: string;
  relay?: OpencodeRelayConfig;
  saVmMcp?: OpencodeSaVmMcpConfig;
  /** Reserved isolation flag (bridge always passes false; no per-model isolation). */
  isolateThirdParty?: boolean;
  /** OpenCode API generation of the target binary (1 = v1 line, 2 = v2 line). Defaults to 1. */
  apiVersion?: 1 | 2;
  eventStreamConnectTimeoutMs?: number;
  turnStallTimeoutMs?: number;
  interruptTimeoutMs?: number;
}

export const OPENCODE_TURN_STALL_TIMEOUT_MS = 10 * 60_000;
const OPENCODE_EVENT_STREAM_CONNECT_TIMEOUT_MS = 30_000;
const OPENCODE_PROMPT_REQUEST_TIMEOUT_MS = 30_000;
const OPENCODE_ABORT_REQUEST_TIMEOUT_MS = 2_500;
const OPENCODE_PROMPT_429_MAX_RETRIES = 3;
const OPENCODE_PROMPT_429_RETRY_BASE_MS = 250;

function opencodeRetryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}
export function resolveOpencodeModelPayload(rawModel?: string): { providerID: string; modelID: string } | undefined {
  const trimmed = (rawModel ?? "").trim();
  const effective = (!trimmed || trimmed === "default") ? "opencode/big-pickle" : trimmed;
  const parts = effective.split("/");
  if (parts.length >= 2) {
    const providerID = parts[0] ?? "";
    const modelID = parts.slice(1).join("/");
    if (providerID && modelID) return { providerID, modelID };
  }
  return undefined;
}

/**
 * File attachment part for `POST /session/:id/prompt_async` (`FilePartInput`).
 *
 * The workbench composer emits one block list for every backend
 * (`composerInputToUserInput`): `text`, `image`, `mention`, `skill`. Codex and
 * Claude consume those natively; opencode only accepts `text` + `file` parts,
 * so image blocks must be converted here. Previously the bridge forwarded
 * text only and silently dropped every image, so opencode turns never saw
 * user-attached pictures.
 */
export interface OpencodeFilePart {
  type: "file";
  mime: string;
  url: string;
  filename?: string;
}

export interface OpencodeTurnInput {
  /** User text (plus `[Attached image ... omitted: ...]` notes for dropped files). */
  text: string;
  /** Image attachments inlined as opencode `file` parts (data: URLs). */
  fileParts: OpencodeFilePart[];
  /** Non-text composer blocks, echoed back so the UI renders attachments. */
  attachmentBlocks: JsonValue[];
  /** Attachments that could not be forwarded. */
  warnings: string[];
}

/** Raw bytes above this are not inlined — reference the path in text instead. */
const OPENCODE_INLINE_IMAGE_MAX_BYTES = 24 * 1024 * 1024;

const OPENCODE_IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
};

function opencodeBlockRecord(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function opencodeStringField(record: Record<string, JsonValue>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function parseOpencodeDataUrl(url: string): { mediaType?: string; base64: string } | null {
  if (!url.startsWith("data:")) return null;
  const separator = url.indexOf(",");
  if (separator < 0) return null;
  const header = url.slice(5, separator);
  const payload = url.slice(separator + 1);
  const isBase64 = /;base64$/i.test(header);
  const mediaType = header.replace(/;base64$/i, "").split(";")[0]?.trim() || undefined;
  if (isBase64) return { mediaType, base64: payload.replace(/\s+/g, "") };
  try {
    return { mediaType, base64: Buffer.from(decodeURIComponent(payload), "binary").toString("base64") };
  } catch {
    return { mediaType, base64: "" };
  }
}

function detectOpencodeImageMime(base64: string): string | undefined {
  const head = base64.slice(0, 16);
  if (head.startsWith("/9j/")) return "image/jpeg";
  if (head.startsWith("iVBORw0KGgo")) return "image/png";
  if (head.startsWith("R0lGOD")) return "image/gif";
  if (head.startsWith("UklGR")) return "image/webp";
  return undefined;
}

function opencodeImageMimeForPath(path: string): string | undefined {
  return OPENCODE_IMAGE_MIME_BY_EXT[path.split(".").pop()?.toLowerCase() ?? ""];
}

function isOpencodeRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function opencodeImageFilename(name: string | undefined, mime: string): string {
  if (name && !name.startsWith("data:")) return basename(name);
  const ext = mime.split("/")[1]?.split("+")[0] || "png";
  return `image.${ext}`;
}

async function readOpencodeLocalImage(absPath: string, label: string): Promise<{ mime: string; base64: string }> {
  const st = await stat(absPath);
  if (!st.isFile()) throw new Error(`"${label}" is a directory, not an image file`);
  if (st.size > OPENCODE_INLINE_IMAGE_MAX_BYTES) {
    throw new Error(`"${label}" is ${(st.size / 1024 / 1024).toFixed(1)} MiB, above the inline limit`);
  }
  const bytes = await readFile(absPath);
  const base64 = bytes.toString("base64");
  const mime = opencodeImageMimeForPath(absPath) ?? detectOpencodeImageMime(base64);
  if (!mime) throw new Error(`"${label}" has an unsupported image format (png/jpg/gif/webp/bmp/avif only)`);
  return { mime, base64 };
}

/**
 * Split workbench `turn/start` input into opencode prompt text + `file` parts.
 *
 * Accepts the composer block list, a plain string, or the legacy `prompt`
 * string via `promptFallback`. Image blocks (`image` / `input_image` /
 * `localImage`) become `{type:"file", mime, url: data:...}` parts, which is
 * the only image shape `prompt_async` understands (`data:` and `file:`
 * protocols — remote http(s) URLs are not fetchable server-side, so they are
 * reported in `warnings` and noted in the text instead of being dropped
 * silently). Local paths are read from disk and inlined as data: URLs.
 */
export async function extractOpencodeTurnInput(
  input: unknown,
  promptFallback?: unknown,
  cwd?: string,
): Promise<OpencodeTurnInput> {
  if (typeof input === "string") {
    return { text: input, fileParts: [], attachmentBlocks: [], warnings: [] };
  }
  if (!Array.isArray(input)) {
    const prompt = typeof promptFallback === "string" ? promptFallback : "";
    return { text: prompt, fileParts: [], attachmentBlocks: [], warnings: [] };
  }

  const textParts: string[] = [];
  const fileParts: OpencodeFilePart[] = [];
  const attachmentBlocks: JsonValue[] = [];
  const warnings: string[] = [];
  const baseDir = cwd?.trim() || process.cwd();

  // History keeps path references only: transient base64 goes to fileParts
  // (read-time hydration for the model), while attachmentBlocks — which is
  // persisted into session messages/history — carries {type:localImage,path}
  // or a text placeholder, never bitmap bytes.
  const pushImageFromDataUrl = (source: string, name: string | undefined, entry: JsonValue): void => {
    const parsed = parseOpencodeDataUrl(source);
    const label = name ?? "image";
    if (!parsed || !parsed.base64) {
      warnings.push(`Dropped empty image attachment ${label}`);
      textParts.push(`[Attached image "${label}" was omitted: empty image data]`);
      attachmentBlocks.push(pathOnlyHistoryPlaceholder(label, "empty image data") as JsonValue);
      return;
    }
    const mime = (parsed.mediaType ?? detectOpencodeImageMime(parsed.base64) ?? "").toLowerCase();
    if (!mime.startsWith("image/")) {
      warnings.push(`Dropped non-image data attachment ${name ?? "file"} (${parsed.mediaType ?? "unknown type"})`);
      textParts.push(`[Attached file "${name ?? "file"}" was omitted: only images can be sent to opencode]`);
      attachmentBlocks.push(pathOnlyHistoryPlaceholder(label, "only images can be sent to opencode") as JsonValue);
      return;
    }
    fileParts.push({ type: "file", mime, url: `data:${mime};base64,${parsed.base64}`, filename: opencodeImageFilename(name, mime) });
    // No disk path exists for an inline data: URL (legacy client). Persist a
    // placeholder so the base64 never lands in session/history storage.
    // NOTE: textParts (the model prompt) is intentionally untouched — the
    // placeholder lives only in attachmentBlocks (the persisted echo), so the
    // model prompt and the "[N image(s)]" preview fallback stay unchanged.
    attachmentBlocks.push(pathOnlyHistoryPlaceholder(label, "inline image data is never persisted; save it into the workspace first") as JsonValue);
    void entry;
  };

  for (const entry of input) {
    const block = opencodeBlockRecord(entry as JsonValue);
    const type = typeof block.type === "string" ? block.type : "";

    if (type === "text" || type === "input_text" || type === "inputText") {
      if (typeof block.text === "string" && block.text) textParts.push(block.text);
      continue;
    }

    if (type === "mention" || type === "skill" || type === "file" || type === "document") {
      const path = opencodeStringField(block, ["path"]);
      if (path && opencodeImageMimeForPath(path)) {
        const abs = isAbsolute(path) ? path : resolve(baseDir, path);
        try {
          const { mime, base64 } = await readOpencodeLocalImage(abs, path);
          fileParts.push({ type: "file", mime, url: `data:${mime};base64,${base64}`, filename: basename(path) });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          warnings.push(`Could not attach image ${path}: ${reason}`);
          textParts.push(`[Attached image "${path}" was omitted: ${reason}]`);
        }
      }
      if (path) attachmentBlocks.push(entry as JsonValue);
      continue;
    }

    if (type !== "image" && type !== "input_image" && type !== "inputImage" && type !== "localImage") {
      attachmentBlocks.push(entry as JsonValue);
      continue;
    }

    const source = opencodeStringField(block, ["url", "image_url", "imageUrl", "path", "uri"]);
    const name = opencodeStringField(block, ["name"]) ?? (source?.startsWith("data:") ? "image" : source);
    if (!source) continue;

    if (source.startsWith("data:")) {
      pushImageFromDataUrl(source, name, entry as JsonValue);
      continue;
    }
    if (isOpencodeRemoteUrl(source)) {
      warnings.push(`Dropped remote image URL ${source.slice(0, 120)} (opencode only accepts data: attachments)`);
      textParts.push(`[Attached image URL "${source.slice(0, 200)}" was omitted: save it into the workspace first]`);
      attachmentBlocks.push(entry as JsonValue);
      continue;
    }
    const abs = isAbsolute(source) ? source : resolve(baseDir, source);
    try {
      const { mime, base64 } = await readOpencodeLocalImage(abs, name ?? source);
      fileParts.push({ type: "file", mime, url: `data:${mime};base64,${base64}`, filename: opencodeImageFilename(name, mime) });
      // Persist the disk path only; base64 above is transient for this turn.
      // `name` defaults to `source` above, so only keep it when the client
      // sent an explicit distinct name — otherwise history gets path twice.
      const explicitName = opencodeStringField(block, ["name"]);
      attachmentBlocks.push(
        toPathOnlyImageBlock({ path: abs, name: explicitName !== source ? explicitName : undefined }) as JsonValue,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(`Could not attach image ${name ?? source}: ${reason}`);
      textParts.push(`[Attached image "${name ?? source}" was omitted: ${reason}]`);
      attachmentBlocks.push(entry as JsonValue);
    }
  }

  return { text: textParts.join("\n"), fileParts, attachmentBlocks, warnings };
}

/** Build the `parts` payload for `prompt_async` / `message`. */
export function buildOpencodePromptParts(
  text: string,
  fileParts: OpencodeFilePart[] = [],
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (text) parts.push({ type: "text", text });
  for (const file of fileParts) {
    parts.push({
      type: "file",
      mime: file.mime,
      url: file.url,
      ...(file.filename ? { filename: file.filename } : {}),
    });
  }
  if (parts.length === 0) parts.push({ type: "text", text });
  return parts;
}

export class OpencodeCompatibleRuntime extends EventEmitter {
  private processManager: OpencodeCompatibleProcessManager | null = null;
  private serverInfo: OpencodeServerInfo | null = null;
  private sseAbortController: AbortController | null = null;
  /** Abort handle for the in-flight OpenCode v2 turn (event feed + prompt). */
  private v2TurnAbort: AbortController | null = null;
  private ctx: OpencodeProjectorContext | null = null;
  private isTurnRunning = false;
  /** IDs observed in the previous turn; OpenCode SSE has no turn ID. */
  private staleMessageIds = new Set<string>();
  private seenSseEventIds = new Set<string>();
  private awaitingTurnActivity = false;
  private currentTurnHasTerminalAssistantMessage = false;
  private sseConnected = false;
  private sseConnectedResolve: (() => void) | null = null;
  private sseConnectedPromise: Promise<void> | null = null;
  /** 共享池指纹（决定 OPENCODE_CONFIG_CONTENT 的全量字段），替代逐字段比对。 */
  private spawnedFingerprint = "";
  private pooledServerKey: string | null = null;
  private onPooledStderr: ((text: string) => void) | null = null;
  private onPooledExit: ((info: { code: number | null; signal: string | null; stopping: boolean }) => void) | null = null;
  private idleConfirmTimer: ReturnType<typeof setTimeout> | null = null;
  private turnStallTimer: ReturnType<typeof setTimeout> | null = null;
  private upstreamRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPermissions = new Set<string>();
  private pendingQuestions = new Map<string, {
    threadId: string;
    turnId: string;
    questions: NormalizedOpencodeQuestion[];
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(public readonly config: OpencodeRuntimeConfig) {
    super();
  }

  private buildProcConfig(relay = this.config.relay, saVmMcp = this.config.saVmMcp, apiVersion = this.config.apiVersion): OpencodeProcessConfig {
    return {
      binPath: this.config.binPath,
      apiVersion,
      serverEntryArgs: this.config.serverEntryArgs,
      cwd: this.config.cwd,
      dangerous: this.config.dangerous,
      envOverrides: this.config.envOverrides,
      saVmMcp,
      isolateThirdParty: this.config.isolateThirdParty,
      ...(relay ? {
        relayProvider: {
          providerId: relay.providerID,
          baseURL: relay.baseURL,
          apiKey: relay.apiKey,
          models: relay.models.length > 0 ? relay.models : [relay.targetModel],
          contextWindow: relay.contextWindow,
          modelCapability: relay.modelCapability,
        },
      } : {}),
    };
  }

  private detachPooledServer(opts?: { stopWhenLast?: boolean }): void {
    const manager = this.processManager as (OpencodeCompatibleProcessManager & { off?: (event: string, listener: (...args: any[]) => void) => void }) | null;
    const key = this.pooledServerKey;
    if (manager && this.onPooledStderr) {
      try { manager.off?.("stderr", this.onPooledStderr); } catch { /* 兼容测试注入的假 manager */ }
    }
    if (manager && this.onPooledExit) {
      try { manager.off?.("exit", this.onPooledExit); } catch { /* 兼容测试注入的假 manager */ }
    }
    this.onPooledStderr = null;
    this.onPooledExit = null;
    this.processManager = null;
    this.serverInfo = null;
    this.pooledServerKey = null;
    this.spawnedFingerprint = "";
    if (manager && key) {
      releaseSharedOpencodeServer(key, manager, opts);
    } else if (manager) {
      // 非池化持有（测试注入/外部 server）：保持旧语义，直接停掉，避免泄漏。
      void (manager as OpencodeCompatibleProcessManager).stop().catch(() => {});
    }
  }

  updateConfig(updates: Partial<OpencodeRuntimeConfig>): void {
    const nextRelay = (updates.relay !== undefined ? updates.relay : this.config.relay) ?? undefined;
    const nextSaVmMcp = (updates.saVmMcp !== undefined ? updates.saVmMcp : this.config.saVmMcp) ?? undefined;
    const merged = {
      binPath: updates.binPath !== undefined ? updates.binPath : this.config.binPath,
      serverEntryArgs: updates.serverEntryArgs !== undefined ? updates.serverEntryArgs : this.config.serverEntryArgs,
      cwd: updates.cwd !== undefined ? updates.cwd : this.config.cwd,
      dangerous: updates.dangerous !== undefined ? updates.dangerous : this.config.dangerous,
      envOverrides: updates.envOverrides !== undefined ? updates.envOverrides : this.config.envOverrides,
    };
    // 全量指纹比对（与池 key 同算法）：任一决定 OPENCODE_CONFIG_CONTENT 的字段
    // 变化都必须脱离旧进程。cwd 不进指纹，单纯切换工作目录不会误 detach。
    const nextFingerprint = fingerprintOpencodeProcessConfig({
      ...this.buildProcConfig(nextRelay, nextSaVmMcp, updates.apiVersion !== undefined ? updates.apiVersion : this.config.apiVersion),
      binPath: merged.binPath,
      serverEntryArgs: merged.serverEntryArgs,
      cwd: merged.cwd,
      dangerous: merged.dangerous,
      envOverrides: merged.envOverrides,
      isolateThirdParty: updates.isolateThirdParty !== undefined ? updates.isolateThirdParty : this.config.isolateThirdParty,
    });
    if (this.processManager && this.spawnedFingerprint && nextFingerprint !== this.spawnedFingerprint) {
      // 旧 serve 进程的注入已固化，必须脱离共享池（仅释放引用，不 kill 共享进程，
      // 其他同指纹会话仍可继续用），下次 ensureServer 按新指纹重取。
      this.detachPooledServer();
    }
    Object.assign(this.config, updates);
  }

  /** Resolves once the SSE stream reports server.connected (or first event). */
  waitForSseConnected(timeoutMs = OPENCODE_EVENT_STREAM_CONNECT_TIMEOUT_MS): Promise<boolean> {
    if (this.sseConnected) return Promise.resolve(true);
    if (!this.sseConnectedPromise) return Promise.resolve(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(this.sseConnected), timeoutMs);
    });
    return Promise.race([
      this.sseConnectedPromise.then(() => true),
      timeout,
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  get threadId(): string {
    return this.config.threadId;
  }

  get sessionId(): string | undefined {
    return this.config.sessionId;
  }

  get isRunning(): boolean {
    return this.isTurnRunning;
  }

  get baseUrl(): string {
    if (this.config.serverUrl) return this.config.serverUrl;
    if (this.serverInfo) return this.serverInfo.url;
    throw new Error("OpenCode server is not running");
  }

  get authHeader(): string {
    const password = this.config.serverPassword ?? this.serverInfo?.password ?? "";
    const token = Buffer.from(`opencode:${password}`).toString("base64");
    return `Basic ${token}`;
  }

  async ensureServer(): Promise<OpencodeServerInfo> {
    if (this.serverInfo && this.processManager?.isRunning) {
      return this.serverInfo;
    }
    // 持有的是共享池引用但进程已退出（被回收/崩溃）：先释放旧引用，
    // 避免 refCount 泄漏，下方按当前指纹重新 acquire。
    if (this.processManager && this.pooledServerKey) {
      this.detachPooledServer();
    }
    if (this.config.serverUrl && this.config.serverPassword) {
      this.serverInfo = {
        url: this.config.serverUrl,
        hostname: "127.0.0.1",
        port: 0,
        password: this.config.serverPassword,
      };
      return this.serverInfo;
    }

    // 会话隔离说明：池只复用 `opencode serve` 进程（HTTP 服务），
    // 每个对话线程仍拥有独立的 opencode 原生 sessionId + 独立 SSE 订阅 +
    // 独立 turn 上下文。所有 /session/:id/* 请求都带各自 sessionId，
    // SSE 事件按 properties.sessionID 过滤（见 handleSseEvent），
    // cwd 通过每请求的 x-opencode-directory 头传递，因此同进程多会话
    // 不会串话。决定 OPENCODE_CONFIG_CONTENT 的字段（dangerous/relay/
    // saVmMcp/binary/env）全部进入池指纹，不同配置绝不共进程。
    const procConfig = this.buildProcConfig();
    const { key, manager, info } = await acquireSharedOpencodeServer(procConfig);
    this.pooledServerKey = key;
    this.processManager = manager;
    this.serverInfo = info;
    this.onPooledStderr = (text: string) => {
      this.emit("stderr", text);
    };
    this.onPooledExit = (exitInfo) => {
      this.handleProcessExit(exitInfo);
    };
    manager.on("stderr", this.onPooledStderr);
    manager.on("exit", this.onPooledExit);

    this.spawnedFingerprint = key;
    return this.serverInfo;
  }

  private handleProcessExit(info: { code: number | null; signal: string | null; stopping: boolean }): void {
    this.clearIdleConfirmTimer();
    this.clearTurnStallTimer();
    if (this.ctx && this.ctx.status === "running") {
      const errorMsg = !info.stopping && info.code !== 0
        ? `OpenCode process exited unexpectedly with code ${info.code}`
        : undefined;
      this.terminateActiveTurn(info.stopping ? "interrupted" : "failed", errorMsg);
    }
    this.isTurnRunning = false;
    // 共享池进程退出只代表本会话的连接失效：摘掉监听并清空本地引用，
    // 绝不替其他会话做 stop（池已在 manager exit 时删除条目）。
    // 注意：exit 回调触发时池引用仍占着，必须 release 否则 refCount 泄漏。
    const manager = this.processManager;
    const key = this.pooledServerKey;
    if (manager && this.onPooledStderr) {
      try { (manager as { off?: (event: string, listener: (...args: any[]) => void) => void }).off?.("stderr", this.onPooledStderr); } catch { /* ignore */ }
    }
    if (manager && this.onPooledExit) {
      try { (manager as { off?: (event: string, listener: (...args: any[]) => void) => void }).off?.("exit", this.onPooledExit); } catch { /* ignore */ }
    }
    this.onPooledStderr = null;
    this.onPooledExit = null;
    this.processManager = null;
    this.serverInfo = null;
    this.pooledServerKey = null;
    this.spawnedFingerprint = "";
    if (manager && key) releaseSharedOpencodeServer(key, manager);
    this.emit("exit", info);
  }

  async createSession(title?: string, model?: { providerID: string; modelID: string }): Promise<string> {
    await this.ensureServer();
    const res = await fetch(`${this.baseUrl}/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
        "x-opencode-directory": this.config.cwd,
      },
      body: JSON.stringify({
        title: title || `Session ${this.config.threadId.slice(0, 8)}`,
        ...(model ? { model: { providerID: model.providerID, id: model.modelID } } : {}),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenCode createSession failed (HTTP ${res.status}): ${errText || res.statusText}`);
    }

    const data = (await res.json()) as { id: string };
    this.config.sessionId = data.id;
    this.emit("sessionId", data.id);
    return data.id;
  }

  private startSseSubscription(): void {
    if (this.sseAbortController) return;

    this.sseAbortController = new AbortController();
    const signal = this.sseAbortController.signal;
    if (!this.sseConnectedPromise) {
      this.sseConnectedPromise = new Promise<void>((resolve) => {
        this.sseConnectedResolve = resolve;
      });
    }

    const markConnected = (): void => {
      if (!this.sseConnected) {
        this.sseConnected = true;
        this.sseConnectedResolve?.();
        this.sseConnectedResolve = null;
      }
    };

    const url = `${this.baseUrl}/event`;
    void (async () => {
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: this.authHeader,
            "x-opencode-directory": this.config.cwd,
            Accept: "text/event-stream",
          },
          signal,
        });

        if (!res.ok || !res.body) {
          return;
        }
        markConnected();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // OpenCode uses CRLF on Windows. Framing by only `\n\n` leaves the
          // whole buffer intact and replays every prior event on each chunk.
          // Split complete SSE records once and retain only the partial tail.
          const split = splitOpencodeSseRecords(buffer);
          buffer = split.remainder;
          for (const record of split.records) {
            for (const ev of parseOpencodeSseChunk(`${record}\n\n`)) {
              this.handleSseEvent(ev);
            }
          }
        }
      } catch (err: unknown) {
        if (!signal.aborted) {
          this.sseConnected = false;
          const detail = err instanceof Error ? err.message : "event stream closed";
          this.terminateActiveTurn("failed", `OpenCode event stream disconnected: ${detail}`);
        }
      } finally {
        this.sseConnected = false;
        if (!signal.aborted) {
          this.terminateActiveTurn("failed", "OpenCode event stream closed before the turn reached a terminal state");
          if (this.sseAbortController?.signal === signal) {
            this.sseAbortController = null;
            this.sseConnectedPromise = null;
            this.sseConnectedResolve = null;
          }
        }
      }
    })();
  }

  private clearIdleConfirmTimer(): void {
    if (this.idleConfirmTimer) {
      clearTimeout(this.idleConfirmTimer);
      this.idleConfirmTimer = null;
    }
  }

  private clearTurnStallTimer(): void {
    if (this.turnStallTimer) {
      clearTimeout(this.turnStallTimer);
      this.turnStallTimer = null;
    }
  }

  private clearUpstreamRetryTimer(): void {
    if (this.upstreamRetryTimer) {
      clearTimeout(this.upstreamRetryTimer);
      this.upstreamRetryTimer = null;
    }
  }

  private async postPrompt(url: string, payload: unknown): Promise<Response> {
    const startedAt = Date.now();
    for (let retry = 0; ; retry += 1) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.authHeader,
          "x-opencode-directory": this.config.cwd,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(OPENCODE_PROMPT_REQUEST_TIMEOUT_MS),
      });
      if (response.status !== 429) return response;
      const retryAfterMs = opencodeRetryAfterMs(response) ?? OPENCODE_PROMPT_429_RETRY_BASE_MS * (2 ** retry);
      const elapsedMs = Date.now() - startedAt;
      const remainingGraceMs = OPENCODE_UPSTREAM_RETRY_GRACE_MS - elapsedMs;
      if (retry >= OPENCODE_PROMPT_429_MAX_RETRIES || remainingGraceMs <= 0) return response;
      const waitMs = Math.min(retryAfterMs, remainingGraceMs);
      await response.body?.cancel().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      if (waitMs >= remainingGraceMs) return response;
    }
  }

  private scheduleUpstreamRetryCheck(): void {
    this.clearUpstreamRetryTimer();
    const ctx = this.ctx;
    if (!ctx || ctx.status !== "running" || ctx.upstreamIssueAtMs == null) return;
    const issueAt = ctx.upstreamIssueAtMs;
    const waitMs = Math.max(0, OPENCODE_UPSTREAM_RETRY_GRACE_MS - (Date.now() - issueAt));
    this.upstreamRetryTimer = setTimeout(() => {
      this.upstreamRetryTimer = null;
      const active = this.ctx;
      if (!active || active.status !== "running" || active.upstreamIssueAtMs !== issueAt) return;
      this.terminateActiveTurn("failed", `OpenCode upstream retry did not recover within ${Math.ceil(OPENCODE_UPSTREAM_RETRY_GRACE_MS / 1000)} seconds: ${active.upstreamIssueMsg ?? "retrying"}`);
    }, waitMs + 1);
  }

  private scheduleTurnStallCheck(): void {
    this.clearTurnStallTimer();
    const ctx = this.ctx;
    const timeoutMs = this.config.turnStallTimeoutMs ?? OPENCODE_TURN_STALL_TIMEOUT_MS;
    if (!ctx || ctx.status !== "running" || !this.isTurnRunning || timeoutMs <= 0) return;
    if (this.pendingQuestions.size > 0 || this.pendingPermissions.size > 0) return;
    const waitMs = Math.max(0, timeoutMs - (Date.now() - ctx.lastActivityMs));
    this.turnStallTimer = setTimeout(() => {
      this.turnStallTimer = null;
      const active = this.ctx;
      if (!active || active.status !== "running" || !this.isTurnRunning) return;
      if (Date.now() - active.lastActivityMs < timeoutMs) {
        this.scheduleTurnStallCheck();
        return;
      }
      const error = `OpenCode turn stalled without progress for ${Math.ceil(timeoutMs / 1000)} seconds`;
      this.terminateActiveTurn("failed", error);
    }, waitMs);
  }

  private terminateActiveTurn(reason: "failed" | "interrupted", error?: string): void {
    const ctx = this.ctx;
    if (!ctx || ctx.status !== "running") return;
    const events = forceTerminateOpencode(ctx, reason, error);
    for (const event of events) {
      const notification = toOpencodeNotification(event);
      if (notification) this.emit("notification", notification);
    }
    this.isTurnRunning = false;
    this.clearIdleConfirmTimer();
    this.clearTurnStallTimer();
    this.clearUpstreamRetryTimer();
    ctx.deferredIdleAtMs = null;
    this.awaitingTurnActivity = false;
  }

  private scheduleIdleConfirm(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.status !== "running" || ctx.deferredIdleAtMs == null) return;
    if (this.idleConfirmTimer) return;
    const elapsed = Date.now() - ctx.lastActivityMs;
    const waitMs = Math.max(0, OPENCODE_IDLE_QUIESCE_MS - elapsed) + 50;
    this.idleConfirmTimer = setTimeout(() => {
      this.idleConfirmTimer = null;
      const active = this.ctx;
      if (!active || active.status !== "running" || active.deferredIdleAtMs == null) return;
      if (Date.now() - active.lastActivityMs < OPENCODE_IDLE_QUIESCE_MS) {
        this.scheduleIdleConfirm();
        return;
      }
      const sessionId = this.config.sessionId ?? active.sessionId;
      const confirm: OpencodeSseEvent = {
        id: `idle-confirm-${Date.now()}`,
        type: "session.idle",
        properties: { sessionID: sessionId ?? "" },
      } as unknown as OpencodeSseEvent;
      this.handleSseEvent(confirm);
    }, waitMs);
  }

  private handleSseEvent(event: OpencodeSseEvent): void {
    const eventId = typeof event.id === "string" && event.id.trim()
      ? `${this.config.sessionId ?? ""}:${event.id}`
      : undefined;
    if (eventId) {
      if (this.seenSseEventIds.has(eventId)) return;
      this.seenSseEventIds.add(eventId);
      if (this.seenSseEventIds.size > 20_000) {
        const oldest = this.seenSseEventIds.values().next().value;
        if (typeof oldest === "string") this.seenSseEventIds.delete(oldest);
      }
    }
    if (event.type === "server.connected") {
      this.sseConnected = true;
      this.sseConnectedResolve?.();
      this.sseConnectedResolve = null;
    }
    // Filter events to our session if properties contain sessionID
    const props = (event as { properties?: { sessionID?: string } }).properties;
    if (props?.sessionID && this.config.sessionId && props.sessionID !== this.config.sessionId) {
      return;
    }
    if (event.type === "session.error" && this.config.sessionId && !props?.sessionID) {
      // 共享池回归修复（bea89c71 之前此处直接投递，丢失后 turn 永久 hanging、
      // turn/completed 等终态不再产生，JEV 等终态消费者完全收不到事件）。
      // 无归属 session.error 无法按 sessionID 过滤：
      // - 非池化（独立进程/外部 server）或池引用数 <=1（实际独占）时，
      //   错误必然属于本会话，恢复旧语义继续投递以保留 fail-fast；
      // - 多持有者共享时归属不明，投递会误伤他人 turn，必须丢弃，
      //   该 turn 由重试宽限/stall 计时器兜底。
      // 非 running 状态（turn 间隙/已结束）无 turn 可失败，也直接丢弃，
      // 避免对已终态的 turn 追加第二个终态事件。
      const soleHolder = !this.pooledServerKey || sharedOpencodePoolRefCount(this.pooledServerKey) <= 1;
      if (!soleHolder || !this.ctx || this.ctx.status !== "running") {
        return;
      }
    }

    const eventProps = (event as {
      properties?: {
        messageID?: unknown;
        partID?: unknown;
        part?: { id?: unknown; messageID?: unknown };
        info?: { id?: unknown };
        tool?: { messageID?: unknown };
      };
    }).properties;
    const messageID = typeof eventProps?.messageID === "string" ? eventProps.messageID : undefined;
    const partID = typeof eventProps?.partID === "string"
      ? eventProps.partID
      : typeof eventProps?.part?.id === "string" ? eventProps.part.id : undefined;
    const nestedMessageID = typeof eventProps?.part?.messageID === "string"
      ? eventProps.part.messageID
      : typeof eventProps?.info?.id === "string" ? eventProps.info.id : undefined;
    const toolMessageID = typeof eventProps?.tool?.messageID === "string" ? eventProps.tool.messageID : undefined;
    if (
      (messageID && this.staleMessageIds.has(messageID))
      || (partID && this.staleMessageIds.has(partID))
      || (nestedMessageID && this.staleMessageIds.has(nestedMessageID))
      || (toolMessageID && this.staleMessageIds.has(toolMessageID))
    ) {
      return;
    }
    const hasFreshMessageIdentity = Boolean(messageID || partID || nestedMessageID || toolMessageID);

    // OpenCode session.status events carry no turn id. A retry notification
    // from the previous turn can therefore arrive after interrupt/settlement
    // and poison the newly-created turn's retry grace state. Until this turn
    // has produced any identifiable activity, keep those ambiguous retries
    // out; retries after the first new message/tool event remain live.
    if (
      this.awaitingTurnActivity
      && event.type === "session.status"
      && (event as { properties?: { status?: { type?: unknown } } }).properties?.status?.type === "retry"
    ) {
      return;
    }

    // A reply/reject that landed from elsewhere (another client, timeout)
    // still clears our modal state, even after the turn ended.
    if (event.type === "question.replied" || event.type === "question.rejected") {
      const requestID = (event as { properties?: { requestID?: unknown } }).properties?.requestID;
      if (typeof requestID === "string") this.clearPendingQuestion(requestID);
      return;
    }

    if (!this.ctx || this.ctx.status !== "running") {
      return;
    }

    if (event.type === "message.part.updated" || event.type === "message.part.delta") {
      if (hasFreshMessageIdentity) this.currentTurnHasTerminalAssistantMessage = false;
    }
    if (event.type === "message.updated") {
      const info = (event as {
        properties?: {
          info?: {
            id?: unknown;
            role?: unknown;
            finish?: unknown;
            error?: unknown;
            time?: { completed?: unknown };
          };
        };
      }).properties?.info;
      if (info?.role === "assistant" && typeof info.id === "string") {
        this.currentTurnHasTerminalAssistantMessage = (
          typeof info.time?.completed === "number"
          && Number.isFinite(info.time.completed)
          && info.error == null
          && info.finish !== "tool-calls"
        );
      }
    }

    const isIdleEvent = event.type === "session.idle"
      || (event.type === "session.status"
        && (event as { properties?: { status?: { type?: unknown } } }).properties?.status?.type === "idle");
    const isCurrentPlanUpdate = event.type === "todo.updated" && this.ctx.pendingPlanCandidates.size > 0;
    if (this.awaitingTurnActivity && isIdleEvent) return;
    if (!this.currentTurnHasTerminalAssistantMessage && isIdleEvent) return;
    if (event.type === "todo.updated" && !isCurrentPlanUpdate) return;
    if (
      this.awaitingTurnActivity
      && event.type !== "session.status"
      && !hasFreshMessageIdentity
      && event.type !== "todo.updated"
    ) {
      return;
    }

    // An idle notification can race with the final streamed assistant chunk.
    // The projector clears deferredIdleAtMs when new activity arrives, but the
    // prior idle observation must still be retained so quiescence can be
    // re-checked instead of leaving the turn in working forever.
    const hadDeferredIdle = this.ctx.deferredIdleAtMs != null;
    const projected = projectOpencodeEvent(event, this.ctx);
    const isActivityEvent = event.type === "message.part.updated"
      || event.type === "message.part.delta"
      || event.type === "message.updated"
      || ((event.type === "permission.asked" || event.type === "question.asked") && hasFreshMessageIdentity)
      || isCurrentPlanUpdate;
    if (isActivityEvent) this.awaitingTurnActivity = false;
    if (this.awaitingTurnActivity && isIdleEvent) return;
    if (isActivityEvent) this.clearIdleConfirmTimer();
    for (const p of projected) {
      if (p.kind === "question/asked") {
        // Codex parity: drive the same `requestUserInput` modal mini/codex
        // turns use; the answer comes back through respondToQuestionRequest.
        this.registerPendingQuestion(p);
        continue;
      }
      if (p.kind === "permission/asked") {
        this.pendingPermissions.add(p.requestId);
        this.clearTurnStallTimer();
        // Emit server request for Codex approval dialog
        const req: JsonRpcRequest = {
          id: p.requestId,
          method: "item/commandExecution/requestApproval",
          params: {
            id: p.requestId,
            threadId: p.threadId,
            turnId: p.turnId,
            toolName: p.permission,
            command: p.patterns,
            input: {
              permission: p.permission,
              patterns: p.patterns,
              metadata: p.metadata as JsonValue,
            },
          },
        };
        this.emit("serverRequest", req);
        continue;
      }

      const notif = toOpencodeNotification(p);
      if (notif) {
        this.emit("notification", notif);
      }

      if (p.kind === "turn/completed" || p.kind === "turn/failed" || p.kind === "turn/interrupted") {
        this.isTurnRunning = false;
        this.awaitingTurnActivity = false;
        this.clearIdleConfirmTimer();
        this.clearTurnStallTimer();
        this.clearUpstreamRetryTimer();
        if (this.ctx) this.ctx.deferredIdleAtMs = null;
      }
    }
    if (this.ctx?.upstreamIssueAtMs != null) this.scheduleUpstreamRetryCheck();
    else this.clearUpstreamRetryTimer();
    if (this.ctx && this.ctx.status === "running" && this.ctx.deferredIdleAtMs != null) {
      if (isIdleEvent || projected.length === 0) this.scheduleIdleConfirm();
    }
    if (
      hadDeferredIdle
      && (event.type === "message.part.updated"
        || event.type === "message.part.delta"
        || event.type === "message.updated")
      && !isIdleEvent
      && this.ctx
      && this.ctx.status === "running"
      && this.ctx.deferredIdleAtMs == null
    ) {
      this.ctx.deferredIdleAtMs = Date.now();
      this.scheduleIdleConfirm();
    }
  }

  /** Model payload for prompt/create calls. Relay wins; else provider-qualified id; else server default. */
  resolveModelPayload(): { providerID: string; modelID: string } | undefined {
    const relay = this.config.relay;
    if (relay && relay.targetModel.trim()) {
      return { providerID: relay.providerID, modelID: relay.targetModel.trim() };
    }
    return resolveOpencodeModelPayload(this.config.model);
  }

  async executeTurn(prompt: string, turnId: string, options?: { fileParts?: OpencodeFilePart[] }): Promise<void> {
    if ((this.config.apiVersion ?? 1) === 2) {
      await this.executeTurnV2(prompt, turnId);
      return;
    }
    await this.ensureServer();

    const modelPayload = this.resolveModelPayload();
    if (!modelPayload && (this.config.model ?? "").trim()) {
      console.warn(`[opencodeRuntime] ignoring bare model id without provider prefix: "${(this.config.model ?? "").trim()}" (thread=${this.config.threadId})`);
    }

    if (!this.config.sessionId) {
      await this.createSession(undefined, modelPayload);
    }

    const contextWindow = inferOpencodeModelLimits(
      this.config.model,
      this.config.relay?.contextWindow,
      this.config.relay?.modelCapability,
    ).context;
    if (this.ctx) {
      for (const id of this.ctx.messageRoles.keys()) this.staleMessageIds.add(id);
      for (const id of this.ctx.partTexts.keys()) this.staleMessageIds.add(id);
      for (const id of this.ctx.partTypes.keys()) this.staleMessageIds.add(id);
      // Keep the guard bounded for very long-lived sessions.
      if (this.staleMessageIds.size > 20_000) {
        this.staleMessageIds = new Set(Array.from(this.staleMessageIds).slice(-10_000));
      }
    }
    const turnCtx = createOpencodeProjectorContext(this.config.threadId, turnId, { contextWindow });
    turnCtx.sessionId = this.config.sessionId;
    this.ctx = turnCtx;
    this.isTurnRunning = true;
    this.awaitingTurnActivity = true;
    this.currentTurnHasTerminalAssistantMessage = false;
    this.clearIdleConfirmTimer();

    // Turn start notification
    const startEv: OpencodeProjectedEvent = { kind: "turn/started", threadId: this.config.threadId, turnId };
    const startNotif = toOpencodeNotification(startEv);
    if (startNotif) this.emit("notification", startNotif);

    this.startSseSubscription();
    const sseReady = await this.waitForSseConnected(this.config.eventStreamConnectTimeoutMs ?? OPENCODE_EVENT_STREAM_CONNECT_TIMEOUT_MS);
    if (!sseReady || !this.sseConnected) {
      const error = "Timed out waiting for the OpenCode event stream to connect";
      this.terminateActiveTurn("failed", error);
      throw new Error(error);
    }
    this.scheduleTurnStallCheck();

    // Try prompt_async first
    const promptUrl = `${this.baseUrl}/session/${this.config.sessionId}/prompt_async`;
    const payload = {
      parts: buildOpencodePromptParts(prompt, options?.fileParts),
      ...(modelPayload ? { model: modelPayload } : {}),
    };

    try {
      let res = await this.postPrompt(promptUrl, payload);

      if (res.status === 404) {
        const syncUrl = `${this.baseUrl}/session/${this.config.sessionId}/message`;
        res = await this.postPrompt(syncUrl, payload);
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenCode prompt failed (HTTP ${res.status}): ${errText || res.statusText}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.terminateActiveTurn("failed", message);
      throw error;
    }
  }

  async prompt(text: string, options?: { fileParts?: OpencodeFilePart[] }): Promise<void> {
    await this.ensureServer();
    if (!this.config.sessionId) return;
    const modelPayload = this.resolveModelPayload();
    const promptUrl = `${this.baseUrl}/session/${this.config.sessionId}/prompt_async`;
    const payload = {
      parts: buildOpencodePromptParts(text, options?.fileParts),
      ...(modelPayload ? { model: modelPayload } : {}),
    };
    let res = await fetch(promptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
        "x-opencode-directory": this.config.cwd,
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 404) {
      const syncUrl = `${this.baseUrl}/session/${this.config.sessionId}/message`;
      res = await fetch(syncUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.authHeader,
          "x-opencode-directory": this.config.cwd,
        },
        body: JSON.stringify(payload),
      });
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenCode prompt failed (HTTP ${res.status}): ${errText || res.statusText}`);
    }
  }

  async replyPermission(requestId: string, reply: "once" | "always" | "reject", message?: string): Promise<boolean> {
    try {
      await this.ensureServer();
      const url = `${this.baseUrl}/permission/${requestId}/reply`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.authHeader,
          "x-opencode-directory": this.config.cwd,
        },
        body: JSON.stringify({ reply, message }),
        signal: AbortSignal.timeout(OPENCODE_PROMPT_REQUEST_TIMEOUT_MS),
      });
      return res.ok;
    } finally {
      this.pendingPermissions.delete(requestId);
      this.scheduleTurnStallCheck();
    }
  }

  /**
   * OpenCode v2 turn flow. The v2 `serve` HTTP contract (verified against
   * the v2.1.x protocol + generated client sources) differs from v1:
   * sessions are created at `POST /api/session`, a prompt is *admitted*
   * with `POST /api/session/:id/prompt` (execution is scheduled, not
   * streamed back), and progress/completion are published on the
   * `GET /api/event` feed as `session.execution.*` and
   * `session.message.content.updated` events. The final assistant text
   * is read back from `GET /api/session/:id/message` once
   * `session.execution.succeeded` lands. Not wired for v2 yet: file
   * parts, permission/question round-trips, and system-prompt stripping
   * for pass-through models (v2 removed the plugin hook).
   */
  private async executeTurnV2(prompt: string, turnId: string): Promise<void> {
    await this.ensureServer();
    const modelPayload = this.resolveModelPayload();
    if (!this.config.sessionId) {
      const res = await fetch(`${this.baseUrl}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: this.authHeader },
        body: JSON.stringify({
          title: `Session ${this.config.threadId.slice(0, 8)}`,
          ...(modelPayload ? { model: { id: modelPayload.modelID, providerID: modelPayload.providerID } } : {}),
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`OpenCode v2 session creation failed (HTTP ${res.status}): ${errText || res.statusText}`);
      }
      const created = (await res.json().catch(() => null)) as { data?: { id?: string }; id?: string } | null;
      const createdId = created?.data?.id ?? created?.id;
      if (!createdId) throw new Error("OpenCode v2 session creation returned no session id");
      this.config.sessionId = createdId;
      this.emit("sessionId", createdId);
    }
    const sessionId = this.config.sessionId as string;
    const contextWindow = inferOpencodeModelLimits(
      this.config.model,
      this.config.relay?.contextWindow,
      this.config.relay?.modelCapability,
    ).context;
    const turnCtx = createOpencodeProjectorContext(this.config.threadId, turnId, { contextWindow });
    turnCtx.sessionId = sessionId;
    this.ctx = turnCtx;
    this.isTurnRunning = true;
    this.currentTurnHasTerminalAssistantMessage = false;
    const startNotif = toOpencodeNotification({ kind: "turn/started", threadId: this.config.threadId, turnId });
    if (startNotif) this.emit("notification", startNotif);

    const abort = new AbortController();
    this.v2TurnAbort = abort;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 15 * 60_000);

    let streamedText = "";
    let assistantItemId = turnCtx.currentAssistantItemId;
    const emitItem = (status: "inProgress" | "completed", text: string) => {
      const item = {
        type: "agentMessage",
        id: assistantItemId,
        threadId: this.config.threadId,
        turnId,
        content: [{ type: "text", text, text_elements: [] }],
        text,
        role: "assistant",
        status,
        ...(status === "completed" ? { completedAt: Math.floor(Date.now() / 1000) } : {}),
      } as unknown as Record<string, JsonValue>;
      const notif = toOpencodeNotification({
        kind: status === "completed" ? "item/completed" : "item/started",
        threadId: this.config.threadId,
        turnId,
        item,
      });
      if (notif) this.emit("notification", notif);
    };

    type V2Outcome = { status: "succeeded" } | { status: "failed"; error: string } | { status: "interrupted" };
    const readFeed = async (body: ReadableStream<Uint8Array>): Promise<V2Outcome> => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawExecutionStarted = false;
      const handleEvent = (raw: unknown): V2Outcome | null => {
        if (!raw || typeof raw !== "object") return null;
        const event = raw as { type?: unknown; data?: unknown };
        const type = typeof event.type === "string" ? event.type : "";
        const data = (event.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;
        const eventSessionId = typeof data.sessionID === "string" ? data.sessionID : typeof data.sessionId === "string" ? data.sessionId : undefined;
        if (eventSessionId && eventSessionId !== sessionId) return null;
        if (type === "session.execution.started") { sawExecutionStarted = true; return null; }
        if (type === "session.execution.succeeded") return { status: "succeeded" };
        if (type === "session.execution.failed") {
          // Error payload is an object: { type, message, status, ... }.
          const rawError = data.error;
          const message = typeof rawError === "string"
            ? rawError
            : rawError && typeof rawError === "object" && typeof (rawError as { message?: unknown }).message === "string"
              ? (rawError as { message: string }).message
              : "OpenCode v2 execution failed";
          return { status: "failed", error: message };
        }
        if (type === "session.execution.interrupted") return { status: "interrupted" };
        if (type === "session.idle" && sawExecutionStarted) return { status: "succeeded" };
        if (type === "session.text.delta" || type === "session.message.content.updated") {
          // Live-verified v2 shape: session.text.delta carries
          // { assistantMessageID, ordinal, delta }.
          const messageId = typeof data.assistantMessageID === "string" ? data.assistantMessageID
            : typeof data.messageID === "string" ? data.messageID : "";
          if (messageId) assistantItemId = messageId;
          const delta = typeof data.delta === "string" ? data.delta : "";
          const snapshot = typeof data.text === "string" ? data.text : typeof data.content === "string" ? data.content : "";
          if (delta) {
            streamedText += delta;
            const notif = toOpencodeNotification({ kind: "item/agentMessage/delta", threadId: this.config.threadId, turnId, itemId: assistantItemId, delta });
            if (notif) this.emit("notification", notif);
          } else if (snapshot && snapshot.length > streamedText.length) {
            const extra = snapshot.slice(streamedText.length);
            streamedText = snapshot;
            const notif = toOpencodeNotification({ kind: "item/agentMessage/delta", threadId: this.config.threadId, turnId, itemId: assistantItemId, delta: extra });
            if (notif) this.emit("notification", notif);
          }
        }
        return null;
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
            for (const line of frame.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try {
                const outcome = handleEvent(JSON.parse(payload));
                if (outcome) return outcome;
              } catch { /* keep-alives / partial frames */ }
            }
          }
        }
      } catch {
        if (abort.signal.aborted) return { status: "interrupted" };
        return { status: "failed", error: "OpenCode v2 event stream disconnected before the turn reached a terminal state" };
      }
      return { status: "failed", error: "OpenCode v2 event stream closed before the turn reached a terminal state" };
    };

    try {
      const feedRes = await fetch(`${this.baseUrl}/api/event`, {
        headers: { Authorization: this.authHeader, Accept: "text/event-stream" },
        signal: abort.signal,
      });
      if (!feedRes.ok || !feedRes.body) {
        throw new Error(`OpenCode v2 event stream failed (HTTP ${feedRes.status})`);
      }
      const outcomePromise = readFeed(feedRes.body);
      const promptRes = await fetch(`${this.baseUrl}/api/session/${encodeURIComponent(sessionId)}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: this.authHeader },
        body: JSON.stringify({ text: prompt }),
        signal: abort.signal,
      });
      if (!promptRes.ok) {
        const errText = await promptRes.text().catch(() => "");
        abort.abort();
        throw new Error(`OpenCode v2 prompt failed (HTTP ${promptRes.status}): ${errText || promptRes.statusText}`);
      }
      const outcome = await outcomePromise;
      if (outcome.status === "failed") {
        this.terminateActiveTurn("failed", outcome.error);
        throw new Error(outcome.error);
      }
      if (outcome.status === "interrupted") {
        this.terminateActiveTurn("interrupted");
        return;
      }
      // Succeeded: prefer the authoritative final message over streamed
      // deltas (whose exact payload shape may drift between v2 minors).
      let finalText = streamedText;
      try {
        const messagesRes = await fetch(`${this.baseUrl}/api/session/${encodeURIComponent(sessionId)}/message`, {
          headers: { Authorization: this.authHeader },
        });
        if (messagesRes.ok) {
          const payload = (await messagesRes.json().catch(() => null)) as unknown;
          const list = Array.isArray(payload) ? payload : (payload as { data?: unknown[] } | null)?.data;
          if (Array.isArray(list)) {
            // Live-verified v2 shape: newest first, role is `type`
            // ("assistant"), text lives in `content` parts, the id is
            // top-level. Pick the newest assistant message with text.
            let best: { text: string; id?: string; created: number } | null = null;
            for (const entry of list) {
              const message = entry as {
                id?: string;
                type?: string;
                info?: { id?: string; role?: string };
                role?: string;
                time?: { created?: number };
                parts?: unknown[];
                content?: unknown;
              };
              const role = message?.type ?? message?.info?.role ?? message?.role;
              if (role !== "assistant") continue;
              const parts = Array.isArray(message.content) ? message.content : Array.isArray(message.parts) ? message.parts : [];
              const text = parts
                .map((part) => {
                  const p = part as { type?: string; text?: unknown };
                  return p && (p.type === "text" || p.type === undefined) && typeof p.text === "string" ? p.text : "";
                })
                .join("");
              if (!text) continue;
              const created = typeof message.time?.created === "number" ? message.time.created : 0;
              if (!best || created >= best.created) {
                best = { text, id: typeof message.id === "string" ? message.id : message.info?.id, created };
              }
            }
            if (best) {
              finalText = best.text;
              if (best.id) assistantItemId = best.id;
            }
          }
        }
      } catch { /* streamed text remains the fallback */ }
      emitItem("inProgress", finalText);
      emitItem("completed", finalText);
      this.currentTurnHasTerminalAssistantMessage = finalText.length > 0;
      turnCtx.status = "completed";
      this.isTurnRunning = false;
      const completedNotif = toOpencodeNotification({ kind: "turn/completed", threadId: this.config.threadId, turnId });
      if (completedNotif) this.emit("notification", completedNotif);
    } catch (error) {
      if (timedOut) {
        this.terminateActiveTurn("failed", "OpenCode v2 turn timed out");
        throw new Error("OpenCode v2 turn timed out");
      }
      if (this.ctx?.status === "running") {
        const message = error instanceof Error ? error.message : String(error);
        this.terminateActiveTurn("failed", message);
        throw error instanceof Error ? error : new Error(message);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.v2TurnAbort === abort) this.v2TurnAbort = null;
    }
  }

  async summarize(options?: { providerID?: string; modelID?: string }): Promise<boolean> {
    await this.ensureServer();
    if (!this.config.sessionId) {
      const modelPayload = this.resolveModelPayload();
      await this.createSession(undefined, modelPayload);
    }
    if (!this.config.sessionId) return false;

    if ((this.config.apiVersion ?? 1) === 2) {
      // v2 renamed summarize to session compaction.
      const res = await fetch(`${this.baseUrl}/api/session/${this.config.sessionId}/compact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: this.authHeader },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn(`[opencodeRuntime] v2 compact failed (${res.status}): ${errText}`);
        return false;
      }
      return true;
    }

    let providerID = options?.providerID;
    let modelID = options?.modelID;

    if (!providerID || !modelID) {
      const modelPayload = this.resolveModelPayload();
      if (modelPayload) {
        providerID = modelPayload.providerID;
        modelID = modelPayload.modelID;
      }
    }

    if (!providerID || !modelID) {
      throw new Error("Opencode summarize requires providerID and modelID");
    }

    const url = `${this.baseUrl}/session/${this.config.sessionId}/summarize`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
        "x-opencode-directory": this.config.cwd,
      },
      body: JSON.stringify({
        providerID,
        modelID,
        auto: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[opencodeRuntime] summarize failed (${res.status}): ${errText}`);
      return false;
    }
    return true;
  }

  /** Question (question tool) round-trip: modal down, answer up. */

  private clearPendingQuestion(requestId: string): void {
    const pending = this.pendingQuestions.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingQuestions.delete(requestId);
    this.scheduleTurnStallCheck();
    this.emit("notification", {
      method: "serverRequest/resolved",
      params: {
        requestId,
        threadId: pending.threadId,
        turnId: pending.turnId,
      },
    });
  }

  private rejectAllPendingQuestions(releaseRemote: boolean): void {
    const ids = [...this.pendingQuestions.keys()];
    for (const id of ids) {
      this.clearPendingQuestion(id);
      // stop() kills the serve process itself, whose shutdown finalizer
      // already fails pending question Deferreds — no HTTP round-trip needed.
      if (releaseRemote) void this.rejectQuestion(id).catch(() => {});
    }
  }

  private registerPendingQuestion(p: Extract<OpencodeProjectedEvent, { kind: "question/asked" }>): void {
    this.clearPendingQuestion(p.requestId);
    this.clearTurnStallTimer();
    const timer = setTimeout(() => {
      if (!this.pendingQuestions.has(p.requestId)) return;
      this.clearPendingQuestion(p.requestId);
      // Never leave the turn hanging on an unanswered modal: reject so the
      // model sees the dismissal and continues (opencode TUI semantics).
      console.warn(`[opencodeRuntime] question ${p.requestId} unanswered after 120s; rejecting (thread=${p.threadId})`);
      void this.rejectQuestion(p.requestId).catch(() => {});
    }, 120_000);
    this.pendingQuestions.set(p.requestId, { threadId: p.threadId, turnId: p.turnId, questions: p.questions, timer });
    const req: JsonRpcRequest = {
      id: p.requestId,
      method: "item/tool/requestUserInput",
      params: {
        itemId: p.requestId,
        threadId: p.threadId,
        turnId: p.turnId,
        questions: p.questions as unknown as JsonValue[],
      },
    };
    this.emit("serverRequest", req);
  }

  hasPendingQuestion(requestId: string): boolean {
    return this.pendingQuestions.has(requestId);
  }

  /**
   * Route a `respond` call to a pending question. Returns true when the id
   * belonged to a question (bridge falls back to permission handling else).
   */
  respondToQuestionRequest(requestId: string, result?: JsonValue, error?: { message?: string }): boolean {
    const pending = this.pendingQuestions.get(requestId);
    if (!pending) return false;
    this.clearPendingQuestion(requestId);
    if (error && typeof error.message === "string" && error.message) {
      void this.rejectQuestion(requestId).catch((err) => {
        console.warn(`[opencodeRuntime] reject question failed:`, err);
      });
      return true;
    }
    const answers = opencodeQuestionAnswersFromResponse(pending.questions, result);
    if (!answers) {
      // Cancelled/empty modal = user dismissed (opencode native semantics).
      void this.rejectQuestion(requestId).catch((err) => {
        console.warn(`[opencodeRuntime] reject question failed:`, err);
      });
    } else {
      void this.replyQuestion(requestId, answers).catch((err) => {
        console.warn(`[opencodeRuntime] reply question failed:`, err);
      });
    }
    return true;
  }

  async replyQuestion(requestID: string, answers: string[][]): Promise<boolean> {
    await this.ensureServer();
    const res = await fetch(`${this.baseUrl}/question/${encodeURIComponent(requestID)}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
        "x-opencode-directory": this.config.cwd,
      },
      body: JSON.stringify({ answers }),
    });
    return res.ok;
  }

  async rejectQuestion(requestID: string): Promise<boolean> {
    await this.ensureServer();
    const res = await fetch(`${this.baseUrl}/question/${encodeURIComponent(requestID)}/reject`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "x-opencode-directory": this.config.cwd,
      },
    });
    return res.ok;
  }

  async interruptTurn(): Promise<void> {
    const hadActiveTurn = this.ctx?.status === "running";
    // A pending question modal belongs to the dying turn: release the
    // server-side Deferred instead of leaking it.
    this.rejectAllPendingQuestions(true);
    this.clearIdleConfirmTimer();

    this.terminateActiveTurn("interrupted");

    if ((this.config.apiVersion ?? 1) === 2) {
      // The v2 session API has no /abort endpoint; stop the local turn
      // (event feed + prompt admission) and leave the pooled server
      // untouched for the other sessions sharing it.
      this.v2TurnAbort?.abort();
      this.v2TurnAbort = null;
      return;
    }

    let abortAcknowledged = false;
    if (this.config.sessionId && this.serverInfo) {
      try {
        const response = await fetch(`${this.baseUrl}/session/${this.config.sessionId}/abort`, {
          method: "POST",
          headers: {
            Authorization: this.authHeader,
            "x-opencode-directory": this.config.cwd,
          },
          signal: AbortSignal.timeout(this.config.interruptTimeoutMs ?? OPENCODE_ABORT_REQUEST_TIMEOUT_MS),
        });
        abortAcknowledged = response.ok;
      } catch {
        abortAcknowledged = false;
      }
    }

    if (hadActiveTurn && !abortAcknowledged && this.processManager) {
      // 共享池下绝不能无条件 kill 进程（会中断同进程其他对话）。
      // 只断开本会话的 SSE 并释放一次池引用；若本会话是最后一个持有者则
      // 立即停掉拿干净状态（等价旧语义），否则进程留给其他会话，
      // 下次 ensureServer 按指纹重取。本会话的 sessionId/ctx 不变，
      // 重连后仍回到自己的 opencode session。
      this.sseAbortController?.abort();
      this.sseAbortController = null;
      this.sseConnected = false;
      this.sseConnectedPromise = null;
      this.sseConnectedResolve = null;
      this.detachPooledServer({ stopWhenLast: true });
    }
  }

  async readMessages(): Promise<JsonValue[]> {
    if (!this.config.sessionId) return [];
    await this.ensureServer();

    const res = await fetch(`${this.baseUrl}/session/${this.config.sessionId}/message`, {
      headers: {
        Authorization: this.authHeader,
        "x-opencode-directory": this.config.cwd,
      },
    });

    if (!res.ok) return [];
    return (await res.json()) as JsonValue[];
  }

  stop(): void {
    this.rejectAllPendingQuestions(false);
    this.clearIdleConfirmTimer();
    this.clearTurnStallTimer();
    this.clearUpstreamRetryTimer();
    this.pendingPermissions.clear();
    if (this.sseAbortController) {
      this.sseAbortController.abort();
      this.sseAbortController = null;
    }
    this.sseConnected = false;
    this.sseConnectedPromise = null;
    this.sseConnectedResolve = null;
    if (this.ctx && this.ctx.status === "running") {
      forceTerminateOpencode(this.ctx, "interrupted");
    }
    this.isTurnRunning = false;
    this.awaitingTurnActivity = false;
    // 只释放池引用、不 kill 进程：同指纹的其他对话仍在使用同一 bun，
    // 零引用后由池延时回收。本会话的 SSE/ctx 已在上方清理，不会串话。
    this.detachPooledServer();
  }
}
