import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { Node } from "web-tree-sitter";
import type { SaVmPolicyConfig } from "@codex-ui/shared";
import { checkSaVmPath, normalizeSaVmPolicy, type NormalizedSaVmPolicy } from "../../../backends/vmtool-security/src/security/saVmPolicy.js";
import { getLanguageNameForFile, loadLanguageForFile } from "./saVmTreeSitter.js";
import type { SaVmRunResult } from "./saVmResultKind.js";

export type CodeGraphEdgeKind = "extends" | "implements" | "owns" | "imports" | "calls";

export interface CodeGraphNode {
  id: string;
  label: string;
  kind: "class" | "interface" | "module" | "function" | "unknown";
  file?: string;
  line?: number;
}

export interface CodeGraphEdge {
  source: string;
  target: string;
  kind: CodeGraphEdgeKind;
  label?: string;
}

export interface ExtractedClassInfo {
  name: string;
  bases: string[];
  interfaces: string[];
  fields: Array<{ name: string; type?: string }>;
  methods: Array<{ name: string; calls: string[] }>;
  line: number;
}

export interface ExtractedImportInfo {
  specifier: string;
  symbols: Array<{ imported: string; local: string }>;
  isDefault?: boolean;
  isNamespace?: boolean;
}

export interface ExtractedFileInfo {
  filePath: string;
  classes: ExtractedClassInfo[];
  imports: ExtractedImportInfo[];
  functions: Array<{ name: string; calls: string[]; line: number }>;
}

export type CodeGraphMode = "symbol_hierarchy" | "module_dependency" | "module_deps" | "call_flow";

export interface CodeGraphOptions {
  target: string;
  mode?: CodeGraphMode;
  depth?: number;
  direction?: "upstream" | "downstream" | "both";
  format?: "dot" | "py_stub" | "networkx";
  max_nodes?: number;
  max_tokens?: number;
  output_file?: string;
  candidate_files?: string[];
  files?: string[];
  timeout_ms?: number;
}

// ── AST Extraction ─────────────────────────────────────────────────────────────

function cleanSymbolName(raw: string): string {
  return raw.replace(/^[<{(]+|[>})]+$/g, "").replace(/\s+/g, " ").trim();
}

function extractTypeIdentifiers(node: Node | null): string[] {
  if (!node) return [];
  const results: string[] = [];
  const walk = (curr: Node) => {
    if (
      curr.type === "type_identifier" ||
      curr.type === "identifier" ||
      curr.type === "nested_type_identifier"
    ) {
      const text = cleanSymbolName(curr.text);
      if (text && !["implements", "extends", "class", "interface", "type", "public", "private", "protected", "readonly"].includes(text)) {
        results.push(text);
      }
    }
    for (let i = 0; i < curr.childCount; i++) {
      const child = curr.child(i);
      if (child) walk(child);
    }
  };
  walk(node);
  return [...new Set(results)];
}

function extractTsClass(node: Node): ExtractedClassInfo {
  const nameNode = node.childForFieldName("name");
  let name = nameNode ? nameNode.text.trim() : "";
  if (!name) {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && (c.type === "type_identifier" || c.type === "identifier")) {
        name = c.text.trim();
        break;
      }
    }
  }
  if (!name) name = "(anonymous)";

  const bases: string[] = [];
  const interfaces: string[] = [];
  const fields: Array<{ name: string; type?: string }> = [];
  const methods: Array<{ name: string; calls: string[] }> = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "class_heritage") {
      for (let j = 0; j < child.childCount; j++) {
        const clause = child.child(j);
        if (!clause) continue;
        if (clause.type === "extends_clause") {
          const typeIds = extractTypeIdentifiers(clause);
          bases.push(...typeIds);
        } else if (clause.type === "implements_clause") {
          const typeIds = extractTypeIdentifiers(clause);
          interfaces.push(...typeIds);
        }
      }
    } else if (child.type === "class_body") {
      for (let j = 0; j < child.childCount; j++) {
        const member = child.child(j);
        if (!member) continue;

        if (
          member.type === "public_field_definition" ||
          member.type === "field_definition" ||
          member.type === "property_definition"
        ) {
          const propName = member.childForFieldName("name")?.text || member.childForFieldName("property")?.text || "";
          const typeAnn = member.childForFieldName("type")?.text?.replace(/^:\s*/, "").trim();
          if (propName) {
            fields.push({ name: propName, type: typeAnn || undefined });
          }
        } else if (member.type === "method_definition") {
          const methodName = member.childForFieldName("name")?.text || "(anonymous)";
          const calls: string[] = [];
          const walkCalls = (curr: Node) => {
            if (curr.type === "call_expression") {
              const fnNode = curr.childForFieldName("function");
              if (fnNode) {
                const callText = fnNode.text.replace(/^this\./, "").replace(/^[a-zA-Z0-9_$]+\./, "");
                if (callText && /^[a-zA-Z0-9_$]+$/.test(callText)) {
                  calls.push(callText);
                }
              }
            }
            for (let k = 0; k < curr.childCount; k++) {
              const sub = curr.child(k);
              if (sub) walkCalls(sub);
            }
          };
          walkCalls(member);
          methods.push({ name: methodName, calls: [...new Set(calls)] });
        }
      }
    }
  }

  return {
    name,
    bases: [...new Set(bases)],
    interfaces: [...new Set(interfaces)],
    fields,
    methods,
    line: node.startPosition.row + 1,
  };
}

