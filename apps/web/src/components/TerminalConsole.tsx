import { useEffect, useRef, useState } from "react";
import { Box, Button, Chip, Menu, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import TerminalIcon from "@mui/icons-material/Terminal";
import type { PtyTerminalSession, TerminalSession } from "../state/codexClient";
import { PtyTerminalView } from "./PtyTerminalView";
import { getPtyTerminalHandle } from "../ptyTerminalRegistry";
import {
  TERMINAL_SHELL_PROFILES,
  dropTerminalName,
  loadTerminalNames,
  loadTerminalPreferences,
  resolveShellProfileCommand,
  saveTerminalName,
  saveTerminalPreferences,
  terminalTabLabel,
  type TerminalShellProfileId
} from "../app/terminal/terminalPreferences";

type Size = { rows: number; cols: number };

// Fallback shell spawn (only used when the host provides no PTY backend).
// - HISTFILE=/dev/null：容器 HISTFILE 常指向只读路径，避免 `history: cannot create` 刷屏
// - TERM=dumb：子命令默认输出纯文本，避免颜色/光标控制序列污染 transcript
// - --noediting：关闭 readline，避免 bracketed-paste 开关序列（[?2004h/l）混入输出
// - +m：关闭 monitor/job-control；远端 pty 没有 controlling terminal，
//   否则 bash 启动即报 `cannot set terminal process group` / `no job control`
export const TERMINAL_SHELL_SPAWN_COMMAND = "export HISTFILE=/dev/null TERM=dumb; exec bash --noediting +m";

// Windows fallback (no PTY backend): PowerShell syntax only. The transcript
// runner wraps this with `powershell -Command`, so bash `export/exec` must
// never be sent here (`export: The term 'export' is not recognized`).
// Keeps plain-text output like the POSIX variant ($ProgressPreference
// silences progress bars that would flood the transcript).
export const TERMINAL_WINDOWS_SHELL_SPAWN_COMMAND =
  "$ProgressPreference='SilentlyContinue'; $PSVersionTable.PSVersion";

export function isWindowsTerminalCwd(cwd?: string): boolean {
  if (cwd && /^[a-zA-Z]:[\\/]/.test(cwd)) return true;
  if (typeof navigator !== "undefined") {
    if (/Win/i.test(navigator.platform ?? "")) return true;
    if (/Windows/i.test(navigator.userAgent ?? "")) return true;
  }
  return false;
}

export function resolveTerminalFallbackSpawnCommand(cwd?: string): string {
  return isWindowsTerminalCwd(cwd)
    ? TERMINAL_WINDOWS_SHELL_SPAWN_COMMAND
    : TERMINAL_SHELL_SPAWN_COMMAND;
}

// Fullscreen TUI commands that can never work in the transcript track:
// `command/exec` has no controlling terminal and the transcript renders into
// a `<pre>` with every CSI cursor-addressing sequence stripped
// (stripTerminalAnsi below), so `top`/Ink-style apps degrade into endless
// scrolling instead of pinning a refresh frame. They must run in a resident
// PTY (xterm.js renders alt-screen natively) or be refused over SSH.
// Mirrors orca's policy: host-interactive commands are rejected with a
// targeted error instead of bridged (`unsupported_over_ssh`), and Codex TUIs
// are launched with `--no-alt-screen` where no xterm surface exists.
const FULLSCREEN_ALWAYS = new Set([
  // Process/file viewers with no batch fallback.
  "top", "htop", "btop", "atop", "iotop", "nvtop", "nmon",
  // Fullscreen editors.
  "vim", "vi", "view", "nvim", "neovim", "nano", "emacs", "emacsclient", "micro",
  // Pagers: transcript cannot feed them `q`, so they hang until exec timeout.
  "less", "more", "most",
  // Manual pages page through `less` the same way.
  "man",
  // Terminal multiplexers take over the whole screen.
  "tmux", "screen", "byobu", "zellij",
  // Periodic repainters (home+clear every tick).
  "watch",
  // Interactive login / transfer sessions.
  "ssh", "mosh", "sftp", "ftp", "telnet",
  // Text browsers, file managers, fuzzy pickers, debuggers, dashboards.
  "links", "lynx", "w3m", "elinks", "mc", "ranger", "lf", "nnn",
  "hstr", "peco", "percol", "fzf", "gdb", "tig", "lazygit", "lazydocker", "k9s",
  "alsamixer", "nmtui",
]);

// AI-agent TUIs: only a bare invocation (no args) is guaranteed to enter the
// fullscreen TUI. `codex exec "..."` / `codex --help` / `codex "prompt"` run
// headless over a pipe and stay legal in the transcript.
const FULLSCREEN_TUI_BARE_ONLY = new Set([
  "codex", "claude", "opencode", "auggie", "gemini", "qwen",
]);

// `top -b/--batch` is the explicit plain-text mode orca-style transcript
// surfaces can consume; let it through.
function hasTopBatchFlag(args: string[]): boolean {
  return args.some((arg) => arg === "-b" || arg === "--batch" || arg === "-bn1");
}

const WRAPPER_PREFIXES = new Set(["sudo", "doas", "runas", "time", "timeout", "env", "nice", "nohup", "stdbuf", "unbuffer"]);

/** Split a shell command into argv-ish tokens (quotes respected, no execution). */
function splitShellTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function baseCommandName(token: string): string {
  const normalized = token.trim();
  const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return base.toLowerCase().replace(/\.exe$/, "");
}

/**
 * Detect a fullscreen-interactive command that the transcript track cannot
 * run (no controlling terminal + ANSI-stripped `<pre>` rendering). Returns
 * the offending command name, or null when the transcript may execute it.
 *
 * Piped/redirected compound commands are left alone: `top | head` degrades
 * `top` into batch output over the pipe, which the transcript shows fine.
 */
export function detectInteractiveFullscreenCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  // Compound shell syntax changes fullscreen semantics (pipes/redirections
  // force batch output), so only classify simple invocations.
  if (/[|&;<>`]/.test(trimmed) || trimmed.includes("$(")) return null;
  const tokens = splitShellTokens(trimmed);
  let index = 0;
  // Skip VAR=x assignments and wrapper prefixes (`sudo`, `env`, `time`, ...).
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || WRAPPER_PREFIXES.has(baseCommandName(token))) {
      index += 1;
      continue;
    }
    break;
  }
  if (index >= tokens.length) return null;
  const name = baseCommandName(tokens[index]!);
  const args = tokens.slice(index + 1);
  if (FULLSCREEN_ALWAYS.has(name)) {
    if ((name === "top" || name === "atop") && hasTopBatchFlag(args)) return null;
    return tokens[index]!;
  }
  if (FULLSCREEN_TUI_BARE_ONLY.has(name) && args.length === 0) return tokens[index]!;
  return null;
}

const TERMINAL_ESC = String.fromCharCode(27);

// 显示侧 ANSI 清洗：远端输出难免夹带颜色/光标/OSC 序列，<pre> 不解释它们，
// 直接渲染就是 `[?2004h` / `[01;34m` 乱码。这里只做展示清洗，不改原始 output。
// 常驻 PTY 页签走 xterm.js 真渲染，不需要清洗。
export function stripTerminalAnsi(text: string): string {
  const oscSequence = new RegExp(`${TERMINAL_ESC}\\][^\\x07${TERMINAL_ESC}]*(?:\\x07|${TERMINAL_ESC}\\\\)`, "g");
  const csiSequence = new RegExp(`${TERMINAL_ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
  const residueControls = new RegExp(`${TERMINAL_ESC}|[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]`, "g");
  return text.replace(oscSequence, "").replace(csiSequence, "").replace(residueControls, "");
}

type Props = {
  cwd: string;
  terminalSessions: TerminalSession[];
  /** Resident PTY shells (orca-style). Absent on hosts without the PTY backend. */
  ptyTerminals?: PtyTerminalSession[];
  onRunTerminalCommand: (command: string, cwd: string, size: Size) => void;
  onWriteTerminalInput: (processId: string, input: string) => void;
  onTerminateTerminal: (processId: string) => void;
  onResizeTerminal: (processId: string, size: Size) => void;
  onOpenTerminal?: () => void;
  onCreatePtyTerminal?: (cwd: string, size: Size, command?: string[]) => void;
  onWritePtyTerminal?: (terminalId: string, data: string) => void;
  onKillPtyTerminal?: (terminalId: string) => void;
  onForgetPtyTerminal?: (terminalId: string) => void;
  onResizePtyTerminal?: (terminalId: string, size: Size) => void;
  onLoadPtyTail?: (terminalId: string) => Promise<string>;
  /** Transcript auto-routed a fullscreen command here: select this tab once listed. */
  autoSelectPtyTerminalId?: string | null;
  onAutoSelectPtyConsumed?: () => void;
};

/**
 * VSCode 式终端：面板就是一块 xterm 交互式 shell，键盘直接敲进去；
 * 普通短命令的 transcript 是只读历史（点 transcript 页签查看）。
 *
 * 双轨模型：
 * - 交互式 shell（默认）：服务端自有 PTY（orca 式常驻，无超时、真 job control），
 *   面板打开自动建一个并选中，xterm.js 真渲染，alt-screen（top/vim/codex TUI）
 *   原地刷新；键盘（含 Ctrl+C）直达 PTY，由内核投递 SIGINT。
 * - transcript：独立短进程执行（后端 command/exec 带超时），全部按时间顺序
 *   追加进同一个黑框，绝不建 tab、不跳视图；点 transcript 页签只看历史。
 * 高级设置（cwd/rows/cols）默认折叠。
 */
export function TerminalConsole({
  cwd,
  terminalSessions,
  ptyTerminals,
  onRunTerminalCommand,
  onWriteTerminalInput,
  onTerminateTerminal,
  onResizeTerminal,
  onOpenTerminal,
  onCreatePtyTerminal,
  onWritePtyTerminal,
  onKillPtyTerminal,
  onForgetPtyTerminal,
  onResizePtyTerminal,
  onLoadPtyTail,
  autoSelectPtyTerminalId,
  onAutoSelectPtyConsumed
}: Props) {
  const [terminalCwd, setTerminalCwd] = useState(cwd);
  const [terminalSize, setTerminalSize] = useState<Size>({ rows: 24, cols: 80 });
  const [showSettings, setShowSettings] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState(() => loadTerminalPreferences());
  const [names, setNames] = useState<Record<string, string>>(() => loadTerminalNames());
  const [shellMenuAnchor, setShellMenuAnchor] = useState<HTMLElement | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [maximized, setMaximized] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 面板打开时自动建过 shell（只建一次，失败不重试，避免后端不可用时死循环）。
  const autoCreatedRef = useRef(false);
  // 用户亲手点回 transcript：尊重选择，不再自动抢回 shell 页签。
  const manualTranscriptRef = useRef(false);
  const isDesktopTerminal = typeof window !== "undefined" && !!window.codexUltraDesktop?.openTerminal;

  useEffect(() => {
    setTerminalCwd(cwd);
  }, [cwd]);

  const ptyList = ptyTerminals ?? [];
  // App 把新会话 prepend 在数组头；transcript 需要时间正序展示。
  const commandSessions = [...terminalSessions].reverse();
  const runningCommand = terminalSessions.find((session) => session.status === "running") ?? null;
  const selectedPty = ptyList.find((terminal) => terminal.terminalId === selectedId) ?? null;
  const ptyIds = ptyList.map((terminal) => terminal.terminalId).join("|");

  // VSCode 形态：面板打开默认就是一块交互式 shell。挂载时没有 shell 就自动建一个
  // （桌面端走系统终端，不自动建；无 PTY 后端时 onCreatePtyTerminal 为空，不建）。
  useEffect(() => {
    if (!autoCreatedRef.current && !isDesktopTerminal && onCreatePtyTerminal && ptyList.length === 0) {
      autoCreatedRef.current = true;
      onCreatePtyTerminal(terminalCwd || cwd, terminalSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 选中稳定性：选中 shell 消失才回 transcript；默认选中最新 shell（VSCode 形态），
  // 但用户亲手点回 transcript 后不再自动抢视图。
  // 唯一例外：transcript 把全屏命令自动转进新建 PTY 时，按 autoSelect 切过去。
  useEffect(() => {
    if (selectedId && !ptyList.some((terminal) => terminal.terminalId === selectedId)) {
      setSelectedId(null);
      return;
    }
    if (!selectedId && !manualTranscriptRef.current && ptyList.length > 0) {
      setSelectedId(ptyList[0]!.terminalId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptyIds]);
  useEffect(() => {
    if (
      autoSelectPtyTerminalId &&
      autoSelectPtyTerminalId !== selectedId &&
      ptyList.some((terminal) => terminal.terminalId === autoSelectPtyTerminalId)
    ) {
      setSelectedId(autoSelectPtyTerminalId);
      onAutoSelectPtyConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSelectPtyTerminalId, ptyIds]);

  const transcriptSignature = commandSessions
    .map((session) => `${session.processId}:${session.output?.length ?? 0}:${session.status}`)
    .join("|");
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [transcriptSignature, selectedPty?.terminalId]);

  // xterm 自己管焦点；transcript 是只读历史，不需要聚焦输入行。

  const handleCreateShell = (profileId?: TerminalShellProfileId) => {
    if (isDesktopTerminal) {
      onOpenTerminal?.();
      return;
    }
    const command = profileId ? resolveShellProfileCommand(profileId) ?? undefined : resolveShellProfileCommand(prefs.shellProfile) ?? undefined;
    setShellMenuAnchor(null);
    if (onCreatePtyTerminal) {
      onCreatePtyTerminal(terminalCwd || cwd, terminalSize, command);
      return;
    }
    onRunTerminalCommand(resolveTerminalFallbackSpawnCommand(terminalCwd || cwd), terminalCwd || cwd, terminalSize);
  };

  const handleKillAll = () => {
    for (const terminal of ptyList) {
      if (terminal.status === "running") onKillPtyTerminal?.(terminal.terminalId);
      else {
        onForgetPtyTerminal?.(terminal.terminalId);
        dropTerminalName(terminal.terminalId);
      }
    }
    setSelectedId(null);
  };

  const handleRename = (terminalId: string, name: string) => {
    const trimmed = name.trim().slice(0, 64);
    saveTerminalName(terminalId, trimmed);
    setNames((current) => {
      const next = { ...current };
      if (!trimmed) delete next[terminalId];
      else next[terminalId] = trimmed;
      return next;
    });
    setRenamingId(null);
  };

  const handleClearActive = () => {
    if (!selectedPty) {
      if (scrollRef.current) scrollRef.current.innerHTML = "";
      return;
    }
    getPtyTerminalHandle(selectedPty.terminalId)?.clear();
  };

  const handleSearch = (direction: 1 | -1) => {
    if (!selectedPty || !searchQuery.trim()) return false;
    return getPtyTerminalHandle(selectedPty.terminalId)?.[direction === 1 ? "findNext" : "findPrevious"](searchQuery, false) ?? false;
  };

  const updatePrefs = (patch: Partial<typeof prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      saveTerminalPreferences(next);
      return next;
    });
  };

  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Paper variant="outlined" sx={{ p: 1, m: 1, mb: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <TerminalIcon fontSize="small" color="primary" />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Terminal
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
              {terminalCwd || cwd}
            </Typography>
          </Box>
          <Button size="small" onClick={() => setSearchOpen((visible) => !visible)} aria-label="Search terminal">
            搜索
          </Button>
          <Button size="small" onClick={() => setShowSettings((visible) => !visible)}>
            设置
          </Button>
          <Tooltip title={isDesktopTerminal ? "打开系统终端" : "启动交互式 shell（默认配置）"}>
            <Button size="small" aria-label="Open terminal" onClick={() => handleCreateShell()}>
              +
            </Button>
          </Tooltip>
          {!isDesktopTerminal && (
            <Tooltip title="选择 shell 配置新建终端">
              <Button size="small" aria-label="New terminal with shell profile" onClick={(event) => setShellMenuAnchor(event.currentTarget)}>
                ▾
              </Button>
            </Tooltip>
          )}
          {ptyList.length > 0 && (
            <Tooltip title="终止全部终端">
              <Button size="small" aria-label="Kill all terminals" color="error" onClick={handleKillAll}>
                ✕
              </Button>
            </Tooltip>
          )}
          <Menu anchorEl={shellMenuAnchor} open={Boolean(shellMenuAnchor)} onClose={() => setShellMenuAnchor(null)}>
            {TERMINAL_SHELL_PROFILES.map((profile) => (
              <MenuItem
                key={profile.id}
                selected={profile.id === prefs.shellProfile}
                onClick={() => {
                  updatePrefs({ shellProfile: profile.id });
                  handleCreateShell(profile.id);
                }}
              >
                {profile.label}{profile.id === prefs.shellProfile ? " ✓" : ""}
              </MenuItem>
            ))}
          </Menu>
        </Stack>
        {ptyList.length > 0 && (
          <Stack direction="row" spacing={0.5} sx={{ mt: 1, overflowX: "auto", pb: 0.25 }} role="tablist" aria-label="Terminal sessions">
            {ptyList.map((terminal, index) => {
              const selected = terminal.terminalId === selectedPty?.terminalId;
              const label = terminalTabLabel(terminal, index, ptyList.length, names);
              if (renamingId === terminal.terminalId) {
                return (
                  <TextField
                    key={terminal.terminalId}
                    size="small"
                    autoFocus
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleRename(terminal.terminalId, renameDraft);
                      } else if (event.key === "Escape") {
                        setRenamingId(null);
                      }
                      event.stopPropagation();
                    }}
                    onBlur={() => handleRename(terminal.terminalId, renameDraft)}
                    inputProps={{ "aria-label": `Rename terminal ${terminal.terminalId}` }}
                    sx={{ width: 140 }}
                  />
                );
              }
              return (
                <Chip
                  key={terminal.terminalId}
                  size="small"
                  role="tab"
                  aria-selected={selected}
                  label={label}
                  title={`${terminal.cwd}${terminal.exitCode === undefined ? "" : ` · exit ${terminal.exitCode}`}`}
                  color={terminal.status === "running" ? "success" : selected ? "primary" : "default"}
                  variant={selected ? "filled" : "outlined"}
                  onClick={() => {
                    if (selected) {
                      // 亲手点回 transcript：之后不再自动抢回 shell。
                      manualTranscriptRef.current = true;
                      setSelectedId(null);
                    } else {
                      manualTranscriptRef.current = false;
                      setSelectedId(terminal.terminalId);
                    }
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setRenameDraft(names[terminal.terminalId] ?? "");
                    setRenamingId(terminal.terminalId);
                  }}
                  onDelete={() => {
                    if (terminal.status === "running") {
                      onKillPtyTerminal?.(terminal.terminalId);
                    } else {
                      onForgetPtyTerminal?.(terminal.terminalId);
                      dropTerminalName(terminal.terminalId);
                      setNames((current) => {
                        const next = { ...current };
                        delete next[terminal.terminalId];
                        return next;
                      });
                    }
                  }}
                  deleteIcon={
                    <Tooltip title={terminal.status === "running" ? "终止该会话" : "移除该页签"}>
                      <CloseIcon fontSize="small" aria-label={terminal.status === "running" ? "Terminate terminal" : "Forget terminal"} />
                    </Tooltip>
                  }
                />
              );
            })}
          </Stack>
        )}
        {searchOpen && (
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center">
            <TextField
              size="small"
              label="Find in terminal"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSearch(event.shiftKey ? -1 : 1);
                } else if (event.key === "Escape") {
                  getPtyTerminalHandle(selectedPty?.terminalId ?? "")?.clearSearchDecorations();
                  setSearchOpen(false);
                }
              }}
              inputProps={{ "aria-label": "Search terminal buffer" }}
              sx={{ flex: 1 }}
            />
            <Button size="small" disabled={!searchQuery.trim()} onClick={() => handleSearch(-1)} aria-label="Find previous">
              ↑
            </Button>
            <Button size="small" disabled={!searchQuery.trim()} onClick={() => handleSearch(1)} aria-label="Find next">
              ↓
            </Button>
          </Stack>
        )}
        {showSettings && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label="Command cwd"
              value={terminalCwd}
              onChange={(event) => setTerminalCwd(event.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="Rows"
              type="number"
              value={terminalSize.rows}
              onChange={(event) => setTerminalSize((current) => ({ ...current, rows: Math.max(1, Number(event.target.value) || current.rows) }))}
              sx={{ width: 80 }}
            />
            <TextField
              size="small"
              label="Cols"
              type="number"
              value={terminalSize.cols}
              onChange={(event) => setTerminalSize((current) => ({ ...current, cols: Math.max(1, Number(event.target.value) || current.cols) }))}
              sx={{ width: 80 }}
            />
            <TextField
              size="small"
              label="Font size"
              type="number"
              value={prefs.fontSize}
              onChange={(event) => updatePrefs({ fontSize: Math.min(32, Math.max(8, Number(event.target.value) || prefs.fontSize)) })}
              sx={{ width: 80 }}
            />
            <TextField
              size="small"
              label="Scrollback"
              type="number"
              value={prefs.scrollback}
              onChange={(event) => updatePrefs({ scrollback: Math.min(100000, Math.max(100, Number(event.target.value) || prefs.scrollback)) })}
              sx={{ width: 100 }}
            />
            <TextField
              size="small"
              select
              label="Default shell"
              value={prefs.shellProfile}
              onChange={(event) => updatePrefs({ shellProfile: event.target.value as TerminalShellProfileId })}
              sx={{ width: 150 }}
              SelectProps={{ native: true }}
            >
              {TERMINAL_SHELL_PROFILES.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.label}</option>
              ))}
            </TextField>
            <Button size="small" disabled={!runningCommand} onClick={() => runningCommand && onResizeTerminal(runningCommand.processId, terminalSize)}>
              Resize
            </Button>
            <Button
              size="small"
              color="error"
              disabled={!runningCommand}
              startIcon={<DeleteIcon />}
              onClick={() => runningCommand && onTerminateTerminal(runningCommand.processId)}
            >
              Terminate
            </Button>
            <Button size="small" onClick={handleClearActive} aria-label="Clear terminal">
              Clear
            </Button>
            <Button size="small" onClick={() => setMaximized((current) => !current)} aria-label={maximized ? "Restore terminal" : "Maximize terminal"}>
              {maximized ? "Restore" : "Maximize"}
            </Button>
          </Stack>
        )}
      </Paper>

      <Box sx={{ flex: 1, minHeight: 0, p: 1 }}>
        <Box
          sx={{
            height: "100%",
            minHeight: 160,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            bgcolor: "#101418",
            color: "#e7edf2",
            borderRadius: 1,
            p: 1,
            fontFamily: "monospace",
            fontSize: 12
          }}
        >
          {selectedPty ? (
            <Box sx={{ flex: 1, minHeight: 0 }}>
              <PtyTerminalView
                key={`${selectedPty.terminalId}:${prefs.fontSize}:${prefs.scrollback}:${maximized}`}
                terminalId={selectedPty.terminalId}
                cwd={selectedPty.cwd}
                exited={selectedPty.status !== "running"}
                fontSize={prefs.fontSize}
                scrollback={prefs.scrollback}
                onWrite={onWritePtyTerminal ?? (() => {})}
                onResize={onResizePtyTerminal ?? (() => {})}
                onLoadTail={onLoadPtyTail ?? (async () => "")}
              />
            </Box>
          ) : (
            <Box
              ref={scrollRef}
              sx={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere"
              }}
            >
              {commandSessions.length === 0 && (
                <Typography component="div" sx={{ color: "#5b6570", fontFamily: "monospace", fontSize: 12 }}>
                  暂无 transcript 历史。输入命令，回车运行；点 + 号启动交互式 shell，键盘直接敲进去（VSCode 形态）。
                </Typography>
              )}
              {commandSessions.map((session) => (
                <Box key={session.processId} component="div" sx={{ m: 0, mt: 0.5 }}>
                  <Typography component="div" sx={{ color: "#4cc38a", fontWeight: 700 }}>
                    $ {session.command}
                  </Typography>
                  <Box component="div">{transcriptBody(session) || (session.status === "running" ? "…" : "")}</Box>
                  {(session.status === "failed" || session.status === "terminated") && (
                    <Typography component="div" sx={{ color: "#5b6570" }}>
                      — {terminalStatusLabel(session)} —
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          )}
          {/* VSCode 形态：无底部输入行，键盘直进 xterm；transcript 只读。 */}
        </Box>
      </Box>
    </Box>
  );
}

// App 在每个会话 output 开头预置 `$ <command>\n` 回显；transcript 自带 `$` 头行，
// 这里去掉首行避免重复显示。
function transcriptBody(session: TerminalSession): string {
  const cleaned = stripTerminalAnsi(session.output);
  const firstNewline = cleaned.indexOf("\n");
  if (firstNewline >= 0 && cleaned.slice(0, firstNewline) === `$ ${session.command}`) {
    return cleaned.slice(firstNewline + 1);
  }
  return cleaned;
}

function terminalStatusLabel(session: TerminalSession): string {
  if (session.status === "completed") {
    return session.exitCode == null ? "exit" : `exit ${session.exitCode}`;
  }
  return session.exitCode == null ? session.status : `${session.status} ${session.exitCode}`;
}
