import { existsSync, statSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolveVirtualCodexConfigPath } from "@cxu/sdk-backend";

export type CodexConfigHealthResult = {
  path: string;
  exists: boolean;
  changed: boolean;
  backupPath?: string;
  removedDuplicateSections: string[];
  removedDuplicateKeys: string[];
  unresolvedDuplicates: string[];
};

type SectionBlock = {
  header: string | null;
  repeatable: boolean;
  start: number;
  end: number;
  lines: string[];
};

const TABLE_HEADER_PATTERN = /^\s*(\[\[?)([^\]]+)(\]\]?)\s*(?:#.*)?$/;
const KEY_VALUE_PATTERN = /^\s*([A-Za-z0-9_.-]+|"[^"]+"|'[^']+')\s*=\s*(.+?)\s*(?:#.*)?$/;

export function ensureCodexConfigHealthy(): CodexConfigHealthResult {
  const configPath = resolveVirtualCodexConfigPath();
  const result: CodexConfigHealthResult = {
    path: configPath,
    exists: existsSync(configPath),
    changed: false,
    removedDuplicateSections: [],
    removedDuplicateKeys: [],
    unresolvedDuplicates: []
  };

  if (!result.exists) {
    return result;
  }

  let stat;
  try {
    stat = statSync(configPath);
    if (!stat.isFile()) {
      result.unresolvedDuplicates.push("config path is not a regular file");
      return result;
    }
  } catch (error) {
    result.unresolvedDuplicates.push(errorToMessage(error));
    return result;
  }

  const original = readFileSync(configPath, "utf8");
  const lineEnding = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(/\r?\n/);
  const hadTrailingNewline = original.endsWith("\n") || original.endsWith("\r\n");
  if (hadTrailingNewline) {
    lines.pop();
  }

  const duplicateKeyLines = findDuplicateKeyLines(lines, result);
  const withoutDuplicateKeys = lines.filter((_line, index) => !duplicateKeyLines.has(index));
  const duplicateSectionLines = findDuplicateSectionLines(withoutDuplicateKeys, result);
  const repairedLines = withoutDuplicateKeys.filter((_line, index) => !duplicateSectionLines.has(index));
  const repaired = repairedLines.join(lineEnding) + (hadTrailingNewline ? lineEnding : "");

  if (repaired !== original) {
    const backupPath = `${configPath}.bak-${timestampForFileName()}`;
    copyFileSync(configPath, backupPath);
    writeFileSync(configPath, repaired, { mode: stat.mode });
    result.changed = true;
    result.backupPath = backupPath;
  }

  return result;
}

function findDuplicateSectionLines(lines: string[], result: CodexConfigHealthResult): Set<number> {
  const sections = splitSections(lines);
  const seen = new Map<string, SectionBlock>();
  const duplicateLines = new Set<number>();

  for (const section of sections) {
    if (!section.header || section.repeatable) {
      continue;
    }
    const existing = seen.get(section.header);
    if (!existing) {
      seen.set(section.header, section);
      continue;
    }
    const previousBody = normalizeSectionBody(existing.lines.slice(1));
    const currentBody = normalizeSectionBody(section.lines.slice(1));
    if (previousBody === currentBody) {
      for (let index = section.start; index < section.end; index += 1) {
        duplicateLines.add(index);
      }
      result.removedDuplicateSections.push(section.header);
    } else {
      result.unresolvedDuplicates.push(`duplicate table [${section.header}] has different contents`);
    }
  }

  return duplicateLines;
}

function findDuplicateKeyLines(lines: string[], result: CodexConfigHealthResult): Set<number> {
  const duplicateLines = new Set<number>();
  for (const section of splitSections(lines)) {
    const seen = new Map<string, { value: string; lineIndex: number }>();
    for (let offset = section.header ? 1 : 0; offset < section.lines.length; offset += 1) {
      const line = section.lines[offset] ?? "";
      const match = line.match(KEY_VALUE_PATTERN);
      if (!match) {
        continue;
      }
      const key = match[1] ?? "";
      const value = normalizeKeyValue(match[2] ?? "");
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, { value, lineIndex: section.start + offset });
        continue;
      }
      const label = section.header ? `[${section.header}].${key}` : key;
      if (existing.value === value) {
        duplicateLines.add(section.start + offset);
        result.removedDuplicateKeys.push(label);
      } else {
        result.unresolvedDuplicates.push(`duplicate key ${label} has different values`);
      }
    }
  }
  return duplicateLines;
}

function splitSections(lines: string[]): SectionBlock[] {
  const sections: SectionBlock[] = [];
  let current: SectionBlock = { header: null, repeatable: false, start: 0, end: 0, lines: [] };

  for (let index = 0; index < lines.length; index += 1) {
    const header = parseTableHeader(lines[index] ?? "");
    if (header) {
      current.end = index;
      sections.push(current);
      current = { header: header.name, repeatable: header.repeatable, start: index, end: index + 1, lines: [lines[index] ?? ""] };
    } else {
      current.lines.push(lines[index] ?? "");
      current.end = index + 1;
    }
  }

  current.end = lines.length;
  sections.push(current);
  return sections.filter((section) => section.lines.length > 0);
}

function parseTableHeader(line: string): { name: string; repeatable: boolean } | null {
  const match = line.match(TABLE_HEADER_PATTERN);
  if (!match || (match[1] === "[" && match[3] !== "]") || (match[1] === "[[" && match[3] !== "]]")) {
    return null;
  }
  const name = match[2]?.trim();
  return name ? { name, repeatable: match[1] === "[[" } : null;
}

function normalizeSectionBody(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .join("\n");
}

function normalizeKeyValue(value: string): string {
  return value.trim();
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
