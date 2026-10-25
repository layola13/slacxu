// For learning and research only. Other uses are at your own risk.
//
// AuggieAgentBridge — bridges `auggie --acp` (Augment Code stdio ACP) to the
// Codex app-server JSON-RPC wire surface implemented by {@link CodeCliBridge}.
// Design reference: docs/auggie-embedded-backend-plan.md (the original
// embedded plan); the runtime is now the user's external `auggie` binary.
// A drop-in
// `CodexRuntimeClient` the routing layer (task #6) can treat identically to a
// Codex / Claude backend.
//
// ACP has no thread/turn abstraction — only `initialize`/`session/new`/
// `session/prompt`/`session/cancel`/`session/request_permission`/
// `session/update`. This bridge synthesises Codex notifications
// (`thread/started`, `turn/started`, `item/agentMessage/delta`,
// `item/completed`, `item/*requestApproval`, `turn/completed`, …) from those
// ACP events, mirroring how codeCliBridge synthesises the same set from
// Claude's stream-json. See §3.3 for the mapping table.
//
// APPROVAL DIRECTION (§6.1): auggie sends `session/request_permission` as a
// JSON-RPC **request** (with id) TO the host. The host replies with a
// `result.outcome`. This is the reverse of grok, where the agent emits a
// `control_request` event and the client sends `session/control`. We forward
// the auggie request to the UI as a Codex `item/*requestApproval` server
// request; when the UI answers, `respond()` writes
// `buildAuggiePermissionResult` back to auggie's stdin.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { promises as fsPromises, existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter as pathDelimiter, join } from "node:path";
import {
  type EngineStatus,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonValue,
} from "@codex-ui/shared";
import { createBridgeEventLogger, spawnCli, type BridgeEventLogger, type CodexRuntimeClient } from "@cxu/sdk-backend";
import { findAuggieBin, probeAuggieVersion } from "./auggieCommand.js";
import {
  asRequestPermission,
  asSessionUpdate,
  buildAuggieInitialize,
  buildAuggieInterrupt,
  buildAuggiePermissionResult,
  buildAuggieSessionNew,
  isAgentMessageChunk,
  isAvailableCommandsUpdate,
  type AcpEvent,
  type AcpRequestPermissionEvent,
  type AcpSessionUpdateEvent,
  type AuggiePermissionOutcome,
  AUGGIE_METHOD,
  AUGGIE_SESSION_UPDATE_AGENT_MESSAGE_CHUNK,
} from "./auggieAcpProtocol.js";

// session/update discriminators the protocol module does not export guards for
// yet. The bridge reads them straight off `update.sessionUpdate` (the module's
// index signature keeps these untyped on purpose).
const AUGGIE_SESSION_UPDATE_USER_MESSAGE_CHUNK = "user_message_chunk";
const AUGGIE_SESSION_UPDATE_TOOL_CALL = "tool_call";
const AUGGIE_SESSION_UPDATE_TOOL_CALL_UPDATE = "tool_call_update";

/**
 * One content block of an auggie `session/prompt` array. Images are passed
 * through natively (auggie declares `promptCapabilities.image: true`); see
 * {@link AUGGIE_MAX_IMAGE_BASE64_CHARS} and friends for the limits we enforce
 * host-side so oversized input is rejected with a clear error instead of
 * silently dropped by the agent.
 */
export type AuggiePromptBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** Image mime types auggie accepts (audit §3). */
const AUGGIE_SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
/** Hard cap of image blocks per prompt (audit §3). */
const AUGGIE_MAX_IMAGES_PER_MESSAGE = 10;
/** Base64 budget per single image AND per whole message (audit §3). */
const AUGGIE_MAX_IMAGE_BASE64_CHARS = 5 * 1024 * 1024;

// The redirector (apps/server/src/auggieRedirector.ts) is built in parallel
// and now exports `ensureAuggieRedirector(): Promise<AuggieRedirectorHandle>`
// plus a `configureAuggieRedirector(config)` setter. This bridge only
// consumes `ensureAuggieRedirector()` + `injectEnvFor(env)` (which RETURNS the
// augmented env, not mutate-in-place — see the real type below). The
// `configureAuggieRedirector` setter is the routing layer's job (task #6/7);
// we do not call it here.
import type { AuggieRedirectorHandle } from "./auggieRedirector.js";
import {
  aggregateAuggieUsageRecords,
  ensureAuggieRedirector,
  takeAuggieUpstreamUsage,
  upstreamModel as configuredUpstreamModel,
} from "./auggieRedirector.js";

type AuggieSession = {
  threadId: string;
  parentThreadId?: string;
  agentNickname?: string;
  agentRole?: string;
  preview?: string;
  model: string | undefined;
  permissionMode: string;
  cwd: string | undefined;
  createdAt: number;
  /** Auggie's `session/new` result id (`sessionId`). */
  externalSessionId?: string;
  turns: Array<{ id: string; status: string; createdAt: number }>;
  /**
   * Wall clock at which the active turn's upstream work began. Used as the
   * lower bound when draining redirector-parsed usage at turn finalization so
   * records from earlier turns (or other sessions sharing the process) are not
   * attributed to this turn.
   */
  turnStartedAtMs?: number;
  messages: JsonValue[];
  assistantTextByTurn: Map<string, string[]>;
  activeTurnId?: string;
  /** Streaming text accumulator keyed by `itemId` so deltas fold into one item. */
  streamedAssistantByTurn: Map<string, Map<string, string>>;
  /** Currently open text segment per turn (null = next delta starts a new
   *  segment). Segments split at tool boundaries so the transcript keeps
   *  dialogue/tool/dialogue order instead of one text block on top. */
  openTextByTurn: Map<string, string | null>;
  /** Segment sequence per turn for stable segment ids. */
  textSegByTurn: Map<string, number>;
  conversation: Array<{ role: "user" | "assistant"; text: string }>;
  /** Tool cards keyed by auggie `toolCallId` so paired `tool_call_update`
   *  frames merge into the same Codex `toolCall` item (subagents included —
   *  each subagent is exactly one tool_call + one final tool_call_update). */
  toolCallsByAcpId: Map<string, Record<string, JsonValue>>;
  /** Non-null while `session/list` + `session/load` replay persisted history
   *  after a bridge restart; replayed chunks are collected here instead of
   *  being streamed as live deltas. */
  restoreCollector: Array<{ role: "user" | "assistant"; text: string }> | null;
  /** Silence-window finalizer armed while a turn streams (see
   *  armTurnSilenceTimer); cleared when the real prompt result lands. */
  turnSilenceTimer?: ReturnType<typeof setTimeout>;
  /** Last inbound activity for the active turn (text/tool/permission). Used
   *  to tell a busy-but-quiet turn from a genuinely stalled one. */
  lastActivityMs?: number;
};

/** True while any tool card of this turn is still in flight. The silence
 *  finalizer must keep waiting instead of synthesizing turn/completed. */
export function auggieTurnHasUnsettledTools(
  session: Pick<AuggieSession, "toolCallsByAcpId">,
  turnId: string,
): boolean {
  for (const item of session.toolCallsByAcpId.values()) {
    if (item.turnId !== turnId) continue;
    if (item.status === "inProgress") return true;
  }
  return false;
}

/** Methods that must not require a running auggie child (mirror
 *  codeCliBridge's CODECLI_PROCESS_FREE_METHODS). */
const AUGGIE_PROCESS_FREE_METHODS = new Set([  "initialize",
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
  "thread/archive",
  "thread/delete",
  "thread/unsubscribe",
  "thread/closed",
]);

function augNeedsRunningProcess(method: string): boolean {
  return !AUGGIE_PROCESS_FREE_METHODS.has(method);
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

function jsonRecord(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {};
}

function normalizeAssistantText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

/** Insert-or-replace a synthesised item in a session's message log by id. */
function upsertSessionItem(session: AuggieSession, item: Record<string, JsonValue>): void {
  const index = session.messages.findIndex((entry) => jsonRecord(entry).id === item.id);
  if (index >= 0) session.messages[index] = item as JsonValue;
  else session.messages.push(item as JsonValue);
}

// ---------------------------------------------------------------------------
// Agents fleet (docs/auggie-default-rollout-todolist.md group F2)
//
// Auggie subagent fleets live as markdown+frontmatter files in
// `<cacheDir>/agents/` (frontmatter keys: description / model / color / tools
// whitelist OR disabledTools / finishTool; body is the prompt). The bridge
// writes the host's fleet definitions before every spawn so the child picks
// them up at startup.
// ---------------------------------------------------------------------------

/** One fleet entry as supplied by the host configuration. */
export type AuggieAgentFleetEntry = {
  name: string;
  prompt: string;
  description?: string;
  model?: string;
  /** One of auggie's 8 agent colors. */
  color?: string;
  /** Tool whitelist — mutually exclusive with {@link disabledTools}. */
  tools?: string[];
  disabledTools?: string[];
  finishTool?: string;
};

/**
 * Resolve the auggie cache dir whose `agents/` subdirectory holds fleet
 * files. Honors the same env overrides the redirector uses; defaults to the
 * product default `~/.augment` (audit §8).
 */
export function resolveAuggieCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AUGGIE_CACHE_DIR ?? env.AUGMENT_CACHE_DIR;
  return override && override.trim().length > 0 ? override.trim() : join(homedir(), ".augment");
}

/**
 * Runtime used to launch the external CLI. The CLI's streaming HTTP client
 * (undici) only delivers chunked response bodies under Node; under Bun the
 * agent loop hangs forever after "Calling chat" even though the bytes reach
 * the socket. `AUGGIE_NODE_BIN` overrides for exotic setups; otherwise prefer
 * an explicit `node` on PATH and fall back to our own executable (correct
 * when the server itself runs under Node/Electron's Node).
 */
function nodeExecutableForAuggie(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AUGGIE_NODE_BIN?.trim();
  if (override) return override;
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
  if (!isBun) return process.execPath;
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  for (const dir of pathValue.split(pathDelimiter).filter(Boolean)) {
    for (const candidate of ["node.exe", "node"]) {
      const resolved = join(dir, candidate);
      if (existsSync(resolved)) return resolved;
    }
  }
  return process.execPath;
}

