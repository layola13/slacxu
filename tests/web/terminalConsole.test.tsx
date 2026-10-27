import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TERMINAL_SHELL_SPAWN_COMMAND, TerminalConsole, detectInteractiveFullscreenCommand, stripTerminalAnsi } from "../../apps/web/src/components/TerminalConsole";
import { sanitizePtyTailForReplay } from "../../apps/web/src/components/PtyTerminalView";
import { PtyTerminalView } from "../../apps/web/src/components/PtyTerminalView";
import { publishPtyData, publishPtyExit, subscribePtyTerminal } from "../../apps/web/src/ptyDataBus";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined }
});

test("TerminalConsole has no bottom input (VSCode style, xterm only)", () => {
  const html = renderToStaticMarkup(
    <TerminalConsole
      cwd="/workspace/test-app"
      terminalSessions={[]}
      onRunTerminalCommand={() => {}}
      onWriteTerminalInput={() => {}}
      onTerminateTerminal={() => {}}
      onResizeTerminal={() => {}}
      onOpenTerminal={() => {}}
    />
  );
  expect(html).not.toContain('aria-label="Terminal input"');
  expect(html).toContain('aria-label="Open terminal"');
  expect(html).toContain("交互式 shell");
});

test("TerminalConsole renders completed commands as one transcript without tabs", () => {
  const html = renderToStaticMarkup(
    <TerminalConsole
      cwd="/workspace/test-app"
      terminalSessions={[
        {
          processId: "term-2",
          command: "pwd",
          cwd: "/workspace/test-app",
          output: "$ pwd\n/workspace/test-app\n",
          status: "completed",
          exitCode: 0,
          rows: 24,
          cols: 80
        },
        {
          processId: "term-1",
          command: "ls",
          cwd: "/workspace/test-app",
          output: "$ ls\nAGENTS.md\n",
          status: "completed",
          exitCode: 0,
          rows: 24,
          cols: 80
        }
      ]}
      onRunTerminalCommand={() => {}}
      onWriteTerminalInput={() => {}}
      onTerminateTerminal={() => {}}
      onResizeTerminal={() => {}}
      onOpenTerminal={() => {}}
    />
  );
  // 时间正序：ls 在前，pwd 在后；回显首行不重复；无 tablist；exit 0 不刷状态行
  expect(html.indexOf("$ ls")).toBeLessThan(html.indexOf("$ pwd"));
  expect(html).toContain("AGENTS.md");
  expect(html).toContain("/workspace/test-app");
  expect(html).not.toContain('aria-label="Terminal sessions"');
  expect(html).not.toContain("— exit 0 —");
  expect(html).not.toContain('aria-label="Terminal input"');
});

test("TerminalConsole shows failed commands with status but keeps transcript", () => {
  const html = renderToStaticMarkup(
    <TerminalConsole
      cwd="/workspace/test-app"
      terminalSessions={[
        {
          processId: "term-1",
          command: "cxu --version",
          cwd: "/workspace/test-app",
          output: "$ cxu --version\ncxu v0.2.53\n",
          status: "failed",
          exitCode: 124,
          rows: 24,
          cols: 80
        }
      ]}
      onRunTerminalCommand={() => {}}
      onWriteTerminalInput={() => {}}
      onTerminateTerminal={() => {}}
      onResizeTerminal={() => {}}
      onOpenTerminal={() => {}}
    />
  );
  expect(html).toContain("cxu v0.2.53");
  expect(html).toContain("— failed 124 —");
  expect(html).not.toContain('aria-label="Terminal sessions"');
});

