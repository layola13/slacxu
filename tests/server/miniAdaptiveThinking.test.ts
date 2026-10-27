import { describe, expect, test } from "bun:test";
import {
  isAnthropicAdaptiveThinkingRequiredError,
  miniAnthropicAdaptiveEffort,
  miniChatThreadToAnthropicBody,
  requiresAnthropicAdaptiveThinking,
} from "../../backends/mini/src/runtime/miniBridge.ts";

describe("Anthropic adaptive thinking protocol", () => {
  test("requiresAnthropicAdaptiveThinking detects 5th-gen Claude models and ignores legacy", () => {
    // 5-series and 5.5-series adaptive models
    expect(requiresAnthropicAdaptiveThinking("claude-opus-5")).toBe(true);
    expect(requiresAnthropicAdaptiveThinking("claude-sonnet-5")).toBe(true);
    expect(requiresAnthropicAdaptiveThinking("claude-haiku-5")).toBe(true);
    expect(requiresAnthropicAdaptiveThinking("claude-opus-5-5")).toBe(true);
    expect(requiresAnthropicAdaptiveThinking("claude-sonnet-5-5")).toBe(true);
    expect(requiresAnthropicAdaptiveThinking("claude-haiku-5-5")).toBe(true);
    expect(requiresAnthropicAdaptiveThinking("claude-opus-5.5")).toBe(true);
    expect(requiresAnthropicAdaptiveThinking("anthropic/claude-opus-5-5")).toBe(true);

    // Legacy Claude models retain budget thinking
    expect(requiresAnthropicAdaptiveThinking("claude-3-7-sonnet")).toBe(false);
    expect(requiresAnthropicAdaptiveThinking("claude-sonnet-4-5")).toBe(false);
    expect(requiresAnthropicAdaptiveThinking("claude-3-5-haiku")).toBe(false);
    expect(requiresAnthropicAdaptiveThinking("claude-3-opus")).toBe(false);
    expect(requiresAnthropicAdaptiveThinking("gpt-5.6-luna")).toBe(false);
    expect(requiresAnthropicAdaptiveThinking(undefined)).toBe(false);
  });

  test("miniAnthropicAdaptiveEffort maps mini tiers onto adaptive effort levels", () => {
    expect(miniAnthropicAdaptiveEffort("minimal")).toBe("low");
    expect(miniAnthropicAdaptiveEffort("low")).toBe("low");
    expect(miniAnthropicAdaptiveEffort("medium")).toBe("medium");
    expect(miniAnthropicAdaptiveEffort("high")).toBe("high");
    expect(miniAnthropicAdaptiveEffort("xhigh")).toBe("xhigh");
    expect(miniAnthropicAdaptiveEffort("ultra")).toBe("xhigh");
    expect(miniAnthropicAdaptiveEffort("max")).toBe("max");
    expect(miniAnthropicAdaptiveEffort("none")).toBeUndefined();
    expect(miniAnthropicAdaptiveEffort("")).toBeUndefined();
    expect(miniAnthropicAdaptiveEffort(undefined)).toBeUndefined();
  });

  test("isAnthropicAdaptiveThinkingRequiredError detects 400 rejection pattern", () => {
    expect(isAnthropicAdaptiveThinkingRequiredError("400: claude-opus-5-5 requires adaptive thinking; omit thinking or use thinking.type=adaptive and output_config.effort")).toBe(true);
    expect(isAnthropicAdaptiveThinkingRequiredError(new Error("requires adaptive thinking"))).toBe(true);
    expect(isAnthropicAdaptiveThinkingRequiredError("output_config.effort must be supplied for adaptive thinking")).toBe(true);
    expect(isAnthropicAdaptiveThinkingRequiredError("rate limit exceeded")).toBe(false);
    expect(isAnthropicAdaptiveThinkingRequiredError(null)).toBe(false);
  });

  test("miniChatThreadToAnthropicBody configures adaptive thinking vs legacy budget thinking", () => {
    // Adaptive model (haiku-5-5)
    const adaptiveBody = miniChatThreadToAnthropicBody([{ role: "user", content: "test" }], {
      model: "claude-haiku-5-5",
      tools: [],
      effort: "medium",
    });
    expect(adaptiveBody.thinking).toEqual({ type: "adaptive" });
    expect(adaptiveBody.output_config).toEqual({ effort: "medium" });

    // Legacy model (sonnet-4-5)
    const legacyBody = miniChatThreadToAnthropicBody([{ role: "user", content: "test" }], {
      model: "claude-sonnet-4-5",
      tools: [],
      effort: "medium",
    });
    expect(legacyBody.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(legacyBody.output_config).toBeUndefined();

    // Adaptive model with disabled thinking omits thinking and output_config
    const disabledAdaptive = miniChatThreadToAnthropicBody([{ role: "user", content: "test" }], {
      model: "claude-haiku-5-5",
      tools: [],
      effort: "none",
    });
    expect(disabledAdaptive.thinking).toBeUndefined();
    expect(disabledAdaptive.output_config).toBeUndefined();

    // Explicit adaptiveThinking override on legacy model
    const overriddenBody = miniChatThreadToAnthropicBody([{ role: "user", content: "test" }], {
      model: "claude-sonnet-4-5",
      tools: [],
      effort: "high",
      adaptiveThinking: true,
    });
    expect(overriddenBody.thinking).toEqual({ type: "adaptive" });
    expect(overriddenBody.output_config).toEqual({ effort: "high" });
  });
});
