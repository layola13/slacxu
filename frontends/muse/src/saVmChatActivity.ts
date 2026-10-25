import type { ChatWaterfallRow } from "@cxu/sdk-frontend";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseIfJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length > 32768) return value;
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function firstStringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function compactText(value: string): string | undefined {
  const compact = value.trim().split(/\r?\n/).find((line) => line.trim())?.trim();
  return compact || undefined;
}

function extractPathFromPatch(patch: string): string | undefined {
  const updateMatch = /\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*([^\r\n]+)/i.exec(patch);
  if (updateMatch?.[1]?.trim()) return updateMatch[1].trim();
  const diffMatch = /diff --git\/(.+?)\s+b\/(.+)/i.exec(patch);
  if (diffMatch?.[1]?.trim()) return diffMatch[1].trim();
  const headerMatch = /(?:---|\+\+\+)\s+[ab]\/([^\r\n]+)/.exec(patch);
  if (headerMatch?.[1]?.trim()) return headerMatch[1].trim();
  return undefined;
}

export function unwrapToolArgs(payload: Record<string, unknown>, row?: ChatWaterfallRow): Record<string, unknown> {
  const item = row?.item as Record<string, unknown> | undefined;

  let candidate: unknown = undefined;
  for (const key of [
    "arguments", "input", "parameters", "args",
    "tool_input", "toolInput", "rawInput", "tool_args", "toolArgs"
  ]) {
    if (key in payload && payload[key] !== undefined) {
      candidate = payload[key];
      break;
    }
  }
  if (candidate === undefined && item) {
    for (const key of [
      "arguments", "input", "parameters", "args",
      "tool_input", "toolInput", "rawInput", "tool_args", "toolArgs"
    ]) {
      if (key in item && item[key] !== undefined) {
        candidate = item[key];
        break;
      }
    }
  }
  if (candidate === undefined) {
    candidate = payload;
  }

  candidate = parseIfJson(candidate);

  let result: Record<string, unknown> = isRecord(candidate) ? { ...candidate } : {};

  for (const nestedKey of [
    "Arguments", "arguments", "input", "parameters", "args",
    "tool_input", "toolInput", "rawInput", "tool_args", "toolArgs"
  ]) {
    if (nestedKey in result && result[nestedKey] !== undefined) {
      const nestedParsed = parseIfJson(result[nestedKey]);
      if (isRecord(nestedParsed)) {
        result = { ...result, ...nestedParsed };
      }
    }
  }

  return result;
}

const KNOWN_SA_VM_ACTIONS = new Set([
  "read_file", "read_lines", "read_many", "read_files", "read_file_tail", "tail_file", "tail", "read", "vm-read", "vm_read", "view_file", "view",
  "write_file", "write_to_file", "write",
  "edit_file", "replace_file_content", "edit",
  "apply_patch", "patch",
  "delete_file", "remove_file", "delete", "safe_delete",
  "copy_file", "copy",
  "move_file", "move",
  "file_info", "info", "stat", "count_lines", "line_count", "wc", "count",
  "find_files", "find", "find_by_name",
  "list_dir", "list", "ls",
  "grep_search", "grep", "grep_search_async", "grep_async", "async_grep",
  "run_js", "exec_js", "run_py", "run_python", "exec_py",
  "http_fetch", "fetch", "http",
  "clear_tool_history", "prune_tool_history",
  "git_status", "git-status", "git_diff", "git-diff",
  "code_graph", "relation_graph", "symbol_graph",
  "repo_map", "repo-map", "workspace_outline", "outline_many", "project_outline",
  "verify_loop", "verify-loop", "verify_changed",
  "find_references", "find_all_references", "find_implementations", "find_impl", "implementations",
  "file_outline", "outline", "rename_symbol", "move_file_with_imports", "find_definition",
  "extract_to_file", "extract_component", "extract_hook", "atomic_refactor",
  "split_plan", "split_stage", "split_refine", "split_repair", "split_status",
  "analyze_coupling", "auto_fix_missing_imports",
  "add_import", "get_diagnostics", "workspace_diagnostics", "organize_imports", "analyze_scope",
  "run_bun", "run_project_check", "run_host", "exec_host", "host"
]);

/**
 * JEV advisory decision helpers (17 actions) are distinct from the general SA-VM broker.
 * The broker runner (sa_vm_run / jev_sa_vm_run) executes VM operations (edit_file, read_file, etc.)
 * which must format as `vm-edit`, `vm-read`, etc. with file arguments. Only genuine JEV
 * advisory decisions map to `vm-jev-*`.
 */
