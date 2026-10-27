import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.js";
import {
  fireMiniTurnFinishHook,
  onMiniServerHook,
} from "../../backends/mini/src/runtime/miniServerHooks.js";

const savedDataDir = process.env.CODEX_UI_DATA_DIR;
afterEach(() => {
  if (savedDataDir === undefined) delete process.env.CODEX_UI_DATA_DIR;
  else process.env.CODEX_UI_DATA_DIR = savedDataDir;
});

function freshUltraHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "mini-finish-hooks-"));
  process.env.CODEX_UI_DATA_DIR = dir;
  return dir;
}

function fixtureBridge() {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      await request.json();
      return Response.json({
        choices: [{ message: { content: "hi there" }, finish_reason: "stop" }],
      });
    },
  });
  const bridge = new MiniBridge({
    resolveRelayTarget: async () => ({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      apiKey: "fixture",
      protocol: "chat",
      contextWindow: 100_000,
      streamMaxRetries: 0,
    }),
  });
  return { bridge, stop: () => server.stop() };
}

/** Turn-finish hooks are fire-and-forget by design (never gate turn/completed),
 * so observer delivery lags the terminal notification: poll for it. */
async function waitForStop(
  seen: Array<{ event: string; payload: Record<string, unknown> }>,
  expectedThreadId?: string,
  timeoutMs = 5_000,
): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + timeoutMs;
  const match = (x: { event: string; payload: Record<string, unknown> }) =>
    x.event === "Stop" && (!expectedThreadId || x.payload.threadId === expectedThreadId);
  let found = seen.find(match)?.payload;
  while (!found && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    found = seen.find(match)?.payload;
  }
  return found;
}

async function runTextTurn(bridge: MiniBridge, cwd: string): Promise<{ threadId: string; turnId: string }> {
  const started = await bridge.request("thread/start", {
    cwd,
    providerId: "fixture",
    model: "fixture-model",
    sandbox: "read-only",
    approvalPolicy: "never",
  }) as { thread: { id: string } };
  const threadId = started.thread.id;
  const turnDone = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Mini fixture turn timed out")), 15_000);
    const handler = (n: { method: string; params: Record<string, unknown> }) => {
      if (n.method !== "turn/completed" && n.method !== "turn/failed") return;
      clearTimeout(timer);
      bridge.off("notification", handler);
      resolve(String(n.params.turnId));
    };
    bridge.on("notification", handler);
    void bridge.request("turn/start", { threadId, prompt: "hello" }).catch(reject);
  });
  return { threadId, turnId: await turnDone };
}

test("Stop observer fires on completed turn with identity+data payload (no hooks configured)", async () => {
  freshUltraHome();
  const cwd = mkdtempSync(join(tmpdir(), "mini-finish-obs-"));
  const { bridge, stop } = fixtureBridge();
  try {
    const seen: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const off = onMiniServerHook((event, payload) => { seen.push({ event, payload }); });
    try {
      const { threadId, turnId } = await runTextTurn(bridge, cwd);
      const stop = await waitForStop(seen, threadId);
      expect(stop).toBeDefined();
      expect(stop!.threadId).toBe(threadId);
      expect(stop!.turnId).toBe(turnId);
      expect(stop!.status).toBe("completed");
      expect(stop!.hook_event_name).toBe("Stop");
      expect(typeof stop!.summary).toBe("string");
    } finally {
      off();
    }
  } finally {
    stop();
  }
});

const ECHO_CTX = `bun -e "console.log(JSON.stringify({hookSpecificOutput:{additionalContext:'CTX-FINISH-OK'}}))"`;

test("command hook executes with Stop stdin and collects additionalContext", async () => {
  const ultra = freshUltraHome();
  await Bun.write(join(ultra, "hooks.json"), JSON.stringify({
    Stop: [{ matcher: "", hooks: [{ type: "command", command: ECHO_CTX }] }],
  }));
  const cwd = mkdtempSync(join(tmpdir(), "mini-finish-cmd-"));
  const { bridge, stop } = fixtureBridge();
  try {
    const seen: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const off = onMiniServerHook((event, payload) => { seen.push({ event, payload }); });
    try {
      const { threadId } = await runTextTurn(bridge, cwd);
      const payload = await waitForStop(seen, threadId);
      expect(payload).toBeDefined();
      expect(payload!.handlers).toBe(1);
      expect(payload!.completed).toBe(1);
      expect(payload!.additionalContexts).toContain("CTX-FINISH-OK");
    } finally {
      off();
    }
  } finally {
    stop();
  }
});

