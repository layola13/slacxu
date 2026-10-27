import { expect, test } from "bun:test";
import {
  expandModelContextVariants,
  inferModelCapabilities,
  modelChoiceDisplayName,
  resolveModelContextWindow,
  resolveModelMaxOutputTokens,
  stripModelContextVariant
} from "../../packages/shared/src/modelCapabilities.ts";
import { FREE_OLLAMA_ENABLED, isProviderFeatureEnabled } from "../../packages/shared/src/index.ts";
import { reasoningEffortLabel, reasoningOptionsForModel } from "../../apps/web/src/modelReasoning.ts";

const GPT_56_MODELS = ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "openai/gpt-5.6-sol-20260805"];
const GPT_6_MODELS = ["gpt-6", "gpt-6-xxxxx", "gpt-6-mini", "openai/gpt-6-xxxxx", "gpt-6-xxxxx[1m]"];
const GPT_XHIGH_MODELS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "openai/gpt-5.4", "flux/gpt-5.5-pro"];
const CLAUDE_MAX_MODELS = ["claude-fable-5", "claude-fable-6-preview", "claude-mythos-5", "claude-mythos-preview", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7-thinking[1m]", "claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-6-preview"];
const CLAUDE_XHIGH_MODELS = ["claude-fable-5", "claude-fable-6-preview", "claude-mythos-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7-thinking[1m]", "claude-sonnet-5", "claude-sonnet-6-preview"];

test("keeps Free Ollama hidden while its code remains available", () => {
  expect(FREE_OLLAMA_ENABLED).toBeFalse();
  expect(isProviderFeatureEnabled("free-ollama")).toBeFalse();
  expect(isProviderFeatureEnabled("deepkey")).toBeTrue();
});

test("keeps Claude and GPT-5.6 capabilities independent", () => {
  for (const model of GPT_56_MODELS) {
    const efforts = reasoningOptionsForModel({ model }).map((option) => option.value);
    expect(efforts).not.toContain("minimal");
    expect(efforts).toContain("xhigh");
    expect(efforts).toContain("max");
    expect(efforts).toContain("ultra");
  }
  for (const model of CLAUDE_MAX_MODELS) {
    const efforts = reasoningOptionsForModel({ model }).map((option) => option.value);
    expect(efforts).toContain("max");
    expect(efforts).toContain("ultra");
  }
  for (const model of CLAUDE_XHIGH_MODELS) {
    expect(reasoningOptionsForModel({ model }).map((option) => option.value)).toContain("xhigh");
  }
  expect(reasoningOptionsForModel({ model: "claude-mythos-preview" }).map((option) => option.value)).not.toContain("xhigh");
  expect(reasoningOptionsForModel({ model: "claude-opus-4-6" }).map((option) => option.value)).toContain("xhigh");
});

test("exposes GPT-5.6 reasoning modes for GPT-6 models", () => {
  for (const model of GPT_6_MODELS) {
    const efforts = reasoningOptionsForModel({ model }).map((option) => option.value);
    expect(efforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  }
});

test("exposes xhigh without max for GPT-5.4, GPT-5.4-mini, and GPT-5.5", () => {
  for (const model of GPT_XHIGH_MODELS) {
    const efforts = reasoningOptionsForModel({ model }).map((option) => option.value);
    expect(efforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(efforts).not.toContain("max");
  }
  expect(reasoningOptionsForModel({ model: "gpt-5.3" }).map((option) => option.value)).not.toContain("xhigh");
});

test("honors Free Ollama per-model reasoning capabilities", () => {
  const group = {
    id: "demo",
    name: "Demo",
    kind: "text" as const,
    models: ["mistral:latest", "gpt-oss:20b"],
    modelCapabilities: {
      "mistral:latest": { reasoningEfforts: ["none"] },
      "gpt-oss:20b": { reasoningEfforts: ["low", "medium", "high"] }
    }
  };
  expect(reasoningOptionsForModel({ model: "mistral:latest", group }).map((option) => option.value)).toEqual(["none"]);
  expect(reasoningOptionsForModel({ model: "gpt-oss:20b", group }).map((option) => option.value)).toEqual(["low", "medium", "high"]);
});

test("merges upstream model metadata with inferred Claude capabilities", () => {
  const options = reasoningOptionsForModel({
    model: "claude-opus-4-8",
    modelEntry: {
      model: "claude-opus-4-8",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Upstream low" },
        { reasoningEffort: "ultra", description: "Upstream custom" }
      ]
    }
  });
  expect(options.map((option) => option.value)).toEqual(["low", "ultra", "medium", "high", "xhigh", "max"]);
  expect(options.find((option) => option.value === "low")?.description).toBe("Upstream low");
  expect(reasoningEffortLabel("xhigh")).toBe("XHigh");
});

test("creates non-persistent 1M variants and keeps capability lookup on the base model", () => {
  const models = expandModelContextVariants(["claude-opus-4-8", "claude-sonnet-4-6", "gpt-5.6-sol"]);
  expect(models).toEqual([
    "claude-opus-4-8",
    "claude-opus-4-8[1m]",
    "claude-sonnet-4-6",
    "claude-sonnet-4-6[1m]",
    "gpt-5.6-sol"
  ]);
  expect(stripModelContextVariant("claude-opus-4-8[1m]")).toEqual({
    baseModel: "claude-opus-4-8",
    contextWindow: 1_000_000
  });
  expect(inferModelCapabilities("claude-opus-4-8[1m]").reasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  expect(resolveModelContextWindow("claude-opus-4-8[1m]", undefined, 200_000)).toBe(1_000_000);
  expect(resolveModelMaxOutputTokens("claude-opus-4-8[1m]")).toBe(128_000);
});

test("Muse Spark models default to 1M and expose both original and virtual 1m choices", () => {
  for (const model of [
    "muse-spark-1.3-contributor", "muse-spark-1.3-contributor-free",
    "muse-spark-2-preview", "opencode/muse-spark-1.3", "Muse-Spark-1.3-Contributor",
  ]) {
    const models = [model];
    expect(inferModelCapabilities(model)).toEqual({ contextWindow: 1_000_000, source: "inferred" });
    expect(resolveModelContextWindow(model)).toBe(1_000_000);
    expect(expandModelContextVariants(models)).toEqual([model, `${model}[1m]`]);
    expect(models).toEqual([model]);
    expect(expandModelContextVariants([model, `${model}[1m]`, model])).toEqual([model, `${model}[1m]`]);
    expect(expandModelContextVariants([`${model}[1m]`])).toEqual([`${model}[1m]`]);
    expect(modelChoiceDisplayName(`${model}[1m]`)).toBe(`${model} [1M]`);
    expect(resolveModelContextWindow(model, undefined, 272_000)).toBe(272_000);
    expect(resolveModelContextWindow(`${model}[1m]`, undefined, 272_000)).toBe(1_000_000);
  }
  expect(inferModelCapabilities("notmuse-spark-1.3")).toEqual({});
  expect(expandModelContextVariants(["other-model"])).toEqual(["other-model"]);
});

test("OpenCode free tier defaults to 1M except big-pickle at 200K", () => {
  for (const model of [
    "opencode/beam-free",
    "opencode/deepseek-v4.1-flash-free",
    "opencode/mimo-v2.6-flash-free",
    "opencode/glm-5.3-flash-free",
    "opencode/nemotron-3.5-lightning-free",
  ]) {
    expect(inferModelCapabilities(model)).toEqual({ contextWindow: 1_000_000, source: "inferred" });
    expect(resolveModelContextWindow(model)).toBe(1_000_000);
    expect(expandModelContextVariants([model])).toEqual([model, `${model}[1m]`]);
    expect(modelChoiceDisplayName(`${model}[1m]`)).toBe(`${model} [1M]`);
    expect(resolveModelContextWindow(model, undefined, 128_000)).toBe(128_000);
    expect(resolveModelContextWindow(`${model}[1m]`, undefined, 128_000)).toBe(1_000_000);
  }
  expect(inferModelCapabilities("opencode/big-pickle")).toEqual({ contextWindow: 200_000, source: "inferred" });
  expect(resolveModelContextWindow("opencode/big-pickle")).toBe(200_000);
  expect(expandModelContextVariants(["opencode/big-pickle"])).toEqual(["opencode/big-pickle"]);
  // Other relays' `-free` ids are untouched by the opencode rule.
  expect(inferModelCapabilities("kilocode/nvidia/nemotron:free")).toEqual({});
  expect(expandModelContextVariants(["kilocode/nvidia/nemotron:free"])).toEqual(["kilocode/nvidia/nemotron:free"]);
});

test("never repeats a context suffix the upstream id or display name already carries", () => {
  // Variants we synthesize keep the badge next to the base label.
  expect(modelChoiceDisplayName("claude-opus-4-8[1m]")).toBe("claude-opus-4-8 [1M]");
  expect(modelChoiceDisplayName("claude-opus-4-8[1m]", "Opus 4.8")).toBe("Opus 4.8 [1M]");
  // Upstream ids/labels that already ship the suffix render verbatim.
  expect(modelChoiceDisplayName("MiniMax-M3[1m]", "MiniMax-M3[1m]")).toBe("MiniMax-M3[1m]");
  expect(modelChoiceDisplayName("longcat-2.0-free[1m]", "gpt-5.6-sol[1m]")).toBe("gpt-5.6-sol[1m]");
  // Plain models are untouched, and a non-1M suffix keeps its own size.
  expect(modelChoiceDisplayName("claude-opus-4-8")).toBe("claude-opus-4-8");
  expect(modelChoiceDisplayName("claude-opus-4-8", "Opus 4.8")).toBe("Opus 4.8");
  expect(modelChoiceDisplayName("some-model[500k]", "Some Model")).toBe("Some Model [500K]");
});

test("channel context overrides upstream model metadata", () => {
  expect(resolveModelContextWindow(
    "shared-model",
    { contextWindow: 1_000_000, source: "upstream" },
    257_000
  )).toBe(257_000);
  expect(resolveModelContextWindow(
    "shared-model",
    { contextWindow: 257_000, source: "upstream" },
    1_000_000
  )).toBe(1_000_000);
});