test("TerminalConsole renders resident pty shells as tabs with terminate control", () => {
  const html = renderToStaticMarkup(
    <TerminalConsole
      cwd="/workspace/test-app"
      terminalSessions={[]}
      ptyTerminals={[
        {
          terminalId: "term-aaa",
          cwd: "/workspace/test-app",
          cols: 80,
          rows: 24,
          status: "running",
          createdAt: 1
        }
      ]}
      onRunTerminalCommand={() => {}}
      onWriteTerminalInput={() => {}}
      onTerminateTerminal={() => {}}
      onResizeTerminal={() => {}}
      onOpenTerminal={() => {}}
      onCreatePtyTerminal={() => {}}
      onWritePtyTerminal={() => {}}
      onKillPtyTerminal={() => {}}
      onForgetPtyTerminal={() => {}}
      onResizePtyTerminal={() => {}}
      onLoadPtyTail={async () => ""}
    />
  );
  expect(html).toContain('aria-label="Terminal sessions"');
  expect(html).toContain("bash");
  expect(html).toContain("running");
  expect(html).toContain('aria-label="Terminate terminal"');
  // VSCode parity: New Terminal stays available while shells run (the ▾ menu
  // picks the shell profile); unselected tabs fall back to the transcript.
  expect(html).toContain('aria-label="Open terminal"');
  expect(html).toContain("输入命令，回车运行");
});

test("PtyTerminalView static render is an SSR-safe placeholder", () => {
  const html = renderToStaticMarkup(
    <PtyTerminalView
      terminalId="term-aaa"
      cwd="/workspace/test-app"
      exited={false}
      onWrite={() => {}}
      onResize={() => {}}
      onLoadTail={async () => ""}
    />
  );
  expect(html).toContain('data-testid="pty-terminal-view"');
  expect(html).toContain('data-terminal-id="term-aaa"');
  expect(html).toContain("/workspace/test-app");
});

test("ptyDataBus routes data and exit to subscribers only", () => {
  const seen: string[] = [];
  const exits: number[] = [];
  const other: string[] = [];
  const offA = subscribePtyTerminal(
    "term-a",
    (chunk) => seen.push(chunk),
    (code) => exits.push(code)
  );
  const offB = subscribePtyTerminal(
    "term-b",
    (chunk) => other.push(chunk),
    () => {}
  );
  publishPtyData("term-a", "hello");
  publishPtyData("term-b", "nope");
  publishPtyExit("term-a", 0);
  expect(seen).toEqual(["hello"]);
  expect(other).toEqual(["nope"]);
  expect(exits).toEqual([0]);
  offA();
  offB();
  publishPtyData("term-a", "late");
  expect(seen).toEqual(["hello"]);
});

test("shell spawn command avoids job-control, history-file and readline noise", () => {
  expect(TERMINAL_SHELL_SPAWN_COMMAND).toContain("HISTFILE=/dev/null");
  expect(TERMINAL_SHELL_SPAWN_COMMAND).toContain("TERM=dumb");
  expect(TERMINAL_SHELL_SPAWN_COMMAND).toContain("--noediting");
  expect(TERMINAL_SHELL_SPAWN_COMMAND).toContain("+m");
});

test("stripTerminalAnsi removes CSI/OSC sequences but keeps text", () => {
  const esc = String.fromCharCode(27);
  expect(stripTerminalAnsi(`${esc}[?2004h${esc}[01;34m/content${esc}[00m${esc}[?2004l`)).toBe("/content");
  expect(stripTerminalAnsi(`${esc}]0;title${String.fromCharCode(7)}hello`)).toBe("hello");
  expect(stripTerminalAnsi("$ ls\nAGENTS.md\n")).toBe("$ ls\nAGENTS.md\n");
  expect(stripTerminalAnsi("cxu v0.2.53")).toBe("cxu v0.2.53");
});

test("TerminalConsole renders stripped output without raw escape text", () => {
  const esc = String.fromCharCode(27);
  const html = renderToStaticMarkup(
    <TerminalConsole
      cwd="/workspace/test-app"
      terminalSessions={[
        {
          processId: "term-1",
          command: "bash",
          cwd: "/workspace/test-app",
          output: `$ bash\n${esc}[?2004h${esc}[01;34m/content${esc}[00m\n`,
          status: "running",
          rows: 24,
          cols: 80
        }
      ]}
      onRunTerminalCommand={() => {}}
      onWriteTerminalInput={() => {}}
      onTerminateTerminal={() => {}}
      onResizeTerminal={() => {}}
      onOpenTerminal={() => {}}
    />
  );
  expect(html).toContain("/content");
  expect(html).not.toContain("[?2004h");
  expect(html).not.toContain("[01;34m");
});

