import { expect, test } from "bun:test";
import { CLAUDE_COMPATIBLE_CLI_FLAG, type ClaudeCompatibleCliSettings, type CliBackend } from "@codex-ui/shared";

test("Claude-compatible CLI feature flag constant is stable", () => {
  expect(CLAUDE_COMPATIBLE_CLI_FLAG).toBe("claude_compatible_cli");
});

test("ClaudeCompatibleCliSettings has an enabled boolean field", () => {
  const settings: ClaudeCompatibleCliSettings = { enabled: false };
  expect(settings.enabled).toBe(false);
});

test("CliBackend type accepts both codex and claude", () => {
  const codex: CliBackend = "codex";
  const claude: CliBackend = "claude";
  expect(codex).toBe("codex");
  expect(claude).toBe("claude");
});
