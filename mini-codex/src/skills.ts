import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type SkillEntry = { name: string; description: string; path: string };

const ROOTS = [".agents/skills", ".codex/skills", ".claude/skills", ".grok/skills"];

function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const f = /^\s*(name|description)\s*:\s*(.*?)\s*$/.exec(line);
    if (!f) continue;
    const v = (f[2] ?? "").replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2").trim();
    if (f[1] === "name") out.name = v.toLowerCase().replace(/_/g, "-");
    else out.description = v;
  }
  return out;
}

export async function scanSkills(cwd: string): Promise<SkillEntry[]> {
  const found: SkillEntry[] = [];
  for (const root of ROOTS) {
    let entries;
    try { entries = await readdir(join(cwd, root), { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(cwd, root, e.name, "SKILL.md");
      try {
        const md = await readFile(p, "utf8");
        const meta = parseFrontmatter(md);
        const name = meta.name || e.name.toLowerCase();
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) continue;
        found.push({ name, description: (meta.description || "").slice(0, 200), path: p });
      } catch {}
    }
  }
  return found.slice(0, 50);
}

export function expandSlash(text: string, skills: SkillEntry[]): string {
  const m = /^\s*\/([a-zA-Z][\w-]*)\s*([\s\S]*)$/.exec(text);
  if (!m) return text;
  const hit = skills.find((s) => s.name === m[1]!.toLowerCase());
  if (!hit) return text;
  return `[skill:${hit.name} ${hit.path}]\n${m[2] ?? ""}`.trim();
}

export async function readSkillBody(entry: SkillEntry): Promise<string> {
  const md = await readFile(entry.path, "utf8");
  if (md.length > 12000) {
    const heads = md.split("\n").filter((l) => l.startsWith("#")).slice(0, 30).join("\n");
    return `${md.slice(0, 12000)}\n\n[truncated ${md.length} bytes; sections:\n${heads}\nuse read <path> <start> <end> for detail]`;
  }
  return md;
}

export function skillListPrompt(skills: SkillEntry[]): string {
  if (!skills.length) return "skills: none";
  return `skills:\n${skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}\nCall read_skill(name) before using a skill; sa-vm SKILL.md is authoritative for file ops.`;
}

export function resolveSkillPath(p: string, skills: SkillEntry[]): string {
  const norm = resolve(p);
  const hit = skills.find((s) => resolve(s.path) === norm);
  if (!hit) throw new Error("skill path not in inventory");
  return hit.path;
}
