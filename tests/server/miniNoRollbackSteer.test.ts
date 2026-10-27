import { afterEach, expect, test } from "bun:test";
import { MiniBridge } from "../../backends/mini/src/runtime/miniBridge.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function sse(frames: unknown[]): Response {
  return new Response(frames.map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

test("technical consultation question completes directly with expert prose answer without workspace-tool steer loop or rollbacks", async () => {
  const model = "test-model";
  const bridge = new MiniBridge({
    resolveRelayTarget: async () => ({ baseUrl: "https://relay.example/v1", apiKey: "test", protocol: "chat", streamMaxRetries: 0 }),
  });
  const started = await bridge.request("thread/start", { cwd: process.cwd(), model, providerId: "p", groupId: "g" }) as { thread: { id: string } };
  const threadId = started.thread.id;

  const expertAnswer = "针对 Q1：wasm b64 dot-pack 方案已经接近理论极限...\n针对 Q2：V8 TurboFan 的 swizzle 序列在寄存器分配上有溢出...\n针对 Q3：bytes->string 快照税是物理极限。";
  let calls = 0;
  const requests: any[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    calls += 1;
    return sse([{ choices: [{ delta: { content: expertAnswer } }] }, "[DONE]"]);
  }) as typeof fetch;

  const notifications: Array<{ method: string; params: any }> = [];
  const terminal = new Promise<string>((resolve) => {
    bridge.on("notification", (event: { method: string; params: any }) => {
      notifications.push(event);
      if (event.method === "turn/completed" || event.method === "turn/failed") resolve(event.method);
    });
  });

  const prompt = "# 致专家：SA vs Bun 性能攻坚 open 问题汇总（v2026-10-12）\n## 0. 背景与口径\n- 目标：SA 编译器三后端对标 Bun 同功能原语\n## Q1. wasm b64 合并\n## Q2. 同一 wasm 模块 V8 比 Cranelift 慢\n## Q3. bytes->string 快照税\n统一要求：请标明每条是实测事实／实现经验／理论判断";

  await bridge.request("turn/start", { threadId, prompt, providerId: "p", groupId: "g", model });
  const method = await terminal;
  expect(method).toBe("turn/completed");

  // Technical consultation is recognized as analysis task: answers in 1 round directly without being forced to run tools
  expect(calls).toBe(1);

  // Verify that NO mini/item/rollback was emitted! The waterfall is NEVER cleared.
  const rollbacks = notifications.filter((n) => n.method === "mini/item/rollback");
  expect(rollbacks).toHaveLength(0);

  // Verify that the turn items preserved the expert answer!
  const read = await bridge.request("thread/read", { threadId, includeTurns: true }) as { items: any[] };
  const agentMessages = read.items.filter((item) => item.type === "agentMessage");
  expect(agentMessages.length).toBeGreaterThan(0);
  const combinedText = agentMessages.map((m) => m.text).join("");
  expect(combinedText).toContain("针对 Q1：wasm b64");
  expect(combinedText).toContain("针对 Q2：V8 TurboFan");
  expect(combinedText).toContain("针对 Q3：bytes->string");
});

