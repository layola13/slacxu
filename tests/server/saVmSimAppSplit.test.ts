import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeExtractToFile, nativeExtractComponent } from "../../apps/server/src/saVmTool";
import { getSyntaxDiagnostics, analyzeBlockScope } from "../../apps/server/src/saVmTreeSitter";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";

// 模拟 APP.TSX 七大模块分拆验收：合成 SimulatedApp（含 Composer/Relay中转/
// Dialog/Drawer/Header/Panel/Chat），沙盒真落盘，语义门禁全程守护。
const here = dirname(fileURLToPath(import.meta.url));

async function setupSandbox() {
  const dir = await mkdtemp(join(tmpdir(), "sim-app-split-"));
  const policy: any = createDefaultSaVmPolicyConfig();
  if (policy.tools) policy.tools.extractToFile = true;
  await mkdir(join(dir, "src", "components"), { recursive: true });
  await mkdir(join(dir, "utils"), { recursive: true });
  const fixture = await readFile(join(here, "saVmSimApp.fixture.tsx"), "utf8");
  await writeFile(join(dir, "src", "SimulatedApp.tsx"), fixture, "utf8");
  await writeFile(join(dir, "utils", "helpers.ts"), `export function helperA(s: string): string { return s; }\nexport function helperB(s: string): string { return s; }\n`, "utf8");
  await writeFile(join(dir, "types.ts"), `export interface RelayConfig { id: string; name: string; }\nexport function formatRelayName(r: RelayConfig): string { return r.name; }\n`, "utf8");
  await writeFile(join(dir, "config.ts"), `const DefaultLimit = 10;\nexport default DefaultLimit;\n`, "utf8");
  return { dir, policy };
}

async function blockRange(dir: string, name: string) {
  const text = await readFile(join(dir, "src", "SimulatedApp.tsx"), "utf8");
  const lines = text.split("\n");
  const sRe = new RegExp(`@sim-block-start\\s+${name}\\s+component=(\\S+)\\s+target=(\\S+)`);
  const eRe = new RegExp(`@sim-block-end\\s+${name}\\b`);
  let start = -1, component = "", target = "";
  for (let i = 0; i < lines.length; i++) {
    const s = sRe.exec(lines[i]!);
    if (s) { start = i + 2; component = s[1]!; target = s[2]!; }
  }
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (eRe.test(lines[i]!)) { end = i; break; }
  }
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return { start, end, component, target };
}

async function expectSyntaxClean(abs: string) {
  const content = await readFile(abs, "utf8");
  const d = await getSyntaxDiagnostics(abs, content);
  expect(d.clean).toBe(true);
}

const MODULES = [
  { name: "HeaderBar", component: "HeaderBarView", target: "src/components/HeaderBarView.tsx" },
  { name: "RelayManager", component: "RelayManagerView", target: "src/components/RelayManagerView.tsx" },
  { name: "FreeModelDialog", component: "FreeModelDialogView", target: "src/components/FreeModelDialogView.tsx" },
  { name: "SettingsDrawer", component: "SettingsDrawerView", target: "src/components/SettingsDrawerView.tsx" },
  { name: "ComposerDock", component: "ComposerDockView", target: "src/components/ComposerDockView.tsx" },
  { name: "WorkbenchPanel", component: "WorkbenchPanelView", target: "src/components/WorkbenchPanelView.tsx" },
  { name: "ChatPanel", component: "ChatPanelView", target: "src/components/ChatPanelView.tsx" },
];

