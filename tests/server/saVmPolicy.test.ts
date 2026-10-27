import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { ALL_SA_VM_BUN_PROFILES, ALL_SA_VM_BUN_SUBCOMMANDS, createDefaultSaVmPolicyConfig } from "@codex-ui/shared";
import {
  checkSaVmDelete,
  checkSaVmEnv,
  checkSaVmHttp,
  checkSaVmPath,
  checkSaVmProcess,
  checkSaVmBunProfile,
  classifySaVmExecutionRequest,
  classifyBunRequest,
  extractCommandArgv,
  isSaVmScriptExecutionAllowed,
  normalizeSaVmPolicy
} from "../../backends/vmtool-security/src/security/saVmPolicy";
import { isSystemWebSearchPermissionRequest } from "../../apps/server/src/systemWebSearch";

const project = resolve(process.cwd(), "vm-policy-fixture");

test("normalizes the persisted default policy as workspace-only and delete-safe", () => {
  const policy = normalizeSaVmPolicy(createDefaultSaVmPolicyConfig(), project);
  expect(policy.engine).toBe("native");
  expect(policy.fs.read).toContain(`${project.replace(/\\/g, "/").toLowerCase()}/**`);
  expect(policy.fs.write).toEqual([`${project.replace(/\\/g, "/").toLowerCase()}/**`]);
  expect(policy.fs.transfer).toEqual([`${project.replace(/\\/g, "/").toLowerCase()}/**`]);
  expect(policy.fs.delete).toBe("rename");
  expect(policy.fs.backupDir).toBe(`${project.replace(/\\/g, "/").toLowerCase()}/.codex-ultra/vm-trash/**`);
  expect(policy.http.allow).toEqual([]);
  expect(policy.env.allow).toEqual(["CWD", "PROJECT"]);
  expect(policy.process).toEqual({
    spawn: false,
    exec: [
      { path: "git", args: ["status", "*"] },
      { path: "git", args: ["pull"] },
      { path: "git", args: ["push"] }
    ],
    bun: {
      enabled: true,
      allowedSubcommands: [...ALL_SA_VM_BUN_SUBCOMMANDS]
    },
    bunProfiles: [...ALL_SA_VM_BUN_PROFILES]
  });
});

test("grants a configured Sala help root read-only access", () => {
  const salaRoot = resolve(project, "..", "installed-sala");
  const policy = normalizeSaVmPolicy({
    fs: {
      entries: [{ path: "$PROJECT/**", access: "write" }],
      salaRoot
    }
  }, project);
  expect(checkSaVmPath(policy, "read", join(salaRoot, "dist", "index.html"), project).allowed).toBe(true);
  expect(checkSaVmPath(policy, "write", join(salaRoot, "dist", "index.html"), project).allowed).toBe(false);
  expect(checkSaVmPath(policy, "read", resolve(project, "..", "other", "index.html"), project).allowed).toBe(false);
});

test("an explicit deny overrides the default Sala help read grant", () => {
  const salaRoot = resolve(project, "..", "installed-sala-denied");
  const policy = normalizeSaVmPolicy({
    fs: {
      entries: [
        { path: "$PROJECT/**", access: "write" },
        { path: `${salaRoot}/**`, access: "deny" }
      ],
      salaRoot
    }
  }, project);
  expect(checkSaVmPath(policy, "read", join(salaRoot, "dist", "index.html"), project).allowed).toBe(false);
});

test("defaults filesystem reads and writes to the thread workspace", () => {
  const policy = normalizeSaVmPolicy(undefined, project);
  expect(checkSaVmPath(policy, "read", join(project, "src", "index.ts"), project).allowed).toBe(true);
  expect(checkSaVmPath(policy, "write", join(project, "out.txt"), project).allowed).toBe(true);
  expect(checkSaVmPath(policy, "read", project, project).allowed).toBe(true);
  expect(checkSaVmPath(policy, "read", resolve(project, "..", "outside.txt"), project).allowed).toBe(false);
});