/**
 * Ensure `~/.augment/.auggie.json` carries `onboardingVersion`. The
 * interactive TUI writes it when the user answers the first-run consent
 * prompts; `--acp` has no TUI, and without this file the CLI never finishes
 * its startup sequence (it stops after get-models and never answers ACP
 * `initialize`). Merges into any existing state to preserve
 * lastUsed/sessionCount/anonId.
 *
 * Indexing is disabled by default (product rule): when the workspace dir
 * is known it is merged into `indexingDenyDirs`, so the CLI never starts
 * its indexing-consent flow for that workspace at all. The remaining
 * layers stay as backstops: the redirector's /find-missing never reports
 * missing blobs (nothing can be uploaded), and any consent prompt that
 * still appears is auto-answered "always-disable" by the bridge.
 */
export async function ensureAuggieOnboardingComplete(
  denyIndexingDir?: string,
  homeDir: string = homedir(),
): Promise<void> {
  const statePath = join(homeDir, ".augment", ".auggie.json");
  let state: Record<string, unknown> = {};
  try {
    const raw = await fsPromises.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      state = parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or unreadable state — start from a fresh object.
  }
  let changed = false;
  if (typeof state.onboardingVersion !== "string" || state.onboardingVersion.length === 0) {
    state.onboardingVersion = "1.0.0";
    changed = true;
  }
  if (typeof state.anonId !== "string" || state.anonId.length === 0) {
    state.anonId = randomUUID();
    changed = true;
  }
  if (denyIndexingDir && denyIndexingDir.trim().length > 0) {
    const dir = denyIndexingDir.trim();
    const existing = Array.isArray(state.indexingDenyDirs)
      ? state.indexingDenyDirs.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (!existing.includes(dir)) {
      state.indexingDenyDirs = [...existing, dir];
      changed = true;
    }
  }
  if (!changed) return;
  await fsPromises.mkdir(join(homeDir, ".augment"), { recursive: true });
  await fsPromises.writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/** Render one fleet entry as an auggie agents markdown file. Pure. */
export function buildAuggieAgentMarkdown(entry: AuggieAgentFleetEntry): string {
  const lines: string[] = ["---"];
  if (entry.description && entry.description.trim().length > 0) lines.push(`description: ${entry.description.trim()}`);
  if (entry.model && entry.model.trim().length > 0) lines.push(`model: ${entry.model.trim()}`);
  if (entry.color && entry.color.trim().length > 0) lines.push(`color: ${entry.color.trim()}`);
  // tools whitelist and disabledTools are mutually exclusive per audit §4;
  // prefer the whitelist when both are set.
  const tools = (entry.tools ?? []).map((tool) => tool.trim()).filter((tool) => tool.length > 0);
  const disabledTools = (entry.disabledTools ?? []).map((tool) => tool.trim()).filter((tool) => tool.length > 0);
  if (tools.length > 0) lines.push(`tools: ${tools.join(", ")}`);
  else if (disabledTools.length > 0) lines.push(`disabledTools: ${disabledTools.join(", ")}`);
  if (entry.finishTool && entry.finishTool.trim().length > 0) lines.push(`finishTool: ${entry.finishTool.trim()}`);
  lines.push("---", "");
  const body = entry.prompt.endsWith("\n") ? entry.prompt : entry.prompt + "\n";
  return lines.join("\n") + body;
}

function auggieAgentFileName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return (slug.length > 0 ? slug : "agent") + ".md";
}

/**
 * Write a fleet of agent definitions into `<cacheDir>/agents/*.md`, creating
 * the directory on demand and overwriting entries with the same name. Returns
 * the agents directory written. Entries not present in `agents` are left
 * untouched (auggie ships built-in plan/code/research defaults there too).
 */
export async function writeAuggieAgentFleet(
  cacheDir: string,
  agents: readonly AuggieAgentFleetEntry[],
): Promise<string> {
  const agentsDir = join(cacheDir, "agents");
  await fsPromises.mkdir(agentsDir, { recursive: true });
  for (const agent of agents) {
    await fsPromises.writeFile(join(agentsDir, auggieAgentFileName(agent.name)), buildAuggieAgentMarkdown(agent), "utf8");
  }
  return agentsDir;
}

/**
 * Fleet source for the pre-spawn hook: a JSON array of
 * {@link AuggieAgentFleetEntry} in `AUGGIE_AGENT_FLEET`. Malformed payloads
 * parse to an empty list (the child still starts with auggie's built-ins).
 */
export function parseAuggieAgentFleetEnv(env: NodeJS.ProcessEnv): AuggieAgentFleetEntry[] {
  const raw = env.AUGGIE_AGENT_FLEET;
  if (!raw || raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: AuggieAgentFleetEntry[] = [];
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.prompt !== "string") continue;
    entries.push({
      name: record.name,
      prompt: record.prompt,
      ...(typeof record.description === "string" ? { description: record.description } : {}),
      ...(typeof record.model === "string" ? { model: record.model } : {}),
      ...(typeof record.color === "string" ? { color: record.color } : {}),
      ...(Array.isArray(record.tools) ? { tools: record.tools.filter((t): t is string => typeof t === "string") } : {}),
      ...(Array.isArray(record.disabledTools)
        ? { disabledTools: record.disabledTools.filter((t): t is string => typeof t === "string") }
        : {}),
      ...(typeof record.finishTool === "string" ? { finishTool: record.finishTool } : {}),
    });
  }
  return entries;
}

function terminateAuggieProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid) {
    // Best-effort tree kill on Windows; falls back to SIGTERM on failure.
    try {
      const terminated = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
      if (!terminated.error && terminated.status === 0) return;
    } catch {
      // fallthrough to kill
    }
  }
  child.kill("SIGTERM");
}

