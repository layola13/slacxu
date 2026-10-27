import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { ClineHookAttribution } from "../../backends/cline/src/runtime/clineHookAttribution.js";
import { recordClineSpawn } from "../../backends/cline/src/runtime/clineChildSession.js";

/**
 * Teammate tool attribution (cline 3.0.73, reversed from the installed
 * bundle): the hub stream carries no agent routing on tool events, so a
 * teammate's tools must be joined out-of-band —
 * `logs/hooks.jsonl` (tool_call.id -> runtime agent) +
 * `db/teams.db` teammate_spawned (runtime agent -> team agent) +
 * `cxu-spawns.json` (team agent -> child card).
 */

const LEAD = "agent_00000000-0000-0000-0000-000000000001";
const MATE = "agent_00000000-0000-0000-0000-000000000002";

function hookLine(entry: Record<string, unknown>): string {
  return JSON.stringify({
    ts: "2026-10-25T00:00:00.000Z",
    hookName: "tool_call",
    taskId: "conv_test",
    sessionContext: { rootSessionId: "sess-team" },
    agent_id: LEAD,
    parent_agent_id: null,
    ...entry,
  });
}

function stageHooks(dir: string): void {
  mkdirSync(join(dir, "logs"), { recursive: true });
  writeFileSync(join(dir, "logs", "hooks.jsonl"), [
    hookLine({ agent_id: LEAD, tool_call: { id: "call-lead-1", name: "read_files", input: {} } }),
    hookLine({ agent_id: MATE, tool_call: { id: "call-mate-1", name: "run_commands", input: { commands: "ls" } } }),
    hookLine({ agent_id: MATE, tool_call: { id: "call-mate-2", name: "read_files", input: {} } }),
  ].join("\n") + "\n");
}

async function stageTeamsDb(dir: string): Promise<void> {
  mkdirSync(join(dir, "db"), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(dir, "db", "teams.db"));
  db.exec("CREATE TABLE team_events (id INTEGER PRIMARY KEY, team_name TEXT, event_type TEXT, payload_json TEXT)");
  db.prepare("INSERT INTO team_events (team_name, event_type, payload_json) VALUES (?, ?, ?)").run(
    "team-test",
    "teammate_spawned",
    JSON.stringify({
      type: "teammate_spawned",
      agentId: "agent-testing",
      teammate: { runtimeAgentId: MATE, conversationId: "conv_test", parentAgentId: LEAD },
    }),
  );
  db.close();
}

// Temp dirs are left to the OS tmp cleaner: an open sqlite read handle
// keeps Windows from releasing the dir inside the test process (same reason
// clineHubProtocol.test.ts never removes its temp dirs).
function stageSpawns(dir: string): void {
  mkdirSync(join(dir, "sessions", "sess-team"), { recursive: true });
  // The daemon creates the teammate transcript at spawn (empty until flush).
  writeFileSync(join(dir, "sessions", "sess-team", "agent-agent-testing__T1.messages.json"), JSON.stringify({
    version: 1,
    agent: "teammate",
    sessionId: "sess-team__teamtask__agent-testing__T1",
    origin: { source: "cli", mode: "team", parentThreadId: "sess-team", subagent: "agent-testing" },
    messages: [],
  }));
  recordClineSpawn(dir, {
    toolCallId: "call-spawn-9",
    rootSessionId: "sess-team",
    task: "spawn brief",
    systemPrompt: "",
    startedAt: Date.now(),
    agentId: "agent-testing",
  });
  recordClineSpawn(dir, {
    toolCallId: "call-run-9",
    rootSessionId: "sess-team",
    task: "run brief",
    systemPrompt: "",
    startedAt: Date.now(),
    agentId: "agent-testing",
  });
}

test("hook attribution joins teammate tools to the newest child card", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cline-attr-"));
  stageHooks(dir);
  await stageTeamsDb(dir);
  stageSpawns(dir);
  const attr = new ClineHookAttribution();
  attr.primeTeamLinks(dir);
  await new Promise((resolve) => setTimeout(resolve, 300));
  // Lead tools stay on the main thread.
  expect(attr.resolveChildCard(dir, "sess-team", "call-lead-1")).toBeNull();
  // Unknown ids stay on the main thread (never drop a tool).
  expect(attr.resolveChildCard(dir, "sess-team", "call-nope")).toBeNull();
  // Other roots never match.
  expect(attr.resolveChildCard(dir, "sess-other", "call-mate-1")).toBeNull();
  // Teammate tools join the newest card for their agent (the run card).
  expect(attr.resolveChildCard(dir, "sess-team", "call-mate-1")).toBe("call-run-9");
  expect(attr.resolveChildCard(dir, "sess-team", "call-mate-2")).toBe("call-run-9");
});

