import { afterAll, expect, test } from "bun:test";
import {
  buildAuggieFeatureFlags,
  buildAuggieModelInfoRegistryJson,
  buildOpenaiRequest,
  configureAuggieRedirector,
  ensureAuggieRedirector,
  stopAuggieRedirector,
  type AuggieRedirectorConfig,
  type AuggieRedirectorModelCatalogEntry,
} from "../../backends/auggie/src/runtime/auggieRedirector.js";

const WHITELISTED_FLAGS = [
  "model_info_registry",
  "enable_model_registry",
  "additional_chat_models",
  "agent_chat_model",
  "history_summary_params",
  "history_summary_min_version",
  "cli_chat_stream_retry_hard_stop_ms",
  "beachhead_enable_sub_agent_tool",
  "beachheadEnableParallelToolExecution"
];

const FORBIDDEN_FLAGS = ["cli_enable_sentry", "cli_analytics_write_key"];

let baseUrl = "";

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

function baseConfig(overrides: Partial<AuggieRedirectorConfig> = {}): AuggieRedirectorConfig {
  return {
    upstreamBaseUrl: "http://upstream.invalid/v1",
    upstreamModel: "redirector-test-model",
    ...overrides
  };
}

afterAll(async () => {
  await stopAuggieRedirector();
});

test("find-missing always reports nothing missing so uploads never fire", async () => {
  configureAuggieRedirector(baseConfig());
  const handle = await ensureAuggieRedirector();
  baseUrl = handle.url;

  const withMemories = await post("find-missing", {
    mem_object_names: ["memory-a", "memory-b"],
    blobs: [{ blob_name: "blob-1" }, { blob_name: "blob-2" }]
  });
  expect(withMemories.status).toBe(200);
  expect(withMemories.json).toEqual({ unknown_memory_names: [], nonindexed_blob_names: [] });

  // Even in non-complete indexing modes the answer stays empty: echoing names
  // would tell the CLI their contents are missing.
  configureAuggieRedirector(baseConfig({ indexingMode: "fast" }));
  const fastMode = await post("find-missing", {
    mem_object_names: ["memory-c"],
    blobs: [{ blob_name: "blob-3" }]
  });
  expect(fastMode.status).toBe(200);
  expect(fastMode.json).toEqual({ unknown_memory_names: [], nonindexed_blob_names: [] });

  const emptyBody = await post("find-missing", {});
  expect(emptyBody.json).toEqual({ unknown_memory_names: [], nonindexed_blob_names: [] });
});

test("batch-upload echoes submitted blob names in identical count and order", async () => {
  configureAuggieRedirector(baseConfig({ indexingMode: "none" }));

  const submitted = ["blob-z", "blob-a", "blob-z", "blob-m", "blob-a"];
  const response = await post("batch-upload", {
    blobs: submitted.map((name) => ({ blob_name: name }))
  });
  expect(response.status).toBe(200);
  expect(Object.keys(response.json)).toEqual(["blob_names"]);
  expect(response.json.blob_names).toEqual(submitted);
  expect((response.json.blob_names as string[]).length).toBe(submitted.length);

  // Regression for the length trap: any shortfall makes the CLI re-upload full
  // contents per missing blob, so N submissions must yield exactly N echoes.
  const many = Array.from({ length: 50 }, (_, i) => `blob-${(i * 7) % 50}`);
  const manyResponse = await post("batch-upload", { blobs: many.map((blob_name) => ({ blob_name })) });
  expect(manyResponse.json.blob_names).toEqual(many);

  // Idempotent echo: the response reflects the request verbatim, persisting nothing.
  const repeat = await post("batch-upload", { blobs: [{ blob_name: "only-one" }] });
  expect(repeat.json).toEqual({ blob_names: ["only-one"] });
});

