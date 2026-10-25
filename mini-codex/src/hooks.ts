// Codex-parity hook runtime for mini-codex (MCP hook events).
//
// Reference (E:\projects\codex):
// - codex-rs/config/src/hook_config.rs      (HooksFile/HookEventsToml/MatcherGroup/
//   HookHandlerConfig::{command,mcp_tool,prompt,agent}, 12 events, MCP null rejection)
// - codex-rs/hooks/src/events/pre_tool_use.rs / post_tool_use.rs (matcher dispatch,
//   command stdin JSON, updated_input/additionalContext/block semantics)
// - codex-rs/hooks/src/mcp.rs               (HookMcpCall/HookMcpExecutor)
// - codex-rs/core/src/hook_runtime.rs       (HookStarted/HookCompleted emission)
// - codex-rs/core/src/tools/handlers/mcp.rs (mcp__<server>__<tool> naming,
//   PreToolUse tool_input = parsed JSON args,
//   PostToolUse tool_response = {content, structuredContent})
// - codex-rs/protocol/src/protocol.rs       (HookStartedEvent/HookCompletedEvent/
//   HookRunSummary/HandlerType/EventName/RunStatus)
//
// Scope: PreToolUse/PostToolUse around every tool call (MCP first-class).
// Other 10 events load but only emit via explicit helpers (no silent drop of config).
import { randomUUID as uuid } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type HookEventName =
  | "PreToolUse" | "PermissionRequest" | "PostToolUse" | "PreCompact"
  | "PostCompact" | "SessionStart" | "SessionEnd" | "UserPromptSubmit"
  | "SubagentStart" | "SubagentStop" | "Stop" | "Interrupt";

export const HOOK_EVENT_NAMES: HookEventName[] = [
  "PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact",
  "PostCompact", "SessionStart", "SessionEnd", "UserPromptSubmit",
  "SubagentStart", "SubagentStop", "Stop", "Interrupt",
];

export type HookHandlerType = "command" | "mcp_tool" | "prompt" | "agent";
export type HookRunStatus = "running" | "completed" | "failed" | "blocked" | "stopped";
export type HookSource = "user" | "project" | "unknown";

export interface HookOutputEntry { kind: "warning" | "stop" | "feedback" | "context" | "error"; text: string }

export interface HookRunSummary {
  id: string;
  event_name: HookEventName;
  handler_type: HookHandlerType;
  execution_mode: "sync";
  scope: "turn";
  source_path: string;
  source: HookSource;
  display_order: number;
  status: HookRunStatus;
  status_message: string | null;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  entries: HookOutputEntry[];
}

export interface HookStartedEvent { turn_id: string | null; run: HookRunSummary }
export interface HookCompletedEvent { turn_id: string | null; run: HookRunSummary }
export type HookEvent = { type: "hook_started"; event: HookStartedEvent } | { type: "hook_completed"; event: HookCompletedEvent };
export type HookEventSink = (e: HookEvent) => void;

export type HookHandlerConfig =
  | { type: "command"; command: string; commandWindows?: string; timeout?: number; statusMessage?: string }
  | { type: "mcp_tool"; server: string; tool: string; input: Record<string, unknown>; timeout?: number; statusMessage?: string }
  | { type: "prompt" }
  | { type: "agent" };

export interface MatcherGroup { matcher?: string; hooks: HookHandlerConfig[] }
export type HookEvents = Partial<Record<HookEventName, MatcherGroup[]>>;

interface LoadedHooks { events: HookEvents; sourcePath: string; source: HookSource }

interface HookCache {
  at: number; cwd: string; events: HookEvents;
  files: Array<{ path: string; source: HookSource }>;
  perFile: Array<{ path: string; source: HookSource; events: HookEvents }>;
}

let cache: HookCache | null = null;

function codexHome(): string {
  const h = (process.env.CODEX_HOME ?? "").trim();
  if (h) return h.startsWith("~") ? join(homedir(), h.slice(1)) : h;
  return join(homedir(), ".codex");
}

