import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatWaterfall } from "../../apps/web/src/waterfall/ChatWaterfall";
import { ChatRow } from "../../apps/web/src/waterfall/ChatRow";
import { TaskPlanPanel } from "../../apps/web/src/waterfall/TaskPlanPanel";
import { ChatFloorRail, type ChatFloorEntry } from "../../apps/web/src/waterfall/ChatFloorRail";
import { ChatSearchOverlay, buildChatSearchResults } from "../../apps/web/src/waterfall/ChatSearchOverlay";
import { AgentOverviewGrid } from "../../apps/web/src/waterfall/AgentOverviewGrid";
import { GitFileDiffView, UnifiedDiffBlock, diffLineStats, fileChangeStatsLabel } from "../../apps/web/src/waterfall/ChatDiffView";
import type { ChatWaterfallRow } from "../../apps/web/src/waterfall/types";
import type { TaskPlan } from "../../apps/web/src/waterfall/taskPlan";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined }
});

const t = (k: string) => k;

const sampleUserRow: ChatWaterfallRow = {
  key: "turn-1-user",
  turnId: "turn-1",
  index: 0,
  kind: "userMessage",
  title: "You",
  text: "Please refactor the database module to support SQLite transactions.",
  startedAt: 1700000000,
  status: "completed",
  searchText: "please refactor the database module to support sqlite transactions",
  item: {
    id: "item-user-1",
    type: "userMessage",
    title: "You",
    text: "Please refactor the database module to support SQLite transactions.",
    status: "completed"
  }
};

const sampleAssistantRow: ChatWaterfallRow = {
  key: "turn-1-assistant",
  turnId: "turn-1",
  index: 1,
  kind: "assistantMessage",
  title: "Codex Ultra",
  text: "I have updated the **Database** connection and added *transactional* rollbacks.",
  startedAt: 1700000005,
  status: "completed",
  searchText: "i have updated the database connection and added transactional rollbacks",
  item: {
    id: "item-assistant-1",
    type: "agentMessage",
    title: "Codex Ultra",
    text: "I have updated the **Database** connection and added *transactional* rollbacks.",
    status: "completed"
  }
};

const samplePlanRow: ChatWaterfallRow = {
  key: "turn-1-plan",
  turnId: "turn-1",
  index: 2,
  kind: "plan",
  title: "Execution Plan",
  text: "- [x] Step 1: Analyze schema\n- [ ] Step 2: Implement SQLite transaction wrapper\n- [ ] Step 3: Run stress test",
  startedAt: 1700000001,
  status: "completed",
  searchText: "execution plan analyze schema",
  item: {
    id: "item-plan-1",
    type: "plan",
    title: "Execution Plan",
    text: "- [x] Step 1: Analyze schema\n- [ ] Step 2: Implement SQLite transaction wrapper\n- [ ] Step 3: Run stress test",
    status: "completed"
  }
};

const sampleCommandRow: ChatWaterfallRow = {
  key: "turn-1-cmd",
  turnId: "turn-1",
  index: 3,
  kind: "commandExecution",
  title: "bun test tests/server/sqlite.test.ts",
  text: "15 pass, 0 fail (210ms)",
  startedAt: 1700000010,
  completedAt: 1700000011,
  status: "completed",
  searchText: "bun test tests/server/sqlite.test.ts 15 pass",
  item: {
    id: "item-cmd-1",
    type: "commandExecution",
    title: "bun test tests/server/sqlite.test.ts",
    text: "15 pass, 0 fail (210ms)",
    status: "completed",
    payload: {
      command: "bun test tests/server/sqlite.test.ts"
    }
  }
};

const sampleFileChangeRow: ChatWaterfallRow = {
  key: "turn-1-file",
  turnId: "turn-1",
  index: 4,
  kind: "fileChange",
  title: "Edit apps/server/src/database.ts",
  text: "+15 -3 lines",
  startedAt: 1700000015,
  status: "completed",
  searchText: "edit apps/server/src/database.ts",
  item: {
    id: "item-file-1",
    type: "fileChange",
    title: "Edit apps/server/src/database.ts",
    text: "--- a/database.ts\n+++ b/database.ts\n@@ -10,3 +10,15 @@\n+export function withTransaction() {\n+  return true;\n+}",
    status: "completed",
    payload: {
      path: "apps/server/src/database.ts"
    }
  }
};

const sampleToolCallRow: ChatWaterfallRow = {
  key: "turn-1-tool",
  turnId: "turn-1",
  index: 5,
  kind: "toolCall",
  title: "read_file",
  text: '{"path": "apps/server/src/database.ts"}',
  startedAt: 1700000008,
  status: "completed",
  searchText: "read_file apps/server/src/database.ts",
  item: {
    id: "item-tool-1",
    type: "dynamicToolCall",
    title: "read_file",
    text: '{"path": "apps/server/src/database.ts"}',
    status: "completed"
  }
};