test("detectInteractiveFullscreenCommand flags fullscreen TUIs for PTY routing", () => {
  // Transcript can never pin a refresh frame: these must go to resident PTY.
  expect(detectInteractiveFullscreenCommand("top")).toBe("top");
  expect(detectInteractiveFullscreenCommand("top -d 2")).toBe("top");
  expect(detectInteractiveFullscreenCommand("  htop  ")).toBe("htop");
  expect(detectInteractiveFullscreenCommand("sudo top")).toBe("top");
  expect(detectInteractiveFullscreenCommand("/usr/bin/top")).toBe("/usr/bin/top");
  expect(detectInteractiveFullscreenCommand("vim README.md")).toBe("vim");
  expect(detectInteractiveFullscreenCommand("codex")).toBe("codex");
  expect(detectInteractiveFullscreenCommand("watch -n1 ls")).toBe("watch");
  expect(detectInteractiveFullscreenCommand("man ls")).toBe("man");
  expect(detectInteractiveFullscreenCommand("VAR=x top")).toBe("top");
  // Batch/plain-text modes stay legal in the transcript.
  expect(detectInteractiveFullscreenCommand("top -b -n1")).toBeNull();
  expect(detectInteractiveFullscreenCommand("top --batch")).toBeNull();
  expect(detectInteractiveFullscreenCommand("top | head -5")).toBeNull();
  expect(detectInteractiveFullscreenCommand("codex exec \"do it\"")).toBeNull();
  expect(detectInteractiveFullscreenCommand("codex --help")).toBeNull();
  expect(detectInteractiveFullscreenCommand("codex \"hello\"")).toBeNull();
  expect(detectInteractiveFullscreenCommand("ls -la")).toBeNull();
  expect(detectInteractiveFullscreenCommand("tail -f app.log")).toBeNull();
  expect(detectInteractiveFullscreenCommand("ping -c2 example.com")).toBeNull();
  expect(detectInteractiveFullscreenCommand("")).toBeNull();
});

test("sanitizePtyTailForReplay keeps clean scrollback untouched", () => {
  const esc = String.fromCharCode(27);
  const tail = `${esc}[01;34m/content${esc}[00m# pwd\r\n/content\r\n`;
  expect(sanitizePtyTailForReplay(tail)).toEqual({ text: tail, exitAltScreen: false });
  expect(sanitizePtyTailForReplay("")).toEqual({ text: "", exitAltScreen: false });
});

test("sanitizePtyTailForReplay cuts a trailing split escape sequence", () => {
  const esc = String.fromCharCode(27);
  // 64KB slice landed mid-CSI: the orphan would print as a literal garbage line.
  expect(sanitizePtyTailForReplay(`ls output\n${esc}[01;`)).toEqual({ text: "ls output\n", exitAltScreen: false });
  expect(sanitizePtyTailForReplay(`prompt# ${esc}`)).toEqual({ text: "prompt# ", exitAltScreen: false });
  // Split OSC (title) at the tail end.
  expect(sanitizePtyTailForReplay(`ok\n${esc}]0;ti`)).toEqual({ text: "ok\n", exitAltScreen: false });
  // Complete sequences survive.
  expect(sanitizePtyTailForReplay(`a${esc}[0m`)).toEqual({ text: `a${esc}[0m`, exitAltScreen: false });
});

test("sanitizePtyTailForReplay drops dead fullscreen residue but keeps live TUIs", () => {
  const esc = String.fromCharCode(27);
  // Killed top: alt-enter unmatched, shell kept writing after -> cut + pin normal buffer.
  const dead = `${esc}[?1049htop frame${esc}[H$ echo hi\n`;
  expect(sanitizePtyTailForReplay(dead)).toEqual({ text: "", exitAltScreen: true });
  // Still-running TUI: tail ends inside the frame, no shell output after -> rejoin alt-screen.
  const live = `${esc}[?1049hvim frame${esc}[Hline1`;
  expect(sanitizePtyTailForReplay(live)).toEqual({ text: live, exitAltScreen: false });
  // Cleanly exited TUI (matched pair) replays untouched.
  const clean = `${esc}[?1049hframe${esc}[?1049l$ \n`;
  expect(sanitizePtyTailForReplay(clean)).toEqual({ text: clean, exitAltScreen: false });
});
