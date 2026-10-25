export type OpencodeToolStatePending = {
  status: "pending";
  input?: unknown;
};

export type OpencodeToolStateRunning = {
  status: "running";
  input?: unknown;
  time?: { start: number };
};

export type OpencodeToolStateCompleted = {
  status: "completed";
  input?: unknown;
  output: string;
  title?: string;
  time?: { start: number; end: number };
};

export type OpencodeToolStateError = {
  status: "error";
  input?: unknown;
  error: string;
  time?: { start: number; end: number };
};

export type OpencodeToolState =
  | OpencodeToolStatePending
  | OpencodeToolStateRunning
  | OpencodeToolStateCompleted
  | OpencodeToolStateError;

export interface OpencodeTextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  time?: { start: number; end?: number };
}

export interface OpencodeReasoningPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;
  time?: { start: number; end?: number };
}

export interface OpencodeToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state: OpencodeToolState;
  metadata?: Record<string, unknown>;
}

export interface OpencodeStepStartPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-start";
  snapshot?: string;
}

export interface OpencodeStepFinishPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason?: string;
  cost?: number;
  tokens?: {
    total?: number;
    input: number;
    output: number;
    reasoning?: number;
    cache?: {
      read?: number;
      write?: number;
    };
  };
}

export type OpencodePart =
  | OpencodeTextPart
  | OpencodeReasoningPart
  | OpencodeToolPart
  | OpencodeStepStartPart
  | OpencodeStepFinishPart
  | { id: string; sessionID: string; messageID: string; type: string; [key: string]: unknown };

export interface OpencodePermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  always?: string[];
  metadata?: Record<string, unknown>;
  tool?: {
    messageID: string;
    callID: string;
  };
}

export interface OpencodePermissionAskedEvent {
  id: string;
  type: "permission.asked";
  properties: OpencodePermissionRequest;
}

export interface OpencodePermissionRepliedEvent {
  id: string;
  type: "permission.replied";
  properties: {
    sessionID: string;
    requestID: string;
    reply: "once" | "always" | "reject";
  };
}

export interface OpencodeQuestionOption {
  label: string;
  description: string;
}

export interface OpencodeQuestionInfo {
  question: string;
  header: string;
  options: OpencodeQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface OpencodeQuestionAskedEvent {
  id: string;
  type: "question.asked";
  properties: {
    id: string;
    sessionID: string;
    questions: OpencodeQuestionInfo[];
    tool?: {
      messageID: string;
      callID: string;
    };
  };
}

export interface OpencodeQuestionRepliedEvent {
  id: string;
  type: "question.replied";
  properties: {
    sessionID: string;
    requestID: string;
    answers: string[][];
  };
}

export interface OpencodeQuestionRejectedEvent {
  id: string;
  type: "question.rejected";
  properties: {
    sessionID: string;
    requestID: string;
  };
}

export interface OpencodeTodoInfo {
  content: string;
  status: string;
  priority: string;
}

export interface OpencodeTodoUpdatedEvent {
  id: string;
  type: "todo.updated";
  properties: {
    sessionID: string;
    todos: OpencodeTodoInfo[];
  };
}

export interface OpencodeMessagePartUpdatedEvent {
  id: string;
  type: "message.part.updated";
  properties: {
    sessionID: string;
    part: OpencodePart;
    time?: number;
  };
}

export interface OpencodeMessagePartDeltaEvent {
  id: string;
  type: "message.part.delta";
  properties: {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  };
}

export interface OpencodeSessionIdleEvent {
  id: string;
  type: "session.idle";
  properties: {
    sessionID: string;
  };
}

export interface OpencodeSessionStatusEvent {
  id: string;
  type: "session.status";
  properties: {
    sessionID: string;
    status: { type: "idle" | "busy" | "retry"; attempt?: number; message?: string };
  };
}

export interface OpencodeSessionErrorEvent {
  id: string;
  type: "session.error";
  properties: {
    sessionID?: string;
    error?: {
      message?: string;
      name?: string;
      data?: unknown;
    };
  };
}

export interface OpencodeSessionCompactedEvent {
  id: string;
  type: "session.compacted";
  properties: {
    sessionID: string;
  };
}

export type OpencodeSseEvent =
  | { id: string; type: "server.connected"; properties?: unknown }
  | { id: string; type: "server.heartbeat"; properties?: unknown }
  | OpencodeMessagePartUpdatedEvent
  | OpencodeMessagePartDeltaEvent
  | OpencodeSessionIdleEvent
  | OpencodeSessionStatusEvent
  | OpencodeSessionErrorEvent
  | OpencodePermissionAskedEvent
  | OpencodePermissionRepliedEvent
  | OpencodeQuestionAskedEvent
  | OpencodeQuestionRepliedEvent
  | OpencodeQuestionRejectedEvent
  | OpencodeTodoUpdatedEvent
  | OpencodeSessionCompactedEvent
  | { id: string; type: string; properties?: unknown };

export interface OpencodeCreateSessionPayload {
  title?: string;
  directory?: string;
  permission?: unknown;
}

export interface OpencodeSessionInfo {
  id: string;
  title?: string;
  directory?: string;
  time?: { created: number; updated: number };
}

export interface OpencodePromptPayload {
  parts: Array<{ type: "text"; text: string }>;
  model?: { providerID: string; modelID: string };
  agent?: string;
}

export interface OpencodeSummarizePayload {
  providerID?: string;
  modelID?: string;
  auto?: boolean;
}

export interface OpencodePermissionReplyPayload {
  reply: "once" | "always" | "reject";
  message?: string;
}

/**
 * Parse an SSE data buffer into OpencodeSseEvent objects.
 */
export function parseOpencodeSseChunk(chunk: string): OpencodeSseEvent[] {
  const events: OpencodeSseEvent[] = [];
  const lines = chunk.split(/\r?\n/);
  let currentData = "";

  for (const line of lines) {
    if (line.startsWith("data:")) {
      currentData += line.slice(5).trim();
    } else if (line.trim() === "" && currentData) {
      try {
        const parsed = JSON.parse(currentData);
        if (parsed && typeof parsed.type === "string") {
          events.push(parsed as OpencodeSseEvent);
        }
      } catch {}
      currentData = "";
    }
  }

  if (currentData) {
    try {
      const parsed = JSON.parse(currentData);
      if (parsed && typeof parsed.type === "string") {
        events.push(parsed as OpencodeSseEvent);
      }
    } catch {}
  }

  return events;
}

/** Split complete SSE records while retaining an incomplete trailing record. */
export function splitOpencodeSseRecords(buffer: string): { records: string[]; remainder: string } {
  const records: string[] = [];
  let remainder = buffer;
  let boundary: RegExpMatchArray | null;
  while ((boundary = /\r?\n\r?\n/.exec(remainder)) !== null) {
    const index = boundary.index ?? 0;
    records.push(remainder.slice(0, index));
    remainder = remainder.slice(index + boundary[0].length);
  }
  return { records, remainder };
}
