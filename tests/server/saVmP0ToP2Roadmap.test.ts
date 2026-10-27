import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { join, resolve } from "node:path";
import { writeFileSync, existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { createDefaultSaVmPolicyConfig } from "@codex-ui/shared";
import {
  runSaVmTool,
  resetRunHostCacheForTest,
  ALLOWED_HOST_SHORT_NAMES,
  ALLOWED_CARGO_SUBCOMMANDS,
  ALLOWED_GO_SUBCOMMANDS,
  saVmActiveSessions
} from "../../apps/server/src/saVmTool.js";
import {
  MiniBridge,
  runMiniWebSearch,
  extractUserInputAnswer,
  miniToolArgValidationError
} from "../../backends/mini/src/runtime/miniBridge.js";
import { spawnSync } from "node:child_process";

const workspace = resolve(process.cwd());
const defaultPolicy = createDefaultSaVmPolicyConfig();
const testDir = join(workspace, ".test_p0_p2_scratch");

beforeEach(() => {
  resetRunHostCacheForTest();
});

afterAll(() => {
  resetRunHostCacheForTest();
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ============================================================================
// P0: write_stdin + Process Session Management
// ============================================================================
describe("P0: Process Session Management (sa_vm write_stdin & background sessions)", () => {
  test("run_host with yield_time_ms registers running session when execution exceeds yield threshold", async () => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });

    // Node interactive script that echoes stdin lines
    const interactiveScript = join(testDir, "interactive_echo.js");
    writeFileSync(
      interactiveScript,
      `
      process.stdin.setEncoding('utf8');
      process.stdout.write("READY\\n");
      process.stdin.on('data', (chunk) => {
        process.stdout.write("ECHO: " + chunk);
        if (chunk.trim() === "QUIT") {
          process.exit(0);
        }
      });
      `,
      "utf8"
    );

    // 1. Start process with yield_time_ms = 300ms
    const startRes = await runSaVmTool({
      action: "run_host",
      exe: "node",
      args: [interactiveScript],
      yield_time_ms: 300
    }, { cwd: workspace, policy: defaultPolicy });

    expect(startRes.ok).toBe(true);
    expect(startRes.kind).toBe("running");
    expect(startRes.session_id).toBeDefined();
    const sessionId = startRes.session_id as string;
    expect(sessionId.startsWith("proc-")).toBe(true);
    expect(startRes.stdout).toContain("READY");

    // 2. Query session_status
    const statusRes = await runSaVmTool({
      action: "session_status",
      session_id: sessionId
    }, { cwd: workspace, policy: defaultPolicy });

    expect(statusRes.ok).toBe(true);
    expect(statusRes.status).toBe("running");
    expect(statusRes.stdout).toContain("READY");

    // 3. Write input via write_stdin
    const writeRes = await runSaVmTool({
      action: "write_stdin",
      session_id: sessionId,
      input: "hello world\n"
    }, { cwd: workspace, policy: defaultPolicy });

    expect(writeRes.ok).toBe(true);
    expect(writeRes.action).toBe("write_stdin");

    // Wait a brief moment for child to process stdin
    await new Promise((r) => setTimeout(r, 150));

    // 4. Poll output with session_status
    const statusAfterWrite = await runSaVmTool({
      action: "session_status",
      session_id: sessionId
    }, { cwd: workspace, policy: defaultPolicy });

    expect(statusAfterWrite.stdout).toContain("ECHO: hello world");

    // 5. Send QUIT to let process exit cleanly
    await runSaVmTool({
      action: "write_stdin",
      session_id: sessionId,
      input: "QUIT\n"
    }, { cwd: workspace, policy: defaultPolicy });

    await new Promise((r) => setTimeout(r, 200));

    const finalStatus = await runSaVmTool({
      action: "session_status",
      session_id: sessionId
    }, { cwd: workspace, policy: defaultPolicy });

    expect(finalStatus.status).toBe("exited");
    expect(finalStatus.exitCode).toBe(0);
  });

  test("kill_session cleanly terminates long-running process", async () => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    const infiniteScript = join(testDir, "infinite_loop.js");
    writeFileSync(
      infiniteScript,
      `
      process.stdout.write("STARTED\\n");
      setInterval(() => {
        process.stdout.write("HEARTBEAT\\n");
      }, 100);
      `,
      "utf8"
    );

    const startRes = await runSaVmTool({
      action: "run_host",
      exe: "node",
      args: [infiniteScript],
      yield_time_ms: 250
    }, { cwd: workspace, policy: defaultPolicy });

    expect(startRes.kind).toBe("running");
    const sessionId = startRes.session_id as string;
    expect(saVmActiveSessions.has(sessionId)).toBe(true);

    // Kill session
    const killRes = await runSaVmTool({
      action: "kill_session",
      session_id: sessionId
    }, { cwd: workspace, policy: defaultPolicy });

    expect(killRes.ok).toBe(true);
    expect(killRes.status).toBe("killed");

    const session = saVmActiveSessions.get(sessionId);
    expect(session?.status).toBe("killed");
    expect(session?.closed).toBe(true);
  });

  test("list_sessions enumerates active sessions", async () => {
    const listRes = await runSaVmTool({
      action: "list_sessions"
    }, { cwd: workspace, policy: defaultPolicy });

    expect(listRes.ok).toBe(true);
    expect(listRes.stdout).toContain("sessions");
  });

  test("write_stdin and session_status reject missing session_id", async () => {
    const res1 = await runSaVmTool({ action: "write_stdin" }, { cwd: workspace, policy: defaultPolicy });
    expect(res1.ok).toBe(false);
    expect(res1.stderr).toContain("requires a 'session_id'");

    const res2 = await runSaVmTool({ action: "session_status" }, { cwd: workspace, policy: defaultPolicy });
    expect(res2.ok).toBe(false);
    expect(res2.stderr).toContain("requires a 'session_id'");

    const res3 = await runSaVmTool({ action: "kill_session" }, { cwd: workspace, policy: defaultPolicy });
    expect(res3.ok).toBe(false);
    expect(res3.stderr).toContain("requires a 'session_id'");
  });
});

