import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { nativeSafeDelete, runSaVmTool } from "../../apps/server/src/saVmTool.js";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";

describe("safe_delete tool", () => {
  let tempDir: string;
  let backupDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "codex-test-safe-delete-"));
    backupDir = join(tempDir, ".codex-backup");
    await mkdir(backupDir, { recursive: true });

    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });

    // File 1: Referenced file
    const referencedContent = `export class UserService {
  getUser() { return { id: 1 }; }
}
`;
    await writeFile(join(srcDir, "userService.ts"), referencedContent, "utf8");

    // File 2: Consumer that imports UserService
    const consumerContent = `import { UserService } from './userService';

const service = new UserService();
console.log(service.getUser());
`;
    await writeFile(join(srcDir, "consumer.ts"), consumerContent, "utf8");

    // File 3: Unreferenced file
    const unreferencedContent = `export class OldDeadCode {
  obsolete() { return false; }
}
`;
    await writeFile(join(srcDir, "oldDeadCode.ts"), unreferencedContent, "utf8");
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  function getBasePolicy() {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = {
      ...policy.tools,
      findReferences: true,
      editFiles: true,
      replaceWrite: true
    };
    policy.fs = {
      ...policy.fs,
      writeRoots: [tempDir],
      backupDir
    };
    return policy;
  }

  test("rejects when path parameter is missing", async () => {
    const policy = getBasePolicy();
    const res = await nativeSafeDelete("", {}, policy, tempDir, Date.now());
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("path parameter is required");
  });

  test("rejects when target file does not exist", async () => {
    const policy = getBasePolicy();
    const res = await nativeSafeDelete("src/does_not_exist.ts", {}, policy, tempDir, Date.now());
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("file not found");
  });

  test("returns capability_denied when delete policy is deny", async () => {
    const policy = getBasePolicy();
    policy.fs.delete = "deny";

    const res = await nativeSafeDelete("src/oldDeadCode.ts", {}, policy, tempDir, Date.now());
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("delete policy is deny");
  });

  test("blocks deletion of referenced file by default and returns reference list (zero deletion)", async () => {
    const policy = getBasePolicy();
    const target = "src/userService.ts";
    const fullTarget = join(tempDir, target);

    const res = await nativeSafeDelete(target, { force: false }, policy, tempDir, Date.now());
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(1);
    expect(res.kind).toBe("capability_denied");

    const parsed = JSON.parse(res.stdout);
    expect(parsed.blocked).toBe(true);
    expect(parsed.references_count).toBeGreaterThan(0);
    expect(Array.isArray(parsed.references)).toBe(true);
    expect(parsed.references.some((r: any) => r.file.includes("consumer.ts"))).toBe(true);
    expect(parsed.suggestion).toContain("force: true");

    // Zero deletion verification: file MUST still exist on disk!
    expect(existsSync(fullTarget)).toBe(true);
  });

  test("successfully deletes unreferenced file on first try", async () => {
    const policy = getBasePolicy();
    const target = "src/oldDeadCode.ts";
    const fullTarget = join(tempDir, target);

    expect(existsSync(fullTarget)).toBe(true);

    const res = await nativeSafeDelete(target, {}, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);

    // File should be deleted
    expect(existsSync(fullTarget)).toBe(false);
  });

  test("force: true deletes referenced file and creates restorable backup", async () => {
    const policy = getBasePolicy();
    const target = "src/userService.ts";
    const fullTarget = join(tempDir, target);

    expect(existsSync(fullTarget)).toBe(true);
    const originalContent = await readFile(fullTarget, "utf8");

    const res = await nativeSafeDelete(target, { force: true }, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);

    // File is deleted
    expect(existsSync(fullTarget)).toBe(false);

    // Backup is created and restorable
    const backupFiles = await readdir(backupDir, { recursive: true });
    const userBackup = backupFiles.find((f) => f.includes("userService.ts") && f.endsWith(".bak"));
    expect(userBackup).toBeDefined();

    const backupContent = await readFile(join(backupDir, userBackup!), "utf8");
    expect(backupContent).toBe(originalContent);
  });

  test("runSaVmTool routes safe_delete correctly", async () => {
    const policy = getBasePolicy();

    // Create a temporary file to delete via runSaVmTool
    const tempFile = join(tempDir, "src", "tempForTool.ts");
    await writeFile(tempFile, "export const tempVar = 123;\n", "utf8");

    const res = await runSaVmTool({
      action: "safe_delete",
      path: "src/tempForTool.ts",
      policy,
      cwd: tempDir
    });

    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(existsSync(tempFile)).toBe(false);
  });
});
