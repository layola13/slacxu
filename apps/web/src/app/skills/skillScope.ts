export function isWorkspaceSkillPath(skillPath: string, workspaceCwd: string): boolean {
  const skill = normalizeSkillPath(skillPath);
  const workspace = normalizeSkillPath(workspaceCwd).replace(/\/+$/, "");
  if (!skill || !workspace) return false;
  const prefixes = [
    `${workspace}/.agents/`,
    `${workspace}/.codex/`,
    `${workspace}/.claude/`,
    `${workspace}/.gemini/`
  ];
  const isWindows = isWindowsPath(skill) || isWindowsPath(workspace);
  const comparableSkill = isWindows ? skill.toLowerCase() : skill;
  return prefixes.some((prefix) => {
    const comparablePrefix = isWindows ? prefix.toLowerCase() : prefix;
    return comparableSkill.startsWith(comparablePrefix);
  });
}

function normalizeSkillPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^(\.\/)+/, "");
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value) || value.startsWith("//");
}
