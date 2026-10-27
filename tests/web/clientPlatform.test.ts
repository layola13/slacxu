import { expect, test } from "bun:test";
import { isBrowserTabAvailable, isLinuxClient, isWindowsClient } from "../../apps/web/src/clientPlatform";

test("Linux clients hide the Browser tab, Windows/macOS keep it", () => {
  expect(isLinuxClient("Linux x86_64")).toBe(true);
  expect(isLinuxClient("linux")).toBe(true);
  expect(isWindowsClient("Win32")).toBe(true);
  expect(isWindowsClient("MacIntel")).toBe(false);
});

// Bun 单测环境无 window：退化为纯平台判断（仅 Windows 可见）。
test("without a desktop shell, only Windows keeps the Browser tab", () => {
  expect(isBrowserTabAvailable("Win32")).toBe(true);
  expect(isBrowserTabAvailable("MacIntel")).toBe(false);
  expect(isBrowserTabAvailable("Linux x86_64")).toBe(false);
  expect(isBrowserTabAvailable("")).toBe(false);
});

test("server browser version (no desktop bridge) always hides the Browser tab", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {}
  });
  try {
    expect(isBrowserTabAvailable("Win32")).toBe(false);
    expect(isBrowserTabAvailable("MacIntel")).toBe(false);
    expect(isBrowserTabAvailable("Linux x86_64")).toBe(false);
  } finally {
    // @ts-expect-error restore SSR-like env
    delete globalThis.window;
  }
});

test("Windows desktop shell keeps the Browser tab, other desktops hide it", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { codexUltraDesktop: {} }
  });
  try {
    expect(isBrowserTabAvailable("Win32")).toBe(true);
    expect(isBrowserTabAvailable("MacIntel")).toBe(false);
    expect(isBrowserTabAvailable("Linux x86_64")).toBe(false);
  } finally {
    // @ts-expect-error restore SSR-like env
    delete globalThis.window;
  }
});
