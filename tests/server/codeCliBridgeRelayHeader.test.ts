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

test("Claude child carries a thread-id custom header so the gateway can route the thread's live relay selection", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-relay-hdr-"));
  const threadId = "thread-relay-switch";
  const spawns: Spawned[] = [];
  const bridge = createBridge(configDir, spawns);

  // Configure with provider/group + the owning thread id, then drive a turn,
  // which spawns the CLI child with the env built in `start()`.
  bridge.configure({
    model: "claude-sonnet-5",
    providerId: "provider-a",
    groupId: "group-1",
    threadId,
  } as never);
  await bridge.request("thread/start", { threadId, model: "claude-sonnet-5" });
  await bridge.request("turn/start", { threadId, input: "hello" });

  const env = spawns[0]!.env;
  // ANTHROPIC_CUSTOM_HEADERS is stripped from the inherited env but re-supplied
  // by the bridge override: owning thread id (live relay routing) + stable
  // x-opencode-session (OpenCode routing/cache affinity) + backend hint (UA).
  const customHeaders = String(env.ANTHROPIC_CUSTOM_HEADERS ?? "");
  expect(customHeaders).toContain(`thread-id: ${threadId}`);
  expect(customHeaders).toContain("x-opencode-session: ");
  expect(customHeaders).toContain("x-codex-cli-backend: claude");
  expect(env.ANTHROPIC_BASE_URL).toContain("provider-a");
  expect(env.ANTHROPIC_BASE_URL).toContain("group-1");

  bridge.stop();
  rmSync(configDir, { recursive: true, force: true });
});

test("Claude child mirrors the owning thread id even when only thread/start supplies it", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-relay-hdr-startonly-"));
  const threadId = "thread-start-only";
  const spawns: Spawned[] = [];
  const bridge = createBridge(configDir, spawns);

  // Configure without a threadId — thread/start will supply it, which is the
  // real-world flow for a freshly opened thread.
  bridge.configure({
    model: "claude-sonnet-5",
    providerId: "provider-a",
    groupId: "group-1",
  } as never);
  await bridge.request("thread/start", { threadId, model: "claude-sonnet-5" });
  await bridge.request("turn/start", { threadId, input: "hello" });

  expect(String(spawns[0]!.env.ANTHROPIC_CUSTOM_HEADERS ?? "")).toContain(`thread-id: ${threadId}`);

  bridge.stop();
  rmSync(configDir, { recursive: true, force: true });
});
