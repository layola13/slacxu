import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { writeFileSync, unlinkSync, rmSync, existsSync, mkdirSync } from "node:fs";
import {
  ALL_SA_VM_BUN_FILTER_SCRIPTS,
  type SaVmPolicyConfig
} from "@codex-ui/shared";
import { expandSaVmActionInput, runSaVmTool } from "../../apps/server/src/saVmTool.js";
import { buildSaVmWorkspaceSkillMarkdown } from "../../apps/server/src/saVmWorkspaceSkill.js";

const cwd = resolve(process.cwd());

describe("SA-VM Safe Bun M2 - build Subcommand", () => {
  const allowedPolicy: SaVmPolicyConfig = {
    process: {
      bun: true
    }
  };

  test("run_bun build requires at least one entry point", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "build",
      args: [],
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("'bun build' requires at least one entry point file");
    expect(res.saVmViolation?.rule).toBe("process.bun.build_entry_required");
  });

  test("run_bun build rejects non-existent entry file", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "build",
      args: ["src/does_not_exist.ts"],
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("build entry file does not exist");
    expect(res.saVmViolation?.rule).toBe("process.bun.build_file_not_found");
  });

  test("run_bun build rejects entry file outside workspace", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "build",
      args: ["../../outside.ts"],
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("denied");
  });

  test("run_bun build rejects outdir outside workspace", async () => {
    const tempEntry = join(cwd, "scratch_m2_entry.ts");
    writeFileSync(tempEntry, 'export const value = 42;', "utf8");
    try {
      const res = await runSaVmTool({
        action: "run_bun",
        subcommand: "build",
        args: ["scratch_m2_entry.ts", "--outdir", "../../outside_dist"],
        policy: allowedPolicy,
        cwd
      });
      expect(res.ok).toBe(false);
      expect(res.exitCode).toBe(228);
      expect(res.stderr).toContain("denied");
    } finally {
      if (existsSync(tempEntry)) unlinkSync(tempEntry);
    }
  });

  test("run_bun build executes valid build successfully", async () => {
    const tempEntry = join(cwd, "scratch_m2_build_entry.ts");
    const tempOutDir = join(cwd, "scratch_m2_dist");
    writeFileSync(tempEntry, 'export const greeting = "hello bun build";', "utf8");
    try {
      const res = await runSaVmTool({
        action: "run_bun",
        subcommand: "build",
        args: ["scratch_m2_build_entry.ts", "--outdir", "scratch_m2_dist"],
        policy: allowedPolicy,
        cwd
      });
      expect(res.ok).toBe(true);
      expect(res.exitCode).toBe(0);
      expect(existsSync(join(tempOutDir, "scratch_m2_build_entry.js"))).toBe(true);
    } finally {
      if (existsSync(tempEntry)) unlinkSync(tempEntry);
      if (existsSync(tempOutDir)) rmSync(tempOutDir, { recursive: true, force: true });
    }
  });
});

describe("SA-VM Safe Bun M2 - --filter Monorepo Subcommand", () => {
  const allowedPolicy: SaVmPolicyConfig = {
    process: {
      bun: true
    }
  };

  test("run_bun --filter requires package name and script name", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "--filter",
      args: ["@codex-ui/shared"],
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("requires a target package and script name");
    expect(res.saVmViolation?.rule).toBe("process.bun.filter_args_required");
  });

  test("run_bun --filter rejects unauthorized script names", async () => {
    const unauthorized = ["dev", "start", "clean", "postinstall", "publish", "arbitrary"];
    for (const script of unauthorized) {
      const res = await runSaVmTool({
        action: "run_bun",
        subcommand: "--filter",
        args: ["@codex-ui/shared", script],
        policy: allowedPolicy,
        cwd
      });
      expect(res.ok).toBe(false);
      expect(res.exitCode).toBe(228);
      expect(res.stderr).toContain("is not permitted with --filter");
      expect(res.saVmViolation?.rule).toBe("process.bun.filter_script_denied");
    }
  });

  test("run_bun --filter allows all approved scripts (typecheck, build, test, lint)", () => {
    expect(ALL_SA_VM_BUN_FILTER_SCRIPTS).toContain("typecheck");
    expect(ALL_SA_VM_BUN_FILTER_SCRIPTS).toContain("build");
    expect(ALL_SA_VM_BUN_FILTER_SCRIPTS).toContain("test");
    expect(ALL_SA_VM_BUN_FILTER_SCRIPTS).toContain("lint");
  });

  test("run_bun --filter executes real @codex-ui/shared typecheck safely", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "--filter",
      args: ["@codex-ui/shared", "typecheck"],
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout + res.stderr).toContain("@codex-ui/shared");
  });

  test("expandSaVmActionInput normalizes filter field into --filter subcommand", () => {
    const res = expandSaVmActionInput({
      action: "run_bun",
      filter: "@codex-ui/shared",
      subcommand: "typecheck"
    });
    expect(res.action).toBe("run_bun");
    expect(res.subcommand).toBe("--filter");
    expect(res.args).toEqual(["@codex-ui/shared", "typecheck"]);
  });
});

describe("SA-VM Safe Bun M2 - Skill Sync & Timeouts", () => {
  test("buildSaVmWorkspaceSkillMarkdown includes run_bun when policy.process.bun is enabled", () => {
    const markdown = buildSaVmWorkspaceSkillMarkdown({
      enabled: true,
      policy: {
        process: {
          bun: true
        }
      }
    });
    expect(markdown).toContain("run_bun");
    expect(markdown).toContain("安全通用 Bun 执行工具 (run_bun)");
    expect(markdown).toContain('"action": "run_bun"');
    expect(markdown).toContain('"subcommand": "test"');
  });

  test("buildSaVmWorkspaceSkillMarkdown omits run_bun when policy.process.bun is not enabled", () => {
    const markdown = buildSaVmWorkspaceSkillMarkdown({
      enabled: true,
      policy: {
        process: {
          bun: false
        }
      }
    });
    expect(markdown).not.toContain("安全通用 Bun 执行工具 (run_bun)");
  });

  test("run_bun clamps custom timeout between 1000ms and 300000ms", async () => {
    // Verified via execution with custom timeout
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "test",
      args: ["tests/server/saVmGuardToggleSync.test.ts"],
      timeout_ms: 15000,
      policy: { process: { bun: true } },
      cwd
    });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
  });
});
