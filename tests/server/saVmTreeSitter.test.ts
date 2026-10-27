import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSaVmTool } from "../../apps/server/src/saVmTool";
import {
  extractFileOutline,
  renameSymbolInContent,
  findDefinitionInContent,
  getSyntaxDiagnostics,
  addImportToContent,
  getTreeSitterWasmPath,
  getLanguageWasmPath,
  initTreeSitter
} from "../../apps/server/src/saVmTreeSitter";
import { existsSync } from "node:fs";
import type { SaVmPolicyConfig } from "@codex-ui/shared";

function createPermissivePolicy(): SaVmPolicyConfig {
  return {
    engine: "native",
    fs: {
      entries: [
        { path: "${PROJECT}/**", access: "write" }
      ],
      write: ["${PROJECT}/**"]
    },
    tools: {
      fileOutline: true,
      renameSymbol: true,
      moveWithImports: true,
      findDefinition: true,
      extractToFile: true,
      addImport: true,
      getDiagnostics: true,
      findReferences: true,
      replaceRead: true,
      replaceWrite: true
    }
  };
}

test("extractFileOutline generates structural outline for Rust", async () => {
  const rustCode = `
// Comment about User struct
pub struct User {
    pub id: u64,
    pub name: String,
}

pub enum Role {
    Admin,
    Member,
}

impl User {
    pub fn new(id: u64, name: String) -> Self {
        User { id, name }
    }

    pub fn get_name(&self) -> &str {
        &self.name
    }
}

fn calculate_total(a: i32, b: i32) -> i32 {
    a + b
}
`;

  const outline = await extractFileOutline("src/user.rs", rustCode, { detail: true });
  expect(outline.symbols.length).toBeGreaterThanOrEqual(4);

  const structSym = outline.symbols.find(s => s.name === "User" && s.kind === "struct");
  expect(structSym).toBeDefined();
  expect(structSym!.startLine).toBe(3);

  const enumSym = outline.symbols.find(s => s.name === "Role" && s.kind === "enum");
  expect(enumSym).toBeDefined();
  expect(enumSym!.children?.length).toBe(2);

  const implSym = outline.symbols.find(s => s.kind === "impl");
  expect(implSym).toBeDefined();
  expect(implSym!.children?.length).toBe(2);
  expect(implSym!.children?.map(m => m.name)).toContain("new");
  expect(implSym!.children?.map(m => m.name)).toContain("get_name");

  expect(outline.formatted).toContain("[outline] src/user.rs");
  expect(outline.formatted).toContain("struct User");
  expect(outline.formatted).toContain("impl User");
});

test("extractFileOutline generates structural outline for TypeScript", async () => {
  const tsCode = `
export interface WorkerConfig {
  concurrency: number;
}

export class WorkerPool {
  private config: WorkerConfig;
  constructor(config: WorkerConfig) {
    this.config = config;
  }
  public start(): void {}
}

export function createPool(cfg: WorkerConfig): WorkerPool {
  return new WorkerPool(cfg);
}
`;

  const outline = await extractFileOutline("src/pool.ts", tsCode);
  expect(outline.symbols.length).toBe(3);

  const names = outline.symbols.map(s => s.name);
  expect(names).toContain("export WorkerConfig");
  expect(names).toContain("export WorkerPool");
  expect(names).toContain("export createPool");
});

test("extractFileOutline generates structural outline for Python", async () => {
  const pyCode = `
class TaskRunner:
    def __init__(self, name: str):
        self.name = name

    def execute(self):
        print(self.name)

def run_all():
    pass
`;

  const outline = await extractFileOutline("runner.py", pyCode);
  expect(outline.symbols.length).toBe(2);

  const classSym = outline.symbols.find(s => s.name === "TaskRunner");
  expect(classSym).toBeDefined();
  expect(classSym!.kind).toBe("class");
  expect(classSym!.children?.length).toBe(2);

  const fnSym = outline.symbols.find(s => s.name === "run_all");
  expect(fnSym).toBeDefined();
  expect(fnSym!.kind).toBe("function");
});

