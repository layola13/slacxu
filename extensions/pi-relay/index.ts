import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

/**
 * Pi Relay Extension for Codex Ultra
 *
 * Reads PI_LAUNCH_BASE_URL, PI_LAUNCH_MODEL, and PI_LAUNCH_API_KEY (or PI_LAUNCH_API)
 * and registers the "pi-relay" provider dynamically with Pi.
 */
export default function piRelayExtension(pi: ExtensionAPI): void {
  const baseUrl = (process.env.PI_LAUNCH_BASE_URL || "https://api.kilo.ai/api/openrouter").trim();
  const apiKey = (process.env.PI_LAUNCH_API_KEY || "public").trim();
  const modelSpec = (process.env.PI_LAUNCH_MODEL || "stepfun/step-3.7-flash:free,kilo-auto/free,nvidia/nemotron-3.5-lightning:free").trim();
  const apiType = (process.env.PI_LAUNCH_API || "openai-completions").trim();

  // If no baseUrl is provided, do not register
  if (!baseUrl) {
    return;
  }

  const modelIds = modelSpec
    ? modelSpec.split(",").map((s) => s.trim()).filter(Boolean)
    : ["stepfun/step-3.7-flash:free"];

  const headers: Record<string, string> = {};
  if (baseUrl.includes("kilo.ai")) {
    headers["User-Agent"] = "opencode-kilo-provider";
  }

  const models: ProviderModelConfig[] = modelIds.map((id) => ({
    id,
    name: `${id} (Relay)`,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32768,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: true,
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
      supportsStrictMode: false,
      maxTokensField: "max_tokens",
    },
  }));

  pi.registerProvider("pi-relay", {
    name: "Codex Ultra Relay",
    baseUrl,
    apiKey: apiKey || "$PI_LAUNCH_API_KEY",
    api: apiType as any,
    headers,
    models,
  });
}
