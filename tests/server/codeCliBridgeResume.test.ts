import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { CodeCliBridge, type CodeCliSessionSnapshot } from "../../apps/server/src/codeCliBridge";
import { claudeProjectDirName } from "../../backends/claude/src/runtime/claudeCompatibleProbe";

const THREAD_ID = "thread-resume";
const EXTERNAL_SESSION_ID = "sess-resume-1";

type Spawned = {
  args: string[];
  stdin: string[];
  child: ChildProcessWithoutNullStreams;
};

function fakeSpawn(record: Spawned[]): (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams {
  return (_command, args) => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    const stdin: string[] = [];
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        stdin.push(String(chunk));
        callback();
      },
    });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    record.push({ args, stdin, child });
    return child;
  };
}

function snapshot(cwd: string): CodeCliSessionSnapshot {
  return {
    threadId: THREAD_ID,
    permissionMode: "default",
    model: "claude-sonnet-5",
    cwd,
    createdAt: Date.now(),
    turns: [{ id: "turn-1", status: "completed", createdAt: Date.now() }],
    messages: [],
    goalStatus: null,
    conversation: [
      { role: "user", text: "Explain the resume path" },
      { role: "assistant", text: "It reads the CLI transcript" },
    ],
    externalSessionId: EXTERNAL_SESSION_ID,
    providerId: "gateai",
    groupId: "group-claude",
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

test("Claude bridge resumes a reopened thread when its transcript survived", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-resume-"));
  const cwd = process.cwd();
  const projectDir = join(configDir, "projects", claudeProjectDirName(cwd)!);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, EXTERNAL_SESSION_ID + ".jsonl"), "{}\n");

  const spawns: Spawned[] = [];
  const bridge = createBridge(configDir, spawns);
  bridge.restoreSession(snapshot(cwd));
  await bridge.request("turn/start", { threadId: THREAD_ID, input: "Keep going" });

  const args = spawns[0]!.args;
  expect(args[args.indexOf("--resume") + 1]).toBe(EXTERNAL_SESSION_ID);
  // The CLI still holds the conversation, so nothing has to be replayed into it.
  expect(spawns[0]!.stdin.join("")).not.toContain("<conversation-summary>");

  bridge.stop();
  rmSync(configDir, { recursive: true, force: true });
});

test("Claude bridge replays the conversation when the transcript is gone", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-resume-lost-"));
  const cwd = process.cwd();

  const spawns: Spawned[] = [];
  const bridge = createBridge(configDir, spawns);
  const stderr: string[] = [];
  bridge.on("stderr", (message: string) => stderr.push(message));
  bridge.restoreSession(snapshot(cwd));
  await bridge.request("turn/start", { threadId: THREAD_ID, input: "Keep going" });

  // Handing --resume a session the CLI cannot load aborts the process and
  // leaves the reopened thread unable to take any turn at all.
  expect(spawns[0]!.args).not.toContain("--resume");
  const stdin = spawns[0]!.stdin.join("");
  expect(stdin).toContain("<conversation-summary>");
  expect(stdin).toContain("Explain the resume path");
  expect(stdin).toContain("Keep going");
  expect(stderr.join("")).toContain("no transcript left to resume");
  expect(bridge.getSessionSnapshot(THREAD_ID)!.externalSessionId).toBeUndefined();

  bridge.stop();
  rmSync(configDir, { recursive: true, force: true });
});

test("Claude bridge tracks the forked session ID a resume reports back", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-resume-fork-"));
  const cwd = process.cwd();
  const projectDir = join(configDir, "projects", claudeProjectDirName(cwd)!);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, EXTERNAL_SESSION_ID + ".jsonl"), "{}\n");

  const spawns: Spawned[] = [];
  const bridge = createBridge(configDir, spawns);
  bridge.restoreSession(snapshot(cwd));
  await bridge.request("turn/start", { threadId: THREAD_ID, input: "Keep going" });
  spawns[0]!.child.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "sess-resume-2" }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 10));

  // The next reopen has to continue from the fork, not from the stale transcript.
  expect(bridge.getSessionSnapshot(THREAD_ID)!.externalSessionId).toBe("sess-resume-2");

  bridge.stop();
  rmSync(configDir, { recursive: true, force: true });
});

test("Claude bridge captures the session ID when session_state_changed precedes init", async () => {
  // Current CLI builds emit `session_state_changed` before `system/init`, and
  // its handling registers the id in sessionIdToThread via the single-session
  // fallback. That used to make the init handler skip adoption entirely,
  // leaving externalSessionId unpersisted — so a reopened thread after a
  // restart could neither --resume nor replay.
  const configDir = mkdtempSync(join(tmpdir(), "claude-resume-state-"));
  const spawns: Spawned[] = [];
  const bridge = createBridge(configDir, spawns);
  bridge.configure({ threadId: THREAD_ID, providerId: "gateai", groupId: "group-claude" });
  await bridge.request("thread/start", { threadId: THREAD_ID, model: "m", cwd: process.cwd() });
  await bridge.request("turn/start", { threadId: THREAD_ID, input: "hi" });
  const child = spawns[0]!.child;
  child.stdout.write(JSON.stringify({ type: "system", subtype: "session_state_changed", state: "running", uuid: "u1", session_id: EXTERNAL_SESSION_ID }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(bridge.getSessionSnapshot(THREAD_ID)!.externalSessionId).toBeUndefined();
  child.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: EXTERNAL_SESSION_ID, claude_code_version: "2.1.243" }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(bridge.getSessionSnapshot(THREAD_ID)!.externalSessionId).toBe(EXTERNAL_SESSION_ID);

  bridge.stop();
  rmSync(configDir, { recursive: true, force: true });
});

test("Claude bridge replays the persisted conversation even without an external session ID", async () => {
  // Snapshots persisted before the session id was captured carry no
  // externalSessionId; the fresh CLI process must still inherit context.
  const configDir = mkdtempSync(join(tmpdir(), "claude-resume-noid-"));
  const cwd = process.cwd();

  const spawns: Spawned[] = [];
  const bridge = createBridge(configDir, spawns);
  const restored = snapshot(cwd);
  delete (restored as Partial<CodeCliSessionSnapshot>).externalSessionId;
  bridge.restoreSession(restored);
  await bridge.request("turn/start", { threadId: THREAD_ID, input: "Keep going" });

  expect(spawns[0]!.args).not.toContain("--resume");
  const stdin = spawns[0]!.stdin.join("");
  expect(stdin).toContain("<conversation-summary>");
  expect(stdin).toContain("Explain the resume path");
  expect(stdin).toContain("Keep going");

  bridge.stop();
  rmSync(configDir, { recursive: true, force: true });
});
