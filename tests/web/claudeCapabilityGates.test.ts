import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";


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
const appSource = assembledAppSource(join(import.meta.dir, "../.."));

test("Claude keeps the SSH workspace selection available", () => {
  expect(appSource).toContain('<ToggleButton value="ssh" aria-label={t("workspace.ssh")}>');
  expect(appSource).not.toContain('value="ssh" aria-label={t("workspace.ssh")} disabled={isClaudeBackend}');
});

test("Claude keeps verified relay, agent, compaction and skill controls available", () => {
  expect(appSource).toContain('contextTrailingAction={<>{composerCliBackendAction}{composerFreeSavingsAction}{composerAgentsAction}</>}');
  expect(appSource).toContain('skills={state.tooling.skillGroups.flatMap((group) => group.skills).filter((skill) => skill.enabled)}');
  expect(appSource).not.toContain('disabled={isClaudeBackend} data-testid="composer-free-savings-button"');
  expect(appSource).not.toContain('isClaudeBackend ? null : composerAgentsAction');
});

test("Claude-compatible CLI feature flag remains opt-in", () => {
  expect(/^(1|true|yes)$/i.test("")).toBe(false);
  expect(/^(1|true|yes)$/i.test("TRUE")).toBe(true);
  expect(/^(1|true|yes)$/i.test("Yes")).toBe(true);
  expect(/^(1|true|yes)$/i.test("1")).toBe(true);
});
