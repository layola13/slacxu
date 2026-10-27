import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { findClineBin } from "../../backends/cline/src/runtime/clineCommand.js";
import {
  clineMcpSettingsPath,
  clineProvidersPath,
  ensureClineMcpSettingsFile,
  writeClineRelayProvider,
} from "../../backends/cline/src/runtime/clineProviders.js";
import { ClineHubClient, CLINE_MIN_HUB_VERSION, compareClineVersions, isClineHubSupported, type ClineHubEvent } from "../../backends/cline/src/runtime/clineHubClient.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "cline-test-"));
}

test("writeClineRelayProvider creates an openai-compatible BYOK entry", () => {
  const dir = tempDir();
  writeClineRelayProvider(dir, "cxu-p1-g1", {
    baseUrl: "http://127.0.0.1:9999/api/relay-gateway/p1/g1/v1",
    apiKey: "cline-relay-key",
    model: "fake-model",
  });
  const parsed = JSON.parse(readFileSync(clineProvidersPath(dir), "utf8"));
  expect(parsed.version).toBe(1);
  const entry = parsed.providers["cxu-p1-g1"];
  expect(entry.settings.provider).toBe("openai-compatible");
  expect(entry.settings.baseUrl).toContain("/api/relay-gateway/p1/g1/v1");
  expect(entry.settings.apiKey).toBe("cline-relay-key");
  expect(entry.settings.model).toBe("fake-model");
  expect(entry.tokenSource).toBe("manual");
});

test("writeClineRelayProvider preserves the user's own providers and lastUsedProvider", () => {
  const dir = tempDir();
  writeClineRelayProvider(dir, "cxu-p1-g1", { baseUrl: "http://x/v1", apiKey: "k", model: "m1" });
  const path = clineProvidersPath(dir);
  const withOwn = JSON.parse(readFileSync(path, "utf8"));
  withOwn.lastUsedProvider = "cline";
  withOwn.providers.cline = { settings: { provider: "cline", model: "anthropic/claude-sonnet-5.5" } };
  writeFileSync(path, JSON.stringify(withOwn, null, 2));
  writeClineRelayProvider(dir, "cxu-p2-g9", { baseUrl: "http://y/v1", apiKey: "k2", model: "m2" });
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  expect(parsed.lastUsedProvider).toBe("cline");
  expect(parsed.providers.cline.settings.provider).toBe("cline");
  expect(parsed.providers["cxu-p1-g1"].settings.model).toBe("m1");
  expect(parsed.providers["cxu-p2-g9"].settings.model).toBe("m2");
});

test("ensureClineMcpSettingsFile seeds an empty mcpServers object once", () => {
  const dir = tempDir();
  const path = ensureClineMcpSettingsFile(dir);
  expect(path).toBe(clineMcpSettingsPath(dir));
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ mcpServers: {} });
  writeFileSync(path, JSON.stringify({ mcpServers: { mine: { command: "x" } } }));
  ensureClineMcpSettingsFile(dir);
  expect(JSON.parse(readFileSync(path, "utf8")).mcpServers.mine.command).toBe("x");
});

test("findClineBin resolves CLINE_BIN and PATH entries", () => {
  const dir = tempDir();
  const fakeBin = join(dir, "cline");
  writeFileSync(fakeBin, "#!/bin/sh\n echo 3.0.73\n");
  expect(findClineBin({ CLINE_BIN: fakeBin, PATH: "" })).toBe(fakeBin);
  expect(findClineBin({ PATH: dir })).toBe(fakeBin);
  expect(findClineBin({ PATH: "/nonexistent-dir-for-cline-test" })).toBeUndefined();
  expect(existsSync(fakeBin)).toBe(true);
});

/**
 * Protocol regression test for the reverse-engineered hub wire format:
 * a fake hub records the frames the client sends and answers in the
 * vendor's reply shape. If a future cline release changes the handshake
 * (subprotocol auth, client.register, command envelopes, stream.subscribe
 * frames), this test is the canary.
 */
