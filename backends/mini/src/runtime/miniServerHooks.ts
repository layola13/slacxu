// Server-side MCP hook wrapper for miniBridge (Pre/PostToolUse + auto-remember).
// mini-codex has full hook runtime; server miniBridge called runMiniMcpTool
// directly, so MCP hooks never fired. This module provides a lightweight
// server-side equivalent: Pre/PostToolUse notification hooks + keyword
// auto-remember triage. Hook observer failures never break tool calls;
// tool errors still propagate to the caller's normal handling.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { resolveGlobalMemoryFilePath, resolveWorkspaceMemoryFilePath } from "@cxu/sdk-backend";
import { runMiniMcpTool } from "./miniMcp.js";

export interface MiniServerHookContext {
  threadId?: string;
  turnId?: string;
  cwd?: string;
  toolName: string;
}

type HookHandler = (event: string, payload: Record<string, unknown>) => Promise<void> | void;

const serverHookHandlers = new Set<HookHandler>();

/** Register a server-side hook observer (e.g. for tests or diagnostics). */
export function onMiniServerHook(handler: HookHandler): () => void {
  serverHookHandlers.add(handler);
  return () => { serverHookHandlers.delete(handler); };
}

async function fireServerHook(event: string, payload: Record<string, unknown>): Promise<void> {
  if (serverHookHandlers.size === 0) return;
  await Promise.allSettled(
    [...serverHookHandlers].map((h) => {
      try { return h(event, payload); } catch { return undefined; }
    }),
  );
}

/** Cheap local triage: same keyword set as mini-codex shouldRememberToolResult. */
export function shouldAutoRememberServerToolResult(toolName: string, output: string): string | null {
  const t = (output ?? "").trim();
  if (!t || t.length < 24 || /tool error:|Blocked by .* hook/i.test(t)) return null;
  const hint = /remember|偏好|记住|convention|decision|决定|user prefers|always |never |别再|下次|以后|password|port|端口|token|key:|env|环境|坑|注意/i;
  if (hint.test(`${toolName} ${t.slice(0, 400)}`)) return `${toolName}: ${t.slice(0, 500)}`;
  return null;
}

async function appendServerAutoMemory(cwd: string | undefined, text: string): Promise<void> {
  if (!cwd || !text) return;
  try {
    const file = resolveWorkspaceMemoryFilePath(cwd);
    const raw = await readFile(file, "utf8").catch(() => "");
    let doc: { workspace?: string; updated_at?: number; notes?: Array<{ key: string; content: string }> };
    try { doc = raw ? JSON.parse(raw) as typeof doc : { notes: [] }; }
    catch { doc = { notes: [] }; }
    doc.notes = Array.isArray(doc.notes) ? doc.notes : [];
    if (doc.notes.length >= 100) return;
    if (doc.notes.some((n) => n?.content === text)) return;
    doc.notes.push({ key: `auto-${Date.now()}`, content: text.slice(0, 1000) });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ workspace: cwd, updated_at: Date.now(), notes: doc.notes }, null, 2), "utf8");
  } catch { /* memory is best-effort */ }
}

/**
 * Run an MCP tool with server-side Pre/PostToolUse hook events.
 * `invoke` is the raw runner (e.g. runMiniMcpTool) so callers stay decoupled.
 */
export async function runWithServerMcpHooks(
  toolName: string,
  args: Record<string, unknown>,
  invoke: (name: string, a: Record<string, unknown>) => Promise<string>,
  ctx?: Omit<MiniServerHookContext, "toolName">,
): Promise<string> {
  const base = { threadId: ctx?.threadId ?? "", turnId: ctx?.turnId ?? "", cwd: ctx?.cwd ?? "", toolName, tool_input: args };
  await fireServerHook("PreToolUse", base);
  let out: string;
  try {
    out = await invoke(toolName, args);
  } catch (e) {
    const errText = `tool error: ${e instanceof Error ? e.message : String(e)}`;
    await fireServerHook("PostToolUse", { ...base, tool_response: errText.slice(0, 4000) });
    throw e;
  }
  await fireServerHook("PostToolUse", { ...base, tool_response: out.slice(0, 4000) });
  const remember = shouldAutoRememberServerToolResult(toolName, out);
  if (remember && ctx?.cwd) void appendServerAutoMemory(ctx.cwd, remember);
  return out;
}

