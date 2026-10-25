import { createHash } from "node:crypto";

export const MINI_TOOL_REPEAT_LIMIT = 3;
export const MINI_TOOL_LOOP_NOTE = "Repeated tool calls returned the same results without changing the workspace. This turn has stopped tool execution. Summarize verified progress and any remaining blocker from the existing results; no further tool calls are available in this turn.";

export const MINI_SAME_FILE_READ_LIMIT = 2;
export const MINI_SAME_FILE_THRASH_NOTE =
  "Same-file read thrash detected: this file is already fully in context — STOP reading it. Your tools remain available: make the change NOW with sa_vm edit_file, write_file, or apply_patch, or summarize from the content already available. Do NOT slice-read this file again.";
/** Prefix for per-file read refusals: excluded from loop/thrash accounting, never a global budget event. */
export const MINI_REFUSED_READ_PREFIX = "blocked: same-file read refused";

export interface MiniToolRoundResult {
  name: string;
  args: Record<string, unknown>;
  output: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
}

function stableOutput(output: string): unknown {
  try {
    const value = JSON.parse(output);
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const { durationMs, saVmEvents, ...result } = value;
    return stableValue(result);
  } catch {
    return output;
  }
}

export function miniToolOutputFailed(output: string): boolean {
  try {
    const result = JSON.parse(output);
    return result?.ok === false;
  } catch {
    return /^(blocked:|denied|tool error:|error:|unknown tool:|sa_vm .*needs)/i.test(output.trim());
  }
}

export class MiniToolLoopGuard {
  private readonly repeats = new Map<string, number>();

  observeRound(results: MiniToolRoundResult[], madeProgress: boolean): boolean {
    if (madeProgress) {
      this.repeats.clear();
      return false;
    }
    const watched = results.filter(({ name }) => ["sa_vm", "read_skill", "web_search", "list_mcp_resources", "read_mcp_resource", "wait_agent"].includes(name));
    if (!watched.length) return false;
    const signatures = watched.map(({ name, args, output }) => JSON.stringify([name, stableValue(args), stableOutput(output)])).sort();
    const signature = createHash("sha256").update(JSON.stringify(signatures)).digest("hex");
    const count = (this.repeats.get(signature) ?? 0) + 1;
    this.repeats.set(signature, count);
    return count >= MINI_TOOL_REPEAT_LIMIT;
  }
}

const MINI_SAME_FILE_READ_ACTIONS = new Set([
  "read",
  "read_file",
  "vm-read",
  "vm_read",
  "read_lines",
  "read_file_tail",
  "tail",
  "tail_file",
  "count_lines",
  "line_count",
  "wc",
  "count",
  "file_info",
  "stat",
  "file_outline",
  "outline",
  "find_definition",
  "goto_definition",
]);

/** Pure metadata probes: cheap, never evidence of slice-thrash. Excluded from the guard. */
const MINI_SAME_FILE_META_ACTIONS = new Set([
  "count_lines",
  "line_count",
  "wc",
  "count",
  "file_info",
  "stat",
  "test_path",
  "file_exists",
  "exists",
]);

/** Content reads subject to same-file thrash counting (pagination-aware, see below). */
export function isMiniSameFileReadAction(action: unknown): boolean {
  if (typeof action !== "string") return false;
  const a = action.trim().toLowerCase();
  return MINI_SAME_FILE_READ_ACTIONS.has(a) && !MINI_SAME_FILE_META_ACTIONS.has(a);
}

function extractMiniReadFileKey(args: Record<string, unknown>): string | null {
  const raw = args.path ?? args.file ?? args.target ?? args.filePath ?? args.file_path ?? args.filename ?? args.fileName;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().replace(/\\/g, "/").toLowerCase();
  }
  if (Array.isArray((args as Record<string, unknown>).files)) {
    const files = (args as Record<string, unknown>).files as unknown[];
    if (files.length === 1 && typeof files[0] === "string" && (files[0] as string).trim()) {
      return (files[0] as string).trim().replace(/\\/g, "/").toLowerCase();
    }
  }
  // read_many with multiple files: count each file separately via caller expansion.
  return null;
}

