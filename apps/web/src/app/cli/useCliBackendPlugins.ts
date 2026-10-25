import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCodexCompatibleCliSettings,
  fetchClaudeCompatibleCliSettings,
  fetchAgyCompatibleCliSettings,
  fetchAuggieCompatibleCliSettings,
  fetchClineCompatibleCliSettings,
  fetchCommandCodeCompatibleCliSettings,
  fetchGrokCompatibleCliSettings,
  fetchMuseCompatibleCliSettings,
  fetchPiCompatibleCliSettings,
  fetchOpencodeCompatibleCliSettings,
  fetchOpencodeV2CompatibleCliSettings,
  updateCodexCompatibleCliSettings,
  updateClaudeCompatibleCliSettings,
  updateAgyCompatibleCliSettings,
  updateAuggieCompatibleCliSettings,
  updateClineCompatibleCliSettings,
  updateCommandCodeCompatibleCliSettings,
  updateGrokCompatibleCliSettings,
  updateMuseCompatibleCliSettings,
  updatePiCompatibleCliSettings,
  updateOpencodeCompatibleCliSettings,
  updateOpencodeV2CompatibleCliSettings
} from "../../state/codexClient";

export type CliPluginBackend = "codex" | "claude" | "agy" | "auggie" | "cline" | "command-code" | "grok" | "muse" | "pi" | "opencode" | "opencode-v2";

export interface CliBackendEnabledMap {
  codex: boolean;
  claude: boolean;
  agy: boolean;
  auggie: boolean;
  cline: boolean;
  "command-code": boolean;
  grok: boolean;
  muse: boolean;
  pi: boolean;
  opencode: boolean;
  "opencode-v2": boolean;
}

export interface UseCliBackendPluginsResult {
  codexCliEnabled: boolean;
  claudeCliEnabled: boolean;
  agyCliEnabled: boolean;
  auggieCliEnabled: boolean;
  clineCliEnabled: boolean;
  commandCodeCliEnabled: boolean;
  grokCliEnabled: boolean;
  museCliEnabled: boolean;
  piCliEnabled: boolean;
  opencodeCliEnabled: boolean;
  opencodeV2CliEnabled: boolean;
  cliBackendEnabled: CliBackendEnabledMap;
  cliBackendToggleError: string | null;
  handleCliBackendToggle: (backend: CliPluginBackend, enabled: boolean) => Promise<void>;
}

