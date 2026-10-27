import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runSaVmTool } from "../../apps/server/src/saVmTool";

const runtimeRoot = join(import.meta.dir, "../../desktop-resources/sa-vm");
const executable = join(runtimeRoot, "sa.exe");
const vmPlugin = join(runtimeRoot, "vm.dll");
const slaPlugin = join(runtimeRoot, "sa_plugins", "installed", "sla", "current", "sla.dll");
const stdDir = join(runtimeRoot, "sa_std");
const hasSidecar = existsSync(executable) && existsSync(vmPlugin) && existsSync(slaPlugin) && existsSync(stdDir)
  && process.env.CODEX_UI_SA_VM_LIVE_TESTS === "1";

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test.skipIf(!hasSidecar)("M3 Test Plan 4: live sidecar smoke executes hand-written SLA multi-step logic and captures telemetry", async () => {
  const previousExecutable = process.env.CODEX_UI_SA_VM_BIN;
  const previousPlugin = process.env.CODEX_UI_SA_VM_PLUGINS_PATH;
  const previousStdDir = process.env.CODEX_UI_SA_VM_STD_DIR;

  try {
    process.env.CODEX_UI_SA_VM_BIN = executable;
    process.env.CODEX_UI_SA_VM_PLUGINS_PATH = vmPlugin;
    process.env.CODEX_UI_SA_VM_STD_DIR = stdDir;

    const source = `@import "sa_std/io/print.sai"
@import "sa_std/fmt.sai"

fn sum_to_n(limit: i32) -> i32 {
    let i: i32 = 0;
    let sum: i32 = 0;
    while i < limit {
        sum = sum + i;
        i = i + 1;
    }
    return sum;
}

fn main() -> i32 {
    let result = sum_to_n(10);
    println("sum: {}", result);
    return 0;
}
`;

    const result = await runSaVmTool({
      language: "sla",
      source
    });

    expect(result.ok).toBe(true);
    expect(result.kind).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("sum: 45");
    expect(result.saVmEvents.length).toBeGreaterThan(0);

    const startEvent = result.saVmEvents.find((e) => (e as any).event === "start");
    expect(startEvent).toBeTruthy();
    expect((startEvent as any).fuel).toBeGreaterThan(0);
    expect((startEvent as any).wall_clock_ms).toBeGreaterThan(0);
  } finally {
    restoreEnv("CODEX_UI_SA_VM_BIN", previousExecutable);
    restoreEnv("CODEX_UI_SA_VM_PLUGINS_PATH", previousPlugin);
    restoreEnv("CODEX_UI_SA_VM_STD_DIR", previousStdDir);
  }
}, { timeout: 20000 });

test.skipIf(!hasSidecar)("M3 Test Plan 5: negative test - hand-written SLA requesting process extern is denied at capability boundary", async () => {
  const previousExecutable = process.env.CODEX_UI_SA_VM_BIN;
  const previousPlugin = process.env.CODEX_UI_SA_VM_PLUGINS_PATH;
  const previousStdDir = process.env.CODEX_UI_SA_VM_STD_DIR;

  try {
    process.env.CODEX_UI_SA_VM_BIN = executable;
    process.env.CODEX_UI_SA_VM_PLUGINS_PATH = vmPlugin;
    process.env.CODEX_UI_SA_VM_STD_DIR = stdDir;

    const source = `@import "sa_std/process.sai"

fn main() -> i32 {
    let pid = sa_std_process_id();
    return pid;
}
`;

    const result = await runSaVmTool({
      language: "sla",
      source
    });

    // Must be denied, NOT executed
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("capability_denied");
    expect(result.stderr).toContain("E_CAPABILITY_DENIED");
    expect(result.stderr).toContain("extern_not_allowed");
    expect(result.saVmViolation).toBeTruthy();
    expect((result.saVmViolation as any).code).toBe(100);
    expect((result.saVmViolation as any).name).toBe("E_CAPABILITY_DENIED");

    // Telemetry events must capture the violation
    const violationEvent = result.saVmEvents.find((e) => (e as any).event === "violation");
    expect(violationEvent).toBeTruthy();
    expect((violationEvent as any).code).toBe(100);
  } finally {
    restoreEnv("CODEX_UI_SA_VM_BIN", previousExecutable);
    restoreEnv("CODEX_UI_SA_VM_PLUGINS_PATH", previousPlugin);
    restoreEnv("CODEX_UI_SA_VM_STD_DIR", previousStdDir);
  }
}, { timeout: 20000 });

test.skipIf(!hasSidecar)("M3 FR-6: compile failure loop returns structured error and simulates 3-strike fallback", async () => {
  const previousExecutable = process.env.CODEX_UI_SA_VM_BIN;
  const previousPlugin = process.env.CODEX_UI_SA_VM_PLUGINS_PATH;
  const previousStdDir = process.env.CODEX_UI_SA_VM_STD_DIR;

  try {
    process.env.CODEX_UI_SA_VM_BIN = executable;
    process.env.CODEX_UI_SA_VM_PLUGINS_PATH = vmPlugin;
    process.env.CODEX_UI_SA_VM_STD_DIR = stdDir;

    // Simulate 3 invalid compilation attempts (e.g. syntax errors or forbidden constructs)
    const badSources = [
      "fn main() -> i32 { let x: i32 = missing_semicolon return 0; }",
      "fn main() -> i32 { let s = 'a' + 'b'; return 0; }",
      "fn main() -> i32 { for item in collection { } return 0; }"
    ];

    let attemptCount = 0;
    for (const badSource of badSources) {
      const compileAttempt = await runSaVmTool({
        language: "sla",
        source: badSource
      });
      expect(compileAttempt.ok).toBe(false);
      expect(compileAttempt.kind).toBe("sa_error");
      expect(compileAttempt.stderr.length).toBeGreaterThan(0);
      attemptCount++;
    }

    expect(attemptCount).toBe(3);

    // After 3 strikes, the system must downgrade to Track 1 (packaged action)
    const testFilePath = join(import.meta.dir, "../../fallback_result.txt");
    try {
      const fallbackAttempt = await runSaVmTool({
        action: "write_file",
        path: "fallback_result.txt",
        content: "fallback through track 1",
        cwd: join(import.meta.dir, "../../")
      });

      // Fallback succeeds through Track 1 packaged action
      expect(fallbackAttempt.ok).toBe(true);
      expect(fallbackAttempt.kind).toBe("success");
      expect(fallbackAttempt.stdout).toContain("wrote 24 bytes");
    } finally {
      const { rmSync, existsSync } = await import("node:fs");
      if (existsSync(testFilePath)) {
        try { rmSync(testFilePath, { force: true }); } catch {}
      }
    }
  } finally {
    restoreEnv("CODEX_UI_SA_VM_BIN", previousExecutable);
    restoreEnv("CODEX_UI_SA_VM_PLUGINS_PATH", previousPlugin);
    restoreEnv("CODEX_UI_SA_VM_STD_DIR", previousStdDir);
  }
}, { timeout: 30000 });
