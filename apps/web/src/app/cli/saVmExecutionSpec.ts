import type { CliBackend, JsonValue } from "@codex-ui/shared";
import type { ThreadRuntimeSelection } from "../runtime/useThreadRuntimeSelections";
import { buildCliBackendGuideSections, resolveCliSkillPath } from "./cliSkillGuides";

export function saVmDynamicToolSpec(policy?: ThreadRuntimeSelection["vmPolicy"]): JsonValue {
  const allowJs = policy?.execution?.javascript === true;
  const allowPy = policy?.execution?.python === true;
  const allowHttp = Boolean(policy?.http?.allow && policy.http.allow.length > 0);
  const allowClearHistory = policy?.tools?.clearToolHistory === true;
  const allowFindReferences = policy?.tools?.findReferences === true;
  const allowRenameSymbol = policy?.tools?.renameSymbol === true;
  const allowFileOutline = policy?.tools?.fileOutline === true;
  const allowMoveWithImports = policy?.tools?.moveWithImports === true;
  const allowFindDefinition = policy?.tools?.findDefinition === true;
  const allowExtractToFile = policy?.tools?.extractToFile === true;
  const allowAddImport = policy?.tools?.addImport === true;
  const allowGetDiagnostics = policy?.tools?.getDiagnostics === true;
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

  const actions = [
    "read_file", "read_lines", "read_file_tail", "find_files", "write_file", "edit_file",
    "apply_patch", "delete_file", "copy_file", "move_file", "file_info",
    "list_dir", "grep_search", "grep_search_async"
  ];
  if (allowClearHistory) actions.push("clear_tool_history");
  if (allowFindReferences) actions.push("find_references");
  if (allowFileOutline) actions.push("file_outline");
  if (allowRenameSymbol) actions.push("rename_symbol");
  if (allowMoveWithImports) actions.push("move_file_with_imports");
  if (allowFindDefinition) actions.push("find_definition");
  if (allowExtractToFile) actions.push("extract_to_file");
  if (allowAddImport) actions.push("add_import");
  if (allowGetDiagnostics) actions.push("get_diagnostics");
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
    description: "Run Safe Language (SLA) or high-level actions inside the hardened SA-VM sandbox. Recommended: pass 'action' (e.g. read_file, write_file, edit_file, find_files, file_outline, find_definition, rename_symbol, move_file_with_imports, extract_to_file, add_import, get_diagnostics, jev_choose, jev_checklist, jev_evaluate, jev_thinking, jev_redteam, jev_rank, jev_scope, jev_dispatch, jev_consistency, jev_done, jev_diagnose, jev_edge_cases, jev_blast_radius, jev_intent, jev_next) and 'path' to run without writing SLA. JEV helpers need question+options / checks / questions / goal+thoughts / target / items+criterion / task+phases / plan+constraints / request+work+evidence / error+hypotheses+fix / code / diff plus context. Advanced: pass 'source' with complete SLA.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        action: {
          type: "string",
          enum: actions,
          description: "RECOMMENDED SHORTCUT: Run packaged operations without writing SLA. 'read_file' reads file; 'write_file' writes; 'apply_patch' patches; 'grep_search' searches files; 'grep_search_async' runs high-performance async search; 'clear_tool_history' prunes context; 'find_references' finds symbol definitions, imports, and calls with token-saving enum compression; 'file_outline' extracts structural symbols; 'find_definition' jumps to declaration & implementation; 'rename_symbol' safely renames code symbols; 'move_file_with_imports' moves files updating imports; 'extract_to_file' splits code to new file; 'add_import' inserts or merges imports; 'get_diagnostics' checks single-file syntax; 'run_project_check' runs predefined project profiles; 'run_bun' runs secure Bun commands; 'run_host' runs structured host binaries (sa, sla, zig, git) with caching and slicing; safe git writes (checkout/switch/fetch) go through run_host with exe 'git', destructive git (clean/revert/reset --hard) stays blocked."
        },
        exe: { type: "string", description: "Target executable for 'run_host' (e.g. 'sa', 'sla', 'zig', 'git', or workspace binary)." },
        cwd: { type: "string", description: "Working directory for 'run_host' (must be inside workspace)." },
        env: { type: "object", description: "Environment variable overrides for 'run_host' (allowlisted keys only)." },
        head_lines: { type: "integer", description: "For 'run_host': keep only first N lines of output." },
        tail_lines: { type: "integer", description: "For 'run_host': keep only last N lines of output." },
        profile: { type: "string", description: "Project check profile name (e.g. 'web-typecheck', 'server-typecheck', 'root-typecheck', 'server-test-file', 'web-build') for 'run_project_check'." },
        test_file: { type: "string", description: "Target test file relative path for '*-test-file' profiles (e.g. 'tests/server/saVmTool.test.ts')." },
        subcommand: { type: "string", description: "Subcommand for 'run_bun' (e.g. 'test', 'build', 'run')." },
        filter: { type: "string", description: "Workspace filter for 'run_bun' or project checks." },
        symbol: { type: "string", description: "Target symbol name for 'find_references'." },
        detail: { type: "boolean", description: "For 'find_references': whether to include code text (default false: only line and enum e0/e1/e2)." },
        candidate_files: { type: "array", items: { type: "string" }, description: "For 'find_references': candidate files or paths for targeted exploration." },
        max_results: { type: "integer", description: "For 'find_references': maximum references to return (default 50)." },
        path: { type: "string", description: "Target file path or directory for the action (e.g. '.agents/skills/sa-vm/SKILL.md', '.codex/skills/sa-vm/SKILL.md', or 'src/main.ts')." },
        content: { type: "string", description: "Content to write for 'write_file' or script source." },
        patch: { type: "string", description: "Unified diff patch starting with '*** Begin Patch' and ending with '*** End Patch' for 'apply_patch'." },
        old_text: { type: "string", description: "Existing text snippet to find and replace for 'edit_file'." },
        new_text: { type: "string", description: "New replacement text for 'edit_file'." },
        old_name: { type: "string", description: "Target symbol name to rename for 'rename_symbol'." },
        new_name: { type: "string", description: "Replacement symbol name for 'rename_symbol'." },
        statement: { type: "string", description: "Import statement for 'add_import' (e.g. 'import { t } from \"./i18n\";')." },
        include_body: { type: "boolean", description: "Whether to include the implementation code snippet for 'find_definition' (default true)." },
        dry_run: { type: "boolean", description: "If true, previews changes without writing to disk for 'rename_symbol', 'move_file_with_imports', 'extract_to_file', or 'add_import'." },
        from: { type: "string", description: "Source path for 'move_file', 'copy_file', 'move_file_with_imports', or 'extract_to_file'." },
        to: { type: "string", description: "Destination path for 'move_file', 'copy_file', 'move_file_with_imports', or 'extract_to_file'." },
        start_line: { type: "integer", description: "1-based starting line for 'read_lines' (default 1)." },
        end_line: { type: "integer", description: "1-based ending line for 'read_lines' (default start_line + 100)." },
        dir: { type: "string", description: "Directory to search for 'find_files', 'list_dir', or grep actions (default '.')." },
        query: { type: "string", description: "Text query for 'grep_search' or 'grep_search_async'." },
        pattern: { type: "string", description: "Glob pattern for 'find_files' or grep actions (e.g. '*.ts')." },
        keep_last_n_turns: { type: "integer", description: "For 'clear_tool_history': number of recent turns of tool outputs to keep (default 2)." },
        filter_tools: { type: "array", items: { type: "string" }, description: "For 'clear_tool_history': tool names to prune (default read and grep tools)." },
        reason: { type: "string", description: "Reason for pruning tool history." },
        question: { type: "string", description: "Decision question for 'jev_choose' (2-6 options) or goal description" },
        options: { type: "object", description: "Choice options map for 'jev_choose' (e.g. { a: 'desc A', b: 'desc B' })", additionalProperties: true },
        checks: { type: "object", description: "Checklist items map for 'jev_checklist' (e.g. { no_placeholders: '...' })", additionalProperties: true },
        questions: { type: "object", description: "Custom questions map for 'jev_evaluate' passthrough", additionalProperties: true },
        goal: { type: "string", description: "Thinking goal for 'jev_thinking'" },
        thoughts: { type: "object", description: "Candidate lines of thought for 'jev_thinking' (1-4 entries; '__act_now' brake is built in)", additionalProperties: true },
        target: { type: "string", description: "Plan or decision under red-team review for 'jev_redteam'" },
        items: { type: "object", description: "Items map to rank for 'jev_rank' (2-6 entries)", additionalProperties: true },
        criterion: { type: "string", description: "Ranking criterion for 'jev_rank' (e.g. 'ROI')" },
        task: { type: "string", description: "Task under scope triage for 'jev_scope'" },
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
        context: { type: "string", description: "Supporting context for 'jev_choose' / 'jev_checklist' / 'jev_evaluate' / 'jev_thinking' / 'jev_redteam'" },
        max_bytes: { type: "integer", description: "Maximum bytes to read (default 65536)." },
        timeout_ms: { type: "integer", description: "Timeout limit in milliseconds for time-consuming operations (e.g. grep_search, find_references, find_files, http_fetch)." },
        timeout: { type: "integer", description: "Timeout limit in seconds or milliseconds for time-consuming operations (e.g. 15 for 15s)." },
        source: { type: "string", description: "Advanced: Complete SLA source code for custom VM computation." },
        parallel: { type: "array", maxItems: 32, description: "Run multiple independent SLA tasks or actions through a bounded VM worker pool (preferred for multi-file content writes, e.g. parallel edit_file or write_file).", items: { type: "object", additionalProperties: true } },
        concurrency: { type: "integer", minimum: 1, maximum: 8, description: "Maximum simultaneous SLA VM tasks (default: task count, capped at 8)." },
        language: { type: "string", enum: ["sla"], description: "Language for custom source (default: 'sla')." },
        args: { type: "array", items: { type: "string" } },
        requested_caps: {
          type: "object",
          description: "Capabilities required by the SLA script. Example: { fs: ['path/to/file'] } or { fs: [{ op: 'read', path: 'path/to/file' }] }",
          properties: {
            fs: {
              type: "array",
              description: "Filesystem paths or objects with op and path. String paths default to read access.",
              items: {
                anyOf: [
                  { type: "string", description: "Path to grant read access" },
                  {
                    type: "object",
                    properties: {
                      op: { type: "string", enum: ["read", "write", "append", "edit", "create", "delete", "rename", "metadata"] },
                      path: { type: "string" }
                    }
                  }
                ]
              }
            },
            net: { type: "array" },
            env: { type: "array", items: { type: "string" } },
            process: { type: "boolean", description: "Allow SLA process exec/spawn symbols; default false." }
          }
        },
        limits: { type: "object" }
      }
    }
  };
}

