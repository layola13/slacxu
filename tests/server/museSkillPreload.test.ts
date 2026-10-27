import "../../apps/server/src/pluginHostServices.js"; // register PluginHostServices for the code under test
import { describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveMuseScratchDirs } from "../../backends/muse/src/runtime/museCompatibleProbe.js";
import { loadMuseSaVmSkill } from "../../backends/muse/src/runtime/museSkillPreload.js";
import { buildMuseExecutionPrompt, MuseBridge, type MuseSessionSnapshot } from "../../backends/muse/src/runtime/museBridge.js";
import { MuseCompatibleRuntime, runMuseExecTurn } from "../../backends/muse/src/runtime/museCompatibleRuntime.js";
import {
  bootstrapProjectSaVmAssets,
  syncSaVmWorkspaceSkillDirectory,
  waitForProjectSaVmAssets,
} from "../../apps/server/src/saVmWorkspaceSkill.js";

const skill = (body: string) => `---\nname: sa-vm\ndescription: workspace tools\n---\n${body}\n`;

async function withWorkspace(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "muse-skill-preload-"));
  try { await run(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function save(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

describe("Muse skill preload", () => {
  test("loads the current thread's policy-specific skill before shared copies and maps tool names", async () => {
    await withWorkspace(async (cwd) => {
      const path = join(cwd, ".codex-ultra", "thread-skills", "thread-1", "sa-vm", "SKILL.md");
      await save(path, skill('thread-policy sa_vm_run({"action":"read_lines","path":"a.ts","start_line":1,"end_line":10})'));
      await save(join(cwd, ".agents", "skills", "sa-vm", "SKILL.md"), skill("shared-policy"));
      const loaded = await loadMuseSaVmSkill(cwd, "thread-1");
      expect(loaded.path).toBe(path);
      expect(loaded.content).toContain('mcp__sa_vm__sa_vm_run({"action":"read_lines"');
      expect(loaded.content).not.toContain("shared-policy");
      const prompt = buildMuseExecutionPrompt("current constraints", "inspect a.ts", { preloadedSkill: loaded });
      expect(prompt.startsWith("[User Instruction]\ninspect a.ts")).toBe(true);
      expect(prompt).toContain("[Preloaded Skill: sa-vm]");
      expect(prompt).toContain(loaded.content);
      expect(prompt).toContain("no read_skill call is needed");
      expect(prompt.indexOf("[Preloaded Skill: sa-vm]")).toBeLessThan(prompt.indexOf("[Tool Reference & Constraints]"));
    });
  });

  test("loads a shared skill only when no thread policy is requested and supports CRLF frontmatter", async () => {
    await withWorkspace(async (cwd) => {
      const path = join(cwd, ".agents", "skills", "sa-vm", "SKILL.md");
      await save(path, skill('sa_vm_run({"action":"list_dir","dir":"."})').replace(/\n/g, "\r\n"));
      const loaded = await loadMuseSaVmSkill(cwd);
      expect(loaded.path).toBe(path);
      expect(loaded.content).toContain('mcp__sa_vm__sa_vm_run({"action":"list_dir"');
    });
  });

  test("does not start with missing, malformed or oversized instructions", async () => {
    await withWorkspace(async (cwd) => {
      await expect(loadMuseSaVmSkill(cwd)).rejects.toThrow("skill is missing");
      const path = join(cwd, ".agents", "skills", "sa-vm", "SKILL.md");
      await save(path, "not a skill");
      await expect(loadMuseSaVmSkill(cwd)).rejects.toThrow("skill is malformed");
      await save(path, skill("x".repeat(256 * 1024)));
      await expect(loadMuseSaVmSkill(cwd)).rejects.toThrow("preload limit");
    });
  });

  test("rejects a broken thread skill instead of silently using different shared policy", async () => {
    await withWorkspace(async (cwd) => {
      await save(join(cwd, ".codex-ultra", "thread-skills", "t", "sa-vm", "SKILL.md"), "broken");
      await save(join(cwd, ".agents", "skills", "sa-vm", "SKILL.md"), skill("shared"));
      await expect(loadMuseSaVmSkill(cwd, "t")).rejects.toThrow("skill is malformed");
    });
  });

  test("a missing thread skill cannot fall back to another thread's shared policy", async () => {
    await withWorkspace(async (cwd) => {
      await save(join(cwd, ".agents", "skills", "sa-vm", "SKILL.md"), skill("other-thread-policy"));
      await expect(loadMuseSaVmSkill(cwd, "missing-thread")).rejects.toThrow("skill is missing");
    });
  });

  test("legacy tool prefixes are removed in both preloaded skills and developer instructions", async () => {
    const references = 'functions.sa_vm_run({"action":"list_dir"}) default.mcp__sa_vm__sa_vm_run({"action":"read_lines"})';
    await withWorkspace(async (cwd) => {
      await save(join(cwd, ".agents", "skills", "sa-vm", "SKILL.md"), skill(references));
      const loaded = await loadMuseSaVmSkill(cwd);
      const prompt = buildMuseExecutionPrompt(references, "inspect", { preloadedSkill: loaded });
      expect(loaded.content).toContain('mcp__sa_vm__sa_vm_run({"action":"list_dir"})');
      expect(prompt).not.toMatch(/(?:functions|default)\.mcp__sa_vm__sa_vm_run/);
      expect(prompt).not.toContain("mcp__sa_vm__mcp__sa_vm__");
    });
  });

  test("an old snapshot can explicitly disable VM without loading skills or retaining stale instructions", async () => {
    await withWorkspace(async (cwd) => {
      const oldKey = process.env.META_API_KEY;
      process.env.META_API_KEY = "test-meta-key";
      let snapshot: MuseSessionSnapshot | undefined;
      const bridge = new MuseBridge({ onSnapshot: (value) => { snapshot = value; } });
      const run = spyOn(MuseCompatibleRuntime.prototype, "runExecTurn").mockResolvedValue({
        text: "native-only", completed: true, rawLines: 0,
      });
      try {
        bridge.restoreSession({
          threadId: "old-thread", cwd, developerInstructions: "stale-vm-rule sa_vm_run()",
          turns: [], messages: [],
        });
        const completeTurn = async (params: Record<string, string | boolean>) => {
          const completed = new Promise<void>((resolve) => {
            const listener = (notification: { method: string }) => {
              if (notification.method === "turn/completed" || notification.method === "turn/failed") {
                bridge.off("notification", listener);
                resolve();
              }
            };
            bridge.on("notification", listener);
          });
          await bridge.request("turn/start", { threadId: "old-thread", prompt: "inspect", ...params });
          await completed;
        };
        await completeTurn({ vmEnabled: false });
        expect(snapshot?.developerInstructions).toBeUndefined();
        const restored = snapshot!;
        bridge.deleteSession("old-thread");
        bridge.restoreSession(restored);
        await completeTurn({});
        expect(run).toHaveBeenCalledTimes(2);
        for (const [options] of run.mock.calls) {
          expect(options.saVmMcpScriptPath).toBeUndefined();
          expect(options.prompt).not.toContain("[Preloaded Skill: sa-vm]");
          expect(options.prompt).not.toContain("stale-vm-rule");
        }
      } finally {
        run.mockRestore();
        bridge.stop();
        if (oldKey === undefined) delete process.env.META_API_KEY; else process.env.META_API_KEY = oldKey;
      }
    });
  });

  test("preload waits for fire-and-forget policy updates, including serialized cleanup", async () => {
    await withWorkspace(async (cwd) => {
      const first = syncSaVmWorkspaceSkillDirectory({ cwd, threadId: "t", enabled: true });
      await waitForProjectSaVmAssets(cwd);
      expect((await loadMuseSaVmSkill(cwd, "t")).path).toContain("thread-skills");
      await first;

      const rewrite = syncSaVmWorkspaceSkillDirectory({ cwd, threadId: "t", enabled: true });
      const disable = syncSaVmWorkspaceSkillDirectory({ cwd, threadId: "t", enabled: false });
      await waitForProjectSaVmAssets(cwd);
      await expect(loadMuseSaVmSkill(cwd, "t")).rejects.toThrow("skill is missing");
      await Promise.all([rewrite, disable]);
    });
  });

  test("bootstrap preserves existing thread policy instead of overwriting with defaults", async () => {
    await withWorkspace(async (cwd) => {
      const old = process.env.SA_VM_BOOTSTRAP_DISABLED;
      delete process.env.SA_VM_BOOTSTRAP_DISABLED;
      try {
        const path = join(cwd, ".codex-ultra", "thread-skills", "t", "sa-vm", "SKILL.md");
        const original = skill("restricted-thread-policy");
        await save(path, original);
        bootstrapProjectSaVmAssets(cwd, "t");
        await waitForProjectSaVmAssets(cwd);
        expect(await readFile(path, "utf8")).toBe(original);
      } finally {
        if (old === undefined) delete process.env.SA_VM_BOOTSTRAP_DISABLED; else process.env.SA_VM_BOOTSTRAP_DISABLED = old;
      }
    });
  });

  test("bootstrap and preload share a barrier for equivalent workspace paths", async () => {
    await withWorkspace(async (cwd) => {
      const old = process.env.SA_VM_BOOTSTRAP_DISABLED;
      delete process.env.SA_VM_BOOTSTRAP_DISABLED;
      try {
        bootstrapProjectSaVmAssets(`${cwd}/.`, "t");
        await waitForProjectSaVmAssets(cwd);
        expect((await loadMuseSaVmSkill(cwd, "t")).path).toContain("thread-skills");
      } finally {
        if (old === undefined) delete process.env.SA_VM_BOOTSTRAP_DISABLED; else process.env.SA_VM_BOOTSTRAP_DISABLED = old;
      }
    });
  });

  test("bootstrap cannot recreate skills after a concurrent policy disable", async () => {
    await withWorkspace(async (cwd) => {
      const old = process.env.SA_VM_BOOTSTRAP_DISABLED;
      delete process.env.SA_VM_BOOTSTRAP_DISABLED;
      try {
        bootstrapProjectSaVmAssets(cwd, "t");
        const disable = syncSaVmWorkspaceSkillDirectory({ cwd, threadId: "t", enabled: false });
        await waitForProjectSaVmAssets(cwd);
        await disable;
        await expect(loadMuseSaVmSkill(cwd, "t")).rejects.toThrow("skill is missing");
      } finally {
        if (old === undefined) delete process.env.SA_VM_BOOTSTRAP_DISABLED; else process.env.SA_VM_BOOTSTRAP_DISABLED = old;
      }
    });
  });

  test.skipIf(process.platform !== "win32")("Windows case aliases share disable protection and preload barriers", async () => {
    await withWorkspace(async (cwd) => {
      const alias = cwd.toUpperCase();
      const old = process.env.SA_VM_BOOTSTRAP_DISABLED;
      delete process.env.SA_VM_BOOTSTRAP_DISABLED;
      try {
        await syncSaVmWorkspaceSkillDirectory({ cwd, threadId: "t", enabled: false });
        bootstrapProjectSaVmAssets(alias, "t");
        await waitForProjectSaVmAssets(alias);
        await expect(loadMuseSaVmSkill(cwd, "t")).rejects.toThrow("skill is missing");

        const rewrite = syncSaVmWorkspaceSkillDirectory({ cwd: alias, threadId: "t", enabled: true });
        await waitForProjectSaVmAssets(cwd);
        expect((await loadMuseSaVmSkill(cwd, "t")).path).toContain("thread-skills");
        await rewrite;
      } finally {
        if (old === undefined) delete process.env.SA_VM_BOOTSTRAP_DISABLED; else process.env.SA_VM_BOOTSTRAP_DISABLED = old;
      }
    });
  });

  test("preload remembers a completed policy sync failure until a successful rewrite", async () => {
    await withWorkspace(async (cwd) => {
      const path = join(cwd, ".codex-ultra", "thread-skills", "t", "sa-vm", "SKILL.md");
      await save(path, skill("stale-policy"));
      const blocker = join(cwd, ".mini-agent", "skills");
      await save(blocker, "blocks skill directory creation");
      await expect(syncSaVmWorkspaceSkillDirectory({ cwd, threadId: "t", enabled: true })).rejects.toThrow();
      // The failed job has settled and left the in-flight queue; stale files remain.
      expect((await loadMuseSaVmSkill(cwd, "t")).content).toContain("stale-policy");
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(waitForProjectSaVmAssets(cwd)).rejects.toThrow();
      }
      await rm(blocker);
      await syncSaVmWorkspaceSkillDirectory({ cwd, threadId: "t", enabled: true });
      await waitForProjectSaVmAssets(cwd);
      expect((await loadMuseSaVmSkill(cwd, "t")).content).not.toContain("stale-policy");
    });
  });

  test("does not advertise unavailable MCP tools for native-only turns", () => {
    const prompt = buildMuseExecutionPrompt(undefined, "inspect", {
      saVmEnabled: false,
      preloadedSkill: { path: "unused", content: "mcp__sa_vm__sa_vm_run" },
    });
    expect(prompt).not.toContain("mcp__sa_vm__sa_vm_run");
    expect(prompt).not.toContain("[Preloaded Skill:");
    expect(prompt).toContain("No sa-vm MCP server is attached");
  });

  test("instructs bounded large-file reads instead of repeating a rejected read", () => {
    const prompt = buildMuseExecutionPrompt(undefined, "inspect");
    expect(prompt).toContain("Never retry the same rejected whole-file read");
    expect(prompt).toContain("`start_line`/`end_line`");
    expect(prompt).toContain("Do not invent `default.` or `functions.` prefixes");
  });

  for (const failure of ["missing MCP script", "unwritable MCP settings"]) {
    test(`runtime refuses to spawn with ${failure} and cleans its prompt file`, async () => {
      await withWorkspace(async (cwd) => {
        const scratchRoot = join(cwd, "scratch");
        const scratch = resolveMuseScratchDirs("config-failure", { ...process.env, MUSE_SCRATCH_DIR: scratchRoot });
        const script = join(cwd, "sa-vm-mcp.mjs");
        if (failure === "unwritable MCP settings") {
          await save(script, "// test bundle");
          await save(scratch.configDir, "blocks directory creation");
        }
        let spawned = false;
        const result = await runMuseExecTurn({
          prompt: "preloaded tool instructions",
          cwd,
          threadId: "config-failure",
          saVmMcpScriptPath: script,
          env: { ...process.env, MUSE_BIN: process.execPath, MUSE_SCRATCH_DIR: scratchRoot },
          onSpawn: () => { spawned = true; },
        });
        expect(result.completed).toBe(false);
        expect(result.error).toContain("MCP configuration failed");
        expect(result.rawLines).toBe(0);
        expect(spawned).toBe(false);
        const promptFiles = existsSync(scratch.promptsDir) ? await readdir(scratch.promptsDir) : [];
        expect(promptFiles).toEqual([]);
      });
    });
  }

  test("bridge blocks an unloaded skill, then supplies the loaded skill before CLI execution", async () => {
    await withWorkspace(async (cwd) => {
      const old = {
        bin: process.env.MUSE_BIN,
        key: process.env.META_API_KEY,
        bootstrap: process.env.SA_VM_BOOTSTRAP_DISABLED,
      };
      const bridge = new MuseBridge();
      try {
        process.env.SA_VM_BOOTSTRAP_DISABLED = "1";
        process.env.META_API_KEY = "test-meta-key";
        const captured = join(cwd, "captured-prompt.txt");
        const script = join(cwd, "muse-stub.mjs");
        await save(script, `
          import { readFileSync, writeFileSync } from 'node:fs';
          import { join } from 'node:path';
          const args = process.argv.slice(2);
          const settings = JSON.parse(readFileSync(join(process.env.XDG_CONFIG_HOME, 'muse', 'settings.json'), 'utf8'));
          if (!settings.mcpServers['sa-vm']) throw new Error('required MCP config not attached');
          writeFileSync(${JSON.stringify(captured)}, readFileSync(args[args.indexOf('--prompt-file') + 1], 'utf8'));
          console.log(JSON.stringify({ payload_type: 'run.output.delta', payload: { text: 'ok' } }));
          console.log(JSON.stringify({ payload_type: 'run.terminal.completed', payload: { status: 'completed' } }));
        `);
        const stub = join(cwd, process.platform === "win32" ? "muse-stub.cmd" : "muse-stub.sh");
        await save(stub, process.platform === "win32"
          ? `@node "${script}" %*\r\n`
          : `#!/bin/sh\nnode "${script}" "$@"\n`);
        if (process.platform !== "win32") await chmod(stub, 0o755);
        process.env.MUSE_BIN = stub;
        await save(join(cwd, ".codex-ultra", "sa-vm", "sa-vm-mcp.mjs"), "// test MCP bundle");
        const result = await bridge.request("thread/start", { cwd }) as { threadId: string };
        await expect(bridge.request("turn/start", { threadId: result.threadId, prompt: "inspect", vmEnabled: true }))
          .rejects.toThrow("skill is missing");
        await expect(readFile(captured, "utf8")).rejects.toThrow();

        await save(join(cwd, ".codex-ultra", "thread-skills", result.threadId, "sa-vm", "SKILL.md"), skill('preload-marker sa_vm_run({"action":"list_dir","dir":"."})'));
        const completed = new Promise<string>((resolve) => {
          bridge.on("notification", (notification: { method: string }) => {
            if (notification.method === "turn/completed" || notification.method === "turn/failed") resolve(notification.method);
          });
        });
        await bridge.request("turn/start", { threadId: result.threadId, prompt: "inspect", vmEnabled: true });
        expect(await completed).toBe("turn/completed");
        const prompt = await readFile(captured, "utf8");
        expect(prompt).toContain("[Preloaded Skill: sa-vm]");
        expect(prompt).toContain('preload-marker mcp__sa_vm__sa_vm_run({"action":"list_dir","dir":"."})');
      } finally {
        bridge.stop();
        if (old.bin === undefined) delete process.env.MUSE_BIN; else process.env.MUSE_BIN = old.bin;
        if (old.key === undefined) delete process.env.META_API_KEY; else process.env.META_API_KEY = old.key;
        if (old.bootstrap === undefined) delete process.env.SA_VM_BOOTSTRAP_DISABLED; else process.env.SA_VM_BOOTSTRAP_DISABLED = old.bootstrap;
      }
    });
  }, 15000);
});
