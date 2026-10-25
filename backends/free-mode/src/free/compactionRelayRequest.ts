import type { SaVmToolsConfig, ThreadRuntimeMetadata } from "@codex-ui/shared";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

type CompactionMetadata = {
  isCompaction: boolean;
  threadId: string | null;
  turnId: string | null;
};

function parseCompactionMetadata(value: unknown): CompactionMetadata {
  if (typeof value !== "string" && (!value || typeof value !== "object" || Array.isArray(value))) {
    return { isCompaction: false, threadId: null, turnId: null };
  }
  try {
    const metadata = asRecord(typeof value === "string" ? JSON.parse(value) : value);
    const threadId = typeof metadata.thread_id === "string" && metadata.thread_id.trim()
      ? metadata.thread_id.trim()
      : typeof metadata.session_id === "string" && metadata.session_id.trim()
        ? metadata.session_id.trim()
        : null;
    return {
      isCompaction: metadata.request_kind === "compaction" || Object.keys(asRecord(metadata.compaction)).length > 0,
      threadId,
      turnId: typeof metadata.turn_id === "string" && metadata.turn_id.trim() ? metadata.turn_id.trim() : null
    };
  } catch {
    return { isCompaction: false, threadId: null, turnId: null };
  }
}

export async function inspectCompactionRelayRequest(request: Request): Promise<CompactionMetadata> {
  const headerMetadata = parseCompactionMetadata(request.headers.get("x-codex-turn-metadata"));
  const headerThreadId = headerMetadata.threadId
    ?? request.headers.get("session-id")?.trim()
    ?? request.headers.get("thread-id")?.trim()
    ?? null;
  if (headerMetadata.isCompaction) return { ...headerMetadata, threadId: headerThreadId };
  const body = asRecord(await request.clone().json().catch(() => ({})));
  const bodyClientMetadata = asRecord(body.client_metadata);
  const bodyMetadata = parseCompactionMetadata(bodyClientMetadata["x-codex-turn-metadata"]);
  const nestedMetadata = parseCompactionMetadata(body.metadata ?? body["x-codex-turn-metadata"]);
  const directClientMetadataThreadId = typeof bodyClientMetadata.thread_id === "string" && bodyClientMetadata.thread_id.trim()
    ? bodyClientMetadata.thread_id.trim()
    : typeof bodyClientMetadata.threadId === "string" && bodyClientMetadata.threadId.trim()
      ? bodyClientMetadata.threadId.trim()
      : typeof bodyClientMetadata.session_id === "string" && bodyClientMetadata.session_id.trim()
        ? bodyClientMetadata.session_id.trim()
        : typeof bodyClientMetadata.sessionId === "string" && bodyClientMetadata.sessionId.trim()
          ? bodyClientMetadata.sessionId.trim()
          : null;
  const bodyThreadId = bodyMetadata.threadId
    ?? directClientMetadataThreadId
    ?? nestedMetadata.threadId
    ?? (typeof body.thread_id === "string" && body.thread_id.trim() ? body.thread_id.trim() : null)
    ?? (typeof body.threadId === "string" && body.threadId.trim() ? body.threadId.trim() : null)
    ?? (typeof body.session_id === "string" && body.session_id.trim() ? body.session_id.trim() : null)
    ?? (typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : null);
  const isCompaction = bodyMetadata.isCompaction || nestedMetadata.isCompaction
    || new URL(request.url).pathname.endsWith("/responses/compact")
    || (Array.isArray(body.input) && body.input.some((item) => asRecord(item).type === "compaction"));
  return {
    isCompaction,
    threadId: headerThreadId ?? bodyThreadId,
    turnId: headerMetadata.turnId ?? bodyMetadata.turnId ?? nestedMetadata.turnId
  };
}

export async function isCompactionRelayRequest(request: Request): Promise<boolean> {
  return (await inspectCompactionRelayRequest(request)).isCompaction;
}

export async function rewriteRelayRequestModel(request: Request, model: string): Promise<Request> {
  const body = asRecord(await request.clone().json().catch(() => ({})));
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  return new Request(request, {
    body: JSON.stringify({ ...body, model }),
    headers
  });
}

