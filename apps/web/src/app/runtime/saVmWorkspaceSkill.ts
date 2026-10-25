export const SA_VM_WORKSPACE_SKILL_NAME = "sa-vm";

/** Markdown written to a workspace the first time VM is enabled there. */
export const SA_VM_WORKSPACE_SKILL_MARKDOWN = `---
name: sa-vm
description: Run executable automation through the thread-scoped SLA VM broker or packaged native function tools (apply_patch, edit_file, write_file, delete_file, move_file, copy_file, read_file, read_lines, read_file_tail, count_lines, file_info, find_files, list_dir, grep_search, grep_search_async). Use when inspecting, reading, writing, editing, patching, tail-reading logs, counting lines, or searching files in the workspace.
---

# SLA VM workspace guide

Read the repository skill at \`.agents/skills/sa-vm/SKILL.md\` (or \`.codex/skills/sa-vm/SKILL.md\`, \`.claude/skills/sa-vm/SKILL.md\`, \`.gemini/skills/sa-vm/SKILL.md\`). The server writes
a thread-specific copy under \`.codex-ultra/thread-skills/<threadId>/sa-vm/SKILL.md\`;
the developer instructions contain its exact absolute path and the exact
read-only installed Sala root for this conversation.

友情提示：SA-VM 不支持直接执行 JavaScript 或 Python。不要调用 node、python、bun、PowerShell、cmd 或 shell 完成系统操作；普通 JS/Python 代码只能作为文本说明。需要执行时，请先阅读安装包中的 Sala 帮助，再使用 sa_vm_run(language: "sla")。

When the VM switch is enabled, executable automation **MUST** be written as
Safe Language (SLA) and run with \`sa_vm_run(language: "sla")\`. Do not guess
SLA syntax. First read the absolute paths listed in the thread-specific guide.
Copy a
complete example, then change only task values and requested capabilities.
The bundled
\`sa_plugin_sla\` compiler lowers SLA to SA before the hardened VM executes it.

The official \`apply_patch\` tool is supported in VM mode. The broker parses it, checks every read/write/delete/rename path against this thread policy, and executes approved edits inside the VM. Malformed or out-of-policy patches are terminally denied; do not retry or fall back to host commands.

Never execute host Python, Node/JavaScript, Bun, Bash, PowerShell, or shell
commands for automation. Ordinary code snippets and explanations remain text
only. File, network, environment, process, and Git operations must stay inside
the current thread policy; out-of-policy requests are denied.

File and directory paths may be relative to the current thread workspace
 (\`cwd\`); prefer \`src/main.ts\`, \`generated/report.txt\`, and \`tests/fixtures\` to
reduce repeated token usage. The broker resolves relative paths against the
workspace before checking policy. \`.\` is the workspace root; \`..\` cannot escape
approved roots. Every read, write, copy, move, delete, and patch source/target
is still checked independently.

Filesystem helpers include \`sa_fs_find_files_to_stdout\` (glob search), \`sa_fs_read_lines_to_stdout\` (inclusive 1-based line ranges), and \`sa_fs_edit_file\` (read-before-edit CAS replacement). \`sa_fs_edit_file\` preserves UTF-8/BOM/UTF-16 encoding and CRLF style, rejects stale mtimes and ambiguous matches, and atomically replaces the file; use \`expected_mtime_ms = -1\` only when no snapshot is available. For independent tasks, use \`parallel\` with SLA sources and optional bounded \`concurrency\` (1-8); results stay ordered and each task remains policy-isolated. Process execution uses the argv-only \`sa_std_process_exec_capture\` / \`_cwd\` contract from \`sa_std/process.sai\`; set \`requested_caps.process: true\`, avoid shell strings, and close returned handles with \`sa_std_close\`.

The configured Sala root is read-only and belongs only to the active thread.
If the generated guide or any named help page is missing, report the exact
path; do not guess SLA syntax or use a host shell.
`;

export function workspaceSaVmSkillPath(cwd: string, backend?: string): string {
  const separator = cwd.includes("\\") ? "\\" : "/";
  const base = cwd.replace(/[\\/]+$/, "");
  if (backend === "claude") {
    return `${base}${separator}.claude${separator}skills${separator}${SA_VM_WORKSPACE_SKILL_NAME}${separator}SKILL.md`;
  }
  if (backend === "codex") {
    return `${base}${separator}.codex${separator}skills${separator}${SA_VM_WORKSPACE_SKILL_NAME}${separator}SKILL.md`;
  }
  if (backend === "agy") {
    return `${base}${separator}.gemini${separator}skills${separator}${SA_VM_WORKSPACE_SKILL_NAME}${separator}SKILL.md`;
  }
  if (backend === "grok") {
    return `${base}${separator}.grok${separator}skills${separator}${SA_VM_WORKSPACE_SKILL_NAME}${separator}SKILL.md`;
  }
  if (backend === "pi") {
    return `${base}${separator}.pi${separator}skills${separator}${SA_VM_WORKSPACE_SKILL_NAME}${separator}SKILL.md`;
  }
  if (backend === "opencode" || backend === "opencode-v2") {
    return `${base}${separator}.opencode${separator}skills${separator}${SA_VM_WORKSPACE_SKILL_NAME}${separator}SKILL.md`;
  }
  return `${base}${separator}.agents${separator}skills${separator}${SA_VM_WORKSPACE_SKILL_NAME}${separator}SKILL.md`;
}
