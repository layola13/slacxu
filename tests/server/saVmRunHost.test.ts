import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { join, resolve } from "node:path";
import { writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";
import {
  runSaVmTool,
  resetRunHostCacheForTest,
  runHostProcessSpawnCount,
  runHostCacheHitCount,
  detectBatchDependencyViolation
} from "../../apps/server/src/saVmTool.js";
import { interceptSaVmRequest } from "../../backends/vmtool-security/src/security/saVmInterception.js";

const workspace = resolve(process.cwd());
const defaultPolicy = createDefaultSaVmPolicyConfig();

// The parallel batch path is behind the SA_VM_ENABLE_PARALLEL shield;
// enable it for the duration of a parallel test and always restore.
async function withParallelEnabled(fn: () => Promise<void>): Promise<void> {
  const prevParallel = process.env.SA_VM_ENABLE_PARALLEL;
  process.env.SA_VM_ENABLE_PARALLEL = "true";
  try {
    await fn();
  } finally {
    if (prevParallel === undefined) delete process.env.SA_VM_ENABLE_PARALLEL;
    else process.env.SA_VM_ENABLE_PARALLEL = prevParallel;
  }
}

const testDir = join(workspace, ".test_run_host_scratch");

beforeEach(() => {
  resetRunHostCacheForTest();
});

afterAll(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe("SA-VM Interception - Ran Command Denials for run_host", () => {
  test("intercepts cmd /c wrapper and recommends run_host", () => {
    const res = interceptSaVmRequest("thread/shellCommand", {
      command: "cmd /c sa --help"
    }, { cwd: workspace, policy: defaultPolicy });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain("cmd /c");
      expect(res.reason).toContain("run_host");
    }
  });

  test("intercepts sla.exe --help 2>$null | Select -First 30 and recommends run_host", () => {
    const res = interceptSaVmRequest("thread/shellCommand", {
      command: 'sla.exe --help 2>$null | Select-Object -First 30'
    }, { cwd: workspace, policy: defaultPolicy });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain("run_host");
    }
  });

  test("intercepts zig build test 2>&1 | Select -Last 50 and recommends run_host", () => {
    const res = interceptSaVmRequest("thread/shellCommand", {
      command: 'zig build test 2>&1 | Select-Object -Last 50'
    }, { cwd: workspace, policy: defaultPolicy });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain("run_host");
    }
  });

  test("intercepts cd dir && sa compile file.sa > out.log and recommends run_host", () => {
    const res = interceptSaVmRequest("thread/shellCommand", {
      command: 'cd dir && sa compile file.sa > out.log'
    }, { cwd: workspace, policy: defaultPolicy });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain("run_host");
    }
  });

  test("intercepts sla.exe --help >nul 2>&1 shell error suppression", () => {
    const res = interceptSaVmRequest("thread/shellCommand", {
      command: 'sla.exe --help >nul 2>&1'
    }, { cwd: workspace, policy: defaultPolicy });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain("Shell error suppression");
      expect(res.reason).toContain("run_host");
    }
  });

  test("intercepts & sa.exe compile test.sla 2>&1 | Out-Host and recommends run_host", () => {
    const res = interceptSaVmRequest("thread/shellCommand", {
      command: '& sa.exe compile test.sla 2>&1 | Out-Host'
    }, { cwd: workspace, policy: defaultPolicy });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain("run_host");
    }
  });

  test("intercepts command chaining with && and recommends run_host", () => {
    const res = interceptSaVmRequest("thread/shellCommand", {
      command: 'zig version && sla --help'
    }, { cwd: workspace, policy: defaultPolicy });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain("Command chaining via '&&'");
      expect(res.reason).toContain("run_host");
    }
  });

  test("intercepts file redirection with > and recommends run_host", () => {
    const res = interceptSaVmRequest("thread/shellCommand", {
      command: 'zig build > build_output.txt'
    }, { cwd: workspace, policy: defaultPolicy });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain("Shell redirection");
      expect(res.reason).toContain("run_host");
    }
  });
});