export function extractMiniReadFileKeys(args: Record<string, unknown>): string[] {
  const files = (args as Record<string, unknown>).files;
  if (Array.isArray(files) && files.length > 0 && files.every((f) => typeof f === "string")) {
    return (files as string[]).map((f) => f.trim().replace(/\\/g, "/").toLowerCase()).filter(Boolean);
  }
  const single = extractMiniReadFileKey(args);
  return single ? [single] : [];
}

function extractReadWindow(args: Record<string, unknown>): { start: number | null; end: number | null } {
  const pick = (o: Record<string, unknown>, keys: string[]): number | null => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    }
    return null;
  };
  return {
    start: pick(args, ["start_line", "startLine", "offset", "from", "from_line"]),
    end: pick(args, ["end_line", "endLine", "to", "to_line"]),
  };
}

interface MiniFileReadState {
  /** Overlapping / backward re-reads: the actual thrash signal. */
  overlaps: number;
  lastStart: number | null;
  lastEnd: number | null;
}

/** Same-file thrash guard: forward-paging a long file (start_line advancing
 *  past the previous window) is normal linear reading and never counts as
 *  thrash. Only overlapping/backward re-reads of the same file increment the
 *  counter. Pure metadata probes are excluded entirely. */
export class MiniSameFileReadGuard {
  private readonly states = new Map<string, MiniFileReadState>();

  private noteRead(key: string, args: Record<string, unknown>): string | null {
    const mapKey = `sa_vm:${key}`;
    let st = this.states.get(mapKey);
    if (!st) {
      st = { overlaps: 0, lastStart: null, lastEnd: null };
      this.states.set(mapKey, st);
    }
    const w = extractReadWindow(args);
    if (
      w.start !== null && st.lastEnd !== null && w.start >= st.lastEnd - 5 &&
      (w.end === null || st.lastEnd === null || w.end >= st.lastEnd - 5)
    ) {
      // Forward pagination (e.g. 1-250 -> 250-500 -> 500-586): advance window, no penalty.
      st.lastStart = w.start;
      st.lastEnd = w.end;
      return null;
    }
    st.overlaps += 1;
    st.lastStart = w.start;
    st.lastEnd = w.end;
    if (st.overlaps > MINI_SAME_FILE_READ_LIMIT) return key;
    return null;
  }

  observeRound(results: MiniToolRoundResult[], madeProgress: boolean): string | null {
    if (madeProgress) {
      this.states.clear();
      return null;
    }
    for (const r of results) {
      if (r.name !== "sa_vm" && !r.name.includes("sa_vm") && r.name !== "sa_vm_run") continue;
      // Per-file refusals are enforcement output, not new reads: never counted.
      if (typeof r.output === "string" && r.output.startsWith(MINI_REFUSED_READ_PREFIX)) continue;
      const action = typeof (r.args as Record<string, unknown>)?.action === "string"
        ? String((r.args as Record<string, unknown>).action).trim().toLowerCase()
        : "";
      // Parallel inner calls expand to multiple file keys.
      const inner = (r.args as Record<string, unknown>)?.parallel;
      if (action === "parallel" && Array.isArray(inner)) {
        for (const t of inner as Array<Record<string, unknown>>) {
          const innerAct = typeof t?.action === "string" ? String(t.action).trim().toLowerCase() : "";
          if (!isMiniSameFileReadAction(innerAct)) continue;
          for (const key of extractMiniReadFileKeys(t)) {
            const hit = this.noteRead(key, t);
            if (hit) return hit;
          }
        }
        continue;
      }
      if (!isMiniSameFileReadAction(action)) continue;
      for (const key of extractMiniReadFileKeys(r.args as Record<string, unknown>)) {
        const hit = this.noteRead(key, r.args as Record<string, unknown>);
        if (hit) return hit;
      }
    }
    return null;
  }

  reset(): void {
    this.states.clear();
  }
}

export function isMiniTerminalRefusal(text: string): boolean {
  return /(?:i (?:cannot|can't|will not|won't|must refuse)[^.\n]{0,100}(?:jailbreak|bypass (?:safety|security)|ignore (?:my |the )?(?:system|safety))|(?:不能|无法|拒绝|不会)[^。\n]{0,60}(?:越狱|绕过安全|忽略系统指令))/i.test(text);
}
