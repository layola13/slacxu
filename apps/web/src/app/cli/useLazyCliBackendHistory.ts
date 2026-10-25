import { useRef } from "react";
import type { CliBackend } from "@codex-ui/shared";

/**
 * Backends whose history listing loads lazily on first tab activation.
 * `codex` is covered by the initial unscoped load, so it has no loaded flag.
 */
export type LazyCliHistoryBackend = "claude" | "agy" | "auggie" | "cline" | "command-code" | "grok" | "muse" | "pi" | "opencode" | "opencode-v2" | "mini";

export const LAZY_CLI_HISTORY_BACKENDS: readonly LazyCliHistoryBackend[] = [
  "claude",
  "agy",
  "auggie",
  "cline",
  "command-code",
  "grok",
  "muse",
  "pi",
  "opencode",
  "opencode-v2",
  "mini",
];

export function isLazyCliHistoryBackend(value: unknown): value is LazyCliHistoryBackend {
  return (
    value === "claude" ||
    value === "agy" ||
    value === "auggie" ||
    value === "cline" ||
    value === "command-code" ||
    value === "grok" ||
    value === "muse" ||
    value === "pi" ||
    value === "opencode" ||
    value === "opencode-v2" ||
    value === "mini"
  );
}

/**
 * Owns one loaded flag per lazily-listed backend. `loadHistory` marks the
 * scoped backend on success so the sidebar lazy effects retry after failure
 * instead of leaving the tab permanently empty.
 */
export function useLazyCliBackendHistory() {
  const claudeHistoryLoadedRef = useRef(false);
  const agyHistoryLoadedRef = useRef(false);
  const grokHistoryLoadedRef = useRef(false);
  const museHistoryLoadedRef = useRef(false);
  const piHistoryLoadedRef = useRef(false);
  const opencodeHistoryLoadedRef = useRef(false);
  const opencodeV2HistoryLoadedRef = useRef(false);
  const miniHistoryLoadedRef = useRef(false);

  const markHistoryBackendLoaded = (backend: CliBackend | string | null | undefined) => {
    if (backend === "claude") {
      claudeHistoryLoadedRef.current = true;
    } else if (backend === "agy") {
      agyHistoryLoadedRef.current = true;
    } else if (backend === "grok") {
      grokHistoryLoadedRef.current = true;
    } else if (backend === "muse") {
      museHistoryLoadedRef.current = true;
    } else if (backend === "pi") {
      piHistoryLoadedRef.current = true;
    } else if (backend === "opencode") {
      opencodeHistoryLoadedRef.current = true;
    } else if (backend === "opencode-v2") {
      opencodeV2HistoryLoadedRef.current = true;
    } else if (backend === "mini") {
      miniHistoryLoadedRef.current = true;
    }
  };

  return {
    claudeHistoryLoadedRef,
    agyHistoryLoadedRef,
    grokHistoryLoadedRef,
    museHistoryLoadedRef,
    piHistoryLoadedRef,
    opencodeHistoryLoadedRef,
    opencodeV2HistoryLoadedRef,
    miniHistoryLoadedRef,
    markHistoryBackendLoaded,
  };
}
