// Verification for mini-codex MCP hook events (Codex parity).
// Run: bun test test/hooks.test.ts
import { describe, expect, test } from "bun:test";
import {
  executeHooks, loadHookEvents, matcherMatches, mcpHookToolInput,
  parseHookOutput, renderMcpHookInput, selectHookHandlers,
  type HookEvents,
} from "../src/hooks.ts";
import { runToolWithHooks } from "../src/mcpHooks.ts";

describe("matcher (Codex parity)", () => {
  test("empty matcher matches all", () => {
    expect(matcherMatches(undefined, "mcp__fs__read")).toBe(true);
    expect(matcherMatches("", "mcp__fs__read")).toBe(true);
  });
  test("regex matcher", () => {
    expect(matcherMatches("^mcp__", "mcp__fs__read")).toBe(true);
    expect(matcherMatches("^mcp__", "sa_vm")).toBe(false);
    expect(matcherMatches("Write|Edit", "Edit")).toBe(true);
  });
  test("invalid regex falls back to substring", () => {
    expect(matcherMatches("([", "tool ([x]")).toBe(true);
  });
  test("selectHookHandlers keeps display order", () => {
    const ev: HookEvents = {
      PreToolUse: [
        { matcher: "^mcp__", hooks: [{ type: "command", command: "echo hi" }] },
        { hooks: [{ type: "command", command: "echo all" }] },
      ],
    };
    const sel = selectHookHandlers(ev, "PreToolUse", "mcp__a__b");
    expect(sel.length).toBe(2);
    expect(sel[0].index).toBe(0);
    expect(sel[1].index).toBe(1);
    const none = selectHookHandlers(ev, "PreToolUse", "sa_vm");
    expect(none.length).toBe(1);
  });
});

describe("mcpHookToolInput (Codex parity)", () => {
  test("object passes through", () => {
    expect(mcpHookToolInput({ a: 1 })).toEqual({ a: 1 });
  });
  test("empty string -> {}", () => {
    expect(mcpHookToolInput("")).toEqual({});
  });
  test("JSON string parsed", () => {
    expect(mcpHookToolInput('{"x":1}')).toEqual({ x: 1 });
  });
  test("non-JSON string -> {_raw}", () => {
    expect(mcpHookToolInput("hello")).toEqual({ _raw: "hello" });
  });
});

describe("renderMcpHookInput templating", () => {
  test("expands ${tool_input.*} (Codex test shape)", () => {
    const out = renderMcpHookInput(
      { file_path: "${tool_input.file_path}", include_ignored: false },
      {
        tool_name: "mcp__security__scan", tool_use_id: "u1", cwd: "/w",
        session_id: "s", turn_id: "t", server: "security", tool: "scan",
        tool_input: { file_path: "/a/b.txt" },
      },
    );
    expect(out).toEqual({ file_path: "/a/b.txt", include_ignored: false });
  });
  test("missing path -> empty string", () => {
    const out = renderMcpHookInput(
      { p: "${tool_input.missing}" },
      {
        tool_name: "n", tool_use_id: "u", cwd: "/w", session_id: "s",
        turn_id: "t", server: "sv", tool: "tl", tool_input: {},
      },
    );
    expect(out).toEqual({ p: "" });
  });
});

describe("parseHookOutput", () => {
  test("empty -> approve", () => {
    expect(parseHookOutput("", "PreToolUse").blocked).toBe(false);
  });
  test("decision block", () => {
    const p = parseHookOutput(JSON.stringify({ decision: "block", reason: "nope" }), "PreToolUse");
    expect(p.blocked).toBe(true);
    expect(p.blockReason).toBe("nope");
  });
  test("continue:false blocks", () => {
    expect(parseHookOutput(JSON.stringify({ continue: false }), "PreToolUse").blocked).toBe(true);
  });
  test("updatedInput + additionalContext", () => {
    const p = parseHookOutput(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { x: 2 },
        additionalContext: "ctx here",
      },
    }), "PreToolUse");
    expect(p.blocked).toBe(false);
    expect(p.updatedInput).toEqual({ x: 2 });
    expect(p.additionalContext).toBe("ctx here");
  });
  test("non-JSON stdout is warning only", () => {
    const p = parseHookOutput("just a note", "PreToolUse");
    expect(p.blocked).toBe(false);
    expect(p.systemMessage).toBe("just a note");
  });
});

