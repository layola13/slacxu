import { join } from "node:path";
import { agentRuntimeThreadConfig, createDefaultSaVmPolicyConfig, parseAgentRuntimeOverride, permissionToTurnOverrides, type AgentRuntimeOverride, type CliBackend, type JsonValue, type PermissionPresetId, type SaVmPolicyConfig } from "@codex-ui/shared";

export const WORKBENCH_CONTROL_NOTIFICATION = "workbench/control/updated";
export const WORKBENCH_LAYOUT_PRESETS = ["columns", "rows", "left-one-right-two", "left-two-right-one", "grid-2x2", "grid-2x3"] as const;
export type WorkbenchLayoutPreset = typeof WORKBENCH_LAYOUT_PRESETS[number];

export type WorkbenchRuntime = {
  threadId: string;
  providerId: string | null;
  groupId: string | null;
  model: string;
  reasoningEffort: string;
  permission: PermissionPresetId;
  agents: AgentRuntimeOverride;
  cliBackend: CliBackend;
  vmEnabled: boolean;
  vmPolicy?: SaVmPolicyConfig;
};

export function saVmDeveloperInstructions(policy?: SaVmPolicyConfig, cwd = process.cwd(), threadSkillPath?: string, cliBackend?: CliBackend): string {
  const relSkill = cliBackend === "claude"
    ? join(".claude", "skills", "sa-vm", "SKILL.md")
    : cliBackend === "agy"
      ? join(".gemini", "skills", "sa-vm", "SKILL.md")
      : cliBackend === "grok"
        ? join(".grok", "skills", "sa-vm", "SKILL.md")
        : cliBackend === "pi"
          ? join(".pi", "skills", "sa-vm", "SKILL.md")
          : cliBackend === "opencode" || cliBackend === "opencode-v2"
          ? join(".opencode", "skills", "sa-vm", "SKILL.md")
          : cliBackend === "muse"
            ? join(".muse", "skills", "sa-vm", "SKILL.md")
            : join(".codex", "skills", "sa-vm", "SKILL.md");
  const localSkill = threadSkillPath ?? join(cwd, relSkill);
  const normSkill = localSkill.replace(/\\/g, "/");

  const tools = policy?.tools;
  const replaceRead = tools?.replaceRead === true;
  const replaceApplyPatch = tools?.replaceApplyPatch === true;
  const replaceExec = tools?.replaceExec === true;

  const readGuide = replaceRead
    ? "READING FILES: System read tools are replaced with packaged tools. You MUST read files using sa_vm_run with action: 'read_file' or 'read_lines'. DO NOT write raw inline script code."
    : "READING FILES: System read tools are enabled. You may use system tools or safe read commands to inspect files, read skills, and browse the workspace.";

  const patchGuide = replaceApplyPatch
    ? "PATCHING FILES: apply_patch is handled by broker with strict per-path checking and backup."
    : "PATCHING FILES: System native apply_patch is enabled.";

  const execGuide = replaceExec
    ? "CRITICAL: Host shell, terminal, bash, PowerShell, cmd commands are strictly managed. You MUST use the packaged sa_vm_run tool with action shortcuts (e.g. action: 'find_files', 'read_file', 'write_file', 'edit_file', 'grep_search', 'apply_patch'). DO NOT write raw inline script code."
    : "CRITICAL: Host shell, terminal, Python, Node, and Bun command execution is disabled in SA-VM mode and cannot bypass the sandbox. All operations must use the packaged sa_vm_run function tools.";

  const optionalGuides: string[] = [];
  let nextIdx = 14;
  if (policy?.tools?.findReferences !== false) {
    optionalGuides.push(`${nextIdx++}. High-precision symbol references search:\n    sa_vm_run({ "action": "find_references", "symbol": "targetSymbol" })`);
  }
  if (policy?.tools?.fileOutline !== false) {
    optionalGuides.push(`${nextIdx++}. Extract file outline (structural declarations & line ranges):\n    sa_vm_run({ "action": "file_outline", "path": "path/to/file.ext" })`);
  }
  if (policy?.tools?.renameSymbol === true) {
    optionalGuides.push(`${nextIdx++}. Safe symbol rename (AST-aware, skipping comments/strings):\n    sa_vm_run({ "action": "rename_symbol", "symbol": "OldName", "new_name": "NewName" })`);
  }
  if (policy?.tools?.moveWithImports === true) {
    optionalGuides.push(`${nextIdx++}. Move file and rewrite relative import paths:\n    sa_vm_run({ "action": "move_file_with_imports", "from": "old/path.ts", "to": "new/path.ts" })`);
  }
  if (policy?.tools?.findDefinition !== false) {
    optionalGuides.push(`${nextIdx++}. Find symbol definition & implementation without reading whole file:\n    sa_vm_run({ "action": "find_definition", "symbol": "targetSymbol", "path": "path/to/file.ext" })`);
  }
  if (policy?.tools?.extractToFile === true) {
    optionalGuides.push(`${nextIdx++}. Extract lines to new file and rewrite import in source:\n    sa_vm_run({ "action": "extract_to_file", "source": "App.tsx", "target": "components/Modal.tsx", "start_line": 100, "end_line": 150 })`);
  }
  if (policy?.tools?.addImport === true) {
    optionalGuides.push(`${nextIdx++}. Add import statement or merge into existing module import:\n    sa_vm_run({ "action": "add_import", "path": "src/App.tsx", "statement": "import { t } from './i18n';" })`);
  }
  if (policy?.tools?.getDiagnostics === true) {
    optionalGuides.push(`${nextIdx++}. Instant single-file syntax error check:\n    sa_vm_run({ "action": "get_diagnostics", "path": "src/App.tsx" })`);
  }
  if (policy?.tools?.organizeImports === true) {
    optionalGuides.push(`${nextIdx++}. Organize & clean unused imports:\n    sa_vm_run({ "action": "organize_imports", "path": "src/App.tsx" })`);
  }
  if (policy?.tools?.analyzeScope === true) {
    optionalGuides.push(`${nextIdx++}. Analyze component scope, props, & closure bindings for refactoring:\n    sa_vm_run({ "action": "analyze_scope", "path": "src/App.tsx", "start_line": 200, "end_line": 350, "component_name": "ExtractedChild" })`);
  }
  if (policy?.tools?.codeGraph !== false) {
    optionalGuides.push(`${nextIdx++}. Architecture topology & call chain in one shot (replaces repeated grep/read loops; DOT is just compact text output):\n    sa_vm_run({ "action": "code_graph", "target": "ClassName", "mode": "symbol_hierarchy", "depth": 2, "format": "dot" })\n    IRON RULE: to clarify class inheritance, multi-module import network, or cross-function call flow, MUST prefer code_graph once over looping grep_search + read_file to piece it together.`);
  }
  if (policy?.execution?.javascript === true) {
    optionalGuides.push(`${nextIdx++}. Run JavaScript (when enabled):\n    sa_vm_run({ "action": "run_js", "content": "console.log('hello');" })`);
  }
  if (policy?.execution?.python === true) {
    optionalGuides.push(`${nextIdx++}. Run Python (when enabled):\n    sa_vm_run({ "action": "run_py", "content": "print('hello')" })`);
  }
  if (policy?.http?.allow && policy.http.allow.length > 0) {
    optionalGuides.push(`${nextIdx++}. HTTP fetch (when enabled):\n    sa_vm_run({ "action": "http_fetch", "url": "https://example.com/api" })`);
  }
  const bunProfiles = policy?.process?.bunProfiles ?? [];
  if (bunProfiles.length > 0) {
    optionalGuides.push(`${nextIdx++}. Project validation & check profiles (when enabled):\n    sa_vm_run({ "action": "run_project_check", "profile": "${bunProfiles[0]}" })`);
  }
  const optionalGuideBlock = optionalGuides.length > 0 ? `\n${optionalGuides.join("\n")}` : "";

  const agyGuide = (cliBackend === "agy" || cliBackend === "grok")
    ? `============================================================
[CRITICAL FOR ${cliBackend === "grok" ? "GROK" : "AGY / ANTIGRAVITY"} AGENT]:
- You are running under SA-VM mode.
- Direct host command execution (run_command, run_terminal_command, PowerShell, pwsh, cmd, bash) is strictly disabled.
- Native host file tools (view_file, write_to_file, replace_file_content, search_replace) are disabled.
- You MUST execute all workspace inspection, file reading/writing, AST refactoring, and code operations via the "sa-vm" MCP tool:
  call_mcp_tool({ ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "<action_name>", ... } })
  or direct sa_vm_run({ action: "<action_name>", ... }).
============================================================\n\n`
    : "";

  const opencodeGuide = cliBackend === "opencode" || cliBackend === "opencode-v2"
    ? `============================================================
[CRITICAL FOR OPENCODE AGENT]:
- You are running under SA-VM mode. The "sa-vm" MCP server is attached to this session (stdio, see Skill guide below).
- Prefer the MCP tool "sa-vm" / sa-vm_sa_vm_run({ action: "<action_name>", ... }) for all workspace inspection, file reading/writing, AST refactoring, and code operations; direct sa_vm_run({ action: "<action_name>", ... }) is an accepted alias.
- Do NOT run raw host shell commands (bash, PowerShell, pwsh, cmd) or native file writes for operations the MCP actions cover.
============================================================\n\n`
    : "";

  const claudeGuide = cliBackend === "claude"
    ? `============================================================
[CRITICAL FOR CLAUDE CODE AGENT]:
- You are running under SA-VM mode. The "sa-vm" MCP server is attached to this session (see Skill guide below).
- You MUST execute all workspace inspection, file reading/writing, AST refactoring, and code operations via the "sa-vm" MCP server's sa_vm_run tool. Advisory actions (jev_choose, jev_checklist, jev_thinking, jev_redteam, jev_rank, jev_scope, jev_consistency, jev_done, jev_diagnose, jev_edge_cases, jev_blast_radius, jev_intent, jev_next) ride the same tool via the action field.
- Do NOT run raw host shell commands (bash, PowerShell, pwsh, cmd) for operations the MCP actions cover.
============================================================\n\n`
    : "";

  return `${agyGuide}${opencodeGuide}${claudeGuide}Packaged function tools are active for this conversation. Skill guide: ${normSkill}.
${execGuide}
${readGuide}
${patchGuide}

============================================================
PRIMARY INSTRUCTION: DO NOT WRITE RAW INLINE SCRIPT CODE.
DO NOT pass raw source code; hand-written TypeScript runs only through the bun track when policy allows it.
ALWAYS call sa_vm_run using packaged action tools:
1. Apply unified diff patch (multi-file add/edit/delete/rename):
   sa_vm_run({ "action": "apply_patch", "patch": "*** Begin Patch\\n..." })
2. Edit / replace text in file:
   sa_vm_run({ "action": "edit_file", "path": "path/to/file.ext", "old_text": "old", "new_text": "new" })
3. Write / create file:
   sa_vm_run({ "action": "write_file", "path": "path/to/file.ext", "content": "contents" })
4. Read file contents (dynamic context headroom & minified code protection):
   sa_vm_run({ "action": "read_file", "path": "${normSkill}", "max_tokens": 4000 })
5. Read line range / paginate:
   sa_vm_run({ "action": "read_lines", "path": "src/main.ts", "start_line": 1, "end_line": 100, "max_tokens": 4000 })
6. Read minified 1-line JS chunk (prevent context overflow):
   sa_vm_run({ "action": "read_file", "path": "dist/bundle.min.js", "offset": 0, "max_tokens": 3000 })
7. Find files / glob search:
   sa_vm_run({ "action": "find_files", "dir": ".", "pattern": "*" })
8. List directory entries:
   sa_vm_run({ "action": "list_dir", "dir": "." })
9. Grep search text in files (supports regex e.g. 'a|b|c', single file or directory, replaces Select-String):
   sa_vm_run({ "action": "grep_search", "query": "keyword|pattern", "dir": "." })
10. Delete file safely (with backup):
    sa_vm_run({ "action": "delete_file", "path": "path/to/file.ext" })
11. Move / rename file:
    sa_vm_run({ "action": "move_file", "from": "old/path", "to": "new/path" })
12. Copy file:
    sa_vm_run({ "action": "copy_file", "from": "source/path", "to": "dest/path" })
13. Get file info / metadata / line count:
    sa_vm_run({ "action": "file_info", "path": "path/to/file.ext" })
14. Count total lines:
    sa_vm_run({ "action": "count_lines", "path": "path/to/file.ext" })${optionalGuideBlock}
============================================================
All filesystem, network, environment, and process operations must stay within this thread's policy; out-of-policy requests are denied.`;
}

