import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("keeps desktop CLI prerequisites opt-in before legal consent", () => {
  const source = readFileSync(join(import.meta.dir, "../../apps/web/src/shell/AppRoot.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useSessionBootstrap.ts"), "utf8");
  const gate = source.indexOf("if (cliPrerequisitesBlocked)");
  const checking = source.indexOf('if (authStatus === "checking")');
  const legal = source.indexOf('if (authStatus === "legalRequired" && authSession)');
  expect(gate).toBeGreaterThan(0);
  expect(gate).toBeLessThan(checking);
  expect(gate).toBeLessThan(legal);
  expect(source).toContain("<CliPrerequisiteScreen");
  expect(source).toContain("if (cliPrerequisitesBlocked) return;");
  const hookSource = readFileSync(join(import.meta.dir, "../../apps/web/src/app/cli/useCliPrerequisites.ts"), "utf8");
  expect(hookSource).toContain("window.codexUltraDesktop?.cliPrerequisitesRequired");
  const prerequisiteSource = readFileSync(join(import.meta.dir, "../../apps/web/src/components/CliPrerequisiteScreen.tsx"), "utf8");
  expect(prerequisiteSource).toContain("status?.claude.available || claudeSkipped");
  expect(prerequisiteSource).toContain("setClaudeSkipped(true)");
  const preloadSource = readFileSync(join(import.meta.dir, "../../desktop/preload.cjs"), "utf8");
  expect(preloadSource).toContain("CODEX_UI_REQUIRE_CLI_PREREQUISITES");
  expect(preloadSource).toContain("cliPrerequisitesRequired,");
});
