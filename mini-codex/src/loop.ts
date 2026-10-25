import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createChainedTurn, createTurn, sanitizeThread, toResponsesInput, EMPTY_MINI_RESPONSES_CHAIN, type MiniProtocol, type MiniResponsesChain } from "./responses.ts";
import { loadAgentsMd } from "./agentsMd.ts";
import { appendMiniMemory, loadMiniMemory } from "./memory.ts";
import { applyPlanUpdate } from "./plan.ts";
import { TOOLS, isSubagentTool, parseTaskName, toolsForDepth } from "./tools.ts";
import { isMcpTool, listMcpResources, loadMcpTools, mcpStatusLine, readMcpResource, setMcpWorkspaceRoots } from "./mcp.ts";
import { autoRemember, fireLifecycleHook, runToolWithHooks } from "./mcpHooks.ts";
import { imageViewArgError, viewLocalImage } from "./imageView.ts";
import { expandSlash, readSkillBody, scanSkills, skillListPrompt, type SkillEntry } from "./skills.ts";
import { buildReviewPrompt, parseReviewTarget, reviewTargetLabel, REVIEW_SYSTEM_SUFFIX } from "./review.ts";
import type { ThreadItem, ToolDef } from "./types.ts";

export type MiniConfig = { baseUrl: string; apiKey: string; model: string; effort?: string; cwd: string; maxTurns?: number; protocol?: MiniProtocol };
export type UltraToolExecutor = (toolName: string, args: Record<string, any>, cwd: string) => Promise<string>;

export const MINI_SUBAGENT_MAX_CHILDREN = 5;

/** Default transcript file for --resume and /fork. */
export function defaultThreadFile(cwd: string): string {
  return join(cwd, ".mini-codex-thread.jsonl");
}

/** Load a persisted transcript (one JSON item per line); null when missing/unreadable. */
export function loadThreadFile(path: string): ThreadItem[] | null {
  try {
    if (!existsSync(path)) return null;
    const items: ThreadItem[] = [];
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const item = JSON.parse(trimmed) as ThreadItem;
        if (item && typeof item === "object" && typeof (item as { type?: unknown }).type === "string") {
          items.push(item);
        }
      } catch {
        // Skip corrupt lines; the rest of the transcript stays usable.
      }
    }
    return items;
  } catch {
    return null;
  }
}

/**
 * Fork a persisted transcript (server `thread/fork` parity at file level):
 * copy items through the last N user turns (default: all) into a sibling
 * `.fork-<timestamp>.jsonl` file. Continue it later with `--resume <file>`.
 */
export function forkThreadFile(
  sourcePath: string,
  maxUserTurns?: number,
): { file: string; turns: number; items: number } {
  const items = loadThreadFile(sourcePath);
  if (!items) throw new Error(`fork: no transcript at ${sourcePath} (run once first, or pass a transcript path)`);
  let kept = items;
  if (typeof maxUserTurns === "number" && Number.isFinite(maxUserTurns) && maxUserTurns > 0) {
    const userIdx: number[] = [];
    items.forEach((item, idx) => {
      if (item.type === "user") userIdx.push(idx);
    });
    const start = userIdx.length > maxUserTurns ? (userIdx[userIdx.length - maxUserTurns] as number) : 0;
    kept = items.slice(start);
  }
  const dir = dirname(sourcePath);
  const base = basename(sourcePath, ".jsonl");
  const file = join(dir, `${base}.fork-${Date.now()}.jsonl`);
  writeFileSync(file, kept.map((t) => JSON.stringify(t)).join("\n"), "utf8");
  const turns = kept.filter((t) => t.type === "user").length;
  return { file, turns, items: kept.length };
}

function parseForkArgs(rest: string, cwd: string): { source: string; maxUserTurns?: number } {
  let source = defaultThreadFile(cwd);
  let maxUserTurns: number | undefined;
  for (const token of rest.split(/\s+/).filter(Boolean)) {
    if (/^\d+$/.test(token)) {
      maxUserTurns = Math.max(1, Math.min(200, parseInt(token, 10)));
    } else {
      source = token;
    }
  }
  return { source, maxUserTurns };
}

type ChildState = {
  id: string;
  taskName: string;
  agentType: string;
  thread: ThreadItem[];
  status: "running" | "completed" | "failed";
  report: string;
  pending: string[];
  promise: Promise<void> | null;
};

const SUBAGENT_SYSTEM_SUFFIX = "Sub-agents: delegate independent subtasks with spawn_agent(task_name,message) - BOTH required, up to 5 in parallel. Sub-agents cannot spawn further. Collect reports with wait_agent BEFORE the final summary; follow up with send_message, interrupt with interrupt_agent, close finished agents with close_agent.";

/** Output contract: appended to every system prompt. Root cause of the
 * "repeats the user sentence" complaint was a system prompt with no output
 * contract plus returning the first text seen even when later turns only ran
 * tools. The model echoed the request and that echo was returned verbatim. */
export const OUTPUT_CONTRACT =
  "Output contract (always follow): " +
  "Never repeat, paraphrase, or echo the user request or task brief. " +
  "Act with tools first; every factual claim must come from tool output. " +
  "Always finish with a concise summary: what was done, file paths/evidence, what remains. " +
  "Never end with an echo of the request.";

