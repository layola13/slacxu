import { expect, test } from "bun:test";
import { buildChatRows } from "../../apps/web/src/waterfall/chatRows";
import type { WorkbenchTurn } from "../../apps/web/src/state/codexClient";

const echoTurn: WorkbenchTurn = {
  id: "sidechat-echo-m1",
  threadId: "",
  status: "inProgress",
  items: [{ id: "m1", type: "userMessage", text: "hi" }],
} as unknown as WorkbenchTurn;

const serverTurn = {
  id: "turn-1",
  threadId: "thread-1",
  status: "completed",
  items: [
    { id: "u1", type: "userMessage", text: "hi" },
    { id: "a1", type: "agentMessage", text: "Hi! What can I help you with?" },
  ],
} as unknown as WorkbenchTurn;

test("side chat echo and server turns share one row builder", () => {
  const rows = buildChatRows([echoTurn, serverTurn]);
  expect(rows.length).toBeGreaterThan(0);
  const text = JSON.stringify(rows);
  expect(text).toContain("hi");
  expect(text).toContain("Hi! What can I help you with?");
});

test("failed relay-error turn keeps failed status through the same builder", () => {
  const failed = {
    id: "turn-2",
    threadId: "thread-1",
    status: "failed",
    items: [{ id: "e1", type: "agentMessage", text: "上游服务偶发拒绝了本次请求（relay 400），请重试一次。", status: "failed" }],
  } as unknown as WorkbenchTurn;
  const rows = buildChatRows([failed]);
  expect(rows.length).toBeGreaterThan(0);
  expect(JSON.stringify(rows)).toContain("请重试一次");
});
