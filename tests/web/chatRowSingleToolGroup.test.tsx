import { expect, test } from "bun:test";
import React from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { buildChatRows } from "../../apps/web/src/waterfall/chatRows";
import { ChatRow } from "../../apps/web/src/waterfall/ChatRow";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient";

// 实测（2026-10-22，muse 1.4.11 + kilo 免费渠道 + sa-vm MCP）：
// Muse 的 tool.result 没有模型侧入参，靠 MCP 尾行补齐 action/path；
// 完成后的单条工具调用会被折叠成只有 1 项的 toolActivityGroup，
// 旧 UI 只显示 “Tool calls · 1 tool”，工具名与参数全部不可见。
function setupDom() {
  const window = new Window();
  globalThis.window = window as any;
  globalThis.document = window.document as any;
  globalThis.HTMLElement = window.HTMLElement as any;
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} } as any;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0)) as any;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as any;
  return window;
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

test("single Muse sa-vm MCP call keeps tool name and arguments visible", async () => {
  setupDom();
  const item = {
    id: "call-vm-1",
    type: "toolCall",
    text: "  1: HELLO\n",
    status: "completed",
    payload: {
      type: "toolCall",
      id: "call-vm-1",
      name: "mcp__sa_vm__sa_vm_run",
      tool: "mcp__sa_vm__sa_vm_run",
      toolName: "mcp__sa_vm__sa_vm_run",
      input: { action: "read_file", path: "/tmp/muse-real/hello.txt" },
      arguments: { action: "read_file", path: "/tmp/muse-real/hello.txt" },
      output: "  1: HELLO\n",
      text: "  1: HELLO\n",
      status: "completed",
      mcp: true,
      startedAt: 1792633800,
    },
  } as unknown as WorkbenchTurn["items"][number];
  const rows = buildChatRows([{
    id: "turn-vm-1",
    threadId: "thread-vm-1",
    status: "completed",
    items: [item],
  } as unknown as WorkbenchTurn]);

  expect(rows).toHaveLength(1);
  expect(rows[0]?.kind).toBe("toolActivityGroup");
  expect(rows[0]?.groupedRows).toHaveLength(1);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(React.createElement(ChatRow, { row: rows[0]!, t: ((key: string) => key) as any }));
  await tick();

  const text = container.textContent ?? "";
  expect(text).toContain("vm-read");
  expect(text).toContain("/tmp/muse-real/hello.txt");
  expect(text).not.toContain("Tool calls");

  root.unmount();
  container.remove();
});
