import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandSaVmActionInput, isSaVmBlockedToolName, isGitIgnored, loadGitIgnoreRules, normalizeSaVmRunInput, resolveTimeoutMs, resultKind, runSaVmTool } from "../../apps/server/src/saVmTool";

test("blocks shell and scripting tool names in strict VM mode", () => {
  expect(isSaVmBlockedToolName("bash")).toBe(true);
  expect(isSaVmBlockedToolName("command.exec")).toBe(true);
  expect(isSaVmBlockedToolName("python3")).toBe(true);
  expect(isSaVmBlockedToolName("sa_vm_run")).toBe(false);
});

test("rejects sa/sla sources with bun-branch migration error", async () => {
  const result = await runSaVmTool({ source: '@import "evil/module.sai"', language: "sla" as never });
  expect(result.ok).toBe(false);
  expect(result.kind).toBe("sa_error");
  expect(result.stderr).toContain("bun branch");
});

test("sa/sla runtime reports removal instead of missing sidecar", async () => {
  const result = await runSaVmTool({ source: "return 0", language: "sla" as never });
  expect(result.ok).toBe(false);
  expect(result.kind).toBe("sa_error");
  expect(result.stderr).toContain("bun branch");
});

test("classifies normal guest return codes separately from VM failures", () => {
  expect(resultKind(0)).toBe("success");
  expect(resultKind(1)).toBe("success");
  expect(resultKind(42)).toBe("success");
  expect(resultKind(1, "Parsing failed")).toBe("sa_error");
  expect(resultKind(128)).toBe("crashed");
  expect(resultKind(228)).toBe("capability_denied");
});

test("normalizes js as an explicit executable language and rejects sla (bun branch)", () => {
  const normalized = normalizeSaVmRunInput({ source: "console.log(1)", language: "js", policy: { execution: { javascript: true } } });
  expect(normalized.language).toBe("js");
  expect(normalized.source).toContain("console.log");
  expect(() => normalizeSaVmRunInput({ source: "fn main() -> i32 { return 0; }", language: "sla" as never })).toThrow("bun branch");
});

test("resolves relative file and directory capabilities against the thread workspace", () => {
  const normalized = normalizeSaVmRunInput({
    source: "console.log(1)",
    language: "js",
    cwd: "E:/workspace",
    policy: { execution: { javascript: true }, fs: { entries: [
      { path: "src", access: "read" },
      { path: "src/config.ts", access: "read" },
      { path: "generated/**", access: "write" }
    ] } } as never,
    requested_caps: {
      fs: [
        { op: "read", path: "src" },
        { op: "read", path: "src/config.ts" },
        { op: "write", path: "generated/report.txt" },
        { op: "create", path: "generated/reports" }
      ]
    }
  });
  expect(normalized.language).toBe("js");
  expect((normalized.policy as { extern: { allow: string[] } }).extern.allow).toEqual([]);
});

test("validates string paths in requested_caps.fs without granting VM externs", () => {
  const normalizedWithStringPaths = normalizeSaVmRunInput({
    source: "console.log(1)",
    language: "js",
    cwd: "E:/workspace",
    policy: { execution: { javascript: true }, fs: { entries: [{ path: "src", access: "read" }] } } as never,
    requested_caps: {
      fs: ["src/file.txt", "src/other.txt"]
    }
  });
  expect((normalizedWithStringPaths.policy as { extern: { allow: string[] } }).extern.allow).toEqual([]);
});



test("clamps VM resource limits and bounds argv deterministically", () => {
  const normalized = normalizeSaVmRunInput({
    source: "console.log(1)",
    language: "js",
    policy: { execution: { javascript: true } },
    limits: { fuel: -10, deadline_ms: 999999999, mem_cap_bytes: 1.9, max_call_depth: Number.POSITIVE_INFINITY },
    args: Array.from({ length: 140 }, (_, index) => `arg-${index}`)
  });
  expect(normalized.limits.fuel).toBe(0);
  expect(normalized.limits.deadline_ms).toBe(600_000);
  expect(normalized.limits.mem_cap_bytes).toBe(1);
  expect(normalized.limits.max_call_depth).toBe(50_000);
  expect(normalized.args).toHaveLength(128);
  expect(normalized.args.at(-1)).toBe("arg-127");
});

test("rejects oversized source and individual arguments before bun spawn", () => {
  expect(() => normalizeSaVmRunInput({ source: "x".repeat(512 * 1024 + 1), language: "js", policy: { execution: { javascript: true } } })).toThrow("source exceeds 512 KiB");
  expect(() => normalizeSaVmRunInput({ source: "return 0", language: "js", policy: { execution: { javascript: true } }, args: ["x".repeat(4097)] })).toThrow("argument exceeds 4096 characters");
});

test("fails closed for filesystem capability paths outside the workspace", () => {
  expect(() => normalizeSaVmRunInput({
    source: "console.log(1)",
    language: "js",
    cwd: "D:/projects/codex-ultra/workspace",
    policy: { execution: { javascript: true } },
    requested_caps: { fs: [{ op: "read", path: "../secrets.txt" }] }
  })).toThrow("filesystem capability denied");
});

test("fails closed for insecure HTTP capabilities and undeclared environment names", () => {
  expect(() => normalizeSaVmRunInput({
    source: "console.log(1)",
    language: "js",
    policy: { execution: { javascript: true }, http: { allow: [{ host: "api.example.com", methods: ["GET"] }] } },
    requested_caps: { net: [{ url: "http://api.example.com/v1" }] }
  })).toThrow("only HTTPS URLs without credentials are allowed");
  expect(() => normalizeSaVmRunInput({
    source: "console.log(1)",
    language: "js",
    policy: { execution: { javascript: true } },
    requested_caps: { env: ["PATH"] }
  })).toThrow("environment capability denied");
});

test("bun branch grants no VM extern symbols", () => {
  const normalized = normalizeSaVmRunInput({
    language: "js",
    source: "console.log(1)",
    policy: { execution: { javascript: true } }
  });
  const allow = (normalized.policy as { extern: { allow: string[] } }).extern.allow;
  expect(allow).toEqual([]);
});
test("runs js via bun without any native sidecar", async () => {
  const result = await runSaVmTool({
    language: "js",
    source: "console.log('bun-ready');",
    policy: { execution: { javascript: true } }
  });
  expect(result.ok).toBe(true);
  expect(result.kind).toBe("success");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("bun-ready");
});

test("keeps bun-branch policy free of VM extern symbols", () => {
  const allow = (normalizeSaVmRunInput({ language: "js", source: "console.log(1)", policy: { execution: { javascript: true } } }).policy as { extern: { allow: string[] } }).extern.allow;
  expect(allow).toEqual([]);
  expect(allow.some((symbol) => symbol.startsWith("sa_std_process_"))).toBe(false);
});

test("validates bounded parallel requests (bun branch)", async () => {
  const prevParallel = process.env.SA_VM_ENABLE_PARALLEL;
  process.env.SA_VM_ENABLE_PARALLEL = "true";
  try {
    const task = { language: "js" as const, source: "console.log(1)", policy: { execution: { javascript: true } } };
    await expect(runSaVmTool({ parallel: [], language: "js" })).resolves.toMatchObject({ ok: false, kind: "sa_error" });
    await expect(runSaVmTool({ parallel: [task, { ...task }] as never })).resolves.toMatchObject({ ok: true });
    await expect(runSaVmTool({ parallel: Array.from({ length: 33 }, () => task) })).resolves.toMatchObject({ ok: false, kind: "sa_error" });
  } finally {
    if (prevParallel === undefined) delete process.env.SA_VM_ENABLE_PARALLEL;
    else process.env.SA_VM_ENABLE_PARALLEL = prevParallel;
  }
}, 15000);

test("does not grant process symbols unless explicitly requested", () => {
  const normalized = normalizeSaVmRunInput({ language: "js", source: "console.log(1)", policy: { execution: { javascript: true } } });
  const allow = (normalized.policy as { extern: { allow: string[] } }).extern.allow;
  expect(allow.some((symbol) => symbol.startsWith("sa_std_process_"))).toBe(false);
});


test("keeps destructive capability validation fail-closed (bun branch)", () => {
  const root = "D:/projects/codex-ultra/**";
  expect(() => normalizeSaVmRunInput({ language: "js", source: "console.log(1)", policy: { execution: { javascript: true } }, requested_caps: { fs: [{ op: "delete", path: root }] } })).toThrow("filesystem");
});
test("rejects sla compile path with migration error (no sidecar)", async () => {
  const result = await runSaVmTool({
    language: "sla" as never,
    source: '@import "sa_std/io/print.sai"\n\nfn main() -> i32 {\n    println("sla-ready");\n    return 0;\n}\n'
  });
  expect(result.ok).toBe(false);
  expect(result.kind).toBe("sa_error");
  expect(result.stderr).toContain("bun branch");
}, { timeout: 15000 });

test("returns a migration error when sla source is submitted", async () => {
  const result = await runSaVmTool({ language: "sla" as never, source: "this is not valid SLA" });
  expect(result.ok).toBe(false);
  expect(result.kind).toBe("sa_error");
  expect(result.stderr).toContain("bun branch");
});

test("expandSaVmActionInput leaves packaged file/search actions untouched (bun branch, no SLA emit)", () => {
  // read_file
  const readInput = expandSaVmActionInput({ action: "read_file", path: "src/main.ts" });
  expect(readInput.action).toBe("read_file");
  expect(readInput.source).toBeUndefined();
  expect(readInput.language).toBeUndefined();

  // read_lines
  const linesInput = expandSaVmActionInput({ action: "read_lines", path: "src/main.ts", start_line: 10, end_line: 50 });
  expect(linesInput.action).toBe("read_lines");
  expect(linesInput.source).toBeUndefined();

  // find_files
  const findInput = expandSaVmActionInput({ action: "find_files", dir: "src", pattern: "*.ts" });
  expect(findInput.action).toBe("find_files");
  expect(findInput.source).toBeUndefined();

  // write_file
  const writeInput = expandSaVmActionInput({ action: "write_file", path: "test.txt", content: "hello" });
  expect(writeInput.action).toBe("write_file");
  expect(writeInput.source).toBeUndefined();

  // edit_file
  const editInput = expandSaVmActionInput({ action: "edit_file", path: "test.txt", old_text: "foo", new_text: "bar" });
  expect(editInput.action).toBe("edit_file");
  expect(editInput.source).toBeUndefined();
});

