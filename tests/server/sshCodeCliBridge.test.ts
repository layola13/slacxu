import { describe, expect, test } from "bun:test";
import {
  CLAUDE_POSIX_INSTALL_COMMAND,
  SshCodeCliLauncher,
  buildRemoteClaudeCommand,
  ensureRemoteClaudeCli,
  forgetRemoteClaudeTarget,
  forwardedRemoteEnv,
  isRemoteWorkspacePath,
  probeRemoteClaudeCli,
  remoteClaudeInstallScript,
  remoteClaudeProbeScript,
  resolveRemoteClaudeTargetCached,
  rewriteGatewayBaseUrl,
  type RunRemoteCommand
} from "../../apps/server/src/sshCodeCliBridge";

const PROBE_OUTPUT = "CLAUDE_BIN=/home/vscode/.local/bin/claude\nCLAUDE_VERSION=2.1.222 (Claude Code)\n";

function fakeChild(): any {
  return { stdin: { writes: [] as string[], write(value: string) { this.writes.push(value); return true; }, end() {} }, once() {}, pid: 4242 };
}

describe("remote Claude CLI provisioning", () => {
  test("probe reports the resolved binary and version", async () => {
    const runRemote: RunRemoteCommand = async () => ({ stdout: PROBE_OUTPUT, stderr: "" });
    expect(await probeRemoteClaudeCli(["vscode@45.129.8.163"], "posix", runRemote)).toEqual({
      binPath: "/home/vscode/.local/bin/claude",
      version: "2.1.222",
      installed: false
    });
  });

  test("probe treats exit code 3 as not installed", async () => {
    const runRemote: RunRemoteCommand = async () => { throw Object.assign(new Error("Command failed"), { code: 3, stdout: "", stderr: "" }); };
    expect(await probeRemoteClaudeCli(["vscode@host"], "posix", runRemote)).toBeNull();
  });

  test("probe surfaces transport failures instead of installing blindly", async () => {
    const runRemote: RunRemoteCommand = async () => { throw Object.assign(new Error("ssh: connect to host port 22: Connection refused"), { code: 255, stderr: "ssh: connect to host port 22: Connection refused" }); };
    expect(probeRemoteClaudeCli(["vscode@host"], "posix", runRemote)).rejects.toThrow(/Connection refused/);
  });

  test("installs the official CLI with the documented command when it is missing", async () => {
    const commands: string[] = [];
    let installed = false;
    const runRemote: RunRemoteCommand = async (_args, remoteCommand) => {
      commands.push(remoteCommand);
      if (remoteCommand.includes("install.sh")) { installed = true; return { stdout: "installed", stderr: "" }; }
      if (!installed) throw Object.assign(new Error("Command failed"), { code: 3 });
      return { stdout: PROBE_OUTPUT, stderr: "" };
    };
    const progress: string[] = [];
    const result = await ensureRemoteClaudeCli(["vscode@host"], "posix", { runRemote, onProgress: (message) => progress.push(message) });
    expect(result.installed).toBe(true);
    expect(result.binPath).toBe("/home/vscode/.local/bin/claude");
    expect(commands.some((command) => command.includes(CLAUDE_POSIX_INSTALL_COMMAND))).toBe(true);
    expect(progress[0]).toContain("installing");
  });

  test("fails clearly when the installation does not produce a binary", async () => {
    const runRemote: RunRemoteCommand = async (_args, remoteCommand) => {
      if (remoteCommand.includes("install.sh")) return { stdout: "", stderr: "curl: (6) Could not resolve host" };
      throw Object.assign(new Error("Command failed"), { code: 3 });
    };
    expect(ensureRemoteClaudeCli(["vscode@host"], "posix", { runRemote })).rejects.toThrow(/did not produce a usable binary/);
  });

  test("respects an explicit opt-out of installation", async () => {
    const runRemote: RunRemoteCommand = async () => { throw Object.assign(new Error("Command failed"), { code: 3 }); };
    expect(ensureRemoteClaudeCli(["vscode@host"], "posix", { runRemote, installIfMissing: false })).rejects.toThrow(/not installed/);
  });

  test("probe and install scripts cover both remote operating systems", () => {
    expect(remoteClaudeProbeScript("posix")).toContain("$HOME/.local/bin/claude");
    // A CLI installed under a version manager is only on PATH in a login shell.
    expect(remoteClaudeProbeScript("posix")).toContain("bash -lc 'command -v claude'");
    expect(remoteClaudeInstallScript("posix")).toContain(CLAUDE_POSIX_INSTALL_COMMAND);
    expect(remoteClaudeProbeScript("windows")).toStartWith("powershell -NoProfile");
    expect(remoteClaudeInstallScript("windows")).toStartWith("powershell -NoProfile");
  });
});

