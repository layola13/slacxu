import type { CliBackend } from "@codex-ui/shared";
import { cliPluginId } from "./cliPlugins";

export type ThreadCliBackend = CliBackend;

export function isCodexCliBackend(value: unknown): boolean {
  return value === "codex";
}

export function isClaudeCliBackend(value: unknown): boolean {
  return value === "claude";
}

export function isAuggieCliBackend(value: unknown): boolean {
  return value === "auggie";
}

export function isAgyCliBackend(value: unknown): boolean {
  return value === "agy";
}

export function isGrokCliBackend(value: unknown): boolean {
  return value === "grok";
}

export function isPiCliBackend(value: unknown): boolean {
  return value === "pi";
}

export function isOpencodeCliBackend(value: unknown): boolean {
  return value === "opencode";
}

export function isOpencodeV2CliBackend(value: unknown): boolean {
  return value === "opencode-v2";
}

export function isMuseCliBackend(value: unknown): boolean {
  return value === "muse";
}

export function isClineCliBackend(value: unknown): boolean {
  return value === "cline";
}

export function isCommandCodeCliBackend(value: unknown): boolean {
  return value === "command-code";
}

export function isMiniCliBackend(value: unknown): boolean {
  return value === "mini";
}

/**
 * Canonical thread-level normalization. Keeps legacy `auggie` distinct from
 * `agy` so history filtering and thread recovery don't merge threads.
 * Use `cliPluginId()` when resolving to a plugin/installation kind.
 */
export function normalizeThreadCliBackend(value: unknown): ThreadCliBackend {
  if (isClaudeCliBackend(value)) return "claude";
  if (isAuggieCliBackend(value)) return "auggie";
  if (isAgyCliBackend(value)) return "agy";
  if (isGrokCliBackend(value)) return "grok";
  if (isPiCliBackend(value)) return "pi";
  if (isOpencodeCliBackend(value)) return "opencode";
  if (isOpencodeV2CliBackend(value)) return "opencode-v2";
  if (isMuseCliBackend(value)) return "muse";
  if (isClineCliBackend(value)) return "cline";
  if (isCommandCodeCliBackend(value)) return "command-code";
  if (isMiniCliBackend(value)) return "mini";
  if (isCodexCliBackend(value)) return "codex";
  // Every registered backend is classified above; the conformance
  // test (cliBackendClassification) fails if a catalog backend is
  // missing here. What reaches this line is an absent or garbage
  // stamp (legacy threads), which reads as the built-in default.
  return "mini";
}

/** History/thread-catalog normalization: unknown values stay unassigned. */
export function normalizeCliBackendFilter(value: unknown): CliBackend | undefined {
  if (value === "codex") return "codex";
  if (value === "claude") return "claude";
  if (value === "auggie") return "auggie";
  if (value === "agy") return "agy";
  if (value === "grok") return "grok";
  if (value === "pi") return "pi";
  if (value === "opencode") return "opencode";
  if (value === "opencode-v2") return "opencode-v2";
  if (value === "muse") return "muse";
  if (value === "cline") return "cline";
  if (value === "command-code") return "command-code";
  if (value === "mini") return "mini";
  return undefined;
}

/** Plugin/installation-level normalization: every backend is its own plugin. */
export function normalizeCliPluginBackend(value: CliBackend): CliBackend {
  return cliPluginId(value);
}