function numEnv(key: string, fallback: number, min: number, max: number): number {
  const t = (process.env[key] ?? "").trim();
  if (!t) return fallback;
  const n = Number(t);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function buildBaseSystem(mcpHint: string, skills: SkillEntry[], depth: number, agentsMd?: string, longMemory?: string): string {
  const baseSystem = `You are a minimal coding agent. Plan briefly (3-7 steps), act with sa_vm (subscribed ultra native tools) and image_view to look at local images, verify every change with tools, then report concisely with evidence. Keep working until the request is done — do not stop after a single step and never ask the user for continuation; only stop when done or truly blocked (missing credentials/permissions after trying alternatives).${mcpHint}\n${skillListPrompt(skills)}\nread_skill is optional: load a listed skill only when the task needs its specialized guidance; paths are workspace-relative.\nFor genuinely multi-step work, you must track progress with update_plan (full checklist first, then update each call, one step in_progress at a time). Persist durable facts, decisions, and user preferences with remember so future runs keep them.`;
  const withScopes = agentsMd?.trim()
    ? `${baseSystem}\n\nRepo instructions (AGENTS.md, obey for files in scope):\n${agentsMd.trim()}`
    : baseSystem;
  const withMemory = longMemory?.trim()
    ? `${withScopes}\n\n${longMemory.trim()}`
    : withScopes;
  const system = depth > 0 ? withMemory : `${withMemory}\n${SUBAGENT_SYSTEM_SUFFIX}`;
  return `${system}\n${OUTPUT_CONTRACT}`;
}

/** Sidecar holding the responses chain across CLI invocations (tiny: id + hash). */
export function chainFileFor(saveFile: string): string {
  return `${saveFile}.chain.json`;
}

/** Restore a persisted chain; EMPTY when missing/corrupt (safe full-send fallback). */
export function loadChainFile(path: string): MiniResponsesChain {
  try {
    const p = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (p && typeof p.prevId === "string" && typeof p.sentHash === "string" && typeof p.sentCount === "number") {
      return { prevId: p.prevId, sentHash: p.sentHash, sentCount: p.sentCount };
    }
  } catch { /* ignore */ }
  return { ...EMPTY_MINI_RESPONSES_CHAIN };
}

/**
 * Transcript auto-load (root cause of the "forgets context" complaint):
 * previously history was only loaded with an explicit --resume flag, so a
 * plain invocation started blank and then overwrote the saved file.
 * Now the persisted file is the default memory unless an explicit thread is
 * passed. Capped to the most recent items to bound context growth.
 */
export function loadThreadAuto(saveFile: string, initial: ThreadItem[] | undefined): ThreadItem[] {
  return loadThreadAutoWithDropped(saveFile, initial).thread;
}

/**
 * Split variant: returns the kept tail plus the dropped prefix (empty when
 * nothing was cut). The prefix is summarized by the caller into a [memory]
 * item so overflow compacts instead of silently forgetting (upstream parity:
 * compaction keeps a handoff summary, never a hard cut).
 */
export function loadThreadAutoWithDropped(
  saveFile: string,
  initial: ThreadItem[] | undefined,
): { thread: ThreadItem[]; dropped: ThreadItem[] } {
  // Explicit --resume threads used to bypass every cap and go out whole,
  // inviting silent relay-side truncation (resume-time amnesia). Same
  // keep-cap + [memory] compaction as the default path; the caller summarizes
  // the dropped prefix via withCompactedMemory either way.
  const keep = numEnv("MINI_THREAD_KEEP", 200, 20, 2000);
  if (initial) {
    if (initial.length <= keep) return { thread: [...initial], dropped: [] };
    const sliced = splitKeptTail(initial, keep);
    return pinDroppedPlan(sliced.thread, sliced.dropped);
  }
  const prev = loadThreadFile(saveFile);
  if (!prev?.length) return { thread: [], dropped: [] };
  if (prev.length <= keep) return { thread: prev, dropped: [] };
  const sliced = splitKeptTail(prev, keep);
  return pinDroppedPlan(sliced.thread, sliced.dropped);
}

/** Slice the kept tail + dropped prefix (pure, keeps the cap logic in one place). */
function splitKeptTail(items: ThreadItem[], keep: number): { thread: ThreadItem[]; dropped: ThreadItem[] } {
  return { thread: items.slice(items.length - keep), dropped: items.slice(0, items.length - keep) };
}

/**
 * Carry the latest dropped plan forward (plan/todo tracking must survive a
 * cross-invocation load cut; the mid-turn budget already pins it, but a 200+
 * item transcript would otherwise lose the exact checklist and keep only a
 * summary — plan amnesia). Stale when the kept tail already has a newer plan.
 */
function pinDroppedPlan(thread: ThreadItem[], dropped: ThreadItem[]): { thread: ThreadItem[]; dropped: ThreadItem[] } {
  let planIdx = -1;
  for (let i = dropped.length - 1; i >= 0; i--) {
    if (dropped[i].type === "plan") { planIdx = i; break; }
  }
  if (planIdx < 0 || thread.some((t) => t.type === "plan")) return { thread, dropped };
  const plan = dropped[planIdx];
  return { thread: [plan, ...thread], dropped: dropped.filter((_, i) => i !== planIdx) };
}

/** Max prefix items sent to the summarizer (wire format already caps 8KB per output). */
export const SUMMARY_PREFIX_MAX_ITEMS = 80;

/**
 * Bound the summarization input: head + evidence digest of the middle + tail.
 * The dropped prefix is unbounded on disk (MINI_THREAD_KEEP only caps the
 * kept tail), so sending it whole could blow the single summary call.
 */
export function boundPrefixForSummary(dropped: ThreadItem[], maxItems = SUMMARY_PREFIX_MAX_ITEMS): ThreadItem[] {
  if (dropped.length <= maxItems) return dropped;
  const headCount = 20;
  const tailCount = maxItems - headCount - 1;
  const head = dropped.slice(0, headCount);
  const tail = dropped.slice(dropped.length - tailCount);
  const middle = dropped.slice(headCount, dropped.length - tailCount);
  const d = digestToolOutputs(middle);
  const mid: ThreadItem = {
    type: "user",
    text: `[omitted ${middle.length} middle items from this prefix]${d ? `\n${d}` : ""}`,
  };
  return [...head, mid, ...tail];
}

/** Summarize a truncated transcript prefix (tools:[] — pure summarization turn). */
export async function summarizeDroppedPrefix(cfg: MiniConfig, dropped: ThreadItem[]): Promise<string> {
  const r = await createTurn({
    baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, effort: cfg.effort, tools: [],
    protocol: cfg.protocol ?? "responses",
    system: "Summarize this earlier coding-agent transcript prefix in 10 bullet lines or less. Keep file paths, decisions made, and pending/unfinished work. This summary will be the only memory of that prefix — do not echo, be specific.",
    thread: sanitizeThread(boundPrefixForSummary(dropped)),
  });
  return r.text.trim();
}

export function buildMemoryItem(summary: string, droppedCount: number): ThreadItem {
  return {
    type: "user",
    text: `[memory] Earlier history (${droppedCount} items) was compacted to fit context. Summary:\n${summary}`,
  };
}

/**
 * Compact-on-overflow: summarize the dropped prefix into a leading [memory]
 * item. Falls back to a structural tool-evidence digest when the model call
 * fails, so the load never loses the prefix silently and never throws.
 *
 * Mid-turn budget note (upstream parity: codex-rs compacts inline when the
 * context window fills; the load-time prefix above is not enough, so
 * ensureThreadBudget() squeezes the middle again on every turn — see below).
 */
export async function withCompactedMemory(
  cfg: MiniConfig,
  thread: ThreadItem[],
  dropped: ThreadItem[],
): Promise<ThreadItem[]> {
  if (!dropped.length) return thread;
  try {
    const summary = await summarizeDroppedPrefix(cfg, dropped);
    if (summary) return [buildMemoryItem(summary, dropped.length), ...thread];
  } catch {
    // Fall through to the grounded digest below.
  }
  const d = digestToolOutputs(dropped);
  const fallback = d
    ? `Model summary unavailable. Tool evidence from that prefix:\n${d}`
    : "(no tool evidence in the compacted prefix)";
  try {
    process.stderr.write(`[mini] compacted ${dropped.length} older items into [memory] (fallback digest).\n`);
  } catch { /* ignore */ }
  return [buildMemoryItem(fallback, dropped.length), ...thread];
}

/**
 * Mid-turn token budget (upstream parity: codex-rs compacts inline when the
 * context window fills; mini previously only compacted the load-time prefix,
 * so a long run grew the thread unbounded and the relay silently truncated
 * the middle — the "mid-run amnesia" complaint).
 *
 * Pure + sync (no model call inside the turn loop): keeps leading
 * [memory]/[compacted] markers plus the most recent tail inside
 * MINI_THREAD_CHAR_BUDGET, and replaces the squeezed middle with a grounded
 * tool-evidence digest item so nothing is silently forgotten.
 */
export function estimateThreadChars(thread: ThreadItem[]): number {
  let n = 0;
  for (const it of thread) {
    if (it.type === "user" || it.type === "message" || it.type === "reasoning") n += it.text.length;
    else if (it.type === "plan") n += it.text.length;
    else if (it.type === "function_call") n += (it.args?.length ?? 0) + (it.name?.length ?? 0);
    // Image payloads ride the wire as native image blocks every turn (see
    // toResponsesInput), so their data-URL chars must count, otherwise an
    // image-heavy session blows past the relay limit while the budget
    // reports calm — silent mid-run amnesia.
    else if (it.type === "function_call_output") {
      n += it.output.length;
      if (it.images) for (const img of it.images) n += img.length;
    }
  }
  return n;
}

function isMemoryMarker(it: ThreadItem): boolean {
  return it.type === "user" && (/^\[memory\]/.test(it.text) || /^\[compacted\]/.test(it.text));
}

export function ensureThreadBudget(thread: ThreadItem[], maxChars = numEnv("MINI_THREAD_CHAR_BUDGET", 120000, 20000, 1000000)): ThreadItem[] {
  if (estimateThreadChars(thread) <= maxChars) return thread;
  const markers = thread.filter(isMemoryMarker);
  // Pin the latest live plan (plan/todo tracking must survive budget squeeze;
  // otherwise the checklist silently drops out mid-run — plan amnesia).
  let pinnedPlan: ThreadItem | null = null;
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].type === "plan") { pinnedPlan = thread[i]; break; }
  }
  const rest = thread.filter((t) => !isMemoryMarker(t) && t !== pinnedPlan);
  // Always keep at least the newest 8 items (covers the current exchange);
  // fill backwards while budget allows, up to 40 items.
  const keepTail: ThreadItem[] = [];
  let used = 0;
  for (const m of markers) if (m.type === "user") used += m.text.length;
  if (pinnedPlan?.type === "plan") used += pinnedPlan.text.length;
  const itemLen = (it: ThreadItem): number => {
    if (it.type === "user" || it.type === "message" || it.type === "reasoning") return it.text.length;
    if (it.type === "plan") return it.text.length;
    if (it.type === "function_call") return (it.args?.length ?? 0) + (it.name?.length ?? 0);
    // Keep in sync with estimateThreadChars: image payload chars count.
    if (it.type === "function_call_output") {
      let n = it.output.length;
      if (it.images) for (const img of it.images) n += img.length;
      return n;
    }
    return 0;
  };
  for (let i = rest.length - 1; i >= 0; i--) {
    const it = rest[i] as ThreadItem;
    const len = itemLen(it);
    if (keepTail.length >= 8 && used + len > maxChars) break;
    if (keepTail.length >= 40) break;
    keepTail.unshift(it);
    used += len;
  }
  const droppedCount = rest.length - keepTail.length;
  if (droppedCount <= 0) return thread;
  const dropped = rest.slice(0, rest.length - keepTail.length);
  // Pair repair: a kept output whose call was cut off would be silently
  // stripped by sanitizeThread on the wire, losing the freshest evidence.
  // Calls are tiny (name + args), so restore the missing ones from the
  // dropped region and slot each just before its output.
  const callsById = new Map<string, ThreadItem>();
  for (const it of dropped) {
    if (it.type === "function_call" && !callsById.has(it.callId)) callsById.set(it.callId, it);
  }
  const keptCallIds = new Set<string>();
  for (const it of keepTail) if (it.type === "function_call") keptCallIds.add(it.callId);
  const repaired: ThreadItem[] = [];
  for (const it of keepTail) {
    if (it.type === "function_call_output" && !keptCallIds.has(it.callId)) {
      const call = callsById.get(it.callId);
      if (call) {
        repaired.push(call);
        keptCallIds.add(it.callId);
      }
    }
    repaired.push(it);
  }
  const d = digestToolOutputs(dropped);
  const mid: ThreadItem = {
    type: "user",
    text: `[memory] ${droppedCount} mid-run items squeezed out of context budget (${maxChars} chars).${d ? `\n${d}` : " (no tool evidence in the squeezed range)"}`,
  };
  try {
    process.stderr.write(`[mini] context budget: squeezed ${droppedCount} mid-run items into [memory] digest.\n`);
  } catch { /* ignore */ }
  return [...markers, ...(pinnedPlan ? [pinnedPlan] : []), mid, ...repaired];
}