describe("remote Claude command construction", () => {
  test("POSIX command enters the workspace, exports safe values, and reads the credential from stdin", () => {
    const command = buildRemoteClaudeCommand({
      remoteOs: "posix",
      cwd: "/home/vscode/projects",
      binPath: "/home/vscode/.local/bin/claude",
      args: ["--print", "--model", "claude-sonnet-5"],
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:46120/api/relay-gateway/deepkey/codex-team", CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1" },
      readSecretFromStdin: true
    });
    expect(command).toBe([
      "cd -- '/home/vscode/projects'",
      "export ANTHROPIC_BASE_URL='http://127.0.0.1:46120/api/relay-gateway/deepkey/codex-team'",
      "export CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST='1'",
      "IFS= read -r ANTHROPIC_API_KEY",
      "export ANTHROPIC_API_KEY",
      "exec '/home/vscode/.local/bin/claude' '--print' '--model' 'claude-sonnet-5'"
    ].join(" && "));
  });

  test("POSIX command never puts the credential in the remote argument vector", () => {
    const command = buildRemoteClaudeCommand({
      remoteOs: "posix",
      cwd: "/work",
      binPath: "claude",
      args: ["--print"],
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:1/x" },
      readSecretFromStdin: true
    });
    expect(command).not.toContain("relay-secret");
    expect(command).toContain("IFS= read -r ANTHROPIC_API_KEY");
  });

  test("quotes hostile workspace paths and arguments", () => {
    const command = buildRemoteClaudeCommand({
      remoteOs: "posix",
      cwd: "/tmp/x'; rm -rf /; echo '",
      binPath: "/bin/claude",
      args: ["--model", "a'; touch /tmp/pwned; '"],
      env: {},
      readSecretFromStdin: false
    });
    expect(command).toContain("cd -- '/tmp/x'\\''; rm -rf /; echo '\\'''");
    expect(command).not.toMatch(/&& rm -rf/);
    expect(command).toContain("'a'\\''; touch /tmp/pwned; '\\'''");
  });

  test("rejects environment names that are not valid shell identifiers", () => {
    const command = buildRemoteClaudeCommand({
      remoteOs: "posix",
      cwd: "/work",
      binPath: "claude",
      args: [],
      env: { "BAD;NAME": "x", GOOD_NAME: "y" },
      readSecretFromStdin: false
    });
    expect(command).not.toContain("BAD;NAME");
    expect(command).toContain("export GOOD_NAME='y'");
  });

  test("expands the home shortcut for a remote workspace", () => {
    const command = buildRemoteClaudeCommand({ remoteOs: "posix", cwd: "~/projects", binPath: "claude", args: [], env: {}, readSecretFromStdin: false });
    expect(command).toStartWith("cd -- \"$HOME\"'/projects'");
  });

  test("Windows command is a base64 encoded PowerShell payload", () => {
    const command = buildRemoteClaudeCommand({
      remoteOs: "windows",
      cwd: "C:/work",
      binPath: "claude.exe",
      args: ["--print"],
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:46120/api" },
      readSecretFromStdin: true
    });
    expect(command).toStartWith("powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ");
    const script = Buffer.from(command.split(" ").pop() ?? "", "base64").toString("utf16le");
    expect(script).toContain("Set-Location -LiteralPath 'C:/work'");
    expect(script).toContain("$env:ANTHROPIC_API_KEY = [Console]::In.ReadLine()");
    expect(script).toContain("& $claude.Source '--print'");
  });
});

describe("relay gateway tunneling", () => {
  test("rewrites the gateway host and port onto the reverse tunnel", () => {
    expect(rewriteGatewayBaseUrl("http://127.0.0.1:43110/api/relay-gateway/deepkey/codex-team", 46120))
      .toBe("http://127.0.0.1:46120/api/relay-gateway/deepkey/codex-team");
  });

  test("forwards only the environment values that make sense remotely", () => {
    const forwarded = forwardedRemoteEnv({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:43110/api/relay-gateway/p/g",
      ANTHROPIC_API_KEY: "relay-secret",
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
      CLAUDE_CONFIG_DIR: "C:\\Users\\zhan\\.codex-ultra",
      PATH: "C:\\Windows"
    }, 46999);
    expect(forwarded).toEqual({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:46999/api/relay-gateway/p/g",
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1"
    });
  });
});