export function saVmDynamicToolSpec(policy?: SaVmPolicyConfig): JsonValue {
  const allowJs = policy?.execution?.javascript === true;
  const allowPy = policy?.execution?.python === true;
  const allowHttp = policy !== undefined ? Boolean(policy?.http?.allow && policy.http.allow.length > 0) : true;
  const allowClearHistory = policy?.tools?.clearToolHistory === true;
  const allowFindReferences = policy?.tools?.findReferences !== false;
  const allowRenameSymbol = policy?.tools?.renameSymbol === true;
  const allowFileOutline = policy?.tools?.fileOutline !== false;
  const allowMoveWithImports = policy?.tools?.moveWithImports === true;
  const allowFindDefinition = policy?.tools?.findDefinition !== false;
  const allowExtractToFile = policy?.tools?.extractToFile === true;
  const allowAddImport = policy?.tools?.addImport === true;
  const allowGetDiagnostics = policy?.tools?.getDiagnostics === true;
  const allowOrganizeImports = policy?.tools?.organizeImports === true;
  const allowAnalyzeScope = policy?.tools?.analyzeScope === true;
  const allowCodeGraph = policy?.tools?.codeGraph !== false;
  const allowJevChoose = policy?.tools?.jevChoose === true;
  const allowJevChecklist = policy?.tools?.jevChecklist === true;
  const allowJevEvaluate = policy?.tools?.jevEvaluate === true;
  const allowJevThinking = policy?.tools?.jevThinking === true;
  const allowJevRedteam = policy?.tools?.jevRedteam === true;
  const allowJevRank = policy?.tools?.jevRank === true;
  const allowJevScope = policy?.tools?.jevScope === true;
  const allowJevDispatch = policy?.tools?.jevDispatch === true;
  const allowJevConsistency = policy?.tools?.jevConsistency === true;
  const allowJevDone = policy?.tools?.jevDone === true;
  const allowJevDiagnose = policy?.tools?.jevDiagnose === true;
  const allowJevEdgeCases = policy?.tools?.jevEdgeCases === true;
  const allowJevBlastRadius = policy?.tools?.jevBlastRadius === true;
  const allowJevIntent = policy?.tools?.jevIntent === true;
  const allowJevNext = policy?.tools?.jevNext === true;
  const allowJevCompress = policy?.tools?.jevCompress === true;
  const allowJevProgress = policy?.tools?.jevProgress === true;

  const actions = [
    "apply_patch",
    "edit_file",
    "write_file",
    "read_file",
    "read_lines",
    "read_many",
    "read_file_tail",
    "count_lines",
    "find_files",
    "list_dir",
    "grep_search",
    "grep_search_async",
    "delete_file",
    "safe_delete",
    "move_file",
    "copy_file",
    "file_info",
    "stat",
    "test_path",
    "file_exists",
    "exists",
    "vm-read",
    "vm_read",
    "ensure_dir",
    "mkdir",
    "git_status",
    "git_diff",
    "git_log"
  ];
  if (allowClearHistory) actions.push("clear_tool_history");
  if (allowFindReferences) actions.push("find_references", "find_implementations");
  if (allowFileOutline) actions.push("file_outline", "workspace_outline", "repo_map");
  if (allowRenameSymbol) actions.push("rename_symbol");
  if (allowMoveWithImports) actions.push("move_file_with_imports");
  if (allowFindDefinition) actions.push("find_definition");
  if (allowExtractToFile) actions.push("extract_to_file", "extract_component", "extract_hook", "atomic_refactor", "split_plan", "split_stage", "split_refine", "split_repair", "split_status");
  if (allowAddImport) actions.push("add_import");
  if (allowGetDiagnostics) actions.push("get_diagnostics", "workspace_diagnostics", "verify_loop", "verify_changed", "replay_case", "record_case");
  if (allowOrganizeImports || allowGetDiagnostics) actions.push("auto_fix_missing_imports");
  if (allowOrganizeImports) actions.push("organize_imports");
  if (allowAnalyzeScope) actions.push("analyze_scope", "analyze_coupling");
  if (allowCodeGraph) actions.push("code_graph", "relation_graph", "symbol_graph");
  if (allowJevChoose) actions.push("jev_choose");
  if (allowJevChecklist) actions.push("jev_checklist");
  if (allowJevEvaluate) actions.push("jev_evaluate");
  if (allowJevThinking) actions.push("jev_thinking");
  if (allowJevRedteam) actions.push("jev_redteam");
  if (allowJevRank) actions.push("jev_rank");
  if (allowJevScope) actions.push("jev_scope");
  if (allowJevDispatch) actions.push("jev_dispatch");
  if (allowJevConsistency) actions.push("jev_consistency");
  if (allowJevDone) actions.push("jev_done");
  if (allowJevDiagnose) actions.push("jev_diagnose");
  if (allowJevEdgeCases) actions.push("jev_edge_cases");
  if (allowJevBlastRadius) actions.push("jev_blast_radius");
  if (allowJevIntent) actions.push("jev_intent");
  if (allowJevNext) actions.push("jev_next");
  if (allowJevCompress) actions.push("jev_compress");
  if (allowJevProgress) actions.push("jev_progress");
  if (allowJs) actions.push("run_js");
  if (allowPy) actions.push("run_py");
  if (allowHttp) actions.push("http_fetch");
  const bunProfiles = policy?.process?.bunProfiles ?? [];
  if (bunProfiles.length > 0) actions.push("run_project_check");
  const allowBun = Boolean(policy?.process?.bun === true || (typeof policy?.process?.bun === "object" && (policy.process.bun as any).enabled !== false));
  if (allowBun) actions.push("run_bun");
  actions.push("run_host");

  return {
    type: "function",
    name: "sa_vm_run",
    description: `Run packaged native function tools for secure, rapid workspace operations: ${actions.map((a) => `'${a}'`).join(", ")}.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: actions,
          description: "Action shortcut to execute: 'apply_patch' applies unified diff, 'edit_file' replaces unique text, 'write_file' writes file, 'read_file' reads content (with max_tokens protection), 'read_lines' reads lines, 'read_many' reads up to 10 files in one call, 'read_file_tail' reads trailing lines from end of file (ideal for logs), 'find_files' searches files, 'list_dir' lists directory (gitignore-aware, supports pattern/path_pattern/exclude_dirs), 'grep_search' searches text (skips files over max_file_bytes and binaries, supports exclude_dirs), 'grep_search_async' performs high-concurrency search with batch queries support, 'delete_file' removes file with backup, 'safe_delete' deletes file after checking references, 'move_file' renames/moves file, 'copy_file' copies file, 'file_info' gets metadata, 'test_path'/'file_exists' checks if path exists safely without shell exceptions, 'ensure_dir'/'mkdir' creates directory recursively, 'file_outline' extracts structural symbols (max_tokens-truncated), 'workspace_outline' outlines a whole directory in one call, 'repo_map' builds repo-wide symbol/dependency map, 'code_graph'/'relation_graph'/'symbol_graph' returns class-inheritance/module-dependency/call-flow topology in one shot (MUST prefer over looping grep+read; target=symbol or module path, mode=symbol_hierarchy|module_dependency|call_flow, depth<=5, format=dot|py_stub|networkx), 'rename_symbol' safely renames code symbols, 'move_file_with_imports' moves files updating imports, 'find_definition' jumps to declaration & implementation, 'extract_to_file' splits code to new file (top-insert import fix), 'extract_component'/'extract_hook' atomic scope-aware split with Props + semantic gate, 'auto_fix_missing_imports' LanguageService quick-fix, 'analyze_coupling' low-coupling split ranking, 'atomic_refactor' memory gate 0-write on error, 'split_plan' creates a persistent AST refactor plan, 'split_stage'/'split_refine' stage coarse-to-fine drafts off-worktree, 'split_repair' validates then explicitly commits or rolls back a workflow, 'add_import' inserts or merges imports, 'get_diagnostics' checks single-file syntax, 'workspace_diagnostics' aggregates syntax errors across the workspace with token bounds, 'verify_loop'/'verify_changed' re-checks changed files after edits, 'organize_imports' cleans and sorts imports, 'analyze_scope' inspects free variables and derives props for component extraction, 'run_project_check' runs predefined project profiles, 'run_bun' runs secure Bun commands, 'jev_choose'/'jev_checklist'/'jev_evaluate'/'jev_thinking'/'jev_redteam'/'jev_rank'/'jev_scope'/'jev_consistency'/'jev_done'/'jev_diagnose'/'jev_edge_cases'/'jev_blast_radius'/'jev_intent'/'jev_next' call advisory JEV decision helpers (need question+options / checks / questions / goal+thoughts / target / items+criterion / task+phases / plan+constraints / request+work+evidence / error+hypotheses+fix / code / diff plus context; thinking has a built-in '__act_now' brake), 'git_status' returns worktree cleanliness (branch/staged/unstaged/untracked, read-only native git - prefer over run_host for status/diff), 'git_diff' returns uncommitted diff (supports staged/stat_only/pathspec, read-only native git - prefer over run_host for status/diff), 'run_host' runs host binaries (bun, node, python, zig, git) or workspace-internal binaries with slicing and help caching (curl/powershell/cmd are denied; destructive git reset --hard/clean/revert is blocked only when VM safe exec interception is on - prefer git_status/git_diff for git status/diff)."
        },
        profile: { type: "string", description: "Project check profile name (e.g. 'web-typecheck', 'server-typecheck', 'root-typecheck', 'server-test-file', 'web-build') for 'run_project_check'." },
        test_file: { type: "string", description: "Target test file relative path for '*-test-file' profiles (e.g. 'tests/server/saVmTool.test.ts')." },
        subcommand: { type: "string", description: "Subcommand for 'run_bun' (e.g. 'test', 'build', 'run')." },
        exe: { type: "string", description: "Target executable binary for 'run_host' ('bun', 'node', 'python', 'zig', 'git', or workspace-internal path; curl/powershell/cmd are denied; destructive git reset --hard/clean/revert is blocked only when VM safe exec interception is on)." },
        args: { type: "array", items: { type: "string" }, description: "Command-line arguments for 'run_host'." },
        head_lines: { type: "integer", description: "First N lines of output to retain for 'run_host'." },
        tail_lines: { type: "integer", description: "Last N lines of output to retain for 'run_host'." },
        env: { type: "object", description: "Allowlisted environment variables for 'run_host' (e.g. SA_PLUGIN_DEV, ZIG_EXE, NO_COLOR, GIT_TERMINAL_PROMPT)." },
        filter: { type: "string", description: "Workspace filter for 'run_bun', 'run_host', or project checks." },
        path: { type: "string", description: "Target file path or directory for the action (e.g. 'src/main.ts')." },
        file: { type: "string", description: "Target single file path for 'read_file', 'read_lines', 'count_lines', or 'grep_search' (alias of 'path')." },
        dir: { type: "string", description: "Target directory path for 'list_dir', 'grep_search', 'find_files', or 'workspace_diagnostics' (default '.')." },
        target: { type: "string", description: "Target destination file path for operations or alias of 'path', or symbol/module for 'code_graph', or plan/decision under review for 'jev_redteam'." },
        items: { type: "object", description: "Items map to rank for 'jev_rank' (2-6 entries)", additionalProperties: true },
        criterion: { type: "string", description: "Ranking criterion for 'jev_rank' (e.g. 'ROI')" },
        task: { type: "string", description: "Task under scope triage for 'jev_scope' or goal for split_plan." },
        session_id: { type: "string", description: "Persistent split workflow id returned by split_plan." },
        phase: { type: "string", enum: ["coarse", "refine", "stage", "diff", "validate", "commit", "rollback"], description: "Split stage kind or split_repair phase." },
        module_name: { type: "string", description: "Human-readable coarse/refined module name." },
        confirm: { type: "boolean", description: "Must be true to apply a validated split workflow commit." },
        ops: { type: "array", maxItems: 20, description: "Staged workspace-relative file contents or patch updates; split drafts do not touch the worktree.", items: { type: "object", additionalProperties: true } },
        phases: { type: "object", description: "Candidate split phases for 'jev_scope' (up to 6 entries)", additionalProperties: true },
        plan: { type: "string", description: "Plan under consistency audit for 'jev_consistency'" },
        constraints: { type: "object", description: "Hard constraints map for 'jev_consistency' (1-8 entries)", additionalProperties: true },
        user_request: { type: "string", description: "Original user request for 'jev_done'" },
        actual_work: { type: "string", description: "Actual work performed for 'jev_done'" },
        evidence: { type: "string", description: "Verification evidence for 'jev_done'" },
        error_summary: { type: "string", description: "Error or failure summary for 'jev_diagnose'" },
        hypotheses: { type: "object", description: "Root-cause hypotheses map for 'jev_diagnose' (2-4 entries)", additionalProperties: true },
        proposed_fix: { type: "string", description: "Proposed fix under judgment for 'jev_diagnose'" },
        code: { type: "string", description: "Code under boundary review for 'jev_edge_cases'" },
        diff: { type: "string", description: "Unified diff under blast-radius review for 'jev_blast_radius'" },
        target_component: { type: "string", description: "Target component of the diff for 'jev_blast_radius'" },
        mode: { type: "string", enum: ["symbol_hierarchy", "module_dependency", "module_deps", "call_flow"], description: "Code graph mode for 'code_graph' ('symbol_hierarchy' for class inheritance/composition, 'module_dependency' / 'module_deps' for imports, 'call_flow' for function/method call graph)." },
        depth: { type: "integer", description: "Depth of graph traversal for 'code_graph' (default 2, max 5)." },
        direction: { type: "string", enum: ["upstream", "downstream", "both"], description: "Direction of dependency traversal for 'code_graph' ('upstream', 'downstream', or 'both')." },
        format: { type: "string", enum: ["dot", "py_stub", "networkx"], description: "Output format for 'code_graph' ('dot' for Graphviz, 'py_stub' for Python stub, 'networkx' for NetworkX script)." },
        output_file: { type: "string", description: "Optional output file path to write code graph to disk (default: pure memory, no disk write)." },
        candidate_files: { type: "array", items: { type: "string" }, description: "Optional candidate file paths to restrict search scope for 'code_graph'." },
        type: { type: "string", enum: ["all", "file", "directory"], description: "Filter entries by type for 'list_dir' ('all', 'file', or 'directory')." },
        max_files: { type: "integer", description: "Maximum files to scan for 'workspace_diagnostics' (default 100)." },
        max_errors: { type: "integer", description: "Maximum errors to collect for 'workspace_diagnostics' (default 50)." },
        detail: { type: "boolean", description: "Return detailed diagnostics if true, or compact single-line locations if false (default false)." },
        check_references: { type: "boolean", description: "Check symbol references before deleting for 'safe_delete' (default true)." },
        force: { type: "boolean", description: "Force delete for 'safe_delete' even if references exist (default false)." },
        content: { type: "string", description: "Content to write for 'write_file', or script source for 'run_js'/'run_py'." },
        patch: { type: "string", description: "Unified diff patch starting with '*** Begin Patch' and ending with '*** End Patch' for 'apply_patch'." },
        old_text: { type: "string", description: "Existing text snippet to find and replace for 'edit_file'." },
        new_text: { type: "string", description: "New replacement text for 'edit_file'." },
        old_name: { type: "string", description: "Target symbol name to rename for 'rename_symbol'." },
        new_name: { type: "string", description: "Replacement symbol name for 'rename_symbol'." },
        symbol: { type: "string", description: "Symbol name for 'find_definition' or 'rename_symbol'." },
        statement: { type: "string", description: "Import statement for 'add_import' (e.g. 'import { t } from \"./i18n\";')." },
        component_name: { type: "string", description: "Target component name for 'analyze_scope' or 'extract_to_file'." },
        include_body: { type: "boolean", description: "Whether to include the implementation code snippet for 'find_definition' (default true)." },
        dry_run: { type: "boolean", description: "If true, previews changes without writing to disk for 'rename_symbol', 'move_file_with_imports', 'extract_to_file', 'add_import', or 'organize_imports'." },
        keep_source: { type: "boolean", description: "If true, 'extract_to_file'/'extract_component' copy instead of move: target is written, source is left unchanged with no import injected (default false)." },
        from: { type: "string", description: "Source path for 'move_file', 'copy_file', 'move_file_with_imports', or 'extract_to_file'." },
        to: { type: "string", description: "Destination path for 'move_file', 'copy_file', 'move_file_with_imports', or 'extract_to_file'." },
        query: { type: "string", description: "Search query text or regular expression for 'grep_search' or 'grep_search_async' (supports full regex e.g. 'pattern1|pattern2', '\\bfoo\\b')." },
        queries: { type: "array", items: { type: "string" }, description: "Batch of search query strings or regexes to find in parallel for 'grep_search_async'." },
        is_regex: { type: "boolean", description: "Whether to treat query as a regular expression (default: true when pattern contains regex syntax like '|', '\\b', etc.)." },
        case_sensitive: { type: "boolean", description: "Whether search should be case sensitive (default false)." },
        path_pattern: { type: "string", description: "Optional regex or path pattern to filter matching file paths (e.g. 'sci.*sab|src.*sab' or '**/components/**') for 'grep_search', 'grep_search_async', or 'find_files'." },
        url: { type: "string", description: "Target HTTPS URL for 'http_fetch'." },
        method: { type: "string", description: "HTTP method ('GET' or 'POST') for 'http_fetch'." },
        max_tokens: { type: "integer", description: "Maximum token budget for 'read_file' (default 4000, up to remaining context tokens). Dynamically bounded by remaining context window tokens to strictly prevent overflow." },
        remaining_tokens: { type: "integer", description: "Current remaining tokens in the context window. Automatically clamped with safe headroom reservation." },
        offset: { type: "integer", description: "Character/byte offset for reading minified or long single-line files with 'read_file' (default 0)." },
        start_line: { type: "integer", description: "1-based starting line for 'read_file' / 'read_lines' (default 1)." },
        end_line: { type: "integer", description: "1-based ending line for 'read_file' / 'read_lines'." },
        lines: { type: "integer", description: "Number of trailing lines to read for 'read_file_tail' (default 100, max 1000)." },
        tail: { type: "boolean", description: "Whether to read from the tail (end) of the file for 'read_file' or 'read_lines'." },
        max_lines: { type: "integer", description: "Maximum lines to return for 'read_file' (default 250, max 1000)." },
        numbered: { type: "boolean", description: "Whether to prepend 1-based line numbers to output (default true)." },
        pattern: { type: "string", description: "Glob pattern for 'find_files' or 'grep_search' (e.g. '*' or '*.ts')." },
        max_bytes: { type: "integer", description: "Maximum bytes to read (default 32768, max 65536)." },
        max_entries: { type: "integer", description: "Maximum entries to return for 'find_files' or 'list_dir' (default 100)." },
        max_depth: { type: "integer", description: "Maximum recursion depth for 'find_files' (default 5)." },
        max_matches: { type: "integer", description: "Maximum matches to return for 'grep_search' (default 50)." },
        files: { type: "array", items: { type: "string" }, description: "File path list for 'read_many' (max 10 files in one call)." },
        max_tokens_per_file: { type: "integer", description: "Maximum tokens per file for 'read_many' (default 2000)." },
        staged: { type: "boolean", description: "Show staged changes for 'git_diff' (default unstaged+untracked summary)." },
        stat_only: { type: "boolean", description: "Only file stats for 'git_diff'." },
        pathspec: { type: "string", description: "Path filter for 'git_diff' (single file/dir)." },
        source: { type: "string", description: "Optional: script source code for run_js / run_py or legacy compatibility." },
        parallel: { type: "array", maxItems: 32, description: "Run multiple independent tasks concurrently (preferred for multi-file content writes, e.g. parallel edit_file or write_file).", items: { type: "object", additionalProperties: true } },
        concurrency: { type: "integer", minimum: 1, maximum: 8, description: "Maximum simultaneous tasks (default: task count, capped at 8)." },
        language: { type: "string", description: "Language (default: 'js'; bun branch supports js/ts via bun and py only)." },
        requested_caps: { type: "object" },
        limits: { type: "object" },
        question: { type: "string", description: "Decision question for 'jev_choose' (2-6 options) or goal description" },
        options: { type: "object", description: "Choice options map for 'jev_choose' (e.g. { a: 'desc A', b: 'desc B' })", additionalProperties: true },
        checks: { type: "object", description: "Checklist items map for 'jev_checklist' (e.g. { no_placeholders: '...' })", additionalProperties: true },
        questions: { type: "object", description: "Custom questions map for 'jev_evaluate' passthrough", additionalProperties: true },
        goal: { type: "string", description: "Thinking goal for 'jev_thinking'" },
        thoughts: { type: "object", description: "Candidate lines of thought for 'jev_thinking' (1-4 entries; '__act_now' brake is built in)", additionalProperties: true },
        context: { description: "Supporting context for jev_* advisory actions (falls back to 'content'); or diff context lines (0-10) for 'git_diff' (backend distinguishes by string vs number)." }
      }
    }
  };
}

export function enhanceDynamicToolSpec(policy?: SaVmPolicyConfig): JsonValue {
  const allowRead = policy?.tools?.readFiles === true || policy?.tools?.replaceRead === true;
  const allowSearch = policy?.tools?.fastSearch === true;
  const allowEdit = policy?.tools?.editFiles === true || policy?.tools?.replaceWrite === true;
  const allowPatch = policy?.tools?.applyPatch === true || policy?.tools?.replaceApplyPatch === true;
  const allowClearHistory = policy?.tools?.clearToolHistory === true;
  const allowFindReferences = policy?.tools?.findReferences === true;
  const allowRenameSymbol = policy?.tools?.renameSymbol === true;
  const allowFileOutline = policy?.tools?.fileOutline === true;
  const allowMoveWithImports = policy?.tools?.moveWithImports === true;
  const allowFindDefinition = policy?.tools?.findDefinition === true;
  const allowExtractToFile = policy?.tools?.extractToFile === true;
  const allowAddImport = policy?.tools?.addImport === true;
  const allowGetDiagnostics = policy?.tools?.getDiagnostics === true;
  const allowOrganizeImports = policy?.tools?.organizeImports === true;
  const allowAnalyzeScope = policy?.tools?.analyzeScope === true;
  const allowCodeGraph = policy?.tools?.codeGraph !== false;
  const allowJevChoose = policy?.tools?.jevChoose === true;
  const allowJevChecklist = policy?.tools?.jevChecklist === true;
  const allowJevEvaluate = policy?.tools?.jevEvaluate === true;
  const allowJevThinking = policy?.tools?.jevThinking === true;
  const allowJevRedteam = policy?.tools?.jevRedteam === true;
  const allowJevRank = policy?.tools?.jevRank === true;
  const allowJevScope = policy?.tools?.jevScope === true;
  const allowJevDispatch = policy?.tools?.jevDispatch === true;
  const allowJevConsistency = policy?.tools?.jevConsistency === true;
  const allowJevDone = policy?.tools?.jevDone === true;
  const allowJevDiagnose = policy?.tools?.jevDiagnose === true;
  const allowJevEdgeCases = policy?.tools?.jevEdgeCases === true;
  const allowJevBlastRadius = policy?.tools?.jevBlastRadius === true;
  const allowJevIntent = policy?.tools?.jevIntent === true;
  const allowJevNext = policy?.tools?.jevNext === true;
  const allowJevCompress = policy?.tools?.jevCompress === true;
  const allowJevProgress = policy?.tools?.jevProgress === true;

  const actions: string[] = [];
  if (allowPatch) actions.push("apply_patch");
  if (allowEdit) actions.push("edit_file", "write_file", "ensure_dir", "mkdir");
  if (allowRead) actions.push("read_file", "read_lines", "read_many", "read_file_tail", "count_lines", "vm-read", "vm_read");
  if (allowSearch) actions.push("find_files", "list_dir", "grep_search", "grep_search_async", "file_info", "stat", "test_path", "file_exists", "exists");
  actions.push("git_status", "git_diff", "git_log");
  if (allowFindReferences) actions.push("find_references", "find_implementations");
  if (allowFileOutline) actions.push("file_outline", "workspace_outline", "repo_map");
  if (allowRenameSymbol) actions.push("rename_symbol");
  if (allowMoveWithImports) actions.push("move_file_with_imports");
  if (allowFindDefinition) actions.push("find_definition");
  if (allowExtractToFile) actions.push("extract_to_file", "extract_component", "extract_hook", "atomic_refactor", "split_plan", "split_stage", "split_refine", "split_repair", "split_status");
  if (allowAddImport) actions.push("add_import");
  if (allowGetDiagnostics) actions.push("get_diagnostics", "workspace_diagnostics", "verify_loop", "verify_changed", "replay_case", "record_case");
  if (allowOrganizeImports || allowGetDiagnostics) actions.push("auto_fix_missing_imports");
  if (allowOrganizeImports) actions.push("organize_imports");
  if (allowAnalyzeScope) actions.push("analyze_scope", "analyze_coupling");
  if (allowCodeGraph) actions.push("code_graph", "relation_graph", "symbol_graph");
  if (allowClearHistory) actions.push("clear_tool_history");
  if (allowJevChoose) actions.push("jev_choose");
  if (allowJevChecklist) actions.push("jev_checklist");
  if (allowJevEvaluate) actions.push("jev_evaluate");
  if (allowJevThinking) actions.push("jev_thinking");
  if (allowJevRedteam) actions.push("jev_redteam");
  if (allowJevRank) actions.push("jev_rank");
  if (allowJevScope) actions.push("jev_scope");
  if (allowJevDispatch) actions.push("jev_dispatch");
  if (allowJevConsistency) actions.push("jev_consistency");
  if (allowJevDone) actions.push("jev_done");
  if (allowJevDiagnose) actions.push("jev_diagnose");
  if (allowJevEdgeCases) actions.push("jev_edge_cases");
  if (allowJevBlastRadius) actions.push("jev_blast_radius");
  if (allowJevIntent) actions.push("jev_intent");
  if (allowJevNext) actions.push("jev_next");
  if (allowJevCompress) actions.push("jev_compress");
  if (allowJevProgress) actions.push("jev_progress");

  return {
    type: "function",
    name: "sa_vm_run",
    description: `High-performance code tools: ${actions.join(", ")}. MUST call 'read_lines' (for line ranges X..Y), 'count_lines' (for total lines), or 'read_file' (token-safe whole file) instead of shell cat/grep/PowerShell Get-Content. Host shell remains available for build/test.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: actions.length > 0 ? actions : ["file_outline", "get_diagnostics"],
          description: "Enhancement tool action to execute"
        },
        path: { type: "string", description: "Target source file path relative to workspace or absolute" },
        file: { type: "string", description: "Target single file path for read_file, read_lines, count_lines, or grep_search (alias of path)" },
        type: { type: "string", enum: ["all", "file", "directory"], description: "Filter entries by type for list_dir ('all', 'file', or 'directory')" },
        symbol: { type: "string", description: "Target symbol / identifier name" },
        new_name: { type: "string", description: "New identifier name for rename_symbol" },
        source: { type: "string", description: "Source file path for extract_to_file" },
        target: { type: "string", description: "Target destination file path, or plan/decision under review for 'jev_redteam'" },
        items: { type: "object", description: "Items map to rank for 'jev_rank' (2-6 entries)", additionalProperties: true },
        criterion: { type: "string", description: "Ranking criterion for 'jev_rank' (e.g. 'ROI')" },
        task: { type: "string", description: "Task under scope triage for 'jev_scope' or goal for split_plan." },
        session_id: { type: "string", description: "Persistent split workflow id returned by split_plan." },
        phase: { type: "string", enum: ["coarse", "refine", "stage", "diff", "validate", "commit", "rollback"], description: "Split stage kind or split_repair phase." },
        module_name: { type: "string", description: "Human-readable coarse/refined module name." },
        confirm: { type: "boolean", description: "Must be true to apply a validated split workflow commit." },
        ops: { type: "array", maxItems: 20, description: "Staged workspace-relative file contents or patch updates; split drafts do not touch the worktree.", items: { type: "object", additionalProperties: true } },
        phases: { type: "object", description: "Candidate split phases for 'jev_scope' (up to 6 entries)", additionalProperties: true },
        plan: { type: "string", description: "Plan under consistency audit for 'jev_consistency'" },
        constraints: { type: "object", description: "Hard constraints map for 'jev_consistency' (1-8 entries)", additionalProperties: true },
        user_request: { type: "string", description: "Original user request for 'jev_done'" },
        actual_work: { type: "string", description: "Actual work performed for 'jev_done'" },
        evidence: { type: "string", description: "Verification evidence for 'jev_done'" },
        error_summary: { type: "string", description: "Error or failure summary for 'jev_diagnose'" },
        hypotheses: { type: "object", description: "Root-cause hypotheses map for 'jev_diagnose' (2-4 entries)", additionalProperties: true },
        proposed_fix: { type: "string", description: "Proposed fix under judgment for 'jev_diagnose'" },
        code: { type: "string", description: "Code under boundary review for 'jev_edge_cases'" },
        diff: { type: "string", description: "Unified diff under blast-radius review for 'jev_blast_radius'" },
        target_component: { type: "string", description: "Target component of the diff for 'jev_blast_radius'" },
        from: { type: "string", description: "Original file path for move_file_with_imports" },
        to: { type: "string", description: "New file path for move_file_with_imports" },
        start_line: { type: "integer", description: "Start line number (1-indexed)" },
        end_line: { type: "integer", description: "End line number (1-indexed)" },
        statement: { type: "string", description: "Import statement to add or merge" },
        component_name: { type: "string", description: "Extracted component name for analyze_scope" },
        reason: { type: "string", description: "Reason for clearing tool history" },
        query: { type: "string", description: "Search query text for grep_search or grep_search_async" },
        queries: { type: "array", items: { type: "string" }, description: "Batch of search query strings to find in parallel for grep_search_async" },
        content: { type: "string", description: "Content to write for write_file" },
        patch: { type: "string", description: "Unified diff patch starting with '*** Begin Patch' and ending with '*** End Patch' for apply_patch" },
        old_text: { type: "string", description: "Existing text snippet to find and replace for edit_file" },
        new_text: { type: "string", description: "New replacement text for edit_file" },
        dir: { type: "string", description: "Directory to search for find_files, list_dir, workspace_outline, or grep_search" },
        pattern: { type: "string", description: "Glob pattern for find_files, list_dir, workspace_outline, or grep_search" },
        path_pattern: { type: "string", description: "Path regex filter for find_files, list_dir, workspace_outline, or grep_search" },
        exclude_dirs: { type: "array", items: { type: "string" }, description: "Directory names or relative paths to skip for list_dir, workspace_outline, or grep_search" },
        max_file_bytes: { type: "integer", description: "Per-file size cap in bytes for grep_search or file_outline (default 524288 for grep, 1048576 for outline)" },
        respect_gitignore: { type: "boolean", description: "Respect .gitignore and built-in excludes for list_dir or grep_search (default true)" },
        files: { type: "array", items: { type: "string" }, description: "File path list for read_many or workspace_outline candidate files" },
        max_files: { type: "integer", description: "Maximum files to outline for workspace_outline (default 20, max 100)" },
        max_symbols_per_file: { type: "integer", description: "Maximum top-level symbols per file for workspace_outline (default 50)" },
        max_tokens_per_file: { type: "integer", description: "Maximum tokens per file for read_many (default 2000)" },
        staged: { type: "boolean", description: "Show staged changes for git_diff (default unstaged+untracked summary)." },
        stat_only: { type: "boolean", description: "Only file stats for git_diff." },
        pathspec: { type: "string", description: "Path filter for git_diff (single file/dir)." },
        max_tokens: { type: "integer", description: "Maximum token limit for read_file or find_references" },
        max_lines: { type: "integer", description: "Maximum lines to return for read_file or read_file_tail" },
        max_matches: { type: "integer", description: "Maximum matches to return for grep_search or grep_search_async" },
        concurrency: { type: "integer", description: "Concurrency limit for grep_search_async (default 16)" },
        question: { type: "string", description: "Decision question for 'jev_choose' (2-6 options) or goal description" },
        options: { type: "object", description: "Choice options map for 'jev_choose' (e.g. { a: 'desc A', b: 'desc B' })", additionalProperties: true },
        checks: { type: "object", description: "Checklist items map for 'jev_checklist' (e.g. { no_placeholders: '...' })", additionalProperties: true },
        questions: { type: "object", description: "Custom questions map for 'jev_evaluate' passthrough", additionalProperties: true },
        goal: { type: "string", description: "Thinking goal for 'jev_thinking'" },
        thoughts: { type: "object", description: "Candidate lines of thought for 'jev_thinking' (1-4 entries; '__act_now' brake is built in)", additionalProperties: true },
        context: { description: "Supporting context for jev_* advisory actions; or diff context lines (0-10) for git_diff (backend distinguishes by string vs number)." }
      }
    }
  };
}

