import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, Language, type Node, type Tree } from "web-tree-sitter";
import * as tsModule from "typescript";

const require = createRequire(import.meta.url);
const ts: any = tsModule;

export type OutlineSymbolKind =
  | "function"
  | "method"
  | "class"
  | "struct"
  | "interface"
  | "enum"
  | "variant"
  | "trait"
  | "impl"
  | "type"
  | "module"
  | "constant"
  | "variable";

export type OutlineSymbol = {
  name: string;
  kind: OutlineSymbolKind;
  startLine: number;
  endLine: number;
  signature?: string;
  children?: OutlineSymbol[];
};

export type FileOutlineResult = {
  filePath: string;
  language: string | null;
  totalLines: number;
  symbols: OutlineSymbol[];
  formatted: string;
};

export type SymbolEdit = {
  start: number;
  end: number;
  line: number;
  column: number;
  oldText: string;
  newText: string;
  preview: string;
};

export type FileRenameResult = {
  filePath: string;
  editsCount: number;
  edits: SymbolEdit[];
  newContent: string;
  applied: boolean;
};

let parserInitPromise: Promise<void> | null = null;
let parserInstance: Parser | null = null;
const languageCache = new Map<string, Language>();

// Perf: parsing an 800KB/16k-line file costs ~200-500ms. analyze_coupling and
// other flows call analyzeBlockScope dozens of times on the SAME content
// string; re-parsing every time turns seconds into minutes on App.tsx.
// Cache one SourceFile per filePath, hit when the exact same content is passed.
const sourceFileCache = new Map<string, { content: string; sf: any }>();
const SOURCE_FILE_CACHE_LIMIT = 20;
function getCachedSourceFile(filePath: string, content: string): any {
  const hit = sourceFileCache.get(filePath);
  if (hit && hit.content === content) return hit.sf;
  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  if (sourceFileCache.size >= SOURCE_FILE_CACHE_LIMIT) {
    const oldest = sourceFileCache.keys().next();
    if (!oldest.done) sourceFileCache.delete(oldest.value);
  }
  sourceFileCache.set(filePath, { content, sf });
  return sf;
}

export function getTreeSitterWasmPath(): string | null {
  const candidates: string[] = [];

  // 1. Explicit require.resolve of exported subpath "./tree-sitter.wasm"
  try {
    const resolved = require.resolve("web-tree-sitter/tree-sitter.wasm");
    if (resolved) candidates.push(resolved);
  } catch {}

  // 2. Relative to current bundled server location (e.g. dist/ or resources/desktop/server/)
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(currentDir, "node_modules", "web-tree-sitter", "tree-sitter.wasm"));
    candidates.push(join(currentDir, "../node_modules", "web-tree-sitter", "tree-sitter.wasm"));
    candidates.push(join(currentDir, "../../node_modules", "web-tree-sitter", "tree-sitter.wasm"));
  } catch {}

  // 3. Relative to process.cwd() (e.g. desktop root or project root)
  candidates.push(join(process.cwd(), "server", "node_modules", "web-tree-sitter", "tree-sitter.wasm"));
  candidates.push(join(process.cwd(), "desktop-resources", "server", "node_modules", "web-tree-sitter", "tree-sitter.wasm"));
  candidates.push(join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"));

  // 4. Electron resourcesPath
  const candidateResources = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (candidateResources) {
    candidates.push(join(candidateResources, "desktop", "server", "node_modules", "web-tree-sitter", "tree-sitter.wasm"));
    candidates.push(join(candidateResources, "desktop", "node_modules", "web-tree-sitter", "tree-sitter.wasm"));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getLanguageWasmPath(langName: string): string | null {
  const fileName = `tree-sitter-${langName}.wasm`;
  const candidates: string[] = [];

  // 1. Resolved via package.json of tree-sitter-wasms
  try {
    const wasmPkg = require.resolve("tree-sitter-wasms/package.json");
    candidates.push(join(dirname(wasmPkg), "out", fileName));
  } catch {}

  // 2. Relative to import.meta.url
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(currentDir, "node_modules", "tree-sitter-wasms", "out", fileName));
    candidates.push(join(currentDir, "../node_modules", "tree-sitter-wasms", "out", fileName));
    candidates.push(join(currentDir, "../../node_modules", "tree-sitter-wasms", "out", fileName));
  } catch {}

  // 3. Relative to process.cwd()
  candidates.push(join(process.cwd(), "server", "node_modules", "tree-sitter-wasms", "out", fileName));
  candidates.push(join(process.cwd(), "desktop-resources", "server", "node_modules", "tree-sitter-wasms", "out", fileName));
  candidates.push(join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", fileName));

  // 4. Electron resourcesPath
  const candidateResources = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (candidateResources) {
    candidates.push(join(candidateResources, "desktop", "server", "node_modules", "tree-sitter-wasms", "out", fileName));
    candidates.push(join(candidateResources, "desktop", "node_modules", "tree-sitter-wasms", "out", fileName));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function initTreeSitter(): Promise<boolean> {
  if (parserInstance) return true;
  if (parserInitPromise) {
    await parserInitPromise;
    return Boolean(parserInstance);
  }
  parserInitPromise = (async () => {
    try {
      const wasmPath = getTreeSitterWasmPath();
      if (!wasmPath || !existsSync(wasmPath)) {
        console.warn("[saVmTreeSitter] tree-sitter.wasm not found, skipping tree-sitter initialization");
        parserInstance = null;
        return;
      }
      await Parser.init({
        locateFile: () => wasmPath,
      });
      parserInstance = new Parser();
    } catch (err) {
      console.warn("[saVmTreeSitter] Failed to initialize web-tree-sitter:", err);
      parserInstance = null;
    }
  })();
  await parserInitPromise;
  return Boolean(parserInstance);
}

export function getLanguageNameForFile(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".jsx":
      return "javascript";
    case ".rs":
      return "rust";
    case ".py":
    case ".pyw":
      return "python";
    case ".go":
      return "go";
    case ".zig":
      return "zig";
    case ".c":
    case ".h":
      return "c";
    case ".cpp":
    case ".cc":
    case ".cxx":
    case ".hpp":
    case ".hxx":
      return "cpp";
    case ".java":
      return "java";
    case ".cs":
      return "c_sharp";
    case ".json":
      return "json";
    case ".toml":
      return "toml";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".sh":
    case ".bash":
      return "bash";
    default:
      return null;
  }
}

export async function loadLanguageForFile(filePath: string): Promise<Language | null> {
  const langName = getLanguageNameForFile(filePath);
  if (!langName) return null;
  if (languageCache.has(langName)) {
    return languageCache.get(langName)!;
  }
  const ok = await initTreeSitter();
  if (!ok) return null;

  try {
    const wasmPath = getLanguageWasmPath(langName);
    if (!wasmPath || !existsSync(wasmPath)) {
      console.warn(`[saVmTreeSitter] Language grammar wasm for ${langName} not found`);
      return null;
    }
    const lang = await Language.load(wasmPath);
    languageCache.set(langName, lang);
    return lang;
  } catch (err) {
    console.warn(`[saVmTreeSitter] Failed to load language grammar for ${langName}:`, err);
    return null;
  }
}

/** Check if an AST node is located inside comments or string literals. */
export function isInsideCommentOrString(node: Node | null): boolean {
  let curr: Node | null = node;
  while (curr) {
    const t = curr.type;
    if (
      t.includes("comment") ||
      t.includes("string") ||
      t === "raw_string_literal" ||
      t === "template_string" ||
      t === "string_content" ||
      t === "string_fragment" ||
      t === "escape_sequence"
    ) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

/** Format symbol outline as a compact tree text for LLM. */
export function formatOutlineAsTree(filePath: string, totalLines: number, symbols: OutlineSymbol[]): string {
  const lines: string[] = [`[outline] ${filePath} (${totalLines} lines, ${symbols.length} top-level symbols)`];
  if (symbols.length === 0) {
    lines.push("  (no top-level structural declarations found)");
    return lines.join("\n");
  }

  function printSymbols(list: OutlineSymbol[], prefix: string) {
    for (let i = 0; i < list.length; i++) {
      const sym = list[i];
      if (!sym) continue;
      const isLast = i === list.length - 1;
      const branch = isLast ? "└── " : "├── ";
      const nextPrefix = prefix + (isLast ? "    " : "│   ");
      const range = `[L${sym.startLine}-${sym.endLine}]`;
      const sig = sym.signature ? ` (${sym.signature})` : "";
      lines.push(`${prefix}${branch}${sym.kind} ${sym.name} ${range}${sig}`);
      if (sym.children && sym.children.length > 0) {
        printSymbols(sym.children, nextPrefix);
      }
    }
  }

  printSymbols(symbols, "");
  return lines.join("\n");
}

function truncateSignature(text: string, maxLen = 60): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= maxLen) return single;
  return `${single.slice(0, maxLen - 3)}...`;
}

// Language-specific node visitors

function collectRustSymbols(node: Node, detail: boolean): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "struct_item") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      const sym: OutlineSymbol = {
        name,
        kind: "struct",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      };
      symbols.push(sym);
    } else if (child.type === "enum_item") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      const sym: OutlineSymbol = {
        name,
        kind: "enum",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      };
      if (detail) {
        const body = child.childForFieldName("body");
        if (body) {
          const variants: OutlineSymbol[] = [];
          for (let j = 0; j < body.childCount; j++) {
            const v = body.child(j);
            if (v?.type === "enum_variant") {
              const vName = v.childForFieldName("name")?.text || v.text.trim();
              variants.push({
                name: vName,
                kind: "variant",
                startLine: v.startPosition.row + 1,
                endLine: v.endPosition.row + 1
              });
            }
          }
          if (variants.length > 0) sym.children = variants;
        }
      }
      symbols.push(sym);
    } else if (child.type === "trait_item") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      const sym: OutlineSymbol = {
        name,
        kind: "trait",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      };
      const body = child.childForFieldName("body");
      if (body) {
        const methods: OutlineSymbol[] = [];
        for (let j = 0; j < body.childCount; j++) {
          const item = body.child(j);
          if (item?.type === "function_item" || item?.type === "function_signature_item") {
            const mName = item.childForFieldName("name")?.text || "(anonymous)";
            methods.push({
              name: mName,
              kind: "method",
              startLine: item.startPosition.row + 1,
              endLine: item.endPosition.row + 1
            });
          }
        }
        if (methods.length > 0) sym.children = methods;
      }
      symbols.push(sym);
    } else if (child.type === "impl_item") {
      const typeNode = child.childForFieldName("type");
      const traitNode = child.childForFieldName("trait");
      const typeName = typeNode?.text || "(anonymous)";
      const name = traitNode ? `${traitNode.text} for ${typeName}` : typeName;
      const sym: OutlineSymbol = {
        name: `impl ${name}`,
        kind: "impl",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      };
      const body = child.childForFieldName("body");
      if (body) {
        const methods: OutlineSymbol[] = [];
        for (let j = 0; j < body.childCount; j++) {
          const item = body.child(j);
          if (item?.type === "function_item") {
            const mName = item.childForFieldName("name")?.text || "(anonymous)";
            methods.push({
              name: mName,
              kind: "method",
              startLine: item.startPosition.row + 1,
              endLine: item.endPosition.row + 1
            });
          }
        }
        if (methods.length > 0) sym.children = methods;
      }
      symbols.push(sym);
    } else if (child.type === "function_item") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name,
        kind: "function",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      });
    } else if (child.type === "type_item") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name,
        kind: "type",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      });
    } else if (child.type === "mod_item") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name,
        kind: "module",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      });
    }
  }
  return symbols;
}

