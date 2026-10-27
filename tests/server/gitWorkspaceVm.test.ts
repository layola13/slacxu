import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { handleWorkspaceGitRpc } from "../../apps/server/src/gitWorkspace";
import { normalizeSaVmPolicy } from "../../backends/vmtool-security/src/security/saVmPolicy";

const execFileAsync = promisify(execFile);

test("VM-backed Git discard renames untracked files into the configured backup directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-git-vm-"));
  try {
    await execFileAsync("git", ["init", "-q", root]);
    const target = join(root, "discard-me.txt");
    await writeFile(target, "keep me\n", "utf8");
    const policy = normalizeSaVmPolicy({
      fs: {
        write: [`${root}/.trash/**`],
        transfer: [`${root}/**`],
        delete: "rename",
        backupDir: `${root}/.trash/**`
      }
    }, root);
    await handleWorkspaceGitRpc("ui/git/discard", { cwd: root, paths: ["discard-me.txt"], untracked: true }, null, policy);
    await expect(readFile(target, "utf8")).rejects.toThrow();
    const backupFiles = await readdir(join(root, ".trash"));
    expect(backupFiles.length).toBe(1);
    await expect(readFile(join(root, ".trash", backupFiles[0]!), "utf8")).resolves.toBe("keep me\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