export function saVmDeveloperInstructions(policy: ThreadRuntimeSelection["vmPolicy"], cliBackend?: CliBackend): string {
  const normSkill = resolveCliSkillPath(cliBackend);

  const tools = policy?.tools;
  const replaceRead = tools?.replaceRead === true;
  const replaceApplyPatch = tools?.replaceApplyPatch === true;
  const replaceExec = tools?.replaceExec === true;

  const readGuide = replaceRead
    ? "READING FILES: System read tools are replaced with packaged tools. You MUST read files using sa_vm_run with action: 'read_file' or 'read_lines'. DO NOT write raw SLA code."
    : "READING FILES: System read tools are enabled. You may use system tools or safe read commands to inspect files, read skills, and browse the workspace.";

  const patchGuide = replaceApplyPatch
    ? "PATCHING FILES: apply_patch is handled by broker with strict per-path checking and backup."
    : "PATCHING FILES: System native apply_patch is enabled.";

  const execGuide = replaceExec
    ? "CRITICAL: Host shell, terminal, bash, PowerShell, cmd commands are strictly managed. You MUST use the packaged sa_vm_run tool with action shortcuts (e.g. action: 'find_files', 'read_file', 'write_file', 'edit_file', 'grep_search', 'apply_patch'). DO NOT write raw SLA code."
    : "CRITICAL: Host shell, terminal, Python, Node, and Bun command execution is disabled in SA-VM mode and cannot bypass the sandbox. All operations must use the packaged sa_vm_run function tools.";

  const optionalGuides: string[] = [];
  let nextIdx = 14;
  if (policy?.tools?.findReferences === true) {
    optionalGuides.push(`${nextIdx++}. High-precision symbol references search:\n    sa_vm_run({ "action": "find_references", "symbol": "targetSymbol" })`);
  }
  if (policy?.tools?.fileOutline === true) {
    optionalGuides.push(`${nextIdx++}. Extract file outline (structural declarations & line ranges):\n    sa_vm_run({ "action": "file_outline", "path": "path/to/file.ext" })`);
  }
  if (policy?.tools?.renameSymbol === true) {
    optionalGuides.push(`${nextIdx++}. Safe symbol rename (AST-aware, skipping comments/strings):\n    sa_vm_run({ "action": "rename_symbol", "symbol": "OldName", "new_name": "NewName" })`);
  }
  if (policy?.tools?.moveWithImports === true) {
    optionalGuides.push(`${nextIdx++}. Move file and rewrite relative import paths:\n    sa_vm_run({ "action": "move_file_with_imports", "from": "old/path.ts", "to": "new/path.ts" })`);
  }
  if (policy?.tools?.findDefinition === true) {
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

  const { agyGuide, opencodeGuide, claudeGuide } = buildCliBackendGuideSections(cliBackend);

  return `${agyGuide}${opencodeGuide}${claudeGuide}Packaged function tools are active for this conversation. Skill guide: ${normSkill}.
${execGuide}
${readGuide}
${patchGuide}

============================================================
PRIMARY INSTRUCTION: DO NOT WRITE RAW SLA CODE.
DO NOT use language="sla" or raw source code.
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
9. Grep search text in files:
   sa_vm_run({ "action": "grep_search", "query": "keyword", "dir": "." })
10. Delete file safely (with backup):
    sa_vm_run({ "action": "delete_file", "path": "path/to/file.ext" })
11. Move / rename file:
    sa_vm_run({ "action": "move_file", "from": "old/path", "to": "new/path" })
12. Copy file:
    sa_vm_run({ "action": "copy_file", "from": "source/path", "to": "dest/path" })
13. Get file info / metadata:
    sa_vm_run({ "action": "file_info", "path": "path/to/file.ext" })${optionalGuideBlock}
============================================================
All filesystem, network, environment, and process operations must stay within this thread's policy; out-of-policy requests are denied.`;
}

export function enhanceDynamicToolSpec(policy?: ThreadRuntimeSelection["vmPolicy"]): JsonValue {
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

  const actions: string[] = [];
  if (allowPatch) actions.push("apply_patch");
  if (allowEdit) actions.push("edit_file", "write_file");
  if (allowRead) actions.push("read_file", "read_lines", "read_file_tail", "count_lines");
  if (allowSearch) actions.push("find_files", "list_dir", "grep_search", "grep_search_async", "file_info");
  if (allowFindReferences) actions.push("find_references");
  if (allowFileOutline) actions.push("file_outline");
  if (allowRenameSymbol) actions.push("rename_symbol");
  if (allowMoveWithImports) actions.push("move_file_with_imports");
  if (allowFindDefinition) actions.push("find_definition");
  if (allowExtractToFile) actions.push("extract_to_file");
  if (allowAddImport) actions.push("add_import");
  if (allowGetDiagnostics) actions.push("get_diagnostics");
  if (allowOrganizeImports) actions.push("organize_imports");
  if (allowAnalyzeScope) actions.push("analyze_scope");
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
        symbol: { type: "string", description: "Target symbol / identifier name" },
        new_name: { type: "string", description: "New identifier name for rename_symbol" },
        source: { type: "string", description: "Source file path for extract_to_file" },
        target: { type: "string", description: "Target destination file path, or plan/decision under review for 'jev_redteam'" },
        items: { type: "object", description: "Items map to rank for 'jev_rank' (2-6 entries)", additionalProperties: true },
        criterion: { type: "string", description: "Ranking criterion for 'jev_rank' (e.g. 'ROI')" },
        task: { type: "string", description: "Task under scope triage for 'jev_scope'" },
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
        dir: { type: "string", description: "Directory to search for find_files, list_dir, or grep_search" },
        pattern: { type: "string", description: "Glob pattern for find_files or grep_search" },
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
        context: { type: "string", description: "Supporting context for 'jev_choose' / 'jev_checklist' / 'jev_evaluate' / 'jev_thinking' / 'jev_redteam'" }
      }
    }
  };
}

