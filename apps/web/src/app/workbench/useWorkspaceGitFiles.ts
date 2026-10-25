import { useCallback, useEffect, useState, type Dispatch, type MutableRefObject } from "react";
import type { JsonValue } from "@codex-ui/shared";
import { fetchWorkspaceFile, fetchWorkspaceGit, writeWorkspaceFile } from "../../state/codexClient";
import { addWorkspaceRpcMetadata, fetchSshFile, writeSshFile } from "./sshUtils";
import { asRecord, decodeBase64Text, encodeBase64Text, formatErrorText } from "./appUtils";
import { shouldCommitWorkspaceRequest } from "../workspace/rightWorkspaceContext";
import type { useOpenFileTabs } from "../workspace/useOpenFileTabs";
import type { WorkspaceMode } from "./appConstants";
import type { appReducer } from "../../app/appReducer";
import type { ClientState, CodexSocketClient } from "../../state/codexClient";
import type { TranslateFn } from "../../i18n";

export function useWorkspaceGitFiles(input: {
  state: ClientState;
  dispatch: Dispatch<Parameters<typeof appReducer>[1]>;
  client: CodexSocketClient;
  t: TranslateFn;
  activeWorkspaceMode: WorkspaceMode;
  activeWorkspaceCwd: string;
  activeWorkspaceSshCommand: string;
  fileTabs: ReturnType<typeof useOpenFileTabs>;
  rightWorkspaceRequestEpochRef: MutableRefObject<number>;
  rightWorkspaceVisible: boolean;
  readDirectoryInContext: (path: string, mode?: WorkspaceMode, command?: string, contextCwd?: string) => Promise<void>;
}) {
  const { state, dispatch, client, t, activeWorkspaceMode, activeWorkspaceCwd, activeWorkspaceSshCommand, fileTabs, rightWorkspaceRequestEpochRef, rightWorkspaceVisible, readDirectoryInContext } = input;
  const [composerGitBranch, setComposerGitBranch] = useState<string | null>(null);
  const [composerGitDirtyCount, setComposerGitDirtyCount] = useState(0);

  const readActiveWorkspaceDirectory = useCallback(
    (path: string) => readDirectoryInContext(path, activeWorkspaceMode, activeWorkspaceSshCommand, activeWorkspaceCwd),
    [activeWorkspaceMode, activeWorkspaceSshCommand, readDirectoryInContext]
  );

  const workspaceGitRpc = useCallback(
    async (method: string, params: Record<string, unknown>) => {
      const routedParams = { ...params } as Record<string, JsonValue>;
      addWorkspaceRpcMetadata(routedParams, activeWorkspaceMode, activeWorkspaceSshCommand, activeWorkspaceCwd);
      if (state.activeThreadId) routedParams.threadId = state.activeThreadId;
      if (state.token) {
        try {
          return await fetchWorkspaceGit(state.token, method, routedParams);
        } catch {
          // fall through to client.rpc if workspace git endpoint fails
        }
      }
      return client.rpc(method, routedParams);
    },
    [activeWorkspaceCwd, activeWorkspaceMode, activeWorkspaceSshCommand, client, state.activeThreadId, state.token]
  );

  const readActiveWorkspaceFile = useCallback(
    async (path: string) => {
      const requestEpoch = rightWorkspaceRequestEpochRef.current;
      fileTabs.openTab(path);
      try {
        const result = activeWorkspaceMode === "ssh"
          ? await fetchSshFile(state.token!, activeWorkspaceSshCommand, path)
          : await fetchWorkspaceFile(state.token!, path, state.activeThreadId ?? undefined, activeWorkspaceCwd).catch(() =>
              client.rpc("fs/readFile", {
                path,
                ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}),
                ...(activeWorkspaceCwd ? { cwd: activeWorkspaceCwd } : {})
              })
            );
        if (!shouldCommitWorkspaceRequest(requestEpoch, rightWorkspaceRequestEpochRef.current, rightWorkspaceVisible)) return;
        const record = asRecord(result);
        const dataBase64 = typeof record.dataBase64 === "string" ? record.dataBase64 : undefined;
        const content = typeof dataBase64 === "string"
          ? decodeBase64Text(dataBase64)
          : typeof record.content === "string"
            ? record.content
            : typeof record.text === "string"
              ? record.text
              : undefined;
        // A backend without fs/readFile answers `{}`; surface that instead of an empty editor.
        if (content === undefined) throw new Error(`Failed to read ${path}: the backend returned no file content`);
        fileTabs.applyTabContent(path, content);
      } catch (error) {
        if (requestEpoch !== rightWorkspaceRequestEpochRef.current) return;
        fileTabs.markTabLoadFailed(path);
        dispatch({ type: "error", message: formatErrorText(error) });
      }
    },
    [activeWorkspaceCwd, activeWorkspaceMode, activeWorkspaceSshCommand, client, fileTabs, rightWorkspaceVisible, state.activeThreadId, state.token]
  );

  const saveActiveWorkspaceFile = useCallback(async () => {
    const current = fileTabs.openFile;
    if (!current || current.loading) return;
    const requestEpoch = rightWorkspaceRequestEpochRef.current;
    const { path, content } = current;
    fileTabs.markTabSaving(path, true);
    try {
      if (activeWorkspaceMode === "ssh") await writeSshFile(state.token!, activeWorkspaceSshCommand, path, encodeBase64Text(content));
      else {
        try {
          await writeWorkspaceFile(state.token!, path, encodeBase64Text(content), state.activeThreadId ?? undefined, activeWorkspaceCwd);
        } catch {
          await client.rpc("fs/writeFile", {
            path,
            content,
            dataBase64: encodeBase64Text(content),
            ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}),
            ...(activeWorkspaceCwd ? { cwd: activeWorkspaceCwd } : {})
          });
        }
      }
      if (!shouldCommitWorkspaceRequest(requestEpoch, rightWorkspaceRequestEpochRef.current, rightWorkspaceVisible)) return;
      fileTabs.markTabSaved(path);
      const parentPath = path.slice(0, path.lastIndexOf("/")) || "/";
      await readActiveWorkspaceDirectory(parentPath);
    } catch (error) {
      if (requestEpoch !== rightWorkspaceRequestEpochRef.current) return;
      fileTabs.markTabSaving(path, false);
      dispatch({ type: "error", message: formatErrorText(error) });
    }
  }, [activeWorkspaceCwd, activeWorkspaceMode, activeWorkspaceSshCommand, client, fileTabs, readActiveWorkspaceDirectory, rightWorkspaceVisible, state.activeThreadId, state.token]);
  useEffect(() => {
    if (!activeWorkspaceCwd) {
      setComposerGitBranch(null);
      setComposerGitDirtyCount(0);
      return;
    }
    let disposed = false;
    const refresh = async () => {
      try {
        const status = asRecord(await workspaceGitRpc("ui/git/status", { cwd: activeWorkspaceCwd }));
        if (disposed) return;
        if (status.isRepository !== true) {
          setComposerGitBranch(null);
          setComposerGitDirtyCount(0);
          return;
        }
        const branch = typeof status.branch === "string" && status.branch ? status.branch : null;
        const entries = Array.isArray(status.entries) ? status.entries : [];
        setComposerGitBranch(branch);
        setComposerGitDirtyCount(entries.length);
      } catch {
        if (!disposed) {
          setComposerGitBranch(null);
          setComposerGitDirtyCount(0);
        }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 20000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeWorkspaceCwd, workspaceGitRpc]);

  return {
    composerGitBranch,
    setComposerGitBranch,
    composerGitDirtyCount,
    setComposerGitDirtyCount,
    readActiveWorkspaceDirectory,
    workspaceGitRpc,
    readActiveWorkspaceFile,
    saveActiveWorkspaceFile,
  };
}