/**
 * Anti-passive nudge (upstream parity: the agent keeps working until the
 * request is done; mini previously accepted a text-only answer even when the
 * request clearly needed tool action — the "lazy / 不主动" complaint).
 * True only for action-like prompts with ZERO tool calls in the run.
 */
export function needsActionNudge(promptText: string, lastCallTurn: number): boolean {
  if (lastCallTurn !== -1) return false;
  const t = promptText.trim();
  if (!t || t.length < 8) return false;
  if (/^\s*\/(status|compact|fork|review|goal)\b/.test(t)) return false;
  return /修|改|加|增|删|重构|实现|修复|优化|迁移|升级|检查|排查|验证|测试|跑|查|看|找|列|搜|读|写|创建|新建|生成|补|画|fix|bug|implement|add|create|update|refactor|migrat|optim|check|verif|test|run|search|find|read|write|list|show|explain|分析|说明|`[^`]+`|\.[a-z0-9]{1,5}\b|[\\/][\w.\-\\/]+/i.test(t);
}

export function buildActionNudge(promptText: string): ThreadItem {
  return {
    type: "user",
    text: `You answered without using any tools, but the request looks like it needs tool action: "${promptText.slice(0, 200)}"\nDo the work now with sa_vm (read/grep/apply_patch/run_host as needed), verify with tools, then report evidence. Do not just describe what you would do.`,
  };
}

/**
 * Wrap-up trigger (root cause of the "repeats one sentence" complaint):
 * the old code returned the first text ever seen, so a turn-0 echo of the
 * request survived even when later turns only ran tools. Wrap up when there
 * is no text at all, or when tool calls happened after the last text.
 */
export function shouldWrapUp(lastText: string, lastTextTurn: number, lastCallTurn: number): boolean {
  if (!lastText.trim()) return true;
  return lastCallTurn > lastTextTurn;
}

function normEcho(s: string): string {
  return s
    .toLowerCase()
    .replace(/^[\s>#"'\-*/\\]+/, "")
    .replace(/[\s.,;:!?*"'`\-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Echo detector (covers the pure-echo case: model repeats the request and
 * makes no tool calls, so shouldWrapUp() alone would not trigger).
 * Strips a leading /command and [skill:...] tag before comparing.
 */
export function isEchoOfPrompt(promptText: string, output: string): boolean {
  const p = normEcho(
    promptText.replace(/^\s*\/[a-zA-Z][\w-]*\b/, "").replace(/^\[skill:[^\]]*\]/, ""),
  );
  const o = normEcho(output);
  if (!p || !o) return false;
  if (o === p) return true;
  if (o.length < 20 || p.length < 10) return false;
  if (o.includes(p) || p.includes(o)) return true;
  const pt = new Set(p.split(" "));
  const ot = new Set(o.split(" "));
  let inter = 0;
  for (const w of ot) if (pt.has(w)) inter++;
  const union = pt.size + ot.size - inter;
  return union > 0 && inter / union >= 0.85 && Math.min(pt.size, ot.size) >= 4;
}

/** Final no-tools turn: ground the answer in the transcript, never echo. */
export async function summarizeThread(cfg: MiniConfig, thread: ThreadItem[]): Promise<string> {
  const r = await createTurn({
    baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, effort: cfg.effort, tools: [],
    protocol: cfg.protocol ?? "responses",
    system: "Summarize what was just accomplished in this coding-agent session. Do NOT repeat the user request. Report: actions taken with file paths, tool evidence, and what remains. Keep it under 15 lines. If nothing was accomplished, say so in one line.",
    // Budget first: a long run's wrap-up used to resend the whole transcript
    // and get silently truncated mid-summary (late-stage amnesia).
    thread: ensureThreadBudget(sanitizeThread(thread)),
  });
  return r.text.trim();
}

