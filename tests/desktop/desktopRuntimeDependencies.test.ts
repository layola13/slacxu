import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  automaticallyCopiedDesktopRuntimeDependencies,
  desktopRuntimeDependencies,
} from "../../scripts/lib/desktop-runtime-dependencies.mjs";

const root = join(import.meta.dir, "..", "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const serverPackageJson = JSON.parse(
  readFileSync(join(root, "apps", "server", "package.json"), "utf8"),
);

test("includes every server production dependency in desktop runtime validation", () => {
  const expectedDependencies = [
    "@napi-rs/keyring",
    "bcryptjs",
    "better-sqlite3",
    "bindings",
    "file-uri-to-path",
    "tree-sitter-wasms",
    "web-tree-sitter",
    "ws",
  ].sort();

  expect(desktopRuntimeDependencies(serverPackageJson)).toEqual(expectedDependencies);
  expect(desktopRuntimeDependencies(serverPackageJson)).not.toContain("smol-toml");
  expect(desktopRuntimeDependencies(serverPackageJson)).toContain("ws");
});

test("automatically copies production dependencies not handled by dedicated packaging", () => {
  const copiedDependencies = automaticallyCopiedDesktopRuntimeDependencies(serverPackageJson);

  expect(copiedDependencies).not.toContain("smol-toml");
  expect(copiedDependencies).toContain("better-sqlite3");
  expect(copiedDependencies).not.toContain("@codex-ui/shared");
  expect(copiedDependencies).not.toContain("postgres");
  expect(copiedDependencies).not.toContain("@napi-rs/keyring");
  expect(copiedDependencies).toContain("ws");
});

test("desktop packaging entry points rebuild and prepare Electron native dependencies", () => {
  for (const scriptName of [
    "desktop:package:win",
    "desktop:package:portable",
    "desktop:package:portable:armored",
    "desktop:package:windows",
    "desktop:package:windows:armored",
  ]) {
    const script = packageJson.scripts[scriptName];
    // Thin shell: the only Electron native dependency is node-pty (embedded
    // terminal). No backend natives are bundled anymore.
    expect(script).toContain("desktop:rebuild:pty");
    expect(script).toContain("desktop:prepare");
  }
});
