import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  organizeImportsInContent,
  analyzeBlockScope,
  generateTargetImportsForBlock,
  getSyntaxDiagnostics
} from "../../apps/server/src/saVmTreeSitter";
import {
  nativeExtractToFile,
  nativeOrganizeImports,
  nativeAnalyzeScope,
  runSaVmTool
} from "../../apps/server/src/saVmTool";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";

test("organizeImportsInContent removes unused imports and preserves used ones", () => {
  const code = [
    `import { usedFn, unusedFn } from "./helpers";`,
    `import React, { useState, useEffect } from "react";`,
    `import "./styles.css";`,
    ``,
    `export function Component() {`,
    `  const [x] = useState(0);`,
    `  return <div>{usedFn(x)}</div>;`,
    `}`
  ].join("\n");

  const res = organizeImportsInContent("test.tsx", code);
  expect(res.changed).toBe(true);
  expect(res.newContent).toContain(`import { usedFn } from "./helpers";`);
  expect(res.newContent).not.toContain("unusedFn");
  expect(res.newContent).toContain("useState");
  expect(res.newContent).not.toContain("useEffect");
  // Side-effect import should be preserved
  expect(res.newContent).toContain(`import "./styles.css";`);
  // React must be preserved when JSX is used
  expect(res.newContent).toContain("React");
});

test("organizeImportsInContent merges duplicate imports and sorts properly", () => {
  const code = [
    `import { b } from "./utils";`,
    `import { a } from "./utils";`,
    `import fs from "node:fs";`,
    `import { Button } from "@mui/material";`,
    ``,
    `console.log(a, b, fs, Button);`
  ].join("\n");

  const res = organizeImportsInContent("test.ts", code);
  expect(res.changed).toBe(true);
  expect(res.newContent).toContain(`import { a, b } from "./utils";`);
  // node built-ins and external libraries should be placed before relative imports
  const lines = res.newContent.split("\n");
  const fsIdx = lines.findIndex(l => l.includes("node:fs"));
  const muiIdx = lines.findIndex(l => l.includes("@mui/material"));
  const utilsIdx = lines.findIndex(l => l.includes("./utils"));
  expect(fsIdx).toBeLessThan(utilsIdx);
  expect(muiIdx).toBeLessThan(utilsIdx);
});

test("analyzeBlockScope identifies captured variables and suggests Props interface", () => {
  const code = [
    `export function BigComponent() {`,
    `  const [open, setOpen] = useState(false);`,
    `  const [user, setUser] = useState<{ id: string; name: string } | null>(null);`,
    `  const handleClose = () => setOpen(false);`,
    ``,
    `  // Target block to extract: L7 to L12`,
    `  const localTitle = "User Profile";`,
    `  if (!open) return null;`,
    `  return (`,
    `    <div>`,
    `      <h1>{localTitle}</h1>`,
    `      <p>{user?.name}</p>`,
    `      <button onClick={handleClose}>Close</button>`,
    `    </div>`,
    `  );`,
    `}`
  ].join("\n");

  const res = analyzeBlockScope("apps/web/src/BigComponent.tsx", code, 7, 14, {
    componentName: "UserProfileModal"
  });

  const capturedNames = res.capturedVariables.map(v => v.name);
  expect(capturedNames).toContain("open");
  expect(capturedNames).toContain("user");
  expect(capturedNames).toContain("handleClose");
  // localTitle is declared inside the block, so it should be in declaredSymbols, not capturedVariables
  expect(res.declaredSymbols).toContain("localTitle");
  expect(capturedNames).not.toContain("localTitle");

  expect(res.suggestedPropsInterface).toContain("interface UserProfileModalProps");
  expect(res.suggestedPropsInterface).toContain("open: boolean;");
  expect(res.suggestedPropsInterface).toContain("user: { id: string; name: string } | null;");
  expect(res.suggestedPropsInterface).toContain("handleClose: () => void;");

  expect(res.suggestedCallSnippet).toContain("<UserProfileModal");
  expect(res.suggestedCallSnippet).toContain("open={open}");
  expect(res.suggestedCallSnippet).toContain("user={user}");
  expect(res.suggestedCallSnippet).toContain("handleClose={handleClose}");
});

test("getSyntaxDiagnostics flags React Hook ordering violations (early-return and conditional)", async () => {
  // 1. Hook after return (early return protection)
  const badHookOrder = [
    `import React, { useState } from "react";`,
    `export function Component({ status }: { status: string }) {`,
    `  if (status === "loading") {`,
    `    return <div>Loading...</div>;`,
    `  }`,
    `  const [count, setCount] = useState(0);`,
    `  return <div>{count}</div>;`,
    `}`
  ].join("\n");

  const diag1 = await getSyntaxDiagnostics("Component.tsx", badHookOrder);
  expect(diag1.clean).toBe(false);
  expect(diag1.formatted).toContain("React Hook 'useState' is called after an early return");

  // 2. Hook inside conditional statement
  const conditionalHook = [
    `import React, { useEffect } from "react";`,
    `export function Component({ enabled }: { enabled: boolean }) {`,
    `  if (enabled) {`,
    `    useEffect(() => {}, []);`,
    `  }`,
    `  return <div>Hello</div>;`,
    `}`
  ].join("\n");

  const diag2 = await getSyntaxDiagnostics("Component.tsx", conditionalHook);
  expect(diag2.clean).toBe(false);
  expect(diag2.formatted).toContain("React Hook 'useEffect' is called conditionally");

  // 3. Clean component with valid hooks
  const goodComponent = [
    `import React, { useState, useEffect } from "react";`,
    `export function Component({ enabled }: { enabled: boolean }) {`,
    `  const [count, setCount] = useState(0);`,
    `  useEffect(() => {}, []);`,
    `  if (!enabled) return null;`,
    `  return <div>{count}</div>;`,
    `}`
  ].join("\n");

  const diag3 = await getSyntaxDiagnostics("Component.tsx", goodComponent);
  expect(diag3.clean).toBe(true);
});

