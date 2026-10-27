import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { activitySummary } from "../../apps/web/src/waterfall/ChatRow.tsx";
import { buildChatRows } from "../../apps/web/src/waterfall/chatRows.ts";
import type { WorkbenchItem, WorkbenchTurn } from "../../apps/web/src/state/codexClient.ts";

/**
 * Replays real hub events captured from a live cline session through the
 * bridge and then through the waterfall projection. Covers the two reported
 * regressions end-to-end (bridge -> item -> rendered summary):
 *
 *  1. `run_commands` sends its shell text on tool.started and `input: null` on
 *     tool.finished, so a merge that forgets the started input renders an
 *     empty `command()` card.
 *  2. `team_run_task` in async mode "finishes" with a dispatch receipt
 *     ({status:"queued", runId}) — the card must stay running until the
 *     `team_await_runs` barrier lands, not flip to completed at dispatch.
 */

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "fixtures", "cline-hub-real-team-run.json"), "utf8")
) as { sessionId: string; events: Array<{ event: string; payload: Record<string, unknown> }> };

test("real cline hub events keep command text and hold async team runs until await", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cline-replay-"));
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
      const payload = envelope.command === "session.create"
        ? { session: { sessionId: "sess-replay", cwd: dir } }
        : {};
      socket.send(JSON.stringify({
        kind: "reply",
        envelope: { version: "v1", requestId: envelope.requestId, command: envelope.command, ok: true, payload },
      }));
    });
  });
  writeFileSync(join(dir, "hub-discovery.json"), JSON.stringify({
    url: `ws://127.0.0.1:${port}/hub`, authToken: "tok", pid: process.pid, hubId: "hub_replay",
  }));
  const fakeBin = join(dir, "cline-fake");
  writeFileSync(fakeBin, "fake");
  const { ClineAgentBridge } = await import("../../backends/cline/src/runtime/clineAgentBridge.js");
  const bridge = new ClineAgentBridge(dir, () => ({ ...process.env, CLINE_BIN: fakeBin }));
  const messages: Array<{ method: string; params: any }> = [];
  bridge.on("message", (msg: any) => {
    if (msg && typeof msg.method === "string") messages.push(msg);
  });
  const emit = (event: string, payload: Record<string, unknown>) => {
    seq += 1;
    socketRef?.send(JSON.stringify({
      kind: "event",
      envelope: { version: "v1", event, eventId: `evt-replay-${seq}`, sessionId: "sess-replay", payload },
    }));
  };
  const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    await bridge.request("thread/start", { cwd: dir, model: "m" });
    await bridge.request("turn/start", { threadId: "sess-replay", prompt: "go" });
    await settle(200);

    // ---- 1. real run_commands pair (started carries commands, finished does not) ----
    const pairs = new Map<string, { started?: Record<string, unknown>; finished?: Record<string, unknown> }>();
    for (const entry of fixture.events) {
      if (entry.payload.toolName !== "run_commands") continue;
      const id = String(entry.payload.toolCallId);
      const slot = pairs.get(id) ?? {};
      if (entry.event === "tool.started") slot.started = entry.payload;
      else slot.finished = entry.payload;
      pairs.set(id, slot);
    }
    // The log starts mid-turn: pick a pair that has both halves.
    const complete = [...pairs.entries()].find(([, slot]) => slot.started && slot.finished);
    expect(complete).toBeDefined();
    const [cmdId, cmdPair] = complete!;
    expect(cmdPair.finished!.input ?? null).toBeNull();
    emit("tool.started", cmdPair.started!);
    emit("tool.finished", cmdPair.finished!);
    await settle();

    const cmdItems = messages.filter((m) => m.method === "item/completed" && m.params?.item?.id === cmdId);
    const cmdItem = cmdItems[cmdItems.length - 1]?.params?.item as Record<string, any>;
    expect(cmdItem).toBeDefined();
    expect(cmdItem.status).toBe("completed");
    const expectedCommand = String((cmdPair.started!.input as Record<string, unknown>).commands);
    expect(String(cmdItem.input?.commands)).toBe(expectedCommand);

    // The waterfall must surface that text as the card detail.
    const projected = messages
      .filter((m) => m.method === "item/completed" && m.params?.item?.id)
      .map((m) => m.params.item as WorkbenchItem)
      // codexClient.itemText() flattens `content` blocks into `text` before the
      // waterfall sees an item; mirror that here (content: [{type:"text"}]).
      .map((item) => {
        const record = item as unknown as Record<string, any>;
        if (typeof record.text === "string") return item;
        const content = record.content;
        const text = typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.map((block: any) => (typeof block?.text === "string" ? block.text : "")).join("")
            : "";
        return { ...record, text } as WorkbenchItem;
      });
    if (process.env.CXU_REPLAY_DEBUG) {
      console.log(JSON.stringify(projected.map((item) => ({ id: (item as any).id, type: (item as any).type, text: (item as any).text })), null, 1));
    }
    const turn = {
      id: "turn-replay",
      threadId: "sess-replay",
      status: "completed",
      items: projected,
    } as WorkbenchTurn;
    const rows = buildChatRows([turn]);
    const cmdRow = rows.find((row) => row.itemIds.includes(cmdId));
    expect(cmdRow).toBeDefined();
    // A lone tool call folds into a group; the command text must survive as
    // the inner row's detail (that is what the card prints).
    const inner = ((cmdRow as any).groupedRows ?? [cmdRow]) as Array<{ itemIds: string[] }>;
    const toolRow = inner.find((row) => row.itemIds.includes(cmdId)) ?? (cmdRow as any);
    expect(activitySummary(toolRow).detail).toContain(expectedCommand.slice(0, 24));

    // ---- 2. async team_run_task dispatch must not complete the card ----
    const runId = "run_00001";
    emit("tool.started", {
      toolCallId: "replay-run-1",
      toolName: "team_run_task",
      input: { agentId: "eval-arch", task: "评估线程订阅体系" },
    });
    emit("tool.finished", {
      toolCallId: "replay-run-1",
      toolName: "team_run_task",
      output: {
        agentId: "eval-arch",
        mode: "async",
        status: "queued",
        dispatched: true,
        message: "Task dispatched to eval-arch and queued as run_00001.",
        runId,
      },
    });
    await settle();

    const forRun = messages.filter((m) => (m.method === "item/started" || m.method === "item/completed")
      && m.params?.item?.id === "replay-run-1");
    expect(forRun.length).toBeGreaterThan(0);
    // Nothing in the dispatch phase may report completion.
    expect(forRun.every((m) => m.method === "item/started")).toBe(true);
    const dispatched = forRun[forRun.length - 1]!.params.item as Record<string, any>;
    expect(dispatched.status).not.toBe("completed");
    expect(dispatched.agentStatus).not.toBe("completed");

    // Await barrier settles it.
    emit("tool.started", { toolCallId: "replay-await-1", toolName: "team_await_runs", input: {} });
    emit("tool.finished", { toolCallId: "replay-await-1", toolName: "team_await_runs", output: "all runs finished" });
    await settle();

    const settled = messages.filter((m) => m.method === "item/completed" && m.params?.item?.id === "replay-run-1");
    expect(settled.length).toBeGreaterThan(0);
    const settledItem = settled[settled.length - 1]!.params.item as Record<string, any>;
    expect(settledItem.status).toBe("completed");
    expect(String(JSON.stringify(settledItem.output ?? ""))).not.toContain("queued");

    // ---- 3. team_list_runs is the live run board (no await in team mode) ----
    // Real team sessions poll `team_list_runs` and never await, so the card
    // must track the daemon's per-run status instead of hanging until the
    // turn ends (or showing the dispatch receipt).
    emit("tool.started", {
      toolCallId: "replay-run-2",
      toolName: "team_run_task",
      input: { agentId: "agent-testing", task: "评估测试覆盖" },
    });
    emit("tool.finished", {
      toolCallId: "replay-run-2",
      toolName: "team_run_task",
      output: {
        agentId: "agent-testing",
        mode: "async",
        status: "queued",
        dispatched: true,
        message: "Task dispatched to agent-testing and queued as run_00002.",
        runId: "run_00002",
      },
    });
    await settle();
    const dispatched2 = messages
      .filter((m) => m.params?.item?.id === "replay-run-2")
      .map((m) => m.params.item as Record<string, any>)
      .pop()!;
    // The receipt is not a report: the card body is the human dispatch line.
    expect(String(JSON.stringify(dispatched2.output ?? ""))).not.toContain("dispatched\":true");
    expect(String(dispatched2.output ?? "")).toContain("queued as run_00002");

    emit("tool.started", { toolCallId: "replay-list-1", toolName: "team_list_runs", input: {} });
    emit("tool.finished", {
      toolCallId: "replay-list-1",
      toolName: "team_list_runs",
      output: [{
        id: "run_00002",
        agentId: "agent-testing",
        status: "running",
        currentActivity: "读取 apps/server/src/index.ts",
        lastProgressMessage: "统计测试文件清单",
      }],
    });
    await settle();
    const running = messages
      .filter((m) => m.params?.item?.id === "replay-run-2")
      .map((m) => m.params.item as Record<string, any>)
      .pop()!;
    expect(running.status).toBe("inProgress");
    expect(running.agentStatus).toBe("running");
    expect(String(running.output ?? "")).toContain("统计测试文件清单");

    // Heartbeat-only snapshots keep the previous body instead of printing
    // "heartbeat" as if it were progress (the real daemon behaviour).
    emit("tool.finished", {
      toolCallId: "replay-list-1",
      toolName: "team_list_runs",
      output: [{
        id: "run_00002",
        agentId: "agent-testing",
        status: "running",
        currentActivity: "heartbeat",
        lastProgressMessage: "heartbeat",
      }],
    });
    await settle();
    const beat = messages
      .filter((m) => m.params?.item?.id === "replay-run-2")
      .map((m) => m.params.item as Record<string, any>)
      .pop()!;
    expect(beat.status).toBe("inProgress");
    expect(String(beat.output ?? "")).not.toContain("heartbeat");
    expect(String(beat.output ?? "")).toContain("统计测试文件清单");

    emit("tool.started", { toolCallId: "replay-list-2", toolName: "team_list_runs", input: {} });
    emit("tool.finished", {
      toolCallId: "replay-list-2",
      toolName: "team_list_runs",
      output: [{
        id: "run_00002",
        agentId: "agent-testing",
        status: "completed",
        messagePreview: "测试覆盖评估：核心链路 42 个用例，缺口 3 处。",
      }],
    });
    await settle();
    const done = messages
      .filter((m) => m.method === "item/completed" && m.params?.item?.id === "replay-run-2");
    expect(done.length).toBeGreaterThan(0);
    const doneItem = done[done.length - 1]!.params.item as Record<string, any>;
    expect(doneItem.status).toBe("completed");
    expect(doneItem.agentStatus).toBe("completed");
    // No team tool output carries the report: the terminal card keeps the
    // task prompt and drops the dispatch receipt (full text is the child card).
    expect(String(doneItem.output ?? "")).not.toContain("queued as");
    // A heartbeat-only snapshot must never replace real progress text.
    expect(String(doneItem.output ?? "")).not.toContain("heartbeat");
  } finally {
    bridge.stop();
    wss.close();
  }
});