const KNOWN_JEV_ADVISORY_ACTIONS = new Set([
  "choose", "select", "checklist", "evaluate", "thinking", "redteam", "rank",
  "scope", "dispatch", "consistency", "done", "diagnose", "edge-cases",
  "blast-radius", "intent", "next", "compress", "progress", "memory"
]);

const JEV_ACTION_RE = /^jev[_-]([a-z0-9][a-z0-9_-]*)$/i;

function jevActionKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const match = JEV_ACTION_RE.exec(trimmed);
  if (!match?.[1]) return undefined;
  const key = match[1].replace(/_/g, "-").toLowerCase();
  // Runner tools like `jev_sa_vm_run` are SA-VM brokers, never JEV advisory actions
  if (
    key === "sa-vm-run" ||
    key === "savm-run" ||
    key === "sa-vm" ||
    key === "savm" ||
    key === "vm-run" ||
    key === "run"
  ) {
    return undefined;
  }
  // Standard SA-VM actions prefixed with jev (e.g. jev_edit_file) are not JEV advisory actions
  if (KNOWN_SA_VM_ACTIONS.has(match[1].toLowerCase()) || KNOWN_SA_VM_ACTIONS.has(key)) {
    return undefined;
  }
  return KNOWN_JEV_ADVISORY_ACTIONS.has(key) ? key : undefined;
}

function isMcpInvocation(rawName: string, itemType: string | undefined, args: Record<string, unknown>): boolean {
  const lowerName = rawName.toLowerCase();
  if (lowerName.includes("mcp")) return true;
  if (itemType && itemType.toLowerCase().includes("mcp")) return true;
  const server = firstStringValue(args, ["ServerName", "serverName", "server", "server_name"]);
  if (server) return true;
  const tool = firstStringValue(args, ["ToolName", "toolName", "tool_name", "tool"]);
  if (tool) {
    const lowerTool = tool.toLowerCase();
    if (lowerTool.includes("mcp") || lowerTool.includes("sa-vm") || lowerTool.includes("savm")) return true;
    if (lowerName.includes("call") || lowerName.includes("tool") || lowerName === "use_tool") return true;
  }
  if (args.type === "MCP" || (typeof args.rawOutput === "object" && (args.rawOutput as any)?.type === "MCP")) return true;
  return false;
}

export function isSaVmToolPayload(payload: Record<string, unknown>, row: ChatWaterfallRow): boolean {
  const item = row.item as Record<string, unknown> | undefined;
  const raw = firstStringValue(payload, ["tool", "name", "method", "namespace", "title"])
    ?? (item ? firstStringValue(item, ["tool", "name", "toolName", "method", "title"]) : undefined)
    ?? row.title;
  if (!raw) return false;
  const lower = raw.toLowerCase();

  if (jevActionKey(raw)) return true;

  if (
    lower === "sa_vm_run" ||
    lower.includes("sa_vm") ||
    lower.includes("sa-vm") ||
    lower.includes("savm") ||
    lower === "vmrun" ||
    lower === "vm_run"
  ) {
    return true;
  }

  const itemType = (typeof item?.type === "string" ? item.type : "").toLowerCase();
  if (lower.includes("mcp") || itemType.includes("mcp")) {
    return true;
  }

  const args = unwrapToolArgs(payload, row);
  const server = firstStringValue(args, ["ServerName", "serverName", "server", "server_name"])?.toLowerCase();
  if (server === "sa-vm" || server === "savm" || server === "jev") {
    return true;
  }
  const toolName = firstStringValue(args, ["ToolName", "toolName", "tool_name", "tool"])?.toLowerCase();
  if (jevActionKey(toolName)) return true;
  if (
    toolName === "sa_vm_run" ||
    toolName === "savm" ||
    toolName?.includes("sa-vm") ||
    toolName?.includes("sa_vm") ||
    toolName?.includes("savm")
  ) {
    return true;
  }

  const action = typeof args.action === "string" ? args.action.trim().toLowerCase() : "";
  if (jevActionKey(action)) return true;
  if (action && (lower.includes("tool") || lower === "use_tool" || KNOWN_SA_VM_ACTIONS.has(action))) {
    return true;
  }

  return false;
}

