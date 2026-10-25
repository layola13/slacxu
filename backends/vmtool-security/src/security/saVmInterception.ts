import type { SaVmPolicyConfig } from "@codex-ui/shared";
import { checkSaVmDelete, checkSaVmHttp, checkSaVmPath, extractCommandArgv, normalizeSaVmPolicy } from "./saVmPolicy.js";
import { isSystemWebSearchPermissionRequest } from "@cxu/sdk-backend";

export type SaVmScriptLanguage = "python" | "javascript" | "bun";

export type SaVmScriptToolRequest = {
  language: SaVmScriptLanguage;
  executable: string;
  args: string[];
  reason: "direct-script-execution-requires-sa-vm";
};

export type SaVmInterceptionDecision =
  | { action: "allow"; reason: "web-search-bypass" | "policy-allowed" | "not-a-tool" }
  | { action: "deny"; reason: string }
  | { action: "require_sa_vm"; request: SaVmScriptToolRequest };

/** Returns the script language for a host executable, if it is Python, JS, or Bun. */
export function saVmScriptLanguage(executable: string): SaVmScriptLanguage | null {
  const name = executable.replace(/\\/g, "/").toLowerCase().split("/").at(-1) ?? "";
  if (/^(?:python(?:\d+(?:\.\d+)?)?|py|pypy(?:\d+)?)(?:\.exe)?$/.test(name)) return "python";
  if (/^(?:bun(?:x)?)(?:\.exe)?$/.test(name)) return "bun";
  if (/^(?:node(?:js)?|deno|ts-node|tsx|npx)(?:\.exe)?$/.test(name)) return "javascript";
  return null;
}

export function isSaVmScriptExecutable(executable: unknown): boolean {
  return typeof executable === "string" && saVmScriptLanguage(executable) !== null;
}

export function isSaVmDirectCommandMethod(method: string): boolean {
  return method === "command/exec"
    || method === "command/exec/write"
    || method === "command/exec/terminate"
    || method === "command/exec/resize"
    || method === "thread/shellCommand"
    || method === "item/commandExecution/requestApproval"
    || method === "execCommandApproval"
    || method === "applyPatchApproval";
}

/**
 * Identifies a real host command/tool invocation. Plain model text is not
 * inspected, so asking the model to write Python or JavaScript remains safe.
 */
export function classifySaVmScriptToolRequest(method: string, params: unknown): SaVmScriptToolRequest | null {
  const record = asRecord(params);
  const commandMethods = isSaVmDirectCommandMethod(method);
  if (commandMethods) {
    const rawCmd = record.command ?? record.cmd ?? record.argv;
    const parsed = extractCommandArgv(rawCmd);
    if (parsed) {
      const language = saVmScriptLanguage(parsed.executable);
      if (language) return { language, executable: parsed.executable, args: parsed.args, reason: "direct-script-execution-requires-sa-vm" };

      const isShell = /^(?:bash|sh|zsh|cmd|powershell|pwsh)(?:\.exe)?$/i.test(parsed.executable.replace(/\\/g, "/").split("/").at(-1) ?? "");
      if (isShell) {
        const fullArgs = parsed.args.join(" ");
        if (/\b(?:python(?:\d+(?:\.\d+)?)?|py|pypy(?:\d+)?)\b/i.test(fullArgs)) {
          return { language: "python", executable: parsed.executable, args: parsed.args, reason: "direct-script-execution-requires-sa-vm" };
        }
        if (/\b(?:bun(?:x)?)\b/i.test(fullArgs)) {
          return { language: "bun", executable: parsed.executable, args: parsed.args, reason: "direct-script-execution-requires-sa-vm" };
        }
        if (/\b(?:node(?:js)?|deno|ts-node|tsx|npx)\b/i.test(fullArgs)) {
          return { language: "javascript", executable: parsed.executable, args: parsed.args, reason: "direct-script-execution-requires-sa-vm" };
        }
      }
    }
  }
  const toolNameCandidate = [record.tool, record.toolName, record.name, asRecord(record.item).tool, asRecord(record.item).name]
    .find((value): value is string => typeof value === "string");
  if (toolNameCandidate) {
    const cleanTool = toolNameCandidate.replace(/\\/g, "/").split("/").at(-1) ?? "";
    const directLang = saVmScriptLanguage(cleanTool);
    if (directLang) return { language: directLang, executable: toolNameCandidate, args: [], reason: "direct-script-execution-requires-sa-vm" };
    if (/^(?:run_py|exec_py|run_python|python)$/i.test(cleanTool)) {
      return { language: "python", executable: toolNameCandidate, args: [], reason: "direct-script-execution-requires-sa-vm" };
    }
    if (/^(?:run_bun|exec_bun|bun)$/i.test(cleanTool)) {
      return { language: "bun", executable: toolNameCandidate, args: [], reason: "direct-script-execution-requires-sa-vm" };
    }
    if (/^(?:run_js|exec_js|run_node|javascript|js|node)$/i.test(cleanTool)) {
      return { language: "javascript", executable: toolNameCandidate, args: [], reason: "direct-script-execution-requires-sa-vm" };
    }
  }
  return null;
}

