import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MINI_BUDGET_WRAP_UP_NOTE, MiniBridge, type MiniSnapshot } from "../../backends/mini/src/runtime/miniBridge.ts";

type ScriptedMessage = { content?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>; finishReason?: string };

function toolReply(name: string, args: Record<string, unknown>): ScriptedMessage {
  return { tool_calls: [{ id: crypto.randomUUID(), type: "function", function: { name, arguments: JSON.stringify(args) } }] };
}

const pendingPlan = [
  { content: "探索 Demo 现状", status: "in_progress" },
  { content: "实施抛物线和角度设计", status: "pending" },
  { content: "验证修改", status: "pending" },
];
const evasion = "workspace现状（已在上下文中，无需重复读取）。暂无明确修改需求；如需我改动请直接说目标。";

async function fixture(protocol: "chat" | "responses", sandbox = "danger-full-access", contextWindow = 1_000_000) {
  const cwd = mkdtempSync(join(tmpdir(), "mini-task-recovery-"));
  await Bun.write(join(cwd, "index.html"), "const angle = 0;\n");
  let script: (round: number) => ScriptedMessage = () => ({ content: "All done" });
  const requests: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push(await request.json() as Record<string, unknown>);
      const message = script(requests.length);
      if (protocol === "chat") {
        const { finishReason, ...payload } = message;
        return Response.json({ choices: [{ message: payload, finish_reason: finishReason ?? (payload.tool_calls ? "tool_calls" : "stop") }] });
      }
      return Response.json({ output: [
        ...(message.content ? [{ type: "message", content: [{ type: "output_text", text: message.content }] }] : []),
        ...(message.tool_calls ?? []).map((call) => ({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments })),
      ] });
    },
  });
  let snapshot: MiniSnapshot | undefined;
  const bridge = new MiniBridge({
    resolveRelayTarget: async () => ({ baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "fixture", protocol, contextWindow, streamMaxRetries: 0 }),
    onSnapshot: (value) => { snapshot = value; },
  });
  const bootstrapSetting = process.env.SA_VM_BOOTSTRAP_DISABLED;
  process.env.SA_VM_BOOTSTRAP_DISABLED = "1";
  let started: { thread: { id: string } };
  try {
    started = await bridge.request("thread/start", { cwd, providerId: "fixture", model: "fixture-model", sandbox, approvalPolicy: "never" }) as { thread: { id: string } };
  } finally {
    if (bootstrapSetting === undefined) delete process.env.SA_VM_BOOTSTRAP_DISABLED;
    else process.env.SA_VM_BOOTSTRAP_DISABLED = bootstrapSetting;
  }
  const threadId = started.thread.id;

  return {
    cwd,
    requests,
    get snapshot() { return snapshot; },
    async run(prompt: string, nextScript: (round: number) => ScriptedMessage, extra: Record<string, unknown> = {}) {
      script = nextScript;
      requests.length = 0;
      return await new Promise<{ method: string; params: Record<string, unknown> }>((resolve, reject) => {
        const timer = setTimeout(() => {
          bridge.off("notification", handler);
          reject(new Error("Mini fixture turn timed out"));
        }, 15_000);
        const handler = (notification: { method: string; params: Record<string, unknown> }) => {
          if (!["turn/completed", "turn/failed"].includes(notification.method)) return;
          clearTimeout(timer);
          bridge.off("notification", handler);
          resolve(notification);
        };
        bridge.on("notification", handler);
        void bridge.request("turn/start", { threadId, prompt, ...extra }).catch((error) => {
          clearTimeout(timer);
          bridge.off("notification", handler);
          reject(error);
        });
      });
    },
    stop() {
      bridge.stop();
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

describe("mini task recovery through real turn loops", () => {
  for (const protocol of ["chat", "responses"] as const) {
    test(`${protocol}: a short answer to the prior question survives plan + repeated evasion and lands an edit`, async () => {
      const state = await fixture(protocol);
      try {
        expect((await state.run("浏览项目，只分析，不要修改", (round) => round === 1
          ? toolReply("sa_vm", { action: "read_file", path: "index.html" })
          : { content: "项目已浏览：愤怒的小鸟网页版。当前无明确的修改需求，请说明下一步：修复玩法还是新增功能？" })).method).toBe("turn/completed");
        const result = await state.run("抛物线，设计角度", (round) => {
          if (round === 1) return toolReply("update_plan", { todos: pendingPlan });
          if (round === 2 || round === 3) return { content: evasion };
          if (round === 4) return toolReply("sa_vm", { action: "edit_file", path: "index.html", old_text: "angle = 0", new_text: "angle = 45" });
          if (round === 5) return toolReply("sa_vm", { action: "read_file", path: "index.html" });
          if (round === 6) return toolReply("update_plan", { todos: pendingPlan.map((step) => ({ ...step, status: "completed" })) });
          return { content: "All done" };
        });
        expect(result.method).toBe("turn/completed");
        expect(await Bun.file(join(state.cwd, "index.html")).text()).toContain("angle = 45");
        expect(state.requests).toHaveLength(7);
        expect(JSON.stringify(state.requests[2])).toContain("ACTIVE USER TASK is already a requirement");
        expect(JSON.stringify(state.requests[0])).toContain("answers to the previous assistant question");
        const currentPlan = state.snapshot?.messages.filter((message) => message && typeof message === "object" && !Array.isArray(message) && message.type === "plan").at(-1) as { plan: Array<{ status: string }> };
        expect(currentPlan.plan.every((step) => step.status === "completed")).toBe(true);
      } finally {
        state.stop();
      }
    }, 30_000);

    test(`${protocol}: repeated task evasion fails honestly without burning the full turn budget`, async () => {
      const state = await fixture(protocol);
      try {
        const result = await state.run("抛物线，设计角度", () => ({ content: evasion }));
        expect(result.method).toBe("turn/failed");
        expect(state.requests).toHaveLength(3);
        expect(JSON.stringify(result.params)).toContain("未执行当前需求");
        expect(await Bun.file(join(state.cwd, "index.html")).text()).toBe("const angle = 0;\n");
      } finally {
        state.stop();
      }
    });
  }

  test("a noun-only follow-up with no plan inherits the most recent development context", async () => {
    const state = await fixture("chat");
    try {
      await state.run("浏览项目，只分析", () => ({ content: "项目已浏览，请说明下一步：修复玩法还是新增功能？" }));
      const result = await state.run("抛物线，角度", (round) => {
        if (round === 1) return { content: evasion };
        if (round === 2) return toolReply("sa_vm", { action: "edit_file", path: "index.html", old_text: "angle = 0", new_text: "angle = 45" });
        return { content: "All done" };
      });
      expect(result.method).toBe("turn/completed");
      expect(state.requests).toHaveLength(3);
      expect(await Bun.file(join(state.cwd, "index.html")).text()).toContain("angle = 45");
      expect(JSON.stringify(state.requests[1])).toContain("ACTIVE USER TASK is already a requirement");
    } finally {
      state.stop();
    }
  });

  test("an unchanged pending plan receives one escalation before an honest failure", async () => {
    const state = await fixture("chat");
    try {
      const result = await state.run("抛物线", (round) => round === 1
        ? toolReply("update_plan", { todos: pendingPlan }) : { content: "代码现状已在上下文中。" });
      expect(result.method).toBe("turn/failed");
      expect(state.requests).toHaveLength(4);
      expect(JSON.stringify(state.requests[3])).toContain("unchanged fingerprint is not task completion");
      expect(JSON.stringify(result.params)).toContain("计划未完成");
    } finally {
      state.stop();
    }
  });

  test("repeated plan-only calls cannot silently complete the turn", async () => {
    const state = await fixture("chat");
    try {
      const result = await state.run("抛物线", () => toolReply("update_plan", { todos: pendingPlan }));
      expect(result.method).toBe("turn/failed");
      expect(state.requests).toHaveLength(3);
      expect(JSON.stringify(state.requests[2])).toContain("unchanged fingerprint is not task completion");
    } finally {
      state.stop();
    }
  });

  for (const prompt of ["你好", "say hi briefly", "什么是抛物线", "What is a plan?", "and now summarize it", "设计角度，只分析，不要修改", "不要调用工具，直接总结"]) {
    test(`does not steer writes for ${prompt}`, async () => {
      const state = await fixture("chat");
      try {
        const result = await state.run(prompt, () => ({ content: "说明：这里没有新的修改需求。" }));
        expect(result.method).toBe("turn/completed");
        expect(state.requests).toHaveLength(1);
        expect(JSON.stringify(state.requests)).not.toContain("ACTIVE USER TASK is already a requirement");
      } finally {
        state.stop();
      }
    });
  }

  test("read-only sandbox and concrete blockers bypass implementation pressure", async () => {
    const state = await fixture("chat", "read-only");
    try {
      const result = await state.run("抛物线，设计角度", () => ({ content: "只读沙箱禁止修改，无法完成实现。" }));
      expect(result.method).toBe("turn/completed");
      expect(state.requests).toHaveLength(1);
    } finally {
      state.stop();
    }
  });

  test("a targeted clarification exits even with a pending plan", async () => {
    const state = await fixture("chat");
    try {
      const result = await state.run("设计角度", (round) => round === 1
        ? toolReply("update_plan", { todos: pendingPlan })
        : { content: "两个互不兼容的保存格式都会影响历史数据；需要兼容哪一个？" });
      expect(result.method).toBe("turn/completed");
      expect(state.requests).toHaveLength(2);
    } finally {
      state.stop();
    }
  });

  test("a 'shall I keep going?' question does not end the turn", async () => {
    const state = await fixture("chat");
    try {
      const result = await state.run("抛物线，设计角度", (round) => {
        if (round === 1) return toolReply("update_plan", { todos: pendingPlan });
        if (round === 2) return { content: "第一步已完成。要继续吗？" };
        if (round === 3) return toolReply("update_plan", { todos: pendingPlan.map((step) => ({ ...step, status: "completed" })) });
        return { content: "All done" };
      });
      expect(result.method).toBe("turn/completed");
      // The permission question bought a continuation rather than the exit.
      expect(state.requests.length).toBeGreaterThan(2);
      expect(JSON.stringify(state.requests[2])).toContain("still has 3 unfinished step(s)");
    } finally {
      state.stop();
    }
  });

  test("chat: a tool-calls round that parsed no call is repaired, not ended", async () => {
    const state = await fixture("chat");
    try {
      await state.run("抛物线，设计角度", (round) => round === 1
        ? { content: "我将读取项目。", finishReason: "tool_calls" }
        : { content: "抛物线设计完成，无需修改。" });
      // Steered immediately instead of ending on the narration.
      expect(JSON.stringify(state.requests[1])).toContain("no call reached the workspace");
    } finally {
      state.stop();
    }
  });

  test("a hard input budget is not bypassed by evasion correction", async () => {
    const state = await fixture("chat", "danger-full-access", 4000);
    try {
      const result = await state.run(`抛物线，设计角度\n${"背景材料".repeat(5000)}`, () => ({ content: evasion }));
      expect(result.method).toBe("turn/completed");
      expect(state.requests).toHaveLength(1);
      expect(JSON.stringify(state.requests[0])).toContain(MINI_BUDGET_WRAP_UP_NOTE);
      expect(JSON.stringify(state.requests[0])).not.toContain("ACTIVE USER TASK is already a requirement");
    } finally {
      state.stop();
    }
  });
});