export function saVmToolActivity(
  payload: Record<string, unknown>,
  row: ChatWaterfallRow,
  fallbackDetail?: string
): { label: string; detail?: string } {
  const item = row.item as Record<string, unknown> | undefined;
  const args = unwrapToolArgs(payload, row);

  const rawName = firstStringValue(payload, ["tool", "name", "method", "namespace"])
    ?? (item ? firstStringValue(item, ["tool", "name", "toolName", "method"]) : undefined)
    ?? row.title
    ?? "";
  const itemType = typeof item?.type === "string" ? item.type : undefined;

  const isMcp = isMcpInvocation(rawName, itemType, args);
  const jev = jevActionKey(args.action)
    ?? jevActionKey(firstStringValue(args, ["ToolName", "toolName", "tool_name", "tool"]))
    ?? jevActionKey(rawName);
  const isDirectVmRunner = rawName.includes("sa_vm") || rawName.includes("sa-vm") || rawName.includes("savm");
  const prefix = jev ? "vm-jev-" : (isMcp && !isDirectVmRunner ? "mcptool-" : "vm-");

  const rawAction = typeof args.action === "string" && args.action.trim()
    ? args.action.trim().toLowerCase()
    : (typeof args.ToolName === "string" && !args.ToolName.toLowerCase().includes("sa_vm_run")
        ? args.ToolName.trim().toLowerCase()
        : (typeof args.tool === "string" && !args.tool.toLowerCase().includes("sa_vm_run")
            ? args.tool.trim().toLowerCase()
            : (typeof args.tool_name === "string" && !args.tool_name.toLowerCase().includes("sa_vm_run")
                ? args.tool_name.trim().toLowerCase()
                : (!rawName.toLowerCase().includes("sa_vm") && !rawName.toLowerCase().includes("sa-vm") && !rawName.toLowerCase().includes("call_mcp_tool")
                    ? rawName.trim().toLowerCase()
                    : ""))));
  const action = rawAction;
  const language = typeof args.language === "string" ? args.language.trim().toLowerCase() : "";

  let actionKey = "run";
  if (action === "read_file" || action === "read_lines" || action === "read_file_tail" || action === "tail_file" || action === "tail" || action === "read" || action === "vm-read" || action === "vm_read" || action === "view_file" || action === "view") {
    actionKey = "read";
  } else if (action === "write_file" || action === "write_to_file" || action === "write") {
    actionKey = "write";
  } else if (action === "edit_file" || action === "replace_file_content" || action === "edit") {
    actionKey = "edit";
  } else if (action === "apply_patch" || action === "patch") {
    actionKey = "patch";
  } else if (action === "delete_file" || action === "remove_file" || action === "delete") {
    actionKey = "delete";
  } else if (action === "copy_file" || action === "copy") {
    actionKey = "copy";
  } else if (action === "move_file" || action === "move") {
    actionKey = "move";
  } else if (action === "file_info" || action === "info" || action === "stat" || action === "count_lines" || action === "line_count" || action === "wc" || action === "count") {
    actionKey = "info";
  } else if (action === "find_files" || action === "find" || action === "find_by_name") {
    actionKey = "find";
  } else if (action === "list_dir" || action === "list" || action === "ls") {
    actionKey = "list";
  } else if (action === "grep_search" || action === "grep") {
    actionKey = "grep";
  } else if (action === "grep_search_async" || action === "grep_async" || action === "async_grep") {
    actionKey = "grep-async";
  } else if (action === "run_js" || action === "exec_js" || language === "js" || language === "javascript") {
    actionKey = "js";
  } else if (action === "run_py" || action === "run_python" || action === "exec_py" || language === "py" || language === "python") {
    actionKey = "py";
  } else if (action === "http_fetch" || action === "fetch" || action === "http") {
    actionKey = "http";
  } else if (action === "clear_tool_history" || action === "prune_tool_history") {
    actionKey = "clear-history";
  } else if (action === "find_references" || action === "find_all_references" || action === "find_implementations" || action === "find_impl" || action === "implementations") {
    actionKey = "references";
  } else if (action === "code_graph" || action === "relation_graph" || action === "symbol_graph") {
    actionKey = "code-graph";
  } else if (action === "repo_map" || action === "repo-map") {
    actionKey = "repo-map";
  } else if (action === "workspace_outline" || action === "outline_many" || action === "project_outline") {
    actionKey = "workspace-outline";
  } else if (action === "verify_loop" || action === "verify-loop" || action === "verify_changed") {
    actionKey = "verify-loop";
  } else if (action === "git_status" || action === "git-status") {
    actionKey = "git-status";
  } else if (action === "git_diff" || action === "git-diff") {
    actionKey = "git-diff";
  } else if (action === "read_many" || action === "read_files") {
    actionKey = "read-many";
  } else if (action === "file_outline" || action === "outline") {
    actionKey = "file-outline";
  } else if (action === "rename_symbol") {
    actionKey = "rename-symbol";
  } else if (action === "move_file_with_imports") {
    actionKey = "move-file-with-imports";
  } else if (action === "find_definition") {
    actionKey = "find-definition";
  } else if (action === "extract_to_file") {
    actionKey = "extract-to-file";
  } else if (action === "add_import") {
    actionKey = "add-import";
  } else if (action === "get_diagnostics") {
    actionKey = "diagnostics";
  } else if (action === "organize_imports") {
    actionKey = "organize-imports";
  } else if (action === "analyze_scope") {
    actionKey = "analyze-scope";
  } else if (action === "run_bun") {
    actionKey = "bun";
  } else if (action === "run_project_check") {
    actionKey = "project-check";
  } else if (action === "run_host" || action === "exec_host" || action === "host") {
    actionKey = "host";
  } else if (action) {
    const cleanAction = action.replace(/^run_|^exec_|_file$/, "").replace(/_/g, "-");
    actionKey = cleanAction;
  } else if (language === "sla") {
    actionKey = "sla";
  }

  const label = `${prefix}${jev ?? actionKey}`;

  if (jev) {
    return { label, detail: jevActivityDetail(jev, args) ?? fallbackDetail };
  }

  const path = firstStringValue(args, [
    "path", "filePath", "file", "TargetFile", "targetFile",
    "AbsolutePath", "absolutePath", "filename", "fileName", "target"
  ]) ?? (action === "apply_patch" && typeof args.patch === "string" ? extractPathFromPatch(args.patch) : undefined);
  const dir = firstStringValue(args, ["dir", "directory", "folder", "cwd", "SearchDirectory", "DirectoryPath", "SearchPath"]);
  const destination = firstStringValue(args, ["destination", "dest", "to"]);
  const source = firstStringValue(args, ["source", "from"]);

  let detail: string | undefined;
  // Windowed reads: read_lines always pages, while read/read_file/vm-read/
  // vm_read/view accept an optional window (start_line/end_line/offset).
  // Render the window whenever explicitly given so paged reads of one file
  // are distinguishable (e.g. index.html:1-250 vs index.html:250-500).
  if (action === "read_lines" || action === "read" || action === "read_file" || action === "vm-read" || action === "vm_read" || action === "view_file" || action === "view") {
    const startRaw = args.start_line ?? args.startLine ?? args.offset ?? null;
    const endRaw = args.end_line ?? args.endLine ?? null;
    const start = startRaw !== null && startRaw !== undefined && String(startRaw).trim() !== "" ? String(startRaw).trim() : null;
    const end = endRaw !== null && endRaw !== undefined && String(endRaw).trim() !== "" ? String(endRaw).trim() : null;
    if (action === "read_lines") {
      detail = path ? `${path}:${start ?? 1}${end ? `-${end}` : ""}` : undefined;
    } else if (start !== null || end !== null) {
      detail = path ? `${path}:${start ?? ""}${end ? `-${end}` : ""}` : undefined;
    } else if (args.tail === true || (typeof args.lines === "number" && args.lines < 0)) {
      const tailN = typeof args.lines === "number" ? Math.abs(Math.floor(args.lines)) : 100;
      detail = path ? `${path} (tail ${tailN} lines)` : `tail ${tailN} lines`;
    } else if (typeof args.max_lines === "number" && args.max_lines > 0) {
      detail = path ? `${path} (first ${Math.floor(args.max_lines)} lines)` : `first ${Math.floor(args.max_lines)} lines`;
    } else if (path) {
      detail = path;
    }
  } else if (action === "read_file_tail" || action === "tail_file" || action === "tail") {
    const lines = args.lines ?? 100;
    detail = path ? `${path} (tail ${lines} lines)` : `tail ${lines} lines`;
  } else if (action === "copy_file" || action === "move_file" || action === "move_file_with_imports") {
    const fromPath = source ?? path;
    const toPath = destination ?? (typeof args.to === "string" ? args.to : undefined);
    detail = fromPath && toPath ? `${fromPath} -> ${toPath}` : (fromPath ?? toPath);
  } else if (action === "extract_to_file") {
    const fromPath = source ?? path;
    const toPath = destination ?? (typeof args.target === "string" ? args.target : undefined);
    detail = fromPath && toPath ? `${fromPath} -> ${toPath}` : (fromPath ?? toPath);
  } else if (action === "rename_symbol") {
    const oldName = firstStringValue(args, ["old_name", "oldName", "symbol"]);
    const newName = firstStringValue(args, ["new_name", "newName"]);
    detail = oldName && newName ? `${oldName} -> ${newName}` : (oldName ?? newName);
  } else if (action === "find_files" || action === "find_by_name") {
    const pattern = firstStringValue(args, ["pattern", "glob"]) ?? "*";
    detail = dir ? `${pattern} in ${dir}` : pattern;
  } else if (action === "list_dir") {
    detail = dir ?? path ?? ".";
  } else if (action === "grep_search" || action === "grep_search_async" || action === "grep_async" || action === "async_grep" || action === "grep") {
    const query = Array.isArray(args.queries) ? args.queries.join(", ") : firstStringValue(args, ["query", "pattern", "search"]);
    detail = query && dir ? `"${query}" in ${dir}` : (query ?? dir);
  } else if (action === "find_definition") {
    const symbol = firstStringValue(args, ["symbol", "query"]);
    detail = symbol && path ? `${symbol} in ${path}` : (symbol ?? path);
  } else if (action === "add_import") {
    const stmt = firstStringValue(args, ["statement", "import_statement"]);
    detail = stmt && path ? `${stmt} in ${path}` : (stmt ?? path);
  } else if (action === "analyze_scope") {
    const comp = firstStringValue(args, ["component_name", "componentName"]);
    detail = comp && path ? `${comp} in ${path}` : (comp ?? path);
  } else if (action === "run_project_check") {
    detail = firstStringValue(args, ["profile"]);
  } else if (action === "run_bun") {
    detail = firstStringValue(args, ["subcommand", "cmd"]);
  } else if (action === "run_host" || action === "exec_host" || action === "host") {
    const exe = firstStringValue(args, ["exe", "command", "binary"]) ?? "host";
    const hostArgs = Array.isArray(args.args) ? (args.args as unknown[]).map(String).join(" ") : "";
    detail = hostArgs ? `${exe} ${hostArgs}` : exe;
  } else if (action === "http_fetch") {
    detail = firstStringValue(args, ["url", "uri", "endpoint"]);
  } else if (action === "clear_tool_history" || action === "prune_tool_history") {
    const keep = args.keep_last_n_turns ?? 2;
    detail = `keep last ${keep} turns`;
  } else if (action === "find_references" || action === "find_all_references" || action === "find_implementations" || action === "find_impl" || action === "implementations") {
    const symbol = firstStringValue(args, ["symbol", "query"]);
    detail = symbol ? (dir ? `${symbol} in ${dir}` : symbol) : undefined;
  } else if (action === "code_graph" || action === "relation_graph" || action === "symbol_graph") {
    const target = firstStringValue(args, ["target", "symbol", "path", "file"]);
    const mode = firstStringValue(args, ["mode"]);
    detail = target && mode ? `${target} (${mode})` : (target ?? mode);
  } else if (action === "repo_map" || action === "repo-map" || action === "workspace_outline" || action === "outline_many" || action === "project_outline") {
    detail = dir ?? path ?? ".";
  } else if (action === "verify_loop" || action === "verify-loop" || action === "verify_changed") {
    const files = Array.isArray(args.files) ? (args.files as unknown[]).map(String).join(", ") : undefined;
    detail = files ?? dir ?? path;
  } else if (action === "git_diff" || action === "git-diff") {
    const sub = (args as Record<string, unknown>).stat_only === true ? "stat" : ((args as Record<string, unknown>).staged === true ? "staged" : undefined);
    const scope = path ?? firstStringValue(args, ["pathspec"]);
    detail = scope && sub ? `${scope} (${sub})` : (scope ?? sub);
  } else if (action === "git_status" || action === "git-status") {
    detail = dir ?? undefined;
  } else if (action === "read_many" || action === "read_files") {
    const files = Array.isArray(args.files) ? (args.files as unknown[]).map(String).join(", ") : undefined;
    detail = files;
  } else if (path) {
    detail = path;
  } else {
    const rawContent = firstStringValue(args, ["source", "content", "code"]);
    detail = rawContent ? compactText(rawContent) : undefined;
  }

  return { label, detail: detail ?? fallbackDetail };
}

function jevActivityDetail(action: string, args: Record<string, unknown>): string | undefined {
  const question = firstStringValue(args, ["question", "target", "task", "goal", "problem", "context"]);
  if (question) return compactText(question);

  if (action === "checklist") {
    const checks = Array.isArray(args.checks) ? args.checks.length : 0;
    return checks > 0 ? `${checks} checks` : undefined;
  }
  if (action === "evaluate") {
    const questions = args.questions;
    if (isRecord(questions)) return `${Object.keys(questions).length} questions`;
    if (Array.isArray(questions)) return `${questions.length} questions`;
  }
  if (action === "rank") {
    const items = args.items;
    if (Array.isArray(items)) return `${items.length} items`;
  }
  return firstStringValue(args, ["action", "reason", "summary"]);
}