test("ClineHubClient speaks the v1 hub protocol (register, command, subscribe, events)", async () => {
  const dir = tempDir();
  const frames: Array<Record<string, unknown>> = [];
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  const port = (wss.address() as { port: number }).port;
  let seenSubprotocol: string | undefined;
  wss.on("connection", (socket, request) => {
    seenSubprotocol = request.headers["sec-websocket-protocol"];
    socket.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      frames.push(msg);
      if (msg.kind === "command") {
        const envelope = msg.envelope as Record<string, unknown>;
        socket.send(JSON.stringify({
          kind: "reply",
          envelope: {
            version: "v1",
            requestId: envelope.requestId,
            command: envelope.command,
            ok: true,
            payload: envelope.command === "session.create"
              ? { session: { sessionId: "sess-1", cwd: "/tmp" } }
              : {},
          },
        }));
        if (envelope.command === "session.create") {
          socket.send(JSON.stringify({
            kind: "event",
            envelope: {
              version: "v1",
              event: "run.completed",
              eventId: "evt-1",
              sessionId: "sess-1",
              payload: { result: { text: "hi" } },
            },
          }));
        }
      }
    });
  });
  writeFileSync(join(dir, "hub-discovery.json"), JSON.stringify({
    url: `ws://127.0.0.1:${port}/hub`,
    authToken: "tok-123",
    pid: process.pid,
    hubId: "hub_test",
  }));

  const client = new ClineHubClient({ binPath: "/bin/true", dataDir: dir });
  const events: ClineHubEvent[] = [];
  client.on("event", (event: ClineHubEvent) => events.push(event));
  await client.connect();
  client.subscribe("sess-1");
  const created = await client.command("session.create", { cwd: "/tmp", metadata: { provider: "cxu-p-g", model: "m" } });
  expect(created.session).toMatchObject({ sessionId: "sess-1" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  client.close();
  wss.close();

  expect(seenSubprotocol).toBe("cline-hub-auth.tok-123");
  const register = frames.find((frame) => (frame.envelope as Record<string, unknown>)?.command === "client.register");
  expect(register?.kind).toBe("command");
  expect((register?.envelope as Record<string, unknown>)?.version).toBe("v1");
  const create = frames.find((frame) => (frame.envelope as Record<string, unknown>)?.command === "session.create");
  expect((create?.envelope as Record<string, unknown>)?.payload).toMatchObject({ cwd: "/tmp" });
  const subscribe = frames.find((frame) => frame.kind === "stream.subscribe");
  expect(subscribe?.sessionId).toBe("sess-1");
  expect(events.map((event) => event.event)).toEqual(["run.completed"]);
});

afterAll(() => {
  // No shared state to tear down; temp dirs are left to the OS tmp cleaner.
});

test("hub version gate rejects CLIs without --discovery-path support", () => {
  expect(CLINE_MIN_HUB_VERSION).toBe("3.0.73");
  expect(compareClineVersions("3.0.68", CLINE_MIN_HUB_VERSION)).toBe(-1);
  expect(compareClineVersions("3.0.73", CLINE_MIN_HUB_VERSION)).toBe(0);
  expect(compareClineVersions("3.1.0", CLINE_MIN_HUB_VERSION)).toBe(1);
  expect(isClineHubSupported("3.0.68")).toBe(false);
  expect(isClineHubSupported("3.0.73")).toBe(true);
  expect(isClineHubSupported(null)).toBe(true);
  expect(isClineHubSupported("")).toBe(true);
});

test("live tool.started/finished events project ordered toolCall cards", async () => {
  const dir = tempDir();
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  const port = (wss.address() as { port: number }).port;
  let seq = 0;
  const sendEvent = (socket: any, event: string, payload: Record<string, unknown>) => {
    seq += 1;
    socket.send(JSON.stringify({
      kind: "event",
      envelope: { version: "v1", event, eventId: `evt-${seq}`, sessionId: "sess-live", payload },
    }));
  };
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.kind !== "command") return;
      const envelope = msg.envelope as Record<string, unknown>;
      const command = envelope.command;
      const payload = command === "session.create"
        ? { session: { sessionId: "sess-live", cwd: dir } }
        : {};
      socket.send(JSON.stringify({
        kind: "reply",
        envelope: { version: "v1", requestId: envelope.requestId, command, ok: true, payload },
      }));
      if (command === "run.enqueue") {
        sendEvent(socket, "tool.started", { toolCallId: "tool-1", name: "read_file", input: { path: "a.ts" } });
        sendEvent(socket, "tool.finished", { toolCallId: "tool-1", name: "read_file", output: "file bytes" });
        sendEvent(socket, "run.completed", { result: { text: "done" } });
      }
    });
  });
  writeFileSync(join(dir, "hub-discovery.json"), JSON.stringify({
    url: `ws://127.0.0.1:${port}/hub`,
    authToken: "tok-live",
    pid: process.pid,
    hubId: "hub_live",
  }));
  const fakeBin = join(dir, "cline-fake");
  writeFileSync(fakeBin, "fake");
  const { ClineAgentBridge } = await import("../../backends/cline/src/runtime/clineAgentBridge.js");
  const bridge = new ClineAgentBridge(dir, () => ({ ...process.env, CLINE_BIN: fakeBin }));
  const messages: Array<{ method: string; params: any }> = [];
  bridge.on("message", (msg: any) => {
    if (msg && typeof msg.method === "string") messages.push(msg);
  });
  await bridge.request("thread/start", { cwd: dir, model: "m" });
  await bridge.request("turn/start", { threadId: "sess-live", prompt: "do it" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  bridge.stop();
  wss.close();
  const order = messages.map((m) => m.method);
  const startedIdx = order.findIndex((method, i) => method === "item/started" && (messages[i] as any)?.params?.item?.type === "toolCall");
  const completedIdx = order.findIndex((method, i) => method === "item/completed" && (messages[i] as any)?.params?.item?.type === "toolCall");
  expect(startedIdx).toBeGreaterThanOrEqual(0);
  expect(completedIdx).toBeGreaterThan(startedIdx);
  expect((messages[startedIdx] as any)?.params?.item?.toolName).toBe("read_file");
  expect((messages[startedIdx] as any)?.params?.item?.arguments).toEqual({ path: "a.ts" });
  expect((messages[completedIdx] as any)?.params?.item?.status).toBe("completed");
});

