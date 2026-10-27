import { expect, test } from "bun:test";
import { buildSaVmWorkspaceSkillMarkdown } from "../../apps/server/src/saVmWorkspaceSkill";

test("bun+TS track section is present when script execution is enabled", () => {
  const markdown = buildSaVmWorkspaceSkillMarkdown({
    enabled: true,
    policy: {
      execution: { javascript: true, python: false }
    }
  });

  expect(markdown).toContain("双轨执行路由与 bun+TS 编程规范 (Dual-Track Routing & bun+TS Guide)");
  expect(markdown).toContain("轨道 2，写受限 TS 代码");
  expect(markdown).toContain("Use packaged native function tools");
  expect(markdown).toContain("or restricted TS scripts (bun)");
});

test("FR-1: locks down the 4 routing decision tree rules", () => {
  const markdown = buildSaVmWorkspaceSkillMarkdown({ enabled: true });

  // Rule 1: Single file single-step -> Track 1
  expect(markdown).toContain("单文件单步（读/写/改/查/搜/补丁）");
  expect(markdown).toContain("轨道 1，只调封装动作");

  // Rule 2: Multi-file, loops, branching -> Track 2 (restricted TS via bun)
  expect(markdown).toContain("跨文件多步、有循环分支、需中间计算（批量改名、扫描统计、批量格式处理）");
  expect(markdown).toContain("轨道 2，写受限 TS 代码");
  expect(markdown).toContain("单次调用须能替代 3 次以上单步动作");
  expect(markdown).toContain("纯内容写入多文件（如多语言翻译、批量配置更新、大文本替换）属于内容搬运而非计算，严禁手写 TS，必须使用顶层 `parallel` 批处理动作");

  // bun+TS migration table (FR-3)
  expect(markdown).toContain("bun+TS 心智迁移对照");
  expect(markdown).toContain("顶层 `parallel` 一次调用");
  expect(markdown).toContain("大文本搬运与字面量拼接");

  // Rule 3: Process, non-whitelisted net, npm -> Neither track
  expect(markdown).toContain("需外部进程、非白名单网络、npm 生态能力");
  expect(markdown).toContain("两轨都不许，直接向用户声明超出 VM 能力");

  // Rule 4: 3 run failures -> Force fallback to Track 1
  expect(markdown).toContain("同一任务 TS 运行失败 3 次");
  expect(markdown).toContain("强制降级为轨道 1，分步执行，不许第 4 次重试");
});

test("FR-7: locks down the safety equivalence declaration", () => {
  const markdown = buildSaVmWorkspaceSkillMarkdown({ enabled: true });

  expect(markdown).toContain("安全等价声明");
  expect(markdown).toContain("自己编写的 TS 与封装动作走同一套 broker policy");
  expect(markdown).toContain("越界路径、非白名单网络/环境/进程一律拒绝并审计");
  expect(markdown).toContain("手写代码不带来任何额外特权");
});

test("FR-4: locks down all 6 forbidden zone items and rewrites", () => {
  const markdown = buildSaVmWorkspaceSkillMarkdown({ enabled: true });

  expect(markdown).toContain("TS 编写禁区清单");

  // Item 1: big-text inline / multi-file content moving
  expect(markdown).toContain("禁大文本内联与多文件内容搬运");
  expect(markdown).toContain("改用顶层 `parallel` 批处理动作");

  // Item 2: process spawn / external net
  expect(markdown).toContain("禁进程外溢与外部网络");
  expect(markdown).toContain("外部二进制走 `run_host` 白名单");

  // Item 3: CommonJS require
  expect(markdown).toContain("禁 CommonJS require");
  expect(markdown).toContain("统一使用 ESM `import`");

  // Item 4: long sync blocking / infinite loops
  expect(markdown).toContain("禁超长同步阻塞与死循环");
  expect(markdown).toContain("遵守 deadline 超时");

  // Item 5: undeclared env reads
  expect(markdown).toContain("禁未声明的环境变量读取");
  expect(markdown).toContain("按 `requested_caps.env` 显式声明");

  // Item 6: absolute paths outside workspace
  expect(markdown).toContain("禁工作区外的绝对路径读写");
  expect(markdown).toContain("全部使用工作区内相对路径");
});

