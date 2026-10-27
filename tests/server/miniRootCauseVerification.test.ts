import { describe, expect, it } from "bun:test";
import {
  MINI_EFFICIENCY_RULE,
  MINI_FINAL_BREVITY_RULE,
  MINI_INTERNAL_DIRECTIVE,
  MINI_SILENT_EXEC_RULE,
  MINI_TOOL_ARG_REPLAY_FALLBACK,
  isMiniReadOnlyAction,
  miniInternalDirective,
  miniPendingPlanReminder,
  miniReplayableArgs,
  miniResponsesVerbosityField,
  pushChatToolCall,
  pushResponsesToolCall,
  miniBudgetExcuseCorrection,
  type MiniPlanStep,
} from "../../backends/mini/src/runtime/miniBridge.ts";

const miniBridgeSource = async (): Promise<string> =>
  await Bun.file(new URL("../../backends/mini/src/runtime/miniBridge.ts", import.meta.url)).text();

describe("mini filler-chatter regressions", () => {
  it("codex Preamble instruction still ships, so the Mini override stays required", async () => {
    const mod = await import("../../apps/server/src/codexFallbackInstructions.ts");
    const instructions = mod.CODEX_FALLBACK_INSTRUCTIONS;
    expect(instructions).toContain("Preamble");
    expect(instructions).toContain("Before making tool calls, send a brief preamble");
    expect(instructions).toContain("Keep your tone light, friendly and curious");
  });

  it("Mini configures silent tool execution without conversational preambles", async () => {
    const source = await miniBridgeSource();
    expect(MINI_SILENT_EXEC_RULE).toContain("conversational preambles");
    expect(MINI_SILENT_EXEC_RULE).toContain("Between tool calls, emit no extra text");
    expect(source).toContain("`${MINI_SYSTEM_HEAD}\\n\\n${miniRuntimeInstructions}\\n\\n${MINI_SILENT_EXEC_RULE}");
    expect(source.indexOf("MINI_SILENT_EXEC_RULE")).toBeLessThan(source.indexOf("MINI_PLAN_AWARE_SUMMARY_RULE} ${MINI_PLAN_SYNC_RULE}"));
  });

  it("forbids filler shapes and mandates silent retry and final answer", () => {
    expect(MINI_SILENT_EXEC_RULE).toContain("without conversational preambles");
    expect(MINI_SILENT_EXEC_RULE).toContain("retry silently");
    expect(MINI_SILENT_EXEC_RULE).toContain("final answer");
  });

  it("plan reminder is an internal notice that forbids acknowledging itself", () => {
    const steps: MiniPlanStep[] = [
      { step: "正在梳理新建对话反复弹框的调用链", status: "in_progress" },
      { step: "逐个读关键文件定位根因", status: "pending" },
    ];
    const note = miniPendingPlanReminder(steps);
    expect(note).not.toBeNull();
    expect(note).toContain("The plan checklist still has 2 unfinished step(s)");
    expect(note).toContain("- [ ] 正在梳理新建对话反复弹框的调用链");
    expect(note).toContain("Continue the next useful step now");
    expect(note).toContain("update the checklist");
    expect(note).toContain("if blocked");
    expect(note).toContain("Use the next useful tool when permitted");
    expect(note).toContain("final answer if blocked");
    // Anti-anchoring: a stale plan must never override a fresh user task.
    expect(note).toContain("follow the user message instead");
  });

  it("budget-excuse correction is still bounded", () => {
    expect(miniBudgetExcuseCorrection("我已达到工具预算限制")).toContain("Continue the next unfinished step now");
  });

  it("final-answer brevity rule caps the recap dump the silent rule does not cover", () => {
    expect(MINI_FINAL_BREVITY_RULE).toContain("~10 lines");
    expect(MINI_FINAL_BREVITY_RULE).toContain("instead of pasting file contents");
  });

  it("final-answer brevity rule ships in the mini system prompt", async () => {
    const source = await miniBridgeSource();
    expect(source).toContain("${MINI_FINAL_BREVITY_RULE}");
    expect(source).toContain("${MINI_ACTION_MANDATE_RULE}");
  });

  it("efficiency rule caps tool-call volume and ships in the system prompt", async () => {
    expect(MINI_EFFICIENCY_RULE).toContain("as few tool calls as possible");
    expect(MINI_EFFICIENCY_RULE).toContain("never re-read");
    expect(MINI_EFFICIENCY_RULE).toContain("when permitted");
    expect(MINI_EFFICIENCY_RULE).toContain("Different file ranges and queries are distinct reads");
    expect(MINI_EFFICIENCY_RULE).not.toContain("MUST execute the change");
    const source = await miniBridgeSource();
    expect(source).toContain("${MINI_EFFICIENCY_RULE}");
  });

  it("read-stall accounting counts the vm-read/vm_read alias as read-only", () => {
    // Regression: the model issues sa_vm vm-read (saVmTool alias) but
    // MINI_READ_ONLY_ACTIONS only listed read_file/read_lines, so
    // isMiniReadOnlyAction("vm-read") was false and the 4-read stall steer
    // never fired no matter how long the model kept reading.
    expect(isMiniReadOnlyAction("vm-read")).toBe(true);
    expect(isMiniReadOnlyAction("vm_read")).toBe(true);
    expect(isMiniReadOnlyAction("read_file")).toBe(true);
    expect(isMiniReadOnlyAction("edit_file")).toBe(false);
  });

  it("loop guard terminates repeated results without overwriting legitimate read output", async () => {
    const source = await miniBridgeSource();
    expect(source.includes("toolLoopGuard.observeRound(guardResults, roundMadeProgress)")).toBe(true);
    // Enforcement outputs (per-file read refusals) are filtered before both
    // guards so identical refusal text trips neither the loop guard nor the
    // thrash guard.
    expect(source.includes("MINI_REFUSED_READ_PREFIX")).toBe(true);
    expect(source.includes("lastReadSig")).toBe(false);
    expect(source.includes("[harness error: You already read")).toBe(false);
  });

  it("Responses verbosity mirrors codex-rs per-model defaults, not one global value", () => {
    // Official does not flatten: models.json gives gpt-5.4-mini `medium` and
    // gpt-daybreak-red-latest `high`, and gpt-6-astra is verbosity-capable too.
    expect(miniResponsesVerbosityField("GPT-5.6-Luna")).toEqual({ text: { verbosity: "low" } });
    expect(miniResponsesVerbosityField("gpt-5.6-terra")).toEqual({ text: { verbosity: "low" } });
    expect(miniResponsesVerbosityField("gpt-6-astra")).toEqual({ text: { verbosity: "low" } });
    expect(miniResponsesVerbosityField("gpt-5.4")).toEqual({ text: { verbosity: "low" } });
    expect(miniResponsesVerbosityField("gpt-5.4-mini")).toEqual({ text: { verbosity: "medium" } });
    expect(miniResponsesVerbosityField("gpt-daybreak-red-latest")).toEqual({ text: { verbosity: "high" } });
  });

  it("Responses verbosity is omitted for upstreams that cannot accept it", () => {
    expect(miniResponsesVerbosityField("deepseek-chat")).toEqual({});
    expect(miniResponsesVerbosityField("duck-model")).toEqual({});
    expect(miniResponsesVerbosityField("")).toEqual({});
    // Escape hatch for strict gateways that 400 on an unknown `text` member.
    expect(miniResponsesVerbosityField("gpt-5.6-luna", { supportsVerbosity: false })).toEqual({});
    expect(miniResponsesVerbosityField("gpt-5.6-luna", { verbosity: "medium" })).toEqual({ text: { verbosity: "medium" } });
    // An upstream-declared capability can enable it for an id we cannot infer.
    expect(miniResponsesVerbosityField("some-proxy-model", { supportsVerbosity: true })).toEqual({ text: { verbosity: "low" } });
  });

  it("all four mini Responses payloads carry the capability-resolved verbosity field", async () => {
    const source = await miniBridgeSource();
    // History summary, compaction, main turn body, summary pass. Chat
    // payloads must NOT carry it (no such Responses param exists there).
    expect(source.match(/\.\.\.miniResponsesVerbosityField\(s\.model, [a-z]+\.modelCapability\)/g) ?? []).toHaveLength(1);
    expect(source.match(/\.\.\.miniResponsesVerbosityField\(s\.model, modelCapability\)/g) ?? []).toHaveLength(3);
  });

  it("miniInternalDirective frames notes as harness-internal, not user speech", () => {
    const framed = miniInternalDirective("Continue now.");
    expect(framed).toContain("[Mini runtime status:");
    expect(framed).not.toContain("<system-reminder>");
    expect(framed).toContain("Continue now.");
    expect(MINI_INTERNAL_DIRECTIVE).toContain("not a user message");
  });

  it("every in-turn harness note is wrapped so the model never answers it as the user", async () => {
    const source = await miniBridgeSource();
    for (const site of [
      "miniInternalDirective(MINI_NO_TOOL_DIRECTIVE)",
      "miniInternalDirective(MINI_ROUND_CAP_NOTE)",
      "miniInternalDirective(MINI_BUDGET_WRAP_UP_NOTE)",
      "miniInternalDirective(resumeNote)",
      "miniInternalDirective(excuseFix)",
      "miniInternalDirective(note)",
      'miniInternalDirective("Continue with the final summary',
    ]) {
      expect(source).toContain(site);
    }
  });
});