function formatErrorMessage(scope: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${scope}: ${message}`;
}

/**
 * Manages opt-in plugin flags for Codex-compatible CLI backends.
 * Loads backend flags on token change, supports optimistic toggling with rollback on failure.
 */
export function useCliBackendPlugins(token: string | null): UseCliBackendPluginsResult {
  const [codexCliEnabled, setCodexCliEnabled] = useState(false);
  const [claudeCliEnabled, setClaudeCliEnabled] = useState(false);
  const [agyCliEnabled, setAgyCliEnabled] = useState(false);
  const [auggieCliEnabled, setAuggieCliEnabled] = useState(false);
  const [clineCliEnabled, setClineCliEnabled] = useState(false);
  const [commandCodeCliEnabled, setCommandCodeCliEnabled] = useState(false);
  const [grokCliEnabled, setGrokCliEnabled] = useState(false);
  const [museCliEnabled, setMuseCliEnabled] = useState(false);
  const [piCliEnabled, setPiCliEnabled] = useState(false);
  const [opencodeCliEnabled, setOpencodeCliEnabled] = useState(false);
  const [opencodeV2CliEnabled, setOpencodeV2CliEnabled] = useState(false);
  const [cliBackendToggleError, setCliBackendToggleError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setCodexCliEnabled(false);
      setClaudeCliEnabled(false);
      setAgyCliEnabled(false);
      setAuggieCliEnabled(false);
      setClineCliEnabled(false);
      setCommandCodeCliEnabled(false);
      setGrokCliEnabled(false);
      setMuseCliEnabled(false);
      setPiCliEnabled(false);
      setOpencodeCliEnabled(false);
      setOpencodeV2CliEnabled(false);
      return () => {
        cancelled = true;
      };
    }
    void fetchCodexCompatibleCliSettings(token)
      .then((settings) => {
        if (!cancelled) setCodexCliEnabled(settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setCodexCliEnabled(false);
      });
    void fetchClaudeCompatibleCliSettings(token)
      .then((settings) => {
        if (!cancelled) setClaudeCliEnabled(settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setClaudeCliEnabled(false);
      });
    void fetchAgyCompatibleCliSettings(token)
      .then((settings) => {
        if (!cancelled) setAgyCliEnabled(settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setAgyCliEnabled(false);
      });
    void fetchAuggieCompatibleCliSettings(token)
      .then((settings) => {
        if (!cancelled) setAuggieCliEnabled(settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setAuggieCliEnabled(false);
      });
    void fetchClineCompatibleCliSettings(token)
      .then((settings) => {
        if (!cancelled) setClineCliEnabled(settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setClineCliEnabled(false);
      });
    void fetchCommandCodeCompatibleCliSettings(token)
      .then((settings) => {
        if (!cancelled) setCommandCodeCliEnabled(settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setCommandCodeCliEnabled(false);
      });
    void fetchGrokCompatibleCliSettings(token)
      .then((settings) => {
        if (!cancelled) setGrokCliEnabled(settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setGrokCliEnabled(false);
      });
    void fetchMuseCompatibleCliSettings(token)
      .then((settings) => {
        if (!cancelled) setMuseCliEnabled(settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setMuseCliEnabled(false);
      });
    void fetchPiCompatibleCliSettings(token)
      .then((settings) => {
        if (!cancelled) setPiCliEnabled(settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setPiCliEnabled(false);
      });
    void fetchOpencodeCompatibleCliSettings(token)
      .then((settings) => {
        if (!cancelled) setOpencodeCliEnabled(settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setOpencodeCliEnabled(false);
      });
    void fetchOpencodeV2CompatibleCliSettings(token)
      .then((settings) => {
        if (!cancelled) setOpencodeV2CliEnabled(settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setOpencodeV2CliEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleCliBackendToggle = useCallback(
    async (backend: CliPluginBackend, enabled: boolean) => {
      if (!token) return;
      setCliBackendToggleError(null);
      const applyLocal = (value: boolean) => {
        if (backend === "codex") setCodexCliEnabled(value);
        else if (backend === "claude") setClaudeCliEnabled(value);
        else if (backend === "agy") setAgyCliEnabled(value);
        else if (backend === "auggie") setAuggieCliEnabled(value);
        else if (backend === "cline") setClineCliEnabled(value);
        else if (backend === "command-code") setCommandCodeCliEnabled(value);
        else if (backend === "grok") setGrokCliEnabled(value);
        else if (backend === "muse") setMuseCliEnabled(value);
        else if (backend === "pi") setPiCliEnabled(value);
        else if (backend === "opencode-v2") setOpencodeV2CliEnabled(value);
        else setOpencodeCliEnabled(value);
      };
      applyLocal(enabled);
      try {
        if (backend === "codex") await updateCodexCompatibleCliSettings(token, enabled);
        else if (backend === "claude") await updateClaudeCompatibleCliSettings(token, enabled);
        else if (backend === "agy") await updateAgyCompatibleCliSettings(token, enabled);
        else if (backend === "auggie") await updateAuggieCompatibleCliSettings(token, enabled);
        else if (backend === "cline") await updateClineCompatibleCliSettings(token, enabled);
        else if (backend === "command-code") await updateCommandCodeCompatibleCliSettings(token, enabled);
        else if (backend === "grok") await updateGrokCompatibleCliSettings(token, enabled);
        else if (backend === "muse") await updateMuseCompatibleCliSettings(token, enabled);
        else if (backend === "pi") await updatePiCompatibleCliSettings(token, enabled);
        else if (backend === "opencode-v2") await updateOpencodeV2CompatibleCliSettings(token, enabled);
        else await updateOpencodeCompatibleCliSettings(token, enabled);
      } catch (error) {
        applyLocal(!enabled);
        setCliBackendToggleError(formatErrorMessage(`CLI plugin ${backend} update`, error));
      }
    },
    [token]
  );

  const cliBackendEnabled = useMemo(
    () => ({
      codex: codexCliEnabled,
      claude: claudeCliEnabled,
      agy: agyCliEnabled,
      auggie: auggieCliEnabled,
      cline: clineCliEnabled,
      "command-code": commandCodeCliEnabled,
      grok: grokCliEnabled,
      muse: museCliEnabled,
      pi: piCliEnabled,
      opencode: opencodeCliEnabled,
      "opencode-v2": opencodeV2CliEnabled
    }),
    [codexCliEnabled, claudeCliEnabled, agyCliEnabled, auggieCliEnabled, clineCliEnabled, commandCodeCliEnabled, grokCliEnabled, museCliEnabled, piCliEnabled, opencodeCliEnabled, opencodeV2CliEnabled]
  );

  return {
    codexCliEnabled,
    claudeCliEnabled,
    agyCliEnabled,
    auggieCliEnabled,
    clineCliEnabled,
    commandCodeCliEnabled,
    grokCliEnabled,
    museCliEnabled,
    piCliEnabled,
    opencodeCliEnabled,
    opencodeV2CliEnabled,
    cliBackendEnabled,
    cliBackendToggleError,
    handleCliBackendToggle
  };
}
