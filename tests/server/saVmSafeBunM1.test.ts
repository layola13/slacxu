import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import {
  ALL_SA_VM_BUN_SUBCOMMANDS,
  SA_VM_BUN_DENIED_SUBCOMMANDS,
  type SaVmPolicyConfig
} from "@codex-ui/shared";
import { expandSaVmActionInput, runSaVmTool } from "../../apps/server/src/saVmTool.js";
import { normalizeSaVmPolicy, checkSaVmBunExecution } from "../../backends/vmtool-security/src/security/saVmPolicy.js";

const cwd = resolve(process.cwd());

describe("SA-VM Safe Bun M1 - Action Expansion", () => {
  test("expandSaVmActionInput routes run_bun correctly without falling into run_js", () => {
    const res1 = expandSaVmActionInput({
      action: "run_bun",
      subcommand: "test",
      args: ["tests/server/saVmTool.test.ts"]
    });
    expect(res1.action).toBe("run_bun");
    expect(res1.subcommand).toBe("test");
    expect(res1.args).toEqual(["tests/server/saVmTool.test.ts"]);
    expect(res1.language).toBeUndefined();

    // Fallback: action bun with subcommand
    const res2 = expandSaVmActionInput({
      action: "bun",
      subcommand: "run",
      args: ["scripts/launch.mjs"]
    });
    expect(res2.action).toBe("run_bun");
    expect(res2.subcommand).toBe("run");
    expect(res2.args).toEqual(["scripts/launch.mjs"]);

    // Fallback: test_file or path parameter automatically populated to args
    const res3 = expandSaVmActionInput({
      action: "run_bun",
      subcommand: "test",
      test_file: "tests/foo.test.ts"
    });
    expect(res3.action).toBe("run_bun");
    expect(res3.args).toEqual(["tests/foo.test.ts"]);

    // Legacy: action bun with source still expands to js
    const res4 = expandSaVmActionInput({
      action: "bun",
      source: "console.log(123);"
    });
    expect(res4.language).toBe("js");
    expect(res4.source).toBe("console.log(123);");
  });
});

describe("SA-VM Safe Bun M1 - Policy Gate & Denylist", () => {
  const allowedPolicy: SaVmPolicyConfig = {
    process: {
      bun: true
    }
  };

  test("run_bun denies missing subcommand", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("subcommand is required");
    expect(res.saVmViolation?.rule).toBe("process.bun.subcommand_required");
  });

  test("run_bun denies all forbidden subcommands in denylist", async () => {
    const forbidden = ["install", "i", "add", "remove", "rm", "update", "upgrade", "outdated", "bunx", "init", "deploy", "publish"];
    for (const sub of forbidden) {
      const res = await runSaVmTool({
        action: "run_bun",
        subcommand: sub,
        policy: allowedPolicy,
        cwd
      });
      expect(res.ok).toBe(false);
      expect(res.exitCode).toBe(228);
      expect(res.stderr).toContain("is forbidden in sa-vm");
      expect(res.saVmViolation?.rule).toBe("process.bun.denied_subcommand");
    }
  });

  test("run_bun denies unknown subcommands", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "unknown-command",
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("Unknown or unsupported Bun subcommand");
    expect(res.saVmViolation?.rule).toBe("process.bun.unsupported_subcommand");
  });

  test("run_bun denies --preload flag in args", async () => {
    const res1 = await runSaVmTool({
      action: "run_bun",
      subcommand: "test",
      args: ["--preload", "./setup.ts", "tests/foo.test.ts"],
      policy: allowedPolicy,
      cwd
    });
    expect(res1.ok).toBe(false);
    expect(res1.exitCode).toBe(228);
    expect(res1.stderr).toContain("--preload flag is forbidden in sa-vm");
    expect(res1.saVmViolation?.rule).toBe("process.bun.preload_forbidden");

    const res2 = await runSaVmTool({
      action: "run_bun",
      subcommand: "run",
      args: ["--preload=setup.ts", "test.ts"],
      policy: allowedPolicy,
      cwd
    });
    expect(res2.ok).toBe(false);
    expect(res2.exitCode).toBe(228);
    expect(res2.stderr).toContain("--preload flag is forbidden in sa-vm");
  });

  test("run_bun denies inline evaluation (-e / --eval)", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "run",
      args: ["-e", "console.log(process.env)"],
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("inline evaluation");
    expect(res.saVmViolation?.rule).toBe("process.bun.inline_code_forbidden");
  });

  test("run_bun denies shell metacharacters in arguments", async () => {
    const unsafeArgs = [
      ["tests/a.test.ts; rm -rf /"],
      ["tests/a.test.ts", "&&", "evil.exe"],
      ["`whoami`"],
      ["$(id)"],
      ["test.ts | grep foo"]
    ];
    for (const args of unsafeArgs) {
      const res = await runSaVmTool({
        action: "run_bun",
        subcommand: "test",
        args,
        policy: allowedPolicy,
        cwd
      });
      expect(res.ok).toBe(false);
      expect(res.exitCode).toBe(228);
      expect(res.stderr).toContain("shell metacharacters are forbidden");
      expect(res.saVmViolation?.rule).toBe("process.bun.shell_metacharacters");
    }
  });

  test("run_bun enforces policy gates (disabled or restricted subcommands)", async () => {
    // 1. Default policy (process.bun is not configured and process.exec is empty) -> Denied
    const defaultRes = await runSaVmTool({
      action: "run_bun",
      subcommand: "test",
      args: ["tests/server/saVmGuardToggleSync.test.ts"],
      policy: {},
      cwd
    });
    expect(defaultRes.ok).toBe(false);
    expect(defaultRes.exitCode).toBe(228);
    expect(defaultRes.stderr).toContain("not in the process allowlist");

    // 2. Explicitly disabled bun
    const disabledRes = await runSaVmTool({
      action: "run_bun",
      subcommand: "test",
      args: ["tests/server/saVmGuardToggleSync.test.ts"],
      policy: { process: { bun: false } },
      cwd
    });
    expect(disabledRes.ok).toBe(false);
    expect(disabledRes.exitCode).toBe(228);
    expect(disabledRes.stderr).toContain("Bun execution is disabled");

    // 3. Subcommand not in allowed list
    const restrictedRes = await runSaVmTool({
      action: "run_bun",
      subcommand: "run",
      args: ["scripts/sync-codex-config-schema.mjs"],
      policy: { process: { bun: { enabled: true, allowedSubcommands: ["test"] } } },
      cwd
    });
    expect(restrictedRes.ok).toBe(false);
    expect(restrictedRes.exitCode).toBe(228);
    expect(restrictedRes.stderr).toContain("not in the allowed list");
  });
});

