// Glue: run any tool call through Codex-parity PreToolUse/PostToolUse hooks.
// MCP tools are first-class: tool_name = mcp__<server>__<tool>,
// tool_input = parsed JSON args, tool_response = {content, structuredContent}.
import { randomUUID } from "node:crypto";
import { callMcpByServerRaw, isMcpTool, runMcpToolDetailed } from "./mcp.ts";
import { appendMiniMemory } from "./memory.ts";
import {
  defaultHookSink, executeHooks, hookFilesLoaded, loadHookEvents, mcpHookToolInput,
  type HookCompletedEvent, type HookEventName, type HookEventSink,
} from "./hooks.ts";

export type HookedToolRunner = (toolName: string, args: Record<string, unknown>, callId: string) => Promise<string>;

export interface HookPipelineOpts {
  cwd: string;
  model: string;
  sessionId?: string;
  turnId?: string;
  sink?: HookEventSink | null;
  /** Fallback executor for non-MCP tools (e.g. sa_vm). */
  execNonMcp: (toolName: string, args: Record<string, unknown>, cwd: string) => Promise<string>;
}

let warnedNoSink = false;

function resolveSink(opts: HookPipelineOpts): HookEventSink | undefined {
  if (opts.sink === null) return undefined;
  if (opts.sink) return opts.sink;
  if (process.env.MINI_HOOKS_LOG === "off") return undefined;
  if (!warnedNoSink) { warnedNoSink = true; }
  return defaultHookSink();
}

/**
 * Run one tool call with hooks. Never throws: hook failures degrade to
 * Failed events; tool errors become text output (existing mini behavior).
 */
export async function runToolWithHooks(
  toolName: string,
  args: Record<string, unknown>,
  callId: string,
  opts: HookPipelineOpts,
): Promise<{ output: string; hookEvents: HookCompletedEvent[]; blocked: boolean }> {
  const events = await loadHookEvents(opts.cwd).catch(() => ({}));
  const sink = resolveSink(opts);
  const sessionId = opts.sessionId ?? process.env.MINI_SESSION_ID ?? randomUUID();
  const turnId = opts.turnId ?? `${Date.now()}`;
  const toolInput = mcpHookToolInput(args);
  const hookCtxBase = {
    sessionId, turnId, cwd: opts.cwd, model: opts.model,
    toolName, toolUseId: callId, toolInput,
    callMcpRaw: (server: string, tool: string, input: Record<string, unknown>, timeoutMs: number) =>
      callMcpByServerRaw(server, tool, input, timeoutMs),
    sink,
  };
  const hookEvents: HookCompletedEvent[] = [];

  // PreToolUse
  let effectiveArgs = args;
  let preContexts: string[] = [];
  try {
    const pre = await executeHooks(events, hookFilesLoaded(), "PreToolUse", hookCtxBase);
    hookEvents.push(...pre.hookEvents);
    if (pre.blocked) {
      return {
        output: `Blocked by PreToolUse hook (${toolName}): ${(pre.blockReason ?? "no reason").slice(0, 2000)}`,
        hookEvents, blocked: true,
      };
    }
    if (pre.updatedInput) effectiveArgs = pre.updatedInput;
    // Keep context on this invocation. A module-global stash can cross-wire
    // parallel child-agent tool calls and leak one call's context into another.
    preContexts = pre.additionalContexts;
  } catch (e) {
    // Hook infra must never break tool execution.
    process.stderr.write(`[hook:PreToolUse] infra error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}\n`);
  }

  // Execute
  let text: string;
  let response: unknown = null;
  try {
    if (isMcpTool(toolName)) {
      const r = await runMcpToolDetailed(toolName, effectiveArgs ?? {});
      text = r.text;
      // Codex PostToolUse tool_response shape.
      response = { content: (r.response as { content: unknown }).content ?? [], structuredContent: (r.response as { structuredContent: unknown }).structuredContent ?? null };
    } else {
      text = await opts.execNonMcp(toolName, effectiveArgs ?? {}, opts.cwd);
      response = { content: [{ type: "text", text: String(text).slice(0, 8000) }], structuredContent: null };
    }
  } catch (e) {
    text = `tool error: ${(e instanceof Error ? e.message : String(e)).slice(0, 2000)}`;
    response = { content: [], structuredContent: null };
  }

  // PostToolUse
  try {
    const post = await executeHooks(events, hookFilesLoaded(), "PostToolUse", {
      ...hookCtxBase, toolInput: mcpHookToolInput(effectiveArgs), toolResponse: response,
    });
    hookEvents.push(...post.hookEvents);
    const extras = [...preContexts, ...post.additionalContexts];
    if (extras.length) {
      text += `\n\n[hook additionalContext]\n${extras.map((c) => String(c).slice(0, 2000)).join("\n---\n").slice(0, 6000)}`;
    }
    if (post.blocked) {
      text += `\n\n[hook PostToolUse blocked: ${(post.blockReason ?? post.feedback ?? "no reason").slice(0, 1000)}]`;
    }
  } catch (e) {
    process.stderr.write(`[hook:PostToolUse] infra error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}\n`);
  }
  return { output: text, hookEvents, blocked: false };
}

