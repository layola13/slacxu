import { Box, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import type { CliBackend } from "@codex-ui/shared";
import { CLI_PLUGINS, cliPluginId } from "../app/cli/cliPlugins";

type Props = {
  value: CliBackend;
  onChange: (value: CliBackend) => void;
  codexEnabled?: boolean;
  claudeEnabled?: boolean;
  agyEnabled?: boolean;
  auggieEnabled?: boolean;
  clineEnabled?: boolean;
  commandCodeEnabled?: boolean;
  grokEnabled?: boolean;
  museEnabled?: boolean;
  piEnabled?: boolean;
  opencodeEnabled?: boolean;
  opencodeV2Enabled?: boolean;
  ariaLabel?: string;
  testId?: string;
};

export function CliBackendPicker({ value, onChange, codexEnabled = false, claudeEnabled = false, agyEnabled = false, auggieEnabled = false, clineEnabled = false, commandCodeEnabled = false, grokEnabled = false, museEnabled = false, piEnabled = false, opencodeEnabled = false, opencodeV2Enabled = false, ariaLabel = "CLI backend", testId = "cli-backend-toggle" }: Props) {
  const enabled = new Set<CliBackend>([
    "mini",
    ...(codexEnabled ? ["codex" as const] : []),
    ...(claudeEnabled ? ["claude" as const] : []),
    ...(agyEnabled ? ["agy" as const] : []),
    ...(auggieEnabled ? ["auggie" as const] : []),
    ...(clineEnabled ? ["cline" as const] : []),
    ...(commandCodeEnabled ? ["command-code" as const] : []),
    ...(grokEnabled ? ["grok" as const] : []),
    ...(museEnabled ? ["muse" as const] : []),
    ...(piEnabled ? ["pi" as const] : []),
    ...(opencodeEnabled ? ["opencode" as const] : []),
    ...(opencodeV2Enabled ? ["opencode-v2" as const] : [])
  ]);
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={cliPluginId(value)}
      onChange={(_event, next: CliBackend | null) => {
        if (next) onChange(next);
      }}
      data-testid={testId}
      aria-label={ariaLabel}
      sx={{
        display: "flex",
        flexWrap: "wrap",
        gap: 0.5,
        "& .MuiToggleButtonGroup-grouped": { border: "1px solid", borderColor: "divider", borderRadius: "10px !important", marginLeft: "0 !important" },
        "& .MuiToggleButton-root": { px: 1, py: 0.75, textTransform: "none" }
      }}
    >
      {CLI_PLUGINS.filter((plugin) => enabled.has(plugin.id)).map((plugin) => (
        <Tooltip key={plugin.id} title={plugin.label} placement="top">
          <ToggleButton value={plugin.id} aria-label={plugin.label}>
            <Box component="img" src={plugin.icon} alt="" aria-hidden sx={{ width: 22, height: 22, objectFit: "contain" }} />
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
}