function normalizeEvents(raw: unknown): HookEvents {
  const out: HookEvents = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const rec = raw as Record<string, unknown>;
  // Accept both {hooks:{PreToolUse:[...]}} (hooks.json) and flat {PreToolUse:[...]}.
  const body = rec.hooks && typeof rec.hooks === "object" && !Array.isArray(rec.hooks)
    ? (rec.hooks as Record<string, unknown>) : rec;
  for (const name of HOOK_EVENT_NAMES) {
    const v = (body as Record<string, unknown>)[name];
    if (!Array.isArray(v)) continue;
    const groups: MatcherGroup[] = [];
    for (const g of v) {
      if (!g || typeof g !== "object" || Array.isArray(g)) continue;
      const gr = g as Record<string, unknown>;
      const hooks: HookHandlerConfig[] = [];
      if (Array.isArray(gr.hooks)) for (const h of gr.hooks) {
        const hc = normalizeHandler(h);
        if (hc) hooks.push(hc);
      }
      groups.push({
        ...(typeof gr.matcher === "string" ? { matcher: gr.matcher } : {}),
        hooks,
      });
    }
    out[name] = groups;
  }
  return out;
}

function normalizeHandler(h: unknown): HookHandlerConfig | null {
  if (!h || typeof h !== "object" || Array.isArray(h)) return null;
  const r = h as Record<string, unknown>;
  if (r.type === "command" && typeof r.command === "string") {
    // Codex parity: platform override wins on Windows (hook_config.rs command_windows).
    const commandWindows = typeof r.commandWindows === "string" ? r.commandWindows
      : (typeof r.command_windows === "string" ? String(r.command_windows) : undefined);
    return {
      type: "command",
      command: r.command,
      ...(commandWindows ? { commandWindows } : {}),
      ...(typeof r.timeout === "number" ? { timeout: r.timeout } : {}),
      ...(typeof r.statusMessage === "string" ? { statusMessage: r.statusMessage } : {}),
    };
  }
  if (r.type === "mcp_tool" && typeof r.server === "string" && typeof r.tool === "string") {
    const input = (r.input && typeof r.input === "object" && !Array.isArray(r.input)
      ? (r.input as Record<string, unknown>) : {});
    // Codex parity: MCP hook input must be TOML-representable -> reject null anywhere.
    if (containsNull(input)) return null;
    return {
      type: "mcp_tool",
      server: r.server, tool: r.tool, input,
      ...(typeof r.timeout === "number" ? { timeout: r.timeout } : {}),
      ...(typeof r.statusMessage === "string" ? { statusMessage: r.statusMessage } : {}),
    };
  }
  if (r.type === "prompt") return { type: "prompt" };
  if (r.type === "agent") return { type: "agent" };
  return null;
}

function containsNull(v: unknown): boolean {
  if (v === null) return true;
  if (Array.isArray(v)) return v.some(containsNull);
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).some(containsNull);
  return false;
}

/** Canonicalize event names: PreToolUse/pre_tool_use/pretooluse all map. */
function canonicalEventName(k: string): HookEventName | null {
  const n = k.trim().toLowerCase().replace(/[_\-\s]/g, "");
  for (const name of HOOK_EVENT_NAMES) {
    if (name.toLowerCase().replace(/[_\-\s]/g, "") === n) return name;
  }
  return null;
}

