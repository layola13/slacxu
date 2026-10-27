import { describe, expect, test } from "bun:test";
import { auggieTurnHasUnsettledTools, buildAuggieCollabItem, isAuggieSubagentUpdate } from "../../backends/auggie/src/runtime/auggieAgentBridge.js";

function sessionWith(items: Array<{ turnId: string; status: string }>) {
  return {
    toolCallsByAcpId: new Map(
      items.map((item, i) => [`tool-${i}`, { ...item }]),
    ),
  };
}

describe("auggie silence finalizer guard", () => {
  test("reports unsettled while a turn tool is in flight", () => {
    const session = sessionWith([
      { turnId: "t1", status: "inProgress" },
      { turnId: "t1", status: "completed" },
    ]);
    expect(auggieTurnHasUnsettledTools(session, "t1")).toBe(true);
  });

  test("ignores other turns and settled tools", () => {
    const session = sessionWith([
      { turnId: "t1", status: "completed" },
      { turnId: "t2", status: "inProgress" },
    ]);
    expect(auggieTurnHasUnsettledTools(session, "t1")).toBe(false);
    expect(auggieTurnHasUnsettledTools(session, "t2")).toBe(true);
  });

  test("empty tool map settles immediately", () => {
    expect(auggieTurnHasUnsettledTools(sessionWith([]), "t1")).toBe(false);
  });
});

describe("auggie subagent collab projection", () => {
  test("detects subagent frames by kind other without rawInput", () => {
    expect(isAuggieSubagentUpdate({ kind: "other" } as any)).toBe(true);
    expect(isAuggieSubagentUpdate({ kind: "other", rawInput: {} } as any)).toBe(false);
    expect(isAuggieSubagentUpdate({ kind: "editor", rawInput: {} } as any)).toBe(false);
    expect(isAuggieSubagentUpdate({} as any)).toBe(false);
  });

  test("builds a collabAgentToolCall from the agent title", () => {
    const item = buildAuggieCollabItem("thread-1", "turn-1", "sub-1", "red: explore repo", {}, undefined);
    expect(item.type).toBe("collabAgentToolCall");
    expect(item.tool).toBe("task");
    expect(item.agentId).toBe("sub-1");
    expect(item.agentName).toBe("red");
    expect(item.prompt).toBe("explore repo");
    expect(item.senderThreadId).toBe("thread-1");
    expect(item.status).toBe("inProgress");
  });
});
