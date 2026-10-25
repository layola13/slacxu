import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Cap for injected AGENTS.md text (upstream parity: bounded repo instructions). */
export const AGENTS_MD_MAX_BYTES = 8192;
/** How far up the tree to look (covers repo root + a few parent scopes). */
export const AGENTS_MD_MAX_LEVELS = 12;

/**
 * Walk up from cwd collecting AGENTS.md files, root-first (nearest last, so
 * the nearest scope — highest precedence per the AGENTS.md spec — comes last).
 */
export function findAgentsMdFiles(cwd: string, maxLevels = AGENTS_MD_MAX_LEVELS): string[] {
  const found: string[] = [];
  let dir: string;
  try {
    dir = resolve(cwd);
  } catch {
    return found;
  }
  for (let i = 0; i < maxLevels; i++) {
    const candidate = join(dir, "AGENTS.md");
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) found.push(candidate);
    } catch {
      // Ignore unreadable entries; keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found.reverse();
}

/**
 * Load and concatenate AGENTS.md scope files, bounded to maxBytes total.
 * Returns null when no AGENTS.md exists in scope (caller omits the section).
 */
export function loadAgentsMd(cwd: string, maxBytes = AGENTS_MD_MAX_BYTES, maxLevels = AGENTS_MD_MAX_LEVELS): string | null {
  const files = findAgentsMdFiles(cwd, maxLevels);
  if (!files.length) return null;
  const parts: string[] = [];
  let used = 0;
  for (const file of files) {
    if (used >= maxBytes) break;
    let body = "";
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const text = body.trim();
    if (!text) continue;
    const chunk = files.length > 1 ? `# Repo instructions (${file})\n${text}` : text;
    const room = maxBytes - used;
    if (chunk.length > room) {
      parts.push(`${chunk.slice(0, room)}\n…[AGENTS.md truncated to ${maxBytes} bytes]`);
      used = maxBytes;
    } else {
      parts.push(chunk);
      used += chunk.length;
    }
  }
  const out = parts.join("\n\n---\n\n").trim();
  return out || null;
}
