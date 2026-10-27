import { describe, expect, test } from "bun:test";
import {
  MINI_BUDGET_WRAP_UP_NOTE,
  MINI_HISTORY_BUDGET_MAX_CHARS,
  MINI_HISTORY_BUDGET_RATIO,
  MINI_HISTORY_MAX_CHARS,
  MINI_ROUND_CAP_NOTE,
  EMPTY_MINI_RESPONSES_CHAIN,
  advanceResponsesChain,
  buildMiniHistoryPayload,
  estimateMiniTokens,
  historyItemToText,
  isMiniResponsesChainingTrusted,
  miniHistoryBudgetChars,
  miniHistoryLinesFromMessages,
  miniOverTurnBudget,
  miniTurnCapTripped,
  miniTurnInputBudgetTokens,
  resolveMiniTurnLimits,
  resolveResponsesRoundInput,
  shrinkMiniThreadOutputs,
  splitHistoryForSummary,
  type MiniResponsesChain,
} from "../../backends/mini/src/runtime/miniBridge.js";
import { countMiniTokens, heuristicMiniTokens } from "../../backends/mini/src/runtime/miniTokenizer.js";

describe("estimateMiniTokens", () => {
  test("counts exact o200k tokens for latin", () => {
    expect(estimateMiniTokens("")).toBe(0);
    expect(estimateMiniTokens("abcd")).toBe(1);
    expect(estimateMiniTokens("hello world")).toBe(2);
    // Exact BPE merges repeats: 400 x "a" is 50 tokens, not 100.
    expect(estimateMiniTokens("a".repeat(400))).toBe(50);
  });

  test("counts CJK with the real encoder instead of /4", () => {
    // o200k merges common hanzi pairs: 你好世界 is 2 tokens (was 1 under /4).
    expect(estimateMiniTokens("你好世界")).toBe(2);
    expect(countMiniTokens("中文会话".repeat(100))).toBeGreaterThan(0);
    expect(countMiniTokens("中文会话".repeat(100))).toBeLessThan(400);
  });

  test("heuristic fallback stays CJK-aware when the encoder cannot load", () => {
    expect(heuristicMiniTokens("abcd")).toBe(1);
    expect(heuristicMiniTokens("你好世界")).toBe(5);
    expect(heuristicMiniTokens(`${"a".repeat(400)}${"中".repeat(10)}`)).toBe(112);
  });

  test("still blanks data URLs before measuring", () => {
    const withImage = `see this data:image/png;base64,${"A".repeat(4000)} done`;
    expect(estimateMiniTokens(withImage)).toBeLessThan(20);
  });
});

describe("miniOverTurnBudget", () => {
  test("flags over/under budget like the guard needs", () => {
    expect(miniOverTurnBudget("a".repeat(400), 50)).toBe(true);
    expect(miniOverTurnBudget("a".repeat(400), 200)).toBe(false);
    expect(miniOverTurnBudget("", 100)).toBe(false);
  });

  test("stays non-blocking on turn-sized payloads (freeze regression)", () => {
    // Exact o200k encoding costs ~65s for 20k chars under bun and runs on the
    // server event loop: the old per-round guard froze all sessions. The
    // heuristic guard must stay in the millisecond range even at 100k chars.
    const payload = JSON.stringify({ thread: "x".repeat(100000) });
    const startedAt = Date.now();
    const over = miniOverTurnBudget(payload, 10000);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(over).toBe(true);
    expect(miniOverTurnBudget(payload, 100000)).toBe(false);
  });
});

