import { expect, test } from "bun:test";
import { relative, resolve } from "node:path";
import {
  isCodeWorkspacePath,
  parseCodeWorkspaceFolders,
  updateCodeWorkspaceFolders
} from "../../apps/server/src/codeWorkspace";

test("recognizes code workspace files case-insensitively", () => {
  expect(isCodeWorkspacePath("E:\\work\\cxu.code-workspace")).toBe(true);
  expect(isCodeWorkspacePath("/work/TEAM.CODE-WORKSPACE")).toBe(true);
  expect(isCodeWorkspacePath("/work/package.json")).toBe(false);
});

test("parses JSONC folders and resolves paths relative to the workspace file", () => {
  const workspaceFile = resolve("workspace-fixture", "team.code-workspace");
  const parsed = parseCodeWorkspaceFolders(`{
    // Primary project
    "folders": [
      { "path": "app" },
      { "path": "../shared" },
    ],
  }`, workspaceFile);

  expect(parsed).toEqual({
    cwd: resolve("workspace-fixture", "app"),
    additionalRoots: [resolve("shared")]
  });
});

test("updates folders while preserving other workspace settings", () => {
  const workspaceFile = resolve("workspace-fixture", "cxu.code-workspace");
  const updated = updateCodeWorkspaceFolders(
    '{ "folders": [], "settings": { "editor.formatOnSave": true } }',
    workspaceFile,
    resolve("workspace-fixture"),
    [resolve("shared")]
  );
  const document = JSON.parse(updated) as { folders: Array<{ path: string }>; settings: Record<string, boolean> };

  expect(document.folders).toEqual([{ path: "." }, { path: relative(resolve("workspace-fixture"), resolve("shared")) }]);
  expect(document.settings).toEqual({ "editor.formatOnSave": true });
});

test("rejects workspace files without usable folder entries", () => {
  expect(() => parseCodeWorkspaceFolders('{ "folders": [] }', resolve("empty.code-workspace")))
    .toThrow("does not contain any folder paths");
});
