import { expect, test } from "bun:test";

const {
  OFFICIAL_CLAUDE_INSTALL_SCRIPT,
  OFFICIAL_CODEX_INSTALL_SCRIPT,
  runOfficialClaudeInstaller,
  runOfficialCodexInstaller,
} = require("../../desktop/codex-installer.cjs") as {
  OFFICIAL_CLAUDE_INSTALL_SCRIPT: string;
  OFFICIAL_CODEX_INSTALL_SCRIPT: string;
  runOfficialClaudeInstaller(options: Record<string, unknown>): Promise<string>;
  runOfficialCodexInstaller(options: Record<string, unknown>): Promise<string>;
};

test("runs only the fixed official installer scripts", async () => {
  const calls: Array<{ executable: string; args: string[] }> = [];
  const execFileImpl = (executable: string, args: string[], _options: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
    calls.push({ executable, args });
    callback(null, "installed", "");
  };
  const options = {
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    execFileImpl,
  };
  await runOfficialCodexInstaller(options);
  await runOfficialClaudeInstaller(options);
  expect(calls.map((call) => call.args.at(-1))).toEqual([
    OFFICIAL_CODEX_INSTALL_SCRIPT,
    OFFICIAL_CLAUDE_INSTALL_SCRIPT,
  ]);
  expect(calls.every((call) => call.executable.endsWith("powershell.exe"))).toBe(true);
  expect(calls.every((call) => call.args.includes("ByPass"))).toBe(true);
});

test("rejects automatic installation outside Windows", async () => {
  expect(runOfficialCodexInstaller({ platform: "linux" })).rejects.toThrow("only available on Windows");
  expect(runOfficialClaudeInstaller({ platform: "darwin" })).rejects.toThrow("only available on Windows");
});