describe("buildMiniHistoryPayload", () => {
  const lines = ["[user] 你好", "[assistant] ok"];

  test("chat sends history only via the system block", () => {
    const { historyBlock, recapText } = buildMiniHistoryPayload(lines, "chat");
    expect(recapText).toBeNull();
    expect(historyBlock).toContain("[user] 你好");
    // Anti-anchoring: history is background context, the live prompt is the current task.
    expect(historyBlock).toContain("background context");
    expect(historyBlock).toContain("the latest user message below is the current task");
    expect(historyBlock).not.toContain("MUST respect");
  });

  test("responses keeps the explicit recap input", () => {
    const { historyBlock, recapText } = buildMiniHistoryPayload(lines, "responses");
    expect(historyBlock).toContain("[assistant] ok");
    expect(recapText).toContain("[earlier conversation");
    expect(recapText).toContain("background context only");
    expect(recapText).toContain("[user] 你好");
  });

  test("empty history sends nothing on either protocol", () => {
    for (const protocol of ["chat", "responses"] as const) {
      expect(buildMiniHistoryPayload([], protocol)).toEqual({ historyBlock: "", recapText: null });
    }
  });

  test("history text is capped", () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line-${i}-0123456789`);
    const chat = buildMiniHistoryPayload(big, "chat");
    const responses = buildMiniHistoryPayload(big, "responses");
    // Slack covers the fixed supremacy framing only; the history body itself stays capped.
    expect(chat.historyBlock.length).toBeLessThanOrEqual(MINI_HISTORY_MAX_CHARS + 500);
    expect(responses.recapText?.length).toBeLessThanOrEqual(MINI_HISTORY_MAX_CHARS + 200);
    expect(chat.historyBlock).toContain("line-0-");
  });

  test("keeps task-defining head plus recent tail when over budget", () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line-${i}-0123456789`);
    const { historyBlock } = buildMiniHistoryPayload(big, "chat");
    expect(historyBlock).toContain("line-0-");
    expect(historyBlock).toContain("line-4999-");
    expect(historyBlock).toContain("middle history omitted");
  });

  test("short history passes through untouched", () => {
    const { historyBlock } = buildMiniHistoryPayload(["a", "b"], "chat");
    expect(historyBlock).toContain("a\nb");
  });

  test("custom maxChars widens the cap for large windows", () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line-${i}-0123456789`);
    const wide = buildMiniHistoryPayload(big, "chat", 200_000);
    expect(wide.historyBlock.length).toBeGreaterThan(MINI_HISTORY_MAX_CHARS);
    expect(wide.historyBlock.length).toBeLessThanOrEqual(200_000 + 200);
  });
});

describe("miniHistoryBudgetChars", () => {
  test("floors at the historical cap for small windows", () => {
    expect(miniHistoryBudgetChars(0)).toBe(128_000);
    expect(miniHistoryBudgetChars(NaN)).toBe(128_000);
    expect(miniHistoryBudgetChars(16_000)).toBe(MINI_HISTORY_MAX_CHARS);
    expect(miniHistoryBudgetChars(32_000)).toBe(32_000);
  });

  test("scales with the window at the budget ratio", () => {
    expect(miniHistoryBudgetChars(128_000)).toBe(Math.floor(128_000 * MINI_HISTORY_BUDGET_RATIO * 4));
    expect(miniHistoryBudgetChars(1_000_000)).toBe(MINI_HISTORY_BUDGET_MAX_CHARS);
  });
});

describe("budget-gated history truncation", () => {
  const big = "x".repeat(5000);

  test("historyItemToText keeps the legacy 800-char cut by default", () => {
    const line = historyItemToText({ type: "toolCall", name: "sa_vm", arguments: "{}", output: big, status: "completed" });
    expect(line.length).toBeLessThanOrEqual("tool sa_vm {} => ".length + 800);
    expect(line).toContain("x".repeat(100));
  });

  test("historyItemToText sends full content when the budget allows (cap 0)", () => {
    const line = historyItemToText({ type: "toolCall", name: "sa_vm", arguments: "{}", output: big, status: "completed" }, 0);
    expect(line).toContain(big);
    const userLine = historyItemToText({ type: "userMessage", text: big, status: "completed" }, 0);
    expect(userLine).toContain(big);
  });

  test("miniHistoryLinesFromMessages preserves long outputs in full mode", () => {
    const msgs: any[] = [{ type: "toolCall", turnId: "t1", name: "sa_vm", arguments: "{}", output: big, status: "completed" }];
    const full = miniHistoryLinesFromMessages(msgs, "t2", 0);
    expect(full.some((l) => l.includes(big))).toBe(true);
    const cut = miniHistoryLinesFromMessages(msgs, "t2");
    expect(cut.every((l) => !l.includes(big))).toBe(true);
  });
});

describe("splitHistoryForSummary", () => {
  test("short history has no older part", () => {
    const { older, tail } = splitHistoryForSummary(["a", "b"]);
    expect(older).toEqual([]);
    expect(tail).toEqual(["a", "b"]);
  });

  test("long history keeps newest tail raw and older for summary", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line-${i}-${"x".repeat(100)}`);
    const { older, tail } = splitHistoryForSummary(lines);
    expect(older.length).toBeGreaterThan(0);
    expect(tail.length).toBeGreaterThan(0);
    expect(older[0]).toBe(lines[0]);
    expect(tail[tail.length - 1]).toBe(lines[lines.length - 1]);
    // No overlap, no gap.
    expect(older.length + tail.length).toBe(lines.length);
  });

  test("single oversized line still goes to tail", () => {
    const { older, tail } = splitHistoryForSummary([`only-${"y".repeat(20000)}`]);
    expect(tail).toHaveLength(1);
    expect(older).toEqual([]);
  });
});

