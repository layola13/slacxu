// For learning and research only. Other uses are at your own risk.
//
// ACP (Agent Client Protocol) NDJSON framing for the auggie (Augment Code)
// stdio backend (`auggie --acp`). Auggie speaks JSON-RPC 2.0 over newline-
// delimited JSON on stdio, the same envelope shape grok uses, but the method
// set, approval direction, and interrupt method are different (see
// docs/auggie-embedded-backend-plan.md §6.1). This module borrows ONLY the
// envelope interface and `parseLine` splitter from grokAcpProtocol; every
// builder and auggie-specific event shape is new because reusing grok's
// `buildControlResponse` / `buildInterrupt` / `AcpControlRequestEvent` would
// emit `session/control`, which auggie answers with `MethodNotFound`.
//
// The live-confirmed envelopes at §6.2 (probe script
// `scripts/probe-auggie-acp.mjs`, 2026-08-18) are the ground truth for the
// shapes below. Pure functions only; no runtime / IO.

/**
 * Shared JSON-RPC 2.0 envelope for auggie NDJSON frames. This is the ONLY
 * shape reused from grokAcpProtocol — both transports use newline-delimited
 * JSON-RPC 2.0, so the wire frame is identical. The divergence is in the
 * method strings, not the envelope.
 */
export interface AcpMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message: string; data?: unknown };
}

/**
 * Result returned by {@link parseLine}. A non-null value means the line was a
 * parseable JSON-RPC frame; the caller discriminates further via `method`.
 */
export type AcpEvent =
  | AcpMessage
  | AcpSessionUpdateEvent
  | AcpRequestPermissionEvent;

/**
 * `session/update` notification pushed by the agent. `sessionUpdate`
 * discriminates the payload kind — the two we translate today are
 * `agent_message_chunk` (streaming assistant text) and
 * `available_commands_update` (slash-command list). Other kinds (agent
 * lifecycle, tool progress, …) pass through untyped via `update`.
 *
 * Live envelope (§6.2b):
 *   {method:"session/update", params:{sessionId, update:{sessionUpdate, ...}}}
 */
