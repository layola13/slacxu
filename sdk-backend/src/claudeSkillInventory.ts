import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { JsonValue } from "@codex-ui/shared";

export type ClaudeSkillEntry = {
  name: string;
  description: string;
  path: string;
  scope: "project" | "user" | "extra";
  enabled: boolean;
};

export type ClaudeSkillGroup = {
  cwd: string;
  skills: ClaudeSkillEntry[];
  errors: Array<{ path: string; message: string }>;
};

export class ClaudeSkillInventory {
  private extraRoots: string[] = [];
  private disabledPaths = new Set<string>();

  constructor(
    private readonly configDir?: string,
    private readonly options?: { scanUserSkills?: boolean },
  ) {}

  setExtraRoots(roots: string[]): void {
    this.extraRoots = uniquePaths(roots);
  }

  getExtraRoots(): string[] {
    return [...this.extraRoots];
  }

  setEnabled(path: string, enabled: boolean): void {
    const key = normalizePath(path);
    if (enabled) this.disabledPaths.delete(key);
    else this.disabledPaths.add(key);
  }

  async list(cwds: string[]): Promise<ClaudeSkillGroup[]> {
    const roots = uniquePaths([...cwds, ...this.extraRoots]);
    const groups = await Promise.all(
      roots.map((cwd) =>
        this.scanWorkspace(
          cwd,
          this.extraRoots.some((root) => normalizePath(root) === normalizePath(cwd)) ? "extra" : "project",
        ),
      ),
    );

    if (this.configDir) {
      const configSkills = await this.scanSkillDirectory(this.configDir, join(this.configDir, "skills"), "user");
      if (configSkills.skills.length > 0 || configSkills.errors.length > 0) {
        groups.push(configSkills);
      }
    }

    if (this.options?.scanUserSkills) {
      const userRoots = this.getUserSkillRoots();
      for (const userDir of userRoots) {
        const userGroup = await this.scanSkillDirectory(userDir, userDir, "user");
        if (userGroup.skills.length > 0 || userGroup.errors.length > 0) {
          groups.push(userGroup);
        }
      }
    }

    return groups.filter((group) => group.skills.length > 0 || group.errors.length > 0);
  }

  private getUserSkillRoots(): string[] {
    const home = homedir();
    const roots: string[] = [];
    if (this.configDir) {
      roots.push(join(this.configDir, "skills"));
    }
    // Mini Agent dedicated user skills
    roots.push(join(home, ".mini-agent", "skills"));
    roots.push(join(home, ".mini", "skills"));
    // OpenCode global skills
    roots.push(join(home, ".config", "opencode", "skills"));
    roots.push(join(home, ".opencode", "skills"));
    // Claude Code global skills
    roots.push(join(home, ".claude", "skills"));
    roots.push(join(home, ".config", "claude", "skills"));
    // Universal Agent, Codex, Gemini global skills
    roots.push(join(home, ".agents", "skills"));
    roots.push(join(home, ".codex", "skills"));
    roots.push(join(home, ".gemini", "skills"));
    roots.push(join(home, ".gemini", "antigravity-cli", "skills"));
    return uniquePaths(roots);
  }

  async expandInvocation(text: string, cwd?: string): Promise<string> {
    const groups = await this.list(cwd ? [cwd] : []);
    const skills = groups.flatMap((group) => group.skills).filter((entry) => entry.enabled);
    const slashMatch = /^\s*\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/.exec(text);
    if (slashMatch) {
      const skill = skills.find((entry) => entry.name.toLowerCase() === slashMatch[1]?.toLowerCase());
      if (!skill) return text;
      const args = slashMatch[2]?.trim() ?? "";
      return [
        await renderSkillPrompt(skill),
        "",
        args ? `Execute this skill with the following arguments:\n${args}` : "Execute this skill now.",
      ].join("\n");
    }

    const skillByName = new Map(skills.map((skill) => [skill.name.toLowerCase(), skill]));
    const matches = [...text.matchAll(/(^|\s)\$([a-zA-Z][\w-]*)\b/g)];
    if (matches.length === 0) return text;
    let expanded = text;
    let matched = false;
    for (const match of matches.reverse()) {
      const skill = skillByName.get((match[2] ?? "").toLowerCase());
      if (!skill || match.index === undefined) continue;
      const leading = match[1] ?? "";
      const start = match.index + leading.length;
      const end = start + (match[0]?.length ?? 0) - leading.length;
      expanded = `${expanded.slice(0, start)}${await renderSkillPrompt(skill)}${expanded.slice(end)}`;
      matched = true;
    }
    return matched ? expanded : text;
  }

