import { expect, test } from "bun:test";
import {
  isMiniStrictAssistantUpstream,
  relaxMiniResponsesAssistantText,
  sanitizeMiniResponsesInput,
  resolveResponsesRoundInput,
  EMPTY_MINI_RESPONSES_CHAIN,
} from "../../backends/mini/src/runtime/miniBridge.ts";

test("deepkey/gpt-6.1-sol channel is lenient, opencode stays strict", () => {
  // opencode strict cases
  expect(isMiniStrictAssistantUpstream("https://opencode.ai/api", "x", "y")).toBe(true);
  expect(isMiniStrictAssistantUpstream("https://any", "opencode", "g")).toBe(true);
  expect(isMiniStrictAssistantUpstream("https://any", "p", "opencode-free")).toBe(true);
  // deepkey channel (the failing mini thread: provider deepkey, model gpt-6.1-sol)
  expect(isMiniStrictAssistantUpstream("https://deepkey.top/v1", "deepkey", "group-1791018008525-f6ej")).toBe(false);
  expect(isMiniStrictAssistantUpstream("https://deepkey.top/v1", "deepkey", "default")).toBe(false);
});

test("relax converts assistant output_text to input_text, leaves the rest", () => {
  const input = [
    { role: "user", content: [{ type: "input_text", text: "最近改了什么？" }] },
    { role: "assistant", content: [{ type: "output_text", text: "reply" }] },
    { role: "assistant", content: [{ type: "input_text", text: "already lenient" }] },
    { type: "function_call", call_id: "c1", name: "sa_vm", arguments: "{}" },
    { type: "function_call_output", call_id: "c1", output: "ok" },
  ];
  const out = relaxMiniResponsesAssistantText(input);
  expect((out[1] as any).content[0].type).toBe("input_text");
  expect((out[1] as any).content[0].text).toBe("reply");
  expect((out[0] as any).content[0].type).toBe("input_text");
  expect((out[2] as any).content[0].type).toBe("input_text");
  expect((out[3] as any).type).toBe("function_call");
  // pure: no mutation of original
  expect((input[1] as any).content[0].type).toBe("output_text");
});

test("deepkey round input keeps chain stable after relax", () => {
  const rThread = [
    { role: "user", content: [{ type: "input_text", text: "hi" }] },
    { role: "assistant", content: [{ type: "output_text", text: "reply" }] },
  ];
  const sanitized = sanitizeMiniResponsesInput(rThread);
  const relaxed = relaxMiniResponsesAssistantText(sanitized);
  // opencode path would keep output_text
  expect((sanitized[1] as any).content[0].type).toBe("output_text");
  // deepkey path relaxes
  expect((relaxed[1] as any).content[0].type).toBe("input_text");
  // chaining still resolves (empty chain => full send, no corruption)
  const round = resolveResponsesRoundInput(relaxed, { ...EMPTY_MINI_RESPONSES_CHAIN });
  expect(round.chained).toBe(false);
  expect(round.previousResponseId).toBeNull();
  expect(round.input.length).toBe(2);
});
