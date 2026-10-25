import { describe, expect, test } from "bun:test";
import {
  capReasoningEffort,
  convertAPIRequestWithOptions,
  newDurableStream,
} from "../src/duckgo/convert.js";

describe("convertAPIRequestWithOptions", () => {
  test("maps legacy models and caps effort", () => {
    const req = convertAPIRequestWithOptions(
      {
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hi" },
        ],
        stream: false,
      },
      { reasoningEffort: "high", webSearch: true },
    );
    expect(req.model).toBe("gpt-4o-mini");
    expect(req.reasoningEffort).toBe("low");
    expect(req.metadata.toolChoice?.["WebSearch"]).toBe(true);
    // Pure-conversation channel: the system prompt is intercepted, only the
    // human turn reaches upstream.
    expect(req.messages.map((m) => m.role)).toEqual(["user"]);
    // Real duck.ai frontend (gpt-6-luna capture) always uses array-of-parts
    // content, even for a single text part.
    expect(Array.isArray(req.messages[0]?.content)).toBe(true);
    expect(req.messages[0]?.content).toEqual([{ type: "text", text: "hi" }]);
    expect(req.canShowGreeting).toBe(true);
    expect(req.durableStream.messageId).toHaveLength(36);
    expect(String(req.durableStream.publicKey["n"]).length).toBeGreaterThan(100);
  });

  test("capReasoningEffort defaults", () => {
    expect(capReasoningEffort("none")).toBe("none");
    expect(capReasoningEffort("")).toBe("low");
    expect(capReasoningEffort("medium")).toBe("low");
  });

  test("pure conversation: system/developer prompts are intercepted", () => {
    const req = convertAPIRequestWithOptions(
      {
        model: "gpt-6-luna",
        messages: [
          { role: "system", content: "you are a tool agent" },
          { role: "developer", content: "skill instructions" },
          { role: "user", content: "hi" },
        ],
        stream: false,
      },
      {},
    );
    expect(req.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
    expect(JSON.stringify(req)).not.toContain("tool agent");
  });

  test("pure conversation: tool messages dropped, no simulation", () => {
    const req = convertAPIRequestWithOptions(
      {
        model: "gpt-6-luna",
        messages: [
          { role: "user", content: "hi" },
          { role: "tool", content: "tool output" } as never,
          { role: "assistant", content: "hello" },
        ],
        stream: false,
      },
      {},
    );
    // Tool-role input is dropped entirely, no playgame markers anywhere.
    expect(req.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(req.messages)).not.toContain("playgame");
    expect(req.toolSimulation).toBeUndefined();
    expect(req.canUseTools).toBe(true);
  });

  test("pure conversation: client tools are ignored", () => {
    const req = convertAPIRequestWithOptions(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "hi" }], stream: false },
      { tools: [{ type: "function", function: { name: "run" } }] } as never,
    );
    expect(req.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
    expect(req.toolSimulation).toBeUndefined();
    expect(req.canUseTools).toBe(true);
  });

  test("durable streams are unique", () => {
    const a = newDurableStream();
    const b = newDurableStream();
    expect(a.messageId).not.toBe(b.messageId);
    expect(a.conversationId).not.toBe(b.conversationId);
  });

  test("delisted gpt-5.6-luna aliases to gpt-6-luna with greeting flag", () => {
    const req = convertAPIRequestWithOptions(
      { model: "gpt-5.6-luna", messages: [{ role: "user", content: "hi" }], stream: false },
      {},
    );
    expect(req.model).toBe("gpt-6-luna");
    expect(req.canShowGreeting).toBe(true);
    expect(req.messages[0]?.content).toEqual([{ type: "text", text: "hi" }]);
  });

  test("generateImage projects real capture wire", () => {
    const req = convertAPIRequestWithOptions(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "生成2只在海里格斗的wwe勇士" }], stream: false },
      { generateImage: true },
    );
    expect(req.model).toBe("gpt-6-luna");
    expect(req.metadata).toEqual({ toolChoice: { GenerateImage: true } });
    expect(req.canUseTools).toBe(true);
    expect(req.canUseApproxLocation).toBe(false);
    expect(req.canDelegateImageGeneration).toBeNull();
    expect(req.canShowGreeting).toBe(true);
  });

  test("image parts keep array form and flip approx location to false", () => {
    const req = convertAPIRequestWithOptions(
      {
        model: "gpt-6-luna",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "你看到什么？" },
            { type: "image", image: "data:image/webp;base64,AAA", mimeType: "image/webp" },
          ],
        }],
        stream: false,
      },
      {},
    );
    expect(req.metadata).toEqual({});
    expect(req.canUseApproxLocation).toBe(false);
    expect(req.messages[0]?.content).toEqual([
      { type: "text", text: "你看到什么？" },
      { type: "image", image: "data:image/webp;base64,AAA", mimeType: "image/webp" },
    ]);
  });

  test("text-only keeps approx location null", () => {
    const req = convertAPIRequestWithOptions(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "hi" }], stream: false },
      {},
    );
    expect(req.canUseApproxLocation).toBeNull();
  });

  test("default metadata is empty so search auto-triggers server-side", () => {
    const req = convertAPIRequestWithOptions(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "搜索广州天气" }], stream: false },
      {},
    );
    // Matches real capture: "metadata":{} with no false flags.
    expect(req.metadata).toEqual({});
    expect(req.canShowGreeting).toBe(true);
    expect(req.messages[0]?.content).toEqual([{ type: "text", text: "搜索广州天气" }]);
  });
});
