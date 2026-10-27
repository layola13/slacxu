import { describe, expect, test } from "bun:test";
import {
  MAX_MINI_AUTO_CONTINUE_ROUNDS,
  MINI_ACTION_MANDATE_RULE,
  MINI_AUTO_CONTINUE_NOTE,
  MINI_CODE_INTENT_RE,
  MINI_FIRST_ACTION_NOTE,
  MINI_NO_CHANGE_NEEDED_RE,
  MINI_WRITE_HINT_RE,
  miniPromptRefsPriorWork,
  miniPromptWantsWrite,
} from "../../backends/mini/src/runtime/miniBridge.ts";
import { isMiniContinuationNudge } from "../../apps/server/src/goalContinuation.ts";

describe("mini write-intent vocabulary (改进/解决/搞定不再漏网)", () => {
  test("改进类动词命中写意图", () => {
    expect(MINI_WRITE_HINT_RE.test("改进这个demo")).toBe(true);
    expect(MINI_WRITE_HINT_RE.test("把这个缺陷解决一下")).toBe(true);
    expect(MINI_WRITE_HINT_RE.test("搞定这个bug")).toBe(true);
    expect(MINI_WRITE_HINT_RE.test("完善错误处理")).toBe(true);
    expect(MINI_WRITE_HINT_RE.test("动手修一下")).toBe(true);
  });

  test("代码写作对象命中, 创意写作不命中", () => {
    expect(MINI_WRITE_HINT_RE.test("帮我写个函数")).toBe(true);
    expect(MINI_WRITE_HINT_RE.test("写一段测试代码")).toBe(true);
    expect(MINI_WRITE_HINT_RE.test("写一首诗")).toBe(false);
    expect(MINI_WRITE_HINT_RE.test("写篇小说")).toBe(false);
  });
});

describe("mini code-intent patterns (我直接动手修 Demo 不再漏网)", () => {
  test("detects glue-word intent narration", () => {
    expect(MINI_CODE_INTENT_RE.test("我直接动手修 Demo")).toBe(true);
    expect(MINI_CODE_INTENT_RE.test("JEV 已裁决：先修玩法致命缺陷。我直接动手修 Demo。")).toBe(true);
    expect(MINI_CODE_INTENT_RE.test("这就改")).toBe(true);
    expect(MINI_CODE_INTENT_RE.test("直接动手")).toBe(true);
  });

  test("still ignores plain summaries", () => {
    expect(MINI_CODE_INTENT_RE.test("改动已完成，总结如下")).toBe(false);
    expect(MINI_CODE_INTENT_RE.test("Done: all steps completed.")).toBe(false);
  });
});

describe("continuation nudges inherit write intent (继续/你调用啊不再失灵)", () => {
  test("承接词被识别为 continuation", () => {
    for (const nudge of ["继续", "你调用啊", "做吧", "动手吧", "开始吧", "按计划", "go ahead", "do it"]) {
      expect(isMiniContinuationNudge(nudge)).toBe(true);
    }
  });

  test("普通提问不是 continuation", () => {
    expect(isMiniContinuationNudge("这个函数是做什么的")).toBe(false);
    expect(isMiniContinuationNudge("改进这个demo")).toBe(false);
  });

  test("continuation 继承写意图", () => {
    expect(miniPromptWantsWrite("继续", { isContinuationNudge: true, isContinuationTurn: false })).toBe(true);
    expect(miniPromptWantsWrite("你调用啊", { isContinuationNudge: true, isContinuationTurn: false })).toBe(true);
    expect(miniPromptWantsWrite("改进这个demo", {})).toBe(true);
    expect(miniPromptWantsWrite("这个函数是做什么的", {})).toBe(false);
  });
});

describe("prior-work reference (把剩下的做完继承checklist, 新任务隔离)", () => {
  test("引用先前未完成工作的 prompt 被识别", () => {
    for (const p of ["把剩下的做完", "继续把它搞定", "收尾一下", "还有剩余的工作", "未完成的部分继续"]) {
      expect(miniPromptRefsPriorWork(p)).toBe(true);
    }
  });

  test("全新任务与普通提问不继承", () => {
    expect(miniPromptRefsPriorWork("Task 2: completely new task")).toBe(false);
    expect(miniPromptRefsPriorWork("这个函数是做什么的")).toBe(false);
    expect(miniPromptRefsPriorWork("")).toBe(false);
  });
});

describe("auto-continue brakes (该停要停)", () => {
  test("完工/无需改动声明被识别", () => {
    expect(MINI_NO_CHANGE_NEEDED_RE.test("经检查，不需要改动")).toBe(true);
    expect(MINI_NO_CHANGE_NEEDED_RE.test("No change needed")).toBe(true);
    expect(MINI_NO_CHANGE_NEEDED_RE.test("无需修复，已确认")).toBe(true);
    expect(MINI_NO_CHANGE_NEEDED_RE.test("我直接动手修 Demo")).toBe(false);
    expect(MINI_NO_CHANGE_NEEDED_RE.test("准备修改 A 文件")).toBe(false);
  });

  test("自动继续有界且有明确指令", () => {
    expect(MAX_MINI_AUTO_CONTINUE_ROUNDS).toBeGreaterThanOrEqual(1);
    expect(MAX_MINI_AUTO_CONTINUE_ROUNDS).toBeLessThanOrEqual(12); // 长任务续跑上限, 仍必须有界
    expect(MINI_AUTO_CONTINUE_NOTE).toContain("tool call");
  });
});

describe("OpenCode parity instructions and first action mandate", () => {
  test("MINI_FIRST_ACTION_NOTE commands concrete tool action without excuse loophole", () => {
    expect(MINI_FIRST_ACTION_NOTE).toContain("execute the next concrete sa_vm action");
    expect(MINI_FIRST_ACTION_NOTE).not.toContain("If execution is blocked");
  });

  test("MINI_ACTION_MANDATE_RULE enforces execution verification and completing work", () => {
    expect(MINI_ACTION_MANDATE_RULE).toContain("Verify correctness through execution");
    expect(MINI_ACTION_MANDATE_RULE).toContain("Work through the task or plan to completion");
  });
});
