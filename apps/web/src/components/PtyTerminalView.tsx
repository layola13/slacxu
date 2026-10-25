import { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { subscribePtyTerminal } from "../ptyDataBus";
import { createBufferSearch, registerPtyTerminalHandle } from "../ptyTerminalRegistry";

type Props = {
  terminalId: string;
  cwd: string;
  exited: boolean;
  onWrite: (terminalId: string, data: string) => void;
  onResize: (terminalId: string, size: { cols: number; rows: number }) => void;
  onLoadTail: (terminalId: string) => Promise<string>;
};

const ALT_ENTER_RE = /\x1b\[\?(47|1047|1049)h|\x9b\?(47|1049|1047)h/g;
const ALT_EXIT_RE = /\x1b\[\?(47|1047|1049)l|\x9b\?(47|1049|1047)l/g;
// A tail slice is byte-blind: it may cut a sequence in half. Strip a trailing
// fragment so the fresh emulator never prints half a CSI/OSC literally.
const TRAILING_PARTIAL_RES = [
  /\x1b$/,
  /\x9b$/,
  /\x1b\[[0-9;?]*$/,
  /\x9b[0-9;?]*$/,
  /\x1b\][^\x07\x1b]*$/,
  /\x9b\][^\x07\x1b]*$/,
  /\x1b[#()%][0-9A-Z]?$/,
];

/** Drop a trailing incomplete escape sequence (repeat: `\x1b` + `\x1b[` can split twice). */
function cutTrailingPartialEscape(text: string): string {
  let current = text;
  for (let i = 0; i < 3; i += 1) {
    const next = TRAILING_PARTIAL_RES.reduce((acc, re) => acc.replace(re, ""), current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

export interface SanitizedPtyTail {
  /** Replay-safe bytes for a fresh emulator. */
  text: string;
  /** True when dead fullscreen residue was cut: force the normal buffer after replay. */
  exitAltScreen: boolean;
}

/**
 * Make a scrollback tail safe to replay into a fresh xterm (remounts, tab
 * switches). Two hazards, both observed in production:
 * 1. The slice can cut an escape sequence in half; the orphaned continuation
 *    then prints as literal garbage (e.g. a `0MMMM…` line).
 * 2. A killed fullscreen app (top/vim/codex) leaves an alt-screen enter
 *    without its exit; replaying it parks the fresh emulator in the alt
 *    buffer, so the normal screen stays blank and the cursor looks frozen.
 *    Shell output *after* the unmatched enter proves the TUI is dead — cut
 *    the residue and force the normal buffer. A tail that *ends* inside the
 *    frame (no trailing newline) is a still-running TUI: replay it as-is so
 *    the emulator rejoins the alt-screen and live bytes keep working.
 */
export function sanitizePtyTailForReplay(tail: string): SanitizedPtyTail {
  if (!tail) return { text: "", exitAltScreen: false };
  const text = cutTrailingPartialEscape(tail);
  const enters = [...text.matchAll(ALT_ENTER_RE)];
  if (enters.length === 0) return { text, exitAltScreen: false };
  const exits = [...text.matchAll(ALT_EXIT_RE)].length;
  if (enters.length <= exits) return { text, exitAltScreen: false };
  const firstUnmatched = enters[exits]!;
  const after = text.slice(firstUnmatched.index + firstUnmatched[0].length);
  if (!after.includes("\n")) {
    // Still-running TUI: keep the frame, the emulator rejoins alt-screen.
    return { text, exitAltScreen: false };
  }
  // Dead fullscreen residue: cut it and pin the normal buffer afterwards.
  return { text: cutTrailingPartialEscape(text.slice(0, firstUnmatched.index)), exitAltScreen: true };
}

const FORCE_NORMAL_BUFFER = "\x1b[?1049l\x1b[?1047l\x1b[?47l";

/**
 * Resident-terminal view (orca-style): a real xterm.js emulator bound to a
 * server-owned PTY. Raw bytes flow straight into the emulator — colors,
 * cursor movement, alt-screen (top/vim) all render natively.
 * Keystrokes (including Ctrl+C) go straight to the PTY; the kernel's job
 * control delivers SIGINT, so no special-case interrupt handling is needed.
 *
 * xterm is dynamically imported so SSR / static render stays a placeholder.
 */
export function PtyTerminalView({ terminalId, cwd, exited, onWrite, onResize, onLoadTail, fontSize = 12, scrollback = 5000 }: Props & { fontSize?: number; scrollback?: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onWrite, onResize, onLoadTail });
  callbacksRef.current = { onWrite, onResize, onLoadTail };

  useEffect(() => {
    let disposed = false;
    let terminal: { dispose: () => void } | null = null;
    let unsubscribe: (() => void) | null = null;
    let unregisterHandle: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("xterm"), import("@xterm/addon-fit")]);
      if (disposed || !hostRef.current) return;
      const term = new Terminal({
        cursorBlink: true,
        fontSize,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        scrollback,
        theme: {
          background: "#101418",
          foreground: "#e7edf2",
          cursor: "#4cc38a",
          selectionBackground: "rgba(76, 195, 138, 0.3)"
        }
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      terminal = term;
      try {
        fit.fit();
      } catch {
        // Host not laid out yet; the observer below retries on resize.
      }
      try {
        // VSCode 形态：挂载即聚焦，键盘直接进 shell，不经过底部输入行。
        term.focus();
      } catch {
        // 无头/测试环境没有焦点概念，忽略。
      }
      try {
        const tail = await callbacksRef.current.onLoadTail(terminalId);
        if (!disposed && tail) {
          const replay = sanitizePtyTailForReplay(tail);
          if (replay.text) term.write(replay.text);
          // Dead fullscreen residue was cut above; make sure the fresh
          // emulator sits in the normal buffer instead of a stale alt-screen.
          if (replay.exitAltScreen) term.write(FORCE_NORMAL_BUFFER);
        }
      } catch {
        // Scrollback is best-effort; live bytes still stream in.
      }
      unsubscribe = subscribePtyTerminal(
        terminalId,
        (chunk) => {
          try {
            term.write(chunk);
          } catch {
            // Ignore writes racing disposal.
          }
        },
        () => {
          try {
            term.write("\r\n— shell exited —\r\n");
          } catch {
            // Ignore writes racing disposal.
          }
        }
      );
      term.onData((data) => {
        callbacksRef.current.onWrite(terminalId, data);
      });
      const search = createBufferSearch(term);
      unregisterHandle = registerPtyTerminalHandle(terminalId, {
        findNext: search.findNext,
        findPrevious: search.findPrevious,
        clearSearchDecorations: () => term.clearSelection(),
        clear: () => term.clear(),
        focus: () => {
          try {
            term.focus();
          } catch {
            // Headless/test environments have no focus concept.
          }
        }
      });
      if (typeof ResizeObserver !== "undefined" && hostRef.current) {
        resizeObserver = new ResizeObserver(() => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            if (disposed) return;
            try {
              // orca parity: only the visible pane owns the size. A hidden
              // document must not SIGWINCH the shell (TUI flicker / reflow
              // garbage); the next visible tick resyncs.
              if (typeof document !== "undefined" && document.hidden) return;
              // Skip ticks while the host has no real layout: fit() on a
              // zero-size box yields bogus dims that reflow the shell into
              // garbage (blank gaps / wrapped control lines).
              const host = hostRef.current;
              if (!host || host.clientWidth < 50 || host.clientHeight < 50) return;
              fit.fit();
              const dims = { cols: term.cols, rows: term.rows };
              if (dims.cols > 0 && dims.rows > 0) {
                callbacksRef.current.onResize(terminalId, dims);
              }
            } catch {
              // Ignore resize races during disposal.
            }
          }, 200);
        });
        resizeObserver.observe(hostRef.current);
      }
    })().catch(() => {
      // xterm failed to load; the placeholder below stays visible.
    });

    return () => {
      disposed = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      unsubscribe?.();
      unregisterHandle?.();
      terminal?.dispose();
      terminal = null;
    };
  }, [terminalId, fontSize, scrollback]);

  return (
    <Box
      sx={{
        height: "100%",
        minHeight: 160,
        overflow: "hidden",
        bgcolor: "#101418",
        borderRadius: 1,
        p: 1,
        cursor: "text"
      }}
      onClick={() => hostRef.current?.querySelector("textarea")?.focus()}
    >
      <Typography
        variant="caption"
        sx={{ display: "block", color: "#5b6570", fontFamily: "monospace", mb: 0.5 }}
      >
        {exited ? "— shell exited —" : cwd}
      </Typography>
      <Box ref={hostRef} data-testid="pty-terminal-view" data-terminal-id={terminalId} sx={{ height: "calc(100% - 22px)", minHeight: 120 }} />
    </Box>
  );
}
