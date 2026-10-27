import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
// Source-contract assertions scan the assembled web source: as App.tsx is
// split (docs/app-tsx-split-final-plan.md), dialog and workbench code moves
// into components/dialogs, components/workbench and app/workbench.
function readTree(dir: string): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return [readTree(path)];
      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [readFileSync(path, "utf8")] : [];
    })
    .join("\n");
}
const appSource = [
  readFileSync(join(root, "apps/web/src/App.tsx"), "utf8"),
  readTree(join(root, "apps/web/src/components/dialogs")),
  readTree(join(root, "apps/web/src/shell")),
  readTree(join(root, "apps/web/src/app/workbench")),
  readTree(join(root, "frontends/free-mode/src/free")),
].join("\n");

test("Plan Implementation Dialog allows adopting or revising plan", () => {
  expect(appSource).toContain('data-testid="plan-implementation-dialog"');
  expect(appSource).toContain("Implement this plan?");
  expect(appSource).toContain("Cancel and stay in Plan mode");
  expect(appSource).toContain("onClick={stayInPlanMode}");
  expect(appSource).toContain("onClick={() => void implementApprovedPlan()}");
});

test("Goal Resume Dialog allows resuming or pausing active goal", () => {
  expect(appSource).toContain('data-testid="goal-resume-dialog"');
  expect(appSource).toContain("onClick={() => void pauseGoalResume()}");
  expect(appSource).toContain("onClick={() => void confirmGoalResume()}");
});

test("Danger New Chat Dialog requires explicit confirmation for bypass mode", () => {
  expect(appSource).toContain('data-testid="danger-new-chat-dialog"');
  expect(appSource).toContain("dangerDialogIntent");
  expect(appSource).toContain("dangerDialogAcknowledged");
  expect(appSource).toContain("onClick={() => void confirmDangerDialog()}");
  expect(appSource).toContain("onClick={useSaferModeFromDangerDialog}");
});

test("CLI Switcher Dialog prompts before switching between Codex and Claude engines", () => {
  expect(appSource).toContain('data-testid="topbar-cli-switcher-trigger"');
  expect(appSource).toContain('data-testid="cli-switch-confirm-dialog"');
  expect(appSource).toContain('data-testid="cli-switch-confirm-button"');
  expect(appSource).toContain("handleCliSwitchConfirm");
  expect(appSource).toContain("cliSwitchConfirmTarget");
});

test("Relay Share Export and Import dialogs handle configuration sharing securely", () => {
  expect(appSource).toContain("relayShareExportOpen");
  expect(appSource).toContain("relayShareImportOpen");
  expect(appSource).toContain("setRelayShareExportOpen(false)");
  expect(appSource).toContain("setRelayShareImportOpen(false)");
  expect(appSource).toContain("importRelayShareDirectly");
});

test("Settings Drawer provides navigation across all configuration sections", () => {
  expect(appSource).toContain("<SettingsDrawer");
  expect(appSource).toContain("initialSection={settingsSection}");
  expect(appSource).toContain("initialPluginTab={settingsPluginTab}");
  expect(appSource).toContain("initialRelayProviderId={settingsRelayTarget?.providerId ?? null}");
  expect(appSource).toContain("codexConfig={codexConfig}");
  expect(appSource).toContain("tooling={state.tooling}");
  expect(appSource).toContain("mcpOauthUrls={mcpOauthUrls}");
});

test("SSH Codex Installation dialog guides dependency setup on remote nodes", () => {
  expect(appSource).toContain('data-testid="ssh-codex-install-dialog"');
  expect(appSource).toContain("installSshCodex");
  expect(appSource).toContain("sshInstallBusy");
  expect(appSource).toContain("installSshCodexCli");
});
