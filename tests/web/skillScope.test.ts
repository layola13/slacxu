import { expect, test } from "bun:test";
import { isWorkspaceSkillPath } from "../../apps/web/src/app/skills/skillScope";

test("classifies skills below the active workspace .agents, .codex, .claude, and .gemini directories as personal", () => {
  expect(isWorkspaceSkillPath("E:/projects/codex-react-ui/.agents/skills/gittool/SKILL.md", "E:/projects/codex-react-ui")).toBe(true);
  expect(isWorkspaceSkillPath("E:\\projects\\codex-react-ui\\.agents\\notes\\SKILL.md", "E:\\projects\\codex-react-ui")).toBe(true);
  expect(isWorkspaceSkillPath("E:/projects/codex-react-ui/.codex/skills/sa-vm/SKILL.md", "E:/projects/codex-react-ui")).toBe(true);
  expect(isWorkspaceSkillPath("E:/projects/codex-react-ui/.claude/skills/sa-vm/SKILL.md", "E:/projects/codex-react-ui")).toBe(true);
  expect(isWorkspaceSkillPath("E:\\projects\\codex-react-ui\\.gemini\\skills\\sa-vm\\SKILL.md", "E:\\projects\\codex-react-ui")).toBe(true);
});

test("keeps system and unrelated workspace skills out of personal group", () => {
  expect(isWorkspaceSkillPath("C:/Users/zhan/.codex/skills/system/SKILL.md", "E:/projects/codex-react-ui")).toBe(false);
  expect(isWorkspaceSkillPath("E:/projects/codex-react-ui/.agents-other/skills/SKILL.md", "E:/projects/codex-react-ui")).toBe(false);
});