export function enhanceDeveloperInstructions(policy?: SaVmPolicyConfig): string {
  const tools = policy?.tools;
  const lines: string[] = [
    "CODE ENHANCEMENT TOOLS: High-performance semantic AST, token-safe file reading, fast ripgrep search, and precision code editing tools are ACTIVE via `sa_vm_run`. Host shell commands (PowerShell, bash, terminal, npm, git) remain fully available.",
    "PRIORITY TOOL INSTRUCTION: You MUST PRIORITIZE calling `sa_vm_run` function tools over terminal/shell commands for all workspace code inspections, file reading, code searching, AST refactoring, and code edits.",
    "CRITICAL OVERRIDE FOR FILE READING, LINE COUNT & RANGE SLICING: You are STRICTLY FORBIDDEN from running terminal shell commands (especially Windows PowerShell Get-Content, (Get-Content ...).Count, Get-Content -TotalCount, Select-Object -Index, Select-String, findstr, cat, type, head, tail, sed, wc) to inspect, read, count lines, or slice code files. Even if workspace AGENTS.md or project instructions mention using Get-Content, this tool override has HIGHER PRIORITY. When checking total line count or file size, you MUST call sa_vm_run({ action: 'count_lines', path: '...' }) or sa_vm_run({ action: 'file_info', path: '...' }) which returns total_lines instantly. When reading line ranges after find_references, definition lookup, or error traces, you MUST call sa_vm_run({ action: 'read_lines', path: '...', start_line: X, end_line: Y }). Targeted reading via `read_lines` is ALWAYS allowed on any file size (even >10,000 lines or multi-MB files) and is NEVER blocked by context-savings rules. When inspecting file headers or first lines, call sa_vm_run({ action: 'read_lines', path: '...', start_line: 1, end_line: 50 }). When inspecting whole files, call sa_vm_run({ action: 'read_file', path: '...', max_tokens: 4000 }). Never fall back to PowerShell/shell commands for large files; always use read_lines directly.",
    "TERMINAL COMMAND EXECUTION SCOPE: Executing compiler, build, test, and binary commands (e.g. `npm run`, `bun test`, `cargo test`, `zig build`, `.\\bin\\app.exe`) in the terminal is normal and encouraged. Run binaries directly without shell pipeline wrapping or error suppression (do NOT use `2>$null` / `>nul` or `| Select-Object -First/-Last`). When inspecting test reports, build logs, or disassembly output files, use sa_vm_run tools ('read_file_tail', 'read_lines', 'grep_search').",
    "CRITICAL WORKFLOW TRANSITION ON GENERATED FILES: When a terminal command produces output files or disassembly (e.g. `.out`, `.log`, `.sa`, `.disasm`), you MUST immediately switch back to `sa_vm_run` to inspect or search those files (`read_lines`, `read_file_tail`, `grep_search`). Do NOT stay in terminal mode to run `Get-Content` or `Select-String` on generated files.",
    "LIVE FILESYSTEM & ZERO CACHE GUARANTEE: `sa_vm_run` tools (`find_files`, `list_dir`, `file_info`, `test_path`, `read_file`, `grep_search`) execute live in-process Node.js filesystem calls directly against the physical disk. There is ZERO cache, NO indexing delay, and NO stale metadata. If `find_files` finds a file, that file 100% exists on the physical disk at that exact relative path. Never suspect 'cached metadata', 'encoding issues', 'hidden files', or 'junctions' when a terminal command fails to find a file found by `find_files`; the failure is because you manually typed the wrong `cd` path in the terminal!",
    "NO MANUAL CD: All terminal commands and `sa_vm_run` tools run directly in the workspace root. Never run `cd <path>` in terminal because typos (e.g. omitting a folder level) cause path drift and false 'file not found' errors. Always run commands and specify paths relative to the workspace root.",
    "NO BATCH FOR-IN LOOPS IN TERMINAL: You are strictly forbidden from writing `for ... in`, `for /f`, `for /r`, `foreach`, or piped `ForEach-Object` loops in PowerShell or cmd to iterate over files, search patterns, count lines, or replace text. Shell loops cause catastrophic quote-escaping errors, UTF-8 encoding corruption (PowerShell -replace writes ANSI/UTF-16), and context overflow. Use `sa_vm_run` actions instead: `grep_search` with pattern searches all matching files natively; `find_files` discovers files with zero cache; `parallel` batches up to 32 operations safely.",
    "FAST DIRECTORY LISTING: Never run `Get-ChildItem -Recurse` or `dir /s` in terminal. Use `sa_vm_run({ action: 'list_dir', dir: 'path', depth: 2, max_entries: 30 })` which returns multi-depth directory trees in milliseconds.",
    "SINGLE FILE & MULTI FILE GREP: To search patterns in a file or directory, use `sa_vm_run({ action: 'grep_search', path: 'file.ext', query: 'pattern' })`. It searches single files OR entire folders natively without PowerShell Select-String.",
    "BATCH SYNONYM SEARCH VIA grep_search_async: When searching for a concept across multiple files with alternative/synonym symbol names (e.g. planAsyncLinearAwaitContinuation, AsyncLinearAwaitPlan, genFuncDeclNamedImpl), DO NOT run multiple separate rg/Select-String commands per file or repeat searches with looser terms. Call `sa_vm_run({ action: 'grep_search_async', dir: 'src', pattern: '*.zig', queries: ['q1', 'q2', 'q3'], max_matches: 30 })` in a SINGLE call to resolve them concurrently.",
    "SYMBOL RESOLUTION OVER BLIND GREP: When looking for symbols from handoffs or memory (e.g. LinearAwait) that return 0 results, DO NOT blindly relax the regex to broad terms like 'linear|MAX_AWAITS' which floods context. Instead follow the 3-step symbol resolution recipe: 1. sa_vm_run({ action: 'file_outline', path: 'file.ext' }) to see current real symbol declarations -> 2. sa_vm_run({ action: 'find_definition', symbol: 'real_symbol' }) or find_references -> 3. sa_vm_run({ action: 'read_lines', path: 'file.ext', start_line: L-40, end_line: L+40 }) for surgical context. If empty, STOP and check outline; never blindly relax search patterns in terminal.",
    "NO FORMATTING PIPELINES IN TERMINAL: Strictly forbidden to use Format-Table, Format-List, Format-Wide, or Out-String in terminal commands. JSON returned by sa_vm_run is the final machine-readable structured format.",
    "NO ERROR SUPPRESSION IN SHELL: Strictly forbidden to use `-ErrorAction SilentlyContinue` or `2>$null` in PowerShell to mask errors. Use sa_vm_run({ action: 'test_path', path: '...' }) for safe existence checks.",
    "RECIPE FOR EXTERNAL / STD LIBS: To inspect workspace SDKs or external libs, do NOT guess paths with Get-ChildItem in shell. Follow the 4-step recipe: 1. sa_vm_run({ action: 'list_dir', dir: LIB_ROOT, max_entries: 20 }) -> 2. sa_vm_run({ action: 'find_files', dir: LIB_ROOT, pattern: 'target.ts' }) -> 3. sa_vm_run({ action: 'grep_search', path: 'found_path', query: 'identifier' }) -> 4. sa_vm_run({ action: 'read_lines', path: 'found_path', start_line: X-20, end_line: X+20 }). Never read full files blindly.",
    "RECIPE FOR TEST / RUNS: Follow the 3-step write-run-read recipe: 1. sa_vm_run({ action: 'write_file', path: '...', content: '...' }) -> 2. Run single command (e.g. bun run ./script.ts) in terminal -> 3. sa_vm_run({ action: 'read_lines', path: 'output.log', start_line: 1, end_line: 30 }) to inspect results. Never chain them with ';' or Out-Host in PowerShell.",
    "QUICK ACTION MAPPING (HOST COMMAND -> SA_VM_RUN):",
    "- Test-Path file.ext                                  -->  sa_vm_run({ action: 'test_path', path: 'file.ext' })",
    "- Get-ChildItem -Directory | Select FullName          -->  sa_vm_run({ action: 'list_dir', dir: '.', type: 'directory' })",
    "- ... | Where-Object Name -Match 'xyz'                -->  sa_vm_run({ action: 'find_files', pattern: '*xyz*' })",
    "- ... | Where Length -gt 1MB                          -->  sa_vm_run({ action: 'list_dir', dir: '...', type: 'file' }) then check size",
    "- where sla / which zig                               -->  sa_vm_run({ action: 'run_host', exe: 'sla', args: ['--help'] }) directly",
    "- find . -name \\\"future.sa\\\" -not -path \\\"*/.sla*\\\" -->  sa_vm_run({ action: 'find_files', dir: '.', pattern: 'future.sa', path_pattern: '^(?!.*\\\\.sla).*$' })",
    "- find ... | head -20 / tail -30                     -->  sa_vm_run({ action: 'read_lines' | 'read_file_tail' | 'run_host', head_lines/tail_lines: N })",

    "- for %f in (*.ext) do findstr 'pat' %f               -->  sa_vm_run({ action: 'grep_search', pattern: '*.ext', query: 'pat' })",
    "- foreach ($f in (ls tests)) { Select-String ... }   -->  sa_vm_run({ action: 'grep_search', dir: 'tests', query: 'pat' })",
    "- Get-ChildItem -Recurse -Depth 2 | Select -First 30  -->  sa_vm_run({ action: 'list_dir', dir: '...', depth: 2, max_entries: 30 })",
    "- (Get-Content file).Count                            -->  sa_vm_run({ action: 'count_lines', path: 'file' })",
    "- Get-Content file | Select-Object -Skip X -First Y   -->  sa_vm_run({ action: 'read_lines', path: 'file', start_line: X+1, end_line: X+Y })",
    "- Get-Content file | Select -First 200                -->  sa_vm_run({ action: 'read_lines', path: 'file', start_line: 1, end_line: 200 })",
    "- Get-Content file | Select-Object -Last 100          -->  sa_vm_run({ action: 'read_file_tail', path: 'file', lines: 100 })",
    "- Get-Content file | Select-String -Pattern 'regex'   -->  sa_vm_run({ action: 'grep_search', path: 'file', query: 'regex', is_regex: true })",
    "- Get-Content F | Select-String P | Select -First N   -->  sa_vm_run({ action: 'grep_search', path: 'F', query: 'P', max_matches: N })",
    "- Select-String -Path F -Pattern P                     -->  sa_vm_run({ action: 'grep_search', path: 'F', query: 'P' })",
    "- cd dir; Get-Content file | Select-String -Pattern   -->  sa_vm_run({ action: 'grep_search', path: 'dir/file', query: 'regex', is_regex: true })",
    "- Get-Content file | Select-String -Pattern 'xxx'     -->  sa_vm_run({ action: 'grep_search', path: 'file', query: 'xxx' })",
    "- Select-String -Pattern 'xxx' *.zig                  -->  sa_vm_run({ action: 'grep_search', query: 'xxx', pattern: '*.zig' })",
    "- cd dir && ... / cd dir; ...                         -->  execute directly relative to workspace, or use sa_vm_run with 'dir'/'path'",
    "- Get-Process zig* / ps                               -->  prohibited; use internal diagnostics APIs or run_project_check",
    "- Get-Date / date                                     -->  unnecessary noise; omitted",
    "- rg -n 'pat' / grep -rn 'pat' .                      -->  sa_vm_run({ action: 'grep_search', query: 'pat' })",
    "- Get-ChildItem tests / ls / dir                      -->  sa_vm_run({ action: 'list_dir', dir: 'tests' })",
    "- Get-Content file / cat / type                       -->  sa_vm_run({ action: 'read_lines', path: 'file', start_line: 1, end_line: 100 })",
    "- vm-read(file)                                       -->  sa_vm_run({ action: 'read_lines', path: 'file' })",
    "- Set-Content -Path F -Encoding UTF8                  -->  sa_vm_run({ action: 'write_file', path: 'F', content: '...' })",
    "Available enhancement actions via `sa_vm_run`:"
  ];
  if (tools?.readFiles || tools?.replaceRead) {
    lines.push("- Token-safe file reading (protects context from blowing up on huge or minified files): sa_vm_run({ action: 'read_file', path: 'path/to/file.ext', max_tokens: 4000 })");
    lines.push("- Numbered line pagination: sa_vm_run({ action: 'read_lines', path: 'path/to/file.ext', start_line: 1, end_line: 100 })");
    lines.push("- Batch read up to 10 files in one call: sa_vm_run({ action: 'read_many', files: ['a.ts', 'b.ts'] })");
    lines.push("- Instant line count: sa_vm_run({ action: 'count_lines', path: 'path/to/file.ext' })");
    lines.push("- Fast log tailing from end of file: sa_vm_run({ action: 'read_file_tail', path: 'build.log', lines: 100 })");
  }
  lines.push("- Read-only git status: sa_vm_run({ action: 'git_status' }) (prefer over run_host for status)");
  lines.push("- Read-only git diff: sa_vm_run({ action: 'git_diff', stat_only: true }) (staged:true for staged, path/pathspec to limit files; prefer over run_host for diff)");
  lines.push("- Switch git branch (write path; git_status/git_diff are read-only and cannot switch): sa_vm_run({ action: 'run_host', exe: 'git', args: ['checkout', '<branch>'] }) (or args ['switch', '<branch>']; run args ['fetch'] first when the branch is remote-only; destructive clean/revert/reset --hard stay blocked)");
  lines.push("- Snapshot dirty worktree to a git commit / roll back: sa_vm_run({ action: 'local_checkpoint', message: '...' }) then sa_vm_run({ action: 'restore_checkpoint', commit: '<sha>' }) to undo");
  if (tools?.fastSearch) {
    lines.push("- Fast ripgrep search (directory OR single file): sa_vm_run({ action: 'grep_search', query: 'pattern', path: 'optional/file.ext', dir: '.' })");
    lines.push("- High-concurrency async multi-query search: sa_vm_run({ action: 'grep_search_async', queries: ['query1', 'query2'] })");
    lines.push("- Glob file discovery: sa_vm_run({ action: 'find_files', pattern: '*.ts' })");
    lines.push("- Fast directory listing (supports depth & max_entries): sa_vm_run({ action: 'list_dir', dir: '.', depth: 2, max_entries: 50 })");
    lines.push("- File metadata & total line count: sa_vm_run({ action: 'file_info', path: 'path/to/file.ext' })");
  }
  if (tools?.editFiles || tools?.replaceWrite) {
    lines.push("- Precision string replacement (avoids whole-file rewrites): sa_vm_run({ action: 'edit_file', path: 'path/to/file.ext', old_text: 'old', new_text: 'new' })");
    lines.push("- Atomic file write: sa_vm_run({ action: 'write_file', path: 'path/to/file.ext', content: 'contents' })");
    lines.push("- Safe file deletion with reference checks: sa_vm_run({ action: 'safe_delete', path: 'path/to/file.ext' }) or force: sa_vm_run({ action: 'safe_delete', path: 'path/to/file.ext', force: true })");
  }
  if (tools?.applyPatch || tools?.replaceApplyPatch) {
    lines.push("- Multi-file unified diff patch: sa_vm_run({ action: 'apply_patch', patch: '*** Begin Patch\\n...' })");
  }
  if (tools?.fileOutline) {
    lines.push("- Extract file outline (classes, functions, types, line ranges): sa_vm_run({ action: 'file_outline', path: 'path/to/file.ext' })");
    lines.push("- Outline a whole directory in one call: sa_vm_run({ action: 'workspace_outline', dir: 'src' })");
    lines.push("- Repo-wide symbol/dependency map: sa_vm_run({ action: 'repo_map', dir: '.' })");
  }
  if (tools?.codeGraph !== false) {
    lines.push("- Architecture topology & call chain in one shot (MUST prefer over looping grep+read; IRON RULE: for class inheritance, multi-module import network, or cross-function call flow, call code_graph once): sa_vm_run({ action: 'code_graph', target: 'ClassName', mode: 'symbol_hierarchy', depth: 2, format: 'dot' }) (aliases: relation_graph, symbol_graph; modes: symbol_hierarchy|module_dependency|call_flow; target is a symbol or module path, NOT a write destination)");
  }
  if (tools?.findDefinition) {
    lines.push("- Find symbol definition & implementation: sa_vm_run({ action: 'find_definition', symbol: 'targetSymbol', path: 'path/to/file.ext' })");
  }
  if (tools?.findReferences) {
    lines.push("- High-precision symbol references: sa_vm_run({ action: 'find_references', symbol: 'targetSymbol' }) or implementations: sa_vm_run({ action: 'find_implementations', symbol: 'InterfaceName', dir: 'src' })");
  }
  if (tools?.renameSymbol) {
    lines.push("- Safe AST symbol rename: sa_vm_run({ action: 'rename_symbol', symbol: 'OldName', new_name: 'NewName' })");
  }
  if (tools?.extractToFile) {
    lines.push("- Extract lines to new file and rewrite import: sa_vm_run({ action: 'extract_to_file', source: 'source.tsx', target: 'target.tsx', start_line: 10, end_line: 50 })");
  }
  if (tools?.moveWithImports) {
    lines.push("- Move file and rewrite relative import paths: sa_vm_run({ action: 'move_file_with_imports', from: 'old/path.ts', to: 'new/path.ts' })");
  }
  if (tools?.addImport) {
    lines.push("- Add / merge import statement: sa_vm_run({ action: 'add_import', path: 'src/App.tsx', statement: 'import { foo } from \"./bar\";' })");
  }
  if (tools?.getDiagnostics) {
    lines.push("- Instant TypeScript / syntax diagnostics check: sa_vm_run({ action: 'get_diagnostics', path: 'src/App.tsx' }) or workspace-wide aggregation: sa_vm_run({ action: 'workspace_diagnostics', dir: 'src', detail: false })");
    lines.push("- Re-verify changed files after edits: sa_vm_run({ action: 'verify_loop', files: ['src/App.tsx'] }) (alias: verify_changed)");
    lines.push("- Replay historical error cases to prevent regressions: sa_vm_run({ action: 'replay_case', component: 'miniBridge.ts' }) (alias: run_regression)");
    lines.push("- Record new regression case after bugfix: sa_vm_run({ action: 'record_case', id: 'CASE-004-xxx', title: '...', component: '...' })");
  }
  if (tools?.organizeImports) {
    lines.push("- Organize and remove unused imports: sa_vm_run({ action: 'organize_imports', path: 'src/App.tsx' })");
  }
  if (tools?.analyzeScope) {
    lines.push("- Analyze component scope, props & bindings for refactoring: sa_vm_run({ action: 'analyze_scope', path: 'src/App.tsx', start_line: 100, end_line: 200, component_name: 'Child' })");
  }
  if (tools?.clearToolHistory) {
    lines.push("- Prune redundant tool call history from context: sa_vm_run({ action: 'clear_tool_history' })");
  }
  if (tools?.jevChoose) {
    lines.push("- Autonomous fork decision: sa_vm_run({ action: 'jev_choose', question: '...', options: { a: '...' }, context: '...' })");
  }
  if (tools?.jevChecklist) {
    lines.push("- Autonomous delivery checklist: sa_vm_run({ action: 'jev_checklist', checks: { key: '...' }, context: '...' })");
  }
  if (tools?.jevEvaluate) {
    lines.push("- Raw JEV evaluation: sa_vm_run({ action: 'jev_evaluate', questions: { q: {...} }, context: '...' })");
  }
  if (tools?.jevThinking) {
    lines.push("- Pre-thinking adjudication: sa_vm_run({ action: 'jev_thinking', goal: '...', thoughts: { t1: '...' }, context: '...' })");
  }
  if (tools?.jevRedteam) {
    lines.push("- Red-team review: sa_vm_run({ action: 'jev_redteam', target: '...', context: '...' })");
  }
  if (tools?.jevRank) {
    lines.push("- Rank items: sa_vm_run({ action: 'jev_rank', items: { a: '...' }, criterion: 'ROI', context: '...' })");
  }
  if (tools?.jevScope) {
    lines.push("- Scope triage: sa_vm_run({ action: 'jev_scope', task: '...', phases: { p1: '...' }, context: '...' })");
  }
  if (tools?.jevDispatch) {
    lines.push("- Subagent dispatch gate (REQUIRED before Task/subagents fan-out): sa_vm_run({ action: 'jev_dispatch', question: '<task>...', options: { a: '...' }, context: 'max_parallel=3; 依赖说明', target: 'slots=3' }) (strategy single/parallel/sequential/parallel_batches + dispatch_plan)");
  }
  if (tools?.jevConsistency) {
    lines.push("- Consistency audit: sa_vm_run({ action: 'jev_consistency', plan: '...', constraints: { key: '...' }, context: '...' })");
  }
  if (tools?.jevDone) {
    lines.push("- Delivery sign-off: sa_vm_run({ action: 'jev_done', user_request: '...', actual_work: '...', evidence: '...' })");
  }
  if (tools?.jevDiagnose) {
    lines.push("- Root-cause arbitration: sa_vm_run({ action: 'jev_diagnose', error_summary: '...', hypotheses: { h1: '...' }, proposed_fix: '...', context: '...' })");
  }
  if (tools?.jevEdgeCases) {
    lines.push("- Boundary screen: sa_vm_run({ action: 'jev_edge_cases', code: '...', context: '...' })");
  }
  if (tools?.jevBlastRadius) {
    lines.push("- Blast-radius review: sa_vm_run({ action: 'jev_blast_radius', diff: '...', target_component: '...', context: '...' })");
  }
  if (tools?.jevIntent) {
    lines.push("- User-intent analysis: sa_vm_run({ action: 'jev_intent', question: '<raw user input>...', options: { a: '...' }, context: '...' })");
  }
  if (tools?.jevNext) {
    lines.push("- Next-task continuation: sa_vm_run({ action: 'jev_next', question: '<just-completed work>...', options: { a: '...' }, context: '<remaining backlog>...' })");
  }
  if (tools?.jevCompress) {
    lines.push("- Gated tool-history compression: sa_vm_run({ action: 'jev_compress', mode: 'subscription' | 'token' | 'auto', threshold: 85 }) (requires clear_tool_history; checklist gate -> add_memory -> clear_tool_history)");
  }
  if (tools?.jevProgress) {
    lines.push("- Task progress check (manual, long work only): sa_vm_run({ action: 'jev_progress', question: '<task>...', options: { p1: '...' }, content: '<completed>...', context: '...' }) (band + on_track/at_risk/blocked/done + next step)");
  }
  return lines.join("\n");
}

