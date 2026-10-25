import { Alert, Box, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import type { CliBackend } from "@codex-ui/shared";
import { CLI_PLUGINS } from "../app/cli/cliPlugins";
import type { TranslateFn } from "../i18n";

export type CliPluginToggleId = "codex" | "claude" | "agy" | "grok" | "muse" | "pi" | "opencode" | "opencode-v2";

export type CliPluginToggleState = Record<CliPluginToggleId, boolean>;

type Props = {
  enabled: CliPluginToggleState;
  disabled?: boolean;
  error?: string | null;
  t: TranslateFn;
  onToggle: (backend: CliPluginToggleId, enabled: boolean) => void;
};

const TOGGLE_ORDER: CliPluginToggleId[] = ["codex", "claude", "agy", "grok", "muse", "pi", "opencode", "opencode-v2"];

export function CliBackendSettingsPanel({ enabled, disabled = false, error = null, t, onToggle }: Props) {
  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, borderBottom: "1px solid", borderColor: "divider" }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
        {t("settings.launch.cliPluginsTitle") === "settings.launch.cliPluginsTitle"
          ? "CLI plugins"
          : t("settings.launch.cliPluginsTitle")}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        {t("settings.launch.cliPluginsSubtitle") === "settings.launch.cliPluginsSubtitle"
          ? "Enable optional CLI backends. Disabled backends are hidden from the new-chat backend selector."
          : t("settings.launch.cliPluginsSubtitle")}
      </Typography>
      {error ? (
        <Alert severity="warning" variant="outlined" sx={{ mb: 1 }}>
          {error}
        </Alert>
      ) : null}
      <Stack spacing={0.5}>
        {TOGGLE_ORDER.map((id: CliPluginToggleId) => {
          const plugin = CLI_PLUGINS.find((entry) => entry.id === (id as CliBackend));
          return (
            <FormControlLabel
              key={id}
              control={
                <Switch
                  checked={enabled[id]}
                  disabled={disabled}
                  onChange={(event) => onToggle(id, event.target.checked)}
                  inputProps={{ "aria-label": plugin?.label ?? id }}
                />
              }
              label={plugin?.label ?? id}
            />
          );
        })}
      </Stack>
    </Box>
  );
}