  async isSkillPath(path: string, cwds: string[]): Promise<boolean> {
    const requestedPath = normalizePath(path);
    const groups = await this.list(cwds);
    return groups.some((group) => group.skills.some((entry) => normalizePath(entry.path) === requestedPath));
  }

  async readSkill(path: string, cwds: string[]): Promise<string> {
    const requestedPath = normalizePath(path);
    const groups = await this.list(cwds);
    const skill = groups.flatMap((group) => group.skills).find((entry) => normalizePath(entry.path) === requestedPath);
    if (!skill) throw new Error("Skill path is not present in this Claude thread inventory");
    return readFile(skill.path, "utf8");
  }

  private async scanWorkspace(cwd: string, scope: "project" | "extra"): Promise<ClaudeSkillGroup> {
    const candidates = [
      // 1. Mini Agent dedicated
      join(cwd, ".mini-agent", "skills"),
      join(cwd, ".mini", "skills"),
      // 2. 大众通用规范（显式 skills/ 与隐藏 .skills/、.agents/skills）
      join(cwd, "skills"),
      join(cwd, ".skills"),
      join(cwd, ".agents", "skills"),
      // 3. 主流工具生态兼容（OpenCode、Claude、Codex、Gemini、Cursor、VSCode）
      join(cwd, ".opencode", "skills"),
      join(cwd, ".claude", "skills"),
      join(cwd, ".codex", "skills"),
      join(cwd, ".gemini", "skills"),
      join(cwd, ".cursor", "skills"),
      join(cwd, ".vscode", "skills"),
    ];
    const scanned = await Promise.all(candidates.map((directory) => this.scanSkillDirectory(cwd, directory, scope)));
    return {
      cwd,
      skills: dedupeSkills(scanned.flatMap((group) => group.skills)),
      errors: scanned.flatMap((group) => group.errors),
    };
  }

  private async scanSkillDirectory(cwd: string, directory: string, scope: ClaudeSkillEntry["scope"]): Promise<ClaudeSkillGroup> {
    const skills: ClaudeSkillEntry[] = [];
    const errors: Array<{ path: string; message: string }> = [];
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") errors.push({ path: directory, message: errorMessage(error) });
      return { cwd, skills, errors };
    }
    for (const entry of entries) {
      // 1. Directory style skill: <entry.name>/SKILL.md, skill.md, or Skill.md
      if (entry.isDirectory()) {
        const candidateFiles = ["SKILL.md", "skill.md", "Skill.md"];
        let resolvedPath: string | null = null;
        let markdown: string | null = null;
        for (const filename of candidateFiles) {
          const p = join(directory, entry.name, filename);
          try {
            markdown = await readFile(p, "utf8");
            resolvedPath = p;
            break;
          } catch {}
        }
        if (!resolvedPath || markdown === null) continue;

        try {
          const metadata = parseSkillFrontmatter(markdown);
          const name = normalizeSkillName(metadata.name || entry.name);
          if (!name) {
            errors.push({ path: resolvedPath, message: "Skill name must use letters, numbers, and hyphens" });
            continue;
          }
          skills.push({
            name,
            description: metadata.description || firstMarkdownParagraph(markdown),
            path: resolvedPath,
            scope,
            enabled: !this.disabledPaths.has(normalizePath(resolvedPath)),
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") errors.push({ path: resolvedPath, message: errorMessage(error) });
        }
      }
      // 2. Single-file style skill: <directory>/<name>.md (e.g. skills/deploy.md)
      else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".")) {
        const baseName = entry.name.slice(0, -3);
        const lowerBase = baseName.toLowerCase();
        if (lowerBase === "readme" || lowerBase === "index" || lowerBase === "license" || lowerBase === "changelog") {
          continue;
        }
        const filePath = join(directory, entry.name);
        try {
          const markdown = await readFile(filePath, "utf8");
          const metadata = parseSkillFrontmatter(markdown);
          const name = normalizeSkillName(metadata.name || baseName);
          if (!name) continue;
          skills.push({
            name,
            description: metadata.description || firstMarkdownParagraph(markdown),
            path: filePath,
            scope,
            enabled: !this.disabledPaths.has(normalizePath(filePath)),
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") errors.push({ path: filePath, message: errorMessage(error) });
        }
      }
    }
    return { cwd, skills, errors };
  }
}

export function skillGroupsJson(groups: ClaudeSkillGroup[]): JsonValue {
  return {
    data: groups.map((group) => ({
      cwd: group.cwd,
      skills: group.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        shortDescription: skill.description,
        path: skill.path,
        scope: skill.scope,
        enabled: skill.enabled,
        interface: { displayName: skill.name, shortDescription: skill.description },
      })),
      errors: group.errors,
    })),
  } as JsonValue;
}

