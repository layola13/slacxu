import { expect, test } from "bun:test";
import {
  TERMINAL_PREFS_DEFAULTS,
  loadTerminalNames,
  loadTerminalPreferences,
  resolveShellProfileCommand,
  saveTerminalName,
  saveTerminalPreferences,
  terminalTabLabel
} from "../../apps/web/src/app/terminal/terminalPreferences";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => { data.clear(); },
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => { data.delete(key); },
    setItem: (key: string, value: string) => { data.set(key, value); }
  } as Storage;
}

test("shell profile commands map to terminal/create argv", () => {
  expect(resolveShellProfileCommand("default")).toBeNull();
  expect(resolveShellProfileCommand("bash")).toEqual(["bash", "-l"]);
  expect(resolveShellProfileCommand("powershell")).toEqual(["powershell.exe", "-NoLogo", "-NoProfile"]);
  expect(resolveShellProfileCommand("cmd")).toEqual(["cmd.exe", "/K", "chcp 65001>nul"]);
});

test("terminal preferences round-trip with clamping", () => {
  const store = memoryStorage();
  expect(loadTerminalPreferences(store)).toEqual(TERMINAL_PREFS_DEFAULTS);
  saveTerminalPreferences({ fontSize: 16, scrollback: 20000, shellProfile: "zsh" }, store);
  expect(loadTerminalPreferences(store)).toEqual({ fontSize: 16, scrollback: 20000, shellProfile: "zsh" });
  saveTerminalPreferences({ fontSize: 500, scrollback: -1, shellProfile: "nope" as never }, store);
  expect(loadTerminalPreferences(store)).toEqual(TERMINAL_PREFS_DEFAULTS);
});

test("terminal names persist and clear", () => {
  const store = memoryStorage();
  saveTerminalName("term-1", "  api  ", store);
  expect(loadTerminalNames(store)).toEqual({ "term-1": "api" });
  saveTerminalName("term-1", "   ", store);
  expect(loadTerminalNames(store)).toEqual({});
});

test("terminal tab labels prefer custom names", () => {
  const terminal = { terminalId: "t1", cwd: "/x", status: "running" };
  expect(terminalTabLabel(terminal, 0, 1, {})).toBe("1 · bash · running");
  expect(terminalTabLabel(terminal, 0, 1, { t1: "api" })).toBe("api · running");
  expect(terminalTabLabel({ ...terminal, status: "exited", exitCode: 1 }, 0, 2, {})).toBe("2 · exit 1");
  expect(terminalTabLabel({ ...terminal, status: "exited" }, 1, 2, { t1: "db" })).toBe("db · exited");
});