describe("miniTurnInputBudgetTokens", () => {
  test("takes 70% of the window", () => {
    expect(miniTurnInputBudgetTokens(128_000)).toBe(89_600);
    expect(miniTurnInputBudgetTokens(200_000)).toBe(140_000);
  });

  test("falls back and floors sanely", () => {
    expect(miniTurnInputBudgetTokens(0)).toBe(89_600);
    expect(miniTurnInputBudgetTokens(NaN)).toBe(89_600);
    expect(miniTurnInputBudgetTokens(1_000)).toBe(4_000);
  });

  test("wrap-up note forbids further calls", () => {
    expect(MINI_BUDGET_WRAP_UP_NOTE).toContain("no additional tool calls");
    expect(MINI_BUDGET_WRAP_UP_NOTE).toContain("this turn ends here");
  });

  test("round-cap note forbids further calls", () => {
    expect(MINI_ROUND_CAP_NOTE).toContain("no additional tool calls");
  });
});

describe("resolveMiniTurnLimits", () => {
  const OLD_ENV = { ...process.env };

  test("defaults to 40 rounds / 120 calls", () => {
    delete process.env.MINI_TURN_MAX_ROUNDS;
    delete process.env.MINI_TURN_MAX_TOOL_CALLS;
    expect(resolveMiniTurnLimits()).toEqual({ maxRounds: 40, maxCalls: 120 });
    process.env = { ...OLD_ENV };
  });

  test("positive env values override caps; zero and negative preserve finite defaults", () => {
    process.env.MINI_TURN_MAX_ROUNDS = "10";
    process.env.MINI_TURN_MAX_TOOL_CALLS = "0";
    try {
      const limits = resolveMiniTurnLimits();
      expect(limits.maxRounds).toBe(10);
      expect(limits.maxCalls).toBe(120);
      expect(miniTurnCapTripped(10, 0, limits)).toBe(true);
      expect(miniTurnCapTripped(9, 119, limits)).toBe(false);
      expect(miniTurnCapTripped(9, 120, limits)).toBe(true);
      process.env.MINI_TURN_MAX_ROUNDS = "-1";
      expect(resolveMiniTurnLimits().maxRounds).toBe(40);
    } finally {
      process.env = { ...OLD_ENV };
    }
  });

  test("trips on rounds or calls", () => {
    const limits = { maxRounds: 40, maxCalls: 120 };
    expect(miniTurnCapTripped(39, 119, limits)).toBe(false);
    expect(miniTurnCapTripped(40, 0, limits)).toBe(true);
    expect(miniTurnCapTripped(1, 120, limits)).toBe(true);
  });
});

describe("isMiniResponsesChainingTrusted", () => {
  test("OpenAI models behind relays get full sends; official OpenAI chains", () => {
    expect(isMiniResponsesChainingTrusted("https://starhubapi.example/v1", "gpt-6.1-sol", {})).toBe(false);
    expect(isMiniResponsesChainingTrusted("http://127.0.0.1:43110/api/relay-gateway/starhubapi/g/v1", "openai/gpt-5.6-luna", {})).toBe(false);
    expect(isMiniResponsesChainingTrusted("https://relay.example/v1", "o3-mini", {})).toBe(false);
    expect(isMiniResponsesChainingTrusted("https://api.openai.com/v1", "gpt-6.1-sol", {})).toBe(true);
  });
  test("non-OpenAI models keep chaining", () => {
    for (const model of ["claude-sonnet-4.5", "deepseek-v3", "glm-4.6", "qwen3-coder", "gemini-2.5-pro", "omni-x"]) {
      expect(isMiniResponsesChainingTrusted("https://relay.example/v1", model, {})).toBe(true);
    }
  });
  test("MINI_RESPONSES_CHAINING overrides the default", () => {
    expect(isMiniResponsesChainingTrusted("https://relay.example/v1", "gpt-6.1-sol", { MINI_RESPONSES_CHAINING: "1" })).toBe(true);
    expect(isMiniResponsesChainingTrusted("https://relay.example/v1", "claude-sonnet-4.5", { MINI_RESPONSES_CHAINING: "0" })).toBe(false);
  });
});

