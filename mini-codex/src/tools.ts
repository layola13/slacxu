import type { ToolDef } from "./types.ts";
import { IMAGE_VIEW_TOOL } from "./imageView.ts";

export const TOOLS: ToolDef[] = [
  {
    name: "sa_vm",
    description: "Ultra workspace tools: {action, ...flat params}, e.g. {action:\"read_file\",path:\"package.json\"}. Writes: write_file {path,content}, edit_file {path,old_text,new_text} (old_text EXACT from prior read, unique context; NEVER input/output), apply_patch {patch}. Batch independent reads/searches only: {action:\"parallel\",parallel:[{action:\"list_dir\",dir:\"src\"},{action:\"grep_search\",query:\"x\"}]} (flat subtasks, same path never twice, writes never batched with reads of same file). Paths workspace-relative. See sa-vm SKILL.md via read_skill for gated AST actions.",
    schema: {
      type: "object",
      properties: {
        action: { type: "string", description: "Native action: read_file/read_lines/list_dir/find_files/grep_search/write_file/edit_file/apply_patch/parallel/run_host/run_bun/git_status/git_diff/ensure_dir/delete_file/move_file/copy_file" },
        path: { type: "string" },
        query: { type: "string" },
        content: { type: "string" },
        old_text: { type: "string", description: "Exact existing text for edit_file" },
        new_text: { type: "string", description: "Replacement text for edit_file" },
        replaceAll: { type: "boolean" },
        patch: { type: "string" },
        diff: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        source: { type: "string" },
        dest: { type: "string" },
        dir: { type: "string" },
        command: { type: "string" },
        parallel: { type: "array", description: "Independent subtasks [{action,...flat params}] (no nesting, no same-path read/write mixing)" },
      },
      required: ["action"],
      additionalProperties: true,
    },
  },
  { name: "read_skill", description: "Load a subscribed SKILL.md by name (progressive disclosure)", schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false } },
  {
    name: "remember",
    description: "Persist one durable fact/decision/preference to the repo MEMORY.md so future runs remember it. Args {text}. Use for user preferences, project conventions, and decisions worth keeping — not for ephemeral task state.",
    schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  },
  {
    name: "update_plan",
    description: "Track genuinely multi-step work: for any task with 3+ steps you must call update_plan first with the full checklist, then update statuses as verified work progresses. Each call replaces the whole list.",
    schema: {
      type: "object",
      properties: {
        todos: { type: "array", items: { type: "object", properties: { content: { type: "string" }, status: { type: "string" } } } },
        steps: { type: "array", items: { type: "object", properties: { step: { type: "string" }, status: { type: "string" } } } },
        explanation: { type: "string" },
      },
      additionalProperties: true,
    },
  },
  IMAGE_VIEW_TOOL as ToolDef,
  {
    name: "list_mcp_resources",
    description: "List files/objects exposed by MCP servers (config.toml [mcp_servers.*]). Args {server?} - omit for all connected servers. Read one with read_mcp_resource.",
    schema: { type: "object", properties: { server: { type: "string" } }, required: [], additionalProperties: false },
  },
  {
    name: "read_mcp_resource",
    description: "Read one MCP server resource as text. Args {server, uri} (both required; discover URIs with list_mcp_resources). Binary content is described, not inlined.",
    schema: { type: "object", properties: { server: { type: "string" }, uri: { type: "string" } }, required: ["server", "uri"], additionalProperties: false },
  },
];

export const SUBAGENT_TOOLS: ToolDef[] = [
  {
    name: "spawn_agent",
    description: "Delegate an independent subtask to a sub-agent (own thread, same workspace/model). Args {task_name,message,agent_type?} - task_name AND message are BOTH required. Max 5 live children, depth limit 1.",
    schema: { type: "object", properties: { task_name: { type: "string" }, taskName: { type: "string" }, message: { type: "string" }, prompt: { type: "string" }, text: { type: "string" }, agent_type: { type: "string" }, agentType: { type: "string" } }, required: ["task_name", "message"], additionalProperties: false },
  },
  {
    name: "send_message",
    description: "Send a message to an existing sub-agent. Args {target,message}. Queued while it runs; starts a turn immediately when idle.",
    schema: { type: "object", properties: { target: { type: "string" }, id: { type: "string" }, message: { type: "string" }, text: { type: "string" } }, required: ["target", "message"], additionalProperties: false },
  },
  {
    name: "interrupt_agent",
    description: "Interrupt a sub-agent's current turn and return its previous status. Args {target}.",
    schema: { type: "object", properties: { target: { type: "string" }, id: { type: "string" } }, required: ["target"], additionalProperties: false },
  },
  {
    name: "wait_agent",
    description: "Wait for sub-agents and collect final reports. Args {targets,timeout_ms?}. Always wait before the final summary.",
    schema: { type: "object", properties: { targets: { type: "array", items: { type: "string" } }, target: { type: "string" }, timeout_ms: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "close_agent",
    description: "Close a finished sub-agent and free its slot. Args {target}.",
    schema: { type: "object", properties: { target: { type: "string" } }, required: ["target"], additionalProperties: false },
  },
  {
    name: "list_agents",
    description: "List your live sub-agents.",
    schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const SUBAGENT_NAMES = new Set(SUBAGENT_TOOLS.map((t) => t.name));

/** Retired send spellings: accepted (as send_message) but never advertised. */
const SEND_MESSAGE_ALIASES = new Set(["send_input", "followup_task"]);

export function isSubagentTool(name: string): boolean {
  return SUBAGENT_NAMES.has(name) || SEND_MESSAGE_ALIASES.has(name);
}

export function toolsForDepth(depth: number): ToolDef[] {
  if ((depth | 0) > 0) return TOOLS;
  return [...TOOLS, ...SUBAGENT_TOOLS];
}

export function parseTaskName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 64) return null;
  if (!/^[a-z0-9_]+$/.test(t)) return null;
  return t;
}