test("teammate tools project into the child turn, not the main waterfall", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cline-attr-live-"));
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  const port = (wss.address() as { port: number }).port;
  let socketRef: import("ws").WebSocket | undefined;
  let seq = 0;
  wss.on("connection", (socket) => {
    socketRef = socket;
    socket.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, any>;
      if (msg.kind !== "command") return;
      const envelope = msg.envelope as Record<string, any>;
      socket.send(JSON.stringify({
        kind: "reply",
        envelope: {
          version: "v1",
          requestId: envelope.requestId,
          command: envelope.command,
          ok: true,
          payload: envelope.command === "session.create"
            ? { session: { sessionId: "sess-team", cwd: dir } }
            : {},
        },
      }));
    });
  });
  writeFileSync(join(dir, "hub-discovery.json"), JSON.stringify({
    url: `ws://127.0.0.1:${port}/hub`, authToken: "tok", pid: process.pid, hubId: "hub_attr",
  }));
  writeFileSync(join(dir, "cline-fake"), "fake");
  {
    stageHooks(dir);
    await stageTeamsDb(dir);
    stageSpawns(dir);
    const { ClineAgentBridge } = await import("../../backends/cline/src/runtime/clineAgentBridge.js");
    const bridge = new ClineAgentBridge(dir, () => ({ ...process.env, CLINE_BIN: join(dir, "cline-fake") }));
    const messages: Array<{ method: string; params: any }> = [];
    bridge.on("message", (msg: any) => {
      if (msg && typeof msg.method === "string") messages.push(msg);
    });
    const emit = (event: string, payload: Record<string, unknown>) => {
      seq += 1;
      socketRef?.send(JSON.stringify({
        kind: "event",
        envelope: { version: "v1", event, eventId: `evt-attr-${seq}`, sessionId: "sess-team", payload },
      }));
    };
    const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      await bridge.request("thread/start", { cwd: dir, model: "m" });
      await bridge.request("turn/start", { threadId: "sess-team", prompt: "go" });
      await settle(200);
      // Lead delegation card stays on the main thread.
      emit("tool.started", { toolCallId: "call-run-9", toolName: "team_run_task", input: { agentId: "agent-testing", task: "run brief" } });
      // Lead's own tool stays on the main thread.
      emit("tool.started", { toolCallId: "call-lead-1", toolName: "read_files", input: { files: [] } });
      // Teammate's tools move to the child card's turn.
      emit("tool.started", { toolCallId: "call-mate-1", toolName: "run_commands", input: { commands: "ls" } });
      emit("tool.finished", { toolCallId: "call-mate-1", toolName: "run_commands", output: [{ query: "ls", result: "ok" }] });
      await settle();
      const mainToolIds = messages
        .filter((m) => m.params?.threadId === "sess-team" && m.params?.item?.type === "toolCall")
        .map((m) => m.params.item.id);
      expect(mainToolIds).toContain("call-lead-1");
      expect(mainToolIds).not.toContain("call-mate-1");
      const childEvents = messages.filter((m) => m.params?.threadId === "call-run-9");
      expect(childEvents.length).toBeGreaterThan(0);
      expect(childEvents.every((m) => m.params?.turnId === "call-run-9")).toBe(true);
      const childTool = childEvents.map((m) => m.params.item).pop() as Record<string, any>;
      expect(childTool.id).toBe("call-mate-1");
      expect(childTool.status).toBe("completed");
      expect(String(childTool.input?.commands)).toBe("ls");
      // Child read merges the live feed (daemon transcript flushes late).
      const proj = bridge.hasChildThread("call-run-9") ? await bridge.request("thread/items/list", { threadId: "call-run-9" }) : null;
      const items = (proj as any)?.items as Array<Record<string, any>> ?? [];
      expect(items.some((item) => item.id === "call-mate-1")).toBe(true);
    } finally {
      bridge.stop();
    }
  }
  wss.close();
});