// 1. ChatWaterfall container test
test("ChatWaterfall renders scroll container and empty state before banner", () => {
  const html = renderToStaticMarkup(
    <ChatWaterfall
      rows={[]}
      t={t}
      before={<div data-testid="waterfall-before-banner">Goal in progress</div>}
    />
  );

  expect(html).toContain('data-testid="chat-waterfall-scroll"');
  expect(html).toContain('data-testid="waterfall-before-banner"');
  expect(html).toContain("Goal in progress");
});

test("ChatWaterfall renders populated waterfall surface", () => {
  const html = renderToStaticMarkup(
    <ChatWaterfall
      rows={[sampleUserRow, sampleAssistantRow]}
      t={t}
    />
  );

  expect(html).toContain('data-testid="chat-waterfall-scroll"');
  expect(html).toContain('data-testid="conversation-waterfall"');
  expect(html).toContain('data-row-count="2"');
});

// 2. UserMessageRow test: normal, waiting, and inline editing
test("UserMessageRow renders message bubble, PersonIcon, and waiting chip", () => {
  const waitingRow: ChatWaterfallRow = {
    ...sampleUserRow,
    key: "turn-1-waiting",
    status: "waiting"
  };

  const html = renderToStaticMarkup(<ChatRow row={waitingRow} t={t} />);

  expect(html).toContain('data-testid="pending-append-status"');
  expect(html).toContain("Please refactor the database module");
  expect(html).toContain("PersonIcon");
});

test("UserMessageRow renders inline editing input and action buttons", () => {
  const html = renderToStaticMarkup(
    <ChatRow
      row={sampleUserRow}
      t={t}
      editing={true}
      editText="Revised prompt for transaction rollbacks"
      onEditTextChange={() => {}}
      onEditSubmit={() => {}}
      onEditCancel={() => {}}
    />
  );

  expect(html).toContain('data-testid="edit-last-message-input"');
  expect(html).toContain('data-testid="cancel-edit-message"');
  expect(html).toContain('data-testid="send-edited-message"');
  expect(html).toContain("Revised prompt for transaction rollbacks");
});

// 3. AssistantMessageRow test
test("AssistantMessageRow renders assistant name and formatted markdown", () => {
  const html = renderToStaticMarkup(<ChatRow row={sampleAssistantRow} t={t} />);

  expect(html).toContain("Codex Ultra");
  expect(html).toContain("<strong");
  expect(html).toContain("Database");
});

// 4. PlanRow test
test("PlanRow renders plan title, checklist icon, and checklist markdown", () => {
  const html = renderToStaticMarkup(<ChatRow row={samplePlanRow} t={t} />);

  expect(html).toContain("Execution Plan");
  expect(html).toContain("ChecklistIcon");
  expect(html).toContain("Analyze schema");
  expect(html).toContain("Implement SQLite transaction wrapper");
});

// 5. CommandExecutionRow test
test("CommandExecutionRow renders command text and execution details", () => {
  const html = renderToStaticMarkup(<ChatRow row={sampleCommandRow} t={t} />);

  expect(html).toContain("bun test tests/server/sqlite.test.ts");
  expect(html).toContain("Ran");
});

// 6. FileChangeRow & Diff test
test("FileChangeRow renders file change details with filename summary", () => {
  const html = renderToStaticMarkup(
    <ChatRow
      row={sampleFileChangeRow}
      t={t}
      onUndoFileChanges={() => {}}
      onReviewFileChanges={() => {}}
    />
  );

  expect(html).toContain("database.ts");
});

test("UnifiedDiffBlock renders diff lines with insertions and deletions", () => {
  const diff = "--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,2 @@\n-oldLine\n+newLine";
  const html = renderToStaticMarkup(<UnifiedDiffBlock text={diff} />);

  expect(html).toContain("oldLine");
  expect(html).toContain("newLine");
});

test("diffLineStats computes additions and deletions accurately", () => {
  const diff = "--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,3 @@\n-line1\n+lineA\n+lineB";
  const stats = diffLineStats(diff);

  expect(stats.additions).toBe(2);
  expect(stats.deletions).toBe(1);
  expect(fileChangeStatsLabel(stats.additions, stats.deletions)).toBe("(+2 -1)");
});

// 7. ToolCallRow test
test("ToolCallRow renders tool name and payload content", () => {
  const html = renderToStaticMarkup(<ChatRow row={sampleToolCallRow} t={t} />);

  expect(html).toContain("Read");
  expect(html).toContain("apps/server/src/database.ts");
});