/** Build a bounded memory digest for thread/start injection (global + workspace). */
export async function buildMiniMemoryDigest(cwd: string): Promise<string> {
  const files: Array<{ file: string; scope: string }> = [];
  try { files.push({ file: resolveGlobalMemoryFilePath(), scope: "global" }); } catch { /* ignore */ }
  try { files.push({ file: resolveWorkspaceMemoryFilePath(cwd), scope: "workspace" }); } catch { /* ignore */ }
  const parts: string[] = [];
  for (const { file, scope } of files) {
    try {
      const raw = await readFile(file, "utf8");
      if (!raw) continue;
      const doc = JSON.parse(raw) as { notes?: Array<{ key: string; content: string; level?: string }> };
      const notes = Array.isArray(doc.notes) ? doc.notes.slice(-10) : [];
      if (notes.length === 0) continue;
      const lines = notes.map((n) => `- [${scope}:${n.key}] ${(n.content ?? "").slice(0, 300)}`);
      parts.push(`[${scope} memory]\n${lines.join("\n")}`);
    } catch { /* missing/corrupt memory is not fatal */ }
  }
  const digest = parts.join("\n").slice(0, 4000);
  return digest;
}

/** Resolve the server hook config dir (mirrors mini-codex ~/.codex-ultra hooks). */
export function resolveMiniServerHookDir(): string {
  const base = process.env.CODEX_UI_DATA_DIR?.trim() || join(homedir(), ".codex-ultra");
  return join(base, "hooks");
}

// ---------------------------------------------------------------------------
// Turn-finish lifecycle hooks (Stop / SubagentStop / SessionEnd).
//
// Design (mirrors E:/projects/opencode `plugin.trigger(name, identity, data)`
// and codex-rs hook semantics as ported by mini-codex/src/hooks.ts):
// - dotted event name + identity envelope {threadId, turnId, parentThreadId}
//   + data payload {status, summary, ...} (opencode triple);
// - TOML/JSON hook files, matcher groups, command stdin JSON, mcp_tool
//   handlers with ${} templates, decision/additionalContext parsing
//   (codex parity, adapted);
// - observers (onMiniServerHook) always fire; user hook commands run when
//   configured; failures never break turn completion.
// Divergences from the standalone CLI, by design:
// - `blocked` decisions are recorded and warned, NEVER enforced: gating
//   turn/completed on hooks would reintroduce stuck-turn hangs.
// - `hook_event_name` in command stdin carries the real event ("Stop",
//   not the CLI quirk that reuses the PostToolUse shape).
// - Server never reads the CLI homes (~/.codex, <cwd>/.codex); only the
//   ultra home and <cwd>/.codex-ultra apply here.
// ---------------------------------------------------------------------------

export type MiniTurnFinishEvent = "Stop" | "SubagentStop" | "SessionEnd";
export type MiniTurnFinishStatus = "completed" | "failed" | "interrupted" | "ended";

export interface MiniTurnFinishDetail {
  threadId: string;
  turnId?: string;
  parentThreadId?: string;
  cwd: string;
  model?: string;
  status: MiniTurnFinishStatus;
  summary?: string;
  toolCallCount?: number;
  /** Matcher name for SubagentStop (agent type / task name). */
  agentName?: string;
  /** Hook discovery root override (tests). Defaults to the ultra home. */
  ultraHome?: string;
}

export interface MiniTurnFinishResult {
  event: MiniTurnFinishEvent;
  handlers: number;
  completed: number;
  failed: number;
  blocked: number;
  additionalContexts: string[];
}

type MiniFinishHookHandlerConfig =
  | { type: "command"; command: string; commandWindows?: string; timeout?: number }
  | { type: "mcp_tool"; server: string; tool: string; input: Record<string, unknown>; timeout?: number }
  | { type: "prompt" }
  | { type: "agent" };

interface MiniFinishMatcherGroup { matcher?: string; hooks: MiniFinishHookHandlerConfig[] }