export async function expandClaudeSkillInput(
  inventory: ClaudeSkillInventory,
  input: JsonValue | undefined,
  cwd?: string,
): Promise<{ matched: boolean; input: JsonValue | undefined }> {
  if (typeof input === "string") {
    const expanded = await inventory.expandInvocation(input, cwd);
    return { matched: expanded !== input, input: expanded };
  }
  if (!Array.isArray(input)) return { matched: false, input };
  let matched = false;
  const expandedInput = await Promise.all(input.map(async (value) => {
    const block = jsonRecord(value);
    if (block.type !== "text" || typeof block.text !== "string") return value;
    const expanded = await inventory.expandInvocation(block.text, cwd);
    if (expanded === block.text) return value;
    matched = true;
    return { ...block, text: expanded } as JsonValue;
  }));
  return {
    matched,
    input: matched ? expandedInput.filter((value) => jsonRecord(value).type !== "skill") : input,
  };
}

function parseSkillFrontmatter(markdown: string): { name?: string; description?: string } {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  const lines = (match[1] ?? "").split(/\r?\n/);
  let currentKey: "name" | "description" | null = null;
  let multilineVal: string[] = [];

  const flush = () => {
    if (currentKey) {
      let combined = multilineVal.join(" ").replace(/\s+/g, " ").trim();
      combined = combined.replace(/^(?:[>|][-+0-9]?\s*)/, "").trim();
      combined = combined.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2").trim();
      result[currentKey] = combined;
    }
    currentKey = null;
    multilineVal = [];
  };

  for (const line of lines) {
    const keyMatch = /^\s*(name|description)\s*:\s*(.*)$/.exec(line);
    if (keyMatch) {
      flush();
      currentKey = keyMatch[1] as "name" | "description";
      const rest = keyMatch[2]?.trim() ?? "";
      if (rest) multilineVal.push(rest);
    } else if (currentKey && /^\s+/.test(line)) {
      multilineVal.push(line.trim());
    } else {
      flush();
    }
  }
  flush();
  return result;
}

function firstMarkdownParagraph(markdown: string): string {
  const withoutFrontmatter = markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  return withoutFrontmatter.split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/^#+\s*/gm, "").trim())
    .find(Boolean)?.slice(0, 500) ?? "";
}

function normalizeSkillName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : "";
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.map((path) => resolve(path.trim())).filter((path) => {
    if (!path || seen.has(normalizePath(path))) return false;
    seen.add(normalizePath(path));
    return true;
  });
}

function dedupeSkills(skills: ClaudeSkillEntry[]): ClaudeSkillEntry[] {
  const byName = new Map<string, ClaudeSkillEntry>();
  for (const skill of skills) {
    const existing = byName.get(skill.name);
    if (!existing) {
      byName.set(skill.name, skill);
    } else if (existing.scope === "user" && skill.scope !== "user") {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizePath(path: string): string {
  return resolve(path).replace(/\\/g, "/").toLowerCase();
}

async function renderSkillPrompt(skill: ClaudeSkillEntry): Promise<string> {
  const instructions = await readFile(skill.path, "utf8");
  return [
    `<claude-skill name="${skill.name}" source="${skill.path}">`,
    instructions,
    "</claude-skill>",
  ].join("\n");
}

function jsonRecord(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