function extractTsInterface(node: Node): ExtractedClassInfo {
  const name = node.childForFieldName("name")?.text.trim() || "(anonymous)";
  const bases: string[] = [];
  const fields: Array<{ name: string; type?: string }> = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "extends_clause" || child.type === "extends_type_clause") {
      bases.push(...extractTypeIdentifiers(child));
    } else if (child.type === "interface_body" || child.type === "object_type") {
      for (let j = 0; j < child.childCount; j++) {
        const member = child.child(j);
        if (member && (member.type === "property_signature" || member.type === "method_signature")) {
          const propName = member.childForFieldName("name")?.text || "";
          const typeAnn = member.childForFieldName("type")?.text?.replace(/^:\s*/, "").trim();
          if (propName) {
            fields.push({ name: propName, type: typeAnn || undefined });
          }
        }
      }
    }
  }

  return {
    name,
    bases: [...new Set(bases)],
    interfaces: [],
    fields,
    methods: [],
    line: node.startPosition.row + 1,
  };
}

function extractTsImports(node: Node): ExtractedImportInfo[] {
  const imports: ExtractedImportInfo[] = [];

  const visit = (curr: Node) => {
    if (curr.type === "import_statement") {
      const sourceNode = curr.childForFieldName("source");
      const specifier = sourceNode ? sourceNode.text.replace(/^['"]|['"]$/g, "") : "";
      if (specifier) {
        const symbols: Array<{ imported: string; local: string }> = [];
        let isDefault = false;
        let isNamespace = false;

        for (let i = 0; i < curr.childCount; i++) {
          const c = curr.child(i);
          if (c?.type === "import_clause") {
            for (let j = 0; j < c.childCount; j++) {
              const clauseChild = c.child(j);
              if (!clauseChild) continue;
              if (clauseChild.type === "identifier") {
                symbols.push({ imported: clauseChild.text, local: clauseChild.text });
                isDefault = true;
              } else if (clauseChild.type === "namespace_import") {
                const idNode = clauseChild.childForFieldName("name") || clauseChild.lastNamedChild;
                const local = idNode ? idNode.text : "*";
                symbols.push({ imported: "*", local });
                isNamespace = true;
              } else if (clauseChild.type === "named_imports") {
                for (let k = 0; k < clauseChild.childCount; k++) {
                  const spec = clauseChild.child(k);
                  if (spec?.type === "import_specifier") {
                    const impNode = spec.childForFieldName("name");
                    const aliasNode = spec.childForFieldName("alias");
                    const imported = impNode ? impNode.text : spec.text;
                    const local = aliasNode ? aliasNode.text : imported;
                    symbols.push({ imported, local });
                  }
                }
              }
            }
          }
        }

        imports.push({ specifier, symbols, isDefault, isNamespace });
      }
    }
    for (let i = 0; i < curr.childCount; i++) {
      const child = curr.child(i);
      if (child) visit(child);
    }
  };

  visit(node);
  return imports;
}

function extractPythonClass(node: Node): ExtractedClassInfo {
  const name = node.childForFieldName("name")?.text.trim() || "(anonymous)";
  const bases: string[] = [];
  const fields: Array<{ name: string; type?: string }> = [];
  const methods: Array<{ name: string; calls: string[] }> = [];

  const superArgs = node.childForFieldName("superclasses");
  if (superArgs) {
    for (let i = 0; i < superArgs.childCount; i++) {
      const c = superArgs.child(i);
      if (c && c.type === "identifier") {
        bases.push(c.text.trim());
      }
    }
  }

  const body = node.childForFieldName("body");
  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const c = body.child(i);
      if (!c) continue;
      if (c.type === "function_definition") {
        const mName = c.childForFieldName("name")?.text || "(anonymous)";
        const calls: string[] = [];
        const walkCalls = (curr: Node) => {
          if (curr.type === "call") {
            const fn = curr.childForFieldName("function");
            if (fn) {
              if (fn.type === "identifier") {
                calls.push(fn.text);
              } else if (fn.type === "attribute") {
                const attr = fn.childForFieldName("attribute");
                if (attr) calls.push(attr.text);
              }
            }
          }
          for (let k = 0; k < curr.childCount; k++) {
            const sub = curr.child(k);
            if (sub) walkCalls(sub);
          }
        };
        walkCalls(c);
        methods.push({ name: mName, calls: [...new Set(calls)] });
      } else if (c.type === "expression_statement") {
        // e.g. x: int = 5
        const first = c.firstNamedChild;
        if (first && first.type === "assignment") {
          const left = first.childForFieldName("left");
          const typeAnn = first.childForFieldName("type");
          if (left && left.type === "identifier") {
            fields.push({ name: left.text, type: typeAnn?.text });
          }
        }
      }
    }
  }

  return {
    name,
    bases: [...new Set(bases)],
    interfaces: [],
    fields,
    methods,
    line: node.startPosition.row + 1,
  };
}

function extractPythonImports(node: Node): ExtractedImportInfo[] {
  const imports: ExtractedImportInfo[] = [];

  const visit = (curr: Node) => {
    if (curr.type === "import_statement") {
      for (let i = 0; i < curr.childCount; i++) {
        const c = curr.child(i);
        if (c?.type === "dotted_name") {
          imports.push({
            specifier: c.text,
            symbols: [{ imported: c.text, local: c.text }],
          });
        }
      }
    } else if (curr.type === "import_from_statement") {
      const moduleNode = curr.childForFieldName("module_name");
      const specifier = moduleNode ? moduleNode.text : "";
      const symbols: Array<{ imported: string; local: string }> = [];
      for (let i = 0; i < curr.childCount; i++) {
        const c = curr.child(i);
        if (c?.type === "dotted_name" && c !== moduleNode) {
          symbols.push({ imported: c.text, local: c.text });
        }
      }
      if (specifier) {
        imports.push({ specifier, symbols });
      }
    }
    for (let i = 0; i < curr.childCount; i++) {
      const child = curr.child(i);
      if (child) visit(child);
    }
  };

  visit(node);
  return imports;
}