/** Decide whether a tool result is worth remembering (cheap local triage, no LLM). */
export function shouldRememberToolResult(toolName: string, output: string): string | null {
  const t = (output ?? "").trim();
  if (!t || t.length < 24 || /tool error:|Blocked by .* hook/i.test(t)) return null;
  const hint = /remember|偏好|记住|convention|decision|决定|user prefers|always |never |别再|下次|以后|password|port|端口|token|key:|env|环境|坑|注意/i;
  if (hint.test(`${toolName} ${t.slice(0, 400)}`)) return `${toolName}: ${t.slice(0, 500)}`;
  return null;
}

export interface LifecycleHookOpts {
  cwd: string; model: string; sessionId?: string; turnId?: string;
  sink?: HookEventSink | null;
  callMcpRaw?: (server: string, tool: string, input: Record<string, unknown>, timeoutMs: number) => Promise<string>;
}

/** Fire a lifecycle hook (SessionStart/UserPromptSubmit/SubagentStart/.../SessionEnd). Never throws. */
export async function fireLifecycleHook(
  eventName: HookEventName,
  opts: LifecycleHookOpts & { prompt?: string; toolName?: string },
): Promise<string[]> {
  try {
    const events = await loadHookEvents(opts.cwd).catch(() => ({}));
    const groups = events[eventName];
    if (!groups?.length) return [];
    const sink = opts.sink === null ? undefined : (opts.sink ?? (process.env.MINI_HOOKS_LOG === "off" ? undefined : defaultHookSink()));
    const sessionId = opts.sessionId ?? process.env.MINI_SESSION_ID ?? randomUUID();
    const turnId = opts.turnId ?? `${Date.now()}`;
    const res = await executeHooks(events, hookFilesLoaded(), eventName, {
      sessionId, turnId, cwd: opts.cwd, model: opts.model,
      toolName: opts.toolName ?? "lifecycle",
      toolUseId: `${eventName}-${turnId}`,
      toolInput: opts.prompt ? { prompt: opts.prompt.slice(0, 4000) } : {},
      callMcpRaw: opts.callMcpRaw ?? ((server, tool, input, timeoutMs) => callMcpByServerRaw(server, tool, input, timeoutMs)),
      sink,
    });
    return res.additionalContexts;
  } catch (e) {
    process.stderr.write(`[hook:${eventName}] infra error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}\n`);
    return [];
  }
}

/** Auto-remember durable facts from a tool result into repo MEMORY.md. Never throws. */
export function autoRemember(cwd: string, toolName: string, output: string): void {
  try {
    const note = shouldRememberToolResult(toolName, output);
    if (note) appendMiniMemory(cwd, note);
  } catch { /* memory must never break the loop */ }
}
