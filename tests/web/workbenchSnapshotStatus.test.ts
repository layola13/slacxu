import { expect, test } from "bun:test";
import {
  mergeWorkbenchTurns,
  type WorkbenchTurn,
} from "../../apps/web/src/state/workbenchTimeline.ts";

function turn(id: string, overrides: Partial<WorkbenchTurn> = {}): WorkbenchTurn {
  return { id, threadId: "thread-main", status: "inProgress", items: [], ...overrides } as WorkbenchTurn;
}

test("an old terminal snapshot cannot finish a live turn", () => {
  const current = [turn("turn-live", { status: "inProgress", startedAt: 200 })];
  const stale = [turn("turn-live", { status: "completed", startedAt: 100, completedAt: 150 })];
  expect(mergeWorkbenchTurns(current, stale)[0]?.status).toBe("inProgress");
});

test("a same-second terminal snapshot finishes a live turn", () => {
  // 服务端时间戳是秒级，1s 内完成的 turn 会出现 completedAt == startedAt，
  // 快照对账必须接受这种合法终态，否则 working 状态卡死，只能手动停止。
  const current = [turn("turn-live", { status: "inProgress", startedAt: 200 })];
  const snapshot = [turn("turn-live", { status: "completed", startedAt: 200, completedAt: 200 })];
  expect(mergeWorkbenchTurns(current, snapshot)[0]?.status).toBe("completed");
});

test("a terminal snapshot without completedAt cannot finish a live turn", () => {
  const current = [turn("turn-live", { status: "inProgress", startedAt: 200 })];
  const snapshot = [turn("turn-live", { status: "completed", startedAt: 200 })];
  expect(mergeWorkbenchTurns(current, snapshot)[0]?.status).toBe("inProgress");
});

test("a terminal snapshot older than the live start cannot finish it", () => {
  const current = [turn("turn-live", { status: "inProgress", startedAt: 200 })];
  const snapshot = [turn("turn-live", { status: "completed", startedAt: 200, completedAt: 150 })];
  expect(mergeWorkbenchTurns(current, snapshot)[0]?.status).toBe("inProgress");
});
