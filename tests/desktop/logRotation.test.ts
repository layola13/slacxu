import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { rotateLogFilesIfNeeded } = require("../../desktop/log-rotation.cjs") as {
  rotateLogFilesIfNeeded(target: string, incomingBytes: number, options?: { maxFileBytes?: number; maxArchives?: number }): boolean;
};
const temporaryDirectories: string[] = [];
afterEach(() => { while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true }); });

test("rotates log.txt into bounded numbered archives", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-ultra-log-"));
  temporaryDirectories.push(directory);
  const current = join(directory, "log.txt");
  writeFileSync(current, "current");
  writeFileSync(join(directory, "log_1.txt"), "one");
  writeFileSync(join(directory, "log_2.txt"), "two");
  expect(rotateLogFilesIfNeeded(current, 5, { maxFileBytes: 10, maxArchives: 2 })).toBe(true);
  expect(readFileSync(join(directory, "log_1.txt"), "utf8")).toBe("current");
  expect(readFileSync(join(directory, "log_2.txt"), "utf8")).toBe("one");
});

test("does not rotate a log below the size limit", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-ultra-log-"));
  temporaryDirectories.push(directory);
  const current = join(directory, "log.txt");
  writeFileSync(current, "small");
  expect(rotateLogFilesIfNeeded(current, 2, { maxFileBytes: 10, maxArchives: 2 })).toBe(false);
  expect(readFileSync(current, "utf8")).toBe("small");
});
