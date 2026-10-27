import { expect, test } from "bun:test";
import { buildChatRows } from "../../apps/web/src/waterfall/chatRows.ts";
import { activitySummary } from "../../apps/web/src/waterfall/ChatRow.tsx";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";

// Muse 投影器实际发射的物品形状（见 museCompatibleTurnProjector.toToolItem）：
// name/tool/toolName + input/arguments + output/text + status/startedAt。
function museSummary(item: WorkbenchTurn["items"][number], turnStatus = "completed") {
  const row = buildChatRows([{ id: `turn-${item.id}`, threadId: "thread-muse-tools", status: turnStatus, items: [item] }])[0];
  if (!row) throw new Error(`Missing row for ${item.id}`);
  const targetRow = row.groupedRows?.[0] ?? row;
  return activitySummary(targetRow);
}

function museItem(partial: Record<string, unknown>): WorkbenchTurn["items"][number] {
  return {
    id: "muse-tool-1",
    type: "toolCall",
    text: "",
    status: "completed",
    ...partial,
    payload: {
      ...(partial.payload as Record<string, unknown> | undefined),
    },
  } as WorkbenchTurn["items"][number];
}

test("muse read_file 显示 Read + 还原出的 path", () => {
  const result = museSummary(museItem({
    id: "call-read-1",
    payload: {
      type: "toolCall",
      id: "call-read-1",
      name: "read_file",
      tool: "read_file",
      toolName: "read_file",
      input: { path: "secret.txt" },
      arguments: { path: "secret.txt" },
      output: "Read text file `secret.txt`.\n1|tok",
      text: "Read text file `secret.txt`.\n1|tok",
      status: "completed",
      startedAt: 1791865125,
    },
  }));
  expect(result.label).toBe("Read");
  expect(result.detail).toBe("secret.txt");
});

test("muse bash 无 input 时显示 Command + 输出首行（不编造命令）", () => {
  const result = museSummary(museItem({
    id: "call-bash-1",
    text: "a.txt\nb.txt\n",
    payload: {
      type: "toolCall",
      id: "call-bash-1",
      name: "bash",
      tool: "bash",
      toolName: "bash",
      input: {},
      arguments: {},
      output: "a.txt\nb.txt\n",
      text: "a.txt\nb.txt\n",
      status: "completed",
      startedAt: 1791865125,
    },
  }));
  expect(result.label).toBe("Command");
  expect(result.detail).toBe("a.txt");
});

test("muse mcp sa-vm 工具走 sa-vm 通道（与 mini 同口径 vm-run）", () => {
  const result = museSummary(museItem({
    id: "call-mcp-1",
    payload: {
      type: "toolCall",
      id: "call-mcp-1",
      name: "mcp__sa-vm__read_file",
      tool: "mcp__sa-vm__read_file",
      toolName: "mcp__sa-vm__read_file",
      input: { path: "src/a.ts" },
      arguments: { path: "src/a.ts" },
      output: "ok",
      status: "completed",
      mcp: true,
      startedAt: 1791865125,
    },
  }));
  expect(result.label).toBe("vm-run");
  expect(result.detail).toBe("src/a.ts");
});

test("muse bash 信封 input.command 直接渲染为详情行", () => {
  const result = museSummary(museItem({
    id: "call-exec-1",
    text: "53c3b878 fix(muse): x\n",
    payload: {
      type: "toolCall",
      id: "call-exec-1",
      name: "bash",
      tool: "bash",
      toolName: "bash",
      input: { command: "git log --oneline -15", description: "Show recent commit history" },
      arguments: { command: "git log --oneline -15", description: "Show recent commit history" },
      output: "53c3b878 fix(muse): x\n",
      text: "53c3b878 fix(muse): x\n",
      status: "completed",
      startedAt: 1791865125,
    },
  }));
  expect(result.label).toBe("Command");
  expect(result.detail).toBe("git log --oneline -15");
});

test("muse MCP git_status 行显示 vm-git-status", () => {
  const result = museSummary(museItem({
    id: "call-mcp-git-1",
    text: '{"status":"ok","action":"git_status"}',
    payload: {
      type: "toolCall",
      id: "call-mcp-git-1",
      name: "mcp__sa_vm__sa_vm_run",
      tool: "mcp__sa_vm__sa_vm_run",
      toolName: "mcp__sa_vm__sa_vm_run",
      input: { action: "git_status" },
      arguments: { action: "git_status" },
      output: '{"status":"ok","action":"git_status"}',
      text: '{"status":"ok","action":"git_status"}',
      status: "completed",
      mcp: true,
      startedAt: 1791865125,
    },
  }));
  expect(result.label).toBe("vm-git-status");
});

test("muse write_todos 的 plan 行显示步骤文本", () => {
  const result = museSummary(museItem({
    id: "muse-plan-turn1",
    type: "plan",
    text: "- [ ] s1 _(in progress)_",
    status: "inProgress",
    payload: {
      type: "plan",
      id: "muse-plan-turn1",
      plan: [{ step: "s1", status: "in_progress" }],
      text: "- [ ] s1 _(in progress)_",
      status: "inProgress",
      startedAt: 1791865125,
    },
  }), "inProgress");
  expect(result.detail).toContain("s1");
});