test("task tools project as collabAgentToolCall for the agent rail", async () => {
  const dir = tempDir();
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  const port = (wss.address() as { port: number }).port;
  let seq = 0;
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.kind !== "command") return;
      const envelope = msg.envelope as Record<string, unknown>;
      const command = envelope.command;
      const payload = command === "session.create"
        ? { session: { sessionId: "sess-task", cwd: dir } }
        : {};
      socket.send(JSON.stringify({
        kind: "reply",
        envelope: { version: "v1", requestId: envelope.requestId, command, ok: true, payload },
      }));
      if (command === "run.enqueue") {
        seq += 1;
        const sendEvent = (event: string, payload: Record<string, unknown>) => {
          seq += 1;
          socket.send(JSON.stringify({
            kind: "event",
            envelope: { version: "v1", event, eventId: `evt-task-${seq}`, sessionId: "sess-task", payload },
          }));
        };
        sendEvent("tool.started", { toolCallId: "task-1", name: "new_task", input: { description: "explore repo" } });
        sendEvent("tool.finished", { toolCallId: "task-1", name: "new_task", output: "explored" });
        sendEvent("run.completed", { result: { text: "done" } });
      }
    });
  });
  writeFileSync(join(dir, "hub-discovery.json"), JSON.stringify({
    url: `ws://127.0.0.1:${port}/hub`,
    authToken: "tok-task",
    pid: process.pid,
    hubId: "hub_task",
  }));
  const fakeBin = join(dir, "cline-fake");
  writeFileSync(fakeBin, "fake");
  const { ClineAgentBridge } = await import("../../backends/cline/src/runtime/clineAgentBridge.js");
  const bridge = new ClineAgentBridge(dir, () => ({ ...process.env, CLINE_BIN: fakeBin }));
  const messages: Array<{ method: string; params: any }> = [];
  bridge.on("message", (msg: any) => {
    if (msg && typeof msg.method === "string") messages.push(msg);
  });
  await bridge.request("thread/start", { cwd: dir, model: "m" });
  await bridge.request("turn/start", { threadId: "sess-task", prompt: "go" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  bridge.stop();
  wss.close();
  const started = messages.find((m) => m.method === "item/started" && m.params?.item?.id === "task-1");
  expect(started?.params?.item?.type).toBe("collabAgentToolCall");
  expect(started?.params?.item?.tool).toBe("task");
  expect(started?.params?.item?.prompt).toBe("explore repo");
  const completed = messages.find((m) => m.method === "item/completed" && m.params?.item?.id === "task-1");
  expect(completed?.params?.item?.type).toBe("collabAgentToolCall");
  expect(completed?.params?.item?.status).toBe("completed");
});

