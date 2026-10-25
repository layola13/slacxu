import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { isBunRuntime } from "./index.js";

export type RuntimeProcess = {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(): void;
};

export function spawnRuntimeProcess(
  command: string[],
  options: { cwd: string; env: Record<string, string | undefined> },
): RuntimeProcess {
  if (command.length === 0 || !command[0]) {
    throw new Error("A command is required");
  }

  if (isBunRuntime) {
    const bun = (globalThis as { Bun: typeof Bun }).Bun;
    const child = bun.spawn(command, { cwd: options.cwd, env: options.env, stdout: "pipe", stderr: "pipe" });
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      exited: child.exited,
      kill: () => child.kill(),
    };
  }

  const child = spawn(command[0], command.slice(1), {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return {
    stdout: child.stdout ? (Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>) : null,
    stderr: child.stderr ? (Readable.toWeb(child.stderr) as unknown as ReadableStream<Uint8Array>) : null,
    exited: new Promise((resolve) => {
      child.once("error", () => resolve(127));
      child.once("close", (code) => resolve(code ?? 1));
    }),
    kill: () => { child.kill(); },
  };
}