export interface AcpSessionUpdateEvent {
  jsonrpc: "2.0";
  method: "session/update";
  params: {
    sessionId: string;
    update: {
      sessionUpdate: string;
      /** Present when `sessionUpdate === "agent_message_chunk"`. */
      content?: { type: string; text?: string; [key: string]: unknown };
      /** Present when `sessionUpdate === "available_commands_update"`. */
      availableCommands?: Array<{ name: string; description?: string; [key: string]: unknown }>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

/**
 * `session/request_permission` — a JSON-RPC **request** the agent sends TO the
 * host (client). Direction is reversed vs grok: grok's `control_request` is an
 * event with no id; auggie's is a request with an id the host must reply to
 * with a `result.outcome`. The host (this bridge) forwards it to the UI as a
 * Codex `item/*requestApproval` server request and, when the UI answers,
 * replies with {@link buildAuggiePermissionResult}.
 *
 * Live envelope (§6.2b):
 *   {method:"session/request_permission", id, params:{sessionId,
 *    toolCall:{toolCallId,title}, options:[{optionId,name,kind}]}}
 */
export interface AcpRequestPermissionEvent {
  jsonrpc: "2.0";
  id: number | string;
  method: "session/request_permission";
  params: {
    sessionId: string;
    toolCall: {
      toolCallId: string;
      title?: string;
      [key: string]: unknown;
    };
    options: Array<{
      optionId: string;
      name?: string;
      /** "allow_always" | "reject_always" | "allow_once" | "reject_once" */
      kind?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
}

/** Discriminated `sessionUpdate` values we recognise. */
export const AUGGIE_SESSION_UPDATE_AGENT_MESSAGE_CHUNK = "agent_message_chunk" as const;
export const AUGGIE_SESSION_UPDATE_AVAILABLE_COMMANDS = "available_commands_update" as const;

/** Auggie ACP method strings (§6.1). */
export const AUGGIE_METHOD = {
  initialize: "initialize",
  sessionNew: "session/new",
  sessionPrompt: "session/prompt",
  sessionCancel: "session/cancel",
  sessionRequestPermission: "session/request_permission",
  sessionUpdate: "session/update",
  sessionSetMode: "session/set_mode",
  sessionSetModel: "session/set_model",
  sessionList: "session/list",
  sessionLoad: "session/load",
  sessionFork: "session/fork",
  sessionResume: "session/resume",
  fsReadTextFile: "fs/read_text_file",
  fsWriteTextFile: "fs/write_text_file",
  terminalCreate: "terminal/create",
} as const;

/** Outcome of a permission decision, sent back as a JSON-RPC `result`. */
export type AuggiePermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export const auggieProtocol = {
  /**
   * Parse one NDJSON line from auggie stdout into an {@link AcpEvent}.
   * Returns `null` for blank lines or unparseable JSON so the caller can
   * skip without try/catch. This is the ONLY runtime piece; everything else
   * in the module is a pure builder.
   */
  parseLine(line: string): AcpEvent | null {
    const trimmed = line.trim();
    if (trimmed.length === 0) return null;
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (typeof obj !== "object" || obj === null) return null;
      return obj as AcpEvent;
    } catch {
      return null;
    }
  },

  /**
   * `initialize` request params (§6.2b). Auggie reports back
   * `{protocolVersion:1, agentCapabilities, agentInfo, authMethods:[]}`.
   */
  buildAuggieInitialize(): AcpMessage {
    return {
      jsonrpc: "2.0",
      method: AUGGIE_METHOD.initialize,
      params: {
        protocolVersion: 1,
        clientInfo: { name: "codex-react-ui", version: "0.1.0" },
        clientCapabilities: {},
      },
    } as AcpMessage;
  },

  /**
   * `session/new` request params. Result carries `{sessionId, modes, models}`
   * (§6.2b). We pass an empty `mcpServers` list — MCP servers are wired by
   * the routing layer / redirector, not by this bridge.
   */
  buildAuggieSessionNew(cwd: string): AcpMessage {
    return {
      jsonrpc: "2.0",
      method: AUGGIE_METHOD.sessionNew,
      params: { cwd, mcpServers: [] },
    } as AcpMessage;
  },

  /**
   * `session/prompt` request params. `prompt` is an array of content blocks
   * matching the live envelope `{type:"text",text}`; we accept a single
   * string for simplicity (multi-block composition belongs to the routing
   * layer).
   */
  buildAuggieSessionPrompt(sessionId: string, promptText: string): AcpMessage {
    return {
      jsonrpc: "2.0",
      method: AUGGIE_METHOD.sessionPrompt,
      params: { sessionId, prompt: [{ type: "text", text: promptText }] },
    } as AcpMessage;
  },

  /**
   * Interrupt envelope. Auggie's interrupt is the dedicated method
   * `session/cancel` — NOT grok's `session/control {subtype:"interrupt"}`
   * (§6.1). Emitting `session/control` here would raise `MethodNotFound`.
   */
  buildAuggieInterrupt(sessionId: string): AcpMessage {
    return {
      jsonrpc: "2.0",
      method: AUGGIE_METHOD.sessionCancel,
      params: { sessionId },
    } as AcpMessage;
  },

  /**
   * Reply to a `session/request_permission` request. The `id` must match the
   * request id the agent sent. `outcome.outcome:"selected"` carries the
   * chosen `optionId`; `outcome.outcome:"cancelled"` denies (§6.2b).
   */
  buildAuggiePermissionResult(
    id: number | string,
    outcome: AuggiePermissionOutcome,
  ): AcpMessage {
    return {
      jsonrpc: "2.0",
      id,
      result: { outcome },
    } as AcpMessage;
  },
};

// Named builder re-exports so callers can `import { buildAuggieInitialize }`
// without going through the `auggieProtocol` object. Both surfaces emit the
// exact same frame.
export const buildAuggieInitialize = (): AcpMessage => auggieProtocol.buildAuggieInitialize();
export const buildAuggieSessionNew = (cwd: string): AcpMessage => auggieProtocol.buildAuggieSessionNew(cwd);
export const buildAuggieSessionPrompt = (sessionId: string, promptText: string): AcpMessage =>
  auggieProtocol.buildAuggieSessionPrompt(sessionId, promptText);
export const buildAuggieInterrupt = (sessionId: string): AcpMessage => auggieProtocol.buildAuggieInterrupt(sessionId);
export const buildAuggiePermissionResult = (id: number | string, outcome: AuggiePermissionOutcome): AcpMessage =>
  auggieProtocol.buildAuggiePermissionResult(id, outcome);

/**
 * Type guard: is this `session/update` an `agent_message_chunk` carrying
 * streaming assistant text? Used by the bridge to route the delta to
 * `item/agentMessage/delta`.
 */
export function isAgentMessageChunk(
  event: AcpSessionUpdateEvent,
): boolean {
  return event.params.update.sessionUpdate === AUGGIE_SESSION_UPDATE_AGENT_MESSAGE_CHUNK;
}

/**
 * Type guard: is this `session/update` an `available_commands_update`? The
 * bridge currently logs these; future work may surface them in the composer.
 */
export function isAvailableCommandsUpdate(
  event: AcpSessionUpdateEvent,
): boolean {
  return event.params.update.sessionUpdate === AUGGIE_SESSION_UPDATE_AVAILABLE_COMMANDS;
}

/**
 * Narrow an {@link AcpEvent} to a {@link AcpSessionUpdateEvent}, or `null`.
 */
export function asSessionUpdate(event: AcpEvent | null): AcpSessionUpdateEvent | null {
  if (!event) return null;
  if (typeof event !== "object" || event === null) return null;
  const candidate = event as unknown as Record<string, unknown>;
  if (candidate.method !== AUGGIE_METHOD.sessionUpdate) return null;
  return event as AcpSessionUpdateEvent;
}

/**
 * Narrow an {@link AcpEvent} to a {@link AcpRequestPermissionEvent}, or
 * `null`. The presence of `id` (a JSON-RPC request, not a notification) is
 * what distinguishes this from a notification.
 */
export function asRequestPermission(event: AcpEvent | null): AcpRequestPermissionEvent | null {
  if (!event) return null;
  if (typeof event !== "object" || event === null) return null;
  const candidate = event as unknown as Record<string, unknown>;
  if (candidate.method !== AUGGIE_METHOD.sessionRequestPermission) return null;
  if (candidate.id === undefined) return null;
  return event as AcpRequestPermissionEvent;
}
