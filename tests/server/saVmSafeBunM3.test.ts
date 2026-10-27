import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ALL_SA_VM_BUN_FILTER_SCRIPTS,
  ALL_SA_VM_BUN_SUBCOMMANDS,
  createDefaultSaVmPolicyConfig,
  SA_VM_BUN_DENIED_SUBCOMMANDS,
  type SaVmPolicyConfig
} from "@codex-ui/shared";
import {
  checkSaVmBunExecution,
  normalizeSaVmPolicy
} from "../../backends/vmtool-security/src/security/saVmPolicy";
import { runSaVmTool } from "../../apps/server/src/saVmTool";

const cwd = resolve(process.cwd());

describe("SA-VM Safe Bun M3 - Policy Gate & Default Configuration", () => {
  test("default policy has bun execution and all bun profiles enabled by default", async () => {
    const defaultPolicy = createDefaultSaVmPolicyConfig();
    const normalized = normalizeSaVmPolicy(defaultPolicy, cwd);

    expect(normalized.process.bun?.enabled).toBe(true);
    expect(normalized.process.bunProfiles?.length).toBe(11);
  });

  test("explicit policy.process.bun = false denies execution with clear violation", async () => {
    const policy: SaVmPolicyConfig = {
      process: {
        bun: false
      }
    };
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "test",
      args: ["tests/server/saVmGuardToggleSync.test.ts"],
      policy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("Bun execution is disabled in the VM policy");
    expect(res.saVmViolation?.rule).toBe("process.bun");
  });

  test("policy.process.bun = true enables all subcommands in ALL_SA_VM_BUN_SUBCOMMANDS", () => {
    const policy: SaVmPolicyConfig = {
      process: {
        bun: true
      }
    };
    const normalized = normalizeSaVmPolicy(policy, cwd);
    expect(normalized.process.bun?.enabled).toBe(true);
    expect(normalized.process.bun?.allowedSubcommands).toEqual([...ALL_SA_VM_BUN_SUBCOMMANDS]);

    for (const sub of ALL_SA_VM_BUN_SUBCOMMANDS) {
      const decision = checkSaVmBunExecution(normalized, "bun", sub, []);
      expect(decision.allowed).toBe(true);
    }
  });

  test("granular policy.process.bun object restricts allowedSubcommands", () => {
    const policy: SaVmPolicyConfig = {
      process: {
        bun: {
          enabled: true,
          allowedSubcommands: ["test", "build"]
        }
      }
    };
    const normalized = normalizeSaVmPolicy(policy, cwd);
    expect(normalized.process.bun?.enabled).toBe(true);
    expect(normalized.process.bun?.allowedSubcommands).toEqual(["test", "build"]);

    expect(checkSaVmBunExecution(normalized, "bun", "test", []).allowed).toBe(true);
    expect(checkSaVmBunExecution(normalized, "bun", "build", []).allowed).toBe(true);
    expect(checkSaVmBunExecution(normalized, "bun", "run", []).allowed).toBe(false);
    expect(checkSaVmBunExecution(normalized, "bun", "--filter", []).allowed).toBe(false);
  });

  test("fallback to process.exec allowlist when process.bun is not explicitly configured", () => {
    const policy: SaVmPolicyConfig = {
      process: {
        exec: [
          { path: "bun", args: ["test", "*"] },
          { path: "bun.exe", args: ["test", "*"] }
        ]
      }
    };
    const normalized = normalizeSaVmPolicy(policy, cwd);
    expect(normalized.process.bun).toBeUndefined();

    // test subcommand matches exec rule
    const allowedDecision = checkSaVmBunExecution(normalized, "bun.exe", "test", ["foo.test.ts"]);
    expect(allowedDecision.allowed).toBe(true);

    // build subcommand does not match exec rule
    const deniedDecision = checkSaVmBunExecution(normalized, "bun.exe", "build", ["foo.ts"]);
    expect(deniedDecision.allowed).toBe(false);
  });
});

