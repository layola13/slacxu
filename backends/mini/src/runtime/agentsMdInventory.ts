import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

/**
 * AGENTS.md project-instruction loading for the mini agent.
 *
 * Mirrors the Claude Code agents-md plugin's default mode
 * (`claude-md-or-agents-md`): a project with no instruction files of its own
 * gets its AGENTS.md files instead, loaded root-first where the system prompt
 * is built; touching files under a subdirectory attaches that directory's
 * AGENTS.md once per turn, framed after the tool result. Files the context
 * already holds (by path or by content) are never added twice.
 */

export const AGENTS_MD_FILENAMES = ["AGENTS.md", ".claude/AGENTS.md"];
export const AGENTS_MD_NATIVE_FILENAME = "CLAUDE.md";
export const AGENTS_MD_MAX_FILE_CHARS = 12_000;
export const AGENTS_MD_MAX_TOTAL_CHARS = 24_000;
const AGENTS_MD_IMPORT_DEPTH = 5;

export type AgentsMdMode = "fallback" | "both" | "off";

export function miniAgentsMdMode(): AgentsMdMode {
  const raw = (process.env.MINI_AGENTS_MD ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "0" || raw === "no") return "off";
  if (raw === "both" || raw === "all") return "both";
  return "fallback";
}

export interface AgentsMdFile {
  /** Absolute file path. */
  path: string;
  /** Directory whose tree this file scopes. */
  scopeDir: string;
  /** Content with @-imports expanded, capped. */
  content: string;
  truncated: boolean;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    return st.isFile();
  } catch {
    return false;
  }
}

function withinDir(dir: string, target: string): boolean {
  const d = resolve(dir);
  const t = resolve(target);
  return t === d || t.startsWith(d + sep);
}

