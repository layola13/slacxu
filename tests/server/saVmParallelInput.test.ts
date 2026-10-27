import { expect, test } from "bun:test";
import { normalizeSaVmParallelTasks, validateSaVmRequestBody } from "../../apps/server/src/saVmRequest";
import { expandSaVmActionInput, runSaVmTool, SaVmInputError } from "../../apps/server/src/saVmTool";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regression: models that serialize `parallel` as a JSON string used to skip
// runParallelSaVmTool entirely and die in the script engine with the unrelated
// "source must be a string", leaving no way for the caller to self-correct.
test("normalizes a JSON-encoded parallel array into task objects", () => {
  const result = normalizeSaVmParallelTasks('[{"action":"list_dir","dir":"."},{"action":"grep_search","query":"x"}]');
  expect(result).toEqual({
    ok: true,
    tasks: [{ action: "list_dir", dir: "." }, { action: "grep_search", query: "x" }]
  });
});

test("normalizes a JSON-encoded single task object into a one-task batch", () => {
  const result = normalizeSaVmParallelTasks('{"action":"list_dir","dir":"."}');
  expect(result).toEqual({ ok: true, tasks: [{ action: "list_dir", dir: "." }] });
});

test("passes a real parallel array through unchanged", () => {
  const tasks = [{ action: "list_dir", dir: "." }];
  expect(normalizeSaVmParallelTasks(tasks)).toEqual({ ok: true, tasks });
});

test("treats an absent parallel value as absent", () => {
  expect(normalizeSaVmParallelTasks(undefined)).toEqual({ ok: true, tasks: undefined });
  expect(normalizeSaVmParallelTasks(null)).toEqual({ ok: true, tasks: undefined });
});

test("rejects unparsable and non-object parallel payloads with a self-correcting message", () => {
  expect(normalizeSaVmParallelTasks("not-an-array")).toMatchObject({ ok: false });
  expect(normalizeSaVmParallelTasks("   ")).toMatchObject({ ok: false });
  expect(normalizeSaVmParallelTasks("[1,2,3]")).toMatchObject({ ok: false, error: expect.stringContaining("parallel[0]") });
  expect(normalizeSaVmParallelTasks(42)).toMatchObject({ ok: false, error: expect.stringContaining("number") });
});

test("validateSaVmRequestBody accepts a JSON-encoded parallel batch", () => {
  expect(validateSaVmRequestBody({ parallel: '[{"action":"list_dir","dir":"."}]' })).toEqual({ ok: true, isParallel: true });
  expect(validateSaVmRequestBody({ action: "parallel", parallel: '[{"action":"list_dir","dir":"."}]' })).toEqual({ ok: true, isParallel: true });
});

test("validateSaVmRequestBody reports unparsable parallel as INVALID-PARALLEL, not SLA-REQUIRED", () => {
  const result = validateSaVmRequestBody({ action: "parallel", parallel: "not-an-array" });
  expect(result).toMatchObject({ ok: false, code: "CUX-SA-VM-INVALID-PARALLEL" });
  expect(result).toMatchObject({ error: expect.stringContaining("JSON array of task objects") });
});

test("validateSaVmRequestBody still rejects a malformed parallel batch without an action", () => {
  expect(validateSaVmRequestBody({ language: "js", parallel: "not-an-array" })).toMatchObject({ ok: false });
});

test("expandSaVmActionInput coerces a string parallel batch to an array", () => {
  const expanded = expandSaVmActionInput({
    action: "parallel",
    parallel: '[{"action":"list_dir","dir":"."}]'
  } as never);
  expect(Array.isArray(expanded.parallel)).toBe(true);
  expect(expanded.parallel).toEqual([{ action: "list_dir", dir: "." }]);
});

test("expandSaVmActionInput throws a SaVmInputError for an undecodable parallel batch", () => {
  expect(() => expandSaVmActionInput({ action: "parallel", parallel: "not-an-array" } as never)).toThrow(SaVmInputError);
});

test("runSaVmTool executes a JSON-encoded parallel batch instead of failing with 'source must be a string'", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "sa-vm-parallel-string-"));
  const prev = process.env.SA_VM_ENABLE_PARALLEL;
  process.env.SA_VM_ENABLE_PARALLEL = "true";
  try {
    await writeFile(join(cwd, "alpha.txt"), "alpha\n", "utf8");
    await writeFile(join(cwd, "beta.txt"), "beta\n", "utf8");

    const viaString = await runSaVmTool({
      cwd,
      action: "parallel",
      parallel: JSON.stringify([
        { action: "count_lines", path: "alpha.txt" },
        { action: "count_lines", path: "beta.txt" }
      ])
    } as never);

    expect(viaString.ok).toBe(true);
    expect(viaString.kind).toBe("success");
    expect(viaString.stderr).toBe("");
    expect(viaString.stdout).toContain("[parallel:0]");
    expect(viaString.stdout).toContain("[parallel:1]");

    const viaArray = await runSaVmTool({
      cwd,
      parallel: [
        { action: "count_lines", path: "alpha.txt" },
        { action: "count_lines", path: "beta.txt" }
      ]
    } as never);

    expect(viaArray.ok).toBe(true);
    expect(viaArray.stdout).toBe(viaString.stdout);

    // Temporary shield: default (no env) blocks parallel with native guidance.
    delete process.env.SA_VM_ENABLE_PARALLEL;
    const blocked = await runSaVmTool({
      cwd,
      parallel: [
        { action: "count_lines", path: "alpha.txt" },
        { action: "count_lines", path: "beta.txt" }
      ]
    } as never);
    expect(blocked.ok).toBe(false);
    expect(blocked.kind).toBe("capability_denied");
    expect(blocked.stderr).toContain("temporarily disabled");
  } finally {
    if (prev === undefined) delete process.env.SA_VM_ENABLE_PARALLEL;
    else process.env.SA_VM_ENABLE_PARALLEL = prev;
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runSaVmTool surfaces an actionable parallel error for an undecodable batch", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "sa-vm-parallel-bad-"));
  try {
    const result = await runSaVmTool({ cwd, action: "parallel", parallel: "not-an-array" } as never);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("sa_error");
    expect(result.stderr).toContain("JSON array of task objects");
    expect(result.stderr).not.toContain("source must be a string");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
