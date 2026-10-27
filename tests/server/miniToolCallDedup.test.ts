import { describe, expect, test } from "bun:test";
import {
  dedupeMiniToolCalls,
  miniAutoVerifyTarget,
  miniAutoVerifyTargets,
  miniPatchTouchedFiles,
  sanitizeMiniChatMessages,
  sanitizeMiniResponsesInput,
  uniqueMiniCallId,
} from "../../backends/mini/src/runtime/miniBridge.ts";
import { sanitizeThread } from "../../mini-codex/src/responses.ts";

const CALL_ID = "call_01a0a5d9c72678e0848d987515595a86";

describe("mini responses duplicate function_call_output guard", () => {
  test("dedupeMiniToolCalls keeps the first call per call_id", () => {
    const calls = dedupeMiniToolCalls([
      { callId: CALL_ID, name: "read_skill", args: "{}" },
      { callId: CALL_ID, name: "read_skill", args: "{}" },
      { callId: "call_other", name: "sa_vm", args: "{}" },
    ]);
    expect(calls.length).toBe(2);
    expect(calls[0]?.callId).toBe(CALL_ID);
    expect(calls[1]?.callId).toBe("call_other");
  });

  test("sanitizeMiniResponsesInput drops duplicate outputs and orphan outputs", () => {
    const input = sanitizeMiniResponsesInput([
      { role: "user", content: [{ type: "input_text", text: "hi," }] },
      { type: "function_call", call_id: CALL_ID, name: "read_skill", arguments: "{}" },
      { type: "function_call_output", call_id: CALL_ID, output: "first" },
      { type: "function_call_output", call_id: CALL_ID, output: "second (relay echo)" },
      { type: "function_call_output", call_id: "call_orphan", output: "no matching call" },
    ]);
    const outputs = input.filter((it) => it.type === "function_call_output");
    expect(outputs.length).toBe(1);
    expect(String(outputs[0]?.output)).toBe("first");
    expect(input.filter((it) => it.type === "function_call").length).toBe(1);
  });

  test("sanitizeMiniResponsesInput dedupes id-field and custom_tool_call variants", () => {
    const input = sanitizeMiniResponsesInput([
      { type: "function_call", call_id: CALL_ID, name: "sa_vm", arguments: "{}" },
      { type: "function_call", id: CALL_ID, name: "sa_vm", arguments: "{}" },
      { type: "custom_tool_call", call_id: CALL_ID, name: "sa_vm", input: "{}" },
      { type: "function_call_output", call_id: CALL_ID, output: "first" },
      { type: "custom_tool_call_output", call_id: CALL_ID, output: "second" },
      { type: "function_call_output", id: CALL_ID, output: "third" },
    ]);
    const calls = input.filter((it) => it.type === "function_call" || it.type === "custom_tool_call");
    const outputs = input.filter((it) => it.type === "function_call_output" || it.type === "custom_tool_call_output");
    expect(calls.length).toBe(1);
    expect(outputs.length).toBe(1);
    expect(String(outputs[0]?.output)).toBe("first");
  });

  test("uniqueMiniCallId remints cross-round reused call ids", () => {
    const issued = new Set<string>();
    const round1 = new Set<string>();
    expect(uniqueMiniCallId(CALL_ID, issued, round1)).toBe(CALL_ID);
    expect(uniqueMiniCallId(CALL_ID, issued, round1)).toBeNull();
    const round2 = new Set<string>();
    const reminted = uniqueMiniCallId(CALL_ID, issued, round2);
    expect(typeof reminted).toBe("string");
    expect(String(reminted)).not.toBe(CALL_ID);
    expect(String(reminted).length).toBeGreaterThan(8);
  });

  test("sanitizeMiniChatMessages dedupes tool outputs per tool_call_id", () => {
    const msgs = sanitizeMiniChatMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "hi," },
      { role: "assistant", content: null, tool_calls: [{ id: CALL_ID, type: "function", function: { name: "sa_vm", arguments: "{}" } }] },
      { role: "tool", tool_call_id: CALL_ID, content: "first" },
      { role: "tool", tool_call_id: CALL_ID, content: "second (relay echo)" },
    ]);
    const tools = msgs.filter((m) => m.role === "tool");
    expect(tools.length).toBe(1);
    expect(String(tools[0]?.content)).toBe("first");
  });

  test("standalone mini-codex sanitizeThread keeps one call/output pair", () => {
    const thread = sanitizeThread([
      { type: "user", text: "hi," },
      { type: "function_call", callId: CALL_ID, name: "read_skill", args: "{}" },
      { type: "function_call_output", callId: CALL_ID, output: "first" },
      { type: "function_call_output", callId: CALL_ID, output: "second (relay echo)" },
    ]);
    expect(thread.filter((it) => it.type === "function_call_output").length).toBe(1);
    expect(thread.filter((it) => it.type === "function_call").length).toBe(1);
  });
});

describe("miniAutoVerifyTarget", () => {
  test("fires on successful single-file writes with a target path", () => {
    expect(miniAutoVerifyTarget("edit_file", { path: "src/a.ts" }, "Successfully edited src/a.ts")).toBe("src/a.ts");
    expect(miniAutoVerifyTarget("write", { file: "src/b.ts" }, "Successfully wrote 42 bytes to src/b.ts")).toBe("src/b.ts");
  });

  test("stays silent for reads, failures, denials, and missing paths", () => {
    expect(miniAutoVerifyTarget("read_file", { path: "src/a.ts" }, "content...")).toBeNull();
    expect(miniAutoVerifyTarget("apply_patch", { patch: "..." }, "Successfully applied")).toBeNull();
    expect(miniAutoVerifyTarget("edit_file", { path: "src/a.ts" }, "blocked: plan mode is read-only")).toBeNull();
    expect(miniAutoVerifyTarget("edit_file", {}, "Successfully edited")).toBeNull();
    expect(miniAutoVerifyTarget("edit_file", { path: "src/a.ts" }, "error: old_text not found")).toBeNull();
  });

  test("respects the SA_VM_MINI_AUTO_VERIFY=false kill switch", () => {
    const prev = process.env.SA_VM_MINI_AUTO_VERIFY;
    process.env.SA_VM_MINI_AUTO_VERIFY = "false";
    try {
      expect(miniAutoVerifyTarget("edit_file", { path: "src/a.ts" }, "Successfully edited src/a.ts")).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.SA_VM_MINI_AUTO_VERIFY;
      else process.env.SA_VM_MINI_AUTO_VERIFY = prev;
    }
  });

  test("extracts up to 5 touched files from a patch envelope", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "*** Add File: src/b.ts",
      "+hello",
      "*** Update File: src/a.ts",
      "@@ -2 +2 @@",
      "-z",
      "+w",
      "*** Move to: src/c.ts",
      "*** End Patch",
    ].join("\n");
    expect(miniPatchTouchedFiles(patch)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(miniPatchTouchedFiles("not a patch")).toEqual([]);
    expect(miniPatchTouchedFiles(null)).toEqual([]);
  });

  test("fires on successful apply_patch with envelope file list", () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@ -1 +1 @@\n-x\n+y\n*** End Patch";
    expect(miniAutoVerifyTargets("apply_patch", { patch }, "Successfully applied 1 patch operations.")).toEqual(["src/a.ts"]);
    expect(miniAutoVerifyTargets("apply_patch", { patch }, "apply_patch error: empty update hunk")).toEqual([]);
    expect(miniAutoVerifyTarget("apply_patch", { patch }, "Successfully applied 1 patch operations.")).toBe("src/a.ts");
  });
});
