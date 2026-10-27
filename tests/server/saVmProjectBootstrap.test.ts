import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SA_VM_MCP_SCRIPT_NAME,
  ensureSaVmProjectBundleInstalled,
  getSaVmProjectDataDir,
  resolveSaVmMcpScriptPath,
} from "../../apps/server/src/saVmBundle.js";
import { OpencodeBridge, resolveOpencodeSaVmMcp } from "../../backends/opencode/src/runtime/opencodeBridge.js";
import { syncSaVmWorkspaceSkillDirectory } from "../../apps/server/src/saVmWorkspaceSkill.js";

const SKILL_DIRS = [".codex", ".claude", ".gemini", ".grok", ".opencode", ".pi", ".agents"];

async function pollFor(path: string, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return existsSync(path);
}

describe("sa-vm project-local bootstrap (Linux new machine)", () => {
  test("project MCP installs under cwd and resolves project-first", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sax-proj-mcp-"));
    try {
      const ensured = await ensureSaVmProjectBundleInstalled(cwd);
      expect(ensured.scriptPath.replaceAll("\\", "/").endsWith(`.codex-ultra/sa-vm/${SA_VM_MCP_SCRIPT_NAME}`)).toBe(true);
      expect(ensured.installed).toBe(true);
      expect(existsSync(ensured.scriptPath)).toBe(true);
      expect(getSaVmProjectDataDir(cwd).replaceAll("\\", "/").endsWith(".codex-ultra/sa-vm")).toBe(true);
      expect(resolveSaVmMcpScriptPath(cwd)).toBe(ensured.scriptPath);
      const resolved = resolveOpencodeSaVmMcp("SA-VM instructions", cwd, "opencode-go/kimi-k2");
      expect(resolved?.scriptPath).toBe(ensured.scriptPath);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("Muse project MCP is written to .mcp.json (not .muse/settings.json)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sax-proj-muse-mcp-"));
    try {
      const ensured = await ensureSaVmProjectBundleInstalled(cwd);
      const mcpJsonPath = join(cwd, ".mcp.json");
      expect(existsSync(mcpJsonPath)).toBe(true);
      const conf = JSON.parse(await Bun.file(mcpJsonPath).text()) as {
        mcpServers?: Record<string, { command?: string; args?: string[] }>;
      };
      expect(conf.mcpServers?.["sa-vm"]?.command).toBe("node");
      expect(conf.mcpServers?.["sa-vm"]?.args).toEqual([ensured.scriptPath]);
      expect(existsSync(join(cwd, ".muse", "settings.json"))).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("skill sync writes all 7 CLI dirs plus jev", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sax-proj-skill-"));
    try {
      const result = await syncSaVmWorkspaceSkillDirectory({ cwd, enabled: true, jevActiveTools: true });
      expect(result.enabled).toBe(true);
      for (const dir of SKILL_DIRS) {
        const skill = join(cwd, dir, "skills", "sa-vm", "SKILL.md");
        expect(existsSync(skill)).toBe(true);
        const jev = join(cwd, dir, "skills", "jev", "SKILL.md");
        expect(existsSync(jev)).toBe(true);
      }
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("opencode thread/start bootstraps project MCP + 7 skills in background", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sax-proj-thread-"));
    try {
      const bridge = new OpencodeBridge({});
      const res = (await bridge.request("thread/start", {
        cwd,
        model: "opencode-go/kimi-k2",
        developerInstructions: "SA-VM DEV",
      })) as unknown as { threadId: string };
      expect(typeof res.threadId).toBe("string");
      const mcpPath = join(cwd, ".codex-ultra", "sa-vm", SA_VM_MCP_SCRIPT_NAME);
      expect(await pollFor(mcpPath)).toBe(true);
      for (const dir of SKILL_DIRS) {
        const skill = join(cwd, dir, "skills", "sa-vm", "SKILL.md");
        expect(await pollFor(skill)).toBe(true);
      }
      // turn-time resolution now prefers the project copy
      const resolved = resolveOpencodeSaVmMcp("SA-VM DEV", cwd, "opencode-go/kimi-k2");
      expect(resolved?.scriptPath).toBe(mcpPath);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("non-opencode-go models bootstrap like every other model (no pass-through)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sax-proj-full-cap-"));
    try {
      const bridge = new OpencodeBridge({});
      const res = (await bridge.request("thread/start", {
        cwd,
        model: "gpt-5.6-terra",
        developerInstructions: "SA-VM DEV",
      })) as unknown as { threadId: string };
      expect(typeof res.threadId).toBe("string");
      const mcpPath = join(cwd, ".codex-ultra", "sa-vm", SA_VM_MCP_SCRIPT_NAME);
      expect(await pollFor(mcpPath)).toBe(true);
      for (const dir of SKILL_DIRS) {
        expect(await pollFor(join(cwd, dir, "skills", "sa-vm", "SKILL.md"))).toBe(true);
      }
      expect(resolveOpencodeSaVmMcp("SA-VM DEV", cwd, "gpt-5.6-terra")?.scriptPath).toBe(mcpPath);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("kill-switch SA_VM_BOOTSTRAP_DISABLED=1 skips project writes (rollback)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sax-proj-kill-"));
    const prev = process.env.SA_VM_BOOTSTRAP_DISABLED;
    process.env.SA_VM_BOOTSTRAP_DISABLED = "1";
    try {
      const { bootstrapProjectSaVmAssets } = await import("../../apps/server/src/saVmWorkspaceSkill.js");
      bootstrapProjectSaVmAssets(cwd, "thread-kill-1");
      await new Promise((r) => setTimeout(r, 300));
      expect(existsSync(join(cwd, ".codex-ultra", "sa-vm", SA_VM_MCP_SCRIPT_NAME))).toBe(false);
      expect(existsSync(join(cwd, ".agents", "skills", "sa-vm", "SKILL.md"))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.SA_VM_BOOTSTRAP_DISABLED;
      else process.env.SA_VM_BOOTSTRAP_DISABLED = prev;
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});
