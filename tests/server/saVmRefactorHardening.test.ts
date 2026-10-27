import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSemanticDiagnosticsForContent,
  autoFixMissingImportsInContent,
  analyzeFileCoupling,
  buildExtractComponent,
  generatePropsTypeImports,
  generatePropsLocalTypes,
  splitEnvironmentalErrors,
} from "../../apps/server/src/saVmTreeSitter";
import {
  nativeExtractToFile,
  nativeExtractComponent,
  nativeAtomicRefactor,
} from "../../apps/server/src/saVmTool";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";

test("extract_to_file inserts import at top, never inside function body", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-topimp-"));
  try {
    const policy = createDefaultSaVmPolicyConfig();
    const srcDir = join(dir, "src");
    await mkdir(join(srcDir, "components"), { recursive: true });
    const sourceFile = join(srcDir, "App.tsx");
    const sourceContent = [
      `import React from "react";`,
      ``,
      `export function App() {`,
      `  const a = 1;`,
      `  const b = 2;`,
      `  return <div>{a + b}</div>;`,
      `}`,
    ].join("\n");
    await writeFile(sourceFile, sourceContent, "utf8");
    const res = await nativeExtractToFile("src/App.tsx", "src/components/Part.tsx", 4, 5, {}, policy, dir, Date.now());
    expect(res.ok).toBe(true);
    const out = await readFile(sourceFile, "utf8");
    const lines = out.split("\n");
    const importIdx = lines.findIndex((l) => l.includes("./components/Part"));
    const fnIdx = lines.findIndex((l) => l.includes("export function App"));
    expect(importIdx).toBeGreaterThanOrEqual(0);
    expect(importIdx).toBeLessThan(fnIdx);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("semantic diagnostics detects type error and missing name", () => {
  const diags = getSemanticDiagnosticsForContent("a.tsx", 'const x:number = "bad"; const y = missingVar;', process.cwd());
  const codes = diags.map((d) => d.code);
  expect(codes).toContain("TS2322");
  expect(codes).toContain("TS2304");
});

test("autoFix is safe no-op on clean file", () => {
  const code = `export function B(){ return 1; }`;
  const res = autoFixMissingImportsInContent("b.tsx", code, process.cwd());
  expect(res.newContent).toBe(code);
  expect(res.applied).toBe(false);
});

test("extract_component dry_run writes nothing and builds import", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-extcomp-"));
  try {
    const policy = createDefaultSaVmPolicyConfig();
    const srcDir = join(dir, "src");
    await mkdir(srcDir, { recursive: true });
    const sourceFile = join(srcDir, "A.tsx");
    const src = `import { useState } from "react";\nexport function Parent() {\n  const [a, setA] = useState(0);\n  return <div>{a}</div>;\n}\n`;
    await writeFile(sourceFile, src, "utf8");
    const built = buildExtractComponent("src/A.tsx", src, 4, 4, "Child", "src/components/Child.tsx");
    expect(built.importStatement).toContain("./components/Child");
    const res = await nativeExtractComponent("src/A.tsx", "src/components/Child.tsx", 4, 4, { component_name: "Child", dry_run: true }, policy, dir, Date.now());
    expect(res.ok).toBe(true);
    let targetExists = true;
    try { await stat(join(srcDir, "components", "Child.tsx")); } catch { targetExists = false; }
    expect(targetExists).toBe(false);
    const after = await readFile(sourceFile, "utf8");
    expect(after).toBe(src);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("atomic_refactor blocks on semantic error with zero writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-atomic-"));
  try {
    const policy = createDefaultSaVmPolicyConfig();
    const res = await nativeAtomicRefactor(
      [{ path: "src/Bad.tsx", content: `const x:number = "bad";\n` }],
      { dry_run: false },
      policy, dir, Date.now()
    );
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(2);
    let exists = true;
    try { await stat(join(dir, "src", "Bad.tsx")); } catch { exists = false; }
    expect(exists).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("analyze_coupling ranks low-coupling candidate first", () => {
  const src = `import { useState } from "react";\nexport function Leaf(){ return <div>hi</div>; }\nexport function Heavy(){ const [a,setA]=useState(0); const [b,setB]=useState(1); return <div>{a}{b}{missingVar}</div>; }\n`;
  const res = analyzeFileCoupling("a.tsx", src, 5);
  expect(res.candidates.length).toBeGreaterThan(0);
  expect(res.candidates[0]!.capturedOuterState).toBeLessThanOrEqual(res.candidates[res.candidates.length - 1]!.capturedOuterState);
});

test("generatePropsTypeImports extracts inferred prop types and rewrites relative paths", () => {
  const src = `
import { SlashCommandNotice, UnrelatedType } from "./types";
import DefaultConfig from "./config";
import type { TypeOnlyThing } from "./typeOnly";
export function Main() {}
`;
  const captured = [
    { name: "notice", type: "SlashCommandNotice | null" },
    { name: "cfg", type: "DefaultConfig" },
    { name: "tOnly", type: "TypeOnlyThing" },
  ];
  const out = generatePropsTypeImports("src/Main.tsx", "src/components/Sub.tsx", src, captured, "");
  expect(out).toContain(`import { SlashCommandNotice } from "../types";`);
  expect(out).toContain(`import DefaultConfig from "../config";`);
  expect(out).toContain(`import type { TypeOnlyThing } from "../typeOnly";`);
  expect(out).not.toContain("UnrelatedType");
});

test("generatePropsLocalTypes recursively expands local type definitions up to 3 rounds", () => {
  const src = `
type LocalCommandNotice = { title: string; detail: NoticeDetail };
type NoticeDetail = { code: ErrorCode };
type ErrorCode = number | string;
type UnrelatedLocal = { skip: boolean };
export function Foo() {}
`;
  const captured = [{ name: "notice", type: "LocalCommandNotice" }];
  const out = generatePropsLocalTypes("src/Foo.tsx", src, captured, "");
  expect(out).toContain("type LocalCommandNotice =");
  expect(out).toContain("type NoticeDetail =");
  expect(out).toContain("type ErrorCode =");
  expect(out).not.toContain("UnrelatedLocal");
});

test("splitEnvironmentalErrors separates declared missing imports from ambient/environmental noise", () => {
  const src = `
import { DeclaredInSource } from "./declared";
const v = obj.existingProp;
`;
  const issues = [
    { line: 1, column: 1, code: "TS2304", message: "Cannot find name 'DeclaredInSource'.", preview: "" },
    { line: 2, column: 1, code: "TS2304", message: "Cannot find name 'ProcessEnvAmbient'.", preview: "" },
    { line: 3, column: 1, code: "TS2339", message: "Property 'existingProp' does not exist on type 'X'.", preview: "" },
    { line: 4, column: 1, code: "TS2339", message: "Property 'unrelatedNewProp' does not exist on type 'X'.", preview: "" },
  ];
  const { hard, warnings } = splitEnvironmentalErrors("src/File.tsx", src, issues);
  expect(hard.map(h => h.message)).toContain("Cannot find name 'DeclaredInSource'.");
  expect(hard.map(h => h.message)).toContain("Property 'unrelatedNewProp' does not exist on type 'X'.");
  expect(warnings.map(w => w.message)).toContain("Cannot find name 'ProcessEnvAmbient'.");
  expect(warnings.map(w => w.message)).toContain("Property 'existingProp' does not exist on type 'X'.");
});

