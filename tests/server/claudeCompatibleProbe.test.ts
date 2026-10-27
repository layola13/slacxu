import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the probes under test
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  findClaudeBin,
  buildSafeClaudeEnv,
  ensureClaudeSpawnCwd,
  prepareClaudeThreadCwd,
  claudeCliSupportsEffort,
  resolveClaudeEffortForCli,
  validateClaudeWorkspace,
  mapPermissionMode,
  buildClaudeSpawnArgs,
  claudeProjectDirName,
  claudeTranscriptExists,
  resolveClaudeLaunch,
  resolveJavaScriptRuntime,
  probeClaudeCliCommand,
} from "../../backends/claude/src/runtime/claudeCompatibleProbe";

import { setPreferredCliBinary, storeLatestCliCache } from "../../apps/server/src/cliSelectionState";
import { resetNpmPrefixProbeCacheForTests } from "../../apps/server/src/cliVersions";

const RUNTIME_BASENAMES = new Set(["node", "node.exe", "bun", "bun.exe", "bun-debug", "bun-debug.exe"]);

function isolatedHome(): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), "claude-bin-isolated-"));
  resetNpmPrefixProbeCacheForTests();
  setPreferredCliBinary("claude", null);
  storeLatestCliCache("claude", [], undefined);
  return {
    dir,
    env: {
      PATH: "",
      Path: "",
      HOME: dir,
      USERPROFILE: dir,
      APPDATA: dir,
      LOCALAPPDATA: dir,
      npm_config_prefix: dir,
      NVM_BIN: "",
    },
  };
}

function isRuntimeBasename(command: string): boolean {
  return RUNTIME_BASENAMES.has(basename(command).toLowerCase());
}

function isElectronBasename(command: string): boolean {
  const base = basename(command).toLowerCase().replace(/\.exe$/, "");
  return new Set(["electron", "codexultra", "codexultradesktop"]).has(base.replace(/[^a-z0-9]/g, ""));
}

test("findClaudeBin: defaults to 'claude' when no env override", () => {
  const isolated = isolatedHome();
  try {
    expect(findClaudeBin({ ...isolated.env })).toBe("claude");
  } finally {
    rmSync(isolated.dir, { recursive: true, force: true });
  }
});

test("findClaudeBin: respects CODECLI_BIN env", () => {
  expect(findClaudeBin({ CODECLI_BIN: "/custom/claude" })).toBe("/custom/claude");
});

test("findClaudeBin: respects CLAUDE_CODE_BIN env", () => {
  expect(findClaudeBin({ CLAUDE_CODE_BIN: "/other/claude" })).toBe("/other/claude");
});

test("buildSafeClaudeEnv: strips Codex relay secrets", () => {
  const env = buildSafeClaudeEnv({
    PATH: "/usr/bin",
    OPENAI_API_KEY: "sk-secret",
    RELAY_GATEWAY_TOKEN: "relay-secret",
    HOME: "/home/user",
    ANTHROPIC_BASE_URL: "https://global.invalid/v1",
    ANTHROPIC_API_KEY: "global-anthropic-key",
    ANTHROPIC_AUTH_TOKEN: "global-auth-token",
    CLAUDE_CODE_OAUTH_TOKEN: "global-oauth-token",
    CLAUDE_CODE_USE_BEDROCK: "1",
    ANTHROPIC_BEDROCK_BASE_URL: "https://bedrock.invalid",
  });
  expect(env.PATH).toBe("/usr/bin");
  expect(env.HOME).toBe("/home/user");
  expect(env.OPENAI_API_KEY).toBeUndefined();
  expect(env.RELAY_GATEWAY_TOKEN).toBeUndefined();
  expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
  expect(env.ANTHROPIC_BEDROCK_BASE_URL).toBeUndefined();
});

test("buildSafeClaudeEnv: applies safe overrides", () => {
  const env = buildSafeClaudeEnv({ PATH: "/usr/bin" }, { CLAUDE_CODE_VERSION: "2.1.222" });
  expect(env.CLAUDE_CODE_VERSION).toBe("2.1.222");
});