function collectTsSymbols(node: Node, detail: boolean): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];

  function visitDeclaration(d: Node | null, exported = false) {
    if (!d) return;
    if (d.type === "export_statement") {
      const decl = d.childForFieldName("declaration");
      if (decl) {
        visitDeclaration(decl, true);
      } else {
        // e.g. export { a, b }
        for (let i = 0; i < d.childCount; i++) {
          const c = d.child(i);
          if (c && c.type !== "export" && c.type !== "{" && c.type !== "}") {
            visitDeclaration(c, true);
          }
        }
      }
      return;
    }

    if (d.type === "function_declaration") {
      const name = d.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name: exported ? `export ${name}` : name,
        kind: "function",
        startLine: d.startPosition.row + 1,
        endLine: d.endPosition.row + 1
      });
    } else if (d.type === "class_declaration") {
      const name = d.childForFieldName("name")?.text || "(anonymous)";
      const sym: OutlineSymbol = {
        name: exported ? `export ${name}` : name,
        kind: "class",
        startLine: d.startPosition.row + 1,
        endLine: d.endPosition.row + 1
      };
      const body = d.childForFieldName("body");
      if (body) {
        const methods: OutlineSymbol[] = [];
        for (let j = 0; j < body.childCount; j++) {
          const m = body.child(j);
          if (m?.type === "method_definition") {
            const mName = m.childForFieldName("name")?.text || "(anonymous)";
            methods.push({
              name: mName,
              kind: "method",
              startLine: m.startPosition.row + 1,
              endLine: m.endPosition.row + 1
            });
          }
        }
        if (methods.length > 0) sym.children = methods;
      }
      symbols.push(sym);
    } else if (d.type === "interface_declaration") {
      const name = d.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name: exported ? `export ${name}` : name,
        kind: "interface",
        startLine: d.startPosition.row + 1,
        endLine: d.endPosition.row + 1
      });
    } else if (d.type === "type_alias_declaration") {
      const name = d.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name: exported ? `export ${name}` : name,
        kind: "type",
        startLine: d.startPosition.row + 1,
        endLine: d.endPosition.row + 1
      });
    } else if (d.type === "enum_declaration") {
      const name = d.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name: exported ? `export ${name}` : name,
        kind: "enum",
        startLine: d.startPosition.row + 1,
        endLine: d.endPosition.row + 1
      });
    } else if (d.type === "lexical_declaration" || d.type === "variable_declaration") {
      for (let j = 0; j < d.childCount; j++) {
        const decl = d.child(j);
        if (decl?.type === "variable_declarator") {
          const name = decl.childForFieldName("name")?.text || "(anonymous)";
          const value = decl.childForFieldName("value");
          const isFunc = value?.type === "arrow_function" || value?.type === "function_expression";
          if (isFunc || exported || detail) {
            symbols.push({
              name: exported ? `export ${name}` : name,
              kind: isFunc ? "function" : "constant",
              startLine: d.startPosition.row + 1,
              endLine: d.endPosition.row + 1
            });
          }
        }
      }
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    visitDeclaration(node.child(i), false);
  }
  return symbols;
}

function collectPythonSymbols(node: Node, isMethod = false): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "decorated_definition") {
      const def = child.childForFieldName("definition") ?? child.lastNamedChild;
      if (def) {
        if (def.type === "function_definition") {
          const name = def.childForFieldName("name")?.text || "(anonymous)";
          symbols.push({
            name,
            kind: isMethod ? "method" : "function",
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1
          });
        } else if (def.type === "class_definition") {
          const name = def.childForFieldName("name")?.text || "(anonymous)";
          const sym: OutlineSymbol = {
            name,
            kind: "class",
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1
          };
          const body = def.childForFieldName("body");
          if (body) {
            const inner = collectPythonSymbols(body, true);
            if (inner.length > 0) sym.children = inner;
          }
          symbols.push(sym);
        }
      }
    } else if (child.type === "function_definition") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name,
        kind: isMethod ? "method" : "function",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      });
    } else if (child.type === "class_definition") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      const sym: OutlineSymbol = {
        name,
        kind: "class",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      };
      const body = child.childForFieldName("body");
      if (body) {
        const inner = collectPythonSymbols(body, true);
        if (inner.length > 0) sym.children = inner;
      }
      symbols.push(sym);
    }
  }
  return symbols;
}

function collectGoSymbols(node: Node): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "function_declaration") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name,
        kind: "function",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      });
    } else if (child.type === "method_declaration") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      const receiver = child.childForFieldName("receiver")?.text || "";
      symbols.push({
        name: receiver ? `${receiver}.${name}` : name,
        kind: "method",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      });
    } else if (child.type === "type_declaration") {
      for (let j = 0; j < child.childCount; j++) {
        const spec = child.child(j);
        if (spec?.type === "type_spec") {
          const name = spec.childForFieldName("name")?.text || "(anonymous)";
          const typeNode = spec.childForFieldName("type");
          const isStruct = typeNode?.type === "struct_type";
          const isInterface = typeNode?.type === "interface_type";
          symbols.push({
            name,
            kind: isStruct ? "struct" : isInterface ? "interface" : "type",
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1
          });
        }
      }
    }
  }
  return symbols;
}

function collectZigSymbols(node: Node): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "function_declaration" || child.type === "fn_proto") {
      const name = child.childForFieldName("name")?.text || child.text.split("(")[0]?.trim() || "(anonymous)";
      symbols.push({
        name,
        kind: "function",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      });
    } else if (child.type === "variable_declaration") {
      const text = child.text;
      const isStruct = text.includes("struct");
      const isEnum = text.includes("enum");
      const nameMatch = text.match(/(?:pub\s+)?(?:const|var)\s+([a-zA-Z0-9_]+)/);
      if (nameMatch && nameMatch[1]) {
        symbols.push({
          name: nameMatch[1],
          kind: isStruct ? "struct" : isEnum ? "enum" : "constant",
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1
        });
      }
    }
  }
  return symbols;
}

function collectCppSymbols(node: Node): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "function_definition") {
      const declarator = child.childForFieldName("declarator");
      const name = declarator?.text || "(anonymous)";
      symbols.push({
        name: truncateSignature(name, 40),
        kind: "function",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      });
    } else if (child.type === "class_specifier" || child.type === "struct_specifier") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name,
        kind: child.type === "class_specifier" ? "class" : "struct",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      });
    } else if (child.type === "enum_specifier") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name,
        kind: "enum",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      });
    } else if (child.type === "namespace_definition") {
      const name = child.childForFieldName("name")?.text || "(anonymous)";
      symbols.push({
        name,
        kind: "module",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1
      });
    }
  }
  return symbols;
}

/** Fallback regex-based outline when tree-sitter is unavailable for a language. */
function extractRegexOutline(content: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  const lines = content.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) continue;

    // Functions
    const fnMatch = trimmed.match(/^(?:export\s+)?(?:pub\s+)?(?:async\s+)?(?:fn|def|func|function)\s+([a-zA-Z0-9_]+)/);
    if (fnMatch && fnMatch[1]) {
      symbols.push({ name: fnMatch[1], kind: "function", startLine: idx + 1, endLine: idx + 1 });
      continue;
    }

    // Classes / Structs / Interfaces
    const typeMatch = trimmed.match(/^(?:export\s+)?(?:pub\s+)?(?:class|struct|interface|trait|enum)\s+([a-zA-Z0-9_]+)/);
    if (typeMatch && typeMatch[1]) {
      const kind = trimmed.includes("class") ? "class" : trimmed.includes("struct") ? "struct" : trimmed.includes("interface") ? "interface" : trimmed.includes("enum") ? "enum" : "trait";
      symbols.push({ name: typeMatch[1], kind, startLine: idx + 1, endLine: idx + 1 });
      continue;
    }

    // Rust impl
    const implMatch = trimmed.match(/^impl(?:\s*<[^>]+>)?\s+(.+?)(?:\{|$)/);
    if (implMatch && implMatch[1]) {
      symbols.push({ name: `impl ${implMatch[1].trim()}`, kind: "impl", startLine: idx + 1, endLine: idx + 1 });
      continue;
    }
  }

  return symbols;
}

/** Extract structural outline of any supported source file. */
export async function extractFileOutline(
  filePath: string,
  content: string,
  options: { detail?: boolean } = {}
): Promise<FileOutlineResult> {
  const totalLines = content.split(/\r?\n/).length;
  const langName = getLanguageNameForFile(filePath);
  const detail = options.detail === true;

  if (!langName) {
    const fallbackSymbols = extractRegexOutline(content);
    return {
      filePath,
      language: null,
      totalLines,
      symbols: fallbackSymbols,
      formatted: formatOutlineAsTree(filePath, totalLines, fallbackSymbols)
    };
  }

  const lang = await loadLanguageForFile(filePath);
  if (!lang || !parserInstance) {
    const fallbackSymbols = extractRegexOutline(content);
    return {
      filePath,
      language: langName,
      totalLines,
      symbols: fallbackSymbols,
      formatted: formatOutlineAsTree(filePath, totalLines, fallbackSymbols)
    };
  }

  parserInstance.setLanguage(lang);
  const tree: Tree | null = parserInstance.parse(content);
  if (!tree) {
    const fallbackSymbols = extractRegexOutline(content);
    return {
      filePath,
      language: langName,
      totalLines,
      symbols: fallbackSymbols,
      formatted: formatOutlineAsTree(filePath, totalLines, fallbackSymbols)
    };
  }
  const root = tree.rootNode;

  let symbols: OutlineSymbol[] = [];
  switch (langName) {
    case "rust":
      symbols = collectRustSymbols(root, detail);
      break;
    case "typescript":
    case "tsx":
    case "javascript":
      symbols = collectTsSymbols(root, detail);
      break;
    case "python":
      symbols = collectPythonSymbols(root, false);
      break;
    case "go":
      symbols = collectGoSymbols(root);
      break;
    case "zig":
      symbols = collectZigSymbols(root);
      break;
    case "c":
    case "cpp":
      symbols = collectCppSymbols(root);
      break;
    default:
      symbols = extractRegexOutline(content);
      break;
  }

  return {
    filePath,
    language: langName,
    totalLines,
    symbols,
    formatted: formatOutlineAsTree(filePath, totalLines, symbols)
  };
}

/**
 * Safely rename a symbol within a file using Tree-sitter AST.
 * Skips comments, string literals, and identifiers that don't match the exact symbol boundary.
 */
