import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSaVmTool } from "../../apps/server/src/saVmTool";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";

async function setup(dir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf8");
  }
}

test("edit_file replaceAll replaces every occurrence and reports count", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-replaceall-"));
  try {
    const policy = createDefaultSaVmPolicyConfig();
    await setup(dir, { "a.txt": "foo one\nfoo two\nfoo three\n" });
    const res = await runSaVmTool({
      action: "edit_file",
      path: "a.txt",
      old_text: "foo",
      new_text: "bar",
      replaceAll: true,
      policy,
      cwd: dir,
    });
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("3 occurrence(s)");
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("bar one\nbar two\nbar three\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("edit_file without replaceAll still rejects multi-match with hint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-noreplaceall-"));
  try {
    const policy = createDefaultSaVmPolicyConfig();
    await setup(dir, { "a.txt": "foo one\nfoo two\n" });
    const res = await runSaVmTool({
      action: "edit_file",
      path: "a.txt",
      old_text: "foo",
      new_text: "bar",
      policy,
      cwd: dir,
    });
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("replaceAll=true");
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("foo one\nfoo two\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const NESTED_SOURCE = [
  `import { Box } from "@mui/material";`,
  ``,
  `export function Shell() {`,
  `  return (`,
  `    <Box>`,
  `      {items.map((thread) => {`,
  `        const active = state.activeThreadId === thread.id;`,
  `        const running = runningIds.has(thread.id);`,
  `        return <span key={thread.id}>{active && running ? "on" : "off"}</span>;`,
  `      })}`,
  `    </Box>`,
  `  );`,
  `}`,
  `const active = "global-active-label";`,
  `console.log(active, running);`,
].join("\n");

test("extract_to_file raw mode moves verbatim without export/import wiring", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-raw-"));
  try {
    const policy = createDefaultSaVmPolicyConfig();
    await setup(dir, { "src/A.tsx": NESTED_SOURCE });
    const res = await runSaVmTool({
      action: "extract_to_file",
      source: "src/A.tsx",
      target: "src/Part.tsx",
      start_line: 5,
      end_line: 11,
      raw: true,
      policy,
      cwd: dir,
    });
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("[raw:");
    const target = await readFile(join(dir, "src/Part.tsx"), "utf8");
    expect(target).not.toContain("export const active");
    expect(target).toContain("const active = state.activeThreadId");
    const source = await readFile(join(dir, "src/A.tsx"), "utf8");
    expect(source).not.toContain("from \"./Part\"");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extract_component refuses statement blocks and points to raw mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-stmt-"));
  try {
    const policy = createDefaultSaVmPolicyConfig();
    await setup(dir, { "src/A.tsx": NESTED_SOURCE });
    const before = await readFile(join(dir, "src/A.tsx"), "utf8");
    const res = await runSaVmTool({
      action: "extract_component",
      source: "src/A.tsx",
      target: "src/Part.tsx",
      start_line: 3,
      end_line: 12,
      component_name: "Part",
      policy,
      cwd: dir,
    });
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("raw");
    // nothing written on refusal
    expect(await readFile(join(dir, "src/A.tsx"), "utf8")).toBe(before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("extract_to_file does not export callback-local consts (active/running regression)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-noexport-"));
  try {
    const policy = createDefaultSaVmPolicyConfig();
    await setup(dir, { "src/A.tsx": NESTED_SOURCE });
    const res = await runSaVmTool({
      action: "extract_to_file",
      source: "src/A.tsx",
      target: "src/Part.tsx",
      start_line: 5,
      end_line: 11,
      policy,
      cwd: dir,
    });
    expect(res.ok).toBe(true);
    const target = await readFile(join(dir, "src/Part.tsx"), "utf8");
    expect(target).not.toContain("export const active");
    expect(target).not.toContain("export const running");
    const source = await readFile(join(dir, "src/A.tsx"), "utf8");
    expect(source).not.toContain("import { active");
    expect(source).not.toContain("import { running");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extract_to_file raw mode bypasses the 50-capture gate (verbatim move, caller wires)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-rawgate-"));
  try {
    const policy = createDefaultSaVmPolicyConfig();
    // 60+ 外部捕获的高耦合块：component 模式必须拦，raw 模式必须放行（仅警告）。
    const lines = [`export function Big() {`];
    for (let i = 0; i < 60; i++) lines.push(`  console.log(shared${i}, NESTED_SOURCE);`);
    lines.push(`}`);
    await setup(dir, {
      "src/A.tsx": [...Array.from({ length: 60 }, (_, i) => `const shared${i} = ${i};`), ...lines].join("\n") + "\n",
    });
    const blocked = await runSaVmTool({
      action: "extract_to_file",
      source: "src/A.tsx",
      target: "src/Blocked.tsx",
      start_line: 61,
      end_line: 121,
      policy,
      cwd: dir,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.stderr).toContain("exceed limit 50");
    const raw = await runSaVmTool({
      action: "extract_to_file",
      source: "src/A.tsx",
      target: "src/Raw.tsx",
      start_line: 61,
      end_line: 121,
      raw: true,
      policy,
      cwd: dir,
    });
    expect(raw.ok).toBe(true);
    expect(raw.stdout).toContain("[raw:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