test("block decision is recorded but never enforced (turn still completes)", async () => {
  const ultra = freshUltraHome();
  await Bun.write(join(ultra, "hooks.json"), JSON.stringify({
    Stop: [{ matcher: "", hooks: [{ type: "command", command: `bun -e "console.log(JSON.stringify({decision:'block',reason:'NOPE'}))"` }] }],
  }));
  const cwd = mkdtempSync(join(tmpdir(), "mini-finish-block-"));
  const { bridge, stop } = fixtureBridge();
  try {
    const seen: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const off = onMiniServerHook((event, payload) => { seen.push({ event, payload }); });
    try {
      // runTextTurn resolves only on turn/completed|failed: proves no gate.
      const { threadId, turnId } = await runTextTurn(bridge, cwd);
      const payload = await waitForStop(seen, threadId);
      expect(payload).toBeDefined();
      expect(payload!.blocked).toBe(1);
      expect(payload!.turnId).toBe(turnId);
    } finally {
      off();
    }
  } finally {
    stop();
  }
});

test("child turns fire SubagentStop, top-level turns fire Stop", async () => {
  const ultra = freshUltraHome();
  const seen: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const off = onMiniServerHook((event, payload) => { seen.push({ event, payload }); });
  try {
    const cwd = mkdtempSync(join(tmpdir(), "mini-finish-sub-"));
    const top = await fireMiniTurnFinishHook({
      threadId: "thr-top", turnId: "turn-top", cwd, model: "m", status: "completed", summary: "done", ultraHome: ultra,
    });
    expect(top.event).toBe("Stop");
    const child = await fireMiniTurnFinishHook({
      threadId: "thr-child", turnId: "turn-child", parentThreadId: "thr-top",
      cwd, model: "m", status: "completed", summary: "report", agentName: "worker_a", ultraHome: ultra,
    });
    expect(child.event).toBe("SubagentStop");
    expect(seen.map((x) => x.event)).toEqual(["Stop", "SubagentStop"]);
    expect(seen[1]!.payload.parentThreadId).toBe("thr-top");
  } finally {
    off();
  }
});

test("TOML discovery honors matcher scoping", async () => {
  const ultra = freshUltraHome();
  await Bun.write(join(ultra, "hooks.toml"), [
    "[[SubagentStop]]",
    'matcher = "worker_.*"',
    "",
    "[[SubagentStop.hooks]]",
    'type = "command"',
    'command = "bun -e \\"process.exit(0)\\""',
    "",
  ].join("\n"));
  const cwd = mkdtempSync(join(tmpdir(), "mini-finish-toml-"));
  const miss = await fireMiniTurnFinishHook({
    threadId: "t", turnId: "u", parentThreadId: "p", cwd, status: "completed", agentName: "other", ultraHome: ultra,
  });
  expect(miss.handlers).toBe(0);
  const hit = await fireMiniTurnFinishHook({
    threadId: "t", turnId: "u", parentThreadId: "p", cwd, status: "completed", agentName: "worker_a", ultraHome: ultra,
  });
  expect(hit.handlers).toBe(1);
  expect(hit.completed).toBe(1);
});

test("SessionEnd fires on thread/delete", async () => {
  freshUltraHome();
  const cwd = mkdtempSync(join(tmpdir(), "mini-finish-del-"));
  const { bridge, stop } = fixtureBridge();
  try {
    const seen: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const off = onMiniServerHook((event, payload) => { seen.push({ event, payload }); });
    try {
      const started = await bridge.request("thread/start", {
        cwd, providerId: "fixture", model: "fixture-model", sandbox: "read-only", approvalPolicy: "never",
      }) as { thread: { id: string } };
      await bridge.request("thread/delete", { threadId: started.thread.id });
      // SessionEnd is fire-and-forget: poll briefly for the observer event.
      const deadline = Date.now() + 5_000;
      let end: Record<string, unknown> | undefined;
      while (!end && Date.now() < deadline) {
        end = seen.find((x) => x.event === "SessionEnd")?.payload;
        if (!end) await new Promise((r) => setTimeout(r, 25));
      }
      expect(end).toBeDefined();
      expect(end!.threadId).toBe(started.thread.id);
      expect(end!.reason).toBe("deleted");
    } finally {
      off();
    }
  } finally {
    stop();
  }
});