export async function renameSymbolInContent(
  filePath: string,
  content: string,
  oldName: string,
  newName: string
): Promise<{ newContent: string; edits: SymbolEdit[] }> {
  if (oldName === newName || !oldName.trim()) {
    return { newContent: content, edits: [] };
  }

  const lang = await loadLanguageForFile(filePath);
  if (!lang || !parserInstance) {
    return fallbackRegexRename(content, oldName, newName);
  }

  parserInstance.setLanguage(lang);
  const tree: Tree | null = parserInstance.parse(content);
  if (!tree) {
    return fallbackRegexRename(content, oldName, newName);
  }
  const edits: SymbolEdit[] = [];
  const lines = content.split(/\r?\n/);

  function walk(node: Node) {
    // Check if the node represents an identifier or property name
    if (
      node.type === "identifier" ||
      node.type === "type_identifier" ||
      node.type === "field_identifier" ||
      node.type === "property_identifier" ||
      node.type === "shorthand_property_identifier" ||
      node.type === "scoped_identifier" ||
      node.type === "constant"
    ) {
      if (node.text === oldName) {
        if (!isInsideCommentOrString(node)) {
          const row = node.startPosition.row;
          const col = node.startPosition.column;
          const lineText = lines[row] ?? "";
          edits.push({
            start: node.startIndex,
            end: node.endIndex,
            line: row + 1,
            column: col + 1,
            oldText: oldName,
            newText: newName,
            preview: lineText.trim()
          });
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(tree.rootNode);

  if (edits.length === 0) {
    return { newContent: content, edits: [] };
  }

  // Sort edits from end to start so index offsets remain valid during replacement
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let result = content;
  for (const edit of sorted) {
    result = result.slice(0, edit.start) + newName + result.slice(edit.end);
  }

  return { newContent: result, edits };
}

function fallbackRegexRename(
  content: string,
  oldName: string,
  newName: string
): { newContent: string; edits: SymbolEdit[] } {
  const wordRegex = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const edits: SymbolEdit[] = [];
  const lines = content.split(/\r?\n/);

  let match: RegExpExecArray | null = null;
  while ((match = wordRegex.exec(content)) !== null) {
    const start = match.index;
    const end = start + oldName.length;

    // Line and col calculation
    const before = content.slice(0, start);
    const lineNum = before.split(/\r?\n/).length;
    const lineStartIndex = before.lastIndexOf("\n") === -1 ? 0 : before.lastIndexOf("\n") + 1;
    const colNum = start - lineStartIndex + 1;
    const lineText = lines[lineNum - 1] ?? "";

    // Simple heuristic: skip if line starts with comment markers
    const trimmed = lineText.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }

    edits.push({
      start,
      end,
      line: lineNum,
      column: colNum,
      oldText: oldName,
      newText: newName,
      preview: lineText.trim()
    });
  }

  if (edits.length === 0) return { newContent: content, edits: [] };

  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let result = content;
  for (const edit of sorted) {
    result = result.slice(0, edit.start) + newName + result.slice(edit.end);
  }

  return { newContent: result, edits };
}

export type DefinitionMatch = {
  filePath: string;
  symbol: string;
  kind: OutlineSymbolKind;
  startLine: number;
  endLine: number;
  signature: string;
  bodySnippet: string;
};

export async function findDefinitionInContent(
  filePath: string,
  content: string,
  targetSymbol: string,
  options: { includeBody?: boolean; maxBodyLines?: number } = {}
): Promise<DefinitionMatch | null> {
  const sym = targetSymbol.trim();
  if (!sym) return null;

  const langName = getLanguageNameForFile(filePath);
  const lines = content.split(/\r?\n/);
  const maxLines = options.maxBodyLines ?? 40;

  if (!langName) {
    return fallbackFindDefinition(filePath, content, sym, options);
  }

  const lang = await loadLanguageForFile(filePath);
  if (!lang || !parserInstance) {
    return fallbackFindDefinition(filePath, content, sym, options);
  }

  parserInstance.setLanguage(lang);
  const tree = parserInstance.parse(content);
  if (!tree) {
    return fallbackFindDefinition(filePath, content, sym, options);
  }

  let matchedNode: Node | null = null;
  let matchedKind: OutlineSymbolKind = "function";

  function walk(node: Node) {
    if (matchedNode) return;

    let candidateName: string | null = null;
    let kind: OutlineSymbolKind = "function";

    if (node.type === "function_declaration" || node.type === "function_item" || node.type === "function_definition" || node.type === "fn_proto") {
      candidateName = node.childForFieldName("name")?.text || null;
      kind = "function";
    } else if (node.type === "class_declaration" || node.type === "class_definition" || node.type === "class_specifier") {
      candidateName = node.childForFieldName("name")?.text || null;
      kind = "class";
    } else if (node.type === "struct_item" || node.type === "struct_specifier") {
      candidateName = node.childForFieldName("name")?.text || null;
      kind = "struct";
    } else if (node.type === "interface_declaration") {
      candidateName = node.childForFieldName("name")?.text || null;
      kind = "interface";
    } else if (node.type === "type_alias_declaration" || node.type === "type_item") {
      candidateName = node.childForFieldName("name")?.text || null;
      kind = "type";
    } else if (node.type === "type_spec") {
      candidateName = node.childForFieldName("name")?.text || null;
      const typeNode = node.childForFieldName("type");
      kind = typeNode?.type === "struct_type" ? "struct" : typeNode?.type === "interface_type" ? "interface" : "type";
    } else if (node.type === "enum_declaration" || node.type === "enum_item" || node.type === "enum_specifier") {
      candidateName = node.childForFieldName("name")?.text || null;
      kind = "enum";
    } else if (node.type === "trait_item") {
      candidateName = node.childForFieldName("name")?.text || null;
      kind = "trait";
    } else if (node.type === "method_definition" || node.type === "method_declaration") {
      candidateName = node.childForFieldName("name")?.text || null;
      kind = "method";
    } else if (node.type === "variable_declarator") {
      candidateName = node.childForFieldName("name")?.text || null;
      const val = node.childForFieldName("value");
      kind = (val?.type === "arrow_function" || val?.type === "function_expression") ? "function" : "constant";
    } else if (node.type === "const_item" || node.type === "static_item") {
      candidateName = node.childForFieldName("name")?.text || null;
      kind = "constant";
    }

    if (candidateName === sym) {
      let target = node;
      if (node.type === "variable_declarator") {
        if (node.parent && (node.parent.type === "lexical_declaration" || node.parent.type === "variable_declaration")) {
          target = node.parent;
        }
      }
      if (target.parent?.type === "export_statement") {
        target = target.parent;
      }
      matchedNode = target;
      matchedKind = kind;
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(tree.rootNode);

  if (!matchedNode) {
    return fallbackFindDefinition(filePath, content, sym, options);
  }

  const targetNode: Node = matchedNode;
  const startRow = targetNode.startPosition.row;
  const endRow = targetNode.endPosition.row;
  const startLine = startRow + 1;
  const endLine = endRow + 1;

  let sig = "";
  for (let r = startRow; r <= Math.min(endRow, startRow + 3); r++) {
    const l = (lines[r] ?? "").trim();
    sig = sig ? `${sig} ${l}` : l;
    if (l.includes("{") || l.endsWith(":") || l.endsWith(";") || l.includes("=>")) {
      break;
    }
  }

  const actualEnd = Math.min(endRow, startRow + maxLines - 1);
  const snippetLines: string[] = [];
  for (let r = startRow; r <= actualEnd; r++) {
    snippetLines.push(`${r + 1}: ${lines[r] ?? ""}`);
  }
  if (endRow > actualEnd) {
    snippetLines.push(`  ... (${endRow - actualEnd} more lines)`);
  }

  return {
    filePath,
    symbol: sym,
    kind: matchedKind,
    startLine,
    endLine,
    signature: truncateSignature(sig, 120),
    bodySnippet: snippetLines.join("\n")
  };
}

function fallbackFindDefinition(
  filePath: string,
  content: string,
  targetSymbol: string,
  options: { includeBody?: boolean; maxBodyLines?: number } = {}
): DefinitionMatch | null {
  const lines = content.split(/\r?\n/);
  const symRegex = new RegExp(`(?:export\\s+)?(?:pub\\s+)?(?:async\\s+)?(?:fn|def|func|function|class|struct|interface|trait|enum|type|const|let|var)\\s+${targetSymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    if (symRegex.test(line)) {
      const startLine = idx + 1;
      const maxLines = options.maxBodyLines ?? 40;
      const endLine = Math.min(lines.length, startLine + maxLines - 1);
      const snippetLines: string[] = [];
      for (let r = idx; r < endLine; r++) {
        snippetLines.push(`${r + 1}: ${lines[r] ?? ""}`);
      }
      return {
        filePath,
        symbol: targetSymbol,
        kind: line.includes("class") ? "class" : line.includes("struct") ? "struct" : line.includes("interface") ? "interface" : line.includes("enum") ? "enum" : "function",
        startLine,
        endLine,
        signature: line.trim(),
        bodySnippet: snippetLines.join("\n")
      };
    }
  }
  return null;
}

export type SyntaxDiagnostic = {
  line: number;
  column: number;
  message: string;
  preview: string;
  code?: string | number;
};

export type SyntaxDiagnosticsResult = {
  filePath: string;
  clean: boolean;
  errorsCount: number;
  errors: SyntaxDiagnostic[];
  formatted: string;
};

function formatDiagnostics(filePath: string, errors: SyntaxDiagnostic[]): string {
  if (errors.length === 0) {
    return `[diagnostics] ✓ ${filePath}: Clean (0 syntax errors).`;
  }
  const out: string[] = [`[diagnostics] Found ${errors.length} syntax error(s) in ${filePath}:`];
  for (const e of errors.slice(0, 10)) {
    out.push(`- L${e.line}:${e.column} - ${e.message}`);
    if (e.preview) {
      out.push(`    ${e.preview}`);
    }
  }
  if (errors.length > 10) {
    out.push(`  ... (${errors.length - 10} more error(s) truncated)`);
  }
  return out.join("\n");
}

export async function getSyntaxDiagnostics(
  filePath: string,
  content: string
): Promise<SyntaxDiagnosticsResult> {
  const ext = extname(filePath).toLowerCase();
  const isTsJs = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].includes(ext);

  if (isTsJs) {
    try {
      const sf = getCachedSourceFile(filePath, content);
      const diags = sf.parseDiagnostics || [];
      const lines = content.split(/\r?\n/);
      const errors: SyntaxDiagnostic[] = diags.map((d: any) => {
        const { line, character } = ts.getLineAndCharacterOfPosition(sf, d.start);
        const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
        const preview = (lines[line] ?? "").trim();
        const code = d.code ? (typeof d.code === "number" ? `TS${d.code}` : String(d.code)) : undefined;
        return {
          line: line + 1,
          column: character + 1,
          message,
          preview,
          code
        };
      });

      // React Hook rules checking for .tsx / .jsx files
      if (ext === ".tsx" || ext === ".jsx") {
        function checkHookRulesInStatements(bodyStatements: any[]) {
          let hasEarlyReturn = false;
          let earlyReturnLine = -1;

          for (const stmt of bodyStatements) {
            let stmtIsEarlyReturn = false;
            if (ts.isIfStatement(stmt)) {
              const thenHasReturn = stmt.thenStatement && (
                ts.isReturnStatement(stmt.thenStatement) ||
                (ts.isBlock(stmt.thenStatement) && stmt.thenStatement.statements.some((s: any) => ts.isReturnStatement(s)))
              );
              if (thenHasReturn && !hasEarlyReturn) {
                stmtIsEarlyReturn = true;
                hasEarlyReturn = true;
                const { line } = ts.getLineAndCharacterOfPosition(sf, stmt.getStart());
                earlyReturnLine = line + 1;
              }
            } else if (ts.isReturnStatement(stmt) && !hasEarlyReturn) {
              stmtIsEarlyReturn = true;
              hasEarlyReturn = true;
              const { line } = ts.getLineAndCharacterOfPosition(sf, stmt.getStart());
              earlyReturnLine = line + 1;
            }

            function inspectNodeForHooks(node: any, insideConditional: boolean) {
              if (ts.isCallExpression(node)) {
                let callName = "";
                if (ts.isIdentifier(node.expression)) {
                  callName = node.expression.text;
                } else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) {
                  callName = node.expression.name.text;
                }
                if (/^use[A-Z0-9]/.test(callName)) {
                  const { line, character } = ts.getLineAndCharacterOfPosition(sf, node.getStart());
                  const hookLine = line + 1;
                  if (hasEarlyReturn && hookLine > earlyReturnLine && !stmtIsEarlyReturn) {
                    errors.push({
                      line: hookLine,
                      column: character + 1,
                      message: `React Hook '${callName}' is called after an early return at line ${earlyReturnLine}. This violates the Rules of Hooks and causes React crashes.`,
                      preview: (lines[line] ?? "").trim(),
                      code: "REACT_HOOK_RULE"
                    });
                  } else if (insideConditional) {
                    errors.push({
                      line: hookLine,
                      column: character + 1,
                      message: `React Hook '${callName}' is called conditionally inside a branch or loop. Hooks must be called unconditionally at top level.`,
                      preview: (lines[line] ?? "").trim(),
                      code: "REACT_HOOK_RULE"
                    });
                  }
                }
              }

              const isBranch = ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isSwitchStatement(node);
              ts.forEachChild(node, (child: any) => inspectNodeForHooks(child, insideConditional || isBranch));
            }

            if (ts.isIfStatement(stmt)) {
              inspectNodeForHooks(stmt, true);
            } else {
              inspectNodeForHooks(stmt, false);
            }
          }
        }

        function walkComponentNodes(node: any) {
          if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
            const fnName = node.name && ts.isIdentifier(node.name) ? node.name.text : "";
            const isComponentOrHook = /^[A-Z]/.test(fnName) || /^use[A-Z]/.test(fnName);
            if ((isComponentOrHook || node.body) && node.body && ts.isBlock(node.body)) {
              checkHookRulesInStatements(node.body.statements);
            }
          }
          ts.forEachChild(node, walkComponentNodes);
        }

        walkComponentNodes(sf);
      }

      return {
        filePath,
        clean: errors.length === 0,
        errorsCount: errors.length,
        errors,
        formatted: formatDiagnostics(filePath, errors)
      };
    } catch {
      // Fall through to tree-sitter
    }
  }

  const lang = await loadLanguageForFile(filePath);
  if (!lang || !parserInstance) {
    return {
      filePath,
      clean: true,
      errorsCount: 0,
      errors: [],
      formatted: `[diagnostics] ✓ ${filePath}: Language parser not loaded, no obvious syntax errors.`
    };
  }

  parserInstance.setLanguage(lang);
  const tree = parserInstance.parse(content);
  if (!tree || !tree.rootNode.hasError) {
    return {
      filePath,
      clean: true,
      errorsCount: 0,
      errors: [],
      formatted: `[diagnostics] ✓ ${filePath}: Clean (0 syntax errors).`
    };
  }

  const lines = content.split(/\r?\n/);
  const errors: SyntaxDiagnostic[] = [];

  function collectTreeErrors(node: Node) {
    if (node.isError || node.type === "ERROR" || node.isMissing) {
      const row = node.startPosition.row;
      const col = node.startPosition.column;
      const preview = (lines[row] ?? "").trim();
      const nodeText = node.text ? node.text.slice(0, 30).replace(/\s+/g, " ") : "";
      errors.push({
        line: row + 1,
        column: col + 1,
        message: node.isMissing ? `Missing expected token near '${preview}'` : `Syntax error near '${nodeText || preview}'`,
        preview,
        code: "SYNTAX_ERROR"
      });
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) collectTreeErrors(child);
    }
  }

  collectTreeErrors(tree.rootNode);

  return {
    filePath,
    clean: errors.length === 0,
    errorsCount: errors.length,
    errors,
    formatted: formatDiagnostics(filePath, errors)
  };
}

export function addImportToContent(
  _filePath: string,
  content: string,
  options: {
    statement?: string;
    symbol?: string;
    module?: string;
    isType?: boolean;
  }
): { newContent: string; applied: boolean; message: string } {
  let statement = (options.statement ?? "").trim();
  let symbol = (options.symbol ?? "").trim();
  let moduleName = (options.module ?? "").trim();

  // If statement is provided, parse module and symbols from it if possible
  if (statement && (!moduleName || !symbol)) {
    const namedMatch = statement.match(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (namedMatch && namedMatch[1] && namedMatch[2]) {
      symbol = namedMatch[1].trim();
      moduleName = namedMatch[2].trim();
    } else {
      const defaultMatch = statement.match(/import\s+([a-zA-Z0-9_$]+)\s+from\s+['"]([^'"]+)['"]/);
      if (defaultMatch && defaultMatch[1] && defaultMatch[2]) {
        symbol = defaultMatch[1].trim();
        moduleName = defaultMatch[2].trim();
      }
    }
  }

  if (!statement && symbol && moduleName) {
    const typePrefix = options.isType ? "type " : "";
    statement = `import { ${typePrefix}${symbol} } from "${moduleName}";`;
  }

  if (!statement) {
    return { newContent: content, applied: false, message: "Either 'statement' or 'symbol' + 'module' must be provided" };
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);

  // Check if module is already imported
  if (moduleName) {
    const escapedMod = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const importRegex = new RegExp(`^import\\s+(?:type\\s+)?(\\{[^}]+\\}|[a-zA-Z0-9_$]+)?\\s*from\\s*['"]${escapedMod}['"]`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (importRegex.test(line.trim())) {
        if (symbol) {
          const namedBrackets = line.match(/\{([^}]+)\}/);
          if (namedBrackets && namedBrackets[1]) {
            const existing = namedBrackets[1].split(",").map(s => s.trim()).filter(Boolean);
            const toAdd = symbol.split(",").map(s => s.trim()).filter(Boolean);
            const missing = toAdd.filter(s => !existing.includes(s));
            if (missing.length === 0) {
              return { newContent: content, applied: false, message: `Symbol(s) '${symbol}' already imported from '${moduleName}' (no-op).` };
            }
            const updatedSymbols = [...existing, ...missing].join(", ");
            lines[i] = line.replace(/\{[^}]+\}/, `{ ${updatedSymbols} }`);
            return { newContent: lines.join(eol), applied: true, message: `Merged '${missing.join(", ")}' into existing import from '${moduleName}' at line ${i + 1}.` };
          }
        }
      }
    }
  }

  // Find last import line in file
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] ?? "").trim();
    if (l.startsWith("import ") || l.startsWith("import{") || (l.startsWith("const ") && l.includes("require("))) {
      lastImportIdx = i;
    }
  }

  if (lastImportIdx !== -1) {
    lines.splice(lastImportIdx + 1, 0, statement);
    return { newContent: lines.join(eol), applied: true, message: `Inserted import after line ${lastImportIdx + 1}.` };
  }

  // If no imports found, insert after directives/shebang/header comments
  let insertIdx = 0;
  while (insertIdx < lines.length) {
    const l = (lines[insertIdx] ?? "").trim();
    if (
      l.startsWith("#!") ||
      l.startsWith("//") ||
      l.startsWith("/*") ||
      l.startsWith("*") ||
      l.endsWith("*/") ||
      l === '"use client";' ||
      l === '"use strict";' ||
      l === "'use client';" ||
      l === "'use strict';" ||
      l === ""
    ) {
      insertIdx++;
    } else {
      break;
    }
  }

  lines.splice(insertIdx, 0, statement, "");
  return { newContent: lines.join(eol), applied: true, message: `Inserted import at line ${insertIdx + 1}.` };
}

