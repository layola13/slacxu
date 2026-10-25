import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  resolveModelContextWindow,
  resolveModelMaxOutputTokens,
  resolveModelVerbosity,
  resolveReasoningEfforts,
  type ChannelGroupConfig,
  type JsonValue
} from "@codex-ui/shared";
import { CODEX_FALLBACK_INSTRUCTIONS } from "./codexFallbackInstructions.js";

import { CODEX_ULTRA_MODEL_CATALOG_FILE } from "@cxu/sdk-backend";
export { CODEX_ULTRA_MODEL_CATALOG_FILE };

export interface CodexModelCatalogOptions {
  vmEnabled?: boolean;
}

export function buildCodexModelCatalog(group: ChannelGroupConfig, selectedModel: string, options?: CodexModelCatalogOptions): Record<string, JsonValue> {
  const models = uniqueModels([selectedModel, ...(group.models ?? [])]).map((model, index) => {
    const capability = group.modelCapabilities?.[model];
    const contextWindow = resolveModelContextWindow(model, capability, group.contextWindow) ?? 272_000;
    const maxOutputTokens = resolveModelMaxOutputTokens(model, capability);
    const efforts = resolveReasoningEfforts(model, capability);
    const defaultVerbosity = resolveModelVerbosity(model, capability) ?? null;
    return {
      slug: model,
      display_name: model,
      description: model,
      default_reasoning_level: efforts.includes("medium") ? "medium" : efforts[0] ?? null,
      supported_reasoning_levels: efforts.map((effort) => ({ effort, description: `${effort} reasoning` })),
      shell_type: "default",
      visibility: "list",
      supported_in_api: true,
      priority: 1_000 + index,
      additional_speed_tiers: [],
      service_tiers: [],
      default_service_tier: null,
      availability_nux: null,
      upgrade: null,
      base_instructions: CODEX_FALLBACK_INSTRUCTIONS,
      include_skills_usage_instructions: false,
      supports_reasoning_summary_parameter: true,
      default_reasoning_summary: "auto",
      // Mirrors `codex-rs/core/src/client.rs`: the client serializes Responses
      // `text.verbosity` only when `support_verbosity` is true, using the model's
      // own `default_verbosity`. Reporting false/null here suppressed verbosity
      // for every Codex-engine session even for models whose upstream default
      // is `low`.
      support_verbosity: defaultVerbosity !== null,
      default_verbosity: defaultVerbosity,
      apply_patch_tool_type: null,
      web_search_tool_type: "text",
      truncation_policy: { mode: "bytes", limit: 10_000 },
      supports_parallel_tool_calls: false,
      supports_image_detail_original: false,
      context_window: contextWindow,
      max_context_window: contextWindow,
      auto_compact_token_limit: null,
      effective_context_window_percent: 95,
      experimental_supported_tools: [
        "request_user_input_async",
        "send_message_to_user_async",
        "send_user_message_async"
      ],
      input_modalities: ["text", "image"],
      supports_search_tool: false,
      use_responses_lite: false,
      auto_review_model_override: null,
      tool_mode: options?.vmEnabled ? "direct" : null,
      multi_agent_version: "v2",
      ...(maxOutputTokens ? { model_max_output_tokens: maxOutputTokens } : {})
    } as JsonValue;
  });
  return { models };
}

export function writeCodexModelCatalog(codexHome: string, group: ChannelGroupConfig, selectedModel: string, options?: CodexModelCatalogOptions): string {
  const path = join(codexHome, CODEX_ULTRA_MODEL_CATALOG_FILE);
  const temporaryPath = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });

  const newCatalog = buildCodexModelCatalog(group, selectedModel, options);
  const newModels = (Array.isArray(newCatalog.models) ? newCatalog.models : []) as Array<Record<string, JsonValue>>;
  const newModelMap = new Map<string, Record<string, JsonValue>>();
  for (const m of newModels) {
    const slug = typeof m.slug === "string" ? m.slug : "";
    if (slug) newModelMap.set(slug, m);
  }

  let mergedModels: Array<Record<string, JsonValue>> = [];
  try {
    if (existsSync(path)) {
      const existingRaw = readFileSync(path, "utf8");
      const existingParsed = JSON.parse(existingRaw);
      if (Array.isArray(existingParsed?.models)) {
        for (const item of existingParsed.models) {
          if (item && typeof item === "object") {
            const slug = typeof item.slug === "string" ? item.slug : "";
            if (slug && !newModelMap.has(slug)) {
              mergedModels.push({
                ...item,
                visibility: "list",
                tool_mode: options?.vmEnabled ? "direct" : (item.tool_mode ?? null)
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn(`[codex-catalog] Failed to read existing catalog at ${path}, creating fresh`, error);
  }

  mergedModels = [...newModels, ...mergedModels];

  writeFileSync(temporaryPath, `${JSON.stringify({ models: mergedModels }, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
  return path;
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}