describe("SA-VM Safe Bun M1 - Target File & Q1 Decision Enforcement", () => {
  const allowedPolicy: SaVmPolicyConfig = {
    process: {
      bun: true
    }
  };

  test("run_bun run requires a target file", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "run",
      args: [],
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("'bun run' requires a target file path");
    expect(res.saVmViolation?.rule).toBe("process.bun.run_target_required");
  });

  test("run_bun run rejects package.json script names (Q1 A-option lock)", async () => {
    // Attempting to run 'build' or 'dev' as script name instead of file
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "run",
      args: ["build"],
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("only allows executing existing workspace files");
    expect(res.stderr).toContain("Arbitrary package.json scripts are disabled for sandbox safety");
    expect(res.saVmViolation?.rule).toBe("process.bun.run_file_not_found");
  });

  test("run_bun run rejects path traversal outside workspace", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "run",
      args: ["../../package.json"],
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("denied");
  });

  test("run_bun test rejects non-existent test file", async () => {
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "test",
      args: ["tests/server/does_not_exist.test.ts"],
      policy: allowedPolicy,
      cwd
    });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("test file does not exist");
    expect(res.saVmViolation?.rule).toBe("process.bun.test_file_not_found");
  });
});

describe("SA-VM Safe Bun M1 - Execution & Offline Injection", () => {
  const allowedPolicy: SaVmPolicyConfig = {
    process: {
      bun: true
    }
  };

  test("run_bun test executes a valid test file safely and successfully", async () => {
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
  });

  test("run_bun run executes an existing workspace script file safely", async () => {
    // Create a temporary benign script in workspace
    const tempScript = join(cwd, "scratch_m1_test.js");
    writeFileSync(tempScript, 'console.log("SAFE_BUN_M1_SUCCESS"); process.exit(0);', "utf8");
    try {
      const res = await runSaVmTool({
        action: "run_bun",
        subcommand: "run",
        args: ["scratch_m1_test.js"],
        policy: allowedPolicy,
        cwd
      });
      expect(res.ok).toBe(true);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("SAFE_BUN_M1_SUCCESS");
    } finally {
      if (existsSync(tempScript)) unlinkSync(tempScript);
    }
  });

  test("run_bun allows process.exec rule as alternate outer authorization gate", async () => {
    // Authorize via process.exec rule instead of process.bun: true
    const res = await runSaVmTool({
      action: "run_bun",
      subcommand: "test",
      args: ["tests/server/saVmGuardToggleSync.test.ts"],
      policy: {
        process: {
          exec: [{ path: "bun", args: ["test", "*"] }]
        }
      },
      cwd
    });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
  });
});
