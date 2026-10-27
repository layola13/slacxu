import { describe, expect, test } from "bun:test";
import {
  bridgeTextToJevData,
  buildJevBridgeChatBody,
  buildJevBridgeResponsesBody,
  extractChatText,
  extractResponsesText,
  isNativeJevUpstream,
  normalizeBridgeProtocol,
} from "../../backends/jev/src/jev/jevOpenAiBridge.ts";

describe("jevOpenAiBridge converter", () => {
  test("protocol normalization defaults to chat", () => {
    expect(normalizeBridgeProtocol("openai-responses")).toBe("openai-responses");
    expect(normalizeBridgeProtocol("responses")).toBe("openai-responses");
    expect(normalizeBridgeProtocol("openai-chat")).toBe("openai-chat");
    expect(normalizeBridgeProtocol("")).toBe("openai-chat");
    expect(normalizeBridgeProtocol(undefined)).toBe("openai-chat");
  });

  test("native upstream detection", () => {
    expect(isNativeJevUpstream("https://api.typesafe.ai/v1/systemone")).toBe(true);
    expect(isNativeJevUpstream("https://relay.example.com/v1")).toBe(false);
  });

  test("chat + responses bodies carry full JEV context", () => {
    const questions = {
      task_completed: { type: "choice", instructions: "done?", criteria: { completed: "yes", failed: "no" } },
    };
    const chat = buildJevBridgeChatBody("gpt-test", "hello state", questions as never) as { messages: { content: string }[] };
    expect(chat.messages.length).toBe(2);
    expect(chat.messages[1]!.content).toContain("hello state");
    expect(chat.messages[1]!.content).toContain("task_completed");
    const responses = buildJevBridgeResponsesBody("gpt-test", "hello state", questions as never) as { input: string };
    expect(responses.input).toContain("hello state");
  });

  test("bridge text converts to JEV shape with reason", () => {
    const questions = {
      task_completed: { type: "choice", instructions: "done?", criteria: { completed: "yes", failed: "no" } },
      solution_quality: { type: "score", instructions: "rate", criteria: ["poor", "good"] },
      risk: { type: "noul", instructions: "risk?" },
    };
    const data = bridgeTextToJevData(
      JSON.stringify({
        answers: {
          task_completed: { choice: "completed", confidence: 0.9, reason: "looks good" },
          solution_quality: { score: 1, confidence: 0.8, reason: "solid" },
          risk: { noul: 0.1, confidence: 0.7, reason: "safe" },
        },
      }),
      questions as never,
      "gpt-test",
    );
    expect(data.model).toBe("gpt-test");
    expect(data.answers.task_completed).toMatchObject({ choice: "completed", reason: "looks good" });
    expect(data.answers.solution_quality).toMatchObject({ score: 1, reason: "solid" });
    expect(data.answers.risk).toMatchObject({ noul: 0.1, reason: "safe" });
  });

  test("extractors handle chat and responses payloads", () => {
    expect(extractChatText({ choices: [{ message: { content: "abc" } }] })).toBe("abc");
    expect(extractResponsesText({ output: [{ content: [{ text: "xyz" }] }] })).toBe("xyz");
  });
});
