import type { CliBackend } from "@codex-ui/shared";

/**
 * SA-VM skill guide selection per CLI backend.
 * Extracted verbatim from `saVmDeveloperInstructions` in App.tsx:
 * each backend resolves a skill doc path plus optional agent-specific
 * critical-guide sections prepended to the developer instructions.
 */
export function resolveCliSkillPath(cliBackend?: CliBackend | string | null): string {
  if (cliBackend === "claude") return ".claude/skills/sa-vm/SKILL.md";
  if (cliBackend === "agy") return ".gemini/skills/sa-vm/SKILL.md";
  if (cliBackend === "grok") return ".grok/skills/sa-vm/SKILL.md";
  if (cliBackend === "pi") return ".pi/skills/sa-vm/SKILL.md";
  if (cliBackend === "opencode" || cliBackend === "opencode-v2") return ".opencode/skills/sa-vm/SKILL.md";
  if (cliBackend === "muse") return ".muse/skills/sa-vm/SKILL.md";
  return ".codex/skills/sa-vm/SKILL.md";
}

export interface CliBackendGuideSections {
  agyGuide: string;
  opencodeGuide: string;
  claudeGuide: string;
  museGuide: string;
}

export function buildCliBackendGuideSections(cliBackend?: CliBackend | string | null): CliBackendGuideSections {
  const agyGuide = cliBackend === "agy"
    ? `============================================================
[CRITICAL FOR AGY / ANTIGRAVITY AGENT]:
- You are running under SA-VM mode.
- Direct host command execution (run_command, PowerShell, pwsh, cmd, bash) is strictly disabled.
- Native host file tools (view_file, write_to_file, replace_file_content) are disabled.
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
- You MUST execute all workspace inspection, file reading/writing, AST refactoring, and code operations via the "sa-vm" MCP server's sa_vm_run tool. Advisory actions (jev_choose, jev_checklist, jev_thinking, jev_redteam, jev_rank, jev_scope, jev_dispatch, jev_consistency, jev_done, jev_diagnose, jev_edge_cases, jev_blast_radius, jev_intent, jev_next) ride the same tool via the action field.
- Do NOT run raw host shell commands (bash, PowerShell, pwsh, cmd) for operations the MCP actions cover.
============================================================\n\n`
    : "";

  // Muse exposes MCP tools ONLY as mcp__<server>__<tool>. The shared skill
  // docs teach the bare sa_vm_run form, so without this guide the model
  // either strips the prefix (unknown tool) or falls back to native
  // bash/read_file/edit_file (verified 2026-10-13: whole turns went native).
  const museGuide = cliBackend === "muse"
    ? `============================================================
[CRITICAL FOR MUSE AGENT - TOOL SELECTION]:
- You are running under SA-VM mode. The "sa-vm" MCP server is attached to this session (see Skill guide below).
- The ONLY valid workspace-tool name in this session is mcp__sa_vm__sa_vm_run (MCP server "sa-vm", tool "sa_vm_run"). A bare sa_vm_run does NOT exist here and fails with "tool unavailable: unknown tool sa_vm_run".
- You MUST execute ALL workspace inspection, file listing, file reading/writing, searching, AST refactoring, and code operations via mcp__sa_vm__sa_vm_run({ action: "<action_name>", ... }); e.g. mcp__sa_vm__sa_vm_run({ action: "read_lines", path: "src/main.ts", start_line: 1, end_line: 100 }). Advisory actions (jev_choose, jev_checklist, jev_thinking, jev_redteam, jev_rank, jev_scope, jev_dispatch, jev_consistency, jev_done, jev_diagnose, jev_edge_cases, jev_blast_radius, jev_intent, jev_next) ride the same tool via the action field.
- Do NOT use native bash, read_file, edit_file, or write_file for any operation the MCP actions cover (ls/list -> action list_dir/find_files; cat/read -> action read_file/read_lines; grep -> action grep_search; edit/write -> action edit_file/write_file/apply_patch). Native tools are a fallback ONLY when the MCP call itself errors.
============================================================\n\n`
    : "";

  return { agyGuide, opencodeGuide, claudeGuide, museGuide };
}