test("team mode ends the turn on agent.done and settles open team_run_task cards", async () => {
  const dir = tempDir();
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  const port = (wss.address() as { port: number }).port;
  let seq = 0;
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.kind !== "command") return;
      const envelope = msg.envelope as Record<string, unknown>;
      const command = envelope.command;
      const payload = command === "session.create"
        ? { session: { sessionId: "sess-team", cwd: dir } }
        : {};
      socket.send(JSON.stringify({
        kind: "reply",
        envelope: { version: "v1", requestId: envelope.requestId, command, ok: true, payload },
      }));
      if (command === "run.enqueue") {
        seq += 1;
        const sendEvent = (event: string, payload: Record<string, unknown>) => {
          seq += 1;
          socket.send(JSON.stringify({
            kind: "event",
            envelope: { version: "v1", event, eventId: `evt-team-${seq}`, sessionId: "sess-team", payload },
          }));
        };
        sendEvent("tool.started", { toolCallId: "spawn-1", toolName: "team_spawn_teammate", input: { agentId: "backend-eval", rolePrompt: "eval backend" } });
        sendEvent("tool.finished", { toolCallId: "spawn-1", toolName: "team_spawn_teammate", output: "spawned" });
        // Dispatched but never finished by the hub — agent.done must settle it.
        sendEvent("tool.started", { toolCallId: "run-1", toolName: "team_run_task", input: { agentId: "backend-eval", task: "eval the backend" } });
        // Async dispatch receipts are NOT completion: the card stays running
        // until the await barrier lands.
        sendEvent("tool.finished", { toolCallId: "run-1", toolName: "team_run_task", output: { agentId: "backend-eval", mode: "async", status: "queued", dispatched: true, runId: "run_00001" } });
        sendEvent("tool.started", { toolCallId: "await-1", toolName: "team_await_runs", input: {} });
        sendEvent("tool.finished", { toolCallId: "await-1", toolName: "team_await_runs", output: "all runs done" });
        sendEvent("tool.started", { toolCallId: "tt-1", toolName: "team_task", input: { action: "create", title: "Eval backend", assignee: "backend-eval" } });
        sendEvent("tool.finished", { toolCallId: "tt-1", toolName: "team_task", output: "created" });
        sendEvent("tool.started", { toolCallId: "tt-2", toolName: "team_task", input: { action: "complete", taskId: "task_0001", summary: "backend evaluated" } });
        sendEvent("usage.updated", { totals: { inputTokens: 100, outputTokens: 20 } });
        sendEvent("reasoning.finished", { reasoning: "considering the team plan" });
        sendEvent("agent.done", { reason: "completed", text: "team report" });
        // spawn_agent reports arrive AFTER agent.done with no prior started
        // event and output wrapped as {text,...}: they must still project.
        sendEvent("tool.finished", { toolCallId: "spawn-9", toolName: "spawn_agent", output: { text: "subagent report", iterations: 3, finishReason: "completed" } });
      }
    });
  });
  writeFileSync(join(dir, "hub-discovery.json"), JSON.stringify({
    url: `ws://127.0.0.1:${port}/hub`,
    authToken: "tok-team",
    pid: process.pid,
    hubId: "hub_team",
  }));
  const fakeBin = join(dir, "cline-fake");
  writeFileSync(fakeBin, "fake");
  const { ClineAgentBridge } = await import("../../backends/cline/src/runtime/clineAgentBridge.js");
  const bridge = new ClineAgentBridge(dir, () => ({ ...process.env, CLINE_BIN: fakeBin }));
  const messages: Array<{ method: string; params: any }> = [];
  bridge.on("message", (msg: any) => {
    if (msg && typeof msg.method === "string") messages.push(msg);
  });
  await bridge.request("thread/start", { cwd: dir, model: "m" });
  const turn = await bridge.request("turn/start", { threadId: "sess-team", prompt: "go" }) as Record<string, any>;
  await new Promise((resolve) => setTimeout(resolve, 300));
  bridge.stop();
  wss.close();
  const turnId = turn.turn.id as string;
  const spawn = messages.find((m) => m.method === "item/completed" && m.params?.item?.id === "spawn-1");
  expect(spawn?.params?.item?.type).toBe("collabAgentToolCall");
  expect(spawn?.params?.item?.agentName).toBe("backend-eval");
  const runStarted = messages.find((m) => m.method === "item/started" && m.params?.item?.id === "run-1");
  expect(runStarted?.params?.item?.type).toBe("collabAgentToolCall");
  expect(runStarted?.params?.item?.agentName).toBe("backend-eval");
  expect(runStarted?.params?.item?.prompt).toBe("eval the backend");
  // agent.done settles the still-open card instead of leaving it running.
  const runSettled = messages.find((m) => m.method === "item/completed" && m.params?.item?.id === "run-1");
  expect(runSettled?.params?.item?.status).toBe("completed");
  // The async dispatch receipt itself must NOT complete the card: run-1's
  // message sequence is started, started (receipt, still running),
  // completed (await barrier) — never completed-by-receipt.
  const runSequence = messages
    .filter((m) => (m.method === "item/started" || m.method === "item/completed") && m.params?.item?.id === "run-1")
    .map((m) => m.method);
  expect(runSequence[0]).toBe("item/started");
  expect(runSequence).toContain("item/completed");
  expect(runSequence[runSequence.length - 1]).toBe("item/completed");
  const receiptEmit = messages.find((m) => m.method === "item/completed" && m.params?.item?.id === "run-1"
    && String(JSON.stringify((m.params?.item as any)?.output ?? "")).includes("queued"));
  expect(receiptEmit).toBeUndefined();
  // The terminal text lands and token usage flows from the stashed totals.
  const text = messages.find((m) => m.method === "item/completed" && m.params?.item?.type === "agentMessage" && m.params?.turnId === turnId);
  expect(String((text?.params?.item as any)?.content)).toContain("team report");
  const usage = messages.find((m) => m.method === "thread/tokenUsage/requestUpdated");
  expect((usage?.params as any)?.usage?.prompt_tokens).toBe(100);
  // Committed reasoning projects so the transcript shows Thinking.
  const thinking = messages.find((m) => m.method === "item/completed" && m.params?.item?.type === "reasoning");
  expect(String((thinking?.params?.item as any)?.content)).toContain("considering the team plan");
  // team_task create/complete folds into a plan item for the checklist UI.
  const plans = messages.filter((m) => m.method === "item/completed" && m.params?.item?.type === "plan");
  expect(plans.length).toBeGreaterThan(0);
  const lastPlan = plans[plans.length - 1]?.params?.item as any;
  expect(String(lastPlan.text)).toContain("[x]");
  expect(String(lastPlan.text)).toContain("Eval backend");
  // Late spawn_agent finished (after agent.done, no started event) still
  // projects a subagent card with the report text, not raw JSON.
  const spawned = messages.find((m) => m.method === "item/completed" && m.params?.item?.id === "spawn-9");
  expect(spawned?.params?.item?.type).toBe("collabAgentToolCall");
  expect(String((spawned?.params?.item as any)?.output)).toContain("subagent report");
});