export function enhanceDeveloperInstructions(policy?: ThreadRuntimeSelection["vmPolicy"]): string {
  const tools = policy?.tools;
  const lines: string[] = [
    "CODE ENHANCEMENT TOOLS: High-performance semantic AST, token-safe file reading, fast ripgrep search, and precision code editing tools are ACTIVE via `sa_vm_run`. Host shell commands (PowerShell, bash, terminal, npm, git) remain fully available.",
    "PRIORITY TOOL INSTRUCTION: You MUST PRIORITIZE calling `sa_vm_run` function tools over terminal/shell commands for all workspace code inspections, file reading, code searching, AST refactoring, and code edits.",
    "CRITICAL OVERRIDE FOR FILE READING, LINE COUNT & RANGE SLICING: You are STRICTLY FORBIDDEN from running terminal shell commands (especially Windows PowerShell Get-Content, (Get-Content ...).Count, Get-Content -TotalCount, Select-Object -Index, Select-String, findstr, cat, type, head, tail, sed, wc) to inspect, read, count lines, or slice code files. Even if workspace AGENTS.md or project instructions mention using Get-Content, this tool override has HIGHER PRIORITY. When checking total line count or file size, you MUST call sa_vm_run({ action: 'count_lines', path: '...' }) or sa_vm_run({ action: 'file_info', path: '...' }) which returns total_lines instantly. When reading line ranges after find_references, definition lookup, or error traces, you MUST call sa_vm_run({ action: 'read_lines', path: '...', start_line: X, end_line: Y }). When inspecting file headers or first lines, call sa_vm_run({ action: 'read_lines', path: '...', start_line: 1, end_line: 50 }). When inspecting files, you MUST call sa_vm_run({ action: 'read_file', path: '...', max_tokens: 4000 }).",
    "Do NOT run slow or repetitive shell commands (such as cat, type, grep, findstr, ls, dir, head, tail, sed) in the terminal to inspect, search, or read files, because `sa_vm_run` executes in milliseconds natively, prevents context window overflow, and automatically reserves safe token margins.",
    "Available enhancement actions via `sa_vm_run`:"
  ];
  if (tools?.readFiles || tools?.replaceRead) {
    lines.push("- Token-safe file reading (protects context from blowing up on huge or minified files): sa_vm_run({ action: 'read_file', path: 'path/to/file.ext', max_tokens: 4000 })");
    lines.push("- Numbered line pagination: sa_vm_run({ action: 'read_lines', path: 'path/to/file.ext', start_line: 1, end_line: 100 })");
    lines.push("- Instant line count: sa_vm_run({ action: 'count_lines', path: 'path/to/file.ext' })");
    lines.push("- Fast log tailing from end of file: sa_vm_run({ action: 'read_file_tail', path: 'build.log', max_lines: 100 })");
  }
  lines.push("- Run structured host binary (sa, sla, zig) with caching & slicing: sa_vm_run({ action: 'run_host', exe: 'sla', args: ['--help'] })");
  if (tools?.fastSearch) {
    lines.push("- Fast ripgrep search: sa_vm_run({ action: 'grep_search', query: 'pattern', dir: '.' })");
    lines.push("- High-concurrency async multi-query search: sa_vm_run({ action: 'grep_search_async', queries: ['query1', 'query2'] })");
    lines.push("- Glob file discovery: sa_vm_run({ action: 'find_files', pattern: '*.ts' })");
    lines.push("- Fast directory listing: sa_vm_run({ action: 'list_dir', dir: '.' })");
    lines.push("- File metadata & total line count: sa_vm_run({ action: 'file_info', path: 'path/to/file.ext' })");
  }
  if (tools?.editFiles || tools?.replaceWrite) {
    lines.push("- Precision string replacement (avoids whole-file rewrites): sa_vm_run({ action: 'edit_file', path: 'path/to/file.ext', old_text: 'old', new_text: 'new' })");
    lines.push("- Atomic file write: sa_vm_run({ action: 'write_file', path: 'path/to/file.ext', content: 'contents' })");
  }
  if (tools?.applyPatch || tools?.replaceApplyPatch) {
    lines.push("- Multi-file unified diff patch: sa_vm_run({ action: 'apply_patch', patch: '*** Begin Patch\\n...' })");
  }
  if (tools?.fileOutline) {
    lines.push("- Extract file outline (classes, functions, types, line ranges): sa_vm_run({ action: 'file_outline', path: 'path/to/file.ext' })");
  }
  if (tools?.findDefinition) {
    lines.push("- Find symbol definition & implementation: sa_vm_run({ action: 'find_definition', symbol: 'targetSymbol', path: 'path/to/file.ext' })");
  }
  if (tools?.findReferences) {
    lines.push("- High-precision symbol references: sa_vm_run({ action: 'find_references', symbol: 'targetSymbol' })");
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
    lines.push("- Instant TypeScript / syntax diagnostics check: sa_vm_run({ action: 'get_diagnostics', path: 'src/App.tsx' })");
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
    lines.push("- Subagent dispatch gate (REQUIRED before Task/subagents fan-out): sa_vm_run({ action: 'jev_dispatch', question: '<task>...', options: { a: '...' }, context: 'max_parallel=3', target: 'slots=3' })");
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
  return lines.join("\n");
}

export function buildSaVmThreadConfig(agentConfig: Record<string, JsonValue> | undefined, _vmEnabled: boolean): Record<string, JsonValue> | undefined {
  return agentConfig;
}