const MINI_FINISH_HOOK_EVENTS = [
  "PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact",
  "PostCompact", "SessionStart", "SessionEnd", "UserPromptSubmit",
  "SubagentStart", "SubagentStop", "Stop", "Interrupt",
] as const;

function miniFinishCanonicalEvent(k: string): string | null {
  const n = k.trim().toLowerCase().replace(/[_\-\s]/g, "");
  for (const name of MINI_FINISH_HOOK_EVENTS) {
    if (name.toLowerCase().replace(/[_\-\s]/g, "") === n) return name;
  }
  return null;
}

function miniFinishTomlScalar(text: string): unknown {
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
    return parts.map((p) => miniFinishTomlScalar(p.trim()));
  }
  if (t.startsWith("{") && t.endsWith("}")) {
    try {
      const obj: Record<string, unknown> = {};
      const inner = t.slice(1, -1).trim();
      if (inner) {
        for (const seg of inner.split(",")) {
          const eq = seg.indexOf("=");
          if (eq < 0) continue;
          obj[seg.slice(0, eq).trim().replace(/^["']|["']$/g, "")] = miniFinishTomlScalar(seg.slice(eq + 1).trim());
        }
      }
      return obj;
    } catch { return t; }
  }
  return t;
}

function miniFinishEnsurePath(root: Record<string, unknown>, path: string[], isArray: boolean): Record<string, unknown> {
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]!;
    let nxt = node[k] as unknown;
    if (Array.isArray(nxt)) {
      // Descend into the last array element (TOML [[table]] semantics):
      // [[Stop]] then [[Stop.hooks]] must attach to that Stop entry, not
      // reset it. (mini-codex/src/hooks.ts resets here; not ported.)
      if (!nxt.length || typeof nxt[nxt.length - 1] !== "object" || Array.isArray(nxt[nxt.length - 1])) {
        nxt.push({});
      }
      node = nxt[nxt.length - 1] as Record<string, unknown>;
      continue;
    }
    if (!nxt || typeof nxt !== "object") { nxt = {}; node[k] = nxt; }
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

/** Minimal TOML subset: [table] / [[array]] + key = value. Never throws. */
function miniFinishParseToml(text: string): Record<string, unknown> {
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
      cur = miniFinishEnsurePath(root, path, true);
      continue;
    }
    if (tblHead) {
      const path = tblHead[1]!.trim().split(".").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      if (!path.length) continue;
      cur = miniFinishEnsurePath(root, path, false);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^["']|["']$/g, "");
    if (!key || key.includes(".")) continue;
    try { cur[key] = miniFinishTomlScalar(line.slice(eq + 1).trim()); } catch { /* skip bad value */ }
  }
  return root;
}

function miniFinishNormalizeHandler(h: unknown): MiniFinishHookHandlerConfig | null {
  if (!h || typeof h !== "object" || Array.isArray(h)) return null;
  const r = h as Record<string, unknown>;
  if (r.type === "command" && typeof r.command === "string") {
    const commandWindows = typeof r.commandWindows === "string" ? r.commandWindows
      : (typeof r.command_windows === "string" ? String(r.command_windows) : undefined);
    return {
      type: "command",
      command: r.command,
      ...(commandWindows ? { commandWindows } : {}),
      ...(typeof r.timeout === "number" ? { timeout: r.timeout } : {}),
    };
  }
  if (r.type === "mcp_tool" && typeof r.server === "string" && typeof r.tool === "string") {
    const input = (r.input && typeof r.input === "object" && !Array.isArray(r.input)
      ? (r.input as Record<string, unknown>) : {});
    return {
      type: "mcp_tool",
      server: r.server, tool: r.tool, input,
      ...(typeof r.timeout === "number" ? { timeout: r.timeout } : {}),
    };
  }
  if (r.type === "prompt") return { type: "prompt" };
  if (r.type === "agent") return { type: "agent" };
  return null;
}

function miniFinishNormalizeEvents(raw: unknown): Partial<Record<string, MiniFinishMatcherGroup[]>> {
  const out: Partial<Record<string, MiniFinishMatcherGroup[]>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const rec = raw as Record<string, unknown>;
  const body = rec.hooks && typeof rec.hooks === "object" && !Array.isArray(rec.hooks)
    ? (rec.hooks as Record<string, unknown>) : rec;
  const remapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const canon = miniFinishCanonicalEvent(k);
    if (canon) remapped[canon] = v;
  }
  for (const [name, v] of Object.entries(remapped)) {
    if (!Array.isArray(v)) continue;
    const groups: MiniFinishMatcherGroup[] = [];
    for (const g of v) {
      if (!g || typeof g !== "object" || Array.isArray(g)) continue;
      const gr = g as Record<string, unknown>;
      const hooks: MiniFinishHookHandlerConfig[] = [];
      if (Array.isArray(gr.hooks)) for (const h of gr.hooks) {
        const hc = miniFinishNormalizeHandler(h);
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

function miniFinishParseFile(text: string, path: string): Partial<Record<string, MiniFinishMatcherGroup[]>> {
  try {
    if (path.endsWith(".toml")) {
      const parsed = miniFinishParseToml(text);
      const maybeHooks = (parsed as Record<string, unknown>).hooks;
      const doc = maybeHooks && typeof maybeHooks === "object" && !Array.isArray(maybeHooks)
        ? { ...(parsed as Record<string, unknown>), ...(maybeHooks as Record<string, unknown>), hooks: maybeHooks }
        : parsed;
      return miniFinishNormalizeEvents((maybeHooks as unknown) ?? doc);
    }
    return miniFinishNormalizeEvents(JSON.parse(text) as unknown);
  } catch { return {}; }
}

function miniFinishMatcherMatches(matcher: string | undefined, toolName: string): boolean {
  if (!matcher || !matcher.trim()) return true;
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return toolName.includes(matcher);
  }
}

/**
 * Hook discovery for turn-finish events. Order (user first, then project):
 * <ultra>/config.toml [hooks.*] -> <ultra>/hooks.toml|json ->
 * <ultra>/hooks/*.toml|json (sorted) -> <cwd>/.codex-ultra/hooks.toml|json.
 * Missing/unreadable = no hooks. Never throws.
 */
async function miniFinishLoadEvents(ultraHome: string, cwd: string): Promise<Partial<Record<string, MiniFinishMatcherGroup[]>>> {
  const merged: Partial<Record<string, MiniFinishMatcherGroup[]>> = {};
  const paths: string[] = [
    join(ultraHome, "config.toml"),
    join(ultraHome, "hooks.toml"),
    join(ultraHome, "hooks.json"),
  ];
  try {
    const entries = await readdir(join(ultraHome, "hooks"));
    for (const name of entries.filter((n) => n.endsWith(".toml") || n.endsWith(".json")).sort()) {
      paths.push(join(ultraHome, "hooks", name));
    }
  } catch { /* no hooks dir = no hooks */ }
  if (cwd) paths.push(join(cwd, ".codex-ultra", "hooks.toml"), join(cwd, ".codex-ultra", "hooks.json"));
  for (const path of paths) {
    let text: string;
    try { text = await readFile(path, "utf8"); } catch { continue; }
    const ev = miniFinishParseFile(text, path);
    for (const [name, groups] of Object.entries(ev)) {
      if (groups?.length) (merged[name] ??= []).push(...groups);
    }
  }
  return merged;
}

function miniFinishTemplateLookup(ctx: Record<string, unknown>, path: string): unknown {
  let cur: unknown = ctx;
  for (const p of path.split(".")) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function miniFinishRenderValue(v: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof v === "string") {
    return v.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
      const found = miniFinishTemplateLookup(ctx, String(expr).trim());
      if (found === undefined || found === null) return "";
      if (typeof found === "string") return found;
      try { return JSON.stringify(found) ?? ""; } catch { return String(found); }
    });
  }
  if (Array.isArray(v)) return v.map((x) => miniFinishRenderValue(x, ctx));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = miniFinishRenderValue(val, ctx);
    return out;
  }
  return v;
}

function miniFinishRunShell(cmd: string, stdin: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
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

function miniFinishParseOutput(stdout: string): { blocked: boolean; blockReason?: string; additionalContext?: string; systemMessage?: string } {
  const t = (stdout ?? "").trim();
  if (!t) return { blocked: false };
  let p: unknown = null;
  try { p = JSON.parse(t) as unknown; }
  catch { return { blocked: false, systemMessage: t.slice(0, 2000) }; }
  if (!p || typeof p !== "object" || Array.isArray(p)) return { blocked: false };
  const r = p as Record<string, unknown>;
  const out: { blocked: boolean; blockReason?: string; additionalContext?: string; systemMessage?: string } = { blocked: false };
  const decision = typeof r.decision === "string" ? r.decision.toLowerCase() : "";
  const cont = typeof r.continue === "boolean" ? r.continue : undefined;
  if (typeof r.systemMessage === "string" && r.systemMessage.trim()) out.systemMessage = r.systemMessage.trim().slice(0, 2000);
  else if (typeof r.system_message === "string" && r.system_message.trim()) out.systemMessage = String(r.system_message).trim().slice(0, 2000);
  if (decision === "block" || decision === "deny" || cont === false) {
    out.blocked = true;
    if (typeof r.reason === "string" && r.reason.trim()) out.blockReason = r.reason.trim().slice(0, 2000);
  }
  const specific = (r.hookSpecificOutput && typeof r.hookSpecificOutput === "object" && !Array.isArray(r.hookSpecificOutput)
    ? r.hookSpecificOutput as Record<string, unknown>
    : (r.hook_specific_output && typeof r.hook_specific_output === "object" && !Array.isArray(r.hook_specific_output)
      ? r.hook_specific_output as Record<string, unknown> : null));
  if (specific) {
    const add = typeof specific.additionalContext === "string" ? specific.additionalContext
      : (typeof specific.additional_context === "string" ? String(specific.additional_context) : undefined);
    if (add && add.trim()) out.additionalContext = add.trim().slice(0, 8000);
  }
  if (!out.additionalContext && typeof r.additionalContext === "string" && r.additionalContext.trim()) {
    out.additionalContext = String(r.additionalContext).trim().slice(0, 8000);
  }
  return out;
}

/** Command stdin for finish events. Same keys as the CLI post-shape, except hook_event_name carries the real event. */
function miniFinishCommandStdin(args: {
  event: MiniTurnFinishEvent; sessionId: string; turnId: string; cwd: string; model: string;
  toolName: string; toolUseId: string; status: MiniTurnFinishStatus; summary: string; toolCallCount?: number;
}): string {
  return JSON.stringify({
    session_id: args.sessionId, turn_id: args.turnId, transcript_path: null, cwd: args.cwd,
    hook_event_name: args.event, model: args.model, permission_mode: "default",
    tool_name: args.toolName, tool_input: {}, tool_use_id: args.toolUseId,
    tool_response: {
      status: args.status,
      summary: args.summary.slice(0, 4000),
      ...(typeof args.toolCallCount === "number" ? { tool_call_count: args.toolCallCount } : {}),
    },
  });
}

function miniFinishEmpty(event: MiniTurnFinishEvent): MiniTurnFinishResult {
  return { event, handlers: 0, completed: 0, failed: 0, blocked: 0, additionalContexts: [] };
}

/**
 * Fire turn-finish lifecycle hooks (Stop, or SubagentStop for child turns).
 * Observer events always fire; user hook commands run when configured.
 * `blocked` decisions are recorded and warned, never enforced: gating turn
 * completion on hooks would reintroduce stuck-turn hangs. Never throws.
 */
export async function fireMiniTurnFinishHook(detail: MiniTurnFinishDetail): Promise<MiniTurnFinishResult> {
  const event: MiniTurnFinishEvent = detail.parentThreadId ? "SubagentStop" : "Stop";
  const toolName = detail.parentThreadId ? (detail.agentName?.trim() || "agent") : "lifecycle";
  const turnId = detail.turnId?.trim() || detail.threadId;
  const summary = (detail.summary ?? "").slice(0, 4000);
  const base = {
    threadId: detail.threadId, turnId,
    ...(detail.parentThreadId ? { parentThreadId: detail.parentThreadId } : {}),
    cwd: detail.cwd, model: detail.model ?? "",
    status: detail.status, summary: summary.slice(0, 2000),
    ...(typeof detail.toolCallCount === "number" ? { toolCallCount: detail.toolCallCount } : {}),
    hook_event_name: event,
  };
  const result = miniFinishEmpty(event);
  try {
    const ultraHome = detail.ultraHome?.trim() || process.env.CODEX_UI_DATA_DIR?.trim() || join(homedir(), ".codex-ultra");
    const events = await miniFinishLoadEvents(ultraHome, detail.cwd);
    const groups = events[event] ?? [];
    const matched: MiniFinishHookHandlerConfig[] = [];
    for (const g of groups) {
      if (!miniFinishMatcherMatches(g.matcher, toolName)) continue;
      matched.push(...g.hooks);
    }
    result.handlers = matched.length;
    if (detail.cwd && matched.length) {
      for (const h of matched) {
        try {
          if (h.type === "command") {
            const command = process.platform === "win32" && h.commandWindows ? h.commandWindows : h.command;
            const stdin = miniFinishCommandStdin({
              event, sessionId: detail.threadId, turnId, cwd: detail.cwd, model: detail.model ?? "",
              toolName, toolUseId: `${event}-${turnId}`, status: detail.status, summary,
              ...(typeof detail.toolCallCount === "number" ? { toolCallCount: detail.toolCallCount } : {}),
            });
            const timeoutMs = Math.max(500, Math.min(120_000, Math.floor(((h.timeout ?? 30)) * 1000)));
            const r = await miniFinishRunShell(command, stdin, detail.cwd, timeoutMs);
            if (r.timedOut) { result.failed += 1; continue; }
            if (r.exitCode !== 0 && !r.stdout.trim()) { result.failed += 1; continue; }
            const parsed = miniFinishParseOutput(r.stdout);
            if (parsed.additionalContext) result.additionalContexts.push(parsed.additionalContext);
            if (parsed.blocked) {
              result.blocked += 1;
              console.warn(`[mini-hook:${event}] block decision recorded (not enforced): ${(parsed.blockReason ?? "blocked by hook").slice(0, 200)}`);
            } else if (r.exitCode !== 0) {
              result.failed += 1;
            } else {
              result.completed += 1;
            }
          } else if (h.type === "mcp_tool") {
            const rendered = miniFinishRenderValue(h.input, {
              tool_name: toolName, tool_use_id: `${event}-${turnId}`, cwd: detail.cwd,
              session_id: detail.threadId, turn_id: turnId,
              server: h.server, tool: h.tool,
              tool_input: { status: detail.status, summary },
            }) as Record<string, unknown>;
            const out = await runMiniMcpTool(`mcp__${h.server}__${h.tool}`, rendered);
            if (/^(unknown MCP tool|MCP tool error)/.test(out.trim())) { result.failed += 1; continue; }
            const parsed = miniFinishParseOutput(out);
            if (parsed.additionalContext) result.additionalContexts.push(parsed.additionalContext);
            else if (out.trim()) result.additionalContexts.push(out.trim().slice(0, 2000));
            if (parsed.blocked) {
              result.blocked += 1;
              console.warn(`[mini-hook:${event}] block decision recorded (not enforced): ${(parsed.blockReason ?? "blocked by MCP hook").slice(0, 200)}`);
            } else {
              result.completed += 1;
            }
          } else {
            result.failed += 1;
            console.warn(`[mini-hook:${event}] hook type '${h.type}' is not supported by the server (needs app-server); ignoring`);
          }
        } catch (e) {
          result.failed += 1;
          console.warn(`[mini-hook:${event}] handler error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
        }
      }
    }
    await fireServerHook(event, {
      ...base,
      toolName,
      handlers: result.handlers, completed: result.completed,
      failed: result.failed, blocked: result.blocked,
      additionalContexts: result.additionalContexts.slice(0, 5),
    });
  } catch (e) {
    console.warn(`[mini-hook:${event}] infra error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
  return result;
}

/**
 * Fire SessionEnd hooks when a thread is deleted or archived.
 * Same discovery/execution as turn-finish hooks. Never throws.
 */
export async function fireMiniSessionEndHook(detail: {
  threadId: string; cwd: string; model?: string; reason: "deleted" | "archived"; ultraHome?: string;
}): Promise<MiniTurnFinishResult> {
  const result = miniFinishEmpty("SessionEnd");
  const base = {
    threadId: detail.threadId, cwd: detail.cwd, model: detail.model ?? "",
    status: "ended", reason: detail.reason, hook_event_name: "SessionEnd",
  };
  try {
    const ultraHome = detail.ultraHome?.trim() || process.env.CODEX_UI_DATA_DIR?.trim() || join(homedir(), ".codex-ultra");
    const events = await miniFinishLoadEvents(ultraHome, detail.cwd);
    const groups = events["SessionEnd"] ?? [];
    const matched: MiniFinishHookHandlerConfig[] = [];
    for (const g of groups) {
      if (!miniFinishMatcherMatches(g.matcher, "lifecycle")) continue;
      matched.push(...g.hooks);
    }
    result.handlers = matched.length;
    if (detail.cwd && matched.length) {
      for (const h of matched) {
        try {
          if (h.type === "command") {
            const command = process.platform === "win32" && h.commandWindows ? h.commandWindows : h.command;
            const stdin = miniFinishCommandStdin({
              event: "SessionEnd", sessionId: detail.threadId, turnId: detail.threadId,
              cwd: detail.cwd, model: detail.model ?? "", toolName: "lifecycle",
              toolUseId: `SessionEnd-${detail.threadId}`, status: "ended", summary: detail.reason,
            });
            const timeoutMs = Math.max(500, Math.min(120_000, Math.floor(((h.timeout ?? 30)) * 1000)));
            const r = await miniFinishRunShell(command, stdin, detail.cwd, timeoutMs);
            if (r.timedOut || (r.exitCode !== 0 && !r.stdout.trim())) { result.failed += 1; continue; }
            const parsed = miniFinishParseOutput(r.stdout);
            if (parsed.additionalContext) result.additionalContexts.push(parsed.additionalContext);
            if (parsed.blocked) {
              result.blocked += 1;
              console.warn(`[mini-hook:SessionEnd] block decision recorded (not enforced): ${(parsed.blockReason ?? "blocked by hook").slice(0, 200)}`);
            } else if (r.exitCode !== 0) {
              result.failed += 1;
            } else {
              result.completed += 1;
            }
          } else if (h.type === "mcp_tool") {
            const rendered = miniFinishRenderValue(h.input, {
              tool_name: "lifecycle", tool_use_id: `SessionEnd-${detail.threadId}`, cwd: detail.cwd,
              session_id: detail.threadId, turn_id: detail.threadId,
              server: h.server, tool: h.tool, tool_input: { reason: detail.reason },
            }) as Record<string, unknown>;
            const out = await runMiniMcpTool(`mcp__${h.server}__${h.tool}`, rendered);
            if (/^(unknown MCP tool|MCP tool error)/.test(out.trim())) { result.failed += 1; continue; }
            const parsed = miniFinishParseOutput(out);
            if (parsed.additionalContext) result.additionalContexts.push(parsed.additionalContext);
            else if (out.trim()) result.additionalContexts.push(out.trim().slice(0, 2000));
            if (parsed.blocked) {
              result.blocked += 1;
              console.warn(`[mini-hook:SessionEnd] block decision recorded (not enforced): ${(parsed.blockReason ?? "blocked by MCP hook").slice(0, 200)}`);
            } else {
              result.completed += 1;
            }
          } else {
            result.failed += 1;
            console.warn(`[mini-hook:SessionEnd] hook type '${h.type}' is not supported by the server (needs app-server); ignoring`);
          }
        } catch (e) {
          result.failed += 1;
          console.warn(`[mini-hook:SessionEnd] handler error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
        }
      }
    }
    await fireServerHook("SessionEnd", {
      ...base,
      handlers: result.handlers, completed: result.completed,
      failed: result.failed, blocked: result.blocked,
      additionalContexts: result.additionalContexts.slice(0, 5),
    });
  } catch (e) {
    console.warn(`[mini-hook:SessionEnd] infra error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
  return result;
}