test("actionable workspace implementation prompt steers '只说不练' without rolling back live segments", async () => {
  const model = "test-model";
  const bridge = new MiniBridge({
    resolveRelayTarget: async () => ({ baseUrl: "https://relay.example/v1", apiKey: "test", protocol: "chat", streamMaxRetries: 0 }),
  });
  const started = await bridge.request("thread/start", { cwd: process.cwd(), model, providerId: "p", groupId: "g" }) as { thread: { id: string } };
  const threadId = started.thread.id;

  const proseNarration = "我准备在 index.html 增加一个按钮并测试其点击事件。";
  let calls = 0;
  const requests: any[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    calls += 1;
    if (calls === 1) {
      return sse([{ choices: [{ delta: { content: proseNarration } }] }, "[DONE]"]);
    }
    return sse([{ choices: [{ delta: { content: "\n\n经核实无需实际改动，功能已存在。" } }] }, "[DONE]"]);
  }) as typeof fetch;

  const notifications: Array<{ method: string; params: any }> = [];
  const terminal = new Promise<string>((resolve) => {
    bridge.on("notification", (event: { method: string; params: any }) => {
      notifications.push(event);
      if (event.method === "turn/completed" || event.method === "turn/failed") resolve(event.method);
    });
  });

  const prompt = "修改 index.html 增加一个重置按钮并测试";

  await bridge.request("turn/start", { threadId, prompt, providerId: "p", groupId: "g", model });
  const method = await terminal;
  expect(method).toBe("turn/completed");

  // Verify that the steer ("只说不练") actually happened and nudged the model!
  expect(calls).toBeGreaterThanOrEqual(2);
  const subsequentRequests = requests.slice(1);
  const hasSteerNote = subsequentRequests.some((r: any) =>
    (r?.body?.messages ?? []).some((m: any) =>
      String(m.content ?? "").includes("No workspace tool has run in this turn yet") ||
      String(m.content ?? "").includes("For a workspace task") ||
      String(m.content ?? "").includes("multi-step work and no checklist exists yet")
    )
  );
  expect(hasSteerNote).toBe(true);

  // Steer-committed narration is a candidate: it is retired once the final answer lands.
  const rollbacks = notifications.filter((n) => n.method === "mini/item/rollback");
  expect(rollbacks).toHaveLength(1);
  // Both earlier steer-committed narrations are superseded; the final answer stays.
  expect(rollbacks[0].params.itemIds).toHaveLength(2);

  const read = await bridge.request("thread/read", { threadId, includeTurns: true }) as { items: any[] };
  const agentMessages = read.items.filter((item) => item.type === "agentMessage");
  expect(agentMessages.map((m) => m.text.trim())).toEqual(["经核实无需实际改动，功能已存在。"]);
});

test("a long prose answer committed by a steer is not repeated when the model restates it", async () => {
  const model = "test-model";
  const bridge = new MiniBridge({
    resolveRelayTarget: async () => ({ baseUrl: "https://relay.example/v1", apiKey: "test", protocol: "chat", streamMaxRetries: 0 }),
  });
  const started = await bridge.request("thread/start", { cwd: process.cwd(), model, providerId: "p", groupId: "g" }) as { thread: { id: string } };
  const threadId = started.thread.id;

  const answer = "修改计划：在 index.html 中增加一个重置按钮，并绑定点击事件以清空表单。" + "关键步骤包括：定位表单容器、插入按钮节点、编写事件处理函数、验证按钮在不同浏览器下的行为。".repeat(6);
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return sse([{ choices: [{ delta: { content: answer } }] }, "[DONE]"]);
  }) as typeof fetch;

  const notifications: Array<{ method: string; params: any }> = [];
  const terminal = new Promise<string>((resolve) => {
    bridge.on("notification", (event: { method: string; params: any }) => {
      notifications.push(event);
      if (event.method === "turn/completed" || event.method === "turn/failed") resolve(event.method);
    });
  });

  await bridge.request("turn/start", { threadId, prompt: "修改 index.html 增加一个重置按钮并测试", providerId: "p", groupId: "g", model });
  expect(await terminal).toBe("turn/completed");
  expect(calls).toBeGreaterThan(1);

  const read = await bridge.request("thread/read", { threadId, includeTurns: true }) as { items: any[] };
  const agentMessages = read.items.filter((item) => item.type === "agentMessage");
  expect(agentMessages).toHaveLength(1);

  const completed = notifications.filter((e) => e.method === "item/completed" && e.params.item?.type === "agentMessage");
  const rollbackIds = notifications
    .filter((e) => e.method === "mini/item/rollback")
    .flatMap((e) => e.params.itemIds as string[]);
  expect(rollbackIds).toHaveLength(completed.length - 1);
});

