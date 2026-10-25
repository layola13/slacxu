import { ConversationStatus } from "../../app/conversationStatus";
import { displayThreadTitle } from "../../app/threads/threadCatalog";
import { isRunningTurnStatus } from "../../app/transcripts/topicRuntimeIndex";
import { PendingAppendMessage, RequestMonitorEntry, ThreadTokenUsageState, TokenUsageBreakdown } from "../../components/ChatPanel";
import { HistoryThreadUsageSummary } from "../../history/HistorySidebar";
import { ReasoningOption } from "../../settings/SettingsDrawer";
import { ChatWaterfallRow } from "../../waterfall/types";
import { TranslateFn } from "../../i18n";
import { ClientState, SocketConnectionStatus, WorkbenchItem, WorkbenchTurn } from "../../state/codexClient";
import type { ThreadEntry } from "../../state/codexClient";
import { normalizeWorkspaceCwd, normalizeWorkspaceRoots } from "../../workspacePaths";
import { MAX_TERMINAL_OUTPUT_CHARS } from "./appConstants";
import type { WorkspaceMode } from "./appConstants";
import { AuthSession } from "@codex-ui/shared";
import type { JsonValue } from "@codex-ui/shared";

export function isElectronDesktopShell(): boolean {
  return /\bElectron\/\d/i.test(navigator.userAgent);
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve: (value: PromiseLike<never>) => void, reject: (reason?: unknown) => void) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function waitForNextPaint(): Promise<void> {
  return new Promise((resolve: (value: void | PromiseLike<void>) => void) => {
    window.requestAnimationFrame(() => resolve());
  });
}

export function legalReviewRequired(session: AuthSession): boolean {
  return Boolean(session.user && session.legalConsent?.required);
}

export function findLastTurnUsage(
  threadTurns: readonly WorkbenchTurn[],
  turnUsage: Record<string, TokenUsageBreakdown>
): TokenUsageBreakdown | undefined {
  for (let i = threadTurns.length - 1; i >= 0; i--) {
    const turn = threadTurns[i];
    if (turn) {
      const usage = turnUsage[turn.id];
      if (usage) return usage;
    }
  }
  return undefined;
}

export function extractTurnIdFromRpcResult(value: JsonValue): string | null {
  const record = asRecord(value);
  const turn = asRecord(record.turn);
  return stringValue(turn.id) ?? stringValue(record.turnId) ?? stringValue(record.id) ?? null;
}

export function hasRealUserMessageForPending(turns: ClientState["turns"], message: PendingAppendMessage): boolean {
  const expectedText = (message.inputText ?? message.text).trim();
  const matchingCount = countMatchingRealUserMessages(turns, message.threadId, expectedText);
  if (matchingCount > (message.existingMatchingUserMessageCount ?? 0)) {
    return true;
  }
  const relatedTurn = turns.find((turn: WorkbenchTurn) => turn.id === message.turnId && (!message.threadId || turn.threadId === message.threadId));
  if (relatedTurn) {
    const userMessageCount = relatedTurn.items.filter((item: WorkbenchItem) => item.type === "userMessage").length;
    if (userMessageCount > (message.existingTurnUserMessageCount ?? 0)) {
      return true;
    }
  }
  return Boolean(relatedTurn && !isRunningTurnStatus(relatedTurn.status));
}

export function countMatchingRealUserMessages(turns: ClientState["turns"], threadId: string | null, expectedText: string): number {
  return turns.reduce((count: number, turn: WorkbenchTurn) => {
    if (threadId && turn.threadId !== threadId) {
      return count;
    }
    return count + turn.items.filter((item: WorkbenchItem) => item.type === "userMessage" && userMessageTextsMatch(item.text, expectedText)).length;
  }, 0);
}

export function userMessageTextsMatch(actualText: string, expectedText: string): boolean {
  const actual = actualText.trim();
  const expected = expectedText.trim();
  if (!expected) {
    return true;
  }
  return actual === expected || actual.includes(expected) || expected.includes(actual);
}


