import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";
import { interceptSaVmRequest } from "../../backends/vmtool-security/src/security/saVmInterception";
import { checkSaVmProcess, normalizeSaVmPolicy } from "../../backends/vmtool-security/src/security/saVmPolicy";
import { runSaVmTool } from "../../apps/server/src/saVmTool";

const complexCmd = "git tag -a v0.0.1-preview.96.26 -m \"Release v0.0.1-preview.96.26\" f66b602 Write-Output '--- commit ---' git show --no-patch --format='%h %s' f66b602 Write-Output '--- tag ---' git show-ref --tags v";

describe("SA-VM complex command handling", () => {
  test("direct host execution of complex multi-statement commands is terminally denied", () => {
    const decision = interceptSaVmRequest(
      "command/exec",
      { command: complexCmd },
      { cwd: "D:/projects/codex-ultra", policy: createDefaultSaVmPolicyConfig() }
    );
    expect(decision.action).toBe("deny");
    if (decision.action === "deny") {
      expect(decision.reason).toContain("direct host command execution is disabled in SA-VM mode; use sa_vm_run");
    }
  });

  test("default process policy denies undeclared git commands and powershell cmdlets", () => {
    const defaultPolicy = normalizeSaVmPolicy(createDefaultSaVmPolicyConfig(), "D:/projects/codex-ultra");
    expect(checkSaVmProcess(defaultPolicy, "git", ["tag", "-a", "v0.0.1-preview.96.26"]).allowed).toBe(false);
    expect(checkSaVmProcess(defaultPolicy, "git", ["show", "--no-patch", "f66b602"]).allowed).toBe(false);
    expect(checkSaVmProcess(defaultPolicy, "git", ["show-ref", "--tags", "v"]).allowed).toBe(false);
    expect(checkSaVmProcess(defaultPolicy, "Write-Output", ["--- commit ---"]).allowed).toBe(false);
  });

  test("custom process policy permits explicit git subcommands but rejects shell pipelines", () => {
    const customConfig = createDefaultSaVmPolicyConfig();
    customConfig.process = {
      spawn: true,
      exec: [
        { path: "git", args: ["tag", "*"] },
        { path: "git", args: ["show", "*"] },
        { path: "git", args: ["show-ref", "*"] }
      ]
    };
    const customPolicy = normalizeSaVmPolicy(customConfig, "D:/projects/codex-ultra");
    expect(checkSaVmProcess(customPolicy, "git", ["tag", "-a", "v0.0.1-preview.96.26", "-m", "Release", "f66b602"]).allowed).toBe(true);
    expect(checkSaVmProcess(customPolicy, "git", ["show", "--no-patch", "--format=%h %s", "f66b602"]).allowed).toBe(true);
    expect(checkSaVmProcess(customPolicy, "git", ["show-ref", "--tags", "v"]).allowed).toBe(true);
    expect(checkSaVmProcess(customPolicy, "Write-Output", ["--- commit ---"]).allowed).toBe(false);
  });

  test("raw shell string submitted to the removed sidecar path stays inert without host escape", async () => {
    const runtimeRoot = join(import.meta.dir, "../../desktop-resources/sa-vm");
    const executable = join(runtimeRoot, "sa.exe");
    const vmPlugin = join(runtimeRoot, "vm.dll");
    const slaPlugin = join(runtimeRoot, "sa_plugins/installed/sla/current/sla.dll");
    const stdDir = join(runtimeRoot, "sa_std");
    if (!existsSync(executable) || !existsSync(vmPlugin) || !existsSync(slaPlugin) || !existsSync(stdDir)) return;

    process.env.CODEX_UI_SA_VM_BIN = executable;
    process.env.CODEX_UI_SA_VM_PLUGINS_PATH = vmPlugin;
    process.env.CODEX_UI_SA_VM_STD_DIR = stdDir;

    const result = await runSaVmTool({
      language: "sla",
      source: complexCmd
    });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("sa_error");
    expect(result.stderr).toBeDefined();
  });

  test("structured multi-step tasks no longer route to the removed VM sidecar", async () => {
    const result = await runSaVmTool({
      language: "sla" as never,
      source: `println("--- commit ---");`,
      limits: { deadline_ms: 10000 }
    });

    expect(result.ok).toBe(false);
    expect(result.kind).toBe("sa_error");
    expect(result.stderr).toContain("bun branch");
  }, { timeout: 15000 });
});