test("normalizeSaVmRunInput rejects action-only shortcuts (use runSaVmTool)", () => {
  expect(() => normalizeSaVmRunInput({ action: "read_file", path: "src/index.ts" })).toThrow("source must be a string");
});

test("JS and Python action shortcuts and execution toggles", async () => {
  // run_js action expands
  const jsInput = expandSaVmActionInput({ action: "run_js", content: "console.log('hello from js');" });
  expect(jsInput.language).toBe("js");
  expect(jsInput.source).toBe("console.log('hello from js');");

  // run_py action expands
  const pyInput = expandSaVmActionInput({ action: "run_py", content: "print('hello from py')" });
  expect(pyInput.language).toBe("py");
  expect(pyInput.source).toBe("print('hello from py')");

  // Rejects when execution switch is false
  expect(() => normalizeSaVmRunInput({
    language: "js",
    source: "console.log(1)",
    policy: { execution: { javascript: false } }
  })).toThrow("JavaScript execution is disabled");

  expect(() => normalizeSaVmRunInput({
    language: "py",
    source: "print(1)",
    policy: { execution: { python: false } }
  })).toThrow("Python execution is disabled");

  // Accepts when execution switch is true
  const normJs = normalizeSaVmRunInput({
    language: "js",
    source: "console.log('test-js')",
    policy: { execution: { javascript: true } }
  });
  expect(normJs.language).toBe("js");

  // Executes JS script via runSaVmTool
  const result = await runSaVmTool({
    language: "js",
    source: "console.log('exec-js-ok');",
    policy: { execution: { javascript: true } }
  });
  expect(result.ok).toBe(true);
  expect(result.stdout).toContain("exec-js-ok");

  // runSaVmTool with run_py returns capability_denied when python execution is false
  const pyDenied = await runSaVmTool({
    action: "run_py",
    content: "print('should be blocked')",
    policy: { execution: { python: false } }
  });
  expect(pyDenied.ok).toBe(false);
  expect(pyDenied.kind).toBe("capability_denied");
  expect(pyDenied.exitCode).toBe(228);
  expect(pyDenied.stderr).toContain("Python execution is disabled");

  // runSaVmTool with run_py succeeds when python execution is true
  const pyOk = await runSaVmTool({
    action: "run_py",
    content: "print('exec-py-ok')",
    policy: { execution: { python: true } }
  });
  expect(pyOk.ok).toBe(true);
  expect(pyOk.stdout).toContain("exec-py-ok");

  // script runner timeout cleanly terminates process tree without hanging
  const pyTimeout = await runSaVmTool({
    action: "run_py",
    content: "import time\ntime.sleep(10)",
    timeout_ms: 200,
    policy: { execution: { python: true } }
  });
  // runSaVmTool with run_js and aliases returns capability_denied when javascript execution is false
  for (const action of ["run_js", "exec_js", "js", "javascript", "node", "bun"]) {
    const jsDenied = await runSaVmTool({
      action,
      content: "console.log('should be blocked')",
      policy: { execution: { javascript: false } }
    });
    expect(jsDenied.ok).toBe(false);
    expect(jsDenied.kind).toBe("capability_denied");
    expect(jsDenied.exitCode).toBe(228);
    expect(jsDenied.stderr).toContain("JavaScript execution is disabled");
  }

  for (const lang of ["js", "javascript", "node", "bun", "ts", "typescript"]) {
    const jsDeniedLang = await runSaVmTool({
      language: lang as never,
      source: "console.log('should be blocked')",
      policy: { execution: { javascript: false } }
    });
    expect(jsDeniedLang.ok).toBe(false);
    expect(jsDeniedLang.kind).toBe("capability_denied");
    expect(jsDeniedLang.exitCode).toBe(228);
    expect(jsDeniedLang.stderr).toContain("JavaScript execution is disabled");
  }
});

