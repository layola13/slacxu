/** SA-VM tool protocol contract types (R2: owned by the SDK).
 *
 * These types are the wire contract between the host's SA-VM tool
 * dispatcher and plugin-side engines (JEV) and bridges (Mini): the
 * single class identity for SaVmInputError / SaVmCapabilityDeniedError
 * lives here so `instanceof` checks agree across host and plugins.
 * The host's saVmTool.ts re-exports everything for compatibility.
 */
import type { SaVmPolicyConfig } from "../shared-types.js";

export type SaVmFsCapability = { op: "read" | "write" | "append" | "edit" | "create" | "delete" | "rename" | "metadata"; path: string };
export type SaVmNetCapability = { url: string; methods?: string[] };

export type SaVmActionType =
  | "read"
  | "read_file"
  | "read_lines"
  | "read_file_tail"
  | "tail_file"
  | "tail"
  | "read_many"
  | "read_files"
  | "find"
  | "find_files"
  | "list_files"
  | "write"
  | "write_file"
  | "edit"
  | "edit_file"
  | "apply_patch"
  | "patch"
  | "delete"
  | "delete_file"
  | "remove_file"
  | "safe_delete"
  | "move"
  | "move_file"
  | "rename"
  | "rename_file"
  | "copy"
  | "copy_file"
  | "stat"
  | "file_info"
  | "test_path"
  | "file_exists"
  | "exists"
  | "ensure_dir"
  | "mkdir"
  | "vm-read"
  | "vm_read"
  | "count_lines"
  | "line_count"
  | "list_dir"
  | "grep"
  | "grep_search"
  | "grep_async"
  | "grep_search_async"
  | "async_grep"
  | "http_fetch"
  | "fetch"
  | "run_js"
  | "exec_js"
  | "run_py"
  | "run_python"
  | "exec_py"
  | "clear_tool_history"
  | "prune_tool_history"
  | "find_references"
  | "find_all_references"
  | "find_implementations"
  | "find_impl"
  | "implementations"
  | "file_outline"
  | "outline"
  | "workspace_outline"
  | "outline_many"
  | "project_outline"
  | "repo_map"
  | "repo-map"
  | "code_graph"
  | "relation_graph"
  | "symbol_graph"
  | "rename_symbol"
  | "symbol_rename"
  | "move_file_with_imports"
  | "move_with_imports"
  | "find_definition"
  | "goto_definition"
  | "def"
  | "extract_to_file"
  | "extract_file"
  | "extract_module"
  | "add_import"
  | "insert_import"
  | "get_diagnostics"
  | "diagnostics"
  | "check_syntax"
  | "workspace_diagnostics"
  | "project_diagnostics"
  | "all_diagnostics"
  | "organize_imports"
  | "clean_unused_imports"
  | "sort_imports"
  | "analyze_scope"
  | "scope_analysis"
  | "extract_component"
  | "extract_hook"
  | "auto_fix_missing_imports"
  | "fix_missing_imports"
  | "analyze_coupling"
  | "cluster_symbols"
  | "atomic_refactor"
  | "refactor_dry_run"
  | "split_plan"
  | "split_stage"
  | "split_refine"
  | "split_repair"
  | "split_status"
  | "verify_loop"
  | "verify-loop"
  | "verify_changed"
  | "replay_case"
  | "record_case"
  | "run_regression"
  | "regression_replay"
  | "git_status"
  | "git-status"
  | "git_diff"
  | "git-diff"
  | "git_log"
  | "git-log"
  | "run_bun"
  | "run_bun_profile"
  | "run_project_check"
  | "project_check"
  | "run_host"
  | "exec_host"
  | "host"
  | "save_note"
  | "add_note"
  | "read_notes"
  | "read_note"
  | "list_notes"
  | "search_notes"
  | "search_note"
  | "delete_note"
  | "remove_note"
  | "clear_notes"
  | "add_memory"
  | "edit_memory"
  | "save_memory"
  | "read_memory"
  | "search_memory"
  | "list_memory"
  | "delete_memory"
  | "remove_memory"
  | "clear_memory"
  | "write_stdin"
  | "stdin"
  | "input_stdin"
  | "session_status"
  | "read_session"
  | "poll_session"
  | "kill_session"
  | "kill_process"
  | "stop_session"
  | "list_sessions"
  | "local_checkpoint"
  | "checkpoint"
  | "git_checkpoint"
  | "restore_checkpoint"
  | "restore_git_checkpoint"
  | "jev_choose"
  | "jev_select"
  | "jev_checklist"
  | "jev_multi_choice"
  | "jev_evaluate"
  | "jev_thinking"
  | "jev_think"
  | "jev_redteam"
  | "jev_red"
  | "jev_rank"
  | "jev_scope"
  | "jev_dispatch"
  | "jev_allocate"
  | "jev_delegate"
  | "jev_consistency"
  | "jev_done"
  | "jev_diagnose"
  | "jev_edge_cases"
  | "jev_blast_radius"
  | "jev_intent"
  | "jev_next"
  | "jev_progress"
  | "jev_memory"
  | "ledger_status"
  | "accountability_status"
  | "vm_reputation"
  | "reputation_status"
  | "record_penalty"
  | "penalize"
  | "submit_redemption"
  | "redeem_penalty"
  | "claim_reward"
  | "get_antibodies"
  | "list_antibodies";