export function parseReviewCommand(value: string): { target: JsonValue; delivery: "inline" | "detached" } {
  let rest = value.trim();
  let delivery: "inline" | "detached" = "inline";
  const detachedPrefix = /^(--detached|-d|detached)\b/i.exec(rest);
  if (detachedPrefix) {
    delivery = "detached";
    rest = rest.slice(detachedPrefix[0].length).trim();
  }
  const normalized = rest.toLowerCase();
  if (!rest || ["changes", "uncommitted", "uncommitted changes"].includes(normalized)) {
    return { target: { type: "uncommittedChanges" }, delivery };
  }
  const branch = /^(?:branch|base|base-branch)\s+(.+)$/i.exec(rest);
  if (branch?.[1]?.trim()) {
    return { target: { type: "baseBranch", branch: branch[1].trim() }, delivery };
  }
  const commit = /^commit\s+([0-9a-fA-F]{6,64})(?:\s+(.+))?$/i.exec(rest);
  if (commit?.[1]) {
    return { target: { type: "commit", sha: commit[1], title: commit[2]?.trim() || null }, delivery };
  }
  return { target: { type: "custom", instructions: rest }, delivery };
}

export function reviewTargetLabel(target: JsonValue): string {
  const record = asRecord(target);
  switch (record.type) {
    case "baseBranch":
      return `Review against ${stringValue(record.branch) ?? "base branch"}`;
    case "commit":
      return `Review commit ${stringValue(record.sha) ?? ""}`.trim();
    case "custom":
      return stringValue(record.instructions) ?? "Custom review";
    default:
      return "Review uncommitted changes";
  }
}

export function formatDiffNotice(sha: string | undefined, diff: string): string {
  const header = sha ? `Remote base: ${sha}` : "Remote base unavailable";
  const trimmed = diff.trim();
  if (!trimmed) {
    return `${header}
No diff returned.`;
  }
  const maxLength = 1800;
  const preview = trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}
...diff truncated in UI...` : trimmed;
  return `${header}
