import { describe, expect, test } from "bun:test";
import {
  TOOLS,
  SUBAGENT_TOOLS,
  isSubagentTool,
  toolsForDepth,
  parseTaskName,
} from "../../mini-codex/src/tools.ts";
import {
  toResponsesInput,
  toChatMessages,
} from "../../mini-codex/src/responses.ts";
import { MINI_SUBAGENT_MAX_CHILDREN } from "../../mini-codex/src/loop.ts";
import type { ThreadItem } from "../../mini-codex/src/types.ts";

describe("mini-codex standalone tools & limits", () => {
  test("toolsForDepth distinguishes root vs child subagent tools", () => {
    const rootTools = toolsForDepth(0);
    const childTools = toolsForDepth(1);

    expect(rootTools.some((t) => t.name === "spawn_agent")).toBe(true);
    expect(rootTools.some((t) => t.name === "wait_agent")).toBe(true);
    expect(rootTools.some((t) => t.name === "sa_vm")).toBe(true);
    expect(rootTools.some((t) => t.name === "image_view")).toBe(true);
    expect(rootTools.some((t) => t.name === "read_skill")).toBe(true);

    // Child tools must NOT include spawn_agent (depth limit 1)
    expect(childTools.some((t) => t.name === "spawn_agent")).toBe(false);
    expect(childTools.some((t) => t.name === "wait_agent")).toBe(false);
    expect(childTools.some((t) => t.name === "sa_vm")).toBe(true);
    expect(childTools.some((t) => t.name === "image_view")).toBe(true);
  });

  test("isSubagentTool identifies all subagent tools", () => {
    for (const tool of SUBAGENT_TOOLS) {
      expect(isSubagentTool(tool.name)).toBe(true);
    }
    expect(isSubagentTool("sa_vm")).toBe(false);
    expect(isSubagentTool("read_skill")).toBe(false);
    expect(isSubagentTool("image_view")).toBe(false);
  });

  test("parseTaskName strictly enforces lowercase alphanumeric format and length", () => {
    expect(parseTaskName("valid_task_1")).toBe("valid_task_1");
    expect(parseTaskName("task")).toBe("task");
    expect(parseTaskName("INVALID-TASK")).toBeNull();
    expect(parseTaskName("task with spaces")).toBeNull();
    expect(parseTaskName("")).toBeNull();
    expect(parseTaskName(null)).toBeNull();
    expect(parseTaskName("a".repeat(65))).toBeNull();
  });

  test("MINI_SUBAGENT_MAX_CHILDREN is 5", () => {
    expect(MINI_SUBAGENT_MAX_CHILDREN).toBe(5);
  });
});

describe("mini-codex message translation with image and function outputs", () => {
  test("toResponsesInput transforms image function outputs into native input_image blocks", () => {
    const thread: ThreadItem[] = [
      { type: "user", text: "check this screenshot" } as any,
      { type: "message", text: "I will view it" },
      { type: "function_call", callId: "call-1", name: "image_view", args: '{"path":"test.png"}' },
      {
        type: "function_call_output",
        callId: "call-1",
        output: "viewed test.png",
        images: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="],
      },
    ];

    const input = toResponsesInput(thread);
    expect(Array.isArray(input)).toBe(true);
    const outputBlock = input.find((item: any) => item.type === "function_call_output");
    expect(outputBlock).toBeDefined();
    expect(Array.isArray((outputBlock as any).output)).toBe(true);
    expect((outputBlock as any).output[1].type).toBe("input_image");
    expect((outputBlock as any).output[1].image_url).toContain("data:image/png;base64");
  });

  test("toChatMessages converts thread items to standard Chat Completions messages", () => {
    const thread: ThreadItem[] = [
      { type: "user", text: "inspect the error" } as any,
      { type: "function_call", callId: "c_1", name: "sa_vm", args: '{"action":"grep_search"}' },
      { type: "function_call_output", callId: "c_1", output: "found error in line 42" },
      { type: "message", text: "Fixed the error." },
    ];

    const msgs = toChatMessages(thread, "You are mini-codex assistant");
    expect(msgs[0]).toEqual({ role: "system", content: "You are mini-codex assistant" });
    expect(msgs[1]).toEqual({ role: "user", content: "inspect the error" });
    expect(msgs[2].role).toBe("assistant");
    expect((msgs[2] as any).tool_calls[0].id).toBe("c_1");
    expect(msgs[3]).toEqual({ role: "tool", tool_call_id: "c_1", content: "found error in line 42" });
    expect(msgs[4]).toEqual({ role: "assistant", content: "Fixed the error." });
  });
});