// Fallback regex extractor for unsupported languages or when TreeSitter is absent
function extractRegexFallback(content: string, filePath: string): ExtractedFileInfo {
  const classes: ExtractedClassInfo[] = [];
  const imports: ExtractedImportInfo[] = [];

  // Match class definitions with extends/implements
  const classRegex = /(?:export\s+)?(?:default\s+)?class\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$.]+))?(?:\s+implements\s+([A-Za-z0-9_$,\s]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = classRegex.exec(content)) !== null) {
    const name = m[1] || "(anonymous)";
    const bases = m[2] ? [m[2].trim()] : [];
    const interfaces = m[3] ? m[3].split(",").map((s) => s.trim()).filter(Boolean) : [];
    const line = content.slice(0, m.index).split("\n").length;
    classes.push({
      name,
      bases,
      interfaces,
      fields: [],
      methods: [],
      line,
    });
  }

  // Match imports
  const importRegex = /import\s+(?:(?:\{([^}]+)\})|([A-Za-z0-9_$]+)|\*\s+as\s+([A-Za-z0-9_$]+))\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = importRegex.exec(content)) !== null) {
    const specifier = m[4] || "";
    const symbols: Array<{ imported: string; local: string }> = [];
    if (m[1]) {
      for (const part of m[1].split(",")) {
        const trimmed = part.trim();
        if (trimmed) symbols.push({ imported: trimmed, local: trimmed });
      }
    } else if (m[2]) {
      symbols.push({ imported: m[2], local: m[2] });
    } else if (m[3]) {
      symbols.push({ imported: "*", local: m[3] });
    }
    if (specifier) {
      imports.push({ specifier, symbols });
    }
  }

  // Match standalone functions
  const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*\{([^}]*)\}/g;
  const functions: Array<{ name: string; calls: string[]; line: number }> = [];
  while ((m = functionRegex.exec(content)) !== null) {
    const name = m[1] || "(anonymous)";
    const body = m[3] || "";
    const calls: string[] = [];
    const callRegex = /\b([a-zA-Z0-9_$]+)\s*\(/g;
    let cm: RegExpExecArray | null;
    while ((cm = callRegex.exec(body)) !== null) {
      if (cm[1] && !["if", "for", "while", "switch", "catch", "function"].includes(cm[1])) {
        calls.push(cm[1]);
      }
    }
    const line = content.slice(0, m.index).split("\n").length;
    functions.push({ name, calls: [...new Set(calls)], line });
  }

  // Match arrow functions / function expressions assigned to variables
  const arrowRegex = /(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>\s*\{([^}]*)\}/g;
  while ((m = arrowRegex.exec(content)) !== null) {
    const name = m[1] || "(anonymous)";
    const body = m[2] || "";
    const calls: string[] = [];
    const callRegex = /\b([a-zA-Z0-9_$]+)\s*\(/g;
    let cm: RegExpExecArray | null;
    while ((cm = callRegex.exec(body)) !== null) {
      if (cm[1] && !["if", "for", "while", "switch", "catch", "function"].includes(cm[1])) {
        calls.push(cm[1]);
      }
    }
    const line = content.slice(0, m.index).split("\n").length;
    functions.push({ name, calls: [...new Set(calls)], line });
  }

  return {
    filePath,
    classes,
    imports,
    functions,
  };
}

export async function extractFileInfo(filePath: string, content: string): Promise<ExtractedFileInfo> {
  const lang = await loadLanguageForFile(filePath);
  if (!lang) {
    return extractRegexFallback(content, filePath);
  }

  try {
    const { Parser } = await import("web-tree-sitter");
    const wasmPath = (await import("./saVmTreeSitter.js")).getTreeSitterWasmPath();
    if (wasmPath) {
      await Parser.init({ locateFile: () => wasmPath });
    }
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(content);
    if (!tree) {
      return extractRegexFallback(content, filePath);
    }
    const root = tree.rootNode;
    const langName = getLanguageNameForFile(filePath);

    const classes: ExtractedClassInfo[] = [];
    const functions: Array<{ name: string; calls: string[]; line: number }> = [];
    let imports: ExtractedImportInfo[] = [];

    if (langName === "typescript" || langName === "tsx" || langName === "javascript") {
      imports = extractTsImports(root);
      const visit = (n: Node) => {
        if (n.type === "class_declaration" || (n.type === "class" && n.isNamed)) {
          classes.push(extractTsClass(n));
        } else if (n.type === "interface_declaration") {
          classes.push(extractTsInterface(n));
        } else if (n.type === "function_declaration" || n.type === "generator_function_declaration") {
          const fnName = n.childForFieldName("name")?.text || "(anonymous)";
          const calls: string[] = [];
          const walkCalls = (curr: Node) => {
            if (curr.type === "call_expression") {
              const fnNode = curr.childForFieldName("function");
              if (fnNode) {
                const callText = fnNode.text.replace(/^this\./, "").replace(/^[a-zA-Z0-9_$]+\./, "");
                if (callText && /^[a-zA-Z0-9_$]+$/.test(callText)) {
                  calls.push(callText);
                }
              }
            }
            for (let k = 0; k < curr.namedChildCount; k++) {
              const sub = curr.namedChild(k);
              if (sub) walkCalls(sub);
            }
          };
          walkCalls(n);
          functions.push({
            name: fnName,
            calls: [...new Set(calls)],
            line: n.startPosition.row + 1,
          });
        } else if (n.type === "lexical_declaration" || n.type === "variable_declaration") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const decl = n.namedChild(i);
            if (decl && decl.type === "variable_declarator") {
              const valNode = decl.childForFieldName("value");
              if (valNode && (valNode.type === "arrow_function" || valNode.type === "function_expression" || valNode.type === "function")) {
                const fnName = decl.childForFieldName("name")?.text || "(anonymous)";
                const calls: string[] = [];
                const walkCalls = (curr: Node) => {
                  if (curr.type === "call_expression") {
                    const fnNode = curr.childForFieldName("function");
                    if (fnNode) {
                      const callText = fnNode.text.replace(/^this\./, "").replace(/^[a-zA-Z0-9_$]+\./, "");
                      if (callText && /^[a-zA-Z0-9_$]+$/.test(callText)) {
                        calls.push(callText);
                      }
                    }
                  }
                  for (let k = 0; k < curr.namedChildCount; k++) {
                    const sub = curr.namedChild(k);
                    if (sub) walkCalls(sub);
                  }
                };
                walkCalls(valNode);
                functions.push({
                  name: fnName,
                  calls: [...new Set(calls)],
                  line: decl.startPosition.row + 1,
                });
              }
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i);
          if (c) visit(c);
        }
      };
      visit(root);
    } else if (langName === "python") {
      imports = extractPythonImports(root);
      const visit = (n: Node) => {
        if (n.type === "class_definition") {
          classes.push(extractPythonClass(n));
        } else if (n.type === "function_definition") {
          const fnName = n.childForFieldName("name")?.text || "(anonymous)";
          const calls: string[] = [];
          const walkCalls = (curr: Node) => {
            if (curr.type === "call") {
              const fnNode = curr.childForFieldName("function");
              if (fnNode) {
                if (fnNode.type === "identifier") {
                  calls.push(fnNode.text);
                } else if (fnNode.type === "attribute") {
                  const attr = fnNode.childForFieldName("attribute");
                  if (attr) calls.push(attr.text);
                }
              }
            }
            for (let k = 0; k < curr.namedChildCount; k++) {
              const sub = curr.namedChild(k);
              if (sub) walkCalls(sub);
            }
          };
          walkCalls(n);
          functions.push({
            name: fnName,
            calls: [...new Set(calls)],
            line: n.startPosition.row + 1,
          });
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i);
          if (c) visit(c);
        }
      };
      visit(root);
    } else {
      return extractRegexFallback(content, filePath);
    }

    return {
      filePath,
      classes,
      imports,
      functions,
    };
  } catch {
    return extractRegexFallback(content, filePath);
  }
}