export function parseWorkbenchRuntime(input: Record<string, unknown>, fallback?: Partial<WorkbenchRuntime>): WorkbenchRuntime {
  const threadId = text(input.threadId) ?? fallback?.threadId ?? "";
  const model = text(input.model) ?? fallback?.model ?? "";
  const reasoningEffort = text(input.reasoningEffort) ?? fallback?.reasoningEffort ?? "medium";
  const permission = permissionValue(input.permission) ?? fallback?.permission ?? "dangerBypass";
  const agents = agentRuntimeOverride(input.agents, fallback?.agents);
  if (!threadId) throw new Error("threadId is required");
  if (!model) throw new Error("model is required");
  const raw = text(input.cliBackend) || (text(input.engine) === "pi" ? "pi" : text(input.engine) === "opencode" ? "opencode" : undefined);
  const cliBackend: CliBackend = raw === "claude" ? "claude" : raw === "agy" ? "agy" : raw === "auggie" ? "auggie" : raw === "grok" ? "grok" : raw === "pi" ? "pi" : raw === "opencode" ? "opencode" : raw === "opencode-v2" ? "opencode-v2" : raw === "mini" ? "mini" : (fallback?.cliBackend ?? "mini");
  const vmEnabled = input.vmEnabled === undefined ? fallback?.vmEnabled ?? false : input.vmEnabled === true;
  const vmPolicy = input.vmPolicy === undefined
    ? fallback?.vmPolicy ?? (vmEnabled ? createDefaultSaVmPolicyConfig() : undefined)
    : parseVmPolicy(input.vmPolicy);
  return {
    threadId,
    providerId: nullableText(input.providerId, fallback?.providerId),
    groupId: nullableText(input.groupId, fallback?.groupId),
    model,
    reasoningEffort,
    permission,
    agents,
    cliBackend,
    vmEnabled,
    ...(vmPolicy ? { vmPolicy } : {})
  };
}