// ============================================================================
// P1: Mid-turn User Input & Web Search
// ============================================================================
describe("P1: Mid-turn request_user_input and web_search", () => {
  test("miniToolArgValidationError enforces schemas for request_user_input and web_search", () => {
    // request_user_input validation
    expect(miniToolArgValidationError("request_user_input", {})).toContain("needs {questions");
    expect(miniToolArgValidationError("request_user_input", { questions: [] })).toContain("needs {questions");
    expect(miniToolArgValidationError("request_user_input", { questions: [{ question: "Which target?" }] })).toBeNull();

    // web_search validation
    expect(miniToolArgValidationError("web_search", {})).toContain("needs a non-empty query");
    expect(miniToolArgValidationError("web_search", { query: "   " })).toContain("needs a non-empty query");
    expect(miniToolArgValidationError("web_search", { query: "rust async streams" })).toBeNull();
  });

  test("extractUserInputAnswer parses structured answer options and notes", () => {
    // Standard structured answers
    const payload = {
      answers: {
        q1: { answers: ["Option A", "user_note: Custom feedback"] },
        q2: { answers: ["Option B"] }
      }
    };
    const parsed = extractUserInputAnswer(payload as any);
    expect(parsed).toBe("Option A, Custom feedback, Option B");

    // Single decision
    expect(extractUserInputAnswer({ decision: "approved" } as any)).toBe("approved");

    // Empty / null
    expect(extractUserInputAnswer(null as any)).toBe("");
  });

  test("MiniBridge.respond delivers answer to waiting request_user_input", async () => {
    const bridge = new MiniBridge();
    let serverRequestSent: any = null;

    bridge.on("message", (msg) => {
      if (msg?.method === "item/tool/requestUserInput") {
        serverRequestSent = msg;
      }
    });

    const session: any = {
      threadId: "test-thread-p1",
      cwd: workspace,
      messages: []
    };

    // Trigger request_user_input asynchronously
    const inputPromise = (bridge as any).handleMiniRequestUserInput(session, "turn-1", {
      questions: [
        { id: "target", question: "Select target", options: ["Debug", "Release"] }
      ]
    });

    // Verify request emitted
    expect(serverRequestSent).toBeDefined();
    expect(serverRequestSent.method).toBe("item/tool/requestUserInput");
    expect(serverRequestSent.params.questions[0].question).toBe("Select target");

    const reqId = serverRequestSent.id;
    expect(bridge.hasPendingUserInput(reqId)).toBe(true);

    // Respond with user choice
    bridge.respond(reqId, {
      answers: {
        target: { answers: ["Release"] }
      }
    } as any);

    const result = await inputPromise;
    expect(result).toContain("User answered: Release");
    expect(result).toContain("Do not return an empty reply");
    expect(bridge.hasPendingUserInput(reqId)).toBe(false);
  });

  test("runMiniWebSearch returns structured response or graceful fallback", async () => {
    const res = await runMiniWebSearch("zig build documentation", 3);
    expect(typeof res).toBe("string");
    expect(res.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// P2: Policy Bridge: Cargo/Go Allowlist & Local Git Checkpoints
// ============================================================================
describe("P2: Policy Bridge (Cargo/Go allowlist & Local Checkpoints)", () => {
  test("ALLOWED_HOST_SHORT_NAMES includes cargo, rustc, and go", () => {
    expect(ALLOWED_HOST_SHORT_NAMES.has("cargo")).toBe(true);
    expect(ALLOWED_HOST_SHORT_NAMES.has("cargo.exe")).toBe(true);
    expect(ALLOWED_HOST_SHORT_NAMES.has("rustc")).toBe(true);
    expect(ALLOWED_HOST_SHORT_NAMES.has("rustc.exe")).toBe(true);
    expect(ALLOWED_HOST_SHORT_NAMES.has("go")).toBe(true);
    expect(ALLOWED_HOST_SHORT_NAMES.has("go.exe")).toBe(true);
    expect(ALLOWED_HOST_SHORT_NAMES.has("git")).toBe(true);
    expect(ALLOWED_HOST_SHORT_NAMES.has("git.exe")).toBe(true);
  });

  test("Cargo subcommands allow safe commands and block install/publish/network", async () => {
    // Safe subcommand checks
    for (const safe of ["check", "test", "clippy", "build", "run", "version", "fmt", "bench", "--help"]) {
      expect(ALLOWED_CARGO_SUBCOMMANDS.has(safe)).toBe(true);
    }

    // Attempting disallowed subcommand (e.g. cargo install or cargo login)
    const resInstall = await runSaVmTool({
      action: "run_host",
      exe: "cargo",
      args: ["install", "ripgrep"]
    }, { cwd: workspace, policy: defaultPolicy });

    expect(resInstall.ok).toBe(false);
    expect(resInstall.kind).toBe("capability_denied");
    expect(resInstall.stderr).toContain("is not permitted");

    const resLogin = await runSaVmTool({
      action: "run_host",
      exe: "cargo",
      args: ["login", "token"]
    }, { cwd: workspace, policy: defaultPolicy });

    expect(resLogin.ok).toBe(false);
    expect(resLogin.kind).toBe("capability_denied");
    expect(resLogin.stderr).toContain("Cargo subcommand 'login' is not permitted");
  });

  test("Go subcommands allow safe commands and block install/get", async () => {
    for (const safe of ["test", "vet", "build", "version", "env", "fmt", "run", "--help"]) {
      expect(ALLOWED_GO_SUBCOMMANDS.has(safe)).toBe(true);
    }

    const resInstall = await runSaVmTool({
      action: "run_host",
      exe: "go",
      args: ["install", "github.com/something"]
    }, { cwd: workspace, policy: defaultPolicy });

    expect(resInstall.ok).toBe(false);
    expect(resInstall.kind).toBe("capability_denied");
    expect(resInstall.stderr).toContain("is not permitted");

    const resGet = await runSaVmTool({
      action: "run_host",
      exe: "go",
      args: ["get", "github.com/something"]
    }, { cwd: workspace, policy: defaultPolicy });

    expect(resGet.ok).toBe(false);
    expect(resGet.kind).toBe("capability_denied");
    expect(resGet.stderr).toContain("Go subcommand 'get' is not permitted");
  });

  test("local_checkpoint and restore_checkpoint work in isolated git repo", async () => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    const gitRepoDir = join(testDir, "test_git_repo");
    if (existsSync(gitRepoDir)) rmSync(gitRepoDir, { recursive: true, force: true });
    mkdirSync(gitRepoDir, { recursive: true });

    // Init local git repo
    spawnSync("git", ["init"], { cwd: gitRepoDir, stdio: "ignore" });
    spawnSync("git", ["config", "user.name", "Test Agent"], { cwd: gitRepoDir, stdio: "ignore" });
    spawnSync("git", ["config", "user.email", "agent@example.com"], { cwd: gitRepoDir, stdio: "ignore" });
    spawnSync("git", ["config", "core.autocrlf", "false"], { cwd: gitRepoDir, stdio: "ignore" });

    // Initial commit
    const testFile = join(gitRepoDir, "code.txt");
    writeFileSync(testFile, "Version 1.0\n", "utf8");
    spawnSync("git", ["add", "-A"], { cwd: gitRepoDir, stdio: "ignore" });
    spawnSync("git", ["commit", "-m", "initial commit"], { cwd: gitRepoDir, stdio: "ignore" });

    // Check clean repo checkpoint
    const cleanCheckpoint = await runSaVmTool({
      action: "local_checkpoint",
      cwd: gitRepoDir
    }, { cwd: gitRepoDir, policy: defaultPolicy });

    expect(cleanCheckpoint.ok).toBe(true);
    expect(cleanCheckpoint.created).toBe(false);
    expect(cleanCheckpoint.commit).toBeDefined();
    const v1Sha = cleanCheckpoint.commit as string;

    // Modify file
    writeFileSync(testFile, "Version 2.0 (Checkpoint Test)\n", "utf8");

    // Create local checkpoint
    const checkpointRes = await runSaVmTool({
      action: "local_checkpoint",
      cwd: gitRepoDir,
      message: "before dangerous refactor"
    }, { cwd: gitRepoDir, policy: defaultPolicy });

    expect(checkpointRes.ok).toBe(true);
    expect(checkpointRes.created).toBe(true);
    expect(checkpointRes.commit).toBeDefined();
    const v2Sha = checkpointRes.commit as string;
    expect(v2Sha).not.toBe(v1Sha);

    // Modify again to dirty state
    writeFileSync(testFile, "Broken version 3.0\n", "utf8");
    expect(readFileSync(testFile, "utf8")).toContain("Broken");

    // Restore to v2 checkpoint
    const restoreV2 = await runSaVmTool({
      action: "restore_checkpoint",
      cwd: gitRepoDir,
      commit: v2Sha
    }, { cwd: gitRepoDir, policy: defaultPolicy });

    expect(restoreV2.ok).toBe(true);
    expect(restoreV2.commit).toBe(v2Sha);
    expect(readFileSync(testFile, "utf8").replace(/\r\n/g, "\n")).toBe("Version 2.0 (Checkpoint Test)\n");

    // Restore to initial commit v1
    const restoreV1 = await runSaVmTool({
      action: "restore_checkpoint",
      cwd: gitRepoDir,
      commit: v1Sha
    }, { cwd: gitRepoDir, policy: defaultPolicy });

    expect(restoreV1.ok).toBe(true);
    expect(restoreV1.commit).toBe(v1Sha);
    expect(readFileSync(testFile, "utf8").replace(/\r\n/g, "\n")).toBe("Version 1.0\n");

    // Rejection of invalid commit injection
    const badRestore = await runSaVmTool({
      action: "restore_checkpoint",
      cwd: gitRepoDir,
      commit: "--hard; rm -rf /"
    }, { cwd: gitRepoDir, policy: defaultPolicy });

    expect(badRestore.ok).toBe(false);
    expect(badRestore.kind).toBe("capability_denied");
  });
});

describe("grep_search single-file cap", () => {
  test("explicit single file over 512KB is searched by default; dir walk still skips it", async () => {
    const dir = join(testDir, "grep_big");
    mkdirSync(dir, { recursive: true });
    const big = join(dir, "big.ts");
    writeFileSync(big, "x".repeat(700 * 1024) + "\nconst NEEDLE_MARKER = 1;\n");

    const single = await runSaVmTool({ action: "grep_search", path: big, query: "NEEDLE_MARKER" } as never, { cwd: workspace, policy: defaultPolicy } as never);
    expect(single.ok).toBe(true);
    expect(String(single.stdout)).toContain("NEEDLE_MARKER");

    const walk = await runSaVmTool({ action: "grep_search", dir, query: "NEEDLE_MARKER" } as never, { cwd: workspace, policy: defaultPolicy } as never);
    expect(String(walk.stdout)).not.toContain("NEEDLE_MARKER");

    const capped = await runSaVmTool({ action: "grep_search", path: big, query: "NEEDLE_MARKER", max_file_bytes: 1024 } as never, { cwd: workspace, policy: defaultPolicy } as never);
    expect(String(capped.stderr)).toContain("exceeds max_file_bytes");
  });
});