${preview}`;
}












export function latestRunningPlanStep(turns: WorkbenchTurn[], threadId: string): string | undefined {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn || turn.threadId !== threadId) continue;
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!item || item.type !== "plan" || !item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) continue;
      const plan = Array.isArray((item.payload as Record<string, unknown>).plan) ? (item.payload as Record<string, unknown>).plan as unknown[] : [];
      const active = plan.find((entry: unknown) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
        const status = String((entry as Record<string, unknown>).status ?? "").replace(/[_-]+/g, "").toLowerCase();
        return status === "inprogress" || status === "running" || status === "started";
      });
      if (active && typeof active === "object") {
        const step = (active as Record<string, unknown>).step ?? (active as Record<string, unknown>).text;
        if (typeof step === "string" && step.trim()) return step.trim();
      }
    }
  }
  return undefined;
}








export function appendBoundedTerminalOutput(current: string, appended: string): string {
  const next = `${current}${appended}`;
  if (next.length <= MAX_TERMINAL_OUTPUT_CHARS) {
    return next;
  }
  const trimmed = next.slice(-MAX_TERMINAL_OUTPUT_CHARS);
  const marker = "[output truncated]\\n";
  return trimmed.startsWith(marker) ? trimmed : `${marker}${trimmed}`;
}



export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function normalizeGitPath(path: string | undefined): string {
  return (path ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").toLowerCase();
}

export function waterfallFileChangePaths(rows: ChatWaterfallRow[]): string[] {
  const paths = new Set<string>();
  const visited = new Set<object>();

  const addPath = (value: unknown) => {
    if (typeof value !== "string") return;
    const path = value.trim();
    if (path) paths.add(path);
  };

  const visitPayload = (value: unknown) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(visitPayload);
      return;
    }
    const payload = value as Record<string, unknown>;
    addPath(payload.path);
    addPath(payload.filePath);
    addPath(payload.file_path);
    addPath(payload.name);
    for (const key of ["changes", "fileChanges", "files", "edits", "patches"] as const) {
      const entries = payload[key];
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (typeof entry === "string") addPath(entry);
          else visitPayload(entry);
        }
      } else {
        visitPayload(entries);
      }
    }
    visitPayload(payload.arguments);
  };

  const visitRow = (row: ChatWaterfallRow) => {
    visitPayload(row.item.payload);
    row.groupedRows?.forEach(visitRow);
  };
  rows.forEach(visitRow);
  return [...paths];
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseThreadTokenUsage(value: unknown): ThreadTokenUsageState | null {
  const usage = asRecord(value);
  const total = parseTokenBreakdown(usage.total ?? usage.total_usage ?? usage.totalUsage);
  const last = parseTokenBreakdown(usage.last ?? usage.last_usage ?? usage.lastUsage);
  if (!total || !last) {
    return null;
  }
  return {
    total,
    last,
    contextUsage: parseTokenBreakdown(usage.contextUsage ?? usage.context_usage) ?? last,
    modelContextWindow: numberField(usage, "modelContextWindow", "model_context_window") ?? null
  };
}

export function parseTokenBreakdown(value: unknown): TokenUsageBreakdown | null {
  const record = asRecord(value);
  const totalTokens = numberField(record, "totalTokens", "total_tokens");
  if (totalTokens == null) {
    return null;
  }
  const costBreakdown = asRecord(record.costBreakdownUsd ?? record.cost_breakdown_usd);
  const parsedCostBreakdown = Object.keys(costBreakdown).length > 0 ? {
    input: numberField(costBreakdown, "input") ?? 0,
    cachedInput: numberField(costBreakdown, "cachedInput", "cached_input") ?? 0,
    cacheWrite: numberField(costBreakdown, "cacheWrite", "cache_write") ?? 0,
    output: numberField(costBreakdown, "output") ?? 0
  } : undefined;
  return {
    totalTokens,
    inputTokens: numberField(record, "inputTokens", "input_tokens") ?? 0,
    cachedInputTokens: numberField(record, "cachedInputTokens", "cached_input_tokens") ?? 0,
    cacheWriteInputTokens: numberField(record, "cacheWriteInputTokens", "cache_write_input_tokens") ?? 0,
    outputTokens: numberField(record, "outputTokens", "output_tokens") ?? 0,
    reasoningOutputTokens: numberField(record, "reasoningOutputTokens", "reasoning_output_tokens") ?? 0,
    ...(numberField(record, "estimatedCostUsd", "estimated_cost_usd") != null ? { estimatedCostUsd: numberField(record, "estimatedCostUsd", "estimated_cost_usd") } : {}),
    ...(parsedCostBreakdown ? { costBreakdownUsd: parsedCostBreakdown } : {}),
    ...(record.billingSnapshot || record.billing_snapshot ? { billingSnapshot: parseTokenUsageBillingSnapshot(record.billingSnapshot ?? record.billing_snapshot) } : {})
  };
}

export function parseTokenUsageBillingSnapshot(value: unknown): NonNullable<TokenUsageBreakdown["billingSnapshot"]> {
  const snapshot = asRecord(value);
  return {
    inputUsdPerMillion: numberField(snapshot, "inputUsdPerMillion", "input_usd_per_million") ?? 0,
    cachedInputUsdPerMillion: numberField(snapshot, "cachedInputUsdPerMillion", "cached_input_usd_per_million") ?? 0,
    cacheWriteUsdPerMillion: numberField(snapshot, "cacheWriteUsdPerMillion", "cache_write_usd_per_million") ?? 0,
    outputUsdPerMillion: numberField(snapshot, "outputUsdPerMillion", "output_usd_per_million") ?? 0,
    modelMultiplier: numberField(snapshot, "modelMultiplier", "model_multiplier") ?? 1,
    inputMultiplier: numberField(snapshot, "inputMultiplier", "input_multiplier") ?? 1,
    cacheReadMultiplier: numberField(snapshot, "cacheReadMultiplier", "cache_read_multiplier") ?? 1,
    cacheWriteMultiplier: numberField(snapshot, "cacheWriteMultiplier", "cache_write_multiplier") ?? 1,
    outputMultiplier: numberField(snapshot, "outputMultiplier", "output_multiplier") ?? 1,
    groupRatio: numberField(snapshot, "groupRatio", "group_ratio") ?? 1
  };
}

export function numberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function buildHistoryUsageByThread(tokenUsage: Record<string, ThreadTokenUsageState>): Record<string, HistoryThreadUsageSummary> {
  return Object.fromEntries(
    Object.entries(tokenUsage).map(([threadId, usage]: [string, ThreadTokenUsageState]) => [
      threadId,
      {
        totalTokens: usage.total.totalTokens,
        inputTokens: usage.total.inputTokens,
        cachedInputTokens: usage.total.cachedInputTokens,
        cacheWriteInputTokens: usage.total.cacheWriteInputTokens,
        outputTokens: usage.total.outputTokens,
        estimatedCostUsd: usage.total.estimatedCostUsd
      }
    ])
  );
}

export function fastReasoningEffort(options: ReasoningOption[], current: string): string {
  return options[0]?.value ?? (current === "minimal" ? "minimal" : "low");
}

export function turnContainsCompletedImplementationPlan(turn: ClientState["turns"][number]): boolean {
  return turn.status.toLowerCase() === "completed" && turn.items.some((item: ClientState["turns"][number]["items"][number]) =>
    item.type === "plan"
    && item.status?.toLowerCase() === "completed"
    && !item.id.startsWith("turn-plan-")
    && item.text.trim().length > 0
  );
}

export function buildPlanCollaborationMode(model: string): JsonValue {
  return {
    mode: "plan",
    settings: {
      model,
      reasoning_effort: "medium",
      developer_instructions: "Develop the plan autonomously and inspect available context before asking questions. Resolve non-blocking uncertainty with explicit reasonable assumptions. If user input is genuinely required because the answer would materially change the plan, use the user-input request tool and group all blocking questions together. Do not implement changes while in Plan mode."
    }
  };
}

export function buildDefaultCollaborationMode(model: string, reasoningEffort: string): JsonValue {
  return {
    mode: "default",
    settings: {
      model,
      reasoning_effort: reasoningEffort,
      developer_instructions: null
    }
  };
}

export function normalizeTimestampMilliseconds(value?: number): number | null {
  if (!value || !Number.isFinite(value)) {
    return null;
  }
  return value > 1_000_000_000_000 ? value : value * 1000;
}

export function conversationStatusLabelFor(status: ConversationStatus, connectionStatus: SocketConnectionStatus, t: TranslateFn): string {
  if (connectionStatus.phase === "connecting") {
    return t("connection.connecting");
  }
  if (connectionStatus.phase === "reconnecting") {
    return t("connection.reconnecting");
  }
  if (status === "disconnect") {
    return t("connection.disconnected");
  }
  switch (status) {
    case "connecting":
      return t("connection.connecting");
    case "working":
      return t("composer.running");
    case "idle":
      return t("composer.ready");
    case "retrying":
      return t("connection.engineStarting");
    case "engine-error":
      return t("connection.engineError");
  }
}

export function connectionNoticeFor(status: SocketConnectionStatus, t: TranslateFn): string {
  if (status.phase === "reconnecting") {
    return t("connection.noticeReconnecting", {
      seconds: Math.max(1, Math.ceil((status.delayMs ?? 0) / 1000)),
      reason: status.reason ?? t("connection.disconnected")
    });
  }
  if (status.phase === "connecting") {
    return t("connection.noticeConnecting");
  }
  if (status.reason) {
    return t("connection.noticeDisconnectedWithReason", { reason: status.reason });
  }
  return t("connection.noticeDisconnected");
}

export function conversationStatusColorFor(status: ConversationStatus): "success" | "error" | "warning" | "primary" | "default" {
  switch (status) {
    case "connecting":
    case "working":
      return "primary";
    case "idle":
      return "success";
    case "disconnect":
    case "engine-error":
      return "error";
    case "retrying":
      return "warning";
  }
}

export function errorMessage(scope: string, error: unknown): string {
  return `${scope}: ${formatErrorText(error)}`;
}

export function isThreadNotFoundError(error: unknown): boolean {
  const message = formatErrorText(error).toLowerCase();
  return message.includes("thread not found");
}

export function formatErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
      if (value && typeof value === "object") {
        const nested = formatErrorText(value);
        if (nested && nested !== "[object Object]") {
          return nested;
        }
      }
    }
    try {
      return JSON.stringify(record);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export function debugLog(label: string, payload: unknown): void {
  try {
    if (window.localStorage.getItem("codex-ultra.debug") !== "1") {
      return;
    }
  } catch {
    return;
  }
  console.debug(`[codex-ui] ${label}`, payload);
}

export function syncWorkspaceFromThread(
  thread: ClientState["threads"][number] | null,
  setCwd: (cwd: string) => void,
  setWorkspaceSelectionPending: (pending: boolean) => void,
  setWorkspaceMode?: (mode: WorkspaceMode) => void,
  setSshCommand?: (command: string) => void,
  setSshCwd?: (cwd: string) => void,
  setAdditionalRoots?: (roots: string[]) => void,
  setWorkspaceFilePath?: (path: string | null) => void
): void {
  if (thread?.workspaceMode === "ssh" && thread.sshCommand && thread.sshCwd) {
    setWorkspaceMode?.("ssh");
    setSshCommand?.(thread.sshCommand);
    setSshCwd?.(thread.sshCwd);
    setAdditionalRoots?.(normalizeWorkspaceRoots(thread.sshCwd, thread.additionalRoots ?? []));
    setWorkspaceFilePath?.(null);
    setWorkspaceSelectionPending(false);
    return;
  }
  setWorkspaceMode?.("local");
  const threadCwd = normalizeWorkspaceCwd(thread?.cwd ?? "");
  if (!threadCwd) {
    return;
  }
  setCwd(threadCwd);
  setAdditionalRoots?.(normalizeWorkspaceRoots(threadCwd, thread?.additionalRoots ?? []));
  setWorkspaceFilePath?.(null);
  setWorkspaceSelectionPending(false);
}

export function sanitizeDomId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}

export function safeThemeAssetUrl(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /["'()\\]/.test(trimmed)) {
    return undefined;
  }
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://") || trimmed.startsWith("blob:") || trimmed.startsWith("data:image/")) {
    return trimmed;
  }
  return undefined;
}

export function safeThemeVideoUrl(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /["'()\\]/.test(trimmed)) {
    return undefined;
  }
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://") || trimmed.startsWith("blob:") || trimmed.startsWith("data:vidro/")) {
    return trimmed;
  }
  return undefined;
}

export function sideChatTitle(text: string, fallbackIndex: number): string {
  const title = text.replace(/\s+/g, " ").trim();
  if (!title) {
    return fallbackIndex <= 1 ? "Side chat" : `Side chat ${fallbackIndex}`;
  }
  return title.length > 28 ? `${title.slice(0, 27)}...` : title;
}

export function decodeBase64Text(value: string): string {
  const binary = window.atob(value);
  const bytes = Uint8Array.from(binary, (char: string) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeBase64Text(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

export function buildRequestMonitorEntries(
  turns: ClientState["turns"],
  threads: ClientState["threads"],
  tokenUsage: Record<string, ThreadTokenUsageState>
): RequestMonitorEntry[] {
  const threadById = new Map(threads.map((thread: ThreadEntry) => [thread.id, thread]));
  return turns.filter((turn: WorkbenchTurn) => isRunningTurnStatus(turn.status)).slice(0, 24).map((turn: WorkbenchTurn) => {
    const thread = threadById.get(turn.threadId);
    const usage = tokenUsage[turn.threadId];
    return {
      id: turn.id,
      threadId: turn.threadId,
      title: thread ? displayThreadTitle(thread) : turn.id,
      source: threadSourceLabel(thread),
      status: turn.status,
      provider: thread?.modelProvider ?? "default",
      model: thread?.model ?? "Engine default",
      lastTokens: usage?.last,
      totalTokens: usage?.total
    };
  });
}

export function threadSourceLabel(thread?: ClientState["threads"][number]): string {
  if (!thread) {
    return "unknown";
  }
  if (thread.parentThreadId) {
    return "agent";
  }
  if (thread.agentNickname || thread.agentRole) {
    return "sidechat";
  }
  return "main";
}