export interface OrganizeImportsResult {
  filePath: string;
  applied: boolean;
  changed: boolean;
  newContent: string;
  removedImportsCount: number;
  removedUnusedCount: number;
  mergedImportsCount: number;
  mergedCount: number;
  formatted: string;
  summary: string;
}

export function organizeImportsInContent(
  filePath: string,
  content: string,
  options: {
    removeUnused?: boolean;
    sort?: boolean;
    mergeDuplicates?: boolean;
  } = {}
): OrganizeImportsResult {
  const ext = extname(filePath).toLowerCase();
  const isTsJs = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].includes(ext);
  if (!isTsJs) {
    return {
      filePath,
      applied: false,
      changed: false,
      newContent: content,
      removedImportsCount: 0,
      removedUnusedCount: 0,
      mergedImportsCount: 0,
      mergedCount: 0,
      formatted: `[organize_imports] Skipped: ${filePath} is not a JavaScript/TypeScript file.`,
      summary: `Skipped: ${filePath} is not a JavaScript/TypeScript file.`
    };
  }

  const sf = getCachedSourceFile(filePath, content);

  const importStatements: any[] = [];
  const otherStatements: any[] = [];
  let firstImportStart = -1;
  let lastImportEnd = -1;

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      if (firstImportStart === -1) firstImportStart = stmt.getStart(sf);
      lastImportEnd = stmt.getEnd();
      importStatements.push(stmt);
    } else {
      otherStatements.push(stmt);
    }
  }

  if (importStatements.length === 0) {
    return {
      filePath,
      applied: false,
      changed: false,
      newContent: content,
      removedImportsCount: 0,
      removedUnusedCount: 0,
      mergedImportsCount: 0,
      mergedCount: 0,
      formatted: `[organize_imports] No imports found in ${filePath}.`,
      summary: `No imports found in ${filePath}.`
    };
  }

  const usedIdentifiers = new Set<string>();
  let hasJsx = false;

  function collectUsedIdentifiers(node: any) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      hasJsx = true;
      if (ts.isIdentifier(node.tagName)) {
        usedIdentifiers.add(node.tagName.text);
      } else if (ts.isPropertyAccessExpression(node.tagName)) {
        let curr = node.tagName;
        while (ts.isPropertyAccessExpression(curr)) {
          curr = curr.expression;
        }
        if (ts.isIdentifier(curr)) {
          usedIdentifiers.add(curr.text);
        }
      }
    } else if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (parent) {
        if (ts.isPropertyAssignment(parent) && parent.name === node) {
          // Key of { key: value }, not usage
        } else if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
          // Property of obj.prop, not standalone usage
        } else if (ts.isMethodDeclaration(parent) && parent.name === node) {
          // Method name
        } else if (ts.isPropertyDeclaration(parent) && parent.name === node) {
          // Property declaration
        } else {
          usedIdentifiers.add(node.text);
        }
      } else {
        usedIdentifiers.add(node.text);
      }
    }
    ts.forEachChild(node, collectUsedIdentifiers);
  }

  for (const stmt of otherStatements) {
    collectUsedIdentifiers(stmt);
  }

  if (hasJsx) {
    usedIdentifiers.add("React");
  }

  interface ParsedImport {
    moduleSpecifier: string;
    isTypeOnly: boolean;
    defaultName?: string;
    namespaceName?: string;
    namedImports: Array<{ name: string; propertyName?: string; isType: boolean }>;
    sideEffectOnly: boolean;
  }

  const parsedList: ParsedImport[] = [];
  let removedImportsCount = 0;

  for (const imp of importStatements) {
    const modSpec = imp.moduleSpecifier && ts.isStringLiteral(imp.moduleSpecifier)
      ? imp.moduleSpecifier.text
      : "";
    if (!modSpec) continue;

    if (!imp.importClause) {
      parsedList.push({
        moduleSpecifier: modSpec,
        isTypeOnly: false,
        namedImports: [],
        sideEffectOnly: true
      });
      continue;
    }

    const clause = imp.importClause;
    const isClauseTypeOnly = Boolean(clause.isTypeOnly);
    let defaultName = clause.name ? clause.name.text : undefined;
    let namespaceName: string | undefined;
    const namedImports: Array<{ name: string; propertyName?: string; isType: boolean }> = [];

    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        namespaceName = clause.namedBindings.name.text;
      } else if (ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          const propName = el.propertyName ? el.propertyName.text : undefined;
          const localName = el.name.text;
          const isType = isClauseTypeOnly || Boolean(el.isTypeOnly);
          namedImports.push({
            name: localName,
            propertyName: propName,
            isType
          });
        }
      }
    }

    if (options.removeUnused !== false) {
      if (defaultName && !usedIdentifiers.has(defaultName)) {
        removedImportsCount++;
        defaultName = undefined;
      }
      if (namespaceName && !usedIdentifiers.has(namespaceName)) {
        removedImportsCount++;
        namespaceName = undefined;
      }
      const beforeCount = namedImports.length;
      const keptNamed = namedImports.filter(n => usedIdentifiers.has(n.name));
      removedImportsCount += (beforeCount - keptNamed.length);
      namedImports.length = 0;
      namedImports.push(...keptNamed);

      if (!defaultName && !namespaceName && namedImports.length === 0) {
        continue;
      }
    }

    parsedList.push({
      moduleSpecifier: modSpec,
      isTypeOnly: isClauseTypeOnly,
      defaultName,
      namespaceName,
      namedImports,
      sideEffectOnly: false
    });
  }

  let mergedImportsCount = 0;
  const mergedMap = new Map<string, ParsedImport>();
  const finalImports: ParsedImport[] = [];

  for (const item of parsedList) {
    if (item.sideEffectOnly || item.namespaceName || item.defaultName || options.mergeDuplicates === false) {
      finalImports.push(item);
      continue;
    }
    const key = `${item.isTypeOnly ? "type:" : "val:"}${item.moduleSpecifier}`;
    const existing = mergedMap.get(key);
    if (existing) {
      mergedImportsCount++;
      for (const ni of item.namedImports) {
        if (!existing.namedImports.some(e => e.name === ni.name)) {
          existing.namedImports.push(ni);
        }
      }
    } else {
      mergedMap.set(key, item);
      finalImports.push(item);
    }
  }

  function getModulePriority(mod: string): number {
    if (mod.startsWith("node:") || ["fs", "path", "os", "crypto", "http", "https", "child_process", "events", "stream", "util", "url", "buffer"].includes(mod)) return 1;
    if (!mod.startsWith(".")) {
      if (mod.startsWith("@/") || mod.startsWith("@codex-ui/")) return 3;
      return 2;
    }
    if (mod.startsWith("..")) return 4;
    if (mod.startsWith(".")) {
      if (mod.endsWith(".css") || mod.endsWith(".scss") || mod.endsWith(".less")) return 6;
      return 5;
    }
    return 7;
  }

  if (options.sort !== false) {
    finalImports.sort((a, b) => {
      const prioA = getModulePriority(a.moduleSpecifier);
      const prioB = getModulePriority(b.moduleSpecifier);
      if (prioA !== prioB) return prioA - prioB;
      return a.moduleSpecifier.localeCompare(b.moduleSpecifier);
    });
  }

  const renderedLines: string[] = [];
  for (const item of finalImports) {
    if (item.sideEffectOnly) {
      renderedLines.push(`import "${item.moduleSpecifier}";`);
      continue;
    }
    const parts: string[] = [];
    if (item.defaultName) {
      parts.push(item.defaultName);
    }
    if (item.namespaceName) {
      parts.push(`* as ${item.namespaceName}`);
    }
    if (item.namedImports.length > 0) {
      item.namedImports.sort((a, b) => a.name.localeCompare(b.name));
      const namedStrings = item.namedImports.map(n => {
        const typePrefix = n.isType && !item.isTypeOnly ? "type " : "";
        if (n.propertyName && n.propertyName !== n.name) {
          return `${typePrefix}${n.propertyName} as ${n.name}`;
        }
        return `${typePrefix}${n.name}`;
      });
      parts.push(`{ ${namedStrings.join(", ")} }`);
    }

    const typePrefix = item.isTypeOnly ? "type " : "";
    renderedLines.push(`import ${typePrefix}${parts.join(", ")} from "${item.moduleSpecifier}";`);
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const newImportText = renderedLines.join(eol);

  const beforeImports = content.slice(0, firstImportStart);
  const afterImports = content.slice(lastImportEnd).replace(/^\r?\n/, "");
  const newContent = `${beforeImports}${newImportText}${eol}${eol}${afterImports.trimStart()}`;

  const applied = newContent !== content;
  return {
    filePath,
    applied,
    changed: applied,
    newContent,
    removedImportsCount,
    removedUnusedCount: removedImportsCount,
    mergedImportsCount,
    mergedCount: mergedImportsCount,
    formatted: `[organize_imports] ${applied ? "Organized" : "Clean"} in ${filePath}: removed ${removedImportsCount} unused specifier(s), merged ${mergedImportsCount} duplicate module(s).`,
    summary: `Organized imports in ${filePath}: removed ${removedImportsCount} unused specifier(s), merged ${mergedImportsCount} duplicate module(s).`
  };
}