function parseTomlScalar(text: string): unknown {
  const t = text.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    try { return JSON.parse(`"${t.slice(1, -1).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`); }
    catch { return t.slice(1, -1); }
  }
  if (/^-?\d+$/.test(t) || /^-?\d*\.\d+$/.test(t)) return Number(t);
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    const parts: string[] = [];
    let cur = "", depth = 0, quote: string | null = null;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]!;
      if (quote) { cur += ch; if (ch === quote && inner[i - 1] !== "\\") quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === "[" || ch === "{") depth++;
      if (ch === "]" || ch === "}") depth--;
      if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => parseTomlScalar(p.trim()));
  }
  if (t.startsWith("{") && t.endsWith("}")) {
    try {
      const obj: Record<string, unknown> = {};
      const inner = t.slice(1, -1).trim();
      if (!inner) return obj;
      for (const seg of inner.split(",")) {
        const eq = seg.indexOf("=");
        if (eq < 0) continue;
        obj[seg.slice(0, eq).trim().replace(/^["']|["']$/g, "")] = parseTomlScalar(seg.slice(eq + 1).trim());
      }
      return obj;
    } catch { return t; }
  }
  return t;
}

function ensurePath(root: Record<string, unknown>, path: string[], isArray: boolean): Record<string, unknown> {
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]!;
    let nxt = node[k] as unknown;
    if (!nxt || typeof nxt !== "object" || Array.isArray(nxt)) { nxt = {}; node[k] = nxt; }
    node = nxt as Record<string, unknown>;
  }
  const last = path[path.length - 1]!;
  if (isArray) {
    let arr = node[last] as unknown;
    if (!Array.isArray(arr)) { arr = []; node[last] = arr; }
    const el: Record<string, unknown> = {};
    (arr as unknown[]).push(el);
    return el;
  }
  let leaf = node[last] as unknown;
  if (!leaf || typeof leaf !== "object" || Array.isArray(leaf)) { leaf = {}; node[last] = leaf; }
  return leaf as Record<string, unknown>;
}

/** Minimal TOML subset for hooks: [table] / [[array]] + key = value. Never throws. */
function parseTomlHooks(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let cur: Record<string, unknown> = root;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split(/(^|[^\\])#/)[0]?.trim() ?? "";
    if (!line) continue;
    const arrHead = line.match(/^\[\[\s*([^\]]+?)\s*\]\]$/);
    const tblHead = line.match(/^\[\s*([^\]]+?)\s*\]$/);
    if (arrHead) {
      const path = arrHead[1]!.trim().split(".").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      if (!path.length) continue;
      cur = ensurePath(root, path, true);
      continue;
    }
    if (tblHead) {
      const path = tblHead[1]!.trim().split(".").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      if (!path.length) continue;
      cur = ensurePath(root, path, false);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^["']|["']$/g, "");
    if (!key || key.includes(".")) continue;
    try { cur[key] = parseTomlScalar(line.slice(eq + 1).trim()); } catch { /* skip bad value */ }
  }
  return root;
}

function normalizeEventsTolerant(raw: unknown): HookEvents {
  const ev = normalizeEvents(raw);
  if (Object.keys(ev).length) return ev;
  // Case-insensitive retry: remap keys like pre_tool_use / hooks.pre_tool_use.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ev;
  const rec = raw as Record<string, unknown>;
  const body = rec.hooks && typeof rec.hooks === "object" && !Array.isArray(rec.hooks)
    ? (rec.hooks as Record<string, unknown>) : rec;
  // Also unwrap single "hooks" TOML table nesting: {hooks:{PreToolUse:[...]}}
  const remapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const canon = canonicalEventName(k);
    if (canon) remapped[canon] = v;
  }
  if (!Object.keys(remapped).length) return ev;
  return normalizeEvents(remapped);
}

function parseHookFile(text: string, path: string): HookEvents {
  try {
    if (path.endsWith(".toml")) {
      const parsed = parseTomlHooks(text);
      // config.toml nests under [hooks.*]: unwrap one level if present.
      const maybeHooks = (parsed as Record<string, unknown>).hooks;
      const doc = maybeHooks && typeof maybeHooks === "object" && !Array.isArray(maybeHooks)
        ? { ...(parsed as Record<string, unknown>), ...(maybeHooks as Record<string, unknown>), hooks: maybeHooks }
        : parsed;
      return normalizeEventsTolerant(maybeHooks ?? doc);
    }
    const parsed = JSON.parse(text) as unknown;
    return normalizeEventsTolerant(parsed);
  } catch { return {}; }
}

/** Load hooks from all Codex-parity sources. Never throws.
 * Order: user config.toml [hooks.*] -> user hooks.toml/json ->
 * project .codex/hooks.toml/json. Missing/unreadable = no hooks. */