describe("SA-VM Safe Bun M3 - Denylist & Injection Boundary Hardening", () => {
  const allowedPolicy: SaVmPolicyConfig = {
    process: {
      bun: true
    }
  };

  test("locks down every single forbidden subcommand in SA_VM_BUN_DENIED_SUBCOMMANDS", async () => {
    for (const forbidden of SA_VM_BUN_DENIED_SUBCOMMANDS) {
      const res = await runSaVmTool({
        action: "run_bun",
        subcommand: forbidden,
        policy: allowedPolicy,
        cwd
      });
      expect(res.ok).toBe(false);
      expect(res.exitCode).toBe(228);
      expect(res.stderr).toContain("is forbidden in sa-vm");
      expect(res.saVmViolation?.rule).toBe("process.bun.denied_subcommand");
    }
  });

  test("denies shell metacharacters in subcommand or args", async () => {
    const maliciousArgs = [
      ["test", "foo.test.ts; rm -rf /"],
      ["test", "foo.test.ts | cat"],
      ["test", "foo.test.ts && echo 1"],
      ["test", "$(whoami)"],
      ["test", "`id`"],
      ["test", "foo.test.ts &"],
      ["test", "< input.txt"]
    ];

    for (const [sub, arg] of maliciousArgs) {
      const res = await runSaVmTool({
        action: "run_bun",
        subcommand: sub,
        args: [arg!],
        policy: allowedPolicy,
        cwd
      });
      expect(res.ok).toBe(false);
      expect(res.exitCode).toBe(228);
    }
  });

  test("denies --preload and inline evaluation (-e, --eval)", async () => {
    const forbiddenOptions = [
      ["test", "--preload", "./setup.ts"],
      ["test", "--preload=./setup.ts"],
      ["run", "-e", "console.log(1)"],
      ["run", "--eval", "console.log(1)"]
    ];

    for (const [sub, ...opts] of forbiddenOptions) {
      const res = await runSaVmTool({
        action: "run_bun",
        subcommand: sub,
        args: opts,
        policy: allowedPolicy,
        cwd
      });
      expect(res.ok).toBe(false);
      expect(res.exitCode).toBe(228);
    }
  });
});

describe("SA-VM Safe Bun M3 - Output Truncation & Buffer Protection", () => {
  const allowedPolicy: SaVmPolicyConfig = {
    process: {
      bun: true
    }
  };

  test("large output respects MAX_STDOUT_BYTES limit safely", async () => {
    const scratchScript = join(cwd, "scratch_m3_large_output.ts");
    // Write a script that emits ~1MB of text
    writeFileSync(
      scratchScript,
      "for (let i = 0; i < 20000; i++) { console.log('output_chunk_line_' + i); }\n",
      "utf8"
    );

    try {
      const res = await runSaVmTool({
        action: "run_bun",
        subcommand: "run",
        args: ["scratch_m3_large_output.ts"],
        policy: allowedPolicy,
        cwd
      });

      expect(res.ok).toBe(true);
      expect(res.exitCode).toBe(0);
      // Ensure stdout is bounded by 512KB (524288 bytes)
      expect(res.stdout.length).toBeLessThanOrEqual(512 * 1024);
      expect(res.stdout).toContain("output_chunk_line_0");
    } finally {
      if (existsSync(scratchScript)) rmSync(scratchScript);
    }
  });
});

describe("SA-VM Safe Bun M3 - Live Smoke Tests", () => {
  const allowedPolicy: SaVmPolicyConfig = {
    process: {
      bun: true
    }
  };

  test("smoke: run_bun test executes a real unit test file and captures output & telemetry", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "test",
      args: ["tests/server/saVmGuardToggleSync.test.ts"],
      policy: allowedPolicy,
      cwd
    });

    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout + res.stderr).toContain("pass");
    expect(res.durationMs).toBeGreaterThan(0);
  });

  test("smoke: run_bun build executes a real build bundling an entrypoint into outdir", async () => {
    const entryFile = join(cwd, "scratch_m3_smoke_entry.ts");
    const distDir = join(cwd, "scratch_m3_dist");
    writeFileSync(entryFile, "export const appName = 'Codex-Ultra'; export const add = (a: number, b: number) => a + b;\n", "utf8");

    try {
      const res = await runSaVmTool({
        action: "run_bun",
        subcommand: "build",
        args: ["scratch_m3_smoke_entry.ts", "--outdir", "scratch_m3_dist"],
        policy: allowedPolicy,
        cwd
      });

      expect(res.ok).toBe(true);
      expect(res.exitCode).toBe(0);
      const bundledOut = join(distDir, "scratch_m3_smoke_entry.js");
      expect(existsSync(bundledOut)).toBe(true);
      const bundledContent = readFileSync(bundledOut, "utf8");
      expect(bundledContent).toContain("appName");
    } finally {
      if (existsSync(entryFile)) rmSync(entryFile);
      if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
    }
  });

  test("compatibility: legacy run_project_check profile continues to work without regression", async () => {
    const res = await runSaVmTool({
      action: "run_project_check",
      profile: "shared-typecheck",
      policy: {
        process: {
          bunProfiles: ["shared-typecheck"]
        }
      },
      cwd
    });

    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout + res.stderr).toContain("@codex-ui/shared");
  });

  test("run_bun is independent of execution.javascript toggle", async () => {
    const policy: SaVmPolicyConfig = {
      execution: {
        javascript: false,
        python: false
      },
      process: {
        bun: true
      }
    };
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "--filter",
      args: ["@codex-ui/shared", "typecheck"],
      policy,
      cwd
    });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.saVmViolation).toBeNull();
  });
});