describe("resolveResponsesRoundInput", () => {
  const item = (n: number): Record<string, any> => ({ role: "user", content: [{ type: "input_text", text: `m${n}` }] });

  test("first round sends full input without previous_response_id", () => {
    const full = [item(0), item(1)];
    const round = resolveResponsesRoundInput(full, { prevId: null, sentJson: "", sentCount: 0 });
    expect(round.chained).toBe(false);
    expect(round.previousResponseId).toBeNull();
    expect(round.input).toEqual(full);
  });

  test("follow-up round sends only the suffix with previous_response_id", () => {
    const full = [item(0), item(1)];
    const chain = advanceResponsesChain(full, "resp_1");
    const next = [...full, item(2), item(3)];
    const round = resolveResponsesRoundInput(next, chain);
    expect(round.chained).toBe(true);
    expect(round.previousResponseId).toBe("resp_1");
    expect(round.input).toEqual([item(2), item(3)]);
  });

  test("any history rewrite falls back to full input", () => {
    const full = [item(0), item(1)];
    const chain = advanceResponsesChain(full, "resp_1");
    // Purge/sanitize dropped an early item: prefix no longer matches.
    const mutated = [item(1), item(2)];
    const round = resolveResponsesRoundInput(mutated, chain);
    expect(round.chained).toBe(false);
    expect(round.previousResponseId).toBeNull();
    expect(round.input).toEqual(mutated);
  });

  test("missing response id disables chaining", () => {
    const full = [item(0)];
    const chain = advanceResponsesChain(full, null);
    const round = resolveResponsesRoundInput([...full, item(1)], chain);
    expect(round.chained).toBe(false);
  });

  test("relay chain rejection remains in full-input mode for the turn", () => {
    const full = [item(0)];
    const rejectedChain = advanceResponsesChain(full, "resp_rejected");
    expect(resolveResponsesRoundInput([...full, item(1)], rejectedChain).chained).toBe(true);

    const chainingRejected = true;
    const nextChain = chainingRejected
      ? { ...EMPTY_MINI_RESPONSES_CHAIN }
      : advanceResponsesChain([...full, item(1)], "resp_full_retry");
    const nextRound = resolveResponsesRoundInput([...full, item(1), item(2)], nextChain);
    expect(nextRound.chained).toBe(false);
    expect(nextRound.previousResponseId).toBeNull();
    expect(nextRound.input).toEqual([...full, item(1), item(2)]);
  });
});

