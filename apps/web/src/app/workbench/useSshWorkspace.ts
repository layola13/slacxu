import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  DEFAULT_SSH_WORKSPACE_COMMAND,
  DEFAULT_SSH_WORKSPACE_CWD,
  type SshConfigHost,
  type SshPreflightResult,
  type WorkspaceMode,
} from "./appConstants";
import { fetchSshConfigHosts, normalizeSshWorkspaceCwd, probeSshConfigHost } from "./sshUtils";
import { formatErrorText } from "./appUtils";
import type { ClientState } from "../../state/codexClient";

export function useSshWorkspace(input: {
  state: Pick<ClientState, "token">;
  workspaceMode: WorkspaceMode;
  setWorkspacePickerPath: Dispatch<SetStateAction<string>>;
}) {
  const { state, workspaceMode, setWorkspacePickerPath } = input;
  const [sshCommand, setSshCommand] = useState(DEFAULT_SSH_WORKSPACE_COMMAND);
  const [sshCwd, setSshCwd] = useState(DEFAULT_SSH_WORKSPACE_CWD);
  const [sshPreflightIssue, setSshPreflightIssue] = useState<SshPreflightResult | null>(null);
  const [sshInstallConfirming, setSshInstallConfirming] = useState(false);
  const [sshInstallBusy, setSshInstallBusy] = useState(false);
  const [sshInstallError, setSshInstallError] = useState<string | null>(null);
  const [sshConfigHosts, setSshConfigHosts] = useState<SshConfigHost[]>([]);
  const [sshConfigHostAlias, setSshConfigHostAlias] = useState("");
  const [sshConfigHostsLoading, setSshConfigHostsLoading] = useState(false);
  const [sshConfigHostProbing, setSshConfigHostProbing] = useState(false);
  const [sshConfigProbeError, setSshConfigProbeError] = useState<string | null>(null);
  const [sshDetectedHome, setSshDetectedHome] = useState(DEFAULT_SSH_WORKSPACE_CWD);
  const sshHostListRequestRef = useRef(0);
  const sshHostProbeRequestRef = useRef(0);

  useEffect(() => {
    sshHostProbeRequestRef.current += 1;
    if (workspaceMode !== "ssh") {
      setSshConfigHostProbing(false);
      setSshConfigProbeError(null);
    }
  }, [workspaceMode]);

  useEffect(() => {
    if (workspaceMode !== "ssh" || !state.token) return;
    const requestId = ++sshHostListRequestRef.current;
    setSshConfigHostsLoading(true);
    setSshConfigProbeError(null);
    void fetchSshConfigHosts(state.token)
      .then((hosts: SshConfigHost[]) => {
        if (requestId === sshHostListRequestRef.current) setSshConfigHosts(hosts);
      })
      .catch((error: unknown) => {
        if (requestId === sshHostListRequestRef.current) setSshConfigProbeError(formatErrorText(error));
      })
      .finally(() => {
        if (requestId === sshHostListRequestRef.current) setSshConfigHostsLoading(false);
      });
    return () => {
      if (requestId === sshHostListRequestRef.current) {
        sshHostListRequestRef.current += 1;
        setSshConfigHostsLoading(false);
      }
    };
  }, [state.token, workspaceMode]);

  const selectSshConfigHost = useCallback(async (alias: string) => {
    const requestId = ++sshHostProbeRequestRef.current;
    setSshConfigHostAlias(alias);
    setSshConfigProbeError(null);
    if (!alias) {
      setSshConfigHostProbing(false);
      return;
    }
    setSshCommand("ssh " + alias);
    if (!state.token) return;
    setSshConfigHostProbing(true);
    try {
      const result = await probeSshConfigHost(state.token, alias);
      if (requestId !== sshHostProbeRequestRef.current) return;
      const remoteHome = normalizeSshWorkspaceCwd(result.home) || "/home";
      setSshCommand(result.command);
      setSshDetectedHome(remoteHome);
      setSshCwd(remoteHome);
      setWorkspacePickerPath(remoteHome);
    } catch (error) {
      if (requestId !== sshHostProbeRequestRef.current) return;
      setSshDetectedHome("/home");
      setSshCwd("/home");
      setWorkspacePickerPath("/home");
      setSshConfigProbeError(formatErrorText(error));
    } finally {
      if (requestId === sshHostProbeRequestRef.current) setSshConfigHostProbing(false);
    }
  }, [state.token]);
  return {
    sshCommand,
    setSshCommand,
    sshCwd,
    setSshCwd,
    sshPreflightIssue,
    setSshPreflightIssue,
    sshInstallConfirming,
    setSshInstallConfirming,
    sshInstallBusy,
    setSshInstallBusy,
    sshInstallError,
    setSshInstallError,
    sshConfigHosts,
    setSshConfigHosts,
    sshConfigHostAlias,
    setSshConfigHostAlias,
    sshConfigHostsLoading,
    setSshConfigHostsLoading,
    sshConfigHostProbing,
    setSshConfigHostProbing,
    sshConfigProbeError,
    setSshConfigProbeError,
    sshDetectedHome,
    setSshDetectedHome,
    sshHostListRequestRef,
    sshHostProbeRequestRef,
    selectSshConfigHost,
  };
}