function parseVmPolicy(value: unknown): SaVmPolicyConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as SaVmPolicyConfig;
}

export function workbenchThreadStartParams(input: Record<string, unknown>, runtime: WorkbenchRuntime, modelProvider: string): Record<string, JsonValue> {
  const cwd = text(input.cwd);
  if (!cwd) throw new Error("cwd is required");
  const permission = permissionToTurnOverrides(runtime.permission, cwd);
  const params: Record<string, JsonValue> = {
    cwd,
    sandbox: permission.sandbox,
    approvalPolicy: permission.approvalPolicy,
    sessionStartSource: "startup",
    historyMode: "legacy",
    model: runtime.model,
    modelProvider,
    providerId: runtime.providerId,
    groupId: runtime.groupId,
    cliBackend: runtime.cliBackend
  };
  const workspace = sshWorkspaceParams(input, runtime);
  const agentConfig = agentRuntimeThreadConfig(runtime.agents);
  if (agentConfig) params.config = agentConfig;
  if (workspace) params.workspace = workspace;
  return params;
}

function agentRuntimeOverride(value: unknown, fallback?: AgentRuntimeOverride): AgentRuntimeOverride {
  if (value === undefined) return fallback ?? { mode: "inherit", childCount: null, model: "", reasoningEffort: "", roles: [] };
  return parseAgentRuntimeOverride(value);
}

