import { useState } from "react";
import { Box, Button, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography } from "@mui/material";
import TerminalIcon from "@mui/icons-material/Terminal";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

export type WindowsTerminalShellId = "cmd" | "powershell" | "pwsh" | "gitbash";

export const WINDOWS_TERMINAL_SHELLS: Array<{ id: WindowsTerminalShellId; label: string; hint: string }> = [
  { id: "cmd", label: "命令提示符 (cmd)", hint: "系统 ComSpec" },
  { id: "powershell", label: "Windows PowerShell", hint: "powershell.exe 5.x" },
  { id: "pwsh", label: "PowerShell 7 (pwsh)", hint: "未安装时回退到 5.x" },
  { id: "gitbash", label: "Git Bash", hint: "需安装 Git for Windows" },
];

const STORAGE_KEY = "codex.windowsTerminalShell";

function loadPreferredShell(): WindowsTerminalShellId {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (raw === "cmd" || raw === "powershell" || raw === "pwsh" || raw === "gitbash") return raw;
  } catch {
    // Private mode or disabled storage: fall through to default.
  }
  return "powershell";
}

type Props = {
  cwd: string;
  onOpenTerminal: (shell?: string) => void;
};

/**
 * Windows-only system-terminal launcher (VSCode-style).
 * The embedded xterm/node-pty stack stays on Linux/web; on Windows desktop
 * the panel only selects cmd / powershell / pwsh / gitbash and opens the
 * real system window through the Electron bridge.
 */
export function WindowsTerminalLauncher({ cwd, onOpenTerminal }: Props) {
  const [shell, setShell] = useState<WindowsTerminalShellId>(loadPreferredShell);
  const active = WINDOWS_TERMINAL_SHELLS.find((entry) => entry.id === shell) ?? WINDOWS_TERMINAL_SHELLS[0]!;

  return (
    <Box sx={{ height: "100%", minHeight: 0, overflow: "auto", p: 1 }}>
      <Paper
        variant="outlined"
        data-testid="windows-terminal-launcher"
        sx={{ p: 1.5 }}
      >
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1} alignItems="center">
            <TerminalIcon fontSize="small" color="primary" />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Terminal
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                {cwd || "选择系统终端，在外部窗口中打开当前工作目录"}
              </Typography>
            </Box>
          </Stack>
          <FormControl size="small" fullWidth>
            <InputLabel id="windows-terminal-shell-label">默认终端</InputLabel>
            <Select
              labelId="windows-terminal-shell-label"
              label="默认终端"
              value={shell}
              data-testid="windows-terminal-shell-select"
              onChange={(event) => {
                const next = event.target.value as WindowsTerminalShellId;
                setShell(next);
                try {
                  window.localStorage?.setItem(STORAGE_KEY, next);
                } catch {
                  // Ignore storage failures; the choice still applies this time.
                }
              }}
            >
              {WINDOWS_TERMINAL_SHELLS.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
            {active.label} · {active.hint}
          </Typography>
          <Button
            size="small"
            variant="contained"
            startIcon={<OpenInNewIcon fontSize="small" />}
            data-testid="windows-terminal-open-button"
            onClick={() => onOpenTerminal(shell)}
            sx={{ alignSelf: "flex-start" }}
          >
            在系统终端中打开
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
            Windows 桌面端使用系统终端（VSCode 形态）；内嵌终端仅保留给 Linux / 网页版。
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
