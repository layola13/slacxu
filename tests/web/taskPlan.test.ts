import { expect, test } from "bun:test";
import {
  applyNotification,
  initialClientState,
  threadReadToTurns,
  type WorkbenchTurn
} from "../../apps/web/src/state/codexClient.ts";
import { latestTaskPlan } from "../../apps/web/src/waterfall/taskPlan.ts";

test("extracts the latest structured task plan for the active thread", () => {
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-old",
      threadId: "thread-main",
      status: "completed",
      startedAt: 10,
      items: [
        {
          id: "turn-plan-old",
          type: "plan",
          title: "Updated Plan",
          text: "old",
          payload: { plan: [{ step: "Old task", status: "pending" }] }
        }
      ]
    },
    {
      id: "turn-new",
      threadId: "thread-main",
      status: "inProgress",
      startedAt: 20,
      items: [
        {
          id: "turn-plan-new",
          type: "plan",
          title: "Updated Plan",
          text: "new",
          payload: {
            explanation: "Implement the current checklist",
            plan: [
              { step: "Inspect events", status: "completed" },
              { step: "Build panel", status: "in_progress" },
              { text: "Verify animation", status: "pending" }
            ]
          }
        }
      ]
    },
    {
      id: "turn-other",
      threadId: "thread-other",
      status: "inProgress",
      startedAt: 30,
      items: [
        {
          id: "turn-plan-other",
          type: "plan",
          title: "Updated Plan",
          text: "other",
          payload: { plan: [{ step: "Wrong thread", status: "inProgress" }] }
        }
      ]
    }
  ];

  expect(latestTaskPlan(turns, "thread-main")).toEqual({
    sourceKey: "thread-main:turn-new:turn-plan-new",
    explanation: "Implement the current checklist",
    steps: [
      { id: "turn-plan-new:0", text: "Inspect events", status: "completed" },
      { id: "turn-plan-new:1", text: "Build panel", status: "inProgress" },
      { id: "turn-plan-new:2", text: "Verify animation", status: "pending" }
    ]
  });
});

test("ignores streamed plan prose without a structured checklist", () => {
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-plan-text",
      threadId: "thread-main",
      status: "completed",
      items: [{ id: "plan-text", type: "plan", title: "Plan", text: "- A prose-only plan" }]
    }
  ];

  expect(latestTaskPlan(turns, "thread-main")).toBeNull();
});

test("newer untimed structured plan wins over an older timed plan", () => {
  const turns: WorkbenchTurn[] = [
    {
      id: "turn-old-timed",
      threadId: "thread-main",
      status: "completed",
      startedAt: 1_721_000_000,
      items: [{
        id: "plan-old-timed",
        type: "plan",
        title: "Updated Plan",
        text: "old",
        firstTokenAt: 1_721_000_001,
        payload: { plan: [{ step: "Old task", status: "completed" }] }
      }]
    },
    {
      id: "turn-new-untimed",
      threadId: "thread-main",
      status: "inProgress",
      items: [{
        id: "plan-new-untimed",
        type: "plan",
        title: "Updated Plan",
        text: "new",
        payload: { plan: [{ step: "Current task", status: "inProgress" }] }
      }]
    }
  ];

  expect(latestTaskPlan(turns, "thread-main")?.sourceKey).toBe("thread-main:turn-new-untimed:plan-new-untimed");
});

test("renders a Claude CLI task list through the same plan path as Codex", () => {
  // Exactly what CodeCliBridge emits for TaskCreate/TaskUpdate calls.
  const planItem = {
    type: "plan",
    id: "claude-plan-turn-claude",
    turnId: "turn-claude",
    threadId: "thread-claude",
    plan: [
      { step: "Fix resume", status: "completed", key: "tool-1", taskId: "1" },
      { step: "Render the checklist", status: "in_progress", key: "tool-2", taskId: "2" },
      { step: "Add tests", status: "pending", key: "tool-3", taskId: "3" }
    ],
    text: "- [x] Fix resume\n- [ ] Render the checklist _(in progress)_\n- [ ] Add tests",
    status: "inProgress"
  };

  const live = applyNotification(
    { ...initialClientState, activeThreadId: "thread-claude" },
    { method: "item/completed", params: { threadId: "thread-claude", turnId: "turn-claude", item: planItem } }
  );
  const liveItem = live.turns.find((turn) => turn.id === "turn-claude")?.items[0];
  expect(liveItem?.type).toBe("plan");
  expect(liveItem?.text).toBe(planItem.text);

  const expectedSteps = [
    { id: "claude-plan-turn-claude:0", text: "Fix resume", status: "completed" },
    { id: "claude-plan-turn-claude:1", text: "Render the checklist", status: "inProgress" },
    { id: "claude-plan-turn-claude:2", text: "Add tests", status: "pending" }
  ];
  expect(latestTaskPlan(live.turns, "thread-claude")?.steps).toEqual(expectedSteps);

  // The same item replayed from thread/read keeps the panel populated after a
  // thread is reopened from history.
  const { turns: restored } = threadReadToTurns({
    thread: {
      id: "thread-claude",
      turns: [{ id: "turn-claude", status: "completed", items: [planItem] }]
    }
  });
  expect(latestTaskPlan(restored, "thread-claude")?.steps).toEqual(expectedSteps);
});
