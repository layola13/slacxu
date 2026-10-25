import { useCallback, useEffect, useRef, useState } from "react";
import type { CliBackend } from "@codex-ui/shared";
import {
  fetchCliInstallations,
  fetchMiniVersion,
  selectCliInstallation,
  type CliInstallationsStatus,
  type CliInstallationKind,
} from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";
import { normalizeCliPluginBackend } from "./cliBackendKind";

export type CliSwitchConfirmTarget = {
  backend: "codex" | "claude" | "agy" | "auggie" | "grok" | "muse" | "pi" | "opencode" | "opencode-v2" | "cline" | "command-code" | "mini";
  path: string;
  version?: string | null;
};

export type CliBackendVersionLabelBackend = CliSwitchConfirmTarget["backend"] | CliBackend | string | null | undefined;

function formatCliErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "Unknown error";
}

export function resolveCliInstallationKind(backend: string): CliInstallationKind {
  const pluginBackend = normalizeCliPluginBackend(backend as CliBackend);
  if (
    pluginBackend === "claude" ||
    pluginBackend === "agy" ||
    pluginBackend === "auggie" ||
    pluginBackend === "cline" ||
    pluginBackend === "command-code" ||
    pluginBackend === "grok" ||
    pluginBackend === "pi" ||
    pluginBackend === "opencode" ||
    pluginBackend === "opencode-v2"
  ) {
    return pluginBackend;
  }
  return "codex";
}

/**
 * Owns CLI installation probing, the embedded Mini version, the version
 * switcher popover/confirm state, and the version label helper.
 * App passes token + current backend + codex version and renders the UI.
 */
export function useCliInstallations(input: {
  token: string | null;
  cliBackend: CliBackend | string | null | undefined;
  codexVersion?: string | null;
  t: TranslateFn;
}) {
  const { token, cliBackend, codexVersion, t } = input;
  const [cliInstallations, setCliInstallations] = useState<CliInstallationsStatus | null>(null);
  const [miniVersion, setMiniVersion] = useState<string | null>(null);
  const cliInstallationsRequestedRef = useRef<Set<string>>(new Set());
  const [cliSwitcherAnchor, setCliSwitcherAnchor] = useState<HTMLElement | null>(null);
  const [cliSwitchConfirmTarget, setCliSwitchConfirmTarget] = useState<CliSwitchConfirmTarget | null>(null);
  const [cliSwitchBusy, setCliSwitchBusy] = useState(false);
  const [cliSwitchError, setCliSwitchError] = useState<string | null>(null);
  const [cliSwitchNotice, setCliSwitchNotice] = useState<string | null>(null);

  const refreshCliInstallations = useCallback((refreshToken: string, kinds?: CliInstallationKind[]) => {
    void fetchCliInstallations(refreshToken, kinds)
      .then((status: CliInstallationsStatus) =>
        setCliInstallations((prev: CliInstallationsStatus | null) => ({ ...(prev ?? {}), ...status }) as CliInstallationsStatus))
      .catch(() => {
        /* keep previous snapshot on failure */
      });
  }, []);

  const ensureCliBackendLoaded = useCallback((ensureToken: string, backend: string) => {
    // Mini is embedded in the server bundle: no CLI binary to probe.
    if (backend === "mini") return;
    const kind = resolveCliInstallationKind(backend);
    if (cliInstallationsRequestedRef.current.has(kind)) return;
    cliInstallationsRequestedRef.current.add(kind);
    void fetchCliInstallations(ensureToken, [kind])
      .then((status: CliInstallationsStatus) =>
        setCliInstallations((prev: CliInstallationsStatus | null) => ({ ...(prev ?? {}), ...status }) as CliInstallationsStatus))
      .catch(() => {
        cliInstallationsRequestedRef.current.delete(kind);
      });
  }, []);

  useEffect(() => {
    if (!token) return;
    refreshCliInstallations(token);
    void fetchMiniVersion(token)
      .then((version: string | null) => {
        if (version) setMiniVersion(version);
      })
      .catch(() => {
        /* embedded mini version is best-effort */
      });
  }, [token, refreshCliInstallations]);

  const handleCliSwitchConfirm = useCallback(() => {
    const target = cliSwitchConfirmTarget;
    if (!target || !token) return;
    if (target.backend === "mini") {
      // Mini is embedded in the server bundle: nothing to switch on disk.
      setCliSwitchConfirmTarget(null);
      setCliSwitchNotice(t("app.cliSwitcherMiniWithVersion", { version: target.version ?? miniVersion ?? "" }) || "Mini (embedded)");
      return;
    }
    setCliSwitchBusy(true);
    setCliSwitchError(null);
    const backend: Exclude<CliSwitchConfirmTarget["backend"], "mini"> = target.backend;
    void selectCliInstallation(token, backend, target.path)
      .then(() => {
        setCliSwitchConfirmTarget(null);
        refreshCliInstallations(token, [backend]);
        setCliSwitchNotice(t("app.cliSwitchSuccess", {
          backend: backend === "claude"
            ? "Claude"
            : backend === "grok"
              ? "Grok"
              : backend === "muse"
                ? "Muse"
              : backend === "agy"
                ? "Antigravity"
                : backend === "auggie"
                  ? "Auggie"
                  : backend === "cline"
                    ? "Cline"
                : backend === "command-code"
                  ? "Command Code"
                : backend === "pi"
                  ? "Pi"
                  : backend === "opencode"
                    ? "OpenCode"
                    : backend === "opencode-v2"
                      ? "OpenCode v2"
                      : "Codex",
          version: target.version ?? "",
        }));
      })
      .catch((error: unknown) => setCliSwitchError(formatCliErrorText(error)))
      .finally(() => setCliSwitchBusy(false));
  }, [cliSwitchConfirmTarget, refreshCliInstallations, token, miniVersion, t]);

  const cliBackendVersionLabel = useCallback((rawBackend: CliBackendVersionLabelBackend): string | null => {
    if (!rawBackend) return null;
    const backend = rawBackend;
    if (backend === "codex") {
      return codexVersion ?? null;
    }
    if (backend === "mini") {
      return miniVersion;
    }
    if (backend !== "claude" && backend !== "agy" && backend !== "auggie" && backend !== "cline" && backend !== "command-code" && backend !== "grok" && backend !== "pi" && backend !== "opencode" && backend !== "opencode-v2") {
      return null;
    }
    const status = cliInstallations?.[backend];
    if (!status) return null;
    const match = status.installations.find((entry: CliInstallationsStatus["codex"]["installations"][number]) =>
      entry.path.toLowerCase() === status.effectivePath.toLowerCase());
    return match?.version ?? null;
  }, [cliInstallations, miniVersion, codexVersion]);

  return {
    cliInstallations,
    miniVersion,
    cliSwitcherAnchor,
    setCliSwitcherAnchor,
    cliSwitchConfirmTarget,
    setCliSwitchConfirmTarget,
    cliSwitchBusy,
    cliSwitchError,
    setCliSwitchError,
    cliSwitchNotice,
    setCliSwitchNotice,
    refreshCliInstallations,
    ensureCliBackendLoaded,
    handleCliSwitchConfirm,
    cliBackendVersionLabel,
  };
}