test("FR-2 & FR-3: locks down allowed subset and module allowlist while forbidding process and net", () => {
  const markdown = buildSaVmWorkspaceSkillMarkdown({ enabled: true });

  // Entry point
  expect(markdown).toContain("export async function main(): Promise<number>");

  // Syntax elements
  expect(markdown).toContain("`let` / `const`");
  expect(markdown).toContain("`if/else`");
  expect(markdown).toContain("`for` / `while` 循环");
  expect(markdown).toContain("`break` / `continue`");
  expect(markdown).toContain("`try/catch`");
  expect(markdown).toContain("`async` / `await`");
  expect(markdown).toContain("`switch`");

  // Allow-listed modules
  expect(markdown).toContain("`console`");
  expect(markdown).toContain("`Bun.file`");
  expect(markdown).toContain("`Bun.write`");
  expect(markdown).toContain("`node:fs/promises`");

  // Forbidden process/net escapes
  expect(markdown).toContain("`Bun.spawn`");
  expect(markdown).toContain("`child_process`");
  expect(markdown).toContain("`http_fetch`");
  expect(markdown).not.toContain("dist/index.html");

  // Verified mapping patterns (FR-5)
  expect(markdown).toContain("常见任务到 TS 对照模式");
  expect(markdown).toContain("调试输出与字符串拼接");
  expect(markdown).toContain("demos/bun-ts/01_hello_world/main.ts");
  expect(markdown).toContain("for 循环与累加");
  expect(markdown).toContain("demos/bun-ts/02_mutability/main.ts");
  expect(markdown).toContain("字符串操作（长度、判等与拼接）");
  expect(markdown).toContain("读整文件（已验证）");
  expect(markdown).toContain("Bun.file(path).text()");
  expect(markdown).toContain("写文件（已验证）");
  expect(markdown).toContain("Bun.write(path, content)");
  expect(markdown).toContain("目录遍历（已验证）");
  expect(markdown).toContain("readdir(dir)");
  expect(markdown).toContain("错误处理与 try/catch（已验证）");
  expect(markdown).not.toContain("待 check 验证");
});

test("FR-6 & FR-8: locks down run-error loop cap and budget discipline", () => {
  const markdown = buildSaVmWorkspaceSkillMarkdown({ enabled: true });

  // FR-6: Run error diagnosis & 5 error types
  expect(markdown).toContain("运行报错闭环与常见错误自查 (FR-6)");
  expect(markdown).toContain("TS 类型/语法报错");
  expect(markdown).toContain("误用 Bun 专属 API");
  expect(markdown).toContain("未声明的环境/网络/进程调用");
  expect(markdown).toContain("大文本内联超限");
  expect(markdown).toContain("单文件自包含");
  expect(markdown).toContain("同一任务连续运行修错上限为 3 次");
  expect(markdown).toContain("强制降级为轨道 1");

  // FR-8: Budget discipline & deadline trip handling (with FR-2 selection tie-in)
  expect(markdown).toContain("预算纪律与熔断处理 (FR-8)");
  expect(markdown).toContain("代码体积软上限与大文本不进 source");
  expect(markdown).toContain("`source` 软上限为 8KB");
  expect(markdown).toContain("大文本字面量、长模板或多文件内容严禁内联写入 TS 源码");
  expect(markdown).toContain("必须走顶层 `parallel` 搭配 `edit_file` / `write_file` / `apply_patch`");
  expect(markdown).toContain("熔断不重试");
  expect(markdown).toContain("一次 TS 调用须至少替代 3 次以上封装动作调用");
});

test("gating: bun+TS track is present when JS or Python execution is enabled", () => {
  // When JS is enabled, run_js is active and the bun+TS track guides TS via bun
  const markdownWithJs = buildSaVmWorkspaceSkillMarkdown({
    enabled: true,
    policy: {
      execution: { javascript: true, python: false }
    }
  });
  expect(markdownWithJs).toContain("run_js");
  expect(markdownWithJs).toContain("双轨执行路由与 bun+TS 编程规范");

  // When Python is enabled, run_py is active and the track section still applies
  const markdownWithPy = buildSaVmWorkspaceSkillMarkdown({
    enabled: true,
    policy: {
      execution: { javascript: false, python: true }
    }
  });
  expect(markdownWithPy).toContain("run_py");
  expect(markdownWithPy).toContain("双轨执行路由与 bun+TS 编程规范");
});

test("gating: bun+TS track is omitted when all script execution is disabled", () => {
  const markdown = buildSaVmWorkspaceSkillMarkdown({
    enabled: true,
    policy: {
      execution: { javascript: false, python: false }
    }
  });
  expect(markdown).not.toContain("双轨执行路由与 bun+TS 编程规范");
});

test("gating: bun+TS track is omitted when guard is disabled", () => {
  const markdownDisabled = buildSaVmWorkspaceSkillMarkdown({ enabled: false });
  expect(markdownDisabled).toContain("【安全守护状态：未开启】");
  expect(markdownDisabled).not.toContain("双轨执行路由与 bun+TS 编程规范");
});

test("non-functional: bun+TS track addition is strictly bounded within 150 lines", () => {
  const markdownWithTs = buildSaVmWorkspaceSkillMarkdown({ enabled: true });
  const match = markdownWithTs.match(/## \d+、双轨执行路由与 bun\+TS 编程规范[\s\S]*?(?=\n## \d+、|$)/);
  expect(match).toBeTruthy();
  const tsLines = match![0].split(/\r?\n/).length;

  // The TS track section addition must be within 150 lines
  expect(tsLines).toBeLessThanOrEqual(150);
  expect(tsLines).toBeGreaterThan(30);
});