test("get-models feature_flags contain exactly the deliberate whitelist", async () => {
  configureAuggieRedirector(baseConfig());
  await ensureAuggieRedirector();

  const response = await fetch(`${baseUrl}/get-models`);
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { feature_flags: Record<string, unknown>; default_model: string };

  expect(Object.keys(payload.feature_flags).sort()).toEqual([...WHITELISTED_FLAGS].sort());
  for (const forbidden of FORBIDDEN_FLAGS) {
    expect(Object.keys(payload.feature_flags)).not.toContain(forbidden);
  }

  // The registry rides along as a JSON STRING, not an object. Entries use the
  // CLI's registry-consumer shape (displayName/shortName/…) — humanName and
  // the tokenizer fields belong to a different built-in table and are ignored.
  expect(typeof payload.feature_flags.model_info_registry).toBe("string");
  expect(() => JSON.parse(payload.feature_flags.model_info_registry as string)).not.toThrow();
  expect(JSON.parse(payload.feature_flags.model_info_registry as string)).toMatchObject({
    "redirector-test-model": { displayName: "Redirector Test Model", isDefault: true, disabled: false }
  });

  // Registry-era aliases must point at the top-level default model so the CLI
  // resolves a non-empty chat model (empty ⇒ every turn hangs).
  expect(payload.default_model).toBe("redirector-test-model");
  expect(payload.feature_flags.enable_model_registry).toBe(true);
  expect(payload.feature_flags.additional_chat_models).toBe("redirector-test-model");
  expect(payload.feature_flags.agent_chat_model).toBe("redirector-test-model");
});

test("history_summary_params defaults are emitted and tunable", () => {
  configureAuggieRedirector(baseConfig());
  expect(JSON.parse(buildAuggieFeatureFlags().history_summary_params as string)).toEqual({
    trigger_on_total_tokens: 100000,
    history_tail_size_tokens_to_exclude: 16000,
    max_history_chars: 200000,
    input_budget_trigger_ratio: 0.8
  });
  expect(buildAuggieFeatureFlags().history_summary_min_version).toBe("1");
  expect(buildAuggieFeatureFlags().beachhead_enable_sub_agent_tool).toBe(true);
  expect(buildAuggieFeatureFlags().beachheadEnableParallelToolExecution).toBe(true);

  configureAuggieRedirector(
    baseConfig({
      historySummaryParams: { triggerOnTotalTokens: 60000, maxHistoryChars: 90000 },
      historySummaryMinVersion: 2,
      subAgentsEnabled: false
    })
  );
  const flags = buildAuggieFeatureFlags();
  expect(JSON.parse(flags.history_summary_params as string)).toEqual({
    trigger_on_total_tokens: 60000,
    history_tail_size_tokens_to_exclude: 16000,
    max_history_chars: 90000,
    input_budget_trigger_ratio: 0.8
  });
  expect(flags.history_summary_min_version).toBe("2");
  expect(flags.beachhead_enable_sub_agent_tool).toBe(false);
  expect(flags.beachheadEnableParallelToolExecution).toBe(false);
});

test("model_info_registry serializes deterministically with an isDefault fallback", () => {
  configureAuggieRedirector(baseConfig());

  // No catalog configured: single synthesized entry from upstreamModel.
  const fallback = JSON.parse(buildAuggieModelInfoRegistryJson(undefined)) as Record<
    string,
    Record<string, unknown>
  >;
  expect(Object.keys(fallback)).toEqual(["redirector-test-model"]);
  expect(fallback["redirector-test-model"]).toMatchObject({ isDefault: true, disabled: false });

  // No explicit default: first entry wins.
  const catalog: AuggieRedirectorModelCatalogEntry[] = [
    { id: "model-alpha", displayName: "Alpha" },
    { id: "model-beta", shortName: "B" },
    { id: "model-gamma" }
  ];
  const registry = JSON.parse(buildAuggieModelInfoRegistryJson(catalog)) as Record<string, Record<string, unknown>>;
  expect(Object.keys(registry)).toEqual(["model-alpha", "model-beta", "model-gamma"]);
  expect(registry["model-alpha"]).toMatchObject({
    displayName: "Alpha",
    shortName: "Alpha",
    isDefault: true,
    disabled: false
  });
  expect(registry["model-beta"]).toMatchObject({ shortName: "B", isDefault: false });
  // Deterministic serialization: same config, same bytes.
  expect(buildAuggieModelInfoRegistryJson(catalog)).toBe(buildAuggieModelInfoRegistryJson(catalog));

  // Explicit default beats position; extra explicit flags collapse to the first.
  const explicit = buildAuggieModelInfoRegistryJson([
    { id: "a", isDefault: true },
    { id: "b", isDefault: true },
    { id: "c" }
  ]);
  const parsedExplicit = JSON.parse(explicit) as Record<string, { isDefault: boolean }>;
  expect(parsedExplicit.a.isDefault).toBe(true);
  expect(parsedExplicit.b.isDefault).toBe(false);
  expect(parsedExplicit.c.isDefault).toBe(false);
});

