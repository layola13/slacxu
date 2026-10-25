import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { createBridgeEventLogger, spawnCli, type BridgeEventLogger } from "@cxu/sdk-backend";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type EngineStatus,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonValue,
} from "@codex-ui/shared";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import { findCommandCodeBin, probeCommandCodeVersion } from "./commandCodeCommand.js";
import {
  COMMAND_CODE_LOCAL_API_KEY_PLACEHOLDER,
  COMMAND_CODE_RELAY_KEY_ENV,
  COMMAND_CODE_RELAY_KEY_PLACEHOLDER,
  commandCodeProjectsDir,
} from "./commandCodeProviders.js";

/**
 * Command Code backend bridge — a CodexRuntimeClient that spawns the
 * user's external `command-code` binary once per turn in print mode and
 * projects its NDJSON AgentEvent stream onto the workbench surface.
 *
 * No-login relay operation (verified live against command-code 1.88.0):
 *  - The child runs with HOME=<isolated home> so all of the CLI's state
 *    (providers, sessions, MCP config) lives in the app data dir.
 *  - COMMAND_CODE_API_KEY is set to a placeholder: its presence satisfies
 *    the CLI's headless auth gate, and --local-only guarantees no Command
 *    Code account traffic; model calls go to the BYOK provider the host
 *    registered in providers.json (loopback relay gateway), whose apiKey
 *    is an env reference to a placeholder the gateway ignores.
 *  - Sessions persist as transcripts under
 *    <home>/.commandcode/projects/<slug>/<sessionId>.jsonl; follow-up
 *    turns resume with --resume <sessionId>.
 *  - Approvals: print mode runs with --yolo + -t (the CLI's headless
 *    posture); the manifest honestly declares permissionRoundTrips=false.
 */

export interface CommandCodeUpstreamConfig {
  /** providers.json provider id (the host's stable "cxu-relay" slot). */
  providerId: string;
  model: string;
}

interface CommandCodeSessionState {
  threadId: string;
  sessionId?: string;
  cwd?: string;
  model?: string;
  providerId?: string;
  createdAt: number;
  activeTurnId?: string;
  activeItemId?: string;
  streamedText: string;
  itemStarted: boolean;
  /** Text segment sequence for dialogue/tool interleaving. */
  textSegIndex: number;
  interrupting: boolean;
  child: ChildProcess | null;
  turns: Array<Record<string, JsonValue>>;
  messages: JsonValue[];
}

interface ThreadMapping {
  sessionId?: string;
  cwd?: string;
  model?: string;
  providerId?: string;
  createdAt?: number;
}

export class CommandCodeAgentBridge extends EventEmitter implements CodexRuntimeClient {
  private status: EngineStatus = { phase: "stopped" };
  private readonly sessions = new Map<string, CommandCodeSessionState>();
  private readonly pendingUpstream = new Map<string, CommandCodeUpstreamConfig>();
  private defaultUpstream: CommandCodeUpstreamConfig | null = null;
  /** Unknown NDJSON frame types already logged once (event-name discovery). */
  private readonly loggedFrameTypes = new Set<string>();
  private readonly eventLog: BridgeEventLogger;

  constructor(
    private readonly homeDir: string,
    private readonly runtimeEnv: () => NodeJS.ProcessEnv = () => process.env,
  ) {
    super();
    this.eventLog = createBridgeEventLogger("command-code", homeDir);
  }

  /** Point upcoming turns at a relay station (host-resolved). */
  applyUpstream(config: CommandCodeUpstreamConfig, threadId?: string | null): void {
    if (threadId) this.pendingUpstream.set(threadId, config);
    else this.defaultUpstream = config;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.emit("status", this.getStatus());
  }

  async start(): Promise<EngineStatus> {
    if (this.status.phase === "ready") return this.getStatus();
    const bin = findCommandCodeBin(this.runtimeEnv());
    if (!bin) {
      const message = "Command Code backend could not resolve a command-code binary (install command-code or set COMMAND_CODE_BIN).";
      this.setStatus({ phase: "error", message });
      throw new Error(message);
    }
    this.setStatus({ phase: "ready" });
    return this.getStatus();
  }

  async restart(): Promise<EngineStatus> {
    this.stop();
    return this.start();
  }

  stop(): void {
    for (const session of this.sessions.values()) {
      if (session.child) {
        try { session.child.kill("SIGKILL"); } catch { /* noop */ }
        session.child = null;
      }
    }
    this.setStatus({ phase: "stopped" });
  }

  hasSession(threadId: string): boolean {
    return this.sessions.has(threadId) || this.readMappings()[threadId] !== undefined;
  }

  async request(method: string, params?: JsonValue, _timeoutMs = 60_000): Promise<JsonValue> {
    return this.handleMethod(method, (params ?? {}) as Record<string, JsonValue>);
  }

