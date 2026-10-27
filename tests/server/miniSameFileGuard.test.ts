import { describe, expect, test } from "bun:test";
import {
  MINI_REFUSED_READ_PREFIX,
  MINI_SAME_FILE_READ_LIMIT,
  MiniSameFileReadGuard,
  isMiniSameFileReadAction,
} from "../../backends/mini/src/runtime/miniTurnSafety.ts";

function readRound(path: string, start: number, end: number, output = "content") {
  return { name: "sa_vm", args: { action: "read_lines", path, start_line: start, end_line: end }, output };
}

describe("MiniSameFileReadGuard pagination (长文件翻页不误杀)", () => {
  test("forward paging a 586-line file never trips the guard", () => {
    const g = new MiniSameFileReadGuard();
    expect(g.observeRound([readRound("index.html", 1, 250)], false)).toBeNull();
    expect(g.observeRound([readRound("index.html", 250, 500)], false)).toBeNull();
    expect(g.observeRound([readRound("index.html", 500, 586)], false)).toBeNull();
    // 即使继续翻页/多轮也不应触发
    expect(g.observeRound([readRound("index.html", 586, 800)], false)).toBeNull();
  });

  test("overlapping re-reads still trip after the limit", () => {
    const g = new MiniSameFileReadGuard();
    let hit: string | null = null;
    for (let i = 0; i < MINI_SAME_FILE_READ_LIMIT; i++) {
      hit = g.observeRound([readRound("a.ts", 1, 100)], false);
      expect(hit).toBeNull();
    }
    hit = g.observeRound([readRound("a.ts", 1, 100)], false);
    expect(hit).toBe("a.ts");
  });

  test("metadata probes do not count as thrash", () => {
    const g = new MiniSameFileReadGuard();
    for (let i = 0; i < MINI_SAME_FILE_READ_LIMIT + 2; i++) {
      const hit = g.observeRound([
        { name: "sa_vm", args: { action: "count_lines", path: "big.ts" }, output: "{}" },
        { name: "sa_vm", args: { action: "file_info", path: "big.ts" }, output: "{}" },
      ], false);
      expect(hit).toBeNull();
    }
    expect(isMiniSameFileReadAction("count_lines")).toBe(false);
    expect(isMiniSameFileReadAction("file_info")).toBe(false);
    expect(isMiniSameFileReadAction("read_lines")).toBe(true);
    expect(isMiniSameFileReadAction("read_file")).toBe(true);
  });

  test("refused-read outputs are not re-counted", () => {
    const g = new MiniSameFileReadGuard();
    for (let i = 0; i < MINI_SAME_FILE_READ_LIMIT + 1; i++) {
      g.observeRound([readRound("hot.ts", 10, 60)], false);
    }
    expect(g.observeRound([readRound("hot.ts", 10, 60)], false)).toBe("hot.ts");
    // 拒读回执不再叠加计数
    for (let i = 0; i < 3; i++) {
      const hit = g.observeRound([
        { name: "sa_vm", args: { action: "read_lines", path: "hot.ts", start_line: 10, end_line: 60 }, output: `${MINI_REFUSED_READ_PREFIX} (hot.ts): ...` },
      ], false);
      expect(hit).toBeNull();
    }
  });

  test("write progress resets the guard", () => {
    const g = new MiniSameFileReadGuard();
    for (let i = 0; i < MINI_SAME_FILE_READ_LIMIT; i++) {
      g.observeRound([readRound("w.ts", 1, 50)], false);
    }
    expect(g.observeRound([], true)).toBeNull();
    expect(g.observeRound([readRound("w.ts", 1, 50)], false)).toBeNull();
  });

  test("different files are tracked independently", () => {
    const g = new MiniSameFileReadGuard();
    for (let i = 0; i < MINI_SAME_FILE_READ_LIMIT; i++) {
      expect(g.observeRound([readRound("x.ts", 1, 50)], false)).toBeNull();
      expect(g.observeRound([readRound("y.ts", 1, 50)], false)).toBeNull();
    }
  });
});
