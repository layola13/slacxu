import { expect, test } from "bun:test";
import { explorerBaseName, explorerRelativePath } from "../../apps/web/src/components/WorkspaceExplorerPanel";

test("explorer base name handles both separators and drive roots", () => {
  expect(explorerBaseName("/home/u/proj")).toBe("proj");
  expect(explorerBaseName("/home/u/proj/")).toBe("proj");
  expect(explorerBaseName("E:\\projects\\sci")).toBe("sci");
  expect(explorerBaseName("E:\\projects\\sci\\")).toBe("sci");
  expect(explorerBaseName("C:\\")).toBe("C:\\");
  expect(explorerBaseName("/")).toBe("/");
});

test("explorer relative path strips Windows roots case-insensitively, POSIX exactly", () => {
  expect(explorerRelativePath("E:\\projects\\sci", "E:\\projects\\sci\\src\\a.ts")).toBe("src\\a.ts");
  expect(explorerRelativePath("e:\\Projects\\sci", "E:\\projects\\sci\\b.ts")).toBe("b.ts");
  expect(explorerRelativePath("C:\\", "C:\\x\\y.txt")).toBe("x\\y.txt");
  expect(explorerRelativePath("/home/u/p", "/home/u/p/src/a.ts")).toBe("src/a.ts");
  expect(explorerRelativePath("/home/u/p", "/home/u/P/src/a.ts")).toBe("/home/u/P/src/a.ts");
  expect(explorerRelativePath("/home/u/p", "/home/u/p2/a.ts")).toBe("/home/u/p2/a.ts");
});
