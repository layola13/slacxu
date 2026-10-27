import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  SA_VM_CHEATSHEET_FILE_NAME,
  SA_VM_WORKSPACE_SKILL_MARKER,
  MUSE_SA_VM_MCP_TOOL_NAME,
  buildSaVmBunTsCheatsheetMarkdown,
  buildSaVmWorkspaceSkillMarkdown,
  isGeneratedSaVmWorkspaceSkill,
  syncSaVmWorkspaceSkillDirectory,
  workspaceSaVmSkillPath
} from "../../apps/server/src/saVmWorkspaceSkill";

test("builds a workspace skill with packaged action tools and forbids raw hand-written scripts", () => {
  const markdown = buildSaVmWorkspaceSkillMarkdown({ cwd: "E:/projects/demo", salaRoot: "E:/installed/Sala" });
  expect(markdown).toContain(SA_VM_WORKSPACE_SKILL_MARKER);
  expect(markdown).toContain("封装函数工具使用指南");
  expect(markdown).not.toContain('sa_vm_run(language: "sla")');
  expect(markdown).toContain("双轨执行路由与 bun+TS 编程规范");
  expect(markdown).not.toContain('@import "sa_std/');
  expect(markdown).not.toContain("fn main() -> i32");
  expect(markdown).not.toContain("dist/index.html");
  expect(markdown).toContain("apply_patch");
  expect(markdown).toContain("read_file");
  expect(markdown).toContain("read_file_tail");
  expect(markdown).toContain("write_file");
  expect(markdown).toContain("find_files");
  expect(markdown).toContain("delete_file");
  expect(markdown).toContain("list_dir");
  expect(markdown).toContain("grep_search");
  expect(markdown).toContain("grep_search_async");
  expect(markdown).toContain("Use when inspecting, reading, writing, editing, patching, tail-reading logs, or searching files and code in the workspace.");
});

test("resolves the skill inside the selected workspace", () => {
  const resolved = workspaceSaVmSkillPath("E:/projects/demo").replaceAll("\\", "/");
  expect(resolved).toBe("E:/projects/demo/.agents/skills/sa-vm/SKILL.md");
  const threadSkill = workspaceSaVmSkillPath("E:/projects/demo", "thread:one").replaceAll("\\", "/");
  expect(threadSkill).toBe("E:/projects/demo/.codex-ultra/thread-skills/thread_one/sa-vm/SKILL.md");
  const claudeSkill = workspaceSaVmSkillPath("E:/projects/demo", undefined, "claude").replaceAll("\\", "/");
  expect(claudeSkill).toBe("E:/projects/demo/.claude/skills/sa-vm/SKILL.md");
  const agySkill = workspaceSaVmSkillPath("E:/projects/demo", undefined, "agy").replaceAll("\\", "/");
  expect(agySkill).toBe("E:/projects/demo/.gemini/skills/sa-vm/SKILL.md");
  const codexSkill = workspaceSaVmSkillPath("E:/projects/demo", undefined, "codex").replaceAll("\\", "/");
  expect(codexSkill).toBe("E:/projects/demo/.codex/skills/sa-vm/SKILL.md");
  const miniSkill = workspaceSaVmSkillPath("E:/projects/demo", undefined, "mini").replaceAll("\\", "/");
  expect(miniSkill).toBe("E:/projects/demo/.mini-agent/skills/sa-vm/SKILL.md");
});

