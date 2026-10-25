import type { CliBackend } from "@codex-ui/shared";

export interface EffectiveTurnCliBackendInput {
  /** Current new-conversation backend (`runtimeSelection.cliBackend`). */
  currentBackend: CliBackend | string | null | undefined;
  /** Persisted per-thread backend for the turn being started. */
  threadBackend: CliBackend | string | null | undefined;
  /** Provider resolved for the turn (`resolveProviderSelectionId` result). */
  resolvedProviderId: string | null | undefined;
  /**
   * Fallback when no backend matches. Callers pass their original fallback
   * expression so behavior stays identical per call site.
   */
  fallback: CliBackend;
  /**
   * The main composer checks the current/thread mini backend explicitly;
   * the sidechat path never did and falls through to its fallback instead.
   * Defaults to true.
   */
  includeMini?: boolean;
}

/**
 * Pure priority order for the backend a turn actually runs on: a sticky
 * current/thread selection or an official-relay provider wins, otherwise the
 * caller-supplied fallback applies. Extracted verbatim from the two
 * previously inline ternaries in App.tsx (main composer + sidechat).
 */
export function resolveEffectiveTurnCliBackend(input: EffectiveTurnCliBackendInput): CliBackend {
  const { currentBackend, threadBackend, resolvedProviderId, fallback } = input;
  const includeMini = input.includeMini ?? true;
  if (currentBackend === "agy" || threadBackend === "agy" || resolvedProviderId === "agy-official") {
    return "agy";
  }
  if (currentBackend === "grok" || threadBackend === "grok" || resolvedProviderId === "grok-official") {
    return "grok";
  }
  if (currentBackend === "claude" || threadBackend === "claude") {
    return "claude";
  }
  if (currentBackend === "pi" || threadBackend === "pi" || resolvedProviderId === "pi-relay") {
    return "pi";
  }
  if (currentBackend === "opencode-v2" || threadBackend === "opencode-v2") {
    return "opencode-v2";
  }
  if (currentBackend === "opencode" || threadBackend === "opencode" || resolvedProviderId === "opencode-local") {
    return "opencode";
  }
  if (currentBackend === "codex" || threadBackend === "codex") {
    return "codex";
  }
  if (includeMini && (currentBackend === "mini" || threadBackend === "mini")) {
    return "mini";
  }
  return fallback;
}
