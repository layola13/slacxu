import { expect, test } from "bun:test";
import { buildChatRows } from "../../apps/web/src/waterfall/chatRows.ts";
import { activitySummary, toolFileDetails } from "../../apps/web/src/waterfall/ChatRow.tsx";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";

function summary(item: WorkbenchTurn["items"][number], turnStatus = "completed") {
  const row = buildChatRows([{ id: `turn-${item.id}`, threadId: "thread-agy-tools", status: turnStatus, items: [item] }])[0];
  if (!row) throw new Error(`Missing row for ${item.id}`);
  const targetRow = row.groupedRows?.[0] ?? row;
  return activitySummary(targetRow);
}

function details(item: WorkbenchTurn["items"][number], turnStatus = "completed") {
  const row = buildChatRows([{ id: `turn-${item.id}`, threadId: "thread-agy-tools", status: turnStatus, items: [item] }])[0];
  if (!row) throw new Error(`Missing row for ${item.id}`);
  const targetRow = row.groupedRows?.[0] ?? row;
  return toolFileDetails(targetRow);
}

test("renders AGY replace_file_content with TargetFile and diff stats", () => {
  const item: WorkbenchTurn["items"][number] = {
    id: "agy-replace-1",
    type: "toolCall",
    title: "replace_file_content",
    text: "",
    status: "completed",
    payload: {
      name: "replace_file_content",
      input: {
        TargetFile: "apps/web/src/App.tsx",
        TargetContent: "const count = 0;",
        ReplacementContent: "const count = 1;\nconst active = true;"
      }
    }
  };
  const result = summary(item);

  expect(result.label).toBe("Edited");
  expect(result.detail).toBe("apps/web/src/App.tsx (+2 -1)");

  const fileDetails = details(item);
  expect(fileDetails).toHaveLength(1);
  expect(fileDetails[0]?.path).toBe("apps/web/src/App.tsx");
  expect(fileDetails[0]?.beforeText).toBe("const count = 0;");
  expect(fileDetails[0]?.afterText).toBe("const count = 1;\nconst active = true;");
  expect(fileDetails[0]?.additions).toBe(2);
  expect(fileDetails[0]?.deletions).toBe(1);
});

test("renders AGY replace_file_content while in-progress", () => {
  const result = summary({
    id: "agy-replace-live",
    type: "toolCall",
    title: "replace_file_content",
    text: "",
    status: "inProgress",
    payload: {
      name: "replace_file_content",
      input: {
        TargetFile: "apps/web/src/App.tsx",
        TargetContent: "const a = 1;",
        ReplacementContent: "const a = 2;"
      }
    }
  }, "inProgress");

  expect(result.label).toBe("Editing");
  expect(result.detail).toBe("apps/web/src/App.tsx (+1 -1)");
});

test("renders AGY write_to_file with target path and stats", () => {
  const item: WorkbenchTurn["items"][number] = {
    id: "agy-write-1",
    type: "toolCall",
    title: "write_to_file",
    text: "",
    status: "completed",
    payload: {
      name: "write_to_file",
      input: {
        TargetFile: "apps/web/src/newUtil.ts",
        CodeContent: "export const x = 1;\nexport const y = 2;\n"
      }
    }
  };
  const result = summary(item);

  expect(result.label).toBe("Wrote");
  expect(result.detail).toBe("apps/web/src/newUtil.ts (+2 -0)");

  const fileDetails = details(item);
  expect(fileDetails).toHaveLength(1);
  expect(fileDetails[0]?.path).toBe("apps/web/src/newUtil.ts");
  expect(fileDetails[0]?.afterText).toBe("export const x = 1;\nexport const y = 2;");
  expect(fileDetails[0]?.additions).toBe(2);
});

test("renders tool simply named 'edit' with file_path", () => {
  const item: WorkbenchTurn["items"][number] = {
    id: "tool-edit-1",
    type: "toolCall",
    title: "edit",
    text: "",
    status: "completed",
    payload: {
      name: "edit",
      input: {
        file_path: "src/main.ts",
        old_string: "hello",
        new_string: "world"
      }
    }
  };
  const result = summary(item);

  expect(result.label).toBe("Edited");
  expect(result.detail).toBe("src/main.ts (+1 -1)");

  const fileDetails = details(item);
  expect(fileDetails).toHaveLength(1);
  expect(fileDetails[0]?.path).toBe("src/main.ts");
  expect(fileDetails[0]?.beforeText).toBe("hello");
  expect(fileDetails[0]?.afterText).toBe("world");
});