test("generateTargetImportsForBlock extracts used imports and rewrites relative paths", () => {
  const sourceCode = [
    `import React from "react";`,
    `import { Dialog, Button } from "@mui/material";`,
    `import { helperA, helperB } from "../utils/helpers";`,
    `import { formatTime } from "./dateUtils";`,
    ``,
    `export function App() {`,
    `  return (`,
    `    <Dialog open>`,
    `      <p>{helperA()}</p>`,
    `    </Dialog>`,
    `  );`,
    `}`
  ].join("\n");

  const sourcePath = "apps/web/src/App.tsx";
  const targetPath = "apps/web/src/components/MyDialog.tsx";
  // Block contains Dialog and helperA
  const targetImports = generateTargetImportsForBlock(sourcePath, targetPath, sourceCode, 8, 10);
  expect(targetImports).toContain(`import { Dialog } from "@mui/material";`);
  // helperA was imported from "../utils/helpers" in apps/web/src/App.tsx.
  // In apps/web/src/components/MyDialog.tsx, the relative path to utils should become "../../utils/helpers"
  expect(targetImports).toContain(`import { helperA } from "../../utils/helpers";`);
  // Button, helperB, formatTime were not used in the block, so they should not appear
  expect(targetImports).not.toContain("Button");
  expect(targetImports).not.toContain("helperB");
  expect(targetImports).not.toContain("formatTime");
});

test("nativeExtractToFile automatically injects rewritten imports into the new target file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-sa-vm-extract-"));
  try {
    const policy = createDefaultSaVmPolicyConfig();
    const sourceDir = join(dir, "src");
    const componentsDir = join(dir, "src", "components");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(join(dir, "utils"), { recursive: true });

    const sourceFile = join(sourceDir, "App.tsx");
    const targetFile = join(componentsDir, "Modal.tsx");

    const sourceContent = [
      `import React from "react";`,
      `import { helperFn } from "../utils/math";`,
      `import { unusedHelper } from "../utils/unused";`,
      ``,
      `export function App() {`,
      `  // start extract block L6 to L10`,
      `  const value = helperFn(42);`,
      `  return (`,
      `    <div className="modal">{value}</div>`,
      `  );`,
      `  // end extract block`,
      `}`
    ].join("\n");

    await writeFile(sourceFile, sourceContent, "utf8");

    const res = await nativeExtractToFile(
      "src/App.tsx",
      "src/components/Modal.tsx",
      7,
      10,
      {
        component_name: "ExtractedModal"
      },
      policy,
      dir,
      Date.now()
    );

    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);

    // Target file check
    const targetContent = await readFile(targetFile, "utf8");
    // Target file must contain the rewritten import for helperFn
    expect(targetContent).toContain(`import { helperFn } from "../../utils/math";`);
    expect(targetContent).not.toContain("unusedHelper");
    // Target content must have the extracted lines
    expect(targetContent).toContain("const value = helperFn(42);");

    // Source file check
    const newSourceContent = await readFile(sourceFile, "utf8");
    expect(newSourceContent).toContain(`import { value } from "./components/Modal";`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSaVmTool handles organize_imports and analyze_scope actions end-to-end", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-sa-vm-actions-"));
  try {
    const policy = createDefaultSaVmPolicyConfig();
    const testFile = join(dir, "test.tsx");
    const content = [
      `import { a, b } from "./mod";`,
      `export function Test() {`,
      `  const [active, setActive] = useState(true);`,
      `  return <div>{a} - {active}</div>;`,
      `}`
    ].join("\n");

    await writeFile(testFile, content, "utf8");

    // 1. organize_imports
    const orgRes = await runSaVmTool({
      action: "organize_imports",
      path: "test.tsx"
    }, policy, dir);

    expect(orgRes.ok).toBe(true);
    const updatedContent = await readFile(testFile, "utf8");
    expect(updatedContent).toContain(`import { a } from "./mod";`);
    expect(updatedContent).not.toContain("b");

    // 2. analyze_scope
    const scopeRes = await runSaVmTool({
      action: "analyze_scope",
      path: "test.tsx",
      start_line: 4,
      end_line: 4,
      component_name: "ActiveDisplay"
    }, policy, dir);

    expect(scopeRes.ok).toBe(true);
    expect(scopeRes.stdout).toContain("ActiveDisplayProps");
    expect(scopeRes.stdout).toContain("active");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
