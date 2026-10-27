/**
 * Token Saving M1 unit tests - OPT-1 / OPT-2 / OPT-3 / OPT-9
 * All tests use runSaVmTool to route through native SA-VM paths.
 */
import { describe, test, expect } from "bun:test";
import { runSaVmTool } from "../../apps/server/src/saVmTool.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import type { SaVmPolicyConfig } from "@codex-ui/shared";

function freePolicy(extra: Partial<SaVmPolicyConfig> = {}): SaVmPolicyConfig {
  return {
    fs: { roots: [{ path: tmpdir(), read: true, write: true }], defaultWrite: false, defaultRead: false },
    net: { rules: [], defaultAllow: false },
    process: { rules: [], defaultAllow: false },
    ...extra
  };
}

// OPT-1: locateBeforeRead
describe("OPT-1 locateBeforeRead", () => {
  let dir: string;
  test("setup", async () => { dir = await mkdtemp(join(tmpdir(), "opt1-")); });

  test("OFF: large file reads normally when locateBeforeRead=false", async () => {
    const bigFile = join(dir, "big.txt");
    await writeFile(bigFile, "x".repeat(100 * 1024));
    const result = await runSaVmTool({ action: "read_file", path: bigFile, cwd: dir, policy: freePolicy({ contextSavings: { locateBeforeRead: false } }) });
    expect(result.stderr).not.toContain("[OPT-1]");
  });

  test("ON: large file rejected when locateBeforeRead=true and file > default 50KB", async () => {
    const bigFile = join(dir, "big2.txt");
    await writeFile(bigFile, "x".repeat(100 * 1024));
    const result = await runSaVmTool({ action: "read_file", path: bigFile, cwd: dir, policy: freePolicy({ contextSavings: { locateBeforeRead: true } }) });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(228);
    expect(result.stderr).toContain("[OPT-1]");
    expect(result.stderr).toContain("read_lines");
  });

  test("ON: small file passes through even when locateBeforeRead=true", async () => {
    const smallFile = join(dir, "small.txt");
    await writeFile(smallFile, "hello world");
    const result = await runSaVmTool({ action: "read_file", path: smallFile, cwd: dir, policy: freePolicy({ contextSavings: { locateBeforeRead: true } }) });
    expect(result.stderr).not.toContain("[OPT-1]");
    expect(result.stdout).toContain("hello world");
  });

  test("ON: custom maxReadFileBytes overrides default (reject 5KB file when limit=4KB)", async () => {
    const file = join(dir, "custom.txt");
    await writeFile(file, "y".repeat(5 * 1024));
    const result = await runSaVmTool({ action: "read_file", path: file, cwd: dir, policy: freePolicy({ contextSavings: { locateBeforeRead: true, maxReadFileBytes: 4 * 1024 } }) });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("[OPT-1]");
  });

  test("ON: read_lines with start_line/end_line succeeds on large file (>50KB) even when locateBeforeRead=true", async () => {
    const bigFile = join(dir, "large_code.zig");
    const content = Array.from({ length: 500 }, (_, i) => `pub fn step_${i + 1}() void { /* large file padding to exceed 50KB limit: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef */ }`).join("\n");
    await writeFile(bigFile, content, "utf8");
    // Ensure file size is indeed > 50KB
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(bigFile);
    expect(stat.size).toBeGreaterThan(50 * 1024);

    const result = await runSaVmTool({
      action: "read_lines",
      path: bigFile,
      start_line: 170,
      end_line: 250,
      cwd: dir,
      policy: freePolicy({ contextSavings: { locateBeforeRead: true } })
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("step_170");
    expect(result.stdout).toContain("step_250");
  });

  test("teardown", async () => { await rm(dir, { recursive: true, force: true }); });
});

// OPT-2: grep circuit breaker (sync)
describe("OPT-2 grepCircuitBreaker (sync)", () => {
  let dir: string;
  test("setup", async () => {
    dir = await mkdtemp(join(tmpdir(), "opt2-"));
    for (let i = 0; i < 60; i++) await writeFile(join(dir, `f${i}.txt`), `line1\nkeyword\nline3`);
  });

  test("OFF: matches not truncated when grepCircuitBreaker=false", async () => {
    const result = await runSaVmTool({ action: "grep_search", query: "keyword", dir, cwd: dir, policy: freePolicy({ contextSavings: { grepCircuitBreaker: false } }) });
    expect(result.stderr).not.toContain("[OPT-2]");
  });

  test("ON: caps results at grepMaxResults=20 and notes truncation", async () => {
    const result = await runSaVmTool({ action: "grep_search", query: "keyword", dir, cwd: dir, policy: freePolicy({ contextSavings: { grepCircuitBreaker: true, grepMaxResults: 20 } }) });
    const parsed = JSON.parse(result.stdout);
    expect(parsed.length).toBeLessThanOrEqual(20);
    expect(result.stderr).toContain("[OPT-2]");
  });

  test("teardown", async () => { await rm(dir, { recursive: true, force: true }); });
});

// OPT-2: grep circuit breaker (async)
describe("OPT-2 grepCircuitBreaker (async)", () => {
  let dir: string;
  test("setup", async () => {
    dir = await mkdtemp(join(tmpdir(), "opt2a-"));
    for (let i = 0; i < 60; i++) await writeFile(join(dir, `g${i}.txt`), `line1\nkeyword\nline3`);
  });

  test("ON async: caps results at grepMaxResults=15", async () => {
    const result = await runSaVmTool({ action: "grep_search_async", query: "keyword", dir, cwd: dir, policy: freePolicy({ contextSavings: { grepCircuitBreaker: true, grepMaxResults: 15 } }) });
    const parsed = JSON.parse(result.stdout);
    expect(parsed.length).toBeLessThanOrEqual(15);
    expect(result.stderr).toContain("[OPT-2]");
  });

  test("teardown", async () => { await rm(dir, { recursive: true, force: true }); });
});

// OPT-3: slimRunnerOutput
describe("OPT-3 slimRunnerOutput", () => {
  test("OFF: full output returned when slimRunnerOutput=false", async () => {
    const result = await runSaVmTool({
      language: "js",
      source: `for(let i=0;i<15;i++) console.log("detail "+i); console.log("13 pass");`,
      cwd: tmpdir(),
      policy: freePolicy({ contextSavings: { slimRunnerOutput: false } })
    });
    if (result.ok) expect(result.stdout).not.toContain("[OPT-3]");
  });

  test("ON: output slimmed when slimRunnerOutput=true and pass/fail lines exist", async () => {
    const result = await runSaVmTool({
      language: "js",
      source: `for(let i=0;i<15;i++) console.log("detail "+i); console.log("13 pass, 0 fail");`,
      cwd: tmpdir(),
      policy: freePolicy({ contextSavings: { slimRunnerOutput: true } })
    });
    if (result.ok) {
      expect(result.stdout).toContain("[OPT-3]");
      expect(result.stdout).toContain("[slim]");
    }
  });
});

// OPT-9: parallelDeduplication
describe("OPT-9 parallelDeduplication", () => {
  const src = `print("dedup-test-hello")`;
  const cwd = tmpdir();

  test("OFF: two identical tasks both execute when parallelDeduplication=false", async () => {
    const prevParallel = process.env.SA_VM_ENABLE_PARALLEL;
    process.env.SA_VM_ENABLE_PARALLEL = "true";
    try {
      const policy = freePolicy({ contextSavings: { parallelDeduplication: false } });
      const result = await runSaVmTool({
        parallel: [
          { language: "sla", source: src, cwd, policy },
          { language: "sla", source: src, cwd, policy }
        ],
        cwd,
        policy
      });
      expect(result.stdout).toContain("[parallel:0]");
      expect(result.stdout).toContain("[parallel:1]");
      expect(result.stdout).not.toContain("[OPT-9]");
    } finally {
      if (prevParallel === undefined) delete process.env.SA_VM_ENABLE_PARALLEL;
      else process.env.SA_VM_ENABLE_PARALLEL = prevParallel;
    }
  });

  test("ON: 3 identical tasks share 1 execution and OPT-9 note appears when dedup=true", async () => {
    const prevParallel = process.env.SA_VM_ENABLE_PARALLEL;
    process.env.SA_VM_ENABLE_PARALLEL = "true";
    try {
      const policy = freePolicy({ contextSavings: { parallelDeduplication: true } });
      const result = await runSaVmTool({
        parallel: [
          { language: "sla", source: src, cwd, policy },
          { language: "sla", source: src, cwd, policy },
          { language: "sla", source: src, cwd, policy }
        ],
        cwd,
        policy
      });
      expect(result.stdout).toContain("[parallel:0]");
      expect(result.stdout).toContain("[parallel:2]");
      expect(result.stdout).toContain("[OPT-9]");
      expect(result.stdout).toContain("deduplicated");
    } finally {
      if (prevParallel === undefined) delete process.env.SA_VM_ENABLE_PARALLEL;
      else process.env.SA_VM_ENABLE_PARALLEL = prevParallel;
    }
  });
});