test("fails closed when a VM read targets a folder outside the workspace", () => {
  const policy = normalizeSaVmPolicy(createDefaultSaVmPolicyConfig(), project);
  const outsideWorkspace = resolve(project, "..", "private-folder", "secrets.json");
  const result = checkSaVmPath(policy, "read", outsideWorkspace, project);
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("path is not allowed for read");
});

test("honors explicit read/write roots and rejects undeclared paths", () => {
  const output = join(project, "output");
  const policy = normalizeSaVmPolicy({ fs: { read: ["$PROJECT/input/**"], write: ["$PROJECT/output/**"] } }, project);
  expect(checkSaVmPath(policy, "read", join(project, "input", "data.json"), project).allowed).toBe(true);
  expect(checkSaVmPath(policy, "write", join(output, "result.json"), project).allowed).toBe(true);
  expect(checkSaVmPath(policy, "write", join(project, "input", "data.json"), project).allowed).toBe(false);
});

test("requires a writable backup directory for rename and move deletion", () => {
  const policy = normalizeSaVmPolicy({ fs: { write: ["$PROJECT/output/**"], transfer: ["$PROJECT/tmp/**"], delete: "rename", backupDir: "$PROJECT/.trash/**" } }, project);
  expect(checkSaVmDelete(policy, join(project, "tmp", "old.txt"), project).allowed).toBe(false);

  const valid = normalizeSaVmPolicy({ fs: { write: ["$PROJECT/**", "$PROJECT/.trash/**"], transfer: ["$PROJECT/tmp/**"], delete: "rename", backupDir: "$PROJECT/.trash/**" } }, project);
  expect(checkSaVmDelete(valid, join(project, "tmp", "old.txt"), project).allowed).toBe(true);
  expect(checkSaVmDelete({ ...valid, fs: { ...valid.fs, delete: "deny" } }, join(project, "tmp", "old.txt"), project).allowed).toBe(false);
});

test("allows only policy-listed HTTPS GET and POST endpoints", () => {
  const policy = normalizeSaVmPolicy({ http: { allow: [{ host: "api.example.com", methods: ["GET", "POST"], paths: ["/v1/**"] }] } }, project);
  expect(checkSaVmHttp(policy, "https://api.example.com/v1/items", "GET").allowed).toBe(true);
  expect(checkSaVmHttp(policy, "https://api.example.com/v1/items", "POST").allowed).toBe(true);
  expect(checkSaVmHttp(policy, "https://api.example.com/v1/items", "PUT").allowed).toBe(false);
  expect(checkSaVmHttp(policy, "https://api.example.com/private", "GET").allowed).toBe(false);
  expect(checkSaVmHttp(policy, "http://api.example.com/v1/items", "GET").allowed).toBe(false);
});

test("fails closed for an HTTPS URL outside the trusted allowlist", () => {
  const policy = normalizeSaVmPolicy({ http: { allow: [{ host: "api.example.com", methods: ["GET"], paths: ["/v1/**"] }] } }, project);
  expect(checkSaVmHttp(policy, "https://untrusted.example.net/v1/data", "GET")).toMatchObject({
    allowed: false,
    reason: "host, path, or method is not in the HTTP allowlist"
  });
});

test("keeps the bounded system Web Search capability outside the VM HTTP allowlist", () => {
  expect(isSystemWebSearchPermissionRequest("Use Web Search to find the official documentation")).toBe(true);
  expect(isSystemWebSearchPermissionRequest("browser search: current weather")).toBe(true);
  expect(isSystemWebSearchPermissionRequest("fetch https://untrusted.example.net/api")).toBe(false);
});

test("allows only the default safe Git command set", () => {
  const policy = normalizeSaVmPolicy(createDefaultSaVmPolicyConfig(), project);
  expect(checkSaVmProcess(policy, "git.exe", ["status", "--short"]).allowed).toBe(true);
  expect(checkSaVmProcess(policy, "git", ["pull"]).allowed).toBe(true);
  expect(checkSaVmProcess(policy, "git", ["push"]).allowed).toBe(true);
  expect(checkSaVmProcess(policy, "git", ["push", "--force"]).allowed).toBe(false);
  expect(checkSaVmProcess(policy, "git", ["clean", "-fd"]).allowed).toBe(false);
  expect(checkSaVmProcess(policy, "git", ["revert", "HEAD"]).allowed).toBe(false);
  expect(checkSaVmProcess(policy, "git", ["merge", "feature"]).allowed).toBe(false);

  const explicitlyEnabledClean = normalizeSaVmPolicy({ process: { exec: [{ path: "git", args: ["clean", "*"] }] } }, project);
  expect(checkSaVmProcess(explicitlyEnabledClean, "git", ["clean", "-fd"]).allowed).toBe(true);
});