export interface ScopeAnalysisResult {
  filePath: string;
  startLine: number;
  endLine: number;
  componentName: string;
  capturedVariables: Array<{ name: string; type: string; isFunction: boolean; isStateSetter: boolean }>;
  declaredSymbols: string[];
  importedDependencies: string[];
  suggestedPropsInterface: string;
  suggestedCallSnippet: string;
  summary: string;
}

const JS_GLOBALS = new Set([
  "window", "document", "console", "Math", "JSON", "Promise", "Boolean", "String", "Number",
  "Array", "Object", "Function", "Error", "RegExp", "Date", "Map", "Set", "WeakMap", "WeakSet",
  "Symbol", "undefined", "null", "true", "false", "NaN", "Infinity", "Buffer", "process",
  "event", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "fetch", "alert",
  "confirm", "location", "history", "navigator", "localStorage", "sessionStorage", "Intl",
  "requestAnimationFrame", "cancelAnimationFrame", "crypto", "performance", "URL", "URLSearchParams",
  "React", "void", "typeof", "instanceof", "in"
]);

// 模块严格模式下永不能作为绑定名的保留字兜底：即使某条收集路径漏入关键字，
// 也不得让它成为 prop/解构/call 参数（否则目标文件必报语法错误）。
const TS_RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "finally", "for",
  "function", "if", "import", "in", "instanceof", "new", "return", "super",
  "switch", "this", "throw", "try", "typeof", "var", "void", "while", "with",
  "implements", "interface", "let", "package", "private", "protected",
  "public", "static", "yield", "false", "null", "true"
]);

export function analyzeBlockScope(
  filePath: string,
  content: string,
  startLine: number,
  endLine: number,
  optionsOrComponentName?: { componentName?: string } | string
): ScopeAnalysisResult {
  const compNameStr = typeof optionsOrComponentName === "string"
    ? optionsOrComponentName
    : (optionsOrComponentName?.componentName ?? "ExtractedComponent");
  const componentName = compNameStr || "ExtractedComponent";
  const sf = getCachedSourceFile(filePath, content);

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const sLine = Math.max(1, startLine);
  const eLine = Math.min(totalLines, endLine);

  const startPos = sf.getPositionOfLineAndCharacter(sLine - 1, 0);
  const endPos = eLine >= totalLines ? content.length : sf.getPositionOfLineAndCharacter(eLine, 0);

  const fileImportedIdentifiers = new Set<string>();
  const importedModuleMap = new Map<string, string>(); // symbol -> module

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const mod = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : "";
      if (stmt.importClause.name) {
        const name = stmt.importClause.name.text;
        fileImportedIdentifiers.add(name);
        if (mod) importedModuleMap.set(name, mod);
      }
      if (stmt.importClause.namedBindings) {
        if (ts.isNamespaceImport(stmt.importClause.namedBindings)) {
          const name = stmt.importClause.namedBindings.name.text;
          fileImportedIdentifiers.add(name);
          if (mod) importedModuleMap.set(name, mod);
        } else if (ts.isNamedImports(stmt.importClause.namedBindings)) {
          for (const el of stmt.importClause.namedBindings.elements) {
            const name = el.name.text;
            fileImportedIdentifiers.add(name);
            if (mod) importedModuleMap.set(name, mod);
          }
        }
      }
    }
  }

  const blockDeclaredIdentifiers = new Set<string>();
  const blockUsedIdentifiers = new Set<string>();

  function walkBlock(node: any) {
    const nStart = node.getStart(sf);
    const nEnd = node.getEnd();
    if (nEnd < startPos || nStart > endPos) return;

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && nStart >= startPos && nEnd <= endPos) {
      blockDeclaredIdentifiers.add(node.name.text);
    } else if (ts.isFunctionDeclaration(node) && node.name && ts.isIdentifier(node.name) && nStart >= startPos && nEnd <= endPos) {
      blockDeclaredIdentifiers.add(node.name.text);
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name) && nStart >= startPos && nEnd <= endPos) {
      blockDeclaredIdentifiers.add(node.name.text);
    } else if (ts.isTypeAliasDeclaration(node) && ts.isIdentifier(node.name) && nStart >= startPos && nEnd <= endPos) {
      blockDeclaredIdentifiers.add(node.name.text);
    } else if (ts.isInterfaceDeclaration(node) && ts.isIdentifier(node.name) && nStart >= startPos && nEnd <= endPos) {
      blockDeclaredIdentifiers.add(node.name.text);
    }

    if (ts.isIdentifier(node) && nStart >= startPos && nEnd <= endPos) {
      const parent = node.parent;
      let isPropertyKey = false;
      if (parent) {
        // 类型位标识（如 `as const` 的 const、注解 `x: Foo` 的 Foo）不是值引用，
        // 不能进捕获（否则保留字 const 会变成 prop 名，直接语法错误）。
        // 类型依赖由 generatePropsTypeImports/generatePropsLocalTypes 另行携带。
        if (ts.isTypeReferenceNode(parent) && (parent as any).typeName === node) isPropertyKey = true;
        else if (ts.isPropertyAssignment(parent) && parent.name === node) isPropertyKey = true;
        else if (ts.isPropertyAccessExpression(parent) && parent.name === node) isPropertyKey = true;
        else if (ts.isMethodDeclaration(parent) && parent.name === node) isPropertyKey = true;
        else if (ts.isPropertyDeclaration(parent) && parent.name === node) isPropertyKey = true;
        else if (ts.isJsxAttribute(parent) && parent.name === node) isPropertyKey = true;
        else if (
          (ts.isJsxOpeningElement(parent) || ts.isJsxClosingElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
          parent.tagName === node &&
          /^[a-z]/.test(node.text)
        ) {
          isPropertyKey = true;
        }
      }
      if (!isPropertyKey) {
        blockUsedIdentifiers.add(node.text);
      }
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (nStart >= startPos && nEnd <= endPos && ts.isIdentifier(node.tagName) && !/^[a-z]/.test(node.tagName.text)) {
        blockUsedIdentifiers.add(node.tagName.text);
      }
    }

    ts.forEachChild(node, walkBlock);
  }

  walkBlock(sf);

  const capturedNames = [...blockUsedIdentifiers].filter(id =>
    !blockDeclaredIdentifiers.has(id) &&
    !fileImportedIdentifiers.has(id) &&
    !JS_GLOBALS.has(id) &&
    !TS_RESERVED.has(id) &&
    !/^[0-9]+$/.test(id)
  );

  // Infer types for captured variables from outer scope
  const outerDeclarations = new Map<string, { typeText: string; isFunction: boolean; isStateSetter: boolean }>();

  // 真实函数签名推导： иначе props 里 `() => void` 配块内 `fn(x)` 调用，
  // 生成的目标文件自带 TS2554，语义门禁正确拦截但分拆永远过不了。
  // 有声明类型用声明，无声明按形参逐个 `any`，0 形参才回退 `() => void`。
  function fnSigText(fnNode: any): string {
    try {
      const rawParams = Array.isArray(fnNode?.parameters) ? fnNode.parameters : [];
      const params = rawParams.map((p: any) => {
        let pname = "arg";
        try {
          pname = ts.isIdentifier(p.name) ? p.name.text : p.name.getText(sf);
        } catch { /* keep arg */ }
        const isRest = !!p.dotDotDotToken;
        const isOpt = !!p.questionToken || (!isRest && !!p.initializer);
        let ptype = "any";
        try {
          if (p.type) ptype = p.type.getText(sf);
        } catch { /* keep any */ }
        return `${isRest ? "..." : ""}${pname}${isOpt ? "?" : ""}: ${isRest ? ptype.replace(/^\s*any\s*$/, "any[]") : ptype}`;
      });
      let ret = "void";
      try {
        if (fnNode.type) ret = fnNode.type.getText(sf);
      } catch { /* keep void */ }
      return `(${params.join(", ")}) => ${ret}`;
    } catch {
      return "() => void";
    }
  }

  function walkOuter(node: any) {
    const nStart = node.getStart(sf);
    if (nStart >= startPos) return;

    if (ts.isVariableDeclaration(node)) {
      // Check useState destructuring: const [state, setState] = useState<Type>(...)
      if (node.parent && ts.isArrayBindingPattern(node.name)) {
        const elements = node.name.elements;
        const init = node.initializer;
        let inferredType = "any";
        if (init && ts.isCallExpression(init)) {
          const fnName = ts.isIdentifier(init.expression) ? init.expression.text : "";
          if (fnName === "useState") {
            if (init.typeArguments && init.typeArguments.length > 0) {
              inferredType = init.typeArguments[0].getText(sf);
            } else if (init.arguments && init.arguments.length > 0) {
              const arg0 = init.arguments[0];
              if (arg0.kind === ts.SyntaxKind.TrueKeyword || arg0.kind === ts.SyntaxKind.FalseKeyword) inferredType = "boolean";
              else if (ts.isStringLiteral(arg0)) inferredType = "string";
              else if (ts.isNumericLiteral(arg0)) inferredType = "number";
              else if (ts.isArrayLiteralExpression(arg0)) inferredType = "any[]";
              else if (ts.isObjectLiteralExpression(arg0)) inferredType = "Record<string, any>";
            }
          }
        }
        if (elements[0] && ts.isBindingElement(elements[0]) && ts.isIdentifier(elements[0].name)) {
          const varName = elements[0].name.text;
          outerDeclarations.set(varName, { typeText: inferredType, isFunction: false, isStateSetter: false });
        }
        if (elements[1] && ts.isBindingElement(elements[1]) && ts.isIdentifier(elements[1].name)) {
          const setterName = elements[1].name.text;
          outerDeclarations.set(setterName, { typeText: `(value: ${inferredType} | ((prev: ${inferredType}) => ${inferredType})) => void`, isFunction: true, isStateSetter: true });
        }
      } else if (ts.isIdentifier(node.name)) {
        const varName = node.name.text;
        let typeText = node.type ? node.type.getText(sf) : "any";
        let isFn = false;
        if (node.initializer) {
          if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
            isFn = true;
            if (typeText === "any") typeText = fnSigText(node.initializer);
          }
        }
        outerDeclarations.set(varName, { typeText, isFunction: isFn, isStateSetter: false });
      }
    } else if (ts.isFunctionDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const fnName = node.name.text;
      outerDeclarations.set(fnName, { typeText: fnSigText(node), isFunction: true, isStateSetter: false });
    }

    ts.forEachChild(node, walkOuter);
  }

  walkOuter(sf);

  const capturedVariables = capturedNames.map(name => {
    const known = outerDeclarations.get(name);
    let type = known?.typeText ?? "any";
    let isFunction = known?.isFunction ?? false;
    let isStateSetter = known?.isStateSetter ?? false;

    if (!known) {
      if (name.startsWith("set") && name.length > 3 && /^[A-Z]/.test(name.charAt(3))) {
        isFunction = true;
        isStateSetter = true;
        type = "(value: any) => void";
      } else if (name.startsWith("on") || name.startsWith("handle")) {
        isFunction = true;
        type = "() => void";
      } else if (name.startsWith("is") || name.startsWith("has") || name.startsWith("allow")) {
        type = "boolean";
      }
    }

    return { name, type, isFunction, isStateSetter };
  });

  const importedDependencies = [...blockUsedIdentifiers].filter(id => fileImportedIdentifiers.has(id));
  const declaredSymbols = [...blockDeclaredIdentifiers];

  const safeCompName = componentName.replace(/[^A-Za-z0-9_$]/g, "") || "ExtractedComponent";
  const propsName = `${safeCompName}Props`;

  const propsLines = capturedVariables.map(v => `  ${v.name}: ${v.type};`);
  const suggestedPropsInterface = capturedVariables.length > 0
    ? `export interface ${propsName} {\n${propsLines.join("\n")}\n}`
    : `export interface ${propsName} {}`;

  const callArgs = capturedVariables.map(v => `${v.name}={${v.name}}`).join(" ");
  const suggestedCallSnippet = capturedVariables.length > 0
    ? `<${safeCompName} ${callArgs} />`
    : `<${safeCompName} />`;

  const summary = [
    `[analyze_scope] File: ${filePath} (L${sLine}-L${eLine})`,
    `- Captured Outer Variables (${capturedVariables.length}): ${capturedVariables.map(v => `${v.name} (${v.type})`).join(", ") || "(none)"}`,
    `- Imported Dependencies Used (${importedDependencies.length}): ${importedDependencies.join(", ") || "(none)"}`,
    `- Declared Symbols in Block (${declaredSymbols.length}): ${declaredSymbols.join(", ") || "(none)"}`,
    ``,
    `// Suggested Props Interface:`,
    suggestedPropsInterface,
    ``,
    `// Suggested Component Invocation:`,
    suggestedCallSnippet
  ].join("\n");

  return {
    filePath,
    startLine: sLine,
    endLine: eLine,
    componentName: safeCompName,
    capturedVariables,
    declaredSymbols,
    importedDependencies,
    suggestedPropsInterface,
    suggestedCallSnippet,
    summary
  };
}

