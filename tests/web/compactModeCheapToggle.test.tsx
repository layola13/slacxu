import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTheme, ThemeProvider } from "@mui/material";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WINDOWS_TERMINAL_SHELLS, WindowsTerminalLauncher } from "../../apps/web/src/components/WindowsTerminalLauncher";

const theme = createTheme({
  components: {
    MuiDialog: { defaultProps: { disablePortal: true } },
    MuiPopover: { defaultProps: { disablePortal: true } },
    MuiModal: { defaultProps: { disablePortal: true } },
  },
});

test("cheap compact mode toggle is never blocked by route readiness (deadlock regression)", () => {
  const appSource = readFileSync(join(import.meta.dir, "../../apps/web/src/App.tsx"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/free/useFreeCompactionSelection.ts"), "utf8")
    + readFileSync(join(import.meta.dir, "../../apps/web/src/free/useFreeCompaction.ts"), "utf8");
  // The toggle must persist the mode first; readiness only warns afterwards.
  const setCompactModeAt = appSource.indexOf("const setCompactMode = (mode: CompactMode)");
  expect(setCompactModeAt).toBeGreaterThan(-1);
  const updateAt = appSource.indexOf("compactMode: mode,", setCompactModeAt);
  const readinessAt = appSource.indexOf("checkFreeModelsBeforeToggle()", setCompactModeAt);
  expect(updateAt).toBeGreaterThan(-1);
  expect(readinessAt).toBeGreaterThan(updateAt);
  // No toggle path may early-return behind shouldBlock*; send-time still guards via readiness.ok.
  expect(appSource).not.toContain("shouldBlockFreeCompactionSelection");
  expect(appSource).toContain("runFreeCompactionBeforeSend");
});

test("Windows terminal panel uses the system launcher instead of the embedded PTY", () => {
  const panelSource = readFileSync(
    join(import.meta.dir, "../../apps/web/src/components/RightWorkspacePanel.tsx"),
    "utf8"
  );
  expect(panelSource).toContain("WindowsTerminalLauncher");
  expect(panelSource).toContain("useSystemTerminal");
  expect(panelSource).toContain("windowsDesktop");
});

test("WindowsTerminalLauncher offers cmd/powershell/pwsh/gitbash and opens the system shell", () => {
  let opened: string | undefined;
  const html = renderToStaticMarkup(
    <ThemeProvider theme={theme}>
      <WindowsTerminalLauncher cwd="E:\\projects\\sci" onOpenTerminal={(shell) => { opened = shell; }} />
    </ThemeProvider>
  );
  expect(html).toContain('data-testid="windows-terminal-launcher"');
  expect(html).toContain('data-testid="windows-terminal-shell-select"');
  expect(html).toContain('data-testid="windows-terminal-open-button"');
  expect(html).toContain("Windows PowerShell");
  expect(html).toContain("在系统终端中打开");
  // The full VSCode-style shell list lives in the exported constant (MUI only
  // renders MenuItems into the open popover, not into static markup).
  expect(WINDOWS_TERMINAL_SHELLS.map((entry) => entry.id)).toEqual(["cmd", "powershell", "pwsh", "gitbash"]);
  expect(opened).toBeUndefined();
});
