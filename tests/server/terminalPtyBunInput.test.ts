import { beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import {
  createTerminalPty,
  forgetTerminalPty,
  listTerminalPtys,
  patchBunWindowsPtyInput,
  readTerminalPty,
  resetTerminalPtyBackendProbe,
  resetTerminalPtyLoader,
  writeTerminalPty
} from "../../apps/server/src/terminalPty";

const isWin32Bun = process.platform === "win32" && Boolean((process.versions as Record<string, string | undefined> | undefined)?.bun);

beforeEach(() => {
  process.env.CODEX_UI_TERMINAL_PTY_BACKEND = "node-pty";
  delete process.env.CODEX_UI_TERMINAL_PTY_FD_PATCH;
  resetTerminalPtyLoader();
  resetTerminalPtyBackendProbe();
  for (const entry of listTerminalPtys()) {
    try {
      forgetTerminalPty(entry.id);
    } catch {
      // Best effort cleanup.
    }
  }
});

describe("terminalPty Bun/Windows input patch", () => {
  test("patch is idempotent and keeps plain sockets intact", () => {
    if (!isWin32Bun) return;
    patchBunWindowsPtyInput();
    patchBunWindowsPtyInput();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const net = require("node:net") as typeof import("node:net");
    const socket = new net.Socket();
    expect(socket.destroyed).toBe(false);
    socket.destroy();
  });

  test("kill switch disables the patch", () => {
    if (!isWin32Bun) return;
    process.env.CODEX_UI_TERMINAL_PTY_FD_PATCH = "0";
    patchBunWindowsPtyInput();
    delete process.env.CODEX_UI_TERMINAL_PTY_FD_PATCH;
  });

  test(
    "real shell echoes written input (Bun conin regression)",
    async () => {
      if (!isWin32Bun) return;
      const marker = `pty-bun-input-ok-${Date.now().toString(36)}`;
      let terminalId: string | null = null;
      try {
        const info = await createTerminalPty(
          { cwd: tmpdir(), cols: 80, rows: 24 },
          { onData: () => {}, onExit: () => {} }
        );
        terminalId = info.id;
        expect(info.backend).toBe("node-pty");
        // Wait for the shell prompt before writing (cold pwsh takes seconds).
        await new Promise((resolve) => setTimeout(resolve, 4000));
        writeTerminalPty(terminalId, `echo ${marker}\r`);
        const deadline = Date.now() + 15000;
        let tail = "";
        for (;;) {
          tail = readTerminalPty(terminalId).tail;
          if (tail.includes(marker)) break;
          if (Date.now() > deadline) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        expect(tail.includes(marker)).toBe(true);
      } finally {
        if (terminalId) {
          try {
            const { killTerminalPty } = await import("../../apps/server/src/terminalPty");
            killTerminalPty(terminalId);
          } catch {
            // Best effort.
          }
          forgetTerminalPty(terminalId);
        }
      }
    },
    30000
  );
});