describe("tool argument validation is answered as a tool error, never as a user complaint", () => {
  it("non-JSON arguments are normalized before being replayed upstream", () => {
    expect(miniReplayableArgs('{"action":"read_file","path":"a.ts"}')).toBe('{"action":"read_file","path":"a.ts"}');
    expect(miniReplayableArgs("read the file please")).toBe(MINI_TOOL_ARG_REPLAY_FALLBACK);
    expect(miniReplayableArgs('{"action":')).toBe(MINI_TOOL_ARG_REPLAY_FALLBACK);
    expect(miniReplayableArgs("")).toBe(MINI_TOOL_ARG_REPLAY_FALLBACK);
    expect(miniReplayableArgs("   ")).toBe(MINI_TOOL_ARG_REPLAY_FALLBACK);
    // The fallback itself must be valid JSON or the replay 400s anyway.
    expect(() => JSON.parse(MINI_TOOL_ARG_REPLAY_FALLBACK)).not.toThrow();
  });

  it("no fake user complaint and no history purge remain", async () => {
    const source = await miniBridgeSource();
    expect(source).not.toContain("purgeMiniPoisonedCalls");
    expect(source).not.toContain("poisonedCallIds");
    expect(source).not.toContain("poisonNotes");
    expect(source).not.toContain("they were NOT executed and NOT sent upstream");
  });

  it("every replayed tool call normalizes its arguments", async () => {
    // Behavior assertion (protocol-agnostic): feed one call with non-JSON
    // args into each push helper and assert the thread carries normalized
    // replayable arguments. No source-counting, so new protocols/paths
    // never break this test.
    const bad = { callId: "c1", name: "sa_vm", args: "not json at all" };
    const chatThread: Array<Record<string, any>> = [];
    pushChatToolCall(chatThread, bad);
    expect(chatThread).toHaveLength(1);
    expect(chatThread[0]?.role).toBe("assistant");
    expect(chatThread[0]?.tool_calls?.[0]?.id).toBe("c1");
    expect(chatThread[0]?.tool_calls?.[0]?.function?.name).toBe("sa_vm");
    expect(chatThread[0]?.tool_calls?.[0]?.function?.arguments).toBe(MINI_TOOL_ARG_REPLAY_FALLBACK);
    expect(() => JSON.parse(chatThread[0]?.tool_calls?.[0]?.function?.arguments)).not.toThrow();

    const good = { callId: "c2", name: "sa_vm", args: '{"action":"read_file"}' };
    const responsesThread: Array<Record<string, any>> = [];
    pushResponsesToolCall(responsesThread, good);
    expect(responsesThread).toHaveLength(1);
    expect(responsesThread[0]?.type).toBe("function_call");
    expect(responsesThread[0]?.call_id).toBe("c2");
    expect(responsesThread[0]?.arguments).toBe('{"action":"read_file"}');

    const source = await miniBridgeSource();
    // The raw value must still reach the toolCall item for UI/debug visibility.
    expect(source).toContain('arguments: c.args, output: ""');
    expect(source).toContain("arguments: c.args,");
  });
});
