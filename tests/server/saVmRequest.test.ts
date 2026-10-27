import { expect, test } from "bun:test";
import { validateSaVmRequestBody } from "../../apps/server/src/saVmRequest";

test("accepts js/py source requests (bun branch)", () => {
  expect(validateSaVmRequestBody({ language: "js", source: "console.log(\"ok\")" })).toEqual({ ok: true, isParallel: false });
  expect(validateSaVmRequestBody({ language: "py", source: "print(\"ok\")" })).toEqual({ ok: true, isParallel: false });
});

test("accepts parallel js task requests without top-level source", () => {
  expect(validateSaVmRequestBody({ parallel: [{ language: "js", source: "console.log(\"a\")" }] })).toEqual({ ok: true, isParallel: true });
});

test("rejects removed sa/sla languages", () => {
  expect(validateSaVmRequestBody({ language: "sa", source: "return 0" })).toMatchObject({ ok: false, code: "CUX-SA-VM-SLA-REQUIRED" });
  expect(validateSaVmRequestBody({ language: "sla", source: "println(\"ok\")" })).toMatchObject({ ok: false, code: "CUX-SA-VM-SLA-REQUIRED" });
});

test("rejects missing or non-string source", () => {
  expect(validateSaVmRequestBody({ language: "js" })).toMatchObject({ ok: false, code: "CUX-SA-VM-SLA-REQUIRED" });
  expect(validateSaVmRequestBody({ language: "js", source: ["not source"] })).toMatchObject({ ok: false, code: "CUX-SA-VM-SLA-REQUIRED" });
});

test("does not treat malformed parallel values as parallel requests", () => {
  // A string that decodes to a task array is accepted; one that does not decode
  // is reported as INVALID-PARALLEL so the caller gets a self-correcting message.
  expect(validateSaVmRequestBody({ language: "js", parallel: "not-an-array" })).toMatchObject({ ok: false, code: "CUX-SA-VM-INVALID-PARALLEL" });
  expect(validateSaVmRequestBody({ language: "js", parallel: "[1,2,3]" })).toMatchObject({ ok: false, code: "CUX-SA-VM-INVALID-PARALLEL" });
});

test("accepts packaged action requests including run_project_check and run_bun", () => {
  expect(validateSaVmRequestBody({ action: "run_project_check", profile: "web-test-file" })).toEqual({ ok: true, isParallel: false });
  expect(validateSaVmRequestBody({ action: "run_bun", subcommand: "test" })).toEqual({ ok: true, isParallel: false });
  expect(validateSaVmRequestBody({ action: "read_file", path: "package.json" })).toEqual({ ok: true, isParallel: false });
});

test("rejects malformed run_project_check and run_bun parameters early", () => {
  expect(validateSaVmRequestBody({ action: "run_project_check", profile: 123 })).toMatchObject({
    ok: false,
    code: "CUX-SA-VM-INVALID-INPUT",
    error: "run_project_check requires a string 'profile'"
  });
  expect(validateSaVmRequestBody({ action: "run_project_check", profile: "web-test-file", test_file: 456 })).toMatchObject({
    ok: false,
    code: "CUX-SA-VM-INVALID-INPUT",
    error: "run_project_check 'test_file' must be a string"
  });
  expect(validateSaVmRequestBody({ action: "run_bun", subcommand: true })).toMatchObject({
    ok: false,
    code: "CUX-SA-VM-INVALID-INPUT",
    error: "run_bun 'subcommand' must be a string"
  });
  expect(validateSaVmRequestBody({ action: "run_bun", subcommand: "test", args: "not-array" })).toMatchObject({
    ok: false,
    code: "CUX-SA-VM-INVALID-INPUT",
    error: "run_bun 'args' must be an array of strings"
  });
  expect(validateSaVmRequestBody({ action: "run_bun", subcommand: "test", args: ["valid", 123] })).toMatchObject({
    ok: false,
    code: "CUX-SA-VM-INVALID-INPUT",
    error: "run_bun 'args' must be an array of strings"
  });
});

