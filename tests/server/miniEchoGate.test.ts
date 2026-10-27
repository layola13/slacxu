import { afterEach, describe, expect, test } from "bun:test";
import {
  MINI_ECHO_MATERIALIZE_CHARS,
  MINI_ECHO_PRIOR_WINDOW,
  MINI_ECHO_SELF_OVERLAP,
  MINI_ECHO_USER_OVERLAP,
  MINI_HISTORY_ECHO_MAX_CHARS,
  MiniBridge,
  miniEchoVerdict,
  miniHistoryLinesFromMessages,
  miniTextOverlap,
} from "../../backends/mini/src/runtime/miniBridge.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function sseResponse(frames: string[]): Response {
  return new Response(frames.map((f) => `data: ${f}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function textFrame(text: string): string {
  return JSON.stringify({ choices: [{ delta: { content: text } }] });
}

function toolFrame(id: string, name: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }],
  });
}

const DONE = "[DONE]";

function bridge(): MiniBridge {
  return new MiniBridge({
    resolveRelayTarget: async () => ({
      baseUrl: "https://relay.example/v1",
      apiKey: "k",
      protocol: "chat" as const,
      streamMaxRetries: 5,
    }),
    onSnapshot: () => {},
  });
}

/**
 * Drives one turn against a scripted upstream. `script(round)` returns the SSE
 * frames for that round; the request bodies are captured so tests can assert on
 * what the model was actually shown.
 */
async function runScriptedTurn(
  b: MiniBridge,
  prompt: string,
  threadId: string,
  script: (round: number) => string[],
): Promise<{ method: string; requests: Array<{ messages: Array<{ role: string; content: unknown }> }> }> {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  globalThis.fetch = (async (_url: unknown, init: { body?: string } = {}) => {
    requests.push(JSON.parse(String(init.body ?? "{}")) as { messages: Array<{ role: string; content: unknown }> });
    return sseResponse(script(requests.length));
  }) as unknown as typeof fetch;
  const method = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for turn terminal event")), 15_000);
    const handler = (n: { method: string; params: Record<string, unknown> }) => {
      if (n.method === "turn/completed" || n.method === "turn/failed") {
        clearTimeout(timer);
        b.off("notification", handler);
        resolve(n.method);
      }
    };
    b.on("notification", handler);
    void b.request("turn/start", { threadId, prompt, providerId: "p", groupId: "g", model: "test-model" });
  });
  return { method, requests };
}

const EchoFixtures = {
  prompt: "深度评估这个项目的 miniBridge.ts",
  // A pure restatement of the prompt plus filler: 60% of its own tokens come
  // from the prompt, so the gate must reject it.
  preamble: "深度评估这个项目的 miniBridge.ts，先看看整体结构。",
  toolArgs: { action: "count_lines", path: "backends/mini/src/runtime/miniBridge.ts" },
  // A short answer that shares almost nothing with the prompt: always kept,
  // whether it lands on a tool round or on the closing round.
  answer: "该文件 5290 行，核心是 turn 循环与工具派发。",
};

/** Round 1: filler preamble + one sa_vm call. Every later round: `answer`. */
const toolThenAnswer = (answer: string) => (round: number): string[] =>
  round === 1
    ? [textFrame(EchoFixtures.preamble), toolFrame("call-1", "sa_vm", EchoFixtures.toolArgs), DONE]
    : [textFrame(answer), DONE];

async function startThread(b: MiniBridge): Promise<string> {
  const started = (await b.request("thread/start", { cwd: process.cwd(), model: "test-model", providerId: "p", groupId: "g" })) as unknown as {
    thread: { id: string };
  };
  return started.thread.id;
}

function storedMessages(b: MiniBridge, threadId: string): Array<Record<string, any>> {
  const sessions = (b as unknown as { sessions: Map<string, { messages: Array<Record<string, any>> }> }).sessions;
  return sessions.get(threadId)?.messages ?? [];
}

describe("miniTextOverlap", () => {
  test("is asymmetric: a short restatement of a long prompt scores high", () => {
    const long = "请先列出根目录的全部文件，然后读取 package.json，用中文总结这个 monorepo 的结构，最后指出三个可以改进的地方";
    const short = "好的，我先列出根目录的文件。";
    expect(miniTextOverlap(short, long)).toBeGreaterThan(MINI_ECHO_USER_OVERLAP);
  });

  test("a long answer that merely shares the topic scores low", () => {
    const prompt = "读取 package.json 并总结项目结构";
    const answer = `${"这个仓库是一个 Bun + TypeScript 的 monorepo，包含 apps/server、apps/web、packages/shared 三个主要工作区。".repeat(2)}`;
    expect(miniTextOverlap(answer, prompt)).toBeLessThan(MINI_ECHO_USER_OVERLAP);
  });

  test("CJK restatements score through characters and bigrams, not exact words", () => {
    // "调用链梳理完成" vs "梳理调用链": no shared standalone word, and "调用"
    // is a bigram rather than a token, yet the two still score high enough to
    // be treated as the same sentence.
    expect(miniTextOverlap("调用链梳理完成", "梳理调用链")).toBeGreaterThan(MINI_ECHO_USER_OVERLAP);
  });

  test("latin scoring ignores very short words to stay noise-free", () => {
    // Every word here is <= 2 chars, so nothing is tokenized at all.
    expect(miniTextOverlap("of it is a", "of it is a")).toBe(0);
    // A 3-char word is a real token.
    expect(miniTextOverlap("the plan", "the plan")).toBe(1);
    expect(miniTextOverlap("", "anything")).toBe(0);
    expect(miniTextOverlap("anything", "")).toBe(0);
  });
});

describe("miniEchoVerdict", () => {
  test("empty text is always dropped", () => {
    expect(miniEchoVerdict("")).toEqual({ drop: true, overlap: 1, reason: "empty" });
    expect(miniEchoVerdict("   \n ").reason).toBe("empty");
  });

  test("text at or beyond the materialize length is never dropped", () => {
    const long = "a".repeat(MINI_ECHO_MATERIALIZE_CHARS);
    expect(long.length).toBe(MINI_ECHO_MATERIALIZE_CHARS);
    expect(miniEchoVerdict(long, { userText: long }).reason).toBe("long");
    expect(miniEchoVerdict("a".repeat(MINI_ECHO_MATERIALIZE_CHARS + 1)).reason).toBe("long");
  });

  test("a restatement of the user prompt is dropped as user-echo", () => {
    const verdict = miniEchoVerdict(EchoFixtures.preamble, { userText: EchoFixtures.prompt });
    expect(verdict.drop).toBe(true);
    expect(verdict.reason).toBe("user-echo");
    expect(verdict.overlap).toBeGreaterThanOrEqual(MINI_ECHO_USER_OVERLAP);
  });

  test("a restatement of text the model already showed is dropped as self-echo", () => {
    const shown = "第一步先确认 relay 的 baseUrl 与 apiKey 是否按分组解析。";
    const verdict = miniEchoVerdict("先确认 relay 的 baseUrl 和 apiKey。", { priorText: shown });
    expect(verdict.drop).toBe(true);
    expect(verdict.reason).toBe("self-echo");
    expect(verdict.overlap).toBeGreaterThanOrEqual(MINI_ECHO_SELF_OVERLAP);
  });

  test("user-echo is checked before self-echo, and real work survives both", () => {
    const answer = miniEchoVerdict(EchoFixtures.answer, { userText: EchoFixtures.prompt });
    expect(answer.drop).toBe(false);
    expect(answer.reason).toBe("work");
  });

  test("the prior window bounds how much shown text is compared", () => {
    expect(MINI_ECHO_PRIOR_WINDOW).toBeGreaterThan(0);
    // With no prior text at all the self-echo check cannot fire.
    expect(miniEchoVerdict("任意一句话", {}).reason).toBe("work");
  });
});

describe("miniHistoryLinesFromMessages", () => {
  const user = (turnId: string, text: string): Record<string, unknown> => ({ type: "userMessage", turnId, text, status: "completed" });
  const agent = (turnId: string, text: string): Record<string, unknown> => ({ type: "agentMessage", turnId, text, status: "completed" });
  const tool = (turnId: string, name: string): Record<string, unknown> => ({ type: "toolCall", turnId, name, arguments: "{}", output: "ok", status: "completed" });
  const plan = (turnId: string): Record<string, unknown> => ({ type: "plan", turnId, plan: [{ step: "读文件", status: "pending" }], status: "in_progress" });

  test("keeps the user's turns, tool calls and plans", () => {
    const lines = miniHistoryLinesFromMessages(
      [user("t1", EchoFixtures.prompt), tool("t1", "sa_vm"), plan("t1"), agent("t1", EchoFixtures.answer)],
      "t2",
    );
    expect(lines.some((l) => l.startsWith("user: "))).toBe(true);
    expect(lines.some((l) => l.startsWith("tool sa_vm"))).toBe(true);
    expect(lines.some((l) => l.startsWith("task plan:"))).toBe(true);
    expect(lines.some((l) => l.includes("5290"))).toBe(true);
  });

  test("drops an assistant line that only restates that turn's user prompt", () => {
    const lines = miniHistoryLinesFromMessages(
      [user("t1", EchoFixtures.prompt), agent("t1", EchoFixtures.preamble), agent("t1", EchoFixtures.answer)],
      "t2",
    );
    expect(lines.some((l) => l.includes("先看看整体结构"))).toBe(false);
    expect(lines.some((l) => l.includes("5290"))).toBe(true);
  });

  test("drops a self-echo but keeps the first statement of a turn", () => {
    const first = "第一步先确认 relay 的 baseUrl 与 apiKey 是否按分组解析。";
    const lines = miniHistoryLinesFromMessages(
      [user("t1", "检查 relay 配置"), agent("t1", first), agent("t1", "先确认 relay 的 baseUrl 和 apiKey。"), agent("t1", "结论：分组解析正确。")],
      "t2",
    );
    expect(lines.filter((l) => l.includes("baseUrl")).length).toBe(1);
    expect(lines.some((l) => l.includes("结论：分组解析正确。"))).toBe(true);
  });

  test("never drops a long assistant line, however much it overlaps", () => {
    const long = `${EchoFixtures.prompt} ${"补充说明。".repeat(60)}`;
    expect(long.length).toBeGreaterThan(MINI_HISTORY_ECHO_MAX_CHARS);
    const lines = miniHistoryLinesFromMessages([user("t1", EchoFixtures.prompt), agent("t1", long)], "t2");
    expect(lines.some((l) => l.includes("补充说明。"))).toBe(true);
  });

  test("the current turn is excluded so a turn never sees its own live text", () => {
    const lines = miniHistoryLinesFromMessages(
      [user("t1", "旧问题"), agent("t1", "旧答案"), user("t2", EchoFixtures.prompt), agent("t2", EchoFixtures.preamble)],
      "t2",
    );
    expect(lines.some((l) => l.includes("旧答案"))).toBe(true);
    expect(lines.some((l) => l.includes("先看看整体结构"))).toBe(false);
  });

  test("error notices and blank lines stay excluded", () => {
    const lines = miniHistoryLinesFromMessages(
      [
        { type: "error", turnId: "t1", text: "chat 429" },
        { type: "retryError", turnId: "t1", text: "retrying" },
        agent("t1", "   "),
        agent("t1", "有效结论"),
      ],
      "t2",
    );
    expect(lines).toEqual(["assistant: 有效结论"]);
  });
});

describe("mini echo gate inside a turn", () => {
  test("a filler preamble before a tool call is never shown, stored or replayed", async () => {
    const b = bridge();
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    b.on("notification", (n: { method: string; params: Record<string, unknown> }) => notifications.push(n));
    const threadId = await startThread(b);
    const { method, requests } = await runScriptedTurn(b, EchoFixtures.prompt, threadId, toolThenAnswer(EchoFixtures.answer));

    expect(method).toBe("turn/completed");
    expect(requests).toHaveLength(2);

    // Nothing user-visible: the dropped preamble produces no item id at all,
    // and the only surviving agentMessage is the closing answer.
    const agentItems = notifications
      .map((n) => (n.params as { item?: Record<string, unknown> }).item)
      .filter((item) => item?.type === "agentMessage");
    expect(new Set(agentItems.map((item) => String(item?.id))).size).toBe(1);
    expect(String(agentItems[0]?.text)).toBe(EchoFixtures.answer);
    expect(notifications.some((n) => n.method === "item/agentMessage/delta" && String((n.params as { delta?: string }).delta).includes("先看看整体结构"))).toBe(false);

    // Not persisted either, so the waterfall and later turns stay clean.
    const stored = storedMessages(b, threadId);
    const storedAgents = stored.filter((m) => m.type === "agentMessage");
    expect(storedAgents.length).toBe(1);
    expect(String(storedAgents[0]?.text)).toBe(EchoFixtures.answer);
    expect(stored.some((m) => JSON.stringify(m).includes("先看看整体结构"))).toBe(false);

    // And the tool call itself survives: only the chatter was suppressed.
    const toolCalls = stored.filter((m) => m.type === "toolCall");
    expect(toolCalls.length).toBe(1);
    expect(String(toolCalls[0]?.name)).toBe("sa_vm");
    expect(String(toolCalls[0]?.output)).toContain("backends/mini/src/runtime/miniBridge.ts");

    // The replayed thread the model saw in round 2 must not contain the echo,
    // but must still carry the tool result the answer is based on.
    const replay = JSON.stringify(requests[1]?.messages ?? []);
    expect(replay).not.toContain("先看看整体结构");
    expect(replay).toContain("backends/mini/src/runtime/miniBridge.ts");
  });

  test("the closing answer is never gated, even when it reuses the prompt wording", async () => {
    const b = bridge();
    const echoedAnswer = "深度评估这个项目的 miniBridge.ts：5290 行，核心是 turn 循环。";
    const threadId = await startThread(b);
    const { method } = await runScriptedTurn(b, EchoFixtures.prompt, threadId, toolThenAnswer(echoedAnswer));
    expect(method).toBe("turn/completed");
    const storedAgents = storedMessages(b, threadId).filter((m) => m.type === "agentMessage");
    expect(storedAgents.length).toBe(1);
    expect(String(storedAgents[0]?.text)).toBe(echoedAnswer);
  });

  test("a direct answer with no tool work is never gated", async () => {
    const b = bridge();
    const greeting = "你好，我是 Mini，有什么可以帮你的？";
    const threadId = await startThread(b);
    const { method, requests } = await runScriptedTurn(b, "你好", threadId, () => [textFrame(greeting), DONE]);
    expect(method).toBe("turn/completed");
    expect(requests).toHaveLength(1);
    const storedAgents = storedMessages(b, threadId).filter((m) => m.type === "agentMessage");
    expect(storedAgents.length).toBe(1);
    expect(String(storedAgents[0]?.text)).toBe(greeting);
  });

  test("a tool round's text is suppressed so only the single final answer persists", async () => {
    const b = bridge();
    const useful = "根因在 App.tsx 的 workspaceSelectionPending 守卫。";
    const threadId = await startThread(b);
    const { method } = await runScriptedTurn(b, "定位新建对话反复弹框的调用链", threadId, (round) =>
      round === 1
        ? [textFrame(useful), toolFrame("call-1", "sa_vm", EchoFixtures.toolArgs), DONE]
        : [textFrame(EchoFixtures.answer), DONE],
    );
    expect(method).toBe("turn/completed");
    const storedAgents = storedMessages(b, threadId).filter((m) => m.type === "agentMessage");
    // Single-final-answer (MINI_SILENT_EXEC_RULE): intermediate tool-round text
    // must not become a completed answer, otherwise one question renders as
    // s1/s2/s3 duplicates (bfedc0e4).
    expect(storedAgents.map((m) => String(m.text))).toEqual([EchoFixtures.answer]);
  });

  test("long premature answers on tool rounds are suppressed (bfedc0e4 regression)", async () => {
    const b = bridge();
    // Each >260 chars so the old long=>never-drop gate would have kept all 3.
    const premature1 = `${"我先把 GPT-6 Luna 与 Haiku 对比结论说明如下，包含价格与基准细节，供最终回答参考。".repeat(8)}`;
    const premature2 = `${"按前文重述一版完整对比表格，同样包含全部模型与价格细节，等待工具结果后终答。".repeat(8)}`;
    const finalAnswer = `${"最终结论：按标准价与实测基准综合判断，给出单一终答版本。".repeat(10)}`;
    expect(premature1.length).toBeGreaterThan(260);
    expect(premature2.length).toBeGreaterThan(260);
    const threadId = await startThread(b);
    const { method, requests } = await runScriptedTurn(b, "对比gpt-6-luan vs claude haiku 5.5 vs deepseek flash", threadId, (round) => {
      if (round === 1) return [textFrame(premature1), toolFrame("call-1", "sa_vm", EchoFixtures.toolArgs), DONE];
      if (round === 2) return [textFrame(premature2), toolFrame("call-2", "sa_vm", EchoFixtures.toolArgs), DONE];
      return [textFrame(finalAnswer), DONE];
    });
    expect(method).toBe("turn/completed");
    const storedAgents = storedMessages(b, threadId).filter((m) => m.type === "agentMessage");
    expect(storedAgents.length).toBe(1);
    expect(String(storedAgents[0]?.text)).toBe(finalAnswer);
    const stored = storedMessages(b, threadId);
    expect(stored.some((m) => JSON.stringify(m).includes(premature1.slice(0, 40)))).toBe(false);
    expect(stored.some((m) => JSON.stringify(m).includes(premature2.slice(0, 40)))).toBe(false);
    // Both tool calls still executed: only the chatter was suppressed.
    expect(stored.filter((m) => m.type === "toolCall").length).toBe(2);
    // Model-visible replay must not carry the suppressed interim answers either,
    // otherwise the next round sees its own prior answer and re-answers in full.
    expect(requests.length).toBe(3);
    expect(JSON.stringify(requests[1]?.messages ?? [])).not.toContain(premature1.slice(0, 40));
    expect(JSON.stringify(requests[2]?.messages ?? [])).not.toContain(premature2.slice(0, 40));
  });
});