test("renders tool named 'edit' with path only without diff", () => {
  const result = summary({
    id: "tool-edit-path-only",
    type: "toolCall",
    title: "edit",
    text: "",
    status: "completed",
    payload: {
      name: "edit",
      input: {
        path: "src/index.ts"
      }
    }
  });

  expect(result.label).toBe("Edited");
  expect(result.detail).toBe("src/index.ts");
});

test("renders AGY view_file with AbsolutePath and line numbers", () => {
  const result = summary({
    id: "agy-view-1",
    type: "toolCall",
    title: "view_file",
    text: "",
    status: "completed",
    payload: {
      name: "view_file",
      input: {
        AbsolutePath: "D:/projects/codex-ultra/package.json",
        StartLine: 1,
        EndLine: 50
      }
    }
  });

  expect(result.label).toBe("Read");
  expect(result.detail).toBe("D:/projects/codex-ultra/package.json:1-50");
});

test("renders AGY grep_search with Query and SearchPath", () => {
  const result = summary({
    id: "agy-grep-1",
    type: "toolCall",
    title: "grep_search",
    text: "",
    status: "completed",
    payload: {
      name: "grep_search",
      input: {
        SearchPath: "apps/web/src",
        Query: "activitySummary"
      }
    }
  });

  expect(result.label).toBe("Search");
  expect(result.detail).toBe('"activitySummary" in apps/web/src');
});

test("renders AGY find_by_name with Pattern and SearchDirectory", () => {
  const result = summary({
    id: "agy-find-1",
    type: "toolCall",
    title: "find_by_name",
    text: "",
    status: "completed",
    payload: {
      name: "find_by_name",
      input: {
        SearchDirectory: "apps/web",
        Pattern: "*.tsx"
      }
    }
  });

  expect(result.label).toBe("Find");
  expect(result.detail).toBe('"*.tsx" in apps/web');
});

test("renders AGY run_command with CommandLine", () => {
  const result = summary({
    id: "agy-cmd-1",
    type: "toolCall",
    title: "run_command",
    text: "",
    status: "completed",
    payload: {
      name: "run_command",
      input: {
        CommandLine: "bun test tests/web/chatRows.test.ts",
        Cwd: "D:/projects/codex-ultra"
      }
    }
  });

  expect(result.label).toBe("Command");
  expect(result.detail).toBe("bun test tests/web/chatRows.test.ts");
});

test("renders AGY list_dir with DirectoryPath", () => {
  const result = summary({
    id: "agy-list-1",
    type: "toolCall",
    title: "list_dir",
    text: "",
    status: "completed",
    payload: {
      name: "list_dir",
      input: {
        DirectoryPath: "apps/web/src"
      }
    }
  });

  expect(result.label).toBe("List");
  expect(result.detail).toBe("apps/web/src");
});

test("renders AGY read_url_content with Url", () => {
  const result = summary({
    id: "agy-url-1",
    type: "toolCall",
    title: "read_url_content",
    text: "",
    status: "completed",
    payload: {
      name: "read_url_content",
      input: {
        Url: "https://github.com/layola13/codex-react-ui"
      }
    }
  });

  expect(result.label).toBe("Read");
  expect(result.detail).toBe("https://github.com/layola13/codex-react-ui");
});

test("parses JSON-stringified input or arguments gracefully", () => {
  const result = summary({
    id: "agy-json-str-1",
    type: "toolCall",
    title: "replace_file_content",
    text: "",
    status: "completed",
    payload: {
      name: "replace_file_content",
      input: JSON.stringify({
        TargetFile: "apps/web/src/types.ts",
        TargetContent: "type A = 1;",
        ReplacementContent: "type A = 2;"
      })
    }
  });

  expect(result.label).toBe("Edited");
  expect(result.detail).toBe("apps/web/src/types.ts (+1 -1)");
});

test("handles item-level input fallback when payload is missing", () => {
  const item: any = {
    id: "agy-item-level-1",
    type: "toolCall",
    title: "replace_file_content",
    name: "replace_file_content",
    text: "",
    status: "completed",
    input: {
      TargetFile: "src/fallback.ts",
      TargetContent: "old",
      ReplacementContent: "new"
    }
  };
  const row = buildChatRows([{ id: "turn-fallback", threadId: "t-1", status: "completed", items: [item] }])[0];
  const targetRow = row?.groupedRows?.[0] ?? row;
  const result = activitySummary(targetRow!);

  expect(result.label).toBe("Edited");
  expect(result.detail).toBe("src/fallback.ts (+1 -1)");
});

