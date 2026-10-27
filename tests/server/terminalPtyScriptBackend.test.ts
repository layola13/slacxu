import { beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  createTerminalPty,
  forgetTerminalPty,
  killTerminalPty,
  listTerminalPtys,
  readTerminalPty,
  resetTerminalPtyBackendProbe,
  resetTerminalPtyLoader,
  setTerminalPtyLoader,
  writeTerminalPty
} from "../../apps/server/src/terminalPty";

beforeEach(() => {
  process.env.CODEX_UI_TERMINAL_PTY_BACKEND = "script";
  resetTerminalPtyBackendProbe();
  for (const entry of listTerminalPtys()) {
    try {
      forgetTerminalPty(entry.id);
    } catch {
      // Best effort cleanup.
    }
  }
});

const hasScriptBackend =
  process.platform !== "win32" && (existsSync("/usr/bin/script") || existsSync("/bin/script"));

// Production path on Bun runtimes (where node-pty cannot hold a session):
// a real login shell behind `script(1)` with kernel job control.
(test.skipIf ? test.skipIf(!hasScriptBackend) : test)(
  "script backend runs a persistent shell with working Ctrl+C",
  async () => {
    process.env.CODEX_UI_TERMINAL_PTY_BACKEND = "script";
    resetTerminalPtyBackendProbe();
    try {
      const seen: string[] = [];
      let exitCode: number | null = null;
      const info = await createTerminalPty(
        { cwd: "/tmp", cols: 80, rows: 24 },
        {
          onData: (_id, chunk) => seen.push(chunk),
          onExit: (_id, code) => {
            exitCode = code;
          }
        }
      );
      expect(info.backend).toBe("script");
      expect(info.status).toBe("running");

      writeTerminalPty(info.id, "echo SCRIPT_BACKEND_OK\r");
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !seen.join("").includes("SCRIPT_BACKEND_OK")) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(seen.join("")).toContain("SCRIPT_BACKEND_OK");

      // Ctrl+C kills the foreground sleep but the shell survives (job control).
      writeTerminalPty(info.id, "sleep 30\r");
      await new Promise((resolve) => setTimeout(resolve, 800));
      writeTerminalPty(info.id, "\x03");
      await new Promise((resolve) => setTimeout(resolve, 800));
      writeTerminalPty(info.id, "echo AFTER_CTRLC\r");
      const deadline2 = Date.now() + 15_000;
      while (Date.now() < deadline2 && !seen.join("").includes("AFTER_CTRLC")) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(seen.join("")).toContain("AFTER_CTRLC");
      expect(exitCode).toBeNull();

      expect(readTerminalPty(info.id).tail.length).toBeGreaterThan(0);
      killTerminalPty(info.id);
      const deadline3 = Date.now() + 15_000;
      while (Date.now() < deadline3 && exitCode === null) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(exitCode).not.toBeNull();
      forgetTerminalPty(info.id);
    } finally {
      delete process.env.CODEX_UI_TERMINAL_PTY_BACKEND;
      resetTerminalPtyBackendProbe();
      resetTerminalPtyLoader();
    }
  },
  60_000
);
(test.skipIf ? test.skipIf(!hasScriptBackend) : test)(
  "backend probe falls back to script when node-pty dies fast",
  async () => {
    delete process.env.CODEX_UI_TERMINAL_PTY_BACKEND;
    resetTerminalPtyBackendProbe();
    // A node-pty that SIGHUPs everything immediately (the Bun failure mode).
    setTerminalPtyLoader(async () => ({
      spawn: (() => {
        const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();
        queueMicrotask(() => {
          for (const listener of exitListeners) listener({ exitCode: 0, signal: 1 });
        });
        return {
          onData: (_listener: (chunk: string) => void) => {},
          onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
            exitListeners.add(listener);
          },
          write: (_data: string) => {},
          resize: (_cols: number, _rows: number) => {},
          kill: (_signal?: string) => {}
        };
      }) as unknown as typeof import("node-pty").spawn
    }));
    try {
      const info = await createTerminalPty({ cwd: "/tmp" }, { onData: () => {}, onExit: () => {} });
      expect(info.backend).toBe("script");
      expect(info.status).toBe("running");
      killTerminalPty(info.id);
      forgetTerminalPty(info.id);
    } finally {
      resetTerminalPtyLoader();
    }
  },
  60_000
);