describe("executeHooks with command handlers", () => {
  const ctxBase = {
    sessionId: "s1", turnId: "t1", cwd: process.cwd(), model: "test",
    toolName: "mcp__fs__read", toolUseId: "call-1",
    toolInput: { path: "/tmp/x" },
    callMcpRaw: async () => "",
    sink: undefined,
  };

  test("no handlers -> no events", async () => {
    const r = await executeHooks({}, [], "PreToolUse", ctxBase);
    expect(r.blocked).toBe(false);
    expect(r.hookEvents.length).toBe(0);
  });

  test("empty-output command -> completed event", async () => {
    const ev: HookEvents = { PreToolUse: [{ hooks: [{ type: "command", command: process.platform === "win32" ? "exit 0" : "true" }] }] };
    const seen: string[] = [];
    const r = await executeHooks(ev, [{ path: "test", source: "user" }], "PreToolUse", {
      ...ctxBase, sink: (e) => seen.push(e.type),
    });
    expect(r.blocked).toBe(false);
    expect(r.hookEvents.length).toBe(1);
    expect(r.hookEvents[0].run.status).toBe("completed");
    expect(seen).toEqual(["hook_started", "hook_completed"]);
  });

  test("block command -> blocked + reason", async () => {
    // NOTE: runShell already wraps with cmd.exe/sh, so pass the bare command.
    const command = process.platform === "win32"
      ? `echo {"decision":"block","reason":"policy says no"}`
      : `printf '%s' '{"decision":"block","reason":"policy says no"}'`;
    const ev: HookEvents = { PreToolUse: [{ hooks: [{ type: "command", command }] }] };
    const r = await executeHooks(ev, [{ path: "test", source: "user" }], "PreToolUse", ctxBase);
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toContain("policy says no");
    expect(r.hookEvents[0].run.status).toBe("blocked");
  });

  test("rewrite command -> updatedInput", async () => {
    const command = process.platform === "win32"
      ? `echo {"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"path":"/rewritten"}}}`
      : `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"path":"/rewritten"}}}'`;
    const ev: HookEvents = { PreToolUse: [{ hooks: [{ type: "command", command }] }] };
    const r = await executeHooks(ev, [{ path: "test", source: "user" }], "PreToolUse", ctxBase);
    expect(r.blocked).toBe(false);
    expect(r.updatedInput).toEqual({ path: "/rewritten" });
  });

  test("mcp_tool handler forwards its configured timeout to the raw MCP executor", async () => {
    const timeouts: number[] = [];
    const ev: HookEvents = {
      PreToolUse: [{ hooks: [{ type: "mcp_tool", server: "policy", tool: "check", input: {}, timeout: 1.25 }] }],
    };
    const r = await executeHooks(ev, [{ path: "test", source: "user" }], "PreToolUse", {
      ...ctxBase,
      callMcpRaw: async (_server, _tool, _input, timeoutMs) => {
        timeouts.push(timeoutMs);
        return "";
      },
    });
    expect(r.blocked).toBe(false);
    expect(timeouts).toEqual([1250]);
    expect(r.hookEvents[0]?.run.status).toBe("completed");
  });

  test("bad command -> failed event, no throw", async () => {
    const ev: HookEvents = { PreToolUse: [{ hooks: [{ type: "command", command: "definitely-not-a-real-binary-xyz" }] }] };
    const r = await executeHooks(ev, [{ path: "test", source: "user" }], "PreToolUse", ctxBase);
    expect(r.blocked).toBe(false);
    expect(r.hookEvents.length).toBe(1);
    expect(r.hookEvents[0].run.status).toBe("failed");
  });

  test("unsupported prompt handler -> failed event, no throw", async () => {
    const ev: HookEvents = { PreToolUse: [{ hooks: [{ type: "prompt" }] }] };
    const r = await executeHooks(ev, [{ path: "test", source: "user" }], "PreToolUse", ctxBase);
    expect(r.hookEvents[0].run.status).toBe("failed");
  });
});

describe("runToolWithHooks (no hooks configured)", () => {
  test("non-MCP tool passes through when no hooks file", async () => {
    const r = await runToolWithHooks("sa_vm", { action: "list_dir" }, "call-x", {
      cwd: process.cwd(), model: "test", sink: null,
      execNonMcp: async () => "ok-from-exec",
    });
    expect(r.output).toBe("ok-from-exec");
    expect(r.blocked).toBe(false);
  });
  test("loadHookEvents never throws without files", async () => {
    const ev = await loadHookEvents(process.cwd());
    expect(typeof ev).toBe("object");
  });
});