test("spawn_agent started with a systemPrompt projects a named brief card", async () => {
  const dir = tempDir();
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  const port = (wss.address() as { port: number }).port;
  let seq = 0;
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.kind !== "command") return;
      const envelope = msg.envelope as Record<string, unknown>;
      const command = envelope.command;
      const payload = command === "session.create"
        ? { session: { sessionId: "sess-spawn", cwd: dir } }
        : {};
      socket.send(JSON.stringify({
        kind: "reply",
        envelope: { version: "v1", requestId: envelope.requestId, command, ok: true, payload },
      }));
      if (command === "run.enqueue") {
        seq += 1;
        const sendEvent = (event: string, payload: Record<string, unknown>) => {
          seq += 1;
          socket.send(JSON.stringify({
            kind: "event",
            envelope: { version: "v1", event, eventId: `evt-spawn-${seq}`, sessionId: "sess-spawn", payload },
          }));
        };
        sendEvent("tool.started", { toolCallId: "spawn-1", toolName: "spawn_agent", input: { systemPrompt: "你是 Codex Ultra 后端架构专家，负责评估线程订阅体系。" } });
        sendEvent("agent.done", { reason: "completed", text: "lead done" });
      }
    });
  });
  writeFileSync(join(dir, "hub-discovery.json"), JSON.stringify({
    url: `ws://127.0.0.1:${port}/hub`,
    authToken: "tok-spawn",
    pid: process.pid,
    hubId: "hub_spawn",
  }));
  const fakeBin = join(dir, "cline-fake");
  writeFileSync(fakeBin, "fake");
  const { ClineAgentBridge } = await import("../../backends/cline/src/runtime/clineAgentBridge.js");
  const bridge = new ClineAgentBridge(dir, () => ({ ...process.env, CLINE_BIN: fakeBin }));
  const messages: Array<{ method: string; params: any }> = [];
  bridge.on("message", (msg: any) => {
    if (msg && typeof msg.method === "string") messages.push(msg);
  });
  await bridge.request("thread/start", { cwd: dir, model: "m" });
  await bridge.request("turn/start", { threadId: "sess-spawn", prompt: "go" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  bridge.stop();
  wss.close();
  const started = messages.find((m) => m.method === "item/started" && m.params?.item?.id === "spawn-1");
  expect(started?.params?.item?.type).toBe("collabAgentToolCall");
  expect(String((started?.params?.item as any)?.agentName)).toContain("后端架构专家");
  expect(String((started?.params?.item as any)?.prompt)).toContain("负责评估线程订阅体系");
});