const SA_VM_BLOCKED_TOOL_NAMES = new Set([
  "exec_command",
  "write_stdin",
  "bash",
  "terminal",
  "execcommand",
  "commandexecution",
  "shellcommand",
  "shell_command",
  "node",
  "bun",
  "bunx",
  "deno",
  "ts-node",
  "tsx",
  "npx",
  "python",
  "python3",
  "py",
  "pypy",
  "run_js",
  "run_py",
  "exec_js",
  "exec_py",
  "run_node",
  "run_bun",
  "javascript",
  "powershell",
  "pwsh",
  "cmd",
  "sh",
  "shell"
]);

export function isSaVmBlockedToolName(name: string): boolean {
  if (!name || typeof name !== "string") return false;
  const normalized = name.trim().toLowerCase();
  const baseName = normalized.split(/[:/]/).pop() ?? normalized;
  return SA_VM_BLOCKED_TOOL_NAMES.has(normalized)
    || SA_VM_BLOCKED_TOOL_NAMES.has(baseName)
    || /(?:^|[._:/-])(bash|shell|exec|python(?:\d+(?:\.\d+)?)?|py|node(?:js)?|bun(?:x)?|deno|ts-node|tsx|npx|javascript|typescript|js|powershell|pwsh|cmd)(?:$|[._:/-])/i.test(normalized);
}

export async function rewriteRelayRequestToolsForSaVm(request: Request, _toolsConfig?: SaVmToolsConfig): Promise<Request> {
  // VM enablement is the security boundary. Tool replacement toggles control
  // convenience routing, but must never re-expose a host shell to the model.
  const body = asRecord(await request.clone().json().catch(() => ({})));
  if (!Array.isArray(body.tools) || body.tools.length === 0) return request;
  const filteredTools = body.tools.filter((tool) => {
    const rec = asRecord(tool);
    const fnRec = asRecord(rec.function);
    const name = String(rec.name ?? fnRec.name ?? "");
    return !isSaVmBlockedToolName(name);
  });
  if (filteredTools.length === body.tools.length) return request;
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  return new Request(request, {
    body: JSON.stringify({ ...body, tools: filteredTools }),
    headers
  });
}


export type CompactionRelayRoute = {
  providerId: string;
  groupId: string;
  model: string;
};

type FreeCompactionFailureState = {
  operationId: string;
  failures: number;
  forceNative: boolean;
  updatedAt: number;
};

export class FreeCompactionFallbackTracker {
  private readonly states = new Map<string, FreeCompactionFailureState>();

  constructor(
    private readonly maxFreeFailures = 3,
    private readonly staleAfterMs = 30 * 60_000
  ) {}

  shouldUseNative(threadId: string, operationId: string, now = Date.now()): boolean {
    const state = this.currentState(threadId, operationId, now);
    return state?.forceNative === true;
  }

  recordFailure(threadId: string, operationId: string, now = Date.now()): { failures: number; fallbackNow: boolean } {
    const previous = this.currentState(threadId, operationId, now);
    const failures = (previous?.failures ?? 0) + 1;
    const fallbackNow = failures >= this.maxFreeFailures;
    this.states.set(threadId, { operationId, failures, forceNative: fallbackNow, updatedAt: now });
    return { failures, fallbackNow };
  }

  clear(threadId: string): void {
    this.states.delete(threadId);
  }

  private currentState(threadId: string, operationId: string, now: number): FreeCompactionFailureState | null {
    const state = this.states.get(threadId);
    if (!state) return null;
    if (state.operationId !== operationId || now - state.updatedAt >= this.staleAfterMs) {
      this.states.delete(threadId);
      return null;
    }
    return state;
  }
}

export function isFreeCompactionFallbackStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function resolveCompactionRelayRoute(metadata: ThreadRuntimeMetadata | null): CompactionRelayRoute | null {
  if (!metadata?.freeAutoCompactEnabled) return null;
  const manualProviderId = metadata.freeAutoCompactProviderId?.trim();
  const manualGroupId = metadata.freeAutoCompactGroupId?.trim();
  const manualModel = metadata.freeAutoCompactModel?.trim();
  if (manualProviderId || manualGroupId || manualModel) {
    if (!manualProviderId || !manualGroupId || !manualModel || manualModel.toLowerCase() === "big-pickle") return null;
    return { providerId: manualProviderId, groupId: manualGroupId, model: manualModel };
  }

  return null;
}
