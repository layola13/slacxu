import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Cap for injected long-term memory (keeps system prompt bounded). */
export const MINI_MEMORY_MAX_CHARS = 8000;
/** Cap for a single remember write (append-only note, not a novel). */
export const MINI_REMEMBER_MAX_CHARS = 2000;
export const MINI_MEMORY_FILENAME = "MEMORY.md";

function readCapped(path: string, cap: number): string {
  try {
    if (!existsSync(path)) return "";
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) return "";
    return raw.length > cap ? raw.slice(-cap) : raw;
  } catch {
    return "";
  }
}

/**
 * Two-level long-term memory (upstream parity: codex-rs MEMORY.md):
 * repo-level `<cwd>/MEMORY.md` plus user-level `~/.codex/MEMORY.md`.
 * Returns the formatted block for system-prompt injection, or "" when empty.
 */
export function loadMiniMemory(cwd: string): string {
  const repo = readCapped(join(cwd, MINI_MEMORY_FILENAME), MINI_MEMORY_MAX_CHARS);
  let home = "";
  try {
    const homePath = join(homedir(), ".codex", MINI_MEMORY_FILENAME);
    if (homePath !== join(cwd, MINI_MEMORY_FILENAME)) home = readCapped(homePath, MINI_MEMORY_MAX_CHARS);
  } catch {
    home = "";
  }
  const parts: string[] = [];
  if (repo.trim()) parts.push(`[repo MEMORY.md]\n${repo.trim()}`);
  if (home.trim()) parts.push(`[user MEMORY.md]\n${home.trim()}`);
  if (!parts.length) return "";
  let block = `Long-term memory (MEMORY.md — obey project facts, keep updated with remember):\n${parts.join("\n\n")}`;
  if (block.length > MINI_MEMORY_MAX_CHARS) block = block.slice(-MINI_MEMORY_MAX_CHARS);
  return block;
}

/**
 * Append one note to the repo-level `<cwd>/MEMORY.md` (created on demand).
 * Returns the confirmation text shown to the model.
 */
export function appendMiniMemory(cwd: string, text: string): string {
  const note = String(text ?? "").trim().slice(0, MINI_REMEMBER_MAX_CHARS);
  if (!note) return "remember needs {text} — one fact, decision, or preference to persist.";
  const file = join(cwd, MINI_MEMORY_FILENAME);
  try {
    mkdirSync(dirname(file), { recursive: true });
    const prefix = existsSync(file) ? "\n" : "";
    appendFileSync(file, `${prefix}- ${note.replace(/\r?\n/g, " ")}\n`, "utf8");
  } catch (e) {
    return `remember failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  return `remembered in ${MINI_MEMORY_FILENAME}.`;
}
