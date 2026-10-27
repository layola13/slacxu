import { expect, test } from "bun:test";
import { isSaVmToolPayload, saVmToolActivity } from "../../frontends/muse/src/saVmChatActivity";
import type { ChatWaterfallRow } from "../../apps/web/src/waterfall/types";

function mockRow(tool: string): ChatWaterfallRow {
  return {
    key: "row-1",
    kind: "toolCall",
    role: "tool",
    status: "completed",
    text: "",
    title: tool,
    item: { id: "item-1", type: "dynamicToolCall" }
  };
}

test("correctly identifies sa_vm_run payload", () => {
  const row = mockRow("sa_vm_run");
  expect(isSaVmToolPayload({ tool: "sa_vm_run" }, row)).toBe(true);
  expect(isSaVmToolPayload({ name: "sa_vm_run" }, row)).toBe(true);
  expect(isSaVmToolPayload({}, row)).toBe(true);
  expect(isSaVmToolPayload({ tool: "other_tool" }, mockRow("other_tool"))).toBe(false);
});

test("formats action-specific SA-VM activity labels and details", () => {
  const row = mockRow("sa_vm_run");

  // Read
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "read_file", path: "src/App.tsx" } }, row))
    .toEqual({ label: "vm-read", detail: "src/App.tsx" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "read_lines", path: "src/App.tsx", start_line: 10, end_line: 50 } }, row))
    .toEqual({ label: "vm-read", detail: "src/App.tsx:10-50" });

  // Write & Edit & Patch
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "write_file", path: "config.json" } }, row))
    .toEqual({ label: "vm-write", detail: "config.json" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "edit_file", path: "src/main.ts" } }, row))
    .toEqual({ label: "vm-edit", detail: "src/main.ts" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "apply_patch", path: "src/index.ts" } }, row))
    .toEqual({ label: "vm-patch", detail: "src/index.ts" });

  // Delete, Copy, Move
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "delete_file", path: "temp.log" } }, row))
    .toEqual({ label: "vm-delete", detail: "temp.log" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "copy_file", path: "a.txt", destination: "b.txt" } }, row))
    .toEqual({ label: "vm-copy", detail: "a.txt -> b.txt" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "move_file", path: "old.txt", destination: "new.txt" } }, row))
    .toEqual({ label: "vm-move", detail: "old.txt -> new.txt" });

  // Find, List, Grep
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "find_files", dir: "src", pattern: "*.tsx" } }, row))
    .toEqual({ label: "vm-find", detail: "*.tsx in src" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "list_dir", dir: "packages" } }, row))
    .toEqual({ label: "vm-list", detail: "packages" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "grep_search", dir: "src", query: "activitySummary" } }, row))
    .toEqual({ label: "vm-grep", detail: "\"activitySummary\" in src" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "grep_search_async", dir: "src", query: "targetTerm" } }, row))
    .toEqual({ label: "vm-grep-async", detail: "\"targetTerm\" in src" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "clear_tool_history", keep_last_n_turns: 3 } }, row))
    .toEqual({ label: "vm-clear-history", detail: "keep last 3 turns" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "find_references", symbol: "useThreadRuntimeSelections", dir: "apps/web/src" } }, row))
    .toEqual({ label: "vm-references", detail: "useThreadRuntimeSelections in apps/web/src" });

  // Script executions
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "run_js", source: "console.log(1)" } }, row))
    .toEqual({ label: "vm-js", detail: "console.log(1)" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "run_py", source: "print('hello')" } }, row))
    .toEqual({ label: "vm-py", detail: "print('hello')" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { language: "js", source: "const x = 1;" } }, row))
    .toEqual({ label: "vm-js", detail: "const x = 1;" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { language: "sla", source: "@import \"sa_std/fs.sai\"" } }, row))
    .toEqual({ label: "vm-sla", detail: "@import \"sa_std/fs.sai\"" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "http_fetch", url: "https://example.com" } }, row))
    .toEqual({ label: "vm-http", detail: "https://example.com" });
});