export function generateTargetImportsForBlock(
  sourcePath: string,
  targetPath: string,
  sourceContent: string,
  startLine: number,
  endLine: number
): string {
  const sf = getCachedSourceFile(sourcePath, sourceContent);

  const lines = sourceContent.split(/\r?\n/);
  const totalLines = lines.length;
  const sLine = Math.max(1, startLine);
  const eLine = Math.min(totalLines, endLine);

  const startPos = sf.getPositionOfLineAndCharacter(sLine - 1, 0);
  const endPos = eLine >= totalLines ? sourceContent.length : sf.getPositionOfLineAndCharacter(eLine, 0);

  const usedIdentifiers = new Set<string>();
  let hasJsx = false;

  function walk(node: any) {
    const nStart = node.getStart(sf);
    const nEnd = node.getEnd();
    if (nEnd < startPos || nStart > endPos) return;

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      hasJsx = true;
      if (ts.isIdentifier(node.tagName)) {
        usedIdentifiers.add(node.tagName.text);
      }
    } else if (ts.isIdentifier(node)) {
      usedIdentifiers.add(node.text);
    }
    ts.forEachChild(node, walk);
  }

  walk(sf);
  if (hasJsx) usedIdentifiers.add("React");

  const matchingImportLines: string[] = [];
  const sourceDir = dirname(resolve(sourcePath));
  const targetDir = dirname(resolve(targetPath));

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const clause = stmt.importClause;
    const modSpec = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : "";
    if (!modSpec) continue;

    if (!clause) {
      continue;
    }

    let neededDefault: string | undefined;
    let neededNamespace: string | undefined;
    const neededNamed: string[] = [];

    if (clause.name && usedIdentifiers.has(clause.name.text)) {
      neededDefault = clause.name.text;
    }

    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings) && usedIdentifiers.has(clause.namedBindings.name.text)) {
        neededNamespace = clause.namedBindings.name.text;
      } else if (ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          if (usedIdentifiers.has(el.name.text)) {
            const prefix = el.isTypeOnly ? "type " : "";
            if (el.propertyName && el.propertyName.text !== el.name.text) {
              neededNamed.push(`${prefix}${el.propertyName.text} as ${el.name.text}`);
            } else {
              neededNamed.push(`${prefix}${el.name.text}`);
            }
          }
        }
      }
    }

    if (!neededDefault && !neededNamespace && neededNamed.length === 0) {
      continue;
    }

    // Rewrite relative module path if needed
    let rewrittenMod = modSpec;
    if (modSpec.startsWith(".")) {
      const absMod = resolve(sourceDir, modSpec);
      let relToTarget = relative(targetDir, absMod).replace(/\\/g, "/");
      if (!relToTarget.startsWith(".")) relToTarget = "./" + relToTarget;
      rewrittenMod = relToTarget;
    }

    const parts: string[] = [];
    if (neededDefault) parts.push(neededDefault);
    if (neededNamespace) parts.push(`* as ${neededNamespace}`);
    if (neededNamed.length > 0) parts.push(`{ ${neededNamed.join(", ")} }`);

    const typePrefix = clause.isTypeOnly ? "type " : "";
    matchingImportLines.push(`import ${typePrefix}${parts.join(", ")} from "${rewrittenMod}";`);
  }

  const eol = sourceContent.includes("\r\n") ? "\r\n" : "\n";
  return matchingImportLines.join(eol);
}

// Props接口引入的类型名（如 SlashCommandNotice）只出现在推导出的 type
// 字符串里，不在抽取块源码中，generateTargetImportsForBlock 看不到它们。
// 这里从源文件 import 表里把这些类型导入一并带到目标文件，否则新文件必报 TS2304。
export function generatePropsTypeImports(
  sourcePath: string,
  targetPath: string,
  sourceContent: string,
  captured: Array<{ name: string; type: string }>,
  existingImportsText: string,
  locallyDeclared: string[] = []
): string {
  const GLOBAL_LIKE = new Set([
    "string", "number", "boolean", "bigint", "any", "unknown", "never", "void",
    "null", "undefined", "true", "false", "this", "object", "symbol",
    "Record", "Partial", "Pick", "Omit", "Required", "Readonly", "Exclude",
    "Extract", "ReturnType", "Parameters", "Awaited", "NonNullable",
    "Array", "Promise", "Map", "Set", "Date", "RegExp", "Error", "Function",
    "React", "JSX",
  ]);
  const idRe = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  const needed = new Set<string>();
  for (const v of captured) {
    const t = v.type ?? "";
    let m: RegExpExecArray | null;
    idRe.lastIndex = 0;
    while ((m = idRe.exec(t)) !== null) {
      const name = m[0]!;
      if (!GLOBAL_LIKE.has(name)) needed.add(name);
    }
  }
  if (needed.size === 0) return "";
  const alreadyImported = (name: string) => new RegExp(`\\b${name}\\b`).test(existingImportsText);
  // 本地已声明的类型（如复制过来的 interface X）无需再 import；
  // 注意：仅“声明”算提供，文本中“提及”不算（提及恰恰意味着缺 import）。
  const locallyProvided = new Set(locallyDeclared);
  for (const v of captured) alreadyImported(v.name); // values are props, not imports
  const sf = getCachedSourceFile(sourcePath, sourceContent);
  const sourceDir = dirname(resolve(sourcePath));
  const targetDir = dirname(resolve(targetPath));
  const out: string[] = [];
  const covered = new Set<string>();
  const rewrite = (spec: string) => {
    if (!spec.startsWith(".")) return spec;
    const absMod = resolve(sourceDir, spec);
    let rel = relative(targetDir, absMod).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    return rel;
  };
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const modSpec = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : "";
    if (!modSpec) continue;
    const clause: any = stmt.importClause;
    const clauseTypePrefix = clause.isTypeOnly ? "type " : "";
    // default import provides a type name
    if (clause.name && needed.has(clause.name.text) && !covered.has(clause.name.text) && !locallyProvided.has(clause.name.text) && !alreadyImported(clause.name.text)) {
      out.push(`import ${clause.name.text} from "${rewrite(modSpec)}";`);
      covered.add(clause.name.text);
    }
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) {
      if (needed.has(nb.name.text) && !covered.has(nb.name.text) && !locallyProvided.has(nb.name.text) && !alreadyImported(nb.name.text)) {
        out.push(`import * as ${nb.name.text} from "${rewrite(modSpec)}";`);
        covered.add(nb.name.text);
      }
    } else if (nb && ts.isNamedImports(nb)) {
      const hits: string[] = [];
      for (const el of nb.elements) {
        const local = el.name.text;
        if (needed.has(local) && !covered.has(local) && !locallyProvided.has(local) && !alreadyImported(local)) {
          const prefix = (el.isTypeOnly ? "type " : "");
          hits.push(el.propertyName && el.propertyName.text !== local ? `${prefix}${el.propertyName.text} as ${local}` : `${prefix}${local}`);
          covered.add(local);
        }
      }
      if (hits.length > 0) out.push(`import ${clauseTypePrefix}{ ${hits.join(", ")} } from "${rewrite(modSpec)}";`);
    }
    if (covered.size >= needed.size) break;
  }
  return out.join(sourceContent.includes("\r\n") ? "\r\n" : "\n");
}

