import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";
import { runSaVmTool } from "../../apps/server/src/saVmTool";

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "sa-vm-split-workflow-"));
  const source = `export function App() {\n  return <div>before</div>;\n}\n`;
  await writeFile(join(cwd, "App.tsx"), source, "utf8");
  const policy = createDefaultSaVmPolicyConfig();
  return { cwd, source, policy };
}

test("split workflow stages coarse/refined files off-worktree, commits and rolls back", async () => {
  const { cwd, source, policy } = await setup();
  const originalCodeXHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = join(cwd, ".codex-home");
  try {
    const plan = await runSaVmTool({ action: "split_plan", path: "App.tsx", task: "extract view" }, policy, cwd);
    expect(plan.ok).toBe(true);
    const sessionId = /session_id=([a-f0-9-]{36})/.exec(plan.stdout ?? "")?.[1];
    expect(sessionId).toBeTruthy();

    const coarse = await runSaVmTool({
      action: "split_stage", session_id: sessionId, module_name: "AppView",
      ops: [
        { path: "App.tsx", content: `import { AppView } from "./AppView";\nexport function App() { return <AppView />; }\n` },
        { path: "AppView.tsx", content: `export function AppView() { return <div>before</div>; }\n` },
      ],
    }, policy, cwd);
    expect(coarse.ok).toBe(true);
    const status = await runSaVmTool({ action: "split_status", session_id: sessionId }, policy, cwd);
    expect(status.ok).toBe(true);
    expect(status.stdout).toContain("coarse AppView");
    expect(await readFile(join(cwd, "App.tsx"), "utf8")).toBe(source);

    const refined = await runSaVmTool({
      action: "split_refine", session_id: sessionId, module_name: "AppView markup",
      ops: [{ path: "AppView.tsx", content: `export function AppView() { return <section><div>before</div></section>; }\n` }],
    }, policy, cwd);
    expect(refined.ok).toBe(true);

    const diff = await runSaVmTool({ action: "split_repair", session_id: sessionId, phase: "diff" }, policy, cwd);
    expect(diff.ok).toBe(true);
    expect(diff.stdout).toContain("AppView.tsx");
    const validation = await runSaVmTool({ action: "split_repair", session_id: sessionId, phase: "validate" }, policy, cwd);
    expect(validation.ok).toBe(true);
    const commit = await runSaVmTool({ action: "split_repair", session_id: sessionId, phase: "commit", confirm: true }, policy, cwd);
    expect(commit.ok).toBe(true);
    expect(await readFile(join(cwd, "App.tsx"), "utf8")).toContain("AppView");
    expect(await readFile(join(cwd, "AppView.tsx"), "utf8")).toContain("section");

    const rollback = await runSaVmTool({ action: "split_repair", session_id: sessionId, phase: "rollback" }, policy, cwd);
    expect(rollback.ok).toBe(true);
    expect(await readFile(join(cwd, "App.tsx"), "utf8")).toBe(source);
    await expect(readFile(join(cwd, "AppView.tsx"), "utf8")).rejects.toThrow();
  } finally {
    process.env.CODEX_HOME = originalCodeXHome;
    await rm(cwd, { recursive: true, force: true });
  }
});

test("split workflow rejects commit when a staged source changes concurrently", async () => {
  const { cwd, source, policy } = await setup();
  const originalCodeXHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = join(cwd, ".codex-home");
  try {
    const plan = await runSaVmTool({ action: "split_plan", path: "App.tsx" }, policy, cwd);
    const sessionId = /session_id=([a-f0-9-]{36})/.exec(plan.stdout ?? "")?.[1];
    const stage = await runSaVmTool({
      action: "split_stage", session_id: sessionId,
      ops: [{ path: "App.tsx", content: source.replace("before", "staged") }],
    }, policy, cwd);
    expect(stage.ok).toBe(true);
    const diff = await runSaVmTool({ action: "split_repair", session_id: sessionId, phase: "diff" }, policy, cwd);
    expect(diff.ok).toBe(true);
    const validation = await runSaVmTool({ action: "split_repair", session_id: sessionId, phase: "validate" }, policy, cwd);
    expect(validation.ok).toBe(true);
    await writeFile(join(cwd, "App.tsx"), source.replace("before", "concurrent"), "utf8");
    const commit = await runSaVmTool({ action: "split_repair", session_id: sessionId, phase: "commit", confirm: true }, policy, cwd);
    expect(commit.ok).toBe(false);
    expect(commit.stderr).toContain("changed since staging");
  } finally {
    process.env.CODEX_HOME = originalCodeXHome;
    await rm(cwd, { recursive: true, force: true });
  }
});