test("formats JEV actions as vm-jev-* activities", () => {
  const row = mockRow("sa_vm_run");

  expect(isSaVmToolPayload({ tool: "sa_vm_run", arguments: { action: "jev_choose", question: "Choose a safe rollout" } }, row)).toBe(true);
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "jev_choose", question: "Choose a safe rollout" } }, row))
    .toEqual({ label: "vm-jev-choose", detail: "Choose a safe rollout" });

  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "jev_checklist", checks: ["tests", "diff"] } }, row))
    .toEqual({ label: "vm-jev-checklist", detail: "2 checks" });

  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "jev_redteam", target: "waterfall" } }
  }, mockRow("call_mcp_tool"))).toEqual({ label: "vm-jev-redteam", detail: "waterfall" });
});

test("correctly identifies MCP tool payloads for SA-VM", () => {
  const mcpRow = mockRow("call_mcp_tool");
  expect(isSaVmToolPayload({ name: "call_mcp_tool" }, mcpRow)).toBe(true);
  expect(isSaVmToolPayload({ name: "mcptool" }, mockRow("mcptool"))).toBe(true);
  expect(isSaVmToolPayload({ name: "mcp_tool" }, mockRow("mcp_tool"))).toBe(true);
  expect(isSaVmToolPayload({}, { ...mcpRow, item: { id: "item-1", type: "mcpToolCall" } })).toBe(true);
  expect(isSaVmToolPayload({ name: "call_tool", input: { ServerName: "sa-vm", ToolName: "sa_vm_run" } }, mockRow("call_tool"))).toBe(true);
});

test("formats action-specific MCP tool activity labels as mcptool-<action>", () => {
  const row = mockRow("call_mcp_tool");

  // Read
  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "read_file", path: "apps/web/src/App.tsx" } }
  }, row)).toEqual({ label: "mcptool-read", detail: "apps/web/src/App.tsx" });

  // Read lines
  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "read_lines", path: "src/index.ts", start_line: 15, end_line: 30 } }
  }, row)).toEqual({ label: "mcptool-read", detail: "src/index.ts:15-30" });

  // Grep search with JSON string Arguments
  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: {
      ServerName: "sa-vm",
      ToolName: "sa_vm_run",
      Arguments: JSON.stringify({ action: "grep_search", dir: "apps/web", query: "mcptool" })
    }
  }, row)).toEqual({ label: "mcptool-grep", detail: "\"mcptool\" in apps/web" });

  // Write & Edit & Patch
  expect(saVmToolActivity({
    name: "mcptool",
    input: { action: "write_file", path: "vite.config.ts" }
  }, mockRow("mcptool"))).toEqual({ label: "mcptool-write", detail: "vite.config.ts" });

  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "edit_file", path: "src/main.ts" } }
  }, row)).toEqual({ label: "mcptool-edit", detail: "src/main.ts" });

  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "apply_patch", path: "src/App.tsx" } }
  }, row)).toEqual({ label: "mcptool-patch", detail: "src/App.tsx" });

  // Patch with file extracted from patch body when path is omitted
  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "apply_patch", patch: "*** Begin Patch\n*** Update File: src/components/Chat.tsx\n..." } }
  }, row)).toEqual({ label: "mcptool-patch", detail: "src/components/Chat.tsx" });

  // Delete, Copy, Move, Info, Find, List
  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "delete_file", path: "temp.txt" } }
  }, row)).toEqual({ label: "mcptool-delete", detail: "temp.txt" });

  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "copy_file", from: "a.ts", to: "b.ts" } }
  }, row)).toEqual({ label: "mcptool-copy", detail: "a.ts -> b.ts" });

  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "move_file", from: "old.ts", to: "new.ts" } }
  }, row)).toEqual({ label: "mcptool-move", detail: "old.ts -> new.ts" });

  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "file_info", path: "package.json" } }
  }, row)).toEqual({ label: "mcptool-info", detail: "package.json" });

  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "find_files", dir: "src", pattern: "*.tsx" } }
  }, row)).toEqual({ label: "mcptool-find", detail: "*.tsx in src" });

  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "list_dir", dir: "src/components" } }
  }, row)).toEqual({ label: "mcptool-list", detail: "src/components" });

  // Refactoring & AST actions
  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "rename_symbol", old_name: "OldFoo", new_name: "NewFoo" } }
  }, row)).toEqual({ label: "mcptool-rename-symbol", detail: "OldFoo -> NewFoo" });

  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "find_definition", symbol: "MyClass", path: "src/types.ts" } }
  }, row)).toEqual({ label: "mcptool-find-definition", detail: "MyClass in src/types.ts" });

  expect(saVmToolActivity({
    name: "call_mcp_tool",
    input: { ServerName: "sa-vm", ToolName: "sa_vm_run", Arguments: { action: "get_diagnostics", path: "src/App.tsx" } }
  }, row)).toEqual({ label: "mcptool-diagnostics", detail: "src/App.tsx" });
});

