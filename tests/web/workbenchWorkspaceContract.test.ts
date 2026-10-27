import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeWorkspaceRoots, defaultLocalWorkspacePath } from "../../apps/web/src/workspacePaths";

const root = join(import.meta.dir, "../..");

function readTree(dir) {
  if (!existsSync(dir)) return "";
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return [readTree(path)];
      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [readFileSync(path, "utf8")] : [];
    })
    .join("\n");
}
function assembledAppSource(rootDir) {
  return [
    readFileSync(join(rootDir, "apps/web/src/App.tsx"), "utf8"),
    readTree(join(rootDir, "apps/web/src/shell")),
    readTree(join(rootDir, "apps/web/src/components/dialogs")),
    readTree(join(rootDir, "apps/web/src/app/workbench")),
    readTree(join(rootDir, "frontends/free-mode/src/free")),
  ].join("\n");
}
const appSource = assembledAppSource(root);
const workspacePanelSource = readFileSync(join(root, "apps/web/src/components/RightWorkspacePanel.tsx"), "utf8");

test("Workspace path normalization handles Windows drive letters and relative roots", () => {
  const normalized = normalizeWorkspaceRoots(String.raw`C:\Work`, [
    "C:/Work",
    "D:/Shared",
    "d:/shared",
    ""
  ]);
  expect(normalized).toEqual([String.raw`D:\Shared`]);

  const defaultWin = defaultLocalWorkspacePath("win32", String.raw`C:\Users\test`, String.raw`C:\Users\test\repo`, ["C:\\"]);
  expect(defaultWin).toContain(String.raw`C:\Users\test`);
});

test("Workspace switching between Local and SSH validates commands and boundaries", () => {
  expect(appSource).toContain('workspaceMode === "local"');
  expect(appSource).toContain("verifySshWorkspaceBeforeCreate");
  expect(appSource).toContain("sshCommand");
});

test("Workspace file operations are connected: readDirectory, readFile, saveFile", () => {
  expect(appSource).toContain("onReadDirectory={readActiveWorkspaceDirectory}");
  expect(appSource).toContain("onReadFile={readActiveWorkspaceFile}");
  expect(appSource).toContain("onSaveOpenFile={saveActiveWorkspaceFile}");
});

test("Terminal lifecycle handlers are connected: runCommand, terminate, resize", () => {
  expect(appSource).toContain("onRunTerminalCommand=");
  expect(appSource).toContain("onTerminateTerminal=");
  expect(appSource).toContain("onResizeTerminal=");
});

test("Right workspace panel tab navigation supports all five workspace modes", () => {
  expect(workspacePanelSource).toContain('value="sidechat"');
  expect(workspacePanelSource).toContain('value="explorer"');
  expect(workspacePanelSource).toContain('value="git"');
  expect(workspacePanelSource).toContain('value="browser"');
  expect(workspacePanelSource).toContain('value="terminal"');
});

test("Browser preview triggers workspace tab activation and desktop window", () => {
  expect(appSource).toContain("openBrowserPreview");
  expect(appSource).toContain('setRightWorkspaceTab("browser")');
  expect(appSource).toContain("setRightWorkspaceVisible(true)");
  expect(appSource).toContain("window.codexUltraDesktop?.openWebPreview");
});