// ── Path & Import Resolution ───────────────────────────────────────────────────

export function resolveImportFilePath(importerAbsPath: string, specifier: string, _cwd?: string): string | null {
  if (!specifier.startsWith(".")) {
    return null; // External package
  }

  const importerDir = dirname(importerAbsPath);
  const rawBase = resolve(importerDir, specifier);
  const candidates = [
    rawBase,
    rawBase.replace(/\.js$/, ".ts"),
    rawBase.replace(/\.js$/, ".tsx"),
    rawBase + ".ts",
    rawBase + ".tsx",
    rawBase + ".js",
    rawBase + ".mjs",
    rawBase + ".py",
    join(rawBase, "index.ts"),
    join(rawBase, "index.tsx"),
    join(rawBase, "index.js"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        const st = statSyncSafe(c);
        if (st?.isFile()) return c;
      } catch {}
    }
  }
  return null;
}

function statSyncSafe(path: string) {
  try {
    const { statSync } = require("node:fs");
    return statSync(path);
  } catch {
    return null;
  }
}

export function findProjectSourceFiles(dir: string, maxFiles = 200): string[] {
  const results: string[] = [];
  const walk = (currentDir: string, depth = 0) => {
    if (depth > 6 || results.length >= maxFiles) return;
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxFiles) break;
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name.startsWith(".") ||
            ["node_modules", "dist", "build", "coverage", "release", "desktop-resources", "temp", "tmp"].includes(entry.name)
          ) {
            continue;
          }
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py"].includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    } catch {}
  };
  walk(dir);
  return results;
}

// ── Scoped Graph Crawler ───────────────────────────────────────────────────────

