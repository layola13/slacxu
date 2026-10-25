import { spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveModelContextWindow,
  stripModelContextVariant,
  normalizeTokenUsage,
  type EngineStatus,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonValue
} from "@codex-ui/shared";
import { buildSafeClaudeEnv, buildClaudeRelayCustomHeaders, buildClaudeSpawnArgs, claudeTranscriptExists, ensureClaudeSpawnCwd, findClaudeBin, mapPermissionMode, resolveClaudeEffortForCli, spawnClaudeCommand } from "../../../backends/claude/src/runtime/claudeCompatibleProbe.js";
import { buildControlResponse } from "../../../backends/claude/src/runtime/claudeCompatibleProtocol.js";
import { buildGoalContinuationPrompt, hasGoalCompleteSignal, isMiniContinuationNudge } from "./goalContinuation.js";
import { buildClaudeUserContent, extractTurnInput } from "../../../backends/claude/src/runtime/claudeTurnInput.js";
import {
  applyClaudeTaskPlanTool,
  bindClaudeTaskPlanResult,
  buildClaudeTaskPlanItem,
  claudeTaskPlanStateFromItem,
  createClaudeTaskPlanState,
  isClaudeTaskPlanTool,
  type ClaudeTaskPlanState,
} from "../../../backends/claude/src/runtime/claudeTaskPlan.js";
import {
  createClaudeCompactionRunner,
  type ClaudeCompactionRoute,
  type ClaudeCompactionRunner,
} from "../../../backends/claude/src/runtime/claudeCompactionRunner.js";
import type { CodexRuntimeClient } from "@cxu/sdk-backend";
import { bootstrapProjectSaVmAssets } from "./saVmWorkspaceSkill.js";
import { resolveSaVmMcpScriptPath } from "./saVmBundle.js";
import { pageThreadHistory } from "./threadHistoryPaging.js";

type CodeCliSession = {
  threadId: string;
  parentThreadId?: string;
  agentNickname?: string;
  agentRole?: string;
  preview?: string;
  model: string | undefined;
  permissionMode: string;
  cwd: string | undefined;
  createdAt: number;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
  assistantTextBlocksByTurn: Map<string, string[]>;
  streamedAssistantItemsByTurn: Map<string, Map<string, string>>;
  streamedReasoningItemsByTurn: Map<string, Map<string, string>>;
  streamedToolBlocksByTurn: Map<string, Map<number, ClaudeStreamToolBlock>>;
  taskPlan: ClaudeTaskPlanState;
  /** Tool-use ids already folded into `taskPlan`, so their results stay off the transcript. */
  taskPlanToolUseIds: Set<string>;
  activeStreamMessageId?: string;
  goalStatus: string | null;
  /** Persisted /goal objective text; drives prompt injection and auto-continuation. */
  goalObjective?: string | null;
  goalTokenBudget?: number | null;
  goalBaseTokens?: number;
  goalStartedAt?: number;
  developerInstructions?: string;
  activeTurnId?: string;
  conversation: Array<{ role: "user" | "assistant"; text: string }>;
  pendingCompactionSummary?: string;
  externalSessionId?: string;
  tokenUsage: ClaudeTokenUsage;
  currentMessageUsage: ClaudeTokenUsage;
  lastMessageUsage: ClaudeTokenUsage;
  modelContextWindow?: number;
  requestUsageEmittedByTurn: Map<string, Set<string>>;
  approvedToolAllows: Array<{ toolName: string; inputSignature: string }>;
};

export type CodeCliSessionSnapshot = {
  threadId: string;
  parentThreadId?: string;
  agentNickname?: string;
  agentRole?: string;
  preview?: string;
  model?: string;
  permissionMode: string;
  cwd?: string;
  createdAt: number;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  messages: JsonValue[];
  goalStatus: string | null;
  goalObjective?: string | null;
  goalTokenBudget?: number | null;
  goalBaseTokens?: number;
  goalStartedAt?: number;
  developerInstructions?: string;
  conversation: Array<{ role: "user" | "assistant"; text: string }>;
  pendingCompactionSummary?: string;
  externalSessionId?: string;
  providerId?: string;
  groupId?: string;
  sandbox?: string;
  approvalPolicy?: string;
  reasoningEffort?: string;
  tokenUsage?: ClaudeTokenUsage;
  lastMessageUsage?: ClaudeTokenUsage;
  modelContextWindow?: number;
  taskPlan?: ClaudeTaskPlanState;
  approvedToolAllows?: Array<{ toolName: string; inputSignature: string }>;
};

type ClaudeTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
};

type ClaudeStreamToolBlock = {
  id: string;
  name: string;
  argumentsJson: string;
  initialInput: JsonValue;
};

const EMPTY_CLAUDE_TOKEN_USAGE: ClaudeTokenUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
};

const DEFAULT_CLAUDE_CODE_VERSION = "2.1.222";

/** Character budget for the stderr tail kept to explain a child exit. */
const CLAUDE_STDERR_TAIL_BUDGET = 2_000;

const CLAUDE_EFFORT_TOKEN_BUDGETS: Record<string, number | null> = {
  none: 0,
  low: 4_096,
  medium: 8_192,
  high: 16_384,
  max: 32_768,
  ultra: 32_768,
};

type ClaudeAgentProjection = {
  parentToolUseId: string;
  parentThreadId: string;
  parentTurnId: string;
  childThreadId: string;
  childTurnId: string;
  groupItemId: string;
  prompt: string;
  model: string | undefined;
  nickname: string;
  role: string;
  taskId?: string;
  status: "running" | "completed" | "failed" | "interrupted";
  summary?: string;
};

type ClaudeAgentGroup = {
  itemId: string;
  parentThreadId: string;
  parentTurnId: string;
  parentToolUseIds: string[];
};

const CODECLI_TERMINAL_THREAD_METHODS = new Set([
  "thread/archive",
  "thread/delete",
  "thread/unsubscribe",
  "thread/closed",
]);

const CODECLI_PROCESS_FREE_METHODS = new Set([
  ...CODECLI_TERMINAL_THREAD_METHODS,
  "initialize",
  "config/read",
  "thread/fork",
  "thread/read",
  "thread/resume",
  "thread/list",
  "thread/turns/list",
  "thread/items/list",
  "thread/name/set",
  "thread/goal/set",
  "thread/goal/get",
  "thread/goal/clear",
  "thread/inject_items",
  "thread/history/fileInfo",
  "thread/history/tail",
  "thread/tokenUsage/updated",
  "turn/interrupt",
]);

export function isCodeCliTerminalThreadMethod(method: string): boolean {
  return CODECLI_TERMINAL_THREAD_METHODS.has(method);
}

export function codeCliNeedsManagedConfigDir(method: string): boolean {
  return method !== "turn/interrupt" && method !== "thread/fork" && !isCodeCliTerminalThreadMethod(method);
}

export function codeCliNeedsRunningProcess(method: string): boolean {
  return !CODECLI_PROCESS_FREE_METHODS.has(method);
}

function normalizeAssistantText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function claudeTaskTerminalStatus(value: JsonValue | undefined): "completed" | "failed" | "interrupted" | undefined {
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "stopped" || value === "killed") return "interrupted";
  return undefined;
}

function formatConversationEntry(entry: { role: "user" | "assistant"; text: string }): string {
  return (entry.role === "user" ? "User" : "Assistant") + ": " + entry.text;
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function toolInputSignature(input: JsonValue | undefined): string {
  return canonicalJson(input ?? null);
}

function permissionResponseAllows(result: JsonValue | undefined): boolean {
  const response = jsonRecord(result);
  return response.decision === "accept" || response.decision === "acceptForSession";
}

/** `acceptForSession` grants the tool for the whole CLI process, not one input. */
function permissionResponseScopeIsSession(result: JsonValue | undefined): boolean {
  return jsonRecord(result).decision === "acceptForSession";
}

function hasApprovedToolAllow(session: CodeCliSession, toolName: string, inputSignature: string): boolean {
  return session.approvedToolAllows.some((entry) =>
    entry.toolName === toolName && (entry.inputSignature === "*" || entry.inputSignature === inputSignature)
  );
}

type ClaudeGoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

function normalizeClaudeGoalStatus(value: string): ClaudeGoalStatus | undefined {
  return (["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"] as const)
    .find((status) => status === value);
}

function normalizeGoalBudgetInput(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return undefined;
  if (n <= 0) return null;
  return Math.min(10_000_000, Math.floor(n));
}

/** Goal shape expected by the web `parseGoal` lifecycle (thread/goal/*). */
function claudeGoalState(session: CodeCliSession) {
  const base = typeof session.goalBaseTokens === "number" ? session.goalBaseTokens : 0;
  const tokensUsed = Math.max(0, totalClaudeTokens(session.tokenUsage) - base);
  return {
    threadId: session.threadId,
    objective: session.goalObjective ?? "",
    status: normalizeClaudeGoalStatus(session.goalStatus ?? "") ?? "active",
    tokenBudget: typeof session.goalTokenBudget === "number" ? session.goalTokenBudget : null,
    tokensUsed,
    timeUsedSeconds: typeof session.goalStartedAt === "number"
      ? Math.max(0, Math.floor((Date.now() - session.goalStartedAt) / 1000))
      : 0,
  };
}

function isClaudeGoalBudgetExhausted(session: CodeCliSession): boolean {
  if (typeof session.goalTokenBudget !== "number" || session.goalTokenBudget <= 0) return false;
  const base = typeof session.goalBaseTokens === "number" ? session.goalBaseTokens : 0;
  return totalClaudeTokens(session.tokenUsage) - base >= session.goalTokenBudget;
}

/** Safety bound for host-driven /goal continuations between user turns. */
const MAX_GOAL_AUTO_CONTINUATIONS = 50;

/**
 * How much of a lost conversation is replayed into a fresh Claude session.
 * Long threads are trimmed from the front so the replay cannot itself overflow
 * the model's context on the first turn back.
 */
const MAX_CLAUDE_REPLAY_CHARS = 24_000;

function buildConversationReplay(session: CodeCliSession): string | undefined {
  const lines: string[] = [];
  let budget = MAX_CLAUDE_REPLAY_CHARS;
  for (let index = session.conversation.length - 1; index >= 0; index -= 1) {
    const line = formatConversationEntry(session.conversation[index]!);
    if (line.length > budget) break;
    budget -= line.length;
    lines.unshift(line);
  }
  return lines.length > 0 ? lines.join("\n\n") : undefined;
}

function assistantResultAlreadyProjected(blocks: string[] | undefined, result: string): boolean {
  if (!blocks || blocks.length === 0) return false;
  const normalizedBlocks = blocks.map(normalizeAssistantText).filter(Boolean);
  return normalizedBlocks.includes(result)
    || normalizeAssistantText(normalizedBlocks.join("\n")) === result
    || normalizeAssistantText(normalizedBlocks.join("")) === result;
}

function reconcileStreamedItem(items: Map<string, string> | undefined, incoming: string): boolean {
  if (!items) return false;
  const normalizedIncoming = normalizeAssistantText(incoming);
  if (!normalizedIncoming) return false;
  for (const [itemId, current] of items) {
    const normalizedCurrent = normalizeAssistantText(current);
    if (!normalizedCurrent
      || (!normalizedCurrent.includes(normalizedIncoming) && !normalizedIncoming.includes(normalizedCurrent))) {
      continue;
    }
    if (normalizedIncoming.length > normalizedCurrent.length) items.set(itemId, incoming);
    return true;
  }
  return false;
}

function finiteTokenCount(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function parseClaudeTokenUsage(value: JsonValue | undefined): ClaudeTokenUsage | null {
  const normalized = normalizeTokenUsage(value, "anthropic");
  if (!normalized) return null;
  return {
    inputTokens: normalized.inputTokens,
    cachedInputTokens: normalized.cachedInputTokens,
    cacheWriteInputTokens: normalized.cacheWriteInputTokens,
    outputTokens: normalized.outputTokens,
  };
}

function updateClaudeTokenUsage(current: ClaudeTokenUsage, value: JsonValue | undefined): ClaudeTokenUsage {
  const next = parseClaudeTokenUsage(value);
  if (!next) return current;
  return {
    // Claude reports a full input/cache snapshot at message_start, then often
    // sends zero placeholders for those fields in message_delta. The current
    // request is reset on every message_start, so retaining non-zero fields
    // here cannot leak across requests while still preserving the snapshot.
    inputTokens: next.inputTokens > 0 ? next.inputTokens : current.inputTokens,
    cachedInputTokens: next.cachedInputTokens > 0 ? next.cachedInputTokens : current.cachedInputTokens,
    cacheWriteInputTokens: next.cacheWriteInputTokens > 0 ? next.cacheWriteInputTokens : current.cacheWriteInputTokens,
    outputTokens: next.outputTokens > 0 ? next.outputTokens : current.outputTokens,
  };
}

function totalClaudeTokens(usage: ClaudeTokenUsage): number {
  return usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteInputTokens + usage.outputTokens;
}

function claudeTokenBreakdown(usage: ClaudeTokenUsage): Record<string, JsonValue> {
  return {
    totalTokens: totalClaudeTokens(usage),
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    outputTokens: usage.outputTokens,
    reasoningOutputTokens: 0,
    reasoningIncludedInOutput: true,
  };
}

/**
 * Resolve the context window to report for a Claude thread.
 *
 * The CLI owns the `[1m]` contract: `--model <id>[1m]` sends the base id in the
 * request body and adds the `context-1m-2025-08-07` beta header. Because the
 * suffix never reaches the wire, the CLI reports `modelUsage` under the base id
 * and sizes it for the model's standard window — so a `[1m]` thread would be
 * charted against 200K. An explicit variant is the user's own selection, so it
 * outranks whatever the CLI reports.
 */
function resolveClaudeModelContextWindow(modelUsageValue: JsonValue | undefined, configuredModel: string | undefined): number | undefined {
  const variantWindow = configuredModel ? stripModelContextVariant(configuredModel).contextWindow : undefined;
  if (variantWindow && variantWindow > 0) return variantWindow;
  const modelUsage = jsonRecord(modelUsageValue);
  const baseModel = configuredModel ? stripModelContextVariant(configuredModel).baseModel : undefined;
  for (const key of [configuredModel, baseModel]) {
    if (!key) continue;
    const usageWindow = finiteTokenCount(jsonRecord(modelUsage[key]).contextWindow ?? jsonRecord(modelUsage[key]).context_window);
    if (usageWindow && usageWindow > 0) return usageWindow;
  }
  for (const value of Object.values(modelUsage)) {
    const usage = jsonRecord(value);
    const contextWindow = finiteTokenCount(usage.contextWindow ?? usage.context_window);
    if (contextWindow && contextWindow > 0) return contextWindow;
  }
  // Older CLI builds omit `contextWindow` from `modelUsage` entirely, which
  // otherwise leaves the composer with no context gauge at all.
  return configuredModel ? resolveModelContextWindow(configuredModel) : undefined;
}

function upsertSessionMessage(session: CodeCliSession, item: Record<string, JsonValue>): void {
  const itemId = typeof item.id === "string" ? item.id : undefined;
  const turnId = typeof item.turnId === "string" ? item.turnId : undefined;
  const existingIndex = itemId
    ? session.messages.findIndex((entry) => {
        const existing = jsonRecord(entry);
        return existing.id === itemId && (!turnId || existing.turnId === turnId);
      })
    : -1;
  if (existingIndex >= 0) session.messages[existingIndex] = item as JsonValue;
  else session.messages.push(item as JsonValue);
}

function streamedToolArguments(block: ClaudeStreamToolBlock): JsonValue {
  const source = block.argumentsJson.trim();
  if (!source) return block.initialInput;
  try {
    return JSON.parse(source) as JsonValue;
  } catch {
    return source;
  }
}

function restoreTaskPlanState(messages: JsonValue[]): ClaudeTaskPlanState {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const restored = claudeTaskPlanStateFromItem(messages[index]);
    if (restored) return restored;
  }
  return createClaudeTaskPlanState();
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer ***")
    .replace(/api[_-]?key["'=:\s]+[A-Za-z0-9._~+/=-]{8,}/gi, "api_key=***");
}

function spawnErrnoDetails(error: unknown): Record<string, string | number | undefined> {
  const record = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const pick = (key: string): string | number | undefined => {
    const value = record[key];
    return typeof value === "string" || typeof value === "number" ? value : undefined;
  };
  return { code: pick("code"), errno: pick("errno"), syscall: pick("syscall"), path: pick("path") };
}

/** Bridge-level lifecycle log. Server stdio lands in `log.txt` via the desktop shell. */
function logClaudeBridgeEvent(
  level: "log" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
): void {
  try {
    const rendered = redactSecrets(JSON.stringify(details)).slice(0, 4000);
    console[level](`[claude-bridge] ${event} ${rendered}`);
  } catch {
    // Logging must never break the bridge.
  }
}

function jsonRecord(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {};
}

function firstNonEmptyString(record: Record<string, JsonValue>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function toolResultText(value: JsonValue | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === "string") return entry;
      const block = jsonRecord(entry);
      return firstNonEmptyString(block, ["text", "content"]) ?? "";
    }).filter(Boolean).join("\n");
  }
  return value == null ? "" : JSON.stringify(value);
}

function asyncAgentTaskId(value: JsonValue | undefined): string | undefined {
  const text = toolResultText(value);
  if (!/Async agent launched successfully|Remote agent launched in CCR|The agent is (?:working|running) (?:in the background|remotely)/i.test(text)) {
    return undefined;
  }
  return text.match(/(?:agentId|taskId):\s*([^\s(]+)/i)?.[1];
}

function terminateCodeCliProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid) {
    const terminated = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    if (!terminated.error && terminated.status === 0) return;
  }
  child.kill("SIGTERM");
}

export function sandboxToPermissionMode(params: Record<string, JsonValue>): string {
  const approvalPolicy = typeof params.approvalPolicy === "string" ? params.approvalPolicy : "on-request";
  const sandboxPolicy = params.sandboxPolicy;
  const sandbox = typeof params.sandbox === "string"
    ? params.sandbox
    : sandboxPolicy && typeof sandboxPolicy === "object"
      ? String((sandboxPolicy as Record<string, JsonValue>).type ?? "default")
      : "default";
  return mapPermissionMode(sandbox, approvalPolicy);
}

