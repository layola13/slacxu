import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { CodeCliBridge } from "../../apps/server/src/codeCliBridge";

type Spawned = {
  args: string[];
  env: NodeJS.ProcessEnv;
  child: ChildProcessWithoutNullStreams;
};

function fakeSpawn(record: Spawned[]): (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams {
  return (_command, args, options) => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    record.push({ args, env: options.env ?? {}, child });
    return child;
  };
}

function createBridge(configDir: string, spawns: Spawned[]): CodeCliBridge {
  return new CodeCliBridge(() => ({
    CODECLI_BIN: "claude-test",
    CODEX_UI_PORT: "43123",
    CODEX_UI_RELAY_GATEWAY_TOKEN: "gateway-token",
    CLAUDE_CONFIG_DIR: configDir,
  }), fakeSpawn(spawns));
}

function startupStages(messages: Array<{ method?: unknown; params?: unknown }>): string[] {
  return messages
    .filter((m) => m.method === "thread/claude/startup")
    .map((m) => String((m.params as Record<string, unknown>).stage ?? ""));
}

test("Claude startup emits spawning -> handshake, then ready on CLI init", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-startup-"));
  const threadId = "thread-startup-stages";
  const spawns: Spawned[] = [];
  const bridge = createBridge(configDir, spawns);
  const messages: Array<{ method?: unknown; params?: unknown }> = [];
  bridge.on("message", (message) => { messages.push(message as { method?: unknown; params?: unknown }); });

  bridge.configure({ model: "claude-sonnet-5", providerId: "p", groupId: "g", threadId } as never);
  await bridge.request("thread/start", { threadId, model: "claude-sonnet-5" });

  expect(startupStages(messages)).toEqual(["spawning", "handshake"]);

  // Feed the CLI init line; the bridge must surface `ready` for the thread.
  spawns[0]!.child.stdout.write(
    JSON.stringify({ type: "system", subtype: "init", session_id: "sess-1", claude_code_version: "2.1.276" }) + "\n"
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(startupStages(messages)).toEqual(["spawning", "handshake", "ready"]);

  bridge.stop();
  rmSync(configDir, { recursive: true, force: true });
});

test("Claude startup emits failed when the child exits before init", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-startup-fail-"));
  const threadId = "thread-startup-fail";
  const spawns: Spawned[] = [];
  const bridge = createBridge(configDir, spawns);
  const messages: Array<{ method?: unknown; params?: unknown }> = [];
  bridge.on("message", (message) => { messages.push(message as { method?: unknown; params?: unknown }); });

  bridge.configure({ model: "claude-sonnet-5", providerId: "p", groupId: "g", threadId } as never);
  await bridge.request("thread/start", { threadId, model: "claude-sonnet-5" });
  expect(startupStages(messages)).toEqual(["spawning", "handshake"]);

  spawns[0]!.child.stderr.write("boom\n");
  spawns[0]!.child.emit("exit", 1, null);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const stages = startupStages(messages);
  expect(stages).toEqual(["spawning", "handshake", "failed"]);

  bridge.stop();
  rmSync(configDir, { recursive: true, force: true });
});
