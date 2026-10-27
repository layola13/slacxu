import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("top-bar CLI branding follows the composer backend selection", () => {
  const source = readFileSync(join(import.meta.dir, "../../apps/web/src/App.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/components/dialogs/DangerNewChatDialog.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/ComposerDockView.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/CenterPanelView.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/WorkbenchTopBar.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/ComposerChromeActions.tsx"), "utf8");

  expect(source).toContain('src={isClaudeBackend ? "/icons/claudecode-color.svg"');
  expect(source).toContain('alt={isClaudeBackend ? "Claude CLI" : isAgyBackend');
  expect(source).toContain('data-cli-backend={isClaudeBackend ? "claude" : isAgyBackend');
  // Newer backends (cline / command-code / auggie) must join the same chain:
  // otherwise their threads fall through to the mini icon in the top bar.
  expect(source).toContain('isAuggieBackend ? "/icons/auggie-color.svg"');
  expect(source).toContain('isClineBackend ? "/icons/cline-color.svg"');
  expect(source).toContain('isCommandCodeBackend ? "/icons/command-code.png"');
  expect(source).toContain('isAuggieBackend ? "Auggie CLI"');
  expect(source).toContain('isClineBackend ? "Cline CLI"');
  expect(source).toContain('isCommandCodeBackend ? "Command Code CLI"');
  expect(source).toContain('isAuggieBackend ? "auggie"');
  expect(source).toContain('isClineBackend ? "cline"');
  expect(source).toContain('isCommandCodeBackend ? "command-code"');
  const mobile = readFileSync(join(import.meta.dir, "../../apps/web/src/mobile/MobileTopBarDropdown.tsx"), "utf8");
  expect(mobile).toContain('isClineBackend');
  expect(mobile).toContain('"/icons/cline-color.svg"');
  expect(mobile).toContain('"Cline CLI"');
  const selection = readFileSync(join(import.meta.dir, "../../apps/web/src/app/workbench/useSelectionRuntime.ts"), "utf8");
  expect(selection).toContain("isClineBackend = isClineCliBackend(runtimeSelection.cliBackend) && clineCliEnabled");
  expect(selection).toContain("isAuggieBackend = isAuggieCliBackend(runtimeSelection.cliBackend) && auggieCliEnabled");
  expect(selection).toContain("isCommandCodeBackend = isCommandCodeCliBackend(runtimeSelection.cliBackend) && commandCodeCliEnabled");
  expect(selection).toContain("!isClineBackend && !isCommandCodeBackend");
  for (const icon of ["cline-color.svg", "auggie-color.svg", "command-code.png"]) {
    expect(existsSync(join(import.meta.dir, "../../apps/web/public/icons", icon))).toBe(true);
  }
  expect(source).not.toContain("openclaude");
  expect(source).not.toContain("OpenClaude");
  expect(source).toContain('DEFAULT_CLI_BACKEND');
  expect(source).toContain('data-testid="composer-cli-backend-toggle"');
  expect(source).toContain('contextTrailingAction={<>{composerCliBackendAction}{composerFreeSavingsAction}{composerAgentsAction}</>}');
  expect(source).not.toContain("composerGroupChatAction");
});

test("top-bar CLI switcher has no embedded OpenClaude section", () => {
  const source = readFileSync(join(import.meta.dir, "../../apps/web/src/App.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/components/dialogs/DangerNewChatDialog.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/ComposerDockView.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/CenterPanelView.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/WorkbenchTopBar.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/ComposerChromeActions.tsx"), "utf8");

  expect(source).not.toContain("openclaude");
  expect(source).not.toContain("OpenClaude");
  expect(source).not.toContain('t("app.cliSwitcherOpenClaudeSection")');
});

test("new-chat backend selectors expose only official Claude CLI", () => {
  const source = readFileSync(join(import.meta.dir, "../../apps/web/src/App.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/components/dialogs/DangerNewChatDialog.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/ComposerDockView.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/CenterPanelView.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/WorkbenchTopBar.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/shell/ComposerChromeActions.tsx"), "utf8");
  const picker = readFileSync(join(import.meta.dir, "../../apps/web/src/components/CliBackendPicker.tsx"), "utf8");

  // Danger dialog keeps its inline toggle; standard dialog uses CliBackendPicker.
  expect(source.match(/data-testid="cli-backend-toggle"/g)).toHaveLength(1);
  expect(picker).toContain('testId = "cli-backend-toggle"');
  // No independent OpenClaude toggle; official Claude only.
  expect(picker).not.toContain('value="openclaude"');
  expect(picker).not.toContain('aria-label="OpenClaude CLI"');
  expect(picker).not.toContain("claudeEmbedded");
  expect(source).not.toContain('value="openclaude"');
  expect(source).not.toContain('aria-label="OpenClaude CLI"');
  expect(source).not.toContain("claudeEmbedded={openClaudeEmbedded}");
  expect(source.match(/src="\/icons\/codex-color\.svg" alt="" aria-hidden/g)).toHaveLength(1);
  // The plugin table now lives in the independent plugin projects; the
  // assembled source is cliPlugins.ts + the catalog + each plugin's web side.
  const plugins = readFileSync(join(import.meta.dir, "../../apps/web/src/app/cli/cliPlugins.ts"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/app/cli/pluginCatalog.ts"), "utf8")
    + ["mini", "codex", "claude", "agy", "auggie", "grok", "pi", "opencode", "opencode-v2", "muse"]
      .map((id) => readFileSync(join(import.meta.dir, `../../frontends/${id}/src/web.ts`), "utf8"))
      .join("\n");
  expect(plugins).toContain('icon: "/icons/codex-color.svg"');
  // Official Claude reuses the brand SVG: 1 in the danger dialog, defined in cliPlugins.
  expect(source.match(/src="\/icons\/claudecode-color\.svg" alt="" aria-hidden/g)).toHaveLength(1);
  expect(plugins).toContain('icon: "/icons/claudecode-color.svg"');
  // Single-line toggle sx moved to CliBackendPicker; danger dialog has its own mobile-grid sx.
  expect(picker.match(/sx=\{\{ "& \.MuiToggleButton-root": \{ gap: 0\.75, py: 0\.5, textTransform: "none" \} \}\}/g)).toHaveLength(1);
  expect(source).not.toContain("(claudeCliEnabled || agyCliEnabled || grokCliEnabled) && (");
});

test("Claude CLI availability loads before settings are opened", () => {
  const hookSource = readFileSync(join(import.meta.dir, "../../apps/web/src/app/cli/useCliBackendPlugins.ts"), "utf8");

  expect(hookSource).toContain("void fetchClaudeCompatibleCliSettings(token)");
  expect(hookSource).toContain("}, [token]);");
});

test("history backend filter is a single icon-only row with tooltips", () => {
  const source = readFileSync(join(import.meta.dir, "../../apps/web/src/history/HistorySidebar.tsx"), "utf8");

  expect(source).toContain("CliBackendIcon");
  expect(source).toContain('value: "mini"');
  expect(source).not.toContain('value: "openclaude"');
  expect(source).toContain("<Tooltip");
  expect(source).not.toContain('<ToggleButton value="codex" aria-label={t("history.backendCodex")}><TerminalIcon');
});