describe("SA-VM run_host - Allowlist Execution", () => {
  test("executes allowlisted binary 'zig version'", async () => {
    const res = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: ["version"]
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("0.14");
    expect(res.saVmEvents.length).toBeGreaterThanOrEqual(1);
    expect(res.saVmEvents[0]!.event).toBe("host_execution");
    expect(res.saVmEvents[0]!.cached).toBe(false);
  });

  test("executes allowlisted binary 'bun --version'", async () => {
    const res = await runSaVmTool({
      action: "run_host",
      exe: "bun",
      args: ["--version"]
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.length).toBeGreaterThan(0);
  });

  test("executes allowlisted binary 'node --version'", async () => {
    const res = await runSaVmTool({
      action: "run_host",
      exe: "node",
      args: ["--version"]
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.length).toBeGreaterThan(0);
  });

  test("executes workspace-internal script/binary", async () => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    const scriptPath = join(testDir, "test_hello.cmd");
    writeFileSync(scriptPath, "@echo hello from workspace binary\r\n", "utf8");

    const res = await runSaVmTool({
      action: "run_host",
      exe: scriptPath,
      args: []
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("hello from workspace binary");
  });
});

describe("SA-VM run_host - Security & Policy Rejections", () => {
  test("rejects unauthorized system executables (powershell, curl, cmd, notepad)", async () => {
    for (const badExe of ["powershell", "curl", "cmd", "notepad", "bash"]) {
      const res = await runSaVmTool({
        action: "run_host",
        exe: badExe,
        args: ["--version"]
      }, { cwd: workspace, policy: defaultPolicy });

      expect(res.ok).toBe(false);
      expect(res.kind).toBe("capability_denied");
      expect(res.exitCode).toBe(228);
      expect(res.stderr).toContain("is not permitted");
      expect(res.saVmViolation?.rule).toBe("process.run_host.unauthorized_executable");
    }
  });

  test("rejects CWD escaping the workspace", async () => {
    const outsideCwd = resolve(workspace, "..", "outside_root");
    const res = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: ["version"],
      cwd: outsideCwd
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("outside permitted workspace roots");
    expect(res.saVmViolation?.rule).toBe("fs.cwd_outside_workspace");
  });

  test("rejects arguments exceeding length limits", async () => {
    // Single arg > 4096
    const hugeArg = "a".repeat(4097);
    const res1 = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: [hugeArg]
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res1.ok).toBe(false);
    expect(res1.kind).toBe("capability_denied");
    expect(res1.exitCode).toBe(228);
    expect(res1.stderr).toContain("exceeds maximum allowed length of 4096");
    expect(res1.saVmViolation?.rule).toBe("process.run_host.max_arg_length");

    // Total args > 32768
    const manyArgs = Array.from({ length: 33 }, () => "x".repeat(1000));
    const res2 = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: manyArgs
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res2.ok).toBe(false);
    expect(res2.kind).toBe("capability_denied");
    expect(res2.exitCode).toBe(228);
    expect(res2.stderr).toContain("exceeds maximum allowed limit of 32768");
    expect(res2.saVmViolation?.rule).toBe("process.run_host.max_total_args_length");
  });

  test("rejects forbidden subcommands (publish only; install/add are allowed)", async () => {
    const { FORBIDDEN_HOST_SUBCOMMANDS } = await import("../../apps/server/src/saVmTool.js");
    expect(FORBIDDEN_HOST_SUBCOMMANDS.has("publish")).toBe(true);
    expect(FORBIDDEN_HOST_SUBCOMMANDS.has("install")).toBe(false);
    expect(FORBIDDEN_HOST_SUBCOMMANDS.has("add")).toBe(false);

    const res = await runSaVmTool({
      action: "run_host",
      exe: "bun",
      args: ["publish", "target"]
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.exitCode).toBe(228);
    expect(res.stderr.toLowerCase()).toContain("forbidden");
    expect(res.saVmViolation?.rule).toBe("process.run_host.denied_subcommand");
  });

  test("rejects environment variables not in allowlist", async () => {
    const res = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: ["version"],
      env: { FORBIDDEN_SECRET: "secret" }
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("FORBIDDEN_SECRET");
    expect(res.saVmViolation?.rule).toBe("process.run_host.env_not_allowed");
  });

  test("accepts allowlisted environment variables", async () => {
    const res = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: ["version"],
      env: { NO_COLOR: "1", CI: "1" }
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
  });
});

describe("SA-VM run_host - Output Slicing and Filtering", () => {
  test("slices output with head_lines", async () => {
    const res = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: ["--help"],
      head_lines: 3
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(true);
    const lines = res.stdout.trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  test("slices output with tail_lines", async () => {
    const res = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: ["--help"],
      tail_lines: 4
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(true);
    const lines = res.stdout.trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  test("filters output with regex/substring filter", async () => {
    const res = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: ["--help"],
      filter: "help|usage"
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(true);
    if (res.stdout.trim().length > 0) {
      for (const line of res.stdout.trim().split("\n")) {
        expect(line.toLowerCase()).toMatch(/help|usage/);
      }
    }
  });

  test("truncates output when max_tokens exceeded", async () => {
    const res = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: ["--help"],
      max_tokens: 10
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("truncated");
  });
});

describe("SA-VM run_host - Help Cache & Process Lifecycle", () => {
  test("caches --help / version queries in memory with 0ms response and 0 new processes", async () => {
    expect(runHostProcessSpawnCount).toBe(0);
    expect(runHostCacheHitCount).toBe(0);

    // Call 1: cold spawn
    const res1 = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: ["version"]
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res1.ok).toBe(true);
    expect(res1.saVmEvents[0]!.cached).toBe(false);
    expect(runHostProcessSpawnCount).toBe(1);
    expect(runHostCacheHitCount).toBe(0);

    // Call 2: warm cache hit
    const res2 = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: ["version"]
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res2.ok).toBe(true);
    expect(res2.durationMs).toBe(0);
    expect(res2.saVmEvents[0]!.cached).toBe(true);
    expect(runHostProcessSpawnCount).toBe(1);
    expect(runHostCacheHitCount).toBe(1);
    expect(res2.stdout).toBe(res1.stdout);

    // Call 3: warm cache hit with different slicing parameter
    const res3 = await runSaVmTool({
      action: "run_host",
      exe: "zig",
      args: ["version"],
      head_lines: 1
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res3.ok).toBe(true);
    expect(res3.durationMs).toBe(0);
    expect(res3.saVmEvents[0]!.cached).toBe(true);
    expect(runHostProcessSpawnCount).toBe(1);
    expect(runHostCacheHitCount).toBe(2);
  });

  test("terminates process on timeout and returns exitCode 124", async () => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    const hangScript = join(testDir, "hang.cmd");
    writeFileSync(hangScript, "@echo off\r\nping 127.0.0.1 -n 10 > nul\r\n", "utf8");

    const res = await runSaVmTool({
      action: "run_host",
      exe: hangScript,
      args: [],
      timeout_ms: 300
    }, { cwd: workspace, policy: defaultPolicy });

    expect(res.ok).toBe(false);
    expect(res.kind).toBe("timeout");
    expect(res.exitCode).toBe(124);
    expect(res.stderr).toContain("timed out after 300ms");
  });
});

describe("SA-VM parallel - Hybrid Concurrency & Output Isolation", () => {
  test("executes 3-way hybrid parallel batch in exact order", async () => {
    await withParallelEnabled(async () => {
      const res = await runSaVmTool({
        concurrency: 3,
        parallel: [
          { action: "run_host", exe: "zig", args: ["version"] },
          { action: "read_lines", path: "package.json", start_line: 1, end_line: 5 },
          { action: "list_dir", dir: "scripts" }
        ]
      }, { cwd: workspace, policy: defaultPolicy });

      expect(res.ok).toBe(true);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("[parallel:0]");
      expect(res.stdout).toContain("[parallel:1]");
      expect(res.stdout).toContain("[parallel:2]");
      expect(res.stdout).toContain("0.14");
      expect(res.stdout).toContain('"name":');

      // saVmEvents contain parallelIndex
      const indices = res.saVmEvents.map((e) => (e as any).parallelIndex);
      expect(indices).toContain(0);
    });
  });

  test("preserves successful task outputs when one parallel task fails", async () => {
    await withParallelEnabled(async () => {
      const res = await runSaVmTool({
        concurrency: 2,
        parallel: [
          { action: "run_host", exe: "zig", args: ["version"] },
          { action: "run_host", exe: "powershell", args: ["-Command", "echo 1"] }
        ]
      }, { cwd: workspace, policy: defaultPolicy });

      expect(res.ok).toBe(false);
      expect(res.exitCode).toBe(228);
      // Task 0 output is retained
      expect(res.stdout).toContain("[parallel:0]");
      expect(res.stdout).toContain("0.14");
      // Task 1 error is in stderr
      expect(res.stderr).toContain("[parallel:1]");
      expect(res.stderr).toContain("exe 'powershell' is not permitted");
    });
  });
});

describe("SA-VM parallel - Intra-batch Dependency Checking", () => {
  test("detects dependency conflict for run_host build output and read_lines", () => {
    const conflict = detectBatchDependencyViolation([
      { action: "run_host", exe: "sa", args: ["compile", "test.sa", "-o", "bin/test.out"] },
      { action: "read_lines", path: "bin/test.out", start_line: 1, end_line: 20 }
    ], workspace);

    expect(conflict).not.toBeNull();
    expect(conflict?.conflictedPath).toContain("test.out");
    expect(conflict?.writeTaskIndex).toBe(0);
    expect(conflict?.readTaskIndex).toBe(1);
  });

  test("detects dependency conflict for edit_file / write_file and read_file", () => {
    const conflict = detectBatchDependencyViolation([
      { action: "write_file", path: "src/generated.ts", content: "export const x = 1;" },
      { action: "read_file", path: "src/generated.ts" }
    ], workspace);

    expect(conflict).not.toBeNull();
    expect(conflict?.conflictedPath).toBe("src/generated.ts");
  });

  test("blocks parallel batch when dependency violation detected with advice to split", async () => {
    await withParallelEnabled(async () => {
      const res = await runSaVmTool({
        parallel: [
          { action: "run_host", exe: "sa", args: ["compile", "test.sa", "-o", "bin/app.exe"] },
          { action: "read_lines", path: "bin/app.exe" }
        ]
      }, { cwd: workspace, policy: defaultPolicy });

      expect(res.ok).toBe(false);
      expect(res.kind).toBe("capability_denied");
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Dependency violation: intra-batch read of write/build output for 'bin/app.exe' is forbidden. Split into two sequential batches.");
      expect(res.saVmViolation?.rule).toBe("parallel.dependency_violation");
    });
  });

  test("allows independent parallel tasks without dependency conflict", () => {
    const conflict = detectBatchDependencyViolation([
      { action: "run_host", exe: "sla", args: ["--help"] },
      { action: "read_lines", path: "package.json", start_line: 1, end_line: 5 },
      { action: "list_dir", dir: "scripts" }
    ], workspace);

    expect(conflict).toBeNull();
  });
});