test("no registry displayName may collide with any registry id", () => {
  configureAuggieRedirector(baseConfig());

  // The CLI's resolver scans every entry's displayName BEFORE it tries ids, and
  // a displayName equal to the requested value hard-rejects it
  // ("Using a display name for --model is no longer supported"). An
  // already-capitalized single-token id prettifies back to itself, so without a
  // guard "Grok4" would lock itself out of --model entirely.
  const selfCollision = JSON.parse(buildAuggieModelInfoRegistryJson([{ id: "Grok4" }])) as Record<
    string,
    { displayName: string }
  >;
  expect(Object.keys(selfCollision)).toEqual(["Grok4"]);
  expect(selfCollision["Grok4"]!.displayName).not.toBe("Grok4");

  // Cross-entry collision: an explicit displayName matching a DIFFERENT entry's
  // id would reject that other id, so it is guarded the same way.
  const crossCollision = JSON.parse(
    buildAuggieModelInfoRegistryJson([{ id: "fast", displayName: "quick" }, { id: "quick" }])
  ) as Record<string, { displayName: string }>;
  expect(crossCollision["fast"]!.displayName).not.toBe("quick");
  expect(crossCollision["quick"]!.displayName).not.toBe("quick");

  // Every id stays addressable: no displayName collides with any id.
  const ids = Object.keys(crossCollision);
  for (const id of ids) {
    expect(ids).not.toContain(crossCollision[id]!.displayName);
  }
});

test("reasoning_effort injection: global default, per-model override, passthrough", () => {
  const effortOf = (body: Record<string, unknown>): string | undefined => {
    return buildOpenaiRequest(body, true).reasoning_effort as string | undefined;
  };

  // Global default applies when the request carries nothing.
  configureAuggieRedirector(baseConfig({ reasoningEffort: "low" }));
  expect(effortOf({ message: "hi" })).toBe("low");

  // Without an override the incoming body value passes through and beats the
  // global default.
  configureAuggieRedirector(baseConfig({ reasoningEffort: "low" }));
  expect(effortOf({ message: "hi", reasoning_effort: "Medium" })).toBe("medium");

  // No configuration at all leaves the field absent.
  configureAuggieRedirector(baseConfig());
  expect(effortOf({ message: "hi" })).toBeUndefined();

  // Per-model override replaces whatever the body carried.
  configureAuggieRedirector(baseConfig({ reasoningEffortByModel: { "model-x": "high" } }));
  expect(effortOf({ message: "hi", model: "model-x", reasoning_effort: "medium" })).toBe("high");
  expect(effortOf({ message: "hi", model: "model-y", reasoning_effort: "medium" })).toBe("medium");
  expect(effortOf({ message: "hi", model: "model-y" })).toBeUndefined();

  // An empty-string override strips the field entirely.
  configureAuggieRedirector(
    baseConfig({ reasoningEffort: "high", reasoningEffortByModel: { "model-x": "" } })
  );
  expect(effortOf({ message: "hi", model: "model-x", reasoning_effort: "high" })).toBeUndefined();
});
