import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type WebDevServerStatus = "running" | "completed" | "failed" | "terminated";

export type WebDevServerSession = {
  id: string;
  command: string;
  cwd: string;
  status: WebDevServerStatus;
  output: string;
  url?: string;
  pid?: number;
  exitCode?: number;
  startedAt: number;
  updatedAt: number;
};

type StoredSession = WebDevServerSession & {
  process?: ChildProcessWithoutNullStreams;
};

const MAX_OUTPUT_LENGTH = 128_000;
const sessions = new Map<string, StoredSession>();

export function listWebDevServers(): WebDevServerSession[] {
  return Array.from(sessions.values())
    .map(publicSession)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getWebDevServer(id: string): WebDevServerSession | null {
  const session = sessions.get(id);
  return session ? publicSession(session) : null;
}

export function startWebDevServer(input: { command: string; cwd: string; id?: string }): WebDevServerSession {
  const command = input.command.trim();
  const cwd = normalizeCwd(input.cwd);
  if (!command) {
    throw new Error("Missing WebDev server command");
  }
  if (command.length > 4_000) {
    throw new Error("WebDev server command is too long");
  }

  const id = input.id?.trim() || `webdev-${randomUUID()}`;
  const existing = sessions.get(id);
  if (existing?.process && existing.status === "running") {
    stopWebDevServer(id);
  }

  const now = Date.now();
  const child = spawn(command, {
    cwd,
    detached: process.platform !== "win32",
    env: process.env,
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });

  const session: StoredSession = {
    id,
    command,
    cwd,
    status: "running",
    output: `$ ${command}\n`,
    pid: child.pid,
    startedAt: now,
    updatedAt: now,
    process: child
  };
  sessions.set(id, session);

  child.stdout.on("data", (chunk) => appendOutput(session, String(chunk)));
  child.stderr.on("data", (chunk) => appendOutput(session, String(chunk)));
  child.on("exit", (code, signal) => {
    session.process = undefined;
    session.exitCode = typeof code === "number" ? code : undefined;
    if (session.status === "terminated") {
      appendOutput(session, `\n[terminated${signal ? `: ${signal}` : ""}]\n`);
      return;
    }
    session.status = code === 0 ? "completed" : "failed";
    appendOutput(session, `\n[process exited with code ${code ?? "unknown"}${signal ? `, signal ${signal}` : ""}]\n`);
  });
  child.on("error", (error) => {
    session.process = undefined;
    session.status = "failed";
    appendOutput(session, `\n[failed to start: ${error.message}]\n`);
  });
  child.stdin.end();

  return publicSession(session);
}

export function stopWebDevServer(id: string): WebDevServerSession {
  const session = sessions.get(id);
  if (!session) {
    throw new Error("Unknown WebDev server session");
  }
  session.status = "terminated";
  session.updatedAt = Date.now();
  const pid = session.process?.pid ?? session.pid;
  if (pid) {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore"
        });
      } else {
        process.kill(-pid, "SIGTERM");
      }
    } catch {
      try {
        session.process?.kill("SIGTERM");
      } catch {
        // Already exited.
      }
    }
  }
  session.process = undefined;
  return publicSession(session);
}

function normalizeCwd(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !isAbsolute(trimmed)) {
    throw new Error("WebDev server cwd must be an absolute path");
  }
  const cwd = resolve(trimmed);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error("WebDev server cwd must be an existing directory");
  }
  return cwd;
}

function appendOutput(session: StoredSession, chunk: string): void {
  session.output = `${session.output}${chunk}`;
  if (session.output.length > MAX_OUTPUT_LENGTH) {
    session.output = session.output.slice(session.output.length - MAX_OUTPUT_LENGTH);
  }
  session.url = detectLocalPreviewUrl(session.output) ?? session.url;
  session.updatedAt = Date.now();
}

function detectLocalPreviewUrl(output: string): string | undefined {
  const matches = [...output.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d{1,5})?(?:\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]*)?/gi)];
  for (let i = matches.length - 1; i >= 0; i--) {
    let raw = matches[i]?.[0];
    if (!raw) continue;
    raw = raw.replace(/^[`'"<(\[{]+/, "").replace(/[`'">)\]}]+$/, "");
    raw = raw.replace(/[.,;:!?，。；：！？、…]+$/, "").replace(/[`'"]+$/, "");
    try {
      const url = new URL(raw);
      if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
      if (url.pathname) {
        url.pathname = url.pathname.replace(/[`'"]+$/g, "");
        const firstNonAscii = url.pathname.search(/[^\x20-\x7E]/);
        if (firstNonAscii >= 0) url.pathname = url.pathname.slice(0, firstNonAscii);
        url.pathname = url.pathname.replace(/[.,;:!?，。；：！？、…`'"]+$/, "");
        if (!url.pathname) url.pathname = "/";
      }
      return url.toString();
    } catch {
      continue;
    }
  }
  return undefined;
}

function publicSession(session: StoredSession): WebDevServerSession {
  const { process: _process, ...out } = session;
  return { ...out };
}
