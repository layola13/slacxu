import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureSaVmGlobalBundleInstalled,
  ensureSaVmMcpInstalled,
  getSaVmGlobalDataDir,
  resolveBuiltinSaVmSourceRoot
} from "../../apps/server/src/saVmBundle";

test("resolves global SA-VM data directory under codexUiDataDir", () => {
  const globalDir = getSaVmGlobalDataDir().replaceAll("\\", "/");
  expect(globalDir).toMatch(/\.codex-ultra\/sa-vm$/);
});

test("bun branch ships no builtin sa-vm native resources directory", () => {
  expect(resolveBuiltinSaVmSourceRoot()).toBeNull();
});

test("bun branch bundle install skips native sidecar but installs mcp script", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "codex-test-bundle-"));
  try {
    const result = await ensureSaVmGlobalBundleInstalled({ targetRoot: targetDir, autoRegisterClients: false });
    expect(result.installed).toBe(false);
    expect(result.root).toBe(targetDir);

    expect(existsSync(join(targetDir, ".sa-vm-installed.json"))).toBe(false);
    expect(existsSync(join(targetDir, "sa_std"))).toBe(false);
    expect(existsSync(join(targetDir, "vm.dll"))).toBe(false);

    // Calling again stays a no-op for the native sidecar
    const second = await ensureSaVmGlobalBundleInstalled({ targetRoot: targetDir, autoRegisterClients: false });
    expect(second.installed).toBe(false);
    expect(existsSync(join(targetDir, "sa-vm-mcp.mjs"))).toBe(true);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("installs sa-vm-mcp.mjs script to target directory", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "codex-test-mcp-bundle-"));
  try {
    const result = await ensureSaVmMcpInstalled({ targetRoot: targetDir, autoRegisterClients: false });
    expect(result.installed).toBe(true);
    expect(existsSync(join(targetDir, "sa-vm-mcp.mjs"))).toBe(true);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