test("enforces environment and process allowlists", () => {
  const policy = normalizeSaVmPolicy({
    env: { allow: ["CWD", "PROJECT"] },
    process: { spawn: true, exec: [{ path: "git.exe", args: ["*"] }] }
  }, project);
  expect(checkSaVmEnv(policy, "CWD").allowed).toBe(true);
  expect(checkSaVmEnv(policy, "PATH").allowed).toBe(false);
  expect(checkSaVmProcess(policy, "C:\\Program Files\\Git\\bin\\git.exe", ["push"]).allowed).toBe(true);
  expect(checkSaVmProcess(policy, "powershell.exe", ["-Command", "dir"]).allowed).toBe(false);
});

test("supports explicitly configured environment variables", () => {
  const policy = normalizeSaVmPolicy({ env: { allow: ["CWD", "SAFE_TOKEN"] } }, project);
  expect(checkSaVmEnv(policy, "SAFE_TOKEN").allowed).toBe(true);
  expect(checkSaVmEnv(policy, "PATH").allowed).toBe(false);
});

test("parses command argv without executing it", () => {
  expect(extractCommandArgv(["git", "push"])).toEqual({ executable: "git", args: ["push"] });
  expect(extractCommandArgv("git \"status --short\"")).toEqual({ executable: "git", args: ["status --short"] });
  expect(extractCommandArgv("   ")).toBeNull();
});

test("supports Codex-style fs entries with deny precedence", () => {
  const policy = normalizeSaVmPolicy({
    fs: {
      entries: [
        { path: "$PROJECT/**", access: "write" },
        { path: "$PROJECT/secrets/**", access: "deny" },
        { path: "$PROJECT/secrets/public.txt", access: "read" }
      ]
    }
  }, project);
  expect(checkSaVmPath(policy, "write", join(project, "out.txt"), project).allowed).toBe(true);
  expect(checkSaVmPath(policy, "read", join(project, "secrets", "private.txt"), project).allowed).toBe(false);
  expect(checkSaVmPath(policy, "read", join(project, "secrets", "public.txt"), project).allowed).toBe(false);
});

test("additional roots are read-only unless explicitly writable", () => {
  const additional = join(project, "shared");
  const policy = normalizeSaVmPolicy(undefined, project, [additional]);
  expect(checkSaVmPath(policy, "read", join(additional, "input.json"), project).allowed).toBe(true);
  expect(checkSaVmPath(policy, "write", join(additional, "output.json"), project).allowed).toBe(false);
  const writable = normalizeSaVmPolicy({ fs: { entries: [{ path: "$PROJECT/**", access: "write" }, { path: additional, access: "write" }] } }, project, [additional]);
  expect(checkSaVmPath(writable, "write", join(additional, "output.json"), project).allowed).toBe(true);
});

test("JavaScript and Python execution are opt-in", () => {
  const disabled = normalizeSaVmPolicy(undefined, project);
  expect(isSaVmScriptExecutionAllowed(disabled, "python.exe")).toBe(false);
  expect(isSaVmScriptExecutionAllowed(disabled, "node.exe")).toBe(false);
  const enabled = normalizeSaVmPolicy({ execution: { javascript: true, python: true } }, project);
  expect(isSaVmScriptExecutionAllowed(enabled, "python.exe")).toBe(true);
  expect(isSaVmScriptExecutionAllowed(enabled, "node.exe")).toBe(true);
});

