import { expect, test } from "bun:test";
import { runSaVmTool, type SaVmRunResult } from "../../apps/server/src/saVmTool";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

async function makeRepoWithTrackedFile(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "sa-vm-diff-context-"));
  await $`git init -q`.cwd(cwd);
  await $`git config user.email t@t.t`.cwd(cwd);
  await $`git config user.name t`.cwd(cwd);
  const original = Array.from({ length: 12 }, (_, i) => `row ${i + 1}`).join("\n") + "\n";
  await writeFile(join(cwd, "target.txt"), original, "utf8");
  await $`git add target.txt`.cwd(cwd);
  await $`git commit -q -m init`.cwd(cwd);
  await writeFile(join(cwd, "target.txt"), original.replace("row 6", "row 6 CHANGED"), "utf8");
  return cwd;
}

async function diffFor(input: Record<string, unknown>, cwd: string): Promise<string> {
  const result: SaVmRunResult = await runSaVmTool({ cwd, action: "git_diff", ...input } as never);
  expect(result.ok).toBe(true);
  const payload = JSON.parse(result.stdout) as { diff: string };
  return payload.diff;
}

const contextRows = (diff: string) => (diff.match(/\n row \d+/g) ?? []).length;

test("git_diff honors diff_context", async () => {
  const cwd = await makeRepoWithTrackedFile();
  try {
    const narrow = await diffFor({ pathspec: "target.txt", diff_context: 1 }, cwd);
    expect(narrow).toContain("@@ -5,3 +5,3 @@");
    expect(narrow).toContain("+row 6 CHANGED");

    const wide = await diffFor({ pathspec: "target.txt", diff_context: 5 }, cwd);
    expect(wide).toContain("@@ -1,11 +1,11 @@");
    expect(contextRows(wide)).toBeGreaterThan(contextRows(narrow));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("git_diff keeps the legacy numeric context working", async () => {
  const cwd = await makeRepoWithTrackedFile();
  try {
    const viaContext = await diffFor({ pathspec: "target.txt", context: 5 }, cwd);
    const viaDiffContext = await diffFor({ pathspec: "target.txt", diff_context: 5 }, cwd);
    expect(viaContext).toBe(viaDiffContext);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("jev_* supporting text is not reinterpreted as a git_diff context", async () => {
  const cwd = await makeRepoWithTrackedFile();
  try {
    // `context` is the jev_* text field, so prose there must not be coerced into
    // a diff context; `diff_context` is the unambiguous integer channel.
    const narrow = await diffFor({ pathspec: "target.txt", diff_context: 1 }, cwd);
    const withJevText = await diffFor({
      pathspec: "target.txt",
      diff_context: 1,
      context: "please review the surrounding code for regressions"
    }, cwd);
    expect(withJevText).toBe(narrow);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
