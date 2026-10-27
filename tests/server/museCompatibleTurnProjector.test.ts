import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMuseProjectorContext,
  projectMuseJsonlRecord,
  finalizeMuseProjection,
  toMuseNotification,
} from "../../backends/muse/src/runtime/museCompatibleTurnProjector.js";
import { runMuseExecTurn } from "../../backends/muse/src/runtime/museCompatibleRuntime.js";
import { workspaceSaVmSkillPath } from "../../apps/server/src/saVmWorkspaceSkill.js";
import { mergeMcpServersJsonConfig } from "../../apps/server/src/saVmBundle.js";

function line(payloadType: string, payload: unknown): string {
  return JSON.stringify({ payload_type: payloadType, payload, stream: { kind: "session", id: "ses-1" } });
}

describe("museCompatibleTurnProjector waterfall", () => {
  test("1. thinking 增量投影为 reasoning 行", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const evs = projectMuseJsonlRecord(line("run.reasoning.delta", { text: "thinking about code" }), ctx);
    expect(evs.some((e) => e.kind === "item/reasoning/textDelta")).toBe(true);
    const notifs = evs.map(toMuseNotification);
    expect(notifs.some((n) => n.method === "item/reasoning/textDelta")).toBe(true);
  });

  test("2. todolist 投影为 plan 行 + turn/plan/updated", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const evs = projectMuseJsonlRecord(
      line("tool_batch.effect.started", {
        record: {
          tool_name: "write_todos",
          call_id: "call-todo-1",
          input: { todos: [{ content: "step1", status: "in_progress" }, { content: "step2", status: "pending" }] },
        },
      }),
      ctx,
    );
    expect(evs.some((e) => e.kind === "turn/plan/updated")).toBe(true);
    const plan = evs.find((e) => e.kind === "turn/plan/updated");
    expect(plan && (plan as { plan: Array<{ step: string }> }).plan.length).toBe(2);
    const notifs = evs.map(toMuseNotification);
    expect(notifs.some((n) => n.method === "turn/plan/updated")).toBe(true);
  });

  test("3. subagent 投影为 collabAgentToolCall 行", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const evs = projectMuseJsonlRecord(
      line("tool_batch.effect.started", {
        record: { tool_name: "subagent_spawn", call_id: "call-sub-1", input: { description: "research", prompt: "do research" } },
      }),
      ctx,
    );
    const started = evs.find((e) => e.kind === "item/started");
    expect(started).toBeDefined();
    const item = (started as { item: Record<string, unknown> }).item;
    expect(item.type).toBe("collabAgentToolCall");
  });

  test("4. mcp 工具投影为带 mcp 标记的 toolCall 行", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const evs = projectMuseJsonlRecord(
      line("tool_batch.effect.started", {
        record: { tool_name: "mcp__sa-vm__read_file", call_id: "call-mcp-1", input: { path: "x.ts" } },
      }),
      ctx,
    );
    const started = evs.find((e) => e.kind === "item/started");
    const item = (started as { item: Record<string, unknown> }).item;
    expect(item.type).toBe("toolCall");
    expect(item.mcp).toBe(true);
  });

  test("5. skill 投影为带 skill 标记的 toolCall 行", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const evs = projectMuseJsonlRecord(
      line("tool_batch.effect.started", {
        record: { tool_name: "read_skill", call_id: "call-skill-1", input: { skill: "sa-vm" } },
      }),
      ctx,
    );
    const started = evs.find((e) => e.kind === "item/started");
    const item = (started as { item: Record<string, unknown> }).item;
    expect(item.type).toBe("toolCall");
    expect(item.skill).toBe(true);
  });

  test("tool.result（stdout 真实形状）一次投影 started+completed 工具行", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const evs = projectMuseJsonlRecord(
      line("tool.result", {
        call_id: "call_01a1337c1cca79f3b51d0b39",
        correlation_facts: { outcome: "success", tool_name: "read_file" },
        kind: "tool_result",
        text: "Read text file `secret.txt`.\n1|tok2",
      }),
      ctx,
    );
    const kinds = evs.map((e) => e.kind);
    expect(kinds).toContain("item/started");
    expect(kinds).toContain("item/completed");
    const done = evs.find((e) => e.kind === "item/completed");
    const item = (done as { item: Record<string, unknown> }).item;
    expect(item.type).toBe("toolCall");
    expect(item.tool).toBe("read_file");
    expect(item.status).toBe("completed");
  });

  test("MCP 信封拆包：action 进 input（sa-vm 通道渲染 vm-<action>）", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const envelope = JSON.stringify({ status: "ok", action: "git_status", repo: "/content/codex-react-ui", branch: "mini-muse", counts: { staged: 0 } });
    const evs = projectMuseJsonlRecord(
      line("tool.result", { call_id: "c-mcp-1", correlation_facts: { outcome: "success", tool_name: "mcp__sa_vm__sa_vm_run" }, text: envelope }),
      ctx,
    );
    const done = evs.find((e) => e.kind === "item/completed");
    const item = (done as { item: Record<string, unknown> }).item;
    expect((item.input as Record<string, unknown>).action).toBe("git_status");
    expect(item.tool).toBe("mcp__sa_vm__sa_vm_run");
    expect(item.status).toBe("completed");
  });

  test("MCP 信封保留全量调用形参（start_line/end_line/numbered 等，白名单回归）", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const envelope = JSON.stringify({
      status: "ok", action: "read_lines", path: "src/main.ts",
      start_line: 1, end_line: 100, numbered: true, max_tokens: 4000,
      total_lines: 1250,
    });
    const evs = projectMuseJsonlRecord(
      line("tool.result", { call_id: "c-mcp-2", correlation_facts: { outcome: "success", tool_name: "mcp__sa_vm__sa_vm_run" }, text: envelope }),
      ctx,
    );
    const done = evs.find((e) => e.kind === "item/completed");
    const item = (done as { item: Record<string, unknown> }).item;
    const input = item.input as Record<string, unknown>;
    expect(input.action).toBe("read_lines");
    expect(input.path).toBe("src/main.ts");
    expect(input.start_line).toBe(1);
    expect(input.end_line).toBe(100);
    expect(input.numbered).toBe(true);
    expect(input.max_tokens).toBe(4000);
    // 结果数据不污染 input
    expect("total_lines" in input).toBe(false);
  });

  test("sa-vm 动作尾行：还原 read_lines 参数并从输出剥离", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const body = "[File: package.json | Total Lines: 76]\n  1: {\n  2: \"name\": \"x\"";
    const text = `${body}\n[sa-vm-action {"action":"read_lines","path":"package.json","start_line":1,"end_line":5}]`;
    const evs = projectMuseJsonlRecord(
      line("tool.result", { call_id: "c-mcp-3", correlation_facts: { outcome: "success", tool_name: "mcp__sa_vm__sa_vm_run" }, text }),
      ctx,
    );
    const done = evs.find((e) => e.kind === "item/completed");
    const item = (done as { item: Record<string, unknown> }).item;
    const input = item.input as Record<string, unknown>;
    expect(input.action).toBe("read_lines");
    expect(input.path).toBe("package.json");
    expect(input.start_line).toBe(1);
    expect(input.end_line).toBe(5);
    expect(item.output).toBe(body);
    expect(String(item.text ?? "")).not.toContain("sa-vm-action");
  });

  test("A->B->C 开始顺序：started 先占位，result 逆序到达仍原位 complete 且保留 started 参数", async () => {
    const { upsertMuseSessionItem } = await import("../../backends/muse/src/runtime/museBridge.js");
    const ctx = createMuseProjectorContext("t1", "turn1");
    const session = { messages: [] as unknown[] };
    const feed = (record: string) => {
      for (const e of projectMuseJsonlRecord(record, ctx)) {
        if (e.kind === "item/started" || e.kind === "item/completed") {
          upsertMuseSessionItem(session as never, e.kind, (e as { item: unknown }).item as never);
        }
      }
    };
    // 开始顺序 A(read) -> B(edit)，完成顺序倒挂 B -> A（session-log started + stdout result 交织的真实形状）
    feed(line("tool_batch.effect.started", { record: { tool_name: "read_file", call_id: "call-A", input: { path: "a.ts" } } }));
    feed(line("tool_batch.effect.started", { record: { tool_name: "edit_file", call_id: "call-B", input: { path: "b.ts" } } }));
    feed(line("tool.result", { call_id: "call-B", correlation_facts: { outcome: "success", tool_name: "edit_file" }, text: "edited b.ts" }));
    feed(line("tool.result", { call_id: "call-A", correlation_facts: { outcome: "success", tool_name: "read_file" }, text: "content of a.ts" }));
    const ids = session.messages.map((m) => (m as Record<string, unknown>).id);
    expect(ids).toEqual(["call-A", "call-B"]);
    const byId = Object.fromEntries(session.messages.map((m) => [(m as Record<string, unknown>).id, m]));
    expect(((byId["call-A"] as Record<string, unknown>).input as Record<string, unknown>).path).toBe("a.ts");
    expect(((byId["call-B"] as Record<string, unknown>).input as Record<string, unknown>).path).toBe("b.ts");
    for (const m of session.messages) {
      expect((m as Record<string, unknown>).status).toBe("completed");
    }
  });

  test("exec 信封拆包：command 进 input、output 只留真正输出", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const envelope = JSON.stringify({
      chunk_id: "exec-1-1",
      command: "git log --oneline -15",
      description: "Show recent commit history",
      exit_code: 0,
      terminal_status: "completed",
      output: "53c3b878 fix(muse): x\nnb78e6cdf fix(mini): y\n",
      truncated: false,
    });
    const evs = projectMuseJsonlRecord(
      line("tool.result", { call_id: "c-exec-1", correlation_facts: { outcome: "success", tool_name: "bash" }, text: envelope }),
      ctx,
    );
    const done = evs.find((e) => e.kind === "item/completed");
    const item = (done as { item: Record<string, unknown> }).item;
    expect((item.input as Record<string, unknown>).command).toBe("git log --oneline -15");
    expect(item.output).toBe("53c3b878 fix(muse): x\nnb78e6cdf fix(mini): y\n");
    expect(item.status).toBe("completed");
  });

  test("tool_output_ref 回填缺名 tool.result 的工具名", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const ref = projectMuseJsonlRecord(
      line("task.lifecycle.tool_output_ref", {
        event: { kind: "tool_output_ref", output_ref: { kind: "monitor-stdout", id: "monitor-stdout-01a133cb-5a03-7452-b9d5-99ee4254953c-call_abc123" } },
      }),
      ctx,
    );
    expect(ref).toEqual([]);
    const evs = projectMuseJsonlRecord(
      line("tool.result", { call_id: "call_abc123", kind: "tool_result", text: "some output" }),
      ctx,
    );
    const done = evs.find((e) => e.kind === "item/completed");
    expect(((done as { item: Record<string, unknown> }).item).tool).toBe("monitor");
  });

  test("unknown tool 文本抠名且标 failed", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const evs = projectMuseJsonlRecord(
      line("tool.result", { call_id: "call_x1", kind: "tool_result", text: "tool unavailable: unknown tool `sa_vm_run`. Session tool ids: bash, read_file" }),
      ctx,
    );
    const done = evs.find((e) => e.kind === "item/completed");
    const item = (done as { item: Record<string, unknown> }).item;
    expect(item.tool).toBe("sa_vm_run");
    expect(item.status).toBe("failed");
  });

  test("tool 结束关闭对应行，收尾关闭所有 open 行", () => {    const ctx = createMuseProjectorContext("t1", "turn1");
    projectMuseJsonlRecord(
      line("tool_batch.effect.started", { record: { tool_name: "read_file", call_id: "call-1", input: { path: "a.ts" } } }),
      ctx,
    );
    const done = projectMuseJsonlRecord(
      line("tool_batch.effect.terminal", {
        record: { tool_name: "read_file", call_id: "call-1", outcome: { kind: "completed" }, output: "content" },
      }),
      ctx,
    );
    expect(done.some((e) => e.kind === "item/completed")).toBe(true);
    projectMuseJsonlRecord(
      line("tool_batch.effect.started", { record: { tool_name: "bash", call_id: "call-2", input: { cmd: "ls" } } }),
      ctx,
    );
    const tail = finalizeMuseProjection(ctx, "completed");
    expect(tail.some((e) => e.kind === "item/completed")).toBe(true);
    expect(tail.some((e) => e.kind === "turn/completed")).toBe(true);
  });

  test("mini 对齐：toolCall 带 startedAt、output 截 2000、input.path 还原", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const big = `Read text file \`docs/a.txt\`.\n` + "x".repeat(5000);
    const evs = projectMuseJsonlRecord(
      line("tool.result", { call_id: "c-big", correlation_facts: { outcome: "success", tool_name: "read_file" }, text: big }),
      ctx,
    );
    const done = evs.find((e) => e.kind === "item/completed");
    const item = (done as { item: Record<string, unknown> }).item;
    expect(typeof item.startedAt).toBe("number");
    expect(String(item.output).length).toBeLessThanOrEqual(2000);
    expect((item.input as Record<string, unknown>).path).toBe("docs/a.txt");
  });

  test("mini 对齐：reasoning 标题 Thinking、plan 文本同格式", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const r = projectMuseJsonlRecord(line("run.reasoning.delta", { text: "hmm" }), ctx);
    const rStarted = r.find((e) => e.kind === "item/started");
    expect(((rStarted as { item: Record<string, unknown> }).item).title).toBe("Thinking");
    const ctx2 = createMuseProjectorContext("t1", "turn2");
    const p = projectMuseJsonlRecord(
      line("tool_batch.effect.started", { record: { tool_name: "write_todos", call_id: "c-p", input: { todos: [{ content: "s1", status: "in_progress" }] } } }),
      ctx2,
    );
    const plan = p.find((e) => e.kind === "turn/plan/updated");
    expect(((plan as { planItem: Record<string, unknown> }).planItem).text).toBe("- [ ] s1 _(in progress)_");
  });

  test("agent 文本增量走 item/agentMessage/delta（前端监听的方法名）", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const evs = projectMuseJsonlRecord(line("run.output.delta", { text: "hello " }), ctx);
    const notifs = evs.map(toMuseNotification);
    expect(notifs.some((n) => n.method === "item/agentMessage/delta")).toBe(true);
    expect(notifs.some((n) => n.method === "item/delta")).toBe(false);
  });
});

