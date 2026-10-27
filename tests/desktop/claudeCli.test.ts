import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { findClaudeCli, resolveClaudeVersionProbe } = require("../../desktop/claude-cli.cjs") as {
  findClaudeCli(
    env?: Record<string, string>,
    platform?: string,
    probe?: (command: string) => string | null,
    report?: (attempt: { candidate: string; detail: string }) => void,
    installDirectory?: string,
  ): { command: string; version: string; env: Record<string, string> } | null;
  resolveClaudeVersionProbe(command: string, platform?: string, env?: Record<string, string>): {
    executable: string;
    args: string[];
    windowsVerbatimArguments: boolean;
  };
};

test("uses claude.exe beside Codex Ultra after PATH candidates", () => {
  const root = mkdtempSync(join(tmpdir(), "claude-cli-install-directory-test-"));
  try {
    const pathDirectory = join(root, "path");
    const installedClaude = join(root, "claude.exe");
    const pathClaude = join(pathDirectory, "claude.exe");
    mkdirSync(pathDirectory, { recursive: true });
    writeFileSync(installedClaude, "native claude placeholder");
    writeFileSync(pathClaude, "native claude placeholder");
    const attempts: string[] = [];
    const detected = findClaudeCli(
      { PATH: pathDirectory },
      "win32",
      (command) => {
        attempts.push(command);
        return command === installedClaude ? "2.1.222 (Claude Code)" : null;
      },
      undefined,
      root,
    );
    expect(detected?.command).toBe(installedClaude);
    expect(attempts.indexOf(pathClaude)).toBeLessThan(attempts.indexOf(installedClaude));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("probes Windows Claude command shims through cmd", () => {
  expect(resolveClaudeVersionProbe(
    "D:\\Program Files\\nodejs\\claude.cmd",
    "win32",
    { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  )).toEqual({
    executable: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", 'call "D:\\Program Files\\nodejs\\claude.cmd" --version'],
    windowsVerbatimArguments: true,
  });
});

test("desktop enables the Claude-compatible runtime by default", () => {
  const source = readFileSync(join(import.meta.dir, "../../desktop/main.cjs"), "utf8");

  expect(source).toContain('CODEX_UI_CLAUDE_COMPATIBLE_CLI_ENABLED: process.env.CODEX_UI_CLAUDE_COMPATIBLE_CLI_ENABLED ?? "1"');
});