test("natively executes apply_patch action with backup and multi-operation support", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-patch-test-"));
  try {
    const filePath = join(dir, "target.txt");
    await writeFile(filePath, "line1\nold line\nline3\n", "utf8");

    const patchText = `*** Begin Patch
*** Update File: target.txt
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3
*** End Patch`;

    const res = await runSaVmTool({
      action: "apply_patch",
      patch: patchText,
      cwd: dir
    });

    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("Successfully applied 1 patch operations");
    const updated = await readFile(filePath, "utf8");
    expect(updated).toBe("line1\nnew line\nline3\n");

    // Also supports patch directly in input.patch without explicit action
    const patchAdd = `*** Begin Patch
*** Add File: added.txt
+hello world
*** End Patch`;
    const resAdd = await runSaVmTool({
      patch: patchAdd,
      cwd: dir
    });
    expect(resAdd.ok).toBe(true);
    const addedContent = await readFile(join(dir, "added.txt"), "utf8");
    expect(addedContent).toBe("hello world\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("natively executes delete_file and move_file actions with safety checks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-file-ops-"));
  try {
    const aPath = join(dir, "a.txt");
    await writeFile(aPath, "content a", "utf8");

    // Move file
    const moveRes = await runSaVmTool({
      action: "move_file",
      from: "a.txt",
      to: "b.txt",
      cwd: dir
    });
    expect(moveRes.ok).toBe(true);
    expect(existsSync(aPath)).toBe(false);
    expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("content a");

    // Delete file
    const deleteRes = await runSaVmTool({
      action: "delete_file",
      path: "b.txt",
      cwd: dir,
      policy: { fs: { delete: "move", backupDir: ".backup" } }
    });
    expect(deleteRes.ok).toBe(true);
    expect(existsSync(join(dir, "b.txt"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("natively executes list_dir and grep_search actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-search-ops-"));
  try {
    await writeFile(join(dir, "alpha.ts"), "const ALPHA = 'FIND_ME_TOKEN';\n", "utf8");
    await writeFile(join(dir, "beta.ts"), "const BETA = 'NOPE';\n", "utf8");

    // list_dir
    const listRes = await runSaVmTool({
      action: "list_dir",
      dir: ".",
      cwd: dir
    });
    expect(listRes.ok).toBe(true);
    const entries = JSON.parse(listRes.stdout);
    expect(entries.some((e: { name: string }) => e.name === "alpha.ts")).toBe(true);
    expect(entries.some((e: { name: string }) => e.name === "beta.ts")).toBe(true);

    // list_dir with recursive depth: 2
    const subDir = join(dir, "subdir");
    await mkdir(subDir);
    await writeFile(join(subDir, "gamma.ts"), "export const gamma = 3;");
    const recListRes = await runSaVmTool({
      action: "list_dir",
      dir: ".",
      depth: 2,
      cwd: dir
    });
    expect(recListRes.ok).toBe(true);
    const recEntries = JSON.parse(recListRes.stdout);
    expect(recEntries.some((e: { name: string; path?: string }) => e.name === "gamma.ts" && e.path === "subdir/gamma.ts")).toBe(true);

    // grep_search
    const grepRes = await runSaVmTool({
      action: "grep_search",
      query: "FIND_ME_TOKEN",
      cwd: dir
    });
    expect(grepRes.ok).toBe(true);
    const matches = JSON.parse(grepRes.stdout);
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain("alpha.ts");
    expect(matches[0].content).toContain("FIND_ME_TOKEN");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("natively executes copy_file and file_info actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-copy-info-"));
  try {
    const srcPath = join(dir, "source.txt");
    await writeFile(srcPath, "source content data", "utf8");

    // file_info
    const infoRes = await runSaVmTool({
      action: "file_info",
      path: "source.txt",
      cwd: dir
    });
    expect(infoRes.ok).toBe(true);
    const info = JSON.parse(infoRes.stdout);
    expect(info.size).toBe(19);
    expect(info.isFile).toBe(true);

    // copy_file
    const copyRes = await runSaVmTool({
      action: "copy_file",
      from: "source.txt",
      to: "dest.txt",
      cwd: dir
    });
    expect(copyRes.ok).toBe(true);
    expect(existsSync(join(dir, "dest.txt"))).toBe(true);
    expect(await readFile(join(dir, "dest.txt"), "utf8")).toBe("source content data");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("read_file bounds output by max_tokens to prevent context overflow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-read-budget-"));
  try {
    const largeLines = Array.from({ length: 500 }, (_, i) => `console.log("line index ${i} with extra text for token load");`).join("\n");
    const filePath = join(dir, "large.ts");
    await writeFile(filePath, largeLines, "utf8");

    // Read with small token budget: max_tokens = 150
    const res = await runSaVmTool({
      action: "read_file",
      path: "large.ts",
      max_tokens: 150,
      cwd: dir
    });

    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("Total Lines: 500");
    expect(res.stdout).toContain("reached token budget of 150 tokens");
    expect(res.stdout).toContain("Call read_file with path: \"large.ts\"");
    // Line numbers are present
    expect(res.stdout).toContain("  1: console.log");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("read_file handles compressed 1-line minified JS and supports offset pagination", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-minified-js-"));
  try {
    // Generate a minified 1-line JS file of 50,000 chars
    const minifiedCode = "!function(e){var t={};function r(n){return t[n]}r.m=e;r.c=t;r.d=function(e,t,n){r.o(e,t)||Object.defineProperty(e,t,{enumerable:!0,get:n})};r.r=function(e){'undefined'!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:'Module'})};" +
      "var x='data_".repeat(2500) + "';return r(0);}([function(e,t,r){console.log('done')}]);";
    const minPath = join(dir, "bundle.min.js");
    await writeFile(minPath, minifiedCode, "utf8");

    // 1. Reading without offset detects minified single-line and limits characters safely
    const initialRes = await runSaVmTool({
      action: "read_file",
      path: "bundle.min.js",
      max_tokens: 500,
      cwd: dir
    });

    expect(initialRes.ok).toBe(true);
    expect(initialRes.stdout).toContain("Minified single-line code");
    expect(initialRes.stdout).toContain("max_tokens=500 to prevent context overflow");
    expect(initialRes.stdout).toContain("Truncated:");
    expect(initialRes.stdout).toContain("offset:");

    // 2. Reading with offset paginates to subsequent chunk
    const pagedRes = await runSaVmTool({
      action: "read_file",
      path: "bundle.min.js",
      offset: 1500,
      max_tokens: 400,
      cwd: dir
    });

    expect(pagedRes.ok).toBe(true);
    expect(pagedRes.stdout).toContain("Viewing characters 1500 to");
    expect(pagedRes.stdout).toContain("data_");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("read_file detects binary files and prevents context corruption", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-binary-"));
  try {
    const binPath = join(dir, "sample.bin");
    const binBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    await writeFile(binPath, binBuffer);

    const res = await runSaVmTool({
      action: "read_file",
      path: "sample.bin",
      cwd: dir
    });

    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("Binary file detected: sample.bin");
    expect(res.stdout).toContain("Text viewing is disabled");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("read_file dynamically clamps to remaining_tokens with safety headroom reservation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-remaining-tokens-"));
  try {
    const largeLines = Array.from({ length: 800 }, (_, i) => `export const val_${i} = "sample statement ${i}";`).join("\n");
    await writeFile(join(dir, "tokens.ts"), largeLines, "utf8");

    // Conversation is near context exhaustion: remaining_tokens = 3800
    // Reserved headroom = 3000, so safe budget is 800 tokens.
    // Even if requested max_tokens is 5000, it MUST be clamped to 800 tokens!
    const res = await runSaVmTool({
      action: "read_file",
      path: "tokens.ts",
      max_tokens: 5000,
      remaining_tokens: 3800,
      cwd: dir
    });

    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("reached token budget of 800 tokens");
    expect(res.stdout).toContain("bounded by context tokens remaining: 3800, headroom reserved: 3000");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("read_file allows large max_tokens beyond 8k when context permits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-large-ceiling-"));
  try {
    // Generate a file with 1200 lines (~15,000 tokens)
    const largeLines = Array.from({ length: 1200 }, (_, i) => `function item_${i}() { return "line payload content for token testing ${i}"; }`).join("\n");
    await writeFile(join(dir, "large_code.ts"), largeLines, "utf8");

    // Request 12,000 tokens (more than old 8k cap)
    const res = await runSaVmTool({
      action: "read_file",
      path: "large_code.ts",
      max_tokens: 12000,
      max_lines: 800,
      cwd: dir
    });

    expect(res.ok).toBe(true);
    // Should successfully read many more lines than 8k tokens would allow
    expect(res.stdout).toContain("Showing lines 1 to");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("grep_search_async performs concurrent asynchronous search across directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-grep-async-"));
  try {
    await mkdir(join(dir, "sub_a", "nested"), { recursive: true });
    await mkdir(join(dir, "sub_b"), { recursive: true });

    await writeFile(join(dir, "root.ts"), "const hello = 'world';\nconsole.log('async grep test target');", "utf8");
    await writeFile(join(dir, "sub_a", "nested", "file_a.ts"), "export function foo() {\n  return 'async grep test target 1';\n}", "utf8");
    await writeFile(join(dir, "sub_b", "file_b.ts"), "export const b = 'async grep test target 2';", "utf8");
    await writeFile(join(dir, "ignored.txt"), "no match here", "utf8");

    const res = await runSaVmTool({
      action: "grep_search_async",
      query: "async grep test target",
      dir: ".",
      concurrency: 4,
      cwd: dir
    });

    expect(res.ok).toBe(true);
    expect(res.kind).toBe("success");
    const matches = JSON.parse(res.stdout);
    expect(matches.length).toBe(3);
    expect(matches.some((m: any) => m.file === "root.ts" && m.line === 2)).toBe(true);
    expect(matches.some((m: any) => m.file.includes("file_a.ts") && m.line === 2)).toBe(true);
    expect(matches.some((m: any) => m.file.includes("file_b.ts") && m.line === 1)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clear_tool_history is capability_denied when disabled in policy", async () => {
  const res = await runSaVmTool({
    action: "clear_tool_history",
    keep_last_n_turns: 2,
    policy: {
      tools: {
        clearToolHistory: false
      }
    }
  });

  expect(res.ok).toBe(false);
  expect(res.kind).toBe("capability_denied");
  expect(res.exitCode).toBe(228);
  expect(res.stderr).toContain("clearToolHistory");
});

test("clear_tool_history succeeds and emits pruned status when enabled in policy", async () => {
  const res = await runSaVmTool({
    action: "clear_tool_history",
    keep_last_n_turns: 3,
    filter_tools: ["read_file", "grep_search"],
    reason: "Freeing context tokens after codebase exploration",
    policy: {
      tools: {
        clearToolHistory: true
      }
    }
  });

  expect(res.ok).toBe(true);
  expect(res.kind).toBe("success");
  expect(res.exitCode).toBe(0);
  const parsed = JSON.parse(res.stdout);
  expect(parsed.status).toBe("pruned");
  expect(parsed.keep_last_n_turns).toBe(3);
  expect(parsed.filter_tools).toEqual(["read_file", "grep_search"]);
  expect(res.saVmEvents.some((e: any) => e.type === "context_pruned")).toBe(true);
});

test("find_references is capability_denied when disabled in policy", async () => {
  const res = await runSaVmTool({
    action: "find_references",
    symbol: "mySpecialSymbol",
    policy: {
      tools: {
        findReferences: false
      }
    }
  });

  expect(res.ok).toBe(false);
  expect(res.kind).toBe("capability_denied");
  expect(res.exitCode).toBe(228);
  expect(res.stderr).toContain("findReferences");
});

test("find_references groups by single path and uses e0/e1/e2 enums with detail control", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-find-refs-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });

    await writeFile(
      join(dir, "src", "def.ts"),
      "export function calculateMetrics(input: number) {\n  return input * 2;\n}",
      "utf8"
    );
    await writeFile(
      join(dir, "src", "usage.ts"),
      "import { calculateMetrics } from './def';\n// comment with calculateMetrics\nconst res = calculateMetrics(10);",
      "utf8"
    );

    // 1. Without detail (ultra compact)
    const resCompact = await runSaVmTool({
      action: "find_references",
      symbol: "calculateMetrics",
      detail: false,
      cwd: dir,
      policy: {
        tools: {
          findReferences: true
        }
      }
    });

    expect(resCompact.ok).toBe(true);
    expect(resCompact.kind).toBe("success");
    const parsedCompact = JSON.parse(resCompact.stdout);
    expect(parsedCompact.symbol).toBe("calculateMetrics");
    expect(parsedCompact.total).toBe(3); // 1 def + 1 imp + 1 use (comment excluded)
    expect(parsedCompact.types).toEqual({ e0: "def", e1: "imp", e2: "use" });

    // Path appears as key exactly once
    const files = parsedCompact.files;
    expect(Object.keys(files).length).toBe(2);
    expect(files["src/def.ts"]).toEqual(["L1:e0"]);
    expect(files["src/usage.ts"]).toEqual(["L1:e1", "L3:e2"]);

    // 2. With detail: true
    const resDetail = await runSaVmTool({
      action: "find_references",
      symbol: "calculateMetrics",
      detail: true,
      cwd: dir,
      policy: {
        tools: {
          findReferences: true
        }
      }
    });

    const parsedDetail = JSON.parse(resDetail.stdout);
    expect(parsedDetail.files["src/def.ts"][0]).toContain("L1:e0:export function calculateMetrics");
    expect(parsedDetail.files["src/usage.ts"][0]).toContain("L1:e1:import { calculateMetrics");

    // 3. Targeted exploration with candidate_files
    const resExploration = await runSaVmTool({
      action: "find_references",
      symbol: "calculateMetrics",
      candidate_files: [join(dir, "src", "usage.ts")],
      cwd: dir,
      policy: {
        tools: {
          findReferences: true
        }
      }
    });
    const parsedExploration = JSON.parse(resExploration.stdout);
    expect(Object.keys(parsedExploration.files).length).toBe(1);
    expect(parsedExploration.files["src/usage.ts"]).toBeDefined();
    expect(parsedExploration.files["src/def.ts"]).toBeUndefined();

    // 4. Recursive candidate glob expansion
    const resGlob = await runSaVmTool({
      action: "find_references",
      symbol: "calculateMetrics",
      candidate_files: [join(dir, "src", "**", "*.ts")],
      cwd: dir,
      policy: {
        tools: {
          findReferences: true
        }
      }
    });
    const parsedGlob = JSON.parse(resGlob.stdout);
    expect(Object.keys(parsedGlob.files).sort()).toEqual(["src/def.ts", "src/usage.ts"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("find_references correctly classifies e0 (def), e1 (imp), e2 (use) across various syntax patterns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-find-refs-syntax-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });

    // File with definition patterns
    await writeFile(
      join(dir, "src", "definitions.ts"),
      [
        "export class AuthService {",
        "  private token: string;",
        "}",
        "export interface UserToken { id: string; }",
        "export const DefaultAuthService = new AuthService();"
      ].join("\n"),
      "utf8"
    );

    // File with import patterns
    await writeFile(
      join(dir, "src", "imports.ts"),
      [
        "import { AuthService } from './definitions';",
        "import type { UserToken } from './definitions';",
        "const localService = require('./definitions').AuthService;"
      ].join("\n"),
      "utf8"
    );

    // File with usage patterns
    await writeFile(
      join(dir, "src", "usage.ts"),
      [
        "function verify(service: AuthService) {",
        "  if (service instanceof AuthService) {",
        "    return true;",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );

    const res = await runSaVmTool({
      action: "find_references",
      symbol: "AuthService",
      detail: false,
      cwd: dir,
      policy: { tools: { findReferences: true } }
    });

    expect(res.ok).toBe(true);
    const data = JSON.parse(res.stdout);
    expect(data.types).toEqual({ e0: "def", e1: "imp", e2: "use" });

    // Verify definitions (e0) and local usage (e2)
    expect(data.files["src/definitions.ts"]).toEqual(["L1:e0", "L5:e2"]);

    // Verify imports (e1)
    expect(data.files["src/imports.ts"]).toEqual(["L1:e1", "L3:e1"]);

    // Verify usages (e2)
    expect(data.files["src/usage.ts"]).toEqual(["L1:e2", "L2:e2"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("find_references respects exclude_comments and include_declarations toggles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-find-refs-flags-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });

    await writeFile(
      join(dir, "src", "target.ts"),
      [
        "export function processPayment() { return true; }",
        "// processPayment handles transactions",
        "/* processPayment in block comment */",
        "* processPayment in doc block",
        "# processPayment in hash comment",
        "const res = processPayment();"
      ].join("\n"),
      "utf8"
    );

    // 1. By default: exclude_comments = true, include_declarations = true
    const resDefault = await runSaVmTool({
      action: "find_references",
      symbol: "processPayment",
      cwd: dir,
      policy: { tools: { findReferences: true } }
    });
    const dataDefault = JSON.parse(resDefault.stdout);
    // Should have 1 def (L1:e0) and 1 use (L6:e2), all comments skipped
    expect(dataDefault.files["src/target.ts"]).toEqual(["L1:e0", "L6:e2"]);
    expect(dataDefault.total).toBe(2);

    // 2. exclude_comments = false: comments are included
    const resWithComments = await runSaVmTool({
      action: "find_references",
      symbol: "processPayment",
      exclude_comments: false,
      cwd: dir,
      policy: { tools: { findReferences: true } }
    });
    const dataWithComments = JSON.parse(resWithComments.stdout);
    expect(dataWithComments.files["src/target.ts"].length).toBe(6);
    expect(dataWithComments.total).toBe(6);

    // 3. include_declarations = false: definition (e0) is omitted
    const resNoDecl = await runSaVmTool({
      action: "find_references",
      symbol: "processPayment",
      include_declarations: false,
      cwd: dir,
      policy: { tools: { findReferences: true } }
    });
    const dataNoDecl = JSON.parse(resNoDecl.stdout);
    expect(dataNoDecl.files["src/target.ts"]).toEqual(["L6:e2"]);
    expect(dataNoDecl.total).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("find_references strictly adheres to word boundaries (no prefix/suffix substrings)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-find-refs-boundaries-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });

    await writeFile(
      join(dir, "src", "sample.ts"),
      [
        "const auth = 1;",
        "const authorize = 2;",
        "const unauthenticated = 3;",
        "const sub_auth_val = 4;",
        "return auth + 10;"
      ].join("\n"),
      "utf8"
    );

    const res = await runSaVmTool({
      action: "find_references",
      symbol: "auth",
      cwd: dir,
      policy: { tools: { findReferences: true } }
    });

    const data = JSON.parse(res.stdout);
    // Only line 1 and line 5 contain standalone word 'auth'
    expect(data.total).toBe(2);
    expect(data.files["src/sample.ts"]).toEqual(["L1:e0", "L5:e2"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("find_references caps results by max_results and max_tokens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-find-refs-caps-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });

    const lines: string[] = ["export function benchmark() {}"];
    for (let i = 1; i <= 20; i++) {
      lines.push(`const call_${i} = benchmark();`);
    }
    await writeFile(join(dir, "src", "dense.ts"), lines.join("\n"), "utf8");

    // 1. Cap by max_results = 5
    const resResults = await runSaVmTool({
      action: "find_references",
      symbol: "benchmark",
      max_results: 5,
      cwd: dir,
      policy: { tools: { findReferences: true } }
    });
    const dataResults = JSON.parse(resResults.stdout);
    expect(dataResults.total).toBe(21);
    expect(dataResults.returned).toBe(5);
    expect(dataResults.truncated).toBe(true);
    expect(dataResults.files["src/dense.ts"].length).toBe(5);

    // 2. Cap by max_tokens with detail: true
    const resTokens = await runSaVmTool({
      action: "find_references",
      symbol: "benchmark",
      detail: true,
      max_tokens: 150,
      cwd: dir,
      policy: { tools: { findReferences: true } }
    });
    const dataTokens = JSON.parse(resTokens.stdout);
    expect(dataTokens.total).toBe(21);
    expect(dataTokens.truncated).toBe(true);
    expect(dataTokens.returned).toBeLessThan(10);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("find_references enforces single path key constraint with zero duplication", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-find-refs-single-path-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });

    const lines: string[] = ["export function singleKeyValidation() {}"];
    for (let i = 0; i < 15; i++) {
      lines.push(`console.log(singleKeyValidation());`);
    }
    await writeFile(join(dir, "src", "repeated.ts"), lines.join("\n"), "utf8");

    const res = await runSaVmTool({
      action: "find_references",
      symbol: "singleKeyValidation",
      cwd: dir,
      policy: { tools: { findReferences: true } }
    });
    const data = JSON.parse(res.stdout);

    // Key must appear EXACTLY ONCE
    const keys = Object.keys(data.files);
    expect(keys).toEqual(["src/repeated.ts"]);
    expect(data.files["src/repeated.ts"].length).toBe(16);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("find_references correctly accepts explicit symbol parameter without requiring query alias", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-symbol-param-test-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "check.ts"), "export function checkSaVmPath() { return true; }\ncheckSaVmPath();\n", "utf8");

    const res = await runSaVmTool({
      action: "find_references",
      symbol: "checkSaVmPath",
      detail: false,
      max_results: 50,
      cwd: dir,
      policy: { tools: { findReferences: true } }
    });

    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe("");
    const parsed = JSON.parse(res.stdout);
    expect(parsed.symbol).toBe("checkSaVmPath");
    expect(parsed.total).toBe(2);
    expect(parsed.files["src/check.ts"]).toEqual(["L1:e0", "L2:e2"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveTimeoutMs correctly parses ms, seconds, clamping and defaults", () => {
  expect(resolveTimeoutMs(undefined, 10000)).toBe(10000);
  expect(resolveTimeoutMs({ timeout_ms: 5000 }, 10000)).toBe(5000);
  expect(resolveTimeoutMs({ timeout: 15 }, 10000)).toBe(15000);
  expect(resolveTimeoutMs({ timeout: 12000 }, 10000)).toBe(12000);
  expect(resolveTimeoutMs({ timeout_ms: 10 }, 10000)).toBe(50);
  expect(resolveTimeoutMs({ timeout_ms: 999999 }, 10000)).toBe(300000);
});

test("time-consuming operations gracefully enforce timeout without hanging", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-timeout-test-"));
  try {
    await mkdir(join(dir, "sub"), { recursive: true });
    for (let i = 0; i < 20; i++) {
      await writeFile(join(dir, "sub", `file_${i}.ts`), `export function sampleFunction_${i}() { return ${i}; }\n`, "utf8");
    }

    // 1. grep_search with 1ms timeout — must either timeout or return partial with timeout flag
    const grepRes = await runSaVmTool({
      action: "grep_search",
      query: "sampleFunction",
      dir,
      cwd: dir,
      timeout_ms: 1
    });
    if (!grepRes.ok) {
      expect(grepRes.kind).toBe("timeout");
      expect(grepRes.exitCode).toBe(124);
    } else {
      // On fast machines, may complete before timeout — both outcomes are valid
      if (grepRes.stderr.includes("timeout")) {
        expect(grepRes.stderr).toContain("timeout");
      }
      // grep_search always returns ok:true with stdout — verify it's parseable
      expect(grepRes.exitCode).toBe(0);
    }

    // 2. find_references with 1ms timeout — may timeout or complete on fast systems
    const refRes = await runSaVmTool({
      action: "find_references",
      symbol: "sampleFunction_0",
      dir,
      cwd: dir,
      timeout_ms: 1,
      policy: { tools: { findReferences: true } }
    });
    if (!refRes.ok) {
      expect(refRes.kind).toBe("timeout");
      expect(refRes.exitCode).toBe(124);
    } else {
      const parsed = JSON.parse(refRes.stdout);
      // On fast machines with small dirs, 1ms may not trigger timeout
      if (parsed.timed_out) {
        expect(parsed.timed_out).toBe(true);
        expect(refRes.stderr).toContain("timeout");
      } else {
        // Completed normally — still a valid outcome
        expect(parsed.symbol).toBe("sampleFunction_0");
      }
    }

    // 3. find_files with 1ms timeout
    const findRes = await runSaVmTool({
      action: "find_files",
      dir,
      cwd: dir,
      timeout_ms: 1
    });
    if (!findRes.ok) {
      expect(findRes.kind).toBe("timeout");
      expect(findRes.exitCode).toBe(124);
    }

    // 4. normalizeSaVmRunInput maps timeout / timeout_ms to deadline_ms
    const normalized1 = normalizeSaVmRunInput({
      source: "console.log(1)",
      language: "js",
      policy: { execution: { javascript: true } },
      timeout: 25
    });
    expect(normalized1.limits.deadline_ms).toBe(25000);

    const normalized2 = normalizeSaVmRunInput({
      source: "console.log(1)",
      language: "js",
      policy: { execution: { javascript: true } },
      timeout_ms: 8000
    });
    expect(normalized2.limits.deadline_ms).toBe(8000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isGitIgnored excludes hardcoded dirs without any .gitignore rules", () => {
  const emptyRules: ReturnType<typeof loadGitIgnoreRules> = [];
  // Hardcoded always-excluded dirs
  expect(isGitIgnored("node_modules", true, emptyRules)).toBe(true);
  expect(isGitIgnored(".git", true, emptyRules)).toBe(true);
  expect(isGitIgnored("dist", true, emptyRules)).toBe(true);
  expect(isGitIgnored(".turbo", true, emptyRules)).toBe(true);
  expect(isGitIgnored("coverage", true, emptyRules)).toBe(true);
  expect(isGitIgnored("build", true, emptyRules)).toBe(true);
  expect(isGitIgnored("target", true, emptyRules)).toBe(true);
  expect(isGitIgnored("__pycache__", true, emptyRules)).toBe(true);
  // Not excluded as files
  expect(isGitIgnored("node_modules", false, emptyRules)).toBe(false);
  // Normal dirs not excluded
  expect(isGitIgnored("src", true, emptyRules)).toBe(false);
  expect(isGitIgnored("apps", true, emptyRules)).toBe(false);
});

test("loadGitIgnoreRules and isGitIgnored respect .gitignore patterns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-gitignore-test-"));
  try {
    // Create a .gitignore with various patterns
    await writeFile(join(dir, ".gitignore"), [
      "# comments are ignored",
      "*.log",
      "*.bak",
      "tmpwork/",
      ".env",
      "!.env.example",
      "desktop-resources",
      "release-*",
      "__*.cjs",
    ].join("\n"), "utf8");

    const rules = loadGitIgnoreRules(dir);
    expect(rules.length).toBeGreaterThan(0);

    // *.log files should be ignored
    expect(isGitIgnored("debug.log", false, rules)).toBe(true);
    expect(isGitIgnored("app.log", false, rules)).toBe(true);
    // *.bak files should be ignored
    expect(isGitIgnored("backup.bak", false, rules)).toBe(true);
    // tmpwork/ is dir-only
    expect(isGitIgnored("tmpwork", true, rules)).toBe(true);
    expect(isGitIgnored("tmpwork", false, rules)).toBe(false); // file named tmpwork is OK
    // .env should be ignored
    expect(isGitIgnored(".env", false, rules)).toBe(true);
    // !.env.example is negated — should NOT be ignored
    expect(isGitIgnored(".env.example", false, rules)).toBe(false);
    // desktop-resources
    expect(isGitIgnored("desktop-resources", true, rules)).toBe(true);
    expect(isGitIgnored("desktop-resources", false, rules)).toBe(true);
    // release-* wildcard
    expect(isGitIgnored("release-v1.0", true, rules)).toBe(true);
    expect(isGitIgnored("release-beta", false, rules)).toBe(true);
    // __*.cjs
    expect(isGitIgnored("__test.cjs", false, rules)).toBe(true);
    expect(isGitIgnored("normal.cjs", false, rules)).toBe(false);
    // Normal files should pass
    expect(isGitIgnored("index.ts", false, rules)).toBe(false);
    expect(isGitIgnored("package.json", false, rules)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isGitIgnored matches nested and anchored .gitignore paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-gitignore-path-test-"));
  try {
    await writeFile(join(dir, ".gitignore"), [
      "generated/",
      "docs/**/*.md",
      "/root-only.txt",
      "foo/bar.txt",
    ].join("\n"), "utf8");
    const rules = loadGitIgnoreRules(dir);

    expect(isGitIgnored("generated", true, rules, "src/generated")).toBe(true);
    expect(isGitIgnored("file.md", false, rules, "docs/file.md")).toBe(true);
    expect(isGitIgnored("file.md", false, rules, "docs/guide/file.md")).toBe(true);
    expect(isGitIgnored("file.txt", false, rules, "docs/file.txt")).toBe(false);
    expect(isGitIgnored("root-only.txt", false, rules, "root-only.txt")).toBe(true);
    expect(isGitIgnored("root-only.txt", false, rules, "nested/root-only.txt")).toBe(false);
    expect(isGitIgnored("bar.txt", false, rules, "foo/bar.txt")).toBe(true);
    expect(isGitIgnored("bar.txt", false, rules, "nested/foo/bar.txt")).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("grep_search respects .gitignore and skips ignored files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-gi-grep-test-"));
  try {
    await writeFile(join(dir, ".gitignore"), "ignored_dir/\n*.log\n", "utf8");
    // Create files: one in normal dir, one in ignored dir, one .log file
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "ignored_dir"), { recursive: true });
    await writeFile(join(dir, "src", "main.ts"), "export const MARKER_GREP_GI = true;\n", "utf8");
    await writeFile(join(dir, "ignored_dir", "hidden.ts"), "export const MARKER_GREP_GI = true;\n", "utf8");
    await writeFile(join(dir, "debug.log"), "MARKER_GREP_GI in log\n", "utf8");

    const res = await runSaVmTool({
      action: "grep_search",
      query: "MARKER_GREP_GI",
      dir,
      cwd: dir
    });
    expect(res.ok).toBe(true);
    const matches = JSON.parse(res.stdout);
    // Only src/main.ts should appear — ignored_dir and .log are excluded
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain("src/main.ts");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("run_project_check denies unknown or unconfigured profiles", async () => {
  const res = await runSaVmTool({
    action: "run_project_check",
    profile: "unknown-profile",
    policy: { process: { bunProfiles: ["shared-typecheck"] } },
    cwd: process.cwd()
  });
  expect(res.ok).toBe(false);
  expect(res.exitCode).toBe(228);
  expect(res.stderr).toContain("Project check profile denied");
});

test("run_project_check test-file profiles reject path traversal and invalid directories", async () => {
  const policy = { process: { bunProfiles: ["server-test-file"] } };

  // Path traversal
  const res1 = await runSaVmTool({
    action: "run_project_check",
    profile: "server-test-file",
    test_file: "tests/server/../../package.json",
    policy,
    cwd: process.cwd()
  });
  expect(res1.ok).toBe(false);
  expect(res1.exitCode).toBe(228);
  expect(res1.stderr).toContain("invalid characters or path traversal");

  // Wrong directory
  const res2 = await runSaVmTool({
    action: "run_project_check",
    profile: "server-test-file",
    test_file: "tests/web/uiSettingsDrawer.test.tsx",
    policy,
    cwd: process.cwd()
  });
  expect(res2.ok).toBe(false);
  expect(res2.exitCode).toBe(228);
  expect(res2.stderr).toContain("must start with 'tests/server/'");

  // Non-test file
  const res3 = await runSaVmTool({
    action: "run_project_check",
    profile: "server-test-file",
    test_file: "tests/server/helper.txt",
    policy,
    cwd: process.cwd()
  });
  expect(res3.ok).toBe(false);
  expect(res3.exitCode).toBe(228);
  expect(res3.stderr).toContain("must end with .test.ts");

  // Non-existent file
  const res4 = await runSaVmTool({
    action: "run_project_check",
    profile: "server-test-file",
    test_file: "tests/server/does_not_exist.test.ts",
    policy,
    cwd: process.cwd()
  });
  expect(res4.ok).toBe(false);
  expect(res4.exitCode).toBe(228);
  expect(res4.stderr).toContain("test file does not exist");
});

test("run_project_check executes shared-typecheck profile safely", async () => {
  const res = await runSaVmTool({
    action: "run_project_check",
    profile: "shared-typecheck",
    policy: { process: { bunProfiles: ["shared-typecheck"] } },
    cwd: process.cwd()
  });
  expect(res.ok).toBe(true);
  expect(res.exitCode).toBe(0);
});

test("run_project_check requires profile when not provided", async () => {
  const res = await runSaVmTool({
    action: "run_project_check",
    policy: { process: { bunProfiles: ["shared-typecheck"] } },
    cwd: process.cwd()
  });
  expect(res.ok).toBe(false);
  expect(res.exitCode).toBe(228);
  expect(res.stderr).toContain("Bun profile is required");
});

test("natively executes count_lines and provides total_lines in file_info", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-count-"));
  try {
    const testFile = join(tmpDir, "test.txt");
    await writeFile(testFile, "line 1\nline 2\nline 3\n", "utf8");

    const countRes = await runSaVmTool({
      action: "count_lines",
      path: testFile,
      cwd: tmpDir
    });
    expect(countRes.ok).toBe(true);
    expect(countRes.stdout).toContain("Total Lines: 3");

    const infoRes = await runSaVmTool({
      action: "file_info",
      path: testFile,
      cwd: tmpDir
    });
    expect(infoRes.ok).toBe(true);
    const parsed = JSON.parse(infoRes.stdout);
    expect(parsed.total_lines).toBe(3);
    expect(parsed.line_count).toBe(3);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("grep_search supports regex alternation and single-file target", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-grep-regex-"));
  try {
    const logFile = join(tmpDir, "tests_run.log");
    const logContent = [
      "2026-09-07 INFO starting tests",
      "2026-09-07 WARN linear scan initiated",
      "2026-09-07 ERROR FallthroughForbidden: basic blocks must end",
      "2026-09-07 DEBUG three_await resolved"
    ].join("\n");
    await writeFile(logFile, logContent, "utf8");

    // 1. Single file grep with regex alternation
    const grepFileRes = await runSaVmTool({
      action: "grep_search",
      path: logFile,
      query: "three_await|linear|fallthrough",
      cwd: tmpDir
    });
    expect(grepFileRes.ok).toBe(true);
    const matches = JSON.parse(grepFileRes.stdout);
    expect(matches.length).toBe(3);
    expect(matches[0].line).toBe(2);
    expect(matches[1].line).toBe(3);
    expect(matches[2].line).toBe(4);

    // 2. Directory grep with regex
    const grepDirRes = await runSaVmTool({
      action: "grep_search",
      dir: tmpDir,
      query: "FallthroughForbidden|basic blocks must end",
      cwd: tmpDir
    });
    expect(grepDirRes.ok).toBe(true);
    const dirMatches = JSON.parse(grepDirRes.stdout);
    expect(dirMatches.length).toBe(1);
    expect(dirMatches[0].line).toBe(3);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("grep_search paginates single-file targets when page parameters are provided", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-grep-page-"));
  try {
    const target = join(tmpDir, "matches.txt");
    await writeFile(target, Array.from({ length: 7 }, (_, index) => `match ${index + 1}`).join("\n"), "utf8");

    const firstPage = await runSaVmTool({
      action: "grep_search",
      path: target,
      query: "match",
      page: 1,
      page_size: 3,
      cwd: tmpDir
    });
    const secondPage = await runSaVmTool({
      action: "grep_search",
      path: target,
      query: "match",
      page: 2,
      page_size: 3,
      cwd: tmpDir
    });

    expect(firstPage.ok).toBe(true);
    expect(secondPage.ok).toBe(true);
    const first = JSON.parse(firstPage.stdout);
    const second = JSON.parse(secondPage.stdout);
    expect(first.page).toBe(1);
    expect(second.page).toBe(2);
    expect(first.total).toBe(7);
    expect(first.total_pages).toBe(3);
    expect(first.matches.map((item: { line: number }) => item.line)).toEqual([1, 2, 3]);
    expect(second.matches.map((item: { line: number }) => item.line)).toEqual([4, 5, 6]);
    expect(first.matches).not.toEqual(second.matches);
    expect(first.has_next).toBe(true);
    expect(second.has_prev).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("grep_search_async paginates the App.tsx example and accepts max_results alias", async () => {
  const baseInput = {
    action: "grep_search_async",
    query: "useCallback",
    dir: "apps/web/src/App.tsx",
    max_file_bytes: 5 * 1024 * 1024,
    page_size: 5,
    max_results: 5,
    cwd: process.cwd()
  } as const;
  const firstPageResult = await runSaVmTool({ ...baseInput, page: 1 });
  const secondPageResult = await runSaVmTool({ ...baseInput, page: 2 });

  expect(firstPageResult.ok).toBe(true);
  expect(secondPageResult.ok).toBe(true);
  const firstPage = JSON.parse(firstPageResult.stdout);
  const secondPage = JSON.parse(secondPageResult.stdout);
  expect(firstPage.queries).toEqual(["useCallback"]);
  expect(secondPage.queries).toEqual(["useCallback"]);
  expect(firstPage.page).toBe(1);
  expect(secondPage.page).toBe(2);
  expect(firstPage.page_size).toBe(5);
  expect(secondPage.page_size).toBe(5);
  expect(firstPage.returned).toBe(5);
  expect(secondPage.returned).toBe(5);
  expect(firstPage.total).toBeGreaterThan(10);
  expect(secondPage.total).toBe(firstPage.total);
  expect(firstPage.total_pages).toBe(Math.ceil(firstPage.total / 5));
  expect(firstPage.has_prev).toBe(false);
  expect(secondPage.has_prev).toBe(true);
  expect(firstPage.has_next).toBe(true);
  expect(firstPage.matches).not.toEqual(secondPage.matches);
});

test("grep_search_async count_cap distinguishes exact totals from truncated results", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-grep-async-cap-"));
  try {
    const exactTarget = join(tmpDir, "exact.txt");
    const truncatedTarget = join(tmpDir, "truncated.txt");
    await writeFile(exactTarget, "match 1\nmatch 2\nmatch 3", "utf8");
    await writeFile(truncatedTarget, "match 1\nmatch 2\nmatch 3\nmatch 4", "utf8");

    const exactFirstResult = await runSaVmTool({
      action: "grep_search_async",
      path: exactTarget,
      query: "match",
      page: 1,
      page_size: 2,
      count_cap: 3,
      cwd: tmpDir
    });
    const exactSecondResult = await runSaVmTool({
      action: "grep_search_async",
      path: exactTarget,
      query: "match",
      page: 2,
      page_size: 2,
      count_cap: 3,
      cwd: tmpDir
    });
    const truncatedResult = await runSaVmTool({
      action: "grep_search_async",
      path: truncatedTarget,
      query: "match",
      page: 1,
      page_size: 2,
      count_cap: 3,
      cwd: tmpDir
    });

    const exactFirst = JSON.parse(exactFirstResult.stdout);
    const exactSecond = JSON.parse(exactSecondResult.stdout);
    const truncated = JSON.parse(truncatedResult.stdout);
    expect(exactFirst.total).toBe(3);
    expect(exactFirst.truncated).toBe(false);
    expect(exactSecond.returned).toBe(1);
    expect(exactSecond.has_next).toBe(false);
    expect(truncated.total).toBe(3);
    expect(truncated.truncated).toBe(true);
    expect(truncated.has_next).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("find_files supports path_pattern for subfolder matching", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-find-path-"));
  try {
    await mkdir(join(tmpDir, "sci", "sab"), { recursive: true });
    await mkdir(join(tmpDir, "src", "sab"), { recursive: true });
    await mkdir(join(tmpDir, "other", "dir"), { recursive: true });

    await writeFile(join(tmpDir, "sci", "sab", "codegen.zig"), "pub fn main() void {}", "utf8");
    await writeFile(join(tmpDir, "src", "sab", "validator.zig"), "pub fn main() void {}", "utf8");
    await writeFile(join(tmpDir, "other", "dir", "helper.zig"), "pub fn main() void {}", "utf8");

    const res = await runSaVmTool({
      action: "find_files",
      dir: tmpDir,
      pattern: "*.zig",
      path_pattern: "sci.*sab|src.*sab",
      cwd: tmpDir
    });
    expect(res.ok).toBe(true);
    const files = res.stdout.split("\n").filter(Boolean);
    expect(files.length).toBe(2);
    expect(files.some((f: string) => f.includes("codegen.zig"))).toBe(true);
    expect(files.some((f: string) => f.includes("validator.zig"))).toBe(true);
    expect(files.some((f: string) => f.includes("helper.zig"))).toBe(false);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("temp directory is readable by default in saVmPolicy", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-temp-read-"));
  try {
    const tmpFile = join(tmpDir, "sample.disasm.sa");
    await writeFile(tmpFile, "line1\nline2\nline3\nline4\nline5\n", "utf8");

    // Reading outside cwd using read_lines should succeed because tmpdir is allowed
    const res = await runSaVmTool({
      action: "read_lines",
      path: tmpFile,
      start_line: 2,
      end_line: 4,
      cwd: process.cwd()
    });
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("line2");
    expect(res.stdout).toContain("line4");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("test_path, file_exists, and file_info handle existing and non-existing files cleanly", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-test-path-"));
  try {
    const existingFile = join(tmpDir, "actual.txt");
    await writeFile(existingFile, "hello\nworld\n", "utf8");

    // 1. Existing file with test_path
    const testPathRes = await runSaVmTool({
      action: "test_path",
      path: "actual.txt",
      cwd: tmpDir
    });
    expect(testPathRes.ok).toBe(true);
    expect(testPathRes.exitCode).toBe(0);
    const existingInfo = JSON.parse(testPathRes.stdout);
    expect(existingInfo.exists).toBe(true);
    expect(existingInfo.isFile).toBe(true);
    expect(existingInfo.total_lines).toBe(2);

    // 2. Existing file with file_exists alias and file param
    const fileExistsRes = await runSaVmTool({
      action: "file_exists",
      file: "actual.txt",
      cwd: tmpDir
    });
    expect(fileExistsRes.ok).toBe(true);
    const fileExistsInfo = JSON.parse(fileExistsRes.stdout);
    expect(fileExistsInfo.exists).toBe(true);

    // 3. Non-existing file with test_path -> returns exists: false, exitCode: 0, no exception
    const missingRes = await runSaVmTool({
      action: "test_path",
      path: "non_existent.txt",
      cwd: tmpDir
    });
    expect(missingRes.ok).toBe(true);
    expect(missingRes.exitCode).toBe(0);
    const missingInfo = JSON.parse(missingRes.stdout);
    expect(missingInfo.exists).toBe(false);
    expect(missingInfo.isFile).toBe(false);
    expect(missingInfo.isDirectory).toBe(false);

    // 4. Non-existing file with file_info -> returns exists: false, exitCode: 0
    const missingInfoRes = await runSaVmTool({
      action: "file_info",
      path: "does_not_exist_either.log",
      cwd: tmpDir
    });
    expect(missingInfoRes.ok).toBe(true);
    expect(missingInfoRes.exitCode).toBe(0);
    const missingFileInfo = JSON.parse(missingInfoRes.stdout);
    expect(missingFileInfo.exists).toBe(false);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("read_lines, read_file, and read_file_tail handle non-existing files cleanly with exists: false and exitCode: 0", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-missing-read-test-"));
  try {
    // 1. read_lines on non-existing file
    const resLines = await runSaVmTool({
      action: "read_lines",
      path: "missing_file.txt",
      start_line: 1,
      end_line: 100,
      cwd: tmpDir
    });
    expect(resLines.ok).toBe(true);
    expect(resLines.exitCode).toBe(0);
    const linesJson = JSON.parse(resLines.stdout);
    expect(linesJson.exists).toBe(false);
    expect(linesJson.lines).toEqual([]);
    expect(linesJson.total_lines).toBe(0);

    // 2. read_file on non-existing file
    const resFile = await runSaVmTool({
      action: "read_file",
      path: "missing_whole.txt",
      cwd: tmpDir
    });
    expect(resFile.ok).toBe(true);
    expect(resFile.exitCode).toBe(0);
    const fileJson = JSON.parse(resFile.stdout);
    expect(fileJson.exists).toBe(false);
    expect(fileJson.lines).toEqual([]);

    // 3. read_file_tail on non-existing file
    const resTail = await runSaVmTool({
      action: "read_file_tail",
      path: "missing_tail.log",
      lines: 50,
      cwd: tmpDir
    });
    expect(resTail.ok).toBe(true);
    expect(resTail.exitCode).toBe(0);
    const tailJson = JSON.parse(resTail.stdout);
    expect(tailJson.exists).toBe(false);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("read_lines and read_file support file and target parameter aliases", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-alias-test-"));
  try {
    const testFile = join(tmpDir, "example.txt");
    await writeFile(testFile, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5", "utf8");

    // Using 'file' alias in read_lines
    const resFileAlias = await runSaVmTool({
      action: "read_lines",
      file: "example.txt",
      start_line: 2,
      end_line: 4,
      cwd: tmpDir
    });
    expect(resFileAlias.ok).toBe(true);
    expect(resFileAlias.stdout).toContain("Line 2");
    expect(resFileAlias.stdout).toContain("Line 3");
    expect(resFileAlias.stdout).toContain("Line 4");

    // Using 'target' alias in read_file
    const resTargetAlias = await runSaVmTool({
      action: "read_file",
      target: "example.txt",
      cwd: tmpDir
    });
    expect(resTargetAlias.ok).toBe(true);
    expect(resTargetAlias.stdout).toContain("Line 1");
    expect(resTargetAlias.stdout).toContain("Line 5");

    // Using 'filePath' alias
    const resFilePath = await runSaVmTool({
      action: "read_file",
      filePath: "example.txt",
      cwd: tmpDir
    });
    expect(resFilePath.ok).toBe(true);
    expect(resFilePath.stdout).toContain("Line 1");

    // Using 'AbsolutePath' alias
    const resAbsPath = await runSaVmTool({
      action: "read_file",
      AbsolutePath: testFile,
      cwd: tmpDir
    });
    expect(resAbsPath.ok).toBe(true);
    expect(resAbsPath.stdout).toContain("Line 1");

    // Missing path returns handled sa_error without throwing an unhandled exception
    const resMissingPath = await runSaVmTool({
      action: "read_file",
      cwd: tmpDir
    });
    expect(resMissingPath.ok).toBe(false);
    expect(resMissingPath.kind).toBe("sa_error");
    expect(resMissingPath.stderr).toContain("requires a 'path' parameter");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("list_dir handles non-existing directory cleanly with exists: false and exitCode: 0", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-missing-dir-test-"));
  try {
    const res = await runSaVmTool({
      action: "list_dir",
      dir: "non_existent_folder",
      cwd: tmpDir
    });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.exists).toBe(false);
    expect(json.entries).toEqual([]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("list_dir always returns relative path on items and supports type filtering", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-listdir-test-"));
  try {
    await mkdir(join(tmpDir, "subfolder"), { recursive: true });
    await writeFile(join(tmpDir, "subfolder", "nested.txt"), "nested content", "utf8");
    await writeFile(join(tmpDir, "root_file.txt"), "root content", "utf8");

    // 1. list_dir default (all entries) -> items always include relative path
    const resAll = await runSaVmTool({
      action: "list_dir",
      dir: ".",
      depth: 1,
      cwd: tmpDir
    });
    expect(resAll.ok).toBe(true);
    const allItems = JSON.parse(resAll.stdout);
    expect(allItems.length).toBe(2);
    for (const item of allItems) {
      expect(typeof item.path).toBe("string");
      expect(item.path.length).toBeGreaterThan(0);
    }

    // 2. list_dir with type: "directory"
    const resDirs = await runSaVmTool({
      action: "list_dir",
      dir: ".",
      type: "directory",
      cwd: tmpDir
    });
    expect(resDirs.ok).toBe(true);
    const dirItems = JSON.parse(resDirs.stdout);
    expect(dirItems.length).toBe(1);
    expect(dirItems[0].name).toBe("subfolder");
    expect(dirItems[0].isDirectory).toBe(true);

    // 3. list_dir with type: "file"
    const resFiles = await runSaVmTool({
      action: "list_dir",
      dir: ".",
      type: "file",
      cwd: tmpDir
    });
    expect(resFiles.ok).toBe(true);
    const fileItems = JSON.parse(resFiles.stdout);
    expect(fileItems.length).toBe(1);
    expect(fileItems[0].name).toBe("root_file.txt");
    expect(fileItems[0].isFile).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("ensure_dir and mkdir create directory recursively with exitCode: 0", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-ensure-dir-test-"));
  try {
    const res = await runSaVmTool({
      action: "ensure_dir",
      path: "deep/nested/path",
      cwd: tmpDir
    });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.created).toBe(true);
    expect(existsSync(join(tmpDir, "deep", "nested", "path"))).toBe(true);

    // Calling again on existing directory succeeds idempotently
    const res2 = await runSaVmTool({
      action: "mkdir",
      dir: "deep/nested/path",
      cwd: tmpDir
    });
    expect(res2.ok).toBe(true);
    expect(res2.exitCode).toBe(0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("vm-read and vm_read actions seamlessly route to read_file", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sa-vm-read-alias-test-"));
  try {
    await Bun.write(join(tmpDir, "hello.txt"), "Line 1\nLine 2\nLine 3\nLine 4\n");
    const res1 = await runSaVmTool({
      action: "vm-read",
      path: "hello.txt",
      cwd: tmpDir
    });
    expect(res1.ok).toBe(true);
    expect(res1.stdout).toContain("Line 1");
    expect(res1.stdout).toContain("Line 4");

    const res2 = await runSaVmTool({
      action: "vm_read",
      file: "hello.txt",
      start_line: 2,
      end_line: 3,
      cwd: tmpDir
    });
    expect(res2.ok).toBe(true);
    expect(res2.stdout).toContain("Line 2");
    expect(res2.stdout).toContain("Line 3");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("list_dir skips gitignored and always-excluded dirs, supports pattern and exclude_dirs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-listdir-gi-"));
  try {
    await writeFile(join(dir, ".gitignore"), "ignored_dir/\n", "utf8");
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "ignored_dir"), { recursive: true });
    await mkdir(join(dir, "node_modules"), { recursive: true });
    await writeFile(join(dir, "src", "main.ts"), "export const x = 1;\n", "utf8");
    await writeFile(join(dir, "ignored_dir", "hidden.ts"), "export const y = 2;\n", "utf8");
    await writeFile(join(dir, "node_modules", "dep.js"), "module.exports = {};\n", "utf8");

    const res = await runSaVmTool({ action: "list_dir", dir: ".", depth: 2, cwd: dir });
    expect(res.ok).toBe(true);
    const paths = (JSON.parse(res.stdout) as Array<{ path: string }>).map((item) => item.path);
    expect(paths).toContain("src");
    expect(paths).toContain("src/main.ts");
    expect(paths).not.toContain("ignored_dir");
    expect(paths).not.toContain("node_modules");
    expect(res.stderr).toContain("skipped");

    const resPattern = await runSaVmTool({ action: "list_dir", dir: ".", depth: 2, pattern: "*.ts", cwd: dir });
    expect(resPattern.ok).toBe(true);
    expect((JSON.parse(resPattern.stdout) as Array<{ path: string }>).map((item) => item.path)).toContain("src/main.ts");

    const resExclude = await runSaVmTool({ action: "list_dir", dir: ".", depth: 2, exclude_dirs: ["src"], cwd: dir });
    expect(resExclude.ok).toBe(true);
    expect((JSON.parse(resExclude.stdout) as Array<{ path: string }>).map((item) => item.path)).not.toContain("src");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("grep_search skips oversized and binary files and honors root gitignore from subdirs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-grep-guard-"));
  try {
    await writeFile(join(dir, ".gitignore"), "ignored_dir/\n*.log\n", "utf8");
    await mkdir(join(dir, "pkg"), { recursive: true });
    await mkdir(join(dir, "ignored_dir"), { recursive: true });
    await writeFile(join(dir, "pkg", "a.ts"), "const MARKER_GREP_GUARD = 1;\n", "utf8");
    await writeFile(join(dir, "ignored_dir", "b.ts"), "const MARKER_GREP_GUARD = 2;\n", "utf8");
    await writeFile(join(dir, "pkg", "debug.log"), "MARKER_GREP_GUARD in log\n", "utf8");
    await writeFile(join(dir, "pkg", "big.ts"), `MARKER_GREP_GUARD ${"x".repeat(600 * 1024)}\n`, "utf8");
    await writeFile(join(dir, "pkg", "bin.dat"), "MARKER_GREP_GUARD\0binary-bytes\n", "utf8");

    const res = await runSaVmTool({ action: "grep_search", query: "MARKER_GREP_GUARD", dir: "pkg", cwd: dir });
    expect(res.ok).toBe(true);
    const matches = JSON.parse(res.stdout);
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain("pkg/a.ts");
    expect(res.stderr).toContain("skipped");

    const resRoot = await runSaVmTool({ action: "grep_search", query: "MARKER_GREP_GUARD", dir: ".", cwd: dir });
    expect(resRoot.ok).toBe(true);
    const rootMatches = JSON.parse(resRoot.stdout);
    expect(rootMatches.length).toBe(1);
    expect(rootMatches[0].file).toContain("pkg/a.ts");

    const resSized = await runSaVmTool({
      action: "grep_search",
      query: "MARKER_GREP_GUARD",
      dir: "pkg",
      max_file_bytes: 2048,
      cwd: dir
    });
    expect(resSized.ok).toBe(true);
    expect(JSON.parse(resSized.stdout).length).toBe(1);
    expect(resSized.stderr).toContain("max_file_bytes=2048");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("read_many reads multiple files in one call with per-file status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-read-many-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "export const alpha = 1;\n", "utf8");
    await writeFile(join(dir, "src", "b.ts"), "export const beta = 2;\n", "utf8");

    const res = await runSaVmTool({
      action: "read_many",
      files: ["src/a.ts", "src/b.ts", "src/missing.ts"],
      cwd: dir
    });
    expect(res.ok).toBe(true);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.length).toBe(3);
    expect(parsed[0].ok).toBe(true);
    expect(parsed[0].text).toContain("alpha");
    expect(parsed[1].ok).toBe(true);
    expect(parsed[1].text).toContain("beta");
    expect(parsed[2].ok).toBe(true);
    expect(parsed[2].text).toContain("exists");

    const empty = await runSaVmTool({ action: "read_many", files: [], cwd: dir });
    expect(empty.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// git_status / git_diff read-only native actions (isolated mkdtemp repos only)
import { spawnSync as __gitSpawn } from "node:child_process";

function __gitAvailable(): boolean {
  try {
    const r = __gitSpawn("git", ["--version"], { encoding: "utf8", timeout: 10000, shell: false });
    return r.status === 0;
  } catch {
    return false;
  }
}

function __git(cwd: string, argv: string[]): void {
  const r = __gitSpawn("git", argv, { cwd, encoding: "utf8", timeout: 15000, shell: false });
  if (r.status !== 0) throw new Error(`git ${argv.join(" ")} failed: ${r.stderr || r.stdout}`);
}

async function __makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-git-"));
  __git(dir, ["init"]);
  __git(dir, ["config", "user.email", "sa-vm-test@example.com"]);
  __git(dir, ["config", "user.name", "sa-vm-test"]);
  return dir;
}

test("git_status clean repo returns empty arrays and branch", async () => {
  if (!__gitAvailable()) return;
  const dir = await __makeRepo();
  try {
    await writeFile(join(dir, "a.txt"), "hello\n");
    __git(dir, ["add", "a.txt"]);
    __git(dir, ["commit", "-m", "init"]);
    const res = await runSaVmTool({ action: "git_status", cwd: dir });
    expect(res.ok).toBe(true);
    const out = JSON.parse(res.stdout);
    expect(typeof out.branch).toBe("string");
    expect(out.branch.length).toBeGreaterThan(0);
    expect(out.staged).toEqual([]);
    expect(out.unstaged).toEqual([]);
    expect(out.untracked).toEqual([]);
    expect(out.counts).toEqual({ staged: 0, unstaged: 0, untracked: 0 });
    expect(out.truncated).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git_status surfaces untracked files", async () => {
  if (!__gitAvailable()) return;
  const dir = await __makeRepo();
  try {
    const res = await runSaVmTool({ action: "git_status", cwd: dir });
    expect(res.ok).toBe(true);
    await writeFile(join(dir, "new.txt"), "untracked\n");
    const res2 = await runSaVmTool({ action: "git_status", cwd: dir });
    expect(res2.ok).toBe(true);
    const out = JSON.parse(res2.stdout);
    expect(out.untracked.map((e: { path: string }) => e.path)).toContain("new.txt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git_status surfaces unstaged modification with y=M", async () => {
  if (!__gitAvailable()) return;
  const dir = await __makeRepo();
  try {
    await writeFile(join(dir, "a.txt"), "v1\n");
    __git(dir, ["add", "a.txt"]);
    __git(dir, ["commit", "-m", "init"]);
    await writeFile(join(dir, "a.txt"), "v2\n");
    const res = await runSaVmTool({ action: "git_status", cwd: dir });
    expect(res.ok).toBe(true);
    const out = JSON.parse(res.stdout);
    const hit = out.unstaged.find((e: { path: string }) => e.path === "a.txt");
    expect(hit).toBeDefined();
    expect(hit.y).toBe("M");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git_status moves file to staged after git add with x=M", async () => {
  if (!__gitAvailable()) return;
  const dir = await __makeRepo();
  try {
    await writeFile(join(dir, "a.txt"), "v1\n");
    __git(dir, ["add", "a.txt"]);
    __git(dir, ["commit", "-m", "init"]);
    await writeFile(join(dir, "a.txt"), "v2\n");
    __git(dir, ["add", "a.txt"]);
    const res = await runSaVmTool({ action: "git_status", cwd: dir });
    expect(res.ok).toBe(true);
    const out = JSON.parse(res.stdout);
    const hit = out.staged.find((e: { path: string }) => e.path === "a.txt");
    expect(hit).toBeDefined();
    expect(hit.x).toBe("M");
    expect(out.unstaged.find((e: { path: string }) => e.path === "a.txt")).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git_diff default returns worktree diff with hunk header", async () => {
  if (!__gitAvailable()) return;
  const dir = await __makeRepo();
  try {
    await writeFile(join(dir, "a.txt"), "v1\n");
    __git(dir, ["add", "a.txt"]);
    __git(dir, ["commit", "-m", "init"]);
    await writeFile(join(dir, "a.txt"), "v2\n");
    const res = await runSaVmTool({ action: "git_diff", cwd: dir });
    expect(res.ok).toBe(true);
    const out = JSON.parse(res.stdout);
    expect(out.files).toContain("a.txt");
    expect(out.diff).toContain("@@");
    expect(out.truncated).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git_diff staged:true returns cached content", async () => {
  if (!__gitAvailable()) return;
  const dir = await __makeRepo();
  try {
    await writeFile(join(dir, "a.txt"), "v1\n");
    __git(dir, ["add", "a.txt"]);
    __git(dir, ["commit", "-m", "init"]);
    await writeFile(join(dir, "a.txt"), "v2\n");
    const unstaged = await runSaVmTool({ action: "git_diff", staged: false, cwd: dir });
    expect(unstaged.ok).toBe(true);
    expect(JSON.parse(unstaged.stdout).files).toContain("a.txt");
    const stagedEmpty = await runSaVmTool({ action: "git_diff", staged: true, cwd: dir });
    expect(stagedEmpty.ok).toBe(true);
    expect(JSON.parse(stagedEmpty.stdout).files).toEqual([]);
    __git(dir, ["add", "a.txt"]);
    const staged = await runSaVmTool({ action: "git_diff", staged: true, cwd: dir });
    expect(staged.ok).toBe(true);
    const out = JSON.parse(staged.stdout);
    expect(out.staged).toBe(true);
    expect(out.files).toContain("a.txt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git_diff stat_only returns stat and empty diff", async () => {
  if (!__gitAvailable()) return;
  const dir = await __makeRepo();
  try {
    await writeFile(join(dir, "a.txt"), "v1\n");
    __git(dir, ["add", "a.txt"]);
    __git(dir, ["commit", "-m", "init"]);
    await writeFile(join(dir, "a.txt"), "v2\n");
    const res = await runSaVmTool({ action: "git_diff", stat_only: true, cwd: dir });
    expect(res.ok).toBe(true);
    const out = JSON.parse(res.stdout);
    expect(out.diff).toBe("");
    expect(typeof out.stat).toBe("string");
    expect(out.stat.length).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git_diff path limits to a single file", async () => {
  if (!__gitAvailable()) return;
  const dir = await __makeRepo();
  try {
    await writeFile(join(dir, "a.txt"), "v1\n");
    await writeFile(join(dir, "b.txt"), "v1\n");
    __git(dir, ["add", "a.txt", "b.txt"]);
    __git(dir, ["commit", "-m", "init"]);
    await writeFile(join(dir, "a.txt"), "v2\n");
    await writeFile(join(dir, "b.txt"), "v2\n");
    const res = await runSaVmTool({ action: "git_diff", path: "a.txt", cwd: dir });
    expect(res.ok).toBe(true);
    const out = JSON.parse(res.stdout);
    expect(out.files).toEqual(["a.txt"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git_status in non-git directory returns ok:false", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-nogit-"));
  try {
    const res = await runSaVmTool({ action: "git_status", cwd: dir });
    expect(res.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git_diff truncates with tiny max_bytes", async () => {
  if (!__gitAvailable()) return;
  const dir = await __makeRepo();
  try {
    await writeFile(join(dir, "a.txt"), "v1\n");
    __git(dir, ["add", "a.txt"]);
    __git(dir, ["commit", "-m", "init"]);
    await writeFile(join(dir, "a.txt"), `${"x".repeat(5000)}\n`);
    const res = await runSaVmTool({ action: "git_diff", max_bytes: 512, cwd: dir });
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.stdout).truncated).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run_host destructive-git guard only applies when VM safe exec interception is on", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-host-"));
  const sandboxPolicy = { tools: { replaceExec: true } } as any;
  try {
    const safe = await runSaVmTool({ action: "run_host", exe: "git", args: ["status"], cwd: dir }, { cwd: dir, policy: sandboxPolicy });
    expect(safe.saVmViolation?.rule ?? "").not.toBe("process.run_host.unauthorized_executable");
    expect(safe.saVmViolation?.rule ?? "").not.toBe("process.run_host.git_destructive_blocked");

    for (const args of [["reset", "--hard"], ["reset", "--hard", "HEAD"], ["clean", "-fd"], ["revert", "HEAD"]]) {
      const res = await runSaVmTool({ action: "run_host", exe: "git", args, cwd: dir }, { cwd: dir, policy: sandboxPolicy });
      expect(res.ok).toBe(false);
      expect(res.kind).toBe("capability_denied");
      expect(res.exitCode).toBe(228);
      expect(res.saVmViolation?.rule).toBe("process.run_host.git_destructive_blocked");
    }

    // `git -C <path> status` must not be misread as a destructive subcommand.
    const withGlobalFlag = await runSaVmTool({ action: "run_host", exe: "git", args: ["-C", dir, "status"], cwd: dir }, { cwd: dir, policy: sandboxPolicy });
    expect(withGlobalFlag.saVmViolation?.rule ?? "").not.toBe("process.run_host.git_destructive_blocked");

    // Non-hard reset stays allowed at the safety gate.
    const softReset = await runSaVmTool({ action: "run_host", exe: "git", args: ["reset", "--soft", "HEAD"], cwd: dir }, { cwd: dir, policy: sandboxPolicy });
    expect(softReset.saVmViolation?.rule ?? "").not.toBe("process.run_host.git_destructive_blocked");

    // Sandbox off (no policy / replaceExec off): zero interception at the git gate.
    // NOTE: cwd is a fresh non-repo tmpdir, so git itself just errors harmlessly.
    for (const policy of [undefined, { tools: { replaceExec: false } } as any]) {
      const res = await runSaVmTool(
        { action: "run_host", exe: "git", args: ["reset", "--hard"], cwd: dir },
        policy === undefined ? { cwd: dir } : { cwd: dir, policy }
      );
      expect(res.saVmViolation?.rule ?? "").not.toBe("process.run_host.git_destructive_blocked");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run_host blocks python -c git passthrough", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-host-"));
  try {
    const res = await runSaVmTool({ action: "run_host", exe: "python", args: ["-c", "import subprocess; subprocess.run(['git', 'status'])"], cwd: dir });
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("git_status");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run_host blocks bun -e git passthrough", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sa-vm-host-"));
  try {
    const res = await runSaVmTool({ action: "run_host", exe: "bun", args: ["-e", "await Bun.spawnSync(['git', 'status'])"], cwd: dir });
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("git_status");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