export class AuggieAgentBridge extends EventEmitter implements CodexRuntimeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<string, {
    resolve: (v: JsonValue) => void;
    reject: (e: unknown) => void;
    method: string;
  }>();
  /** Maps a routed approval id (the Codex `item/*requestApproval` envelope
   *  id) back to the auggie `session/request_permission` request id + the
   *  thread the permission belongs to. Populated on inbound
   *  `session/request_permission`; consumed by `respond()`. */
  private pendingPermissions = new Map<string, { acpId: number | string; threadId: string }>();
  private status: EngineStatus = { phase: "idle", transport: "stdio" };
  private configuredModel: string | undefined = undefined;
  private configuredCwd: string | undefined = undefined;
  private configuredThreadId: string | undefined = undefined;
  private sessions = new Map<string, AuggieSession>();
  /** Maps auggie `sessionId` -> our threadId so inbound ACP events route. */
  private sessionIdToThread = new Map<string, string>();
  private readonly runtimeEnvSnapshot: NodeJS.ProcessEnv;
  private childExitPromise: Promise<void> = Promise.resolve();
  private bridgeEventLog: BridgeEventLogger | undefined;

  public constructor(
    runtimeEnv: () => NodeJS.ProcessEnv = () => ({}),
  ) {
    super();
    this.runtimeEnvSnapshot = { ...runtimeEnv() };
  }

  /** Lazily-created diagnostic event log (local disk; env dir fallback). */
  private eventLogger(): BridgeEventLogger {
    if (!this.bridgeEventLog) {
      this.bridgeEventLog = createBridgeEventLogger("auggie");
    }
    return this.bridgeEventLog;
  }

  public getStatus(): EngineStatus {
    return { ...this.status };
  }

  /** Version label of the resolved external binary for the initialize UA. */
  private probedVersionLabel(): string {
    const bin = findAuggieBin(this.runtimeEnvSnapshot);
    return (bin ? probeAuggieVersion(bin) : null) ?? "external";
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.emit("status", this.getStatus());
  }

  /** Apply start-config params the same way codeCliBridge does. */
  private applyStartConfig(params?: JsonValue): void {
    const p = (params && typeof params === "object" && !Array.isArray(params))
      ? params as Record<string, JsonValue>
      : {};
    const threadId = typeof p.threadId === "string" ? p.threadId : undefined;
    if (threadId) this.configuredThreadId = threadId;
    const model = typeof p.model === "string" ? p.model : undefined;
    if (model) this.configuredModel = model;
    const cwd = typeof p.cwd === "string" ? p.cwd : undefined;
    if (cwd) this.configuredCwd = cwd;
        void p;
  }

  /** Keep thread-relay / model identity current without touching the child
   *  (mirror of codeCliBridge.configure). */
  public configure(params?: JsonValue): void {
    this.applyStartConfig(params);
  }

  /**
   * Model switching surface, mirroring codeCliBridge.applyRuntimeConfig: the
   * routing layer calls it with the same params it sends for Claude turns.
   * Auggie's counterpart is the unstable `session/set_model {sessionId,
   * modelId}` RPC, which writes agentState.modelId and takes effect on the
   * NEXT prompt — so when the child is not running we only record the model
   * here and let the next `turn/start` push it via {@link setSessionModel}.
   */
  public async applyRuntimeConfig(params?: JsonValue): Promise<void> {
    const previousModel = this.configuredModel;
    this.applyStartConfig(params);
    const session = this.configuredThreadId ? this.sessions.get(this.configuredThreadId) : undefined;
    if (!session || !this.configuredModel || this.configuredModel === previousModel) return;
    await this.setSessionModel(session, this.configuredModel);
  }

  /**
   * Point an open auggie session at a new model (`session/set_model`,
   * unstable per audit §3). Best-effort: failures are logged and never fail
   * the turn, since the recorded model still rides the next prompt cycle.
   */
  private async setSessionModel(session: AuggieSession, modelId: string): Promise<void> {
    const sessionId = session.externalSessionId;
    session.model = modelId;
    if (!sessionId || !this.child) return;
    try {
      await this.sendRequest({
        method: AUGGIE_METHOD.sessionSetModel,
        params: { sessionId, modelId },
      });
    } catch (error) {
      this.emit("stderr", `auggie session/set_model '${modelId}' failed: ` + stringifyError(error) + "\n");
    }
  }

  /**
   * Spawn the auggie CLI with `--acp` and the redirector-injected env
   * (a JS entry runs under Node directly; platform shims go through the
   * SDK's Windows-safe spawnCli — see the spawn site below).
   * The redirector owns AUGMENT_API_URL / AUGMENT_API_TOKEN /
   * AUGMENT_SESSION_AUTH; everything else is inherited from the runtime env
   * snapshot. Throws a clear error if no auggie binary is resolvable.
   */
  public async start(): Promise<EngineStatus> {
    if (this.status.phase === "ready" || this.status.phase === "starting") {
      return this.getStatus();
    }

    const bin = findAuggieBin(this.runtimeEnvSnapshot);
    if (!bin) {
      const message = "Auggie backend could not resolve an auggie binary (install @augmentcode/auggie or set AUGGIE_BIN).";
      this.setStatus({ ...this.status, phase: "error", message });
      throw new Error(message);
    }

    // The redirector must be up before we spawn — auggie's auth gate reads
    // AUGMENT_API_URL/AUGMENT_SESSION_AUTH at startup (§5.4 / §6.2a).
    let redirector: AuggieRedirectorHandle;
    try {
      redirector = await ensureAuggieRedirector();
    } catch (error) {
      const message = stringifyError(error);
      this.setStatus({ ...this.status, phase: "error", message });
      throw error;
    }

    // `injectEnvFor` returns a new env object (does NOT mutate in place — see
    // auggieRedirector.ts:makeHandle). Capture the returned value.
    const spawnEnv: NodeJS.ProcessEnv = redirector.injectEnvFor({ ...this.runtimeEnvSnapshot });

    // Fleet definitions (rollout todolist F2) must be on disk before the
    // child spawns — auggie reads <cacheDir>/agents/ once at startup.
    try {
      const fleet = parseAuggieAgentFleetEnv(spawnEnv);
      if (fleet.length > 0) {
        const agentsDir = await writeAuggieAgentFleet(resolveAuggieCacheDir(spawnEnv), fleet);
        this.emit("stderr", `auggie agents fleet written to ${agentsDir} (${fleet.length} entries)\n`);
      }
    } catch (error) {
      // Non-fatal: a failed fleet sync still leaves auggie's built-in agents usable.
      this.emit("stderr", "auggie agents fleet sync failed: " + stringifyError(error) + "\n");
    }

    // Mark onboarding complete before the child spawns. The CLI's interactive
    // TUI asks first-run consent questions and persists the answer as
    // `onboardingVersion` in ~/.augment/.auggie.json; in --acp mode there is
    // no TUI to answer them and the CLI stalls before replying to
    // `initialize` (verified live: reference proxy + fresh HOME hangs at
    // get-models until this file exists). Merge, never overwrite — the file
    // also carries lastUsed/sessionCount/anonId.
    try {
      await ensureAuggieOnboardingComplete(this.configuredCwd || process.cwd());
    } catch (error) {
      // Non-fatal: an unwritable HOME is unusual; auggie will just sit on its
      // onboarding prompts as before.
      this.emit("stderr", "auggie onboarding pre-write failed: " + stringifyError(error) + "\n");
    }

    const spawnCwd = this.configuredCwd || process.cwd();
    this.setStatus({
      phase: "starting",
      transport: "stdio",
      message: "Starting auggie --acp",
      startedAt: Date.now(),
    });
    this.emit("status", this.getStatus());

    let child: ChildProcessWithoutNullStreams;
    try {
      // Keep session files inside the app data dir instead of ~/.augment;
      // --augment-cache-dir is the only relocation mechanism the CLI offers
      // (there is no env override) and it propagates to subagent processes.
      // --model pins the chat model to our upstream id: without it the ACP
      // session starts with an empty modelId (settings/registry don't feed
      // it) and every turn sends `model: ""` and never completes.
      // The CLI MUST run under Node, not Bun: its undici-based streaming
      // fetch never delivers chunked response bodies under Bun's compat layer
      // (requests send fine, the agent loop then waits forever), while under
      // Node the same request/response round-trips cleanly. When we are
      // bundled into a Node binary process.execPath already is node.
      const modelArg = this.configuredModel?.trim() || configuredUpstreamModel();
      const auggieArgs = ["--acp", "--model", modelArg, "--augment-cache-dir", resolveAuggieCacheDir(spawnEnv)];
      const spawnOptions: { cwd: string; env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"]; windowsHide: boolean } = {
        cwd: spawnCwd,
        env: spawnEnv,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: process.platform === "win32",
      };
      // A resolved JS entry runs under Node directly. Anything else — a
      // POSIX shim, a real executable, and on Windows the npm `.cmd` /
      // `.bat` / `.ps1` shims — goes through the SDK's spawnCli: feeding a
      // `.cmd` shim to `node` made the CLI die instantly with exit code 1
      // on Windows (node parses the batch file as JS), while spawnCli
      // wraps shims in cmd.exe, whose shim still execs Node for the real
      // entry, preserving the must-run-under-Node property above.
      child = /\.(?:cjs|mjs|js)$/i.test(bin)
        ? spawn(nodeExecutableForAuggie(), [bin, ...auggieArgs], spawnOptions)
        : spawnCli(bin, auggieArgs, spawnOptions);
    } catch (error) {
      const message = stringifyError(error);
      this.setStatus({ ...this.status, phase: "error", message });
      throw error;
    }
    this.child = child;

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
    child.once("exit", (code, signal) => {
      settleChildExit();
      this.invalidateChild(child, "auggie exited with code " + (code ?? "null") + " signal " + (signal ?? "null"));
    });
    child.once("error", (error) => {
      settleChildExit();
      this.invalidateChild(child, stringifyError(error));
    });

    // Line-buffer stdout; auggie emits NDJSON (one JSON-RPC frame per line).
    let stdoutBuffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      let newlineIndex: number;
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        this.handleLine(line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const message = redactSecrets(chunk.toString("utf8").trim());
      if (message.length > 0) this.emit("stderr", message);
    });

    try {
      await this.handshake();
    } catch (error) {
      const message = stringifyError(error);
      this.setStatus({ ...this.status, phase: "error", message });
      try { terminateAuggieProcessTree(child); } catch { /* */ }
      this.child = null;
      throw error;
    }

    this.setStatus({ ...this.status, phase: "ready", message: "auggie --acp ready" });
    this.emit("status", this.getStatus());
    return this.getStatus();
  }

  /** initialize + session/new-style handshake. No session is opened here —
   *  threads open their own `session/new` on `thread/start` (mirrors
   *  codeCliBridge). */
  private async handshake(): Promise<void> {
    const initResult = await this.sendRequest(buildAuggieInitialize());
    const initRecord = jsonRecord(initResult as JsonValue);
    const protocolVersion = initRecord.protocolVersion;
    if (protocolVersion !== 1 && protocolVersion !== "1") {
      throw new Error("auggie returned unsupported protocolVersion: " + JSON.stringify(protocolVersion));
    }
  }

  public stop(): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error("auggie backend stopped"));
    }
    this.pendingRequests.clear();
    this.pendingPermissions.clear();
    this.setStatus({ ...this.status, phase: "stopped", message: "Stopped" });
    const child = this.child;
    if (child) {
      try { terminateAuggieProcessTree(child); } catch {
        try { child.kill("SIGTERM"); } catch { /* */ }
      }
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

  public async request(method: string, params?: JsonValue, timeoutMs = 60_000): Promise<JsonValue> {
    if (method === "thread/fork") {
      throw new Error("Auggie backend does not support thread/fork");
    }
    if (!this.child) {
      if (method === "turn/interrupt") return this.handleMethod(method, params ?? {}, timeoutMs);
      if (!augNeedsRunningProcess(method)) {
        return this.handleMethod(method, params ?? {}, timeoutMs);
      }
      if (method === "thread/start") {
        this.applyStartConfig(params);
      }
      await this.start();
    }
    if (!this.child && augNeedsRunningProcess(method)) {
      throw new Error("auggie backend is not running");
    }
    return this.handleMethod(method, params ?? {}, timeoutMs);
  }

  public async notify(method: string, params?: JsonValue): Promise<void> {
    await this.handleMethod(method, params ?? {}, 0);
  }

  /**
   * Reply to an `item/*requestApproval` server request the frontend answered.
   * `id` is the routed approval id we emitted; we look up the original auggie
   * `session/request_permission` request id, derive the chosen optionId from
   * `result`, and write {@link buildAuggiePermissionResult} to auggie's
   * stdin. Mirrors codeCliBridge.respond (line ~848) but adapted to auggie's
   * reversed approval direction.
   */
  public respond(id: JsonRpcId, result?: JsonValue, error?: JsonRpcFailure["error"]): void {
    const routedId = String(id);
    const pending = this.pendingPermissions.get(routedId);
    if (!pending) return;
    this.pendingPermissions.delete(routedId);

    if (error) {
      // Treat an error as a cancellation.
      const cancelOutcome: AuggiePermissionOutcome = { outcome: "cancelled" };
      this.writeStdin(buildAuggiePermissionResult(pending.acpId, cancelOutcome));
      return;
    }

    // The frontend sends the chosen optionId either at top level
    // (`result.optionId`) or nested under `result.outcome.optionId`. Accept
    // both so the routing layer (task #6) can pass the Codex approval shape
    // through unchanged.
    const record = jsonRecord(result);
    const outcome = jsonRecord(record.outcome);
    const optionId = typeof record.optionId === "string"
      ? record.optionId
      : typeof outcome.optionId === "string"
        ? outcome.optionId
        : undefined;
    if (optionId) {
      this.writeStdin(buildAuggiePermissionResult(pending.acpId, { outcome: "selected", optionId }));
    } else {
      this.writeStdin(buildAuggiePermissionResult(pending.acpId, { outcome: "cancelled" }));
    }
  }

  private writeStdin(message: unknown): void {
    if (!this.child) throw new Error("auggie backend is not running");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  /**
   * Send a JSON-RPC request to auggie and await its result. Rejects on
   * `error` envelope, timeout, or child exit.
   */
  private sendRequest(message: { method?: string; params?: Record<string, unknown> }, timeoutMs = 60_000): Promise<JsonValue> {
    if (!this.child) return Promise.reject(new Error("auggie backend is not running"));
    const id = this.nextRequestId++;
    const frame = { jsonrpc: "2.0", id, ...message } as { jsonrpc: "2.0"; id: number; method?: string; params?: Record<string, unknown> };
    return new Promise<JsonValue>((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        if (this.pendingRequests.has(String(id))) {
          this.pendingRequests.delete(String(id));
          reject(new Error(`auggie request '${frame.method ?? ""}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs) : undefined;
      this.pendingRequests.set(String(id), {
        resolve: (v) => { if (timer) clearTimeout(timer); resolve(v); },
        reject: (e) => { if (timer) clearTimeout(timer); reject(e); },
        method: frame.method ?? "",
      });
      try {
        this.writeStdin(frame);
      } catch (error) {
        this.pendingRequests.delete(String(id));
        if (timer) clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Inbound NDJSON frame dispatch. Routes JSON-RPC results to pending
   * requests, notifications (`session/update`) and requests
   * (`session/request_permission`, host-capability requests) to the
   * synthesised Codex notification stream.
   */
  private handleLine(line: string): void {
    const event: AcpEvent | null = ((): AcpEvent | null => {
      try {
        const trimmed = line.trim();
        if (trimmed.length === 0) return null;
        return JSON.parse(trimmed) as AcpEvent;
      } catch {
        this.emit("stderr", "Unparseable auggie stdout: " + redactSecrets(line));
        return null;
      }
    })();
    if (!event) return;

    this.emit("auggie:raw", event);

    // Diagnostic frame log (local disk): text chunks log a length only,
    // tool/permission/lifecycle frames log in full (64KB cap).
    try {
      const update = asSessionUpdate(event);
      if (update) {
        const kind = update.params.update.sessionUpdate;
        const content = (update.params.update as Record<string, unknown>).content;
        const text = content && typeof (content as Record<string, unknown>).text === "string"
          ? ((content as Record<string, unknown>).text as string).length : 0;
        this.eventLogger().append(kind === "agent_message_chunk"
          ? { kind: "frame", frame: kind, sessionId: update.params.sessionId, textLen: text }
          : { kind: "frame", frame: kind, sessionId: update.params.sessionId, update: update.params.update });
      } else {
        const record = event as unknown as Record<string, unknown>;
        this.eventLogger().append({
          kind: "frame",
          frame: typeof record.method === "string" ? record.method : ("id" in event ? "result" : "unknown"),
          ...(typeof record.id !== "undefined" ? { id: String(record.id) } : {}),
          event: record,
        });
      }
    } catch { /* logging must never break turns */ }

    // JSON-RPC result for a request we sent (initialize / session/new /
    // session/prompt / session/cancel).
    if ("id" in event && !("method" in event)) {
      const id = (event as { id?: number | string }).id;
      if (id === undefined) return;
      const pending = this.pendingRequests.get(String(id));
      if (!pending) return;
      this.pendingRequests.delete(String(id));
      const err = (event as { error?: { message: string } }).error;
      if (err) {
        pending.reject(new Error(err.message ?? "auggie request error"));
      } else {
        pending.resolve((event as { result?: JsonValue }).result ?? ({} as JsonValue));
      }
      return;
    }

    // session/update notification — streaming assistant text + command list.
    const update = asSessionUpdate(event);
    if (!update) {
      // Diagnostics: every non-update inbound frame (results, permission
      // requests, unknown methods) — the turn pipeline has had silent stalls
      // before, so log what actually arrives from the CLI.
      const method = (event as { method?: string }).method;
      const hasId = "id" in event;
      if (method === AUGGIE_METHOD.sessionPrompt || hasId || method) {
        console.error(`[auggie-bridge] <- ${hasId && !method ? `result id=${(event as { id?: unknown }).id}` : method}`);
      }
    }
    if (update) {
      this.handleSessionUpdate(update);
      return;
    }

    // session/request_permission — agent -> host request.
    const permission = asRequestPermission(event);
    if (permission) {
      this.handleRequestPermission(permission);
      return;
    }

    // Host-capability requests (fs/read_text_file, terminal/create, …) — for
    // this task, log-only / reject. Execution is the security boundary in
    // task #7-adjacent; we do not implement filesystem or terminal execution
    // here.
    if ("method" in event && "id" in event) {
      const method = (event as { method?: string }).method ?? "";
      const id = (event as { id?: number | string }).id;
      if (id !== undefined && method !== AUGGIE_METHOD.sessionRequestPermission) {
        this.emit("stderr", `auggie host-capability request '${method}' received; rejecting (not implemented in this task)\n`);
        this.writeStdin({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `host capability '${method}' not implemented` },
        });
      }
    }
  }

  private handleSessionUpdate(event: AcpSessionUpdateEvent): void {
    const sessionId = event.params.sessionId;
    const threadId = this.sessionIdToThread.get(sessionId);
    const session = threadId ? this.sessions.get(threadId) : undefined;
    if (!threadId || !session) {
      // No mapping yet — auggie may push updates before session/new resolves.
      // Restore-on-reconnect pre-maps the session BEFORE issuing session/load,
      // so replayed history lands in the restore collector instead of here
      // (mirrors codeCliBridge's unmapped-session path for genuinely unknown
      // sessions).
      return;
    }
    const update = event.params.update;

    // While session/load replays persisted history we only collect raw text:
    // streaming deltas and tool cards make no sense for replayed turns.
    if (session.restoreCollector) {
      const text = update.content && typeof update.content.text === "string" ? update.content.text : "";
      if (text.length > 0) {
        if (update.sessionUpdate === AUGGIE_SESSION_UPDATE_AGENT_MESSAGE_CHUNK) {
          session.restoreCollector.push({ role: "assistant", text });
        } else if (update.sessionUpdate === AUGGIE_SESSION_UPDATE_USER_MESSAGE_CHUNK) {
          session.restoreCollector.push({ role: "user", text });
        }
      }
      return;
    }

    if (update.sessionUpdate === AUGGIE_SESSION_UPDATE_TOOL_CALL) {
      this.handleAuggieToolCall(session, threadId, update);
      return;
    }
    if (update.sessionUpdate === AUGGIE_SESSION_UPDATE_TOOL_CALL_UPDATE) {
      this.handleAuggieToolCallUpdate(session, threadId, update);
      return;
    }
    if (isAgentMessageChunk(event)) {
      const content = update.content;
      const text = content && typeof content.text === "string" ? content.text : "";
      if (text.length === 0) return;
      // Housekeeping notice the CLI emits after indexing consent is denied.
      // It reads as a (confusing) assistant reply in the transcript, so it is
      // dropped rather than surfaced; indexing state is already enforced
      // host-side and never user-visible.
      if (/^Indexing (disabled|enabled) for current workspace .*? for this session\.\s*$/s.test(text)) {
        return;
      }
      // The indexing-consent preamble ("Augment would like to index your
      // workspace...") is part of the same suppressed interaction: indexing
      // is disabled by default, the consent request itself is auto-declined
      // by the bridge, and the user must never see the ask in the transcript.
      if (/would like to index your workspace/i.test(text) || /indexing your workspace/i.test(text)) {
        return;
      }
      const activeTurnId = session.activeTurnId;
      if (!activeTurnId) return;
      let itemId = session.openTextByTurn.get(activeTurnId) ?? null;
      if (!itemId) {
        const seg = (session.textSegByTurn.get(activeTurnId) ?? 0) + 1;
        session.textSegByTurn.set(activeTurnId, seg);
        itemId = `auggie-${activeTurnId}-text-${seg}`;
        session.openTextByTurn.set(activeTurnId, itemId);
      }
      const streamMap = session.streamedAssistantByTurn.get(activeTurnId) ?? new Map<string, string>();
      const isFirstText = !streamMap.has(itemId);
      streamMap.set(itemId, (streamMap.get(itemId) ?? "") + text);
      session.streamedAssistantByTurn.set(activeTurnId, streamMap);
      session.lastActivityMs = Date.now();
      if (isFirstText) {
        // Hold the text row's position while the turn runs: without a live
        // item/started, the completed text card lands after every tool row
        // at flush time and the transcript reads out of order.
        const textItem: Record<string, JsonValue> = {
          type: "agentMessage",
          id: itemId,
          turnId: activeTurnId,
          threadId,
          content: "",
          role: "assistant",
          status: "inProgress",
        };
        upsertSessionItem(session, textItem);
        this.emit("message", {
          method: "item/started",
          params: { threadId, turnId: activeTurnId, item: textItem },
        } as JsonRpcMessage);
      }
      this.emit("message", {
        method: "item/agentMessage/delta",
        params: { threadId, turnId: activeTurnId, itemId, delta: text },
      } as JsonRpcMessage);
      // The CLI's session/prompt result can lag the last streamed delta by
      // ~50s on this machine (an internal session-store lock stalls its
      // post-turn save), which would leave the composer spinning on a turn
      // whose reply is already fully on screen. Finalize the turn after a
      // short stream-silence window instead; the real prompt result is still
      // handled if it arrives earlier, and is a no-op afterwards.
      this.armTurnSilenceTimer(session, threadId, activeTurnId);
    } else if (isAvailableCommandsUpdate(event)) {
      // Logged only; surfacing as composer slash-commands is future work.
      // No Codex notification equivalent in the minimal §3.1 surface.
    }
  }

  /**
   * Close the turn's open text segment (if any) so a tool card inserted now
   * keeps dialogue/tool/dialogue order. The completed segment is pushed to
   * the conversation immediately; later deltas open a fresh segment.
   */
  private closeOpenTextSegment(session: AuggieSession, threadId: string): void {
    const turnId = session.activeTurnId;
    if (!turnId) return;
    const itemId = session.openTextByTurn.get(turnId) ?? null;
    if (!itemId) return;
    session.openTextByTurn.set(turnId, null);
    const text = session.streamedAssistantByTurn.get(turnId)?.get(itemId) ?? "";
    session.streamedAssistantByTurn.get(turnId)?.delete(itemId);
    if (!text) return;
    const item: Record<string, JsonValue> = {
      type: "agentMessage",
      id: itemId,
      turnId,
      threadId,
      content: text,
      role: "assistant",
      status: "completed",
    };
    upsertSessionItem(session, item);
    this.emit("message", {
      method: "item/completed",
      params: { threadId, turnId, item },
    } as JsonRpcMessage);
    const normalized = normalizeAssistantText(text);
    const previous = session.conversation.at(-1);
    if (normalized && !(previous?.role === "assistant" && normalizeAssistantText(previous.text) === normalized)) {
      session.conversation.push({ role: "assistant", text: normalized });
    }
    const blocks = session.assistantTextByTurn.get(turnId) ?? [];
    if (!blocks.includes(text)) blocks.push(text);
    session.assistantTextByTurn.set(turnId, blocks);
  }

  /**
   * Map an auggie `tool_call` onto the Codex `toolCall` item shape
   * codeCliBridge emits (`item/started`). Subagents arrive here too: one call
   * per subagent, title = agent name + up-to-80-char instruction summary.
   */
  private handleAuggieToolCall(
    session: AuggieSession,
    threadId: string,
    update: AcpSessionUpdateEvent["params"]["update"],
  ): void {
    const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : "";
    if (!toolCallId) return;
    // A tool starting mid-text ends the current text segment first.
    this.closeOpenTextSegment(session, threadId);
    const turnId = session.activeTurnId;
    const existing = session.toolCallsByAcpId.get(toolCallId);
    const title = typeof update.title === "string" && update.title.length > 0 ? update.title : "Tool";
    // Subagent frames reuse the tool_call shape (verified against the
    // installed CLI: kind "other" with no rawInput, title "<agent>: <task>").
    // A repeated frame carrying result text is the subagent's completion.
    const subagent = isAuggieSubagentUpdate(update);
    const existingResult = subagent && existing
      ? extractAuggieResultText((update as Record<string, JsonValue>).content ?? (update as Record<string, JsonValue>).rawOutput)
      : "";
    let item: Record<string, JsonValue>;
    if (subagent) {
      item = buildAuggieCollabItem(threadId, turnId, toolCallId, title, update, existing);
      if (existingResult) {
        item.status = "completed";
        item.agentStatus = "completed";
        item.output = existingResult;
        item.result = { content: existingResult } as unknown as JsonValue;
      }
    } else {
      item = {
        type: "toolCall",
        id: toolCallId,
        ...(turnId ? { turnId } : {}),
        threadId,
        toolName: title,
        arguments: jsonRecord(update.rawInput as JsonValue),
        status: "inProgress",
      };
    }
    session.toolCallsByAcpId.set(toolCallId, item);
    upsertSessionItem(session, item);
    // Tool activity resets the stream-silence window: a tool-heavy phase
    // with no assistant text must not finalize the turn early.
    session.lastActivityMs = Date.now();
    if (turnId) this.armTurnSilenceTimer(session, threadId, turnId);
    const done = item.status === "completed" || item.status === "failed";
    this.emit("message", {
      method: done ? "item/completed" : "item/started",
      params: { threadId, turnId, item },
    } as JsonRpcMessage);
  }

  /**
   * Pair a `tool_call_update` with its `tool_call` by `toolCallId` and settle
   * the card (`item/completed` on completed/failed, another `item/started`
   * while still in progress). An update with no seen start is synthesised so
   * late updates still render instead of being dropped.
   */
  private handleAuggieToolCallUpdate(
    session: AuggieSession,
    threadId: string,
    update: AcpSessionUpdateEvent["params"]["update"],
  ): void {
    const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : "";
    if (!toolCallId) return;
    const existing = session.toolCallsByAcpId.get(toolCallId)
      ?? session.messages
        .map((entry) => jsonRecord(entry))
        .find((entry) => entry.id === toolCallId && (entry.type === "toolCall" || entry.type === "collabAgentToolCall"));
    const turnId = typeof existing?.turnId === "string" ? existing.turnId : session.activeTurnId;
    const status = mapAuggieToolStatus(update.status);
    const resultText = extractAuggieResultText(update.content ?? update.rawOutput);
    // Preserve (or adopt) the collab shape: subagent cards must keep
    // converging the agent rail instead of downgrading to plain toolCall.
    const wasCollab = existing?.type === "collabAgentToolCall";
    const nowCollab = wasCollab || isAuggieSubagentUpdate(update);
    const base: Record<string, JsonValue> = nowCollab
      ? buildAuggieCollabItem(threadId, typeof turnId === "string" ? turnId : undefined, toolCallId,
        typeof update.title === "string" && update.title.length > 0
          ? update.title
          : typeof existing?.toolName === "string" ? existing.toolName : "Tool",
        update, wasCollab ? existing : undefined)
      : {};
    const item: Record<string, JsonValue> = {
      ...(existing ?? {}),
      ...base,
      type: nowCollab ? "collabAgentToolCall" : "toolCall",
      id: toolCallId,
      ...(turnId ? { turnId } : {}),
      threadId,
      toolName: typeof update.title === "string" && update.title.length > 0
        ? update.title
        : typeof existing?.toolName === "string" ? existing.toolName : "Tool",
      arguments: existing?.arguments ?? jsonRecord(update.rawInput as JsonValue),
      ...(resultText.length > 0 ? { result: { content: resultText } } : {}),
      status,
    };
    if (nowCollab && resultText.length > 0 && (status === "completed" || status === "failed")) {
      item.output = resultText;
      item.agentStatus = status;
    }
    session.toolCallsByAcpId.set(toolCallId, item);
    upsertSessionItem(session, item);
    // Tool progress also resets the stream-silence window.
    session.lastActivityMs = Date.now();
    if (typeof turnId === "string" && turnId) this.armTurnSilenceTimer(session, threadId, turnId);
    this.emit("message", {
      method: status === "inProgress" ? "item/started" : "item/completed",
      params: { threadId, turnId, item },
    } as JsonRpcMessage);
  }

  /**
   * Restore-on-reconnect (rollout todolist C7): recover a thread whose bridge
   * process was lost by replaying auggie's locally persisted session via
   * `session/list` + `session/load` (both pure local reads — audit §8).
   * Matching order: explicit externalSessionId/sessionId param → cwd match →
   * single stored session. Returns null when nothing plausible matches; the
   * caller then keeps the historical "Unknown thread" failure.
   */
  private async restoreAuggieThreadFromDisk(
    threadId: string,
    params: Record<string, JsonValue>,
  ): Promise<AuggieSession | null> {
    try {
      await this.start();
      const listResult = await this.sendRequest({ method: AUGGIE_METHOD.sessionList }, 30_000);
      const candidates = extractAuggieStoredSessions(listResult as JsonValue);
      if (candidates.length === 0) return null;

      const requestedExternalId = typeof params.externalSessionId === "string"
        ? params.externalSessionId
        : typeof params.sessionId === "string" ? params.sessionId : undefined;
      const cwd = typeof params.cwd === "string"
        ? params.cwd
        : this.configuredCwd;
      const candidate = pickAuggieRestoreCandidate(candidates, requestedExternalId, cwd);
      if (!candidate) return null;

      // Pre-map + pre-create the record BEFORE load: auggie replays history
      // as session/update chunks while we wait for the load result, and the
      // collector below is what turns those into restored items.
      const now = Date.now();
      const session: AuggieSession = {
        threadId,
        model: this.configuredModel,
        permissionMode: "on-request",
        cwd: candidate.cwd ?? cwd,
        createdAt: now,
        externalSessionId: candidate.sessionId,
        turns: [],
        messages: [],
        assistantTextByTurn: new Map(),
        streamedAssistantByTurn: new Map(),
        openTextByTurn: new Map(),
        textSegByTurn: new Map(),
        conversation: [],
        toolCallsByAcpId: new Map(),
        restoreCollector: [],
      };
      this.sessions.set(threadId, session);
      this.sessionIdToThread.set(candidate.sessionId, threadId);

      try {
        await this.sendRequest({
          method: AUGGIE_METHOD.sessionLoad,
          params: { sessionId: candidate.sessionId, cwd: candidate.cwd ?? cwd ?? process.cwd() },
        }, 120_000);
      } catch (error) {
        this.sessions.delete(threadId);
        this.sessionIdToThread.delete(candidate.sessionId);
        throw error;
      }
      this.finalizeRestoredSession(session, threadId);
      return session;
    } catch (error) {
      this.emit("stderr", "auggie restart recovery failed: " + stringifyError(error) + "\n");
      return null;
    }
  }

  /** Fold collected replay chunks into one completed synthetic turn. */
  private finalizeRestoredSession(session: AuggieSession, threadId: string): void {
    const collected = session.restoreCollector ?? [];
    session.restoreCollector = null;
    const turnId = `auggie-restored-${randomUUID()}`;
    const startedAt = Math.floor(session.createdAt / 1000);
    session.turns.push({ id: turnId, status: "completed", createdAt: session.createdAt });
    for (const entry of collected) {
      const normalized = normalizeAssistantText(entry.text);
      if (!normalized) continue;
      if (entry.role === "user") {
        const item: Record<string, JsonValue> = {
          type: "userMessage",
          id: `auggie-user-${randomUUID()}`,
          turnId,
          threadId,
          content: [{ type: "text", text: entry.text, text_elements: [] }],
          role: "user",
          status: "completed",
          startedAt,
        };
        session.messages.push(item as JsonValue);
        session.conversation.push({ role: "user", text: normalized });
      } else {
        const item: Record<string, JsonValue> = {
          type: "agentMessage",
          id: `auggie-assistant-${randomUUID()}`,
          turnId,
          threadId,
          content: normalized,
          role: "assistant",
          status: "completed",
        };
        session.messages.push(item as JsonValue);
        session.conversation.push({ role: "assistant", text: normalized });
      }
    }
    const firstUser = collected.find((entry) => entry.role === "user");
    if (firstUser && !session.preview) {
      session.preview = normalizeAssistantText(firstUser.text).slice(0, 120);
    }
  }

  /**
   * Translate an auggie `session/request_permission` into a Codex
   * `item/*requestApproval` server request. We pick the method based on the
   * toolCall title (best-effort; default is `item/permissions/requestApproval`).
   * The routed id we emit is what the frontend returns to `respond()`.
   */
  private handleRequestPermission(event: AcpRequestPermissionEvent): void {
    const sessionId = event.params.sessionId;
    const threadId = this.sessionIdToThread.get(sessionId);
    if (!threadId) {
      // Unknown session — deny so auggie does not hang on a request.
      this.writeStdin(buildAuggiePermissionResult(event.id, { outcome: "cancelled" }));
      return;
    }
    const toolCall = event.params.toolCall;
    const title = typeof toolCall.title === "string" ? toolCall.title : "";
    // Workspace-indexing consent is answered automatically: indexing is
    // disabled by design (the redirector's /find-missing never reports missing
    // blobs), so prompting the user would only produce noise. "always-disable"
    // also persists the deny into the CLI settings, silencing future prompts.
    if (toolCall.toolCallId === "workspace-indexing-permission" || /indexing permission/i.test(title)) {
      const denyOption = event.params.options.find(
        (option) => option.optionId === "always-disable",
      ) ?? event.params.options.find((option) => String(option.kind ?? "").startsWith("reject"));
      this.writeStdin(
        buildAuggiePermissionResult(
          event.id,
          denyOption ? { outcome: "selected", optionId: denyOption.optionId } : { outcome: "cancelled" },
        ),
      );
      this.emit(
        "stderr",
        "auggie workspace-indexing permission auto-declined (indexing is disabled by design)\n",
      );
      return;
    }
    const method = this.approvalMethodForTool(title, toolCall.toolCallId);
    const routedId = `auggie-perm-${event.id}`;
    this.pendingPermissions.set(routedId, { acpId: event.id, threadId });
    try {
      this.eventLogger().append({
        kind: "permission-asked",
        threadId,
        requestId: routedId,
        title,
        toolCallId: toolCall.toolCallId,
        options: event.params.options,
      });
    } catch { /* ignore */ }
    const session = this.sessions.get(threadId);
    if (session) session.lastActivityMs = Date.now();
    // We emit as a JSON-RPC request (with envelope `id`) so the routing layer
    // (task #6) sees it the same way it sees Codex `item/*requestApproval`
    // from the daemon bridge — the WS path adds it to the pending-approvals
    // map and `respondToCodexServerRequest` ends up calling our `respond()`.
    this.emit("message", {
      id: routedId,
      method,
      params: {
        threadId,
        // toolCallId / title carried so the UI can render the approval card
        // like Codex renders its own approvals.
        toolCallId: toolCall.toolCallId,
        title,
        options: event.params.options,
      },
    } as JsonRpcMessage);
  }

  /**
   * Pick a Codex `item/*requestApproval` method for an auggie tool call.
   * Codex splits approvals by effect (command execution vs file change vs
   * generic permission); auggie only gives us `toolCall.title`, so we
   * keyword-match. Unrecognised tools fall through to the generic
   * `item/permissions/requestApproval`, which the UI renders as a plain
   * accept/deny card — same as for Codex network/permission approvals.
   */
  private approvalMethodForTool(title: string, _toolCallId: string): string {
    const lower = title.toLowerCase();
    if (/launch|process|bash|shell|terminal|exec|run/.test(lower)) {
      return "item/commandExecution/requestApproval";
    }
    if (/save|write|edit|apply|patch|str-replace|file|create|delete|move|rename/.test(lower)) {
      return "item/fileChange/requestApproval";
    }
    return "item/permissions/requestApproval";
  }

  /**
   * The main RPC dispatcher. Mirrors codeCliBridge.handleMethod — same method
   * names, same return shapes, same no-op degradation for advanced §3.2
   * methods. The minimal §3.1 surface is implemented; everything else
   * returns an empty object / in-memory list like codeCliBridge.
   */
  private async handleMethod(method: string, params: JsonValue, _timeoutMs: number): Promise<JsonValue> {
    const p = params as Record<string, JsonValue>;

    switch (method) {
      case "initialize":
      case "config/read":
        return {
          userAgent: `auggie/${this.probedVersionLabel()} codex-react-ui/0.1.0`,
          codexHome: process.env.CODEX_HOME || "",
          capabilities: { experimentalApi: true },
        } as JsonValue;

      case "thread/start": {
        const threadId = (typeof p.threadId === "string" ? p.threadId : null) || randomUUID();
        const model = typeof p.model === "string" ? p.model : undefined;
        if (model && !this.configuredModel) this.configuredModel = model;
        const cwd = typeof p.cwd === "string" ? p.cwd : undefined;
        if (cwd && !this.configuredCwd) this.configuredCwd = cwd;
        const permissionMode = typeof p.approvalPolicy === "string"
          ? p.approvalPolicy
          : "on-request";
        const session: AuggieSession = {
          threadId,
          model,
          permissionMode,
          cwd,
          createdAt: Date.now(),
          turns: [],
          messages: [],
          assistantTextByTurn: new Map(),
          streamedAssistantByTurn: new Map(),
          openTextByTurn: new Map(),
          textSegByTurn: new Map(),
          conversation: [],
          toolCallsByAcpId: new Map(),
          restoreCollector: null,
        };
        this.sessions.set(threadId, session);

        // Open the auggie session now (mirrors codeCliBridge emitting
        // thread/started after creating the session record). Auggie's
        // session/new is a request we await; failures roll back the session.
        try {
          const newResult = await this.sendRequest(buildAuggieSessionNew(cwd ?? process.cwd()));
          const newRecord = jsonRecord(newResult as JsonValue);
          const sessionId = typeof newRecord.sessionId === "string" ? newRecord.sessionId : undefined;
          if (sessionId) {
            session.externalSessionId = sessionId;
            this.sessionIdToThread.set(sessionId, threadId);
          }
        } catch (error) {
          this.sessions.delete(threadId);
          throw error;
        }

        this.emit("message", {
          method: "thread/started",
          params: { thread: { id: threadId, model, cliBackend: "auggie", status: { type: "idle" }, cwd } },
        } as JsonRpcMessage);
        return { thread: { id: threadId, model, cliBackend: "auggie", status: { type: "idle" } } } as JsonValue;
      }

      case "turn/start":
      case "turn/steer": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        console.error(`[auggie-bridge] ${method} thread=${threadId} sessions=${this.sessions.size} child=${this.child ? "running" : "none"}`);
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
        if (method === "turn/start" && session.activeTurnId) {
          throw new Error(`Turn is already active: ${session.activeTurnId}`);
        }

        // Extract user text + validated image blocks. We accept the Codex
        // composer shape (`prompt`/`input`/`text`); images pass through to
        // auggie's native image support (audit §3) and hard-limit violations
        // reject the turn with a clear error instead of dropping content.
        const turnInput = extractAuggieTurnInput(p);
        for (const warning of turnInput.warnings) this.emit("stderr", warning + "\n");
        if (turnInput.errors.length > 0) {
          throw new Error("auggie rejected the message: " + turnInput.errors.join("; "));
        }
        const userContent = turnInput.text;

        // Model switch requested on this turn — `session/set_model` only
        // takes effect on the NEXT prompt, so push it before firing ours.
        const requestedModel = typeof p.model === "string" ? p.model : this.configuredModel;
        if (requestedModel && requestedModel !== session.model) {
          await this.setSessionModel(session, requestedModel);
        }

        if (method === "turn/start") {
          session.turns.push({ id: turnId!, status: "running", createdAt: Date.now() });
          session.activeTurnId = turnId;
          session.turnStartedAtMs = Date.now();
          session.lastActivityMs = Date.now();
          session.assistantTextByTurn.set(turnId!, []);
          session.streamedAssistantByTurn.set(turnId!, new Map());
          this.emit("message", {
            method: "turn/started",
            params: { threadId, turn: { id: turnId, threadId, status: "running" } },
          } as JsonRpcMessage);
        }

        // Echo the user message item (matches codeCliBridge line 1044).
        if (userContent) {
          const userItem: Record<string, JsonValue> = {
            type: "userMessage",
            id: method === "turn/start" ? `auggie-user-${turnId}` : `auggie-user-${turnId}-${randomUUID()}`,
            turnId: turnId!,
            threadId,
            content: [{ type: "text", text: userContent, text_elements: [] }],
            role: "user",
            status: "completed",
            startedAt: Math.floor(Date.now() / 1000),
          };
          session.messages.push(userItem as JsonValue);
          session.conversation.push({ role: "user", text: userContent });
          this.emit("message", {
            method: "item/completed",
            params: { threadId, turnId, item: userItem },
          } as JsonRpcMessage);
        }

        // Fire the prompt but DO NOT await the auggie result inline — the
        // turn runs asynchronously and terminal events are emitted as
        // notifications (mirrors codeCliBridge line 1063-1065). The result
        // arrives later on stdout and is handled in `handleAuggiePromptResult`.
        const sessionId = session.externalSessionId;
        if (!sessionId) {
          // Defensive: session/new should have populated it.
          throw new Error("auggie session has no externalSessionId");
        }
        const promptBlocks = buildAuggiePromptBlocks(userContent, turnInput.images);
        console.error(`[auggie-bridge] session/prompt firing session=${sessionId} blocks=${promptBlocks.length}`);
        if (promptBlocks.length > 0) {
          // A full agent loop can run several minutes; the 60s default would
          // fail healthy long turns. The silence watchdog still bounds stalls.
          void this.sendRequest({ method: AUGGIE_METHOD.sessionPrompt, params: { sessionId, prompt: promptBlocks } }, 600_000)
            .then((result) => this.handleAuggiePromptResult(threadId, turnId!, result as JsonValue))
            .catch((error) => this.handleAuggiePromptError(threadId, turnId!, error));
        }

        return { turn: { id: turnId!, threadId, status: "running" } } as JsonValue;
      }

      case "turn/steer/end":
      case "thread/steer": {
        // Steer is a follow-up prompt on the active turn. Auggie has no
        // native steer concept (§3.3); we re-use the active turn id and send
        // another `session/prompt`.
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        if (!session) throw new Error("Unknown thread: " + threadId);
        const activeTurnId = session.activeTurnId;
        const sessionId = session.externalSessionId;
        if (!activeTurnId || !sessionId) {
          return {} as JsonValue;
        }
        const steerInput = extractAuggieTurnInput(p);
        for (const warning of steerInput.warnings) this.emit("stderr", warning + "\n");
        if (steerInput.errors.length > 0) {
          throw new Error("auggie rejected the message: " + steerInput.errors.join("; "));
        }
        const steerBlocks = buildAuggiePromptBlocks(steerInput.text, steerInput.images);
        if (steerBlocks.length > 0) {
          void this.sendRequest({ method: AUGGIE_METHOD.sessionPrompt, params: { sessionId, prompt: steerBlocks } }, 600_000)
            .then((result) => this.handleAuggiePromptResult(threadId, activeTurnId, result as JsonValue))
            .catch((error) => this.handleAuggiePromptError(threadId, activeTurnId, error));
        }
        return {} as JsonValue;
      }

      case "turn/interrupt": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        const sessionId = session?.externalSessionId;
        if (this.child && sessionId) {
          this.writeStdin(buildAuggieInterrupt(sessionId));
        }
        if (session && session.activeTurnId) {
          const activeTurnId = session.activeTurnId;
          // Flush any streamed assistant text so the turn still appears in
          // thread/read (mirrors codeCliBridge line 1102).
          this.flushStreamedAssistant(session, threadId, activeTurnId);
          this.emitTurnUsageNotification(session, threadId, activeTurnId);
          session.activeTurnId = undefined;
          const turn = session.turns.find((t) => t.id === activeTurnId);
          if (turn) turn.status = "interrupted";
          this.emit("message", {
            method: "turn/interrupted",
            params: {
              threadId,
              turnId: activeTurnId,
              turn: { id: activeTurnId, threadId, status: "interrupted", completedAt: Math.floor(Date.now() / 1000) },
            },
          } as JsonRpcMessage);
        }
        return {} as JsonValue;
      }

      case "thread/read":
      case "thread/resume": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        let session: AuggieSession | null | undefined = this.sessions.get(threadId);
        if (!session && method === "thread/resume") {
          // Bridge (or child) restarted since this thread was open — recover
          // from auggie's local session store instead of failing (rollout
          // todolist C7; audit §8: list+load are pure local reads).
          session = await this.restoreAuggieThreadFromDisk(threadId, p);
        }
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
            cliBackend: "auggie",
            status: { type: "idle" },
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
          cliBackend: "auggie",
          status: { type: "idle" },
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
        return { turns: session ? session.turns : [] } as JsonValue;
      }

      case "thread/items/list": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        return { items: session ? session.messages : [] } as JsonValue;
      }

      case "thread/fork":
        throw new Error("Auggie backend does not support thread/fork");

      case "thread/archive":
      case "thread/delete":
      case "thread/unsubscribe":
      case "thread/closed": {
        const closeThreadId = typeof p.threadId === "string" ? p.threadId : "";
        if (closeThreadId) {
          this.sessions.delete(closeThreadId);
          for (const [sid, tid] of this.sessionIdToThread) {
            if (tid === closeThreadId) this.sessionIdToThread.delete(sid);
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
        const session = this.sessions.get(threadId);
        if (session) session.preview = name;
        return { threadId, name } as JsonValue;
      }

      case "thread/goal/set": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        return { threadId, status: "active" } as JsonValue;
      }
      case "thread/goal/get": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        return { threadId, status: null } as JsonValue;
      }
      case "thread/goal/clear":
        return {} as JsonValue;

      case "thread/inject_items": {
        const threadId = typeof p.threadId === "string" ? p.threadId : "";
        const session = this.sessions.get(threadId);
        if (session && Array.isArray(p.items)) {
          for (const item of p.items) session.messages.push(item as JsonValue);
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
        throw new Error("Codex config writes are not supported in auggie backend mode");

      // §3.2 advanced methods not in the minimal surface — no-op / synthesize
      // in-memory, matching codeCliBridge's DEGRADATION bar.
      case "thread/compact/start":
        // Auggie has no compaction API; no-op so the UI doesn't error.
        return {} as JsonValue;

      // Approval RPCs inbound from the server when it broadcasts the request
      // back to us — return empty so the routing layer doesn't see an error.
      case "item/permissions/requestApproval":
      case "item/commandExecution/requestApproval":
      case "item/tool/requestUserInput":
        return {} as JsonValue;

      default:
        return {} as JsonValue;
    }
  }

  /**
   * Silence-window turn finalization. See the call site in the
   * agent_message_chunk handler for why this exists.
   */
  private static readonly TURN_SILENCE_FINALIZE_MS = 10_000;
  /**
   * Backstop: an active turn with zero inbound activity for this long is
   * declared stalled (typically an approval the UI never showed) instead of
   * hanging forever. Fails loudly so the user sees the cause.
   */
  private static readonly TURN_STALL_FAIL_MS = 5 * 60_000;

  private armTurnSilenceTimer(session: AuggieSession, threadId: string, turnId: string): void {
    this.clearTurnSilenceTimer(session);
    session.turnSilenceTimer = setTimeout(() => {
      session.turnSilenceTimer = undefined;
      if (session.activeTurnId !== turnId) return;
      // Never synthesize completion while tools are still running: keep
      // waiting (re-arm) instead of finalizing a live turn — unless nothing
      // has arrived for minutes, which means the CLI is blocked on something
      // invisible (e.g. an unanswered approval): fail with the cause.
      if (auggieTurnHasUnsettledTools(session, turnId)) {
        const silentMs = Date.now() - (session.lastActivityMs ?? Date.now());
        if (silentMs > AuggieAgentBridge.TURN_STALL_FAIL_MS) {
          this.cancelThreadPermissions(threadId);
          this.handleAuggiePromptError(
            threadId,
            turnId,
            new Error(
              "auggie turn stalled with tools still running and no activity for 5 minutes " +
              "(a permission request may be waiting for an approval dialog that was never shown)",
            ),
          );
          return;
        }
        this.armTurnSilenceTimer(session, threadId, turnId);
        return;
      }
      this.handleAuggiePromptResult(threadId, turnId, {} as JsonValue);
    }, AuggieAgentBridge.TURN_SILENCE_FINALIZE_MS);
  }

  private clearTurnSilenceTimer(session: AuggieSession): void {
    if (session.turnSilenceTimer !== undefined) {
      clearTimeout(session.turnSilenceTimer);
      session.turnSilenceTimer = undefined;
    }
  }

  /** Cancel every pending approval of a thread so a failed turn cannot leave
   *  the CLI parked on an invisible permission request. */
  private cancelThreadPermissions(threadId: string): void {
    for (const [routedId, pending] of this.pendingPermissions) {
      if (pending.threadId !== threadId) continue;
      this.pendingPermissions.delete(routedId);
      try {
        this.writeStdin(buildAuggiePermissionResult(pending.acpId, { outcome: "cancelled" }));
      } catch { /* best effort */ }
    }
  }

  /**
   * Handle the `session/prompt` result frame (the turn's terminal event).
   * Auggie does not give us a structured "is_error" — `result` is the
   * completion frame. We synthesize `turn/completed` (or `turn/failed` on
   * error envelope — but error envelopes route through sendRequest reject,
   * see handleAuggiePromptError).
   */
  private handleAuggiePromptResult(threadId: string, turnId: string, _result: JsonValue): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    if (session.activeTurnId !== turnId) return;
    this.clearTurnSilenceTimer(session);
    this.flushStreamedAssistant(session, threadId, turnId);
    session.activeTurnId = undefined;
    const turn = session.turns.find((t) => t.id === turnId);
    if (turn) turn.status = "completed";
    // Emit usage BEFORE the terminal event so downstream consumers see the
    // counts attached to a still-open turn (mirrors codex ordering).
    this.emitTurnUsageNotification(session, threadId, turnId);
    this.emit("message", {
      method: "turn/completed",
      params: {
        threadId,
        turnId,
        turn: { id: turnId, threadId, status: "completed", completedAt: Math.floor(Date.now() / 1000) },
      },
    } as JsonRpcMessage);
  }

  private handleAuggiePromptError(threadId: string, turnId: string, error: unknown): void {
    const message = stringifyError(error);
    try {
      this.eventLogger().append({ kind: "turn-failed", threadId, turnId, error: message.slice(0, 500) });
    } catch { /* ignore */ }
    const session = this.sessions.get(threadId);
    if (!session) return;
    if (session.activeTurnId === turnId) {
      this.flushStreamedAssistant(session, threadId, turnId);
      this.emitTurnUsageNotification(session, threadId, turnId);
      session.activeTurnId = undefined;
    }
    const turn = session.turns.find((t) => t.id === turnId);
    if (turn) turn.status = "failed";
    this.emit("message", {
      method: "turn/failed",
      params: {
        threadId,
        turnId,
        turn: { id: turnId, threadId, status: "failed" },
        error: message,
      },
    } as JsonRpcMessage);
  }

  /**
   * Flush accumulated streaming deltas into a single `item/completed`
   * agentMessage per stream id — mirrors codeCliBridge.flushStreamedAssistantItems.
   */
  private flushStreamedAssistant(session: AuggieSession, threadId: string, activeTurnId: string): void {
    session.openTextByTurn.delete(activeTurnId);
    const streamMap = session.streamedAssistantByTurn.get(activeTurnId);
    if (streamMap) {
      for (const [itemId, text] of streamMap) {
        if (!text) continue;
        const item: Record<string, JsonValue> = {
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
        // Upsert (not push): the live item/started already holds this row's
        // position among the turn's tool cards; pushing would sink the text
        // below every tool on history reload.
        upsertSessionItem(session, item);
        const normalized = normalizeAssistantText(text);
        const previous = session.conversation.at(-1);
        if (normalized && !(previous?.role === "assistant" && normalizeAssistantText(previous.text) === normalized)) {
          session.conversation.push({ role: "assistant", text: normalized });
        }
        const blocks = session.assistantTextByTurn.get(activeTurnId) ?? [];
        if (!blocks.includes(text)) blocks.push(text);
        session.assistantTextByTurn.set(activeTurnId, blocks);
      }
      session.streamedAssistantByTurn.delete(activeTurnId);
    }
  }

  /**
   * Drain the redirector's upstream-usage ledger for this turn's window and
   * re-emit it as `thread/tokenUsage/requestUpdated` — the same notification
   * codex turns produce, so index.ts's recordRequestUsageNotification prices
   * and persists auggie usage through the existing requestUsageStore path with
   * no downstream changes.
   *
   * Defensive by contract: when the upstream stream carried no usable usage
   * chunk (auggie's ACP surface never sends one and the redirector may not see
   * one either) nothing is emitted — no invented numbers. Records are removed
   * from the ledger as they are claimed so concurrent finalizations can never
   * double-count the same request.
   */
  private emitTurnUsageNotification(session: AuggieSession, threadId: string, turnId: string): void {
    const since = session.turnStartedAtMs ?? 0;
    session.turnStartedAtMs = undefined;
    let records;
    try {
      records = takeAuggieUpstreamUsage(since);
    } catch {
      return;
    }
    if (records.length === 0) return;
    const aggregate = aggregateAuggieUsageRecords(records);
    if (!aggregate) return;
    const usage: Record<string, JsonValue> = {
      prompt_tokens: aggregate.promptTokens,
      completion_tokens: aggregate.completionTokens,
      total_tokens: aggregate.totalTokens,
      // OpenAI snake_case keeps normalizeTokenUsage's source detection on the
      // "openai" branch, matching our OpenAI-compatible upstream.
      ...(aggregate.cachedInputTokens !== undefined
        ? { prompt_tokens_details: { cached_tokens: aggregate.cachedInputTokens } }
        : {}),
      ...(aggregate.reasoningOutputTokens !== undefined
        ? { completion_tokens_details: { reasoning_tokens: aggregate.reasoningOutputTokens } }
        : {}),
    };
    this.emit("message", {
      method: "thread/tokenUsage/requestUpdated",
      params: {
        threadId,
        turnId,
        // One stable id per aggregated window: the usage store upserts by
        // requestId, so a duplicate emission collapses instead of doubling.
        requestId: `auggie-turn-${turnId}`,
        usage,
      },
    } as JsonRpcMessage);
  }

  private invalidateChild(child: ChildProcessWithoutNullStreams, message: string): void {
    if (this.child !== child) return;
    for (const pending of this.pendingRequests.values()) pending.reject(new Error(message));
    this.pendingRequests.clear();
    this.pendingPermissions.clear();
    for (const [threadId, session] of this.sessions) {
      const activeTurnId = session.activeTurnId;
      if (activeTurnId) {
        session.activeTurnId = undefined;
        const turn = session.turns.find((t) => t.id === activeTurnId);
        if (turn) turn.status = "failed";
        this.emitTurnUsageNotification(session, threadId, activeTurnId);
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
    this.child = null;
    if (this.status.phase !== "stopped") {
      this.setStatus({ ...this.status, phase: "error", message });
    }
  }
}

type AuggieTurnInput = {
  text: string;
  /** Validated image blocks to pass through with the text blocks. */
  images: AuggiePromptBlock[];
  warnings: string[];
  /** Hard limit violations — the turn is rejected instead of dropping input. */
  errors: string[];
};

/**
 * Extract user content from a Codex `turn/start` params record. Mirrors
 * codeCliBridge's `extractTurnInput`; image blocks are validated against
 * auggie's documented limits (audit §3: jpeg/png/gif/webp, mimeType required,
 * ≤10 per message, ≤5MB base64 per image AND per message total) and passed
 * through natively — auggie declares `promptCapabilities.image: true`.
 */
export function extractAuggieTurnInput(p: Record<string, JsonValue>): AuggieTurnInput {
  const warnings: string[] = [];
  const errors: string[] = [];
  const images: AuggiePromptBlock[] = [];
  let text = "";
  // The workbench composer sends `input` as a content-block array (same shape
  // as `prompt`); accept both names in both shapes.
  const promptBlocks = Array.isArray(p.prompt)
    ? p.prompt
    : Array.isArray(p.input)
      ? p.input
      : null;
  if (typeof p.prompt === "string") {
    text = p.prompt;
  } else if (typeof p.input === "string") {
    text = p.input;
  } else if (typeof p.text === "string") {
    text = p.text;
  } else if (promptBlocks) {
    // Codex composer shape: [{type:"text",text}, {type:"image",...}, ...]
    const parts: string[] = [];
    for (const block of promptBlocks) {
      const b = block && typeof block === "object" && !Array.isArray(block)
        ? block as Record<string, JsonValue>
        : undefined;
      if (!b) continue;
      if (b.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      } else if (b.type === "image") {
        const image = coerceAuggieImageBlock(b, errors);
        if (image) images.push(image);
      } else {
        warnings.push(`Unsupported prompt block type '${String(b.type)}' ignored for auggie.`);
      }
    }
    text = parts.join("\n");
  } else if (p.prompt && typeof p.prompt === "object") {
    const b = p.prompt as Record<string, JsonValue>;
    if (b.type === "text" && typeof b.text === "string") text = b.text;
  }

  if (images.length > AUGGIE_MAX_IMAGES_PER_MESSAGE) {
    errors.push(
      `auggie accepts at most ${AUGGIE_MAX_IMAGES_PER_MESSAGE} images per message (got ${images.length})`,
    );
  }
  const totalBase64Chars = images.reduce((sum, image) => sum + (image.type === "image" ? image.data.length : 0), 0);
  if (totalBase64Chars > AUGGIE_MAX_IMAGE_BASE64_CHARS) {
    errors.push(
      `auggie accepts at most ${Math.floor(AUGGIE_MAX_IMAGE_BASE64_CHARS / (1024 * 1024))}MB of base64 image data per message (got ${totalBase64Chars} chars)`,
    );
  }
  return { text, images, warnings, errors };
}

/** Validate one composer image block against auggie's native image limits. */
function coerceAuggieImageBlock(b: Record<string, JsonValue>, errors: string[]): AuggiePromptBlock | null {
  let mimeType = typeof b.mimeType === "string"
    ? b.mimeType
    : typeof b.mediaType === "string" ? b.mediaType : undefined;
  let data = typeof b.data === "string"
    ? b.data
    : typeof b.base64 === "string" ? b.base64 : undefined;
  if ((!data || !mimeType) && typeof b.url === "string") {
    // data URI shape: data:image/png;base64,<payload>
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(b.url);
    if (match) {
      mimeType = mimeType ?? match[1];
      data = data ?? match[2];
    }
  }
  if (!mimeType) {
    errors.push("image attachment is missing its required mimeType");
    return null;
  }
  if (!AUGGIE_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    errors.push(`unsupported image mimeType '${mimeType}' (auggie supports jpeg/png/gif/webp)`);
    return null;
  }
  if (!data || data.length === 0) {
    errors.push("image attachment carries no base64 data");
    return null;
  }
  if (data.length > AUGGIE_MAX_IMAGE_BASE64_CHARS) {
    errors.push(
      `image exceeds auggie's ${Math.floor(AUGGIE_MAX_IMAGE_BASE64_CHARS / (1024 * 1024))}MB base64 limit (${data.length} chars)`,
    );
    return null;
  }
  return { type: "image", data, mimeType };
}

/** Compose the auggie `session/prompt` content-block array from a turn input. */
export function buildAuggiePromptBlocks(text: string, images: readonly AuggiePromptBlock[]): AuggiePromptBlock[] {
  const blocks: AuggiePromptBlock[] = [];
  if (text.length > 0) blocks.push({ type: "text", text });
  for (const image of images) blocks.push(image);
  return blocks;
}

/** Map an auggie tool_call status onto the Codex item status vocabulary. */
function mapAuggieToolStatus(status: unknown): "inProgress" | "completed" | "failed" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "inProgress";
}

/**
 * Pull human-readable result text out of a `tool_call_update` payload — the
 * final subagent update carries truncated result text either as content
 * blocks or raw output.
 */
function extractAuggieResultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => extractAuggieResultText(entry)).filter((part) => part.length > 0).join("\n");
  }
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.output === "string") return record.output;
  if (record.content !== undefined) return extractAuggieResultText(record.content);
  return "";
}

/**
 * Subagent discriminator, verified against the installed CLI: regular tool
 * frames always carry `rawInput` (possibly `{}`); subagent frames
 * (`onSubAgentCreated`) carry `kind: "other"` and NO `rawInput`, with title
 * "<agent name>: <instruction...>".
 */
export function isAuggieSubagentUpdate(update: Record<string, unknown>): boolean {
  const kind = typeof update.kind === "string" ? update.kind.toLowerCase() : "";
  if (kind !== "other") return false;
  return update.rawInput === undefined || update.rawInput === null;
}

/** Split a subagent title "<agent>: <instruction>" into its parts. */
function splitAuggieSubagentTitle(title: string): { agent: string; instruction: string } {
  const sep = title.indexOf(":");
  if (sep <= 0) return { agent: title.trim() || "subagent", instruction: "" };
  return {
    agent: title.slice(0, sep).trim() || "subagent",
    instruction: title.slice(sep + 1).trim(),
  };
}

/**
 * Build a `collabAgentToolCall` item for a subagent call so the waterfall
 * renders ManageTask and the agent rail / audit converge it (same contract
 * as grok's task projection).
 */
export function buildAuggieCollabItem(
  threadId: string,
  turnId: string | undefined,
  toolCallId: string,
  title: string,
  update: Record<string, unknown>,
  existing?: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const split = splitAuggieSubagentTitle(title);
  const agent = split.agent
    || (typeof existing?.agentName === "string" ? existing.agentName : "")
    || (typeof existing?.agentRole === "string" ? existing.agentRole : "")
    || "subagent";
  const prompt = split.instruction
    || (typeof existing?.prompt === "string" ? existing.prompt : "");
  return {
    type: "collabAgentToolCall",
    id: toolCallId,
    ...(turnId ? { turnId } : {}),
    threadId,
    name: title || agent,
    tool: "task",
    toolName: title || agent,
    agentId: toolCallId,
    agentName: agent,
    agentRole: agent,
    taskName: agent,
    ...(prompt ? { prompt, message: prompt } : {}),
    senderThreadId: threadId,
    receiverThreadIds: [],
    agentStatus: "running",
    status: "inProgress",
    ...(update.rawInput !== undefined && update.rawInput !== null
      ? { arguments: jsonRecord(update.rawInput as JsonValue) }
      : {}),
  };
}

type AuggieStoredSessionSummary = {
  sessionId: string;
  cwd?: string;
};

/**
 * Defensive parse of a `session/list` result — the payload is either
 * `{sessions:[...]}`, `{data:[...]}` or a bare array depending on version.
 */
function extractAuggieStoredSessions(result: JsonValue): AuggieStoredSessionSummary[] {
  const record = jsonRecord(result);
  const rawList: unknown[] = Array.isArray(result)
    ? result as unknown[]
    : Array.isArray(record.sessions)
      ? record.sessions as unknown[]
      : Array.isArray(record.data)
        ? record.data as unknown[]
        : [];
  const summaries: AuggieStoredSessionSummary[] = [];
  for (const entry of rawList) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const sessionId = typeof item.sessionId === "string"
      ? item.sessionId
      : typeof item.id === "string"
        ? item.id
        : typeof item.conversationId === "string" ? item.conversationId : undefined;
    if (!sessionId) continue;
    summaries.push({
      sessionId,
      ...(typeof item.cwd === "string" ? { cwd: item.cwd } : {}),
    });
  }
  return summaries;
}

/** Restore candidate matching order: explicit id → cwd → single stored session. */
function pickAuggieRestoreCandidate(
  candidates: readonly AuggieStoredSessionSummary[],
  requestedExternalId?: string,
  cwd?: string,
): AuggieStoredSessionSummary | null {
  if (requestedExternalId) {
    const byId = candidates.find((candidate) => candidate.sessionId === requestedExternalId);
    if (byId) return byId;
  }
  if (cwd) {
    const byCwd = candidates.find((candidate) => candidate.cwd === cwd);
    if (byCwd) return byCwd;
  }
  return candidates.length === 1 ? candidates[0] ?? null : null;
}
