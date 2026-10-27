import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureCodexConfigHealthy } from "../../apps/server/src/codexConfigHealth.ts";

const originalDataDir = process.env.CODEX_UI_DATA_DIR;
const originalCodexHome = process.env.CODEX_HOME;
let root: string | null = null;

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.CODEX_UI_DATA_DIR;
  else process.env.CODEX_UI_DATA_DIR = originalDataDir;
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

test("config health repairs only the virtual config", () => {
  root = join(tmpdir(), `codex-ultra-config-health-${randomUUID()}`);
  const dataDir = join(root, "data");
  const codexHome = join(root, ".codex");
  const realConfig = join(codexHome, "config.toml");
  const virtualConfig = join(dataDir, "virtual-codex", "config.toml");
  mkdirSync(dirname(realConfig), { recursive: true });
  mkdirSync(dirname(virtualConfig), { recursive: true });
  writeFileSync(realConfig, "model = \"real\"\nmodel = \"different\"\n");
  writeFileSync(virtualConfig, "model = \"virtual\"\nmodel = \"virtual\"\n");
  process.env.CODEX_UI_DATA_DIR = dataDir;
  process.env.CODEX_HOME = codexHome;

  const result = ensureCodexConfigHealthy();

  expect(result.path).toBe(virtualConfig);
  expect(result.changed).toBe(true);
  expect(readFileSync(virtualConfig, "utf8")).toBe("model = \"virtual\"\n");
  expect(readFileSync(realConfig, "utf8")).toBe("model = \"real\"\nmodel = \"different\"\n");
});
