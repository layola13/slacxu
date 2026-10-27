import { describe, expect, test } from "bun:test";
import {
  onMiniServerHook,
  runWithServerMcpHooks,
  shouldAutoRememberServerToolResult,
} from "../../backends/mini/src/runtime/miniServerHooks.ts";

describe("mini server MCP hooks", () => {
  test("fires Pre/PostToolUse around the raw runner and preserves errors", async () => {
    const events: string[] = [];
    const off = onMiniServerHook((event) => { events.push(event); });
    try {
      const out = await runWithServerMcpHooks(
        "mcp__demo__read",
        { path: "a.txt" },
        async () => "ok-content-with-enough-length",
        { threadId: "t1", turnId: "turn1", cwd: "" },
      );
      expect(out).toBe("ok-content-with-enough-length");
      expect(events).toEqual(["PreToolUse", "PostToolUse"]);

      events.length = 0;
      let threw = false;
      try {
        await runWithServerMcpHooks("mcp__demo__boom", {}, async () => { throw new Error("boom"); }, {});
      } catch (e) {
        threw = true;
        expect((e as Error).message).toBe("boom");
      }
      expect(threw).toBe(true);
      expect(events).toEqual(["PreToolUse", "PostToolUse"]);
    } finally {
      off();
    }
  });

  test("auto-remember triage mirrors mini-codex keywords and ignores noise", () => {
    expect(shouldAutoRememberServerToolResult("mcp__demo__x", "short")).toBeNull();
    expect(shouldAutoRememberServerToolResult("mcp__demo__x", "tool error: something failed badly here")).toBeNull();
    const hit = shouldAutoRememberServerToolResult(
      "mcp__demo__cfg",
      "用户偏好：以后构建都用 bun，不要用 npm，这个约定长期有效请记住",
    );
    expect(hit).not.toBeNull();
    expect(hit!).toContain("mcp__demo__cfg");
  });
});
