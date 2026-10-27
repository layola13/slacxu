import { beforeEach, expect, test } from "bun:test";
import {
  applyNotification,
  initialClientState,
  type ClientState,
  type WorkbenchTurn,
} from "../../apps/web/src/state/codexClient";
import { JEV_SUB_EVENT, type JevSubEventDetail } from "../../frontends/jev/src/jev/jevAutoJudge";

const seen: Array<{ type: string; detail: JevSubEventDetail }> = [];

function installWindowStub(): void {
  seen.length = 0;
  (globalThis as unknown as Record<string, unknown>).CustomEvent = class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  (globalThis as unknown as Record<string, unknown>).window = {
    dispatchEvent: (event: { type: string; detail: JevSubEventDetail }) => {
      seen.push({ type: event.type, detail: event.detail });
      return true;
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

beforeEach(() => {
  installWindowStub();
});

function stateWithTurns(activeThreadId: string | null, turns: WorkbenchTurn[]): ClientState {
  return { ...initialClientState, token: null, activeThreadId, turns };
}

function spawnAgentCompleted(turnId: string, threadId?: string): Record<string, unknown> {
  return {
    method: "item/completed",
    params: {
      turnId,
      ...(threadId ? { threadId } : {}),
      item: {
        id: "item-spawn-1",
        type: "toolUse",
        name: "spawn_agent",
        arguments: JSON.stringify({ message: "analyze the repo layout", task_name: "analysis" }),
        output: JSON.stringify({ agent_id: "agent-9" }),
      },
    },
  } as unknown as Record<string, unknown>;
}

const turnB: WorkbenchTurn = { id: "turn-B1", threadId: "thread-B", status: "completed", items: [] };

test("后台对话钩子通知缺 threadId 时按 turn 归属打标，不冒充当前对话", () => {
  const state = stateWithTurns("thread-A", [turnB]);
  applyNotification(state, spawnAgentCompleted("turn-B1") as never);
  const sub = seen.find((entry) => entry.type === JEV_SUB_EVENT);
  expect(sub).toBeDefined();
  expect(sub?.detail.threadId).toBe("thread-B");
  expect(sub?.detail.threadId).not.toBe("thread-A");
});

test("通知自带 threadId 时保持原值", () => {
  const state = stateWithTurns("thread-A", [turnB]);
  applyNotification(state, spawnAgentCompleted("turn-B1", "thread-B") as never);
  const sub = seen.find((entry) => entry.type === JEV_SUB_EVENT);
  expect(sub?.detail.threadId).toBe("thread-B");
});

test("turn 不在 store 且无 threadId 时 fail-closed，不盖当前对话 id", () => {
  const state = stateWithTurns("thread-A", []);
  applyNotification(state, spawnAgentCompleted("turn-ghost") as never);
  const sub = seen.find((entry) => entry.type === JEV_SUB_EVENT);
  // 旧逻辑会盖上 thread-A 并在当前对话弹窗；新逻辑绝不冒充，Composer 过滤会丢弃。
  if (sub) expect(sub.detail.threadId).not.toBe("thread-A");
});