test("windowed reads render their line range (vm-read 分页可区分)", () => {
  const row = mockRow("sa_vm_run");

  // 用户截图场景: 同一文件三次 vm-read 分页, 必须带范围
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "vm-read", path: "index.html", start_line: 1, end_line: 250 } }, row))
    .toEqual({ label: "vm-read", detail: "index.html:1-250" });
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "vm-read", path: "index.html", start_line: 250, end_line: 500 } }, row))
    .toEqual({ label: "vm-read", detail: "index.html:250-500" });
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "vm_read", path: "index.html", start_line: 500, end_line: 586 } }, row))
    .toEqual({ label: "vm-read", detail: "index.html:500-586" });

  // read_file 显式范围同样显示
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "read_file", path: "src/App.tsx", start_line: 10, end_line: 50 } }, row))
    .toEqual({ label: "vm-read", detail: "src/App.tsx:10-50" });

  // 无范围时保持原样, 不加噪音
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "read_file", path: "src/App.tsx" } }, row))
    .toEqual({ label: "vm-read", detail: "src/App.tsx" });
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "vm-read", path: "src/App.tsx" } }, row))
    .toEqual({ label: "vm-read", detail: "src/App.tsx" });

  // tail / max_lines 变体
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "read_file", path: "build.log", tail: true, lines: 100 } }, row))
    .toEqual({ label: "vm-read", detail: "build.log (tail 100 lines)" });
  expect(saVmToolActivity({ tool: "sa_vm_run", arguments: { action: "read_file", path: "build.log", max_lines: 20 } }, row))
    .toEqual({ label: "vm-read", detail: "build.log (first 20 lines)" });
});

test("OpenCode jev_sa_vm_run restores vm-xxx label and file parameters", () => {
  const row = mockRow("jev_sa_vm_run");

  // edit_file via jev_sa_vm_run must format as vm-edit with file path, NOT vm-jev-sa-vm-run (edit_file)
  expect(saVmToolActivity({
    tool: "jev_sa_vm_run",
    arguments: { action: "edit_file", path: "src/App.tsx", old_text: "a", new_text: "b" }
  }, row)).toEqual({ label: "vm-edit", detail: "src/App.tsx" });

  // read_file via jev_sa_vm_run must format as vm-read with file path
  expect(saVmToolActivity({
    tool: "jev_sa_vm_run",
    arguments: { action: "read_file", path: "packages/core/src/index.ts" }
  }, row)).toEqual({ label: "vm-read", detail: "packages/core/src/index.ts" });

  // apply_patch via jev_sa_vm_run must format as vm-patch with target path
  expect(saVmToolActivity({
    tool: "jev_sa_vm_run",
    arguments: { action: "apply_patch", path: "src/main.ts", patch: "*** Begin Patch..." }
  }, row)).toEqual({ label: "vm-patch", detail: "src/main.ts" });

  // sa-vm_sa_vm_run variant also formats as vm-edit
  expect(saVmToolActivity({
    tool: "sa-vm_sa_vm_run",
    arguments: { action: "edit_file", path: "src/utils.ts" }
  }, mockRow("sa-vm_sa_vm_run"))).toEqual({ label: "vm-edit", detail: "src/utils.ts" });

  // Genuine JEV advisory decisions on jev_sa_vm_run retain vm-jev-* format
  expect(saVmToolActivity({
    tool: "jev_sa_vm_run",
    arguments: { action: "jev_choose", question: "Pick refactor strategy", options: { a: "A", b: "B" } }
  }, row)).toEqual({ label: "vm-jev-choose", detail: "Pick refactor strategy" });
});