export async function buildScopedCodeGraph(
  options: CodeGraphOptions,
  policy: NormalizedSaVmPolicy,
  cwd: string
): Promise<{ nodes: CodeGraphNode[]; edges: CodeGraphEdge[]; rootId: string; truncated: boolean }> {
  const target = options.target.trim();
  const maxDepth = Math.max(1, Math.min(options.depth ?? 2, 5));
  const maxNodes = Math.max(5, Math.min(options.max_nodes ?? 30, 100));
  const direction = options.direction ?? "both";

  const nodes = new Map<string, CodeGraphNode>();
  const edges: CodeGraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const addEdge = (source: string, target: string, kind: CodeGraphEdgeKind, label?: string) => {
    const key = `${source}|${target}|${kind}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({ source, target, kind, label });
    }
  };

  // Determine if target is a file or a symbol
  const targetAsPath = isAbsolute(target) ? target : resolve(cwd, target);
  const isFileTarget = existsSync(targetAsPath) && statSyncSafe(targetAsPath)?.isFile();

  const fileCache = new Map<string, ExtractedFileInfo>();
  const getFileAST = async (absPath: string): Promise<ExtractedFileInfo | null> => {
    if (fileCache.has(absPath)) return fileCache.get(absPath)!;
    const check = checkSaVmPath(policy, "read", absPath, cwd);
    if (!check.allowed) return null;
    try {
      const content = await readFile(absPath, "utf8");
      const rel = relative(cwd, absPath).replace(/\\/g, "/");
      const info = await extractFileInfo(rel, content);
      fileCache.set(absPath, info);
      return info;
    } catch {
      return null;
    }
  };

  let rootId = target;
  let truncated = false;

  const normalizedMode = options.mode === "module_dependency" || options.mode === "module_deps"
    ? "module_dependency"
    : options.mode === "call_flow"
    ? "call_flow"
    : isFileTarget
    ? "module_dependency"
    : "symbol_hierarchy";

  if (normalizedMode === "module_dependency") {
    // ── Mode: module_dependency (also accepts module_deps alias) ──
    const candidateFiles = options.candidate_files ?? options.files;
    let rootAbs = isFileTarget ? targetAsPath : resolve(cwd, target);

    const allSearchFiles: string[] = Array.isArray(candidateFiles) && candidateFiles.length > 0
      ? candidateFiles.map((p) => (isAbsolute(p) ? p : resolve(cwd, p)))
      : findProjectSourceFiles(existsSync(rootAbs) ? dirname(rootAbs) : cwd, 200);

    if (!existsSync(rootAbs)) {
      const match = allSearchFiles.find(
        (f) => f.endsWith(target) || relative(cwd, f).replace(/\\/g, "/") === target
      );
      if (match) rootAbs = match;
    }

    const rootRel = relative(cwd, rootAbs).replace(/\\/g, "/");
    rootId = rootRel;
    nodes.set(rootRel, { id: rootRel, label: rootRel, kind: "module", file: rootRel });

    // 1. Upstream traversal: what does current module import?
    if (direction === "upstream" || direction === "both") {
      const upstreamQueue: Array<{ absPath: string; depth: number }> = [{ absPath: rootAbs, depth: 0 }];
      const visitedUpstream = new Set<string>([rootAbs]);

      while (upstreamQueue.length > 0) {
        if (nodes.size >= maxNodes) {
          truncated = true;
          break;
        }
        const item = upstreamQueue.shift()!;
        if (item.depth >= maxDepth) continue;

        const info = await getFileAST(item.absPath);
        if (!info) continue;
        const currentRel = relative(cwd, item.absPath).replace(/\\/g, "/");

        for (const imp of info.imports) {
          const resolved = resolveImportFilePath(item.absPath, imp.specifier, cwd);
          if (resolved) {
            const targetRel = relative(cwd, resolved).replace(/\\/g, "/");
            if (!nodes.has(targetRel)) {
              if (nodes.size >= maxNodes) {
                truncated = true;
                break;
              }
              nodes.set(targetRel, { id: targetRel, label: targetRel, kind: "module", file: targetRel });
            }
            addEdge(currentRel, targetRel, "imports", "imports");

            if (!visitedUpstream.has(resolved)) {
              visitedUpstream.add(resolved);
              upstreamQueue.push({ absPath: resolved, depth: item.depth + 1 });
            }
          }
        }
      }
    }

    // 2. Downstream traversal: what modules import current module?
    if (direction === "downstream" || direction === "both") {
      const downstreamQueue: Array<{ absPath: string; depth: number }> = [{ absPath: rootAbs, depth: 0 }];
      const visitedDownstream = new Set<string>([rootAbs]);

      while (downstreamQueue.length > 0) {
        if (nodes.size >= maxNodes) {
          truncated = true;
          break;
        }
        const item = downstreamQueue.shift()!;
        if (item.depth >= maxDepth) continue;

        const currentTargetAbs = item.absPath;
        const currentTargetRel = relative(cwd, currentTargetAbs).replace(/\\/g, "/");

        for (const candAbs of allSearchFiles) {
          if (candAbs === currentTargetAbs) continue;
          const candInfo = await getFileAST(candAbs);
          if (!candInfo) continue;

          let candImportsTarget = false;
          for (const imp of candInfo.imports) {
            const resolved = resolveImportFilePath(candAbs, imp.specifier, cwd);
            if (resolved === currentTargetAbs) {
              candImportsTarget = true;
              break;
            }
          }

          if (candImportsTarget) {
            const candRel = relative(cwd, candAbs).replace(/\\/g, "/");
            if (!nodes.has(candRel)) {
              if (nodes.size >= maxNodes) {
                truncated = true;
                break;
              }
              nodes.set(candRel, { id: candRel, label: candRel, kind: "module", file: candRel });
            }
            addEdge(candRel, currentTargetRel, "imports", "imports");

            if (!visitedDownstream.has(candAbs)) {
              visitedDownstream.add(candAbs);
              downstreamQueue.push({ absPath: candAbs, depth: item.depth + 1 });
            }
          }
        }
      }
    }
  } else if (normalizedMode === "call_flow") {
    // ── Mode: call_flow ──
    const candidateFiles = options.candidate_files ?? options.files;
    const searchPaths: string[] = Array.isArray(candidateFiles) && candidateFiles.length > 0
      ? candidateFiles.map((p) => (isAbsolute(p) ? p : resolve(cwd, p)))
      : findProjectSourceFiles(cwd, 100);

    let foundFile: string | null = null;
    let foundClass: ExtractedClassInfo | null = null;
    let foundFunc: { name: string; calls: string[]; line: number } | null = null;

    for (const p of searchPaths) {
      if (!existsSync(p)) continue;
      const info = await getFileAST(p);
      if (!info) continue;
      const matchCls = info.classes.find((c) => c.name === target);
      if (matchCls) {
        foundFile = p;
        foundClass = matchCls;
        break;
      }
      const matchFn = info.functions.find((f) => f.name === target);
      if (matchFn) {
        foundFile = p;
        foundFunc = matchFn;
        break;
      }
    }

    rootId = target;
    const fileRel = foundFile ? relative(cwd, foundFile).replace(/\\/g, "/") : undefined;
    nodes.set(target, { id: target, label: target, kind: foundClass ? "class" : "function", file: fileRel });

    // Collect all functions and class methods across search paths for deep call traversal
    const allFunctions = new Map<string, { calls: string[]; fileRel?: string }>();
    for (const p of searchPaths) {
      if (!existsSync(p)) continue;
      const info = await getFileAST(p);
      if (!info) continue;
      const fRel = relative(cwd, p).replace(/\\/g, "/");
      for (const fn of info.functions) {
        if (!allFunctions.has(fn.name)) {
          allFunctions.set(fn.name, { calls: fn.calls, fileRel: fRel });
        }
      }
      for (const cls of info.classes) {
        for (const m of cls.methods) {
          const qualified = `${cls.name}.${m.name}`;
          if (!allFunctions.has(qualified)) {
            allFunctions.set(qualified, { calls: m.calls, fileRel: fRel });
          }
          if (!allFunctions.has(m.name)) {
            allFunctions.set(m.name, { calls: m.calls, fileRel: fRel });
          }
        }
      }
    }

    if (foundClass) {
      const funcQueue: Array<{ callerName: string; calls: string[]; depth: number }> = [];
      for (const m of foundClass.methods) {
        const callerName = `${target}.${m.name}`;
        nodes.set(callerName, { id: callerName, label: callerName, kind: "function" });
        addEdge(target, callerName, "calls", "has_method");
        funcQueue.push({ callerName, calls: m.calls, depth: 1 });
      }

      const visitedCallers = new Set<string>(funcQueue.map((q) => q.callerName));
      while (funcQueue.length > 0) {
        if (nodes.size >= maxNodes) {
          truncated = true;
          break;
        }
        const item = funcQueue.shift()!;
        for (const callee of item.calls) {
          if (!nodes.has(callee)) {
            if (nodes.size >= maxNodes) {
              truncated = true;
              break;
            }
            const calleeData = allFunctions.get(callee);
            nodes.set(callee, { id: callee, label: callee, kind: "function", file: calleeData?.fileRel });
          }
          addEdge(item.callerName, callee, "calls", "calls");

          if (item.depth < maxDepth && !visitedCallers.has(callee)) {
            visitedCallers.add(callee);
            const calleeFn = allFunctions.get(callee);
            if (calleeFn && calleeFn.calls.length > 0) {
              funcQueue.push({ callerName: callee, calls: calleeFn.calls, depth: item.depth + 1 });
            }
          }
        }
      }
    } else if (foundFunc) {
      const funcQueue: Array<{ callerName: string; calls: string[]; depth: number }> = [
        { callerName: target, calls: foundFunc.calls, depth: 1 }
      ];
      const visitedCallers = new Set<string>([target]);

      while (funcQueue.length > 0) {
        if (nodes.size >= maxNodes) {
          truncated = true;
          break;
        }
        const item = funcQueue.shift()!;
        for (const callee of item.calls) {
          if (!nodes.has(callee)) {
            if (nodes.size >= maxNodes) {
              truncated = true;
              break;
            }
            const calleeData = allFunctions.get(callee);
            nodes.set(callee, { id: callee, label: callee, kind: "function", file: calleeData?.fileRel });
          }
          addEdge(item.callerName, callee, "calls", "calls");

          if (item.depth < maxDepth && !visitedCallers.has(callee)) {
            visitedCallers.add(callee);
            const calleeFn = allFunctions.get(callee);
            if (calleeFn && calleeFn.calls.length > 0) {
              funcQueue.push({ callerName: callee, calls: calleeFn.calls, depth: item.depth + 1 });
            }
          }
        }
      }
    }
  } else {
    // ── Mode: symbol_hierarchy ──
    // 1. Locate symbol definition
    let foundFile: string | null = null;
    let foundClass: ExtractedClassInfo | null = null;

    const candidateFiles = options.candidate_files ?? options.files;
    let searchPaths: string[] = [];

    if (Array.isArray(candidateFiles) && candidateFiles.length > 0) {
      searchPaths = candidateFiles.map((p) => (isAbsolute(p) ? p : resolve(cwd, p)));
    } else {
      // Fast heuristic search in cwd
      searchPaths = [
        resolve(cwd, "apps/server/src/opencodeBridge.ts"),
        resolve(cwd, "backends/mini/src/runtime/miniBridge.ts"),
        resolve(cwd, "apps/server/src/index.ts"),
      ];
    }

    // Try finding in candidate files
    for (const p of searchPaths) {
      if (existsSync(p)) {
        const info = await getFileAST(p);
        if (info) {
          const match = info.classes.find((c) => c.name === target);
          if (match) {
            foundFile = p;
            foundClass = match;
            break;
          }
        }
      }
    }

    // If still not found, search in cwd for the class declaration
    if (!foundClass) {
      for (const p of searchPaths) {
        if (!existsSync(p)) continue;
        const info = await getFileAST(p);
        if (!info) continue;
        const match = info.classes.find((c) => c.name === target);
        if (match) {
          foundFile = p;
          foundClass = match;
          break;
        }
      }
    }

    if (!foundClass) {
      // Fallback: create mock node
      rootId = target;
      nodes.set(target, { id: target, label: target, kind: "class" });
    } else {
      rootId = foundClass.name;
      const relPath = foundFile ? relative(cwd, foundFile).replace(/\\/g, "/") : undefined;
      nodes.set(rootId, { id: rootId, label: rootId, kind: "class", file: relPath, line: foundClass.line });

      // Add bases (extends)
      for (const base of foundClass.bases) {
        if (!nodes.has(base)) {
          nodes.set(base, { id: base, label: base, kind: "class" });
        }
        addEdge(rootId, base, "extends", "extends");
      }

      // Add interfaces (implements)
      for (const iface of foundClass.interfaces) {
        if (!nodes.has(iface)) {
          nodes.set(iface, { id: iface, label: iface, kind: "interface" });
        }
        addEdge(rootId, iface, "implements", "impl");
      }

      // Add owns (member fields with class types)
      const ownedTypes = new Set<string>();
      for (const field of foundClass.fields) {
        if (field.type) {
          const typeName = field.type.replace(/<.*>$/, "").trim();
          if (
            typeName &&
            /^[A-Z][a-zA-Z0-9_$]*$/.test(typeName) &&
            !["String", "Number", "Boolean", "Date", "Promise", "Map", "Set", "Array", "Record"].includes(typeName)
          ) {
            ownedTypes.add(typeName);
          }
        }
      }
      for (const owned of ownedTypes) {
        if (!nodes.has(owned)) {
          nodes.set(owned, { id: owned, label: owned, kind: "class" });
        }
        addEdge(rootId, owned, "owns", "owns");
      }

      // If depth > 1, follow imports of base classes to find their parents
      if (maxDepth > 1 && foundFile) {
        const fileInfo = await getFileAST(foundFile);
        if (fileInfo) {
          for (const baseName of [...foundClass.bases, ...foundClass.interfaces]) {
            const imp = fileInfo.imports.find((i) => i.symbols.some((s) => s.local === baseName));
            if (imp) {
              const baseAbs = resolveImportFilePath(foundFile, imp.specifier, cwd);
              if (baseAbs) {
                const baseInfo = await getFileAST(baseAbs);
                const parentClass = baseInfo?.classes.find((c) => c.name === baseName);
                if (parentClass) {
                  for (const gBase of parentClass.bases) {
                    if (!nodes.has(gBase)) {
                      nodes.set(gBase, { id: gBase, label: gBase, kind: "class" });
                    }
                    addEdge(baseName, gBase, "extends", "extends");
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    rootId,
    truncated,
  };
}

// ── Formatters ─────────────────────────────────────────────────────────────────

export function formatAsDot(
  graph: { nodes: CodeGraphNode[]; edges: CodeGraphEdge[]; rootId: string; truncated: boolean },
  title?: string
): string {
  const graphName = (title || graph.rootId || "CodeGraph").replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];
  lines.push(`digraph ${graphName} {`);
  lines.push("  rankdir=TB;");
  lines.push('  node [shape=box, fontname="Helvetica", fontsize=10];');
  lines.push('  edge [fontname="Helvetica", fontsize=9];');

  // Highlight root node
  if (graph.rootId) {
    lines.push(`  "${graph.rootId}" [style=filled, fillcolor="#e1f5fe"];`);
  }

  // Render edges
  // Group edges by source and label where possible: source -> { t1 t2 }
  const groupedEdges = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const key = `${edge.source}|${edge.kind}|${edge.label ?? ""}`;
    if (!groupedEdges.has(key)) groupedEdges.set(key, []);
    groupedEdges.get(key)!.push(edge.target);
  }

  for (const [key, targets] of groupedEdges.entries()) {
    const [source, kind, label] = key.split("|");
    const attrs: string[] = [];
    if (label) attrs.push(`label="${label}"`);
    if (kind === "implements") attrs.push('style="dashed"');
    else if (kind === "owns") attrs.push('arrowhead="diamond"');
    else if (kind === "calls") attrs.push('style="dotted"');
    const attrStr = attrs.length > 0 ? ` [${attrs.join(", ")}]` : "";
    if (targets.length === 1) {
      lines.push(`  "${source}" -> "${targets[0]}"${attrStr};`);
    } else {
      const targetList = targets.map((t) => `"${t}"`).join(" ");
      lines.push(`  "${source}" -> { ${targetList} }${attrStr};`);
    }
  }

  if (graph.edges.length === 0 && graph.nodes.length > 0) {
    for (const n of graph.nodes) {
      lines.push(`  "${n.id}";`);
    }
  }

  lines.push("}");
  if (graph.truncated) {
    lines.push("// [Truncated: exceeded max_nodes budget]");
  }
  return lines.join("\n");
}

export function formatAsPyStub(
  graph: { nodes: CodeGraphNode[]; edges: CodeGraphEdge[]; rootId: string; truncated: boolean }
): string {
  const lines: string[] = [
    "# Architecture Skeleton (Python Stub)",
    "from __future__ import annotations",
    "from typing import Any, Optional",
    "",
  ];

  // Group relations by source node
  const classBases = new Map<string, string[]>();
  const classFields = new Map<string, string[]>();

  for (const node of graph.nodes) {
    classBases.set(node.id, []);
    classFields.set(node.id, []);
  }

  for (const edge of graph.edges) {
    if (edge.kind === "extends" || edge.kind === "implements") {
      if (!classBases.has(edge.source)) classBases.set(edge.source, []);
      classBases.get(edge.source)!.push(edge.target);
    } else if (edge.kind === "owns") {
      if (!classFields.has(edge.source)) classFields.set(edge.source, []);
      classFields.get(edge.source)!.push(edge.target);
    }
  }

  // Print classes
  for (const node of graph.nodes) {
    const bases = classBases.get(node.id) ?? [];
    const fields = classFields.get(node.id) ?? [];
    const baseStr = bases.length > 0 ? `(${bases.join(", ")})` : "";

    lines.push(`class ${node.id}${baseStr}:`);
    if (node.file) {
      lines.push(`    \"\"\"Defined in ${node.file}\"\"\"`);
    }

    if (fields.length > 0) {
      for (const f of fields) {
        const fieldName = f.charAt(0).toLowerCase() + f.slice(1);
        lines.push(`    ${fieldName}: ${f}`);
      }
    } else if (!node.file) {
      lines.push("    pass");
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatAsNetworkX(
  graph: { nodes: CodeGraphNode[]; edges: CodeGraphEdge[]; rootId: string; truncated: boolean }
): string {
  const lines: string[] = [
    "import networkx as nx",
    "",
    "# Graph construction",
    "G = nx.DiGraph()",
    "",
  ];

  for (const node of graph.nodes) {
    const fileAttr = node.file ? `, file="${node.file}"` : "";
    lines.push(`G.add_node("${node.id}", kind="${node.kind}"${fileAttr})`);
  }
  lines.push("");

  for (const edge of graph.edges) {
    const labelAttr = edge.label ? `, label="${edge.label}"` : "";
    lines.push(`G.add_edge("${edge.source}", "${edge.target}", rel="${edge.kind}"${labelAttr})`);
  }

  lines.push("");
  lines.push("# Query helpers:");
  if (graph.rootId) {
    lines.push(`# print("Ancestors:", nx.ancestors(G, "${graph.rootId}"))`);
    lines.push(`# print("Descendants:", nx.descendants(G, "${graph.rootId}"))`);
  }
  lines.push('# print("Cycles:", list(nx.simple_cycles(G)))');

  return lines.join("\n");
}

// ── Native Action Entry Point ──────────────────────────────────────────────────

export async function nativeCodeGraph(
  rawInput: Record<string, any>,
  policy: SaVmPolicyConfig | undefined,
  cwd: string,
  startedAt: number
): Promise<SaVmRunResult> {
  const target = (rawInput.target ?? rawInput.symbol ?? rawInput.path ?? rawInput.query ?? rawInput.name ?? "").toString().trim();
  if (!target) {
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: "target parameter is required for code_graph (e.g. symbol name or module path)",
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt,
    };
  }

  const normalized = normalizeSaVmPolicy(policy, cwd);
  const options: CodeGraphOptions = {
    target,
    mode: rawInput.mode,
    depth: typeof rawInput.depth === "number" ? rawInput.depth : undefined,
    direction: rawInput.direction,
    format: rawInput.format ?? "dot",
    max_nodes: typeof rawInput.max_nodes === "number" ? rawInput.max_nodes : undefined,
    max_tokens: typeof rawInput.max_tokens === "number" ? rawInput.max_tokens : undefined,
    output_file: typeof rawInput.output_file === "string" && rawInput.output_file.trim() ? rawInput.output_file.trim() : undefined,
    candidate_files: rawInput.candidate_files ?? rawInput.files,
  };

  try {
    const graph = await buildScopedCodeGraph(options, normalized, cwd);

    let output = "";
    if (options.format === "py_stub") {
      output = formatAsPyStub(graph);
    } else if (options.format === "networkx") {
      output = formatAsNetworkX(graph);
    } else {
      output = formatAsDot(graph, target);
    }

    // Optional explicit disk write
    if (options.output_file) {
      const outAbs = isAbsolute(options.output_file) ? options.output_file : resolve(cwd, options.output_file);
      const check = checkSaVmPath(normalized, "write", outAbs, cwd);
      if (!check.allowed) {
        return {
          ok: false,
          kind: "capability_denied",
          exitCode: 228,
          stdout: output,
          stderr: `Policy violation for output_file: ${check.reason || "write not allowed"}`,
          saVmEvents: [],
          saVmViolation: { reason: check.reason },
          durationMs: Date.now() - startedAt,
        };
      }
      await writeFile(outAbs, output, "utf8");
      output = `[Graph saved to ${options.output_file}]\n\n` + output;
    }

    return {
      ok: true,
      kind: "success",
      exitCode: 0,
      stdout: output,
      stderr: graph.truncated ? "[code_graph] graph truncated to max_nodes budget" : "",
      saVmEvents: [
        {
          timestamp: Date.now(),
          type: "code_graph" as any,
          target,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        },
      ],
      saVmViolation: null,
      durationMs: Date.now() - startedAt,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "sa_error",
      exitCode: 1,
      stdout: "",
      stderr: `[code_graph] error analyzing ${target}: ${msg}`,
      saVmEvents: [],
      saVmViolation: null,
      durationMs: Date.now() - startedAt,
    };
  }
}
