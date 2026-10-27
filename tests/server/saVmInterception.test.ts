import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";
import {
  interceptSaVmRequest,
  classifySaVmScriptToolRequest,
  saVmScriptLanguage,
  detectPowerShellAntiPattern
} from "../../backends/vmtool-security/src/security/saVmInterception";
import { runSaVmTool } from "../../apps/server/src/saVmTool";

const workspace = resolve(process.cwd(), "sa-vm-interception-fixture");
const runtimeRoot = join(import.meta.dir, "../../desktop-resources/sa-vm");

 test("does not treat generated Python or JavaScript text as a tool call", () => {
  expect(classifySaVmScriptToolRequest("assistant/message", { text: "请写一个 Python 脚本读取 input.json" })).toBeNull();
  expect(classifySaVmScriptToolRequest("assistant/message", { text: "Use JavaScript to parse this file" })).toBeNull();
 });

test("intercepts Python and Node host commands and requires sa_vm_run", () => {
  const python = interceptSaVmRequest("command/exec", {
    command: ["python", "-c", "open('out.txt', 'w').write('x')"]
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(python.action).toBe("require_sa_vm");
  if (python.action === "require_sa_vm") expect(python.request.language).toBe("python");

  const node = interceptSaVmRequest("thread/shellCommand", {
    command: ["node", "-e", "require('fs').writeFileSync('out.txt', 'x')"]
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(node.action).toBe("require_sa_vm");
  if (node.action === "require_sa_vm") expect(node.request.language).toBe("javascript");
  expect(saVmScriptLanguage(String.raw`C:\Program Files\nodejs\node.exe`)).toBe("javascript");
  const legacyToggle = interceptSaVmRequest("command/exec", { command: ["python", "-c", "print(1)"] }, {
    cwd: workspace,
    policy: { execution: { python: true, javascript: true } }
  });
  expect(legacyToggle.action).toBe("require_sa_vm");
});

test("blocks every direct host command in VM mode", () => {
  const decision = interceptSaVmRequest("thread/shellCommand", {
    command: ["powershell.exe", "-NoProfile", "-Command", "Get-ChildItem -Force C:\\Dism_10.1.1002.1"]
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(decision.action).toBe("deny");
  if (decision.action === "deny") {
    expect(decision.reason).toContain("Get-ChildItem");
  }

  const approval = interceptSaVmRequest("item/commandExecution/requestApproval", {
    command: "Get-ChildItem -Force C:\\Dism_10.1.1002.1"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(approval).toMatchObject({ action: "deny" });
  for (const method of ["command/exec/write", "command/exec/terminate", "command/exec/resize"]) {
    expect(interceptSaVmRequest(method, { processId: "p" }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() })).toMatchObject({
      action: "deny",
      reason: "direct host command execution is disabled in SA-VM mode; use sa_vm_run"
    });
  }
  const mixedPowerShell = interceptSaVmRequest("thread/shellCommand", {
    command: String.raw`(cd E:\\projects\\sla\\sa_plugin_sla; rg -n "fn asyncStateSize|asyncStateSize\\(" src/lowering_rules.zig src/codegen.zig | Select-Object -First 20)`
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(mixedPowerShell).toMatchObject({ action: "deny" });
});

test("enforces workspace filesystem boundaries for simulated tools", () => {
  const outside = interceptSaVmRequest("fs/readFile", { path: resolve(workspace, "..", "secret.txt") }, { cwd: workspace });
  expect(outside).toMatchObject({ action: "deny" });
  const inside = interceptSaVmRequest("fs/writeFile", { path: join(workspace, "output.json") }, { cwd: workspace });
  expect(inside).toMatchObject({ action: "allow", reason: "policy-allowed" });
  const copyOutside = interceptSaVmRequest("fs/copy", {
    sourcePath: join(workspace, "input.txt"),
    destinationPath: resolve(workspace, "..", "outside.txt")
  }, { cwd: workspace });
  expect(copyOutside).toMatchObject({ action: "deny" });
  const renameOutside = interceptSaVmRequest("fs/rename", {
    source: join(workspace, "input.txt"),
    destination: resolve(workspace, "..", "outside.txt")
  }, { cwd: workspace });
  expect(renameOutside).toMatchObject({ action: "deny" });
  expect(interceptSaVmRequest("fuzzyFileSearch", { query: "*.ts", roots: [workspace] }, { cwd: workspace })).toMatchObject({ action: "allow" });
  expect(interceptSaVmRequest("fuzzyFileSearch", { query: "*.ts", roots: [resolve(workspace, "..", "outside")] }, { cwd: workspace })).toMatchObject({ action: "deny" });
});

test("accepts relative file and directory paths under the thread workspace", () => {
  expect(interceptSaVmRequest("fs/readFile", { path: "src/config.ts" }, { cwd: workspace })).toMatchObject({ action: "allow" });
  expect(interceptSaVmRequest("fs/readDirectory", { path: "src" }, { cwd: workspace })).toMatchObject({ action: "allow" });
  expect(interceptSaVmRequest("fs/writeFile", { path: "generated/report.txt" }, { cwd: workspace })).toMatchObject({ action: "allow" });
  expect(interceptSaVmRequest("fs/createDirectory", { path: "generated/reports" }, { cwd: workspace })).toMatchObject({ action: "allow" });
  expect(interceptSaVmRequest("fs/readFile", { path: "../outside.txt" }, { cwd: workspace })).toMatchObject({ action: "deny" });
});

test("denies remote git diffs without explicit VM approval", () => {
  expect(interceptSaVmRequest("gitDiffToRemote", { cwd: workspace }, { cwd: workspace })).toMatchObject({ action: "deny" });
});

test("denies native file-patch approvals without explicit VM approval", () => {
  expect(interceptSaVmRequest("applyPatchApproval", { callId: "patch-1", fileChanges: {} }, { cwd: workspace })).toMatchObject({ action: "deny" });
  expect(interceptSaVmRequest("item/fileChange/requestApproval", { path: join(workspace, "safe.txt") }, { cwd: workspace })).toMatchObject({ action: "deny" });
  expect(interceptSaVmRequest("item/fileChange/requestApproval", { path: resolve(workspace, "..", "outside.txt") }, { cwd: workspace })).toMatchObject({ action: "deny" });
});

test("does not allow arbitrary MCP host execution in VM mode", () => {
  expect(interceptSaVmRequest("mcpServer/tool/call", { server: "filesystem", tool: "read_file" }, { cwd: workspace })).toMatchObject({ action: "deny" });
  expect(interceptSaVmRequest("mcpServer/resource/read", { server: "filesystem", uri: "file:///outside" }, { cwd: workspace })).toMatchObject({ action: "deny" });
});

test("enforces trusted HTTPS network policy while preserving Web Search", () => {
  const policy = { http: { allow: [{ host: "api.example.com", methods: ["GET"], paths: ["/v1/**"] }] } };
  const untrusted = interceptSaVmRequest("network/request", { url: "https://untrusted.example/api" }, { cwd: workspace, policy });
  expect(untrusted).toMatchObject({ action: "deny" });
  const trusted = interceptSaVmRequest("fetch", { url: "https://api.example.com/v1/data", method: "GET" }, { cwd: workspace, policy });
  expect(trusted).toMatchObject({ action: "allow", reason: "policy-allowed" });
  const search = interceptSaVmRequest("network/request", { query: "web search official SA-VM documentation" }, { cwd: workspace, policy });
  expect(search).toMatchObject({ action: "allow", reason: "web-search-bypass" });
});

test("returns simulated tool output through the SA-VM result contract", async () => {
  const executable = join(runtimeRoot, "sa.exe");
  const plugin = join(runtimeRoot, "vm.dll");
  const stdDir = join(runtimeRoot, "sa_std");
  if (!(await Bun.file(executable).exists()) || !(await Bun.file(plugin).exists()) || !(await Bun.file(stdDir).exists())) return;
  if (process.env.CODEX_UI_SA_VM_LIVE_TESTS !== "1") return;
  const previous = {
    bin: process.env.CODEX_UI_SA_VM_BIN,
    plugins: process.env.CODEX_UI_SA_VM_PLUGINS_PATH,
    std: process.env.CODEX_UI_SA_VM_STD_DIR
  };
  try {
    process.env.CODEX_UI_SA_VM_BIN = executable;
    process.env.CODEX_UI_SA_VM_PLUGINS_PATH = plugin;
    process.env.CODEX_UI_SA_VM_STD_DIR = stdDir;
    const result = await runSaVmTool({
      source: '@import "sa_std/io/print.sai"\n\n@const MSG = utf8:"intercepted-via-vm\n"\n\n@main() -> i32:\nL_ENTRY:\n    call @sa_print_bytes(&MSG, 19)\n    return 0\n',
      cwd: workspace,
      policy: createDefaultSaVmPolicyConfig()
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("success");
    expect(result.stdout).toContain("intercepted-via-vm");
    expect(result.saVmEvents.some((event) => event.event === "start")).toBe(true);
  } finally {
    restoreEnv("CODEX_UI_SA_VM_BIN", previous.bin);
    restoreEnv("CODEX_UI_SA_VM_PLUGINS_PATH", previous.plugins);
    restoreEnv("CODEX_UI_SA_VM_STD_DIR", previous.std);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("intercepts bun, bunx and shell-wrapped bun commands as bun language", () => {
  for (const cmd of [
    ["bun", "-e", "console.log('hi')"],
    ["bunx", "prettier", "--check", "."]
  ]) {
    const decision = interceptSaVmRequest("command/exec", { command: cmd }, {
      cwd: workspace,
      policy: createDefaultSaVmPolicyConfig()
    });
    expect(decision.action).toBe("require_sa_vm");
    if (decision.action === "require_sa_vm") {
      expect(decision.request.language).toBe("bun");
    }
  }

  for (const shellCmd of [
    ["bash", "-c", "bun -e \"console.log('escape')\""],
    ["cmd.exe", "/c", "bun run start"]
  ]) {
    const decision = interceptSaVmRequest("thread/shellCommand", { command: shellCmd }, {
      cwd: workspace,
      policy: createDefaultSaVmPolicyConfig()
    });
    expect(decision.action).toBe("require_sa_vm");
    if (decision.action === "require_sa_vm") {
      expect(decision.request.language).toBe("bun");
    }
  }

  for (const tool of ["run_bun", "exec_bun", "bun"]) {
    const decision = interceptSaVmRequest("item/tool/call", { tool }, {
      cwd: workspace,
      policy: createDefaultSaVmPolicyConfig()
    });
    expect(decision.action).toBe("require_sa_vm");
    if (decision.action === "require_sa_vm") {
      expect(decision.request.language).toBe("bun");
    }
  }
});

test("intercepts deno, tsx, npx and shell-wrapped JS commands as javascript language", () => {
  for (const cmd of [
    ["deno", "run", "main.ts"],
    ["ts-node", "index.ts"],
    ["tsx", "src/server.ts"],
    ["npx", "jest"]
  ]) {
    const decision = interceptSaVmRequest("command/exec", { command: cmd }, {
      cwd: workspace,
      policy: createDefaultSaVmPolicyConfig()
    });
    expect(decision.action).toBe("require_sa_vm");
    if (decision.action === "require_sa_vm") {
      expect(decision.request.language).toBe("javascript");
    }
  }

  for (const shellCmd of [
    ["sh", "-c", "node -e 'process.exit(0)'"],
    ["powershell.exe", "-Command", "node -e 'console.log(1)'"]
  ]) {
    const decision = interceptSaVmRequest("thread/shellCommand", { command: shellCmd }, {
      cwd: workspace,
      policy: createDefaultSaVmPolicyConfig()
    });
    expect(decision.action).toBe("require_sa_vm");
    if (decision.action === "require_sa_vm") {
      expect(decision.request.language).toBe("javascript");
    }
  }

  for (const tool of ["run_js", "exec_js", "node", "javascript", "js"]) {
    const decision = interceptSaVmRequest("item/tool/call", { tool }, {
      cwd: workspace,
      policy: createDefaultSaVmPolicyConfig()
    });
    expect(decision.action).toBe("require_sa_vm");
    if (decision.action === "require_sa_vm") {
      expect(decision.request.language).toBe("javascript");
    }
  }
});

test("detects and denies prohibited PowerShell anti-patterns with actionable sa_vm_run guidance", () => {
  // 1. Format-Table
  const ft = interceptSaVmRequest("thread/shellCommand", {
    command: "Get-ChildItem bin | Select Name | Format-Table -AutoSize"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(ft.action).toBe("deny");
  if (ft.action === "deny") {
    expect(ft.reason).toContain("Format-* / Out-String formatting is prohibited");
    expect(ft.reason).toContain("list_dir");
  }

  // 2. Select-String
  const ss = interceptSaVmRequest("command/exec", {
    command: "Get-Content future.sa | Select-String 'defer_ready'"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(ss.action).toBe("deny");
  if (ss.action === "deny") {
    expect(ss.reason).toContain("Select-String pipeline search is prohibited");
    expect(ss.reason).toContain("grep_search");
  }

  // 3. Select -First / Select-Object -First
  const sf = interceptSaVmRequest("thread/shellCommand", {
    command: "Get-Content big.log | Select -First 200"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(sf.action).toBe("deny");
  if (sf.action === "deny") {
    expect(sf.reason).toContain("Select -First/-Last line truncation via shell is prohibited");
    expect(sf.reason).toContain("read_lines");
  }

  // 4. -ErrorAction SilentlyContinue
  const sc = interceptSaVmRequest("thread/shellCommand", {
    command: "Get-ChildItem -Path C:\\secret -ErrorAction SilentlyContinue"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(sc.action).toBe("deny");
  if (sc.action === "deny") {
    expect(sc.reason).toContain("-ErrorAction SilentlyContinue is prohibited");
    expect(sc.reason).toContain("test_path");
  }

  // 5. 2>$null and | Out-Host
  const oh = interceptSaVmRequest("thread/shellCommand", {
    command: "& sa.exe compile test.sla 2>&1 | Out-Host"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(oh.action).toBe("deny");
  if (oh.action === "deny") {
    expect(oh.reason).toContain("Shell error suppression");
  }

  // 6. Set-Content pipe
  const setc = interceptSaVmRequest("thread/shellCommand", {
    command: "'hello' | Set-Content -Path test.txt -Encoding UTF8"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(setc.action).toBe("deny");
  if (setc.action === "deny") {
    expect(setc.reason).toContain("Set-Content / Out-File is prohibited");
    expect(setc.reason).toContain("write_file");
  }

  // 7. Chained commands with ';' combining write/read
  const chain = interceptSaVmRequest("thread/shellCommand", {
    command: "Set-Content -Path a.txt 'x'; & sa.exe compile a.txt; Get-Content a.disasm | Select -First 30"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(chain.action).toBe("deny");
  if (chain.action === "deny") {
    expect(chain.reason).toContain("Chaining multiple commands with ';' combining file operations and execution is prohibited");
  }

  // 8. cd / Set-Location / pushd prefix
  const cdCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'cd E:\\projects\\sla\\sa_plugin_sla && & "zig-out\\bin\\sla.exe" test'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(cdCmd.action).toBe("deny");
  if (cdCmd.action === "deny") {
    expect(cdCmd.reason).toContain("Manual directory changing via 'cd' / 'Set-Location' / 'pushd' is prohibited");
  }

  // 9. Naked Get-ChildItem / ls / dir
  const gciCmd = interceptSaVmRequest("thread/shellCommand", {
    command: "Get-ChildItem tests/*.sla | Select Name"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(gciCmd.action).toBe("deny");
  if (gciCmd.action === "deny") {
    expect(gciCmd.reason).toContain("Directory enumeration via 'Get-ChildItem' / 'gci' / 'dir' / 'ls' is prohibited");
    expect(gciCmd.reason).toContain("list_dir");
  }

  // 10. Naked Get-Content / cat / type
  const gcCmd = interceptSaVmRequest("thread/shellCommand", {
    command: "Get-Content .tmp_three_v4.disasm.sa"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(gcCmd.action).toBe("deny");
  if (gcCmd.action === "deny") {
    expect(gcCmd.reason).toContain("Direct file reading via 'Get-Content' / 'gc' / 'cat' / 'type' is prohibited");
    expect(gcCmd.reason).toContain("read_lines");
  }

  // 11. vm-read
  const vmReadCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'vm-read("src/main.ts")'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(vmReadCmd.action).toBe("deny");
  if (vmReadCmd.action === "deny") {
    expect(vmReadCmd.reason).toContain("Tool 'vm-read' does not exist");
    expect(vmReadCmd.reason).toContain("read_lines");
  }

  // 12. rg / grep
  const rgCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'rg -n "stage_match" src/'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(rgCmd.action).toBe("deny");
  if (rgCmd.action === "deny") {
    expect(rgCmd.reason).toContain("Direct text search via 'rg' / 'grep'");
    expect(rgCmd.reason).toContain("grep_search");
  }

  // 13. Get-Process
  const psCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'Get-Process | Where-Object { $_.ProcessName -match "zig" }'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(psCmd.action).toBe("deny");
  if (psCmd.action === "deny") {
    expect(psCmd.reason).toContain("Process inspection via 'Get-Process' / 'ps' is prohibited");
  }

  // 14. Get-Date
  const dateCmd = interceptSaVmRequest("thread/shellCommand", {
    command: "Get-Date"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(dateCmd.action).toBe("deny");
  if (dateCmd.action === "deny") {
    expect(dateCmd.reason).toContain("'Get-Date' / 'date' terminal invocation is unnecessary noise");
  }

  // 15. Shell-prefixed forms (argv join: "powershell -Command ...")
  const shellPrefixed = interceptSaVmRequest("thread/shellCommand", {
    command: ["powershell.exe", "-NoProfile", "-Command", "Get-ChildItem -Path E:\\projects\\sla -Force | Select-Object Name, Mode"]
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(shellPrefixed.action).toBe("deny");
  if (shellPrefixed.action === "deny") {
    expect(shellPrefixed.reason).toContain("Get-ChildItem");
  }

  // 16. Test-Path existence probe + quoted 2>$null variants
  const testPathCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'cd E:\\projects\\sla\\sa_plugin_sla; if (Test-Path .\\zig-out\\bin\\sla-local-cli.exe) { Write-Output "exists" } else { Write-Output "no" }'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(testPathCmd.action).toBe("deny");
  const quotedNullCmd = interceptSaVmRequest("thread/shellCommand", {
    command: '"cd E:\\projects\\sla\\sa_plugin_sla; ls zig-out/bin 2>$null; ls .zig-cache 2>$null | Select-Object -First 5"'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(quotedNullCmd.action).toBe("deny");
  const quotedHelpCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'cd E:\\projects\\sla\\sa_plugin_sla; .\\zig-out\\bin\\sla.exe --help 2>"$null" | Select-Object -First 30'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(quotedHelpCmd.action).toBe("deny");

  // 17. PowerShell for-loop instruction counter (Get-Content + for + Write-Host)
  const forLoopCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'powershell -Command "$lines = Get-Content \'E:\\projects\\sla\\sa_plugin_sla\\tests\\x.disasm.sa\'; $count = 0; for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match \'func_decl\') { $count++ } }"'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(forLoopCmd.action).toBe("deny");

  // 18. cmd-style batch loop and foreach alias
  const batchCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'for %f in (*.zig) do findstr "LinearAwait" %f'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(batchCmd.action).toBe("deny");
  if (batchCmd.action === "deny") {
    expect(batchCmd.reason).toContain("Batch loops via 'for / foreach / ForEach-Object' are prohibited");
  }
  const foreachCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'Get-ChildItem *.log | ForEach-Object { $_.Name }'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(foreachCmd.action).toBe("deny");
  if (foreachCmd.action === "deny") {
    expect(foreachCmd.reason).toContain("Batch loops via 'for / foreach / ForEach-Object' are prohibited");
  }

  // 19. Here-string wrapped read-loop must hit the for-loop rule, not the write rule
  const hereReadCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'powershell -Command @\' $lines = Get-Content \'E:\\x.disasm.sa\' $count = 0 for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match \'^\\s+br \') { $count++ } } \'@'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(hereReadCmd.action).toBe("deny");
  if (hereReadCmd.action === "deny") {
    expect(hereReadCmd.reason).toContain("Batch loops via 'for / foreach / ForEach-Object' are prohibited");
  }

  // 20. Direct findstr text search
  const findstrCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'findstr /s /i "LinearAwait" src\\*.zig'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(findstrCmd.action).toBe("deny");
  if (findstrCmd.action === "deny") {
    expect(findstrCmd.reason).toContain("findstr");
  }

  // 21. for loop without space after 'for'
  const compactForCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'for($i=0; $i -lt 10; $i++) { echo $i }'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(compactForCmd.action).toBe("deny");
  if (compactForCmd.action === "deny") {
    expect(compactForCmd.reason).toContain("Batch loops via 'for / foreach / ForEach-Object' are prohibited");
  }

  // 22. for-in loop across files
  const forInCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'for f in *.zig; do echo $f; done'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(forInCmd.action).toBe("deny");
  if (forInCmd.action === "deny") {
    expect(forInCmd.reason).toContain("Batch loops via 'for / foreach / ForEach-Object' are prohibited");
  }

  // 23. PowerShell % alias for ForEach-Object
  const percentLoopCmd = interceptSaVmRequest("thread/shellCommand", {
    command: 'zig targets | % { $_ }'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(percentLoopCmd.action).toBe("deny");
  if (percentLoopCmd.action === "deny") {
    expect(percentLoopCmd.reason).toContain("Batch loops via 'for / foreach / ForEach-Object' are prohibited");
  }

  // 24. cmd >nul and PowerShell *>$null error suppression
  const cmdNul = interceptSaVmRequest("thread/shellCommand", {
    command: 'sla.exe --help >nul 2>&1'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(cmdNul.action).toBe("deny");
  if (cmdNul.action === "deny") {
    expect(cmdNul.reason).toContain("Shell error suppression");
  }
  const starNull = interceptSaVmRequest("thread/shellCommand", {
    command: 'sla.exe test foo.sla *> $null'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(starNull.action).toBe("deny");
  if (starNull.action === "deny") {
    expect(starNull.reason).toContain("Shell error suppression");
  }

  // 25. Where-Object and pipeline filtering (? / Where / Where {})
  for (const cmd of [
    "Where-Object Name -Match 'xyz'",
    "ls | Where { $_.Name -eq 'test' }",
    "items | ? { $_.Length -gt 1MB }",
    "Where { $_.Length -gt 1MB }"
  ]) {
    const res = interceptSaVmRequest("thread/shellCommand", { command: cmd }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain("Where-Object / Where / ?");
      expect(res.reason).toContain("find_files");
      expect(res.reason).toContain("grep_search");
    }
  }

  // 26. which and where.exe binary locator commands
  for (const cmd of [
    "where sa",
    "where.exe sa.exe",
    "which zig",
    "where /R C:\\ zig.exe"
  ]) {
    const res = interceptSaVmRequest("thread/shellCommand", { command: cmd }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain("which / where.exe");
      expect(res.reason).toContain("run_host");
    }
  }

  // 26b. cmd /c wrapped where / which commands trigger cmd /c or which/where
  for (const cmd of [
    "cmd /c where sla",
    "cmd.exe /c which zig"
  ]) {
    const res = interceptSaVmRequest("thread/shellCommand", { command: cmd }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain("cmd /c");
    }
  }

  // 27. Order and precedence: Get-Process and Get-ChildItem take precedence over Where-Object
  const procWhere = interceptSaVmRequest("thread/shellCommand", {
    command: 'Get-Process | Where-Object { $_.ProcessName -match "zig" }'
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(procWhere.action).toBe("deny");
  if (procWhere.action === "deny") {
    expect(procWhere.reason).toContain("Get-Process");
  }

  const gciWhere = interceptSaVmRequest("thread/shellCommand", {
    command: "Get-ChildItem | Where-Object Name -Match 'xyz'"
  }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
  expect(gciWhere.action).toBe("deny");
  if (gciWhere.action === "deny") {
    expect(gciWhere.reason).toContain("Get-ChildItem");
  }

  // 28b. Unix find traversal and head/tail truncation
  for (const cmd of [
    'find . -name "future.sa" -not -path "*/.sla*"',
    'find tests -iname "*.sla" -type f',
    'find . -path "*/src/*" -exec echo {} \\;',
    'find . -name "future.sa" | head -20',
    'tail -n 30 build.log',
    'cat build.log | tail -20'
  ]) {
    const res = interceptSaVmRequest("thread/shellCommand", { command: cmd }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toContain(cmd.includes("find ") ? "find_files" : "head");
    }
  }

  for (const cmd of [
    'find "text" file.txt',
    'where is the file',
    'headless --version'
  ]) {
    expect(detectPowerShellAntiPattern(cmd)).toBeNull();
  }

  // 28. Negative exclusions: conversational English, variables, and ternary operators should NOT trigger anti-pattern
  for (const cmd of [
    "where is the file",
    "where are the logs",
    "$where = 1",
    "$where.Length",
    "items.where(x => x > 0)",
    "where the output is located",
    "const x = a ? b : c",
    "echo 1 | my_tool -e 'a ? b : c'",
    "val = a | ? b : c",
    "flags | ? true : false",
    "isReady ? proceed() : stop()"
  ]) {
    expect(detectPowerShellAntiPattern(cmd)).toBeNull();
    const res = interceptSaVmRequest("thread/shellCommand", { command: cmd }, { cwd: workspace, policy: createDefaultSaVmPolicyConfig() });
    expect(res.action).toBe("deny");
    if (res.action === "deny") {
      expect(res.reason).toBe("direct host command execution is disabled in SA-VM mode; use sa_vm_run");
      expect(res.reason).not.toContain("which / where.exe");
      expect(res.reason).not.toContain("Where-Object");
    }
  }

  expect(detectPowerShellAntiPattern("node -e 'console.log(a ? b : c)'")).toBeNull();
});