export async function loadHookEvents(cwd: string, force = false): Promise<HookEvents> {
  const now = Date.now();
  if (!force && cache && cache.cwd === cwd && now - cache.at < 30_000) return cache.events;
  const home = codexHome();
  const files: Array<{ path: string; source: HookSource }> = [
    { path: join(home, "config.toml"), source: "user" },
    { path: join(home, "hooks.toml"), source: "user" },
    { path: join(home, "hooks.json"), source: "user" },
    ...(cwd ? [
      { path: join(cwd, ".codex", "hooks.toml"), source: "project" as HookSource },
      { path: join(cwd, ".codex", "hooks.json"), source: "project" as HookSource },
    ] : []),
  ];
  const merged: HookEvents = {};
  const seen: Array<{ path: string; source: HookSource }> = [];
  const perFile: Array<{ path: string; source: HookSource; events: HookEvents }> = [];
  for (const f of files) {
    try {
      const text = await readFile(f.path, "utf8");
      const ev = parseHookFile(text, f.path);
      seen.push(f);
      perFile.push({ path: f.path, source: f.source, events: ev });
      for (const name of HOOK_EVENT_NAMES) {
        if (ev[name]?.length) (merged[name] ??= []).push(...ev[name]!);
      }
    } catch { /* missing/unreadable = no hooks, like Codex */ }
  }
  cache = { at: now, cwd, events: merged, files: seen, perFile };
  return merged;
}

export function hookFilesLoaded(): Array<{ path: string; source: HookSource }> {
  return cache?.files ?? [];
}

/** Codex matcher semantics: empty matcher matches all; else regex against tool_name. */
export function matcherMatches(matcher: string | undefined, toolName: string): boolean {
  if (!matcher || !matcher.trim()) return true;
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return toolName.includes(matcher);
  }
}

export function selectHookHandlers(events: HookEvents, eventName: HookEventName, toolName: string): Array<{ group: MatcherGroup; handler: HookHandlerConfig; index: number }> {
  const out: Array<{ group: MatcherGroup; handler: HookHandlerConfig; index: number }> = [];
  const groups = events[eventName] ?? [];
  let order = 0;
  for (const g of groups) {
    if (!matcherMatches(g.matcher, toolName)) { order += g.hooks.length; continue; }
    for (const h of g.hooks) out.push({ group: g, handler: h, index: order++ });
  }
  return out;
}

/** Codex mcp_hook_tool_input parity: tool_input is the resolved JSON args object. */
export function mcpHookToolInput(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) return args as Record<string, unknown>;
  if (typeof args === "string") {
    if (!args.trim()) return {};
    try {
      const p = JSON.parse(args) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
      return { _raw: args };
    } catch { return { _raw: args }; }
  }
  return {};
}

export interface HookTemplateCtx extends Record<string, unknown> {
  tool_name: string; tool_use_id: string; cwd: string;
  session_id: string; turn_id: string; server: string; tool: string;
  tool_input: Record<string, unknown>;
}

function lookupPath(ctx: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = ctx;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function expandTemplateString(s: string, ctx: Record<string, unknown>): string {
  return s.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const v = lookupPath(ctx, expr.trim());
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return v;
    try { return JSON.stringify(v) ?? ""; } catch { return String(v); }
  });
}

function renderValue(v: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof v === "string") return expandTemplateString(v, ctx);
  if (Array.isArray(v)) return v.map((x) => renderValue(x, ctx));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = renderValue(val, ctx);
    return out;
  }
  return v;
}

/** Render an mcp_tool handler input template (Codex: ${tool_input.*} etc.). Throws on null. */
export function renderMcpHookInput(input: Record<string, unknown>, ctx: HookTemplateCtx): Record<string, unknown> {
  const rendered = renderValue(input, ctx as unknown as Record<string, unknown>) as Record<string, unknown>;
  if (containsNull(rendered)) throw new Error("MCP hook input must be representable as TOML (null rejected, Codex parity)");
  return rendered;
}