test("renameSymbolInContent accurately renames code identifiers without corrupting comments or strings", async () => {
  const rustCode = `
// The User struct represents a user.
// Don't rename User in this comment!
pub struct User {
    pub id: u64,
}

impl User {
    pub fn new(id: u64) -> User {
        let msg = "User info string";
        User { id }
    }
}
`;

  const { newContent, edits } = await renameSymbolInContent("src/user.rs", rustCode, "User", "Account");
  expect(edits.length).toBe(4);

  // Comments and string literals must NOT be renamed
  expect(newContent).toContain("// The User struct represents a user.");
  expect(newContent).toContain("// Don't rename User in this comment!");
  expect(newContent).toContain('"User info string"');

  // Code symbols must be renamed
  expect(newContent).toContain("pub struct Account {");
  expect(newContent).toContain("impl Account {");
  expect(newContent).toContain("-> Account {");
  expect(newContent).toContain("Account { id }");
});

test("nativeFileOutline via sa_vm_run enforces policy and outputs formatted tree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "savm-outline-"));
  try {
    const filePath = join(dir, "calc.rs");
    await writeFile(filePath, "pub fn add(a: i32, b: i32) -> i32 { a + b }", "utf8");

    // 1. Capability denied when fileOutline is disabled in policy
    const deniedRes = await runSaVmTool({
      action: "file_outline",
      path: "calc.rs",
      cwd: dir,
      policy: { tools: { fileOutline: false } }
    });
    expect(deniedRes.ok).toBe(false);
    expect(deniedRes.kind).toBe("capability_denied");
    expect(deniedRes.stderr).toContain("fileOutline in VM settings");

    // 2. Success when policy allows fileOutline
    const successRes = await runSaVmTool({
      action: "file_outline",
      path: "calc.rs",
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(successRes.ok).toBe(true);
    expect(successRes.kind).toBe("success");
    expect(successRes.stdout).toContain("[outline] calc.rs");
    expect(successRes.stdout).toContain("function add");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nativeFileOutline truncates to max_tokens and rejects oversized files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "savm-outline-guard-"));
  try {
    const fns = Array.from({ length: 30 }, (_, i) => `export function fn${i}(): number { return ${i}; }`).join("\n");
    await writeFile(join(dir, "many.ts"), `${fns}\n`, "utf8");
    await writeFile(join(dir, "big.ts"), "export const x = 1;\n".padEnd(2 * 1024 * 1024, "x"), "utf8");

    const full = await runSaVmTool({
      action: "file_outline",
      path: "many.ts",
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(full.ok).toBe(true);
    expect(full.stdout).toContain("fn29");
    expect(full.stderr).toBe("");

    const trunc = await runSaVmTool({
      action: "file_outline",
      path: "many.ts",
      max_tokens: 100,
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(trunc.ok).toBe(true);
    expect(trunc.stdout).toContain("truncated");
    expect(trunc.stderr).toContain("truncated");
    expect(trunc.stdout).not.toContain("fn29");

    const tooLarge = await runSaVmTool({
      action: "file_outline",
      path: "big.ts",
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(tooLarge.ok).toBe(false);
    expect(tooLarge.stderr).toContain("max_file_bytes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("workspace_outline outlines a directory in one call with policy gate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "savm-ws-outline-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "export function alpha(): void {}\n", "utf8");
    await writeFile(join(dir, "src", "b.ts"), "export class Beta { run(): void {} }\n", "utf8");

    const denied = await runSaVmTool({
      action: "workspace_outline",
      dir: "src",
      cwd: dir,
      policy: { tools: { fileOutline: false } }
    });
    expect(denied.ok).toBe(false);
    expect(denied.kind).toBe("capability_denied");

    const res = await runSaVmTool({
      action: "workspace_outline",
      dir: "src",
      pattern: "*.ts",
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("[workspace_outline]");
    expect(res.stdout).toContain("alpha");
    expect(res.stdout).toContain("Beta");

    const alias = await runSaVmTool({
      action: "outline_many",
      dir: "src",
      pattern: "*.ts",
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(alias.ok).toBe(true);
    expect(alias.stdout).toContain("[workspace_outline]");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nativeRenameSymbol via sa_vm_run respects dry_run and modifies disk when dry_run=false", async () => {
  const dir = await mkdtemp(join(tmpdir(), "savm-rename-"));
  try {
    const file1 = join(dir, "service.ts");
    const file2 = join(dir, "main.ts");
    await writeFile(file1, "export class OldService { run() {} }\n// OldService comment", "utf8");
    await writeFile(file2, "import { OldService } from './service';\nconst s = new OldService();", "utf8");

    // 1. Dry run preview
    const dryRunRes = await runSaVmTool({
      action: "rename_symbol",
      symbol: "OldService",
      new_name: "NewService",
      dry_run: true,
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(dryRunRes.ok).toBe(true);
    expect(dryRunRes.stdout).toContain("DRY-RUN");
    expect(dryRunRes.stdout).toContain("Renamed 'OldService' -> 'NewService'");

    // Files on disk must NOT be modified after dry run
    expect(await readFile(file1, "utf8")).toContain("export class OldService");

    // 2. Real rename applied
    const realRes = await runSaVmTool({
      action: "rename_symbol",
      symbol: "OldService",
      new_name: "NewService",
      dry_run: false,
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(realRes.ok).toBe(true);
    expect(realRes.stdout).toContain("APPLIED");

    // Files on disk MUST be updated
    const content1 = await readFile(file1, "utf8");
    const content2 = await readFile(file2, "utf8");
    expect(content1).toContain("export class NewService");
    expect(content1).toContain("// OldService comment"); // comment preserved!
    expect(content2).toContain("import { NewService } from './service'");
    expect(content2).toContain("const s = new NewService()");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nativeMoveFileWithImports moves file and updates relative import paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "savm-move-"));
  try {
    const srcDir = join(dir, "src");
    const componentsDir = join(srcDir, "components");
    await mkdir(srcDir, { recursive: true });

    const btnPath = join(srcDir, "Button.tsx");
    const appPath = join(srcDir, "App.tsx");

    await writeFile(btnPath, "export const Button = () => 'button';", "utf8");
    await writeFile(appPath, "import { Button } from './Button';\nexport const App = () => Button();", "utf8");

    // Move Button.tsx to src/components/Button.tsx
    const res = await runSaVmTool({
      action: "move_file_with_imports",
      from: "src/Button.tsx",
      to: "src/components/Button.tsx",
      dry_run: false,
      cwd: dir,
      policy: createPermissivePolicy()
    });

    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("APPLIED");
    expect(res.stdout).toContain("src/Button.tsx");
    expect(res.stdout).toContain("src/components/Button.tsx");

    // Destination file exists, source file gone
    expect(await readFile(join(componentsDir, "Button.tsx"), "utf8")).toContain("export const Button");

    // App.tsx import path updated
    const updatedApp = await readFile(appPath, "utf8");
    expect(updatedApp).toContain("import { Button } from './components/Button'");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("findDefinitionInContent accurately extracts definitions, signatures, and body snippets", async () => {
  const tsCode = `
import { Config } from "./config";

export interface ServiceOptions {
  timeout: number;
}

export class OrderService {
  constructor(private opts: ServiceOptions) {}

  public async processOrder(orderId: string): Promise<boolean> {
    console.log("Processing", orderId);
    return true;
  }
}

export const createOrderService = (opts: ServiceOptions) => new OrderService(opts);
`;

  // 1. Interface definition
  const ifaceDef = await findDefinitionInContent("src/order.ts", tsCode, "ServiceOptions");
  expect(ifaceDef).not.toBeNull();
  expect(ifaceDef!.kind).toBe("interface");
  expect(ifaceDef!.startLine).toBe(4);
  expect(ifaceDef!.bodySnippet).toContain("timeout: number");

  // 2. Class definition
  const classDef = await findDefinitionInContent("src/order.ts", tsCode, "OrderService");
  expect(classDef).not.toBeNull();
  expect(classDef!.kind).toBe("class");
  expect(classDef!.startLine).toBe(8);
  expect(classDef!.bodySnippet).toContain("processOrder");

  // 3. Arrow function constant
  const funcDef = await findDefinitionInContent("src/order.ts", tsCode, "createOrderService");
  expect(funcDef).not.toBeNull();
  expect(funcDef!.kind).toBe("function");
  expect(funcDef!.bodySnippet).toContain("new OrderService(opts)");
});

test("nativeFindDefinition via sa_vm_run supports in-file and cross-file import tracking", async () => {
  const dir = await mkdtemp(join(tmpdir(), "savm-def-"));
  try {
    const helperPath = join(dir, "helper.ts");
    const mainPath = join(dir, "main.ts");

    await writeFile(helperPath, "export function calculateTax(amount: number): number {\n  return amount * 0.1;\n}\n", "utf8");
    await writeFile(mainPath, "import { calculateTax } from './helper';\nconsole.log(calculateTax(100));\n", "utf8");

    // 1. Capability denied when disabled
    const deniedRes = await runSaVmTool({
      action: "find_definition",
      symbol: "calculateTax",
      path: "main.ts",
      cwd: dir,
      policy: { tools: { findDefinition: false } }
    });
    expect(deniedRes.ok).toBe(false);
    expect(deniedRes.kind).toBe("capability_denied");

    // 2. Follows import from main.ts to helper.ts automatically
    const successRes = await runSaVmTool({
      action: "find_definition",
      symbol: "calculateTax",
      path: "main.ts",
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(successRes.ok).toBe(true);
    expect(successRes.stdout).toContain("[find_definition] Found definition for 'calculateTax'");
    expect(successRes.stdout).toContain("helper.ts");
    expect(successRes.stdout).toContain("function calculateTax");
    expect(successRes.stdout).toContain("amount * 0.1");

    // 3. Search workspace when path is omitted
    const workspaceRes = await runSaVmTool({
      action: "find_definition",
      symbol: "calculateTax",
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(workspaceRes.ok).toBe(true);
    expect(workspaceRes.stdout).toContain("helper.ts");
    expect(workspaceRes.stdout).toContain("amount * 0.1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nativeExtractToFile cleanly splits code block to new file and updates source import", async () => {
  const dir = await mkdtemp(join(tmpdir(), "savm-extract-"));
  try {
    const srcDir = join(dir, "src");
    await mkdir(srcDir, { recursive: true });

    const appPath = join(srcDir, "App.tsx");
    const appCode = [
      "import React from 'react';",
      "",
      "// Settings modal component to extract",
      "const SettingsModal = () => {",
      "  return <div>Modal Content</div>;",
      "};",
      "",
      "export const App = () => {",
      "  return <SettingsModal />;",
      "};"
    ].join("\n");

    await writeFile(appPath, appCode, "utf8");

    // 1. Dry run preview
    const dryRunRes = await runSaVmTool({
      action: "extract_to_file",
      source: "src/App.tsx",
      target: "src/SettingsModal.tsx",
      start_line: 4,
      end_line: 6,
      symbols: ["SettingsModal"],
      dry_run: true,
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(dryRunRes.ok).toBe(true);
    expect(dryRunRes.stdout).toContain("DRY-RUN");
    expect(dryRunRes.stdout).toContain("SettingsModal");

    // File on disk unchanged after dry run
    expect(await readFile(appPath, "utf8")).toContain("const SettingsModal");

    // 2. Real extraction
    const realRes = await runSaVmTool({
      action: "extract_to_file",
      source: "src/App.tsx",
      target: "src/SettingsModal.tsx",
      start_line: 4,
      end_line: 6,
      symbols: ["SettingsModal"],
      dry_run: false,
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(realRes.ok).toBe(true);
    expect(realRes.stdout).toContain("APPLIED");

    // Target file created with export
    const targetContent = await readFile(join(srcDir, "SettingsModal.tsx"), "utf8");
    expect(targetContent).toContain("export const SettingsModal");
    expect(targetContent).toContain("Modal Content");

    // Source file updated with import replacing extracted lines
    const updatedSource = await readFile(appPath, "utf8");
    expect(updatedSource).toContain("import { SettingsModal } from \"./SettingsModal\";");
    expect(updatedSource).not.toContain("return <div>Modal Content</div>;");
    expect(updatedSource).toContain("export const App");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nativeAddImport inserts new import or merges into existing import", async () => {
  const dir = await mkdtemp(join(tmpdir(), "savm-addimport-"));
  try {
    const filePath = join(dir, "component.tsx");
    const initialCode = [
      "import React from 'react';",
      "import { Button } from './ui';",
      "",
      "export const View = () => <Button />;"
    ].join("\n");

    await writeFile(filePath, initialCode, "utf8");

    // 1. Merge symbol into existing import from './ui'
    const mergeRes = await runSaVmTool({
      action: "add_import",
      path: "component.tsx",
      symbol: "IconButton",
      module: "./ui",
      dry_run: false,
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(mergeRes.ok).toBe(true);
    expect(mergeRes.stdout).toContain("Merged 'IconButton'");

    const afterMerge = await readFile(filePath, "utf8");
    expect(afterMerge).toContain("import { Button, IconButton } from './ui';");

    // 2. Insert new import after last import
    const newRes = await runSaVmTool({
      action: "add_import",
      path: "component.tsx",
      statement: "import { t } from './i18n';",
      dry_run: false,
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(newRes.ok).toBe(true);
    expect(newRes.stdout).toContain("Inserted import after line");

    const afterNew = await readFile(filePath, "utf8");
    expect(afterNew).toContain("import { t } from './i18n';");

    // 3. No-op when symbol is already imported
    const noopRes = await runSaVmTool({
      action: "add_import",
      path: "component.tsx",
      symbol: "Button",
      module: "./ui",
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(noopRes.ok).toBe(true);
    expect(noopRes.stdout).toContain("already imported");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nativeGetDiagnostics returns instant syntax error detection across languages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "savm-diags-"));
  try {
    const cleanTs = join(dir, "clean.ts");
    const badTs = join(dir, "bad.ts");
    const badRs = join(dir, "bad.rs");

    await writeFile(cleanTs, "export const add = (a: number, b: number): number => a + b;\n", "utf8");
    await writeFile(badTs, "export const add = (a: number, b: number => {\n", "utf8"); // missing bracket and colon
    await writeFile(badRs, "fn broken() { let x = ; }\n", "utf8"); // invalid expression

    // 1. Clean file
    const cleanRes = await runSaVmTool({
      action: "get_diagnostics",
      path: "clean.ts",
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(cleanRes.ok).toBe(true);
    expect(cleanRes.exitCode).toBe(0);
    expect(cleanRes.stdout).toContain("Clean (0 syntax errors)");

    // 2. TypeScript syntax error
    const badTsRes = await runSaVmTool({
      action: "get_diagnostics",
      path: "bad.ts",
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(badTsRes.ok).toBe(true);
    expect(badTsRes.exitCode).toBe(1);
    expect(badTsRes.stdout).toContain("issue(s)");
    expect(badTsRes.stdout).toContain("syntax");

    // 3. Rust syntax error via Tree-sitter
    const badRsRes = await runSaVmTool({
      action: "get_diagnostics",
      path: "bad.rs",
      cwd: dir,
      policy: createPermissivePolicy()
    });
    expect(badRsRes.ok).toBe(true);
    expect(badRsRes.exitCode).toBe(1);
    expect(badRsRes.stdout).toContain("Syntax error");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tree-sitter wasm path resolution and safe initialization", async () => {
  const wasmPath = getTreeSitterWasmPath();
  expect(wasmPath).not.toBeNull();
  expect(typeof wasmPath).toBe("string");
  expect(existsSync(wasmPath!)).toBe(true);
  expect(wasmPath!.endsWith("tree-sitter.wasm")).toBe(true);

  const tsWasm = getLanguageWasmPath("typescript");
  expect(tsWasm).not.toBeNull();
  expect(existsSync(tsWasm!)).toBe(true);
  expect(tsWasm!.endsWith("tree-sitter-typescript.wasm")).toBe(true);

  const unknownWasm = getLanguageWasmPath("unknown_lang_xyz");
  expect(unknownWasm).toBeNull();

  const initialized = await initTreeSitter();
  expect(initialized).toBe(true);
});