describe("muse waterfall order + dedupe regression", () => {
  // 线上真实抓包顺序：tool.result 先到，文本增量后到，终态最后。
  function realCapturedLines(): string[] {
    const j = (p: unknown) => JSON.stringify(p);
    return [
      j({ payload_type: "tool.result", payload: { call_id: "call_01a1337c1cca79f3b51d0b39", correlation_facts: { outcome: "success", tool_name: "read_file" }, kind: "tool_result", text: "Read text file `secret.txt`.\n1|tok2-931879ede498d6e0" } }),
      j({ payload_type: "run.output.delta", payload: { text: "tok2-931" } }),
      j({ payload_type: "run.output.delta", payload: { text: "879ede498d" } }),
      j({ payload_type: "run.output.delta", payload: { text: "6e0" } }),
      j({ payload_type: "run.terminal.completed", payload: { status: "completed" } }),
    ];
  }

  test("同一回答只产生一个 agentMessage id，增量拼接等于全文（重复显示回归）", async () => {
    const { finalizeMuseProjection } = await import("../../backends/muse/src/runtime/museCompatibleTurnProjector.js");
    const ctx = createMuseProjectorContext("t1", "turn1");
    const all: ReturnType<typeof projectMuseJsonlRecord> = [];
    for (const ln of realCapturedLines()) all.push(...projectMuseJsonlRecord(ln, ctx));
    all.push(...finalizeMuseProjection(ctx, "completed"));
    const notifs = all.map(toMuseNotification);
    const deltaIds = new Set(
      notifs.filter((n) => n.method === "item/agentMessage/delta").map((n) => (n.params as Record<string, unknown>).itemId),
    );
    expect(deltaIds.size).toBe(1);
    const joined = notifs
      .filter((n) => n.method === "item/agentMessage/delta")
      .map((n) => String((n.params as Record<string, unknown>).delta ?? ""))
      .join("");
    expect(joined).toBe("tok2-931879ede498d6e0");
    // 完成行同 id，原位更新，不新增第二行
    const completedIds = notifs
      .filter((n) => n.method === "item/completed")
      .map((n) => ((n.params as Record<string, unknown>).item as Record<string, unknown>)?.id);
    expect(completedIds.filter((id) => String(id).startsWith("muse-msg-")).length).toBe(1);
  });

  test("到达顺序即展示顺序：工具先到则工具行在前", async () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const kinds: string[] = [];
    for (const ln of realCapturedLines()) {
      for (const e of projectMuseJsonlRecord(ln, ctx)) {
        if (e.kind === "item/started") kinds.push(`started:${(e as { item: Record<string, unknown> }).item.type}`);
      }
    }
    expect(kinds[0]).toBe("started:toolCall");
    expect(kinds).toContain("started:agentMessage");
  });

  test("A-B-C 时序分段：前置文本遇到工具自动闭合，工具后文本开启新段，杜绝回答跑到工具前", () => {
    const ctx = createMuseProjectorContext("t1", "turn1");
    const events: ReturnType<typeof projectMuseJsonlRecord> = [];
    // 1. 模型先输出思考/前置问候
    events.push(...projectMuseJsonlRecord(line("run.output.delta", { text: "让我来排查文件..." }), ctx));
    // 2. 工具开始或结束（例如 tool.result）
    events.push(
      ...projectMuseJsonlRecord(
        line("tool.result", {
          call_id: "call_abc_123",
          correlation_facts: { outcome: "success", tool_name: "list_dir" },
          kind: "tool_result",
          text: "file1.txt\nfile2.txt",
        }),
        ctx,
      ),
    );
    // 3. 工具执行后的最终回答
    events.push(...projectMuseJsonlRecord(line("run.output.delta", { text: "排查结果如下：全部正常。" }), ctx));
    events.push(...finalizeMuseProjection(ctx, "completed"));

    const notifs = events.map(toMuseNotification);
    const itemStarts = notifs
      .filter((n) => n.method === "item/started")
      .map((n) => (n.params as Record<string, unknown>).item as Record<string, unknown>);

    expect(itemStarts.length).toBe(3);
    expect(itemStarts[0].type).toBe("agentMessage");
    expect(itemStarts[0].id).toBe("muse-msg-turn1-0");
    expect(itemStarts[1].type).toBe("toolCall");
    expect(itemStarts[1].id).toBe("call_abc_123");
    expect(itemStarts[2].type).toBe("agentMessage");
    expect(itemStarts[2].id).toBe("muse-msg-turn1-1");

    // 确认后置回答的内容属于 muse-msg-turn1-1
    const deltas = notifs
      .filter((n) => n.method === "item/agentMessage/delta")
      .map((n) => n.params as Record<string, unknown>);
    expect(deltas[0].itemId).toBe("muse-msg-turn1-0");
    expect(deltas[0].delta).toBe("让我来排查文件...");
    expect(deltas[1].itemId).toBe("muse-msg-turn1-1");
    expect(deltas[1].delta).toBe("排查结果如下：全部正常。");
  });

  test("muse 每 turn 前置用户指令防止小模型被长规则淹没，并包含 MCP 命名与执行硬规则", async () => {
    const { buildMuseExecutionPrompt, MUSE_MCP_NAMING_RULE, MUSE_EXECUTION_DIRECTIVE } = await import("../../backends/muse/src/runtime/museBridge.js");
    expect(MUSE_MCP_NAMING_RULE).toContain("mcp__sa_vm__sa_vm_run");
    expect(MUSE_MCP_NAMING_RULE).toContain("Never strip");
    expect(MUSE_MCP_NAMING_RULE).toContain("retry ONCE with `mcp__sa_vm__sa_vm_run`");
    expect(MUSE_MCP_NAMING_RULE).toContain("have NO bare tool");
    expect(MUSE_MCP_NAMING_RULE).toContain("DIFFERENT native tools");
    expect(MUSE_EXECUTION_DIRECTIVE).toContain("DO NOT output conversational acknowledgments");
    const bare = buildMuseExecutionPrompt(undefined, "do X");
    expect(bare.startsWith("[User Instruction]\ndo X")).toBe(true);
    expect(bare).toContain("mcp__sa_vm__sa_vm_run");
    const withDev = buildMuseExecutionPrompt("dev rules", "do Y");
    expect(withDev.startsWith("[User Instruction]\ndo Y")).toBe(true);
    expect(withDev.indexOf("[User Instruction]")).toBeLessThan(withDev.indexOf("[Execution Directives"));
    expect(withDev.indexOf("[Execution Directives")).toBeLessThan(withDev.indexOf("[Tool Reference & Constraints]"));
    expect(withDev).toContain("dev rules");
    const withSaVm = buildMuseExecutionPrompt("ACTIVE via `sa_vm_run`\nsa_vm_run({ action: 'read_lines' })", "do Z");
    expect(withSaVm.startsWith("[User Instruction]\ndo Z")).toBe(true);
    expect(withSaVm).not.toContain("`sa_vm_run`");
    expect(withSaVm).not.toMatch(/(?<![\w])sa_vm_run\(/);
    expect(withSaVm).toContain("`mcp__sa_vm__sa_vm_run`");
    expect(withSaVm).toContain("mcp__sa_vm__sa_vm_run({ action: 'read_lines' })");

    const { resolveMuseSaVmEnabled } = await import("../../backends/muse/src/runtime/museBridge.js");
    // Enhance-only turns (vmEnabled false) still carry sa-vm instructions and
    // must mount the MCP; otherwise the prompt promises tools that do not exist.
    expect(resolveMuseSaVmEnabled({ vmEnabled: false, enhanceEnabled: false }, "ACTIVE via `sa_vm_run`")).toBe(true);
    expect(resolveMuseSaVmEnabled({ vmEnabled: false, enhanceEnabled: true }, undefined)).toBe(true);
    expect(resolveMuseSaVmEnabled({ vmEnabled: true }, undefined)).toBe(true);
    expect(resolveMuseSaVmEnabled({ vmEnabled: false, enhanceEnabled: false }, undefined)).toBe(false);
  });

  test("applyMuseProjectedBatch 跳过 turn 事件、落盘不重复", async () => {
    const { applyMuseProjectedBatch, upsertMuseSessionItem } = await import("../../backends/muse/src/runtime/museBridge.js");
    const session = { messages: [] as unknown[] };
    const tool = { type: "toolCall", id: "c1", threadId: "t", turnId: "u", tool: "read_file", status: "completed", output: "ok" };
    const msgV1 = { type: "agentMessage", id: "muse-msg-u-0", threadId: "t", turnId: "u", text: "tok" };
    const msgV2 = { ...msgV1, text: "tok2", status: "completed" };
    const notifs = applyMuseProjectedBatch(session as never, [
      { kind: "turn/started", threadId: "t", turnId: "u" },
      { kind: "item/started", threadId: "t", turnId: "u", item: tool },
      { kind: "item/completed", threadId: "t", turnId: "u", item: tool },
      { kind: "item/started", threadId: "t", turnId: "u", item: msgV1 },
      { kind: "item/completed", threadId: "t", turnId: "u", item: msgV2 },
      { kind: "item/completed", threadId: "t", turnId: "u", item: msgV2 },
      { kind: "turn/completed", threadId: "t", turnId: "u" },
    ]);
    expect(notifs.some((n) => n.method.startsWith("turn/"))).toBe(false);
    expect(session.messages.length).toBe(2);
    const msg = (session.messages as Record<string, unknown>[]).find((m) => m.id === "muse-msg-u-0");
    expect(msg?.text).toBe("tok2");
    // upsert 语义：started 不复写已有行
    upsertMuseSessionItem(session as never, "item/started", msgV1 as never);
    expect(session.messages.length).toBe(2);
  });
});
describe("muse skill/mcp defaults", () => {
  test("muse backend skill 落到 .agents/skills", () => {
    expect(workspaceSaVmSkillPath("/ws", undefined, "muse").replace(/\\/g, "/")).toBe("/ws/.agents/skills/sa-vm/SKILL.md");
  });

  test("mcpServers 合并保留 sa-vm（muse settings.json 同形）", () => {
    const merged = mergeMcpServersJsonConfig({}, "/x/sa-vm-mcp.mjs");
    const servers = merged.mcpServers as Record<string, { command: string; args: string[] }>;
    expect(servers["sa-vm"].command).toBe("node");
    expect(servers["sa-vm"].args).toEqual(["/x/sa-vm-mcp.mjs"]);
  });

  test("muse 项目级 MCP 落到 .mcp.json（.muse/settings.json 不被 CLI 读取）", async () => {
    const { ensureSaVmProjectBundleInstalled } = await import("../../apps/server/src/saVmBundle.js");
    const dir = mkdtempSync(join(tmpdir(), "muse-schema-"));
    await ensureSaVmProjectBundleInstalled(dir);
    const { readFileSync, existsSync } = await import("node:fs");
    const settingsPath = join(dir, ".mcp.json");
    expect(existsSync(settingsPath)).toBe(true);
    expect(existsSync(join(dir, ".muse", "settings.json"))).toBe(false);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    expect((parsed.mcpServers as Record<string, unknown>)["sa-vm"]).toBeDefined();
  });

  test("runtime 全链路：stub muse 二进制的 tool_batch 事件透出 projected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-stub-"));
    const lines = [
      { payload_type: "run.output.delta", payload: { text: "hi " } },
      { payload_type: "tool_batch.effect.started", payload: { record: { tool_name: "read_file", call_id: "c1", input: { path: "a" } } } },
      { payload_type: "tool_batch.effect.terminal", payload: { record: { tool_name: "read_file", call_id: "c1", outcome: { kind: "completed" }, output: "ok" } } },
      { payload_type: "run.terminal.completed", payload: { status: "completed" } },
    ];
    const isWin = process.platform === "win32";
    const stub = join(dir, isWin ? "muse-stub.cmd" : "muse-stub.sh");
    const script = join(dir, "muse-stub.mjs");
    writeFileSync(script, lines.map((l) => `console.log(${JSON.stringify(JSON.stringify(l))});`).join("\n") + "\n");
    if (isWin) {
      writeFileSync(stub, `@node "${script}" %*\r\n`);
    } else {
      writeFileSync(stub, `#!/bin/sh\nnode "${script}" "$@"\n`);
      chmodSync(stub, 0o755);
    }
    const seen: Array<{ event: string; data?: unknown }> = [];
    const result = await runMuseExecTurn(
      { prompt: "hi", cwd: dir, threadId: "t-stub", turnId: "turn-stub", timeoutMs: 15000, env: { ...process.env, MUSE_BIN: stub } },
      (event, data) => { seen.push({ event, data }); },
    );
    expect(result.completed).toBe(true);
    expect(result.text).toBe("hi ");
    const projected = seen.filter((s) => s.event === "projected").flatMap((s) => s.data as unknown[]);
    const kinds = projected.map((e) => (e as { kind: string }).kind);
    expect(kinds).toContain("turn/started");
    expect(kinds).toContain("item/started");
    expect(kinds).toContain("item/completed");
    expect(kinds).toContain("turn/completed");
  }, 30000);

  test("turn/interrupt terminates running muse process and marks turn interrupted", async () => {
    const { MuseBridge } = await import("../../backends/muse/src/runtime/museBridge.js");
    const dir = mkdtempSync(join(tmpdir(), "muse-interrupt-"));
    const isWin = process.platform === "win32";
    const stub = join(dir, isWin ? "muse-stub.cmd" : "muse-stub.sh");
    const script = join(dir, "muse-stub.mjs");
    writeFileSync(script, `
      console.log(JSON.stringify({ payload_type: "run.output.delta", payload: { text: "starting..." } }));
      setTimeout(() => {
        console.log(JSON.stringify({ payload_type: "run.terminal.completed", payload: { status: "completed" } }));
      }, 30000);
    `);
    if (isWin) {
      writeFileSync(stub, `@node "${script}" %*\r\n`);
    } else {
      writeFileSync(stub, `#!/bin/sh\nnode "${script}" "$@"\n`);
      chmodSync(stub, 0o755);
    }
    const oldKey = process.env.META_API_KEY;
    const oldBin = process.env.MUSE_BIN;
    process.env.META_API_KEY = "test-meta-key";
    process.env.MUSE_BIN = stub;
    const bridge = new MuseBridge();
    try {
      const notifications: Array<{ method: string; params: any }> = [];
      bridge.on("notification", (notif) => { notifications.push(notif); });

      const threadRes = await bridge.request("thread/start", { cwd: dir }) as { thread: { id: string } };
      const threadId = threadRes.thread.id;

      // Start turn
      const turnRes = await bridge.request("turn/start", { threadId, prompt: "test" }) as { turn: { id: string } };
      const turnId = turnRes.turn.id;

      // Wait a brief moment for process to spawn
      await new Promise((r) => setTimeout(r, 200));

      // Interrupt turn
      const intRes = await bridge.request("turn/interrupt", { threadId, turnId });
      expect(intRes).toEqual({ ok: true });

      // Verify turn/interrupted notification was emitted
      const interruptedNotif = notifications.find((n) => n.method === "turn/interrupted");
      expect(interruptedNotif).toBeDefined();
      expect(interruptedNotif?.params.threadId).toBe(threadId);
      expect(interruptedNotif?.params.turnId).toBe(turnId);
      expect(interruptedNotif?.params.turn.status).toBe("interrupted");
    } finally {
      if (oldKey !== undefined) process.env.META_API_KEY = oldKey; else delete process.env.META_API_KEY;
      if (oldBin !== undefined) process.env.MUSE_BIN = oldBin; else delete process.env.MUSE_BIN;
      bridge.stop();
    }
  }, 30000);
});

