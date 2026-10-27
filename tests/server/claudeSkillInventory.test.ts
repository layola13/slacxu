import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { ClaudeSkillInventory, expandClaudeSkillInput, skillGroupsJson } from "../../backends/claude/src/runtime/claudeSkillInventory";

test("Claude skills remain isolated per thread inventory", async () => {
  const root = join(process.cwd(), ".isolated-claude-data", `skills-${crypto.randomUUID()}`);
  const skillPath = join(root, ".agents", "skills", "review-code", "SKILL.md");
  await mkdir(join(skillPath, ".."), { recursive: true });
  await writeFile(skillPath, "---\nname: review-code\ndescription: Review changes rigorously\n---\n\nInspect the diff and report defects.\n", "utf8");
  try {
    const first = new ClaudeSkillInventory();
    const second = new ClaudeSkillInventory();
    const groups = await first.list([root]);
    expect(groups[0]?.skills[0]).toMatchObject({ name: "review-code", enabled: true, path: skillPath });
    expect(skillGroupsJson(groups)).toMatchObject({ data: [{ cwd: root, skills: [{ name: "review-code" }] }] });

    const expanded = await first.expandInvocation("/review-code src/main.ts", root);
    expect(expanded).toContain('<claude-skill name="review-code"');
    expect(expanded).toContain("Execute this skill with the following arguments:\nsrc/main.ts");
    const dollarExpanded = await first.expandInvocation("Please $review-code src/main.ts carefully", root);
    expect(dollarExpanded).toContain('<claude-skill name="review-code"');
    expect(dollarExpanded).toContain("Please <claude-skill");
    expect(dollarExpanded).toContain("src/main.ts carefully");
    expect(await first.expandInvocation("Please $unknown src/main.ts", root)).toBe("Please $unknown src/main.ts");

    const composerInput = await expandClaudeSkillInput(first, [
      { type: "text", text: "$review-code src/main.ts", text_elements: [] },
      { type: "skill", name: "review-code", path: skillPath },
    ], root);
    expect(composerInput.matched).toBe(true);
    expect(composerInput.input).toEqual([expect.objectContaining({
      type: "text",
      text: expect.stringContaining("</claude-skill> src/main.ts"),
    })]);

    first.setEnabled(skillPath, false);
    expect(await first.expandInvocation("/review-code src/main.ts", root)).toBe("/review-code src/main.ts");
    expect((await expandClaudeSkillInput(first, "$review-code src/main.ts", root)).matched).toBe(false);
    expect(await second.expandInvocation("/review-code src/main.ts", root)).toContain("<claude-skill");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude skill preview only reads discovered skill files", async () => {
  const root = join(process.cwd(), ".isolated-claude-data", `skills-${crypto.randomUUID()}`);
  const skillPath = join(root, ".claude", "skills", "ship", "SKILL.md");
  await mkdir(join(skillPath, ".."), { recursive: true });
  await writeFile(skillPath, "# Ship\n\nPrepare a release.\n", "utf8");
  try {
    const inventory = new ClaudeSkillInventory();
    expect(await inventory.readSkill(skillPath, [root])).toContain("Prepare a release");
    await expect(inventory.readSkill(join(root, "secret.txt"), [root])).rejects.toThrow("not present");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude skill inventory tells skill files apart from ordinary workspace files", async () => {
  const root = join(process.cwd(), ".isolated-claude-data", `skills-${crypto.randomUUID()}`);
  const skillPath = join(root, ".claude", "skills", "ship", "SKILL.md");
  const planPath = join(root, "current_plan.md");
  await mkdir(join(skillPath, ".."), { recursive: true });
  await writeFile(skillPath, "# Ship\n\nPrepare a release.\n", "utf8");
  await writeFile(planPath, "# Current Plan\n", "utf8");
  try {
    const inventory = new ClaudeSkillInventory();
    expect(await inventory.isSkillPath(skillPath, [root])).toBe(true);
    expect(await inventory.isSkillPath(planPath, [root])).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("supports common practice skills directory, lowercase skill.md, and single-file .md skills", async () => {
  const root = join(process.cwd(), ".isolated-claude-data", `skills-${crypto.randomUUID()}`);
  try {
    // 1. Top-level common practice skills/<name>/SKILL.md
    const topSkill = join(root, "skills", "git-flow", "SKILL.md");
    await mkdir(join(topSkill, ".."), { recursive: true });
    await writeFile(topSkill, "---\nname: git-flow\ndescription: Standard git branch flow\n---\n\nRun git flow.\n", "utf8");

    // 2. Lowercase skill.md in .opencode/skills/<name>/skill.md
    const opencodeSkill = join(root, ".opencode", "skills", "opencode-tool", "skill.md");
    await mkdir(join(opencodeSkill, ".."), { recursive: true });
    await writeFile(opencodeSkill, "---\nname: opencode-tool\ndescription: >-\n  A multi-line description\n  for OpenCode tool\n---\n\nOpenCode skill body.\n", "utf8");

    // 3. Single-file skill in .agents/skills/cleaner.md
    const singleSkill = join(root, ".agents", "skills", "cleaner.md");
    await mkdir(join(singleSkill, ".."), { recursive: true });
    await writeFile(singleSkill, "---\nname: cleaner\ndescription: Clean up temporary files\n---\n\nClean files.\n", "utf8");

    const inventory = new ClaudeSkillInventory();
    const groups = await inventory.list([root]);
    const group = groups.find((g) => g.cwd === root);
    expect(group).toBeDefined();

    const skillNames = group!.skills.map((s) => s.name).sort();
    expect(skillNames).toContain("git-flow");
    expect(skillNames).toContain("opencode-tool");
    expect(skillNames).toContain("cleaner");

    // Check multi-line description was parsed properly
    const opencodeEntry = group!.skills.find((s) => s.name === "opencode-tool");
    expect(opencodeEntry?.description).toBe("A multi-line description for OpenCode tool");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