test("ToolCallRow renders vm-edit and mcptool-edit with colorized (+additions, -deletions)", () => {
  const vmEditRow: ChatWaterfallRow = {
    key: "turn-1-vm-edit",
    turnId: "turn-1",
    index: 6,
    kind: "toolCall",
    title: "sa_vm_run",
    text: "",
    status: "completed",
    searchText: "vm-edit src/App.tsx",
    item: {
      id: "item-vm-edit-1",
      type: "dynamicToolCall",
      title: "sa_vm_run",
      text: "",
      status: "completed",
      payload: {
        tool: "sa_vm_run",
        input: {
          action: "edit_file",
          path: "src/App.tsx",
          old_text: "const count = 0;",
          new_text: "const count = 1;\nconst active = true;"
        }
      }
    }
  };

  const html = renderToStaticMarkup(<ChatRow row={vmEditRow} t={t} />);
  expect(html).toContain("vm-edit");
  expect(html).toContain("src/App.tsx");
  expect(html).toContain("+2");
  expect(html).toContain("-1");

  const mcpEditRow: ChatWaterfallRow = {
    key: "turn-1-mcp-edit",
    turnId: "turn-1",
    index: 7,
    kind: "toolCall",
    title: "call_mcp_tool",
    text: "",
    status: "completed",
    searchText: "mcptool-edit src/Button.tsx",
    item: {
      id: "item-mcp-edit-1",
      type: "dynamicToolCall",
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
            path: "src/Button.tsx",
            old_text: "<button>1</button>",
            new_text: "<button>2</button>"
          }
        }
      }
    }
  };

  const mcpHtml = renderToStaticMarkup(<ChatRow row={mcpEditRow} t={t} />);
  expect(mcpHtml).toContain("mcptool-edit");
  expect(mcpHtml).toContain("src/Button.tsx");
  expect(mcpHtml).toContain("+1");
  expect(mcpHtml).toContain("-1");
});

// 8. TaskPlanPanel overlay test
test("TaskPlanPanel renders floating overlay, progress, and step icons", () => {
  const plan: TaskPlan = {
    sourceKey: "plan-task-1",
    steps: [
      { id: "s1", text: "Database migrations", status: "completed" },
      { id: "s2", text: "Transaction rollback handler", status: "inProgress" },
      { id: "s3", text: "Concurrency integration tests", status: "pending" }
    ]
  };

  const html = renderToStaticMarkup(<TaskPlanPanel plan={plan} t={t} />);

  expect(html).toContain('data-testid="task-plan-overlay"');
  expect(html).toContain('data-testid="task-plan-panel"');
  expect(html).toContain("Database migrations");
  expect(html).toContain("Transaction rollback handler");
  expect(html).toContain("Concurrency integration tests");
});

// 9. ChatFloorRail jump navigation test
test("ChatFloorRail renders jump rail container, drag handle, and prompt label", () => {
  const floors: ChatFloorEntry[] = [
    { rowIndex: 0, index: 1, label: "Floor 1: Prompt" },
    { rowIndex: 4, index: 2, label: "Floor 2: Refactor" },
    { rowIndex: 10, index: 3, label: "Floor 3: Verify" }
  ];

  const html = renderToStaticMarkup(
    <ChatFloorRail
      floors={floors}
      activeFloorIndex={2}
      onJump={() => {}}
    />
  );

  expect(html).toContain('data-testid="chat-floor-rail"');
  expect(html).toContain('data-testid="chat-floor-drag-handle"');
  expect(html).toContain("Prompts");
});

// 10. ChatSearchOverlay search test
test("ChatSearchOverlay renders search field and scope selector", () => {
  const rows = [sampleUserRow, sampleAssistantRow, sampleCommandRow];
  const results = buildChatSearchResults(rows, "database", "all");

  expect(results.length).toBe(2);

  const html = renderToStaticMarkup(
    <ChatSearchOverlay
      open={true}
      rows={rows}
      term="database"
      scope="all"
      selectedIndex={0}
      results={results}
      onOpen={() => {}}
      onClose={() => {}}
      onTermChange={() => {}}
      onScopeChange={() => {}}
      onSelectIndex={() => {}}
    />
  );

  expect(html).toContain('data-testid="chat-search-overlay"');
  expect(html).toContain('aria-label="Search transcript"');
  expect(html).toContain('data-testid="chat-search-scope"');
});

// 11. AgentOverviewGrid multi-agent test
test("AgentOverviewGrid renders grid container with agent grid markers", () => {
  const agentRows: ChatWaterfallRow[] = [
    {
      key: "agent-1",
      turnId: "turn-agent-1",
      index: 0,
      kind: "agentCard",
      title: "Backend Specialist",
      text: "Working on SQLite database wrapper",
      startedAt: 1700000000,
      status: "inProgress",
      searchText: "backend specialist working on sqlite",
      item: {
        id: "item-agent-1",
        type: "agentMessage",
        title: "Backend Specialist",
        text: "Working on SQLite database wrapper",
        status: "inProgress"
      }
    }
  ];

  const html = renderToStaticMarkup(
    <AgentOverviewGrid
      rows={agentRows}
      resetKey="overview-1"
      onOpenAgent={() => {}}
    />
  );

  expect(html).toContain('data-agent-overview-grid="true"');
  expect(html).toContain('data-testid="conversation-waterfall"');
  expect(html).toContain('data-row-count="1"');
});