for (const m of MODULES) {
  test(`sim App.tsx split applies ${m.name} cleanly`, async () => {
    const { dir, policy } = await setupSandbox();
    try {
      const b = await blockRange(dir, m.name);
      expect(b.component).toBe(m.component);
      const res = await nativeExtractComponent("src/SimulatedApp.tsx", m.target, b.start, b.end, { component_name: m.component, dry_run: false }, policy, dir, Date.now());
      expect(res.ok).toBe(true);
      let exists = true;
      try { await stat(join(dir, m.target)); } catch { exists = false; }
      expect(exists).toBe(true);
      const src = await readFile(join(dir, "src", "SimulatedApp.tsx"), "utf8");
      expect(src).toContain(`<${m.component}`);
      expect(src).toContain(m.target.replace(/^src\//, "./").replace(/\.tsx$/, ""));
      await expectSyntaxClean(join(dir, m.target));
      await expectSyntaxClean(join(dir, "src", "SimulatedApp.tsx"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("sim high-coupling panel is blocked by extract_to_file gate with zero writes", async () => {
  const { dir, policy } = await setupSandbox();
  try {
    const b = await blockRange(dir, "WorkbenchPanel");
    const res = await nativeExtractToFile("src/SimulatedApp.tsx", "src/components/Blocked.tsx", b.start, b.end, {}, policy, dir, Date.now());
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(2);
    expect(res.stderr ?? "").toContain("captured outer variables exceed limit");
    let exists = true;
    try { await stat(join(dir, "src", "components", "Blocked.tsx")); } catch { exists = false; }
    expect(exists).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sim whole-function tofile dry exports only the function name", async () => {
  const { dir, policy } = await setupSandbox();
  try {
    const text = await readFile(join(dir, "src", "SimulatedApp.tsx"), "utf8");
    const lines = text.split("\n");
    const fnIdx = lines.findIndex((l) => l.includes("function renderComposerDock"));
    expect(fnIdx).toBeGreaterThanOrEqual(0);
    let depth = 0, fnEnd = -1;
    for (let i = fnIdx; i < lines.length; i++) {
      for (const ch of lines[i]!) { if (ch === "{") depth += 1; if (ch === "}") depth -= 1; }
      if (depth === 0 && i > fnIdx) { fnEnd = i + 1; break; }
    }
    expect(fnEnd).toBeGreaterThan(fnIdx);
    const res = await nativeExtractToFile("src/SimulatedApp.tsx", "src/components/__Cd.tsx", fnIdx + 1, fnEnd, { component_name: "ComposerDockView", dry_run: true }, policy, dir, Date.now());
    expect(res.ok).toBe(true);
    expect(res.stdout ?? "").toContain("- Exported symbols: renderComposerDock\n");
    expect(res.stdout ?? "").not.toContain("target, next");
    let exists = true;
    try { await stat(join(dir, "src", "components", "__Cd.tsx")); } catch { exists = false; }
    expect(exists).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// 真机回归：`{cond && <X/>}` 条件容器整段抽取必须自动解包（否则 target TS1005）
test("sim conditional JSX container unwraps cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sim-cond-"));
  const policy: any = createDefaultSaVmPolicyConfig();
  if (policy.tools) policy.tools.extractToFile = true;
  try {
    const src = `import { useState } from "react";\nexport function Page() {\n  const [open, setOpen] = useState(false);\n  const label = "hi";\n  function close() { setOpen(false); }\n  return (\n    <div>\n      {open && (\n        <section>\n          <span>{label}</span>\n          <button onClick={close}>x</button>\n        </section>\n      )}\n    </div>\n  );\n}\n`;
    await mkdir(join(dir, "src", "components"), { recursive: true });
    await writeFile(join(dir, "src", "Page.tsx"), src, "utf8");
    const res = await nativeExtractComponent("src/Page.tsx", "src/components/CondView.tsx", 8, 13, { component_name: "CondView", dry_run: true }, policy, dir, Date.now());
    expect(res.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// 真机回归：`as const` 的 const 不得成为 prop（否则解构处 TS1005）
test("sim as-const never leaks into props", async () => {
  const src = `export function Page() {\n  const kinds = (["a", "b"] as const).map((k) => k);\n  const label = "hi";\n  return (\n    <div>\n      {kinds.map((k) => (<span key={k}>{label}:{k}</span>))}\n    </div>\n  );\n}\n`;
  const sc: any = analyzeBlockScope("src/Page.tsx", src, 5, 7, { componentName: "KindView" });
  const names = sc.capturedVariables.map((v: any) => v.name);
  expect(names).not.toContain("const");
  expect(names).toContain("kinds");
  expect(names).toContain("label");
});

// 真机回归：局部类型体内引用的 import 类型必须跟进目标（否则 TS2304）
test("sim local type deps carry their imports", async () => {
  const src = `import { type Perm } from "./perm";\ntype Intent = { next: Perm };\nexport function Page() {\n  const intent: Intent | null = null;\n  function close() {}\n  return (\n    <div>\n      {intent ? (<span>{intent.next}</span>) : null}\n    </div>\n  );\n}\n`;
  const { buildExtractComponent } = await import("../../apps/server/src/saVmTreeSitter");
  const built: any = buildExtractComponent("src/Page.tsx", src, 8, 8, "IntentView", "src/components/IntentView.tsx");
  expect(built.targetContent).toContain("type Intent = { next: Perm };");
  expect(built.targetContent).toContain("Perm");
  expect(built.targetContent).toMatch(/import\s*\{\s*type\s+Perm\s*\}\s*from\s*"\.\.\/perm"/);
});
