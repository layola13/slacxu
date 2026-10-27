import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCodexModelCatalog, writeCodexModelCatalog } from "../../apps/server/src/codexModelCatalog.ts";

test("buildCodexModelCatalog removes Codex's fallback 272K ceiling for 1M variants", () => {
  const catalog = buildCodexModelCatalog({
    id: "claude",
    name: "claude",
    groupRatio: 1,
    models: ["claude-sonnet-5"],
    responseProtocol: "anthropic",
    keys: []
  }, "claude-sonnet-5[1m]");
  const models = catalog.models as Array<Record<string, unknown>>;
  expect(models[0]).toMatchObject({
    slug: "claude-sonnet-5[1m]",
    multi_agent_version: "v2",
    context_window: 1_000_000,
    max_context_window: 1_000_000,
    model_max_output_tokens: 128_000,
    experimental_supported_tools: [
      "request_user_input_async",
      "send_message_to_user_async",
      "send_user_message_async"
    ]
  });
});
test("buildCodexModelCatalog mirrors official per-model verbosity so clients actually send text.verbosity", () => {
  // Mirrors codex-rs/models-manager/models.json. Reporting support_verbosity:false
  // (the old behavior) suppressed Responses `text.verbosity` for every
  // Codex-engine session, so the engine never sent it and never got the
  // upstream `low` default the official client relies on.
  const expected: Record<string, string | null> = {
    "gpt-6-astra": "low",
    "gpt-5.6-sol": "low",
    "gpt-5.6-terra": "low",
    "gpt-5.6-luna": "low",
    "gpt-daybreak-blue-latest": "low",
    "gpt-daybreak-red-latest": "high",
    "gpt-5.5": "low",
    "gpt-5.4": "low",
    "gpt-5.4-mini": "medium",
    "gpt-5.2": "low",
    "codex-auto-review": "low",
    "claude-sonnet-5": null,
    "deepseek-chat": null
  };
  for (const [model, verbosity] of Object.entries(expected)) {
    const catalog = buildCodexModelCatalog({ id: "g", name: "g", groupRatio: 1, models: [model], keys: [] }, model);
    const entry = (catalog.models as Array<Record<string, unknown>>)[0];
    expect({ model, support_verbosity: entry.support_verbosity, default_verbosity: entry.default_verbosity })
      .toEqual({ model, support_verbosity: verbosity !== null, default_verbosity: verbosity });
  }
});

test("buildCodexModelCatalog lets a group capability override or forbid verbosity", () => {
  const forced = buildCodexModelCatalog({
    id: "g", name: "g", groupRatio: 1, models: ["gpt-5.6-luna"], keys: [],
    modelCapabilities: { "gpt-5.6-luna": { verbosity: "high" } }
  }, "gpt-5.6-luna");
  expect((forced.models as Array<Record<string, unknown>>)[0].default_verbosity).toBe("high");

  const forbidden = buildCodexModelCatalog({
    id: "g", name: "g", groupRatio: 1, models: ["gpt-5.6-luna"], keys: [],
    modelCapabilities: { "gpt-5.6-luna": { supportsVerbosity: false } }
  }, "gpt-5.6-luna");
  expect((forbidden.models as Array<Record<string, unknown>>)[0].support_verbosity).toBe(false);
  expect((forbidden.models as Array<Record<string, unknown>>)[0].default_verbosity).toBeNull();
});

test("writeCodexModelCatalog atomically writes an isolated managed catalog", () => {
  const home = mkdtempSync(join(tmpdir(), "codex-ultra-catalog-"));
  try {
    const path = writeCodexModelCatalog(home, { id: "g", name: "g", groupRatio: 1, models: ["claude-opus-4-8"], keys: [] }, "claude-opus-4-8[1m]");
    expect(path).toBe(join(home, "codex-ultra-model-catalog.json"));
    expect(JSON.parse(readFileSync(path, "utf8")).models[0].max_context_window).toBe(1_000_000);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildCodexModelCatalog sets tool_mode: direct only when vmEnabled is true", () => {
  const group = {
    id: "gpt",
    name: "gpt",
    groupRatio: 1,
    models: ["gpt-5.6-sol", "gpt-5.6-terra"],
    keys: []
  };
  const catalogVm = buildCodexModelCatalog(group, "gpt-5.6-sol", { vmEnabled: true });
  const modelsVm = catalogVm.models as Array<Record<string, unknown>>;
  expect(modelsVm[0].tool_mode).toBe("direct");
  expect(modelsVm[1].tool_mode).toBe("direct");

  const catalogDefault = buildCodexModelCatalog(group, "gpt-5.6-sol");
  const modelsDefault = catalogDefault.models as Array<Record<string, unknown>>;
  expect(modelsDefault[0].tool_mode).toBeNull();
  expect(modelsDefault[1].tool_mode).toBeNull();

  const catalogVmDisabled = buildCodexModelCatalog(group, "gpt-5.6-sol", { vmEnabled: false });
  const modelsVmDisabled = catalogVmDisabled.models as Array<Record<string, unknown>>;
  expect(modelsVmDisabled[0].tool_mode).toBeNull();
});

test("writeCodexModelCatalog preserves vmEnabled option in written catalog", () => {
  const home = mkdtempSync(join(tmpdir(), "codex-ultra-catalog-vm-"));
  try {
    const group = { id: "gpt", name: "gpt", groupRatio: 1, models: ["gpt-5.6-luna"], keys: [] };
    const pathVm = writeCodexModelCatalog(home, group, "gpt-5.6-luna", { vmEnabled: true });
    expect(JSON.parse(readFileSync(pathVm, "utf8")).models[0].tool_mode).toBe("direct");

    const pathNormal = writeCodexModelCatalog(home, group, "gpt-5.6-luna", { vmEnabled: false });
    expect(JSON.parse(readFileSync(pathNormal, "utf8")).models[0].tool_mode).toBeNull();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("writeCodexModelCatalog merges models across multiple groups and providers with visibility list", () => {
  const home = mkdtempSync(join(tmpdir(), "codex-ultra-catalog-merge-"));
  try {
    const groupA = { id: "relayA", name: "relayA", groupRatio: 1, models: ["model-a1", "model-a2"], keys: [] };
    const groupB = { id: "relayB", name: "relayB", groupRatio: 1, models: ["model-b1", "model-b2"], keys: [] };

    writeCodexModelCatalog(home, groupA, "model-a1");
    const pathB = writeCodexModelCatalog(home, groupB, "model-b1");

    const content = JSON.parse(readFileSync(pathB, "utf8"));
    const slugs = content.models.map((m: any) => m.slug);
    expect(slugs).toContain("model-a1");
    expect(slugs).toContain("model-a2");
    expect(slugs).toContain("model-b1");
    expect(slugs).toContain("model-b2");

    for (const m of content.models) {
      expect(m.visibility).toBe("list");
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
