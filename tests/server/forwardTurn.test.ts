import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import {
  extractForwardItemText,
  extractLastAssistantText,
  runForwardTurn,
  type ForwardBridge,
  type ForwardNotification,
} from "../../apps/server/src/forwardTurn.ts";
import type { ForwardRoute } from "../../apps/server/src/forwardModel.ts";

const ROUTE: ForwardRoute = {
  cliBackend: "codex",
  providerId: "deepkey",
  groupId: "default",
  model: "gpt-5.6-luna",
};

class FakeBridge extends EventEmitter implements ForwardBridge {
  deleted: string[] = [];
  interrupted: string[] = [];
  constructor(private readonly script: (bridge: FakeBridge) => void) {
    super();
  }
  async request(method: string, params?: any): Promise<any> {
    if (method === "thread/start") return { threadId: "thr-1" };
    if (method === "turn/start") {
      const turnId = "turn-9";
      queueMicrotask(() => this.script(this));
      return { turnId };
    }
    if (method === "thread/delete") {
      this.deleted.push(params?.threadId);
      return { ok: true };
    }
    if (method === "turn/interrupt") {
      this.interrupted.push(params?.turnId);
      return { ok: true };
    }
    if (method === "thread/read") return { messages: [] };
    throw new Error(`unexpected ${method}`);
  }
  notify(notif: ForwardNotification): void {
    this.emit("notification", notif);
  }
}

const BASE = { route: ROUTE, prompt: "hi", cwd: process.cwd() };

describe("runForwardTurn", () => {
  test("成功收集 assistant 文本并删 thread", async () => {
    const bridge = new FakeBridge((b) => {
      b.notify({ method: "item/completed", params: { threadId: "thr-1", turnId: "turn-9", item: { id: "m1", type: "agentMessage", role: "assistant", status: "completed", text: "hello " } } });
      b.notify({ method: "item/completed", params: { threadId: "thr-1", turnId: "turn-9", item: { id: "m2", type: "agentMessage", role: "assistant", status: "completed", text: "world" } } });
      // user/tool 项必须被过滤。
      b.notify({ method: "item/completed", params: { threadId: "thr-1", turnId: "turn-9", item: { id: "t1", type: "toolResult", role: "tool", text: "SECRET-JSON" } } });
      b.notify({ method: "turn/completed", params: { threadId: "thr-1", turnId: "turn-9" } });
    });
    const res = await runForwardTurn(bridge, BASE);
    expect(res.finishReason).toBe("stop");
    expect(res.text).toBe("hello world");
    expect(res.turnId).toBe("turn-9");
    expect(bridge.deleted).toEqual(["thr-1"]);
  });

  test("turn/failed 透出错误", async () => {
    const bridge = new FakeBridge((b) => {
      b.notify({ method: "turn/failed", params: { threadId: "thr-1", turnId: "turn-9", error: "401 boom" } });
    });
    const res = await runForwardTurn(bridge, BASE);
    expect(res.finishReason).toBe("error");
    expect(res.error).toContain("401 boom");
    expect(bridge.deleted).toEqual(["thr-1"]);
  });

  test("其它 thread 的事件被忽略", async () => {
    const bridge = new FakeBridge((b) => {
      b.notify({ method: "item/completed", params: { threadId: "other", turnId: "turn-x", item: { id: "m", type: "agentMessage", text: "NOISE" } } });
      b.notify({ method: "turn/completed", params: { threadId: "thr-1", turnId: "turn-9" } });
    });
    const res = await runForwardTurn(bridge, BASE);
    expect(res.text).toBe("");
    expect(res.finishReason).toBe("stop");
  });

  test("超时 interrupt 并清理", async () => {
    const bridge = new FakeBridge(() => undefined);
    const res = await runForwardTurn(bridge, { ...BASE, timeoutMs: 120 });
    expect(res.finishReason).toBe("timeout");
    expect(res.error).toContain("超时");
    expect(bridge.interrupted).toEqual(["turn-9"]);
    expect(bridge.deleted).toEqual(["thr-1"]);
  });

  test("空 prompt 直接抛错", async () => {
    const bridge = new FakeBridge(() => undefined);
    await expect(runForwardTurn(bridge, { ...BASE, prompt: "  " })).rejects.toThrow("prompt 为空");
  });
});

describe("文本提取启发式", () => {
  test("跳过 tool/reasoning/delta 类项", () => {
    expect(extractForwardItemText({ type: "toolCall", text: "x" })).toBe("");
    expect(extractForwardItemText({ kind: "reasoning", text: "x" })).toBe("");
    expect(extractForwardItemText({ type: "agentMessage", text: "ok" })).toBe("ok");
    expect(extractForwardItemText({ type: "agentMessage", content: [{ type: "text", text: "a" }] })).toBe("a");
  });

  test("extractLastAssistantText 取最后一段", () => {
    const read = { messages: [{ role: "user", text: "q" }, { role: "assistant", text: "first" }, { role: "assistant", text: "last" }] };
    expect(extractLastAssistantText(read)).toBe("last");
  });
});