test("supports SA-VM tool activity via input parameter container", () => {
  const result = summary({
    id: "savm-input-1",
    type: "toolCall",
    title: "sa_vm_run",
    text: "",
    status: "completed",
    payload: {
      tool: "sa_vm_run",
      input: {
        action: "read_file",
        path: "apps/web/src/App.tsx"
      }
    }
  });

  expect(result.label).toBe("vm-read");
  expect(result.detail).toBe("apps/web/src/App.tsx");
});

test("renders AGY call_mcp_tool with action-specific mcptool-<action> labels in waterfall", () => {
  // Read
  const readRes = summary({
    id: "agy-mcp-read",
    type: "toolCall",
    title: "call_mcp_tool",
    text: "",
    status: "completed",
    payload: {
      name: "call_mcp_tool",
      input: {
        ServerName: "sa-vm",
        ToolName: "sa_vm_run",
        Arguments: {
          action: "read_file",
          path: "src/App.tsx"
        }
      }
    }
  });
  expect(readRes.label).toBe("mcptool-read");
  expect(readRes.detail).toBe("src/App.tsx");

  // Grep with JSON string arguments
  const grepRes = summary({
    id: "agy-mcp-grep",
    type: "toolCall",
    title: "call_mcp_tool",
    text: "",
    status: "completed",
    payload: {
      name: "call_mcp_tool",
      input: {
        ServerName: "sa-vm",
        ToolName: "sa_vm_run",
        Arguments: JSON.stringify({
          action: "grep_search",
          dir: "src",
          query: "activitySummary"
        })
      }
    }
  });
  expect(grepRes.label).toBe("mcptool-grep");
  expect(grepRes.detail).toBe("\"activitySummary\" in src");

  // Write
  const writeRes = summary({
    id: "agy-mcp-write",
    type: "toolCall",
    title: "call_mcp_tool",
    text: "",
    status: "completed",
    payload: {
      name: "call_mcp_tool",
      input: {
        ServerName: "sa-vm",
        ToolName: "sa_vm_run",
        Arguments: {
          action: "write_file",
          path: "src/types.ts",
          content: "export type X = 1;"
        }
      }
    }
  });
  expect(writeRes.label).toBe("mcptool-write");
  expect(writeRes.detail).toBe("src/types.ts");

  // Patch
  const patchRes = summary({
    id: "agy-mcp-patch",
    type: "toolCall",
    title: "call_mcp_tool",
    text: "",
    status: "completed",
    payload: {
      name: "call_mcp_tool",
      input: {
        ServerName: "sa-vm",
        ToolName: "sa_vm_run",
        Arguments: {
          action: "apply_patch",
          path: "src/main.ts",
          patch: "*** Begin Patch\n..."
        }
      }
    }
  });
  expect(patchRes.label).toBe("mcptool-patch");
  expect(patchRes.detail).toBe("src/main.ts");

  // Edit with mcptool name
  const editRes = summary({
    id: "agy-mcp-edit",
    type: "toolCall",
    title: "mcptool",
    text: "",
    status: "completed",
    payload: {
      name: "mcptool",
      input: {
        action: "edit_file",
        path: "src/utils.ts"
      }
    }
  });
  expect(editRes.label).toBe("mcptool-edit");
  expect(editRes.detail).toBe("src/utils.ts");
});

