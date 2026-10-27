import { beforeEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  createTerminalPty,
  detectScreenSeq,
  forgetTerminalPty,
  getTerminalPty,
  isTerminalPtyEnabled,
  killTerminalPty,
  listTerminalPtys,
  ptySpawnExtraOptions,
  readTerminalPty,
  resetTerminalPtyBackendProbe,
  resetTerminalPtyLoader,
  resizeTerminalPty,
  setTerminalPtyLoader,
  writeTerminalPty
} from "../../apps/server/src/terminalPty";

// Module state (registry, backend probe, env override) is shared across test
// files in one bun process — reset before each test to prevent cross-talk.
beforeEach(() => {
  // Pin the backend to skip the 400ms probe; the probe fallback has its own test.
  process.env.CODEX_UI_TERMINAL_PTY_BACKEND = "node-pty";
  resetTerminalPtyBackendProbe();
  for (const entry of listTerminalPtys()) {
    try {
      forgetTerminalPty(entry.id);
    } catch {
      // Best effort cleanup.
    }
  }
});

type FakePty = {
  written: string[];
  killed: boolean;
  resized: Array<{ cols: number; rows: number }>;
  dataListener: ((chunk: string) => void) | null;
  exitListener: ((event: { exitCode: number; signal?: string }) => void) | null;
  onData: (listener: (chunk: string) => void) => void;
  onExit: (listener: (event: { exitCode: number; signal?: string }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
};

function installFakePty(spawned: FakePty[]) {
  setTerminalPtyLoader(async () => ({
    spawn: ((file: string, args: string[], options: Record<string, unknown>) => {
      const fake: FakePty = {
        written: [],
        killed: false,
        resized: [],
        dataListener: null,
        exitListener: null,
        onData(listener) {
          fake.dataListener = listener;
        },
        onExit(listener) {
          fake.exitListener = listener;
        },
        write(data: string) {
          fake.written.push(data);
        },
        resize(cols: number, rows: number) {
          fake.resized.push({ cols, rows });
        },
        kill() {
          fake.killed = true;
        }
      };
      void file;
      void args;
      void options;
      spawned.push(fake);
      return fake;
    }) as unknown as typeof import("node-pty").spawn
  }));
}

test("terminal pty is enabled by default and honors the kill switch", () => {
  delete process.env.CODEX_UI_TERMINAL_PTY;
  expect(isTerminalPtyEnabled()).toBe(true);
  process.env.CODEX_UI_TERMINAL_PTY = "0";
  expect(isTerminalPtyEnabled()).toBe(false);
  delete process.env.CODEX_UI_TERMINAL_PTY;
});

test("create/write/resize/read/kill lifecycle with scrollback", async () => {
  const spawned: FakePty[] = [];
  installFakePty(spawned);
  try {
    const data: Array<{ id: string; chunk: string }> = [];
    const exits: Array<{ id: string; code: number }> = [];
    const info = await createTerminalPty(
      { cwd: "/tmp", cols: 80, rows: 24 },
      {
        onData: (id, chunk) => data.push({ id, chunk }),
        onExit: (id, code) => exits.push({ id, code })
      }
    );
    expect(info.status).toBe("running");
    expect(info.cwd).toBe(resolve("/tmp"));
    expect(spawned).toHaveLength(1);

    writeTerminalPty(info.id, "echo hi\r");
    expect(spawned[0]!.written).toEqual(["echo hi\r"]);

    spawned[0]!.dataListener?.("hello ");
    spawned[0]!.dataListener?.("world");
    expect(data.map((entry) => entry.chunk).join("")).toBe("hello world");
    expect(readTerminalPty(info.id).tail).toBe("hello world");

    const resized = resizeTerminalPty(info.id, 100, 30);
    expect(resized.cols).toBe(100);
    expect(resized.rows).toBe(30);
    expect(spawned[0]!.resized).toEqual([{ cols: 100, rows: 30 }]);

    spawned[0]!.exitListener?.({ exitCode: 0 });
    expect(exits).toEqual([{ id: info.id, code: 0 }]);
    expect(getTerminalPty(info.id)?.status).toBe("exited");
    expect(() => writeTerminalPty(info.id, "x")).toThrow();

    expect(listTerminalPtys().some((entry) => entry.id === info.id)).toBe(true);
    expect(forgetTerminalPty(info.id)).toBe(true);
    expect(getTerminalPty(info.id)).toBeNull();
  } finally {
    resetTerminalPtyLoader();
  }
});

test("create retires oldest exited sessions before enforcing the cap", async () => {
  const spawned: FakePty[] = [];
  installFakePty(spawned);
  try {
    const ids: string[] = [];
    for (let i = 0; i < 16; i += 1) {
      const info = await createTerminalPty({ cwd: "/tmp" }, { onData: () => {}, onExit: () => {} });
      ids.push(info.id);
    }
    await expect(
      createTerminalPty({ cwd: "/tmp" }, { onData: () => {}, onExit: () => {} })
    ).rejects.toThrow(/Too many/);
    spawned[0]!.exitListener?.({ exitCode: 0 });
    const info = await createTerminalPty({ cwd: "/tmp" }, { onData: () => {}, onExit: () => {} });
    expect(info.status).toBe("running");
    // 只腾出一个名额：最老的已退出会话被回收，其余保留
    expect(getTerminalPty(ids[0]!)).toBeNull();
    expect(getTerminalPty(ids[1]!)).not.toBeNull();
    for (const id of ids.slice(2)) forgetTerminalPty(id);
    forgetTerminalPty(info.id);
  } finally {
    resetTerminalPtyLoader();
  }
});

test("create rejects relative or missing cwd", async () => {
  const spawned: FakePty[] = [];
  installFakePty(spawned);
  try {
    await expect(
      createTerminalPty({ cwd: "relative/path" }, { onData: () => {}, onExit: () => {} })
    ).rejects.toThrow();
    await expect(
      createTerminalPty({ cwd: "/definitely/not/here-12345" }, { onData: () => {}, onExit: () => {} })
    ).rejects.toThrow();
    expect(spawned).toHaveLength(0);
  } finally {
    resetTerminalPtyLoader();
  }
});

test("kill marks exited and unknown ids throw", async () => {
  const spawned: FakePty[] = [];
  installFakePty(spawned);
  try {
    const info = await createTerminalPty(
      { cwd: "/tmp" },
      { onData: () => {}, onExit: () => {} }
    );
    const killed = killTerminalPty(info.id);
    expect(killed.status).toBe("exited");
    expect(spawned[0]!.killed).toBe(true);
    expect(() => killTerminalPty("term-missing")).toThrow();
    expect(() => resizeTerminalPty("term-missing", 80, 24)).toThrow();
    forgetTerminalPty(info.id);
  } finally {
    resetTerminalPtyLoader();
  }
});

test("pty spawn keeps ConPTY opt-in on win32 to preserve PowerShell scrollback", () => {
  // Ordinary Windows shells use node-pty's default backend; ConPTY is a
  // deliberate rollout flag because some hosts clear the screen on `ls`.
  expect(ptySpawnExtraOptions("win32", {})).toEqual({ useConpty: false });
  expect(ptySpawnExtraOptions("win32", { CODEX_UI_TERMINAL_USE_CONPTY: "" })).toEqual({ useConpty: false });
  expect(ptySpawnExtraOptions("win32", { CODEX_UI_TERMINAL_USE_CONPTY: " true " })).toEqual({ useConpty: false });
  expect(ptySpawnExtraOptions("win32", { CODEX_UI_TERMINAL_USE_CONPTY: "1" })).toEqual({ useConpty: true });
  expect(ptySpawnExtraOptions("win32", { CODEX_UI_TERMINAL_USE_CONPTY: "0" })).toEqual({ useConpty: false });
  expect(ptySpawnExtraOptions("darwin", {})).toEqual({});
  expect(ptySpawnExtraOptions("linux", {})).toEqual({});
});

test("detectScreenSeq names blanking sequences, ignores apt-style output", () => {
  expect(detectScreenSeq("Get:1 http://archive [12.3 kB]\r\n")).toBeNull();
  expect(detectScreenSeq("\x1b[01;34mdir\x1b[00m\r\n")).toBeNull();
  expect(detectScreenSeq("\x1b[2J\x1b[Hprompt$ ")).toBe("ED-2J");
  expect(detectScreenSeq("...\x1b[?25l")).toBe("HIDE-CURSOR");
  expect(detectScreenSeq("\x1b[?1049hframe")).toBe("ALT-SCREEN");
  expect(detectScreenSeq("\x1bc")).toBe("RIS");
});

test("Windows PowerShell ls keeps prior output in resident scrollback", async () => {
  if (process.platform !== "win32") return;
  const chunks: string[] = [];
  const info = await createTerminalPty(
    { cwd: resolve("."), cols: 120, rows: 30 },
    {
      onData: (_id, chunk) => chunks.push(chunk),
      onExit: () => undefined
    }
  );
  try {
    const deadline = Date.now() + 5000;
    writeTerminalPty(info.id, "Write-Output 'CXU_BEFORE'; ls; Write-Output 'CXU_AFTER'\r");
    while (Date.now() < deadline && !readTerminalPty(info.id).tail.includes("CXU_AFTER")) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    const tail = readTerminalPty(info.id).tail;
    expect(tail).toContain("CXU_BEFORE");
    expect(tail).toContain("CXU_AFTER");
    expect(tail).not.toContain("\x1b[2J");
    expect(tail).not.toContain("\x1b[3J");
    expect(chunks.join("")).toContain("CXU_AFTER");
  } finally {
    try {
      killTerminalPty(info.id);
    } catch {
      // Best effort cleanup.
    }
    try {
      forgetTerminalPty(info.id);
    } catch {
      // Best effort cleanup.
    }
  }
});
