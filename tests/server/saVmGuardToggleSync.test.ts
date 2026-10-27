import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SA_VM_CHEATSHEET_FILE_NAME,
  SA_VM_WORKSPACE_SKILL_NAME,
  forceUpdateWorkspaceSkill,
  syncSaVmWorkspaceSkillDirectory
} from "../../apps/server/src/saVmWorkspaceSkill";

test("guard open (enabled: true) writes skills to .codex, .claude, .gemini, and .agents in workspace", async () => {
  const ws = await mkdtemp(join(tmpdir(), "ws-open-"));
  try {
    const res = await syncSaVmWorkspaceSkillDirectory({
      cwd: ws,
      threadId: "test-thread-open",
      enabled: true
    });

    expect(res.enabled).toBe(true);
    expect(res.path).toBeTruthy();

    const codexSkillPath = join(ws, ".codex", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
    const claudeSkillPath = join(ws, ".claude", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
    const geminiSkillPath = join(ws, ".gemini", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
    const agentsSkillPath = join(ws, ".agents", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");

    expect(existsSync(codexSkillPath)).toBe(true);
    expect(existsSync(claudeSkillPath)).toBe(true);
    expect(existsSync(geminiSkillPath)).toBe(true);
    expect(existsSync(agentsSkillPath)).toBe(true);

    const codexText = await readFile(codexSkillPath, "utf8");
    const claudeText = await readFile(claudeSkillPath, "utf8");
    const geminiText = await readFile(geminiSkillPath, "utf8");
    const agentsText = await readFile(agentsSkillPath, "utf8");

    expect(codexText).toBe(claudeText);
    expect(geminiText).toBe(claudeText);
    expect(agentsText).toContain("mcp__sa_vm__sa_vm_run");
    expect(codexText).toContain("`sa_vm_run`");
    expect(codexText).toContain("【安全守护状态：已开启】");
    expect(codexText).toContain("严禁手写脚本代码");

    expect(codexText).toContain("action\": \"find_files");
    expect(codexText).toContain("action\": \"read_file");
    expect(codexText).toContain("action\": \"read_lines");
    expect(codexText).toContain("action\": \"write_file");
    expect(codexText).not.toContain("action\": \"run_js");
    expect(codexText).not.toContain("action\": \"run_py");

    expect(codexText).toContain("双轨执行路由与 bun+TS 编程规范");
    expect(codexText).toContain("export async function main(): Promise<number>");
    expect(codexText).toContain("Bun.file");
    expect(codexText).not.toContain('@import "sa_std/');
    expect(codexText).not.toContain("dist/index.html");

    // When explicitly enabled via policy, they appear
    await syncSaVmWorkspaceSkillDirectory({
      cwd: ws,
      threadId: "test-thread-open",
      enabled: true,
      policy: { execution: { javascript: true, python: true } }
    });
    const updatedText = await readFile(codexSkillPath, "utf8");
    expect(updatedText).toContain("action\": \"run_js");
    expect(updatedText).toContain("action\": \"run_py");
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test("guard close (enabled: false) deletes skills from .codex, .claude, .gemini, and .agents in workspace", async () => {
  const ws = await mkdtemp(join(tmpdir(), "ws-close-"));
  try {
    // First create skills
    await syncSaVmWorkspaceSkillDirectory({
      cwd: ws,
      threadId: "test-thread-close",
      enabled: true
    });
    const codexSkillPath = join(ws, ".codex", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
    const claudeSkillPath = join(ws, ".claude", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
    const geminiSkillPath = join(ws, ".gemini", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
    const agentsSkillPath = join(ws, ".agents", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
    expect(existsSync(codexSkillPath)).toBe(true);
    expect(existsSync(claudeSkillPath)).toBe(true);
    expect(existsSync(geminiSkillPath)).toBe(true);
    expect(existsSync(agentsSkillPath)).toBe(true);

    // Then close guard
    const res = await syncSaVmWorkspaceSkillDirectory({
      cwd: ws,
      threadId: "test-thread-close",
      enabled: false
    });

    expect(res.enabled).toBe(false);
    expect(res.path).toBeNull();
    expect(existsSync(codexSkillPath)).toBe(false);
    expect(existsSync(claudeSkillPath)).toBe(false);
    expect(existsSync(geminiSkillPath)).toBe(false);
    expect(existsSync(agentsSkillPath)).toBe(false);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test("toggling guard open -> close -> open repeatedly updates across all engines", async () => {
  const ws = await mkdtemp(join(tmpdir(), "ws-toggle-"));
  try {
    const codexSkill = join(ws, ".codex", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
    const claudeSkill = join(ws, ".claude", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
    const geminiSkill = join(ws, ".gemini", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");
    const agentsSkill = join(ws, ".agents", "skills", SA_VM_WORKSPACE_SKILL_NAME, "SKILL.md");

    await syncSaVmWorkspaceSkillDirectory({ cwd: ws, enabled: true });
    expect(existsSync(codexSkill)).toBe(true);
    expect(existsSync(claudeSkill)).toBe(true);
    expect(existsSync(geminiSkill)).toBe(true);
    expect(existsSync(agentsSkill)).toBe(true);
    expect(await readFile(codexSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(claudeSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(geminiSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(agentsSkill, "utf8")).toContain("【安全守护状态：已开启】");

    await syncSaVmWorkspaceSkillDirectory({ cwd: ws, enabled: false });
    expect(existsSync(codexSkill)).toBe(false);
    expect(existsSync(claudeSkill)).toBe(false);
    expect(existsSync(geminiSkill)).toBe(false);
    expect(existsSync(agentsSkill)).toBe(false);

    await syncSaVmWorkspaceSkillDirectory({ cwd: ws, enabled: true });
    expect(existsSync(codexSkill)).toBe(true);
    expect(existsSync(claudeSkill)).toBe(true);
    expect(existsSync(geminiSkill)).toBe(true);
    expect(existsSync(agentsSkill)).toBe(true);
    expect(await readFile(codexSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(claudeSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(geminiSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(agentsSkill, "utf8")).toContain("【安全守护状态：已开启】");

    await syncSaVmWorkspaceSkillDirectory({ cwd: ws, enabled: false });
    expect(existsSync(codexSkill)).toBe(false);
    expect(existsSync(claudeSkill)).toBe(false);
    expect(existsSync(geminiSkill)).toBe(false);
    expect(existsSync(agentsSkill)).toBe(false);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test("forceUpdateWorkspaceSkill cleans legacy cheatsheet files while writing skills", async () => {
  const ws = await mkdtemp(join(tmpdir(), "ws-clean-"));
  try {
    const codexDir = join(ws, ".codex", "skills", SA_VM_WORKSPACE_SKILL_NAME);
    const claudeDir = join(ws, ".claude", "skills", SA_VM_WORKSPACE_SKILL_NAME);
    const geminiDir = join(ws, ".gemini", "skills", SA_VM_WORKSPACE_SKILL_NAME);
    const agentsDir = join(ws, ".agents", "skills", SA_VM_WORKSPACE_SKILL_NAME);
    await mkdir(codexDir, { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    await mkdir(geminiDir, { recursive: true });
    await mkdir(agentsDir, { recursive: true });

    const codexCheatsheet = join(codexDir, SA_VM_CHEATSHEET_FILE_NAME);
    const claudeCheatsheet = join(claudeDir, SA_VM_CHEATSHEET_FILE_NAME);
    const geminiCheatsheet = join(geminiDir, SA_VM_CHEATSHEET_FILE_NAME);
    const agentsCheatsheet = join(agentsDir, SA_VM_CHEATSHEET_FILE_NAME);
    await writeFile(codexCheatsheet, "# Old SLA Cheat", "utf8");
    await writeFile(claudeCheatsheet, "# Old SLA Cheat", "utf8");
    await writeFile(geminiCheatsheet, "# Old SLA Cheat", "utf8");
    await writeFile(agentsCheatsheet, "# Old SLA Cheat", "utf8");

    expect(existsSync(codexCheatsheet)).toBe(true);
    expect(existsSync(claudeCheatsheet)).toBe(true);
    expect(existsSync(geminiCheatsheet)).toBe(true);
    expect(existsSync(agentsCheatsheet)).toBe(true);

    await forceUpdateWorkspaceSkill(ws, null, true);

    expect(existsSync(codexCheatsheet)).toBe(false);
    expect(existsSync(claudeCheatsheet)).toBe(false);
    expect(existsSync(geminiCheatsheet)).toBe(false);
    expect(existsSync(agentsCheatsheet)).toBe(false);
    expect(existsSync(join(codexDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(claudeDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(geminiDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(agentsDir, "SKILL.md"))).toBe(true);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});