test("buildSafeClaudeEnv: sets IS_SANDBOX=1 on linux only, and caller overrides still win", () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(buildSafeClaudeEnv({ PATH: "/usr/bin" }).IS_SANDBOX).toBe("1");
    expect(buildSafeClaudeEnv({ PATH: "/usr/bin" }, { IS_SANDBOX: "0" }).IS_SANDBOX).toBe("0");

    Object.defineProperty(process, "platform", { value: "win32" });
    expect(buildSafeClaudeEnv({ PATH: "C:\\Windows" }).IS_SANDBOX).toBeUndefined();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
});

test("validateClaudeWorkspace: rejects empty path", () => {
  const result = validateClaudeWorkspace("");
  expect(result.valid).toBe(false);
  expect(result.error).toBeTruthy();
});

test("validateClaudeWorkspace: rejects non-existent path", () => {
  const result = validateClaudeWorkspace("Z:/nonexistent/path/that/does/not/exist");
  expect(result.valid).toBe(false);
});

test("validateClaudeWorkspace: accepts existing directory", () => {
  const result = validateClaudeWorkspace(process.cwd());
  expect(result.valid).toBe(true);
});

test("ensureClaudeSpawnCwd: creates a missing workspace instead of ENOENT", () => {
  const base = mkdtempSync(join(tmpdir(), "claude-cwd-"));
  const missing = join(base, "nested", "workspace");
  expect(ensureClaudeSpawnCwd(missing)).toBe(missing);
  expect(validateClaudeWorkspace(missing).valid).toBe(true);
  rmSync(base, { recursive: true, force: true });
});

test("ensureClaudeSpawnCwd: rejects a file path with the cwd named", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-cwd-file-"));
  const file = join(dir, "file.txt");
  writeFileSync(file, "x");
  expect(() => ensureClaudeSpawnCwd(file)).toThrow(file);
  rmSync(dir, { recursive: true, force: true });
});

test("prepareClaudeThreadCwd: passes an existing directory through", () => {
  expect(prepareClaudeThreadCwd(process.cwd())).toBe(process.cwd());
});