function preToolUseStdin(c: { sessionId: string; turnId: string; cwd: string; model: string; toolName: string; toolInput: unknown; toolUseId: string }): string {
  return JSON.stringify({
    session_id: c.sessionId, turn_id: c.turnId, transcript_path: null, cwd: c.cwd,
    hook_event_name: "PreToolUse", model: c.model, permission_mode: "default",
    tool_name: c.toolName, tool_input: c.toolInput ?? {}, tool_use_id: c.toolUseId,
  });
}

function postToolUseStdin(c: { sessionId: string; turnId: string; cwd: string; model: string; toolName: string; toolInput: unknown; toolResponse: unknown; toolUseId: string }): string {
  return JSON.stringify({
    session_id: c.sessionId, turn_id: c.turnId, transcript_path: null, cwd: c.cwd,
    hook_event_name: "PostToolUse", model: c.model, permission_mode: "default",
    tool_name: c.toolName, tool_input: c.toolInput ?? {}, tool_response: c.toolResponse ?? {},
    tool_use_id: c.toolUseId,
  });
}

export interface ParsedHookOutput {
  blocked: boolean; blockReason?: string; updatedInput?: unknown;
  additionalContext?: string; systemMessage?: string; stop?: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Parse command-hook stdout JSON (Codex output_parser subset). Never throws. */
export function parseHookOutput(stdout: string, eventName: HookEventName): ParsedHookOutput {
  const t = (stdout ?? "").trim();
  if (!t) return { blocked: false };
  let p: unknown = null;
  try { p = JSON.parse(t) as unknown; }
  catch {
    // Non-JSON stdout = informational warning only (Codex keeps running).
    return { blocked: false, systemMessage: t.slice(0, 2000) };
  }
  const r = asRecord(p);
  if (!r) return { blocked: false };
  const out: ParsedHookOutput = { blocked: false };
  const decision = typeof r.decision === "string" ? r.decision.toLowerCase() : "";
  const cont = typeof r.continue === "boolean" ? r.continue : undefined;
  const reason = typeof r.reason === "string" && r.reason.trim() ? r.reason.trim() : undefined;
  const sysMsg = typeof r.systemMessage === "string" && r.systemMessage.trim()
    ? r.systemMessage.trim()
    : (typeof r.system_message === "string" && (r.system_message as string).trim()
      ? String(r.system_message).trim() : undefined);
  if (sysMsg) out.systemMessage = sysMsg.slice(0, 2000);
  if (decision === "block" || decision === "deny" || cont === false) {
    out.blocked = true;
    if (reason) out.blockReason = reason.slice(0, 2000);
  }
  const specific = asRecord(r.hookSpecificOutput) ?? asRecord(r.hook_specific_output);
  if (specific) {
    const add = typeof specific.additionalContext === "string" ? specific.additionalContext
      : (typeof specific.additional_context === "string" ? String(specific.additional_context) : undefined);
    if (add && add.trim()) out.additionalContext = add.trim().slice(0, 8000);
    const upd = (specific.updatedInput ?? specific.updated_input) as unknown;
    if (eventName === "PreToolUse" && upd !== undefined) out.updatedInput = upd;
  }
  // Legacy flat shape: {additionalContext, updatedInput} at top level.
  if (!out.additionalContext && typeof r.additionalContext === "string" && (r.additionalContext as string).trim()) {
    out.additionalContext = String(r.additionalContext).trim().slice(0, 8000);
  }
  if (eventName === "PreToolUse" && out.updatedInput === undefined && r.updatedInput !== undefined) {
    out.updatedInput = r.updatedInput as unknown;
  }
  return out;
}

function runShell(cmd: string, stdin: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    // NOTE (Windows): windowsVerbatimArguments disables Node's command-line
    // quoting/escaping so hook stdout keeps its double quotes intact
    // (cmd would otherwise receive \" and echo literal backslashes,
    // breaking JSON hook output). The command is the tail of the line,
    // so verbatim join is safe here.
    const child = spawn(isWin ? "cmd.exe" : "sh", isWin ? ["/d", "/s", "/c", cmd] : ["-c", cmd], {
      cwd: cwd || undefined, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      ...(isWin ? { windowsVerbatimArguments: true } : {}),
    });
    let stdout = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve({ stdout, exitCode: 124, timedOut: true });
    }, Math.max(500, Math.min(120_000, timeoutMs)));
    child.stdout?.on("data", (c) => { stdout += String(c); if (stdout.length > 64_000) stdout = stdout.slice(0, 64_000); });
    child.on("error", () => { if (!done) { done = true; clearTimeout(timer); resolve({ stdout, exitCode: 127, timedOut: false }); } });
    child.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ stdout, exitCode: code ?? 0, timedOut: false }); } });
    try {
      child.stdin?.write(stdin);
      child.stdin?.end();
    } catch { /* ignore */ }
  });
}

