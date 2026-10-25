import { readFile, writeFile } from "node:fs/promises";

export const WINDOWS_POWERSHELL_UTF8_RULE = [
  "在 Windows PowerShell 环境中处理包含中文的文件时，必须显式使用 UTF-8 编码。",
  "",
  "代码与文本文件读取、统计行数、文本搜索优先使用封装增强工具（read_file, read_lines, count_lines, grep_search 等），避免在终端中使用慢速命令阅读文件或搜索代码",
  "写入文本文件优先使用 apply_patch；如必须用 PowerShell 写文件，使用 Set-Content -Encoding UTF8 或 Add-Content -Encoding UTF8",
  "不要用未指定编码的 Set-Content 或 Out-File 处理中文、Markdown、TOML、JSON 等文本文件",
  "终端输出出现乱码时，先用 UTF-8 重新读取确认，不要直接认定文件内容损坏"
].join("\n");

export function mergeWorkspaceAgentsContent(existing: string | null): { content: string; created: boolean; updated: boolean } {
  if (existing === null || existing.length === 0) {
    return { content: `${WINDOWS_POWERSHELL_UTF8_RULE}\n`, created: existing === null, updated: existing !== null };
  }

  const contaminatedPattern = /^[ \t]*-?[ \t]*读取文本文件优先使用[：:]?[ \t]*(?:`?Get-Content -Encoding UTF8`?)[ \t]*\r?\n?/gim;
  const oldDonotUsePattern = /^[ \t]*-?[ \t]*不要用未指定编码的[ \t]*`?Get-Content`?[ \t]*[、\/][ \t]*/gim;
  const cleaned = existing
    .replace(contaminatedPattern, "")
    .replace(oldDonotUsePattern, "- 不要用未指定编码的 ");
  const changed = cleaned !== existing;

  if (cleaned.includes("在 Windows PowerShell 环境中处理包含中文的文件时，必须显式使用 UTF-8 编码。")) {
    return { content: cleaned, created: false, updated: changed };
  }
  return {
    content: `${cleaned.replace(/\s*$/, "")}\n\n${WINDOWS_POWERSHELL_UTF8_RULE}\n`,
    created: false,
    updated: true
  };
}

export async function ensureWorkspaceAgentsFile(path: string): Promise<{ path: string; created: boolean; updated: boolean }> {
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const merged = mergeWorkspaceAgentsContent(existing);
  if (merged.updated || merged.created) {
    await writeFile(path, merged.content, { encoding: "utf8", mode: 0o644 });
  }
  return { path, created: merged.created, updated: merged.updated };
}
