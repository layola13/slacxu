import { expect, test } from "bun:test";
import {
  createBufferSearch,
  getPtyTerminalHandle,
  registerPtyTerminalHandle
} from "../../apps/web/src/ptyTerminalRegistry";

function fakeTerminal(lines: string[]) {
  const selected: Array<{ col: number; row: number; length: number }> = [];
  const scrolled: number[] = [];
  return {
    api: {
      buffer: {
        active: {
          length: lines.length,
          getLine: (index: number) => {
            const text = lines[index];
            return text === undefined ? undefined : { translateToString: () => text };
          }
        }
      },
      select: (col: number, row: number, length: number) => { selected.push({ col, row, length }); },
      clearSelection: () => { selected.length = 0; },
      scrollToLine: (line: number) => { scrolled.push(line); }
    },
    selected,
    scrolled
  };
}

test("buffer search cycles hits and reports misses", () => {
  const fake = fakeTerminal(["$ ls", "AGENTS.md README.md", "$ pwd", "/workspace"]);
  const search = createBufferSearch(fake.api);
  expect(search.findNext("md")).toBe(true);
  expect(fake.selected.at(-1)).toEqual({ col: 7, row: 1, length: 2 });
  expect(search.findNext("md")).toBe(true);
  expect(fake.selected.at(-1)).toEqual({ col: 17, row: 1, length: 2 });
  expect(search.findNext("md")).toBe(true);
  expect(fake.selected.at(-1)).toEqual({ col: 7, row: 1, length: 2 });
  expect(search.findPrevious("md")).toBe(true);
  expect(fake.selected.at(-1)).toEqual({ col: 17, row: 1, length: 2 });
  expect(search.findNext("zzz")).toBe(false);
  expect(fake.selected).toEqual([]);
});

test("terminal handle registry registers and unregisters", () => {
  expect(getPtyTerminalHandle("missing")).toBeNull();
  const handle = {
    findNext: () => true,
    findPrevious: () => false,
    clearSearchDecorations: () => {},
    clear: () => {},
    focus: () => {}
  };
  const unregister = registerPtyTerminalHandle("t1", handle);
  expect(getPtyTerminalHandle("t1")).toBe(handle);
  unregister();
  expect(getPtyTerminalHandle("t1")).toBeNull();
});
