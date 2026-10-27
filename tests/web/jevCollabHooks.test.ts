import { describe, expect, test } from "bun:test";
import {
  buildJevState,
  extractJevCollabBrief,
  extractJevCollabReport,
} from "../../frontends/jev/src/jev/jevQuestions";

describe("buildJevState original request anchor", () => {
  test("short threads keep the single user_prompt block", () => {
    const state = buildJevState({
      threadId: "t",
      turnId: "u1",
      items: [
        { type: "userMessage", text: "Fix the login bug" },
        { type: "agentMessage", text: "Fixed in auth.ts" },
      ],
    });
    expect(state).toContain("user_prompt:\nFix the login bug");
    expect(state).not.toContain("original_request:");
  });

  test("long nudge loops anchor on the original request, not the nudge", () => {
    const state = buildJevState({
      threadId: "t",
      turnId: "u4",
      items: [
        { type: "userMessage", text: "Migrate the MCP client to streamable HTTP" },
        { type: "agentMessage", text: "Partial work done" },
        { type: "userMessage", text: "[JEV 督促] continue working" },
        { type: "agentMessage", text: "More work done" },
        { type: "userMessage", text: "[JEV 督促] continue working again" },
        { type: "agentMessage", text: "Almost there" },
      ],
    });
    expect(state).toContain("original_request:\nMigrate the MCP client to streamable HTTP");
    expect(state).toContain("[JEV 督促] continue working again");
  });
});

describe("extractJevCollabBrief", () => {
  test("accepts opencode task items", () => {
    const brief = extractJevCollabBrief({
      type: "collabAgentToolCall",
      id: "opencode-subtask-call_1",
      tool: "task",
      prompt: "Search for sorting algorithms",
      agentName: "Search the codebase",
      agentId: "ses_child_456",
    });
    expect(brief).toEqual({
      agentId: "ses_child_456",
      taskName: "Search the codebase",
      brief: "Search for sorting algorithms",
    });
  });

  test("accepts claude Agent group items, falls back to item id", () => {
    const brief = extractJevCollabBrief({
      type: "collabAgentToolCall",
      id: "claude-agents-turn-1",
      tool: "Agent",
      prompt: "Explore the auth flow",
      agentRole: "Explore",
    });
    expect(brief?.agentId).toBe("claude-agents-turn-1");
    expect(brief?.taskName).toBe("Explore");
  });

  test("rejects non-collab items and empty prompts", () => {
    expect(extractJevCollabBrief({ type: "toolCall", name: "sa_vm", id: "x" })).toBeNull();
    expect(extractJevCollabBrief({ type: "collabAgentToolCall", id: "x", prompt: "  " })).toBeNull();
    expect(extractJevCollabBrief({ type: "collabAgentToolCall", prompt: "do things" })).toBeNull();
  });
});

describe("extractJevCollabReport", () => {
  test("prefers opencode output over one-line summaries", () => {
    const report = extractJevCollabReport({
      type: "collabAgentToolCall",
      id: "opencode-subtask-call_1",
      tool: "task",
      status: "completed",
      agentStatus: "completed",
      agentId: "ses_child_456",
      agentName: "Search the codebase",
      output: "Found bubble_sort in src/sort.ts, covered by tests/sort.test.ts (4 passing).",
      agentsStates: { ses_child_456: { status: "completed", message: "Search the codebase" } },
    });
    expect(report?.status).toBe("completed");
    expect(report?.report).toContain("bubble_sort");
  });

  test("falls back to claude agentsStates summaries", () => {
    const report = extractJevCollabReport({
      type: "collabAgentToolCall",
      id: "claude-agents-turn-1",
      tool: "Agent",
      status: "completed",
      agentsStates: {
        child1: { status: "completed", message: "Auth flow uses OAuth2 with PKCE; token refresh in session.ts lines 40-80." },
      },
    });
    expect(report?.report).toContain("PKCE");
  });

  test("rejects running items and placeholder-only summaries", () => {
    expect(extractJevCollabReport({
      type: "collabAgentToolCall", id: "x", status: "inProgress", agentStatus: "running",
      prompt: "p", agentsStates: { c: { status: "running", message: "Explore running" } },
    })).toBeNull();
    expect(extractJevCollabReport({
      type: "collabAgentToolCall", id: "x", status: "completed",
      agentsStates: { c: { status: "completed", message: "Explore completed" } },
    })).toBeNull();
    expect(extractJevCollabReport({ type: "toolCall", name: "wait_agent", id: "x" })).toBeNull();
  });
});