  async notify(_method: string, _params?: JsonValue): Promise<void> {
    // Print mode is request/response per process; nothing to notify.
  }

  respond(_id: JsonRpcId, _result?: JsonValue, _error?: JsonRpcFailure["error"]): void {
    // No host-routed server requests in print mode.
  }

  // -- thread mapping store -------------------------------------------------

  private mappingPath(): string {
    return join(this.homeDir, ".commandcode", "cxu-threads.json");
  }

  private readMappings(): Record<string, ThreadMapping> {
    try {
      const path = this.mappingPath();
      if (!existsSync(path)) return {};
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, ThreadMapping>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeMapping(threadId: string, mapping: ThreadMapping): void {
    try {
      const all = this.readMappings();
      all[threadId] = { ...all[threadId], ...mapping };
      writeFileSync(this.mappingPath(), JSON.stringify(all, null, 2) + "\n", "utf8");
    } catch (error) {
      console.error("[command-code] failed to persist thread mapping:", error);
    }
  }

  private deleteMapping(threadId: string): void {
    try {
      const all = this.readMappings();
      delete all[threadId];
      writeFileSync(this.mappingPath(), JSON.stringify(all, null, 2) + "\n", "utf8");
    } catch { /* best effort */ }
  }

  // -- RPC surface ----------------------------------------------------------

  private async handleMethod(method: string, p: Record<string, JsonValue>): Promise<JsonValue> {
    switch (method) {
      case "initialize":
      case "config/read": {
        const bin = findCommandCodeBin(this.runtimeEnv());
        const version = bin ? probeCommandCodeVersion(bin) : null;
        return {
          userAgent: `command-code/${version ?? "external"} codex-react-ui/0.1.0`,
          codexHome: process.env.CODEX_HOME || "",
          capabilities: { experimentalApi: true },
        } as JsonValue;
      }

      case "thread/start": {
        await this.start();
        const threadId = (typeof p.threadId === "string" ? p.threadId : null) || randomUUID();
        const cwd = typeof p.cwd === "string" ? p.cwd : process.cwd();
        const upstream = this.pendingUpstream.get(threadId) ?? this.defaultUpstream ?? undefined;
        const model = typeof p.model === "string" ? p.model : upstream?.model;
        const state: CommandCodeSessionState = {
          threadId,
          cwd,
          model,
          providerId: upstream?.providerId,
          createdAt: Date.now(),
          streamedText: "",
          itemStarted: false,
          textSegIndex: 0,
          interrupting: false,
          child: null,
          turns: [],
          messages: [],
        };
        this.sessions.set(threadId, state);
        this.writeMapping(threadId, { cwd, model, providerId: state.providerId, createdAt: state.createdAt });
        this.emit("message", {
          method: "thread/started",
          params: { thread: { id: threadId, model, cliBackend: "command-code", status: { type: "idle" }, cwd } },
        } as JsonRpcMessage);
        return { thread: { id: threadId, model, cliBackend: "command-code", status: { type: "idle" } } } as JsonValue;
      }

      case "thread/resume": {
        await this.start();
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const state = this.restoreSession(threadId);
        if (!state) throw new Error("Unknown thread: " + threadId);
        return {
          thread: { id: state.threadId, model: state.model, cliBackend: "command-code", status: { type: "idle" }, cwd: state.cwd },
        } as JsonValue;
      }

      case "thread/list": {
        const threads = this.listThreads();
        return { data: threads } as JsonValue;
      }

      case "thread/turns/list": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const state = this.restoreSession(threadId);
        return { turns: state ? state.turns : [] } as JsonValue;
      }

      case "thread/items/list": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const state = this.restoreSession(threadId);
        return { items: state ? state.messages : [] } as JsonValue;
      }

      case "turn/start":
      case "turn/steer": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const state = this.sessions.get(threadId) ?? this.restoreSession(threadId);
        if (!state) throw new Error("Unknown thread: " + threadId);
        if (method === "turn/start" && state.activeTurnId) {
          throw new Error(`Turn is already active: ${state.activeTurnId}`);
        }
        const text = extractTurnText(p);
        if (!text) throw new Error("Command Code turns require a text prompt in v1");
        const turnId = method === "turn/steer" && state.activeTurnId
          ? state.activeTurnId
          : typeof p.turnId === "string" ? p.turnId : randomUUID();
        // A station switch applies from the next spawned process.
        const upstream = this.pendingUpstream.get(threadId) ?? this.defaultUpstream;
        if (upstream) {
          state.providerId = upstream.providerId;
          if (!state.model || upstream.model) state.model = upstream.model;
        }
        const userItem = {
          type: "userMessage",
          id: `command-code-${turnId}-user`,
          turnId,
          threadId,
          content: [{ type: "text", text }],
          status: "completed",
        } as unknown as JsonValue;
        state.messages.push(userItem);
        this.emit("message", {
          method: "item/completed",
          params: { threadId, turnId, item: userItem },
        } as JsonRpcMessage);
        if (method === "turn/start") {
          state.activeTurnId = turnId;
          state.streamedText = "";
          state.itemStarted = false;
          state.interrupting = false;
          state.turns.push({ id: turnId, threadId, status: "inProgress", items: [] } as Record<string, JsonValue>);
        }
        this.spawnTurn(state, text);
        return { turn: { id: turnId, threadId, status: "inProgress" } } as JsonValue;
      }

      case "turn/interrupt": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const state = this.sessions.get(threadId);
        if (state?.child) {
          state.interrupting = true;
          try { state.child.kill("SIGINT"); } catch { /* noop */ }
          const child = state.child;
          setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } }, 3_000).unref?.();
        }
        return {} as JsonValue;
      }

      case "thread/delete":
      case "thread/archive":
      case "thread/closed":
      case "thread/unsubscribe": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        if (threadId) {
          const state = this.sessions.get(threadId);
          if (state?.child) { try { state.child.kill("SIGKILL"); } catch { /* noop */ } }
          if (method === "thread/delete") {
            if (state?.sessionId) this.deleteTranscript(state.sessionId);
            this.deleteMapping(threadId);
          }
          this.sessions.delete(threadId);
        }
        return {} as JsonValue;
      }

      case "thread/fork":
        throw new Error("Command Code backend does not support thread/fork");

      default:
        return {} as JsonValue;
    }
  }

  // -- per-turn process -----------------------------------------------------

  private spawnTurn(state: CommandCodeSessionState, text: string): void {
    const bin = findCommandCodeBin(this.runtimeEnv());
    if (!bin) {
      this.finishTurn(state, "failed", state.streamedText, undefined, "command-code binary not found");
      return;
    }
    const args = [
      "-p", text,
      "--output-format", "json",
      "--local-only",
      "--skip-onboarding",
      "-t",
      "--yolo",
      "--add-dir", state.cwd ?? process.cwd(),
    ];
    if (state.providerId && state.model) args.push("-m", `${state.providerId}/${state.model}`);
    else if (state.model) args.push("-m", state.model);
    if (state.sessionId) args.push("--resume", state.sessionId);
    const env: NodeJS.ProcessEnv = {
      ...this.runtimeEnv(),
      HOME: this.homeDir,
      COMMAND_CODE_API_KEY: COMMAND_CODE_LOCAL_API_KEY_PLACEHOLDER,
      [COMMAND_CODE_RELAY_KEY_ENV]: COMMAND_CODE_RELAY_KEY_PLACEHOLDER,
      CMD_LOCAL_ONLY: "1",
    };
    const child = spawnCli(bin, args, { cwd: state.cwd ?? process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    state.child = child;
    let stdoutBuffer = "";
    let stderrTail = "";
    let sawResultLine = false;
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          const terminal = this.handleFrame(state, line);
          if (terminal) sawResultLine = true;
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000);
      this.emit("stderr", text);
    });
    child.on("error", (error) => {
      if (state.activeTurnId) this.finishTurn(state, "failed", state.streamedText, undefined, error.message);
    });
    child.on("close", (code) => {
      state.child = null;
      if (!state.activeTurnId) return;
      if (state.interrupting) {
        this.finishTurn(state, "interrupted", state.streamedText, undefined);
      } else if (!sawResultLine) {
        const detail = stderrTail.trim().split("\n").at(-1) ?? "";
        this.finishTurn(state, "failed", state.streamedText, undefined,
          `command-code exited with code ${code ?? "?"}${detail ? `: ${detail}` : ""}`);
      }
    });
  }

  /** Log an unrecognized NDJSON frame type once, with top-level key names
   *  (never values) so the real shape can be mapped without guessing. */
  private logUnknownFrameType(state: CommandCodeSessionState, frameType: string, event?: Record<string, JsonValue>): void {
    void state;
    const key = frameType || "unknown";
    if (this.loggedFrameTypes.has(key)) return;
    this.loggedFrameTypes.add(key);
    let keys = "";
    try {
      keys = ` keys=[${Object.keys(event ?? {}).join(",")}]`;
    } catch { /* ignore */ }
    console.info(`[command-code] unhandled NDJSON frame type: ${key}${keys}`);
  }

  /**
   * Close the turn's open text segment (if any) so a tool card inserted now
   * keeps dialogue/tool/dialogue order. Later deltas open a fresh segment.
   */
  private closeOpenTextSegment(state: CommandCodeSessionState): void {
    const turnId = state.activeTurnId;
    const itemId = state.activeItemId;
    if (!turnId || !itemId) return;
    const text = state.streamedText;
    const threadId = state.threadId;
    state.activeItemId = undefined;
    state.streamedText = "";
    state.itemStarted = false;
    if (!text) return;
    const item = {
      type: "agentMessage",
      id: itemId,
      turnId,
      threadId,
      content: text,
      role: "assistant",
      status: "completed",
    } as unknown as JsonValue;
    const idx = state.messages.findIndex((entry) => {
      const record = recordOf(entry);
      return record.type === "agentMessage" && record.id === itemId;
    });
    if (idx >= 0) state.messages[idx] = item;
    else state.messages.push(item);
    this.emit("message", {
      method: "item/completed",
      params: { threadId, turnId, item },
    } as JsonRpcMessage);
  }

  /** Returns true when the frame was the terminal result line. */
  private handleFrame(state: CommandCodeSessionState, line: string): boolean {    let frame: Record<string, JsonValue>;
    try {
      frame = JSON.parse(line) as Record<string, JsonValue>;
    } catch {
      return false;
    }
    // Diagnostic frame log (local disk): streamed text chunks log a length
    // only, everything else logs the full frame (64KB cap).
    const eventType = typeof recordOf(frame.event).type === "string" ? String(recordOf(frame.event).type) : "";
    const streamedText = eventType === "text_delta" || eventType === "thinking_delta" || eventType === "message_update"
      ? (recordOf(frame.event).delta ?? recordOf(frame.event).text ?? recordOf(frame.event).content)
      : undefined;
    if (frame.type === "text_delta" || streamedText !== undefined) {
      const text = streamedText ?? recordOf(frame.event).delta ?? frame.delta;
      this.eventLog.append({
        kind: "frame", frame: eventType || (typeof frame.type === "string" ? frame.type : "unknown"),
        deltaLen: typeof text === "string" ? text.length : 0,
      });
    } else if (frame.type === "event") {
      this.eventLog.append({ kind: "frame", frame: eventType || "unknown", event: recordOf(frame.event) });
    } else {
      this.eventLog.append({ kind: "frame", frame: typeof frame.type === "string" ? frame.type : "unknown", event: frame });
    }
    const threadId = state.threadId;
    if (frame.type === "result") {
      const usage = recordOf(frame.usage);
      if (frame.subtype === "success") {
        const finalText = typeof frame.finalText === "string" ? frame.finalText : state.streamedText;
        this.finishTurn(state, "completed", finalText, usage);
      } else {
        const message = typeof frame.error === "string" ? frame.error : "Command Code run failed";
        this.finishTurn(state, "failed", state.streamedText, usage, message);
      }
      return true;
    }
    if (frame.type !== "event") return false;
    const event = recordOf(frame.event);
    switch (event.type) {
      case "run_start": {
        if (typeof event.sessionId === "string" && event.sessionId !== state.sessionId) {
          state.sessionId = event.sessionId;
          this.writeMapping(threadId, { sessionId: event.sessionId });
        }
        return false;
      }
      case "text_delta": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (!delta || !state.activeTurnId) return false;
        if (!state.activeItemId) {
          state.textSegIndex = (state.textSegIndex ?? 0) + 1;
          state.activeItemId = `command-code-${state.activeTurnId}-text-${state.textSegIndex}`;
        }
        state.streamedText += delta;
        if (!state.itemStarted) {
          state.itemStarted = true;
          const textItem = { type: "agentMessage", id: state.activeItemId, turnId: state.activeTurnId, threadId, status: "inProgress" };
          // Hold the text row's position among tool cards from the start;
          // the completed flush upserts this same id instead of appending.
          state.messages.push(textItem as unknown as JsonValue);
          this.emit("message", {
            method: "item/started",
            params: {
              threadId,
              turnId: state.activeTurnId,
              item: textItem,
            },
          } as JsonRpcMessage);
        }
        this.emit("message", {
          method: "item/agentMessage/delta",
          params: { threadId, turnId: state.activeTurnId, itemId: state.activeItemId, delta },
        } as JsonRpcMessage);
        return false;
      }
      // Stream frame vocabulary reverse-engineered from the installed CLI
      // (dist/cli.mjs `tool_queued|running|update|completed|errored|denied|
      // hook_blocked` mapping table): start/progress frames carry
      // {toolCallId, toolName, input}; result frames carry {toolCallId,
      // result|error|hookOutput}. `tool_use`/`tool_result` are transcript
      // block types, kept as aliases.
      case "tool_use":
      case "tool_queued":
      case "tool_running": {
        if (!state.activeTurnId) return false;
        // A tool starting mid-text ends the current text segment first so
        // the transcript keeps dialogue/tool/dialogue order.
        this.closeOpenTextSegment(state);
        const toolId = typeof event.toolCallId === "string" && event.toolCallId ? event.toolCallId
          : typeof event.id === "string" ? event.id
          : typeof event.toolUseId === "string" ? event.toolUseId
          : typeof event.tool_id === "string" ? event.tool_id : "";
        if (!toolId) return false;
        // Progress frames (tool_running) carry no input: merge with the
        // queued card instead of overwriting its args with {}.
        const prior = state.messages.map((entry) => recordOf(entry)).find((entry) => entry.id === toolId && entry.type === "toolCall") ?? {};
        const toolName = typeof event.toolName === "string" && event.toolName ? event.toolName
          : typeof event.name === "string" && event.name ? event.name
          : typeof event.title === "string" && event.title ? event.title
          : typeof prior.toolName === "string" ? prior.toolName : "Tool";
        const frameArgs = recordOf(event.input ?? event.arguments ?? (event as Record<string, JsonValue>).args);
        const toolArgs = Object.keys(frameArgs).length > 0 ? frameArgs : recordOf((prior as Record<string, JsonValue>).input ?? (prior as Record<string, JsonValue>).arguments);
        const item = isCommandCodeTaskTool(toolName)
          ? buildCommandCodeCollabItem(threadId, state.activeTurnId, toolId, toolName, toolArgs, "inProgress")
          : {
            type: "toolCall",
            id: toolId,
            turnId: state.activeTurnId,
            threadId,
            name: toolName,
            tool: toolName,
            toolName,
            input: toolArgs,
            arguments: toolArgs,
            status: "inProgress",
          } as unknown as JsonValue;
        upsertCommandCodeItem(state, item);
        this.emit("message", {
          method: "item/started",
          params: { threadId, turnId: state.activeTurnId, item },
        } as JsonRpcMessage);
        return false;
      }
      case "tool_result":
      case "tool_completed":
      case "tool_denied":
      case "tool_errored":
      case "tool_hook_blocked":
      case "tool_update": {
        if (!state.activeTurnId) return false;
        const toolId = typeof event.toolCallId === "string" && event.toolCallId ? event.toolCallId
          : typeof event.id === "string" ? event.id
          : typeof event.toolUseId === "string" ? event.toolUseId
          : typeof event.tool_id === "string" ? event.tool_id : "";
        if (!toolId) return false;
        const updateStatus = typeof event.status === "string" ? event.status.toLowerCase()
          : typeof event.state === "string" ? event.state.toLowerCase() : "";
        // tool_update is a progress frame unless it carries an explicit
        // terminal marker; the queued/running names above never complete.
        const terminal = event.type !== "tool_update"
          || updateStatus === "completed" || updateStatus === "failed" || updateStatus === "done"
          || updateStatus === "error" || updateStatus === "errored" || updateStatus === "denied"
          || event.done === true || event.is_error === true;
        const failed = event.type === "tool_denied" || event.type === "tool_errored" || event.type === "tool_hook_blocked"
          || updateStatus === "failed" || updateStatus === "error" || updateStatus === "errored" || updateStatus === "denied"
          || event.is_error === true;
        // Carry the started card's name/args forward: result frames usually
        // carry only the id, and a bare "Tool" + {} row renders hollow.
        const started = state.messages.map((entry) => recordOf(entry)).find((entry) => entry.id === toolId && entry.type === "toolCall") ?? {};
        const hookNote = event.type === "tool_hook_blocked" && typeof event.hookOutput === "string" && event.hookOutput
          ? `Blocked by a hook: ${event.hookOutput}` : "";
        const deniedNote = event.type === "tool_denied" ? "Permission denied by the user." : "";
        const rawOutput = (hookNote || deniedNote) || (event.result ?? event.output ?? event.text ?? event.content ?? event.error ?? "");
        const outputText = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
        const nameFromEvent = typeof event.toolName === "string" && event.toolName ? event.toolName
          : typeof event.name === "string" && event.name ? event.name
          : typeof event.title === "string" && event.title ? event.title : undefined;
        const resolvedName = nameFromEvent ?? (typeof started.name === "string" ? started.name : "Tool");
        const resolvedInput = recordOf((started as Record<string, JsonValue>).input ?? (started as Record<string, JsonValue>).arguments ?? event.input ?? event.arguments);
        const resolvedArgs = recordOf((started as Record<string, JsonValue>).arguments ?? (started as Record<string, JsonValue>).input ?? event.input ?? event.arguments);
        const item = isCommandCodeTaskTool(resolvedName)
          ? buildCommandCodeCollabItem(threadId, state.activeTurnId, toolId, resolvedName, resolvedArgs,
            terminal ? (failed ? "failed" : "completed") : "inProgress",
            outputText || undefined)
          : {
            type: "toolCall",
            id: toolId,
            turnId: state.activeTurnId,
            threadId,
            name: resolvedName,
            tool: typeof started.tool === "string" ? started.tool : nameFromEvent,
            toolName: resolvedName,
            input: resolvedInput,
            arguments: resolvedArgs,
            ...(outputText ? { output: outputText.slice(0, 4000), result: { content: outputText.slice(0, 4000) } } : {}),
            status: terminal ? (failed ? "failed" : "completed") : "inProgress",
          } as unknown as JsonValue;
        upsertCommandCodeItem(state, item);
        this.emit("message", {
          method: terminal ? "item/completed" : "item/started",
          params: { threadId, turnId: state.activeTurnId, item },
        } as JsonRpcMessage);
        return false;
      }
      default:
        this.logUnknownFrameType(state, String((event as Record<string, JsonValue>).type ?? "unknown"), event as Record<string, JsonValue>);
        return false;
    }
  }

  private finishTurn(
    state: CommandCodeSessionState,
    status: "completed" | "failed" | "interrupted",
    finalText: string,
    usage?: Record<string, JsonValue>,
    errorMessage?: string,
  ): void {
    const turnId = state.activeTurnId;
    if (!turnId) return;
    state.activeTurnId = undefined;
    const threadId = state.threadId;
    if (finalText) {
      const itemId = state.activeItemId ?? `command-code-${turnId}-text`;
      const item = {
        type: "agentMessage",
        id: itemId,
        turnId,
        threadId,
        content: finalText,
        role: "assistant",
        status: "completed",
      } as unknown as JsonValue;
      this.emit("message", {
        method: "item/completed",
        params: { threadId, turnId, item },
      } as JsonRpcMessage);
      // Upsert: the live item/started already holds this row's position
      // among the turn's tool cards; pushing would sink the text below them.
      // When segments already carry this turn's text, the terminal full text
      // would double-display it, so only fill the gap when no text row
      // exists yet for the turn.
      const idx = state.messages.findIndex((entry) => {
        const record = recordOf(entry);
        return record.type === "agentMessage" && record.id === itemId;
      });
      if (idx >= 0) {
        state.messages[idx] = item;
      } else {
        const hasText = state.messages.some((entry) => {
          const record = recordOf(entry);
          return record.type === "agentMessage" && record.turnId === turnId;
        });
        if (!hasText) state.messages.push(item);
      }
    }
    state.activeItemId = undefined;
    state.streamedText = "";
    state.itemStarted = false;
    state.interrupting = false;
    const turn = state.turns.find((entry) => entry.id === turnId);
    if (turn) turn.status = status;
    if (usage) {
      const promptTokens = numberOf(usage.inputTokens);
      const completionTokens = numberOf(usage.outputTokens);
      if (promptTokens !== undefined || completionTokens !== undefined) {
        this.emit("message", {
          method: "thread/tokenUsage/requestUpdated",
          params: {
            threadId,
            turnId,
            requestId: `command-code-turn-${turnId}`,
            usage: {
              prompt_tokens: promptTokens ?? 0,
              completion_tokens: completionTokens ?? 0,
              total_tokens: (promptTokens ?? 0) + (completionTokens ?? 0),
              ...(numberOf(usage.cacheReadTokens) !== undefined
                ? { prompt_tokens_details: { cached_tokens: numberOf(usage.cacheReadTokens) } }
                : {}),
            },
          },
        } as JsonRpcMessage);
      }
    }
    if (status === "failed") {
      this.emit("message", {
        method: "turn/failed",
        params: {
          threadId,
          turnId,
          turn: { id: turnId, threadId, status: "failed" },
          error: errorMessage ?? "Command Code run failed",
        },
      } as JsonRpcMessage);
    } else {
      this.emit("message", {
        method: "turn/completed",
        params: {
          threadId,
          turnId,
          turn: { id: turnId, threadId, status, completedAt: Math.floor(Date.now() / 1000) },
        },
      } as JsonRpcMessage);
    }
  }

  // -- history --------------------------------------------------------------

  private restoreSession(threadId: string): CommandCodeSessionState | null {
    const existing = this.sessions.get(threadId);
    if (existing) return existing;
    const mapping = this.readMappings()[threadId];
    if (!mapping) return null;
    const state: CommandCodeSessionState = {
      threadId,
      sessionId: mapping.sessionId,
      cwd: mapping.cwd,
      model: mapping.model,
      providerId: mapping.providerId,
      createdAt: mapping.createdAt ?? Date.now(),
      streamedText: "",
      itemStarted: false,
      textSegIndex: 0,
      interrupting: false,
      child: null,
      turns: [],
      messages: [],
    };
    if (mapping.sessionId) {
      const history = this.readTranscript(mapping.sessionId, threadId);
      state.messages = history;
      state.turns = buildTurnsFromItems(history);
    }
    this.sessions.set(threadId, state);
    return state;
  }

  private transcriptPath(sessionId: string): string | null {
    const projectsDir = commandCodeProjectsDir(this.homeDir);
    try {
      for (const slug of readdirSync(projectsDir)) {
        const candidate = join(projectsDir, slug, `${sessionId}.jsonl`);
        if (existsSync(candidate)) return candidate;
      }
    } catch { /* no projects yet */ }
    return null;
  }

  private readTranscript(sessionId: string, threadId?: string): JsonValue[] {
    const path = this.transcriptPath(sessionId);
    if (!path) return [];
    const items: JsonValue[] = [];
    try {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const entry = recordOf(JSON.parse(line) as JsonValue);
        if (entry.type !== "message") continue;
        const message = recordOf(entry.message);
        const role = typeof message.role === "string" ? message.role : "";
        const content = Array.isArray(message.content) ? message.content : [];
        for (const part of content) {
          const block = recordOf(part);
          if (block.type === "text" && typeof block.text === "string" && block.text) {
            items.push((role === "user"
              ? { type: "userMessage", id: `${sessionId}-${String(entry.id ?? randomUUID())}`, content: [{ type: "text", text: block.text }], status: "completed" }
              : { type: "agentMessage", id: `${sessionId}-${String(entry.id ?? randomUUID())}`, content: block.text, role: "assistant", status: "completed" }) as unknown as JsonValue);
          } else if (block.type === "tool_use" && typeof block.id === "string") {
            const toolName = typeof block.name === "string" && block.name ? block.name : "Tool";
            const toolArgs = recordOf(block.input ?? block.arguments);
            items.push((isCommandCodeTaskTool(toolName)
              ? buildCommandCodeCollabItem(threadId ?? "", undefined, block.id, toolName, toolArgs, "completed")
              : {
                type: "toolCall",
                id: block.id,
                name: toolName,
                tool: toolName,
                toolName,
                input: toolArgs,
                arguments: toolArgs,
                status: "completed",
              }) as unknown as JsonValue);
          } else if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
            const rawOutput = block.content ?? block.output ?? block.text ?? "";
            const outputText = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
            const prior = items.map((entry) => recordOf(entry)).find((entry) => entry.type === "toolCall" && entry.id === block.tool_use_id);
            if (prior) {
              if (outputText) {
                prior.output = outputText.slice(0, 4000);
                const res = recordOf(prior.result);
                res.content = outputText.slice(0, 4000);
                prior.result = res;
              }
            } else if (outputText) {
              items.push({
                type: "toolCall",
                id: block.tool_use_id,
                name: "Tool",
                toolName: "Tool",
                input: {},
                arguments: {},
                output: outputText.slice(0, 4000),
                result: { content: outputText.slice(0, 4000) },
                status: block.is_error ? "failed" : "completed",
              } as unknown as JsonValue);
            }
          }
        }
      }
    } catch { /* unreadable transcript -> empty history */ }
    return items;
  }

  private deleteTranscript(sessionId: string): void {
    const path = this.transcriptPath(sessionId);
    if (!path) return;
    for (const suffix of [".jsonl", ".checkpoints.jsonl", ".meta.json"]) {
      try { rmSync(path.replace(/\.jsonl$/, suffix), { force: true }); } catch { /* best effort */ }
    }
  }

  private listThreads(): JsonValue[] {
    const mappings = this.readMappings();
    const threads: JsonValue[] = [];
    const seen = new Set<string>();
    for (const [threadId, mapping] of Object.entries(mappings)) {
      seen.add(threadId);
      const live = this.sessions.get(threadId);
      threads.push({
        id: threadId,
        preview: live?.messages.find((entry) => recordOf(entry).type === "userMessage") ? previewOf(live!.messages) : undefined,
        model: mapping.model,
        cliBackend: "command-code",
        status: { type: "idle" },
        cwd: mapping.cwd,
        createdAt: Math.floor((mapping.createdAt ?? Date.now()) / 1000),
        updatedAt: Math.floor((mapping.createdAt ?? Date.now()) / 1000),
        recencyAt: Math.floor((mapping.createdAt ?? Date.now()) / 1000),
        source: "appServer",
        turns: [],
      } as unknown as JsonValue);
    }
    // Transcripts without a mapping (created before the store existed or
    // by hand) still list, keyed by their CLI session id.
    try {
      const projectsDir = commandCodeProjectsDir(this.homeDir);
      for (const slug of readdirSync(projectsDir)) {
        for (const file of readdirSync(join(projectsDir, slug))) {
          if (!file.endsWith(".jsonl") || file.includes(".checkpoints")) continue;
          const sessionId = file.replace(/\.jsonl$/, "");
          if ([...Object.values(mappings)].some((mapping) => mapping.sessionId === sessionId)) continue;
          if (seen.has(sessionId)) continue;
          seen.add(sessionId);
          const firstLine = readFileSync(join(projectsDir, slug, file), "utf8").split("\n")[0] ?? "{}";
          const session = recordOf(JSON.parse(firstLine) as JsonValue);
          const created = typeof session.timestamp === "string" ? Date.parse(session.timestamp) : Date.now();
          threads.push({
            id: sessionId,
            model: undefined,
            cliBackend: "command-code",
            status: { type: "idle" },
            cwd: typeof session.cwd === "string" ? session.cwd : undefined,
            createdAt: Math.floor(created / 1000),
            updatedAt: Math.floor(created / 1000),
            recencyAt: Math.floor(created / 1000),
            source: "appServer",
            turns: [],
          } as unknown as JsonValue);
        }
      }
    } catch { /* no transcripts yet */ }
    return threads;
  }
}

