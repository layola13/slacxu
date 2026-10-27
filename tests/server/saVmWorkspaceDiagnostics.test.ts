import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { nativeWorkspaceDiagnostics, runSaVmTool } from "../../apps/server/src/saVmTool.js";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";

describe("workspace_diagnostics tool", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "codex-test-workspace-diag-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("returns capability_denied when getDiagnostics is disabled in policy", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, getDiagnostics: false };

    const res = await nativeWorkspaceDiagnostics(".", {}, policy, tempDir, Date.now());
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("capability_denied");
    expect(res.exitCode).toBe(228);
    expect(res.stderr).toContain("getDiagnostics");
  });

  test("returns exists: false and clean: true (exit 0) when target directory does not exist", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, getDiagnostics: true };

    const res = await nativeWorkspaceDiagnostics("non_existent_folder", {}, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);

    const parsed = JSON.parse(res.stdout);
    expect(parsed.exists).toBe(false);
    expect(parsed.clean).toBe(true);
    expect(parsed.total_files_scanned).toBe(0);
    expect(parsed.total_errors).toBe(0);
  });

  test("returns clean: true (exit 0) for empty directory", async () => {
    const emptyDir = join(tempDir, "empty");
    await mkdir(emptyDir, { recursive: true });

    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, getDiagnostics: true };

    const res = await nativeWorkspaceDiagnostics("empty", {}, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);

    const parsed = JSON.parse(res.stdout);
    expect(parsed.clean).toBe(true);
    expect(parsed.total_errors).toBe(0);
  });

  test("aggregates syntax errors across multiple files in compact mode (detail: false)", async () => {
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });

    // File 1: valid
    await writeFile(join(srcDir, "valid.ts"), "export const a: number = 1;\n", "utf8");

    // File 2: syntax error (missing closing brace/bracket)
    await writeFile(join(srcDir, "broken1.ts"), "export function foo( { console.log('hi');\n", "utf8");

    // File 3: syntax error
    await writeFile(join(srcDir, "broken2.ts"), "const x: = 123;\n", "utf8");

    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, getDiagnostics: true };

    const res = await nativeWorkspaceDiagnostics("src", { detail: false }, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(1); // has errors

    const parsed = JSON.parse(res.stdout);
    expect(parsed.clean).toBe(false);
    expect(parsed.total_errors).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(parsed.diagnostics)).toBe(true);

    // Verify compact single line format: path:Lx:Cy:code
    const firstLine = parsed.diagnostics[0];
    expect(firstLine).toMatch(/^src\/broken\d\.ts:L\d+:C\d+:(?:TS\d+|syntax)/);
  });

  test("returns structured error objects in detailed mode (detail: true)", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, getDiagnostics: true };

    const res = await nativeWorkspaceDiagnostics("src", { detail: true }, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(1);

    const parsed = JSON.parse(res.stdout);
    expect(parsed.clean).toBe(false);
    expect(typeof parsed.diagnostics).toBe("object");
    expect(Array.isArray(parsed.diagnostics)).toBe(false);

    // Verify per-file error grouping
    const keys = Object.keys(parsed.diagnostics);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    const firstErr = parsed.diagnostics[keys[0]][0];
    expect(firstErr.line).toBeGreaterThan(0);
    expect(firstErr.col).toBeGreaterThan(0);
    expect(typeof firstErr.msg).toBe("string");
  });

  test("compact output is less than 50% size of detailed output", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, getDiagnostics: true };

    const resCompact = await nativeWorkspaceDiagnostics("src", { detail: false }, policy, tempDir, Date.now());
    const resDetail = await nativeWorkspaceDiagnostics("src", { detail: true }, policy, tempDir, Date.now());

    expect(resCompact.stdout.length).toBeLessThan(resDetail.stdout.length * 0.5);
  });

  test("enforces max_files circuit breaker", async () => {
    const manyDir = join(tempDir, "many");
    await mkdir(manyDir, { recursive: true });

    for (let i = 0; i < 15; i++) {
      await writeFile(join(manyDir, `file_${i}.ts`), `export const v${i} = ${i};\n`, "utf8");
    }

    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, getDiagnostics: true };

    const res = await nativeWorkspaceDiagnostics("many", { max_files: 5 }, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);

    const parsed = JSON.parse(res.stdout);
    expect(parsed.total_files_scanned).toBeLessThanOrEqual(5);
    expect(parsed.truncated).toBe(true);
    expect(parsed.truncated_reason).toBe("max_files");
  });

  test("enforces max_errors circuit breaker with remaining_errors count", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, getDiagnostics: true };

    const res = await nativeWorkspaceDiagnostics("src", { max_errors: 1 }, policy, tempDir, Date.now());
    expect(res.ok).toBe(true);

    const parsed = JSON.parse(res.stdout);
    expect(parsed.returned_errors).toBe(1);
    expect(parsed.remaining_errors).toBeGreaterThanOrEqual(1);
    expect(parsed.truncated).toBe(true);
    expect(parsed.truncated_reason).toBe("max_errors");
  });

  test("handles timeout_ms gracefully", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, getDiagnostics: true };

    // Simulate elapsed time exceeding timeoutMs
    const res = await nativeWorkspaceDiagnostics("src", { timeout_ms: 100 }, policy, tempDir, Date.now() - 500);
    expect(res.ok).toBe(true);

    const parsed = JSON.parse(res.stdout);
    expect(parsed.truncated).toBe(true);
    expect(parsed.timed_out).toBe(true);
  });

  test("dispatches action workspace_diagnostics through runSaVmTool", async () => {
    const policy = createDefaultSaVmPolicyConfig();
    policy.tools = { ...policy.tools, getDiagnostics: true };

    const res = await runSaVmTool({
      action: "workspace_diagnostics",
      dir: "empty"
    }, policy, tempDir, Date.now());

    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.clean).toBe(true);
  });
});