export function workbenchTurnStartParams(input: Record<string, unknown>, runtime: WorkbenchRuntime): Record<string, JsonValue> {
  const cwd = text(input.cwd);
  const prompt = text(input.text);
  if (!cwd) throw new Error("cwd is required");
  if (!prompt) throw new Error("text is required");
  const permission = permissionToTurnOverrides(runtime.permission, cwd);
  const params: Record<string, JsonValue> = {
    threadId: runtime.threadId,
    input: [{ type: "text", text: prompt, text_elements: [] }],
    cwd,
    sandboxPolicy: permission.sandboxPolicy,
    approvalPolicy: permission.approvalPolicy,
    effort: runtime.reasoningEffort,
    model: runtime.model
  };
  const workspace = sshWorkspaceParams(input, runtime);
  if (workspace) params.workspace = workspace;
  return params;
}

function sshWorkspaceParams(input: Record<string, unknown>, runtime: WorkbenchRuntime): Record<string, JsonValue> | null {
  if (text(input.workspaceMode) !== "ssh") return null;
  const command = text(input.sshCommand);
  const cwd = text(input.sshCwd) ?? text(input.cwd);
  if (!command || !cwd) throw new Error("SSH workspace requires sshCommand and sshCwd");
  return {
    type: "ssh",
    command,
    cwd,
    providerId: runtime.providerId,
    groupId: runtime.groupId
  };
}