describe("SSH Claude launcher", () => {
  function createLauncher(overrides: { allocateRemotePort?: () => number } = {}) {
    const spawned: Array<{ command: string; args: string[]; child: any }> = [];
    const launcher = new SshCodeCliLauncher(
      { command: "ssh vscode@45.129.8.163", cwd: "/home/vscode/projects" },
      ["vscode@45.129.8.163"],
      "posix",
      { binPath: "/home/vscode/.local/bin/claude", version: "2.1.222", installed: false },
      {
        localServerPort: 43120,
        allocateRemotePort: overrides.allocateRemotePort ?? (() => 46120),
        spawnProcess: (command, args) => { const child = fakeChild(); spawned.push({ command, args, child }); return child; }
      }
    );
    return { launcher, spawned };
  }

  test("opens one reverse tunnel per session and hands the credential over stdin", () => {
    const { launcher, spawned } = createLauncher();
    launcher.spawn("claude", ["--print"], {
      cwd: "/home/vscode/projects",
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:43120/api/relay-gateway/deepkey/codex-team", ANTHROPIC_API_KEY: "relay-secret" }
    });
    const call = spawned[0]!;
    expect(call.command).toBe("ssh");
    expect(call.args).toContain("-R");
    expect(call.args).toContain("127.0.0.1:46120:127.0.0.1:43120");
    expect(call.args).toContain("vscode@45.129.8.163");
    expect(call.args.at(-1)).toContain("export ANTHROPIC_BASE_URL='http://127.0.0.1:46120/api/relay-gateway/deepkey/codex-team'");
    expect(call.args.join(" ")).not.toContain("relay-secret");
    expect(call.child.stdin.writes).toEqual(["relay-secret\n"]);
    expect(launcher.activeSessionCount()).toBe(1);
  });

  test("gives concurrent sessions distinct tunnel ports so compaction can run alongside a turn", () => {
    let port = 46120;
    const { launcher, spawned } = createLauncher({ allocateRemotePort: () => port++ });
    const env = { ANTHROPIC_BASE_URL: "http://127.0.0.1:43120/api/relay-gateway/p/g", ANTHROPIC_API_KEY: "k" };
    launcher.spawn("claude", ["--print"], { cwd: "/home/vscode/projects", env });
    launcher.spawn("claude", ["--print", "--bare"], { cwd: "/home/vscode/projects", env });
    expect(spawned[0]!.args).toContain("127.0.0.1:46120:127.0.0.1:43120");
    expect(spawned[1]!.args).toContain("127.0.0.1:46121:127.0.0.1:43120");
    expect(spawned[1]!.args.at(-1)).toContain("http://127.0.0.1:46121/api/relay-gateway/p/g");
  });

  test("falls back to the workspace path when the caller passes a local directory", () => {
    const { launcher, spawned } = createLauncher();
    launcher.spawn("claude", ["--print"], { cwd: process.cwd(), env: { ANTHROPIC_API_KEY: "k" } });
    expect(spawned[0]!.args.at(-1)).toStartWith("cd -- '/home/vscode/projects'");
  });

  test("keeps a host path off the SSH host so the remote shell never fails cd", () => {
    // A thread first opened locally keeps the Windows cwd in runtime metadata.
    // Forwarding it made the remote shell exit before exec'ing the CLI, which
    // produced no protocol output at all and hung the turn.
    const { launcher, spawned } = createLauncher();
    launcher.spawn("claude", ["--print"], { cwd: "E:\\projects\\sa_plugin_sla", env: { ANTHROPIC_API_KEY: "k" } });
    expect(spawned[0]!.args.at(-1)).toStartWith("cd -- '/home/vscode/projects'");
    expect(spawned[0]!.args.at(-1)).not.toContain("sa_plugin_sla");
  });

  test("still forwards a genuine remote path", () => {
    const { launcher, spawned } = createLauncher();
    launcher.spawn("claude", ["--print"], { cwd: "/srv/www", env: { ANTHROPIC_API_KEY: "k" } });
    expect(spawned[0]!.args.at(-1)).toStartWith("cd -- '/srv/www'");
  });

  test("refuses to start new sessions after disposal", () => {
    const { launcher } = createLauncher();
    launcher.dispose();
    expect(() => launcher.spawn("claude", [], { env: {} })).toThrow(/disposed/);
  });
});