test("rejects null bytes and reserved Windows device names", () => {
  const policy = normalizeSaVmPolicy(undefined, project);
  expect(checkSaVmPath(policy, "read", "file.txt\0.js", project)).toMatchObject({ allowed: false, reason: "invalid path characters" });
  expect(checkSaVmPath(policy, "read", join(project, "nul"), project)).toMatchObject({ allowed: false });
  expect(checkSaVmPath(policy, "write", join(project, "con.txt"), project)).toMatchObject({ allowed: false });
  expect(checkSaVmDelete(policy, "file.txt\0", project)).toMatchObject({ allowed: false, reason: "invalid path characters" });
  expect(checkSaVmDelete(policy, join(project, "aux"), project)).toMatchObject({ allowed: false });
});

test("normalizes and enforces fixed Bun project check profiles", () => {
  const policy = normalizeSaVmPolicy({
    process: {
      bunProfiles: [
        "shared-typecheck",
        "web-build",
        "server-test-file",
        "invalid-arbitrary-profile"
      ] as never
    }
  }, project);

  expect(policy.process.bunProfiles).toEqual(["shared-typecheck", "web-build", "server-test-file"]);
  expect(checkSaVmBunProfile(policy, "shared-typecheck").allowed).toBe(true);
  expect(checkSaVmBunProfile(policy, "web-build").allowed).toBe(true);
  expect(checkSaVmBunProfile(policy, "server-test-file").allowed).toBe(true);
  expect(checkSaVmBunProfile(policy, "server-typecheck").allowed).toBe(false);
  expect(checkSaVmBunProfile(policy, "invalid-arbitrary-profile").allowed).toBe(false);
});

test("bun execution is governed independently by process.bun or bunProfiles", () => {
  const jsOnly = normalizeSaVmPolicy({ execution: { javascript: true } }, project);
  expect(isSaVmScriptExecutionAllowed(jsOnly, "node.exe")).toBe(true);
  expect(isSaVmScriptExecutionAllowed(jsOnly, "bun.exe")).toBe(false);

  const bunOnly = normalizeSaVmPolicy({ process: { bun: true } }, project);
  expect(isSaVmScriptExecutionAllowed(bunOnly, "bun.exe")).toBe(true);
  expect(isSaVmScriptExecutionAllowed(bunOnly, "bunx.exe")).toBe(true);
  expect(isSaVmScriptExecutionAllowed(bunOnly, "node.exe")).toBe(false);

  const bunProfilesOnly = normalizeSaVmPolicy({ process: { bunProfiles: ["server-test-file"] } }, project);
  expect(isSaVmScriptExecutionAllowed(bunProfilesOnly, "bun.exe")).toBe(false);
  expect(isSaVmScriptExecutionAllowed(bunProfilesOnly, "node.exe")).toBe(false);
});

test("classifySaVmExecutionRequest and classifyBunRequest classify requests accurately", () => {
  expect(classifySaVmExecutionRequest({ action: "run_bun", subcommand: "test" })).toEqual({
    kind: "bun",
    isBun: true,
    isJs: false,
    isPy: false
  });
  expect(classifyBunRequest({ action: "run_bun" })).toBe(true);

  expect(classifySaVmExecutionRequest({ action: "run_project_check", profile: "web-test-file" })).toEqual({
    kind: "bun",
    isBun: true,
    isJs: false,
    isPy: false
  });
  expect(classifyBunRequest({ action: "run_project_check" })).toBe(true);

  expect(classifySaVmExecutionRequest({ action: "run_js", content: "console.log(1)" })).toEqual({
    kind: "javascript",
    isBun: false,
    isJs: true,
    isPy: false
  });
  expect(classifyBunRequest({ action: "run_js" })).toBe(false);

  expect(classifySaVmExecutionRequest({ action: "run_py", content: "print(1)" })).toEqual({
    kind: "python",
    isBun: false,
    isJs: false,
    isPy: true
  });
  expect(classifyBunRequest({ action: "run_py" })).toBe(false);

  expect(classifySaVmExecutionRequest({ action: "read_file", path: "test.txt" })).toEqual({
    kind: "other",
    isBun: false,
    isJs: false,
    isPy: false
  });
  expect(classifyBunRequest({ action: "read_file" })).toBe(false);
});