export function createWorkbenchLayout(threadIdsInput: unknown, presetInput: unknown): Record<string, JsonValue> | null {
  const threadIds = Array.isArray(threadIdsInput)
    ? threadIdsInput.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
    : [];
  if (threadIds.length === 0) return null;
  if (threadIds.length > 6 || new Set(threadIds).size !== threadIds.length) throw new Error("Layout requires 1-6 unique threadIds");
  const preset = WORKBENCH_LAYOUT_PRESETS.includes(presetInput as WorkbenchLayoutPreset)
    ? presetInput as WorkbenchLayoutPreset
    : "columns";
  const panes = threadIds.map((threadId, index) => ({ id: `pane-${index + 1}`, threadId }));
  const pane = (index: number): Record<string, JsonValue> => ({ type: "pane", paneId: panes[index]!.id });
  const split = (direction: "horizontal" | "vertical", children: Record<string, JsonValue>[], id: string): Record<string, JsonValue> => ({
    type: "split", id, direction, children, sizes: children.map(() => 1 / children.length)
  });
  const nodes = panes.map((_, index) => pane(index));
  let root = nodes[0]!;
  if (preset === "left-one-right-two" && nodes.length >= 3) root = split("horizontal", [nodes[0]!, split("vertical", [nodes[1]!, nodes[2]!], "split-right")], "split-root");
  else if (preset === "left-two-right-one" && nodes.length >= 3) root = split("horizontal", [split("vertical", [nodes[0]!, nodes[1]!], "split-left"), nodes[2]!], "split-root");
  else if (preset === "grid-2x2" && nodes.length >= 4) root = split("vertical", [split("horizontal", nodes.slice(0, 2), "split-top"), split("horizontal", nodes.slice(2, 4), "split-bottom")], "split-root");
  else if (preset === "grid-2x3" && nodes.length >= 6) root = split("vertical", [split("horizontal", nodes.slice(0, 3), "split-top"), split("horizontal", nodes.slice(3, 6), "split-bottom")], "split-root");
  else if (nodes.length > 1) root = split(preset === "rows" ? "vertical" : "horizontal", nodes, "split-root");
  return { version: 2, root, panes, focusedPaneId: panes[0]!.id, maximizedPaneId: null };
}