describe("shrinkMiniThreadOutputs", () => {
  test("keeps the newest outputs intact and truncates older ones", () => {
    const big = "x".repeat(5000);
    const thread: Array<Record<string, any>> = [0, 1, 2, 3].map((i) => ({
      type: "function_call_output",
      call_id: `c${i}`,
      output: `${big}-${i}`,
    }));
    const { shrunk, savedChars } = shrinkMiniThreadOutputs(thread);
    expect(shrunk).toBe(1);
    expect(savedChars).toBeGreaterThan(3000);
    expect(String(thread[0]?.output)).toContain("[output truncated");
    expect(thread[0]?.call_id).toBe("c0");
    for (const i of [1, 2, 3]) expect(String(thread[i]?.output)).toContain(`${big}-${i}`);
  });

  test("handles chat tool messages and drops image parts from old outputs", () => {
    const thread: Array<Record<string, any>> = [
      { role: "tool", tool_call_id: "a", content: "y".repeat(3000) },
      {
        type: "function_call_output",
        call_id: "b",
        output: [
          { type: "input_text", text: "z".repeat(3000) },
          { type: "input_image", image_url: "data:image/png;base64,AAAA" },
        ],
      },
      { role: "tool", tool_call_id: "c", content: "fresh" },
      { role: "tool", tool_call_id: "d", content: "fresh2" },
      { role: "tool", tool_call_id: "e", content: "fresh3" },
    ];
    const { shrunk } = shrinkMiniThreadOutputs(thread);
    expect(shrunk).toBe(2);
    expect(String(thread[0]?.content)).toContain("[output truncated");
    expect(typeof thread[1]?.output).toBe("string");
    expect(String(thread[1]?.output)).not.toContain("base64");
    expect(thread[2]).toEqual({ role: "tool", tool_call_id: "c", content: "fresh" });
  });

  test("never shrinks file-lane write outputs (exact post-edit state)", () => {
    const editArgs = JSON.stringify({ action: "edit_file", path: "src/a.ts", old_text: "x", new_text: "y" });
    const readArgs = JSON.stringify({ action: "read_file", path: "src/b.ts" });
    const big = "q".repeat(5000);
    const thread: Array<Record<string, any>> = [
      { type: "function_call", call_id: "w0", name: "sa_vm", arguments: editArgs },
      { type: "function_call_output", call_id: "w0", output: `edited ok ${"e".repeat(3000)}` },
      { type: "function_call", call_id: "r0", name: "sa_vm", arguments: readArgs },
      { type: "function_call_output", call_id: "r0", output: big },
      { type: "function_call_output", call_id: "r1", output: "fresh1" },
      { type: "function_call_output", call_id: "r2", output: "fresh2" },
      { type: "function_call_output", call_id: "r3", output: "fresh3" },
    ];
    const { shrunk } = shrinkMiniThreadOutputs(thread);
    // Only the old read output is shrunk; the older write output survives intact.
    expect(shrunk).toBe(1);
    expect(String(thread[1]?.output)).not.toContain("[output truncated");
    expect(String(thread[3]?.output)).toContain("[output truncated");
  });

  test.each([
    ["edit_file", { action: "edit_file", path: "src/a.ts", old_text: "x", new_text: "y" }],
    ["write_file", { action: "write_file", path: "src/b.ts", content: "z" }],
    ["apply_patch", { action: "apply_patch", patch: "*** Begin Patch\n*** End Patch" }],
    ["move_file", { action: "move_file", from: "src/a.ts", to: "src/b.ts" }],
  ])("never shrinks file-lane %s outputs", (_name, args) => {
    const big = "W".repeat(5000);
    const thread: Array<Record<string, any>> = [
      { type: "function_call", call_id: "w0", name: "sa_vm", arguments: JSON.stringify(args) },
      { type: "function_call_output", call_id: "w0", output: big },
      { type: "function_call_output", call_id: "r1", output: "fresh1" },
      { type: "function_call_output", call_id: "r2", output: "fresh2" },
      { type: "function_call_output", call_id: "r3", output: "fresh3" },
    ];
    const { shrunk } = shrinkMiniThreadOutputs(thread);
    expect(shrunk).toBe(0);
    expect(String(thread[1]?.output)).toBe(big);
  });

  test("never shrinks exec-lane outputs (run_host/typecheck logs stay shrinkable)", () => {
    const runArgs = JSON.stringify({ action: "run_host", exe: "bun", args: ["run", "typecheck"] });
    const big = "L".repeat(5000);
    const thread: Array<Record<string, any>> = [
      { type: "function_call", call_id: "x0", name: "sa_vm", arguments: runArgs },
      { type: "function_call_output", call_id: "x0", output: big },
      { type: "function_call_output", call_id: "r1", output: "fresh1" },
      { type: "function_call_output", call_id: "r2", output: "fresh2" },
      { type: "function_call_output", call_id: "r3", output: "fresh3" },
    ];
    const { shrunk } = shrinkMiniThreadOutputs(thread);
    expect(shrunk).toBe(1);
    expect(String(thread[1]?.output)).toContain("[output truncated");
  });

  test("truncation keeps head and tail instead of head only", () => {
    const head = `HEAD-${"h".repeat(100)}`;
    const tail = `TAIL-${"t".repeat(100)}`;
    const thread: Array<Record<string, any>> = [
      { type: "function_call_output", call_id: "c0", output: `${head}\n${"m".repeat(5000)}\n${tail}` },
      { type: "function_call_output", call_id: "c1", output: "fresh1" },
      { type: "function_call_output", call_id: "c2", output: "fresh2" },
      { type: "function_call_output", call_id: "c3", output: "fresh3" },
    ];
    shrinkMiniThreadOutputs(thread);
    const out = String(thread[0]?.output);
    expect(out).toContain("[output truncated");
    expect(out).toContain(head);
    expect(out).toContain(tail);
  });

  test("leaves small threads untouched", () => {
    const thread: Array<Record<string, any>> = [
      { role: "tool", tool_call_id: "a", content: "small" },
    ];
    expect(shrinkMiniThreadOutputs(thread)).toEqual({ shrunk: 0, savedChars: 0 });
    expect(thread[0]?.content).toBe("small");
  });

  test("chain type round-trips through empty state", () => {
    const empty: MiniResponsesChain = { prevId: null, sentJson: "", sentCount: 0 };
    expect(empty.sentCount).toBe(0);
  });
});
