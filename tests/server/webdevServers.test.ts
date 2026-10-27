import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listWebDevServers, startWebDevServer, stopWebDevServer } from "../../apps/server/src/webdevServers.ts";

const startedIds: string[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const id of startedIds.splice(0)) {
    try {
      stopWebDevServer(id);
    } catch {
      // The process may already have exited.
    }
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

test("managed WebDev servers retain output, detect local URLs, and stop", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codex-ui-webdev-server-"));
  tempDirs.push(cwd);
  const session = startWebDevServer({
    id: "webdev-server-test",
    cwd,
    command: "bun -e \"console.log('ready http://127.0.0.1:59999/'); setInterval(() => {}, 1000)\""
  });
  startedIds.push(session.id);

  await waitFor(() => {
    const current = listWebDevServers().find((entry) => entry.id === session.id);
    return current?.status === "running" && current.url === "http://127.0.0.1:59999/";
  });

  const running = listWebDevServers().find((entry) => entry.id === session.id);
  expect(running?.output).toContain("ready http://127.0.0.1:59999/");

  const stopped = stopWebDevServer(session.id);
  expect(stopped.status).toBe("terminated");
});

test("managed WebDev servers require an absolute existing cwd", () => {
  expect(() => startWebDevServer({ cwd: "relative", command: "echo no" })).toThrow("absolute path");
  expect(() => startWebDevServer({ cwd: "/path/that/does/not/exist", command: "echo no" })).toThrow("existing directory");
});

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition");
}