export type SaVmRunInput = {
  /** Built-in action shortcut. Automatically expands to standard native operations or SLA. */
  action?: SaVmActionType | string;
  path?: string;
  file?: string;
  dest?: string;
  target?: string;
  filePath?: string;
  file_path?: string;
  targetFile?: string;
  target_file?: string;
  filename?: string;
  fileName?: string;
  AbsolutePath?: string;
  absolute_path?: string;
  uri?: string;
  content?: string;
  profile?: string;
  subcommand?: string;
  filter?: string;
  test_file?: string;
  keep_last_n_turns?: number;
  filter_tools?: string[];
  reason?: string;
  key?: string;
  topic?: string;
  title?: string;
  memory?: string;
  all?: boolean;
  fact?: string;
  value?: string;
  text?: string;
  level?: NotePriorityLevel | string;
  priority?: NotePriorityLevel | string;
  importance?: NotePriorityLevel | string;
  symbol?: string;
  old_name?: string;
  new_name?: string;
  statement?: string;
  import_statement?: string;
  symbols?: string[] | string;
  exported_symbols?: string[] | string;
  component_name?: string;
  hook_name?: string;
  top_n?: number;
  topN?: number;
  ops?: Array<{ path: string; content?: string; patch?: string } | string>;
  phase?: string;
  module_name?: string;
  confirm?: boolean;
  sort?: boolean;
  remove_unused?: boolean;
  merge_duplicates?: boolean;
  module?: string;
  include_body?: boolean;
  is_type?: boolean;
  dry_run?: boolean;
  replaceAll?: boolean;
  replace_all?: boolean;
  raw?: boolean;
  keep_source?: boolean;
  keepSource?: boolean;
  check_references?: boolean;
  force?: boolean;
  manualOverride?: boolean;
  manual_override?: boolean;
  name?: string;
  max_files?: number;
  max_errors?: number;
  detail?: boolean;
  max_results?: number;
  limit?: number;
  candidate_files?: string[];
  files?: string[];
  exclude_comments?: boolean;
  include_declarations?: boolean;
  old_text?: string;
  oldText?: string;
  old?: string;
  new_text?: string;
  newText?: string;
  new?: string;
  start_line?: number;
  startLine?: number;
  end_line?: number;
  endLine?: number;
  offset?: number;
  max_tokens?: number;
  max_token?: number;
  maxtoken?: number;
  remaining_tokens?: number;
  tokens_remaining?: number;
  tokens_left?: number;
  max_lines?: number;
  maxLines?: number;
  max_line_length?: number;
  maxLineLength?: number;
  numbered?: boolean;
  dir?: string;
  directory?: string;
  folder?: string;
  searchDirectory?: string;
  SearchDirectory?: string;
  pattern?: string;
  glob?: string;
  Pattern?: string;
  type?: "all" | "file" | "directory" | string;
  max_bytes?: number;
  maxBytes?: number;
  max_entries?: number;
  maxEntries?: number;
  max_depth?: number;
  maxDepth?: number;
  depth?: number;
  recursive?: boolean;
  patch?: string;
  diff?: string;
  mode?: string;
  from?: string;
  to?: string;
  query?: string;
  Query?: string;
  q?: string;
  scope?: string;
  queries?: string[];
  path_pattern?: string;
  is_regex?: boolean;
  regex?: boolean;
  case_sensitive?: boolean;
  exclude_dirs?: string[] | string;
  excludeDirs?: string[] | string;
  exclude?: string[] | string;
  max_file_bytes?: number;
  maxFileBytes?: number;
  respect_gitignore?: boolean;
  max_symbols_per_file?: number;
  max_tokens_per_file?: number;
  lines?: number;
  tail?: boolean;
  max_matches?: number;
  repo?: string;
  short?: boolean;
  untracked?: "normal" | "no" | "all" | string;
  staged?: boolean;
  stat_only?: boolean;
  context?: number | string;
  /** Integer diff context for 'git_diff'. 'context' is reserved for jev_* text. */
  diff_context?: number;
  /** Revision/range for 'git_diff' (e.g. "HEAD~3", "HEAD~3..HEAD") and 'git_log'. Uses existing `target` field as alias. */
  revision?: string;
  range?: string;
  max_count?: number;
  maxCount?: number;
  oneline?: boolean;
  question?: string;
  options?: Record<string, string> | string[];
  checks?: Record<string, string> | string[];
  criteria?: Record<string, string> | Record<string, unknown>;
  choices?: Record<string, string> | string[];
  jev_model?: string;
  jev_provider_id?: string;
  jev_group_id?: string;
  api_key?: string;
  base_url?: string;
  questions?: Record<string, unknown>;
  state?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout_ms?: number;
  timeout?: number;
  format?: string;
  page?: number;
  page_num?: number;
  pageNum?: number;
  p?: number;
  page_size?: number;
  pageSize?: number;
  per_page?: number;
  perPage?: number;
  exact_total?: boolean;
  exactTotal?: boolean;
  count_cap?: number;
  countCap?: number;
  max_total?: number;

  /* JEV advisory fields (canonical names for jev_thinking/rank/scope/
     consistency/done/diagnose/edge_cases/blast_radius). The opencode
     bridge only forwards declared params, so these must stay declared
     here; saVmJev.ts additionally accepts question/options/checks/
     content/context/target aliases (see .opencode/skills/jev/SKILL.md). */
  goal?: string;
  thoughts?: Record<string, string> | string[];
  items?: Record<string, string> | string[];
  task?: string;
  phases?: Record<string, string> | string[];
  plan?: string;
  constraints?: Record<string, string> | string[];
  code?: string;
  error_summary?: string;
  error?: string;
  hypotheses?: Record<string, string> | string[];
  proposed_fix?: string;
  fix?: string;
  user_request?: string;
  request?: string;
  actual_work?: string;
  work?: string;
  evidence?: string;
  target_component?: string;
  criterion?: string;
  threshold?: number;
  prompt?: string;
  causes?: Record<string, string> | string[];
  units?: Record<string, string> | string[];

  source?: string;
  language?: "js" | "javascript" | "bun" | "ts" | "typescript" | "node" | "py" | "python" | "sa" | "sla";
  exe?: string;
  args?: string[];
  env?: Record<string, string>;
  head_lines?: number;
  tail_lines?: number;
  requested_caps?: { fs?: Array<string | SaVmFsCapability>; net?: SaVmNetCapability[]; env?: string[]; process?: boolean };
  limits?: { fuel?: number; deadline_ms?: number; mem_cap_bytes?: number; max_call_depth?: number };
  cwd?: string;
  additionalRoots?: string[];
  policy?: SaVmPolicyConfig;
  parallel?: Array<Omit<SaVmRunInput, "parallel">> | string;
  concurrency?: number;
  yield_time_ms?: number;
  yield_ms?: number;
  yieldTimeMs?: number;
  session_id?: string;
  sessionId?: string;
  session?: string;
  input?: string;
  close_stdin?: boolean;
  drain?: boolean;
  commit?: string;
  message?: string;
};

export type SaVmRunResult = {
  ok: boolean;
  kind: "success" | "sa_error" | "capability_denied" | "fuel_exhausted" | "timeout" | "mem_quota" | "policy_invalid" | "stack_overflow" | "crashed" | "unavailable" | "running";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  saVmEvents: Array<Record<string, unknown>>;
  saVmViolation: Record<string, unknown> | null;
  durationMs: number;
  session_id?: string;
  sessionId?: string;
  pid?: number;
  status?: string;
  message?: string;
  commit?: string;
  created?: boolean;
  [key: string]: unknown;
};

export type NotePriorityLevel = "low" | "normal" | "important" | "critical";

export class SaVmInputError extends Error {}
export class SaVmCapabilityDeniedError extends Error {
  readonly exitCode = 228;
}