// Props类型还可能引用源文件内的局部类型声明（如 App.tsx 里的
// `type SlashCommandNotice = {...}`），import 表里没有，只能把声明原文
// 一并复制到目标文件（含传递依赖，最多 3 轮），否则新文件必报 TS2304。
export function generatePropsLocalTypes(
  sourcePath: string,
  sourceContent: string,
  captured: Array<{ name: string; type: string }>,
  existingText: string
): string {
  const GLOBAL_LIKE = new Set([
    "string", "number", "boolean", "bigint", "any", "unknown", "never", "void",
    "null", "undefined", "true", "false", "this", "object", "symbol",
    "Record", "Partial", "Pick", "Omit", "Required", "Readonly", "Exclude",
    "Extract", "ReturnType", "Parameters", "Awaited", "NonNullable",
    "Array", "Promise", "Map", "Set", "Date", "RegExp", "Error", "Function",
    "React", "JSX",
  ]);
  const idRe = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  const collectIds = (t: string, into: Set<string>) => {
    let m: RegExpExecArray | null;
    idRe.lastIndex = 0;
    while ((m = idRe.exec(t)) !== null) {
      if (!GLOBAL_LIKE.has(m[0]!)) into.add(m[0]!);
    }
  };
  const needed = new Set<string>();
  for (const v of captured) collectIds(v.type ?? "", needed);
  if (needed.size === 0) return "";
  const sf = getCachedSourceFile(sourcePath, sourceContent);
  const decls = new Map<string, string>();
  for (const stmt of sf.statements) {
    const nm: any =
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) ||
       ts.isEnumDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name
        ? stmt.name.text : null;
    if (nm && !decls.has(nm)) {
      try { decls.set(nm, (stmt as any).getText(sf)); }
      catch { /* ignore single */ }
    }
  }
  if (decls.size === 0) return "";
  const present = (name: string) => new RegExp(`\\b${name}\\b`).test(existingText);
  const picked: string[] = [];
  const pickedNames = new Set<string>();
  for (let round = 0; round < 3; round++) {
    let grew = false;
    for (const name of [...needed]) {
      if (pickedNames.has(name) || present(name)) continue;
      const text = decls.get(name);
      if (text === undefined) continue;
      picked.push(text);
      pickedNames.add(name);
      collectIds(text, needed);
      grew = true;
    }
    if (!grew) break;
  }
  return picked.join(sourceContent.includes("\r\n") ? "\r\n\r\n" : "\n\n");
}

export type SemanticIssue = { line: number; column: number; message: string; preview: string; code?: string };

// 差分门禁：单文件 LS 看不到工程级类型增强（如 MUI Theme 的模块扩增）和
// 环境全局量，会产生"隔离噪音"误报。判定规则（毫秒级，只读缓存 AST+文本）：
// - TS2304 名字 X：若源文件任何位置声明过 X（import/变量/函数/类型），说明
//   是我们没带走 → 真问题，拦截；源文件也从未声明 X → 环境噪音，警告放行。
// - TS2339 属性 .P：若源文件原文就存在 `.P` 用法 → 增强类型 artifact，警告放行；否则拦截。
// - 其他错误码：无法判定，一律拦截。无法解析出名字/属性的，也一律拦截。
export function splitEnvironmentalErrors(
  sourcePath: string,
  sourceContent: string,
  errors: SemanticIssue[]
): { hard: SemanticIssue[]; warnings: SemanticIssue[] } {
  const hard: SemanticIssue[] = [];
  const warnings: SemanticIssue[] = [];
  if (errors.length === 0) return { hard, warnings };
  let sf: any = null;
  let declared: Set<string> | null = null;
  const getDeclared = (): Set<string> => {
    if (declared) return declared;
    declared = new Set<string>();
    try {
      sf = getCachedSourceFile(sourcePath, sourceContent);
      const walk = (node: any) => {
        try {
          if (ts.isImportDeclaration(node) && (node as any).importClause) {
            const c: any = (node as any).importClause;
            if (c.name && ts.isIdentifier(c.name)) declared!.add(c.name.text);
            const nb = c.namedBindings;
            if (nb) {
              if (ts.isNamespaceImport(nb)) declared!.add(nb.name.text);
              else if (ts.isNamedImports(nb)) {
                for (const el of nb.elements) declared!.add(el.name.text);
              }
            }
          } else if (
            ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)
          ) {
            const nm: any = (node as any).name;
            if (nm && ts.isIdentifier(nm)) declared!.add(nm.text);
          }
        } catch { /* ignore single node */ }
        try { ts.forEachChild(node, walk); } catch { /* ignore */ }
      };
      walk(sf);
    } catch { /* fallthrough with partial set */ }
    return declared!;
  };
  for (const e of errors) {
    const code = e.code ?? "";
    if (code === "TS2304") {
      const m = /Cannot find name '([^']+)'/.exec(e.message);
      const nm = m ? m[1]! : "";
      if (!nm) { hard.push(e); continue; }
      if (getDeclared().has(nm)) hard.push(e); // 源文件提供过 → 我们漏带 → 真拦截
      else warnings.push(e); // 源文件也没声明 → 环境/全局 → 警告放行
      continue;
    }
    if (code === "TS2339") {
      const m = /Property '([^']+)'/.exec(e.message);
      const prop = m ? m[1]! : "";
      if (!prop) { hard.push(e); continue; }
      if (sourceContent.includes(`.${prop}`)) warnings.push(e); // 源文件同用法 → 增强 artifact
      else hard.push(e);
      continue;
    }
    hard.push(e);
  }
  return { hard, warnings };
}

// ── P0: LSP/Compiler 原生重构支撑（TypeScript LanguageService，纯 Node 内存运行） ──

export function findTopImportInsertLine(content: string): number {
  const lines = content.split(/\r?\n/);
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] ?? "").trim();
    if (l.startsWith("import ") || l.startsWith("import{") || l.startsWith("import{") || (l.startsWith("const ") && l.includes("require("))) {
      lastImportIdx = i;
    }
  }
  if (lastImportIdx !== -1) return lastImportIdx + 1;
  let idx = 0;
  while (idx < lines.length) {
    const l = (lines[idx] ?? "").trim();
    if (l.startsWith("#!") || l.startsWith("//") || l.startsWith("/*") || l.startsWith("*") || l.endsWith("*/") ||
      l === '"use client";' || l === "'use client';" || l === '"use strict";' || l === "'use strict';" || l === "") {
      idx++;
    } else break;
  }
  return idx;
}

function createInMemoryLanguageService(fileName: string, content: string, cwd: string): any | null {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const baseCwd = cwd || process.cwd();
    const absName = path.normalize(path.isAbsolute(fileName) ? fileName : path.resolve(baseCwd, fileName));
    const normKey = (n: string) => path.normalize(n);
    const options: any = { allowJs: true, checkJs: false, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, skipLibCheck: true, strict: false, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host: any = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => [absName],
      getScriptVersion: () => "0",
      getScriptSnapshot: (name: string) => {
        const norm = normKey(name);
        if (norm === absName) return ts.ScriptSnapshot.fromString(content);
        try {
          if (fs.existsSync(name) && fs.statSync(name).isFile()) {
            const txt = fs.readFileSync(name, "utf8");
            return ts.ScriptSnapshot.fromString(txt);
          }
        } catch { /* fallthrough */ }
        return undefined;
      },
      getCurrentDirectory: () => baseCwd,
      getDefaultLibFileName: (opts: any) => ts.getDefaultLibFilePath(opts),
      fileExists: (name: string) => {
        if (normKey(name) === absName) return true;
        try { return ts.sys.fileExists(name); } catch { return false; }
      },
      readFile: (name: string) => {
        if (normKey(name) === absName) return content;
        try { return ts.sys.readFile(name); } catch { return undefined; }
      },
      readDirectory: (...args: any[]) => (ts.sys as any).readDirectory(...args),
      directoryExists: (name: string) => {
        try { return ts.sys.directoryExists(name); } catch { return false; }
      },
      getDirectories: (name: string) => {
        try { return ts.sys.getDirectories(name); } catch { return []; }
      },
    };
    const registry: any = typeof ts.createDocumentRegistry === "function" ? ts.createDocumentRegistry() : undefined;
    return ts.createLanguageService(host, registry);
  } catch {
    return null;
  }
}