test("only generated skills are eligible for automatic deletion", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-sa-vm-skill-"));
  try {
    const path = workspaceSaVmSkillPath(root);
    await writeFile(path, buildSaVmWorkspaceSkillMarkdown(), "utf8").catch(async () => {
      const directory = join(root, ".agents", "skills", "sa-vm");
      await (await import("node:fs/promises")).mkdir(directory, { recursive: true });
      await writeFile(path, buildSaVmWorkspaceSkillMarkdown(), "utf8");
    });
    expect(await isGeneratedSaVmWorkspaceSkill(path)).toBe(true);
    await writeFile(path, "---\nname: sa-vm\n---\nUser-owned instructions\n", "utf8");
    expect(await isGeneratedSaVmWorkspaceSkill(path)).toBe(false);
    expect(await readFile(path, "utf8")).toContain("User-owned instructions");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("builds packaged tools cheatsheet markdown", () => {
  const cheatsheet = buildSaVmBunTsCheatsheetMarkdown();
  expect(cheatsheet).toContain("# Codex Ultra 封装函数工具速查");
  expect(cheatsheet).toContain("只用封装动作，不手写脚本源码");
  expect(cheatsheet).toContain("apply_patch");
  expect(cheatsheet).toContain("find_files");
  expect(cheatsheet).toContain("read_file");
  expect(cheatsheet).toContain("read_file_tail");
  expect(cheatsheet).toContain("write_file");
  expect(cheatsheet).toContain("edit_file");
  expect(cheatsheet).toContain("list_dir");
  expect(cheatsheet).toContain("grep_search");
  expect(cheatsheet).toContain("grep_search_async");
  expect(cheatsheet).toContain("delete_file");
  expect(cheatsheet).not.toContain("sa_fs_read_lines_to_stdout");
  expect(cheatsheet).not.toContain("@import");
});

test("writes sa-vm skills to .codex, .claude, .gemini, and .agents upon opening guard (enabled: true)", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-sa-vm-open-"));
  try {
    const result = await syncSaVmWorkspaceSkillDirectory({
      cwd: root,
      threadId: "thread-open-test",
      enabled: true
    });

    expect(result.enabled).toBe(true);
    expect(result.path).toBeTruthy();

    const codexSkill = join(root, ".codex", "skills", "sa-vm", "SKILL.md");
    const claudeSkill = join(root, ".claude", "skills", "sa-vm", "SKILL.md");
    const geminiSkill = join(root, ".gemini", "skills", "sa-vm", "SKILL.md");
    const grokSkill = join(root, ".grok", "skills", "sa-vm", "SKILL.md");
    const opencodeSkill = join(root, ".opencode", "skills", "sa-vm", "SKILL.md");
    const piSkill = join(root, ".pi", "skills", "sa-vm", "SKILL.md");
    const agentsSkill = join(root, ".agents", "skills", "sa-vm", "SKILL.md");
    expect(existsSync(codexSkill)).toBe(true);
    expect(existsSync(claudeSkill)).toBe(true);
    expect(existsSync(geminiSkill)).toBe(true);
    expect(existsSync(grokSkill)).toBe(true);
    expect(existsSync(opencodeSkill)).toBe(true);
    expect(existsSync(piSkill)).toBe(true);
    expect(existsSync(agentsSkill)).toBe(true);

    const codexContent = await readFile(codexSkill, "utf8");
    const claudeContent = await readFile(claudeSkill, "utf8");
    const geminiContent = await readFile(geminiSkill, "utf8");
    const agentsContent = await readFile(agentsSkill, "utf8");

    expect(codexContent).toContain("双轨执行路由与 bun+TS 编程规范");
    expect(codexContent).not.toContain('@import "sa_std/');
    expect(codexContent).not.toContain("dist/index.html");
    expect(codexContent).toContain("action\": \"find_files");
    expect(codexContent).toContain("action\": \"read_file");
    expect(codexContent).toContain("action\": \"read_file_tail");
    expect(codexContent).toContain("action\": \"read_lines");
    expect(codexContent).toContain("action\": \"grep_search_async");
    expect(codexContent).toContain("action\": \"write_file");
    expect(codexContent).toContain("action\": \"edit_file");

    expect(claudeContent).toBe(codexContent);
    expect(geminiContent).toBe(codexContent);
    expect(agentsContent).toContain(MUSE_SA_VM_MCP_TOOL_NAME);
    const opencodeContent = await readFile(opencodeSkill, "utf8");
    const piContent = await readFile(piSkill, "utf8");
    expect(opencodeContent).toBe(codexContent);
    expect(piContent).toBe(codexContent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deletes sa-vm skills from .codex, .claude, .gemini, and .agents upon closing guard (enabled: false)", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-sa-vm-close-"));
  try {
    // First enable to create them
    await syncSaVmWorkspaceSkillDirectory({
      cwd: root,
      threadId: "thread-close-test",
      enabled: true
    });
    const codexSkill = join(root, ".codex", "skills", "sa-vm", "SKILL.md");
    const claudeSkill = join(root, ".claude", "skills", "sa-vm", "SKILL.md");
    const geminiSkill = join(root, ".gemini", "skills", "sa-vm", "SKILL.md");
    const grokSkill = join(root, ".grok", "skills", "sa-vm", "SKILL.md");
    const opencodeSkill = join(root, ".opencode", "skills", "sa-vm", "SKILL.md");
    const piSkill = join(root, ".pi", "skills", "sa-vm", "SKILL.md");
    const agentsSkill = join(root, ".agents", "skills", "sa-vm", "SKILL.md");
    expect(existsSync(codexSkill)).toBe(true);
    expect(existsSync(claudeSkill)).toBe(true);
    expect(existsSync(geminiSkill)).toBe(true);
    expect(existsSync(grokSkill)).toBe(true);
    expect(existsSync(opencodeSkill)).toBe(true);
    expect(existsSync(piSkill)).toBe(true);
    expect(existsSync(agentsSkill)).toBe(true);

    // Now close guard: must delete them!
    const result = await syncSaVmWorkspaceSkillDirectory({
      cwd: root,
      threadId: "thread-close-test",
      enabled: false
    });

    expect(result.enabled).toBe(false);
    expect(result.path).toBeNull();
    expect(existsSync(codexSkill)).toBe(false);
    expect(existsSync(claudeSkill)).toBe(false);
    expect(existsSync(geminiSkill)).toBe(false);
    expect(existsSync(grokSkill)).toBe(false);
    expect(existsSync(opencodeSkill)).toBe(false);
    expect(existsSync(piSkill)).toBe(false);
    expect(existsSync(agentsSkill)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("toggling between open and close guard states immediately creates on open and removes on close across all engines", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-sa-vm-toggle-"));
  try {
    const codexSkill = join(root, ".codex", "skills", "sa-vm", "SKILL.md");
    const claudeSkill = join(root, ".claude", "skills", "sa-vm", "SKILL.md");
    const geminiSkill = join(root, ".gemini", "skills", "sa-vm", "SKILL.md");
    const agentsSkill = join(root, ".agents", "skills", "sa-vm", "SKILL.md");

    // Step 1: Open guard -> skills created
    await syncSaVmWorkspaceSkillDirectory({ cwd: root, enabled: true });
    expect(existsSync(codexSkill)).toBe(true);
    expect(existsSync(claudeSkill)).toBe(true);
    expect(existsSync(geminiSkill)).toBe(true);
    expect(existsSync(agentsSkill)).toBe(true);
    expect(await readFile(codexSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(claudeSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(geminiSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(agentsSkill, "utf8")).toContain("【安全守护状态：已开启】");

    // Step 2: Close guard -> skills removed
    await syncSaVmWorkspaceSkillDirectory({ cwd: root, enabled: false });
    expect(existsSync(codexSkill)).toBe(false);
    expect(existsSync(claudeSkill)).toBe(false);
    expect(existsSync(geminiSkill)).toBe(false);
    expect(existsSync(agentsSkill)).toBe(false);

    // Step 3: Open guard again -> skills recreated
    await syncSaVmWorkspaceSkillDirectory({ cwd: root, enabled: true });
    expect(existsSync(codexSkill)).toBe(true);
    expect(existsSync(claudeSkill)).toBe(true);
    expect(existsSync(geminiSkill)).toBe(true);
    expect(existsSync(agentsSkill)).toBe(true);
    expect(await readFile(codexSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(claudeSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(geminiSkill, "utf8")).toContain("【安全守护状态：已开启】");
    expect(await readFile(agentsSkill, "utf8")).toContain("【安全守护状态：已开启】");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("forceUpdateWorkspaceSkill removes any stale legacy cheatsheet files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-sa-vm-cheatsheet-"));
  try {
    const codexDir = join(root, ".codex", "skills", "sa-vm");
    const agentsDir = join(root, ".agents", "skills", "sa-vm");
    await mkdir(codexDir, { recursive: true });
    await mkdir(agentsDir, { recursive: true });

    const codexCheatsheet = join(codexDir, SA_VM_CHEATSHEET_FILE_NAME);
    const agentsCheatsheet = join(agentsDir, SA_VM_CHEATSHEET_FILE_NAME);
    await writeFile(codexCheatsheet, "legacy cheatsheet", "utf8");
    await writeFile(agentsCheatsheet, "legacy cheatsheet", "utf8");

    expect(existsSync(codexCheatsheet)).toBe(true);
    expect(existsSync(agentsCheatsheet)).toBe(true);

    await syncSaVmWorkspaceSkillDirectory({ cwd: root, enabled: true });

    expect(existsSync(codexCheatsheet)).toBe(false);
    expect(existsSync(agentsCheatsheet)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dynamically conditions skill generation on policy toggles", () => {
  // Scenario 1: User disables replaceRead, replaceWrite, replaceApplyPatch, clearToolHistory
  const skillNoReadWrite = buildSaVmWorkspaceSkillMarkdown({
    policy: {
      tools: {
        replaceRead: false,
        replaceWrite: false,
        replaceApplyPatch: false,
        replaceExec: false,
        clearToolHistory: false,
        findReferences: false
      },
      execution: {
        javascript: false,
        python: false
      }
    }
  });
  expect(skillNoReadWrite).not.toContain("### 1. 多文件结构化补丁应用 (apply_patch)");
  expect(skillNoReadWrite).not.toContain("### 1. 读取文件内容与动态上下文防溢出 (read_file)");
  expect(skillNoReadWrite).not.toContain("### 2. 精确局部替换文件内容 (edit_file)");
  expect(skillNoReadWrite).not.toContain("### 3. 写入或创建文件 (write_file)");
  expect(skillNoReadWrite).not.toContain("run_js");
  expect(skillNoReadWrite).not.toContain("run_py");
  expect(skillNoReadWrite).not.toContain("clear_tool_history");
  expect(skillNoReadWrite).not.toContain("查找符号所有引用与定向探索 (find_references)");
  // Search tools remain available
  expect(skillNoReadWrite).toContain("find_files");
  expect(skillNoReadWrite).toContain("grep_search_async");

  // Scenario 2: User explicitly enables clearToolHistory, findReferences, replaceRead, and JS
  const skillWithPruneAndRead = buildSaVmWorkspaceSkillMarkdown({
    policy: {
      tools: {
        replaceRead: true,
        replaceWrite: false,
        replaceApplyPatch: true,
        replaceExec: true,
        clearToolHistory: true,
        findReferences: true
      },
      execution: {
        javascript: true,
        python: false
      }
    }
  });
  expect(skillWithPruneAndRead).toContain("apply_patch");
  expect(skillWithPruneAndRead).toContain("read_file");
  expect(skillWithPruneAndRead).toContain("run_js");
  expect(skillWithPruneAndRead).toContain("clear_tool_history");
  expect(skillWithPruneAndRead).toContain("find_references");
  expect(skillWithPruneAndRead).toContain("e0");
  expect(skillWithPruneAndRead).toContain("e1");
  expect(skillWithPruneAndRead).toContain("e2");
  expect(skillWithPruneAndRead).toContain("candidate_files");
  expect(skillWithPruneAndRead).toContain("宿主终端管控");
  expect(skillWithPruneAndRead).not.toContain('"action": "write_file"');
  expect(skillWithPruneAndRead).not.toContain('"action": "edit_file"');
  expect(skillWithPruneAndRead).not.toContain('"action": "run_py"');

  // Scenario 3: Default build with no policy explicitly passed must omit run_py and run_js actions
  const defaultSkill = buildSaVmWorkspaceSkillMarkdown({ enabled: true });
  expect(defaultSkill).not.toContain('"action": "run_py"');
  expect(defaultSkill).not.toContain('"action": "run_js"');
  expect(defaultSkill).toContain("find_files");
  expect(defaultSkill).toContain("apply_patch");
  expect(defaultSkill).toContain('"action": "find_definition"');
  expect(defaultSkill).toContain('"action": "find_references"');
  expect(defaultSkill).toContain('"action": "file_outline"');
});

test("workspace skill generator and synced output contain key batch routing and parallel guidance", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-sa-vm-batch-guide-"));
  try {
    const result = await syncSaVmWorkspaceSkillDirectory({
      cwd: root,
      threadId: "thread-guide-test",
      enabled: true
    });
    expect(result.enabled).toBe(true);
    expect(result.path).toBeTruthy();

    const codexSkill = join(root, ".codex", "skills", "sa-vm", "SKILL.md");
    const agentsSkill = join(root, ".agents", "skills", "sa-vm", "SKILL.md");
    expect(existsSync(codexSkill)).toBe(true);
    expect(existsSync(agentsSkill)).toBe(true);

    const generated = buildSaVmWorkspaceSkillMarkdown({ cwd: root, enabled: true });
    const codexContent = await readFile(codexSkill, "utf8");
    const agentsContent = await readFile(agentsSkill, "utf8");

    // .agents uses MCP mapping mcp__sa_vm__sa_vm_run for Muse compatibility, while .codex uses native sa_vm_run
    expect(agentsContent).toContain(MUSE_SA_VM_MCP_TOOL_NAME);
    expect(codexContent).toContain("sa_vm_run");

    // Hermetic: asserts both the pure generator output and the filesystem-synced output
    for (const content of [generated, codexContent, agentsContent]) {
      expect(content).toContain("纯内容写入多文件（如多语言翻译、批量配置更新、大文本替换）属于内容搬运而非计算，严禁手写 TS，必须使用顶层 `parallel` 批处理动作");
      expect(content).toContain("bun+TS 心智迁移对照");
      expect(content).toContain("优先用于多文件内容写入");
      expect(content).toContain("代码体积软上限与大文本不进 source");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("JEV active decision helper is opt-in and off by default", () => {
  const off = buildSaVmWorkspaceSkillMarkdown({ cwd: "E:/projects/demo", enabled: true });
  expect(off).not.toContain("jev_choose");
  expect(off).not.toContain("jev_checklist");
  const offDescription = off.split("\n").find((line) => line.startsWith("description:")) ?? "";
  expect(offDescription).not.toContain("jev_");
  const on = buildSaVmWorkspaceSkillMarkdown({ cwd: "E:/projects/demo", enabled: true, jevActiveTools: true });
  expect(on).toContain("jev_choose");
  expect(on).toContain("jev_checklist");
  expect(on).toContain("advisory only");
  // OpenCode loads a skill by name+description relevance, so the frontmatter
  // must advertise JEV whenever the JEV section is rendered.
  const onDescription = on.split("\n").find((line) => line.startsWith("description:")) ?? "";
  expect(onDescription).toContain("jev_choose");
  expect(onDescription).toContain("jev_blast_radius");
});

test("sync writes JEV active section to all backends when jevActiveTools is true", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-sa-vm-jev-"));
  try {
    await syncSaVmWorkspaceSkillDirectory({ cwd: root, enabled: true, jevActiveTools: true });
    for (const dir of [".codex", ".claude", ".gemini", ".grok", ".opencode", ".pi", ".agents"]) {
      const content = await readFile(join(root, dir, "skills", "sa-vm", "SKILL.md"), "utf8");
      expect(content).toContain("jev_choose");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sync writes sibling jev SKILL.md to all backends when jevActiveTools is true", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-jev-skill-"));
  try {
    await syncSaVmWorkspaceSkillDirectory({ cwd: root, enabled: true, jevActiveTools: true });
    for (const dir of [".codex", ".claude", ".gemini", ".grok", ".opencode", ".pi", ".agents"]) {
      const jevFile = join(root, dir, "skills", "jev", "SKILL.md");
      expect(existsSync(jevFile)).toBe(true);
      const content = await readFile(jevFile, "utf8");
      expect(content).toContain("<!-- generated-by-codex-ultra:jev -->");
      expect(content).toContain("name: jev");
      expect(content).toContain("jev_choose");
      expect(content).toContain("jev_blast_radius");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sync removes generated jev SKILL.md when jevActiveTools is off but keeps user-owned files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-jev-off-"));
  try {
    await syncSaVmWorkspaceSkillDirectory({ cwd: root, enabled: true, jevActiveTools: true });
    const generated = join(root, ".codex", "skills", "jev", "SKILL.md");
    expect(existsSync(generated)).toBe(true);
    // User-owned jev skill must survive the toggle-off sweep.
    const ownedDir = join(root, ".claude", "skills", "jev");
    await mkdir(ownedDir, { recursive: true });
    await writeFile(join(ownedDir, "SKILL.md"), "---\nname: jev\n---\nUser-owned JEV notes\n", "utf8");

    await syncSaVmWorkspaceSkillDirectory({ cwd: root, enabled: true, jevActiveTools: false });
    expect(existsSync(generated)).toBe(false);
    expect(await readFile(join(ownedDir, "SKILL.md"), "utf8")).toContain("User-owned JEV notes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildJevWorkspaceSkillMarkdown returns null when JEV is off", async () => {
  const { buildJevWorkspaceSkillMarkdown } = await import("../../apps/server/src/saVmWorkspaceSkill.ts");
  expect(buildJevWorkspaceSkillMarkdown({})).toBeNull();
  const on = buildJevWorkspaceSkillMarkdown({ jevActiveTools: true });
  expect(on).not.toBeNull();
  expect(on as string).toContain("jev_choose");
});

test("generated jev skill uses bridge-safe alias shapes and the git-diff rule", async () => {
  const { buildJevWorkspaceSkillMarkdown } = await import("../../apps/server/src/saVmWorkspaceSkill.ts");
  const md = buildJevWorkspaceSkillMarkdown({ jevActiveTools: true }) as string;
  // Canonical names must never be emitted: the bridge drops them in transit.
  expect(md).not.toContain('"goal": "..."');
  expect(md).not.toContain('"task": "..."');
  expect(md).not.toContain('"plan": "..."');
  expect(md).not.toContain('"code": "..."');
  expect(md).not.toContain('"diff": "..."');
  expect(md).not.toContain('"user_request": "..."');
  expect(md).not.toContain('"actual_work": "..."');
  // jev_done triple must be packed into question (only field the bridge delivers).
  expect(md).toContain("pack the triple into question");
  expect(md).toContain("原始需求");
  // Code review must send raw git diff, never a summary.
  expect(md).toContain("CODE REVIEW MUST SEND git diff, NEVER A SUMMARY");
});

test("generated sa-vm skill contains software engineering tool efficiency decision matrix", () => {
  const md = buildSaVmWorkspaceSkillMarkdown({ enabled: true });
  expect(md).toContain("软件工程工具效率决策矩阵与反模式拦截 (Tool Efficiency & Anti-Patterns)");
  expect(md).toContain("symbol_graph");
  expect(md).toContain("relation_graph");
  expect(md).toContain("read_lines");
  expect(md).toContain("read_file_tail");
  expect(md).toContain("edit_file");
  expect(md).toContain("apply_patch");
  expect(md).toContain("核心避坑三原则 (Core Rules)");
  expect(md).toContain("能用 AST / 图谱工具解决的（找定义/引用/调用关系），坚决不正则 grep");
});