export interface HookExecCtx {
  sessionId: string; turnId: string; cwd: string; model: string;
  toolName: string; toolUseId: string; toolInput: Record<string, unknown>;
  toolResponse?: unknown;
  /** Raw MCP caller for mcp_tool handlers (bypasses hooks to avoid recursion). */
  callMcpRaw: (server: string, tool: string, input: Record<string, unknown>, timeoutMs: number) => Promise<string>;
  sink?: HookEventSink;
}

export interface HookExecResult {
  blocked: boolean; blockReason?: string; updatedInput?: Record<string, unknown>;
  additionalContexts: string[]; feedback?: string;
  hookEvents: HookCompletedEvent[];
}

function emitStarted(sink: HookEventSink | undefined, run: HookRunSummary, turnId: string | null): void {
  try { sink?.({ type: "hook_started", event: { turn_id: turnId, run: { ...run } } }); } catch { /* ignore */ }
}

function emitCompleted(sink: HookEventSink | undefined, run: HookRunSummary, turnId: string | null): HookCompletedEvent {
  const ev: HookCompletedEvent = { turn_id: turnId, run: { ...run } };
  try { sink?.({ type: "hook_completed", event: ev }); } catch { /* ignore */ }
  return ev;
}

function baseRun(eventName: HookEventName, handler: HookHandlerConfig, index: number, sourcePath: string, source: HookSource, statusMessage?: string): HookRunSummary {
  const now = Date.now();
  return {
    id: uuid(), event_name: eventName,
    handler_type: handler.type, execution_mode: "sync", scope: "turn",
    source_path: sourcePath, source, display_order: index,
    status: "running", status_message: statusMessage ?? null,
    started_at: now, completed_at: null, duration_ms: null, entries: [],
  };
}

function finishRun(run: HookRunSummary, status: HookRunStatus, entries: HookOutputEntry[], statusMessage?: string): HookRunSummary {
  const done = Date.now();
  return {
    ...run, status, entries,
    status_message: statusMessage ?? run.status_message ?? null,
    completed_at: done, duration_ms: Math.max(0, done - run.started_at),
  };
}

