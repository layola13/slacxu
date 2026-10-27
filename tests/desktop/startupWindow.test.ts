import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { startupLoadingHtml, startupLoadingUrl, startupSetupHtml, startupSetupUrl } = require("../../desktop/startup-window.cjs") as {
  startupLoadingHtml(chinese: boolean): string;
  startupLoadingUrl(chinese: boolean): string;
  startupSetupHtml(options: { chinese: boolean; installCommand: string }): string;
  startupSetupUrl(options: { chinese: boolean; installCommand: string }): string;
};

test("renders an immediate localized desktop startup page", () => {
  expect(startupLoadingHtml(true)).toContain("Codex Ultra 正在启动");
  expect(startupLoadingHtml(false)).toContain("Starting the local service");
  expect(startupLoadingHtml(false)).toContain('<svg class="logo"');
  expect(startupLoadingHtml(false)).toContain('fill="#2563eb"');
  expect(startupLoadingHtml(false)).not.toContain('<div class="logo">C</div>');
  expect(startupLoadingUrl(false)).toStartWith("data:text/html;charset=utf-8,");
});

test("renders the cxu setup page with one-click install preselected", () => {
  const html = startupSetupHtml({ chinese: true, installCommand: "INSTALL-CMD" });
  expect(html).toContain("cxu");
  expect(html).toContain("INSTALL-CMD");
  expect(html).toContain('value="auto" checked');
  expect(startupSetupUrl({ chinese: false, installCommand: "INSTALL-CMD" })).toStartWith("data:text/html;charset=utf-8,");
});

test("creates the Windows startup window before slow desktop initialization", () => {
  const source = readFileSync(join(import.meta.dir, "../../desktop/main.cjs"), "utf8");
  const startupWindowIndex = source.indexOf("createStartupWindow();");
  // Thin shell: no embedded backend. Startup parks on the cxu setup screen
  // when cxu is missing and serves via `cxu serve` otherwise.
  const setupIndex = source.indexOf("enterCxuSetupMode(relayGatewayToken)");
  const cxuProbeIndex = source.indexOf("findCxu()");
  const serverWaitIndex = source.indexOf("await waitForServer()");
  const finishIndex = source.indexOf("await finishStartup(relayGatewayToken)");
  expect(startupWindowIndex).toBeGreaterThan(0);
  expect(setupIndex).toBeGreaterThan(0);
  expect(cxuProbeIndex).toBeGreaterThan(0);
  expect(serverWaitIndex).toBeGreaterThan(0);
  expect(finishIndex).toBeGreaterThan(0);
  expect(startupWindowIndex).toBeLessThan(finishIndex);
  expect(source).not.toContain("waitForDesktopResources");
  expect(source).not.toContain("ensureCodexCli");
  expect(source).not.toContain("codex-ultra-server.exe");
  expect(source).toContain("startCxuServer");
  expect(source).toContain("let startupWindow = null");
  expect(source).toContain("function createStartupWindow()");
  expect(source).toContain("function closeStartupWindow()");
  expect(source).toContain("show: true");
  expect(source).toContain("closeStartupWindow();");
  expect(source).toContain("show: false");
  expect(source).not.toContain("const startupLoading =");
  expect(source).not.toContain("createWindow({ startupLoading:");
  expect(source.indexOf("show: true")).toBeLessThan(source.indexOf("window.loadURL(startupLoadingUrl"));
  expect(source.indexOf('window.once("ready-to-show"')).toBeLessThan(source.indexOf("closeStartupWindow();"));
  expect(source).toContain("if (!mainWindow || mainWindow.isDestroyed()) createWindow();");
  expect(source).toContain('bindExternalLinkHandling(window)');
});