export function findCodeCliBinary(
  customBin?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (customBin) return customBin;
  return findClaudeBin(env);
}
export class CodeCliBridge extends EventEmitter implements CodexRuntimeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextControlId = 1;
  private pendingControls = new Map<string, { resolve: (v: JsonValue) => void; reject: (e: unknown) => void }>();
  private status: EngineStatus = { phase: "idle", transport: "stdio" };
  private configuredModel: string | undefined = undefined;
  private configuredCwd: string | undefined = undefined;
  private configuredSandbox: string | undefined = undefined;
  private configuredApprovalPolicy: string | undefined = undefined;
  private configuredProviderId: string | undefined = undefined;
  private configuredGroupId: string | undefined = undefined;
  /**
   * The owning thread this bridge serves. Sent to the relay gateway as a
   * `thread-id` header so the gateway can resolve the *latest* relay/group the
   * UI persisted for this thread on every request — letting the user switch
   * the 中转站 channel mid-session without restarting the CLI child. This
   * mirrors how Codex threads already route (the gateway reads the UI runtime
   * selection live); a Claude child otherwise pins its `ANTHROPIC_BASE_URL`
   * to whatever provider/group was set at spawn and can never move.
   */
  private configuredThreadId: string | undefined = undefined;
  private configuredReasoningEffort: string | undefined = undefined;
  /**
   * Child generation that already received the thinking budget (either via
   * the `--effort` flag or the runtime backfill below). Object identity
   * avoids pid ambiguity with fake/early children.
   */
  private thinkingBudgetChild: ChildProcessWithoutNullStreams | null = null;
  private configuredContextWindow: number | undefined = undefined;
  private configuredResumeSessionId: string | undefined = undefined;
  private claudeCodeVersion = DEFAULT_CLAUDE_CODE_VERSION;
  private sessions = new Map<string, CodeCliSession>();
  private agentProjections = new Map<string, ClaudeAgentProjection>();
  private agentGroups = new Map<string, ClaudeAgentGroup>();
  private agentGroupByTurn = new Map<string, string>();
  private agentToolUseByTaskId = new Map<string, string>();
  private pendingParentTurnResults = new Map<string, "completed" | "failed">();
  private pendingParentTurnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingTurnResolvers = new Map<string, { resolve: (v: JsonValue) => void; reject: (e: unknown) => void; threadId: string }>();
  private pendingPermissionRequests = new Map<string, {
    requestId: string;
    threadId: string;
    toolName: string;
    inputSignature: string;
  }>();
  private sessionIdToThread = new Map<string, string>();
  /** Turns whose Claude session has emitted the authoritative `idle` event. */
  private sessionIdleTurns = new Set<string>();
  /** Turn keys (`threadId:turnId`) with a native auto-compaction item still open. */
  private openCompactionItemTurnKeys = new Set<string>();
  /** Scheduled /goal auto-continuation timers, keyed by thread id. */
  private goalContinuationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Consecutive host-driven /goal continuations per thread since the last user turn. */
  private goalContinuationCounts = new Map<string, number>();
  /** Turn keys started by the /goal auto-continuation loop. */
  private goalContinuationTurnKeys = new Set<string>();
  /**
   * Background tasks (e.g. Bash `run_in_background`) are not Agent/Task
   * subagents and therefore carry no projection. Claude reports them through
   * `task_started` / `task_notification` with a `task_id`. Until a background
   * task reaches a terminal `task_notification`, the parent turn must stay
   * in-progress — otherwise the CLI's `result` (emitted when the *foreground*
   * shell exits) completes the turn while the background job is still running.
   * Keyed by `taskId → "running" | "completed" | "failed" | "interrupted"`.
   */
  private backgroundTasks = new Map<string, "running" | "completed" | "failed" | "interrupted">();
  /** parent `threadId:turnId` → set of `taskId`s that belong to that turn. */
  private backgroundTasksByTurn = new Map<string, Set<string>>();
  /** background Bash tool-use id → parent `threadId:turnId`, until Claude assigns a task id. */
  private backgroundToolUseOwners = new Map<string, string>();
  private backgroundTaskIdsByToolUse = new Map<string, string>();
  private unownedBackgroundTasksByThread = new Map<string, Set<string>>();
  private terminalAgentTasksByToolUse = new Map<string, "completed" | "failed" | "interrupted">();
  private terminalAgentTasksByTaskId = new Map<string, "completed" | "failed" | "interrupted">();
  private readonly runtimeEnvSnapshot: NodeJS.ProcessEnv;
  private readonly compactThread: ClaudeCompactionRunner;
  private childExitPromise: Promise<void> = Promise.resolve();
  /**
   * Thread currently waiting for the CLI `init` handshake (`threadId`), or
   * null when the child is ready/already failed. Drives the staged
   * `thread/claude/startup` notifications the composer status bar renders
   * (spawning → handshake → ready/failed) so a slow cold start is visible
   * instead of a bare 20s `turn/start` timeout.
   */
  private pendingHandshakeThreadId: string | null = null;

  public constructor(
    runtimeEnv: () => NodeJS.ProcessEnv = () => ({}),
    private readonly spawnCommand: typeof spawnClaudeCommand = spawnClaudeCommand,
    private readonly terminateChild: (child: ChildProcessWithoutNullStreams) => void = terminateCodeCliProcessTree,
    compactThread?: ClaudeCompactionRunner,
    private readonly onSessionSnapshot?: (snapshot: CodeCliSessionSnapshot) => void,
    /** True when the CLI runs on a remote SSH host: local sa-vm paths are not reachable there. */
    private readonly remoteHost = false,
  ) {
    super();
    this.runtimeEnvSnapshot = { ...runtimeEnv() };
    this.compactThread = compactThread ?? createClaudeCompactionRunner(this.spawnCommand, this.terminateChild);
  }

  public getStatus(): EngineStatus {
    return { ...this.status };
  }

  private claudeCodeUserAgent(): string {
    return `claude-code/${this.claudeCodeVersion}`;
  }

  /**
   * Staged Claude startup notification for the composer status bar.
   * Stages: `spawning` (process launch) → `handshake` (waiting for the CLI
   * `init` message; cold starts take 10s+) → `ready` / `failed`.
   */
  private emitClaudeStartupStage(
    threadId: string | undefined,
    stage: "spawning" | "handshake" | "ready" | "failed",
    error?: string,
  ): void {
    if (!threadId) return;
    this.emit("message", {
      method: "thread/claude/startup",
      params: { threadId, stage, at: Date.now(), ...(error ? { error } : {}) },
    } as JsonRpcMessage);
  }

  /**
   * Write the `--mcp-config` JSON attaching the shared sa-vm MCP server to a
   * file and return its path, or undefined when SA-VM is off for this thread,
   * the bundle is not installed, or the CLI runs on a remote host. A file path,
   * not inline JSON: on Windows the CLI is spawned through `claude.cmd` with
   * verbatim arguments, and cmd.exe strips the double quotes from inline JSON
   * ("MCP config file not found"). User home MCP configs are left untouched.
   */
  private buildSaVmMcpConfigFile(spawnCwd: string): string | undefined {
    try {
      if (this.remoteHost) return undefined;
      const scriptPath = resolveSaVmMcpScriptPath(spawnCwd);
      if (!scriptPath) return undefined;
      const dir = this.runtimeEnvSnapshot.CLAUDE_CONFIG_DIR || join(tmpdir(), "codex-ultra-mcp");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, "sa-vm-mcp.json");
      writeFileSync(
        file,
        JSON.stringify({ mcpServers: { "sa-vm": { command: "node", args: [scriptPath] } } }, null, 2),
        "utf8",
      );
      return file;
    } catch {
      return undefined;
    }
  }

  /**
   * Build the value for the CLI's `ANTHROPIC_CUSTOM_HEADERS` env var so each
   * request it sends carries the owning thread's id. The relay gateway reads
   * this header (see `resolveRelayGatewayTarget`) to look up the thread's
   * latest UI relay/group selection and override whatever id is baked into the
   * `ANTHROPIC_BASE_URL` path — which is what lets a Claude thread switch
   * 中转站 channels mid-session the same way a Codex thread already does.
   *
   * Returns `undefined` when the owning thread isn't known yet (e.g. before the
   * first `thread/start`), in which case the CLI simply omits the header and the
   * gateway falls back to the URL-path id — the spawn-time selection, which is
   * correct for the first turn.
   */
  private buildClaudeCustomHeadersEnv(threadId: string | undefined): string | undefined {
    // thread-id (live relay/group resolution) + stable x-opencode-session
    // (OpenCode routing/prompt-cache affinity) + backend hint (per-backend UA).
    return buildClaudeRelayCustomHeaders(threadId);
  }

  private snapshotSession(session: CodeCliSession): CodeCliSessionSnapshot {
    return {
      threadId: session.threadId,
      ...(session.parentThreadId ? { parentThreadId: session.parentThreadId } : {}),
      ...(session.agentNickname ? { agentNickname: session.agentNickname } : {}),
      ...(session.agentRole ? { agentRole: session.agentRole } : {}),
      ...(session.preview ? { preview: session.preview } : {}),
      ...(session.model ? { model: session.model } : {}),
      permissionMode: session.permissionMode,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      createdAt: session.createdAt,
      turns: session.turns.map((turn) => ({ ...turn })),
      messages: session.messages.slice(),
      goalStatus: session.goalStatus,
      ...(session.goalObjective ? { goalObjective: session.goalObjective } : {}),
      ...(typeof session.goalTokenBudget === "number" ? { goalTokenBudget: session.goalTokenBudget } : {}),
      ...(typeof session.goalBaseTokens === "number" ? { goalBaseTokens: session.goalBaseTokens } : {}),
      ...(typeof session.goalStartedAt === "number" ? { goalStartedAt: session.goalStartedAt } : {}),
      ...(session.developerInstructions ? { developerInstructions: session.developerInstructions } : {}),
      conversation: session.conversation.map((entry) => ({ ...entry })),
      ...(session.pendingCompactionSummary ? { pendingCompactionSummary: session.pendingCompactionSummary } : {}),
      ...(session.externalSessionId ? { externalSessionId: session.externalSessionId } : {}),
      ...(this.configuredProviderId ? { providerId: this.configuredProviderId } : {}),
      ...(this.configuredGroupId ? { groupId: this.configuredGroupId } : {}),
      ...(this.configuredSandbox ? { sandbox: this.configuredSandbox } : {}),
      ...(this.configuredApprovalPolicy ? { approvalPolicy: this.configuredApprovalPolicy } : {}),
      ...(this.configuredReasoningEffort ? { reasoningEffort: this.configuredReasoningEffort } : {}),
      tokenUsage: { ...session.tokenUsage },
      lastMessageUsage: { ...session.lastMessageUsage },
      ...(session.modelContextWindow ? { modelContextWindow: session.modelContextWindow } : {}),
      ...(session.taskPlan.steps.length > 0 ? { taskPlan: { steps: session.taskPlan.steps.map((step) => ({ ...step })) } } : {}),
      ...(session.approvedToolAllows.length > 0 ? { approvedToolAllows: session.approvedToolAllows.map((entry) => ({ ...entry })) } : {}),
    };
  }

  private persistSession(session: CodeCliSession | undefined): void {
    if (session) this.onSessionSnapshot?.(this.snapshotSession(session));
  }

  /**
   * Publish the thread's task list as a `plan` item, the same item type Codex
   * produces for `turn/plan/updated`. One item per turn carries the whole list,
   * so the floating task panel keeps showing it after a turn that never touched
   * the plan, and a thread reopened from history renders it from `messages`.
   */
  private emitTaskPlanItem(session: CodeCliSession, threadId: string, turnId: string): void {
    const item = buildClaudeTaskPlanItem(session.taskPlan, { threadId, turnId });
    if (!item) return;
    upsertSessionMessage(session, item);
    this.persistSession(session);
    this.emit("message", {
      method: "item/completed",
      params: { threadId, turnId, item },
    } as JsonRpcMessage);
  }

  public configure(params?: JsonValue): void {
    this.applyStartConfig(params);
  }

  public requiresRestartFor(_params?: JsonValue): boolean {
    return false;
  }

  private controlRequest(request: Record<string, JsonValue>, timeoutMs = 30_000): Promise<JsonValue> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("Claude CLI is not running"));
    const requestId = "host-" + this.nextControlId++;
    return new Promise<JsonValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingControls.delete(requestId);
        reject(new Error("Claude control request timed out: " + String(request.subtype ?? "unknown")));
      }, timeoutMs);
      this.pendingControls.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      try {
        this.writeStdin({ type: "control_request", request_id: requestId, request } as JsonValue);
      } catch (error) {
        clearTimeout(timer);
        this.pendingControls.delete(requestId);
        reject(error);
      }
    });
  }

  public async applyRuntimeConfig(params?: JsonValue): Promise<void> {
    const previousModel = this.configuredModel;
    const previousEffort = this.configuredReasoningEffort;
    this.applyStartConfig(params);
    const session = this.configuredThreadId ? this.sessions.get(this.configuredThreadId) : undefined;
    if (session) {
      if (this.configuredModel) session.model = this.configuredModel;
      if (this.configuredContextWindow && this.configuredContextWindow > 0) session.modelContextWindow = this.configuredContextWindow;
      this.persistSession(session);
    }
    if (!this.child) return;
    // Control requests need a CLI that finished its init handshake. A cold
    // bypassPermissions handshake takes 30s+; the 30s control timeout would
    // otherwise fail the very turn/start that carries the first effort
    // selection (thread/start usually doesn't). Defer instead: the next turn
    // retries once the child is ready. Failures must never break turn/start.
    if (this.pendingHandshakeThreadId) {
      logClaudeBridgeEvent("log", "runtime-config-deferred-handshake", {
        threadId: this.configuredThreadId,
        model: this.configuredModel ?? null,
        effort: this.configuredReasoningEffort ?? null,
      });
      return;
    }
    if (this.configuredModel && this.configuredModel !== previousModel) {
      try {
        await this.controlRequest({ subtype: "set_model", model: this.configuredModel });
      } catch (error) {
        logClaudeBridgeEvent("warn", "runtime-config-set-model-failed", {
          threadId: this.configuredThreadId,
          message: stringifyError(error),
        });
      }
    }
    if (this.configuredReasoningEffort && this.configuredReasoningEffort !== previousEffort) {
      const budget = CLAUDE_EFFORT_TOKEN_BUDGETS[this.configuredReasoningEffort.trim().toLowerCase()];
      if (budget !== undefined) {
        try {
          await this.controlRequest({ subtype: "set_max_thinking_tokens", max_thinking_tokens: budget });
          this.thinkingBudgetChild = this.child;
        } catch (error) {
          // Next turn retries; the current turn proceeds with CLI default.
          logClaudeBridgeEvent("warn", "runtime-config-thinking-budget-failed", {
            threadId: this.configuredThreadId,
            message: stringifyError(error),
          });
        }
      }
    }
  }

  /**
   * Backfill the thinking budget on CLIs that cannot parse `--effort`
   * (e.g. official v1.0.123, which exits(1) on the unknown flag so the flag
   * is omitted at spawn). Sends `set_max_thinking_tokens` once per child
   * generation, fire-and-forget: a control timeout must never break the turn,
   * and the next turn retries. May race the first user message, so the very
   * first turn can still use the CLI default budget.
   */
  private ensureInitialThinkingBudget(): void {
    const child = this.child;
    if (!child || this.thinkingBudgetChild === child) return;
    const wanted = this.configuredReasoningEffort?.trim().toLowerCase();
    if (!wanted || wanted === "none") return;
    const budget = CLAUDE_EFFORT_TOKEN_BUDGETS[wanted];
    if (budget === undefined) return;
    const bin = findCodeCliBinary(undefined, this.runtimeEnvSnapshot);
    if (resolveClaudeEffortForCli(bin, this.configuredReasoningEffort, this.runtimeEnvSnapshot) !== undefined) {
      // The --effort flag already carries it; nothing to backfill.
      this.thinkingBudgetChild = child;
      return;
    }
    const pid = child.pid ?? null;
    logClaudeBridgeEvent("log", "thinking-budget-apply", {
      threadId: this.configuredThreadId,
      pid,
      effort: wanted,
      budgetTokens: budget,
    });
    this.controlRequest({ subtype: "set_max_thinking_tokens", max_thinking_tokens: budget }).then(
      () => {
        this.thinkingBudgetChild = child;
        logClaudeBridgeEvent("log", "thinking-budget-applied", {
          threadId: this.configuredThreadId,
          pid,
          effort: wanted,
        });
      },
      (error) => {
        logClaudeBridgeEvent("warn", "thinking-budget-apply-failed", {
          threadId: this.configuredThreadId,
          pid,
          effort: wanted,
          message: stringifyError(error),
        });
      },
    );
  }

  public restoreSession(snapshot: CodeCliSessionSnapshot): void {
    const recoveredInterruptedTurn = snapshot.turns.some((turn) => turn.status === "running");
    const session: CodeCliSession = {
      ...snapshot,
      model: snapshot.model,
      cwd: snapshot.cwd,
      turns: snapshot.turns.map((turn) => ({
        ...turn,
        status: turn.status === "running" ? "interrupted" : turn.status,
      })),
      messages: snapshot.messages.slice(),
      conversation: snapshot.conversation.map((entry) => ({ ...entry })),
      assistantTextBlocksByTurn: new Map(),
      streamedAssistantItemsByTurn: new Map(),
      streamedReasoningItemsByTurn: new Map(),
      streamedToolBlocksByTurn: new Map(),
      // Threads persisted before the plan projection landed carry no state, so
      // rebuild it from the last plan item rather than restarting the checklist
      // from scratch at the next TaskUpdate.
      taskPlan: snapshot.taskPlan ?? restoreTaskPlanState(snapshot.messages),
      taskPlanToolUseIds: new Set(),
      tokenUsage: { ...(snapshot.tokenUsage ?? EMPTY_CLAUDE_TOKEN_USAGE) },
      currentMessageUsage: { ...EMPTY_CLAUDE_TOKEN_USAGE },
      lastMessageUsage: { ...(snapshot.lastMessageUsage ?? EMPTY_CLAUDE_TOKEN_USAGE) },
      requestUsageEmittedByTurn: new Map(),
      approvedToolAllows: (snapshot.approvedToolAllows ?? []).map((entry) => ({ ...entry })),
      // Threads persisted before the window was resolved carry no value, so
      // recompute it from the model rather than reopening them without a gauge.
      modelContextWindow: snapshot.modelContextWindow ?? resolveClaudeModelContextWindow(undefined, snapshot.model),
      activeTurnId: undefined,
    };
    this.sessions.set(snapshot.threadId, session);
    this.configuredThreadId = snapshot.threadId;
    if (snapshot.externalSessionId) {
      this.sessionIdToThread.set(snapshot.externalSessionId, snapshot.threadId);
      this.configuredResumeSessionId = snapshot.externalSessionId;
    }
    if (snapshot.model) this.configuredModel = snapshot.model;
    if (snapshot.cwd) this.configuredCwd = snapshot.cwd;
    if (snapshot.providerId) this.configuredProviderId = snapshot.providerId;
    if (snapshot.groupId) this.configuredGroupId = snapshot.groupId;
    if (snapshot.reasoningEffort) this.configuredReasoningEffort = snapshot.reasoningEffort;
    if (snapshot.modelContextWindow && snapshot.modelContextWindow > 0) this.configuredContextWindow = snapshot.modelContextWindow;
    this.configuredSandbox = snapshot.sandbox ?? (
      snapshot.permissionMode === "bypassPermissions"
        ? "dangerFullAccess"
        : snapshot.permissionMode === "plan"
          ? "readOnly"
          : "workspaceWrite"
    );
    this.configuredApprovalPolicy = snapshot.approvalPolicy
      ?? (snapshot.permissionMode === "bypassPermissions" ? "never" : "on-request");
    if (recoveredInterruptedTurn) this.persistSession(session);
  }

  public getSessionSnapshot(threadId: string): CodeCliSessionSnapshot | null {
    const session = this.sessions.get(threadId);
    return session ? this.snapshotSession(session) : null;
  }

  /**
   * The session ID to hand `--resume`, or `undefined` when the CLI could not
   * load it. A resume only works while the transcript survives in this thread's
   * config directory; when it is gone the CLI aborts with "No conversation
   * found with session ID" and the reopened thread can never take another turn.
   * Start a fresh CLI session instead and replay the transcript we persisted
   * ourselves, so the conversation continues with its context intact.
   */
  private resolveResumeSessionId(spawnCwd: string): string | undefined {
    const resumeSessionId = this.configuredResumeSessionId;
    if (!resumeSessionId) {
      // Threads persisted without an external session id (older builds never
      // captured it, or the CLI never reported one) cannot `--resume`, but the
      // conversation we persisted ourselves is still available. Seed the
      // replay so the fresh CLI process inherits the prior context instead of
      // starting from scratch. Child agent threads only run projected turns,
      // so they are skipped.
      for (const session of this.sessions.values()) {
        if (session.parentThreadId || session.pendingCompactionSummary) continue;
        const replay = buildConversationReplay(session);
        if (!replay) continue;
        session.pendingCompactionSummary = replay;
        this.persistSession(session);
      }
      return undefined;
    }
    const configDir = this.runtimeEnvSnapshot.CLAUDE_CONFIG_DIR;
    if (claudeTranscriptExists(configDir, spawnCwd, resumeSessionId) !== false) return resumeSessionId;

    this.configuredResumeSessionId = undefined;
    this.sessionIdToThread.delete(resumeSessionId);
    for (const session of this.sessions.values()) {
      if (session.externalSessionId !== resumeSessionId) continue;
      session.externalSessionId = undefined;
      session.pendingCompactionSummary = session.pendingCompactionSummary ?? buildConversationReplay(session);
      this.persistSession(session);
    }
    this.emit(
      "stderr",
      "Claude session " + resumeSessionId + " has no transcript left to resume; continuing in a new session with replayed context\n",
    );
    return undefined;
  }

  public async start(): Promise<EngineStatus> {
    if (this.status.phase === "ready" || this.status.phase === "starting") {
      return this.getStatus();
    }

    if (!this.configuredProviderId || !this.configuredGroupId) {
      throw new Error("Claude CLI requires a thread-scoped relay provider and group before startup");
    }

    const bin = findCodeCliBinary(undefined, this.runtimeEnvSnapshot);
    const runtimeEnv = this.runtimeEnvSnapshot;
    if (!bin?.trim()) {
      const message = "Claude CLI is not installed. Set CODEX_UI_CLAUDE_BIN to a runnable claude executable.";
      logClaudeBridgeEvent("error", "start-bin-missing", {
        threadId: this.configuredThreadId,
        providerId: this.configuredProviderId,
        groupId: this.configuredGroupId,
        message,
      });
      this.setStatus({ ...this.status, phase: "error", message });
      throw new Error(message);
    }
    const gatewayToken = runtimeEnv.CODEX_UI_RELAY_GATEWAY_TOKEN?.trim();
    const gatewayPort = runtimeEnv.CODEX_UI_PORT?.trim() || "43110";
    if (!gatewayToken) {
      throw new Error("Claude CLI requires a thread-scoped relay gateway credential before startup");
    }
    const permissionMode = mapPermissionMode(this.configuredSandbox ?? "default", this.configuredApprovalPolicy ?? "on-request");
    // The cxu Bun standalone server runs with a different process cwd
    // (homedir) than the old Electron wrapper, so a stale/deleted workspace
    // path must not reach spawn directly — Windows reports it as a bare
    // `uv_spawn cmd.exe ENOENT` and the turn then dies as an anonymous
    // timeout. Create the directory first; fail fast naming the cwd.
    let spawnCwd: string;
    try {
      spawnCwd = ensureClaudeSpawnCwd(this.configuredCwd || process.cwd());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logClaudeBridgeEvent("error", "start-ensure-cwd-failed", {
        threadId: this.configuredThreadId,
        providerId: this.configuredProviderId,
        groupId: this.configuredGroupId,
        model: this.configuredModel,
        cwd: this.configuredCwd || process.cwd(),
        ...spawnErrnoDetails(error),
        message,
      });
      this.setStatus({ ...this.status, phase: "error", message });
      throw error instanceof Error ? error : new Error(message);
    }
    const args = buildClaudeSpawnArgs(
      this.configuredModel,
      permissionMode,
      this.resolveResumeSessionId(spawnCwd),
      // Older CLIs (e.g. v1.0.123) exit(1) on `unknown option '--effort'`;
      // omit the flag when the installed build cannot parse it so the thread
      // boots instead of dying before the first turn.
      resolveClaudeEffortForCli(bin, this.configuredReasoningEffort, runtimeEnv),
    );
    // SA-VM mode: attach the shared sa-vm MCP server (file ops + jev_*
    // advisory actions ride one `sa_vm_run` tool) without touching the user's
    // home config — per-spawn `--mcp-config`, user MCPs preserved.
    const saVmMcpConfigFile = this.buildSaVmMcpConfigFile(spawnCwd);
    if (saVmMcpConfigFile) args.push("--mcp-config", saVmMcpConfigFile);
    // Tell the CLI to send a `thread-id` header on every request so the relay
    // gateway can resolve this thread's latest UI relay/group selection live —
    // the same mechanism Codex threads use to switch channels mid-session.
    // `buildSafeClaudeEnv` strips ANTHROPIC_CUSTOM_HEADERS from the inherited
    // environment; the override below re-supplies it after that strip, so the
    // only custom header the CLI carries is the one we set here.
    const customHeaders = this.buildClaudeCustomHeadersEnv(this.configuredThreadId);
    const safeEnv = buildSafeClaudeEnv(runtimeEnv, {
      ANTHROPIC_BASE_URL: "http://127.0.0.1:" + gatewayPort + "/api/relay-gateway/" + encodeURIComponent(this.configuredProviderId) + "/" + encodeURIComponent(this.configuredGroupId),
      ANTHROPIC_API_KEY: gatewayToken,
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
      CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
      ...(this.configuredContextWindow && this.configuredContextWindow > 0
        ? { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(this.configuredContextWindow) }
        : {}),
      ...(customHeaders ? { ANTHROPIC_CUSTOM_HEADERS: customHeaders } : {}),
    });
    // The Bun standalone server inherits a slimmer environment than the old
    // Electron wrapper; the cmd.exe shim needs an absolute ComSpec plus
    // SystemRoot in the child env or spawn fails with bare ENOENT.
    if (process.platform === "win32") {
      if (!safeEnv.ComSpec && !safeEnv.COMSPEC) {
        safeEnv.ComSpec = runtimeEnv.ComSpec || runtimeEnv.COMSPEC
          || process.env.ComSpec || process.env.COMSPEC
          || "C:\\Windows\\System32\\cmd.exe";
      }
      if (!safeEnv.SystemRoot && !safeEnv.SYSTEMROOT && (runtimeEnv.SystemRoot || process.env.SystemRoot)) {
        safeEnv.SystemRoot = (runtimeEnv.SystemRoot || process.env.SystemRoot) as string;
      }
    }
    this.status = {
      phase: "starting",
      transport: "stdio",
      message: "Starting Claude CLI stream-json",
      startedAt: Date.now(),
    };
    this.emit("status", this.getStatus());

    this.emitClaudeStartupStage(this.configuredThreadId, "spawning");
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnCommand(bin, args, {
        cwd: spawnCwd,
        env: safeEnv,
      });
    } catch (error) {
      const message = `Failed to start Claude CLI (bin="${bin}" cwd="${spawnCwd}"): ${stringifyError(error)}`;
      logClaudeBridgeEvent("error", "start-spawn-sync-failed", {
        threadId: this.configuredThreadId,
        providerId: this.configuredProviderId,
        groupId: this.configuredGroupId,
        model: this.configuredModel,
        permissionMode,
        bin,
        cwd: spawnCwd,
        resumeSessionId: this.configuredResumeSessionId ?? null,
        hasGatewayToken: Boolean(gatewayToken),
        gatewayPort,
        ...spawnErrnoDetails(error),
        message,
      });
      this.setStatus({ ...this.status, phase: "error", message });
      this.emitClaudeStartupStage(this.configuredThreadId, "failed", message);
      throw new Error(message);
    }
    this.pendingHandshakeThreadId = this.configuredThreadId ?? null;
    this.emitClaudeStartupStage(this.configuredThreadId, "handshake");
    logClaudeBridgeEvent("log", "start-spawn-ok", {
      threadId: this.configuredThreadId,
      providerId: this.configuredProviderId,
      groupId: this.configuredGroupId,
      model: this.configuredModel,
      permissionMode,
      bin,
      cwd: spawnCwd,
      pid: child.pid ?? null,
    });

    this.child = child;
    // A fresh child generation has not received the thinking budget yet;
    // the first turn/start backfills it when `--effort` was omitted.
    this.thinkingBudgetChild = null;

    let resolveChildExit: () => void = () => undefined;
    let childExitSettled = false;
    this.childExitPromise = new Promise<void>((resolve) => {
      resolveChildExit = resolve;
    });
    const settleChildExit = () => {
      if (childExitSettled) return;
      childExitSettled = true;
      resolveChildExit();
    };

    // A CLI that dies before its first line of stdout (missing runtime, invalid
    // flag, bad config) explains itself only on stderr. Keep a bounded tail and
    // attach it to the failure so the surfaced message is actionable instead of
    // a bare "exited with code 1".
    const stderrTail: string[] = [];
    let stderrTailSize = 0;
    const pushStderrTail = (line: string) => {
      const trimmed = redactSecrets(line.trim());
      if (!trimmed) return;
      stderrTail.push(trimmed);
      stderrTailSize += trimmed.length + 1;
      while (stderrTail.length > 1 && stderrTailSize > CLAUDE_STDERR_TAIL_BUDGET) {
        stderrTailSize -= (stderrTail.shift()?.length ?? 0) + 1;
      }
    };
    child.stderr.on("data", (chunk: Buffer) => pushStderrTail(chunk.toString("utf8")));
    const stderrSummary = (): string => {
      const text = stderrTail.join("\n").trim();
      if (!text) return "";
      const lines = text.split("\n");
      const last = lines[lines.length - 1] ?? "";
      return lines.length > 1
        ? `${lines[0]?.slice(0, 400) ?? ""} ... ${last.slice(0, 400)}`
        : last.slice(0, 800);
    };

    child.once("exit", (code, signal) => {
      settleChildExit();
      if (this.pendingHandshakeThreadId) {
        const pendingThread = this.pendingHandshakeThreadId;
        this.pendingHandshakeThreadId = null;
        const detail = stderrSummary();
        this.emitClaudeStartupStage(
          pendingThread,
          "failed",
          "Claude CLI exited with code " + (code ?? "null") + " signal " + (signal ?? "null") + (detail ? `: ${detail}` : ""),
        );
      }
      logClaudeBridgeEvent(code === 0 ? "log" : "error", "child-exit", {
        threadId: this.configuredThreadId,
        bin,
        cwd: spawnCwd,
        pid: child.pid ?? null,
        code,
        signal: signal ?? null,
        stderr: stderrSummary() || null,
      });
      const detail = stderrSummary();
      this.invalidateChild(
        child,
        "Claude CLI exited with code " + (code ?? "null") + " signal " + (signal ?? "null") + (detail ? `: ${detail}` : ""),
      );
    });
    child.once("error", (error) => {
      settleChildExit();
      logClaudeBridgeEvent("error", "child-error", {
        threadId: this.configuredThreadId,
        bin,
        cwd: spawnCwd,
        pid: child.pid ?? null,
        ...spawnErrnoDetails(error),
        message: stringifyError(error),
      });
      this.invalidateChild(child, stringifyError(error));
    });
    child.stdin.once("error", (error) => {
      logClaudeBridgeEvent("error", "child-stdin-error", {
        threadId: this.configuredThreadId,
        bin,
        cwd: spawnCwd,
        pid: child.pid ?? null,
        ...spawnErrnoDetails(error),
        message: stringifyError(error),
      });
      this.invalidateChild(child, "Claude CLI stdin failed: " + stringifyError(error));
    });

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.handleLine(line));
    let claudeStderrLines = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      const message = redactSecrets(chunk.toString("utf8").trim());
      if (message.length > 0) {
        claudeStderrLines += 1;
        // Sample to disk: first line plus anything matching a failure signature.
        // Full stderr still flows through the `stderr` event (desktop log handler).
        if (claudeStderrLines === 1 || /error|enoent|uv_spawn|fail|denied|not found/i.test(message)) {
          logClaudeBridgeEvent("warn", "child-stderr", {
            threadId: this.configuredThreadId,
            pid: child.pid ?? null,
            line: claudeStderrLines,
            stderr: message.slice(0, 2000),
          });
        }
        this.emit("stderr", message);
      }
    });

    this.status = {
      ...this.status,
      phase: "ready",
      message: "Claude CLI ready",
    };
    this.emit("status", this.getStatus());
    return this.getStatus();
  }

  public stop(): void {
    for (const pending of this.pendingControls.values()) {
      pending.reject(new Error("Claude CLI stopped"));
    }
    this.pendingControls.clear();
    for (const pending of this.pendingTurnResolvers.values()) {
      pending.reject(new Error("Claude CLI stopped"));
    }
    this.pendingTurnResolvers.clear();
    this.pendingPermissionRequests.clear();
    this.pendingParentTurnResults.clear();
    for (const timer of this.pendingParentTurnTimers.values()) clearTimeout(timer);
    this.pendingParentTurnTimers.clear();
    this.backgroundTasks.clear();
    this.backgroundTasksByTurn.clear();
    this.backgroundToolUseOwners.clear();
    this.backgroundTaskIdsByToolUse.clear();
    this.sessionIdleTurns.clear();
    this.unownedBackgroundTasksByThread.clear();
    this.terminalAgentTasksByToolUse.clear();
    this.terminalAgentTasksByTaskId.clear();
    for (const timer of this.goalContinuationTimers.values()) clearTimeout(timer);
    this.goalContinuationTimers.clear();
    this.goalContinuationTurnKeys.clear();
    this.openCompactionItemTurnKeys.clear();
    this.setStatus({ ...this.status, phase: "stopped", message: "Stopped" });
    const child = this.child;
    try { if (child) this.terminateChild(child); } catch {
      try { child?.kill("SIGTERM"); } catch { /* Already exited. */ }
    }
    this.child = null;
  }

  public async waitForExit(timeoutMs = 5_000): Promise<boolean> {
    const childExitPromise = this.childExitPromise;
    if (timeoutMs <= 0) {
      await childExitPromise;
      return true;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([
      childExitPromise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return exited;
  }

  public async restart(): Promise<EngineStatus> {
    this.stop();
    await this.waitForExit();
    return this.start();
  }

  private applyStartConfig(params?: JsonValue): void {
    const p = (params && typeof params === "object" && !Array.isArray(params)) ? params as Record<string, JsonValue> : {};
    if (!p) return;
    const threadId = typeof p.threadId === "string" ? p.threadId : undefined;
    if (threadId) this.configuredThreadId = threadId;
    const model = typeof p.model === "string" ? p.model : undefined;
    if (model) this.configuredModel = model;
    const reasoningEffort = typeof p.reasoningEffort === "string"
      ? p.reasoningEffort
      : typeof p.effort === "string" ? p.effort : undefined;
    if (reasoningEffort) this.configuredReasoningEffort = reasoningEffort;
    const contextWindow = finiteTokenCount(p.contextWindow ?? p.modelContextWindow);
    if (contextWindow && contextWindow > 0) this.configuredContextWindow = contextWindow;
    const cwd = typeof p.cwd === "string" ? p.cwd : undefined;
    if (cwd) this.configuredCwd = cwd;
    // Absent permission fields must preserve the previously configured values:
    // `resolveClaudeBridgeForThread` re-configures live bridges with just
    // `{ threadId }`, and clobbering dangerBypass here would make the next CLI
    // spawn (crash recovery, compaction, idle restart) come up unprivileged.
    const sandbox = typeof p.sandbox === "string"
      ? p.sandbox
      : typeof p.sandboxPolicy === "object" && p.sandboxPolicy
        ? String((p.sandboxPolicy as Record<string, JsonValue>)?.type ?? "") || undefined
        : undefined;
    if (sandbox) this.configuredSandbox = sandbox;
    const approvalPolicy = typeof p.approvalPolicy === "string" ? p.approvalPolicy : undefined;
    if (approvalPolicy) this.configuredApprovalPolicy = approvalPolicy;
    const workspace = p.workspace && typeof p.workspace === "object" && !Array.isArray(p.workspace)
      ? p.workspace as Record<string, JsonValue>
      : {};
    const providerId = typeof p.providerId === "string"
      ? p.providerId
      : typeof p.modelProvider === "string"
        ? p.modelProvider
        : typeof workspace.providerId === "string"
          ? workspace.providerId
          : undefined;
    if (providerId) this.configuredProviderId = providerId;
    const groupId = typeof p.groupId === "string"
      ? p.groupId
      : typeof workspace.groupId === "string"
        ? workspace.groupId
        : undefined;
    if (groupId) this.configuredGroupId = groupId;
    const resumeSessionId = typeof p.resumeSessionId === "string"
      ? p.resumeSessionId
      : typeof p.externalSessionId === "string"
        ? p.externalSessionId
        : undefined;
    if (resumeSessionId) this.configuredResumeSessionId = resumeSessionId;
  }

  public async request(method: string, params?: JsonValue, timeoutMs = 60_000): Promise<JsonValue> {
    if (method === "thread/fork") {
      throw new Error("Claude backend does not support thread/fork");
    }
    if (!this.child) {
      if (method === "turn/interrupt") return this.handleMethod(method, params ?? {}, timeoutMs);
      if (!codeCliNeedsRunningProcess(method)) {
        return this.handleMethod(method, params ?? {}, timeoutMs);
      }
      if (method === "thread/start") {
        this.applyStartConfig(params);
      }
      await this.start();
    }
    if (!this.child) throw new Error("Claude CLI is not running");
    return this.handleMethod(method, params ?? {}, timeoutMs);
  }

  public async notify(method: string, params?: JsonValue): Promise<void> {
    await this.handleMethod(method, params ?? {}, 0);
  }

  public respond(id: JsonRpcId, result?: JsonValue, error?: JsonRpcFailure["error"]): void {
    const requestId = String(id);
    const pending = this.pendingPermissionRequests.get(requestId);
    if (pending) {
      this.pendingPermissionRequests.delete(requestId);
      const session = pending.threadId ? this.sessions.get(pending.threadId) : undefined;
      const allowed = !error && permissionResponseAllows(result);
      if (allowed && session && !hasApprovedToolAllow(session, pending.toolName, pending.inputSignature)) {
        // "acceptForSession" only lives inside the current CLI process, so
        // store it as a tool-level wildcard: compaction restarts the CLI and
        // would otherwise drop the grant and re-ask for every call.
        session.approvedToolAllows.push({
          toolName: pending.toolName,
          inputSignature: permissionResponseScopeIsSession(result) ? "*" : pending.inputSignature,
        });
        this.persistSession(session);
      }
      const response: JsonValue = buildControlResponse(
        pending.requestId,
        allowed,
        error?.message ?? "Permission denied by user",
      );
      this.writeStdin(response);
      const activeTurnId = pending.threadId ? this.sessions.get(pending.threadId)?.activeTurnId : undefined;
      if (pending.threadId && activeTurnId) this.finishPendingParentTurn(pending.threadId, activeTurnId);
      if (!pending.threadId) {
        for (const session of this.sessions.values()) {
          if (session.activeTurnId) this.finishPendingParentTurn(session.threadId, session.activeTurnId);
        }
      }
    }
  }

  private writeStdin(message: JsonValue): void {
    const child = this.child;
    if (!child || child.killed === true || child.exitCode != null || child.signalCode != null || child.stdin.destroyed || !child.stdin.writable) {
      const error = new Error("Claude CLI process is not running or stdin is not writable");
      logClaudeBridgeEvent("error", "stdin-not-writable", {
        threadId: this.configuredThreadId,
        hasChild: Boolean(child),
        killed: child?.killed ?? null,
        exitCode: child?.exitCode ?? null,
        signalCode: child?.signalCode ?? null,
        stdinDestroyed: child?.stdin.destroyed ?? null,
        stdinWritable: child?.stdin.writable ?? null,
        pid: child?.pid ?? null,
      });
      if (child) this.invalidateChild(child, error.message);
      throw error;
    }
    try {
      child.stdin.write(JSON.stringify(message) + "\n", (error) => {
        if (error) {
          logClaudeBridgeEvent("error", "stdin-write-callback-failed", {
            threadId: this.configuredThreadId,
            pid: child.pid ?? null,
            ...spawnErrnoDetails(error),
            message: stringifyError(error),
          });
          this.invalidateChild(child, "Claude CLI stdin failed: " + stringifyError(error));
        }
      });
    } catch (error) {
      const messageText = stringifyError(error);
      logClaudeBridgeEvent("error", "stdin-write-throw", {
        threadId: this.configuredThreadId,
        pid: child.pid ?? null,
        ...spawnErrnoDetails(error),
        message: messageText,
      });
      this.invalidateChild(child, "Claude CLI stdin failed: " + messageText);
      throw error;
    }
  }

  /**
   * Flush assistant/reasoning text that accumulated in the streaming maps but
   * was not yet committed to session.messages. Used by the result handler on a
   * normal turn end and by the interrupt handler so a stopped turn still returns
   * its streamed content on thread/read.
   */
  private flushStreamedAssistantItems(session: CodeCliSession, threadId: string, activeTurnId: string): void {
    const streamedReasoningItems = session.streamedReasoningItemsByTurn.get(activeTurnId);
    if (streamedReasoningItems) {
      for (const [itemId, text] of streamedReasoningItems) {
        if (!text) continue;
        const item = {
          type: "reasoning",
          id: itemId,
          turnId: activeTurnId,
          threadId,
          text,
          status: "completed",
        };
        this.emit("message", {
          method: "item/completed",
          params: { threadId, turnId: activeTurnId, item },
        } as JsonRpcMessage);
        session.messages.push(item as JsonValue);
      }
      session.streamedReasoningItemsByTurn.delete(activeTurnId);
    }
    const streamedItems = session.streamedAssistantItemsByTurn.get(activeTurnId);
    if (streamedItems) {
      for (const [itemId, text] of streamedItems) {
        if (!text) continue;
        const item = {
          type: "agentMessage",
          id: itemId,
          turnId: activeTurnId,
          threadId,
          content: text,
          role: "assistant",
          status: "completed",
        };
        this.emit("message", {
          method: "item/completed",
          params: { threadId, turnId: activeTurnId, item },
        } as JsonRpcMessage);
        session.messages.push(item as JsonValue);
        const turnBlocks = session.assistantTextBlocksByTurn.get(activeTurnId) ?? [];
        if (!turnBlocks.includes(text)) turnBlocks.push(text);
        session.assistantTextBlocksByTurn.set(activeTurnId, turnBlocks);
        const normalizedText = normalizeAssistantText(text);
        const previousConversation = session.conversation.at(-1);
        if (normalizedText && !(previousConversation?.role === "assistant"
          && normalizeAssistantText(previousConversation.text) === normalizedText)) {
          session.conversation.push({ role: "assistant", text: normalizedText });
        }
      }
      session.streamedAssistantItemsByTurn.delete(activeTurnId);
    }
    session.streamedToolBlocksByTurn.delete(activeTurnId);
    session.activeStreamMessageId = undefined;
  }

  private async handleMethod(method: string, params: JsonValue, _timeoutMs: number): Promise<JsonValue> {
    const p = params as Record<string, JsonValue>;

    switch (method) {
      case "initialize":
      case "config/read":
        return {
          userAgent: this.claudeCodeUserAgent(),
          codexHome: process.env.CODEX_HOME || "",
          capabilities: { experimentalApi: true },
        } as JsonValue;

      case "thread/start": {
        const threadId = (typeof p.threadId === "string" ? p.threadId : null) || randomUUID();
        this.configuredThreadId = threadId;
        const model = typeof p.model === "string" ? p.model : undefined;
        if (model && !this.configuredModel) {
          this.configuredModel = model;
        }
        const cwd = typeof p.cwd === "string" ? p.cwd : undefined;
        if (cwd && !this.configuredCwd) {
          this.configuredCwd = cwd;
        }
        const developerInstructions = typeof p.developerInstructions === "string" && p.developerInstructions.trim()
          ? p.developerInstructions.trim()
          : undefined;
        const permissionMode = sandboxToPermissionMode(p);
        const session: CodeCliSession = {
          threadId,
          model,
          permissionMode,
          cwd,
          developerInstructions,
          createdAt: Date.now(),
          turns: [],
          messages: [],
          assistantTextBlocksByTurn: new Map(),
          streamedAssistantItemsByTurn: new Map(),
          streamedReasoningItemsByTurn: new Map(),
          streamedToolBlocksByTurn: new Map(),
          taskPlan: createClaudeTaskPlanState(),
          taskPlanToolUseIds: new Set(),
          tokenUsage: { ...EMPTY_CLAUDE_TOKEN_USAGE },
          currentMessageUsage: { ...EMPTY_CLAUDE_TOKEN_USAGE },
          lastMessageUsage: { ...EMPTY_CLAUDE_TOKEN_USAGE },
          requestUsageEmittedByTurn: new Map(),
          approvedToolAllows: [],
          goalStatus: null,
          conversation: [],
          // Seed the gauge from the selected model so the composer shows the
          // right window (1M for a `[1m]` choice) before the first result
          // message arrives with the CLI's own usage report.
          modelContextWindow: this.configuredContextWindow ?? resolveClaudeModelContextWindow(undefined, model ?? this.configuredModel),
        };
        this.sessions.set(threadId, session);
        this.persistSession(session);
        // 新机器自举：按工程目录落盘 MCP + 7 方 skill（含 jev，cwd 缺省时跳过）。
        if (cwd?.trim()) bootstrapProjectSaVmAssets(cwd, threadId);
        this.emit("message", {
          method: "thread/started",
          params: { thread: { id: threadId, model, cliBackend: "claude", status: { type: "idle" }, cwd } },
        } as JsonRpcMessage);
        // Backfill the correlation the start phase cannot have: on the create
        // path there is no threadId yet when ensure/spawn log, so link the
        // newborn thread to the child here.
        logClaudeBridgeEvent("log", "thread-created", {
          threadId,
          model,
          cwd,
          pid: this.child?.pid ?? null,
          providerId: this.configuredProviderId,
          groupId: this.configuredGroupId,
          permissionMode: this.configuredSandbox && this.configuredApprovalPolicy
            ? `${this.configuredSandbox}/${this.configuredApprovalPolicy}`
            : undefined,
        });
        return { thread: { id: threadId, model, cliBackend: "claude", status: { type: "idle" } } } as JsonValue;
      }

      case "turn/start":
      case "turn/steer": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        if (!session) throw new Error("Unknown thread: " + threadId);
        const expectedTurnId = typeof p.expectedTurnId === "string" ? p.expectedTurnId : undefined;
        const turnId = method === "turn/steer"
          ? session.activeTurnId
          : typeof p.turnId === "string" ? p.turnId : randomUUID();
        if (method === "turn/steer" && !turnId) {
          throw new Error("No active turn");
        }
        if (method === "turn/steer" && expectedTurnId && expectedTurnId !== turnId) {
          throw new Error(`Expected active turn id '${expectedTurnId}' but found '${turnId}'`);
        }
        if (method === "turn/start" && session.activeTurnId && this.goalContinuationTurnKeys.has(`${threadId}:${session.activeTurnId}`)) {
          // A host-driven /goal continuation owns the CLI. Preempt it so the
          // user's message is never rejected with "Turn is already active".
          const preemptedTurnId = session.activeTurnId;
          const preemptedKey = `${threadId}:${preemptedTurnId}`;
          this.goalContinuationTurnKeys.delete(preemptedKey);
          this.pendingParentTurnResults.delete(preemptedKey);
          try {
            this.writeStdin({
              type: "control_request",
              request_id: "interrupt-" + this.nextControlId++,
              request: { subtype: "interrupt" },
            } as JsonValue);
          } catch {
            // The CLI already exited; the new prompt below restarts it.
          }
          const preemptedTurn = session.turns.find((entry) => entry.id === preemptedTurnId);
          if (preemptedTurn) preemptedTurn.status = "interrupted";
          session.activeTurnId = undefined;
        }
        if (method === "turn/start" && session.activeTurnId) {
          const staleTurnId = session.activeTurnId;
          const staleKey = `${threadId}:${staleTurnId}`;
          if (this.pendingParentTurnResults.has(staleKey)
            && this.sessionIdleTurns.has(staleKey)
            && !this.hasRunningAgents(threadId, staleTurnId)
            && !this.hasPendingBackgroundTasks(threadId, staleTurnId)
            && !this.hasOpenPermissionRequest(threadId)) {
            this.completeParentTurn(threadId, staleTurnId, this.pendingParentTurnResults.get(staleKey)!);
          }
        }
        if (method === "turn/start" && session.activeTurnId) {
          throw new Error(`Turn is already active: ${session.activeTurnId}`);
        }
        const turnInput = await extractTurnInput(p);
        const userContent = turnInput.text;
        const hasInput = Boolean(userContent) || turnInput.images.length > 0;
        for (const warning of turnInput.warnings) this.emit("stderr", warning + "\n");
        // SA-VM skill arrives per turn from the frontend VM gate (same pattern
        // as agy/grok/pi): keep session + spawn config in sync, then prefix.
        const recordDevInstructions = typeof p.developerInstructions === "string" && p.developerInstructions.trim()
          ? p.developerInstructions.trim()
          : undefined;
        if (recordDevInstructions) {
          session.developerInstructions = recordDevInstructions;
          this.persistSession(session);
        }

        if (method === "turn/start") {
          // Session-state events are authoritative for this turn only.
          this.sessionIdleTurns.delete(`${threadId}:${turnId}`);
          // A user-initiated turn resets the /goal auto-continuation budget.
          this.clearGoalContinuationTimer(threadId);
          this.goalContinuationCounts.delete(threadId);
          session.turns.push({ id: turnId!, status: "running", createdAt: Date.now() });
          session.activeTurnId = turnId;
          session.currentMessageUsage = { ...EMPTY_CLAUDE_TOKEN_USAGE };
          // `lastMessageUsage` is deliberately NOT reset: the context gauge is
          // a property of the whole conversation (the prompt grows every
          // request), so zeroing it per turn made the usage read ≈0 until the
          // first assistant message of each turn landed, then jump.
          session.assistantTextBlocksByTurn.set(turnId!, []);
          session.streamedAssistantItemsByTurn.set(turnId!, new Map());
          session.streamedReasoningItemsByTurn.set(turnId!, new Map());
          session.streamedToolBlocksByTurn.set(turnId!, new Map());
          session.activeStreamMessageId = undefined;
          this.persistSession(session);
          this.emit("message", {
            method: "turn/started",
            params: { threadId, turn: { id: turnId, threadId, status: "running" } },
          } as JsonRpcMessage);
        }
        if (method === "turn/start") this.ensureInitialThinkingBudget();

        if (hasInput) {
          // Echo the composer blocks so the transcript renders attachments the
          // same way it does for Codex; `displayText` is what the user typed,
          // without the `@"path"` refs added for the CLI.
          const itemContent: JsonValue[] = [];
          if (turnInput.displayText) {
            itemContent.push({ type: "text", text: turnInput.displayText, text_elements: [] });
          }
          itemContent.push(...turnInput.attachmentBlocks);
          const userItem: Record<string, JsonValue> = {
            type: "userMessage",
            id: method === "turn/start" ? `claude-user-${turnId}` : `claude-user-${turnId}-${randomUUID()}`,
            turnId: turnId!,
            threadId,
            content: itemContent,
            role: "user",
            status: "completed",
            startedAt: Math.floor(Date.now() / 1000),
          };
          upsertSessionMessage(session, userItem);
          if (userContent) session.conversation.push({ role: "user", text: userContent });
          this.persistSession(session);
          this.emit("message", {
            method: "item/completed",
            params: { threadId, turnId, item: userItem },
          } as JsonRpcMessage);
          const pendingSummary = session.pendingCompactionSummary;
          const summaryWrapped = pendingSummary
            ? `<conversation-summary>\n${pendingSummary}\n</conversation-summary>\n\nContinue the conversation with this new user message:\n${userContent}`
            : userContent;
          const devInstructions = session.developerInstructions?.trim() ? session.developerInstructions.trim() : undefined;
          const skillPrefixed = devInstructions
            ? `${devInstructions}\n\n[User Instruction]\n${summaryWrapped}`
            : summaryWrapped;
          const isContinuationNudge = isMiniContinuationNudge(userContent);
          if (session.goalStatus === "active" && session.goalObjective?.trim()) {
            if (!isContinuationNudge && userContent.trim() && userContent.trim() !== session.goalObjective.trim()) {
              session.goalObjective = userContent.trim();
              session.goalBaseTokens = totalClaudeTokens(session.tokenUsage);
              session.goalStartedAt = Date.now();
              this.goalContinuationCounts.delete(threadId);
              this.clearGoalContinuationTimer(threadId);
              this.persistSession(session);
              this.emit("message", {
                method: "thread/goal/updated",
                params: { goal: claudeGoalState(session) },
              } as JsonRpcMessage);
            }
          }
          const effectiveText = this.applyGoalDirective(session, skillPrefixed);
          try {
            this.writeStdin({
              type: "user",
              message: { role: "user", content: buildClaudeUserContent(effectiveText, turnInput.images) },
              parent_tool_use_id: null,
            } as JsonValue);
          } catch (stdinErr) {
            // writeStdin throws AFTER activeTurnId + turn/started are set (e.g. child
            // died on relay 401/403/tool_use incompatibility). Without cleanup the
            // next send hits "Turn is already active" forever. Idempotent: only
            // clear when this turn still owns the slot.
            const messageText = stdinErr instanceof Error ? stdinErr.message : String(stdinErr);
            if (session.activeTurnId === turnId) session.activeTurnId = undefined;
            const failedTurn = session.turns.find((t) => t.id === turnId);
            if (failedTurn && failedTurn.status === "running") failedTurn.status = "failed";
            this.persistSession(session);
            this.emit("message", {
              method: "turn/failed",
              params: { threadId, turnId, error: messageText },
            } as JsonRpcMessage);
            throw stdinErr;
          }
          if (pendingSummary) {
            session.pendingCompactionSummary = undefined;
            this.persistSession(session);
          }
        }

        // Return immediately — the turn runs asynchronously and terminal
        // events (turn/completed, turn/failed) are emitted via notifications.
        return { turn: { id: turnId!, threadId, status: "running" } } as JsonValue;
      }

      case "turn/steer/end":
      case "thread/steer": {
        const steerInput = await extractTurnInput(p);
        for (const warning of steerInput.warnings) this.emit("stderr", warning + "\n");
        if (steerInput.text || steerInput.images.length > 0) {
          this.writeStdin({
            type: "user",
            message: { role: "user", content: buildClaudeUserContent(steerInput.text, steerInput.images) },
            parent_tool_use_id: null,
          } as JsonValue);
        }
        return {} as JsonValue;
      }

      case "turn/interrupt": {
        if (this.child) {
          this.writeStdin({
            type: "control_request",
            request_id: "interrupt-" + this.nextControlId++,
            request: { subtype: "interrupt" },
          } as JsonValue);
        }
        const interruptThreadId = typeof p.threadId === "string" ? p.threadId : "";
        if (interruptThreadId) {
          this.completeAgentsForParent(interruptThreadId, "interrupted");
          this.clearGoalContinuationTimer(interruptThreadId);
          this.settleOpenCompactionItems(interruptThreadId);
          const session = this.sessions.get(interruptThreadId);
          this.goalContinuationTurnKeys.delete(`${interruptThreadId}:${session?.activeTurnId ?? ""}`);
          if (session && session.activeTurnId) {
            const activeTurnId = session.activeTurnId;
            this.pendingParentTurnResults.delete(`${interruptThreadId}:${activeTurnId}`);
            // Flush assistant/reasoning text that was still streaming when the
            // user pressed Stop. Without this, the interrupt below clears
            // activeTurnId and the result handler skips its flush (guarded on
            // activeTurnId), so thread/read never returns the streamed content
            // and the waterfall loses those messages after any reload.
            this.flushStreamedAssistantItems(session, interruptThreadId, activeTurnId);
            this.clearBackgroundTasksForTurn(interruptThreadId, activeTurnId);
            for (const [pendingId, pending] of this.pendingPermissionRequests) {
              if (pending.threadId === interruptThreadId) this.pendingPermissionRequests.delete(pendingId);
            }
            session.activeTurnId = undefined;
            const turn = session.turns.find((t) => t.id === activeTurnId);
            if (turn) turn.status = "interrupted";
            this.persistSession(session);
            this.emit("message", {
              method: "turn/interrupted",
              params: {
                threadId: interruptThreadId,
                turnId: activeTurnId,
                turn: { id: activeTurnId, threadId: interruptThreadId, status: "interrupted", completedAt: Math.floor(Date.now() / 1000) },
              },
            } as JsonRpcMessage);
          }
        }
        return {} as JsonValue;
      }

      case "thread/read":
      case "thread/resume": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        if (!session) throw new Error("Unknown thread: " + threadId);
        const includeTurns = p.includeTurns !== false;
        return {
          thread: {
            id: threadId,
            parentThreadId: session.parentThreadId,
            preview: session.preview,
            agentNickname: session.agentNickname,
            agentRole: session.agentRole,
            model: session.model,
            cliBackend: "claude",
            status: { type: session.activeTurnId ? "running" : "idle" },
            cwd: session.cwd,
            turns: includeTurns ? session.turns.map((t) => ({
              id: t.id,
              threadId,
              status: t.status,
              startedAt: Math.floor(t.createdAt / 1000),
              items: session.messages.filter((m) => {
                const itemRecord = m as Record<string, JsonValue>;
                return itemRecord.turnId === t.id;
              }),
            })) : [],
          },
          items: session.messages,
        } as JsonValue;
      }

      case "thread/list": {
        const threads = Array.from(this.sessions.values()).map((s) => ({
          id: s.threadId,
          parentThreadId: s.parentThreadId,
          preview: s.preview,
          agentNickname: s.agentNickname,
          agentRole: s.agentRole,
          model: s.model,
          cliBackend: "claude",
          status: { type: s.activeTurnId ? "running" : "idle" },
          cwd: s.cwd,
          createdAt: Math.floor(s.createdAt / 1000),
          updatedAt: Math.floor(s.createdAt / 1000),
          recencyAt: Math.floor(s.createdAt / 1000),
          source: "appServer",
          turns: [],
        }));
        return { data: threads } as JsonValue;
      }

      case "thread/turns/list": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        if (!session) return { turns: [], data: [], nextCursor: null } as JsonValue;
        return pageThreadHistory(threadId, session.turns, session.messages, {
          cursor: typeof p.cursor === "string" ? p.cursor : null,
          limit: typeof p.limit === "number" ? p.limit : 32,
          sortDirection: typeof p.sortDirection === "string" ? p.sortDirection : "desc",
        }) as unknown as JsonValue;
      }

      case "thread/items/list": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        return { items: session ? session.messages : [] } as JsonValue;
      }

      case "thread/fork":
        throw new Error("Claude backend does not support thread/fork");

      case "thread/archive":
      case "thread/delete":
      case "thread/unsubscribe":
      case "thread/closed": {
        const closeThreadId = typeof p.threadId === "string" ? p.threadId : "";
        if (closeThreadId) {
          const relatedThreadIds = new Set([closeThreadId]);
          let added = true;
          while (added) {
            added = false;
            for (const candidate of this.sessions.values()) {
              if (candidate.parentThreadId && relatedThreadIds.has(candidate.parentThreadId) && !relatedThreadIds.has(candidate.threadId)) {
                relatedThreadIds.add(candidate.threadId);
                added = true;
              }
            }
          }
          for (const [toolUseId, projection] of [...this.agentProjections]) {
            if (relatedThreadIds.has(projection.parentThreadId) || relatedThreadIds.has(projection.childThreadId)) {
              this.removeAgentProjection(toolUseId);
            }
          }
          for (const relatedThreadId of relatedThreadIds) {
            const session = this.sessions.get(relatedThreadId);
            if (session?.activeTurnId) this.clearBackgroundTasksForTurn(relatedThreadId, session.activeTurnId);
            this.unownedBackgroundTasksByThread.delete(relatedThreadId);
          }
          for (const relatedThreadId of relatedThreadIds) this.sessions.delete(relatedThreadId);
          for (const key of this.pendingParentTurnResults.keys()) {
            if (relatedThreadIds.has(key.slice(0, key.lastIndexOf(":")))) {
              this.pendingParentTurnResults.delete(key);
            }
          }
          for (const [sid, tid] of this.sessionIdToThread) {
            if (relatedThreadIds.has(tid)) this.sessionIdToThread.delete(sid);
          }
          const notificationMethod = method === "thread/archive"
            ? "thread/archived"
            : method === "thread/delete"
              ? "thread/deleted"
              : method === "thread/closed"
                ? "thread/closed"
                : null;
          if (notificationMethod) {
            this.emit("message", {
              method: notificationMethod,
              params: { threadId: closeThreadId },
            } as JsonRpcMessage);
          }
        }
        return {} as JsonValue;
      }

      case "thread/name/set": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const name = typeof p.name === "string" ? p.name : "";
        // Codex persists the rollout title server-side; the Claude backend kept
        // this a no-op, so a renamed Claude thread reverted to its old preview
        // on the next `thread/list` and — when the optimistic entry had been
        // dropped — fell back under the Codex history filter. Persist the name
        // as the session preview so it survives a history reload.
        const session = this.sessions.get(threadId);
        if (session) {
          session.preview = name;
          this.persistSession(session);
        }
        return { threadId, name } as JsonValue;
      }

      case "thread/goal/set": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        // The web goal lifecycle reads `result.goal` (objective + status) and
        // treats a missing objective as "no goal", so persist both fields and
        // mirror the Codex response shape.
        const objective = typeof p.objective === "string" && p.objective.trim().length > 0
          ? p.objective.trim()
          : undefined;
        const requestedStatus = normalizeClaudeGoalStatus(typeof p.status === "string" ? p.status : "");
        const session = this.sessions.get(threadId);
        if (!session) {
          return {
            threadId,
            status: requestedStatus ?? null,
            ...(objective ? { goal: { threadId, objective, status: requestedStatus ?? "active" } } : { goal: null }),
          } as JsonValue;
        }
        const budget = normalizeGoalBudgetInput((p as Record<string, unknown>).tokenBudget ?? (p as Record<string, unknown>).token_budget ?? (p as Record<string, unknown>).budget);
        const objectiveChanged = objective !== undefined && objective !== session.goalObjective;
        const prevGoalStatus = session.goalStatus;
        if (objective !== undefined) session.goalObjective = objective;
        if (requestedStatus) session.goalStatus = requestedStatus;
        else if (objective) session.goalStatus = "active";
        if (budget !== undefined) session.goalTokenBudget = budget;
        if (objectiveChanged) {
          session.goalBaseTokens = totalClaudeTokens(session.tokenUsage);
          session.goalStartedAt = Date.now();
          // Same rule as mini: a new objective without an explicit budget
          // drops the previous cap instead of silently inheriting it.
          if (budget === undefined) session.goalTokenBudget = null;
          this.goalContinuationCounts.delete(threadId);
        } else if (requestedStatus === "active" && prevGoalStatus === "budgetLimited" && budget === undefined) {
          // Explicit user resume from budgetLimited renews the allowance.
          session.goalBaseTokens = totalClaudeTokens(session.tokenUsage);
          session.goalStartedAt = Date.now();
          this.goalContinuationCounts.delete(threadId);
        } else if (session.goalStatus === "active" && typeof session.goalStartedAt !== "number") {
          session.goalStartedAt = Date.now();
          session.goalBaseTokens = totalClaudeTokens(session.tokenUsage);
        }
        if (session.goalStatus !== "active") this.clearGoalContinuationTimer(threadId);
        if (requestedStatus === "paused" || requestedStatus === "complete") this.goalContinuationCounts.delete(threadId);
        if (session.goalStatus === "active" && isClaudeGoalBudgetExhausted(session)) {
          session.goalStatus = "budgetLimited";
          this.clearGoalContinuationTimer(threadId);
          this.goalContinuationCounts.delete(threadId);
        }
        this.persistSession(session);
        const goal = claudeGoalState(session);
        this.emit("message", { method: "thread/goal/updated", params: { goal } } as JsonRpcMessage);
        return { threadId, status: session.goalStatus, goal } as JsonValue;
      }

      case "thread/goal/get": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        if (!session || !session.goalObjective) {
          return { threadId, status: session?.goalStatus ?? null, goal: null } as JsonValue;
        }
        return { threadId, status: session.goalStatus, goal: claudeGoalState(session) } as JsonValue;
      }

      case "thread/goal/clear": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        if (session) {
          session.goalStatus = null;
          session.goalObjective = null;
          session.goalTokenBudget = null;
          session.goalBaseTokens = undefined;
          session.goalStartedAt = undefined;
          this.clearGoalContinuationTimer(threadId);
          this.goalContinuationCounts.delete(threadId);
          this.persistSession(session);
        }
        this.emit("message", { method: "thread/goal/cleared", params: { threadId } } as JsonRpcMessage);
        return {} as JsonValue;
      }

      case "thread/inject_items": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        if (session && Array.isArray(p.items)) {
          for (const item of p.items) {
            session.messages.push(item as JsonValue);
          }
          this.persistSession(session);
        }
        return {} as JsonValue;
      }

      case "thread/history/fileInfo":
        return { exists: false } as JsonValue;

      case "thread/history/tail":
        return { lines: [] } as JsonValue;

      case "thread/tokenUsage/updated":
        return {} as JsonValue;

      case "config/value/write":
      case "config/batchWrite":
        throw new Error("Codex config writes are not supported in Claude backend mode");

      case "thread/compact/start": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        if (!session) throw new Error("Unknown thread: " + threadId);
        if (session.activeTurnId) throw new Error("Cannot compact while a Claude turn is running");
        const routeRecord = p.__claudeCompactionRoute && typeof p.__claudeCompactionRoute === "object" && !Array.isArray(p.__claudeCompactionRoute)
          ? p.__claudeCompactionRoute as Record<string, JsonValue>
          : {};
        const route: ClaudeCompactionRoute = {
          providerId: typeof routeRecord.providerId === "string" ? routeRecord.providerId : "",
          groupId: typeof routeRecord.groupId === "string" ? routeRecord.groupId : "",
          model: typeof routeRecord.model === "string" ? routeRecord.model : "",
        };
        if (!route.providerId || !route.groupId || !route.model) throw new Error("Claude compaction requires a trusted relay route");
        const turnId = randomUUID();
        session.turns.push({ id: turnId, status: "running", createdAt: Date.now() });
        session.activeTurnId = turnId;
        this.persistSession(session);
        this.emit("message", {
          method: "turn/started",
          params: { threadId, turnId, turn: { id: turnId, threadId, status: "running" } },
        } as JsonRpcMessage);
        void this.runCompaction(session, turnId, route);
        return { turn: { id: turnId, threadId, status: "running" } } as JsonValue;
      }

      case "item/permissions/requestApproval":
      case "item/commandExecution/requestApproval":
      case "item/tool/requestUserInput":
        return {} as JsonValue;

      default:
        return {} as JsonValue;
    }
  }

  private messageThreadId(message: Record<string, JsonValue>): string | undefined {
    const parentToolUseId = typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : undefined;
    if (parentToolUseId) {
      const projection = this.agentProjections.get(parentToolUseId);
      if (projection) return projection.childThreadId;
    }
    return this.findThreadBySession(typeof message.session_id === "string" ? message.session_id : undefined);
  }

  private startAgentGroup(
    parentThreadId: string,
    parentTurnId: string,
    blocks: Array<Record<string, JsonValue>>,
  ): void {
    const parent = this.sessions.get(parentThreadId);
    const newBlocks = blocks.filter((block) => typeof block.id === "string" && !this.agentProjections.has(block.id));
    if (!parent || newBlocks.length === 0) return;
    const turnKey = `${parentThreadId}:${parentTurnId}`;
    const existingGroupId = this.agentGroupByTurn.get(turnKey);
    const groupItemId = existingGroupId ?? `claude-agents-${parentTurnId}`;
    const group: ClaudeAgentGroup = this.agentGroups.get(groupItemId) ?? {
      itemId: groupItemId,
      parentThreadId,
      parentTurnId,
      parentToolUseIds: [],
    };
    this.agentGroups.set(groupItemId, group);
    this.agentGroupByTurn.set(turnKey, groupItemId);

    for (const block of newBlocks) {
      if (typeof block.id !== "string") continue;
      const input = jsonRecord(block.input);
      const role = firstNonEmptyString(input, ["subagent_type", "agent_type", "role", "name"])
        ?? (block.name === "Task" ? "Task" : "Agent");
      const description = firstNonEmptyString(input, ["description", "name"]);
      const prompt = firstNonEmptyString(input, ["prompt", "task", "description"])
        ?? `Run ${role} agent`;
      const nickname = description ?? `${role} ${group.parentToolUseIds.length + 1}`;
      const model = firstNonEmptyString(input, ["model"]) ?? parent.model;
      const childThreadId = randomUUID();
      const childTurnId = randomUUID();
      const child: CodeCliSession = {
        threadId: childThreadId,
        parentThreadId,
        agentNickname: nickname,
        agentRole: role,
        preview: description ?? prompt,
        model,
        permissionMode: parent.permissionMode,
        cwd: parent.cwd,
        createdAt: Date.now(),
        turns: [{ id: childTurnId, status: "running", createdAt: Date.now() }],
        messages: [],
        assistantTextBlocksByTurn: new Map([[childTurnId, []]]),
        streamedAssistantItemsByTurn: new Map(),
        streamedReasoningItemsByTurn: new Map(),
        streamedToolBlocksByTurn: new Map(),
        taskPlan: createClaudeTaskPlanState(),
        taskPlanToolUseIds: new Set(),
        tokenUsage: { ...EMPTY_CLAUDE_TOKEN_USAGE },
        currentMessageUsage: { ...EMPTY_CLAUDE_TOKEN_USAGE },
        lastMessageUsage: { ...EMPTY_CLAUDE_TOKEN_USAGE },
        requestUsageEmittedByTurn: new Map(),
        approvedToolAllows: parent.approvedToolAllows.map((entry) => ({ ...entry })),
        goalStatus: null,
        activeTurnId: childTurnId,
        conversation: [{ role: "user", text: prompt }],
      };
      const projection: ClaudeAgentProjection = {
        parentToolUseId: block.id,
        parentThreadId,
        parentTurnId,
        childThreadId,
        childTurnId,
        groupItemId,
        prompt,
        model,
        nickname,
        role,
        status: "running",
      };
      group.parentToolUseIds.push(block.id);
      this.sessions.set(childThreadId, child);
      this.persistSession(child);
      this.agentProjections.set(block.id, projection);

      this.emit("message", {
        method: "thread/started",
        params: {
          thread: {
            id: childThreadId,
            parentThreadId,
            preview: child.preview,
            agentNickname: nickname,
            agentRole: role,
            model,
            cliBackend: "claude",
            cwd: child.cwd,
            status: "running",
          },
        },
      } as JsonRpcMessage);
      this.emit("message", {
        method: "turn/started",
        params: {
          threadId: childThreadId,
          turnId: childTurnId,
          turn: { id: childTurnId, threadId: childThreadId, status: "running" },
        },
      } as JsonRpcMessage);
      const terminalStatus = this.terminalAgentTasksByToolUse.get(block.id);
      if (terminalStatus) {
        this.terminalAgentTasksByToolUse.delete(block.id);
        this.completeAgentProjection(block.id, undefined, terminalStatus);
      }
    }

    if (group.parentToolUseIds.length === 0) {
      this.agentGroups.delete(groupItemId);
      this.agentGroupByTurn.delete(turnKey);
      return;
    }
    this.emitAgentGroupItem(group, false);
  }

  private bindAgentTask(parentToolUseId: string, taskId: string | undefined): ClaudeAgentProjection | undefined {
    const projection = this.agentProjections.get(parentToolUseId);
    if (!projection) return undefined;
    if (taskId) {
      if (projection.taskId && projection.taskId !== taskId) this.agentToolUseByTaskId.delete(projection.taskId);
      projection.taskId = taskId;
      this.agentToolUseByTaskId.set(taskId, parentToolUseId);
      const terminalStatus = this.terminalAgentTasksByTaskId.get(taskId);
      if (terminalStatus) {
        this.terminalAgentTasksByTaskId.delete(taskId);
        this.completeAgentProjection(parentToolUseId, undefined, terminalStatus);
      }
    }
    return projection;
  }

  private removeAgentProjection(parentToolUseId: string): void {
    const projection = this.agentProjections.get(parentToolUseId);
    if (!projection) return;
    this.agentProjections.delete(parentToolUseId);
    if (projection.taskId) this.agentToolUseByTaskId.delete(projection.taskId);
    const group = this.agentGroups.get(projection.groupItemId);
    if (!group) return;
    group.parentToolUseIds = group.parentToolUseIds.filter((toolUseId) => toolUseId !== parentToolUseId);
    if (group.parentToolUseIds.length > 0) {
      this.emitAgentGroupItem(group, false);
      return;
    }
    this.agentGroups.delete(group.itemId);
    this.agentGroupByTurn.delete(`${group.parentThreadId}:${group.parentTurnId}`);
  }

  private agentProjectionForTask(message: Record<string, JsonValue>): ClaudeAgentProjection | undefined {
    const toolUseId = typeof message.tool_use_id === "string" ? message.tool_use_id : undefined;
    const taskId = typeof message.task_id === "string" ? message.task_id : undefined;
    if (toolUseId) return this.bindAgentTask(toolUseId, taskId);
    const mappedToolUseId = taskId ? this.agentToolUseByTaskId.get(taskId) : undefined;
    return mappedToolUseId ? this.agentProjections.get(mappedToolUseId) : undefined;
  }

  private emitAgentGroupItem(group: ClaudeAgentGroup, completed: boolean): void {
    const projections = group.parentToolUseIds
      .map((toolUseId) => this.agentProjections.get(toolUseId))
      .filter((projection): projection is ClaudeAgentProjection => Boolean(projection));
    if (projections.length === 0) return;
    const terminal = projections.every((projection) => projection.status !== "running");
    const failed = projections.some((projection) => projection.status === "failed");
    const interrupted = !failed && projections.some((projection) => projection.status === "interrupted");
    const item = {
      type: "collabAgentToolCall",
      id: group.itemId,
      turnId: group.parentTurnId,
      tool: "Agent",
      status: completed || terminal
        ? failed ? "failed" : interrupted ? "interrupted" : "completed"
        : "inProgress",
      senderThreadId: group.parentThreadId,
      receiverThreadIds: projections.map((projection) => projection.childThreadId),
      prompt: projections.map((projection) => projection.prompt).join("\n\n"),
      model: projections.length === 1 ? projections[0]?.model : undefined,
      agentsStates: Object.fromEntries(projections.map((projection) => [projection.childThreadId, {
        status: projection.status === "running" ? "running" : projection.status,
        message: projection.summary ?? `${projection.nickname} ${projection.status}`,
      }])),
    };
    const parent = this.sessions.get(group.parentThreadId);
    if (parent) {
      const existingIndex = parent.messages.findIndex((entry) => jsonRecord(entry).id === group.itemId);
      if (existingIndex >= 0) parent.messages[existingIndex] = item as JsonValue;
      else parent.messages.push(item as JsonValue);
      this.persistSession(parent);
    }
    this.emit("message", {
      method: completed || terminal ? "item/completed" : "item/started",
      params: {
        threadId: group.parentThreadId,
        turnId: group.parentTurnId,
        item,
      },
    } as JsonRpcMessage);
  }

  private completeAgentProjection(
    parentToolUseId: string,
    content: JsonValue | undefined,
    status: "completed" | "failed" | "interrupted",
  ): boolean {
    const projection = this.agentProjections.get(parentToolUseId);
    if (!projection) return false;
    const child = this.sessions.get(projection.childThreadId);
    const summary = normalizeAssistantText(toolResultText(content));
    if (projection.status !== "running") {
      if (summary && child) this.projectAgentSummary(projection, child, summary);
      this.finishPendingParentTurn(projection.parentThreadId, projection.parentTurnId);
      return true;
    }
    projection.status = status;
    if (summary) projection.summary = summary;

    if (child) {
      if (summary) this.projectAgentSummary(projection, child, summary);
      child.activeTurnId = undefined;
      const turn = child.turns.find((entry) => entry.id === projection.childTurnId);
      if (turn) turn.status = status;
      this.persistSession(child);
    }
    this.emit("message", {
      method: status === "completed" ? "turn/completed" : status === "failed" ? "turn/failed" : "turn/interrupted",
      params: {
        threadId: projection.childThreadId,
        turnId: projection.childTurnId,
        turn: { id: projection.childTurnId, threadId: projection.childThreadId, status },
      },
    } as JsonRpcMessage);

    const group = this.agentGroups.get(projection.groupItemId);
    if (group) this.emitAgentGroupItem(group, false);
    this.finishPendingParentTurn(projection.parentThreadId, projection.parentTurnId);
    return true;
  }

  private hasRunningAgents(parentThreadId: string, parentTurnId: string): boolean {
    // Projections whose owning turn is unknown (task_started raced ahead of
    // turn bookkeeping, or replay reordered events) must still hold their
    // thread's active turn open — requiring an exact parentTurnId match let a
    // running agent be missed and the parent turn complete prematurely.
    return [...this.agentProjections.values()].some((projection) =>
      projection.parentThreadId === parentThreadId
      && projection.status === "running"
      && (!projection.parentTurnId || projection.parentTurnId === parentTurnId)
    );
  }

  /**
   * True while `turnId` of `threadId` owns any background task (e.g. a Bash
   * `run_in_background` job) that has not yet reached a terminal `task_notification`.
   * Unlike subagent projections, background tasks carry no projection, so this
   * must be checked separately to keep the parent turn in-progress. Tasks that
   * have not been bound to a turn yet (per-thread unowned set) count as well:
   * they are still real running work until their terminal notification lands.
   */
  private hasPendingBackgroundTasks(threadId: string, turnId: string): boolean {
    const set = this.backgroundTasksByTurn.get(`${threadId}:${turnId}`);
    if (set) {
      for (const taskId of set) {
        if (this.backgroundTasks.get(taskId) === "running") return true;
      }
    }
    const unowned = this.unownedBackgroundTasksByThread.get(threadId);
    if (unowned) {
      for (const taskId of unowned) {
        if (this.backgroundTasks.get(taskId) === "running") return true;
      }
    }
    return false;
  }

  private hasOpenPermissionRequest(threadId: string): boolean {
    return [...this.pendingPermissionRequests.values()].some((pending) =>
      pending.threadId === threadId
      || (pending.threadId === "" && [...this.sessions.values()].some((session) => Boolean(session.activeTurnId)))
    );
  }

  private registerBackgroundToolUse(threadId: string, turnId: string, toolUseId: string, toolName: string, input: JsonValue | undefined): void {
    const toolInput = jsonRecord(input);
    if (toolName !== "Bash" || toolInput.run_in_background !== true || this.backgroundToolUseOwners.has(toolUseId)) return;
    const turnKey = `${threadId}:${turnId}`;
    this.backgroundToolUseOwners.set(toolUseId, turnKey);
    const tasks = this.backgroundTasksByTurn.get(turnKey) ?? new Set<string>();
    const taskId = this.backgroundTaskIdsByToolUse.get(toolUseId);
    if (taskId) {
      tasks.add(taskId);
      if (!this.backgroundTasks.has(taskId)) this.backgroundTasks.set(taskId, "running");
    } else {
      const unowned = this.unownedBackgroundTasksByThread.get(threadId);
      const pendingTaskId = unowned?.size === 1
        ? unowned.values().next().value as string | undefined
        : undefined;
      if (pendingTaskId) {
        unowned!.delete(pendingTaskId);
        if (unowned!.size === 0) this.unownedBackgroundTasksByThread.delete(threadId);
        tasks.add(pendingTaskId);
      } else {
        const placeholder = `tool:${toolUseId}`;
        this.backgroundTasks.set(placeholder, "running");
        tasks.add(placeholder);
      }
    }
    this.backgroundTasksByTurn.set(turnKey, tasks);
  }

  private bindBackgroundTask(message: Record<string, JsonValue>, taskId: string): void {
    const toolUseId = typeof message.tool_use_id === "string" ? message.tool_use_id : undefined;
    if (toolUseId) this.backgroundTaskIdsByToolUse.set(toolUseId, taskId);
    let turnKey = toolUseId ? this.backgroundToolUseOwners.get(toolUseId) : undefined;
    let placeholder = toolUseId ? `tool:${toolUseId}` : undefined;
    if (!turnKey) {
      const threadId = this.findThreadBySession(typeof message.session_id === "string" ? message.session_id : undefined);
      const activeTurnId = threadId ? this.sessions.get(threadId)?.activeTurnId : undefined;
      turnKey = threadId && activeTurnId ? `${threadId}:${activeTurnId}` : undefined;
      const tasks = turnKey ? this.backgroundTasksByTurn.get(turnKey) : undefined;
      const placeholders = tasks ? [...tasks].filter((entry) => entry.startsWith("tool:")) : [];
      placeholder = placeholders.length === 1 ? placeholders[0] : undefined;
    }
    if (!turnKey) return;
    const tasks = this.backgroundTasksByTurn.get(turnKey) ?? new Set<string>();
    if (placeholder) {
      tasks.delete(placeholder);
      this.backgroundTasks.delete(placeholder);
      this.backgroundToolUseOwners.delete(placeholder.slice("tool:".length));
    }
    tasks.add(taskId);
    if (!toolUseId) {
      const threadId = turnKey.slice(0, turnKey.lastIndexOf(":"));
      const unowned = this.unownedBackgroundTasksByThread.get(threadId) ?? new Set<string>();
      unowned.add(taskId);
      this.unownedBackgroundTasksByThread.set(threadId, unowned);
    }
    this.backgroundTasksByTurn.set(turnKey, tasks);
  }

  private clearBackgroundTasksForTurn(threadId: string, turnId: string): void {
    const turnKey = `${threadId}:${turnId}`;
    const tasks = this.backgroundTasksByTurn.get(turnKey);
    if (tasks) {
      for (const taskId of tasks) {
        this.backgroundTasks.delete(taskId);
        const unowned = this.unownedBackgroundTasksByThread.get(threadId);
        if (unowned?.delete(taskId) && unowned.size === 0) {
          this.unownedBackgroundTasksByThread.delete(threadId);
        }
        if (taskId.startsWith("tool:")) this.backgroundToolUseOwners.delete(taskId.slice("tool:".length));
        for (const [toolUseId, mappedTaskId] of this.backgroundTaskIdsByToolUse) {
          if (mappedTaskId === taskId) this.backgroundTaskIdsByToolUse.delete(toolUseId);
        }
      }
    }
    this.backgroundTasksByTurn.delete(turnKey);
    for (const [toolUseId, owner] of this.backgroundToolUseOwners) {
      if (owner === turnKey) this.backgroundToolUseOwners.delete(toolUseId);
    }
  }

  /**
   * Called when a background task becomes terminal. If the parent turn was
   * held in `pendingParentTurnResults` because background work was still
   * outstanding, re-evaluate now; the turn completes only once no background
   * task and no subagent projection remains running.
   */
  private finishPendingParentTurnForBackgroundTask(taskId: string): void {
    for (const [turnKey, set] of this.backgroundTasksByTurn) {
      if (!set.has(taskId)) continue;
      const sep = turnKey.indexOf(":");
      if (sep < 0) continue;
      const threadId = turnKey.slice(0, sep);
      const turnId = turnKey.slice(sep + 1);
      if (!threadId || !turnId) continue;
      if (this.hasPendingBackgroundTasks(threadId, turnId) || this.hasRunningAgents(threadId, turnId)) return;
      const status = this.pendingParentTurnResults.get(turnKey);
      if (!status) return;
      this.finishPendingParentTurn(threadId, turnId);
      return;
    }
  }

  private emitCompactionItem(threadId: string, turnId: string, status: "inProgress" | "completed" | "failed"): void {
    const item = {
      type: "contextCompaction",
      id: `claude-compaction-${turnId}`,
      threadId,
      turnId,
      title: "Context compaction",
      status,
      // Lets the waterfall label the card with the CLI that ran the
      // compaction instead of the hardcoded Codex wording.
      cliBackend: "claude",
    };
    const session = this.sessions.get(threadId);
    if (session) upsertSessionMessage(session, item as Record<string, JsonValue>);
    this.emit("message", {
      method: status === "inProgress" ? "item/started" : "item/completed",
      params: { threadId, turnId, item },
    } as JsonRpcMessage);
  }

  /**
   * Close the native auto-compaction item opened by `compact_boundary`. The
   * CLI emits no "compaction finished" event, so settle on its next observable
   * output (result / session idle), the earliest reliable signal that
   * post-compaction inference resumed.
   */
  private settleOpenCompactionItems(threadId?: string, turnId?: string): void {
    const settledThreads = new Set<string>();
    for (const key of [...this.openCompactionItemTurnKeys]) {
      const sep = key.indexOf(":");
      if (sep < 0) continue;
      const keyThread = key.slice(0, sep);
      const keyTurn = key.slice(sep + 1);
      if (threadId !== undefined && keyThread !== threadId) continue;
      if (turnId !== undefined && keyTurn !== turnId) continue;
      this.openCompactionItemTurnKeys.delete(key);
      this.emitCompactionItem(keyThread, keyTurn, "completed");
      settledThreads.add(keyThread);
    }
    for (const settledThread of settledThreads) {
      const session = this.sessions.get(settledThread);
      if (session) this.persistSession(session);
    }
  }

  private completeParentTurn(threadId: string, turnId: string, status: "completed" | "failed"): void {
    const turnKey = `${threadId}:${turnId}`;
    this.pendingParentTurnResults.delete(turnKey);
    const pendingTimer = this.pendingParentTurnTimers.get(turnKey);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.pendingParentTurnTimers.delete(turnKey);
    }
    this.sessionIdleTurns.delete(turnKey);
    this.clearBackgroundTasksForTurn(threadId, turnId);
    const session = this.sessions.get(threadId);
    if (!session) return;
    const turn = session.turns.find((entry) => entry.id === turnId);
    if (!turn || turn.status !== "running") return;
    turn.status = status;
    if (session.activeTurnId === turnId) session.activeTurnId = undefined;
    this.persistSession(session);
    this.emit("message", {
      method: status === "completed" ? "turn/completed" : "turn/failed",
      params: {
        threadId,
        turnId,
        turn: { id: turnId, threadId, status, completedAt: Math.floor(Date.now() / 1000) },
      },
    } as JsonRpcMessage);
    for (const [pendingTurnId, resolver] of this.pendingTurnResolvers.entries()) {
      if (resolver.threadId !== threadId && pendingTurnId !== turnId) continue;
      this.pendingTurnResolvers.delete(pendingTurnId);
      resolver.resolve({ turn: { id: pendingTurnId, status } });
      break;
    }
    if (status === "completed") this.scheduleGoalAutoContinuation(threadId);
  }

  private clearGoalContinuationTimer(threadId: string): void {
    const timer = this.goalContinuationTimers.get(threadId);
    if (!timer) return;
    clearTimeout(timer);
    this.goalContinuationTimers.delete(threadId);
  }

  /**
   * Prepend the persisted /goal objective to user-initiated prompts so the
   * model actually works toward it (Claude has no native goal channel).
   * Continuation turns already embed the objective and are skipped via marker.
   */
  private applyGoalDirective(session: CodeCliSession, text: string): string {
    if (session.goalStatus !== "active" || !session.goalObjective?.trim()) return text;
    if (text.includes("[[codex-ultra:goal-continuation]]")) return text;
    if (isMiniContinuationNudge(text)) {
      return [
        "<persisted-goal>",
        "This conversation has a persisted /goal objective. Treat it as the acceptance criteria of your work:",
        session.goalObjective.trim(),
        "</persisted-goal>",
        "",
        text,
      ].join("\n");
    }
    return text;
  }

  /**
   * Claude has no native /goal loop, so the host drives it: once a turn
   * completes while a goal is active, start another turn that asks the model
   * to keep working toward the objective until it replies GOAL_COMPLETE.
   */
  private scheduleGoalAutoContinuation(threadId: string): void {
    const session = this.sessions.get(threadId);
    if (!session || session.goalStatus !== "active" || !session.goalObjective?.trim()) {
      this.clearGoalContinuationTimer(threadId);
      return;
    }
    if (isClaudeGoalBudgetExhausted(session)) {
      session.goalStatus = "budgetLimited";
      this.clearGoalContinuationTimer(threadId);
      this.goalContinuationCounts.delete(threadId);
      this.persistSession(session);
      this.emit("message", {
        method: "thread/goal/updated",
        params: { goal: claudeGoalState(session) },
      } as JsonRpcMessage);
      return;
    }
    if (session.activeTurnId || !this.child) return;
    if (this.goalContinuationTimers.has(threadId)) return;
    const count = this.goalContinuationCounts.get(threadId) ?? 0;
    if (count >= MAX_GOAL_AUTO_CONTINUATIONS) {
      session.goalStatus = "blocked";
      this.clearGoalContinuationTimer(threadId);
      this.goalContinuationCounts.delete(threadId);
      this.persistSession(session);
      this.emit("message", {
        method: "thread/goal/updated",
        params: { goal: claudeGoalState(session) },
      } as JsonRpcMessage);
      this.emit("stderr", `Claude /goal reached the ${MAX_GOAL_AUTO_CONTINUATIONS}-continuation safety limit; marking the goal blocked\n`);
      return;
    }
    const timer = setTimeout(() => {
      this.goalContinuationTimers.delete(threadId);
      void this.startGoalContinuationTurn(session);
    }, 1_000);
    this.goalContinuationTimers.set(threadId, timer);
  }

  private async startGoalContinuationTurn(session: CodeCliSession): Promise<void> {
    const threadId = session.threadId;
    if (!this.child || session.activeTurnId) return;
    if (session.goalStatus !== "active" || !session.goalObjective?.trim()) return;
    if (isClaudeGoalBudgetExhausted(session)) {
      session.goalStatus = "budgetLimited";
      this.clearGoalContinuationTimer(threadId);
      this.goalContinuationCounts.delete(threadId);
      this.persistSession(session);
      this.emit("message", {
        method: "thread/goal/updated",
        params: { goal: claudeGoalState(session) },
      } as JsonRpcMessage);
      return;
    }
    const turnId = randomUUID();
    const turnKey = `${threadId}:${turnId}`;
    this.goalContinuationCounts.set(threadId, (this.goalContinuationCounts.get(threadId) ?? 0) + 1);
    this.sessionIdleTurns.delete(turnKey);
    session.turns.push({ id: turnId, status: "running", createdAt: Date.now() });
    session.activeTurnId = turnId;
    session.currentMessageUsage = { ...EMPTY_CLAUDE_TOKEN_USAGE };
    session.assistantTextBlocksByTurn.set(turnId, []);
    session.streamedAssistantItemsByTurn.set(turnId, new Map());
    session.streamedReasoningItemsByTurn.set(turnId, new Map());
    session.streamedToolBlocksByTurn.set(turnId, new Map());
    session.activeStreamMessageId = undefined;
    this.goalContinuationTurnKeys.add(turnKey);
    this.persistSession(session);
    this.emit("message", {
      method: "turn/started",
      params: { threadId, turn: { id: turnId, threadId, status: "running" } },
    } as JsonRpcMessage);
    // Shared contract with the mini runtime: progress/budget block, evidence
    // and no-progress rules, completion audit. Claude CLI owns its TodoWrite
    // state, so no plan text is injected here.
    const goal = claudeGoalState(session);
    const continuationPrompt = buildGoalContinuationPrompt({
      goalObjective: session.goalObjective,
      goalTokensUsed: goal.tokensUsed,
      goalTokenBudget: goal.tokenBudget,
      goalStartedAt: session.goalStartedAt,
    }, {
      count: this.goalContinuationCounts.get(threadId) ?? 1,
      max: MAX_GOAL_AUTO_CONTINUATIONS,
      planToolName: "TodoWrite",
    });
    this.writeStdin({
      type: "user",
      message: {
        role: "user",
        content: buildClaudeUserContent(continuationPrompt, []),
        parent_tool_use_id: null,
      },
    } as JsonValue);
  }

  private finishPendingParentTurn(threadId: string, turnId: string): void {
    const key = `${threadId}:${turnId}`;
    const status = this.pendingParentTurnResults.get(key);
    if (!status
      || !this.sessionIdleTurns.has(key)
      || this.hasRunningAgents(threadId, turnId)
      || this.hasPendingBackgroundTasks(threadId, turnId)
      || this.hasOpenPermissionRequest(threadId)) return;
    this.completeParentTurn(threadId, turnId, status);
  }

  private schedulePendingParentTurnRecovery(threadId: string, turnId: string): void {
    const key = `${threadId}:${turnId}`;
    if (this.pendingParentTurnTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.pendingParentTurnTimers.delete(key);
      if (!this.pendingParentTurnResults.has(key)
        || this.hasRunningAgents(threadId, turnId)
        || this.hasPendingBackgroundTasks(threadId, turnId)
        || this.hasOpenPermissionRequest(threadId)) return;
      if (!this.sessionIdleTurns.has(key)) {
        // The CLI reported `result` but never sent `session_state_changed:idle`
        // (error paths skip it; older CLIs never emit it). Without this the
        // turn stays `running` forever despite the answer being complete.
        this.sessionIdleTurns.add(key);
        logClaudeBridgeEvent("warn", "turn-recovered-without-idle", {
          threadId,
          turnId,
          status: this.pendingParentTurnResults.get(key) ?? null,
        });
      }
      const status = this.pendingParentTurnResults.get(key);
      if (status) this.completeParentTurn(threadId, turnId, status);
    }, 1_500);
    this.pendingParentTurnTimers.set(key, timer);
  }

  private projectAgentSummary(projection: ClaudeAgentProjection, child: CodeCliSession, summary: string): void {
    const blocks = child.assistantTextBlocksByTurn.get(projection.childTurnId);
    if (assistantResultAlreadyProjected(blocks, summary)) return;
    const item = {
      type: "agentMessage",
      id: `agent-result-${projection.parentToolUseId}`,
      turnId: projection.childTurnId,
      threadId: projection.childThreadId,
      content: summary,
      role: "assistant",
      status: "completed",
    };
    const existingIndex = child.messages.findIndex((entry) => jsonRecord(entry).id === item.id);
    if (existingIndex >= 0) child.messages[existingIndex] = item as JsonValue;
    else child.messages.push(item as JsonValue);
    child.conversation.push({ role: "assistant", text: summary });
    this.persistSession(child);
    this.emit("message", {
      method: "item/completed",
      params: {
        threadId: projection.childThreadId,
        turnId: projection.childTurnId,
        item,
      },
    } as JsonRpcMessage);
  }

  private completeAgentsForParent(
    parentThreadId: string,
    status: "completed" | "failed" | "interrupted",
  ): void {
    for (const projection of this.agentProjections.values()) {
      if (projection.parentThreadId === parentThreadId && projection.status === "running") {
        this.completeAgentProjection(projection.parentToolUseId, undefined, status);
      }
    }
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) return;
    let message: Record<string, JsonValue>;
    try {
      message = JSON.parse(line) as Record<string, JsonValue>;
    } catch {
      this.emit("stderr", "Unparseable Claude CLI stdout: " + redactSecrets(line));
      return;
    }

    this.emit("codecli:raw", message);

    const type = message.type as string | undefined;

    if (type === "control_response") {
      const resp = message.response as Record<string, JsonValue> | undefined;
      const requestId = (resp?.request_id ?? message.request_id) as string | undefined;
      if (requestId) {
        const pending = this.pendingControls.get(requestId);
        if (pending) {
          this.pendingControls.delete(requestId);
          pending.resolve(resp ?? {});
        }
      }
      return;
    }

    if (type === "control_request") {
      const requestId = message.request_id as string;
      const request = message.request as Record<string, JsonValue> | undefined;
      if (request?.subtype === "can_use_tool") {
        const serverRequestId = "perm-" + requestId;
        const threadId = this.messageThreadId(message);
        const toolName = typeof request.tool_name === "string" ? request.tool_name : "unknown";
        const inputSignature = toolInputSignature(request.input);
        const session = threadId ? this.sessions.get(threadId) : undefined;
        if (session && hasApprovedToolAllow(session, toolName, inputSignature)) {
          this.writeStdin(buildControlResponse(requestId, true));
          return;
        }
        this.pendingPermissionRequests.set(serverRequestId, {
          requestId,
          threadId: threadId ?? "",
          toolName,
          inputSignature,
        });
        // Emit as a JSON-RPC *request* (with id), mirroring how the Codex
        // backend surfaces execCommandApproval. Only requests are routed to
        // clients as `codex.serverRequest` and rendered as approval cards;
        // notifications never reach the UI, and the answer comes back through
        // pendingClaudeServerRequests -> respond() with this same id.
        const permissionInput = jsonRecord(request.input);
        const rawCommand = permissionInput.command;
        this.emit("message", {
          method: "item/commandExecution/requestApproval",
          id: serverRequestId,
          params: {
            id: serverRequestId,
            threadId: threadId ?? "",
            toolName: request.tool_name,
            input: request.input,
            ...(typeof rawCommand === "string"
              ? { command: rawCommand }
              : Array.isArray(rawCommand)
                ? { command: rawCommand.filter((entry): entry is string => typeof entry === "string") }
                : {}),
          },
        } as unknown as JsonRpcMessage);
      }
      return;
    }

    if (type === "assistant") {
      const assistantMessage = message.message as Record<string, JsonValue> | undefined;
      const content = assistantMessage?.content;
      const threadId = this.messageThreadId(message);
      const usageSession = threadId ? this.sessions.get(threadId) : undefined;
      if (usageSession) {
        usageSession.currentMessageUsage = updateClaudeTokenUsage(usageSession.currentMessageUsage, assistantMessage?.usage);
        if (totalClaudeTokens(usageSession.currentMessageUsage) > 0) {
          usageSession.lastMessageUsage = { ...usageSession.currentMessageUsage };
        }
      }

      if (Array.isArray(content)) {
        const agentBlocks = content
          .map((block) => block as Record<string, JsonValue>)
          .filter((block) => block.type === "tool_use" && (block.name === "Agent" || block.name === "Task") && typeof block.id === "string");
        const parentTurnId = threadId ? this.sessions.get(threadId)?.activeTurnId : undefined;
        if (threadId && parentTurnId && agentBlocks.length > 0) {
          this.startAgentGroup(threadId, parentTurnId, agentBlocks);
        }
        for (const [blockIndex, block] of content.entries()) {
          const b = block as Record<string, JsonValue>;
          if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string" && threadId && parentTurnId) {
            this.registerBackgroundToolUse(threadId, parentTurnId, b.id, b.name, b.input);
          }
          if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
            const session = threadId ? this.sessions.get(threadId) : undefined;
            const activeTurnId = session?.activeTurnId;
            const streamedText = activeTurnId
              ? [...(session?.streamedAssistantItemsByTurn.get(activeTurnId)?.values() ?? [])].join("")
              : "";
            const streamedItems = activeTurnId ? session?.streamedAssistantItemsByTurn.get(activeTurnId) : undefined;
            const stableStreamItemId = typeof assistantMessage?.id === "string"
              ? `${assistantMessage.id}-text-${blockIndex}`
              : undefined;
            const matchesStableStreamItem = Boolean(stableStreamItemId && streamedItems?.has(stableStreamItemId));
            if (matchesStableStreamItem) streamedItems!.set(stableStreamItemId!, b.text);
            if (matchesStableStreamItem
              || reconcileStreamedItem(streamedItems, b.text)
              || (normalizeAssistantText(streamedText) && normalizeAssistantText(streamedText).includes(normalizeAssistantText(b.text)))) {
              continue;
            }
            const itemId = (typeof message.uuid === "string" ? message.uuid + "-text-" + blockIndex : randomUUID()) as JsonValue;
            const item = {
              type: "agentMessage",
              id: itemId,
              turnId: activeTurnId,
              threadId,
              content: b.text,
              role: "assistant",
              status: "completed",
            };
            this.emit("message", {
              method: "item/completed",
              params: { threadId, turnId: threadId ? this.sessions.get(threadId)?.activeTurnId : undefined, item },
            } as JsonRpcMessage);
            if (session) {
              session.messages.push(item as JsonValue);
              session.conversation.push({ role: "assistant", text: b.text });
              if (activeTurnId) {
                const turnBlocks = session.assistantTextBlocksByTurn.get(activeTurnId) ?? [];
                turnBlocks.push(b.text);
                session.assistantTextBlocksByTurn.set(activeTurnId, turnBlocks);
              }
            }
          } else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.length > 0) {
            const session = threadId ? this.sessions.get(threadId) : undefined;
            const activeTurnId = session?.activeTurnId;
            const streamedReasoning = activeTurnId
              ? [...(session?.streamedReasoningItemsByTurn.get(activeTurnId)?.values() ?? [])].join("")
              : "";
            const streamedReasoningItems = activeTurnId ? session?.streamedReasoningItemsByTurn.get(activeTurnId) : undefined;
            const stableStreamReasoningId = typeof assistantMessage?.id === "string"
              ? `${assistantMessage.id}-reasoning-${blockIndex}`
              : undefined;
            const matchesStableStreamReasoning = Boolean(stableStreamReasoningId && streamedReasoningItems?.has(stableStreamReasoningId));
            if (matchesStableStreamReasoning) streamedReasoningItems!.set(stableStreamReasoningId!, b.thinking);
            if (matchesStableStreamReasoning
              || reconcileStreamedItem(streamedReasoningItems, b.thinking)
              || (normalizeAssistantText(streamedReasoning) && normalizeAssistantText(streamedReasoning).includes(normalizeAssistantText(b.thinking)))) {
              continue;
            }
            const item = {
              type: "reasoning",
              id: (typeof message.uuid === "string" ? message.uuid + "-thinking-" + blockIndex : randomUUID()),
              turnId: activeTurnId,
              threadId,
              text: b.thinking,
              status: "completed",
            };
            this.emit("message", {
              method: "item/completed",
              params: { threadId, turnId: activeTurnId, item },
            } as JsonRpcMessage);
            if (session) session.messages.push(item as JsonValue);
          } else if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string" && b.name !== "Agent" && b.name !== "Task") {
            const session = threadId ? this.sessions.get(threadId) : undefined;
            const turnId = session?.activeTurnId;
            // The task list renders as a plan, not as raw tool JSON. Falling
            // through when the call carries nothing projectable keeps an
            // unrecognized payload visible instead of swallowing it.
            if (session && threadId && turnId && isClaudeTaskPlanTool(b.name)
              && applyClaudeTaskPlanTool(session.taskPlan, b.id, b.name, b.input)) {
              session.taskPlanToolUseIds.add(b.id);
              this.emitTaskPlanItem(session, threadId, turnId);
              continue;
            }
            const toolItem: Record<string, JsonValue> = {
              type: "toolCall",
              id: b.id,
              ...(turnId ? { turnId } : {}),
              ...(threadId ? { threadId } : {}),
              toolName: b.name,
              arguments: b.input ?? {},
              status: "inProgress",
            };
            this.emit("message", {
              method: "item/started",
              params: { threadId, turnId, item: toolItem },
            } as JsonRpcMessage);
            if (session) upsertSessionMessage(session, toolItem);
            if (session) this.persistSession(session);
          }
        }
      }
      return;
    }

    if (type === "user" && message.message) {
      // Claude sends tool_result as a user message with content array
      const userMessage = message.message as Record<string, JsonValue> | undefined;
      const content = userMessage?.content;
      const threadId = this.messageThreadId(message);
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, JsonValue>;
          if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
            const launchedTaskId = asyncAgentTaskId(b.content);
            if (launchedTaskId) {
              const projection = this.bindAgentTask(b.tool_use_id, launchedTaskId);
              if (projection) {
                projection.summary = `${projection.nickname} running`;
                const group = this.agentGroups.get(projection.groupItemId);
                if (group) this.emitAgentGroupItem(group, false);
                continue;
              }
            }
            const status = b.is_error === true ? "failed" : "completed";
            if (this.completeAgentProjection(b.tool_use_id, b.content, status)) continue;
            const session = threadId ? this.sessions.get(threadId) : undefined;
            const turnId = session?.activeTurnId;
            // A plan tool's result only confirms the mutation and hands back the
            // `#N` id later updates address, so bind that and drop the row —
            // the plan item already shows the outcome.
            if (session?.taskPlanToolUseIds.has(b.tool_use_id)) {
              session.taskPlanToolUseIds.delete(b.tool_use_id);
              if (bindClaudeTaskPlanResult(session.taskPlan, b.tool_use_id, toolResultText(b.content))) {
                this.persistSession(session);
              }
              continue;
            }
            const existing = session?.messages
              .map((entry) => jsonRecord(entry))
              .find((entry) => entry.id === b.tool_use_id && entry.type === "toolCall");
            const resultItem: Record<string, JsonValue> = {
              ...(existing ?? {}),
              type: "toolCall",
              id: b.tool_use_id,
              ...(turnId ? { turnId } : {}),
              ...(threadId ? { threadId } : {}),
              toolName: existing?.toolName ?? "Tool",
              arguments: existing?.arguments ?? {},
              result: { content: b.content ?? null },
              status,
            };
            this.emit("message", {
              method: "item/completed",
              params: { threadId, turnId, item: resultItem },
            } as JsonRpcMessage);
            if (session) upsertSessionMessage(session, resultItem);
            if (session) this.persistSession(session);
          }
        }
      }
      return;
    }

    if (type === "stream_event") {
      const event = message.event as Record<string, JsonValue> | undefined;
      const threadId = this.messageThreadId(message);
      const session = threadId ? this.sessions.get(threadId) : undefined;
      const activeTurnId = session?.activeTurnId;
      const eventMessage = event?.message as Record<string, JsonValue> | undefined;
      if (event?.type === "message_start") {
        if (session) {
          session.currentMessageUsage = updateClaudeTokenUsage(EMPTY_CLAUDE_TOKEN_USAGE, eventMessage?.usage);
          if (typeof eventMessage?.id === "string") session.activeStreamMessageId = eventMessage.id;
        }
      } else if (event?.type === "message_delta") {
        if (session) session.currentMessageUsage = updateClaudeTokenUsage(session.currentMessageUsage, event.usage);
      } else if (event?.type === "message_stop") {
        if (session && totalClaudeTokens(session.currentMessageUsage) > 0) {
          session.lastMessageUsage = { ...session.currentMessageUsage };
          if (threadId && activeTurnId) {
            const streamId = session.activeStreamMessageId ?? (typeof message.uuid === "string" ? message.uuid : "unknown");
            const requestId = "claude-" + activeTurnId + "-" + streamId;
            const emitted = session.requestUsageEmittedByTurn.get(activeTurnId) ?? new Set<string>();
            if (!emitted.has(requestId)) {
              emitted.add(requestId);
              session.requestUsageEmittedByTurn.set(activeTurnId, emitted);
              this.emit("message", {
                method: "thread/tokenUsage/requestUpdated",
                params: { threadId, turnId: activeTurnId, requestId, usage: claudeTokenBreakdown(session.currentMessageUsage) },
              } as JsonRpcMessage);
            }
          }
        }
      } else if (session && !session.activeStreamMessageId && typeof message.uuid === "string") {
        session.activeStreamMessageId = message.uuid;
      }
      const streamMessageId = session?.activeStreamMessageId
        ?? (typeof eventMessage?.id === "string" ? eventMessage.id : undefined)
        ?? activeTurnId
        ?? (typeof message.uuid === "string" ? message.uuid : undefined)
        ?? randomUUID();
      const blockIndex = typeof event?.index === "number" && Number.isFinite(event.index) ? event.index : 0;
      if (event?.type === "content_block_start") {
        const cb = event.content_block as Record<string, JsonValue> | undefined;
        const channel = cb?.type === "thinking" ? "reasoning" : cb?.type === "text" ? "text" : undefined;
        const text = typeof cb?.text === "string" ? cb.text : typeof cb?.thinking === "string" ? cb.thinking : "";
        // Block indexes restart with every assistant message, so an untracked
        // tool has to evict the previous message's block or its argument deltas
        // would be appended to a stale tool call.
        if (cb?.type === "tool_use" && session && activeTurnId) {
          session.streamedToolBlocksByTurn.get(activeTurnId)?.delete(blockIndex);
        }
        if (cb?.type === "tool_use" && typeof cb.id === "string" && typeof cb.name === "string"
           && cb.name !== "Agent" && cb.name !== "Task" && !isClaudeTaskPlanTool(cb.name)) {
          if (threadId && activeTurnId) this.registerBackgroundToolUse(threadId, activeTurnId, cb.id, cb.name, cb.input);
          const toolBlock: ClaudeStreamToolBlock = {
            id: cb.id,
            name: cb.name,
            argumentsJson: "",
            initialInput: cb.input ?? {},
          };
          if (session && activeTurnId) {
            const toolBlocks = session.streamedToolBlocksByTurn.get(activeTurnId) ?? new Map<number, ClaudeStreamToolBlock>();
            toolBlocks.set(blockIndex, toolBlock);
            session.streamedToolBlocksByTurn.set(activeTurnId, toolBlocks);
          }
          const toolItem: Record<string, JsonValue> = {
            type: "toolCall",
            id: cb.id,
            ...(activeTurnId ? { turnId: activeTurnId } : {}),
            ...(threadId ? { threadId } : {}),
            toolName: cb.name,
            arguments: streamedToolArguments(toolBlock),
            status: "inProgress",
          };
          this.emit("message", {
            method: "item/started",
            params: {
              threadId,
              turnId: activeTurnId,
              item: toolItem,
            },
          } as JsonRpcMessage);
          if (session) {
            upsertSessionMessage(session, toolItem);
            this.persistSession(session);
          }
        }
        if (channel && text.length > 0) {
          const itemId = `${streamMessageId}-${channel}-${blockIndex}`;
          const streamItems = activeTurnId && session
            ? (channel === "reasoning"
              ? (session.streamedReasoningItemsByTurn.get(activeTurnId) ?? new Map<string, string>())
              : (session.streamedAssistantItemsByTurn.get(activeTurnId) ?? new Map<string, string>()))
            : undefined;
          if (streamItems) {
            streamItems.set(itemId, `${streamItems.get(itemId) ?? ""}${text}`);
            if (activeTurnId && session) {
              (channel === "reasoning" ? session.streamedReasoningItemsByTurn : session.streamedAssistantItemsByTurn).set(activeTurnId, streamItems);
            }
          }
          this.emit("message", {
            method: channel === "reasoning" ? "item/reasoning/textDelta" : "item/agentMessage/delta",
            params: { threadId, turnId: activeTurnId, itemId, delta: text },
          } as JsonRpcMessage);
        }
      } else if (event?.type === "content_block_delta") {
        const delta = event.delta as Record<string, JsonValue> | undefined;
        if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string" && session && activeTurnId) {
          const toolBlock = session.streamedToolBlocksByTurn.get(activeTurnId)?.get(blockIndex);
          if (toolBlock) {
            toolBlock.argumentsJson += delta.partial_json;
            const toolItem: Record<string, JsonValue> = {
              type: "toolCall",
              id: toolBlock.id,
              turnId: activeTurnId,
              ...(threadId ? { threadId } : {}),
              toolName: toolBlock.name,
              arguments: streamedToolArguments(toolBlock),
              status: "inProgress",
            };
            this.emit("message", {
              method: "item/started",
              params: { threadId, turnId: activeTurnId, item: toolItem },
            } as JsonRpcMessage);
            upsertSessionMessage(session, toolItem);
            this.persistSession(session);
          }
        }
        const channel = delta?.type === "thinking_delta" || typeof delta?.thinking === "string"
          ? "reasoning"
          : typeof delta?.text === "string" || delta?.type === "text_delta" ? "text" : undefined;
        const text = channel === "reasoning"
          ? (typeof delta?.thinking === "string" ? delta.thinking : "")
          : (typeof delta?.text === "string" ? delta.text : "");
        if (channel && text.length > 0) {
          const itemId = `${streamMessageId}-${channel}-${blockIndex}`;
          const streamItems = activeTurnId && session
            ? (channel === "reasoning"
              ? (session.streamedReasoningItemsByTurn.get(activeTurnId) ?? new Map<string, string>())
              : (session.streamedAssistantItemsByTurn.get(activeTurnId) ?? new Map<string, string>()))
            : undefined;
          if (streamItems) {
            streamItems.set(itemId, `${streamItems.get(itemId) ?? ""}${text}`);
            if (activeTurnId && session) {
              (channel === "reasoning" ? session.streamedReasoningItemsByTurn : session.streamedAssistantItemsByTurn).set(activeTurnId, streamItems);
            }
          }
          this.emit("message", {
            method: channel === "reasoning" ? "item/reasoning/textDelta" : "item/agentMessage/delta",
            params: { threadId, turnId: activeTurnId, itemId, delta: text },
          } as JsonRpcMessage);
        }
      }
      return;
    }

    if (type === "result") {
      const subtype = message.subtype as string | undefined;
      const sessionId = message.session_id as string | undefined;
      const threadId = this.findThreadBySession(sessionId);
      const isError = message.is_error === true || (subtype !== undefined && subtype !== "success");
      const isSuccess = !isError;
      const session = threadId ? this.sessions.get(threadId) : undefined;
      const activeTurnId = session?.activeTurnId;
      if (session) {
        const resultUsage = parseClaudeTokenUsage(message.usage);
        if (resultUsage && totalClaudeTokens(resultUsage) > 0) session.tokenUsage = resultUsage;
        if (totalClaudeTokens(session.lastMessageUsage) === 0) {
          const fallbackUsage = totalClaudeTokens(session.currentMessageUsage) > 0
            ? session.currentMessageUsage
            : resultUsage;
          if (fallbackUsage) session.lastMessageUsage = { ...fallbackUsage };
        }
        session.modelContextWindow = this.configuredContextWindow
          ?? resolveClaudeModelContextWindow(message.modelUsage, session.model ?? this.configuredModel)
          ?? session.modelContextWindow;
      }
      if (session && activeTurnId) {
        this.flushStreamedAssistantItems(session, threadId ?? "", activeTurnId);
        // A native auto-compaction during this turn has certainly finished by
        // the time the turn reports its result.
        if (threadId) this.settleOpenCompactionItems(threadId, activeTurnId);
      }
      const normalizedResult = typeof message.result === "string" ? normalizeAssistantText(message.result) : "";
      if (threadId && session && activeTurnId
        && this.goalContinuationTurnKeys.has(`${threadId}:${activeTurnId}`)
        && hasGoalCompleteSignal(normalizedResult)) {
        // The model declared the persisted objective achieved; stop the
        // host-driven continuation loop and publish the terminal goal state.
        this.goalContinuationTurnKeys.delete(`${threadId}:${activeTurnId}`);
        session.goalStatus = "complete";
        this.clearGoalContinuationTimer(threadId);
        this.goalContinuationCounts.delete(threadId);
        this.persistSession(session);
        this.emit("message", {
          method: "thread/goal/updated",
          params: { goal: claudeGoalState(session) },
        } as JsonRpcMessage);
      }
      const resultAlreadyProjected = Boolean(
        activeTurnId
        && normalizedResult
        && assistantResultAlreadyProjected(session?.assistantTextBlocksByTurn.get(activeTurnId), normalizedResult)
      );
      if (activeTurnId && typeof message.result === "string" && message.result.length > 0 && !resultAlreadyProjected) {
        const resultItemId = ("result-" + (sessionId ?? randomUUID())) as JsonValue;
        const resultItem = {
          type: "agentMessage",
          id: resultItemId,
          turnId: activeTurnId,
          threadId,
          content: message.result,
          role: "assistant",
          status: "completed",
        };
        this.emit("message", {
          method: "item/completed",
          params: { threadId, turnId: threadId ? this.sessions.get(threadId)?.activeTurnId : undefined, item: resultItem },
        } as JsonRpcMessage);
        if (session) session.messages.push(resultItem as JsonValue);
        if (session && normalizedResult && !resultAlreadyProjected) {
          session.conversation.push({ role: "assistant", text: normalizedResult });
        }
      }

      // Emit terminal event directly instead of resolving a pending promise.
      // The turn/start method returns immediately; terminal state is communicated
      // via notifications, matching Codex app-server semantics.
      if (threadId) {
        if (session && activeTurnId && (totalClaudeTokens(session.tokenUsage) > 0 || session.modelContextWindow)) {
          this.emit("message", {
            method: "thread/tokenUsage/updated",
            params: {
              threadId,
              turnId: activeTurnId,
              tokenUsage: {
                total: claudeTokenBreakdown(session.tokenUsage),
                last: claudeTokenBreakdown(session.lastMessageUsage),
                contextUsage: {
                  ...claudeTokenBreakdown(session.lastMessageUsage),
                  totalTokens: session.lastMessageUsage.inputTokens
                    + session.lastMessageUsage.cachedInputTokens
                    + session.lastMessageUsage.cacheWriteInputTokens,
                  outputTokens: 0,
                },
                modelContextWindow: session.modelContextWindow ?? null,
              },
            },
          } as JsonRpcMessage);
        }
        if (!isSuccess) this.completeAgentsForParent(threadId, "failed");
        if (session && activeTurnId) {
          const status = isSuccess ? "completed" : "failed";
          // A parent turn stays "running" while a subagent projection is active
          // or a background task has not reported a terminal task notification.
          // Completion is driven only by Claude protocol events, never by a
          // fixed quiet-period or process-tree guess.
          this.pendingParentTurnResults.set(`${threadId}:${activeTurnId}`, status);
          this.persistSession(session);
          this.schedulePendingParentTurnRecovery(threadId, activeTurnId);
          this.finishPendingParentTurn(threadId, activeTurnId);
        }
      }
      return;
    }
    if (type === "system" && (
      message.subtype === "task_started"
      || message.subtype === "task_progress"
      || message.subtype === "task_notification"
    )) {
      const projection = this.agentProjectionForTask(message);
      const taskId = typeof message.task_id === "string" ? message.task_id : undefined;
      const summary = firstNonEmptyString(message, ["summary", "description", "last_tool_name"]);
      if (summary && projection) projection.summary = summary;
      if (message.subtype === "task_started") {
        const group = projection ? this.agentGroups.get(projection.groupItemId) : undefined;
        if (group) this.emitAgentGroupItem(group, false);
        if (taskId) {
          this.bindBackgroundTask(message, taskId);
          if (!this.backgroundTasks.has(taskId)) this.backgroundTasks.set(taskId, "running");
          if (projection) {
            const turnKey = `${projection.parentThreadId}:${projection.parentTurnId}`;
            let set = this.backgroundTasksByTurn.get(turnKey);
            if (!set) { set = new Set(); this.backgroundTasksByTurn.set(turnKey, set); }
            set.add(taskId);
          }
        }
      } else if (message.subtype === "task_notification") {
        const terminalStatus = claudeTaskTerminalStatus(message.status);
        if (terminalStatus) {
          const toolUseId = typeof message.tool_use_id === "string" ? message.tool_use_id : undefined;
          if (!projection && toolUseId) this.terminalAgentTasksByToolUse.set(toolUseId, terminalStatus);
          if (!projection && taskId) this.terminalAgentTasksByTaskId.set(taskId, terminalStatus);
          if (taskId) {
            this.bindBackgroundTask(message, taskId);
            this.backgroundTasks.set(taskId, terminalStatus);
            const threadId = this.findThreadBySession(typeof message.session_id === "string" ? message.session_id : undefined);
            if (!toolUseId && threadId) {
              const unowned = this.unownedBackgroundTasksByThread.get(threadId);
              if (unowned?.delete(taskId) && unowned.size === 0) {
                this.unownedBackgroundTasksByThread.delete(threadId);
              }
            }
          }
          if (projection) this.completeAgentProjection(projection.parentToolUseId, summary, terminalStatus);
          if (taskId) this.finishPendingParentTurnForBackgroundTask(taskId);
        } else {
          const group = projection ? this.agentGroups.get(projection.groupItemId) : undefined;
          if (group) this.emitAgentGroupItem(group, false);
        }
      } else {
        const group = projection ? this.agentGroups.get(projection.groupItemId) : undefined;
        if (group) this.emitAgentGroupItem(group, false);
      }
      return;
    }
    if (type === "system" && message.subtype === "session_state_changed") {
      const state = typeof message.state === "string" ? message.state : undefined;
      const threadId = this.findThreadBySession(typeof message.session_id === "string" ? message.session_id : undefined);
      const session = threadId ? this.sessions.get(threadId) : undefined;
      const activeTurnId = session?.activeTurnId;
      if (state === "idle" && threadId && activeTurnId) {
        const turnKey = `${threadId}:${activeTurnId}`;
        this.sessionIdleTurns.add(turnKey);
        this.settleOpenCompactionItems(threadId, activeTurnId);
        if (this.hasRunningAgents(threadId, activeTurnId) || this.hasPendingBackgroundTasks(threadId, activeTurnId)) {
          this.emit("stderr", `Claude CLI reported idle while thread ${threadId} still owns running background work; keeping the turn active\n`);
        } else {
          this.finishPendingParentTurn(threadId, activeTurnId);
        }
      }
      return;
    }
    if (type === "system" && message.subtype === "compact_boundary") {
      // Claude CLI compacts in place and then continues the active query.
      // Ending or restarting the host session here would discard the CLI's
      // preserved post-compaction context, so never touch the process — but do
      // surface a contextCompaction item lifecycle so the UI can render the
      // compaction animation (previously this event was swallowed entirely).
      const sessionId = typeof message.session_id === "string" ? message.session_id : undefined;
      const boundaryThreadId = this.findThreadBySession(sessionId);
      const boundarySession = boundaryThreadId ? this.sessions.get(boundaryThreadId) : undefined;
      const boundaryTurnId = boundarySession?.activeTurnId;
      if (boundaryThreadId && boundaryTurnId) {
        const boundaryKey = `${boundaryThreadId}:${boundaryTurnId}`;
        this.openCompactionItemTurnKeys.add(boundaryKey);
        this.emitCompactionItem(boundaryThreadId, boundaryTurnId, "inProgress");
      }
      return;
    }
    if (type === "system" && message.subtype === "init") {
      if (this.pendingHandshakeThreadId) {
        const readyThread = this.findThreadBySession(typeof message.session_id === "string" ? message.session_id : undefined)
          ?? this.pendingHandshakeThreadId;
        this.pendingHandshakeThreadId = null;
        this.emitClaudeStartupStage(readyThread, "ready");
      }
      const version = typeof message.claude_code_version === "string" ? message.claude_code_version : undefined;
      if (version) {
        this.claudeCodeVersion = version;
      }
      if (version && this.status.phase === "ready") {
        this.status = { ...this.status, appServerUserAgent: this.claudeCodeUserAgent() };
        this.emit("status", this.getStatus());
      }
      const sessionId = message.session_id as string | undefined;
      if (!sessionId) return;
      // Current CLI builds emit `session_state_changed` before `init`, and its
      // handler reaches `findThreadBySession`, whose single-session fallback
      // registers the id in `sessionIdToThread` WITHOUT adopting it as the
      // thread's external session. Guarding on map membership alone therefore
      // used to skip `init` entirely — `externalSessionId` never persisted, and
      // a reopened thread after a restart could neither `--resume` nor replay,
      // so the new CLI process started with zero context. Adopt whenever the
      // target session has not taken this id yet.
      let targetThread = this.sessionIdToThread.get(sessionId);
      if (!targetThread) {
        // Attribute the external session ID to the thread that has an active
        // turn — the init message arrives right after the first user prompt.
        // This avoids the race condition of attributing to an arbitrary thread.
        for (const [tid, session] of this.sessions.entries()) {
          if (session.activeTurnId) {
            targetThread = tid;
            break;
          }
        }
        // Fall back to the only session if there is exactly one (single-thread bridge)
        if (!targetThread && this.sessions.size === 1) {
          targetThread = this.sessions.keys().next().value;
        }
        if (!targetThread) return;
        this.sessionIdToThread.set(sessionId, targetThread);
      }
      const targetSession = this.sessions.get(targetThread);
      if (!targetSession || targetSession.externalSessionId === sessionId) return;
      targetSession.externalSessionId = sessionId;
      this.persistSession(targetSession);
      // `--resume` forks the transcript under a fresh session ID, so a later
      // restart of this bridge has to continue from the newest one; keeping
      // the ID we were launched with would replay a stale conversation.
      this.configuredResumeSessionId = sessionId;
      return;
    }
  }

  private findThreadBySession(sessionId: string | undefined): string | undefined {
    if (!sessionId) return undefined;
    const mapped = this.sessionIdToThread.get(sessionId);
    if (mapped) return mapped;
    // One-bridge-per-thread: if there is exactly one session, attribute all
    // events from this Claude session to it.
    if (this.sessions.size === 1) {
      const [tid] = this.sessions.keys();
      if (tid) {
        this.sessionIdToThread.set(sessionId, tid);
        return tid;
      }
    }
    if (this.sessions.has(sessionId)) {
      this.sessionIdToThread.set(sessionId, sessionId);
      return sessionId;
    }
    return undefined;
  }

  private async runCompaction(session: CodeCliSession, turnId: string, route: ClaudeCompactionRoute): Promise<void> {
    const threadId = session.threadId;
    const turn = session.turns.find((entry) => entry.id === turnId);
    this.emitCompactionItem(threadId, turnId, "inProgress");
    try {
      const transcript = session.conversation
        .map(formatConversationEntry)
        .join("\n\n");
      if (!transcript.trim()) throw new Error("Claude conversation has no content to compact");
      const summary = await this.compactThread({
        threadId,
        cwd: session.cwd || this.configuredCwd || process.cwd(),
        transcript,
        route,
        runtimeEnv: this.runtimeEnvSnapshot,
        cliBackend: "claude",
      });
      session.activeTurnId = undefined;
      this.stop();
      await this.waitForExit();
      this.sessionIdToThread.clear();
      this.configuredResumeSessionId = undefined;
      session.externalSessionId = undefined;
      session.pendingCompactionSummary = summary;
      session.tokenUsage = { ...EMPTY_CLAUDE_TOKEN_USAGE };
      session.currentMessageUsage = { ...EMPTY_CLAUDE_TOKEN_USAGE };
      session.lastMessageUsage = { ...EMPTY_CLAUDE_TOKEN_USAGE };
      if (turn) turn.status = "completed";
      this.persistSession(session);
      await this.start();
      this.emitCompactionItem(threadId, turnId, "completed");
      this.emit("message", {
        method: "turn/completed",
        params: { threadId, turnId, turn: { id: turnId, threadId, status: "completed" } },
      } as JsonRpcMessage);
    } catch (error) {
      session.activeTurnId = undefined;
      if (turn) turn.status = "failed";
      this.persistSession(session);
      this.emitCompactionItem(threadId, turnId, "failed");
      this.emit("message", {
        method: "turn/failed",
        params: {
          threadId,
          turnId,
          turn: { id: turnId, threadId, status: "failed" },
          error: stringifyError(error),
        },
      } as JsonRpcMessage);
    }
  }

  private invalidateChild(child: ChildProcessWithoutNullStreams, message: string): void {
    if (this.child !== child) return;
    this.thinkingBudgetChild = null;
    const failedThreads: Array<{ threadId: string; activeTurnId: string }> = [];
    for (const [threadId, session] of this.sessions.entries()) {
      if (session.activeTurnId) failedThreads.push({ threadId, activeTurnId: session.activeTurnId });
    }
    logClaudeBridgeEvent("error", "invalidate-child", {
      threadId: this.configuredThreadId,
      pid: child.pid ?? null,
      killed: child.killed,
      exitCode: child.exitCode ?? null,
      signalCode: child.signalCode ?? null,
      failedTurns: failedThreads,
      pendingTurnResolvers: this.pendingTurnResolvers.size,
      pendingControls: this.pendingControls.size,
      pendingPermissionRequests: this.pendingPermissionRequests.size,
      message: redactSecrets(message).slice(0, 2000),
    });
    for (const pending of this.pendingControls.values()) pending.reject(new Error(message));
    this.pendingControls.clear();
    this.pendingParentTurnResults.clear();
      this.backgroundTasks.clear();
      this.backgroundTasksByTurn.clear();
      this.backgroundToolUseOwners.clear();
      this.backgroundTaskIdsByToolUse.clear();
    this.sessionIdleTurns.clear();
    // Settle (not drop) open compaction cards: the CLI died, so the next
    // result/idle that would close them never arrives and the waterfall would
    // show "compacting" forever.
    this.settleOpenCompactionItems();
    for (const timer of this.goalContinuationTimers.values()) clearTimeout(timer);
    this.goalContinuationTimers.clear();
    this.goalContinuationTurnKeys.clear();
    const activeAgentParents = new Set<string>();
    for (const projection of this.agentProjections.values()) {
      if (projection.status === "running") activeAgentParents.add(projection.parentThreadId);
    }
    for (const parentThreadId of activeAgentParents) this.completeAgentsForParent(parentThreadId, "failed");
    // Emit turn/failed for all sessions with active turns
    for (const [threadId, session] of this.sessions.entries()) {
      const activeTurnId = session.activeTurnId;
      if (activeTurnId) {
        session.activeTurnId = undefined;
        const turn = session.turns.find((t) => t.id === activeTurnId);
        if (turn) turn.status = "failed";
        this.persistSession(session);
        this.emit("message", {
          method: "turn/failed",
          params: {
            threadId,
            turnId: activeTurnId,
            turn: { id: activeTurnId, threadId, status: "failed" },
            error: message,
          },
        } as JsonRpcMessage);
      }
    }
    for (const pending of this.pendingTurnResolvers.values()) pending.reject(new Error(message));
    this.pendingTurnResolvers.clear();
    this.pendingPermissionRequests.clear();
    this.child = null;
    if (this.status.phase !== "stopped") {
      this.setStatus({ ...this.status, phase: "error", message });
    }
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.emit("status", this.getStatus());
  }
}