/**
 * Task/subagent tool discriminator (the CLI names agent entries "Task",
 * verified in dist stream-entry builders). Task calls project as
 * collabAgentToolCall so the waterfall renders ManageTask and the agent
 * rail converges them.
 */
export function isCommandCodeTaskTool(name: unknown): boolean {
  const trimmed = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (!trimmed) return false;
  const bare = trimmed.split(/[/:._-]{1,2}/).pop() ?? trimmed;
  const compact = bare.replace(/[_-]+/g, "");
  return compact === "task" || compact === "spawnsubagent";
}

/** Best-effort task brief out of a task tool's input (key names vary). */
function commandCodeTaskPrompt(input: Record<string, JsonValue>): string {
  for (const key of ["description", "task", "message", "prompt", "instruction", "goal"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 4000);
  }
  return "";
}

/** Agent role label for a task tool call. */
function commandCodeTaskRole(input: Record<string, JsonValue>, fallbackName: string): string {
  for (const key of ["subagent_type", "agent", "agentName", "mode"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
  }
  return fallbackName && fallbackName !== "Tool" ? fallbackName : "subagent";
}

/** Collab item for a task tool call (shared by live frames + transcript). */
function buildCommandCodeCollabItem(
  threadId: string,
  turnId: string | undefined,
  toolId: string,
  name: string,
  input: Record<string, JsonValue>,
  status: "inProgress" | "completed" | "failed",
  outputText?: string,
): Record<string, JsonValue> {
  const prompt = commandCodeTaskPrompt(input);
  const agentRole = commandCodeTaskRole(input, name);
  return {
    type: "collabAgentToolCall",
    id: toolId,
    ...(turnId ? { turnId } : {}),
    threadId,
    name,
    tool: "task",
    toolName: name,
    agentId: toolId,
    agentName: agentRole,
    agentRole,
    taskName: agentRole,
    ...(prompt ? { prompt, message: prompt } : {}),
    senderThreadId: threadId,
    receiverThreadIds: [],
    agentStatus: status === "inProgress" ? "running" : status,
    input,
    arguments: input,
    ...(outputText ? { output: outputText.slice(0, 4000), result: { content: outputText.slice(0, 4000) } } : {}),
    status,
  };
}

function previewOf(messages: JsonValue[]): string | undefined {  for (const entry of messages) {
    const item = recordOf(entry);
    if (item.type !== "userMessage") continue;
    const content = Array.isArray(item.content) ? item.content : [];
    const first = content.map((part) => recordOf(part)).find((part) => typeof part.text === "string");
    if (first) return String(first.text).slice(0, 120);
  }
  return undefined;
}

/** Insert or replace a toolCall card by id so turns and history stay in sync. */
function upsertCommandCodeItem(state: CommandCodeSessionState, item: JsonValue): void {
  const id = recordOf(item).id;
  const idx = state.messages.findIndex((entry) => {
    const record = recordOf(entry);
    return record.type === "toolCall" && record.id === id;
  });
  if (idx >= 0) state.messages[idx] = item;
  else state.messages.push(item);
}

function recordOf(value: unknown): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractTurnText(p: Record<string, JsonValue>): string {
  if (typeof p.prompt === "string" && p.prompt.trim()) return p.prompt;
  if (typeof p.text === "string" && p.text.trim()) return p.text;
  const input = p.input;
  if (typeof input === "string" && input.trim()) return input;
  if (Array.isArray(input)) {
    const parts: string[] = [];
    for (const entry of input) {
      if (typeof entry === "string") parts.push(entry);
      else {
        const item = recordOf(entry);
        if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
      }
    }
    return parts.join("\n").trim();
  }
  return "";
}

function buildTurnsFromItems(items: JsonValue[]): Array<Record<string, JsonValue>> {
  const turns: Array<Record<string, JsonValue>> = [];
  let current: Record<string, JsonValue> | null = null;
  for (const item of items) {
    const record = recordOf(item);
    if (record.type === "userMessage") {
      current = { id: randomUUID(), status: "completed", items: [item] } as Record<string, JsonValue>;
      turns.push(current);
    } else if (current) {
      (current.items as JsonValue[]).push(item);
    }
  }
  return turns;
}
