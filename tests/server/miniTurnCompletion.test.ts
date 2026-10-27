import { describe, expect, test } from "bun:test";
import { miniDeclaresTurnComplete } from "../../backends/mini/src/runtime/miniBridge.ts";

describe("miniDeclaresTurnComplete", () => {
  test("accepts an explicit DONE marker as the final line", () => {
    expect(miniDeclaresTurnComplete("DONE: fixed the login redirect")).toBe(true);
    expect(miniDeclaresTurnComplete("Summary of changes...\nDONE: all requested edits applied")).toBe(true);
    expect(miniDeclaresTurnComplete("  DONE: done  ")).toBe(true);
  });

  test("accepts the Chinese marker with half/full-width colon", () => {
    expect(miniDeclaresTurnComplete("完成：修改了3个文件")).toBe(true);
    expect(miniDeclaresTurnComplete("完成: verified with tests")).toBe(true);
  });

  test("accepts case-insensitive DONE and Done markers", () => {
    expect(miniDeclaresTurnComplete("Done: fixed the login redirect")).toBe(true);
    expect(miniDeclaresTurnComplete("done: all tasks finished")).toBe(true);
  });

  test("accepts markdown-decorated markers (bold, bullet, header)", () => {
    expect(miniDeclaresTurnComplete("**DONE:** fixed the login redirect")).toBe(true);
    expect(miniDeclaresTurnComplete("**DONE**: all requested edits applied")).toBe(true);
    expect(miniDeclaresTurnComplete("**Done:** case-insensitive bold")).toBe(true);
    expect(miniDeclaresTurnComplete("- DONE: bullet item")).toBe(true);
    expect(miniDeclaresTurnComplete("* **DONE:** bullet with bold")).toBe(true);
    expect(miniDeclaresTurnComplete("### DONE: header style")).toBe(true);
    expect(miniDeclaresTurnComplete("**完成：**所有改动已应用")).toBe(true);
    expect(miniDeclaresTurnComplete("**完成**: 冒号在加粗外部")).toBe(true);
    expect(miniDeclaresTurnComplete("- 完成：列表中文")).toBe(true);
  });

  test("mid-answer mentions never end the turn", () => {
    expect(miniDeclaresTurnComplete("DONE: part one\nContinuing with part two")).toBe(false);
    expect(miniDeclaresTurnComplete("接下来完成剩余部分")).toBe(false);
    expect(miniDeclaresTurnComplete("完成：第一步\n接下来处理第二步")).toBe(false);
  });

  test("prose without the marker shape does not match", () => {
    expect(miniDeclaresTurnComplete("")).toBe(false);
    expect(miniDeclaresTurnComplete("任务已经完成")).toBe(false);
    expect(miniDeclaresTurnComplete("GOAL_DONE")).toBe(false);
    expect(miniDeclaresTurnComplete("UNDONE: still working")).toBe(false);
    expect(miniDeclaresTurnComplete("_UNDONE: still working")).toBe(false);
    expect(miniDeclaresTurnComplete("DONE_TASK: still running")).toBe(false);
  });

  test("marker check is orthogonal to the question gate", () => {
    // The `?` gate lives in the caller; the helper only reports the marker.
    expect(miniDeclaresTurnComplete("DONE: 还有问题吗?")).toBe(true);
  });
});