/**
 * Detects common PowerShell anti-patterns (pipeline formatting, silent error suppression,
 * chained file writes/reads, piping to Select-String, etc.) and returns specific guidance
 * pointing to equivalent native sa_vm_run actions.
 */
export function detectPowerShellAntiPattern(cmd: string): string | null {
  if (!cmd || typeof cmd !== "string") return null;
  if (/\b(?:vm-read|vm_read)\b/i.test(cmd)) {
    return "Tool 'vm-read' does not exist; use sa_vm_run({ action: 'read_lines', path: '...' }) for line ranges or sa_vm_run({ action: 'read_file', path: '...' }) for complete files.";
  }

  if (/(?:subprocess\s*\(|Bun\s*\.\s*spawnSync|Bun\s*\.\s*spawn|child_process|execSync|spawnSync)\s*\([\s\S]*?\bgit\b/i.test(cmd) || /python(?:\.exe)?\s+-c[\s\S]*?\bgit\b/i.test(cmd) || /\bbun\s+-e[\s\S]*?\bgit\b/i.test(cmd)) {
    return "Bypassing git via 'python -c subprocess(git)' / 'bun -e Bun.spawnSync(git)' / temp scripts is prohibited; call sa_vm_run({ action: 'git_status' }) or sa_vm_run({ action: 'git_diff' }) instead.";
  }
  if (/\.git\s*\/\s*(?:HEAD|config|index|refs|objects|FETCH_HEAD)/i.test(cmd)) {
    return "Reading '.git/*' internals directly is prohibited; use sa_vm_run({ action: 'git_status' }) for branch/state or sa_vm_run({ action: 'git_diff' }) for changes.";
  }
  if (/\bfor\s*[%\/\(]|\bfor\s+\$?[a-zA-Z_][a-zA-Z0-9_]*\s+in\b|\bforeach\b|\bForEach-Object\b|\|\s*%[\s{]/i.test(cmd)) {
    return "Batch loops via 'for / foreach / ForEach-Object' are prohibited in the shell: loop pipelines cause quoting collapse and encoding damage. For batch search use sa_vm_run({ action: 'grep_search', pattern: '*.ext', query: '...' }) or sa_vm_run({ action: 'grep_search_async', queries: [...] }); for batch writes use parallel: [{ action: 'edit_file', ... }].";
  }
  if (/;\s*(?:Set-Content|Get-Content|gc|cat|type)\b/i.test(cmd) || /(?:Set-Content|Get-Content)\b[\s\S]*;/i.test(cmd)) {
    return "Chaining multiple commands with ';' combining file operations and execution is prohibited. Follow the 3-step recipe: 1. sa_vm_run write_file -> 2. single host compile/test command -> 3. sa_vm_run read_lines/read_file_tail.";
  }
  if (/(?:^|["'\s;&|()])cmd(?:\.exe)?\s+\/[ck]\b/i.test(cmd)) {
    return "Wrapping commands with 'cmd /c' is prohibited. Direct binary invocation must use sa_vm_run({ action: 'run_host', exe: '...', args: [...] }); execute binaries directly without shell wrappers.";
  }
  if (/(?:^|["'\s;&|()])\b(?:cd|Set-Location|pushd|chdir)(?:\s+|$|[;&|()])/i.test(cmd)) {
    return "Manual directory changing via 'cd' / 'Set-Location' / 'pushd' is prohibited to prevent workspace path drift. Never change directory in the shell; execute commands directly using workspace-relative or absolute paths, or use sa_vm_run tools ('list_dir', 'grep_search', 'read_lines', 'write_file', 'run_host').";
  }
  if (/(?:^|[^&])&&(?![&])/i.test(cmd)) {
    return "Command chaining via '&&' is prohibited. Execute commands independently, use parallel batches, or use sa_vm_run({ action: 'run_host', ... }).";
  }
  if (/(?:^|["'\s;&|()])\b(?:Get-Process|gps)\b|(?:^|["'\s;&|()])\bps(?:\s+|$|[;&|()])/i.test(cmd)) {
    return "Process inspection via 'Get-Process' / 'ps' is prohibited; process polling causes instability and should use internal diagnostics APIs or run_project_check instead.";
  }
  if (/(?:^|["'\s;&|()])\bGet-Date\b|(?:^|["'\s;&|()])\bdate(?:\s+|$|[;&|()])/i.test(cmd)) {
    return "'Get-Date' / 'date' terminal invocation is unnecessary noise; omit timestamp polling and rely on runner timestamps.";
  }
  if (/\b(?:Format-Table|Format-List|Format-Wide|Out-String)\b/i.test(cmd)) {
    return "Format-* / Out-String formatting is prohibited; use sa_vm_run({ action: 'list_dir' }) or sa_vm_run({ action: 'read_lines' }) which returns structured JSON natively.";
  }
  if (/\bSelect-String\b/i.test(cmd)) {
    return "Select-String pipeline search is prohibited; use sa_vm_run({ action: 'grep_search', query: '...' }) which runs in-process with token-safe output.";
  }
  if (
    !/\b(?:Get-ChildItem|gci)\b/i.test(cmd) &&
    (/\bWhere-Object\b|\|\s*Where\b|\|\s*\?(?:\s*\{|\s+(?![\w\$\.]+\s*:)[\$\w\-])|(?:^|["'\s;&|()])\bWhere\s*\{/i.test(cmd))
  ) {
    return "Pipeline filtering via 'Where-Object / Where / ?' is prohibited; use sa_vm_run({ action: 'find_files', pattern: '*xyz*', path_pattern: '...' }) for name filtering or sa_vm_run({ action: 'grep_search', query: '...' }) for content filtering.";
  }
  if (
    /(?:^|["'\s;&|()])(?:cmd(?:\.exe)?\s+\/[ck]\s+)?\bwhich\b/i.test(cmd) ||
    /(?:^|["'\s;&|()])(?:cmd(?:\.exe)?\s+\/[ck]\s+)?\bwhere\.exe\b/i.test(cmd) ||
    /(?:^|["';&|()])\s*(?:cmd(?:\.exe)?\s+\/[ck]\s+)?\bwhere\s+(?!(?:is|are|was|were|the|do|does|did|can|could|should|would|to|from|in|at|for|with|about|and|or|not)\b|\{|\$)\S+/i.test(cmd)
  ) {
    return "Binary locating via 'which / where.exe' is prohibited; call sa_vm_run({ action: 'run_host', exe: 'bun|node|python|zig|git', args: [...] }) directly and let the server resolve PATH/env/fallback. For workspace binaries use sa_vm_run({ action: 'find_files', pattern: 'name*' }).";
  }
  if (/(?:^|["'\s;&|()])(?:cmd(?:\.exe)?\s+\/[ck]\s+)?\bfind(?:\.exe)?\s+[^;&|\r\n]*\s-(?:name|iname|path|type|not|exec)\b/i.test(cmd)) {
    return "Filesystem discovery via 'find' is prohibited; use sa_vm_run({ action: 'find_files', dir: '...', pattern: '...' }) with path_pattern or max_depth instead of shell traversal.";
  }
  if (/(?:^|["'\s;&|()])\b(?:rg|grep|findstr)\b/i.test(cmd)) {
    return "Direct text search via 'rg' / 'grep' / 'findstr' shell command is prohibited; use sa_vm_run({ action: 'grep_search', query: '...', is_regex: true }) or sa_vm_run({ action: 'run_host', exe: '...', filter: '...' }) which runs in-process with token-safe output.";
  }
  if (/(?:^|["'\s;&|()])(?:cmd(?:\.exe)?\s+\/[ck]\s+)?\b(?:head|tail)(?:\.exe)?\b(?:\s+-[A-Za-z]*\d+|\s+--(?:lines|bytes)(?:=|\s+)|\s+)/i.test(cmd) || /\|\s*(?:head|tail)(?:\.exe)?\b/i.test(cmd)) {
    return "Shell output truncation via 'head' / 'tail' is prohibited; use sa_vm_run({ action: 'read_lines' }), read_file_tail, or run_host({ head_lines: N, tail_lines: N }) for bounded output.";
  }
  if (/\b(?:Select-Object|Select)\s+(?:-[A-Za-z]+\s+)*-(?:First|Last)\b/i.test(cmd)) {
    return "Select -First/-Last line truncation via shell is prohibited; use sa_vm_run({ action: 'read_lines', start_line: 1, end_line: N }), sa_vm_run({ action: 'list_dir', max_entries: N }), or sa_vm_run({ action: 'run_host', exe: '...', head_lines: N, tail_lines: N }).";
  }
  if (/(?:^|\s)-ErrorAction\s+(?:SilentlyContinue|'SilentlyContinue'|"SilentlyContinue"|0)\b/i.test(cmd)) {
    return "-ErrorAction SilentlyContinue is prohibited; do not hide filesystem failures in shell. Use sa_vm_run({ action: 'test_path' }) or inspect exitCode explicitly.";
  }
  if (/(?:[12*]?>\s*["']?(?:\$null|nul\b)|\|\s*Out-Host|2>&1)/i.test(cmd)) {
    return "Shell error suppression (2>$null / >nul), Out-Host, or 2>&1 pipeline filtering is prohibited; execute binaries cleanly without pipe wrapping or use sa_vm_run({ action: 'run_host', exe: '...', args: [...] }).";
  }
  if (/(?:^|[^\w>])(?:[0-2]?>|>>)\s*(?!&)[^\s$]/i.test(cmd) && !/(?:=>|->|-->)/.test(cmd)) {
    return "Shell redirection ('>' / '>>') is prohibited. To execute binaries and inspect or filter output, use sa_vm_run({ action: 'run_host', exe: '...', args: [...], tail_lines: N, filter: '...' }) or sa_vm_run({ action: 'write_file' }).";
  }
  if (/\|\s*(?:Set-Content|Out-File|sc)\b/i.test(cmd) || (/@["']/i.test(cmd) && /\b(?:Set-Content|Out-File|sc)\b/i.test(cmd))) {
    return "Piping or heredoc writing via Set-Content / Out-File is prohibited to prevent Windows encoding corruption; use sa_vm_run({ action: 'write_file' }) or sa_vm_run({ action: 'apply_patch' }).";
  }
  if (/\b(?:Test-Path|test-path)\b/i.test(cmd)) {
    return "Existence probing via 'Test-Path' is prohibited; use sa_vm_run({ action: 'test_path', path: '...' }) which returns exists:true/false with exitCode 0 and zero caching.";
  }
  if (/(?:^|["'\s;&|()])(?:cmd(?:\.exe)?\s+\/[ck]\s+)?\b(?:Get-ChildItem|gci)\b|(?:^|["'\s;&|()])(?:cmd(?:\.exe)?\s+\/[ck]\s+)?\b(?:dir|ls)(?:\s+|$|[;&|()])/i.test(cmd)) {
    return "Directory enumeration via 'Get-ChildItem' / 'gci' / 'dir' / 'ls' is prohibited. Use sa_vm_run({ action: 'list_dir', dir: '...', depth: 1, type: 'file' }) or sa_vm_run({ action: 'find_files', pattern: '...' }) which runs in-process with zero caching and token protection.";
  }
  if (/(?:^|["'\s;&|()])(?:cmd(?:\.exe)?\s+\/[ck]\s+)?\b(?:Get-Content|gc)\b|(?:^|["'\s;&|()])(?:cmd(?:\.exe)?\s+\/[ck]\s+)?\b(?:cat|type)(?:\s+|$|[;&|()])/i.test(cmd)) {
    return "Direct file reading via 'Get-Content' / 'gc' / 'cat' / 'type' is prohibited. Use sa_vm_run({ action: 'read_lines', path: '...', start_line: 1, end_line: 100 }) for slicing, or sa_vm_run({ action: 'read_file', path: '...' }) for complete files (with max_tokens safety).";
  }
  if (/\bgit\s+(?:status|diff|log|show|branch|merge-base|rev-parse|checkout|fetch|pull|push)\b/i.test(cmd)) {
    return "Direct 'git ...' shell invocation is prohibited; use sa_vm_run({ action: 'git_status' }) for worktree cleanliness or sa_vm_run({ action: 'git_diff' }) for uncommitted changes, or sa_vm_run({ action: 'run_host', exe: 'git', args: [...] }) for other repo operations (destructive reset --hard/clean/revert is blocked only when VM safe exec interception is on).";
  }
  if (/(?:^|["'\s;&|()])(?:bun|node|python|zig)(?:\.exe)?\s+.*(?:--help|-h|\bhelp\b|\bbuild\b|\btest\b|\bcompile\b|\bversion\b)/i.test(cmd)) {
    return "Invoking bun/node/python/zig with shell wrappers, pipes, or redirection is prohibited. Use sa_vm_run({ action: 'run_host', exe: 'bun|node|python|zig|git', args: [...], tail_lines: N, filter: '...' }) with structured args and automatic help caching. Git status/diff should prefer sa_vm_run({ action: 'git_status' }) / sa_vm_run({ action: 'git_diff' }); destructive git (reset --hard/clean/revert) is blocked only when VM safe exec interception is on.";
  }
  return null;
}

/**
 * Deterministic broker decision used by tests and request routing. Host
 * Python/Node execution is never allowed directly, even when the legacy UI
 * execution toggle is enabled; callers must submit an `sa_vm_run` request.
 */
export function interceptSaVmRequest(
  method: string,
  params: unknown,
  input: { cwd: string; additionalRoots?: string[]; policy?: SaVmPolicyConfig }
): SaVmInterceptionDecision {
  const script = classifySaVmScriptToolRequest(method, params);
  if (script) return { action: "require_sa_vm", request: script };
  if (isSaVmDirectCommandMethod(method)) {
    const record = asRecord(params);
    const rawCmd = record.command ?? record.cmd ?? record.argv;
    const fullCmd = Array.isArray(rawCmd) ? rawCmd.join(" ") : String(rawCmd ?? "");
    const antiPattern = detectPowerShellAntiPattern(fullCmd);
    if (antiPattern) {
      return {
        action: "deny",
        reason: `direct host command execution is disabled in SA-VM mode; use sa_vm_run. Prohibited shell anti-pattern detected: ${antiPattern}`
      };
    }
    return { action: "deny", reason: "direct host command execution is disabled in SA-VM mode; use sa_vm_run" };
  }
  const record = asRecord(params);
  const text = [record.query, record.prompt, record.text, record.url].filter((value) => typeof value === "string").join(" ");
  if (isSystemWebSearchPermissionRequest(text) && !/^https?:\/\//i.test(String(record.url ?? ""))) {
    return { action: "allow", reason: "web-search-bypass" };
  }
  const policy = normalizeSaVmPolicy(input.policy, input.cwd, input.additionalRoots ?? []);
  if (method === "gitDiffToRemote") {
    return { action: "deny", reason: "gitDiffToRemote requires an explicit git argv allowlist" };
  }
  if (method === "applyPatchApproval") {
    return { action: "deny", reason: "native apply_patch is disabled in SA-VM mode; use packaged sa_vm_run tools" };
  }
  if (method === "item/fileChange/requestApproval") {
    return { action: "deny", reason: "native file change/apply_patch execution is disabled in SA-VM mode; use packaged sa_vm_run tools" };
  }
  if (["fs/readFile", "fs/readDirectory", "fs/getMetadata", "fs/watch"].includes(method)) {
    const path = typeof record.path === "string" ? record.path : "";
    if (!path) return { action: "deny", reason: "filesystem path is required" };
    const decision = checkSaVmPath(policy, "read", path, input.cwd);
    return decision.allowed ? { action: "allow", reason: "policy-allowed" } : { action: "deny", reason: decision.reason };
  }
  if (["fs/writeFile", "fs/createDirectory", "fs/mkdir"].includes(method)) {
    const path = typeof record.path === "string" ? record.path : "";
    if (!path) return { action: "deny", reason: "filesystem path is required" };
    const decision = checkSaVmPath(policy, "write", path, input.cwd);
    return decision.allowed ? { action: "allow", reason: "policy-allowed" } : { action: "deny", reason: decision.reason };
  }
  if (method === "fs/copy") {
    const source = typeof record.sourcePath === "string" ? record.sourcePath : typeof record.source === "string" ? record.source : "";
    const destination = typeof record.destinationPath === "string" ? record.destinationPath : typeof record.destination === "string" ? record.destination : "";
    if (!source || !destination) return { action: "deny", reason: "copy sourcePath and destinationPath are required" };
    const sourceDecision = checkSaVmPath(policy, "read", source, input.cwd);
    if (!sourceDecision.allowed) return { action: "deny", reason: sourceDecision.reason };
    const destinationDecision = checkSaVmPath(policy, "write", destination, input.cwd);
    return destinationDecision.allowed ? { action: "allow", reason: "policy-allowed" } : { action: "deny", reason: destinationDecision.reason };
  }
  if (method === "fs/rename" || method === "fs/move") {
    const source = typeof record.source === "string" ? record.source : typeof record.oldPath === "string" ? record.oldPath : typeof record.path === "string" ? record.path : "";
    const destination = typeof record.destination === "string" ? record.destination : typeof record.destinationPath === "string" ? record.destinationPath : typeof record.newPath === "string" ? record.newPath : typeof record.to === "string" ? record.to : "";
    if (!source || !destination) return { action: "deny", reason: "rename source and destination paths are required" };
    const sourceDecision = checkSaVmDelete(policy, source, input.cwd);
    if (!sourceDecision.allowed) return { action: "deny", reason: sourceDecision.reason };
    const destinationDecision = checkSaVmPath(policy, "write", destination, input.cwd);
    return destinationDecision.allowed ? { action: "allow", reason: "policy-allowed" } : { action: "deny", reason: destinationDecision.reason };
  }
  if (["fs/remove", "fs/delete", "fs/deleteFile", "fs/removeFile", "fs/rename", "fs/move"].includes(method)) {
    const path = typeof record.path === "string" ? record.path : typeof record.source === "string" ? record.source : typeof record.oldPath === "string" ? record.oldPath : "";
    if (!path) return { action: "deny", reason: "filesystem path is required" };
    const decision = checkSaVmDelete(policy, path, input.cwd);
    return decision.allowed ? { action: "allow", reason: "policy-allowed" } : { action: "deny", reason: decision.reason };
  }
  if (["network/request", "http/request", "fetch"].includes(method)) {
    const url = typeof record.url === "string" ? record.url : "";
    if (!url) return { action: "deny", reason: "network URL is required" };
    const decision = checkSaVmHttp(policy, url, typeof record.method === "string" ? record.method : "GET");
    return decision.allowed ? { action: "allow", reason: "policy-allowed" } : { action: "deny", reason: decision.reason };
  }
  if (method === "fuzzyFileSearch") {
    const roots = Array.isArray(record.roots) ? record.roots.filter((value): value is string => typeof value === "string") : [];
    if (roots.length === 0) return { action: "deny", reason: "search roots are required" };
    for (const root of roots) {
      const decision = checkSaVmPath(policy, "read", root, input.cwd);
      if (!decision.allowed) return { action: "deny", reason: decision.reason };
    }
    return { action: "allow", reason: "policy-allowed" };
  }
  if (method === "mcpServer/tool/call" || method === "mcpServer/resource/read") {
    return { action: "deny", reason: "MCP host tools/resources are disabled in SA-VM mode; use policy-approved sa_vm_run actions" };
  }
  return { action: "allow", reason: "not-a-tool" };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