test("renders Grok use_tool wrapping sa-vm MCP tools as mcptool-<action> instead of UseTool", () => {
  // Grok read_lines via use_tool
  const readRes = summary({
    id: "grok-tool-read",
    type: "toolCall",
    title: "use_tool",
    text: "",
    status: "completed",
    payload: {
      name: "use_tool",
      input: {
        tool_name: "sa-vm__sa_vm_run",
        tool_input: {
          action: "read_lines",
          path: "README.md",
          start_line: 1,
          end_line: 5
        }
      }
    }
  });
  expect(readRes.label).toBe("mcptool-read");
  expect(readRes.detail).toBe("README.md:1-5");

  // Grok grep_search via use_tool
  const grepRes = summary({
    id: "grok-tool-grep",
    type: "toolCall",
    title: "use_tool",
    text: "",
    status: "completed",
    payload: {
      name: "use_tool",
      input: {
        tool_name: "sa-vm__sa_vm_run",
        tool_input: {
          action: "grep_search",
          query: "function test",
          dir: "src"
        }
      }
    }
  });
  expect(grepRes.label).toBe("mcptool-grep");
  expect(grepRes.detail).toBe('"function test" in src');

  // Grok write_file via use_tool
  const writeRes = summary({
    id: "grok-tool-write",
    type: "toolCall",
    title: "use_tool",
    text: "",
    status: "completed",
    payload: {
      name: "use_tool",
      input: {
        tool_name: "sa-vm__sa_vm_run",
        tool_input: {
          action: "write_file",
          path: "src/out.txt",
          content: "hello world"
        }
      }
    }
  });
  expect(writeRes.label).toBe("mcptool-write");
  expect(writeRes.detail).toBe("src/out.txt");

  // Grok edit_file via use_tool
  const editRes = summary({
    id: "grok-tool-edit",
    type: "toolCall",
    title: "use_tool",
    text: "",
    status: "completed",
    payload: {
      name: "use_tool",
      input: {
        tool_name: "sa-vm__sa_vm_run",
        tool_input: {
          action: "edit_file",
          path: "src/main.ts",
          old_text: "const a = 1;",
          new_text: "const a = 2;"
        }
      }
    }
  });
  expect(editRes.label).toBe("mcptool-edit");
  expect(editRes.detail).toBe("src/main.ts (+1 -1)");

  // Grok projected tool call where projector unpacked name to sa-vm__sa_vm_run
  const projectedRes = summary({
    id: "grok-projected-tool",
    type: "toolCall",
    title: "sa-vm__sa_vm_run",
    text: "",
    status: "completed",
    payload: {
      name: "sa-vm__sa_vm_run",
      input: {
        tool_name: "sa-vm__sa_vm_run",
        action: "read_lines",
        path: "package.json",
        start_line: 1,
        end_line: 10
      }
    }
  });
  expect(projectedRes.label).toBe("vm-read");
  expect(projectedRes.detail).toBe("package.json:1-10");
});

test("renders vm-edit and mcptool-edit with diff stats (+additions -deletions)", () => {
  // SA-VM direct edit_file -> vm-edit
  const vmEditRes = summary({
    id: "savm-edit-stats-1",
    type: "toolCall",
    title: "sa_vm_run",
    text: "",
    status: "completed",
    payload: {
      tool: "sa_vm_run",
      input: {
        action: "edit_file",
        path: "src/App.tsx",
        old_text: "const count = 0;",
        new_text: "const count = 1;\nconst visible = true;"
      }
    }
  });
  expect(vmEditRes.label).toBe("vm-edit");
  expect(vmEditRes.detail).toBe("src/App.tsx (+2 -1)");

  // MCP call_mcp_tool edit_file with object Arguments -> mcptool-edit
  const mcpEditRes = summary({
    id: "mcp-edit-stats-1",
    type: "toolCall",
    title: "call_mcp_tool",
    text: "",
    status: "completed",
    payload: {
      name: "call_mcp_tool",
      input: {
        ServerName: "sa-vm",
        ToolName: "sa_vm_run",
        Arguments: {
          action: "edit_file",
          path: "src/components/Button.tsx",
          old_text: "<button>Click</button>",
          new_text: "<button className=\"primary\">\n  <span>Click</span>\n</button>"
        }
      }
    }
  });
  expect(mcpEditRes.label).toBe("mcptool-edit");
  expect(mcpEditRes.detail).toBe("src/components/Button.tsx (+3 -1)");

  // MCP call_mcp_tool edit_file with JSON string Arguments -> mcptool-edit
  const mcpJsonEditRes = summary({
    id: "mcp-edit-json-stats-1",
    type: "toolCall",
    title: "call_mcp_tool",
    text: "",
    status: "completed",
    payload: {
      name: "call_mcp_tool",
      input: {
        ServerName: "sa-vm",
        ToolName: "sa_vm_run",
        Arguments: JSON.stringify({
          action: "edit_file",
          path: "src/config.ts",
          old_text: "export const port = 3000;",
          new_text: "export const port = 8080;"
        })
      }
    }
  });
  expect(mcpJsonEditRes.label).toBe("mcptool-edit");
  expect(mcpJsonEditRes.detail).toBe("src/config.ts (+1 -1)");

  // vm-edit with path only (no diff) keeps original path without stats
  const vmEditNoDiffRes = summary({
    id: "savm-edit-nodiff",
    type: "toolCall",
    title: "sa_vm_run",
    text: "",
    status: "completed",
    payload: {
      tool: "sa_vm_run",
      input: {
        action: "edit_file",
        path: "src/plain.ts"
      }
    }
  });
  expect(vmEditNoDiffRes.label).toBe("vm-edit");
  expect(vmEditNoDiffRes.detail).toBe("src/plain.ts");
});