export function applyWorkbenchLayoutAction(currentInput: unknown, input: Record<string, unknown>): Record<string, JsonValue> | null {
  const action = text(input.action) ?? "set";
  if (action === "clear") return null;
  if (action === "set") return input.workspaceLayout === undefined
    ? createWorkbenchLayout(input.threadIds, input.preset)
    : validateWorkbenchLayout(input.workspaceLayout);
  const current = validateWorkbenchLayout(currentInput);
  if (!current) throw new Error("An active workspace layout is required");
  const panes = current.panes as Array<{ id: string; threadId: string }>;
  const paneId = text(input.paneId) ?? "";
  const pane = panes.find((entry) => entry.id === paneId);
  if (!pane) throw new Error(`Pane not found: ${paneId}`);
  if (action === "focus") return { ...current, focusedPaneId: paneId };
  if (action === "maximize") return { ...current, maximizedPaneId: current.maximizedPaneId === paneId ? null : paneId };
  if (action === "replace") {
    const threadId = text(input.threadId);
    if (!threadId) throw new Error("threadId is required");
    if (panes.some((entry) => entry.threadId === threadId && entry.id !== paneId)) throw new Error("threadId is already visible");
    return { ...current, panes: panes.map((entry) => entry.id === paneId ? { ...entry, threadId } : entry), focusedPaneId: paneId };
  }
  if (action === "close") {
    if (panes.length <= 1) return null;
    const root = removePane(current.root, paneId);
    const nextPanes = panes.filter((entry) => entry.id !== paneId);
    return validateWorkbenchLayout({ ...current, root, panes: nextPanes, focusedPaneId: nextPanes[0]!.id, maximizedPaneId: null });
  }
  if (action === "split") {
    if (panes.length >= 6) throw new Error("Workspace layout supports at most 6 visible panes");
    const threadId = text(input.threadId);
    if (!threadId || panes.some((entry) => entry.threadId === threadId)) throw new Error("A unique threadId is required");
    const direction = text(input.direction);
    if (!direction || !["left", "right", "up", "down"].includes(direction)) throw new Error("direction must be left, right, up or down");
    const newPaneId = `pane-${Date.now().toString(36)}`;
    const root = insertPane(current.root, paneId, newPaneId, direction as "left" | "right" | "up" | "down");
    return validateWorkbenchLayout({ ...current, root, panes: [...panes, { id: newPaneId, threadId }], focusedPaneId: newPaneId, maximizedPaneId: null });
  }
  throw new Error(`Unsupported layout action: ${action}`);
}

export function validateWorkbenchLayout(value: unknown): Record<string, JsonValue> | null {
  if (value === null) return null;
  const layout = record(value);
  const panes = Array.isArray(layout.panes) ? layout.panes.map(record) : [];
  if (layout.version !== 2 || panes.length < 1 || panes.length > 6) throw new Error("Invalid workspace layout");
  const ids = panes.map((pane) => text(pane.id));
  const threads = panes.map((pane) => text(pane.threadId));
  if (ids.some((id) => !id) || threads.some((id) => !id) || new Set(ids).size !== ids.length || new Set(threads).size !== threads.length) throw new Error("Layout panes must be unique");
  const nodeIds = collectPaneIds(layout.root);
  if (nodeIds.length !== ids.length || nodeIds.some((id) => !ids.includes(id))) throw new Error("Layout tree does not match panes");
  return layout as Record<string, JsonValue>;
}

function collectPaneIds(value: unknown): string[] {
  const node = record(value);
  if (node.type === "pane") return text(node.paneId) ? [text(node.paneId)!] : [];
  if (node.type !== "split" || !Array.isArray(node.children) || node.children.length < 2) throw new Error("Invalid layout tree");
  return node.children.flatMap(collectPaneIds);
}
function removePane(value: unknown, paneId: string): JsonValue {
  const node = record(value);
  if (node.type === "pane") return node.paneId === paneId ? null : node as JsonValue;
  const children = (node.children as unknown[]).map((child) => removePane(child, paneId)).filter((child) => child !== null);
  if (children.length === 1) return children[0]!;
  return { ...node, children, sizes: children.map(() => 1 / children.length) } as JsonValue;
}
function insertPane(value: unknown, paneId: string, newPaneId: string, direction: "left" | "right" | "up" | "down"): JsonValue {
  const node = record(value);
  if (node.type === "pane" && node.paneId === paneId) {
    const oldPane = node as JsonValue;
    const newPane = { type: "pane", paneId: newPaneId };
    const before = direction === "left" || direction === "up";
    return { type: "split", id: `split-${newPaneId}`, direction: direction === "left" || direction === "right" ? "horizontal" : "vertical", children: before ? [newPane, oldPane] : [oldPane, newPane], sizes: [0.5, 0.5] };
  }
  if (node.type !== "split") return node as JsonValue;
  return { ...node, children: (node.children as unknown[]).map((child) => insertPane(child, paneId, newPaneId, direction)) } as JsonValue;
}

export function contextUsageView(tokenUsage: unknown): Record<string, JsonValue> | null {
  const usage = record(tokenUsage);
  const total = record(usage.total);
  const last = record(usage.last ?? usage.last_usage ?? usage.lastUsage);
  const usedTokens = number(last.totalTokens) ?? number(last.inputTokens) ?? number(total.totalTokens) ?? number(total.inputTokens) ?? 0;
  const contextWindow = number(usage.modelContextWindow) ?? 0;
  if (contextWindow <= 0) return null;
  return {
    usedTokens,
    contextWindow,
    percent: Math.round(Math.min(100, Math.max(0, usedTokens / contextWindow * 100)) * 100) / 100,
    tokenUsage: usage as JsonValue
  };
}

export function isUnmaterializedThreadError(error: unknown): boolean {
  const value = record(error);
  const nested = record(value.error);
  const message = error instanceof Error
    ? error.message
    : text(value.message) ?? text(nested.message) ?? String(error);
  return /not materialized yet|unavailable before first user message/i.test(message);
}

export function isTransientThreadMetadataError(error: unknown): boolean {
  const value = record(error);
  const nested = record(value.error);
  const message = error instanceof Error
    ? error.message
    : text(value.message) ?? text(nested.message) ?? String(error);
  return isUnmaterializedThreadError(error) || /rollout .* is empty|session metadata .* is empty/i.test(message);
}

function permissionValue(value: unknown): PermissionPresetId | undefined {
  return value === "readonlyAsk" || value === "workspaceAsk" || value === "fullAsk" || value === "dangerBypass" ? value : undefined;
}
function nullableText(value: unknown, fallback: string | null | undefined): string | null {
  return value === null ? null : text(value) ?? fallback ?? null;
}
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function record(value: unknown): Record<string, unknown> { return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }



