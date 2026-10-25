import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { SshPreflightResult, WorkspaceMode } from "./appConstants";
import { installSshCodexCli, isSshWorkspaceCommand, normalizeSshWorkspaceCwd, preflightSshWorkspace } from "./sshUtils";
import { formatErrorText } from "./appUtils";
import type { appReducer } from "../../app/appReducer";
import type { ClientState } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useSshWorkspaceLifecycle(input: {
  state: Pick<ClientState, "token">;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  t: TranslateFn;
  workspaceMode: WorkspaceMode;
  cwdForThread: (threadId: string | null) => string;
  sshCommand: string;
  sshCwd: string;
  setSshPreflightIssue: Dispatch<SetStateAction<SshPreflightResult | null>>;
  setSshInstallConfirming: Dispatch<SetStateAction<boolean>>;
  setSshInstallBusy: Dispatch<SetStateAction<boolean>>;
  setSshInstallError: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    state,
    dispatch,
    t,
    workspaceMode,
    cwdForThread,
    sshCommand,
    sshCwd,
    setSshPreflightIssue,
    setSshInstallConfirming,
    setSshInstallBusy,
    setSshInstallError,
  } = input;
  const verifySshWorkspaceBeforeCreate = useCallback(async (modeOverride?: WorkspaceMode): Promise<boolean> => {
    const effectiveWorkspaceMode = modeOverride ?? workspaceMode;
    if (effectiveWorkspaceMode !== "ssh") return true;
    if (!state.token) {
      dispatch({ type: "error", message: "SSH workspace preflight requires an authenticated session" });
      return false;
    }
    const normalizedRemoteCwd = normalizeSshWorkspaceCwd(sshCwd);
    if (!normalizedRemoteCwd || !isSshWorkspaceCommand(sshCommand)) {
      dispatch({ type: "error", message: t("workspace.required") });
      return false;
    }
    setSshInstallBusy(true);
    setSshInstallError(null);
    try {
      const result = await preflightSshWorkspace(state.token, sshCommand.trim(), normalizedRemoteCwd);
      if (!result.ready) {
        setSshPreflightIssue(result);
        setSshInstallConfirming(false);
        return false;
      }
      setSshPreflightIssue(null);
      return true;
    } catch (error) {
      setSshInstallError(formatErrorText(error));
      return false;
    } finally {
      setSshInstallBusy(false);
    }
  }, [sshCommand, sshCwd, state.token, t, workspaceMode]);

  const recheckSshWorkspace = useCallback(async () => {
    if (!state.token) return;
    setSshInstallBusy(true);
    setSshInstallError(null);
    try {
      const result = await preflightSshWorkspace(state.token, sshCommand, cwdForThread(null));
      if (result.ready) {
        setSshPreflightIssue(null);
        setSshInstallConfirming(false);
      } else {
        setSshPreflightIssue(result);
      }
    } catch (error) {
      setSshInstallError(formatErrorText(error));
    } finally {
      setSshInstallBusy(false);
    }
  }, [cwdForThread, sshCommand, state.token]);

  const installSshCodex = useCallback(async () => {
    if (!state.token) return;
    setSshInstallBusy(true);
    setSshInstallError(null);
    try {
      const result = await installSshCodexCli(state.token, sshCommand, cwdForThread(null));
      if (result.ready) {
        setSshPreflightIssue(null);
        setSshInstallConfirming(false);
      } else {
        setSshPreflightIssue(result);
        setSshInstallError(result.reasons.join("; ") || t("workspace.sshInstallFailed"));
      }
    } catch (error) {
      setSshInstallError(formatErrorText(error));
    } finally {
      setSshInstallBusy(false);
    }
  }, [cwdForThread, sshCommand, state.token, t]);
  return { verifySshWorkspaceBeforeCreate, recheckSshWorkspace, installSshCodex };
}
