import { describe, expect, it } from "bun:test";
import {
  isMiniSaVmToolName,
  miniBudgetExcuseCorrection,
  MINI_BUDGET_EXCUSE_RE,
  isMiniReadOnlyHostCommand,
  miniToolArgValidationError,
  miniRunHostShellOperator,
  normalizeSaVmArgs,
  parseCommandLineTokens,
  MINI_EFFICIENCY_RULE,
  MINI_SYSTEM_HEAD,
} from "../../backends/mini/src/runtime/miniBridge.js";
import {
  miniTaskEvasionCorrection,
} from "../../backends/mini/src/runtime/miniTaskIntent.js";

describe("Mini git log, command parsing, and host recovery", () => {
  it("rejects shell operators in run_host (argv-only, no shell)", () => {
    const chained = miniToolArgValidationError("sa_vm", { action: "run_host", command: "git log --oneline -3 && git status" });
    expect(chained).toContain('shell operator "&&"');
    const piped = miniToolArgValidationError("sa_vm", { action: "run_host", exe: "git", args: ["status", "|", "head", "-5"] });
    expect(piped).toContain('shell operator "|"');
    // Operator characters inside a single arg are not shell operators.
    expect(miniToolArgValidationError("sa_vm", { action: "run_host", exe: "git", args: ["grep", "-E", "a|b&&c", "--", "src"] })).toBeNull();
    expect(miniToolArgValidationError("sa_vm", { action: "run_host", command: "git log --format=%h;%s -3" })).toBeNull();
    expect(miniRunHostShellOperator(["git", "log", ">", "out.txt"])).toBe(">");
    expect(miniRunHostShellOperator(["node", "-e", "a && b"])).toBeNull();
  });

  it("parses command line tokens accurately with quotes and whitespace", () => {
    expect(parseCommandLineTokens("git log --oneline -10")).toEqual(["git", "log", "--oneline", "-10"]);
    expect(parseCommandLineTokens('git commit -m "feat: initial commit" --dry-run')).toEqual([
      "git", "commit", "-m", "feat: initial commit", "--dry-run"
    ]);
    expect(parseCommandLineTokens("echo 'hello world'")).toEqual(["echo", "hello world"]);
    expect(parseCommandLineTokens("")).toEqual([]);
    expect(parseCommandLineTokens("   ")).toEqual([]);
  });

  it("normalizes run_host command, exe with spaces, and bash/sh aliases", () => {
    // Single command string wrapper
    const fromCmd = normalizeSaVmArgs({ action: "run_host", command: "git log --oneline -10" });
    expect(fromCmd.action).toBe("run_host");
    expect(fromCmd.exe).toBe("git");
    expect(fromCmd.args).toEqual(["log", "--oneline", "-10"]);

    // bash / sh action alias mapped to run_host
    const fromBash = normalizeSaVmArgs({ action: "bash", command: "git status" });
    expect(fromBash.action).toBe("run_host");
    expect(fromBash.exe).toBe("git");
    expect(fromBash.args).toEqual(["status"]);

    const fromSh = normalizeSaVmArgs({ action: "sh", cmd: "git diff HEAD~1" });
    expect(fromSh.action).toBe("run_host");
    expect(fromSh.exe).toBe("git");
    expect(fromSh.args).toEqual(["diff", "HEAD~1"]);

    // Exe containing spaces when model puts whole command in exe
    const exeWithSpaces = normalizeSaVmArgs({ action: "run_host", exe: "git log --oneline -5" });
    expect(exeWithSpaces.exe).toBe("git");
    expect(exeWithSpaces.args).toEqual(["log", "--oneline", "-5"]);

    // Exe + string args
    const stringArgs = normalizeSaVmArgs({ action: "run_host", exe: "git", args: "log --oneline -10" });
    expect(stringArgs.exe).toBe("git");
    expect(stringArgs.args).toEqual(["log", "--oneline", "-10"]);

    // Binary in args[0] when exe is missing
    const binaryInArgs = normalizeSaVmArgs({ action: "run_host", args: ["git", "status"] });
    expect(binaryInArgs.exe).toBe("git");
    expect(binaryInArgs.args).toEqual(["status"]);
  });

  it("normalizes git_log tool name, aliases, and arguments", () => {
    // Top level git_log tool name
    const topLevel = normalizeSaVmArgs({ max_count: 5 }, "git_log");
    expect(topLevel.action).toBe("git_log");
    expect(topLevel.max_count).toBe(5);

    // Aliases limit / count
    const fromLimit = normalizeSaVmArgs({ action: "git_log", limit: "15" });
    expect(fromLimit.action).toBe("git_log");
    expect(fromLimit.max_count).toBe(15);

    // Args containing -n 7 or -5
    const fromArgsDashN = normalizeSaVmArgs({ action: "git_log", args: ["-n", "7"] });
    expect(fromArgsDashN.max_count).toBe(7);

    const fromArgsDashNum = normalizeSaVmArgs({ action: "git_log", args: ["-10"] });
    expect(fromArgsDashNum.max_count).toBe(10);

    // Args containing revision
    const fromArgsRev = normalizeSaVmArgs({ action: "git_log", args: ["-10", "HEAD~5"] });
    expect(fromArgsRev.max_count).toBe(10);
    expect(fromArgsRev.revision).toBe("HEAD~5");
  });

  it("recognizes git_log, run_host, and shell tools in isMiniSaVmToolName", () => {
    expect(isMiniSaVmToolName("git_log")).toBe(true);
    expect(isMiniSaVmToolName("git-log")).toBe(true);
    expect(isMiniSaVmToolName("git_status")).toBe(true);
    expect(isMiniSaVmToolName("git_diff")).toBe(true);
    expect(isMiniSaVmToolName("run_host")).toBe(true);
    expect(isMiniSaVmToolName("exec_host")).toBe(true);
    expect(isMiniSaVmToolName("bash")).toBe(true);
    expect(isMiniSaVmToolName("sh")).toBe(true);
    expect(isMiniSaVmToolName("sa_vm")).toBe(true);
  });

  it("validates run_host and gives precise retry hints when git has no args", () => {
    // Empty run_host
    const emptyErr = miniToolArgValidationError("sa_vm", { action: "run_host" });
    expect(emptyErr).toContain("sa_vm run_host needs");

    // git without args
    const gitNoArgsErr = miniToolArgValidationError("sa_vm", { action: "run_host", exe: "git" });
    expect(gitNoArgsErr).toContain('sa_vm run_host with exe:"git" requires a non-empty args array');
    expect(gitNoArgsErr).toContain("git_log");

    const gitEmptyArrayErr = miniToolArgValidationError("sa_vm", { action: "run_host", exe: "git", args: [] });
    expect(gitEmptyArrayErr).toContain('sa_vm run_host with exe:"git" requires a non-empty args array');

    // git with args is valid
    const gitWithArgs = miniToolArgValidationError("sa_vm", { action: "run_host", exe: "git", args: ["log", "--oneline", "-10"] });
    expect(gitWithArgs).toBeNull();

    // git with command string is valid
    const gitWithCmd = miniToolArgValidationError("sa_vm", { action: "run_host", command: "git log --oneline -10" });
    expect(gitWithCmd).toBeNull();

    const missingArgs = miniToolArgValidationError("sa_vm", { action: "run_host", exe: "bun" });
    expect(missingArgs).toContain('exe:"bun"');
    expect(missingArgs).toContain("non-empty args array");
    const stringArgs = miniToolArgValidationError("sa_vm", { action: "run_host", exe: "git", args: "log --oneline -10" });
    expect(stringArgs).toContain("non-empty args array");

    // git_log is valid with or without params
    expect(miniToolArgValidationError("sa_vm", { action: "git_log" })).toBeNull();
    expect(miniToolArgValidationError("sa_vm", { action: "git_log", max_count: 10 })).toBeNull();
  });

  it("counts only read-only host commands as exploration", () => {
    expect(isMiniReadOnlyHostCommand(normalizeSaVmArgs({ action: "run_host", command: "git log --oneline -10" }))).toBe(true);
    expect(isMiniReadOnlyHostCommand(normalizeSaVmArgs({ action: "run_host", exe: "git", args: ["status"] }))).toBe(true);
    expect(isMiniReadOnlyHostCommand(normalizeSaVmArgs({ action: "run_host", exe: "git", args: ["diff", "HEAD~1"] }))).toBe(true);
    expect(isMiniReadOnlyHostCommand(normalizeSaVmArgs({ action: "run_host", exe: "git", args: ["commit", "-m", "change"] }))).toBe(false);
    expect(isMiniReadOnlyHostCommand(normalizeSaVmArgs({ action: "run_host", exe: "bun", args: ["test"] }))).toBe(false);
    expect(isMiniReadOnlyHostCommand(normalizeSaVmArgs({ action: "run_host", exe: "node", args: ["script.js"] }))).toBe(false);
  });

  it("catches evasions and excuses like 'no active user task and tool execution paused'", () => {
    const evasionText = "Thinking: Reviewing tool outputs ... determine the actual user task\nWorkspace root verified ... Blocker: no active user task this turn and tool execution paused";
    expect(MINI_BUDGET_EXCUSE_RE.test(evasionText)).toBe(true);

    const budgetCorrection = miniBudgetExcuseCorrection(evasionText, { hasToolCalls: true });
    expect(budgetCorrection).toContain("Answer the user directly using the information collected");

    const evasionCorrection = miniTaskEvasionCorrection(evasionText, {
      wantsWrite: false,
      hasPendingPlan: false,
      analysisOnly: true,
      hasWrite: false,
      hasToolCalls: true,
    });
    expect(evasionCorrection).toContain("You have already gathered relevant results from tools in this turn");
  });

  it("catches next-round deferral as evasion ('需下一轮继续')", () => {
    const deferral = "剩余阻塞：本轮已停止工具调用，未能进一步拉取 git diff/文件变更做逐个风险拆解，需下一轮继续。";
    const correction = miniTaskEvasionCorrection(deferral, {
      wantsWrite: false,
      hasPendingPlan: false,
      analysisOnly: true,
      hasWrite: false,
      hasToolCalls: true,
    });
    expect(correction).toContain("You have already gathered relevant results from tools in this turn");
  });

  it("treats git history probes as analysis evidence, not stall pressure", () => {
    expect(MINI_EFFICIENCY_RULE).toContain("Git log/status alone is NOT answerable for deep-analysis requests");
    expect(MINI_SYSTEM_HEAD).toContain("Deep-analysis requests");
  });

  it("instructs to stop as soon as answerable in system head and efficiency rule", () => {
    expect(MINI_SYSTEM_HEAD).toContain("Stop as soon as answerable");
    expect(MINI_SYSTEM_HEAD).toContain("For git history or code inquiry questions, answer directly once the relevant git outputs or files are retrieved");
    expect(MINI_EFFICIENCY_RULE).toContain("Stop as soon as answerable");
  });
});
