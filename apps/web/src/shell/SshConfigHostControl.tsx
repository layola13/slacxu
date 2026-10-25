import { FormControl, MenuItem, Select, Stack, Typography, type SelectChangeEvent } from "@mui/material";
import type { SshConfigHost, WorkspaceMode } from "../app/workbench/appConstants";
import type { TranslateFn } from "../i18n";

export interface SshConfigHostControlProps {
  t: TranslateFn;
  workspaceMode: WorkspaceMode;
  sshConfigHostAlias: string;
  selectSshConfigHost: (alias: string) => Promise<void>;
  sshConfigHosts: SshConfigHost[];
  sshConfigHostsLoading: boolean;
  sshConfigHostProbing: boolean;
  sshConfigProbeError: string | null;
}

export function SshConfigHostControl({
  t,
  workspaceMode,
  sshConfigHostAlias,
  selectSshConfigHost,
  sshConfigHosts,
  sshConfigHostsLoading,
  sshConfigHostProbing,
  sshConfigProbeError,
}: SshConfigHostControlProps) {
  return workspaceMode === "ssh" ? (

    <Stack spacing={0.5} sx={{ minWidth: 0, width: "100%" }}>
      <FormControl size="small" fullWidth>
        <Select
          displayEmpty
          value={sshConfigHostAlias}
          renderValue={(value: unknown) => value ? String(value) : t("workspace.sshManual")}
          inputProps={{ "aria-label": t("workspace.sshConfigHost") }}
          onChange={(event: SelectChangeEvent<string>) => void selectSshConfigHost(String(event.target.value))}
        >
          <MenuItem value="">{t("workspace.sshManual")}</MenuItem>
          {sshConfigHosts.map((host) => (
            <MenuItem key={host.alias} value={host.alias} title={`${host.user ? `${host.user}@` : ""}${host.hostname}:${host.port}`}>
              {host.alias}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {sshConfigHostsLoading && <Typography variant="caption" color="text.secondary">{t("workspace.sshDetecting")}</Typography>}
      {sshConfigHostProbing && <Typography variant="caption" color="text.secondary">{t("workspace.sshProbing")}</Typography>}
      {sshConfigProbeError && <Typography variant="caption" color="error.main">{sshConfigProbeError}</Typography>}
    </Stack>
  ) : null;
}
