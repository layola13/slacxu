import { describe, expect, test } from "bun:test";
import {
  MINI_ANTHROPIC_MAX_TOKENS,
  miniChatThreadToAnthropicBody,
} from "../../backends/mini/src/runtime/miniBridge.ts";

const thread = [{ role: "user", content: "hi" }];
const tools: Array<{ name: string; description: string; schema: Record<string, unknown> }> = [];

function thinkingOf(body: Record<string, unknown>): Record<string, unknown> | undefined {
  return body.thinking as Record<string, unknown> | undefined;
}

describe("mini anthropic thinking effort", () => {
  test("空值默认 medium：带 thinking enabled/2048", () => {
    for (const effort of [undefined, "", "  ", "has space", "unknown-level"] as Array<string | undefined>) {
      const body = miniChatThreadToAnthropicBody(thread, { model: "claude-sonnet-4-5", tools, effort });
      expect(thinkingOf(body)).toEqual({ type: "enabled", budget_tokens: 2048 });
      expect(body.max_tokens).toBe(MINI_ANTHROPIC_MAX_TOKENS);
    }
  });

  test("全档位映射对齐 8 档 + ultra 别名", () => {
    const cases: Array<[string | undefined, Record<string, unknown>]> = [
      ["none", { type: "disabled" }],
      ["minimal", { type: "enabled", budget_tokens: 1024 }],
      ["low", { type: "enabled", budget_tokens: 1024 }],
      ["medium", { type: "enabled", budget_tokens: 2048 }],
      ["high", { type: "enabled", budget_tokens: 4096 }],
      ["xhigh", { type: "enabled", budget_tokens: 8192 }],
      ["ultra", { type: "enabled", budget_tokens: 8192 }],
      ["max", { type: "enabled", budget_tokens: 8192 }],
      [" XHigh ", { type: "enabled", budget_tokens: 8192 }],
    ];
    for (const [effort, expected] of cases) {
      const body = miniChatThreadToAnthropicBody(thread, { model: "claude-sonnet-4-5", tools, effort });
      expect(thinkingOf(body)).toEqual(expected);
    }
  });

  test("xhigh/ultra/max 拉高 max_tokens 到 budget+2048", () => {
    const body = miniChatThreadToAnthropicBody(thread, { model: "claude-sonnet-4-5", tools, effort: "ultra" });
    expect(body.max_tokens).toBe(8192 + 2048);
  });

  test("haiku 非 high/xhigh 保持 disabled，high 仍 enabled", () => {
    const disabled = miniChatThreadToAnthropicBody(thread, { model: "claude-haiku-4-5", tools, effort: "medium" });
    expect(thinkingOf(disabled)).toEqual({ type: "disabled" });
    const enabled = miniChatThreadToAnthropicBody(thread, { model: "claude-haiku-4-5", tools, effort: "high" });
    expect(thinkingOf(enabled)).toEqual({ type: "enabled", budget_tokens: 4096 });
  });

  test("omitThinking/disableThinking 语义不变", () => {
    const omitted = miniChatThreadToAnthropicBody(thread, {
      model: "claude-sonnet-4-5", tools, effort: "high", omitThinking: true,
    });
    expect(omitted.thinking).toBeUndefined();
    const disabled = miniChatThreadToAnthropicBody(thread, {
      model: "claude-sonnet-4-5", tools, effort: "high", disableThinking: true,
    });
    expect(thinkingOf(disabled)).toEqual({ type: "disabled" });
  });

  test("非 Claude 模型走 Anthropic 协议时保持旧语义", () => {
    const model = "gpt-5.4";
    // 空值/ultra/max/minimal：旧逻辑无 thinking，不意外开启。
    for (const effort of [undefined, "", "ultra", "max", "minimal"] as Array<string | undefined>) {
      const body = miniChatThreadToAnthropicBody(thread, { model, tools, effort });
      expect(thinkingOf(body)).toBeUndefined();
    }
    // low/none：旧逻辑 disabled。
    expect(thinkingOf(miniChatThreadToAnthropicBody(thread, { model, tools, effort: "low" })))
      .toEqual({ type: "disabled" });
    expect(thinkingOf(miniChatThreadToAnthropicBody(thread, { model, tools, effort: "none" })))
      .toEqual({ type: "disabled" });
    // medium/high/xhigh：旧逻辑三档 enabled 不变。
    expect(thinkingOf(miniChatThreadToAnthropicBody(thread, { model, tools, effort: "medium" })))
      .toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(thinkingOf(miniChatThreadToAnthropicBody(thread, { model, tools, effort: "high" })))
      .toEqual({ type: "enabled", budget_tokens: 4096 });
  });
});