describe("remote workspace paths", () => {
  test("accepts paths the SSH host can resolve", () => {
    expect(isRemoteWorkspacePath("posix", "/home/vscode/projects")).toBe(true);
    expect(isRemoteWorkspacePath("posix", "~/projects")).toBe(true);
    expect(isRemoteWorkspacePath("posix", "~")).toBe(true);
    expect(isRemoteWorkspacePath("windows", "C:\\Users\\vscode")).toBe(true);
    expect(isRemoteWorkspacePath("windows", "~/projects")).toBe(true);
  });

  test("rejects a path that belongs to the other operating system", () => {
    expect(isRemoteWorkspacePath("posix", "E:\\projects\\sa_plugin_sla")).toBe(false);
    expect(isRemoteWorkspacePath("posix", "C:/Users/zhan")).toBe(false);
    expect(isRemoteWorkspacePath("posix", "relative\\windows\\path")).toBe(false);
    expect(isRemoteWorkspacePath("windows", "/home/vscode")).toBe(false);
  });
});

describe("remote target resolution cache", () => {
  const PROBE_OK: RunRemoteCommand = async () => ({ stdout: PROBE_OUTPUT, stderr: "" });
  const detectOs = async () => "posix" as const;

  test("probes a host once and shares the result across bridges", async () => {
    forgetRemoteClaudeTarget();
    let calls = 0;
    const runRemote: RunRemoteCommand = async (args, command, timeoutMs) => { calls += 1; return PROBE_OK(args, command, timeoutMs); };
    const first = await resolveRemoteClaudeTargetCached("ssh vscode@cached-host", { runRemote, detectOs });
    const second = await resolveRemoteClaudeTargetCached("ssh vscode@cached-host", { runRemote, detectOs });
    expect(second).toBe(first);
    expect(first.cli.binPath).toBe("/home/vscode/.local/bin/claude");
    // One CLI probe; the OS detection ahead of it does not go through runRemote.
    expect(calls).toBe(1);
    forgetRemoteClaudeTarget();
  });

  test("collapses concurrent resolutions into one probe", async () => {
    forgetRemoteClaudeTarget();
    let calls = 0;
    const runRemote: RunRemoteCommand = async (args, command, timeoutMs) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return PROBE_OK(args, command, timeoutMs);
    };
    const resolved = await Promise.all([
      resolveRemoteClaudeTargetCached("ssh vscode@concurrent-host", { runRemote, detectOs }),
      resolveRemoteClaudeTargetCached("ssh vscode@concurrent-host", { runRemote, detectOs }),
      resolveRemoteClaudeTargetCached("ssh vscode@concurrent-host", { runRemote, detectOs })
    ]);
    expect(resolved[1]).toBe(resolved[0]!);
    expect(resolved[2]).toBe(resolved[0]!);
    expect(calls).toBe(1);
    forgetRemoteClaudeTarget();
  });

  test("does not remember a host that failed, so a recovered host is retried", async () => {
    forgetRemoteClaudeTarget();
    let attempt = 0;
    const runRemote: RunRemoteCommand = async (args, command, timeoutMs) => {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("ssh: connect to host port 22: Connection refused"), { code: 255, stderr: "Connection refused" });
      return PROBE_OK(args, command, timeoutMs);
    };
    await expect(resolveRemoteClaudeTargetCached("ssh vscode@flaky-host", { runRemote, detectOs })).rejects.toThrow(/Connection refused/);
    const recovered = await resolveRemoteClaudeTargetCached("ssh vscode@flaky-host", { runRemote, detectOs });
    expect(recovered.cli.version).toBe("2.1.222");
    forgetRemoteClaudeTarget();
  });

  test("rejects a command that is not an SSH invocation before touching the network", async () => {
    forgetRemoteClaudeTarget();
    await expect(resolveRemoteClaudeTargetCached("scp vscode@host")).rejects.toThrow(/ssh user@host/);
    forgetRemoteClaudeTarget();
  });
});
