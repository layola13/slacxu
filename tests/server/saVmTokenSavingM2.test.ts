/** Token Saving M2 - OPT-4 parallel budget. */
import { describe, test, expect } from "bun:test";
import { runSaVmTool } from "../../apps/server/src/saVmTool.js";
import { tmpdir } from "node:os";
import type { SaVmPolicyConfig } from "@codex-ui/shared";

function freePolicy(extra = {}) {
  return {
    fs: { roots: [{ path: tmpdir(), read: true, write: true }], defaultWrite: false, defaultRead: false },
    net: { rules: [], defaultAllow: false },
    process: { rules: [], defaultAllow: false },
    ...extra,
  };
}

const src = "print(\"budget-probe-hello\")";
const cwd = tmpdir();
function readTask(i, policy) { return { action: "read_file", path: "/tmp/probe-" + i + ".txt", cwd: cwd, policy: policy }; }
function slaTask(policy) { return { language: "sla", source: src, cwd: cwd, policy: policy }; }

describe("OPT-4 parallelBudget", () => {
  const withParallelEnabled = async (fn: () => Promise<void>) => {
    const prevParallel = process.env.SA_VM_ENABLE_PARALLEL;
    process.env.SA_VM_ENABLE_PARALLEL = "true";
    try {
      await fn();
    } finally {
      if (prevParallel === undefined) delete process.env.SA_VM_ENABLE_PARALLEL;
      else process.env.SA_VM_ENABLE_PARALLEL = prevParallel;
    }
  };
  test("OFF: SLA batch unaffected when parallelBudget=false", async () => {
    await withParallelEnabled(async () => {
      const policy = freePolicy({ contextSavings: { parallelBudget: false } });
      const result = await runSaVmTool({ parallel: [slaTask(policy), slaTask(policy)], cwd: cwd, policy: policy });
      expect(result.stdout.includes("[OPT-4]")).toBe(false);
      expect(result.stderr.includes("[OPT-4]")).toBe(false);
    });
  });
  test("ON: 5 full reads rejected over default quota 4", async () => {
    await withParallelEnabled(async () => {
      const policy = freePolicy({ contextSavings: { parallelBudget: true } });
      const result = await runSaVmTool({ parallel: [readTask(0, policy), readTask(1, policy), readTask(2, policy), readTask(3, policy), readTask(4, policy)], cwd: cwd, policy: policy });
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(228);
      expect(result.stderr.includes("[OPT-4]")).toBe(true);
    });
  });
  test("ON: custom maxReadFiles=2 rejects 3 reads", async () => {
    await withParallelEnabled(async () => {
      const policy = freePolicy({ contextSavings: { parallelBudget: true, parallelMaxReadFiles: 2 } });
      const result = await runSaVmTool({ parallel: [readTask(0, policy), readTask(1, policy), readTask(2, policy)], cwd: cwd, policy: policy });
      expect(result.ok).toBe(false);
      expect(result.stderr.includes("[OPT-4]")).toBe(true);
    });
  });
  test("ON: tiny total budget truncates SLA batch", async () => {
    await withParallelEnabled(async () => {
      const policy = freePolicy({ contextSavings: { parallelBudget: true, parallelMaxTotalBytes: 10 } });
      const result = await runSaVmTool({ parallel: [slaTask(policy), slaTask(policy)], cwd: cwd, policy: policy });
      expect(result.stdout.includes("[OPT-4]")).toBe(true);
    });
  });
  test("OFF: tiny budget ignored when disabled", async () => {
    await withParallelEnabled(async () => {
      const policy = freePolicy({ contextSavings: { parallelBudget: false, parallelMaxTotalBytes: 10 } });
      const result = await runSaVmTool({ parallel: [slaTask(policy)], cwd: cwd, policy: policy });
      expect(result.stdout.includes("[OPT-4]")).toBe(false);
    });
  });
});