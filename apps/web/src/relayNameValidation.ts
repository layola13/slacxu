import type { ProviderConfig } from "@codex-ui/shared";

const BUILT_IN_RELAY_NAMES = ["openai", "deepseek", "deepkey", "linuxdo", "gemini", "anthropic", "google"];

export function normalizeRelayName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "").replace(/(?:中转站?|relay|channel)$/i, "");
}

export function relayNameConflict(name: string, providers: ProviderConfig[], reservedNames: string[] = []): boolean {
  const normalized = normalizeRelayName(name);
  if (!normalized) return false;
  if (reservedNames.some((value) => normalizeRelayName(value) === normalized)) return true;
  return providers.some((provider) => [provider.id, provider.name, provider.serviceProvider?.id, provider.serviceProvider?.name]
    .some((value) => typeof value === "string" && normalizeRelayName(value) === normalized));
}