function childStatus(c: ChildState): string {
  return c.status;
}

async function runChildLoop(cfg: MiniConfig, child: ChildState, exec: UltraToolExecutor, skills: SkillEntry[]): Promise<void> {
  const childAgentsMd = loadAgentsMd(cfg.cwd);
  const childMemory = loadMiniMemory(cfg.cwd);
  const system = `You are a mini sub-agent (task '${child.taskName}').${child.agentType ? ` Role: ${child.agentType}.` : ""} Use sa_vm (subscribed ultra native tools) and mcp__<server>__<tool> MCP tools when advertised to act, then report. Plan briefly, act, verify with tools, then report — keep working until done, do not stop after a single step. Track multi-step work with update_plan; persist durable facts with remember. read_skill is optional: load a listed skill only when the task needs its specialized guidance; do not spend a turn loading it by default. Paths are workspace-relative. End with a self-contained plain-text summary; never ask for continuation. Never repeat the task brief; report only actions taken, evidence, and results.${childAgentsMd?.trim() ? `\n\nRepo instructions (AGENTS.md, obey for files in scope):\n${childAgentsMd.trim()}` : ""}${childMemory.trim() ? `\n\n${childMemory.trim()}` : ""}`;
  const maxTurns = cfg.maxTurns ?? 12;
  setMcpWorkspaceRoots([cfg.cwd]);
  const mcpTools = await loadMcpTools().catch(() => []);
  const childTools: ToolDef[] = [...TOOLS, ...mcpTools];
  // Anti-passive guard (same class as the root loop's action nudge): a child
  // that answers with zero tool calls gets exactly one extra pass instead of
  // having a text-only echo accepted as its final report.
  let nudgeUsed = false;
  // Same responses chaining as the root loop (no full re-upload per round).
  let childChain: MiniResponsesChain = { ...EMPTY_MINI_RESPONSES_CHAIN };
  const childChained = (cfg.protocol ?? "responses") === "responses";
  for (;;) {
    let lastText = "";
    let lastTextTurn = -1;
    let lastCallTurn = -1;
    let gTurn = 0;
    for (let turn = 0; turn < maxTurns; turn++, gTurn++) {
      const safe = sanitizeThread(child.thread);
      // Same mid-turn budget as the root loop (anti-amnesia for sub-agents).
      const budgetedChild = ensureThreadBudget(safe);
      child.thread.length = 0;
      child.thread.push(...budgetedChild);
      let r;
      if (childChained) {
        const c = await createChainedTurn({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, effort: cfg.effort, system, thread: child.thread, tools: childTools, protocol: cfg.protocol ?? "responses" }, toResponsesInput(child.thread), childChain);
        r = c.result;
        childChain = c.chain;
      } else {
        r = await createTurn({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, effort: cfg.effort, system, thread: child.thread, tools: childTools, protocol: cfg.protocol ?? "responses" });
      }
      child.thread.push(...r.items);
      if (r.text.trim()) { lastText = r.text; lastTextTurn = gTurn; }
      if (!r.calls.length) break;
      lastCallTurn = gTurn;
      for (const c of r.calls) {
        try {
          const a = JSON.parse(c.args || "{}") as Record<string, any>;
          if (c.name === "image_view") {
            const viewed = await runImageViewCall(a, cfg.cwd);
            child.thread.push({ type: "function_call_output", callId: c.callId, output: viewed.output, ...(viewed.images ? { images: viewed.images } : {}) });
            continue;
          }
          let out = "";
          try {
            if (c.name === "read_skill") {
              const hit = skills.find((s) => s.name === String(a.name ?? "").toLowerCase());
              if (!hit) throw new Error(`unknown skill: ${a.name}`);
              out = await readSkillBody(hit);
            } else if (c.name === "update_plan") {
              out = applyPlanUpdate(child.thread, a);
            } else if (c.name === "remember") {
              out = appendMiniMemory(cfg.cwd, String(a.text ?? ""));
            } else if (c.name === "list_mcp_resources") {
              const listed = await listMcpResources(typeof a.server === "string" ? a.server : undefined);
              out = listed.length
                ? listed.slice(0, 100).map((r) => `- ${r.server}: ${r.uri}`).join("\n")
                : "No MCP resources available.";
            } else if (c.name === "read_mcp_resource") {
              out = await readMcpResource(
                typeof a.server === "string" ? a.server : "",
                typeof a.uri === "string" ? a.uri : "",
              );
            } else {
              // All tool calls run through PreToolUse/PostToolUse hooks
              // (MCP first-class, non-MCP via execNonMcp fallback).
              const r = await runToolWithHooks(c.name, a, c.callId, {
                cwd: cfg.cwd, model: cfg.model, sessionId: child.id, turnId: `child-${turn}`,
                execNonMcp: (n, ax, w) => exec(n, ax, w),
              });
              out = r.output;
              autoRemember(cfg.cwd, c.name, out);
            }
          } catch (e) { out = `tool error: ${e instanceof Error ? e.message : String(e)}`; }
          child.thread.push({ type: "function_call_output", callId: c.callId, output: out });
        } catch (e) {
          child.thread.push({ type: "function_call_output", callId: c.callId, output: `tool error: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
    }
    // Anti-passive: zero tool calls in this pass means the brief was not
    // worked, only talked about — nudge once (bounded) instead of filing a
    // passive text-only report. Runs before the wrap-up so no summarizer call
    // is wasted on an unworked pass.
    if (lastCallTurn === -1 && !nudgeUsed) {
      nudgeUsed = true;
      child.thread.push({
        type: "user",
        text: `You reported back without using any tools, but a sub-agent task must be worked with tools, not just described. Act now with sa_vm (read/grep/edit_file/write_file/apply_patch/run_host as needed: edit_file {path,old_text,new_text}, write_file {path,content}), verify with tools, then report only actions taken, evidence, and results.`,
      });
      continue;
    }
    // Same staleness guard as the parent loop: never report an early echo
    // when later turns only ran tools, and never report empty text.
    if (shouldWrapUp(lastText, lastTextTurn, lastCallTurn)) {
      try {
        const s = await summarizeThread(cfg, child.thread);
        if (s) {
          lastText = s;
          child.thread.push({ type: "message", text: s });
        }
      } catch { /* keep lastText */ }
    }
    child.report = lastText.trim() || "(sub-agent produced no output)";
    const next = child.pending.splice(0, child.pending.length);
    if (!next.length) {
      child.status = "completed";
      return;
    }
    child.thread.push({ type: "user", text: next.join("\n") });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Execute image_view locally; images ride alongside the text output. */
async function runImageViewCall(a: Record<string, any>, cwd: string): Promise<Pick<Extract<ThreadItem, { type: "function_call_output" }>, "output" | "images">> {
  const argErr = imageViewArgError(a);
  if (argErr) return { output: argErr };
  const viewed = await viewLocalImage({ path: a.path, size: a.size, color: a.color }, cwd);
  if (!viewed.ok || !viewed.dataUrl) return { output: viewed.text };
  return { output: viewed.text.slice(0, 2000), images: [viewed.dataUrl] };
}

export function coerceSpawnMessage(a: Record<string, any>): string {
  for (const k of ["message", "prompt", "text"]) {
    if (typeof a[k] === "string" && (a[k] as string).trim()) return (a[k] as string).trim();
  }
  const pick = (list: unknown, keys: string[]): string[] => {
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, any>;
      for (const k of keys) {
        if (typeof rec[k] === "string" && (rec[k] as string).trim()) { out.push((rec[k] as string).trim()); break; }
      }
    }
    return out;
  };
  const parts = [...pick(a.todos, ["content", "text", "step", "title"]), ...pick(a.steps, ["step", "text", "content", "title"])];
  if (!parts.length) return "";
  return `Subtask checklist from the parent agent (treat every line as part of ONE subtask brief):\n${parts.map((part, idx) => `${idx + 1}. ${part}`).join("\n")}`;
}

async function handleSubagent(
  children: Map<string, ChildState>,
  depth: number,
  name: string,
  a: Record<string, any>,
  cfg: MiniConfig,
  exec: UltraToolExecutor,
  skills: SkillEntry[],
): Promise<string> {
  if (name === "spawn_agent") {
    if (depth > 0) return "Agent depth limit reached. Solve the task yourself - sub-agents cannot spawn further.";
    const message = coerceSpawnMessage(a);
    if (!message) return "spawn_agent needs {task_name,message}: a non-empty plain-text brief describing the subtask.";
    const live = [...children.values()].filter((c) => c.status === "running").length;
    if (live >= MINI_SUBAGENT_MAX_CHILDREN) {
      return `Agent concurrency limit reached (${MINI_SUBAGENT_MAX_CHILDREN}). Wait for running agents with wait_agent or close finished ones, then retry.`;
    }
    const taskName = parseTaskName(a.task_name ?? a.taskName) ?? `task_${Math.random().toString(16).slice(2, 10)}`;
    const agentType = typeof (a.agent_type ?? a.agentType) === "string" ? String(a.agent_type ?? a.agentType).slice(0, 120) : "";
    const id = randomUUID();
    const child: ChildState = {
      id, taskName, agentType,
      thread: [{ type: "user", text: `Task brief from the parent agent:\n${message}\n\nReport back with a self-contained plain-text summary.` }],
      status: "running", report: "", pending: [], promise: null,
    };
    children.set(id, child);
    try { await fireLifecycleHook("SubagentStart", { cwd: cfg.cwd, model: cfg.model, prompt: message.slice(0, 2000), toolName: taskName }); } catch {}
    child.promise = runChildLoop(cfg, child, exec, skills).then(async () => {
      try { await fireLifecycleHook("SubagentStop", { cwd: cfg.cwd, model: cfg.model, prompt: child.report.slice(0, 2000), toolName: taskName }); } catch {}
    }, async (e) => {
      child.status = "failed";
      child.report = String((e as Error)?.message ?? e).slice(0, 2000);
      try { await fireLifecycleHook("SubagentStop", { cwd: cfg.cwd, model: cfg.model, prompt: child.report.slice(0, 2000), toolName: taskName }); } catch {}
    });
    return JSON.stringify({ agent_id: id, task_name: taskName, nickname: taskName, status: "running" });
  }
  if (name === "send_message" || name === "send_input" || name === "followup_task") {
    const target = String(a.target ?? a.id ?? "").trim();
    const child = children.get(target) ?? [...children.values()].find((c) => c.taskName === target);
    if (!child) return `send_message: unknown sub-agent '${target.slice(0, 80)}'. Use list_agents to see live agents.`;
    const message = typeof (a.message ?? a.text) === "string" ? String(a.message ?? a.text).trim() : "";
    if (!message) return `send_message needs a non-empty message.`;
    if (child.status === "running") {
      child.pending.push(message);
      return JSON.stringify({ agent_id: child.id, status: childStatus(child), queued: true });
    }
    child.thread.push({ type: "user", text: message });
    child.status = "running";
    child.promise = runChildLoop(cfg, child, exec, skills).catch((e) => {
      child.status = "failed";
      child.report = String((e as Error)?.message ?? e).slice(0, 2000);
    });
    return JSON.stringify({ agent_id: child.id, status: "running", queued: false });
  }
  if (name === "wait_agent") {
    const raw = Array.isArray(a.targets) ? a.targets : typeof a.target === "string" ? [a.target] : [];
    const ids = raw.map((t) => String(t ?? "").trim()).filter(Boolean).slice(0, MINI_SUBAGENT_MAX_CHILDREN);
    if (!ids.length) return "wait_agent needs at least one target agent_id (from spawn_agent).";
    const timeoutMs = Number.isFinite(Number(a.timeout_ms ?? a.timeoutMs))
      ? Math.min(300000, Math.max(1000, Math.floor(Number(a.timeout_ms ?? a.timeoutMs))))
      : 60000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const snapshot = ids.map((id) => {
        const child = children.get(id) ?? [...children.values()].find((c) => c.taskName === id);
        if (!child) return { agent_id: id, status: "notFound", report: "" };
        const done = child.status !== "running";
        return { agent_id: child.id, status: child.status, report: done ? child.report.slice(0, 2000) : "" };
      });
      if (snapshot.every((r) => r.status !== "running")) return JSON.stringify({ agents: snapshot, timedOut: false });
      if (Date.now() >= deadline) return JSON.stringify({ agents: snapshot, timedOut: true });
      await sleep(150);
    }
  }
  if (name === "interrupt_agent") {
    const target = String(a.target ?? a.id ?? "").trim();
    const child = children.get(target) ?? [...children.values()].find((c) => c.taskName === target);
    if (!child) return `interrupt_agent: unknown sub-agent '${target.slice(0, 80)}'.`;
    const prev = childStatus(child);
    return JSON.stringify({ agent_id: child.id, previous_status: prev, interrupted: false });
  }
  if (name === "close_agent") {
    const target = String(a.target ?? a.id ?? "").trim();
    const child = children.get(target) ?? [...children.values()].find((c) => c.taskName === target);
    if (!child) return `close_agent: unknown sub-agent '${target.slice(0, 80)}'.`;
    const prev = childStatus(child);
    const report = child.report.slice(0, 2000);
    children.delete(child.id);
    return JSON.stringify({ agent_id: child.id, previous_status: prev, report });
  }
  if (name === "list_agents") {
    return JSON.stringify({
      agents: [...children.values()].map((c) => ({ agent_id: c.id, task_name: c.taskName, agent_type: c.agentType, status: childStatus(c) })),
    });
  }
  return `unknown tool: ${name}`;
}

export async function runPrompt(cfg: MiniConfig, prompt: string, exec: UltraToolExecutor, opts?: { depth?: number; initialThread?: ThreadItem[]; threadFile?: string }): Promise<string> {
  const depth = opts?.depth ?? 0;
  const skills = await scanSkills(cfg.cwd);
  setMcpWorkspaceRoots([cfg.cwd]);
  const mcpTools = await loadMcpTools().catch(() => []);
  const mcpHint = mcpTools.length
    ? " MCP tools from ~/.codex/config.toml [mcp_servers.*] are available as mcp__<server>__<tool> - call them directly with their own JSON params."
    : "";
  const saveFile = opts?.threadFile ?? defaultThreadFile(cfg.cwd);
  const agentsMd = loadAgentsMd(cfg.cwd) ?? undefined;
  let system = buildBaseSystem(mcpHint, skills, depth, agentsMd, loadMiniMemory(cfg.cwd));
  // Auto-load transcript: previously only an explicit --resume loaded history,
  // so every plain invocation started blank (the "forgets context" complaint).
  const { thread, dropped } = loadThreadAutoWithDropped(saveFile, opts?.initialThread);
  const reviewMatch = /^\s*\/review\b([\s\S]*)$/.exec(prompt);
  if (reviewMatch) {
    // Server parity: /review runs an ordinary turn whose user text carries
    // the read-only rubric (no skill-slash expansion, like the server prompt).
    const target = parseReviewTarget((reviewMatch[1] ?? "").trim());
    system = `${system}\n${REVIEW_SYSTEM_SUFFIX}`;
    thread.push({ type: "user", text: `Review ${reviewTargetLabel(target)}\n\n${buildReviewPrompt(target)}` });
  } else if (parseGoalArgs(prompt) !== null) {
    const objective = parseGoalArgs(prompt) ?? "";
    if (!objective) return "usage: /goal <objective> — e.g. /goal fix the login redirect and verify with tests";
    system = `${system}\n${goalSystemSuffix(objective)}`;
    thread.push({ type: "user", text: `Goal: ${objective}\nWork the goal now: plan briefly, act with tools, verify with tools. Do not stop to ask questions; only stop with a lone GOAL_DONE or GOAL_BLOCKED line.` });
  } else {
    thread.push({ type: "user", text: expandSlash(prompt, skills) });
  }
  const children = new Map<string, ChildState>();
  const maxTurns = cfg.maxTurns ?? 12;
  const sessionId = randomUUID();
  const turnId = `${Date.now()}`;
  // Lifecycle: SessionStart + UserPromptSubmit (Codex parity). additionalContext
  // is surfaced to the model as a leading user note; failures are silent.
  const extraCtx: string[] = [];
  extraCtx.push(...await fireLifecycleHook("SessionStart", { cwd: cfg.cwd, model: cfg.model, sessionId, turnId }));
  extraCtx.push(...await fireLifecycleHook("UserPromptSubmit", { cwd: cfg.cwd, model: cfg.model, sessionId, turnId, prompt }));
  if (/^\s*\/status\b/.test(prompt)) {
    return [
      `mini-codex status: ok`,
      `model: ${cfg.model} (${cfg.protocol ?? "responses"})`,
      `cwd: ${cfg.cwd}`,
      `skills: ${skills.length ? skills.map((s) => s.name).join(", ") : "none"}`,
      mcpStatusLine(),
      `thread: ${thread.length} items (${thread.filter((t) => t.type === "user").length} user) from ${saveFile}`,
    ].join("\n");
  }
  // Compact-on-overflow (anti-amnesia): summarize the truncated prefix into a
  // leading [memory] item. Placed after /status so a status probe costs no
  // model call; every real agent path below sees the compacted memory.
  if (extraCtx.length) thread.push({ type: "user", text: `[hook context]\n${extraCtx.map((c) => String(c).slice(0, 2000)).join("\n---\n").slice(0, 6000)}` });
  const memoryThread = await withCompactedMemory(cfg, thread, dropped);
  // withCompactedMemory returns the SAME array when nothing was dropped;
  // clearing unconditionally would wipe the transcript (aliasing amnesia).
  if (memoryThread !== thread) {
    thread.length = 0;
    thread.push(...memoryThread);
  }
  if (/^\s*\/compact\b/.test(prompt)) {
    const r = await createTurn({
      baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, effort: cfg.effort, tools: [],
      protocol: cfg.protocol ?? "responses",
      system: "Summarize this coding-agent transcript in 10 bullet lines or less. Keep file paths, decisions, and pending work.",
      // Budget first: same late-stage truncation guard as summarizeThread.
      thread: ensureThreadBudget(sanitizeThread(thread)),
    });
    const summary = r.text.trim() || "(empty transcript)";
    // Upstream parity: compaction keeps the summary PLUS the recent tail, not
    // a summary alone (a lone summary is itself a form of amnesia — fresh
    // tool evidence and the current exchange would be lost).
    const recentTail = thread.slice(-20);
    const compacted: ThreadItem[] = [{ type: "user", text: "[compacted] " + summary }, ...recentTail];
    try { await Bun.write(saveFile, compacted.map((t) => JSON.stringify(t)).join("\n")); } catch {}
    // The transcript was replaced: the stored response id belongs to the old
    // history, so reset the chain instead of wasting one rejected round.
    try { await Bun.write(chainFileFor(saveFile), JSON.stringify({ ...EMPTY_MINI_RESPONSES_CHAIN })); } catch {}
    return `compacted into summary.`;
  }
  const forkMatch = /^\s*\/fork\b([\s\S]*)$/.exec(prompt);
  if (forkMatch) {
    // Server `thread/fork` parity at file level: duplicate the persisted
    // transcript (optionally truncated to the last N user turns) into a
    // sibling fork file, then continue it with `--resume <file>`.
    const { source, maxUserTurns } = parseForkArgs((forkMatch[1] ?? "").trim(), cfg.cwd);
    try {
      const forked = forkThreadFile(source, maxUserTurns);
      return `forked ${forked.items} items (${forked.turns} user turns) into ${forked.file}. Resume it with: mini-codex --resume "${forked.file}" <prompt>`;
    } catch (e) {
      return `fork failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  // Responses chain sidecar: lets the next CLI invocation continue the
  // server-side conversation (previous_response_id) instead of re-uploading.
  // A changed prefix (compaction, resume, goal text) fails the hash match and
  // degrades to a full send, so a stale sidecar can never corrupt the thread.
  const chainFile = chainFileFor(saveFile);
  let chain = loadChainFile(chainFile);
  const tools: ToolDef[] = [...toolsForDepth(depth), ...mcpTools];
  const tail = thread.length ? thread[thread.length - 1] : undefined;
  const currentUserText = tail && tail.type === "user" ? tail.text : prompt;
  // ranAgent gates the finally-save: control commands (/status, /compact,
  // /fork) manage their own persistence and must not pollute the transcript.
  // The finally-save also covers exceptions (e.g. network failure mid-loop),
  // which previously discarded the whole partial transcript ("lost context").
  let ranAgent = false;
  try {
    const goalObjective = parseGoalArgs(prompt);
    if (goalObjective) {
      ranAgent = true;
      const g = await runGoalMode({ cfg, thread, tools, system, children, exec, skills, sessionId, objective: goalObjective, depth, chain });
      chain = g.chain;
      return g.answer;
    }
    ranAgent = true;
    const r = await runAgentLoop({ cfg, thread, tools, system, children, exec, skills, sessionId, maxTurns, depth, chain });
    chain = r.chain;
    let lastText = r.lastText;
    let lastTextTurn = r.lastTextTurn;
    let lastCallTurn = r.lastCallTurn;
    if (needsActionNudge(currentUserText, r.lastCallTurn)) {
      // The model answered an action-like request with zero tool calls.
      // Nudge once (bounded: same maxTurns segment) instead of returning a
      // passive text answer as if the work were done.
      thread.push(buildActionNudge(currentUserText));
      try {
        const r2 = await runAgentLoop({ cfg, thread, tools, system, children, exec, skills, sessionId, maxTurns, depth, startTurn: r.turnsUsed, chain });
        if (r2.lastText.trim()) { lastText = r2.lastText; lastTextTurn = r2.lastTextTurn; }
        lastCallTurn = r2.lastCallTurn;
        chain = r2.chain;
      } catch { /* keep the first answer on nudge failure */ }
    }
    if (shouldWrapUp(lastText, lastTextTurn, lastCallTurn) || isEchoOfPrompt(currentUserText, lastText)) {
      // The model acted but never summarized, only echoed early, or echoed
      // with no tool calls at all: ground the answer instead of returning
      // a stale echo or an empty string.
      let s = "";
      try { s = await summarizeThread(cfg, thread); } catch { /* keep s empty */ }
      if (s && !isEchoOfPrompt(currentUserText, s)) {
        lastText = s;
        thread.push({ type: "message", text: s });
      } else {
        // Summarizer missing or echoing too: fall back to a tool-evidence
        // digest, which is grounded by construction and never an echo.
        const d = digestToolOutputs(thread);
        if (d) {
          lastText = d;
          thread.push({ type: "message", text: d });
        }
      }
    }
    if (!lastText.trim()) lastText = "(no output — the model produced no text; see the transcript file)";
    return lastText;
  } finally {
    if (ranAgent) {
      try { await fireLifecycleHook("Stop", { cwd: cfg.cwd, model: cfg.model, sessionId, turnId, prompt }); } catch {}
      try { await fireLifecycleHook("SessionEnd", { cwd: cfg.cwd, model: cfg.model, sessionId, turnId, prompt }); } catch {}
      try { await Bun.write(saveFile, thread.map((t) => JSON.stringify(t)).join("\n")); } catch {}
      // Persist the chain (id + hash only) so the next invocation can chain
      // instead of re-uploading; a no-id chain writes nothing.
      if (chain.prevId) {
        try { await Bun.write(chainFile, JSON.stringify(chain)); } catch {}
      }
    }
  }
}

/**
 * Grounded fallback answer: last tool calls with truncated outputs.
 * Pure evidence listing — can never be an echo of the request.
 */
export function digestToolOutputs(thread: ThreadItem[], maxCalls = 5): string {
  const names = new Map<string, string>();
  for (const it of thread) {
    if (it.type === "function_call") names.set(it.callId, it.name);
  }
  const lines: string[] = [];
  for (let i = thread.length - 1; i >= 0 && lines.length < maxCalls; i--) {
    const it = thread[i];
    if (it?.type !== "function_call_output") continue;
    const name = names.get(it.callId) ?? "tool";
    const oneLine = it.output.replace(/\s+/g, " ").trim().slice(0, 300);
    lines.push(`- ${name}: ${oneLine || "(empty output)"}`);
  }
  if (!lines.length) return "";
  lines.reverse();
  return `Actions taken (tool evidence):\n${lines.join("\n")}`;
}

/** Shared turn loop: createTurn -> execute calls -> repeat. Used by normal and /goal paths. */
export interface AgentLoopArgs {
  cfg: MiniConfig; thread: ThreadItem[]; tools: ToolDef[]; system: string;
  children: Map<string, ChildState>; exec: UltraToolExecutor; skills: SkillEntry[];
  sessionId: string; maxTurns: number; depth: number; startTurn?: number;
  /** Responses-protocol chain state (previous_response_id); absent = full sends. */
  chain?: MiniResponsesChain;
}

export interface AgentLoopResult {
  lastText: string; lastTextTurn: number; lastCallTurn: number;
  turnsUsed: number; endedWithCalls: boolean;
  /** Updated chain state for the caller to carry into the next segment/run. */
  chain: MiniResponsesChain;
}

export async function runAgentLoop(a: AgentLoopArgs): Promise<AgentLoopResult> {
  const base = a.startTurn ?? 0;
  let lastText = "";
  let lastTextTurn = -1;
  let lastCallTurn = -1;
  let turnsUsed = 0;
  let endedWithCalls = false;
  // Responses-protocol chaining (no more full re-upload every round); the
  // chat protocol has no previous_response_id and always sends full input.
  const chained = (a.cfg.protocol ?? "responses") === "responses";
  let chain: MiniResponsesChain = a.chain ?? { ...EMPTY_MINI_RESPONSES_CHAIN };
  for (let t = 0; t < a.maxTurns; t++) {
    const turn = base + t;
    turnsUsed = t + 1;
    endedWithCalls = false;
    const safeThread = sanitizeThread(a.thread);
    // Mid-turn budget (anti-amnesia): squeeze the middle into a [memory]
    // digest before every model call so the relay never silently truncates.
    const budgeted = ensureThreadBudget(safeThread);
    a.thread.length = 0;
    a.thread.push(...budgeted);
    const turnBase = { baseUrl: a.cfg.baseUrl, apiKey: a.cfg.apiKey, model: a.cfg.model, effort: a.cfg.effort, system: a.system, thread: a.thread, tools: a.tools, protocol: a.cfg.protocol ?? "responses" };
    let r;
    if (chained) {
      const c = await createChainedTurn(turnBase, toResponsesInput(a.thread), chain);
      r = c.result;
      chain = c.chain;
    } else {
      r = await createTurn(turnBase);
    }
    a.thread.push(...r.items);
    if (r.text.trim()) { lastText = r.text; lastTextTurn = turn; }
    if (!r.calls.length) break;
    lastCallTurn = turn;
    endedWithCalls = true;
    for (const c of r.calls) {
      try {
        const args = JSON.parse(c.args || "{}") as Record<string, any>;
        if (c.name === "image_view") {
          const viewed = await runImageViewCall(args, a.cfg.cwd);
          a.thread.push({ type: "function_call_output", callId: c.callId, output: viewed.output, ...(viewed.images ? { images: viewed.images } : {}) });
          continue;
        }
        let out = "";
        try {
          if (a.depth === 0 && isSubagentTool(c.name)) {
            out = await handleSubagent(a.children, a.depth, c.name, args, a.cfg, a.exec, a.skills);
          } else if (c.name === "read_skill") {
            const hit = a.skills.find((s) => s.name === String(args.name ?? "").toLowerCase());
            if (!hit) throw new Error(`unknown skill: ${args.name}`);
            out = await readSkillBody(hit);
          } else if (c.name === "update_plan") {
            out = applyPlanUpdate(a.thread, args);
          } else if (c.name === "remember") {
            out = appendMiniMemory(a.cfg.cwd, String(args.text ?? ""));
          } else if (c.name === "list_mcp_resources") {
            const listed = await listMcpResources(typeof args.server === "string" ? args.server : undefined);
            out = listed.length
              ? listed.slice(0, 100).map((x) => `- ${x.server}: ${x.uri}${x.name && x.name !== x.uri ? ` (${x.name})` : ""}${x.mimeType ? ` [${x.mimeType}]` : ""}`).join("\n")
              : "No MCP resources available. Resources come from ~/.codex/config.toml [mcp_servers.*].";
          } else if (c.name === "read_mcp_resource") {
            out = await readMcpResource(
              typeof args.server === "string" ? args.server : "",
              typeof args.uri === "string" ? args.uri : "",
            );
          } else {
            // All tool calls run through PreToolUse/PostToolUse hooks
            // (MCP first-class, non-MCP via execNonMcp fallback).
            const hr = await runToolWithHooks(c.name, args, c.callId, {
              cwd: a.cfg.cwd, model: a.cfg.model, sessionId: a.sessionId, turnId: `turn-${turn}`,
              execNonMcp: (n, ax, w) => a.exec(n, ax, w),
            });
            out = hr.output;
            autoRemember(a.cfg.cwd, c.name, out);
          }
        } catch (e) { out = `tool error: ${e instanceof Error ? e.message : String(e)}`; }
        a.thread.push({ type: "function_call_output", callId: c.callId, output: out });
      } catch (e) {
        a.thread.push({ type: "function_call_output", callId: c.callId, output: `tool error: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  }
  return { lastText, lastTextTurn, lastCallTurn, turnsUsed, endedWithCalls, chain };
}

/* ---------------- /goal driver (real loop, not a placebo) ---------------- */

/** Parse "/goal <objective>"; null when the prompt is not /goal. */
export function parseGoalArgs(prompt: string): string | null {
  const m = /^\s*\/goal\b([\s\S]*)$/.exec(prompt);
  if (!m) return null;
  return (m[1] ?? "").trim();
}

export function isGoalDone(text: string): boolean {
  const lastLine = text.trimEnd().split(/\r?\n/).at(-1) ?? "";
  return /^\s*GOAL_DONE\s*$/.test(lastLine);
}

export function isGoalBlocked(text: string): boolean {
  const lastLine = text.trimEnd().split(/\r?\n/).at(-1) ?? "";
  return /^\s*GOAL_BLOCKED\s*$/.test(lastLine);
}

/** A Goal terminal marker is accepted only after a paired tool result in this Goal run. */
export function hasGoalToolEvidence(thread: ThreadItem[], startIndex = 0): boolean {
  const calls = new Set<string>();
  for (const item of thread.slice(Math.max(0, startIndex))) {
    if (item.type === "function_call") calls.add(item.callId);
    else if (item.type === "function_call_output" && calls.has(item.callId)) return true;
  }
  return false;
}

/** Strip the protocol marker lines, keeping the evidence text. */
export function cleanGoalMarker(text: string): string {
  return text.split(/\r?\n/).filter((l) => !/^\s*GOAL_(DONE|BLOCKED)\s*$/.test(l)).join("\n").trim();
}

/** Validate the terminal response shape before honoring DONE/BLOCKED. */
export function isGoalTerminalSupported(text: string, objective: string, thread: ThreadItem[], startIndex = 0): boolean {
  const summary = cleanGoalMarker(text);
  return Boolean(summary) && !isEchoOfPrompt(objective, summary) && hasGoalToolEvidence(thread, startIndex);
}

export function goalSystemSuffix(objective: string): string {
  return `[goal mode] Objective: ${objective}\n` +
    "Rules: 1) Make a 3-7 step plan, then act with tools — do not just describe. " +
    "2) Verify every change with tools (read files back, run tests/checks, show evidence). " +
    "3) Never claim success without tool evidence. " +
    "4) When the objective is achieved AND verified, end your final message with a summary plus 1-5 evidence bullets and a last line containing only GOAL_DONE. " +
    "5) If truly blocked (missing credentials, permissions, or resources after trying alternatives), report what was tried plus evidence and end with a last line containing only GOAL_BLOCKED. " +
    "6) Never repeat the objective back as your answer. " +
    "7) Track genuinely multi-step goals with update_plan (full checklist each call, one step in_progress at a time) and persist durable decisions/preferences with remember.";
}

export interface GoalModeArgs {
  cfg: MiniConfig; thread: ThreadItem[]; tools: ToolDef[]; system: string;
  children: Map<string, ChildState>; exec: UltraToolExecutor; skills: SkillEntry[];
  sessionId: string; objective: string; depth: number;
  /** Incoming responses chain (cross-invocation restore); absent = fresh. */
  chain?: MiniResponsesChain;
}

async function runGoalMode(a: GoalModeArgs): Promise<{ answer: string; chain: MiniResponsesChain }> {
  const budget = numEnv("MINI_GOAL_MAX_TURNS", 48, 8, 200);
  const perSeg = a.cfg.maxTurns ?? 12;
  const goalStartIndex = a.thread.length;
  let used = 0;
  let answer = "";
  // Carry the responses chain across goal segments (no full re-upload).
  let goalChain: MiniResponsesChain = a.chain ?? { ...EMPTY_MINI_RESPONSES_CHAIN };
  for (;;) {
    if (used >= budget) {
      answer += `\n\n[goal] turn budget exhausted (${budget}). Objective not marked done.`;
      break;
    }
    const seg = Math.min(perSeg, budget - used);
    const r = await runAgentLoop({
      cfg: a.cfg, thread: a.thread, tools: a.tools, system: a.system,
      children: a.children, exec: a.exec, skills: a.skills,
      sessionId: a.sessionId, maxTurns: seg, depth: a.depth, startTurn: used,
      chain: goalChain,
    });
    used += r.turnsUsed;
    goalChain = r.chain;
    if (r.lastText.trim()) answer = r.lastText;
    if (isGoalDone(r.lastText) || isGoalBlocked(r.lastText)) {
      const cleaned = cleanGoalMarker(r.lastText);
      if (!isGoalTerminalSupported(r.lastText, a.objective, a.thread, goalStartIndex)) {
        // Reject empty summaries, objective echoes, and unsupported terminal
        // claims. Continue while budget remains; never accept a marker without
        // a non-echo summary and a paired tool result from this Goal run.
        if (used < budget) {
          a.thread.push({
            type: "user",
            text: `[goal] The terminal reply was an objective echo or lacked tool evidence. Objective: ${a.objective}\n` +
              "Do or verify the work with tools now, report evidence, then end with GOAL_DONE. If blocked, report attempted tools and evidence before GOAL_BLOCKED.",
          });
          continue;
        }
        const d = digestToolOutputs(a.thread);
        answer = d
          ? `${d}\n\n[goal] terminal marker rejected; objective not marked done.`
          : "[goal] terminal marker rejected; no verified summary or tool evidence. Objective not marked done.";
        break;
      }
      answer = cleaned;
      break;
    }
    if (!r.endedWithCalls) {
      // Model stopped on its own without a marker: wrap up if it never
      // summarized, then nudge it back on track while budget remains.
      if (shouldWrapUp(r.lastText, r.lastTextTurn, r.lastCallTurn)) {
        try {
          const s = await summarizeThread(a.cfg, a.thread);
          if (s) {
            answer = s;
            a.thread.push({ type: "message", text: s });
          }
        } catch { /* ignore */ }
      }
      if (used >= budget) {
        answer += `\n\n[goal] turn budget exhausted (${budget}). Objective not marked done.`;
        break;
      }
      a.thread.push({
        type: "user",
        text: `[goal] You stopped without a lone GOAL_DONE or GOAL_BLOCKED line. Objective: ${a.objective}\n` +
          "If it is achieved AND verified with tool evidence, reply with the summary + evidence and end with GOAL_DONE. " +
          "If blocked, report attempts + evidence and end with GOAL_BLOCKED. Otherwise continue working now — do not ask questions." +
          (hasGoalToolEvidence(a.thread, goalStartIndex)
            ? ""
            : " You have not used any tools yet in this goal run — start acting with sa_vm now instead of describing."),
      });
      continue;
    }
    // Segment ended while the model still had tool calls: keep going silently.
  }
  if (!answer.trim()) answer = "(goal produced no output; see the transcript file)";
  return { answer, chain: goalChain };
}