/** Nearest ancestor (inclusive) containing `.git`; the session cwd otherwise. */
export async function findAgentsMdProjectRoot(cwd: string): Promise<string> {
  let dir = resolve(cwd);
  for (;;) {
    if (await fileExists(join(dir, ".git"))) return dir;
    // A `.git` file (worktree/submodule pointer) counts as a repo marker too.
    try {
      const st = await stat(join(dir, ".git"));
      if (st.isFile()) return dir;
    } catch {
      // Ignore; keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}

function ancestorChain(root: string, cwd: string): string[] {
  const chain: string[] = [];
  let dir = resolve(cwd);
  const stop = resolve(root);
  for (;;) {
    chain.unshift(dir);
    if (dir === stop) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return chain;
}

/** Expand `@path` import lines relative to the importing file (cycle-guarded). */
async function expandAgentsMdImports(
  markdown: string,
  fileDir: string,
  seen: Set<string>,
  depth: number,
): Promise<string> {
  if (depth <= 0) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const match = /^\s*@([^\s]+)\s*$/.exec(line);
    if (!match) { out.push(line); continue; }
    const target = resolve(fileDir, match[1] ?? "");
    const key = target.toLowerCase();
    if (seen.has(key)) { out.push(`<!-- @import ${match[1]} (already included above) -->`); continue; }
    let content: string;
    try {
      content = await readFile(target, "utf8");
    } catch {
      out.push(line);
      continue;
    }
    seen.add(key);
    out.push(`<!-- @import ${match[1]} -->`);
    out.push(await expandAgentsMdImports(content, dirname(target), seen, depth - 1));
  }
  return out.join("\n");
}

async function readAgentsMdFile(path: string, scopeDir: string): Promise<AgentsMdFile | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const seen = new Set<string>([resolve(path).toLowerCase()]);
  const expanded = await expandAgentsMdImports(raw, dirname(path), seen, AGENTS_MD_IMPORT_DEPTH);
  const truncated = expanded.length > AGENTS_MD_MAX_FILE_CHARS;
  return {
    path,
    scopeDir,
    content: truncated ? expanded.slice(0, AGENTS_MD_MAX_FILE_CHARS) : expanded,
    truncated,
  };
}

/**
 * Collect instruction files from the project root down to the working
 * directory, root first. In `fallback` (default) a directory whose own
 * CLAUDE.md exists is left to that file and its AGENTS.md files are skipped;
 * `both` loads them alongside. Dedupes identical content across filenames.
 */
export async function collectAgentsMdFiles(
  root: string,
  cwd: string,
  mode: AgentsMdMode = "fallback",
): Promise<AgentsMdFile[]> {
  const resolvedRoot = resolve(root);
  const resolvedCwd = withinDir(resolvedRoot, cwd) ? resolve(cwd) : resolvedRoot;
  const files: AgentsMdFile[] = [];
  const seenContent = new Set<string>();
  for (const dir of ancestorChain(resolvedRoot, resolvedCwd)) {
    if (mode === "fallback" && await fileExists(join(dir, AGENTS_MD_NATIVE_FILENAME))) continue;
    for (const name of AGENTS_MD_FILENAMES) {
      const path = join(dir, name);
      if (!await fileExists(path)) continue;
      const file = await readAgentsMdFile(path, dir);
      if (!file || !file.content.trim()) continue;
      const digest = file.content.trim();
      if (seenContent.has(digest)) continue;
      seenContent.add(digest);
      files.push(file);
    }
  }
  return files;
}

/**
 * Collect each additional workspace root's own AGENTS.md files (--add-dir
 * equivalent: the engine loads their CLAUDE.md, here their AGENTS.md rides
 * the system prompt too). Missing/non-directory roots are skipped; content
 * already seen is deduped by the caller via the returned files.
 */
export async function collectExtraRootsAgentsMd(
  roots: string[] | undefined,
  mode: AgentsMdMode = "fallback",
): Promise<AgentsMdFile[]> {
  const files: AgentsMdFile[] = [];
  const seenContent = new Set<string>();
  for (const raw of roots ?? []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const root = resolve(raw);
    try {
      if (!(await stat(root)).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const file of await collectAgentsMdFiles(root, root, mode)) {
      const digest = file.content.trim();
      if (seenContent.has(digest)) continue;
      seenContent.add(digest);
      files.push(file);
    }
  }
  return files;
}

/**
 * Scope list for nested attach: the main project (nested below the turn cwd)
 * plus every valid additional root (nested below itself).
 */
export async function resolveAgentsMdScopes(
  projectRoot: string,
  turnCwd: string,
  additionalRoots: string[] | undefined,
): Promise<Array<{ root: string; base: string }>> {
  const scopes = [{ root: resolve(projectRoot), base: resolve(turnCwd) }];
  for (const raw of additionalRoots ?? []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const root = resolve(raw);
    try {
      if (!(await stat(root)).isDirectory()) continue;
    } catch {
      continue;
    }
    if (scopes.some((scope) => scope.root.toLowerCase() === root.toLowerCase())) continue;
    scopes.push({ root, base: root });
  }
  return scopes;
}

/**
 * Compaction-restore note: the folded transcript loses the delivered files,
 * so their paths ride the summary and stay model-visible after compaction.
 * Counts only, never file text.
 */
export function buildAgentsMdCompactionNote(paths: string[] | undefined, cwd: string): string {
  const unique = [...new Set((paths ?? []).filter((p) => typeof p === "string" && p.trim()))].slice(0, 20);
  if (!unique.length) return "";
  const base = resolve(cwd);
  const lines = unique.map((p) => {
    const rel = relative(base, resolve(base, p)).replace(/\\/g, "/");
    return `- ${rel || p}`;
  });
  return `Active AGENTS.md instruction files (still in effect after compaction):\n${lines.join("\n")}`;
}

/**
 * Nested attach: for touched workspace paths, find the deepest scope
 * directories (at or below the turn cwd, inside the project root) whose
 * AGENTS.md files have not been delivered yet this turn. Nearest scope first.
 */
export async function findNestedAgentsMdFiles(
  projectRoot: string,
  turnCwd: string,
  touchedPaths: string[],
  delivered: Set<string>,
  mode: AgentsMdMode = "fallback",
): Promise<AgentsMdFile[]> {
  const root = resolve(projectRoot);
  const base = resolve(turnCwd);
  const candidates = new Map<string, string>();
  for (const touched of touchedPaths) {
    const abs = resolve(base, touched);
    if (!withinDir(root, abs)) continue;
    let dir = abs;
    try {
      const st = await stat(abs).catch(() => null);
      if (!st || !st.isDirectory()) dir = dirname(abs);
    } catch {
      dir = dirname(abs);
    }
    // Only directories strictly below the turn cwd carry nested files; the
    // cwd's own files already ride the system prompt.
    while (withinDir(root, dir) && dir !== base && dir.startsWith(base + sep)) {
      candidates.set(dir, dir);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const ordered = [...candidates.keys()].sort((a, b) => b.length - a.length);
  const found: AgentsMdFile[] = [];
  for (const dir of ordered) {
    if (mode === "fallback" && await fileExists(join(dir, AGENTS_MD_NATIVE_FILENAME))) continue;
    for (const name of AGENTS_MD_FILENAMES) {
      const path = join(dir, name);
      const key = path.toLowerCase();
      if (delivered.has(key) || !await fileExists(path)) continue;
      const file = await readAgentsMdFile(path, dir);
      if (!file || !file.content.trim()) continue;
      delivered.add(key);
      found.push(file);
    }
  }
  return found;
}

/** Extract candidate workspace paths from tool args (path/dir/file keys). */
export function extractAgentsMdTouchedPaths(args: Record<string, any>): string[] {
  const out: string[] = [];
  for (const key of ["path", "dir", "file", "directory", "cwd"]) {
    const value = args?.[key];
    if (typeof value === "string" && value.trim()) out.push(value.trim());
  }
  return out;
}

/** Workspace-relative display path with forward slashes (model-facing text). */
function displayRel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
/** Render collected files as a system-prompt block, root first, total-capped. */
export function renderAgentsMdSystemBlock(files: AgentsMdFile[]): string {
  if (!files.length) return "";
  let total = 0;
  const parts: string[] = [];
  for (const file of files) {
    const rel = displayRel(file.path);
    const framed = `# Project instructions (${rel}):\n${file.content.trim()}${file.truncated ? "\n…[truncated]" : ""}`;
    if (total + framed.length > AGENTS_MD_MAX_TOTAL_CHARS && parts.length > 0) {
      parts.push("…[further AGENTS.md files omitted for length]");
      break;
    }
    total += framed.length;
    parts.push(framed);
  }
  return parts.join("\n\n");
}

/** Frame a nested file as context after a tool result. */
export function renderAgentsMdNestedBlock(file: AgentsMdFile): string {
  const rel = displayRel(file.path);
  return `Contents of ${rel}:\n${file.content.trim()}${file.truncated ? "\n…[truncated]" : ""}`;
}

export function agentsMdDisplayName(path: string): string {
  return basename(path);
}
