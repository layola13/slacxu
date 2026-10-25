/**
 * App plugin manager (settings section "appplugins", Phase 4).
 *
 * Lists the server-side plugin catalog (GET /api/plugins): every
 * plugin project with its kind, version and install state, and
 * installs/uninstalls through POST /api/plugins/install|uninstall.
 * Locked entries (the running shell, the default Mini engine) render
 * disabled with a "Required" chip — the server enforces the same rule.
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import type { TranslateFn } from "../i18n";

export interface AppPluginEntry {
  id: string;
  kind: string;
  version: string;
  displayName: string;
  defaultInstalled: boolean;
  installed: boolean;
  locked: boolean;
}

async function fetchCatalog(): Promise<AppPluginEntry[]> {
  const response = await fetch("/api/plugins", { headers: { accept: "application/json" } });
  const payload = (await response.json().catch(() => ({}))) as { data?: { plugins?: AppPluginEntry[] }; error?: string };
  if (!response.ok || !payload.data?.plugins) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload.data.plugins;
}

async function setInstalled(id: string, install: boolean): Promise<AppPluginEntry[]> {
  const response = await fetch(install ? "/api/plugins/install" : "/api/plugins/uninstall", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ id }),
  });
  const payload = (await response.json().catch(() => ({}))) as { data?: { plugins?: AppPluginEntry[] }; error?: string };
  if (!response.ok || !payload.data?.plugins) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload.data.plugins;
}

export function PluginManagerPanel({ t }: { t: TranslateFn }) {
  const [plugins, setPlugins] = useState<AppPluginEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPlugins(await fetchCatalog());
      setError(null);
    } catch {
      setError(t("settings.appplugins.error"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (entry: AppPluginEntry) => {
      setBusyId(entry.id);
      try {
        setPlugins(await setInstalled(entry.id, !entry.installed));
        setError(null);
      } catch {
        setError(t("settings.appplugins.error"));
      } finally {
        setBusyId(null);
      }
    },
    [t],
  );

  if (error && !plugins) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (!plugins) {
    return (
      <Stack direction="row" spacing={1.5} alignItems="center">
        <CircularProgress size={18} />
        <Typography variant="body2">{t("settings.appplugins.loading")}</Typography>
      </Stack>
    );
  }
  return (
    <Stack spacing={1.25}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {plugins.map((entry) => (
        <Box
          key={entry.id}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: 1.5,
            py: 1.25,
            border: 1,
            borderColor: "divider",
            borderRadius: 2,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              {entry.displayName}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {entry.id} · {entry.kind} · v{entry.version}
            </Typography>
          </Box>
          {entry.locked ? (
            <Chip size="small" label={t("settings.appplugins.locked")} />
          ) : (
            <Chip
              size="small"
              color={entry.installed ? "success" : "default"}
              label={entry.installed ? t("settings.appplugins.installed") : t("settings.appplugins.available")}
            />
          )}
          <Button
            size="small"
            variant={entry.installed ? "outlined" : "contained"}
            disabled={entry.locked || busyId === entry.id}
            onClick={() => void toggle(entry)}
          >
            {entry.installed ? t("settings.appplugins.uninstall") : t("settings.appplugins.install")}
          </Button>
        </Box>
      ))}
    </Stack>
  );
}

export default PluginManagerPanel;