export function getSemanticDiagnosticsForContent(filePath: string, content: string, cwd = process.cwd()): Array<{ line: number; column: number; message: string; preview: string; code?: string }> {
  try {
    const ls = createInMemoryLanguageService(filePath, content, cwd);
    if (!ls) return [];
    const path = require("node:path");
    const absName = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    const prog = typeof ls.getProgram === "function" ? ls.getProgram() : null;
    const sf = prog?.getSourceFile(absName);
    const lines = content.split(/\r?\n/);
    const out: Array<{ line: number; column: number; message: string; preview: string; code?: string }> = [];
    const push = (d: any) => {
      try {
        const start = typeof d.start === "number" ? d.start : 0;
        const src = sf ?? ts.createSourceFile(absName, content, ts.ScriptTarget.Latest, true);
        const lc = ts.getLineAndCharacterOfPosition(src, start);
        out.push({ line: lc.line + 1, column: lc.character + 1, message: ts.flattenDiagnosticMessageText(d.messageText, "\n"), preview: (lines[lc.line] ?? "").trim(), code: d.code !== undefined ? `TS${d.code}` : undefined });
      } catch { /* ignore single */ }
    };
    for (const d of (ls.getCompilerOptionsDiagnostics?.() ?? [])) push(d);
    for (const d of (ls.getSyntacticDiagnostics(absName) ?? [])) {
      // syntactic already covered by parseDiagnostics; keep semantic-relevant only to avoid dup
      if (d.code === 1005 || d.code === 1128) push(d);
    }
    for (const d of (ls.getSemanticDiagnostics(absName) ?? [])) push(d);
    // NOTE: suggestion diagnostics skipped on purpose: an extra full-file LS
    // pass that doubles cost on 16k-line files; suggestions are not errors and
    // the refactor gates only need error-level codes.
    const seen = new Set<string>();
    return out.filter(e => {
      const k = `${e.line}:${e.column}:${e.code}:${e.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 80);
  } catch {
    return [];
  }
}

export function autoFixMissingImportsInContent(filePath: string, content: string, cwd = process.cwd()): { newContent: string; applied: boolean; fixedCount: number; summary: string } {
  try {
    const path = require("node:path");
    const ls = createInMemoryLanguageService(filePath, content, cwd);
    if (!ls) return { newContent: content, applied: false, fixedCount: 0, summary: "LanguageService unavailable" };
    const absName = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    const sem = ls.getSemanticDiagnostics(absName) ?? [];
    const missing = sem.filter((d: any) => d.code === 2304 && typeof d.start === "number");
    if (missing.length === 0) return { newContent: content, applied: false, fixedCount: 0, summary: "No TS2304 missing names" };
    const formatOpts: any = { indentSize: 2, tabSize: 2, newLineCharacter: content.includes("\r\n") ? "\r\n" : "\n", convertTabsToSpaces: true };
    let working = content;
    let fixed = 0;
    // Apply from bottom to top to keep offsets stable; recreate LS each round (cheap, bounded).
    const sorted = [...missing].sort((a: any, b: any) => (b.start ?? 0) - (a.start ?? 0)).slice(0, 20);
    for (const d of sorted) {
      try {
        const inner = createInMemoryLanguageService(filePath, working, cwd);
        const aName = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
        const fixes = inner?.getCodeFixesAtPosition(aName, d.start, d.start + (d.length ?? 1), [2304], formatOpts) ?? [];
        const fix = fixes.find((f: any) => /import/i.test(f.description ?? "") || /import/i.test(f.fixName ?? "")) ?? fixes[0];
        const changes = fix?.changes ?? [];
        // Apply edits in reverse offset order within this fix
        const edits: Array<{ span: any; newText: string }> = [];
        for (const ch of changes) {
          if (!ch.textChanges) continue;
          for (const tc of ch.textChanges) edits.push({ span: tc.span, newText: tc.newText ?? "" });
        }
        edits.sort((x, y) => (y.span.start ?? 0) - (x.span.start ?? 0));
        for (const e of edits) {
          working = working.slice(0, e.span.start) + e.newText + working.slice(e.span.start + (e.span.length ?? 0));
        }
        if (edits.length > 0) fixed++;
      } catch { /* continue */ }
    }
    // Normalize: ensure organize step merges duplicates
    const organized = organizeImportsInContent(filePath, working, { removeUnused: false, sort: true, mergeDuplicates: true });
    if (organized.changed) working = organized.newContent;
    return { newContent: working, applied: working !== content, fixedCount: fixed, summary: `Applied ${fixed} missing-import fix(es)` };
  } catch (err: any) {
    return { newContent: content, applied: false, fixedCount: 0, summary: `auto-fix failed: ${err?.message ?? err}` };
  }
}

export type CouplingCandidate = {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  capturedOuterState: number;
  importedDeps: number;
  internalLines: number;
  recommendation: string;
};

export function analyzeFileCoupling(filePath: string, content: string, topN = 12): { candidates: CouplingCandidate[]; summary: string } {
  const sf = getCachedSourceFile(filePath, content);
  const tops: Array<{ name: string; kind: string; s: number; e: number }> = [];
  for (const stmt of sf.statements) {
    const getRange = (n: any) => {
      const s = ts.getLineAndCharacterOfPosition(sf, n.getStart(sf));
      const e = ts.getLineAndCharacterOfPosition(sf, n.getEnd());
      return { s: s.line + 1, e: e.line + 1 };
    };
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const r = getRange(stmt);
      tops.push({ name: stmt.name.text, kind: "function", ...r });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          const r = getRange(stmt);
          const nm = decl.name.text;
          tops.push({ name: nm, kind: /^[A-Z]/.test(nm) ? "component" : "function", ...r });
        }
      }
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      const r = getRange(stmt);
      tops.push({ name: stmt.name.text, kind: "class", ...r });
    }
  }
  const candidates: CouplingCandidate[] = tops.slice(0, 40).map(t => {
    try {
      const a = analyzeBlockScope(filePath, content, t.s, t.e, t.name);
      const n = a.capturedVariables.length;
      const rec = n <= 2 ? "High priority for extraction (Low Risk)" : n <= 6 ? "Medium: extract hooks first" : "Extract custom hooks first before splitting UI";
      return { name: t.name, kind: t.kind, startLine: t.s, endLine: t.e, capturedOuterState: n, importedDeps: a.importedDependencies.length, internalLines: t.e - t.s + 1, recommendation: rec };
    } catch {
      return { name: t.name, kind: t.kind, startLine: t.s, endLine: t.e, capturedOuterState: 999, importedDeps: 0, internalLines: t.e - t.s + 1, recommendation: "analysis failed; inspect manually" };
    }
  }).sort((a, b) => a.capturedOuterState - b.capturedOuterState).slice(0, topN);
  const lines = [`[analyze_coupling] ${filePath}: ${candidates.length} candidate(s) (sorted by coupling asc)`];
  candidates.forEach((c, i) => lines.push(`${i + 1}. ${c.name} [L${c.startLine}-L${c.endLine}] captured=${c.capturedOuterState} imports=${c.importedDeps} lines=${c.internalLines} -> ${c.recommendation}`));
  return { candidates, summary: lines.join("\n") };
}

export function buildExtractComponent(
  sourcePath: string,
  sourceContent: string,
  startLine: number,
  endLine: number,
  componentName: string,
  targetPath: string
): { targetContent: string; callSnippet: string; importStatement: string; propsInterface: string } {
  const analysis = analyzeBlockScope(sourcePath, sourceContent, startLine, endLine, componentName);
  const safe = (analysis.componentName || componentName).replace(/[^A-Za-z0-9_$]/g, "") || "ExtractedComponent";
  const lines = sourceContent.split(/\r?\n/);
  const block = lines.slice(analysis.startLine - 1, analysis.endLine).join("\n");
  let targetImports = "";
  try {
    targetImports = generateTargetImportsForBlock(sourcePath, targetPath, sourceContent, analysis.startLine, analysis.endLine);
  } catch { /* ignore */ }
  const hasJsx = /<[A-Za-z][^>]*>/.test(block);
  const eol = sourceContent.includes("\r\n") ? "\r\n" : "\n";
  // Local type declarations referenced by Props (not importable): copy them over first,
  // so the props-type import pass below can see which names are already provided locally.
  let localTypes = "";
  try {
    localTypes = generatePropsLocalTypes(sourcePath, sourceContent, analysis.capturedVariables, targetImports);
  } catch { /* ignore */ }
  // Props types live only in inferred type strings (not block source): carry them too.
  // NOTE: local type bodies may themselves reference imported types
  // (e.g. `interface X { p: PermissionPresetId }`) — fold their identifiers
  // into the same pass, otherwise the target breaks with TS2304.
  // Only locally DECLARED names count as provided; mere mentions still need imports.
  try {
    const localDeclNames = localTypes.trim()
      ? [...localTypes.matchAll(/^(?:export\s+)?(?:type|interface|enum|class)\s+([A-Za-z0-9_$]+)/gm)].map(m => m[1]!)
      : [];
    const augmented = localTypes.trim()
      ? [...analysis.capturedVariables, { name: "__localTypes", type: localTypes }]
      : analysis.capturedVariables;
    const extra = generatePropsTypeImports(sourcePath, targetPath, sourceContent, augmented as any, targetImports, localDeclNames);
    if (extra.trim()) targetImports = targetImports.trim() ? `${targetImports.trim()}\n${extra}` : extra;
  } catch { /* ignore */ }
  const propsDecl = analysis.capturedVariables.length > 0
    ? `export interface ${safe}Props {${eol}${analysis.capturedVariables.map(v => `  ${v.name}: ${v.type};`).join(eol)}${eol}}`
    : `export interface ${safe}Props {}`;
  const destructured = analysis.capturedVariables.length > 0 ? `{ ${analysis.capturedVariables.map(v => v.name).join(", ")} }` : ``;
  // FIX: avoid `return return ...` when the selected block is itself a return statement.
  // Strip a leading `return` (and trailing `;`) for the target body, but preserve
  // `return <Call/>;` semantics at the call site.
  const trimmedBlock = block.trim();
  const isReturnBlock = /^return[\s(]/.test(trimmedBlock);
  // 语句块（如 function/const 声明）包进 `return (...)` 必语法错误且语义门禁看不见；
  // 直接拒收并指引 raw 模式或重选表达式区间，拒绝落盘坏代码。
  const firstStmt = trimmedBlock.split("\n")[0]!.trim();
  const isStatementBlock = /^(function|class|const|let|var|type|interface|enum|if|for|while|switch|try|export|import)\b/.test(firstStmt)
    && !isReturnBlock;
  if (isStatementBlock) {
    throw new Error(
      `extract_component refused: selected block starts with a statement ("${firstStmt.slice(0, 60)}"), which cannot be wrapped in "return (...)". ` +
      `Use raw mode (extract_to_file with raw:true) and wire the call site manually, or select an expression/JSX range instead.`
    );
  }
  let blockExpr = isReturnBlock
    ? trimmedBlock.replace(/^return\s+/, "").replace(/;\s*$/, "")
    : block;
  // JSX 条件容器解包：`{cond && <X/>}` / `{c ? <A/> : b}` / `{xs.map(x => <R/>)}`
  // 整段包进 `return (...)` 会因外层 {} 直接语法错误；解一层后
  // `return (cond && <X/>)` 与原渲染语义等价（false 本就不渲染）。
  // 仅当内容含 JSX 且外层花括号确为一对容器时才解（对象字面量不动）；
  // 误判由后道 target 语义门禁兜底拦截。
  {
    const t = blockExpr.trim();
    if (t.startsWith("{") && t.endsWith("}")) {
      const inner = t.slice(1, -1);
      const looksConditionalJsx = /&&\s*<[A-Za-z]/.test(inner) || /&&\s*\(/.test(inner) || /\?\s*<[A-Za-z]/.test(inner) || /\.map\s*\(/.test(inner);
      if (looksConditionalJsx) {
        let depth = 0, balanced = true, quote: string | null = null;
        for (let i = 0; i < inner.length; i++) {
          const ch = inner[i]!;
          if (quote) { if (ch === quote && inner[i - 1] !== "\\") quote = null; continue; }
          if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
          if (ch === "{") depth += 1;
          else if (ch === "}") { depth -= 1; if (depth < 0) { balanced = false; break; } }
        }
        if (balanced && depth === 0) blockExpr = inner;
      }
    }
  }
  const body = `${eol}  return (${eol}${blockExpr.split("\n").map(l => `  ${l}`).join(eol)}${eol}  );`;
  const head = [targetImports.trim(), localTypes.trim()].filter(Boolean).join(eol + eol);
  const targetContent = `${head ? head + eol + eol : ""}export interface ${safe}Props {${analysis.capturedVariables.length > 0 ? eol + analysis.capturedVariables.map(v => `  ${v.name}: ${v.type};`).join(eol) + eol : ""}}${eol}${eol}export function ${safe}(${destructured ? `${destructured}: ${safe}Props` : ""}) {${body}${eol}}${eol}`;
  void propsDecl;
  void hasJsx;
  const path = require("node:path");
  const rel = targetPath ? (() => {
    try {
      const { dirname, relative } = require("node:path");
      const absS = path.isAbsolute(sourcePath) ? sourcePath : sourcePath;
      void absS;
      const srcDir = dirname(sourcePath);
      let r = relative(srcDir, targetPath).replace(/\\/g, "/").replace(/\.(?:[cm]?[jt]sx?)$/, "");
      if (!r.startsWith(".")) r = `./${r}`;
      return r;
    } catch { return targetPath; }
  })() : targetPath;
  void path;
  const importStatement = `import { ${safe} } from "${rel}";`;
  const baseCall = analysis.suggestedCallSnippet.replace(analysis.componentName, safe);
  const callSnippet = isReturnBlock ? `return ${baseCall};` : baseCall;
  return { targetContent, callSnippet, importStatement, propsInterface: analysis.suggestedPropsInterface };
}