describe("muse subagent / workflow 生命周期（真机样本）", () => {
  const committed = (toolCalls: unknown[]) => line("runtime.session", {
    event: { kind: "assistant_tool_calls_committed", tool_calls: toolCalls },
  });

  test("原生 subagent_spawn：真实入参 + 子会话 id + result_ready 收尾", () => {
    const ctx = createMuseProjectorContext("t-sub", "turn-sub");
    const callId = "call-925abb5e-1618-4605-9bcb-c43113ddb104";
    const subagentId = "01a16156-4ae8-7f92-a6d3-5d963d4f56b1";
    const childSessionId = "01a16156-4b20-7580-8804-446d7ffde13b";

    projectMuseJsonlRecord(committed([{
      name: "subagent_spawn",
      call_id: callId,
      args: JSON.stringify({
        command_id: "read-hello-1",
        objective: "Read the file /tmp/muse-real/hello.txt and return its exact content.",
        role: "File reader",
        task_name: "read-hello",
      }),
    }]), ctx);
    projectMuseJsonlRecord(line("subagent.control.spawn_accepted", { record: { subagent_id: subagentId } }), ctx);
    projectMuseJsonlRecord(line("subagent.control.resume_context_recorded", {
      record: { subagent_id: subagentId, objective: "Read the file /tmp/muse-real/hello.txt and return its exact content.", role: "File reader" },
    }), ctx);
    projectMuseJsonlRecord(line("subagent.control.child_session_bound", {
      record: { subagent_id: subagentId, child_session_id: childSessionId },
    }), ctx);
    projectMuseJsonlRecord(line("subagent.control.start_attested", {
      record: { subagent_id: subagentId, subagent_session_id: childSessionId, dispatched_via_tool_call_id: callId },
    }), ctx);
    projectMuseJsonlRecord(line("tool.result", {
      correlation_facts: { outcome: "success", tool_name: "subagent_spawn" },
      call_id: callId,
      text: JSON.stringify({ status: "accepted", subagent_id: subagentId }),
    }), ctx);
    const mid = ctx.activeTools.get(callId);
    expect(mid?.type).toBe("collabAgentToolCall");
    expect(mid?.prompt).toBe("Read the file /tmp/muse-real/hello.txt and return its exact content.");
    expect(mid?.agentName).toBe("read-hello");
    expect(mid?.agentRole).toBe("File reader");
    expect(mid?.receiverThreadIds).toEqual([childSessionId]);
    expect(mid?.status).toBe("inProgress");

    projectMuseJsonlRecord(line("subagent.control.result_ready", {
      record: {
        subagent_id: subagentId,
        summary: "HELLO_FROM_MUSE_REAL",
        text: "HELLO_FROM_MUSE_REAL",
        error_kind: null,
      },
    }), ctx);
    const done = ctx.activeTools.get(callId);
    expect(done?.status).toBe("completed");
    expect(done?.agentStatus).toBe("completed");
    expect(done?.output).toBe("HELLO_FROM_MUSE_REAL");
    expect((done?.agentsStates as Record<string, { status: string }>)[childSessionId].status).toBe("completed");
  });

  test("workflow：脚本 prompt + child session + reconciled 最终摘要", () => {
    const ctx = createMuseProjectorContext("t-wf", "turn-wf");
    const callId = "call-70fba1fc-2e45-49f7-b1ef-82bf054e0965";
    const runId = "workflow-run-model-tool-call-70fba1fc-2e45-49f7-b1ef-82bf054e0965";
    const childId = "01a16150-ab2c-7103-b2da-98883b6e2724";
    const childSessionId = "0468fdaf-acbd-7af6-8f8f-3d90d74ec79e";
    const script = `export default function ({ host }) {
  return host.agent({ input: "Read /tmp/muse-real/hello.txt and return its exact content.", label: "read-hello" });
}`;

    projectMuseJsonlRecord(committed([{
      name: "workflow",
      call_id: callId,
      args: JSON.stringify({ name: "Read hello.txt via subagent", script }),
    }]), ctx);
    projectMuseJsonlRecord(line("runtime.session", {
      event: {
        kind: "workflow_run_launched",
        call_id: callId,
        workflow_run_id: runId,
        entry_id: "Read hello.txt via subagent",
        script_id: "generated.workflow.Read_hello.txt_via_subagent",
        script_path: "/tmp/sessions/x/workflows/scripts/x.js",
        child_limit: 6,
      },
    }), ctx);
    projectMuseJsonlRecord(line("runtime.session", {
      event: {
        kind: "workflow_child_lifecycle",
        workflow_run_id: runId,
        child_id: childId,
        label: "read-hello",
        status: "started",
        session_stream: { id: childSessionId, kind: "session" },
      },
    }), ctx);
    const running = ctx.activeTools.get(callId);
    expect(running?.prompt).toBe("Read /tmp/muse-real/hello.txt and return its exact content.");
    expect(running?.receiverThreadIds).toEqual([childSessionId]);

    projectMuseJsonlRecord(line("tool.result", {
      correlation_facts: { outcome: "success", tool_name: "workflow" },
      call_id: callId,
      text: JSON.stringify({
        entryId: "Read hello.txt via subagent",
        scriptPath: "/tmp/sessions/x/workflows/scripts/x.js",
        message: "Workflow launched",
      }),
    }), ctx);
    expect(ctx.activeTools.get(callId)?.status).toBe("inProgress");

    projectMuseJsonlRecord(line("runtime.session", {
      event: {
        kind: "workflow_launch_reconciled",
        call_id: callId,
        message: `<workflow-launch-reconciled>${JSON.stringify({
          final_summary: { status: "completed", summary: "HELLO_FROM_MUSE_REAL" },
          deferred_to_background: false,
        })}</workflow-launch-reconciled>`,
        product_projection: {
          child_rows: [{ subagent_id: childId, status: "completed", summary: "HELLO_FROM_MUSE_REAL" }],
        },
      },
    }), ctx);
    const done = ctx.activeTools.get(callId);
    expect(done?.status).toBe("completed");
    expect(done?.output).toBe("HELLO_FROM_MUSE_REAL");
    expect(done?.finalSummary).toBe("HELLO_FROM_MUSE_REAL");
    const children = done?.children as Array<Record<string, unknown>>;
    expect(children[0]?.id).toBe(childId);
    expect(children[0]?.label).toBe("read-hello");
    expect(children[0]?.summary).toBe("HELLO_FROM_MUSE_REAL");
    const states = done?.agentsStates as Record<string, { status: string }>;
    expect(states[childSessionId].status).toBe("completed");
  });

  test("subagent_wait 是普通工具行，并把摘要回填 spawn 卡片", () => {
    const ctx = createMuseProjectorContext("t-wait", "turn-wait");
    const spawnCall = "call-spawn-1";
    const waitCall = "call-wait-1";
    const subagentId = "sub-1";
    const childSessionId = "child-1";
    projectMuseJsonlRecord(committed([{
      name: "subagent_spawn",
      call_id: spawnCall,
      args: JSON.stringify({ objective: "Read hello.txt", role: "File reader", task_name: "read-hello" }),
    }]), ctx);
    projectMuseJsonlRecord(line("tool.result", {
      correlation_facts: { outcome: "success", tool_name: "subagent_spawn" },
      call_id: spawnCall,
      text: JSON.stringify({ status: "accepted", subagent_id: subagentId }),
    }), ctx);

    const waitEvents = projectMuseJsonlRecord(line("tool.result", {
      correlation_facts: { outcome: "success", tool_name: "subagent_wait" },
      call_id: waitCall,
      text: JSON.stringify({ status: "ready", subagent_id: subagentId, summary: "HELLO_FROM_MUSE_REAL" }),
    }), ctx);
    const waitItem = ctx.activeTools.get(waitCall);
    expect(waitItem?.type).toBe("toolCall");
    expect(waitItem?.tool).toBe("subagent_wait");
    const collabEvents = waitEvents.filter((e) => e.item.type === "collabAgentToolCall");
    // 回填 spawn 卡片只发 collab 更新，不新建 wait 卡片
    expect(collabEvents.length).toBe(1);
    expect(collabEvents[0]?.item.id).not.toBe(`muse-subagent-${waitCall}`);
    const spawn = ctx.activeTools.get(spawnCall);
    expect(spawn?.status).toBe("completed");
    expect(spawn?.output).toBe("HELLO_FROM_MUSE_REAL");
    expect((spawn?.agentsStates as Record<string, { status: string }>)[childSessionId]).toBeUndefined();
  });
});