test("prepareClaudeThreadCwd: creates a phantom nested workspace at creation time", () => {
  const base = mkdtempSync(join(tmpdir(), "claude-prepare-"));
  const phantom = join(base, "nested", "workspace");
  try {
    expect(prepareClaudeThreadCwd(phantom)).toBe(phantom);
    expect(validateClaudeWorkspace(phantom).valid).toBe(true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("prepareClaudeThreadCwd: rejects a file-blocked path naming the cwd", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-prepare-file-"));
  const file = join(dir, "file.txt");
  writeFileSync(file, "x");
  try {
    expect(() => prepareClaudeThreadCwd(join(file, "sub"))).toThrow(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareClaudeThreadCwd: never touches the fs for ssh or empty input", () => {
  expect(prepareClaudeThreadCwd(undefined)).toBeUndefined();
  expect(prepareClaudeThreadCwd("   ")).toBe("   ");
  const phantom = join(tmpdir(), `definitely-missing-${Date.now()}`, "ws");
  expect(prepareClaudeThreadCwd(phantom, { ssh: true })).toBe(phantom);
  expect(validateClaudeWorkspace(phantom).valid).toBe(false);
});

test("mapPermissionMode: dangerBypass maps to bypassPermissions", () => {
  expect(mapPermissionMode("dangerFullAccess", "never")).toBe("bypassPermissions");
});

test("mapPermissionMode: readOnly maps to plan", () => {
  expect(mapPermissionMode("readOnly", "on-request")).toBe("plan");
});

test("mapPermissionMode: default workspaceAsk maps to default", () => {
  expect(mapPermissionMode("workspaceWrite", "on-request")).toBe("default");
});

test("buildClaudeSpawnArgs: includes required flags", () => {
  const args = buildClaudeSpawnArgs();
  expect(args).toContain("--print");
  expect(args).toContain("--verbose");
  expect(args).toContain("--input-format=stream-json");
  expect(args).toContain("--output-format=stream-json");
  expect(args).toContain("--include-partial-messages");
});

test("buildClaudeSpawnArgs: does NOT include --dangerously-skip-permissions by default", () => {
  const args = buildClaudeSpawnArgs("model-1", "default");
  expect(args).not.toContain("--dangerously-skip-permissions");
});

test("buildClaudeSpawnArgs: includes --dangerously-skip-permissions only for bypassPermissions", () => {
  const args = buildClaudeSpawnArgs("model-1", "bypassPermissions");
  expect(args).toContain("--dangerously-skip-permissions");
  const modeIdx = args.indexOf("--permission-mode");
  expect(args[modeIdx + 1]).toBe("bypassPermissions");
});

test("buildClaudeSpawnArgs: includes model when provided", () => {
  const args = buildClaudeSpawnArgs("claude-sonnet-4", "default");
  const modelIdx = args.indexOf("--model");
  expect(modelIdx).toBeGreaterThanOrEqual(0);
  expect(args[modelIdx + 1]).toBe("claude-sonnet-4");
});

test("buildClaudeSpawnArgs: preserves the Claude 1M model suffix", () => {
  const args = buildClaudeSpawnArgs("claude-opus-4-8[1m]", "default");
  const modelIdx = args.indexOf("--model");
  expect(args[modelIdx + 1]).toBe("claude-opus-4-8[1m]");
});

test("buildClaudeSpawnArgs: clamps Ultra orchestration to xhigh, never Opus-only max", () => {
  // `--effort max` is Opus-only upstream: most relay models reject it with a
  // 400 that burns the first turn in key-failover retries (turn/start 20s
  // timeout). xhigh is accepted by current CLIs and Responses upstreams.
  const args = buildClaudeSpawnArgs("claude-opus-4-8", "default", undefined, "ultra");
  const effortIdx = args.indexOf("--effort");
  expect(args[effortIdx + 1]).toBe("xhigh");
});

test("buildClaudeSpawnArgs: drops effort values the CLI cannot parse", () => {
  expect(buildClaudeSpawnArgs("model", "default", undefined, "ultra-turbo")).not.toContain("--effort");
  expect(buildClaudeSpawnArgs("model", "default", undefined, "none")).not.toContain("--effort");
});

test("buildClaudeSpawnArgs: omits model when not provided", () => {
  const args = buildClaudeSpawnArgs(undefined, "default");
  expect(args).not.toContain("--model");
});


test("buildClaudeSpawnArgs: resumes a persisted Claude session", () => {
  const args = buildClaudeSpawnArgs("claude-sonnet-5", "default", "resume-session-123");
  const resumeIdx = args.indexOf("--resume");
  expect(resumeIdx).toBeGreaterThanOrEqual(0);
  expect(args[resumeIdx + 1]).toBe("resume-session-123");
});


test("mapPermissionMode: covers Claude permission matrix", () => {
  expect(mapPermissionMode("workspaceWrite", "on-request")).toBe("default");
  expect(mapPermissionMode("readOnly", "on-request")).toBe("plan");
  expect(mapPermissionMode("dangerFullAccess", "on-request")).toBe("bypassPermissions");
  expect(mapPermissionMode("workspaceWrite", "never")).toBe("bypassPermissions");
  expect(mapPermissionMode("danger-full-access", "on-request")).toBe("bypassPermissions");
  expect(mapPermissionMode("read-only", "on-request")).toBe("plan");
});


test("buildClaudeSpawnArgs: uses plan permission mode without dangerous bypass", () => {
  const args = buildClaudeSpawnArgs("model-1", "plan");
  const modeIdx = args.indexOf("--permission-mode");
  expect(args[modeIdx + 1]).toBe("plan");
  expect(args).not.toContain("--dangerously-skip-permissions");
});


test("claudeProjectDirName: mirrors the CLI's workspace directory naming", () => {
  expect(claudeProjectDirName("E:\\projects\\codex-react-ui")).toBe("E--projects-codex-react-ui");
  expect(claudeProjectDirName("/home/user/app")).toBe("-home-user-app");
  // Long paths get a hash suffix we do not reproduce, so the answer is unknown.
  expect(claudeProjectDirName("/" + "a".repeat(400))).toBeNull();
});

test("claudeTranscriptExists: reports whether --resume can still find its transcript", () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-probe-"));
  const cwd = "/home/user/app";
  const projectDir = join(configDir, "projects", claudeProjectDirName(cwd)!);
  mkdirSync(projectDir, { recursive: true });

  // No projects directory at all: a reopened thread cannot resume.
  const emptyConfigDir = mkdtempSync(join(tmpdir(), "claude-probe-empty-"));
  expect(claudeTranscriptExists(emptyConfigDir, cwd, "sess-1")).toBe(false);

  expect(claudeTranscriptExists(configDir, cwd, "sess-1")).toBe(false);
  writeFileSync(join(projectDir, "sess-1.jsonl"), "{}\n");
  expect(claudeTranscriptExists(configDir, cwd, "sess-1")).toBe(true);

  // The CLI may have recorded the workspace under a differently cased path.
  expect(claudeTranscriptExists(configDir, "/home/user/App", "sess-1")).toBe(true);

  // Unmanaged config dirs and unnameable workspaces stay undecided so the
  // caller keeps the resume attempt instead of discarding a live session.
  expect(claudeTranscriptExists(undefined, cwd, "sess-1")).toBeUndefined();
  expect(claudeTranscriptExists(configDir, "/" + "a".repeat(400), "sess-1")).toBeUndefined();

  rmSync(configDir, { recursive: true, force: true });
  rmSync(emptyConfigDir, { recursive: true, force: true });
});


test("findClaudeBin: ignores stale embedded OpenClaude env and resolves official CLI", () => {
  const isolated = isolatedHome();
  try {
    // CODEX_UI_OPENCLAUDE_BIN no longer influences official Claude resolution.
    expect(findClaudeBin({ ...isolated.env, CODEX_UI_OPENCLAUDE_BIN: "/tmp/missing-cli.mjs" })).toBe("claude");
  } finally {
    rmSync(isolated.dir, { recursive: true, force: true });
  }
});

test("resolveClaudeLaunch: runs a JS bundle through a real runtime, never a host binary", () => {
  const launched = resolveClaudeLaunch("C:/claude/dist/cli.mjs", ["--version"]);
  // The host may itself be a runtime (`bun test`/`node`), but it must never be
  // a packaged shell: the packaged Bun/Electron host re-enters the workbench
  // instead of running the script.
  expect(launched.args).toEqual(["C:/claude/dist/cli.mjs", "--version"]);
  expect(isRuntimeBasename(launched.command)).toBe(true);
  expect(basename(launched.command).toLowerCase()).not.toBe("codex-standalone.exe");
  expect(isElectronBasename(launched.command)).toBe(false);
  expect(resolveClaudeLaunch("claude.exe", ["--version"])).toEqual({
    command: "claude.exe",
    args: ["--version"],
    env: {},
  });
  expect(resolveClaudeLaunch("claude.cmd", [])).toEqual({ command: "claude.cmd", args: [], env: {} });
});

test("resolveJavaScriptRuntime: honours an explicit runtime override", () => {
  const dir = mkdtempSync(join(tmpdir(), "js-runtime-override-"));
  const runtime = join(dir, process.platform === "win32" ? "node.exe" : "node");
  writeFileSync(runtime, "");
  try {
    const resolved = resolveJavaScriptRuntime({ CODEX_UI_NODE_BIN: runtime });
    expect(resolved.command).toBe(runtime);
    expect(resolved.env).toEqual({});
    expect(resolveClaudeLaunch("cli.mjs", [], { CODEX_UI_NODE_BIN: runtime })).toEqual({
      command: runtime,
      args: ["cli.mjs"],
      env: {},
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveJavaScriptRuntime: finds a runtime on PATH for a packaged Bun host", () => {
  const dir = mkdtempSync(join(tmpdir(), "js-runtime-path-"));
  const runtime = join(dir, process.platform === "win32" ? "node.exe" : "node");
  writeFileSync(runtime, "");
  try {
    // Simulate the reported production host: a packaged Bun standalone is not
    // a JavaScript runtime, so PATH must be searched for a real one.
    const resolved = resolveJavaScriptRuntime({ PATH: dir }, "/home/x/.cxu/server/v0.2.76/codex-standalone.exe");
    expect(resolved.command).toBe(runtime);
    expect(resolved.env).toEqual({});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveJavaScriptRuntime: reports ELECTRON_RUN_AS_NODE for an Electron host", () => {
  const resolved = resolveJavaScriptRuntime({ PATH: "" }, "C:/apps/Codex Ultra/Codex Ultra.exe");
  expect(resolved.command).toBe("C:/apps/Codex Ultra/Codex Ultra.exe");
  expect(resolved.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  const launched = resolveClaudeLaunch("cli.mjs", ["--version"], { PATH: "" });
  expect(launched.args).toEqual(["cli.mjs", "--version"]);
});

test("resolveClaudeLaunch: a JS bundle never resolves to the packaged standalone host", () => {
  // Guards the reported production failure: the cxu Bun standalone
  // (`~/.cxu/server/<version>/codex-standalone.exe`) was used to run a JS
  // CLI bundle, launching a second workbench that died with EADDRINUSE
  // and surfaced as a bare "exited with code 1".
  const launched = resolveClaudeLaunch("C:/claude/dist/cli.mjs", ["--print"]);
  expect(launched.command).not.toBe(process.execPath.includes("standalone")
    ? process.execPath
    : "codex-standalone.exe");
  expect(isRuntimeBasename(launched.command)).toBe(true);
});

test("probeClaudeCliCommand: probes an explicit mjs launcher", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-probe-"));
  const launcher = join(dir, "cli.mjs");
  writeFileSync(launcher, 'console.log("0.27.0");\n');
  try {
    expect(probeClaudeCliCommand(launcher, { ...process.env })).toEqual({
      available: true,
      version: "0.27.0",
      binPath: launcher,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claudeCliSupportsEffort: detects --effort from --help", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-effort-"));
  const withFlag = join(dir, "with-flag.mjs");
  const withoutFlag = join(dir, "without-flag.mjs");
  writeFileSync(withFlag, 'console.log("  --effort <level>  Thinking effort\\n");\n');
  writeFileSync(withoutFlag, 'console.log("  --model <model>  Model\\n");\n');
  try {
    expect(claudeCliSupportsEffort(withFlag)).toBe(true);
    expect(claudeCliSupportsEffort(withoutFlag)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveClaudeEffortForCli: omits effort the CLI cannot parse", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-effort-resolve-"));
  const legacy = join(dir, "legacy.mjs");
  const modern = join(dir, "modern.mjs");
  writeFileSync(legacy, 'console.log("  --model <model>  Model\\n");\n');
  writeFileSync(modern, 'console.log("  --effort <level>  Thinking effort\\n");\n');
  try {
    // Cold start never blocks on a sync --help probe: the flag is omitted and
    // an async warmer fills the cache for the next child generation.
    expect(resolveClaudeEffortForCli(legacy, "medium")).toBeUndefined();
    expect(resolveClaudeEffortForCli(modern, "medium")).toBeUndefined();
    // After a (sync, test-only) probe warms the cache, supported levels pass
    // through with UI aliases sanitized (ultra -> xhigh, never Opus-only max).
    expect(claudeCliSupportsEffort(legacy)).toBe(false);
    expect(claudeCliSupportsEffort(modern)).toBe(true);
    expect(resolveClaudeEffortForCli(legacy, "medium")).toBeUndefined();
    expect(resolveClaudeEffortForCli(modern, "medium")).toBe("medium");
    expect(resolveClaudeEffortForCli(modern, "ultra")).toBe("xhigh");
    expect(resolveClaudeEffortForCli(modern, "bogus")).toBeUndefined();
    expect(resolveClaudeEffortForCli(modern, "none")).toBeUndefined();
    expect(resolveClaudeEffortForCli(modern, undefined)).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildClaudeRelayCustomHeaders: carries thread, opencode session and backend hint", async () => {
  const { buildClaudeRelayCustomHeaders } = await import("../../backends/claude/src/runtime/claudeCompatibleProbe");
  const { deriveOpenCodeSessionId, OPENCODE_CLI_BACKEND_HEADER } = await import("../../backends/relay-config/src/relay/omniRouteFree");
  expect(buildClaudeRelayCustomHeaders(undefined)).toBeUndefined();
  expect(buildClaudeRelayCustomHeaders("  ")).toBeUndefined();
  const headers = buildClaudeRelayCustomHeaders("thread-123")!;
  expect(headers).toContain("thread-id: thread-123");
  expect(headers).toContain(`x-opencode-session: ${deriveOpenCodeSessionId("thread-123")}`);
  expect(headers).toContain(`${OPENCODE_CLI_BACKEND_HEADER}: claude`);
});
