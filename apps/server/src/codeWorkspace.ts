import { dirname, relative, resolve } from "node:path";

export type CodeWorkspaceFolders = {
  cwd: string;
  additionalRoots: string[];
};

type CodeWorkspaceDocument = {
  folders?: Array<{ path?: unknown }>;
  [key: string]: unknown;
};

export function isCodeWorkspacePath(path: string): boolean {
  return path.trim().toLowerCase().endsWith(".code-workspace");
}

export function parseCodeWorkspaceFolders(contents: string, workspaceFilePath: string): CodeWorkspaceFolders {
  const document = parseCodeWorkspaceDocument(contents);
  if (!Array.isArray(document.folders)) {
    throw new Error("The .code-workspace file must define a folders array");
  }
  const workspaceDirectory = dirname(workspaceFilePath);
  const roots = document.folders.flatMap((folder) => {
    if (!folder || typeof folder !== "object" || typeof folder.path !== "string" || !folder.path.trim()) return [];
    return [resolve(workspaceDirectory, folder.path.trim())];
  });
  if (roots.length === 0) {
    throw new Error("The .code-workspace file does not contain any folder paths");
  }
  const [cwd, ...additionalRoots] = uniquePaths(roots);
  if (!cwd) throw new Error("The .code-workspace file does not contain any folder paths");
  return { cwd, additionalRoots };
}

export function updateCodeWorkspaceFolders(
  existingContents: string | null,
  workspaceFilePath: string,
  cwd: string,
  additionalRoots: string[]
): string {
  const document = existingContents?.trim() ? parseCodeWorkspaceDocument(existingContents) : {};
  const workspaceDirectory = dirname(workspaceFilePath);
  document.folders = uniquePaths([cwd, ...additionalRoots]).map((folderPath) => ({
    path: relative(workspaceDirectory, folderPath) || "."
  }));
  return `${JSON.stringify(document, null, 2)}\n`;
}

function parseCodeWorkspaceDocument(contents: string): CodeWorkspaceDocument {
  try {
    const parsed = JSON.parse(normalizeJsonc(contents));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as CodeWorkspaceDocument;
  } catch {
    throw new Error("The .code-workspace file is not valid JSON with comments");
  }
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.flatMap((path) => {
    const normalized = resolve(path);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function normalizeJsonc(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (inString) {
      result += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === "\"") inString = false;
      continue;
    }
    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }
    if (current === "/" && next === "/") {
      result += "  ";
      index += 1;
      while (index + 1 < source.length && source[index + 1] !== "\n" && source[index + 1] !== "\r") {
        result += " ";
        index += 1;
      }
      continue;
    }
    if (current === "/" && next === "*") {
      result += "  ";
      index += 1;
      while (index + 1 < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        result += source[index + 1] === "\n" || source[index + 1] === "\r" ? source[index + 1] : " ";
        index += 1;
      }
      if (index + 1 < source.length) {
        result += " ";
        index += 1;
      }
      continue;
    }
    if (current === ",") {
      let lookahead = index + 1;
      while (lookahead < source.length && /\s/.test(source[lookahead] ?? "")) lookahead += 1;
      if (source[lookahead] === "}" || source[lookahead] === "]") {
        result += " ";
        continue;
      }
    }
    result += current;
  }
  return result;
}