/** Execute matched handlers for one event. Emits HookStarted/HookCompleted per handler (Codex parity). */
export async function executeHooks(
  events: HookEvents,
  files: Array<{ path: string; source: HookSource }>,
  eventName: HookEventName,
  ctx: HookExecCtx,
): Promise<HookExecResult> {
  // Attribute each handler to its origin file (user hooks.json first, then
  // project .codex/hooks.json), preserving Codex display_order semantics.
  const perFile = cache?.perFile ?? [];
  const matched: Array<{ group: MatcherGroup; handler: HookHandlerConfig; index: number; sourcePath: string; source: HookSource }> = [];
  if (perFile.length) {
    let order = 0;
    for (const f of perFile) {
      for (const g of f.events[eventName] ?? []) {
        const n = g.hooks.length;
        if (matcherMatches(g.matcher, ctx.toolName)) {
          for (const h of g.hooks) matched.push({ group: g, handler: h, index: order++, sourcePath: f.path, source: f.source });
        } else order += n;
      }
    }
  } else {
    for (const m of selectHookHandlers(events, eventName, ctx.toolName)) {
      matched.push({
        ...m,
        sourcePath: files[0]?.path ?? join(codexHome(), "hooks.json"),
        source: files[0]?.source ?? "unknown",
      });
    }
  }
  const res: HookExecResult = { blocked: false, additionalContexts: [], hookEvents: [] };
  if (!matched.length) return res;
  for (const m of matched) {
    const h = m.handler;
    const statusMsg = (h.type === "command" || h.type === "mcp_tool") ? (h.statusMessage ?? null) : null;
    let run = baseRun(eventName, h, m.index, m.sourcePath, m.source, statusMsg ?? undefined);
    emitStarted(ctx.sink, run, ctx.turnId);
    const started = Date.now();
    try {
      if (h.type === "command") {
        // Codex parity: commandWindows wins on win32 (hook_config.rs).
        const command = process.platform === "win32" && h.commandWindows ? h.commandWindows : h.command;
        const stdin = eventName === "PreToolUse"
          ? preToolUseStdin({ sessionId: ctx.sessionId, turnId: ctx.turnId, cwd: ctx.cwd, model: ctx.model, toolName: ctx.toolName, toolInput: ctx.toolInput, toolUseId: ctx.toolUseId })
          : postToolUseStdin({ sessionId: ctx.sessionId, turnId: ctx.turnId, cwd: ctx.cwd, model: ctx.model, toolName: ctx.toolName, toolInput: ctx.toolInput, toolResponse: ctx.toolResponse, toolUseId: ctx.toolUseId });
        const timeoutMs = Math.max(500, Math.min(120_000, Math.floor(((h.timeout ?? 30)) * 1000)));
        const r = await runShell(command, stdin, ctx.cwd, timeoutMs);
        if (r.timedOut) {
          run = finishRun(run, "failed", [{ kind: "error", text: `hook timed out after ${timeoutMs}ms` }]);
          res.hookEvents.push(emitCompleted(ctx.sink, run, ctx.turnId));
          continue;
        }
        if (r.exitCode !== 0 && !r.stdout.trim()) {
          run = finishRun(run, "failed", [{ kind: "error", text: `hook exited with code ${r.exitCode}` }]);
          res.hookEvents.push(emitCompleted(ctx.sink, run, ctx.turnId));
          continue;
        }
        const parsed = parseHookOutput(r.stdout, eventName);
        const entries: HookOutputEntry[] = [];
        if (parsed.systemMessage) entries.push({ kind: "warning", text: parsed.systemMessage });
        if (parsed.additionalContext) {
          entries.push({ kind: "context", text: parsed.additionalContext.slice(0, 500) });
          res.additionalContexts.push(parsed.additionalContext);
        }
        if (parsed.blocked) {
          entries.push({ kind: "feedback", text: parsed.blockReason ?? `${eventName} hook blocked ${ctx.toolName}` });
          run = finishRun(run, "blocked", entries, parsed.blockReason ?? "blocked by hook");
          res.hookEvents.push(emitCompleted(ctx.sink, run, ctx.turnId));
          res.blocked = true;
          res.blockReason = parsed.blockReason ?? `Blocked by ${eventName} hook (${ctx.toolName}).`;
          if (eventName === "PostToolUse" && parsed.blockReason) res.feedback = parsed.blockReason;
          // Keep running remaining hooks for full event parity (Codex runs all matched).
          continue;
        }
        if (eventName === "PreToolUse" && parsed.updatedInput !== undefined) {
          const upd = asRecord(parsed.updatedInput);
          if (upd) {
            res.updatedInput = upd;
            entries.push({ kind: "feedback", text: "hook rewrote tool input" });
          } else {
            entries.push({ kind: "error", text: "hook updatedInput must be an object; ignored" });
          }
        }
        if (r.exitCode !== 0) {
          run = finishRun(run, "failed", [...entries, { kind: "error", text: `hook exited with code ${r.exitCode}` }]);
        } else {
          run = finishRun(run, "completed", entries);
        }
        res.hookEvents.push(emitCompleted(ctx.sink, run, ctx.turnId));
      } else if (h.type === "mcp_tool") {
        const timeoutMs = Math.max(500, Math.min(300_000, Math.floor(((h.timeout ?? 60)) * 1000)));
        let rendered: Record<string, unknown>;
        try {
          rendered = renderMcpHookInput(h.input, {
            tool_name: ctx.toolName, tool_use_id: ctx.toolUseId, cwd: ctx.cwd,
            session_id: ctx.sessionId, turn_id: ctx.turnId,
            server: h.server, tool: h.tool, tool_input: ctx.toolInput,
          });
        } catch (e) {
          run = finishRun(run, "failed", [{ kind: "error", text: e instanceof Error ? e.message : String(e) }]);
          res.hookEvents.push(emitCompleted(ctx.sink, run, ctx.turnId));
          continue;
        }
        try {
          const text = await ctx.callMcpRaw(h.server, h.tool, rendered, timeoutMs);
          // MCP hook output uses command-hook semantics: parse JSON decisions from text.
          const parsed = parseHookOutput(text, eventName);
          const entries: HookOutputEntry[] = [];
          if (parsed.systemMessage) entries.push({ kind: "warning", text: parsed.systemMessage });
          if (parsed.additionalContext) {
            entries.push({ kind: "context", text: parsed.additionalContext.slice(0, 500) });
            res.additionalContexts.push(parsed.additionalContext);
          } else if (text.trim() && text.trim() !== "(empty MCP result)") {
            // Non-decision MCP output still counts as hook output (context, truncated).
            entries.push({ kind: "context", text: text.slice(0, 500) });
          }
          if (parsed.blocked) {
            entries.push({ kind: "feedback", text: parsed.blockReason ?? `${eventName} MCP hook blocked ${ctx.toolName}` });
            run = finishRun(run, "blocked", entries, parsed.blockReason ?? "blocked by MCP hook");
            res.hookEvents.push(emitCompleted(ctx.sink, run, ctx.turnId));
            res.blocked = true;
            res.blockReason = parsed.blockReason ?? `Blocked by ${eventName} MCP hook (${h.server}/${h.tool}).`;
            continue;
          }
          if (eventName === "PreToolUse" && parsed.updatedInput !== undefined) {
            const upd = asRecord(parsed.updatedInput);
            if (upd) res.updatedInput = upd;
          }
          run = finishRun(run, "completed", entries);
          res.hookEvents.push(emitCompleted(ctx.sink, run, ctx.turnId));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          run = finishRun(run, "failed", [{ kind: "error", text: msg.slice(0, 2000) }]);
          res.hookEvents.push(emitCompleted(ctx.sink, run, ctx.turnId));
        }
        void started;
      } else {
        // prompt/agent handlers: parsed as Codex internal only; mini cannot run them.
        run = finishRun(run, "failed", [{ kind: "error", text: `hook type '${h.type}' is not supported by mini-codex (Codex parity: needs app-server); ignoring` }]);
        res.hookEvents.push(emitCompleted(ctx.sink, run, ctx.turnId));
      }
    } catch (e) {
      run = finishRun(run, "failed", [{ kind: "error", text: (e instanceof Error ? e.message : String(e)).slice(0, 2000) }]);
      res.hookEvents.push(emitCompleted(ctx.sink, run, ctx.turnId));
    }
  }
  return res;
}

export function defaultHookSink(): HookEventSink {
  return (e) => {
    try {
      const run = e.event.run;
      const id = run.id.slice(0, 8);
      if (e.type === "hook_started") {
        process.stderr.write(`[hook:${run.event_name}:${run.handler_type}:${id}] start ${run.source_path} order=${run.display_order}\n`);
      } else {
        process.stderr.write(`[hook:${run.event_name}:${run.handler_type}:${id}] ${run.status} ${run.duration_ms ?? 0}ms` +
          (run.status_message ? ` ${run.status_message.slice(0, 200)}` : "") + "\n");
      }
    } catch { /* ignore */ }
  };
}

export function describeHooks(events: HookEvents): string {
  const parts: string[] = [];
  for (const n of ["PreToolUse", "PostToolUse"] as HookEventName[]) {
    const g = events[n] ?? [];
    const c = g.reduce((a, x) => a + x.hooks.length, 0);
    if (c) parts.push(`${n}:${c}`);
  }
  return parts.length ? parts.join(" ") : "none";
}
